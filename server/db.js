/* ============================================================
 * db.js —— 存储层（双模式）
 *
 *   ① 配置了 DATABASE_URL → PostgreSQL（云上生产，数据持久）
 *   ② 未配置            → JSON 文件（本地开发零配置，开箱即跑）
 *
 * 表：
 *   users          账号（含邮箱与密保问题，用于找回密码）
 *   stats          战绩
 *   password_resets 重置令牌（一次性、30 分钟过期）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'db.json');

const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const USE_PG = !!DATABASE_URL;

let pool = null;
let mode = USE_PG ? 'postgres' : 'json';

function getPool() {
  if (!pool) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    pool.on('error', e => console.error('[db] idle client error:', e.message));
  }
  return pool;
}

/* ---------------- JSON 兜底 ---------------- */
const EMPTY = { users: [], stats: {}, resets: {} };
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function load() {
  ensureDir();
  try {
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    d.users = d.users || [];
    d.stats = d.stats || {};
    d.resets = d.resets || {};
    return d;
  } catch (e) { return Object.assign({}, EMPTY); }
}
function save(db) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

/* ---------------- 行映射 ---------------- */
function rowToUser(r) {
  return r ? {
    id: r.id, username: r.username, email: r.email || '',
    secQ: r.sec_q || '', secAHash: r.sec_a || '',
    passHash: r.pass_hash, createdAt: Number(r.created_at)
  } : null;
}
function rowToStats(r) {
  return r
    ? { games: Number(r.games), wins: Number(r.wins), bankrupt: Number(r.bankrupt), turnsSum: Number(r.turns_sum) }
    : { games: 0, wins: 0, bankrupt: 0, turnsSum: 0 };
}

/* ---------------- 初始化 / 迁移 ---------------- */
async function init() {
  if (!USE_PG) {
    ensureDir();
    mode = 'json';
    return { mode };
  }
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      pass_hash  TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stats (
      user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      games     INTEGER NOT NULL DEFAULT 0,
      wins     INTEGER NOT NULL DEFAULT 0,
      bankrupt  INTEGER NOT NULL DEFAULT 0,
      turns_sum BIGINT  NOT NULL DEFAULT 0
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email) WHERE email IS NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS sec_q TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS sec_a TEXT;
    CREATE TABLE IF NOT EXISTS password_resets (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      used       BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  mode = 'postgres';
  return { mode };
}

/* ---------------- 用户 ---------------- */
const Users = {
  async all() {
    if (USE_PG) {
      const r = await getPool().query('SELECT * FROM users ORDER BY created_at ASC');
      return r.rows.map(rowToUser);
    }
    return load().users;
  },

  async findByName(name) {
    if (USE_PG) {
      const r = await getPool().query('SELECT * FROM users WHERE username = $1 LIMIT 1', [String(name)]);
      return rowToUser(r.rows[0]);
    }
    return load().users.find(u => u.username === name) || null;
  },

  async findByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    if (USE_PG) {
      const r = await getPool().query('SELECT * FROM users WHERE lower(email) = $1 LIMIT 1', [e]);
      return rowToUser(r.rows[0]);
    }
    return load().users.find(u => String(u.email || '').toLowerCase() === e) || null;
  },

  async findById(id) {
    if (USE_PG) {
      const r = await getPool().query('SELECT * FROM users WHERE id = $1 LIMIT 1', [String(id)]);
      return rowToUser(r.rows[0]);
    }
    return load().users.find(u => u.id === id) || null;
  },

  async add(user) {
    if (USE_PG) {
      await getPool().query(
        'INSERT INTO users (id, username, email, pass_hash, created_at, sec_q, sec_a) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [user.id, user.username, user.email || null, user.passHash, user.createdAt,
          user.secQ || null, user.secAHash || null]
      );
      return user;
    }
    const db = load();
    db.users.push(user);
    save(db);
    return user;
  },

  async setSecurity(userId, secQ, secAHash) {
    if (USE_PG) {
      await getPool().query('UPDATE users SET sec_q = $1, sec_a = $2 WHERE id = $3',
        [String(secQ), String(secAHash), String(userId)]);
      return true;
    }
    const db = load();
    const u = db.users.find(x => x.id === userId);
    if (!u) return false;
    u.secQ = secQ;
    u.secAHash = secAHash;
    save(db);
    return true;
  },

  async updatePassword(userId, passHash) {
    if (USE_PG) {
      await getPool().query('UPDATE users SET pass_hash = $1 WHERE id = $2', [passHash, String(userId)]);
      return true;
    }
    const db = load();
    const u = db.users.find(x => x.id === userId);
    if (!u) return false;
    u.passHash = passHash;
    save(db);
    return true;
  }
};

/* ---------------- 重置令牌 ---------------- */
const Resets = {
  async create(token, userId, expiresAt) {
    if (USE_PG) {
      await getPool().query(
        'INSERT INTO password_resets (token, user_id, expires_at, used) VALUES ($1, $2, $3, FALSE)',
        [token, String(userId), expiresAt]
      );
      return;
    }
    const db = load();
    db.resets[token] = { userId, expiresAt, used: false };
    save(db);
  },

  async find(token) {
    if (USE_PG) {
      const r = await getPool().query('SELECT * FROM password_resets WHERE token = $1 LIMIT 1', [String(token)]);
      const row = r.rows[0];
      return row ? { userId: row.user_id, expiresAt: Number(row.expires_at), used: !!row.used } : null;
    }
    const r = load().resets[token];
    return r ? { userId: r.userId, expiresAt: Number(r.expiresAt), used: !!r.used } : null;
  },

  async markUsed(token) {
    if (USE_PG) {
      await getPool().query('UPDATE password_resets SET used = TRUE WHERE token = $1', [String(token)]);
      return;
    }
    const db = load();
    if (db.resets[token]) { db.resets[token].used = true; save(db); }
  }
};

/* ---------------- 战绩 ---------------- */
const Stats = {
  async get(userId) {
    if (USE_PG) {
      const r = await getPool().query('SELECT * FROM stats WHERE user_id = $1 LIMIT 1', [String(userId)]);
      return rowToStats(r.rows[0]);
    }
    return load().stats[userId] || { games: 0, wins: 0, bankrupt: 0, turnsSum: 0 };
  },

  async record(userId, { won, dead, turn } = {}) {
    const w = won ? 1 : 0, d = dead ? 1 : 0, t = Number(turn) || 0;

    if (USE_PG) {
      const r = await getPool().query(`
        INSERT INTO stats (user_id, games, wins, bankrupt, turns_sum)
        VALUES ($1, 1, $2, $3, $4)
        ON CONFLICT (user_id) DO UPDATE SET
          games     = stats.games + 1,
          wins      = stats.wins + $2,
          bankrupt  = stats.bankrupt + $3,
          turns_sum = stats.turns_sum + $4
        RETURNING *
      `, [String(userId), w, d, t]);
      return rowToStats(r.rows[0]);
    }

    const db = load();
    const s = db.stats[userId] || { games: 0, wins: 0, bankrupt: 0, turnsSum: 0 };
    s.games += 1;
    if (won) s.wins += 1;
    if (dead) s.bankrupt += 1;
    s.turnsSum += t;
    db.stats[userId] = s;
    save(db);
    return s;
  }
};

module.exports = { Users, Stats, Resets, init, getMode: () => mode, usePostgres: USE_PG };
