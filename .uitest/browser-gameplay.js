/* ============================================================
 * browser-gameplay.js —— 真实 Edge 浏览器里的引擎/弹窗回归
 *
 * 覆盖纯 Node 模拟覆盖不到的 DOM 行为：
 *   1. 页面无 JS 异常（render.js 抛错会中断整条渲染链）
 *   2. 一次掷骰的墙钟耗时（节奏优化后应显著变短）
 *   3. 走格期间顶部显示进度，而不是「…」
 *   4. 决策弹窗在多次 render 后不重建（输入值/DOM 节点保持）
 *   5. 换人交接弹窗确认后引擎继续推进（不会卡在 busy）
 * ============================================================ */
'use strict';
const path = require('path');
const { chromium } = require('playwright-core');

const EDGE = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const INDEX = 'file:///' + path.resolve(__dirname, '..', 'index.html').replace(/\\/g, '/');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ck(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/net::ERR_|Failed to load resource/i.test(m.text())) {
      errors.push('console: ' + m.text());
    }
  });

  await page.goto(INDEX);
  // 清掉上一次测试可能残留的速度存档并重载，保证每次都从默认档开始
  await page.evaluate(() => { try { localStorage.removeItem('cf_speed_v1'); } catch (e) {} });
  await page.reload();
  await page.waitForSelector('#player-cfg .pcfg');
  ck('设置页正常加载', (await page.locator('#player-cfg .pcfg').count()) >= 2);

  // 速度档位：默认「舒缓」，三个界面各有一个下拉，切换后即时生效
  const speed = await page.evaluate(() => ({
    key: window.CF.TIMING.speed,
    hold: window.CF.TIMING.walkHold,
    humanHold: window.CF.TIMING.humanWalkHold,
    presets: window.CF.SPEED_PRESETS.map(p => p.key),
    selects: document.querySelectorAll('[data-speed-select]').length,
    setupVal: (document.getElementById('setup-speed') || {}).value,
    topVal: (document.getElementById('game-speed') || {}).value,
    lobbyVal: (document.getElementById('lobby-speed') || {}).value,
    hint: (document.getElementById('setup-speed-hint') || {}).textContent
  }));
  ck('默认「舒缓」档、四档齐全', speed.key === 'relaxed' && speed.presets.length === 4, JSON.stringify(speed));
  ck('开始页 / 顶栏 / 联机大厅三处下拉都已填充且同步',
    speed.selects === 3 && speed.setupVal === speed.key && speed.topVal === speed.key && speed.lobbyVal === speed.key,
    JSON.stringify(speed));
  ck('档位说明已显示且明确只讲 AI', /AI 每格|AI 每手/.test(speed.hint || ''), speed.hint);
  ck('界面把「AI 可调 / 真人固定」分成两个独立单元',
    (await page.locator('.speed-fixed').count()) === 2, String(await page.locator('.speed-fixed').count()));

  const changed = await page.evaluate(() => {
    const sel = document.getElementById('setup-speed');
    sel.value = 'slow';
    sel.dispatchEvent(new Event('change'));
    let saved = null;
    try { saved = localStorage.getItem('cf_speed_v1'); } catch (e) { /* file:// 可能禁用存储 */ }
    return {
      key: window.CF.TIMING.speed, hold: window.CF.TIMING.walkHold, saved,
      humanHold: window.CF.TIMING.humanWalkHold,
      topVal: (document.getElementById('game-speed') || {}).value
    };
  });
  ck('★ 切换档位即时生效（AI 节奏变慢 + 三处显示同步）',
    changed.key === 'slow' && changed.hold > speed.hold && changed.topVal === 'slow', JSON.stringify(changed));
  ck('★ 真人节奏完全不受 AI 档位影响',
    changed.humanHold === speed.humanHold && changed.humanHold === 320,
    `${speed.humanHold} → ${changed.humanHold}`);
  ck('档位已持久化（file:// 禁用存储时允许为 null）',
    changed.saved === 'slow' || changed.saved === null, String(changed.saved));

  // 单手耗时测试固定用「标准」档，避免被慢速档拉长
  await page.evaluate(() => {
    const sel = document.getElementById('setup-speed');
    sel.value = 'normal'; sel.dispatchEvent(new Event('change'));
  });

  await page.click('#btn-start');
  await page.waitForTimeout(500);
  const boot = await page.evaluate(() => ({
    board: (document.querySelector('#board') || {}).innerHTML ? document.querySelector('#board').innerHTML.slice(0, 120) : '(空)',
    state: !!(window.Engine && window.Engine.state()),
    setupHidden: document.querySelector('#screen-setup').classList.contains('hidden')
  }));
  console.log('  [boot] ' + JSON.stringify(boot));
  if (errors.length) console.log('  [boot errors] ' + errors.slice(0, 5).join(' | '));
  await page.waitForSelector('#board .rcell', { timeout: 8000 }).catch(() => {});

  // 换人交接弹窗（2 人局）：点确定放行
  const ho = page.locator('#btn-ho-ok');
  if (await ho.count()) await ho.click();
  await page.waitForTimeout(120);
  const st0 = await page.evaluate(() => {
    const S = window.Engine.state();
    return { await: S.await, turn: S.turn, cur: S.cur, gate: S.gate, players: S.players.length };
  });
  ck('换人确认后引擎处于可行动状态', st0.await === 'roll' || st0.await === 'busy', JSON.stringify(st0));
  ck('换人确认后 gate 已放行', st0.gate === false);

  /* ---- 掷骰：计时 + 进度提示 ---- */
  const t0 = Date.now();
  await page.click('#btn-roll');
  await page.waitForTimeout(30);
  const walking = await page.evaluate(() => {
    const S = window.Engine.state();
    return { await: S.await, left: S.walk && S.walk.left, top: document.querySelector('#top-status').textContent };
  });
  ck('掷骰后进入走格状态', walking.await === 'busy' || walking.await === 'pending', JSON.stringify(walking));
  await page.waitForTimeout(400);
  const mid = await page.evaluate(() => {
    const S = window.Engine.state();
    return { await: S.await, left: S.walk && S.walk.left, top: document.querySelector('#top-status').textContent };
  });
  ck('走格期间有可见进度提示', /前进中|还剩|选择|结算|落格|掷出/.test(mid.top), mid.top.trim());

  // 等本手结束（回到可掷骰 / 出现决策弹窗 / 换人）
  await page.waitForFunction(() => {
    const S = window.Engine.state();
    return !S || S.over || S.await === 'roll' || S.await === 'pending';
  }, { timeout: 12000 }).catch(() => {});
  const elapsed = Date.now() - t0;
  console.log(`  一次掷骰到可再次操作：${elapsed} ms`);
  ck('★ 单手耗时明显短于旧版（< 3.5 秒）', elapsed < 3500, elapsed + ' ms');

  /* ---- 决策弹窗：多次 render 不重建 ---- */
  let hasPending = await page.evaluate(() => {
    const S = window.Engine.state();
    return !!(S && S.pending);
  });
  if (!hasPending) {
    // 没有自然翻到事件卡：人工注入一次，专门验证弹窗缓存逻辑
    await page.evaluate(() => {
      const S = window.Engine.state();
      const m = S.market[0];
      S.await = 'pending';
      S.pending = { type: 'stock', sym: m.sym, price: m.px, cat: m.cat };
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(80);
    hasPending = true;
  }
  if (hasPending) {
    const key1 = await page.evaluate(() => {
      const b = document.querySelector('#mbody');
      window.__probeNode = b.querySelector('#amt') || b.firstElementChild;
      const inp = b.querySelector('#amt');
      if (inp) inp.value = '7';
      return b.getAttribute('data-modal-key');
    });
    // 连续触发 3 次全量 render（模拟联机状态广播）
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      await page.waitForTimeout(30);
    }
    const probe = await page.evaluate(() => {
      const b = document.querySelector('#mbody');
      const inp = b.querySelector('#amt');
      return {
        key: b.getAttribute('data-modal-key'),
        sameNode: window.__probeNode === (inp || b.firstElementChild),
        val: inp ? inp.value : null
      };
    });
    ck('★ 决策弹窗带签名标记', !!key1, String(key1));
    ck('★ 3 次 render 后弹窗未重建（DOM 节点保持）', probe.sameNode, JSON.stringify(probe));
    ck('★ 玩家输入的股数未被清空', probe.val === null || probe.val === '7', String(probe.val));
  }

  /* ---- 页面无异常 ---- */
  ck('★ 全程无 JS 异常', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n========================================');
  console.log(`  真实浏览器回归：${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('浏览器验证异常：', e); process.exitCode = 1; });
