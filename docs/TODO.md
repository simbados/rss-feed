# TODO

Open work that is not part of a feature plan. Feature plans live in `docs/plan-*.md`; review history
in `docs/security/last-review.md`. Remove items once they're done.

## Security — from the diff review of 2026-09-25 (up to `5024363`)

- [ ] **[Low] A06 – The purge reads the whole articles table on every cron run.**
  `purgeOldArticles` (`src/db.js`) runs every 30 minutes; the retention DELETE (no index on
  `fetched_at`) and the per-feed cap (`ROW_NUMBER() OVER (PARTITION BY feed_id …)`) each read every
  unstarred article. At ~50,000 articles that's ~4.8M rows/day, close to the free plan's 5M reads/day,
  after which all D1 queries fail for the rest of the day.
  Fix: run the purge once a day (e.g. in the run that sends the digest, or a fixed slot). The index on
  `articles(fetched_at)` exists since the multi-user schema (2026-09-26); the per-feed cap still scans.
- [ ] **[Low] A02 – The VAPID private key must be a Secret, not a plain variable.**
  `[vars]` in `wrangler.toml` replaces plain-text dashboard variables on deploy, so a private key
  entered as "Text" would be wiped (push silently "not configured") and is readable in the dashboard.
  Fix: confirm `VAPID_PRIVATE_KEY` has type Secret and belongs to the committed public key; note it in
  `AGENTS.md`.
## Security — from the diff review of 2026-09-26

- [ ] **[Low] A10 – `siteName()` returns an empty name for site links without a host.**
  `src/digest.js`: a channel `<link>` like `urn:x`, `mailto:…` or `data:,x` parses with `hostname ''`,
  so the summary shows `" 12 · heise.de 3"`. Fix: only use http(s) URLs with a hostname, else fall back;
  add a test with `siteUrl: 'urn:x'`.

## Security — from the multi-user review of 2026-09-26

- [ ] **[Low] A01 – Push on a shared device stays with the previous account.**
  If A turned on notifications on a device and B later uses the app there with their own login, the
  Feeds page says "On" (the browser has a subscription), but the server row still belongs to A: B gets
  nothing, and the device keeps showing A's summaries. Fix: `POST /push/status {endpoint}` →
  `mine | other | none` (user-scoped lookup); for `other`, show "Notifications on this device belong to
  another account – turn on for this account" (re-posts `/push/subscribe`, which moves the device).

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
