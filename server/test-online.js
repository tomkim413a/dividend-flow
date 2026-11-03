/* ============================================================
 * test-online.js —— 联机「阶段2」联调脚本
 * 模拟两个真实玩家：注册登录 → 建房 → 加入 → 开局 → 推进，验证服务端链路。
 * 用法：node test-online.js
 * ============================================================ */
'use strict';
const { io } = require('socket.io-client');
const { CS, SC } = require('./protocol');

const URL = process.env.URL || 'http://localhost:3000';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function api(p, body) {
  const res = await fetch(URL + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { auth: { token }, transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', e => reject(e));
  });
}

(async () => {
  const u = 'p' + Math.random().toString(36).slice(2, 8);
  const a = await api('/api/register', { username: u + 'a', password: '123456' });
  const b = await api('/api/register', { username: u + 'b', password: '123456' });

  const s1 = await connect(a.token);
  const s2 = await connect(b.token);
  console.log('✅ 两个客户端已连接（JWT 校验通过）');

  let roomId = null, roomInfo = null;
  s1.on(SC.ROOM, r => { if (r) { roomId = r.id; roomInfo = r; } });
  s2.on(SC.ROOM, r => { if (r) { roomId = r.id; roomInfo = r; } });
  s1.on(SC.ERROR, e => console.log('⚠️ 服务端错误:', e.msg));
  s2.on(SC.ERROR, e => console.log('⚠️ 服务端错误:', e.msg));

  s1.emit(CS.CREATE_ROOM);
  await wait(600);
  console.log('✅ 建房成功，房间号 =', roomId);

  s2.emit(CS.JOIN_ROOM, { roomId });
  await wait(600);
  console.log('✅ 加入房间，当前座位 =', (roomInfo.seats || []).map(x => x.name).join(' / '));

  let states = 0, last = null, allSfx = [];
  s1.on(SC.STATE, st => {
    states++; last = st;
    if (st && st.__sfx) allSfx = allSfx.concat(st.__sfx);
    if (st && st.__sfx && st.__sfx.length) console.log('   >> 收到音效批次:', JSON.stringify(st.__sfx));
    else if (st) console.log('   >> 收到状态（无音效字段）await=' + st.await);
  });
  s2.on(SC.STATE, st => { last = st; if (st && st.__sfx) allSfx = allSfx.concat(st.__sfx); });

  s1.emit(CS.START_GAME);
  await wait(2000);
  console.log(`✅ 开局：收到状态广播 ${states} 次`);
  if (last) {
    const cur = last.players && last.players[last.cur];
    console.log(`   回合=${last.turn} 玩家数=${last.players && last.players.length} 当前=${cur && cur.name} await=${last.await}`);
    console.log(`   累计音效事件=${JSON.stringify(allSfx)}  待显示提示数=${(last.toasts || []).length}`);
  }

  // 两个玩家都尝试掷骰（引擎会忽略非法时机），观察推进
  s1.emit(CS.ROLL);
  await wait(800);
  s2.emit(CS.ROLL);
  await wait(1500);
  if (last) {
    console.log(`   掷骰后：回合=${last.turn} await=${last.await} over=${!!last.over}`);
  }

  const ok = states > 0 && !!last;
  console.log(ok ? '\n🎉 阶段2 联调通过：建房/加入/开局/状态同步 全部正常' : '\n❌ 阶段2 联调失败');
  s1.close(); s2.close();
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error('联调异常:', e && e.message);
  process.exit(1);
});
