/* ============================================================
 * match-protocol.js —— 房间级设置 / 邀请链接 / 公开房列表 回归
 *
 * 纯 Node，不依赖 socket 与数据库：用桩替换 createGame，只验证房间管理层的
 * 不变式（座位下标、AI 追加顺序、家数下限、列表脱敏、权限、协议兼容）。
 * 引擎/渲染/走格链路仍由 diagnose-engine.js 与 browser-gameplay.js 覆盖。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ck = (n, ok, d) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`);
};
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* createGame 会启动真实引擎定时器，桩掉它，只观察 room.js 的座位逻辑 */
const grPath = require.resolve(path.join(ROOT, 'server', 'gameRunner'));
const fakeGame = {
  CF: { TIMING: {} },
  Engine: { state: () => ({ players: [] }), resume: () => {} },
  setSpeed: () => {}, state: () => ({})
};
require.cache[grPath] = {
  id: grPath, filename: grPath, loaded: true,
  exports: { createGame: () => fakeGame }
};
const M = require(path.join(ROOT, 'server', 'room'));
const { CS, SC } = require(path.join(ROOT, 'server', 'protocol'));
const mk = (id, name) => ({ id, username: name || id });
const clean = () => M.rooms.clear();

console.log('\n===== A 默认配置：与未加功能前的旧行为完全一致 =====');
clean();
{
  const r = M.createRoom(mk('h'), '', 'relaxed');
  ck('默认总家数 4', r.seatCap === 4, String(r.seatCap));
  ck('默认电脑数 = AI_AUTO（自动补满）', r.aiCount === M.AI_AUTO, String(r.aiCount));
  ck('默认私密房', r.visibility === 'private', r.visibility);
  ck('默认真人位 4', M.humanCapOf(r) === 4, String(M.humanCapOf(r)));
  for (let i = 1; i <= 3; i++) M.joinRoom(r.id, mk('u' + i), '');
  ck('默认可坐满 4 位真人', r.seats.length === 4, String(r.seats.length));
  const over = M.joinRoom(r.id, mk('x'), '');
  ck('第 5 人被拒且错误文案与旧版一致', over.err === '房间已满（最多 4 家）', String(over.err));
  ck('开局前 seats 里一个 AI 都没有', r.seats.every(s => s.userId && !s.ai));
}

clean();
{
  const r = M.createRoom(mk('h2'), '', 'relaxed');
  M.joinRoom(r.id, mk('u2'), '');
  const st = M.startGame(r.id, () => {}, () => {});
  const seats = st.room.seats;
  ck('默认开局自动补满到 4 家', seats.length === 4, String(seats.length));
  ck('AI 永远追加在真人之后、名字连续',
    seats[2].name === '电脑1' && seats[3].name === '电脑2' &&
    seats[2].userId === null && seats[3].ai === true,
    seats.map(s => s.name).join(','));
  ck('真人下标未被打乱', seats[0].userId === 'h2' && seats[1].userId === 'u2');
}

console.log('\n===== B 两个旋钮：总家数 2–4 × 电脑数 =====');
let combos = 0, bad = [];
for (let seatCap = 2; seatCap <= 4; seatCap++) {
  for (const ai of ['auto', 0, 1, 2, 3]) {
    if (ai !== 'auto' && ai > seatCap - 1) continue;
    clean();
    const r = M.createRoom(mk('h'), '', 'relaxed', { seatCap, aiCount: ai, visibility: 'public' });
    const cap = M.humanCapOf(r);
    const expectCap = ai === 'auto' ? seatCap : seatCap - ai;
    if (cap !== expectCap) bad.push(`seatCap=${seatCap},ai=${ai} humanCap=${cap}≠${expectCap}`);
    if (r.aiCount !== (ai === 'auto' ? M.AI_AUTO : ai)) bad.push(`aiCount 未标准化 @${seatCap}/${ai}`);
    for (let i = 1; i < cap; i++) {
      const x = M.joinRoom(r.id, mk('u' + i), '');
      if (x.err) bad.push(`第 ${i + 1} 位真人不该被拒 @${seatCap}/${ai}: ${x.err}`);
    }
    if (!M.joinRoom(r.id, mk('over'), '').err) bad.push(`未拦住第 ${cap + 1} 位真人 @${seatCap}/${ai}`);
    const humans = r.seats.length;
    const st = M.startGame(r.id, () => {}, () => {});
    const total = humans + (ai === 'auto' ? 0 : ai);
    if (total < 2) {
      if (!st.err) bad.push(`未拦住 <2 家开局 @${seatCap}/${ai}`);
    } else {
      if (st.err) bad.push(`合法配置开局被误拒 @${seatCap}/${ai}: ${st.err}`);
      const s = st.room.seats;
      if (s.length !== total) bad.push(`家数 ${s.length}≠${total} @${seatCap}/${ai}`);
      for (let i = 0; i < humans; i++)
        if (s[i].userId !== (i === 0 ? 'h' : 'u' + i)) bad.push(`真人下标错位 @${i}`);
      for (let i = humans; i < s.length; i++)
        if (s[i].userId !== null || s[i].ai !== true || s[i].name !== '电脑' + (i - humans + 1))
          bad.push(`AI 座位异常 @${i}`);
    }
    combos++;
  }
}
ck(`穷举 ${combos} 组配置：真人位/加入上限/家数下限/AI 追加全部合法`,
  bad.length === 0, bad.slice(0, 3).join(' | ') || '0 异常');

console.log('\n===== C 房间设置权限与公开房列表 =====');
clean();
{
  const r = M.createRoom(mk('host'), '', 'relaxed', { seatCap: 4, aiCount: 1 });
  const a = M.setRoomCfg(r.id, 'stranger', { seatCap: 3 });
  ck('非房主改设置被拒', !!a.err, String(a.err));
  const b = M.setRoomCfg(r.id, 'host', { seatCap: 4, aiCount: 3 });
  ck('房主可改且真人数 + AI 未超总家数', !b.err && r.aiCount === 3, String(b.err || r.aiCount));
  /* humanCap=1 时第 2 位真人本来就会被 joinRoom 拦住；改用 0 AI 房坐满 4 真人，
     再把电脑数调到 3，才能真正触发「真人数 + AI > 总家数」这条守卫。 */
  const c0 = M.createRoom(mk('c'), '', 'relaxed', { seatCap: 4, aiCount: 0 });
  for (let i = 1; i < 4; i++) M.joinRoom(c0.id, mk('c' + i), '');
  const c = M.setRoomCfg(c0.id, 'c', { seatCap: 4, aiCount: 3 });
  ck('真人数 + AI 超过总家数时被拒（不会生成 5 家）', !!c.err, String(c.err));
  M.startGame(r.id, () => {}, () => {});
  ck('开局后改设置被拒', !!M.setRoomCfg(r.id, 'host', { seatCap: 2 }).err);
}
clean();
{
  const pub = M.createRoom(mk('p'), '', 'relaxed', { seatCap: 4, aiCount: 1, visibility: 'public' });
  const pri = M.createRoom(mk('q'), '', 'relaxed', { visibility: 'private' });
  const list = M.listOpenRooms();
  ck('私密房不进入列表', list.every(x => x.id !== pri.id));
  ck('公开房进入列表且真人位正确', list.some(x => x.id === pub.id && x.humanCap === 3 && x.count === 1));
  ck('列表脱敏：不含 userId / hostId / prof / name',
    !/userId|hostId|prof|username|name/.test(JSON.stringify(list)), JSON.stringify(list[0]));
  for (let i = 1; i < 3; i++) M.joinRoom(pub.id, mk('g' + i), '');
  ck('真人位坐满后该房从列表消失', M.listOpenRooms().every(x => x.id !== pub.id));
  const pub2 = M.createRoom(mk('r'), '', 'relaxed', { visibility: 'public' });
  M.startGame(pub2.id, () => {}, () => {});
  ck('已开局的房从列表消失', M.listOpenRooms().every(x => x.id !== pub2.id));
}

console.log('\n===== D 审查发现的边界缺陷（回归防线） =====');
clean();
{
  const r = M.createRoom(mk('host'), '', 'relaxed');
  M.joinRoom(r.id, mk('b'), '');
  M.joinRoom(r.id, mk('c'), '');
  const before = { cap: r.seatCap, ai: r.aiCount };
  const bad = M.setRoomCfg(r.id, 'host', { seatCap: 2, aiCount: 'auto' });
  ck('★ 3 位真人时把家数缩到 2（自动补满）被明确拒绝', !!bad.err, String(bad.err));
  ck('★ 被拒后原设置不变、无人被踢',
    r.seats.length === 3 && r.seatCap === before.cap && r.aiCount === before.ai,
    JSON.stringify({ seats: r.seats.length, cap: r.seatCap, ai: r.aiCount }));
  const g = M.startGame(r.id, () => {}, () => {});
  ck('★ 仍能正常开局且第三位真人保留在座位上',
    !g.err && g.room.seats.length === 4 && g.room.seats[2].userId === 'c',
    g.err || g.room.seats.map(s => s.name).join(','));
}

clean();
{
  const r = M.createRoom(mk('host'), '', 'relaxed');
  M.setRoomCfg(r.id, 'host', { seatCap: 3, aiCount: 1 });
  const v = M.setRoomCfg(r.id, 'host', { visibility: 'public' });
  ck('★ 只改公开/私密不重置家数与电脑数',
    !v.err && r.seatCap === 3 && r.aiCount === 1 && r.visibility === 'public',
    JSON.stringify({ cap: r.seatCap, ai: r.aiCount, vis: r.visibility }));
  const v2 = M.setRoomCfg(r.id, 'host', { visibility: 'private' });
  ck('★ 关回私密仍保持家数与电脑数',
    !v2.err && r.seatCap === 3 && r.aiCount === 1 && r.visibility === 'private');
}

clean();
{
  const r = M.createRoom(mk('host'), '', 'relaxed');
  M.joinRoom(r.id, mk('b'), '');
  M.joinRoom(r.id, mk('c'), '');
  /* 绕过 setRoomCfg 直接改内部字段，模拟异常路径：startGame 也不许 slice 丢人 */
  r.seatCap = 2; r.aiCount = M.AI_AUTO;
  const g = M.startGame(r.id, () => {}, () => {});
  ck('★ 异常路径下 startGame 拒绝而不是静默丢人', !!g.err, String(g.err));
}

clean();
{
  ck('★ normCfg 认识 AI_AUTO(-1) 哨兵（不误判成 0 家电脑）',
    M.normCfg({ seatCap: 4, aiCount: M.AI_AUTO }).aiCount === M.AI_AUTO);
  ck('★ normCfg 仍把非法值安全收敛', M.normCfg({ aiCount: 'abc' }).aiCount === 0,
    String(M.normCfg({ aiCount: 'abc' }).aiCount));
}

console.log('\n===== E 协议兼容与禁区 =====');
ck('新增 CS 常量存在且旧值不变',
  CS.SET_ROOM_CFG === 'cs:setRoomCfg' && CS.LIST_ROOMS === 'cs:listRooms' &&
  CS.CREATE_ROOM === 'cs:createRoom' && CS.ROLL === 'cs:roll' && CS.RESUME === 'cs:resume');
ck('新增 SC 常量存在且旧值不变',
  SC.ROOM_LIST === 'sc:roomList' && SC.ROOM === 'sc:room' && SC.STATE === 'sc:state');
const idxSrc = read('server/index.js'), netSrc = read('js/net.js'), onSrc = read('js/online.js');
ck('列表广播用 io.emit，未 join 大厅房间（不破坏 currentRoomId）',
  idxSrc.includes('io.emit(SC.ROOM_LIST') && !/__lobby__|socket\.join\(['"]lobby/.test(idxSrc));
ck('MATCH_ENABLED 默认关闭', /process\.env\.MATCH_ENABLED \|\| ''\)\.toLowerCase\(\) === 'true'/.test(idxSrc));
ck('health 返回 matchEnabled', idxSrc.includes('matchEnabled: MATCH_ENABLED'));
ck('net.js 对旧缓存 protocol.js 有字面量兜底', netSrc.includes("SC.ROOM_LIST || 'sc:roomList'"));
ck('邀请链接在 connectNet 成功后才发 JOIN_ROOM',
  onSrc.indexOf('invitePending = false;') > onSrc.indexOf('bindLobbyButtons();') &&
  onSrc.includes("sessionStorage.removeItem('cf_online_room')"));
const invLine = onSrc.split('\n').find(l => l.includes("'?room=' + encodeURIComponent(id)")) || '';
ck('邀请链接只带房间号，不带人数/AI/token',
  /encodeURIComponent\(id\)/.test(invLine) && !/seatCap|aiCount|token/.test(invLine), invLine.trim());
ck('一键加入复用现有 JOIN_ROOM', onSrc.includes("data-join-room") && onSrc.includes('CS.JOIN_ROOM'));

console.log(`\n========================================\n  房间匹配回归：${pass} 通过 / ${fail} 失败\n========================================`);
process.exit(fail ? 1 : 0);
