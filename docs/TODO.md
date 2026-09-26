# TODO

Open work that is not part of a feature plan. Feature plans live in `docs/plan-*.md`; review history
in `docs/security/last-review.md`. Remove items once they're done.

## Security — from the diff review of 2026-09-25 (up to `5024363`)

- [ ] **[Low] A06 – The purge reads the whole articles table on every cron run.**
  `purgeOldArticles` (`src/db.js`) runs every 30 minutes; the retention DELETE (no index on
  `fetched_at`) and the per-feed cap (`ROW_NUMBER() OVER (PARTITION BY feed_id …)`) each read every
  unstarred article. At ~50,000 articles that's ~4.8M rows/day, close to the free plan's 5M reads/day,
  after which all D1 queries fail for the rest of the day.
  Fix: run the purge once a day (e.g. in the run that sends the digest, or a fixed slot); optionally a
  new migration `CREATE INDEX … ON articles(fetched_at)`.
- [ ] **[Low] A09 – `sendToAll` deletes non-allowlisted subscriptions without a log line.**
  `src/push.js`: a device whose push host is missing from the allowlist (e.g. a new FCM/WNS hostname)
  silently disappears. Fix: `console.warn` with `hostOf(s.endpoint)` before deleting; also re-check
  `https:` like `parseSubscription`.
- [ ] **[Low] A02 – The VAPID private key must be a Secret, not a plain variable.**
  `[vars]` in `wrangler.toml` replaces plain-text dashboard variables on deploy, so a private key
  entered as "Text" would be wiped (push silently "not configured") and is readable in the dashboard.
  Fix: confirm `VAPID_PRIVATE_KEY` has type Secret and belongs to the committed public key; note it in
  `AGENTS.md`.
- [ ] **Not rated, pre-existing:** `articles.guid_hash` is UNIQUE across all feeds, so a hostile feed that
  publishes another feed's GUIDs first makes the real copies get dropped (`INSERT OR IGNORE`).
  Fix: make the uniqueness per feed (`UNIQUE(feed_id, guid_hash)`) — needs a table rebuild migration.

## Security — from the diff review of 2026-09-26

- [ ] **[Low] A10 – `siteName()` returns an empty name for site links without a host.**
  `src/digest.js`: a channel `<link>` like `urn:x`, `mailto:…` or `data:,x` parses with `hostname ''`,
  so the summary shows `" 12 · heise.de 3"`. Fix: only use http(s) URLs with a hostname, else fall back;
  add a test with `siteUrl: 'urn:x'`.

## Limits to watch

- [ ] **Outgoing requests per cron run.** A Worker invocation on the free plan may make 50 outgoing
  requests. The cron fetches up to `FEEDS_PER_RUN = 20` feeds (`src/fetcher.js`), and since the daily
  summary runs in the same invocation, each push to a device is one more. Fine with a few devices; with
  many, lower `FEEDS_PER_RUN` in the run that sends the summary.

## Bugs

- [ ] **Purged articles come back as new if the feed still lists them.**
  - Why: articles are deduplicated by `guid_hash` (`INSERT OR IGNORE`). `purgeOldArticles`
    (`src/db.js`) deletes unstarred articles 60 days after `fetched_at`, or beyond the newest 3000 per
    feed. If the feed still contains the item, the next fetch inserts it again as a new, unread
    article, and it's counted in the daily summary.
  - Affected: feeds that keep items for months, e.g. lebensmittelwarnung.de (items from June still
    listed in September). Most news feeds only list recent items.
  - Fix options: a table of purged `guid_hash` values per feed (hash only, cheap) that `insertArticles`
    skips; or don't purge articles that were still present in the feed's last successful fetch.
