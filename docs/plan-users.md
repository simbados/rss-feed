# Plan: multiple users (own feeds, nothing shared)

Status: **implemented, not deployed** (2026-09-26) — rollout steps 2–6 below are still to do.

## Context
A second person should use the reader with their own feeds, topics, articles, read/star state, push
devices and daily summary, without seeing anything of the first user. More people may follow.
Decisions (user, 2026-09-26):
- **User accounts in one deployment** at `rss.simbados.com`; users identified by their **Access email**.
- **Nobody can see another user's reader** (no admin view).
- **Start with a fresh database** (the existing one emptied) — only test data today; feeds are re-added
  by hand and notifications turned on again. No data migration.
- **Feeds are not shared between users**: the same feed followed by two users is stored and fetched
  twice. Sharing would need global feeds + subscriptions + per-user article state (about +50% work on
  the data layer) and would reveal a little across users (instant 60-day history → "someone else follows
  this"). Duplicates cost one mostly-304 request per shared feed per 30 minutes. Revisit with many users
  and heavy overlap, or if D1 storage/read limits get tight.

Adding a person = adding their email to the Access policy; their empty reader is created on first login.

## Design

### Fresh database with the final schema
- **Same D1 database `rss-feed`, emptied** (same id — no `wrangler.toml`/script changes): all tables are
  dropped, **including `d1_migrations`**, where wrangler records applied migrations by file name —
  otherwise the new `0001_init.sql` would count as already applied and be skipped.
- Migrations are **squashed into one new `migrations/0001_init.sql`** (old 0001–0003 deleted — the
  database they ran on is emptied). From then on the "additive only, never edit an applied migration"
  rule applies again.
- Schema changes compared to today:
  - `users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at INTEGER NOT NULL)`.
  - `topics.user_id`, `feeds.user_id`, `push_subscriptions.user_id` — `NOT NULL REFERENCES users(id)
    ON DELETE CASCADE`, no default.
  - Uniqueness per user / per feed: `topics UNIQUE(user_id, name)`, `feeds UNIQUE(user_id, url)`,
    `articles UNIQUE(feed_id, guid_hash)` (also fixes the GUID item in `docs/TODO.md`).
  - `push_subscriptions.endpoint` stays globally unique; subscribing moves an endpoint to the current user.
  - Articles have no `user_id`: ownership is `articles.feed_id → feeds.user_id`.
  - `app_state` stays; summary state keyed per user (`digest_date:<userId>`, `digest_since:<userId>`).
  - Everything else as today (image_url, feeds.notify, indexes); add an index on `articles(fetched_at)`
    while at it (TODO: purge reads the whole table).

### Who is logged in — `src/users.js` (new)
- `resolveUser(db, email)`: lower-cased email → existing user, or create one (`INSERT … ON CONFLICT DO
  NOTHING` + select, so two parallel first requests don't create duplicates).
- `src/index.js` `handle()`: after `authenticate()` (already returns the verified email), resolve the
  user once and pass `userId` to every handler. Empty email → 401 (fail closed). `DEV_NO_AUTH` →
  `dev@localhost`, or `DEV_EMAIL` from `.dev.vars` (only honoured together with `DEV_NO_AUTH`) to try a
  second user locally.

### Scoping every query — `src/db.js`
- Every user-facing function takes `userId`; articles filtered via `JOIN feeds f … WHERE f.user_id = ?`.
  E.g. `listArticles`, `markAllRead`, `updateArticle` (`… AND feed_id IN (SELECT id FROM feeds WHERE
  user_id = ?)`), `topicsWithCounts`, `listFeeds`, `getFeed`, `getFeedByUrl`, `getArticleImageUrl`,
  `updateFeed`, `deleteFeed`, topic functions, `listDevices`, `deleteSubscriptionById`,
  `upsertSubscription`, `newArticleCounts`.
- **Every ID from a request is checked for ownership** (404 otherwise): `/articles/<id>/…`,
  `/feeds/<id>…`, `/topics/<id>…`, `/img/<id>` (`src/images.js`), `/push/devices/<id>/delete`, the
  `topic` chosen in a feed form (`addFeed`, `updateFeed`), and the timeline filters `?feed=` / `?topic=`
  (list, page heading via `getFeed`, "mark all read").
- Cron-only functions stay global: `dueFeeds`, `recordFetch`, `markFetchAttempt`, `insertArticles`
  (feed already owned), `purgeOldArticles`.

### Features per user
- `src/fetcher.js` `addFeed(env, userId, url, topicId)`; refresh stays per feed.
- `src/digest.js`: `maybeSendDigest` loops over users with devices; per-user due date/since;
  `newArticleCounts(userId)`; `sendToUser`. Same 19:00 Europe/Berlin for everyone for now.
- `src/push.js`: `sendToAll` → `sendToUser(env, userId, message)`; `/push/test` only to own devices.
- VAPID keys stay shared (server identity, not user data).
- Header shows the signed-in email (small, next to the theme button).
- Out of scope: deleting a user's data when they're removed from Access (manual for now:
  `DELETE FROM users WHERE email = ?` — everything else cascades).

### Accepted trade-offs (security review 2026-09-26)
- **Sequential ids** (`INTEGER PRIMARY KEY`, shared across users) appear in URLs; gaps between one's own
  ids hint at how active others are (e.g. how many topics/articles were created in between). Accepted:
  low impact; random public ids aren't worth it here.
- Fixed in the same review: per-user image cache keys (a cache hit revealed "someone else loaded this
  image"), ASCII-only email folding with strict rejection (Unicode `toLowerCase` could merge accounts),
  topic ownership enforced in SQL (`OWN_TOPIC`), and a stricter static `user_id` rule.

## Tests
- **Real SQL without dependencies:** `test/helpers/d1.js` — small D1-compatible wrapper
  (`prepare/bind/first/all/run/batch`) around Node's built-in `node:sqlite` (checked: SQLite 3.53,
  window functions work), applying `migrations/*.sql`.
- **Isolation tests:** two users with overlapping data (same feed URL, same topic name, same GUIDs) →
  every list, count, action, image lookup, device and summary sees/changes only the own rows; foreign
  IDs give 404 and change nothing.
- `resolveUser`: case-insensitive, no duplicates, empty email rejected.
- **Static rule** in `test/security-rules.test.js`: every SQL statement in `src/db.js` touching
  `topics`/`feeds`/`articles`/`push_subscriptions` mentions `user_id`, except a named allowlist of the
  cron-only functions.

## Rollout (Cloudflare steps one at a time, with the user)
1. Implement + tests locally; empty the **local** database the same way and run `npm run dev:sandbox`
   to check the fresh migration and two logins (`DEV_NO_AUTH` user).
2. Security diff review (auth, routing, all SQL); add "every query scoped to the user" to A01 in
   `docs/security/owasp-top10-2025.md`.
3. **Empty the remote database right before pushing** (irreversible; only test data; with your go-ahead):
   ```sh
   node_modules/.bin/wrangler d1 execute rss-feed --remote --command "DROP TABLE IF EXISTS articles; DROP TABLE IF EXISTS push_subscriptions; DROP TABLE IF EXISTS feeds; DROP TABLE IF EXISTS topics; DROP TABLE IF EXISTS app_state; DROP TABLE IF EXISTS d1_migrations;"
   ```
   Until the new build is live, the running Worker answers with errors (its tables are gone) — a few
   minutes, acceptable with test data. The 30-minute cron may log errors in that window.
4. Push → build runs tests, `npm run deploy` applies the new `0001_init.sql` to the empty database,
   deploys the new code.
5. You log in (user created), re-add feeds, turn notifications on again.
6. Add the second person's email to the Access policy; they install the app and set up their feeds.

## Files
New: `src/users.js`, `test/helpers/d1.js`, `test/users.test.js`.
Replaced: `migrations/` (one squashed `0001_init.sql`).
Changed: `src/db.js`, `src/index.js`, `src/auth.js` (`DEV_EMAIL`), `src/fetcher.js`, `src/digest.js`,
`src/push.js`, `src/images.js`, `src/views.js`, `test/security-rules.test.js`, `README.md` (adding a
person), `AGENTS.md` (users in the architecture, squash note), `docs/security/owasp-top10-2025.md`,
`docs/TODO.md` (GUID item and purge index resolved).
Unchanged: `wrangler.toml`, `package.json` (same database).
