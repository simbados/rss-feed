-- Initial schema. Times are unix epoch milliseconds.

CREATE TABLE topics (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  weight REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE feeds (
  id              INTEGER PRIMARY KEY,
  url             TEXT NOT NULL UNIQUE,
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
  enabled         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE articles (
  id           INTEGER PRIMARY KEY,
  feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid_hash    TEXT NOT NULL UNIQUE,
  url          TEXT NOT NULL DEFAULT '',
  title        TEXT NOT NULL DEFAULT '',
  snippet      TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,
  fetched_at   INTEGER NOT NULL,
  is_read      INTEGER NOT NULL DEFAULT 0,
  is_starred   INTEGER NOT NULL DEFAULT 0,
  is_hidden    INTEGER NOT NULL DEFAULT 0,
  score        REAL NOT NULL DEFAULT 0 -- reserved for weighting (post-MVP)
);

CREATE INDEX idx_articles_published ON articles(published_at DESC);
CREATE INDEX idx_articles_feed      ON articles(feed_id, published_at DESC);
CREATE INDEX idx_articles_score     ON articles(score DESC);
CREATE INDEX idx_feeds_due          ON feeds(enabled, next_fetch_at);

INSERT INTO topics (name) VALUES ('Security'), ('News'), ('Tech');
