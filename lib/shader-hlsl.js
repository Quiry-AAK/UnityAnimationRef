// Unity HLSL üretici: UPE shader (normalizeShader çıktısı) → URP 17 .shader kaynağı (docs/MATERIAL.md "Unity: HLSL üretici").
// Yapı: Properties · SubShader Tags · HLSLINCLUDE (Core.hlsl, doku/örnekleyici, UnityPerMaterial CBUFFER, UPE prelude, kullanıcı
// kodu, ortak köşe/girdi yardımcıları) · pass'ler: UniversalForward, Outline (SRPDefaultUnlit, Cull Front), ShadowCaster,
// DepthOnly + DepthNormals (opak). Hepsinde vert() uygulanır. Kullanıcı kodu clip/discard içeriyorsa derinlik/gölge pass'leri de
// frag()'ı çağırır (alfa kesme deliği derinlikte/gölgede de açılır; renk sonucu atılır, derleyici gereksiz kısmı eler).
// Bağımlılık yok (yalnız şema sabitleri). Kullanıcı kodu satırları `//#upe-section <bölüm>` işaretlerinden sonra aynen girer:
// Unity hata satırı L, işaret satırı M ise bölüm satırı L - M (importer ve `sections` bunu kullanır).
import { CUSTOM_PREFIX } from '../public/shader-schema.js';

const BLEND = { opaque: null, alpha: 'SrcAlpha OneMinusSrcAlpha', additive: 'SrcAlpha One', premultiply: 'One OneMinusSrcAlpha', multiply: 'DstColor Zero' };
const CULL = { back: 'Back', front: 'Front', off: 'Off' };
const CULL_ENUM = { off: 0, front: 1, back: 2 }; // UnityEngine.Rendering.CullMode (urpSurface _Cull)
const ZTEST = { lequal: 'LEqual', less: 'Less', equal: 'Equal', gequal: 'GEqual', greater: 'Greater', notequal: 'NotEqual', always: 'Always' };
const QUEUE = { geometry: 'Geometry', alphatest: 'AlphaTest', transparent: 'Transparent' };
const TEX_DEFAULTS = ['white', 'black', 'gray', 'grey', 'bump'];
// Kullanıcı özellik adı bunlarla çakışırsa HLSL derlenmez
const RESERVED = new Set(['frag', 'vert', 'outlineFrag', 'splat2', 'splat3', 'splat4', 'SAMPLE', 'SAMPLE_LOD', 'PI', 'UPEInput', 'UPEVertex',
  '_Time', '_SinTime', '_CosTime', '_WorldSpaceCameraPos', '_ScreenParams', '_ProjectionParams', '_ZBufferParams', '_ScaledScreenParams',
  '_MainLightPosition', '_MainLightColor', '_LightDirection', '_LightPosition', '_GlossyEnvironmentColor', '_ShadowBias']);

const INC = 'Packages/com.unity.render-pipelines.universal/ShaderLibrary/';
const SHADOW_PRAGMAS = [
  '#pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN',
  '#pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH',
];

// ── sayı / renk
const fmt = (n) => { if (!Number.isFinite(n)) return '0'; const r = Math.round(n * 1e6) / 1e6; const s = String(r); return /e/i.test(s) ? r.toFixed(6) : s; };
// Unity GammaToLinearSpaceExact / LinearToGammaSpaceExact (1'in üstü pow 2.2 — Color.gamma ile aynı)
const g2l = (v) => (v <= 0.04045 ? v / 12.92 : v < 1 ? Math.pow((v + 0.055) / 1.055, 2.4) : Math.pow(v, 2.2));
function hexRgba(hex) {
  let s = String(hex || '').trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return [1, 1, 1, 1];
  const b = (i) => parseInt(s.slice(i, i + 2), 16) / 255;
  return [b(0), b(2), b(4), s.length === 8 ? b(6) : 1];
}
const tuple = (a) => `(${a.map(fmt).join(', ')})`;
// [HDR] varsayılan: Unity [HDR] renkleri doğrusal sayar (çevirmez; Unity'de ölçüldü) → doğrusal(renk)×intensity doğrudan yazılır
const hdrDefault = (d) => { const c = hexRgba(d?.color); const k = Number.isFinite(d?.intensity) ? Math.max(0, d.intensity) : 1; return [g2l(c[0]) * k, g2l(c[1]) * k, g2l(c[2]) * k, c[3]]; };
const esc = (s) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\\/g, '/').replace(/"/g, "'");

// URP SetupMaterialBlendModeInternal karşılığı (gizli _SrcBlend… varsayılanları için): BlendMode enum'u
// Zero 0, One 1, DstColor 2, SrcAlpha 5, OneMinusSrcAlpha 10
function urpBlendDefaults(surface, blend) {
  if (surface < 0.5) return { src: 1, dst: 0, srcA: 1, dstA: 0, zw: 1 };
  switch (Math.round(blend)) {
    case 1: return { src: 1, dst: 10, srcA: 1, dstA: 10, zw: 0 }; // premultiply
    case 2: return { src: 5, dst: 1, srcA: 1, dstA: 1, zw: 0 }; // additive
    case 3: return { src: 2, dst: 0, srcA: 0, dstA: 1, zw: 0 }; // multiply
    default: return { src: 5, dst: 10, srcA: 1, dstA: 10, zw: 0 }; // alfa
  }
}

function propertyLine(p, mainTex, mainColor) {
  const L = `"${esc(p.label || p.name)}"`;
  switch (p.type) {
    case 'float': return `${p.name} (${L}, Float) = ${fmt(p.default)}`;
    case 'range': return `${p.name} (${L}, Range(${fmt(p.min)}, ${fmt(p.max)})) = ${fmt(p.default)}`;
    case 'toggle': return `[ToggleUI] ${p.name} (${L}, Float) = ${p.default ? 1 : 0}`;
    case 'color': return `${mainColor ? '[MainColor] ' : ''}${p.name} (${L}, Color) = ${tuple(hexRgba(p.default))}`;
    case 'hdrColor': return `[HDR] ${p.name} (${L}, Color) = ${tuple(hdrDefault(p.default))}`;
    case 'vector': return `${p.name} (${L}, Vector) = ${tuple([0, 1, 2, 3].map((k) => Number(p.default?.[k]) || 0))}`;
    case 'texture': {
      let d = String(p.default || 'white').toLowerCase();
      d = TEX_DEFAULTS.includes(d) ? (d === 'grey' ? 'gray' : d) : 'white'; // özel doku adı → white (materyal atar)
      if (d === 'gray' && p.linear) d = 'linearGrey'; // veri dokusu: 0.5 doğrusal (önizlemedeki gibi)
      return `${mainTex ? '[MainTexture] ' : ''}${p.name} (${L}, 2D) = "${d}" {}`;
    }
  }
  return `${p.name} (${L}, Float) = 0`;
}

const cbufferType = (p) => (p.type === 'color' || p.type === 'hdrColor' || p.type === 'vector' ? 'float4' : 'float');
const codeOf = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
const indent = (lines, n) => lines.map((l) => (l ? ' '.repeat(n) + l : l));

export function generateUnityShader(shader) {
  if (!shader || typeof shader !== 'object') throw new Error('shader nesnesi gerekli (normalizeShader çıktısı)');
  if (shader.builtin) throw new Error(`builtin shader (${shader.unityName || shader.name}) için .shader üretilmez; materyal Unity'deki shader'ı kullanır`);
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const name = String(shader.name || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`shader adı geçersiz: "${name}" (normalizeShader çıktısı bekleniyor)`);
  const unityName = String(shader.unityName || '').startsWith(CUSTOM_PREFIX) ? shader.unityName : CUSTOM_PREFIX + name;
  const props = Array.isArray(shader.properties) ? shader.properties : [];
  const rs = { blend: 'opaque', cull: 'back', zwrite: true, ztest: 'lequal', queue: 'geometry', queueOffset: 0, ...(shader.renderState || {}) };
  const lighting = { receiveShadows: true, castShadows: true, ...(shader.lighting || {}) };
  const outline = { enabled: false, width: '_OutlineWidth', color: '_OutlineColor', ...(shader.outline || {}) };
  const urp = !!shader.urpSurface;
  const code = shader.code || {};
  const common = codeOf(code.common), vertex = codeOf(code.vertex), fragment = codeOf(code.fragment), outlineFragment = codeOf(code.outlineFragment);
  const hasVert = vertex.trim() !== '', hasOutlineFrag = outlineFragment.trim() !== '';
  if (!/\bfrag\s*\(/.test(fragment)) warn('code.fragment içinde "float4 frag(UPEInput i)" yok — Unity derlemesi başarısız olur');
  if (hasVert && /\bSAMPLE\s*\(/.test(vertex)) warn('code.vertex içinde SAMPLE: köşe shader\'ında türev yok, SAMPLE_LOD(t, uv, 0.0) kullan');
  const needsClip = /\bclip\s*\(|\bdiscard\b/.test(common + '\n' + fragment);
  for (const [k, c] of Object.entries({ common, vertex, fragment, outlineFragment }))
    if (/\b(ENDHLSL|HLSLPROGRAM|HLSLINCLUDE|CGPROGRAM|ENDCG)\b/.test(c)) warn(`code.${k} içinde ShaderLab blok sözcüğü (ENDHLSL vb.) var — yorumda bile olsa bloğu bozar`);

  // ── özellikler
  const byName = new Map(props.map((p) => [p.name, p]));
  for (const p of props) {
    if (RESERVED.has(p.name) || /^unity_/.test(p.name)) warn(`özellik adı "${p.name}" Unity/UPE adıyla çakışıyor, derleme bozulabilir`);
    if (p.type === 'texture' && byName.has(p.name + '_ST')) warn(`"${p.name}_ST" hem özellik hem doku ölçeği — çakışır`);
  }
  const mainTex = props.find((p) => p.type === 'texture' && p.name === '_BaseMap') ? '_BaseMap' : null;
  const mainColor = props.find((p) => p.type === 'color' && p.name === '_BaseColor') ? '_BaseColor' : null;
  const propLines = props.map((p) => propertyLine(p, p.name === mainTex, p.name === mainColor));
  if (urp) { // URP yüzey modu: blend/zwrite/cull materyal değerlerinden (importer _Surface/_Blend'den hesaplar)
    const dv = (n, d) => (byName.has(n) ? Number(byName.get(n).default) || 0 : d);
    const b = urpBlendDefaults(dv('_Surface', 0), dv('_Blend', 0));
    const hidden = { _SrcBlend: b.src, _DstBlend: b.dst, _SrcBlendAlpha: b.srcA, _DstBlendAlpha: b.dstA, _ZWrite: b.zw };
    for (const [n, v] of Object.entries(hidden)) if (!byName.has(n)) propLines.push(`[HideInInspector] ${n} ("${n}", Float) = ${v}`);
    if (!byName.has('_Cull')) propLines.push(`[HideInInspector] _Cull ("_Cull", Float) = ${CULL_ENUM[rs.cull] ?? 2}`);
    for (const n of ['_Surface', '_Blend', '_Cull']) if (byName.has(n) && !['float', 'range'].includes(byName.get(n).type)) warn(`urpSurface: ${n} float olmalı`);
  }

  // ── outline genişlik/renk ifadeleri
  const scalarOf = (n) => { const p = byName.get(n); if (!p || p.type === 'texture') return null; return cbufferType(p) === 'float4' ? `${n}.x` : n; };
  const colorOf = (n) => { const p = byName.get(n); if (!p || p.type === 'texture') return null; return cbufferType(p) === 'float4' ? n : `float4(${n}, ${n}, ${n}, 1.0)`; };
  let widthExpr = '0.01', colorExpr = 'float4(0.0, 0.0, 0.0, 1.0)';
  if (outline.enabled) {
    const w = scalarOf(outline.width); if (w) widthExpr = w; else warn(`outline.width: "${outline.width}" sayısal özellik değil/yok — 0.01 m kullanıldı`);
    if (!hasOutlineFrag) { const c = colorOf(outline.color); if (c) colorExpr = c; else warn(`outline.color: "${outline.color}" renk özelliği değil/yok — siyah kullanıldı`); }
  }

  // ── render state
  const opaque = urp || rs.blend === 'opaque';
  const cullStr = urp ? '[_Cull]' : CULL[rs.cull] || 'Back';
  const zt = ZTEST[rs.ztest] || 'LEqual';
  const stateLines = (cull) => {
    const l = [];
    if (urp) l.push('Blend [_SrcBlend][_DstBlend], [_SrcBlendAlpha][_DstBlendAlpha]');
    else if (BLEND[rs.blend]) l.push(`Blend ${BLEND[rs.blend]}`);
    l.push(urp ? 'ZWrite [_ZWrite]' : `ZWrite ${rs.zwrite ? 'On' : 'Off'}`);
    l.push(`ZTest ${zt}`);
    l.push(`Cull ${cull}`);
    return l;
  };
  const renderType = rs.queue === 'alphatest' ? 'TransparentCutout' : rs.blend === 'opaque' ? 'Opaque' : 'Transparent';
  const off = Math.round(Number(rs.queueOffset) || 0);
  const queue = (QUEUE[rs.queue] || 'Geometry') + (off > 0 ? '+' + off : off < 0 ? String(off) : '');

  // ── kaynak
  const out = [];
  const sections = {};
  const push = (...l) => out.push(...l);
  const section = (key, body, before) => { // kullanıcı kodu: işaret satırından sonra girintisiz, aynen
    if (before) push(before);
    push(`//#upe-section ${key}`);
    sections[key] = { marker: out.length, start: out.length + 1 }; // 1 tabanlı: marker satırı, kodun ilk satırı
    const lines = body === '' ? [] : body.split('\n');
    push(...lines);
    sections[key].end = out.length;
    push('//#upe-section end');
  };

  push(`// UnityPreview: Unity Preview Editor'den üretildi (lib/shader-hlsl.js) — elle değiştirme, editörde düzenleyip yeniden gönder.`);
  if (shader.description) push(`// ${esc(shader.description)}`);
  push(`Shader "${unityName}"`, '{', '    Properties', '    {', ...indent(propLines, 8), '    }', '');
  push('    SubShader', '    {');
  push(`        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="${renderType}" "Queue"="${queue}" "IgnoreProjector"="True" }`, '');

  // HLSLINCLUDE: her pass'e aynen eklenir → CBUFFER tüm pass'lerde aynı (SRP Batcher)
  push('        HLSLINCLUDE', `        #include "${INC}Core.hlsl"`, '');
  const texs = props.filter((p) => p.type === 'texture');
  if (texs.length) { push('        // ── dokular'); for (const t of texs) push(`        TEXTURE2D(${t.name}); SAMPLER(sampler${t.name});`); push(''); }
  push('        // ── özellikler (UnityPerMaterial: tüm pass\'lerde aynı)', '        CBUFFER_START(UnityPerMaterial)');
  for (const p of props) push(p.type === 'texture' ? `            float4 ${p.name}_ST;` : `            ${cbufferType(p)} ${p.name};`);
  if (!props.length) push('            float _UPEUnused;'); // boş CBUFFER bazı derleyicilerde hata
  push('        CBUFFER_END', '');
  push(...indent(PRELUDE, 8), '');
  section('common', common);
  if (hasVert) section('vertex', vertex, '#define UPE_HAS_VERT');
  section('fragment', fragment);
  if (hasOutlineFrag) section('outlineFragment', outlineFragment, '#define UPE_HAS_OUTLINE_FRAG');
  push('', ...indent(HELPERS, 8), '        ENDHLSL', '');

  // ── UniversalForward
  const lightingFn = (receive) => [
    '// Ana ışık + ortam (Lighting.hlsl)',
    'void UPEApplyLighting(inout UPEInput i)',
    '{',
    receive ? '    Light l = GetMainLight(TransformWorldToShadowCoord(i.positionWS));' : '    Light l = GetMainLight();',
    '    i.lightDir = l.direction;',
    '    i.lightColor = l.color;',
    '    i.shadow = l.shadowAttenuation;',
    '    i.ambient = SampleSH(i.normalWS);',
    '}',
  ];
  const lightingIncludes = (receive) => [
    ...(receive ? SHADOW_PRAGMAS : []),
    ...(receive ? (urp ? ['#pragma shader_feature_local_fragment _SURFACE_TYPE_TRANSPARENT'] : rs.blend !== 'opaque' ? ['#define _SURFACE_TYPE_TRANSPARENT 1 // saydam: ekran uzayı gölge dokusu kullanılmaz'] : []) : []),
    `#include "${INC}Lighting.hlsl"`,
  ];
  const fragInput = ['UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(IN);', 'UPEInput i = UPEMakeInput(IN, IS_FRONT_VFACE(face, 1.0, -1.0));'];
  const pass = (nm, tags, state, body) => { push('        Pass', '        {', `            Name "${nm}"`, `            Tags { ${tags} }`, ...indent(state, 12), '', '            HLSLPROGRAM', ...indent(body, 12), '            ENDHLSL', '        }', ''); };
  const progHead = (v, f) => ['#pragma target 3.5', `#pragma vertex ${v}`, `#pragma fragment ${f}`, '#pragma multi_compile_instancing'];

  pass('UniversalForward', '"LightMode"="UniversalForward"', stateLines(cullStr), [
    ...progHead('UPEForwardVert', 'UPEForwardFrag'),
    ...lightingIncludes(!!lighting.receiveShadows), '',
    ...lightingFn(!!lighting.receiveShadows), '',
    'UPEVaryings UPEForwardVert(UPEAttributes a) { return UPEBuildVaryings(a, 0.0); }', '',
    'float4 UPEForwardFrag(UPEVaryings IN, FRONT_FACE_TYPE face : FRONT_FACE_SEMANTIC) : SV_Target',
    '{', ...indent(fragInput, 4), '    UPEApplyLighting(i);', '    return frag(i);', '}',
  ]);

  // ── Outline (inverted hull)
  if (outline.enabled) {
    pass('Outline', '"LightMode"="SRPDefaultUnlit"', stateLines('Front'), [
      ...progHead('UPEOutlineVert', 'UPEOutlineFrag'),
      ...(hasOutlineFrag ? [...lightingIncludes(!!lighting.receiveShadows), '', ...lightingFn(!!lighting.receiveShadows)] : []), '',
      `// normal boyunca dünya genişliği (${esc(outline.width)}, metre)`,
      `UPEVaryings UPEOutlineVert(UPEAttributes a) { return UPEBuildVaryings(a, ${widthExpr}); }`, '',
      'float4 UPEOutlineFrag(UPEVaryings IN, FRONT_FACE_TYPE face : FRONT_FACE_SEMANTIC) : SV_Target',
      '{',
      ...(hasOutlineFrag ? [...indent(fragInput, 4), '    UPEApplyLighting(i);', '    return outlineFrag(i);'] : ['    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(IN);', `    return ${colorExpr};`]),
      '}',
    ]);
  }

  // clip/discard varsa derinlik/gölge pass'leri frag()'ı çağırır (renk atılır)
  const clipLines = needsClip ? [...indent(fragInput, 4), '    frag(i); // yalnız clip() için; renk kullanılmaz'] : ['    UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(IN);'];

  // ── ShadowCaster (ElarionToon'daki gibi; bias/clamp URP ile aynı)
  if (lighting.castShadows && opaque) {
    pass('ShadowCaster', '"LightMode"="ShadowCaster"', ['ZWrite On', 'ZTest LEqual', 'ColorMask 0', `Cull ${cullStr}`], [
      ...progHead('UPEShadowVert', 'UPEShadowFrag'),
      '#pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW',
      '#include "Packages/com.unity.render-pipelines.core/ShaderLibrary/CommonMaterial.hlsl"',
      `#include "${INC}Shadows.hlsl"`, '',
      'float3 _LightDirection;', 'float3 _LightPosition;', '',
      'UPEVaryings UPEShadowVert(UPEAttributes a)',
      '{',
      '    UPEVaryings o = UPEBuildVaryings(a, 0.0);',
      '#if defined(_CASTING_PUNCTUAL_LIGHT_SHADOW)',
      '    float3 lightDir = normalize(_LightPosition - o.positionWS);',
      '#else',
      '    float3 lightDir = _LightDirection;',
      '#endif',
      '    o.positionCS = ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(o.positionWS, o.normalWS, lightDir)));',
      '    return o;',
      '}', '',
      'float4 UPEShadowFrag(UPEVaryings IN, FRONT_FACE_TYPE face : FRONT_FACE_SEMANTIC) : SV_Target',
      '{', ...clipLines, '    return 0;', '}',
    ]);
  } else if (lighting.castShadows) warn('castShadows yalnız opak shader\'da; gölge pass\'i yazılmadı');

  // ── DepthOnly + DepthNormals (opak; URP 17 Unlit/Lit karşılıkları)
  if (opaque) {
    pass('DepthOnly', '"LightMode"="DepthOnly"', ['ZWrite On', 'ColorMask R', `Cull ${cullStr}`], [
      ...progHead('UPEDepthVert', 'UPEDepthFrag'), '',
      'UPEVaryings UPEDepthVert(UPEAttributes a) { return UPEBuildVaryings(a, 0.0); }', '',
      'float UPEDepthFrag(UPEVaryings IN, FRONT_FACE_TYPE face : FRONT_FACE_SEMANTIC) : SV_Target',
      '{', ...clipLines, '    return IN.positionCS.z;', '}',
    ]);
    pass('DepthNormals', '"LightMode"="DepthNormals"', ['ZWrite On', `Cull ${cullStr}`], [
      ...progHead('UPEDepthNormalsVert', 'UPEDepthNormalsFrag'),
      '#pragma multi_compile_fragment _ _GBUFFER_NORMALS_OCT',
      `#include_with_pragmas "${INC}RenderingLayers.hlsl"`, '',
      'UPEVaryings UPEDepthNormalsVert(UPEAttributes a) { return UPEBuildVaryings(a, 0.0); }', '',
      'void UPEDepthNormalsFrag(UPEVaryings IN, FRONT_FACE_TYPE face : FRONT_FACE_SEMANTIC, out half4 outNormalWS : SV_Target0',
      '#ifdef _WRITE_RENDERING_LAYERS',
      '    , out float4 outRenderingLayers : SV_Target1',
      '#endif',
      ')',
      '{', ...clipLines,
      '#if defined(_GBUFFER_NORMALS_OCT)',
      '    float3 normalWS = normalize(IN.normalWS);',
      '    float2 octNormalWS = PackNormalOctQuadEncode(normalWS);',
      '    float2 remappedOctNormalWS = saturate(octNormalWS * 0.5 + 0.5);',
      '    outNormalWS = half4(half3(PackFloat2To888(remappedOctNormalWS)), 0.0);',
      '#else',
      '    outNormalWS = half4(NormalizeNormalPerPixel(IN.normalWS), 0.0);',
      '#endif',
      '#ifdef _WRITE_RENDERING_LAYERS',
      '    outRenderingLayers = float4(EncodeMeshRenderingLayer(GetMeshRenderingLayer()), 0, 0, 0);',
      '#endif',
      '}',
    ]);
  }

  push('    }', '}', ''); // SubShader, Shader — Fallback yok: eksik pass (ör. castShadows kapalı) başka shader'dan ödünç alınmasın
  return { source: out.join('\n'), warnings, sections, unityName };
}

// UPE prelude (SHADER_REFERENCE ile aynı alanlar/sıra). TRANSFORM_TEX ve PI URP/Core'da var.
const PRELUDE = [
  '// ── UPE prelude',
  'struct UPEVertex { float3 positionOS; float3 normalOS; float2 uv; float4 color; };',
  'struct UPEInput',
  '{',
  '    float2 uv; float4 color;',
  '    float3 positionWS; float3 normalWS;',
  '    float3 viewDirWS;',
  '    float4 positionCS; float2 screenUV;',
  '    float3 lightDir; float3 lightColor;',
  '    float shadow;',
  '    float3 ambient;',
  '    float3 cameraRightWS; float3 cameraUpWS; float3 cameraPosWS;',
  '    float time;',
  '    float facing;',
  '};',
  '#define SAMPLE(t, uv) SAMPLE_TEXTURE2D(t, sampler##t, uv)',
  '#define SAMPLE_LOD(t, uv, lod) SAMPLE_TEXTURE2D_LOD(t, sampler##t, uv, lod)',
  'float2 splat2(float x) { return float2(x, x); }',
  'float3 splat3(float x) { return float3(x, x, x); }',
  'float4 splat4(float x) { return float4(x, x, x, x); }',
];

// Kullanıcı kodundan sonra: köşe girdisi → UPEVertex → vert() → dünya; fragment girdisi → UPEInput (ışık hariç)
const HELPERS = [
  '// ── ortak köşe/girdi yardımcıları (pass giriş noktaları bunları kullanır)',
  'struct UPEAttributes',
  '{',
  '    float4 positionOS : POSITION;',
  '    float3 normalOS : NORMAL;',
  '    float2 uv : TEXCOORD0;',
  '    float4 color : COLOR;',
  '    UNITY_VERTEX_INPUT_INSTANCE_ID',
  '};',
  '',
  'struct UPEVaryings',
  '{',
  '    float4 positionCS : SV_POSITION;',
  '    float2 uv : TEXCOORD0;',
  '    float4 color : TEXCOORD1;',
  '    float3 positionWS : TEXCOORD2;',
  '    float3 normalWS : TEXCOORD3;',
  '    UNITY_VERTEX_OUTPUT_STEREO',
  '};',
  '',
  '// extrude: normal boyunca dünya ofseti (outline), diğer pass\'lerde 0',
  'UPEVaryings UPEBuildVaryings(UPEAttributes a, float extrude)',
  '{',
  '    UPEVaryings o = (UPEVaryings)0;',
  '    UNITY_SETUP_INSTANCE_ID(a);',
  '    UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);',
  '    UPEVertex v;',
  '    v.positionOS = a.positionOS.xyz;',
  '    v.normalOS = a.normalOS;',
  '    v.uv = a.uv;',
  '    v.color = a.color;',
  '#ifdef UPE_HAS_VERT',
  '    vert(v);',
  '#endif',
  '    o.normalWS = TransformObjectToWorldNormal(v.normalOS);',
  '    o.positionWS = TransformObjectToWorld(v.positionOS) + o.normalWS * extrude;',
  '    o.positionCS = TransformWorldToHClip(o.positionWS);',
  '    o.uv = v.uv;',
  '    o.color = v.color;',
  '    return o;',
  '}',
  '',
  '// ışık alanları varsayılan (yukarıdan beyaz, gölgesiz, ortam 0); forward/outline UPEApplyLighting ile doldurur',
  'UPEInput UPEMakeInput(UPEVaryings IN, float facing)',
  '{',
  '    UPEInput i = (UPEInput)0;',
  '    i.uv = IN.uv;',
  '    i.color = IN.color;',
  '    i.positionWS = IN.positionWS;',
  '    i.normalWS = normalize(IN.normalWS);',
  '    i.viewDirWS = GetWorldSpaceNormalizeViewDir(IN.positionWS);',
  '    i.positionCS = IN.positionCS;',
  '    i.screenUV = GetNormalizedScreenSpaceUV(IN.positionCS);',
  '    i.lightDir = float3(0.0, 1.0, 0.0);',
  '    i.lightColor = float3(1.0, 1.0, 1.0);',
  '    i.shadow = 1.0;',
  '    i.ambient = float3(0.0, 0.0, 0.0);',
  '    i.cameraRightWS = UNITY_MATRIX_V[0].xyz;',
  '    i.cameraUpWS = UNITY_MATRIX_V[1].xyz;',
  '    i.cameraPosWS = _WorldSpaceCameraPos;',
  '    i.time = _Time.y;',
  '    i.facing = facing;',
  '    return i;',
  '}',
];
