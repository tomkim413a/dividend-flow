/* ============================================================
 * auth.js —— 账号：注册 / 登录 / 找回密码 / JWT
 *
 * 找回密码两条通道：
 *   ① 邮件重置链接（需要能发信的邮件通道，见 mailer.js）
 *   ② 密保问题自助重置（不依赖任何第三方，注册时必填，兜底）
 *
 * 密码用 bcryptjs 哈希（纯 JS，无需原生编译）
 * ============================================================ */
'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Users, Resets } = require('./db');
const mailer = require('./mailer');

const JWT_SECRET = process.env.JWT_SECRET || 'dividend-flow-dev-secret-change-me';
const APP_URL = String(process.env.APP_URL || '').replace(/\/+$/, '');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESET_TTL = 30 * 60 * 1000;      // 重置链接 30 分钟有效

/* 密保答案防爆破：同一用户名 10 分钟内最多错 5 次 */
const SEC_MAX_FAIL = 5;
const SEC_WINDOW = 10 * 60 * 1000;
const secFails = new Map();            // username -> { n, until }

function normalizeAnswer(a) {
  // 去掉首尾空白、全部空格与常见全角空格，统一小写：降低"明明答对了却过不了"的概率
  return String(a || '').trim().toLowerCase().replace(/[\s\u3000]+/g, '');
}
function secLocked(username) {
  const r = secFails.get(username);
  if (!r) return false;
  if (Date.now() > r.until) { secFails.delete(username); return false; }
  return r.n >= SEC_MAX_FAIL;
}
function secFail(username) {
  const now = Date.now();
  const r = secFails.get(username);
  if (!r || now > r.until) secFails.set(username, { n: 1, until: now + SEC_WINDOW });
  else r.n += 1;
}

function publicUser(u) { return { id: u.id, username: u.username }; }
function sign(u) {
  return jwt.sign({ id: u.id, name: u.username }, JWT_SECRET, { expiresIn: '30d' });
}
function verify(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

/**
 * 注册：需要用户名 + 邮箱 + 密码 + 密保问题/答案
 * 注册成功【不自动登录】（前端会跳回登录页），因此不返回 token
 */
async function register(username, email, password, secQ, secA) {
  username = String(username || '').trim();
  email = String(email || '').trim();
  password = String(password || '');
  secQ = String(secQ || '').trim();
  const secAns = normalizeAnswer(secA);

  if (!username || !password) return { err: '用户名和密码不能为空' };
  if (username.length > 16) return { err: '用户名最长 16 个字符' };
  if (password.length < 4) return { err: '密码至少 4 位' };
  if (!EMAIL_RE.test(email)) return { err: '请输入正确的邮箱地址' };
  if (secQ.length < 2) return { err: '请填写密保问题（忘记密码时靠它重置）' };
  if (secQ.length > 40) return { err: '密保问题最长 40 个字符' };
  if (secAns.length < 2) return { err: '请填写密保答案（至少 2 个字符）' };
  if (secAns.length > 40) return { err: '密保答案最长 40 个字符' };

  if (await Users.findByName(username)) return { err: '用户名已被占用' };
  if (await Users.findByEmail(email)) return { err: '该邮箱已被注册' };

  const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const user = {
    id, username, email,
    secQ, secAHash: bcrypt.hashSync(secAns, 8),
    passHash: bcrypt.hashSync(password, 8),
    createdAt: Date.now()
  };
  await Users.add(user);
  return { ok: true, user: publicUser(user) };
}

async function login(username, password) {
  username = String(username || '').trim();
  const u = await Users.findByName(username);
  if (!u) return { err: '用户不存在' };
  if (!bcrypt.compareSync(String(password || ''), u.passHash)) return { err: '密码错误' };
  return { user: publicUser(u), token: sign(u) };
}

/**
 * 找回密码：发重置邮件
 * 可选传 username 做双重校验（用户名 + 邮箱必须匹配），定位更准；
 * 不传则只按邮箱查。
 * 无论账号是否存在都返回 ok（避免被用来探测注册情况），但服务端日志会写清原因。
 */
async function forgot(email, username) {
  email = String(email || '').trim();
  username = String(username || '').trim();
  if (!EMAIL_RE.test(email)) return { err: '请输入正确的邮箱地址' };

  let u = null;
  if (username) {
    const byName = await Users.findByName(username);
    if (byName && String(byName.email || '').toLowerCase() === email.toLowerCase()) {
      u = byName;
    } else {
      console.log(`[forgot] 用户名与邮箱不匹配：user=${username} email=${email}` +
        (byName ? `（该用户登记的邮箱是 ${byName.email || '(空)'}）` : '（用户不存在）'));
    }
  } else {
    u = await Users.findByEmail(email);
  }

  if (!u) {
    console.log(`[forgot] 未找到可用账号：email=${email} user=${username || '-'}（按防枚举策略仍返回 ok，不发信）`);
    return { ok: true };
  }
  if (!u.email) {
    console.log(`[forgot] 该账号注册时没有邮箱（老账号）：user=${u.username}，无法发信`);
    return { ok: true };
  }

  const token = crypto.randomBytes(24).toString('hex');
  await Resets.create(token, u.id, Date.now() + RESET_TTL);

  const link = `${APP_URL}/reset.html?token=${token}`;
  const r = await mailer.sendResetMail(u.email, link);
  console.log(`[forgot] 已处理：user=${u.username} email=${u.email} smtp=${mailer.ready() ? 'on' : 'off'} sent=${!!r.sent}`);

  // 未配置 SMTP（本地/测试）→ 把链接一并返回，方便自测
  if (!mailer.ready()) return { ok: true, devLink: link, warn: '邮件服务未配置，已把重置链接输出到服务端日志' };
  if (!r.sent) return { ok: true, warn: '邮件发送失败：' + (r.err || '请检查 SMTP 配置') };
  return { ok: true };
}

/** 用令牌重置密码（一次性，30 分钟过期） */
async function reset(token, password) {
  token = String(token || '').trim();
  password = String(password || '');
  if (!token) return { err: '链接无效' };
  if (password.length < 4) return { err: '新密码至少 4 位' };

  const r = await Resets.find(token);
  if (!r || r.used) return { err: '链接无效或已被使用，请重新申请' };
  if (Date.now() > r.expiresAt) return { err: '链接已过期（30 分钟），请重新申请' };

  const u = await Users.findById(r.userId);
  if (!u) return { err: '账号不存在' };

  await Users.updatePassword(u.id, bcrypt.hashSync(password, 8));
  await Resets.markUsed(token);
  return { ok: true };
}

/**
 * 通道二：密保问题自助重置（不依赖邮件，永远可用）
 *   第一步 recoverQuestion(username) → 返回该账号的密保问题
 *   第二步 resetBySecurity(username, answer, newPassword)
 */
async function recoverQuestion(username) {
  username = String(username || '').trim();
  if (!username) return { err: '请填写用户名' };
  const u = await Users.findByName(username);
  if (!u) return { err: '账号不存在，请检查用户名' };
  if (!u.secQ || !u.secAHash) {
    return { err: '该账号注册时没有设置密保问题（老账号），请改用邮箱重置或联系管理员' };
  }
  return { ok: true, q: u.secQ };
}

async function resetBySecurity(username, answer, password) {
  username = String(username || '').trim();
  password = String(password || '');
  const ans = normalizeAnswer(answer);

  if (!username) return { err: '请填写用户名' };
  if (!ans) return { err: '请填写密保答案' };
  if (password.length < 4) return { err: '新密码至少 4 位' };
  if (secLocked(username)) return { err: '密保答案错误次数过多，请 10 分钟后再试' };

  const u = await Users.findByName(username);
  if (!u || !u.secAHash) return { err: '账号不存在或未设置密保问题' };
  if (!bcrypt.compareSync(ans, u.secAHash)) {
    secFail(username);
    console.log(`[recover] 密保答案错误：user=${username}`);
    return { err: '密保答案不正确' };
  }

  secFails.delete(username);
  await Users.updatePassword(u.id, bcrypt.hashSync(password, 8));
  console.log(`[recover] 已通过密保问题重置密码：user=${u.username} (${u.id})`);
  return { ok: true, username: u.username };
}

/** 已登录用户设置 / 修改密保问题（给邮箱功能上线前注册的老账号补上） */
async function setSecurity(userId, secQ, secA) {
  secQ = String(secQ || '').trim();
  const ans = normalizeAnswer(secA);
  if (secQ.length < 2) return { err: '请填写密保问题' };
  if (secQ.length > 40) return { err: '密保问题最长 40 个字符' };
  if (ans.length < 2) return { err: '请填写密保答案（至少 2 个字符）' };
  if (ans.length > 40) return { err: '密保答案最长 40 个字符' };
  const u = await Users.findById(userId);
  if (!u) return { err: '账号不存在' };
  await Users.setSecurity(u.id, secQ, bcrypt.hashSync(ans, 8));
  console.log(`[recover] 已设置密保问题：user=${u.username}`);
  return { ok: true };
}

/**
 * 管理员手动重置密码（无邮件服务时的兜底方案）
 * 需要环境变量 ADMIN_TOKEN，调用时用请求头 x-admin-token 校验
 */
async function adminReset(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!username) return { err: '请提供用户名' };
  if (password.length < 4) return { err: '新密码至少 4 位' };
  const u = await Users.findByName(username);
  if (!u) return { err: '用户不存在' };
  await Users.updatePassword(u.id, bcrypt.hashSync(password, 8));
  console.log(`[admin] 已重置密码：user=${u.username} (${u.id})`);
  return { ok: true, username: u.username };
}

module.exports = {
  register, login, forgot, reset,
  recoverQuestion, resetBySecurity, setSecurity,
  adminReset, verify, publicUser
};
