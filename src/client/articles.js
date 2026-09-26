// @ts-check
// Articles in the timeline: Read / Star / Hide without a page reload, opening an article marks it read,
// and everything that shows article state or unread counts re-renders from the store.
// Progressive enhancement only: every action also works as a plain form post.
// Never uses innerHTML (CSP enforces Trusted Types); only textContent/classList.

/** Button label and next action for each toggle, from the article's state. */
export const LABELS = {
  read: (/** @type {any} */ s) => (s.is_read ? ['unread', 'Unread'] : ['read', 'Read']),
  star: (/** @type {any} */ s) => (s.is_starred ? ['unstar', '★ Unstar'] : ['star', '☆ Star']),
};

/**
 * Show one article's state: remove it when hidden, else update classes and toggle buttons.
 * @param {any} el the <article data-id> element @param {{ is_read?: number, is_starred?: number, is_hidden?: number }} s
 */
export function renderArticle(el, s) {
  if (s.is_hidden) {
    el.remove();
    return;
  }
  el.classList.toggle('is-read', !!s.is_read);
  el.classList.toggle('is-starred', !!s.is_starred);
  for (const btn of el.querySelectorAll('button[data-kind]')) {
    const label = LABELS[/** @type {keyof LABELS} */ (btn.dataset.kind)];
    if (!label) continue;
    const [action, text] = label(s);
    btn.form.action = '/articles/' + el.dataset.id + '/' + action;
    btn.textContent = text;
  }
}

/**
 * Unread counts in the sidebar: <span data-count="total"> and <span data-count="topic:3">.
 * @param {any} document @param {{ total?: number, topics?: Record<string, number> }} counts
 */
export function renderCounts(document, counts) {
  for (const el of document.querySelectorAll('[data-count]')) {
    const [kind, id] = String(el.dataset.count).split(':');
    const n = kind === 'total' ? counts.total : kind === 'topic' ? counts.topics?.[id] : undefined;
    if (typeof n === 'number' && el.textContent !== String(n)) el.textContent = String(n);
  }
}

/**
 * Wire up the timeline. Dependencies are passed in so tests can run this without a browser.
 * @param {{ document: any, window: any, location: any, store: ReturnType<typeof import('./store.js').createStore>,
 *   post: (url: string) => Promise<any> }} deps
 */
export function setUpArticles({ document, window, location, store, post }) {
  // Re-render what a reply changed.
  store.subscribe((_state, patch) => {
    for (const [id, s] of Object.entries(patch.articles ?? {})) {
      const el = document.querySelector('article[data-id="' + Number(id) + '"]');
      if (el) renderArticle(el, s);
    }
    if (patch.counts) renderCounts(document, patch.counts);
  });

  /** Post an action; the reply ({ articles, counts }) goes into the store. @param {string} url */
  const act = async (url) => store.set(await post(url));

  document.addEventListener('submit', async (/** @type {any} */ e) => {
    const form = e.target;
    if (!form?.classList?.contains('js-action')) return;
    e.preventDefault();
    try {
      await act(form.action);
    } catch {
      form.submit(); // fall back to a normal post
    }
  });

  // "Brave" button, only in the installed app: iOS opens links from a home-screen web app in its own
  // Safari sheet and ignores the default browser; Brave's URL scheme hands the article to the Brave app.
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator?.standalone === true;
  if (standalone) for (const a of document.querySelectorAll('a.open-brave')) a.hidden = false;

  // Opening an article (title or Brave button) marks it read.
  document.addEventListener('click', (/** @type {any} */ e) => {
    const link = e.target?.closest?.('a.title, a.open-brave');
    if (!link) return;
    const article = link.closest('article[data-id]');
    if (article && !article.classList.contains('is-read')) {
      act('/articles/' + article.dataset.id + '/read').catch(() => {});
    }
    // The href attribute as the server wrote it (safeUrl: http/https only). Not link.href: that would
    // turn "#" into this page's own URL.
    const href = link.getAttribute('href') || '';
    if (link.classList.contains('open-brave') && /^https?:\/\//.test(href)) {
      e.preventDefault();
      location.href = 'brave://open-url?url=' + encodeURIComponent(href);
    }
  });
}
