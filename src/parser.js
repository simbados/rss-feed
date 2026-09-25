// @ts-check
// Minimal, dependency-free RSS 2.0 / RSS 1.0 (RDF) / Atom parser.
// It is deliberately forgiving: real-world feeds are often not well-formed XML.
// All output is plain text (no markup); callers must still escape on output.

/**
 * @typedef {Object} FeedItem
 * @property {string} guid
 * @property {string} url
 * @property {string} title
 * @property {string} snippet
 * @property {string} author
 * @property {number|null} publishedAt  epoch ms, null if unknown
 *
 * @typedef {Object} ParsedFeed
 * @property {'rss'|'atom'|'rdf'} format
 * @property {string} title
 * @property {string} siteUrl
 * @property {FeedItem[]} items
 */

export const MAX_ITEMS = 100;
export const SNIPPET_LENGTH = 300;

export class NotAFeedError extends Error {}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©',
  reg: '®', trade: '™', euro: '€', pound: '£', middot: '·',
  bull: '•', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à', ccedil: 'ç',
};

/** Decode XML/HTML character references. Unknown named entities are left as-is. */
export function decodeEntities(/** @type {string} */ s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED_ENTITIES, ent) ? NAMED_ENTITIES[/** @type {keyof NAMED_ENTITIES} */ (ent)] : m;
  });
}

/** Turn an HTML fragment into collapsed plain text. */
export function htmlToText(/** @type {string} */ s) {
  return decodeEntities(
    s
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|iframe|object|svg|math)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<\/?[a-z!?][^>]*>/gi, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {string} s @param {number} max */
function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + '…';
}

/** @param {string} tag */
function escapeRe(tag) {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wraps the document with CDATA sections swapped out for placeholders, so that
 * markup inside CDATA can never confuse the regex-based element matching.
 */
class Doc {
  /** @param {string} xml */
  constructor(xml) {
    /** @type {string[]} */
    this.cdata = [];
    this.xml = xml
      .replace(/^\uFEFF/, '') // byte order mark
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, content) => `\u0000${this.cdata.push(content) - 1}\u0000`)
      .replace(/<!--[\s\S]*?-->/g, '');
  }

  /**
   * Text content of an element body: CDATA restored verbatim, the rest entity-decoded.
   * @param {string} inner
   */
  text(inner) {
    return inner
      .split(/\u0000(\d+)\u0000/)
      .map((part, i) => (i % 2 ? this.cdata[Number(part)] : decodeEntities(part)))
      .join('');
  }
}

/**
 * All elements named `tag` (prefix-aware, e.g. "dc:creator") within `xml`.
 * @param {string} xml
 * @param {string} tag
 * @returns {{attrs: Record<string,string>, inner: string}[]}
 */
function elements(xml, tag) {
  const t = escapeRe(tag);
  const re = new RegExp(`<${t}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${t}\\s*>)`, 'gi');
  const out = [];
  for (const m of xml.matchAll(re)) out.push({ attrs: parseAttrs(m[1] || ''), inner: m[2] || '' });
  return out;
}

/** @param {string} s */
function parseAttrs(s) {
  /** @type {Record<string,string>} */
  const attrs = {};
  // Values may be "double", 'single' or unquoted (unquoted is common in minified HTML).
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/**
 * Plain text of the first matching element among `tags`.
 * @param {Doc} doc @param {string} xml @param {string[]} tags
 */
function firstText(doc, xml, tags) {
  for (const tag of tags) {
    for (const el of elements(xml, tag)) {
      const value = htmlToText(doc.text(el.inner));
      if (value) return value;
    }
  }
  return '';
}

/** @param {string} url @param {string} base */
function resolveUrl(url, base) {
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed, base || undefined).href;
  } catch {
    return '';
  }
}

/** @param {string} s */
export function parseDate(s) {
  if (!s) return null;
  let t = Date.parse(s.trim());
  if (Number.isNaN(t)) {
    // Common breakage: non-English or odd day names, "UT", missing seconds; retry without weekday.
    t = Date.parse(s.trim().replace(/^[a-z]+,?\s*/i, '').replace(/\bUT\b/, 'GMT'));
  }
  return Number.isNaN(t) ? null : t;
}

/**
 * Link of a feed or item. Atom: <link href> with rel="alternate" (or no rel).
 * RSS: <link>url</link>. @param {Doc} doc @param {string} xml
 */
function findLink(doc, xml) {
  const links = elements(xml, 'link');
  const alt = links.find((l) => l.attrs.href && (!l.attrs.rel || l.attrs.rel === 'alternate'));
  if (alt) return alt.attrs.href;
  // RSS-style <link>url</link>
  const textLink = links.find((l) => !l.attrs.href && l.inner.trim());
  return textLink ? doc.text(textLink.inner).trim() : '';
}

/**
 * @param {string} xml
 * @param {string} [feedUrl] used to resolve relative links
 * @returns {ParsedFeed}
 */
export function parseFeed(xml, feedUrl = '') {
  const doc = new Doc(xml);
  const src = doc.xml;

  // The format is decided by the root element: the first tag that starts with a letter.
  // This skips <?xml ...?>, <?xml-stylesheet ...?> and <!DOCTYPE ...>, and it means an HTML
  // page that merely mentions "<rss>" somewhere in its text is not mistaken for a feed.
  const root = (src.match(/<([a-z][\w:.-]*)/i)?.[1] ?? '').toLowerCase();
  /** @type {ParsedFeed['format']} */
  let format;
  if (root === 'rss') format = 'rss';
  else if (root === 'feed') format = 'atom';
  else if (root === 'rdf:rdf') format = 'rdf';
  else throw new NotAFeedError('Not an RSS or Atom feed');

  const itemTag = format === 'atom' ? 'entry' : 'item';
  const firstItem = src.search(new RegExp(`<${itemTag}[\\s>]`, 'i'));
  const head = firstItem === -1 ? src : src.slice(0, firstItem);

  const title = firstText(doc, head, ['title']);
  const siteUrl = resolveUrl(findLink(doc, head), feedUrl);
  const base = siteUrl || feedUrl;

  /** @type {FeedItem[]} */
  const items = [];
  for (const el of elements(src, itemTag)) {
    if (items.length >= MAX_ITEMS) break;
    const x = el.inner;
    const guidEl = elements(x, format === 'atom' ? 'id' : 'guid')[0];
    const guid = guidEl ? doc.text(guidEl.inner).trim() : el.attrs['rdf:about'] || '';

    let link = findLink(doc, x);
    if (!link && guidEl && /^https?:\/\//i.test(guid) && guidEl.attrs.ispermalink !== 'false') link = guid;
    const url = resolveUrl(link, base);

    const itemTitle = firstText(doc, x, ['title']);
    const body = firstText(doc, x, ['description', 'summary', 'content:encoded', 'content', 'media:description']);
    const authorEl = elements(x, 'author')[0];
    const author =
      (authorEl && (firstText(doc, authorEl.inner, ['name']) || htmlToText(doc.text(authorEl.inner)))) ||
      firstText(doc, x, ['dc:creator']);
    const publishedAt = parseDate(firstText(doc, x, ['pubDate', 'published', 'dc:date', 'updated', 'issued']));

    if (!itemTitle && !url) continue;
    items.push({
      guid: guid || url || `${itemTitle}|${publishedAt ?? ''}`,
      url,
      title: truncate(itemTitle || url, 500),
      snippet: truncate(body, SNIPPET_LENGTH),
      author: truncate(author, 200),
      publishedAt,
    });
  }

  return { format, title: truncate(title, 200), siteUrl, items };
}

/**
 * Find feed URLs advertised in an HTML page via <link rel="alternate" type="application/rss+xml">.
 * @param {string} htmlSrc
 * @param {string} pageUrl
 */
export function discoverFeeds(htmlSrc, pageUrl) {
  const urls = [];
  for (const m of htmlSrc.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttrs(m[1]);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    const type = (a.type || '').toLowerCase();
    if (rel.includes('alternate') && /^application\/(rss|atom|rdf)\+xml$/.test(type) && a.href) {
      const url = resolveUrl(a.href, pageUrl);
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}
