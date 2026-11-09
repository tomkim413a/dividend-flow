/* ============================================================
 * engine.js —— 股票现金流游戏引擎与规则
 * 目标：股息被动收入 > 月支出，在银行结算日结算后胜出
 * 注：玩法概率与节奏统一下沉在 data.js 的
 *     CF.TUNING / CF.AI_POLICY / CF.TIMING，本文件不再散落魔法数字。
 * ============================================================ */
(function () {
  'use strict';
  const CF = window.CF;
  const money = CF.money;
  const T = CF.TUNING, AP = CF.AI_POLICY, TM = CF.TIMING;
  const d6 = () => 1 + Math.floor(Math.random() * 6);
  // 教练讲解模式下：讲解卡（语音）未读完时，把所有“回合级/决策级”引擎定时器收进
  // _coachDeferred 冻结，读完再 coachRelease() 放行，使 AI 演示动作严格跟随语音。
  // 走格动画用 laterFree（不受冻结），让“掷骰+走格”与语音同步进行，不卡在讲解后。
  // ⚠️ 定时器必须分槽：AI/讲解用 _timer，走格用 _walkTimer。
  //    旧版两者共用 _timer，laterFree() 的 clearTimeout 会把尚未触发的 AI 决策定时器
  //    一起清掉（反之亦然），表现为「掷完骰子/翻卡后卡在半路、回合不推进」。
  const later = (fn, ms) => {
    if (Engine._coachGate && Engine._coachGate()) { Engine._coachDeferred = { fn, ms }; return; }
    clearTimeout(Engine._timer);
    Engine._timer = setTimeout(() => { Engine._timer = null; fn(); }, ms);
  };
  const laterFree = (fn, ms) => {
    clearTimeout(Engine._walkTimer);
    Engine._walkTimer = setTimeout(() => { Engine._walkTimer = null; fn(); }, ms);
  };
  // 一局结束 / 重开时清干净，避免上一局的定时器打到新一局的模块级 S 上
  const clearTimers = () => {
    clearTimeout(Engine._timer); clearTimeout(Engine._walkTimer);
    Engine._timer = Engine._walkTimer = null;
    Engine._coachDeferred = null;
  };

  let S = null;
  let uidSeq = 1;
  let liqSeq = 0;          // 破产变卖回放序号（跨局递增，避免重放旧记录）
  let _renderer = null;
  // 音效仅浏览器端存在；服务端（Node）跑规则时 window 未定义 → 安全返回 null，跳过音效
  const sfx = () => (typeof window !== 'undefined' && window.SFX) ? window.SFX : null;
  const uid = () => 'a' + (uidSeq++);

  /* ---------- 记账辅助 ---------- */
  function cur() { return S ? S.players[S.cur] : null; }
  function expTotal(p) {
    let t = 0;
    (p.expLines || []).forEach(l => { if (!l.paid) t += l.m; });
    return t;
  }
  // 被动收入 = 全部红利股持仓 的每股月股息之和
  function passive(p) {
    return (p.stocks || []).reduce((s, a) => s + a.shares * a.div, 0);
  }
  function net(p) { return p.prof.salary + passive(p) - expTotal(p); }
  function debtLines(p) { return p.expLines.filter(l => l.debt && !l.paid); }
  function holding(p, sym) { return (p.stocks || []).find(a => a.sym === sym); }

  function log(msg, cls) {
    if (!S) return;
    S.logs.unshift({ msg, cls: cls || '', turn: S.turn });
    if (S.logs.length > 300) S.logs.pop();
  }
  function toast(msg, cls) {
    if (S) S.toasts.push({ msg, cls: cls || '' });
  }
  function emit() { if (S && _renderer) _renderer(); }

  /* ---------- 行情 ---------- */
  function mkt(sym) { return S.market.find(m => m.sym === sym); }
  function curStockPx(sym) { const m = mkt(sym); return m ? m.px : 0; }

  // 每次有人掷骰后：全部股票小幅随机波动并记录历史；偶发成长股“大新闻”。
  // 波动 ≥flashMin 的当日领涨/领跌或大新闻个股：标记 big 供行情条高亮，
  // 并做顶部播报（大新闻自带播报，避免与领涨/领跌重复播同一只）。
  //
  // ⚠️ 价位保护：报价是整数元，1 元就是最小变动单位。
  //    红利股基价虽已抬到 52~88 档，vol(1.6%~2.2%) 乘出来仍只有 0.9~1.9 元，
  //    四舍五入后经常“本期没动”，表现为“连续很久一分钱不涨跌”。
  //    因此除 stallChance 概率的横盘外，只要算出来的变动不足 1 元，就
  //    按随机方向至少挪 1 元，保证红利股“稳而不死”。
  function marketTick() {
    if (!S) return;
    S.market.forEach(m => {
      const prev = m.px;
      m.big = false;
      m.hist.push(prev);
      if (m.hist.length > T.marketHistLen) m.hist.shift();
      const jitter = (Math.random() + Math.random() - 1) * m.vol;   // 三角分布，±vol
      let next = Math.max(1, Math.round(prev * (1 + jitter)));
      if (next === prev && Math.random() >= T.stallChance) {
        next = Math.max(1, prev + (jitter >= 0 ? 1 : -1));
      }
      m.px = next;
      m.day = (m.px - prev) / prev;
    });
    if (Math.random() < T.newsChance) {
      const grws = S.market.filter(m => m.cat === 'grw');
      const m = CF.pick(grws);
      const prev = m.px;
      const boom = Math.random() < T.boomChance;
      const amp = T.boomAmpMin + Math.random() * (T.boomAmpMax - T.boomAmpMin);
      m.px = Math.max(1, Math.round(m.px * (boom ? 1 + amp : 1 - amp)));
      m.day = (m.px - prev) / prev;
      m.big = true;
      const pct = Math.round(Math.abs(m.day) * 1000) / 10;
      log(`📰 ${m.icon}${m.name}${boom ? ' 重大利好' : ' 突发利空'}！${money(prev)} → ${money(m.px)}（${boom ? '+' : '-'}${pct}%）`, boom ? 'lg' : 'lr');
      toast(`📰 ${m.icon}${m.name}${boom ? ' 重大利好 ▲' : ' 突发利空 ▼'} ${money(m.px)}（${boom ? '+' : '-'}${pct}%）`, boom ? 'lg' : 'lr');
      return;
    }
    const mover = S.market.reduce((b, m) => Math.abs(m.day) > Math.abs(b.day) ? m : b, S.market[0]);
    if (mover && Math.abs(mover.day) >= T.flashMin) {
      const up = mover.day >= 0;
      mover.big = true;
      const pct = Math.round(Math.abs(mover.day) * 1000) / 10;
      toast(`📊 ${up ? '领涨' : '领跌'} ${mover.icon}${mover.name} ${money(mover.px)}（${up ? '+' : '-'}${pct}%）`, up ? 'lg' : 'lr');
    }
  }

  /* ---------- 玩家 ---------- */
  function buildPlayer(cfg, i) {
    const prof = CF.PROFESSIONS.find(x => x.id === cfg.prof) || CF.PROFESSIONS[0];
    // 棋子形状：玩家自选；未指定（如 AI）则随机一个，盘面更好认人
    const shape = CF.PIECE_SHAPES.some(s => s.k === cfg.shape) ? cfg.shape : CF.pick(CF.PIECE_SHAPES).k;
    return {
      name: cfg.name || prof.name, ai: !!cfg.ai, color: CF.COLORS[i % CF.COLORS.length], prof, shape,
      cash: prof.savings,
      expLines: prof.expenseLines.map(l => Object.assign({}, l, { paid: false })),
      stocks: [], hamsterPos: 0, skip: false, charityDice: false, dead: false, won: false
    };
  }

  /* AI 投资性格：AI 数 ≥ 2 时保证至少一个「激进型」（偏好成长股），其余为稳健型，
     让多 AI 对局更有变数（不会所有电脑都一个模子）。 */
  function assignAiStyles() {
    const ais = S.players.filter(p => p.ai);
    ais.forEach(p => { p.aiStyle = 'steady'; });
    if (ais.length < 2) return;
    const n = Math.max(1, Math.round(ais.length * 0.4));   // 约四成 AI 设为激进型
    const pool = ais.slice();
    for (let i = 0; i < n && pool.length; i++) {
      pool.splice(Math.floor(Math.random() * pool.length), 1)[0].aiStyle = 'aggressive';
    }
  }

  function start(cfg) {
    clearTimers();                  // 重开一局：先掐掉上一局遗留的走格 / AI 定时器
    S = {
      cfg, players: cfg.map(buildPlayer), cur: 0,
      market: CF.STOCKS.map(s => Object.assign({}, s, {
        px: Math.max(1, Math.round(s.base * (1 - T.marketInitJitter + Math.random() * T.marketInitJitter * 2))),
        day: 0,
        hist: [],
        big: false
      })),
      logs: [], toasts: [], queue: [], pending: null, await: 'roll', dice: [0], turn: 0, over: null, winner: null,
      liq: null, recorded: false,     // liq=最近一次破产变卖清单（供 UI 逐笔回放）；recorded=战绩已落库
      gate: false,                    // gate=换人弹窗未确认前挂起自动推进（AI 也不会自己掷骰）
      walk: null,                     // 走格进度（纯数据）：弹窗打断后据此续走，不再丢剩余步数
      needFinish: false               // finishTurn 被弹窗挡下时挂起，弹窗关闭后补做
    };
    assignAiStyles();          // 先定 AI 投资性格（激进 / 稳健）
    log('🎬 股息流游戏开始！目标：让股息被动收入 > 月支出，走到银行结算日即可胜出。', 'lg');
    playersForEach(p => log(`${p.name} 选择职业「${p.prof.icon} ${p.prof.name}」· 月薪 ${money(p.prof.salary)} · 储蓄 ${money(p.cash)}`));
    const aggr = S.players.filter(p => p.ai && p.aiStyle === 'aggressive');
    if (aggr.length) {
      log(`🤖 投资风格：${aggr.map(p => p.name + '（激进·偏好成长股）').join('、')}；其余电脑为稳健型。`, '');
    }
    log('📈 每次掷骰，全市场行情波动一次；红利股每持 1 股每月自动带来股息，成长股靠大涨大跌赚差价。');
    beginTurn();
    emit();
  }

  function playersForEach(fn) { S.players.forEach(fn); }

  function beginTurn() {
    const p = cur();
    if (!p) return;
    if (p.won || p.dead) {
      // 异常兜底：所有座位都出局却没置 over 时，别在 finishTurn ↔ beginTurn 之间无限递归
      if (S.players.every(x => x.dead || x.won)) {
        S.over = true; S.winner = null; recordGame(); emit(); return;
      }
      finishTurn(); return;
    }
    S.turn++;
    if (p.skip) {
      p.skip = false;
      log(`${p.name} 正在待业中，跳过本回合。`, 'lr');
      finishTurn(); return;
    }
    S.await = 'roll';
    S.pending = null;
    S.dice = [0];
    log(`—— 第 ${S.turn} 手 · ${p.name} 掷骰 ——`, 'lt');
    if (!p.ai) toast(`轮到 ${p.name}，请掷骰子 🎲`);
    emit();
    drive();
  }

  function finishTurn() {
    if (S.over) { emit(); return; }
    // 旧版在这里直接 return 且无任何后续驱动 → 引擎永久停摆。
    // 现在挂起标记，等决策弹窗关闭后由 runQueue() 补做换人。
    if (S.pending || S.await === 'pending') { S.needFinish = true; return; }
    S.needFinish = false;
    S.pending = null;
    S.cur = (S.cur + 1) % S.players.length;
    { const _s = sfx(); if (_s) _s.turn(); }   // 切换玩家：专属轻提示音
    beginTurn();
  }

  /* ---------- 掷骰 / 逐格行走 ---------- */
  // 节奏/时长等表现参数集中在 CF.TIMING
  const WALK = CF.TIMING;

  // charityDice = 上一回合捐过款攒下的双骰额度，在【下一次轮到自己掷骰】时兑现
  function doRoll() {
    const p = cur();
    if (S.over || !p || S.await !== 'roll' || p.won) return;
    S.await = 'busy';
    let dice;
    if (p.charityDice) {
      p.charityDice = false;
      const a = d6(), b = d6();
      dice = [a, b];
      log(`${p.name} 兑现上一回合的慈善双骰：${a} + ${b} = ${a + b}`, '');
    } else {
      const a = d6();
      dice = [a];
      if (p.ai) log(`${p.name} 掷出 ${a} 点`, '');
    }
    S.dice = dice;
    { const _s = sfx(); if (_s) _s.dice(); }   // 掷骰音效
    emit();
    const steps = dice.reduce((s, v) => s + v, 0);
    marketTick();               // 掷骰后全市场波动一次
    laterFree(() => walk(p, steps), WALK.walkHold);   // 走格与讲解卡语音并行，不被教练冻结
  }

  // 一格一格走过去：进度存进 S.walk（纯数据、可序列化）。
  // 旧版用闭包变量 left，一旦途中弹出决策窗口就 return 丢弃整个链，
  // 剩余步数和落格事件永久丢失、回合卡在半路。现在改为「暂停 / 续走」。
  function walk(p, steps) {
    if (!S || S.over || !p || steps < 1) return;
    const stepMs = Math.max(WALK.walkStepMin, Math.min(WALK.walkStepMax, Math.round(WALK.walkTotal / steps)));
    S.walk = { idx: S.players.indexOf(p), left: steps, steps, stepMs };
    laterFree(tick, stepMs);
  }

  function tick() {
    const w = S && S.walk;
    if (!S || S.over || !w) return;
    if (S.pending || S.await === 'pending') return;   // 暂停；choose() → runQueue() 会续上
    const p = S.players[w.idx];
    if (!p) { S.walk = null; return; }
    w.left--;
    p.hamsterPos = (p.hamsterPos + 1) % CF.HAMSTER_SIZE;
    { const _s = sfx(); if (_s) _s.step(w.steps - w.left); }   // 每走一格一声轻响
    if (p.hamsterPos === 0) {
      bankSettle(p);
      if (S.queue.length) { runQueue(); return; }   // runQueue 负责续走 / 结束 / 挂起换人
      if (S.over || S.pending || S.await === 'pending') return;
    }
    if (p.dead) { S.walk = null; S.await = null; finishTurn(); return; }
    emit();
    if (w.left > 0) laterFree(tick, w.stepMs);
    else laterFree(() => finishMove(p, w.steps), w.stepMs);
  }

  function finishMove(p, steps) {
    if (!S) return;
    S.walk = null;
    if (S.over || !p || S.pending || S.await === 'pending') return;
    const cell = CF.HAMSTER_BOARD[p.hamsterPos];
    log(`${p.name} 前进 ${steps} 格 → ${cell.ic} ${cell.name}`, '');
    if (cell.type !== 'payday') S.queue.push(() => landEvent(p, cell));
    emit();
    runQueue();
  }

  function bankSettle(p) {
    if (p.won || p.dead) return;
    const n = net(p);
    p.cash += n;
    log(`💵 ${p.name} 银行结算：${money(n)}（工资 ${money(p.prof.salary)} + 股息被动 ${money(passive(p))} − 月支出 ${money(expTotal(p))}）`, n >= 0 ? 'lg' : 'lr');
    if (p.cash < 0) bailout(p);
    if (p.dead) return;
    { const _s = sfx();
      if (n >= 0) { toast(`${p.name} 收到结算 ${money(n)}`); if (_s) _s.good(); }
      else if (_s) _s.bad();              // 结算为负（入不敷出）→ 丢失音
    }
    if (passive(p) > expTotal(p)) {
      S.queue.length = 0;
      S.queue.push(() => win(p));
    }
  }

  function win(p) {
    p.won = true;
    S.over = true;
    S.winner = p;
    log(`👑 ${p.name} 股息被动收入 ${money(passive(p))} > 月支出 ${money(expTotal(p))}，实现财务自由，胜出！`, 'lg');
    recordGame();
    emit();
  }

  /* ---------- 破产保护：现金不足以支出时变卖股票清偿；卖空仍资不抵债则淘汰 ---------- */
  // 规则分流：
  //   · 真人玩家 → 弹窗（pending: 'liquidate'）让他自己决定卖哪只、卖多少股，引擎只兜底；
  //   · AI / 无持仓 → 自动变卖，顺序先动“不产股息的成长股”，尽量保住吃股息的红利股。
  // 每一笔变卖都记入 S.liq，供 UI 逐笔回放（高亮行情条 / 棋盘棋子 / 玩家卡）。
  function bailout(p) {
    if (!S || S.over || p.dead || p.won || p.cash >= 0) return;
    if (!p.ai && (p.stocks || []).length) {
      // 真人：不替他做主，交给他自己挑（弹窗要求至少卖到现金不为负）
      setPending('liquidate', { deficit: Math.ceil(-p.cash) });
      return;
    }
    autoLiquidate(p);
  }

  // 建立本次变卖的回放记录（UI 按 seq 变化逐笔播放）
  function liqRec(p) {
    const rec = {
      seq: ++liqSeq, idx: S.players.indexOf(p), name: p.name, color: p.color,
      profIcon: p.prof.icon, profName: p.prof.name,
      deficit: Math.ceil(-p.cash), steps: [], total: 0, cleared: false, dead: false
    };
    S.liq = rec;
    return rec;
  }

  // 按当前市价卖出一笔，并记入回放记录
  function liqSell(p, rec, h, shares) {
    const n = Math.min(h.shares, Math.max(0, Math.floor(shares || 0)));
    if (!n) return 0;
    const px = curStockPx(h.sym);
    const proceeds = n * px;
    p.cash += proceeds;
    h.shares -= n;
    if (h.shares <= 0) p.stocks = p.stocks.filter(x => x !== h);
    rec.steps.push({ sym: h.sym, name: h.name, icon: h.icon, cat: h.cat, shares: n, px, proceeds });
    rec.total += proceeds;
    log(`🏦 破产保护：${p.name} 变卖 ${h.sym} ×${n}（${money(px)}/股，入账 ${money(proceeds)}）清偿欠款`, 'lr');
    return proceeds;
  }

  // 变卖收尾：现金回正 → 渡过危机；仍为负 → 破产出局
  function liqFinish(p, rec) {
    if (p.cash >= 0) {
      rec.cleared = true;
      toast(`🏦 ${p.name} 变卖资产渡过危机，剩余现金 ${money(p.cash)}`);
      return;
    }
    // 卖光全部股票仍资不抵债 → 出局
    p.dead = true;
    p.cash = 0;
    rec.dead = true;
    log(`💀 ${p.name} 变卖全部股票后仍资不抵债，宣告破产，被淘汰出局！`, 'lr');
    toast(`💀 ${p.name} 破产被淘汰`, 'lr');
    const alive = S.players.filter(x => !x.dead);
    if (alive.length === 0) {
      // 单人局破产：对局结束、无胜者
      S.over = true;
      S.winner = null;
      log('💀 场上已无幸存玩家，对局结束。', 'lr');
      recordGame();
      emit();
    } else if (alive.length === 1 && S.players.length > 1) {
      const w = alive[0];
      w.won = true;
      w.lastStanding = true;
      S.over = true;
      S.winner = w;
      log(`👑 ${w.name} 成为最后的幸存者，获胜！`, 'lg');
      recordGame();
      emit();
    }
  }

  // 自动变卖（AI / 无持仓）：卖到现金回正为止，卖光仍不够则出局
  function autoLiquidate(p) {
    const rec = liqRec(p);
    const order = (p.stocks || []).slice().sort((a, b) => (a.div > 0 ? 1 : 0) - (b.div > 0 ? 1 : 0));
    while (p.cash < 0 && order.length) {
      const a = order.shift();
      const need = Math.ceil(-p.cash / curStockPx(a.sym));   // 至少要回笼多少股才不再为负
      liqSell(p, rec, a, Math.max(1, Math.min(a.shares, need)));
    }
    liqFinish(p, rec);
  }

  // 真人自选变卖后的兜底：所选不够清偿却仍留有持仓时，继续按“成长股优先”补卖
  function liqTopUp(p, rec) {
    const rest = (p.stocks || []).slice().sort((a, b) => (a.div > 0 ? 1 : 0) - (b.div > 0 ? 1 : 0));
    while (p.cash < 0 && rest.length) {
      const a = rest.shift();
      liqSell(p, rec, a, Math.max(1, Math.min(a.shares, Math.ceil(-p.cash / curStockPx(a.sym)))));
    }
  }

  // 随机变卖：真人玩家在弹窗里点「🎲 随机」把决定交给电脑。
  // 随机打乱持仓顺序，每只随机卖“刚好够补差额 ~ 全部”之间的一个股数，
  // 卖到现金回正即停（总市值仍不够则等于全部卖光 → 由 liqFinish 判出局）。
  function randomLiquidate(p, rec) {
    const pool = (p.stocks || []).slice();
    for (let i = pool.length - 1; i > 0; i--) {          // Fisher–Yates 洗牌
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    while (p.cash < 0 && pool.length) {
      const h = pool.shift();
      const px = curStockPx(h.sym);
      const least = Math.max(1, Math.min(h.shares, Math.ceil(-p.cash / px)));   // 至少卖这么多才够补
      const extra = Math.floor(Math.random() * Math.max(1, h.shares - least + 1));
      liqSell(p, rec, h, Math.min(h.shares, least + extra));
    }
  }

  /* ---------- 格子事件 ---------- */
  function landEvent(p, cell) {
    { const _s = sfx();
      if (_s) {
        // 交税 / 意外支出 / 失业 → “丢失”音；其余（红利股 / 成长股 / 慈善）→ “机会”音
        const isBad = (cell.type === 'tax' || cell.type === 'doodad' || cell.type === 'jobless');
        if (isBad) _s.bad(); else _s.good();
      }
    }
    switch (cell.type) {
      case 'divS': case 'grwS': stockCellEvent(p, cell); break;
      case 'doodad': doodadEvent(p); break;
      case 'tax': taxEvent(p); break;
      case 'jobless': joblessEvent(p); break;
      case 'charity': charityEvent(p); break;
    }
  }

  // 股票格：偶尔翻到“买房”机会（买房没有独立格子，机会藏在 💰红利股 / 🚀成长股 格中），
  // 否则抽取该类型股票。日志带上所在格名与格号，方便玩家对照盘面定位。
  function stockCellEvent(p, cell) {
    const at = `第${cell.idx + 1}格 ${cell.ic}${cell.name}`;
    if (Math.random() < T.houseChance) {
      // 随机抽一套房后【无条件弹窗询问是否买房】——现金够不够付首付不在这里过滤，
      // 交给玩家点“是”之后在 choose() 里判定，不够就提示资金不足。
      const house = CF.pick(CF.HOUSES);
      log(`${p.name} 在 ${at} 翻到 🏠买房卡：${house.icon} ${house.name}（首付 ${money(house.down)} / 月供 ${money(house.m)}，不产生收入）`, '');
      setPending('house', { house, at });   // at=触发位置，供弹窗标明"买房属于哪一格"
      return;
    }
    const cat = cell.type === 'divS' ? 'div' : 'grw';
    const cands = S.market.filter(m => m.cat === cat);
    const st = CF.pick(cands);
    log(`${p.name} 翻开${cat === 'div' ? '💰红利股' : '🚀成长股'}机会卡：${st.icon} ${st.name} 现价 ${money(st.px)}${cat === 'div' ? ` · 每股月股息 ${money(st.div)}` : '（无股息，波动大）'}`, '');
    setPending('stock', { sym: st.sym, price: st.px, cat });
  }

  // 意外支出金额 = max(doodadFloor, 净现金流 × r)。
  // 小额池硬性封顶 doodadSmallCap(300)、大额池兜底 doodadBigFloor(400)，
  // 因此“支出 > 300 元”的概率恒等于 TUNING.doodadBigChance（4% < 5%）。
  function doodadAmount(d, p) {
    const n = Math.max(0, net(p));
    return d.big
      ? Math.max(T.doodadBigFloor, Math.round(n * d.r))
      : Math.min(T.doodadSmallCap, Math.max(T.doodadFloor, Math.round(n * d.r)));
  }

  // 意外支出只做“通知型弹窗”，先不扣钱；玩家点「确定」后由 choose 的 doodad 分支真正扣款。
  function doodadEvent(p) {
    const d = CF.pickDoodad();
    setPending('doodad', { doodad: d, amt: doodadAmount(d, p), big: !!d.big });
  }

  // 交税：两种口径取小，确保税负轻。
  //   byIncome =（工资＋被动收入）× taxRate(6%)
  //   byAssets = 总资产（现金＋股票市值）× taxAssetRate(1%) ← 税负硬上限
  // 先取 min(byIncome, byAssets) 并兜底 taxFloor，再与 byAssets 取小 ——
  // 保证任何情况下 税额 ≤ 总资产的 1%（下限也不会突破这条线）。
  function taxDue(p) {
    const byIncome = Math.max(0, Math.round((p.prof.salary + passive(p)) * T.taxRate));
    const assets = Math.max(0, netWorth(p));
    const byAssets = Math.max(0, Math.round(assets * T.taxAssetRate));
    const capped = Math.max(T.taxFloor, Math.min(byIncome, byAssets));
    return { byIncome, byAssets, assets, amt: Math.min(capped, byAssets) };
  }

  function taxEvent(p) {
    setPending('tax', taxDue(p));
  }

  function joblessEvent(p) {
    // 失业 = 失去工资。被动收入先兜底生活费，缺口的一半需要动存款；同时跳过下一回合
    const gap = expTotal(p) - passive(p);
    const pay = Math.max(0, Math.round(gap * T.joblessCover));
    p.cash -= pay;
    p.skip = true;
    const short = p.cash < 0;
    log(`🛑 ${p.name} 失业！失去工资，生活费缺口由存款垫付 ${money(pay)}，并跳过下一回合。${short ? '（现金不足！）' : ''}`, 'lr');
    if (short) bailout(p);
  }

  function charityEvent(p) {
    const donation = Math.max(T.charityFloor, Math.round(Math.max(0, net(p)) * T.charityRate));
    setPending('charity', { donation });
  }

  /* ---------- pending 决策 ---------- */
  function setPending(type, data) {
    S.pending = Object.assign({ type }, data);
    S.await = 'pending';
    emit();
    drive();
  }

  function choose(id, payload) {
    if (!S || S.await !== 'pending') return;
    const p = cur();
    const pd = S.pending;
    S.pending = null;
    payload = payload || {};

    switch (pd.type) {
      case 'stock': {
        const px = pd.price, sym = pd.sym;
        const shares = Math.floor(payload.amount || 0);
        const cost = shares * px;
        if (id === 'buy' && shares > 0 && p.cash >= cost) {
          p.cash -= cost;
          const ex = holding(p, sym);
          const st = mkt(sym);
          if (ex) {
            ex.avg = (ex.avg * ex.shares + cost) / (ex.shares + shares);
            ex.shares += shares;
          } else {
            p.stocks.push({ uid: uid(), sym, name: st.name, icon: st.icon, cat: st.cat, shares, avg: px, div: st.div });
          }
          // 统计买入次数（仅计数，用于观察不同 AI 性格的投资偏好）
          if (st.cat === 'grw') p.buyGrw = (p.buyGrw || 0) + 1; else p.buyDiv = (p.buyDiv || 0) + 1;
          log(`📥 ${p.name} 以 ${money(px)}/股 买入 ${shares} 股 ${sym}，花费 ${money(cost)}${st.div > 0 ? `，月股息 +${money(st.div * shares)}` : ''}`, 'lg');
          toast(`${p.name} 买入 ${st.icon} ${st.sym} ×${shares}`);
        } else if (id === 'buy') {
          log(`${p.name} 想买但现金不足，放弃购买 ${sym}。`, '');
        } else {
          log(`${p.name} 放弃购买 ${sym}。`, '');
        }
        break;
      }
      case 'house': {
        const h = pd.house;
        if (id !== 'buy') {
          log(`${p.name} 放弃买房。`, '');
        } else if (p.cash >= h.down) {
          p.cash -= h.down;
          p.expLines.push({ label: `房贷·${h.name}`, m: h.m, debt: true, principal: h.principal, paid: false });
          log(`🏠 ${p.name} 买房自住「${h.icon} ${h.name}」：支付首付 ${money(h.down)}，新增月供 ${money(h.m)}，不产生被动收入。`, 'lr');
          toast(`${p.name} 买房 ${h.icon} ${h.name}（大额支出）`);
        } else {
          // 玩家点了“是”，但首付不够 → 明确提示资金不足，交易不成立、不扣钱
          const gap = h.down - p.cash;
          log(`❌ ${p.name} 资金不足，无法买房「${h.icon} ${h.name}」：需首付 ${money(h.down)}，当前现金仅 ${money(p.cash)}，还差 ${money(gap)}。`, 'lr');
          toast(`💸 资金不足！需首付 ${money(h.down)}，你只有 ${money(p.cash)}`, 'lr');
        }
        break;
      }
      case 'doodad': {
        // 通知型弹窗点「确定」后：扣款 + 记账；扣到现金为负再走破产保护
        const { doodad: d, amt } = pd;
        p.cash -= amt;
        const short = p.cash < 0;
        log(`🛍️ ${p.name} 意外支出「${d.icon} ${d.name}」${money(amt)}${short ? '，现金不足！' : ''}`, 'lr');
        toast(`🛍️ ${p.name} 意外支出 ${money(amt)}`, 'lr');
        if (short) S.queue.push(() => bailout(p));   // 交给队列：bailout 才能安全地再开一个 pending
        break;
      }
      case 'tax': {
        // 通知型弹窗点「确定」后：扣款 + 记账；扣到现金为负再走破产保护
        const { amt } = pd;
        p.cash -= amt;
        const short = p.cash < 0;
        log(`🧾 ${p.name} 纳税 ${money(amt)}${short ? '，现金不足！' : ''}`, 'lr');
        toast(`🧾 ${p.name} 纳税 ${money(amt)}`, 'lr');
        if (short) S.queue.push(() => bailout(p));
        break;
      }
      case 'charity': {
        const { donation } = pd;
        if (id === 'donate' && p.cash >= donation) {
          p.cash -= donation;
          p.charityDice = true;
          log(`🕊️ ${p.name} 捐出 ${money(donation)}，攒下一次双骰——下一回合轮到自己时才能兑现。`, 'lg');
        } else log(`${p.name} 婉拒慈善捐款。`, '');
        break;
      }
      case 'liquidate': {
        // 真人变卖，三种提交方式：
        //   payload.sell = { 股票代码: 股数 } → 自己挑着卖；
        //   payload.random = true           → 点「🎲 随机」，交给电脑随机决定卖哪只、卖多少；
        //   payload.giveUp = true           → 确认破产出局。
        const rec = liqRec(p);
        if (payload.random) {
          log(`🎲 ${p.name} 把变卖的决定交给电脑随机处理。`, '');
          randomLiquidate(p, rec);
        } else if (!payload.giveUp) {
          const sell = payload.sell || {};
          (p.stocks || []).slice().forEach(h => liqSell(p, rec, h, Math.floor(sell[h.sym] || 0)));
        }
        // 没卖够（或玩家已确认放弃）→ 继续补卖，保证不会留下“欠着钱”的悬空状态
        if (payload.giveUp || p.cash < 0) liqTopUp(p, rec);
        liqFinish(p, rec);
        break;
      }
    }
    if (S.await === 'pending') { /* impossible */ }
    S.await = 'busy';
    emit();
    runQueue();
  }

  /* ---------- 卖出（自己的回合内随时可卖，不占用掷骰）---------- */
  function sellStock(sym, shares) {
    if (!S || S.over) return false;
    const p = cur();
    if (!p || p.won || p.dead) return false;
    const h = holding(p, sym);
    if (!h) return false;
    shares = Math.max(1, Math.floor(shares || 0));
    shares = Math.min(h.shares, shares);
    const px = curStockPx(sym);
    p.cash += shares * px;
    h.shares -= shares;
    if (h.shares <= 0) p.stocks = p.stocks.filter(a => a !== h);
    log(`📤 ${p.name} 以 ${money(px)}/股 卖出 ${shares} 股 ${sym}，入账 ${money(shares * px)}`, 'lg');
    toast(`${p.name} 卖出 ${sym} ×${shares}`);
    emit();
    return true;
  }

  /* ---------- 队列驱动 ---------- */
  function runQueue() {
    if (!S) return;
    if (!Array.isArray(S.queue)) S.queue = [];   // 兼容旧版 / 联机快照缺字段
    let guard = 0;
    while (S.queue.length && guard++ < 100) {
      if (S.pending || S.await === 'pending' || S.over) return;
      const fn = S.queue.shift();
      // 联机快照经 JSON 序列化会把队列里的函数变成 null，防御性跳过
      if (typeof fn !== 'function') continue;
      fn();
    }
    if (S.over) return;
    if (S.pending || S.await === 'pending') return;

    // ① 走格被决策弹窗打断：先续走剩下的格子，绝不直接换人 / 丢落格事件
    if (S.walk) {
      if (S.walk.left > 0) { laterFree(tick, S.walk.stepMs); return; }
      const w = S.walk; S.walk = null;
      laterFree(() => finishMove(S.players[w.idx], w.steps), 0);
      return;
    }
    // ② 上一次换人被弹窗挡下（旧版会静默丢弃 → 永久卡死），现在补做
    if (S.needFinish) {
      S.needFinish = false;
      S.await = null;
      finishTurn();
      return;
    }
    // ③ 正常收尾
    // 注意：捐过款的玩家【不在这里立刻再掷一次】——慈善换来的双骰留到 TA 的
    // 下一回合才兑现（doRoll 里检测到 charityDice 就会掷两颗并清掉标记）。
    if (S.await === 'busy') {
      S.await = null;
      emit();
      finishTurn();
    }
  }

  /* ---------- 主动还债 ---------- */
  function payDebt(lineIdx) {
    const p = cur();
    const l = p.expLines[lineIdx];
    if (!l || !l.debt || l.paid) return;
    if (p.cash < l.principal) return;
    p.cash -= l.principal;
    l.paid = true;
    log(`✅ ${p.name} 全额还清「${l.label}」${money(l.principal)}，每月支出 −${money(l.m)}`, 'lg');
    toast(`${p.name} 还清 ${l.label}`);
    emit();
  }

  /* ---------- AI ---------- */
  // gate=true 时（换人弹窗还没被点掉）一律不自动推进：AI 也会先等着。
  function drive() {
    if (!S || S.over || S.gate) return;
    const p = cur();
    if (!p) return;
    if (S.await === 'roll' && p.ai) {
      S.await = 'busy';
      later(() => {
        if (S.over) return;
        // gate 期间（教学演示的开场导览）放弃这次掷骰，但必须把状态还回 'roll'，
        // 否则 Engine.resume() 里的 drive() 会认为“不在等待掷骰”而不再驱动 AI。
        if (S.gate) { S.await = 'roll'; return; }
        aiSellWinners(p);
        S.await = 'roll';
        doRoll();
      }, TM.aiRollMs);
    } else if (S.await === 'pending' && p.ai) {
      S.await = 'busy';
      later(autoChoose, TM.aiChooseMs);
    }
  }

  // AI 在掷骰前，自动卖出获利丰厚(≥80%)的成长股，落袋为安（红利股留作吃股息）
  function aiSellWinners(p) {
    const gain = p.aiStyle === 'aggressive' ? AP.sellGainAggr : AP.sellGain;   // 激进型拿更久、目标更高
    const sells = (p.stocks || []).filter(a => a.cat === 'grw' && curStockPx(a.sym) >= a.avg * gain);
    sells.forEach(h => sellStock(h.sym, h.shares));
    if (sells.length) log(`🤖 ${p.name} 逢高止盈 ${sells.length} 只成长股。`, 'lg');
  }

  function autoChoose() {
    if (!S.pending) return;
    const p = cur(), pd = S.pending;
    let id = 'pass', payload = {};
    switch (pd.type) {
      case 'stock': {
        const px = pd.price;
        const aggr = p.aiStyle === 'aggressive';
        if (pd.cat === 'div') {
          // 红利股：留约半月支出的现金垫防意外，其余买入（激进型留得更少）
          const keepRatio = aggr ? AP.divKeepRatioAggr : AP.divKeepRatio;
          const keep = Math.max(AP.divKeepFloor, Math.round(Engine.h.expTotal(p) * keepRatio));
          const shares = Math.max(1, Math.floor((p.cash - keep) / px));
          if (shares >= 1) { id = 'buy'; payload.amount = shares; }
        } else {
          // 成长股：稳健型要现金充裕才小仓位试水；
          // 激进型只留最低现金垫就敢买（门槛按绝对金额而非月薪 → 买得频繁、仓位更大）。
          if (aggr) {
            const budget = p.cash - AP.grwCashPadAggr;
            if (budget > px) {
              const shares = Math.max(1, Math.floor((budget * AP.grwBudgetRatioAggr) / px));
              if (shares >= 1) { id = 'buy'; payload.amount = Math.min(shares, AP.grwMaxSharesAggr); }
            }
          } else if (p.cash > p.prof.salary * AP.grwCashMinSalary) {
            const shares = Math.max(1, Math.floor((p.cash * AP.grwBudgetRatio) / px));
            if (shares >= 1) { id = 'buy'; payload.amount = Math.min(shares, AP.grwMaxShares); }
          }
        }
        break;
      }
      case 'house': {
        id = 'pass'; // AI 拒绝买房
        break;
      }
      case 'charity': {
        if (p.cash >= pd.donation + AP.charityCashPad && Math.random() < AP.charityDonateProb) id = 'donate';
        break;
      }
    }
    S.await = 'pending';
    choose(id, payload);
  }

  /* ---------- 结算统计（引擎负责事实，render 只负责呈现） ---------- */
  function stockVal(p) { return (p.stocks || []).reduce((s, a) => s + a.shares * curStockPx(a.sym), 0); }
  function netWorth(p) { return p.cash + stockVal(p); }
  // 结局：freedom=财务自由 · lastStanding=最后幸存者 · bankrupt=破产出局 · alive=仍在赛跑
  function outcome(p) {
    if (p.won) return p.lastStanding ? 'lastStanding' : 'freedom';
    if (p.dead) return 'bankrupt';
    return 'alive';
  }
  // 收官排名：胜者居首，其余按净资产降序，出局者垫底（同名次按净资产稳定排序）
  function standings() {
    if (!S) return [];
    const tier = x => (x.outcome === 'freedom' || x.outcome === 'lastStanding') ? 0 : (x.outcome === 'bankrupt' ? 2 : 1);
    return S.players.map(p => ({
      name: p.name, ai: p.ai, color: p.color,
      profName: p.prof.name, profIcon: p.prof.icon,
      outcome: outcome(p),
      cash: p.cash, stockVal: stockVal(p), netWorth: netWorth(p),
      passive: passive(p), exp: expTotal(p), turn: S.turn
    })).sort((a, b) => tier(a) - tier(b) || b.netWorth - a.netWorth)
      .map((x, i) => Object.assign(x, { rank: i + 1 }));
  }

  /* ---------- 战绩落库（跨局累计，持久化交给 data.js 的 CF.Stats） ---------- */
  // 对局结束时调用一次；recorded 标记保证同一局只写一条，且覆盖所有终局路径。
  function recordGame() {
    if (!S || !S.over || S.recorded || !CF.Stats) return;
    S.recorded = true;
    try { CF.Stats.record({ turn: S.turn, players: standings() }); }
    catch (e) { /* 存储不可用时静默降级，不影响对局 */ }
  }

  /* ---------- 对外 API ---------- */
  const Engine = {
    _timer: null,
    _walkTimer: null,              // 走格专用槽位（与 AI/讲解定时器隔离）
    _coachDeferred: null,          // 教练讲解冻结期间，被挂起的引擎定时器
    // 讲解读完时由 render 调用：把挂起的定时器恢复执行（会自动再尊重 gate）
    coachRelease: () => { const d = Engine._coachDeferred; Engine._coachDeferred = null; if (d) later(d.fn, d.ms); },
    start,
    state: () => S,
    // 联机模式：注入服务端下发的权威状态（客户端不再本地跑规则，只做渲染 + 纯函数计算）
    hydrate: s => {
      S = s || null;
      // 联机快照字段兜底：缺数组时 render / runQueue 不应抛异常中断整条渲染链
      if (S) {
        if (!Array.isArray(S.queue)) S.queue = [];
        if (!Array.isArray(S.logs)) S.logs = [];
        if (!Array.isArray(S.toasts)) S.toasts = [];
        if (!Array.isArray(S.players)) S.players = [];
      }
    },
    cur,
    onRender: fn => { _renderer = fn; },
    setRender: fn => { _renderer = fn; },
    h: { expTotal, passive, net, debtLines, holding, curStockPx, money, stockVal, netWorth, outcome, standings, doodadAmount, taxDue },
    act: { roll: doRoll, choose, payDebt, sellStock },
    // 换人弹窗：gate(true) 挂起自动推进，gate(false)+resume() 放行并补一次驱动
    gate: v => { if (S) S.gate = !!v; },
    resume: () => {
      if (!S || S.over || S.gate) return;
      // 讲解卡把 AI 定时器冻结后，S.await 会停在 'busy' 且没有任何待执行定时器；
      // drive() 只认 'roll' / 'pending'，此时会永久停摆。放行时先把挂起的定时器解冻。
      if (Engine._coachDeferred) {
        if (!(Engine._coachGate && Engine._coachGate())) Engine.coachRelease();
        return;
      }
      // 兜底解锁：任何原因遗留的孤儿 'busy'（无弹窗、无走格进度、无待执行定时器）
      // 一律拉回等待态，避免「切换玩家后按钮全无、怎么点都没反应」。
      if (!S.pending && S.await === 'busy' && !S.walk && !Engine._timer && !Engine._walkTimer) {
        S.await = 'roll';
      }
      drive();
    },
    _dbg: { bailout, autoLiquidate, marketTick }  // 仅供回归脚本直接触发（破产保护 / 行情波动）
  };
  window.Engine = Engine;
})();
