# Security checklist: OWASP Top 10:2025 for rss-feed

Source: https://top10.owasp.org/2025/ (checked 2026-09-25). Used by the `security-reviewer` agent
(`.claude/agents/security-reviewer.md`) and by humans reviewing a change. For each category:
**where it applies here**, then **what to check in a diff**. Update this file when OWASP publishes a new
list or a feature adds a new attack surface.

Context: single-user reader on Cloudflare Workers + D1 behind Cloudflare Access. Untrusted input comes
from **feed servers** (XML, HTML, URLs, images), **the browser** (forms, JSON, URLs) and **push services**
(responses). Secrets: `VAPID_PRIVATE_KEY` (Worker secret), the Cloudflare API token (sbx secret).

## A01:2025 – Broken Access Control
Here: every request passes `authenticate()` in `src/index.js` before routing; POSTs pass `isSameOrigin()`
(CSRF); `/img/<id>` only fetches the URL stored for that article; `/push/*` changes subscriptions;
Worker-level Access protects all hostnames incl. previews.
Check:
- New route or handler reachable **before** `authenticate()`, or a new state change done via GET?
- New POST/JSON endpoint that skips the same-origin check, or accepts cross-origin requests?
- An endpoint that fetches or returns data chosen by the request (URL, id) instead of stored data → SSRF /
  open proxy / reading other rows?
- Redirect targets built from input (`backTo()` style) without same-origin check → open redirect?
- Service worker `notificationclick` or any client code opening URLs from data without the same-origin guard?

## A02:2025 – Security Misconfiguration
Here: CSP and headers in `src/index.js` (`SECURITY_HEADERS`), Trusted Types (`sw-url` only),
`wrangler.toml` (`workers_dev = false`, vars, observability), `DEV_NO_AUTH` only in `.dev.vars`.
Check:
- CSP loosened (`unsafe-inline`, `unsafe-eval`, wildcard or `https:` sources, new `*-src`) without reason?
- New Trusted Types policy, or a policy that passes arbitrary input through?
- `DEV_NO_AUTH`, debug switches or test values in `wrangler.toml` or source defaults?
- `workers_dev` / `preview_urls` turned on, new routes/domains, or observability logging sensitive data?
- New response type served without `respond()` (missing security headers), wrong `content-type`, or
  `cache-control` that lets shared caches store private pages?
- Serving SVG/HTML from user-controlled data on our origin?

## A03:2025 – Software Supply Chain Failures
Here: no runtime dependencies; `wrangler` is the only dev dependency, pinned by `package-lock.json`;
`.npmrc` sets `min-release-age=7`, `ignore-scripts=true`; wrangler runs only from `node_modules`.
Check:
- New dependency in `package.json` (runtime or dev) — needs explicit user consent; is it necessary?
- `package-lock.json` changed without a matching `package.json` change, or registry URLs other than
  `registry.npmjs.org`?
- `.npmrc` protections weakened or removed?
- Scripts using `npx`, `curl | sh`, remote code, or loading scripts/styles from third-party CDNs?
- Generated files (`src/icons/*.png`) changed without the generator (`scripts/make-icons.mjs`) or vice versa?

## A04:2025 – Cryptographic Failures
Here: Access JWT verification (`src/auth.js`: RS256, `aud`, `exp`, JWKS from the team domain);
Web Push (`src/webpush.js`: ECDH P-256, HKDF, AES-128-GCM, ES256 VAPID JWT); SHA-256 for GUID hashes and
cache keys.
Check:
- JWT: algorithm pinned, signature verified before claims are trusted, `aud`/`exp`/issuer checked,
  keys only from `https://<team>/cdn-cgi/access/certs`?
- Randomness only from `crypto.getRandomValues` / WebCrypto key generation — no `Math.random()` for
  anything security-relevant; the test-only fixed keys/salt path not reachable in production?
- Secrets (private keys, tokens) logged, returned in responses, stored in D1, or hard-coded?
- Plain `http:` used where confidentiality or integrity matters (push endpoints, JWKS)?

## A05:2025 – Injection
Here: SQL only in `src/db.js` with `.bind()`; HTML only via the `html` template (escape by default,
`safeUrl()` for feed links, rules in `src/views.js`, tests in `test/xss-rules.test.js`); feed parser
outputs plain text; client script uses `textContent`, never HTML sinks.
Check:
- SQL built with string interpolation of values (only fixed fragments like `${w.sql}` from code are OK)?
- New `raw()`, unquoted attribute, `href`/`src` from data without `safeUrl()`, or HTML strings built outside
  `html```?
- Feed data (title, snippet, author, URLs, image URLs) reaching HTML, SQL, headers, logs or `fetch()`
  without validation?
- Client code using `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`?
- Regexes on untrusted input that can backtrack catastrophically (ReDoS) on large feeds?
- Header injection: values from input put into response headers (`location`, `content-type`, `set-cookie`)?

## A06:2025 – Insecure Design
Here: fail-closed auth, image proxy by article id (not by URL), push payload encrypted end to end,
digest marked sent before sending (no duplicates), additive-only migrations.
Check:
- Does the feature trust something it shouldn't (feed content, the push service, request parameters)?
- Missing limits: size caps, timeouts, per-run limits (Workers subrequest limit), item counts?
- Abuse by the only realistic attacker — a malicious or compromised **feed**: can it make the Worker
  fetch arbitrary URLs, spam notifications, fill D1, or exhaust CPU?
- State machines that can double-execute (cron overlap, retries) with side effects?

## A07:2025 – Authentication Failures
Here: authentication is delegated to Cloudflare Access; the Worker re-verifies the JWT in
`Cf-Access-Jwt-Assertion` on every request; `DEV_NO_AUTH=1` bypass for local development only.
Check:
- Any code path that authenticates via something other than the verified JWT (cookie presence, header
  presence, query parameter, IP)?
- Changes to `src/auth.js`: caching of verification results, key rotation handling, error paths that
  return `ok: true`?
- New ways to enable the dev bypass (other env names, defaults, fallbacks when vars are missing)?

## A08:2025 – Software or Data Integrity Failures
Here: service worker `/sw.js` (served `no-cache`, same origin); manifest; generated icons; D1 migrations
applied by the deploy; Web Push subscriptions stored from the client.
Check:
- Service worker caching or serving responses that could be attacker-influenced (other origins,
  redirects, non-200, the Access login page) — or executing fetched code?
- Data from the client (subscriptions, form values) stored without validation and later used for
  outbound requests?
- Migrations that change or delete existing data, or aren't safe to run before the new code is live?
- Deserialisation of untrusted JSON into objects used for control flow without type checks?

## A09:2025 – Security Logging and Alerting Failures
Here: Workers Logs (observability on); `console.warn` for auth and CSRF rejections; cron summary lines.
Check:
- Security-relevant rejections (auth, CSRF, invalid subscription, proxy refusals) silent where a log line
  would help investigation?
- Logs containing secrets, JWTs, full push endpoints/keys, cookies, or personal data beyond what's needed?
- Errors swallowed so that failures (e.g. every push failing) go unnoticed?

## A10:2025 – Mishandling of Exceptional Conditions
Here: fetchers "never throw" and record errors; auth fails closed; top-level `try/catch` in `fetch()`
returns a generic 500; `sendPush()` returns errors instead of throwing.
Check:
- An exception path that **fails open** (skips auth/CSRF/validation, serves cached private data)?
- Error messages or stack traces returned to the client, or reflecting untrusted input unescaped?
- `catch {}` that hides a security-relevant failure, or `Promise.all` where one rejection aborts work
  that must complete (e.g. marking state)?
- Missing timeouts / size limits on `fetch()` and body reads (`AbortSignal.timeout`, capped reads)?
- Partial failures leaving inconsistent state (half-written rows, digest sent twice or never)?
