// Served as /theme.js, a classic script loaded synchronously in <head> so a saved theme applies
// before the first paint. rssSetTheme is also used by the theme button in /app.js.
'use strict';
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
