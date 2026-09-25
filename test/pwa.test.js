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
  assert.deepEqual(m.icons.map((i) => i.src), ['/icon.svg']);
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
