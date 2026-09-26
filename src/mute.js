// @ts-check
// Mute rules: a case-insensitive "contains" match on an article's title or URL. Plain substring
// matching only — a regex written by one user could stall the cron run that all users share.

export const MIN_PATTERN = 2;
export const MAX_PATTERN = 200;
export const MAX_RULES_PER_USER = 100;
/** Newest articles a new rule is checked against (bounds CPU and D1 reads); new articles are always checked. */
export const MUTE_SCAN_LIMIT = 2000;
export const MUTE_FIELDS = /** @type {const} */ (['title', 'url']);

/**
 * Lower case (Unicode-aware, so "Ü" matches "ü"), whitespace runs collapsed, trimmed.
 * @param {unknown} s
 */
export function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * A pattern from a form, normalised, or null if too short or too long.
 * @param {unknown} input
 */
export function cleanPattern(input) {
  const p = normalize(input);
  return p.length >= MIN_PATTERN && p.length <= MAX_PATTERN ? p : null;
}

/** @param {unknown} v @returns {v is 'title'|'url'} */
export function isMuteField(v) {
  return MUTE_FIELDS.includes(/** @type {any} */ (v));
}

/**
 * The id of the first rule (lowest id) that matches, or null.
 * @param {{ id: number, field: string, pattern: string }[]} rules patterns already normalised
 * @param {{ title: string, url: string }} article
 */
export function matchRule(rules, article) {
  if (!rules.length) return null;
  const text = { title: normalize(article.title), url: normalize(article.url) };
  for (const r of rules) {
    if (r.field === 'title' || r.field === 'url') {
      if (text[r.field].includes(r.pattern)) return r.id;
    }
  }
  return null;
}

/**
 * A starting point for a URL rule: the article's directory ("/sendung/100sekunden/" from
 * "/sendung/100sekunden/video-123.html"), since recurring items usually share it; else the path.
 * @param {string} url
 */
export function urlPattern(url) {
  try {
    const path = new URL(url).pathname;
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    return (dir.length > 1 ? dir : path).slice(0, MAX_PATTERN);
  } catch {
    return '';
  }
}
