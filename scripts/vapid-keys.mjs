// Generates a VAPID key pair for Web Push. Node built-ins only. Run: node scripts/vapid-keys.mjs
// The public key goes into wrangler.toml; the private key is a Worker secret and must stay private.
// Only the user runs this, in their own terminal — agents must not run it (the output contains the secret).
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log(`Public key  → wrangler.toml [vars]:\n  VAPID_PUBLIC_KEY = "${publicKey}"\n`);
console.log(`Private key → Worker secret VAPID_PRIVATE_KEY (dashboard: Settings → Variables and Secrets, type Secret):\n  ${d}`);
