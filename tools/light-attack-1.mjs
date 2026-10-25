// game_light_attack_1 üretici (v3): kinetik zincir gecikmeleri, tek kesim düzleminde sabit roll, saf menteşe dirsek,
// gövde-kol kesişim ölçümü, ~0,7 sn (42 kare @60). Editör sunucusu açıkken: node light-attack-1.mjs
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const BASE = 'http://127.0.0.1:5177';
const st = await (await fetch(BASE + '/api/state')).json();
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (a) => new THREE.Quaternion(...a);
const Rx = (d) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rad(d));
const Ry = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rad(d));
const Rz = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rad(d));
const eul = (e) => Ry(e[0]).multiply(Rx(e[1])).multiply(Rz(e[2])); // yaw, pitch, roll (world)
const ARGS = process.argv.slice(2); const NOSEND = ARGS.includes('--nosend');

const restW = {}, restPos = {};
for (const b of bones) {
  const q = Q(b.restQ);
  if (!b.parent) { restW[b.name] = q; restPos[b.name] = V(...b.restP); }
  else { restW[b.name] = restW[b.parent].clone().multiply(q); restPos[b.name] = restPos[b.parent].clone().add(V(...b.restP).applyQuaternion(restW[b.parent])); }
}
const armQ = Q(by.Armature.restQ);
const restDir = (bone, child) => V(...by[child].restP).applyQuaternion(restW[bone]).normalize();

// katana: bıçak yönü (el rest dünya eksenlerinde)
const prop = st.props?.find((p) => p.id === 'katana');
const pr = prop ? prop.rot : [-25.281, -54.674, -2.581];
const Qp = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(pr[0]), rad(pr[1]), rad(pr[2]), 'XYZ'));
const b0 = V(0, 0, 1).applyQuaternion(Qp).normalize();
const fr0 = restDir('RightForeArm', 'RightHand');
function frame(a, b) { const x = a.clone().normalize(); const z = x.clone().cross(b).normalize(); const y = z.clone().cross(x); return new THREE.Matrix4().makeBasis(x, y, z); }
const WRIST = 14;
const nW = b0.clone().cross(fr0).normalize();
const Wr = new THREE.Quaternion().setFromAxisAngle(nW, rad(WRIST));
const b1 = b0.clone().applyQuaternion(Wr);
const alpha = Math.acos(fr0.dot(b1));
const M0inv = frame(fr0, b1).invert();

// ---- Eğri yardımcıları (Hermite / Catmull-Rom, eşit olmayan zaman) ----
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (j === 0) { const q = asArr(keys[1][1]); return Pj.map((v, c) => 0.7 * (q[c] - v) / (keys[1][0] - keys[0][0])); }
    if (j === n - 1) { const q = asArr(keys[n - 2][1]); return Pj.map((v, c) => 0.3 * (v - q[c]) / (keys[n - 1][0] - keys[n - 2][0])); }
    const a = asArr(keys[j - 1][1]), b = asArr(keys[j + 1][1]);
    return Pj.map((_, c) => (b[c] - a[c]) / (keys[j + 1][0] - keys[j - 1][0])); };
  const m0 = tan(i), m1 = tan(i + 1); const h = t1 - t0; const s = Math.max(0, Math.min(1, (f - t0) / h));
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  const r = A.map((a, c) => h00 * a + h10 * h * m0[c] + h01 * B[c] + h11 * h * m1[c]);
  return arr ? r : r[0];
}

// ---- Pozlar (zamanlar 42 karelik süre için) ----
const T = { guard: 0, antic: 13, over: 16, mid: 18, end: 21, follow: 25, settle: 33, rest: 41 };
const LEN = 42, HIT = 18;
const P = {
  guard: { pel: [-4, 4, 0.5], hp: [0.004, -0.05, 0.0], s2: [-3, 2, 0], s1: [-3, 1, 0.5], ch: [-2, 1, 0], neck: [4, -3, 0], head: [5, 0, 1],
    lf: [0.02, 0, 0.12, 6, 0], rf: [-0.03, 0, -0.10, -18, 0], th: [35] },
  antic: { pel: [-19, -3, -3], hp: [-0.035, -0.105, -0.085], s2: [-4, -1, 0], s1: [-5, -2, 2], ch: [-5, -2, 2.5], neck: [14, 2, 0], head: [18, 3, 1],
    lf: [0.02, 0, 0.12, 8, 0], rf: [-0.04, 0, -0.12, -25, 0], th: [-105] },
  over: { pel: [-3, 3, -1], hp: [-0.02, -0.095, -0.01], s2: [0, 1, 0], s1: [0, 0.5, 1], ch: [0, 0, 1], neck: [2, 0, 0], head: [3, 0, 0],
    lf: [0.025, 0.03, 0.19, 8, 12], rf: [-0.04, 0.012, -0.12, -27, 6], th: [-35] },
  mid: { pel: [8, 5, 0.5], hp: [0.004, -0.115, 0.12], s2: [4, 2, 0], s1: [5, 2, 0], ch: [5, 3, 0], neck: [-8, 0, 0], head: [-10, 2, 0],
    lf: [0.03, 0.04, 0.26, 8, -10], rf: [-0.04, 0.03, -0.12, -30, 18], th: [50] },
  end: { pel: [22, 8, 1.5], hp: [0.022, -0.125, 0.19], s2: [5, 3, 0], s1: [6, 3, 0], ch: [5, 3, 0], neck: [-14, 0, 0], head: [-14, -1, 0],
    lf: [0.03, 0.005, 0.30, 8, -5], rf: [-0.04, 0.045, -0.12, -30, 22], th: [55] },
  follow: { pel: [25, 7, 2], hp: [0.028, -0.13, 0.21], s2: [5, 3, 0], s1: [6, 3, 0], ch: [6, 2, 0.5], neck: [-12, 0, 0], head: [-14, 0, 0],
    lf: [0.03, 0, 0.30, 8, 0], rf: [-0.04, 0.04, -0.12, -30, 20], th: [58] },
  settle: { pel: [15, 4, 0], hp: [0.016, -0.10, 0.17], s2: [3, 1, 0], s1: [3, 1, 0], ch: [3, 1, 0], neck: [-6, 0, 0], head: [-8, 0, 0],
    lf: [0.03, 0, 0.28, 8, 0], rf: [-0.04, 0.008, -0.12, -27, 5], th: [45] },
  rest: { pel: [13, 3.5, 0.5], hp: [0.008, -0.088, 0.15], s2: [2, 1, 0], s1: [2.5, 1, 0], ch: [2.5, 1, 0], neck: [-4, 0, 0], head: [-6, 0, 0.5],
    lf: [0.03, 0, 0.27, 8, 0], rf: [-0.04, 0.002, -0.12, -26, 2], th: [40] },
};
// kinetik zincir: kalça önce, sonra omurga, kafa en son (pozitif = o kanal erken)
const LEAD = { pel: 3, hp: 2.5, s2: 2.2, s1: 1.4, ch: 0.6, neck: -0.8, head: -1.8, lf: 0, rf: 0, th: 0 };
const dPl = V(0.38, -0.92, 0).normalize(), zF = V(0, 0, 1);
const planeDir = (d) => zF.clone().multiplyScalar(Math.cos(rad(d))).add(dPl.clone().multiplyScalar(Math.sin(rad(d))));
const names = Object.keys(T);
function poseAt(f) {
  const r = {};
  for (const k of Object.keys(P.guard)) r[k] = spl(names.map((n) => [T[n], P[n][k]]), f + (LEAD[k] || 0));
  // mikro hareket: nefes, ağırlık kayması (asimetrik)
  r.ch[1] += 0.9 * Math.sin(2 * Math.PI * f / 44); r.s1[1] += 0.5 * Math.sin(2 * Math.PI * f / 44 + 0.6);
  r.hp[1] += 0.004 * Math.sin(2 * Math.PI * f / 44 + 1.1); r.hp[0] += 0.007 * Math.sin(f * 0.13 + 0.5);
  r.pel[2] += 0.8 * Math.sin(f * 0.11); r.head[2] += 0.8 * Math.sin(f * 0.09 + 1);
  return r;
}
const BEND_R = [[0, 36], [13, 52], [16, 40], [18, 24], [21, 18], [26, 17], [34, 27], [41, 32]];
const BEND_L = [[0, 38], [10, 42], [15, 38], [21, 30], [27, 34], [41, 38]];
const LU = [[0, [0.2, -0.95, 0.1]], [10, [0.2, -0.9, 0.35]], [15, [0.26, -0.93, 0.12]], [21, [0.3, -0.88, -0.35]], [27, [0.32, -0.86, -0.4]], [41, [0.22, -0.93, -0.2]]];
// önkol ipucu: geri salınımda bile önkol üst koldan daha geride olamaz (dirsek ters bükülmez); öyle istenirse çözücü
// kolu ~145° burup avucu dışa çeviriyordu (eski 21/27 değerleri)
const LF = [[0, [0.15, -0.6, 0.78]], [10, [0.0, -0.55, 0.83]], [15, [0.2, -0.7, 0.65]], [21, [0.3, -0.92, -0.05]], [27, [0.33, -0.9, -0.1]], [41, [0.28, -0.75, 0.4]]];

function mkHinge(side) {
  const u0 = restDir(side + 'Arm', side + 'ForeArm'), f0 = restDir(side + 'ForeArm', side + 'Hand');
  const n0 = u0.clone().cross(f0).normalize(); const ang0 = u0.angleTo(f0);
  const test = u0.angleTo(f0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(n0, 0.1)));
  return { u0, f0, n0, ang0, sgn: test > ang0 ? 1 : -1 };
}
const R = mkHinge('Right'), RL = mkHinge('Left');
R.f0 = fr0;
const hinge = (H, bend) => new THREE.Quaternion().setFromAxisAngle(H.n0, H.sgn * (rad(bend) - H.ang0));
const elbowAngle = (Darm, Dfore, H) => deg(H.u0.clone().applyQuaternion(Darm).angleTo(H.f0.clone().applyQuaternion(Dfore)));
const lcache = {};
function leftArm(f) {
  if (lcache[f]) return lcache[f];
  const prevPhi = f > 0 ? leftArm(f - 1).phi : null;
  const u = V(...spl(LU, f)).normalize(), hint = V(...spl(LF, f)).normalize(), bend = spl(BEND_L, f);
  const Ds = new THREE.Quaternion().setFromUnitVectors(RL.u0, u); const hg = hinge(RL, bend);
  let best = null;
  // burulma (phi) doğal aralıkta ve yavaş değişir: kare başına ≤6°, 25° civarından uzaklaşmaya ceza
  const cands = prevPhi === null ? Array.from({ length: 120 }, (_, i) => -180 + i * 3) : Array.from({ length: 13 }, (_, i) => prevPhi - 6 + i);
  for (const phi of cands) {
    const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(phi)).multiply(Ds); const fore = arm.clone().multiply(hg);
    const sc = RL.f0.clone().applyQuaternion(fore).angleTo(hint) + 0.004 * Math.abs(phi - 25);
    if (!best || sc < best.sc) best = { sc, phi, arm, fore };
  }
  return (lcache[f] = { arm: best.arm, fore: best.fore, phi: best.phi, bend });
}

const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const FINGERS = JSON.parse(fs.readFileSync('C:/AnimRef/animations/katana_run.json', 'utf8')).tracks;

// ---- Kesişim ölçümü: gövde = iki eliptik silindir (alt: kalça+palto, üst: göğüs), kol/bıçak noktaları ----
function clearance(pos, cur, D) {
  const res = {};
  const upF = D.Spine01.clone().invert(); const loF = D.Hips.clone().invert();
  const sp2 = pos.Spine02;
  const chk = (key, pt, r) => {
    let best = 9;
    // üst gövde: Spine02'den boyuna +0.45
    let l = pt.clone().sub(sp2).applyQuaternion(upF);
    if (l.y > -0.02 && l.y < 0.5) { const de = Math.hypot(l.x / (0.18 + r), l.z / (0.14 + r)); best = Math.min(best, (de - 1) * 0.17); }
    // alt gövde + palto: kalçadan aşağı diz hizasına
    l = pt.clone().sub(pos.Hips).applyQuaternion(loF);
    if (l.y > -0.55 && l.y < 0.12) { const de = Math.hypot(l.x / (0.24 + r), l.z / (0.18 + r)); best = Math.min(best, (de - 1) * 0.2); }
    if (best < (res[key] ?? 9)) res[key] = best;
  };
  const lerp = (a, b, t) => a.clone().lerp(b, t);
  for (const [s, tag] of [['Right', 'R'], ['Left', 'L']]) {
    const sh = pos[s + 'Arm'], el = pos[s + 'ForeArm'], wr = pos[s + 'Hand'];
    for (const t of [0.4, 0.7]) chk(tag + '_upper', lerp(sh, el, t), 0.055);
    chk(tag + '_elbow', el, 0.06); chk(tag + '_fore', lerp(el, wr, 0.5), 0.05); chk(tag + '_hand', wr, 0.05);
  }
  return res;
}

function solve(f) {
  const p = poseAt(f); const D = {};
  D.Hips = eul(p.pel);
  D.Spine02 = eul(p.s2).multiply(D.Hips);
  D.Spine01 = eul(p.s1).multiply(D.Spine02);
  D.Spine = eul(p.ch).multiply(D.Spine01);
  D.neck = eul(p.neck).multiply(D.Spine);
  D.Head = eul(p.head).multiply(D.neck);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(...p.hp));
  // bacaklar IK
  for (const [s, ft, sg] of [['Left', p.lf, 1], ['Right', p.rf, -1]]) {
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    const target = restPos[s + 'Foot'].clone().add(V(ft[0], ft[1], ft[2]));
    let dv = target.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h));
    const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), knee.clone().sub(hipJ).normalize());
    D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), ankle.clone().sub(knee).normalize());
    D[s + 'Foot'] = eul([ft[3], ft[4], 0]); // yaw, topuk-parmak yuvarlanması (pitch)
  }
  // sağ kol: önkol + bıçak tek düzlemde (roll sabit); üst kol saf menteşe
  const nrm = (a) => V(...a).normalize();
  const th = p.th[0], al = deg(alpha);
  const bd = Math.max(16, spl(BEND_R, f)); p.bend = bd;
  const rt = planeDir(th - al), rfh = planeDir(th);
  {
    const hp_ = rfh.clone().sub(rt.clone().multiplyScalar(rfh.dot(rt))).normalize();
    const fdir = rt.clone().multiplyScalar(Math.cos(alpha)).add(hp_.multiplyScalar(Math.sin(alpha)));
    D.RightForeArm = new THREE.Quaternion().setFromRotationMatrix(frame(fdir, rt).multiply(M0inv));
    p.bladeDir = b1.clone().applyQuaternion(D.RightForeArm);
    D.RightArm = D.RightForeArm.clone().multiply(hinge(R, bd).invert());
    D.RightHand = D.RightForeArm.clone().multiply(Wr);
    p.elbow = elbowAngle(D.RightArm, D.RightForeArm, R);
  }
  // sol kol: gevşek, sürekli
  const lA = leftArm(f); D.LeftArm = lA.arm; D.LeftForeArm = lA.fore;
  const lag = leftArm(Math.max(0, f - 3)).fore;
  const rel = D.LeftForeArm.clone().invert().multiply(lag); const ang = 2 * Math.acos(Math.min(1, Math.abs(rel.w)));
  const k = ang > rad(9) ? rad(9) / ang : 1;
  D.LeftHand = D.LeftForeArm.clone().multiply(new THREE.Quaternion().slerp(rel, k));
  p.lbend = lA.bend; p.lwrist = deg(Math.min(ang, rad(9)));
  if (LOV[f]) { Object.assign(D, LOV[f].D); p.lbend = LOV[f].bend; }
  // yerel
  const cur = {}; const out = {}; const pos = {};
  for (const b of bones) {
    if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
    const par = cur[b.parent]; let local;
    if (D[b.name]) { cur[b.name] = D[b.name].clone().multiply(restW[b.name]); local = par.clone().invert().multiply(cur[b.name]); }
    else { local = Q(b.restQ); cur[b.name] = par.clone().multiply(local); }
    out[b.name] = local;
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent]));
  }
  p.clr = clearance(pos, cur, D);
  // kılıç bıçağı: el çizgisi boyunca örnekler (gövdeye değiyor mu) + kafa
  const bl = []; for (let s = -0.08; s <= 0.95; s += 0.1) bl.push(pos.RightHand.clone().add(p.bladeDir.clone().multiplyScalar(s)));
  const sk = V(0, 0, 0);
  let bc = 9; { const upF = D.Spine01.clone().invert(); const loF = D.Hips.clone().invert();
    for (const pt of bl) { let l = pt.clone().sub(pos.Spine02).applyQuaternion(upF);
      if (l.y > -0.02 && l.y < 0.5) bc = Math.min(bc, (Math.hypot(l.x / 0.19, l.z / 0.15) - 1) * 0.17);
      l = pt.clone().sub(pos.Hips).applyQuaternion(loF);
      if (l.y > -0.55 && l.y < 0.12) bc = Math.min(bc, (Math.hypot(l.x / 0.25, l.z / 0.19) - 1) * 0.2); } }
  p.clr.blade = bc;
  let hc = 9; for (const pt of bl) hc = Math.min(hc, pt.distanceTo(pos.Head.clone().add(V(0, 0.1, 0))) - 0.13); p.clr.head = hc;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// sol el toplanmada kılıçlı eli hafifçe takip eder: sağ elin yer değiştirmesinin ~%35'i (geri bileşeni bastırılmış), 2 kare
// gecikmeli; vuruşa doğru söner. Sol kol bu hedefe iki kemikli IK ile çözülür; dirsek taban pozdaki dirseğe bakar (w→0'da
// taban poza birebir döner), menteşe ve bilek gecikmesi korunur.
const FOLLOW = [[0, 0], [4, 0.2], [11, 0.35], [15, 0.27], [23, 0], [LEN - 1, 0]];
const LOV = {};
{
  const base = Array.from({ length: LEN }, (_, f) => solve(f));
  const R0 = base[0].pos.RightHand;
  for (let f = 0; f < LEN; f++) {
    const w = Math.max(0, spl(FOLLOW, f)); if (w < 1e-3) continue;
    const { pos, D: Db } = base[f]; const dR = base[Math.min(Math.max(0, f - 2), T.antic - 1)].pos.RightHand.clone().sub(R0); dR.z *= 0.3; dR.y *= 1.45; // yukarı daha çok; inişte sağ elin hızlı yolunu izlemez, toplanma tepesinden söner
    const S = pos.LeftArm, E = pos.LeftForeArm, H = pos.LeftHand;
    const Tg = H.clone().add(dR.multiplyScalar(w));
    const a = E.distanceTo(S), b = H.distanceTo(E);
    let d = Tg.distanceTo(S); d = Math.min(Math.max(d, Math.abs(a - b) + 1e-3), a + b - 1e-3);
    const dir = Tg.clone().sub(S).normalize();
    const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
    const pole = E.clone().add(V(0.06, -0.04, 0).multiplyScalar(w / 0.35)).sub(S); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const E2 = S.clone().add(dir.clone().multiplyScalar(x)).add(pole.multiplyScalar(h)), H2 = S.clone().add(dir.clone().multiplyScalar(d));
    const u = E2.clone().sub(S).normalize(), fd = H2.clone().sub(E2).normalize(), bend = deg(u.angleTo(fd));
    const Ds = new THREE.Quaternion().setFromUnitVectors(RL.u0, u), hg = hinge(RL, bend);
    const lA = leftArm(f); let best = null;
    for (let phi = lA.phi - 120; phi <= lA.phi + 120; phi += 0.5) {
      const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(phi)).multiply(Ds), fore = arm.clone().multiply(hg);
      const sc = RL.f0.clone().applyQuaternion(fore).angleTo(fd); if (!best || sc < best.sc) best = { sc, phi, arm, fore };
    }
    const wristRel = Db.LeftForeArm.clone().invert().multiply(Db.LeftHand);
    LOV[f] = { D: { LeftArm: best.arm, LeftForeArm: best.fore, LeftHand: best.fore.clone().multiply(wristRel) }, bend, phi: best.phi, err: deg(best.sc), shift: Tg.distanceTo(H) };
  }
  console.log('sol el takip (kare: kayma cm / burulma° / hata°)', Object.entries(LOV).map(([f, o]) => f + ':' + (o.shift * 100).toFixed(0) + '/' + o.phi.toFixed(0) + '/' + o.err.toFixed(1)).join(' '));
}
const tracks = {}; const diag = []; const prev = {}; const hand = [];
for (let f = 0; f < LEN; f++) {
  const { out, hipsLocal, p, pos } = solve(f);
  for (const [n, q] of Object.entries(out)) {
    if (n === 'Armature') continue;
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  (tracks.Hips.pos ||= []).push([f, ...hipsLocal]);
  hand.push({ R: pos.RightHand.clone(), L: pos.LeftHand.clone(), E: pos.RightForeArm.clone(), EL: pos.LeftForeArm.clone() });
  diag.push({ f, elbow: p.elbow, lbend: p.lbend, lw: p.lwrist, clr: p.clr, q: Object.fromEntries(['RightArm', 'RightForeArm', 'LeftArm', 'LeftForeArm'].map((n) => [n, out[n].clone()])) });
}
// sol el: serbest (gevşek) insan eli. Parmaklar saf menteşe fleksiyonuyla (koşu pozundaki burulma alınmaz) MCP/PIP/DIP
// doğal açılarda, serçeye doğru artan; başparmak neredeyse düz, işaret parmağının yanında. Kolun hızına bağlı yaylı ikincil
// hareket: el hızlanınca parmaklar hafifçe açılır, durunca biraz kıvrılıp oturur (serçe daha geç, daha gevşek).
const powQ = (q, k) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const a = 2 * Math.acos(Math.min(1, q.w));
  return a < 1e-6 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(V(q.x, q.y, q.z).normalize(), a * k); };
const FLEX = { Index: [16, 26, 10], Middle: [20, 32, 12], Ring: [25, 36, 14], Pinky: [30, 38, 15] };
const JW = [1, 0.6, 0.35];
const SPR = { Thumb: [0.6, 0.42], Index: [0.62, 0.34], Middle: [0.56, 0.32], Ring: [0.5, 0.3], Pinky: [0.44, 0.28] }; // ω (rad/kare), ζ
const PH = { Thumb: 0.3, Index: 0, Middle: 0.7, Ring: 1.4, Pinky: 2.1 };
const spd = hand.map((h, f) => (f ? h.L.distanceTo(hand[f - 1].L) : 0)); const vmax = Math.max(...spd) || 1;
const sec = {};
for (const kind of Object.keys(SPR)) {
  const [w, z] = SPR[kind]; let x = 0, v = 0; sec[kind] = [];
  for (let f = 0; f < LEN; f++) { v += -w * w * (x + 11 * spd[f] / vmax) - 2 * z * w * v; x += v; sec[kind].push(x + 1.5 * Math.sin(2 * Math.PI * f / 44 + PH[kind])); }
}
const hingeAxis = (n) => { let d = Q(by[n].restQ).invert().multiply(Q(FINGERS[n].rot[0].slice(1))); if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w); return V(d.x, 0, d.z).normalize(); };
const curl = {};
for (const [n, t] of Object.entries(FINGERS)) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n)) {
  const q = Q(t.rot[0].slice(1));
  if (!n.startsWith('Left')) { tracks[n] = { rot: [[0, q.x, q.y, q.z, q.w], [LEN - 1, q.x, q.y, q.z, q.w]] }; continue; }
  const [, kind, jn] = n.match(/Hand(Thumb|Index|Middle|Ring|Pinky)(\d)/); const j = jn - 1;
  const rest = Q(by[n].restQ); curl[n] = [];
  if (kind === 'Thumb') { const delta = rest.clone().invert().multiply(q); // başparmak: koşu kıvrımının %30'u + hafif ikincil
    for (let f = 0; f < LEN; f++) curl[n].push(rest.clone().multiply(powQ(delta, Math.max(0.05, 0.3 + sec.Thumb[f] / 60)))); continue; }
  const ax = hingeAxis('LeftHand' + kind + '2');
  for (let f = 0; f < LEN; f++) curl[n].push(rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ax, rad(Math.max(2, FLEX[kind][j] + sec[kind][f] * JW[j])))));
}
// başparmak serbest konumda işaret parmağının yanında: Thumb1'i ucu işaret parmağının orta boğumuna doğru %55 çevir (avuca kapanmaz)
const P_ = (n) => V(...by[n].restP);
for (let f = 0; f < LEN; f++) {
  const [t1, t2, t3] = ['LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3'].map((n) => curl[n][f]);
  const p1 = P_('LeftHandThumb1');
  const tip = P_('LeftHandThumb2').add(P_('LeftHandThumb3').add(V(0, 0.025, 0).applyQuaternion(t3)).applyQuaternion(t2)).applyQuaternion(t1);
  const idx2 = P_('LeftHandIndex1').add(P_('LeftHandIndex2').applyQuaternion(curl.LeftHandIndex1[f]));
  const swing = new THREE.Quaternion().setFromUnitVectors(tip.normalize(), idx2.sub(p1).normalize());
  curl.LeftHandThumb1[f] = new THREE.Quaternion().slerp(swing, 0.55).multiply(t1);
}
for (const [n, arr] of Object.entries(curl)) tracks[n] = { rot: arr.map((r, f) => [f, r.x, r.y, r.z, r.w]) };
console.log('sol el hız max (cm/kare)', (vmax * 100).toFixed(1), '| parmak ikincil aralığı (°)', Object.entries(sec).map(([k, a]) => k + ' ' + Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0)).join(', '));
const el = diag.map((d) => d.elbow);
console.log('sağ dirsek min/max', Math.min(...el).toFixed(1), Math.max(...el).toFixed(1), '| sol dirsek', Math.min(...diag.map((d) => d.lbend)).toFixed(1), Math.max(...diag.map((d) => d.lbend)).toFixed(1), '| sol bilek max', Math.max(...diag.map((d) => d.lw)).toFixed(1), '| sağ bilek', WRIST);
const mx = {};
for (let i = 1; i < diag.length; i++) {
  for (const n of Object.keys(diag[i].q)) { const a = 2 * Math.acos(Math.min(1, Math.abs(diag[i].q[n].dot(diag[i - 1].q[n])))); mx[n] = Math.max(mx[n] || 0, deg(a)); }
  mx.elbowStep = Math.max(mx.elbowStep || 0, Math.abs(diag[i].elbow - diag[i - 1].elbow));
  mx.handR = Math.max(mx.handR || 0, hand[i].R.distanceTo(hand[i - 1].R) * 100); mx.handL = Math.max(mx.handL || 0, hand[i].L.distanceTo(hand[i - 1].L) * 100);
}
console.log('kareler arası max (deg / cm)', JSON.stringify(Object.fromEntries(Object.entries(mx).map(([k, v]) => [k, +v.toFixed(1)]))));
console.log('elbow', diag.map((d) => Math.round(d.elbow)).join(','));
const keys = Object.keys(diag[0].clr); const minAll = {};
for (const k of keys) { const vals = diag.map((d) => d.clr[k]).filter((v) => typeof v === "number"); minAll[k] = +Math.min(...vals).toFixed(3); }
console.log('min gövde mesafesi (m, <0 = içeride)', JSON.stringify(minAll));
for (const d of diag) { const bad = keys.filter((k) => d.clr[k] < 0.0); if (bad.length) console.log('  kare', d.f, bad.map((k) => k + ':' + d.clr[k].toFixed(3)).join(' ')); }
const anim = { name: 'game_light_attack_1', fps: 60, length: LEN, loop: false, tracks };
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log(r);
  const s = await (await fetch(BASE + '/api/animations/save?name=' + anim.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', s);
}
