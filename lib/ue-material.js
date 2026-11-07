// UPE materyali (UPE-SL shader + değerler) → Unreal materyali (docs/UNREAL.md "Aşama 2: materyaller").
// Sahibi: Unreal dönüştürücü işi. lib/unreal-vfx.js emitter'ın renderer.material alanı doluysa bunu kullanır.
//
// Yaklaşım: shader başına bir UE Material (M_UPE_<shader>, Unlit, blend/cull shader render durumundan), gövdesi tek bir
// Custom (HLSL) düğümü. UPE-SL kodu Custom düğümünde yerel bir struct'ın (UPEShader) içine girer: özellikler struct üyesi,
// common'daki yardımcılar ve frag() üye fonksiyon olur (Custom düğümüne global fonksiyon yazılamadığı için bilinen yol).
// UPEInput alanları UE ifadelerinden (TexCoord, ParticleColor, WorldPosition, VertexNormalWS, CameraVectorWS, Time, …)
// Custom girdileriyle doldurulur ve Unity eksenine/birimine çevrilir: Unity = UE.yzx (konum ayrıca cm → m).
// Doku örnekleme UE sözdizimine çevrilir: SAMPLE(t, uv) → Texture2DSample(t, tSampler, UPE_FlipV(uv)) (Unity v yukarı,
// UE v aşağı). Kullanıcı bölümlerinin önüne `#line 1 "upe_<bölüm>"` konur: derleyici hatası bölüm + satır ile döner.
// Materyal başına MI_UPE_<materyal> (sprite) / MI_UPE_<materyal>_Ribbon (ribbon: UV düzeni farklı) örneği.
// Saf kısım (çözümleme, çeviri, değerler, plan) editörsüz test edilir; yürütme ensureUEMaterial().
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normalizeShader, normalizeMaterial, safeAssetName, CUSTOM_PREFIX } from '../public/shader-schema.js';
import { BUILTIN_SHADERS } from '../public/shader-builtins.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MATERIALS_DIR = path.resolve(HERE, '../materials');
export const DEFAULT_SHADERS_DIR = path.resolve(HERE, '../shaders');
export const SHADERS_PATH = '/Game/UPE/Shaders';
export const MATERIALS_PATH = '/Game/UPE/Materials';
export const MAT_TEXTURES_PATH = '/Game/UPE/Materials/Textures';

const MT = 'editor_toolset.toolsets.material.MaterialTools';
const MIT = 'editor_toolset.toolsets.material_instance.MaterialInstanceTools';
const OT = 'editor_toolset.toolsets.object.ObjectTools';

// Önizlemede üretilen özel doku adları → motor dokuları
export const ENGINE_TEXTURES = {
  white: '/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture',
  black: '/Engine/EngineResources/Black.Black',
  gray: '/Engine/EngineResources/Gray.Gray',
  grey: '/Engine/EngineResources/Gray.Gray',
  bump: '/Engine/EngineMaterials/DefaultNormal.DefaultNormal',
};

// ───────────────────────────── yardımcılar (saf)
const lc = (s) => String(s ?? '').trim().toLowerCase();
const ueName = (s, fb) => { // ASCII güvenli varlık adı (unreal-vfx safeName ile aynı kurallar)
  const tr = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ü: 'u', Ü: 'U', ö: 'o', Ö: 'O', ç: 'c', Ç: 'C' };
  const out = String(s || '').replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => tr[c]).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return out || fb;
};
const fmt = (n) => { const v = Number.isFinite(n) ? n : 0; if (Math.abs(v) < 1e-9) return '0.0'; const s = String(+v.toPrecision(7)); return /[.e]/.test(s) ? s : s + '.0'; };
// Unity GammaToLinearSpaceExact (1'in üstü pow 2.2; lib/shader-hlsl.js ile aynı)
const g2l = (v) => (v <= 0.04045 ? v / 12.92 : v < 1 ? Math.pow((v + 0.055) / 1.055, 2.4) : Math.pow(v, 2.2));
function hexRgba(hex) {
  let s = String(hex || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return [1, 1, 1, 1];
  const b = (i) => parseInt(s.slice(i, i + 2), 16) / 255;
  return [b(0), b(2), b(4), s.length === 8 ? b(6) : 1];
}
// Materyal değeri (gamma) → doğrusal LinearColor (Unity Linear proje gibi; alfa çevrilmez)
export function colorToLinear(v) {
  const c = Array.isArray(v) ? [0, 1, 2, 3].map((k) => (Number.isFinite(v[k]) ? v[k] : k === 3 ? 1 : 0)) : hexRgba(v);
  return [g2l(c[0]), g2l(c[1]), g2l(c[2]), c[3]];
}

// ───────────────────────────── kütüphane: materyal + shader çözümleme (server.js resolveShader ile aynı kurallar)
const BUILTINS = BUILTIN_SHADERS.map((s) => normalizeShader(s).shader);
const builtinOf = (n) => { const k = lc(n); return (k && BUILTINS.find((s) => lc(s.name) === k || lc(s.unityName) === k)) || null; };
const customBase = (n) => { const s = String(n ?? '').trim().replace(/\.json$/i, ''); return safeAssetName(lc(s).startsWith(lc(CUSTOM_PREFIX)) ? s.slice(CUSTOM_PREFIX.length) : s); };

export function createMaterialLibrary({ materialsDir = DEFAULT_MATERIALS_DIR, shadersDir = DEFAULT_SHADERS_DIR } = {}) {
  const shaders = new Map(), materials = new Map();
  const shader = (n) => {
    const b = builtinOf(n); if (b) return b;
    const base = customBase(n); if (!base) return null;
    if (!shaders.has(base)) {
      const f = path.join(shadersDir, base + '.json');
      shaders.set(base, fs.existsSync(f) ? normalizeShader({ ...JSON.parse(fs.readFileSync(f, 'utf8')), name: base, builtin: false }).shader : null);
    }
    return shaders.get(base);
  };
  // → { material, shader, warnings } ; yoksa hata
  const material = (n) => {
    const base = safeAssetName(String(n ?? '').replace(/\.json$/i, ''));
    if (!materials.has(base)) {
      const f = path.join(materialsDir, base + '.json');
      if (!base || !fs.existsSync(f)) throw new Error(`materyal "${n}" kütüphanede yok (${f})`);
      const raw = { ...JSON.parse(fs.readFileSync(f, 'utf8')), name: base };
      const sh = shader(raw.shader);
      if (!sh) throw new Error(`materyal "${base}": shader "${raw.shader}" bulunamadı (shaders/ ya da hazırlar)`);
      const { material: m, warnings } = normalizeMaterial(raw, sh);
      materials.set(base, { material: m, shader: sh, warnings });
    }
    return materials.get(base);
  };
  return { shader, material, builtins: BUILTINS };
}

// ───────────────────────────── render durumu
const UE_BLEND = { opaque: 'BLEND_Opaque', alpha: 'BLEND_Translucent', additive: 'BLEND_Additive', premultiply: 'BLEND_AlphaComposite', multiply: 'BLEND_Modulate' };
// shader.renderState ya da URP yüzey değerleri (_Surface/_Blend/_Cull; shader-compile renderStateOf ile aynı)
export function renderStateFor(shader, values) {
  const rs = { ...shader.renderState };
  if (shader.urpSurface) {
    const surf = +(values?._Surface ?? 0), bl = +(values?._Blend ?? 0), cu = +(values?._Cull ?? 2);
    rs.blend = surf < 0.5 ? 'opaque' : ['alpha', 'premultiply', 'additive', 'multiply'][Math.round(bl)] || 'alpha';
    rs.cull = ['off', 'front', 'back'][Math.round(cu)] || 'back'; rs.zwrite = surf < 0.5;
  }
  return rs;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);
// Ana materyal adı: shader başına; URP yüzey modlu hazırlarda blend materyal değerinden geldiği için blend+cull de ada girer
export function baseMaterialName(shader, rs, { distortion = false, soft = false, decal = false } = {}) {
  const n = `M_UPE_${ueName(shader.name, 'shader')}`;
  if (distortion) return `${n}_Distort`; // bükülme: blend materyalden gelmez (her zaman Translucent + SceneColor)
  if (decal) return `${n}_Decal${rs.blend === 'additive' || rs.blend === 'premultiply' ? '_Add' : ''}`; // Deferred Decal alanı
  if (soft) return `${baseMaterialName(shader, rs)}_Soft`; // DepthFade'li varyant
  return shader.urpSurface ? `${n}_${cap(rs.blend)}${rs.cull === 'off' ? '_2S' : ''}` : n;
}

// ───────────────────────────── UPE-SL → UE Custom HLSL (saf)
// TRANSFORM_TEX(uv, _Tex) → ((uv) * _Tex_ST.xy + _Tex_ST.zw) — ilk argüman parantez/virgül içerebilir
function expandTransformTex(s) {
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf('TRANSFORM_TEX', i); if (j < 0) return out + s.slice(i);
    const k = s.indexOf('(', j); if (k < 0 || s.slice(j + 13, k).trim() || /\w/.test(s[j - 1] || '')) { out += s.slice(i, j + 13); i = j + 13; continue; }
    let d = 0, comma = -1, e = k;
    for (; e < s.length; e++) { const c = s[e]; if (c === '(') d++; else if (c === ')') { d--; if (!d) break; } else if (c === ',' && d === 1) comma = e; }
    if (comma < 0 || e >= s.length) { out += s.slice(i, k + 1); i = k + 1; continue; }
    const uv = expandTransformTex(s.slice(k + 1, comma)), name = s.slice(comma + 1, e).trim();
    out += s.slice(i, j) + `((${uv.trim()}) * ${name}_ST.xy + ${name}_ST.zw)`; i = e + 1;
  }
}
// çağrı argümanlarını parantez derinliğiyle ayır: s[k] = '(' → { args, end }
function splitCall(s, k) {
  let d = 0, last = k + 1; const args = [];
  for (let e = k; e < s.length; e++) {
    const c = s[e];
    if (c === '(') d++;
    else if (c === ')') { d--; if (!d) { args.push(s.slice(last, e)); return { args, end: e }; } }
    else if (c === ',' && d === 1) { args.push(s.slice(last, e)); last = e + 1; }
  }
  return null;
}
// SAMPLE(t, uv) / SAMPLE_LOD(t, uv, lod) → UE doku örneklemesi (iç içe çağrılar da çevrilir)
export function convertSampling(s, warn = () => {}) {
  let out = '', i = 0;
  const re = /\bSAMPLE(_LOD)?\s*\(/g;
  for (let m; (m = re.exec(s));) {
    if (m.index < i) continue;
    const k = m.index + m[0].length - 1;
    const call = splitCall(s, k);
    if (!call) { warn('SAMPLE çağrısı kapanmıyor'); break; }
    const a = call.args.map((x) => convertSampling(x, warn).trim());
    const lod = !!m[1];
    if (a.length !== (lod ? 3 : 2)) warn(`SAMPLE${lod ? '_LOD' : ''}: argüman sayısı ${a.length}`);
    const t = a[0];
    out += s.slice(i, m.index) + (lod ? `Texture2DSampleLevel(${t}, ${t}Sampler, UPE_FlipV(${a[1]}), ${a[2]})` : `Texture2DSample(${t}, ${t}Sampler, UPE_FlipV(${a[1]}))`);
    i = call.end + 1; re.lastIndex = i;
  }
  return out + s.slice(i);
}

// UE material şablonunda/Custom düğümünde çakışan adlar (özellik adı bunlardan biriyse derleme bozulur)
const UE_RESERVED = new Set(['Parameters', 'View', 'ResolvedView', 'Primitive', 'Material', 'S', 'upeIn', 'upeUV', 'upeC', 'UPEShader', 'UPEInput', 'UPEVertex',
  'UPE_UV', 'UPE_VC', 'UPE_T', 'UPE_WP', 'UPE_N', 'UPE_V', 'UPE_CP', 'UPE_SUV', 'UPE_FACE', 'UPE_Ribbon', 'UPE_FlipV', 'frag', 'vert', 'outlineFrag',
  'splat2', 'splat3', 'splat4', 'PI', 'LocalVertexFactory']);

// Custom düğümünün UE ifadesi girdileri: [girdi adı, ifade sınıfı, çıkış pini, UPEInput alanını kullanan regex]
const SCENE_INPUTS = [
  ['UPE_UV', 'MaterialExpressionTextureCoordinate', '', /\.uv\b/],
  ['UPE_VC', 'MaterialExpressionParticleColor', 'RGBA', /\.color\b/],
  ['UPE_T', 'MaterialExpressionTime', '', /\.time\b|\b_Time\b/],
  ['UPE_WP', 'MaterialExpressionWorldPosition', '', /\.positionWS\b/],
  ['UPE_N', 'MaterialExpressionVertexNormalWS', '', /\.normalWS\b/],
  ['UPE_V', 'MaterialExpressionCameraVectorWS', '', /\.viewDirWS\b/],
  ['UPE_CP', 'MaterialExpressionCameraPositionWS', '', /\.cameraPosWS\b/],
  ['UPE_SUV', 'MaterialExpressionScreenPosition', 'ViewportUV', /\.screenUV\b/],
  ['UPE_FACE', 'MaterialExpressionTwoSidedSign', '', /\.facing\b/],
  ['UPE_SD', 'MaterialExpressionSceneDepth', '', /\.sceneDepth\b/],
];

// shader (normalizeShader çıktısı) → { code, inputs, params, blend, blendMode, twoSided, disableDepthTest, hash, warnings }
//   inputs: [{ name, node: { class, output } | { param } }] — Custom düğümü girdileri sırayla
//   params: [{ name, kind: 'scalar'|'vector'|'texture', default, linear? }] — UE materyal parametreleri (özellik adlarıyla aynı)
// distortion: emitter renderer.blend = 'distortion' → frag() çıkışı rg = ekran ofseti yönü, a = maske (vfx-sim/shader-compile ile aynı);
// Custom çıkışı float4(ofset.x, −ofset.y (UE ekran y aşağı), maske, 0) → wireDistortionOutput (SceneColor + OffsetFraction)
// soft: renderer.softParticles → DepthFade (FadeDistance = UPE_SoftDistance cm) → i.softFade, çıkış alfası çarpılır (vfx-sim ile aynı)
// decal: renderer.mode decal → MD_DeferredDecal; renk DecalColor'dan (Niagara Decal renderer Particles.Color), UV izin UV'si
export function translateShaderForUE(shader, { values, distortion = false, soft = false, decal = false } = {}) {
  const warnings = []; const warn = (m) => warnings.push(m);
  const rs = renderStateFor(shader, values);
  const code = shader.code || {};
  const prep = (src, sec) => convertSampling(expandTransformTex(String(src || '').replace(/\r\n?/g, '\n')), (m) => warn(`${sec}: ${m}`));
  const common = prep(code.common, 'common'), fragment = prep(code.fragment, 'fragment');
  if (!/\bfrag\s*\(/.test(fragment)) warn('fragment: "float4 frag(UPEInput i)" yok');
  if (String(code.vertex || '').trim()) warn('code.vertex (vert) Unreal\'de uygulanmadı: köşe değişikliği (World Position Offset) karşılığı yok');
  if (shader.outline?.enabled) warn('outline (inverted hull ikinci pass) Unreal\'de yok sayıldı');
  const all = common + '\n' + fragment;
  if (/\.(lightDir|lightColor|shadow|ambient)\b/.test(all)) warn('ışık girdileri (lightDir/lightColor/shadow/ambient) Unlit UE materyalinde sabit: ışık yukarıdan beyaz, gölge yok, ortam 0 (Lit/Toon yaklaşık)');
  if (/\.positionCS\b/.test(all)) warn('positionCS: UE SvPosition (piksel, sol üst köken) — Unity ile y yönü farklı olabilir');
  if (/\bstatic\s+const\b/.test(common + fragment)) warn('static const: struct üyesi olarak derlenir; derlenmezse #define kullan');

  // ── parametreler
  const params = [];
  for (const p of shader.properties) {
    if (UE_RESERVED.has(p.name)) warn(`özellik adı "${p.name}" UE/Custom adıyla çakışıyor, derleme bozulabilir`);
    switch (p.type) {
      case 'float': case 'range': params.push({ name: p.name, kind: 'scalar', hlsl: 'float', default: p.default }); break;
      case 'toggle': params.push({ name: p.name, kind: 'scalar', hlsl: 'float', default: p.default ? 1 : 0 }); break;
      case 'color': params.push({ name: p.name, kind: 'vector', hlsl: 'float4', default: colorToLinear(p.default) }); break;
      case 'hdrColor': { const c = colorToLinear(p.default.color), k = p.default.intensity; params.push({ name: p.name, kind: 'vector', hlsl: 'float4', default: [c[0] * k, c[1] * k, c[2] * k, c[3]] }); break; }
      case 'vector': params.push({ name: p.name, kind: 'vector', hlsl: 'float4', default: [...p.default] }); break;
      case 'texture': {
        const def = ENGINE_TEXTURES[lc(p.default)];
        if (!def) warn(`${p.name}: varsayılan doku "${p.default}" → white (materyal değeri atar)`);
        if (lc(p.default) === 'bump') warn(`${p.name}: bump → DefaultNormal (BC5; z kanalı Unity paketli normalden farklı)`);
        params.push({ name: p.name, kind: 'texture', hlsl: 'Texture2D', default: def || ENGINE_TEXTURES.white, linear: !!p.linear });
        params.push({ name: p.name + '_ST', kind: 'vector', hlsl: 'float4', default: [1, 1, 0, 0] });
        break;
      }
    }
  }
  params.push({ name: 'UPE_Ribbon', kind: 'scalar', hlsl: 'float', default: 0, internal: true });
  if (distortion) params.push({ name: 'UPE_DistortStrength', kind: 'scalar', hlsl: 'float', default: 0.03, internal: true });
  if (soft) params.push({ name: 'UPE_SoftDistance', kind: 'scalar', hlsl: 'float', default: 30, internal: true, noInput: true });

  // ── Custom girdileri: sahne ifadeleri (kullanılanlar) + parametreler
  const inputs = [];
  for (const [name, cls, output, re] of SCENE_INPUTS) if (re.test(all) || name === 'UPE_UV' || name === 'UPE_VC') inputs.push({ name, node: name === 'UPE_VC' && decal ? { class: 'MaterialExpressionDecalColor', output: '' } : { class: cls, output } });
  if (soft) inputs.push({ name: 'UPE_DF', node: { class: 'MaterialExpressionDepthFade', output: '', connect: { FadeDistance: 'UPE_SoftDistance' } } });
  if (decal && /\.sceneDepth\b/.test(all)) warn('decal: i.sceneDepth decal alanında yüzeyin kendi derinliği');
  const usesCustom = /\.custom\b/.test(all); // VFX customData → Dynamic Parameter (Niagara Particles.DynamicMaterialParameter)
  // DynamicParameter çıkış adları R/G/B/A (görünen Param1..4 değil; ilki '' = R) — editörde doğrulandı (2026-11-06)
  if (usesCustom) for (let k = 0; k < 4; k++) inputs.push({ name: `UPE_CUS${k}`, node: { class: 'MaterialExpressionDynamicParameter', output: ['', 'G', 'B', 'A'][k] } });
  for (const p of params) if (!p.noInput) inputs.push({ name: p.name, node: { param: p.name, kind: p.kind } });
  const has = (n) => inputs.some((x) => x.name === n);

  // ── kod
  const members = shader.properties.flatMap((p) => (p.type === 'texture' ? [`Texture2D ${p.name}; SamplerState ${p.name}Sampler; float4 ${p.name}_ST;`]
    : [`${['color', 'hdrColor', 'vector'].includes(p.type) ? 'float4' : 'float'} ${p.name};`]));
  const assigns = shader.properties.flatMap((p) => (p.type === 'texture' ? [`S.${p.name} = ${p.name}; S.${p.name}Sampler = ${p.name}Sampler; S.${p.name}_ST = ${p.name}_ST;`] : [`S.${p.name} = ${p.name};`]));
  const sf = soft ? ' * upeIn.softFade' : '';
  const fin = distortion ? 'float4(upeC.r * upeC.a * UPE_DistortStrength, -upeC.g * upeC.a * UPE_DistortStrength, step(0.002, upeC.a), 0.0)' // UPE gibi: maskeli pikselde opaklık 1 (önizleme discard < 0,002, yoksa sahneyi tam yazar)
    : decal && (rs.blend === 'additive' || rs.blend === 'premultiply') ? `float4(upeC.rgb${rs.blend === 'additive' ? ' * upeC.a' : ''}, 0.0)` // AlphaComposite: opaklık 0 = toplama
    : { alpha: `float4(upeC.rgb, upeC.a${sf})`, premultiply: `upeC${sf}`, opaque: 'upeC', multiply: 'upeC', additive: `float4(upeC.rgb * upeC.a${sf}, upeC.a${sf})` }[rs.blend] || 'upeC';
  const lines = [
    '// UPE: Unity Preview Editor\'den üretildi (lib/ue-material.js) — elle değiştirme, UPE\'de düzenleyip yeniden gönder.',
    'struct UPEVertex { float3 positionOS; float3 normalOS; float2 uv; float4 color; };',
    'struct UPEInput {',
    '  float2 uv; float4 color; float3 positionWS; float3 normalWS; float3 viewDirWS; float4 positionCS; float2 screenUV;',
    '  float3 lightDir; float3 lightColor; float shadow; float3 ambient; float3 cameraRightWS; float3 cameraUpWS; float3 cameraPosWS;',
    '  float time; float facing; float4 custom; float sceneDepth; float softFade;',
    '};',
    'struct UPEShader {',
    '  float4 _Time;',
    ...members.map((m) => '  ' + m),
    '  float2 splat2(float x) { return float2(x, x); }',
    '  float3 splat3(float x) { return float3(x, x, x); }',
    '  float4 splat4(float x) { return float4(x, x, x, x); }',
    '  float2 UPE_FlipV(float2 u) { return float2(u.x, 1.0 - u.y); }',
    '#line 1 "upe_common"',
    common,
    '#line 1 "upe_fragment"',
    fragment,
    '#line 1 "upe_template"',
    '};',
    'UPEShader S;',
    has('UPE_T') ? 'S._Time = float4(UPE_T / 20.0, UPE_T, UPE_T * 2.0, UPE_T * 3.0);' : 'S._Time = float4(0.0, 0.0, 0.0, 0.0);',
    ...assigns,
    'UPEInput upeIn = (UPEInput)0;',
    // sprite: UE v aşağı → Unity v yukarı. ribbon: U = iz boyunca (0 yeni/baş → 1 eski/kuyruk), V = enine (kök → uç)
    'float2 upeUV = UPE_UV;',
    'upeIn.uv = lerp(float2(upeUV.x, 1.0 - upeUV.y), float2(upeUV.x, upeUV.y), UPE_Ribbon);',
    'upeIn.color = UPE_VC;',
    has('UPE_WP') ? 'upeIn.positionWS = UPE_WP.yzx * 0.01;' : '',
    has('UPE_N') ? 'upeIn.normalWS = normalize(UPE_N.yzx);' : 'upeIn.normalWS = float3(0.0, 0.0, -1.0);',
    has('UPE_V') ? 'upeIn.viewDirWS = normalize(UPE_V.yzx);' : 'upeIn.viewDirWS = float3(0.0, 0.0, -1.0);',
    /\.positionCS\b/.test(all) ? 'upeIn.positionCS = Parameters.SvPosition;' : '',
    has('UPE_SUV') ? 'upeIn.screenUV = float2(UPE_SUV.x, 1.0 - UPE_SUV.y);' : '',
    'upeIn.lightDir = float3(0.0, 1.0, 0.0); upeIn.lightColor = float3(1.0, 1.0, 1.0); upeIn.shadow = 1.0; upeIn.ambient = float3(0.0, 0.0, 0.0);',
    /\.camera(Right|Up)WS\b/.test(all) ? 'upeIn.cameraRightWS = normalize(ResolvedView.ViewToTranslatedWorld[0].xyz).yzx; upeIn.cameraUpWS = normalize(ResolvedView.ViewToTranslatedWorld[1].xyz).yzx;' : '',
    has('UPE_CP') ? 'upeIn.cameraPosWS = UPE_CP.yzx * 0.01;' : '',
    has('UPE_T') ? 'upeIn.time = UPE_T;' : '',
    has('UPE_FACE') ? 'upeIn.facing = UPE_FACE;' : 'upeIn.facing = 1.0;',
    usesCustom ? 'upeIn.custom = float4(UPE_CUS0, UPE_CUS1, UPE_CUS2, UPE_CUS3);' : '',
    has('UPE_SD') ? 'upeIn.sceneDepth = UPE_SD * 0.01;' : '',
    has('UPE_DF') ? 'upeIn.softFade = UPE_DF;' : 'upeIn.softFade = 1.0;',
    'float4 upeC = S.frag(upeIn);',
    `return ${fin};`,
  ].filter((l) => l !== '');
  const src = lines.join('\n');

  if (rs.cull === 'front') warn('cull front: UE\'de yok, iki yüzlü çizildi');
  const blendMode = distortion ? 'BLEND_Translucent' : decal ? (rs.blend === 'additive' || rs.blend === 'premultiply' ? 'BLEND_AlphaComposite' : 'BLEND_Translucent') : rs.blend === 'opaque' && /\bclip\s*\(|\bdiscard\b/.test(all) ? 'BLEND_Masked' : UE_BLEND[rs.blend] || 'BLEND_Translucent';
  if (rs.blend !== 'opaque' && rs.zwrite && !distortion) warn('zwrite: UE saydam materyali derinlik yazmaz');
  if (soft && rs.blend === 'opaque') warn('softParticles: opak materyalde DepthFade etkisiz');
  const out = { code: src, inputs, params, blend: distortion ? 'distortion' : rs.blend, blendMode, distortion, soft, decal, twoSided: distortion || rs.cull !== 'back', disableDepthTest: rs.ztest === 'always', warnings };
  out.hash = crypto.createHash('sha1').update(JSON.stringify([src, inputs, params, blendMode, out.twoSided, out.disableDepthTest, decal, 4])).digest('hex').slice(0, 12);
  return out;
}

// Yapısal denetim (editörsüz test): çevrilmemiş UPE makrosu, dengesiz parantez, eksik giriş
export function checkTranslation(tr) {
  const errs = [];
  const body = tr.code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  if (/\bSAMPLE(_LOD)?\s*\(/.test(body)) errs.push('SAMPLE çevrilmedi');
  if (/\bTRANSFORM_TEX\b/.test(body)) errs.push('TRANSFORM_TEX çevrilmedi');
  for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']]) {
    const n = (body.split(o).length - 1) - (body.split(c).length - 1); if (n) errs.push(`dengesiz ${o}${c} (${n})`);
  }
  if (!/return\s+[^;]+;\s*$/.test(body.trim())) errs.push('son satır return değil');
  const names = new Set(tr.inputs.map((x) => x.name));
  if (names.size !== tr.inputs.length) errs.push('girdi adı tekrarı');
  for (const n of names) if (!/^[A-Za-z_]\w*$/.test(n)) errs.push(`geçersiz girdi adı ${n}`);
  for (const p of tr.params) if (!p.noInput && !names.has(p.name)) errs.push(`parametre girdisi yok: ${p.name}`);
  for (const i of tr.inputs) for (const v of Object.values(i.node.connect || {})) if (!tr.params.some((p) => p.name === v)) errs.push(`${i.name}: bağlanan parametre yok: ${v}`);
  for (const m of body.matchAll(/\b(UPE_[A-Z]+\d?)\b/g)) if (/^UPE_(UV|VC|T|WP|N|V|CP|SUV|FACE|SD|DF|CUS\d)$/.test(m[1]) && !names.has(m[1])) errs.push(`kodda ${m[1]} var, girdi yok`);
  return errs;
}

// ───────────────────────────── materyal değerleri → MI parametreleri (saf)
// → { scalars: [{name, value}], vectors: [{name, value:[r,g,b,a]}], textures: [{name, tex, linear, engine?}], warnings }
export function materialParamValues(material, shader) {
  const warnings = []; const scalars = [], vectors = [], textures = [];
  for (const p of shader.properties) {
    const v = material.values[p.name] ?? p.default;
    switch (p.type) {
      case 'float': case 'range': scalars.push({ name: p.name, value: +v || 0 }); break;
      case 'toggle': scalars.push({ name: p.name, value: v ? 1 : 0 }); break;
      case 'color': vectors.push({ name: p.name, value: colorToLinear(v) }); break;
      case 'hdrColor': { const c = colorToLinear(v.color), k = v.intensity; vectors.push({ name: p.name, value: [c[0] * k, c[1] * k, c[2] * k, c[3]] }); break; }
      case 'vector': vectors.push({ name: p.name, value: [...v] }); break;
      case 'texture': {
        const tv = typeof v === 'object' ? v : { tex: v, tiling: [1, 1], offset: [0, 0] };
        let tex = tv.tex;
        if (tex === '@mesh') { warnings.push(`${p.name}: '@mesh' (önizleme nesnesinin dokusu) Unreal'de yok → white`); tex = 'white'; }
        const eng = ENGINE_TEXTURES[lc(tex)];
        textures.push(eng ? { name: p.name, tex, engine: eng } : { name: p.name, tex, linear: !!p.linear, asset: `T_UPE_${ueName(tex, 'tex')}` });
        vectors.push({ name: p.name + '_ST', value: [tv.tiling?.[0] ?? 1, tv.tiling?.[1] ?? 1, tv.offset?.[0] ?? 0, tv.offset?.[1] ?? 0] });
        break;
      }
    }
  }
  for (const x of vectors) if (x.value.some((c) => c < 0)) warnings.push(`${x.name}: negatif bileşen (${x.value.map(fmt).join(', ')}) MI'de 0'a kırpılabilir`);
  return { scalars, vectors, textures, warnings };
}

// ───────────────────────────── plan: emitter materyali (saf)
// kind: 'sprite' | 'ribbon' → { material, shader, base: { name, path, translation }, instance: { name, path }, values, warnings }
// opts.distortion: bükülme gücü (renderer.distortion.strength) → _Distort ana materyali + örneği; opts.mesh: Niagara mesh kullanımı
export function planEmitterMaterial(lib, materialName, kind = 'sprite', { distortion = null, mesh = false, soft = null, decal = false } = {}) {
  const { material, shader, warnings: mw } = lib.material(materialName);
  const warnings = mw.map((w) => `materyal ${material.name}: ${w}`);
  const dist = distortion !== null && distortion !== undefined;
  const isSoft = !dist && !decal && soft !== null && soft !== undefined;
  const tr = translateShaderForUE(shader, { values: material.values, distortion: dist, soft: isSoft, decal });
  const base = baseMaterialName(shader, renderStateFor(shader, material.values), { distortion: dist, soft: isSoft, decal });
  for (const w of tr.warnings) warnings.push(`shader ${shader.name}: ${w}`);
  if (shader.builtin) warnings.push(`shader ${shader.unityName}: hazır shader portu UPE-SL'den çevrildi${/Lit|Toon/i.test(shader.unityName) ? ' (Lit/Toon: ışıksız Unlit yaklaşık)' : ''}`);
  const vals = materialParamValues(material, shader);
  for (const w of vals.warnings) warnings.push(`materyal ${material.name}: ${w}`);
  const inst = `MI_UPE_${ueName(material.name, 'mat')}${kind === 'ribbon' ? '_Ribbon' : ''}${dist ? `_Distort_${Math.round(distortion * 1000)}` : ''}${isSoft ? `_Soft${Math.round(soft)}` : ''}${decal ? '_Decal' : ''}`;
  vals.scalars.push({ name: 'UPE_Ribbon', value: kind === 'ribbon' ? 1 : 0 });
  if (dist) vals.scalars.push({ name: 'UPE_DistortStrength', value: distortion });
  if (isSoft) vals.scalars.push({ name: 'UPE_SoftDistance', value: soft });
  return {
    material: material.name, shader: shader.name, kind, distortion: dist, mesh, soft: isSoft, decal,
    base: { name: base, path: `${SHADERS_PATH}/${base}.${base}`, translation: tr },
    instance: { name: inst, path: `${MATERIALS_PATH}/${inst}.${inst}` },
    values: vals, warnings,
  };
}

// ───────────────────────────── derleme hatası → okunur mesaj (bölüm + satır)
// UE çıktısı: "upe_fragment:2:183: error: use of undeclared identifier 'bogus'"
export function parseCompileErrors(msg) {
  const out = []; const seen = new Set();
  for (const m of String(msg).matchAll(/upe_(common|fragment|template)[:(](\d+)[:,](\d+)\)?:?\s*(?:[^\n]*?)?\berror\b[:\s]*([^\n]*)/g)) {
    const e = { section: m[1] === 'template' ? 'şablon' : m[1], line: +m[2], col: +m[3], message: m[4].trim() };
    const k = `${e.section}:${e.line}:${e.message}`; if (seen.has(k)) continue; seen.add(k); out.push(e);
  }
  if (!out.length) for (const m of String(msg).matchAll(/error[^\n]*/gi)) { const t = m[0].trim(); if (!seen.has(t) && !/Internal Error/i.test(t)) { seen.add(t); out.push({ section: '?', line: 0, message: t.slice(0, 300) }); } }
  return out;
}
export const formatCompileErrors = (errs) => errs.map((e) => `${e.section}${e.line ? ' satır ' + e.line + (e.col ? ':' + e.col : '') : ''}: ${e.message}`).join(' | ');

export class UEMaterialCompileError extends Error {
  constructor(base, shader, errors, raw) {
    super(`shader ${shader} → ${base} derlenmedi: ${formatCompileErrors(errors) || String(raw).slice(0, 400)}`);
    this.name = 'UEMaterialCompileError'; this.errors = errors; this.raw = raw;
  }
}

// ───────────────────────────── yürütme (MCP)
const ref = (p) => ({ refPath: p });
const pkg = (p) => p.replace(/\.[^/]*$/, '');

// ctx: { call(toolset, tool, args), exists(path) } (unreal-vfx Ctx). Ana materyal: yoksa kur; varsa Custom düğümünün
// Description'ındaki çeviri özeti farklıysa grafiği silip yeniden kur. → { path, created, rebuilt }
export async function ensureBaseMaterial(ctx, plan, shaderName) {
  const { name, path: objPath, translation: tr } = plan.base;
  const p = pkg(objPath);
  const stamp = `UPE ${tr.hash}`;
  let created = false;
  if (!(await ctx.exists(p))) { await ctx.call(MT, 'create_material', { folder_path: SHADERS_PATH, asset_name: name }); created = true; }
  const m = ref(objPath);
  const exprs = (await ctx.call(MT, 'get_expressions', { material_or_function: m })).returnValue || [];
  if (!created) {
    const cu = exprs.find((e) => /MaterialExpressionCustom_/.test(e.refPath));
    if (cu) {
      let d = (await ctx.call(OT, 'get_properties', { instance: cu, properties: ['Description'] })).returnValue;
      if (typeof d === 'string') d = JSON.parse(d);
      if (d?.Description === stamp) return { path: objPath, created: false, rebuilt: false };
    }
  }
  for (const e of exprs) await ctx.call(MT, 'delete_expression', { material_or_function: m, expression: e });
  const props = tr.decal ? { MaterialDomain: 'MD_DeferredDecal', BlendMode: tr.blendMode, ShadingModel: 'MSM_Unlit' }
    : { BlendMode: tr.blendMode, ShadingModel: 'MSM_Unlit', TwoSided: tr.twoSided, bUsedWithNiagaraSprites: true, bUsedWithNiagaraRibbons: true, bUsedWithNiagaraMeshParticles: true };
  if (tr.blendMode !== 'BLEND_Opaque' && tr.blendMode !== 'BLEND_Masked') props.bDisableDepthTest = tr.disableDepthTest;
  await ctx.call(OT, 'set_properties', { instance: m, values: JSON.stringify(props) });
  const add = async (cls, x, y) => (await ctx.call(MT, 'add_expression', { material_or_function: m, expression_class: ref('/Script/Engine.' + cls), x, y })).returnValue;
  const set = (inst, values) => ctx.call(OT, 'set_properties', { instance: inst, values: JSON.stringify(values) });
  const conn = (a, ao, b, bi) => ctx.call(MT, 'connect_expressions', { from_expression: a, from_output_name: ao, to_expression: b, to_input_name: bi });

  const cu = await add('MaterialExpressionCustom', -400, 0);
  await set(cu, { Code: tr.code, OutputType: 'CMOT_Float4', Description: 'UPE building' });
  // Inputs: dizi boyutu ile öğe aynı çağrıda değişemiyor → önce ilk öğeyi adlandır, sonra kalanları ekle
  const names = tr.inputs.map((x) => x.name);
  await set(cu, { Inputs: [{ inputName: names[0] }] });
  let cur = (await ctx.call(OT, 'get_properties', { instance: cu, properties: ['Inputs'] })).returnValue;
  if (typeof cur === 'string') cur = JSON.parse(cur);
  if (names.length > 1) await set(cu, { Inputs: [cur.Inputs[0], ...names.slice(1).map((n) => ({ inputName: n }))] });

  const pdef = new Map(tr.params.map((x) => [x.name, x]));
  let y = -600;
  for (const inp of tr.inputs) {
    y += 70;
    let node, out = '';
    if (inp.node.class) {
      node = await add(inp.node.class, -1000, y); out = inp.node.output || '';
      for (const [pin, param] of Object.entries(inp.node.connect || {})) { // ör. DepthFade.FadeDistance ← UPE_SoftDistance
        const pr = pdef.get(param); const sp = await add('MaterialExpressionScalarParameter', -1250, y); await set(sp, { ParameterName: pr.name, DefaultValue: pr.default, Group: 'UPE' });
        await conn(sp, '', node, pin).catch(() => conn(sp, '', node, pin.replace(/([a-z])([A-Z])/g, '$1 $2')));
      }
    }
    else {
      const pr = pdef.get(inp.node.param);
      if (pr.kind === 'scalar') { node = await add('MaterialExpressionScalarParameter', -1000, y); await set(node, { ParameterName: pr.name, DefaultValue: pr.default }); }
      else if (pr.kind === 'vector') { node = await add('MaterialExpressionVectorParameter', -1000, y); await set(node, { ParameterName: pr.name, DefaultValue: { R: pr.default[0], G: pr.default[1], B: pr.default[2], A: pr.default[3] } }); out = 'RGBA'; }
      else {
        node = await add('MaterialExpressionTextureObjectParameter', -1000, y);
        await set(node, { ParameterName: pr.name, Texture: ref(pr.default), SamplerType: /DefaultNormal/.test(pr.default) ? 'SAMPLERTYPE_Normal' : pr.linear ? 'SAMPLERTYPE_LinearColor' : 'SAMPLERTYPE_Color' });
      }
      if (pr.internal) await set(node, { Group: 'UPE' }).catch(() => {});
    }
    await conn(node, out, cu, inp.name);
  }
  if (tr.distortion) await wireDistortionOutput(ctx, m, cu);
  else await wireColorOutput();
  async function wireColorOutput() {
  // çıkış: RGB → Emissive, A → Opacity (saydam) / OpacityMask 1 (clip'li opak: kesme Custom'da)
  const rgb = await add('MaterialExpressionComponentMask', -150, -60); await set(rgb, { R: true, G: true, B: true, A: false });
  await conn(cu, '', rgb, '');
  await ctx.call(MT, 'connect_to_output', { expression: rgb, output_name: '', material_property: 'MP_EmissiveColor' });
  if (['BLEND_Translucent', 'BLEND_AlphaComposite'].includes(tr.blendMode)) {
    const a = await add('MaterialExpressionComponentMask', -150, 60); await set(a, { R: false, G: false, B: false, A: true });
    await conn(cu, '', a, '');
    await ctx.call(MT, 'connect_to_output', { expression: a, output_name: '', material_property: 'MP_Opacity' });
  }
  }
  try {
    await ctx.call(MT, 'recompile', { material_or_function: m });
  } catch (e) {
    const raw = String(e?.result || e?.message || e);
    throw new UEMaterialCompileError(name, shaderName, parseCompileErrors(raw), raw);
  }
  await set(cu, { Description: stamp }); // yalnız başarılı derlemeden sonra: bozuk materyal bir dahaki gönderimde yeniden kurulur
  return { path: objPath, created, rebuilt: true };
}

// Bükülme çıkışı: Custom = float4(ofset.xy (ekran kesri, UE y aşağı), maske, 0) → SceneColor(OffsetFraction = ofset).rgb → Emissive,
// maske → Opacity (Translucent). SceneColor saydam materyalde arkadaki sahneyi verir (önizlemedeki sahne hedefinin karşılığı).
export async function wireDistortionOutput(ctx, m, cu) {
  const add = async (cls, x, y) => (await ctx.call(MT, 'add_expression', { material_or_function: m, expression_class: ref('/Script/Engine.' + cls), x, y })).returnValue;
  const set = (inst, values) => ctx.call(OT, 'set_properties', { instance: inst, values: JSON.stringify(values) });
  const conn = (a, ao, b, bi) => ctx.call(MT, 'connect_expressions', { from_expression: a, from_output_name: ao, to_expression: b, to_input_name: bi });
  const off = await add('MaterialExpressionComponentMask', -150, -120); await set(off, { R: true, G: true, B: false, A: false }); await conn(cu, '', off, '');
  const sc = await add('MaterialExpressionSceneColor', 50, -120);
  // SceneColor'ın tek girdisi var; anlamı InputMode'a göre (UV koordinatı / ofset kesri). Ad kipe göre değişiyor ("UVs") →
  // kipi OffsetFraction'a çek, girdinin adını editörden oku (2026-11-06, UE 5.8'de "Offset Fraction" adı bağlanmıyordu).
  await set(sc, { InputMode: 'OffsetFraction' }).catch(() => {});
  const scIn = ((await ctx.call(MT, 'get_expression_input_names', { expression: sc })).returnValue || [])[0] || 'UVs';
  await conn(off, '', sc, scIn);
  const rgb = await add('MaterialExpressionComponentMask', 250, -120); await set(rgb, { R: true, G: true, B: true, A: false }); await conn(sc, '', rgb, '');
  await ctx.call(MT, 'connect_to_output', { expression: rgb, output_name: '', material_property: 'MP_EmissiveColor' });
  const a = await add('MaterialExpressionComponentMask', -150, 60); await set(a, { R: false, G: false, B: true, A: false }); await conn(cu, '', a, '');
  await ctx.call(MT, 'connect_to_output', { expression: a, output_name: '', material_property: 'MP_Opacity' });
}

// Materyal örneği: yoksa oluştur, ebeveyni ve tüm parametreleri ayarla. importTexture(tex, { folder, linear }) → doku yolu
export async function ensureMaterialInstance(ctx, plan, { importTexture, warn = () => {} } = {}) {
  const { name, path: objPath } = plan.instance;
  const p = pkg(objPath); let created = false;
  if (!(await ctx.exists(p))) { await ctx.call(MIT, 'create', { folder_path: MATERIALS_PATH, asset_name: name, parent: ref(plan.base.path) }); created = true; }
  else await ctx.call(MIT, 'set_parent', { instance: ref(objPath), parent: ref(plan.base.path) });
  const inst = ref(objPath);
  const textures = [];
  for (const s of plan.values.scalars) await ctx.call(MIT, 'set_scalar_parameter', { instance: inst, name: s.name, value: s.value });
  for (const v of plan.values.vectors) {
    const [r, g, b, a] = v.value;
    await ctx.call(MIT, 'set_vector_parameter', { instance: inst, name: v.name, value: { r, g, b, a } })
      .catch(async (e) => { warn(`${name}.${v.name}: ${e.message.slice(0, 120)} → negatifler 0`); await ctx.call(MIT, 'set_vector_parameter', { instance: inst, name: v.name, value: { r: Math.max(0, r), g: Math.max(0, g), b: Math.max(0, b), a: Math.max(0, a) } }); });
  }
  for (const t of plan.values.textures) {
    let tp = t.engine;
    if (!tp) { const r = await importTexture(t.tex, { folder: MAT_TEXTURES_PATH, asset: t.asset, linear: t.linear }); tp = r.path; if (r.created) textures.push(r.path); }
    await ctx.call(MIT, 'set_texture_parameter', { instance: inst, name: t.name, value: ref(tp) });
  }
  return { path: objPath, created, textures };
}
