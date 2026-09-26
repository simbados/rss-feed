// Client modules (src/client/*.js), imported directly and run against small fakes instead of a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { renderArticle, renderCounts, setUpArticles } from '../src/client/articles.js';
import { setUpAutoRefresh, STALE_AFTER_MS } from '../src/client/refresh.js';
import { createStore, merge } from '../src/client/store.js';
import { CLIENT_MODULES, versionImports } from '../src/static.js';

// Store

test('store: merge is deep for objects, replaces everything else, never mutates', () => {
  const a = { articles: { 1: { is_read: 0, is_starred: 1 } }, counts: { total: 5, topics: { 3: 2 } }, list: [1] };
  const b = merge(a, { articles: { 1: { is_read: 1 }, 2: { is_read: 0 } }, counts: { total: 4 }, list: [2] });
  assert.deepEqual(b, {
    articles: { 1: { is_read: 1, is_starred: 1 }, 2: { is_read: 0 } },
    counts: { total: 4, topics: { 3: 2 } },
    list: [2],
  });
  assert.equal(a.articles[1].is_read, 0, 'original unchanged');
});

test('store: subscribers get the new state and the patch; unsubscribe stops them', () => {
  const store = createStore({ counts: { total: 2 } });
  const calls = [];
  const off = store.subscribe((state, patch) => calls.push([state.counts.total, patch]));
  store.set({ counts: { total: 1 } });
  off();
  store.set({ counts: { total: 0 } });
  assert.deepEqual(calls, [[1, { counts: { total: 1 } }]]);
  assert.equal(store.get().counts.total, 0);
});

// A tiny fake DOM: just what the article code touches.

class FakeElement {
  constructor(tag, { classes = [], dataset = {}, attrs = {}, parent = null, text = '' } = {}) {
    Object.assign(this, { tag, dataset, attrs, parent, textContent: text, hidden: false, removed: false, children: [] });
    this.classes = new Set(classes);
    this.classList = {
      contains: (c) => this.classes.has(c),
      toggle: (c, on) => (on ? this.classes.add(c) : this.classes.delete(c)),
    };
    parent?.children.push(this);
  }
  getAttribute(name) {
    return this.attrs[name] ?? null;
  }
  remove() {
    this.removed = true;
  }
  matches(selector) {
    if (selector === 'article[data-id]') return this.tag === 'article' && Boolean(this.dataset.id);
    if (selector === 'button[data-kind]') return this.tag === 'button' && Boolean(this.dataset.kind);
    const [tag, cls] = selector.split('.');
    return this.tag === tag && this.classes.has(cls);
  }
  closest(selectors) {
    for (let el = this; el; el = el.parent) if (selectors.split(',').some((s) => el.matches(s.trim()))) return el;
    return null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
}

function page({ standalone = false, reply, fail = false } = {}) {
  const root = new FakeElement('body');
  const article = new FakeElement('article', { dataset: { id: '7' }, parent: root });
  const title = new FakeElement('a', { classes: ['title'], attrs: { href: 'https://news.x.test/a?b=1&c' }, parent: article });
  const brave = new FakeElement('a', { classes: ['open-brave'], attrs: { href: 'https://news.x.test/a?b=1&c' }, parent: article });
  brave.hidden = true;
  const readBtn = new FakeElement('button', { dataset: { kind: 'read' }, parent: article, text: 'Read' });
  readBtn.form = { action: '/articles/7/read' };
  const total = new FakeElement('span', { dataset: { count: 'total' }, parent: root, text: '5' });
  const topic = new FakeElement('span', { dataset: { count: 'topic:3' }, parent: root, text: '2' });
  const other = new FakeElement('span', { dataset: { count: 'topic:4' }, parent: root, text: '3' });

  const handlers = {};
  const document = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    querySelector: (s) => (s === 'article[data-id="7"]' && !article.removed ? article : null),
    querySelectorAll: (s) => (s === '[data-count]' ? [total, topic, other] : root.querySelectorAll(s)),
  };
  const window = { matchMedia: () => ({ matches: standalone }) };
  const location = { href: 'https://rss.x.test/' };
  const posted = [];
  const post = async (url) => {
    posted.push(url);
    if (fail) throw new Error('HTTP 500');
    return reply ?? { articles: { 7: { is_read: 1, is_starred: 0, is_hidden: 0 } }, counts: { total: 4, topics: { 3: 1, 4: 3 } } };
  };
  const store = createStore();
  setUpArticles({ document, window, location, store, post });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const click = async (target) => {
    let prevented = false;
    handlers.click({ target, preventDefault: () => (prevented = true) });
    await tick();
    return prevented;
  };
  const submit = async (form) => {
    handlers.submit({ target: form, preventDefault() {} });
    await tick();
  };
  return { article, title, brave, readBtn, total, topic, other, location, posted, click, submit, store };
}

// Articles and counts

test('Read button: the reply updates the article and the sidebar counts', async () => {
  const p = page();
  await p.submit({ classList: { contains: (c) => c === 'js-action' }, action: '/articles/7/read' });
  assert.deepEqual(p.posted, ['/articles/7/read']);
  assert.ok(p.article.classes.has('is-read'));
  assert.equal(p.readBtn.textContent, 'Unread');
  assert.equal(p.readBtn.form.action, '/articles/7/unread');
  assert.deepEqual([p.total.textContent, p.topic.textContent, p.other.textContent], ['4', '1', '3']);
  assert.equal(p.store.get().counts.total, 4, 'the reply is in the store');
});

test('Hide: the article is removed, counts follow the reply', async () => {
  const p = page({ reply: { articles: { 7: { is_read: 1, is_starred: 0, is_hidden: 1 } }, counts: { total: 4, topics: { 3: 1 } } } });
  await p.submit({ classList: { contains: (c) => c === 'js-action' }, action: '/articles/7/hide' });
  assert.ok(p.article.removed);
  assert.equal(p.total.textContent, '4');
});

test('a failed action falls back to a normal form post and leaves the page as it was', async () => {
  const p = page({ fail: true });
  let submitted = false;
  const form = { classList: { contains: (c) => c === 'js-action' }, action: '/articles/7/star', submit: () => (submitted = true) };
  await p.submit(form);
  assert.deepEqual(p.posted, ['/articles/7/star']);
  assert.ok(submitted);
  assert.equal(p.total.textContent, '5', 'counts unchanged');
  assert.ok(!p.article.classes.has('is-read'), 'article unchanged');
});

test('renderCounts ignores unknown and missing values; renderArticle only touches its buttons', () => {
  const el = { dataset: { count: 'topic:9' }, textContent: '7' };
  renderCounts({ querySelectorAll: () => [el] }, { total: 1, topics: { 3: 0 } });
  assert.equal(el.textContent, '7', 'no value for this topic → unchanged');
  const p = page();
  renderArticle(p.article, { is_read: 0, is_starred: 1 });
  assert.ok(p.article.classes.has('is-starred') && !p.article.classes.has('is-read'));
});

test('Brave button: visible only in the installed app', () => {
  assert.equal(page({ standalone: true }).brave.hidden, false);
  assert.equal(page({ standalone: false }).brave.hidden, true);
});

test('Brave button: opens the article in Brave and marks it read', async () => {
  const p = page({ standalone: true });
  assert.equal(await p.click(p.brave), true, 'default navigation replaced');
  assert.equal(p.location.href, 'brave://open-url?url=' + encodeURIComponent('https://news.x.test/a?b=1&c'));
  assert.deepEqual(p.posted, ['/articles/7/read']);
  assert.ok(p.article.classes.has('is-read'));
  assert.equal(p.total.textContent, '4', 'counts updated too');
});

test('Brave button: only http(s) links are handed to Brave', async () => {
  for (const href of ['javascript:alert(1)', '#', 'brave://x', '']) {
    const p = page({ standalone: true });
    p.brave.attrs.href = href;
    assert.equal(await p.click(p.brave), false, `${href}: no navigation replaced`);
    assert.equal(p.location.href, 'https://rss.x.test/', href);
  }
});

test('title click: opens normally and marks the article read (once)', async () => {
  const p = page();
  assert.equal(await p.click(p.title), false, 'normal link navigation');
  assert.equal(p.location.href, 'https://rss.x.test/');
  await p.click(p.title);
  assert.deepEqual(p.posted, ['/articles/7/read'], 'already read → no second request');
});

// Auto-refresh

function refreshPage({ onLine = true, activeElement = null } = {}) {
  const docHandlers = {};
  const winHandlers = {};
  let now = 1_000_000;
  const replaced = [];
  const document = { hidden: false, activeElement, addEventListener: (type, fn) => (docHandlers[type] = fn) };
  const window = { addEventListener: (type, fn) => (winHandlers[type] = fn) };
  const location = { href: 'https://rss.x.test/feeds?x=1', replace: (url) => replaced.push(url) };
  setUpAutoRefresh({ document, window, navigator: { onLine }, location, now: () => now });
  const setVisible = (visible) => {
    document.hidden = !visible;
    docHandlers.visibilitychange();
  };
  return { replaced, setVisible, wait: (ms) => (now += ms), winHandlers };
}

const MIN = 60 * 1000;

test('auto-refresh: back after 5+ minutes in the background → same URL loaded again via GET', () => {
  const app = refreshPage();
  app.setVisible(false);
  app.wait(STALE_AFTER_MS + MIN);
  app.setVisible(true);
  assert.deepEqual(app.replaced, ['https://rss.x.test/feeds?x=1']);
});

test('auto-refresh: not after a short switch, not offline, not while typing', () => {
  const short = refreshPage();
  short.setVisible(false);
  short.wait(2 * MIN);
  short.setVisible(true);
  assert.deepEqual(short.replaced, []);

  const offline = refreshPage({ onLine: false });
  offline.setVisible(false);
  offline.wait(10 * MIN);
  offline.setVisible(true);
  assert.deepEqual(offline.replaced, []);

  const typing = refreshPage({ activeElement: { tagName: 'INPUT', value: 'https://feed.x.test/rss' } });
  typing.setVisible(false);
  typing.wait(10 * MIN);
  typing.setVisible(true);
  assert.deepEqual(typing.replaced, []);
});

test('auto-refresh: page restored from the back/forward cache', () => {
  const app = refreshPage();
  app.winHandlers.pagehide();
  app.wait(6 * MIN);
  app.winHandlers.pageshow({ persisted: true });
  assert.equal(app.replaced.length, 1);
});

// Serving

test('every module /app.js imports is served, with the page version added to the imports', () => {
  const app = CLIENT_MODULES.get('/app.js');
  const imports = [...app.matchAll(/from '\.\/([\w-]+\.js)'/g)].map((m) => '/' + m[1]);
  assert.ok(imports.length >= 4);
  for (const path of imports) assert.ok(CLIENT_MODULES.has(path), `${path} is served`);
  for (const [path, source] of CLIENT_MODULES) {
    for (const m of source.matchAll(/from '\.\/([\w-]+\.js)'/g)) assert.ok(CLIENT_MODULES.has('/' + m[1]), `${path} imports a served module`);
  }
  const versioned = versionImports(app, 'ab12');
  assert.match(versioned, /from '\.\/store\.js\?v=ab12';/);
  assert.doesNotMatch(versioned, /from '\.\/[\w-]+\.js';/, 'no import left without the version');
  assert.equal(versionImports(app, null), app, 'unversioned request: unchanged');
});

test('versionImports never puts arbitrary text into served JavaScript', () => {
  const app = CLIENT_MODULES.get('/app.js');
  for (const evil of ["';alert(1)//", 'a b', '../x', "x'"]) {
    assert.throws(() => versionImports(app, evil), /invalid asset version/, evil);
  }
  // The route passes the server's own deploy id, not the request's ?v=.
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /versionImports\(module, url\.searchParams\.has\('v'\) \? assetVersion\(env\) : null\)/);
  assert.doesNotMatch(index, /versionImports\([^)]*searchParams\.get/);
});

test('every client file is served (none forgotten in src/static.js)', () => {
  const files = readdirSync(new URL('../src/client/', import.meta.url));
  const staticJs = readFileSync(new URL('../src/static.js', import.meta.url), 'utf8');
  for (const f of files) assert.match(staticJs, new RegExp(`from '\\./client/${f.replace('.', '\\.')}'`), f);
});
