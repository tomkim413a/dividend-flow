/* 验证：大厅职业选择是否真正进入对局 */
'use strict';
const { io } = require('socket.io-client');
const { CS, SC } = require('./protocol');

const URL = process.env.URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function api(p, body) {
  const res = await fetch(URL + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return res.json();
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

(async () => {
  const u = 'pf' + Math.random().toString(36).slice(2, 7);
  const a = await api('/api/register', { username: u + 'a', password: '123456' });
  const b = await api('/api/register', { username: u + 'b', password: '123456' });
  if (a.err || b.err) throw new Error('注册失败：' + (a.err || b.err));

  const s1 = await connect(a.token);
  const s2 = await connect(b.token);

  let roomId = null, roomInfo = null;
  s1.on(SC.ROOM, r => { if (r) { roomId = r.id; roomInfo = r; } });
  s2.on(SC.ROOM, r => { if (r) { roomId = r.id; roomInfo = r; } });
  s1.on(SC.ERROR, e => console.log('⚠️ ', e.msg));

  s1.emit(CS.CREATE_ROOM, { prof: 'doctor' });
  await wait(400);
  s2.emit(CS.JOIN_ROOM, { roomId, prof: 'nurse' });
  await wait(500);

  const seatProfs = (roomInfo.seats || []).map(x => x.prof);
  console.log('大厅座位职业 =', seatProfs.join(' / '));

  let st = null;
  s1.on(SC.STATE, x => { st = x; });
  s1.emit(CS.START_GAME);
  await wait(1500);

  const got = st ? st.players.slice(0, 2).map(p => p.prof.id) : [];
  console.log('对局内职业 =', got.join(' / '));

  const ok = got[0] === 'doctor' && got[1] === 'nurse';
  console.log(ok ? '\n✅ 职业选择生效' : '\n❌ 职业未按选择生效');
  s1.close(); s2.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('异常：', e.message); process.exit(1); });
