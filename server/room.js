/* ============================================================
 * room.js —— 房间管理（建房 / 加入 / 改职业 / 开局 / 离房托管）
 * ============================================================ */
'use strict';
const { createGame } = require('./gameRunner');
const { createEngineContext } = require('./engineHost');

const MAX_SEATS = 4;
const rooms = new Map();          // roomId -> room

/* 合法职业白名单：直接取自 data.js，避免客户端乱传职业 id */
let PROF_IDS = [];
try {
  PROF_IDS = createEngineContext({ fast: true }).CF.PROFESSIONS.map(p => p.id);
} catch (e) {
  console.warn('[room] 职业列表加载失败，将按序号兜底：', e.message);
}
const PROF_SET = new Set(PROF_IDS);

const normProf = prof => (PROF_SET.has(String(prof || '')) ? String(prof) : '');
const randomProf = () => (PROF_IDS.length ? PROF_IDS[Math.floor(Math.random() * PROF_IDS.length)] : '');

function genRoomId() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 去掉易混淆字符
  let id;
  do {
    id = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(id));
  return id;
}

function createRoom(hostUser, prof) {
  const id = genRoomId();
  const room = {
    id,
    hostId: hostUser.id,
    // 没选职业 → 随机分配，避免"随机"实际固定成第一个职业
    seats: [{ userId: hostUser.id, name: hostUser.username, ai: false, prof: normProf(prof) || randomProf() }],
    game: null,
    started: false
  };
  rooms.set(id, room);
  return room;
}

function joinRoom(roomId, user, prof) {
  const room = rooms.get(String(roomId || '').toUpperCase());
  if (!room) return { err: '房间不存在' };
  if (room.started) return { err: '对局已开始，无法加入' };

  let seat = room.seats.find(s => s.userId === user.id);
  if (!seat) {
    if (room.seats.length >= MAX_SEATS) return { err: '房间已满（最多 4 家）' };
    seat = { userId: user.id, name: user.username, ai: false, prof: normProf(prof) || randomProf() };
    room.seats.push(seat);
  } else if (prof) {
    seat.prof = normProf(prof) || seat.prof;
  }
  return { room };
}

/* 开局前本人可改职业；已开局则忽略 */
function setProf(roomId, userId, prof) {
  const room = rooms.get(String(roomId || '').toUpperCase());
  if (!room || room.started) return null;
  const seat = room.seats.find(s => s.userId === userId);
  if (!seat) return null;
  seat.prof = normProf(prof) || randomProf();
  return room;
}

function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (!room.started) {
    // 未开局：直接移除座位；人走光则销毁房间
    room.seats = room.seats.filter(s => s.userId !== userId);
    if (!room.seats.length) { rooms.delete(roomId); return null; }
    if (room.hostId === userId) room.hostId = room.seats[0].userId;
    return room;
  }

  // 对局中离开：座位托管给 AI（职业保留）
  const idx = room.seats.findIndex(s => s.userId === userId);
  if (idx >= 0) {
    room.seats[idx].ai = true;
    const S = room.game && room.game.Engine.state();
    const p = S && S.players && S.players[idx];
    if (p) p.ai = true;
    if (room.game && room.game.Engine.resume) room.game.Engine.resume();
  }
  return room;
}

/**
 * 开局：不足 4 家用 AI 补齐（AI 随机职业）
 */
function startGame(roomId, onState, onOver) {
  const room = rooms.get(roomId);
  if (!room) return { err: '房间不存在' };
  if (room.started) return { err: '对局已经开始' };

  const seats = room.seats.slice(0, MAX_SEATS);
  let aiNo = 1;
  while (seats.length < MAX_SEATS) {
    seats.push({ userId: null, name: '电脑' + (aiNo++), ai: true, prof: randomProf() });
  }
  room.seats = seats;
  room.started = true;
  room.game = createGame(seats, onState, onOver);
  return { room };
}

/**
 * 断线重连：回到原座位，并取消 AI 托管（恢复真人操控）
 */
function resume(roomId, userId) {
  const room = rooms.get(String(roomId || '').toUpperCase());
  if (!room) return { err: '房间不存在' };
  const idx = room.seats.findIndex(s => s.userId === userId);
  if (idx < 0) return { err: '你不在这个房间' };

  const seat = room.seats[idx];
  seat.ai = false;
  const S = room.game && room.game.Engine.state();
  const p = S && S.players && S.players[idx];
  if (p) p.ai = false;                       // 引擎里也恢复为真人
  return { room, seatIndex: idx };
}

module.exports = { rooms, MAX_SEATS, createRoom, joinRoom, setProf, leaveRoom, startGame, resume };
