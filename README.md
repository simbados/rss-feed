# rss-feed

Personal RSS/Atom reader on Cloudflare Workers + D1, behind Cloudflare Access.
No framework, no runtime dependencies: plain ES modules, server-rendered HTML, ~30 lines of client JS.

## Layout

| Path | Purpose |
|---|---|
| `src/index.js` | Router, security headers (CSP), CSRF check, cron entry |
| `src/auth.js` | Cloudflare Access JWT verification (WebCrypto) |
| `src/fetcher.js` | Cron refresh, conditional GET, backoff, add-feed + discovery |
| `src/parser.js` | RSS 2.0 / RSS 1.0 / Atom parser, HTML→text |
| `src/html.js` | Escape-by-default `html` template, `safeUrl()` |
| `src/views.js` | Pages |
| `src/db.js` | All SQL |
| `src/static.js` | `/app.css`, `/app.js` |
| `migrations/` | D1 schema |

## Tests

```sh
node --test          # parser + XSS tests, Node ≥ 20, nothing to install
```

## Deploy (one-time setup)

Requires `wrangler` (the only tool; not a runtime dependency).

1. `wrangler d1 create rss-feed` → put the `database_id` into `wrangler.toml`.
2. `wrangler d1 migrations apply rss-feed --remote`
3. In `wrangler.toml`, uncomment `routes` and set your custom domain (e.g. `rss.example.com`).
4. Zero Trust dashboard → Access → Applications → *Add self-hosted app* for that domain.
   Policy: *Allow*, include your email (login method: one-time PIN or GitHub).
   Copy the **Application Audience (AUD) tag** into `ACCESS_AUD` and your team domain
   (`<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`.
5. `wrangler deploy`

The Worker fails closed: without a valid Access JWT every request gets `401`.

## Local development

```sh
echo 'DEV_NO_AUTH=1' > .dev.vars                     # skip Access locally only
wrangler d1 migrations apply rss-feed --local
wrangler dev --test-scheduled                         # then: curl localhost:8787/__scheduled
```

## Notes

- Cron runs every 30 min and refreshes up to 20 due feeds per run (oldest first); failing
  feeds back off exponentially up to 24h. Unstarred articles older than 60 days are purged.
- Feed content is never rendered as HTML: titles/snippets are stored as plain text, escaped
  on output, links restricted to http(s), and a strict CSP with Trusted Types blocks inline script.
- `articles.score`, `feeds.weight` and `topics.weight` are reserved for the planned weighting/sorting.
