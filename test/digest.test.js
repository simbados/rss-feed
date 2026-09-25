import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, digestDueDate, localDateHour, siteName } from '../src/digest.js';
import { parseSubscription } from '../src/push.js';

test('digest is due from 19:00 Berlin time, in summer (UTC+2) and winter (UTC+1), once per day', () => {
  assert.equal(digestDueDate(Date.UTC(2026, 6, 1, 16, 59), null), null, 'summer 18:59');
  assert.equal(digestDueDate(Date.UTC(2026, 6, 1, 17, 0), null), '2026-07-01', 'summer 19:00');
  assert.equal(digestDueDate(Date.UTC(2026, 11, 1, 17, 30), null), null, 'winter 18:30');
  assert.equal(digestDueDate(Date.UTC(2026, 11, 1, 18, 0), null), '2026-12-01', 'winter 19:00');
  assert.equal(digestDueDate(Date.UTC(2026, 11, 1, 21, 30), '2026-12-01'), null, 'already sent today');
  assert.equal(digestDueDate(Date.UTC(2026, 11, 1, 23, 30), '2026-12-01'), null, '00:30 next day is before 19:00');
  assert.deepEqual(localDateHour(Date.UTC(2026, 9, 25, 0, 30), 'Europe/Berlin'), { date: '2026-10-25', hour: 2 }, 'DST ends');
});

test('buildDigest: short title, site domains by count, feeds of one site added up, nothing new → null', () => {
  assert.equal(buildDigest([]), null);
  assert.equal(buildDigest([{ title: 'a', count: 0 }]), null);
  assert.deepEqual(
    buildDigest([
      { title: 'tagesschau.de - Die Nachrichten der ARD', siteUrl: 'https://www.tagesschau.invalid/', count: 2 },
      { title: 'heise online News', siteUrl: 'https://www.heise.invalid/', count: 12 },
      { title: 'Lebensmittelwarnung.de - Bayern - Alle Produkttypen', siteUrl: 'https://www.lmw.invalid/', count: 100 },
      { title: 'Lebensmittelwarnung.de - Berlin - Alle Produkttypen', siteUrl: 'https://www.lmw.invalid/', count: 5 },
    ]),
    { title: '119 new', body: 'lmw.invalid 105 · heise.invalid 12 · tagesschau.invalid 2', url: '/', tag: 'daily-digest' }
  );
});

test('buildDigest: at most five sites, the rest as "+N more"', () => {
  const d = buildDigest(Array.from({ length: 8 }, (_, i) => ({ title: `F${i}`, siteUrl: `https://s${i}.invalid/`, count: 8 - i })));
  assert.equal(d.title, '36 new');
  assert.equal(d.body, 's0.invalid 8 · s1.invalid 7 · s2.invalid 6 · s3.invalid 5 · s4.invalid 4 · +3 more');
});

test('siteName: site URL, else feed URL, else title', () => {
  assert.equal(siteName({ title: 'T', siteUrl: 'https://www.a.invalid/x', feedUrl: 'https://b.invalid/feed' }), 'a.invalid');
  assert.equal(siteName({ title: 'T', siteUrl: '', feedUrl: 'https://feeds.b.invalid/rss' }), 'feeds.b.invalid');
  assert.equal(siteName({ title: 'Only a title' }), 'Only a title');
});

test('parseSubscription accepts a real-looking subscription and rejects everything else', () => {
  const good = {
    endpoint: 'https://web.push.apple.com/QGuQyavXutnMH',
    keys: {
      p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
      auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    },
  };
  assert.deepEqual(parseSubscription(good), { endpoint: good.endpoint, ...good.keys });
  assert.equal(parseSubscription({ ...good, endpoint: 'http://web.push.apple.com/x' }), null, 'https only');
  assert.equal(parseSubscription({ ...good, endpoint: 'https://attacker.example/collect' }), null, 'only known push services');
  assert.equal(parseSubscription({ ...good, endpoint: 'https://web.push.apple.com.attacker.example/x' }), null);
  assert.ok(parseSubscription({ ...good, endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }), 'Chrome');
  assert.ok(parseSubscription({ ...good, endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc' }), 'Firefox');
  assert.ok(parseSubscription({ ...good, endpoint: 'https://wns2-par02p.notify.windows.com/w/?token=abc' }), 'Edge');
  assert.equal(parseSubscription({ ...good, endpoint: 'javascript:alert(1)' }), null);
  assert.equal(parseSubscription({ ...good, keys: { ...good.keys, auth: 'short' } }), null);
  assert.equal(parseSubscription({ ...good, keys: { p256dh: 42, auth: good.keys.auth } }), null);
  assert.equal(parseSubscription(null), null);
});
