/* ============================================================
 * online.js —— 联机入口（登录 / 注册 + 大厅 + 进入对局）· 稳定版
 *
 * 本版按线上实测回退到「简单可靠」的流程，刻意不再做任何预热/并行提速：
 *   1. 点「联机对战」→ 纯 DOM 立刻弹登录框，零网络、零脚本等待；
 *      （旧版先 await 唤醒服务 75s 并在按钮显示「正在连接服务器…」，
 *        在 Edge 等浏览器会直接报加载超时、登录框根本弹不出来）
 *   2. 联机组件在页面打开后于后台「顺序」加载，不阻塞任何界面；
 *      （并行 + async=false 在个别浏览器会乱序或误报加载超时）
 *   3. 登录成功 → 立刻显示大厅/房间功能，socket 握手在后台进行；
 *      （旧版要等握手成功才 showLobby，冷启动时房间迟迟不弹）
 *   4. 所有 fetch 仍带超时，socket 握手仍带超时，避免 Promise 永不结束。
 *
 * 单机模式完全不参与：只有点了「联机对战」才会动态加载依赖。
 * ============================================================ */
(function () {
  'use strict';
  const KEY = 'cf_online_token';
  const LAST_USER = 'cf_online_lastuser';

  const el = id => document.getElementById(id);
  const getToken = () => { try { return sessionStorage.getItem(KEY); } catch (e) { return null; } };
  const setToken = t => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch (e) {} };
  const getLastUser = () => { try { return localStorage.getItem(LAST_USER) || ''; } catch (e) { return ''; } };
  const setLastUser = n => { try { n ? localStorage.setItem(LAST_USER, n) : localStorage.removeItem(LAST_USER); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* 邀请链接 ?room=ABC123 只携带房间号；房间设置存在服务端，跟着房间走、不编码进 URL。
     invitePending 保证两条登录路径（无 token 弹登录框 / 有 token 校验 /api/me）都只发一次 JOIN。 */
  const INVITE_ROOM = (() => {
    let v = '';
    try {
      const search = (typeof location !== 'undefined' && location.search) ? String(location.search) : '';
      const m = /(?:^|[?&])room=([^&#]*)/.exec(search);
      if (m) v = decodeURIComponent(m[1]);
    } catch (e) { v = ''; }
    return /^[A-Z2-9]{6}$/i.test(v) ? v.toUpperCase() : '';
  })();
  let invitePending = !!INVITE_ROOM;
  let matchEnabled = false;

  function fallbackCopy(text) {
    try {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(t);
      lobbyMsg(ok ? '✅ 邀请链接已复制，发给朋友即可加入' : '⚠️ 复制失败，请手动复制：' + text, ok);
    } catch (e) { lobbyMsg('⚠️ 复制失败，请手动复制：' + text); }
  }

  function applyMatchUI() {
    const row = el('lobby-public-row'), title = el('lobby-open-title');
    if (row) row.style.display = matchEnabled ? '' : 'none';
    if (title) title.style.display = matchEnabled ? '' : 'none';
    if (matchEnabled && window.NET && NET.on)
      NET.send((window.CS && CS.LIST_ROOMS) || 'cs:listRooms');
    else { const ul = el('lobby-open-rooms'); if (ul) ul.innerHTML = ''; }
  }

  /* 所有请求都带超时：fetch 默认永不超时，冷启动时挂住会表现为「点了没反应」 */
  function fetchT(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 30000);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .finally(() => clearTimeout(timer));
  }

  /* 网络类失败统一给出可操作建议：实测开启本地代理时访问 onrender.com 会整体超时，
     关掉即恢复。以前只说「请稍后再试」，用户无从判断原因。 */
  const NET_HINT = '连不上服务器（已自动重试一次）。若电脑开了代理 / VPN / 加速器，请先关闭再试；也可能是服务器正在唤醒，稍后重试';

  async function post(p, body, ms) {
    const timeout = ms || 15000;
    const once = () => fetchT(p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      cache: 'no-store'
    }, timeout).then(r => r.json());
    try {
      return await once();
    } catch (e) {
      await new Promise(r => setTimeout(r, 1200));
      try {
        return await once();
      } catch (e2) {
        return { err: NET_HINT };
      }
    }
  }

  /* ---------------- 网络状态浮层 ----------------
     动态创建、不占 index.html；pointer-events:none 保证绝不挡住游戏按钮。 */
  let netToastEl = null;
  function netToast(text, ok, ms) {
    if (!text) {
      if (netToastEl) netToastEl.style.display = 'none';
      return;
    }
    if (!netToastEl) {
      const d = document.createElement('div');
      d.id = 'net-toast';
      d.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);'
        + 'z-index:99999;max-width:min(92vw,600px);padding:10px 16px;border-radius:10px;'
        + 'font:14px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif;'
        + 'box-shadow:0 6px 24px rgba(0,0,0,.3);pointer-events:none;'
        + 'text-align:center;white-space:normal;';
      if (document.body) document.body.appendChild(d);
      netToastEl = d;
    }
    netToastEl.textContent = text;
    netToastEl.style.display = 'block';
    netToastEl.style.background = ok ? '#12694a' : '#7d2b18';
    netToastEl.style.color = '#fff';
    netToastEl.style.border = '1px solid ' + (ok ? '#2fb37a' : '#d9613f');
    clearTimeout(netToastEl._hide);
    const delay = ms || (ok ? 3000 : 0);
    if (delay) netToastEl._hide = setTimeout(() => {
      if (netToastEl) netToastEl.style.display = 'none';
    }, delay);
  }

  /* ---------------- 联机组件：后台顺序加载 ----------------
     顺序加载最稳：protocol.js → socket.io → net.js，后者依赖前者的 CS/SC/io。
     全程后台、失败可重试，不再阻塞登录框，也不再弹「加载超时」alert。 */
  const SCRIPTS = ['/protocol.js?v=20261109c', '/socket.io/socket.io.js', 'js/net.js?v=20261109c'];
  let scriptsPromise = null;
  function loadScripts() {
    if (scriptsPromise) return scriptsPromise;
    scriptsPromise = SCRIPTS.reduce((prev, src) => prev.then(() => new Promise((res, rej) => {
      if (document.querySelector('script[src="' + src + '"]')) return res();
      const s = document.createElement('script');
      const timer = setTimeout(() => rej(new Error(src + ' 加载超时')), 25000);
      s.src = src;
      s.onload = () => { clearTimeout(timer); res(); };
      s.onerror = () => { clearTimeout(timer); rej(new Error(src + ' 加载失败')); };
      document.head.appendChild(s);
    })), Promise.resolve()).catch(e => { scriptsPromise = null; throw e; });
    return scriptsPromise;
  }

  /* ---------------- 大厅状态 ---------------- */
  let currentUser = null;
  let netPromise = null;
  let netEventsBound = false;      // 事件只注册一次，避免重复进出大厅累积监听
  let enteredGame = false;

  function lobbyMsg(text, ok) {
    const m = el('lobby-msg');
    if (!m) return;
    m.textContent = text || '';
    m.classList.toggle('ok', !!ok);
  }
  function showLobbyBox() { const b = el('lobby-overlay'); if (b) b.classList.remove('hidden'); }
  function hideLobbyBox() { const b = el('lobby-overlay'); if (b) b.classList.add('hidden'); }
  function setLobbyBusy(busy) {
    ['lobby-create', 'lobby-join', 'lobby-start'].forEach(id => {
      const b = el(id);
      if (b) b.disabled = !!busy || (id === 'lobby-start');
    });
    const p = el('lobby-prof'); if (p) p.disabled = !!busy;
    // 重试按钮只在连接失败时由 setLobbyFailed 显式显示；连接中/已连上都隐藏
    const r = el('lobby-retry'); if (r) r.classList.add('hidden');
  }
  /* 连接失败：按钮尚未绑定事件，必须禁用，避免点了没反应；只开放重试 */
  function setLobbyFailed() {
    ['lobby-create', 'lobby-join', 'lobby-start'].forEach(id => {
      const b = el(id); if (b) b.disabled = true;
    });
    const p = el('lobby-prof'); if (p) p.disabled = true;
    const r = el('lobby-retry'); if (r) r.classList.remove('hidden');
  }

  /* 连接 socket（后台）。成功后才绑定大厅按钮与事件，避免脚本未就绪时报错 */
  function connectNet() {
    if (netPromise) return netPromise;
    lobbyMsg('⏳ 正在连接房间服务…');
    setLobbyBusy(true);
    netPromise = loadScripts()
      .then(() => {
        if (!window.NET) throw new Error('联机组件未就绪，请刷新页面');
        /* 邀请链接：必须在 NET.connect() 之前清掉上次的房间号，否则 connect 事件
           会先发 CS.RESUME 回旧房，一个 socket 同时 join 两个房间，currentRoomId 取错。 */
        if (invitePending) {
          try { sessionStorage.removeItem('cf_online_room'); } catch (e) {}
          if (window.NET) NET.room = null;
        }
        return NET.connect(getToken(), currentUser);
      })
      .then(() => {
        bindNetEvents();
        bindLobbyButtons();
        applyMatchUI();
        setLobbyBusy(false);
        lobbyMsg('');
        if (invitePending) {
          invitePending = false;
          NET.send((window.CS && CS.JOIN_ROOM) || 'cs:joinRoom',
            { roomId: INVITE_ROOM, prof: el('lobby-prof') ? el('lobby-prof').value : '' });
          try {
            const u = new URL(location.href);
            u.searchParams.delete('room');
            history.replaceState(null, '', u.pathname + u.search);
          } catch (e) {}   // 清参数失败不影响已发出的 JOIN_ROOM
        }
        return NET;
      })
      .catch(e => {
        netPromise = null;                       // 允许「重试连接」再试一次
        setLobbyFailed();
        const msg = (e && e.message) || '连接失败';
        lobbyMsg('⚠️ ' + msg + '，可点「重试连接」。若开了代理 / VPN 请先关闭');
        throw e;
      });
    return netPromise;
  }

  /* ---------------- 登录 / 注册 / 找回密码 ---------------- */
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

    /* 邮件找回默认隐藏：只有服务端确认发信通道可用才显示入口 */
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
      show(p, !isMail);
      p.placeholder = isSec ? '新密码（至少 4 位）' : '密码（至少 4 位）';
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
      else if (isLogin && !u.value.trim()) u.value = getLastUser();
      if (isSec) {
        secQText.textContent = '填写用户名后会自动显示你的密保问题';
        if (u.value.trim()) loadQuestion();
      }
    }

    submit.onclick = async () => {
      if (submit.disabled) return;
      if (mode === 'login') {
        submit.disabled = true;
        say('⏳ 正在登录…', true);
        const r = await post('/api/login', { username: u.value, password: p.value }, 12000);
        submit.disabled = false;
        if (r.err) return say('❌ ' + r.err);
        setToken(r.token);
        setLastUser(u.value.trim());
        say('✅ 登录成功，正在进入…', true);
        box.classList.add('hidden');
        onOk(r.user);                          // 立刻显示大厅，不等 socket
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

    u.addEventListener('blur', () => { if (mode === 'forgot') loadQuestion(); });
    u.addEventListener('input', () => {
      if (mode === 'forgot') secQText.textContent = '填写用户名后会自动显示你的密保问题';
    });

    setMode('login');
  }

  /* ---------------- 大厅（先显示 DOM，连上后再绑事件） ---------------- */
  function showLobby(user) {
    currentUser = user || currentUser;
    enteredGame = false;
    showLobbyBox();
    const roomNo = el('lobby-roomno'), seats = el('lobby-seats');
    if (roomNo) roomNo.textContent = '—';
    if (seats) seats.innerHTML = '';
    lobbyMsg('⏳ 正在连接房间服务…');
    setLobbyBusy(true);
    const cap0 = el('lobby-seatcap'), ai0 = el('lobby-aicount'), pub0 = el('lobby-public');
    if (cap0) cap0.value = '4';
    if (ai0) ai0.value = 'auto';
    if (pub0) pub0.checked = false;
    const cfgHint0 = el('lobby-cfg-hint');
    if (cfgHint0) cfgHint0.textContent = '房主可设置本局家数与电脑数；默认与原版一致（4 家自动补满）';

    /* 房间速度：联机由服务端权威引擎决定，客户端只发指令 + 同步显示。
       setHandler 让三个速度下拉（开始界面 / 顶栏 / 大厅）统一走网络分支。 */
    if (window.SpeedUI) {
      SpeedUI.disable(['lobby-speed', 'game-speed'], false);
      SpeedUI.setHandler(key => {
        const sock = window.NET;
        // protocol.js 是后台加载的，大厅刚弹出时 CS 可能还没就绪 → 用字面量兜底
        const type = (window.CS && CS.SET_SPEED) || 'cs:setSpeed';
        if (!sock || !sock.on) {
          SpeedUI.rollback();
          lobbyMsg('⏳ 房间服务连接中，连上后再调速度');
          return;
        }
        SpeedUI.applyLocal(key, false);       // 乐观更新（不写本机存档），等广播校准
        if (!sock.send(type, { speed: key })) {
          SpeedUI.rollback();
          lobbyMsg('⚠️ 网络不稳，速度未改，请稍后重试');
        }
      });
    }

    // 职业下拉：随机 + 全部职业（只依赖 data.js，不依赖联机脚本）
    const profSel = el('lobby-prof');
    if (profSel && window.CF && CF.PROFESSIONS) {
      profSel.innerHTML = '<option value="">🎲 随机职业</option>' +
        CF.PROFESSIONS.map(p => `<option value="${p.id}">${p.icon} ${p.name}</option>`).join('');
      try { const s = sessionStorage.getItem('cf_online_prof'); if (s) profSel.value = s; } catch (e) {}
    }

    el('lobby-close').onclick = () => {
      if (inOnlineGame()) { askGiveUp(() => doGiveUp()); return; }
      leaveToLocal();
    };
    const retry = el('lobby-retry');
    if (retry) retry.onclick = () => {
      /* 掉线后 socket 实例还在：直接重启它的重连循环，不新建连接、不重复绑事件 */
      if (window.NET && NET.connectedOnce && NET.reconnect()) {
        netToast('⏳ 正在重新连接…', false);
        setLobbyBusy(true);
        setTimeout(() => {
          if (NET.on) return;
          setLobbyFailed();
          netToast('⏳ 仍未连上：请关闭代理 / VPN 后刷新页面重试', false);
        }, 8000);
        return;
      }
      netPromise = null;
      connectNet().catch(() => {});
    };

    // 老账号补设密保问题（纯 HTTP，不依赖 socket）
    const secBtn = el('lobby-sec');
    if (secBtn) secBtn.onclick = async () => {
      const q = window.prompt('设置密保问题（忘记密码时用它自助重置）\n例：我的第一只宠物叫什么');
      if (q === null) return;
      if (q.trim().length < 2) { lobbyMsg('⚠️ 密保问题至少 2 个字'); return; }
      const a = window.prompt('密保答案（一定要记住，不区分大小写）');
      if (a === null) return;
      if (a.trim().length < 2) { lobbyMsg('⚠️ 密保答案至少 2 个字'); return; }
      try {
        const r = await fetch('/api/account/security', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (getToken() || '') },
          body: JSON.stringify({ secQ: q.trim(), secA: a.trim() })
        });
        const j = await r.json().catch(() => ({}));
        lobbyMsg(j.err ? '⚠️ ' + j.err : '✅ 密保问题已保存，忘记密码时可用它重置', !j.err);
      } catch (e) {
        lobbyMsg('⚠️ 网络错误，请稍后重试');
      }
    };
  }

  /* ---------------- 确认式主动放弃：掉线 ≠ 主动退出 ----------------
     · 掉线：服务端只在 disconnect 里 leaveRoom（座位托管 AI、不打标记），
       重连发 CS.RESUME 就能回到真人座位，绝不弹这里的对话框。
     · 只有用户主动点「离开 / 退出」并在确认框点「确定放弃」，才发 CS.GIVE_UP。
     · 用 DOM 对话框而不是 window.confirm：confirm 会冻结主线程，联机对局中
       会让 socket 收包与引擎定时器一起停摆，看起来就是画面卡住。
     · 放弃只标记座位并交给 AI 跑到终局，不改人数 / 资产 / 胜负规则。 */
  function inOnlineGame() {
    return !!(window.NET && NET.on && NET.room && NET.room.started);
  }
  let giveupAction = null;
  function closeGiveUp() {
    const b = el('giveup-overlay');
    if (b) b.classList.add('hidden');
    giveupAction = null;
  }
  function askGiveUp(fn) {
    const b = el('giveup-overlay');
    if (!b || !inOnlineGame()) { if (fn) fn(); return; }
    giveupAction = fn;
    b.classList.remove('hidden');
  }
  function leaveToLocal() {
    hideLobbyBox();
    if (window.NET) NET.disconnect();
    netPromise = null;
    enteredGame = false;
    netToast('');
    // 回到单机：清掉联机 handler、恢复玩家自己的单机档位
    if (window.SpeedUI) {
      SpeedUI.restoreLocal();
      SpeedUI.disable(['lobby-speed', 'game-speed'], false);
    }
  }
  function doGiveUp(after) {
    const net = window.NET;
    const type = (window.CS && CS.GIVE_UP) || 'cs:giveUp';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      leaveToLocal();
      if (after) after();
    };
    if (!net || !net.on || !net.socket) {
      netToast('网络已断开，放弃状态可能未同步；重连后仍可回到座位', false, 4000);
      finish();
      return;
    }
    /* ack 等服务端确认「放弃已登记」再断开，避免 disconnect 丢掉未送达的包 */
    net.socket.emit(type, {}, res => {
      if (res && res.ok === false) netToast('⚠️ ' + (res.msg || '放弃未生效'), false, 4000);
      finish();
    });
    setTimeout(finish, 1800);   // ack 丢失兜底，不把用户困在对话框里
  }
  function bindGiveUpDialog() {
    const c = el('giveup-cancel'), f = el('giveup-confirm');
    if (c) c.onclick = () => closeGiveUp();
    if (f) f.onclick = () => { const fn = giveupAction; closeGiveUp(); if (fn) fn(); };
  }
  function interceptExitButtons() {
    ['btn-quit', 'btn-exit'].forEach(id => {
      const b = el(id);
      if (!b) return;
      /* 捕获阶段拦截：挡住 render.js 里「直接 reload / window.confirm」的冒泡 handler，
         完全不用改单机共用的 render.js */
      b.addEventListener('click', e => {
        if (!inOnlineGame()) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        askGiveUp(() => doGiveUp(() => location.reload()));
      }, true);
    });
  }

  /* socket 连上后：注册房间/错误/状态事件，并启用全部按钮 */
  /* socket 事件只注册一次。断线重连后 NET 对象仍在，无需重复绑定。 */
  function bindNetEvents() {
    if (netEventsBound) return;
    if (!window.NET) return;
    netEventsBound = true;

    NET.onEvent('room', r => {
      if (!r) return;
      const roomNo = el('lobby-roomno'), seats = el('lobby-seats');
      if (roomNo) roomNo.textContent = r.id;
      if (seats) seats.innerHTML = (r.seats || []).map(s => {
        const pr = (window.CF && CF.PROFESSIONS || []).find(x => x.id === s.prof);
        return `<li>${esc(s.name)}${s.ai ? ' <small>（电脑）</small>' : ''}` +
          `${pr ? ` <small>${pr.icon} ${pr.name}</small>` : ''}</li>`;
      }).join('');
      const start = el('lobby-start');
      const isHost = !!(currentUser && r.hostId === currentUser.id);
      if (start) start.disabled = !isHost;
      /* 房间设置以服务端为准；非房主 / 已开局一律置灰 */
      const cap = el('lobby-seatcap'), ai = el('lobby-aicount'), pub = el('lobby-public');
      const capV = String(r.seatCap || 4);
      const aiV = (r.aiCount == null || r.aiCount < 0) ? 'auto' : String(r.aiCount);
      if (cap) { cap.value = capV; cap.disabled = !isHost || !!r.started; }
      if (ai) { ai.value = aiV; ai.disabled = !isHost || !!r.started; }
      if (pub) { pub.checked = r.visibility === 'public'; pub.disabled = !isHost || !!r.started; }
      const humans = (r.seats || []).filter(s => s && s.userId).length;
      const humanCap = Number(r.humanCap) || Number(capV);
      const left = Math.max(0, humanCap - humans);
      const h = el('lobby-cfg-hint');
      if (h) h.textContent = `本局 ${capV} 家 · 电脑 ${aiV === 'auto' ? '自动补满' : aiV + ' 家'} · 真人 ${humans}/${humanCap}`
        + (r.started ? ' · 对局进行中' : ` · 还可进 ${left} 人`);
      const inv = el('lobby-invite');
      if (inv) {
        inv.disabled = !r.id || !!r.started || left === 0;
        inv.textContent = left === 0 ? '📋 真人位已满' : `📋 复制邀请（还可进 ${left} 人）`;
      }
      // 房间速度以服务端为准：广播回来后校准三个下拉，避免各客户端显示不一致
      if (window.SpeedUI) {
        if (r.speed) SpeedUI.syncFromServer(r.speed);
        // 对局中仅房主可调；未开局时房间内人人可设
        SpeedUI.disable(['lobby-speed', 'game-speed'], !!r.started && !isHost);
      }
      lobbyMsg('');
    });

    NET.onEvent('error', m => {
      const box = el('lobby-overlay');
      const text = '⚠️ ' + (m || '操作失败');
      if (box && !box.classList.contains('hidden')) lobbyMsg(text);
      /* ★ 对局中绝不用 window.alert：它会冻结浏览器主线程，引擎定时器、
         socket 收包和所有按钮一起停摆，用户看到的就是「画面卡住」。 */
      else netToast(text, false, 3500);
      if (matchEnabled && /真人位已满|房间已满|对局已开始|房间不存在/.test(String(m || '')))
        NET.send((window.CS && CS.LIST_ROOMS) || 'cs:listRooms');
    });

    NET.onEvent('roomList', list => {
      /* 开关状态只由 /api/health 决定：开关关闭时服务端回的是空数组，
         空数组在 JS 里是 truthy，不能据此把 UI 切成「已开启」，
         否则 health 超时时会出现无标题、无勾选框的孤立列表。 */
      if (!matchEnabled) return;
      const ul = el('lobby-open-rooms'), box = el('lobby-overlay');
      if (!ul || !matchEnabled || !box || box.classList.contains('hidden')) return;
      const rows = Array.isArray(list) ? list : [];
      if (!rows.length) {
        ul.innerHTML = '<li><small>暂无公开房间，可自己建一间并勾选「公开房间」</small></li>';
        return;
      }
      ul.innerHTML = rows.map(r =>
        `<li>${esc(r.id)} · 真人 ${r.count}/${r.humanCap} · ${r.speed === 'slow' ? '🐢 慢速' : '⚡ 快速'}` +
        ` <button class="btn sm" type="button" data-join-room="${esc(r.id)}">加入</button></li>`).join('');
      ul.querySelectorAll('[data-join-room]').forEach(b => {
        b.onclick = () => {
          const target = b.getAttribute('data-join-room');
          const cur = window.NET && NET.room && NET.room.id;
          /* 已在别的房间：socket.join 不会自动退旧房，必须先发现有的 LEAVE_ROOM */
          if (cur && cur !== target) NET.send((window.CS && CS.LEAVE_ROOM) || 'cs:leaveRoom');
          NET.send((window.CS && CS.JOIN_ROOM) || 'cs:joinRoom',
            { roomId: target, prof: el('lobby-prof') ? el('lobby-prof').value : '' });
        };
      });
    });

    NET.onEvent('state', st => {
      // 首次收到对局状态 → 收起大厅、进入对局画面
      const box = el('lobby-overlay');
      if (!enteredGame && box && !box.classList.contains('hidden')) {
        enteredGame = true;
        NET.onlineMode = true;        // 进入联机对局：断线时禁止回落到本地引擎
        hideLobbyBox();
        if (window.ONLINE_HOOKS) window.ONLINE_HOOKS.enter();
      }
      if (window.ONLINE_HOOKS) window.ONLINE_HOOKS.applyState(st);
    });

    NET.onEvent('over', info => {
      netToast('');
      if (window.ONLINE_HOOKS) window.ONLINE_HOOKS.over(info);
    });

    /* ---------------- 断线 / 重连：全程可见，绝不静默 ----------------
       旧版掉线后没有任何提示，NET.on 还一直是 false，玩家点按钮毫无反应，
       看起来就是「玩到一半卡住走不了」。 */
    NET.onEvent('disconnect', () => {
      netToast('⚠️ 网络中断，正在自动重连…（若开了代理 / VPN，建议关闭）', false);
      const box = el('lobby-overlay');
      if (box && !box.classList.contains('hidden')) setLobbyBusy(true);
    });

    NET.onEvent('reconnecting', () => {
      netToast('⚠️ 网络不稳，正在重连，请稍等…', false);
    });

    NET.onEvent('reconnect', () => {
      netToast('✅ 网络已恢复，正在同步对局…', true);
      const box = el('lobby-overlay');
      if (box && !box.classList.contains('hidden')) { setLobbyBusy(false); lobbyMsg(''); }
    });

    NET.onEvent('reconnect_failed', () => {
      netToast('❌ 重连失败：请关闭代理 / VPN，然后点「重试连接」或刷新页面', false);
      setLobbyFailed();
      showLobbyBox();                 // 给出可点击的恢复入口，不弹阻塞 alert
      lobbyMsg('⚠️ 连接已断开。可点「重试连接」；账号与对局在服务端，不会丢');
    });

    NET.onEvent('offline-action', () => {
      netToast('⏳ 网络恢复中，操作暂未发送；请等连接恢复后再点', false);
    });
  }

  /* 按钮需要 CS/SC 常量，等组件加载完再绑（DOM 早已显示，用户无感） */
  function bindLobbyButtons() {
    const profVal = () => (el('lobby-prof') ? el('lobby-prof').value : '');
    const profSel = el('lobby-prof');
    if (profSel) profSel.onchange = () => {
      try { sessionStorage.setItem('cf_online_prof', profSel.value); } catch (e) {}
      NET.send(CS.SET_PROF, { prof: profSel.value });
    };
    const cfgNow = () => ({
      seatCap: el('lobby-seatcap') ? el('lobby-seatcap').value : '4',
      aiCount: el('lobby-aicount') ? el('lobby-aicount').value : 'auto',
      visibility: el('lobby-public') && el('lobby-public').checked ? 'public' : 'private'
    });
    el('lobby-create').onclick = () => NET.send(CS.CREATE_ROOM, Object.assign({
      prof: profVal(),
      speed: window.SpeedUI ? SpeedUI.current() : undefined   // 建房时把当前档位带上去
    }, cfgNow()));
    ['lobby-seatcap', 'lobby-aicount', 'lobby-public'].forEach(id => {
      const n = el(id);
      if (n) n.onchange = () => {
        if (window.NET && NET.room && NET.room.id)
          NET.send((window.CS && CS.SET_ROOM_CFG) || 'cs:setRoomCfg', cfgNow());
        else lobbyMsg('先建房或加入房间，再调整房间设置');
      };
    });
    const invBtn = el('lobby-invite');
    if (invBtn) invBtn.onclick = () => {
      const id = window.NET && NET.room && NET.room.id;
      if (!id) { lobbyMsg('请先建房'); return; }
      const url = location.origin + location.pathname + '?room=' + encodeURIComponent(id);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
          .then(() => lobbyMsg('✅ 邀请链接已复制，发给朋友即可加入', true), () => fallbackCopy(url));
      } else fallbackCopy(url);
    };
    el('lobby-join').onclick = () => {
      const id = String((el('lobby-roomid').value || '')).trim().toUpperCase();
      if (!id) { lobbyMsg('请输入房间号'); return; }
      NET.send(CS.JOIN_ROOM, { roomId: id, prof: profVal() });
    };
    el('lobby-start').onclick = () => NET.send(CS.START_GAME);
  }

  /* ---------------- 登录成功：立刻显示大厅，后台连接 ---------------- */
  function onLoggedIn(user) {
    showLobby(user);                          // ★ 房间功能零等待弹出
    connectNet().catch(() => {});             // 握手放后台，不挡界面
  }

  /* ---------------- 入口 ---------------- */
  window.addEventListener('DOMContentLoaded', () => {
    bindGiveUpDialog();
    interceptExitButtons();
    const b = document.getElementById('btn-online');
    if (!b) return;
    if (location.protocol === 'file:') { b.style.display = 'none'; return; }

    /* 页面打开后后台做两件轻事：顺序加载联机组件 + 唤醒服务。
       都不等待、都不改按钮文字、都不弹任何提示，因此不会造成加载超时。 */
    setTimeout(() => {
      try { loadScripts().catch(() => {}); } catch (e) {}
      try {
        fetchT('/api/health?boot=' + Date.now(), { cache: 'no-store' }, 8000)
          .then(r => r.json()).then(j => { matchEnabled = !!(j && j.matchEnabled); applyMatchUI(); })
          .catch(() => {});
      } catch (e) {}
    }, 300);

    /* 页面开着期间每 10 分钟 ping 一次，避免 15 分钟无请求被 Render 休眠 */
    const ping = () => {
      if (document.visibilityState === 'visible') {
        try { fetchT('/api/health?ka=' + Date.now(), { cache: 'no-store' }, 8000).catch(() => {}); } catch (e) {}
      }
    };
    setInterval(ping, 10 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ping(); });

    b.addEventListener('click', () => window.startOnline());
    /* 邀请链接：等价于自动点一次「联机对战」，登录态分叉由 invitePending 统一收口 */
    if (INVITE_ROOM) setTimeout(() => window.startOnline(), 0);
  });

  let starting = false;

  window.startOnline = function () {
    if (starting) return;
    starting = true;
    try {
      loadScripts().catch(() => {});           // 后台补加载，绝不等它

      const t = getToken();
      if (!t) {
        showAuth(onLoggedIn);                  // ★ 纯 DOM，零等待弹登录框
        return;
      }

      /* 已有 token：乐观先把大厅显示出来，后台校验 token 并连接。
         只有服务端明确返回 401 才清 token 退回登录框；超时/网络错误保留登录态。 */
      showLobby({ id: null, username: getLastUser() || '…' });
      lobbyMsg('⏳ 正在恢复登录…');
      (async () => {
        try {
          const r = await fetchT('/api/me', {
            headers: { Authorization: 'Bearer ' + t }, cache: 'no-store'
          }, 12000);
          if (r.status === 401) { setToken(null); hideLobbyBox(); showAuth(onLoggedIn); return; }
          if (!r.ok) throw new Error('服务器暂时无响应');
          const me = await r.json();
          if (!me || !me.user) { setToken(null); hideLobbyBox(); showAuth(onLoggedIn); return; }
          currentUser = me.user;
          await connectNet();
        } catch (e) {
          setLobbyFailed();
          lobbyMsg('⚠️ ' + ((e && e.message) || '连接失败') + '，可点「重试连接」。若开了代理 / VPN 请先关闭');
        }
      })();
    } finally {
      starting = false;
    }
  };
})();
