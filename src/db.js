// @ts-check
// All SQL lives here. `db` is a D1Database binding.
//
// Multi-user: every function that serves a request takes `userId` and only sees that user's rows —
// articles through `feeds.user_id`. IDs from requests are never trusted on their own: a foreign ID
// simply matches nothing. Only the cron functions (CRON_ONLY below) work across all users.
// test/security-rules.test.js checks that every other statement filters on `user_id = ?` (or inserts a
// row owned by the user).

export const PAGE_SIZE = 50;
export const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
/** Unstarred articles kept per feed; bounds what one (hostile) feed can store in D1. */
export const MAX_ARTICLES_PER_FEED = 3000;
/** Topics every new user starts with. */
export const DEFAULT_TOPICS = ['Security', 'News', 'Tech'];

/** Functions that run for all users (cron) and are exempt from the user_id rule. */
export const CRON_ONLY = ['dueFeeds', 'insertArticles', 'recordFetch', 'markFetchAttempt', 'purgeOldArticles', 'usersWithDevices'];

// Users

/**
 * The user with this email, created on first login (with the default topics).
 * Safe against two parallel first requests: the second insert is ignored and the row is read again.
 * @param {any} db @param {string} email from normalizeEmail (src/users.js): checked, A–Z lower-cased, non-empty
 * @returns {Promise<number>} user id
 */
export async function findOrCreateUser(db, email) {
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return existing.id;
  const created = await db
    .prepare('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING RETURNING id')
    .bind(email, Date.now())
    .first();
  if (!created) {
    const row = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    return row.id;
  }
  const topic = db.prepare('INSERT OR IGNORE INTO topics (user_id, name) VALUES (?, ?)');
  await db.batch(DEFAULT_TOPICS.map((name) => topic.bind(created.id, name)));
  return created.id;
}

// Articles

/**
 * @typedef {{ topic?: number|null, feed?: number|null, filter: 'unread'|'all'|'starred', page: number }} ArticleQuery
 */

/** @param {number} userId @param {ArticleQuery} q */
function articleWhere(userId, q) {
  const where = ['f.user_id = ?', 'a.is_hidden = 0'];
  /** @type {unknown[]} */
  const params = [userId];
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

/** @param {any} db @param {number} userId @param {ArticleQuery} q */
export async function listArticles(db, userId, q) {
  const w = articleWhere(userId, q);
  const { results } = await db
    .prepare(
      `SELECT a.id, a.url, a.title, a.snippet, a.author, a.published_at, a.is_read, a.is_starred, a.image_url,
              f.id AS feed_id, f.title AS feed_title, t.id AS topic_id, t.name AS topic_name
         FROM articles a
         JOIN feeds f ON f.id = a.feed_id
         LEFT JOIN topics t ON t.id = f.topic_id AND t.user_id = f.user_id
        WHERE ${w.sql}
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT ? OFFSET ?`
    )
    .bind(...w.params, PAGE_SIZE + 1, q.page * PAGE_SIZE)
    .all();
  return { articles: results.slice(0, PAGE_SIZE), hasMore: results.length > PAGE_SIZE };
}

/** @param {any} db @param {number} userId @param {ArticleQuery} q */
export async function markAllRead(db, userId, q) {
  const w = articleWhere(userId, { ...q, filter: 'unread' });
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

/** @param {any} db @param {number} userId @param {number} id @param {string} action @returns {Promise<any>} null if not the user's */
export async function updateArticle(db, userId, id, action) {
  const set = ARTICLE_ACTIONS[/** @type {keyof ARTICLE_ACTIONS} */ (action)];
  return db
    .prepare(
      `UPDATE articles SET ${set}
        WHERE id = ? AND feed_id IN (SELECT id FROM feeds WHERE user_id = ?)
        RETURNING id, is_read, is_starred, is_hidden`
    )
    .bind(id, userId)
    .first();
}

/** @param {any} db @param {number} userId @param {number} id @returns {Promise<string>} '' if none or not the user's */
export async function getArticleImageUrl(db, userId, id) {
  const row = await db
    .prepare('SELECT a.image_url FROM articles a JOIN feeds f ON f.id = a.feed_id WHERE a.id = ? AND f.user_id = ?')
    .bind(id, userId)
    .first();
  return row?.image_url ?? '';
}

// Topics

/** Topics with unread counts, plus the overall unread total. @param {any} db @param {number} userId */
export async function topicsWithCounts(db, userId) {
  const [topics, total] = await db.batch([
    db
      .prepare(
        `SELECT t.id, t.name, t.weight, COUNT(a.id) AS unread,
                (SELECT COUNT(*) FROM feeds WHERE topic_id = t.id AND user_id = t.user_id) AS feed_count
           FROM topics t
           LEFT JOIN feeds f ON f.topic_id = t.id AND f.user_id = t.user_id
           LEFT JOIN articles a ON a.feed_id = f.id AND a.is_read = 0 AND a.is_hidden = 0
          WHERE t.user_id = ?
          GROUP BY t.id
          ORDER BY t.name COLLATE NOCASE`
      )
      .bind(userId),
    db
      .prepare(
        `SELECT COUNT(*) AS unread FROM articles a JOIN feeds f ON f.id = a.feed_id
          WHERE f.user_id = ? AND a.is_read = 0 AND a.is_hidden = 0`
      )
      .bind(userId),
  ]);
  return { topics: topics.results, totalUnread: total.results[0]?.unread ?? 0 };
}

/** @param {any} db @param {number} userId @param {number} id */
export async function ownsTopic(db, userId, id) {
  return Boolean(await db.prepare('SELECT 1 FROM topics WHERE id = ? AND user_id = ?').bind(id, userId).first());
}

/** @param {any} db @param {number} userId @param {string} name */
export function insertTopic(db, userId, name) {
  return db.prepare('INSERT INTO topics (user_id, name) VALUES (?, ?)').bind(userId, name).run();
}

/** @param {any} db @param {number} userId @param {number} id @param {string} name */
export function renameTopic(db, userId, id, name) {
  return db.prepare('UPDATE topics SET name = ? WHERE id = ? AND user_id = ?').bind(name, id, userId).run();
}

/** @param {any} db @param {number} userId @param {number} id */
export function deleteTopic(db, userId, id) {
  return db.batch([
    db.prepare('UPDATE feeds SET topic_id = NULL WHERE topic_id = ? AND user_id = ?').bind(id, userId),
    db.prepare('DELETE FROM topics WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
}

// Feeds

/** @param {any} db @param {number} userId */
export async function listFeeds(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT f.*, t.name AS topic_name,
              (SELECT COUNT(*) FROM articles WHERE feed_id = f.id) AS article_count
         FROM feeds f LEFT JOIN topics t ON t.id = f.topic_id AND t.user_id = f.user_id
        WHERE f.user_id = ?
        ORDER BY t.name COLLATE NOCASE, f.title COLLATE NOCASE`
    )
    .bind(userId)
    .all();
  return results;
}

/** @param {any} db @param {number} userId @param {number} id @returns {Promise<any>} null if not the user's */
export function getFeed(db, userId, id) {
  return db.prepare('SELECT * FROM feeds WHERE id = ? AND user_id = ?').bind(id, userId).first();
}

/** @param {any} db @param {number} userId @param {string} url */
export function getFeedByUrl(db, userId, url) {
  return db.prepare('SELECT * FROM feeds WHERE url = ? AND user_id = ?').bind(url, userId).first();
}

// A feed's topic must be one of the same user's topics. The database can't express that, so the SQL
// does: another user's (or a non-existent) topic id becomes NULL ("no topic").
const OWN_TOPIC = '(SELECT id FROM topics WHERE id = ? AND user_id = ?)';

/** @param {any} db @param {number} userId @param {{url: string, title: string, siteUrl: string, topicId: number|null}} f */
export async function insertFeed(db, userId, f) {
  const row = await db
    .prepare(`INSERT INTO feeds (user_id, url, title, site_url, topic_id) VALUES (?, ?, ?, ?, ${OWN_TOPIC}) RETURNING *`)
    .bind(userId, f.url, f.title, f.siteUrl, f.topicId, userId)
    .first();
  return row;
}

/** @param {any} db @param {number} userId @param {number} id @param {{topicId: number|null, enabled: boolean, title: string}} f */
export function updateFeed(db, userId, id, f) {
  return db
    .prepare(`UPDATE feeds SET topic_id = ${OWN_TOPIC}, enabled = ?, title = ? WHERE id = ? AND user_id = ?`)
    .bind(f.topicId, userId, f.enabled ? 1 : 0, f.title, id, userId)
    .run();
}

/** @param {any} db @param {number} userId @param {number} id */
export function deleteFeed(db, userId, id) {
  return db.batch([
    db.prepare('DELETE FROM articles WHERE feed_id IN (SELECT id FROM feeds WHERE id = ? AND user_id = ?)').bind(id, userId),
    db.prepare('DELETE FROM feeds WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
}

// Cron (all users)

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
 * @param {number} feedId a feed that belongs to a user (from dueFeeds or getFeed)
 * @param {{guidHash: string, url: string, title: string, snippet: string, author: string, publishedAt: number, imageUrl: string}[]} items
 */
export async function insertArticles(db, feedId, items) {
  if (!items.length) return 0;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO articles (feed_id, guid_hash, url, title, snippet, author, published_at, fetched_at, image_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const results = await db.batch(
    items.map((i) => stmt.bind(feedId, i.guidHash, i.url, i.title, i.snippet, i.author, i.publishedAt, now, i.imageUrl))
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

/**
 * Mark a fetch as started, pessimistically: as if it failed. recordFetch overwrites it on completion.
 * @param {any} db @param {number} id @param {{ nextFetchAt: number, errorCount: number }} r
 */
export function markFetchAttempt(db, id, r) {
  return db
    .prepare(
      `UPDATE feeds SET last_fetched_at = ?, next_fetch_at = ?, error_count = ?,
              last_error = 'Fetch did not finish (timeout or too slow to process)' WHERE id = ?`
    )
    .bind(Date.now(), r.nextFetchAt, r.errorCount, id)
    .run();
}

/** Unstarred articles: delete after RETENTION_MS, and per feed beyond the newest MAX_ARTICLES_PER_FEED. @param {any} db */
export function purgeOldArticles(db) {
  return db.batch([
    db.prepare('DELETE FROM articles WHERE is_starred = 0 AND fetched_at < ?').bind(Date.now() - RETENTION_MS),
    db
      .prepare(
        `DELETE FROM articles WHERE id IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY published_at DESC, id DESC) AS n
               FROM articles WHERE is_starred = 0)
            WHERE n > ?)`
      )
      .bind(MAX_ARTICLES_PER_FEED),
  ]);
}

// Push notifications

/** Users with at least one subscribed device (for the daily summary). @param {any} db @returns {Promise<number[]>} */
export async function usersWithDevices(db) {
  const { results } = await db.prepare('SELECT DISTINCT user_id FROM push_subscriptions').all();
  return results.map((/** @type {any} */ r) => r.user_id);
}

/**
 * Store a device for this user. An endpoint belongs to one user at a time: subscribing again from the
 * same device (e.g. after switching accounts) moves it.
 * @param {any} db @param {number} userId @param {{ endpoint: string, p256dh: string, auth: string }} s
 */
export function upsertSubscription(db, userId, s) {
  return db
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
                                           auth = excluded.auth, last_error = ''`
    )
    .bind(userId, s.endpoint, s.p256dh, s.auth, Date.now())
    .run();
}

/** @param {any} db @param {number} userId @param {string} endpoint */
export function deleteSubscription(db, userId, endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, userId).run();
}

/** @param {any} db @param {number} userId @returns {Promise<{ id: number, endpoint: string, p256dh: string, auth: string }[]>} */
export async function listSubscriptions(db, userId) {
  const { results } = await db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all();
  return results;
}

/** @param {any} db @param {number} userId @returns {Promise<{ id: number, endpoint: string, created_at: number, last_error: string }[]>} */
export async function listDevices(db, userId) {
  const { results } = await db
    .prepare('SELECT id, endpoint, created_at, last_error FROM push_subscriptions WHERE user_id = ? ORDER BY created_at')
    .bind(userId)
    .all();
  return results;
}

/** @param {any} db @param {number} userId @param {number} id */
export function deleteSubscriptionById(db, userId, id) {
  return db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

/** @param {any} db @param {number} userId @param {number} id @param {string} error */
export function setSubscriptionError(db, userId, id, error) {
  return db
    .prepare('UPDATE push_subscriptions SET last_error = ? WHERE id = ? AND user_id = ?')
    .bind(error, id, userId)
    .run();
}

// Job bookkeeping (keys carry the user id where needed, e.g. "digest_date:3")

/** @param {any} db @param {string} key @returns {Promise<string|null>} */
export async function getState(db, key) {
  const row = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(key).first();
  return row?.value ?? null;
}

/** @param {any} db @param {string} key @param {string} value */
export function setState(db, key, value) {
  return db
    .prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

/**
 * Unread, visible articles fetched after `since`, counted per enabled feed of the user with the given notify mode.
 * @param {any} db @param {number} userId @param {number} since epoch ms @param {string} notify
 * @returns {Promise<{ title: string, siteUrl: string, feedUrl: string, count: number }[]>}
 */
export async function newArticleCounts(db, userId, since, notify) {
  const { results } = await db
    .prepare(
      `SELECT f.title AS title, f.site_url AS siteUrl, f.url AS feedUrl, COUNT(*) AS count
         FROM articles a JOIN feeds f ON f.id = a.feed_id
        WHERE f.user_id = ? AND a.fetched_at > ? AND a.is_read = 0 AND a.is_hidden = 0
          AND f.enabled = 1 AND f.notify = ?
        GROUP BY f.id`
    )
    .bind(userId, since, notify)
    .all();
  return results;
}
