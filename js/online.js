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

  /* ---------------- 登录 / 注册 / 找回密码 ----------------
     找回密码两条通道：
       · 密保问题（默认，不依赖邮件，永远可用）
       · 邮箱重置邮件（需要可靠的发信通道，可能进垃圾箱）   */
  function showAuth(onOk) {
    const box = el('auth-overlay');
    if (!box) return;
    box.classList.remove('hidden');

    const title = el('auth-title'), u = el('auth-user'), em = el('auth-email');
    const p = el('auth-pass'), p2 = el('auth-pass2'), msg = el('auth-msg');
    const secQ = el('auth-secq'), secA = el('auth-seca');
    const secBox = el('auth-secbox'), secQText = el('auth-secq-text'), secAns = el('auth-secans');
    const submit = el('auth-submit'), switcher = el('auth-switch'), forgotBtn = el('auth-forgot');
    let mode = 'login';

    /* 邮件找回默认对玩家隐藏：只有服务端确认发信通道真的可用（MAIL_ENABLED=true）才显示入口。
       否则会出现「提示已发送但邮件被 QQ/163 拒收」的假成功——那正是本项目最初的故障。
       拿不到 health 时保持隐藏，密保问题找回始终可用。 */
    let mailEnabled = false;
    fetch('/api/health').then(r => r.json()).then(h => {
      if (!h || !h.mailEnabled) return;
      mailEnabled = true;
      if (mode === 'forgot') show(forgotBtn, true);
    }).catch(() => {});

    const say = (text, ok) => {
      msg.textContent = text || '';
      msg.classList.toggle('ok', !!ok);
    };
    const show = (node, on) => { if (node) node.classList.toggle('hidden', !on); };

    /* 取密保问题（只在"密保找回"模式用） */
    async function loadQuestion() {
      const name = u.value.trim();
      if (!name) { secQText.textContent = '请先填写用户名'; return; }
      secQText.textContent = '正在获取密保问题…';
      const r = await post('/api/recover/question', { username: name });
      secQText.textContent = r.err ? '⚠️ ' + r.err : '密保问题：' + r.q;
    }

    function setMode(m, prefill) {
      mode = m;
      const isLogin = m === 'login', isReg = m === 'register';
      const isSec = m === 'forgot', isMail = m === 'forgotmail';
      const isForgot = isSec || isMail;

      title.textContent = isLogin ? '🌐 联机登录'
        : isReg ? '📝 注册账号'
          : isSec ? '🔑 密保问题找回' : '📧 邮箱找回密码';

      show(u, true);
      u.placeholder = isForgot ? '用户名（必填）' : '用户名（最长 16 字）';
      show(em, isReg || isMail);
      show(p, !isMail);                       // 登录/注册 = 密码；密保找回 = 新密码
      p.placeholder = isSec ? '新密码（至少 4 位）' : '密码（至少 4 位）';
      show(p2, isReg || isSec);
      p2.placeholder = isSec ? '确认新密码' : '确认密码';
      show(secQ, isReg);
      show(secA, isReg);
      show(secBox, isSec);
      show(forgotBtn, isLogin || isMail || (isSec && mailEnabled));
      forgotBtn.textContent = isSec ? '改用邮箱' : '忘记密码';
      submit.textContent = isLogin ? '登录' : isReg ? '注册' : isSec ? '重置密码' : '发送重置邮件';
      switcher.textContent = isLogin ? '去注册' : '返回登录';

      const hint = el('auth-hint');
      if (hint) {
        hint.textContent = isReg ? '密保问题用于忘记密码时自助重置，不依赖邮箱，请填个好记的'
          : isSec ? '答对了就能直接设置新密码；答案不区分大小写'
            : isMail ? '收不到邮件？可以直接用「改用密保」重置，更可靠'
              : '';
        show(hint, isReg || isForgot);
      }

      say('');
      p.value = ''; p2.value = ''; secAns.value = '';
      if (isReg) { em.value = ''; secQ.value = ''; secA.value = ''; }
      if (prefill) u.value = prefill;
      if (isSec) {
        secQText.textContent = '填写用户名后会自动显示你的密保问题';
        if (u.value.trim()) loadQuestion();
      }
    }

    submit.onclick = async () => {
      if (mode === 'login') {
        const r = await post('/api/login', { username: u.value, password: p.value });
        if (r.err) return say('❌ ' + r.err);
        setToken(r.token);
        say('✅ 登录成功，正在进入…', true);
        setTimeout(() => { box.classList.add('hidden'); onOk(r.user); }, 700);
        return;
      }

      if (mode === 'register') {
        if (!u.value.trim()) return say('❌ 请填写用户名');
        if (!em.value.trim()) return say('❌ 请填写邮箱');
        if (!secQ.value.trim()) return say('❌ 请填写密保问题（例：我的第一只宠物叫什么）');
        if (!secA.value.trim()) return say('❌ 请填写密保答案（忘记密码时要靠它）');
        if (p.value !== p2.value) return say('❌ 两次输入的密码不一致');
        if (p.value.length < 4) return say('❌ 密码至少 4 位');
        submit.disabled = true;
        const r = await post('/api/register', {
          username: u.value, email: em.value.trim(), password: p.value,
          secQ: secQ.value.trim(), secA: secA.value.trim()
        });
        submit.disabled = false;
        if (r.err) return say('❌ ' + r.err);
        // 注册成功 → 回到登录界面（不自动登录）
        setMode('login', u.value.trim());
        say('✅ 注册成功，请用刚才的账号登录', true);
        return;
      }

      if (mode === 'forgot') {
        if (!u.value.trim()) return say('❌ 请先填写用户名');
        if (!secAns.value.trim()) return say('❌ 请填写密保答案');
        if (p.value.length < 4) return say('❌ 新密码至少 4 位');
        if (p.value !== p2.value) return say('❌ 两次输入的密码不一致');
        submit.disabled = true;
        const r = await post('/api/recover/reset', {
          username: u.value.trim(), answer: secAns.value, password: p.value
        });
        submit.disabled = false;
        if (r.err) return say('❌ ' + r.err);
        setMode('login', u.value.trim());
        say('✅ 密码已重置，请用新密码登录', true);
        return;
      }

      // 邮箱找回
      if (!em.value.trim()) return say('❌ 请填写注册时用的邮箱');
      const r = await post('/api/forgot', { email: em.value.trim(), username: u.value.trim() });
      if (r.err) return say('❌ ' + r.err);
      let tip = '✅ 如果该账号存在，重置邮件已发送，请查收（含垃圾箱）';
      if (r.warn) tip += '；⚠️ ' + r.warn;
      say(tip, true);
      if (r.devLink) console.log('[dev] 重置链接：', r.devLink);
    };

    switcher.onclick = () => setMode(mode === 'login' ? 'register' : 'login', u.value.trim());
    forgotBtn.onclick = () => setMode(mode === 'forgot' ? 'forgotmail' : 'forgot', u.value.trim());
    el('auth-close').onclick = () => box.classList.add('hidden');

    // 改用户名后重新取密保问题，避免对着别人的问题答答案
    u.addEventListener('blur', () => { if (mode === 'forgot') loadQuestion(); });
    u.addEventListener('input', () => {
      if (mode === 'forgot') secQText.textContent = '填写用户名后会自动显示你的密保问题';
    });

    setMode('login');
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

    // 老账号补设密保问题（邮箱功能上线前注册的账号没有，忘记密码就只能找管理员）
    const secBtn = el('lobby-sec');
    if (secBtn) secBtn.onclick = async () => {
      const q = window.prompt('设置密保问题（忘记密码时用它自助重置）\n例：我的第一只宠物叫什么');
      if (q === null) return;
      if (q.trim().length < 2) { msg.textContent = '⚠️ 密保问题至少 2 个字'; return; }
      const a = window.prompt('密保答案（一定要记住，不区分大小写）');
      if (a === null) return;
      if (a.trim().length < 2) { msg.textContent = '⚠️ 密保答案至少 2 个字'; return; }
      try {
        const r = await fetch('/api/account/security', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getToken() || '') },
          body: JSON.stringify({ secQ: q.trim(), secA: a.trim() })
        });
        const j = await r.json().catch(() => ({}));
        msg.textContent = j.err ? '⚠️ ' + j.err : '✅ 密保问题已保存，忘记密码时可用它重置';
      } catch (e) {
        msg.textContent = '⚠️ 网络错误，请稍后重试';
      }
    };
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
