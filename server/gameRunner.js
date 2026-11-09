/* ============================================================
 * gameRunner.js —— 单局对局的驱动
 * 每个房间持有一个独立引擎上下文（vm 隔离，互不串局）
 * ============================================================ */
'use strict';
const { createEngineContext, buildCfg } = require('./engineHost');

/** 深拷贝一份可序列化的状态快照（避免把引擎内部引用直接发出去）
 *  同时精简体积以降低网络延迟：行情历史只留最近 80 点、日志只留最新 60 条 */
function snapshot(S) {
  try {
    const snap = JSON.parse(JSON.stringify(S));
    /* 引擎内部字段不下发：S.queue 里装的是函数，JSON 序列化会变成 [null]，
       客户端 hydrate 后一旦误触发本地规则就会 TypeError 并中断渲染。
       直接给成干净的空数组/默认值；S.walk 是纯数据（剩余格数），
       客户端顶部状态栏要用它显示「前进中…还剩 N 格」，必须保留。 */
    snap.queue = [];
    snap.gate = false;
    snap.needFinish = false;
    if (Array.isArray(snap.market)) {
      snap.market.forEach(m => {
        if (Array.isArray(m.hist) && m.hist.length > 80) m.hist = m.hist.slice(-80);
      });
    }
    if (Array.isArray(snap.logs) && snap.logs.length > 60) snap.logs = snap.logs.slice(0, 60);
    return snap;
  } catch (e) { return null; }
}

/**
 * 创建一局
 * @param {Array} seats 座位 [{ userId, name, ai }]
 * @param {Function} onState 状态变化回调 (state)
 * @param {Function} onOver  对局结束回调 (state)
 */
function createGame(seats, onState, onOver) {
  const { CF, Engine, takeSfx } = createEngineContext();
  const cfg = buildCfg(CF, seats);

  let ended = false;
  Engine.setRender(() => {
    const S = Engine.state();
    if (!S) return;
    const sfx = takeSfx();                 // 本批音效事件（下发给客户端播放）
    const snap = snapshot(S);
    if (snap) {
      if (sfx.length) snap.__sfx = sfx;
      // 客户端 renderToasts 会 splice 清空 toasts；服务端没人清，
      // 这里补上，否则 toasts 会累积并随每次状态重复下发，导致提示刷屏。
      if (S.toasts && S.toasts.length) S.toasts.length = 0;
    }
    if (onState) onState(snap);
    if (S.over && !ended) {
      ended = true;
      if (onOver) onOver(snap);
    }
  });

  Engine.start(cfg);

  return {
    CF,
    Engine,
    state: () => { const S = Engine.state(); return S ? snapshot(S) : null; },
    isOver: () => !!(Engine.state() && Engine.state().over)
  };
}

module.exports = { createGame };
