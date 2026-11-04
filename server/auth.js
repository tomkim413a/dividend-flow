/* ============================================================
 * auth.js —— 账号：注册 / 登录 / 找回密码（邮件重置）/ JWT
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

function publicUser(u) { return { id: u.id, username: u.username }; }
function sign(u) {
  return jwt.sign({ id: u.id, name: u.username }, JWT_SECRET, { expiresIn: '30d' });
}
function verify(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

/**
 * 注册：需要用户名 + 邮箱 + 密码
 * 注册成功【不自动登录】（前端会跳回登录页），因此不返回 token
 */
async function register(username, email, password) {
  username = String(username || '').trim();
  email = String(email || '').trim();
  password = String(password || '');

  if (!username || !password) return { err: '用户名和密码不能为空' };
  if (username.length > 16) return { err: '用户名最长 16 个字符' };
  if (password.length < 4) return { err: '密码至少 4 位' };
  if (!EMAIL_RE.test(email)) return { err: '请输入正确的邮箱地址' };

  if (await Users.findByName(username)) return { err: '用户名已被占用' };
  if (await Users.findByEmail(email)) return { err: '该邮箱已被注册' };

  const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const user = {
    id, username, email,
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

module.exports = { register, login, forgot, reset, verify, publicUser };
