/* ============================================================
 * db.js —— 存储层（双模式）
 *
 *   ① 配置了 DATABASE_URL → 使用 PostgreSQL（云上生产，数据持久）
 *   ② 未配置            → 退回 JSON 文件（本地开发零配置，开箱即跑）
 *
 * 两套 API 都是 async，调用方统一 await，切换存储不需要改业务代码。
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
      // 云数据库需要 SSL；本地/内网直连则关闭
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
const EMPTY = { users: [], stats: {} };
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function load() {
  ensureDir();
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return Object.assign({}, EMPTY); }
}
function save(db) {
  ensureDir();
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);   // 原子写，避免写一半损坏
}

/* ---------------- 行映射 ---------------- */
function rowToUser(r) {
  return r ? { id: r.id, username: r.username, passHash: r.pass_hash, createdAt: Number(r.created_at) } : null;
}
function rowToStats(r) {
  return r
    ? { games: Number(r.games), wins: Number(r.wins), bankrupt: Number(r.bankrupt), turnsSum: Number(r.turns_sum) }
    : { games: 0, wins: 0, bankrupt: 0, turnsSum: 0 };
}

/* ---------------- 初始化 ---------------- */
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
      wins      INTEGER NOT NULL DEFAULT 0,
      bankrupt  INTEGER NOT NULL DEFAULT 0,
      turns_sum BIGINT  NOT NULL DEFAULT 0
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
        'INSERT INTO users (id, username, pass_hash, created_at) VALUES ($1, $2, $3, $4)',
        [user.id, user.username, user.passHash, user.createdAt]
      );
      return user;
    }
    const db = load();
    db.users.push(user);
    save(db);
    return user;
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

  /** 一局结束后累计（原子 upsert，避免并发丢更新） */
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

module.exports = { Users, Stats, init, getMode: () => mode, usePostgres: USE_PG };
