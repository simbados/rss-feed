// @ts-check
// Entry point of the page script, served as the ES module /app.js. It only wires things together; the
// features live in their own modules (src/client/*.js), which take their dependencies as arguments
// so they can be tested in Node. The Worker adds its deploy id (?v=) to the relative imports.
// Progressive enhancement only: without this script every page still works with plain form posts.
// Never uses innerHTML (CSP enforces Trusted Types); only textContent/classList.

import { setUpArticles } from './articles.js';
import { setUpPush } from './push.js';
import { setUpAutoRefresh } from './refresh.js';
import { createStore } from './store.js';

/** POST without a body; the reply is JSON. @param {string} url */
async function post(url) {
  const res = await fetch(url, { method: 'POST', headers: { 'x-requested-with': 'fetch' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** @param {string} url @param {unknown} body */
async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Forms that need a confirmation (delete feed, topic, mute rule). Registered first, so a cancelled
// confirmation stops every other submit handler.
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form instanceof HTMLFormElement && form.classList.contains('js-confirm') && !confirm(form.dataset.confirm || 'Are you sure?')) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
});

const store = createStore();
setUpArticles({ document, window, location, store, post });
setUpAutoRefresh({ document, window, navigator, location });

// Theme button: Auto (system setting) → Light → Dark. /theme.js applies the choice before first paint.
const THEMES = { '': '◐ Auto', light: '☀ Light', dark: '☾ Dark' };
const NEXT = { '': 'light', light: 'dark', dark: '' };
const toggle = /** @type {HTMLButtonElement|null} */ (document.querySelector('.theme-toggle'));
if (toggle) {
  const current = () => /** @type {keyof THEMES} */ (document.documentElement.dataset.theme || '');
  const show = () => {
    toggle.textContent = THEMES[current()];
  };
  show();
  toggle.hidden = false;
  toggle.addEventListener('click', () => {
    const next = NEXT[current()];
    /** @type {any} */ (window).rssSetTheme(next);
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
  const tt = /** @type {any} */ (window).trustedTypes;
  const swUrl = tt
    ? tt
        .createPolicy('sw-url', {
          createScriptURL: (/** @type {string} */ u) => {
            if (u !== '/sw.js') throw new TypeError('unexpected script URL');
            return u;
          },
        })
        .createScriptURL('/sw.js')
    : '/sw.js';
  navigator.serviceWorker.register(swUrl).catch(() => {});
}

const pushBox = /** @type {HTMLElement|null} */ (document.querySelector('.push'));
if (pushBox) {
  setUpPush(pushBox, { navigator, window, postJson }).catch((err) => {
    const status = pushBox.querySelector('.push-status');
    if (status) status.textContent = 'Error: ' + err.message;
  });
}

// Images the proxy could not deliver (404) are removed instead of showing a broken icon.
document.addEventListener(
  'error',
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains('thumb')) e.target.remove();
  },
  true
);
