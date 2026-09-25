-- Web Push: one row per subscribed device (endpoint at the push service + encryption keys).
CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_error  TEXT NOT NULL DEFAULT ''
);

-- Small key/value store for job bookkeeping, e.g. the date of the last daily summary.
CREATE TABLE app_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- How a feed notifies: 'daily' (evening summary) for now; 'off', 'instant', 'weekly' later.
ALTER TABLE feeds ADD COLUMN notify TEXT NOT NULL DEFAULT 'daily';
