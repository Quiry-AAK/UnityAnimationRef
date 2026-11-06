// Hafif saldırı kesikleri L1–L4: tek tarif (sade ama özenli; abartı ağır saldırı/skill'lere), saldırı başına kılıç yolu.
// Yay ölçüleri fit_arc_from_animation (ARPG Samurai combo_b1..b4, katana ucu). L1–L3 birebir aynı görünüm;
// L4 kombonun bitiricisi: bir tık dolgun (geniş gövde, uzun iz, biraz fazla zerre/kıvılcım, biraz güçlü ışık).
// Katmanlar: mesh yay (ince beyaz kenar + dar soğuk mavi-gri lifli gövde, uç sivrilir, kuyruktan söner) + dışta yumuşak
// camgöbeği eko bant + ince hava bükülmesi + uçta yumuşak ışık lekesi + yay boyunca zerreler + uçtan savrulan zerreler
// (hepsi özel shader: kesik_hafif, kesik_hafif_bukulme, zerre_yumusak; hazır doku ve düz çizgi yok) + kısa mavi ışık.
// Çalıştır: node tools/build-hafif.mjs [l1 l2 l3 l4] → vfx/hafif_l<n>.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// fit_arc_from_animation sonuçları (efekt kökü = karakter kökü, Unity ekseni, m). window: kesiş [başlangıç, bitiş] sn.
const FITS = {
  l1: { normal: [0.698, -0.7049, 0.1259], anim: 'arpg_attack_combo_b1', center: [0.1595, 1.1492, 0.577], rotation: [44.823, 79.775, 124.023], radius: 1.0942, angle: 130.12, inner: 0.3621, window: [0.275, 0.3] },
  l2: { normal: [0.8314, 0.549, 0.0853], anim: 'arpg_attack_combo_b2', center: [0.1751, 1.1078, 1.6563], rotation: [-33.301, 84.14, 130.942], radius: 0.9201, angle: 111.69, inner: 0.3201, window: [0.2917, 0.3167] },
  l3: { normal: [-0.7052, -0.7085, -0.0268], anim: 'arpg_attack_combo_b3', center: [-0.2929, 1.033, 2.1125], rotation: [45.11, -92.177, -122.304], radius: 1.4214, angle: 146.08, inner: 0.4027, window: [0.2583, 0.3] },
  l4: { normal: [-0.7303, 0.6709, 0.1287], anim: 'arpg_attack_combo_b4', center: [-0.001, 1.203, 3.377], rotation: [-42.135, -80.005, -72.369], radius: 1.1543, angle: 159.79, inner: 0.4014, window: [0.275, 0.3167] },
};
// L1–L3 aynı; L4 bitirici bir tık dolgun
const TIERS = {
  normal: { mat: 'kesik_hafif', eko: 'kesik_hafif_eko', kabuk: 'kesik_hafif_kabuk', life: 0.2, ekoLife: 0.16, zerre: [12, 18], kivilcim: [8, 12], light: 0.7, glint: 0.34 },
  bitirici: { mat: 'kesik_hafif_l4', eko: 'kesik_hafif_eko_l4', kabuk: 'kesik_hafif_kabuk_l4', life: 0.26, ekoLife: 0.2, zerre: [18, 26], kivilcim: [12, 16], light: 0.9, glint: 0.42 },
};

const once = (count) => ({ rateOverTime: 0, bursts: [{ time: 0, count, cycles: 1, interval: 0.01 }] });
const lifeAlpha = { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [1, 0]] }; // shader: life = 1 - alfa
// kesiş 1,5–2,5 kare: açılma kare kare okunmuyor → yay bıçak geçerken tümden belirir (i.custom.x = 1)
const custom = { enabled: true, x: [[0, 1], [1, 1]], y: [[0, 0], [1, 0]], z: [[0, 0], [1, 0]], w: [[0, 0], [1, 0]] };

function build(key) {
  const F = FITS[key], T = key === 'l4' ? TIERS.bitirici : TIERS.normal;
  const A = F.angle, R = F.radius;
  const delay = +(F.window[0] + 0.4 * (F.window[1] - F.window[0])).toFixed(4); // L1: 0,285 (render'da bıçağa hizalı)
  const mesh = { shape: 'arc', file: '', innerRadius: +(F.inner * R).toFixed(4), outerRadius: +(R * 1.04).toFixed(4), angle: A, height: 0.5, segments: 96, rings: 8, rotation: [0, 0, 0] };
  const at = { position: F.center, rotation: F.rotation };

  const arcEmitter = (name, material, blend, order, extra = {}) => ({
    name, ...at,
    main: { duration: 0.6, looping: false, startDelay: delay, startLifetime: [T.life, T.life], startSpeed: [0, 0], startSize: [1, 1],
      startRotation: [0, 0], startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 2 },
    emission: once([1, 1]), shape: { enabled: false }, colorOverLifetime: lifeAlpha, customData: custom,
    sizeOverLifetime: { enabled: true, curve: [[0, 0.99], [1, 1.02]] },
    renderer: { mode: 'mesh', mesh, alignment: 'view', material, texture: 'soft', blend, intensity: 1, sortingOrder: order, ...(extra.renderer || {}) },
    ...(extra.root || {}),
  });
  // yay üzerinde (emitter düzleminde, açı 0 = ilk uç) doğan yumuşak zerre katmanı
  const motes = (name, o) => ({
    name, ...at,
    main: { duration: 0.6, looping: false, startDelay: delay + o.dt, startLifetime: o.life, startSpeed: o.speed, startSize: o.size,
      startRotation: o.srot || [0, 0], startColor: o.color, gravity: o.gravity || 0, simulationSpace: 'world', maxParticles: o.max },
    emission: once(o.count),
    shape: { enabled: true, type: 'circle', radius: o.r, radiusThickness: o.thick, arc: o.arc, position: [0, 0, 0], rotation: [0, 0, o.from], randomDirection: o.rand },
    ...(o.drag ? { limitVelocity: { enabled: true, drag: o.drag, limit: 10, dampen: 0 } } : {}),
    colorOverLifetime: { enabled: true, color: o.grad, alpha: o.alpha },
    ...(o.sizeCurve ? { sizeOverLifetime: { enabled: true, curve: o.sizeCurve } } : {}),
    renderer: { mode: 'billboard', alignment: 'view', material: o.mat, texture: 'soft', blend: 'additive', intensity: 1, sortingOrder: o.order },
  });

  const eko = arcEmitter('eko', T.eko, 'additive', 2);
  eko.main = { ...eko.main, startDelay: delay + 0.012, startLifetime: [T.ekoLife, T.ekoLife], startSize: [1.05, 1.05] };
  eko.sizeOverLifetime = { enabled: true, curve: [[0, 1], [1, 1.03]] };

  // kabuk: yayın dış kenarını saran, kesiş düzlemine dik dar silindir bandı (kamera düzleme yandan bakınca kesik okunsun).
  // Silindir yerel Y ekseni etrafında, açı +X→+Z; mesh dönüşü (-90,0,0) ile +Z→+Y (yayla aynı yön), eksen → -Z (normalin tersi);
  // bant 0…-H'de kalmasın diye emitter normal yönünde H/2 kaydırılır.
  const H = key === 'l4' ? 0.16 : 0.13;
  const kabuk = arcEmitter('kabuk', T.kabuk, 'additive', 3);
  kabuk.position = F.center.map((c, i) => +(c + F.normal[i] * H / 2).toFixed(4));
  kabuk.renderer = { ...kabuk.renderer, mesh: { shape: 'cylinder', file: '', innerRadius: +(R * 1.022).toFixed(4), outerRadius: +(R * 1.022).toFixed(4), angle: A, height: H, segments: 96, rings: 6, rotation: [-90, 0, 0] } };

  return {
    name: 'hafif_' + key, duration: 1.0, loop: true,
    preview: { withAnimation: true, startFrame: 0, background: '#141a26', bloom: 0.6, showHero: true, showGrid: true },
    emitters: [
      arcEmitter('bukulme', 'kesik_hafif_bukulme', 'distortion', 0, { renderer: { distortion: { mode: 'noise', strength: 0.012, frequency: 14, scroll: [0, 3] } } }),
      arcEmitter('yay', T.mat, 'additive', 3, {
        root: { light: { enabled: true, mode: 'single', color: '#a9c8ff', useParticleColor: false, intensity: T.light, radius: 2.2,
          curve: [[0, 0], [0.08, 1], [0.3, 0.2], [0.5, 0], [1, 0]], maxLights: 1, shadows: false } },
      }),
      kabuk,
      // dışta, bir kare geriden gelen yumuşak camgöbeği bant (çift darbe hissi)
      eko,
      // bıçak ucunun vardığı yerde yumuşak ışık lekesi
      motes('parilti', { dt: 0.004, life: [0.1, 0.1], speed: [0, 0], size: [T.glint, T.glint], srot: [12, 12], color: ['#f2f8ff', '#f2f8ff'], max: 2, count: [1, 1],
        r: R, thick: 0, arc: 6, from: A - 8, rand: 0, grad: [[0, '#ffffff'], [1, '#bcdcff']], alpha: [[0, 1], [1, 0]],
        sizeCurve: [[0, 0.4], [0.25, 1], [1, 0.7]], mat: 'zerre_hafif_isik', order: 5 }),
      // yayın bıçağın indiği bölümünde bir an asılı kalan zerreler (göz kırpar)
      motes('zerre', { dt: 0.01, life: [0.22, 0.42], speed: [0.15, 0.45], size: [0.045, 0.08], srot: [0, 45], color: ['#dcecff', '#8fb8ff'], gravity: -0.05,
        max: 32, count: T.zerre, r: R * 0.97, thick: 0.18, arc: +(A * 0.6).toFixed(1), from: +(A * 0.35).toFixed(1), rand: 0.5, drag: 2,
        grad: [[0, '#ffffff'], [1, '#9cc4ff']], alpha: [[0, 0], [0.1, 1], [0.4, 0.5], [0.5, 1], [1, 0]], mat: 'zerre_hafif', order: 4 }),
      // bıçak ucundan savrulan zerreler
      motes('kivilcim', { dt: 0.018, life: [0.14, 0.28], speed: [1.2, 3], size: [0.035, 0.06], color: ['#eef6ff', '#9cc4ff'], gravity: 0.3,
        max: 20, count: T.kivilcim, r: R, thick: 0.04, arc: 30, from: +(A - 30).toFixed(1), rand: 0.35, drag: 10,
        grad: [[0, '#ffffff'], [1, '#9cc4ff']], alpha: [[0, 1], [0.6, 0.8], [1, 0]], sizeCurve: [[0, 1], [1, 0.6]], mat: 'zerre_hafif', order: 4 }),
    ],
  };
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FITS);
for (const k of keys) {
  if (!FITS[k]) { console.error('bilinmeyen saldırı:', k); process.exit(1); }
  const e = build(k);
  fs.writeFileSync(path.join(ROOT, 'vfx', e.name + '.json'), JSON.stringify(e, null, 1));
  console.log('yazıldı vfx/' + e.name + '.json', '(' + FITS[k].anim + ')');
}
