// @ts-check
// Stylesheet and client script, served as /app.css and /app.js so the CSP can
// forbid all inline scripts and styles.

export const CSS = `
:root {
  --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --line: #e7e5e4; --card: #fff;
  --accent: #b45309; --accent-bg: #fef3c7; --danger: #b91c1c;
  color-scheme: light dark;
}
/* Dark colours: from the system setting unless the theme button forced light, or forced dark. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #161412; --fg: #e7e5e4; --muted: #a8a29e; --line: #2e2a27; --card: #1f1c1a;
          --accent: #f59e0b; --accent-bg: #3a2a0d; --danger: #f87171; }
}
:root[data-theme="dark"] { --bg: #161412; --fg: #e7e5e4; --muted: #a8a29e; --line: #2e2a27; --card: #1f1c1a;
  --accent: #f59e0b; --accent-bg: #3a2a0d; --danger: #f87171; color-scheme: dark; }
:root[data-theme="light"] { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: inherit; }
button, input, select { font: inherit; color: inherit; }
button { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 2px 10px; cursor: pointer; }
button:hover { border-color: var(--muted); }
button.danger { color: var(--danger); }
input[type=text], input[type=url], select { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
/* The header stays visible while scrolling; the sidebar sticks just below it. */
/* viewport-fit=cover: the page reaches under notch and home indicator; env(safe-area-inset-*) keeps content clear (0 elsewhere). */
.top { display: flex; align-items: center; gap: 24px; border-bottom: 1px solid var(--line);
  padding: calc(10px + env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left));
  position: sticky; top: 0; z-index: 10; background: var(--bg); }
html { scroll-padding-top: calc(56px + env(safe-area-inset-top)); }
.brand { font-weight: 700; text-decoration: none; color: var(--accent); }
.top nav { display: flex; gap: 16px; }
.theme-toggle { margin-left: auto; font-size: 13px; white-space: nowrap; }
.top nav a, .side a, .filters a { text-decoration: none; color: var(--muted); }
.top nav a.on, .filters a.on { color: var(--fg); font-weight: 600; }
.wrap { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 24px; max-width: 1100px; margin: 0 auto;
  padding: 16px max(16px, env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
.side { display: flex; flex-direction: column; gap: 2px; position: sticky; top: calc(64px + env(safe-area-inset-top)); align-self: start; }
.side a { display: flex; justify-content: space-between; padding: 4px 8px; border-radius: 6px; }
.side a.on { background: var(--accent-bg); color: var(--fg); }
.count { font-variant-numeric: tabular-nums; font-size: 12px; }
h1 { font-size: 20px; margin: 0; }
.toolbar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.filters { display: flex; gap: 12px; text-transform: capitalize; }
.toolbar form { margin-left: auto; }
.item { padding: 12px 0; border-bottom: 1px solid var(--line); }
.head { display: flex; align-items: flex-start; gap: 12px; }
.head > div { flex: 1; min-width: 0; }
.thumb { flex: none; width: auto; height: auto; max-height: 88px; max-width: min(160px, 40%); border-radius: 6px; }
.item h2 { font-size: 16px; margin: 0 0 2px; }
.item h2 a { text-decoration: none; }
.item h2 a:hover { text-decoration: underline; }
.item.is-read h2 a { color: var(--muted); font-weight: 400; }
.item.is-starred h2::before { content: "★ "; color: var(--accent); }
.meta, .sub { color: var(--muted); font-size: 13px; }
.meta a { text-decoration: none; }
.meta a:hover { text-decoration: underline; }
.snippet { margin: 6px 0; color: var(--fg); opacity: .85; overflow-wrap: anywhere; }
.actions { display: flex; gap: 6px; font-size: 13px; }
.actions form, .row-actions form, form.inline { display: inline; margin: 0; }
.open-brave { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 2px 10px; text-decoration: none; }
.version { position: fixed; left: calc(8px + env(safe-area-inset-left)); bottom: calc(6px + env(safe-area-inset-bottom)); font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; pointer-events: none; }
.push { margin-bottom: 16px; }
.push h2 { font-size: 16px; margin: 0 0 4px; }
.push p { margin: 4px 0 8px; }
.devices { margin: 12px 0 0; padding-left: 18px; font-size: 13px; color: var(--muted); }
.devices li { margin: 4px 0; }
.pager { display: flex; justify-content: space-between; padding: 16px 0; }
.empty { color: var(--muted); padding: 24px 0; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin: 12px 0; }
.add { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
.add label { display: flex; flex-direction: column; font-size: 13px; color: var(--muted); gap: 2px; }
.add input[type=url] { min-width: 320px; }
table.feeds { width: 100%; border-collapse: collapse; font-size: 14px; }
table.feeds th { text-align: left; color: var(--muted); font-weight: 500; font-size: 13px; }
table.feeds td, table.feeds th { padding: 8px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
table.feeds tr.disabled { opacity: .55; }
.sub { overflow-wrap: anywhere; }
.check { font-size: 13px; color: var(--muted); }
.error { color: var(--danger); font-size: 13px; overflow-wrap: anywhere; }
.row-actions { white-space: nowrap; }
.flash { padding: 8px 12px; border-radius: 6px; background: var(--accent-bg); }
.flash.error { background: transparent; border: 1px solid var(--danger); }
.solo { max-width: 600px; margin: 48px auto; padding: 0 16px; }
@media (max-width: 760px) {
  .wrap { grid-template-columns: 1fr; }
  .side { position: static; flex-direction: row; flex-wrap: wrap; }
  .version { display: none; }
  .add input[type=url] { min-width: 0; width: 100%; }
  table.feeds thead { display: none; }
  table.feeds td { display: block; border: 0; padding: 4px 0; }
  table.feeds tr { display: block; border-bottom: 1px solid var(--line); padding: 8px 0; }
}
`;

// Progressive enhancement only: every action also works as a plain form post.
// Never uses innerHTML (CSP enforces Trusted Types); only textContent/classList.
export const JS = `'use strict';
(() => {
  const LABELS = {
    read:  (s) => s.is_read ? ['unread', 'Mark unread'] : ['read', 'Mark read'],
    star:  (s) => s.is_starred ? ['unstar', '\\u2605 Unstar'] : ['star', '\\u2606 Star'],
  };

  async function post(url) {
    const res = await fetch(url, { method: 'POST', headers: { 'x-requested-with': 'fetch' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function apply(article, state) {
    if (state.is_hidden) { article.remove(); return; }
    article.classList.toggle('is-read', !!state.is_read);
    article.classList.toggle('is-starred', !!state.is_starred);
    for (const btn of article.querySelectorAll('button[data-kind]')) {
      const label = LABELS[btn.dataset.kind];
      if (!label) continue;
      const [action, text] = label(state);
      btn.form.action = '/articles/' + article.dataset.id + '/' + action;
      btn.textContent = text;
    }
  }

  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.classList.contains('js-confirm') && !confirm(form.dataset.confirm || 'Are you sure?')) {
      e.preventDefault();
      return;
    }
    if (!form.classList.contains('js-action')) return;
    e.preventDefault();
    const article = form.closest('article[data-id]');
    try {
      apply(article, await post(form.action));
    } catch {
      form.submit(); // fall back to a normal post
    }
  });

  // Theme button: Auto (system setting) → Light → Dark. /theme.js applies the choice before first paint.
  const THEMES = { '': '\\u25D0 Auto', light: '\\u2600 Light', dark: '\\u263E Dark' };
  const NEXT = { '': 'light', light: 'dark', dark: '' };
  const toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    const show = () => { toggle.textContent = THEMES[document.documentElement.dataset.theme || '']; };
    show();
    toggle.hidden = false;
    toggle.addEventListener('click', () => {
      const next = NEXT[document.documentElement.dataset.theme || ''];
      window.rssSetTheme(next);
      try {
        if (next) localStorage.setItem('theme', next);
        else localStorage.removeItem('theme');
      } catch {}
      show();
    });
  }

  // Service worker (push notifications). With Trusted Types, register() only accepts a script URL
  // created by a policy; this one allows exactly /sw.js (CSP: trusted-types sw-url).
  if ('serviceWorker' in navigator) {
    const swUrl = window.trustedTypes
      ? window.trustedTypes.createPolicy('sw-url', {
          createScriptURL: (u) => {
            if (u !== '/sw.js') throw new TypeError('unexpected script URL');
            return u;
          },
        }).createScriptURL('/sw.js')
      : '/sw.js';
    navigator.serviceWorker.register(swUrl).catch(() => {});
  }

  // Notifications box on the Feeds page: subscribe this device to the daily summary.
  const pushBox = document.querySelector('.push');
  if (pushBox) setUpPush(pushBox).catch((err) => { pushBox.querySelector('.push-status').textContent = 'Error: ' + err.message; });

  async function setUpPush(box) {
    const status = box.querySelector('.push-status');
    const [on, off, test] = ['on', 'off', 'test'].map((k) => box.querySelector('[data-push="' + k + '"]'));
    const say = (text) => { status.textContent = text; };
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      say('On iPhone, notifications need the installed app: Share \\u2192 Add to Home Screen, then open it from there.');
      return;
    }
    if (!box.dataset.key) { say('Not configured on the server (VAPID_PUBLIC_KEY is missing).'); return; }
    const reg = await navigator.serviceWorker.ready;

    const show = async () => {
      const sub = await reg.pushManager.getSubscription();
      on.hidden = !!sub;
      off.hidden = test.hidden = !sub;
      say(sub ? 'On for this device \\u2013 daily summary at 19:00.'
        : Notification.permission === 'denied' ? 'Blocked \\u2013 allow notifications for this app in the system settings.'
        : 'Off for this device.');
    };
    const run = (fn) => async () => {
      try { await fn(); } catch (err) { say('Failed: ' + err.message); return; }
      await show();
    };

    on.addEventListener('click', run(async () => {
      // Must be the first await: iOS only asks when called directly from the tap.
      if ((await Notification.requestPermission()) !== 'granted') return;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(box.dataset.key) });
      await postJson('/push/subscribe', sub.toJSON());
    }));
    off.addEventListener('click', run(async () => {
      const sub = await reg.pushManager.getSubscription();
      if (!sub) return;
      await postJson('/push/unsubscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }));
    test.addEventListener('click', async () => {
      try {
        const r = await postJson('/push/test', {});
        say(r.sent ? 'Test notification sent.' : 'Not sent: ' + r.error);
      } catch (err) { say('Failed: ' + err.message); }
    });
    await show();
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function b64urlToBytes(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  // Images the proxy could not deliver (404) are removed instead of showing a broken icon.
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains('thumb')) e.target.remove();
  }, true);

  // "Brave" button, only in the installed app: iOS opens links from a home-screen web app in its own
  // Safari sheet and ignores the default browser; Brave's URL scheme hands the article to the Brave app.
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (standalone) for (const a of document.querySelectorAll('a.open-brave')) a.hidden = false;

  // Opening an article (title or Brave button) marks it read.
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element && e.target.closest('a.title, a.open-brave');
    if (!link) return;
    const article = link.closest('article[data-id]');
    if (article && !article.classList.contains('is-read')) {
      post('/articles/' + article.dataset.id + '/read').then((s) => apply(article, s)).catch(() => {});
    }
    // href comes from safeUrl() (http/https or "#"); only real article links are handed to Brave.
    if (link.classList.contains('open-brave') && /^https?:\\/\\//.test(link.href)) {
      e.preventDefault();
      location.href = 'brave://open-url?url=' + encodeURIComponent(link.href);
    }
  });

  // Auto-refresh: iOS shows an installed app exactly as it was left, even hours later, and offers no
  // reload button. Coming back after 5+ minutes in the background loads the page again.
  const STALE_AFTER_MS = 5 * 60 * 1000;
  let hiddenSince = document.hidden ? Date.now() : 0;
  const markHidden = () => { hiddenSince = hiddenSince || Date.now(); };
  const refreshIfStale = () => {
    const away = hiddenSince ? Date.now() - hiddenSince : 0;
    hiddenSince = 0;
    if (away < STALE_AFTER_MS || !navigator.onLine) return;
    // Don't throw away something being typed (e.g. a feed URL).
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.value) return;
    // replace(), not reload(): a GET of the same URL, so a page that came from a form post is never re-posted.
    location.replace(location.href);
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? markHidden() : refreshIfStale()));
  // Pages restored from the back/forward cache don't always fire visibilitychange.
  window.addEventListener('pagehide', markHidden);
  window.addEventListener('pageshow', (e) => { if (e.persisted) refreshIfStale(); });
})();
`;

// Loaded synchronously in <head> so a saved theme applies before the first paint.
// rssSetTheme is also used by the theme button in /app.js.
export const THEME_JS = `'use strict';
// Page background colours; the browser/status bar (theme-color) uses the same ones.
const THEME_COLORS = { light: '#fafaf9', dark: '#161412' };

// '' = follow the system setting, 'light' / 'dark' = forced by the theme button.
window.rssSetTheme = (t) => {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  // Two theme-color tags (light/dark, chosen by media query). A forced theme sets both to its colour.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.content = THEME_COLORS[t || meta.dataset.scheme];
  }
};

try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') window.rssSetTheme(t);
} catch {}
`;

// App icon: a white "R" (drawn as strokes, so no font is needed) on the light theme's accent colour.
export const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" rx="96" fill="#b45309"/>
<path d="M172 392V120h88a80 80 0 0 1 0 160h-88M248 280l92 112" fill="none" stroke="#fafaf9" stroke-width="64" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

// Web app manifest (PWA step 1: installable, opens without browser bars).
export const MANIFEST = JSON.stringify({
  name: 'RSS Reader',
  short_name: 'RSS',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#fafaf9',
  theme_color: '#fafaf9',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
});

// Service worker, served as /sw.js. Push notifications only for now (offline cache comes later).
export const SW_JS = `'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch {}
  const text = (v, fallback) => (typeof v === 'string' && v ? v : fallback);
  e.waitUntil(self.registration.showNotification(text(msg.title, 'RSS'), {
    body: text(msg.body, ''),
    tag: text(msg.tag, 'rss'),
    icon: '/icon-192.png',
    data: { url: text(msg.url, '/') },
  }));
});

// Only paths on this site are opened, whatever the message says.
function sitePath(url) {
  if (typeof url !== 'string') return '/';
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : '/';
  } catch {
    return '/';
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = sitePath(e.notification.data && e.notification.data.url);
  e.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      try {
        await client.focus();
        await client.navigate(target);
        return;
      } catch {}
    }
    await self.clients.openWindow(target);
  })());
});
`;
