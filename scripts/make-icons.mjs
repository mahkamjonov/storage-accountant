// PWA ikonkalarini (PNG) yaratadi: qorong'i fon ustida quti belgisi. Qo'shimcha kutubxona kerak emas.
// Ishga tushirish: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x23, 0x26, 0x2f];
const FG = [0xf7, 0xf5, 0xf0];

// Quti chiziqlari (64x64 koordinatalarda, icon.svg bilan bir xil).
const SEGMENTS = [
  [16, 23, 32, 15], [32, 15, 48, 23], [48, 23, 48, 41], [48, 41, 32, 49], [32, 49, 16, 41], [16, 41, 16, 23],
  [16, 23, 32, 31], [32, 31, 48, 23], [32, 31, 32, 49],
];

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size, { rounded, scale }) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const unit = size / 64;
  const radius = rounded ? 14 * unit : 0;
  const half = 1.8; // chiziq yarim qalinligi (64 birlikda)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // Burchaklar: yumaloq bo'lsa, tashqarisi shaffof.
      let alpha = 1;
      if (rounded) {
        const cx = Math.min(Math.max(x + 0.5, radius), size - radius);
        const cy = Math.min(Math.max(y + 0.5, radius), size - radius);
        alpha = Math.max(0, Math.min(1, radius - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
      }
      // Belgi markazdan `scale` bo'yicha kichraytiriladi (maskable uchun xavfsiz hudud).
      const gx = 32 + ((x + 0.5) / unit - 32) / scale;
      const gy = 32 + ((y + 0.5) / unit - 32) / scale;
      const d = Math.min(...SEGMENTS.map((s) => distToSegment(gx, gy, s)));
      const ink = Math.max(0, Math.min(1, (half - d) * unit * scale + 0.5));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] + (FG[i] - BG[i]) * ink);
      raw[o + 3] = Math.round(alpha * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = 'web/public';
writeFileSync(`${out}/icon-192.png`, render(192, { rounded: false, scale: 1 }));
writeFileSync(`${out}/icon-512.png`, render(512, { rounded: true, scale: 1 }));
writeFileSync(`${out}/icon-maskable-512.png`, render(512, { rounded: false, scale: 0.75 }));
console.log('Ikonkalar yaratildi.');
