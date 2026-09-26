-- Initial schema (multi-user). Times are unix epoch milliseconds.
-- Replaces the single-user migrations 0001–0003 (2026-09-26): the database was emptied and rebuilt.
-- Every user's data hangs off users(id): deleting a user deletes everything of theirs.

-- One row per person, created on their first login. The email comes from the verified Access token.
CREATE TABLE users (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE topics (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name    TEXT NOT NULL COLLATE NOCASE,
  weight  REAL NOT NULL DEFAULT 1.0,
  UNIQUE (user_id, name)
);

-- The same feed URL followed by two users is two rows (fetched separately; nothing is shared).
CREATE TABLE feeds (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  site_url        TEXT NOT NULL DEFAULT '',
  topic_id        INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  weight          REAL NOT NULL DEFAULT 1.0,
  etag            TEXT,
  last_modified   TEXT,
  last_fetched_at INTEGER,
  next_fetch_at   INTEGER,
  last_error      TEXT,
  error_count     INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  -- How a feed notifies: 'daily' (evening summary) for now; 'off', 'instant', 'weekly' later.
  notify          TEXT NOT NULL DEFAULT 'daily',
  UNIQUE (user_id, url)
);

-- Owned through feeds.user_id. GUIDs are unique per feed, so one feed can't crowd out another's items.
CREATE TABLE articles (
  id           INTEGER PRIMARY KEY,
  feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid_hash    TEXT NOT NULL,
  url          TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  snippet      TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  -- Image URL (media:thumbnail, image enclosure or first <img>); served through the /img/<id> proxy.
  image_url    TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL,
  is_read      INTEGER NOT NULL DEFAULT 0,
  is_starred   INTEGER NOT NULL DEFAULT 0,
  is_hidden    INTEGER NOT NULL DEFAULT 0,
  score        REAL NOT NULL DEFAULT 0, -- reserved for weighting (post-MVP)
  UNIQUE (feed_id, guid_hash)
);

-- Web Push: one row per subscribed device. An endpoint belongs to one user at a time.
CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  last_error  TEXT NOT NULL DEFAULT ''
);

-- Small key/value store for job bookkeeping; per-user keys look like "digest_date:<userId>".
CREATE TABLE app_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE INDEX idx_articles_published ON articles(published_at DESC);
CREATE INDEX idx_articles_feed      ON articles(feed_id, published_at DESC);
CREATE INDEX idx_articles_fetched   ON articles(fetched_at);
CREATE INDEX idx_articles_score     ON articles(score DESC);
CREATE INDEX idx_feeds_due          ON feeds(enabled, next_fetch_at);
CREATE INDEX idx_feeds_user         ON feeds(user_id);
CREATE INDEX idx_topics_user        ON topics(user_id);
CREATE INDEX idx_push_user          ON push_subscriptions(user_id);
