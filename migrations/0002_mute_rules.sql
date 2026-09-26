-- Mute rules: hide recurring noise ("tagesschau in 100 Sekunden") in future and existing articles.
-- Additive only: old code ignores the new table and column; muted articles use is_hidden = 1, which
-- every existing query already filters out.

CREATE TABLE mute_rules (
  -- AUTOINCREMENT: a deleted rule's id is never given to a new rule (articles.muted_by points at it).
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL = all feeds of the user.
  feed_id     INTEGER REFERENCES feeds(id) ON DELETE CASCADE,
  field       TEXT NOT NULL CHECK (field IN ('title', 'url')),
  -- Normalised (lower case, single spaces); matched as a plain substring, never as regex or LIKE.
  pattern     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
-- Also serves the lookup by user_id (leading column).
CREATE UNIQUE INDEX idx_mute_rules_unique ON mute_rules(user_id, IFNULL(feed_id, 0), field, pattern);

-- The rule that hid an article (NULL for visible and manually hidden articles).
ALTER TABLE articles ADD COLUMN muted_by INTEGER REFERENCES mute_rules(id) ON DELETE SET NULL;
CREATE INDEX idx_articles_muted ON articles(muted_by) WHERE muted_by IS NOT NULL;
