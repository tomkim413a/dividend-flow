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
    const once = () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);   // 免费实例冷启动可能要 30–60s
      return fetch(p, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: ctrl.signal
      }).finally(() => clearTimeout(timer));
    };
    try {
      return await (await once()).json();
    } catch (e) {
      // 网络失败/超时（常见于免费实例休眠后唤醒）→ 自动重试一次
      try {
        return await (await once()).json();
      } catch (e2) {
        return { err: '服务器正在唤醒或网络不稳，请等 30–60 秒后重试' };
      }
    }
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

    // 职业下拉：随机 + 全部职业（选项来自 data.js）
    const profSel = el('lobby-prof');
    if (profSel && window.CF && CF.PROFESSIONS) {
      profSel.innerHTML = '<option value="">🎲 随机职业</option>' +
        CF.PROFESSIONS.map(p => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join('');
      try { const s = sessionStorage.getItem('cf_online_prof'); if (s) profSel.value = s; } catch (e) {}
      profSel.onchange = () => {
        try { sessionStorage.setItem('cf_online_prof', profSel.value); } catch (e) {}
        NET.send(CS.SET_PROF, { prof: profSel.value });   // 已在房间内则同步给服务端
      };
    }

    NET.onEvent('room', r => {
      if (!r) return;
      roomNo.textContent = r.id;
      seats.innerHTML = (r.seats || []).map(s => {
        const pr = (window.CF && CF.PROFESSIONS || []).find(x => x.id === s.prof);
        return `<li>${esc(s.name)}${s.ai ? ' <small>（电脑）</small>' : ''}` +
          `${pr ? ` <small>${pr.icon} ${pr.name}</small>` : ''}</li>`;
      }).join('');
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

    const profVal = () => (el('lobby-prof') ? el('lobby-prof').value : '');
    el('lobby-create').onclick = () => NET.send(CS.CREATE_ROOM, { prof: profVal() });
    el('lobby-join').onclick = () => {
      const id = String((el('lobby-roomid').value || '')).trim().toUpperCase();
      if (!id) { msg.textContent = '请输入房间号'; return; }
      NET.send(CS.JOIN_ROOM, { roomId: id, prof: profVal() });
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
    // 提前唤醒服务端：免费实例休眠后首次请求要 30–60 秒，先在后台 ping 一下
    try { fetch('/api/health', { cache: 'no-store' }).catch(() => {}); } catch (e) {}
    b.addEventListener('click', () => window.startOnline());
  });

  window.startOnline = function () {
    loadScripts(['/protocol.js', '/socket.io/socket.io.js', 'js/net.js'])
      .then(async () => {
        let t = getToken(), me = null;
        if (t) {
          try {
            const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' });
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
