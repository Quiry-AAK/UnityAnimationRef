// VFX efekt şeması — editör (tarayıcı), MCP (Node) ve Unity dönüştürücüsü bu dosyadaki sözleşmeyi paylaşır.
// Her emitter Unity ParticleSystem'in modüllerine birebir karşılık gelir; değerler Unity koordinatlarında
// (sol-el, +X sağ, +Y yukarı, +Z ileri), metre / saniye / derece. DOM ya da three.js bağımlılığı yok.

export const VFX_FORMAT = 'upe-vfx-1';

// vfx/textures/<ad>.png — hepsi beyaz + alfa maskesi (renk parçacık renginden gelir)
export const TEXTURES = {
  soft: 'Yumuşak yuvarlak (genel amaçlı)',
  glow: 'Geniş, çok yumuşak hale (ışıma)',
  hard: 'Keskin kenarlı disk',
  spark: 'İnce parlak çekirdek (stretched ile kıvılcım çizgisi)',
  ember: 'Küçük sıcak çekirdek + hale (kor)',
  smoke: 'Kabarık gürültülü bulut (duman/toz)',
  ring: 'Halka (şok dalgası)',
  star: '4 kollu parıltı',
  flare: 'Hale + ince ışık çizgileri',
  slash: 'Hilal yay (kılıç izi)',
  flame: 'Damla biçimli alev dili (yukarı doğru)',
};

const v3 = (x = 0, y = 0, z = 0) => [x, y, z];

export function defaultEmitter() {
  return {
    name: 'emitter',
    enabled: true,
    position: v3(), // efekt köküne göre (m)
    rotation: v3(), // derece, Unity Euler (Z→X→Y)
    main: {
      duration: 2, looping: true, prewarm: false, startDelay: 0,
      startLifetime: [1, 1.5], startSpeed: [1, 2], startSize: [0.1, 0.2], startRotation: [0, 0],
      startColor: ['#ffffff', '#ffffff'], gravity: 0, simulationSpace: 'local', maxParticles: 500,
    },
    emission: { rateOverTime: 20, bursts: [] }, // burst: { time, count:[min,max], cycles, interval }
    shape: {
      enabled: true, type: 'cone', radius: 0.1, radiusThickness: 1, angle: 15, arc: 360,
      boxSize: v3(1, 1, 1), donutRadius: 0.1, position: v3(), rotation: v3(-90, 0, 0), randomDirection: 0,
    },
    velocity: { enabled: false, linear: v3(), orbital: v3(), radial: 0, space: 'local', speedModifier: 1 },
    force: { enabled: false, force: v3(), space: 'world' },
    limitVelocity: { enabled: false, limit: 1, dampen: 0, drag: 0 },
    noise: { enabled: false, strength: 0.5, frequency: 0.5, scrollSpeed: 0, octaves: 1 },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 0], [0.15, 1], [1, 0]] },
    sizeOverLifetime: { enabled: false, curve: [[0, 1], [1, 1]] },
    rotationOverLifetime: { enabled: false, angularVelocity: [0, 0] },
    textureSheet: { enabled: false, tilesX: 1, tilesY: 1, cycles: 1, randomStart: false },
    // kılıç izi (şerit): parçacık yerine emitter'a bağlı iki noktanın (kök → uç) taradığı yüzey; Unity'de çalışma zamanı bileşeni
    bladeTrail: { enabled: false, from: v3(0, 0, 0), to: v3(0, 0, 1), lifetime: 0.25, subdiv: 4, width: [[0, 1], [1, 1]], taper: 'tip', uvMode: 'stretch', tileLength: 1 },
    // ömür boyu özel veri (Unity Custom Data / Niagara Dynamic Material Parameter): UPE-SL materyalinde i.custom (x,y,z,w)
    customData: { enabled: false, x: [[0, 0], [1, 1]], y: [[0, 0], [1, 0]], z: [[0, 0], [1, 0]], w: [[0, 0], [1, 0]] },
    // ışık: single = emitter konumunda tek nokta ışığı (eğri: emitter döngüsü), perParticle = parçacık başına (eğri: parçacık ömrü)
    light: { enabled: false, mode: 'single', color: '#ffb060', useParticleColor: false, intensity: 4, radius: 3, curve: [[0, 1], [1, 1]], maxLights: 4, shadows: false },
    // alt emitter'lar: bu emitter'ın parçacığı doğunca/ölünce hedef emitter o noktada count parçacık doğurur (hedefin kendi yayımı kapanır)
    subEmitters: { enabled: false, items: [] }, // item: { emitter, trigger: 'death'|'birth', count:[min,max], inheritColor, inheritSize, inheritVelocity }
    renderer: { mode: 'billboard', alignment: 'view', material: '', texture: 'soft', blend: 'additive', intensity: 1, lengthScale: 2, velocityScale: 0, sortingOrder: 0,
      mesh: { shape: 'arc', file: '', innerRadius: 0.4, outerRadius: 1, angle: 180, height: 0.5, segments: 64, rings: 4, rotation: v3() },
      distortion: { mode: 'radial', strength: 0.03, frequency: 4, scroll: [0, 0.5] },
      // yumuşak parçacık: sahne yüzeyine distance (m) kala alfa sönümlenir (Unity Soft Particles / UE DepthFade)
      softParticles: { enabled: false, distance: 0.3 },
      // yere iz: parçacık başına kutu, sahne yüzeyine yansıtılır (Niagara Decal renderer). size = [en, boy, derinlik] m × parçacık boyutu
      decal: { size: [1, 1, 0.5], projection: 'down', groundOnly: true } },
  };
}

export function defaultEffect() {
  return {
    format: VFX_FORMAT,
    name: 'vfx',
    duration: 2, // önizleme döngüsü (sn); Unity'de kök ParticleSystem'in süresi
    loop: true, // önizlemede tekrar oynat
    attach: { target: 'none', name: '', position: v3(), rotation: v3() }, // target: none | bone | prop
    preview: { withAnimation: false, startFrame: 0, background: '#0d1018', bloom: 0.8, showHero: true, showGrid: true, showGround: false },
    emitters: [{ ...defaultEmitter(), name: 'emitter' }],
  };
}

// ── UI + doğrulama için alan tanımları: [anahtar, tip, etiket, seçenekler]
// tipler: num, int, range ([min,max]), vec2, vec3, bool, enum, color, color2, gradient, curve, bursts, texture, material, meshfile,
// group (alt nesne: o.fields), subList (alt emitter listesi). o.when: { alan: [değerler] } → UI yalnız o durumda gösterir
const SPACE = [['local', 'Yerel'], ['world', 'Dünya']];
export const MODULES = [
  { key: 'main', label: 'Ana', always: true, fields: [
    ['duration', 'num', 'Süre (sn)', { min: 0.05, max: 30, step: 0.05 }],
    ['looping', 'bool', 'Döngü'],
    ['prewarm', 'bool', 'Önceden ısıt (prewarm)'],
    ['startDelay', 'num', 'Başlama gecikmesi (sn)', { min: 0, max: 10, step: 0.05 }],
    ['startLifetime', 'range', 'Ömür (sn)', { min: 0.01, max: 20, step: 0.05 }],
    ['startSpeed', 'range', 'Başlangıç hızı (m/sn)', { min: -50, max: 50, step: 0.1 }],
    ['startSize', 'range', 'Boyut (m)', { min: 0, max: 20, step: 0.01 }],
    ['startRotation', 'range', 'Başlangıç dönüşü (°)', { min: -360, max: 360, step: 1 }],
    ['startColor', 'color2', 'Renk (iki renk arası rastgele)'],
    ['gravity', 'num', 'Yerçekimi çarpanı', { min: -5, max: 5, step: 0.05 }],
    ['simulationSpace', 'enum', 'Simülasyon uzayı', { options: SPACE }],
    ['maxParticles', 'int', 'Maks parçacık', { min: 1, max: 10000, step: 1 }],
  ] },
  { key: 'emission', label: 'Yayım', always: true, fields: [
    ['rateOverTime', 'num', 'Saniyede parçacık', { min: 0, max: 2000, step: 1 }],
    ['bursts', 'bursts', 'Patlamalar (burst)'],
  ] },
  { key: 'shape', label: 'Şekil', fields: [
    ['type', 'enum', 'Tip', { options: [['cone', 'Koni'], ['sphere', 'Küre'], ['hemisphere', 'Yarım küre'], ['box', 'Kutu'], ['circle', 'Daire'], ['edge', 'Çizgi'], ['donut', 'Simit']] }],
    ['radius', 'num', 'Yarıçap (m)', { min: 0, max: 20, step: 0.01 }],
    ['radiusThickness', 'num', 'Kalınlık (0 kenar, 1 dolu)', { min: 0, max: 1, step: 0.01 }],
    ['angle', 'num', 'Koni açısı (°)', { min: 0, max: 90, step: 0.5 }],
    ['arc', 'num', 'Yay (°)', { min: 0, max: 360, step: 1 }],
    ['boxSize', 'vec3', 'Kutu boyutu (m)', { min: 0, step: 0.05 }],
    ['donutRadius', 'num', 'Simit kalınlığı (m)', { min: 0, max: 10, step: 0.01 }],
    ['position', 'vec3', 'Konum (m)', { step: 0.01 }],
    ['rotation', 'vec3', 'Dönüş (°)', { step: 1 }],
    ['randomDirection', 'num', 'Rastgele yön', { min: 0, max: 1, step: 0.01 }],
  ] },
  { key: 'velocity', label: 'Ömür boyu hız', fields: [
    ['linear', 'vec3', 'Doğrusal (m/sn)', { step: 0.1 }],
    ['orbital', 'vec3', 'Yörünge (rad/sn)', { step: 0.1 }],
    ['radial', 'num', 'Merkezden dışa (m/sn)', { min: -50, max: 50, step: 0.1 }],
    ['space', 'enum', 'Uzay', { options: SPACE }],
    ['speedModifier', 'num', 'Hız çarpanı', { min: 0, max: 10, step: 0.05 }],
  ] },
  { key: 'force', label: 'Kuvvet', fields: [
    ['force', 'vec3', 'İvme (m/sn²)', { step: 0.1 }],
    ['space', 'enum', 'Uzay', { options: SPACE }],
  ] },
  { key: 'limitVelocity', label: 'Hız sınırı / sürtünme', fields: [
    ['drag', 'num', 'Sürtünme (m/sn² yavaşlama)', { min: 0, max: 50, step: 0.05 }],
    ['limit', 'num', 'Hız sınırı (m/sn)', { min: 0, max: 100, step: 0.1 }],
    ['dampen', 'num', 'Sınır kırpma (kare başına)', { min: 0, max: 1, step: 0.01 }],
  ] },
  { key: 'noise', label: 'Gürültü (türbülans)', fields: [
    ['strength', 'num', 'Güç (m/sn)', { min: 0, max: 20, step: 0.05 }],
    ['frequency', 'num', 'Frekans', { min: 0.01, max: 10, step: 0.01 }],
    ['scrollSpeed', 'num', 'Kayma hızı', { min: 0, max: 10, step: 0.05 }],
    ['octaves', 'int', 'Oktav', { min: 1, max: 4, step: 1 }],
  ] },
  { key: 'colorOverLifetime', label: 'Ömür boyu renk', fields: [['color', 'gradient', 'Renk geçişi']] },
  { key: 'sizeOverLifetime', label: 'Ömür boyu boyut', fields: [['curve', 'curve', 'Boyut eğrisi (çarpan)']] },
  { key: 'rotationOverLifetime', label: 'Ömür boyu dönüş', fields: [['angularVelocity', 'range', 'Açısal hız (°/sn)', { min: -3600, max: 3600, step: 5 }]] },
  { key: 'textureSheet', label: 'Doku karesi (flipbook)', fields: [
    ['tilesX', 'int', 'Sütun', { min: 1, max: 16, step: 1 }],
    ['tilesY', 'int', 'Satır', { min: 1, max: 16, step: 1 }],
    ['cycles', 'int', 'Ömürde tur', { min: 1, max: 20, step: 1 }],
    ['randomStart', 'bool', 'Rastgele başlangıç karesi'],
  ] },
  { key: 'bladeTrail', label: 'Kılıç izi (şerit)', fields: [
    ['from', 'vec3', 'Kök (emitter yereli, m)', { step: 0.01 }],
    ['to', 'vec3', 'Uç (emitter yereli, m)', { step: 0.01 }],
    ['lifetime', 'num', 'İz ömrü (sn)', { min: 0.02, max: 3, step: 0.01 }],
    ['subdiv', 'int', 'Örnek arası yumuşatma', { min: 1, max: 12, step: 1 }],
    ['width', 'curve', 'Genişlik eğrisi (iz yaşı boyunca, kök–uç çarpanı)'],
    ['taper', 'enum', 'Daralma yönü', { options: [['tip', 'Uca doğru (kök kısalır)'], ['center', 'Ortaya doğru'], ['root', 'Köke doğru (uç kısalır)']] }],
    ['uvMode', 'enum', 'Doku U düzeni', { options: [['stretch', 'Esnet (U = iz yaşı 0→1)'], ['tile', 'Döşe (U = iz uzunluğu / döşeme boyu)']] }],
    ['tileLength', 'num', 'Döşeme boyu (m, uç yolu)', { min: 0.01, max: 20, step: 0.05 }],
  ] },
  { key: 'customData', label: 'Özel veri (materyale, i.custom)', fields: [
    ['x', 'curve', 'x (ömür boyu)'], ['y', 'curve', 'y (ömür boyu)'], ['z', 'curve', 'z (ömür boyu)'], ['w', 'curve', 'w (ömür boyu)'],
  ] },
  { key: 'light', label: 'Işık', fields: [
    ['mode', 'enum', 'Tür', { options: [['single', 'Tek ışık (emitter konumunda)'], ['perParticle', 'Parçacık başına']] }],
    ['color', 'color', 'Renk'],
    ['useParticleColor', 'bool', 'Parçacık rengini kullan (perParticle)'],
    ['intensity', 'num', 'Yoğunluk', { min: 0, max: 200, step: 0.1 }],
    ['radius', 'num', 'Yarıçap (m)', { min: 0.05, max: 50, step: 0.05 }],
    ['curve', 'curve', 'Yoğunluk eğrisi (tek: emitter döngüsü, parçacık: ömür)'],
    ['maxLights', 'int', 'En çok ışık (perParticle)', { min: 1, max: 8, step: 1 }],
    ['shadows', 'bool', 'Gölge (desteklenmez; hep kapalı)'],
  ] },
  { key: 'subEmitters', label: 'Alt emitter (doğum/ölüm)', fields: [['items', 'subList', "Tetiklenecek emitter'lar"]] },
  { key: 'renderer', label: 'Görünüm', always: true, fields: [
    ['mode', 'enum', 'Mod', { options: [['billboard', 'Billboard (kameraya bakar)'], ['stretched', 'Hıza göre uzar'], ['horizontal', 'Yatay (yere paralel)'], ['vertical', 'Dikey (Y ekseninde döner)'], ['mesh', 'Mesh (yay, silindir, düzlem, dosya)'], ['decal', 'Yere iz (decal: yüzeye yansıtılır)']] }],
    ['alignment', 'enum', 'Hizalama (billboard)', { options: [['view', 'Kameraya bakar (View)'], ['local', 'Emitter dönüşüne göre (Local, 3B)']] }],
    ['material', 'material', 'Materyal (kütüphaneden)'],
    ['texture', 'texture', 'Doku'],
    ['blend', 'enum', 'Karışım', { options: [['additive', 'Toplamalı (ışık)'], ['alpha', 'Alfa (duman)'], ['distortion', 'Bükülme (sıcak hava, şok)']] }],
    ['intensity', 'num', 'Parlaklık (HDR, bloom)', { min: 0, max: 20, step: 0.05 }],
    ['lengthScale', 'num', 'Uzama: boyut çarpanı', { min: 0, max: 20, step: 0.05 }],
    ['velocityScale', 'num', 'Uzama: hız çarpanı', { min: 0, max: 5, step: 0.01 }],
    ['sortingOrder', 'int', 'Çizim sırası', { min: -100, max: 100, step: 1 }],
    ['mesh', 'group', 'Mesh', { when: { mode: ['mesh'] }, fields: [
      ['shape', 'enum', 'Şekil', { options: [['arc', 'Yay / halka dilimi (kesik)'], ['cylinder', 'Silindir / koni kesiti'], ['plane', 'Düzlem (1×1)'], ['file', 'Dosya (meshes/ GLB/OBJ)']] }],
      ['file', 'meshfile', 'Dosya (meshes/)'],
      ['innerRadius', 'num', 'İç yarıçap (m) · silindirde üst', { min: 0, max: 50, step: 0.01 }],
      ['outerRadius', 'num', 'Dış yarıçap (m) · silindirde alt', { min: 0, max: 50, step: 0.01 }],
      ['angle', 'num', 'Açı (°)', { min: 1, max: 360, step: 1 }],
      ['height', 'num', 'Yükseklik (m, silindir)', { min: 0, max: 50, step: 0.01 }],
      ['segments', 'int', 'Bölüm (açı / X)', { min: 1, max: 256, step: 1 }],
      ['rings', 'int', 'Halka (yarıçap / Y)', { min: 1, max: 64, step: 1 }],
      ['rotation', 'vec3', 'Mesh dönüşü (°)', { step: 1 }],
    ] }],
    ['distortion', 'group', 'Bükülme', { when: { blend: ['distortion'] }, fields: [
      ['mode', 'enum', 'Yön kaynağı', { options: [['radial', 'Merkezden dışa (doku alfası maske)'], ['noise', 'Kayan gürültü (sıcak hava)'], ['normal', 'Doku RG = yön (normal haritası)']] }],
      ['strength', 'num', 'Güç (ekran kesri)', { min: 0, max: 0.5, step: 0.001 }],
      ['frequency', 'num', 'Gürültü frekansı', { min: 0.1, max: 40, step: 0.1 }],
      ['scroll', 'vec2', 'Kayma hızı (UV/sn)', { step: 0.05 }],
    ] }],
    ['softParticles', 'group', 'Yumuşak parçacık (derinlik)', { fields: [
      ['enabled', 'bool', 'Açık (yüzeye değince keskin kesilmesin)'],
      ['distance', 'num', 'Sönme mesafesi (m)', { min: 0.01, max: 5, step: 0.01 }],
    ] }],
    ['decal', 'group', 'Yere iz (decal)', { when: { mode: ['decal'] }, fields: [
      ['size', 'vec3', 'Boyut: en, boy, derinlik (m × parçacık boyutu)', { min: 0.01, step: 0.05 }],
      ['projection', 'enum', 'Yansıtma', { options: [['down', 'Aşağı (zemin)'], ['forward', 'İleri (emitter +Z, duvar)']] }],
      ['groundOnly', 'bool', 'Yalnız yansıtma yönüne bakan yüzeyler (kahramana düşmez)'],
    ] }],
  ] },
];

// ── yardımcılar
export const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);
const clampN = (v, o = {}) => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));

export function parseColor(c) { // '#rgb' | '#rrggbb' | '#rrggbbaa' -> [r,g,b,a] 0..1 (sRGB)
  let s = String(c || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return null;
  const n = (i) => parseInt(s.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), s.length === 8 ? n(6) : 1];
}
const normColor = (c, d) => (parseColor(c) ? '#' + String(c).trim().replace(/^#/, '').toLowerCase() : d);

// eğri: [[t, değer], ...] t sıralı, doğrusal ara değer, uçlarda sabit
export function evalCurve(points, t) {
  if (!points?.length) return 1;
  if (t <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b[0]) return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
  }
  return points[points.length - 1][1];
}
// gradyan: renk anahtarları [[t,'#hex']], alfa anahtarları [[t, a]] -> [r,g,b,a] (sRGB, doğrusal karışım; Unity Blend modu)
export function evalGradient(g, t) {
  const cs = g?.color?.length ? g.color : [[0, '#ffffff']], as = g?.alpha?.length ? g.alpha : [[0, 1]];
  const rgb = [0, 1, 2].map((k) => evalCurve(cs.map(([tt, c]) => [tt, (parseColor(c) || [1, 1, 1])[k]]), t));
  return [...rgb, evalCurve(as, t)];
}

function normRange(v, d, o) {
  let a = Array.isArray(v) ? v : typeof v === 'number' ? [v, v] : d;
  a = [num(a[0], d[0]), num(a[1] ?? a[0], d[1])].map((x) => clampN(x, o));
  return a[0] <= a[1] ? a : [a[1], a[0]];
}
const normVec3 = (v, d, o) => (Array.isArray(v) ? [0, 1, 2].map((i) => clampN(num(v[i], d[i]), o)) : d);
const sortKeys = (arr) => arr.sort((a, b) => a[0] - b[0]);
const unit = (x) => Math.min(1, Math.max(0, x));

function normField(type, v, d, o = {}, warn, where) {
  switch (type) {
    case 'num': return clampN(num(v, d), o);
    case 'int': return Math.round(clampN(num(v, d), o));
    case 'bool': return typeof v === 'boolean' ? v : d;
    case 'range': return normRange(v, d, o);
    case 'vec3': return normVec3(v, d, o);
    case 'vec2': return Array.isArray(v) ? [0, 1].map((i) => clampN(num(v[i], d[i]), o)) : d;
    case 'color': return normColor(Array.isArray(v) ? v[0] : v, d);
    case 'meshfile': return typeof v === 'string' ? v.trim().replace(/^.*[\\/]/, '') : d; // meshes/<dosya> (uzantılı)
    case 'group': {
      const s = isObj(v) ? v : {}; const out = {};
      for (const [k, t, , oo] of o.fields) out[k] = normField(t, s[k], d[k], oo, warn, `${where}.${k}`);
      for (const k of Object.keys(s)) if (!(k in d)) warn(`bilinmeyen alan atıldı: ${where}.${k}`);
      return out;
    }
    case 'subList': {
      if (!Array.isArray(v)) return d;
      return v.filter(isObj).slice(0, 4).map((x) => ({ emitter: String(x.emitter ?? ''), trigger: ['death', 'birth'].includes(x.trigger) ? x.trigger : 'death',
        count: normRange(x.count, [5, 5], { min: 0, max: 1000 }).map(Math.round), inheritColor: !!x.inheritColor, inheritSize: !!x.inheritSize,
        inheritVelocity: unit(num(x.inheritVelocity, 0)) }));
    }
    case 'enum': { const ok = o.options.map((x) => x[0]); if (v !== undefined && !ok.includes(v)) warn(`${where}: "${v}" geçersiz (${ok.join('|')})`); return ok.includes(v) ? v : d; }
    case 'texture': return typeof v === 'string' && v ? v : d; // yerleşik ya da vfx/textures içindeki özel png adı
    case 'material': return typeof v === 'string' ? v.trim().replace(/\.json$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') : d; // materials/<ad>.json; '' = yok
    case 'color2': { const a = Array.isArray(v) ? v : typeof v === 'string' ? [v, v] : d; return [normColor(a[0], d[0]), normColor(a[1] ?? a[0], d[1])]; }
    case 'gradient': return v; // modül düzeyinde işlenir
    case 'curve': {
      const a = Array.isArray(v) && v.length ? v.filter((p) => Array.isArray(p)).map((p) => [unit(num(p[0], 0)), Math.max(0, num(p[1], 1))]) : d;
      return sortKeys(a.length ? a : d).slice(0, 16);
    }
    case 'bursts': {
      if (!Array.isArray(v)) return d;
      return v.filter(isObj).map((b) => ({ time: Math.max(0, num(b.time, 0)), count: normRange(b.count, [10, 10], { min: 0, max: 10000 }).map(Math.round), cycles: Math.max(1, Math.round(num(b.cycles, 1))), interval: Math.max(0.01, num(b.interval, 0.1)) }))
        .sort((a, b) => a.time - b.time).slice(0, 8);
    }
    default: return v ?? d;
  }
}

// Bilinmeyen anahtarları atar, eksikleri varsayılanla doldurur, sınırlar. { effect, warnings }
export function normalizeEffect(input) {
  const warnings = []; const warn = (m) => warnings.push(m);
  const src = isObj(input) ? input : {};
  const def = defaultEffect();
  const e = {
    format: VFX_FORMAT,
    name: String(src.name || def.name).trim().replace(/[^\w .-]+/g, '_') || 'vfx',
    duration: clampN(num(src.duration, def.duration), { min: 0.05, max: 60 }),
    loop: typeof src.loop === 'boolean' ? src.loop : def.loop,
    attach: { ...def.attach },
    preview: { ...def.preview },
    emitters: [],
  };
  if (isObj(src.attach)) {
    const a = src.attach;
    e.attach.target = ['none', 'bone', 'prop'].includes(a.target) ? a.target : 'none';
    e.attach.name = String(a.name || '');
    e.attach.position = normVec3(a.position, def.attach.position);
    e.attach.rotation = normVec3(a.rotation, def.attach.rotation);
  }
  if (isObj(src.preview)) {
    const p = src.preview;
    e.preview.withAnimation = typeof p.withAnimation === 'boolean' ? p.withAnimation : def.preview.withAnimation;
    e.preview.startFrame = Math.max(0, Math.round(num(p.startFrame, 0)));
    e.preview.background = normColor(p.background, def.preview.background);
    e.preview.bloom = clampN(num(p.bloom, def.preview.bloom), { min: 0, max: 5 });
    e.preview.showHero = typeof p.showHero === 'boolean' ? p.showHero : def.preview.showHero;
    e.preview.showGrid = typeof p.showGrid === 'boolean' ? p.showGrid : def.preview.showGrid;
    e.preview.showGround = typeof p.showGround === 'boolean' ? p.showGround : def.preview.showGround;
  }
  const list = Array.isArray(src.emitters) ? src.emitters : src.emitters === undefined ? def.emitters : [];
  const used = new Set();
  list.forEach((em, i) => {
    const out = normalizeEmitter(em, warn, i);
    let n = out.name; let k = 2; while (used.has(n)) n = `${out.name}_${k++}`;
    if (n !== out.name) warn(`emitter adı çakıştı: "${out.name}" → "${n}"`);
    out.name = n; used.add(n); e.emitters.push(out);
  });
  // alt emitter başvuruları: hedef var olmalı, kendisi olmamalı (ad ya da sıra)
  for (const em of e.emitters) {
    if (!em.subEmitters.enabled) continue;
    em.subEmitters.items = em.subEmitters.items.filter((it) => {
      const t = e.emitters.find((x) => x.name === it.emitter) || (/^\d+$/.test(it.emitter) ? e.emitters[+it.emitter] : null);
      if (!t) { warn(`${em.name}.subEmitters: hedef emitter yok: "${it.emitter}"`); return false; }
      if (t === em) { warn(`${em.name}.subEmitters: emitter kendisini tetikleyemez`); return false; }
      it.emitter = t.name; return true;
    });
  }
  for (const k of Object.keys(src)) if (!(k in def)) warn(`bilinmeyen alan atıldı: ${k}`);
  return { effect: e, warnings };
}

export function normalizeEmitter(input, warn = () => {}, index = 0) {
  const src = isObj(input) ? input : {};
  const def = defaultEmitter();
  const out = {
    name: String(src.name || `emitter${index + 1}`).trim().replace(/[^\p{L}\p{N}_ .-]+/gu, '_'),
    enabled: typeof src.enabled === 'boolean' ? src.enabled : true,
    position: normVec3(src.position, def.position),
    rotation: normVec3(src.rotation, def.rotation),
  };
  const where = (m, f) => `${out.name}.${m}.${f}`;
  for (const mod of MODULES) {
    const s = isObj(src[mod.key]) ? src[mod.key] : {}; const d = def[mod.key]; const m = {};
    if (!mod.always) m.enabled = typeof s.enabled === 'boolean' ? s.enabled : d.enabled;
    for (const [key, type, , o] of mod.fields) m[key] = normField(type, s[key], d[key], o, warn, where(mod.key, key));
    if (mod.key === 'colorOverLifetime') {
      const g = isObj(s) ? s : {};
      m.color = sortKeys((Array.isArray(g.color) && g.color.length ? g.color : d.color).filter(Array.isArray).map((k) => [unit(num(k[0], 0)), normColor(k[1], '#ffffff')])).slice(0, 8);
      m.alpha = sortKeys((Array.isArray(g.alpha) && g.alpha.length ? g.alpha : d.alpha).filter(Array.isArray).map((k) => [unit(num(k[0], 0)), unit(num(k[1], 1))])).slice(0, 8);
    }
    for (const k of Object.keys(s)) if (!(k in d)) warn(`bilinmeyen alan atıldı: ${out.name}.${mod.key}.${k}`);
    out[mod.key] = m;
  }
  if (out.light.enabled && out.light.shadows) { warn(`${out.name}.light.shadows: parçacık ışıklarında gölge desteklenmez (kapatıldı)`); out.light.shadows = false; }
  if (out.renderer.mode === 'decal' && out.bladeTrail.enabled) warn(`${out.name}: bladeTrail açıkken renderer.mode decal yok sayılır`);
  if (out.renderer.mode === 'decal' && out.renderer.blend === 'distortion') { warn(`${out.name}: decal + distortion desteklenmez → alpha`); out.renderer.blend = 'alpha'; }
  if (out.renderer.mode === 'mesh' && out.renderer.mesh.shape === 'file' && !out.renderer.mesh.file) warn(`${out.name}.renderer.mesh.file: dosya seçilmedi (meshes/<ad>.glb|obj)`);
  out.renderer.texture = out.renderer.texture.replace(/\.png$/i, '').replace(/[\\/:]+/g, '_').replace(/^\.+/, '') || 'soft'; // yalnız dosya adı
  if (!(out.renderer.texture in TEXTURES)) warn(`${out.name}.renderer.texture: "${out.renderer.texture}" yerleşik değil; vfx/textures/${out.renderer.texture}.png olmalı`);
  for (const k of Object.keys(src)) if (!(k in def)) warn(`bilinmeyen alan atıldı: ${out.name}.${k}`);
  return out;
}

// ── yol ile okuma/yazma ("main.startSize", "renderer.intensity", "preview.bloom")
export function getPath(obj, path) { return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
export function setPath(obj, path, value) {
  const ks = String(path).split('.'); let o = obj;
  for (const k of ks.slice(0, -1)) { if (!isObj(o[k])) o[k] = {}; o = o[k]; }
  o[ks.at(-1)] = value;
}
export const findEmitter = (effect, sel) => (typeof sel === 'number' ? effect.emitters[sel] : effect.emitters.find((e) => e.name === sel) || effect.emitters[Number.isInteger(+sel) ? +sel : -1]);

// changes: [{ emitter?: ad|index, path, value }] — emitter yoksa efekt düzeyi. Yol varsayılan şemada yoksa hata.
export function applyChanges(effect, changes) {
  const e = clone(effect); const errors = [];
  const defEm = defaultEmitter(), defEf = defaultEffect();
  for (const c of changes || []) {
    if (c.emitter === undefined || c.emitter === null || c.emitter === '') {
      if (getPath(defEf, c.path) === undefined || c.path === 'emitters' || c.path.startsWith('emitters.')) { errors.push(`efekt alanı yok: ${c.path}`); continue; }
      setPath(e, c.path, c.value);
    } else {
      const em = findEmitter(e, c.emitter); if (!em) { errors.push(`emitter yok: ${c.emitter}`); continue; }
      if (getPath(defEm, c.path) === undefined) { errors.push(`emitter alanı yok: ${c.path}`); continue; }
      setPath(em, c.path, c.value);
    }
  }
  const { effect: out, warnings } = normalizeEffect(e);
  return { effect: out, errors, warnings };
}

// base → cur farkı: [{ path, from, to }], eklenen/silinen emitter'lar
export function diffEffects(base, cur) {
  const changes = [];
  const walk = (a, b, p) => {
    if (isObj(a) && isObj(b)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p ? p + '.' + k : k); return; }
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: p, from: a, to: b });
  };
  const { emitters: be = [], ...bRest } = base || {}; const { emitters: ce = [], ...cRest } = cur || {};
  walk(bRest, cRest, '');
  const bn = new Map(be.map((x) => [x.name, x])), cn = new Map(ce.map((x) => [x.name, x]));
  const added = ce.filter((x) => !bn.has(x.name)).map((x) => x.name), removed = be.filter((x) => !cn.has(x.name)).map((x) => x.name);
  for (const [n, c] of cn) if (bn.has(n)) walk(bn.get(n), c, `emitters.${n}`);
  const order = (l) => l.map((x) => x.name).join('|');
  if (!added.length && !removed.length && order(be) !== order(ce)) changes.push({ path: 'emitters(sıra)', from: be.map((x) => x.name), to: ce.map((x) => x.name) });
  return { changes, addedEmitters: added, removedEmitters: removed };
}

// ── hazır emitter şablonları (defaultEmitter üstüne yazılır)
export const PRESETS = {
  sparks: { name: 'kıvılcım', main: { duration: 1, looping: true, startLifetime: [0.3, 0.6], startSpeed: [4, 8], startSize: [0.03, 0.06], startColor: ['#ffd27a', '#ff8a2a'], gravity: 1 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: [30, 40], cycles: 1, interval: 0.1 }] },
    shape: { type: 'sphere', radius: 0.05 }, limitVelocity: { enabled: true, drag: 6, limit: 100, dampen: 0 },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [0.4, '#ffb347'], [1, '#ff4a1a']], alpha: [[0, 1], [0.7, 1], [1, 0]] },
    renderer: { mode: 'stretched', texture: 'spark', blend: 'additive', intensity: 3, lengthScale: 1, velocityScale: 0.04 } },
  embers: { name: 'kor', main: { startLifetime: [1.2, 2.2], startSpeed: [0.3, 0.8], startSize: [0.02, 0.05], startColor: ['#ffb347', '#ff5a1f'], gravity: -0.05 },
    emission: { rateOverTime: 25 }, shape: { type: 'circle', radius: 0.4, rotation: [-90, 0, 0] },
    velocity: { enabled: true, linear: [0, 0.6, 0], space: 'world' }, noise: { enabled: true, strength: 0.6, frequency: 1.2, scrollSpeed: 0.4 },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [0.3, '#ffb347'], [1, '#ff3d00']], alpha: [[0, 0], [0.1, 1], [0.8, 1], [1, 0]] },
    renderer: { texture: 'ember', blend: 'additive', intensity: 2.5 } },
  fire: { name: 'alev', main: { startLifetime: [0.5, 0.9], startSpeed: [0.6, 1.2], startSize: [0.25, 0.45], startRotation: [-30, 30], startColor: ['#ffcf6b', '#ff7a2a'] },
    emission: { rateOverTime: 40 }, shape: { type: 'cone', radius: 0.15, angle: 8 },
    noise: { enabled: true, strength: 0.4, frequency: 1.5, scrollSpeed: 1 },
    colorOverLifetime: { enabled: true, color: [[0, '#fff2c4'], [0.35, '#ff9a3c'], [1, '#c2200a']], alpha: [[0, 0], [0.12, 1], [0.6, 0.8], [1, 0]] },
    sizeOverLifetime: { enabled: true, curve: [[0, 0.6], [0.3, 1], [1, 0.2]] },
    rotationOverLifetime: { enabled: true, angularVelocity: [-60, 60] },
    renderer: { texture: 'flame', blend: 'additive', intensity: 2 } },
  smoke: { name: 'duman', main: { startLifetime: [1.5, 2.5], startSpeed: [0.3, 0.7], startSize: [0.4, 0.8], startRotation: [0, 360], startColor: ['#3a3f4a', '#23262e'] },
    emission: { rateOverTime: 12 }, shape: { type: 'cone', radius: 0.2, angle: 12 },
    noise: { enabled: true, strength: 0.3, frequency: 0.6, scrollSpeed: 0.3 },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 0], [0.2, 0.6], [1, 0]] },
    sizeOverLifetime: { enabled: true, curve: [[0, 0.5], [1, 1.6]] },
    rotationOverLifetime: { enabled: true, angularVelocity: [-20, 20] },
    renderer: { texture: 'smoke', blend: 'alpha', intensity: 1 } },
  flash: { name: 'parlama', main: { duration: 0.5, looping: false, startLifetime: [0.12, 0.12], startSpeed: [0, 0], startSize: [1.2, 1.2], startColor: ['#ffd9a0', '#ffd9a0'], maxParticles: 4 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: [1, 1], cycles: 1, interval: 0.1 }] }, shape: { enabled: false },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 1], [1, 0]] },
    sizeOverLifetime: { enabled: true, curve: [[0, 0.5], [0.3, 1], [1, 1.1]] },
    renderer: { texture: 'flare', blend: 'additive', intensity: 4 } },
  shockwave: { name: 'şok dalgası', main: { duration: 1, looping: false, startLifetime: [0.4, 0.4], startSpeed: [0, 0], startSize: [2.5, 2.5], startColor: ['#ff9a4a', '#ff9a4a'], maxParticles: 4 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: [1, 1], cycles: 1, interval: 0.1 }] }, shape: { enabled: false },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ff6a2a']], alpha: [[0, 1], [1, 0]] },
    sizeOverLifetime: { enabled: true, curve: [[0, 0.1], [1, 1]] },
    renderer: { mode: 'horizontal', texture: 'ring', blend: 'additive', intensity: 3 } },
  glow: { name: 'hale', main: { startLifetime: [0.6, 0.6], startSpeed: [0, 0], startSize: [0.8, 0.8], startColor: ['#ff8a3c', '#ff8a3c'], maxParticles: 8 },
    emission: { rateOverTime: 6 }, shape: { enabled: false },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [1, '#ffffff']], alpha: [[0, 0], [0.5, 0.6], [1, 0]] },
    renderer: { texture: 'glow', blend: 'additive', intensity: 1.5 } },
  slash: { name: 'kesik', main: { duration: 0.6, looping: false, startLifetime: [0.25, 0.25], startSpeed: [0, 0], startSize: [1.6, 1.6], startRotation: [-20, -20], startColor: ['#ffb05a', '#ffb05a'], maxParticles: 4 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: [1, 1], cycles: 1, interval: 0.1 }] }, shape: { enabled: false },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [0.5, '#ff9a3c'], [1, '#ff3d00']], alpha: [[0, 1], [0.6, 0.8], [1, 0]] },
    sizeOverLifetime: { enabled: true, curve: [[0, 0.8], [1, 1.1]] },
    rotationOverLifetime: { enabled: true, angularVelocity: [-180, -180] },
    renderer: { texture: 'slash', blend: 'additive', intensity: 3 } },
  // yay mesh'i: 'soft' doku yay UV'sinde iki ucu incelen hilal bant verir; customData.x = açılma (0→1), y = silinme (materyalde i.custom)
  arc_slash: { name: 'yay kesiği', main: { duration: 0.6, looping: false, startLifetime: [0.32, 0.32], startSpeed: [0, 0], startSize: [1, 1], startColor: ['#a8d4ff', '#a8d4ff'], maxParticles: 2 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: [1, 1], cycles: 1, interval: 0.1 }] }, shape: { enabled: false },
    colorOverLifetime: { enabled: true, color: [[0, '#ffffff'], [0.4, '#cfe6ff'], [1, '#4a8cff']], alpha: [[0, 1], [0.55, 0.85], [1, 0]] },
    sizeOverLifetime: { enabled: true, curve: [[0, 0.92], [1, 1.06]] },
    customData: { enabled: true, x: [[0, 0], [0.35, 1], [1, 1]], y: [[0, 0], [0.45, 0], [1, 1]] },
    renderer: { mode: 'mesh', texture: 'soft', blend: 'additive', intensity: 3, mesh: { shape: 'arc', innerRadius: 0.55, outerRadius: 1.1, angle: 200, segments: 72, rings: 6 } } },
  heat_haze: { name: 'sıcak hava', main: { startLifetime: [1, 1.6], startSpeed: [0.3, 0.6], startSize: [0.6, 1], startRotation: [0, 360] },
    emission: { rateOverTime: 8 }, shape: { type: 'cone', radius: 0.25, angle: 10 },
    colorOverLifetime: { enabled: true, alpha: [[0, 0], [0.25, 1], [0.7, 0.8], [1, 0]] }, sizeOverLifetime: { enabled: true, curve: [[0, 0.6], [1, 1.3]] },
    renderer: { texture: 'soft', blend: 'distortion', distortion: { mode: 'noise', strength: 0.025, frequency: 5, scroll: [0, 0.8] } } },
  shock_distort: { name: 'şok bükülmesi', main: { duration: 1, looping: false, startLifetime: [0.45, 0.45], startSpeed: [0, 0], startSize: [3, 3], maxParticles: 2 },
    emission: { rateOverTime: 0, bursts: [{ time: 0, count: [1, 1], cycles: 1, interval: 0.1 }] }, shape: { enabled: false },
    colorOverLifetime: { enabled: true, alpha: [[0, 1], [1, 0]] }, sizeOverLifetime: { enabled: true, curve: [[0, 0.1], [1, 1]] },
    renderer: { texture: 'ring', blend: 'distortion', distortion: { mode: 'radial', strength: 0.06 } } },
  fire_light: { name: 'ateş ışığı', main: { startLifetime: [0.5, 0.5], startSpeed: [0, 0], maxParticles: 1 }, emission: { rateOverTime: 0 }, shape: { enabled: false },
    light: { enabled: true, mode: 'single', color: '#ff8a3c', intensity: 6, radius: 3, curve: [[0, 1], [0.15, 0.75], [0.35, 1], [0.55, 0.8], [0.75, 1], [1, 0.85]] } },
};

function deepMerge(base, over) {
  if (!isObj(over)) return over === undefined ? base : over;
  const out = isObj(base) ? { ...base } : {};
  for (const [k, v] of Object.entries(over)) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  return out;
}
export function presetEmitter(name, overrides) {
  const p = PRESETS[name]; if (!p && name) throw new Error(`şablon yok: ${name} (${Object.keys(PRESETS).join(', ')})`);
  return normalizeEmitter(deepMerge(deepMerge(defaultEmitter(), p ? clone(p) : {}), overrides || {}));
}

// ── MCP vfx_reference aracı ve geliştiriciler için açıklama
export const VFX_REFERENCE = `# VFX efekt formatı (${VFX_FORMAT})
Bir efekt = birden çok emitter (katman). Her emitter Unity'de efekt kökünün altında bir ParticleSystem olur (Shuriken).
Değerler Unity koordinatlarında: sol-el, +X sağ, +Y yukarı, +Z ileri (karakterin baktığı yön). Metre, saniye, derece.
Dönüşler Unity Euler (uygulama sırası Z, X, Y). Renkler '#rrggbb' (ya da '#rrggbbaa'), sRGB.

## Efekt
- name, duration (önizleme döngüsü, sn; Unity'de kök ParticleSystem süresi), loop (önizlemede tekrar)
- attach: { target: none|bone|prop, name: kemik kısa adı ("RightHand") ya da eşya id ("katana"), position, rotation }
  Konum/dönüş, kemiğin REST (T-pose) dünya eksenlerinde ya da eşyanın kendi ekseninde (eşya modeli ortalanır: orijin = modelin
  merkezi; Elarion katanası ±Z boyunca ~0.92 m). Ölçek iptal edilir, birim hep metre. Önizleme + oyuna bağlama bilgisi.
- preview: { withAnimation (animasyonla birlikte oynat), startFrame (efekt animasyonun bu karesinde başlar), background, bloom (0 kapalı), showHero, showGrid, showGround (ışığı görmek için zemin) }
- emitters: [...]

## Emitter (her modül Unity'deki aynı adlı modül)
- name (efekt içinde benzersiz), enabled, position/rotation (efekt köküne göre)
- main: duration, looping, prewarm, startDelay, startLifetime[min,max], startSpeed[min,max], startSize[min,max] (m),
  startRotation[min,max] (°), startColor[renkA, renkB] (aradan rastgele), gravity (Physics.gravity çarpanı, -Y dünya),
  simulationSpace local|world (world: parçacıklar emitter hareket edince geride kalır), maxParticles
- emission: rateOverTime (sn başına), bursts: [{ time, count:[min,max], cycles, interval }] (en çok 8)
- shape: enabled, type cone|sphere|hemisphere|box|circle|edge|donut, radius, radiusThickness (0 yalnız kenar, 1 dolu),
  angle (koni açısı), arc (°, daire/koni/simit), boxSize, donutRadius, position, rotation, randomDirection (0..1)
  Unity yönleri: koni +Z'ye açılır (taban XY düzleminde), hemisphere +Z yarısı, box yönü +Z, circle/donut XY düzleminde dışa,
  edge X ekseni boyunca uzanır (uzunluk 2×radius) ve +Y'ye yayar. Varsayılan shape.rotation [-90,0,0] koniyi yukarı (+Y) çevirir.
  shape.enabled=false: kökten +Z yönünde (hız 0 ise yerinde) doğar.
- velocity: linear[x,y,z] (m/sn), orbital[x,y,z] (rad/sn, emitter merkezi etrafında), radial (merkezden dışa m/sn), space, speedModifier
- force: force[x,y,z] (m/sn² ivme), space
- limitVelocity: drag (hız her saniye drag m/sn azalır — sabit yavaşlama, 0'da durur), limit (m/sn), dampen (0..1: sınırı aşan hızın her karede kırpılan oranı)
- noise: strength (m/sn), frequency, scrollSpeed, octaves
- colorOverLifetime: color [[t,'#hex']], alpha [[t,a]] (t 0..1 ömür; en çok 8'er anahtar). Son renk = startColor × gradyan.
- sizeOverLifetime: curve [[t, çarpan]] (doğrusal). Son boyut = startSize × eğri.
- rotationOverLifetime: angularVelocity[min,max] (°/sn)
- textureSheet: tilesX, tilesY, cycles, randomStart (flipbook dokular için)
- renderer.alignment: view|local (yalnız billboard). local = Unity ParticleSystemRenderSpace.Local: quad emitter'ın yerel XY
  düzleminde durur (doku +X sağ, +Y yukarı; -Z tarafından bakınca aynasız, startRotation yerel Z etrafında saat yönü); kesik gibi
  3B düzlemi olan şekiller için. Düzlemi emitter rotation belirler.
- renderer: mode billboard|stretched|horizontal|vertical|mesh, texture (${Object.keys(TEXTURES).join(', ')} ya da vfx/textures/<ad>.png için <ad>),
  blend additive|alpha|distortion, intensity (HDR çarpanı, >1 bloom verir), lengthScale + velocityScale (stretched uzunluğu = boyut·lengthScale + hız·velocityScale), sortingOrder
- renderer.material: kütüphaneden materyal adı (materials/<ad>.json, list_materials; '' = yok). Doluysa parçacık o materyalin
  shader'ı ve değerleriyle çizilir; texture/blend/intensity YOK SAYILIR (doku, karışım, parlaklık materyalden gelir). Shader'da
  i.color = parçacık rengi (startColor × colorOverLifetime, doğrusal), i.uv = quad UV'si (flipbook açıksa o anki kare),
  vert()'teki v.positionOS = köşenin DÜNYA konumu (Unity'de parçacık köşeleri dünyada, nesne matrisi birim), v.normalOS = quad normali.
  Hazır URP Particles/Unlit (urp_particles_unlit) ya da özel UPE-SL shader olabilir; send_vfx_to_unity materyali (ve özel shader'ını) da gönderir.
  i.custom = customData eğrileri (aşağıda). Mesh modunda i.uv = mesh UV'si, v.normalOS = mesh normali (dünya).

## Mesh parçacıkları (renderer.mode = 'mesh')
- renderer.mesh: { shape: arc|cylinder|plane|file, file (meshes/<dosya>.glb|gltf|obj|fbx), innerRadius, outerRadius, angle (°),
  height, segments, rings, rotation (° Unity Euler, mesh'in parçacığa göre sabit dönüşü) }. Birim metre; parçacık boyutu
  (startSize × sizeOverLifetime) mesh'i düzgün ölçekler (kesik için startSize 1 → yarıçaplar gerçek metre).
  arc: emitter'ın yerel XY düzleminde halka dilimi; açı 0 = yerel +X, +Y'ye doğru angle derece. UV: U yay boyunca 0→1, V iç→dış 0→1.
  cylinder: yerel Y ekseni etrafında, taban y=0, tepe y=height; alt yarıçap outerRadius, üst innerRadius (koni/hortum); U açı, V alttan üste.
  plane: XY'de 1×1 kare. Mesh'in yönü = emitter dönüşü (Local hizalama gibi) × mesh.rotation; startRotation/rotationOverLifetime
  yerel Z etrafında döndürür. Doku mesh UV'siyle örneklenir (flipbook da). 'soft' doku yayda iki ucu incelen hilal bant verir.
- Animasyondan yay: fit_arc_from_animation aracı kılıç ucu (+ tutuş) yolunu örnekler, düzlem + çember oturtur; emitter position/rotation,
  mesh innerRadius/outerRadius/angle ve customData.x (açılma eğrisi, uç yolunun yay kesri) yazabilir.

## Bükülme (renderer.blend = 'distortion')
- Parçacık arkasındaki sahneyi büker (sıcak hava, şok dalgası, kesik arkası). Işık eklemez; renk kullanılmaz, alfa = maske.
- renderer.distortion: { mode: radial (doku alfası maske, UV merkezinden dışa) | noise (kayan gradyan gürültü; frequency, scroll) |
  normal (doku RG = yön ×2−1, scroll ile kayar), strength (ekran kesri, 0.01–0.08 tipik) }.
- renderer.material ile: shader frag() çıkışı rg = ofset yönü (-1..1), a = maske; ofset = rg × a × strength.
- Unreal: Translucent materyal, Emissive = SceneColor(ekran UV + ofset), Opacity = maske (aynı formül).

## Yumuşak parçacık (renderer.softParticles)
- { enabled, distance (m) }: parçacık bir yüzeye (zemin, kahraman) distance kala alfası doğrusal söner — duman yere değince keskin kesilmez.
  UPE-SL'de otomatik uygulanır (alfa; premultiply'da renk de) ve i.softFade (0..1) ile i.sceneDepth (arkadaki yüzeyin kamera derinliği, m) okunabilir.
  Unreal: materyalde DepthFade (FadeDistance = distance cm).

## Yere iz (renderer.mode = 'decal')
- renderer.decal: { size [en, boy, derinlik] (m; parçacık boyutuyla çarpılır), projection: down (zemine) | forward (emitter +Z yönüne),
  groundOnly (yalnız yansıtma yönüne bakan yüzeyler; önizlemede kahramana düşmez) }. Doku/materyal izin UV'si: U = en, V = boy.
  Renk/alfa startColor × colorOverLifetime (solma), dönüş startRotation/rotationOverLifetime (yansıtma ekseni etrafında).
  Önizlemede sahne derinliğinden yeniden kurulan yüzeye yansıtılır (zemin görünmüyorsa zemin diski kendiliğinden açılır).
  Unreal: Niagara Decal renderer + Deferred Decal materyali (DecalColor = parçacık rengi). Karakterlerde "Receives Decals" kapalı olmalı.

## Işık (emitter.light)
- { enabled, mode: single (emitter konumunda tek nokta ışığı; curve emitter döngüsü boyunca) | perParticle (ilk maxLights parçacıkta;
  curve parçacık ömrü boyunca), color, useParticleColor (perParticle), intensity (önizlemede three.js kandela; Unreal'de yaklaşık),
  radius (m), curve [[t, çarpan]], maxLights (1–8), shadows (hep false) }. Kahraman ve preview.showGround zemini aydınlanır.
  Işık-yalnız emitter: emission.rateOverTime 0 + light.mode single (şablon fire_light).

## Kılıç izi ek alanları (bladeTrail)
- width [[iz yaşı 0..1, kök–uç çarpanı]] (sizeOverLifetime ile çarpılır), taper: tip (kök uca doğru kısalır) | center | root,
  uvMode: stretch (U = iz yaşı) | tile (U = uç yolu metre / tileLength; doku döşenir). renderer.material izde de çalışır.

## Özel veri (customData)
- { enabled, x, y, z, w: her biri [[t, değer]] ömür eğrisi (değer ≥ 0) } → UPE-SL'de i.custom (float4). Unreal: Dynamic Material
  Parameter (Particles.DynamicMaterialParameter). Örnek: x = yay açılması (i.uv.x < i.custom.x görünür), y = silinme.

## Alt emitter (subEmitters)
- { enabled, items: [{ emitter: hedef ad, trigger: death|birth, count:[min,max], inheritColor, inheritSize, inheritVelocity (0..1) }] } (en çok 4).
  Hedef emitter kendi yayımını yapmaz; olay başına count parçacığı olayın konumunda (şekli emitter dönüşüyle çevresinde) doğurur.
  Unreal: kaynakta Generate Death/Location Event, hedefte Event Handler (SpawnedParticles) + Receive modülü; miraslar olay yükünden.

## İpuçları
- Tek atımlık efekt: main.looping=false, emission.rateOverTime=0, bursts=[{time:0,count:[n,n]}], efekt duration ≈ en uzun ömür.
- Kıvılcım: stretched + spark + gravity 0.5–1.5 + drag. Alev: flame/soft + noise + alfa gradyanı. Duman: smoke + blend alpha.
- Turuncu-kırmızı = tehlike/öfke, mavi-gri = hüzün (Elarion renk dili). intensity 2–4 bloom ile parlar.
- Hazır şablonlar (add_emitter preset): ${Object.keys(PRESETS).join(', ')}.
`;
