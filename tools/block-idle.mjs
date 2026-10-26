// game_block_idle üretici: blok tuşu basılıyken dönen koruma duruşu (döngü). game_katana_idle'dan 0,08 sn karışımla girilir.
// Duruş: iki elli çapraz koruma — sağ el kabzada göğüs altı önünde, sol el (sağ kavramanın aynası) 9 cm pommel tarafında, bıçak
// gövdenin önünden sol-yukarı çapraz (uç sol omuzun üstünde, baş hizası), ağız düşmana dönük. Kalça çöker, sağ (arka) ayak hafif
// geri ve dışa döner (yan duruş), sol ayak idle'daki yerinde kalır (girişte kayma yok). Baş hedefe kilitli, çene hafif aşağı.
// Döngü: P kare, nefes (göğüs, köprücük, kalça yüksekliği) + ağırlık salınımı + kılıçta çok küçük yaşam; son kare = ilk kare.
// Kılıç-öncelikli çift kol çözücü heavy-attack-0.mjs'ten (o da light-attack-4.mjs'ten). Yalnız verilen porttaki editöre yükler/kaydeder.
// Çalıştır: node block-idle.mjs --port=<UPE portu> [--nosend] [--nosave] [--diag] [--scan [--grid=<json>]]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const ARGS = process.argv.slice(2);
const PORT = ARGS.find((x) => x.startsWith('--port='))?.slice(7);
if (!PORT) { console.error('port gerekli: node block-idle.mjs --port=<UPE portu> (MCP get_status → editorUrl)'); process.exit(2); }
const BASE = 'http://127.0.0.1:' + PORT;
const NAME = ARGS.find((x) => x.startsWith('--name='))?.slice(7) ?? 'game_block_idle';
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
const IDLE = clipPose('game_katana_idle', 0);   // oyundaki kılıç elde idle (PR #17)

function mkHinge(side) {
  const u0 = restDir(side + 'Arm', side + 'ForeArm'), f0 = restDir(side + 'ForeArm', side + 'Hand');
  const n0 = u0.clone().cross(f0).normalize(); const ang0 = u0.angleTo(f0);
  const test = u0.angleTo(f0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(n0, 0.1)));
  return { u0, f0, n0, ang0, sgn: test > ang0 ? 1 : -1 };
}
const R = mkHinge('Right'), RL = mkHinge('Left');
R.f0 = fr0;
const hinge = (H, bend) => new THREE.Quaternion().setFromAxisAngle(H.n0, H.sgn * (rad(bend) - H.ang0));

// ---- Döngü ----
const P = 144, LEN = P + 1;                 // 2,4 sn: bir nefes (gerilimli, idle'dan hızlı) + iki ağırlık salınımı
const W1 = (f, ph = 0) => Math.sin(2 * Math.PI * f / P + ph), W2 = (f, ph = 0) => Math.sin(4 * Math.PI * f / P + ph);
const BR = (f) => W1(f, -Math.PI / 2);      // nefes: 0. karede nefes vermenin sonu (en alçak), P/2'de nefes alma tepesi

// ---- duruş (idle artımlarına eklenen farklar; yaw +sola, pitch +öne, roll) ----
const G = {
  pel: [-14, 7, 1.5],          // pelvis sağa döner (sağ ayak geride, yan duruş), öne eğilir
  sp: [7, 4, -1.5],            // omurga toplamı (göğüs − pelvis): göğüs hedefe geri döner, hafif öne
  hips: [-0.012, -0.075, -0.03], // kalça: sağa, çöker, ağırlık hafif geride
  chin: 5,                      // çene aşağı (odak)
};
const SHARE = { s2: 0.25, s1: 0.35, ch: 0.4 };
const inc = (C, c, p) => ypr(C.D[c].clone().multiply(C.D[p].clone().invert()));
const IP = { pel: ypr(IDLE.D.Hips), s2: inc(IDLE, 'Spine02', 'Hips'), s1: inc(IDLE, 'Spine01', 'Spine02'), ch: inc(IDLE, 'Spine', 'Spine01') };
const idleNeck = ypr(IDLE.D.neck.clone().multiply(IDLE.D.Spine.clone().invert())), idleHead = ypr(IDLE.D.Head.clone().multiply(IDLE.D.neck.clone().invert()));
function spineD(f, p) {
  const D = {};
  D.Hips = eul(p.pel); D.Spine02 = eul(p.s2).multiply(D.Hips); D.Spine01 = eul(p.s1).multiply(D.Spine02); D.Spine = eul(p.ch).multiply(D.Spine01);
  D.neck = eul(p.neck).multiply(D.Spine); D.Head = eul(p.head).multiply(D.neck);
  return D;
}
const I0 = IDLE.hipsPos.clone().sub(restPos.Hips);
function hipsAt(f) {
  return V(I0.x + G.hips[0] + 0.006 * W1(f, 0.6), I0.y + G.hips[1] - 0.004 * BR(f) + 0.0015 * W2(f, 1.1), I0.z + G.hips[2] + 0.003 * W1(f, 2.0));
}
function bodyAt(f) {
  const r = {};
  const sway = W1(f, 0.6);                 // ağırlık salınımı (kalça x ile aynı evre)
  const dp = [G.pel[0] + 0.8 * W1(f, 1.4), G.pel[1] + 0.4 * BR(f), G.pel[2] - 0.7 * sway];
  r.pel = IP.pel.map((v, i) => v + dp[i]);
  const ds = [G.sp[0] - 0.6 * W1(f, 1.4), G.sp[1] - 1.0 * BR(f) + 0.3 * W2(f, 0.4), G.sp[2] + 0.5 * sway];
  for (const k of ['s2', 's1', 'ch']) r[k] = IP[k].map((v, i) => v + SHARE[k] * ds[i]);
  r.ch[1] -= 0.5 * BR(f);                  // nefes alırken göğüs kalkar (geri)
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  const cp = (r.pel[1] - IP.pel[1]) + (r.s2[1] - IP.s2[1]) + (r.s1[1] - IP.s1[1]) + (r.ch[1] - IP.ch[1]); r.chestPitch = cp;
  // baş: hedefe kilitli (dünya yaw ≈ idle), göğsün öne eğilmesini %80 telafi eder; boyun %45, baş %55
  const yawC = idleNeck[0] + idleHead[0] - (cy - (IP.pel[0] + IP.s2[0] + IP.s1[0] + IP.ch[0]));
  const pitC = -0.8 * cp + G.chin + 0.4 * W2(f, 2.2);
  const rollC = -0.6 * (dp[2] + ds[2]);
  r.neck = [idleNeck[0] + 0.45 * (yawC - idleNeck[0] - idleHead[0]), idleNeck[1] + 0.45 * pitC, idleNeck[2] + 0.45 * rollC];
  r.head = [idleHead[0] + 0.55 * (yawC - idleNeck[0] - idleHead[0]) + 0.6 * W1(f, 3.0), idleHead[1] + 0.55 * pitC, idleHead[2] + 0.55 * rollC];
  r.hp = hipsAt(f).toArray();
  return r;
}

// ---- ayaklar (zemin uzayı: top = ayak tabanı ön noktası), döngü boyunca yerde ----
const FOOTL = 0.13;
const ankleFromBall = (ball, yaw, pitch) => ball.clone().add(V(0, FOOTL * Math.sin(rad(Math.max(0, pitch))), -FOOTL * Math.cos(rad(Math.max(0, pitch)))).applyQuaternion(Ry(yaw)));
const foot0 = {};
for (const s of ['Left', 'Right']) { const e = ypr(IDLE.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  foot0[s] = { yaw: e[0], pitch: e[1], ball: IDLE.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0]))) }; }
const FOOT = {
  Left: { yaw: foot0.Left.yaw - 4, ball: foot0.Left.ball.clone() },                          // ön ayak: yerinde, hafif içe
  Right: { yaw: foot0.Right.yaw - 22, ball: foot0.Right.ball.clone().add(V(-0.04, 0, -0.10)) },   // arka ayak: 10 cm geri, dışa döner
};
const footAt = (s) => ({ ankle: ankleFromBall(FOOT[s].ball, FOOT[s].yaw, 0), yaw: FOOT[s].yaw, pitch: 0 });

// ===== KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ (heavy-attack-0.mjs / light-attack-4.mjs) =====
const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const FINGERS = JSON.parse(fs.readFileSync('C:/AnimRef/animations/katana_run.json', 'utf8')).tracks;
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
const CLAV0 = { Right: IDLE.D.Spine.clone().invert().multiply(IDLE.D.RightShoulder), Left: IDLE.D.Spine.clone().invert().multiply(IDLE.D.LeftShoulder) };   // idle köprücük ofseti (omurgaya göre)
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

// ---- kılıç (dünya-yaw çerçevesi = hedef yönü; göğüs eklemine göre; x sol, y yukarı, z ileri). C = sağ kavrama noktası (bıçak ekseninde) ----
// az: bıçağın yaw'ı (+ sola), el: yükselme; ea: ağzın hedefe (+z) dönük yönden bıçak ekseni etrafında dönmesi (+ yukarı doğru)
const bladeDir = (az, el) => V(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)));
const edgeOf = (t, ea) => { const e0 = V(0, 0, 1); e0.sub(t.clone().multiplyScalar(e0.dot(t))).normalize(); const s = t.clone().cross(e0);
  return e0.clone().multiplyScalar(Math.cos(rad(ea))).add(s.multiplyScalar(Math.sin(rad(ea)))).normalize(); };
const GS = JSON.parse(ARGS.find((x) => x.startsWith('--guard='))?.slice(8) ?? '{"C":[-0.08,-0.13,0.34],"az":58,"el":36,"ea":0}');
function designAt(f) {
  // nefeste eller göğüsle kalkar; kılıç ucu çok az yaşar (sabit duran kılıç ölü görünür)
  const C = V(GS.C[0] + 0.003 * W1(f, 0.9), GS.C[1] - 0.006 * BR(f), GS.C[2] + 0.003 * W1(f, 2.4));
  const t = bladeDir(GS.az + 0.8 * W1(f, 1.7) + 0.4 * W2(f, 0.3), GS.el + 0.9 * W1(f, 0.2) - 0.5 * BR(f));
  return { C, t, e: edgeOf(t, GS.ea + 1.2 * W1(f, 2.9)) };
}

// ---- maliyet (heavy-attack-0.mjs; kavrama sürekli tam, bilek bütçesi istisnasız) ----
const sq = (v) => v * v;
const segDist = (a, b, p) => { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return a.clone().add(ab.multiplyScalar(t)).distanceTo(p); };
function evalX(ctx, x, full = false) {
  const { Y, Cd, td, ed, pos0, D, meas, prev } = ctx;
  const C = Cd.clone().add(V(x[0], x[1], x[2]).applyQuaternion(Y));
  const nd = td.clone().cross(ed);
  const Rt = new THREE.Quaternion().setFromAxisAngle(ed, rad(x[3])).multiply(new THREE.Quaternion().setFromAxisAngle(nd, rad(x[4])));
  const t = td.clone().applyQuaternion(Rt), e = ed.clone().applyQuaternion(Rt).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(t, rad(x[5])));
  const DHR = basisQ(t, e).multiply(QH0Ri);
  const PR = C.clone().sub(PPpR.clone().applyQuaternion(DHR));
  const DshR = clavD('Right', D.Spine, [x[11], x[12]]);
  const ikR = armIK('Right', shoulderAt('Right', pos0, DshR), PR, DHR, [x[7], x[8]]);
  const eL = e.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(t, rad(x[6])));
  const DHL = basisQ(t, eL).multiply(QH0Li);
  const PLg = C.clone().add(t.clone().multiplyScalar(DLT)).sub(PPpL.clone().applyQuaternion(DHL));
  const DshL = clavD('Left', D.Spine, [x[13], x[14]]);
  const ikL = armIK('Left', shoulderAt('Left', pos0, DshL), PLg, DHL, [x[9], x[10]]);
  let c = 0; const TT = {};
  c += 4e4 * sq(ikR.err) + 4e4 * sq(ikL.err);
  const outR = V(-1, 0, 0).applyQuaternion(D.Spine), outL = V(1, 0, 0).applyQuaternion(D.Spine), down = V(0, -1, 0);
  for (const [ik, out, tag] of [[ikR, outR, 'R'], [ikL, outL, 'L']]) {
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
  for (const i of [11, 12, 13, 14]) c += 0.004 * x[i] * x[i] + (Math.abs(x[i]) > 12 ? 1 * sq(Math.abs(x[i]) - 12) : 0);
  if (prev) { c += 3000 * (sq(x[0] - prev[0]) + sq(x[1] - prev[1]) + sq(x[2] - prev[2])); for (let i = 3; i < x.length; i++) c += (i === 6 ? 0.1 : 0.03) * sq(x[i] - prev[i]);
    const dg = Math.abs(x[6] - prev[6]); if (dg > 3) c += 2 * sq(dg - 3); }
  for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > 14 ? 2 * sq(a - 14) : 0); }
  if (ctx.prevTau) { for (const [ik, k] of [[ikR, 'R'], [ikL, 'L']]) { if (ctx.prevTau[k] == null) continue; const d = Math.abs(ik.tau - ctx.prevTau[k]); c += 0.006 * d * d + (d > 10 ? 0.3 * sq(d - 10) : 0); } }
  if (ctx.gam0 != null) { const d = Math.abs(x[6] - ctx.gam0); if (d > 14) c += 0.5 * sq(d - 14); }
  if (ctx.prevD) {
    for (const [ik, k, H] of [[ikR, 'R', R], [ikL, 'L', RL]]) { if (!ctx.prevD[k + 'U']) continue;
      for (const [Dn, Dp, ax] of [[ik.DU, ctx.prevD[k + 'U'], H.u0], [ik.DF, ctx.prevD[k + 'F'], H.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
        const tw = Math.abs(twistDeg(dq, ax)); if (tw > 3) c += 0.4 * sq(tw - 3); } } }
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
      for (const sg of [1, -1]) { const y = x.slice(); y[i] += sg * stp[i]; const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; break; } }
    }
    for (let k = 0; k < 6; k++) { const y = x.map((v, i) => v + (rnd() * 2 - 1) * stp[i] * 0.7); const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; } }
    if (!imp) { stp = stp.map((s) => s * 0.5); if (stp[0] < 2e-4) break; }
  }
  return { x, fx };
}

let prevX = null, prevTau = null, prevD = null, GAM0 = null, DES_OVR = null;
const WRI = swingOf('Right', IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand));
const X0 = [0, 0, 0, 0, 0, 0, 0, WRI[0], WRI[1], 0, 0, 0, 0, 0, 0];
const WD = +(ARGS.find((x) => x.startsWith('--wd='))?.slice(5) ?? 6);   // tasarım ağırlığı: kılıç yolu sıkılığı
function solve(f) {
  const p = bodyAt(f); const D = spineD(f, p);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(...p.hp));
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s);
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    if (ft.ankle.distanceTo(hipJ) / (L1 + L2) > 0.962) { // yerde bacak erişimi ≤0,962: topuk kalkar (parmak ucu yerde)
      const ball = ft.ankle.clone().sub(V(0, 0, -FOOTL).applyQuaternion(Ry(ft.yaw)));
      for (let pt = 0; pt <= 50; pt += 0.5) { const a = ankleFromBall(ball, ft.yaw, pt); ft.ankle = a; ft.pitch = pt; if (a.distanceTo(hipJ) / (L1 + L2) <= 0.962) break; }
    }
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
    D[s + 'ToeBase'] = eul([ft.yaw, ft.pitch - Math.min(Math.max(0, ft.pitch), 44), 0]);
    p['foot' + s] = ft;
  }
  const fkPos = () => { const cur = {}, pos = {}, out = {}; for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
      cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ));
      out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]);
      pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, out }; };
  const pos0 = fkPos().pos;
  const Y = new THREE.Quaternion(); const des = DES_OVR ?? designAt(f);
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C), td: des.t.clone(), ed: des.e.clone(), pos0, D,
    meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, prevD };
  ctx.wd = DES_OVR ? 60 : WD; ctx.f = f; ctx.gam0 = GAM0;
  let x0 = prevX ? prevX.slice() : X0.slice();
  if (!prevX) { // ilk kare: sol elin kabza etrafındaki dönüşü (γ) tam tur taranır
    let best = null; ctx.gam0 = null;
    for (let gm = 0; gm < 360; gm += 15) { const xs = x0.slice(); xs[6] = gm; const r = optimize(ctx, xs, 80); if (!best || r.fx < best.fx) best = r; }
    x0 = best.x; GAM0 = x0[6]; ctx.gam0 = GAM0;
  }
  const opt = optimize(ctx, x0, prevX ? 400 : 800);
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true); prevD = { RU: r.ikR.DU, RF: r.ikR.DF, LU: r.ikL.DU, LF: r.ikL.DF };
  prevTau = { R: r.ikR.tau, L: r.ikL.tau };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.chest = pos0.Spine;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// ---- tarama: koruma pozunun yapılabilirliği (kare 0) ----
if (ARGS.includes('--scan')) {
  const SG = JSON.parse(ARGS.find((x) => x.startsWith('--grid='))?.slice(7) ?? '{"x":[-0.12,-0.06,0],"y":[-0.2,-0.13,-0.06],"z":[0.28,0.36],"az":[40,58,75],"el":[25,40],"ea":[-40,0,40]}');
  const res = [];
  for (const cx of SG.x) for (const cy of SG.y) for (const cz of SG.z) for (const az of SG.az) for (const el of SG.el) for (const ea of SG.ea) {
    const t = bladeDir(az, el); DES_OVR = { C: V(cx, cy, cz), t, e: edgeOf(t, ea) };
    prevX = null; prevTau = null; prevD = null; GAM0 = null; SEED = 12345;
    const rr = solve(0); const R_ = rr.p.r; const dev = Math.hypot(rr.p.x[0], rr.p.x[1], rr.p.x[2]) * 100, dt = Math.hypot(rr.p.x[3], rr.p.x[4]);
    res.push({ cx, cy, cz, az, el, ea, c: rr.p.cost, eR: R_.ikR.err * 1000, eL: R_.ikL.err * 1000, wR: R_.ikR.wmag, wL: R_.ikL.wmag, clr: Math.min(R_.T.R ?? 9, R_.T.L ?? 9), bc: R_.bc, hc: R_.hc, dev, dt, beta: rr.p.x[5], bR: R_.ikR.bend, bL: R_.ikL.bend, g: rr.p.x[6] });
  }
  res.sort((a, b) => a.c - b.c);
  for (const q of res.slice(0, 30)) console.log('scan C', [q.cx, q.cy, q.cz].map((v) => v.toFixed(2)).join('/'), 'az', q.az, 'el', q.el, 'ea', q.ea, '| c', q.c.toFixed(1), 'eR', q.eR.toFixed(0), 'eL', q.eL.toFixed(0), 'w', q.wR.toFixed(0) + '/' + q.wL.toFixed(0), 'clr', q.clr.toFixed(2), 'bc', q.bc.toFixed(2), 'hc', q.hc.toFixed(2), 'dev', q.dev.toFixed(1) + 'cm/' + q.dt.toFixed(0) + '°', 'β', q.beta.toFixed(0), 'bend', q.bR.toFixed(0) + '/' + q.bL.toFixed(0), 'γ', q.g.toFixed(0));
  process.exit(0);
}

const outs = []; const diag = [];
const t0run = Date.now();
// iki tur: ikinci tur birinci turun son karesinden ısınır (döngü kapanışı çözücüde de süreklidir)
for (let f = 0; f < LEN; f++) solve(f);
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL.err, tauR: R_.ikR.tau, tauL: R_.ikL.tau, bendR: R_.ikR.bend, bendL: R_.ikL.bend, wR: R_.ikR.wmag, wL: R_.ikL.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reachLeft, r.p.reachRight] });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag.filter((d) => d.f % 8 === 0)) console.log(d.f, 'c', d.cost.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', (d.errL * 1000).toFixed(1), 'wR', d.wR.toFixed(1), 'wL', d.wL.toFixed(1), 'τR', d.tauR.toFixed(0), 'τL', d.tauL.toFixed(0),
  'bR', d.bendR.toFixed(0), 'bL', d.bendL.toFixed(0), 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(1)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'reach', d.reach.map((v) => v.toFixed(3)).join('/'));

// ---- parmaklar: sağ el kavrama (katana_run), sol el kavrama yumruğu (katana_run sol eli; oyunda HandGrip 2 sürer) ----
const fingerOut = {};
for (const [n, t] of Object.entries(FINGERS)) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n)) { const q = Q(t.rot[0].slice(1)); fingerOut[n] = Array.from({ length: LEN }, () => q.clone()); }

// ---- döngü kapanışı: son kare = ilk kare (artık fark kare boyunca doğrusal dağıtılır) ----
const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const closeR = {}; let closeMax = 0, closeN = '';
for (const n of allNames) { const a = genAt(n, 0), b = genAt(n, LEN - 1); closeR[n] = b.clone().invert().multiply(a); const d = qAng(a, b); if (d > closeMax) { closeMax = d; closeN = n; } }
const hClose = V(...outs[0].hipsLocal).sub(V(...outs[LEN - 1].hipsLocal));
console.log('döngü kapanışı (dağıtılan fark): max', closeMax.toFixed(3), '°', closeN, '| kalça', (hClose.length() * 1000).toFixed(2), 'mm');
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const k = f / (LEN - 1);
  for (const n of allNames) {
    let q = genAt(n, f).clone().multiply(powQ(closeR[n], k));
    if (f === LEN - 1) q = genAt(n, 0).clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const hp = V(...outs[f].hipsLocal).add(hClose.clone().multiplyScalar(k));
  if (f === LEN - 1) hp.set(...outs[0].hipsLocal);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}

// ---- rapor (son izlerden FK) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const FF = []; for (let f = 0; f < LEN; f++) { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? qOf(b.name, f) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); }
  const Dd = {}; for (const n of Object.keys(cur)) Dd[n] = cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos, D: Dd, cur }); }
const palm = (s) => V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize();
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: ang, flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };   // toplam = el ekseninin açısı (HeroWristAudit gibi; burulma sayılmaz)
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  console.log(s, 'bilek: fleksiyon max', mx('flex')[0].toFixed(1), '° (kare', mx('flex')[1] + ') | sapma max', mx('dev')[0].toFixed(1), '° (kare', mx('dev')[1] + ') | toplam max', mx('tot')[0].toFixed(1), '° (kare', mx('tot')[1] + ') | burulma max', mx('tw')[0].toFixed(1)); }
// sol avuç ↔ kabza (HeroLeftGrip ölçüsüne yakın: sol el kemiği → bıçak ekseni uzaklığı, eksen boyunca sağ elden uzaklık)
{ const g = [...Array(LEN).keys()].map((f) => { const C = FF[f].pos.RightHand.clone().add(PPpR.clone().applyQuaternion(FF[f].D.RightHand)); const t = b0.clone().applyQuaternion(FF[f].D.RightHand);
    const L = FF[f].pos.LeftHand.clone().add(PPpL.clone().applyQuaternion(FF[f].D.LeftHand)); const v = L.clone().sub(C); const along = v.dot(t); const perp = v.clone().sub(t.clone().multiplyScalar(along)).length();
    return { along: along * 100, perp: perp * 100 }; });
  console.log('sol el kavrama: eksen boyunca sağ elden', Math.min(...g.map((x) => x.along)).toFixed(1), '..', Math.max(...g.map((x) => x.along)).toFixed(1), 'cm | eksene dik sapma max', Math.max(...g.map((x) => x.perp)).toFixed(2), 'cm'); }
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
console.log('β', rng(diag.map((d) => d.x[5])), '| γ', rng(diag.map((d) => d.x[6])), '| dirsek R', rng(diag.map((d) => d.bendR)), 'L', rng(diag.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), 'L', rng(diag.map((d) => d.tauL)), '| klavikula', rng(diag.flatMap((d) => d.x.slice(11))), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°', '| erişim hatası max R/L', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), '/', (Math.max(...diag.map((d) => Math.abs(d.errL))) * 1000).toFixed(1), 'mm');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(2) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde', Math.min(...diag.map((d) => d.bc)).toFixed(3), '| bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '| bacak erişimi max', Math.max(...diag.flatMap((d) => d.reach)).toFixed(3));
{ const P0 = FF[0].pos; const tp = (f) => { const C = FF[f].pos.RightHand.clone().add(PPpR.clone().applyQuaternion(FF[f].D.RightHand)); const t = b0.clone().applyQuaternion(FF[f].D.RightHand); return C.add(t.multiplyScalar(HALF - SR)); };
  const t0 = b0.clone().applyQuaternion(FF[0].D.RightHand);
  console.log('poz (kare 0): kalça', P0.Hips.toArray().map((v) => v.toFixed(3)).join(','), '(idle', IDLE.pos.Hips.toArray().map((v) => v.toFixed(3)).join(',') + ') | sağ el', P0.RightHand.toArray().map((v) => v.toFixed(2)).join(','), 'sol el', P0.LeftHand.toArray().map((v) => v.toFixed(2)).join(','), '| uç', tp(0).toArray().map((v) => v.toFixed(2)).join(','), '| bıçak az', deg(Math.atan2(t0.x, t0.z)).toFixed(0), 'el', deg(Math.asin(t0.y)).toFixed(0));
  let tm = 0; for (let f = 1; f < LEN; f++) tm = Math.max(tm, tp(f).distanceTo(tp(f - 1)) * 60); console.log('uç hızı max (döngü canlılığı)', tm.toFixed(2), 'm/s'); }
// idle'dan giriş: kare 0 ↔ idle[0] fark (0,08 sn karışım)
{ let m = 0, mn = ''; for (const n of allNames) { const t = IDLE.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(t.rot[0].slice(1)), qOf(n, 0)); if (a > m) { m = a; mn = n; } }
  const sl = (s) => (FF[0].pos[s + 'ToeBase'].distanceTo(IDLE.pos[s + 'ToeBase']) * 100).toFixed(1);
  console.log('idle[0] → blok[0]: en büyük kemik farkı', m.toFixed(1), '°', mn, '| ayak (parmak) yer değiştirme cm: sol', sl('Left'), 'sağ', sl('Right')); }

const anim = { name: NAME, fps: 60, length: LEN, loop: true, tracks };
const DUMP = ARGS.find((x) => x.startsWith('--dump='))?.slice(7);
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(anim));
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log('editöre yüklendi', anim.name, r);
  if (!ARGS.includes('--nosave')) { const s = await (await fetch(BASE + '/api/animations/save?name=' + anim.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', anim.name, s); }
}
