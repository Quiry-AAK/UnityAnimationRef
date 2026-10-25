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
    renderer: { mode: 'billboard', alignment: 'view', material: '', texture: 'soft', blend: 'additive', intensity: 1, lengthScale: 2, velocityScale: 0, sortingOrder: 0 },
  };
}

export function defaultEffect() {
  return {
    format: VFX_FORMAT,
    name: 'vfx',
    duration: 2, // önizleme döngüsü (sn); Unity'de kök ParticleSystem'in süresi
    loop: true, // önizlemede tekrar oynat
    attach: { target: 'none', name: '', position: v3(), rotation: v3() }, // target: none | bone | prop
    preview: { withAnimation: false, startFrame: 0, background: '#0d1018', bloom: 0.8, showHero: true, showGrid: true },
    emitters: [{ ...defaultEmitter(), name: 'emitter' }],
  };
}

// ── UI + doğrulama için alan tanımları: [anahtar, tip, etiket, seçenekler]
// tipler: num, int, range ([min,max]), vec3, bool, enum, color2, gradient, curve, bursts, texture
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
  { key: 'renderer', label: 'Görünüm', always: true, fields: [
    ['mode', 'enum', 'Mod', { options: [['billboard', 'Billboard (kameraya bakar)'], ['stretched', 'Hıza göre uzar'], ['horizontal', 'Yatay (yere paralel)'], ['vertical', 'Dikey (Y ekseninde döner)']] }],
    ['alignment', 'enum', 'Hizalama (billboard)', { options: [['view', 'Kameraya bakar (View)'], ['local', 'Emitter dönüşüne göre (Local, 3B)']] }],
    ['material', 'material', 'Materyal (kütüphaneden)'],
    ['texture', 'texture', 'Doku'],
    ['blend', 'enum', 'Karışım', { options: [['additive', 'Toplamalı (ışık)'], ['alpha', 'Alfa (duman)']] }],
    ['intensity', 'num', 'Parlaklık (HDR, bloom)', { min: 0, max: 20, step: 0.05 }],
    ['lengthScale', 'num', 'Uzama: boyut çarpanı', { min: 0, max: 20, step: 0.05 }],
    ['velocityScale', 'num', 'Uzama: hız çarpanı', { min: 0, max: 5, step: 0.01 }],
    ['sortingOrder', 'int', 'Çizim sırası', { min: -100, max: 100, step: 1 }],
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
  }
  const list = Array.isArray(src.emitters) ? src.emitters : src.emitters === undefined ? def.emitters : [];
  const used = new Set();
  list.forEach((em, i) => {
    const out = normalizeEmitter(em, warn, i);
    let n = out.name; let k = 2; while (used.has(n)) n = `${out.name}_${k++}`;
    if (n !== out.name) warn(`emitter adı çakıştı: "${out.name}" → "${n}"`);
    out.name = n; used.add(n); e.emitters.push(out);
  });
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
- preview: { withAnimation (animasyonla birlikte oynat), startFrame (efekt animasyonun bu karesinde başlar), background, bloom (0 kapalı), showHero, showGrid }
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
- renderer: mode billboard|stretched|horizontal|vertical, texture (${Object.keys(TEXTURES).join(', ')} ya da vfx/textures/<ad>.png için <ad>),
  blend additive|alpha, intensity (HDR çarpanı, >1 bloom verir), lengthScale + velocityScale (stretched uzunluğu = boyut·lengthScale + hız·velocityScale), sortingOrder
- renderer.material: kütüphaneden materyal adı (materials/<ad>.json, list_materials; '' = yok). Doluysa parçacık o materyalin
  shader'ı ve değerleriyle çizilir; texture/blend/intensity YOK SAYILIR (doku, karışım, parlaklık materyalden gelir). Shader'da
  i.color = parçacık rengi (startColor × colorOverLifetime, doğrusal), i.uv = quad UV'si (flipbook açıksa o anki kare),
  vert()'teki v.positionOS = köşenin DÜNYA konumu (Unity'de parçacık köşeleri dünyada, nesne matrisi birim), v.normalOS = quad normali.
  Hazır URP Particles/Unlit (urp_particles_unlit) ya da özel UPE-SL shader olabilir; send_vfx_to_unity materyali (ve özel shader'ını) da gönderir.

## İpuçları
- Tek atımlık efekt: main.looping=false, emission.rateOverTime=0, bursts=[{time:0,count:[n,n]}], efekt duration ≈ en uzun ömür.
- Kıvılcım: stretched + spark + gravity 0.5–1.5 + drag. Alev: flame/soft + noise + alfa gradyanı. Duman: smoke + blend alpha.
- Turuncu-kırmızı = tehlike/öfke, mavi-gri = hüzün (Elarion renk dili). intensity 2–4 bloom ile parlar.
- Hazır şablonlar (add_emitter preset): ${Object.keys(PRESETS).join(', ')}.
`;
