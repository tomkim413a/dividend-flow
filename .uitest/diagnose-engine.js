/* ============================================================
 * diagnose-engine.js —— 引擎状态机死锁 / 掉链诊断（纯本地，不涉及网络）
 *
 * 用虚拟时钟替换 setTimeout，精确复现：
 *   A 批量对局：全 AI 跑 N 局，统计"定时器耗尽但游戏没结束"的死锁率
 *   B 走格中触发弹窗：验证 walk 链断裂、剩余步数/落格事件丢失
 *   C 教练/换人 gate：验证 S.await 停在 busy 且 resume() 无法恢复
 *   D 单次掷骰的 emit 次数（决定联机广播与全量重绘的频率）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

function makeEngine(opts) {
  opts = opts || {};
  let now = 0, seq = 0;
  const timers = new Map();
  const sfxBag = [];
  const SFX = new Proxy({}, { get: (t, k) => (...a) => sfxBag.push(String(k)) });
  const sandbox = {
    console,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0) }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: () => 0, clearInterval: () => {},
    SFX
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['js/data.js', 'js/engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  const CF = sandbox.CF, Engine = sandbox.Engine;
  /* 固定随机源：比较两次实验时骰子点数一致，才能只观察速度档位这一个变量 */
  if (opts.random !== undefined) {
    vm.runInContext('Math.random = () => ' + Number(opts.random), sandbox);
  }
  if (opts.fast) {
    Object.keys(CF.TIMING).forEach(k => {
      if (typeof CF.TIMING[k] === 'number') CF.TIMING[k] = 0;
    });
  }
  let emits = 0;
  Engine.setRender(() => { emits++; });
  const clock = {
    timers, sfxBag,
    get now() { return now; },
    get emits() { return emits; },
    resetEmits() { emits = 0; },
    step() {
      let best = null, bid = null;
      for (const [id, t] of timers) {
        if (!best || t.at < best.at || (t.at === best.at && id < bid)) { best = t; bid = id; }
      }
      if (!best) return false;
      timers.delete(bid);
      now = best.at;
      best.fn();
      return true;
    },
    advance(max) {
      max = max || 200000;
      let n = 0;
      while (timers.size && n++ < max) clock.step();
      return n;
    }
  };
  return { CF, Engine, clock, sandbox };
}

function cfg(n, humanIdx) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ name: 'P' + i, ai: humanIdx !== i, prof: '', shape: '' });
  return out;
}

let pass = 0, fail = 0;
function ck(name, ok, detail) {
  (ok ? pass++ : fail++);
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? '  → ' + detail : ''}`);
}
function head(t) { console.log('\n===== ' + t + ' ====='); }

/* ---------------- A 批量对局死锁率 ---------------- */
head('A 全 AI 批量对局（fast: TIMING=0，虚拟时钟推进到结束）');
{
  const N = 120, seats = 4;
  let over = 0, deadlock = 0, runaway = 0;
  const stuckSamples = [];
  for (let i = 0; i < N; i++) {
    const { Engine, clock } = makeEngine({ fast: true });
    Engine.start(cfg(seats, -1));
    const steps = clock.advance(30000);
    const S = Engine.state();
    if (S.over) over++;
    else if (clock.timers.size === 0) {
      deadlock++;
      if (stuckSamples.length < 5) stuckSamples.push({ await: S.await, pending: S.pending && S.pending.type, turn: S.turn, cur: S.cur, queue: S.queue.length });
    } else runaway++;
    if (steps >= 30000) runaway++;
  }
  console.log(`  共 ${N} 局：正常结束 ${over} / 定时器耗尽仍未结束(死锁) ${deadlock} / 超步数上限 ${runaway}`);
  if (stuckSamples.length) console.log('  死锁样本：', JSON.stringify(stuckSamples));
  ck('批量对局不存在确定性死锁', deadlock === 0, `死锁 ${deadlock}/${N}`);
}

/* ---------------- B 走格途中弹窗：进度应保留并续走 ----------------
 * 修复前基线：hamsterPos 停在 0、剩余 4 步全丢、落格事件不生成、直接换人。
 * ------------------------------------------------------------------ */
head('B 走格途中触发「破产变卖」弹窗（真人）');
{
  /* 必须掷出 ≥2 步：只掷 1 点时第一步就到 0 并弹窗，本来就没有「剩余步数」
     可保留，旧版重跑会偶发假 FAIL。重掷直到构造出有效的中断场景。 */
  let ctx, S, p, sym, before, steps = 0;
  for (let attempt = 0; attempt < 20 && steps < 2; attempt++) {
    ctx = makeEngine({ fast: false });
    const { Engine: E, CF: C, clock: K } = ctx;
    E.start(cfg(2, 0));                 // P0 真人，P1 AI
    S = E.state();
    // 把棋子放到最后一格，掷骰第一步必过 0 → bankSettle；给足持仓保证变卖后不出局
    S.cur = 0;
    p = S.players[0];
    sym = S.market[0].sym;
    p.hamsterPos = C.HAMSTER_SIZE - 1;
    p.cash = -20000;
    // div=0：避免「被动收入 > 支出」当场胜出干扰走格续走的观察
    p.stocks = [{ uid: 'x', sym, name: S.market[0].name, icon: '', cat: 'div', shares: 1000, avg: 1, div: 0 }];
    S.await = 'roll';
    S.gate = false;
    K.timers.clear();                   // 清掉 start 遗留的 AI 调度
    before = p.hamsterPos;
    E.act.roll();
    steps = S.dice.reduce((a, b) => a + b, 0);
  }
  const { Engine, CF, clock } = ctx;
  clock.advance(5000);
  const S2 = Engine.state();
  console.log(`  掷出 ${steps} 步；弹窗时 hamsterPos=${S2.players[0].hamsterPos}, await=${S2.await}, pending=${S2.pending && S2.pending.type}`);
  console.log(`  S.walk 保留的剩余步数：${S2.walk ? S2.walk.left : '(无)'}`);
  ck('弹窗期间 S.await 处于 pending（等待玩家）', S2.await === 'pending');
  ck('★ 走格进度被保留在 S.walk（而非丢弃）', !!(S2.walk && S2.walk.left > 0));

  if (S2.await === 'pending' && S2.pending && S2.pending.type === 'liquidate') {
    Engine.act.choose('liquidate', { sell: { [sym]: 1000 } });
    clock.advance(5000);
    const S3 = Engine.state();
    const entered = S3.logs.some(l => /前进 \d+ 格/.test(l.msg));
    const expectPos = (before + steps) % CF.HAMSTER_SIZE;
    console.log(`  变卖确认后：hamsterPos=${S3.players[0].hamsterPos}（应 ${expectPos}）, 落格事件=${entered}, turn=${S3.turn}`);
    console.log(`    状态: await=${S3.await}, over=${S3.over}, dead=${S3.players[0].dead}, cash=${Math.round(S3.players[0].cash)}, pending=${S3.pending && S3.pending.type}, walk=${S3.walk && S3.walk.left}, 待执行定时器=${clock.timers.size}`);
    ck('★ 剩余格子续走完毕，位置正确', S3.players[0].hamsterPos === expectPos);
    ck('★ 落格事件正常生成（不再跳过）', entered);
  }
}

/* ---------------- C gate 冻结后可恢复 ----------------
 * 修复前基线：S.await 停在 busy、零定时器，gate(false)+resume() 无法恢复。
 * ------------------------------------------------------------------ */
head('C 讲解卡冻结 / 换人 gate 的恢复能力');
{
  const { Engine, clock } = makeEngine({ fast: false });
  Engine._coachGate = () => true;        // 模拟"讲解卡未读完"
  Engine.start(cfg(4, -1));              // 全 AI：beginTurn → drive → later 被冻结
  const S = Engine.state();
  console.log(`  冻结中：await=${S.await}, 待执行定时器=${clock.timers.size}, _coachDeferred=${!!Engine._coachDeferred}`);
  ck('冻结期间引擎确实停摆（模拟前提）', S.await === 'busy' && clock.timers.size === 0);

  Engine._coachGate = null;              // 讲解读完
  Engine.gate(false);
  Engine.resume();                       // 换人弹窗点"确定"走的路径
  console.log(`  讲解结束后 resume()：await=${Engine.state().await}, 待执行定时器=${clock.timers.size}`);
  ck('★ resume() 自动解冻并重新调度（不再永久 busy）', clock.timers.size > 0);
  clock.advance(5000);
  console.log(`  继续推进后：turn=${Engine.state().turn}, await=${Engine.state().await}`);
  ck('引擎能继续推进回合', Engine.state().turn > 1 || Engine.state().over);
}

/* ---------------- C2 孤儿 busy 兜底解锁 ---------------- */
head('C2 任何原因遗留的孤儿 busy 状态');
{
  const { Engine, clock } = makeEngine({ fast: false });
  Engine.start(cfg(1, 0));               // 单人真人局
  const S = Engine.state();
  S.await = 'busy';                      // 人为制造"上一步异常退出"的残留
  clock.timers.clear();
  Engine.resume();
  console.log(`  resume() 后 await=${S.await}`);
  ck('★ 孤儿 busy 被拉回 roll（按钮恢复可点）', S.await === 'roll');
}

/* ---------------- D 单次掷骰广播频率 ---------------- */
head('D 单次掷骰的 emit 次数（联机每 emit = 一次全状态广播 + 客户端全量重绘）');
{
  const { Engine, clock } = makeEngine({ fast: false });
  Engine.start(cfg(2, 0));
  const S = Engine.state();
  S.cur = 0; S.await = 'roll'; S.gate = false;
  clock.timers.clear();
  clock.resetEmits();
  Engine.act.roll();
  clock.advance(5000);
  const S2 = Engine.state();
  const steps = S2.dice.reduce((a, b) => a + b, 0);
  console.log(`  本次 ${steps} 步 → emit ${clock.emits} 次（约 ${(clock.emits / Math.max(1, steps)).toFixed(1)} 次/格）`);
  console.log(`  状态体积(JSON)：${JSON.stringify(S2).length} 字节；logs=${S2.logs.length}`);
  ck('单次掷骰会产生 ≥ steps 次状态广播', clock.emits >= steps, `${clock.emits} 次`);
}

/* ---------------- E 固定等待耗时（直接用 1.0 倍基准，不受档位表影响） ---------------- */
head('E 基准节奏（1.0 倍）下，一轮 4 人回合的「纯代码等待」时长（零网络）');
{
  const { Engine, CF, clock } = makeEngine({ fast: false });
  // 档位表精简为两档后不再有 1.0 倍档，直接还原 TIMING_BASE 作为跨版本比较基准
  Object.keys(CF.TIMING_BASE).forEach(k => { CF.TIMING[k] = CF.TIMING_BASE[k]; });
  Engine.start(cfg(4, -1));
  let guard = 0;
  while (Engine.state().turn < 8 && guard++ < 5000) {
    if (!clock.timers.size) break;
    clock.step();                    // 只推进一个定时器，方便在 turn 到 8 时停下
  }
  const S = Engine.state();
  const ms = clock.now;
  console.log(`  跑到第 ${S.turn} 手，虚拟耗时 ${ms} ms（约 ${(ms / 1000).toFixed(1)} 秒），广播 ${clock.emits} 次`);
  const per = Math.round(ms / Math.max(1, S.turn));
  console.log(`  ⇒ 平均每手 ${per} ms 纯等待（修复前基线：3941~4249 ms/手）`);
  // 随机格子会额外产生决策弹窗等待，留一定余量；基线 3941~4249 ms/手，阈值取其一半以下
  ck('★ 节奏优化后单手纯等待 < 2.2 秒', per < 2200, `${per} ms/手`);
}

/* ---------------- G 速度档位与运行中切换 ---------------- */
head('G 两档速度：档位表完整性、引擎确实读到档位、运行中改档即时生效');
{
  const { Engine, CF, clock } = makeEngine({ fast: false });
  const rows = CF.SPEED_PRESETS.map(p => {
    CF.applySpeed(p.key);
    return `${p.key}:hold=${CF.TIMING.walkHold},step=${CF.TIMING.walkStepMax},ai=${CF.TIMING.aiRollMs}`;
  });
  rows.forEach(r => console.log('  ' + r));

  ck('默认档位是「快速」', CF.DEFAULT_SPEED === 'relaxed');
  ck('共 2 档且倍率严格递减',
    CF.SPEED_PRESETS.length === 2 &&
    CF.SPEED_PRESETS.every((p, i, a) => i === 0 || p.scale < a[i - 1].scale));
  ck('未知档位安全回落到默认档', CF.normSpeed('not-a-speed') === CF.DEFAULT_SPEED);
  ck('★ 已关闭的 normal / fast 也回落到默认档',
    CF.normSpeed('normal') === CF.DEFAULT_SPEED && CF.normSpeed('fast') === CF.DEFAULT_SPEED);

  const holdOf = k => { CF.applySpeed(k); return CF.TIMING.walkHold; };
  ck('★ 慢速档比快速档慢（3.0 倍 vs 1.8 倍）',
    holdOf('slow') > holdOf('relaxed') * 1.5, `${holdOf('slow')} vs ${holdOf('relaxed')}`);
  ck('档位只改表现层数值，不碰规则参数（TUNING 未变）',
    typeof CF.TUNING === 'object' && CF.TIMING.speed === 'relaxed');

  /* 引擎持有 CF.TIMING 的对象引用：同一起始状态下，慢速档耗时必须显著更长 */
  function runHands(speed, hands) {
    const e = makeEngine({ fast: false });
    e.CF.applySpeed(speed);
    e.Engine.start(cfg(4, -1));
    let guard = 0;
    while (e.Engine.state().turn < hands && guard++ < 4000) {
      if (!e.clock.timers.size) break;
      e.clock.step();
    }
    return e.clock.now;
  }
  const slowMs = runHands('slow', 3), quickMs = runHands('relaxed', 3);
  console.log(`  同样跑 3 手：慢速 ${slowMs} ms / 快速 ${quickMs} ms`);
  /* 方向性判据：档位的精确倍率（3.0 vs 1.8、walkHold 960 vs 576）由上面的
     确定性断言与 speed-protocol.js 覆盖。这里比较「随机 3 手耗时」时，事件/弹窗等
     与档位无关的固定开销会稀释比值，固定 ×1.4 阈值实测约 1/3 概率误红，故只验方向。 */
  ck('★ 引擎实际按档位节奏推进（慢速 > 快速）', slowMs > quickMs * 1.1,
    `${slowMs} vs ${quickMs}（比值 ${(slowMs / Math.max(1, quickMs)).toFixed(2)}）`);

  /* 运行中切档：不重开局，后续定时器也要按新节奏 */
  CF.applySpeed('slow');
  Engine.start(cfg(4, -1));
  let g2 = 0;
  while (Engine.state().turn < 2 && g2++ < 2000) { if (!clock.timers.size) break; clock.step(); }
  const t0 = clock.now;
  const holdSlow = CF.TIMING.walkHold;
  CF.applySpeed('relaxed');
  const holdFast = CF.TIMING.walkHold;
  while (Engine.state().turn < 5 && g2++ < 4000) { if (!clock.timers.size) break; clock.step(); }
  const after = clock.now - t0;
  console.log(`  运行中从慢速切到快速后，再跑 3 手耗时 ${after} ms；walkHold ${holdSlow} → ${holdFast}`);
  /* 确定性判据：引擎持有 CF.TIMING 对象引用，applySpeed 后下一手立即按新档位走。
     原判据用「随机 3 手耗时 < 慢速 3 手耗时」比较，会因随机事件路径抖动误红
     （连跑 5 次约 1 次误报），与产品代码无关，故改为检查引用值 + 后续确实推进。 */
  ck('★ 运行中改档即时生效（无需重开局）',
    after > 0 && CF.TIMING.speed === 'relaxed' && holdFast < holdSlow,
    `walkHold ${holdSlow} → ${holdFast}`);
}

/* ---------------- H 真人节奏与 AI 档位彻底隔离 ---------------- */
head('H 真人玩家节奏不受 AI 速度档位影响（玩家明确要求）');
{
  const { CF } = makeEngine({ fast: false });
  const keys = Object.keys(CF.HUMAN_TIMING);
  ck('真人节奏单独成组（4 个 humanWalk* 字段）', keys.length === 4 && keys.every(k => /^humanWalk/.test(k)), keys.join(','));
  ck('真人固定值等于基准节奏',
    CF.HUMAN_TIMING.humanWalkHold === CF.TIMING_BASE.walkHold &&
    CF.HUMAN_TIMING.humanWalkTotal === CF.TIMING_BASE.walkTotal,
    `hold ${CF.HUMAN_TIMING.humanWalkHold} vs ${CF.TIMING_BASE.walkHold}`);

  const before = keys.map(k => CF.TIMING[k]);
  CF.applySpeed('slow');
  const afterSlow = keys.map(k => CF.TIMING[k]);
  CF.applySpeed('relaxed');
  const afterFast = keys.map(k => CF.TIMING[k]);
  ck('★ applySpeed 改档时绝不触碰真人节奏字段',
    before.every((v, i) => v === afterSlow[i] && v === afterFast[i]),
    `${before} → ${afterSlow} → ${afterFast}`);

  /* 端到端量化：真人在慢速档与快速档下，掷骰停顿和逐格间隔必须完全一致 */
  function humanWalk(speed) {
    const e = makeEngine({ fast: false, random: 0.5 });   // 固定掷出 4 点，两次完全可比
    e.CF.applySpeed(speed);
    e.Engine.start(cfg(2, 0));           // P0 真人，P1 AI
    const S = e.Engine.state();
    S.cur = 0; S.gate = false; S.await = 'roll';
    e.clock.timers.clear();
    e.Engine.act.roll();
    e.clock.step();                      // 触发 walk()，写入 S.walk
    const w = e.Engine.state().walk;
    return { hold: e.clock.now, stepMs: w && w.stepMs, aiHold: e.CF.TIMING.walkHold };
  }
  const hSlow = humanWalk('slow'), hFast = humanWalk('relaxed');
  console.log(`  真人：慢速档 [停顿 ${hSlow.hold}ms / 每格 ${hSlow.stepMs}ms]，快速档 [停顿 ${hFast.hold}ms / 每格 ${hFast.stepMs}ms]`);
  console.log(`  同期 AI 的 walkHold：${hSlow.aiHold}ms → ${hFast.aiHold}ms`);
  ck('★ 真人掷骰后停顿不随档位变化，且等于基准值',
    hSlow.hold === hFast.hold && hSlow.hold === CF.TIMING_BASE.walkHold, `${hSlow.hold} vs ${hFast.hold}`);
  ck('★ 真人逐格行走间隔不随档位变化',
    hSlow.stepMs === hFast.stepMs && hSlow.stepMs > 0, `${hSlow.stepMs} vs ${hFast.stepMs}`);
  ck('★ 同一时刻 AI 节奏确实按档位变了', hSlow.aiHold > hFast.aiHold * 1.5, `${hSlow.aiHold} vs ${hFast.aiHold}`);
}

/* ---------------- F 联机状态序列化 ---------------- */
head('F 服务端 snapshot(JSON) 对内部字段的破坏');
{
  const { Engine } = makeEngine({ fast: false });
  Engine.start(cfg(2, 0));
  const S = Engine.state();
  S.queue.push(() => { /* 模拟队列里的待执行事件：引擎内部是函数 */ });
  const snap = JSON.parse(JSON.stringify(S));
  console.log(`  序列化前 queue=[function]，序列化后 queue=${JSON.stringify(snap.queue)}`);
  ck('★ queue 里的函数变成 null（客户端 hydrate 后若误跑规则会 TypeError）',
    Array.isArray(snap.queue) && snap.queue.some(x => x === null));
  console.log(`  快照体积 ${JSON.stringify(snap).length} 字节，logs=${snap.logs.length}，market.hist 合计 ${snap.market.reduce((a, m) => a + (m.hist || []).length, 0)} 点`);
}

console.log('\n========================================');
console.log(`  诊断结果：${pass} 项符合预期 / ${fail} 项未复现`);
console.log('  注：带 ★ 的断言用于确认缺陷客观存在，符合预期 = 缺陷成立');
