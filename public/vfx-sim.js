// VFX önizleme motoru: Unity ParticleSystem (Shuriken) davranışını CPU'da taklit eder, three.js ile instanced quad çizer.
// Simülasyon Unity koordinatlarında (sol-el) yapılır; görüntüye X aynasıyla taşınır (three = (-x, y, z), animasyon
// importer'ıyla aynı dönüşüm). Sabit adım + tohumlu RNG: aynı efekt aynı zamanda hep aynı görüntüyü verir.
import * as THREE from 'three';
import { evalCurve, parseColor } from './vfx-schema.js';
import { createUPEParticleMaterial } from './shader-compile.js';

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
export function getTexture(name, onLoad) {
  if (!texCache.has(name)) {
    let done; texReady.set(name, new Promise((r) => { done = r; }));
    const t = new THREE.TextureLoader().load('/vfx-textures/' + encodeURIComponent(name) + '.png?v=' + Date.now(), () => { done(); onLoad?.(); }, undefined, () => { texCache.set(name, getFallback()); done(); onLoad?.(); });
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; texCache.set(name, t);
  }
  return texCache.get(name);
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
  } else if (uMode == 4) {
    mv = modelViewMatrix * vec4(iPos + uAlign * vec3(rc, 0.0) * size, 1.0); // Local hizalama: emitter'ın XY düzlemi (Unity koordinatı, ayna modelMatrix'te)
  } else {
    mv = modelViewMatrix * vec4(iPos, 1.0); mv.xy += rc * size;
  }
  gl_Position = projectionMatrix * mv;
  float tiles = uTiles.x * uTiles.y, fr = mod(floor(iSRF.z + 0.5), tiles);
  vec2 cell = vec2(mod(fr, uTiles.x), uTiles.y - 1.0 - floor(fr / uTiles.x));
  vUv = (cell + c + 0.5) / uTiles; vCol = iCol;
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap; uniform float uIntensity;
varying vec2 vUv; varying vec4 vCol;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec4 col = vec4(toLinear(vCol.rgb) * uIntensity, vCol.a) * t; // Unity (Linear proje) köşe rengini ve _BaseColor'ı doğrusala çevirir: kalibrasyonla ölçüldü
  if (col.a < 0.002) discard;
  gl_FragColor = col;
}`;
const MODE = { billboard: 0, stretched: 1, horizontal: 2, vertical: 3 };

// ── tek emitter: parçacık havuzu + Unity modül davranışı
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _Ei = new THREE.Matrix4(), _qe = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _pa = new THREE.Vector3(), _pi = new THREE.Vector3(), _pc = new THREE.Vector3(), _si = new THREE.Vector3();
class EmitterSim {
  // upe: { shader, values } — renderer.material kütüphaneden çözüldüyse; yoksa doku/karışım/parlaklıkla yerleşik çizim
  constructor(em, seed, onTexture, upe = null) {
    this.em = em; this.seed = seed;
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
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    // UPE materyalinde ters sarım: düğüm X aynalı (three ön yüzü çevirir), quad kameraya ön yüzünü versin (Unity'deki gibi; cull back çalışır)
    g.setIndex(upe ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    const ia = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', ia(3)); g.setAttribute('iVel', ia(3)); g.setAttribute('iCol', ia(4)); g.setAttribute('iSRF', ia(4));
    g.instanceCount = 0;
    const r = em.renderer, ts = em.textureSheet;
    const local = r.mode === 'billboard' && r.alignment === 'local';
    const quad = { uMode: { value: local ? 4 : MODE[r.mode] ?? 0 }, uLengthScale: { value: r.lengthScale }, uVelScale: { value: r.velocityScale },
      uTiles: { value: new THREE.Vector2(ts.enabled ? ts.tilesX : 1, ts.enabled ? ts.tilesY : 1) },
      uAlign: { value: new THREE.Matrix3() } }; // Local: dünya simülasyonunda emitter dönüşü (step'te), yerelde birim
    this.quad = quad; this.alignM = new THREE.Matrix4();
    if (upe) {
      const u = createUPEParticleMaterial(upe.shader, upe.values, quad, { onTexture });
      this.mat = u.material; this.sortBack = ['alpha', 'premultiply', 'multiply'].includes(u.blend);
    } else {
      this.mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: r.blend === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uMap: { value: getTexture(r.texture, onTexture) }, uIntensity: { value: r.intensity }, ...quad },
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

  spawn(E, EQ, age) {
    if (this.n >= this.cap) return;
    const m = this.em.main, rng = this.rng, i = this.n++;
    this.shapeSample(_p, _v);
    _v.multiplyScalar(rnd(rng, m.startSpeed));
    if (this.world) { _p.applyMatrix4(E); _v.applyQuaternion(EQ); }
    this.P.set([_p.x + _v.x * age, _p.y + _v.y * age, _p.z + _v.z * age], i * 3); this.V.set([_v.x, _v.y, _v.z], i * 3); this.D.set([_v.x, _v.y, _v.z], i * 3);
    this.age[i] = age; this.life[i] = Math.max(0.001, rnd(rng, m.startLifetime));
    this.size[i] = rnd(rng, m.startSize); this.rot[i] = rnd(rng, m.startRotation);
    const ro = this.em.rotationOverLifetime; this.angv[i] = ro.enabled ? rnd(rng, ro.angularVelocity) : 0;
    const t = rng(); for (let k = 0; k < 4; k++) this.col[i * 4 + k] = lerp(this.ca[k], this.cb[k], t);
    const ts = this.em.textureSheet; this.frame0[i] = ts.enabled && ts.randomStart ? Math.floor(rng() * ts.tilesX * ts.tilesY) : 0;
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
    for (let i = this.n - 1; i >= 0; i--) {
      this.age[i] += dt; if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
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
    if (te1 <= 0) return;
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
    const aP = g.attributes.iPos.array, aV = g.attributes.iVel.array, aC = g.attributes.iCol.array, aS = g.attributes.iSRF.array;
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
    }
    g.instanceCount = n;
    for (const k of ['iPos', 'iVel', 'iCol', 'iSRF']) { g.attributes[k].needsUpdate = true; g.attributes[k].addUpdateRange(0, n * g.attributes[k].itemSize); }
  }
}

// ── efekt oynatıcı: emitter ağacı + zaman
export class EffectPlayer {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'vfx-root';
    this.mirror = new THREE.Group(); this.mirror.scale.set(-1, 1, 1); this.offset = new THREE.Group();
    this.root.add(this.mirror); this.mirror.add(this.offset);
    this.worldRoot = new THREE.Group(); this.worldRoot.name = 'vfx-world'; this.worldRoot.scale.set(-1, 1, 1);
    scene.add(this.root, this.worldRoot);
    this.sims = []; this.nodes = []; this.time = 0; this.acc = 0; this.effect = null;
    this.onBeforeStep = null; // (t) => poz güncelle (animasyonla oynatma)
    this.onTexture = null;
    this.materialFor = null; // (ad) => { shader, values } | null — renderer.material'ı kütüphaneden çözer (yüklenmediyse null)
  }
  setVisible(v) { this.root.visible = this.worldRoot.visible = v; }
  setEffect(effect) {
    for (const s of this.sims) s?.dispose(); for (const n of this.nodes) n.removeFromParent();
    this.effect = effect; this.sims = []; this.nodes = [];
    this.offset.position.set(...effect.attach.position); unityQuat(effect.attach.rotation, this.offset.quaternion);
    const base = hashStr(effect.name);
    effect.emitters.forEach((em, i) => {
      const node = new THREE.Group(); node.position.set(...em.position); unityQuat(em.rotation, node.quaternion); this.offset.add(node); this.nodes.push(node);
      if (!em.enabled) { this.sims.push(null); return; }
      const upe = em.renderer.material ? this.materialFor?.(em.renderer.material) || null : null;
      const sim = new EmitterSim(em, (base ^ hashStr(em.name) ^ Math.imul(i + 1, 2654435761)) >>> 0, () => this.onTexture?.(), upe);
      sim.mesh.renderOrder = 100 + em.renderer.sortingOrder * 10 + i;
      (sim.world ? this.worldRoot : node).add(sim.mesh); this.sims.push(sim);
    });
    this.reset();
  }
  attachTo(parent) { if (this.root.parent !== parent) parent.add(this.root); }
  reset() { this.time = 0; this.acc = 0; for (const s of this.sims) s?.reset(); }
  emitterMatrix(i, out) { return out.multiplyMatrices(MIRROR, this.nodes[i].matrixWorld); } // emitter yereli → Unity dünyası
  stepOnce() {
    this.onBeforeStep?.(this.time);
    this.root.updateWorldMatrix(true, true);
    const E = _m, EQ = _q;
    this.sims.forEach((s, i) => {
      if (!s) return;
      this.emitterMatrix(i, E); E.decompose(_p, EQ, _s);
      s.step(STEP, E, EQ);
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
  }
}
