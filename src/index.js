// @ts-check
// Worker entry: HTTP router + cron handler.

import { authenticate } from './auth.js';
import * as db from './db.js';
import { addFeed, refreshFeed, runScheduled } from './fetcher.js';
import { SafeHtml } from './html.js';
import { articleImage } from './images.js';
import { CSS, JS } from './static.js';
import * as views from './views.js';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
].join('; ');

const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin', // not 'no-referrer': that makes browsers send "Origin: null" on form posts
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

/** @param {BodyInit|null} body @param {number} status @param {Record<string,string>} headers */
function respond(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store', ...SECURITY_HEADERS, ...headers },
  });
}

/** @param {SafeHtml} page @param {number} [status] */
function htmlResponse(page, status = 200) {
  return respond(page.toString(), status, { 'content-type': 'text/html; charset=utf-8' });
}

/** @param {string} location */
function redirect(location) {
  return respond(null, 303, { location });
}

/** @param {number} status @param {string} message */
function errorResponse(status, message) {
  return htmlResponse(views.errorPage(status, message), status);
}

/** Positive integer or null. @param {unknown} v */
function toId(v) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * CSRF defence: state-changing requests must come from our own origin.
 * @param {Request} request @param {URL} url
 */
function isSameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin) return origin === url.origin;
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

/** Where to go back to after a form post. @param {Request} request @param {URL} url */
function backTo(request, url, fallback = '/') {
  const ref = request.headers.get('referer');
  if (!ref) return fallback;
  try {
    const r = new URL(ref);
    return r.origin === url.origin ? r.pathname + r.search : fallback;
  } catch {
    return fallback;
  }
}

/** @param {any} env @param {URL} url */
async function renderTimeline(env, url) {
  const p = url.searchParams;
  const filterParam = p.get('filter');
  /** @type {import('./db.js').ArticleQuery} */
  const q = {
    topic: toId(p.get('topic')),
    feed: toId(p.get('feed')),
    filter: filterParam === 'all' || filterParam === 'starred' ? filterParam : 'unread',
    page: Math.min(toId(p.get('page')) ?? 0, 1000),
  };
  const [{ articles, hasMore }, nav] = await Promise.all([db.listArticles(env.DB, q), db.topicsWithCounts(env.DB)]);

  let heading = 'All articles';
  if (q.feed) heading = (await db.getFeed(env.DB, q.feed))?.title || 'Feed';
  else if (q.topic) heading = nav.topics.find((/** @type {any} */ t) => t.id === q.topic)?.name || 'Topic';

  return htmlResponse(
    views.layout({
      title: heading,
      active: 'home',
      topics: nav.topics,
      totalUnread: nav.totalUnread,
      currentTopic: q.topic,
      body: views.timeline({ articles, hasMore, q, heading }),
    })
  );
}

/**
 * @param {any} env
 * @param {{ error?: string, message?: string, formUrl?: string }} [extra]
 * @param {number} [status]
 */
async function renderFeeds(env, extra = {}, status = 200) {
  const [feeds, nav] = await Promise.all([db.listFeeds(env.DB), db.topicsWithCounts(env.DB)]);
  return htmlResponse(
    views.layout({
      title: 'Feeds',
      active: 'feeds',
      topics: nav.topics,
      totalUnread: nav.totalUnread,
      body: views.feedsPage({ feeds, topics: nav.topics, ...extra }),
    }),
    status
  );
}

/** @param {any} env @param {string} [error] */
async function renderTopics(env, error) {
  const nav = await db.topicsWithCounts(env.DB);
  return htmlResponse(
    views.layout({
      title: 'Topics',
      active: 'topics',
      topics: nav.topics,
      totalUnread: nav.totalUnread,
      body: views.topicsPage({ topics: nav.topics, error }),
    }),
    error ? 400 : 200
  );
}

/** @param {unknown} v */
function cleanName(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
}

/** @param {Request} request @param {any} env @param {URL} url */
async function handlePost(request, env, url) {
  const path = url.pathname;
  const form = request.headers.get('content-type')?.includes('form') ? await request.formData() : new FormData();
  let m;

  // Articles
  if ((m = path.match(/^\/articles\/(\d+)\/([a-z]+)$/)) && db.isArticleAction(m[2])) {
    const state = await db.updateArticle(env.DB, Number(m[1]), m[2]);
    if (!state) return errorResponse(404, 'Article not found.');
    if (request.headers.get('x-requested-with') === 'fetch') {
      return respond(JSON.stringify(state), 200, { 'content-type': 'application/json' });
    }
    return redirect(backTo(request, url));
  }
  if (path === '/articles/mark-all-read') {
    await db.markAllRead(env.DB, { topic: toId(form.get('topic')), feed: toId(form.get('feed')), filter: 'unread', page: 0 });
    return redirect(backTo(request, url));
  }

  // Feeds
  if (path === '/feeds') {
    const inputUrl = String(form.get('url') ?? '');
    const result = await addFeed(env, inputUrl, toId(form.get('topic')));
    if (!result.ok) return renderFeeds(env, { error: result.error, formUrl: inputUrl }, 400);
    return renderFeeds(env, { message: `Added "${result.feed.title}" with ${result.added} articles.` });
  }
  if ((m = path.match(/^\/feeds\/(\d+)(?:\/(refresh|delete))?$/))) {
    const feed = await db.getFeed(env.DB, Number(m[1]));
    if (!feed) return errorResponse(404, 'Feed not found.');
    if (m[2] === 'delete') {
      await db.deleteFeed(env.DB, feed.id);
      return redirect('/feeds');
    }
    if (m[2] === 'refresh') {
      const r = await refreshFeed(env, feed);
      return renderFeeds(env, r.error ? { error: `Refresh failed: ${r.error}` } : { message: `${r.added} new articles.` });
    }
    await db.updateFeed(env.DB, feed.id, {
      topicId: toId(form.get('topic')),
      enabled: form.get('enabled') === '1',
      title: String(form.get('title') ?? '').trim().slice(0, 200) || feed.title,
    });
    return redirect('/feeds');
  }

  // Topics
  if (path === '/topics') {
    const name = cleanName(form.get('name'));
    if (!name) return renderTopics(env, 'Name is required.');
    try {
      await db.insertTopic(env.DB, name);
    } catch {
      return renderTopics(env, `Topic "${name}" already exists.`);
    }
    return redirect('/topics');
  }
  if ((m = path.match(/^\/topics\/(\d+)(\/delete)?$/))) {
    const id = Number(m[1]);
    if (m[2]) {
      await db.deleteTopic(env.DB, id);
      return redirect('/topics');
    }
    const name = cleanName(form.get('name'));
    if (!name) return renderTopics(env, 'Name is required.');
    try {
      await db.renameTopic(env.DB, id, name);
    } catch {
      return renderTopics(env, `Topic "${name}" already exists.`);
    }
    return redirect('/topics');
  }

  return errorResponse(404, 'Not found.');
}

/**
 * @param {Request} request @param {any} env @param {number} id
 * @param {{ waitUntil(p: Promise<unknown>): void }} ctx
 */
async function serveImage(request, env, ctx, id) {
  const img = await articleImage(request, env, ctx, id);
  // Missing or broken images are cached too, so the browser does not retry them on every page.
  if (!img) return respond(null, 404, { 'cache-control': 'private, max-age=86400' });
  return respond(img.body, 200, { 'content-type': img.type, 'cache-control': `private, max-age=${img.maxAge}` });
}

/**
 * @param {Request} request @param {any} env
 * @param {{ waitUntil(p: Promise<unknown>): void }} ctx
 */
async function handle(request, env, ctx) {
  const url = new URL(request.url);

  const auth = await authenticate(request, env);
  if (!auth.ok) {
    console.warn(`auth rejected: ${auth.reason}`);
    return respond('Unauthorized', 401, { 'content-type': 'text/plain; charset=utf-8' });
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    const img = url.pathname.match(/^\/img\/(\d+)$/);
    if (img) return serveImage(request, env, ctx, Number(img[1]));
    switch (url.pathname) {
      case '/':
        return renderTimeline(env, url);
      case '/feeds':
        return renderFeeds(env);
      case '/topics':
        return renderTopics(env);
      case '/app.css':
        return respond(CSS, 200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'private, max-age=3600' });
      case '/app.js':
        return respond(JS, 200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'private, max-age=3600' });
      case '/favicon.ico':
        return respond(null, 204);
      default:
        return errorResponse(404, 'Not found.');
    }
  }

  if (request.method === 'POST') {
    if (!isSameOrigin(request, url)) {
      console.warn(
        `csrf rejected: origin=${request.headers.get('origin')} sec-fetch-site=${request.headers.get('sec-fetch-site')} ` +
          `expected=${url.origin} host=${request.headers.get('host')}`
      );
      return errorResponse(403, 'Cross-origin request blocked.');
    }
    return handlePost(request, env, url);
  }

  return respond('Method not allowed', 405, { allow: 'GET, HEAD, POST' });
}

export default {
  /** @param {Request} request @param {any} env @param {{ waitUntil(p: Promise<unknown>): void }} ctx */
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (err) {
      console.error(err);
      return errorResponse(500, 'Something went wrong.');
    }
  },

  /** @param {any} _event @param {any} env @param {{ waitUntil(p: Promise<unknown>): void }} ctx */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runScheduled(env));
  },
};
