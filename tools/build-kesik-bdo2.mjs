// kesik_bdo2: BDO stili katmanlı kesik. Yerleşim ornek_kesik_normal / kesik_bdo ile aynı (aynı saldırı anı).
// Çalıştır: node tools/build-kesik-bdo2.mjs → vfx/kesik_bdo2.json (sonra MCP load_vfx kesik_bdo2)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const POS = [0.065, 1.26, 0.523], ROT = [-42.79, -88.25, 0];
const T0 = 0.2583; // kesik başlangıcı (ornek_kesik_normal 'ana')
const SROT = 95, SIZE = 2.404;
const ARC = { enabled: true, type: 'circle', radius: 1.13, radiusThickness: 0.05, arc: 120, position: [0, 0, 0], rotation: [0, 0, -85] };
const once = (count) => ({ rateOverTime: 0, bursts: [{ time: 0, count, cycles: 1, interval: 0.01 }] });
const fade = { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [1, 0]] };

// hilal quad katmanı (UPE-SL materyalli, alpha = 1 - life)
const quad = (name, material, { size = SIZE, rot = SROT, delay = 0, life = 0.26, order = 3, blend = 'additive', color = '#ffffff', grow = [0.97, 1, 1.035] } = {}) => ({
  name, position: POS, rotation: ROT,
  main: { duration: 0.5, looping: false, startDelay: T0 + delay, startLifetime: [life, life], startSpeed: [0, 0], startSize: [size, size],
    startRotation: [rot, rot], startColor: [color, color], gravity: 0, simulationSpace: 'world', maxParticles: 2 },
  emission: once([1, 1]), shape: { enabled: false }, colorOverLifetime: fade,
  sizeOverLifetime: { enabled: true, curve: [[0, grow[0]], [0.3, grow[1]], [1, grow[2]]] },
  renderer: { mode: 'billboard', alignment: 'local', material, texture: 'hard', blend, intensity: 1, sortingOrder: order },
});

// yay üzerinden doğan parçacık katmanı
const arcp = (name, o) => ({
  name, position: POS, rotation: ROT,
  main: { duration: 0.5, looping: false, startDelay: T0 + (o.delay ?? 0.03), startLifetime: o.life, startSpeed: o.speed, startSize: o.size,
    startRotation: o.srot ?? [0, 0], startColor: o.color, gravity: o.gravity ?? 0, simulationSpace: 'world', maxParticles: o.max ?? 120 },
  emission: once(o.count), shape: { ...ARC, ...(o.shape || {}) },
  ...(o.drag ? { limitVelocity: { enabled: true, drag: o.drag, limit: 20, dampen: 0 } } : {}),
  ...(o.noise ? { noise: { enabled: true, strength: o.noise, frequency: 1.4, scrollSpeed: 0.6, octaves: 2 } } : {}),
  colorOverLifetime: { enabled: true, color: o.grad || [[0, '#ffffff'], [1, '#ffffff']], alpha: o.alpha || [[0, 1], [1, 0]] },
  ...(o.sizeCurve ? { sizeOverLifetime: { enabled: true, curve: o.sizeCurve } } : {}),
  ...(o.angv ? { rotationOverLifetime: { enabled: true, angularVelocity: o.angv } } : {}),
  ...(o.sheet ? { textureSheet: { enabled: true, tilesX: o.sheet[0], tilesY: o.sheet[1], cycles: 1, randomStart: false } } : {}),
  renderer: { mode: o.mode || 'billboard', alignment: 'view', material: '', texture: o.tex, blend: o.blend || 'additive', intensity: o.int ?? 1,
    lengthScale: o.len ?? 2, velocityScale: o.vel ?? 0, sortingOrder: o.order ?? 6 },
});

const effect = {
  name: 'kesik_bdo2', duration: 0.9833333333333333, loop: true,
  preview: { withAnimation: true, startFrame: 0, background: '#141a26', bloom: 0.75, showHero: true, showGrid: true },
  emitters: [
    // 1) koyu gövde: parlaklığın arkasında kontrast
    quad('golge', 'kesik_bdo2_golge', { size: 2.42, delay: 0, life: 0.3, order: 1, blend: 'alpha' }),
    // 2) hayalet izler: bıçağın birkaç kare önceki konumları (sönük)
    quad('hayalet2', 'kesik_bdo2_hayalet', { size: 2.34, rot: SROT + 18, delay: -0.012, life: 0.14, order: 2, color: '#6f7f99' }),
    quad('hayalet1', 'kesik_bdo2_hayalet', { size: 2.37, rot: SROT + 9, delay: -0.006, life: 0.17, order: 2, color: '#a3b4cc' }),
    // 3) üç renk katmanı: geniş iç (mor-mavi), ana (beyaz çekirdek), ince dış (camgöbeği), hafif açı/zaman kaydırmalı
    quad('ic', 'kesik_bdo2_ic', { size: 2.28, rot: SROT + 3, delay: 0.004, life: 0.3, order: 3 }),
    quad('ana', 'kesik_bdo2_ana', { size: SIZE, delay: 0, life: 0.26, order: 4 }),
    quad('dis', 'kesik_bdo2_dis', { size: 2.53, rot: SROT - 4, delay: 0.008, life: 0.22, order: 5 }),
    // 4) elektrik telleri
    quad('simsek', 'kesik_bdo2_simsek', { size: 2.39, delay: 0.002, life: 0.24, order: 6 }),
    // 5) isabet çakması + yıldız (yayın orta-ön kısmı)
    arcp('cakma', { tex: 'bdo_cakma', delay: 0.03, life: [0.09, 0.09], speed: [0, 0], size: [0.8, 0.8], color: ['#d4ebff', '#d4ebff'], count: [1, 1], max: 2,
      shape: { radiusThickness: 0, arc: 18, rotation: [0, 0, -40] }, sizeCurve: [[0, 0.5], [0.25, 1], [1, 1.15]], int: 1.1, order: 9 }),
    arcp('yildiz', { tex: 'bdo_parilti', delay: 0.032, life: [0.13, 0.13], speed: [0, 0], size: [0.75, 0.75], srot: [10, 10], color: ['#ffffff', '#ffffff'], count: [1, 1], max: 2,
      shape: { radiusThickness: 0, arc: 18, rotation: [0, 0, -40] }, sizeCurve: [[0, 0.3], [0.2, 1], [1, 0.6]], int: 4, order: 10 }),
    // 6) yoğun ışık parçaları
    arcp('parcalar', { tex: 'bdo_cizgi', mode: 'stretched', delay: 0.026, life: [0.14, 0.34], speed: [4, 10], size: [0.02, 0.05], color: ['#e6f2ff', '#7fb0ff'], count: [70, 90],
      shape: { randomDirection: 0.25 }, drag: 18, grad: [[0, '#ffffff'], [1, '#8fb4ff']], alpha: [[0, 1], [0.7, 0.8], [1, 0]], int: 1.8, len: 4, vel: 0.04, order: 8 }),
    // 7) havada asılı parıltılar (yavaş, göz kırpar)
    arcp('parilti', { tex: 'bdo_parilti', delay: 0.03, life: [0.4, 0.9], speed: [0.3, 1.5], size: [0.03, 0.08], srot: [0, 45], color: ['#cfe8ff', '#8ab4ff'], count: [30, 45],
      drag: 3, noise: 0.3, alpha: [[0, 0], [0.08, 1], [0.35, 0.5], [0.45, 1], [0.7, 0.4], [1, 0]], int: 3, order: 7 }),
    // 8) enerji dumanı: koyu (kontrast) + parlak, yaydan kopup süzülür
    arcp('duman', { tex: 'bdo_duman', sheet: [4, 4], blend: 'alpha', delay: 0.03, life: [0.45, 0.8], speed: [0.3, 0.9], size: [0.35, 0.7], srot: [0, 360],
      color: ['#1b2c5c', '#2a3f80'], count: [10, 14], max: 20, noise: 0.3, angv: [-40, 40], sizeCurve: [[0, 0.7], [1, 1.5]], alpha: [[0, 0], [0.15, 0.55], [1, 0]], order: 2 }),
    arcp('duman_isik', { tex: 'bdo_duman', sheet: [4, 4], delay: 0.028, life: [0.35, 0.6], speed: [0.4, 1.1], size: [0.3, 0.6], srot: [0, 360],
      color: ['#3a6dff', '#5a3dff'], count: [8, 10], max: 16, noise: 0.35, angv: [-60, 60], sizeCurve: [[0, 0.6], [1, 1.4]], alpha: [[0, 0], [0.12, 0.45], [1, 0]], int: 1.2, order: 3 }),
    arcp('kivrim', { tex: 'bdo_kivrim', mode: 'stretched', delay: 0.028, life: [0.3, 0.5], speed: [1.5, 3], size: [0.25, 0.5], color: ['#6aa0ff', '#8a6dff'], count: [6, 9], max: 12,
      drag: 6, alpha: [[0, 0], [0.1, 0.8], [1, 0]], int: 1.5, len: 2.2, vel: 0.08, order: 5 }),
  ],
};
fs.writeFileSync(path.join(ROOT, 'vfx', 'kesik_bdo2.json'), JSON.stringify(effect, null, 1));
console.log('yazıldı vfx/kesik_bdo2.json', effect.emitters.length, 'emitter');
