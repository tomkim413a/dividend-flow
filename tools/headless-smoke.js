/* ============================================================
 * tools/headless-smoke.js —— 联机「阶段1」验证脚本
 *
 * 目的：在 Node 里加载【同一份】js/data.js + js/engine.js，自动跑完一局（全 AI），
 *       验证规则引擎可脱离浏览器运行 —— 这是联机版「服务端权威」的前提。
 *
 * 原理：data.js / engine.js 通过 window 交换对象（window.CF / window.Engine）。
 *       Node 里没有 window，用 global 冒充即可零侵入复用，
 *       保证服务端与浏览器跑的是同一份规则（不会出现两边规则不一致）。
 *
 * 用法：node tools/headless-smoke.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* 关键垫片：让 global 冒充 window */
global.window = global;

for (const f of ['js/data.js', 'js/engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}

const CF = global.CF;
const Engine = global.Engine;
if (!CF || !Engine) {
  console.error('引擎加载失败：CF=' + !!CF + ' Engine=' + !!Engine);
  process.exit(1);
}

/* 构造 4 家全 AI 对局 */
const profIds = CF.PROFESSIONS.map(p => p.id);
const cfg = [0, 1, 2, 3].map(i => ({
  name: 'AI' + (i + 1),
  prof: profIds[i % profIds.length],
  shape: '',
  ai: true
}));

/* 联机服务端不需要动画节奏：把 TIMING 全部归零，让规则即时推进。
   动画节奏交给客户端渲染层（单机 / 教学模式仍用正常节奏）。
   注意：engine 内部持有的是 CF.TIMING 这个对象的引用，改属性即可生效。 */
Object.keys(CF.TIMING).forEach(k => {
  if (typeof CF.TIMING[k] === 'number') CF.TIMING[k] = 0;
});

let renders = 0;
Engine.setRender(() => { renders++; });
Engine.start(cfg);

const t0 = Date.now();
const timer = setInterval(() => {
  const S = Engine.state();
  if (!S) return;
  const timeout = Date.now() - t0 > 60000;
  if (S.over || S.winner || timeout) {
    clearInterval(timer);
    const ok = !!S.over && !timeout;
    const w = S.winner ? S.winner.name : '(无人胜出)';
    console.log(`\n${ok ? '✅ 通过' : '⚠️ 未完成'}：over=${!!S.over} 胜者=${w} 回合=${S.turn} 日志=${S.logs.length}条 render回调=${renders}次 用时=${Date.now() - t0}ms`);
    console.log('   玩家：' + S.players.map(p => `${p.name}[${p.dead ? '破产' : p.won ? '胜出' : '存活'}]`).join(' '));
    // AI 投资风格与持仓统计（验证：激进型应买更多成长股）
    S.players.forEach(p => {
      const grw = (p.stocks || []).filter(h => h.cat === 'grw').length;
      const div = (p.stocks || []).filter(h => h.cat === 'div').length;
      console.log(`   ${p.name}: 风格=${p.aiStyle || '-'}  买入成长股=${p.buyGrw || 0}次  买入红利股=${p.buyDiv || 0}次  (当前持有 成长${grw}/红利${div})`);
    });
    if (timeout) console.log('   （超时：可能卡在某个待决策状态）');
    process.exit(ok ? 0 : 1);
  }
}, 100);
