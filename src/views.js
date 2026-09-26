// @ts-check
// Server-rendered pages.
//
// XSS rules — escaping only protects text and *quoted* attributes, so:
//   1. Build markup only with html`...` — never plain backtick strings, never raw() with data.
//   2. Always quote attributes:        class="${x}"   not   class=${x}
//   3. Links from feeds use safeUrl():  href="${safeUrl(a.url)}"; our own links use qs() or a fixed "/path".
//   4. No values inside <script>, <style>, style="..." or on*="..." attributes.
// test/xss-rules.test.js checks these rules against the source.

import { html, safeUrl } from './html.js';

/** @param {number|null|undefined} ms */
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/** @param {number|null|undefined} ms */
function time(ms) {
  if (!ms) return html`<span>never</span>`;
  return html`<time datetime="${new Date(ms).toISOString()}">${timeAgo(ms)}</time>`;
}

/**
 * Build a query string for the timeline, keeping the current filters.
 * @param {Record<string, unknown>} params
 */
function qs(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '' && v !== 0) sp.set(k, String(v));
  const s = sp.toString();
  return s ? `/?${s}` : '/';
}

/**
 * @param {{ title: string, active: string, topics: any[], totalUnread: number, currentTopic?: number|null, version: string, assetVersion: string, userEmail: string, body: unknown }} p
 */
export function layout(p) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="same-origin">
<meta name="theme-color" content="#fafaf9" media="(prefers-color-scheme: light)" data-scheme="light">
<meta name="theme-color" content="#161412" media="(prefers-color-scheme: dark)" data-scheme="dark">
<title>${p.title} · RSS</title>
<link rel="stylesheet" href="/app.css?v=${p.assetVersion}">
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="RSS">
<script src="/theme.js?v=${p.assetVersion}"></script>
<script src="/app.js?v=${p.assetVersion}" defer></script>
</head>
<body>
<header class="top">
  <a class="brand" href="/">RSS</a>
  <nav>
    <a href="/" class="${p.active === 'home' ? 'on' : ''}">Timeline</a>
    <a href="/feeds" class="${p.active === 'feeds' ? 'on' : ''}">Feeds</a>
    <a href="/topics" class="${p.active === 'topics' ? 'on' : ''}">Topics</a>
  </nav>
  <span class="who" title="Signed in as ${p.userEmail}">${p.userEmail}</span>
  <button type="button" class="theme-toggle" hidden>Theme</button>
</header>
<div class="wrap">
  <aside class="side">
    <a href="/" class="${p.active === 'home' && !p.currentTopic ? 'on' : ''}">All <span class="count">${p.totalUnread}</span></a>
    ${p.topics.map(
      (t) => html`<a href="${qs({ topic: t.id })}" class="${p.currentTopic === t.id ? 'on' : ''}">${t.name}
        <span class="count">${t.unread}</span></a>`
    )}
  </aside>
  <main>${p.body}</main>
</div>
<footer class="version">${p.version}</footer>
</body>
</html>`;
}

// Colour classes .feed-c0 … .feed-c9 in src/static.js.
const FEED_COLOURS = 10;

/**
 * Small coloured square with the feed's first letter, so feeds are recognisable at a glance.
 * The colour is fixed per feed id; the class only ever contains a number.
 * @param {number} feedId @param {string} title
 */
export function feedBadge(feedId, title) {
  const n = Math.abs(Math.trunc(Number(feedId) || 0)) % FEED_COLOURS;
  const letter = [...(title || '')].find((ch) => /[\p{L}\p{N}]/u.test(ch))?.toLocaleUpperCase() ?? '•';
  return html`<span class="badge feed-c${n}" aria-hidden="true">${letter}</span>`;
}

/** @param {any} a */
export function articleItem(a) {
  const readAction = a.is_read ? 'unread' : 'read';
  const starAction = a.is_starred ? 'unstar' : 'star';
  return html`<article class="item${a.is_read ? ' is-read' : ''}${a.is_starred ? ' is-starred' : ''}" data-id="${a.id}">
  <div class="head">
    <div>
      <h2><a class="title" href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer">${a.title || '(untitled)'}</a></h2>
      <div class="meta">
        <a class="feed" href="${qs({ feed: a.feed_id })}">${feedBadge(a.feed_id, a.feed_title)}${a.feed_title}</a>
        ${a.topic_name ? html`· <a href="${qs({ topic: a.topic_id })}">${a.topic_name}</a>` : ''}
        ${a.author ? html`· ${a.author}` : ''}
        · ${time(a.published_at)}
      </div>
    </div>
    ${a.image_url ? html`<img class="thumb" src="/img/${a.id}" alt="" loading="lazy" decoding="async">` : ''}
  </div>
  ${a.snippet ? html`<p class="snippet">${a.snippet}</p>` : ''}
  <div class="actions">
    <form method="post" action="/articles/${a.id}/${readAction}" class="js-action">
      <button type="submit" data-kind="read">${a.is_read ? 'Mark unread' : 'Mark read'}</button>
    </form>
    <form method="post" action="/articles/${a.id}/${starAction}" class="js-action">
      <button type="submit" data-kind="star">${a.is_starred ? '★ Unstar' : '☆ Star'}</button>
    </form>
    <form method="post" action="/articles/${a.id}/hide" class="js-action">
      <button type="submit" data-kind="hide">Hide</button>
    </form>
    ${safeUrl(a.url) !== '#'
      ? html`<a class="open-brave" href="${safeUrl(a.url)}" target="_blank" rel="noopener noreferrer" hidden>↗ Brave</a>`
      : ''}
  </div>
</article>`;
}

/**
 * @param {{ articles: any[], hasMore: boolean, q: import('./db.js').ArticleQuery, heading: string }} p
 */
export function timeline(p) {
  const { q } = p;
  const base = { topic: q.topic, feed: q.feed };
  return html`<div class="toolbar">
  <h1>${p.heading}</h1>
  <div class="filters">
    ${/** @type {const} */ (['unread', 'all', 'starred']).map(
      (f) => html`<a href="${qs({ ...base, filter: f === 'unread' ? '' : f })}" class="${q.filter === f ? 'on' : ''}">${f}</a>`
    )}
  </div>
  <form method="post" action="/articles/mark-all-read">
    <input type="hidden" name="topic" value="${q.topic ?? ''}">
    <input type="hidden" name="feed" value="${q.feed ?? ''}">
    <button type="submit">Mark all read</button>
  </form>
</div>
${p.articles.length ? p.articles.map(articleItem) : html`<p class="empty">Nothing here. <a href="/feeds">Add some feeds</a> or check other filters.</p>`}
<nav class="pager">
  ${q.page > 0 ? html`<a href="${qs({ ...base, filter: q.filter === 'unread' ? '' : q.filter, page: q.page - 1 })}">← Newer</a>` : ''}
  ${p.hasMore ? html`<a href="${qs({ ...base, filter: q.filter === 'unread' ? '' : q.filter, page: q.page + 1 })}">Older →</a>` : ''}
</nav>`;
}

/** @param {any[]} topics @param {number|null} selected */
function topicSelect(topics, selected, name = 'topic') {
  return html`<select name="${name}">
    <option value="">— no topic —</option>
    ${topics.map((t) => html`<option value="${t.id}" ${t.id === selected ? html`selected` : ''}>${t.name}</option>`)}
  </select>`;
}

/**
 * @param {{ feeds: any[], topics: any[], pushKey: string, devices: { id: number, host: string, createdAt: number, lastError: string }[],
 *   error?: string, message?: string, formUrl?: string }} p
 */
export function feedsPage(p) {
  return html`<h1>Feeds</h1>
${p.error ? html`<p class="flash error">${p.error}</p>` : ''}
${p.message ? html`<p class="flash">${p.message}</p>` : ''}
<section class="card push" data-key="${p.pushKey}">
  <h2>Notifications</h2>
  <p class="sub">A daily summary of new articles at 19:00.</p>
  <p class="push-status">Checking…</p>
  <button type="button" data-push="on" hidden>Turn on</button>
  <button type="button" data-push="off" hidden>Turn off</button>
  <button type="button" data-push="test" hidden>Send test</button>
  ${p.devices.length
    ? html`<ul class="devices">
    ${p.devices.map(
      (d) => html`<li>${d.host} · added ${time(d.createdAt)}${d.lastError ? html` · <span class="error">⚠ ${d.lastError}</span>` : ''}
      <form method="post" action="/push/devices/${d.id}/delete" class="inline"><button type="submit" class="danger">Remove</button></form></li>`
    )}
  </ul>`
    : ''}
</section>
<form method="post" action="/feeds" class="card add">
  <label>Feed or website URL <input type="url" name="url" required placeholder="https://example.com/feed.xml" value="${p.formUrl ?? ''}"></label>
  <label>Topic ${topicSelect(p.topics, null)}</label>
  <button type="submit">Add feed</button>
</form>
<table class="feeds">
  <thead><tr><th>Feed</th><th>Topic / title</th><th>Status</th><th></th></tr></thead>
  <tbody>
  ${p.feeds.map(
    (f) => html`<tr class="${f.enabled ? '' : 'disabled'}">
    <td>
      <a href="${qs({ feed: f.id })}">${f.title || f.url}</a>
      <div class="sub"><a href="${safeUrl(f.site_url || f.url)}" target="_blank" rel="noopener noreferrer">${f.url}</a></div>
    </td>
    <td>
      <form method="post" action="/feeds/${f.id}" class="inline">
        ${topicSelect(p.topics, f.topic_id)}
        <input type="text" name="title" value="${f.title}" aria-label="Title">
        <label class="check"><input type="checkbox" name="enabled" value="1" ${f.enabled ? html`checked` : ''}> enabled</label>
        <button type="submit">Save</button>
      </form>
    </td>
    <td>
      ${f.article_count} articles · fetched ${time(f.last_fetched_at)}
      ${f.last_error ? html`<div class="error">⚠ ${f.last_error} (${f.error_count}×)</div>` : ''}
    </td>
    <td class="row-actions">
      <form method="post" action="/feeds/${f.id}/refresh"><button type="submit">Refresh</button></form>
      <form method="post" action="/feeds/${f.id}/delete" class="js-confirm" data-confirm="Delete this feed and its articles?"><button type="submit" class="danger">Delete</button></form>
    </td>
  </tr>`
  )}
  </tbody>
</table>`;
}

/** @param {{ topics: any[], error?: string }} p */
export function topicsPage(p) {
  return html`<h1>Topics</h1>
${p.error ? html`<p class="flash error">${p.error}</p>` : ''}
<form method="post" action="/topics" class="card add">
  <label>New topic <input type="text" name="name" required maxlength="50"></label>
  <button type="submit">Add topic</button>
</form>
<table class="feeds">
  <thead><tr><th>Name</th><th>Feeds</th><th></th></tr></thead>
  <tbody>
  ${p.topics.map(
    (t) => html`<tr>
    <td>
      <form method="post" action="/topics/${t.id}" class="inline">
        <input type="text" name="name" value="${t.name}" required maxlength="50" aria-label="Topic name">
        <button type="submit">Rename</button>
      </form>
    </td>
    <td>${t.feed_count}</td>
    <td class="row-actions">
      <form method="post" action="/topics/${t.id}/delete" class="js-confirm" data-confirm="Delete this topic? Its feeds are kept without a topic."><button type="submit" class="danger">Delete</button></form>
    </td>
  </tr>`
  )}
  </tbody>
</table>`;
}

/** @param {number} status @param {string} message */
export function errorPage(status, message) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${status}</title>
<link rel="stylesheet" href="/app.css"></head><body><main class="solo"><h1>${status}</h1><p>${message}</p>
<p><a href="/">Back</a></p></main></body></html>`;
}
