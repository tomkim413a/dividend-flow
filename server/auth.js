/* ============================================================
 * auth.js —— 账号注册 / 登录 / JWT 校验
 * 密码用 bcryptjs 哈希存储（纯 JS，无需原生编译）
 * 注意：存储层已改为 async（本地 JSON / 云 Postgres 双模式），因此这里也是 async
 * ============================================================ */
'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Users } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dividend-flow-dev-secret-change-me';

function publicUser(u) { return { id: u.id, username: u.username }; }

function sign(u) {
  return jwt.sign({ id: u.id, name: u.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verify(token) {
  try { return jwt.verify(token, JWT_SECRET); } catch (e) { return null; }
}

async function register(username, password) {
  username = String(username || '').trim();
  password = String(password || '');
  if (!username || !password) return { err: '用户名和密码不能为空' };
  if (username.length > 16) return { err: '用户名最长 16 个字符' };
  if (password.length < 4) return { err: '密码至少 4 位' };
  if (await Users.findByName(username)) return { err: '用户名已被占用' };

  const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const user = { id, username, passHash: bcrypt.hashSync(password, 8), createdAt: Date.now() };
  await Users.add(user);
  return { user: publicUser(user), token: sign(user) };
}

async function login(username, password) {
  username = String(username || '').trim();
  const u = await Users.findByName(username);
  if (!u) return { err: '用户不存在' };
  if (!bcrypt.compareSync(String(password || ''), u.passHash)) return { err: '密码错误' };
  return { user: publicUser(u), token: sign(u) };
}

module.exports = { register, login, verify, publicUser };
