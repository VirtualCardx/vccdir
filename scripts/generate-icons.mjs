// Generates the site brand assets into public/: favicon.svg, logo.svg,
// favicon-32.png, favicon.ico (PNG-in-ICO), and apple-touch-icon.png.
// Pure geometric rasterizer with supersampling — no image dependencies.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(OUT, { recursive: true });

const GRAD_START = [0x63, 0x66, 0xf1]; // brand-500
const GRAD_END = [0x43, 0x38, 0xca];   // brand-700
const CARD = [0xff, 0xff, 0xff];
const STRIPE = [0x22, 0xd3, 0xee];     // accent-400
const CHIP = [0x63, 0x66, 0xf1];
const CHIP_LIGHT = [0xc7, 0xd2, 0xfe]; // brand-200

// Design coordinates on a 64x64 grid.
const shapes = {
  bg: { x: 0, y: 0, w: 64, h: 64, r: 14 },
  card: { x: 12, y: 19, w: 40, h: 27, r: 5 },
  stripe: { x: 12, y: 25, w: 40, h: 6, r: 0 },
  chip: { x: 17, y: 36, w: 16, h: 4, r: 2 },
  chipLight: { x: 37, y: 36, w: 10, h: 4, r: 2 },
};

function inRoundRect(x, y, rect) {
  const dx = Math.max(Math.abs(x - (rect.x + rect.w / 2)) - (rect.w / 2 - rect.r), 0);
  const dy = Math.max(Math.abs(y - (rect.y + rect.h / 2)) - (rect.h / 2 - rect.r), 0);
  return dx * dx + dy * dy <= rect.r * rect.r;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function render(size, { backgroundRadius }) {
  const bg = { ...shapes.bg, r: backgroundRadius };
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * (64 / size);
          const y = (py + (sy + 0.5) / SS) * (64 / size);
          if (!inRoundRect(x, y, bg)) continue;
          let color = mix(GRAD_START, GRAD_END, (x + y) / 128);
          if (inRoundRect(x, y, shapes.card)) color = CARD;
          if (inRoundRect(x, y, shapes.stripe)) color = STRIPE;
          if (inRoundRect(x, y, shapes.chip)) color = CHIP;
          if (inRoundRect(x, y, shapes.chipLight)) color = CHIP_LIGHT;
          r += color[0]; g += color[1]; b += color[2]; a += 255;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      const cover = a / n;
      rgba[i] = a ? Math.round(r / (a / 255)) : 0;
      rgba[i + 1] = a ? Math.round(g / (a / 255)) : 0;
      rgba[i + 2] = a ? Math.round(b / (a / 255)) : 0;
      rgba[i + 3] = Math.round(cover);
    }
  }
  return rgba;
}

// --- Minimal PNG encoder (RGBA, filter 0) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO container holding a PNG (supported everywhere Vista+) ---
function encodeIco(png, size) {
  const out = Buffer.alloc(22 + png.length);
  out.writeUInt16LE(0, 0); out.writeUInt16LE(1, 2); out.writeUInt16LE(1, 4);
  out[6] = size; out[7] = size; out[8] = 0; out[9] = 0;
  out.writeUInt16LE(1, 10); out.writeUInt16LE(32, 12);
  out.writeUInt32LE(png.length, 14); out.writeUInt32BE(22, 18);
  png.copy(out, 22);
  return out;
}

const svg = (r) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs><rect width="64" height="64" rx="${r}" fill="url(#g)"/><rect x="12" y="19" width="40" height="27" rx="5" fill="#fff"/><rect x="12" y="25" width="40" height="6" fill="#22d3ee"/><rect x="17" y="36" width="16" height="4" rx="2" fill="#6366f1"/><rect x="37" y="36" width="10" height="4" rx="2" fill="#c7d2fe"/></svg>`;

// Corner radius: rx 26 on the 64-grid equals the rounded-2xl (16px) token at the
// 40px nav display size, matching the site's button and card language.
writeFileSync(join(OUT, 'favicon.svg'), svg(26));
writeFileSync(join(OUT, 'logo.svg'), svg(26));
writeFileSync(join(OUT, 'favicon-32.png'), encodePng(32, render(32, { backgroundRadius: 26 })));
writeFileSync(join(OUT, 'favicon.ico'), encodeIco(encodePng(32, render(32, { backgroundRadius: 26 })), 32));
writeFileSync(join(OUT, 'apple-touch-icon.png'), encodePng(180, render(180, { backgroundRadius: 0 })));
console.log('generated: favicon.svg logo.svg favicon-32.png favicon.ico apple-touch-icon.png');
