// @ts-check
// Auto-refresh: iOS shows an installed app exactly as it was left, even hours later, and offers no
// reload button. Coming back after 5+ minutes in the background loads the page again.

export const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * @param {{ document: any, window: any, navigator: any, location: any, now?: () => number }} deps
 */
export function setUpAutoRefresh({ document, window, navigator, location, now = Date.now }) {
  let hiddenSince = document.hidden ? now() : 0;
  const markHidden = () => {
    hiddenSince = hiddenSince || now();
  };
  const refreshIfStale = () => {
    const away = hiddenSince ? now() - hiddenSince : 0;
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
  window.addEventListener('pageshow', (/** @type {any} */ e) => {
    if (e.persisted) refreshIfStale();
  });
}
