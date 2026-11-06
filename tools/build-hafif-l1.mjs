// hafif_l1: L1 (arpg_attack_combo_b1) hafif saldırı kesiği — sade ama özenli (abartı ağır/skill'lere).
// Yay: fit_arc_from_animation ile kılıç ucunun gerçek yolundan (16,5.–18. kare, R 1,09 m, 130°).
// Katmanlar: mesh yay (ince beyaz kenar + dar soğuk mavi-gri gövde, baştan açılır, kuyruktan yenir) + ince hava bükülmesi
// + uçtan birkaç kıvılcım + kısa, düşük mavi ışık. Çalıştır: node tools/build-hafif-l1.mjs → vfx/hafif_l1.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// fit_arc_from_animation sonucu (arpg_attack_combo_b1, katana)
const FIT = {
  position: [0.1595, 1.1492, 0.577], rotation: [44.823, 79.775, 124.023], delay: 0.285, // fit penceresi 0,275–0,30 (1,5 kare); yay bıçak geçerken tümden belirir
  reveal: [[0, 0], [0.0259, 0.2319], [0.0522, 0.6308], [0.0781, 1], [1, 1]],
  mesh: { shape: 'arc', file: '', innerRadius: 0.3962, outerRadius: 1.138, angle: 130.12, height: 0.5, segments: 96, rings: 8, rotation: [0, 0, 0] },
  radius: 1.0942,
};
const LIFE = 0.2; // kısa: hafif saldırı izi ~0,2 sn'de söner
const FIT_LIFE = 0.32; // fit'in açılma eğrisi bu ömre göre
const revealScaled = FIT.reveal.map(([t, v]) => [t >= 1 ? 1 : Math.min(0.99, t * FIT_LIFE / LIFE), v]);
const once = (count) => ({ rateOverTime: 0, bursts: [{ time: 0, count, cycles: 1, interval: 0.01 }] });
const lifeAlpha = { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [1, 0]] }; // shader: life = 1 - alfa
// kesiş 1,5 kare: açılma kare kare okunmuyor (önizlemede ilk karede havada asılı kalıyordu) → baştan açık
const custom = { enabled: true, x: [[0, 1], [1, 1]], y: [[0, 0], [1, 0]], z: [[0, 0], [1, 0]], w: [[0, 0], [1, 0]] };

const arcEmitter = (name, material, blend, order, extra = {}) => ({
  name, position: FIT.position, rotation: FIT.rotation,
  main: { duration: 0.6, looping: false, startDelay: FIT.delay, startLifetime: [LIFE, LIFE], startSpeed: [0, 0], startSize: [1, 1],
    startRotation: [0, 0], startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 2 },
  emission: once([1, 1]), shape: { enabled: false }, colorOverLifetime: lifeAlpha, customData: custom,
  sizeOverLifetime: { enabled: true, curve: [[0, 0.99], [1, 1.02]] },
  renderer: { mode: 'mesh', mesh: FIT.mesh, alignment: 'view', material, texture: 'soft', blend, intensity: 1, sortingOrder: order, ...(extra.renderer || {}) },
  ...(extra.root || {}),
});

const effect = {
  name: 'hafif_l1', duration: 1.0, loop: true,
  preview: { withAnimation: true, startFrame: 0, background: '#141a26', bloom: 0.6, showHero: true, showGrid: true },
  emitters: [
    arcEmitter('bukulme', 'kesik_hafif_bukulme', 'distortion', 0, { renderer: { distortion: { mode: 'noise', strength: 0.012, frequency: 14, scroll: [0, 3] } } }),
    arcEmitter('yay', 'kesik_hafif', 'additive', 3, {
      root: { light: { enabled: true, mode: 'single', color: '#a9c8ff', useParticleColor: false, intensity: 0.7, radius: 2.2,
        curve: [[0, 0], [0.08, 1], [0.3, 0.2], [0.5, 0], [1, 0]], maxLights: 1, shadows: false } },
    }),
    // eko: biraz dışta, bir kare geriden gelen ince camgöbeği ikinci çizgi (çift darbe hissi)
    (() => { const e = arcEmitter('eko', 'kesik_hafif_eko', 'additive', 2);
      e.main = { ...e.main, startDelay: FIT.delay + 0.012, startLifetime: [0.16, 0.16], startSize: [1.05, 1.05] };
      e.sizeOverLifetime = { enabled: true, curve: [[0, 1], [1, 1.03]] }; return e; })(),
    // bıçak ucunun vardığı yerde küçük yıldız parıltısı
    {
      name: 'parilti', position: FIT.position, rotation: FIT.rotation,
      main: { duration: 0.6, looping: false, startDelay: FIT.delay + 0.004, startLifetime: [0.1, 0.1], startSpeed: [0, 0], startSize: [0.34, 0.34],
        startRotation: [12, 12], startColor: ['#f2f8ff', '#f2f8ff'], gravity: 0, simulationSpace: 'world', maxParticles: 2 },
      emission: once([1, 1]),
      shape: { enabled: true, type: 'circle', radius: FIT.radius, radiusThickness: 0, arc: 6, position: [0, 0, 0], rotation: [0, 0, 122], randomDirection: 0 },
      colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#bcdcff']], alpha: [[0, 1], [1, 0]] },
      sizeOverLifetime: { enabled: true, curve: [[0, 0.4], [0.25, 1], [1, 0.7]] },
      renderer: { mode: 'billboard', alignment: 'view', material: 'zerre_hafif_isik', texture: 'soft', blend: 'additive', intensity: 1, sortingOrder: 5 },
    },
    // yay boyunca havada bir an asılı kalan ince zerreler (göz kırpar)
    {
      name: 'zerre', position: FIT.position, rotation: FIT.rotation,
      main: { duration: 0.6, looping: false, startDelay: FIT.delay + 0.01, startLifetime: [0.22, 0.42], startSpeed: [0.15, 0.45], startSize: [0.045, 0.08],
        startRotation: [0, 45], startColor: ['#dcecff', '#8fb8ff'], gravity: -0.05, simulationSpace: 'world', maxParticles: 24 },
      emission: once([12, 18]),
      shape: { enabled: true, type: 'circle', radius: FIT.radius * 0.97, radiusThickness: 0.18, arc: 80, position: [0, 0, 0], rotation: [0, 0, 45], randomDirection: 0.5 },
      limitVelocity: { enabled: true, drag: 2, limit: 5, dampen: 0 },
      colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#9cc4ff']], alpha: [[0, 0], [0.1, 1], [0.4, 0.5], [0.5, 1], [1, 0]] },
      renderer: { mode: 'billboard', alignment: 'view', material: 'zerre_hafif', texture: 'soft', blend: 'additive', intensity: 1, sortingOrder: 4 },
    },
    {
      name: 'kivilcim', position: FIT.position, rotation: FIT.rotation,
      main: { duration: 0.6, looping: false, startDelay: FIT.delay + 0.018, startLifetime: [0.14, 0.28], startSpeed: [1.2, 3], startSize: [0.035, 0.06],
        startRotation: [0, 0], startColor: ['#eef6ff', '#9cc4ff'], gravity: 0.3, simulationSpace: 'world', maxParticles: 12 },
      emission: once([8, 12]),
      shape: { enabled: true, type: 'circle', radius: FIT.radius, radiusThickness: 0.04, arc: 30, position: [0, 0, 0], rotation: [0, 0, 100], randomDirection: 0.35 },
      limitVelocity: { enabled: true, drag: 10, limit: 10, dampen: 0 },
      colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#9cc4ff']], alpha: [[0, 1], [0.6, 0.8], [1, 0]] },
      sizeOverLifetime: { enabled: true, curve: [[0, 1], [1, 0.6]] },
      renderer: { mode: 'billboard', alignment: 'view', material: 'zerre_hafif', texture: 'soft', blend: 'additive', intensity: 1, sortingOrder: 4 },
    },
  ],
};
fs.writeFileSync(path.join(ROOT, 'vfx', 'hafif_l1.json'), JSON.stringify(effect, null, 1));
console.log('yazıldı vfx/hafif_l1.json');
