// game_light_attack_2 üretici: hafif kombonun 2. vuruşu, 1. vuruşun son pozundan dikişsiz devam.
// Kesik: ters yükselen çapraz (gyaku kesa) — sol-alttan sağ-üste. Bıçak tek kesim düzleminde, roll sabit, kenar önde.
// Toplanmada el sola-aşağı (sol kalçanın önüne) çekilir, bilek döner (kenar yukarı-sağa bakacak şekilde); vuruş 17. kare;
// son poz: kılıç sağ omuz üstünde yukarıda (3. vuruş — tepeden dikey — için hazırlık).
// Yalnız 5190 editörüne yükler/kaydeder. Çalıştır: node light-attack-2.mjs [--nosend]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const BASE = 'http://127.0.0.1:5190';
const NAME = 'game_light_attack_2';
const st = await (await fetch(BASE + '/api/state')).json();
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (a) => new THREE.Quaternion(...a);
const Ry = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rad(d));
const Rx = (d) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rad(d));
const Rz = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rad(d));
const eul = (e) => Ry(e[0]).multiply(Rx(e[1])).multiply(Rz(e[2])); // yaw, pitch, roll (world)
const ARGS = process.argv.slice(2); const NOSEND = ARGS.includes('--nosend');
const qAng = (a, b) => deg(2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))));
const powQ = (q, k) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const a = 2 * Math.acos(Math.min(1, q.w));
  return a < 1e-6 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(V(q.x, q.y, q.z).normalize(), a * k); };

const restW = {}, restPos = {};
for (const b of bones) {
  const q = Q(b.restQ);
  if (!b.parent) { restW[b.name] = q; restPos[b.name] = V(...b.restP); }
  else { restW[b.name] = restW[b.parent].clone().multiply(q); restPos[b.name] = restPos[b.parent].clone().add(V(...b.restP).applyQuaternion(restW[b.parent])); }
}
const armQ = Q(by.Armature.restQ);
const restDir = (bone, child) => V(...by[child].restP).applyQuaternion(restW[bone]).normalize();

// katana tutuşu (1. vuruşla aynı; prop'a dokunulmaz)
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

// ---- Eğri yardımcısı (Hermite / Catmull-Rom, eşit olmayan zaman) ----
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (j === 0) { const q = asArr(keys[1][1]); return Pj.map((v, c) => 0.45 * (q[c] - v) / (keys[1][0] - keys[0][0])); }
    if (j === n - 1) { const q = asArr(keys[n - 2][1]); return Pj.map((v, c) => 0.3 * (v - q[c]) / (keys[n - 1][0] - keys[n - 2][0])); }
    const a = asArr(keys[j - 1][1]), b = asArr(keys[j + 1][1]);
    return Pj.map((_, c) => (b[c] - a[c]) / (keys[j + 1][0] - keys[j - 1][0])); };
  const m0 = tan(i), m1 = tan(i + 1); const h = t1 - t0; const s = Math.max(0, Math.min(1, (f - t0) / h));
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  const r = A.map((a, c) => h00 * a + h10 * h * m0[c] + h01 * B[c] + h11 * h * m1[c]);
  return arr ? r : r[0];
}
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const smoother = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (t * (6 * t - 15) + 10); };

// ---- 1. vuruşun son karesi (FK): başlangıç pozu ----
const A1 = JSON.parse(fs.readFileSync('C:/AnimRef/animations/game_light_attack_1.json', 'utf8'));
const A1L = A1.length - 1;
const a1Local = {}, a1D = {}, a1Cur = {}, a1Pos = {};
const keyAt = (arr, f) => { let r = arr[0]; for (const k of arr) if (k[0] <= f) r = k; return r; };
const a1HipsLocal = keyAt(A1.tracks.Hips.pos, A1L).slice(1);
const a1HipsPos = restPos.Hips.clone().add(V(a1HipsLocal[0] - by.Hips.restP[0], a1HipsLocal[1] - by.Hips.restP[1], a1HipsLocal[2] - by.Hips.restP[2]).applyQuaternion(armQ));
for (const b of bones) {
  if (!b.parent) { a1Cur[b.name] = Q(b.restQ); continue; }
  const t = A1.tracks[b.name]; const local = t ? Q(keyAt(t.rot, A1L).slice(1)) : Q(b.restQ);
  a1Local[b.name] = local; a1Cur[b.name] = a1Cur[b.parent].clone().multiply(local);
  a1D[b.name] = a1Cur[b.name].clone().multiply(restW[b.name].clone().invert());
  a1Pos[b.name] = b.parent === 'Armature' ? a1HipsPos.clone() : a1Pos[b.parent].clone().add(V(...b.restP).applyQuaternion(a1Cur[b.parent]));
}

// ---- Dirsek menteşesi (+ önkol burulması) ----
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

// başlangıç değerleri (1'in son karesinden ölçülen)
const uR0 = R.u0.clone().applyQuaternion(a1D.RightArm), bendR0 = elbowAngle(a1D.RightArm, a1D.RightForeArm, R);
const uL0 = RL.u0.clone().applyQuaternion(a1D.LeftArm), fL0 = RL.f0.clone().applyQuaternion(a1D.LeftForeArm), bendL0 = deg(uL0.angleTo(fL0));
const phiL0 = (() => { const Ds = new THREE.Quaternion().setFromUnitVectors(RL.u0, uL0); const q = a1D.LeftArm.clone().multiply(Ds.invert());
  const s = Math.sqrt(1 - Math.min(1, q.w * q.w)); const ax = s < 1e-6 ? uL0 : V(q.x / s, q.y / s, q.z / s); let a = deg(2 * Math.acos(Math.max(-1, Math.min(1, q.w))));
  if (ax.dot(uL0) < 0) a = -a; while (a > 180) a -= 360; while (a < -180) a += 360; return a; })();

// ---- Zaman çizelgesi ----
const LEN = 48, HIT = 18, PH0 = A1.length - 1; // 0,8 sn; mikro hareket fazı 1'in devamı
// v2 (kullanıcı: "çok statik"): çökme + ağırlık geri/sola, ön ayak 30 cm öne adım (havalanır, topukla iner), bacaklarla itiş
// (kalça öne ~30 cm, yukarı ~10 cm), pelvis yaw ~55°, göğüs ek ~30°, yan eğilme ~12°, overshoot + oturma.
const T = { start: 0, antic: 12, lift: 14, step: 16, hit: 18, end: 21, follow: 25, settle: 33, rest: 47 };
const P = {
  start: { pel: [13, 3.5, 0.5], hp: [0.008, -0.088, 0.15], s2: [2, 1, 0], s1: [2.5, 1, 0], ch: [2.5, 1, 0], neck: [-4, 0, 0], head: [-6, 0, 0.5],
    lf: [0.03, 0, 0.27, 8, 0], rf: [-0.04, 0.002, -0.12, -26, 2] },
  antic: { pel: [30, 9, -3.5], hp: [0.045, -0.19, 0.07], s2: [8, 3, -3], s1: [10, 3, -3], ch: [10, 2, -3], neck: [-18, -3, 1], head: [-24, -6, 2],
    lf: [0.03, 0.012, 0.264, 9, 7], rf: [-0.04, 0, -0.12, -28, 0] },
  lift: { pel: [22, 8, -2.5], hp: [0.035, -0.175, 0.13], s2: [5, 2.5, -2], s1: [6, 2.5, -2], ch: [7, 2, -2], neck: [-13, -3, 1], head: [-18, -5, 1.5],
    lf: [0.035, 0.07, 0.40, 8, 10], rf: [-0.04, 0.012, -0.12, -28, 8] },
  step: { pel: [8, 6, 0], hp: [0.015, -0.145, 0.22], s2: [0, 1.5, 0], s1: [0, 1, 0], ch: [2, 0, 0], neck: [-3, -2, 0], head: [-5, -3, 0],
    lf: [0.035, 0.014, 0.55, 7, -14], rf: [-0.04, 0.04, -0.12, -26, 22] },
  hit: { pel: [-8, 3, 2], hp: [0.0, -0.11, 0.30], s2: [-6, 0, 2], s1: [-7, -1, 2], ch: [-6, -2, 2], neck: [8, -1, 0], head: [12, -2, -1],
    lf: [0.035, 0, 0.56, 6, 0], rf: [-0.045, 0.05, -0.10, -22, 26] },
  end: { pel: [-20, 1, 3], hp: [-0.015, -0.092, 0.35], s2: [-8, -1, 3], s1: [-10, -2, 3], ch: [-10, -3, 3], neck: [14, 1, 0], head: [20, 2, -1],
    lf: [0.035, 0, 0.56, 5, 0], rf: [-0.05, 0.05, -0.04, -18, 22] },
  follow: { pel: [-26, 0, 3.5], hp: [-0.025, -0.088, 0.38], s2: [-9, -1, 3.5], s1: [-11, -2, 3.5], ch: [-11, -3, 3], neck: [20, 1, 0], head: [28, 2, -1.5],
    lf: [0.035, 0, 0.56, 4, 0], rf: [-0.055, 0.03, 0.04, -15, 12] },
  settle: { pel: [-16, 4, 1.5], hp: [-0.02, -0.122, 0.37], s2: [-6, 1, 1.5], s1: [-7, 0, 1.5], ch: [-7, 0, 1], neck: [12, 1, 0], head: [16, 1, -0.5],
    lf: [0.035, 0, 0.56, 5, 0], rf: [-0.06, 0, 0.08, -14, 0] },
  rest: { pel: [-14, 3, 1], hp: [-0.015, -0.105, 0.355], s2: [-5, 1, 1], s1: [-6, 1, 1], ch: [-6, 0.5, 1], neck: [11, 0, 0], head: [14, 0, 0],
    lf: [0.035, 0, 0.56, 5, 0], rf: [-0.06, 0, 0.08, -15, 0] },
};
// başlangıç parametreleri 1'in son karesinden okunur (mikro hareketin o karedeki katkısı çıkarılır) → üretilen 0. kare ≈ 1[41]
{
  const ypr = (q) => { const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); return [deg(e.y), deg(e.x), deg(e.z)]; };
  const inc = (c, p) => ypr(a1D[c].clone().multiply(a1D[p].clone().invert()));
  const S = P.start; const g = PH0;
  S.pel = ypr(a1D.Hips); S.s2 = inc('Spine02', 'Hips'); S.s1 = inc('Spine01', 'Spine02'); S.ch = inc('Spine', 'Spine01');
  S.neck = inc('neck', 'Spine'); S.head = inc('Head', 'neck');
  S.hp = a1HipsPos.clone().sub(restPos.Hips).toArray();
  for (const [s, k] of [['Left', 'lf'], ['Right', 'rf']]) { const d = a1Pos[s + 'Foot'].clone().sub(restPos[s + 'Foot']); const e = ypr(a1D[s + 'Foot']); S[k] = [d.x, d.y, d.z, e[0], e[1]]; }
  S.ch[1] -= 0.9 * Math.sin(2 * Math.PI * g / 44); S.s1[1] -= 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6);
  S.hp[1] -= 0.004 * Math.sin(2 * Math.PI * g / 44 + 1.1); S.hp[0] -= 0.007 * Math.sin(g * 0.13 + 0.5);
  S.pel[2] -= 0.8 * Math.sin(g * 0.11); S.head[2] -= 0.8 * Math.sin(g * 0.09 + 1);
  console.log('başlangıç (1[41]):', JSON.stringify(Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.map((x) => +x.toFixed(3))]))));
}
// kinetik zincir: kalça önce, omurga, göğüs, kafa en son (pozitif = erken)
const LEAD = { pel: 3, hp: 2.5, s2: 2.2, s1: 1.5, ch: 0.8, neck: -0.8, head: -2, lf: 0, rf: 0.5 };
const names = Object.keys(T);
function poseAt(f) {
  const r = {};
  for (const k of Object.keys(P.start)) r[k] = spl(names.map((n) => [T[n], P[n][k]]), f + (LEAD[k] || 0) * smooth(f / 3)); // öncelik 0. karede sıfır (dikiş)
  const g = f + PH0; // mikro hareket (1'in fazında devam): nefes, ağırlık kayması, asimetrik
  r.ch[1] += 0.9 * Math.sin(2 * Math.PI * g / 44); r.s1[1] += 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6);
  r.hp[1] += 0.004 * Math.sin(2 * Math.PI * g / 44 + 1.1); r.hp[0] += 0.007 * Math.sin(g * 0.13 + 0.5);
  r.pel[2] += 0.8 * Math.sin(g * 0.11); r.head[2] += 0.8 * Math.sin(g * 0.09 + 1);
  return r;
}

// sağ kol: kesim düzlemi (ileri z + sağ-yukarı d2); ψ: önkolun düzlemdeki açısı (0 = ileri, + = sağ-yukarı, - = sol-aşağı)
const dPl = V(-0.75, 0.66, 0).normalize(), zF = V(0, 0, 1);
const planeDir = (d) => zF.clone().multiplyScalar(Math.cos(rad(d))).add(dPl.clone().multiplyScalar(Math.sin(rad(d))));
const PSI = [[12, -42], [14, -50], [16, -24], [17, -2], [18, 26], [19, 50], [20, 68], [22, 92], [26, 114], [34, 119], [47, 121]];
const ANTIC_END = 12;
// toparlanma: kesik bittikten sonra kılıç sağ omuz üstüne kalkar ve bilek döner (3. vuruşun — tepeden dikey — kenar yönü):
// 1. vuruşun kesim düzleminde, onun toplanma pozuna yakın bir yönelim (jodan hazırlık)
const dPl1 = V(0.38, -0.92, 0).normalize();
const SET0 = 99, SET1 = 100; // (kapalı) bilek dönüşü 3. vuruşun toplanmasına bırakıldı
const BEND_R = [[0, bendR0], [6, 46], [12, 56], [14, 58], [16, 40], [18, 22], [19, 18], [20, 17], [22, 20], [26, 26], [34, 42], [47, 52]];
const URH = [[0, uR0.toArray()], [12, [0.15, -0.8, 0.55]], [16, [-0.05, -0.6, 0.8]], [18, [-0.35, -0.2, 0.9]], [21, [-0.7, 0.3, 0.6]], [26, [-0.8, 0.45, 0.35]], [34, [-0.85, 0.3, 0.1]], [47, [-0.85, 0.3, 0.1]]];
function planeFore(psi, dv = dPl) {
  const pd = (d) => zF.clone().multiplyScalar(Math.cos(rad(d))).add(dv.clone().multiplyScalar(Math.sin(rad(d))));
  const al = deg(alpha); const rt = pd(psi - al), rfh = pd(psi);
  const hp_ = rfh.clone().sub(rt.clone().multiplyScalar(rfh.dot(rt))).normalize();
  const fdir = rt.clone().multiplyScalar(Math.cos(alpha)).add(hp_.multiplyScalar(Math.sin(alpha)));
  return new THREE.Quaternion().setFromRotationMatrix(frame(fdir, rt).multiply(M0inv));
}
const Qstart = a1D.RightForeArm.clone(), Qantic = planeFore(spl(PSI, ANTIC_END));
const Qjodan = (f) => planeFore(-92 - 0.3 * (f - SET0), dPl1);
const foreR = (f) => {
  if (f < ANTIC_END) return Qstart.clone().slerp(Qantic, smooth(f / ANTIC_END));
  const q = planeFore(spl(PSI, f)); if (f <= SET0) return q;
  return q.slerp(Qjodan(f), smooth((f - SET0) / (SET1 - SET0)));
};
console.log('önkol dönüşü: toplanma (1[41]→kesim düzlemi)', qAng(Qstart, Qantic).toFixed(0), '° | toparlanma (kesik→jodan)', qAng(planeFore(spl(PSI, SET0)), Qjodan(SET1)).toFixed(0), '°');
const rcache = {};
function rightArm(f) {
  if (rcache[f]) return rcache[f];
  const Df = foreR(f); const bend = Math.max(16, spl(BEND_R, f)); const hint = V(...spl(URH, f)).normalize();
  const hg = hinge(R, bend); let best = null;
  const prevT = f > 0 ? rightArm(f - 1).tau : 0;
  const cands = f === 0 ? [0] : Array.from({ length: 21 }, (_, i) => prevT - 10 + i).filter((t) => t >= -90 && t <= 40);
  for (const tau of cands) {
    const rel = hg.clone().multiply(new THREE.Quaternion().setFromAxisAngle(fr0, rad(tau)));
    const arm = Df.clone().multiply(rel.invert());
    const sc = R.u0.clone().applyQuaternion(arm).angleTo(hint) + 0.004 * Math.abs(tau);
    if (!best || sc < best.sc) best = { sc, tau, arm };
  }
  return (rcache[f] = { fore: Df, arm: best.arm, tau: best.tau, bend });
}

// sol kol: gevşek; üst kol yönü eğriden, burulma (phi) menteşe + önkol ipucuyla, kare başına ≤6°
// sol kol yönleri GÖĞÜS çerçevesinde tanımlanır (kol gövdeyle döner, kinetik zincirin ucu): toplanmada el karna/sol kalçaya
// (iki el yaklaşır), kesikte geri-aşağı-dışa karşı denge; gövdeden 2–3 kare gecikmeli, overshoot'lu.
const chestD = (f) => { const p = poseAt(f); return eul(p.ch).multiply(eul(p.s1)).multiply(eul(p.s2)).multiply(eul(p.pel)); };
const Dc0i = chestD(0).invert();
const uL0c = uL0.clone().applyQuaternion(Dc0i), fL0c = fL0.clone().applyQuaternion(Dc0i);
const BEND_L = [[0, bendL0], [7, 52], [15, 80], [18, 46], [22, 26], [26, 20], [32, 32], [47, 36]];
const LU = [[0, uL0c.toArray()], [7, [0.22, -0.88, 0.38]], [15, [0.24, -0.82, 0.5]], [18, [0.36, -0.9, 0.04]], [22, [0.47, -0.84, -0.27]], [26, [0.52, -0.8, -0.32]], [32, [0.38, -0.9, -0.18]], [47, [0.3, -0.93, -0.08]]];
// LF: dirsek bükülme YÖNÜ (elin üst kola göre gittiği yön, göğüs çerçevesi). Önkol ipucu = üst kol bu yöne 'bend' kadar döndürülür:
// menteşe ile tutarlı → phi (burulma) kaymaz, avuç gövdeye dönük kalır.
const fl0 = fL0c.clone().sub(uL0c.clone().multiplyScalar(fL0c.dot(uL0c))).normalize();
const LF = [[0, fl0.toArray()], [7, [-0.2, 0.1, 0.97]], [15, [-0.6, 0.15, 0.78]], [18, [-0.35, 0.1, 0.93]], [22, [0.05, 0.1, 1]], [26, [0.1, 0.1, 1]], [32, [-0.05, 0.05, 1]], [47, [-0.12, 0.05, 1]]];
const lcache = {};
function leftArm(f) {
  if (lcache[f]) return lcache[f];
  const prevPhi = f > 0 ? leftArm(f - 1).phi : phiL0;
  const Dc = chestD(f); const uc = V(...spl(LU, f)).normalize(), bend = spl(BEND_L, f);
  const fx = V(...spl(LF, f)); fx.sub(uc.clone().multiplyScalar(fx.dot(uc))).normalize();
  const u = uc.clone().applyQuaternion(Dc), hint = uc.clone().multiplyScalar(Math.cos(rad(bend))).add(fx.multiplyScalar(Math.sin(rad(bend)))).applyQuaternion(Dc);
  const Ds = new THREE.Quaternion().setFromUnitVectors(RL.u0, u); const hg = hinge(RL, bend);
  let best = null;
  const lim = Math.min(6, 1 + 0.7 * f); // dikişte yavaş başlar; phi ≤6°/kare
  const cands = f === 0 ? [phiL0] : Array.from({ length: 25 }, (_, i) => prevPhi - lim + i * lim / 12);
  for (const phi of cands) {
    const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(phi)).multiply(Ds); const fore = arm.clone().multiply(hg);
    const sc = RL.f0.clone().applyQuaternion(fore).angleTo(hint) + 0.004 * Math.abs(phi - 25);
    if (!best || sc < best.sc) best = { sc, phi, arm, fore };
  }
  return (lcache[f] = { arm: best.arm, fore: best.fore, phi: best.phi, bend });
}

const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const FINGERS = JSON.parse(fs.readFileSync('C:/AnimRef/animations/katana_run.json', 'utf8')).tracks;

// ---- Kesişim ölçümü (1. vuruşla aynı model): gövde = iki eliptik silindir ----
function clearance(pos, D) {
  const res = {};
  const upF = D.Spine01.clone().invert(); const loF = D.Hips.clone().invert();
  const meas = (pt, r) => { let best = 9;
    let l = pt.clone().sub(pos.Spine02).applyQuaternion(upF);
    if (l.y > -0.02 && l.y < 0.5) best = Math.min(best, (Math.hypot(l.x / (0.18 + r), l.z / (0.14 + r)) - 1) * 0.17);
    l = pt.clone().sub(pos.Hips).applyQuaternion(loF);
    if (l.y > -0.55 && l.y < 0.12) best = Math.min(best, (Math.hypot(l.x / (0.24 + r), l.z / (0.18 + r)) - 1) * 0.2);
    return best; };
  const chk = (key, pt, r) => { const b = meas(pt, r); if (b < 9 && b < (res[key] ?? 9)) res[key] = b; };
  const lerp = (a, b, t) => a.clone().lerp(b, t);
  for (const [s, tag] of [['Right', 'R'], ['Left', 'L']]) {
    const sh = pos[s + 'Arm'], el = pos[s + 'ForeArm'], wr = pos[s + 'Hand'];
    for (const t of [0.4, 0.7]) chk(tag + '_upper', lerp(sh, el, t), 0.055);
    chk(tag + '_elbow', el, 0.06); chk(tag + '_fore', lerp(el, wr, 0.5), 0.05); chk(tag + '_hand', wr, 0.05);
  }
  return { res, meas };
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
  for (const [s, ft, sg] of [['Left', p.lf, 1], ['Right', p.rf, -1]]) {
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    const target = restPos[s + 'Foot'].clone().add(V(ft[0], ft[1], ft[2]));
    let dv = target.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    p['reach' + s] = d / (L1 + L2);
    d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h));
    const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), knee.clone().sub(hipJ).normalize());
    D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), ankle.clone().sub(knee).normalize());
    D[s + 'Foot'] = eul([ft[3], ft[4], 0]);
  }
  const rA = rightArm(f);
  D.RightForeArm = rA.fore; D.RightArm = rA.arm; D.RightHand = rA.fore.clone().multiply(Wr);
  p.bladeDir = b1.clone().applyQuaternion(rA.fore); p.elbow = elbowAngle(rA.arm, rA.fore, R); p.tau = rA.tau;
  const lA = leftArm(f); D.LeftArm = lA.arm; D.LeftForeArm = lA.fore;
  const lag = leftArm(Math.max(0, f - 3)).fore;
  const rel = D.LeftForeArm.clone().invert().multiply(lag); const ang = 2 * Math.acos(Math.min(1, Math.abs(rel.w)));
  const k = ang > rad(9) ? rad(9) / ang : 1;
  D.LeftHand = D.LeftForeArm.clone().multiply(new THREE.Quaternion().slerp(rel, k));
  p.lbend = lA.bend; p.lwrist = deg(Math.min(ang, rad(9))); p.phi = lA.phi;
  if (LOV[f]) { for (const k of Object.keys(LOV[f].D)) D[k] = D[k].clone().slerp(LOV[f].D[k], LOV[f].mix); p.lbend += (LOV[f].bend - p.lbend) * LOV[f].mix; p.phi += (LOV[f].phi - p.phi) * LOV[f].mix; }
  const cur = {}; const out = {}; const pos = {};
  for (const b of bones) {
    if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
    const par = cur[b.parent]; let local;
    if (D[b.name]) { cur[b.name] = D[b.name].clone().multiply(restW[b.name]); local = par.clone().invert().multiply(cur[b.name]); }
    else { local = Q(b.restQ); cur[b.name] = par.clone().multiply(local); }
    out[b.name] = local;
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent]));
  }
  const { res, meas } = clearance(pos, D); p.clr = res;
  // bıçak: elden uca örnekler (gövde/palto/bacak) + kafa
  let bc = 9, hc = 9;
  for (let s = -0.08; s <= 0.95; s += 0.1) { const pt = pos.RightHand.clone().add(p.bladeDir.clone().multiplyScalar(s));
    const m = meas(pt, 0.015); if (m < bc) bc = m; hc = Math.min(hc, pt.distanceTo(pos.Head.clone().add(V(0, 0.1, 0))) - 0.13); }
  p.clr.blade = bc; p.clr.head = hc;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// sol el toplanmada kılıçlı eli hafifçe takip eder (1. vuruştaki LOV yaklaşımı): sağ elin yer değiştirmesinin ~%30'u
const FOLLOW = [[0, 0], [LEN - 1, 0]]; // takip artık LU/LF eğrilerinde (toplanmada eller yaklaşır)
const LOV = {};
{
  const base = Array.from({ length: LEN }, (_, f) => solve(f));
  const R0 = base[0].pos.RightHand;
  for (let f = 0; f < LEN; f++) {
    const w = Math.max(0, spl(FOLLOW, f)); if (w < 1e-3) continue;
    const { pos, D: Db } = base[f]; const dR = base[Math.min(Math.max(0, f - 2), T.antic - 1)].pos.RightHand.clone().sub(R0); dR.z *= 0.3; dR.x *= 0.6;
    const S = pos.LeftArm, E = pos.LeftForeArm, H = pos.LeftHand;
    const Tg = H.clone().add(dR.multiplyScalar(w));
    // kol omuzdan bütün olarak (dirsek/burulma korunur) hedefe doğru döner: w→0'da taban poza birebir, süreksizlik yok
    const Rsh = new THREE.Quaternion().setFromUnitVectors(H.clone().sub(S).normalize(), Tg.clone().sub(S).normalize());
    const lA = leftArm(f);
    LOV[f] = { D: { LeftArm: Rsh.clone().multiply(Db.LeftArm), LeftForeArm: Rsh.clone().multiply(Db.LeftForeArm), LeftHand: Rsh.clone().multiply(Db.LeftHand) },
      bend: lA.bend, phi: lA.phi, err: 0, shift: Tg.distanceTo(H), mix: 1 };
  }
  console.log('sol el takip (kare: kayma cm / phi° / hata°)', Object.entries(LOV).map(([f, o]) => f + ':' + (o.shift * 100).toFixed(0) + '/' + o.phi.toFixed(0) + '/' + o.err.toFixed(1)).join(' '));
}

const outs = []; const diag = []; const hand = [];
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  diag.push({ f, elbow: r.p.elbow, tau: r.p.tau, lbend: r.p.lbend, lw: r.p.lwrist, phi: r.p.phi, clr: r.p.clr, reach: [r.p.reachLeft, r.p.reachRight] });
}

// ---- sol el parmakları: serbest, yaylı ikincil hareket (1. vuruştaki yöntem, faz devam) ----
const FLEX = { Index: [16, 26, 10], Middle: [20, 32, 12], Ring: [25, 36, 14], Pinky: [30, 38, 15] };
const JW = [1, 0.6, 0.35];
const SPR = { Thumb: [0.6, 0.42], Index: [0.62, 0.34], Middle: [0.56, 0.32], Ring: [0.5, 0.3], Pinky: [0.44, 0.28] };
const PHs = { Thumb: 0.3, Index: 0, Middle: 0.7, Ring: 1.4, Pinky: 2.1 };
const spd = hand.map((h, f) => (f ? h.L.distanceTo(hand[f - 1].L) : 0)); const vmax = Math.max(0.02, ...spd);
const sec = {};
for (const kind of Object.keys(SPR)) {
  const [w, z] = SPR[kind]; let x = 0, v = 0; sec[kind] = [];
  for (let f = 0; f < LEN; f++) { v += -w * w * (x + 11 * spd[f] / vmax) - 2 * z * w * v; x += v; sec[kind].push(x + 1.5 * Math.sin(2 * Math.PI * (f + PH0) / 44 + PHs[kind])); }
}
const hingeAxis = (n) => { let d = Q(by[n].restQ).invert().multiply(Q(FINGERS[n].rot[0].slice(1))); if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w); return V(d.x, 0, d.z).normalize(); };
const curl = {}; const fingerOut = {};
for (const [n, t] of Object.entries(FINGERS)) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n)) {
  const q = Q(t.rot[0].slice(1));
  if (!n.startsWith('Left')) { fingerOut[n] = Array.from({ length: LEN }, () => q.clone()); continue; }
  const [, kind, jn] = n.match(/Hand(Thumb|Index|Middle|Ring|Pinky)(\d)/); const j = jn - 1;
  const rest = Q(by[n].restQ); curl[n] = [];
  if (kind === 'Thumb') { const delta = rest.clone().invert().multiply(q);
    for (let f = 0; f < LEN; f++) curl[n].push(rest.clone().multiply(powQ(delta, Math.max(0.05, 0.3 + sec.Thumb[f] / 60)))); continue; }
  const ax = hingeAxis('LeftHand' + kind + '2');
  for (let f = 0; f < LEN; f++) curl[n].push(rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ax, rad(Math.max(2, FLEX[kind][j] + sec[kind][f] * JW[j])))));
}
const P_ = (n) => V(...by[n].restP);
for (let f = 0; f < LEN; f++) {
  const [t1, t2, t3] = ['LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3'].map((n) => curl[n][f]);
  const p1 = P_('LeftHandThumb1');
  const tip = P_('LeftHandThumb2').add(P_('LeftHandThumb3').add(V(0, 0.025, 0).applyQuaternion(t3)).applyQuaternion(t2)).applyQuaternion(t1);
  const idx2 = P_('LeftHandIndex1').add(P_('LeftHandIndex2').applyQuaternion(curl.LeftHandIndex1[f]));
  const swing = new THREE.Quaternion().setFromUnitVectors(tip.normalize(), idx2.sub(p1).normalize());
  curl.LeftHandThumb1[f] = new THREE.Quaternion().slerp(swing, 0.55).multiply(t1);
}
Object.assign(fingerOut, curl);

// ---- dikiş: 0. kare = 1'in son karesi (tüm kemikler + Hips konumu); fark ilk 9 karede yumuşakça söner ----
const SEAM = 9; const resid = {}; const residDeg = {};
const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
for (const n of allNames) { const g0 = genAt(n, 0); resid[n] = g0.clone().invert().multiply(a1Local[n]); residDeg[n] = qAng(g0, a1Local[n]); }
const hipsRes = V(...a1HipsLocal).sub(V(...outs[0].hipsLocal));
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const w = 1 - smooth(f / SEAM);
  for (const n of allNames) {
    let q = genAt(n, f).clone(); if (w > 0) q.multiply(powQ(resid[n], w));
    if (f === 0) q = a1Local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const hp = V(...outs[f].hipsLocal).add(hipsRes.clone().multiplyScalar(w));
  if (f === 0) hp.set(...a1HipsLocal);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}

// ---- rapor ----
const topRes = Object.entries(residDeg).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare ile 1\'in son karesi farkı (dikişte sönümlenir), en büyük:', topRes, '| kalça', (hipsRes.length() * 100).toFixed(1), 'cm');
const seamA = (fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = A1.tracks[n]; if (!t) continue; const qa = Q(keyAt(t.rot, fa).slice(1)); const qb = Q(tracks[n].rot[fb].slice(1)); const a = qAng(qa, qb); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seamA(A1L, 0), [s1, s1n] = seamA(A1L, 1), [sp, spn] = seamA(A1L - 1, 0);
const hp0 = tracks.Hips.pos[0].slice(1), hp1 = tracks.Hips.pos[1].slice(1);
console.log(`dikiş: 1[41]→2[0] max ${s0.toFixed(3)}° (${s0n}) kalça ${(V(...hp0).distanceTo(V(...a1HipsLocal)) * 1000).toFixed(2)} mm | 1[41]→2[1] max ${s1.toFixed(2)}° (${s1n}), kalça ${(V(...hp1).distanceTo(V(...a1HipsLocal)) * 100).toFixed(2)} cm | (karş. 1[40]→1[41] max ${sp.toFixed(2)}° ${spn})`);
const el = diag.map((d) => d.elbow);
console.log('sağ dirsek', Math.min(...el).toFixed(1), '..', Math.max(...el).toFixed(1), '| önkol burulması τ', Math.min(...diag.map((d) => d.tau)), '..', Math.max(...diag.map((d) => d.tau)),
  '| sol dirsek', Math.min(...diag.map((d) => d.lbend)).toFixed(1), '..', Math.max(...diag.map((d) => d.lbend)).toFixed(1), '| sol phi', Math.min(...diag.map((d) => d.phi)).toFixed(1), '..', Math.max(...diag.map((d) => d.phi)).toFixed(1),
  '| sol bilek max', Math.max(...diag.map((d) => d.lw)).toFixed(1), '| sağ bilek', WRIST, '| bacak erişim max', Math.max(...diag.map((d) => Math.max(...d.reach))).toFixed(3));
const mx = {};
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
for (let i = 1; i < LEN; i++) {
  for (const n of ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head']) mx[n] = Math.max(mx[n] || 0, qAng(qOf(n, i), qOf(n, i - 1)));
  mx.phiStep = Math.max(mx.phiStep || 0, Math.abs(diag[i].phi - diag[i - 1].phi)); mx.tauStep = Math.max(mx.tauStep || 0, Math.abs(diag[i].tau - diag[i - 1].tau));
  mx.elbowStep = Math.max(mx.elbowStep || 0, Math.abs(diag[i].elbow - diag[i - 1].elbow));
  mx.handR = Math.max(mx.handR || 0, hand[i].R.distanceTo(hand[i - 1].R) * 100); mx.handL = Math.max(mx.handL || 0, hand[i].L.distanceTo(hand[i - 1].L) * 100);
}
console.log('kareler arası max (deg / cm)', JSON.stringify(Object.fromEntries(Object.entries(mx).map(([k, v]) => [k, +v.toFixed(1)]))));
console.log('LeftArm Δ°', Array.from({ length: LEN - 1 }, (_, i) => qAng(qOf('LeftArm', i + 1), qOf('LeftArm', i)).toFixed(1)).join(','));
console.log('dirsek', diag.map((d) => Math.round(d.elbow)).join(','));
console.log('τ', diag.map((d) => d.tau).join(','));
console.log('phi', diag.map((d) => Math.round(d.phi)).join(','));
console.log('sağ el hız cm/kare', hand.map((h, f) => (f ? (h.R.distanceTo(hand[f - 1].R) * 100).toFixed(0) : 0)).join(','));
const keys = [...new Set(diag.flatMap((d) => Object.keys(d.clr)))]; const minAll = {};
for (const k of keys) { const vals = diag.map((d) => d.clr[k]).filter((v) => typeof v === 'number'); minAll[k] = +Math.min(...vals).toFixed(3); }
console.log('min gövde mesafesi (m, <0 = içeride)', JSON.stringify(minAll));
for (const d of diag) { const bad = keys.filter((k) => d.clr[k] < 0.0); if (bad.length) console.log('  kare', d.f, bad.map((k) => k + ':' + d.clr[k].toFixed(3)).join(' ')); }
// ---- hareket genliği ölçümü (koordinatörün tablosuyla aynı: kare çiftleri arasındaki en büyük fark) ----
{
  const pw = (n) => { let m = 0; const rs = tracks[n].rot; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.max(m, qAng(Q(rs[i].slice(1)), Q(rs[j].slice(1)))); return m; };
  const hp = tracks.Hips.pos; const rng = (c) => (Math.max(...hp.map((p) => p[c])) - Math.min(...hp.map((p) => p[c]))) * 100;
  console.log('TABLO | Hips konumu cm x/y/z', rng(1).toFixed(0) + '/' + rng(2).toFixed(0) + '/' + rng(3).toFixed(0), '| sol önkol', pw('LeftForeArm').toFixed(0), '| sol diz', pw('LeftLeg').toFixed(0), '| sağ diz', pw('RightLeg').toFixed(0),
    '| omurga', ['Spine02', 'Spine01', 'Spine'].map((n) => pw(n).toFixed(0)).join('/'), '| sol üst kol', pw('LeftArm').toFixed(0), '| Hips rot', pw('Hips').toFixed(0), '| baş', pw('Head').toFixed(0));
  const yprW = (q) => { const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); return [deg(e.y), deg(e.x), deg(e.z)]; };
  const knee = (s, f) => { const p = outs[f].pos; return deg(p[s + 'Leg'].clone().sub(p[s + 'UpLeg']).angleTo(p[s + 'Foot'].clone().sub(p[s + 'Leg']))); };
  const mm = (a) => [Math.min(...a), Math.max(...a)];
  const F_ = [...Array(LEN).keys()];
  const kl = mm(F_.map((f) => knee('Left', f))), kr = mm(F_.map((f) => knee('Right', f)));
  const pyaw = mm(F_.map((f) => yprW(outs[f].D.Hips)[0])), cyaw = mm(F_.map((f) => yprW(outs[f].D.Spine.clone().multiply(outs[f].D.Hips.clone().invert()))[0]));
  const croll = mm(F_.map((f) => yprW(outs[f].D.Spine)[2])), cpitch = mm(F_.map((f) => yprW(outs[f].D.Spine)[1]));
  const hy = F_.map((f) => outs[f].pos.Hips.y), hz = F_.map((f) => outs[f].pos.Hips.z);
  const iMin = hy.indexOf(Math.min(...hy.slice(0, HIT + 1)));
  const lfz = F_.map((f) => outs[f].pos.LeftFoot.z), lfy = F_.map((f) => outs[f].pos.LeftFoot.y);
  const rfp = F_.map((f) => yprW(outs[f].D.RightFoot)[1]);
  const lb = mm(diag.map((d) => d.lbend));
  const lu = F_.map((f) => RL.u0.clone().applyQuaternion(outs[f].D.LeftArm)); let sw = 0; for (const a of lu) for (const b of lu) sw = Math.max(sw, deg(a.angleTo(b)));
  const hd = F_.map((f) => outs[f].pos.LeftHand.distanceTo(outs[f].pos.RightHand) * 100);
  const headY = F_.map((f) => outs[f].pos.Head.y);
  console.log('dizler (bükülme°): sol', kl.map((v) => v.toFixed(0)).join('..'), 'sağ', kr.map((v) => v.toFixed(0)).join('..'),
    '| pelvis yaw', pyaw.map((v) => v.toFixed(0)).join('..'), '| göğüs-pelvis yaw', cyaw.map((v) => v.toFixed(0)).join('..'), '| yan eğilme', croll.map((v) => v.toFixed(0)).join('..'), '| öne eğilme', cpitch.map((v) => v.toFixed(0)).join('..'));
  console.log('kalça: çökme', ((hy[0] - hy[iMin]) * 100).toFixed(1), 'cm (kare', iMin + ')', '| yükselme', ((Math.max(...hy.slice(iMin)) - hy[iMin]) * 100).toFixed(1), 'cm | öne sürülme', ((Math.max(...hz) - hz[iMin]) * 100).toFixed(1), 'cm | toplam ileri', ((Math.max(...hz) - Math.min(...hz)) * 100).toFixed(1), 'cm',
    '| adım', ((lfz[LEN - 1] - lfz[0]) * 100).toFixed(1), 'cm, kalkış', ((Math.max(...lfy) - lfy[0]) * 100).toFixed(1), 'cm | arka topuk max', Math.max(...rfp).toFixed(0), '°');
  console.log('sol dirsek', lb.map((v) => v.toFixed(0)).join('..'), '| sol kol salınımı', sw.toFixed(0), '° | eller arası cm: 0.', hd[0].toFixed(0), 'min', Math.min(...hd.slice(0, HIT)).toFixed(0), '(kare', hd.indexOf(Math.min(...hd.slice(0, HIT))) + ')',
    '| baş y aralığı', ((Math.max(...headY) - Math.min(...headY)) * 100).toFixed(1), 'cm, kalça y aralığı', ((Math.max(...hy) - Math.min(...hy)) * 100).toFixed(1), 'cm');
  const twOf = (n) => F_.map((f) => { const d = Q(by[n].restQ).invert().multiply(qOf(n, f)); return deg(2 * Math.atan2(d.y, d.w)); });
  const stepMax = (a) => Math.max(...a.slice(1).map((v, i) => Math.abs(v - a[i])));
  const tw = twOf('LeftArm'), twf = twOf('LeftForeArm');
  console.log('sol kol gerçek burulma (kemik ekseni, rest\'e göre): üst kol', Math.min(...tw).toFixed(0), '..', Math.max(...tw).toFixed(0), 'max adım', stepMax(tw).toFixed(1), '| önkol', Math.min(...twf).toFixed(0), '..', Math.max(...twf).toFixed(0), 'max adım', stepMax(twf).toFixed(1));
  console.log('ilk kareler hareket (max kemik °/kare):', [1, 2, 3, 4].map((f) => { let m = 0; for (const n of allNames) m = Math.max(m, qAng(qOf(n, f), qOf(n, f - 1))); return m.toFixed(1); }).join(', '));
}
const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log('5190 yüklendi', r);
  const s = await (await fetch(BASE + '/api/animations/save?name=' + NAME, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', s);
}
