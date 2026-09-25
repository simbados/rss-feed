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
 * @property {string} imageUrl  absolute http(s) URL or ''
 *
 * @typedef {Object} ParsedFeed
 * @property {'rss'|'atom'|'rdf'} format
 * @property {string} title
 * @property {string} siteUrl
 * @property {FeedItem[]} items
 */

export const MAX_ITEMS = 100;
export const SNIPPET_LENGTH = 300;
/** Longer URLs are dropped: real ones are far shorter, and a hostile feed could otherwise fill D1. */
export const MAX_URL_LENGTH = 2000;

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

// Linear-time scanning. Feeds are untrusted: a regex like /<x>[\s\S]*?<\/x>/g rescans to the end of the
// document for every unclosed <x>, which is O(n²) — a few hundred KB of "<item><item>…" then takes
// seconds and gets the cron killed. These helpers find the end with indexOf/one forward search and
// stop at the first start that has no end, so every character is looked at a bounded number of times.

/**
 * Replace every `start … end` span with `replacement(inner)`; a start without an end is left as is.
 * @param {string} s @param {string} start @param {string} end @param {(inner: string) => string} replacement
 */
function replaceSpans(s, start, end, replacement) {
  let out = '';
  let pos = 0;
  for (;;) {
    const a = s.indexOf(start, pos);
    if (a === -1) break;
    const b = s.indexOf(end, a + start.length);
    if (b === -1) break;
    out += s.slice(pos, a) + replacement(s.slice(a + start.length, b));
    pos = b + end.length;
  }
  return out + s.slice(pos);
}

const DROPPED_ELEMENTS = /<(script|style|noscript|iframe|object|svg|math)\b/gi;

/**
 * Remove script-like elements with their content. An open tag without a closing tag is left to
 * stripTags (so "Why <svg> beats PNG" keeps its text); once a name has no closing tag, later opens
 * of it aren't searched again — that keeps this linear (at most one full search per name).
 * @param {string} s
 */
function dropElements(s) {
  let out = '';
  let pos = 0;
  const unclosed = new Set();
  const open = new RegExp(DROPPED_ELEMENTS.source, 'gi');
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = open.exec(s))) {
    const name = m[1].toLowerCase();
    if (unclosed.has(name)) continue;
    const close = new RegExp(`</${name}\\s*>`, 'gi');
    close.lastIndex = open.lastIndex;
    const c = close.exec(s);
    if (!c) {
      unclosed.add(name);
      continue;
    }
    out += s.slice(pos, m.index) + ' ';
    pos = open.lastIndex = close.lastIndex;
  }
  return out + s.slice(pos);
}

/**
 * Replace every tag (`<a …>`, `</p>`, `<!…>`, `<?…>`) with a space. A `<` without a later `>` ends the scan.
 * @param {string} s
 */
function stripTags(s) {
  let out = '';
  let pos = 0;
  const open = /<\/?[a-z!?]/gi;
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = open.exec(s))) {
    const close = s.indexOf('>', m.index);
    if (close === -1) break;
    out += s.slice(pos, m.index) + ' ';
    pos = open.lastIndex = close + 1;
  }
  return out + s.slice(pos);
}

/**
 * Attribute strings of all `<name …>` tags in an HTML fragment (e.g. every <img> or <link>).
 * @param {string} html @param {string} name
 */
function tagAttributes(html, name) {
  const out = [];
  const open = new RegExp(`<${name}(?=[\\s/>])`, 'gi');
  /** @type {RegExpExecArray | null} */
  let m;
  while ((m = open.exec(html))) {
    const close = html.indexOf('>', open.lastIndex);
    if (close === -1) break;
    out.push(html.slice(open.lastIndex, close));
    open.lastIndex = close + 1;
  }
  return out;
}

/** Turn an HTML fragment into collapsed plain text. */
export function htmlToText(/** @type {string} */ s) {
  return decodeEntities(stripTags(dropElements(replaceSpans(s, '<!--', '-->', () => ' '))))
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
    // Raw NULs are replaced first: they would otherwise forge CDATA placeholders (\u0000N\u0000) and
    // let a tiny title expand into copies of a huge CDATA section.
    this.xml = replaceSpans(
      replaceSpans(xml.replace(/^\uFEFF/, '').replaceAll('\u0000', '\uFFFD'), '<![CDATA[', ']]>', (content) => `\u0000${this.cdata.push(content) - 1}\u0000`),
      '<!--',
      '-->',
      () => ''
    );
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
 * @param {number} [limit] stop after this many elements
 * @returns {{attrs: Record<string,string>, inner: string}[]}
 */
function elements(xml, tag, limit = Infinity) {
  const t = escapeRe(tag);
  const open = new RegExp(`<${t}(?=[\\s/>])`, 'gi');
  const close = new RegExp(`</${t}\\s*>`, 'gi');
  const out = [];
  /** @type {RegExpExecArray | null} */
  let m;
  while (out.length < limit && (m = open.exec(xml))) {
    const gt = xml.indexOf('>', open.lastIndex);
    if (gt === -1) break;
    const selfClosing = xml[gt - 1] === '/';
    const attrs = parseAttrs(xml.slice(open.lastIndex, selfClosing ? gt - 1 : gt));
    if (selfClosing) {
      out.push({ attrs, inner: '' });
      open.lastIndex = gt + 1;
      continue;
    }
    close.lastIndex = gt + 1;
    const c = close.exec(xml);
    if (!c) break; // no closing tag anywhere after this one → none for later ones either
    out.push({ attrs, inner: xml.slice(gt + 1, c.index) });
    open.lastIndex = close.lastIndex;
  }
  return out;
}

/** @param {string} s */
function parseAttrs(s) {
  /** @type {Record<string,string>} */
  const attrs = {};
  // Values may be "double", 'single' or unquoted (unquoted is common in minified HTML).
  // The lookbehind makes a name start only at the beginning of a word, so a long word that isn't
  // followed by "=" is tried once, not once per character (which would be O(n²)).
  for (const m of s.matchAll(/(?<![\w:.-])([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
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
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return '';
  try {
    const href = new URL(trimmed, base || undefined).href;
    return href.length > MAX_URL_LENGTH ? '' : href;
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
 * Image of an item: media:thumbnail, an image media:content/enclosure, else the first <img>
 * in the HTML body. 1×1 tracking pixels are skipped. @param {Doc} doc @param {string} xml
 */
function findImage(doc, xml) {
  const thumb = elements(xml, 'media:thumbnail').find((e) => e.attrs.url);
  if (thumb) return thumb.attrs.url;
  const media = [...elements(xml, 'media:content'), ...elements(xml, 'enclosure')].find(
    (e) => e.attrs.url && (e.attrs.medium === 'image' || /^image\//i.test(e.attrs.type || ''))
  );
  if (media) return media.attrs.url;
  for (const tag of ['description', 'content:encoded', 'content', 'summary']) {
    for (const el of elements(xml, tag)) {
      for (const attrs of tagAttributes(doc.text(el.inner), 'img')) {
        const a = parseAttrs(attrs);
        if (a.src && a.width !== '1' && a.height !== '1') return a.src;
      }
    }
  }
  return '';
}

/**
 * True for text that is unrendered server-side template code, e.g.
 * "$esc.escapeXml($m.title)", "${title}" or "{{ title }}". A bare "$TSLA" is not matched.
 * @param {string} s
 */
export function isTemplatePlaceholder(s) {
  const t = s.trim();
  if (t.length > 200) return false; // template leftovers are short
  // No nested quantifiers that could split the same text in several ways, so a hostile title
  // can't make the regex backtrack exponentially (e.g. "$a()()()…()!").
  if (/^\$!?\{.+\}$|^\{\{.*\}\}$/.test(t)) return true;
  // $name, $name.member…, optionally one call: $name.fn(…) — needs at least one "." or "(".
  return /^\$!?[a-z_]\w*(?:\.\w+)*(?:\(.*\)(?:\.\w+)*)?$/i.test(t) && /[.(]/.test(t);
}

/**
 * "<b>Label:</b> value" pairs of an HTML description; labels without the trailing colon.
 * @param {string} html
 */
function labelledFields(html) {
  const fields = new Map();
  for (const m of html.matchAll(/<b>([^<]+)<\/b>([\s\S]*?)(?=<b>|$)/gi)) {
    fields.set(htmlToText(m[1]).replace(/:$/, ''), htmlToText(m[2]));
  }
  return fields;
}

/**
 * @typedef {(item: { title: string, body: string, descriptionHtml: string }) => { title: string, body: string }} SiteRule
 */

/**
 * lebensmittelwarnung.de ships an unrendered template as every item title (reported 2026-09-25)
 * and starts every description with the image credit. Rebuild both from the labelled fields.
 * @type {SiteRule}
 */
function lebensmittelwarnung({ title, body, descriptionHtml }) {
  const f = labelledFields(descriptionHtml);
  const product = f.get('Produktbezeichnung/ -beschreibung');
  const reason = f.get('Grund der Meldung');
  if (!title && product) title = reason ? `${product} – ${reason}` : product;
  const summary = [
    ['Grund', reason],
    ['Haltbarkeit', f.get('Haltbarkeit')],
    ['Charge', f.get('Chargennummer / Los-Kennzeichnung')],
  ]
    .filter(([, v]) => v)
    .map(([label, v]) => `${label}: ${v}`)
    .join(' · ');
  return { title, body: summary || body };
}

/**
 * Repairs for feeds that are broken at the source, keyed by host without "www.".
 * @type {Record<string, SiteRule>}
 */
const SITE_RULES = {
  'lebensmittelwarnung.de': lebensmittelwarnung,
};

/** @param {string} url */
function siteRuleFor(url) {
  try {
    return SITE_RULES[new URL(url).hostname.replace(/^www\./, '')];
  } catch {
    return undefined;
  }
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
  const siteRule = siteRuleFor(feedUrl);

  /** @type {FeedItem[]} */
  const items = [];
  // At most MAX_ITEMS elements are examined, kept or not: 5 MB of empty <item/> must not cost
  // hundreds of thousands of iterations.
  for (const el of elements(src, itemTag, MAX_ITEMS)) {
    const x = el.inner;
    const guidEl = elements(x, format === 'atom' ? 'id' : 'guid')[0];
    const guid = guidEl ? doc.text(guidEl.inner).trim() : el.attrs['rdf:about'] || '';

    let link = findLink(doc, x);
    if (!link && guidEl && /^https?:\/\//i.test(guid) && guidEl.attrs.ispermalink !== 'false') link = guid;
    const url = resolveUrl(link, base);

    let itemTitle = firstText(doc, x, ['title']);
    if (isTemplatePlaceholder(itemTitle)) itemTitle = '';
    let body = firstText(doc, x, ['description', 'summary', 'content:encoded', 'content', 'media:description']);
    if (siteRule) {
      const descriptionHtml = doc.text(elements(x, 'description')[0]?.inner ?? '');
      ({ title: itemTitle, body } = siteRule({ title: itemTitle, body, descriptionHtml }));
    }
    const authorEl = elements(x, 'author')[0];
    const author =
      (authorEl && (firstText(doc, authorEl.inner, ['name']) || htmlToText(doc.text(authorEl.inner)))) ||
      firstText(doc, x, ['dc:creator']);
    const publishedAt = parseDate(firstText(doc, x, ['pubDate', 'published', 'dc:date', 'updated', 'issued']));

    const imageUrl = resolveUrl(findImage(doc, x), base);

    if (!itemTitle && !url) continue;
    items.push({
      guid: guid || url || `${itemTitle}|${publishedAt ?? ''}`,
      url,
      title: truncate(itemTitle || url, 500),
      snippet: truncate(body, SNIPPET_LENGTH),
      author: truncate(author, 200),
      publishedAt,
      imageUrl: /^https?:\/\//i.test(imageUrl) ? imageUrl : '',
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
  for (const attrs of tagAttributes(htmlSrc, 'link')) {
    const a = parseAttrs(attrs);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    const type = (a.type || '').toLowerCase();
    if (rel.includes('alternate') && /^application\/(rss|atom|rdf)\+xml$/.test(type) && a.href) {
      const url = resolveUrl(a.href, pageUrl);
      if (url && !urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}
