// @ts-check
// Web Push sender, WebCrypto only: VAPID authentication (RFC 8292) and aes128gcm payload
// encryption (RFC 8291). The push service (e.g. Apple's) only forwards the encrypted message.

const enc = new TextEncoder();
const JWT_LIFETIME_S = 3600;
const MAX_PAYLOAD_BYTES = 3000; // well below the 4096-byte record the push services accept

/** @param {string} s */
export function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** @param {Uint8Array} bytes */
export function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {Uint8Array[]} parts */
function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** HKDF-SHA-256 (extract + expand). @param {Uint8Array} salt @param {Uint8Array} ikm @param {Uint8Array} info @param {number} length */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * P-256 private key as JWK from the 65-byte uncompressed public key and the base64url scalar d.
 * @param {Uint8Array} publicRaw @param {string} d
 */
function privateJwk(publicRaw, d) {
  return { kty: 'EC', crv: 'P-256', x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), d };
}

/**
 * Encrypt a push message for one subscription (RFC 8291, single aes128gcm record).
 * `fixed` is only for tests: the RFC's sender key pair and salt instead of random ones.
 * @param {Uint8Array} plaintext
 * @param {string} p256dh subscription public key (base64url)
 * @param {string} auth subscription auth secret (base64url)
 * @param {{ publicKey: string, privateKey: string, salt: string }} [fixed]
 */
export async function encryptPayload(plaintext, p256dh, auth, fixed) {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  const ecdh = { name: 'ECDH', namedCurve: 'P-256' };

  /** @type {CryptoKey} */ let asPrivate;
  /** @type {Uint8Array} */ let asPublic;
  if (fixed) {
    asPublic = b64urlDecode(fixed.publicKey);
    asPrivate = await crypto.subtle.importKey('jwk', privateJwk(asPublic, fixed.privateKey), ecdh, false, ['deriveBits']);
  } else {
    const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey(ecdh, true, ['deriveBits']));
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(/** @type {ArrayBuffer} */ (await crypto.subtle.exportKey('raw', pair.publicKey)));
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ecdh, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);

  const salt = fixed ? b64urlDecode(fixed.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (and only) record; no extra padding.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2])))
  );

  // Header: salt (16) | record size (4, big endian) | key id length (1) | key id = sender public key
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/**
 * @typedef {{ publicKey: string, privateKey: string, subject: string }} Vapid
 *   publicKey: 65-byte uncompressed P-256 key, privateKey: scalar d, both base64url;
 *   subject: contact URL (https: or mailto:) the push service can use to reach us.
 */

/**
 * `Authorization` header value for a push endpoint (RFC 8292).
 * @param {string} endpoint @param {Vapid} vapid @param {number} [now]
 */
export async function vapidAuthorization(endpoint, vapid, now = Date.now()) {
  const json = (/** @type {object} */ o) => b64urlEncode(enc.encode(JSON.stringify(o)));
  const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + JWT_LIFETIME_S,
    sub: vapid.subject,
  })}`;
  const key = await crypto.subtle.importKey(
    'jwk',
    privateJwk(b64urlDecode(vapid.publicKey), vapid.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  // WebCrypto returns the raw r||s signature that JWS ES256 expects.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64urlEncode(signature)}, k=${vapid.publicKey}`;
}

/** VAPID settings from the Worker env, or null when push is not configured. @param {any} env @returns {Vapid|null} */
export function vapidFromEnv(env) {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/**
 * The first `max` characters of a response body, without reading the rest.
 * @param {Response} res @param {number} max
 */
async function readStart(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value ?? new Uint8Array()).slice(0, max);
}

/**
 * Send one message. Never throws.
 * @param {{ endpoint: string, p256dh: string, auth: string }} sub
 * @param {object} message JSON the service worker receives
 * @param {Vapid} vapid
 * @returns {Promise<{ ok: boolean, gone: boolean, error: string }>} gone: the subscription no longer exists
 */
export async function sendPush(sub, message, vapid) {
  try {
    const plaintext = enc.encode(JSON.stringify(message));
    if (plaintext.length > MAX_PAYLOAD_BYTES) return { ok: false, gone: false, error: 'message too large' };
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        authorization: await vapidAuthorization(sub.endpoint, vapid),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: '86400', // deliver within a day if the phone is offline
        urgency: 'normal',
      },
      body: await encryptPayload(plaintext, sub.p256dh, sub.auth),
      redirect: 'manual', // a push service answers directly; never follow to somewhere else
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true, gone: false, error: '' };
    const text = await readStart(res, 200);
    return { ok: false, gone: res.status === 404 || res.status === 410, error: `HTTP ${res.status} ${text}`.trim() };
  } catch (err) {
    return { ok: false, gone: false, error: String(err) };
  }
}
