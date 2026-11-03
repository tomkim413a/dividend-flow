/* ============================================================
 * net.js —— 联机网络层（浏览器端）
 *
 * 说明：
 *   · 仅在联机模式下加载使用；单机（exe / 本地网页版）不会加载本文件，零影响。
 *   · Act 是「动作代理」：联机时把动作发给服务端权威引擎，单机时直接调本地引擎。
 * ============================================================ */
(function () {
  'use strict';

  const NET = {
    on: false,        // 是否已连接并联机中
    socket: null,
    user: null,
    room: null,
    state: null
  };
  const listeners = {};

  function emit(ev, data) {
    (listeners[ev] || []).forEach(f => { try { f(data); } catch (e) { /* 单个回调出错不影响其它 */ } });
  }

  NET.onEvent = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };

  NET.connect = function (token, user) {
    if (typeof io === 'undefined') return Promise.reject(new Error('Socket.IO 客户端未加载'));
    NET.user = user || null;
    return new Promise((resolve, reject) => {
      const s = io({ auth: { token } });
      s.on('connect', () => {
        NET.socket = s;
        NET.on = true;
        // 断线重连后：回到原房间并取消 AI 托管（首次连接时 NET.room 为空，不会触发）
        if (NET.room && NET.room.id) s.emit(CS.RESUME, { roomId: NET.room.id });
        s.on(SC.ROOM, r => { NET.room = r; emit('room', r); });
        s.on(SC.STATE, st => { NET.state = st; emit('state', st); });
        s.on(SC.ERROR, e => emit('error', e && e.msg));
        s.on(SC.GAME_OVER, g => emit('over', g));
        s.on('disconnect', () => { NET.on = false; emit('disconnect'); });
        resolve(s);
      });
      s.on('connect_error', e => reject(e));
    });
  };

  NET.send = (type, data) => { if (NET.socket) NET.socket.emit(type, data || {}); };
  NET.disconnect = () => { try { if (NET.socket) NET.socket.close(); } catch (e) {} NET.socket = null; NET.on = false; };

  /* ---------- 动作代理：联机走网络，单机走本地引擎 ---------- */
  const Act = {
    roll: () => NET.on ? NET.send(CS.ROLL) : Engine.act.roll(),
    choose: (a, p) => NET.on ? NET.send(CS.CHOOSE, { choice: a, payload: p }) : Engine.act.choose(a, p),
    sell: (sym, n) => NET.on ? NET.send(CS.SELL, { sym, shares: n }) : Engine.act.sellStock(sym, n),
    payDebt: (n) => NET.on ? NET.send(CS.PAY_DEBT, { amount: n }) : Engine.act.payDebt(n)
  };

  window.NET = NET;
  window.Act = Act;
})();
