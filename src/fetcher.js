// @ts-check
// Fetching feeds: cron refresh, single-feed refresh, and adding new feeds (with discovery).

import { parseFeed, discoverFeeds, NotAFeedError } from './parser.js';
import * as db from './db.js';

export const FEEDS_PER_RUN = 20; // keeps us well under the Workers subrequest limit
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const BASE_INTERVAL_MS = 30 * 60 * 1000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
export const USER_AGENT = 'rss-feed-worker/1.0 (personal feed reader)';

/** @param {string} s */
export async function sha256Hex(s) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  if (length > MAX_BODY_BYTES) throw new Error('Feed too large');
  const body = await res.text();
  if (body.length > MAX_BODY_BYTES) throw new Error('Feed too large');
  return { status: res.status, res, body };
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
  try {
    const r = await httpGet(feed.url, { etag: feed.etag, lastModified: feed.last_modified });
    if (r.status === 304) {
      await db.recordFetch(env.DB, feed.id, { ok: true, nextFetchAt: Date.now() + BASE_INTERVAL_MS, errorCount: 0 });
      return { id: feed.id, added: 0 };
    }
    const parsed = parseFeed(r.body, r.res.url || feed.url);
    const added = await db.insertArticles(env.DB, feed.id, await toRows(parsed.items));
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
    const errorCount = (feed.error_count || 0) + 1;
    const backoff = Math.min(BASE_INTERVAL_MS * 2 ** errorCount, MAX_BACKOFF_MS);
    const message = /** @type {Error} */ (err).message || String(err);
    await db
      .recordFetch(env.DB, feed.id, { ok: false, error: message.slice(0, 500), nextFetchAt: Date.now() + backoff, errorCount })
      .catch(() => {});
    return { id: feed.id, added: 0, error: message };
  }
}

/** Cron entry point. @param {any} env */
export async function runScheduled(env) {
  const feeds = await db.dueFeeds(env.DB, FEEDS_PER_RUN);
  const results = await Promise.all(feeds.map((/** @type {any} */ f) => refreshFeed(env, f)));
  await db.purgeOldArticles(env.DB);
  const added = results.reduce((n, r) => n + r.added, 0);
  const failed = results.filter((r) => r.error).length;
  console.log(`cron: ${feeds.length} feeds checked, ${added} new articles, ${failed} errors`);
}

/**
 * Add a feed by URL. Accepts a feed URL or a web page that advertises one.
 * @param {any} env
 * @param {string} inputUrl
 * @param {number|null} topicId
 * @returns {Promise<{ ok: true, feed: any, added: number } | { ok: false, error: string }>}
 */
export async function addFeed(env, inputUrl, topicId) {
  let url = normalizeHttpUrl(inputUrl);
  if (!url) return { ok: false, error: 'Please enter a valid http(s) URL.' };
  if (await db.getFeedByUrl(env.DB, url)) return { ok: false, error: 'This feed is already subscribed.' };

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
      if (await db.getFeedByUrl(env.DB, url)) return { ok: false, error: `Already subscribed to ${url}.` };
      r = await httpGet(url);
      parsed = parseFeed(r.body, r.res.url || url);
    }
  } catch (err) {
    return { ok: false, error: `Could not load feed: ${/** @type {Error} */ (err).message}` };
  }

  const feed = await db.insertFeed(env.DB, {
    url,
    title: parsed.title || new URL(url).hostname,
    siteUrl: parsed.siteUrl,
    topicId,
  });
  const added = await db.insertArticles(env.DB, feed.id, await toRows(parsed.items));
  await db.recordFetch(env.DB, feed.id, {
    ok: true,
    etag: r.res.headers.get('etag'),
    lastModified: r.res.headers.get('last-modified'),
    nextFetchAt: Date.now() + BASE_INTERVAL_MS,
    errorCount: 0,
  });
  return { ok: true, feed, added };
}
