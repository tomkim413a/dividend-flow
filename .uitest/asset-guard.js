/* ============================================================
 * asset-guard.js —— 真人资产处置权回归
 *
 * 背景：联机断线时 server/room.leaveRoom() 会把引擎里的 p.ai 临时改成 true
 * 让电脑代打回合。旧版 engine.bailout() 用 !p.ai 判断「是否真人」，
 * 于是一断线就把真人资产当成 AI 资产自动变卖，玩家没看到弹窗股票就没了。
 * 本脚本同时守住：真 AI 照旧自动变卖、真人重连后能自己选、
 * 主动放弃后 AI 能接管（不卡死）、飞行中的托管定时器不替真人卖股。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const roomMgr = require(path.join(ROOT, 'server', 'room'));
const wait = ms => new Promise(r => setTimeout(r, ms));
const code = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function makeRoom(tag, opt) {
  const A = { id: 'ag_a' + tag, username: '真人A' + tag };
  const B = { id: 'ag_b' + tag, username: '真人B' + tag };
  const r = roomMgr.createRoom(A, '', 'relaxed');
  roomMgr.joinRoom(r.id, B, '');
  roomMgr.setRoomCfg(r.id, A.id, Object.assign({ seatCap: 2, aiCount: 0 }, opt || {}));
  const g = roomMgr.startGame(r.id, () => {}, () => {});
  if (g.err) throw new Error('startGame 失败: ' + g.err);
  return { room: g.room, A, B };
}
function giveStocks(S, p, bigGain) {
  const m = (S.market || []).find(x => x && x.sym);
  if (!m) throw new Error('无行情数据');
  const px = m.px != null ? m.px : 100;
  p.stocks = [{ sym: m.sym, name: m.name || m.sym, icon: '📈', cat: 'grw', div: 0,
                shares: 20, avg: bigGain ? Math.round(px / 3) : px }];
  return { sym: m.sym, px };
}
const shares = p => (p.stocks || []).reduce((n, h) => n + h.shares, 0);
const freeze = g => g.stop();

(async () => {
  console.log('\n=== A. 静态防线：座位身份与 p.ai 解耦 ===');
  const eng = code(read('js/engine.js'));
  const host = code(read('server/engineHost.js'));
  const room = code(read('server/room.js'));
  const srv = code(read('server/index.js'));

  ck('buildCfg 写入不可变的 humanSeat（按开局 ai 取反）',
    /humanSeat: !p\.ai/.test(host));
  ck('buildPlayer 保留 humanSeat，单机 cfg 缺失时按 ai 兜底',
    /humanSeat: cfg\.humanSeat !== undefined \? !!cfg\.humanSeat : !cfg\.ai/.test(eng));
  ck('isHumanSeat 有单机兜底，行为与旧版逐字段一致',
    /function isHumanSeat\(p\)[\s\S]{0,160}p\.humanSeat !== undefined \? !!p\.humanSeat : !p\.ai/.test(eng));
  ck('★ bailout 用 isHumanSeat 而不是 !p.ai 分流',
    /if \(isHumanSeat\(p\) && \(p\.stocks \|\| \[\]\)\.length\)/.test(eng)
    && !/function bailout\(p\)[\s\S]{0,260}if \(!p\.ai &&/.test(eng));
  ck('★ drive 托管真人遇 liquidate 直接挂起，不排 AI 决策',
    /if \(isHumanSeat\(p\) && S\.pending && S\.pending\.type === 'liquidate'\) return;/.test(eng));
  ck('★ AI 掷骰定时器回调检查重连（不替真人止盈卖股 / 掷骰）',
    /if \(cur\(\) !== p\) return;[\s\S]{0,100}if \(!p\.ai\) \{ S\.await = 'roll'; return; \}/.test(eng));
  ck('★ autoChoose 双保险：重连后或 liquidate 一律交还本人',
    /if \(isHumanSeat\(p\) && \(!p\.ai \|\| pd\.type === 'liquidate'\)\) \{ S\.await = 'pending'; return; \}/.test(eng));
  ck('★ 主动放弃后把座位交给 AI 并补一次 resume（不卡死整局）',
    /if \(gp\) gp\.humanSeat = false;/.test(room)
    && /if \(room\.game && room\.game\.Engine\.resume\) room\.game\.Engine\.resume\(\);/.test(room));
  // 只截 leaveRoom 函数体，避免把紧随其后的 giveUp 里那句 humanSeat = false 算进来
  const leaveBody = room.slice(room.indexOf('function leaveRoom'), room.indexOf('function giveUp'));
  ck('leaveRoom 仍只改 p.ai（代打回合），不碰 humanSeat',
    /if \(p\) p\.ai = true;/.test(leaveBody) && !/humanSeat/.test(leaveBody));
  ck('resume 仍把 p.ai 改回 false', /if \(p\) p\.ai = false;/.test(room));
  ck('★ 断线托管绑在 disconnecting（disconnect 时 socket.rooms 已被清空）',
    /socket\.on\('disconnecting', \(\) => \{[\s\S]{0,300}roomMgr\.leaveRoom\(/.test(srv)
    && !/socket\.on\('disconnect', \(\) => \{[\s\S]{0,300}roomMgr\.leaveRoom\(/.test(srv));

  console.log('\n=== B. 场景 A：弹窗开着时断线，不得自动卖 ===');
  {
    const { room: r, A } = makeRoom('1');
    const g = r.game; freeze(g);
    const S = g.Engine.state(); S.cur = 0;
    const h = giveStocks(S, S.players[0]);
    S.players[0].cash = -Math.ceil(h.px * 3);
    S.await = 'pending'; S.pending = { type: 'liquidate', deficit: Math.ceil(h.px * 3) };
    const before = shares(S.players[0]);
    roomMgr.leaveRoom(r.id, A.id);
    await wait(700);
    const S2 = g.Engine.state();
    ck('★ 断线托管后股票一股未动', shares(S2.players[0]) === before,
      `${before} -> ${shares(S2.players[0])}`);
    ck('★ 破产变卖弹窗仍挂起等玩家回来',
      S2.pending && S2.pending.type === 'liquidate' && S2.await === 'pending',
      JSON.stringify({ p: S2.pending && S2.pending.type, await: S2.await }));
    ck('未产生自动变卖回放记录', !(S2.liq && S2.liq.steps && S2.liq.steps.length));
  }

  console.log('\n=== C. 场景 B：托管期间现金变负，也不得自动卖 ===');
  {
    const { room: r, A } = makeRoom('2');
    const g = r.game; freeze(g);
    roomMgr.leaveRoom(r.id, A.id);
    const S = g.Engine.state(); S.cur = 0;
    const h = giveStocks(S, S.players[0]);
    S.players[0].cash = -Math.ceil(h.px * 3);
    const before = shares(S.players[0]);
    g.Engine._dbg.bailout(S.players[0]);
    const S2 = g.Engine.state();
    ck('★ 触发破产保护后仍是弹窗，股票未动',
      S2.pending && S2.pending.type === 'liquidate' && shares(S2.players[0]) === before,
      JSON.stringify({ p: S2.pending && S2.pending.type, sh: shares(S2.players[0]) }));
  }

  console.log('\n=== D. 对照组：真人在线 / 真 AI 玩家规则不变 ===');
  {
    const { room: r } = makeRoom('3');
    const g = r.game; freeze(g);
    const S = g.Engine.state(); S.cur = 0;
    const h = giveStocks(S, S.players[0]);
    S.players[0].cash = -Math.ceil(h.px * 3);
    const before = shares(S.players[0]);
    g.Engine._dbg.bailout(S.players[0]);
    const S2 = g.Engine.state();
    ck('真人在线：弹窗且一股未卖',
      S2.pending && S2.pending.type === 'liquidate' && shares(S2.players[0]) === before);
  }
  {
    const A = { id: 'ag_a4', username: '真人D' };
    const r = roomMgr.createRoom(A, '', 'relaxed');
    roomMgr.setRoomCfg(r.id, A.id, { seatCap: 2, aiCount: 1 });
    const g = roomMgr.startGame(r.id, () => {}, () => {});
    const game = g.room.game; freeze(game);
    const S = game.Engine.state();
    const ai = S.players.find(p => p.ai);
    S.cur = S.players.indexOf(ai);
    const h = giveStocks(S, ai);
    ai.cash = -Math.ceil(h.px * 3);
    const before = shares(ai);
    game.Engine._dbg.bailout(ai);
    const S2 = game.Engine.state();
    ck('★ 真正的电脑玩家照旧自动变卖（平衡未改）',
      shares(S2.players[S.cur]) < before && !(S2.pending && S2.pending.type === 'liquidate'),
      `${before} -> ${shares(S2.players[S.cur])}`);
  }

  console.log('\n=== E. 重连后本人自选，状态机继续 ===');
  {
    const { room: r, A } = makeRoom('5');
    const g = r.game; freeze(g);
    const S = g.Engine.state(); S.cur = 0;
    const h = giveStocks(S, S.players[0]);
    S.players[0].cash = -Math.ceil(h.px * 3);
    g.Engine._dbg.bailout(S.players[0]);
    roomMgr.leaveRoom(r.id, A.id);
    await wait(400);
    const rr = roomMgr.resume(r.id, A.id);
    ck('重连成功且座位恢复真人', !rr.err && r.seats[rr.seatIndex].ai === false);
    const S3 = g.Engine.state();
    ck('重连后仍在等玩家决策（await=pending）', S3.await === 'pending', 'await=' + S3.await);
    g.Engine.act.choose('liquidate', { sell: { [h.sym]: 3 } });
    const S4 = g.Engine.state();
    ck('★ 玩家点确认后才按自己填的股数卖出', shares(S4.players[0]) === 17,
      '剩余 ' + shares(S4.players[0]));
    ck('★ 变卖后状态机继续推进', S4.await !== 'pending', 'await=' + S4.await);
  }

  console.log('\n=== F. 主动放弃：AI 全权接管，不把整局卡在弹窗 ===');
  {
    const { room: r, A } = makeRoom('6');
    const g = r.game; freeze(g);
    const S = g.Engine.state(); S.cur = 0;
    const h = giveStocks(S, S.players[0]);
    S.players[0].cash = -Math.ceil(h.px * 3);
    g.Engine._dbg.bailout(S.players[0]);
    const res = roomMgr.giveUp(r.id, A.id);
    await wait(600);
    const S2 = g.Engine.state();
    ck('放弃登记成功、房间继续且转让房主',
      !res.err && !res.terminated && !!res.hostTransferred,
      JSON.stringify({ err: res.err, t: res.terminated, h: res.hostTransferred }));
    ck('★ AI 接管并完成变卖（不卡死）',
      !(S2.pending && S2.pending.type === 'liquidate') && shares(S2.players[0]) < 20,
      JSON.stringify({ p: S2.pending && S2.pending.type, sh: shares(S2.players[0]) }));
  }

  console.log('\n=== G. 飞行中的托管定时器：重连后不代打 ===');
  {
    const { room: r, A } = makeRoom('7');
    const g = r.game; freeze(g);
    const S = g.Engine.state(); S.cur = 0; S.await = 'roll'; S.dice = [0];
    giveStocks(S, S.players[0], true);       // 大幅获利成长股，足以触发逢高止盈
    const dice0 = JSON.stringify(S.dice), sh0 = shares(S.players[0]);
    roomMgr.leaveRoom(r.id, A.id);           // 排下 320ms 的 AI 掷骰定时器
    roomMgr.resume(r.id, A.id);              // 立刻重连
    await wait(700);
    const S2 = g.Engine.state();
    ck('★ 没有替真人逢高止盈卖股', shares(S2.players[0]) === sh0,
      `${sh0} -> ${shares(S2.players[0])}`);
    ck('★ 没有替真人自动掷骰', JSON.stringify(S2.dice) === dice0,
      `${dice0} -> ${JSON.stringify(S2.dice)}`);
    ck('★ 回合交还本人（await=roll）', S2.await === 'roll', 'await=' + S2.await);
  }

  console.log(`\n========================================\n  真人资产处置权回归：${pass} 通过 / ${fail} 失败\n========================================\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e); process.exit(2); });
