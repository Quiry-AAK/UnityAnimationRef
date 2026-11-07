// İsabet efektleri: vurus_hafif, vurus_agir, vurus_kahraman. Hazır doku/düz çizgi yok (Docs/VFX_Kurallari.md).
// Oyunda FElarionHitInfo.Location'da doğar, yerel +Z = FElarionHitInfo.Direction (vuruş yönü, hedefin itildiği yön), +Y yukarı.
// Dolu şarjlı ağır (bCharged) için vurus_agir ~1,3 ölçekle doğurulabilir. Hit stop Niagara'yı dondurmaz: çakma donma anında da açılır.
//  hafif    : sade (Kademe kuralı): küçük organik çakma + çekirdek + vuruş yönüne savrulan az zerre + kısa ışık (~0,3 sn)
//  agir     : şaşalı: büyük çakma + çekirdek + iki kırık şok halkası + bükülme + bol zerre + enerji dumanı + güçlü ışık
//  kahraman : kahraman hasar alınca, tehlike rengi (turuncu-kırmızı): çakma + sıcak zerreler + kısa sıcak ışık
// Çalıştır: node tools/build-vurus.mjs → vfx/vurus_*.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const once = (count, time = 0) => ({ rateOverTime: 0, bursts: [{ time, count: [count, count], cycles: 1, interval: 0.01 }] });
const point = { type: 'sphere', radius: 0.001, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 0 };

const bb = (name, o) => ({
  name, position: o.pos || [0, 0, 0], rotation: o.rot || [0, 0, 0],
  main: { duration: o.dur ?? 0.6, looping: false, startDelay: o.delay ?? 0, startLifetime: o.life, startSpeed: o.speed || [0, 0], startSize: o.size,
    startRotation: o.srot || [0, 360], startColor: o.color || ['#ffffff', '#e6eeff'], gravity: o.gravity ?? 0, simulationSpace: o.space || 'world', maxParticles: o.max || 8 },
  emission: once(o.count ?? 1, o.at ?? 0),
  shape: { enabled: true, ...(o.shape || point) },
  ...(o.drag ? { limitVelocity: { enabled: true, drag: o.drag, limit: 20, dampen: 0 } } : {}),
  ...(o.noise ? { noise: { enabled: true, strength: o.noise, frequency: 1.8, scrollSpeed: 0.8, octaves: 2 } } : {}),
  ...(o.force ? { force: { enabled: true, force: o.force, space: 'world' } } : {}),
  colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: o.alpha || [[0, 1], [1, 0]] },
  ...(o.sizeCurve ? { sizeOverLifetime: { enabled: true, curve: o.sizeCurve } } : {}),
  ...(o.angv ? { rotationOverLifetime: { enabled: true, angularVelocity: o.angv } } : {}),
  renderer: { mode: 'billboard', alignment: 'view', material: o.mat, texture: 'soft', blend: 'additive', intensity: 1, sortingOrder: o.order ?? 5 },
});

// vuruş yönüne açılan koni (koni +Z'ye açılır)
const fan = (angle, radius = 0.03) => ({ type: 'cone', angle, radius, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 0.15 });

const ring = (name, o) => ({
  name, position: [0, 0, 0], rotation: [0, 0, 0],
  main: { duration: 0.6, looping: false, startDelay: o.delay ?? 0, startLifetime: [o.life, o.life], startSpeed: [0, 0], startSize: [1, 1],
    startRotation: [0, 360], startColor: o.color || ['#ffffff', '#dfe8ff'], gravity: 0, simulationSpace: 'world', maxParticles: 1 },
  emission: once(1), shape: { enabled: false },
  colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [1, 0]] },
  sizeOverLifetime: { enabled: true, curve: o.grow },
  renderer: { mode: 'mesh', mesh: { shape: 'arc', file: '', innerRadius: o.inner, outerRadius: o.outer, angle: 360, height: 0.5, segments: 96, rings: 6, rotation: [0, 0, 0] },
    alignment: 'local', material: o.mat, texture: 'soft', blend: o.blend || 'additive', intensity: 1, sortingOrder: o.order ?? 3,
    ...(o.blend === 'distortion' ? { distortion: { mode: 'noise', strength: o.strength ?? 0.03, frequency: 1, scroll: 0 } } : {}) },
});

const light = (name, { dur, intensity, radius, color, curve }) => ({
  name, position: [0, 0, -0.1], rotation: [0, 0, 0],
  main: { duration: dur, looping: false, startDelay: 0, startLifetime: [0.1, 0.1], startSpeed: [0, 0], startSize: [0.01, 0.01],
    startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 1 },
  emission: { rateOverTime: 0, bursts: [] }, shape: { enabled: false },
  renderer: { mode: 'billboard', alignment: 'view', material: 'zerre_hafif', texture: 'soft', blend: 'additive', intensity: 0, sortingOrder: 0 },
  light: { enabled: true, mode: 'single', color, useParticleColor: false, intensity, radius, curve: curve || [[0, 1], [0.3, 0.45], [1, 0]], maxLights: 1, shadows: false },
});

const effects = {
  vurus_hafif: {
    duration: 0.5,
    emitters: [
      bb('cakma', { mat: 'vurus_hafif_cakma', life: [0.1, 0.11], size: [0.22, 0.26], sizeCurve: [[0, 0.55], [0.3, 1], [1, 1.12]], order: 4 }),
      bb('cekirdek', { mat: 'zerre_hafif_isik', life: [0.06, 0.06], size: [0.08, 0.08], sizeCurve: [[0, 1], [1, 0.4]], color: ['#eef6ff', '#eef6ff'], order: 6 }),
      bb('zerre', { mat: 'zerre_hafif', count: 9, max: 12, life: [0.14, 0.28], speed: [1.4, 3.0], size: [0.012, 0.024], drag: 7, shape: fan(55),
        alpha: [[0, 1], [0.6, 0.8], [1, 0]], sizeCurve: [[0, 1], [1, 0.35]], color: ['#d6ecff', '#ffffff'] }),
      light('isik', { dur: 0.14, intensity: 1.1, radius: 1.4, color: '#9fcbff' }),
    ],
  },
  vurus_agir: {
    duration: 0.8,
    emitters: [
      ring('bukulme', { mat: 'vurus_agir_bukulme', blend: 'distortion', strength: 0.03, life: 0.26, inner: 0.06, outer: 0.16, grow: [[0, 0.5], [1, 4.2]], order: 1 }),
      bb('cakma', { mat: 'vurus_agir_cakma', life: [0.18, 0.2], size: [0.7, 0.8], sizeCurve: [[0, 0.5], [0.25, 1], [1, 1.15]], order: 4 }),
      bb('cakma2', { mat: 'vurus_agir_cakma', at: 0.04, life: [0.14, 0.16], size: [0.38, 0.42], sizeCurve: [[0, 0.6], [0.3, 1], [1, 1.1]], color: ['#e0ecff', '#ffffff'], order: 4 }),
      bb('cekirdek', { mat: 'zerre_hafif_isik', life: [0.08, 0.08], size: [0.18, 0.18], sizeCurve: [[0, 1], [1, 0.35]], color: ['#f2f8ff', '#f2f8ff'], order: 6 }),
      ring('halka', { mat: 'vurus_agir_halka', life: 0.24, inner: 0.05, outer: 0.13, grow: [[0, 0.6], [1, 4.6]], order: 3 }),
      ring('halka2', { mat: 'vurus_agir_halka', delay: 0.05, life: 0.22, inner: 0.04, outer: 0.1, grow: [[0, 0.6], [1, 3.4]], color: ['#cfe0ff', '#ffffff'], order: 3 }),
      bb('zerre', { mat: 'zerre_hafif', count: 26, max: 30, life: [0.2, 0.45], speed: [2.0, 5.2], size: [0.014, 0.032], drag: 9, noise: 0.4, shape: fan(68, 0.05),
        alpha: [[0, 1], [0.6, 0.85], [1, 0]], sizeCurve: [[0, 1], [1, 0.3]], color: ['#cfe6ff', '#ffffff'] }),
      bb('zerre_isik', { mat: 'zerre_hafif_isik', count: 6, max: 8, life: [0.18, 0.3], speed: [1.5, 3.5], size: [0.03, 0.05], drag: 8, shape: fan(50, 0.04),
        alpha: [[0, 1], [1, 0]], sizeCurve: [[0, 1], [1, 0.3]], color: ['#e6f2ff', '#ffffff'], order: 6 }),
      bb('duman', { mat: 'vurus_agir_duman', count: 4, max: 6, at: 0.02, life: [0.4, 0.6], speed: [0.25, 0.7], size: [0.28, 0.42], drag: 1.5, force: [0, 0.3, 0], shape: fan(60, 0.06),
        alpha: [[0, 0], [0.15, 0.8], [1, 0]], sizeCurve: [[0, 0.5], [0.4, 1], [1, 1.35]], color: ['#ffffff', '#c8d4ff'], order: 2 }),
      light('isik', { dur: 0.3, intensity: 1.3, radius: 2.2, color: '#8fc0ff', curve: [[0, 1], [0.2, 0.6], [1, 0]] }),
    ],
  },
  vurus_kahraman: {
    duration: 0.5,
    emitters: [
      bb('cakma', { mat: 'vurus_kahraman_cakma', life: [0.14, 0.16], size: [0.4, 0.46], sizeCurve: [[0, 0.55], [0.3, 1], [1, 1.12]], color: ['#ffffff', '#fff2e6'], order: 4 }),
      bb('cekirdek', { mat: 'zerre_tehlike', life: [0.08, 0.08], size: [0.14, 0.14], sizeCurve: [[0, 1], [1, 0.4]], color: ['#fff4ea', '#fff4ea'], order: 6 }),
      bb('zerre', { mat: 'zerre_tehlike', count: 12, max: 16, life: [0.16, 0.34], speed: [1.5, 3.6], size: [0.012, 0.026], drag: 7, gravity: 0.4, shape: fan(60),
        alpha: [[0, 1], [0.6, 0.8], [1, 0]], sizeCurve: [[0, 1], [1, 0.3]], color: ['#ffe2cc', '#ffffff'] }),
      light('isik', { dur: 0.18, intensity: 1.4, radius: 1.6, color: '#ff8a5a' }),
    ],
  },
};

for (const [name, e] of Object.entries(effects)) {
  const effect = { format: 'upe-vfx-1', name, duration: e.duration, loop: true,
    attach: { target: 'none', name: '', position: [0, 0, 0], rotation: [0, 0, 0] },
    preview: { withAnimation: false, startFrame: 0, freezeAnim: false, background: '#3a4150', bloom: 0.8, showHero: false, showGrid: true },
    emitters: e.emitters };
  fs.writeFileSync(path.join(ROOT, 'vfx', name + '.json'), JSON.stringify(effect, null, 1));
  console.log('yazıldı vfx/' + name + '.json', e.emitters.length, 'emitter');
}
