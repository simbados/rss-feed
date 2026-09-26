# Plan: PWA for iPhone

Status (2026-09-25): **installable and working on the iPhone.**
- Done: steps 1, 2, 3 and 6; from step 4 the service worker itself (push only, no `fetch` handler yet).
- **Open: offline cache (rest of step 4), offline behaviour (step 5), their tests (7), verification (8).**
- Auto-refresh (2026-09-26, `/app.js`): back in the app after 5+ minutes → the page reloads via GET
  (not while offline or typing). Open idea: a refresh button in the header (iOS standalone has none).
- Versioned asset URLs (2026-09-26): `/app.css`, `/theme.js`, `/app.js` are linked with `?v=<deploy id>`
  and cached long; a deploy changes the URLs, so HTML and scripts never mix versions.
- To check on the iPhone after the step 2 polish: status bar colour follows light/dark and the theme
  button; header clear of the status bar/notch; version footer clear of the home indicator. If iOS keeps
  a plain white/black bar, `apple-mobile-web-app-status-bar-style` (`default`/`black-translucent`) is the
  next knob — `black-translucent` always has white text, so it only fits dark backgrounds.

## Goal
Install the reader on the iPhone home screen (Safari → Share → Add to Home Screen): opens like an app
without browser bars, starts fast, shows the last loaded list when offline. Also the foundation for
push notifications later (on iPhone, web push requires an installed web app).

Not in scope: push notifications; full article text offline (would need HTML sanitizing).

## Main risk: Cloudflare Access on iPhone (check first)
- An installed web app on iPhone has its **own cookie storage** → log in once more inside the app.
- When the Access session expires, Access redirects to `<team>.cloudflareaccess.com`; on iPhone this
  may open outside the app or loop. Can only be verified with a real deployment + phone.
- Mitigation: set a **long Access session duration** (e.g. 1 month) for this application.

## Steps
1. ✅ **Deploy + Access + minimal manifest (risk check).** Real HTTPS needed (iPhone can't install from
   localhost). Minimal manifest (name, `display: standalone`), install on iPhone, log in, close/reopen.
   Decision point: if login inside the app is not acceptable → stop and discuss.
2. ✅ **Manifest + iPhone tags** (`src/static.js`, `src/views.js`, `src/index.js`):
   `/manifest.webmanifest`, linked with `crossorigin="use-credentials"` (else fetched without cookie →
   blocked by Access). `apple-touch-icon` 180×180, `theme-color` light/dark, `viewport-fit=cover` +
   safe-area CSS padding. Done: two `theme-color` tags (light/dark media query); `rssSetTheme()` in
   `/theme.js` sets both to the forced colour when the theme button is used.
3. ✅ **Icons** (`scripts/make-icons.mjs` → generated `src/icons/*.png`): 180, 192, 512, 512 maskable.
   Generated as PNG with Node's built-in `zlib` only; imported by the Worker as binary data
   (`[[rules]]` in `wrangler.toml`) and served from `src/index.js`.
4. **Service worker** (`/sw.js`, source in `src/static.js`):
   pages network-first (~3 s timeout) → cached copy; CSS/JS/icons/manifest cache-first with a version.
   Only cache 200, non-redirected, same-origin responses (never the Access login page). Never POSTs.
   Serve `/sw.js` with `cache-control: no-cache` (done). Also cache thumbnails (`/img/<id>`), cache-first
   with a size/count limit, so the saved list shows its images offline.
5. **Offline behaviour in the page**: hidden "Offline – showing saved copy" banner toggled via
   `classList`; action buttons show "Not available offline" instead of the form-post fallback.
6. ✅ **Security headers** (`src/index.js`): CSP add `manifest-src 'self'`, `worker-src 'self'`.
   Trusted Types: `serviceWorker.register()` needs a script-URL policy → policy allowing exactly
   `/sw.js` + CSP `trusted-types sw-url`.
7. **Tests** (`test/pwa.test.js`): manifest fields + icon sizes, icons are valid PNGs, CSP directives,
   service-worker "should cache?" rule (rejects POST, redirects, non-200, other origins).
   XSS rules tests keep covering new code.
8. **Verification**: desktop Chrome via `sbx` on `localhost:8787` (DevTools → Application: manifest,
   SW active, installable; Offline checkbox shows cached timeline + banner). iPhone (deployed):
   install, standalone, icon, login, flight mode shows saved list, actions show offline notice,
   fresh again when online.

## Files affected
`src/static.js`, `src/views.js`, `src/index.js`, new `src/icons/*.png`, new `scripts/make-icons.mjs`,
new `test/pwa.test.js`, `README.md` (install + Access session notes).

## Open questions
1. ~~Deployment for step 1~~ — done: `rss.simbados.com`, Worker-level Access, deployed via Workers Builds.
2. ~~Icon~~ — generated "R" SVG in the light theme colours.
3. ~~Order~~ — step 1 first.

## Related (later)
Suggested order discussed: weighting → weekly email digest (Cloudflare Email Routing `send_email`)
→ instant alerts (ntfy/Telegram or Web Push, which needs this PWA on iPhone).
