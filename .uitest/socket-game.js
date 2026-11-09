/* ============================================================
 * socket-game.js —— 真实 Socket.IO 联机对局长跑验证
 *
 * 起本地服务端（调用方负责），用真实 socket.io-client 建房 / 开局，
 * 让服务端 vm 里的引擎连续跑若干手，验证：
 *   · 状态能持续推进（不卡在 busy / walk 残留）
 *   · snapshot 干净（queue 是数组、没有 [null]、walk 是纯数据）
 *   · 无「还没轮到你行动」等异常错误、无服务端异常
 * 用法：先 PORT=3399 node server/index.js，再 node .uitest/socket-game.js
 * ============================================================ */
'use strict';
const path = require('path');
const { io } = require(path.join(__dirname, '..', 'server', 'node_modules', 'socket.io-client'));
const { CS, SC } = require(path.join(__dirname, '..', 'server', 'protocol'));

const URL = process.env.URL || 'http://127.0.0.1:3399';
const RUN_MS = +(process.env.RUN_MS || 16000);
const wait = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

async function api(p, body) {
  const r = await fetch(URL + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
}

(async () => {
  const u = 'g' + Math.random().toString(36).slice(2, 9);
  const reg = await api('/api/register', { username: u, email: u + '@example.com', password: '1234', secQ: '我的宠物', secA: '小猫' });
  if (!reg.ok) throw new Error('注册失败: ' + JSON.stringify(reg));
  const login = await api('/api/login', { username: u, password: '1234' });
  if (!login.token) throw new Error('登录失败: ' + JSON.stringify(login));

  const stats = { states: 0, maxTurn: 0, errs: [], badQueue: 0, badWalk: 0, sfx: 0, over: false, lastStateAt: 0 };
  const s = io(URL, { auth: { token: login.token }, transports: ['websocket'] });
  await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  ck('Socket.IO 握手成功', true);

  let myIdx = -1, actedTurn = -1, actedPending = '', roomSpeed = '';
  s.on(SC.ROOM, r => {
    if (r && r.seats) myIdx = r.seats.findIndex(x => x.name === u);
    if (r && r.speed) roomSpeed = r.speed;
  });
  s.on(SC.ERROR, e => stats.errs.push(e && e.msg));
  s.on(SC.GAME_OVER, () => { stats.over = true; });
  s.on(SC.STATE, st => {
    if (!st) return;
    stats.states++;
    stats.lastStateAt = Date.now();
    stats.maxTurn = Math.max(stats.maxTurn, st.turn || 0);
    if (st.__sfx && st.__sfx.length) stats.sfx++;
    if (!Array.isArray(st.queue) || st.queue.some(x => x === null)) stats.badQueue++;
    if (st.walk && (typeof st.walk !== 'object' || typeof st.walk.left !== 'number')) stats.badWalk++;
    if (myIdx < 0 || st.cur !== myIdx || stats.over) return;
    // 轮到真人：模拟掷骰 / 决策，让对局能持续推进
    if (st.await === 'roll' && actedTurn !== st.turn) {
      actedTurn = st.turn;
      s.emit(CS.ROLL);
    } else if (st.await === 'pending' && st.pending) {
      const sig = st.turn + ':' + st.pending.type;
      if (actedPending !== sig) {
        actedPending = sig;
        const t = st.pending.type;
        const payload = t === 'liquidate' ? { random: true } : {};
        s.emit(CS.CHOOSE, { choice: t === 'charity' ? 'pass' : 'pass', payload });
      }
    }
  });

  // 长跑固定用「快速」档，避免被慢速档拉长影响推进断言
  s.emit(CS.CREATE_ROOM, { speed: 'relaxed' });
  await wait(400);
  ck('建房时指定的速度档位被服务端确认', roomSpeed === 'relaxed', 'speed=' + roomSpeed);
  s.emit(CS.START_GAME);
  await wait(RUN_MS);

  const idleMs = Date.now() - stats.lastStateAt;
  console.log(`  运行 ${RUN_MS} ms：收到 ${stats.states} 次状态，最大 turn=${stats.maxTurn}，带音效包 ${stats.sfx} 次，距上次状态 ${idleMs} ms`);
  ck('★ 对局状态持续推进（turn > 3）', stats.maxTurn > 3, 'maxTurn=' + stats.maxTurn);
  ck('★ 快照 queue 干净（无 [null] 函数残留）', stats.badQueue === 0, '异常 ' + stats.badQueue);
  ck('★ 快照 walk 为纯数据', stats.badWalk === 0, '异常 ' + stats.badWalk);
  ck('★ 无服务端操作错误', stats.errs.length === 0, stats.errs.slice(0, 3).join(' | '));
  ck('★ 引擎未停摆（末段仍有状态或已正常结束）', stats.over || idleMs < 6000, 'idle=' + idleMs + 'ms');

  s.disconnect();
  console.log('\n========================================');
  console.log(`  真实联机对局：${pass} 通过 / ${fail} 失败`);
  if (fail) process.exitCode = 1;
})().catch(e => { console.error('联机验证异常：', e); process.exitCode = 1; });
