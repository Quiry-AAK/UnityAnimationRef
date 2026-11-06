// VFX önizleme motoru: Unity ParticleSystem (Shuriken) davranışını CPU'da taklit eder, three.js ile instanced quad çizer.
// Simülasyon Unity koordinatlarında (sol-el) yapılır; görüntüye X aynasıyla taşınır (three = (-x, y, z), animasyon
// importer'ıyla aynı dönüşüm). Sabit adım + tohumlu RNG: aynı efekt aynı zamanda hep aynı görüntüyü verir.
import * as THREE from 'three';
import { evalCurve, parseColor } from './vfx-schema.js';
import { createUPEParticleMaterial } from './shader-compile.js';
import { proceduralMesh, transformMesh } from './vfx-mesh.js';

export const STEP = 1 / 60;
const D2R = Math.PI / 180;
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

function mulberry32(seed) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (rng, r) => lerp(r[0], r[1], rng());
export const unityQuat = (deg, out = new THREE.Quaternion()) => out.setFromEuler(new THREE.Euler(deg[0] * D2R, deg[1] * D2R, deg[2] * D2R, 'YXZ')); // Unity Euler: Z→X→Y

// ── 3B değer gürültüsü (noise modülü), [-1,1]
function hash3(x, y, z) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return ((h >>> 0) / 4294967295) * 2 - 1; }
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const c = (a, b, d) => hash3(xi + a, yi + b, zi + d);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u), x10 = lerp(c(0, 1, 0), c(1, 1, 0), u), x01 = lerp(c(0, 0, 1), c(1, 0, 1), u), x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
function fnoise(x, y, z, oct) { let s = 0, a = 1, n = 0; for (let o = 0; o < oct; o++) { s += a * vnoise3(x, y, z); n += a; a *= 0.5; x *= 2; y *= 2; z *= 2; } return s / n; }

// ── doku önbelleği
const texCache = new Map();
let fallbackTex = null;
function getFallback() {
  if (fallbackTex) return fallbackTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  fallbackTex = new THREE.CanvasTexture(c); fallbackTex.colorSpace = THREE.SRGBColorSpace; return fallbackTex;
}
const texReady = new Map(); // ad → yükleme sözü (render dokular gelmeden çizmesin)
export function getTexture(name, onLoad, repeat = false) { // repeat: döşenen iz / kayan bükülme dokusu (ayrı önbellek girdisi)
  const key = repeat ? name + '|rep' : name;
  if (!texCache.has(key)) {
    let done; texReady.set(key, new Promise((r) => { done = r; }));
    const t = new THREE.TextureLoader().load('/vfx-textures/' + encodeURIComponent(name) + '.png?v=' + Date.now(), () => { done(); onLoad?.(); }, undefined, () => { texCache.set(key, getFallback()); done(); onLoad?.(); });
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; texCache.set(key, t);
  }
  return texCache.get(key);
}
export const texturesLoaded = () => Promise.all([...texReady.values()]);
export const clearTextureCache = () => { texCache.clear(); texReady.clear(); };

// ── shader: billboard / stretched / horizontal / vertical, flipbook, sRGB köşe rengi → doğrusal × intensity (Unity Linear proje gibi)
const VERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iCol; attribute vec4 iSRF;
uniform int uMode; uniform float uLengthScale, uVelScale; uniform vec2 uTiles; uniform mat3 uAlign;
varying vec2 vUv; varying vec4 vCol;
void main() {
  vec2 c = position.xy; float size = iSRF.x, rot = iSRF.y;
  float cs = cos(rot), sn = sin(rot);
  vec2 rc = vec2(c.x * cs + c.y * sn, -c.x * sn + c.y * cs); // pozitif açı = saat yönü (Unity gibi)
  vec4 mv;
  if (uMode == 1) {
    mv = modelViewMatrix * vec4(iPos, 1.0);
    vec3 vv = mat3(modelViewMatrix) * iVel; float sp = length(iVel);
    vec2 d = length(vv.xy) > 1e-5 ? normalize(vv.xy) : vec2(0.0, 1.0); vec2 pr = vec2(-d.y, d.x);
    float len = size * uLengthScale + sp * uVelScale;
    mv.xy += pr * c.x * size + d * c.y * len;
  } else if (uMode == 2) {
    vec4 wp = modelMatrix * vec4(iPos, 1.0); wp.xyz += vec3(rc.x, 0.0, -rc.y) * size; mv = viewMatrix * wp;
  } else if (uMode == 3) {
    vec4 wp = modelMatrix * vec4(iPos, 1.0);
    vec3 tc = cameraPosition - wp.xyz; tc.y = 0.0; vec3 f = length(tc) > 1e-5 ? normalize(tc) : vec3(0.0, 0.0, 1.0);
    vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
    wp.xyz += (r * rc.x + vec3(0.0, 1.0, 0.0) * rc.y) * size; mv = viewMatrix * wp;
  } else if (uMode == 5) {
    mv = modelViewMatrix * vec4(iPos, 1.0); // kılıç izi şeridi: köşe konumu hazır (dünya), uv = iSRF.zw
  } else if (uMode == 4) {
    mv = modelViewMatrix * vec4(iPos + uAlign * vec3(rc, 0.0) * size, 1.0); // Local hizalama: emitter'ın XY düzlemi (Unity koordinatı, ayna modelMatrix'te)
  } else if (uMode == 6) { // mesh: yerel mesh × boyut, yerel Z etrafında dönüş (quad ile aynı yön), emitter dönüşü
    vec3 lp = position * size; lp.xy = vec2(lp.x * cs + lp.y * sn, -lp.x * sn + lp.y * cs);
    mv = modelViewMatrix * vec4(iPos + uAlign * lp, 1.0);
  } else {
    mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += rc * size;
  }
  gl_Position = projectionMatrix * mv;
  float tiles = uTiles.x * uTiles.y, fr = mod(floor(iSRF.z + 0.5), tiles);
  vec2 cell = vec2(mod(fr, uTiles.x), uTiles.y - 1.0 - floor(fr / uTiles.x));
  vUv = uMode == 5 ? iSRF.zw : uMode == 6 ? (cell + uv) / uTiles : (cell + c + 0.5) / uTiles; vCol = iCol;
}`;
const FRAG = /* glsl */`
#include <packing>
uniform sampler2D uMap; uniform float uIntensity;
#ifdef UPE_SOFT
uniform sampler2D uDepth; uniform vec2 uSceneRes; uniform float uCamNear, uCamFar, uSoft;
#endif
varying vec2 vUv; varying vec4 vCol;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec4 col = vec4(toLinear(vCol.rgb) * uIntensity, vCol.a) * t; // Unity (Linear proje) köşe rengini ve _BaseColor'ı doğrusala çevirir: kalibrasyonla ölçüldü
  #ifdef UPE_SOFT
  // yumuşak parçacık: arkadaki yüzeyle kamera derinliği farkı / mesafe (Unity Soft Particles, UE DepthFade)
  float sz = -perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uSceneRes).x, uCamNear, uCamFar);
  float pz = -perspectiveDepthToViewZ(gl_FragCoord.z, uCamNear, uCamFar);
  col.a *= clamp((sz - pz) / uSoft, 0.0, 1.0);
  #endif
  if (col.a < 0.002) discard;
  gl_FragColor = col;
}`;
// yere iz (decal): birim kutu parçacık başına; kutunun arka yüzleri çizilir (derinlik testi yok), parça sahne derinliğinden
// dünya konumu kurulur, iz kutusunun yereline çevrilir, dışındaysa atılır. Eksenler three dünyasında: ax (en), ay (boy), pr (yansıtma).
// down: Unity dünyasında en = +X, boy = +Z, yansıtma = −Y; forward: emitter ekseni X, Y, +Z. Dönüş yansıtma ekseni etrafında.
export const DECAL_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iSRF;
uniform mat3 uAlign; uniform vec3 uDSize; uniform int uDProj; uniform vec2 uTiles;
varying vec4 vCol; varying vec3 vDC, vDX, vDY, vDP, vDS; varying float vFrame;
void main() {
  float size = iSRF.x, rot = iSRF.y, cs = cos(rot), sn = sin(rot);
  vec3 ex, ey, ep;
  if (uDProj == 1) { mat3 M = mat3(modelMatrix) * uAlign; ex = normalize(M * vec3(1.0, 0.0, 0.0)); ey = normalize(M * vec3(0.0, 1.0, 0.0)); ep = normalize(M * vec3(0.0, 0.0, 1.0)); }
  else { ex = vec3(-1.0, 0.0, 0.0); ey = vec3(0.0, 0.0, 1.0); ep = vec3(0.0, -1.0, 0.0); } // Unity +X, +Z, −Y (three = x aynası)
  vec3 rx = ex * cs - ey * sn, ry = ex * sn + ey * cs; // pozitif açı saat yönü (quad ile aynı)
  vec3 s = uDSize * size, c = (modelMatrix * vec4(iPos, 1.0)).xyz;
  vec3 w = c + rx * position.x * s.x + ry * position.y * s.y + ep * position.z * s.z;
  vDC = c; vDX = rx; vDY = ry; vDP = ep; vDS = s; vCol = iCol; vFrame = iSRF.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const DECAL_COMMON = /* glsl */`
uniform sampler2D uDepth; uniform vec2 uSceneRes; uniform mat4 uInvProj, uCamWorld; uniform float uGroundOnly;
varying vec3 vDC, vDX, vDY, vDP, vDS;
// sahne yüzeyi → iz yereli (−0,5..0,5); dışındaysa false
bool upeDecal(out vec3 l, out vec3 wp, out vec3 n) {
  vec2 suv = gl_FragCoord.xy / uSceneRes; float d = texture2D(uDepth, suv).x;
  if (d >= 0.99999) return false;
  vec4 vp = uInvProj * vec4(suv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vp /= vp.w; wp = (uCamWorld * vp).xyz;
  vec3 r = wp - vDC; l = vec3(dot(r, vDX) / vDS.x, dot(r, vDY) / vDS.y, dot(r, vDP) / vDS.z);
  if (any(greaterThan(abs(l), vec3(0.5)))) return false;
  n = normalize(cross(dFdx(wp), dFdy(wp))); if (dot(n, vDP) > 0.0) n = -n;
  if (uGroundOnly > 0.5 && dot(-n, vDP) < 0.7) return false; // yansıtma yönüne bakmayan yüzey (kahramanın yanı) atlanır
  return true;
}`;
export const DECAL_FRAG = /* glsl */`
uniform sampler2D uMap; uniform float uIntensity; uniform vec2 uTiles;
varying vec4 vCol; varying float vFrame;
${DECAL_COMMON}
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec3 l, wp, n; if (!upeDecal(l, wp, n)) discard;
  float tiles = uTiles.x * uTiles.y, fr = mod(floor(vFrame + 0.5), tiles);
  vec2 cell = vec2(mod(fr, uTiles.x), uTiles.y - 1.0 - floor(fr / uTiles.x));
  vec4 t = texture2D(uMap, (cell + l.xy + 0.5) / uTiles);
  vec4 col = vec4(toLinear(vCol.rgb) * uIntensity, vCol.a) * t;
  col.a *= 1.0 - smoothstep(0.35, 0.5, abs(l.z)); // derinlik ucunda yumuşak
  if (col.a < 0.002) discard;
  gl_FragColor = col;
}`;
export { DECAL_COMMON };
const MODE = { billboard: 0, stretched: 1, horizontal: 2, vertical: 3, mesh: 6 };
// bükülme (renderer.blend = 'distortion'): sahne rengi ayrı hedefe alınır (EffectPlayer.sceneTarget), parçacık o dokuyu ekran
// konumu + ofsetle örnekler. Ofset = yön × maske (doku alfası × parçacık alfası) × güç; maske kenarında ofset 0 → dikişsiz.
// yön: radial = quad/mesh UV merkezinden dışa, noise = kayan 2B gradyan gürültü, normal = doku RG (×2−1).
const DIST_FRAG = /* glsl */`
uniform sampler2D uMap, uScene; uniform vec2 uSceneRes, uScroll; uniform float uStrength, uFreq, uTime; uniform int uDMode;
varying vec2 vUv; varying vec4 vCol;
vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453) * 2.0 - 1.0; }
float gnoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(h22(i), f), dot(h22(i + vec2(1, 0)), f - vec2(1, 0)), u.x), mix(dot(h22(i + vec2(0, 1)), f - vec2(0, 1)), dot(h22(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y); }
void main() {
  vec2 uvT = uDMode == 2 ? vUv + uScroll * uTime : vUv;
  vec4 t = texture2D(uMap, uvT);
  float mask = vCol.a * t.a; vec2 dir;
  if (uDMode == 0) { vec2 q = vUv - 0.5; dir = length(q) > 1e-4 ? normalize(q) : vec2(0.0); }
  else if (uDMode == 1) { vec2 p = vUv * uFreq + uScroll * uTime; dir = vec2(gnoise(p), gnoise(p + vec2(17.3, 5.1))) * 1.6; }
  else dir = t.rg * 2.0 - 1.0;
  if (mask < 0.002) discard;
  gl_FragColor = vec4(texture2D(uScene, gl_FragCoord.xy / uSceneRes + dir * mask * uStrength).rgb, 1.0);
}`;
export const DIST_MODE = { radial: 0, noise: 1, normal: 2 };
// oynatıcı ortak uniform'ları: sahne rengi + derinliği (vfx.js sahne hedefi), kamera (decal yeniden kurulumu), zaman
export const newShared = () => ({ uScene: { value: null }, uDepth: { value: null }, uSceneRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
  uCamNear: { value: 0.1 }, uCamFar: { value: 100 }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() } });
// parçacık geometrisi: quad ya da mesh (renderer.mode = 'mesh'); mesh verisi { positions, normals, uvs, indices } (Unity yereli)
export function meshDataFor(r, meshFor) {
  const m = r.mesh;
  if (m.shape === 'file') { const g = meshFor?.(m.file); return g ? transformMesh(g, m.rotation) : null; }
  return transformMesh(proceduralMesh(m), m.rotation);
}

// ── tek emitter: parçacık havuzu + Unity modül davranışı
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _m2 = new THREE.Matrix4(), _qi2 = new THREE.Quaternion(), _ev = new THREE.Vector3(), _evv = new THREE.Vector3();
const _Ei = new THREE.Matrix4(), _qe = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _pa = new THREE.Vector3(), _pi = new THREE.Vector3(), _pc = new THREE.Vector3(), _si = new THREE.Vector3();
class EmitterSim {
  // upe: { shader, values } — renderer.material kütüphaneden çözüldüyse; yoksa doku/karışım/parlaklıkla yerleşik çizim
  // opts: { meshFor (dosya mesh'i), shared ({ uScene, uSceneRes, uTime } bükülme için oynatıcı ortak uniform'ları) }
  constructor(em, seed, onTexture, upe = null, opts = {}) {
    this.em = em; this.seed = seed;
    this.events = []; this.subs = null; this.subTarget = false; // alt emitter: doğum/ölüm olayları (EffectPlayer dağıtır)
    const cap = Math.max(1, em.main.maxParticles); this.cap = cap;
    this.P = new Float32Array(cap * 3); this.V = new Float32Array(cap * 3); this.D = new Float32Array(cap * 3);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap); this.size = new Float32Array(cap); this.rot = new Float32Array(cap);
    this.angv = new Float32Array(cap); this.col = new Float32Array(cap * 4); this.frame0 = new Float32Array(cap);
    this.world = em.main.simulationSpace === 'world';
    const ca = parseColor(em.main.startColor[0]) || [1, 1, 1, 1], cb = parseColor(em.main.startColor[1]) || ca; this.ca = ca; this.cb = cb;
    // shape matrisi (kutu ölçeği yalnız box'ta)
    const sh = em.shape;
    this.shapeM = new THREE.Matrix4().compose(new THREE.Vector3(...sh.position), unityQuat(sh.rotation), sh.type === 'box' ? new THREE.Vector3(...sh.boxSize) : new THREE.Vector3(1, 1, 1));
    this.shapeQ = unityQuat(sh.rotation);
    // çizim
    const r = em.renderer, ts = em.textureSheet;
    const g = new THREE.InstancedBufferGeometry();
    const md = r.mode === 'mesh' ? meshDataFor(r, opts.meshFor) : null;
    this.meshPending = r.mode === 'mesh' && !md; // dosya mesh'i yükleniyor: o arada quad çizilir
    const decal = r.mode === 'decal'; this.decal = decal;
    if (decal) { const b = new THREE.BoxGeometry(1, 1, 1); g.setAttribute('position', b.attributes.position); g.setIndex(b.index); }
    else if (md) { // mesh: Unity yerelinde geometri; sarım -Z ön yüz (UPE quad'ı gibi), yerleşik çizim iki yüzlü
      g.setAttribute('position', new THREE.BufferAttribute(md.positions, 3)); g.setAttribute('normal', new THREE.BufferAttribute(md.normals, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(md.uvs, 2)); g.setIndex(new THREE.BufferAttribute(md.indices, 1));
    } else {
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
      // UPE materyalinde ters sarım: düğüm X aynalı (three ön yüzü çevirir), quad kameraya ön yüzünü versin (Unity'deki gibi; cull back çalışır)
      g.setIndex(upe ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    }
    const ia = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', ia(3)); g.setAttribute('iVel', ia(3)); g.setAttribute('iCol', ia(4)); g.setAttribute('iSRF', ia(4)); g.setAttribute('iCus', ia(4));
    g.instanceCount = 0;
    const local = (r.mode === 'billboard' && r.alignment === 'local');
    const quad = { uMode: { value: md ? 6 : local ? 4 : r.mode === 'mesh' ? 0 : MODE[r.mode] ?? 0 }, uLengthScale: { value: r.lengthScale }, uVelScale: { value: r.velocityScale },
      uTiles: { value: new THREE.Vector2(ts.enabled ? ts.tilesX : 1, ts.enabled ? ts.tilesY : 1) },
      uAlign: { value: new THREE.Matrix3() } }; // Local/mesh: dünya simülasyonunda emitter dönüşü (step'te), yerelde birim
    this.quad = quad; this.alignM = new THREE.Matrix4();
    const dist = r.blend === 'distortion' && !decal; this.distortion = dist;
    const soft = !!r.softParticles?.enabled && !decal && !dist; this.soft = soft;
    const shu = opts.shared || newShared();
    const dU = { ...shu, uStrength: { value: r.distortion.strength }, uSoft: { value: Math.max(0.001, r.softParticles?.distance ?? 0.3) },
      uDSize: { value: new THREE.Vector3(...(r.decal?.size || [1, 1, 0.5])) }, uDProj: { value: r.decal?.projection === 'forward' ? 1 : 0 }, uGroundOnly: { value: r.decal?.groundOnly === false ? 0 : 1 } };
    if (decal) quad.uMode.value = 7;
    this.needsDepth = soft || decal || dist || !!(upe && /\.(sceneDepth|softFade)\b/.test(upe.shader.code.common + upe.shader.code.fragment));
    if (upe) {
      const u = createUPEParticleMaterial(upe.shader, upe.values, { ...quad, ...dU }, { onTexture, distortion: dist, soft, decal, depth: this.needsDepth });
      this.mat = u.material; this.sortBack = dist || ['alpha', 'premultiply', 'multiply'].includes(u.blend);
      if (decal) { this.mat.side = THREE.BackSide; this.mat.depthTest = false; this.mat.depthWrite = false; this.mat.transparent = true; }
    } else if (decal) {
      this.mat = new THREE.ShaderMaterial({
        vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG, transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
        blending: r.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uMap: { value: getTexture(r.texture, onTexture) }, uIntensity: { value: r.intensity }, ...dU, ...quad },
      });
      this.sortBack = true;
    } else if (dist) {
      const d = r.distortion;
      this.mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: DIST_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending,
        uniforms: { uMap: { value: getTexture(r.texture, onTexture, d.mode === 'normal') }, uDMode: { value: DIST_MODE[d.mode] ?? 0 }, uFreq: { value: d.frequency },
          uScroll: { value: new THREE.Vector2(...d.scroll) }, ...dU, ...quad },
      });
      this.sortBack = true;
    } else {
      this.mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, defines: soft ? { UPE_SOFT: '' } : {},
        blending: r.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uMap: { value: getTexture(r.texture, onTexture) }, uIntensity: { value: r.intensity }, ...(soft ? dU : {}), ...quad },
      });
      this.sortBack = r.blend === 'alpha';
    }
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.reset();
  }
  reset() { const m = this.em.main; this.n = 0; this.te = m.prewarm && m.looping ? 0 : -m.startDelay; this.accum = 0; this.rng = mulberry32(this.seed); this.prewarmed = false; this.prevOk = false; this.prevP ??= new THREE.Vector3(); this.prevQ ??= new THREE.Quaternion(); } // prewarm'da gecikme yok sayılır (Unity gibi)
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }

  // şekilden doğum noktası ve yönü (emitter yereli)
  shapeSample(pos, dir) {
    const sh = this.em.shape, rng = this.rng;
    if (!sh.enabled) { pos.set(0, 0, 0); dir.set(0, 0, 1); return; }
    const R = sh.radius, th = sh.radiusThickness, arc = sh.arc * D2R;
    const annulus = () => Math.sqrt(lerp((1 - th) ** 2, 1, rng()));
    const randUnit = (out) => { const z = rng() * 2 - 1, a = rng() * Math.PI * 2, s = Math.sqrt(1 - z * z); return out.set(s * Math.cos(a), s * Math.sin(a), z); };
    switch (sh.type) {
      case 'sphere': case 'hemisphere': {
        randUnit(dir); if (sh.type === 'hemisphere') dir.z = Math.abs(dir.z);
        pos.copy(dir).multiplyScalar(R * Math.cbrt(lerp((1 - th) ** 3, 1, rng()))); break;
      }
      case 'box': pos.set(rng() - 0.5, rng() - 0.5, rng() - 0.5); dir.set(0, 0, 1); break;
      case 'circle': { const a = rng() * arc, r = R * annulus(); dir.set(Math.cos(a), Math.sin(a), 0); pos.copy(dir).multiplyScalar(r); break; }
      case 'edge': pos.set((rng() * 2 - 1) * R, 0, 0); dir.set(0, 1, 0); break;
      case 'donut': {
        const a = rng() * arc, psi = rng() * Math.PI * 2, tr = sh.donutRadius * annulus();
        const ex = Math.cos(a), ey = Math.sin(a);
        dir.set(ex * Math.cos(psi), ey * Math.cos(psi), Math.sin(psi));
        pos.set(ex * R, ey * R, 0).addScaledVector(dir, tr); break;
      }
      default: { // cone: taban XY düzleminde, +Z'ye açılır; kenara doğru yön açıya yaklaşır
        const a = rng() * arc, ang = sh.angle * D2R;
        if (R > 1e-5) {
          const rn = annulus(); pos.set(Math.cos(a) * R * rn, Math.sin(a) * R * rn, 0);
          const t = ang * rn; dir.set(Math.cos(a) * Math.sin(t), Math.sin(a) * Math.sin(t), Math.cos(t));
        } else {
          const ct = lerp(1, Math.cos(ang), rng()), st = Math.sqrt(Math.max(0, 1 - ct * ct));
          pos.set(0, 0, 0); dir.set(Math.cos(a) * st, Math.sin(a) * st, ct);
        }
      }
    }
    if (sh.randomDirection > 0) { randUnit(_w); dir.lerp(_w, sh.randomDirection); if (dir.lengthSq() < 1e-8) dir.copy(_w); dir.normalize(); }
    pos.applyMatrix4(this.shapeM); dir.applyQuaternion(this.shapeQ);
  }

  // ev: alt emitter olayı { p, v (Unity dünyası), col, size, inherit } — doğum noktası olayın konumu (şekil emitter dönüşüyle çevresinde)
  spawn(E, EQ, age, ev = null) {
    if (this.n >= this.cap) return;
    const m = this.em.main, rng = this.rng, i = this.n++;
    this.shapeSample(_p, _v);
    _v.multiplyScalar(rnd(rng, m.startSpeed));
    if (ev) {
      _p.applyQuaternion(EQ).add(_w.fromArray(ev.p)); _v.applyQuaternion(EQ);
      if (ev.inherit.velocity) _v.addScaledVector(_w.fromArray(ev.v), ev.inherit.velocity);
      if (!this.world) { _m2.copy(E).invert(); _p.applyMatrix4(_m2); _qi2.copy(EQ).invert(); _v.applyQuaternion(_qi2); }
    } else if (this.world) { _p.applyMatrix4(E); _v.applyQuaternion(EQ); }
    this.P.set([_p.x + _v.x * age, _p.y + _v.y * age, _p.z + _v.z * age], i * 3); this.V.set([_v.x, _v.y, _v.z], i * 3); this.D.set([_v.x, _v.y, _v.z], i * 3);
    this.age[i] = age; this.life[i] = Math.max(0.001, rnd(rng, m.startLifetime));
    this.size[i] = rnd(rng, m.startSize); this.rot[i] = rnd(rng, m.startRotation);
    const ro = this.em.rotationOverLifetime; this.angv[i] = ro.enabled ? rnd(rng, ro.angularVelocity) : 0;
    const t = rng(); for (let k = 0; k < 4; k++) this.col[i * 4 + k] = lerp(this.ca[k], this.cb[k], t);
    const ts = this.em.textureSheet; this.frame0[i] = ts.enabled && ts.randomStart ? Math.floor(rng() * ts.tilesX * ts.tilesY) : 0;
    if (ev?.inherit.color) for (let k = 0; k < 4; k++) this.col[i * 4 + k] *= ev.col[k];
    if (ev?.inherit.size) this.size[i] *= ev.size;
    if (this.subs?.birth) this.emitEvent('birth', i, E, EQ);
  }
  // alt emitter olayı: parçacığın o anki Unity dünya konumu/hızı/rengi/boyutu
  emitEvent(trigger, i, E, EQ) {
    const o = i * 3; _ev.set(this.P[o], this.P[o + 1], this.P[o + 2]); _evv.set(this.D[o], this.D[o + 1], this.D[o + 2]);
    if (!this.world) { _ev.applyMatrix4(E); _evv.applyQuaternion(EQ); }
    const tn = this.age[i] / this.life[i], col = this.em.colorOverLifetime, c = [0, 1, 2, 3].map((k) => this.col[i * 4 + k]);
    if (col.enabled) { const cs = col.color.map(([tt, h]) => [tt, parseColor(h) || [1, 1, 1, 1]]); for (let k = 0; k < 3; k++) c[k] *= evalCurve(cs.map(([tt, x]) => [tt, x[k]]), tn); } // alfa mirası yok: ölümde ömür alfası ~0 olur, çocuk görünmez kalırdı
    const sz = this.em.sizeOverLifetime;
    this.events.push({ trigger, p: _ev.toArray(), v: _evv.toArray(), col: c, size: this.size[i] * (sz.enabled ? evalCurve(sz.curve, tn) : 1) });
  }
  kill(i) {
    const j = --this.n; if (i === j) return;
    for (const [a, w] of [[this.P, 3], [this.V, 3], [this.D, 3], [this.col, 4]]) a.copyWithin(i * w, j * w, j * w + w);
    for (const a of [this.age, this.life, this.size, this.rot, this.angv, this.frame0]) a[i] = a[j];
  }

  // E: emitter yerelinden Unity dünyasına matris, EQ: dönüşü
  step(dt, E, EQ) {
    const em = this.em, m = em.main;
    if (!this.prewarmed) { this.prewarmed = true; if (m.prewarm && m.looping && this.te >= 0) { const te = this.te; for (let t = 0; t < m.duration; t += dt) this.step(dt, E, EQ); this.te = te; } }
    if (this.world) this.quad.uAlign.value.setFromMatrix4(this.alignM.makeRotationFromQuaternion(EQ)); // Unity Local: o anki emitter dönüşü
    // ── mevcut parçacıklar
    _qi.copy(EQ).invert();
    const toSpace = (vec, space, out) => { out.set(...vec); if (space === 'world' && !this.world) out.applyQuaternion(_qi); else if (space === 'local' && this.world) out.applyQuaternion(EQ); return out; };
    const acc = new THREE.Vector3(0, -9.81 * m.gravity, 0); if (!this.world) acc.applyQuaternion(_qi);
    if (em.force.enabled) acc.add(toSpace(em.force.force, em.force.space, _w));
    const vel = em.velocity, lim = em.limitVelocity, nz = em.noise;
    const lin = vel.enabled ? toSpace(vel.linear, vel.space, new THREE.Vector3()) : null;
    const orb = vel.enabled ? toSpace(vel.orbital, vel.space, new THREE.Vector3()) : null;
    const center = this.world ? new THREE.Vector3().setFromMatrixPosition(E) : new THREE.Vector3();
    const sm = vel.enabled ? vel.speedModifier : 1;
    const dampK = lim.enabled ? 1 - Math.pow(1 - lim.dampen, dt * 60) : 0; // Unity: sınır aşımı kare başına dampen oranında kırpılır (60 fps)
    const nt = this.te * nz.scrollSpeed;
    const P = this.P, V = this.V, D = this.D;
    this.events.length = 0;
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt; if (this.age[i] >= this.life[i]) { if (this.subs?.death) this.emitEvent('death', i, E, EQ); this.kill(i); continue; }
      const o = i * 3;
      let vx = V[o] + acc.x * dt, vy = V[o + 1] + acc.y * dt, vz = V[o + 2] + acc.z * dt;
      if (lim.enabled) {
        let sp = Math.hypot(vx, vy, vz);
        if (lim.drag > 0 && sp > 1e-6) { const k = Math.max(0, sp - lim.drag * dt) / sp; vx *= k; vy *= k; vz *= k; sp *= k; } // Unity: sabit yavaşlama (drag m/sn²), Unity'de ölçüldü
        if (sp > lim.limit && sp > 1e-6) { const f = lerp(1, lim.limit / sp, dampK); vx *= f; vy *= f; vz *= f; }
      }
      V[o] = vx; V[o + 1] = vy; V[o + 2] = vz;
      let ex = 0, ey = 0, ez = 0;
      if (vel.enabled) {
        const rx = P[o] - center.x, ry = P[o + 1] - center.y, rz = P[o + 2] - center.z;
        ex += lin.x + orb.y * rz - orb.z * ry; ey += lin.y + orb.z * rx - orb.x * rz; ez += lin.z + orb.x * ry - orb.y * rx;
        if (vel.radial) { const l = Math.hypot(rx, ry, rz) || 1; ex += (rx / l) * vel.radial; ey += (ry / l) * vel.radial; ez += (rz / l) * vel.radial; }
      }
      if (nz.enabled) {
        const f = nz.frequency, x = P[o] * f, y = P[o + 1] * f, z = P[o + 2] * f;
        ex += fnoise(x + 17.1, y + nt, z, nz.octaves) * nz.strength; ey += fnoise(x, y + 41.7 + nt, z + 3.3, nz.octaves) * nz.strength; ez += fnoise(x + 9.2, y + nt, z + 71.9, nz.octaves) * nz.strength;
      }
      D[o] = (vx + ex) * sm; D[o + 1] = (vy + ey) * sm; D[o + 2] = (vz + ez) * sm;
      P[o] += D[o] * dt; P[o + 1] += D[o + 1] * dt; P[o + 2] += D[o + 2] * dt;
    }
    // ── yayım. Unity gibi: hareket eden dünya emitter'ında kare içindeki doğumlar önceki ve şimdiki emitter konumu arasına yayılır
    // (hızlı kılıç izi boncuklanmaz). Işınlanma (>2 m/kare) aradeğerlenmez.
    let lerpE = false;
    if (this.world) {
      _pc.setFromMatrixPosition(E);
      if (this.prevOk && this.prevP.distanceToSquared(_pc) < 4) { lerpE = true; _pa.copy(this.prevP); _qa.copy(this.prevQ); _si.setFromMatrixScale(E); }
      this.prevP.copy(_pc); this.prevQ.copy(EQ); this.prevOk = true;
    }
    const te0 = this.te, te1 = te0 + dt; this.te = te1;
    if (te1 <= 0 || this.subTarget) return; // alt emitter hedefi kendi yayımını yapmaz (yalnız olaylarla doğar)
    const dur = m.duration, a0 = Math.max(0, te0);
    let count = 0;
    const window = m.looping ? te1 - a0 : Math.max(0, Math.min(te1, dur) - a0);
    if (window > 0 && em.emission.rateOverTime > 0) { this.accum += em.emission.rateOverTime * window; count = Math.floor(this.accum); this.accum -= count; }
    const k0 = Math.floor(a0 / dur), k1 = m.looping ? Math.floor(te1 / dur) : 0;
    for (let k = k0; k <= k1; k++) {
      const lo = a0 - k * dur, hi = Math.min(te1 - k * dur, dur);
      for (const b of em.emission.bursts) for (let c = 0; c < b.cycles; c++) {
        const bt = b.time + c * b.interval;
        if (bt >= lo && bt < hi && bt < dur + 1e-9) count += Math.round(lerp(b.count[0], b.count[1], this.rng()));
      }
    }
    for (let j = 0; j < count; j++) {
      const f = (j + 0.5) / count;
      if (lerpE) { _pi.lerpVectors(_pa, _pc, f); _qe.slerpQuaternions(_qa, EQ, f); this.spawn(_Ei.compose(_pi, _qe, _si), _qe, (1 - f) * dt); }
      else this.spawn(E, EQ, (1 - f) * dt);
    }
  }

  // çizim tamponlarını doldur (alfa karışımda kameradan uzaktan yakına sıralı)
  upload(camPos, meshWorldInv) {
    const em = this.em, g = this.mesh.geometry, n = this.n;
    const aP = g.attributes.iPos.array, aV = g.attributes.iVel.array, aC = g.attributes.iCol.array, aS = g.attributes.iSRF.array, aU = g.attributes.iCus.array;
    const cd = em.customData.enabled ? em.customData : null;
    let order = null;
    if (this.sortBack && n > 1) {
      _s.copy(camPos).applyMatrix4(meshWorldInv); const d = new Float32Array(n);
      for (let i = 0; i < n; i++) d[i] = (this.P[i * 3] - _s.x) ** 2 + (this.P[i * 3 + 1] - _s.y) ** 2 + (this.P[i * 3 + 2] - _s.z) ** 2;
      order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[b] - d[a]);
    }
    const col = em.colorOverLifetime, sz = em.sizeOverLifetime, ts = em.textureSheet;
    const tiles = ts.enabled ? ts.tilesX * ts.tilesY : 1;
    const cs = col.enabled ? col.color.map(([t, c]) => [t, parseColor(c) || [1, 1, 1, 1]]) : null;
    const cr = cs && [0, 1, 2].map((ch) => cs.map(([t, c]) => [t, c[ch]]));
    for (let k = 0; k < n; k++) {
      const i = order ? order[k] : k, tn = this.age[i] / this.life[i];
      aP.set(this.P.subarray(i * 3, i * 3 + 3), k * 3); aV.set(this.D.subarray(i * 3, i * 3 + 3), k * 3);
      let r = this.col[i * 4], gg = this.col[i * 4 + 1], b = this.col[i * 4 + 2], a = this.col[i * 4 + 3];
      if (cr) { r *= evalCurve(cr[0], tn); gg *= evalCurve(cr[1], tn); b *= evalCurve(cr[2], tn); a *= evalCurve(col.alpha, tn); }
      aC[k * 4] = r; aC[k * 4 + 1] = gg; aC[k * 4 + 2] = b; aC[k * 4 + 3] = a;
      aS[k * 4] = this.size[i] * (sz.enabled ? evalCurve(sz.curve, tn) : 1);
      aS[k * 4 + 1] = (this.rot[i] + this.angv[i] * this.age[i]) * D2R;
      aS[k * 4 + 2] = ts.enabled ? (Math.floor(((tn * ts.cycles) % 1) * tiles) + this.frame0[i]) % tiles : 0;
      aS[k * 4 + 3] = 0;
      if (cd) { aU[k * 4] = evalCurve(cd.x, tn); aU[k * 4 + 1] = evalCurve(cd.y, tn); aU[k * 4 + 2] = evalCurve(cd.z, tn); aU[k * 4 + 3] = evalCurve(cd.w, tn); }
    }
    g.instanceCount = n;
    for (const k of ['iPos', 'iVel', 'iCol', 'iSRF', 'iCus']) { g.attributes[k].needsUpdate = true; g.attributes[k].addUpdateRange(0, n * g.attributes[k].itemSize); }
  }
}

// ── kılıç izi: emitter'a bağlı kök/uç noktalarının her adımdaki dünya konumu örneklenir, ömrü dolan örnek düşer;
// örnekler Catmull-Rom ile yumuşatılıp tek şerit mesh olur. uv.x = iz yaşı (0 baş → 1 kuyruk; uvMode 'tile': uç yolu boyunca
// metre / tileLength), uv.y = 0 kök → 1 uç. Renk: startColor × colorOverLifetime(yaş). Genişlik = bladeTrail.width(yaş) ×
// sizeOverLifetime(yaş) (açıksa); taper: tip = kök uca doğru kısalır, root = uç köke doğru, center = ikisi ortaya.
const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3();
const crm = (p0, p1, p2, p3, t, o) => { const t2 = t * t, t3 = t2 * t; // Catmull-Rom
  return o.set(0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3)); };
class TrailSim {
  constructor(em, onTexture, upe = null) {
    this.em = em; this.world = true; const bt = em.bladeTrail; this.events = [];
    this.from = new THREE.Vector3(...bt.from); this.to = new THREE.Vector3(...bt.to);
    this.cap = 512; this.S = []; // { t, b, p }
    const vc = this.cap * Math.max(1, bt.subdiv) * 2 + 4; this.vcap = vc;
    const g = new THREE.BufferGeometry(); const a = (n) => new THREE.BufferAttribute(new Float32Array(vc * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', a(3)); g.setAttribute('iPos', a(3)); g.setAttribute('iVel', a(3)); g.setAttribute('iCol', a(4)); g.setAttribute('iSRF', a(4)); g.setAttribute('iCus', a(4));
    const idx = new Uint32Array((vc / 2) * 6); for (let k = 0; k < vc / 2 - 1; k++) idx.set([2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2], k * 6);
    g.setIndex(new THREE.BufferAttribute(idx, 1)); g.setDrawRange(0, 0);
    const quad = { uMode: { value: 5 }, uLengthScale: { value: 0 }, uVelScale: { value: 0 }, uTiles: { value: new THREE.Vector2(1, 1) }, uAlign: { value: new THREE.Matrix3() } };
    if (upe) { const u = createUPEParticleMaterial(upe.shader, upe.values, quad, { onTexture }); this.mat = u.material; }
    else this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: em.renderer.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uMap: { value: getTexture(em.renderer.texture, onTexture, bt.uvMode === 'tile') }, uIntensity: { value: em.renderer.intensity }, ...quad } });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false;
    this.col = parseColor(em.main.startColor[0]) || [1, 1, 1, 1];
    this.reset();
  }
  get n() { return this.S.length; }
  get P() { const a = new Float32Array(this.S.length * 3); this.S.forEach((x, i) => x.p.toArray(a, i * 3)); return a; } // kadraj için (uç noktaları)
  get size() { return new Array(this.S.length).fill(this.from.distanceTo(this.to)); }
  reset() { this.S.length = 0; this.now = 0; this.te = -this.em.main.startDelay; }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
  step(dt, E) {
    const m = this.em.main, life = this.em.bladeTrail.lifetime;
    this.te += dt; this.now += dt;
    const on = this.te >= 0 && (m.looping || this.te <= m.duration);
    if (on && this.S.length < this.cap) this.S.push({ t: this.now, b: this.from.clone().applyMatrix4(E), p: this.to.clone().applyMatrix4(E) });
    while (this.S.length && this.now - this.S[0].t > life) this.S.shift();
  }
  upload() {
    const S = this.S, g = this.mesh.geometry, n = S.length;
    if (n < 2) { g.setDrawRange(0, 0); return; }
    const em = this.em, bt = em.bladeTrail, life = bt.lifetime, sub = Math.max(1, bt.subdiv);
    const col = em.colorOverLifetime, sz = em.sizeOverLifetime;
    const cs = col.enabled ? col.color.map(([t, c]) => [t, parseColor(c) || [1, 1, 1, 1]]) : null;
    const cr = cs && [0, 1, 2].map((ch) => cs.map(([t, c]) => [t, c[ch]]));
    const P = g.attributes.iPos.array, C = g.attributes.iCol.array, R = g.attributes.iSRF.array, U = g.attributes.iCus.array;
    const cd = em.customData.enabled ? em.customData : null, tile = bt.uvMode === 'tile', tl = Math.max(0.01, bt.tileLength);
    let v = 0, dist = 0; const last = new THREE.Vector3(); let hasLast = false;
    const put = (b, p, age) => {
      if (v + 2 > this.vcap) return;
      const a = Math.min(1, Math.max(0, age)), w = (sz.enabled ? evalCurve(sz.curve, a) : 1) * evalCurve(bt.width, a);
      if (bt.taper === 'root') { _tb.copy(b); _ta.copy(b).lerp(p, w); } // uç köke doğru kısalır
      else if (bt.taper === 'center') { _tc.copy(b).add(p).multiplyScalar(0.5); _tb.copy(_tc).lerp(b, w); _ta.copy(_tc).lerp(p, w); }
      else { _tb.copy(p).lerp(b, w); _ta.copy(p); } // kök uca doğru daralır
      P.set([_tb.x, _tb.y, _tb.z, _ta.x, _ta.y, _ta.z], v * 3);
      let r = this.col[0], gg = this.col[1], bb = this.col[2], al = this.col[3];
      if (cr) { r *= evalCurve(cr[0], a); gg *= evalCurve(cr[1], a); bb *= evalCurve(cr[2], a); al *= evalCurve(col.alpha, a); }
      C.set([r, gg, bb, al, r, gg, bb, al], v * 4);
      if (hasLast) dist += last.distanceTo(p); last.copy(p); hasLast = true;
      const u = tile ? dist / tl : a;
      R.set([0, 0, u, 0, 0, 0, u, 1], v * 4);
      if (cd) { const c4 = [evalCurve(cd.x, a), evalCurve(cd.y, a), evalCurve(cd.z, a), evalCurve(cd.w, a)]; U.set([...c4, ...c4], v * 4); }
      v += 2;
    };
    const cb = new THREE.Vector3(), cp = new THREE.Vector3();
    for (let i = n - 1; i >= 1; i--) { // baştan (en yeni) kuyruğa
      const s0 = S[Math.min(n - 1, i + 1)], s1 = S[i], s2 = S[i - 1], s3 = S[Math.max(0, i - 2)];
      for (let k = 0; k < sub; k++) {
        const t = k / sub; crm(s0.b, s1.b, s2.b, s3.b, t, cb); crm(s0.p, s1.p, s2.p, s3.p, t, cp);
        put(cb, cp, (this.now - (s1.t + (s2.t - s1.t) * t)) / life);
      }
    }
    put(S[0].b, S[0].p, (this.now - S[0].t) / life);
    for (const k of ['iPos', 'iCol', 'iSRF', 'iCus']) g.attributes[k].needsUpdate = true;
    g.setDrawRange(0, Math.max(0, (v / 2 - 1) * 6));
  }
}
// ── efekt oynatıcı: emitter ağacı + zaman
// Işıklar (emitter.light): sabit havuz (efekt kurulunca sayı sabit; three ışık sayısı değişince shader'ları yeniden derler),
// kullanılmayan ışığın yoğunluğu 0. Bükülme: sahne (bükülme parçacıkları hariç) shared.uScene dokusuna çizilir (vfx.js).
// Alt emitter: kaynak adımlandıktan sonra olaylar hedefe verilir (hedef sırada önceyse bir sonraki adımın başında).
const _lp = new THREE.Vector3(), _lc = new THREE.Color();
export class EffectPlayer {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'vfx-root';
    this.mirror = new THREE.Group(); this.mirror.scale.set(-1, 1, 1); this.offset = new THREE.Group();
    this.root.add(this.mirror); this.mirror.add(this.offset);
    this.worldRoot = new THREE.Group(); this.worldRoot.name = 'vfx-world'; this.worldRoot.scale.set(-1, 1, 1);
    this.lightRoot = new THREE.Group(); this.lightRoot.name = 'vfx-lights';
    scene.add(this.root, this.worldRoot, this.lightRoot);
    this.sims = []; this.nodes = []; this.lights = []; this.deferred = []; this.time = 0; this.acc = 0; this.effect = null;
    this.onBeforeStep = null; // (t) => poz güncelle (animasyonla oynatma)
    this.onTexture = null;
    this.materialFor = null; // (ad) => { shader, values } | null — renderer.material'ı kütüphaneden çözer (yüklenmediyse null)
    this.meshFor = null; // (dosya) => { positions, normals, uvs, indices } | null — meshes/ dosyası (yüklenmediyse null)
    this.shared = newShared(); // bükülme / yumuşak parçacık / decal: sahne hedefi + kamera
  }
  setVisible(v) { this.root.visible = this.worldRoot.visible = this.lightRoot.visible = v; }
  get hasDistortion() { return this.sims.some((s) => s?.distortion && s.n > 0); }
  get needsSceneTarget() { return this.sims.some((s) => s?.needsDepth && s.n > 0); } // sahne rengi + derinliği gereken (bükülme, yumuşak, decal)
  get distortionMeshes() { return this.sims.filter((s) => s?.distortion || s?.decal).map((s) => s.mesh); } // sahne hedefinde gizlenenler
  get hasDecal() { return this.effect?.emitters.some((e) => e.enabled && e.renderer.mode === 'decal' && !e.bladeTrail?.enabled); }
  setEffect(effect) {
    for (const s of this.sims) s?.dispose(); for (const n of this.nodes) n.removeFromParent();
    for (const l of this.lights) l.light.removeFromParent(); this.lights = [];
    this.effect = effect; this.sims = []; this.nodes = [];
    this.offset.position.set(...effect.attach.position); unityQuat(effect.attach.rotation, this.offset.quaternion);
    const base = hashStr(effect.name);
    effect.emitters.forEach((em, i) => {
      const node = new THREE.Group(); node.position.set(...em.position); unityQuat(em.rotation, node.quaternion); this.offset.add(node); this.nodes.push(node);
      if (!em.enabled) { this.sims.push(null); return; }
      const upe = em.renderer.material ? this.materialFor?.(em.renderer.material) || null : null;
      const sim = em.bladeTrail?.enabled ? new TrailSim(em, () => this.onTexture?.(), upe)
        : new EmitterSim(em, (base ^ hashStr(em.name) ^ Math.imul(i + 1, 2654435761)) >>> 0, () => this.onTexture?.(), upe, { meshFor: this.meshFor, shared: this.shared });
      sim.mesh.renderOrder = 100 + em.renderer.sortingOrder * 10 + i + (sim.distortion ? 5000 : sim.decal ? -5000 : 0); // decal önce (yüzeyin parçası), bükülme en son
      (sim.world ? this.worldRoot : node).add(sim.mesh); this.sims.push(sim);
      if (em.light.enabled) {
        const n = em.light.mode === 'perParticle' && !em.bladeTrail?.enabled ? em.light.maxLights : 1;
        for (let k = 0; k < n; k++) { const l = new THREE.PointLight(em.light.color, 0, em.light.radius, 2); l.castShadow = false; this.lightRoot.add(l); this.lights.push({ light: l, sim: i, k }); }
      }
    });
    // alt emitter bağları (normalizeEffect başvuruları doğruladı; iz emitter'ı kaynak/hedef olamaz)
    effect.emitters.forEach((em, i) => {
      const s = this.sims[i]; if (!(s instanceof EmitterSim) || !em.subEmitters.enabled) return;
      const links = em.subEmitters.items.map((it) => ({ ...it, target: effect.emitters.findIndex((x) => x.name === it.emitter) })).filter((l) => this.sims[l.target] instanceof EmitterSim);
      if (!links.length) return;
      s.subs = { links, birth: links.some((l) => l.trigger === 'birth'), death: links.some((l) => l.trigger === 'death') };
      for (const l of links) this.sims[l.target].subTarget = true;
    });
    this.reset();
  }
  attachTo(parent) { if (this.root.parent !== parent) parent.add(this.root); }
  reset() { this.time = 0; this.acc = 0; this.deferred = []; for (const s of this.sims) s?.reset(); }
  emitterMatrix(i, out) { return out.multiplyMatrices(MIRROR, this.nodes[i].matrixWorld); } // emitter yereli → Unity dünyası
  deliver(s, ev, E, EQ) {
    const l = ev.link, n = Math.round(lerp(l.count[0], l.count[1], s.rng()));
    const e = { p: ev.p, v: ev.v, col: ev.col, size: ev.size, inherit: { color: l.inheritColor, size: l.inheritSize, velocity: l.inheritVelocity } };
    for (let k = 0; k < n; k++) s.spawn(E, EQ, 0, e);
  }
  stepOnce() {
    this.onBeforeStep?.(this.time);
    this.root.updateWorldMatrix(true, true);
    const E = _m, EQ = _q;
    const pending = this.deferred; this.deferred = [];
    this.sims.forEach((s, i) => {
      if (!s) return;
      this.emitterMatrix(i, E); E.decompose(_p, EQ, _s);
      for (const ev of pending) if (ev.target === i) this.deliver(s, ev, E, EQ);
      s.step(STEP, E, EQ);
      if (s.subs && s.events.length) {
        for (const e of s.events) for (const l of s.subs.links) if (l.trigger === e.trigger) (l.target > i ? pending : this.deferred).push({ ...e, link: l, target: l.target });
      }
    });
    this.time += STEP;
  }
  advance(dt) { this.acc += Math.min(dt, 0.25); while (this.acc >= STEP) { this.stepOnce(); this.acc -= STEP; } }
  seek(t) { this.reset(); const n = Math.round(Math.max(0, t) / STEP); for (let i = 0; i < n; i++) this.stepOnce(); }
  get count() { return this.sims.reduce((a, s) => a + (s ? s.n : 0), 0); }
  // tüm emitter'lar döngüdeyse efekt yeniden başlatılmadan akar; tek atımlık varsa süre sonunda baştan
  get allLooping() { return this.effect?.emitters.every((e) => !e.enabled || e.main.looping); }
  upload(camera) {
    this.root.updateWorldMatrix(true, true); this.worldRoot.updateWorldMatrix(true, false);
    const inv = new THREE.Matrix4();
    for (const s of this.sims) { if (!s) continue; inv.copy(s.mesh.matrixWorld).invert(); s.upload(camera.position, inv); }
    this.shared.uTime.value = this.time;
    this.updateLights();
  }
  // ışıklar: tek → emitter düğümünün konumu, eğri emitter döngüsünde; parçacık başına → ilk maxLights parçacık, eğri parçacık ömründe
  updateLights() {
    for (const { light, sim: i, k } of this.lights) {
      const s = this.sims[i], em = this.effect.emitters[i], L = em.light;
      light.intensity = 0; if (!s) continue;
      if (L.mode === 'perParticle' && s instanceof EmitterSim) {
        if (k >= s.n) continue;
        const tn = s.age[k] / s.life[k];
        _lp.fromArray(s.P, k * 3).applyMatrix4(s.mesh.matrixWorld); light.position.copy(_lp);
        if (L.useParticleColor) { const c = s.col; _lc.setRGB(c[k * 4], c[k * 4 + 1], c[k * 4 + 2], THREE.SRGBColorSpace); light.color.copy(_lc); }
        light.intensity = L.intensity * evalCurve(L.curve, tn);
      } else {
        const m = em.main, te = s.te;
        if (te < 0 || (!m.looping && te > m.duration)) continue;
        this.nodes[i].getWorldPosition(light.position);
        light.intensity = L.intensity * evalCurve(L.curve, (m.looping ? te % m.duration : te) / m.duration);
      }
      light.distance = L.radius;
    }
  }
}
