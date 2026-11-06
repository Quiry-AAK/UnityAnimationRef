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
    {
      name: 'kivilcim', position: FIT.position, rotation: FIT.rotation,
      main: { duration: 0.6, looping: false, startDelay: FIT.delay + 0.018, startLifetime: [0.1, 0.22], startSpeed: [1.5, 3.5], startSize: [0.01, 0.02],
        startRotation: [0, 0], startColor: ['#eef6ff', '#9cc4ff'], gravity: 0.3, simulationSpace: 'world', maxParticles: 12 },
      emission: once([5, 8]),
      shape: { enabled: true, type: 'circle', radius: FIT.radius, radiusThickness: 0.04, arc: 30, position: [0, 0, 0], rotation: [0, 0, 100], randomDirection: 0.35 },
      limitVelocity: { enabled: true, drag: 10, limit: 10, dampen: 0 },
      colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#9cc4ff']], alpha: [[0, 1], [0.6, 0.8], [1, 0]] },
      sizeOverLifetime: { enabled: true, curve: [[0, 1], [1, 0.6]] },
      renderer: { mode: 'stretched', alignment: 'view', material: '', texture: 'bdo_cizgi', blend: 'additive', intensity: 1.6, lengthScale: 3, velocityScale: 0.025, sortingOrder: 4 },
    },
  ],
};
fs.writeFileSync(path.join(ROOT, 'vfx', 'hafif_l1.json'), JSON.stringify(effect, null, 1));
console.log('yazıldı vfx/hafif_l1.json');
