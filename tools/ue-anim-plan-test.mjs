// Animasyon → Unreal saf dönüştürme testi (editörsüz; docs/UNREAL.md "Animasyon"). Sahte Mixamo rig'i (T-poz, eğik yerel eksenler)
// bilinen bir eksen eşlemesiyle (UE FBX varsayılanı (x, z, y) × 100) "UE iskeletine" çevrilir; bir kemiğin UE yerel ekseni bilerek
// farklı yapılır. animToUnrealPlan çıktısı UE'de ileri kinematikle oynatılınca her eklem, UPE'deki eklemin eşlenmiş konumuna düşmeli.
// Çalıştır: node tools/ue-anim-plan-test.mjs  (mcp-smoke de çağırır: runAnimPlanTest)
import { animToUnrealPlan, matchBones, ueAssetName, axisCandidates } from '../lib/unreal-anim.js';

const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const r = qmul(qmul(q, [...v, 0]), qinv(q)); return r.slice(0, 3); };
const axisAngle = (ax, deg) => { const l = Math.hypot(...ax), h = deg * Math.PI / 360, s = Math.sin(h) / l; return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; };
const vadd = (a, b) => a.map((v, i) => v + b[i]);

export function runAnimPlanTest({ M = [[1, 0, 0], [0, 0, 1], [0, 1, 0]], scale = 100, ueRoot = true } = {}) {
  const checks = [];
  const check = (name, ok, info = '') => checks.push({ name, ok: !!ok, info });
  const mapV = (v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const mapQ = (q) => { const a = mapV(q); return [det * a[0], det * a[1], det * a[2], q[3]]; };

  // UPE rig (three.js, m; Mixamo gibi yerel eksenler eğik). Adlar FBXLoader biçiminde: "mixamorigHips"
  const R = (ax, d) => axisAngle(ax, d);
  const bones = [
    { name: 'mixamorigHips', parent: null, restQ: R([0, 1, 0], 10), restP: [0, 1.0, 0.02] },
    { name: 'mixamorigSpine', parent: 'mixamorigHips', restQ: R([1, 0, 0], -8), restP: [0, 0.1, 0] },
    { name: 'mixamorigHead', parent: 'mixamorigSpine', restQ: R([1, 0, 0], 12), restP: [0, 0.5, 0.01] },
    { name: 'mixamorigLeftArm', parent: 'mixamorigSpine', restQ: R([0, 0, 1], -90), restP: [0.2, 0.4, 0] },
    { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', restQ: R([1, 1, 0], 5), restP: [0, 0.28, 0] },
    { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', restQ: [0, 0, 0, 1], restP: [0, 0.25, 0] },
    { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', restQ: R([0, 0, 1], 180), restP: [-0.1, -0.05, 0] },
    { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', restQ: R([1, 0, 0], 3), restP: [0, 0.45, 0] },
    { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', restQ: R([1, 0, 0], 50), restP: [0, 0.42, 0] },
  ];
  const rig = { unitScale: 1, bones };
  // farklı eksenli UE kemiği: sol önkol (UE yerel çerçevesi E kadar dönük; çocuğunun yerel konumu da buna göre)
  const odd = 'mixamorigLeftForeArm', E = axisAngle([0.3, 1, 0.2], 70);

  // UPE rest FK
  const by = new Map(bones.map((b) => [b.name, b]));
  const W = new Map(), G = new Map();
  for (const b of bones) { const p = b.parent && by.get(b.parent); W.set(b.name, p ? qmul(W.get(p.name), b.restQ) : b.restQ); G.set(b.name, p ? vadd(G.get(p.name), qrot(W.get(p.name), b.restP)) : b.restP); }
  // UE iskeleti: isteğe bağlı "root" + "mixamorig_X" adları; bileşen dönüşü = mapQ(Wupe) (· E), konum = mapV(G) × scale
  const ue = []; const compR = new Map();
  if (ueRoot) { ue.push({ name: 'root', index: 0, parentIndex: -1, location: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }); compR.set('root', [0, 0, 0, 1]); }
  for (const b of bones) {
    const nm = b.name.replace('mixamorig', 'mixamorig_');
    const cr = b.name === odd ? qmul(mapQ(W.get(b.name)), E) : mapQ(W.get(b.name)); compR.set(nm, cr);
    const pn = b.parent ? b.parent.replace('mixamorig', 'mixamorig_') : ueRoot ? 'root' : null;
    const pr = pn ? compR.get(pn) : [0, 0, 0, 1];
    const pPos = b.parent ? mapV(G.get(b.parent)).map((v) => v * scale) : [0, 0, 0];
    const loc = qrot(qinv(pr), mapV(G.get(b.name)).map((v) => v * scale).map((v, i) => v - pPos[i]));
    const lr = qmul(qinv(pr), cr);
    ue.push({ name: nm, index: ue.length, parentIndex: pn ? ue.findIndex((u) => u.name === pn) : -1, location: { x: loc[0], y: loc[1], z: loc[2] }, rotation: { x: lr[0], y: lr[1], z: lr[2], w: lr[3] } });
  }

  // animasyon: 5 kare, kalça dönüp yükselir, kol/önkol/diz döner; ayak ve baş izsiz
  const rot = (b, ax, deg) => [0, 2, 4].map((f) => [f, ...qmul(b.restQ, axisAngle(ax, deg * f / 4))]);
  const anim = {
    name: 'Kılıç Savuruş', fps: 30, length: 5, loop: true, tracks: {
      mixamorigHips: { rot: rot(bones[0], [0, 1, 0], 40), pos: [[0, 0, 1.0, 0.02], [4, 0.1, 0.9, 0.3]] },
      mixamorigLeftArm: { rot: rot(bones[3], [1, 0, 0], 60) },
      mixamorigLeftForeArm: { rot: rot(bones[4], [0, 0, 1], -45) },
      mixamorigRightLeg: { rot: rot(bones[7], [1, 0, 0], 70) },
      mixamorigSpine: { pos: [[0, 0, 0.1, 0], [4, 0, 0.15, 0.05]] },
      yokBoyleKemik: { rot: [[0, 0, 0, 0, 1]] },
    },
  };
  const plan = animToUnrealPlan(anim, rig, ue);
  check('kare/hız', plan.numKeys === 5 && plan.numFrames === 4 && plan.frameRate === 30 && plan.loop === true, JSON.stringify({ k: plan.numKeys, f: plan.numFrames, r: plan.frameRate }));
  check('kemik eşleme (mixamorig: → mixamorig_)', plan.mapping.mixamorigHips === 'mixamorig_Hips' && Object.keys(plan.mapping).length === bones.length, Object.keys(plan.mapping).length + ' kemik');
  check('eksen kalibrasyonu', JSON.stringify(plan.axes.matrix) === JSON.stringify(M) && plan.axes.score > 0.999, JSON.stringify(plan.axes));
  check('eşleşmeyen izli kemik uyarısı', plan.unmatched.includes('yokBoyleKemik') && plan.warnings.some((w) => /yokBoyleKemik/.test(w)), plan.warnings.join(' | '));
  check('farklı eksenli kemik uyarısı', plan.warnings.some((w) => /eksenler hedefte farklı/.test(w) && w.includes(odd)), '');
  check('her iz her kare anahtarlı', plan.tracks.length > 0 && plan.tracks.every((t) => t.keyframes.length === 5), plan.tracks.map((t) => t.bone).join(','));
  const hipsT = plan.tracks.find((t) => t.bone === 'mixamorig_Hips'), footT = plan.tracks.find((t) => t.bone === 'mixamorig_RightFoot');
  check('konum yalnız konum izli kemikte', hipsT?.keyframes[0].location && !footT?.keyframes?.[0]?.location && plan.tracks.find((t) => t.bone === 'mixamorig_Spine')?.keyframes[0].location, '');

  // UE'de FK: her kare her eşleşen eklem = mapV(UPE eklemi) × scale
  const evalQ = (keys, f) => { if (!keys) return null; let k = 0; while (k + 1 < keys.length && keys[k + 1][0] <= f) k++; if (k + 1 >= keys.length || f <= keys[0][0]) return keys[Math.min(k, keys.length - 1)].slice(1, 5); const t = (f - keys[k][0]) / (keys[k + 1][0] - keys[k][0]); let a = keys[k].slice(1, 5), b = keys[k + 1].slice(1, 5); const d = a.reduce((s, v, i) => s + v * b[i], 0); if (d < 0) b = b.map((v) => -v); const th = Math.acos(Math.min(1, Math.abs(d))); if (th < 1e-6) return a; const s = Math.sin(th); return a.map((v, i) => v * Math.sin((1 - t) * th) / s + b[i] * Math.sin(t * th) / s); };
  const evalP = (keys, f) => { if (!keys) return null; if (f <= keys[0][0]) return keys[0].slice(1); const n = keys.length; if (f >= keys[n - 1][0]) return keys[n - 1].slice(1); let k = 0; while (keys[k + 1][0] <= f) k++; const t = (f - keys[k][0]) / (keys[k + 1][0] - keys[k][0]); return keys[k].slice(1).map((v, i) => v + (keys[k + 1][i + 1] - v) * t); };
  const trk = new Map(plan.tracks.map((t) => [t.bone, t.keyframes]));
  let worst = 0, worstRot = 0;
  for (let f = 0; f < 5; f++) {
    const Wf = new Map(), Gf = new Map();
    for (const b of bones) { const t = anim.tracks[b.name]; const lq = evalQ(t?.rot, f) || b.restQ, lp = evalP(t?.pos, f) || b.restP; const p = b.parent; Wf.set(b.name, p ? qmul(Wf.get(p), lq) : lq); Gf.set(b.name, p ? vadd(Gf.get(p), qrot(Wf.get(p), lp)) : lp); }
    const cR = new Map(), cP = new Map();
    for (const u of ue) {
      const k = trk.get(u.name)?.[f]; const p = ue[u.parentIndex];
      const lr = k ? [k.rotation.x, k.rotation.y, k.rotation.z, k.rotation.w] : [u.rotation.x, u.rotation.y, u.rotation.z, u.rotation.w];
      const ll = k?.location ? [k.location.x, k.location.y, k.location.z] : [u.location.x, u.location.y, u.location.z];
      const pr = p ? cR.get(p.name) : [0, 0, 0, 1], pp = p ? cP.get(p.name) : [0, 0, 0];
      cR.set(u.name, qmul(pr, lr)); cP.set(u.name, vadd(pp, qrot(pr, ll)));
    }
    for (const b of bones) {
      const nm = b.name.replace('mixamorig', 'mixamorig_');
      const want = mapV(Gf.get(b.name)).map((v) => v * scale); const got = cP.get(nm);
      worst = Math.max(worst, Math.hypot(...want.map((v, i) => v - got[i])));
      const wantR = b.name === odd ? qmul(mapQ(Wf.get(b.name)), E) : mapQ(Wf.get(b.name)); const gr0 = cR.get(nm), gl = Math.hypot(...gr0), gr = gr0.map((v) => v / gl); // 6 haneye yuvarlanmış anahtarlar tam birim değil
      // açı: |q1 − ±q2| ile (acos 1'e yakın yerde kötü koşullu)
      const dm = Math.min(Math.hypot(...wantR.map((v, i) => v - gr[i])), Math.hypot(...wantR.map((v, i) => v + gr[i])));
      worstRot = Math.max(worstRot, 4 * Math.asin(Math.min(1, dm / 2)) * 180 / Math.PI);
    }
  }
  check('UE FK eklem konumları = eşlenmiş UPE eklemleri', worst < 1e-3, `en büyük sapma ${worst.toExponential(2)} cm`);
  check('UE FK kemik dönüşleri = eşlenmiş UPE dönüşleri (· K)', worstRot < 1e-3, `en büyük sapma ${worstRot.toExponential(2)}°`);
  check('varlık adı (ASCII, A_)', ueAssetName('Kılıç Savuruş') === 'A_Kilic_Savurus' && ueAssetName('A_run') === 'A_run', ueAssetName('Kılıç Savuruş'));
  check('ad eşleme önekisiz', matchBones(['mixamorigHips'], ['Hips']).get('mixamorigHips') === 'Hips', '');
  return checks;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('ue-anim-plan-test.mjs')) {
  let fails = 0;
  const cases = [['UE FBX varsayılanı', {}], ['Force Front X (x→−y)', { M: [[0, 0, 1], [-1, 0, 0], [0, 1, 0]] }], ['kökü olmayan iskelet', { ueRoot: false }]];
  for (const [label, opts] of cases) {
    console.log(`── ${label}`);
    for (const c of runAnimPlanTest(opts)) { if (!c.ok) fails++; console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.info ? '  — ' + c.info : ''}`); }
  }
  console.log(`\n48 aday eksen: ${axisCandidates().length}`);
  process.exit(fails ? 1 : 0);
}
