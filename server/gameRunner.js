/* ============================================================
 * gameRunner.js —— 单局对局的驱动
 * 每个房间持有一个独立引擎上下文（vm 隔离，互不串局）
 * ============================================================ */
'use strict';
const { createEngineContext, buildCfg } = require('./engineHost');

/** 深拷贝一份可序列化的状态快照（避免把引擎内部引用直接发出去） */
function snapshot(S) {
  try { return JSON.parse(JSON.stringify(S)); } catch (e) { return null; }
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
