// Ağır saldırı kesikleri (H*): süslü ama en süslü değil (en süslüsü skill'lerde). Docs/VFX_Kurallari.md:
// hazır doku/düz çizgi yok; hepsi özel shader (gen-agir-shaders.mjs + kesik_hafif_kabuk/bukulme + zerre_yumusak).
// Yay ölçüsü fit_arc_from_animation (ARPG Samurai combo*_from_b*). Katmanlar:
//  koyu gövde · 2 hayalet iz · iç (mor-mavi geniş) · ana (beyaz çekirdek→camgöbeği→mavi→mor) · dış (ince camgöbeği) ·
//  enerji telleri · kabuk (yandan bakış) · bükülme · isabet çakması + genişleyen enerji halkası · yay boyunca zerreler ·
//  savrulan zerreler · koyu + parlak enerji dumanı · güçlü mavi ışık.
// Çalıştır: node tools/build-agir.mjs [h1 h1:yarik h1:dalga h1:kutle …] → vfx/agir_<h>[_<varyant>].json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// fit sonuçları. progress: [t sn, uç yolunun yay kesri]; impact: çakmanın yay kesri (düşmanın göğüs hizası)
const FITS = {
  h1: { anim: 'arpg_attack_combo1_from_b1', normal: [0.999, 0.0437, 0.0111], center: [0.1309, 1.1479, 0.4289], rotation: [-2.507, 89.366, 17.828],
    radius: 1.1627, angle: 195.3, inner: 0.369, impact: 0.846, axes: { X: [-0.0029, 0.3059, -0.9521], Y: [-0.045, 0.9511, 0.3057] },
    progress: [[0.2917, 0], [0.3, 0.0416], [0.3083, 0.1045], [0.3167, 0.1717], [0.325, 0.2402], [0.3333, 0.3115], [0.3417, 0.3972],
      [0.35, 0.4859], [0.3583, 0.6178], [0.3667, 0.7514], [0.375, 0.8757], [0.3833, 1]] },
};

const once = (count) => ({ rateOverTime: 0, bursts: [{ time: 0, count, cycles: 1, interval: 0.01 }] });
const lifeAlpha = { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [1, 0]] }; // shader: life = 1 - alfa
const timeAt = (F, frac) => { const p = F.progress; for (let i = 1; i < p.length; i++) if (p[i][1] >= frac) { const [t0, a] = p[i - 1], [t1, b] = p[i]; return t0 + (t1 - t0) * (frac - a) / Math.max(b - a, 1e-6); } return p[p.length - 1][0]; };

function build(key, variant) {
  const F = FITS[key], A = F.angle, R = F.radius;
  const t0 = F.progress[0][0], tEnd = F.progress[F.progress.length - 1][0], tHit = timeAt(F, F.impact);
  const lead = 0.006; // yay bıçağın bir adım önünde açılsın (önizleme kare adımı)
  const at = { position: F.center, rotation: F.rotation };
  // açılma eğrisi: ömür kesri → uç kesri (i.custom.x)
  const reveal = (delay, life) => {
    const k = F.progress.map(([t, v]) => [+Math.min(0.999, Math.max(0, (t - delay - lead) / life)).toFixed(4), v]);
    const out = [[0, 0]]; for (const p of k) if (p[0] > out[out.length - 1][0]) out.push(p);
    if (out[out.length - 1][0] < 1) out.push([1, 1]); return out;
  };
  const arcMesh = (outerMul = 1.06, innerMul = 1) => ({ shape: 'arc', file: '', innerRadius: +(F.inner * R * innerMul).toFixed(4), outerRadius: +(R * outerMul).toFixed(4),
    angle: A, height: 0.5, segments: 128, rings: 8, rotation: [0, 0, 0] });
  const arc = (name, material, { blend = 'additive', order = 3, dt = 0, life = 0.5, size = 1, rotZ = 0, mesh, color = '#ffffff', cy, extra = {} } = {}) => {
    const delay = +(t0 + dt).toFixed(4);
    return {
      name, ...at,
      main: { duration: 1.2, looping: false, startDelay: delay, startLifetime: [life, life], startSpeed: [0, 0], startSize: [size, size],
        startRotation: [0, 0], startColor: [color, color], gravity: 0, simulationSpace: 'local', maxParticles: 2 },
      emission: once([1, 1]), shape: { enabled: false }, colorOverLifetime: lifeAlpha,
      customData: { enabled: true, x: reveal(delay, life), y: cy ? cy(delay, life) : [[0, 0], [1, 0]], z: [[0, 0], [1, 0]], w: [[0, 0], [1, 0]] },
      sizeOverLifetime: { enabled: true, curve: [[0, 0.99], [1, 1.03]] },
      renderer: { mode: 'mesh', mesh: { ...(mesh || arcMesh()), rotation: [0, 0, rotZ] }, alignment: 'view', material, texture: 'soft', blend, intensity: 1, sortingOrder: order, ...(extra.renderer || {}) },
      ...(extra.root || {}),
    };
  };
  // yay üzerinde (açı derece, 0 = ilk uç) doğan parçacık
  const onArc = (name, o) => ({
    name, ...at,
    main: { duration: 1.2, looping: false, startDelay: +o.delay.toFixed(4), startLifetime: o.life, startSpeed: o.speed, startSize: o.size,
      startRotation: o.srot || [0, 0], startColor: o.color, gravity: o.gravity || 0, simulationSpace: 'world', maxParticles: o.max },
    emission: once(o.count),
    shape: { enabled: true, type: 'circle', radius: o.r ?? R, radiusThickness: o.thick ?? 0, arc: o.arc, position: [0, 0, 0], rotation: [0, 0, o.from], randomDirection: o.rand ?? 0 },
    ...(o.drag ? { limitVelocity: { enabled: true, drag: o.drag, limit: 12, dampen: 0 } } : {}),
    ...(o.noise ? { noise: { enabled: true, strength: o.noise, frequency: 1.3, scrollSpeed: 0.6, octaves: 2 } } : {}),
    colorOverLifetime: { enabled: true, color: o.grad || [[0, '#ffffff'], [1, '#ffffff']], alpha: o.alpha || [[0, 1], [1, 0]] },
    ...(o.sizeCurve ? { sizeOverLifetime: { enabled: true, curve: o.sizeCurve } } : {}),
    ...(o.angv ? { rotationOverLifetime: { enabled: true, angularVelocity: o.angv } } : {}),
    renderer: { mode: 'billboard', alignment: 'view', material: o.mat, texture: 'soft', blend: o.blend || 'additive', intensity: 1, sortingOrder: o.order ?? 5 },
  });
  const H = 0.2; // kabuk bandı (m)
  const kabuk = arc('kabuk', `agir_${key}_kabuk`, { life: 0.5, order: 3, mesh: { shape: 'cylinder', file: '', innerRadius: +(R * 1.03).toFixed(4), outerRadius: +(R * 1.03).toFixed(4), angle: A, height: H, segments: 128, rings: 6 } });
  kabuk.renderer.mesh.rotation = [-90, 0, 0];
  kabuk.position = F.center.map((c, i) => +(c + F.normal[i] * H / 2).toFixed(4));
  const hitAng = +(A * F.impact).toFixed(1);

  // ───────────── varyantlar (her ağır saldırıya kendi kimliği): yarik | dalga | kutle
  const AX = F.axes; // yay düzlemi eksenleri (efekt kökü çerçevesi): X = ilk uç yönü, Y = yay yönü
  const arcPoint = (deg, rr = R) => { const a = deg * Math.PI / 180; return F.center.map((c, i) => +(c + rr * (Math.cos(a) * AX.X[i] + Math.sin(a) * AX.Y[i])).toFixed(4)); };
  const emitAt = (name, pos, rot, o) => { const e = onArc(name, o); e.position = pos; e.rotation = rot; return e; };
  const life01 = (delay, life, t) => +Math.min(0.99, Math.max(0.001, (t - delay) / life)).toFixed(4);
  const light = (intensity, radius = 3.5) => ({ root: { light: { enabled: true, mode: 'single', color: '#9cc0ff', useParticleColor: false, intensity, radius,
    curve: [[0, 0.2], [0.1, 0.7], [0.2, 1], [0.45, 0.4], [0.8, 0], [1, 0]], maxLights: 1, shadows: false } } });
  const M = (v, n) => `agir_${key}${v}_${n}`;
  const prev = { withAnimation: true, startFrame: 0, background: '#141a26', bloom: 0.65, showHero: true, showGrid: true };
  if (variant === 'yarik') {
    // savunma kırma: havada açılan yarık; isabette tam açılır, kenarlarından kavisli çatlaklar yayılır, kırık parçalar kopar, sonra kapanır
    const open = (delay, life) => { const h = life01(delay, life, tHit); return [[0, 0], [Math.max(0.01, h - 0.12), 0.25], [h, 1], [Math.min(0.95, h + 0.3), 0.85], [Math.min(0.97, h + 0.55), 0], [1, 0]]; };
    const rr = F.inner * R + 0.9 * (R * 1.06 - F.inner * R); // yarık merkezinin yarıçapı (_Center 0.9)
    return {
      name: `agir_${key}_yarik`, duration: 1.6, loop: true, preview: prev,
      emitters: [
        arc('bukulme', M('y', 'bukulme'), { blend: 'distortion', order: 0, life: 0.7, extra: { renderer: { distortion: { mode: 'noise', strength: 0.035, frequency: 8, scroll: [0, 2] } } } }),
        arc('iz', M('y', 'iz'), { order: 3, life: 0.3, extra: light(1.6) }),
        arc('yarik_ic', M('y', 'ic'), { blend: 'alpha', order: 5, life: 0.9, cy: open }),
        arc('yarik_kenar', M('y', 'kenar'), { order: 6, life: 0.9, cy: open }),
        onArc('cakma', { delay: tHit, life: [0.14, 0.14], speed: [0, 0], size: [0.6, 0.6], color: ['#cfe4ff', '#cfe4ff'], max: 2, count: [1, 1], r: rr,
          arc: 2, from: hitAng, sizeCurve: [[0, 0.3], [0.2, 1], [1, 1.1]], mat: 'zerre_hafif_isik', order: 9 }),
        onArc('kirik', { delay: tHit + 0.01, life: [0.45, 0.85], speed: [1.2, 3.5], size: [0.12, 0.26], srot: [0, 360], color: ['#ffffff', '#cfdcf0'], gravity: 0.7,
          max: 16, count: [9, 13], r: rr, thick: 0.05, arc: 70, from: +(hitAng - 45).toFixed(1), rand: 0.6, drag: 3, angv: [-300, 300],
          alpha: [[0, 1], [0.7, 0.9], [1, 0]], sizeCurve: [[0, 1], [1, 0.7]], blend: 'alpha', mat: M('y', 'kirik'), order: 7 }),
        onArc('zerre', { delay: tHit, life: [0.3, 0.6], speed: [0.2, 0.8], size: [0.045, 0.09], srot: [0, 45], color: ['#dcecff', '#8fb8ff'], gravity: -0.05,
          max: 50, count: [30, 40], r: rr, thick: 0.15, arc: +(A * 0.7).toFixed(1), from: +(A * 0.25).toFixed(1), rand: 0.6, drag: 2,
          alpha: [[0, 0], [0.08, 1], [0.35, 0.5], [0.45, 1], [1, 0]], mat: 'zerre_hafif', order: 6 }),
        onArc('duman', { delay: tHit + 0.15, life: [0.5, 0.9], speed: [0.2, 0.5], size: [0.35, 0.7], srot: [0, 360], color: ['#c8d0e8', '#b8bde0'], max: 14, count: [8, 10],
          r: rr, thick: 0.1, arc: +(A * 0.6).toFixed(1), from: +(A * 0.3).toFixed(1), rand: 0.7, noise: 0.25, angv: [-40, 40], sizeCurve: [[0, 0.6], [1, 1.4]],
          blend: 'alpha', mat: `agir_${key}_duman`, order: 1 }),
      ],
    };
  }
  if (variant === 'dalga') {
    // basınç dalgası: kesik sade; bitince önüne şeffaf hilal dalgalar atar, ileri uçup genişleyerek dağılır (bükülme ağırlıklı)
    const dir = [Math.cos(hitAng * Math.PI / 180), Math.sin(hitAng * Math.PI / 180), 0];
    const wave = (name, mat, blend, dt, spd, size, extra = {}) => {
      const e = arc(name, mat, { blend, order: blend === 'distortion' ? 0 : 5, dt: tEnd - t0 + dt, life: 0.42, size,
        mesh: { shape: 'arc', file: '', innerRadius: +(R * 0.55).toFixed(4), outerRadius: +(R * 1.04).toFixed(4), angle: +(A * 0.75).toFixed(1), height: 0.5, segments: 96, rings: 8 }, extra });
      e.renderer.mesh.rotation = [0, 0, +(A * 0.25).toFixed(1)];
      e.velocity = { enabled: true, linear: dir.map((d) => +(d * spd).toFixed(3)), orbital: [0, 0, 0], radial: 0, space: 'local', speedModifier: 1 };
      e.sizeOverLifetime = { enabled: true, curve: [[0, 1], [1, 1.45]] };
      return e;
    };
    const dist = (st) => ({ renderer: { distortion: { mode: 'noise', strength: st, frequency: 8, scroll: [0, 2] } } });
    return {
      name: `agir_${key}_dalga`, duration: 1.6, loop: true, preview: prev,
      emitters: [
        arc('iz', M('d', 'iz'), { order: 3, life: 0.35 }),
        kabuk,
        wave('dalga1_buk', M('d', 'bukulme'), 'distortion', -0.01, 7, 1, dist(0.05)),
        wave('dalga1', M('d', 'dalga'), 'additive', -0.01, 7, 1, light(1.8, 4)),
        wave('dalga2_buk', M('d', 'bukulme'), 'distortion', 0.05, 5.5, 0.9, dist(0.04)),
        wave('dalga2', M('d', 'dalga2'), 'additive', 0.05, 5.5, 0.9),
        wave('dalga3_buk', M('d', 'bukulme'), 'distortion', 0.11, 4.2, 0.8, dist(0.03)),
        onArc('zerre', { delay: tEnd, life: [0.3, 0.6], speed: [1.5, 4], size: [0.04, 0.08], color: ['#dcecff', '#8fb8ff'], max: 40, count: [22, 30], r: R * 0.95, thick: 0.2,
          arc: +(A * 0.6).toFixed(1), from: +(A * 0.35).toFixed(1), rand: 0.4, drag: 3, alpha: [[0, 0], [0.08, 1], [0.6, 0.6], [1, 0]], mat: 'zerre_hafif', order: 6 }),
      ],
    };
  }
  if (variant === 'kutle') {
    // ağır kütle: kalın yoğun enerji sisi + kor kenar; inişte yere çöküş: zeminde genişleyen halka, yana yayılan duman
    const end = arcPoint(A); const G = [end[0], 0.02, end[2]];
    return {
      name: `agir_${key}_kutle`, duration: 1.6, loop: true, preview: prev,
      emitters: [
        arc('bukulme', M('k', 'bukulme'), { blend: 'distortion', order: 0, life: 0.6, extra: { renderer: { distortion: { mode: 'noise', strength: 0.03, frequency: 8, scroll: [0, 2] } } } }),
        arc('kutle', M('k', 'kutle'), { blend: 'alpha', order: 2, life: 0.8, mesh: arcMesh(1.05, 0.85) }),
        arc('kor', M('k', 'kor'), { order: 4, life: 0.55, extra: light(2.2, 4) }),
        kabuk,
        (() => { const e = emitAt('yer_halka', G, [0, 0, 0], { delay: tEnd + 0.01, life: [0.45, 0.45], speed: [0, 0], size: [4.2, 4.2], color: ['#ffffff', '#ffffff'], max: 2, count: [1, 1],
          arc: 360, from: 0, sizeCurve: [[0, 0.12], [0.4, 0.8], [1, 1]], mat: M('k', 'halka'), order: 8 }); e.shape = { enabled: false }; e.renderer.mode = 'horizontal'; return e; })(),
        emitAt('yer_duman', G, [0, 0, 0], { delay: tEnd + 0.01, life: [0.7, 1.1], speed: [1.8, 3.8], size: [0.5, 1.0], srot: [0, 360], color: ['#c8d0e8', '#b8bde0'],
          max: 22, count: [14, 18], r: 0.3, thick: 1, arc: 360, from: 0, rand: 0.1, drag: 4, noise: 0.2, angv: [-30, 30], sizeCurve: [[0, 0.5], [1, 1.5]],
          blend: 'alpha', mat: `agir_${key}_duman`, order: 1 }),
        emitAt('yer_zerre', G, [0, 0, 0], { delay: tEnd + 0.01, life: [0.3, 0.6], speed: [1.5, 3.5], size: [0.04, 0.08], color: ['#eef6ff', '#8fb8ff'], gravity: 0.5,
          max: 30, count: [18, 24], r: 0.25, thick: 1, arc: 360, from: 0, rand: 0.6, drag: 4, mat: 'zerre_hafif', order: 6 }),
        onArc('duman', { delay: tEnd, life: [0.5, 0.9], speed: [0.2, 0.6], size: [0.4, 0.8], srot: [0, 360], color: ['#c8d0e8', '#b8bde0'], max: 16, count: [10, 12],
          r: R * 0.95, thick: 0.2, arc: +(A * 0.8).toFixed(1), from: +(A * 0.15).toFixed(1), rand: 0.7, noise: 0.25, angv: [-40, 40], sizeCurve: [[0, 0.6], [1, 1.5]],
          blend: 'alpha', mat: `agir_${key}_duman`, order: 1 }),
      ],
    };
  }

  return {
    name: 'agir_' + key, duration: 1.6, loop: true,
    preview: { withAnimation: true, startFrame: 0, background: '#141a26', bloom: 0.65, showHero: true, showGrid: true },
    emitters: [
      arc('bukulme', `agir_${key}_bukulme`, { blend: 'distortion', order: 0, life: 0.5, extra: { renderer: { distortion: { mode: 'noise', strength: 0.025, frequency: 10, scroll: [0, 3] } } } }),
      arc('golge', `agir_${key}_golge`, { blend: 'alpha', order: 1, life: 0.6, mesh: arcMesh(1.05, 0.9) }),
      // hayalet izler: bıçağın biraz gerisinden gelen sönük kopyalar
      arc('hayalet2', `agir_${key}_hayalet`, { order: 2, dt: 0.018, life: 0.26, size: 0.965, rotZ: -10, color: '#8796b0' }),
      arc('hayalet1', `agir_${key}_hayalet`, { order: 2, dt: 0.01, life: 0.3, size: 0.985, rotZ: -5, color: '#b4c2d8' }),
      arc('ic', `agir_${key}_ic`, { order: 3, life: 0.6, size: 0.97 }),
      arc('ana', `agir_${key}_ana`, { order: 4, life: 0.5, extra: { root: { light: { enabled: true, mode: 'single', color: '#9cc0ff', useParticleColor: false, intensity: 1.7, radius: 3.5,
        curve: [[0, 0.2], [0.1, 0.7], [0.2, 1], [0.45, 0.4], [0.8, 0], [1, 0]], maxLights: 1, shadows: false } } } }),
      arc('dis', `agir_${key}_dis`, { order: 5, dt: 0.008, life: 0.4, size: 1.05 }),
      arc('tel', `agir_${key}_tel`, { order: 6, dt: 0.004, life: 0.45, size: 1.0 }),
      kabuk,
      // isabet: çakma + genişleyen enerji halkası (düşmanın göğüs hizası)
      onArc('cakma', { delay: tHit, life: [0.16, 0.16], speed: [0, 0], size: [0.75, 0.75], color: ['#c8dcf4', '#c8dcf4'], max: 2, count: [1, 1],
        arc: 2, from: hitAng, sizeCurve: [[0, 0.3], [0.2, 1], [1, 1.1]], mat: 'zerre_hafif_isik', order: 9 }),
      onArc('halka', { delay: tHit + 0.01, life: [0.26, 0.26], speed: [0, 0], size: [1.9, 1.9], color: ['#ffffff', '#ffffff'], max: 2, count: [1, 1],
        arc: 2, from: hitAng, sizeCurve: [[0, 0.15], [0.35, 0.75], [1, 1]], mat: `agir_${key}_halka`, order: 8 }),
      // yay boyunca bir an asılı kalan zerreler + isabetten savrulanlar
      onArc('zerre', { delay: tEnd - 0.01, life: [0.3, 0.6], speed: [0.2, 0.7], size: [0.05, 0.1], srot: [0, 45], color: ['#dcecff', '#8fb8ff'], gravity: -0.05,
        max: 70, count: [45, 60], r: R * 0.98, thick: 0.22, arc: +(A * 0.9).toFixed(1), from: +(A * 0.08).toFixed(1), rand: 0.6, drag: 2,
        grad: [[0, '#ffffff'], [1, '#9cc4ff']], alpha: [[0, 0], [0.08, 1], [0.35, 0.5], [0.45, 1], [1, 0]], mat: 'zerre_hafif', order: 6 }),
      onArc('savrulan', { delay: tHit, life: [0.2, 0.45], speed: [2.5, 6], size: [0.05, 0.09], color: ['#eef6ff', '#8fb8ff'], gravity: 0.4,
        max: 40, count: [25, 35], thick: 0.06, arc: 40, from: +(hitAng - 20).toFixed(1), rand: 0.45, drag: 7,
        grad: [[0, '#ffffff'], [1, '#7fa8ff']], alpha: [[0, 1], [0.6, 0.8], [1, 0]], sizeCurve: [[0, 1], [1, 0.5]], mat: 'zerre_hafif', order: 6 }),
      // enerji dumanı: koyu (kontrast) + parlak tutam, yaydan kopup kıvrılır
      onArc('duman', { delay: tEnd, life: [0.6, 1.0], speed: [0.25, 0.7], size: [0.45, 0.9], srot: [0, 360], color: ['#c8d0e8', '#b8bde0'], max: 24, count: [12, 16],
        r: R * 0.95, thick: 0.2, arc: +(A * 0.85).toFixed(1), from: +(A * 0.12).toFixed(1), rand: 0.7, noise: 0.25, angv: [-40, 40],
        sizeCurve: [[0, 0.6], [1, 1.5]], blend: 'alpha', mat: `agir_${key}_duman`, order: 1 }),
      onArc('duman_isik', { delay: tEnd - 0.005, life: [0.45, 0.75], speed: [0.3, 0.9], size: [0.35, 0.7], srot: [0, 360], color: ['#c0cff0', '#c8c0f0'], max: 16, count: [6, 9],
        r: R * 0.98, thick: 0.15, arc: +(A * 0.8).toFixed(1), from: +(A * 0.18).toFixed(1), rand: 0.7, noise: 0.3, angv: [-60, 60],
        sizeCurve: [[0, 0.6], [1, 1.4]], mat: `agir_${key}_duman_isik`, order: 3 }),
    ],
  };
}

const args = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FITS);
for (const a of args) {
  const [k, variant] = a.split(':');
  if (!FITS[k]) { console.error('bilinmeyen saldırı:', k); process.exit(1); }
  const e = build(k, variant);
  fs.writeFileSync(path.join(ROOT, 'vfx', e.name + '.json'), JSON.stringify(e, null, 1));
  console.log('yazıldı vfx/' + e.name + '.json', '(' + FITS[k].anim + (variant ? ', ' + variant : '') + ')');
}
