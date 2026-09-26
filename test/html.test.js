import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { html, raw, escapeHtml, safeUrl } from '../src/html.js';
import { parseFeed } from '../src/parser.js';
import { articleItem, feedBadge, feedsPage, layout, muteForm } from '../src/views.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('escapeHtml escapes all five special characters', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});

test('html template escapes interpolations by default', () => {
  const evil = '<script>alert(1)</script>';
  assert.equal(html`<p>${evil}</p>`.toString(), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(html`<p title="${'" onmouseover="x'}"></p>`.toString(), '<p title="&quot; onmouseover=&quot;x"></p>');
});

test('nested templates, arrays, raw() and empty values', () => {
  const items = ['<a>', '<b>'].map((x) => html`<li>${x}</li>`);
  assert.equal(html`<ul>${items}</ul>`.toString(), '<ul><li>&lt;a&gt;</li><li>&lt;b&gt;</li></ul>');
  assert.equal(html`${raw('<br>')}`.toString(), '<br>');
  assert.equal(html`${null}${undefined}${false}${0}`.toString(), '0');
});

test('safeUrl only allows http(s)', () => {
  assert.equal(safeUrl('https://example.invalid/a?b=1'), 'https://example.invalid/a?b=1');
  assert.equal(safeUrl('http://example.invalid'), 'http://example.invalid/');
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', '/relative', '', null, 'java\tscript:alert(1)']) {
    assert.equal(safeUrl(bad), '#', String(bad));
  }
});

test('evil feed renders without executable markup', () => {
  const feed = parseFeed(fixture('evil.xml'));
  const out = feed.items
    .map((item, i) =>
      articleItem({
        id: i + 1,
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        author: item.author,
        published_at: item.publishedAt,
        is_read: 0,
        is_starred: 0,
        feed_id: 1,
        feed_title: feed.title,
        topic_id: 1,
        topic_name: '<b>topic</b>',
      }).toString()
    )
    .join('\n');

  // No tags other than the ones our template emits.
  const tags = new Set([...out.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()));
  const allowed = new Set(['a', 'article', 'button', 'div', 'form', 'h2', 'p', 'span', 'time']);
  for (const tag of tags) assert.ok(allowed.has(tag), `unexpected tag <${tag}>`);
  assert.doesNotMatch(out, /<(script|img|svg|iframe)/i);
  // No event-handler attributes on any real tag (escaped text can't contain "<", so every <...> is ours).
  for (const [tag] of out.matchAll(/<[a-z][^>]*>/gi)) {
    assert.doesNotMatch(tag, /\son\w+\s*=/i, `event handler attribute in ${tag}`);
  }
  for (const m of out.matchAll(/href="([^"]*)"/g)) {
    assert.match(m[1], /^(#|https?:\/\/|\/\?|\/mute\/new\?article=\d+$)/, `unsafe href: ${m[1]}`);
  }
  // The attribute-breakout link must stay inside its quoted attribute.
  assert.match(out, /href="https:\/\/ok\.example\/%22onmouseover=%22alert\(10\)"/);
});

test('feeds page and layout escape feed/topic names', () => {
  const evil = '"><script>alert(1)</script>';
  const page = layout({
    title: evil,
    active: 'feeds',
    topics: [{ id: 1, name: evil, unread: 3 }],
    totalUnread: 3,
    version: evil,
    assetVersion: 'abc12345',
    body: feedsPage({
      feeds: [{ id: 1, url: 'javascript:alert(1)', site_url: '', title: evil, topic_id: 1, enabled: 1, article_count: 0, last_error: evil, error_count: 1 }],
      topics: [{ id: 1, name: evil }],
      error: evil,
      formUrl: evil,
      pushKey: evil,
      devices: [{ id: 7, host: evil, createdAt: Date.now(), lastError: evil }],
      muteRules: [{ id: 3, feed_id: 1, feed_title: evil, field: 'title', pattern: evil, hidden_count: 2 }],
      userEmail: evil,
    }),
  }).toString();
  assert.doesNotMatch(page, /<script>alert/);
  // The signed-in email is shown on the Feeds page only, escaped (not just absent).
  const escaped = '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;';
  assert.ok(page.includes(`<p class="sub who">Signed in as ${escaped}</p>`), 'email on the feeds page, escaped');
  assert.doesNotMatch(page.slice(0, page.indexOf('<main>')), /Signed in as/, 'not in the header');
  assert.match(page, /<script src="\/theme\.js\?v=abc12345"><\/script>/);
  assert.match(page, /<script type="module" src="\/app\.js\?v=abc12345"><\/script>/);
  assert.match(page, /<link rel="stylesheet" href="\/app\.css\?v=abc12345">/);
  assert.equal(page.match(/<script/g).length, 2, 'only our own two script tags');
});

test('Brave button: hidden link to the checked article URL, none without a URL', () => {
  const base = { id: 7, title: 'T', feed_id: 1, feed_title: 'F', published_at: 0, is_read: 0, is_starred: 0 };
  const item = articleItem({ ...base, url: 'https://news.x.test/a?b=1&c=2' }).toString();
  assert.match(item, /<a class="open-brave" href="https:\/\/news\.x\.test\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer" hidden>/);
  assert.doesNotMatch(articleItem({ ...base, url: 'javascript:alert(1)' }).toString(), /open-brave/, 'no button for unsafe links');
  assert.doesNotMatch(articleItem({ ...base, url: '' }).toString(), /open-brave/);
});

test('feed badge: first letter or digit, colour class fixed per feed id, escaped', () => {
  assert.equal(feedBadge(13, 'heise online').toString(), '<span class="badge feed-c3" aria-hidden="true">H</span>');
  assert.match(feedBadge(13, 'other').toString(), /feed-c3/, 'same feed, same colour');
  assert.match(feedBadge(7, '„Überblick“').toString(), />Ü</, 'skips leading punctuation');
  assert.match(feedBadge(1, '<b>').toString(), />B</, 'markup characters never become the letter');
  assert.match(feedBadge(1, '').toString(), />•</, 'fallback without a title');
  assert.match(feedBadge(/** @type {any} */ ('x" onclick="y'), 'T').toString(), /class="badge feed-c0"/, 'class contains only a number');
  const item = articleItem({ id: 1, title: 'T', url: '', feed_id: 2, feed_title: 'Feed', published_at: 0, is_read: 0, is_starred: 0 }).toString();
  assert.match(item, /<a class="feed" href="\/\?feed=2" title="Feed"><span class="badge feed-c2" aria-hidden="true">F<\/span><span class="name">Feed<\/span><\/a>/);
});

test('article actions: short Read/Unread labels and a Mute link to the form', () => {
  const base = { id: 7, title: 'T', url: '', feed_id: 1, feed_title: 'F', published_at: 0, is_starred: 0 };
  assert.match(articleItem({ ...base, is_read: 0 }).toString(), />Read<\/button>/);
  assert.match(articleItem({ ...base, is_read: 1 }).toString(), />Unread<\/button>/);
  assert.match(articleItem({ ...base, is_read: 0 }).toString(), /<a class="btn" href="\/mute\/new\?article=7"/);
});

test('mute form escapes article data and the pattern', () => {
  const evil = '"><script>alert(1)</script>';
  const out = muteForm({
    article: { id: 3, title: evil, url: evil, feed_id: 1, feed_title: evil },
    field: 'title',
    pattern: evil,
    scope: 'feed',
    preview: { feed: 1, all: 2 },
    error: evil,
  }).toString();
  assert.doesNotMatch(out, /<script>alert/);
  assert.match(out, /name="pattern" value="&quot;&gt;&lt;script&gt;/);
  assert.match(out, /href="\/mute\/new\?article=3&amp;field=url"/);
  assert.match(out, /value="feed" checked/);
});
