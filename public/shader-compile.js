// UPE-SL (Unity HLSL alt kümesi) → GLSL ES 3.0 çevirici + three.js ShaderMaterial kurucu.
// Unity'de aynı kod lib/shader-hlsl.js ile URP şablonuna girer; burada önizleme için çevrilir. Tüm dünya girdileri Unity
// eksenine çevrilir (three = (-x, y, z) aynası), böylece kullanıcı kodu iki tarafta aynı sonucu verir.
import * as THREE from 'three';
import { parseColorLinear } from './shader-util.js';

// ── çevirici
const PRELUDE = `
#define float2 vec2
#define float3 vec3
#define float4 vec4
#define half float
#define half2 vec2
#define half3 vec3
#define half4 vec4
#define int2 ivec2
#define int3 ivec3
#define int4 ivec4
#define uint2 uvec2
#define uint3 uvec3
#define uint4 uvec4
#define bool2 bvec2
#define bool3 bvec3
#define bool4 bvec4
#define float2x2 mat2
#define float3x3 mat3
#define float4x4 mat4
#define half3x3 mat3
#define half4x4 mat4
#define lerp mix
#define frac fract
#define rsqrt inversesqrt
#define ddx dFdx
#define ddy dFdy
#define atan2(y, x) atan(y, x)
#define mul(a, b) ((a) * (b))
#define SAMPLE(t, uv) texture(t, uv)
#define SAMPLE_LOD(t, uv, lod) textureLod(t, uv, lod)
#ifndef PI
#define PI 3.14159265359
#endif
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 saturate(vec4 x) { return clamp(x, 0.0, 1.0); }
float fmod(float a, float b) { return a - b * trunc(a / b); }
vec2 fmod(vec2 a, vec2 b) { return a - b * trunc(a / b); }
vec3 fmod(vec3 a, vec3 b) { return a - b * trunc(a / b); }
vec4 fmod(vec4 a, vec4 b) { return a - b * trunc(a / b); }
float rcp(float x) { return 1.0 / x; }
vec2 splat2(float x) { return vec2(x); }
vec3 splat3(float x) { return vec3(x); }
vec4 splat4(float x) { return vec4(x); }
vec3 upeToU(vec3 v) { return vec3(-v.x, v.y, v.z); }
`;
const PRELUDE_FRAG = `
void clip(float x) { if (x < 0.0) discard; }
void clip(vec2 x) { if (any(lessThan(x, vec2(0.0)))) discard; }
void clip(vec3 x) { if (any(lessThan(x, vec3(0.0)))) discard; }
void clip(vec4 x) { if (any(lessThan(x, vec4(0.0)))) discard; }
`;
const PRELUDE_VERT = 'void clip(float x) {}\n';
const STRUCTS = `
struct UPEVertex { float3 positionOS; float3 normalOS; float2 uv; float4 color; };
struct UPEInput {
  float2 uv; float4 color; float3 positionWS; float3 normalWS; float3 viewDirWS; float4 positionCS; float2 screenUV;
  float3 lightDir; float3 lightColor; float shadow; float3 ambient; float3 cameraRightWS; float3 cameraUpWS; float3 cameraPosWS;
  float time; float facing; float4 custom; float sceneDepth; float softFade;
};
`;

const INT_TYPES = new Set(['int', 'uint', 'int2', 'int3', 'int4', 'uint2', 'uint3', 'uint4', 'bool']);
const BIT_OPS = new Set(['&', '|', '^', '<<', '>>', '%', '&=', '|=', '^=', '<<=', '>>=', '%=']);

// HLSL tamsayı sabitlerini (GLSL ES örtük dönüşüm yapmaz) bağlama göre float'a çevirir: dizi indeksi, int bildirimi,
// for başlığı, int/uint kurucusu ve bit işlemleri dışında "2" → "2.0".
function fixIntLiterals(src) {
  const toks = []; const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|^[ \t]*#[^\n]*|\s+|[A-Za-z_]\w*|\d+\.\d*(?:[eE][+-]?\d+)?[fFhH]?|\.\d+(?:[eE][+-]?\d+)?[fFhH]?|\d+(?:[eE][+-]?\d+)[fFhH]?|0[xX][0-9a-fA-F]+[uU]?|\d+[uU]?|<<=|>>=|<<|>>|[&|^%]=|[^\s\w])/gm;
  let m; while ((m = re.exec(src))) toks.push(m[0]);
  const sig = (i, d) => { for (let k = i + d; k >= 0 && k < toks.length; k += d) if (!/^\s+$|^\/[/*]/.test(toks[k])) return toks[k]; return ''; };
  const calls = []; let stmtInt = false, stmtStart = true, forDepth = -1, forInt = false, depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^\s+$|^\/[/*]|^[ \t]*#/.test(t)) continue;
    if (stmtStart) { stmtInt = INT_TYPES.has(t) || (t === 'const' && INT_TYPES.has(sig(i, 1))); stmtStart = false; }
    if (t === ';' || t === '{' || t === '}') { stmtStart = true; stmtInt = false; continue; }
    if (t === '(') {
      const prev = sig(i, -1); calls.push(prev); depth++;
      if (prev === 'for') { forDepth = depth; forInt = INT_TYPES.has(sig(i, 1)); stmtStart = false; }
      continue;
    }
    if (t === ')') { if (depth === forDepth) { forDepth = -1; forInt = false; stmtStart = true; } calls.pop(); depth--; continue; }
    // for başlığının içindeki ';' deyimi bitirmesin
    if (/^\d+$/.test(t)) {
      const prev = sig(i, -1), next = sig(i, 1);
      const inIntCall = calls.some((c) => INT_TYPES.has(c));
      if (prev === '[' || next === ']' || BIT_OPS.has(prev) || BIT_OPS.has(next) || inIntCall || stmtInt || (forDepth >= 0 && forInt)) continue;
      toks[i] = t + '.0';
    } else if (/^\d.*[hH]$|^\.\d.*[hH]$/.test(t)) toks[i] = t.slice(0, -1); // half sabiti 1.0h
  }
  return toks.join('');
}

// TRANSFORM_TEX(uv, _Tex) → ((uv) * _Tex_ST.xy + _Tex_ST.zw) — GLSL ES önişlemcisinde ## yok; ilk argüman parantez/virgül içerebilir
function expandTransformTex(s) {
  let out = '', i = 0;
  for (;;) {
    const j = s.indexOf('TRANSFORM_TEX', i); if (j < 0) return out + s.slice(i);
    const k = s.indexOf('(', j); if (k < 0 || s.slice(j + 13, k).trim()) { out += s.slice(i, j + 13); i = j + 13; continue; }
    let d = 0, comma = -1, e = k;
    for (; e < s.length; e++) { const c = s[e]; if (c === '(') d++; else if (c === ')') { d--; if (!d) break; } else if (c === ',' && d === 1) comma = e; }
    if (comma < 0 || e >= s.length) { out += s.slice(i, k + 1); i = k + 1; continue; }
    const uv = expandTransformTex(s.slice(k + 1, comma)), name = s.slice(comma + 1, e).trim();
    out += s.slice(i, j) + `((${uv.trim()}) * ${name}_ST.xy + ${name}_ST.zw)`; i = e + 1;
  }
}

export function translateUPESL(code) {
  const warnings = [];
  let s = expandTransformTex(String(code || ''));
  s = s.replace(/\[\s*(unroll|loop|branch|flatten|fastopt|call|forcecase)\s*(\(\s*\d*\s*\))?\s*\]/g, '');
  // static const T ad[N] = { ... };  →  const T ad[N] = T[N](...);
  s = s.replace(/(?:\bstatic\s+)?\bconst\s+(\w+)\s+(\w+)\s*\[\s*(\d*)\s*\]\s*=\s*\{([^}]*)\}\s*;/g, (_, ty, name, n, body) => {
    const items = body.split(',').map((x) => x.trim()).filter(Boolean); const len = n || items.length;
    return `const ${ty} ${name}[${len}] = ${ty}[${len}](${items.join(', ')});`;
  });
  s = s.replace(/\bstatic\s+/g, '');
  if (/\(\s*(float|half|int|uint|bool)[234]?(x[234])?\s*\)\s*[\w(]/.test(s)) warnings.push('C tipi cast desteklenmiyor: (float3)x yerine float3(...) ya da splat3(x) kullan');
  if (/\b(float|half)[234]\s*\(\s*[^,()]+\s*\)/.test(s)) warnings.push('tek argümanlı vektör kurucusu HLSL\'de geçersiz olabilir: splat3(x) kullan');
  if (/:\s*SV_\w+/.test(s)) warnings.push('semantik (SV_*) kullanma; girdiler UPEInput ile gelir');
  s = fixIntLiterals(s);
  return { glsl: s, warnings };
}

// ── program üretimi
const uniformDecl = (p) => (p.type === 'texture' ? `uniform sampler2D ${p.name};\nuniform vec4 ${p.name}_ST;` : `uniform ${['color', 'hdrColor', 'vector'].includes(p.type) ? 'vec4' : 'float'} ${p.name};`);

function sections(shader) {
  const out = [];
  const add = (id, code, name) => { if (!code.trim()) return; const t = translateUPESL(code); out.push({ id, name, glsl: t.glsl, warnings: t.warnings }); };
  add(1, shader.code.common, 'common'); add(2, shader.code.vertex, 'vertex'); add(3, shader.code.fragment, 'fragment'); add(4, shader.code.outlineFragment, 'outlineFragment');
  return out;
}
export const SECTION_NAMES = { 0: 'şablon', 1: 'common', 2: 'vertex', 3: 'fragment', 4: 'outlineFragment' };

function programParts(shader, outline) {
  const secs = sections(shader);
  const user = (ids) => secs.filter((s) => ids.includes(s.id)).map((s) => `#line 1 ${s.id}\n${s.glsl}\n`).join('');
  const hasVert = secs.some((s) => s.id === 2), hasOutFrag = secs.some((s) => s.id === 4);
  const defs = [hasVert && '#define UPE_HAS_VERT', hasOutFrag && '#define UPE_HAS_OUTLINE_FRAG', outline && '#define UPE_OUTLINE',
    outline && `#define UPE_OUTLINE_WIDTH ${shader.outline.width}`, outline && `#define UPE_OUTLINE_COLOR ${shader.outline.color}`].filter(Boolean).join('\n');
  const uniforms = shader.properties.map(uniformDecl).join('\n');
  const common = `${defs}\n${PRELUDE}\n${uniforms}\nuniform vec4 _Time;\n${STRUCTS}`;
  return { secs, user, common, warnings: secs.flatMap((s) => s.warnings.map((w) => `${s.name}: ${w}`)) };
}
// VFX parçacık seçenekleri (defines): UPE_DISTORT bükülme, UPE_DEPTH sahne derinliği (i.sceneDepth), UPE_SOFT yumuşak parçacık
// (i.softFade, çıkış alfası çarpılır; UPE_SOFT_RGB premultiply'da renk de), UPE_DECAL yere iz (yüzey sahne derinliğinden kurulur)
const particleDefines = ({ distortion, depth, soft, softRgb, decal } = {}) => [distortion && 'UPE_DISTORT', (depth || soft || decal || distortion) && 'UPE_DEPTH', soft && 'UPE_SOFT', soft && softRgb && 'UPE_SOFT_RGB', decal && 'UPE_DECAL']
  .filter(Boolean).map((d) => `#define ${d}\n`).join('');
const fragmentSource = (common, userCode, opts = {}) => `${particleDefines(opts)}${common}${PRELUDE_FRAG}
uniform vec3 upeLightDir; uniform vec3 upeLightColor; uniform vec3 upeAmbient; uniform vec2 upeResolution;
${userCode}
#line 10000 0
varying vec2 vUv; varying vec4 vColor; varying vec3 vPosWS; varying vec3 vNormalWS; varying vec4 vCustom;
#ifdef UPE_DISTORT
uniform sampler2D uScene; uniform float uStrength;
#endif
#ifdef UPE_DEPTH
#include <packing>
uniform sampler2D uDepth; uniform vec2 uSceneRes; uniform float uCamNear, uCamFar;
#endif
#ifdef UPE_SOFT
uniform float uSoft;
#endif
#ifdef UPE_DECAL
uniform mat4 uInvProj, uCamWorld; uniform float uGroundOnly;
varying vec3 vDC, vDX, vDY, vDP, vDS;
bool upeDecal(out vec3 l, out vec3 wp, out vec3 n) { // vfx-sim.js DECAL_COMMON ile aynı
  vec2 suv = gl_FragCoord.xy / uSceneRes; float d = texture(uDepth, suv).x;
  if (d >= 0.99999) return false;
  vec4 vp = uInvProj * vec4(suv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vp /= vp.w; wp = (uCamWorld * vp).xyz;
  vec3 r = wp - vDC; l = vec3(dot(r, vDX) / vDS.x, dot(r, vDY) / vDS.y, dot(r, vDP) / vDS.z);
  if (any(greaterThan(abs(l), vec3(0.5)))) return false;
  n = normalize(cross(dFdx(wp), dFdy(wp))); if (dot(n, vDP) > 0.0) n = -n;
  if (uGroundOnly > 0.5 && dot(-n, vDP) < 0.7) return false;
  return true;
}
#endif
void main() {
  UPEInput i;
  i.uv = vUv; i.color = vColor; i.custom = vCustom; i.sceneDepth = 0.0; i.softFade = 1.0;
  i.positionWS = upeToU(vPosWS);
  i.normalWS = upeToU(normalize(vNormalWS));
  i.viewDirWS = upeToU(normalize(cameraPosition - vPosWS));
  i.positionCS = gl_FragCoord; i.screenUV = gl_FragCoord.xy / upeResolution;
  i.lightDir = upeLightDir; i.lightColor = upeLightColor; i.shadow = 1.0; i.ambient = upeAmbient;
  i.cameraRightWS = upeToU(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  i.cameraUpWS = upeToU(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  i.cameraPosWS = upeToU(cameraPosition); i.time = _Time.y; i.facing = gl_FrontFacing ? 1.0 : -1.0;
  #ifdef UPE_DEPTH
  i.sceneDepth = -perspectiveDepthToViewZ(texture(uDepth, gl_FragCoord.xy / uSceneRes).x, uCamNear, uCamFar);
  #endif
  #ifdef UPE_SOFT
  i.softFade = clamp((i.sceneDepth + perspectiveDepthToViewZ(gl_FragCoord.z, uCamNear, uCamFar)) / uSoft, 0.0, 1.0);
  #endif
  float upeDecalFade = 1.0;
  #ifdef UPE_DECAL
  vec3 upeL, upeW, upeN; if (!upeDecal(upeL, upeW, upeN)) discard;
  i.uv = upeL.xy + 0.5; i.positionWS = upeToU(upeW); i.normalWS = upeToU(upeN); i.viewDirWS = upeToU(normalize(cameraPosition - upeW));
  upeDecalFade = 1.0 - smoothstep(0.35, 0.5, abs(upeL.z));
  #endif
  #ifdef UPE_OUTLINE
    #ifdef UPE_HAS_OUTLINE_FRAG
    gl_FragColor = outlineFrag(i);
    #else
    gl_FragColor = vec4(UPE_OUTLINE_COLOR.rgb, 1.0);
    #endif
  #elif defined(UPE_DISTORT)
  vec4 upeD = frag(i); // bükülme: rg = ekran ofseti yönü (-1..1), a = maske; ofset = rg × a × güç
  if (upeD.a < 0.002) discard;
  gl_FragColor = vec4(texture(uScene, gl_FragCoord.xy / uSceneRes + upeD.rg * upeD.a * uStrength).rgb, 1.0);
  #else
  gl_FragColor = frag(i);
  gl_FragColor.a *= i.softFade * upeDecalFade;
  #ifdef UPE_SOFT_RGB
  gl_FragColor.rgb *= i.softFade;
  #endif
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function buildPrograms(shader, { outline = false } = {}) {
  const { user, common, warnings } = programParts(shader, outline);
  const vertexShader = `${common}${PRELUDE_VERT}
#include <skinning_pars_vertex>
${user([1, 2])}
#line 10000 0
varying vec2 vUv; varying vec4 vColor; varying vec3 vPosWS; varying vec3 vNormalWS; varying vec4 vCustom;
void main() {
  vCustom = vec4(0.0);
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  UPEVertex v; v.positionOS = upeToU(transformed); v.normalOS = upeToU(objectNormal); v.uv = uv;
  #if defined(USE_COLOR_ALPHA)
  v.color = color;
  #elif defined(USE_COLOR)
  v.color = vec4(color, 1.0);
  #else
  v.color = vec4(1.0);
  #endif
  #ifdef UPE_HAS_VERT
  vert(v);
  #endif
  vec4 wp = modelMatrix * vec4(upeToU(v.positionOS), 1.0);
  vec3 nW = normalize((modelMatrix * vec4(upeToU(v.normalOS), 0.0)).xyz);
  #ifdef UPE_OUTLINE
  wp.xyz += nW * UPE_OUTLINE_WIDTH;
  #endif
  vPosWS = wp.xyz; vNormalWS = nW; vUv = v.uv; vColor = v.color;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
  return { vertexShader, fragmentShader: fragmentSource(common, user([1, 3, 4])), warnings };
}

// VFX emitter'ı için: quad'ı Unity ParticleSystemRenderer gibi açar (vfx-sim.js ile aynı instanced girdiler). Unity'de parçacık
// köşeleri dünya uzayındadır (nesne matrisi birim): v.positionOS = köşenin dünya konumu, v.color = parçacık rengi (Linear projede
// doğrusala çevrilir), v.uv = quad UV'si (flipbook açıksa o anki kare; mesh modunda mesh UV'si), i.custom = customData eğrileri.
// Kullanıcının vert/frag'ı aynen çalışır; outline yok. distortion: frag() çıkışı bükülme ofseti (rg) + maske (a) olarak yorumlanır.
export function buildParticlePrograms(shader, opts = {}) {
  const { user, common, warnings } = programParts(shader, false);
  const vertexShader = `${particleDefines(opts)}${common}${PRELUDE_VERT}
${user([1, 2])}
#line 10000 0
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iCol; attribute vec4 iSRF; attribute vec4 iCus;
uniform int uMode; uniform float uLengthScale, uVelScale; uniform vec2 uTiles; uniform mat3 uAlign;
varying vec2 vUv; varying vec4 vColor; varying vec3 vPosWS; varying vec3 vNormalWS; varying vec4 vCustom;
#ifdef UPE_DECAL
uniform vec3 uDSize; uniform int uDProj; varying vec3 vDC, vDX, vDY, vDP, vDS;
#endif
vec3 upeLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec2 c = position.xy; float size = iSRF.x, rot = iSRF.y;
  float cs = cos(rot), sn = sin(rot);
  vec2 rc = vec2(c.x * cs + c.y * sn, -c.x * sn + c.y * cs); // pozitif açı = saat yönü (Unity gibi)
  mat4 iv = inverse(viewMatrix);
  vec3 wp, nW;
  if (uMode == 1) {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    vec3 vv = mat3(modelViewMatrix) * iVel; float sp = length(iVel);
    vec2 d = length(vv.xy) > 1e-5 ? normalize(vv.xy) : vec2(0.0, 1.0); vec2 pr = vec2(-d.y, d.x);
    mv.xy += pr * c.x * size + d * c.y * (size * uLengthScale + sp * uVelScale);
    wp = (iv * mv).xyz; nW = mat3(iv) * vec3(0.0, 0.0, 1.0);
  } else if (uMode == 2) {
    wp = (modelMatrix * vec4(iPos, 1.0)).xyz + vec3(rc.x, 0.0, -rc.y) * size; nW = vec3(0.0, 1.0, 0.0);
  } else if (uMode == 3) {
    vec3 p = (modelMatrix * vec4(iPos, 1.0)).xyz;
    vec3 tc = cameraPosition - p; tc.y = 0.0; vec3 f = length(tc) > 1e-5 ? normalize(tc) : vec3(0.0, 0.0, 1.0);
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
    wp = p + (r * rc.x + vec3(0.0, 1.0, 0.0) * rc.y) * size; nW = f;
  } else if (uMode == 5) {
    wp = (modelMatrix * vec4(iPos, 1.0)).xyz; nW = vec3(0.0, 1.0, 0.0); // kılıç izi şeridi (uv = iSRF.zw)
  } else if (uMode == 4) {
    wp = (modelMatrix * vec4(iPos + uAlign * vec3(rc, 0.0) * size, 1.0)).xyz; nW = normalize(mat3(modelMatrix) * (uAlign * vec3(0.0, 0.0, -1.0)));
  #ifdef UPE_DECAL
  } else if (uMode == 7) { // yere iz kutusu (vfx-sim.js DECAL_VERT ile aynı); yüzey parça aşamasında derinlikten kurulur
    vec3 ex, ey, ep;
    if (uDProj == 1) { mat3 M = mat3(modelMatrix) * uAlign; ex = normalize(M * vec3(1.0, 0.0, 0.0)); ey = normalize(M * vec3(0.0, 1.0, 0.0)); ep = normalize(M * vec3(0.0, 0.0, 1.0)); }
    else { ex = vec3(-1.0, 0.0, 0.0); ey = vec3(0.0, 0.0, 1.0); ep = vec3(0.0, -1.0, 0.0); }
    vec3 rx = ex * cs - ey * sn, ry = ex * sn + ey * cs, s3 = uDSize * size, cc = (modelMatrix * vec4(iPos, 1.0)).xyz;
    wp = cc + rx * position.x * s3.x + ry * position.y * s3.y + ep * position.z * s3.z; nW = -ep;
    vDC = cc; vDX = rx; vDY = ry; vDP = ep; vDS = s3;
  #endif
  } else if (uMode == 6) { // mesh (vfx-sim.js ile aynı): yerel mesh × boyut, yerel Z etrafında dönüş, emitter dönüşü
    vec3 lp = position * size; lp.xy = vec2(lp.x * cs + lp.y * sn, -lp.x * sn + lp.y * cs);
    vec3 ln = normal; ln.xy = vec2(ln.x * cs + ln.y * sn, -ln.x * sn + ln.y * cs);
    wp = (modelMatrix * vec4(iPos + uAlign * lp, 1.0)).xyz; nW = normalize(mat3(modelMatrix) * (uAlign * ln));
  } else {
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += rc * size;
    wp = (iv * mv).xyz; nW = mat3(iv) * vec3(0.0, 0.0, 1.0);
  }
  float tiles = uTiles.x * uTiles.y, fr = mod(floor(iSRF.z + 0.5), tiles);
  vec2 cell = vec2(mod(fr, uTiles.x), uTiles.y - 1.0 - floor(fr / uTiles.x));
  UPEVertex v; v.positionOS = upeToU(wp); v.normalOS = upeToU(nW); v.uv = uMode == 5 ? iSRF.zw : uMode == 6 ? (cell + uv) / uTiles : (cell + c + 0.5) / uTiles; v.color = vec4(upeLinear(iCol.rgb), iCol.a);
  vCustom = iCus;
  #ifdef UPE_HAS_VERT
  vert(v);
  #endif
  vec3 w = upeToU(v.positionOS);
  vPosWS = w; vNormalWS = normalize(upeToU(v.normalOS)); vUv = v.uv; vColor = v.color;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
  return { vertexShader, fragmentShader: fragmentSource(common, user([1, 3]), opts), warnings };
}

// ── derleme hatalarını yakala ("ERROR: 3:12: ..." → bölüm fragment, satır 12)
let errorSink = null;
export function installErrorHook(renderer) {
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const errs = [];
    for (const [sh, stage] of [[vs, 'vertex'], [fs, 'fragment']]) {
      const log = gl.getShaderInfoLog(sh) || '';
      for (const line of log.split('\n')) {
        const mm = /(?:ERROR|WARNING):\s*(\d+):(\d+):\s*(.*)/.exec(line);
        if (mm) errs.push({ stage, section: SECTION_NAMES[+mm[1]] || 'şablon', line: +mm[2], message: mm[3].trim(), template: +mm[1] === 0 });
      }
      if (!errs.length && log.trim()) errs.push({ stage, section: 'şablon', line: 0, message: log.trim().slice(0, 300) });
    }
    if (!errs.length) errs.push({ stage: 'link', section: 'şablon', line: 0, message: (gl.getProgramInfoLog(program) || 'bağlama hatası').trim() });
    if (errorSink) errorSink.push(...errs); else console.warn('UPE shader hatası ' + JSON.stringify(errs));
  };
}
export function captureErrors(fn) { const prev = errorSink; errorSink = []; try { fn(); return errorSink; } finally { errorSink = prev; } }

// ── materyal örneği: shader + değerler → ShaderMaterial (+ outline)
const builtinTex = new Map();
function getBuiltinTex(name) {
  if (!builtinTex.has(name)) {
    const c = { white: [255, 255, 255, 255], black: [0, 0, 0, 255], gray: [128, 128, 128, 255], bump: [128, 128, 255, 255] }[name] || [255, 0, 255, 255];
    const t = new THREE.DataTexture(new Uint8Array(c), 1, 1); t.needsUpdate = true; t.colorSpace = name === 'bump' ? THREE.NoColorSpace : THREE.SRGBColorSpace; builtinTex.set(name, t);
  }
  return builtinTex.get(name);
}
const fileTex = new Map(); const texReady = new Map();
export function getMaterialTexture(name, linear, onLoad) {
  const key = name + (linear ? '|lin' : '');
  if (!fileTex.has(key)) {
    let done; texReady.set(key, new Promise((r) => { done = r; }));
    const t = new THREE.TextureLoader().load('/material-textures/' + encodeURIComponent(name) + '.png?v=' + Date.now(), () => { done(); onLoad?.(); }, undefined, () => { done(); onLoad?.(); });
    t.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; fileTex.set(key, t);
  }
  return fileTex.get(key);
}
export const materialTexturesLoaded = () => Promise.all([...texReady.values()]);
export function clearMaterialTextureCache() { fileTex.clear(); texReady.clear(); }

// Ortak (paylaşılan) uniform'lar: ışık, zaman, çözünürlük — tek güncelleme tüm UPE materyallerine yansır
export const shared = {
  upeLightDir: { value: new THREE.Vector3(0, 1, 0) }, upeLightColor: { value: new THREE.Vector3(1, 1, 1) },
  upeAmbient: { value: new THREE.Vector3(0.2, 0.2, 0.2) }, upeResolution: { value: new THREE.Vector2(1, 1) }, _Time: { value: new THREE.Vector4() },
};

function texValue(p, v, meshMap, onLoad) {
  const tv = v || { tex: p.default, tiling: [1, 1], offset: [0, 0] };
  let tex;
  if (tv.tex === '@mesh') tex = meshMap || getBuiltinTex('white');
  else if (['white', 'black', 'gray', 'bump'].includes(tv.tex)) tex = getBuiltinTex(tv.tex);
  else tex = getMaterialTexture(tv.tex, p.linear, onLoad);
  return { tex, st: new THREE.Vector4(tv.tiling[0], tv.tiling[1], tv.offset[0], tv.offset[1]) };
}
export function propUniformValue(p, v, meshMap, onLoad) {
  switch (p.type) {
    case 'color': { const c = parseColorLinear(v ?? p.default); return new THREE.Vector4(c[0], c[1], c[2], c[3]); }
    case 'hdrColor': { const o = v ?? p.default; const c = parseColorLinear(o.color); const k = o.intensity; return new THREE.Vector4(c[0] * k, c[1] * k, c[2] * k, c[3]); }
    case 'vector': { const a = v ?? p.default; return new THREE.Vector4(a[0], a[1], a[2], a[3]); }
    case 'toggle': return (v ?? p.default) ? 1 : 0;
    case 'texture': return texValue(p, v, meshMap, onLoad);
    default: return v ?? p.default;
  }
}

// URP yüzey modundan (_Surface/_Blend/_Cull) ya da shader.renderState'ten three durumları
export function renderStateOf(shader, values) {
  const rs = { ...shader.renderState };
  if (shader.urpSurface) {
    const surf = +(values?._Surface ?? 0), bl = +(values?._Blend ?? 0), cu = +(values?._Cull ?? 2);
    rs.blend = surf < 0.5 ? 'opaque' : ['alpha', 'premultiply', 'additive', 'multiply'][Math.round(bl)] || 'alpha';
    rs.cull = ['off', 'front', 'back'][Math.round(cu)] || 'back'; rs.zwrite = surf < 0.5;
  }
  return rs;
}
function applyState(mat, rs) {
  mat.side = rs.cull === 'off' ? THREE.DoubleSide : rs.cull === 'front' ? THREE.BackSide : THREE.FrontSide;
  mat.depthWrite = rs.zwrite;
  mat.depthFunc = { lequal: THREE.LessEqualDepth, less: THREE.LessDepth, equal: THREE.EqualDepth, gequal: THREE.GreaterEqualDepth, greater: THREE.GreaterDepth, notequal: THREE.NotEqualDepth, always: THREE.AlwaysDepth }[rs.ztest] ?? THREE.LessEqualDepth;
  mat.transparent = rs.blend !== 'opaque';
  if (rs.blend === 'opaque') mat.blending = THREE.NoBlending;
  else {
    mat.blending = THREE.CustomBlending; mat.blendEquation = THREE.AddEquation;
    const f = { alpha: [THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor], additive: [THREE.SrcAlphaFactor, THREE.OneFactor], premultiply: [THREE.OneFactor, THREE.OneMinusSrcAlphaFactor], multiply: [THREE.DstColorFactor, THREE.ZeroFactor] }[rs.blend];
    [mat.blendSrc, mat.blendDst] = f;
  }
}

// mesh: hedef mesh (SkinnedMesh olabilir) · values: materyal değerleri · meshMap: '@mesh' için mesh'in özgün dokusu
export function createUPEMaterial(shader, values, { meshMap = null, vertexColors = false, onTexture } = {}) {
  const uniforms = { ...shared };
  for (const p of shader.properties) {
    const u = propUniformValue(p, values?.[p.name], meshMap, onTexture);
    if (p.type === 'texture') { uniforms[p.name] = { value: u.tex }; uniforms[p.name + '_ST'] = { value: u.st }; } else uniforms[p.name] = { value: u };
  }
  const mk = (outline) => {
    const pr = buildPrograms(shader, { outline });
    const m = new THREE.ShaderMaterial({ vertexShader: pr.vertexShader, fragmentShader: pr.fragmentShader, uniforms, vertexColors });
    if (outline) { m.side = THREE.BackSide; m.depthWrite = true; m.transparent = false; m.blending = THREE.NoBlending; }
    else applyState(m, renderStateOf(shader, values));
    m.userData.upeWarnings = pr.warnings; return m;
  };
  const main = mk(false);
  const outline = shader.outline.enabled ? mk(true) : null;
  return { main, outline, uniforms, warnings: main.userData.upeWarnings };
}
// VFX emitter materyali: parçacık programı + materyal değerleri + emitter'ın quad uniform'ları (uMode, uTiles…). blend: sıralama için
export function createUPEParticleMaterial(shader, values, particleUniforms, { onTexture, distortion = false, soft = false, decal = false, depth = false } = {}) {
  const uniforms = { ...shared, ...particleUniforms };
  for (const p of shader.properties) {
    const u = propUniformValue(p, values?.[p.name], null, onTexture);
    if (p.type === 'texture') { uniforms[p.name] = { value: u.tex }; uniforms[p.name + '_ST'] = { value: u.st }; } else uniforms[p.name] = { value: u };
  }
  const rs = renderStateOf(shader, values);
  const pr = buildParticlePrograms(shader, { distortion, soft, softRgb: rs.blend === 'premultiply', decal, depth });
  const m = new THREE.ShaderMaterial({ vertexShader: pr.vertexShader, fragmentShader: pr.fragmentShader, uniforms });
  applyState(m, rs);
  if (distortion) { m.transparent = true; m.depthWrite = false; m.blending = THREE.NormalBlending; } // sahne rengini yerine yazar
  m.userData.upeWarnings = pr.warnings;
  return { material: m, blend: rs.blend, warnings: pr.warnings };
}
// var olan örnekte değerleri güncelle (yeniden derlemeden)
export function updateUPEValues(inst, shader, values, meshMap, onTexture) {
  for (const p of shader.properties) {
    const u = propUniformValue(p, values?.[p.name], meshMap, onTexture);
    if (p.type === 'texture') { inst.uniforms[p.name].value = u.tex; inst.uniforms[p.name + '_ST'].value = u.st; } else if (inst.uniforms[p.name]) inst.uniforms[p.name].value = u;
  }
  applyState(inst.main, renderStateOf(shader, values));
}
