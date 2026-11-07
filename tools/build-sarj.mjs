// Ağır saldırı şarj efekti (agir_sarj): kılıca takılı (attach prop katana). Hazır doku/düz çizgi yok (Docs/VFX_Kurallari.md);
// shader/materyaller tools/gen-sarj-shaders.mjs + zerre_hafif(_isik).
// Zaman çizgisi oyundakiyle aynı (UElarionAttackComponent): 0 = bekleme karesinde donma (OnChargeStarted), 0,6 sn = dolu (OnChargeFull),
// sonrası tuş bırakılana kadar süren dolu hâl (oyunda bırakışta sistem kapatılır).
//  dolum (0–0,6): kabzadan uca dolan enerji kılıfı + bükülme + kılıca çekilen zerreler + artan ışık
//  dolu  (0,6)  : kabzadan uca koşan beyaz parlama dalgası + kılıf beyaz parlar + uçta ışık + savrulan zerreler + ışık patlaması
//  sürüm (0,6+) : daha parlak, nabızlı kılıf + yükselen zerreler + sabit ışık
// Çalıştır: node tools/build-sarj.mjs → vfx/agir_sarj.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Katana (attach: prop katana, orijin = model merkezi, ±Z boyunca ~0,92 m): bıçak +Z yönünde, kabza -Z.
// Ölçüm (props/Elarion_Katana.glb, ×0,9238, merkezlenmiş): tsuba z −0,255; bıçak −0,21 → uç 0,46; bıçak ekseni kavisli, y −0,017 (dip) → +0,037 (uç) ≈ 4,7° eğim.
const B = { guard: -0.21, tip: 0.48, y: -0.017, tilt: -5.2 };
const LEN = B.tip - B.guard;
const MID = (B.tip + B.guard) / 2;
const T_FULL = 0.6;
const LONG = 30; // sürüm katmanlarının ömrü: oyunda bırakışta sistem kapanır

const lifeAlpha = (a) => ({ enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: a });
const once = (count, time = 0) => ({ rateOverTime: 0, bursts: [{ time, count: [count, count], cycles: 1, interval: 0.01 }] });
const flat = (v) => [[0, v], [1, v]];

function sheath(name, material, { delay = 0, life, rOut = 0.05, rIn = 0.018, x, y = flat(0), alpha = [[0, 1], [1, 1]], order = 3, blend = 'additive', extra = {} }) {
  return {
    name, position: [0, B.y, B.guard], rotation: [B.tilt, 0, 0],
    main: { duration: Math.max(life, 0.1), looping: false, startDelay: delay, startLifetime: [life, life], startSpeed: [0, 0], startSize: [1, 1],
      startRotation: [0, 0], startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 1 },
    emission: once(1), shape: { enabled: false }, colorOverLifetime: lifeAlpha(alpha),
    customData: { enabled: true, x, y, z: flat(0), w: flat(0) },
    renderer: { mode: 'mesh', mesh: { shape: 'cylinder', file: '', innerRadius: rIn, outerRadius: rOut, angle: 360, height: LEN, segments: 48, rings: 24, rotation: [90, 0, 0] },
      alignment: 'local', material, texture: 'soft', blend, intensity: 1, sortingOrder: order, ...extra },
  };
}

const mote = (name, o) => ({
  name, position: o.pos || [0, B.y, MID], rotation: o.rot || [0, 0, 0],
  main: { duration: o.dur ?? 1, looping: o.loop ?? false, startDelay: o.delay ?? 0, startLifetime: o.life, startSpeed: o.speed, startSize: o.size,
    startRotation: [0, 360], startColor: o.color || ['#cfe9ff', '#ffffff'], gravity: 0, simulationSpace: o.space || 'local', maxParticles: o.max || 64 },
  emission: o.emission,
  shape: { enabled: true, ...o.shape },
  ...(o.drag ? { limitVelocity: { enabled: true, drag: o.drag, limit: 12, dampen: 0 } } : {}),
  ...(o.noise ? { noise: { enabled: true, strength: o.noise, frequency: 1.6, scrollSpeed: 0.8, octaves: 2 } } : {}),
  ...(o.force ? { force: { enabled: true, force: o.force, space: 'world' } } : {}),
  colorOverLifetime: lifeAlpha(o.alpha || [[0, 0], [0.2, 1], [1, 0]]),
  ...(o.sizeCurve ? { sizeOverLifetime: { enabled: true, curve: o.sizeCurve } } : {}),
  renderer: { mode: 'billboard', alignment: 'view', material: o.mat || 'zerre_hafif', texture: 'soft', blend: 'additive', intensity: 1, sortingOrder: o.order ?? 5 },
});

const light = (name, { delay = 0, dur, loop = false, intensity, radius, curve, color = '#8cc4ff' }) => ({
  name, position: [0, B.y, B.guard + LEN * 0.68], // ışık bıçağın uç tarafında: kabzadaki eller parlamasın rotation: [0, 0, 0],
  main: { duration: dur, looping: loop, startDelay: delay, startLifetime: [0.1, 0.1], startSpeed: [0, 0], startSize: [0.01, 0.01],
    startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 1 },
  emission: { rateOverTime: 0, bursts: [] }, shape: { enabled: false },
  renderer: { mode: 'billboard', alignment: 'view', material: 'zerre_hafif', texture: 'soft', blend: 'additive', intensity: 0, sortingOrder: 0 },
  light: { enabled: true, mode: 'single', color, useParticleColor: false, intensity, radius, curve, maxLights: 1, shadows: false },
});

// bıçaktan yükselen kıvrımlı enerji dumanı (duman_enerji_isik; tohum parçacık renginden)
const aura = (name, { delay, dur, loop = false, rate }) => mote(name, {
  delay, dur, loop, life: [0.45, 0.75], speed: [0.04, 0.14], size: [0.1, 0.2], max: 30, noise: 0.25, space: 'world',
  force: [0, 0.35, 0], emission: { rateOverTime: rate, bursts: [] },
  shape: { type: 'edge', radius: LEN * 0.42, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 90, 0], randomDirection: 0.4 },
  mat: 'agir_sarj_aura', color: ['#ffffff', '#c8d4ff'], alpha: [[0, 0], [0.25, 0.8], [1, 0]], sizeCurve: [[0, 0.5], [0.4, 1], [1, 1.3]], order: 2,
});

// kılıfın dolum eğrisi: yavaş başlar, sona doğru hızlanır (biriken güç)
const fill = [[0, -0.04], [0.25, 0.14], [0.5, 0.36], [0.75, 0.64], [1, 1.02]];
const fullAt = T_FULL / LONG; // sürüm katmanında 0,6 sn'lik dolum ve parlama, ömür kesri olarak
const sec = (s) => +(s / LONG).toFixed(5);

const ringZ = [B.guard + LEN * 0.2, B.guard + LEN * 0.5, B.guard + LEN * 0.8];
const emitters = [
  // dolum
  sheath('kilif', 'agir_sarj_kilif', { life: T_FULL, x: fill, alpha: [[0, 0], [0.12, 1], [1, 1]] }),
  sheath('bukulme', 'agir_sarj_bukulme', { life: LONG, rOut: 0.085, rIn: 0.05, order: 1, blend: 'distortion',
    x: [[0, -0.04], [sec(0.15), 0.14], [sec(0.3), 0.36], [sec(0.45), 0.64], [fullAt, 1.05], [1, 1.05]],
    extra: { distortion: { mode: 'noise', strength: 0.012, frequency: 1, scroll: 0 } } }),
  // yumuşak hale (kılıç ışıyor; buz kabuğu gibi kaplanmış görünmesin) — dolumla birlikte büyür, sürümde kalır
  sheath('hale', 'agir_sarj_hale', { life: LONG, rOut: 0.11, rIn: 0.055, order: 2,
    x: [[0, -0.04], [sec(0.15), 0.14], [sec(0.3), 0.36], [sec(0.45), 0.64], [fullAt, 1.05], [1, 1.05]] }),
  aura('aura_dolum', { delay: 0.12, dur: T_FULL - 0.12, rate: 12 }),
  ...ringZ.map((z, k) => mote(`cekilen${k}`, {
    pos: [0, B.y, z], dur: T_FULL - 0.12 * (k === 0 ? 0 : 0.5), delay: 0.05 * k,
    life: [0.32, 0.45], speed: [-1.25, -0.85], size: [0.022, 0.04], max: 40, noise: 0.35,
    emission: { rateOverTime: 26, bursts: [] }, shape: { type: 'circle', radius: 0.42, radiusThickness: 0.35, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 0.1 },
    alpha: [[0, 0], [0.35, 1], [0.85, 0.9], [1, 0]], sizeCurve: [[0, 0.5], [0.6, 1], [1, 0.35]],
  })),
  light('isik_dolum', { dur: T_FULL, intensity: 0.7, radius: 1.6, curve: [[0, 0.05], [0.6, 0.4], [1, 1]] }),
  // dolu anı
  sheath('kilif_dolu', 'agir_sarj_kilif_dolu', { delay: T_FULL, life: LONG, rOut: 0.052, rIn: 0.02, x: flat(1.2),
    y: [[0, 0.45], [sec(0.12), 0.15], [sec(0.3), 0], [1, 0]], alpha: [[0, 1], [1, 1]] }),
  sheath('parlama', 'agir_sarj_kilif_parlama', { delay: T_FULL, life: 0.2, rOut: 0.06, rIn: 0.024, order: 4,
    x: [[0, -0.05], [1, 1.12]], alpha: [[0, 1], [0.75, 1], [1, 0]] }),
  mote('uc_isik', { pos: [0, B.y, B.tip - 0.02], delay: T_FULL + 0.16, life: [0.28, 0.28], speed: [0, 0], size: [0.22, 0.22], max: 1,
    emission: once(1), shape: { type: 'sphere', radius: 0.001, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 0 },
    mat: 'zerre_hafif_isik', color: ['#e8f4ff', '#e8f4ff'], alpha: [[0, 1], [1, 0]], sizeCurve: [[0, 1], [0.3, 0.7], [1, 0.25]], order: 6 }),
  mote('savrulan', { delay: T_FULL, life: [0.35, 0.65], speed: [0.7, 1.7], size: [0.016, 0.034], max: 40, drag: 3.2, noise: 0.25, space: 'world',
    emission: once(30), shape: { type: 'edge', radius: LEN * 0.45, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 90, 0], randomDirection: 0.65 },
    alpha: [[0, 1], [0.6, 0.8], [1, 0]], sizeCurve: [[0, 1], [1, 0.3]] }),
  light('isik_parlama', { delay: T_FULL, dur: 0.35, intensity: 0.9, radius: 1.7, curve: [[0, 1], [0.25, 0.55], [1, 0]], color: '#a8d4ff' }),
  // sürüm (dolu kalırken)
  mote('yukselen', { delay: T_FULL + 0.1, dur: 1, loop: true, life: [0.6, 1.0], speed: [0.06, 0.2], size: [0.012, 0.026], max: 40, noise: 0.3, space: 'world',
    force: [0, 0.45, 0], emission: { rateOverTime: 16, bursts: [] },
    shape: { type: 'edge', radius: LEN * 0.45, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 90, 0], randomDirection: 0.5 },
    alpha: [[0, 0], [0.2, 0.9], [1, 0]], sizeCurve: [[0, 0.6], [0.3, 1], [1, 0.3]] }),
  aura('aura_dolu', { delay: T_FULL, dur: 1, loop: true, rate: 18 }),
  light('isik_dolu', { delay: T_FULL, dur: 0.8, loop: true, intensity: 0.5, radius: 1.6, curve: [[0, 1], [0.35, 0.85], [0.7, 1], [1, 0.9]] }),
];

const effect = {
  format: 'upe-vfx-1', name: 'agir_sarj', duration: 1.6, loop: true,
  attach: { target: 'prop', name: 'katana', position: [0, 0, 0], rotation: [0, 0, 0] },
  preview: { withAnimation: true, startFrame: 12, freezeAnim: true, background: '#3a4150', bloom: 0.8, showHero: true, showGrid: true },
  emitters,
};
fs.writeFileSync(path.join(ROOT, 'vfx', 'agir_sarj.json'), JSON.stringify(effect, null, 1));
console.log('yazıldı vfx/agir_sarj.json', emitters.length, 'emitter');
