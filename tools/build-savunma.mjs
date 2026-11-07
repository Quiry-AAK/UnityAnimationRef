// Savunma efektleri: blok, parry, dodge. Hazır doku/düz çizgi yok (Docs/VFX_Kurallari.md).
// Shader/materyaller: tools/gen-vurus-shaders.mjs (vurus_cakma, halka_kirik, zerre_yumusak, duman_enerji) + gen-sarj-shaders (kılıf parlaması).
//  blok  : kılıca takılı, temas noktasında (bıçak ortası-üstü). Fiziksel, metal (enerji yok): minik temas parlaması + bıçak boyunca uca kayan
//          ve yere dökülen sıcak-beyaz kıvılcımlar + sönük toz tutamı. Parry'den ayrı dursun diye mavi/halka/çakma yok (2026-11-07, kullanıcı).
//          Sade (savunma, sık olur). Önizleme arpg_guard_hit1 (temas klip başında).
//  parry : ödül anı, enerji: camgöbeği-beyaz çakma + ekranı büken şok dalgası + iki kırık şok halkası + kılıç boyunca koşan parıltı + enerji zerreleri + ışık.
//          Önizleme arpg_parry (temas ~0,08 sn).
//  dodge : kalçaya takılı: geride kalan soluk gri-mavi hava izi + başta/sonda ayakta toz + birkaç hava zerresi. Sade. Önizleme arpg_dodge.
// Kılıç yereli (attach prop katana): bıçak +Z (−0,21 → 0,48), kesen ağız −Y yönünde (bıçak +Y'ye kavisli).
// Çalıştır: node tools/build-savunma.mjs → vfx/blok.json, vfx/parry.json, vfx/dodge.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const once = (count, time = 0) => ({ rateOverTime: 0, bursts: [{ time, count: [count, count], cycles: 1, interval: 0.01 }] });
const point = { type: 'sphere', radius: 0.001, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 0 };
const CONTACT = [0, -0.002, 0.14]; // bıçağın ortası (2026-11-07 kullanıcı: 'ortaya taşı ucuna değil'), kesen ağız tarafı
const EDGE = [90, 0, 0];           // koni +Z → −Y (ağızdan dışa)

const bb = (name, o) => ({
  name, position: o.pos || CONTACT, rotation: o.rot || [0, 0, 0],
  main: { duration: o.dur ?? 0.6, looping: o.loop ?? false, startDelay: o.delay ?? 0, startLifetime: o.life, startSpeed: o.speed || [0, 0], startSize: o.size,
    startRotation: o.srot || [0, 360], startColor: o.color || ['#ffffff', '#e6eeff'], gravity: o.gravity ?? 0, simulationSpace: o.space || 'world', maxParticles: o.max || 8 },
  emission: o.emission || once(o.count ?? 1, o.at ?? 0),
  shape: { enabled: true, ...(o.shape || point) },
  ...(o.drag ? { limitVelocity: { enabled: true, drag: o.drag, limit: 20, dampen: 0 } } : {}),
  ...(o.noise ? { noise: { enabled: true, strength: o.noise, frequency: 1.6, scrollSpeed: 0.8, octaves: 2 } } : {}),
  ...(o.force ? { force: { enabled: true, force: o.force, space: 'world' } } : {}),
  colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: o.alpha || [[0, 1], [1, 0]] },
  ...(o.sizeCurve ? { sizeOverLifetime: { enabled: true, curve: o.sizeCurve } } : {}),
  renderer: { mode: 'billboard', alignment: 'view', material: o.mat, texture: 'soft', blend: o.blend || 'additive', intensity: 1, sortingOrder: o.order ?? 5,
    ...(o.soft ? { softParticles: { enabled: true, distance: o.soft } } : {}),
    ...(o.blend === 'distortion' ? { distortion: { mode: 'radial', strength: o.distortion ?? 0.03, frequency: 1, scroll: 0 } } : {}) },
});
const fan = (angle, radius = 0.02) => ({ type: 'cone', angle, radius, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 0.2 });

const light = (name, { delay = 0, dur, intensity, radius, color, pos, curve }) => ({
  name, position: pos || CONTACT, rotation: [0, 0, 0],
  main: { duration: dur, looping: false, startDelay: delay, startLifetime: [0.1, 0.1], startSpeed: [0, 0], startSize: [0.01, 0.01],
    startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 1 },
  emission: { rateOverTime: 0, bursts: [] }, shape: { enabled: false },
  renderer: { mode: 'billboard', alignment: 'view', material: 'zerre_hafif', texture: 'soft', blend: 'additive', intensity: 0, sortingOrder: 0 },
  light: { enabled: true, mode: 'single', color, useParticleColor: false, intensity, radius, curve: curve || [[0, 1], [0.3, 0.45], [1, 0]], maxLights: 1, shadows: false },
});

// kılıç boyunca koşan parıltı (şarjdaki kılıf parlamasıyla aynı dil): mesh silindir, yerel (kılıçla gider)
const glint = (name, delay) => ({
  name, position: [0, -0.017, -0.21], rotation: [-5.2, 0, 0],
  main: { duration: 0.3, looping: false, startDelay: delay, startLifetime: [0.14, 0.14], startSpeed: [0, 0], startSize: [1, 1],
    startRotation: [0, 0], startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 1 },
  emission: once(1), shape: { enabled: false },
  colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [0.7, 1], [1, 0]] },
  customData: { enabled: true, x: [[0, -0.05], [1, 1.12]], y: [[0, 0], [1, 0]], z: [[0, 0], [1, 0]], w: [[0, 0], [1, 0]] },
  renderer: { mode: 'mesh', mesh: { shape: 'cylinder', file: '', innerRadius: 0.022, outerRadius: 0.05, angle: 360, height: 0.69, segments: 48, rings: 24, rotation: [90, 0, 0] },
    alignment: 'local', material: 'agir_sarj_kilif_parlama', texture: 'soft', blend: 'additive', intensity: 1, sortingOrder: 4 },
});

const T_PARRY = 0.095; // kılıç dikildiği kare: efekt kalkık bıçağın ucunda görünsün (0,08'de bıçak yatay, efekt göğüs hizasında kalıyordu)
const effects = {
  blok: {
    duration: 0.58, attach: { target: 'prop', name: 'katana' }, preview: { anim: 'arpg_guard_hit1', startFrame: 0 },
    emitters: [
      // blok = çelik çeliğe, fiziksel: enerji çakması/halka/mavi yok. Minik temas parlaması + bıçak boyunca sürtünüp
      // uca doğru kayan ve yere dökülen sıcak-beyaz metal kıvılcımlar + darbeyle itilen sönük toz/hava tutamı.
      bb('temas', { mat: 'zerre_metal', at: 0.03, life: [0.05, 0.05], size: [0.07, 0.07], sizeCurve: [[0, 1], [1, 0.3]], color: ['#ffffff', '#ffffff'], order: 6 }),
      bb('surtunme', { mat: 'zerre_metal', count: 34, at: 0.03, max: 36, life: [0.25, 0.5], speed: [1.6, 3.8], size: [0.014, 0.026], drag: 2.5, gravity: 1.3,
        rot: [40, 0, 0], shape: { ...fan(22, 0.01), type: 'cone' }, alpha: [[0, 1], [0.75, 0.9], [1, 0]], sizeCurve: [[0, 1], [1, 0.5]], color: ['#ffffff', '#fff2e0'] }),
      bb('dokulen', { mat: 'zerre_metal', count: 12, at: 0.03, max: 12, life: [0.35, 0.6], speed: [0.5, 1.4], size: [0.018, 0.028], drag: 1.5, gravity: 1.6,
        rot: EDGE, shape: fan(60), alpha: [[0, 1], [0.8, 0.8], [1, 0]], sizeCurve: [[0, 1], [1, 0.5]], color: ['#ffffff', '#ffecd4'] }),
      bb('toz', { mat: 'blok_toz', blend: 'alpha', soft: 0.15, count: 3, at: 0.03, max: 3, life: [0.3, 0.45], speed: [0.3, 0.6], size: [0.13, 0.2], drag: 2,
        rot: EDGE, shape: fan(40), alpha: [[0, 0], [0.15, 0.35], [1, 0]], sizeCurve: [[0, 0.6], [1, 1.5]], color: ['#ffffff', '#ecebe6'], order: 1 }),
      light('isik', { delay: 0.03, dur: 0.06, intensity: 0.25, radius: 0.6, color: '#fff2e0' }),
    ],
  },
  parry: {
    duration: 0.58, attach: { target: 'prop', name: 'katana' }, preview: { anim: 'arpg_parry', startFrame: 0 },
    emitters: [
      // parry = enerji, ödül: camgöbeği-beyaz çakma + ekranı büken şok dalgası + iki kırık halka + kılıç parıltısı + enerji zerreleri
      bb('bukulme', { mat: 'parry_bukulme', blend: 'distortion', at: T_PARRY, space: 'local', life: [0.24, 0.24], size: [0.5, 0.5], sizeCurve: [[0, 0.3], [0.4, 1.3], [1, 2.2]], order: 0, distortion: 0.04 }),
      bb('cakma', { mat: 'parry_cakma', at: T_PARRY, space: 'local', life: [0.14, 0.15], size: [0.5, 0.56], sizeCurve: [[0, 0.5], [0.25, 1], [1, 1.12]], order: 4 }),
      bb('cekirdek', { mat: 'zerre_hafif_isik', at: T_PARRY, space: 'local', life: [0.07, 0.07], size: [0.16, 0.16], sizeCurve: [[0, 1], [1, 0.4]], color: ['#f6fbff', '#f6fbff'], order: 6 }),
      bb('halka', { mat: 'parry_halka', at: T_PARRY, space: 'local', life: [0.22, 0.22], size: [0.35, 0.35], sizeCurve: [[0, 0.35], [0.4, 1.4], [1, 2.0]], order: 3 }),
      bb('halka2', { mat: 'parry_halka', at: T_PARRY, space: 'local', life: [0.26, 0.26], size: [0.22, 0.22], sizeCurve: [[0, 0.2], [0.3, 0.6], [1, 1.5]], color: ['#e8f2ff', '#ffffff'], order: 3 }),
      glint('parilti', T_PARRY),
      bb('enerji', { mat: 'zerre_parry', count: 22, at: T_PARRY, space: 'local', max: 24, life: [0.25, 0.5], speed: [1.8, 4.2], size: [0.014, 0.026], drag: 6, noise: 0.5,
        rot: EDGE, shape: fan(85), alpha: [[0, 1], [0.7, 0.9], [1, 0]], sizeCurve: [[0, 1], [1, 0.35]], color: ['#ffffff', '#e2f6ff'] }),
      bb('zerre', { mat: 'zerre_hafif', count: 10, at: T_PARRY, space: 'local', max: 12, life: [0.25, 0.5], speed: [0.6, 1.6], size: [0.014, 0.026], drag: 3, noise: 0.4,
        rot: EDGE, shape: fan(85), alpha: [[0, 1], [1, 0]], sizeCurve: [[0, 1], [1, 0.3]], color: ['#cfe6ff', '#ffffff'] }),
      light('isik', { delay: T_PARRY, dur: 0.2, intensity: 1.0, radius: 1.5, color: '#8fe0ff', curve: [[0, 1], [0.2, 0.5], [1, 0]] }),
    ],
  },
  dodge: {
    duration: 0.72, attach: { target: 'bone', name: 'Hips' }, preview: { anim: 'arpg_dodge', startFrame: 0 },
    emitters: [
      bb('iz_sis', { mat: 'dodge_sis', blend: 'alpha', soft: 0.2, pos: [0, -0.1, 0], dur: 0.36, delay: 0.03, emission: { rateOverTime: 60, bursts: [] }, max: 40,
        life: [0.35, 0.55], speed: [0.05, 0.15], size: [0.32, 0.48], noise: 0.25, shape: { type: 'sphere', radius: 0.3, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 1 },
        alpha: [[0, 0], [0.15, 0.3], [1, 0]], sizeCurve: [[0, 0.7], [1, 1.5]], color: ['#ffffff', '#e4ecff'], order: 1 }),
      bb('zerre', { mat: 'zerre_hafif', pos: [0, -0.2, 0], dur: 0.36, delay: 0.03, emission: { rateOverTime: 26, bursts: [] }, max: 16,
        life: [0.25, 0.45], speed: [0.1, 0.4], size: [0.008, 0.016], noise: 0.5, shape: { type: 'sphere', radius: 0.35, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [0, 0, 0], randomDirection: 1 },
        alpha: [[0, 0], [0.2, 0.7], [1, 0]], color: ['#d8e6ff', '#ffffff'] }),
      bb('toz_bas', { mat: 'dodge_toz', blend: 'alpha', soft: 0.25, pos: [0, -0.86, 0], count: 4, max: 4, life: [0.45, 0.65], speed: [0.2, 0.5], size: [0.45, 0.65], drag: 1, force: [0, 0.15, 0],
        shape: { type: 'circle', radius: 0.12, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [90, 0, 0], randomDirection: 0.3 },
        alpha: [[0, 0], [0.15, 0.5], [1, 0]], sizeCurve: [[0, 0.6], [1, 1.4]], color: ['#ffffff', '#ece6dc'], order: 0 }),
      bb('toz_son', { mat: 'dodge_toz', blend: 'alpha', soft: 0.25, pos: [0, -0.86, 0], at: 0.34, count: 3, max: 3, life: [0.4, 0.6], speed: [0.15, 0.4], size: [0.4, 0.55], drag: 1, force: [0, 0.12, 0],
        shape: { type: 'circle', radius: 0.12, radiusThickness: 1, arc: 360, position: [0, 0, 0], rotation: [90, 0, 0], randomDirection: 0.3 },
        alpha: [[0, 0], [0.15, 0.35], [1, 0]], sizeCurve: [[0, 0.6], [1, 1.35]], color: ['#ffffff', '#ece6dc'], order: 0 }),
    ],
  },
};

for (const [name, e] of Object.entries(effects)) {
  const effect = { format: 'upe-vfx-1', name, duration: e.duration, loop: true,
    attach: { position: [0, 0, 0], rotation: [0, 0, 0], ...e.attach },
    preview: { withAnimation: true, startFrame: e.preview.startFrame, freezeAnim: false, background: '#3a4150', bloom: 0.8, showHero: true, showGrid: true, showGround: name === 'dodge' },
    emitters: e.emitters };
  fs.writeFileSync(path.join(ROOT, 'vfx', name + '.json'), JSON.stringify(effect, null, 1));
  console.log('yazıldı vfx/' + name + '.json', e.emitters.length, 'emitter', '(önizleme animasyonu: ' + e.preview.anim + ')');
}
