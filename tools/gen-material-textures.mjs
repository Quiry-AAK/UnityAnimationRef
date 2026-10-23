// Yerleşik materyal dokularını üretir: materials/textures/<ad>.png (noise: döşenebilir gürültü, checker: UV testi, ramp: toon rampası).
// Çalıştır: node tools/gen-material-textures.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'materials', 'textures');
fs.mkdirSync(OUT, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function write(name, w, h, fn) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a = 1] = fn(x, y); const i = (y * w + x) * 4; buf[i] = r * 255; buf[i + 1] = g * 255; buf[i + 2] = b * 255; buf[i + 3] = a * 255; }
  fs.writeFileSync(path.join(OUT, name + '.png'), png(w, h, buf)); console.log(name + '.png', w + 'x' + h);
}

// döşenebilir değer gürültüsü (fbm)
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
function vnoise(x, y, s, p) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, w = (t) => t * t * (3 - 2 * t);
  const h = (a, b) => hash(((a % p) + p) % p, ((b % p) + p) % p, s);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * w(fx) + (c - a) * w(fy) + (a - b - c + d) * w(fx) * w(fy);
}
const fbm = (x, y) => { let v = 0, amp = 0.5, f = 1, n = 0; for (let o = 0; o < 6; o++) { v += amp * vnoise(x * f, y * f, 3 + o, 8 * f); n += amp; amp *= 0.5; f *= 2; } return v / n; };

write('noise', 256, 256, (x, y) => { const v = Math.min(1, Math.max(0, (fbm((x / 256) * 8, (y / 256) * 8) - 0.5) * 1.6 + 0.5)); return [v, v, v]; });
write('checker', 256, 256, (x, y) => { const c = ((x >> 5) + (y >> 5)) & 1; const u = x / 255, v = 1 - y / 255; const k = c ? 0.85 : 0.35; return [k * (0.7 + 0.3 * u), k * (0.7 + 0.3 * v), k]; });
write('ramp', 256, 8, (x) => { const v = x / 255; return [v, v, v]; });
