/* ============================================================
 * flow-regression.js —— 走格流畅度 / 换人闸门 / 联机结算回归
 *
 * 覆盖两个线上问题：
 *  1) 「再来一局」后 AI 先手不掷骰导致卡死（单机 + 联机两条路径）
 *  2) 慢速仍偶发跳格、事件短暂卡顿（状态队列丢帧 / rAF 后台暂停 /
 *     阻塞式 alert / 弹窗每帧重建）
 *
 * 纯静态断言 + 真实 Edge 行为断言，不依赖测试服务。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 静态断言只看代码：注释里会写「不要再用 window.alert」这类说明，不能算命中 */
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const renderSrc = read('js/render.js');
  const onlineSrc = read('js/online.js');
  const render = code(renderSrc);
  const online = code(onlineSrc);
  const html = read('index.html');

  console.log('\n=== A. 换人闸门：AI 座位不得闸住引擎 ===');
  ck('checkHandoff 对 AI / 联机 / 演示一律纯展示',
    /const showOnly = online \|\| !!p\.ai \|\| UI\.guide != null;/.test(render));
  ck('只有真人单机交接才 Engine.gate(true)',
    /if \(!showOnly\) Engine\.gate\(true\);/.test(render) && !/if \(!online\) Engine\.gate\(true\);/.test(render));
  ck('AI 交接框带 autoClose，短暂露出后自动收起',
    /autoClose: !!p\.ai/.test(render) && /UI\.handoff\.autoClose/.test(render));
  ck('真人交接仍保留 gate(false) + resume() 放行',
    /Engine\.gate\(false\);/.test(render) && /Engine\.resume\(\)/.test(render));

  console.log('\n=== B. 联机结算：绝不重启本地假局 ===');
  ck('winModal 区分联机并改写按钮文案',
    /const online = isOnlineGame\(\);/.test(render) && /返回设置 · 重新联机/.test(render));
  ck('联机分支先 disconnect 再 reload，不调用 Engine.start',
    /if \(online\) \{\s*try \{ if \(window\.NET && NET\.disconnect\) NET\.disconnect\(\); \} catch \(e\) \{\}\s*location\.reload\(\);\s*return;\s*\}/.test(render));
  ck('Engine.start 只保留在单机「再来一局」分支',
    (render.match(/Engine\.start\(S\.cfg\)/g) || []).length === 1);
  ck('ONLINE_HOOKS.over 不再用阻塞式 window.alert',
    !/over: function[\s\S]{0,400}window\.alert/.test(render));
  ck('online.js 的 over 提示改为不阻塞的 netToast',
    /NET\.onEvent\('over'[\s\S]{0,400}netToast\(/.test(online) && !/NET\.onEvent\('over'[\s\S]{0,400}window\.alert/.test(online));

  console.log('\n=== C. 状态队列：每格至少一帧，后台不积压 ===');
  ck('队列上限放宽到 48', /const MAX_STATE_QUEUE = 48;/.test(render));
  ck('不再用 splice 一次性丢掉所有中间格', !/stateQueue\.splice\(0, stateQueue\.length - 1\)/.test(render));
  ck('走格帧特殊保护（含 walk.left=0 的落格帧）',
    /const isWalkFrame = st => !!\(st && st\.walk && typeof st\.walk\.left === 'number'\)/.test(render));
  ck('积压时优先合并非走格帧', /if \(isWalkFrame\(stateQueue\[i\]\)\) i\+\+;\s*else stateQueue\.splice\(i, 1\);/.test(render));
  ck('rAF 之外有 setTimeout 兜底（后台标签页 rAF 会被暂停）',
    /guard = window\.setTimeout\(go, 40\);/.test(render) && /requestAnimationFrame\(go\)/.test(render));
  ck('回到前台积压过多时直接同步最新状态',
    /addEventListener\('visibilitychange'[\s\S]{0,400}stateQueue\.length = 0/.test(render));
  ck('交接框与结算框都做 data-modal-key 去重，避免每帧重建',
    /const key = 'handoff:'/.test(render) && /const winKey = 'win:'/.test(render));

  console.log('\n=== D. 脚本版本号一致（防浏览器缓存） ===');
  ck('index.html 7 处脚本全部 20261112a',
    (html.match(/\?v=20261112a/g) || []).length === 7);
  ck('online.js 动态加载的 protocol/net 同步版本',
    (online.match(/20261112a/g) || []).length === 2);
  ck('无旧版 20261109c 残留', !/20261109c/.test(html + online));

  console.log('\n=== E. 真实 Edge 行为验证 ===');
  const { chromium } = require(path.join(__dirname, 'node_modules', 'playwright-core'));
  const EDGE = process.env.CHROME_PATH
    || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const INDEX = 'file:///' + path.resolve(ROOT, 'index.html').replace(/\\/g, '/');
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(INDEX);
  await page.waitForSelector('#player-cfg .pcfg');
  await page.click('#btn-start');
  await page.waitForFunction(() => !!(window.Engine && Engine.state() && Engine.state().players.length));

  /* E1 单机：AI 排在座次首位时「再来一局」必须自动掷骰 */
  await page.evaluate(() => {
    const S = Engine.state();
    const cfg = S.cfg.slice();
    const i = cfg.findIndex(c => c && c.ai);
    if (i > 0) { const [c] = cfg.splice(i, 1); cfg.unshift(c); }
    S.cfg = cfg;
    S.over = true; S.winner = S.players.find(p => p.ai) || S.players[0];
    if (S.winner) S.winner.won = true;
    window.dispatchEvent(new Event('resize'));
  });
  await page.waitForSelector('#modal:not(.hidden)');
  await page.click('#btn-again');
  const t0 = await page.evaluate(() => {
    const S = Engine.state();
    return { firstIsAi: !!S.players[0].ai, dice: S.dice.slice(), turn: S.turn, gate: S.gate };
  });
  await wait(2200);
  const t1 = await page.evaluate(() => {
    const S = Engine.state();
    return { dice: S.dice.slice(), turn: S.turn, await: S.await };
  });
  ck('★ 单机 AI 先手：再来一局瞬间引擎未被 gate 闸住',
    t0.firstIsAi && t0.gate === false, JSON.stringify(t0));
  ck('★ 单机 AI 先手：2.2 秒内已自动掷骰推进（不再卡死）',
    JSON.stringify(t0.dice) !== JSON.stringify(t1.dice), JSON.stringify({ t0, t1 }));

  /* E2 状态队列：rAF 被节流时 12 个走格帧一个都不能丢（且按 stepMs 逐格播放） */
  await page.evaluate(() => {
    const S = Engine.state();
    S.over = null; S.winner = null;
    window.__hydrated = [];
    window.__hydratedAt = [];
    const orig = Engine.hydrate;
    Engine.hydrate = function (st) { window.__hydrated.push(st && st.__probe); window.__hydratedAt.push(Date.now()); return orig.call(this, st); };
    window.requestAnimationFrame = fn => window.setTimeout(fn, 250);
    for (let i = 0; i < 12; i++) {
      const c = JSON.parse(JSON.stringify(S));
      c.__probe = i; c.walk = { idx: 0, left: 12 - i, steps: 12, stepMs: 270 };
      window.ONLINE_HOOKS.applyState(c);
    }
  });
  /* 新节奏：每格按服务端 stepMs(270ms) 播放，不再 16ms 连播 —— 等待时间相应放长 */
  await wait(12 * 270 + 1500);
  const hyd = await page.evaluate(() => window.__hydrated);
  const hydAt = await page.evaluate(() => window.__hydratedAt);
  ck('★ 后台节流下 12 个走格帧全部渲染（零丢格）',
    hyd.length === 12 && hyd.every((v, i) => v === i), JSON.stringify(hyd));
  const gaps = hydAt.slice(1).map((t, i) => t - hydAt[i]);
  const minGap = gaps.length ? Math.min.apply(null, gaps) : 0;
  ck('★ 走格帧按 stepMs 逐格播放（不再十几毫秒连跳多格）',
    gaps.length >= 10 && minGap >= 200, '最小间隔 ' + minGap + 'ms / 全部 ' + JSON.stringify(gaps));

  /* E2c 银行结算格的重复帧（left 相同、位置相同）不该被节流白等一个 stepMs */
  await page.evaluate(() => {
    const S = Engine.state();
    window.__hydrated = []; window.__hydratedAt = [];
    const mk = (left, id) => {
      const c = JSON.parse(JSON.stringify(S));
      c.__probe = id; c.walk = { idx: 0, left, steps: 6, stepMs: 270 };
      return c;
    };
    window.ONLINE_HOOKS.applyState(mk(5, 100));
    window.ONLINE_HOOKS.applyState(mk(5, 101));   // 同一格重复帧（bankSettle 额外 emit）
    window.ONLINE_HOOKS.applyState(mk(4, 102));
  });
  await wait(900);
  const dup = await page.evaluate(() => ({ ids: window.__hydrated, at: window.__hydratedAt }));
  const dg1 = dup.at[1] - dup.at[0], dg2 = dup.at[2] - dup.at[1];
  ck('★ 同一格的重复帧不被节流（走到结算格不顿）', dg1 < 120, dg1 + 'ms');
  ck('重复帧之后仍按 stepMs 前进一格', dg2 >= 200, dg2 + 'ms');

  /* E2b 极端积压：60 个状态里 13 个走格帧（含 walk.left=0 的落格帧）必须一个不丢 */
  await page.evaluate(() => {
    const S = Engine.state();
    window.__hydrated = [];
    window.requestAnimationFrame = fn => window.setTimeout(fn, 250);
    for (let i = 0; i < 60; i++) {
      const c = JSON.parse(JSON.stringify(S));
      c.__probe = i;
      if (i < 12) c.walk = { idx: 0, left: 12 - i, steps: 12, stepMs: 270 };
      else if (i === 12) c.walk = { idx: 0, left: 0, steps: 12, stepMs: 270 };
      else delete c.walk;
      window.ONLINE_HOOKS.applyState(c);
    }
  });
  /* 13 格 × 270ms + 35 个非走格帧（每帧约 40ms 兜底）≈ 4.9s，留足余量 */
  await wait(6500);
  const hy2 = await page.evaluate(() => window.__hydrated);
  const walkFrames = hy2.filter(v => typeof v === 'number' && v <= 12);
  ck('★ 60 个状态积压时 13 个走格帧（含落格帧）全部保留',
    walkFrames.length === 13 && walkFrames.every((v, i) => v === i), JSON.stringify(hy2));
  ck('★ 积压时优先合并非走格帧（收敛到上限 48）',
    hy2.length === 48, '实际渲染 ' + hy2.length + ' 帧');

  /* E2c 回到前台：积压直接同步最新，不能连播旧格或回退 */
  const vis = await page.evaluate(() => {
    const S = Engine.state();
    window.__hydrated = [];
    window.requestAnimationFrame = fn => window.setTimeout(fn, 1000);
    for (let i = 0; i < 10; i++) {
      const c = JSON.parse(JSON.stringify(S));
      c.__probe = i; c.walk = { idx: 0, left: 10 - i, steps: 10, stepMs: 270 };
      window.ONLINE_HOOKS.applyState(c);
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    window.dispatchEvent(new Event('visibilitychange'));   // 监听器挂在 window 上
    return { rendered: window.__hydrated.slice(), current: (Engine.state() || {}).__probe };
  });
  await wait(1200);
  const visAfter = await page.evaluate(() => window.__hydrated.slice());
  ck('★ 回前台一次性同步到最新状态，不连播旧格、不回退',
    vis.rendered.length === 1 && vis.rendered[0] === 9 && vis.current === 9
    && visAfter.length === 1 && visAfter[0] === 9, JSON.stringify({ vis, visAfter }));

  /* E3 联机结算：按钮文案正确，点击不重启本地引擎（放最后，点击会 reload） */
  const clickInfo = await page.evaluate(() => {
    const S = Engine.state();
    S.over = true; S.winner = S.players[0];
    window.__disc = false;
    window.NET = {
      on: true, onlineMode: true, send: () => true,
      disconnect: () => { window.__disc = true; }
    };
    window.dispatchEvent(new Event('resize'));
    const label = (document.getElementById('btn-again') || {}).textContent || '';
    let calls = 0;
    const orig = Engine.start;
    Engine.start = function () { calls++; return orig.apply(this, arguments); };
    try { document.getElementById('btn-again').click(); } catch (e) {}
    Engine.start = orig;
    return { label: label.trim(), calls, disconnected: window.__disc };
  });
  ck('★ 联机结算按钮改为「返回设置 · 重新联机」', /返回设置/.test(clickInfo.label), clickInfo.label);
  ck('★ 联机点按钮不调用 Engine.start（不产生本地假局）', clickInfo.calls === 0, JSON.stringify(clickInfo));
  ck('★ 联机点按钮主动断开旧连接', clickInfo.disconnected === true);
  ck('全程无页面 JS 异常', errs.length === 0, JSON.stringify(errs));

  await browser.close();

  console.log('\n========================================');
  console.log(`  走格/结算回归：${pass} 通过 / ${fail} 失败`);
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(2); });
