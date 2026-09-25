import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptPayload, vapidAuthorization, b64urlDecode, b64urlEncode } from '../src/webpush.js';

test('aes128gcm encryption matches the RFC 8291 test vector (section 5)', async () => {
  const body = await encryptPayload(
    b64urlDecode('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'), // "When I grow up, I want to be a watermelon"
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    'BTBZMqHH6r4Tts7J_aSIgg',
    {
      publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
      privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
      salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    }
  );
  assert.equal(
    b64urlEncode(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
  );
});

test('VAPID header: ES256 JWT for the endpoint origin, verifiable with the public key', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKey = b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const now = Date.UTC(2026, 8, 25, 17, 0, 0);

  const header = await vapidAuthorization(
    'https://web.push.apple.com/QGuQyavXutnMH/some-token',
    { publicKey, privateKey: d, subject: 'https://rss.example.invalid' },
    now
  );
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, header);
  assert.equal(m[4], publicKey);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64urlDecode(m[1]))), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64urlDecode(m[2]))), {
    aud: 'https://web.push.apple.com',
    exp: now / 1000 + 3600,
    sub: 'https://rss.example.invalid',
  });
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.publicKey,
    b64urlDecode(m[3]),
    new TextEncoder().encode(`${m[1]}.${m[2]}`)
  );
  assert.ok(valid, 'signature verifies');
});
