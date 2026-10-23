// Yerleşik VFX parçacık dokularını üretir: vfx/textures/<ad>.png (beyaz RGB + alfa maskesi; renk parçacıktan gelir).
// Aynı PNG'ler hem editörde hem Unity'de kullanılır. Çalıştır: node tools/gen-vfx-textures.mjs
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
function png(size, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const clamp = (v) => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

// deterministik değer gürültüsü (duman için)
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, s, period) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const w = (t) => t * t * (3 - 2 * t);
  const h = (a, b) => hash(((a % period) + period) % period, ((b % period) + period) % period, s);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  return a + (b - a) * w(fx) + (c - a) * w(fy) + (a - b - c + d) * w(fx) * w(fy);
}
const fbm = (x, y, s) => { let v = 0, amp = 0.5, f = 1; for (let o = 0; o < 5; o++) { v += amp * vnoise(x * f, y * f, s + o, 4 * f); amp *= 0.5; f *= 2; } return v; };

// u,v ∈ [-1,1] (v yukarı), r = merkeze uzaklık. Dönüş: alfa ya da [parlaklık, alfa]
const TEX = {
  soft: (u, v, r) => clamp(1 - r) ** 2,
  glow: (u, v, r) => clamp(1 - r) ** 3.2,
  hard: (u, v, r) => smooth(0.84, 0.78, r),
  spark: (u, v, r) => clamp(Math.exp(-r * r * 28) + 0.3 * clamp(1 - r) ** 3),
  ember: (u, v, r) => clamp(Math.exp(-r * r * 16) + 0.45 * clamp(1 - r) ** 2.5),
  smoke: (u, v, r) => {
    const n = fbm((u + 1) * 2, (v + 1) * 2, 7), n2 = fbm((u + 1) * 3 + 5, (v + 1) * 3, 11);
    const a = clamp((n * 1.25 - 0.18) * 1.7) * clamp(1 - r) ** 1.1;
    return [0.78 + 0.22 * n2, clamp(a * 1.4)];
  },
  ring: (u, v, r) => clamp(Math.exp(-(((r - 0.74) / 0.075) ** 2)) + 0.25 * Math.exp(-(((r - 0.74) / 0.2) ** 2))) * smooth(1, 0.95, r),
  star: (u, v, r) => {
    const ray = (a, b) => Math.exp(-Math.abs(a) * 2.6) * Math.exp(-b * b * 900);
    return clamp((ray(u, v) + ray(v, u)) * 0.9 + Math.exp(-r * r * 30) + 0.25 * clamp(1 - r) ** 4) * smooth(1, 0.9, r);
  },
  flare: (u, v, r) => clamp(0.85 * Math.exp(-r * r * 9) + 0.8 * Math.exp(-Math.abs(u) * 2.2) * Math.exp(-v * v * 2500) + 0.35 * Math.exp(-Math.abs(v) * 3) * Math.exp(-u * u * 3000)) * smooth(1, 0.9, r),
  slash: (u, v) => { // hilal: (0,-0.5) merkezli yay, uçlara doğru incelir; dış kenar keskin, iç kenar yumuşak
    const cy = -0.5, R = 1.0, dx = u, dy = v - cy;
    const rho = Math.hypot(dx, dy), th = Math.atan2(dx, dy), tmax = 1.2;
    if (Math.abs(th) > tmax) return 0;
    const taper = Math.cos((th / tmax) * Math.PI / 2);
    const w = 0.34 * taper ** 0.7; if (w <= 1e-4) return 0;
    const d = rho - R; const band = d > 0 ? 1 - d / (w * 0.3) : 1 - -d / w;
    const core = d > 0 ? 1 - d / (w * 0.15) : 1 - -d / (w * 0.35);
    return clamp(clamp(band) ** 1.6 * (0.5 + 0.5 * taper) + 0.6 * clamp(core) ** 2 * taper) * smooth(1, 0.94, Math.max(Math.abs(u), Math.abs(v)));
  },
  flame: (u, v) => { // alttan yuvarlak, yukarı sivrilen yumuşak alev dili (hafif kıvrımlı)
    const by = -0.4, br = 0.44, bend = 0.06 * Math.sin((v + 1) * 4.2) * clamp((v - by) / 1.2); const x = u - bend; let d;
    if (v <= by) d = Math.hypot(x, (v - by) * 1.15) / br;
    else { const hw = br * Math.max(0, 1 - (v - by) / 1.35) ** 1.1; d = hw > 1e-4 ? Math.abs(x) / hw : 9; }
    const body = clamp(1 - d) ** 1.4, core = clamp(1 - d * 1.5) ** 1.6 * clamp(1 - (v - by) / 1.0);
    return [0.82 + 0.18 * core, clamp(body * (0.9 - 0.5 * clamp((v - 0.1) / 0.85)) + core * 0.45) * smooth(-1, -0.7, v)];
  },
};
const SIZES = { smoke: 256, slash: 256 };

for (const [name, fn] of Object.entries(TEX)) {
  const size = SIZES[name] || 128; const buf = Buffer.alloc(size * size * 4); const ss = 3; // süper örnekleme
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let lum = 0, al = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const u = ((x + (sx + 0.5) / ss) / size) * 2 - 1, v = 1 - ((y + (sy + 0.5) / ss) / size) * 2;
      const o = fn(u, v, Math.hypot(u, v)); const [l, a] = Array.isArray(o) ? o : [1, o];
      lum += l * a; al += a;
    }
    al /= ss * ss; const l = al > 0 ? lum / (al * ss * ss) : 1;
    const i = (y * size + x) * 4; const c = Math.round(clamp(l) * 255);
    buf[i] = buf[i + 1] = buf[i + 2] = c; buf[i + 3] = Math.round(clamp(al) * 255);
  }
  fs.writeFileSync(path.join(OUT, name + '.png'), png(size, buf));
  console.log(name + '.png', size);
}
