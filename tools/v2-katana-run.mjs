// v2_katana_run üretici (SIFIRDAN, mevcut koşu kliplerinden hiçbir şey kopyalanmaz).
// Katana sağ elde (kılıç elde koşu), 40 kare @60 = 0.667 sn = 180 adım/dk, döngüsel, yerinde (kök hareketi yok).
// Pozlar DÜNYA eksenlerinde (+Z ileri, +X karakterin solu, +Y yukarı), segmentler dünya delta dönüşü olarak verilir.
// Çalıştır: node v2-katana-run.mjs [--nosend] [--port 5179]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const ARGS = process.argv.slice(2); const NOSEND = ARGS.includes('--nosend');
const pi = ARGS.indexOf('--port'); const PORT = pi >= 0 ? ARGS[pi + 1] : '5179';
const BASE = 'http://127.0.0.1:' + PORT;
const OUT = process.env.V2_OUT || 'C:/AnimRef/tools/tmp/v2_katana_run.json';
const st = await (await fetch(BASE + '/api/state')).json();
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (a) => new THREE.Quaternion(...a);
const Rx = (d) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rad(d));
const Ry = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rad(d));
const Rz = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rad(d));
const eul = (e) => Ry(e[0]).multiply(Rx(e[1])).multiply(Rz(e[2])); // yaw(+sol), pitch(+öne/ayakta parmak aşağı), roll(+sol yukarı)
const TAU = Math.PI * 2;

// ---------- ayarlar ----------
const LEN = 40, FPS = 60;
const PHTO = 0.26;            // temas bitişi (toe-off), döngü oranı
const Z0 = 0.30, Z1 = -0.37;  // temas ayağı: pelvise göre ayak bileği z (ileri +) başlangıç / bitiş
const FOOT_X = 0.105;         // temas ayağı yanal (merkezden)
const WRIST = 10;             // sağ bilek: sabit tutuş açısı (bütçe 18)
const P = { // ince ayar parametreleri (env V2_P ile ezilebilir)
  pelYaw: 8, chestYaw: 12, pelRoll: 3, lean: 14,
  armLagL: 0.04, armLagR: 0.04,
  LfwdA: 46, LbackA: -26, RfwdA: 14, RbackA: -24,
  hintB: [-0.33, -0.14, -0.93], hintF: [-0.35, -0.20, -0.91],
  LbendF: 88, LbendB: 100, RbendF: 92, RbendB: 84,
};
if (process.env.V2_P) Object.assign(P, JSON.parse(process.env.V2_P));

// ---------- rest ----------
const restW = {}, restPos = {};
for (const b of bones) {
  const q = Q(b.restQ);
  if (!b.parent) { restW[b.name] = q; restPos[b.name] = V(...b.restP); }
  else { restW[b.name] = restW[b.parent].clone().multiply(q); restPos[b.name] = restPos[b.parent].clone().add(V(...b.restP).applyQuaternion(restW[b.parent])); }
}
const armQ = Q(by.Armature.restQ);
const restDir = (bone, child) => V(...by[child].restP).applyQuaternion(restW[bone]).normalize();
const LL = { Right: [V(...by.RightLeg.restP).length(), V(...by.RightFoot.restP).length()], Left: [V(...by.LeftLeg.restP).length(), V(...by.LeftFoot.restP).length()] };
const L1 = LL.Right[0], L2 = LL.Right[1];

// ---------- periyodik eğri ----------
function pk(keys, phase) {
  const n = keys.length; const ph = ((phase % 1) + 1) % 1;
  let i = n - 1; for (let k = 0; k < n; k++) { if (keys[k][0] > ph) { i = k - 1; break; } }
  const get = (j) => { const w = Math.floor(j / n); const e = keys[((j % n) + n) % n]; return [e[0] + w, e[1]]; };
  const [t0, p0] = get(i - 1), [t1, p1] = get(i), [t2, p2] = get(i + 1), [t3, p3] = get(i + 2);
  const tt = ph + (i < 0 ? 1 : 0); const a = i < 0 ? get(n - 1) : null; // i=-1: ph < ilk anahtar
  let T0 = t0, P0 = p0, T1 = t1, P1 = p1, T2 = t2, P2 = p2, T3 = t3, P3 = p3, x = ph;
  if (i < 0) { [T0, P0] = get(-2); [T1, P1] = get(-1); [T2, P2] = get(0); [T3, P3] = get(1); }
  const arr = Array.isArray(P1); const A1 = arr ? P1 : [P1], A0 = arr ? P0 : [P0], A2 = arr ? P2 : [P2], A3 = arr ? P3 : [P3];
  const h = T2 - T1; const s = (x - T1) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  const r = A1.map((v, c) => { const m1 = (A2[c] - A0[c]) / (T2 - T0), m2 = (A3[c] - A1[c]) / (T3 - T1); return h00 * v + h10 * h * m1 + h01 * A2[c] + h11 * h * m2; });
  return arr ? r : r[0];
}
const cs = (ph, c = 0) => Math.cos(TAU * (ph - c));

// ---------- ayak yolları (kendi temas fazı ph: 0 = temas başı) ----------
const FOOT_ST_Y = [[0, 0.152], [0.05, 0.145], [0.14, 0.143], [0.21, 0.152], [PHTO, 0.178]];
const FOOT_ST_P = [[0, -4], [0.05, -2], [0.14, 0], [0.21, 14], [PHTO, 38]]; // plantar fleksiyon (+ parmak aşağı)
// salınım (swing): [ph, [z, y, x_ofset, pitch]]
const SW = [
  [PHTO, [Z1, 0.178, 0.0, 38]],
  [0.32, [-0.47, 0.35, 0.01, 40]],
  [0.40, [-0.40, 0.52, 0.025, 34]],
  [0.48, [-0.20, 0.54, 0.035, 25]],
  [0.56, [0.10, 0.50, 0.035, 18]],
  [0.64, [0.32, 0.44, 0.03, 10]],
  [0.74, [0.42, 0.38, 0.02, 4]],
  [0.86, [0.33, 0.30, 0.0, -6]],
  [0.94, [0.30, 0.21, 0.0, -4]],
  [1.0, [Z0, 0.152, 0.0, -4]],
];
function swing(ph) { // [PHTO,1] aralığında kübik Hermite (uçlar kilitli, hız sürekli: stance sonu hızı geriye)
  let i = 0; while (i < SW.length - 2 && ph > SW[i + 1][0]) i++;
  const n = SW.length;
  const tan = (j) => { const a = SW[Math.max(0, j - 1)], b = SW[Math.min(n - 1, j + 1)]; return b[1].map((v, c) => (v - a[1][c]) / (b[0] - a[0])); };
  const [t0, p0] = SW[i], [t1, p1] = SW[i + 1]; const m0 = tan(i), m1 = tan(i + 1); const h = t1 - t0; const s = (ph - t0) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  return p0.map((v, c) => h00 * v + h10 * h * m0[c] + h01 * p1[c] + h11 * h * m1[c]);
}
function footAt(side, phi) { // side 'Right'|'Left'; döner {z,y,xo,pitch,stance}
  const ph = (((phi + (side === 'Left' ? 0.5 : 0)) % 1) + 1) % 1;
  if (ph <= PHTO) {
    const z = Z0 + (Z1 - Z0) * (ph / PHTO);
    return { z, y: pk1(FOOT_ST_Y, ph), xo: 0, pitch: pk1(FOOT_ST_P, ph), stance: true, ph };
  }
  const [z, y, xo, pitch] = swing(ph); return { z, y, xo, pitch, stance: false, ph };
}
function pk1(keys, x) { let i = 0; while (i < keys.length - 2 && x > keys[i + 1][0]) i++; // ucu düz (monoton) parça: PCHIP benzeri
  const [t0, a] = keys[i], [t1, b] = keys[i + 1]; const s = Math.max(0, Math.min(1, (x - t0) / (t1 - t0)));
  const sm = s * s * (3 - 2 * s); return a + (b - a) * sm; }

// pelvis yüksekliği (rest'e göre), iki adımda bir tekrar eden
const DY = [[0.0, -0.06], [0.13, -0.085], [0.26, -0.06], [0.38, -0.015], [0.50, -0.06], [0.63, -0.085], [0.76, -0.06], [0.88, -0.015]];

// ---------- kol / el yardımcıları ----------
function mkHinge(side) {
  const u0 = restDir(side + 'Arm', side + 'ForeArm'), f0 = restDir(side + 'ForeArm', side + 'Hand');
  const n0 = u0.clone().cross(f0).normalize(); const ang0 = u0.angleTo(f0);
  const test = u0.angleTo(f0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(n0, 0.1)));
  return { u0, f0, n0, ang0, sgn: test > ang0 ? 1 : -1 };
}
const HR = mkHinge('Right'), HL = mkHinge('Left');
const hinge = (H, bend) => new THREE.Quaternion().setFromAxisAngle(H.n0, H.sgn * (rad(bend) - H.ang0));
const elbowAngle = (arm, fore, H) => deg(H.u0.clone().applyQuaternion(arm).angleTo(H.f0.clone().applyQuaternion(fore)));

// katana: bıçak yönü (sağ el rest eksenlerinde), bilek sabit WRIST derece
const prop = st.props?.find((p) => p.id === 'katana');
const pr = prop ? prop.rot : [-25.281, -54.674, -2.581];
const Qp = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(pr[0]), rad(pr[1]), rad(pr[2]), 'XYZ'));
const b0 = V(0, 0, 1).applyQuaternion(Qp).normalize();
const fr0 = restDir('RightForeArm', 'RightHand');
const nW = b0.clone().cross(fr0).normalize();
const Wr = new THREE.Quaternion().setFromAxisAngle(nW, rad(WRIST));
const b1 = b0.clone().applyQuaternion(Wr); // bıçak yönü, önkol rest çerçevesinde (bilek uygulanmış)
const ALPHA = deg(Math.acos(fr0.dot(b1)));

// kol çözücü: üst kol yönü u, dirsek açısı (bend), burulma phi; hedef ölçüt sc(fore)->açı farkı. phi sürekli (≤6°/kare)
const prevPhi = { Left: null, Right: null };
function solveArm(side, H, u, bend, scoreFn, phiPrev) {
  const Ds = new THREE.Quaternion().setFromUnitVectors(H.u0, u); const hg = hinge(H, bend);
  const cands = phiPrev === null ? Array.from({ length: 120 }, (_, i) => -180 + i * 3) : Array.from({ length: 25 }, (_, i) => phiPrev - 6 + i * 0.5);
  let best = null;
  for (const phi of cands) {
    const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(phi)).multiply(Ds); const fore = arm.clone().multiply(hg);
    const sc = scoreFn(fore) + 0.003 * Math.abs(phi);
    if (!best || sc < best.sc) best = { sc, phi, arm, fore };
  }
  return best;
}
const armDir = (flexDeg, abdDeg, sideSign) => { // sideSign: Left +1 (x+), Right -1. flex: aşağıdan öne doğru derece
  const f = rad(flexDeg), a = rad(abdDeg);
  return V(sideSign * Math.sin(a), -Math.cos(f) * Math.cos(a), Math.sin(f) * Math.cos(a)).normalize();
};

// ---------- parmaklar ----------
// avuç yönü: rest'te avuç gövde orta düzlemine bakar. Kıvrım ekseni = parmak yönü × avuç normali.
function handBasis(side) {
  const h = side + 'Hand'; const mid = restDir(h, side + 'HandMiddle1');
  const mf = V(...by[side + 'HandMiddle1'].restP).applyQuaternion(restW[h]).normalize();
  const lat = restPos[side + 'HandPinky1'].clone().sub(restPos[side + 'HandIndex1']).normalize();
  let n = mf.clone().cross(lat).normalize();
  const want = side === 'Right' ? 1 : -1; if (n.x * want < 0) n.negate();
  const axis = mf.clone().cross(n).normalize();
  return { n, axis, mf };
}
const HB = { Left: handBasis('Left'), Right: handBasis('Right') };
const FLIP = process.env.V2_FLIP ? -1 : 1;
function curlRot(side, bone, ang) { ang *= FLIP; // yerel dönüş: rest * R(axis_local, ang)
  const axL = HB[side].axis.clone().applyQuaternion(restW[bone].clone().invert());
  return Q(by[bone].restQ).multiply(new THREE.Quaternion().setFromAxisAngle(axL, rad(ang)));
}
const GRIP = { Index: [72, 92, 52], Middle: [76, 94, 54], Ring: [80, 94, 54], Pinky: [82, 92, 52], Thumb: [34, 40, 26] };
const LOOSE = { Index: [34, 48, 24], Middle: [38, 54, 28], Ring: [44, 58, 28], Pinky: [50, 60, 28], Thumb: [16, 18, 12] };


const RPREV = { x: null }; const SH = { R: new THREE.Vector3() };
function evalRight(a0, abd0, bend0, hint, x) {
  const u = armDir(a0 + x[0], abd0 + x[1], -1); const Ds = new THREE.Quaternion().setFromUnitVectors(HR.u0, u);
  const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(x[3])).multiply(Ds); const fore = arm.clone().multiply(hinge(HR, bend0 + x[2]));
  const err = deg(b1.clone().applyQuaternion(fore).angleTo(hint));
  const el = SH.R.clone().add(u.clone().multiplyScalar(0.259)); const hd = el.clone().add(HR.f0.clone().applyQuaternion(fore).multiplyScalar(0.296));
  return { arm, fore, err, el, hd };
}
function optRight(a0, abd0, bend0, hint, xp) {
  const cost = (x) => { const e = evalRight(a0, abd0, bend0, hint, x).err;
    const hd = evalRight(a0, abd0, bend0, hint, x).hd;
    let c = e + 300 * (Math.max(0, hd.x + 0.27) + Math.max(0, -0.47 - hd.x) + Math.max(0, hd.y - 1.2) + Math.max(0, 0.9 - hd.y) + Math.max(0, -0.02 - hd.z)) + 0.12 * Math.abs(x[0]) + 0.12 * Math.abs(x[1]) + 0.08 * Math.abs(x[2]) + 0.01 * Math.abs(x[3]);
    if (xp) c += 0.6 * (Math.abs(x[0] - xp[0]) + Math.abs(x[1] - xp[1]) + Math.abs(x[2] - xp[2])) + 0.4 * Math.abs(x[3] - xp[3]);
    return c; };
  let best = null;
  const starts = xp ? [xp] : Array.from({ length: 60 }, (_, i) => [0, 0, 0, -180 + i * 6]);
  for (const st0 of starts) { let x = st0.slice(); let c = cost(x); let step = [8, 8, 8, 12];
    for (let it = 0; it < 260; it++) { let imp = false;
      for (let k = 0; k < 4; k++) for (const sg of [1, -1]) { const y = x.slice(); y[k] += sg * step[k]; if (k === 0) y[0] = cl(y[0], -35, 35); if (k === 1) y[1] = cl(y[1], -8, 24); if (k === 2) y[2] = cl(y[2], -25, 22);
        const cy = cost(y); if (cy < c - 1e-9) { x = y; c = cy; imp = true; } }
      if (!imp) { step = step.map((v) => v * 0.6); if (step[0] < 0.05) break; } }
    if (!best || c < best.c) best = { c, x }; }
  const e = evalRight(a0, abd0, bend0, hint, best.x);
  return { arm: e.arm, fore: e.fore, sc: rad(e.err), x: best.x };
}

// ---------- kare çözümü ----------
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const lastLeft = { phi: null }, lastRight = { phi: null };
function solve(f) {
  const phi = f / LEN; const D = {}; const info = {};
  // -- pelvis / gövde (mutlak dünya delta açıları)
  const dy = pk(DY, phi);
  const lat = -0.02 * cs(phi, 0.13);                       // sağ duruşta sağa (−x)
  const pelYaw = P.pelYaw * cs(phi, 0.95), chYaw = -P.chestYaw * cs(phi, 0.95 + 0.04);
  const pelRoll = -P.pelRoll * cs(phi, 0.13);
  const pelPitch = P.lean + 1.4 * cs(2 * phi, 2 * 0.13 + 0.0);
  const ang = {
    pel: [pelYaw, pelPitch, pelRoll],
    s2: [pelYaw + (chYaw - pelYaw) * 0.3, P.lean + 2, pelRoll * 0.3],
    s1: [pelYaw + (chYaw - pelYaw) * 0.65, P.lean + 4, -pelRoll * 0.1],
    ch: [chYaw, P.lean + 5 + 2.5 * cs(2 * phi, 0.13), -pelRoll * 0.5],
    neck: [chYaw * 0.55, P.lean + 1, 0],
    head: [-0.25 * chYaw * 0 + (-chYaw) * 0.25 + 0 * 0, 2 - 20 * dy * 0.4, 0],
  };
  D.Hips = eul(ang.pel); D.Spine02 = eul(ang.s2); D.Spine01 = eul(ang.s1); D.Spine = eul(ang.ch); D.neck = eul(ang.neck); D.Head = eul(ang.head);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(lat, dy, 0));
  // -- bacaklar
  const knees = {}, ankles = {}; let reachErr = 0;
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s, phi);
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    const target = V(sg * (FOOT_X + ft.xo), ft.y, ft.z + restPos.Hips.z);
    const dv = target.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    const [L1, L2] = LL[s]; const dmax = L1 + L2 - 1e-3; if (d > dmax) { reachErr = Math.max(reachErr, d - dmax); d = dmax; }
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.12 * sg, 0, 1); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h));
    const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), knee.clone().sub(hipJ).normalize());
    D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), ankle.clone().sub(knee).normalize());
    const yawF = -sg * 4;                                    // hafif dışa
    D[s + 'Foot'] = eul([yawF, ft.pitch, 0]);
    const toeP = ft.stance ? 0 : ft.pitch * 0.6 * Math.min(1, (ft.ph - PHTO) / 0.08);
    const toeBlend = ft.stance && ft.ph > 0.2 ? 0 : toeP;
    D[s + 'ToeBase'] = eul([yawF, toeBlend, 0]);
    knees[s] = knee; ankles[s] = ankle; info[s + 'Foot'] = { ...ft, hipJ, d };
  }
  { const chain = ['Hips', 'Spine02', 'Spine01', 'Spine', 'RightShoulder', 'RightArm']; let q = Q(by.Armature.restQ).clone(); let p = hipsPos.clone(); let qq = null;
    // Hips'ten RightArm'a FK (kol hariç D; Shoulder D'siz = rest yerel)
    const cu = {}; for (const b of bones) { if (!b.parent) { cu[b.name] = Q(b.restQ); continue; } const par = cu[b.parent]; cu[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : par.clone().multiply(Q(b.restQ)); }
    let pp = hipsPos.clone(); for (let i = 1; i < chain.length; i++) pp = pp.clone().add(V(...by[chain[i]].restP).applyQuaternion(cu[by[chain[i]].parent])); SH.R = pp; }
  // -- sağ kol (katana): üst kol yönü + dirsek, burulma bıçak ipucuna göre
  const sL = cs(phi, P.armLagL), sR = -cs(phi, 0.0 + P.armLagR);        // sL: sol kol öne (+1); sR: sağ kol öne (+1)
  const sRn = (sR + 1) / 2, sLn = (sL + 1) / 2;
  const R_a = P.RbackA + (P.RfwdA - P.RbackA) * sRn, R_abd = 16 + 4 * (1 - sRn);
  const R_bend = P.RbendB + (P.RbendF - P.RbendB) * sRn;
  // bıçak ipucu: bıçak, önkolla sabit ALPHA açı yapar; koniye en yakın yön, omuz/dirsek hafifçe oynayarak aranır
  const planeD = V(-0.55, -0.83, 0).normalize(), zF = V(0, 0, 1);
  const hintB = V(...P.hintB).lerp(V(...P.hintF), sRn).normalize();
  const rr = optRight(R_a, R_abd, R_bend, hintB, RPREV.x);
  RPREV.x = rr.x;
  D.RightArm = rr.arm; D.RightForeArm = rr.fore; D.RightHand = rr.fore.clone().multiply(Wr);
  info.bladeDir = b1.clone().applyQuaternion(rr.fore); info.bladeErr = deg(rr.sc); info.Rphi = rr.x[3]; info.Rx = rr.x;
  info.relbow = elbowAngle(rr.arm, rr.fore, HR);
  // -- sol kol: serbest, kınlı kalçadan uzak; öne daha çok, geriye sınırlı
  const L_a = P.LbackA + (P.LfwdA - P.LbackA) * sLn, L_abd = 22 + 10 * (1 - sLn);
  const L_bend = P.LbendB + (P.LbendF - P.LbendB) * sLn;
  const uL = armDir(L_a, L_abd, +1);
  const psi = L_a + L_bend; const fh = V(-0.16, -Math.cos(rad(psi)), Math.sin(rad(psi))).normalize();
  const ll = solveArm('Left', HL, uL, L_bend, (fore) => HL.f0.clone().applyQuaternion(fore).angleTo(fh), lastLeft.phi);
  lastLeft.phi = ll.phi;
  D.LeftArm = ll.arm; D.LeftForeArm = ll.fore; D.LeftHand = ll.fore.clone().multiply(Rx(0));
  info.lbend = elbowAngle(ll.arm, ll.fore, HL); info.Lphi = ll.phi; info.Lerr = deg(ll.sc);
  // -- yerel dönüşler ve konumlar
  const cur = {}, out = {}, pos = {};
  for (const b of bones) {
    if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
    const par = cur[b.parent]; let local;
    if (D[b.name]) { cur[b.name] = D[b.name].clone().multiply(restW[b.name]); local = par.clone().invert().multiply(cur[b.name]); }
    else { local = Q(b.restQ); cur[b.name] = par.clone().multiply(local); }
    out[b.name] = local;
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent]));
  }
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], D, pos, info, phi, knees, ankles, reachErr, hipsPos, ang };
}

// ---------- çalıştır ----------
let frames = Array.from({ length: LEN }, (_, f) => solve(f));
// döngü kapanışı: 2. geçiş, 1. geçişin son karesinden başlar
{ RPREV.x = frames[LEN - 1].info.Rx; lastLeft.phi = frames[LEN - 1].info.Lphi; frames = Array.from({ length: LEN }, (_, f) => solve(f)); }
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  for (const [n, q] of Object.entries(frames[f].out)) {
    if (n === 'Armature') continue;
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  (tracks.Hips.pos ||= []).push([f, ...frames[f].hipsLocal]);
}
// parmaklar: sağ el kabza tutuşu (sabit), sol el gevşek yumruk (hafif ikincil: kol hızına bağlı küçük salınım)
const hv = frames.map((fr, f) => fr.pos.LeftHand.distanceTo(frames[(f + LEN - 1) % LEN].pos.LeftHand));
const vmax = Math.max(...hv) || 1;
for (const side of ['Left', 'Right']) {
  for (const kind of ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']) {
    for (let j = 1; j <= 3; j++) {
      const bn = `${side}Hand${kind}${j}`; if (!by[bn]) continue;
      const base = (side === 'Right' ? GRIP : LOOSE)[kind][j - 1];
      tracks[bn] = { rot: frames.map((fr, f) => {
        const sec = side === 'Left' ? -4 * (hv[f] / vmax - 0.5) * (kind === 'Thumb' ? 0.3 : 1) * (j === 1 ? 0.6 : 1) : 0;
        const q = curlRot(side, bn, base + sec); return [f, q.x, q.y, q.z, q.w];
      }) };
    }
  }
}
// ---------- ölçümler ----------
const rep = {};
// bilek (sağ): sabit WRIST; fleksiyon/sapma ayrımı avuç ekseni ile
{ const ax = nW.clone(); const flex = WRIST * Math.abs(ax.dot(HB.Right.axis)), dev = WRIST * Math.abs(ax.dot(HB.Right.n));
  rep.wristRight = { total: WRIST, flexApprox: +flex.toFixed(1), devApprox: +dev.toFixed(1), other: +Math.sqrt(Math.max(0, WRIST * WRIST - flex * flex - dev * dev)).toFixed(1) };
  rep.wristLeft = { total: 0 }; }
rep.alpha = +ALPHA.toFixed(1);
rep.reachErrMax_mm = +(Math.max(...frames.map((x) => x.reachErr)) * 1000).toFixed(2);
rep.elbowR = [Math.min(...frames.map((x) => x.info.relbow)), Math.max(...frames.map((x) => x.info.relbow))].map((v) => +v.toFixed(1));
rep.elbowL = [Math.min(...frames.map((x) => x.info.lbend)), Math.max(...frames.map((x) => x.info.lbend))].map((v) => +v.toFixed(1));
rep.bladeErrMax = +Math.max(...frames.map((x) => x.info.bladeErr)).toFixed(1);
rep.Lerr = +Math.max(...frames.map((x) => x.info.Lerr)).toFixed(1);
// temas: ayak bileği dünya konumu (stance) sabit mi (z hızı = -rate)
{ const rate = (Z1 - Z0) / (PHTO * LEN); // m/kare
  const T = LEN / FPS; const vLock = -(Z1 - Z0) / (PHTO * T);
  rep.lockSpeed_mps = +vLock.toFixed(2); rep.stepsPerMin = +(120 / T).toFixed(0); rep.stanceFrames = Math.round(PHTO * LEN);
  // kayma ölçümü: temas karelerinde ayak bileği IK sonucu (dünya) - hedef: pelvis hareketsiz, hedef z lineer; gerçek ayak z = hedef; gerçek kayma = clamped fark
  const sl = []; for (const [s] of [['Left'], ['Right']]) for (let f = 0; f < LEN; f++) { const fi = frames[f].info[s + 'Foot']; if (!fi.stance) continue; const a = frames[f].ankles[s];
    const want = V(0, 0, 0); sl.push(Math.abs(a.z - (fi.z + restPos.Hips.z)) ); }
  rep.slideMax_cm = +(Math.max(...sl) * 100).toFixed(2); }
// kareler arası dönüş hızları (dikiş dahil)
const mx = {}; for (let i = 0; i < LEN; i++) { const a = frames[i], b = frames[(i + 1) % LEN]; for (const n of Object.keys(a.out)) { if (n === 'Armature') continue; const d = deg(2 * Math.acos(Math.min(1, Math.abs(a.out[n].dot(b.out[n]))))); mx[n] = Math.max(mx[n] || 0, d); } }
rep.maxStep = Object.fromEntries(Object.entries(mx).filter(([n, v]) => v > 14).map(([n, v]) => [n, +v.toFixed(1)]));
// gövde/kol/bıçak mesafeleri
function distSeg(p, a, b) { const ab = b.clone().sub(a); const t = cl(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return p.distanceTo(a.clone().add(ab.multiplyScalar(t))); }
const sp = st.props.find((p) => p.id === 'scabbard');
const clr = { blade_thigh: 9, blade_shin: 9, hand_body: 9, elbow_body: 9, Lhand_scab: 9, Lelbow_scab: 9, Rhand_thigh: 9 }; const where = {};
const upd = (k, v, f) => { if (v < clr[k]) { clr[k] = v; where[k] = f; } };
for (let f = 0; f < LEN; f++) {
  const fr = frames[f]; const { pos, knees, ankles, D } = fr;
  const hipJ = (s) => fr.info[s + 'Foot'].hipJ;
  const bd = fr.info.bladeDir; const hand = pos.RightHand;
  for (let s = -0.08; s <= 0.95; s += 0.05) { const pt = hand.clone().add(bd.clone().multiplyScalar(s));
    for (const sd of ['Left', 'Right']) { upd('blade_thigh', distSeg(pt, hipJ(sd), knees[sd]) - 0.085, f); upd('blade_shin', distSeg(pt, knees[sd], ankles[sd]) - 0.06, f); }
    upd('blade_ground', pt.y, f); }
  // gövde eliptik silindir (Spine02 çerçevesi)
  const upF = D.Spine01.clone().invert(), loF = D.Hips.clone().invert();
  const chk = (key, pt, r) => { let best = 9;
    let l = pt.clone().sub(pos.Spine02).applyQuaternion(upF); if (l.y > -0.02 && l.y < 0.5) best = Math.min(best, (Math.hypot(l.x / (0.18 + r), l.z / (0.14 + r)) - 1) * 0.17);
    l = pt.clone().sub(pos.Hips).applyQuaternion(loF); if (l.y > -0.55 && l.y < 0.12) best = Math.min(best, (Math.hypot(l.x / (0.24 + r), l.z / (0.18 + r)) - 1) * 0.2);
    upd(key, best, f); };
  chk('hand_body', pos.RightHand, 0.05); chk('hand_body', pos.LeftHand, 0.05); chk('elbow_body', pos.RightForeArm, 0.06); chk('elbow_body', pos.LeftForeArm, 0.06);
  for (const t of [0.4, 0.7]) { chk('elbow_body', pos.RightArm.clone().lerp(pos.RightForeArm, t), 0.055); chk('elbow_body', pos.LeftArm.clone().lerp(pos.LeftForeArm, t), 0.055); }
  // sağ el/önkol - uyluk
  for (const sd of ['Left', 'Right']) upd('Rhand_thigh', distSeg(pos.RightHand, hipJ(sd), knees[sd]) - 0.1, f);
  // kın (sol kalça): hips çerçevesinde segment
  if (sp) { const sc = sp.scale; const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(sp.rot[0]), rad(sp.rot[1]), rad(sp.rot[2]), 'XYZ'));
    const dirS = V(0, 0, 1).applyQuaternion(q).applyQuaternion(D.Hips); const c = pos.Hips.clone().add(V(...sp.pos).applyQuaternion(D.Hips));
    const A = c.clone().add(dirS.clone().multiplyScalar(-0.4 * sc)), B = c.clone().add(dirS.clone().multiplyScalar(0.4 * sc));
    upd('Lhand_scab', distSeg(pos.LeftHand, A, B) - 0.07, f); upd('Lelbow_scab', distSeg(pos.LeftForeArm, A, B) - 0.06, f); }
}
rep.clearance_m = Object.fromEntries(Object.entries(clr).map(([k, v]) => [k, +v.toFixed(3)])); rep.clearance_frame = where;
rep.handsRange = { Ry: [Math.min(...frames.map((x) => x.pos.RightHand.y)), Math.max(...frames.map((x) => x.pos.RightHand.y))].map((v) => +v.toFixed(2)),
  Rz: [Math.min(...frames.map((x) => x.pos.RightHand.z)), Math.max(...frames.map((x) => x.pos.RightHand.z))].map((v) => +v.toFixed(2)),
  Ly: [Math.min(...frames.map((x) => x.pos.LeftHand.y)), Math.max(...frames.map((x) => x.pos.LeftHand.y))].map((v) => +v.toFixed(2)),
  Lz: [Math.min(...frames.map((x) => x.pos.LeftHand.z)), Math.max(...frames.map((x) => x.pos.LeftHand.z))].map((v) => +v.toFixed(2)) };
console.log(JSON.stringify(rep, null, 1));
const anim = { name: 'v2_katana_run', fps: FPS, length: LEN, loop: true, tracks };
fs.writeFileSync(OUT, JSON.stringify(anim));
console.log('yazıldı', OUT, Object.keys(tracks).length, 'track');
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log(r);
  const s = await (await fetch(BASE + '/api/animations/save?name=' + anim.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', s);
}
if (process.env.V2_DEBUG) {
  for (let f = 0; f < LEN; f += 4) { const i = frames[f].info; console.log(f, 'err', i.bladeErr?.toFixed?.(1), 'x', i.Rx.map((v) => v.toFixed(0)).join(','), 'blade', i.bladeDir.toArray().map((v) => v.toFixed(2)).join(','), 'hand', frames[f].pos.RightHand.toArray().map((v) => v.toFixed(2)).join(','), 'elbow', frames[f].pos.RightForeArm.toArray().map((v) => v.toFixed(2)).join(',')); }
  // fizibilite: hedef bıçak yönü (−0.4,−0.88,−0.2) için brute force
  const hint = V(-0.4, -0.88, -0.2).normalize(); let best = 999, bx = null;
  for (let a = -35; a <= 35; a += 5) for (let ab = -14; ab <= 24; ab += 6) for (let be = 40; be <= 120; be += 8) for (let ph = -180; ph < 180; ph += 6) {
    const e = evalRight(0, 16, 0, hint, [a, ab, be - 0, ph]); if (e.err < best) { best = e.err; bx = [a, ab, be, ph]; } }
  console.log('brute best err', best.toFixed(1), bx);
}
if (process.env.V2_FEAS) {
  const res = [];
  for (let a = -30; a <= 30; a += 6) for (let ab = 8; ab <= 28; ab += 5) for (let be = 60; be <= 110; be += 10) for (let ph = -180; ph < 180; ph += 5) {
    const u = armDir(a, ab, -1); const Ds = new THREE.Quaternion().setFromUnitVectors(HR.u0, u);
    const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(ph)).multiply(Ds); const fore = arm.clone().multiply(hinge(HR, be));
    const bl = b1.clone().applyQuaternion(fore); const fd = HR.f0.clone().applyQuaternion(fore);
    // elbow-hand position
    const el = V(-0.192, 1.5, 0.064).add(u.clone().multiplyScalar(0.259)); const hd = el.clone().add(fd.clone().multiplyScalar(0.296));
    if (hd.x > -0.27 || hd.y > 1.2 || hd.y < 0.85 || hd.z < -0.05) continue; // el: dışarıda, kalça-göğüs arası
    res.push({ bl, a, ab, be, ph, hd });
  }
  console.log('reachable blades', res.length);
  const grid = {}; for (const r of res) { const k = [Math.round(r.bl.x * 4) / 4, Math.round(r.bl.y * 4) / 4, Math.round(r.bl.z * 4) / 4].join(','); grid[k] = (grid[k] || 0) + 1; }
  console.log(Object.entries(grid).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => k + ':' + n).join('  '));
}
if (process.env.V2_REACH) console.log(frames.map((x, f) => x.reachErr > 0.0005 ? f + ':' + (x.reachErr * 1000).toFixed(0) : '').filter(Boolean).join(' '));
if (process.env.V2_FING) {
  for (const side of ['Right', 'Left']) { const hb = HB[side]; const piv = restPos[side + 'HandIndex1'], tip = restPos[side + 'HandIndex3'], hand = restPos[side + 'Hand'];
    const R = new THREE.Quaternion().setFromAxisAngle(hb.axis, rad(60)); const nt = piv.clone().add(tip.clone().sub(piv).applyQuaternion(R));
    console.log(side, 'n', hb.n.toArray().map((v) => v.toFixed(2)).join(','), 'axis', hb.axis.toArray().map((v) => v.toFixed(2)).join(','), 'palmDot before', tip.clone().sub(hand).dot(hb.n).toFixed(3), 'after', nt.clone().sub(hand).dot(hb.n).toFixed(3), 'tip->hand dist', tip.distanceTo(hand).toFixed(3), nt.distanceTo(hand).toFixed(3));
    const pDir = V(...by[side + 'HandMiddle1'].restP); console.log(' localAxis', HB[side].axis.clone().applyQuaternion(restW[side + 'HandIndex1'].clone().invert()).toArray().map((v) => v.toFixed(2)).join(',')); }
}
{ // zemin: top eklemi (ball) ve ayak bileği yüksekliği; temasta ayak bileği dünya sabit mi (z kayması IK sonrası)
  let minToe = 9, minAnk = 9; const stanceZ = { Left: [], Right: [] };
  for (let f = 0; f < LEN; f++) for (const s of ['Left', 'Right']) { const p = frames[f].pos[s + 'ToeBase']; minToe = Math.min(minToe, p.y); minAnk = Math.min(minAnk, frames[f].pos[s + 'Foot'].y);
    const fi = frames[f].info[s + 'Foot']; if (fi.stance) stanceZ[s].push([f, frames[f].pos[s + 'Foot'].z, frames[f].pos[s + 'Foot'].y, p.y]); }
  console.log('minToeBallY', minToe.toFixed(3), 'minAnkleY', minAnk.toFixed(3));
  // temas kayması: stance ayak bileği z hızı = -lockSpeed (pelvis sabit) => dünya hızı 0. Pelvis x/z sabit olduğundan: z(f+1)-z(f) = -rate
  const rate = (Z1 - Z0) / (PHTO * LEN);
  for (const s of ['Left', 'Right']) { const a = stanceZ[s]; let e = 0; for (let i = 1; i < a.length; i++) e = Math.max(e, Math.abs((a[i][1] - a[i - 1][1]) - rate)); console.log(s, 'temas kare', a.length, 'z hız sapması mm/kare', (e * 1000).toFixed(2), 'topuk? ball y min/max', Math.min(...a.map((x) => x[3])).toFixed(3), Math.max(...a.map((x) => x[3])).toFixed(3)); }
}
