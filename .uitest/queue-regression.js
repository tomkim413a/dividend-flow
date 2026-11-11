/* ============================================================
 * queue-regression.js —— 状态队列：不跳格 / 不瞬移 / 事件不丢 / 单帧异常不毒化
 *
 * 背景（20261111c）：旧版把帧分成「走格帧 / 其它」两类，积压时
 *   · 其它帧（含买股 / 买房 / 慈善 / 意外 / 纳税弹窗）被 splice 合并 → 事件一闪而过
 *   · 受保护帧过多时 while(shift) 丢掉最老的走格帧 → 棋子从半路开始 = 跳格
 *   · visibilitychange 积压 >6 直接 hydrate 最新状态 → 瞬移
 * 现改为语义签名去重 + 全局同签名合并 + 按最后一手折叠 + 回前台逐帧播放。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { chromium } = require(path.join(__dirname, 'node_modules', 'playwright-core'));
const EDGE = process.env.CHROME_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const INDEX = 'file:///' + path.resolve(ROOT, 'index.html').replace(/\\/g, '/');
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ck(n, c, x) {
  if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (x ? '  -> ' + x : '')); }
}

(async () => {
  const render = fs.readFileSync(path.join(ROOT, 'js/render.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  console.log('\n=== A. 静态防线 ===');
  ck('语义签名在入队时合并重复广播',
    /function frameSig\(st\)/.test(render) && /last\.__cfSig === sig/.test(render));
  ck('所有 pending 决策帧都算关键帧',
    /const isDecisionFrame = st => !!\(st && st\.pending\);/.test(render));
  ck('超限用全局同签名去重（走格帧签名唯一，一格不丢）',
    /const seen = new Set\(\);/.test(render) && /seen\.has\(sig\)/.test(render));
  ck('按最后一手折叠历史，不再无脑 shift 砍最老走格帧',
    /function trimToLatestTurn\(\)/.test(render));
  ck('回前台不再直接 hydrate 最新状态',
    !/addEventListener\('visibilitychange'[\s\S]{0,500}Engine\.hydrate\(latest\)/.test(render));
  ck('短促失焦 <1s 与正常走格 ≤12 帧都不干预',
    /away < 1000 \|\| stateQueue\.length <= MAX_WALK_RUN/.test(render));
  ck('单帧渲染异常有 try/catch，队列不会停摆',
    /try \{ Engine\.hydrate\(st\); render\(\); \}/.test(render));

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(INDEX);
  await page.waitForSelector('#player-cfg .pcfg');
  await page.click('#btn-start');
  await page.waitForFunction(() => !!(window.Engine && Engine.state() && Engine.state().players.length));

  async function reset() {
    await page.evaluate(() => {
      window.__h = [];
      window.__origRAF = window.__origRAF || window.requestAnimationFrame;
      window.requestAnimationFrame = window.__origRAF;
      if (!window.__origHydrate) window.__origHydrate = Engine.hydrate;
      Engine.hydrate = function (st) {
        window.__h.push({ probe: st && st.__probe, walk: st && st.walk && st.walk.left });
        return window.__origHydrate.call(this, st);
      };
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      window.dispatchEvent(new Event('visibilitychange'));
      window.__h = [];
    });
  }
  async function inject(frames, rafDelay) {
    return page.evaluate(({ frames, rafDelay }) => {
      const S = Engine.state();
      window.requestAnimationFrame = fn => window.setTimeout(fn, rafDelay);
      const sym = (S.market && S.market[0] && S.market[0].sym) || 'AAA';
      const legal = {
        stock: { type: 'stock', sym, price: 100, cat: 'grw', amt: 2 },
        house: { type: 'house', house: { icon: '🏠', name: '小屋', down: 1000, m: 100 }, at: '' },
        charity: { type: 'charity', donation: 100 },
        doodad: { type: 'doodad', doodad: { icon: '🛍️', name: '意外' }, amt: 100, big: false },
        tax: { type: 'tax', amt: 100, byIncome: 100, byAssets: 100 },
        liquidate: { type: 'liquidate', deficit: 500 }
      };
      frames.forEach(f => {
        const c = JSON.parse(JSON.stringify(S));
        c.__probe = f.probe;
        if (f.walk !== undefined) c.walk = { idx: 0, left: f.walk, steps: 20, stepMs: 270 };
        else delete c.walk;
        c.pending = f.pending ? (legal[f.pending] || { type: f.pending, deficit: 500 }) : null;
        window.ONLINE_HOOKS.applyState(c);
      });
    }, { frames, rafDelay });
  }

  console.log('\n=== B. 6 类事件/决策帧在积压时全部保留 ===');
  await reset();
  {
    const frames = [];
    const kinds = ['stock', 'house', 'charity', 'doodad', 'tax', 'liquidate'];
    for (let i = 0; i < 60; i++) {
      frames.push({ probe: i, walk: i < 10 ? 10 - i : undefined,
        pending: (i >= 20 && i < 26) ? kinds[i - 20] : undefined });
    }
    await inject(frames, 120);
    await wait(4000);
    const h = await page.evaluate(() => window.__h.slice());
    ck('★ 6 类决策帧全部保留（事件弹窗不再一闪而过）',
      [20, 21, 22, 23, 24, 25].every(v => h.some(x => x.probe === v)),
      JSON.stringify(h.map(x => x.probe)));
    ck('★ 10 个走格帧全部保留',
      h.filter(x => typeof x.walk === 'number').length === 10);
    ck('重复广播被合并，队列明显收敛', h.length < 30, '渲染 ' + h.length + ' 帧');
  }

  console.log('\n=== C. 全关键帧超限：一格不丢 ===');
  await reset();
  {
    const frames = [];
    for (let i = 0; i < 60; i++)
      frames.push(i % 3 === 0 ? { probe: i, pending: 'liquidate' } : { probe: i, walk: 60 - i });
    await inject(frames, 120);
    await wait(5000);
    const h = await page.evaluate(() => window.__h.slice());
    const walks = h.filter(x => typeof x.walk === 'number').map(x => x.walk);
    ck('★ 40 个走格帧全部保留，不因超限被 shift 砍掉', walks.length === 40,
      '实际 ' + walks.length);
    ck('★ left 严格递减、无缺口（连续逐格，不跳格）',
      walks.every((v, i) => i === 0 || walks[i - 1] > v), JSON.stringify(walks.slice(0, 8)));
  }

  console.log('\n=== D. 回前台：不瞬移、不回退 ===');
  await reset();
  {
    const frames = [];
    for (let i = 0; i < 10; i++) frames.push({ probe: i, walk: 10 - i });
    await inject(frames, 1000);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(12000);
    const h = await page.evaluate(() => window.__h.slice());
    ck('★ 10 格逐格播放，没有只画最新一帧',
      h.length === 10 && h.every((x, i) => x.probe === i), JSON.stringify(h.map(x => x.probe)));
  }

  await reset();
  {
    const frames = [];
    for (let i = 0; i < 20; i++) frames.push({ probe: i, walk: 20 - i });
    await inject(frames, 120);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(1300);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await wait(3500);
    const h = await page.evaluate(() => window.__h.slice());
    ck('★ 真后台 >1s 后仍逐帧播放、顺序不回退',
      h.length >= 8 && h.every((x, i) => i === 0 || x.probe > h[i - 1].probe),
      JSON.stringify(h.map(x => x.probe)));
  }

  console.log('\n=== E. 单帧渲染异常不毒化整条队列 ===');
  await reset();
  {
    const frames = [];
    for (let i = 0; i < 6; i++) frames.push({ probe: i, walk: 6 - i });
    frames.splice(3, 0, { probe: 99, pending: '__bad_house__' });
    await inject(frames, 100);
    await wait(2500);
    const h = await page.evaluate(() => window.__h.slice());
    ck('★ 残缺帧之后的走格帧仍全部渲染',
      h.filter(x => typeof x.walk === 'number').length === 6,
      JSON.stringify(h.map(x => x.probe)));
  }

  ck('全程无页面 JS 异常', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  await browser.close();
  console.log(`\n========================================\n  状态队列回归：${pass} 通过 / ${fail} 失败\n========================================\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e && e.stack); process.exit(2); });
