import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPattern, isMuteField, matchRule, normalize, urlPattern, MAX_PATTERN } from '../src/mute.js';

test('normalize: Unicode lower case, whitespace collapsed', () => {
  assert.equal(normalize('  TAGESSCHAU   in\n100 Sekunden '), 'tagesschau in 100 sekunden');
  assert.equal(normalize('ÜBERBLICK Straße'), 'überblick straße');
  assert.equal(normalize(null), '');
});

test('cleanPattern: 2–200 characters after normalising', () => {
  assert.equal(cleanPattern('  a '), null);
  assert.equal(cleanPattern('ab'), 'ab');
  assert.equal(cleanPattern('x'.repeat(MAX_PATTERN)), 'x'.repeat(MAX_PATTERN));
  assert.equal(cleanPattern('x'.repeat(MAX_PATTERN + 1)), null);
});

test('matchRule: title and URL, case-insensitive substring, first rule wins', () => {
  const rules = [
    { id: 1, field: 'url', pattern: '/100sekunden' },
    { id: 2, field: 'title', pattern: 'tagesschau in 100 sekunden' },
    { id: 3, field: 'title', pattern: 'tagesschau' },
  ];
  assert.equal(matchRule(rules, { title: 'Tagesschau  in 100 Sekunden, 12:00 Uhr', url: 'https://x.test/v/1' }), 2);
  assert.equal(matchRule(rules, { title: 'Anything', url: 'https://x.test/100SEKUNDEN/1' }), 1);
  assert.equal(matchRule(rules, { title: 'Die Tagesschau berichtet', url: '' }), 3);
  assert.equal(matchRule(rules, { title: 'Wetter', url: 'https://x.test/a' }), null);
  assert.equal(matchRule([], { title: 'x', url: '' }), null);
});

test('matchRule: patterns are plain text, not regex', () => {
  assert.equal(matchRule([{ id: 1, field: 'title', pattern: '.*' }], { title: 'anything', url: '' }), null);
  assert.equal(matchRule([{ id: 1, field: 'title', pattern: '(a+)+$' }], { title: 'a'.repeat(40) + '!', url: '' }), null);
  assert.equal(matchRule([{ id: 1, field: 'title', pattern: '50%_off' }], { title: 'Now 50%_OFF', url: '' }), 1);
});

test('isMuteField and urlPattern', () => {
  assert.ok(isMuteField('title') && isMuteField('url'));
  assert.ok(!isMuteField('snippet') && !isMuteField(null));
  assert.equal(urlPattern('https://news.x.test/multimedia/100s/video-1.html?x=1#t'), '/multimedia/100s/');
  assert.equal(urlPattern('https://news.x.test/video-1.html'), '/video-1.html', 'no directory: the path');
  assert.equal(urlPattern('not a url'), '');
});
