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
let stopCalls = 0;
const fakeGame = {
  CF: { TIMING: {} },
  Engine: { state: () => ({ players: [] }), resume: () => {} },
  setSpeed: () => {}, state: () => ({}),
  stop: () => { stopCalls++; }
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
ck('★ 第二部分默认可见：MATCH_ENABLED 默认开启、可用环境变量一键关闭',
  /process\.env\.MATCH_ENABLED \|\| 'true'\)\.toLowerCase\(\) !== 'false'/.test(idxSrc));
ck('health 返回 matchEnabled', idxSrc.includes('matchEnabled: MATCH_ENABLED'));
ck('net.js 对旧缓存 protocol.js 有字面量兜底', netSrc.includes("SC.ROOM_LIST || 'sc:roomList'"));
ck('邀请链接在 connectNet 成功后才发 JOIN_ROOM',
  onSrc.indexOf('invitePending = false;') > onSrc.indexOf('bindLobbyButtons();') &&
  onSrc.includes("sessionStorage.removeItem('cf_online_room')"));
const invLine = onSrc.split('\n').find(l => l.includes("'?room=' + encodeURIComponent(id)")) || '';
ck('邀请链接只带房间号，不带人数/AI/token',
  /encodeURIComponent\(id\)/.test(invLine) && !/seatCap|aiCount|token/.test(invLine), invLine.trim());
ck('一键加入复用现有 JOIN_ROOM', onSrc.includes("data-join-room") && onSrc.includes('CS.JOIN_ROOM'));

console.log('\n===== F 确认式放弃：掉线 ≠ 主动退出 =====');
clean();
{
  const r = M.createRoom(mk('host'), '', 'relaxed');
  M.joinRoom(r.id, mk('b'), '');
  M.startGame(r.id, () => {}, () => {});
  const seatB = r.seats.find(s => s.userId === 'b');
  M.leaveRoom(r.id, 'b');                       // 模拟 socket 掉线
  ck('★ 掉线只托管 AI、不打放弃标记', seatB.ai === true && !seatB.gaveUp,
    JSON.stringify({ ai: seatB.ai, gaveUp: !!seatB.gaveUp }));
  const back = M.resume(r.id, 'b');
  ck('★ 掉线重连 RESUME 能回到真人座位',
    !back.err && back.seatIndex === 1 && seatB.ai === false, String(back.err || 'ok'));
  const g = M.giveUp(r.id, 'b');
  ck('★ 确认放弃后标记 gaveUp、座位交给 AI',
    !g.err && seatB.gaveUp === true && seatB.ai === true, String(g.err || 'ok'));
  ck('★ 放弃不改家数 / 资产 / 胜负规则（seats 长度不变、旁人照常）',
    r.seats.length === 4 && r.seats.filter(s => s.ai).length === 3 && !M.resume(r.id, 'host').err,
    JSON.stringify(r.seats.map(s => s.name)));
  const denied = M.resume(r.id, 'b');
  ck('★ 确认放弃后 RESUME 被拒（本局无法再回座位）',
    !!denied.err && /已主动放弃/.test(denied.err), String(denied.err));
  ck('★ 重复放弃有明确提示', /已放弃本局/.test(String(M.giveUp(r.id, 'b').err || '')));
}
clean();
{
  const r = M.createRoom(mk('h'), '', 'relaxed');
  ck('★ 未开局不能点「放弃」', /尚未开始/.test(String(M.giveUp(r.id, 'h').err || '')));
}
const html = read('index.html');
ck('★ 确认式退出对话框存在且含「继续游戏 / 确定放弃」',
  html.includes('id="giveup-overlay"') && html.includes('id="giveup-cancel"') &&
  html.includes('id="giveup-confirm"') && html.includes('游戏正在进行中'));
ck('★ 对话框层级高于联机大厅（不会被盖住）', /#giveup-overlay\{z-index:110\}/.test(html));
ck('★ 用 DOM 对话框，不在对局中调用阻塞式 window.confirm',
  !/window\.confirm\(/.test(onSrc) && onSrc.includes("el('giveup-cancel')"));
ck('★ 局中「退出 / 退出游戏」用捕获阶段拦截（不改 render.js）',
  onSrc.includes("['btn-quit', 'btn-exit']") && onSrc.includes(', true);'));
const discSeg = idxSrc.slice(idxSrc.indexOf("socket.on('disconnect'"));
ck('★ 掉线路径绝不标记放弃（disconnect 段没有 giveUp）',
  discSeg.length > 0 && !/giveUp\(|GIVE_UP/.test(discSeg.slice(0, 400)));
ck('★ 放弃后 RESUME 报错会清掉本地房间号（不反复弹错）', netSrc.includes('已主动放弃'));
ck('★ 新协议常量与旧值共存', CS.GIVE_UP === 'cs:giveUp' && CS.RESUME === 'cs:resume');

console.log('\n===== G 房主退出：有真人则转让继续，无真人则终止 =====');
const grSrc = read('server/gameRunner.js');
clean();
{
  const r = M.createRoom(mk('host'), '', 'relaxed');
  M.joinRoom(r.id, mk('b'), '');
  M.startGame(r.id, () => {}, () => {});
  stopCalls = 0;
  const g = M.giveUp(r.id, 'host');
  ck('★ 房主放弃但还有真人：不终止，房主转让给下一位真人',
    !g.err && g.terminated === false && g.hostTransferred === true && r.hostId === 'b',
    JSON.stringify({ term: g.terminated, trans: g.hostTransferred, host: r.hostId }));
  ck('★ 对局继续：房间仍在、引擎未 stop、接任者可正常回座',
    M.rooms.has(r.id) && stopCalls === 0 && !M.resume(r.id, 'b').err,
    JSON.stringify({ inRooms: M.rooms.has(r.id), stops: stopCalls }));
  ck('★ 房主权限真的转移（对局中新房主可改速、旧房主被拒）',
    !M.setSpeed(r.id, 'b', 'slow').err && !!M.setSpeed(r.id, 'host', 'relaxed').err,
    'b=允许 / host=拒绝');
}
clean();
{
  const r = M.createRoom(mk('solo'), '', 'relaxed');
  M.startGame(r.id, () => {}, () => {});      // 1 真人 + 3 AI
  stopCalls = 0;
  const g = M.giveUp(r.id, 'solo');
  ck('★ 房主是唯一真人：终止整局、删除房间、真正停掉引擎',
    !g.err && g.terminated === true && !M.rooms.has(r.id) && stopCalls === 1,
    JSON.stringify({ term: g.terminated, inRooms: M.rooms.has(r.id), stops: stopCalls }));
}
clean();
{
  const r = M.createRoom(mk('host'), '', 'relaxed');
  M.joinRoom(r.id, mk('b'), '');
  M.startGame(r.id, () => {}, () => {});
  M.leaveRoom(r.id, 'b');                     // b 只是掉线，不算主动放弃
  const g = M.giveUp(r.id, 'host');
  ck('★ 掉线托管的真人仍算「在」：房主放弃后不终止、房主转给他',
    g.terminated === false && g.hostTransferred === true && r.hostId === 'b',
    JSON.stringify({ term: g.terminated, host: r.hostId }));
}
ck('★ gameRunner 提供 stop() 且清掉两个定时器槽、挡住残留广播',
  grSrc.includes('stop: () =>') && grSrc.includes('clearTimeout(Engine._timer)') &&
  grSrc.includes('clearTimeout(Engine._walkTimer)') && grSrc.includes('if (stopped) return;'));
ck('★ 终止局不发 GAME_OVER 结算、不记战绩',
  idxSrc.includes('if (r.terminated)') && idxSrc.includes('io.to(roomId).emit(SC.ROOM_ENDED') &&
  !/if \(r\.terminated\)[\s\S]{0,200}Stats\.record/.test(idxSrc));
ck('★ 客户端收到终止事件后清房间号、不回落本地引擎',
  netSrc.includes("SC.ROOM_ENDED || 'sc:roomEnded'") && netSrc.includes("saveRoom('')") &&
  !/roomEnded[\s\S]{0,300}onlineMode = false/.test(onSrc));
ck('★ 房主确认框会额外说明转让 / 终止规则',
  html.includes('id="giveup-host-hint"') && onSrc.includes('你是房主：房内还有其他真人时'));
ck('★ 新 SC 常量与旧值共存', SC.ROOM_ENDED === 'sc:roomEnded' && SC.GAME_OVER === 'sc:gameOver');

console.log('\n===== H 房间归属：一个 socket 只能属于一个房 =====');
ck('★ currentRoomId 只认仍存活的房间（终止后残留房号不串房）',
  /roomMgr\.rooms\.has\(r\)/.test(idxSrc));
ck('★ 建房前先退旧房（连续建两房不再把调速打到旧房）',
  /socket\.on\(CS\.CREATE_ROOM[\s\S]{0,180}leaveCurrentRoom\(socket\)/.test(idxSrc));
ck('★ 加房成功后才退旧房（输错房号不会把人踢出原房）',
  /if \(r\.err\) return socket\.emit\(SC\.ERROR, \{ msg: r\.err \}\);[\s\S]{0,220}leaveCurrentRoom\(socket, r\.room\.id\)/.test(idxSrc));
ck('★ 终止后清掉残留房间频道', idxSrc.includes('socketsLeave(roomId)'));
ck('★ 对局中禁止直接换房（避免绕过确认框把座位托给 AI）',
  /function inStartedRoom/.test(idxSrc) &&
  /CS\.CREATE_ROOM[\s\S]{0,220}inStartedRoom\(socket\)/.test(idxSrc) &&
  /CS\.JOIN_ROOM[\s\S]{0,300}inStartedRoom\(socket, target\)/.test(idxSrc));

console.log(`\n========================================\n  房间匹配回归：${pass} 通过 / ${fail} 失败\n========================================`);
process.exit(fail ? 1 : 0);
