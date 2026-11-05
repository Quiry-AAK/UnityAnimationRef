// Shader + Materyal şeması — editör (tarayıcı), MCP (Node), Unity HLSL üreticisi ve C# importer bu sözleşmeyi paylaşır.
// Shader kodu "UPE-SL" ile yazılır: Unity HLSL'inin bir alt kümesi. Unity'de kod olduğu gibi çalışır (lib/shader-hlsl.js
// URP şablonuna yerleştirir); editör aynı kodu GLSL'e çevirip önizler (public/shader-compile.js). DOM/three bağımlılığı yok.

export const SHADER_FORMAT = 'upe-shader-1';
export const MATERIAL_FORMAT = 'upe-material-1';
export const CUSTOM_PREFIX = 'UnityPreview/'; // özel shader'ların Unity adı: UnityPreview/<ad>

export const PROPERTY_TYPES = ['float', 'range', 'toggle', 'color', 'hdrColor', 'vector', 'texture'];
export const BUILTIN_TEXTURES = ['white', 'black', 'gray', 'bump']; // önizlemede üretilir; Unity'de shader varsayılanı
const BLENDS = ['opaque', 'alpha', 'additive', 'premultiply', 'multiply'];
const CULLS = ['back', 'front', 'off'];
const ZTESTS = ['lequal', 'less', 'equal', 'gequal', 'greater', 'notequal', 'always'];
const QUEUES = ['geometry', 'alphatest', 'transparent'];

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);
const str = (v, d = '') => (typeof v === 'string' ? v : d);
export const clone = (o) => JSON.parse(JSON.stringify(o));
const hexOk = (c) => typeof c === 'string' && /^#?[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(c.trim());
const normHex = (c, d) => { if (!hexOk(c)) return d; let s = c.trim().replace(/^#/, '').toLowerCase(); if (s.length === 3) s = s.split('').map((x) => x + x).join(''); return '#' + s; };
export const safeAssetName = (n) => String(n || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

// ── shader
export function defaultShader() {
  return {
    format: SHADER_FORMAT,
    name: 'yeni_shader',
    description: '',
    builtin: false, // true: mevcut bir Unity shader'ının önizleme portu (Unity'ye .shader yazılmaz)
    unityName: '', // builtin için Unity'deki adı; özelde otomatik UnityPreview/<ad>
    properties: [
      { name: '_BaseMap', type: 'texture', label: 'Doku', default: 'white', linear: false },
      { name: '_BaseColor', type: 'color', label: 'Renk', default: '#ffffff' },
    ],
    renderState: { blend: 'opaque', cull: 'back', zwrite: true, ztest: 'lequal', queue: 'geometry', queueOffset: 0 },
    lighting: { receiveShadows: true, castShadows: true },
    outline: { enabled: false, width: '_OutlineWidth', color: '_OutlineColor' }, // genişlik dünya metresi; özellik adları
    urpSurface: false, // true: blend/cull URP gibi materyal değerlerinden (_Surface, _Blend, _Cull, _AlphaClip, _Cutoff)
    code: {
      common: '', // yardımcı fonksiyonlar/sabitler (tüm pass'lerde)
      vertex: '', // opsiyonel: void vert(inout UPEVertex v) { ... }
      fragment: 'float4 frag(UPEInput i)\n{\n    float4 c = SAMPLE(_BaseMap, TRANSFORM_TEX(i.uv, _BaseMap)) * _BaseColor;\n    return c;\n}\n',
      outlineFragment: '', // opsiyonel: float4 outlineFrag(UPEInput i) — yoksa outline rengi düz basılır
    },
  };
}

export const shaderUnityName = (s) => (s.builtin ? s.unityName : CUSTOM_PREFIX + s.name);

function normProperty(p, warn, i) {
  if (!isObj(p)) { warn(`özellik ${i}: nesne değil`); return null; }
  const name = str(p.name).trim();
  if (!/^_?[A-Za-z][A-Za-z0-9_]*$/.test(name)) { warn(`özellik adı geçersiz: "${name}"`); return null; }
  const type = PROPERTY_TYPES.includes(p.type) ? p.type : (warn(`${name}: tip "${p.type}" geçersiz (${PROPERTY_TYPES.join('|')}), float sayıldı`), 'float');
  const o = { name, type, label: str(p.label, name.replace(/^_/, '')) };
  switch (type) {
    case 'float': o.default = num(p.default, 0); break;
    case 'range': o.min = num(p.min, 0); o.max = num(p.max, 1); if (o.max < o.min) [o.min, o.max] = [o.max, o.min]; o.default = Math.min(o.max, Math.max(o.min, num(p.default, o.min))); break;
    case 'toggle': o.default = !!p.default; break;
    case 'color': o.default = normHex(p.default, '#ffffff'); break;
    case 'hdrColor': { const d = isObj(p.default) ? p.default : { color: p.default }; o.default = { color: normHex(d.color, '#ffffff'), intensity: Math.max(0, num(d.intensity, 1)) }; break; }
    case 'vector': { const a = Array.isArray(p.default) ? p.default : []; o.default = [0, 1, 2, 3].map((k) => num(a[k], 0)); break; }
    case 'texture': o.default = str(p.default, 'white') || 'white'; o.linear = !!p.linear; break;
  }
  return o;
}

export function normalizeShader(input) {
  const warnings = []; const warn = (m) => warnings.push(m);
  const src = isObj(input) ? input : {}; const def = defaultShader();
  const s = {
    format: SHADER_FORMAT,
    name: safeAssetName(src.name) || def.name,
    description: str(src.description),
    builtin: !!src.builtin,
    unityName: '',
    properties: [],
    renderState: { ...def.renderState }, lighting: { ...def.lighting }, outline: { ...def.outline },
    urpSurface: !!src.urpSurface,
    code: { ...def.code },
  };
  s.unityName = s.builtin ? str(src.unityName).trim() : CUSTOM_PREFIX + s.name;
  if (s.builtin && !s.unityName) warn('builtin shader için unityName gerekli');
  const seen = new Set();
  (Array.isArray(src.properties) ? src.properties : src.properties === undefined ? def.properties : []).forEach((p, i) => {
    const o = normProperty(p, warn, i); if (!o) return;
    if (seen.has(o.name)) { warn(`özellik tekrarı atıldı: ${o.name}`); return; }
    seen.add(o.name); s.properties.push(o);
  });
  const rs = isObj(src.renderState) ? src.renderState : {};
  const pick = (v, list, d, w) => (v === undefined ? d : list.includes(v) ? v : (warn(`${w}: "${v}" geçersiz (${list.join('|')})`), d));
  s.renderState = {
    blend: pick(rs.blend, BLENDS, def.renderState.blend, 'renderState.blend'),
    cull: pick(rs.cull, CULLS, def.renderState.cull, 'renderState.cull'),
    zwrite: typeof rs.zwrite === 'boolean' ? rs.zwrite : (rs.blend && rs.blend !== 'opaque' ? false : true),
    ztest: pick(rs.ztest, ZTESTS, def.renderState.ztest, 'renderState.ztest'),
    queue: pick(rs.queue, QUEUES, rs.blend && rs.blend !== 'opaque' ? 'transparent' : 'geometry', 'renderState.queue'),
    queueOffset: Math.round(num(rs.queueOffset, 0)),
  };
  const li = isObj(src.lighting) ? src.lighting : {};
  s.lighting = { receiveShadows: li.receiveShadows !== false, castShadows: li.castShadows !== false && s.renderState.blend === 'opaque' };
  const ol = isObj(src.outline) ? src.outline : {};
  s.outline = { enabled: !!ol.enabled, width: str(ol.width, def.outline.width), color: str(ol.color, def.outline.color) };
  if (s.outline.enabled) for (const k of ['width', 'color']) if (!seen.has(s.outline[k])) warn(`outline.${k}: "${s.outline[k]}" özelliği yok`);
  const c = isObj(src.code) ? src.code : {};
  for (const k of Object.keys(def.code)) s.code[k] = typeof c[k] === 'string' ? c[k] : def.code[k];
  if (!/\bfrag\s*\(/.test(s.code.fragment)) warn('code.fragment içinde "float4 frag(UPEInput i)" yok');
  if (s.code.vertex.trim() && !/\bvert\s*\(/.test(s.code.vertex)) warn('code.vertex içinde "void vert(inout UPEVertex v)" yok');
  if (s.code.outlineFragment.trim() && !/\boutlineFrag\s*\(/.test(s.code.outlineFragment)) warn('code.outlineFragment içinde "float4 outlineFrag(UPEInput i)" yok');
  for (const k of Object.keys(src)) if (!(k in def)) warn(`bilinmeyen alan atıldı: ${k}`);
  return { shader: s, warnings };
}

// ── materyal
export const PREVIEW_TARGETS = ['sphere', 'cube', 'plane', 'capsule', 'torus', 'hero']; // + 'prop:<id>'
export function defaultMaterial() {
  return {
    format: MATERIAL_FORMAT,
    name: 'yeni_materyal',
    shader: 'Universal Render Pipeline/Lit', // Unity shader adı (builtin) ya da UnityPreview/<özel>
    values: {}, // özellik adı → değer (eksikler shader varsayılanı)
    renderQueue: -1, // -1: shader'ınki
    preview: { target: 'sphere', background: '#1a1d24', bloom: 0.6, rotate: true, showGrid: false },
  };
}

// değer biçimleri: color '#hex' ya da [r,g,b,a] (Unity gibi gamma, 1'i aşabilir) · hdrColor { color, intensity } · float/range sayı · toggle bool · vector [4]
// texture { tex: ad | '@mesh' | white/black/gray/bump, tiling:[x,y], offset:[x,y], unityPath?: 'Assets/...' }
export function normValue(p, v) {
  switch (p.type) {
    case 'float': return num(v, p.default);
    case 'range': return Math.min(p.max, Math.max(p.min, num(v, p.default)));
    case 'toggle': return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : p.default;
    case 'color': return Array.isArray(v) && v.length >= 3 ? [0, 1, 2, 3].map((k) => Math.max(0, num(v[k], k === 3 ? 1 : 0))) : normHex(v, p.default); // hex ya da [r,g,b,a] (gamma, 1'i aşabilir)
    case 'hdrColor': { const o = isObj(v) ? v : typeof v === 'string' ? { color: v } : {}; return { color: normHex(o.color, p.default.color), intensity: Math.max(0, num(o.intensity, p.default.intensity)) }; }
    case 'vector': { const a = Array.isArray(v) ? v : []; return [0, 1, 2, 3].map((k) => num(a[k], p.default[k])); }
    case 'texture': {
      const o = isObj(v) ? v : typeof v === 'string' ? { tex: v } : {};
      const t = { tex: str(o.tex, p.default).replace(/\.png$/i, '').replace(/[\\/:]+/g, '_') || p.default, tiling: [num(o.tiling?.[0], 1), num(o.tiling?.[1], 1)], offset: [num(o.offset?.[0], 0), num(o.offset?.[1], 0)] };
      if (typeof o.unityPath === 'string' && o.unityPath.startsWith('Assets/')) t.unityPath = o.unityPath;
      return t;
    }
  }
  return v;
}
export const propDefaultValue = (p) => normValue(p, undefined);

// shader verilirse değerler onun özelliklerine göre süzülür/tamamlanır (bilinmeyen değer atılır, uyarı)
export function normalizeMaterial(input, shader) {
  const warnings = []; const warn = (m) => warnings.push(m);
  const src = isObj(input) ? input : {}; const def = defaultMaterial();
  const m = { format: MATERIAL_FORMAT, name: safeAssetName(src.name) || def.name, shader: str(src.shader, def.shader).trim() || def.shader, values: {}, renderQueue: Math.round(num(src.renderQueue, -1)), preview: { ...def.preview } };
  const vals = isObj(src.values) ? src.values : {};
  if (shader) {
    const props = new Map(shader.properties.map((p) => [p.name, p]));
    for (const p of shader.properties) m.values[p.name] = normValue(p, vals[p.name]);
    for (const k of Object.keys(vals)) if (!props.has(k)) warn(`"${k}" bu shader'da yok (${m.shader}), atıldı`);
  } else { m.values = clone(vals); warn(`shader bulunamadı: ${m.shader}`); }
  const pv = isObj(src.preview) ? src.preview : {};
  const tgt = str(pv.target, def.preview.target);
  m.preview = {
    target: PREVIEW_TARGETS.includes(tgt) || /^prop:.+/.test(tgt) ? tgt : (warn(`preview.target "${tgt}" geçersiz`), def.preview.target),
    background: normHex(pv.background, def.preview.background),
    bloom: Math.max(0, Math.min(5, num(pv.bloom, def.preview.bloom))),
    rotate: typeof pv.rotate === 'boolean' ? pv.rotate : def.preview.rotate,
    showGrid: typeof pv.showGrid === 'boolean' ? pv.showGrid : def.preview.showGrid,
  };
  for (const k of Object.keys(src)) if (!(k in def)) warn(`bilinmeyen alan atıldı: ${k}`);
  return { material: m, warnings };
}

// ── sahne ışığı (tüm UPE shader'ları için; Unity ekseninde)
export function defaultLighting() {
  return { rotation: [50, 150, 0], color: '#fff4d6', intensity: 1, ambient: '#3a3f52', ambientIntensity: 1 }; // önden-üstten (önizleme kamerası tarafı)
}
export function normalizeLighting(l) {
  const d = defaultLighting(); const s = isObj(l) ? l : {};
  return { rotation: [0, 1, 2].map((k) => num(s.rotation?.[k], d.rotation[k])), color: normHex(s.color, d.color), intensity: Math.max(0, num(s.intensity, d.intensity)), ambient: normHex(s.ambient, d.ambient), ambientIntensity: Math.max(0, num(s.ambientIntensity, d.ambientIntensity)) };
}

// ── yol ile değişiklik ("values._RimPower", "preview.target", "code.fragment", "properties._RimPower.max", "renderState.blend")
const getPath = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function setPath(o, p, v) { const ks = String(p).split('.'); let a = o; for (const k of ks.slice(0, -1)) { if (!isObj(a[k])) a[k] = {}; a = a[k]; } a[ks.at(-1)] = v; }
export function applyMaterialChanges(mat, changes, shader) {
  const m = clone(mat); const errors = [];
  for (const c of changes || []) {
    const p = String(c.path || '');
    if (p.startsWith('values.')) { const k = p.slice(7).split('.')[0]; if (shader && !shader.properties.some((x) => x.name === k)) { errors.push(`özellik yok: ${k}`); continue; } setPath(m, p, c.value); }
    else if (['name', 'shader', 'renderQueue'].includes(p) || p.startsWith('preview.')) setPath(m, p, c.value);
    else errors.push(`materyal alanı yok: ${p}`);
  }
  const { material, warnings } = normalizeMaterial(m, shader);
  return { material, errors, warnings };
}
export function applyShaderChanges(sh, changes) {
  const s = clone(sh); const errors = [];
  for (const c of changes || []) {
    const p = String(c.path || '');
    const pm = /^properties\.([^.]+)(?:\.(.+))?$/.exec(p);
    if (pm) { // properties.<ad> (nesne ya da null=sil) · properties.<ad>.<alan>
      const i = s.properties.findIndex((x) => x.name === pm[1]);
      if (!pm[2]) { if (c.value === null) { if (i >= 0) s.properties.splice(i, 1); else errors.push(`özellik yok: ${pm[1]}`); } else { const o = { ...(i >= 0 ? s.properties[i] : {}), ...c.value, name: pm[1] }; if (i >= 0) s.properties[i] = o; else s.properties.push(o); } }
      else if (i < 0) errors.push(`özellik yok: ${pm[1]}`); else setPath(s.properties[i], pm[2], c.value);
    } else if (p === 'properties' && Array.isArray(c.value)) s.properties = c.value;
    else if (['name', 'description', 'builtin', 'unityName', 'urpSurface'].includes(p) || /^(code|renderState|lighting|outline)\./.test(p)) setPath(s, p, c.value);
    else errors.push(`shader alanı yok: ${p}`);
  }
  const { shader, warnings } = normalizeShader(s);
  return { shader, errors, warnings };
}

// base → cur farkı (kullanıcının editörde yaptığı değişiklikler)
export function diffObjects(base, cur) {
  const changes = [];
  const walk = (a, b, p) => {
    if (isObj(a) && isObj(b)) { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p ? p + '.' + k : k); return; }
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ path: p, from: a, to: b });
  };
  walk(base || {}, cur || {}, '');
  return changes;
}
export function diffShaders(base, cur) {
  const { properties: bp = [], ...b } = base || {}; const { properties: cp = [], ...c } = cur || {};
  const changes = diffObjects(b, c).map((x) => (x.path.startsWith('code.') ? { path: x.path, changed: true, from: undefined, to: x.to } : x));
  const bm = new Map(bp.map((p) => [p.name, p])), cm = new Map(cp.map((p) => [p.name, p]));
  for (const [n, p] of cm) if (!bm.has(n)) changes.push({ path: `properties.${n}`, added: p }); else changes.push(...diffObjects(bm.get(n), p).map((x) => ({ ...x, path: `properties.${n}.${x.path}` })));
  for (const n of bm.keys()) if (!cm.has(n)) changes.push({ path: `properties.${n}`, removed: true });
  return changes;
}

// ── MCP shader_reference / material_reference metni
export const SHADER_REFERENCE = `# UPE shader formatı (${SHADER_FORMAT})
Shader kodu **UPE-SL** ile yazılır = Unity HLSL'inin alt kümesi. Unity'de kod aynen URP şablonuna girer (UnityPreview/<ad>);
editör aynı kodu GLSL ES 3.0'a çevirip önizler. İkisinde de derlenen kod yaz:

## Alanlar
- name (dosya/Unity adı: UnityPreview/<name>), description
- properties: [{ name:'_RimColor', type, label, default, ... }] — tipler: float, range{min,max}, toggle (bool; Unity [ToggleUI]),
  color ('#rrggbb[aa]', sRGB), hdrColor ({color, intensity}; doğrusal = renk × intensity), vector ([4]), texture (default: white|black|gray|bump
  ya da doku adı; linear:true = veri dokusu, sRGB değil). Her texture için <ad>_ST (float4 tiling.xy offset.zw) da tanımlıdır.
  Özellikler kodda doğrudan değişken olarak kullanılır (color/hdrColor → float4, toggle → float 0/1, texture → SAMPLE ile).
- renderState: blend opaque|alpha|additive|premultiply|multiply, cull back|front|off, zwrite, ztest, queue geometry|alphatest|transparent, queueOffset
- lighting: receiveShadows, castShadows (yalnız opak)
- outline: { enabled, width:'<özellik>' (dünya metresi), color:'<özellik>' } — inverted hull ikinci pass (Cull Front)
- code.common: yardımcı fonksiyonlar/sabitler (tüm pass'ler) · code.vertex: void vert(inout UPEVertex v) (opsiyonel, tüm pass'ler)
- code.fragment: float4 frag(UPEInput i) (zorunlu) · code.outlineFragment: float4 outlineFrag(UPEInput i) (opsiyonel)

## Girdiler (hepsi Unity dünya ekseninde: +X sağ, +Y yukarı, +Z ileri; metre)
struct UPEVertex { float3 positionOS; float3 normalOS; float2 uv; float4 color; };   // nesne uzayı, deri (skinning) sonrası
struct UPEInput {
  float2 uv; float4 color;            // uv0 (TRANSFORM_TEX(i.uv, _Tex) ile tiling uygula), köşe rengi (yoksa 1)
  float3 positionWS; float3 normalWS; // normal normalize (arka yüzde çevrilmez; i.facing'e bak)
  float3 viewDirWS;                   // yüzeyden kameraya, normalize
  float4 positionCS; float2 screenUV; // xy piksel koordinatı; 0..1 ekran
  float3 lightDir; float3 lightColor; // ana ışığa DOĞRU, normalize; renk × şiddet (doğrusal)
  float shadow;                       // ana ışık gölgesi 0..1 (önizlemede gölge yok = 1)
  float3 ambient;                     // ortam ışığı (Unity: SampleSH(normalWS))
  float3 cameraRightWS; float3 cameraUpWS; float3 cameraPosWS;
  float time;                         // sn (_Time.y; _Time float4 de var)
  float facing;                       // ön yüz 1, arka yüz -1
  float4 custom;                      // VFX emitter customData eğrileri (x,y,z,w; ömür boyu); yoksa 0 · Unity'de 0
};

## Makrolar / yardımcılar
SAMPLE(_Tex, uv) · SAMPLE_LOD(_Tex, uv, lod) · TRANSFORM_TEX(uv, _Tex) · splat2/3/4(x) (skaleri vektöre yay) · clip(x) · PI
HLSL yerlileri kullanılabilir: lerp, saturate, frac, step, smoothstep, pow, dot, cross, normalize, length, abs, floor, fmod, atan2, rsqrt, ddx/ddy.

## Kurallar (iki dilde de derlensin diye)
- Ondalık sabitleri noktalı yaz (2.0); tamsayı sabit yalnız dizi indeksi, int/uint işlemleri ve döngü sayacında. (Çevirici çoğunu düzeltir ama güvenme.)
- C tipi cast YOK: (float3)x yerine float3(...) ya da splat3(x); uint2(x) gibi kurucu kullan.
- Tek argümanlı vektör kurucusu YOK (float3(0.0) HLSL'de geçersiz) → splat3(0.0) ya da float3(0.0, 0.0, 0.0).
- Vektör ternary (a ? b : c, vektör koşul) YOK → lerp/step. Matris kurucusu YOK. Doku yalnız SAMPLE/SAMPLE_LOD ile.
- Diziler: static const float k[4] = { 1.0, 2.0, 3.0, 4.0 }; (çevirici GLSL dizi kurucusuna çevirir).
- [unroll]/[loop] gibi öznitelikler serbest (GLSL'de silinir). #define/#if serbest.
- clip()/discard varsa Unity'de derinlik ve gölge pass'leri de frag()'ı çağırıp aynı kesmeyi uygular (delikler gölgede de delik).
  Önizlemede gölge yok; i.shadow her zaman 1.

## Hazır shader'lar (builtin: mevcut Unity shader'larının önizleme portu, Unity'ye .shader yazılmaz)
Elarion/ToonCharacter (oyunun kahraman shader'ı), Universal Render Pipeline/Lit (yaklaşık PBR), .../Unlit, .../Particles/Unlit.
Özel shader'lar UnityPreview/<ad> olarak Unity'ye .shader dosyası gider.
`;

export const MATERIAL_REFERENCE = `# UPE materyal formatı (${MATERIAL_FORMAT})
- name (Unity: Assets/UnityPreview/Materials/<name>.mat), shader (Unity shader adı: builtin ya da UnityPreview/<özel>), renderQueue (-1 = shader'ınki)
- values: özellik adı → değer. color '#rrggbb[aa]' (sRGB) ya da [r,g,b,a] (Unity materyalindeki gamma değerleri, 1'i aşabilir) · hdrColor {color, intensity} · float/range sayı · toggle bool · vector [x,y,z,w]
  · texture { tex: ad (materials/textures/<ad>.png) | white|black|gray|bump | '@mesh' (önizleme nesnesinin kendi dokusu),
    tiling:[x,y], offset:[x,y], unityPath?: 'Assets/...' (Unity'de bu doku kullanılır; '@mesh' için gerekli) }
- preview: { target: sphere|cube|plane|capsule|torus|hero|prop:<id>, background, bloom, rotate (döner tabla), showGrid }
- URP Lit/Unlit/Particles: yüzey ayarı materyal değerleriyle: _Surface (0 opak, 1 saydam), _Blend (0 alfa, 1 premultiply, 2 additive, 3 multiply),
  _Cull (0 kapalı, 1 ön, 2 arka), _AlphaClip + _Cutoff.
- Işık (tüm UPE shader'ları için ortak sahne ışığı): rotation (Unity yönlü ışık Euler'i), color, intensity, ambient, ambientIntensity.
- Kahramana/eşyaya giydirme (assign_material) yalnız önizlemedir; tüm modlarda (animasyon/VFX) görünür. Unity'deki prefab'a bağlamak ayrı iş.
- VFX parçacığı: kaydedilmiş materyal bir emitter'ın renderer.material alanına yazılır (update_vfx); parçacık o shader'la çizilir ve
  send_vfx_to_unity materyali de gönderip prefab'daki ParticleSystemRenderer'a bağlar. Parçacıkta i.color = parçacık rengi (doğrusal),
  i.uv = quad/flipbook UV'si; saydam için _Surface 1 (URP) ya da renderState.blend alpha/additive + zwrite false, iki yüz için cull off.
`;
