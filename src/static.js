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
.top { display: flex; align-items: center; gap: 24px; padding: 10px 16px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 10; background: var(--bg); }
html { scroll-padding-top: 56px; }
.brand { font-weight: 700; text-decoration: none; color: var(--accent); }
.top nav { display: flex; gap: 16px; }
.theme-toggle { margin-left: auto; font-size: 13px; white-space: nowrap; }
.top nav a, .side a, .filters a { text-decoration: none; color: var(--muted); }
.top nav a.on, .filters a.on { color: var(--fg); font-weight: 600; }
.wrap { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 24px; max-width: 1100px; margin: 0 auto; padding: 16px; }
.side { display: flex; flex-direction: column; gap: 2px; position: sticky; top: 64px; align-self: start; }
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
.version { position: fixed; left: 8px; bottom: 6px; font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; pointer-events: none; }
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
      if (next) document.documentElement.dataset.theme = next;
      else delete document.documentElement.dataset.theme;
      try {
        if (next) localStorage.setItem('theme', next);
        else localStorage.removeItem('theme');
      } catch {}
      show();
    });
  }

  // Images the proxy could not deliver (404) are removed instead of showing a broken icon.
  document.addEventListener('error', (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains('thumb')) e.target.remove();
  }, true);

  // Opening an article marks it read.
  document.addEventListener('click', (e) => {
    const link = e.target instanceof Element && e.target.closest('a.title');
    if (!link) return;
    const article = link.closest('article[data-id]');
    if (!article || article.classList.contains('is-read')) return;
    post('/articles/' + article.dataset.id + '/read').then((s) => apply(article, s)).catch(() => {});
  });
})();
`;

// Loaded synchronously in <head> so a saved theme applies before the first paint.
export const THEME_JS = `'use strict';
try {
  const t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
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
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
});
