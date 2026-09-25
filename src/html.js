// @ts-check
// Escape-by-default HTML templating. Every interpolated value is escaped unless
// it is itself the result of `html` or explicitly wrapped with `raw()`.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {unknown} value */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[/** @type {keyof ESCAPES} */ (c)]);
}

export class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

/**
 * Mark a string as trusted markup. Only use with our own static strings,
 * never with anything derived from feeds or user input.
 * @param {string} value
 */
export const raw = (value) => new SafeHtml(value);

/** @param {unknown} value @returns {string} */
function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

/**
 * Tagged template: html`<p>${untrusted}</p>`
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/**
 * Only allow absolute http(s) URLs; everything else (javascript:, data:, garbage) becomes "#".
 * @param {unknown} url
 */
export function safeUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '#';
  } catch {
    return '#';
  }
}
