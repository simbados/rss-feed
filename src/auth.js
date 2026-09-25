// @ts-check
// Verifies the Cloudflare Access JWT (Cf-Access-Jwt-Assertion) using WebCrypto.
// Access already blocks unauthenticated requests at the edge; this check makes sure
// the Worker can't be reached around Access (e.g. through a misconfigured route).

const KEY_TTL_MS = 60 * 60 * 1000;

/** @type {{ team: string, fetchedAt: number, keys: Map<string, CryptoKey> } | null} */
let keyCache = null;

/** @param {string} s */
function b64urlToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** @param {string} s */
function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/** @param {string} team @param {boolean} force */
async function getKeys(team, force) {
  if (!force && keyCache && keyCache.team === team && Date.now() - keyCache.fetchedAt < KEY_TTL_MS) {
    return keyCache.keys;
  }
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  /** @type {{ keys: (JsonWebKey & { kid: string })[] }} */
  const jwks = await res.json();
  const keys = new Map();
  for (const jwk of jwks.keys) {
    if (jwk.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
      'verify',
    ]);
    keys.set(jwk.kid, key);
  }
  keyCache = { team, fetchedAt: Date.now(), keys };
  return keys;
}

/**
 * @param {Request} request
 * @param {{ ACCESS_TEAM_DOMAIN?: string, ACCESS_AUD?: string, DEV_NO_AUTH?: string }} env
 * @returns {Promise<{ ok: true, email: string } | { ok: false, reason: string }>}
 */
export async function authenticate(request, env) {
  if (env.DEV_NO_AUTH === '1') return { ok: true, email: 'dev@localhost' };

  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud || team.startsWith('REPLACE_ME') || aud === 'REPLACE_ME') {
    return { ok: false, reason: 'Access is not configured' }; // fail closed
  }

  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return { ok: false, reason: 'missing token' };

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };

  try {
    const header = b64urlJson(parts[0]);
    const payload = b64urlJson(parts[1]);
    if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected alg' };

    let keys = await getKeys(team, false);
    if (!keys.has(header.kid)) keys = await getKeys(team, true); // key rotation
    const key = keys.get(header.kid);
    if (!key) return { ok: false, reason: 'unknown key' };

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!valid) return { ok: false, reason: 'bad signature' };

    const now = Math.floor(Date.now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return { ok: false, reason: 'wrong audience' };
    if (payload.iss !== `https://${team}`) return { ok: false, reason: 'wrong issuer' };
    if (typeof payload.exp !== 'number' || payload.exp < now - 30) return { ok: false, reason: 'expired' };
    if (typeof payload.nbf === 'number' && payload.nbf > now + 30) return { ok: false, reason: 'not yet valid' };

    return { ok: true, email: String(payload.email || '') };
  } catch (err) {
    return { ok: false, reason: `verification error: ${/** @type {Error} */ (err).message}` };
  }
}
