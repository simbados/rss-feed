// @ts-check
// Client files (src/client/), bundled by wrangler as text (the [[rules]] "Text" entry in wrangler.toml)
// and served by src/index.js. Tests load them the same way (test/helpers/text-imports.js).
//
// /app.js is an ES module that imports its siblings (./store.js, …); CLIENT_MODULES lists every module the
// Worker serves at /<name>.js. theme.js and sw.js are classic scripts.

import CSS from './client/app.css';
import APP_JS from './client/app.js';
import ARTICLES_JS from './client/articles.js';
import ICON_SVG from './client/icon.svg';
import PUSH_JS from './client/push.js';
import REFRESH_JS from './client/refresh.js';
import STORE_JS from './client/store.js';
import SW_JS from './client/sw.js';
import THEME_JS from './client/theme.js';

export { CSS, ICON_SVG, SW_JS, THEME_JS };

/** Page script modules by URL path. @type {ReadonlyMap<string, string>} */
export const CLIENT_MODULES = new Map([
  ['/app.js', APP_JS],
  ['/articles.js', ARTICLES_JS],
  ['/push.js', PUSH_JS],
  ['/refresh.js', REFRESH_JS],
  ['/store.js', STORE_JS],
]);

/**
 * A module's relative imports with the asset version added (`from './store.js'` →
 * `from './store.js?v=abc'`), so a deploy never mixes new and cached old modules.
 * `version` must be the server's own deploy id (assetVersion), never text from a request: it ends up in
 * served JavaScript. Anything but [0-9a-z-] is refused as a second guard.
 * @param {string} source @param {string|null} version
 */
export function versionImports(source, version) {
  if (!version) return source;
  if (!/^[0-9a-z-]{1,64}$/i.test(version)) throw new Error('invalid asset version');
  return source.replace(/^(import [^;]* from '\.\/[\w-]+\.js)';$/gm, `$1?v=${version}';`);
}

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
