// @ts-check
// Fetching feeds: cron refresh, single-feed refresh, and adding new feeds (with discovery).

import { DIGEST_TIME_ZONE, localDateHour, maybeSendDigest } from './digest.js';
import { parseFeed, discoverFeeds, NotAFeedError } from './parser.js';
import * as db from './db.js';
import { matchRule } from './mute.js';

export const FEEDS_PER_RUN = 20; // keeps us well under the Workers subrequest limit
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const BASE_INTERVAL_MS = 30 * 60 * 1000;
// A feed fetched a few seconds into a run is due a few seconds *after* the run 30 minutes later
// starts; without slack it would wait one extra run. Cron every 15 min → fetched about every 30 min.
export const DUE_SLACK_MS = 2 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
export const USER_AGENT = 'rss-feed-worker/1.0 (personal feed reader)';

/** @param {string} s */
export async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The whole body, or null as soon as it exceeds `max` bytes.
 * @param {ReadableStream<Uint8Array>} body @param {number} max
 */
export async function readCapped(body, max) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** @param {unknown} url */
export function normalizeHttpUrl(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

/**
 * GET a URL with timeout, size cap and optional conditional headers.
 * @param {string} url
 * @param {{ etag?: string|null, lastModified?: string|null }} [cond]
 */
async function httpGet(url, cond = {}) {
  /** @type {Record<string,string>} */
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1',
  };
  if (cond.etag) headers['if-none-match'] = cond.etag;
  if (cond.lastModified) headers['if-modified-since'] = cond.lastModified;

  const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (res.status === 304) return { status: 304, res, body: '' };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES || !res.body) {
    await res.body?.cancel();
    throw new Error(res.body ? 'Feed too large' : 'Empty response');
  }
  // Capped read: a server that streams without content-length can't make us buffer more than the limit.
  const bytes = await readCapped(res.body, MAX_BODY_BYTES);
  if (!bytes) throw new Error('Feed too large');
  return { status: res.status, res, body: new TextDecoder().decode(bytes) };
}

/**
 * Rows ready for insertion, with the feed's mute rules applied (one indexed query per changed feed).
 * @param {any} env @param {number} feedId @param {import('./parser.js').FeedItem[]} items
 */
async function rowsForFeed(env, feedId, items) {
  const [rows, rules] = await Promise.all([toRows(items), items.length ? db.muteRulesForFeed(env.DB, feedId) : []]);
  return rows.map((row) => ({ ...row, mutedBy: matchRule(rules, row) }));
}

/**
 * Parsed items → rows ready for insertion (dedup hash, sane dates).
 * @param {import('./parser.js').FeedItem[]} items
 */
async function toRows(items) {
  const now = Date.now();
  return Promise.all(
    items.map(async (item, i) => ({
      guidHash: await sha256Hex(item.guid),
      url: item.url,
      title: item.title,
      snippet: item.snippet,
      author: item.author,
      imageUrl: item.imageUrl,
      // Unknown or future dates: use "now", keeping document order stable.
      publishedAt: item.publishedAt && item.publishedAt <= now + 60_000 ? item.publishedAt : now - i,
    }))
  );
}

/**
 * Fetch one feed, store new articles, update bookkeeping. Never throws.
 * @param {any} env
 * @param {any} feed row from the feeds table
 */
export async function refreshFeed(env, feed) {
  const errorCount = (feed.error_count || 0) + 1;
  const backoff = Math.min(BASE_INTERVAL_MS * 2 ** errorCount, MAX_BACKOFF_MS);
  try {
    // Record the attempt as failed *before* fetching; success overwrites it. If the invocation is
    // killed (CPU/memory limit on a hostile feed), the feed is backed off instead of being retried
    // first on every run.
    await db.markFetchAttempt(env.DB, feed.id, { nextFetchAt: Date.now() + backoff, errorCount });
    const r = await httpGet(feed.url, { etag: feed.etag, lastModified: feed.last_modified });
    if (r.status === 304) {
      await db.recordFetch(env.DB, feed.id, { ok: true, nextFetchAt: Date.now() + BASE_INTERVAL_MS, errorCount: 0 });
      return { id: feed.id, added: 0 };
    }
    const parsed = parseFeed(r.body, r.res.url || feed.url);
    const added = await db.insertArticles(env.DB, feed.id, await rowsForFeed(env, feed.id, parsed.items));
    await db.recordFetch(env.DB, feed.id, {
      ok: true,
      etag: r.res.headers.get('etag'),
      lastModified: r.res.headers.get('last-modified'),
      title: parsed.title,
      siteUrl: parsed.siteUrl,
      nextFetchAt: Date.now() + BASE_INTERVAL_MS,
      errorCount: 0,
    });
    return { id: feed.id, added };
  } catch (err) {
    const message = /** @type {Error} */ (err).message || String(err);
    await db
      .recordFetch(env.DB, feed.id, { ok: false, error: message.slice(0, 500), nextFetchAt: Date.now() + backoff, errorCount })
      .catch(() => {});
    return { id: feed.id, added: 0, error: message };
  }
}

/**
 * Delete old articles at most once per calendar day (Europe/Berlin): the purge reads the whole
 * articles table, and every 15 minutes that would approach the free plan's daily D1 read limit.
 * Marked as done before purging, like the daily summary, so a failure doesn't retry on every run.
 * @param {any} env @param {number} [now]
 * @returns {Promise<boolean>} whether it ran
 */
export async function purgeOncePerDay(env, now = Date.now()) {
  const { date } = localDateHour(now, DIGEST_TIME_ZONE);
  if ((await db.getState(env.DB, 'purge_date')) === date) return false;
  await db.setState(env.DB, 'purge_date', date);
  await db.purgeOldArticles(env.DB);
  return true;
}

/** Cron entry point. @param {any} env */
export async function runScheduled(env) {
  // Digest and purge first: they must not depend on every feed parsing within the run's limits.
  // (The summary at 19:00 counts what earlier runs fetched; this run's articles go into tomorrow's.)
  await maybeSendDigest(env).catch((err) => console.error('digest failed', err));
  await purgeOncePerDay(env).catch((err) => console.error('purge failed', err));

  const feeds = await db.dueFeeds(env.DB, FEEDS_PER_RUN, Date.now() + DUE_SLACK_MS);
  const results = await Promise.all(feeds.map((/** @type {any} */ f) => refreshFeed(env, f)));
  const added = results.reduce((n, r) => n + r.added, 0);
  const failed = results.filter((r) => r.error);
  for (const r of failed) console.warn(`feed ${r.id} failed: ${String(r.error).slice(0, 200)}`);
  console.log(`cron: ${feeds.length} feeds checked, ${added} new articles, ${failed.length} errors`);
}

/**
 * Add a feed by URL. Accepts a feed URL or a web page that advertises one.
 * @param {any} env
 * @param {number} userId
 * @param {string} inputUrl
 * @param {number|null} topicId a topic of this user (checked by the caller)
 * @returns {Promise<{ ok: true, feed: any, added: number } | { ok: false, error: string }>}
 */
export async function addFeed(env, userId, inputUrl, topicId) {
  let url = normalizeHttpUrl(inputUrl);
  if (!url) return { ok: false, error: 'Please enter a valid http(s) URL.' };
  if (await db.getFeedByUrl(env.DB, userId, url)) return { ok: false, error: 'This feed is already subscribed.' };

  let r;
  let parsed;
  try {
    r = await httpGet(url);
    try {
      parsed = parseFeed(r.body, r.res.url || url);
    } catch (err) {
      if (!(err instanceof NotAFeedError)) throw err;
      const candidates = discoverFeeds(r.body, r.res.url || url);
      if (!candidates.length) return { ok: false, error: 'No RSS/Atom feed found at this URL.' };
      url = candidates[0];
      if (await db.getFeedByUrl(env.DB, userId, url)) return { ok: false, error: `Already subscribed to ${url}.` };
      r = await httpGet(url);
      parsed = parseFeed(r.body, r.res.url || url);
    }
  } catch (err) {
    return { ok: false, error: `Could not load feed: ${/** @type {Error} */ (err).message}` };
  }

  const feed = await db.insertFeed(env.DB, userId, {
    url,
    title: parsed.title || new URL(url).hostname,
    siteUrl: parsed.siteUrl,
    topicId,
  });
  const added = await db.insertArticles(env.DB, feed.id, await rowsForFeed(env, feed.id, parsed.items));
  await db.recordFetch(env.DB, feed.id, {
    ok: true,
    etag: r.res.headers.get('etag'),
    lastModified: r.res.headers.get('last-modified'),
    nextFetchAt: Date.now() + BASE_INTERVAL_MS,
    errorCount: 0,
  });
  return { ok: true, feed, added };
}
