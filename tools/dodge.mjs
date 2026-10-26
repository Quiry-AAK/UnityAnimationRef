// game_dodge / game_dodge_back üretici: alçak, hızlı step-dodge (katana sağ elde, tek elle).
// İleri (game_dodge): kahraman dodge yönüne döner (kod), sağ (arka) ayaktan itiş → iki ayak havada alçak süzülme → sol (ön) ayak
// basar ve kayarak frenler, sağ ayak arkada basıp kayar → game_katana_idle[0]'a dikişsiz döner. Kılıç süzülmede gövdenin arkasında
// yatay akar (hareket çizgisi), frende momentumla öne savrulup idle gardına oturur. Sol kol denge için önde.
// Geri (game_dodge_back, girdi yokken): sol (ön) ayaktan itiş, geriye alçak sıçrayış, sağ ayak arkada basıp kayar, sol ayak toplanır;
// gövde öne eğik (gözler hedefte), kılıç gardda hedefe dönük kalır.
// Kök: kalçanın yatay yolu klibin içinde (3,5 m; editörde dünyada gidiş = oyundaki gidiş). Bağlarken saldırılardaki gibi yerinde kopya +
// yol eğrisi çıkarılır (HeroAttackClips). 0. kare = game_katana_idle[0]; son kare = idle[0] (yatay kök konumu hariç).
// Kılıç-öncelikli kol çözücü ve ölçümler heavy-attack-0.mjs'ten (tek el: kavrama yok).
// Çalıştır: node dodge.mjs --port=<UPE portu> [--back] [--nosend] [--nosave] [--diag] [--scan=<kare> [--grid=<json>]]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const ARGS = process.argv.slice(2);
const PORT = ARGS.find((x) => x.startsWith('--port='))?.slice(7);
if (!/^\d{4,5}$/.test(PORT || '')) { console.error('port gerekli: node dodge.mjs --port=<UPE portu> (MCP get_status → editorUrl)'); process.exit(2); }
const BASE = 'http://127.0.0.1:' + PORT;
const BACK = ARGS.includes('--back');
const NAME = BACK ? 'game_dodge_back' : 'game_dodge';
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
const easeOut = (t) => { t = Math.max(0, Math.min(1, t)); return 1 - (1 - t) * (1 - t); };

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

// ---- eğri: tek yönlü kübik (Fritsch–Carlson; anahtarın ötesine aşma yok, uç değerlerde teğet 0) ----
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function pchip(keys, f) {
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
const spl = pchip;

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
const IDLE = clipPose('game_katana_idle', 0);   // oyundaki kılıç elde idle

function mkHinge(side) {
  const u0 = restDir(side + 'Arm', side + 'ForeArm'), f0 = restDir(side + 'ForeArm', side + 'Hand');
  const n0 = u0.clone().cross(f0).normalize(); const ang0 = u0.angleTo(f0);
  const test = u0.angleTo(f0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(n0, 0.1)));
  return { u0, f0, n0, ang0, sgn: test > ang0 ? 1 : -1 };
}
const R = mkHinge('Right'), RL = mkHinge('Left');
R.f0 = fr0;
const hinge = (H, bend) => new THREE.Quaternion().setFromAxisAngle(H.n0, H.sgn * (rad(bend) - H.ang0));

// ===================================================================================================================================
// HAREKET TASARIMI (60 kare/sn). Kanallar: kök yolu (ileri oranı 0..1), kalça yüksekliği/yanal, pelvis ve omurga farkları
// (idle artımlarına eklenir: yaw +sola, pitch +öne, roll), ayak evreleri, kılıç yolu (göğüs eklemine göre, dünya; x sol, y yukarı,
// z ileri) ve serbest sol kol (göğüs çerçevesinde).
// ===================================================================================================================================
const LEN = 27;                       // 0,45 sn (HeroMoveSet.dodgeDuration)
const DIST = BACK ? -3.5 : 3.5;       // HeroMoveSet.dodgeDistance
const th = (az, el, ro = 0) => { const t = V(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)));
  const e0 = V(0, -1, 0); e0.sub(t.clone().multiplyScalar(e0.dot(t))).normalize(); const e = e0.clone().multiplyScalar(Math.cos(rad(ro))).add(t.clone().cross(e0).multiplyScalar(Math.sin(rad(ro))));
  return [t.toArray(), e.toArray()]; };
const SW0 = 'idle';
const PLAN = BACK ? {
  // kök: ön ayaktan iki karede itiş, 6. karede tepe hız, sağ ayak basışından sonra kayarak fren
  Z: [[0, 0], [2, 0.03], [4, 0.125], [6, 0.25], [8, 0.38], [10, 0.505], [12, 0.62], [14, 0.725], [16, 0.815], [18, 0.885], [20, 0.94], [22, 0.976], [24, 0.995], [26, 1]],
  Y: [[0, 0], [2, -0.06], [4, -0.1], [7, -0.085], [10, -0.09], [12, -0.13], [14, -0.17], [17, -0.165], [20, -0.11], [23, -0.04], [26, 0]],
  X: [[0, 0], [6, 0.01], [14, -0.01], [26, 0]],
  DP: [[0, [0, 0, 0]], [3, [2, 8, 0]], [6, [4, 14, 1]], [10, [4, 16, 1]], [13, [2, 18, 0]], [16, [0, 16, 0]], [20, [0, 9, 0]], [23, [0, 3, 0]], [26, [0, 0, 0]]],
  DS: [[0, [0, 0, 0]], [3, [1, 4, 0]], [6, [2, 8, -1]], [10, [2, 9, -1]], [13, [1, 12, 0]], [16, [0, 9, 0]], [20, [0, 4, 0]], [26, [0, 0, 0]]],
  // ayak evreleri: [yerde başlangıç sonu, salınım sonu (basış), kayma sonu]; iniş noktası = kalça yolu + ofset (idle ofsetine göre)
  feet: { Left: { push: 4, land: 17, skidEnd: 23, landOff: 0.12, lift: 0.09, swingPitch: 30, kick: 0 },
          Right: { push: 2, land: 12, skidEnd: 22, landOff: -0.35, lift: 0.07, swingPitch: 12, kick: 0 } },
  KS: [[0, SW0], [4, [-0.27, -0.36, 0.1], ...th(-4, -4, 10)], [9, [-0.26, -0.3, 0.16], ...th(-6, 4, 14)], [14, [-0.27, -0.34, 0.14], ...th(-5, 0, 10)],
    [19, [-0.28, -0.42, 0.06], ...th(4, -10, 4)], [26, SW0]],
  LU: [[4, [0.55, -0.75, 0.3]], [10, [0.65, -0.65, 0.35]], [16, [0.5, -0.8, 0.3]], [21, [0.25, -0.92, 0.2]]],
  LF: [[4, [0.1, 0.3, 0.9]], [10, [0.0, 0.3, 0.95]], [16, [0.1, 0.3, 0.9]], [21, [0.1, 0.2, 0.95]]],
  BEND: [[4, 35], [10, 42], [16, 36], [21, 30]],
} : {
  Z: [[0, 0], [2, 0.029], [4, 0.12], [6, 0.243], [8, 0.371], [10, 0.497], [12, 0.611], [14, 0.714], [16, 0.8], [18, 0.874], [20, 0.931], [22, 0.971], [24, 0.994], [26, 1]],
  Y: [[0, 0], [2, -0.05], [4, -0.11], [7, -0.13], [10, -0.135], [13, -0.15], [15, -0.19], [17, -0.2], [19, -0.17], [22, -0.09], [24, -0.03], [26, 0]],
  X: [[0, 0], [6, -0.02], [13, 0.01], [18, 0.015], [26, 0]],
  DP: [[0, [0, 0, 0]], [3, [-4, 12, 0]], [6, [-8, 24, -2]], [10, [-7, 27, -2]], [13, [-4, 25, 0]], [16, [2, 20, 2]], [19, [3, 14, 1]], [22, [1, 6, 0]], [26, [0, 0, 0]]],
  DS: [[0, [0, 0, 0]], [3, [-2, 6, 0]], [6, [-6, 12, 2]], [10, [-6, 14, 2]], [13, [-3, 18, 0]], [15, [0, 20, 0]], [18, [2, 12, -1]], [22, [1, 4, 0]], [26, [0, 0, 0]]],
  feet: { Left: { push: 1, land: 13, skidEnd: 23, landOff: 0.4, lift: 0.1, swingPitch: 14, kick: 0 },
          Right: { push: 4, land: 17, skidEnd: 23, landOff: -0.1, lift: 0.08, swingPitch: 40, kick: 0.22 } },
  KS: [[0, SW0], [3, [-0.3, -0.4, -0.08], ...th(-60, -20, 0)], [5, [-0.3, -0.36, -0.22], ...th(-130, -12, 0)], [7, [-0.28, -0.34, -0.3], ...th(-165, -8, 0)],
    [11, [-0.28, -0.34, -0.32], ...th(-170, -6, 0)], [13, [-0.28, -0.34, -0.31], ...th(-168, -6, 0)], [15, [-0.3, -0.38, -0.18], ...th(-120, -12, 0)],
    [18, [-0.3, -0.42, 0.0], ...th(-40, -18, 0)], [21, [-0.29, -0.44, 0.03], ...th(-2, -16, 0)], [26, SW0]],
  LU: [[4, [0.25, -0.75, 0.6]], [8, [0.3, -0.55, 0.78]], [13, [0.3, -0.6, 0.74]], [17, [0.35, -0.7, 0.6]], [21, [0.2, -0.9, 0.35]]],
  LF: [[4, [-0.2, 0.6, 0.5]], [8, [-0.3, 0.7, 0.4]], [13, [-0.3, 0.7, 0.4]], [17, [-0.2, 0.6, 0.5]], [21, [-0.1, 0.4, 0.8]]],
  BEND: [[4, 45], [8, 55], [13, 55], [17, 45], [21, 35]],
};

// ---- kök + kalça ----
const I0 = IDLE.hipsPos.clone().sub(restPos.Hips);
const zFrac = (f) => spl(PLAN.Z, f);
function hipsAt(f) { return V(I0.x + spl(PLAN.X, f), I0.y + spl(PLAN.Y, f), I0.z + DIST * zFrac(f)); }

// ---- gövde: idle artımlarına eklenen farklar ----
const SHARE = { s2: 0.25, s1: 0.35, ch: 0.4 };
const LEAD = { pel: 0.8, s2: 0.4, s1: 0, ch: -0.5 };      // kinetik zincir: pelvis önde, göğüs geride
const inc = (C, c, p) => ypr(C.D[c].clone().multiply(C.D[p].clone().invert()));
const IP = { pel: ypr(IDLE.D.Hips), s2: inc(IDLE, 'Spine02', 'Hips'), s1: inc(IDLE, 'Spine01', 'Spine02'), ch: inc(IDLE, 'Spine', 'Spine01') };
const idleNeck = ypr(IDLE.D.neck.clone().multiply(IDLE.D.Spine.clone().invert())), idleHead = ypr(IDLE.D.Head.clone().multiply(IDLE.D.neck.clone().invert()));
function spineD(f, p) {
  const D = {};
  D.Hips = eul(p.pel); D.Spine02 = eul(p.s2).multiply(D.Hips); D.Spine01 = eul(p.s1).multiply(D.Spine02); D.Spine = eul(p.ch).multiply(D.Spine01);
  D.neck = eul(p.neck).multiply(D.Spine); D.Head = eul(p.head).multiply(D.neck);
  return D;
}
function bodyAt(f) {
  const r = {};
  const dp = spl(PLAN.DP, f + LEAD.pel), dsA = (k) => spl(PLAN.DS, f + LEAD[k]);
  r.pel = IP.pel.map((v, i) => v + dp[i]);
  for (const k of ['s2', 's1', 'ch']) { const d = dsA(k); r[k] = IP[k].map((v, i) => v + SHARE[k] * d[i]); }
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  const cp = (r.pel[1] - IP.pel[1]) + (r.s2[1] - IP.s2[1]) + (r.s1[1] - IP.s1[1]) + (r.ch[1] - IP.ch[1]); r.chestPitch = cp;
  // baş: hedefe kilitli (dünya yaw ≈ idle), göğsün öne eğilmesini %80 telafi eder (gözler ileride); boyun %45, baş %55; 1 kare geride
  const yawC = idleNeck[0] + idleHead[0] - (cy - (IP.pel[0] + IP.s2[0] + IP.s1[0] + IP.ch[0]));
  const cpl = (() => { const b = spl(PLAN.DP, f - 1)[1] + spl(PLAN.DS, f - 1.5)[1]; return b; })();
  const pitC = -0.8 * (0.5 * cp + 0.5 * cpl);
  r.neck = [idleNeck[0] + 0.45 * (yawC - idleNeck[0] - idleHead[0]), idleNeck[1] + 0.45 * pitC, idleNeck[2]];
  r.head = [idleHead[0] + 0.55 * (yawC - idleNeck[0] - idleHead[0]), idleHead[1] + 0.55 * pitC, idleHead[2]];
  r.hp = hipsAt(f).toArray();
  return r;
}

// ---- ayaklar (zemin uzayı: top = ayak tabanı ön noktası) ----
const FOOTL = 0.13;
const ankleFromBall = (ball, yaw, pitch) => ball.clone().add(V(0, FOOTL * Math.sin(rad(Math.max(0, pitch))), -FOOTL * Math.cos(rad(Math.max(0, pitch)))).applyQuaternion(Ry(yaw)));
const foot0 = {};
for (const s of ['Left', 'Right']) { const e = ypr(IDLE.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  foot0[s] = { yaw: e[0], pitch: e[1], ball: IDLE.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0]))) }; }
const FP = {};
for (const s of ['Left', 'Right']) { const c = PLAN.feet[s];
  FP[s] = { ...c, end: foot0[s].ball.clone().add(V(0, 0, DIST)), landB: foot0[s].ball.clone().add(V(0, 0, DIST * zFrac(c.land) + c.landOff)) }; }
const onGround = (s, f) => f < FP[s].push || f >= FP[s].land;
function footAt(s, f) {
  const F0 = foot0[s], P = FP[s];
  if (f < P.push) { // itiş: top yerde, topuk kalkar (ileri itişte sağ ayak, geri itişte sol ayak)
    const pitch = (s === (BACK ? 'Left' : 'Right') ? 38 : 10) * smooth(f / P.push);
    return { ankle: ankleFromBall(F0.ball, F0.yaw, pitch), yaw: F0.yaw, pitch }; }
  if (f < P.land) { // salınım: alçak; ileri dodge'da arka ayak önce arkada yukarı savrulur (kick), sonra öne gelir
    const u = (f - P.push) / (P.land - P.push);
    const k = P.kick > 0 ? sst(u) ** 1.25 : sst(Math.min(1, u * 1.05));
    const ball = F0.ball.clone().lerp(P.landB, k);
    ball.y += P.lift * Math.sin(Math.PI * u) ** 1.2 + P.kick * Math.sin(Math.PI * Math.min(1, u / 0.75)) ** 1.5 * (1 - smooth((u - 0.5) / 0.4));
    const pitch0 = s === (BACK ? 'Left' : 'Right') ? 38 : 10;
    const pitch = pitch0 * (1 - smooth(u / 0.25)) + P.swingPitch * Math.sin(Math.PI * Math.min(1, u / 0.85)) * (1 - smooth((u - 0.8) / 0.2));
    return { ankle: ankleFromBall(ball, F0.yaw, pitch), yaw: F0.yaw, pitch }; }
  if (f < P.skidEnd) { // kayarak fren: taban yerde, yavaşlayarak son konuma
    const u = (f - P.land) / (P.skidEnd - P.land); const ball = P.landB.clone().lerp(P.end, easeOut(u));
    return { ankle: ankleFromBall(ball, F0.yaw, 0), yaw: F0.yaw, pitch: 0 }; }
  return { ankle: ankleFromBall(P.end, F0.yaw, 0), yaw: F0.yaw, pitch: 0 };
}

// ===== KILIÇ-ÖNCELİKLİ KOL ÇÖZÜCÜ (heavy-attack-0.mjs; tek el) =====
const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const PP = V(...(prop ? prop.pos : [-0.27084, 0.07551, 0.18772]));
const PSCALE = prop ? prop.scale : 0.92385;
const eW0 = fr0.clone().sub(b0.clone().applyQuaternion(Wr).multiplyScalar(fr0.dot(b0.clone().applyQuaternion(Wr)))).normalize();
const EH = eW0.clone().applyQuaternion(Wr.clone().invert());               // kenar yönü (el-delta çerçevesi): önkol tarafı
const basisQ = (x, y) => { const X = x.clone().normalize(); const Y = y.clone().sub(X.clone().multiplyScalar(y.dot(X))).normalize(); const Z = X.clone().cross(Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); };
const QH0R = basisQ(b0, EH), QH0Ri = QH0R.clone().invert();
const SR = -PP.dot(b0);
const PPpR = PP.clone().sub(b0.clone().multiplyScalar(PP.dot(b0)));
const HALF = 0.5 * PSCALE;
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
const CLAV0 = { Right: IDLE.D.Spine.clone().invert().multiply(IDLE.D.RightShoulder), Left: IDLE.D.Spine.clone().invert().multiply(IDLE.D.LeftShoulder) };
function clavD(s, Dsp, c) { const sg = s === 'Right' ? -1 : 1; return Dsp.clone().multiply(CLAV0[s]).multiply(Rz(sg * c[0])).multiply(Ry(-sg * c[1])); }
function shoulderAt(s, pos0, Dsh) { return pos0[s + 'Shoulder'].clone().add(V(...by[s + 'Arm'].restP).applyQuaternion(Dsh.clone().multiply(restW[s + 'Shoulder']))); }
// gövde + bacaklar: iki eliptik silindir (göğüs, kalça+palto) ve iki bacak kapsülü (uyluk, baldır)
function clearance(pos, D) {
  const upF = D.Spine01.clone().invert(); const loF = D.Hips.clone().invert();
  const segs = [];
  for (const s of ['Left', 'Right']) { segs.push([pos[s + 'UpLeg'], pos[s + 'Leg'], 0.085]); segs.push([pos[s + 'Leg'], pos[s + 'Foot'], 0.065]); }
  return (pt, r) => { let best = 9;
    let l = pt.clone().sub(pos.Spine02).applyQuaternion(upF);
    if (l.y > -0.02 && l.y < 0.5) best = Math.min(best, (Math.hypot(l.x / (0.18 + r), l.z / (0.14 + r)) - 1) * 0.17);
    l = pt.clone().sub(pos.Hips).applyQuaternion(loF);
    if (l.y > -0.3 && l.y < 0.12) best = Math.min(best, (Math.hypot(l.x / (0.24 + r), l.z / (0.18 + r)) - 1) * 0.2);
    for (const [a, b, rr] of segs) best = Math.min(best, segDist(a, b, pt) - rr - r);
    return best; };
}
const GROUND = restPos.LeftToeBase.y - 0.03;

// ---- kılıç yolu ----
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const SWI = (() => { const s = swordFromHand(IDLE.D.RightHand, IDLE.pos.RightHand); return { C: s.C.clone().sub(IDLE.pos.Spine), t: s.t, e: s.e }; })();
const KS = PLAN.KS.map((k) => (k[1] === SW0 ? [k[0], SWI.C.toArray(), SWI.t.toArray(), SWI.e.toArray()] : k));
// yön anahtarları arasında büyük dönüşler (geriye akış ~150°) doğrusal karışımda kısalmasın diye t/e küresel (slerp) ara değerlenir
function designAt(f) {
  const C = V(...spl(KS.map((k) => [k[0], k[1]]), f));
  let i = 0; while (i < KS.length - 2 && f > KS[i + 1][0]) i++;
  const [fa, , ta, ea] = KS[i], [fb, , tb, eb] = KS[i + 1];
  const u = sst((f - fa) / (fb - fa));
  const qa = basisQ(V(...ta), V(...ea)), qb = basisQ(V(...tb), V(...eb));
  const q = qa.clone().slerp(qb, u);
  return { C, t: V(1, 0, 0).applyQuaternion(q), e: V(0, 1, 0).applyQuaternion(q) };
}
const WD = (f) => 1.2;
const WRIST_EXTRA = +(process.env.WRIST_EXTRA || 0);   // yalnız tarama
const SPD = 26;                                       // kemik başı kare hız sınırı (°/kare)

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
  let c = 0; const TT = {};
  c += 4e4 * sq(ikR.err);
  const outR = V(-1, 0, 0).applyQuaternion(D.Spine), down = V(0, -1, 0);
  { const ik = ikR, out = outR, tag = 'R';
    const wm = ik.wmag, wlim = 13.5 + WRIST_EXTRA; c += 0.002 * wm * wm + (wm > wlim ? 4 * sq(wm - wlim) : 0);
    const a = Math.abs(ik.tau); c += (a > 60 ? 0.02 * sq(a - 60) : 0) + (a > 78 ? 3 * sq(a - 78) : 0);
    const b = ik.bend; c += (b < 18 ? 0.3 * sq(18 - b) : 0) + (b > 125 ? 0.3 * sq(b - 125) : 0);
    const h = ik.PH.clone().sub(ik.S).normalize(); const m = ik.E.clone().sub(ik.S); m.sub(h.clone().multiplyScalar(m.dot(h)));
    if (m.length() > 0.01 && ctx.soft > 0) { const pref = out.clone().add(down.clone().multiplyScalar(0.6)).normalize(); c += ctx.soft * 4 * sq(Math.max(0, 0.35 - m.normalize().dot(pref))); }
    const el = ik.E, wr = ik.S.clone().add(ik.u.clone().multiplyScalar(ARM.Right.lu)).add(ik.fd.clone().multiplyScalar(ARM.Right.lf));
    for (const [pt, r] of [[el, 0.06], [el.clone().lerp(wr, 0.5), 0.05], [wr, 0.05]]) { const d = meas(pt, r); if (d < 0.03) c += ctx.soft * 3000 * sq(0.03 - d); TT[tag] = Math.min(TT[tag] ?? 9, d); } }
  const pom = C.clone().add(t.clone().multiplyScalar(-HALF - SR)), tip = C.clone().add(t.clone().multiplyScalar(HALF - SR));
  let bc = 9; for (let s = 0.1; s <= 0.92; s += 0.1) { const d = meas(pom.clone().lerp(tip, s), 0.015); bc = Math.min(bc, d); if (d < 0.03) c += ctx.soft * 3000 * sq(0.03 - d); }
  const hc = segDist(pom, tip, ctx.headC) - 0.13; if (hc < 0.11) c += 20000 * sq(0.11 - hc);
  const tipY = tip.y - GROUND; if (tipY < 0.13) c += 3000 * sq(0.13 - tipY);
  c += 150 * ctx.wd * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) + 0.002 * ctx.wd * (x[3] * x[3] + x[4] * x[4]);
  c += 0.003 * x[5] * x[5] + (Math.abs(x[5]) > 40 ? 3 * sq(Math.abs(x[5]) - 40) : 0);   // ağız dönüşü serbest (dodge'da kesmiyor)
  for (const i of [11, 12]) c += 0.004 * x[i] * x[i] + (Math.abs(x[i]) > 14 ? 1 * sq(Math.abs(x[i]) - 14) : 0);
  if (prev) { c += 1500 * (sq(x[0] - prev[0]) + sq(x[1] - prev[1]) + sq(x[2] - prev[2])); for (let i = 3; i < x.length; i++) c += 0.02 * sq(x[i] - prev[i]); }
  for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > 28 ? 2 * sq(a - 28) : 0); }
  if (ctx.prevTau != null) { const d = Math.abs(ikR.tau - ctx.prevTau); c += 0.004 * d * d + (d > 14 ? 0.3 * sq(d - 14) : 0); }
  if (ctx.prevD) { for (const [Dn, Dp, ax] of [[ikR.DU, ctx.prevD.RU, R.u0], [ikR.DF, ctx.prevD.RF, R.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
      const tw = Math.abs(twistDeg(dq, ax)); if (tw > 9) c += 0.4 * sq(tw - 9); const an = qMag(dq); if (an > SPD) c += 0.3 * sq(an - SPD); } }
  if (ctx.anchor) { const { xa, k } = ctx.anchor; c += k * (3000 * (sq(x[0] - xa[0]) + sq(x[1] - xa[1]) + sq(x[2] - xa[2])) + 0.05 * [3, 4, 5, 7, 8, 11, 12].reduce((a, i) => a + sq(x[i] - xa[i]), 0)); }
  if (!full) return c;
  return { c, C, t, e, DHR, DshR, ikR, tip, tipY, hc, bc, T: TT };
}
let SEED = 12345; const rnd = () => ((SEED = (SEED * 1103515245 + 12345) % 2147483648) / 2147483648);
const STEP0 = [0.02, 0.02, 0.02, 4, 4, 6, 0, 3, 3, 0, 0, 3, 3];
const ACT = [0, 1, 2, 3, 4, 5, 7, 8, 11, 12];
function optimize(ctx, x0, iters = 400, scale = 1) {
  let x = x0.slice(), fx = evalX(ctx, x); let stp = STEP0.map((s) => s * scale);
  for (let it = 0; it < iters; it++) {
    let imp = false;
    for (const i of ACT) {
      for (const sg of [1, -1]) { const y = x.slice(); y[i] += sg * stp[i]; const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; break; } }
    }
    for (let k = 0; k < 6; k++) { const y = x.map((v, i) => v + (rnd() * 2 - 1) * stp[i] * 0.7); const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; } }
    if (!imp) { stp = stp.map((s) => s * 0.5); if (stp[0] < 2e-4) break; }
  }
  return { x, fx };
}

// ---- sol kol serbest: idle pozundan denge pozuna ve geri (göğüs çerçevesinde üst kol yönü + önkol bükülme yönü + dirsek açısı) ----
const chestD = (f) => spineD(f, bodyAt(f)).Spine;
const DcIi = chestD(0).invert(), DcEi = chestD(LEN - 1).invert();
const uLIc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcIi), fLIc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcIi);
const uLEc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcEi), fLEc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcEi);
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
const LU = [[0, uLIc.toArray()], ...PLAN.LU, [LEN - 1, uLEc.toArray()]];
const LF = [[0, flx(uLIc, fLIc).toArray()], ...PLAN.LF, [LEN - 1, flx(uLEc, fLEc).toArray()]];
const BEND_L = [[0, deg(uLIc.angleTo(fLIc))], ...PLAN.BEND, [LEN - 1, deg(uLEc.angleTo(fLEc))]];
const lcache = {};
function leftFree(f) {
  if (lcache[f]) return lcache[f];
  const Dc = chestD(f); const uc = V(...spl(LU, f)).normalize(), bend = spl(BEND_L, f);
  const fx = V(...spl(LF, f)); fx.sub(uc.clone().multiplyScalar(fx.dot(uc))).normalize();
  const u = uc.clone().applyQuaternion(Dc), hint = uc.clone().multiplyScalar(Math.cos(rad(bend))).add(fx.multiplyScalar(Math.sin(rad(bend)))).applyQuaternion(Dc);
  const hg = hinge(RL, bend);
  let base, acc0;
  if (f === 0) { base = IDLE.D.LeftArm.clone(); acc0 = 0; }
  else { const pv = leftFree(f - 1); base = new THREE.Quaternion().setFromUnitVectors(RL.u0.clone().applyQuaternion(pv.arm), u).multiply(pv.arm); acc0 = pv.acc; }
  let best = null;
  const lim = 5;
  const cands = f === 0 ? [0] : Array.from({ length: 21 }, (_, i) => -lim + i * lim / 10).filter((d) => Math.abs(acc0 + d) <= 40);
  for (const d of cands) {
    const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(d)).multiply(base); const fore = arm.clone().multiply(hg);
    const sc = RL.f0.clone().applyQuaternion(fore).angleTo(hint) + 0.003 * Math.abs(acc0 + d);
    if (!best || sc < best.sc) best = { sc, d, arm, fore };
  }
  return (lcache[f] = { arm: best.arm, fore: best.fore, acc: acc0 + best.d, bend });
}

let prevX = null, prevTau = null, prevD = null, DES_OVR = null, WD_OVR = null;
const WRI = swingOf('Right', IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand));
const X0 = [0, 0, 0, 0, 0, 0, 0, WRI[0], WRI[1], 0, 0, 0, 0], XE = X0.slice();
function solve(f) {
  const p = bodyAt(f); const D = spineD(f, p);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(...p.hp));
  p.ground = {};
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s, f);
    p.ground[s] = onGround(s, f);
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    if (p.ground[s] && ft.ankle.distanceTo(hipJ) / (L1 + L2) > 0.962) { // yerde bacak erişimi ≤0,962: topuk kalkar (parmak ucu yerde)
      const pp0 = Math.max(0, ft.pitch); const ball = ft.ankle.clone().sub(V(0, FOOTL * Math.sin(rad(pp0)), -FOOTL * Math.cos(rad(pp0))).applyQuaternion(Ry(ft.yaw)));
      for (let pt = pp0; pt <= 50; pt += 0.5) { const a = ankleFromBall(ball, ft.yaw, pt); ft.ankle = a; ft.pitch = pt; if (a.distanceTo(hipJ) / (L1 + L2) <= 0.962) break; }
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
  const lag = leftFree(Math.max(0, f - 2)).fore; let rl = lF.fore.clone().invert().multiply(lag); const ang = qMag(rl);
  rl = new THREE.Quaternion().slerp(rl, ang > 9 ? 9 / ang : 1); const wf = swingOf('Left', rl);
  const LfDH = lF.fore.clone().multiply(wristQ('Left', wf));
  const Y = new THREE.Quaternion(); const des = DES_OVR ?? designAt(f);
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C), td: des.t.clone(), ed: des.e.clone(), pos0, D,
    meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau };
  const kS = 1 - smooth(f / 4), kE = smooth((f - (LEN - 7)) / 6);
  ctx.wd = WD_OVR ?? WD(f); ctx.f = f; ctx.prevD = prevD;
  ctx.soft = 1 - Math.max(kS, kE); ctx.anchor = kS > 0 ? { xa: X0, k: 4 * kS } : kE > 0 ? { xa: XE, k: 4 * kE } : null;
  const x0 = prevX ? prevX.slice() : X0.slice();
  const opt = f === 0 ? { x: X0.slice(), fx: evalX(ctx, X0) } : optimize(ctx, x0, 400);
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true); prevD = { RU: r.ikR.DU, RF: r.ikR.DF };
  prevTau = r.ikR.tau;
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  D.LeftShoulder = clavD('Left', D.Spine, [0, 0]); D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH;
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.chest = pos0.Spine;
  p.bladeDir = r.t; p.tip = r.tip; p.tipY = r.tipY;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}
const resetSolver = () => { prevX = null; prevTau = null; prevD = null; SEED = 12345; for (const k of Object.keys(lcache)) delete lcache[k]; };

const SCAN = ARGS.find((x) => x.startsWith('--scan='))?.slice(7);
if (SCAN) { // tek karede kılıç yönü taraması: hangi yönler bilek bütçesinde ve gövdeden temiz
  const f = +SCAN; const SG = JSON.parse(ARGS.find((x) => x.startsWith('--grid='))?.slice(7) ?? '{"az":[-180,-165,-150,-135,-120],"el":[-20,-10,0,10],"ro":[-90,-45,0,45,90,135,180]}');
  const res = []; const base = designAt(f);
  for (let ff = 0; ff < f; ff++) solve(ff);
  const pX = prevX, pT = prevTau, pD = prevD;
  for (const az of SG.az) for (const el of SG.el) for (const ro of SG.ro) {
    const [t, e] = th(az, el, ro); DES_OVR = { C: base.C, t: V(...t), e: V(...e) }; WD_OVR = 30;
    prevX = pX ? pX.slice() : null; prevTau = pT; prevD = null;
    const r = solve(f); const R_ = r.p.r;
    res.push({ az, el, ro, c: r.p.cost, w: R_.ikR.wmag, e: R_.ikR.err * 1000, bc: R_.bc, clr: R_.T.R, dev: Math.hypot(r.p.x[0], r.p.x[1], r.p.x[2]) * 100, dt: Math.hypot(r.p.x[3], r.p.x[4]), tau: R_.ikR.tau, bend: R_.ikR.bend });
  }
  prevX = pX; prevTau = pT; prevD = pD; DES_OVR = null; WD_OVR = null;
  res.sort((a, b) => a.c - b.c);
  for (const q of res.slice(0, 20)) console.log('scan', f, 'az', q.az, 'el', q.el, 'ro', q.ro, '| c', q.c.toFixed(1), 'w', q.w.toFixed(0), 'err', q.e.toFixed(0), 'bc', q.bc.toFixed(2), 'clr', q.clr.toFixed(2), 'dev', q.dev.toFixed(1) + 'cm/' + q.dt.toFixed(0) + '°', 'τ', q.tau.toFixed(0), 'bend', q.bend.toFixed(0));
  process.exit(0);
}

resetSolver();
const outs = []; const diag = [];
const t0run = Date.now();
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, tauR: R_.ikR.tau, bendR: R_.ikR.bend, wR: R_.ikR.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reachLeft, r.p.reachRight], ground: r.p.ground, cy: r.p.chestYaw, cp: r.p.chestPitch });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'wR', d.wR.toFixed(1), 'τR', d.tauR.toFixed(0), 'bR', d.bendR.toFixed(0),
  'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'),
  'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2), 'reach', d.reach.map((v) => v.toFixed(3)).join('/'), 'göğüs eğimi', d.cp.toFixed(0));

// ---- idle'a dikiş: kol/bacak kemiklerinin kendi ekseni etrafındaki burulma farkı dünya uzayında söndürülür ----
{ const axisOf = (n, Dq) => restDir(n, bones.find((b) => b.parent === n && !/Thumb|Index|Middle|Ring|Pinky/.test(b.name)).name).applyQuaternion(Dq).normalize();
  const twistAbout = (Dfrom, Dto, ax) => { const d = Dto.clone().multiply(Dfrom.clone().invert()); return twistDeg(d, ax); };
  const F0 = 7, F1 = LEN - 9;
  for (const n of ['RightArm', 'RightForeArm', 'LeftArm', 'LeftForeArm', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']) {
    const a0 = twistAbout(outs[0].D[n], IDLE.D[n], axisOf(n, outs[0].D[n])), aE = twistAbout(outs[LEN - 1].D[n], IDLE.D[n], axisOf(n, outs[LEN - 1].D[n]));
    if (ARGS.includes('--diag')) console.log('burulma dikişi', n, 'baş', a0.toFixed(1), '° son', aE.toFixed(1), '°');
    for (let f = 0; f < LEN; f++) { const k = a0 * (1 - sst(f / F0)) + aE * sst((f - F1) / (LEN - 1 - F1)); if (Math.abs(k) < 1e-4) continue;
      outs[f].D[n] = new THREE.Quaternion().setFromAxisAngle(axisOf(n, outs[f].D[n]), rad(k)).multiply(outs[f].D[n]); } }
  const dL0 = IDLE.D.LeftHand.clone().multiply(outs[0].D.LeftHand.clone().invert()), dLE = IDLE.D.LeftHand.clone().multiply(outs[LEN - 1].D.LeftHand.clone().invert());
  for (let f = 0; f < LEN; f++) { const k0 = 1 - sst(f / 6), kE = sst((f - F1) / (LEN - 1 - F1));
    if (k0 > 0) outs[f].D.LeftHand = powQ(dL0, k0).multiply(outs[f].D.LeftHand); if (kE > 0) outs[f].D.LeftHand = powQ(dLE, kE).multiply(outs[f].D.LeftHand); }
  for (let f = 0; f < LEN; f++) { const D = outs[f].D, cur = {}, out = {};
    for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
      cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ)); out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]); }
    outs[f].out = out; } }
// parmaklar: iki el de idle'daki gibi (sağ el kabzada, sol el serbest) — dikişsiz
const fingerOut = {};
for (const b of bones) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(b.name)) fingerOut[b.name] = Array.from({ length: LEN }, () => IDLE.local[b.name].clone());

// ---- dikiş (0. kare = idle[0]) ve bitiş (son kare = idle[0], yatay kök konumu hariç) ----
const SEAM = 3, SEAM_ARM = 4, SEAM_LEG = 3, ENDB = 6; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const r0 = {}, rE = {}, d0 = {}, dE = {};
for (const n of allNames) { const g0 = genAt(n, 0), gE = genAt(n, LEN - 1);
  r0[n] = g0.clone().invert().multiply(IDLE.local[n]); d0[n] = qAng(g0, IDLE.local[n]);
  rE[n] = gE.clone().invert().multiply(IDLE.local[n]); dE[n] = qAng(gE, IDLE.local[n]); }
const h0 = V(...IDLE.hl).sub(V(...outs[0].hipsLocal));
const hE = V(...IDLE.hl).sub(V(...outs[LEN - 1].hipsLocal)); hE.y = 0; hE.x = 0;   // yalnız yükseklik (yerel z); yatay = kök ilerlemesi
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const wE = smooth((f - (LEN - 1 - ENDB)) / ENDB);
  for (const n of allNames) {
    const sw = /Shoulder|Arm|Hand$/.test(n) ? SEAM_ARM : /Leg|Foot|Toe/.test(n) ? SEAM_LEG : SEAM, w0 = 1 - smooth(f / sw);
    let q = genAt(n, f).clone(); if (w0 > 0) q.multiply(powQ(r0[n], w0)); if (wE > 0) q.multiply(powQ(rE[n], wE));
    if (f === 0) q = IDLE.local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const w0 = 1 - smooth(f / SEAM);
  const hp = V(...outs[f].hipsLocal).add(h0.clone().multiplyScalar(w0)).add(hE.clone().multiplyScalar(wE));
  if (f === 0) hp.set(...IDLE.hl);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}

// ---- kol zinciri yumuşatma (geriye akış + öne savrulma) ve bacak zinciri (kalkış/basış çevresi) ----
const binom = (n, fa, fb, passes) => { for (let pass = 0; pass < passes; pass++) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = Math.max(1, fa); f <= Math.min(LEN - 2, fb); f++) { const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[Math.max(0, Math.min(LEN - 1, f + i - 2))]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
    const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } } };
for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']) binom(n, 2, LEN - 4, 1);
for (const s of ['Left', 'Right']) for (const n of [s + 'UpLeg', s + 'Leg', s + 'Foot', s + 'ToeBase']) { binom(n, FP[s].push - 1, FP[s].push + 1, 1); binom(n, FP[s].land - 1, FP[s].land + 1, 1); }

// ---- rapor (son izlerden FK) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − idle[0] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − idle[0] (sonda söner):', top(dE));
const seamM = (fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = IDLE.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(keyAt(t.rot, fa).slice(1)), qOf(n, fb)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seamM(0, 0), [e0, e0n] = seamM(0, LEN - 1);
console.log(`dikiş: idle[0]→klip[0] max ${s0.toFixed(3)}° (${s0n}) | klip[son]↔idle[0] max ${e0.toFixed(3)}° (${e0n}), kalça yükseklik ${((tracks.Hips.pos[LEN - 1][3] - IDLE.hl[2]) * 100).toFixed(2)} cm, yatay ${(Math.hypot(tracks.Hips.pos[LEN - 1][1] - IDLE.hl[0], tracks.Hips.pos[LEN - 1][2] - IDLE.hl[1]) * 100).toFixed(1)} cm (kök hareketi)`);
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
const REPORT = { name: NAME, len: LEN, sec: +(LEN / 60).toFixed(3) };
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  REPORT['wrist' + s] = { flex: +mx('flex')[0].toFixed(1), dev: +mx('dev')[0].toFixed(1), tot: +mx('tot')[0].toFixed(1), totFrame: mx('tot')[1] };
  console.log(s, 'bilek: fleksiyon max', mx('flex')[0].toFixed(1), '° (kare', mx('flex')[1] + ') | sapma max', mx('dev')[0].toFixed(1), '° (kare', mx('dev')[1] + ') | toplam max', mx('tot')[0].toFixed(1), '° (kare', mx('tot')[1] + ') | burulma max', mx('tw')[0].toFixed(1));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
console.log('β', rng(diag.map((d) => d.x[5])), '| dirsek R', rng(diag.map((d) => d.bendR)), '| τ R', rng(diag.map((d) => d.tauR)), '| klavikula', rng(diag.flatMap((d) => d.x.slice(11))), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°', '| erişim hatası max', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), 'mm');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): kol-gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde/bacak', Math.min(...diag.map((d) => d.bc)).toFixed(3), '(kare', diag.reduce((a, d) => (d.bc < diag[a].bc ? d.f : a), 0) + ') | bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '| uç-yer', Math.min(...diag.map((d) => d.tipY)).toFixed(3));
// kök yolu: kalça ileri ilerlemesi, hız profili, kodun DodgeTravel (ease-out) eğrisiyle fark
const hz = FF.map((k) => k.pos.Hips.z - FF[0].pos.Hips.z);
const travel = hz[LEN - 1];
const spdZ = hz.slice(1).map((z, k) => (z - hz[k]) * 60);
const codeZ = (f) => DIST * easeOut(f / LEN);
REPORT.travel = +travel.toFixed(3); REPORT.peakSpeed = +Math.max(...spdZ.map(Math.abs)).toFixed(1);
console.log('kök: kalça gidişi', (travel * 100).toFixed(1), 'cm | hız (m/s):', spdZ.map((v, k) => k + ':' + v.toFixed(1)).join(' '));
console.log('kodun ease-out eğrisiyle fark max', (Math.max(...hz.map((z, f) => Math.abs(z - codeZ(f)))) * 100).toFixed(1), 'cm (oyunda yol klipten okunacak)');
const footY = [...Array(LEN).keys()].map((f) => [Math.min(FF[f].pos.LeftToeBase.y, FF[f].pos.LeftFoot.y - 0.06) - restPos.LeftToeBase.y, Math.min(FF[f].pos.RightToeBase.y, FF[f].pos.RightFoot.y - 0.06) - restPos.RightToeBase.y]);
const air = [...Array(LEN).keys()].filter((f) => footY[f][0] > 0.012 && footY[f][1] > 0.012);
const hy = FF.map((k) => k.pos.Hips.y - FF[0].pos.Hips.y);
console.log('uçuş (iki ayak havada):', air.length, 'kare', air.length ? '(' + air[0] + '–' + air.at(-1) + ')' : '', '| kalça yükseklik farkı min/max (cm)', (Math.min(...hy) * 100).toFixed(1), '/', (Math.max(...hy) * 100).toFixed(1));
// kaçış penceresi önerisi: gövde alçak (≥6 cm) ve hızlı (tepe hızın ≥%45'i) olan kareler → i-frame için
const pk = Math.max(...spdZ.map(Math.abs)); const esc = [...Array(LEN - 1).keys()].filter((f) => Math.abs(spdZ[f]) >= 0.45 * pk && hy[f + 1] <= -0.06);
REPORT.escape = esc.length ? [esc[0], esc.at(-1) + 1] : null;
console.log('kaçış penceresi (alçak + hızlı):', esc.length ? `kare ${esc[0]}–${esc.at(-1) + 1} = ${(esc[0] / 60).toFixed(3)}–${((esc.at(-1) + 1) / 60).toFixed(3)} sn` : 'yok', '| şimdiki i-frame 0,0167–0,3167 sn (kare 1–19)');
{ const slip = (s, fa, fb) => { let m = 0; for (let f = fa + 1; f <= fb; f++) m = Math.max(m, FF[f].pos[s + 'ToeBase'].distanceTo(FF[fa].pos[s + 'ToeBase'])); return (m * 100).toFixed(1); };
  console.log('yerde ayak: itişte kayma (cm) sol', slip('Left', 0, FP.Left.push - 1), 'sağ', slip('Right', 0, FP.Right.push - 1), '| kayarak fren (cm) sol', slip('Left', FP.Left.land, FP.Left.skidEnd), 'sağ', slip('Right', FP.Right.land, FP.Right.skidEnd), '| fren sonrası kayma sol', slip('Left', FP.Left.skidEnd, LEN - 1), 'sağ', slip('Right', FP.Right.skidEnd, LEN - 1)); }
console.log('bacak erişimi max (yerde)', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3), '| havada', Math.max(...diag.flatMap((d) => [!d.ground.Left ? d.reach[0] : 0, !d.ground.Right ? d.reach[1] : 0])).toFixed(3));
console.log('RAPOR', JSON.stringify(REPORT));

const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
const DUMP = ARGS.find((x) => x.startsWith('--dump='))?.slice(7);
if (DUMP) fs.writeFileSync(DUMP + '/' + NAME + '_cur.json', JSON.stringify(anim));
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log('editöre yüklendi', anim.name, r);
  if (!ARGS.includes('--nosave')) { const s = await (await fetch(BASE + '/api/animations/save?name=' + anim.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', anim.name, s); }
}
