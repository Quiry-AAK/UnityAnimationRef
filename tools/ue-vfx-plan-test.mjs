// Editörsüz test: node tools/ue-vfx-plan-test.mjs — tüm vfx/*.json efektleri ve şablonlar plana hatasız dönmeli
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { normalizeEffect, presetEmitter, PRESETS, defaultEffect, evalCurve } from '../public/vfx-schema.js';
import { createMaterialLibrary, translateShaderForUE, checkTranslation, planEmitterMaterial, convertSampling, parseCompileErrors, colorToLinear, baseMaterialName, renderStateFor } from '../lib/ue-material.js';
import { effectToNiagaraPlan, toUE, toUEDir, unityEulerMatrix, toUEMatrix, matVec, curveExpr, f, safeName } from '../lib/unreal-vfx.js';

let fails = 0, n = 0;
const test = (name, fn) => { n++; try { fn(); } catch (e) { fails++; console.error('BAŞARISIZ', name, '\n  ', e.message); } };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const closeV = (a, b, eps = 1e-6) => a.forEach((v, i) => close(v, b[i], eps));

// ── birim/eksen
test('konum: Unity (1,2,3) m → UE (300,100,200) cm', () => assert.deepEqual(toUE([1, 2, 3]), [300, 100, 200]));
test('yön: Unity +Y yukarı → UE +Z', () => assert.deepEqual(toUEDir([0, 1, 0]), [0, 0, 1]));
test('yön: Unity +Z ileri → UE +X', () => assert.deepEqual(toUEDir([0, 0, 1]), [1, 0, 0]));
test('Euler: Unity X -90° koninin +Z eksenini +Y yapar', () => closeV(matVec(unityEulerMatrix([-90, 0, 0]), [0, 0, 1]), [0, 1, 0]));
test('Euler: Unity Y 90° +Z → +X', () => closeV(matVec(unityEulerMatrix([0, 90, 0]), [0, 0, 1]), [1, 0, 0]));
test('Euler sırası Z→X→Y (Y·X·Z)', () => {
  const v = matVec(unityEulerMatrix([30, 40, 50]), [1, 0, 0]);
  const rz = matVec(unityEulerMatrix([0, 0, 50]), [1, 0, 0]), rx = matVec(unityEulerMatrix([30, 0, 0]), rz), ry = matVec(unityEulerMatrix([0, 40, 0]), rx);
  closeV(v, ry);
});
test('UE matrisi: Unity dönüşü UE uzayında aynı vektörü verir', () => {
  const M = unityEulerMatrix([20, -35, 70]), u = [0.3, -0.7, 0.4];
  closeV(matVec(toUEMatrix(M), toUEDir(u)), toUEDir(matVec(M, u)));
});
test('HLSL sayı biçimi', () => { assert.equal(f(1), '1.0'); assert.equal(f(-0), '0.0'); assert.equal(f(0.25), '0.25'); assert.equal(f(-981), '-981.0'); });
test('ad: Türkçe harf çevirisi', () => assert.equal(safeName('kıvılcım çekirdek'), 'kivilcim_cekirdek'));

// ── eğri ifadesi evalCurve ile aynı değeri verir (skaler HLSL'i JS'de değerlendir)
const evalH = (expr, t) => Function('lerp', 'saturate', 'T', `return ${expr};`)((a, b, x) => a + (b - a) * x, (x) => Math.min(1, Math.max(0, x)), t);
test('curveExpr = evalCurve (4 anahtar)', () => {
  const k = [[0, 0.6], [0.3, 1], [0.7, 0.4], [1, 0.2]];
  const e = curveExpr(k, 'T');
  for (const t of [-0.1, 0, 0.1, 0.3, 0.5, 0.7, 0.9, 1, 1.2]) close(evalH(e, t), evalCurve(k, t), 1e-5);
});
test('curveExpr = evalCurve (2 anahtar, eşit t)', () => {
  const k = [[0, 0], [0.5, 1], [0.5, 0.2], [1, 0]];
  const e = curveExpr(k, 'T');
  for (const t of [0, 0.25, 0.75, 1]) close(evalH(e, t), evalCurve(k, t), 1e-5);
});
test('curveExpr sabit eğri sadeleşir', () => assert.equal(curveExpr([[0, 1], [1, 1]], 'T'), '1.0'));

// ── plan: belirli sayılar
const fx = (em, extra = {}) => normalizeEffect({ ...defaultEffect(), name: 'test', ...extra, emitters: [em] }).effect;
test('yerçekimi 1 → GravityForce (0,0,-981)', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('sparks')));
  const g = p.emitters[0].steps.find((s) => s.asset?.includes('GravityForce'));
  assert.deepEqual(g.inputs[0].value.value, [0, 0, -981]);
});
test('kuvvet Unity (1,2,3) → AccelerationForce (300,100,200)', () => {
  const p = effectToNiagaraPlan(fx({ ...presetEmitter('fire'), force: { enabled: true, force: [1, 2, 3], space: 'world' } }));
  const a = p.emitters[0].steps.find((s) => s.asset?.includes('AccelerationForce'));
  assert.deepEqual(a.inputs[0].value.value, [300, 100, 200]);
});
test('emitter konumu (0,1,0.5) m → spawn konumu (50,0,100) cm', () => {
  const p = effectToNiagaraPlan(fx({ ...presetEmitter('flash'), position: [0, 1, 0.5] }));
  const s = p.emitters[0].steps.find((x) => x.alias === 'UPE_Spawn');
  assert.equal(s.params[0].hlsl, 'float3(50.0, 0.0, 100.0)');
});
test('koni varsayılan dönüşü (-90,0,0): doğum yönü UE +Z', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('fire', { shape: { radius: 0, angle: 0 } })));
  const v = p.emitters[0].steps.find((x) => x.alias === 'UPE_Spawn').params[1].hlsl;
  assert.ok(/^float3\(\(?.*\)\.y, .*\) \* lerp/.test(v) || v.includes('.y'), v.slice(0, 200));
  // Mdir: UE X ← Unity Z(…); dönüş -90° X: Unity +Z → +Y → UE +Z, yani UE z bileşeni SDir.z'den gelir
  assert.ok(/float3\([^,]*\(Particles\.UPE_SDir\)\.y[^,]*, [^,]*\(Particles\.UPE_SDir\)\.x[^,]*, [^,]*\(Particles\.UPE_SDir\)\.z/.test(v), v.slice(0, 200));
});
test('boyut 0.2 m → 20 cm', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('flash', { main: { startSize: [0.2, 0.2] } })));
  assert.equal(p.emitters[0].steps.find((x) => x.alias === 'UPE_Init').params.find((q) => q.name === 'Particles.UPE_Size0').hlsl, '0.2 * 100.0');
});
test('burst döngüleri: 3 cycle → 3 SpawnBurst, zamanlar 0.1/0.3/0.5', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('sparks', { main: { duration: 1 }, emission: { rateOverTime: 0, bursts: [{ time: 0.1, count: [5, 5], cycles: 3, interval: 0.2 }] } })));
  const b = p.emitters[0].steps.filter((s) => s.asset?.includes('SpawnBurst'));
  assert.equal(b.length, 3); closeV(b.map((x) => x.inputs[1].value.value), [0.1, 0.3, 0.5]);
});
test('simulationSpace local/world → bLocalSpace', () => {
  assert.equal(effectToNiagaraPlan(fx(presetEmitter('fire'))).emitters[0].data.bLocalSpace, true);
  assert.equal(effectToNiagaraPlan(fx(presetEmitter('fire', { main: { simulationSpace: 'world' } }))).emitters[0].data.bLocalSpace, false);
});
test('blend + doku → MI adı', () => assert.equal(effectToNiagaraPlan(fx(presetEmitter('smoke'))).materials[0].instance, 'MI_UPE_smoke_Alpha'));
test('renderer modları', () => {
  const m = (mode, al) => effectToNiagaraPlan(fx(presetEmitter('glow', { renderer: { mode, alignment: al || 'view' } }))).emitters[0].renderer.props;
  assert.equal(m('stretched').Alignment, 'VelocityAligned');
  assert.equal(m('horizontal').FacingMode, 'CustomFacingVector');
  assert.equal(m('vertical').FacingMode, 'FaceCameraPosition');
  assert.equal(m('billboard', 'local').Alignment, 'CustomAlignment');
});
test('bladeTrail → ribbon', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('slash', { bladeTrail: { enabled: true, from: [0, 0, 0], to: [0, 0, 1], lifetime: 0.3 } })));
  assert.equal(p.emitters[0].kind, 'ribbon'); assert.equal(p.emitters[0].renderer.class, 'NiagaraRibbonRendererProperties');
});
test('attach uyarısı + UE göreli konumu', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('glow'), { attach: { target: 'prop', name: 'katana', position: [0, 0, 0.46], rotation: [0, 0, 0] } }));
  assert.ok(p.warnings.some((w) => w.startsWith('attach'))); assert.deepEqual(p.metadata.attachUE.locationCm, [46, 0, 0]);
});

// ── tüm kütüphane + tüm şablonlar + tüm şekil tipleri
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vfx');
const files = fs.readdirSync(dir).filter((x) => x.endsWith('.json'));
const balanced = (s) => { let d = 0; for (const c of s) { if (c === '(') d++; else if (c === ')') d--; if (d < 0) return false; } return d === 0; };
let emitters = 0, steps = 0; const warnKinds = new Map();
const checkPlan = (p, label) => {
  for (const e of p.emitters) {
    emitters++;
    assert.ok(/^[A-Za-z0-9_]+$/.test(e.name), `${label}: emitter adı ${e.name}`);
    for (const s of e.steps) {
      steps++;
      for (const q of s.params || []) {
        assert.ok(balanced(q.hlsl), `${label}/${e.name}/${q.name}: parantez dengesiz`);
        assert.ok(!/NaN|undefined|Infinity|null/.test(q.hlsl), `${label}/${e.name}/${q.name}: ${q.hlsl.slice(0, 120)}`);
      }
      for (const i of s.inputs || []) if (i.value.kind === 'hlsl') assert.ok(balanced(i.value.value) && !/NaN|undefined/.test(i.value.value), `${label}: ${i.name}`);
    }
  }
  for (const w of p.warnings) { const k = w.replace(/^[^:]*: /, '').replace(/".*?"|\[.*?\]|\d+(\.\d+)?/g, '#').slice(0, 70); warnKinds.set(k, (warnKinds.get(k) || 0) + 1); }
};
for (const file of files) test(`kütüphane ${file}`, () => {
  const { effect } = normalizeEffect(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  const p = effectToNiagaraPlan(effect);
  assert.ok(p.emitters.length || effect.emitters.every((e) => !e.enabled), `${file}: emitter yok`);
  checkPlan(p, file);
});
for (const k of Object.keys(PRESETS)) test(`şablon ${k}`, () => checkPlan(effectToNiagaraPlan(fx(presetEmitter(k))), k));
test('tüm şekil tipleri + tüm modüller', () => {
  for (const type of ['cone', 'sphere', 'hemisphere', 'box', 'circle', 'edge', 'donut']) for (const radius of [0, 0.3]) for (const simulationSpace of ['local', 'world']) {
    checkPlan(effectToNiagaraPlan(fx(presetEmitter('fire', { main: { simulationSpace, prewarm: true, startDelay: 0.2 }, shape: { type, radius, randomDirection: 0.3 },
      velocity: { enabled: true, linear: [0, 1, 0], orbital: [0, 2, 0], radial: 1, space: 'local', speedModifier: 1.5 }, force: { enabled: true, force: [0, 1, 0], space: 'world' },
      limitVelocity: { enabled: true, drag: 2, limit: 3, dampen: 0.5 }, noise: { enabled: true, octaves: 3 },
      textureSheet: { enabled: true, tilesX: 4, tilesY: 4, cycles: 2, randomStart: true }, renderer: { mode: 'stretched' } }))), `${type}/${radius}/${simulationSpace}`);
  }
});

// ── Aşama 2: UPE-SL → UE Custom HLSL (editörsüz; gerçek derleme editörde)
const lib = createMaterialLibrary();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shaderFiles = fs.readdirSync(path.join(root, 'shaders')).filter((x) => x.endsWith('.json'));
let nTr = 0;
for (const sh of [...lib.builtins, ...shaderFiles.map((f) => lib.shader(f.slice(0, -5)))]) test(`UE çeviri ${sh.name}`, () => {
  assert.ok(sh, 'shader çözülemedi');
  const variants = sh.urpSurface ? [{ _Surface: 0 }, { _Surface: 1, _Blend: 0 }, { _Surface: 1, _Blend: 1 }, { _Surface: 1, _Blend: 2, _Cull: 0 }, { _Surface: 1, _Blend: 3, _AlphaClip: true }] : [undefined];
  for (const values of variants) {
    const tr = translateShaderForUE(sh, { values }); nTr++;
    const errs = checkTranslation(tr);
    assert.deepEqual(errs, [], `${sh.name}: ${errs.join('; ')}`);
    assert.ok(/#line 1 "upe_fragment"/.test(tr.code) && /#line 1 "upe_common"/.test(tr.code), 'bölüm işaretleri');
    assert.ok(/^BLEND_/.test(tr.blendMode) && /^[0-9a-f]{12}$/.test(tr.hash));
    for (const p of sh.properties) assert.ok(tr.params.some((x) => x.name === p.name), `parametre yok: ${p.name}`);
    assert.ok(/^M_UPE_[A-Za-z0-9_]+$/.test(baseMaterialName(sh, renderStateFor(sh, values))));
  }
});
const matFiles = fs.readdirSync(path.join(root, 'materials')).filter((x) => x.endsWith('.json'));
for (const f of matFiles) test(`UE materyal planı ${f}`, () => {
  for (const kind of ['sprite', 'ribbon']) {
    const mp = planEmitterMaterial(lib, f.slice(0, -5), kind);
    assert.ok(/^MI_UPE_[A-Za-z0-9_]+$/.test(mp.instance.name) && mp.instance.path.startsWith('/Game/UPE/Materials/'));
    assert.ok(mp.base.path.startsWith('/Game/UPE/Shaders/M_UPE_'));
    assert.equal(mp.values.scalars.find((x) => x.name === 'UPE_Ribbon').value, kind === 'ribbon' ? 1 : 0);
    for (const v of mp.values.vectors) assert.ok(v.value.length === 4 && v.value.every(Number.isFinite), `${v.name}`);
  }
});
test('SAMPLE → Texture2DSample (iç içe, LOD, TRANSFORM_TEX)', () => {
  assert.equal(convertSampling('SAMPLE(_A, uv) + SAMPLE_LOD(_B, f(x, SAMPLE(_A, q).xy), 0.0)'),
    'Texture2DSample(_A, _ASampler, UPE_FlipV(uv)) + Texture2DSampleLevel(_B, _BSampler, UPE_FlipV(f(x, Texture2DSample(_A, _ASampler, UPE_FlipV(q)).xy)), 0.0)');
  const sh = lib.builtins.find((s) => s.name === 'urp_particles_unlit');
  const tr = translateShaderForUE(sh, { values: { _Surface: 1, _Blend: 2 } });
  assert.ok(tr.code.includes('Texture2DSample(_BaseMap, _BaseMapSampler, UPE_FlipV(((i.uv) * _BaseMap_ST.xy + _BaseMap_ST.zw)))'));
  assert.equal(tr.blendMode, 'BLEND_Additive'); assert.ok(tr.code.includes('return float4(upeC.rgb * upeC.a, upeC.a);'));
});
test('derleme hatası: bölüm + satır', () => {
  const e = parseCompileErrors(['C:/x/upe_fragment(2,183): Shader FDebugViewModePS', "	upe_fragment:2:183: error: use of undeclared identifier 'bogus'", "	upe_fragment:2:183: error: use of undeclared identifier 'bogus'", 'Internal Error!'].join(String.fromCharCode(10)));
  assert.equal(e.length, 1); assert.equal(e[0].section, 'fragment'); assert.equal(e[0].line, 2); assert.match(e[0].message, /bogus/);
});
test('renk: sRGB hex → doğrusal, alfa korunur', () => { const c = colorToLinear('#ff808040'); close(c[0], 1); close(c[1], 0.2158605, 1e-5); close(c[3], 0x40 / 255); });
test('materyalli emitter → ueMaterials (ribbon/sprite ayrı)', () => {
  const p = effectToNiagaraPlan(normalizeEffect(JSON.parse(fs.readFileSync(path.join(dir, 'vfx_heavy_4_iz.json'), 'utf8'))).effect);
  assert.ok(p.ueMaterials.some((m) => m.name === 'kilic_izi_agir' && m.kind === 'ribbon'));
  assert.ok(p.ueMaterials.some((m) => m.kind === 'sprite'));
  assert.ok(!p.warnings.some((w) => /Aşama 2/.test(w)));
});

console.log(`${n - fails}/${n} test geçti · ${files.length} efekt dosyası, ${emitters} emitter, ${steps} adım`);
console.log(`UE materyal çevirisi: ${nTr} shader varyantı, ${matFiles.length} materyal`);
console.log('uyarı türleri:'); for (const [k, v] of [...warnKinds].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`);
process.exitCode = fails ? 1 : 0;
