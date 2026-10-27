// game_death üretici: darbe → sendeleme → dizlerin üstüne çöküş (katana elden kayar) → kısa asılı kalış → öne yığılma
// (dizler pivot, ters sarkaç zamanlaması) → yerde durağan. 96 kare @60 = 1,6 sn.
// Kullanım: node death.mjs <port> [--nosend]
// Çıktılar: game_death (Unity'ye giden klip) + preview_death (aynı gövde; katana Armature'a takılı, Armature katananın
// düşüşünü taşır, Hips bunu telafi eder → editörde katananın elden düşüşü görünür). Katana düşüşü oyunda kodla yapılır;
// bırakma karesi, ilk hız ve yerdeki son pozu konsola ve animations/game_death_katana.json'a yazılır.
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const ARGS = process.argv.slice(2);
const PORT = ARGS.find((a) => /^\d+$/.test(a)); if (!PORT) { console.error('port gerekli: node death.mjs <port>'); process.exit(1); }
const BASE = 'http://127.0.0.1:' + PORT; const NOSEND = ARGS.includes('--nosend');
const st = await (await fetch(BASE + '/api/state')).json();
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (a) => new THREE.Quaternion(...a);
const Rx = (d) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rad(d));
const Ry = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rad(d));
const Rz = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rad(d));
const eul = (e) => Ry(e[0]).multiply(Rx(e[1])).multiply(Rz(e[2])); // yaw, pitch(+ öne), roll(+ sağa)
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

const LEN = 96, FPS = 60;
const restW = {}, restPos = {};
for (const b of bones) {
  const q = Q(b.restQ);
  if (!b.parent) { restW[b.name] = q; restPos[b.name] = V(...b.restP); }
  else { restW[b.name] = restW[b.parent].clone().multiply(q); restPos[b.name] = restPos[b.parent].clone().add(V(...b.restP).applyQuaternion(restW[b.parent])); }
}
const armQ = Q(by.Armature.restQ);
const restDir = (bone, child) => V(...by[child].restP).applyQuaternion(restW[bone]).normalize();

// ---- idle (game_katana_idle kare 0): başlangıç pozu
const IDLE = JSON.parse(fs.readFileSync('C:/AnimRef/animations/game_katana_idle.json', 'utf8'));
const idleLocal = {}, idleCur = {}, idlePos = {}, Di = {};
for (const b of bones) {
  const t = IDLE.tracks[b.name];
  const lq = t?.rot?.length ? Q(t.rot[0].slice(1)) : Q(b.restQ); const lp = t?.pos?.length ? V(...t.pos[0].slice(1)) : V(...b.restP);
  idleLocal[b.name] = lq;
  if (!b.parent) { idleCur[b.name] = lq; idlePos[b.name] = lp; }
  else { idleCur[b.name] = idleCur[b.parent].clone().multiply(lq); idlePos[b.name] = idlePos[b.parent].clone().add(lp.clone().applyQuaternion(idleCur[b.parent])); }
  Di[b.name] = idleCur[b.name].clone().multiply(restW[b.name].clone().invert());
}
const idleHipsLocal = IDLE.tracks.Hips.pos[0].slice(1);
const relIdle = (n) => Di[by[n].parent].clone().invert().multiply(Di[n]);

// ---- eğri yardımcısı (Hermite / Catmull-Rom, L1 üreticisinden)
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; if (f <= keys[0][0]) return keys[0][1]; if (f >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (j === 0 || j === n - 1) return Pj.map(() => 0);
    const a = asArr(keys[j - 1][1]), b = asArr(keys[j + 1][1]);
    return Pj.map((_, c) => (b[c] - a[c]) / (keys[j + 1][0] - keys[j - 1][0])); };
  const m0 = tan(i), m1 = tan(i + 1); const h = t1 - t0; const s = Math.max(0, Math.min(1, (f - t0) / h));
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  const r = A.map((a, c) => h00 * a + h10 * h * m0[c] + h01 * B[c] + h11 * h * m1[c]);
  return arr ? r : r[0];
}
function frame(a, b) { const x = a.clone().normalize(); const z = x.clone().cross(b).normalize(); const y = z.clone().cross(x); return new THREE.Matrix4().makeBasis(x, y, z); }
const qFrame = (a, b) => new THREE.Quaternion().setFromRotationMatrix(frame(a, b));

// =================== ZAMANLAMA ===================
const T = { hit: 5, stag: 14, buckle: 20, kneeL: 31, kneeR: 34, release: 29, hang: 40, toppleStart: 47, impact: 74, end: 88 };
// devrilme: dizler pivotlu ters sarkaç; θ0 ikiye bölmeyle impact karesine oturtulur
const PEND = (() => {
  const g = 9.81, L = 0.62, th1 = rad(84), N = T.impact - T.toppleStart, dt = 1 / FPS / 20;
  const run = (th0) => { let th = th0, w = 0.25; const out = [th]; for (let f = 0; f < N; f++) { for (let k = 0; k < 20; k++) { w += (g / L) * Math.sin(th) * dt; th += w * dt; } out.push(th); } return out; };
  let lo = rad(0.5), hi = rad(30);
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (run(m)[N] > th1) hi = m; else lo = m; }
  const r = run((lo + hi) / 2); return r.map((t) => (t - r[0]) / (r[N] - r[0]));
})();
function topple(f) { // 0..1 ilerleme, çarpmadan sonra küçük sekme
  if (f <= T.toppleStart) return 0;
  if (f <= T.impact) { const x = f - T.toppleStart, i = Math.floor(x); return i >= PEND.length - 1 ? 1 : lerp(PEND[i], PEND[i + 1], x - i); }
  const t = f - T.impact;
  return 1 - 0.045 * Math.exp(-t / 5) * Math.abs(Math.sin(Math.PI * t / 7));
}

// =================== POZ ANAHTARLARI ===================
// kalça dünya dönüşü (idle üstüne): [yaw, pitch, roll]
const HIPROT = [[0, [0, 0, 0]], [T.hit, [-7, -11, 3]], [T.stag, [-9, -4, 1]], [T.buckle, [-5, 8, -2]], [T.kneeL, [-3, 14, -4]], [T.kneeR, [-2, 12, -3]],
  [T.hang, [-3, 9, -4]], [T.toppleStart, [-4, 13, -5]]];
const HIPROT_PRONE = [-11, 89, -9];
// omurga (gövde çerçevesinde, idle göreli): s2, s1, ch, neck, head
const SP = {
  s2: [[0, [0, 0, 0]], [T.hit, [-3, -5, 2]], [T.stag, [-2, 6, 0]], [T.buckle, [0, 9, -1]], [T.kneeR, [0, 13, -2]], [T.hang, [1, 12, -1]], [T.toppleStart, [1, 13, -1]]],
  s1: [[0, [0, 0, 0]], [T.hit, [-3, -6, 2]], [T.stag, [-2, 8, 0]], [T.buckle, [0, 11, -1]], [T.kneeR, [0, 15, -2]], [T.hang, [1, 14, -1]], [T.toppleStart, [1, 15, -1]]],
  ch: [[0, [0, 0, 0]], [T.hit, [-2, -6, 1]], [T.stag, [-1, 8, 0]], [T.buckle, [0, 10, 0]], [T.kneeR, [0, 13, -1]], [T.hang, [0, 12, 0]], [T.toppleStart, [0, 12, 0]]],
  neck: [[0, [0, 0, 0]], [T.hit, [2, -14, 0]], [T.stag, [0, 10, 0]], [T.buckle, [0, 14, 0]], [T.kneeR, [0, 15, 0]], [T.hang, [0, 16, 1]], [T.toppleStart, [-2, 15, 1]]],
  head: [[0, [0, 0, 0]], [T.hit + 1, [3, -18, 2]], [T.stag, [0, 12, 0]], [T.buckle, [0, 14, 0]], [T.kneeR + 2, [0, 16, 1]], [T.hang, [-2, 15, 2]], [T.toppleStart, [-3, 14, 2]]],
};
const SP_PRONE = { s2: [-2, 3, -1], s1: [-3, 4, -1], ch: [-3, 4, 0], neck: [-35, 14, 4], head: [-40, 10, 8] };
// kafa çarpmada geç kalır: devrilme ilerlemesi baş için gecikmeli
const LAG = { s2: 0, s1: 0.6, ch: 1.2, neck: 2.2, head: 3 };
// kalça (dünya) idle'a göre ofset, ayakta faz
const HPOS = [[0, [0, 0, 0]], [T.hit, [0.005, -0.012, -0.045]], [T.stag, [0.01, -0.05, -0.075]], [T.buckle, [0.01, -0.12, -0.04]]];
// ayak tabanı (top) ankrajları ve topuk kaldırma (°)
const BALL = {
  Left: [[0, [0, 0, 0]], [T.buckle, [0, 0, 0]], [T.kneeL, [0.01, 0, -0.16]]],
  Right: [[0, [0, 0, 0]], [T.hit, [0, 0, 0]], [T.hit + 4, [-0.01, 0.05, -0.05]], [T.stag, [-0.02, 0, -0.09]], [T.buckle, [-0.02, 0, -0.09]], [T.kneeR, [-0.03, 0, -0.1]]],
};
const HEEL = { Left: [[0, 0], [T.buckle - 3, 2], [T.kneeL - 4, 38], [T.kneeL, 52], [T.hang, 50]], Right: [[0, 0], [T.hit + 2, 10], [T.hit + 5, 0], [T.stag, 0], [T.buckle, 4], [T.kneeR - 4, 40], [T.kneeR, 54], [T.hang, 52]] };
let PHI_LAND = -24, LAND_OFF = V(0, 0, 0); const PHI_HANG = -30, PHI_PRONE = 76; // uyluk açısı (dikeyden, + = kalça dizin önünde)
const R_KNEE = 0.055;

// =================== BACAK ===================
const LEG = {};
for (const s of ['Left', 'Right']) {
  LEG[s] = {
    L1: V(...by[s + 'Leg'].restP).length(), L2: V(...by[s + 'Foot'].restP).length(),
    t0: restDir(s + 'UpLeg', s + 'Leg'), s0: restDir(s + 'Leg', s + 'Foot'),
    hipOff: restPos[s + 'UpLeg'].clone().sub(restPos.Hips),
    ball0: idlePos[s + 'ToeBase'].clone(),
    ankVec: restPos[s + 'Foot'].clone().sub(restPos[s + 'ToeBase']),
    yaw0: (() => { const v = V(0, 0, 1).applyQuaternion(Di[s + 'Foot']); return deg(Math.atan2(v.x, v.z)); })(),
    side: s === 'Left' ? 1 : -1,
  };
  const L = LEG[s]; L.n0 = L.t0.clone().cross(V(0, 0, -1)).normalize();
}
function footD(s, f) { const L = LEG[s]; const a = spl(HEEL[s], f); return Ry(L.yaw0).multiply(Rx(a)).multiply(Ry(-L.yaw0)).multiply(Di[s + 'Foot']); }
function ankleAt(s, f) { const L = LEG[s]; const B = L.ball0.clone().add(V(...spl(BALL[s], f))); return { B, A: B.clone().add(L.ankVec.clone().applyQuaternion(footD(s, f))) }; }
function legIK(s, H, Dh, A) {
  const L = LEG[s]; const hj = H.clone().add(L.hipOff.clone().applyQuaternion(Dh));
  const v = A.clone().sub(hj); let d = v.length(); const dir = v.clone().normalize(); const gap = Math.max(0, d - (L.L1 + L.L2));
  d = Math.min(Math.max(d, Math.abs(L.L1 - L.L2) + 1e-3), L.L1 + L.L2 - 1e-4);
  const a = (L.L1 * L.L1 - L.L2 * L.L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L.L1 * L.L1 - a * a));
  const pole = V(0.12 * L.side, 0, 1).applyQuaternion(Dh); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
  const K = hj.clone().add(dir.clone().multiplyScalar(a)).add(pole.clone().multiplyScalar(h));
  const An = hj.clone().add(dir.clone().multiplyScalar(d));
  return { hj, K, A: An, gap, pole };
}

// =================== KOL ===================
const ARM = {};
for (const s of ['Left', 'Right']) {
  const u0 = restDir(s + 'Arm', s + 'ForeArm'), f0 = restDir(s + 'ForeArm', s + 'Hand');
  ARM[s] = { u0, f0, n0: u0.clone().cross(f0).normalize(), L1: V(...by[s + 'ForeArm'].restP).length(), L2: V(...by[s + 'Hand'].restP).length(),
    W0: Di[s + 'ForeArm'].clone().invert().multiply(Di[s + 'Hand']) };
}
function armIK(s, S, T_, poleW) {
  const A = ARM[s]; const v = T_.clone().sub(S); let d = v.length(); const dir = v.clone().normalize();
  const reach = A.L1 + A.L2; const gap = Math.max(0, d - reach);
  d = Math.min(Math.max(d, Math.abs(A.L1 - A.L2) + 0.05), reach * 0.995);
  const a = (A.L1 * A.L1 - A.L2 * A.L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, A.L1 * A.L1 - a * a));
  const pole = poleW.clone().sub(dir.clone().multiplyScalar(poleW.dot(dir))).normalize();
  const E = S.clone().add(dir.clone().multiplyScalar(a)).add(pole.clone().multiplyScalar(h)); const H = S.clone().add(dir.clone().multiplyScalar(d));
  const u = E.clone().sub(S).normalize(), fd = H.clone().sub(E).normalize();
  let n = u.clone().cross(fd); if (n.length() < 0.05) n = u.clone().cross(pole).negate(); n.normalize();
  // dinlenme dirsek düzlemi normalinin yönü: n0 = u0×f0 (dirsek dışa); aynı yönü koru
  const Darm = qFrame(u, n).multiply(qFrame(A.u0, A.n0).invert());
  const Dfore = qFrame(fd, n).multiply(qFrame(A.f0, A.n0).invert());
  return { Darm, Dfore, E, H, gap, bend: deg(u.angleTo(fd)) };
}

// =================== KÜÇÜK ÇÖZÜCÜ (kalça konumu) ===================
function solve3(fn, x0) { // Levenberg-Marquardt, 3 bilinmeyen
  let x = x0.clone(); let lam = 1e-3;
  const cost = (r) => r.reduce((s, v) => s + v * v, 0);
  for (let it = 0; it < 25; it++) {
    const r = fn(x); const J = [];
    for (let k = 0; k < 3; k++) { const e = 1e-5; const xp = x.clone(); xp.setComponent(k, xp.getComponent(k) + e); const rp = fn(xp); J.push(rp.map((v, i) => (v - r[i]) / e)); }
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
    for (let i = 0; i < r.length; i++) for (let a = 0; a < 3; a++) { g[a] += J[a][i] * r[i]; for (let b = 0; b < 3; b++) A[a][b] += J[a][i] * J[b][i]; }
    for (let a = 0; a < 3; a++) A[a][a] *= 1 + lam;
    const M = new THREE.Matrix3().set(...A.flat()); const det = M.determinant(); if (Math.abs(det) < 1e-14) break;
    const dx = V(...g).applyMatrix3(M.invert()).negate(); const xn = x.clone().add(dx);
    if (cost(fn(xn)) < cost(r)) { x = xn; lam *= 0.3; } else lam *= 10;
    if (dx.length() < 1e-7) break;
  }
  return x;
}

// =================== KARE ÇÖZÜMÜ ===================
const kneeAnchor = { Left: null, Right: null };
const handState = { Left: null, Right: null };
const FINAL_HAND = { Left: V(0.3, 0.035, 0.5), Right: V(-0.42, 0.035, 0.62) };
const IDLE_H = idlePos.Hips.clone();
const results = [];

function hipRotAt(f) { const s = topple(f); const base = spl(HIPROT, Math.min(f, T.toppleStart)); return f <= T.toppleStart ? base : lerpA(base, HIPROT_PRONE, s); }
function spineAt(k, f) { const s = topple(f - (LAG[k] || 0)); const base = spl(SP[k], Math.min(f, T.toppleStart)); return f <= T.toppleStart ? base : lerpA(base, SP_PRONE[k], Math.min(1.08, s)); }
function phiAt(f) {
  if (f <= T.kneeR) return PHI_LAND;
  if (f <= T.toppleStart) { const t = (f - T.kneeR) / (T.toppleStart - T.kneeR); return lerp(PHI_LAND, PHI_HANG, smooth(t * 1.6)) + 3 * Math.sin(Math.PI * t) * (1 - t); }
  return lerp(PHI_HANG, PHI_PRONE, topple(f));
}

function solveFrame(f) {
  const D = {};
  D.Hips = eul(hipRotAt(f)).multiply(Di.Hips);
  // ayak / ayak bileği hedefleri
  const ank = { Left: ankleAt('Left', f), Right: ankleAt('Right', f) };
  // diz ankrajı ağırlığı (her bacak kendi iniş karesinde ankrajlanır)
  const landF = { Left: T.kneeL, Right: T.kneeR };
  // kalça anahtarı
  let Hkey;
  const kneelW = (s) => (f >= landF[s] ? 1 : 0);
  if (f <= T.buckle) Hkey = IDLE_H.clone().add(V(...spl(HPOS, f)));
  else {
    // çöküş: kalça hızlanarak iner; diz yere değene kadar
    const t = (f - T.buckle) / (T.kneeR + 2 - T.buckle);
    const Hb = IDLE_H.clone().add(V(...spl(HPOS, T.buckle)));
    const drop = Math.min(1, t * t * 1.05);
    Hkey = Hb.clone().add(V(-0.005, -0.62 * drop, 0.33 * smooth(t)));
    if (kneeAnchor.Left && kneeAnchor.Right) {
      const mid = kneeAnchor.Left.clone().add(kneeAnchor.Right).multiplyScalar(0.5);
      const ph = rad(phiAt(f)); const hjMid = LEG.Left.hipOff.clone().add(LEG.Right.hipOff).multiplyScalar(0.5).applyQuaternion(D.Hips);
      Hkey = mid.clone().add(V(0, LEG.Left.L1 * Math.cos(ph), LEG.Left.L1 * Math.sin(ph))).sub(hjMid);
    }
  }
  let H = Hkey.clone();
  const both = kneeAnchor.Left && kneeAnchor.Right && f > T.kneeR;
  if (both) {
    // dizler sabit: kalça eklemleri orta noktası = diz ortası + L1·(0, cos φ, sin φ) (+ iniş anındaki ofsetin sönen kalıntısı)
    const mid = kneeAnchor.Left.clone().add(kneeAnchor.Right).multiplyScalar(0.5);
    const ph = rad(phiAt(f)); const O = V(0, LEG.Left.L1 * Math.cos(ph), LEG.Left.L1 * Math.sin(ph));
    O.add(LAND_OFF.clone().multiplyScalar(Math.exp(-(f - T.kneeR) / 10)));
    const hjMid = LEG.Left.hipOff.clone().add(LEG.Right.hipOff).multiplyScalar(0.5).applyQuaternion(D.Hips);
    H = mid.clone().add(O).sub(hjMid);
  } else if (kneeAnchor.Left || kneeAnchor.Right) {
    H = solve3((x) => {
      const r = [];
      for (const s of ['Left', 'Right']) {
        const ik = legIK(s, x, D.Hips, ank[s].A);
        if (kneeAnchor[s]) { const d = ik.K.clone().sub(kneeAnchor[s]); r.push(d.x * 12, d.y * 20, d.z * 12); }
        else r.push(Math.min(0, ik.K.y - R_KNEE) * 30, 0, 0);
        r.push(ik.gap * 30);
      }
      const dh = x.clone().sub(Hkey); r.push(dh.x * 0.6, dh.y * 0.6, dh.z * 0.6);
      return r;
    }, Hkey);
  }
  // bacaklar
  const legOut = {};
  for (const s of ['Left', 'Right']) {
    const L = LEG[s]; const ik = legIK(s, H, D.Hips, ank[s].A);
    if (!kneeAnchor[s] && f >= landF[s]) kneeAnchor[s] = V(ik.K.x, R_KNEE, ik.K.z);
    if (both) { const t0 = kneeAnchor[s].clone().sub(ik.hj).normalize(); ik.K = ik.hj.clone().add(t0.multiplyScalar(L.L1)); const sd = ank[s].A.clone().sub(ik.K); ik.gap = Math.abs(sd.length() - L.L2); ik.A = ik.K.clone().add(sd.setLength(L.L2)); }
    const t = ik.K.clone().sub(ik.hj).normalize(), sv = ik.A.clone().sub(ik.K).normalize();
    let n = t.clone().cross(sv); if (n.length() < 0.03) n = t.clone().cross(ik.pole).negate(); n.normalize();
    D[s + 'UpLeg'] = qFrame(t, n).multiply(qFrame(L.t0, L.n0).invert());
    D[s + 'Leg'] = qFrame(sv, n).multiply(qFrame(L.s0, L.n0).invert());
    D[s + 'Foot'] = footD(s, f);
    D[s + 'ToeBase'] = Ry(L.yaw0).multiply(Ry(-L.yaw0)).multiply(Di[s + 'ToeBase']); // parmaklar yerde düz
    legOut[s] = { K: ik.K, gap: ik.gap, A: ik.A, B: ank[s].B, hj: ik.hj };
    if (process.env.DBG && (f % 6 === 0 || f > 66 && f < 76)) console.log('DBG', f, s, 'H', H.toArray().map((x) => x.toFixed(2)).join(','), 'Hkey', Hkey.toArray().map((x) => x.toFixed(2)).join(','), 'hj', ik.hj.toArray().map((x) => x.toFixed(2)).join(','), 'K', ik.K.toArray().map((x) => x.toFixed(2)).join(','), 'anc', kneeAnchor[s]?.toArray().map((x) => x.toFixed(2)).join(','), 'A', ik.A.toArray().map((x) => x.toFixed(2)).join(','), 'gap', ik.gap.toFixed(3), 'phi', phiAt(f).toFixed(1), 'tp', topple(f).toFixed(3));
  }
  if (f === T.kneeR) { const km = kneeAnchor.Left.clone().add(kneeAnchor.Right).multiplyScalar(0.5); const hm = legOut.Left.hj.clone().add(legOut.Right.hj).multiplyScalar(0.5);
    const O0 = hm.sub(km); PHI_LAND = deg(Math.atan2(O0.z, O0.y)); const ph = rad(PHI_LAND); LAND_OFF = O0.clone().sub(V(0, LEG.Left.L1 * Math.cos(ph), LEG.Left.L1 * Math.sin(ph))); console.log('iniş φ', PHI_LAND.toFixed(1), 'artık', LAND_OFF.toArray().map((x) => x.toFixed(3))); }
  // omurga zinciri
  const chain = [['Spine02', 'Hips', 's2'], ['Spine01', 'Spine02', 's1'], ['Spine', 'Spine01', 'ch'], ['neck', 'Spine', 'neck'], ['Head', 'neck', 'head']];
  for (const [b, p, k] of chain) D[b] = D[p].clone().multiply(relIdle(b)).multiply(eul(spineAt(k, f)));
  // omuzlar: gevşek düşüş
  const slump = smooth((f - T.stag) / 20) * (1 - 0.5 * topple(f));
  D.LeftShoulder = D.Spine.clone().multiply(relIdle('LeftShoulder')).multiply(eul([0, 4 * slump, -6 * slump]));
  D.RightShoulder = D.Spine.clone().multiply(relIdle('RightShoulder')).multiply(eul([0, 4 * slump, 6 * slump]));
  // FK: omuz eklemi konumları
  const fk = (Dx) => { const cur = {}, pos = {};
    for (const b of bones) {
      if (!b.parent) { cur[b.name] = Q(b.restQ); pos[b.name] = V(...b.restP); continue; }
      cur[b.name] = Dx[b.name] ? Dx[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ));
      pos[b.name] = b.name === 'Hips' ? H.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent]));
    } return { cur, pos }; };
  let { pos } = fk(D);
  // kollar
  const armOut = {};
  for (const s of ['Left', 'Right']) {
    const S = pos[s + 'Arm']; const sd = s === 'Left' ? 1 : -1; let Tg, poleW;
    const idleHand = idlePos[s + 'Hand'];
    const holding = s === 'Right' && f < T.release;
    const reach = (ARM[s].L1 + ARM[s].L2);
    // sarkan kol hedefi: omuzdan aşağı, hafif dışa ve öne
    const hang = S.clone().add(V(0.06 * sd, -reach * 0.93, 0.07));
    if (f <= T.hit) {
      const k = f / T.hit; Tg = idleHand.clone().add(V(0.05 * sd * k, 0.03 * k, -0.04 * k));
    } else if (holding) {
      const k = smooth((f - T.hit) / (T.release - T.hit)); const a = idleHand.clone().add(V(-0.05, 0.03, -0.04));
      const b = S.clone().add(V(-0.1, -reach * 0.82, 0.18));
      Tg = a.lerp(b, k);
    } else {
      const k0 = s === 'Right' ? T.release : T.hit; const k = smooth((f - k0) / 12);
      const a = s === 'Right' ? results[T.release - 1]?.hand?.Right ?? hang : idleHand.clone().add(V(0.05 * sd, 0.03, -0.04));
      Tg = a.clone().lerp(hang, k);
    }
    // yere değince el sabitlenir, sonra son yere doğru kayar / sürüklenir
    const hs = handState[s];
    if (!hs && f > T.kneeR && Tg.y <= 0.05) handState[s] = { P: V(Tg.x, 0.035, Tg.z), f0: f };
    if (handState[s]) {
      const h = handState[s]; const k = smooth((f - h.f0) / Math.max(1, T.end - h.f0));
      Tg = h.P.clone().lerp(FINAL_HAND[s], k);
      const dd = Tg.clone().sub(S); if (dd.length() > reach * 0.985) { Tg = S.clone().add(dd.setLength(reach * 0.985)); Tg.y = Math.max(Tg.y, 0.035); }
    }
    Tg.y = Math.max(Tg.y, 0.035);
    poleW = holding ? V(-0.6, -0.2, -1).normalize() : V(0.5 * sd, 0.1, -1).applyQuaternion(D.Hips).normalize();
    if (handState[s]) poleW.lerp(V(0.6 * sd, 1, 0).normalize(), smooth((f - handState[s].f0) / 8)).normalize();
    const ik = armIK(s, S, Tg, poleW);
    D[s + 'Arm'] = ik.Darm; D[s + 'ForeArm'] = ik.Dfore;
    // bilek: idle ofsetinden nötre (bind) yumuşakça; ölü el biraz bükük (≤10°)
    const relax = s === 'Right' ? smooth((f - T.release + 2) / 10) : smooth(f / 18);
    const W = ARM[s].W0.clone().slerp(Rx(8 * (s === 'Right' ? 1 : 1)), relax);
    D[s + 'Hand'] = ik.Dfore.clone().multiply(W);
    armOut[s] = { T: Tg, gap: ik.gap, bend: ik.bend, H: ik.H, wrist: deg(2 * Math.acos(Math.min(1, Math.abs(W.w)))) };
  }
  ({ pos } = fk(D)); const { cur } = fk(D);
  const r = { f, D, H, pos, cur, leg: legOut, arm: armOut, hand: { Left: pos.LeftHand.clone(), Right: pos.RightHand.clone() } };
  results.push(r); return r;
}
for (let f = 0; f < LEN; f++) solveFrame(f);

// =================== PARMAKLAR ===================
const FINGERS = JSON.parse(fs.readFileSync('C:/AnimRef/animations/katana_run.json', 'utf8')).tracks;
const powQ = (q, k) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const a = 2 * Math.acos(Math.min(1, q.w));
  return a < 1e-6 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(V(q.x, q.y, q.z).normalize(), a * k); };
const FLEX = { Index: [14, 22, 10], Middle: [18, 28, 12], Ring: [22, 32, 14], Pinky: [26, 34, 15] };
const hingeAxis = (n) => { let d = Q(by[n].restQ).invert().multiply(Q(FINGERS[n].rot[0].slice(1))); if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w); return V(d.x, 0, d.z).normalize(); };
const fingerTrack = {};
for (const b of bones) {
  const m = b.name.match(/^(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)(\d)$/); if (!m) continue;
  const [, side, kind, jn] = m; const j = jn - 1; const rest = Q(b.restQ); const idleQ = idleLocal[b.name];
  let relaxed;
  if (kind === 'Thumb') relaxed = rest.clone().multiply(powQ(rest.clone().invert().multiply(Q(FINGERS[b.name].rot[0].slice(1))), 0.3));
  else relaxed = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(hingeAxis(side + 'Hand' + kind + '2'), rad(FLEX[kind][j])));
  fingerTrack[b.name] = [];
  for (let f = 0; f < LEN; f++) {
    // sağ el: bırakmada parmaklar önce biraz fazla açılır (kılıç kayar), sonra gevşer
    let k = side === 'Right' ? smooth((f - T.release + 3) / 9) : smooth(f / 20);
    let q = idleQ.clone().slerp(relaxed, k);
    if (side === 'Right' && kind !== 'Thumb') { const open = Math.max(0, Math.sin(Math.PI * clamp01((f - T.release + 2) / 14))) * 0.45; q = q.slerp(rest, open); }
    fingerTrack[b.name].push(q);
  }
}

// =================== YEREL DÖNÜŞÜMLER ===================
const BLEND = 4;
const tracks = {}; const prev = {};
const localsAt = [];
for (let f = 0; f < LEN; f++) {
  const { cur, H } = results[f]; const loc = {};
  for (const b of bones) {
    if (!b.parent) continue;
    let q = cur[b.parent].clone().invert().multiply(cur[b.name]);
    if (fingerTrack[b.name]) q = fingerTrack[b.name][f].clone();
    if (f < BLEND) q = idleLocal[b.name].clone().slerp(q, smooth(f / BLEND));
    loc[b.name] = q;
  }
  let hp = H.clone().applyQuaternion(armQ.clone().invert()).toArray();
  if (f < BLEND) hp = lerpA(idleHipsLocal, hp, smooth(f / BLEND));
  localsAt.push({ loc, hp });
}
// son kareler tamamen durağan (son pozu tut)
const HOLD = T.end + 2; for (let f = HOLD; f < LEN; f++) localsAt[f] = localsAt[HOLD - 1];
for (let f = 0; f < LEN; f++) {
  const { loc, hp } = localsAt[f];
  for (const [n, q0] of Object.entries(loc)) { const q = q0.clone(); const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone(); (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]); }
  (tracks.Hips.pos ||= []).push([f, ...hp]);
}

// =================== YENİDEN FK (gerçek kareler) + ÖLÇÜM ===================
function fkTracks(f) {
  const cur = {}, pos = {};
  for (const b of bones) {
    if (!b.parent) { cur[b.name] = Q(b.restQ); pos[b.name] = V(...b.restP); continue; }
    const r = tracks[b.name]?.rot[f]; const lq = r ? Q(r.slice(1)) : Q(b.restQ);
    const lp = b.name === 'Hips' ? V(...tracks.Hips.pos[f].slice(1)) : V(...b.restP);
    cur[b.name] = cur[b.parent].clone().multiply(lq); pos[b.name] = pos[b.parent].clone().add(lp.clone().applyQuaternion(cur[b.parent]));
  }
  return { cur, pos };
}
const D_ = (cur, n) => cur[n].clone().multiply(restW[n].clone().invert());
const CONTACTS = [ // [ad, kemik, gövde çerçevesinde ofset, yarıçap]
  ['kalça_ön', 'Hips', [0, 0, 0.1], 0.03], ['karın', 'Spine02', [0, 0.05, 0.11], 0.03], ['göğüs', 'Spine01', [0, 0.06, 0.12], 0.03], ['göğüs_üst', 'Spine', [0, 0.02, 0.11], 0.03],
  ['kafa', 'Head', [0, 0.1, 0.02], 0.1], ['yüz', 'headfront', [0, 0.0, 0.03], 0.03], ['sol_omuz', 'LeftArm', [0, 0, 0], 0.06], ['sağ_omuz', 'RightArm', [0, 0, 0], 0.06],
  ['sol_dirsek', 'LeftForeArm', [0, 0, 0], 0.04], ['sağ_dirsek', 'RightForeArm', [0, 0, 0], 0.04], ['sol_el', 'LeftHand', [0, 0, 0], 0.025], ['sağ_el', 'RightHand', [0, 0, 0], 0.025],
  ['sol_diz', 'LeftLeg', [0, 0, 0], 0.05], ['sağ_diz', 'RightLeg', [0, 0, 0], 0.05], ['sol_bilek', 'LeftFoot', [0, 0, 0], 0.05], ['sağ_bilek', 'RightFoot', [0, 0, 0], 0.05],
  ['sol_parmak', 'LeftToeBase', [0, 0, 0], 0.02], ['sağ_parmak', 'RightToeBase', [0, 0, 0], 0.02],
];
const clr = [];
for (let f = 0; f < LEN; f++) {
  const { cur, pos } = fkTracks(f); const c = {};
  for (const [nm, bn, off, r] of CONTACTS) c[nm] = pos[bn].clone().add(V(...off).applyQuaternion(D_(cur, bn))).y - r;
  clr.push({ c, cur, pos });
}
const worst = {}; for (const k of CONTACTS.map((c) => c[0])) worst[k] = Math.min(...clr.map((x) => x.c[k]));
console.log('min zemin mesafesi (m, <0 = zemine giriyor):', JSON.stringify(Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(3)]))));
for (let f = 0; f < LEN; f++) { const bad = Object.entries(clr[f].c).filter(([, v]) => v < -0.015); if (bad.length) console.log('  kare', f, bad.map(([k, v]) => k + ':' + v.toFixed(3)).join(' ')); }
console.log('son kare temaslar (m):', JSON.stringify(Object.fromEntries(Object.entries(clr[LEN - 1].c).map(([k, v]) => [k, +v.toFixed(3)]))));
console.log('diz y (L/R) kare 26..40:', results.slice(26, 41).map((r) => r.f + ':' + r.leg.Left.K.y.toFixed(2) + '/' + r.leg.Right.K.y.toFixed(2)).join(' '));
console.log('bacak boşluğu max (m):', Math.max(...results.map((r) => Math.max(r.leg.Left.gap, r.leg.Right.gap))).toFixed(3), '| kol boşluğu max', Math.max(...results.map((r) => Math.max(r.arm.Left.gap, r.arm.Right.gap))).toFixed(3));
console.log('sağ dirsek', results.map((r) => Math.round(r.arm.Right.bend)).join(','));
console.log('sol dirsek', results.map((r) => Math.round(r.arm.Left.bend)).join(','));
console.log('kalça y', results.filter((r, i) => i % 4 === 0).map((r) => r.f + ':' + r.H.y.toFixed(2) + '/' + r.H.z.toFixed(2)).join(' '));
// kare arası en büyük dönüş
const mx = {}; for (let f = 1; f < LEN; f++) for (const n of Object.keys(tracks)) { const a = Q(tracks[n].rot[f].slice(1)), b = Q(tracks[n].rot[f - 1].slice(1)); const d = deg(2 * Math.acos(Math.min(1, Math.abs(a.dot(b))))); if (d > (mx[n]?.[0] ?? 0)) mx[n] = [d, f]; }
console.log('kare arası max dönüş (°@kare):', Object.entries(mx).filter(([n]) => !/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n)).map(([n, [d, f]]) => n + ' ' + d.toFixed(1) + '@' + f).join(', '));
// bilek: el, önkol çerçevesinde bind'a göre
const wr = { Left: 0, Right: 0 }; for (let f = 0; f < LEN; f++) for (const s of ['Left', 'Right']) { const { cur } = clr[f]; const W = D_(cur, s + 'ForeArm').invert().multiply(D_(cur, s + 'Hand')); const ax = restDir(s + 'ForeArm', s + 'Hand'); const sw = deg(ax.angleTo(ax.clone().applyQuaternion(W))); wr[s] = Math.max(wr[s], sw); }
console.log('bilek salınım (twist hariç) max (°) — sol', wr.Left.toFixed(1), 'sağ', wr.Right.toFixed(1));

// =================== KATANA (bırakmadan sonra katı cisim) ===================
const KP = st.props.find((p) => p.id === 'katana') || { pos: [-0.27084, 0.07551, 0.18772], rot: [-25.281, -54.674, -2.581], scale: 0.92385 };
const Rp = new THREE.Quaternion().setFromEuler(new THREE.Euler(...KP.rot.map(rad), 'XYZ')); const Pp = V(...KP.pos);
const HALF = 0.5 * KP.scale; // model 1 m'ye normalize, uzun eksen yerel Z (uç +Z)
const katAt = (f) => { const { cur, pos } = clr[f]; const Dh = D_(cur, 'RightHand'); return { p: pos.RightHand.clone().add(Pp.clone().applyQuaternion(Dh)), q: Dh.clone().multiply(Rp) }; };
const KPTS = [[0, 0, HALF, 0.006], [0, 0, 0.1, 0.012], [0, 0, -HALF, 0.016], [0.03, 0, -0.23, 0.01], [-0.03, 0, -0.23, 0.01], [0, 0.035, -0.23, 0.01], [0, -0.035, -0.23, 0.01]];
const kat = [];
for (let f = 0; f < T.release; f++) kat.push(katAt(f));
for (let f = 0; f < T.release; f++) { const k = kat[f]; for (const [x, y, z, r] of KPTS) { const yy = V(x, y, z).applyQuaternion(k.q).add(k.p).y - r; if (yy < 0) console.log('  UYARI kılıç elde zemine giriyor kare', f, yy.toFixed(3)); } }
{
  const a = katAt(T.release - 2), b = katAt(T.release - 1);
  let p = b.p.clone(), q = b.q.clone(); const v = b.p.clone().sub(a.p).multiplyScalar(FPS);
  const dq = b.q.clone().multiply(a.q.clone().invert()); if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
  const ang = 2 * Math.acos(Math.min(1, dq.w)); let w = ang > 1e-6 ? V(dq.x, dq.y, dq.z).normalize().multiplyScalar(ang * FPS) : V(0, 0, 0);
  w.multiplyScalar(0.8).add(V(0, 0, -2.2)); // kayarken uç aşağı/dışa döner
  v.multiply(V(0, 1, 0.15)).add(V(-1.0, 0, 0)); w.add(V(0, -3.5, 0)); const v0 = v.clone(), w0 = w.clone();
  const m = 1.1, Ilong = 0.0008, Iperp = m * (2 * HALF) ** 2 / 12;
  const SUB = 40, dt = 1 / FPS / SUB, e = 0.22, mu = 0.45;
  let landed = -1;
  for (let f = T.release; f < LEN; f++) {
    for (let k = 0; k < SUB; k++) {
      v.y -= 9.81 * dt;
      const Rm = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q));
      const Ib = new THREE.Matrix3().set(1 / Iperp, 0, 0, 0, 1 / Iperp, 0, 0, 0, 1 / Ilong);
      const Iinv = Rm.clone().multiply(Ib).multiply(Rm.clone().transpose());
      for (const [x, y, z, r] of KPTS) {
        const rv = V(x, y, z).applyQuaternion(q); const pt = p.clone().add(rv); const pen = r - pt.y; if (pen <= 0) continue;
        if (landed < 0) landed = f;
        const vp = v.clone().add(w.clone().cross(rv)); const n = V(0, 1, 0);
        if (vp.y < 0) {
          const rn = rv.clone().cross(n); const kN = 1 / m + n.dot(rn.clone().applyMatrix3(Iinv).cross(rv));
          const jn = -(1 + e) * vp.y / kN; const J = n.clone().multiplyScalar(jn);
          const vt = vp.clone().sub(n.clone().multiplyScalar(vp.y)); const vtl = vt.length();
          if (vtl > 1e-5) { const tdir = vt.clone().divideScalar(-vtl); const rt = rv.clone().cross(tdir); const kT = 1 / m + tdir.dot(rt.clone().applyMatrix3(Iinv).cross(rv)); J.add(tdir.multiplyScalar(Math.min(mu * jn, vtl / kT))); }
          v.add(J.clone().divideScalar(m)); w.add(rv.clone().cross(J).applyMatrix3(Iinv));
        }
        p.y += pen * 0.2;
      }
      w.multiplyScalar(1 - 0.6 * dt); if (landed >= 0) { v.multiplyScalar(1 - 1.2 * dt); w.multiplyScalar(1 - 2.5 * dt); }
      const wl = w.length(); if (wl > 1e-8) q = new THREE.Quaternion().setFromAxisAngle(w.clone().divideScalar(wl), wl * dt).multiply(q).normalize();
      p.add(v.clone().multiplyScalar(dt));
    }
    kat.push({ p: p.clone(), q: q.clone() });
  }
  const last = kat[LEN - 1]; const tip = V(0, 0, HALF).applyQuaternion(last.q).add(last.p), pom = V(0, 0, -HALF).applyQuaternion(last.q).add(last.p);
  console.log('katana: bırakma kare', T.release, '(' + (T.release / FPS).toFixed(3) + ' sn) | ilk hız m/s', v0.toArray().map((x) => +x.toFixed(2)), '| açısal rad/s', w0.toArray().map((x) => +x.toFixed(2)),
    '| ilk temas kare', landed, '| son hız', v.length().toFixed(3), '| uç', tip.toArray().map((x) => +x.toFixed(2)), 'kabza', pom.toArray().map((x) => +x.toFixed(2)));
  // kılıç gövdeye çarpıyor mu? (bıçak noktaları ile gövde temas noktaları kabaca)
  let minB = 9, at = -1; for (let f = T.release; f < LEN; f++) { const { pos } = clr[f]; for (let s = -HALF; s <= HALF; s += 0.1) { const pt = V(0, 0, s).applyQuaternion(kat[f].q).add(kat[f].p);
    for (const bn of ['Hips', 'Spine01', 'RightLeg', 'LeftLeg', 'RightUpLeg', 'LeftUpLeg', 'Head']) { const d = pt.distanceTo(pos[bn]) - 0.1; if (d < minB) { minB = d; at = f + ':' + bn; } } } }
  console.log('katana–gövde en yakın (m, kaba)', minB.toFixed(3), at);
  fs.writeFileSync('C:/AnimRef/animations/game_death_katana.json', JSON.stringify({ note: 'game_death katana düşüşü: kahraman kök uzayında (Unity: x aynalı), kare başına katana pivot konumu (bbox merkezi) ve dönüşü (three/UPE uzayı)', fps: FPS, releaseFrame: T.release, releaseTime: T.release / FPS, v0: v0.toArray(), w0: w0.toArray(), frames: kat.map((k, f) => [f, ...k.p.toArray().map((x) => +x.toFixed(5)), ...k.q.toArray().map((x) => +x.toFixed(6))]) }));
}

const anim = { name: 'game_death', fps: FPS, length: LEN, loop: false, tracks };
// önizleme: Armature katanayı taşır, Hips telafi eder
const ptracks = JSON.parse(JSON.stringify(tracks)); ptracks.Armature = { rot: [], pos: [] }; ptracks.Hips.pos = []; ptracks.Hips.rot = [];
const prevA = {};
for (let f = 0; f < LEN; f++) {
  const k = kat[f]; const Da = k.q.clone().multiply(Rp.clone().invert()); const Ap = k.p.clone().sub(Pp.clone().applyQuaternion(Da));
  const Acur = Da.clone().multiply(armQ); const { cur, pos } = clr[f];
  const hl = cur.Hips.clone(); const hq = Acur.clone().invert().multiply(hl); const hp = pos.Hips.clone().sub(Ap).applyQuaternion(Acur.clone().invert());
  for (const [n, q] of [['Armature', Acur], ['Hips', hq]]) { if (prevA[n] && prevA[n].dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prevA[n] = q.clone(); ptracks[n].rot.push([f, q.x, q.y, q.z, q.w]); }
  ptracks.Armature.pos.push([f, ...Ap.toArray()]); ptracks.Hips.pos.push([f, ...hp.toArray()]);
}
const preview = { name: 'preview_death', fps: FPS, length: LEN, loop: false, tracks: ptracks };
if (!NOSEND) {
  for (const a of [anim, preview]) console.log('kaydedildi', a.name, await (await fetch(BASE + '/api/animations/save?name=' + a.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json());
  console.log(await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim: preview }) })).json());
}
