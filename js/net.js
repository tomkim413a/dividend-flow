/* ============================================================
 * net.js —— 联机网络层（浏览器端）
 *
 * 说明：
 *   · 仅在联机模式下加载使用；单机（exe / 本地网页版）不会加载本文件，零影响。
 *   · Act 是「动作代理」：联机时把动作发给服务端权威引擎，单机时直接调本地引擎。
 *
 * 2026-11-08 网络稳定性修复（对应「对局玩到一半卡住走不了」）：
 *   · 旧版 connect 回调被 finish() 的 settled 保护挡住 —— 断线后 socket.io 自动重连
 *     成功，NET.on 却永远是 false，也不会发 CS.RESUME。服务端把该座位判为 AI 托管，
 *     渲染层看到 cur.ai=true 就不显示「掷骰子」按钮，表现为「卡住走不了」。
 *   · 现在首次连接与重连分开处理：重连成功立即恢复 NET.on、发 RESUME 取消 AI 托管。
 *   · 房间号存 sessionStorage，刷新页面 / 重建 socket 后仍可回到原座位。
 *   · 断线时 Act.* 不再回落到本地引擎（否则本地状态与服务端状态分叉、画面错乱）。
 *   · 全程对外 emit 网络状态事件，UI 明确提示，不再静默无响应。
 * ============================================================ */
(function () {
  'use strict';

  const ROOM_KEY = 'cf_online_room';
  const savedRoom = () => { try { return sessionStorage.getItem(ROOM_KEY) || ''; } catch (e) { return ''; } };
  const saveRoom = id => {
    try { id ? sessionStorage.setItem(ROOM_KEY, id) : sessionStorage.removeItem(ROOM_KEY); } catch (e) {}
  };

  const NET = {
    on: false,            // 当前 socket 是否连通
    socket: null,
    user: null,
    room: null,
    state: null,
    onlineMode: false,    // 是否已进入联机对局（决定断线时能否回落到本地引擎）
    connectedOnce: false, // 是否成功连上过（用于区分首次连接 / 重连）
    manualClose: false    // 用户主动离开大厅：不再重连
  };
  const listeners = {};

  function emit(ev, data) {
    (listeners[ev] || []).forEach(f => { try { f(data); } catch (e) { /* 单个回调出错不影响其它 */ } });
  }

  NET.onEvent = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };

  function friendlyError(e, fallback) {
    const m = (e && (e.message || e.description)) || '';
    if (/websocket|transport|timeout|xhr|poll|network|fetch/i.test(m)) {
      return '连不上游戏服务（可能是代理 / VPN 拦截了连接，或服务器正在唤醒）。建议关闭代理后重试';
    }
    return m || fallback || '连接失败';
  }

  NET.connect = function (token, user) {
    if (typeof io === 'undefined') return Promise.reject(new Error('Socket.IO 客户端未加载'));
    NET.user = user || null;
    NET.manualClose = false;
    // 刷新页面后内存里的 room 没了，从 sessionStorage 恢复，才能回原座位
    if (!NET.room || !NET.room.id) {
      const rid = savedRoom();
      if (rid) NET.room = { id: rid };
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      let resumePending = false;
      const finish = fn => { if (settled) return; settled = true; clearTimeout(timer); fn(); };

      const s = io({
        auth: { token },
        timeout: 20000,
        /* 跨境链路抖动常见，3 次太少会直接放弃；polling 明确保留作代理环境兜底 */
        transports: ['polling', 'websocket'],
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0.3
      });
      NET.socket = s;

      const resume = () => {
        if (!NET.room || !NET.room.id) return;
        resumePending = true;
        s.emit(CS.RESUME, { roomId: NET.room.id });
      };

      /* 事件只注册一次：socket.io 重连复用同一实例与 listener */
      s.on(SC.ROOM, r => {
        NET.room = r;
        resumePending = false;
        if (r && r.id) saveRoom(r.id);
        emit('room', r);
      });
      s.on(SC.STATE, st => { NET.state = st; resumePending = false; emit('state', st); });
      s.on(SC.ERROR, e => {
        const msg = e && e.msg;
        if (resumePending && /房间不存在|不在这个房间|对局已结束|已主动放弃/.test(String(msg || ''))) {
          // 旧房间已销毁 / 本人已确认放弃：清掉持久化，静默忽略，不打扰玩家
          resumePending = false;
          NET.room = null;
          saveRoom('');
          return;
        }
        resumePending = false;
        emit('error', msg);
      });
      s.on(SC.GAME_OVER, g => { saveRoom(''); NET.room = null; emit('over', g); });
      /* 公开房列表：字面量兜底，兼容浏览器缓存里的旧 protocol.js */
      s.on(SC.ROOM_LIST || 'sc:roomList', list => emit('roomList', list));

      s.on('connect', () => {
        clearTimeout(timer);
        if (NET.manualClose) { try { s.disconnect(); } catch (_) {} return; }

        const isReconnect = NET.connectedOnce;
        NET.connectedOnce = true;
        NET.on = true;

        /* ★ 关键：把座位从服务端的 AI 托管恢复为真人操控。
           不发这一句，渲染层会一直把当前玩家当电脑，操作按钮永不出现。 */
        resume();

        if (isReconnect) {
          emit('reconnect');
        } else {
          finish(() => resolve(s));
        }
      });

      s.on('disconnect', reason => {
        NET.on = false;
        if (!NET.manualClose) emit('disconnect', reason);
      });

      s.on('connect_error', e => {
        /* 已经连上过 → 属于重连期错误，交给 socket.io 继续重试，绝不掐断 */
        if (settled) { emit('reconnecting', friendlyError(e, '正在重连…')); return; }
        finish(() => {
          try { s.disconnect(); } catch (_) {}
          NET.socket = null;
          reject(new Error(friendlyError(e, '连接房间服务失败')));
        });
      });

      s.on('reconnect_attempt', n => emit('reconnecting', n));
      s.on('reconnect_failed', () => { if (!NET.manualClose) emit('reconnect_failed'); });

      timer = setTimeout(() => finish(() => {
        try { s.disconnect(); } catch (_) {}
        NET.socket = null;
        reject(new Error('连接服务器超时（25 秒）。若电脑开了代理 / VPN，请关闭后重试'));
      }), 25000);
    });
  };

  /* 断线时明确告知 UI，而不是静默 emit 到一个已断开的 socket */
  NET.send = (type, data) => {
    if (!NET.socket || !NET.on) { emit('offline-action', type); return false; }
    NET.socket.emit(type, data || {});
    return true;
  };

  /* 重连彻底失败后，手动重启 socket.io 的重连循环（复用同一实例与已注册的监听） */
  NET.reconnect = () => {
    if (!NET.socket) return false;
    NET.manualClose = false;
    try { NET.socket.connect(); return true; } catch (e) { return false; }
  };

  NET.disconnect = () => {
    NET.manualClose = true;
    NET.onlineMode = false;
    NET.connectedOnce = false;
    NET.room = null;
    NET.state = null;
    saveRoom('');                 // 主动离开：不再保留旧座位
    try { if (NET.socket) NET.socket.disconnect(); } catch (e) {}
    NET.socket = null;
    NET.on = false;
  };

  /* ---------- 动作代理：联机走网络，单机走本地引擎 ----------
     联机对局中断线时【绝不】回落到本地引擎：那会让客户端自己推进一份状态，
     与服务端权威状态分叉，重连后画面跳回、按钮失效，看起来就是「卡住走不了」。 */
  const local = fn => {
    if (NET.onlineMode) { emit('offline-action'); return; }
    fn();
  };

  const Act = {
    roll: () => {
      if (!NET.on) return local(() => Engine.act.roll());
      // 联机：点下去立刻出声，不等服务端往返（否则音效要等一个 RTT）
      try {
        if (window.SFX) { window.SFX.dice(); window.__localDiceAt = Date.now(); }
      } catch (e) {}
      NET.send(CS.ROLL);
    },
    choose: (a, p) => NET.on ? NET.send(CS.CHOOSE, { choice: a, payload: p }) : local(() => Engine.act.choose(a, p)),
    sell: (sym, n) => NET.on ? NET.send(CS.SELL, { sym, shares: n }) : local(() => Engine.act.sellStock(sym, n)),
    payDebt: (n) => NET.on ? NET.send(CS.PAY_DEBT, { amount: n }) : local(() => Engine.act.payDebt(n))
  };

  window.NET = NET;
  window.Act = Act;
})();
