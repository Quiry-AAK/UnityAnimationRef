// game_heavy_attack_0 üretici: boştan basılan açılış ağırı — ileri atılan iki elli dürtme (tsuki), mesafe kapatma.
// 0. kare = game_katana_idle[0]; hazırlıkta sol (ön) ayak ~30 cm öne basar, kalça çöker, gövde sağa kurulur (hanmi), sol el kabzaya
// gelir, kılıç sağ kalçanın önünde yatay ve hedefe nişanlı (ağız aşağı). HOLD karesi şarj boyunca donan bekleme karesidir: ağırlık
// arka (sağ) ayakta, iki ayak yerde, bütün kanalların hızı ≈ 0. Bırakış: arka ayaktan itiş → kısa uçuş → ön ayak basışıyla (fumikomi)
// aynı anda kollar öne uzar, uç düz bir çizgide hedefe gider (yay yok); arka ayak hemen toplanır (hikitsuke), gövde ön ayağın üstüne
// gelir, sol el bırakır, son kare game_katana_idle[0]'a dikişsiz bağlanır (yatay kök konumu hariç: ileri gidiş = kalça ilerlemesi,
// oyunda atılmaya çevrilir; yol kodun ease-out atılma eğrisine göre yazıldı).
// Kılıç-öncelikli çift kol çözücü ve ölçümler light-attack-4.mjs'ten. Yalnız kendi editörüne (UPE_URL / get_status) yükler/kaydeder.
// Çalıştır: node heavy-attack-0.mjs [--nosend] [--nosave] [--diag]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const BASE = process.env.UPE_URL || 'http://127.0.0.1:5184';   // bu oturumun editörü: MCP get_status editorUrl (port yeniden başlatmada değişir)
const NAME = 'game_heavy_attack_0', PREVIEW = 'preview_heavy_attack_0_charged';
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
const ARGS = process.argv.slice(2); const NOSEND = ARGS.includes('--nosend');
const qAng = (a, b) => deg(2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))));
const qMag = (q) => deg(2 * Math.acos(Math.min(1, Math.abs(q.w))));
const powQ = (q, k) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const a = 2 * Math.acos(Math.min(1, q.w));
  return a < 1e-6 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(V(q.x, q.y, q.z).normalize(), a * k); };
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const sst = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (10 - 15 * t + 6 * t * t); };

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

// ---- Zaman çizelgesi (68 kare = 1,13 sn @60) ----
// 0–8 başlangıç (sol el kabzaya yola çıkar), 5–14 sol ayak öne adım, 8–22 kurulma (çöküş + sağa dönüş), 22–26 bekleme düzlüğü,
// HOLD = 24 bekleme karesi; 24–28 itiş, 28 arka ayak kopar, 28–38 uçuş + kolların uzaması, 36 vuruş (uç hızı tepesi),
// 38 ön ayak basışı (tam uzanma), 38–48 arka ayak toplanır, 48–67 toparlanma + bitiş harmanı.
const LEN = 68, HOLD = 24, TOFF_R = 28, LIFT_L = 25, STAMP = 38, HITF = 36, LAND_R = 48;
const LUNGE = 1.5, LS = HOLD, LE = 54, BACK = 0.02;         // kalça ileri yolu: HOLD'dan LE'ye ease-out (kodun eğrisi), toplam 1,5 m
const I0 = IDLE.hipsPos.clone().sub(restPos.Hips);
const EO = (u) => { u = Math.max(0, Math.min(1, u)); return 1 - (1 - u) * (1 - u); };
// ease-out'un başlangıç köşesi Gauss (σ 0,8 kare) ile yumuşatılır: bırakış ~2 karede hızlanır (atılma eğrisi farkı ~3 cm)
const zLunge = (() => { const o = []; const sg = 0.8; for (let f = 0; f < LEN + 4; f++) { let a = 0, w = 0;
  for (let k = -40; k <= 40; k++) { const x = f + k * 0.1, g = Math.exp(-0.5 * (k * 0.1 / sg) ** 2); a += g * EO((x - LS) / (LE - LS)); w += g; } o.push(a / w); } return o; })();
const Y_KEYS = [[0, 0], [8, -0.06], [13, -0.18], [17, -0.19], [21, -0.21], [HOLD, -0.215], [TOFF_R, -0.085], [33, -0.06], [STAMP, -0.115], [41, -0.165], [46, -0.15], [53, -0.085], [60, -0.025], [LEN - 1, 0]];
const X_KEYS = [[0, 0], [10, -0.01], [21, -0.05], [HOLD, -0.052], [32, 0], [41, 0.015], [52, 0.005], [LEN - 1, 0]];
function hipsAt(f) {
  const y = I0.y + spl(Y_KEYS, f), x = I0.x + spl(X_KEYS, f);
  const z = I0.z - BACK * sst(f / 20) + (LUNGE + BACK) * zLunge[Math.max(0, Math.min(zLunge.length - 1, Math.round(f)))] * (f >= LS - 3 ? 1 : 0);
  return V(x, y, z);
}

// ---- gövde: idle artımlarına eklenen farklar (yaw, pitch +öne, roll) ----
const T = { start: 0, load: 8, coil: 20, hold: HOLD, rel: 26, push: 29, drive: 31, hit: 34, ext: 38, follow: 44, rec1: 50, flick: 55, rec2: 61, rest: LEN - 1 };
const DP = {   // pelvis farkı
  start: [0, 0, 0], load: [-5, 1, 0], coil: [-26, 3, -3], hold: [-27, 3, -3], rel: [-29, -1, -3], push: [-8, 10, 0], drive: [1, 17, 1], hit: [6, 21, 1],
  ext: [7, 18, 0], follow: [5, 12, 0], rec1: [2, 6, 0], flick: [-3, 4, 0], rec2: [0, 1.5, 0], rest: [0, 0, 0] };
const DS = {   // omurga toplam farkı (göğüs − pelvis), Spine02/Spine01/Spine'a 0,25/0,35/0,40 paylaşılır
  start: [0, 0, 0], load: [-3, -3, 0], coil: [-15, -11, 3], hold: [-16, -11, 3], rel: [-18, -14, 3], push: [-5, -2, 0], drive: [1, 5, 0], hit: [5, 7, 0],
  ext: [6, 7, 0], follow: [3, 4, 0], rec1: [1, 2, 0], flick: [-5, 1, -1], rec2: [0, 0, 0], rest: [0, 0, 0] };
const SHARE = { s2: 0.25, s1: 0.35, ch: 0.4 };
const LEAD = { pel: 1.2, s2: 0.6, s1: 0, ch: -0.6 };      // kinetik zincir: pelvis önde, göğüs geride (bekleme düzlüğü içinde kalır)
const names = Object.keys(T);
const inc = (C, c, p) => ypr(C.D[c].clone().multiply(C.D[p].clone().invert()));
const IP = { pel: ypr(IDLE.D.Hips), s2: inc(IDLE, 'Spine02', 'Hips'), s1: inc(IDLE, 'Spine01', 'Spine02'), ch: inc(IDLE, 'Spine', 'Spine01') };
const idleNeck = ypr(IDLE.D.neck.clone().multiply(IDLE.D.Spine.clone().invert())), idleHead = ypr(IDLE.D.Head.clone().multiply(IDLE.D.neck.clone().invert()));
// canlılık katmanı (gövde çerçevesinde fleksiyon + öne / yan eğilme + sola), yaylı gecikmeyle omurgada aşağıdan yukarı
const LIFE_F = [[0, 0], [8, 2], [20, 5], [HOLD, 5], [26, 7], [29, -5], [32, -3], [35, 6], [39, 12], [42, 6], [45, 8], [50, 3], [55, 5], [60, 1], [LEN - 1, 0]];
const LIFE_L = [[0, 0], [10, -2], [20, -4], [HOLD, -4], [26, -5], [30, 2], [35, 4], [40, 2], [48, 0], [54, -5], [58, -2], [LEN - 1, 0]];
const springF = (arr, w, z) => { let x = arr[0], v = 0; return arr.map((t) => { v += w * w * (t - x) - 2 * z * w * v; x += v; return x; }); };
const LIFE = (() => {
  const fr = [...Array(LEN + 2).keys()];
  const seg = (keys, lag, w, z) => springF(fr.map((f) => spl(keys, Math.max(0, f - lag))), w, z);
  const o = { s2: [seg(LIFE_F, 0, 0.9, 0.7), seg(LIFE_L, 0, 0.9, 0.7)], s1: [seg(LIFE_F, 0.8, 0.8, 0.65), seg(LIFE_L, 0.8, 0.8, 0.65)], ch: [seg(LIFE_F, 1.6, 0.7, 0.6), seg(LIFE_L, 1.6, 0.7, 0.6)] };
  const SH = { s2: 0.55, s1: 0.55, ch: 0.45 };
  for (const k of Object.keys(SH)) o[k] = o[k].map((a) => a.map((v) => v * SH[k]));
  return o;
})();
const lifeAt = (f) => { const i = Math.max(0, Math.min(LEN - 1, Math.round(f))); const g = (k) => [LIFE[k][0][i], LIFE[k][1][i]]; return { s2: g('s2'), s1: g('s1'), ch: g('ch') }; };
const Eb = (yw, pr) => Ry(yw).multiply(Rx(pr[0])).multiply(Rz(-pr[1])).multiply(Ry(-yw));
function spineD(f, p) {
  const D = {}; const L = lifeAt(f);
  D.Hips = eul(p.pel); D.Spine02 = eul(p.s2).multiply(D.Hips); D.Spine01 = eul(p.s1).multiply(D.Spine02); D.Spine = eul(p.ch).multiply(D.Spine01);
  const y2 = p.pel[0] + p.s2[0], y1 = y2 + p.s1[0], yc = y1 + p.ch[0];
  const E2 = Eb(y2, L.s2), E1 = Eb(y1, L.s1), E3 = Eb(yc, L.ch);
  D.Spine02 = E2.clone().multiply(D.Spine02); D.Spine01 = E2.clone().multiply(E1).multiply(D.Spine01); D.Spine = E2.clone().multiply(E1).multiply(E3).multiply(D.Spine);
  D.neck = eul(p.neck).multiply(D.Spine); D.Head = eul(p.head).multiply(D.neck);
  return D;
}
const BREATH = (f) => Math.sin(2 * Math.PI * f / 44);
function bodyAt(f) {
  const r = {};
  const dp = spl(names.map((n) => [T[n], DP[n]]), f + LEAD.pel), dsA = (k) => spl(names.map((n) => [T[n], DS[n]]), f + LEAD[k]);
  r.pel = IP.pel.map((v, i) => v + dp[i]);
  for (const k of ['s2', 's1', 'ch']) { const d = dsA(k); r[k] = IP[k].map((v, i) => v + SHARE[k] * d[i]); }
  // nefes: bekleme karesinde de canlı kalsın diye çok küçük (donunca titremeyi kod ekler)
  r.ch[1] += 0.6 * BREATH(f); r.s1[1] += 0.35 * BREATH(f + 4);
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  const cp = (r.pel[1] - IP.pel[1]) + (r.s2[1] - IP.s2[1]) + (r.s1[1] - IP.s1[1]) + (r.ch[1] - IP.ch[1]); r.chestPitch = cp;
  // baş: hedefe kilitli (dünya yaw ≈ idle), göğsün öne eğilmesini %75 telafi eder; boyun %45, baş %55
  const yawC = idleNeck[0] + idleHead[0] - (cy - (IP.pel[0] + IP.s2[0] + IP.s1[0] + IP.ch[0]));
  const pitC = -0.75 * cp + 7 * smooth((f - 12) / 10) * (1 - smooth((f - 30) / 6));   // beklemede çene hafif aşağı (hedefe odak)
  r.neck = [idleNeck[0] + 0.45 * (yawC - idleNeck[0] - idleHead[0]), idleNeck[1] + 0.45 * pitC, idleNeck[2]];
  r.head = [idleHead[0] + 0.55 * (yawC - idleNeck[0] - idleHead[0]), idleHead[1] + 0.55 * pitC, idleHead[2] + 0.5 * Math.sin(f * 0.09 + 1)];
  r.hp = hipsAt(f).toArray();
  return r;
}

// ---- ayaklar (zemin uzayı: top = ayak tabanı ön noktası) ----
const FOOTL = 0.13;
const ankleFromBall = (ball, yaw, pitch) => ball.clone().add(V(0, FOOTL * Math.sin(rad(Math.max(0, pitch))), -FOOTL * Math.cos(rad(Math.max(0, pitch)))).applyQuaternion(Ry(yaw)));
const foot0 = {};
for (const s of ['Left', 'Right']) { const e = ypr(IDLE.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  foot0[s] = { yaw: e[0], pitch: e[1], ball: IDLE.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0]))) }; }
const footEnd = {}; for (const s of ['Left', 'Right']) footEnd[s] = { yaw: foot0[s].yaw, pitch: foot0[s].pitch, ball: foot0[s].ball.clone().add(V(0, 0, LUNGE)) };
const LHOLD = { yaw: foot0.Left.yaw - 10, ball: foot0.Left.ball.clone().add(V(0.08, 0, 0.5)) };  // hazırlık adımı: geniş, alçak duruş (hanmi)
const RYAW = foot0.Right.yaw - 36;                                                                 // arka ayak top üstünde dışa döner
const PHASE = { Left: [[0, 5, 'g0'], [5, 14, 's1'], [14, LIFT_L, 'gH'], [LIFT_L, STAMP, 's2'], [STAMP, LEN, 'gE']],
  Right: [[0, 8, 'g0'], [8, 21, 'pv'], [21, TOFF_R, 'push'], [TOFF_R, LAND_R, 's2'], [LAND_R, LEN, 'gE']] };
const onGround = (s, f) => { for (const [a, b, k] of PHASE[s]) if (f >= a && f < b) return k[0] === 'g' || k === 'pv' || k === 'push'; return true; };
function footAt(s, f) {
  const F0 = foot0[s], FE = footEnd[s];
  if (s === 'Left') {
    if (f < 5) return { ankle: ankleFromBall(F0.ball, F0.yaw, 0), yaw: F0.yaw, pitch: 0 };
    if (f < 14) { const k = sst((f - 5) / 9); const ball = F0.ball.clone().lerp(LHOLD.ball, k); ball.y += 0.055 * Math.sin(Math.PI * k);
      const yaw = F0.yaw + (LHOLD.yaw - F0.yaw) * k; const pitch = k < 0.7 ? 14 * Math.sin(Math.PI * k / 0.7) : 0;
      return { ankle: ankleFromBall(ball, yaw, pitch), yaw, pitch: Math.max(0, pitch) }; }
    if (f < LIFT_L) return { ankle: ankleFromBall(LHOLD.ball, LHOLD.yaw, 0), yaw: LHOLD.yaw, pitch: 0 };
    if (f < STAMP) { const u = (f - LIFT_L) / (STAMP - LIFT_L); const k = sst(Math.min(1, u * 1.08)); const ball = LHOLD.ball.clone().lerp(FE.ball, k);
      ball.y += 0.16 * Math.sin(Math.PI * Math.min(1, u * 1.12)) ** 1.3;                         // diz sürüşü: ayak alçak ve önde
      const yaw = LHOLD.yaw + (FE.yaw - LHOLD.yaw) * k; const pitch = u < 0.35 ? 24 * Math.sin(Math.PI * u / 0.35) : 0;
      return { ankle: ankleFromBall(ball, yaw, pitch), yaw, pitch }; }
    return { ankle: ankleFromBall(FE.ball, FE.yaw, 0), yaw: FE.yaw, pitch: 0 };
  }
  // sağ (arka): top üstünde dönüş → itiş (topuk kalkar) → salınım → toplanma
  if (f < 8) return { ankle: ankleFromBall(F0.ball, F0.yaw, 0), yaw: F0.yaw, pitch: 0 };
  if (f < TOFF_R) { const yaw = F0.yaw + (RYAW - F0.yaw) * sst((f - 8) / 13); const pitch = f < HOLD ? 0 : 46 * sst((f - HOLD) / (TOFF_R - HOLD));
    return { ankle: ankleFromBall(F0.ball, yaw, pitch), yaw, pitch }; }
  if (f < LAND_R) { const u = (f - TOFF_R) / (LAND_R - TOFF_R); const k = sst(u); const ball = F0.ball.clone().lerp(FE.ball, k);
    ball.y += 0.085 * Math.sin(Math.PI * u) ** 1.2;
    const yaw = RYAW + (FE.yaw - RYAW) * sst(u * 1.3); const pitch = 46 * (1 - smooth(u / 0.6)) + 12 * Math.sin(Math.PI * u) * (1 - smooth((u - 0.8) / 0.2));
    return { ankle: ankleFromBall(ball, yaw, pitch), yaw, pitch }; }
  return { ankle: ankleFromBall(FE.ball, FE.yaw, 0), yaw: FE.yaw, pitch: 0 };
}

// ===== KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ (light-attack-4.mjs) =====
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

// ---- kılıç yolu (dünya-yaw çerçevesi = hedef yönü; göğüs eklemine göre; x sol, y yukarı, z ileri). e: ağız (= önkol tarafı) ----
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const SWI = (() => { const s = swordFromHand(IDLE.D.RightHand, IDLE.pos.RightHand); return { C: s.C.clone().sub(IDLE.pos.Spine), t: s.t, e: s.e }; })();
// dürtme yönü: az = yaw (+ sola, hedef çizgisine içe), el = yükselme; ağız aşağı, ro ile ağız sağa (−) / sola (+) döner
const th = (az, el, ro = 0) => { const t = V(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)));
  const e0 = V(0, -1, 0); e0.sub(t.clone().multiplyScalar(e0.dot(t))).normalize(); const e = e0.clone().multiplyScalar(Math.cos(rad(ro))).add(t.clone().cross(e0).multiplyScalar(Math.sin(rad(ro))));
  return [t.toArray(), e.toArray()]; };
const KS = [
  [0, SWI.C.toArray(), SWI.t.toArray(), SWI.e.toArray()],
  [6, [-0.245, -0.37, 0.08], ...th(3, -6, 12)],                               // 1. evre: eller kalkar ve öne gelir, uç hafif kalkar
  [12, [-0.185, -0.18, 0.19], ...th(-2, 3, 48)],
  [16, [-0.18, -0.17, 0.195], ...th(-2.5, 3.5, 50)],                         // duraklama: kılıç bir an durur, sol el kabzaya oturur
  [20, [-0.13, -0.01, 0.27], ...th(-5, 0, 60)],                              // 2. evre: eller omuza kalkar                              // 2. evre: eller omuza kalkar, bıçak yatay ve düz ileri
  [22, [-0.105, 0.065, 0.32], ...th(-6, -2, 60)],
  [HOLD, [-0.1, 0.075, 0.33], ...th(-6, -2, 60)],                              // BEKLEME karesi: eller sağ omuz hizasında, bıçak yatay, uç hedefte (sağ bilek istisnası)
  [26, [-0.105, 0.085, 0.3], ...th(-7, -1, 60)],                               // bırakış öncesi küçük geri çekiliş (kurma)
  [27, [-0.105, 0.085, 0.298], ...th(-7, -1, 60)],
  [29, [-0.09, 0.06, 0.355], ...th(-4, -2, 60)],                              // önce bacak iter, gövde açılır
  [31, [-0.068, 0.03, 0.425], ...th(-1, -2, 60)],                                // vuruş: eller omuzdan düz ileri sürülür, bıçak yatay
  [33, [-0.054, 0.0, 0.468], ...th(1, -2, 60)],
  [35, [-0.05, -0.02, 0.482], ...th(2, -2, 60)],                             // aşma: kollar bir tık fazla uzanır
  [STAMP, [-0.052, -0.03, 0.46], ...th(2, -3, 60)],                          // basış: darbe, uç hafif düşer
  [42, [-0.055, -0.035, 0.455], ...th(2, -2, 60)],                             // geri yaylanıp oturur
  [46, [-0.08, -0.12, 0.4], ...th(1, 0, 45)],
  [50, [-0.12, -0.28, 0.27], ...th(-5, -4, 10)],                             // sol el bırakır, kılıç sağ elde iner
  [54, [-0.25, -0.38, 0.17], ...th(-26, -14, -12)],                          // chiburi: kol, kılıcı sağa-aşağı silkeler
  [56, [-0.3, -0.4, 0.12], ...th(-33, -20, -18)],
  [61, [-0.28, -0.45, 0.05], ...th(-6, -15, -18)],                           // idle'ın öne uzanan duruşuna döner
  [LEN - 1, SWI.C.toArray(), SWI.t.toArray(), SWI.e.toArray()],
];
const WD = (f) => 1 + 8 * smooth((f - 14) / 6) * (1 - smooth((f - 27) / 3)) + 6 * smooth((f - 30) / 3) * (1 - smooth((f - 43) / 4));   // tasarım ağırlığı (bekleme + vuruş)
const WRIST_EXTRA = +(process.env.WRIST_EXTRA || 0);   // yalnız tarama: bilek sınırını gevşetip gereken bilek açısını ölçmek için
// H0 bilek istisnası (kullanıcı onayı 2026-10-25): omuz hizasında yatay bıçak için sağ bilek bekleme + vuruş penceresinde ~20° ek pay; sol bilek bütçede
const WXW = (f) => smooth((f - 12) / 8) * (1 - smooth((f - 46) / 8)); const WXR = (f) => 20 * WXW(f), WXL = (f) => 0 * WXW(f);
const KINK = (f) => 0.6 * smooth((f - 12) / 8) * (1 - smooth((f - 44) / 8));   // kullanıcı: bıçak kolun devamı gibi (bilek bükülü, bütçe içinde)
const SPD = (f) => (f <= 5 ? 5 : f >= 28 && f <= 40 ? 22 : 11);
function designAt(f) {
  const r = spl(KS.map((k) => [k[0], [...k[1], ...k[2], ...k[3]]]), f);
  const t = V(r[3], r[4], r[5]).normalize(); const e = V(r[6], r[7], r[8]); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return { C: V(r[0], r[1], r[2]), t, e };
}
const TWO = (f) => smooth((f - 9) / 12) * (1 - smooth((f - 43) / 9));   // iki el: 9–21 kavrar, 43–52 bırakır (chiburi tek elle)
const GRIP = TWO;

// ---- maliyet (light-attack-4.mjs) ----
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
    const wm = ik.wmag, wlim = (tag === 'R' ? 13.5 + 1.0 * ctx.kink + WXR(ctx.f) : 13.5 + WXL(ctx.f)) + WRIST_EXTRA; c += 0.002 * wm * wm + (wm > wlim ? 4 * sq(wm - wlim) : 0);
    if (tag === 'R' && ctx.kink > 0) { const kk = deg(ik.fd.angleTo(t)); c += ctx.kink * 0.05 * sq(Math.max(0, kk - 44)) + ctx.kink * 0.03 * sq(x[5]); }   // ağız aşağıda kalsın (β)
    const a = Math.abs(ik.tau); c += (a > 60 ? 0.02 * sq(a - 60) : 0) + (a > 78 ? 3 * sq(a - 78) : 0);
    const b = ik.bend; c += (b < 22 ? 0.3 * sq(22 - b) : 0) + (b > 125 ? 0.3 * sq(b - 125) : 0);
    const h = ik.PH.clone().sub(ik.S).normalize(); const m = ik.E.clone().sub(ik.S); m.sub(h.clone().multiplyScalar(m.dot(h)));
    if (m.length() > 0.01 && ctx.soft > 0) { const pref = out.clone().add(down.clone().multiplyScalar(0.6)).normalize(); c += ctx.soft * 4 * sq(Math.max(0, 0.35 - m.normalize().dot(pref))); }
    const el = ik.E, wr = ik.S.clone().add(ik.u.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lu)).add(ik.fd.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lf));
    for (const [pt, r] of [[el, 0.06], [el.clone().lerp(wr, 0.5), 0.05], [wr, 0.05]]) { const d = meas(pt, r); if (d < 0.03) c += ctx.soft * 3000 * sq(0.03 - d); TT[tag] = Math.min(TT[tag] ?? 9, d); }
  }
  const pom = C.clone().add(t.clone().multiplyScalar(-HALF - SR)), tip = C.clone().add(t.clone().multiplyScalar(HALF - SR));
  let bc = 9; for (let s = 0.1; s <= 0.92; s += 0.1) { const d = meas(pom.clone().lerp(tip, s), 0.015); bc = Math.min(bc, d); if (d < 0.03) c += 3000 * sq(0.03 - d); }
  const hc = segDist(pom, tip, ctx.headC) - 0.13; if (hc < 0.11) c += 20000 * sq(0.11 - hc);
  const tipY = tip.y - GROUND; if (tipY < 0.13) c += 3000 * sq(0.13 - tipY);
  c += 150 * ctx.wd * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) + 0.002 * ctx.wd * (1 + 6 * ctx.kink) * (x[3] * x[3] + x[4] * x[4]);   // kullanıcı pozu: bıçak yönü sıkı
  c += 0.003 * x[5] * x[5] + (Math.abs(x[5]) > 24 ? 3 * sq(Math.abs(x[5]) - 24) : 0);
  { const cl = 12 + 8 * WXW(ctx.f); for (const i of [11, 12, 13, 14]) c += 0.004 * x[i] * x[i] + (Math.abs(x[i]) > cl ? 1 * sq(Math.abs(x[i]) - cl) : 0); }   // omuz hizasında köprücükler biraz kalkar (≤20°)
  if (prev) { c += 3000 * (sq(x[0] - prev[0]) + sq(x[1] - prev[1]) + sq(x[2] - prev[2])); for (let i = 3; i < x.length; i++) c += (i === 6 ? 0.1 : 0.03) * sq(x[i] - prev[i]);
    const dg = Math.abs(x[6] - prev[6]); if (dg > 3) c += 2 * sq(dg - 3); }
  { const cap = ctx.f >= 31 && ctx.f <= 43 ? 8 : 22; for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > cap ? 2 * sq(a - cap) : 0); } }
  if (ctx.prevTau) { for (const [ik, k] of [[ikR, 'R'], [ikL, 'L']]) { if (!ik || ctx.prevTau[k] == null) continue; const d = Math.abs(ik.tau - ctx.prevTau[k]); c += 0.006 * d * d + (d > 10 ? 0.3 * sq(d - 10) : 0); } }
  if (ctx.gam0 != null) { const d = Math.abs(x[6] - ctx.gam0); if (d > 14) c += 0.5 * sq(d - 14); }
  if (ctx.prevD) { const lim = SPD(ctx.f);
    for (const [ik, k, H] of [[ikR, 'R', R], [ikL, 'L', RL]]) { if (!ik || !ctx.prevD[k + 'U']) continue;
      for (const [Dn, Dp, ax] of [[ik.DU, ctx.prevD[k + 'U'], H.u0], [ik.DF, ctx.prevD[k + 'F'], H.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
        const tw = Math.abs(twistDeg(dq, ax)); if (tw > 6.5) c += 0.4 * sq(tw - 6.5); if (ctx.f <= 6) { const an = qMag(dq); if (an > lim) c += 0.3 * sq(an - lim); } } } }
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

// ---- sol kol serbest (kavrama dışı): idle pozundan kabzaya / kabzadan idle'a; ön geçişte kavrama başı/sonu IK pozuna eşitlenir ----
const chestD = (f) => spineD(f, bodyAt(f)).Spine;
const DcIi = chestD(0).invert(), DcEi = chestD(LEN - 1).invert();
const uLIc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcIi), fLIc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcIi);
const uLEc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcEi), fLEc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcEi);
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
const LU = [[0, uLIc.toArray()], [19, [-0.2, -0.85, 0.48]], [45, [-0.2, -0.85, 0.48]], [LEN - 1, uLEc.toArray()]];
const LF = [[0, flx(uLIc, fLIc).toArray()], [19, [-0.6, 0.1, 0.8]], [45, [-0.6, 0.1, 0.8]], [LEN - 1, flx(uLEc, fLEc).toArray()]];
const BEND_L = [[0, deg(uLIc.angleTo(fLIc))], [19, 40], [45, 40], [LEN - 1, deg(uLEc.angleTo(fLEc))]];
const lcache = {}; const TAUF = { a: 0, b: 0 };
const tauFree = (f) => (f <= 30 ? TAUF.a * sst(f / 19) : TAUF.b * (1 - sst((f - 45) / 18)));
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
  const lim = Math.min(4, 0.6 + 0.4 * f);
  const cands = f === 0 ? [0] : Array.from({ length: 17 }, (_, i) => -lim + i * lim / 8).filter((d) => Math.abs(acc0 + d) <= 35);
  for (const d of cands) {
    const arm = new THREE.Quaternion().setFromAxisAngle(u, rad(d)).multiply(base); const fore = arm.clone().multiply(hg).multiply(new THREE.Quaternion().setFromAxisAngle(RL.f0, rad(tauFree(f))));
    const sc = RL.f0.clone().applyQuaternion(fore).angleTo(hint) + 0.003 * Math.abs(acc0 + d);
    if (!best || sc < best.sc) best = { sc, d, arm, fore };
  }
  return (lcache[f] = { arm: best.arm, fore: best.fore, acc: acc0 + best.d, bend });
}

let prevX = null, prevTau = null, prevD = null, GAM0 = null, DES_OVR = null, WD_OVR = null;
const WRI = swingOf('Right', IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand));
const X0 = [0, 0, 0, 0, 0, 0, 0, WRI[0], WRI[1], 0, 0, 0, 0, 0, 0], XE = X0.slice();
const GRIP_IN = 9, GRIP_FULL = 21;
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
      const kt = 1 - sst((f - 0) / 8) * 0;                                                       // idle çerçevesine yakın: harman dikişte
      const td = knee.clone().sub(hipJ).normalize(), sd = ankle.clone().sub(knee).normalize();
      const swU = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), td), swL = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), sd);
      D[s + 'UpLeg'] = swU.slerp(fr(restDir(s + 'UpLeg', s + 'Leg'), td), kt);
      D[s + 'Leg'] = swL.slerp(fr(restDir(s + 'Leg', s + 'Foot'), sd), kt); }
    D[s + 'Foot'] = eul([ft.yaw, ft.pitch, 0]);
    { // ayak parmakları: yerde taban düz (topuk kalkınca parmaklar yerde kırılır), havada hafif uzanır
      const bend = p.ground[s] ? -Math.min(Math.max(0, ft.pitch), 44) : -Math.min(Math.max(0, ft.pitch), 44) * 0.4 + 6;
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
  const Y = new THREE.Quaternion(); const des = DES_OVR ?? designAt(f);
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C), td: des.t.clone(), ed: des.e.clone(), pos0, D, g,
    Lf: { P: LfP, DH: LfDH }, meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, wf };
  const kS = 1 - smooth(f / 7), kE = smooth((f - 52) / 15);
  ctx.wd = WD_OVR ?? WD(f); ctx.f = f; ctx.kink = KINK(f); ctx.prevD = prevD; ctx.gam0 = g > 0 ? GAM0 : null;
  ctx.soft = 1 - Math.max(kS, kE); ctx.anchor = kS > 0 ? { xa: X0, k: 4 * kS } : kE > 0 ? { xa: XE, k: 4 * kE } : null;
  let x0 = prevX ? prevX.slice() : X0.slice();
  if (g <= 0) { x0[9] = wf[0]; x0[10] = wf[1]; x0[13] = 0; x0[14] = 0; if (ctx.prev) { ctx.prev = ctx.prev.slice(); ctx.prev[9] = wf[0]; ctx.prev[10] = wf[1]; } }
  if (g > 0 && prevX && TWO(f - 1) <= 0) { // kavramanın ilk karesi: γ taraması (tam tur, sonra merkez)
    let best = null; const pv = prevX.slice(); pv[9] = wf[0]; pv[10] = wf[1];
    const gc = GAMC ?? 0; const range = GAMC == null ? [...Array(24).keys()].map((i) => i * 15) : [...Array(7).keys()].map((i) => gc - 15 + 5 * i);
    for (const gm of range) { const xs = x0.slice(); xs[6] = gm; ctx.prev = pv.slice(); ctx.prev[6] = gm; const r = optimize(ctx, xs, 80); if (!best || r.fx < best.fx) best = r; }
    x0 = best.x; ctx.prev = pv; ctx.prev[6] = x0[6]; GAM0 = x0[6];
  }
  ctx.gam0 = g > 0 ? GAM0 : null;
  const opt = f === 0 ? { x: X0.slice(), fx: evalX(ctx, X0) } : optimize(ctx, x0, 400);
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true); prevD = { RU: r.ikR.DU, RF: r.ikR.DF, LU: r.ikL ? r.ikL.DU : null, LF: r.ikL ? r.ikL.DF : null };
  prevTau = { R: r.ikR.tau, L: r.ikL ? r.ikL.tau : null };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  if (r.ikL) { D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
    if (g < 0.95) { const k = smooth(1 - g / 0.95); D.LeftShoulder = r.DshL.clone().slerp(clavD('Left', D.Spine, [0, 0]), k); D.LeftArm = r.ikL.DU.clone().slerp(lF.arm, k); D.LeftForeArm = r.ikL.DF.clone().slerp(lF.fore, k); D.LeftHand = r.ikL.DH.clone().slerp(LfDH, k); } }
  else { D.LeftShoulder = clavD('Left', D.Spine, [0, 0]); D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH; }
  const { pos, out } = fkPos();
  if (f === 0 && ARGS.includes('--dbg0')) { for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Hips', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'neck', 'Head'])
      console.log('dbg0', n, 'world diff', qAng(D[n] || new THREE.Quaternion(), IDLE.D[n]).toFixed(1), 'pos diff cm', (pos[n].distanceTo(IDLE.pos[n]) * 100).toFixed(1));
    const wq = IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand); console.log('idle wrist twist', twistDeg(wq, R.f0).toFixed(1), 'tot', qMag(wq).toFixed(1)); }
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.gw = g; p.chest = pos0.Spine;
  p.bladeDir = r.t; p.tip = r.tip; p.tipY = r.tipY;
  p.handFwd = Math.min(pos.RightHand.clone().sub(pos.Spine).z, pos.LeftHand.clone().sub(pos.Spine).z);
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// ön geçiş: (1) tam tur γ taraması → merkez; (2) sol kolun serbest anahtarlarını kavrama başı/sonu IK pozuna eşitle
let GAMC = null; const GAM_DIK = 222;   // omuz hizası bekleme + boyun hizası vuruşta sol elin kabza etrafındaki dönüşü (tarama: ikisi de 225 civarında)
const resetSolver = () => { prevX = null; prevTau = null; prevD = null; GAM0 = null; SEED = 12345; for (const k of Object.keys(lcache)) delete lcache[k]; };
{ GAMC = GAM_DIK; console.log('γ merkezi (dik bıçak taraması):', GAMC.toFixed(0)); resetSolver();
  const cap = {};
  for (let f = 0; f < LEN; f++) { const r = solve(f); if (f === GRIP_FULL || f === 43) { const ik = r.p.r.ikL; const Di = chestD(f).invert(); const uc = ik.u.clone().applyQuaternion(Di), fc = ik.fd.clone().applyQuaternion(Di); cap[f] = { u: uc.toArray(), fx: flx(uc, fc).toArray(), b: ik.bend, tau: ik.tau }; } }
  resetSolver();
  const setK = (arr, f, v) => { const i = arr.findIndex((k) => k[0] === f); if (i >= 0) arr[i] = [f, v]; else { arr.push([f, v]); arr.sort((x, y) => x[0] - y[0]); } };
  TAUF.a = cap[GRIP_FULL].tau; TAUF.b = cap[43].tau; console.log('serbest önkol pronasyonu (kavrama başı/sonu):', TAUF.a.toFixed(0), TAUF.b.toFixed(0));
  for (const [fk, fc] of [[19, GRIP_FULL], [45, 43]]) { setK(LU, fk, cap[fc].u); setK(LF, fk, cap[fc].fx); setK(BEND_L, fk, cap[fc].b); }
}
const SCAN = ARGS.find((x) => x.startsWith('--scan='))?.slice(7);
const SG = JSON.parse(ARGS.find((x) => x.startsWith('--grid='))?.slice(7) ?? '{"x":[-0.2,-0.14,-0.08],"y":[-0.15,-0.1,-0.05,0,0.05],"z":[0.05,0.12,0.19,0.26,0.33],"el":[10,20,30],"ro":[60,90,120]}');
if (SCAN) { const f = +SCAN; const res = [];
  for (const cx of SG.x) for (const cy of SG.y) for (const cz of SG.z) for (const el of SG.el) for (const ro of SG.ro) {
    const [t, e] = th(SG.az ?? 5, el, ro); DES_OVR = { C: V(cx, cy, cz), t: V(...t), e: V(...e) }; WD_OVR = 60;
    let r = null; for (const gm of (SG.gam ?? [GAMC])) { prevX = X0.slice(); prevX[6] = gm; prevTau = null; prevD = null; GAM0 = gm;
      const rr = solve(f); if (!r || rr.p.cost < r.p.cost) r = rr; } const R_ = r.p.r; const dev = Math.hypot(r.p.x[0], r.p.x[1], r.p.x[2]) * 100, dt = Math.hypot(r.p.x[3], r.p.x[4]);
    res.push({ kink: deg(R_.ikR.fd.angleTo(R_.t)), cx, cy, cz, el, ro, c: r.p.cost, eR: R_.ikR.err * 1000, eL: (R_.ikL?.err ?? 0) * 1000, wR: R_.ikR.wmag, wL: R_.ikL?.wmag ?? 0, clr: Math.min(R_.T.R ?? 9, R_.T.L ?? 9), bc: R_.bc, dev, dt, bR: R_.ikR.bend, bL: R_.ikL?.bend ?? 0, g: r.p.x[6] }); }
  res.sort((a, b) => a.c - b.c);
  for (const q of res.slice(0, 25)) console.log('scan', f, 'C', [q.cx, q.cy, q.cz].map((v) => v.toFixed(2)).join('/'), 'el', q.el, 'ro', q.ro, '| c', q.c.toFixed(1), 'eR', q.eR.toFixed(0), 'eL', q.eL.toFixed(0), 'w', q.wR.toFixed(0) + '/' + q.wL.toFixed(0), 'clr', q.clr.toFixed(2), 'bc', q.bc.toFixed(2), 'dev', q.dev.toFixed(1) + 'cm/' + q.dt.toFixed(0) + '°', 'bend', q.bR.toFixed(0) + '/' + q.bL.toFixed(0), 'γ', q.g.toFixed(0), 'kink', q.kink.toFixed(1));
  // alçak eller için en iyiler
  console.log('--- ağız aşağı (ro <= 30) ---'); for (const q of res.filter((q) => q.ro <= 30).slice(0, 6)) console.log('scanlow', f, 'C', [q.cx, q.cy, q.cz].map((v) => v.toFixed(2)).join('/'), 'el', q.el, 'ro', q.ro, '| c', q.c.toFixed(1), 'eR', q.eR.toFixed(0), 'eL', q.eL.toFixed(0), 'w', q.wR.toFixed(0) + '/' + q.wL.toFixed(0), 'clr', q.clr.toFixed(2), 'bc', q.bc.toFixed(2), 'bend', q.bR.toFixed(0) + '/' + q.bL.toFixed(0));
  process.exit(0); }
const outs = []; const diag = []; const hand = [];
const t0run = Date.now();
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL?.err, tauR: R_.ikR.tau, tauL: R_.ikL?.tau, bendR: R_.ikR.bend, bendL: R_.ikL?.bend, wR: R_.ikR.wmag, wL: R_.ikL?.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reachLeft, r.p.reachRight], ground: r.p.ground, gw: r.p.gw, cy: r.p.chestYaw, pel: r.p.pel[0], handFwd: r.p.handFwd });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'g', d.gw.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', d.errL != null ? (d.errL * 1000).toFixed(1) : '-', 'wR', d.wR.toFixed(1), 'wL', d.wL?.toFixed(1) ?? '-', 'τR', d.tauR.toFixed(0), 'τL', d.tauL?.toFixed(0) ?? '-',
  'bR', d.bendR.toFixed(0), 'bL', d.bendL?.toFixed(0) ?? '-', 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2), 'fwd', d.handFwd.toFixed(2), 'reach', d.reach.map((v) => v.toFixed(3)).join('/'));

// ---- idle'a dikiş: kol kemiklerinin kendi ekseni etrafındaki burulma farkı (idle başka araçla yapılmış; menteşe modelinde dirsek
// burulması farklı) baştan sona dünya uzayında söndürülür → konumlar ve kılıç değişmez; serbest sol el idle yönelimine harmanlanır ----
{ const axisOf = (n, Dq) => restDir(n, bones.find((b) => b.parent === n && !/Thumb|Index|Middle|Ring|Pinky/.test(b.name)).name).applyQuaternion(Dq).normalize();
  const twistAbout = (Dfrom, Dto, ax) => { const d = Dto.clone().multiply(Dfrom.clone().invert()); return twistDeg(d, ax); };
  const F0 = 16, F1 = 50;
  for (const n of ['RightArm', 'RightForeArm', 'LeftArm', 'LeftForeArm', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg']) {
    const a0 = twistAbout(outs[0].D[n], IDLE.D[n], axisOf(n, outs[0].D[n])), aE = twistAbout(outs[LEN - 1].D[n], IDLE.D[n], axisOf(n, outs[LEN - 1].D[n]));
    console.log('burulma dikişi', n, 'baş', a0.toFixed(1), '° son', aE.toFixed(1), '°');
    for (let f = 0; f < LEN; f++) { const k = a0 * (1 - sst(f / F0)) + aE * sst((f - F1) / (LEN - 1 - F1)); if (Math.abs(k) < 1e-4) continue;
      outs[f].D[n] = new THREE.Quaternion().setFromAxisAngle(axisOf(n, outs[f].D[n]), rad(k)).multiply(outs[f].D[n]); } }
  const dL0 = IDLE.D.LeftHand.clone().multiply(outs[0].D.LeftHand.clone().invert()), dLE = IDLE.D.LeftHand.clone().multiply(outs[LEN - 1].D.LeftHand.clone().invert());
  for (let f = 0; f < LEN; f++) { const g = TWO(f); const k0 = (1 - sst(f / 12)) * (1 - g), kE = sst((f - F1) / (LEN - 1 - F1)) * (1 - g);
    if (k0 > 0) outs[f].D.LeftHand = powQ(dL0, k0).multiply(outs[f].D.LeftHand); if (kE > 0) outs[f].D.LeftHand = powQ(dLE, kE).multiply(outs[f].D.LeftHand); }
  for (let f = 0; f < LEN; f++) { const D = outs[f].D, cur = {}, out = {};
    for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
      cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ)); out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]); }
    outs[f].out = out; } }
// ---- sol el parmakları: serbest (yaylı) ↔ kavrama (katana_run sol eli = kavrama yumruğu), GRIP ağırlığıyla ----
const FLEX = { Index: [16, 26, 10], Middle: [20, 32, 12], Ring: [25, 36, 14], Pinky: [30, 38, 15] };
const JW = [1, 0.6, 0.35];
const SPR = { Thumb: [0.6, 0.42], Index: [0.62, 0.34], Middle: [0.56, 0.32], Ring: [0.5, 0.3], Pinky: [0.44, 0.28] };
const PHs = { Thumb: 0.3, Index: 0, Middle: 0.7, Ring: 1.4, Pinky: 2.1 };
const spd = hand.map((h, f) => (f ? h.L.distanceTo(hand[f - 1].L) : 0)); const vmax = Math.max(0.02, ...spd);
const sec = {};
for (const kind of Object.keys(SPR)) {
  const [w, z] = SPR[kind]; let x = 0, v = 0; sec[kind] = [];
  for (let f = 0; f < LEN; f++) { v += -w * w * (x + 11 * spd[f] / vmax * (1 - GRIP(f))) - 2 * z * w * v; x += v; sec[kind].push(x + 1.5 * Math.sin(2 * Math.PI * f / 44 + PHs[kind])); }
}
const hingeAxis = (n) => { let d = Q(by[n].restQ).invert().multiply(Q(FINGERS[n].rot[0].slice(1))); if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w); return V(d.x, 0, d.z).normalize(); };
const curl = {}; const fingerOut = {}; const IDLE_FINGERS = true;   // serbest sol el = idle'ın sol eli (dikişsiz)
for (const [n, t] of Object.entries(FINGERS)) if (/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(n)) {
  const q = Q(t.rot[0].slice(1));
  if (!n.startsWith('Left')) { fingerOut[n] = Array.from({ length: LEN }, () => q.clone()); continue; }
  const [, kind, jn] = n.match(/Hand(Thumb|Index|Middle|Ring|Pinky)(\d)/); const j = jn - 1;
  const rest = Q(by[n].restQ); curl[n] = [];
  if (IDLE_FINGERS) { for (let f = 0; f < LEN; f++) curl[n].push(IDLE.local[n].clone()); continue; }
  if (kind === 'Thumb') { const delta = rest.clone().invert().multiply(q);
    for (let f = 0; f < LEN; f++) curl[n].push(rest.clone().multiply(powQ(delta, Math.max(0.05, 0.3 + sec.Thumb[f] / 60)))); continue; }
  const ax = hingeAxis('LeftHand' + kind + '2');
  for (let f = 0; f < LEN; f++) curl[n].push(rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ax, rad(Math.max(2, FLEX[kind][j] + sec[kind][f] * JW[j])))));
}
const P_ = (n) => V(...by[n].restP);
for (let f = 0; f < LEN && !IDLE_FINGERS; f++) {
  const [t1, t2, t3] = ['LeftHandThumb1', 'LeftHandThumb2', 'LeftHandThumb3'].map((n) => curl[n][f]);
  const p1 = P_('LeftHandThumb1');
  const tip = P_('LeftHandThumb2').add(P_('LeftHandThumb3').add(V(0, 0.025, 0).applyQuaternion(t3)).applyQuaternion(t2)).applyQuaternion(t1);
  const idx2 = P_('LeftHandIndex1').add(P_('LeftHandIndex2').applyQuaternion(curl.LeftHandIndex1[f]));
  const swing = new THREE.Quaternion().setFromUnitVectors(tip.normalize(), idx2.sub(p1).normalize());
  curl.LeftHandThumb1[f] = new THREE.Quaternion().slerp(swing, 0.55).multiply(t1);
}
for (const n of Object.keys(curl)) { const gq = Q(FINGERS[n].rot[0].slice(1)); curl[n] = curl[n].map((q, f) => q.clone().slerp(gq, GRIP(f))); }
Object.assign(fingerOut, curl);

// ---- dikiş (0. kare = idle[0]) ve bitiş (son kare = idle[0], yatay kök konumu hariç) ----
const SEAM = 6, SEAM_ARM = 14, SEAM_LEG = 10, ENDB = 12; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const r0 = {}, rE = {}, d0 = {}, dE = {};
for (const n of allNames) { const g0 = genAt(n, 0), gE = genAt(n, LEN - 1);
  r0[n] = g0.clone().invert().multiply(IDLE.local[n]); d0[n] = qAng(g0, IDLE.local[n]);
  rE[n] = gE.clone().invert().multiply(IDLE.local[n]); dE[n] = qAng(gE, IDLE.local[n]); }
const h0 = V(...IDLE.hl).sub(V(...outs[0].hipsLocal));
const hE = V(...IDLE.hl).sub(V(...outs[LEN - 1].hipsLocal)); hE.y = 0; hE.x = 0;   // yalnız yükseklik (yerel z); yatay = kök ilerlemesi
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const w0 = 1 - smooth(f / SEAM), wE = smooth((f - (LEN - 1 - ENDB)) / ENDB);
  for (const n of allNames) {
    const sw = /Shoulder|Arm|Hand$/.test(n) ? SEAM_ARM : /Leg|Foot|Toe/.test(n) ? SEAM_LEG : SEAM, w0 = 1 - smooth(f / sw);
    let q = genAt(n, f).clone(); if (w0 > 0) q.multiply(powQ(r0[n], w0)); if (wE > 0) q.multiply(powQ(rE[n], wE));
    if (f === 0) q = IDLE.local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const hp = V(...outs[f].hipsLocal).add(h0.clone().multiplyScalar(w0)).add(hE.clone().multiplyScalar(wE));
  if (f === 0) hp.set(...IDLE.hl);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}
// son kare yatay: idle[0] + ileri gidiş (x idle'a)
{ const l = tracks.Hips.pos[LEN - 1]; console.log('son kare kalça yatay (yerel x,y):', l[1].toFixed(3), l[2].toFixed(3), '| idle', IDLE.hl[0].toFixed(3), IDLE.hl[1].toFixed(3)); }

// ---- kol zinciri yumuşatma (bırakış + vuruş penceresi) ve sol eli kabzaya geri oturtma (light-attack-4.mjs) ----
const fkT = (f) => { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? Q(tracks[b.name].rot[f].slice(1)) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, cur }; };
const relLH = (f) => { const k = fkT(f); return { p: k.pos.LeftHand.clone().sub(k.pos.RightHand).applyQuaternion(k.cur.RightHand.clone().invert()), q: k.cur.RightHand.clone().invert().multiply(k.cur.LeftHand) }; };
const binom = (n, fa, fb, passes) => { for (let pass = 0; pass < passes; pass++) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = fa; f <= fb; f++) { const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[Math.max(0, Math.min(LEN - 1, f + i - 2))]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
    const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } } };
const SA = 26, SB = 46; const rel0 = []; for (let f = SA; f <= SB; f++) rel0.push(relLH(f));
for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']) binom(n, SA + 2, SB - 2, 2);
const parentOf = Object.fromEntries(bones.map((b) => [b.name, b.parent]));
const setLocal = (n, f, curW, k) => { const l = k.cur[parentOf[n]].clone().invert().multiply(curW); tracks[n].rot[f] = [f, l.x, l.y, l.z, l.w]; };
for (let f = SA; f <= SB; f++) {
  const k0 = fkT(f), rr = rel0[f - SA]; const tp = k0.pos.RightHand.clone().add(rr.p.clone().applyQuaternion(k0.cur.RightHand)), tq = k0.cur.RightHand.clone().multiply(rr.q);
  for (let it = 0; it < 6; it++) for (const J of ['LeftArm', 'LeftForeArm']) {
    const k = fkT(f); const pJ = k.pos[J]; const v1 = k.pos.LeftHand.clone().sub(pJ), v2 = tp.clone().sub(pJ); let Rq;
    if (J === 'LeftForeArm') { const ax = RL.n0.clone().applyQuaternion(k.cur[J].clone().multiply(restW[J].clone().invert())).normalize();
      const a1 = v1.clone().sub(ax.clone().multiplyScalar(v1.dot(ax))), a2 = v2.clone().sub(ax.clone().multiplyScalar(v2.dot(ax)));
      Rq = new THREE.Quaternion().setFromAxisAngle(ax, Math.atan2(a1.clone().cross(a2).dot(ax), a1.dot(a2))); }
    else Rq = new THREE.Quaternion().setFromUnitVectors(v1.normalize(), v2.normalize());
    setLocal(J, f, Rq.multiply(k.cur[J]), k); }
  setLocal('LeftHand', f, tq, fkT(f));
}
{ let dm = 0, am = 0; for (let f = SA; f <= SB; f++) { const r = relLH(f), rr = rel0[f - SA]; dm = Math.max(dm, r.p.distanceTo(rr.p)); am = Math.max(am, qAng(r.q, rr.q)); }
  console.log('kol yumuşatma: sol elin sağ ele göre kayması max', (dm * 100).toFixed(2), 'cm,', am.toFixed(1), '°'); }
// bacak zinciri yumuşatma: kalkış (arka ayak kopuşu) ve basış çevresi
for (const n of ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']) { binom(n, TOFF_R - 2, TOFF_R + 2, 2); }
for (const n of ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']) binom(n, LAND_R - 2, LAND_R + 1, 1);

// ---- rapor (son izlerden FK) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − idle[0] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − idle[0] (sonda söner):', top(dE));
const seamM = (fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = IDLE.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(keyAt(t.rot, fa).slice(1)), qOf(n, fb)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seamM(0, 0), [e0, e0n] = seamM(0, LEN - 1);
console.log(`dikiş: idle[0]→h0[0] max ${s0.toFixed(3)}° (${s0n}) | h0[son]↔idle[0] max ${e0.toFixed(3)}° (${e0n}), kalça yükseklik ${((tracks.Hips.pos[LEN - 1][3] - IDLE.hl[2]) * 100).toFixed(2)} cm, yatay ${(Math.hypot(tracks.Hips.pos[LEN - 1][1] - IDLE.hl[0], tracks.Hips.pos[LEN - 1][2] - IDLE.hl[1]) * 100).toFixed(1)} cm (kök hareketi)`);
const FF = []; for (let f = 0; f < LEN; f++) { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? qOf(b.name, f) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); }
  const Dd = {}; for (const n of Object.keys(cur)) Dd[n] = cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos, D: Dd }); }
const palm = (s) => V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize();
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: ang, flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };   // toplam = el ekseninin açısı (HeroWristAudit gibi; burulma sayılmaz)
const WRIST_MAX = {};
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  WRIST_MAX[s] = { flex: mx('flex'), dev: mx('dev'), tot: mx('tot') };
  console.log(s, 'bilek: fleksiyon max', mx('flex')[0].toFixed(1), '° (kare', mx('flex')[1] + ') | sapma max', mx('dev')[0].toFixed(1), '° (kare', mx('dev')[1] + ') | toplam max', mx('tot')[0].toFixed(1), '° (kare', mx('tot')[1] + ') | burulma max', mx('tw')[0].toFixed(1));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const gF = [...Array(LEN).keys()].filter((f) => diag[f].gw > 0.99);
const gd = gF.map((f) => { const t = outs[f].p.bladeDir; return FF[f].pos.LeftHand.clone().sub(FF[f].pos.RightHand).dot(t) * 100; });
console.log('iki elli tam kavrama: kare', gF[0], '–', gF.at(-1), '| sol el sağ elden eksen boyunca', Math.min(...gd).toFixed(1), '..', Math.max(...gd).toFixed(1), 'cm | erişim hatası max R/L', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), '/', (Math.max(...diag.filter((d) => d.errL != null).map((d) => Math.abs(d.errL) * (d.gw))) * 1000).toFixed(1), 'mm');
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
const dd = diag.filter((d) => d.gw > 0);
console.log('β', rng(diag.map((d) => d.x[5])), '| γ', rng(dd.map((d) => d.x[6])), '| dirsek R', rng(diag.map((d) => d.bendR)), 'L(kavrama)', rng(dd.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), 'L', rng(dd.map((d) => d.tauL)), '| klavikula', rng(diag.flatMap((d) => d.x.slice(11))), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde', Math.min(...diag.map((d) => d.bc)).toFixed(3), '| bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '| uç-yer', Math.min(...diag.map((d) => d.tipY)).toFixed(3));
// bekleme karesi: komşu kareler arası en büyük kemik dönüşü (donunca doğal durmalı)
{ const around = [HOLD - 1, HOLD, HOLD + 1].map((f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mn = n; } } return f + ':' + m.toFixed(2) + '° ' + mn; });
  const hv = [HOLD - 1, HOLD, HOLD + 1].map((f) => (FF[f].pos.Hips.distanceTo(FF[f - 1].pos.Hips) * 100).toFixed(2));
  console.log('bekleme karesi', HOLD, '— kare başı en büyük kemik dönüşü', around.join(' | '), '| kalça cm/kare', hv.join(' '));
  const P = FF[HOLD].pos; const lf = P.LeftFoot, rf = P.RightFoot, hp = P.Hips;
  const w = (lf.z - hp.z) / (lf.z - rf.z);
  console.log('  bekleme duruşu: kalça z', hp.z.toFixed(3), '| sol ayak z', lf.z.toFixed(3), 'sağ ayak z', rf.z.toFixed(3), '→ ağırlık arka ayakta ~%', (w * 100).toFixed(0), '| ayaklar yerde:', diag[HOLD].ground.Left, diag[HOLD].ground.Right, '| bıçak yükselme', deg(Math.asin(outs[HOLD].p.bladeDir.y)).toFixed(1), '° uç-yer', diag[HOLD].tipY.toFixed(2)); }
// kalça ileri yolu + kodun atılma eğrisi oturtması (HeroAttackClips.FitLunge'in aynısı)
const hz = FF.map((k) => k.pos.Hips.z), travel = hz[LEN - 1] - hz[0];
const LT = (t, s, e, d) => (t <= s ? 0 : t >= e ? d : d * (1 - (1 - (t - s) / (e - s)) ** 2));
const tipFK = (f) => { const k = FF[f]; const C = k.pos.RightHand.clone().add(PPpR.clone().applyQuaternion(k.D.RightHand)); const t = b0.clone().applyQuaternion(k.D.RightHand); return C.add(t.multiplyScalar(HALF - SR)); };
const inPlace = (v, f) => v.clone().sub(V(FF[f].pos.Hips.x, 0, FF[f].pos.Hips.z)).add(V(FF[0].pos.Hips.x, 0, FF[0].pos.Hips.z));
const tipsIP = [...Array(LEN).keys()].map((f) => inPlace(tipFK(f), f));
const spdIP = tipsIP.slice(1).map((p, k) => p.distanceTo(tipsIP[k]) * 60);
let fastest = 0; spdIP.forEach((v, k) => { if (v > spdIP[fastest]) fastest = k; });
let bestK = fastest, bestS = -1e9; for (let k = 0; k < spdIP.length; k++) { if (spdIP[k] < 0.35 * spdIP[fastest]) continue; if ((k > 0 && spdIP[k - 1] > spdIP[k]) || (k < spdIP.length - 1 && spdIP[k + 1] > spdIP[k])) continue;
  const thr = 0.55 * spdIP[k]; let a = k, b = k; while (a > 0 && spdIP[a - 1] >= thr) a--; while (b < spdIP.length - 1 && spdIP[b + 1] >= thr) b++;
  let mz = -9; for (let j = a; j <= b + 1; j++) mz = Math.max(mz, tipsIP[j].z); const sc = (mz - tipsIP[a].z) * spdIP[k]; if (sc > bestS) { bestS = sc; bestK = k; } }
{ const cands = []; for (let k = 0; k < spdIP.length; k++) { if (spdIP[k] < 0.35 * spdIP[fastest]) continue; if ((k > 0 && spdIP[k - 1] > spdIP[k]) || (k < spdIP.length - 1 && spdIP[k + 1] > spdIP[k])) continue;
    const thr = 0.55 * spdIP[k]; let a = k, b = k; while (a > 0 && spdIP[a - 1] >= thr) a--; while (b < spdIP.length - 1 && spdIP[b + 1] >= thr) b++; let mz = -9; for (let j = a; j <= b + 1; j++) mz = Math.max(mz, tipsIP[j].z); cands.push(k + ':' + ((mz - tipsIP[a].z) * spdIP[k]).toFixed(2) + '(' + a + '-' + (b + 1) + ')'); }
  console.log('kesiş adayları (kare:puan(pencere)):', cands.join(' ')); }
const thrA = 0.55 * spdIP[bestK]; let hA = bestK, hB = bestK; while (hA > 0 && spdIP[hA - 1] >= thrA) hA--; while (hB < spdIP.length - 1 && spdIP[hB + 1] >= thrA) hB++;
const hitStart = hA / 60;
let fit = 9, fs_ = 0, fe_ = 0; const D_ = Math.round(travel * 100) / 100;
for (let i = 0; i <= Math.min(Math.round(hitStart * 60), LEN - 2); i++) for (let j = i + 1; j <= LEN - 1; j++) { let err = 0; for (let k = 0; k < LEN && err < fit; k++) err = Math.max(err, Math.abs(LT(k / 60, i / 60, j / 60, D_) - (hz[k] - hz[0]))); if (err < fit) { fit = err; fs_ = i; fe_ = j; } }
console.log('kök: kalça ileri gidiş', (travel * 100).toFixed(1), 'cm | atılma eğrisi oturtması: kare', fs_, '–', fe_, ', en büyük fark', (fit * 100).toFixed(1), 'cm | geri kayma (hazırlık) max', (Math.max(0, ...hz.map((z) => hz[0] - z)) * 100).toFixed(1), 'cm');
console.log('uç hızı (yerinde, m/s):', spdIP.map((v, k) => k + ':' + v.toFixed(1)).join(' '));
console.log('vuruş: tepe kare', bestK, '(', spdIP[bestK].toFixed(1), 'm/s ), etkin kareler', hA, '–', hB + 1, '| en hızlı tepe', fastest, '| erişim (uç yatay, yerinde) max', Math.max(...[...Array(hB - hA + 2).keys()].map((i) => Math.hypot(tipsIP[hA + i].x - FF[0].pos.Hips.x, tipsIP[hA + i].z - FF[0].pos.Hips.z))).toFixed(2), 'm');
const footY = [...Array(LEN).keys()].map((f) => [Math.min(FF[f].pos.LeftToeBase.y, FF[f].pos.LeftFoot.y - 0.06) - restPos.LeftToeBase.y, Math.min(FF[f].pos.RightToeBase.y, FF[f].pos.RightFoot.y - 0.06) - restPos.RightToeBase.y]);
const air = [...Array(LEN).keys()].filter((f) => footY[f][0] > 0.012 && footY[f][1] > 0.012);
console.log('uçuş (iki ayak havada):', air.length, 'kare', air.length ? '(' + air[0] + '–' + air.at(-1) + ')' : '', '| kalça yükseklik farkı min/max (cm)', (Math.min(...FF.map((k) => k.pos.Hips.y - FF[0].pos.Hips.y)) * 100).toFixed(1), '/', (Math.max(...FF.map((k) => k.pos.Hips.y - FF[0].pos.Hips.y)) * 100).toFixed(1));
// yerdeki ayak kayması (oyunda kök atılmayla taşınır; burada klip uzayında)
{ const slip = (s, fa, fb) => { let m = 0; for (let f = fa + 1; f <= fb; f++) m = Math.max(m, FF[f].pos[s + 'ToeBase'].distanceTo(FF[fa].pos[s + 'ToeBase'])); return (m * 100).toFixed(1); };
  console.log('yerde ayak kayması (cm): sol bekleme', slip('Left', 15, LIFT_L - 1), 'sol basış sonrası', slip('Left', STAMP + 1, LEN - 1), '| sağ dönüş/itiş', slip('Right', 9, TOFF_R - 2), 'sağ toplanma sonrası', slip('Right', LAND_R + 1, LEN - 1)); }
console.log('bacak erişimi max (yerde)', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3));

const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
// ---- önizleme: bekleme karesi 0,6 sn tutulur, sonrası 1,3× hızlı (yalnız editör önizlemesi, Unity'ye gitmez) ----
function buildCharged() {
  const HOLDF = 36, SPEED = 1.3; const src = tracks; const out = {}; const times = [];
  for (let f = 0; f <= HOLD; f++) times.push(f); for (let k = 0; k < HOLDF; k++) times.push(HOLD);
  for (let s = HOLD + SPEED; s < LEN - 1; s += SPEED) times.push(s); times.push(LEN - 1);
  for (const n of Object.keys(src)) { out[n] = {};
    if (src[n].rot) out[n].rot = times.map((t, i) => { const a = Math.floor(t), b = Math.min(LEN - 1, a + 1), u = t - a; const qa = Q(src[n].rot[a].slice(1)), qb = Q(src[n].rot[b].slice(1)); const q = qa.slerp(qb, u); return [i, q.x, q.y, q.z, q.w]; });
    if (src[n].pos) out[n].pos = times.map((t, i) => { const a = Math.floor(t), b = Math.min(LEN - 1, a + 1), u = t - a; const pa = src[n].pos[a], pb = src[n].pos[b]; return [i, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u, pa[3] + (pb[3] - pa[3]) * u]; });
  }
  return { name: PREVIEW, fps: 60, length: times.length, loop: false, tracks: out };
}
const charged = buildCharged();
console.log('önizleme', PREVIEW, ':', charged.length, 'kare (', (charged.length / 60).toFixed(2), 'sn ), bekleme', HOLD, '→', HOLD + 36);
const DUMP = ARGS.find((x) => x.startsWith('--dump='))?.slice(7);
if (DUMP) fs.writeFileSync(DUMP + '/heavy0_cur.json', JSON.stringify(anim));
if (!NOSEND) {
  const load = ARGS.includes('--charged') ? charged : anim;
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim: load }) })).json(); console.log('editöre yüklendi', load.name, r);
  if (!ARGS.includes('--nosave')) for (const a of [anim, charged]) { const s = await (await fetch(BASE + '/api/animations/save?name=' + a.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json(); console.log('kaydedildi', a.name, s); }
}
if (ARGS.includes('--solved')) for (const f of (ARGS.includes('--all') ? [...Array(LEN).keys()] : [0, 9, 16, 20, 24, 27, 30, 33, 36, 38, 41, 45, 51, 58, 67])) { const r = outs[f].p.r; const C = r.C.clone().sub(outs[f].p.chest); const t = r.t, e = r.e;
  const az = deg(Math.atan2(t.x, t.z)), el = deg(Math.asin(t.y)); const e0 = V(0, -1, 0); e0.sub(t.clone().multiplyScalar(e0.dot(t))).normalize(); const ro = deg(Math.atan2(t.clone().cross(e0).dot(e), e0.dot(e)));
  console.log('solved', f, 'C', C.toArray().map((v) => v.toFixed(3)).join(', '), '| az', az.toFixed(1), 'el', el.toFixed(1), 'ro', ro.toFixed(1), '| chestYaw', outs[f].p.chestYaw.toFixed(0)); }
if (ARGS.includes('--ip')) for (const f of [0, 4, 8, 11, 13, 15, 17, 19, 21, 24, 27, 29, 31, 33, 35]) { const P = FF[f].pos; const ip = (v) => (v.z - P.Hips.z).toFixed(3);
  console.log('yerinde z (kalçaya göre) kare', f, '| göğüs', ip(P.Spine), 'sağ el', ip(P.RightHand), 'uç', (tipsIP[f].z - FF[0].pos.Hips.z).toFixed(3), '| göğüs eğimi', bodyAt(f).chestPitch.toFixed(1), 'pelvis', bodyAt(f).pel[1].toFixed(1)); }
if (ARGS.includes('--hold')) { for (const n of ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm']) console.log('bekleme', n, [21, 22, 23, 24, 25, 26].map((f) => qAng(qOf(n, f), qOf(n, f - 1)).toFixed(2)).join(' '), '| dünya', [22, 23, 24, 25].map((f) => qAng(FF[f].D[n], FF[f - 1].D[n]).toFixed(2)).join(' ')); }
