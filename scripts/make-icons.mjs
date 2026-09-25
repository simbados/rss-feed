// Generates src/icons/*.png: the "R" app icon (same geometry as ICON_SVG in src/static.js) as PNGs.
// The Worker imports them as binary data (see [[rules]] in wrangler.toml).
// Node built-ins only. Run: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const BG = [0xb4, 0x53, 0x09]; // --accent (light theme)
const FG = [0xfa, 0xfa, 0xf9]; // --bg (light theme)
const STROKE = 32; // half of stroke-width 64, in the 512 × 512 design space

// The "R" from ICON_SVG: M172 392V120h88a80 80 0 0 1 0 160h-88M248 280l92 112
const SEGMENTS = [
  [172, 392, 172, 120],
  [172, 120, 260, 120],
  [260, 280, 172, 280],
  [248, 280, 340, 392],
];
const ARC = { cx: 260, cy: 200, r: 80 }; // right half circle between (260,120) and (260,280)

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function inGlyph(x, y) {
  if (x >= ARC.cx && Math.abs(Math.hypot(x - ARC.cx, y - ARC.cy) - ARC.r) <= STROKE) return true;
  return SEGMENTS.some((s) => distToSegment(x, y, s) <= STROKE);
}

function inRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 512 - radius);
  const cy = Math.min(Math.max(y, radius), 512 - radius);
  return x >= 0 && x <= 512 && y >= 0 && y <= 512 && Math.hypot(x - cx, y - cy) <= radius;
}

/**
 * @param {number} size output pixels
 * @param {{ radius: number, glyphScale: number }} o corner radius and glyph scale (maskable: keep in safe zone)
 */
function render(size, { radius, glyphScale }) {
  const SS = 4; // 4 × 4 supersampling
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 512;
          const y = ((py + (sy + 0.5) / SS) / size) * 512;
          if (!inRoundedSquare(x, y, radius)) continue;
          bg++;
          if (inGlyph(256 + (x - 256) / glyphScale, 256 + (y - 256) / glyphScale)) fg++;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = bg ? Math.round((BG[c] * (bg - fg) + FG[c] * fg) / bg) : 0;
      rgba[i + 3] = Math.round((255 * bg) / n);
    }
  }
  return png(size, rgba);
}

function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const raw = Buffer.alloc(size * (size * 4 + 1)); // filter byte 0 before each row
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = {
  // iOS rounds the corners itself and wants a full square.
  '/apple-touch-icon.png': render(180, { radius: 0, glyphScale: 1 }),
  '/icon-192.png': render(192, { radius: 96, glyphScale: 1 }),
  '/icon-512.png': render(512, { radius: 96, glyphScale: 1 }),
  // Maskable: full bleed, glyph shrunk into the 80 % safe zone.
  '/icon-512-maskable.png': render(512, { radius: 0, glyphScale: 0.8 }),
};

const dir = new URL('../src/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const [path, buf] of Object.entries(icons)) {
  writeFileSync(new URL(path.slice(1), dir), buf);
  console.log(`src/icons${path}: ${buf.length} bytes`);
}
