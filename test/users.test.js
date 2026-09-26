// Multi-user isolation against the real migration and SQL (node:sqlite, see helpers/d1.js).
// Two users with deliberately overlapping data: same feed URL, same topic names, same GUIDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/d1.js';
import * as db from '../src/db.js';
import { parseAllowedEmails, resolveUser } from '../src/users.js';
import { maybeSendDigest } from '../src/digest.js';

const FEED_URL = 'https://news.x.test/feed.xml';
const topicsOf = async (DB, user) => (await db.topicsWithCounts(DB, user)).topics;

async function setup() {
  const DB = createTestDb();
  const a = (await db.findOrCreateUser(DB, 'a@x.test')).id;
  const b = (await db.findOrCreateUser(DB, 'b@x.test')).id;
  const topicA = (await topicsOf(DB, a)).find((t) => t.name === 'News').id;
  const topicB = (await topicsOf(DB, b)).find((t) => t.name === 'News').id;
  const feedA = await db.insertFeed(DB, a, { url: FEED_URL, title: 'A news', siteUrl: '', topicId: topicA });
  const feedB = await db.insertFeed(DB, b, { url: FEED_URL, title: 'B news', siteUrl: '', topicId: topicB });
  const item = (n) => ({ guidHash: `g${n}`, url: `https://news.x.test/${n}`, title: `Item ${n}`, snippet: '', author: '', publishedAt: n, imageUrl: `https://img.x.test/${n}.jpg` });
  assert.equal(await db.insertArticles(DB, feedA.id, [item(1), item(2)]), 2);
  assert.equal(await db.insertArticles(DB, feedB.id, [item(1), item(2), item(3)]), 3, 'same GUIDs in another feed are kept');
  const articlesOf = async (user) => (await db.listArticles(DB, user, { filter: 'all', page: 0 })).articles;
  return { DB, a, b, topicA, topicB, feedA, feedB, articlesOf };
}

test('users: created on first login with default topics; email case-insensitive; no duplicates', async () => {
  const DB = createTestDb();
  const env = { DB, ALLOWED_EMAILS: 'person@example.test' };
  const first = await resolveUser(env, 'Person@Example.TEST');
  assert.equal(first.created, true);
  const id = first.id;
  assert.deepEqual(await resolveUser(env, 'person@example.test'), { id, created: false });
  assert.deepEqual(await db.findOrCreateUser(DB, 'person@example.test'), { id, created: false });
  assert.deepEqual((await topicsOf(DB, id)).map((t) => t.name), db.DEFAULT_TOPICS.slice().sort());
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM topics').get().n, db.DEFAULT_TOPICS.length);
});

test('users: a token without a usable email gets no user (fail closed)', async () => {
  const env = { DB: createTestDb(), ALLOWED_EMAILS: 'kate@x.test' };
  await resolveUser(env, 'kate@x.test');
  const odd = [
    '', '   ', 'not-an-email', undefined, 'x'.repeat(400) + '@x.test', 'a@@x.test',
    ' person@example.test', 'person@example.test ', 'a b@x.test', 'a@x\u0000.test',
    '\u212Aate@x.test', // Kelvin sign: JS toLowerCase() would turn it into "kate@x.test"
    'm\u00FCller@x.test', // non-ASCII is rejected, not guessed at
  ];
  for (const email of odd) {
    assert.deepEqual(await resolveUser(env, /** @type {any} */ (email)), { error: 'no-email' }, JSON.stringify(email));
  }
  assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'only kate exists');
});

test('allowlist: only emails on ALLOWED_EMAILS get a user; missing list locks everyone out', async () => {
  const DB = createTestDb();
  const count = () => DB.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const env = { DB, ALLOWED_EMAILS: ' Me@X.test,\n partner@x.test  , not-an-email ' };

  assert.equal((await resolveUser(env, 'me@x.test')).created, true, 'case and whitespace in the list are normalised');
  assert.equal((await resolveUser(env, 'partner@x.test')).created, true);
  // A mistyped address that got past Access (the 2026-09-26 incident) is stopped here.
  assert.deepEqual(await resolveUser(env, 'partmer@x.test'), { error: 'not-allowed' });
  assert.equal(count(), 2, 'no user row for the rejected address');

  for (const list of [undefined, '', ' , \n ', 'not-an-email']) {
    assert.deepEqual(await resolveUser({ DB, ALLOWED_EMAILS: list }, 'me@x.test'), { error: 'not-configured' }, JSON.stringify(list));
  }
  // Local development (DEV_NO_AUTH, .dev.vars only) skips the list like it skips Access.
  assert.equal((await resolveUser({ DB, DEV_NO_AUTH: '1' }, 'dev@localhost.test')).created, true);
});

test('allowlist: parsing', () => {
  assert.deepEqual([...parseAllowedEmails('a@x.test,B@X.TEST\n c@x.test  d@x.test')], ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test']);
  assert.deepEqual([...parseAllowedEmails('\u212Aate@x.test, ok@x.test')], ['ok@x.test'], 'unusable entries are ignored');
  assert.equal(parseAllowedEmails(undefined).size, 0);
});

test('isolation: timeline, counts and topics only show the own data', async () => {
  const { DB, a, b, topicB, feedB, articlesOf } = await setup();
  assert.deepEqual((await articlesOf(a)).map((x) => x.title), ['Item 2', 'Item 1']);
  assert.deepEqual((await articlesOf(b)).map((x) => x.title), ['Item 3', 'Item 2', 'Item 1']);
  assert.equal((await db.topicsWithCounts(DB, a)).totalUnread, 2);
  assert.equal((await db.topicsWithCounts(DB, b)).totalUnread, 3);
  assert.equal((await db.topicsWithCounts(DB, a)).topics.length, db.DEFAULT_TOPICS.length);
  // Filters with the other user's ids find nothing.
  assert.equal((await db.listArticles(DB, a, { feed: feedB.id, filter: 'all', page: 0 })).articles.length, 0);
  assert.equal((await db.listArticles(DB, a, { topic: topicB, filter: 'all', page: 0 })).articles.length, 0);
  assert.deepEqual((await db.listFeeds(DB, a)).map((f) => f.title), ['A news']);
});

test('isolation: foreign article, feed, topic and image ids change and reveal nothing', async () => {
  const { DB, a, b, topicA, topicB, feedA, feedB, articlesOf } = await setup();
  const bArticle = (await articlesOf(b))[0];

  assert.equal(await db.updateArticle(DB, a, bArticle.id, 'star'), null);
  assert.equal(await db.getArticleImageUrl(DB, a, bArticle.id), '');
  assert.equal(await db.getArticleImageUrl(DB, b, bArticle.id), 'https://img.x.test/3.jpg');
  assert.equal(await db.getFeed(DB, a, feedB.id), null);
  assert.equal(await db.getFeedByUrl(DB, a, FEED_URL).then((f) => f.id), feedA.id);
  assert.equal(await db.ownsTopic(DB, a, topicB), false);
  assert.equal(await db.ownsTopic(DB, a, topicA), true);

  await db.updateFeed(DB, a, feedB.id, { topicId: null, enabled: false, title: 'hijacked' });
  await db.renameTopic(DB, a, topicB, 'hijacked');
  await db.markAllRead(DB, a, { feed: feedB.id, filter: 'unread', page: 0 });
  await db.markAllRead(DB, a, { filter: 'unread', page: 0 });
  await db.deleteTopic(DB, a, topicB);
  await db.deleteFeed(DB, a, feedB.id);

  const feedsB = await db.listFeeds(DB, b);
  assert.deepEqual(feedsB.map((f) => [f.title, f.enabled, f.topic_id]), [['B news', 1, topicB]]);
  assert.ok((await topicsOf(DB, b)).some((t) => t.id === topicB && t.name === 'News'));
  assert.deepEqual((await articlesOf(b)).map((x) => [x.is_read, x.is_starred]), [[0, 0], [0, 0], [0, 0]]);
  assert.equal((await articlesOf(a)).every((x) => x.is_read === 1), true, 'A marked only its own');
});

test('isolation: own actions work', async () => {
  const { DB, a, feedA, articlesOf } = await setup();
  const [first] = await articlesOf(a);
  assert.equal((await db.updateArticle(DB, a, first.id, 'star')).is_starred, 1);
  await db.deleteFeed(DB, a, feedA.id);
  assert.equal((await articlesOf(a)).length, 0);
});

test('isolation: push devices and summary counts are per user', async () => {
  const { DB, a, b } = await setup();
  const device = (n) => ({ endpoint: `https://web.push.apple.com/${n}`, p256dh: 'p', auth: 'a' });
  await db.upsertSubscription(DB, a, device(1));
  await db.upsertSubscription(DB, b, device(2));
  assert.deepEqual((await db.listDevices(DB, a)).map((d) => d.endpoint), [device(1).endpoint]);
  assert.deepEqual((await db.usersWithDevices(DB)).sort(), [a, b].sort());

  const bDevice = (await db.listDevices(DB, b))[0];
  await db.deleteSubscriptionById(DB, a, bDevice.id);
  await db.deleteSubscription(DB, a, device(2).endpoint);
  await db.setSubscriptionError(DB, a, bDevice.id, 'x');
  assert.deepEqual((await db.listDevices(DB, b)).map((d) => [d.endpoint, d.last_error]), [[device(2).endpoint, '']]);

  // The same device subscribing for another account moves to that account.
  await db.upsertSubscription(DB, a, device(2));
  assert.equal((await db.listDevices(DB, b)).length, 0);
  assert.equal((await db.listDevices(DB, a)).length, 2);

  assert.deepEqual((await db.newArticleCounts(DB, a, 0, 'daily')).map((r) => r.count), [2]);
  assert.deepEqual((await db.newArticleCounts(DB, b, 0, 'daily')).map((r) => r.count), [3]);
});

test('daily summary state is kept per user', async () => {
  const { DB, a, b } = await setup();
  await db.upsertSubscription(DB, a, { endpoint: 'https://web.push.apple.com/1', p256dh: 'p', auth: 'a' });
  await db.upsertSubscription(DB, b, { endpoint: 'https://web.push.apple.com/2', p256dh: 'p', auth: 'a' });
  // No VAPID keys in this env: nothing is sent, but each user's summary is marked as done for the day.
  await maybeSendDigest({ DB }, Date.UTC(2026, 8, 26, 17, 30));
  assert.equal(await db.getState(DB, `digest_date:${a}`), '2026-09-26');
  assert.equal(await db.getState(DB, `digest_date:${b}`), '2026-09-26');
});

test('cron sees every user’s due feeds; deleting a user removes all their data', async () => {
  const { DB, a, b } = await setup();
  assert.equal((await db.dueFeeds(DB, 20)).length, 2);
  DB.sqlite.prepare('DELETE FROM users WHERE id = ?').run(a);
  assert.equal((await db.listFeeds(DB, a)).length, 0);
  assert.equal(DB.sqlite.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 3, 'only B’s articles left');
  assert.equal((await db.listFeeds(DB, b)).length, 1);
});

test('isolation: a feed can only get its own user\'s topic', async () => {
  const { DB, a, topicA, topicB, feedA } = await setup();
  const topicOf = (id) => DB.sqlite.prepare('SELECT topic_id FROM feeds WHERE id = ?').get(id).topic_id;

  await db.updateFeed(DB, a, feedA.id, { topicId: topicB, enabled: true, title: 'A news' });
  assert.equal(topicOf(feedA.id), null, 'foreign topic → no topic');
  await db.updateFeed(DB, a, feedA.id, { topicId: 99999, enabled: true, title: 'A news' });
  assert.equal(topicOf(feedA.id), null, 'non-existent topic → no topic (no error, no oracle)');
  await db.updateFeed(DB, a, feedA.id, { topicId: topicA, enabled: true, title: 'A news' });
  assert.equal(topicOf(feedA.id), topicA);

  const inserted = await db.insertFeed(DB, a, { url: 'https://other.x.test/feed', title: 'O', siteUrl: '', topicId: topicB });
  assert.equal(inserted.topic_id, null);
});

test('isolation: even a corrupt cross-user topic link never shows the other user\'s topic', async () => {
  const { DB, a, topicB, feedA, articlesOf } = await setup();
  // Bypass the checks on purpose to test the join guards (t.user_id = f.user_id).
  DB.sqlite.prepare('UPDATE feeds SET topic_id = ? WHERE id = ?').run(topicB, feedA.id);
  DB.sqlite.prepare("UPDATE topics SET name = 'B secret' WHERE id = ?").run(topicB);

  assert.ok((await articlesOf(a)).every((x) => x.topic_name === null && x.topic_id === null));
  assert.equal((await db.listFeeds(DB, a))[0].topic_name, null);
  const { topics } = await db.topicsWithCounts(DB, a);
  assert.ok(topics.every((t) => t.name !== 'B secret' && t.unread === 0 && t.feed_count === 0));
});

test('cleanup runs at most once per Berlin calendar day', async () => {
  const { DB, feedA } = await setup();
  const { purgeOncePerDay } = await import('../src/fetcher.js');
  const env = { DB };
  const addOld = (guid) =>
    DB.sqlite
      .prepare('INSERT INTO articles (feed_id, guid_hash, published_at, fetched_at) VALUES (?, ?, 1, 1)')
      .run(feedA.id, guid);
  const count = () => DB.sqlite.prepare('SELECT COUNT(*) AS n FROM articles WHERE fetched_at = 1').get().n;
  const day1 = Date.UTC(2026, 8, 26, 7, 0);

  addOld('old1');
  assert.equal(await purgeOncePerDay(env, day1), true);
  assert.equal(count(), 0, 'old article purged');
  addOld('old2');
  assert.equal(await purgeOncePerDay(env, day1 + 10 * 3600_000), false, 'same day: skipped');
  assert.equal(count(), 1);
  assert.equal(await purgeOncePerDay(env, day1 + 24 * 3600_000), true, 'next day: runs again');
  assert.equal(count(), 0);
});

