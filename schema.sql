-- ============================================================
-- 股息流 · 数据库建表脚本（PostgreSQL / Supabase）
-- 服务端启动时会自动执行同样的建表语句，此文件用于手动初始化或审阅
-- ============================================================

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
