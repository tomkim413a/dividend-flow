/* ============================================================
 * online.js —— 联机入口（登录 / 注册 + 大厅 + 进入对局）
 *
 * 单机模式完全不参与：只有点了「联机对战」才会动态加载依赖，
 * 因此 exe / 本地网页版不受任何影响。
 * ============================================================ */
(function () {
  'use strict';
  const KEY = 'cf_online_token';
  const LAST_USER = 'cf_online_lastuser';

  const el = id => document.getElementById(id);
  /* token 存 sessionStorage（按标签页隔离）：
     若用 localStorage，同源的多个标签页会共享同一份 token，
     导致第二个窗口自动登录成同一个人，看起来像“能操控别的玩家”。
     用户名另外存 localStorage 只用于「自动填回输入框」，不含任何凭据。 */
  const getToken = () => { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } };
  const setToken = t => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch (e) {} };
  const getLastUser = () => { try { return localStorage.getItem(LAST_USER) || ''; } catch (e) { return ''; } };
  const setLastUser = n => { try { n ? localStorage.setItem(LAST_USER, n) : localStorage.removeItem(LAST_USER); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* 所有请求都必须带超时：fetch 默认永不超时，免费实例冷启动时一个挂在半路的
     /api/me 会让「点联机对战」后几十秒什么都不弹 —— 表现就是「按键点了没反应」。 */
  function fetchT(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 60000);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .finally(() => clearTimeout(timer));
  }

  async function post(p, body) {
    const once = () => fetchT(p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store'
    }, 30000).then(r => r.json());
    try {
      return await once();
    } catch (e) {
      // 隔 2 秒再试一次：立即重试会和第一次一起卡在同一次冷启动窗口里，毫无意义
      await new Promise(r => setTimeout(r, 2000));
      try {
        return await once();
      } catch (e2) {
        return { err: '连接超时，服务器可能仍在启动中，请稍后再试（已自动重试一次）' };
      }
    }
  }

  /* 三个脚本并行下载、按插入顺序执行。
     动态脚本设 async=false 后，浏览器会并行取回但保证按插入顺序执行，
     这样 net.js 依赖的 protocol.js / socket.io 一定先就绪。
     旧版是「等一个下完再下下一个」，跨境每次 1.2–2.4s，光加载就要 4–7 秒。 */
  function loadScripts(srcs) {
    return new Promise((resolve, reject) => {
      let left = srcs.length;
      const timer = setTimeout(() => reject(new Error('联机组件加载超时，请检查网络')), 30000);
      const done = () => { clearTimeout(timer); resolve(); };
      srcs.forEach(src => {
        if (document.querySelector('script[src="' + src + '"]')) { if (--left === 0) done(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => { if (--left === 0) done(); };
        s.onerror = () => { clearTimeout(timer); reject(new Error(src + ' 加载失败')); };
        document.head.appendChild(s);
      });
    });
  }

  /* 页面一打开就在后台并行完成「唤醒服务 + 加载联机组件」。
     点「联机对战」时通常早已就绪，用户只需等一次登录 POST + 一次 socket 握手。 */
  let readyPromise = null;
  function ensureReady() {
    if (readyPromise) return readyPromise;
    const health = fetchT('/api/health?wake=' + Date.now(), { cache: 'no-store' }, 75000)
      .then(r => r.ok).catch(() => false);
    const scripts = loadScripts(['/protocol.js', '/socket.io/socket.io.js', 'js/net.js']);
    readyPromise = Promise.all([health, scripts]).then(([alive]) => {
      if (!alive) throw new Error('服务器正在启动（免费实例首次唤醒约 30–60 秒），请稍后重试');
      return true;
    }).catch(e => { readyPromise = null; throw e; });   // 失败可重试，不缓存错误
    return readyPromise;
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
    fetchT('/api/health', { cache: 'no-store' }, 8000)
      .then(r => r.json()).then(h => {
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
      // 让浏览器正确区分「记住现有密码」和「保存新密码」
      p.autocomplete = (isReg || isSec) ? 'new-password' : 'current-password';
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
              : '账号存在服务器上不会丢；关闭标签页后需重新登录（可让浏览器记住密码）';
        show(hint, true);
      }

      say('');
      p.value = ''; p2.value = ''; secAns.value = '';
      if (isReg) { em.value = ''; secQ.value = ''; secA.value = ''; }
      if (prefill) u.value = prefill;
      else if (isLogin && !u.value.trim()) u.value = getLastUser();  // 记住上次登录的名字
      if (isSec) {
        secQText.textContent = '填写用户名后会自动显示你的密保问题';
        if (u.value.trim()) loadQuestion();
      }
    }

    submit.onclick = async () => {
      if (submit.disabled) return;                 // 防连点：一次只发一个请求
      if (mode === 'login') {
        submit.disabled = true;
        say('⏳ 正在登录…', true);
        const r = await post('/api/login', { username: u.value, password: p.value });
        submit.disabled = false;
        if (r.err) return say('❌ ' + r.err);
        setToken(r.token);
        setLastUser(u.value.trim());
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

    /* 页面一打开就并行预热：唤醒服务 + 把三个联机组件加载好（都不等）。
       用户看到界面、点「联机对战」、填完账号的这几秒里，实例和脚本早就是热的。 */
    setTimeout(() => { try { ensureReady().catch(() => {}); } catch (e) {} }, 400);

    /* 页面开着期间每 10 分钟 ping 一次，避免 15 分钟无请求被 Render 休眠。 */
    const ping = () => {
      if (document.visibilityState === 'visible') {
        try { fetchT('/api/health?ka=' + Date.now(), { cache: 'no-store' }, 8000).catch(() => {}); } catch (e) {}
      }
    };
    setInterval(ping, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ping(); });

    b.addEventListener('click', () => window.startOnline());
  });

  let starting = false;

  /* 登录成功后才真正需要网络。预热通常在用户填账号时就已完成，这里几乎 0 等待。 */
  function onLoggedIn(user) {
    const b = document.getElementById('btn-online');
    const label = b ? b.textContent : '';
    if (b) b.textContent = '⏳ 正在进入大厅…';
    return (async () => {
      try {
        await ensureReady();
        await NET.connect(getToken(), user);
        bindGameSync();
        showLobby(user);
      } catch (e) {
        try { window.alert('账号已登录，但联机连接失败：' + (e && e.message) + '\n请稍后再点「联机对战」重试。'); } catch (_) {}
      } finally {
        if (b) b.textContent = label;
      }
    })();
  }

  window.startOnline = async function () {
    if (starting) return;                          // 防连点
    starting = true;
    const b = document.getElementById('btn-online');
    const label = b ? b.textContent : '';
    const btnState = (text, disabled) => { if (b) { b.textContent = text; b.disabled = !!disabled; } };

    try {
      ensureReady().catch(() => {});               // 兜底：预热若还没启动，这里补上（不等它）

      const t = getToken();
      if (!t) {
        // 登录框是纯 DOM，立刻弹出 —— 用户不再盯着「正在连接服务器」干等
        showAuth(onLoggedIn);
        return;
      }

      // 有 token：恢复登录需要一次校验，但预热和 /api/me 并行发出
      btnState('⏳ 正在恢复登录…', true);
      const [, me] = await Promise.all([
        ensureReady(),
        fetchT('/api/me', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' }, 15000)
          .then(r => r.ok ? r.json() : null).catch(() => null)
      ]);
      if (!me) { setToken(null); showAuth(onLoggedIn); return; }   // token 过期 → 直接弹登录框
      await NET.connect(t, me.user);
      bindGameSync();
      showLobby(me.user);
    } catch (e) {
      try { window.alert('联机连接失败：' + (e && e.message) + '\n请稍后重试。'); } catch (_) {}
    } finally {
      starting = false;
      btnState(label, false);
    }
  };
})();
