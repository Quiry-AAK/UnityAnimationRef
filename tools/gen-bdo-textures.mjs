// BDO stili VFX dokuları: vfx/textures/bdo_*.png (beyaz/gri RGB + alfa; renk parçacıktan gelir).
// Çalıştır: node tools/gen-bdo-textures.mjs
//  bdo_duman  : 4x4 flipbook, enerji dumanı/kıvrım (domain warp'lı fbm; kareler boyunca açılıp incelir, aşınır)
//  bdo_kivrim : tek kıvrımlı uzun duman şeridi (yanlara savrulan ince enerji kuyruğu)
//  bdo_parilti: keskin 4 kollu yıldız + çapraz ince kollar (isabet/parıltı)
//  bdo_cizgi  : çok ince, ucu sivri ışık çizgisi (stretched kıvılcım)
//  bdo_cakma  : merkez çakması + yatay anamorfik çizgi (lens parlaması)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'vfx', 'textures');
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
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const clamp = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const w = (t) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * w(fx) + (c - a) * w(fy) + (a - b - c + d) * w(fx) * w(fy);
}
const fbm = (x, y, s, oct = 5) => { let v = 0, amp = 0.5, f = 1; for (let o = 0; o < oct; o++) { v += amp * vnoise(x * f, y * f, s + o * 17); amp *= 0.5; f *= 2.03; } return v; };

// tek kare üretici: (u,v ∈ [-1,1], v yukarı) → [parlaklık, alfa]
function write(name, W, H, frames, fn) {
  const buf = Buffer.alloc(W * H * 4);
  const fx = frames ? frames[0] : 1, fy = frames ? frames[1] : 1, cw = W / fx, ch = H / fy;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const col = Math.floor(x / cw), row = Math.floor(y / ch), k = row * fx + col, n = fx * fy;
    const u = ((x % cw) + 0.5) / cw * 2 - 1, v = 1 - ((y % ch) + 0.5) / ch * 2;
    let o = fn(u, v, Math.hypot(u, v), n > 1 ? k / (n - 1) : 0); if (!Array.isArray(o)) o = [1, o];
    const i = (y * W + x) * 4, l = Math.round(clamp(o[0]) * 255);
    buf[i] = l; buf[i + 1] = l; buf[i + 2] = l; buf[i + 3] = Math.round(clamp(o[1]) * 255);
  }
  fs.writeFileSync(path.join(OUT, name + '.png'), png(W, H, buf)); console.log('yazıldı', name);
}

// enerji dumanı: t 0→1 boyunca genişler, kıvrılır, eşik yükselir (aşınır), kenarlar parlak lifli kalır
write('bdo_duman', 512, 512, [4, 4], (u, v, r, t) => {
  const sc = 0.75 + 0.55 * t;
  const uu = u / sc, vv = v / sc;
  const wx = fbm(uu * 1.6 + 3, vv * 1.6 + t * 0.9, 5, 4) - 0.5, wy = fbm(uu * 1.6 + 9, vv * 1.6 - t * 0.7, 9, 4) - 0.5;
  const px = uu + wx * (0.9 + t), py = vv + wy * (0.9 + t);
  const n = fbm(px * 2.2 + 1, py * 2.2 + t * 1.3, 21);
  const fib = fbm(px * 7 + t, py * 1.5, 33, 3);
  const fall = clamp(1 - Math.hypot(px * 0.9, py * 1.05) * 0.6 - r * 0.55) ** 1.2;
  const th = 0.28 + 0.4 * t;
  const a = smooth(th, th + 0.22, n * (0.6 + 0.6 * fall) + fall * 0.35) * smooth(0.98, 0.55 + 0.2 * t, r) * (1 - t * 0.35);
  const edge = smooth(th, th + 0.08, n) * (1 - smooth(th + 0.08, th + 0.3, n));
  return [0.55 + 0.35 * fib + 0.4 * edge, a];
});

// tek kıvrım şeridi: yatay boyunca uzanan, sinüsle kıvrılan ince duman kuyruğu
write('bdo_kivrim', 256, 128, null, (u, v) => {
  const x = (u + 1) / 2;
  const c = 0.25 * Math.sin(x * 5.2 + 0.6) * x + (fbm(x * 3, 0.5, 4, 3) - 0.5) * 0.35;
  const wdt = 0.06 + 0.32 * Math.sin(Math.PI * x) ** 0.8;
  const d = Math.abs(v - c) / wdt;
  const n = fbm(x * 9, v * 3 + x * 2, 12, 4);
  const a = smooth(1, 0.35, d) * smooth(0, 0.12, x) * smooth(1, 0.7, x) * smooth(0.25, 0.55, n + 0.3 * (1 - d));
  return [0.6 + 0.4 * (1 - d) * n, a];
});

write('bdo_parilti', 128, 128, null, (u, v, r) => {
  const ray = (a, b, len, w) => Math.exp(-Math.abs(a) * len) * Math.exp(-b * b * w);
  const d1 = (u + v) / Math.SQRT2, d2 = (u - v) / Math.SQRT2;
  const s = ray(u, v, 2.4, 1400) + ray(v, u, 2.4, 1400) + 0.45 * (ray(d1, d2, 5, 2400) + ray(d2, d1, 5, 2400)) + Math.exp(-r * r * 60) + 0.3 * Math.exp(-r * r * 8);
  return clamp(s) * smooth(1, 0.9, r);
});

write('bdo_cizgi', 128, 32, null, (u, v) => {
  const along = 1 - Math.abs(u); // ortası kalın, iki ucu sivri
  const w = 0.03 + 0.22 * along ** 1.5;
  return clamp(Math.exp(-((v / w) ** 2) * 3) * along ** 0.6 + 0.6 * Math.exp(-((v / (w * 0.35)) ** 2) * 3) * along);
});

write('bdo_cakma', 256, 256, null, (u, v, r) => clamp(Math.exp(-r * r * 22) + 0.5 * Math.exp(-r * r * 4) * 0.6
  + 0.9 * Math.exp(-Math.abs(u) * 1.4) * Math.exp(-v * v * 1800) + 0.25 * Math.exp(-Math.abs(v) * 4) * Math.exp(-u * u * 900)) * smooth(1, 0.88, r));
