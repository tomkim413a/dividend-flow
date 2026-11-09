/* ============================================================
 * index.js —— 股息流联机服务端入口
 *   · Express：账号 API + 托管前端静态文件（前后端同源，免 CORS 麻烦）
 *   · Socket.IO：房间与对局的实时同步
 *
 * 本地：cd server && npm install && npm start
 * 云上：配置 DATABASE_URL / JWT_SECRET 后 npm start（见 DEPLOY.md）
 * ============================================================ */
'use strict';
require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const socketIo = require('socket.io');

const auth = require('./auth');
const roomMgr = require('./room');
const db = require('./db');
const mailer = require('./mailer');
const { CS, SC } = require('./protocol');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, {
  cors: { origin: CORS_ORIGIN },
  // 免费实例/移动网络下适当放宽
  pingTimeout: 25000,
  pingInterval: 20000
});

app.set('trust proxy', 1);               // Render / Nginx 反向代理后取真实 IP
app.use(express.json({ limit: '64kb' }));

/* 只对外提供前端资源。
   express.static(ROOT) 会把 server/db.js、tools/*.js、package.json、部署文档、
   .github/ 配置一并公开下载（实测 HTTP 200），属于不必要的信息泄露；
   万一以后把 .env 放进项目根目录也会直接暴露，因此先挡一道。 */
app.use((req, res, next) => {
  let p;
  try { p = decodeURIComponent(req.path); } catch (e) { return res.status(400).end(); }
  if (/(^|\/)\./.test(p) ||                                   // .git / .github / .env
      /^\/(server|tools|node_modules|build)(\/|$)/i.test(p) ||
      /\.(md|json|sql|ya?ml|log|env|example|bak)$/i.test(p) ||
      /^\/(serve|main)\.js$/i.test(p)) {
    return res.status(404).end('Not found');
  }
  next();
});

/* 托管前端（index.html / css / js / BGM / audio）
   音频加长缓存：首次加载后浏览器直接复用，避免跨境反复拉流导致 BGM 断断续续；
   页面与脚本保持 no-cache，保证更新即时生效。 */
app.use(express.static(ROOT, {
  index: 'index.html',
  setHeaders(res, filePath) {
    const p = String(filePath).replace(/\\/g, '/');
    if (/\/BGM\/|\/audio\//.test(p)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      // 线上音频此前 cf-cache-status: DYNAMIC（未命中 CDN 缓存，每个请求都回源 Render，
      // 跨境吞吐抖动导致 BGM 缓冲断续）。显式要求 CDN 缓存一年，让边缘节点直接回音频。
      res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));
app.get('/protocol.js', (req, res) => res.sendFile(path.join(__dirname, 'protocol.js')));

/* ---------------- 健康检查（Render 探活 / 保活 ping 用） ---------------- */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: db.getMode(), mailEnabled: auth.mailEnabled(), time: Date.now() });
  // 顺带保活 Gmail 凭据，避免半年无人找回密码导致 refresh_token 失效（不阻塞响应）
  mailer.keepAlive();
});

/* ---------------- 账号 API ---------------- */
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, secQ, secA } = req.body || {};
    const r = await auth.register(username, email, password, secQ, secA);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json({ ok: true, user: r.user });     // 不返回 token：注册后去登录
  } catch (e) {
    console.error('[register]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

/* 找回密码 · 通道二：密保问题（不依赖邮件，永远可用）
   第一步：拿问题；第二步：校验答案并重置 */
app.post('/api/recover/question', async (req, res) => {
  try {
    const { username } = req.body || {};
    const r = await auth.recoverQuestion(username);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json(r);
  } catch (e) {
    console.error('[recover-question]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

app.post('/api/recover/reset', async (req, res) => {
  try {
    const { username, answer, password } = req.body || {};
    const r = await auth.resetBySecurity(username, answer, password);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json(r);
  } catch (e) {
    console.error('[recover-reset]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

/* 已登录用户设置 / 修改密保问题（给老账号补票） */
app.post('/api/account/security', async (req, res) => {
  try {
    const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const p = auth.verify(t);
    if (!p) return res.status(401).json({ err: '登录已过期，请重新登录' });
    const { secQ, secA } = req.body || {};
    const r = await auth.setSecurity(p.id, secQ, secA);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json(r);
  } catch (e) {
    console.error('[account-security]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

/* 找回密码：发送重置邮件 */
app.post('/api/forgot', async (req, res) => {
  try {
    const { email, username } = req.body || {};
    const r = await auth.forgot(email, username);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json(r);
  } catch (e) {
    console.error('[forgot]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

/* 管理员手动重置（无邮件服务时的兜底）：请求头 x-admin-token 必须等于 ADMIN_TOKEN */
app.post('/api/admin/reset', async (req, res) => {
  const expect = String(process.env.ADMIN_TOKEN || '').trim();
  const got = String(req.headers['x-admin-token'] || (req.body && req.body.token) || '').trim();
  if (!expect) return res.status(503).json({ err: '未配置 ADMIN_TOKEN，管理员重置不可用' });
  if (got !== expect) return res.status(403).json({ err: '管理员令牌错误' });
  try {
    const { username, password } = req.body || {};
    const r = await auth.adminReset(username, password);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json(r);
  } catch (e) {
    console.error('[admin-reset]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

/* 邮件通道自检（需 ADMIN_TOKEN）：能直接看到当前用的是哪个后端、发件人是谁、
   以及真实报错，专治"日志写着 sent=true 但用户收不到"。带 to 参数会真的发一封测试信。 */
app.post('/api/mail/diag', async (req, res) => {
  const expect = String(process.env.ADMIN_TOKEN || '').trim();
  const got = String(req.headers['x-admin-token'] || (req.body && req.body.token) || '').trim();
  if (!expect) return res.status(503).json({ err: '未配置 ADMIN_TOKEN，自检不可用' });
  if (got !== expect) return res.status(403).json({ err: '管理员令牌错误' });

  const backend = mailer.backend();
  const out = { backend, from: mailer.fromAddress() || '(未设置)' };
  try {
    const st = await mailer.selfTest();
    out.credentials = st.ok ? 'ok' : ('失败：' + st.err);
    if (st.ok && st.err) out.note = st.err;

    const to = String((req.body && req.body.to) || '').trim();
    if (to) {
      const link = `${String(process.env.APP_URL || '').replace(/\/+$/, '')}/reset.html?token=diag`;
      const r = await mailer.sendMail(
        to,
        '股息流 · 邮件通道自检',
        `这是一封自检邮件。收到说明发信通道可用。\n重置链接示例：${link}`,
        `<p>这是一封<b>自检邮件</b>，收到说明发信通道可用。</p><p style="color:#888">重置链接示例：${link}</p>`
      );
      out.testTo = to;
      out.testSent = !!r.sent;
      if (r.err) out.testErr = r.err;
    }
    res.json(out);
  } catch (e) {
    console.error('[mail-diag]', e);
    res.status(500).json({ err: String(e && e.message || e) });
  }
});

/* 重置密码 */
app.post('/api/reset', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const r = await auth.reset(token, password);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json(r);
  } catch (e) {
    console.error('[reset]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const r = await auth.login(username, password);
    if (r.err) return res.status(400).json({ err: r.err });
    res.json(r);
  } catch (e) {
    console.error('[login]', e);
    res.status(500).json({ err: '服务器繁忙，请稍后重试' });
  }
});

app.get('/api/me', async (req, res) => {
  const t = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const p = auth.verify(t);
  if (!p) return res.status(401).json({ err: '未登录' });
  try {
    const u = await db.Users.findById(p.id);
    res.json({
      user: { id: p.id, username: p.name },
      hasSec: !!(u && u.secQ),
      stats: await db.Stats.get(p.id)
    });
  } catch (e) {
    console.error('[me]', e);
    res.json({
      user: { id: p.id, username: p.name }, hasSec: true,
      stats: { games: 0, wins: 0, bankrupt: 0, turnsSum: 0 }
    });
  }
});

/* ---------------- WebSocket 鉴权 ---------------- */
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const p = auth.verify(token);
  if (!p) return next(new Error('未登录或登录已过期'));
  socket.user = { id: p.id, username: p.name };
  next();
});

function roomInfo(room) {
  if (!room || !room.id) return null;
  return {
    id: room.id,
    hostId: room.hostId,
    started: !!room.started,
    speed: room.speed || roomMgr.DEFAULT_SPEED,   // 房间统一的 AI / 动画档位
    seats: room.seats.map(s => ({ userId: s.userId, name: s.name, ai: !!s.ai, prof: s.prof || '' }))
  };
}

/** 取该 socket 当前所在的房间号（socket.io 自身 id 要排除） */
function currentRoomId(socket) {
  for (const r of socket.rooms) if (r !== socket.id) return r;
  return null;
}

io.on('connection', socket => {
  /* 建房 */
  socket.on(CS.CREATE_ROOM, (data = {}) => {
    const room = roomMgr.createRoom(socket.user, data.prof, data.speed);
    socket.join(room.id);
    socket.emit(SC.ROOM, roomInfo(room));
  });

  /* 加房 */
  socket.on(CS.JOIN_ROOM, (data = {}) => {
    const r = roomMgr.joinRoom(data.roomId, socket.user, data.prof);
    if (r.err) return socket.emit(SC.ERROR, { msg: r.err });
    socket.join(r.room.id);
    io.to(r.room.id).emit(SC.ROOM, roomInfo(r.room));
  });

  /* 离房 */
  socket.on(CS.LEAVE_ROOM, () => {
    const roomId = currentRoomId(socket);
    if (!roomId) return;
    socket.leave(roomId);
    const room = roomMgr.leaveRoom(roomId, socket.user.id);
    if (room) io.to(roomId).emit(SC.ROOM, roomInfo(room));
  });

  /* 开局前修改职业 */
  socket.on(CS.SET_PROF, (d = {}) => {
    const roomId = currentRoomId(socket);
    if (!roomId) return;
    const room = roomMgr.setProf(roomId, socket.user.id, d.prof);
    if (room) io.to(roomId).emit(SC.ROOM, roomInfo(room));
  });

  /* 房间速度：开局前人人可设，对局中仅房主可改；服务端权威，改完广播给全房 */
  socket.on(CS.SET_SPEED, (d = {}) => {
    const roomId = currentRoomId(socket);
    if (!roomId) return socket.emit(SC.ERROR, { msg: '请先建房或加入房间' });
    const r = roomMgr.setSpeed(roomId, socket.user.id, d.speed);
    if (r.err) return socket.emit(SC.ERROR, { msg: r.err });
    io.to(roomId).emit(SC.ROOM, roomInfo(r.room));
  });

  /* 开局（仅房主） */
  socket.on(CS.START_GAME, () => {
    const roomId = currentRoomId(socket);
    const room = roomId && roomMgr.rooms.get(roomId);
    if (!room) return socket.emit(SC.ERROR, { msg: '不在房间内' });
    if (room.hostId !== socket.user.id) return socket.emit(SC.ERROR, { msg: '只有房主可以开局' });

    const r = roomMgr.startGame(
      roomId,
      state => io.to(roomId).emit(SC.STATE, state),
      state => {
        // 对局结束：广播结果 + 落战绩（异步，失败不影响对局结束）
        io.to(roomId).emit(SC.GAME_OVER, { winner: state.winner ? state.winner.name : null });
        room.seats.forEach(s => {
          if (!s.userId) return;                       // AI 不记战绩
          const p = (state.players || []).find(x => x.name === s.name);
          if (!p) return;
          db.Stats.record(s.userId, { won: !!p.won, dead: !!p.dead, turn: state.turn || 0 })
            .catch(e => console.error('[stats]', e.message));
        });
      }
    );
    if (r.err) return socket.emit(SC.ERROR, { msg: r.err });
    io.to(roomId).emit(SC.ROOM, roomInfo(r.room));
    io.to(roomId).emit(SC.STATE, r.room.game.state());
  });

  /* 断线重连：回到原座位并取消 AI 托管 */
  socket.on(CS.RESUME, (d = {}) => {
    const r = roomMgr.resume(d.roomId, socket.user.id);
    if (r.err) return socket.emit(SC.ERROR, { msg: r.err });
    socket.join(r.room.id);
    io.to(r.room.id).emit(SC.ROOM, roomInfo(r.room));
    if (r.room.game) socket.emit(SC.STATE, r.room.game.state());
  });

  /* 玩家动作 → 交给权威引擎（带合法性校验） */
  const withGame = fn => {
    const roomId = currentRoomId(socket);
    const room = roomId && roomMgr.rooms.get(roomId);
    if (!room || !room.game) return socket.emit(SC.ERROR, { msg: '不在对局中' });

    const idx = room.seats.findIndex(s => s.userId === socket.user.id);
    if (idx < 0) return socket.emit(SC.ERROR, { msg: '你不在本局座位中' });

    // 防替操作：必须轮到该玩家才能行动
    const S = room.game.Engine.state();
    if (S && S.cur !== idx) return socket.emit(SC.ERROR, { msg: '还没轮到你行动' });

    try { fn(room); }
    catch (e) { socket.emit(SC.ERROR, { msg: '操作失败：' + (e && e.message) }); }
  };

  socket.on(CS.ROLL, () => withGame(room => room.game.Engine.act.roll()));
  socket.on(CS.CHOOSE, (d = {}) => withGame(room => room.game.Engine.act.choose(d.choice, d.payload)));
  socket.on(CS.SELL, (d = {}) => withGame(room => room.game.Engine.act.sellStock(d.sym, d.shares)));
  socket.on(CS.PAY_DEBT, (d = {}) => withGame(room => room.game.Engine.act.payDebt(d.amount)));

  /* 断线：对局中自动托管给 AI */
  socket.on('disconnect', () => {
    const roomId = currentRoomId(socket);
    if (!roomId) return;
    const room = roomMgr.leaveRoom(roomId, socket.user.id);
    if (room) io.to(roomId).emit(SC.ROOM, roomInfo(room));
  });
});

/* ---------------- 启动（先初始化存储，再监听） ---------------- */
(async () => {
  const info = await db.init();
  console.log(`[db] mode = ${info.mode}`);
  if (!process.env.APP_URL) {
    console.warn('[mail] 未配置 APP_URL：重置密码邮件里的链接会是相对路径（仅本地可用）。上线请配置为站点地址。');
  }
  const mailBackend = mailer.backend();
  if (mailBackend === 'none') {
    console.warn('[mail] 未配置邮件服务：找回密码不会发信，用户仍可用「密保问题」自助重置。');
  } else {
    console.log(`[mail] 邮件服务：${mailBackend}，发件人=${mailer.fromAddress() || '(未设置)'}`);
    if (mailBackend === 'smtp') {
      console.warn('[mail] 注意：云服务器（Render 等）常屏蔽 SMTP 端口，若发信超时请改用 GMAIL_*。');
    }
    if (mailBackend === 'gmail' && mailer.fromAddress() !== String(process.env.GMAIL_USER || '').trim()) {
      console.warn('[mail] 提醒：发件人应等于 GMAIL_USER（授权账号），否则 Google 会拒发。');
    }
    // 真的去验证一次凭据，避免"看着配好了、实际每次发信都失败"
    mailer.selfTest().then(st => {
      if (st.ok) console.log(`[mail] 通道自检通过（${st.backend}）`);
      else console.error(`[mail] 通道自检失败：${st.err}`);
    });
  }
  server.listen(PORT, () => {
    console.log(`股息流 · 联机服务端已启动： http://localhost:${PORT}  (db=${info.mode})`);
  });
})().catch(e => {
  console.error('启动失败：', e);
  process.exit(1);
});
