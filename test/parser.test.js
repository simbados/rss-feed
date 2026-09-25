import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFeed, discoverFeeds, decodeEntities, htmlToText, isTemplatePlaceholder, NotAFeedError } from '../src/parser.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('RSS 2.0: channel metadata', () => {
  const f = parseFeed(fixture('rss2.xml'), 'https://news.example.com/feed.xml');
  assert.equal(f.format, 'rss');
  assert.equal(f.title, 'Example News & More');
  assert.equal(f.siteUrl, 'https://news.example.com/');
  assert.equal(f.items.length, 3, 'commented-out item is ignored');
});

test('RSS 2.0: items', () => {
  const [a, b, c] = parseFeed(fixture('rss2.xml'), 'https://news.example.com/feed.xml').items;
  assert.equal(a.title, 'First headline');
  assert.equal(a.url, 'https://news.example.com/a/1');
  assert.equal(a.guid, 'news-1');
  assert.equal(a.author, 'Jane Doe');
  assert.equal(a.snippet, 'Body with markup & an entity.');
  assert.equal(a.publishedAt, Date.UTC(2025, 5, 10, 4, 0, 0));

  assert.equal(b.title, 'Second: CDATA title with inside', 'CDATA with </item> does not split the item');
  assert.equal(b.url, 'https://news.example.com/a/2', 'permalink guid used as link');
  assert.equal(b.snippet, 'Escaped HTML description');
  assert.equal(b.publishedAt, Date.UTC(2025, 5, 11, 7, 30, 0));

  assert.equal(c.url, 'https://news.example.com/a/3', 'relative link resolved');
  assert.equal(c.publishedAt, null);
});

test('Atom', () => {
  const f = parseFeed(fixture('atom.xml'), 'https://blog.example.org/atom.xml');
  assert.equal(f.format, 'atom');
  assert.equal(f.title, 'Example Blog');
  assert.equal(f.siteUrl, 'https://blog.example.org/');
  const [a, b] = f.items;
  assert.equal(a.title, 'Atom <3 entry');
  assert.equal(a.url, 'https://blog.example.org/posts/1', 'rel=alternate preferred over rel=edit');
  assert.equal(a.guid, 'tag:blog.example.org,2025:1');
  assert.equal(a.author, 'Entry Author');
  assert.equal(a.snippet, 'Short summary.');
  assert.equal(a.publishedAt, Date.UTC(2025, 5, 12, 18, 30, 2), 'published preferred over updated');
  assert.equal(b.url, 'https://blog.example.org/posts/2');
  assert.equal(b.snippet, 'Content only');
  assert.equal(b.publishedAt, Date.UTC(2025, 5, 14, 6, 0, 0));
});

test('RSS 1.0 / RDF', () => {
  const f = parseFeed(fixture('rdf.xml'));
  assert.equal(f.format, 'rdf');
  assert.equal(f.title, 'RDF Site');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].url, 'https://rdf.example.net/story/1');
  assert.equal(f.items[0].guid, 'https://rdf.example.net/story/1');
  assert.equal(f.items[0].publishedAt, Date.UTC(2025, 5, 1, 12));
});

test('non-feeds are rejected', () => {
  assert.throws(() => parseFeed(fixture('page.html')), NotAFeedError);
  assert.throws(() => parseFeed('{"json": true}'), NotAFeedError);
});

test('format comes from the root element only', () => {
  // An HTML page that mentions feed tags in its text is still an HTML page.
  const page = '<!doctype html><html><head><script>const x = "<rss><item><title>t</title></item></rss>";</script></head></html>';
  assert.throws(() => parseFeed(page), NotAFeedError);
  // Prolog, stylesheet instruction, doctype and comments before the root are skipped.
  const rss = '<?xml version="1.0"?>\n<?xml-stylesheet href="s.xsl"?>\n<!DOCTYPE rss>\n<!-- hi -->\n<RSS version="2.0"><channel><title>T</title></channel></RSS>';
  assert.equal(parseFeed(rss).format, 'rss');
});

test('feed discovery from HTML', () => {
  assert.deepEqual(discoverFeeds(fixture('page.html'), 'https://site.example/blog/'), [
    'https://site.example/feed.xml',
    'https://site.example/atom.xml',
    'https://site.example/minified.xml',
  ]);
});

test('feed discovery accepts unquoted attributes (minified HTML)', () => {
  assert.deepEqual(
    discoverFeeds('<head><link rel=alternate type=application/atom+xml href=https://m.example/a.xml></head>', 'https://m.example/'),
    ['https://m.example/a.xml']
  );
});

test('entity decoding', () => {
  assert.equal(decodeEntities('a &amp; b &lt;&gt; &#39;&#x27; &hellip; &bogus;'), "a & b <> '' … &bogus;");
  assert.equal(decodeEntities('&#0;&#xD800;&#x110000;'), '', 'invalid code points dropped');
});

test('htmlToText drops scripts and styles entirely', () => {
  assert.equal(htmlToText('<p>a</p><script>evil()</script><style>x{}</style><p>b</p>'), 'a b');
});

test('evil feed: parser output is plain text (escaping still required on output)', () => {
  const f = parseFeed(fixture('evil.xml'));
  assert.equal(f.items.length, 3);
  const [first] = f.items;
  // Real <script>/<img> elements are removed with their content...
  assert.doesNotMatch(first.snippet, /alert\(2\)|alert\(3\)|onerror/);
  // ...while entity-encoded text stays as literal text (views escape it on output).
  assert.equal(first.snippet, '<script>alert(4)</script> x');
  // javascript:/data: URLs survive parsing as data; views must neutralise them with safeUrl().
  assert.equal(f.items[0].url, 'javascript:alert(document.cookie)');
});

const LMW_URL =
  'https://www.lebensmittelwarnung.de/___LMW-Redaktion/RSSNewsfeed/Functions/RssFeeds/rssnewsfeed_Alle_DE.xml?nn=314268&state=bayern';

test('lebensmittelwarnung.de: titles rebuilt from the labelled description fields', () => {
  const [a, b, c] = parseFeed(fixture('lebensmittelwarnung.xml'), LMW_URL).items;
  assert.equal(a.title, 'Gefrorene Austern, 226 Gramm, Surasang Frozen oysters (I:Q:F:) Huitre Congelee – Krankheitserreger');
  assert.equal(
    a.snippet,
    'Grund: Krankheitserreger · Haltbarkeit: Mindesthaltbarkeitsdatum: alle Mindesthaltbarkeitsdaten vom 08.04.2027 bis 04.05.2027 · Charge: 87703 01180'
  );
  assert.equal(b.title, 'Metzgerfrisch Frische Grobe Bratwurst 400 Gramm – Fremdkörper');
  assert.equal(b.snippet, 'Grund: Fremdkörper · Haltbarkeit: Metzgerfrisch Frische Grobe Bratwurst 400 Gramm: Mindesthaltbarkeitsdatum 15.09.2026', 'missing fields are skipped');
  assert.equal(c.title, 'Rückruf: Beispielkäse', 'a real title is kept once the source is fixed');
});

test('template placeholder titles fall back to the URL on other hosts', () => {
  const [a] = parseFeed(fixture('lebensmittelwarnung.xml'), 'https://mirror.example.com/feed.xml').items;
  assert.equal(a.title, a.url);
  assert.match(a.snippet, /^Bildquelle/, 'no site rule applied');
});

test('isTemplatePlaceholder', () => {
  for (const s of ['$esc.escapeXml($cms.oneLineText($m.title))', '$m.title', '${title}', '$!{item.title}', '{{ title }}']) {
    assert.ok(isTemplatePlaceholder(s), s);
  }
  for (const s of ['$TSLA', '$5 off everything', 'Price in $ (USD)', 'Why {{mustache}} templates are fine']) {
    assert.ok(!isTemplatePlaceholder(s), s);
  }
});
