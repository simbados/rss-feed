# TODO

Open work that is not part of a feature plan. Feature plans live in `docs/plan-*.md`; review history
in `docs/security/last-review.md`. Remove items once they're done.

## Security — from the multi-user review of 2026-09-26

- [ ] **[Low] A01 – Push on a shared device stays with the previous account.**
  If A turned on notifications on a device and B later uses the app there with their own login, the
  Feeds page says "On" (the browser has a subscription), but the server row still belongs to A: B gets
  nothing, and the device keeps showing A's summaries. Fix: `POST /push/status {endpoint}` →
  `mine | other | none` (user-scoped lookup); for `other`, show "Notifications on this device belong to
  another account – turn on for this account" (re-posts `/push/subscribe`, which moves the device).

## Limits to watch

- [ ] **Outgoing requests per cron run — only relevant with many feeds.** A Worker invocation on the
  free plan may make 50 outgoing requests (redirects count too). The cron fetches up to
  `FEEDS_PER_RUN = 20` due feeds (`src/fetcher.js`) after sending the summary pushes (those go first, so
  they're never starved). With more than ~20 feeds across all users, feeds take turns (e.g. 60 feeds →
  each about every 1.5 h); many redirecting feeds could exceed 50, and the overflow fails with backoff.
  Levers if it ever matters: cron every 10 min, a lower `FEEDS_PER_RUN`, storing permanent redirects, a
  log warning when feeds fall behind, or the paid plan (1000 requests). Not expected with our feed count.

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
