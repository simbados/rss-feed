import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_SVG, MANIFEST } from '../src/static.js';
import { layout } from '../src/views.js';

test('manifest makes the app installable in standalone mode', () => {
  const m = JSON.parse(MANIFEST);
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.ok(m.name && m.short_name);
  assert.deepEqual(m.icons.map((i) => i.src), ['/icon-192.png', '/icon-512.png', '/icon-512-maskable.png', '/icon.svg']);
});

test('icon is a self-contained SVG without script or external references', () => {
  assert.match(ICON_SVG, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 512 512">/);
  assert.doesNotMatch(ICON_SVG, /<script|\bon[a-z]+=|href=|<text/i);
});

test('manifest is linked with credentials (else Access blocks it) and allowed by the CSP', () => {
  const page = layout({ title: 't', active: 'home', topics: [], totalUnread: 0, version: 'v', body: '' }).toString();
  assert.match(page, /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials">/);
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /"manifest-src 'self'"/);
});

import { SW_JS } from '../src/static.js';

test('PNG icons are valid PNGs of the advertised sizes, and imported by the Worker', () => {
  const sizes = { '/apple-touch-icon.png': 180, '/icon-192.png': 192, '/icon-512.png': 512, '/icon-512-maskable.png': 512 };
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  for (const path of Object.keys(sizes)) {
    assert.match(index, new RegExp(`\\['${path.replace('.', '\\.')}', \\w+\\]`), `${path} served by src/index.js`);
    assert.match(index, new RegExp(`from '\\./icons${path.replace('.', '\\.')}'`), `${path} imported by src/index.js`);
  }
  for (const [path, size] of Object.entries(sizes)) {
    const png = readFileSync(new URL(`../src/icons${path}`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], path);
    assert.equal(png.readUInt32BE(16), size, `${path} width`);
    assert.equal(png.readUInt32BE(20), size, `${path} height`);
  }
  const m = JSON.parse(MANIFEST);
  for (const i of m.icons.filter((i) => i.type === 'image/png')) assert.ok(i.src in sizes, i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
});

test('CSP allows our service worker and only the sw-url Trusted Types policy', () => {
  const index = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(index, /"worker-src 'self'"/);
  assert.match(index, /'trusted-types sw-url'/);
});

/** Runs SW_JS with a fake service worker scope. */
function loadServiceWorker() {
  const handlers = {};
  const opened = [];
  const shown = [];
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    location: { origin: 'https://rss.example.invalid' },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (u) => opened.push(u) },
    registration: { showNotification: async (title, options) => shown.push({ title, options }) },
  };
  new Function('self', SW_JS)(self);
  const fire = async (type, event) => {
    let done;
    handlers[type]({ ...event, waitUntil: (p) => (done = p) });
    await done;
  };
  return { fire, opened, shown };
}

test('service worker shows the pushed message', async () => {
  const sw = loadServiceWorker();
  await sw.fire('push', { data: { json: () => ({ title: 'RSS: 3 new', body: 'heise 3', url: '/', tag: 'daily-digest' }) } });
  assert.equal(sw.shown[0].title, 'RSS: 3 new');
  assert.equal(sw.shown[0].options.body, 'heise 3');
  assert.deepEqual(sw.shown[0].options.data, { url: '/' });

  await sw.fire('push', { data: { json: () => { throw new Error('not json'); } } });
  assert.equal(sw.shown[1].title, 'RSS', 'fallback title for a broken message');
});

test('notification click opens only paths on this site', async () => {
  for (const [url, expected] of [
    ['/?feed=3', '/?feed=3'],
    ['https://rss.example.invalid/feeds', '/feeds'],
    ['https://evil.example/phish', '/'],
    ['javascript:alert(1)', '/'],
    [undefined, '/'],
  ]) {
    const sw = loadServiceWorker();
    await sw.fire('notificationclick', { notification: { close() {}, data: { url } } });
    assert.deepEqual(sw.opened, [expected], String(url));
  }
});

import { CSS, THEME_JS } from '../src/static.js';

test('full-screen viewport and theme-color tags matching the page background', () => {
  const page = layout({ title: 't', active: 'home', topics: [], totalUnread: 0, version: 'v', body: '' }).toString();
  assert.match(page, /<meta name="viewport" content="[^"]*viewport-fit=cover">/);
  const light = CSS.match(/:root \{\s*--bg: (#[0-9a-f]{6})/)[1];
  const dark = CSS.match(/:root\[data-theme="dark"\] \{ --bg: (#[0-9a-f]{6})/)[1];
  assert.match(page, new RegExp(`<meta name="theme-color" content="${light}" media="\\(prefers-color-scheme: light\\)" data-scheme="light">`));
  assert.match(page, new RegExp(`<meta name="theme-color" content="${dark}" media="\\(prefers-color-scheme: dark\\)" data-scheme="dark">`));
  assert.ok(THEME_JS.includes(`light: '${light}'`) && THEME_JS.includes(`dark: '${dark}'`), 'theme.js uses the same colours');
  assert.match(CSS, /env\(safe-area-inset-top\)/);
});

test('rssSetTheme: forced theme sets both theme-color tags, auto restores them', () => {
  const metas = [
    { content: '#fafaf9', dataset: { scheme: 'light' } },
    { content: '#161412', dataset: { scheme: 'dark' } },
  ];
  const root = { dataset: {} };
  const window = {};
  const document = { documentElement: root, querySelectorAll: () => metas };
  const localStorage = { getItem: () => 'dark' };
  new Function('window', 'document', 'localStorage', THEME_JS)(window, document, localStorage);

  assert.equal(root.dataset.theme, 'dark', 'saved theme applied on load');
  assert.deepEqual(metas.map((m) => m.content), ['#161412', '#161412']);
  window.rssSetTheme('light');
  assert.deepEqual(metas.map((m) => m.content), ['#fafaf9', '#fafaf9']);
  window.rssSetTheme('');
  assert.equal(root.dataset.theme, undefined);
  assert.deepEqual(metas.map((m) => m.content), ['#fafaf9', '#161412'], 'auto: each tag back to its own scheme');
});
