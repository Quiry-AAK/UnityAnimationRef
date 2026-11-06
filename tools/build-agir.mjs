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
  h2: { anim: 'arpg_attack_combo2_from_b2', normal: [0.786, 0.6161, 0.0508], center: [0.0876, 1.1783, 1.4487], rotation: [-38.032, 86.3, 59.078],
    radius: 0.9606, angle: 190.57, inner: 0.3339, impact: 0.6, axes: { X: [-0.4943, 0.6757, -0.5469], Y: [-0.3713, 0.4048, 0.8356] },
    progress: [[0.4, 0], [0.4083, 0.1184], [0.4167, 0.2464], [0.425, 0.4045], [0.4333, 0.5587], [0.4417, 0.7957], [0.45, 1]] },
  // H3: atılışla birlikte kesiş (kare 24–31); uç yolu atılış yüzünden büyük yarıçaplı, neredeyse düz bir yay
  h3: { anim: 'arpg_attack_combo3_from_b3', normal: [-0.6663, 0.6942, -0.2723], center: [2.2059, 3.3036, 3.3631], rotation: [-43.966, -112.226, -108.481],
    radius: 3.1679, angle: 45.56, inner: 0.92, impact: 0.5, axes: { X: [-0.4896, -0.6826, -0.5425], Y: [-0.5625, -0.2282, 0.7947] },
    progress: [[0.4, 0], [0.4167, 0.047], [0.4333, 0.121], [0.45, 0.2228], [0.4583, 0.3545], [0.4667, 0.4868], [0.475, 0.6223], [0.4833, 0.7838], [0.4917, 0.8606], [0.5, 0.9325], [0.5167, 1]] },
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
  if (variant === 'delme') {
    // H3 "delme" (sıfırdan, BDO dili): kahraman katanayla birlikte havayı delip geçer. Atılış düz +Z (kalça z 1.57 → 2.82,
    // 0.43–0.55 sn; UPE'de kemik dünya konumundan ölçüldü). Kahramanı saran, önde sivrilen hacimli rüzgâr konisi onunla birlikte
    // ilerler (parçacık hızı 25 m/sn, kare başı sönüm → ~1.25 m'de durur): dış şok kabuğu (fresnel siluet) + sarmal rüzgâr
    // şeritleri + sıcak iç çekirdek + hava bükülmesi. Önceden kılıca zerre toplanır; uçta iki ses duvarı halkası + zerre patlaması;
    // yol boyunca geriye akan zerreler ve yandan kalkan toz. Koni arkadan öne çözülerek söner. H1 yarık / H2 hilal dilinden ayrı.
    const T0 = 0.43, V0 = 25, DAMP = 0.283, AXX = 0.1, AXY = 1.05;
    const cone = (name, mat, { Rb, L, back, life, order, tw = 120, blend = 'additive', extra = {} }) => {
      const e = arc(name, mat, { blend, order, dt: T0 - t0, life, extra,
        mesh: { shape: 'burgu', file: '', innerRadius: 0.015, outerRadius: Rb, angle: tw, height: L, segments: 128, rings: 40 } });
      e.renderer.mesh.rotation = [90, 0, 0];                       // koni ekseni (yerel Y) → +Z
      e.position = [AXX, AXY, back]; e.rotation = [0, 0, 0];
      e.main.startSpeed = [V0, V0];                                  // shape kapalı → +Z
      e.limitVelocity = { enabled: true, limit: 0, dampen: DAMP, drag: 0 };
      e.customData.x = [[0, 1], [1, 1]];
      e.customData.y = [[0, 0], [0.28, 0], [0.72, 1], [1, 1]];   // kahraman durunca (~0.55 sn) arkadan çözülmeye başlar
      e.sizeOverLifetime = { enabled: true, curve: [[0, 0.8], [0.15, 1], [1, 1.06]] };
      return e;
    };
    const flowBack = (sp) => ({ enabled: true, linear: [0, 0, -sp], orbital: [0, 0, 0], radial: 0, space: 'world', speedModifier: 1 });
    const trail = [[2.0, 0.45], [2.8, 0.48], [3.6, 0.51]].map(([z, d], k) => {
      const e = emitAt('akinti' + k, [AXX, AXY, z], [0, 0, 0], { delay: d, life: [0.2, 0.45], speed: [0.8, 2.2], size: [0.025, 0.055], color: ['#eef6ff', '#8fbaff'],
        max: 30, count: [16, 22], r: 0.55, thick: 0.3, arc: 360, from: 0, rand: 0.2, drag: 3, mat: 'zerre_hafif', order: 8 });
      e.velocity = flowBack(4); return e;
    });
    const dust = [[1.9, 0.45], [2.5, 0.49]].map(([z, d], k) => {
      const e = emitAt('toz' + k, [AXX, 0.05, z], [-90, 0, 0], { delay: d, life: [0.5, 0.9], speed: [1.2, 2.6], size: [0.3, 0.6], srot: [0, 360], color: ['#ffffff', '#eef3ff'],
        max: 8, count: [4, 6], r: 0.3, thick: 1, arc: 360, from: 0, rand: 0.3, noise: 0.2, drag: 4, angv: [-40, 40], sizeCurve: [[0, 0.5], [1, 1.6]],
        alpha: [[0, 0], [0.1, 0.3], [1, 0]], blend: 'alpha', mat: M('d', 'sis'), order: 1 });
      return e;
    });
    const ring = (name, z, d, s) => {
      const e = arc(name, M('d', 'halka'), { order: 9, dt: d - t0, life: 0.35, color: s,
        mesh: { shape: 'arc', file: '', innerRadius: 0.1, outerRadius: 0.75, angle: 360, height: 0.5, segments: 96, rings: 8 } });
      e.position = [AXX, AXY, z]; e.rotation = [0, 0, 0];
      e.customData.x = [[0, 1], [1, 1]];
      e.sizeOverLifetime = { enabled: true, curve: [[0, 0.4], [0.35, 1.05], [1, 1.55]] };
      return e;
    };
    // uçtan çıkıp koninin kavisini izleyerek geriye akan ince çizgi parçacıklar (uç kahramanla hareket eder: z(t) sönüm modelinden)
    const TAU = 1 / (60 * -Math.log(1 - DAMP)), TIP0 = -0.15 + 3.6;
    const tipAt = (t) => +(TIP0 + V0 * TAU * (1 - Math.exp(-(t - T0) / TAU))).toFixed(3);
    // çizgiler: uçtan çıkar, önce hızla dışa geniş yay çizer (dışa hız sürtünmeyle söner), sonra geriye kıvrılır (sabit geri akış).
    // Her çizgi sabit yönlü kısa bir akış: ardışık parçacıklar aynı kıvrık yolu izler → kesintisiz çizgi okunur.
    const streaks = [];
    // rastgele uçuşan çizgiler: düzensiz açı, erişim, geri uzunluk, kalınlık, ömür, doğuş anı; eksene yatık, çıkış noktası uçtan sapmış
    let sd = 41; const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let k = 0; k < 20; k++) {
      const main = k % 3 === 0;                                           // hiyerarşi: az sayıda parlak ana çizgi, aralarında soluk ince ikincil çizgiler
      const deg = +(k * 18.3 + rr() * 16).toFixed(1), reach = +(0.22 + rr() * 0.5).toFixed(2), backL = +(2.6 + rr() * 2.6).toFixed(2);   // dar açılır, uzun geriye gider
      const t = +(0.455 + rr() * 0.07).toFixed(3), life = +(0.28 + rr() * 0.22).toFixed(3);
      const jit = [(rr() - 0.5) * 0.25, (rr() - 0.5) * 0.25, (rr() - 0.5) * 0.4];
      const e = arc('cizgi' + k, M('d', main ? 'cizgi' : 'cizgi_ince'), { order: 7, dt: t - t0, life, color: ['#ffffff', '#f4f9ff', '#eef6ff', '#f8fbff'][k % 4],
        mesh: { shape: 'kivrim', file: '', innerRadius: +(main ? 0.16 + rr() * 0.06 : 0.1 + rr() * 0.06).toFixed(3), outerRadius: reach, angle: 360, height: backL, segments: 72, rings: 4 } });
      e.position = [AXX + jit[0], AXY + jit[1], +(tipAt(t) + jit[2]).toFixed(3)].map((x) => +x.toFixed(3));
      e.rotation = [+((rr() - 0.5) * 50).toFixed(1), +((rr() - 0.5) * 50).toFixed(1), deg];
      e.customData.x = [[0, 0], [+(0.3 + rr() * 0.25).toFixed(2), 1], [1, 1]];
      e.customData.y = [[0, +(0.3 + rr() * 0.5).toFixed(2)], [0.3, 0.15], [1, 0]];
      e.customData.z = [[0, 0], [1, 0]];
      e.sizeOverLifetime = { enabled: true, curve: [[0, 0.85 + rr() * 0.2], [1, 1.05 + rr() * 0.15]] };
      streaks.push(e);
    }
    const tipZ = 4.6;
    return {
      name: 'agir_' + key + '_delme', duration: 1.4, loop: true, preview: prev,
      emitters: [
        emitAt('toplanma', [0.12, 1.26, 1.34], [0, 0, 0], { delay: 0.3, life: [0.1, 0.13], speed: [0.2, 0.4], size: [0.03, 0.05], color: ['#eef6ff', '#a8d0ff'],
          max: 24, count: [16, 20], r: 0.5, thick: 0.4, arc: 360, from: 0, rand: 0.1, sizeCurve: [[0, 1], [1, 0.3]], mat: 'zerre_hafif', order: 8 }),
        cone('bukulme', M('d', 'bukulme'), { Rb: 1.0, L: 3.6, back: -0.15, life: 0.5, order: 0, blend: 'distortion',
          extra: { renderer: { distortion: { mode: 'noise', strength: 0.045, frequency: 7, scroll: [0, -4] } } } }),
        cone('kabuk', M('d', 'kabuk'), { Rb: 0.95, L: 3.6, back: -0.15, life: 0.5, order: 3, tw: 70 }),
        cone('sarmal', M('d', 'sarmal'), { Rb: 0.72, L: 3.3, back: 0.1, life: 0.48, order: 4, tw: -150 }),
        cone('cekirdek', M('d', 'cekirdek'), { Rb: 0.3, L: 2.9, back: 0.5, life: 0.42, order: 5, tw: 220, extra: light(0.5, 2.5) }),
        ...trail, ...streaks, ...dust,
        ring('halka1', tipZ - 0.15, 0.52, '#ffffff'), ring('halka2', tipZ + 0.25, 0.56, '#f0f6ff'),
        emitAt('uc_zerre', [AXX, AXY, tipZ], [0, 0, 0], { delay: 0.52, life: [0.3, 0.6], speed: [2, 6], size: [0.03, 0.06], color: ['#eef6ff', '#8fbaff'], gravity: 0.3,
          max: 50, count: [34, 44], r: 0.15, thick: 1, arc: 360, from: 0, rand: 1, drag: 8, mat: 'zerre_hafif', order: 8 }),
        emitAt('uc_cakma', [AXX, AXY, tipZ], [0, 0, 0], { delay: 0.51, life: [0.16, 0.16], speed: [0, 0], size: [0.3, 0.3], color: ['#d8eaff', '#d8eaff'], max: 2, count: [1, 1],
          r: 0, arc: 1, from: 0, sizeCurve: [[0, 0.3], [0.2, 1], [1, 1.1]], mat: 'zerre_hafif_isik', order: 9 }),
      ],
    };
  }
  if (variant === 'delis') {
    // H3 "delme": kahraman katanayla birlikte öne delip geçer. Ok karakterden çıkar: eksen göğüs hizasında atılış yönünde (+Z,
    // kalça z 1.5 → 2.8, 0.43–0.55 sn; UPE'de kemik dünya konumundan ölçüldü), uç göğsün ~1.6 m önünde ve kahramanla birlikte
    // uzanır; gövde atılış yolunu ve kahramanı sarar. İç içe üç ok (dış geniş-soluk, ana, iç parlak-dar), eksen çevresinde kanatlı.
    const rot = [0, -90, 0];                                   // yerel +X → dünya +Z
    const AXX = 0.1, AXY = 1.0, TIPZ = 4.4;
    const tip = [AXX, AXY, TIPZ];
    const lead = [[0.42, 3.15], [0.46, 3.43], [0.5, 4.12], [0.55, 4.29], [0.58, 4.4]];   // [t, uç z] = kalça z + 1.6
    const ok = (name, mat, { L, W, n, roll = 0, delay, life, order, extra = {} }) => {
      const e = arc(name, mat, { order, dt: delay - t0, life, mesh: { shape: 'ok', file: '', innerRadius: W, outerRadius: L, angle: 360, height: n, segments: 72, rings: 24 }, extra });
      e.renderer.mesh.rotation = [roll, 0, 0];
      e.position = tip; e.rotation = rot;
      const x = [[0, +Math.max(0, 1 + (lead[0][1] - TIPZ) / L).toFixed(4)]];
      for (const [t, z] of lead) { const f = (t - delay) / life; if (f > x[x.length - 1][0] + 1e-3 && f < 1) x.push([+f.toFixed(4), +Math.min(1, 1 + (z - TIPZ) / L).toFixed(4)]); }
      x.push([1, 1]);
      e.customData.x = x;
      e.customData.y = [[0, 0], [0.35, 0], [0.9, 1], [1, 1]];
      e.sizeOverLifetime = { enabled: true, curve: [[0, 0.96], [0.3, 1], [1, 1.03]] };
      e.colorOverLifetime = { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [1, 0]] };
      return e;
    };
    const flow = { enabled: true, linear: [0, 0, -5], orbital: [0, 0, 0], radial: 0, space: 'world', speedModifier: 1 };
    const zer = emitAt('akinti', [AXX, AXY, 2.6], [0, -90, 0], { delay: 0.45, life: [0.25, 0.5], speed: [0.2, 0.8], size: [0.03, 0.06], color: ['#eef6ff', '#8fbaff'],
      max: 60, count: [40, 50], r: 0.7, thick: 1, arc: 360, from: 0, rand: 0.8, drag: 1, mat: 'zerre_hafif', order: 8 });
    zer.velocity = flow;
    return {
      name: 'agir_' + key + '_delis', duration: 1.4, loop: true, preview: prev,
      emitters: [
        ok('ok_dis', M('o', 'dis'), { L: 5.4, W: 1.4, n: 3, roll: 0, delay: 0.42, life: 0.75, order: 3 }),
        ok('ok_ana', M('o', 'ana'), { L: 4.6, W: 0.95, n: 3, roll: 30, delay: 0.42, life: 0.7, order: 4, extra: light(1.0, 3) }),
        ok('ok_ic', M('o', 'ic'), { L: 3.6, W: 0.42, n: 2, roll: 45, delay: 0.42, life: 0.6, order: 5 }),
        emitAt('uc', tip, [0, 0, 0], { delay: 0.55, life: [0.18, 0.18], speed: [0, 0], size: [0.6, 0.6], color: ['#d8eaff', '#d8eaff'], max: 2, count: [1, 1],
          r: 0, arc: 1, from: 0, sizeCurve: [[0, 0.3], [0.2, 1], [1, 1.1]], mat: 'zerre_hafif_isik', order: 9 }),
        zer,
      ],
    };
  }
  if (variant === 'gecikme') {
    // H3 "atılarak geçiş kesiği": atılışla birlikte kılıç ucunun havada bıraktığı ince kesik hattı bıçağın arkasından açılır,
    // kahraman bitiş duruşunda beklerken asıl patlama gecikmeli gelir: hat beyazlaşıp kalınlaşır, yol boyunca sırayla
    // kısa çapraz kesikler çakar, zerre ve sis saçılır, hava bükülür. H1'in yarığı ve H2'nin uçan hilalinden ayrı.
    const D2R = Math.PI / 180;
    const tB = 0.64, L = 0.8, b = +((tB - t0) / L).toFixed(4);
    const band = { shape: 'arc', file: '', innerRadius: +(R - 0.25).toFixed(4), outerRadius: +(R + 0.25).toFixed(4), angle: A, height: 0.5, segments: 128, rings: 8 };
    const main = arc('kesik', M('g', 'kesik'), { order: 6, life: L, mesh: band,
      cy: () => [[0, 0], [b - 0.01, 0], [b, 1], [+(b + 0.08).toFixed(4), 0.35], [0.7, 0.1], [1, 0]] });
    main.customData.z = [[0, 0], [b - 0.01, 0], [+(b + 0.02).toFixed(4), 1], [+(b + 0.25).toFixed(4), 0.5], [1, 0.2]];
    const buk = arc('bukulme', M('g', 'bukulme'), { blend: 'distortion', order: 0, dt: tB - t0, life: 0.35, mesh: band,
      extra: { renderer: { distortion: { mode: 'noise', strength: 0.05, frequency: 8, scroll: [0, 3] } } } });
    buk.customData.x = [[0, 1], [1, 1]];
    // Unity Euler (R = Ry·Rx·Rz) → yerel X sütunu
    const colX = ([x, y, z]) => { const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * D2R), Math.sin(x * D2R), Math.cos(y * D2R), Math.sin(y * D2R), Math.cos(z * D2R), Math.sin(z * D2R)];
      return [cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz]; };
    let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const cuts = [], fr = [0.12, 0.27, 0.45, 0.56, 0.74, 0.88];
    fr.forEach((f, k) => {
      // ana kesikle aynı düzlemde, yolu ±(40–65)° çaprazlayan kısa yaylar (rastgele 3B açıda kenardan görünüp leke oluyordu)
      const th = f * A, phi = (k % 2 ? -1 : 1) * (35 + rnd() * 35), beta = th + phi, r2 = 0.4 + rnd() * 0.35, span = 50 + rnd() * 35;
      const p = arcPoint(th), br = beta * D2R;
      const dir = [0, 1, 2].map((i) => Math.cos(br) * AX.X[i] + Math.sin(br) * AX.Y[i]);
      const pos = p.map((c, i) => +(c - r2 * dir[i]).toFixed(4));
      const e = arc('capraz' + k, M('g', 'kesik2'), { order: 7, dt: tB - t0 + k * 0.018, life: 0.4, rotZ: +(beta - span / 2).toFixed(2),
        mesh: { shape: 'arc', file: '', innerRadius: +(r2 - 0.3).toFixed(3), outerRadius: +(r2 + 0.3).toFixed(3), angle: +span.toFixed(1), height: 0.5, segments: 48, rings: 6 },
        color: ['#ffffff', '#f2f8ff', '#e8f2ff', '#ffffff', '#eef6ff', '#f6faff'][k],
        cy: () => [[0, 1], [0.3, 0.3], [1, 0]] });
      e.position = pos;
      e.customData.x = [[0, 0], [0.12, 1], [1, 1]];
      e.customData.z = [[0, 0.6], [0.4, 0.3], [1, 0.1]];
      cuts.push(e);
    });
    const mid = arcPoint(A * 0.5);
    return {
      name: `agir_${key}_gecikme`, duration: 1.4, loop: true, preview: prev,
      emitters: [
        main, buk, ...cuts,
        emitAt('cakma', mid, [0, 0, 0], { delay: tB, life: [0.22, 0.22], speed: [0, 0], size: [0.55, 0.55], color: ['#d8eaff', '#d8eaff'], max: 2, count: [1, 1],
          r: 0, arc: 1, from: 0, sizeCurve: [[0, 0.3], [0.2, 1], [1, 1.1]], mat: 'zerre_hafif_isik', order: 9 }),
        onArc('zerre', { delay: tB, life: [0.3, 0.7], speed: [1.5, 4.5], size: [0.03, 0.065], color: ['#eef6ff', '#8fbaff'], gravity: 0.4,
          max: 70, count: [45, 60], r: R, thick: 0, arc: A, from: 0, rand: 1, drag: 3, mat: 'zerre_hafif', order: 8 }),
        onArc('sis', { delay: tB + 0.04, life: [0.6, 1.0], speed: [0.2, 0.6], size: [0.4, 0.8], srot: [0, 360], color: ['#ffffff', '#e8f0ff'], max: 14, count: [9, 12],
          r: R, thick: 0, arc: A, from: 0, rand: 0.7, noise: 0.25, angv: [-40, 40], sizeCurve: [[0, 0.6], [1, 1.5]], blend: 'alpha', mat: M('g', 'sis'), order: 1 }),
      ],
    };
  }
  if (variant === 'yarik') {
    // savunma kırma: havada açılan yarık; isabette tam açılır, kenarlarından kavisli çatlaklar yayılır, kırık parçalar kopar, sonra kapanır
    const open = (delay, life) => { const h = life01(delay, life, tHit); return [[0, 0], [Math.max(0.01, h - 0.12), 0.25], [h, 1], [Math.min(0.95, h + 0.3), 0.85], [Math.min(0.97, h + 0.55), 0], [1, 0]]; };
    const rr = F.inner * R + 0.9 * (R * 1.06 - F.inner * R); // yarık merkezinin yarıçapı (_Center 0.9)
    return {
      name: `agir_${key}_yarik`, duration: 1.6, loop: true, preview: prev,
      emitters: [
        arc('bukulme', M('y', 'bukulme'), { blend: 'distortion', order: 0, life: 0.7, extra: { renderer: { distortion: { mode: 'noise', strength: 0.035, frequency: 8, scroll: [0, 2] } } } }),
        arc('iz', M('y', 'iz'), { order: 3, life: 0.3, extra: light(1.6) }),
        // yarığın içi açık mavi sisle dolu (boş kalınca arka plan siyah şerit gibi okunuyordu; koyu/siyah Karanlık elementinin dili)
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
        onArc('sis', { delay: tHit + 0.15, life: [0.5, 0.9], speed: [0.2, 0.5], size: [0.35, 0.7], srot: [0, 360], color: ['#ffffff', '#e8f0ff'], max: 14, count: [8, 10],
          r: rr, thick: 0.1, arc: +(A * 0.6).toFixed(1), from: +(A * 0.3).toFixed(1), rand: 0.7, noise: 0.25, angv: [-40, 40], sizeCurve: [[0, 0.6], [1, 1.4]],
          blend: 'alpha', mat: M('y', 'sis'), order: 1 }),
      ],
    };
  }
  if (variant === 'capraz') {
    // H2 "önü tarayan çift kesik": ana kesik yarık dilinde (H1 ile aynı aile, siyah yok); bir an sonra karakterin önünde ona aynalı
    // ikinci (bıçaksız, enerji) kesik geçer → önde X. Kesişme noktasında çakma + halka + kıymık patlaması.
    const D2R = Math.PI / 180;
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const toEuler = (X, Y, Z) => { // R = Ry·Rx·Rz, sütunlar = yerel X, Y, Z (Unity Euler)
      const x = Math.asin(Math.max(-1, Math.min(1, -Z[1]))) / D2R, y = Math.atan2(Z[0], Z[2]) / D2R, z = Math.atan2(X[1], Y[1]) / D2R;
      return [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)];
    };
    const mir = (v) => [-v[0], v[1], v[2]];
    const MX = mir(AX.X), MY = mir(AX.Y), MZ = cross(MX, MY);
    const mCenter = mir(F.center).map((c) => +c.toFixed(4)), mRot = toEuler(MX, MY, MZ);
    // kesişme: ana yayda dünya x'i 0'a en yakın, en önde nokta
    let best = null;
    for (let d = 0; d <= A; d += 0.5) { const p = arcPoint(d); const sc = Math.abs(p[0]) - p[2] * 0.02; if (!best || sc < best.sc) best = { d, p, sc }; }
    const xAng = +best.d.toFixed(1), xFrac = xAng / A, tX = timeAt(F, xFrac);
    const lag = 0.09; // ikinci kesik gecikmesi (sn)
    const open = (delay, life) => { const h = life01(delay, life, tX); return [[0, 0], [Math.max(0.01, h - 0.12), 0.25], [h, 1], [Math.min(0.9, h + 0.22), 0.8], [Math.min(0.95, h + 0.4), 0], [1, 0]]; };
    const rr = F.inner * R + 0.9 * (R * 1.06 - F.inner * R);
    const mirrorArc = (e) => { e.position = mCenter; e.rotation = mRot; e.main = { ...e.main, startDelay: +(e.main.startDelay + lag).toFixed(4) }; e.name += '_2'; return e; };
    const pair = (mk) => [mk(), mirrorArc(mk())];
    return {
      name: `agir_${key}_capraz`, duration: 1.8, loop: true, preview: prev,
      emitters: [
        ...pair(() => arc('bukulme', M('c', 'bukulme'), { blend: 'distortion', order: 0, life: 0.7, extra: { renderer: { distortion: { mode: 'noise', strength: 0.035, frequency: 8, scroll: [0, 2] } } } })),
        ...pair(() => arc('iz', M('c', 'iz'), { order: 3, life: 0.3 })),
        ...pair(() => arc('yarik_ic', M('c', 'ic'), { blend: 'alpha', order: 5, life: 0.7, cy: open })),
        ...pair(() => arc('yarik_kenar', M('c', 'kenar'), { order: 6, life: 0.7, cy: open })),
        // kesişme (X) patlaması: ikinci kesik geçerken
        onArc('cakma', { delay: tX + lag, life: [0.16, 0.16], speed: [0, 0], size: [0.9, 0.9], color: ['#cfe4ff', '#cfe4ff'], max: 2, count: [1, 1], r: rr,
          arc: 1, from: xAng, sizeCurve: [[0, 0.3], [0.2, 1], [1, 1.1]], mat: 'zerre_hafif_isik', order: 9 }),
        onArc('halka', { delay: tX + lag + 0.01, life: [0.3, 0.3], speed: [0, 0], size: [2.2, 2.2], color: ['#ffffff', '#ffffff'], max: 2, count: [1, 1], r: rr,
          arc: 1, from: xAng, sizeCurve: [[0, 0.15], [0.35, 0.75], [1, 1]], mat: M('c', 'halka'), order: 8 }),
        onArc('kirik', { delay: tX + lag + 0.01, life: [0.45, 0.85], speed: [1.5, 4.5], size: [0.12, 0.26], srot: [0, 360], color: ['#ffffff', '#cfdcf0'], gravity: 0.7,
          max: 24, count: [14, 18], r: rr, thick: 0.05, arc: 30, from: +(xAng - 15).toFixed(1), rand: 0.8, drag: 3, angv: [-300, 300],
          alpha: [[0, 1], [0.7, 0.9], [1, 0]], sizeCurve: [[0, 1], [1, 0.7]], blend: 'alpha', mat: M('c', 'kirik'), order: 7 }),
        ...pair(() => onArc('zerre', { delay: tX, life: [0.3, 0.6], speed: [0.2, 0.8], size: [0.045, 0.09], srot: [0, 45], color: ['#dcecff', '#8fb8ff'], gravity: -0.05,
          max: 40, count: [22, 30], r: rr, thick: 0.15, arc: +(A * 0.7).toFixed(1), from: +(A * 0.2).toFixed(1), rand: 0.6, drag: 2,
          alpha: [[0, 0], [0.08, 1], [0.35, 0.5], [0.45, 1], [1, 0]], mat: 'zerre_hafif', order: 6 })),
        onArc('sis', { delay: tX + lag + 0.12, life: [0.5, 0.9], speed: [0.2, 0.5], size: [0.4, 0.8], srot: [0, 360], color: ['#ffffff', '#e8f0ff'], max: 14, count: [8, 10],
          r: rr, thick: 0.1, arc: 60, from: +(xAng - 30).toFixed(1), rand: 0.7, noise: 0.25, angv: [-40, 40], sizeCurve: [[0, 0.6], [1, 1.4]],
          blend: 'alpha', mat: M('c', 'sis'), order: 1 }),
      ].map((e) => (e.name.endsWith('_2') ? e : e)),
      _debug: { xAng, tX: +tX.toFixed(4), mCenter, mRot },
    };
  }
  if (variant === 'hilal') {
    // H2 "öne giden hilal": kesiş biter bitmez sıkışmış havadan bir rüzgâr hilali öne (+Z) fırlar. Hilal gidiş yönüne yatıktır:
    // bombesi önde, savruluşun çaprazına göre eğik (bumerang gibi); alçak ucu yere değerek kayar, zeminde çizik/toz/kırıntı bırakır.
    // Hafif saldırı kesiğinin dili (dolu mavi gövde + beyaz kenar) kullanılmaz; H1'in yarık dilinden de ayrı.
    const D2R = Math.PI / 180;
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const toEuler = (X, Y, Z) => { const x = Math.asin(Math.max(-1, Math.min(1, -Z[1]))) / D2R, y = Math.atan2(Z[0], Z[2]) / D2R, z = Math.atan2(X[1], Y[1]) / D2R; return [+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)]; };
    const spd = 9, fly = 0.55, HR = 1.5, span = 140, from = 90 - span / 2;   // yay yerelde +Y'ye (ileri) bombeli
    // savruluşun arkadan görünen kirişi (uç yolunun XY izdüşümü, baştan sona)
    const proj = (a) => { const r = a * D2R; return [Math.cos(r) * AX.X[0] + Math.sin(r) * AX.Y[0], Math.cos(r) * AX.X[1] + Math.sin(r) * AX.Y[1]]; };
    const pS = proj(0), pE = proj(A); let cx = pE[0] - pS[0], cy = pE[1] - pS[1]; const cl = Math.hypot(cx, cy) || 1; cx /= cl; cy /= cl;
    if (cy > 0) { cx = -cx; cy = -cy; }                                          // yerel X aşağı uca baksın (o uç yere değer)
    // bombe tam önde (+Z): hilalin simetri ekseni gidiş yönü (kullanıcı: yana yatık olmasın; lean 35° denendi, "hafif yan" bulundu)
    const lean = 0 * D2R; let ux = -cy, uy = cx; if (uy < 0) { ux = -ux; uy = -uy; }
    const LX = [cx, cy, 0], LY = [Math.sin(lean) * ux, Math.sin(lean) * uy, Math.cos(lean)], LZ = cross(LX, LY), rot = toEuler(LX, LY, LZ);
    const at3 = (C, a) => { const r = a * D2R; return C.map((c, i) => c + HR * (Math.cos(r) * LX[i] + Math.sin(r) * LY[i])); };
    const samples = Array.from({ length: 71 }, (_, k) => from + span * k / 70);
    const low = samples.reduce((m, a) => (at3([0, 0, 0], a)[1] < at3([0, 0, 0], m)[1] ? a : m));
    const C = [0.12, +(0.03 - at3([0, 0, 0], low)[1]).toFixed(3), 1.6];           // en alçak nokta yerden 3 cm
    const contact = at3(C, low).map((c, i) => +(i === 1 ? 0.03 : c).toFixed(3));
    const t1 = +(tEnd - 0.005).toFixed(4);
    // hacimli 3B hilal: ön kenar HR, ortada ~0,85 m genişlik, gidiş yönüne dik en fazla 0,5 m kalınlık (düz yüzey değil)
    const moonMesh = { shape: 'hilal', file: '', innerRadius: +(HR - 0.85).toFixed(4), outerRadius: +HR.toFixed(4), angle: span, height: 0.5, segments: 96, rings: 14 };
    const full = { enabled: true, x: [[0, 1], [1, 1]], y: [[0, 0], [1, 0]], z: [[0, 0], [1, 0]], w: [[0, 0], [1, 0]] };
    const fwd = (sp) => ({ enabled: true, linear: [0, 0, sp], orbital: [0, 0, 0], radial: 0, space: 'world', speedModifier: 1 });
    const moon = (name, mat, blend, order, extra = {}) => {
      const e = arc(name, mat, { blend, order, dt: t1 - t0, life: fly, mesh: moonMesh, rotZ: from, extra });
      e.position = C; e.rotation = rot; e.customData = full; e.velocity = fwd(spd);
      e.sizeOverLifetime = { enabled: true, curve: [[0, 0.9], [0.2, 1.0], [1, 1.04]] };
      return e;
    };
    const dist = (st) => ({ renderer: { distortion: { mode: 'noise', strength: st, frequency: 7, scroll: [0, 3] } } });
    // hilal kabuğu: silindir dilimi, ekseni hilal normali; açı hilalin başlangıç açısından (from) başlar
    const KH = 0.8, fr = from * D2R;
    const kabukRot = toEuler([Math.cos(fr), Math.sin(fr), 0], [0, 0, -1], [-Math.sin(fr), Math.cos(fr), 0]);
    const hilalKabuk = moon('hilal_kabuk', M('h', 'kabuk'), 'additive', 4);
    hilalKabuk.renderer.mesh = { shape: 'cylinder', file: '', innerRadius: +(HR * 0.985).toFixed(4), outerRadius: +(HR * 0.985).toFixed(4), angle: span, height: KH, segments: 128, rings: 6, rotation: kabukRot };
    hilalKabuk.position = C.map((c, k) => +(c + LZ[k] * KH / 2).toFixed(4));
    // hacim: aynı hilal, ileri eksen (LY) etrafında ±18° döndürülmüş iki ince kopya (arkadan bakınca da dolgun)
    const tilted = (deg) => { const r = deg * D2R; const X2 = LX.map((x, k) => x * Math.cos(r) + LZ[k] * Math.sin(r)); return toEuler(X2, LY, cross(X2, LY)); };
    const moonT = (name, mat, deg) => { const e = moon(name, mat, 'additive', 3); e.rotation = tilted(deg); return e; };
    // rüzgâr izi: hilal her adımda bulunduğu yerde, hilal boyunca geride kalan hafif tutamlar bırakır
    const wake = [];
    for (let k = 1; k * 0.45 < spd * fly * 0.85; k++) {
      const dz = k * 0.45, pos = [C[0], C[1], +(C[2] + dz).toFixed(3)];
      const e = emitAt(`iz${k}`, pos, rot, { delay: +(t1 + dz / spd).toFixed(4), life: [0.25, 0.55], speed: [0.2, 1.0], size: [0.05, 0.11], srot: [0, 45], color: ['#ffffff', '#9fd0ff'],
        max: 12, count: [6, 9], r: +(HR * 0.72).toFixed(3), thick: 0.35, arc: span, from, rand: 0.6, noise: 0.35, gravity: -0.05,
        alpha: [[0, 0], [0.1, 1], [0.5, 0.7], [1, 0]], mat: 'zerre_hafif', order: 6 });
      wake.push(e);
    }
    // zemindeki iz (hilalin alçak ucu geçtikçe)
    const steps = [], stepLen = 0.42, travel = spd * fly * 0.9;
    for (let k = 0; k * stepLen < travel; k++) {
      const z = +(contact[2] + k * stepLen).toFixed(3), d = +(t1 + (k * stepLen) / spd).toFixed(4);
      const wob = 0.07 * Math.sin(k * 1.7) + 0.04 * Math.sin(k * 3.1 + 1.3);
      const pos = [+(contact[0] + wob).toFixed(3), 0.015, z];
      const cz = emitAt(`cizik${k}`, pos, [0, 0, 0], { delay: d, life: [0.9, 1.1], speed: [0, 0], size: [0.62, 0.78], srot: [-14, 14], color: ['#ffffff', '#f4f8ff'], max: 2, count: [1, 1],
        arc: 1, from: 0, mat: M('h', 'cizik'), order: 2 });
      cz.shape = { enabled: false }; cz.renderer.mode = 'horizontal'; steps.push(cz);
      if (k % 2 === 0) steps.push(emitAt(`toz${k}`, pos, [0, 0, 0], { delay: d, life: [0.5, 0.9], speed: [0.4, 1.2], size: [0.3, 0.6], srot: [0, 360], color: ['#ffffff', '#eef3ff'],
        max: 6, count: [2, 3], r: 0.1, thick: 1, arc: 360, from: 0, rand: 0.6, noise: 0.25, angv: [-40, 40], gravity: -0.05, sizeCurve: [[0, 0.5], [1, 1.5]],
        blend: 'alpha', mat: M('h', 'sis'), order: 1 }));
      steps.push(emitAt(`kirinti${k}`, pos, [0, 0, 0], { delay: d, life: [0.25, 0.5], speed: [1.0, 2.6], size: [0.03, 0.06], color: ['#eef6ff', '#9cc4ff'], gravity: 1.2,
        max: 8, count: [3, 5], r: 0.06, thick: 1, arc: 360, from: 0, rand: 0.9, drag: 2, mat: 'zerre_hafif', order: 6 }));
    }
    for (const e of steps) if (e.name.startsWith('toz') || e.name.startsWith('kirinti')) e.shape = { ...e.shape, rotation: [-90, 0, 0] };
    const contactGlow = emitAt('temas', contact, [0, 0, 0], { delay: t1, life: [fly * 0.9, fly * 0.9], speed: [0, 0], size: [0.5, 0.5], color: ['#dcecff', '#dcecff'], max: 2, count: [1, 1],
      arc: 1, from: 0, alpha: [[0, 1], [0.7, 0.8], [1, 0]], mat: 'zerre_hafif_isik', order: 9 });
    contactGlow.shape = { enabled: false }; contactGlow.velocity = fwd(spd);
    // çıkış: hilal doğarken hava patlaması (sis tutamları + zerre)
    const out = at3(C, 90).map((c) => +c.toFixed(3));
    return {
      name: `agir_${key}_hilal`, duration: 1.8, loop: true, preview: prev,
      emitters: [
        emitAt('cikis_sis', out, [0, 0, 0], { delay: t1, life: [0.35, 0.6], speed: [0.6, 1.6], size: [0.35, 0.7], srot: [0, 360], color: ['#ffffff', '#eef3ff'], max: 10, count: [5, 7],
          r: 0.3, thick: 1, arc: 360, from: 0, rand: 0.8, noise: 0.3, angv: [-60, 60], sizeCurve: [[0, 0.5], [1, 1.5]], blend: 'alpha', mat: M('h', 'sis'), order: 1 }),
        moon('hilal_buk', M('h', 'bukulme'), 'distortion', 0, dist(0.06)),
        // dolu enerji hilali + ön kenarı saran dik bant (arkadan bakınca da kalın okunsun; yatık katman yelpazesi düz çizgi gibi açıldı)
        moon('hilal', M('h', 'enerji'), 'additive', 5, light(0.7, 2.2)),
        ...wake,
        contactGlow,
        ...steps,
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
