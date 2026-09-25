import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { html, raw, escapeHtml, safeUrl } from '../src/html.js';
import { parseFeed } from '../src/parser.js';
import { articleItem, feedsPage, layout } from '../src/views.js';

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
  assert.equal(safeUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeUrl('http://example.com'), 'http://example.com/');
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
    assert.match(m[1], /^(#|https?:\/\/|\/\?)/, `unsafe href: ${m[1]}`);
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
    body: feedsPage({
      feeds: [{ id: 1, url: 'javascript:alert(1)', site_url: '', title: evil, topic_id: 1, enabled: 1, article_count: 0, last_error: evil, error_count: 1 }],
      topics: [{ id: 1, name: evil }],
      error: evil,
      formUrl: evil,
    }),
  }).toString();
  assert.doesNotMatch(page, /<script>alert/);
  assert.match(page, /<script src="\/app\.js" defer><\/script>/, 'only our own script tag');
  assert.equal(page.match(/<script/g).length, 1);
});
