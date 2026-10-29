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
-- Write links the owner made, one per person. Deleting a row stops that link.
CREATE TABLE IF NOT EXISTS writers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  used INTEGER
);
-- Microsoft sign-ins in progress: the PKCE secret this site keeps until the sign-in comes back (15 minutes at most).
CREATE TABLE IF NOT EXISTS ms_sessions (
  id TEXT PRIMARY KEY,
  verifier TEXT NOT NULL,
  created INTEGER NOT NULL
);
-- Signed in with Microsoft: one row per device (the cookie's value is kept only as a hash).
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  xid TEXT NOT NULL,
  name TEXT NOT NULL,
  created INTEGER NOT NULL,
  seen INTEGER
);
-- Which members the site's owner lets write (members not listed only look).
CREATE TABLE IF NOT EXISTS access (
  xid TEXT PRIMARY KEY,
  write INTEGER NOT NULL DEFAULT 0,
  updated INTEGER
);
