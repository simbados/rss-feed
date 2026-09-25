// @ts-check
// Image proxy: GET /img/<article id> fetches the image URL stored for that article.
// The page CSP stays img-src 'self', feed publishers never see the reader's IP, and only
// URLs that came from a feed can be fetched (this is not an open proxy).

import * as db from './db.js';
import { USER_AGENT, readCapped, sha256Hex } from './fetcher.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const EDGE_CACHE_SECONDS = 7 * 86400;
const BROWSER_CACHE_SECONDS = 86400;

/**
 * Raster images only: an SVG can carry script, which would run on our origin if opened directly.
 * @param {string} contentType
 */
export function isAllowedImageType(contentType) {
  return /^image\/(png|jpe?g|gif|webp|avif)\s*(;|$)/i.test(contentType.trim());
}

/**
 * @param {string} url
 * @returns {Promise<{ body: Uint8Array, type: string } | null>} null on any failure
 */
async function fetchImage(url) {
  const refuse = (/** @type {string} */ reason) => {
    console.warn(`img: refused ${new URL(url).hostname}: ${reason}`);
    return null;
  };
  let res;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return refuse(String(err).slice(0, 100));
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !res.body || !isAllowedImageType(type) || Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    await res.body?.cancel();
    return refuse(!res.ok ? `HTTP ${res.status}` : !isAllowedImageType(type) ? `type ${type.slice(0, 50) || 'missing'}` : 'too large');
  }
  const body = await readCapped(res.body, MAX_IMAGE_BYTES).catch(() => null);
  if (!body) return refuse('too large or read failed');
  return { body, type: type.split(';')[0].trim().toLowerCase() };
}

/**
 * Image bytes for an article, from the edge cache or the publisher.
 * The cache key is the image URL itself, so a reused article id can never show a stale image.
 * @param {Request} request @param {any} env @param {{ waitUntil(p: Promise<unknown>): void }} ctx @param {number} id
 * @returns {Promise<{ body: ReadableStream | Uint8Array | null, type: string, maxAge: number } | null>}
 */
export async function articleImage(request, env, ctx, id) {
  const imageUrl = await db.getArticleImageUrl(env.DB, id);
  if (!imageUrl) return null;

  const cache = /** @type {any} */ (caches).default;
  const key = new Request(new URL(`/img-cache/${await sha256Hex(imageUrl)}`, request.url));
  const hit = await cache.match(key);
  if (hit) return { body: hit.body, type: hit.headers.get('content-type') ?? '', maxAge: BROWSER_CACHE_SECONDS };

  const img = await fetchImage(imageUrl);
  if (!img) return null;
  const cached = new Response(img.body, {
    headers: { 'content-type': img.type, 'cache-control': `public, max-age=${EDGE_CACHE_SECONDS}` },
  });
  ctx.waitUntil(cache.put(key, cached));
  return { body: img.body, type: img.type, maxAge: BROWSER_CACHE_SECONDS };
}
