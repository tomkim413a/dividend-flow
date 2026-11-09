/* ============================================================
 * speed-protocol.js —— 联机「房间级 AI 速度」专项验证
 *
 * A 段（纯 Node）：直接驱动 server/room.js，验证每个房间的 vm 引擎
 *    各有独立 CF.TIMING、运行中改档即时生效、房间之间不串扰、权限。
 * B 段（真实 Socket.IO，需先启动本地服务端）：验证建房带档、
 *    SET_SPEED 广播、非法档位规范化、对局中非房主被拒。
 *
 * 用法：PORT=3399 node server/index.js & node .uitest/speed-protocol.js
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { io } = require(path.join(ROOT, 'server', 'node_modules', 'socket.io-client'));
const { CS, SC } = require(path.join(ROOT, 'server', 'protocol'));
const roomMgr = require(path.join(ROOT, 'server', 'room'));

const URL = process.env.URL || 'http://127.0.0.1:3399';
const wait = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ck = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };
const head = t => console.log('\n===== ' + t + ' =====');

async function api(p, body) {
  const r = await fetch(URL + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json();
}

/* ---------------- A 房间级引擎节奏 ---------------- */
head('A 房间级速度：默认值 / 白名单 / 开局传入 / 运行中改档 / 隔离 / 权限');
{
  const host = { id: 'spd-host', username: '房主' };
  const r1 = roomMgr.createRoom(host);
  ck('新建房间使用默认档位', r1.speed === roomMgr.DEFAULT_SPEED, r1.speed);

  const r2 = roomMgr.createRoom(host, '', 'fast');
  ck('建房可指定档位', r2.speed === 'fast', r2.speed);

  const r3 = roomMgr.createRoom(host, '', 'not-a-speed');
  ck('非法档位安全回落到默认', r3.speed === roomMgr.DEFAULT_SPEED, r3.speed);

  const started = roomMgr.startGame(r2.id, () => {}, () => {});
  ck('房间开局成功', !started.err, started.err || '');
  const g = r2.game;
  ck('★ 引擎按建房时指定的档位初始化',
    g.CF.TIMING.speed === 'fast' && g.CF.TIMING.walkHold < 200,
    `speed=${g.CF.TIMING.speed} hold=${g.CF.TIMING.walkHold}`);

  const before = g.CF.TIMING.walkHold;
  const set = roomMgr.setSpeed(r2.id, host.id, 'slow');
  ck('房主在对局中改档成功', !set.err && set.room.speed === 'slow', set.err || set.room.speed);
  ck('★ 改档即时作用到该房间的引擎（无需重开局）',
    g.CF.TIMING.speed === 'slow' && g.CF.TIMING.walkHold > before * 3,
    `${before} → ${g.CF.TIMING.walkHold}`);

  // 另一个房间：档位互不影响
  const r4 = roomMgr.createRoom({ id: 'spd-other', username: '别人' }, '', 'fast');
  roomMgr.startGame(r4.id, () => {}, () => {});
  ck('★ 房间之间速度互不串扰',
    r4.game.CF.TIMING.speed === 'fast' && g.CF.TIMING.speed === 'slow',
    `别的房间=${r4.game.CF.TIMING.speed} 本房间=${g.CF.TIMING.speed}`);

  const denied = roomMgr.setSpeed(r2.id, 'stranger', 'fast');
  ck('对局中非房主改档被拒', !!denied.err, denied.err || '(错误地允许了)');
  const joined = roomMgr.joinRoom(r1.id, { id: 'spd-guest', username: '客人' });
  ck('未开局时非房主可以改档', !roomMgr.setSpeed(r1.id, 'spd-guest', 'slow').err, joined.err || '');
}

/* ---------------- B 真实 Socket 协议 ---------------- */
async function socketTests() {
  head('B 真实 Socket.IO：建房带档 / SET_SPEED 广播 / 非法档 / 权限');
  const mkUser = async tag => {
    const u = 'spd' + tag + Math.random().toString(36).slice(2, 7);
    const reg = await api('/api/register', { username: u, email: u + '@example.com', password: '1234', secQ: '我的宠物', secA: '小猫' });
    if (!reg.ok) throw new Error('注册失败: ' + JSON.stringify(reg));
    const login = await api('/api/login', { username: u, password: '1234' });
    if (!login.token) throw new Error('登录失败: ' + JSON.stringify(login));
    return { u, token: login.token };
  };
  const a = await mkUser('a'), b = await mkUser('b');
  const connect = token => new Promise((res, rej) => {
    const s = io(URL, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
  const s1 = await connect(a.token), s2 = await connect(b.token);
  ck('两个客户端 Socket.IO 握手成功', s1.connected && s2.connected);

  const rooms1 = [], rooms2 = [], errs2 = [];
  s1.on(SC.ROOM, r => rooms1.push(r));
  s2.on(SC.ROOM, r => rooms2.push(r));
  s2.on(SC.ERROR, e => errs2.push(e && e.msg));

  s1.emit(CS.CREATE_ROOM, { speed: 'slow' });
  await wait(350);
  const roomId = rooms1.length ? rooms1[rooms1.length - 1].id : '';
  ck('★ 建房时指定的档位被服务端确认并下发',
    rooms1.some(r => r.speed === 'slow'), JSON.stringify(rooms1.map(r => r.speed)));

  s2.emit(CS.JOIN_ROOM, { roomId });
  await wait(300);
  ck('第二名玩家成功加入房间', rooms2.length > 0 && rooms2[rooms2.length - 1].id === roomId, roomId);

  s1.emit(CS.SET_SPEED, { speed: 'fast' });
  await wait(300);
  ck('★ SET_SPEED 后两个客户端都收到新档位',
    rooms1.some(r => r.speed === 'fast') && rooms2.some(r => r.speed === 'fast'),
    `房主=${rooms1.map(r => r.speed)} 客人=${rooms2.map(r => r.speed)}`);

  s1.emit(CS.SET_SPEED, { speed: 'bogus' });
  await wait(300);
  ck('非法档位被服务端规范化为默认档',
    rooms1.some(r => r.speed === roomMgr.DEFAULT_SPEED),
    JSON.stringify(rooms1.map(r => r.speed)));

  s1.emit(CS.START_GAME);
  await wait(350);
  errs2.length = 0;
  s2.emit(CS.SET_SPEED, { speed: 'slow' });
  await wait(300);
  ck('★ 对局中非房主改档被明确拒绝',
    errs2.some(m => /房主/.test(m || '')), JSON.stringify(errs2));

  s1.emit(CS.SET_SPEED, { speed: 'normal' });
  await wait(300);
  ck('★ 房主在对局中仍可改档', rooms1.some(r => r.speed === 'normal'),
    JSON.stringify(rooms1.map(r => r.speed)));

  s1.disconnect(); s2.disconnect();
}

(async () => {
  try { await socketTests(); }
  catch (e) { fail++; console.log('  FAIL  Socket 段异常  → ' + (e && e.message)); }
  console.log('\n========================================');
  console.log(`  联机速度协议：${pass} 通过 / ${fail} 失败`);
  // A 段启动的引擎持有真实定时器，测完直接结束进程
  process.exit(fail ? 1 : 0);
})();
