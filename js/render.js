/* ============================================================
 * render.js —— 界面渲染与交互（股票现金流版）
 * ============================================================ */
(function () {
  'use strict';
  const CF = window.CF, Engine = window.Engine;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = CF.money;

  /* ================= 迷你走势图 ================= */
  // 由股价历史 hist（各历史时点价）拼上当前价 cur 画折线；hist 不足 2 点返回空。
  const SPK_W = 40, SPK_H = 13;
  function sparkHTML(hist, cur) {
    const arr = hist && hist.length ? hist.concat([cur]) : null;
    if (!arr || arr.length < 2) return '';
    const min = Math.min.apply(null, arr), max = Math.max.apply(null, arr);
    const span = (max - min) || 1;
    const n = arr.length - 1;
    const pts = arr.map((v, i) => {
      const x = (i / n) * SPK_W;
      const y = (SPK_H - 2.5) - ((v - min) / span) * (SPK_H - 5);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const up = cur >= hist[hist.length - 1];
    return `<svg class="spark spark-${up ? 'up' : 'down'}" viewBox="0 0 ${SPK_W} ${SPK_H}" preserveAspectRatio="none"><polyline points="${pts}"></polyline></svg>`;
  }

  /* ================= 设置界面 ================= */
  const SETUP = {
    count: 2,
    players: [{ ai: false }, { ai: true }]
  };

  function buildSetupRows() {
    const wrap = $('#player-cfg');
    wrap.innerHTML = '';
    for (let i = 0; i < SETUP.count; i++) {
      const cfg = SETUP.players[i] || (SETUP.players[i] = { ai: false });
      // 名字框【开局就预填一个随机名】（避开其它玩家已用的）；cfg.auto 标记它还是
      // “系统给的、没被改过”的名字 —— 玩家点进框就清空让他自己写，写一半走开
      // （失焦时仍为空）则自动再补一个随机名，保证开局时人人都有名字。
      if (!cfg.name) {
        const used = SETUP.players.slice(0, SETUP.count)
          .filter((c, k) => k !== i && c && c.name).map(c => c.name);
        cfg.name = CF.randName(used);
        cfg.auto = true;
      }
      const profs = CF.PROFESSIONS.map(p => `<option value="${p.id}">${p.icon} ${p.name}（月薪 $${p.salary.toLocaleString()}）</option>`).join('');
      const shapes = CF.PIECE_SHAPES.map(s => `<option value="${s.k}">${s.name}</option>`).join('');
      const color = CF.COLORS[i % CF.COLORS.length];
      const sh = shapeOf(cfg.shape);
      const row = document.createElement('div');
      row.className = 'pcfg';
      // 首列＝棋子预览（形状 + 颜色 + 编号），选形状时即时变化
      // 名字：默认已随机填好；点进框就清空自己改，改到一半走开（空着失焦）会再补一个随机名。
      row.innerHTML = `
        ${pieceHTML(sh.k, color, i + 1, 40, 'pv', '这是你在盘面上的棋子：形状与颜色')}
        <input type="text" class="pname" maxlength="8" value="${esc(cfg.name || '')}" placeholder="点一下可改成自己的名字"
          title="已随机填好一个名字；点进框即可清空改成你自己的（≤8 字）">
        <button type="button" class="btn sm prand" title="只给这一位随机换个职业（不会换到和现在相同的职业）">🎲 职业</button>
        <select class="pprof">${profs}</select>
        <select class="pshape" title="选择棋子形状">${shapes}</select>
        <label class="ai-box" title="交给电脑操控；棋子形状随机">AI<br><input type="checkbox" class="pai" ${cfg.ai ? 'checked' : ''}></label>
        <button type="button" class="del" title="删除">✕</button>`;
      const nameInp = row.querySelector('.pname');
      // 其它玩家当前的名字（补随机名时用来去重）
      const others = () => [...document.querySelectorAll('#player-cfg .pname')]
        .filter(el => el !== nameInp).map(el => el.value.trim()).filter(Boolean);
      // 点进框：若还是系统给的随机名，直接清空，让玩家从零开始写自己的名字
      nameInp.addEventListener('focus', () => {
        if (cfg.auto) { nameInp.value = ''; cfg.name = ''; cfg.auto = false; }
      });
      nameInp.addEventListener('input', () => { cfg.name = nameInp.value.trim(); cfg.auto = false; });
      // 失焦时还是空的（点开又没写）→ 再补一个随机名，保证开局人人有名字
      nameInp.addEventListener('blur', () => {
        if (nameInp.value.trim()) return;
        cfg.name = CF.randName(others());
        cfg.auto = true;
        nameInp.value = cfg.name;
      });
      // 单人随机职业：只换这一位，且不会随机到和当前相同的职业
      row.querySelector('.prand').addEventListener('click', () => {
        const sel = row.querySelector('.pprof');
        const pool = CF.PROFESSIONS.map(p => p.id).filter(id => id !== sel.value);
        sel.value = CF.pick(pool.length ? pool : CF.PROFESSIONS.map(p => p.id));
      });
      row.querySelector('.pshape').value = sh.k;
      row.querySelector('.pshape').addEventListener('change', e => {
        cfg.shape = e.target.value;
        const pv = row.querySelector('.pv'), s = shapeOf(cfg.shape);
        pv.className = 'ptok pv sh-' + s.k;               // 内外两层都要换同一裁剪路径
        pv.style.clipPath = s.path;
        pv.firstElementChild.style.clipPath = s.path;
      });
      row.querySelector('.pai').addEventListener('change', e => cfg.ai = e.target.checked);
      row.querySelector('.del').addEventListener('click', () => {
        if (SETUP.count <= 1) return;
        SETUP.count--; SETUP.players.splice(i, 1); $('#count-num').textContent = SETUP.count; buildSetupRows();
      });
      wrap.appendChild(row);
    }
  }
  // 收名字：手动填了就用填的；没填则随机取一个（且避开本局已用到的名字）。
  // 随机出来的名字会【回写输入框】，开局前就能看到自己叫什么。
  function collectSetup() {
    const rows = [...document.querySelectorAll('#player-cfg .pcfg')];
    const used = [];
    return rows.map(r => {
      const inp = r.querySelector('.pname');
      let name = inp.value.trim();
      if (!name) { name = CF.randName(used); inp.value = name; }
      used.push(name);
      return {
        name,
        prof: r.querySelector('.pprof').value,
        // AI 玩家由电脑操控，形状留空 → 引擎随机分配，盘面更好认
        shape: r.querySelector('.pai').checked ? '' : r.querySelector('.pshape').value,
        ai: r.querySelector('.pai').checked
      };
    });
  }

  /* 财务自由进度百分比：
     未达胜出条件（股息被动 ≤ 月支出）时【绝不显示 100%】——向下取整并封顶 99%，
     否则像 1646.5 / 1650 = 99.79% 会被四舍五入成 100%，
     玩家看到满格却没触发胜利就会困惑。只有真正超过月支出才可能显示 100%。 */
  function coverPct(pas, exp) {
    if (!exp) return 0;
    const r = pas / exp * 100;
    if (pas > exp) return Math.min(100, Math.round(r));   // 已达标 → 可以显示 100%
    return Math.max(0, Math.min(99, Math.floor(r)));      // 未达标 → 最多 99%
  }

  /* 动作代理：默认直接调本地引擎（单机）；
     联机时 js/net.js 会把 window.Act 覆盖成「发给服务端」的版本，
     因此这里所有动作统一走 Act.*，单机/联机共用同一套 UI 代码。 */
  if (!window.Act) {
    window.Act = {
      roll: () => Engine.act.roll(),
      choose: (a, p) => Engine.act.choose(a, p),
      sell: (sym, n) => Engine.act.sellStock(sym, n),
      payDebt: n => Engine.act.payDebt(n)
    };
  }

  /* ================= 设置页快捷操作 ================= */
  function randomizeProfs() {
    const ids = CF.PROFESSIONS.map(p => p.id);
    document.querySelectorAll('#player-cfg .pprof').forEach(sel => { sel.value = CF.pick(ids); });
  }
  function launch(cfg) {
    if (!cfg || !cfg.length) return;
    $('#screen-setup').classList.add('hidden');
    $('#screen-game').classList.remove('hidden');
    if (window.BGM) window.BGM.play('game');   // 进入对局 → 切换对局 BGM
    resetHandoff();          // 新局：清掉上一局的换人提示状态
    Engine.start(cfg);
  }
  function addSetupTools() {
    const panel = document.querySelector('.setup-panel');
    if (!panel) return;
    const div = document.createElement('div');
    div.className = 'pcfg-tools';
    div.innerHTML = `
      <button class="btn sm ghost" type="button" id="btn-rand-prof" data-i18n="btn_rand_prof" title="为【所有玩家】一次性随机分配职业（每家各一个 🎲 职业 按钮可单独换）">🎲 全员随机职业</button>
      <button class="btn sm ghost" type="button" id="btn-manual" data-i18n="btn_manual" title="图文版规则速查：目标 / 界面 / 棋盘格子 / 股票 / 回合流程 / 坑与补救">📖 玩法说明演示</button>
      <span class="hint" data-i18n="hint_guide" style="margin-left:auto">不会玩？点开始游戏左边的新手教学演示</span>`;
    // 插到「开始区」那一行之前：工具行在上，下面是 教学演示 / 开始游戏 / 退出游戏
    panel.insertBefore(div, document.querySelector('#start-row'));
    div.querySelector('#btn-rand-prof').addEventListener('click', randomizeProfs);
    div.querySelector('#btn-manual').addEventListener('click', openGuide);   // 文字版规则速查
  }

  /* ================= 全局渲染入口 ================= */
  const UI = { pinIdx: null, lastTurn: -1, sell: null, liqRef: null, boardFit: null, trendSym: null,
    handoff: null, hoIdx: -1,   // handoff=正在等待确认的换人弹窗；hoIdx=本回合已提示过的玩家序号
    guide: null };              // guide=玩法说明演示当前页码（null=没打开）

  /* ================= 换人交接弹窗（只带「确定」） ================= */
  // 每一手开始前先弹一个只有「确定」的对话框，让所有人知道【这一手轮到谁】：
  //   · 真人 → 提示把设备交给 TA，避免上一位误操作、下一位提前看到别人的报表；
  //   · AI   → 同样提示，让大家知道现在是电脑在动，看清楚它买了什么、踩到哪格。
  // 弹窗确认前会【闸住引擎】（Engine.gate(true)），所以 AI 不会自己先掷骰，
  // 必须等有人点掉「确定」才开始行动；确认后放行并重新驱动 AI。
  // 触发口径：只要本局【玩家数 ≥2】就弹（单人局没有“换人”这回事，不弹）。
  // 联机对局：规则引擎跑在服务端，客户端只做渲染
  function isOnlineGame() { return !!(window.NET && NET.on && NET.onlineMode); }
  function resetHandoff() { UI.handoff = null; UI.hoIdx = -1; if (!isOnlineGame()) Engine.gate(false); }
  function checkHandoff(S) {
    // 教学演示期间不弹交接框：由解说条讲解“轮到谁”，保证演示连贯、不用一直点确定
    if (COACH.on) { UI.handoff = null; return; }
    const p = Engine.cur();
    if (S.over || !p || S.players.length < 2 || p.dead || p.won) {
      UI.handoff = null;
      if (!isOnlineGame()) Engine.gate(false);
      return;
    }
    if (S.await !== 'roll') return;      // 只在“等待掷骰”这个干净时刻提示，避免打断决策弹窗
    if (UI.hoIdx === S.cur) return;      // 本回合已提示过，不再重复
    UI.hoIdx = S.cur;
    const online = isOnlineGame();
    UI.handoff = { idx: S.cur, passive: online };
    /* ★ 联机时绝不 gate/resume 本地引擎：旧版点「确定」会 Engine.resume()，
       在浏览器里另跑一套规则与走格定时器，与服务端权威状态分叉，
       表现为「切换玩家后按钮时有时无、画面卡住」。联机版只做纯展示提示。 */
    if (!online) Engine.gate(true);
  }
  function handoffModal(S) {
    const i = UI.handoff.idx, p = S.players[i];
    if (!p) { UI.handoff = null; Engine.gate(false); return; }
    const exp = Engine.h.expTotal(p), pas = Engine.h.passive(p);
    const cell = CF.HAMSTER_BOARD[p.hamsterPos];
    const ai = !!p.ai;
    showModal(`
      <div class="handoff">
        <div class="ho-turn">第 ${S.turn} 手</div>
        <div class="ho-piece">${pieceHTML(p.shape, p.color, i + 1, 64, 'pv', '')}</div>
        <h2 style="color:${p.color}">${ai ? '🤖 轮到电脑' : '轮到'} ${esc(p.name)}${ai ? `<i class="ai-mark">${p.aiStyle === 'aggressive' ? 'AI🔥' : 'AI'}</i>` : ''}</h2>
        <div class="ho-sub">${p.prof.icon} ${esc(p.prof.name)} · ${ai ? '由电脑自动操作，大家一起看' : '请把设备交给 TA'}</div>
        <div class="ho-num">
          <div><span>现金</span><b>${money(p.cash)}</b></div>
          <div><span>股息被动</span><b class="pos">${money(pas)}/月</b></div>
          <div><span>月支出</span><b>${money(exp)}</b></div>
          <div><span>当前位置</span><b>${cell.ic} ${esc(cell.name)}</b></div>
        </div>
        ${p.charityDice ? '<div class="ho-bonus">🕊️ 上一回合捐过款，本回合可掷两颗骰子</div>' : ''}
        <div class="mbtns" style="justify-content:center">
          <button class="btn green big" type="button" id="btn-ho-ok">${ai ? '✅ 知道了，看它操作' : '✅ 我准备好了'}</button>
        </div>
        <div class="sub">${ai ? '确认后电脑才开始掷骰与交易' : '其他人请暂时回避 👀 · 确认后即可掷骰'}</div>
      </div>`);
    const ok = $('#btn-ho-ok');
    if (ok) {
      ok.focus();                        // 聚焦后可直接敲回车 / 空格确认
      ok.onclick = () => {
        const passive = !!(UI.handoff && UI.handoff.passive);   // 联机：纯展示
        UI.handoff = null;
        if (passive) { render(); return; }                      // 不碰本地引擎
        Engine.gate(false);              // 单机：放行
        render();
        Engine.resume();                 // 重新驱动：AI 这时才真正开始掷骰
      };
    }
  }

  /* ================= 破产变卖逐笔回放 ================= */
  // 引擎把每笔强制变卖写入 S.liq（带自增 seq）。此处按 seq 变化触发一次“回放”：
  // 每隔 LIQ_STEP_MS 揭示一笔，同时高亮对应行情条股票 / 棋盘棋子 / 玩家卡。
  // 回放纯表现层：引擎的变卖本身是同步完成的，这里只是把过程演出来。
  const LIQ = { seq: 0, data: null, shown: 0, timer: null };
  const LIQ_STEP_MS = 460, LIQ_HOLD_MS = 3200;

  function stopLiq() {
    clearInterval(LIQ.timer); clearTimeout(LIQ.timer);
    LIQ.timer = null; LIQ.data = null; LIQ.shown = 0;
  }
  function syncLiquidation(S) {
    const l = S.liq;
    if (!l) { if (LIQ.data) stopLiq(); return; }    // 开新局：清掉上一局的回放
    if (l.seq === LIQ.seq) return;                  // 同一次变卖，不重复触发
    stopLiq();
    LIQ.seq = l.seq; LIQ.data = l; LIQ.shown = 1;   // 首笔随本次 render 一并呈现
    const n = Math.max(1, (l.steps || []).length);
    const hold = () => { LIQ.timer = setTimeout(() => { stopLiq(); render(); }, LIQ_HOLD_MS); };
    if (n <= 1) { hold(); return; }
    LIQ.timer = setInterval(() => {
      LIQ.shown++;
      render();
      if (LIQ.shown >= n) { clearInterval(LIQ.timer); hold(); }
    }, LIQ_STEP_MS);
  }
  // 已揭示的变卖标的（供行情条高亮）
  function liqSyms() {
    if (!LIQ.data) return null;
    const set = new Set();
    (LIQ.data.steps || []).slice(0, LIQ.shown).forEach(s => set.add(s.sym));
    return set;
  }
  function liqIdx() { return LIQ.data ? LIQ.data.idx : -1; }

  function renderLiq(S) {
    const el = $('#liqbox');
    if (!el) return;
    const l = LIQ.data;
    if (!l) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const steps = l.steps || [];
    const rows = steps.slice(0, LIQ.shown);
    const got = rows.reduce((s, x) => s + x.proceeds, 0);
    const done = LIQ.shown >= steps.length;
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="liq-head">🏦 破产保护 · <b style="color:${l.color}">${esc(l.name)}</b> 强制变卖</div>
      <div class="liq-sub">账上缺口 <b class="neg">${money(l.deficit)}</b> · 已回笼 <b class="pos">${money(got)}</b></div>
      <div class="liq-list">${rows.map((x, i) => `
        <div class="liq-row${!done && i === rows.length - 1 ? ' cur' : ''}">
          <span class="liq-no">${i + 1}</span>
          <span>${x.icon} ${esc(x.sym)} ×${x.shares}</span>
          <span class="dim">@${money(x.px)}</span>
          <b class="pos">+${money(x.proceeds)}</b>
        </div>`).join('') || '<div class="liq-row"><span class="dim">暂无持仓可变卖</span></div>'}</div>
      <div class="liq-foot">${l.dead ? '💀 卖光全部持仓仍资不抵债 —— 宣告破产出局'
        : (done ? '✅ 变卖后现金回正，暂渡危机' : '按市价逐笔变卖中…')}</div>`;
  }

  function render() {
    const S = Engine.state();
    if (!S) return;
    if (S.over && window.BGM) window.BGM.play('end');   // 结算画面（胜 / 负）→ 切结算 BGM
    if (S.turn !== UI.lastTurn) { UI.lastTurn = S.turn; UI.pinIdx = null; }
    syncLiquidation(S);
    checkHandoff(S);
    coachTick(S);
    renderTop(S);
    renderElimBar(S);
    renderLiq(S);
    renderMarket(S);
    renderBoard(S);
    renderSummaries(S);
    renderSheet(S);
    renderPanel(S);
    renderLog(S);
    renderToasts(S);
    renderModal(S);
  }

  /* ================= 顶部状态 ================= */
  function renderTop(S) {
    const cur = Engine.cur();
    const st = $('#top-status');
    const rollBtn = $('#btn-roll');
    const hideRoll = () => rollBtn.classList.add('hidden');
    if (S.over && S.winner) {
      st.innerHTML = `👑 ${esc(S.winner.name)}${S.winner.lastStanding ? ' 成为最后的幸存者' : ' 实现财务自由'}，胜出！`;
      hideRoll(); return;
    }
    if (S.over) { st.innerHTML = '💀 对局结束 · 无人胜出'; hideRoll(); return; }
    if (!cur) return;
    if (cur.dead) { st.innerHTML = `💀 ${esc(cur.name)} 已破产出局，观战中…`; hideRoll(); return; }
    const who = `<span style="color:${cur.color}">${esc(cur.name)}</span>`;
    let msg = '';
    // 攒着慈善双骰时提前告知：本回合这次掷骰会是两颗
    if (S.await === 'roll') msg = cur.ai
      ? (cur.charityDice ? 'AI 思考中…（本回合双骰）' : 'AI 思考中…')
      : (cur.charityDice ? '🕊️ 本回合可掷两颗骰子！也可先卖出持仓' : '可先卖出持仓，再掷骰子');
    else if (S.await === 'pending') msg = (S.pending && S.pending.type === 'liquidate') ? '现金不足，必须变卖资产清偿' : '做出你的选择 ↓';
    // 「掷骰 → 走格 → 落格」全程给可见反馈：旧版整段只显示「…」且掷骰按钮隐藏，
    // 玩家分不清是卡死还是在演动画，这正是「投骰子时卡住」的主要体感来源。
    else if (S.walk) msg = S.walk.left > 0
      ? `🎲 前进中…还剩 ${S.walk.left} 格`
      : '🎲 即将落格…';
    else if (S.await === 'busy' && S.dice && S.dice.length)
      msg = `🎲 掷出 ${S.dice.reduce((a, b) => a + b, 0)} 点，准备出发…`;
    else msg = '…';
    st.innerHTML = `🐹 仓鼠赛跑 · ${who} 回合 — ${msg}`;
    const show = S.await === 'roll' && !cur.ai && !cur.dead && !S.over;
    rollBtn.classList.toggle('hidden', !show);
  }

  /* ================= 出局观战横幅 ================= */
  // 有人破产出局但对局未结束时持久展示，让被淘汰的玩家知道自己已出局、正在观战。
  function renderElimBar(S) {
    const el = $('#elimbar');
    if (!el) return;
    const dead = S.players.filter(p => p.dead);
    if (!dead.length || S.over) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const humans = S.players.filter(p => !p.ai);
    const humansOut = humans.length > 0 && humans.every(p => p.dead);
    el.classList.remove('hidden');
    el.innerHTML = `<span class="eb-title">💀 已出局</span>`
      + dead.map(p => `<span class="eb-chip"><b style="color:${p.color}">${esc(p.name)}</b> · ${p.prof.icon} ${esc(p.prof.name)}</span>`).join('')
      + `<span class="eb-hint">${humansOut ? '你已出局，正在观战 AI 对决 —— 可点击下方玩家卡查看报表，或退出重新开局' : '对局继续，直到产生最后的幸存者'}</span>`;
  }

  function renderDice(S) {
    const d1 = $('#die1'), d2 = $('#die2');
    const ds = S.dice || [0];
    d1.textContent = ds[0] || '·';
    d1.style.visibility = (ds[0] || S.await === 'roll') ? 'visible' : 'hidden';
    if (ds.length > 1) { d2.style.display = 'inline-flex'; d2.textContent = ds[1]; }
    else d2.style.display = 'none';
  }

  /* ================= 顶部行情条 ================= */
  function renderMarket(S) {
    const el = $('#ticker');
    if (!el) return;
    // 单只股票 chip：展示板块；tooltip 汇总数据层的股息/波动/一句话简介
    const hitSet = liqSyms();       // 正在被强制变卖的股票 → 高亮
    const chip = m => {
      const up = m.day >= 0;
      const hit = !!(hitSet && hitSet.has(m.sym));
      const held = S.players.reduce((s, p) => s + (Engine.h.holding(p, m.sym) ? Engine.h.holding(p, m.sym).shares : 0), 0);
      let tip = m.div > 0
        ? `${m.name} · ${m.sector}｜每股月息 ${money(m.div)} · 年化 ≈ ${Math.round(CF.divYield(m) * 100)}% · ${m.blurb}`
        : `${m.name} · ${m.sector}｜无股息、波动大 · ${m.blurb}`;
      if (m.hist && m.hist.length) {
        tip += `\n近段区间 ${money(Math.min.apply(null, m.hist))} ~ ${money(Math.max.apply(null, m.hist))}（一格=掷骰一次行情）`;
      }
      return `<div class="stk ${up ? 'up' : 'down'}${m.big ? ' hot' : ''}${hit ? ' liq' : ''}" title="${esc(tip)}" data-sym="${m.sym}">
        <div class="stk-ic">${m.icon}</div>
        <div class="stk-bd">
          <div class="stk-sym">${m.sym}${held ? `<i class="stk-held">×${held}</i>` : ''}<small class="stk-sec">${esc(m.sector)}</small></div>
          <div class="stk-px">${money(m.px)}<b class="stk-day">${up ? '▲' : '▼'}${Math.abs(Math.round(m.day * 10000) / 100)}%</b></div>
          ${sparkHTML(m.hist, m.px)}
        </div></div>`;
    };
    // 分组标题与顺序也由数据层 MARKET_GROUPS 提供
    el.innerHTML = CF.MARKET_GROUPS.map(g => {
      const list = S.market.filter(m => m.cat === g.cat);
      return `<div class="mkt-grp"><span class="mkt-lab ${g.cls}" title="${esc(g.desc)}">${g.icon} ${esc(g.label)}</span><div class="mkt-chips">${list.map(chip).join('')}</div></div>`;
    }).join('');
    // 点击行情条股票卡 → 左栏进度条下方展开该股走势图（再点一次收起）
    el.querySelectorAll('.stk[data-sym]').forEach(c => c.addEventListener('click', () => toggleTrend(c.dataset.sym)));
  }

  /* ================= 仓鼠圈：24 格环形扇区 ================= */
  const shapeOf = k => CF.PIECE_SHAPES.find(s => s.k === k) || CF.PIECE_SHAPES[0];

  /* 单字宽度（全角当量）：汉字记 1，拉丁字母/数字/百分号记 0.58（约半个字宽）。
   * 格名竖排后每行只有一个字，所以“最宽的一行”就是“最宽的那个字”。 */
  const CJK_RE = /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/;
  const emW = s => [...String(s == null ? '' : s)].reduce((w, c) => w + (CJK_RE.test(c) ? 1 : 0.58), 0);



  /* 棋子 / 形状预览：外层白描边 + 内层玩家色。
   * clip-path 会连 border/box-shadow 一起裁掉，所以“描边”必须由两层同形裁剪实现。 */
  function pieceHTML(shapeKey, color, num, size, extraCls, tip) {
    const sh = shapeOf(shapeKey);
    return `<span class="ptok ${extraCls || ''} sh-${sh.k}"${tip ? ` title="${esc(tip)}"` : ''}`
      + ` style="clip-path:${sh.path};width:${size}px;height:${size}px">`
      + `<i style="clip-path:${sh.path};background:${color};font-size:${Math.round(size * 0.52)}px">${num}</i></span>`;
  }

  function tokenHTML(S) {
    const map = {};
    S.players.forEach(p => {
      if (p.dead) return;   // 出局玩家不显示在棋盘上
      (map[p.hamsterPos] = map[p.hamsterPos] || []).push(p);
    });
    return map;
  }
  // 棋子：形状由玩家在设置页自选，尺寸随盘径缩放，编号 + 颜色双重区分。
  // 摆法为 2×2 斜叠簇（见 renderBoard 注释）：第 k 枚按 (col=⌊k/2⌋, row=k%2) 定位，
  // 右列下沉一点、行间错位，簇整体在 tokW 里水平居中；后枚 z 序在上。
  function tokenMarks(list, li, players, curIdx, size, tokW) {
    const TOK = { DX: 0.62, DY: 0.5, CY: 0.12 };
    const n = (list || []).length;
    const cw = (n > 1 ? 1 + TOK.DX : 1) * size;      // 簇宽（身位）
    return (list || []).map((p, k) => {
      const i = players ? players.indexOf(p) : -1;
      const cls = 'token' + (i === li ? ' liq' : '') + (i === curIdx ? ' cur' : '');
      const sh = shapeOf(p.shape);
      const tip = `${p.name} · ${p.prof.icon} ${p.prof.name} · ${sh.name}棋子`;
      const col = k % 2, row = Math.floor(k / 2);
      const x = Math.round((tokW - cw) / 2 + col * TOK.DX * size);
      const y = Math.round(row * TOK.DY * size + col * TOK.CY * size);
      return `<span class="tk-wrap" style="left:${x}px;top:${y}px;z-index:${k + 1}">`
        + pieceHTML(p.shape, p.color, i + 1, size, cls, tip) + `</span>`;
    }).join('');
  }

  /* 生成一个扇形格子：
   *   把 [宽=外弧弦长, 高=环的径向深度] 的矩形盒旋转到扇区位置，
   *   再用 clip-path 裁成扇环梯形；盒内内容【跟着扇区一起转】→ 图标朝外、文字沿半径往内，
   *   像轮盘抽奖那样面朝扇面（代价是下半圈的格子看起来是倒的，这正是转盘该有的观感）。
   * R=盘半径, ang=扇区中心角(度, 0=12点方向, 顺时针), Ro/Ri=外/内半径, half=单格半角(弧度)。 */
  function sectorHTML(R, ang, Ro, Ri, half, cls, tip, inner) {
    const W = 2 * Ro * Math.sin(half);     // 盒宽 = 外弧弦长（扇区最宽处）
    const H = Ro - Ri;                     // 盒高 = 环的径向深度
    const iw = Ri * Math.sin(half);        // 内弧半弦长 → 梯形的下底
    const pc = v => (v * 100).toFixed(2);
    const poly = `polygon(0 0,100% 0,${pc((W / 2 + iw) / W)}% 100%,${pc((W / 2 - iw) / W)}% 100%)`;
    const Rm = (Ro + Ri) / 2;              // 盒中心所在半径
    return `<div class="sect ${cls}"${tip ? ` title="${esc(tip)}"` : ''}`
      + ` style="left:${(R - W / 2).toFixed(1)}px;top:${(R - H / 2).toFixed(1)}px;width:${W.toFixed(1)}px;height:${H.toFixed(1)}px;`
      + `clip-path:${poly};transform:rotate(${ang}deg) translateY(${(-Rm).toFixed(1)}px)">`
      + `${inner}</div>`;
  }

  /* 中央信息板：目标 + 当前玩家进度 + 全格图例。
   * 根节点字号由 renderBoard 按盘径注入，内部一律用 em，故大小盘都不溢出。 */
  function hubHTML(S) {
    const cur = Engine.cur();
    let curBlock = '';
    if (cur) {
      const exp = Engine.h.expTotal(cur), pas = Engine.h.passive(cur);
      const rate = coverPct(pas, exp);   // 未达标时封顶 99%，不会误显示 100%
      curBlock = `<div class="hub-cur">
          <div class="hc-head"><span class="hc-tag" style="background:${cur.color}">P${S.players.indexOf(cur) + 1}</span>
            <b style="color:${cur.color}">${esc(cur.name)}</b>
            <span class="hc-role">${cur.prof.icon} ${esc(cur.prof.name)}</span></div>
          <div class="hc-bar"><i style="width:${rate.toFixed(1)}%"></i></div>
          <div class="hc-num">股息 <b>${money(pas)}</b>/月 ／ 月支出 <b>${money(exp)}</b> · 覆盖 <b>${rate.toFixed(0)}%</b></div>
        </div>`;
    }
    const legend = Object.keys(CF.TYPE_INFO).map(k => {
      const t = CF.TYPE_INFO[k];
      return `<div class="hleg ${t.cls}"><b>${t.ic}</b><span class="hleg-tx"><em>${esc(t.name)}</em><small>${esc(t.hint || '')}</small></span></div>`;
    }).join('');
    return `<div class="hub-title">🐹 仓鼠赛跑<small>顺时针 ↻</small></div>
      <div class="hub-goal">走到 <b>💵 结算日</b> 时若 <b>股息 ＞ 月支出</b> 即胜出</div>
      ${curBlock}
      <div class="hub-legend">${legend}</div>`;
  }

  /* 仓鼠圈棋盘：24 格扇形环轨（data.js HAMSTER_RING）+ 中央圆形信息板。 */
  function renderBoard(S) {
    renderDice(S);
    const wrap = $('#board');
    if (!wrap) return;
    /* ---- 盘径：铺满棋盘列，同时保证【整盘一屏可见】（看不到整盘会严重影响走格体验） ----
     * 尺寸必须【稳定】：页面滚动、掷骰按钮显隐、行情条数值位数变化引起的换行，都会让
     * “棋盘上方的头部高度”抖几像素到几十像素；若每次渲染都照算，轮盘就会忽大忽小。
     * 因此这里做三层稳定处理：
     *   ① 头部高度用【文档坐标】量（rect.top + 已滚动距离），滚动页面不再改变结果；
     *   ② 盘径量化到 8px 阶梯，吃掉 1~7px 的细碎差异；
     *   ③ 只有【可用宽 / 视口高真的变了 ≥40px】（窗口缩放级别）才重新定尺寸，其余沿用上次值。 */
    const host = wrap.parentElement || wrap;
    const avail = host.clientWidth || wrap.clientWidth || 0;
    const vh = window.innerHeight || 900;
    const bfit = UI.boardFit;
    let D = bfit ? bfit.D : 0;
    if (!D || Math.abs(avail - bfit.avail) >= 40 || Math.abs(vh - bfit.vh) >= 40) {
      const rect = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : null;
      const scrolled = window.pageYOffset || document.documentElement.scrollTop || 0;
      const docTop = rect ? rect.top + scrolled : 0;     // 文档坐标：与滚动位置无关
      const topRef = docTop > 40 ? Math.ceil(docTop / 16) * 16 : 240;   // 布局未完成时退回经验值；取整到 16px 阶梯（宁可略大 1 格），避免量到零头差异
      const byHeight = vh - topRef - 14;
      const low = Math.min(560, avail || 560);           // 可读下限，但不许超过可用宽（窄屏不溢出）
      const raw = Math.max(low, Math.min(avail || 900, 1080, Math.max(low, byHeight)));
      D = Math.round(raw / 8) * 8;                       // 量化成 8px 阶梯，避免细碎跳动
      UI.boardFit = { avail, vh, D };
    }
    wrap.style.width = D + 'px';
    wrap.style.height = D + 'px';

    /* ---- 扇环几何 ---- */
    const R = D / 2;
    const Ro = R * CF.ARC.outRatio;   // 扇环外半径
    const Ri = R * CF.ARC.inRatio;    // 扇环内半径 ＝ 中央信息板半径
    const H = Ro - Ri;                // 径向深度
    const half = (CF.SECTOR_DEG / 2) * Math.PI / 180 * CF.ARC.gapRatio;   // 单格半角（弧度）
    const TAN = Math.tan(half);
    const W = 2 * Ro * Math.sin(half);                                    // 单格盒宽

    /* ---- 格内排版：图标在顶，格名【逐字竖排】顺着半径往下，字号随盘径缩放 ----
     * 竖排把“一行放几个字”变成“一列放几个字”：占用的角向宽度永远只有 1 个字，
     * 角向不再是瓶颈，扇环的【径向深度】成了唯一预算——它要同时装下
     * 【图标 + 逐字格名】和【棋子区】，所以两者必须一起解，谁也不能把谁挤没。 */
    const PAD = 0.35;                   // 内容盒左右内边距（em）
    const ICP = 1.7, IROW = 2.0;        // 图标字号 / 图标行高（em，须容下 emoji 的墨高）
    const NROW = 1.1, GAPC = 0.16;      // 竖排每字行高 / 图标与文字之间的行距（em）
    // 棋子区最少预留（px）：按环的径向深度自适应，大盘留足一簇 2×2 斜叠大棋子（≈56px），
    // 小盘按比例少留，避免把格名字号挤得过小。
    // 这一项是【棋子与格名的空间分配阀】：调大 → 棋子更大、格名更小；调小则相反。
    const MIN_TOK = Math.min(56, Math.round(H * 0.32));
    // 转盘用短标签（各语言自带 short），避免长名把字号压得过小
    const charRows = CF.HAMSTER_BOARD.map(cl => [...(cl.short || cl.name)]);
    const KW = Math.max(ICP, ...charRows.flat().map(emW)) + PAD * 2;               // 单字宽
    /* 所有语言统一【逐字竖排】（与图标垂直），摆放形式与中文版一致。
       外语标签已精简到 ≤5 字符，竖排行数与中文相当，不会把字号压小。 */
    const rowCount = cl => [...(cl.short || cl.name)].length;
    const KH = IROW + Math.max(...CF.HAMSTER_BOARD.map(rowCount)) * NROW + GAPC;  // 图标 + 最长格名
    const NF = Math.min(26, Math.max(6.5, Math.min(
      1.88 * TAN * Ro / (KW + 1.88 * TAN * KH),      // 角向上限：KW×F = 2×(Ro−KH×F)×tan(half)×0.94
      (H - MIN_TOK) / KH)));                         // 径向上限：给棋子区留出 MIN_TOK
    const cw = KW * NF, ch = KH * NF;

    // 棋子区放在内容盒与内弧之间的空隙里；宽度按【最内侧（最窄处）的弦长】定，
    // 这样即使挤满一簇也不会越过扇区边界被裁。
    //
    // 【2×2 斜叠簇】摆法：旧版“并排塞 3 枚 × 两排”把棋子压到约 11px；现在
    // 改成像实体桌游那样把棋子“斜着叠”起来——右列搭在左列上、整体下沉一点，
    // 行间也错位。单场最多 4 家，4 枚同格只占 1.62 枚见方的簇，省下的
    // 角向/径向空间全还给棋子尺寸（约放大一倍）。棋子只待在棋子专属区里，
    // 绝不遮图标与格名；相互层叠靠“编号 + 错位露出 + 后枚压前枚”区分。
    const TOK = { DX: 0.62, DY: 0.5, CY: 0.12 };     // 列距 / 行距 / 右列下沉（按身位比）
    const maxPile = Math.max(1, S.players.length);   // 同格最多几家（本作上限 4）
    const pileW = 1 + TOK.DX * (Math.min(2, maxPile) - 1);        // 簇宽身位（最多 2 列）
    const pileH = 1 + TOK.DY * (Math.ceil(maxPile / 2) - 1) + (maxPile > 1 ? TOK.CY : 0); // 簇高身位
    const metrics = sz => {
      const rh = Math.min(H - ch, sz * pileH + 4);
      const tr = Ro - ch - rh;
      return { rh, tw: Math.min(2 * tr * Math.sin(half) * 0.98, W * 0.98) };
    };
    // 棋子上限：随盘径放大（约盘径的 4.5%），硬顶 42px；真正生效值还要被下面的
    // 径向（格名占完之后剩下的环深）与角向（最内侧弦长 ÷ 簇宽）两道约束再压一次。
    const baseTok = Math.round(Math.min(42, Math.max(14, D * 0.045)));
    let tokSize = Math.max(9, Math.min(baseTok, Math.floor((H - ch - 4) / pileH)));
    let tk = metrics(tokSize);
    const fit = Math.floor(tk.tw / pileW);           // 簇最窄处弦长 ÷ 簇宽身位
    if (tokSize > fit) { tokSize = Math.max(9, fit); tk = metrics(tokSize); }
    const rowH = tk.rh, tokW = tk.tw;

    const cur = Engine.cur();
    const curIdx = cur ? S.players.indexOf(cur) : -1;
    const activeIdx = cur ? cur.hamsterPos : -1;
    const li = liqIdx();
    const map = tokenHTML(S);
    let html = '';
    CF.HAMSTER_BOARD.forEach((cl, i) => {
      const cell = CF.HAMSTER_RING[i];
      const cls = [cl.cls, i === activeIdx ? 'active' : ''].filter(Boolean).join(' ');
      // 格内只留「图标 + 逐字竖排格名」两段：短标签交给中央信息板的图例，省下的角向宽度全给字号
      // 逐字一个 <br>，从图标下方顺着半径一路往下排
      const nmTxt = cl.short || cl.name;
      const isCJK = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(nmTxt);
      // 摆放形式与中文一致：逐字（外语逐字母）竖排、与图标垂直；
      // 欧美语系字号比中文小两号（×0.8），这样较长的单词也放得下。
      const nmFs = isCJK ? '' : ` style="font-size:${(NF * 0.8).toFixed(2)}px"`;
      const nmInner = [...nmTxt].map(esc).join('<br>');
      const inner = `<div class="ctx" style="left:${((W - cw) / 2).toFixed(1)}px;top:0;width:${cw.toFixed(1)}px;height:${ch.toFixed(1)}px;font-size:${NF.toFixed(2)}px">`
        + `<div class="ic">${cl.ic}</div>`
        + `<div class="nm"${nmFs}>${nmInner}</div></div>`
        + `<div class="tk" style="left:${((W - tokW) / 2).toFixed(1)}px;top:${ch.toFixed(1)}px;width:${tokW.toFixed(1)}px;height:${rowH.toFixed(1)}px">`
        + tokenMarks(map[i], li, S.players, curIdx, tokSize) + `</div>`;
      // hover 提示词直接来自数据层 TYPE_INFO.desc
      html += sectorHTML(R, cell.ang, Ro, Ri, half, cls, cl.name + '：' + cl.desc, inner);
    });
    // 中央圆形信息板（内缩几像素，避免与扇形内弧贴死）
    const hubD = Math.round((Ri - Math.max(3, D * 0.006)) * 2);
    const hubFs = Math.max(12, Math.min(20, D * 0.0155));
    html += `<div class="hub" style="left:${((D - hubD) / 2).toFixed(1)}px;top:${((D - hubD) / 2).toFixed(1)}px;`
      + `width:${hubD}px;height:${hubD}px;font-size:${hubFs.toFixed(1)}px">${hubHTML(S)}</div>`;
    wrap.innerHTML = html;
  }

  /* ================= 底部：各玩家资产汇总 ================= */
  function renderSummaries(S) {
    const wrap = $('#summaries');
    if (!wrap) return;
    const cur = Engine.cur();
    const li = liqIdx();                       // 正在被强制变卖的玩家 → 高亮
    wrap.innerHTML = S.players.map((p, i) => {
      const exp = Engine.h.expTotal(p), pas = Engine.h.passive(p), cf = Engine.h.net(p);
      const base = p.dead ? 'psum dead' : p.won ? 'psum celebrate' : (p === cur ? 'psum current' : 'psum');
      const cls = i === li ? base + ' liq' : base;
      const cell = CF.HAMSTER_BOARD[p.hamsterPos];
      const rate = coverPct(pas, exp);   // 未达标时封顶 99%，不会误显示 100%
      const stocksHtml = (p.stocks || []).map(a => {
        const px = Engine.h.curStockPx(a.sym);
        const gain = (px - a.avg) / a.avg;
        return `<span class="mini-stk ${gain >= 0 ? 'up' : 'down'}" data-sym="${a.sym}" title="${esc(a.name)} 成本 ${money(a.avg)} · 点击看走势">
          ${a.icon}${a.sym} ×${a.shares} <i>${money(a.shares * px)}</i></span>`;
      }).join('');
      return `<div class="${cls}" style="border-left:4px solid ${p.color}">
        <div class="phead">${pieceHTML(p.shape, p.color, i + 1, 30, 'pv', '棋子形状：' + shapeOf(p.shape).name)}
          <span class="pname">${esc(p.name)}</span>${i === li ? '<span class="liq-mark">🏦 变卖清偿</span>' : (p.dead ? '<span class="dead-mark">💀 已出局</span>' : (p.ai ? `<span class="ai-mark">${p.aiStyle === 'aggressive' ? 'AI🔥' : 'AI'}</span>` : ''))}
          <span class="role" style="margin-left:auto">${p.prof.icon} ${esc(p.prof.name)}</span></div>
        <div class="pnum">
          <div><span>现金</span><b>${money(p.cash)}</b></div>
          <div><span>股息被动</span><b class="pos">${money(pas)}/月</b></div>
          <div><span>月支出</span><b>${money(exp)}</b></div>
          <div><span>月现金流</span><b class="${cf >= 0 ? 'pos' : 'neg'}">${money(cf)}</b></div>
          <div><span>位置</span><b>${cell.ic} ${cell.name}</b></div>
        </div>
        <div class="goalbar"><div class="goal-fill" style="width:${rate}%"></div></div>
        <div class="goal-txt">股息覆盖 ${rate.toFixed(0)}% · ${pas > exp ? '🚀 已达胜出条件' : `目标 ＞${money(exp)}/月`}</div>
        ${stocksHtml ? `<div class="stk-line">${stocksHtml}</div>` : '<div class="no-stk">暂无持股，踩到 💰/🚀 格买入吧</div>'}
      </div>`;
    }).join('');
    // 点击玩家卡上的持股标签 → 看该股走势（阻止冒泡，不触发“切换报表”）
    wrap.querySelectorAll('.mini-stk[data-sym]').forEach(c => c.addEventListener('click', e => {
      e.stopPropagation();
      toggleTrend(c.dataset.sym);
    }));
    Array.from(wrap.querySelectorAll('.psum')).forEach((el, i) => {
      el.style.cursor = 'pointer';
      el.title = '点击查看其财务报表';
      el.addEventListener('click', () => { UI.pinIdx = UI.pinIdx === i ? null : i; render(); });
    });
  }

  /* ================= 财务报表 ================= */
  function renderSheet(S) {
    const curIdx = S.cur;
    const sel = S.players[UI.pinIdx != null ? UI.pinIdx : curIdx] || S.players[curIdx];
    if (!sel) return;
    $('#sheet').innerHTML = `<div class="sheetcard">${incomeHTML(S, sel)}</div><div class="sheetcard">${balanceHTML(S, sel)}</div>`;
  }
  function moneyTd(v) { return `<td class="r ${v >= 0 ? 'pos' : 'neg'}">${money(v)}</td>`; }

  function incomeHTML(S, p) {
    const isCur = p === S.players[S.cur];
    const who = `<span class="who" style="color:${isCur ? '#3ddc97' : '#7d90b8'}">${isCur ? '● 当前玩家' : '● 正在观看'}</span>`;
    const exp = Engine.h.expTotal(p), pas = Engine.h.passive(p), netV = Engine.h.net(p);
    const divRows = (p.stocks || []).filter(a => a.div > 0).map(a =>
      `<tr class="subrow"><td>· ${a.icon} ${a.sym} ×${a.shares} 股</td><td class="r pos">+${money(a.div * a.shares)}</td></tr>`).join('');
    const grwRows = (p.stocks || []).filter(a => a.div === 0).map(a =>
      `<tr class="subrow"><td>· ${a.icon} ${a.sym} ×${a.shares} 股（无股息）</td><td class="r">0</td></tr>`).join('');
    const paidNote = p.expLines.filter(l => l.paid).map(l => `<tr class="subrow"><td>✓ ${esc(l.label)}(已结清)</td><td class="r">−0</td></tr>`).join('');
    const expenseRows = p.expLines.filter(l => !l.paid).map(l =>
      `<tr><td>${esc(l.label)}${l.debt ? `<small style="color:#7d90b8">· 可全额还清 ${money(l.principal)}</small>` : ''}</td><td class="r">${money(l.m)}</td></tr>`).join('');
    return `<h4>📊 月收支表 <span class="who">${who} ${esc(p.name)} · ${p.prof.icon} ${esc(p.prof.name)}</span></h4>
    <table class="st">
      <tr><th colspan="2">收入 INCOME</th></tr>
      <tr><td>工资</td><td class="r">${money(p.prof.salary)}</td></tr>
      <tr><td>股息被动收入</td><td class="r pos">${money(pas)}</td></tr>${divRows}${grwRows}
      <tr><th colspan="2">支出 EXPENSES</th></tr>${expenseRows}${paidNote}
      <tr class="total"><td>月现金流</td>${moneyTd(netV)}</tr>
    </table>`;
  }

  function balanceHTML(S, p) {
    const stockVal = (p.stocks || []).reduce((s, a) => s + a.shares * Engine.h.curStockPx(a.sym), 0);
    const stockRows = (p.stocks || []).map(a => {
      const px = Engine.h.curStockPx(a.sym);
      const gain = (px - a.avg) / a.avg;
      return `<tr class="assetrow"><td>${a.icon} ${esc(a.name)} (${a.sym}) <small>成本 ${money(a.avg)} × ${a.shares} · 现价 ${money(px)}</small></td><td class="r ${gain >= 0 ? 'pos' : 'neg'}">${money(a.shares * px)}<small style="display:block">${gain >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(gain * 100))}%</small></td></tr>`;
    }).join('');
    const totalAsset = p.cash + stockVal;
    const liab = Engine.h.debtLines(p).reduce((s, l) => s + l.principal, 0);
    const liabRows = Engine.h.debtLines(p).map(l =>
      `<tr><td>${esc(l.label)}<small style="color:#7d90b8">· 月供 ${money(l.m)}</small></td><td class="r">${money(l.principal)}</td></tr>`).join('');
    return `<h4>🏦 资产负债表 <span class="who">${esc(p.name)}</span></h4>
    <table class="st">
      <tr><th colspan="2">资产 ASSETS</th></tr>
      <tr><td>💵 现金</td><td class="r">${money(p.cash)}</td></tr>${stockRows}
      ${(p.stocks || []).length ? '' : '<tr class="subrow"><td colspan="2">暂无持股</td></tr>'}
      <tr class="total"><td>总资产</td><td class="r">${money(totalAsset)}</td></tr>
      <tr><th colspan="2">负债 LIABILITIES</th></tr>${liabRows || '<tr class="subrow"><td colspan="2">无负债</td></tr>'}
      <tr class="total"><td>总负债</td><td class="r">${money(liab)}</td></tr>
      <tr class="total"><td>净资产</td>${moneyTd(totalAsset - liab)}</tr>
    </table>`;
  }

  /* ================= 个股走势图（点击某只股票后，显示在财务自由进度条下方） ================= */
  /* 交互：点击行情条股票卡 / 左栏持仓行 / 底部玩家卡的持股标签，即选中该股，
   * 在进度条下方展开它的历史走势；再点一次（或点 ✕）收起。没人点就不渲染。
   * 数据与顶部行情条同源：m.hist（每掷一次骰记录一个点）＋ 当前价。 */
  const TREND_H = 96;
  // 通用走势 SVG（左栏走势图 / 买入弹窗共用）：hist 不足 2 点时返回占位提示
  function trendChartSVG(m, H) {
    const arr = (m.hist && m.hist.length ? m.hist.slice() : []).concat([m.px]);
    if (arr.length < 2) return '<div class="pc-nodata">暂无走势数据：每掷一次骰行情记录一点，走两步后即有曲线</div>';
    const lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr);
    const span = (hi - lo) || 1;
    const n = arr.length - 1;
    const y = v => (H - 6) - ((v - lo) / span) * (H - 12);
    const pts = arr.map((v, i) => ((i / n) * 100).toFixed(1) + ',' + y(v).toFixed(1));
    const up = m.px >= arr[0];
    const base = y(lo).toFixed(1);
    return `<svg class="pc-svg" viewBox="0 0 100 ${H}" preserveAspectRatio="none">
      <polygon class="pc-area ${up ? 'up' : 'down'}" points="0,${base} ${pts.join(' ')} 100,${base}"/>
      <polyline class="pc-line ${up ? 'up' : 'down'}" points="${pts.join(' ')}"/>
    </svg>`;
  }
  function trendBoxHTML(S) {
    if (!UI.trendSym) return '';
    const m = S.market.find(x => x.sym === UI.trendSym);
    if (!m) { UI.trendSym = null; return ''; }
    const hist = m.hist || [];
    const arr = hist.length ? hist.concat([m.px]) : [m.px];
    const lo = arr.length ? Math.min.apply(null, arr) : m.px;
    const hi = arr.length ? Math.max.apply(null, arr) : m.px;
    const upDay = m.day >= 0;
    const chart = trendChartSVG(m, TREND_H);

    return `<div class="pc-box">
      <div class="pc-head">
        <span class="pc-ic">${m.icon}</span>
        <b>${m.sym}</b><small class="pc-nm">${esc(m.name)}</small>
        <span class="pc-px ${upDay ? 'pos' : 'neg'}">${money(m.px)}<i>${upDay ? '▲' : '▼'}${Math.abs(Math.round(m.day * 10000) / 100)}%</i></span>
        <button class="pc-x" id="pc-close" type="button" title="收起走势图">✕</button>
      </div>
      <div class="pc-chart">${chart}</div>
      <div class="pc-meta">
        <span>近段区间 ${money(lo)} ~ ${money(hi)}（一格 = 掷骰一次）</span>
        <span>${m.div > 0 ? `💰 每股月息 ${money(m.div)} · 年化 ≈ ${Math.round(CF.divYield(m) * 100)}%` : '🚀 无股息 · 波动大'}</span>
      </div>
    </div>`;
  }
  // 选中/收起一只股票的统一入口（供各处点击调用）
  function toggleTrend(sym) {
    UI.trendSym = (UI.trendSym === sym) ? null : sym;
    render();
  }

  /* ================= 行动面板 ================= */
  /* 操作面板：进度条 / 持仓 / 还债一律跟随【正在查看的玩家】，
   * 与财务报表 renderSheet 用同一个选中口径，避免"切了玩家、进度条却不动"。
   * 但卖出、还债等操作只在「轮到当前玩家、且正看着自己」时开放。 */
  function renderPanel(S) {
    const cur = Engine.cur();
    const box = $('#panel');
    if (!cur) return;
    const p = S.players[UI.pinIdx != null ? UI.pinIdx : S.cur] || cur;
    const isCur = p === cur;
    const whoTag = `<span style="margin-left:auto;font-size:12px;color:${isCur ? '#3ddc97' : '#7d90b8'}">${isCur ? '● 当前玩家' : '● 正在观看'} ${esc(p.name)}</span>`;
    if (p.dead) {
      box.innerHTML = `<div class="ph"><span class="pin">💀</span><h3>${esc(p.name)} 已破产出局</h3>${whoTag}</div>
        <div class="dim2">正在观战剩余玩家……可点击顶部「🏠 返回设置」重新开局。</div>`;
      return;
    }
    const pas = Engine.h.passive(p), exp = Engine.h.expTotal(p);
    const canTrade = isCur && S.await === 'roll' && !p.ai && !S.over && !p.won && !p.dead;
    const stocksHtml = (p.stocks || []).map(a => {
      const px = Engine.h.curStockPx(a.sym);
      const gain = (px - a.avg) / a.avg;
      return `<div class="trd-row" data-sym="${a.sym}" title="点击查看 ${a.sym} 的历史走势图">
        <div class="trd-info">${a.icon} ${a.sym} <span>×${a.shares} 股</span></div>
        <div class="trd-px"><small>成本 ${money(a.avg)}</small><b class="${gain >= 0 ? 'pos' : 'neg'}">现价 ${money(px)} (${gain >= 0 ? '+' : ''}${Math.round(gain * 100)}%)</b>
          ${a.div > 0 ? `<small class="pos">月息 ${money(a.div * a.shares)}</small>` : '<small class="dim">无股息</small>'}</div>
        <button class="btn sm ${canTrade ? 'gold' : ''}" data-sell="${a.sym}" ${canTrade ? '' : 'disabled'}>卖出</button>
      </div>`;
    }).join('');

    const debtBtns = Engine.h.debtLines(p).map((l, i) => {
      const lineIdx = p.expLines.indexOf(l);
      const can = canTrade && p.cash >= l.principal;
      return `<button class="btn sm ${can ? 'blue' : ''}" data-debt="${lineIdx}" ${can ? '' : 'disabled'}>还清 ${esc(l.label)}<br><small style="font-weight:400">支出 ${money(l.m)} → 0 · ${money(l.principal)}</small></button>`;
    }).join('');

    const rate = coverPct(pas, exp);   // 未达标时封顶 99%，不会误显示 100%
    box.innerHTML = `
      <div class="ph"><span class="pin">🎯</span><h3>财务自由进度</h3>${whoTag}</div>
      <div style="height:14px;background:#0b1226;border-radius:8px;overflow:hidden;border:1px solid #223358">
        <div style="height:100%;width:${rate}%;background:linear-gradient(90deg,#f5c542,#3ddc97);transition:width .5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;color:#7d90b8;font-size:12px;margin:6px 0 4px">
        <span>股息被动收入 ${money(pas)}/月</span><span>目标：＞ ${money(exp)}/月</span>
      </div>
      ${pas > exp ? '<div style="color:#3ddc97;font-weight:800;margin:4px 0 8px">🚀 已达到胜出条件！走到💵银行结算日即获胜</div>'
                  : '<div style="color:#7d90b8;font-size:11px;margin:4px 0 8px">💡 买入红利股吃股息＞月支出，或低吸成长股博暴利后换仓。</div>'}

      ${trendBoxHTML(S)}

      <div class="ph" style="margin-top:8px"><span class="pin">📈</span><h3>${isCur ? '我的持仓（自己回合可随时卖出）' : esc(p.name) + ' 的持仓（观战中）'}</h3></div>
      ${stocksHtml || '<div class="empty2">暂无持股</div>'}
      ${canTrade ? '' : (!isCur
        ? `<div class="dim2">正在查看 ${esc(p.name)} 的报表，轮到 TA 的回合才能操作</div>`
        : (p.ai ? '<div class="dim2">AI 由程序自动交易</div>' : '<div class="dim2">轮到你可掷骰/卖出时再进行操作</div>'))}

      <div class="ph" style="margin-top:8px"><span class="pin">📌</span><h3>还清负债（降低月支出）</h3></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${debtBtns || '<span style="color:#3ddc97;font-size:13px">已无负债可还</span>'}</div>
    `;
    box.querySelectorAll('[data-debt]').forEach(b => b.addEventListener('click', () => Act.payDebt(+b.dataset.debt)));
    box.querySelectorAll('[data-sell]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();          // 卖出按钮别冒泡成“查看走势”
      if (!canTrade) return;
      UI.sell = b.dataset.sell;
      render();
    }));
    // 点击持仓行 → 进度条下方展开该股走势；再点一次收起
    box.querySelectorAll('.trd-row[data-sym]').forEach(r => r.addEventListener('click', () => toggleTrend(r.dataset.sym)));
    const pcx = box.querySelector('#pc-close');
    if (pcx) pcx.addEventListener('click', () => { UI.trendSym = null; render(); });
  }

  /* ================= 结算排名（数据来自 Engine.h.standings） ================= */
  const OUTCOME_META = {
    freedom:      { ic: '👑', txt: '财务自由',   cls: 'win' },
    lastStanding: { ic: '🏆', txt: '最后幸存者', cls: 'win' },
    bankrupt:     { ic: '💀', txt: '破产出局',   cls: 'out' },
    alive:        { ic: '🏃', txt: '仍在赛跑',   cls: '' }
  };
  function standingsHTML(S) {
    const rows = Engine.h.standings().map(r => {
      const m = OUTCOME_META[r.outcome] || OUTCOME_META.alive;
      return `<tr class="${m.cls}">
        <td class="rk">${r.rank}</td>
        <td><span class="dot" style="background:${r.color}"></span>${esc(r.name)}${r.ai ? ' <i class="ai-mark">AI</i>' : ''}<small>${r.profIcon} ${esc(r.profName)}</small></td>
        <td>${m.ic} ${m.txt}</td>
        <td class="r">${money(r.netWorth)}<small>现金 ${money(r.cash)}</small></td>
      </tr>`;
    }).join('');
    return `<div class="standings">
      <div class="st-title">📊 本局结算 · 共 ${S.turn} 回合</div>
      <table>
        <tr><th>#</th><th>玩家</th><th>结局</th><th class="r">净资产</th></tr>
        ${rows}
      </table>
    </div>`;
  }

  // 结束弹窗底部：提示本局已写入跨局战绩
  function statsNoteHTML() {
    if (!CF.Stats) return '';
    const s = CF.Stats.summary();
    return `<div class="stats-note">🏅 本局已计入「本机战绩」 · 累计 ${s.games} 局（返回设置页可查看排行）</div>`;
  }

  /* ================= 弹窗 ================= */
  /* 遮幕顶界：停在行情栏下沿，让弹窗弹出时顶部行情条仍清晰可见（不被压暗/模糊）。
     行情栏是文档流元素，滚动与缩放都会改变它在视口中的位置，所以每次展示与滚动时重算，
     结果写进 CSS 变量 --modal-top 供 #modal 使用。 */
  function syncModalTop() {
    const bar = $('#marketbar'), tb = $('#topbar');
    if (!bar || !tb) return;
    const floor = tb.offsetHeight || 56;                  // 再靠上也不许压住顶栏
    const bottom = bar.getBoundingClientRect().bottom;    // 行情栏下沿（视口坐标）
    const cap = (window.innerHeight || 0) * 0.6;          // 遮幕太矮会把卡片挤瘪，留个下限
    const top = Math.max(floor, Math.min(bottom, cap));
    document.documentElement.style.setProperty('--modal-top', Math.round(top) + 'px');
  }
  function showModal(html) {
    syncModalTop();
    const b = $('#mbody');
    b.innerHTML = html;
    // 任何来源的弹窗都会顶掉「同一次决策」的缓存标记：
    // 下次 renderModal 必须重建决策窗，不能因为 key 相同就跳过。
    b.removeAttribute('data-modal-key');
    $('#modal').classList.remove('hidden');
  }
  function hideModal() {
    $('#modal').classList.add('hidden');
    $('#mbody').innerHTML = '';
    $('#mbody').removeAttribute('data-modal-key');
    const card = $('.mcard');
    if (card) card.classList.remove('wide');   // 说明演示用过的加宽卡片要还原
  }
  function amtVal() { const el = $('#amt'); return el ? Math.floor(+el.value) || 0 : 0; }

  function winModal(S) {
    const w = S.winner;
    const bindEnd = () => {
      $('#btn-again').onclick = () => {
        hideModal(); resetHandoff();
        if (window.BGM) window.BGM.play('game');   // 再来一局 → 切回对局 BGM（否则会停在结算曲）
        Engine.start(S.cfg);
      };
      $('#btn-setup').onclick = () => { stopCoach(); location.reload(); };
    };
    if (!w) {
      showModal(`
      <div class="win-box">
        <div class="trophy">💀</div>
        <h2>破产出局 · 对局结束</h2>
        <p>你变卖所有股票后仍资不抵债，被市场淘汰。<br>下次选储蓄更厚的职业、保留现金垫，别让现金流枯竭！</p>
        ${standingsHTML(S)}
        ${statsNoteHTML()}
        <div class="mbtns" style="justify-content:center">
          <button class="btn gold big" id="btn-again">🔄 再来一局</button>
          <button class="btn" id="btn-setup">返回设置</button>
        </div>
      </div>`);
      bindEnd();
      return;
    }
    const last = !!w.lastStanding;
    showModal(`
      <div class="win-box">
        <div class="trophy">${last ? '🏆' : '💰'}</div>
        <h2>${last ? `👑 ${esc(w.name)} 成为最后的幸存者！` : `👑 ${esc(w.name)} 实现财务自由！`}</h2>
        <p>${last
          ? `${esc(w.name)} 笑到最后——其余玩家先后破产出局，它以「${esc(w.prof.name)}」身份赢下这局。`
          : `${esc(w.name)} 用「${esc(w.prof.name)}」身份，靠股票股息实现<b>被动收入 ${money(Engine.h.passive(w))} > 月支出 ${money(Engine.h.expTotal(w))}</b>，彻底跳出仓鼠赛跑！`}
          <br>现金 ${money(w.cash)} · 持仓市值随行情波动</p>
        ${standingsHTML(S)}
        ${statsNoteHTML()}
        <div class="mbtns" style="justify-content:center">
          <button class="btn gold big" id="btn-again">🔄 再来一局</button>
          <button class="btn" id="btn-setup">返回设置</button>
        </div>
      </div>`);
    bindEnd();
  }

  // 破产保护弹窗：实时汇总「已选回笼 / 变卖后现金」，凑够清偿额才允许确认
  function bindLiquidate(p) {
    const inputs = Array.from($('#mbody').querySelectorAll('.liq-inp'));
    const got = $('#liq-got'), after = $('#liq-after'), hint = $('#liq-hint'), ok = $('#btn-liq-ok');
    const collect = () => {
      const sell = {}; let sum = 0;
      inputs.forEach(i => {
        const max = +i.max || 0;
        const n = Math.max(0, Math.min(max, Math.floor(+i.value || 0)));
        if (String(n) !== i.value) i.value = String(n);
        if (n > 0) { sell[i.dataset.sym] = n; sum += n * (+i.dataset.px || 0); }
      });
      return { sell, sum };
    };
    const refresh = () => {
      const { sum } = collect();
      const cash = p.cash + sum;
      if (got) got.textContent = money(sum);
      if (after) { after.textContent = money(cash); after.className = cash >= 0 ? 'pos' : 'neg'; }
      if (ok) ok.disabled = cash < 0;
      if (!hint) return;
      if (cash >= 0) {
        hint.className = 'liq-gap ok';
        hint.innerHTML = '✅ 差额已补齐，点「确认变卖」继续';
        return;
      }
      // 差额提示：一直显示“还差多少”，并给出“再卖 N 股 XX 就够”的建议
      const gap = -cash;
      let tip = '';
      for (const i of inputs) {
        const px = +i.dataset.px || 0;
        const left = Math.max(0, (+i.max || 0) - Math.floor(+i.value || 0));
        const n = px > 0 ? Math.ceil(gap / px) : Infinity;
        if (left > 0 && n <= left) { tip = `（再卖 <b>${n}</b> 股 ${esc(i.dataset.sym)} 就够）`; break; }
      }
      hint.className = 'liq-gap';
      hint.innerHTML = `差额：还差 <b class="neg">${money(gap)}</b> 才能清偿欠款 ${tip}`;
    };
    inputs.forEach(i => i.addEventListener('input', refresh));
    $('#mbody').querySelectorAll('[data-liq-all]').forEach(b => b.addEventListener('click', () => {
      const s = b.dataset.liqAll;
      inputs.forEach(i => { if (s === '*' || i.dataset.sym === s) i.value = i.max; });
      refresh();
    }));
    const rnd = $('#btn-liq-rand');
    if (rnd) rnd.addEventListener('click', () => {
      // 把选择权交给电脑：忽略手填的股数，由引擎随机决定卖哪只、卖多少
      UI.liqRef = null;
      rnd.disabled = true;
      if (ok) ok.disabled = true;
      Act.choose('liquidate', { random: true });
    });
    if (ok) ok.addEventListener('click', () => {
      const { sell } = collect();
      UI.liqRef = null;
      ok.disabled = true;                 // 防手快连点
      Act.choose('liquidate', { sell });
    });
    refresh();
  }

  function renderModal(S) {
    if (S.over) { UI.handoff = null; winModal(S); return; }
    // 玩法说明演示优先级最高（换人交接框在它关闭后会重新弹出，引擎也仍被 gate 闸着，不会被跳过）
    if (UI.guide != null) { renderGuide(); return; }
    if (UI.handoff && !S.pending && !UI.sell) { handoffModal(S); return; }
    const pd = S.pending;
    if (!pd && !UI.sell) { UI.liqRef = null; hideModal(); return; }
    const p = Engine.cur();
    let html = '';
    if (UI.sell && !pd) {
      const sym = UI.sell;
      const h = Engine.h.holding(p, sym);
      const px = Engine.h.curStockPx(sym);
      if (!h) { UI.sell = null; hideModal(); render(); return; }
      // 同一次「卖出」决策不重建 DOM，否则正在输入的股数会被状态广播清空
      const sellKey = 'sell:' + sym + ':' + S.turn + ':' + S.cur;
      const b0 = $('#mbody');
      if ($('#modal') && !$('#modal').classList.contains('hidden')
          && b0.getAttribute('data-modal-key') === sellKey) return;
      html = `<h3>📤 卖出 ${h.icon} ${esc(h.name)}</h3>
        <div class="ptext">现价 <span class="money">${money(px)}</span>/股 · 你持有 ${h.shares} 股（成本 ${money(h.avg)}）<br>预计到账 <b id="sell-total">${money(px * h.shares)}</b></div>
        <label class="amount">卖出股数（最多 ${h.shares}）</label>
        <input id="amt" class="amount" type="number" min="1" max="${h.shares}" value="${h.shares}">
        <div class="mbtns">
          <button class="btn green" id="btn-sell-ok">确认卖出</button>
          <button class="btn" id="btn-sell-no">取消</button>
        </div>`;
      showModal(html);
      b0.setAttribute('data-modal-key', sellKey);
      const input = $('#amt');
      input.addEventListener('input', () => {
        const n = Math.min(h.shares, Math.max(1, Math.floor(+input.value) || 0));
        $('#sell-total').textContent = money(px * n);
      });
      $('#btn-sell-ok').onclick = () => {
        const n = Math.min(h.shares, Math.max(1, Math.floor(+input.value) || 0));
        UI.sell = null;
        Act.sell(sym, n);
        render();
      };
      $('#btn-sell-no').onclick = () => { UI.sell = null; render(); };
      return;
    }
    switch (pd.type) {
      case 'stock': {
        const st = S.market.find(m => m.sym === pd.sym);
        // 联机快照偶尔缺行情条目时，绝不能让 render() 抛异常中断整条渲染链
        // （旧版会表现为「翻到机会卡后整个界面卡住、按钮全失效」）
        if (!st) {
          html = `<h3>💼 股票机会卡</h3>
            <div class="ptext">行情数据尚未就绪，可先跳过本次机会。</div>
            <div class="mbtns"><button class="btn" data-act="pass">跳过</button></div>`;
          break;
        }
        const isDiv = pd.cat === 'div';
        const maxShares = Math.floor(p.cash / pd.price);
        const gainHint = (() => {
          const h = Engine.h.holding(p, pd.sym);
          if (h) return `<div style="color:#7d90b8;font-size:12px;margin-top:6px">你当前持有 ${h.shares} 股，成本 ${money(h.avg)}</div>`;
          return '';
        })();
        const tArr = (st.hist && st.hist.length ? st.hist : []).concat([st.px]);
        const tLo = Math.min.apply(null, tArr), tHi = Math.max.apply(null, tArr);
        html = `<h3>${st.icon} ${esc(st.name)}（${st.sym}）</h3>
          <div class="ptext">${isDiv ? '💰 红利股' : '🚀 成长股'}机会卡<br>当前市价 <span class="money">${money(pd.price)}</span>/股 · 你的现金 ${money(p.cash)}</div>
          ${isDiv ? `<div class="yield">每股月股息 <b class="pos">${money(st.div)}</b>（买 ${1000} 股 ≈ 月入 ${money(st.div * 1000)}）</div>` : '<div style="color:#ffb0e0">⚠️ 无股息，靠低买高卖博差价</div>'}
          ${gainHint}
          <div class="mchart">${trendChartSVG(st, 72)}</div>
          <div class="mchart-meta">
            <span>近段区间 ${money(tLo)} ~ ${money(tHi)}</span>
            <span>一格 = 掷骰一次</span>
          </div>
          <label class="amount">购买股数（现金可买最多 ${maxShares} 股）</label>
          <input id="amt" class="amount" type="number" min="0" max="${Math.max(0, maxShares)}" value="${Math.max(0, Math.min(maxShares, Math.min(isDiv ? 200 : 100, maxShares)))}">
          <div class="mbtns">
            <button class="btn green" data-act="buy" ${maxShares > 0 ? '' : 'disabled'}>买入</button>
            <button class="btn" data-act="pass">放弃</button>
          </div>
          ${maxShares > 0 ? '' : '<div class="sub">现金不足买入 1 股</div>'}`;
        break;
      }
      case 'house': {
        const h = pd.house;
        const afford = p.cash >= h.down;
        // 按钮始终可点：先问"是否买房"，玩家点“是”后才由引擎判定资金并提示不足
        html = `<h3>🏠 是否买房？</h3>
          ${pd.at ? `<div class="sub">触发位置：${esc(pd.at)} — 买房不是独立格子，机会藏在股票格里</div>` : ''}
          <div class="ptext">你看中了一套 ${h.icon} ${esc(h.name)}<br>首付（大额支出）<span class="money">${money(h.down)}</span> · 新增月供 ${money(h.m)}<br><b style="color:#ff6b6b">注意：自住房不产生任何收入，反而加重月支出！</b></div>
          <div class="ptext">你的现金：<span class="money">${money(p.cash)}</span> ${afford
            ? '<span style="color:#3ddc97">（够付首付）</span>'
            : `<span style="color:#ff6b6b">（还差 ${money(h.down - p.cash)}，点“是”会提示资金不足）</span>`}</div>
          <div class="mbtns">
            <button class="btn green" data-act="buy">✅ 是，我要买房</button>
            <button class="btn" data-act="pass">❌ 否，放弃</button>
          </div>`;
        break;
      }
      // 通知型弹窗：只有「确定」，点掉才扣款（引擎在 choose 里处理）
      case 'doodad': {
        const d = pd.doodad;
        const left = p.cash - pd.amt;
        html = `<h3>🛍️ 意外支出</h3>
          <div class="ptext">你遇到了「${d.icon} ${esc(d.name)}」 —— ${esc(d.desc || '')}</div>
          <div class="ptext">本次支出：<span class="money neg">−${money(pd.amt)}</span>${pd.big ? ' <b style="color:#ff6b6b">（大额意外）</b>' : ''}<br>
            你的现金：${money(p.cash)} → <b class="${left >= 0 ? 'pos' : 'neg'}">${money(left)}</b></div>
          ${left >= 0 ? '' : '<div class="liq-gap">⚠️ 现金不足，确定后将触发破产保护（变卖股票清偿）</div>'}
          <div class="mbtns"><button class="btn green" type="button" data-act="doodad">✅ 确定</button></div>`;
        break;
      }
      // 通知型弹窗：只有「确定」，点掉才扣款（引擎在 choose 里处理）
      case 'tax': {
        const left = p.cash - pd.amt;
        html = `<h3>🧾 交税</h3>
          <div class="ptext">税务机关找上门了 —— 按你当前收入水平计征：</div>
          <div class="ptext">① 收入法：（工资＋被动收入）×6% = ${money(pd.byIncome)}<br>
            ② 资产封顶：总资产 ${money(pd.assets)}（现金＋股票市值）×1% = ${money(pd.byAssets)}<br>
            取两者较小值 ⇒ 本次应缴 <span class="money neg">−${money(pd.amt)}</span></div>
          <div class="ptext">你的现金：${money(p.cash)} → <b class="${left >= 0 ? 'pos' : 'neg'}">${money(left)}</b></div>
          ${left >= 0 ? '' : '<div class="liq-gap">⚠️ 现金不足，确定后将触发破产保护（变卖股票清偿）</div>'}
          <div class="mbtns"><button class="btn green" type="button" data-act="tax">✅ 确定缴税</button></div>`;
        break;
      }
      case 'charity': {
        html = `<h3>🕊️ 慈善捐赠</h3>
          <div class="ptext">捐出 <span class="money">${money(pd.donation)}</span> 帮助他人。<br>
            回报：获得一次<b>掷两颗骰子</b>的机会 —— 但会<b>攒到你的下一回合</b>才兑现，本回合不再追加掷骰。</div>
          <div class="mbtns">
            <button class="btn green" data-act="donate" ${p.cash >= pd.donation ? '' : 'disabled'}>捐出 ${money(pd.donation)}</button>
            <button class="btn" data-act="pass">婉拒，结束回合</button>
          </div>`;
        break;
      }
      case 'liquidate': {
        // 规则：真人玩家现金为负时，由他自己决定卖哪只、卖多少股（AI 由引擎自动变卖）
        const need = pd.deficit;
        const stocks = (p.stocks || []).slice()
          .sort((a, b) => b.shares * Engine.h.curStockPx(b.sym) - a.shares * Engine.h.curStockPx(a.sym));
        const allIn = stocks.reduce((s, a) => s + a.shares * Engine.h.curStockPx(a.sym), 0);
        const canClear = p.cash + allIn >= 0;
        const row = a => {
          const px = Engine.h.curStockPx(a.sym), val = a.shares * px;
          const gain = a.avg ? (px - a.avg) / a.avg : 0;
          return `<div class="liq-pick" style="border-left:3px solid ${a.div > 0 ? 'var(--gold)' : 'var(--blue)'}">
            <div class="lp-info">
              <span class="lp-ic">${a.icon}</span>
              <div>
                <div class="lp-nm">${esc(a.name)}<small>${a.sym} · ${a.div > 0 ? '💰红利股（每月产股息，卖了会掉被动收入）' : '🚀成长股（无股息）'}</small></div>
                <div class="lp-dt">持仓 <b>${a.shares}</b> 股 · 现价 ${money(px)} · 市值 <b>${money(val)}</b> · 成本 ${money(a.avg)} <b class="${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}${Math.round(gain * 100)}%</b></div>
              </div>
            </div>
            <div class="lp-act">
              <button class="btn ghost sm" type="button" data-liq-all="${a.sym}">全卖</button>
              <input class="liq-inp" type="number" min="0" max="${a.shares}" step="1" value="0" data-sym="${a.sym}" data-px="${px}">
            </div>
          </div>`;
        };
        html = canClear
          ? `<h3>🏦 破产保护 · 自己决定变卖哪些资产</h3>
            <div class="ptext">你的现金是 <b class="neg">${money(p.cash)}</b>，必须回笼 <b class="neg">${money(need)}</b> 才能过关。<br>填要卖的股数（按当前市价成交），没凑够会一直提示差额：</div>
            <div class="liq-pick-list">${stocks.map(row).join('')}</div>
            <div class="ptext">已选回笼 <b id="liq-got" class="pos">${money(0)}</b> · 变卖后现金 <b id="liq-after" class="neg">${money(p.cash)}</b></div>
            <div class="liq-gap" id="liq-hint">差额：还差 <b class="neg">${money(need)}</b> 才能清偿欠款</div>
            <div class="mbtns">
              <button class="btn" type="button" data-liq-all="*">全部卖出</button>
              <button class="btn" type="button" id="btn-liq-rand">🎲 随机变卖（交给电脑）</button>
              <button class="btn green" id="btn-liq-ok" type="button" disabled>✅ 确认变卖，清偿欠款</button>
            </div>
            <div class="sub">「🎲 随机变卖」= 让电脑随机决定卖哪些、卖多少股，自动帮你补齐差额。</div>`
          : `<h3>🏦 破产保护 · 已无法清偿</h3>
            <div class="ptext">你的全部持仓市值只有 <b>${money(allIn)}</b>，即使全部卖出也填不上 <b class="neg">${money(need)}</b> 的缺口 —— 只能宣告破产出局。</div>
            <div class="mbtns"><button class="btn" data-act="liquidate" data-giveup="1">💀 确认破产出局</button></div>`;
        break;
      }
    }
    if (!html) return;
    /* ★ 同一次决策期间绝不重建弹窗 DOM。
       旧版只对 liquidate 用 UI.liqRef === pd（对象引用）做保护，但联机每次
       applyState 都 hydrate 一个全新对象，引用永远不相等 → 每收到一次状态广播
       就把 #mbody.innerHTML 换掉：玩家填的股数被清空、焦点丢失，点击恰好落在
       被替换的节点上就「点了没反应」，表现为「生成事件时卡住」。
       改用「决策签名 + DOM 上的标记」，单机/联机同样可靠。 */
    const key = JSON.stringify([
      S.turn, S.cur, pd && pd.type, pd && pd.sym, pd && pd.price,
      pd && pd.amt, pd && pd.donation, pd && pd.deficit,
      pd && pd.house && pd.house.name, UI.sell || ''
    ]);
    const box = $('#mbody');
    const visible = $('#modal') && !$('#modal').classList.contains('hidden');
    if (box && visible && box.getAttribute('data-modal-key') === key) return;
    showModal(html);
    box.setAttribute('data-modal-key', key);
    if (pd.type === 'liquidate' && $('#btn-liq-ok')) bindLiquidate(p);
    $('#mbody').querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      const payload = {};
      if (act === 'buy') payload.amount = amtVal();
      if (act === 'liquidate') payload.giveUp = b.dataset.giveup === '1';
      Act.choose(act, payload);
    }));
  }

  /* ================= 日志 & Toast ================= */
  // 日志面板常驻 index.html（初始 hidden）：隐藏时不重排 DOM 省性能，
  // 打开时由按钮回调立即回填一次，因此点开就有内容、不必等下一次引擎渲染。
  function renderLog(S) {
    const panel = $('#logpanel');
    if (!panel || panel.classList.contains('hidden')) return;
    const el = $('#log-list');
    if (!el) return;
    const html = S.logs.map(l => `<div><span class="${l.cls}">${esc(l.msg)}</span></div>`).join('');
    if (el.innerHTML === html) return;   // 无新日志不重绘，避免打断阅读/滚动
    el.innerHTML = html;
    el.scrollTop = 0;                    // log() 用 unshift，最新一条在顶部
  }
  function renderToasts(S) {
    if (!S.toasts.length) return;
    S.toasts.splice(0).forEach(t => {
      const el = document.createElement('div');
      el.className = 'toast-item ' + (t.cls || '');
      el.innerHTML = esc(t.msg);
      $('#toast').appendChild(el);
      setTimeout(() => el.remove(), 2200);
    });
  }

  /* ================= 设置页规则说明（由 data.js RULES 数据驱动） ================= */
  function renderRules() {
    const el = $('#rules-list');
    if (!el || !CF.RULES) return;
    el.innerHTML = CF.RULES.map(r => `<li><b>${esc(r.lead)}：</b>${esc(r.body)}</li>`).join('');
  }

  /* ================= 设置页棋盘图例（由 TYPE_INFO + 布局顺序生成） ================= */
  function renderLegend() {
    const el = $('#legend-list');
    if (!el || !CF.TYPE_INFO) return;
    const order = [];
    CF.HAMSTER_LAYOUT.forEach(t => { if (order.indexOf(t) < 0) order.push(t); });
    el.innerHTML = order.map(t => {
      const c = CF.TYPE_INFO[t];
      return `<li><span class="li-ic">${c.ic}</span><div><span class="li-name">${esc(c.name)}</span><span class="li-desc">${esc(c.desc)}</span></div></li>`;
    }).join('');
  }

  /* ================= 设置页：本机跨局战绩排行（数据来自 CF.Stats） ================= */
  function renderStats() {
    const panel = $('#stats-panel'), body = $('#stats-body');
    if (!panel || !body || !CF.Stats) return;
    const sum = CF.Stats.summary();
    if (!sum.games) { panel.classList.add('hidden'); body.innerHTML = ''; return; }
    const medal = i => ['🥇', '🥈', '🥉'][i] || String(i + 1);
    panel.classList.remove('hidden');
    body.innerHTML = `
      <div class="stats-sum">共 <b>${sum.games}</b> 局 · 平均每局 <b>${sum.avgTurns.toFixed(1)}</b> 回合</div>
      <table class="stats-tb">
        <tr><th>#</th><th>玩家</th><th>胜场</th><th>胜率</th><th>破产</th><th class="r">平均出圈</th></tr>
        ${CF.Stats.rows().map((r, i) => `<tr class="${i === 0 ? 'top' : ''}">
          <td class="rk">${medal(i)}</td>
          <td>${esc(r.name)}${r.ai ? ' <i class="ai-mark">AI</i>' : ''}<small>出场 ${r.games} 局 · 财务自由 ${r.freedom} · 幸存 ${r.last}</small></td>
          <td><b>${r.wins}</b></td>
          <td>${Math.round(r.winRate * 100)}%</td>
          <td class="${r.bankrupt ? 'neg' : 'dim'}">${r.bankrupt}</td>
          <td class="r">${r.avgWinTurns == null ? '—' : r.avgWinTurns.toFixed(1)}</td>
        </tr>`).join('')}
      </table>
      <button class="btn sm ghost" id="btn-stats-reset" type="button">🗑 清空战绩</button>`;
    body.querySelector('#btn-stats-reset').addEventListener('click', () => {
      if (!window.confirm('确定清空本机所有战绩记录？此操作不可恢复。')) return;
      CF.Stats.reset();
      renderStats();
    });
  }

  /* ================= 玩法说明演示（给完全不会玩的人看） ================= */
  /* 从「这局要干嘛」一路讲到「坑与补救」，共 7 页，可翻页 / 点圆点跳页。
     内容尽量用游戏里的真实数据（格型 TYPE_INFO、行情分组等）生成，避免与实际规则脱节。 */
  const GUIDE = [
    {
      t: '🎯 这局到底要干嘛',
      b: `<p class="g-lead">一句话：<b>买红利股吃股息，让「每月被动收入 ＞ 每月总支出」。</b></p>
        <div class="g-formula">月现金流 ＝ 工资 ＋ 股息被动收入 − 月支出</div>
        <ul class="g-ul">
          <li><b>被动收入</b>＝你手上所有红利股，每股每月自动发的股息之和（不干活也进账）。</li>
          <li><b>月支出</b>＝职业给的固定开销（税、房租、车贷、信用卡…），还清欠款后对应那一项会消失。</li>
          <li><b>怎么算赢</b>：走到 💵 银行结算日、完成结算那一刻，若 <b class="pos">股息被动收入 ＞ 月支出</b> → 立刻跳出仓鼠圈，胜出。</li>
          <li><b>怎么算输</b>：现金变负、变卖全部股票仍填不上缺口 → 破产出局；场上只剩一人时，那人直接获胜。</li>
        </ul>
        <div class="g-tip">💡 工资只是让你活下去，<b>出圈靠的是股息</b>——所以钱要花在能下蛋的红利股上。</div>`
    },
    {
      t: '🖥️ 界面每一块是干什么的',
      b: `<div class="g-map">
        <div class="g-row"><b>👆 顶栏</b><span>左边显示「现在轮到谁、该干嘛」；右边是 📜 事件日志、退出。</span></div>
        <div class="g-row"><b>📈 行情条</b><span>全部股票的实时价格与迷你走势（绿涨红跌）。<b>点某只股票</b>可以在左侧看它的大走势图。</span></div>
        <div class="g-row"><b>🎯 左栏</b><span>财务自由进度条（股息覆盖月支出百分之多少）、我的持仓（自己回合可随时卖）、还清负债。</span></div>
        <div class="g-row"><b>🐹 中间轮盘</b><span>24 格仓鼠圈。发金光的格子＝当前玩家所在位置；正中央显示 TA 的进度与全盘图例。</span></div>
        <div class="g-row"><b>📊 右栏</b><span>月收支表 ＋ 资产负债表。点底部玩家卡可以改看<b>别人</b>的报表。</span></div>
        <div class="g-row"><b>👥 底部玩家卡</b><span>每家的现金 / 股息 / 月支出 / 持股。左边那颗<b>棋子</b>就是 TA 在棋盘上的样子（形状＋颜色＋编号）。</span></div>
      </div>
      <div class="g-tip">💡 认人三件套：<b>名字</b>（自己填或随机取的）、<b>棋子形状</b>、<b>颜色</b>——盘面上看编号最快。</div>`
    },
    {
      t: '🐹 棋盘上每一格是什么意思',
      b: `<p class="g-lead">共 24 格，从 💵 结算日起<b>顺时针</b>走，走满一圈回到起点；踩到什么格就触发什么事。</p>
        <div class="g-cells">${Object.keys(CF.TYPE_INFO).map(k => {
          const t = CF.TYPE_INFO[k];
          return `<div class="g-cell ${t.cls}"><span class="gc-ic">${t.ic}</span>
            <div><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></div></div>`;
        }).join('')}</div>`
    },
    {
      t: '📈 股票：红利股 vs 成长股',
      b: `<div class="g-cmp">
        <div class="g-box div">
          <h5>💰 红利股 · 出圈的钥匙</h5>
          <p>每持 <b>1 股每月自动发股息</b>，直接计入被动收入。价格也会涨跌，但幅度温和。</p>
          <p class="g-k">作用：<b>把现金换成每月稳定现金流</b>，攒够了就赢。</p>
        </div>
        <div class="g-box grw">
          <h5>🚀 成长股 · 博差价的杠杆</h5>
          <p><b>没有股息</b>，价格大起大落（常有 ±10%~40% 的大新闻）。</p>
          <p class="g-k">作用：<b>低买高卖赚一笔快钱</b>，再把钱换回红利股。</p>
        </div>
      </div>
      <ul class="g-ul">
        <li><b>怎么买</b>：踩到 💰 或 🚀 格会翻机会卡，填股数 → 买入（按当时市价成交）。</li>
        <li><b>怎么卖</b>：轮到自己、还没掷骰前，可在左栏「我的持仓」随时按现价卖出。</li>
        <li><b>行情</b>：每有人掷一次骰，全市场波动一次。行情条每只股票下面的小图＝近 14 次走势。</li>
        <li><b>看收益</b>：红利股看「每股月股息」，成长股看「现价 vs 你的成本」。</li>
      </ul>`
    },
    {
      t: '🎲 一个回合是这样走的',
      b: `<ol class="g-steps">
        <li><b>弹出「轮到 XX」交接框</b> —— 点「✅ 我准备好了」（电脑玩家也一样会弹，让大家知道现在是谁在动）。</li>
        <li><b>可以先卖出持仓</b>（左栏「我的持仓」），腾出现金再行动。</li>
        <li><b>点 🎲 掷骰子</b> —— 棋子一格一格往前走，停在那一格。</li>
        <li><b>触发那格的事件</b>：翻机会卡 / 扣意外支出 / 交税 / 慈善 / 失业…弹窗里做决定。</li>
        <li><b>经过 💵 结算日</b>：现金 ＋＝（工资 ＋ 股息 − 月支出）。这一步也是判定胜负的时刻。</li>
        <li><b>自动换下一位</b>，同样先弹交接框。</li>
      </ol>
      <div class="g-tip">💡 捐过款会攒一次双骰，<b>下一回合</b>轮到你时才掷两颗（不会当场再掷一次）。</div>`
    },
    {
      t: '⚠️ 路上有哪些坑，怎么补救',
      b: `<div class="g-cells">
        <div class="g-cell doodad"><span class="gc-ic">🏠</span><div><b>买房陷阱</b><small>藏在 💰/🚀 格里偶尔翻出：付首付＋永久月供，<b>不产生任何收入</b>，反而抬高月支出。多数情况选「否」。</small></div></div>
        <div class="g-cell tax"><span class="gc-ic">🧾</span><div><b>交税 / 🛍️ 意外支出</b><small>会先弹窗告诉你金额，点「确定」才真的扣钱。</small></div></div>
        <div class="g-cell bad"><span class="gc-ic">🛑</span><div><b>失业</b><small>失去工资，生活费缺口用存款垫一半，并<b>停一回合</b>。被动收入越多越不怕。</small></div></div>
        <div class="g-cell charity"><span class="gc-ic">🕊️</span><div><b>慈善</b><small>自愿捐款，换一次双骰（下一回合兑现）。</small></div></div>
        <div class="g-cell payday"><span class="gc-ic">🏦</span><div><b>破产保护</b><small>现金变负时弹出：你自己挑卖哪只、卖多少股（也可点 🎲 随机交给电脑）；卖光仍不够就出局。</small></div></div>
        <div class="g-cell stockD"><span class="gc-ic">✅</span><div><b>主动还债</b><small>左栏「还清负债」全额还掉车贷/房贷后，那一项月供<b>立刻归零</b>，出圈门槛直接降低。</small></div></div>
      </div>`
    },
    {
      t: '💡 名词表 & 取胜小技巧',
      b: `<div class="g-terms">
        <div><b>被动收入</b><span>不用上班也进账的钱＝你所有红利股的月股息之和。</span></div>
        <div><b>月现金流</b><span>工资＋股息−月支出，每月真实增减的现金。</span></div>
        <div><b>净资产</b><span>现金＋股票市值−负债，衡量你到底多有钱。</span></div>
        <div><b>成本价</b><span>你买入该股的平均价格，与现价对比就是浮盈浮亏。</span></div>
      </div>
      <ul class="g-ul">
        <li><b>优先买红利股</b>：它是唯一能直接推高「股息/月支出」这条进度条的东西。</li>
        <li><b>留现金垫</b>：别把钱全买光，遇到意外支出/交税会很难受。</li>
        <li><b>成长股见好就收</b>：赚到差价就换回红利股，落袋为安。</li>
        <li><b>先还高月供的债</b>：还清一项，月支出立刻下降，等于进度条白涨一截。</li>
        <li><b>别急着买房</b>：自住房不出租金，只会拖慢你出圈。</li>
      </ul>
      <div class="g-tip">🎉 就这些。点「开始游戏」，第一手会弹出交接框告诉你轮到谁——照着点就行。</div>`
    }
  ];

  function guideHTML() {
    const i = Math.max(0, Math.min(GUIDE.length - 1, UI.guide || 0));
    UI.guide = i;
    const last = i === GUIDE.length - 1;
    return `<div class="guide">
      <div class="g-head">
        <span class="g-badge">📖 玩法说明演示</span>
        <span class="g-step">${i + 1} / ${GUIDE.length}</span>
        <button class="g-x" id="g-x" type="button" title="关闭说明">✕</button>
      </div>
      <h3 class="g-title">${GUIDE[i].t}</h3>
      <div class="g-body">${GUIDE[i].b}</div>
      <div class="g-nav">
        <button class="btn sm" type="button" id="g-prev" ${i === 0 ? 'disabled' : ''}>← 上一步</button>
        <div class="g-dots">${GUIDE.map((p, k) =>
          `<span class="g-dot${k === i ? ' on' : ''}" data-g="${k}" title="${esc(p.t)}"></span>`).join('')}</div>
        ${last
          ? `<button class="btn green" type="button" id="g-close">✅ 我知道了，开始玩</button>`
          : `<button class="btn primary" type="button" id="g-next">下一步 →</button>`}
      </div>
      <div class="g-foot">随时点右上角 ✕ 关闭；游戏进行中可点顶栏「📖 玩法」再次翻开。</div>
    </div>`;
  }
  function renderGuide() {
    showModal(guideHTML());
    const card = $('.mcard');
    if (card) card.classList.add('wide');
    const prev = $('#g-prev'), next = $('#g-next'), close = $('#g-close');
    if (prev) prev.onclick = () => { UI.guide--; renderGuide(); };
    if (next) next.onclick = () => { UI.guide++; renderGuide(); };
    if (close) close.onclick = closeGuide;
    const x = $('#g-x');
    if (x) x.onclick = closeGuide;
    $('#mbody').querySelectorAll('.g-dot').forEach(d => {
      d.style.cursor = 'pointer';
      d.onclick = () => { UI.guide = +d.dataset.g; renderGuide(); };
    });
  }
  function openGuide() {
    UI.guide = 0;
    if (Engine.state()) render();      // 局中：走渲染流程，关闭后能回到原来的弹窗
    else renderGuide();                // 设置页：没有游戏状态，直接弹
  }
  function closeGuide() {
    UI.guide = null;
    UI.liqRef = null;                  // 若之前停在破产变卖弹窗，关闭说明后重建它
    if (Engine.state()) render(); else hideModal();
  }

  /* ================= 语音解说（Web Speech API · 离线走系统 TTS） ================= */
  /* 系统自带的中文 TTS 没有真正的“二次元萝莉音”，这里的做法是三层叠加去逼近它：
       ① 优先挑【年轻女声】（晓晓/晓伊/遥遥/慧慧…按装机情况依次找）；
       ② 大幅提高音调 pitch 1.75（萝莉）/ 1.4（少女）；
       ③ 语速略快 rate 1.10，听起来更软萌有精神。
     全离线：不联网、不需要任何 Key，装了中文语音包就能念。
     另外每一张卡都配了专门的【口播稿 s】，比屏幕文字短，避免念到一半被下一张打断。 */
  const VOICE_KEY = 'dividendflow.voice.v1';
  const TONES = [
    { k: 'loli', name: '萝莉音', pitch: 1.75, rate: 1.10 },
    { k: 'girl', name: '少女音', pitch: 1.40, rate: 1.05 },
    { k: 'plain', name: '原声', pitch: 1.00, rate: 1.00 }
  ];
  // 中文年轻女声优先表（各家 Windows 装的语音包不同，能找到哪个用哪个）
  const VOICE_PREF = ['Xiaoxiao', '晓晓', 'Xiaoyi', '晓伊', 'Yaoyao', '遥遥', 'Xiaohan', '晓涵', 'Huihui', '慧慧', 'Female', '女'];
  const SAY = { ready: false, on: true, voices: [], vname: '', tone: 'loli' };

  const canSay = () => typeof window !== 'undefined' && 'speechSynthesis' in window
    && typeof window.SpeechSynthesisUtterance === 'function';
  function loadSayCfg() {
    try {
      const d = JSON.parse(localStorage.getItem(VOICE_KEY) || '{}');
      if (typeof d.on === 'boolean') SAY.on = d.on;
      if (typeof d.vname === 'string') SAY.vname = d.vname;
      if (d.tone) SAY.tone = d.tone;
    } catch (e) { /* 存档不可用时用默认值 */ }
  }
  function saveSayCfg() {
    try { localStorage.setItem(VOICE_KEY, JSON.stringify({ on: SAY.on, vname: SAY.vname, tone: SAY.tone })); }
    catch (e) { /* 忽略 */ }
  }
  /* 当前语言对应的 TTS 前缀（zh / en / ja / fr / ru）——语音跟随所选语言 */
  function curVoicePrefix() {
    const t = 'zh-CN';
    return String(t).slice(0, 2).toLowerCase();
  }
  function zhVoices() {
    if (!canSay()) return [];
    const p = curVoicePrefix();
    return (window.speechSynthesis.getVoices() || []).filter(v => String(v.lang || '').toLowerCase().startsWith(p));
  }
  function bestVoice() {
    if (!SAY.voices.length) return null;
    if (SAY.vname === '__default') return null;
    const named = SAY.voices.find(v => v.name === SAY.vname);
    if (named) return named;
    for (const key of VOICE_PREF) {
      const hit = SAY.voices.find(v => v.name.indexOf(key) >= 0);
      if (hit) return hit;
    }
    return SAY.voices[0] || null;
  }
  function initSay() {
    if (!canSay()) return;
    const grab = () => { SAY.voices = zhVoices(); if (SAY.voices.length) SAY.ready = true; };
    grab();
    window.speechSynthesis.onvoiceschanged = grab;   // 首次通常为空，靠这个事件补齐
    setTimeout(grab, 1200);                          // 兜底再取一次
  }
  // 口播稿：去掉 HTML、emoji 与修饰符号，只念干干净净的中文
  function sayPlain(raw) {
    return String(raw || '')
      .replace(/<br\s*\/?>/gi, '，')
      .replace(/<[^>]+>/g, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
      .replace(/&[a-z]+;/gi, '')
      .replace(/[·、]/g, '，')
      .replace(/\s+/g, '')
      .trim();
  }
  function toneCfg() { return TONES.find(t => t.k === SAY.tone) || TONES[0]; }
  // 估算念完要多久（毫秒）：中文大约每秒 4.6 个字 × 语速倍率
  function sayMs(txt) {
    return Math.round(String(txt || '').length / (4.6 * toneCfg().rate) * 1000);
  }
  function sayText(raw) {
    if (!SAY.on || !canSay()) return;
    const txt = sayPlain(raw);
    if (!txt) return;
    try {
      window.speechSynthesis.cancel();
      const u = new window.SpeechSynthesisUtterance(txt);
      const t = toneCfg();
      u.lang = 'zh-CN';
      const v = bestVoice();
      if (v) u.voice = v;
      u.pitch = t.pitch;
      u.rate = t.rate;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 环境不支持时静默降级为纯文字讲解 */ }
  }
  function stopSay() { if (canSay()) { try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略 */ } } }
  // 口播内容：卡片自带的短稿 s 优先，没有才退回念标题+正文
  function sayCard(c) {
    if (!c) return;
    sayText(c.s || (c.t + '。' + c.b));
  }

  /* ================= 新手教学：AI 边玩边讲 ================= */
  /* 与其让人读长篇文字，不如让 4 个 AI 真打一局，旁边的解说条同步讲解：
     · 开场先做一轮「界面导览」，用高亮框指着讲每块区域是干什么的；
     · 之后进入实战解说：换人、掷骰、踩格子、翻卡、结算……发生了什么就讲什么；
     · 教学期间放慢 AI 节奏（aiRollMs 900→1800、aiChooseMs 700→2800），让每个弹窗和讲解都看得清；
     · 不弹「换人交接框」（改由解说条说明），保证演示连续、无需点击。 */
  const COACH = { on: false, intro: false, card: null, next: null, busy: false, hl: null, timer: null, timing: null,
    voiceOn: false, hold: false, _diceRef: null }; // hold=讲解卡在读时冻结引擎；_diceRef=本组骰子去重掷骰卡
  // 把“是否冻结引擎”暴露给引擎：教练模式且正在讲解（hold）时，引擎定时器被挂起
  try { Engine._coachGate = () => COACH.on && COACH.hold; } catch (e) {}
  const COACH_DWELL = 2800;      // 每张实战讲解卡最短停留（ms）
  const COACH_INTRO_MS = 3300;   // 开场导览每页停留（ms，无语音时）

  /* ---- 语音解说（Web Speech API，高音调模拟二次元萝莉音）---- */
  // 说明：浏览器/Electron 的系统 TTS 无法真正“定制音色”成二次元萝莉音，这里用
  // zh-CN 女声 + 高 pitch(1.8) + 略慢 rate(0.95) 来营造稚嫩、亲和的萝莉感。
  // 若本机没装中文语音就会读不出中文（按钮自动变“不支持”）。要更逼真的定制萝莉音
  // 需接入云端 TTS（火山/腾讯/微软的甜美女声），那需要 API key + 联网，另做模块。
  function canSpeak() { return typeof window.speechSynthesis !== 'undefined'; }
  let COACH_VOICES = [];
  function coachLoadVoices() {
    if (!canSpeak()) return;
    try { COACH_VOICES = speechSynthesis.getVoices() || []; } catch (e) { COACH_VOICES = []; }
  }
  if (canSpeak()) { coachLoadVoices(); try { speechSynthesis.onvoiceschanged = coachLoadVoices; } catch (e) {} }
  // 当前语言是否有可用语音包（没有则不朗读，仅显示文字）
  function hasVoice() {
    const p = curVoicePrefix();
    return COACH_VOICES.some(v => String(v.lang || '').toLowerCase().startsWith(p));
  }
  function coachPickVoice() {
    const p = curVoicePrefix();
    const zh = COACH_VOICES.filter(v => String(v.lang || '').toLowerCase().startsWith(p));
    if (!zh.length) return null;
    const fem = zh.find(v => /female|女|晓|婷|美|雅|瑶| Xiao|Yaoyao|Xiaoxiao|Huihui|Lili|Mei|Yue|Yan/i.test(v.name));
    return fem || zh[0];
  }
  // 语音讲解期间把 BGM 压低、播完恢复；onend 有时不触发 → 再用 speaking 轮询兜底
  let _duckTimer = null;
  function bgmDuck(on) {
    if (!window.BGM) return;
    window.BGM.duck(on);
    if (_duckTimer) { clearInterval(_duckTimer); _duckTimer = null; }
    if (!on) return;
    const t0 = Date.now();
    _duckTimer = setInterval(() => {
      let speaking = false;
      try { speaking = !!(window.speechSynthesis && speechSynthesis.speaking); } catch (e) {}
      if (!speaking || Date.now() - t0 > 60000) {   // 60s 安全上限，防卡住不恢复
        clearInterval(_duckTimer); _duckTimer = null;
        if (window.BGM) window.BGM.duck(false);
      }
    }, 300);
  }
  function speakVoice(text, onEnd) {
    if (!canSpeak() || !text) { if (onEnd) onEnd(); return false; }
    try {
      speechSynthesis.cancel();                 // 打断上一段
      const u = new SpeechSynthesisUtterance(text);
      const v = coachPickVoice();
      if (v) u.voice = v;
      u.lang = 'zh-CN';
      u.pitch = 1.8;                            // 偏高 → 萝莉感
      u.rate = 0.95;                            // 略慢，清晰亲切
      u.volume = 1;
      const finish = () => { bgmDuck(false); if (onEnd) onEnd(); };
      u.onend = finish; u.onerror = finish;
      bgmDuck(true);                            // 讲解开始 → 压低 BGM，保证人声清晰
      speechSynthesis.speak(u);
      return true;
    } catch (e) { bgmDuck(false); if (onEnd) onEnd(); return false; }
  }
  function stopVoice() { try { if (canSpeak()) speechSynthesis.cancel(); } catch (e) {} bgmDuck(false); }
  // 用户偏好：默认开语音；若关过一次(localStorage='0')则下次默认关
  try { COACH.voiceOn = (localStorage.getItem('cf_coach_voice') || '1') !== '0'; } catch (e) { COACH.voiceOn = true; }
  // 把卡片里的 HTML 讲稿（c.b）兜底转成纯文本（正常都会用更口语的 c.s）
  function coachPlain(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }

  const COACH_INTRO = [
    { t: '🎯 游戏目标', target: null,
      s: '欢迎来到股息流！你的目标很简单：买红利股吃股息，让每月的被动收入超过月支出，走到结算日就能跳出仓鼠圈，获得胜利哦！',
      b: '让<b>股息被动收入 ＞ 月支出</b>。走到 💵 银行结算日完成结算时若已满足，当场跳出仓鼠圈、胜出。' },
    { t: '📈 顶部行情条', target: '#marketbar',
      s: '这是顶部行情条，显示所有股票的实时价格和走势，绿色是涨、红色是跌。每次有人掷骰，全市场都会波动一次。',
      b: '所有股票的实时价格与迷你走势，<b>绿涨红跌</b>。每有人掷一次骰，全市场波动一次；点某只股票可在左栏看大图。' },
    { t: '🎯 左栏：出圈进度', target: '#col-left',
      s: '左边是你的财务自由进度条，显示股息能覆盖多少月支出。下面可以卖掉股票，也可以全额还清负债。',
      b: '<b>进度条</b>＝股息能覆盖月支出的百分比；下面是<b>我的持仓</b>（轮到自己时可随时按现价卖）和<b>可全额还清的负债</b>。' },
    { t: '🐹 中间轮盘：仓鼠圈', target: '#board',
      s: '中间是仓鼠圈轮盘，一共二十四格，顺时针走。发金光的格子，就是当前玩家所在的位置。',
      b: '共 24 格，<b>顺时针</b>走。发金光的格子＝当前玩家所在位置，正中央显示 TA 的进度与全盘图例。' },
    { t: '📊 右栏：两张报表', target: '#col-right',
      s: '右边是两张报表：月收支表，还有资产负债表。能看清你每个月赚多少、花多少，以及有多少净资产。',
      b: '<b>月收支表</b>（工资/股息/支出/月现金流）＋<b>资产负债表</b>（现金/持股/负债/净资产）。' },
    { t: '👥 底部玩家卡', target: '#summaries',
      s: '底部是玩家卡，每家的现金、股息、月支出都写在这儿。左边那颗小棋子，就是它在棋盘上的样子。',
      b: '每家的现金、股息、月支出与持股。左边那颗<b>棋子</b>就是 TA 在盘上的样子（形状＋颜色＋编号）；点卡片可改看 TA 的报表。' }
  ];

  function coachClearHl() {
    if (COACH.hl) { const e = $(COACH.hl); if (e) e.classList.remove('coach-hl'); }
    COACH.hl = null;
  }
  function coachHl(sel, scroll) {
    coachClearHl();
    if (!sel) return;
    const e = $(sel);
    if (!e) return;
    e.classList.add('coach-hl');
    COACH.hl = sel;
    if (scroll) { try { e.scrollIntoView({ block: 'center' }); } catch (err) { /* 忽略 */ } }
  }
  // 实战讲解卡：发生了什么就讲什么
  function coachPendingCard(S, p) {
    const pd = S.pending;
    switch (pd.type) {
      case 'stock': {
        const st = S.market.find(m => m.sym === pd.sym);
        const isDiv = pd.cat === 'div';
        return { t: isDiv ? '💰 踩到红利股格' : '🚀 踩到成长股格', target: null,
          s: isDiv
            ? `踩到红利股啦！买入以后，每持有一股，每个月都会自动发${Math.round(st.div)}元股息，这是跳出仓鼠圈的关键哦。`
            : '踩到成长股啦！这类股票没有股息，价格大起大落，要靠低买高卖赚差价，赚到手再换回红利股。',
          b: isDiv
            ? `翻出机会卡：按现价 <b>${money(pd.price)}</b>/股买入，<b>每持 1 股每月自动发股息 ${money(st.div)}</b> —— 这是出圈的唯一钥匙。`
            : `翻出机会卡：成长股<b>没有股息、价格大起大落</b>，只能低买高卖赚差价，赚到手再换回红利股。` };
      }
      case 'house': {
        const h = pd.house;
        return { t: '🏠 翻到买房卡', target: null,
          s: '翻到买房卡啦！买房要付首付，还要每月还贷款，却不产生任何收入，会拖慢你出圈，一般要选拒绝哦。',
          b: `买房是<b>陷阱</b>：付首付 ${money(h.down)} ＋ 永久月供 ${money(h.m)}，<b>却不产生任何收入</b>，反而抬高月支出。多数情况该选「否」。` };
      }
      case 'doodad':
        return { t: '🛍️ 意外支出', target: null,
          s: `哎呀，遇到意外支出，要花掉${Math.round(pd.amt)}元。会先弹窗告诉你金额，点了确定才会扣钱。`,
          b: `一次性的意外开销 <b class="neg">−${money(pd.amt)}</b>。会先弹窗告诉你金额，点「确定」才真的扣钱。` };
      case 'tax':
        return { t: '🧾 交税', target: null,
          s: `要交税啦，要缴${Math.round(pd.amt)}元。税额最多只占你总资产的百分之一，负担很轻的。`,
          b: `按（工资＋股息）×6% 计征，且<b>封顶为总资产的 1%</b>，税负很轻。同样是先弹窗、点确定才扣。` };
      case 'charity':
        return { t: '🕊️ 慈善捐款', target: null,
          s: '这里是慈善格！捐出一些钱，就能换到一次掷两颗骰子的机会，不过要等到下一回合才可以用哦。',
          b: `自愿捐出 ${money(pd.donation)}，换来一次<b>下一回合</b>掷两颗骰子的机会（不会当场再掷一次）。` };
      case 'liquidate':
        return { t: '🏦 破产保护', target: null,
          s: '现金变成负数啦，触发破产保护：必须卖掉一些股票来还债，如果全卖光还不够，就会被淘汰出局。',
          b: `现金变负了：必须变卖股票回笼 <b class="neg">${money(pd.deficit)}</b>。真人可以自己挑卖哪只、卖多少股；卖光仍填不上就出局。` };
    }
    return null;
  }
  function coachCard(S) {
    const p = Engine.cur();
    if (S.over) {
      const w = S.winner;
      return { t: '🏁 演示结束', target: '#summaries',
        s: w
          ? `演示结束啦！${w.name}${w.lastStanding ? '成为最后的幸存者' : '实现了财务自由'}，获得胜利。记住哦：买红利股攒股息，让股息超过月支出，就能跳出仓鼠圈！`
          : '演示结束啦！这一局没有人胜出。记住哦：买红利股攒股息，让股息超过月支出，就能跳出仓鼠圈！',
        b: (w
          ? `<b style="color:${w.color}">${esc(w.name)}</b> ${w.lastStanding ? '成为最后的幸存者' : '实现财务自由'}，胜出！<br>`
          : '本局无人胜出。<br>')
        + '回顾要点：<b>买红利股攒股息 → 让股息超过月支出 → 走到 💵 结算日即出圈</b>；买房和不留现金垫是最常见的两个坑。' };
    }
    if (p && S.pending) { const c = coachPendingCard(S, p); if (c) return c; }
    const last = S.logs[0];
    if (last && last.msg.indexOf('银行结算') >= 0) {
      return { t: '💵 经过银行结算日', target: '#col-right',
        b: `结算规则：<b>现金 ＋＝（工资 ＋ 股息 − 月支出）</b>。<br>${esc(last.msg)}<br>这一刻同时判定胜负：股息若已超过支出，当场胜出。` };
    }
    if (p && S.dice && S.dice[0]) {
      if (COACH._diceRef === S.dice) return null;   // 同一组骰子已展示过掷骰卡，走格/等待期间不再重复朗读
      const n = S.dice.reduce((a, b) => a + b, 0);
      return { t: `🎲 ${esc(p.name)} 掷出 ${n} 点`, target: '#board', _diceRef: S.dice,
        b: `点数决定走几格，棋子会一格一格走过去，<b>停在哪一格就触发那一格的事件</b>。${S.dice.length > 1 ? '（这是 TA 上一回合捐过款攒下的双骰）' : ''}` };
    }
    if (!p) return null;
    return { t: `👤 轮到 ${esc(p.name)}`, target: '#summaries',
      b: `认人三件套：<b>名字 ＋ 棋子形状 ＋ 颜色</b>（盘面上看编号最快）。<br>轮到自己时，可以先卖持仓腾现金，再掷骰子。` };
  }
  // 出卡：开启语音且有中文语音时“读完才切”；出卡期间冻结引擎，动作等讲解读完再继续。
  // 释放信号改用轮询 speechSynthesis.speaking（onend 在部分浏览器会过早触发导致 AI 抢跑），
  // 并以预估时长兜底，保证“动作严格跟随语音”。
  function coachShow(c) {
    if (!COACH.on || !c) return;
    if (COACH.busy) { COACH.next = c; return; }
    COACH.busy = true;
    COACH.card = c;
    if (c._diceRef) COACH._diceRef = c._diceRef;
    COACH.hold = true;                              // 冻结引擎，动作等讲解读完再继续
    coachHl(c.target || null);
    renderCoachBox();
    const done = () => {
      if (!COACH.busy) return;
      clearTimeout(COACH.timer);
      COACH.busy = false;
      COACH.hold = false;                           // 讲解读完，解冻引擎
      if (Engine.coachRelease) Engine.coachRelease();
      if (COACH.next) { const n = COACH.next; COACH.next = null; coachShow(n); }
    };
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(COACH.timer); clearInterval(COACH.poll); done(); };
    const txt = c.s || coachPlain(c.b);
    if (COACH.voiceOn && canSpeak() && hasVoice()) {
      const est = Math.min(16000, Math.max(1500, Math.round(txt.length * 300 + 600))); // 预估语音时长(中文≈3.3字/秒)
      const t0 = Date.now();
      let started = false;
      speakVoice(txt);                              // 不传 onEnd：避免 onend 过早触发导致抢跑
      COACH.poll = setInterval(() => {
        if (speechSynthesis.speaking || speechSynthesis.pending) started = true;
        if (started && !speechSynthesis.speaking && !speechSynthesis.pending) finish();         // 语音真正结束
        else if (!started && Date.now() - t0 > 1500) { clearInterval(COACH.poll); setTimeout(finish, est); } // 没播出来→按预估
        else if (Date.now() - t0 > 16000) finish();                                                   // 硬上限
      }, 120);
      COACH.timer = setTimeout(finish, 16000);       // 总兜底：语音异常也不卡死
    } else {
      // 开了语音但没中文语音 → 多停一会儿让用户看字；关了语音 → 最短停留
      COACH.timer = setTimeout(finish, (COACH.voiceOn && canSpeak()) ? 4200 : COACH_DWELL);
    }
  }
  function coachTick(S) { if (COACH.on && !COACH.intro) coachShow(coachCard(S)); }

  function renderCoachBox() {
    const el = $('#coachbox');
    if (!el) return;
    if (!COACH.on || !COACH.card) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const c = COACH.card;
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="cb-head">
        <span class="cb-tag">${COACH.intro ? '🎓 开场导览' : '🎓 AI 边玩边讲'}</span>
        <b>${c.t}</b>
        <span class="cb-acts">
          <button type="button" class="cb-btn" id="cb-voice" title="开关语音解说（二次元萝莉音）">${COACH.voiceOn ? '🔊 语音' : '🔇 静音'}</button>
          <button type="button" class="cb-btn" id="cb-skip">${COACH.intro ? '⏭ 跳过导览' : '⏭ 只看牌局'}</button>
          <button type="button" class="cb-btn" id="cb-home">🏠 返回设置</button>
        </span>
      </div>
      <div class="cb-body">${c.b}</div>`;
    const voice = $('#cb-voice'), skip = $('#cb-skip'), home = $('#cb-home');
    if (voice) {
      if (!canSpeak()) { voice.textContent = '🔇 不支持'; voice.disabled = true; voice.title = '当前环境没有语音合成(TTS)能力'; }
      else voice.onclick = () => {
        COACH.voiceOn = !COACH.voiceOn;
        try { localStorage.setItem('cf_coach_voice', COACH.voiceOn ? '1' : '0'); } catch (e) { /* 忽略 */ }
        if (!COACH.voiceOn) stopVoice();
        else if (COACH.card && COACH.card.s) speakVoice(COACH.card.s);
        renderCoachBox();
      };
    }
    if (skip) skip.onclick = () => { if (COACH.intro) coachIntro(COACH_INTRO.length); else stopCoach(); };
    if (home) home.onclick = () => { stopCoach(); location.reload(); };
  }
  // 开场导览：逐页高亮讲解；每页“语音读完才翻下一页”（轮询 speaking，避免 onend 过早翻页），冻结引擎到导览结束
  function coachIntro(i) {
    if (!COACH.on) return;
    clearTimeout(COACH.timer);
    stopVoice();
    if (i >= COACH_INTRO.length) {
      COACH.intro = false; COACH.busy = false; COACH.next = null; COACH.hold = false;
      coachClearHl();
      Engine.gate(false);
      render();               // 让画面回到实战状态
      Engine.resume();        // 正式开打
      return;
    }
    COACH.intro = true;
    COACH.card = COACH_INTRO[i];
    COACH.busy = true;
    COACH.hold = true;        // 导览期间冻结引擎（双保险；开场已被 gate 挡住 AI）
    coachHl(COACH_INTRO[i].target, true);
    renderCoachBox();
    const txt = COACH_INTRO[i].s;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(COACH.timer); clearInterval(COACH.poll); coachIntro(i + 1); };
    if (COACH.voiceOn && canSpeak() && hasVoice()) {
      const est = Math.min(16000, Math.max(1500, Math.round(txt.length * 300 + 600)));
      const t0 = Date.now();
      let started = false;
      speakVoice(txt);
      COACH.poll = setInterval(() => {
        if (speechSynthesis.speaking || speechSynthesis.pending) started = true;
        if (started && !speechSynthesis.speaking && !speechSynthesis.pending) finish();
        else if (!started && Date.now() - t0 > 1500) { clearInterval(COACH.poll); setTimeout(finish, est); }
        else if (Date.now() - t0 > 16000) finish();
      }, 120);
      COACH.timer = setTimeout(finish, 16000);
    } else {
      COACH.timer = setTimeout(finish, COACH_INTRO_MS);  // 无语音/不支持：固定停留
    }
  }
  function startCoach() {
    SETUP.count = 4;
    SETUP.players = [0, 1, 2, 3].map(() => ({ ai: true }));
    $('#count-num').textContent = SETUP.count;
    buildSetupRows();
    randomizeProfs();
    COACH.on = true; COACH.intro = true; COACH.card = null; COACH.next = null; COACH.busy = false; COACH.hold = false;
    // 演示节奏由“讲解卡（语音）读完才放行”主导（见 coachShow/Engine._coachGate），
    // 这里只保留极短的衔接过渡，避免读完卡后干等太久。
    // 只记档位标记：教学期间玩家可能在顶栏改速度，结束时用整档恢复，
    // 避免把两个节奏字段单独写回、造成 TIMING.speed 与实际数值不一致。
    COACH.timing = { speed: CF.TIMING.speed };
    CF.TIMING.aiRollMs = 250;       // 读完讲解到“掷骰”的微小过渡
    CF.TIMING.aiChooseMs = 300;     // 读完讲解到“AI 决策”的微小过渡
    launch(collectSetup());
    Engine.gate(true);          // 闸住：开场导览讲完之前，AI 不许先掷骰、也不许弹决策窗
    coachIntro(0);
  }
  function stopCoach() {
    stopVoice();                     // 关键：立刻停掉正在朗读的讲解语音
    COACH.on = false; COACH.intro = false;
    clearTimeout(COACH.timer);
    COACH.card = null; COACH.next = null; COACH.busy = false; COACH.hold = false;
    coachClearHl();
    if (COACH.timing) {
      // 以当前档位为准（玩家在教学中改过就保留新档），整档重算两个过渡字段
      CF.applySpeed(CF.TIMING.speed || COACH.timing.speed);
      COACH.timing = null;
    }
    Engine.gate(false);
    if (Engine.coachRelease) Engine.coachRelease();   // 解冻引擎：释放被讲解卡挂起的定时器
    renderCoachBox();
    Engine.resume();
  }

  /* 兜底：speechSynthesis 是浏览器级的，页面刷新 / 关闭 / 跳转都不会自动取消朗读，
     所以任何形式的离开都强制停一次，避免“退出后还在讲” */
  window.addEventListener('pagehide', stopVoice);
  window.addEventListener('beforeunload', stopVoice);

  /* 退出游戏：确认后关窗口（EXE 里直接关闭；浏览器若拒绝脚本关闭则给个兜底提示） */
  function exitGame() {
    if (!window.confirm('确定退出游戏吗？')) return;
    stopCoach();                     // 退出前停讲解语音与教学状态
    window.close();
    setTimeout(() => {
      if (!window.closed) window.alert('浏览器不允许脚本关闭此页面，请直接关闭窗口标签页。');
    }, 400);
  }

  /* ================= 事件绑定与启动 ================= */
  Engine.setRender(render);

  function bindUI() {
    $('#inc-count').addEventListener('click', () => {
      if (SETUP.count >= 4) return;   // 单场上限 4 家
      SETUP.count++; SETUP.players.push({ ai: false }); $('#count-num').textContent = SETUP.count; buildSetupRows();
    });
    $('#dec-count').addEventListener('click', () => {
      if (SETUP.count <= 1) return;
      SETUP.count--; SETUP.players.pop(); $('#count-num').textContent = SETUP.count; buildSetupRows();
    });
    $('#btn-start').addEventListener('click', () => launch(collectSetup()));
    // 设置页：开始游戏左边的「新手教学演示」= 直接进入 AI 边玩边讲（不再弹长篇文字说明）
    $('#btn-guide').addEventListener('click', startCoach);
    $('#btn-exit').addEventListener('click', exitGame);
    $('#btn-guide-top').addEventListener('click', openGuide);    // 局中：顶栏随时可以再翻开
    $('#btn-roll').addEventListener('click', () => Act.roll());
    $('#btn-quit').addEventListener('click', () => { stopCoach(); location.reload(); });
    $('#btn-log').addEventListener('click', () => {
      const lp = $('#logpanel');
      if (!lp) return;
      const show = lp.classList.contains('hidden');   // 当前隐藏 → 即将打开
      lp.classList.toggle('hidden', !show);
      if (show) { const S = Engine.state(); if (S) renderLog(S); }   // 打开瞬间回填最新日志
    });
    $('#btn-log-close').addEventListener('click', () => $('#logpanel').classList.add('hidden'));
    window.addEventListener('resize', () => { if (Engine.state()) render(); });
    // 弹窗开着时页面仍可滚动（长报表等），遮幕顶界要跟着行情栏重新贴合
    window.addEventListener('scroll', () => {
      const m = $('#modal');
      if (m && !m.classList.contains('hidden')) syncModalTop();
    }, { passive: true });
  }

  buildSetupRows();
  addSetupTools();
  renderRules();
  renderLegend();
  renderStats();
  bindUI();

  /* ================= 联机模式对外接口（供 js/online.js 调用） =================
     联机时客户端不跑规则：状态由服务端权威下发，这里只负责注入 + 刷新画面。 */
  /* 同一帧内连续到达的状态包合并成一次渲染：服务端每走一格广播一次，
     重连补包时十几个 STATE 会挤在一起，逐包全量重绘 12 个区域会阻塞主线程。 */
  let rafPending = false;
  function scheduleRender() {
    if (rafPending) return;
    rafPending = true;
    const go = () => { rafPending = false; render(); };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(go);
    else setTimeout(go, 16);
  }
  window.ONLINE_HOOKS = {
    // 进入对局画面（隐藏开始界面 / 显示游戏界面 / 切对局 BGM）
    enter: function () {
      $('#screen-setup').classList.add('hidden');
      $('#screen-game').classList.remove('hidden');
      if (window.BGM) window.BGM.play('game');
      // 关键：界面显示之后再渲染一次。
      // 首次状态到达时游戏界面还是 display:none，那时渲染的棋盘会因容器宽度为 0 而画不出来，
      // 导致进入后画面空白、按钮点不动。
      render();
    },
    // 收到服务端权威状态 → 注入引擎并刷新画面
    applyState: function (st) {
      if (!st) return;
      // 联机：引擎在服务端跑（那里不发声），音效事件随状态下发，由客户端补播
      const sfx = st.__sfx;
      if (sfx && sfx.length && window.SFX) {
        sfx.forEach((k, i) => {
          // 自己掷骰时本地已即时播过，避免服务端回包再响一次
          if (k === 'dice' && Date.now() - (window.__localDiceAt || 0) < 1200) return;
          const fn = window.SFX[k];
          if (typeof fn !== 'function') return;
          // 走格是逐格连响的，错开一点回放节奏
          window.setTimeout(fn, k === 'step' ? i * 80 : 0);
        });
      }
      Engine.hydrate(st);
      scheduleRender();
    },
    // 对局结束
    over: function (info) {
      if (window.BGM) window.BGM.play('end');
      const w = info && info.winner;
      try { window.alert(w ? ('对局结束，胜者：' + w) : '对局结束，无人胜出'); } catch (e) {}
    }
  };
})();
