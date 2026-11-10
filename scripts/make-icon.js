'use strict';
/*
 * Generates Mochi's app icon (build/icon.png, used by the installer) and the
 * README logo (docs/images/logo.png) — no image tools needed.
 *   node scripts/make-icon.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = ~0;
  for (const b of buf) { crc ^= b; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1)); }
  return (~crc) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const TEAL = [94, 231, 214], VIOLET = [124, 108, 246], INK = [14, 14, 26], CHEEK = [255, 140, 180];

// Signed distance (in unit space, icon spans -1..1) to a soft droplet.
function blobSdf(x, y) {
  const qx = x / 0.86, qy = (y - 0.06) / (y < 0.06 ? 0.8 : 0.74); // squashed, flatter bottom
  return (Math.hypot(qx, qy) - 1) * 0.78;
}
function ellipse(x, y, cx, cy, rx, ry) { return (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry); }

function shade(x, y) {
  const d = blobSdf(x, y);
  if (d > 0.02) {
    // soft contact shadow below
    const s = Math.exp(-Math.max(0, blobSdf(x, y - 0.05)) / 0.05) * 0.22;
    return [0, 0, 0, s];
  }
  const t = clamp((y + 0.75) / 1.5);
  let c = [mix(TEAL[0], VIOLET[0], t), mix(TEAL[1], VIOLET[1], t), mix(TEAL[2], VIOLET[2], t)];
  // inner depth: darker towards the rim, glowing core
  const depth = clamp(-d / 0.35);
  c = c.map((v) => v * (0.78 + 0.22 * depth));
  const core = Math.exp(-((x * x) + (y - 0.15) ** 2) * 2.2) * 0.18;
  c = c.map((v) => v + 255 * core);
  // rim light
  const rim = sstep(0.06, 0, -d) * 0.35;
  c = c.map((v) => mix(v, 255, rim * 0.5));
  // glossy highlight top-left
  const hl = 1 - sstep(0, 0.02, ellipse(x, y, -0.36, -0.42, 0.2, 0.11));
  c = c.map((v) => mix(v, 255, hl * 0.75));
  // eyes + catchlights
  for (const ex of [-0.27, 0.27]) {
    const e = 1 - sstep(-0.006, 0.006, ellipse(x, y, ex, 0.02, 0.085, 0.13));
    c = c.map((v, i) => mix(v, INK[i], e));
    const h = 1 - sstep(-0.004, 0.004, ellipse(x, y, ex - 0.03, -0.035, 0.03, 0.03));
    c = c.map((v) => mix(v, 255, h * 0.95));
    const ck = Math.exp(-(((x - ex * 1.35) ** 2) + (y - 0.24) ** 2) / 0.006) * 0.45;
    c = c.map((v, i) => mix(v, CHEEK[i], ck));
  }
  const a = sstep(0.02, -0.002, d);
  return [...c, a];
}

function render(size) {
  const ss = 4; // supersampling
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / ss) / size) * 2 - 1;
          const [cr, cg, cb, ca] = shade(x * 1.04, y * 1.04);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = ss * ss, i = (py * size + px) * 4;
      out[i] = a ? Math.round(clamp(r / a, 0, 255)) : 0;
      out[i + 1] = a ? Math.round(clamp(g / a, 0, 255)) : 0;
      out[i + 2] = a ? Math.round(clamp(b / a, 0, 255)) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, out);
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'docs', 'images'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), render(256));
fs.writeFileSync(path.join(root, 'docs', 'images', 'logo.png'), render(512));
console.log('wrote build/icon.png and docs/images/logo.png');
