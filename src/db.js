// @ts-check
// All SQL lives here. `db` is a D1Database binding.

export const PAGE_SIZE = 50;
export const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * @typedef {{ topic?: number|null, feed?: number|null, filter: 'unread'|'all'|'starred', page: number }} ArticleQuery
 */

/** @param {ArticleQuery} q */
function articleWhere(q) {
  const where = ['a.is_hidden = 0'];
  /** @type {unknown[]} */
  const params = [];
  if (q.topic) {
    where.push('f.topic_id = ?');
    params.push(q.topic);
  }
  if (q.feed) {
    where.push('a.feed_id = ?');
    params.push(q.feed);
  }
  if (q.filter === 'unread') where.push('a.is_read = 0');
  if (q.filter === 'starred') where.push('a.is_starred = 1');
  return { sql: where.join(' AND '), params };
}

/** @param {any} db @param {ArticleQuery} q */
export async function listArticles(db, q) {
  const w = articleWhere(q);
  const { results } = await db
    .prepare(
      `SELECT a.id, a.url, a.title, a.snippet, a.author, a.published_at, a.is_read, a.is_starred,
              f.id AS feed_id, f.title AS feed_title, t.id AS topic_id, t.name AS topic_name
         FROM articles a
         JOIN feeds f ON f.id = a.feed_id
         LEFT JOIN topics t ON t.id = f.topic_id
        WHERE ${w.sql}
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT ? OFFSET ?`
    )
    .bind(...w.params, PAGE_SIZE + 1, q.page * PAGE_SIZE)
    .all();
  return { articles: results.slice(0, PAGE_SIZE), hasMore: results.length > PAGE_SIZE };
}

/** @param {any} db @param {ArticleQuery} q */
export async function markAllRead(db, q) {
  const w = articleWhere({ ...q, filter: 'unread' });
  await db
    .prepare(
      `UPDATE articles SET is_read = 1 WHERE id IN (
         SELECT a.id FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE ${w.sql})`
    )
    .bind(...w.params)
    .run();
}

const ARTICLE_ACTIONS = {
  read: 'is_read = 1',
  unread: 'is_read = 0',
  star: 'is_starred = 1',
  unstar: 'is_starred = 0',
  hide: 'is_hidden = 1, is_read = 1',
};

/** @param {string} action */
export function isArticleAction(action) {
  return Object.hasOwn(ARTICLE_ACTIONS, action);
}

/** @param {any} db @param {number} id @param {string} action */
export async function updateArticle(db, id, action) {
  const set = ARTICLE_ACTIONS[/** @type {keyof ARTICLE_ACTIONS} */ (action)];
  return db
    .prepare(`UPDATE articles SET ${set} WHERE id = ? RETURNING id, is_read, is_starred, is_hidden`)
    .bind(id)
    .first();
}

/** Topics with unread counts, plus the overall unread total. @param {any} db */
export async function topicsWithCounts(db) {
  const [topics, total] = await db.batch([
    db.prepare(
      `SELECT t.id, t.name, t.weight, COUNT(a.id) AS unread,
              (SELECT COUNT(*) FROM feeds WHERE topic_id = t.id) AS feed_count
         FROM topics t
         LEFT JOIN feeds f ON f.topic_id = t.id
         LEFT JOIN articles a ON a.feed_id = f.id AND a.is_read = 0 AND a.is_hidden = 0
        GROUP BY t.id
        ORDER BY t.name COLLATE NOCASE`
    ),
    db.prepare('SELECT COUNT(*) AS unread FROM articles WHERE is_read = 0 AND is_hidden = 0'),
  ]);
  return { topics: topics.results, totalUnread: total.results[0]?.unread ?? 0 };
}

/** @param {any} db */
export async function listFeeds(db) {
  const { results } = await db
    .prepare(
      `SELECT f.*, t.name AS topic_name,
              (SELECT COUNT(*) FROM articles WHERE feed_id = f.id) AS article_count
         FROM feeds f LEFT JOIN topics t ON t.id = f.topic_id
        ORDER BY t.name COLLATE NOCASE, f.title COLLATE NOCASE`
    )
    .all();
  return results;
}

/** @param {any} db @param {number} id */
export function getFeed(db, id) {
  return db.prepare('SELECT * FROM feeds WHERE id = ?').bind(id).first();
}

/** @param {any} db @param {string} url */
export function getFeedByUrl(db, url) {
  return db.prepare('SELECT * FROM feeds WHERE url = ?').bind(url).first();
}

/** @param {any} db @param {{url: string, title: string, siteUrl: string, topicId: number|null}} f */
export async function insertFeed(db, f) {
  const row = await db
    .prepare('INSERT INTO feeds (url, title, site_url, topic_id) VALUES (?, ?, ?, ?) RETURNING *')
    .bind(f.url, f.title, f.siteUrl, f.topicId)
    .first();
  return row;
}

/** @param {any} db @param {number} id @param {{topicId: number|null, enabled: boolean, title: string}} f */
export function updateFeed(db, id, f) {
  return db
    .prepare('UPDATE feeds SET topic_id = ?, enabled = ?, title = ? WHERE id = ?')
    .bind(f.topicId, f.enabled ? 1 : 0, f.title, id)
    .run();
}

/** @param {any} db @param {number} id */
export function deleteFeed(db, id) {
  return db.batch([
    db.prepare('DELETE FROM articles WHERE feed_id = ?').bind(id),
    db.prepare('DELETE FROM feeds WHERE id = ?').bind(id),
  ]);
}

/** Feeds whose next fetch is due, least recently fetched first. @param {any} db @param {number} limit */
export async function dueFeeds(db, limit) {
  const { results } = await db
    .prepare(
      `SELECT * FROM feeds
        WHERE enabled = 1 AND (next_fetch_at IS NULL OR next_fetch_at <= ?)
        ORDER BY last_fetched_at IS NOT NULL, last_fetched_at
        LIMIT ?`
    )
    .bind(Date.now(), limit)
    .all();
  return results;
}

/**
 * @param {any} db
 * @param {number} feedId
 * @param {{guidHash: string, url: string, title: string, snippet: string, author: string, publishedAt: number}[]} items
 */
export async function insertArticles(db, feedId, items) {
  if (!items.length) return 0;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO articles (feed_id, guid_hash, url, title, snippet, author, published_at, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const results = await db.batch(
    items.map((i) => stmt.bind(feedId, i.guidHash, i.url, i.title, i.snippet, i.author, i.publishedAt, now))
  );
  return results.reduce((/** @type {number} */ n, /** @type {any} */ r) => n + (r.meta?.changes ?? 0), 0);
}

/**
 * @param {any} db
 * @param {number} id
 * @param {{ ok: boolean, error?: string, etag?: string|null, lastModified?: string|null,
 *           title?: string, siteUrl?: string, nextFetchAt: number, errorCount: number }} r
 */
export function recordFetch(db, id, r) {
  const now = Date.now();
  if (!r.ok) {
    return db
      .prepare('UPDATE feeds SET last_fetched_at = ?, next_fetch_at = ?, last_error = ?, error_count = ? WHERE id = ?')
      .bind(now, r.nextFetchAt, r.error ?? 'unknown error', r.errorCount, id)
      .run();
  }
  return db
    .prepare(
      `UPDATE feeds SET last_fetched_at = ?, next_fetch_at = ?, last_error = NULL, error_count = 0,
              etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified),
              title = CASE WHEN title = '' AND ? IS NOT NULL THEN ? ELSE title END,
              site_url = COALESCE(NULLIF(?, ''), site_url)
        WHERE id = ?`
    )
    .bind(now, r.nextFetchAt, r.etag ?? null, r.lastModified ?? null, r.title || null, r.title || null, r.siteUrl ?? '', id)
    .run();
}

/** @param {any} db */
export function purgeOldArticles(db) {
  return db
    .prepare('DELETE FROM articles WHERE is_starred = 0 AND fetched_at < ?')
    .bind(Date.now() - RETENTION_MS)
    .run();
}

/** @param {any} db */
export async function listTopics(db) {
  const { results } = await db.prepare('SELECT id, name FROM topics ORDER BY name COLLATE NOCASE').all();
  return results;
}

/** @param {any} db @param {string} name */
export function insertTopic(db, name) {
  return db.prepare('INSERT INTO topics (name) VALUES (?)').bind(name).run();
}

/** @param {any} db @param {number} id @param {string} name */
export function renameTopic(db, id, name) {
  return db.prepare('UPDATE topics SET name = ? WHERE id = ?').bind(name, id).run();
}

/** @param {any} db @param {number} id */
export function deleteTopic(db, id) {
  return db.batch([
    db.prepare('UPDATE feeds SET topic_id = NULL WHERE topic_id = ?').bind(id),
    db.prepare('DELETE FROM topics WHERE id = ?').bind(id),
  ]);
}
