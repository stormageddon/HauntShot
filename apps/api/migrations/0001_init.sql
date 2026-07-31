-- HauntShot D1 schema (portable SQL — promote to Postgres later with same tables)

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid')),
  user_id TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'paid'))
);

CREATE TABLE IF NOT EXISTS shots (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  user_id TEXT,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE INDEX IF NOT EXISTS idx_shots_device_live
  ON shots (device_id, expires_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_shots_expires
  ON shots (expires_at)
  WHERE deleted_at IS NULL;
