import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedImageType, readCapped } from '../src/images.js';

test('only raster image types are proxied', () => {
  for (const t of ['image/jpeg', 'image/png; charset=binary', 'IMAGE/WEBP', 'image/gif', 'image/avif', 'image/jpg']) {
    assert.ok(isAllowedImageType(t), t);
  }
  for (const t of ['image/svg+xml', 'text/html', 'image/jpeg2000', 'application/octet-stream', '']) {
    assert.ok(!isAllowedImageType(t), t);
  }
});

test('readCapped returns the body or null once it exceeds the limit', async () => {
  const stream = (...sizes) =>
    new ReadableStream({
      start(c) {
        for (const n of sizes) c.enqueue(new Uint8Array(n).fill(7));
        c.close();
      },
    });
  const body = await readCapped(stream(3, 4), 10);
  assert.deepEqual(body, new Uint8Array(7).fill(7));
  assert.equal(await readCapped(stream(6, 6), 10), null);
});
