// game_parry üretici: blokta zamanlı basışla gelen darbe karşılanıp savrulur, karşı saldırı (Light3) kesintisiz akar. 31 kare = 0,5 sn.
// 0. kare = game_block_idle[0] (iki elli çapraz koruma). 0–3 kılıç darbeye doğru hafif itilir → ÇARPIŞMA (CLASH karesi: hit stop + VFX).
// 3–6 darbe emilir (eller geri-aşağı, kalça çöker, baş geri). 6–14 patlayıcı savurma: kılıç önden dikleşip baş üstünden sağ omzun
// arkasına devrilir (rakip kılıcı yukarı-sağa atılır), göğüs sağa sarılır, sol el kabzayı bırakıp öne-aşağı düşer; sol ayak öne basar
// (irimi, ~50 cm), arka ayak toplanır. 14–19 aşma ve oturma, ~20'den sonra game_light_attack_3_wf[0]'a dikiş: son kare onunla birebir
// (kalça konumu dahil; L3[0] = L2'nin son karesi, yani parry zincirde L2'nin yerini alır). Kılıç-öncelikli çift kol çözücü
// block-idle.mjs / heavy-attack-0.mjs'ten. Yalnız verilen porttaki editöre yükler/kaydeder.
// Çalıştır: node parry.mjs --port=<UPE portu> [--nosend] [--nosave] [--diag]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const ARGS = process.argv.slice(2);
const PORT = ARGS.find((x) => x.startsWith('--port='))?.slice(7);
if (!PORT) { console.error('port gerekli: node parry.mjs --port=<UPE portu> (MCP get_status → editorUrl)'); process.exit(2); }
const BASE = 'http://127.0.0.1:' + PORT;
const NAME = ARGS.find((x) => x.startsWith('--name='))?.slice(7) ?? 'game_parry';
const FROM = ARGS.find((x) => x.startsWith('--from='))?.slice(7) ?? 'game_block_idle';
const TO = 'game_light_attack_3_wf';   // oyundaki Light3 (Assets/AnimRef/game_light_attack_3 = _wf, fark 0,08°)
const NOSEND = ARGS.includes('--nosend');
const st = await (await fetch(BASE + '/api/state')).json();
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (a) => new THREE.Quaternion(...a);
const Ry = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rad(d));
const Rx = (d) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rad(d));
const Rz = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rad(d));
const eul = (e) => Ry(e[0]).multiply(Rx(e[1])).multiply(Rz(e[2])); // yaw, pitch, roll (world)
const ypr = (q) => { const e = new THREE.Euler().setFromQuaternion(q, 'YXZ'); return [deg(e.y), deg(e.x), deg(e.z)]; };
const qAng = (a, b) => deg(2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))));
const qMag = (q) => deg(2 * Math.acos(Math.min(1, Math.abs(q.w))));
const powQ = (q, k) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const a = 2 * Math.acos(Math.min(1, q.w));
  return a < 1e-6 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(V(q.x, q.y, q.z).normalize(), a * k); };
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const sst = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (10 - 15 * t + 6 * t * t); };
const bump = (f, c, w) => Math.exp(-0.5 * ((f - c) / w) ** 2);

const restW = {}, restPos = {};
for (const b of bones) {
  const q = Q(b.restQ);
  if (!b.parent) { restW[b.name] = q; restPos[b.name] = V(...b.restP); }
  else { restW[b.name] = restW[b.parent].clone().multiply(q); restPos[b.name] = restPos[b.parent].clone().add(V(...b.restP).applyQuaternion(restW[b.parent])); }
}
const armQ = Q(by.Armature.restQ);
const restDir = (bone, child) => V(...by[child].restP).applyQuaternion(restW[bone]).normalize();

// katana tutuşu (prop'a dokunulmaz)
const prop = st.props?.find((p) => p.id === 'katana');
const pr = prop ? prop.rot : [-25.281, -54.674, -2.581];
const Qp = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(pr[0]), rad(pr[1]), rad(pr[2]), 'XYZ'));
const b0 = V(0, 0, 1).applyQuaternion(Qp).normalize();
const fr0 = restDir('RightForeArm', 'RightHand');
const WRIST = 14;
const nW = b0.clone().cross(fr0).normalize();
const Wr = new THREE.Quaternion().setFromAxisAngle(nW, rad(WRIST));

// ---- eğri: tek yönlü kübik (Fritsch–Carlson; anahtarın ötesine aşma yok) ----
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; if (f <= keys[0][0]) return keys[0][1]; if (f >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const arr = Array.isArray(keys[0][1]); const C = asArr(keys[0][1]).length;
  const out = [];
  for (let c = 0; c < C; c++) {
    const x = keys.map((k) => k[0]), y = keys.map((k) => asArr(k[1])[c]);
    const d = (j) => (y[j + 1] - y[j]) / (x[j + 1] - x[j]);
    const m = (j) => { if (j === 0 || j === n - 1) return 0; const a = d(j - 1), b = d(j); if (a * b <= 0) return 0;
      const w1 = 2 * (x[j + 1] - x[j]) + (x[j] - x[j - 1]), w2 = (x[j + 1] - x[j]) + 2 * (x[j] - x[j - 1]); return (w1 + w2) / (w1 / a + w2 / b); };
    const h = x[i + 1] - x[i], s = (f - x[i]) / h;
    out.push((2 * s ** 3 - 3 * s ** 2 + 1) * y[i] + (s ** 3 - 2 * s ** 2 + s) * h * m(i) + (-2 * s ** 3 + 3 * s ** 2) * y[i + 1] + (s ** 3 - s ** 2) * h * m(i + 1));
  }
  return arr ? out : out[0];
}

// ---- kliplerden FK ----
const keyAt = (arr, f) => { let r = arr[0]; for (const k of arr) if (k[0] <= f) r = k; return r; };
function clipPose(name, fr) {
  const A = JSON.parse(fs.readFileSync('C:/AnimRef/animations/' + name + '.json', 'utf8'));
  const F = fr === 'last' ? A.length - 1 : fr;
  const hl = keyAt(A.tracks.Hips.pos, F).slice(1);
  const hipsPos = restPos.Hips.clone().add(V(hl[0] - by.Hips.restP[0], hl[1] - by.Hips.restP[1], hl[2] - by.Hips.restP[2]).applyQuaternion(armQ));
  const local = {}, D = {}, cur = {}, pos = {};
  for (const b of bones) {
    if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
    const t = A.tracks[b.name]; const l = t && t.rot && t.rot.length ? Q(keyAt(t.rot, F).slice(1)) : Q(b.restQ);
    local[b.name] = l; cur[b.name] = cur[b.parent].clone().multiply(l); D[b.name] = cur[b.name].clone().multiply(restW[b.name].clone().invert());
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent]));
  }
  return { A, F, hl, hipsPos, local, D, pos };
}
const BLK = clipPose(FROM, 0);   // blok döngüsünün 0. karesi (parry bloktan 0,08 sn karışımla girilir; döngünün evresi küçük fark)
const L3 = clipPose(TO, 0);      // karşı saldırının ilk karesi

function mkHinge(side) {
  const u0 = restDir(side + 'Arm', side + 'ForeArm'), f0 = restDir(side + 'ForeArm', side + 'Hand');
  const n0 = u0.clone().cross(f0).normalize(); const ang0 = u0.angleTo(f0);
  const test = u0.angleTo(f0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(n0, 0.1)));
  return { u0, f0, n0, ang0, sgn: test > ang0 ? 1 : -1 };
}
const R = mkHinge('Right'), RL = mkHinge('Left');
R.f0 = fr0;
const hinge = (H, bend) => new THREE.Quaternion().setFromAxisAngle(H.n0, H.sgn * (rad(bend) - H.ang0));

// ---- Zaman çizelgesi (31 kare = 0,5 sn @60) ----
const LEN = 31, CLASH = 3, REL0 = 8, REL1 = 13, LIFT_L = 5, LAND_L = 15, LIFT_R = 15, LAND_R = 23, ENDB = 12, ES = 13, EW = 13;   // son dikiş 13–26, 26–30 tam L3[0]

// ---- gövde: blok[0] → L3[0] dünya delta harmanı (omurga zinciri; göğüs önde, pelvis adımla) + dinamik farklar ----
const CHAIN = ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head'];
const WCH = { Hips: [5, 13], Spine02: [5, 11.5], Spine01: [5, 10.5], Spine: [5, 9.5], neck: [5, 10], Head: [5.5, 10.5] };   // [başlangıç, süre]
// dinamik farklar (dünya; yaw +sola, pitch +öne, roll), zincirde bu kemikten yukarı doğru birikir
const DYN = (f) => {
  const imp = bump(f, 4.6, 1.2);                              // darbe: göğüs ve baş geri, kalça çöker
  const ov = bump(f, 15, 2.6) - 0.35 * bump(f, 20.5, 2.2);    // savurmanın aşması (sağa fazla sarılma) ve geri yaylanma
  const land = bump(f, 16, 2.0);                              // sol ayak basışı: öne düşüş
  return {
    Hips: [-3 * ov, 2.5 * land - 1 * imp, -1.5 * ov],
    Spine02: [-1.5 * ov, 1 * land, 0],
    Spine01: [-2 * ov, -1.5 * imp, 0.8 * ov],
    Spine: [-2.5 * ov, -2.5 * imp + 1 * land, 1.2 * ov],
    neck: [1.5 * ov, 0.5 * imp, 0],
    Head: [3 * ov, -1.5 * imp, -1 * ov],
  };
};
function chainD(f) {
  const D = {}; const dy = DYN(f); let acc = new THREE.Quaternion();
  for (const n of CHAIN) {
    const [a, w] = WCH[n]; const k = sst((f - a) / w);
    const base = BLK.D[n].clone().slerp(L3.D[n], k);
    acc = eul(dy[n]).multiply(acc);   // dünya farkı (zincirde birikir)
    D[n] = acc.clone().multiply(base);
  }
  return D;
}
function hipsAt(f) {
  const a = BLK.hipsPos, b = L3.hipsPos;
  const kz = sst((f - 4) / 14), kx = sst((f - 5) / 13), ky = sst((f - 6) / 14);
  const p = V(a.x + (b.x - a.x) * kx, a.y + (b.y - a.y) * ky, a.z + (b.z - a.z) * kz);
  p.z += 0.015 * bump(f, 18, 2.2) - 0.012 * bump(f, 4.5, 1.0);   // basışta öne aşma; darbede geri
  p.y += -0.015 * bump(f, 4.8, 1.3) - 0.03 * bump(f, 16.5, 2.4) + 0.01 * bump(f, 10, 2.2);   // darbe çöküşü, basış çöküşü, adım kalkışı
  return p.sub(restPos.Hips);
}

// ---- ayaklar (zemin uzayı: top = ayak tabanı ön noktası) ----
const FOOTL = 0.13;
const ankleFromBall = (ball, yaw, pitch) => ball.clone().add(V(0, FOOTL * Math.sin(rad(Math.max(0, pitch))), -FOOTL * Math.cos(rad(Math.max(0, pitch)))).applyQuaternion(Ry(yaw)));
const footOf = (C) => { const o = {}; for (const s of ['Left', 'Right']) { const e = ypr(C.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  o[s] = { yaw: e[0], pitch: e[1], ball: C.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0]))) }; } return o; };
const FB = footOf(BLK), FE = footOf(L3);
const onGround = (s, f) => (s === 'Left' ? f < LIFT_L || f >= LAND_L : f < LIFT_R || f >= LAND_R);
function footAt(s, f) {
  const A = FB[s], B = FE[s];
  const [f0, f1, hgt] = s === 'Left' ? [LIFT_L, LAND_L, 0.075] : [LIFT_R, LAND_R, 0.035];
  if (f < f0) return { ankle: ankleFromBall(A.ball, A.yaw, 0), yaw: A.yaw, pitch: 0 };
  if (f >= f1) return { ankle: ankleFromBall(B.ball, B.yaw, 0), yaw: B.yaw, pitch: 0 };
  const u = (f - f0) / (f1 - f0); const k = sst(Math.min(1, u * 1.06));
  const ball = A.ball.clone().lerp(B.ball, k); ball.y += hgt * Math.sin(Math.PI * Math.min(1, u * 1.1)) ** 1.2;
  const yaw = A.yaw + (B.yaw - A.yaw) * k; const pitch = (s === 'Left' ? 18 : 30) * Math.sin(Math.PI * Math.min(1, u / 0.4)) * (u < 0.4 ? 1 : 0);
  return { ankle: ankleFromBall(ball, yaw, pitch), yaw, pitch };
}

// ===== KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ (block-idle.mjs / heavy-attack-0.mjs) =====
const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const PP = V(...(prop ? prop.pos : [-0.27084, 0.07551, 0.18772]));
const PSCALE = prop ? prop.scale : 0.92385;
const eW0 = fr0.clone().sub(b0.clone().applyQuaternion(Wr).multiplyScalar(fr0.dot(b0.clone().applyQuaternion(Wr)))).normalize();
const EH = eW0.clone().applyQuaternion(Wr.clone().invert());               // kenar yönü (el-delta çerçevesi): önkol tarafı
const basisQ = (x, y) => { const X = x.clone().normalize(); const Y = y.clone().sub(X.clone().multiplyScalar(y.dot(X))).normalize(); const Z = X.clone().cross(Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); };
const MX = (v) => V(-v.x, v.y, v.z);
const QH0R = basisQ(b0, EH), QH0Ri = QH0R.clone().invert();
const QH0L = basisQ(MX(b0), MX(EH)), QH0Li = QH0L.clone().invert();
const SR = -PP.dot(b0);
const PPpR = PP.clone().sub(b0.clone().multiplyScalar(PP.dot(b0))), PPpL = MX(PPpR);
const HALF = 0.5 * PSCALE;
const DLT = -0.09;                                                           // sol el: sağ elin 9 cm pommel tarafı
const ARM = {};
for (const s of ['Right', 'Left']) { const H = s === 'Right' ? R : RL; const a1 = H.n0.clone(), a2 = H.f0.clone().cross(H.n0).normalize();
  ARM[s] = { H, lu: V(...by[s + 'ForeArm'].restP).length(), lf: V(...by[s + 'Hand'].restP).length(), a1, a2 }; }
const wristQ = (s, w) => { const A = ARM[s]; const r = A.a1.clone().multiplyScalar(w[0]).add(A.a2.clone().multiplyScalar(w[1])); const m = r.length();
  return m < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(r.divideScalar(m), rad(m)); };
const swingOf = (s, q) => { const A = ARM[s]; if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const ang = 2 * Math.acos(Math.min(1, q.w));
  if (ang < 1e-6) return [0, 0]; const ax = V(q.x, q.y, q.z).normalize(); return [deg(ang) * ax.dot(A.a1), deg(ang) * ax.dot(A.a2)]; };
const twistDeg = (q, ax) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); return deg(2 * Math.atan2(V(q.x, q.y, q.z).dot(ax), q.w)); };

function armIK(s, S, PH, DH, w) {
  const A = ARM[s], H = A.H, f0 = H.f0;
  const W = wristQ(s, w); const DF = DH.clone().multiply(W.clone().invert());
  const fd = f0.clone().applyQuaternion(DF);
  const E = PH.clone().sub(fd.clone().multiplyScalar(A.lf));
  const SE = E.clone().sub(S); const dist = SE.length(); const u = SE.divideScalar(dist);
  const bend = deg(u.angleTo(fd)); const hg = hinge(H, bend);
  const v = H.u0.clone().applyQuaternion(hg.clone().invert()), vp = u.clone().applyQuaternion(DF.clone().invert());
  const a = v.clone().sub(f0.clone().multiplyScalar(v.dot(f0))), b = vp.clone().sub(f0.clone().multiplyScalar(vp.dot(f0)));
  const tau = -deg(Math.atan2(a.clone().cross(b).dot(f0), a.dot(b)));
  const DU = DF.clone().multiply(new THREE.Quaternion().setFromAxisAngle(f0, -rad(tau))).multiply(hg.clone().invert());
  return { DF, DU, DH, E, err: dist - A.lu, tau, bend, fd, u, S, PH, wmag: Math.hypot(w[0], w[1]) };
}
const CLAV0 = { Right: BLK.D.Spine.clone().invert().multiply(BLK.D.RightShoulder), Left: BLK.D.Spine.clone().invert().multiply(BLK.D.LeftShoulder) };   // blok köprücük ofseti (omurgaya göre)
function clavD(s, Dsp, c) { const sg = s === 'Right' ? -1 : 1; return Dsp.clone().multiply(CLAV0[s]).multiply(Rz(sg * c[0])).multiply(Ry(-sg * c[1])); }
function shoulderAt(s, pos0, Dsh) { return pos0[s + 'Shoulder'].clone().add(V(...by[s + 'Arm'].restP).applyQuaternion(Dsh.clone().multiply(restW[s + 'Shoulder']))); }
function clearance(pos, D) {
  const upF = D.Spine01.clone().invert(); const loF = D.Hips.clone().invert();
  return (pt, r) => { let best = 9;
    let l = pt.clone().sub(pos.Spine02).applyQuaternion(upF);
    if (l.y > -0.02 && l.y < 0.5) best = Math.min(best, (Math.hypot(l.x / (0.18 + r), l.z / (0.14 + r)) - 1) * 0.17);
    l = pt.clone().sub(pos.Hips).applyQuaternion(loF);
    if (l.y > -0.55 && l.y < 0.12) best = Math.min(best, (Math.hypot(l.x / (0.24 + r), l.z / (0.18 + r)) - 1) * 0.2);
    return best; };
}
const GROUND = restPos.LeftToeBase.y - 0.03;

// ---- kılıç yolu (dünya-yaw çerçevesi; göğüs eklemine göre; x sol, y yukarı, z ileri). C = sağ kavrama noktası, t = bıçak, e = ağız ----
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const SW = (C) => { const s = swordFromHand(C.D.RightHand, C.pos.RightHand); return { C: s.C.clone().sub(C.pos.Spine), t: s.t, e: s.e }; };
const SB = SW(BLK), SE = SW(L3);
const bladeDir = (az, el) => V(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)));
const azel = (t) => [deg(Math.atan2(t.x, t.z)), deg(Math.asin(t.y))];
// ağız: blok ↔ L3 kılıç çerçevesinin küresel harmanından (u), verilen bıçak yönüne dik izdüşüm; ro ile bıçak ekseni etrafında ek dönüş
const QSB = basisQ(SB.t, SB.e), QSE = basisQ(SE.t, SE.e);
const edgeAt = (t, u, ro = 0) => { const e = V(0, 1, 0).applyQuaternion(QSB.clone().slerp(QSE, u)); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return e.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(t, rad(ro))); };
const [azB, elB] = azel(SB.t), [azE, elE] = azel(SE.t);
const KEY = (f, C, az, el, u, ro = 0) => { const t = bladeDir(az, el); return [f, C, t.toArray(), edgeAt(t, u, ro).toArray()]; };
const KS = [
  [0, SB.C.toArray(), SB.t.toArray(), SB.e.toArray()],
  KEY(CLASH, [SB.C.x + 0.004, SB.C.y + 0.006, SB.C.z + 0.03], azB - 2, elB + 1, 0),           // darbeye doğru hafif itiş (karşılama)
  KEY(6, [SB.C.x - 0.006, SB.C.y - 0.022, SB.C.z - 0.035], azB + 4, elB - 3, 0),              // darbe emilir: eller geri-aşağı, uç geri itilir
  KEY(9, [-0.24, 0.2, 0.36], 8, 70, 0.4),                                                     // savurma: kılıç sağ önde dikleşir, rakip kılıcı yukarı kalkar
  KEY(11.5, [-0.5, 0.36, -0.02], -40, 56, 0.75),                                              // baş üstünden sağa devrilir (kol sağa açılır)
  KEY(14.5, [SE.C.x - 0.03, SE.C.y + 0.03, SE.C.z - 0.06], azE - 9, elE - 6, 1),              // aşma: sağ omzun arkasına fazla gider
  KEY(19, [SE.C.x + 0.005, SE.C.y + 0.005, SE.C.z + 0.012], azE + 1.5, elE + 1, 1),           // geri yaylanıp oturur
  [LEN - 1, SE.C.toArray(), SE.t.toArray(), SE.e.toArray()],
];
function designAt(f) {
  const r = spl(KS.map((k) => [k[0], [...k[1], ...k[2], ...k[3]]]), f);
  const t = V(r[3], r[4], r[5]).normalize(); const e = V(r[6], r[7], r[8]); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return { C: V(r[0], r[1], r[2]), t, e };
}
const WD = (f) => 6 + 6 * bump(f, CLASH, 1.5);     // tasarım ağırlığı (çarpışmada kılıç tam yerinde)
const SPD = (f) => (f >= 6 && f <= 16 ? 30 : 14);  // kare başı kemik dönüş sınırı (savurmada serbest)
const TWO = (f) => 1 - sst((f - REL0) / (REL1 - REL0));   // iki el: REL0–REL1 arasında sol el kabzayı bırakır
const GRIP = TWO;

// ---- maliyet (block-idle.mjs; serbest sol kol harmanı heavy-attack-0.mjs) ----
const sq = (v) => v * v;
const segDist = (a, b, p) => { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return a.clone().add(ab.multiplyScalar(t)).distanceTo(p); };
function evalX(ctx, x, full = false) {
  const { Y, Cd, td, ed, pos0, D, g, Lf, meas, prev } = ctx;
  const C = Cd.clone().add(V(x[0], x[1], x[2]).applyQuaternion(Y));
  const nd = td.clone().cross(ed);
  const Rt = new THREE.Quaternion().setFromAxisAngle(ed, rad(x[3])).multiply(new THREE.Quaternion().setFromAxisAngle(nd, rad(x[4])));
  const t = td.clone().applyQuaternion(Rt), e = ed.clone().applyQuaternion(Rt).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(t, rad(x[5])));
  const DHR = basisQ(t, e).multiply(QH0Ri);
  const PR = C.clone().sub(PPpR.clone().applyQuaternion(DHR));
  const DshR = clavD('Right', D.Spine, [x[11], x[12]]);
  const ikR = armIK('Right', shoulderAt('Right', pos0, DshR), PR, DHR, [x[7], x[8]]);
  let ikL = null, DshL = null, PLg = null;
  if (g > 0) {
    const eL = e.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(t, rad(x[6])));
    const DHL = basisQ(t, eL).multiply(QH0Li);
    PLg = C.clone().add(t.clone().multiplyScalar(DLT)).sub(PPpL.clone().applyQuaternion(DHL));
    const Pt = Lf.P.clone().lerp(PLg, g), Dt = Lf.DH.clone().slerp(DHL, g);
    DshL = clavD('Left', D.Spine, [x[13], x[14]]);
    ikL = armIK('Left', shoulderAt('Left', pos0, DshL), Pt, Dt, [x[9], x[10]]);
  }
  let c = 0; const TT = {};
  c += 4e4 * sq(ikR.err); if (ikL) c += 4e4 * g * sq(ikL.err);
  const outR = V(-1, 0, 0).applyQuaternion(D.Spine), outL = V(1, 0, 0).applyQuaternion(D.Spine), down = V(0, -1, 0);
  for (const [ik, out, tag] of [[ikR, outR, 'R'], [ikL, outL, 'L']]) {
    if (!ik) continue;
    const wm = ik.wmag, wlim = 13.5; c += 0.002 * wm * wm + (wm > wlim ? 4 * sq(wm - wlim) : 0);
    const a = Math.abs(ik.tau); c += (a > 60 ? 0.02 * sq(a - 60) : 0) + (a > 78 ? 3 * sq(a - 78) : 0);
    const b = ik.bend; c += (b < 22 ? 0.3 * sq(22 - b) : 0) + (b > 125 ? 0.3 * sq(b - 125) : 0);
    const h = ik.PH.clone().sub(ik.S).normalize(); const m = ik.E.clone().sub(ik.S); m.sub(h.clone().multiplyScalar(m.dot(h)));
    if (m.length() > 0.01) { const pref = out.clone().add(down.clone().multiplyScalar(0.6)).normalize(); c += 4 * sq(Math.max(0, 0.35 - m.normalize().dot(pref))); }
    const el = ik.E, wr = ik.S.clone().add(ik.u.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lu)).add(ik.fd.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lf));
    for (const [pt, r] of [[el, 0.06], [el.clone().lerp(wr, 0.5), 0.05], [wr, 0.05]]) { const d = meas(pt, r); if (d < 0.03) c += 3000 * sq(0.03 - d); TT[tag] = Math.min(TT[tag] ?? 9, d); }
  }
  const pom = C.clone().add(t.clone().multiplyScalar(-HALF - SR)), tip = C.clone().add(t.clone().multiplyScalar(HALF - SR));
  let bc = 9; for (let s = 0.1; s <= 0.92; s += 0.1) { const d = meas(pom.clone().lerp(tip, s), 0.015); bc = Math.min(bc, d); if (d < 0.03) c += 3000 * sq(0.03 - d); }
  const hc = segDist(pom, tip, ctx.headC) - 0.13; if (hc < 0.11) c += 20000 * sq(0.11 - hc);
  const tipY = tip.y - GROUND; if (tipY < 0.13) c += 3000 * sq(0.13 - tipY);
  c += 150 * ctx.wd * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) + 0.002 * ctx.wd * (x[3] * x[3] + x[4] * x[4]);
  c += 0.003 * x[5] * x[5] + (Math.abs(x[5]) > 24 ? 3 * sq(Math.abs(x[5]) - 24) : 0);
  for (const i of [11, 12, 13, 14]) c += 0.004 * x[i] * x[i] + (Math.abs(x[i]) > 16 ? 1 * sq(Math.abs(x[i]) - 16) : 0);
  if (prev) { c += 3000 * (sq(x[0] - prev[0]) + sq(x[1] - prev[1]) + sq(x[2] - prev[2])); for (let i = 3; i < x.length; i++) c += (i === 6 ? 0.1 : 0.03) * sq(x[i] - prev[i]);
    const dg = Math.abs(x[6] - prev[6]); if (dg > 3) c += 2 * sq(dg - 3); }
  for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > 18 ? 2 * sq(a - 18) : 0); }
  if (ctx.prevTau) { for (const [ik, k] of [[ikR, 'R'], [ikL, 'L']]) { if (!ik || ctx.prevTau[k] == null) continue; const d = Math.abs(ik.tau - ctx.prevTau[k]); c += 0.006 * d * d + (d > 12 ? 0.3 * sq(d - 12) : 0); } }
  if (ctx.gam0 != null) { const d = Math.abs(x[6] - ctx.gam0); if (d > 14) c += 0.5 * sq(d - 14); }
  if (ctx.prevD) { const lim = SPD(ctx.f);
    for (const [ik, k, H] of [[ikR, 'R', R], [ikL, 'L', RL]]) { if (!ik || !ctx.prevD[k + 'U']) continue;
      for (const [Dn, Dp, ax] of [[ik.DU, ctx.prevD[k + 'U'], H.u0], [ik.DF, ctx.prevD[k + 'F'], H.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
        const tw = Math.abs(twistDeg(dq, ax)); if (tw > 8) c += 0.4 * sq(tw - 8); const an = qMag(dq); if (an > lim) c += 0.3 * sq(an - lim); } } }
  if (ctx.anchor) { const { xa, k } = ctx.anchor; c += k * (3000 * (sq(x[0] - xa[0]) + sq(x[1] - xa[1]) + sq(x[2] - xa[2])) + 0.05 * [3, 4, 5, 7, 8, 11, 12].reduce((a, i) => a + sq(x[i] - xa[i]), 0)); }
  if (g < 1 && ikL) c += (1 - g) * (0.05 * (sq(x[9] - ctx.wf[0]) + sq(x[10] - ctx.wf[1])) + 0.05 * (sq(x[13]) + sq(x[14])));
  if (!full) return c;
  return { c, C, t, e, DHR, DshR, DshL, ikR, ikL, tip, tipY, hc, bc, T: TT, PLg };
}
let SEED = 12345; const rnd = () => ((SEED = (SEED * 1103515245 + 12345) % 2147483648) / 2147483648);
const STEP0 = [0.02, 0.02, 0.02, 4, 4, 4, 8, 3, 3, 3, 3, 3, 3, 3, 3];
function optimize(ctx, x0, iters = 400, scale = 1) {
  let x = x0.slice(), fx = evalX(ctx, x); let stp = STEP0.map((s) => s * scale);
  for (let it = 0; it < iters; it++) {
    let imp = false;
    for (let i = 0; i < x.length; i++) {
      if (i === 6 && ctx.g <= 0) continue; if (i >= 9 && i <= 10 && ctx.g <= 0) continue; if (i >= 13 && ctx.g <= 0) continue;
      for (const sg of [1, -1]) { const y = x.slice(); y[i] += sg * stp[i]; const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; break; } }
    }
    for (let k = 0; k < 6; k++) { const y = x.map((v, i) => v + (rnd() * 2 - 1) * stp[i] * 0.7); const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; } }
    if (!imp) { stp = stp.map((s) => s * 0.5); if (stp[0] < 2e-4) break; }
  }
  return { x, fx };
}

// ---- sol kol serbest (bırakıştan sonra): kavrama pozundan L3[0]'ın sol koluna (göğüs çerçevesinde yön + dirsek), heavy-attack-0.mjs ----
const chestD = (f) => chainD(f).Spine;
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
const DcEi = chestD(LEN - 1).invert();
const uLE = RL.u0.clone().applyQuaternion(L3.D.LeftArm).applyQuaternion(DcEi), fLE = RL.f0.clone().applyQuaternion(L3.D.LeftForeArm).applyQuaternion(DcEi);
const LU = [[0, uLE.toArray()], [LEN - 1, uLE.toArray()]], LF = [[0, flx(uLE, fLE).toArray()], [LEN - 1, flx(uLE, fLE).toArray()]], BEND_L = [[0, deg(uLE.angleTo(fLE))], [LEN - 1, deg(uLE.angleTo(fLE))]];
const lcache = {}; const TAUF = { a: 0 };
const tauFree = (f) => TAUF.a * (1 - sst((f - REL0) / (LEN - 1 - REL0)));
function leftFree(f) {
  if (lcache[f]) return lcache[f];
  const Dc = chestD(f); const uc = V(...spl(LU, f)).normalize(), bend = spl(BEND_L, f);
  const fx = V(...spl(LF, f)); fx.sub(uc.clone().multiplyScalar(fx.dot(uc))).normalize();
  const u = uc.clone().applyQuaternion(Dc), hint = uc.clone().multiplyScalar(Math.cos(rad(bend))).add(fx.multiplyScalar(Math.sin(rad(bend)))).applyQuaternion(Dc);
  const hg = hinge(RL, bend);
  let base, acc0;
  if (f === 0) { base = new THREE.Quaternion().setFromUnitVectors(RL.u0.clone().applyQuaternion(BLK.D.LeftArm), u).multiply(BLK.D.LeftArm); acc0 = 0; }
  else { const pv = leftFree(f - 1); base = new THREE.Quaternion().setFromUnitVectors(RL.u0.clone().applyQuaternion(pv.arm), u).multiply(pv.arm); acc0 = pv.acc; }
  let best = null;
  const lim = 4;
  const cands = f === 0 ? Array.from({ length: 73 }, (_, i) => -180 + i * 5) : Array.from({ length: 17 }, (_, i) => -lim + i * lim / 8).filter((d) => Math.abs(acc0 + d) <= 180);
  for (const d of cands) {
    const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(d)).multiply(base); const fore = arm.clone().multiply(hg).multiply(new THREE.Quaternion().setFromAxisAngle(RL.f0, rad(tauFree(f))));
    const sc = RL.f0.clone().applyQuaternion(fore).angleTo(hint) + 0.003 * Math.abs(acc0 + d);
    if (!best || sc < best.sc) best = { sc, d, arm, fore };
  }
  return (lcache[f] = { arm: best.arm, fore: best.fore, acc: acc0 + best.d, bend });
}

let prevX = null, prevTau = null, prevD = null, GAM0 = null;
const X0 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
function solve(f) {
  const p = {}; const D = chainD(f);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(hipsAt(f));
  p.ground = {};
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s, f);
    p.ground[s] = onGround(s, f);
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    if (p.ground[s] && ft.ankle.distanceTo(hipJ) / (L1 + L2) > 0.962) { // yerde bacak erişimi ≤0,962: topuk kalkar (parmak ucu yerde)
      const pp0 = Math.max(0, ft.pitch); const ball = ft.ankle.clone().sub(V(0, FOOTL * Math.sin(rad(pp0)), -FOOTL * Math.cos(rad(pp0))).applyQuaternion(Ry(ft.yaw)));
      for (let pt = pp0; pt <= 55; pt += 0.5) { const a = ankleFromBall(ball, ft.yaw, pt); ft.ankle = a; ft.pitch = pt; if (a.distanceTo(hipJ) / (L1 + L2) <= 0.962) break; }
    }
    if (!p.ground[s]) { const dv0 = ft.ankle.clone().sub(hipJ); const r0 = dv0.length() / (L1 + L2); const K0 = 0.945, KW = 0.02; // havada bacak kilitlenmez
      if (r0 > K0) ft.ankle = hipJ.clone().add(dv0.multiplyScalar((K0 + KW * Math.tanh((r0 - K0) / KW)) / r0)); }
    let dv = ft.ankle.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    p['reach' + s] = d / (L1 + L2); d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1).applyQuaternion(Ry(ft.yaw - (s === 'Left' ? 5 : -12))).normalize(); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h)); const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    { const fz = V(0, 0, 1), pl = knee.clone().sub(hipJ.clone().add(dir.clone().multiplyScalar(a))).normalize();
      const fr = (x0, x1) => basisQ(x1, pl).multiply(basisQ(x0, fz).invert());
      const td = knee.clone().sub(hipJ).normalize(), sd = ankle.clone().sub(knee).normalize();
      D[s + 'UpLeg'] = fr(restDir(s + 'UpLeg', s + 'Leg'), td);
      D[s + 'Leg'] = fr(restDir(s + 'Leg', s + 'Foot'), sd); }
    D[s + 'Foot'] = eul([ft.yaw, ft.pitch, 0]);
    { const bend = p.ground[s] ? -Math.min(Math.max(0, ft.pitch), 44) : -Math.min(Math.max(0, ft.pitch), 44) * 0.4 + 6;
      D[s + 'ToeBase'] = eul([ft.yaw, ft.pitch + bend, 0]); }
    p['foot' + s] = ft;
  }
  const fkPos = () => { const cur = {}, pos = {}, out = {}; for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
      cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ));
      out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]);
      pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, out }; };
  const pos0 = fkPos().pos;
  const lF = leftFree(f);
  const lag = leftFree(Math.max(0, f - 3)).fore; let rl = lF.fore.clone().invert().multiply(lag); const ang = qMag(rl);
  rl = new THREE.Quaternion().slerp(rl, ang > 9 ? 9 / ang : 1); const wf = swingOf('Left', rl);
  const SL0 = shoulderAt('Left', pos0, clavD('Left', D.Spine, [0, 0]));
  const LfP = SL0.clone().add(RL.u0.clone().applyQuaternion(lF.arm).multiplyScalar(ARM.Left.lu)).add(RL.f0.clone().applyQuaternion(lF.fore).multiplyScalar(ARM.Left.lf));
  const LfDH = lF.fore.clone().multiply(wristQ('Left', wf));
  const g = TWO(f);
  const Y = new THREE.Quaternion(); const des = designAt(f);
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C), td: des.t.clone(), ed: des.e.clone(), pos0, D, g,
    Lf: { P: LfP, DH: LfDH }, meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, wf };
  ctx.wd = WD(f); ctx.f = f; ctx.prevD = prevD; ctx.gam0 = g > 0 ? GAM0 : null;
  const kE = smooth((f - ES) / EW); ctx.anchor = null;
  let x0 = prevX ? prevX.slice() : X0.slice();
  if (g <= 0) { x0[9] = wf[0]; x0[10] = wf[1]; x0[13] = 0; x0[14] = 0; if (ctx.prev) { ctx.prev = ctx.prev.slice(); ctx.prev[9] = wf[0]; ctx.prev[10] = wf[1]; } }
  if (!prevX) { // ilk kare (blok pozu): γ tam tur taranır
    let best = null; ctx.gam0 = null;
    for (let gm = 0; gm < 360; gm += 15) { const xs = x0.slice(); xs[6] = gm; const r = optimize(ctx, xs, 80); if (!best || r.fx < best.fx) best = r; }
    x0 = best.x; GAM0 = x0[6]; ctx.gam0 = GAM0;
  }
  const opt = optimize(ctx, x0, prevX ? 400 : 800);
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true); prevD = { RU: r.ikR.DU, RF: r.ikR.DF, LU: r.ikL ? r.ikL.DU : null, LF: r.ikL ? r.ikL.DF : null };
  prevTau = { R: r.ikR.tau, L: r.ikL ? r.ikL.tau : null };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  if (r.ikL) { D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
    if (g < 0.95) { const k = smooth(1 - g / 0.95); D.LeftShoulder = r.DshL.clone().slerp(clavD('Left', D.Spine, [0, 0]), k); D.LeftArm = r.ikL.DU.clone().slerp(lF.arm, k); D.LeftForeArm = r.ikL.DF.clone().slerp(lF.fore, k); D.LeftHand = r.ikL.DH.clone().slerp(LfDH, k); } }
  else { D.LeftShoulder = clavD('Left', D.Spine, [0, 0]); D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH; }
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.gw = g; p.chest = pos0.Spine; p.kE = kE;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// ön geçiş: sol elin bırakış başındaki kavrama pozu → serbest kolun ilk anahtarı (dikişsiz bırakış)
const resetSolver = () => { prevX = null; prevTau = null; prevD = null; GAM0 = null; SEED = 12345; for (const k of Object.keys(lcache)) delete lcache[k]; };
{ let cap = null;
  for (let f = 0; f <= REL0; f++) { const r = solve(f); if (f === REL0) { const ik = r.p.r.ikL; const Di = chestD(f).invert(); const uc = ik.u.clone().applyQuaternion(Di), fc = ik.fd.clone().applyQuaternion(Di); cap = { u: uc.toArray(), fx: flx(uc, fc).toArray(), b: ik.bend, tau: ik.tau }; } }
  resetSolver();
  TAUF.a = cap.tau; console.log('bırakışta sol önkol pronasyonu', cap.tau.toFixed(0), '°, dirsek', cap.b.toFixed(0), '°');
  LU.splice(0, LU.length, [0, cap.u], [REL0, cap.u], [LEN - 1, uLE.toArray()]);
  LF.splice(0, LF.length, [0, cap.fx], [REL0, cap.fx], [LEN - 1, flx(uLE, fLE).toArray()]);
  BEND_L.splice(0, BEND_L.length, [0, cap.b], [REL0, cap.b], [LEN - 1, deg(uLE.angleTo(fLE))]);
}
const outs = []; const diag = []; const hand = [];
const t0run = Date.now();
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL?.err, tauR: R_.ikR.tau, tauL: R_.ikL?.tau, bendR: R_.ikR.bend, bendL: R_.ikL?.bend, wR: R_.ikR.wmag, wL: R_.ikL?.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reachLeft, r.p.reachRight], ground: r.p.ground, gw: r.p.gw });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'g', d.gw.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', d.errL != null ? (d.errL * 1000).toFixed(1) : '-', 'wR', d.wR.toFixed(1), 'wL', d.wL?.toFixed(1) ?? '-', 'τR', d.tauR.toFixed(0), 'τL', d.tauL?.toFixed(0) ?? '-',
  'bR', d.bendR.toFixed(0), 'bL', d.bendL?.toFixed(0) ?? '-', 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2), 'reach', d.reach.map((v) => v.toFixed(3)).join('/'));

// ---- parmaklar: sağ el blok[0]'daki kavrama (sabit); sol el kavrama yumruğu → L3[0]'ın sol eli (bırakışta) ----
const fingerOut = {};
for (const b of bones) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(b.name)) {
  const n = b.name; const qa = BLK.local[n], qb = L3.local[n];
  fingerOut[n] = Array.from({ length: LEN }, (_, f) => (n.startsWith('Left') ? qb.clone().slerp(qa, GRIP(f)) : qa.clone().slerp(qb, sst((f - ES) / EW))));
}

// ---- dikiş: 0. kare = blok[0], son kare = L3[0] (kalça dahil); artık farklar başta/sonda söner ----
const SEAM = 5, SEAM_ARM = 7, SEAM_LEG = 5; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const r0 = {}, rE = {}, d0 = {}, dE = {};
for (const n of allNames) { const g0 = genAt(n, 0), gE = genAt(n, LEN - 1);
  r0[n] = g0.clone().invert().multiply(BLK.local[n]); d0[n] = qAng(g0, BLK.local[n]);
  rE[n] = gE.clone().invert().multiply(L3.local[n]); dE[n] = qAng(gE, L3.local[n]); }
const h0 = V(...BLK.hl).sub(V(...outs[0].hipsLocal)), hE = V(...L3.hl).sub(V(...outs[LEN - 1].hipsLocal));
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const wE = smooth((f - ES) / EW);
  for (const n of allNames) {
    const sw = /Shoulder|Arm|Hand$/.test(n) ? SEAM_ARM : /Leg|Foot|Toe/.test(n) ? SEAM_LEG : SEAM, w0 = 1 - smooth(f / sw);
    let q = genAt(n, f).clone(); if (w0 > 0) q.multiply(powQ(r0[n], w0)); if (wE > 0) q.slerp(L3.local[n], wE);
    if (f === 0) q = BLK.local[n].clone(); if (f === LEN - 1) q = L3.local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const w0 = 1 - smooth(f / SEAM);
  const hp = V(...outs[f].hipsLocal).add(h0.clone().multiplyScalar(w0)).lerp(V(...L3.hl), wE);
  if (f === 0) hp.set(...BLK.hl); if (f === LEN - 1) hp.set(...L3.hl);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}

// ---- rapor (son izlerden FK) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − blok[0] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − L3[0] (sonda söner):', top(dE), '| kalça', (hE.length() * 100).toFixed(1), 'cm');
const FF = []; for (let f = 0; f < LEN; f++) { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? qOf(b.name, f) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); }
  const Dd = {}; for (const n of Object.keys(cur)) Dd[n] = cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos, D: Dd }); }
const palm = (s) => V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize();
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: ang, flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  console.log(s, 'bilek: fleksiyon max', mx('flex')[0].toFixed(1), '° (kare', mx('flex')[1] + ') | sapma max', mx('dev')[0].toFixed(1), '° (kare', mx('dev')[1] + ') | toplam max', mx('tot')[0].toFixed(1), '° (kare', mx('tot')[1] + ') | burulma max', mx('tw')[0].toFixed(1));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
const dd = diag.filter((d) => d.gw > 0);
console.log('β', rng(diag.map((d) => d.x[5])), '| γ', rng(dd.map((d) => d.x[6])), '| dirsek R', rng(diag.map((d) => d.bendR)), 'L(kavrama)', rng(dd.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), '| klavikula', rng(diag.flatMap((d) => d.x.slice(11))), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '° | erişim hatası max R', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), 'mm');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde', Math.min(...diag.map((d) => d.bc)).toFixed(3), '| bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '| uç-yer', Math.min(...diag.map((d) => d.tipY)).toFixed(3));
// kılıç ucu hızı ve çarpışma karesi
const tipFK = (f) => { const k = FF[f]; const C = k.pos.RightHand.clone().add(PPpR.clone().applyQuaternion(k.D.RightHand)); const t = b0.clone().applyQuaternion(k.D.RightHand); return C.add(t.multiplyScalar(HALF - SR)); };
const midFK = (f) => { const k = FF[f]; const C = k.pos.RightHand.clone().add(PPpR.clone().applyQuaternion(k.D.RightHand)); const t = b0.clone().applyQuaternion(k.D.RightHand); return C.add(t.multiplyScalar(0.55 * (HALF - SR))); };
const spd = [...Array(LEN - 1).keys()].map((k) => tipFK(k + 1).distanceTo(tipFK(k)) * 60);
console.log('uç hızı (m/s):', spd.map((v, k) => k + ':' + v.toFixed(1)).join(' '));
{ const m = midFK(CLASH); const o = FF[0].pos.Hips; console.log('ÇARPIŞMA karesi', CLASH, '(', (CLASH / 60).toFixed(3), 'sn ): bıçak ortası (kök = 0. kare kalça izdüşümü) x', (m.x - o.x).toFixed(2), 'y', m.y.toFixed(2), 'z', (m.z - o.z).toFixed(2), 'm'); }
// hazır karesi: L3[0]'a kemik + kalça yakınlığı (karşı saldırı erken basılırsa karışım bundan sonra kısa)
{ const dist = (f) => { let m = 0, mn = ''; for (const n of allNames) { if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n)) continue; const a = qAng(qOf(n, f), L3.local[n]); if (a > m) { m = a; mn = n; } }
    const hp = tracks.Hips.pos[f]; return { m, mn, h: Math.hypot(hp[1] - L3.hl[0], hp[2] - L3.hl[1], hp[3] - L3.hl[2]) * 100 }; };
  const ds = [...Array(LEN).keys()].map(dist); const ready = ds.findIndex((d) => d.m <= 10 && d.h <= 3);
  console.log('L3[0]\'a uzaklık (en büyük kemik °/kalça cm):', ds.map((d, f) => f + ':' + d.m.toFixed(0) + '/' + d.h.toFixed(0)).join(' '));
  console.log('HAZIR karesi (≤10°, ≤3 cm):', ready, '(', (ready / 60).toFixed(3), 'sn )'); }
// dikiş doğrulaması
{ const seam = (C, f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(C.local[n], qOf(n, f)); if (a > m) { m = a; mn = n; } } return m.toFixed(3) + '° ' + mn; };
  console.log('dikiş: blok[0]↔parry[0]', seam(BLK, 0), '| parry[son]↔L3[0]', seam(L3, LEN - 1), '| kalça son', (Math.hypot(...tracks.Hips.pos[LEN - 1].slice(1).map((v, i) => v - L3.hl[i])) * 1000).toFixed(2), 'mm | kalça ileri gidiş', ((FF[LEN - 1].pos.Hips.z - FF[0].pos.Hips.z) * 100).toFixed(1), 'cm'); }
{ const footY = [...Array(LEN).keys()].map((f) => [Math.min(FF[f].pos.LeftToeBase.y, FF[f].pos.LeftFoot.y - 0.06) - restPos.LeftToeBase.y, Math.min(FF[f].pos.RightToeBase.y, FF[f].pos.RightFoot.y - 0.06) - restPos.RightToeBase.y]);
  const air = [...Array(LEN).keys()].filter((f) => footY[f][0] > 0.012 && footY[f][1] > 0.012);
  const slip = (s, fa, fb) => { let m = 0; for (let f = fa + 1; f <= fb; f++) m = Math.max(m, FF[f].pos[s + 'ToeBase'].distanceTo(FF[fa].pos[s + 'ToeBase'])); return (m * 100).toFixed(1); };
  console.log('uçuş (iki ayak havada):', air.length, 'kare | yerde ayak kayması (cm): sol önce', slip('Left', 0, LIFT_L - 1), 'sol sonra', slip('Left', LAND_L, LEN - 1), '| sağ önce', slip('Right', 0, LIFT_R - 1), 'sağ sonra', slip('Right', LAND_R, LEN - 1),
    '| bacak erişimi max (yerde)', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3)); }

const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
const DUMP = ARGS.find((x) => x.startsWith('--dump='))?.slice(7);
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(anim));
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log('editöre yüklendi', anim.name, r);
  if (!ARGS.includes('--nosave')) { const s = await (await fetch(BASE + '/api/animations/save?name=' + anim.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', anim.name, s); }
}
