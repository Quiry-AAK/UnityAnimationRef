// Editörsüz test: node tools/ue-vfx-plan-test.mjs — tüm vfx/*.json efektleri ve şablonlar plana hatasız dönmeli
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { normalizeEffect, presetEmitter, PRESETS, defaultEffect, evalCurve } from '../public/vfx-schema.js';
import { createMaterialLibrary, translateShaderForUE, checkTranslation, planEmitterMaterial, convertSampling, parseCompileErrors, colorToLinear, baseMaterialName, renderStateFor } from '../lib/ue-material.js';
import { effectToNiagaraPlan, toUE, toUEDir, unityEulerMatrix, toUEMatrix, matVec, curveExpr, f, safeName, quatFromMatrix, quatRotate, DISTORT_HLSL, staleBindings, splitFollowEffects, chunkEffect } from '../lib/unreal-vfx.js';
import { proceduralMesh, meshToOBJ, fitArc } from '../public/vfx-mesh.js';

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

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vfx');
const files = fs.readdirSync(dir).filter((x) => x.endsWith('.json'));
const balanced = (s) => { let d = 0; for (const c of s) { if (c === '(') d++; else if (c === ')') d--; if (d < 0) return false; } return d === 0; };
const lib = createMaterialLibrary();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── BDO özellikleri: mesh, bükülme, ışık, ribbon, özel veri, alt emitter (docs/VFX.md, docs/UNREAL.md)
const findP = (p, name) => p.emitters.flatMap((e) => e.steps).flatMap((s) => s.params || []).find((q) => q.name === name);
test('mesh: yay geometrisi UV ve konum (açı 0 = +X, +Y yönüne)', () => {
  const g = proceduralMesh({ shape: 'arc', innerRadius: 0.5, outerRadius: 1, angle: 90, segments: 2, rings: 1 });
  assert.equal(g.positions.length / 3, 6); assert.equal(g.indices.length, 12);
  closeV([...g.positions.slice(0, 3)], [0.5, 0, 0]); closeV([...g.uvs.slice(0, 2)], [0, 0]);
  closeV([...g.positions.slice(15, 18)], [0, 1, 0]); closeV([...g.uvs.slice(10, 12)], [1, 1]); // son köşe: 90°, dış
});
test('mesh: OBJ Unity (1,0,0) m → UE y = −100 (içe aktarıcı Y aynası telafisi), cm', () => {
  const obj = meshToOBJ({ positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), normals: new Float32Array(9), uvs: new Float32Array(6), indices: new Uint32Array([0, 1, 2]) });
  const v = obj.split('\n').filter((l) => l.startsWith('v ')).map((l) => l.slice(2).split(' ').map(Number));
  closeV(v[0], [0, -100, 0]); closeV(v[1], [0, 0, 100]); closeV(v[2], [100, 0, 0]);
});
test('mesh: plan Mesh renderer + varlık + MeshOrientation', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('arc_slash', { rotation: [30, 20, 0] })));
  const e = p.emitters[0];
  assert.equal(e.kind, 'mesh'); assert.equal(e.renderer.class, 'NiagaraMeshRendererProperties');
  assert.equal(p.meshes.length, 1); assert.ok(/^SM_UPE_arc_[0-9a-f]{8}$/.test(p.meshes[0].asset)); assert.ok(p.meshes[0].obj.split('\nf ').length > 100);
  assert.ok(findP(p, 'Particles.MeshOrientation') && findP(p, 'Particles.Scale') && findP(p, 'Particles.DynamicMaterialParameter'));
  assert.ok(p.materials[0].mesh);
});
test('mesh yönü: qB ⊗ qz(−θ) = Unity Rem·Rz(−θ) (UE ekseninde)', () => {
  const Rem = unityEulerMatrix([25, -40, 15]), th = 37;
  const qB = quatFromMatrix(toUEMatrix(Rem)), h = (-th * Math.PI / 180) / 2, qz = [Math.sin(h), 0, 0, Math.cos(h)];
  const mul = (a, b) => { const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b; return [aw * bx + bw * ax + (ay * bz - az * by), aw * by + bw * ay + (az * bx - ax * bz), aw * bz + bw * az + (ax * by - ay * bx), aw * bw - (ax * bx + ay * by + az * bz)]; };
  const q = mul(qB, qz);
  for (const v of [[1, 0, 0], [0, 1, 0], [0.3, -0.2, 0.9]]) closeV(quatRotate(q, toUEDir(v)), toUEDir(matVec(Rem, matVec(unityEulerMatrix([0, 0, -th]), v))), 1e-9);
});
test('renderer bağlaması bayat: yazılan öznitelik için bBindingExistsOnSource false yakalanır (UE 5.8 GetRendererData biçimi)', () => {
  const rd = JSON.stringify({ returnValue: { propertyValues: JSON.stringify({
    ScaleBinding: { paramMapVariable: { name: 'Particles.Scale' }, bBindingExistsOnSource: false },
    MeshOrientationBinding: { paramMapVariable: { name: 'Particles.MeshOrientation' }, bBindingExistsOnSource: false },
    DynamicMaterialBinding: { paramMapVariable: { name: 'Particles.DynamicMaterialParameter' }, bBindingExistsOnSource: true } }) } });
  assert.deepEqual(staleBindings(rd, new Set(['Particles.Scale', 'Particles.MeshOrientation'])), ['Particles.Scale', 'Particles.MeshOrientation']);
  assert.deepEqual(staleBindings(rd, new Set(['Particles.Scale'])), ['Particles.Scale']); // yazılmayan atlanır
  assert.deepEqual(staleBindings(rd.replace(/false/g, 'true'), new Set(['Particles.Scale', 'Particles.MeshOrientation'])), []);
});
test('follow: izleyen katmanlar ayrı _iz sistemine, diğerleri ana sistemde; şerit genişliği kök–uç uzaklığından', () => {
  const fxe = JSON.parse(fs.readFileSync(path.join(root, 'vfx', 'agir_h4_bitirici.json'), 'utf8'));
  const { effect } = normalizeEffect(fxe);
  const parts = splitFollowEffects(effect);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].emitters.every((e) => e.follow.target === 'none') && parts[0].name === 'agir_h4_bitirici');
  assert.deepEqual(parts[1].emitters.map((e) => e.name), ['iz', 'iz_vurus']); assert.equal(parts[1].name, 'agir_h4_bitirici_iz');
  const p = effectToNiagaraPlan(parts[1]);
  assert.ok(findP(p, 'Particles.RibbonWidth').hlsl.startsWith('length(Particles.UPE_Tip - Particles.UPE_Root)'));
  assert.deepEqual(splitFollowEffects({ ...effect, emitters: parts[0].emitters }).length, 1);
});
test('çok emitter: 30 üstü _2, _3 sistemlerine bölünür, sıra ve adlar korunur', () => {
  const { effect } = normalizeEffect(JSON.parse(fs.readFileSync(path.join(root, 'vfx', 'agir_h2_hilal.json'), 'utf8')));
  const ch = chunkEffect(effect, 30);
  assert.equal(ch.length, Math.ceil(effect.emitters.length / 30));
  assert.deepEqual(ch.map((c) => c.name), ['agir_h2_hilal', 'agir_h2_hilal_2']);
  assert.deepEqual(ch.flatMap((c) => c.emitters.map((e) => e.name)), effect.emitters.map((e) => e.name));
  assert.ok(ch.every((c) => c.emitters.length <= 30));
  assert.equal(chunkEffect({ ...effect, emitters: effect.emitters.slice(0, 5) }).length, 1);
});
test('kuvvetsiz emitter: sıfır yerçekimi modülü çözücüden önce (NaN konum sistemi görünmez yapıyordu)', () => {
  const { effect } = normalizeEffect(JSON.parse(fs.readFileSync(path.join(root, 'vfx', 'agir_h1_yarik.json'), 'utf8')));
  effect.emitters = effect.emitters.filter((e) => e.name === 'sis');
  const st = effectToNiagaraPlan(effect).emitters[0].steps;
  const gi = st.findIndex((x) => x.alias === 'UPE_ForceInit'), si = st.findIndex((x) => String(x.asset || '').includes('SolveForcesAndVelocity'));
  assert.ok(gi >= 0 && si > gi); assert.deepEqual(st[gi].inputs[0].value.value, [0, 0, 0]);
});
test('mesh: dünya uzayı → Engine.Owner.Rotation ile çarpılır', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('arc_slash', { main: { simulationSpace: 'world' } })));
  assert.ok(findP(p, 'Particles.MeshOrientation').hlsl.includes('Engine.Owner.Rotation'));
});
test('bükülme: yerleşik Distortion materyali + skalerler', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('heat_haze')));
  const m = p.materials[0];
  assert.equal(m.blend, 'Distortion'); assert.equal(m.scalars.Mode, 1); close(m.scalars.Strength, 0.025);
  assert.ok(/^MI_UPE_soft_Distort_[0-9a-z]+$/.test(m.instance)); assert.equal(p.emitters[0].renderer.props.SortMode, 'ViewDistance');
  assert.ok(balanced(DISTORT_HLSL) && DISTORT_HLSL.includes('Texture2DSample(Tex, TexSampler'));
});
test('ışık: single → ayrı Light emitter, perParticle → kaynak adımları + UPE_Light', () => {
  const p1 = effectToNiagaraPlan(fx(presetEmitter('fire_light')));
  const le = p1.emitters.find((e) => e.kind === 'light');
  assert.ok(le && le.renderer.class === 'NiagaraLightRendererProperties' && /_Isik$/.test(le.name));
  assert.equal(le.steps.find((s) => s.alias === 'UPE_Light').params[1].hlsl, '300.0');
  const p2 = effectToNiagaraPlan(fx(presetEmitter('embers', { light: { enabled: true, mode: 'perParticle', useParticleColor: true } })));
  const l2 = p2.emitters.find((e) => e.kind === 'light'), src = p2.emitters[0];
  assert.equal(l2.data.RandomSeed, src.data.RandomSeed);
  assert.ok(l2.steps.some((s) => s.alias === 'UPE_Init') && !l2.steps.some((s) => s.alias === 'UPE_Color'));
  assert.ok(l2.steps.at(-1).params[0].hlsl.includes('Particles.UPE_CS.rgb'));
});
test('ribbon: width × taper root + uvMode tile + customData', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('slash', { bladeTrail: { enabled: true, width: [[0, 1], [1, 0.2]], taper: 'root', uvMode: 'tile', tileLength: 0.5 }, customData: { enabled: true } })));
  const e = p.emitters[0];
  assert.ok(findP(p, 'Particles.Position').hlsl.startsWith('lerp(Particles.UPE_Root, Particles.UPE_Tip, 0.5 *'));
  assert.ok(findP(p, 'Particles.RibbonWidth').hlsl.includes('saturate'));
  assert.deepEqual(e.renderer.props.UV0Settings, { DistributionMode: 'TiledOverRibbonLength', TilingLength: 50 });
  assert.ok(findP(p, 'Particles.DynamicMaterialParameter'));
});
test('alt emitter: hedef yayımsız + uyarı; önizleme şeması başvuruyu doğrular', () => {
  const e = normalizeEffect({ name: 't', emitters: [{ ...presetEmitter('sparks'), name: 'a', subEmitters: { enabled: true, items: [{ emitter: 'b', trigger: 'death', count: [3, 3] }] } }, { ...presetEmitter('embers'), name: 'b' }] }).effect;
  const p = effectToNiagaraPlan(e);
  const b = p.emitters.find((x) => x.source === 'b');
  assert.ok(!b.steps.some((s) => s.asset?.includes('Spawn'))); assert.ok(p.warnings.some((w) => /Event Handler/.test(w)));
});
test('alt emitter → Niagara olayları: kaynak Generate*, hedef Event Handler + Receive + ofset/miras', () => {
  const e = normalizeEffect({ name: 't', emitters: [
    { ...presetEmitter('sparks'), name: 'a', subEmitters: { enabled: true, items: [{ emitter: 'b', trigger: 'death', count: [2, 4], inheritVelocity: 0.5 }, { emitter: 'c', trigger: 'birth', count: [1, 1], inheritColor: true, inheritSize: true }] } },
    { ...presetEmitter('embers'), name: 'b' }, { ...presetEmitter('glow'), name: 'c' }] }).effect;
  const p = effectToNiagaraPlan(e);
  const a = p.emitters.find((x) => x.source === 'a'), b = p.emitters.find((x) => x.source === 'b'), c = p.emitters.find((x) => x.source === 'c');
  assert.ok(a.steps.some((s) => s.asset?.endsWith('GenerateDeathEvent') && s.script === 'ParticleUpdateScript'));
  assert.ok(a.steps.some((s) => s.asset?.endsWith('GenerateLocationEvent') && s.script === 'ParticleSpawnScript'));
  assert.equal(a.data.bRequiresPersistentIDs, true);
  const hb = b.eventHandlers[0];
  assert.equal(hb.sourceEmitter, 'a'); assert.equal(hb.event, 'DeathEvent');
  assert.deepEqual(hb.props, { ExecutionMode: 'SpawnedParticles', SpawnNumber: 4, bRandomSpawnNumber: true, MinSpawnNumber: 2, MaxEventsPerFrame: 0 });
  assert.ok(hb.steps[0].asset.endsWith('ReceiveDeathEvent') && hb.steps.every((s) => s.script === 'ParticleEventScript'));
  assert.equal(hb.steps[1].params[1].hlsl, 'Particles.UPE_V0 + Particles.Velocity * 0.5');
  assert.ok(b.steps.some((s) => s.alias === 'UPE_EvOff') && !b.steps.some((s) => s.asset?.includes('Spawn')));
  const hc = c.eventHandlers[0];
  assert.equal(hc.event, 'LocationEvent'); assert.ok(hc.steps[1].params.some((q) => q.name === 'Particles.UPE_Col0'));
  assert.ok(p.warnings.some((w) => /inheritSize/.test(w)));
  for (const s of [...hb.steps, ...hc.steps]) for (const q of s.params || []) assert.ok(balanced(q.hlsl));
});
test('yumuşak parçacık: yerleşik AlphaSoft/AdditiveSoft + FadeDistance; UPE-SL DepthFade girdisi', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('smoke', { renderer: { softParticles: { enabled: true, distance: 0.45 } } })));
  assert.deepEqual([p.materials[0].blend, p.materials[0].instance, p.materials[0].scalars.FadeDistance], ['AlphaSoft', 'MI_UPE_smoke_AlphaSoft45', 45]);
  const sh = { ...lib.builtins.find((x) => x.name === 'urp_particles_unlit') };
  sh.code = { ...sh.code, fragment: 'float4 frag(UPEInput i)\n{\n    return float4(i.color.rgb, i.color.a * saturate(i.sceneDepth));\n}\n' };
  const tr = translateShaderForUE(sh, { values: { _Surface: 1, _Blend: 0 }, soft: true });
  assert.deepEqual(checkTranslation(tr), []);
  const df = tr.inputs.find((x) => x.name === 'UPE_DF');
  assert.equal(df.node.class, 'MaterialExpressionDepthFade'); assert.deepEqual(df.node.connect, { FadeDistance: 'UPE_SoftDistance' });
  assert.ok(tr.inputs.some((x) => x.name === 'UPE_SD') && tr.code.includes('upeIn.sceneDepth = UPE_SD * 0.01;') && tr.code.includes('upeC.a * upeIn.softFade'));
  assert.equal(baseMaterialName(sh, renderStateFor(sh, { _Surface: 1, _Blend: 0 }), { soft: true }), 'M_UPE_urp_particles_unlit_Alpha_Soft');
});
test('decal: Decal renderer, DecalSize yarı boyut cm, yön (aşağı = UE −Z), Deferred Decal materyali', () => {
  const p = effectToNiagaraPlan(fx(presetEmitter('glow', { main: { startSize: [2, 2] }, renderer: { mode: 'decal', blend: 'alpha', decal: { size: [1, 0.5, 0.4] } } })));
  const e = p.emitters[0];
  assert.equal(e.kind, 'decal'); assert.equal(e.renderer.class, 'NiagaraDecalRendererProperties');
  assert.equal(p.materials[0].blend, 'DecalAlpha');
  assert.ok(findP(p, 'Particles.DecalSize').hlsl.startsWith('float3(20.0, 50.0, 25.0) *'));
  // yön kuaterniyonu: dönüş 0'da yerel X → UE −Z (aşağı), yerel Y → UE +Y (Unity +X)
  const m = /float4\((-?[\d.e-]+), (-?[\d.e-]+), (-?[\d.e-]+), (-?[\d.e-]+)\)/.exec(findP(p, 'Particles.UPE_QL').hlsl).slice(1).map(Number);
  closeV(quatRotate(m, [1, 0, 0]), [0, 0, -1]); closeV(quatRotate(m, [0, 1, 0]), [0, 1, 0]);
  assert.ok(findP(p, 'Particles.DecalOrientation').hlsl.includes('-Engine.Owner.Rotation.xyz')); // yerel uzayda dünya aşağısı
  const pf = effectToNiagaraPlan(fx(presetEmitter('glow', { rotation: [0, 90, 0], renderer: { mode: 'decal', blend: 'additive', decal: { projection: 'forward' } } })));
  const mf = /float4\((-?[\d.e-]+), (-?[\d.e-]+), (-?[\d.e-]+), (-?[\d.e-]+)\)/.exec(findP(pf, 'Particles.UPE_QL').hlsl).slice(1).map(Number);
  closeV(quatRotate(mf, [1, 0, 0]), toUEDir([1, 0, 0]), 1e-6); // emitter Y 90°: +Z → Unity +X
  assert.equal(pf.materials[0].blend, 'DecalAdditive');
  const sh = { ...lib.builtins.find((x) => x.name === 'urp_particles_unlit') };
  const tr = translateShaderForUE(sh, { values: { _Surface: 1, _Blend: 2 }, decal: true });
  assert.deepEqual(checkTranslation(tr), []);
  assert.equal(tr.inputs.find((x) => x.name === 'UPE_VC').node.class, 'MaterialExpressionDecalColor');
  assert.equal(tr.blendMode, 'BLEND_AlphaComposite'); assert.ok(tr.code.includes('return float4(upeC.rgb * upeC.a, 0.0);') && tr.decal);
  assert.equal(baseMaterialName(sh, renderStateFor(sh, { _Surface: 1, _Blend: 2 }), { decal: true }), 'M_UPE_urp_particles_unlit_Decal_Add');
});
test('UPE-SL: i.custom → Dynamic Parameter girdileri; bükülme → _Distort + ofset çıkışı', () => {
  const sh = { ...lib.builtins.find((s) => s.name === 'urp_particles_unlit') };
  sh.code = { ...sh.code, fragment: 'float4 frag(UPEInput i)\n{\n    return float4(i.custom.xy, 0.0, i.custom.w);\n}\n' };
  const tr = translateShaderForUE(sh, { values: { _Surface: 1, _Blend: 0 }, distortion: true });
  assert.deepEqual(checkTranslation(tr), []);
  assert.deepEqual(tr.inputs.filter((x) => /^UPE_CUS/.test(x.name)).map((x) => x.node.output), ['', 'G', 'B', 'A']);
  assert.ok(tr.code.includes('upeIn.custom = float4(UPE_CUS0') && tr.code.includes('UPE_DistortStrength') && tr.blendMode === 'BLEND_Translucent');
  assert.equal(baseMaterialName(sh, renderStateFor(sh, {}), { distortion: true }), 'M_UPE_urp_particles_unlit_Distort');
  const mf = fs.readdirSync(path.join(root, 'materials')).find((x) => x.endsWith('.json'));
  if (mf) { const mp = planEmitterMaterial(lib, mf.slice(0, -5), 'sprite', { distortion: 0.04, mesh: true }); assert.ok(/_Distort$/.test(mp.base.name) && /_Distort_40$/.test(mp.instance.name)); }
});
test('yay oturtma: bilinen çember (dönüş, yarıçap, açı, iç oran, kesir)', () => {
  const M = unityEulerMatrix([30, -50, 20]), c = [0.2, 1.1, 0.4], tips = [], grips = [];
  for (let i = 0; i <= 20; i++) { const a = (10 + 170 * i / 20) * Math.PI / 180, wv = (r) => matVec(M, [Math.cos(a) * r, Math.sin(a) * r, 0]).map((v, k) => v + c[k]); tips.push(wv(1.3)); grips.push(wv(0.4)); }
  const r = fitArc(tips, grips);
  closeV(r.center, c, 1e-3); close(r.radius, 1.3, 1e-3); close(r.angle, 170, 0.05); close(r.inner, 0.4 / 1.3, 1e-3);
  closeV(r.rotation, [30, -50, 30], 0.01); close(r.progress[10], 0.5, 1e-3);
});
test('geriye uyum: eski efekt yeni alanları varsayılanla alır, normalize iki kez aynı', () => {
  for (const file of files) {
    const a = normalizeEffect(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))).effect;
    const b = normalizeEffect(JSON.parse(JSON.stringify(a))).effect;
    assert.equal(JSON.stringify(b), JSON.stringify(a), file); // -0 ≡ 0 (JSON)
    for (const em of a.emitters) assert.ok(em.renderer.mesh && em.light && em.customData && em.subEmitters && em.bladeTrail.width, file);
  }
});

// ── tüm kütüphane + tüm şablonlar + tüm şekil tipleri
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
