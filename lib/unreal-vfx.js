// UPE VFX → Unreal Niagara (docs/UNREAL.md). Sahibi: Unreal dönüştürücü işi. Sunucu yalnız aşağıdaki üç işlevi kullanır.
//
// Yaklaşım: her emitter `Minimal` şablonundan kurulur (EmitterState, InitializeParticle, ParticleState + Sprite renderer).
// Yayım (SpawnRate, SpawnBurst_Instantaneous), yerçekimi/kuvvet (GravityForce, AccelerationForce) ve çözücü
// (SolveForcesAndVelocity) yerleşik Niagara modülleridir. Unity'ye özgü davranışlar (şekil + doğum yönü, sabit sürtünme,
// hız sınırı, ömür boyu hız/gürültü ofseti, renk/boyut/dönüş eğrileri, flipbook) "Set Parameters" modüllerinde HLSL
// ifadeleriyle vfx-sim.js formülleriyle yazılır (eğri DI'ları yerine parçalı doğrusal ifade: anahtarlar aynen korunur).
// Plan saf veridir (effectToNiagaraPlan); yürütme planı sırayla MCP çağrılarına çevirir.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseColor } from '../public/vfx-schema.js';
import { proceduralMesh, transformMesh, meshToOBJ, meshKey } from '../public/vfx-mesh.js';
import { callTool, callTop, getClient, DEFAULT_MCP_URL } from './unreal-mcp-client.js';
import { createMaterialLibrary, planEmitterMaterial, ensureBaseMaterial as ensureUEBaseMaterial, ensureMaterialInstance as ensureUEMaterialInstance, wireDistortionOutput, DEFAULT_MATERIALS_DIR } from './ue-material.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEXTURES_DIR = path.resolve(HERE, '../vfx/textures');
const DEFAULT_MESHES_DIR = path.resolve(HERE, '../meshes');
const MESH_TMP_DIR = path.resolve(HERE, '../exports/ue_meshes'); // üretilen OBJ'ler (içe aktarma kaynağı)
export const MATERIALS_PATH = '/Game/UPE/Materials';
const NS = 'NiagaraToolsets.NiagaraToolset_System';
const NA = 'NiagaraToolsets.NiagaraToolset_Info';
const AT = 'editor_toolset.toolsets.asset.AssetTools';
const OT = 'editor_toolset.toolsets.object.ObjectTools';
const MT = 'editor_toolset.toolsets.material.MaterialTools';
const MIT = 'editor_toolset.toolsets.material_instance.MaterialInstanceTools';
const TT = 'editor_toolset.toolsets.texture.TextureTools';
const TEMPLATE_SYSTEM = '/Niagara/DefaultAssets/DefaultSystem.DefaultSystem';
const TEMPLATE_EMITTER = '/Niagara/DefaultAssets/Templates/Emitters/Minimal.Minimal';
const MOD = {
  SpawnRate: '/Niagara/Modules/Emitter/SpawnRate.SpawnRate',
  SpawnBurst: '/Niagara/Modules/Emitter/SpawnBurst_Instantaneous.SpawnBurst_Instantaneous',
  Gravity: '/Niagara/Modules/Update/Forces/GravityForce.GravityForce',
  Acceleration: '/Niagara/Modules/Update/Forces/AccelerationForce.AccelerationForce',
  Solve: '/Niagara/Modules/Solvers/SolveForcesAndVelocity.SolveForcesAndVelocity',
  GenDeath: '/Niagara/Modules/Events/GenerateDeathEvent.GenerateDeathEvent',
  GenLocation: '/Niagara/Modules/Events/GenerateLocationEvent.GenerateLocationEvent',
  RecvDeath: '/Niagara/Modules/Events/ReceiveDeathEvent.ReceiveDeathEvent',
  RecvLocation: '/Niagara/Modules/Events/ReceiveLocationEvent.ReceiveLocationEvent',
};
export const TY = {
  float: '/Script/Niagara.NiagaraFloat', int: '/Script/Niagara.NiagaraInt32', bool: '/Script/Niagara.NiagaraBool',
  vec2: '/Script/CoreUObject.Vector2f', vec3: '/Script/CoreUObject.Vector3f', vec4: '/Script/CoreUObject.Vector4f',
  color: '/Script/CoreUObject.LinearColor', position: '/Script/Niagara.NiagaraPosition', quat: '/Script/CoreUObject.Quat4f',
};
const DMODE = { radial: 0, noise: 1, normal: 2 };
// Işık renderer'ı parlaklığı: Particles.Color = doğrusal renk × yoğunluk × LIGHT_K (üs düşüşlü, ters kare kapalı). Önizlemede
// three.js PointLight (kandela, decay 2) — birimler farklı, LIGHT_K kabaca 1 m'deki aydınlığı eşler (görsel kalibrasyon bekliyor).
export const LIGHT_K = 1;
const EN = {
  lifeCycle: '/Niagara/Enums/ENiagaraEmitterLifeCycleMode.ENiagaraEmitterLifeCycleMode',
  loopBehavior: '/Niagara/Enums/ENiagara_EmitterStateOptions.ENiagara_EmitterStateOptions',
  loopDuration: '/Niagara/Enums/ENiagara_InfiniteLoopDuration.ENiagara_InfiniteLoopDuration',
  coordSpace: '/Script/Niagara.ENiagaraCoordinateSpace',
};

// ───────────────────────────── yardımcılar (saf)
const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// HLSL float sabiti (her zaman ondalıklı; -0 → 0.0)
export function f(n) {
  const v = isNum(n) ? n : 0;
  if (Math.abs(v) < 1e-9) return '0.0';
  const s = String(+v.toPrecision(7));
  return /[.e]/.test(s) ? s : s + '.0';
}
const f3 = (a) => `float3(${a.map(f).join(', ')})`;
const f4 = (a) => `float4(${a.map(f).join(', ')})`;
const lerpR = (r) => (Math.abs(r[1] - r[0]) < 1e-9 ? f(r[0]) : `lerp(${f(r[0])}, ${f(r[1])}, rand(1.0f))`);

// Unity (+X sağ, +Y yukarı, +Z ileri, m) → UE (+X ileri, +Y sağ, +Z yukarı, cm). Dönme içermeyen permütasyon.
export const toUEDir = (u) => [u[2], u[0], u[1]];
export const toUE = (u, s = 100) => [u[2] * s, u[0] * s, u[1] * s];

// Unity Euler (derece, Z→X→Y) → 3x3 satır-ana matris (Unity uzayında). vfx-sim.js ile aynı (three 'YXZ').
export function unityEulerMatrix(deg) {
  const [x, y, z] = (deg || [0, 0, 0]).map((v) => v * D2R);
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), ff = Math.sin(z);
  const ce = c * e, cf = c * ff, de = d * e, df = d * ff;
  return [[ce + df * b, de * b - cf, a * d], [a * ff, a * e, -b], [cf * b - de, df + ce * b, a * c]];
}
export const matMul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
export const matVec = (A, v) => A.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const P = [[0, 0, 1], [1, 0, 0], [0, 1, 0]]; const PT = [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
export const toUEMatrix = (M) => matMul(matMul(P, M), PT); // Unity uzayındaki dönüş → UE uzayında (UE vektörüne uygulanır)
export const unityToUE = (M) => matMul(P, M); // Unity vektörünü dönüştürüp UE eksenlerine taşır
const scaleM = (M, s) => M.map((r) => r.map((v) => v * s));
const diag = (v) => [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];
// HLSL: M·v (v float3 ifadesi). Sıfır terimler atlanır.
export function mulExpr(M, v) {
  const rows = M.map((r) => {
    const terms = [];
    ['x', 'y', 'z'].forEach((c, j) => { const k = r[j]; if (Math.abs(k) < 1e-7) return; terms.push(Math.abs(k - 1) < 1e-7 ? `(${v}).${c}` : `${f(k)} * (${v}).${c}`); });
    return terms.length ? terms.join(' + ') : '0.0';
  });
  return `float3(${rows.join(', ')})`;
}

// sütun-vektör dönüş matrisi → kuaterniyon (x, y, z, w); UE FQuat::RotateVector ile aynı cebir
export function quatFromMatrix(m) {
  const tr = m[0][0] + m[1][1] + m[2][2]; let x, y, z, w;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = 0.25 * S; x = (m[2][1] - m[1][2]) / S; y = (m[0][2] - m[2][0]) / S; z = (m[1][0] - m[0][1]) / S; }
  else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) { const S = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2; w = (m[2][1] - m[1][2]) / S; x = 0.25 * S; y = (m[0][1] + m[1][0]) / S; z = (m[0][2] + m[2][0]) / S; }
  else if (m[1][1] > m[2][2]) { const S = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2; w = (m[0][2] - m[2][0]) / S; x = (m[0][1] + m[1][0]) / S; y = 0.25 * S; z = (m[1][2] + m[2][1]) / S; }
  else { const S = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2; w = (m[1][0] - m[0][1]) / S; x = (m[0][2] + m[2][0]) / S; y = (m[1][2] + m[2][1]) / S; z = 0.25 * S; }
  return [x, y, z, w];
}
export const quatRotate = (q, v) => { // q v q* (test için)
  const [x, y, z, w] = q, u = [x, y, z];
  const c1 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map((a, i) => a + w * v[i]);
  const c2 = [u[1] * c1[2] - u[2] * c1[1], u[2] * c1[0] - u[0] * c1[2], u[0] * c1[1] - u[1] * c1[0]];
  return v.map((a, i) => a + 2 * c2[i]);
};
// HLSL kuaterniyon çarpımı a ⊗ b (float4 x,y,z,w; önce b uygulanır)
export const qmulExpr = (a, b) => `float4((${a}).w * (${b}).xyz + (${b}).w * (${a}).xyz + cross((${a}).xyz, (${b}).xyz), (${a}).w * (${b}).w - dot((${a}).xyz, (${b}).xyz))`;

const col = (hex) => parseColor(hex) || [1, 1, 1, 1];
export function srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

// Parçalı doğrusal eğri (vfx-schema evalCurve ile aynı: uçlarda sabit) → HLSL. keys: [[t, değer]] değer sayı ya da dizi
export function curveExpr(keys, t, kind = 'float') {
  const lit = (v) => (kind === 'float' ? f(v) : kind === 'float3' ? f3(v) : f4(v));
  if (!keys?.length) return lit(kind === 'float' ? 1 : kind === 'float3' ? [1, 1, 1] : [1, 1, 1, 1]);
  const ks = [...keys].sort((a, b) => a[0] - b[0]);
  if (ks.length === 1 || ks.every((k) => JSON.stringify(k[1]) === JSON.stringify(ks[0][1]))) return lit(ks[0][1]);
  const seg = (i, j) => `lerp(${lit(ks[i][1])}, ${lit(ks[j][1])}, saturate((${t} - ${f(ks[i][0])}) / ${f(Math.max(1e-5, ks[j][0] - ks[i][0]))}))`;
  const n = ks.length;
  let expr = seg(n - 2, n - 1);
  for (let i = n - 2; i >= 1; i--) expr = `(${t} <= ${f(ks[i][0])} ? ${seg(i - 1, i)} : ${expr})`;
  return expr;
}

// ASCII güvenli ad (Unity importer'ındaki gibi Türkçe harf çevirisi)
export function safeName(s, fallback = 'emitter') {
  const tr = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ü: 'u', Ü: 'U', ö: 'o', Ö: 'O', ç: 'c', Ç: 'C' };
  const out = String(s || '').replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => tr[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return out || fallback;
}
const hashStr = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };

// Plan girdi değeri kurucuları
const V = {
  float: (v) => ({ kind: 'float', value: v }), int: (v) => ({ kind: 'int', value: Math.round(v) }), bool: (v) => ({ kind: 'bool', value: !!v }),
  vec3: (v) => ({ kind: 'vec3', value: v }), hlsl: (e) => ({ kind: 'hlsl', value: e }), enumv: (en, display) => ({ kind: 'enum', enum: en, display }),
};
const P_ = (name, type, hlsl) => ({ name, type, hlsl });

// ───────────────────────────── şekil örneklemesi (vfx-sim.js shapeSample, Unity şekil uzayında) → HLSL
// UPE_R.xyzw: şekil rastgeleleri; sonuç: UPE_SDir (yön), UPE_SPos (konum, UPE_SDir'e bakabilir)
const ZERO3 = 'float3(0.0, 0.0, 0.0)';
function randUnitExpr(r) {
  const z = `(${r}.x * 2.0 - 1.0)`, s = `sqrt(max(0.0, 1.0 - ${z} * ${z}))`;
  return { z, xy: (zz) => `float3(${s} * cos(${r}.y * ${f(TAU)}), ${s} * sin(${r}.y * ${f(TAU)}), ${zz})` };
}
function shapeExprs(sh) {
  if (!sh.enabled) return { pos: ZERO3, dir: 'float3(0.0, 0.0, 1.0)' };
  const R = sh.radius, th = sh.radiusThickness, arc = sh.arc * D2R, r = 'Particles.UPE_R';
  const annulus = (u) => `sqrt(lerp(${f((1 - th) ** 2)}, 1.0, ${u}))`;
  switch (sh.type) {
    case 'sphere': case 'hemisphere': {
      const ru = randUnitExpr(r);
      return { dir: ru.xy(sh.type === 'hemisphere' ? `abs${ru.z}` : ru.z), pos: `Particles.UPE_SDir * ${f(R)} * pow(lerp(${f((1 - th) ** 3)}, 1.0, ${r}.z), ${f(1 / 3)})` };
    }
    case 'box': return { pos: `float3(${r}.x - 0.5, ${r}.y - 0.5, ${r}.z - 0.5)`, dir: 'float3(0.0, 0.0, 1.0)' };
    case 'circle': {
      const a = `(${r}.x * ${f(arc)})`;
      return { dir: `float3(cos${a}, sin${a}, 0.0)`, pos: `Particles.UPE_SDir * ${f(R)} * ${annulus(`${r}.y`)}` };
    }
    case 'edge': return { pos: `float3((${r}.x * 2.0 - 1.0) * ${f(R)}, 0.0, 0.0)`, dir: 'float3(0.0, 1.0, 0.0)' };
    case 'donut': {
      const a = `(${r}.x * ${f(arc)})`, psi = `(${r}.y * ${f(TAU)})`;
      return { dir: `float3(cos${a} * cos${psi}, sin${a} * cos${psi}, sin${psi})`,
        pos: `float3(cos${a} * ${f(R)}, sin${a} * ${f(R)}, 0.0) + Particles.UPE_SDir * ${f(sh.donutRadius)} * ${annulus(`${r}.z`)}` };
    }
    default: { // cone: taban XY, +Z'ye açılır; kenara doğru yön koni açısına yaklaşır
      const a = `(${r}.x * ${f(arc)})`, ang = sh.angle * D2R;
      if (R > 1e-5) {
        const rn = annulus(`${r}.y`), t = `(${f(ang)} * ${rn})`;
        return { pos: `float3(cos${a} * ${f(R)} * ${rn}, sin${a} * ${f(R)} * ${rn}, 0.0)`, dir: `float3(cos${a} * sin${t}, sin${a} * sin${t}, cos${t})` };
      }
      const ct = `lerp(1.0, ${f(Math.cos(ang))}, ${r}.y)`, st = `sqrt(max(0.0, 1.0 - ${ct} * ${ct}))`;
      return { pos: ZERO3, dir: `float3(cos${a} * ${st}, sin${a} * ${st}, ${ct})` };
    }
  }
}

// sin tabanlı yumuşak 3B gürültü (vfx-sim değer gürültüsünün yerine; [-1,1] ölçeğinde) → float3 ifadesi
function noiseExpr(p, oct, tExpr) {
  const comps = [[1.7, 0.9, 1.3, 17.1], [1.1, 1.9, 0.7, 41.7], [0.8, 1.2, 2.1, 71.9]];
  const n = Math.max(1, Math.min(4, oct)); let norm = 0; const parts = [[], [], []];
  for (let o = 0; o < n; o++) {
    const a = 0.5 ** o, fr = 2 ** o; norm += a;
    comps.forEach(([kx, ky, kz, ph], c) => {
      parts[c].push(`${f(a)} * sin(${f(kx * fr)} * ${p}.x + ${f(ky * fr)} * ${p}.y + ${f(kz * fr)} * ${p}.z + ${tExpr} + ${f(ph + o * 3.1)}) * cos(${f(ky * fr)} * ${p}.x - ${f(kz * fr)} * ${p}.y + ${f(kx * fr)} * ${p}.z + ${f(ph * 0.37 + o)})`);
    });
  }
  return `float3(${parts.map((pp) => `(${pp.join(' + ')})`).join(', ')}) * ${f(1.6 / norm)}`;
}

// ───────────────────────────── plan
// { name, source, systemName, metadata, system: { WarmupTime? }, textures: [ad], materials: [{ texture, blend, instance }],
//   emitters: [{ name, source, kind: 'sprite'|'ribbon', data (emitter özellikleri), texture, material, renderer: { class, props }, steps }], warnings }
// step: { op: 'module', script, module (şablondaki modül adı) | asset (eklenecek modül), inputs: [{ name, value, optional }] }
//     | { op: 'params', script, alias, params: [{ name, type, hlsl }] }  → Set Parameters modülü, her girdi HLSL ifadesi
export function effectToNiagaraPlan(effect) {
  const warnings = [];
  const name = safeName(effect?.name, 'vfx');
  const plan = { name, source: effect?.name, systemName: `NS_${name}`, metadata: {}, system: {}, textures: [], materials: [], ueMaterials: [], meshes: [], emitters: [], warnings };
  if (!effect || !Array.isArray(effect.emitters)) { warnings.push('efekt geçersiz (emitters yok)'); return plan; }
  plan.metadata = { duration: effect.duration, loop: effect.loop, attach: effect.attach };
  if (effect.attach?.target && effect.attach.target !== 'none') {
    plan.metadata.attachUE = { target: effect.attach.target, name: effect.attach.name, locationCm: toUE(effect.attach.position).map((v) => +v.toFixed(3)), rotationUnityEuler: effect.attach.rotation };
    warnings.push(`attach: ${effect.attach.target} "${effect.attach.name}" — UE'de bağlama oyunda yapılır (SpawnSystemAttached; göreli konum ${JSON.stringify(plan.metadata.attachUE.locationCm)} cm, dönüş Unity Euler ${JSON.stringify(effect.attach.rotation)}); sistem varlığına gömülmedi`);
  }
  const used = new Set();
  const prewarm = [];
  // alt emitter hedefleri: Niagara olay işleyicisi (Event Handler) MCP araçlarıyla kurulamıyor → hedef yayımsız + uyarı
  // alt emitter: kaynakta Generate Death/Location Event, hedefte Event Handler (SpawnedParticles) + Receive modülü
  const subTargets = new Map();
  for (const em of effect.emitters) if (em.enabled && em.subEmitters?.enabled) for (const it of em.subEmitters.items) {
    const t = effect.emitters.find((x) => x.name === it.emitter);
    if (!t?.enabled || t.bladeTrail?.enabled || em.bladeTrail?.enabled) { warnings.push(`${em.name}.subEmitters → ${it.emitter}: hedef/kaynak kapalı ya da iz emitter'ı, atlandı`); continue; }
    subTargets.set(it.emitter, [...(subTargets.get(it.emitter) || []), { ...it, source: em.name }]);
  }
  const ueNames = new Map();
  const uniq = (n) => { let en = safeName(n, 'emitter'); const base = en; let k = 2; while (used.has(en)) en = `${base}_${k++}`; used.add(en); return en; };
  const addMat = (out) => {
    if (out.mesh && !plan.meshes.some((x) => x.asset === out.mesh.asset)) plan.meshes.push(out.mesh);
    if (out.kind === 'light') return;
    if (out.ueMaterial) { if (!plan.ueMaterials.some((m) => m.key === out.ueMaterial.key)) plan.ueMaterials.push(out.ueMaterial); else if (out.ueMaterial.mesh) plan.ueMaterials.find((m) => m.key === out.ueMaterial.key).mesh = true; return; }
    if (!plan.textures.includes(out.texture)) plan.textures.push(out.texture);
    const hit = plan.materials.find((m) => m.instance === out.material.instance);
    if (!hit) plan.materials.push(out.material); else if (out.material.mesh) hit.mesh = true;
  };
  for (const em of effect.emitters) {
    const en = uniq(em.name);
    if (!em.enabled) { warnings.push(`${em.name}: kapalı emitter atlandı`); continue; }
    ueNames.set(em.name, en);
    const out = emitterPlan(em, en, effect, warnings, { subTarget: subTargets.get(em.name), isSource: [...subTargets.values()].flat().filter((x) => x.source === em.name) });
    if (em.main.prewarm && em.main.looping && !em.bladeTrail?.enabled) prewarm.push(em.main.duration);
    if (out.eventSources) { out.steps.push(...out.eventSources); delete out.eventSources; }
    plan.emitters.push(out); addMat(out);
    if (out.lightEmitter) { const le = out.lightEmitter; delete out.lightEmitter; le.name = uniq(`${em.name}_Isik`); plan.emitters.push(le); }
  }
  for (const e of plan.emitters) for (const h of e.eventHandlers || []) h.sourceEmitter = ueNames.get(h.source);
  if (prewarm.length) {
    plan.system.WarmupTime = Math.max(...prewarm);
    if (prewarm.length !== plan.emitters.length) warnings.push(`prewarm: Niagara'da sistem düzeyinde (WarmupTime ${f(plan.system.WarmupTime)} sn); prewarm'sız emitter'lar da ısınır`);
  }
  if (!plan.emitters.length) warnings.push('açık emitter yok');
  return plan;
}

function emitterPlan(em, ueName, effect, warnings, { subTarget, isSource = [] } = {}) {
  const w = (m) => warnings.push(`${em.name}: ${m}`);
  const m = em.main, r = em.renderer, trail = !!em.bladeTrail?.enabled;
  const mesh = !trail && r.mode === 'mesh', decal = !trail && r.mode === 'decal', dist = r.blend === 'distortion' && !decal;
  const soft = !!r.softParticles?.enabled && !decal && !dist && !trail;
  const softCm = soft ? Math.round(r.softParticles.distance * 100) : null;
  const world = trail || m.simulationSpace === 'world';
  const steps = [];
  const out = { name: ueName, source: em.name, kind: trail ? 'ribbon' : mesh ? 'mesh' : decal ? 'decal' : 'sprite', steps };

  // mesh varlığı: prosedürel → OBJ (Unity m → UE cm, OBJ içe aktarıcısının Y aynası telafili), dosya → meshes/<dosya>
  if (mesh) {
    const mm = r.mesh, key = meshKey(mm);
    const asset = `SM_UPE_${mm.shape === 'file' ? safeName(mm.file.replace(/\.[^.]+$/, ''), 'mesh') : mm.shape}_${key}`;
    out.mesh = mm.shape === 'file' ? { asset, key, file: mm.file, rotation: mm.rotation } : { asset, key, obj: meshToOBJ(transformMesh(proceduralMesh(mm), mm.rotation), asset) };
    if (mm.shape === 'file' && !mm.file) w('renderer.mesh.file boş: mesh içe aktarılamaz');
  }

  // doku + materyal: renderer.material (UPE-SL) → lib/ue-material.js; yoksa doku + blend yerleşik materyal (Aşama 1)
  if (r.material) {
    const kind = trail ? 'ribbon' : decal ? 'decal' : 'sprite', distortion = dist ? r.distortion.strength : null;
    out.ueMaterial = { name: r.material, kind, distortion, mesh, soft: softCm, additive: r.blend === 'additive', key: `${r.material}|${kind}|${distortion ?? ''}|${softCm ?? ''}` };
    out.texture = null; out.material = null;
  } else if (decal) { // Deferred Decal materyali: DecalColor (parçacık rengi) × doku; alfa → Translucent (ışıklı), additive → AlphaComposite (emissive)
    const tex = r.texture || 'soft', blend = r.blend === 'additive' ? 'DecalAdditive' : 'DecalAlpha';
    out.texture = tex;
    out.material = { texture: tex, blend, instance: `MI_UPE_${safeName(tex, 'tex')}_${blend}` };
  } else if (dist) { // yerleşik bükülme materyali: SceneColor(ekran UV + ofset), ofset önizlemeyle aynı formül (Custom HLSL)
    const tex = r.texture || 'soft', d = r.distortion;
    const scalars = { Strength: d.strength, Mode: DMODE[d.mode] ?? 0, Freq: d.frequency, ScrollU: d.scroll[0], ScrollV: d.scroll[1] };
    out.texture = tex;
    out.material = { texture: tex, blend: 'Distortion', scalars, mesh, instance: `MI_UPE_${safeName(tex, 'tex')}_Distort_${(hashStr(JSON.stringify(scalars)) % 46656).toString(36)}` };
    w('blend distortion → Translucent + SceneColor ofseti (önündeki saydamları bükmez; Unreal\'de saydam sıralaması farklı olabilir)');
  } else {
    const tex = r.texture || 'soft';
    out.texture = tex;
    const blend = (r.blend === 'alpha' ? 'Alpha' : 'Additive') + (soft ? 'Soft' : '');
    out.material = { texture: tex, blend, mesh, instance: `MI_UPE_${safeName(tex, 'tex')}_${blend}${soft ? softCm : ''}`, ...(soft ? { scalars: { FadeDistance: softCm } } : {}) };
  }
  if (soft) w(`softParticles → materyalde DepthFade (FadeDistance ${softCm} cm)`);
  if (r.softParticles?.enabled && !soft) w('softParticles: iz/decal/bükülmede yok sayılır');

  // emitter özellikleri
  out.data = { bLocalSpace: !world, SimTarget: 'CPUSim', bDeterminism: true, RandomSeed: hashStr(effect.name + '/' + em.name) % 100000,
    AllocationMode: 'ManualEstimate', PreAllocationCount: trail ? 256 : Math.max(1, m.maxParticles) };

  // ── Emitter Update: EmitterState (yaşam döngüsü, süre, döngü, gecikme)
  const stInputs = [{ name: 'Life Cycle Mode', value: V.enumv(EN.lifeCycle, 'Self') },
    { name: 'Loop Behavior', value: V.enumv(EN.loopBehavior, m.looping ? 'Infinite' : 'Once') }];
  if (m.looping) stInputs.push({ name: 'Loop Duration Mode', value: V.enumv(EN.loopDuration, 'Fixed'), optional: true });
  stInputs.push({ name: 'Loop Duration', value: V.float(m.duration), optional: true });
  if (m.startDelay > 0 && !(m.prewarm && m.looping)) {
    stInputs.push({ name: 'UseLoopDelay', value: V.bool(true), optional: true }, { name: 'Loop Delay', value: V.float(m.startDelay), optional: true },
      { name: 'Delay First Loop Only', value: V.bool(true), optional: true, warnIfHidden: m.looping });
  }
  steps.push({ op: 'module', script: 'EmitterUpdateScript', module: 'EmitterState', inputs: stInputs });

  // ── yayım
  if (trail) {
    steps.push({ op: 'module', script: 'EmitterUpdateScript', asset: MOD.SpawnRate, inputs: [{ name: 'SpawnRate', value: V.float(60) }] });
    if (em.emission.rateOverTime > 0 || em.emission.bursts.length) w('bladeTrail: yayım (rate/burst) yok sayılır, iz saniyede 60 örnekle sürülür');
  } else if (subTarget) {
    // kendi yayımı yok (UPE ile aynı); her kaynak bağı bir Event Handler: SpawnedParticles, olay başına count parçacık
    out.eventHandlers = subTarget.map((it) => ({
      source: it.source, event: it.trigger === 'birth' ? 'LocationEvent' : 'DeathEvent', receive: it.trigger === 'birth' ? MOD.RecvLocation : MOD.RecvDeath,
      props: { ExecutionMode: 'SpawnedParticles', SpawnNumber: it.count[1], bRandomSpawnNumber: it.count[0] !== it.count[1], MinSpawnNumber: it.count[0], MaxEventsPerFrame: 0 },
      inherit: { color: it.inheritColor, size: it.inheritSize, velocity: it.inheritVelocity },
    }));
    if (subTarget.some((it) => it.inheritSize)) w('subEmitters.inheritSize: Niagara Death/Location olay yükünde boyut yok → miras alınmaz');
    if (subTarget.some((it) => it.inheritColor && it.trigger === 'death')) w('subEmitters.inheritColor (ölüm): Death olay yükünde renk yok → miras alınmaz (doğum/Location olayında var)');
    w('alt emitter → Niagara Event Handler (Receive modülünün olay konumunu/hızını Particles.Position/Velocity\'ye yazdığı varsayıldı; editörde doğrulanmadı)');
  } else {
    if (em.emission.rateOverTime > 0) steps.push({ op: 'module', script: 'EmitterUpdateScript', asset: MOD.SpawnRate, inputs: [{ name: 'SpawnRate', value: V.float(em.emission.rateOverTime) }] });
    let nb = 0;
    for (const b of em.emission.bursts) {
      for (let c = 0; c < b.cycles; c++) {
        const t = b.time + c * b.interval;
        if (t >= m.duration + 1e-9) break;
        if (nb >= 16) { w('burst döngüleri 16 modülle sınırlandı'); break; }
        const cnt = b.count[0] === b.count[1] ? V.int(b.count[0]) : V.hlsl(`(int)round(lerp(${f(b.count[0])}, ${f(b.count[1])}, rand(1.0f)))`);
        steps.push({ op: 'module', script: 'EmitterUpdateScript', asset: MOD.SpawnBurst, inputs: [{ name: 'Spawn Count', value: cnt }, { name: 'Spawn Time', value: V.float(t) }] });
        nb++;
      }
    }
    if (em.emission.rateOverTime <= 0 && !nb && !(em.light.enabled && em.light.mode === 'single')) w('yayım yok (rate 0, süre içinde burst yok): parçacık doğmaz');
  }
  if (isSource.length) {
    // olay üreticileri: ölüm → Particle Update'te Generate Death Event, doğum → Particle Spawn'da Generate Location Event
    out.eventSources = [];
    if (isSource.some((x) => x.trigger === 'death')) out.eventSources.push({ op: 'module', script: 'ParticleUpdateScript', asset: MOD.GenDeath, inputs: [] });
    if (isSource.some((x) => x.trigger === 'birth')) out.eventSources.push({ op: 'module', script: 'ParticleSpawnScript', asset: MOD.GenLocation, inputs: [] });
    out.data.bRequiresPersistentIDs = true;
  }

  // ── Particle Spawn: InitializeParticle (ömür)
  const life = trail ? [em.bladeTrail.lifetime, em.bladeTrail.lifetime] : m.startLifetime;
  steps.push({ op: 'module', script: 'ParticleSpawnScript', module: 'InitializeParticle', inputs: [{ name: 'Lifetime', value: life[0] === life[1] ? V.float(life[0]) : V.hlsl(lerpR(life)) }] });

  // emitter dönüşümü (efekt köküne göre; Niagara emitter'ının kendi dönüşümü yok → konum/yönlere gömülür)
  const Rem = unityEulerMatrix(em.rotation);
  const toSim = (e, isPos) => (world ? `mul(float4(${e}, ${isPos ? '1.0' : '0.0'}), Engine.Owner.SystemLocalToWorld).xyz` : e);
  const c0 = col(m.startColor[0]), c1 = col(m.startColor[1]);
  const colExpr = JSON.stringify(c0) === JSON.stringify(c1) ? f4(c0) : `lerp(${f4(c0)}, ${f4(c1)}, rand(1.0f))`;
  const cl = em.colorOverLifetime;
  const grad = (tExpr) => {
    if (!cl.enabled) return null;
    const rgb = curveExpr(cl.color.map(([t, c]) => [t, col(c).slice(0, 3)]), tExpr, 'float3');
    const a = curveExpr(cl.alpha, tExpr, 'float');
    if (rgb === 'float3(1.0, 1.0, 1.0)' && a === '1.0') return null;
    return `float4(${rgb}, ${a})`;
  };
  const I = r.material ? 1 : r.intensity;
  // Unity (Linear proje) köşe rengini çarpımdan sonra doğrusala çevirir (vfx-sim FRAG toLinear)
  const toLin = (x) => `lerp(${x} / 12.92, pow(max((${x} + 0.055) / 1.055, 0.0), 2.4), step(0.04045, ${x}))`;
  const colorStep = () => ({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Color', params: [
    P_('Particles.Color', TY.color, `float4(${toLin('Particles.UPE_CS.rgb')} * ${f(I)}, Particles.UPE_CS.a)`)] });
  const sizeCurve = em.sizeOverLifetime.enabled ? curveExpr(em.sizeOverLifetime.curve, 'Particles.NormalizedAge') : null;

  if (trail) {
    const bt = em.bladeTrail;
    const root = matVec(Rem, bt.from).map((v, i) => v + em.position[i]), tip = matVec(Rem, bt.to).map((v, i) => v + em.position[i]);
    const len = Math.hypot(...bt.to.map((v, i) => v - bt.from[i])) * 100;
    if (len < 1e-3) w('bladeTrail: kök ve uç aynı nokta');
    steps.push({ op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_TrailSpawn', params: [
      P_('Particles.UPE_Root', TY.vec3, toSim(f3(toUE(root)), true)),
      P_('Particles.UPE_Tip', TY.vec3, toSim(f3(toUE(tip)), true)),
      P_('Particles.UPE_Col0', TY.vec4, f4(c0)),
      P_('Particles.RibbonFacing', TY.vec3, `normalize(${toSim(f3(toUEDir(tip.map((v, i) => v - root[i]))), false)} + float3(0.0, 0.0, 1e-6))`),
      P_('Particles.Velocity', TY.vec3, ZERO3),
    ] });
    const wc = curveExpr(bt.width, 'Particles.NormalizedAge');
    const wv = [sizeCurve, wc === '1.0' ? null : wc].filter(Boolean).join(' * ') || '1.0';
    const g = grad('Particles.NormalizedAge');
    // vfx-sim TrailSim: genişlik w = width × sizeOverLifetime; taper tip: kök uca doğru (merkez uçtan w/2), root: uç köke, center: sabit orta
    const center = { tip: `lerp(Particles.UPE_Tip, Particles.UPE_Root, 0.5 * ${wv})`, root: `lerp(Particles.UPE_Root, Particles.UPE_Tip, 0.5 * ${wv})`, center: 'lerp(Particles.UPE_Root, Particles.UPE_Tip, 0.5)' }[bt.taper] || 'lerp(Particles.UPE_Root, Particles.UPE_Tip, 0.5)';
    const tl = [
      P_('Particles.Position', TY.position, center),
      P_('Particles.RibbonWidth', TY.float, `length(Particles.UPE_Tip - Particles.UPE_Root) * ${wv}`), // sistem ölçeğiyle (oyunda katana boyu) uyumlu
      P_('Particles.UPE_CS', TY.vec4, g ? `Particles.UPE_Col0 * ${g}` : 'Particles.UPE_Col0'),
    ];
    const cdx = customDataExpr(em.customData); if (cdx) tl.push(P_('Particles.DynamicMaterialParameter', TY.vec4, cdx));
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_TrailLook', params: tl });
    steps.push(colorStep());
    const rpr = { FacingMode: 'CustomSideVector', SortOrderHint: r.sortingOrder, bCastShadows: false };
    if (bt.uvMode === 'tile') { rpr.UV0Settings = { DistributionMode: 'TiledOverRibbonLength', TilingLength: bt.tileLength * 100 }; w('bladeTrail.uvMode tile → ribbon UV0 TiledOverRibbonLength (UPE uç yolu uzunluğu, Niagara şerit merkezi uzunluğu: yaklaşık)'); }
    out.renderer = { class: 'NiagaraRibbonRendererProperties', props: rpr };
    if (em.light.enabled) out.lightEmitter = lightPlan(em, out, { world: true, stInputs, toSim, w, single: true });
    for (const k of ['velocity', 'force', 'limitVelocity', 'noise', 'rotationOverLifetime', 'textureSheet']) if (em[k]?.enabled) w(`bladeTrail: ${k} izde yok sayılır`);
    if (dist) w('bladeTrail + distortion: ribbon bükülmesi UV yönü yaklaşık');
    if (m.gravity) w('bladeTrail: gravity izde yok sayılır');
    w('bladeTrail → Niagara Ribbon (CustomSideVector, genişlik = kök–uç); Catmull-Rom yerine ribbon tessellation, UV yönü yaklaşık');
    return out;
  }

  // ── Spawn 1: rastgeleler + başlangıç değerleri
  const ts = em.textureSheet, tiles = ts.enabled ? ts.tilesX * ts.tilesY : 1;
  const ro = em.rotationOverLifetime;
  const p1 = [
    P_('Particles.UPE_R', TY.vec4, 'float4(rand(1.0f), rand(1.0f), rand(1.0f), rand(1.0f))'),
    P_('Particles.UPE_R2', TY.vec4, 'float4(rand(1.0f), rand(1.0f), rand(1.0f), rand(1.0f))'),
    P_('Particles.UPE_Col0', TY.vec4, colExpr),
    P_('Particles.UPE_Size0', TY.float, `${lerpR(m.startSize)} * 100.0`),
    P_('Particles.UPE_Rot0', TY.float, lerpR(m.startRotation)),
  ];
  const hasAngV = ro.enabled && (ro.angularVelocity[0] || ro.angularVelocity[1]);
  if (hasAngV) p1.push(P_('Particles.UPE_AngV', TY.float, lerpR(ro.angularVelocity)));
  const hasFrame0 = ts.enabled && ts.randomStart && tiles > 1;
  if (hasFrame0) p1.push(P_('Particles.UPE_Frame0', TY.float, `floor(rand(1.0f) * ${f(tiles)})`));
  steps.push({ op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_Init', params: p1 });

  // ── Spawn 2: şekil (Unity şekil uzayında yön, sonra konum)
  const sh = em.shape;
  const se = shapeExprs(sh);
  steps.push({ op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_ShapeDir', params: [P_('Particles.UPE_SDir', TY.vec3, se.dir)] });
  const hasPos = se.pos !== ZERO3;
  if (hasPos) steps.push({ op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_ShapePos', params: [P_('Particles.UPE_SPos', TY.vec3, se.pos)] });
  // ── Spawn 3: konum + hız (şekil → emitter → efekt kökü → UE uzayı)
  const Rsh = sh.enabled ? unityEulerMatrix(sh.rotation) : unityEulerMatrix([0, 0, 0]);
  const Mdir = unityToUE(matMul(Rem, Rsh)); // UPE_SDir/UPE_SPos Unity şekil uzayında
  const Mpos = scaleM(unityToUE(matMul(matMul(Rem, Rsh), sh.enabled && sh.type === 'box' ? diag(sh.boxSize) : diag([1, 1, 1]))), 100);
  const tU = matVec(Rem, sh.enabled ? sh.position : [0, 0, 0]).map((v, i) => v + em.position[i]);
  const localPos = hasPos ? `${mulExpr(Mpos, 'Particles.UPE_SPos')} + ${f3(toUE(tU))}` : f3(toUE(tU));
  let dirU = 'Particles.UPE_SDir';
  if (sh.enabled && sh.randomDirection > 0) {
    const ru = randUnitExpr('Particles.UPE_R2');
    dirU = `normalize(lerp(Particles.UPE_SDir, ${ru.xy(ru.z)}, ${f(sh.randomDirection)}) + float3(0.0, 0.0, 1e-6))`;
  }
  const speed = Math.abs(m.startSpeed[1] - m.startSpeed[0]) < 1e-9 ? f(m.startSpeed[0] * 100) : `lerp(${f(m.startSpeed[0] * 100)}, ${f(m.startSpeed[1] * 100)}, Particles.UPE_R2.z)`;
  const zeroSpeed = m.startSpeed[0] === 0 && m.startSpeed[1] === 0;
  if (subTarget) out.offsetStep = true; // aşağıda: UPE_Spawn'dan sonra şekil ofseti + hız saklanır (olay işleyicisi kullanır)
  steps.push({ op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_Spawn', params: [
    P_('Particles.Position', TY.position, toSim(localPos, true)),
    P_('Particles.Velocity', TY.vec3, zeroSpeed ? ZERO3 : toSim(`${mulExpr(Mdir, dirU)} * ${speed}`, false)),
  ] });
  if (subTarget) {
    // olayla doğan parçacık: konum = olay konumu + şekil ofseti (emitter kökünden), hız = kendi hızı + olay hızı × miras (vfx-sim spawn(ev) ile aynı)
    const origin = toSim(f3(toUE(em.position)), true);
    steps.push({ op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_EvOff', params: [
      P_('Particles.UPE_SOff', TY.vec3, `Particles.Position - ${origin}`), P_('Particles.UPE_V0', TY.vec3, 'Particles.Velocity')] });
    for (const h of out.eventHandlers) {
      const ps = [P_('Particles.Position', TY.position, 'Particles.Position + Particles.UPE_SOff'),
        P_('Particles.Velocity', TY.vec3, h.inherit.velocity ? `Particles.UPE_V0 + Particles.Velocity * ${f(h.inherit.velocity)}` : 'Particles.UPE_V0')];
      if (h.inherit.color && h.event === 'LocationEvent') ps.push(P_('Particles.UPE_Col0', TY.vec4, 'Particles.UPE_Col0 * float4(saturate(Particles.Color.rgb), 1.0)'));
      h.steps = [{ op: 'module', script: 'ParticleEventScript', asset: h.receive, inputs: [] }, { op: 'params', script: 'ParticleEventScript', alias: 'UPE_EvSpawn', params: ps }];
    }
  }

  // ── Particle Update: sürtünme / hız sınırı (çözücüden önce, Particles.Velocity üzerinde; vfx-sim ile aynı formül)
  const lim = em.limitVelocity;
  if (lim.enabled && lim.drag > 0) {
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Drag', params: [P_('Particles.Velocity', TY.vec3,
      `Particles.Velocity * (max(0.0, length(Particles.Velocity) - ${f(lim.drag * 100)} * Engine.DeltaTime) / max(length(Particles.Velocity), 1e-4))`)] });
  }
  if (lim.enabled && lim.dampen > 0) {
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Limit', params: [P_('Particles.Velocity', TY.vec3,
      `Particles.Velocity * lerp(1.0, min(1.0, ${f(lim.limit * 100)} / max(length(Particles.Velocity), 1e-4)), 1.0 - pow(${f(1 - lim.dampen)}, Engine.DeltaTime * 60.0))`)] });
  }
  if (lim.enabled && lim.dampen <= 0 && lim.drag <= 0) w('limitVelocity: drag 0 ve dampen 0, etkisiz');
  // yerçekimi + kuvvet (yerleşik modüller; uzay seçilebilir)
  if (m.gravity) steps.push({ op: 'module', script: 'ParticleUpdateScript', asset: MOD.Gravity, inputs: [
    { name: 'Gravity', value: V.vec3([0, 0, -981 * m.gravity]) }, { name: 'Coordinate Space', value: V.enumv(EN.coordSpace, 'World'), optional: true }] });
  if (em.force.enabled && em.force.force.some((v) => v)) {
    steps.push({ op: 'module', script: 'ParticleUpdateScript', asset: MOD.Acceleration, inputs: [
      { name: 'Acceleration', value: V.vec3(toUE(em.force.force)) }, { name: 'Coordinate Space', value: V.enumv(EN.coordSpace, em.force.space === 'world' ? 'World' : 'Local'), optional: true }] });
    if (em.force.space === 'local' && em.rotation.some((v) => v)) w('force.space local: emitter dönüşü kuvvete uygulanmaz (Niagara Local = sistem uzayı)');
  }
  steps.push({ op: 'module', script: 'ParticleUpdateScript', asset: MOD.Solve, inputs: [] });

  // ── ömür boyu hız + gürültü (Unity: birikmeyen hız ofseti → çözücüden sonra konuma eklenir)
  const vel = em.velocity, nz = em.noise;
  const extra = [];
  const toSimVec = (u, space) => { // Unity vektörü (emitter yereli ya da dünya) → simülasyon uzayı
    const lit = f3(space === 'local' ? matVec(toUEMatrix(Rem), toUEDir(u)) : toUEDir(u));
    if (space === 'world' && !world) return `mul(float4(${lit}, 0.0), Engine.Owner.SystemWorldToLocal).xyz`;
    if (space === 'local' && world) return `mul(float4(${lit}, 0.0), Engine.Owner.SystemLocalToWorld).xyz`;
    return lit;
  };
  let sm = 1;
  if (vel.enabled) {
    sm = vel.speedModifier;
    const center = toSim(f3(toUE(em.position)), true);
    if (vel.linear.some((v) => v)) extra.push(toSimVec(vel.linear.map((v) => v * 100), vel.space));
    if (vel.orbital.some((v) => v)) extra.push(`cross(${toSimVec(vel.orbital, vel.space)}, Particles.Position - ${center})`);
    if (vel.radial) extra.push(`normalize(Particles.Position - ${center} + float3(0.0, 0.0, 1e-4)) * ${f(vel.radial * 100)}`);
  }
  if (nz.enabled && nz.strength > 0) {
    extra.push(`${noiseExpr(`(Particles.Position * ${f(nz.frequency * 0.01)})`, nz.octaves, `Emitter.Age * ${f(nz.scrollSpeed)}`)} * ${f(nz.strength * 100)}`);
    w('noise: Unity değer gürültüsü yerine sin tabanlı yumuşak alan (birikmeyen hız ofseti; genlik/frekans aynı, desen birebir değil)');
  }
  if (extra.length || Math.abs(sm - 1) > 1e-6) {
    const parts = [];
    if (Math.abs(sm - 1) > 1e-6) parts.push(`Particles.Velocity * ${f(sm - 1)}`);
    if (extra.length) parts.push(`(${extra.join(' + ')}) * ${f(sm)}`);
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Motion', params: [P_('Particles.Position', TY.position,
      `Particles.Position + (${parts.join(' + ')}) * Engine.DeltaTime`)] });
  }

  // ── görünüm: renk, boyut, dönüş, flipbook, hizalama
  const look = [];
  const g = grad('Particles.NormalizedAge');
  look.push(P_('Particles.UPE_CS', TY.vec4, g ? `Particles.UPE_Col0 * ${g}` : 'Particles.UPE_Col0'));
  const wExpr = sizeCurve ? `Particles.UPE_Size0 * ${sizeCurve}` : 'Particles.UPE_Size0';
  const cdx = customDataExpr(em.customData); if (cdx) look.push(P_('Particles.DynamicMaterialParameter', TY.vec4, cdx));
  const rotExpr = hasAngV ? '(Particles.UPE_Rot0 + Particles.UPE_AngV * Particles.Age)' : 'Particles.UPE_Rot0';
  if (decal) {
    // decal: Particles.DecalSize (yarı boyut, cm; UE X = yansıtma derinliği, Y = en, Z = boy), DecalOrientation (UE yerel X yansıtma yönü)
    const ds = r.decal.size;
    look.push(P_('Particles.DecalSize', TY.vec3, `float3(${f(ds[2] * 50)}, ${f(ds[0] * 50)}, ${f(ds[1] * 50)}) * (${wExpr}) * 0.01`));
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Look', params: look });
    // down: X → UE −Z, Y → UE +Y (Unity +X), Z → UE +X (Unity +Z); forward: X → emitter +Z, Y → emitter +X, Z → emitter +Y
    const cols = r.decal.projection === 'forward' ? [[0, 0, 1], [1, 0, 0], [0, 1, 0]].map((u) => toUEDir(matVec(Rem, u))) : [[0, 0, -1], [0, 1, 0], [1, 0, 0]];
    const B = [0, 1, 2].map((i) => cols.map((c) => c[i]));
    const qB = quatFromMatrix(B).map((v) => +v.toFixed(7));
    const h = `radians(-${rotExpr}) * 0.5`;
    const ql = qmulExpr(f4(qB), `float4(sin(${h}), 0.0, 0.0, cos(${h}))`);
    const fwd = r.decal.projection === 'forward';
    // forward: emitter yönü sistemle döner (world'de Owner ⊗); down: dünya aşağısı sabit (local'de Owner⁻¹ ⊗)
    const qExpr = fwd ? (world ? qmulExpr('Engine.Owner.Rotation', 'Particles.UPE_QL') : 'Particles.UPE_QL') : (world ? 'Particles.UPE_QL' : qmulExpr('float4(-Engine.Owner.Rotation.xyz, Engine.Owner.Rotation.w)', 'Particles.UPE_QL'));
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_DecalQ', params: [P_('Particles.UPE_QL', TY.quat, ql)] });
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_DecalRot', params: [P_('Particles.DecalOrientation', TY.quat, qExpr)] });
    steps.push(colorStep());
    out.renderer = { class: 'NiagaraDecalRendererProperties', props: { SortOrderHint: r.sortingOrder } };
    if (ts.enabled && tiles > 1) w('decal: flipbook Niagara decal renderer\'da yok sayılır');
    w('decal → Niagara Decal renderer (DecalSize yarı boyut, DecalOrientation, DecalColor = Particles.Color); UV yönü ve renk bağlaması editörde doğrulanmadı; karakterde "Receives Decals" kapalı olmalı (groundOnly)');
    if (em.light.enabled) out.lightEmitter = lightPlan(em, out, { world, stInputs, toSim, w });
    return out;
  }
  if (mesh) {
    // mesh: OBJ cm'de (mesh.rotation gömülü), ölçek = boyut (m); yön = emitter dönüşü ⊗ yerel Z (UE +X) etrafında −açı (vfx-sim mode 6 ile aynı)
    look.push(P_('Particles.Scale', TY.vec3, `float3(1.0, 1.0, 1.0) * (${wExpr}) * 0.01`));
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Look', params: look });
    const qB = quatFromMatrix(toUEMatrix(Rem)).map((v) => +v.toFixed(7));
    const h = `radians(-${rotExpr}) * 0.5`;
    const ql = qmulExpr(f4(qB), `float4(sin(${h}), 0.0, 0.0, cos(${h}))`);
    if (world) {
      steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_MeshQ', params: [P_('Particles.UPE_QL', TY.quat, ql)] });
      steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_MeshRot', params: [P_('Particles.MeshOrientation', TY.quat, qmulExpr('Engine.Owner.Rotation', 'Particles.UPE_QL'))] });
    } else steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_MeshRot', params: [P_('Particles.MeshOrientation', TY.quat, ql)] });
    if (ts.enabled && tiles > 1) {
      const fr = `floor(frac(Particles.NormalizedAge * ${f(ts.cycles)}) * ${f(tiles)})`;
      steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Frame', params: [P_('Particles.SubImageIndex', TY.float, hasFrame0 ? `fmod(${fr} + Particles.UPE_Frame0, ${f(tiles)})` : fr)] });
    }
    steps.push(colorStep());
    const rp = { SortOrderHint: r.sortingOrder, bCastShadows: false, SortMode: r.blend === 'additive' ? 'None' : 'ViewDistance', FacingMode: 'Default' };
    if (ts.enabled) rp.SubImageSize = { x: ts.tilesX, y: ts.tilesY };
    out.renderer = { class: 'NiagaraMeshRendererProperties', props: rp };
    if (r.alignment === 'local') { /* mesh her zaman emitter yönünde */ }
    w('mesh → Niagara Mesh renderer (MeshOrientation kuaterniyonu, Scale = boyut); OBJ içe aktarıcısı yönü/sarımı editörde doğrulanmadı');
    if (em.light.enabled) out.lightEmitter = lightPlan(em, out, { world, stInputs, toSim, w });
    return out;
  }
  if (r.mode === 'stretched') look.push(P_('Particles.SpriteSize', TY.vec2, `float2(${wExpr}, ${wExpr} * ${f(r.lengthScale)} + length(Particles.Velocity) * ${f(r.velocityScale)})`));
  else look.push(P_('Particles.SpriteSize', TY.vec2, `float2(${wExpr}, ${wExpr})`));
  look.push(P_('Particles.SpriteRotation', TY.float, hasAngV ? 'Particles.UPE_Rot0 + Particles.UPE_AngV * Particles.Age' : 'Particles.UPE_Rot0'));
  if (ts.enabled && tiles > 1) {
    const fr = `floor(frac(Particles.NormalizedAge * ${f(ts.cycles)}) * ${f(tiles)})`;
    look.push(P_('Particles.SubImageIndex', TY.float, hasFrame0 ? `fmod(${fr} + Particles.UPE_Frame0, ${f(tiles)})` : fr));
  }
  const rp = { SortOrderHint: r.sortingOrder, bCastShadows: false, SortMode: r.blend === 'additive' ? 'None' : 'ViewDistance' };
  if (ts.enabled) rp.SubImageSize = { x: ts.tilesX, y: ts.tilesY };
  const worldUp = world ? 'float3(0.0, 0.0, 1.0)' : 'normalize(mul(float4(0.0, 0.0, 1.0, 0.0), Engine.Owner.SystemWorldToLocal).xyz)';
  switch (r.mode) {
    case 'stretched': Object.assign(rp, { Alignment: 'VelocityAligned', FacingMode: 'FaceCamera' }); break;
    case 'horizontal': Object.assign(rp, { Alignment: 'Unaligned', FacingMode: 'CustomFacingVector' }); look.push(P_('Particles.SpriteFacing', TY.vec3, worldUp)); break;
    case 'vertical': Object.assign(rp, { Alignment: 'CustomAlignment', FacingMode: 'FaceCameraPosition' }); look.push(P_('Particles.SpriteAlignment', TY.vec3, worldUp)); break;
    default:
      if (r.alignment === 'local') {
        // Unity Local: quad emitter'ın yerel XY düzleminde, -Z tarafından aynasız (normal -Z, yukarı +Y)
        Object.assign(rp, { Alignment: 'CustomAlignment', FacingMode: 'CustomFacingVector' });
        const R = toUEMatrix(Rem);
        look.push(P_('Particles.SpriteFacing', TY.vec3, toSim(f3(matVec(R, toUEDir([0, 0, -1]))), false)));
        look.push(P_('Particles.SpriteAlignment', TY.vec3, toSim(f3(matVec(R, toUEDir([0, 1, 0]))), false)));
      } else Object.assign(rp, { Alignment: 'Unaligned', FacingMode: 'FaceCamera' });
  }
  steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Look', params: look });
  steps.push(colorStep());
  out.renderer = { class: 'NiagaraSpriteRendererProperties', props: rp };
  if (em.light.enabled) out.lightEmitter = lightPlan(em, out, { world, stInputs, toSim, w });
  return out;
}

// customData (x,y,z,w ömür eğrileri) → Particles.DynamicMaterialParameter (UE materyalinde Dynamic Parameter → UPE-SL i.custom)
function customDataExpr(cd) {
  if (!cd?.enabled) return null;
  return `float4(${['x', 'y', 'z', 'w'].map((k) => curveExpr(cd[k], 'Particles.NormalizedAge')).join(', ')})`;
}

// Işık: ayrı emitter + Light renderer. single: emitter konumunda tek parçacık (ömür = emitter süresi, eğri NormalizedAge = döngü);
// perParticle: kaynak emitter'ın adımları aynı tohumla kopyalanır (Niagara determinizmi → aynı parçacıklar), renk/yarıçap ışığa.
function lightPlan(em, src, { world, stInputs, toSim, w, single }) {
  const L = em.light, m = em.main;
  const per = !single && L.mode === 'perParticle';
  const lin = (c) => col(c).slice(0, 3).map(srgbToLinear);
  const toLin = (x) => `lerp(${x} / 12.92, pow(max((${x} + 0.055) / 1.055, 0.0), 2.4), step(0.04045, ${x}))`;
  const curve = curveExpr(L.curve, 'Particles.NormalizedAge');
  const k = L.intensity * LIGHT_K;
  const rgb = per && L.useParticleColor ? `${toLin('Particles.UPE_CS.rgb')} * ${f(k)}` : `${f3(lin(L.color).map((v) => v * k))}`;
  const lightStep = { op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_Light', params: [
    P_('Particles.Color', TY.color, `float4(${rgb} * ${curve}, 1.0)`), P_('Particles.LightRadius', TY.float, f(L.radius * 100))] };
  const props = { bUseInverseSquaredFalloff: false, DefaultExponent: 2, RadiusScale: 1, bAffectsTranslucency: true, SortOrderHint: em.renderer.sortingOrder };
  const out = { name: `${src.name}_Isik`, source: `${em.name} (ışık)`, kind: 'light', renderer: { class: 'NiagaraLightRendererProperties', props } };
  if (per) {
    out.data = { ...src.data, PreAllocationCount: Math.min(src.data.PreAllocationCount, Math.max(1, L.maxLights * 4)) };
    out.steps = JSON.parse(JSON.stringify(src.steps.filter((s) => s.alias !== 'UPE_Color'))).concat([lightStep]);
    w(`light perParticle → ayrı ışık emitter'ı (${out.name}): kaynak adımları aynı tohumla kopyalandı (aynı parçacıklar, doğrulanmadı); maxLights Niagara'da sınır değil`);
  } else {
    out.data = { bLocalSpace: !world, SimTarget: 'CPUSim', bDeterminism: true, RandomSeed: src.data.RandomSeed, AllocationMode: 'ManualEstimate', PreAllocationCount: 1 };
    out.steps = [
      { op: 'module', script: 'EmitterUpdateScript', module: 'EmitterState', inputs: stInputs },
      { op: 'module', script: 'EmitterUpdateScript', asset: MOD.SpawnBurst, inputs: [{ name: 'Spawn Count', value: V.int(1) }, { name: 'Spawn Time', value: V.float(0) }] },
      { op: 'module', script: 'ParticleSpawnScript', module: 'InitializeParticle', inputs: [{ name: 'Lifetime', value: V.float(Math.max(0.05, m.duration)) }] },
      { op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_LightSpawn', params: [P_('Particles.Position', TY.position, toSim(f3(toUE(em.position)), true)), P_('Particles.Velocity', TY.vec3, ZERO3)] },
      lightStep,
    ];
  }
  w(`light → Niagara Light renderer (Particles.Color = doğrusal renk × yoğunluk × ${LIGHT_K}, yarıçap ${f(L.radius * 100)} cm; parlaklık birimi yaklaşık)`);
  return out;
}

// ───────────────────────────── yürütme
const sref = (sys, o = {}) => ({ system: { refPath: sys }, emitterName: o.em || '', scriptName: o.script || '', moduleName: o.mod || '', rendererIndex: o.ri ?? -1, inputNameStack: o.inputs || [] });
const objPath = (p) => (p.split('/').pop().includes('.') ? p : `${p}.${p.split('/').pop()}`);
const pkgPath = (p) => p.replace(/\.[^/]*$/, '');

class Ctx {
  // Çağrı zaman aşımı: çok emitter'lı sistemlerde (ör. agir_h2_hilal, 50+ emitter) her ekleme yeniden derlemeyi tetikliyor ve
  // tek çağrı 60 sn'yi aşabiliyor (2026-11-06) → varsayılan 300 sn, UPE_UE_TIMEOUT_MS ile değişir.
  constructor(mcpUrl, log) { this.opts = { mcpUrl, timeoutMs: Number(process.env.UPE_UE_TIMEOUT_MS) || 300000 }; this.log = log || (() => {}); this.enums = new Map(); }
  call(ts, tool, args) { return callTool(ts, tool, args, this.opts); }
  async enumName(enumPath, display) {
    if (!this.enums.has(enumPath)) {
      const r = await this.call(NA, 'UEnum_Info', { enum: { refPath: enumPath } });
      let v = r?.returnValue ?? r; if (typeof v === 'string') v = JSON.parse(v);
      this.enums.set(enumPath, v.Values || v.values || []);
    }
    const vals = this.enums.get(enumPath);
    const hit = vals.find((x) => x.DisplayName === display) || vals.find((x) => x.Name === display || String(x.Name).endsWith('::' + display));
    if (!hit) throw new Error(`${enumPath}: "${display}" değeri yok (${vals.map((x) => x.DisplayName).join(', ')})`);
    return hit.Name;
  }
  async inputData(value) {
    switch (value.kind) {
      case 'float': return { struct: { refPath: TY.float }, value: { value: value.value } };
      case 'int': return { struct: { refPath: TY.int }, value: { value: value.value } };
      case 'bool': return { struct: { refPath: TY.bool }, value: { value: value.value ? -1 : 0 } };
      case 'vec3': return { struct: { refPath: TY.vec3 }, value: { x: value.value[0], y: value.value[1], z: value.value[2] } };
      case 'hlsl': return { struct: { refPath: '/Script/NiagaraEditor.NiagaraExt_StackInputData_HlslExpression' }, value: { hlslExpression: value.value } };
      case 'enum': return { struct: { refPath: '/Script/NiagaraEditor.NiagaraExt_StackInputData_Enum' }, value: { enum: { refPath: value.enum }, enumName: await this.enumName(value.enum, value.display), displayName: value.display } };
      default: throw new Error('bilinmeyen girdi türü ' + value.kind);
    }
  }
  async exists(p) { const r = await this.call(AT, 'exists', { path: pkgPath(p) }); return !!(r?.returnValue ?? r); }
}

// Derleme durumu: ilk sorgu derlemeyi başlatır (bayat döner); bayat/derleniyor bitene kadar sor
async function waitCompile(ctx, sysPath) {
  let s;
  for (let k = 0; k < 60; k++) {
    try { s = (await ctx.call(NS, 'GetSystemCompileState', { system: { refPath: sysPath } })).returnValue; }
    catch (e) { // editör tarafı 120 sn bekleyip vazgeçiyor (yoğun derleme, 2026-11-07): tekrar sor, en çok 10 kez
      if (!/Timed out after/i.test(e.message) || k >= 10) throw e;
      ctx.log(`[unreal] derleme sürüyor (${k + 1}), bekleniyor…`); continue;
    }
    if (k >= 1 && !s.bIsCompiling && !s.bIsStale) break;
  }
  const errors = [];
  for (const sc of s.scripts || []) for (const ev of sc.compileEvents || []) {
    if (ev.severity !== 'Error') continue;
    const msg = String(ev.message || ''); const lines = msg.match(/error[^\n]*/g);
    errors.push(`${sc.emitterName}/${String(sc.scriptName).replace('ENiagaraScriptUsage::', '')}: ${(lines || [msg]).join(' | ').slice(0, 500)}`);
  }
  return { status: s.aggregateStatus, errors, hasWarnings: !!s.bHasWarnings };
}

// Yerleşik bükülme (Custom HLSL; vfx-sim DIST_FRAG ile aynı formül). Girdiler: UV, VC (parçacık rengi), T (zaman), Tex + skalerler.
// Çıkış float4(ofset.x, −ofset.y, maske, 0) → ue-material wireDistortionOutput (SceneColor + OffsetFraction).
export const DISTORT_HLSL = [
  'struct UPED {',
  '  float2 h22(float2 p) { p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3))); return frac(sin(p) * 43758.5453) * 2.0 - 1.0; }',
  '  float gn(float2 p) { float2 i = floor(p), f = frac(p), u = f * f * (3.0 - 2.0 * f);',
  '    return lerp(lerp(dot(h22(i), f), dot(h22(i + float2(1, 0)), f - float2(1, 0)), u.x), lerp(dot(h22(i + float2(0, 1)), f - float2(0, 1)), dot(h22(i + float2(1, 1)), f - float2(1, 1)), u.x), u.y); }',
  '};',
  'UPED D;',
  'float2 uv = float2(UV.x, 1.0 - UV.y);',
  'float2 sc = float2(ScrollU, ScrollV);',
  'float2 uvT = Mode > 1.5 ? uv + sc * T : uv;',
  'float4 t = Texture2DSample(Tex, TexSampler, float2(uvT.x, 1.0 - uvT.y));',
  'float mask = VC.a * t.a; float2 dir;',
  'if (Mode < 0.5) { float2 q = uv - 0.5; dir = length(q) > 1e-4 ? normalize(q) : float2(0.0, 0.0); }',
  'else if (Mode < 1.5) { float2 p = uv * Freq + sc * T; dir = float2(D.gn(p), D.gn(p + float2(17.3, 5.1))) * 1.6; }',
  'else dir = t.rg * 2.0 - 1.0;',
  'float2 o = dir * mask * Strength;',
  'return float4(o.x, -o.y, mask, 0.0);',
].join('\n');
const DISTORT_SCALARS = ['Strength', 'Mode', 'Freq', 'ScrollU', 'ScrollV'];

async function ensureDistortionBase(ctx, m) {
  const add = async (c, x, y) => (await ctx.call(MT, 'add_expression', { material_or_function: m, expression_class: { refPath: '/Script/Engine.' + c }, x, y })).returnValue;
  const set = (inst, values) => ctx.call(OT, 'set_properties', { instance: inst, values: JSON.stringify(values) });
  const conn = (a, ao, b, bi) => ctx.call(MT, 'connect_expressions', { from_expression: a, from_output_name: ao, to_expression: b, to_input_name: bi });
  const cu = await add('MaterialExpressionCustom', -400, 0);
  await set(cu, { Code: DISTORT_HLSL, OutputType: 'CMOT_Float4', Description: 'UPE distortion' });
  const names = ['UV', 'VC', 'T', 'Tex', ...DISTORT_SCALARS];
  await set(cu, { Inputs: [{ inputName: names[0] }] });
  let cur = (await ctx.call(OT, 'get_properties', { instance: cu, properties: ['Inputs'] })).returnValue; if (typeof cur === 'string') cur = JSON.parse(cur);
  await set(cu, { Inputs: [cur.Inputs[0], ...names.slice(1).map((n) => ({ inputName: n }))] });
  let y = -500;
  const src = async (n) => {
    y += 70;
    if (n === 'UV') return [await add('MaterialExpressionTextureCoordinate', -1000, y), ''];
    if (n === 'VC') return [await add('MaterialExpressionParticleColor', -1000, y), 'RGBA'];
    if (n === 'T') return [await add('MaterialExpressionTime', -1000, y), ''];
    if (n === 'Tex') { const t = await add('MaterialExpressionTextureObjectParameter', -1000, y); await set(t, { ParameterName: 'Tex', Texture: { refPath: '/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture' } }); return [t, '']; }
    const s = await add('MaterialExpressionScalarParameter', -1000, y); await set(s, { ParameterName: n, DefaultValue: n === 'Strength' ? 0.03 : n === 'Freq' ? 4 : 0 }); return [s, ''];
  };
  for (const n of names) { const [node, out] = await src(n); await conn(node, out, cu, n); }
  await wireDistortionOutput(ctx, m, cu);
}

// Ortak materyal (yoksa kur): Unlit, iki yüzlü, Niagara sprite/ribbon/mesh; Particle Color × Tex. Distortion: yukarıdaki Custom.
async function ensureBaseMaterial(ctx, blend, { mesh = false } = {}) {
  const name = `M_UPE_Particle_${blend}`, p = `${MATERIALS_PATH}/${name}`;
  if (await ctx.exists(p)) {
    if (mesh) await ctx.call(OT, 'set_properties', { instance: { refPath: objPath(p) }, values: JSON.stringify({ bUsedWithNiagaraMeshParticles: true }) }).catch(() => {});
    return { path: objPath(p), created: false };
  }
  const m = (await ctx.call(MT, 'create_material', { folder_path: MATERIALS_PATH, asset_name: name })).returnValue;
  const isDecal = blend.startsWith('Decal'), additive = blend.includes('Additive'), soft = blend.endsWith('Soft');
  const props = isDecal // Deferred Decal: alfa → Translucent + ışıklı BaseColor (yanık izi zemin ışığını alır); additive → AlphaComposite + Unlit emissive (opaklık 0 = toplama)
    ? { MaterialDomain: 'MD_DeferredDecal', BlendMode: additive ? 'BLEND_AlphaComposite' : 'BLEND_Translucent', ShadingModel: additive ? 'MSM_Unlit' : 'MSM_DefaultLit' }
    : { BlendMode: additive ? 'BLEND_Additive' : 'BLEND_Translucent', ShadingModel: 'MSM_Unlit', TwoSided: true, bUsedWithNiagaraSprites: true, bUsedWithNiagaraRibbons: true, bUsedWithNiagaraMeshParticles: true };
  await ctx.call(OT, 'set_properties', { instance: m, values: JSON.stringify(props) });
  if (blend === 'Distortion') {
    await ensureDistortionBase(ctx, m);
    await ctx.call(MT, 'layout_expressions', { material_or_function: m }).catch(() => {});
    await ctx.call(MT, 'recompile', { material_or_function: m });
    return { path: objPath(p), created: true };
  }
  const add = async (c, x, y) => (await ctx.call(MT, 'add_expression', { material_or_function: m, expression_class: { refPath: '/Script/Engine.' + c }, x, y })).returnValue;
  const conn = (a, ao, b, bi) => ctx.call(MT, 'connect_expressions', { from_expression: a, from_output_name: ao, to_expression: b, to_input_name: bi });
  const set = (inst, values) => ctx.call(OT, 'set_properties', { instance: inst, values: JSON.stringify(values) });
  const mask = async (src, ch, x, y) => { const k = await add('MaterialExpressionComponentMask', x, y); await set(k, { R: ch.includes('R'), G: ch.includes('G'), B: ch.includes('B'), A: ch.includes('A') }); await conn(src, '', k, ''); return k; };
  // renk kaynağı: parçacıkta Particle Color (RGB/A çıkışları), decal'de Decal Color (Niagara Decal renderer'ın Particles.Color'ı; maskelerle)
  let pcRGB, pcA;
  if (isDecal) { const dc = await add('MaterialExpressionDecalColor', -950, -100); pcRGB = [await mask(dc, 'RGB', -750, -160), '']; pcA = [await mask(dc, 'A', -750, -40), '']; }
  else { const pc = await add('MaterialExpressionParticleColor', -700, -100); pcRGB = [pc, 'RGB']; pcA = [pc, 'A']; }
  const tx = await add('MaterialExpressionTextureSampleParameter2D', -700, 150);
  await set(tx, { ParameterName: 'Tex' });
  await set(tx, { Texture: { refPath: '/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture' } }).catch(() => {});
  const rgb = await add('MaterialExpressionMultiply', -400, -100); let a = await add('MaterialExpressionMultiply', -400, 150);
  await conn(pcRGB[0], pcRGB[1], rgb, 'A'); await conn(tx, 'RGB', rgb, 'B'); await conn(pcA[0], pcA[1], a, 'A'); await conn(tx, 'A', a, 'B');
  if (soft) { // yumuşak parçacık: DepthFade(Opacity = alfa, FadeDistance = parametre cm) → alfa yerine
    const df = await add('MaterialExpressionDepthFade', -250, 250), fd = await add('MaterialExpressionScalarParameter', -450, 320);
    await set(fd, { ParameterName: 'FadeDistance', DefaultValue: 30 });
    await conn(a, '', df, 'Opacity').catch(() => conn(a, '', df, 'InOpacity'));
    await conn(fd, '', df, 'FadeDistance').catch(() => conn(fd, '', df, 'Fade Distance'));
    a = df;
  }
  if (isDecal && !additive) {
    await ctx.call(MT, 'connect_to_output', { expression: rgb, output_name: '', material_property: 'MP_BaseColor' });
    await ctx.call(MT, 'connect_to_output', { expression: a, output_name: '', material_property: 'MP_Opacity' });
  } else if (!additive) {
    await ctx.call(MT, 'connect_to_output', { expression: rgb, output_name: '', material_property: 'MP_EmissiveColor' });
    await ctx.call(MT, 'connect_to_output', { expression: a, output_name: '', material_property: 'MP_Opacity' });
  } else { // Unity additive (SrcAlpha, One): renk × alfa (decal'de AlphaComposite, opaklık bağlanmaz = 0)
    const e = await add('MaterialExpressionMultiply', -150, 0);
    await conn(rgb, '', e, 'A'); await conn(a, '', e, 'B');
    await ctx.call(MT, 'connect_to_output', { expression: e, output_name: '', material_property: 'MP_EmissiveColor' });
    if (isDecal) { const z = await add('MaterialExpressionConstant', -150, 150); await set(z, { R: 0 }); await ctx.call(MT, 'connect_to_output', { expression: z, output_name: '', material_property: 'MP_Opacity' }); }
  }
  await ctx.call(MT, 'layout_expressions', { material_or_function: m }).catch(() => {});
  await ctx.call(MT, 'recompile', { material_or_function: m });
  return { path: objPath(p), created: true };
}

// PNG → UE doku varlığı (yoksa içe aktarılır; varsa dokunulmaz). props: doku ayarları (adresleme, sRGB, LOD grubu)
async function importTexture(ctx, { folder, name, file, fallback, props, warn }) {
  const p = `${folder}/${name}`;
  if (await ctx.exists(p)) return { path: objPath(p), created: false };
  if (!fs.existsSync(file) && fallback) { warn(`doku dosyası yok: ${file} → ${path.basename(fallback, '.png')}`); file = fallback; }
  if (!fs.existsSync(file)) throw new Error(`doku dosyası yok: ${file}`);
  await ctx.call(TT, 'import_file', { folder_path: folder, asset_name: name, source_file: path.resolve(file).replace(/\\/g, '/') });
  await ctx.call(OT, 'set_properties', { instance: { refPath: objPath(p) }, values: JSON.stringify(props) })
    .catch((e) => warn(`doku ayarı (${name}): ${e.message.slice(0, 150)}`));
  return { path: objPath(p), created: true };
}

const ensureTexture = (ctx, tex, contentPath, texturesDir, warn) => importTexture(ctx, { folder: `${contentPath}/Textures`, name: `T_UPE_${safeName(tex, 'tex')}`,
  file: path.join(texturesDir, `${tex}.png`), fallback: path.join(texturesDir, 'soft.png'), props: { AddressX: 'TA_Clamp', AddressY: 'TA_Clamp', LODGroup: 'TEXTUREGROUP_Effects' }, warn });

async function ensureMaterialInstance(ctx, mat, texPath) {
  const p = `${MATERIALS_PATH}/${mat.instance}`;
  const base = await ensureBaseMaterial(ctx, mat.blend, { mesh: mat.mesh });
  const created = base.created ? [base.path] : [];
  if (!(await ctx.exists(p))) {
    await ctx.call(MIT, 'create', { folder_path: MATERIALS_PATH, asset_name: mat.instance, parent: { refPath: base.path } });
    created.push(objPath(p));
  }
  await ctx.call(MIT, 'set_texture_parameter', { instance: { refPath: objPath(p) }, name: 'Tex', value: { refPath: texPath } });
  for (const [k, v] of Object.entries(mat.scalars || {})) await ctx.call(MIT, 'set_scalar_parameter', { instance: { refPath: objPath(p) }, name: k, value: v });
  return { path: objPath(p), created };
}

// ───────────────────────────── mesh varlığı
// Plan: { asset, obj (OBJ metni) } prosedürel ya da { asset, file } meshes/ dosyası. OBJ dosyası UPE önizlemesiyle aynı dönüşümle
// (three/glTF → Unity x aynası → UE, Y içe aktarıcı aynası telafili) yeniden yazılır; GLB/FBX olduğu gibi içe aktarılır (uyarı).
// İçe aktarma aracı UE MCP'de belgelenmedi: bilinen adlar sırayla denenir (aşağıda), hiçbiri yoksa anlaşılır hata.
export async function objFileToUEObj(file, rotation, name) {
  const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
  const root = new OBJLoader().parse(fs.readFileSync(file, 'utf8'));
  root.updateMatrixWorld(true);
  const P = [], N = [], UV = [], I = [];
  root.traverse((o) => {
    if (!o.isMesh) return; const g = o.geometry; if (!g.attributes.normal) g.computeVertexNormals();
    const base = P.length / 3, pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) { P.push(-pos.getX(i), pos.getY(i), pos.getZ(i)); N.push(-nor.getX(i), nor.getY(i), nor.getZ(i)); UV.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); }
    const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
    for (let i = 0; i + 2 < idx.length; i += 3) I.push(base + idx[i], base + idx[i + 2], base + idx[i + 1]);
  });
  let mx = 0; for (const v of P) mx = Math.max(mx, Math.abs(v)); if (mx > 20) for (let i = 0; i < P.length; i++) P[i] *= 0.01;
  return meshToOBJ(transformMesh({ positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(UV), indices: new Uint32Array(I) }, rotation), name);
}
const IMPORT_TOOLS = [
  ['editor_toolset.toolsets.static_mesh.StaticMeshTools', 'import_file'], ['editor_toolset.toolsets.static_mesh.StaticMeshTools', 'import_static_mesh'],
  [AT, 'import_file'], [AT, 'import_asset'], [TT, 'import_file'],
];
async function ensureMesh(ctx, mp, { contentPath, meshesDir, warn }) {
  const folder = `${contentPath}/Meshes`, p = `${folder}/${mp.asset}`;
  if (await ctx.exists(p)) return { path: objPath(p), created: false };
  fs.mkdirSync(MESH_TMP_DIR, { recursive: true });
  let file;
  if (mp.obj) { file = path.join(MESH_TMP_DIR, `${mp.asset}.obj`); fs.writeFileSync(file, mp.obj); }
  else {
    const src = path.join(meshesDir, mp.file);
    if (!fs.existsSync(src)) throw new Error(`mesh dosyası yok: ${src}`);
    if (/\.obj$/i.test(src)) { file = path.join(MESH_TMP_DIR, `${mp.asset}.obj`); fs.writeFileSync(file, await objFileToUEObj(src, mp.rotation, mp.asset)); }
    else { file = src; warn(`mesh ${mp.file}: GLB/FBX olduğu gibi içe aktarıldı — eksen/ölçek/mesh.rotation UPE önizlemesinden farklı olabilir (OBJ önerilir)`); }
  }
  const tried = [];
  for (const [ts, tool] of IMPORT_TOOLS) {
    try {
      await ctx.call(ts, tool, { folder_path: folder, asset_name: mp.asset, source_file: path.resolve(file).replace(/\\/g, '/') });
      if (await ctx.exists(p)) { ctx.log(`[unreal] mesh: ${p} (${ts.split('.').pop()}.${tool})`); return { path: objPath(p), created: true }; }
      tried.push(`${tool}: varlık oluşmadı`);
    } catch (e) { tried.push(`${ts.split('.').pop()}.${tool}: ${String(e.message).slice(0, 120)}`); }
  }
  throw new Error(`mesh içe aktarılamadı (${p}); OBJ: ${file}. Denenen araçlar: ${tried.join(' | ')}. UE'de bu OBJ'yi ${folder}/${mp.asset} olarak elle içe aktarıp tekrar gönder.`);
}

// Plan adımı → MCP çağrıları. st.script: EmitterUpdateScript | ParticleSpawnScript | ParticleUpdateScript | ParticleEventScript
async function runStep(ctx, sysPath, emName, st, issues) {
  let mod = st.module;
  if (st.op === 'params') {
    const res = await ctx.call(NS, 'AddSetParametersModule', { moduleLocationRef: sref(sysPath, { em: emName, script: st.script }),
      parameters: st.params.map((p) => ({ variable: { name: p.name, type: { classStructOrEnum: { refPath: p.type } } } })) });
    mod = res.returnValue.moduleName;
    for (const p of st.params) {
      const touch = { stackInputRef: sref(sysPath, { em: emName, script: st.script, mod, inputs: [p.name] }), inputData: await ctx.inputData({ kind: 'hlsl', value: p.hlsl }) };
      await ctx.call(NS, 'SetStackInputData', touch);
      (ctx.lastInput ||= new Map()).set(emName, touch);
      (ctx.inputsByName ||= new Map()).set(`${emName}|${p.name}`, touch);
    }
    return mod;
  }
  if (st.asset) mod = (await ctx.call(NS, 'AddModule', { moduleLocationRef: sref(sysPath, { em: emName, script: st.script }), moduleAsset: { refPath: st.asset } })).returnValue.moduleName;
  for (const inp of st.inputs || []) {
    try {
      await ctx.call(NS, 'SetStackInputData', { stackInputRef: sref(sysPath, { em: emName, script: st.script, mod, inputs: [inp.name] }), inputData: await ctx.inputData(inp.value) });
    } catch (e) {
      if (!inp.optional) throw e;
      // gizli (static switch) isteğe bağlı girdi: o modda anlamsız, sessiz geç
      if (/hidden by static-switch/.test(e.message) && !inp.warnIfHidden) continue;
      issues.push(`${mod}.${inp.name}: ${e.message.slice(0, 200)}`);
    }
  }
  return mod;
}

// Alt emitter olayları (tüm emitter'lar kurulduktan sonra; kaynak emitter kimliği gerekir): hedef emitter'ın EventHandlerScriptProps'u
// (SpawnedParticles, SourceEmitterID, SourceEventName DeathEvent|LocationEvent) + olay betiğine Receive modülü ve UPE_EvSpawn.
// UE MCP'de olay işleyicisi için ayrı araç görülmedi: emitter verisi (SetEmitterData) ve ParticleEventScript betik adı denenir;
// başarısızlık efekti durdurmaz, elle bağlama yönergesiyle uyarı olur.
const EVENT_SCRIPT_NAMES = ['ParticleEventScript', 'ParticleEventScript0', 'EventHandler0'];
async function setupEventHandlers(ctx, sysPath, ep, emName, nameMap, issues) {
  const sum = (await ctx.call(NS, 'GetSystemSummary', { system: { refPath: sysPath } })).returnValue || {};
  const idOf = (n) => { const e = (sum.emitters || []).find((x) => x.emitterName === n); return e && (e.emitterId ?? e.id ?? e.handleId ?? e.emitterHandleId ?? e.uniqueId ?? e.guid ?? e.emitterGuid); };
  const manual = (h) => `UE'de elle: ${emName} → Event Handler (Source ${nameMap.get(h.sourceEmitter) || h.sourceEmitter}, ${h.event}, Spawned Particles ${h.props.MinSpawnNumber}–${h.props.SpawnNumber}) + ${h.receive.split('.').pop()}; kaynakta ${h.event === 'DeathEvent' ? 'Generate Death Event' : 'Generate Location Event'}`;
  const props = ep.eventHandlers.map((h) => ({ ...h.props, SourceEventName: h.event, SourceEmitterID: idOf(nameMap.get(h.sourceEmitter) || h.sourceEmitter) }));
  let ok = props.every((x) => x.SourceEmitterID);
  if (!ok) issues.push(`alt emitter: kaynak emitter kimliği GetSystemSummary'de yok (alanlar: ${Object.keys(sum.emitters?.[0] || {}).join(', ')}). ${ep.eventHandlers.map(manual).join(' | ')}`);
  else await ctx.call(NS, 'SetEmitterData', { emitter: sref(sysPath, { em: emName }), emitterData: { propertyValues: JSON.stringify({ EventHandlerScriptProps: props }) } })
    .catch((e) => { ok = false; issues.push(`alt emitter: EventHandlerScriptProps yazılamadı (${e.message.slice(0, 160)}). ${ep.eventHandlers.map(manual).join(' | ')}`); });
  if (!ok) return false;
  if (ep.eventHandlers.length > 1) issues.push('alt emitter: birden çok olay işleyicisi; modüller yalnız ilk olay betiğine eklendi');
  const h = ep.eventHandlers[0];
  for (const sn of EVENT_SCRIPT_NAMES) {
    try {
      for (const st of h.steps) await runStep(ctx, sysPath, emName, { ...st, script: sn }, issues);
      return true;
    } catch (e) { if (sn === EVENT_SCRIPT_NAMES.at(-1)) issues.push(`alt emitter: olay betiğine modül eklenemedi (${e.message.slice(0, 160)}). ${manual(h)}`); }
  }
  return false;
}

// Renderer bağlamaları (Particles.Scale / MeshOrientation / Decal* / Ribbon*) AddRenderer anında önbelleğe alınıyor ve ilk
// derlemeden sonra tazelenmiyor (UE 5.8, 2026-11-06): renderer "bBindingExistsOnSource: false" kalıyor ve mesh dönüşsüz/
// ölçeksiz çiziliyor (yaylar yanlış yöne dönük). Derlemeden sonra sprite dışı renderer'larda bağlama yoksa emitter'ın son
// Set Parameters girdisini aynı değerle yeniden yaz (yeniden derleme + bağlama tazelenir). Yeniden derleme gerekiyorsa true.
const BINDING_KEYS = ['ScaleBinding', 'MeshOrientationBinding', 'DecalOrientationBinding', 'DecalSizeBinding', 'RibbonWidthBinding', 'RibbonFacingBinding'];
export function staleBindings(rendererJson, written) {
  const s = typeof rendererJson === 'string' ? rendererJson : JSON.stringify(rendererJson);
  const out = [];
  for (const k of BINDING_KEYS) {
    const i = s.indexOf(k); if (i < 0) continue;
    const seg = s.slice(i, i + 900);
    const attr = (seg.match(/Particles\.([A-Za-z]+)/) || [])[1];
    const exists = (seg.match(/bBindingExistsOnSource\\*"\s*:\s*(true|false)/) || [])[1];
    if (attr && written.has(`Particles.${attr}`) && exists === 'false') out.push(`Particles.${attr}`);
  }
  return out;
}
async function refreshRendererBindings(ctx, sysPath, plan, builtNames, warn) {
  let touched = false;
  for (const ep of plan.emitters) {
    if (!['mesh', 'decal', 'ribbon'].includes(ep.kind)) continue;
    const em = builtNames.get(ep.name) || ep.name, touch = ctx.lastInput?.get(em);
    const written = new Set(ep.steps.flatMap((st) => (st.params || []).map((p) => p.name)));
    const check = async () => staleBindings(await ctx.call(NS, 'GetRendererData', { rendererRef: sref(sysPath, { em, ri: 0 }) }).catch(() => ''), written);
    let stale = await check();
    // emitter başına: dokun → derlemeyi bekle → yeniden bak (arka arkaya dokunuşlar birbirinin tazelemesini eziyordu)
    for (let k = 0; stale.length && touch && k < 4; k++) {
      // bayat özniteliği yazan girdinin kendisine dokun (elle denemede işe yarayan yol); yoksa son girdi
      // aynı metni yazmak değişiklik sayılmıyor (yeniden derleme yok) → anlamı aynı, metni farklı: parantez sarmalı
      for (const a of stale) {
        const t = ctx.inputsByName?.get(`${em}|${a}`) || touch;
        const e = `(${t.inputData.value.hlslExpression})`;
        const nt = { ...t, inputData: { ...t.inputData, value: { hlslExpression: e } } };
        await ctx.call(NS, 'SetStackInputData', nt);
        ctx.inputsByName?.set(`${em}|${a}`, nt);
      }
      touched = true;
      await waitCompile(ctx, sysPath);
      await new Promise((r) => setTimeout(r, 1500)); // renderer derlemeden sonraki karede tazeleniyor
      stale = await check();
    }
    if (stale.length) warn(`${ep.source}: renderer bağlaması tazelenemedi (${stale.join(', ')}); UE'de emitter'ı elle yeniden derle`);
  }
  if (touched) { // son durum: önceki emitter'ların bağlaması sonraki derlemelerde bozulmadı mı
    for (const ep of plan.emitters) {
      if (!['mesh', 'decal', 'ribbon'].includes(ep.kind)) continue;
      const em = builtNames.get(ep.name) || ep.name;
      const written = new Set(ep.steps.flatMap((st) => (st.params || []).map((p) => p.name)));
      const st = staleBindings(await ctx.call(NS, 'GetRendererData', { rendererRef: sref(sysPath, { em, ri: 0 }) }).catch(() => ''), written);
      if (st.length) warn(`${ep.source}: renderer bağlaması son kontrolde bayat (${st.join(', ')})`);
    }
  }
  return touched;
}

async function buildEmitter(ctx, sysPath, ep, matPath, meshPath) {
  const r = await ctx.call(NS, 'AddEmitter', { system: { refPath: sysPath }, templateEmitter: { refPath: TEMPLATE_EMITTER }, emitterName: ep.name });
  const emName = r.returnValue?.emitterName || ep.name;
  const issues = [];
  await ctx.call(NS, 'SetEmitterData', { emitter: sref(sysPath, { em: emName }), emitterData: { propertyValues: JSON.stringify(ep.data) } })
    .catch((e) => issues.push(`emitter özellikleri: ${e.message.slice(0, 300)}`));
  for (const st of ep.steps) await runStep(ctx, sysPath, emName, st, issues);
  // renderer (şablonda sprite; ribbon için değiştir)
  let ri = 0;
  if (ep.renderer.class !== 'NiagaraSpriteRendererProperties') {
    await ctx.call(NS, 'RemoveRenderer', { rendererToRemove: sref(sysPath, { em: emName, ri: 0 }) });
    const ar = await ctx.call(NS, 'AddRenderer', { newRendererLocation: sref(sysPath, { em: emName }), rendererClass: { refPath: `/Script/Niagara.${ep.renderer.class}` } });
    ri = ar.returnValue?.rendererIndex ?? ar.returnValue?.index ?? 0;
  }
  const props = { ...ep.renderer.props };
  if (ep.kind === 'mesh') Object.assign(props, { Meshes: [{ Mesh: { refPath: meshPath } }], bOverrideMaterials: true, OverrideMaterials: [{ ExplicitMat: { refPath: matPath } }] });
  else if (ep.kind !== 'light') props.Material = { refPath: matPath };
  const setR = (o) => ctx.call(NS, 'SetRendererData', { renderer: sref(sysPath, { em: emName, ri }), rendererData: { propertyValues: JSON.stringify(o) } });
  try { await setR(props); }
  catch (e) {
    issues.push(`renderer toplu ayar: ${e.message.slice(0, 200)}`);
    for (const [k, v] of Object.entries(props)) await setR({ [k]: v }).catch((e2) => issues.push(`renderer.${k}: ${e2.message.slice(0, 150)}`));
  }
  return { emName, issues };
}

// Çalışan Unreal editörünün MCP sunucusuna bağlanabiliyor mu
export async function unrealStatus({ mcpUrl } = {}) {
  const url = mcpUrl || DEFAULT_MCP_URL;
  try {
    const client = await getClient(url);
    const sv = client.getServerVersion?.() || {};
    const out = { connected: true, mcpUrl: url };
    if (sv.name) out.server = sv.name;
    if (sv.version) out.engineVersion = sv.version;
    try {
      const ts = await callTop('list_toolsets', {}, { mcpUrl: url });
      out.niagaraToolset = String(typeof ts === 'string' ? ts : JSON.stringify(ts)).includes('NiagaraToolset_System');
    } catch {}
    try { // proje adı/sürümü: Project Settings > Description
      const r = await callTool('ConfigSettingsToolset.ConfigSettingsToolset', 'GetSectionPropertyValues',
        { containerName: 'Project', categoryName: 'Project', sectionName: 'General', propertyNames: ['ProjectName', 'ProjectVersion'] }, { mcpUrl: url });
      let v = r?.returnValue ?? r; if (typeof v === 'string') v = JSON.parse(v);
      if (v?.ProjectName) out.projectName = v.ProjectName;
      if (v?.ProjectVersion) out.projectVersion = v.ProjectVersion;
    } catch {}
    return out;
  } catch (e) {
    return { connected: false, mcpUrl: url, error: e.message };
  }
}

// effects: normalizeEffect'ten geçmiş efektler
// materialsDir/shadersDir: UPE materials/ ve shaders/ (renderer.material çözümlemesi; varsayılan depo klasörleri)
// emitter.follow (kemik/eşya izleyen katman, ör. kılıç izi) → ayrı sistem `<ad>_iz`: oyunda o kemiğe/eşyaya takılır (sistem yereli =
// UPE'deki kemik/eşya yerel çerçevesi, Unity→UE eksen eşlemesiyle; ölçek/hizalama oyunda). Diğer katmanlar ana sistemde kalır.
// Bağımlılık: alt emitter kaynağı/hedefi bölünmeyi aşarsa uyarı. → [ana, iz?]
export function splitFollowEffects(effect) {
  const isF = (em) => em?.follow && em.follow.target && em.follow.target !== 'none';
  const fol = (effect.emitters || []).filter(isF);
  if (!fol.length) return [effect];
  const rest = effect.emitters.filter((em) => !isF(em));
  const targets = [...new Set(fol.map((em) => `${em.follow.target}:${em.follow.name}`))];
  const iz = { ...effect, name: `${effect.name}_iz`, emitters: fol, attach: { target: fol[0].follow.target, name: fol[0].follow.name, position: [0, 0, 0], rotation: [0, 0, 0] },
    _followNote: `follow (${targets.join(', ')}) → ayrı sistem NS_${safeName(effect.name)}_iz; oyunda ${targets.join(', ')} çerçevesine bağlanır (sistem yereli = UPE yerel çerçevesi; Unity z → UE +X)` };
  return rest.length ? [{ ...effect, emitters: rest }, iz] : [iz];
}

// Çok emitter'lı efekt (ör. agir_h2_hilal, 53) tek sistemde kurulurken her ekleme tüm sistemi yeniden derliyor; tek MCP çağrısı
// 5 dk'yı aşıyor (30 emitter'da bile), editör belleği ~25 GB (2026-11-06). maxEmitters (20)'den fazlası `<ad>_2`, `<ad>_3`… sistemlerine bölünür;
// oyunda parçalar aynı kökte birlikte doğar (FElarionAttackData::SlashVfxExtra). Alt emitter bağı parçalar arasında bölünmez.
export function chunkEffect(effect, maxEmitters = 20) {
  const ems = effect.emitters || [];
  if (ems.length <= maxEmitters) return [effect];
  const linked = new Set(ems.filter((e) => e.subEmitters?.items?.length).flatMap((e) => [e.name, ...e.subEmitters.items.map((i) => i.emitter)]));
  const groups = []; let cur = [];
  for (const em of ems) {
    if (cur.length >= maxEmitters && !linked.has(em.name)) { groups.push(cur); cur = []; }
    cur.push(em);
  }
  if (cur.length) groups.push(cur);
  return groups.map((g, i) => ({ ...effect, name: i ? `${effect.name}_${i + 1}` : effect.name, emitters: g,
    ...(groups.length > 1 ? { _chunkNote: `çok emitter (${ems.length}) → ${groups.length} sisteme bölündü (${i + 1}/${groups.length}); oyunda birlikte doğar` } : {}) }));
}

export async function sendVfxToUnreal(effects, { mcpUrl, contentPath = '/Game/UPE/VFX', texturesDir, materialsDir, shadersDir, meshesDir = DEFAULT_MESHES_DIR, log, part, maxEmitters = Number(process.env.UPE_UE_MAX_EMITTERS) || 20 } = {}) {
  const ctx = new Ctx(mcpUrl, log);
  const L = (m) => { try { ctx.log(m); } catch {} };
  const errors = {}; const systems = [];
  contentPath = String(contentPath || '/Game/UPE/VFX').replace(/\/+$/, '');
  texturesDir = texturesDir || DEFAULT_TEXTURES_DIR;
  try { await getClient(mcpUrl || DEFAULT_MCP_URL); }
  catch (e) { for (const fx of effects || []) errors[fx?.name || 'vfx'] = e.message; return { ok: false, systems, errors }; }
  const texCache = new Map(), miCache = new Map();
  const matLib = createMaterialLibrary({ materialsDir, shadersDir });
  const matTexDir = path.join(materialsDir || DEFAULT_MATERIALS_DIR, 'textures');
  const baseCache = new Map(), ueMiCache = new Map(); // ana materyal (shader) ve örnek (materyal+tür) bir gönderimde bir kez
  // UPE materyali → UE ana materyal + örnek; derleme hatası (Custom HLSL) bölüm/satırla efekt hatası olur
  const prepareUEMaterial = async (um, warn, toSave) => {
    const key = um.key || `${um.name}|${um.kind}`;
    if (ueMiCache.has(key)) { const c = ueMiCache.get(key); if (c.error) throw c.error; for (const w of c.warnings) warn(w); return c.path; }
    let mp;
    try { mp = planEmitterMaterial(matLib, um.name, um.kind === 'decal' ? 'sprite' : um.kind, { distortion: um.distortion, mesh: um.mesh, soft: um.soft, decal: um.kind === 'decal' }); }
    catch (e) { const err = new Error(`materyal ${um.name}: ${e.message}`); ueMiCache.set(key, { error: err }); throw err; }
    try {
      if (!baseCache.has(mp.base.name)) {
        L(`[unreal] materyal: ${mp.base.name} (shader ${mp.shader})`);
        baseCache.set(mp.base.name, ensureUEBaseMaterial(ctx, mp, mp.shader).catch((e) => ({ error: e })));
      }
      const b = await baseCache.get(mp.base.name);
      if (b.error) throw b.error;
      if (b.rebuilt) toSave.add(pkgPath(b.path));
      else if (um.mesh) await ctx.call(OT, 'set_properties', { instance: { refPath: b.path }, values: JSON.stringify({ bUsedWithNiagaraMeshParticles: true }) }).then(() => toSave.add(pkgPath(b.path))).catch(() => {});
      const ws = [];
      const mi = await ensureUEMaterialInstance(ctx, mp, { warn: (m) => ws.push(m),
        importTexture: (tex, o) => importTexture(ctx, { folder: o.folder, name: o.asset, file: path.join(matTexDir, `${tex}.png`),
          props: { SRGB: !o.linear, LODGroup: 'TEXTUREGROUP_Effects', ...(o.linear ? { CompressionSettings: 'TC_Masks' } : {}) }, warn: (m) => ws.push(m) }) });
      toSave.add(pkgPath(mi.path)); for (const t of mi.textures) toSave.add(pkgPath(t));
      const warnings = [...mp.warnings, ...ws];
      ueMiCache.set(key, { path: mi.path, warnings });
      for (const w of warnings) warn(w);
      return mi.path;
    } catch (e) {
      const err = new Error(`materyal ${um.name}: ${e.message}`); ueMiCache.set(key, { error: err }); throw err;
    }
  };
  // part: 'iz' yalnız izleyen (_iz) sistemleri, 'ana' yalnız ana sistemleri gönderir (büyük efektlerde ayrı ayrı göndermek için)
  const parts = (effects || []).flatMap((e) => (e ? splitFollowEffects(e) : [e])).filter((e) => !part || !e || (part === 'iz') === !!e._followNote)
    .flatMap((e) => (e ? chunkEffect(e, maxEmitters) : [e]));
  for (const fx of parts) {
    const key = fx?.name || 'vfx';
    const plan = effectToNiagaraPlan(fx);
    const warnings = [...plan.warnings]; const warn = (m) => warnings.push(m);
    if (fx?._followNote) warn(fx._followNote);
    if (fx?._chunkNote) warn(fx._chunkNote);
    const sysPkg = `${contentPath}/${plan.systemName}`, sysPath = objPath(sysPkg);
    const toSave = new Set([sysPkg]);
    try {
      L(`[unreal] ${key}: dokular/materyaller`);
      const matByInst = new Map();
      for (const mat of plan.materials) {
        if (!texCache.has(mat.texture)) { const t = await ensureTexture(ctx, mat.texture, contentPath, texturesDir, warn); texCache.set(mat.texture, t); if (t.created) toSave.add(pkgPath(t.path)); }
        const tex = texCache.get(mat.texture);
        if (!miCache.has(mat.instance)) { const mi = await ensureMaterialInstance(ctx, mat, tex.path); miCache.set(mat.instance, mi); toSave.add(pkgPath(mi.path)); for (const c of mi.created) toSave.add(pkgPath(c)); }
        matByInst.set(mat.instance, miCache.get(mat.instance).path);
      }
      const ueMatPath = new Map();
      for (const um of plan.ueMaterials) ueMatPath.set(um.key, await prepareUEMaterial(um, warn, toSave));
      const meshPath = new Map();
      for (const mp of plan.meshes) { const r = await ensureMesh(ctx, mp, { contentPath, meshesDir, warn }); meshPath.set(mp.asset, r.path); if (r.created) toSave.add(pkgPath(r.path)); }
      // sistem: varsa yerinde temizle (yol + başvurular korunur), yoksa şablondan oluştur ve şablon emitter'larını sil
      L(`[unreal] ${key}: sistem ${sysPkg}`);
      if (!(await ctx.exists(sysPkg))) await ctx.call(NS, 'CreateNiagaraSystem', { assetName: plan.systemName, assetPath: contentPath, templateSystem: { refPath: TEMPLATE_SYSTEM } });
      const sum = (await ctx.call(NS, 'GetSystemSummary', { system: { refPath: sysPath } })).returnValue;
      for (const e of sum.emitters || []) await ctx.call(NS, 'RemoveEmitter', { emitterToRemove: sref(sysPath, { em: e.emitterName }) });
      await ctx.call(NS, 'SetSystemData', { system: { refPath: sysPath }, systemData: { propertyValues: JSON.stringify({ WarmupTime: plan.system.WarmupTime || 0 }) } })
        .catch((e) => warn(`sistem özellikleri: ${e.message.slice(0, 200)}`));
      const builtNames = new Map(); // plan adı → editördeki emitter adı
      for (const ep of plan.emitters) {
        L(`[unreal] ${key}: emitter ${ep.name}`);
        const mpath = ep.kind === 'light' ? null : ep.ueMaterial ? ueMatPath.get(ep.ueMaterial.key) : matByInst.get(ep.material.instance);
        const { issues, emName } = await buildEmitter(ctx, sysPath, ep, mpath, ep.mesh ? meshPath.get(ep.mesh.asset) : null);
        builtNames.set(ep.name, emName);
        for (const i of issues) warn(`${ep.source}: ${i}`);
      }
      for (const ep of plan.emitters.filter((e) => e.eventHandlers?.length)) {
        L(`[unreal] ${key}: olay işleyicisi ${ep.name}`);
        const issues = []; await setupEventHandlers(ctx, sysPath, ep, builtNames.get(ep.name) || ep.name, builtNames, issues);
        for (const i of issues) warn(`${ep.source}: ${i}`);
      }
      let cs = await waitCompile(ctx, sysPath);
      if (!cs.errors.length && await refreshRendererBindings(ctx, sysPath, plan, builtNames, warn)) cs = await waitCompile(ctx, sysPath);
      await ctx.call(AT, 'save_assets', { asset_paths: [...toSave] });
      if (cs.errors.length) throw new Error(`derleme hatası: ${cs.errors.join(' || ')}`);
      try {
        const iss = (await ctx.call(NS, 'GetStackIssues', { system: { refPath: sysPath } })).returnValue;
        for (const i of iss.issues || []) if (i.severity === 'Error' || i.severity === 'Warning') warn(`stack ${i.severity}: ${i.stackDisplayPath || ''} ${i.shortDescription}`);
      } catch {}
      systems.push({ name: key, path: sysPath, emitters: plan.emitters.map((e) => e.name), warnings, compile: cs.status });
      L(`[unreal] ${key}: tamam (${cs.status})`);
    } catch (e) {
      errors[key] = e.message;
      L(`[unreal] ${key}: HATA ${e.message}`);
    }
  }
  return { ok: Object.keys(errors).length === 0, systems, errors };
}
