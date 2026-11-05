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
import { callTool, callTop, getClient, DEFAULT_MCP_URL } from './unreal-mcp-client.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TEXTURES_DIR = path.resolve(HERE, '../vfx/textures');
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
};
export const TY = {
  float: '/Script/Niagara.NiagaraFloat', int: '/Script/Niagara.NiagaraInt32', bool: '/Script/Niagara.NiagaraBool',
  vec2: '/Script/CoreUObject.Vector2f', vec3: '/Script/CoreUObject.Vector3f', vec4: '/Script/CoreUObject.Vector4f',
  color: '/Script/CoreUObject.LinearColor', position: '/Script/Niagara.NiagaraPosition',
};
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
  const plan = { name, source: effect?.name, systemName: `NS_${name}`, metadata: {}, system: {}, textures: [], materials: [], emitters: [], warnings };
  if (!effect || !Array.isArray(effect.emitters)) { warnings.push('efekt geçersiz (emitters yok)'); return plan; }
  plan.metadata = { duration: effect.duration, loop: effect.loop, attach: effect.attach };
  if (effect.attach?.target && effect.attach.target !== 'none') {
    plan.metadata.attachUE = { target: effect.attach.target, name: effect.attach.name, locationCm: toUE(effect.attach.position).map((v) => +v.toFixed(3)), rotationUnityEuler: effect.attach.rotation };
    warnings.push(`attach: ${effect.attach.target} "${effect.attach.name}" — UE'de bağlama oyunda yapılır (SpawnSystemAttached; göreli konum ${JSON.stringify(plan.metadata.attachUE.locationCm)} cm, dönüş Unity Euler ${JSON.stringify(effect.attach.rotation)}); sistem varlığına gömülmedi`);
  }
  const used = new Set();
  const prewarm = [];
  for (const em of effect.emitters) {
    let en = safeName(em.name, 'emitter'); const base = en; let k = 2; while (used.has(en)) en = `${base}_${k++}`; used.add(en);
    if (!em.enabled) { warnings.push(`${em.name}: kapalı emitter atlandı`); continue; }
    const out = emitterPlan(em, en, effect, warnings);
    if (em.main.prewarm && em.main.looping && !em.bladeTrail?.enabled) prewarm.push(em.main.duration);
    plan.emitters.push(out);
    if (!plan.textures.includes(out.texture)) plan.textures.push(out.texture);
    if (!plan.materials.some((m) => m.instance === out.material.instance)) plan.materials.push(out.material);
  }
  if (prewarm.length) {
    plan.system.WarmupTime = Math.max(...prewarm);
    if (prewarm.length !== plan.emitters.length) warnings.push(`prewarm: Niagara'da sistem düzeyinde (WarmupTime ${f(plan.system.WarmupTime)} sn); prewarm'sız emitter'lar da ısınır`);
  }
  if (!plan.emitters.length) warnings.push('açık emitter yok');
  return plan;
}

function emitterPlan(em, ueName, effect, warnings) {
  const w = (m) => warnings.push(`${em.name}: ${m}`);
  const m = em.main, r = em.renderer, trail = !!em.bladeTrail?.enabled;
  const world = trail || m.simulationSpace === 'world';
  const steps = [];
  const out = { name: ueName, source: em.name, kind: trail ? 'ribbon' : 'sprite', steps };

  // doku + materyal
  const tex = r.texture || 'soft';
  if (r.material) w(`renderer.material "${r.material}" (UPE-SL özel shader) Aşama 2'de; şimdilik doku "${tex}" + ${r.blend} yerleşik materyal (intensity 1)`);
  out.texture = tex;
  const blend = r.blend === 'alpha' ? 'Alpha' : 'Additive';
  out.material = { texture: tex, blend, instance: `MI_UPE_${safeName(tex, 'tex')}_${blend}` };

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
    if (em.emission.rateOverTime <= 0 && !nb) w('yayım yok (rate 0, süre içinde burst yok): parçacık doğmaz');
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
    const wv = sizeCurve || '1.0';
    const g = grad('Particles.NormalizedAge');
    // vfx-sim TrailSim: kök uca doğru daralır (kök' = uç + (kök-uç)·w); şerit merkezi + genişlik
    steps.push({ op: 'params', script: 'ParticleUpdateScript', alias: 'UPE_TrailLook', params: [
      P_('Particles.Position', TY.position, `lerp(Particles.UPE_Tip, Particles.UPE_Root, 0.5 * ${wv})`),
      P_('Particles.RibbonWidth', TY.float, `${f(len)} * ${wv}`),
      P_('Particles.UPE_CS', TY.vec4, g ? `Particles.UPE_Col0 * ${g}` : 'Particles.UPE_Col0'),
    ] });
    steps.push(colorStep());
    out.renderer = { class: 'NiagaraRibbonRendererProperties', props: { FacingMode: 'CustomSideVector', SortOrderHint: r.sortingOrder, bCastShadows: false } };
    for (const k of ['velocity', 'force', 'limitVelocity', 'noise', 'rotationOverLifetime', 'textureSheet']) if (em[k]?.enabled) w(`bladeTrail: ${k} izde yok sayılır`);
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
  steps.push({ op: 'params', script: 'ParticleSpawnScript', alias: 'UPE_Spawn', params: [
    P_('Particles.Position', TY.position, toSim(localPos, true)),
    P_('Particles.Velocity', TY.vec3, zeroSpeed ? ZERO3 : toSim(`${mulExpr(Mdir, dirU)} * ${speed}`, false)),
  ] });

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
  if (r.mode === 'stretched') look.push(P_('Particles.SpriteSize', TY.vec2, `float2(${wExpr}, ${wExpr} * ${f(r.lengthScale)} + length(Particles.Velocity) * ${f(r.velocityScale)})`));
  else look.push(P_('Particles.SpriteSize', TY.vec2, `float2(${wExpr}, ${wExpr})`));
  look.push(P_('Particles.SpriteRotation', TY.float, hasAngV ? 'Particles.UPE_Rot0 + Particles.UPE_AngV * Particles.Age' : 'Particles.UPE_Rot0'));
  if (ts.enabled && tiles > 1) {
    const fr = `floor(frac(Particles.NormalizedAge * ${f(ts.cycles)}) * ${f(tiles)})`;
    look.push(P_('Particles.SubImageIndex', TY.float, hasFrame0 ? `fmod(${fr} + Particles.UPE_Frame0, ${f(tiles)})` : fr));
  }
  const rp = { SortOrderHint: r.sortingOrder, bCastShadows: false, SortMode: r.blend === 'alpha' ? 'ViewDistance' : 'None' };
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
  return out;
}

// ───────────────────────────── yürütme
const sref = (sys, o = {}) => ({ system: { refPath: sys }, emitterName: o.em || '', scriptName: o.script || '', moduleName: o.mod || '', rendererIndex: o.ri ?? -1, inputNameStack: o.inputs || [] });
const objPath = (p) => (p.split('/').pop().includes('.') ? p : `${p}.${p.split('/').pop()}`);
const pkgPath = (p) => p.replace(/\.[^/]*$/, '');

class Ctx {
  constructor(mcpUrl, log) { this.opts = { mcpUrl }; this.log = log || (() => {}); this.enums = new Map(); }
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
    s = (await ctx.call(NS, 'GetSystemCompileState', { system: { refPath: sysPath } })).returnValue;
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

// Ortak materyal (yoksa kur): Unlit, iki yüzlü, Niagara sprite/ribbon; Particle Color × Tex
async function ensureBaseMaterial(ctx, blend) {
  const name = `M_UPE_Particle_${blend}`, p = `${MATERIALS_PATH}/${name}`;
  if (await ctx.exists(p)) return { path: objPath(p), created: false };
  const m = (await ctx.call(MT, 'create_material', { folder_path: MATERIALS_PATH, asset_name: name })).returnValue;
  await ctx.call(OT, 'set_properties', { instance: m, values: JSON.stringify({ BlendMode: blend === 'Alpha' ? 'BLEND_Translucent' : 'BLEND_Additive', ShadingModel: 'MSM_Unlit', TwoSided: true, bUsedWithNiagaraSprites: true, bUsedWithNiagaraRibbons: true }) });
  const add = async (c, x, y) => (await ctx.call(MT, 'add_expression', { material_or_function: m, expression_class: { refPath: '/Script/Engine.' + c }, x, y })).returnValue;
  const conn = (a, ao, b, bi) => ctx.call(MT, 'connect_expressions', { from_expression: a, from_output_name: ao, to_expression: b, to_input_name: bi });
  const pc = await add('MaterialExpressionParticleColor', -700, -100);
  const tx = await add('MaterialExpressionTextureSampleParameter2D', -700, 150);
  await ctx.call(OT, 'set_properties', { instance: tx, values: JSON.stringify({ ParameterName: 'Tex' }) });
  await ctx.call(OT, 'set_properties', { instance: tx, values: JSON.stringify({ Texture: { refPath: '/Engine/EngineResources/WhiteSquareTexture.WhiteSquareTexture' } }) }).catch(() => {});
  const rgb = await add('MaterialExpressionMultiply', -400, -100), a = await add('MaterialExpressionMultiply', -400, 150);
  await conn(pc, 'RGB', rgb, 'A'); await conn(tx, 'RGB', rgb, 'B'); await conn(pc, 'A', a, 'A'); await conn(tx, 'A', a, 'B');
  if (blend === 'Alpha') {
    await ctx.call(MT, 'connect_to_output', { expression: rgb, output_name: '', material_property: 'MP_EmissiveColor' });
    await ctx.call(MT, 'connect_to_output', { expression: a, output_name: '', material_property: 'MP_Opacity' });
  } else { // Unity additive (SrcAlpha, One): renk × alfa
    const e = await add('MaterialExpressionMultiply', -150, 0);
    await conn(rgb, '', e, 'A'); await conn(a, '', e, 'B');
    await ctx.call(MT, 'connect_to_output', { expression: e, output_name: '', material_property: 'MP_EmissiveColor' });
  }
  await ctx.call(MT, 'layout_expressions', { material_or_function: m }).catch(() => {});
  await ctx.call(MT, 'recompile', { material_or_function: m });
  return { path: objPath(p), created: true };
}

async function ensureTexture(ctx, tex, contentPath, texturesDir, warn) {
  const folder = `${contentPath}/Textures`, name = `T_UPE_${safeName(tex, 'tex')}`, p = `${folder}/${name}`;
  if (await ctx.exists(p)) return { path: objPath(p), created: false };
  let file = path.join(texturesDir, `${tex}.png`);
  if (!fs.existsSync(file)) { warn(`doku dosyası yok: ${file} → soft`); file = path.join(texturesDir, 'soft.png'); }
  if (!fs.existsSync(file)) throw new Error(`doku dosyası yok: ${file}`);
  await ctx.call(TT, 'import_file', { folder_path: folder, asset_name: name, source_file: path.resolve(file).replace(/\\/g, '/') });
  await ctx.call(OT, 'set_properties', { instance: { refPath: objPath(p) }, values: JSON.stringify({ AddressX: 'TA_Clamp', AddressY: 'TA_Clamp', LODGroup: 'TEXTUREGROUP_Effects' }) })
    .catch((e) => warn(`doku ayarı (${name}): ${e.message.slice(0, 150)}`));
  return { path: objPath(p), created: true };
}

async function ensureMaterialInstance(ctx, mat, texPath) {
  const p = `${MATERIALS_PATH}/${mat.instance}`;
  const base = await ensureBaseMaterial(ctx, mat.blend);
  const created = base.created ? [base.path] : [];
  if (!(await ctx.exists(p))) {
    await ctx.call(MIT, 'create', { folder_path: MATERIALS_PATH, asset_name: mat.instance, parent: { refPath: base.path } });
    created.push(objPath(p));
  }
  await ctx.call(MIT, 'set_texture_parameter', { instance: { refPath: objPath(p) }, name: 'Tex', value: { refPath: texPath } });
  return { path: objPath(p), created };
}

async function buildEmitter(ctx, sysPath, ep, matPath) {
  const r = await ctx.call(NS, 'AddEmitter', { system: { refPath: sysPath }, templateEmitter: { refPath: TEMPLATE_EMITTER }, emitterName: ep.name });
  const emName = r.returnValue?.emitterName || ep.name;
  const issues = [];
  await ctx.call(NS, 'SetEmitterData', { emitter: sref(sysPath, { em: emName }), emitterData: { propertyValues: JSON.stringify(ep.data) } })
    .catch((e) => issues.push(`emitter özellikleri: ${e.message.slice(0, 300)}`));
  for (const st of ep.steps) {
    let mod = st.module;
    if (st.op === 'params') {
      const res = await ctx.call(NS, 'AddSetParametersModule', { moduleLocationRef: sref(sysPath, { em: emName, script: st.script }),
        parameters: st.params.map((p) => ({ variable: { name: p.name, type: { classStructOrEnum: { refPath: p.type } } } })) });
      mod = res.returnValue.moduleName;
      for (const p of st.params) {
        await ctx.call(NS, 'SetStackInputData', { stackInputRef: sref(sysPath, { em: emName, script: st.script, mod, inputs: [p.name] }), inputData: await ctx.inputData({ kind: 'hlsl', value: p.hlsl }) });
      }
      continue;
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
  }
  // renderer (şablonda sprite; ribbon için değiştir)
  let ri = 0;
  if (ep.renderer.class !== 'NiagaraSpriteRendererProperties') {
    await ctx.call(NS, 'RemoveRenderer', { rendererToRemove: sref(sysPath, { em: emName, ri: 0 }) });
    const ar = await ctx.call(NS, 'AddRenderer', { newRendererLocation: sref(sysPath, { em: emName }), rendererClass: { refPath: `/Script/Niagara.${ep.renderer.class}` } });
    ri = ar.returnValue?.rendererIndex ?? ar.returnValue?.index ?? 0;
  }
  const props = { ...ep.renderer.props, Material: { refPath: matPath } };
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
export async function sendVfxToUnreal(effects, { mcpUrl, contentPath = '/Game/UPE/VFX', texturesDir, log } = {}) {
  const ctx = new Ctx(mcpUrl, log);
  const L = (m) => { try { ctx.log(m); } catch {} };
  const errors = {}; const systems = [];
  contentPath = String(contentPath || '/Game/UPE/VFX').replace(/\/+$/, '');
  texturesDir = texturesDir || DEFAULT_TEXTURES_DIR;
  try { await getClient(mcpUrl || DEFAULT_MCP_URL); }
  catch (e) { for (const fx of effects || []) errors[fx?.name || 'vfx'] = e.message; return { ok: false, systems, errors }; }
  const texCache = new Map(), miCache = new Map();
  for (const fx of effects || []) {
    const key = fx?.name || 'vfx';
    const plan = effectToNiagaraPlan(fx);
    const warnings = [...plan.warnings]; const warn = (m) => warnings.push(m);
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
      // sistem: varsa yerinde temizle (yol + başvurular korunur), yoksa şablondan oluştur ve şablon emitter'larını sil
      L(`[unreal] ${key}: sistem ${sysPkg}`);
      if (!(await ctx.exists(sysPkg))) await ctx.call(NS, 'CreateNiagaraSystem', { assetName: plan.systemName, assetPath: contentPath, templateSystem: { refPath: TEMPLATE_SYSTEM } });
      const sum = (await ctx.call(NS, 'GetSystemSummary', { system: { refPath: sysPath } })).returnValue;
      for (const e of sum.emitters || []) await ctx.call(NS, 'RemoveEmitter', { emitterToRemove: sref(sysPath, { em: e.emitterName }) });
      await ctx.call(NS, 'SetSystemData', { system: { refPath: sysPath }, systemData: { propertyValues: JSON.stringify({ WarmupTime: plan.system.WarmupTime || 0 }) } })
        .catch((e) => warn(`sistem özellikleri: ${e.message.slice(0, 200)}`));
      for (const ep of plan.emitters) {
        L(`[unreal] ${key}: emitter ${ep.name}`);
        const { issues } = await buildEmitter(ctx, sysPath, ep, matByInst.get(ep.material.instance));
        for (const i of issues) warn(`${ep.source}: ${i}`);
      }
      const cs = await waitCompile(ctx, sysPath);
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
