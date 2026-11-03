/* ============================================================
 * online.js —— 联机入口（登录 / 注册 + 大厅 + 进入对局）
 *
 * 单机模式完全不参与：只有点了「联机对战」才会动态加载依赖，
 * 因此 exe / 本地网页版不受任何影响。
 * ============================================================ */
(function () {
  'use strict';
  const KEY = 'cf_online_token';

  const el = id => document.getElementById(id);
  /* token 存 sessionStorage（按标签页隔离）：
     若用 localStorage，同源的多个标签页会共享同一份 token，
     导致第二个窗口自动登录成同一个人，看起来像“能操控别的玩家”。 */
  const getToken = () => { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } };
  const setToken = t => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function post(p, body) {
    const r = await fetch(p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    return r.json();
  }

  function loadScripts(srcs) {
    return srcs.reduce((prev, src) => prev.then(() => new Promise((res, rej) => {
      if (document.querySelector('script[src="' + src + '"]')) return res();
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = () => rej(new Error(src + ' 加载失败'));
      document.head.appendChild(s);
    })), Promise.resolve());
  }

  /* ---------------- 登录 / 注册 ---------------- */
  function showAuth(onOk) {
    const box = el('auth-overlay');
    if (!box) return;
    box.classList.remove('hidden');
    const u = el('auth-user'), p = el('auth-pass'), msg = el('auth-msg');
    msg.textContent = '';

    el('auth-login').onclick = async () => {
      const r = await post('/api/login', { username: u.value, password: p.value });
      if (r.err) { msg.textContent = '❌ ' + r.err; return; }
      setToken(r.token);
      box.classList.add('hidden');
      onOk(r.user);
    };
    el('auth-register').onclick = async () => {
      const r = await post('/api/register', { username: u.value, password: p.value });
      if (r.err) { msg.textContent = '❌ ' + r.err; return; }
      setToken(r.token);
      box.classList.add('hidden');
      onOk(r.user);
    };
    el('auth-close').onclick = () => box.classList.add('hidden');
  }

  /* ---------------- 大厅 ---------------- */
  function showLobby(user) {
    const box = el('lobby-overlay');
    if (!box) return;
    box.classList.remove('hidden');
    const seats = el('lobby-seats'), roomNo = el('lobby-roomno'), msg = el('lobby-msg');
    let entered = false;

    NET.onEvent('room', r => {
      if (!r) return;
      roomNo.textContent = r.id;
      seats.innerHTML = (r.seats || []).map(s =>
        `<li>${esc(s.name)}${s.ai ? ' <small>（电脑）</small>' : ''}</li>`).join('');
      el('lobby-start').disabled = !(r.hostId === user.id);
      msg.textContent = '';
    });

    NET.onEvent('error', m => { msg.textContent = '⚠️ ' + (m || '操作失败'); });

    // 首次收到对局状态 → 进入对局画面
    NET.onEvent('state', st => {
      if (entered) return;
      entered = true;
      box.classList.add('hidden');
      if (window.ONLINE_HOOKS) window.ONLINE_HOOKS.enter();
    });

    el('lobby-create').onclick = () => NET.send(CS.CREATE_ROOM);
    el('lobby-join').onclick = () => {
      const id = String((el('lobby-roomid').value || '')).trim().toUpperCase();
      if (!id) { msg.textContent = '请输入房间号'; return; }
      NET.send(CS.JOIN_ROOM, { roomId: id });
    };
    el('lobby-start').onclick = () => NET.send(CS.START_GAME);
    el('lobby-close').onclick = () => { box.classList.add('hidden'); NET.disconnect(); };
  }

  /* ---------------- 进入对局后的持续同步 ---------------- */
  function bindGameSync() {
    if (!window.ONLINE_HOOKS) return;
    NET.onEvent('state', st => window.ONLINE_HOOKS.applyState(st));
    NET.onEvent('over', info => window.ONLINE_HOOKS.over(info));
    // 进入对局后也要能看到服务端拒绝原因（例如“还没轮到你行动”），否则点了没反应却不知为何
    NET.onEvent('error', m => {
      try { window.alert('联机提示：' + (m || '操作失败')); } catch (e) {}
    });
    NET.onEvent('disconnect', () => {
      try { window.alert('与服务器断开连接，请检查网络后重连。'); } catch (e) {}
    });
  }

  /* ---------------- 入口 ---------------- */
  window.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btn-online');
    if (!b) return;
    // 桌面 exe（file://）没有联机服务端 → 隐藏该入口，避免误点
    if (location.protocol === 'file:') { b.style.display = 'none'; return; }
    b.addEventListener('click', () => window.startOnline());
  });

  window.startOnline = function () {
    loadScripts(['/protocol.js', '/socket.io/socket.io.js', 'js/net.js'])
      .then(async () => {
        let t = getToken(), me = null;
        if (t) {
          try {
            const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t } });
            if (r.ok) me = await r.json();
          } catch (e) { me = null; }
        }
        if (!me) {
          showAuth(async user => {
            await NET.connect(getToken(), user);
            bindGameSync();
            showLobby(user);
          });
        } else {
          await NET.connect(t, me.user);
          bindGameSync();
          showLobby(me.user);
        }
      })
      .catch(e => {
        try { window.alert('联机服务未启动或无法连接：' + (e && e.message)); } catch (_) {}
      });
  };
})();
