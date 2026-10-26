-- Shared pins, text and shapes. Deleted ones are kept for 30 days so they can be put back.
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_rev ON items (rev);
-- Small shared values; "live" holds the latest who-is-online / where-players-are data, sent by the live check.
CREATE TABLE IF NOT EXISTS kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  at INTEGER NOT NULL
);
-- Wrong passphrases per address, to slow down guessing.
CREATE TABLE IF NOT EXISTS fails (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  since INTEGER NOT NULL
);
