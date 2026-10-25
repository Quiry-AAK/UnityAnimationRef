// game_light_attack_4 üretici: hafif kombonun SON vuruşu, 3. vuruşun son pozundan (49) dikişsiz devam.
// Yüklü çömelmeden iki bacakla sıçrama (balistik kalça yolu, g = 9,81), havada sola ~308° dönüş (kalça önce, omuz/baş gecikmeli,
// iniş öncesi baş hedefe kilitlenir), sol el kalkışta kabzayı SAĞ ELİN ALTINDAN (pommel tarafı, 8 cm) kavrar; kılıç havada iki
// elle başın üstüne (jodan, bıçak geride) kalkar; yere basma anında tepeden dikey sert kesik (tek dikey düzlem, roll sabit, kenar
// önde), derin çökme + kısa ağırlık duruşu; toparlanmada sol el bırakır, son kare game_idle_drawn'ın 0. karesine bağlanır.
// v6 (doğallık): kılıç dönüş boyunca kollar uzun, dönüşün ARKASINDA sürüklenir → sağ omuz üstüne yükselir → durmadan çapraz kesik (üstten tek
// yönlü spiral, geri ilmek yok); gövde-çerçevesinde omurga/boyun/baş canlılık katmanı (kademeli gecikme + yay); iniş 7 kareye yayılı, havada
// bacak kilitlenmez, ayak parmakları (itiş/iniş), burulma-tutarlı bacak çerçevesi; kavrama giriş/çıkışında önkol pronasyonu yayılır;
// kalkış ve vuruş penceresinde zincir yumuşatma + sol eli kabzaya yeniden oturtma; bitiş harmanı 24 kare.
// Yalnız 5190 editörüne yükler/kaydeder. Çalıştır: node light-attack-4.mjs [--nosend] [--nosave] [--dump=<klasör>]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const BASE = 'http://127.0.0.1:5190';
const NAME = 'game_light_attack_4';
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
const herm = (f, t0, p0, v0, t1, p1, v1) => { const h = t1 - t0, s = Math.max(0, Math.min(1, (f - t0) / h));
  return (2 * s ** 3 - 3 * s ** 2 + 1) * p0 + (s ** 3 - 2 * s ** 2 + s) * h * v0 + (-2 * s ** 3 + 3 * s ** 2) * p1 + (s ** 3 - s ** 2) * h * v1; };

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
function frame(a, b) { const x = a.clone().normalize(); const z = x.clone().cross(b).normalize(); const y = z.clone().cross(x); return new THREE.Matrix4().makeBasis(x, y, z); }
const WRIST = 14;
const nW = b0.clone().cross(fr0).normalize();
const Wr = new THREE.Quaternion().setFromAxisAngle(nW, rad(WRIST));
const b1 = b0.clone().applyQuaternion(Wr);
const alpha = Math.acos(fr0.dot(b1));
const M0inv = frame(fr0, b1).invert();
// kabza (katana GLB ölçümü, el kemiği çerçevesinde bıçak ekseni boyunca): pommel s=-0.462, tsuba s≈-0.27, sağ el kemiği s=-0.338.
// Sol el kemiği eksen üzerinde 8 cm pommel tarafında (s=-0.418): el genişliği ~8 cm → kabzanın içinde kalır.
const S_POMMEL = -0.462, S_GUARD = -0.27, S_RIGHT = -0.338, S_LEFT = -0.418;

const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (j === 0) { const q = asArr(keys[1][1]); return Pj.map((v, c) => 0.3 * (q[c] - v) / (keys[1][0] - keys[0][0])); }
    if (j === n - 1) return Pj.map(() => 0);
    const a = asArr(keys[j - 1][1]), b = asArr(keys[j + 1][1]);
    return Pj.map((_, c) => (b[c] - a[c]) / (keys[j + 1][0] - keys[j - 1][0])); };
  const m0 = tan(i), m1 = tan(i + 1); const h = t1 - t0; const s = Math.max(0, Math.min(1, (f - t0) / h));
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
  const r = A.map((a, c) => h00 * a + h10 * h * m0[c] + h01 * B[c] + h11 * h * m1[c]);
  return arr ? r : r[0];
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
const A3 = clipPose('game_light_attack_3', 'last');
const IDLE = clipPose('game_idle_drawn', 0);

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

// ---- Zaman çizelgesi v2 (90 kare = 1,5 sn): büyük ileri atılma + yatık eksenli dönüş + geniş dikey kesik ----
const LEN = 90, TOFF = 18, LAND = 53, HIT = 54, PH0 = 137;
const G = 9.81, FT = (LAND - TOFF) / 60, VY = G * FT / 2;           // havada 0,583 sn → tepe ≈ 0,42 m
const yStart = A3.hipsPos.y - restPos.Hips.y, Y_TO = 0.03;
const zStart = A3.hipsPos.z - restPos.Hips.z, xStart = A3.hipsPos.x - restPos.Hips.x;
const VZ = 0.06;                                                       // 3,6 m/s yatay
const Z_TO = zStart + 0.2, Z_LAND = Z_TO + VZ * (LAND - TOFF);
const Z_END = Z_LAND + 0.26;
const IDLE_Y = IDLE.hipsPos.y - restPos.Hips.y;
function hipsAt(f) {
  let y, z, x;
  if (f <= 11) y = herm(f, 0, yStart, 0, 11, -0.36, 0);
  else if (f <= TOFF) y = herm(f, 11, -0.36, 0, TOFF, Y_TO, VY / 60);
  else if (f <= LAND) { const t = (f - TOFF) / 60; y = Y_TO + VY * t - G * t * t / 2; }
  else if (f <= 61) y = herm(f, LAND, Y_TO, -VY / 60, 61, -0.39, 0);          // v6: iniş sönümlemesi 7 kare (ayak→diz→kalça)
  else if (f <= 64) y = herm(f, 61, -0.39, 0, 64, -0.384, 0);               // ağırlık
  else if (f <= 68) y = herm(f, 64, -0.384, 0, 68, -0.355, 0.004);          // küçük geri tepme
  else if (f <= 80) y = herm(f, 68, -0.355, 0.004, 80, IDLE_Y - 0.03, 0.004);
  else y = herm(f, 80, IDLE_Y - 0.03, 0.004, LEN - 1, IDLE_Y, 0);
  if (f <= 11) z = herm(f, 0, zStart, 0, 11, zStart - 0.05, 0);
  else if (f <= TOFF) z = herm(f, 11, zStart - 0.05, 0, TOFF, Z_TO, VZ);
  else if (f <= LAND) z = Z_TO + VZ * (f - TOFF);
  else if (f <= 66) z = herm(f, LAND, Z_LAND, VZ, 66, Z_END, 0);
  else z = herm(f, 66, Z_END, 0, LEN - 1, Z_END - 0.03, 0);
  if (f <= TOFF) x = herm(f, 0, xStart, 0, TOFF, xStart * 0.5, -xStart * 0.5 / 35);
  else if (f <= LAND) x = xStart * 0.5 * (1 - (f - TOFF) / 35);
  else x = 0;
  return V(x, y, z);
}
// gövde: yaw sürekli 52 → 360 (sola), havada eksen dönüşe doğru ~15° yatık (roll), açısal hız kollar açıkken yavaş, toplanınca hızlı
const T = { start: 0, wind: 12, push: 15, toff: 18, a1: 24, a2: 30, a3: 36, a4: 42, a5: 47, prel: 51, land: 53, hit: 54, bend: 57, hold: 62, rise: 70, rest: 89 };
const P = {
  start: { pel: [52, 7, -2.5], s2: [9, 2, -2], s1: [10, 2, -2], ch: [10, 1, -2] },
  wind:  { pel: [38, 16, 2],   s2: [-8, 5, 3],  s1: [-10, 5, 3],  ch: [-10, 4, 3] },   // geri sarılma (sağa), öne yük
  push:  { pel: [58, 12, 0],   s2: [-6, 2, 1],  s1: [-6, 1, 1],   ch: [-5, 0, 1] },
  toff:  { pel: [86, 4, -6],   s2: [-8, -3, -3], s1: [-9, -4, -3], ch: [-9, -4, -3] },
  a1:    { pel: [122, 6, -14], s2: [-10, -2, -5], s1: [-11, -3, -5], ch: [-10, -3, -4] }, // kollar açık: yavaş
  a2:    { pel: [160, 8, -16], s2: [-9, 0, -5], s1: [-10, -1, -5], ch: [-9, -1, -4] },
  a3:    { pel: [205, 6, -15], s2: [-6, -3, -4], s1: [-6, -4, -4], ch: [-5, -4, -4] },
  a4:    { pel: [265, 2, -12], s2: [-2, -7, -3], s1: [-2, -8, -3], ch: [-1, -8, -2] },  // toplanma: hızlı, kılıç kalkar
  a5:    { pel: [318, -2, -6], s2: [2, -9, -1], s1: [3, -10, -1], ch: [3, -10, 0] },    // geriye açılma (kesik öncesi)
  prel:  { pel: [346, 2, -2], s2: [3, -4, 0], s1: [4, -4, 0], ch: [4, -3, 0] },
  land:  { pel: [356, 12, 0], s2: [2, 5, 0], s1: [2, 5, 0], ch: [2, 4, 0] },
  hit:   { pel: [359, 24, 1], s2: [1, 5, 0], s1: [1, 5, 0], ch: [1, 4, 0] },
  bend:  { pel: [362, 35, 1], s2: [0, 6, 0], s1: [0, 6, 0], ch: [0, 5, 0] },          // kalça menteşesi: pelvis 35° öne, omurga orta (~17°)
  hold:  { pel: [361, 33, 0], s2: [0, 5, 0], s1: [0, 5, 0], ch: [0, 4, 0] },
  rise:  { pel: [360, 8, 0], s2: [0, 3, 0], s1: [0, 3, 0], ch: [0, 2, 0] },
  rest:  { pel: [360, 3, 0], s2: [0, 1, 0], s1: [0, 1, 0], ch: [0, 0, 0] },
};
{
  const inc = (C, c, p) => ypr(C.D[c].clone().multiply(C.D[p].clone().invert()));
  const S = P.start; S.pel = ypr(A3.D.Hips); S.s2 = inc(A3, 'Spine02', 'Hips'); S.s1 = inc(A3, 'Spine01', 'Spine02'); S.ch = inc(A3, 'Spine', 'Spine01');
  const g = PH0; S.ch[1] -= 0.9 * Math.sin(2 * Math.PI * g / 44); S.s1[1] -= 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6); S.pel[2] -= 0.8 * Math.sin(g * 0.11);
  const E = P.rest; E.pel = ypr(IDLE.D.Hips); E.pel[0] += 360; E.s2 = inc(IDLE, 'Spine02', 'Hips'); E.s1 = inc(IDLE, 'Spine01', 'Spine02'); E.ch = inc(IDLE, 'Spine', 'Spine01');
  P.rise.pel[0] = E.pel[0];
}
const startNeck = ypr(A3.D.neck.clone().multiply(A3.D.Spine.clone().invert())), startHead = ypr(A3.D.Head.clone().multiply(A3.D.neck.clone().invert()));
const idleNeck = ypr(IDLE.D.neck.clone().multiply(IDLE.D.Spine.clone().invert())), idleHead = ypr(IDLE.D.Head.clone().multiply(IDLE.D.neck.clone().invert()));
const LEAD = { pel: 3, s2: 1.6, s1: 0.6, ch: -0.6 };
// pelvis yaw: geri sarılma (0–12, sağa 10°) → tek çan hızla 12–54 (smootherstep) → hedefte durur
const pelYawAt = (f) => { const a = P.start.pel[0], w = a - 10, z = P.rest.pel[0];
  if (f <= 12) return herm(f, 0, a, 0, 12, w, 0); if (f >= 54) return z; const t = (f - 12) / 42; return w + (z - w) * t * t * t * (10 - 15 * t + 6 * t * t); };
const SG0 = P.start.s2[0] + P.start.s1[0] + P.start.ch[0], SGI = P.rest.s2[0] + P.rest.s1[0] + P.rest.ch[0];
const SEPK = [[0, SG0], [6, (SG0 - 35) / 2], [12, -35], [16, -28], [21, -6], [26, 11], [32, 19], [44, 21], [50, 22], [54, 24], [57, 27], [62, 26], [72, 13], [LEN - 1, SGI]];                // kalça önde, omuzlar ~3 kare geride
const names = Object.keys(T);
const HPITCH = [[0, 0], [10, -6], [18, 2], [36, 4], [47, 0], [53, 0], [56, 2], [60, 1], [65, 0], [LEN - 1, 0]]; // temastan sonra baş öne dalar
// ---- v6 canlılık katmanı: gövde çerçevesinde omurga fleksiyonu (+ öne) / yan eğilme (− sola) — kinetik zincir: pelvis → Spine02 → Spine01 → Spine → boyun → baş
// yükleme: sıkışma; itiş: açılma; havada: dönüşe yatma; kılıç kalkarken gerilme (sağ yan uzar); vuruş: fleksiyon + sola yan eğilme ("çatlama"); sönüm + geri tepme
const LIFE_F = [[0, 0], [5, 5], [11, 10], [14, 3], [18, -14], [22, -10], [28, 2], [34, 5], [40, -5], [46, -15], [49, -13], [52, -2], [55, 10], [58, 12], [62, 9], [67, 5], [76, 2], [LEN - 1, 0]];
const LIFE_L = [[0, 0], [6, 3], [12, 6], [17, 2], [23, -10], [30, -14], [36, -10], [42, -2], [47, 5], [50, 4], [53, -4], [56, -13], [60, -11], [66, -5], [76, -1], [LEN - 1, 0]];
const springF = (arr, w, z) => { let x = arr[0], v = 0; return arr.map((t) => { v += w * w * (t - x) - 2 * z * w * v; x += v; return x; }); };
const LIFE = (() => {
  const fr = [...Array(LEN + 2).keys()]; const ramp = (f) => smooth(f / 7);
  const seg = (keys, lag, w, z) => springF(fr.map((f) => spl(keys, Math.max(0, f - lag)) * ramp(f)), w, z);
  const o = { s2: [seg(LIFE_F, 0, 0.9, 0.65), seg(LIFE_L, 0, 0.9, 0.65)], s1: [seg(LIFE_F, 0.8, 0.75, 0.55), seg(LIFE_L, 0.8, 0.75, 0.55)], ch: [seg(LIFE_F, 1.6, 0.65, 0.5), seg(LIFE_L, 1.6, 0.65, 0.5)] };
  const SH = { s2: 0.4, s1: 0.5, ch: 0.5 };   // toplam ×1,4
  for (const k of Object.keys(SH)) o[k] = o[k].map((a) => a.map((v) => v * SH[k]));
  // boyun/baş: göğüs hareketinin gecikmeli takibi (sürüklenme + küçük aşma); baş en son
  const chP = fr.map((f) => o.s2[0][f] + o.s1[0][f] + o.ch[0][f]), chL = fr.map((f) => o.s2[1][f] + o.s1[1][f] + o.ch[1][f]);
  const lagP = springF(chP, 0.42, 0.42), lagL = springF(chL, 0.42, 0.42);
  o.neck = [fr.map((f) => 0.35 * (lagP[f] - chP[f])), fr.map((f) => 0.3 * (lagL[f] - chL[f]))];
  const lagP2 = springF(chP, 0.33, 0.4), lagL2 = springF(chL, 0.33, 0.4);
  const gz = (f) => smooth((f - 38) / 10) * (1 - smooth((f - 70) / 14));  // vuruşta bakış sabitleme
  o.neck[0] = o.neck[0].map((v, f) => v - 0.3 * chP[f] * gz(f));
  o.head = [fr.map((f) => 0.45 * (lagP2[f] - chP[f]) - 0.35 * chP[f] * gz(f)), fr.map((f) => 0.35 * (lagL2[f] - chL[f]) - 0.4 * chL[f] * gz(f))];
  return o;
})();
const lifeAt = (f) => { const i = Math.max(0, Math.min(LEN - 1, Math.round(f))); const g = (k) => [LIFE[k][0][i], LIFE[k][1][i]]; return { s2: g('s2'), s1: g('s1'), ch: g('ch'), neck: g('neck'), head: g('head') }; };
const Eb = (yw, pr) => Ry(yw).multiply(Rx(pr[0])).multiply(Rz(-pr[1])).multiply(Ry(-yw));   // gövde çerçevesinde: + öne, + sola (Rz − = sola yatma)
function spineD(f, p) {
  const D = {}; const L = lifeAt(f);
  D.Hips = eul(p.pel); D.Spine02 = eul(p.s2).multiply(D.Hips); D.Spine01 = eul(p.s1).multiply(D.Spine02); D.Spine = eul(p.ch).multiply(D.Spine01);
  const y2 = p.pel[0] + p.s2[0], y1 = y2 + p.s1[0], yc = y1 + p.ch[0];
  const E2 = Eb(y2, L.s2), E1 = Eb(y1, L.s1), E3 = Eb(yc, L.ch);
  D.Spine02 = E2.clone().multiply(D.Spine02); D.Spine01 = E2.clone().multiply(E1).multiply(D.Spine01); D.Spine = E2.clone().multiply(E1).multiply(E3).multiply(D.Spine);
  D.neck = Eb(yc, L.neck).multiply(eul(p.neck)).multiply(D.Spine); D.Head = Eb(yc, L.head).multiply(eul(p.head)).multiply(D.neck);
  return D;
}
function bodyAt(f) {
  const r = {}; const ramp = smooth(f / 8);
  for (const k of Object.keys(P.start)) r[k] = spl(names.map((n) => [T[n], P[n][k]]), f + (LEAD[k] || 0) * ramp);
  const g = f + PH0; r.ch[1] += 0.9 * Math.sin(2 * Math.PI * g / 44); r.s1[1] += 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6); r.pel[2] += 0.8 * Math.sin(g * 0.11);
  // v5 dönüş: pelvis yaw tek çan hız profili (12→54), göğüs–pelvis ayrımı σ tek yumuşak eğri, omurgada aşağıdan yukarı paylaşım
  { const pY = pelYawAt(f), sg = spl(SEPK, f), b = smooth(f / 10), e = smooth((f - 70) / 19);
    r.pel[0] = pY;
    for (const [k, w] of [['s2', 0.2], ['s1', 0.35], ['ch', 0.45]]) r[k][0] = (P.start[k][0] * (1 - b) + w * sg * b) * (1 - e) + P.rest[k][0] * e; }
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  // baş: göğse göre ±22° içinde; dönüşte hafif önde, son çeyrekte yumuşakça hedefe (spotting), boyun payı böler
  const spot = Math.max(-22, Math.min(22, 360 - cy));
  const w = smooth((f - 36) / 14); let inc = 8 * (1 - w) + spot * w;
  const we = smooth((f - 68) / 18); inc = inc * (1 - we) + (idleNeck[0] + idleHead[0]) * we;
  const ws = 1 - smooth(f / 10);
  const hp = spl(HPITCH, f - 1.5);
  r.neck = [inc * 0.45 * (1 - ws) + startNeck[0] * ws, hp * 0.4 * (1 - ws) + startNeck[1] * ws, (-0.3 * r.pel[2]) * (1 - ws) + startNeck[2] * ws];
  r.head = [inc * 0.55 * (1 - ws) + startHead[0] * ws, hp * 0.6 * (1 - ws) + startHead[1] * ws, (-0.4 * r.pel[2] + 0.8 * Math.sin(g * 0.09 + 1)) * (1 - ws) + startHead[2] * ws];
  r.hp = hipsAt(f).toArray();
  return r;
}

// ---- ayaklar: yerde taban sabit; havada asimetrik (sol toplanmış, sağ arkada sarkık); iniş kademeli (sol 53, sağ 57) ----
const FOOTL = 0.13;
const ankleFromBall = (ball, yaw, pitch) => ball.clone().add(V(0, FOOTL * Math.sin(rad(Math.max(0, pitch))), -FOOTL * Math.cos(rad(Math.max(0, pitch)))).applyQuaternion(Ry(yaw)));
const foot0 = {};
for (const s of ['Left', 'Right']) { const e = ypr(A3.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  foot0[s] = { yaw: e[0], pitch: e[1], ball: A3.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0]))) }; }
const hipsEnd = restPos.Hips.clone().add(hipsAt(LEN - 1));
const footIdle = {};
for (const s of ['Left', 'Right']) { const e = ypr(IDLE.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  const ball = IDLE.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0])));
  footIdle[s] = { yaw: e[0] + 360, pitch: e[1], ball: ball.clone().sub(IDLE.hipsPos).add(hipsEnd).setY(ball.y) }; }
// iniş: derin hamle duruşu (sol önde, sağ arkada parmak ucunda), en alçak kalça karesine göre; sonra sağ adımla, sol kayarak idle duruşuna
const hips58 = restPos.Hips.clone().add(hipsAt(58));
const landL = V(hips58.x + 0.13, footIdle.Left.ball.y, hips58.z + 0.27), landR = V(hips58.x - 0.13, footIdle.Right.ball.y, hips58.z - 0.52);
const TL = { Left: LAND + 2, Right: LAND + 5 };
const HIPS_TO = restPos.Hips.clone().add(hipsAt(TOFF - 1));
const AIR = { Left: [60, 13, 118, 8], Right: [6, 9, 64, 6] };   // havada uyluk fleksiyonu (≤62°), abdüksiyon, diz, dış rotasyon
function footAt(s, f, hipsPos, pelYaw, pelRoll, Dh) {
  const sg = s === 'Left' ? 1 : -1; const f0 = foot0[s], fi = footIdle[s];
  const pitch1 = spl([[0, f0.pitch], [10, 0], [14, 20], [TOFF, s === 'Left' ? 50 : 58]], Math.min(f, TOFF));
  const yaw1 = f0.yaw + spl([[0, 0], [10, -4], [TOFF, 20]], Math.min(f, TOFF));
  const a1 = ankleFromBall(f0.ball, yaw1, pitch1);
  // havada: uyluk açıları pelvise göre (FK) — toplanma diz bükümüyle, uyluk paltoya girmesin
  const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(Dh.clone().multiply(restW.Hips)));
  const [fl, ab, kn, er] = AIR[s];
  const thigh = V(0, -1, 0).applyQuaternion(Rz(sg * ab).multiply(Rx(-fl))).applyQuaternion(Dh);
  const shin = V(0, -1, 0).applyQuaternion(Rz(sg * ab).multiply(Rx(-fl + kn))).applyQuaternion(Dh);
  const tuck = hipJ.clone().add(thigh.clone().multiplyScalar(L1)).add(shin.clone().multiplyScalar(L2));
  const kneeDir = thigh.clone().sub(shin.clone().multiplyScalar(thigh.dot(shin))).normalize().add(V(sg, 0, 0).applyQuaternion(Dh).multiplyScalar(Math.tan(rad(er)))).normalize();
  const yawAir = pelYaw + (s === 'Left' ? 4 : -16);
  const tl = TL[s], land = s === 'Left' ? landL : landR;
  let ball, yaw, pitch;
  if (f >= tl) {
    if (s === 'Left') { const k = smooth((f - 74) / 10); ball = land.clone().lerp(fi.ball, k); ball.y += 0.04 * Math.sin(Math.PI * Math.max(0, Math.min(1, (f - 74) / 10))); }
    else { const k = smooth((f - 65) / 9); ball = land.clone().lerp(fi.ball, k); ball.y += 0.06 * Math.sin(Math.PI * Math.max(0, Math.min(1, (f - 65) / 9))); }
    yaw = fi.yaw + (s === 'Left' ? 6 : -10) * (1 - smooth((f - 64) / 14));
    pitch = s === 'Left' ? spl([[tl, 24], [tl + 3, 14], [tl + 7, 0], [LEN - 1, 0]], f) : (f < 65 ? spl([[tl, 30], [tl + 3, 34], [65, 34]], f) : 34 * (1 - smooth((f - 65) / 9)));
    return { ankle: ankleFromBall(ball, yaw, pitch), yaw, pitch };
  }
  if (f <= TOFF - 1) return { ankle: a1, yaw: yaw1, pitch: pitch1 };
  const w1 = smooth((f - TOFF + 1) / 11), w2 = smooth((f - (tl - 10)) / 10);
  const ank = a1.clone().add(hipsPos.clone().sub(HIPS_TO)).lerp(tuck, w1).lerp(ankleFromBall(land, fi.yaw, 24), w2);
  return { ankle: ank, yaw: (yaw1 * (1 - w1) + yawAir * w1) * (1 - w2) + (fi.yaw + (s === 'Left' ? 6 : -10)) * w2, pitch: (pitch1 * (1 - w1) + 34 * w1) * (1 - w2) + 24 * w2,
    pole: kneeDir, poleW: w1 * (1 - w2) };
}

// ===== v3: KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ =====
// Kılıcın dünya pozu (kabza noktası C = sağ el kemiğinin eksen izdüşümü, bıçak yönü t, kenar e) tasarlanır; sağ el yönelimi/konumu
// prop ofsetinin tersinden gelir. Sol el sağın aynası (kılıç simetri düzleminde), kabza etrafında γ kadar döner, 9 cm pommel tarafında.
// Her kol: bilek W (2 serbestlik, salınım, ≤14°) → önkol = el ⊗ W⁻¹ → dirsek = el − önkol·boy; omuz–dirsek = üst kol boyu (erişim);
// üst kol yönü + önkol yönü dirsek menteşesini, kalan önkol burulması τ'yu (pronasyon) kapalı biçimde verir.
// Serbestlikler kare başına örüntü aramasıyla (önceki kareden başlayarak) çözülür.
const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const FINGERS = JSON.parse(fs.readFileSync('C:/AnimRef/animations/katana_run.json', 'utf8')).tracks;
const PP = V(...(prop ? prop.pos : [-0.27084, 0.07551, 0.18772]));
const R0 = R, L0H = RL;
const PSCALE = prop ? prop.scale : 0.92385;
const eW0 = fr0.clone().sub(b1.clone().multiplyScalar(fr0.dot(b1))).normalize();
const EH = eW0.clone().applyQuaternion(Wr.clone().invert());               // kenar yönü (el-delta çerçevesi): önkol tarafı
const basisQ = (x, y) => { const X = x.clone().normalize(); const Y = y.clone().sub(X.clone().multiplyScalar(y.dot(X))).normalize(); const Z = X.clone().cross(Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); };
const MX = (v) => V(-v.x, v.y, v.z);
const QH0R = basisQ(b0, EH), QH0Ri = QH0R.clone().invert();
const QH0L = basisQ(MX(b0), MX(EH)), QH0Li = QH0L.clone().invert();
const SR = -PP.dot(b0);                                                      // sağ el kemiğinin eksen üstündeki yeri (merkeze göre)
const PPpR = PP.clone().sub(b0.clone().multiplyScalar(PP.dot(b0))), PPpL = MX(PPpR);
const HALF = 0.5 * PSCALE;                                                   // pommel s=-HALF, uç s=+HALF
const DLT = -0.09;                                                           // sol el: sağ elin 9 cm pommel tarafı
const ARM = {};
for (const s of ['Right', 'Left']) { const H = s === 'Right' ? R0 : L0H; const a1 = H.n0.clone(), a2 = H.f0.clone().cross(H.n0).normalize();
  ARM[s] = { H, lu: V(...by[s + 'ForeArm'].restP).length(), lf: V(...by[s + 'Hand'].restP).length(), a1, a2 }; }
const wristQ = (s, w) => { const A = ARM[s]; const r = A.a1.clone().multiplyScalar(w[0]).add(A.a2.clone().multiplyScalar(w[1])); const m = r.length();
  return m < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(r.divideScalar(m), rad(m)); };
const WR0 = [rad(0), 0]; { const a = ARM.Right; WR0[0] = WRIST * nW.dot(a.a1); WR0[1] = WRIST * nW.dot(a.a2); }
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
function clavD(s, Dsp, c) { const sg = s === 'Right' ? -1 : 1; return Dsp.clone().multiply(Rz(sg * c[0])).multiply(Ry(-sg * c[1])); }
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

// ---- kılıç yolu tasarımı (gövde-yaw çerçevesi, göğüs eklemine göre; x sol, y yukarı, z ileri). e: kenar (= önkol tarafı) ipucu ----
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const toYaw = (sw, cy, org) => ({ C: sw.C.clone().sub(org).applyQuaternion(Ry(-cy)), t: sw.t.clone().applyQuaternion(Ry(-cy)), e: sw.e.clone().applyQuaternion(Ry(-cy)) });
const cyA = bodyAt(0).chestYaw, cyI = bodyAt(LEN - 1).chestYaw;
const SW0 = toYaw(swordFromHand(A3.D.RightHand, A3.pos.RightHand), cyA, A3.pos.Spine), SWI = toYaw(swordFromHand(IDLE.D.RightHand, IDLE.pos.RightHand), cyI, IDLE.pos.Spine);
const DGU = V(-0.8, 1, 0).normalize();                                      // çapraz kesim düzlemi: ileri + sağ-yukarı
const dg = (phi) => { const t = V(0, 0, 1).multiplyScalar(Math.cos(rad(phi))).add(DGU.clone().multiplyScalar(Math.sin(rad(phi))));
  const e = V(0, 0, 1).multiplyScalar(Math.sin(rad(phi))).sub(DGU.clone().multiplyScalar(Math.cos(rad(phi)))); return [t.toArray(), e.toArray()]; };
const hzd = (az, el) => { const t = V(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el))); const e = V(Math.cos(rad(az)), -0.2, -Math.sin(rad(az))); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize(); return [t.toArray(), e.toArray()]; };
const vert = (phi) => [[0, Math.sin(rad(phi)), Math.cos(rad(phi))], [0, -Math.cos(rad(phi)), Math.sin(rad(phi))]]; // dikey kesim: t, kenar (aşağı dönüş yönü)
const KS = [
  [0, SW0.C.toArray(), SW0.t.toArray(), SW0.e.toArray()],
  [10, [-0.12, -0.12, 0.36], ...hzd(-72, -6)],                              // geri sarılma: kılıç sağda, yatay (gövde sağa kurulur)
  [15, [-0.12, -0.08, 0.40], ...hzd(-70, -3)],
  [18, [-0.13, -0.04, 0.43], ...hzd(-74, 0)],                                // kalkış: sol el kabzada, kollar uzar
  [24, [-0.15, 0.03, 0.45], ...hzd(-88, 3)],                                 // v6 spiral: kılıç dönüşün ARKASINDA sürüklenir (sağ-yan, omuz hizası, kollar uzun)
  [30, [-0.17, 0.09, 0.41], ...hzd(-106, 7)],
  [36, [-0.17, 0.19, 0.33], ...hzd(-121, 16)],                               // dönüş tamamlanırken yükselir…
  [41, [-0.14, 0.31, 0.22], ...dg(128)],                                    // …sağ omuzun üstüne (çapraz kesim düzlemine girer)
  [45, [-0.10, 0.39, 0.14], ...dg(143)],
  [48, [-0.08, 0.42, 0.12], ...dg(149)],                                    // tepe: durmaz, gövde dönüşü uç izini ileri taşır
  [50, [-0.07, 0.40, 0.2], ...dg(140)],
  [51, [-0.05, 0.35, 0.32], ...dg(118)],
  [52, [0.0, 0.24, 0.4], ...dg(84)],                                         // çapraz iniş (kesa giri): sağ üstten sol alta
  [53, [0.05, 0.08, 0.44], ...dg(46)],
  [54, [0.1, -0.1, 0.46], ...dg(10)],                                         // temas
  [55, [0.15, -0.3, 0.46], ...dg(-16)],
  [56, [0.18, -0.38, 0.44], ...dg(-30)],
  [57, [0.2, -0.42, 0.42], ...dg(-37)],
  [59, [0.21, -0.43, 0.42], ...dg(-46)],                                    // izleme: kılıç tek karede durmaz, hafif aşar ve oturur                                      // dip: eller sol uyluğun önünde-dışında, bıçak sola-aşağı-öne
  [62, [0.2, -0.42, 0.42], ...dg(-43)],
  [64, [0.18, -0.38, 0.42], ...dg(-33)],                                     // geri tepme
  [68, [0.1, -0.36, 0.36], ...dg(-31)],
  [76, [-0.18, -0.42, 0.1], [-0.1, -0.62, 0.78], [0.2, -0.75, -0.6]],
  [LEN - 1, SWI.C.toArray(), SWI.t.toArray(), SWI.e.toArray()],
];
// vuruş sonu (54–68): kabza noktası mutlak hedef — x yanal / z ileri (kalçaya göre, yaw çerçevesi), h yerden yükseklik
const KA = [[54, [0.08, 0.92, 0.43]], [55, [0.15, 0.72, 0.47]], [56, [0.21, 0.61, 0.48]], [57, [0.24, 0.55, 0.47]], [59, [0.26, 0.515, 0.47]], [62, [0.25, 0.525, 0.47]], [64, [0.22, 0.58, 0.45]], [68, [0.13, 0.66, 0.41]]];
const WA = (f) => smooth((f - 53) / 2) * (1 - smooth((f - 68) / 6));
const WD = (f) => 1 + 7 * smooth((f - 52) / 2) * (1 - smooth((f - 66) / 4)) + 3 * smooth((f - 43) / 3) * (1 - smooth((f - 51) / 2)); // tasarım ağırlığı (jodan + vuruş sonu)
const SPD = (f) => (f <= 5 ? 5 : f >= 50 && f <= 56 ? 22 : 11);
function designAt(f) {
  const r = spl(KS.map((k) => [k[0], [...k[1], ...k[2], ...k[3]]]), f);
  const t = V(r[3], r[4], r[5]).normalize(); const e = V(r[6], r[7], r[8]); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return { C: V(r[0], r[1], r[2]), t, e };
}
const TWO = (f) => smooth((f - 5) / 13) * (1 - smooth((f - 64) / 13));   // iki el: 8–18 kavrar, 64–76 bırakır (burulma ≤8°/kare)
const GRIP = TWO;

// ---- maliyet ----
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
  let c = 0; const T = {};
  c += 4e4 * sq(ikR.err); if (ikL) c += 4e4 * g * sq(ikL.err);
  const outR = V(-1, 0, 0).applyQuaternion(D.Spine), outL = V(1, 0, 0).applyQuaternion(D.Spine), down = V(0, -1, 0);
  for (const [ik, out, tag] of [[ikR, outR, 'R'], [ikL, outL, 'L']]) {
    if (!ik) continue;
    const wm = ik.wmag; c += 0.002 * wm * wm + (wm > 13.5 ? 4 * sq(wm - 13.5) : 0);
    const a = Math.abs(ik.tau); c += (a > 60 ? 0.02 * sq(a - 60) : 0) + (a > 78 ? 3 * sq(a - 78) : 0);
    const b = ik.bend; c += (b < 22 ? 0.3 * sq(22 - b) : 0) + (b > 125 ? 0.3 * sq(b - 125) : 0);
    const h = ik.PH.clone().sub(ik.S).normalize(); const m = ik.E.clone().sub(ik.S); m.sub(h.clone().multiplyScalar(m.dot(h)));
    if (m.length() > 0.01 && ctx.soft > 0) { const pref = out.clone().add(down.clone().multiplyScalar(0.6)).normalize(); c += ctx.soft * 4 * sq(Math.max(0, 0.35 - m.normalize().dot(pref))); }
    const el = ik.E, wr = ik.S.clone().add(ik.u.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lu)).add(ik.fd.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lf));
    for (const [pt, r] of [[el, 0.06], [el.clone().lerp(wr, 0.5), 0.05], [wr, 0.05]]) { const d = meas(pt, r); if (d < 0.03) c += ctx.soft * 3000 * sq(0.03 - d); T[tag] = Math.min(T[tag] ?? 9, d); }
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
  { const cap = ctx.f >= 55 && ctx.f <= 64 ? 8 : 22; for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > cap ? 2 * sq(a - cap) : 0); } }
  if (ctx.prevTau) { for (const [ik, k] of [[ikR, 'R'], [ikL, 'L']]) { if (!ik || ctx.prevTau[k] == null) continue; const d = Math.abs(ik.tau - ctx.prevTau[k]); c += 0.006 * d * d + (d > 10 ? 0.3 * sq(d - 10) : 0); } }
  if (ctx.gam0 != null) { const d = Math.abs(x[6] - ctx.gam0); if (d > 14) c += 0.5 * sq(d - 14); }
  if (ctx.prevD) { const lim = SPD(ctx.f);
    for (const [ik, k, H] of [[ikR, 'R', R], [ikL, 'L', RL]]) { if (!ik || !ctx.prevD[k + 'U']) continue;
      for (const [Dn, Dp, ax] of [[ik.DU, ctx.prevD[k + 'U'], H.u0], [ik.DF, ctx.prevD[k + 'F'], H.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
        const tw = Math.abs(twistDeg(dq, ax)); if (tw > 6.5) c += 0.4 * sq(tw - 6.5); if (ctx.f <= 6) { const an = qMag(dq); if (an > lim) c += 0.3 * sq(an - lim); } } } }
  if (ctx.anchor) { const { xa, k } = ctx.anchor; c += k * (3000 * (sq(x[0] - xa[0]) + sq(x[1] - xa[1]) + sq(x[2] - xa[2])) + 0.05 * [3, 4, 5, 7, 8, 11, 12].reduce((a, i) => a + sq(x[i] - xa[i]), 0)); }
  if (g < 1 && ikL) c += (1 - g) * (0.05 * (sq(x[9] - ctx.wf[0]) + sq(x[10] - ctx.wf[1])) + 0.05 * (sq(x[13]) + sq(x[14])));
  if (!full) return c;
  return { c, C, t, e, DHR, DshR, DshL, ikR, ikL, tip, tipY, hc, bc, T, PLg };
}
let SEED = 12345; const rnd = () => ((SEED = (SEED * 1103515245 + 12345) % 2147483648) / 2147483648);
const STEP0 = [0.02, 0.02, 0.02, 4, 4, 4, 8, 3, 3, 3, 3, 3, 3, 3, 3];
function optimize(ctx, x0, iters = 400, scale = 1) {
  let x = x0.slice(), fx = evalX(ctx, x); let st = STEP0.map((s) => s * scale);
  for (let it = 0; it < iters; it++) {
    let imp = false;
    for (let i = 0; i < x.length; i++) {
      if (i === 6 && ctx.g <= 0) continue; if (i >= 9 && i <= 10 && ctx.g <= 0) continue; if (i >= 13 && ctx.g <= 0) continue;
      for (const sg of [1, -1]) { const y = x.slice(); y[i] += sg * st[i]; const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; break; } }
    }
    // rastgele birleşik yön (bağlı serbestlikler için)
    for (let k = 0; k < 6; k++) { const y = x.map((v, i) => v + (rnd() * 2 - 1) * st[i] * 0.7); const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; } }
    if (!imp) { st = st.map((s) => s * 0.5); if (st[0] < 2e-4) break; }
  }
  return { x, fx };
}

// ---- sol kol serbest (kavrama dışı; eski çözüm) ----
const chestD = (f) => spineD(f, bodyAt(f)).Spine;
const Dc0i = chestD(0).invert(), DcEi = chestD(LEN - 1).invert();
const uL0c = RL.u0.clone().applyQuaternion(A3.D.LeftArm).applyQuaternion(Dc0i), fL0c = RL.f0.clone().applyQuaternion(A3.D.LeftForeArm).applyQuaternion(Dc0i);
const uLEc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcEi), fLEc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcEi);
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
const LU = [[0, uL0c.toArray()], [16, [0.15, -0.75, 0.6]], [66, [0.1, -0.75, 0.62]], [70, [0.38, -0.72, 0.55]], [75, [0.52, -0.8, 0.22]], [LEN - 1, uLEc.toArray()]];   // bırakma: el gövdenin DIŞINDAN yan tarafa döner
const LF = [[0, flx(uL0c, fL0c).toArray()], [16, [-0.4, 0.1, 0.9]], [66, [-0.4, 0.1, 0.9]], [70, [-0.1, 0.2, 1]], [75, [0.1, 0.2, 1]], [LEN - 1, flx(uLEc, fLEc).toArray()]];
const BEND_L = [[0, deg(uL0c.angleTo(fL0c))], [16, 50], [66, 50], [70, 42], [75, 32], [LEN - 1, deg(uLEc.angleTo(fLEc))]];
const lcache = {}; const TAUF = { a: 0, b: 0 };   // serbest sol önkol pronasyonu (ön geçişte kavrama IK'sından)
const sst = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (10 - 15 * t + 6 * t * t); };
const tauFree = (f) => (f <= 40 ? TAUF.a * sst(f / 16) : TAUF.b * (1 - sst((f - 64) / 22)));
function leftFree(f) {
  if (lcache[f]) return lcache[f];
  const Dc = chestD(f); const uc = V(...spl(LU, f)).normalize(), bend = spl(BEND_L, f);
  const fx = V(...spl(LF, f)); fx.sub(uc.clone().multiplyScalar(fx.dot(uc))).normalize();
  const u = uc.clone().applyQuaternion(Dc), hint = uc.clone().multiplyScalar(Math.cos(rad(bend))).add(fx.multiplyScalar(Math.sin(rad(bend)))).applyQuaternion(Dc);
  const hg = hinge(RL, bend);
  let base, acc0;
  if (f === 0) { base = A3.D.LeftArm.clone(); acc0 = 0; }
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

let prevX = null, prevTau = null, prevD = null, GAM0 = 230; // γ merkezi (v3'ün kavrama penceresindeki orta değer), sapma ≤±15°
const WRI = swingOf('Right', IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand));
const X0 = [0, 0, 0, 0, 0, 0, 0, WR0[0], WR0[1], 0, 0, 0, 0, 0, 0], XE = [0, 0, 0, 0, 0, 0, 0, WRI[0], WRI[1], 0, 0, 0, 0, 0, 0];
function solve(f) {
  const p = bodyAt(f); const D = spineD(f, p);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(...p.hp));
  p.ground = {};
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s, f, hipsPos, p.pel[0], p.pel[2], D.Hips);
    p.ground[s] = f <= TOFF - 1 || f >= TL[s];
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    if (p.ground[s] && ft.ankle.distanceTo(hipJ) / (L1 + L2) > 0.962) { // yerde bacak erişimi ≤0,962: topuk kalkar (parmak ucu yerde)
      const pp0 = Math.max(0, ft.pitch); const ball = ft.ankle.clone().sub(V(0, FOOTL * Math.sin(rad(pp0)), -FOOTL * Math.cos(rad(pp0))).applyQuaternion(Ry(ft.yaw)));
      for (let pt = pp0; pt <= 46; pt += 0.5) { const a = ankleFromBall(ball, ft.yaw, pt); ft.ankle = a; ft.pitch = pt; if (a.distanceTo(hipJ) / (L1 + L2) <= 0.962) break; }
    }
    if (!p.ground[s]) { const dv0 = ft.ankle.clone().sub(hipJ); const r0 = dv0.length() / (L1 + L2); const K0 = 0.945, KW = 0.02; // havada bacak kilitlenmez (yumuşak doyum)
      if (r0 > K0) ft.ankle = hipJ.clone().add(dv0.multiplyScalar((K0 + KW * Math.tanh((r0 - K0) / KW)) / r0)); }
    let dv = ft.ankle.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    p["reach" + s] = d / (L1 + L2); d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1).applyQuaternion(Ry(ft.yaw - (s === 'Left' ? 5 : -15))).normalize(); if (ft.pole) pole.lerp(ft.pole, ft.poleW).normalize(); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h)); const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    { const fz = V(0, 0, 1), pl = knee.clone().sub(hipJ.clone().add(dir.clone().multiplyScalar(a))).normalize();
      const fr = (x0, x1) => basisQ(x1, pl).multiply(basisQ(x0, fz).invert());
      const wt = Math.min(1, f / 20), kt = wt * wt * wt * (10 - 15 * wt + 6 * wt * wt);   // 3. vuruşun burulmasından tutarlı çerçeveye yumuşak geçiş
      const td = knee.clone().sub(hipJ).normalize(), sd = ankle.clone().sub(knee).normalize();
      D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), td).slerp(fr(restDir(s + 'UpLeg', s + 'Leg'), td), kt);
      D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), sd).slerp(fr(restDir(s + 'Leg', s + 'Foot'), sd), kt); }
    D[s + 'Foot'] = eul([ft.yaw, ft.pitch, 0]);
    { // ayak parmakları: yerde taban düz kalır (parmak ucundan itiş / parmak→topuk iniş), havada hafif uzanır
      const cw = f < TOFF + 6 ? 1 - smooth((f - (TOFF - 1)) / 5) : smooth((f - (TL[s] - 4)) / 4);
      const bend = cw * -Math.min(Math.max(0, ft.pitch), 42) + (1 - cw) * 9;
      D[s + 'ToeBase'] = eul([ft.yaw, ft.pitch + bend, 0]); }
  }
  const fkPos = () => { const cur = {}, pos = {}, out = {}; for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
      cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ));
      out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]);
      pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, out }; };
  const pos0 = fkPos().pos;
  // sol serbest el (FK): önkol + gecikmeli salınım (yalnız salınım bileşeni → IK ile birebir temsil edilir)
  const lF = leftFree(f);
  const lag = leftFree(Math.max(0, f - 3)).fore; let rl = lF.fore.clone().invert().multiply(lag); const ang = qMag(rl);
  rl = new THREE.Quaternion().slerp(rl, ang > 9 ? 9 / ang : 1); const wf = swingOf('Left', rl);
  const SL0 = shoulderAt('Left', pos0, D.Spine);
  const LfP = SL0.clone().add(RL.u0.clone().applyQuaternion(lF.arm).multiplyScalar(ARM.Left.lu)).add(RL.f0.clone().applyQuaternion(lF.fore).multiplyScalar(ARM.Left.lf));
  const LfDH = lF.fore.clone().multiply(wristQ('Left', wf));
  const g = TWO(f);
  const kY = smooth((f - 42) / 6) * (1 - smooth((f - 70) / 10)); const Y = Ry(p.chestYaw * (1 - kY) + p.pel[0] * kY); const des = designAt(f); // vuruşta tasarım çerçevesi = pelvis (hedef) yönü
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C.clone().applyQuaternion(Y)), td: des.t.clone().applyQuaternion(Y), ed: des.e.clone().applyQuaternion(Y), pos0, D, g,
    Lf: { P: LfP, DH: LfDH }, meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, wf };
  const kS = 1 - smooth(f / 8), kE = smooth((f - 72) / 15);
  { const wa = WA(f); if (wa > 0) { const ka = spl(KA, Math.min(Math.max(f, 54), 68)); const Ca = hipsPos.clone().add(V(ka[0], 0, ka[2]).applyQuaternion(Y)); Ca.y = GROUND + ka[1]; ctx.Cd.lerp(Ca, wa); } }
  ctx.wd = WD(f); ctx.f = f; ctx.prevD = prevD; ctx.gam0 = g > 0 ? GAM0 : null;
  ctx.soft = 1 - Math.max(kS, kE); ctx.anchor = kS > 0 ? { xa: X0, k: 4 * kS } : kE > 0 ? { xa: XE, k: 4 * kE } : null;
  let x0 = prevX ? prevX.slice() : X0.slice();
  if (g <= 0) { x0[9] = wf[0]; x0[10] = wf[1]; x0[13] = 0; x0[14] = 0; if (ctx.prev) { ctx.prev = ctx.prev.slice(); ctx.prev[9] = wf[0]; ctx.prev[10] = wf[1]; } }
  if (g > 0 && prevX && TWO(f - 1) <= 0) { // kavramanın ilk karesi: γ taraması (diğer serbestlikler önceki kareye bağlı)
    let best = null; const pv = prevX.slice(); pv[9] = wf[0]; pv[10] = wf[1];
    for (let gm = GAM0 - 15; gm <= GAM0 + 15; gm += 5) { const xs = x0.slice(); xs[6] = gm; ctx.prev = pv.slice(); ctx.prev[6] = gm; const r = optimize(ctx, xs, 80); if (!best || r.fx < best.fx) best = r; }
    x0 = best.x; ctx.prev = pv; ctx.prev[6] = x0[6];
  }
  const opt = f === 0 ? { x: X0.slice(), fx: evalX(ctx, X0) } : optimize(ctx, x0, 400);
  prevX = opt.x;
  { const rr = evalX(ctx, opt.x, true); prevD = { RU: rr.ikR.DU, RF: rr.ikR.DF, LU: rr.ikL ? rr.ikL.DU : null, LF: rr.ikL ? rr.ikL.DF : null }; }
  const r = evalX(ctx, opt.x, true); prevTau = { R: r.ikR.tau, L: r.ikL ? r.ikL.tau : null };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  if (r.ikL) { D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
    if (g < 0.95) { const k = smooth(1 - g / 0.95); D.LeftShoulder = r.DshL.clone().slerp(D.Spine, k); D.LeftArm = r.ikL.DU.clone().slerp(lF.arm, k); D.LeftForeArm = r.ikL.DF.clone().slerp(lF.fore, k); D.LeftHand = r.ikL.DH.clone().slerp(LfDH, k); } }
  else { D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH; }
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.gw = g; p.chest = pos0.Spine;
  p.bladeDir = r.t; p.tip = r.tip; p.tipY = r.tipY;
  const fwd = V(0, 0, 1).applyQuaternion(Y); p.handFwd = Math.min(pos.RightHand.clone().sub(pos.Spine).dot(fwd), pos.LeftHand.clone().sub(pos.Spine).dot(fwd));
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// v6 ön geçiş: sol kolun serbest anahtarlarını kavrama başı/sonu IK pozuna eşitle → kavramaya giriş/çıkışta üst kol/önkol burulma sıçraması olmaz
{ const cap = {};
  for (let f = 0; f < LEN; f++) { const r = solve(f); if (f === 18 || f === 64) { const ik = r.p.r.ikL; const Di = chestD(f).invert(); const uc = ik.u.clone().applyQuaternion(Di), fc = ik.fd.clone().applyQuaternion(Di); cap[f] = { u: uc.toArray(), fx: flx(uc, fc).toArray(), b: ik.bend, tau: ik.tau }; } }
  prevX = null; prevTau = null; prevD = null; SEED = 12345; for (const k of Object.keys(lcache)) delete lcache[k];
  const setK = (arr, f, v) => { const i = arr.findIndex((k) => k[0] === f); if (i >= 0) arr[i] = [f, v]; else { arr.push([f, v]); arr.sort((x, y) => x[0] - y[0]); } };
  TAUF.a = cap[18].tau; TAUF.b = cap[64].tau; console.log('serbest önkol pronasyonu (kavrama başı/sonu):', TAUF.a.toFixed(0), TAUF.b.toFixed(0));
  for (const [fk, fc] of [[16, 18], [66, 64]]) { setK(LU, fk, cap[fc].u); setK(LF, fk, cap[fc].fx); setK(BEND_L, fk, cap[fc].b); }
}
const outs = []; const diag = []; const hand = [];
const t0run = Date.now();
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL?.err, tauR: R_.ikR.tau, tauL: R_.ikL?.tau, bendR: R_.ikR.bend, bendL: R_.ikL?.bend, wR: R_.ikR.wmag, wL: R_.ikL?.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reachLeft, r.p.reachRight], ground: r.p.ground, gw: r.p.gw, cy: r.p.chestYaw, pel: r.p.pel[0], handFwd: r.p.handFwd });
}
console.log('L1+L2', (L1 + L2).toFixed(3), 'yerde erişim>0.965:', diag.filter((d) => (d.f <= TOFF - 2 || d.f >= LAND)).flatMap((d) => [['L', 0], ['R', 1]].filter(([k, i]) => d.reach[i] > 0.965 && d.ground[k === 'L' ? 'Left' : 'Right']).map(([k, i]) => d.f + k + d.reach[i].toFixed(3))).join(' '));
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
const PRB = ARGS.includes('--diag');
if (PRB) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'g', d.gw.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', d.errL != null ? (d.errL * 1000).toFixed(1) : '-', 'wR', d.wR.toFixed(1), 'wL', d.wL?.toFixed(1) ?? '-', 'τR', d.tauR.toFixed(0), 'τL', d.tauL?.toFixed(0) ?? '-',
  'bR', d.bendR.toFixed(0), 'bL', d.bendL?.toFixed(0) ?? '-', 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2), 'fwd', d.handFwd.toFixed(2));

// ---- sol el parmakları: serbest (yaylı) ↔ kavrama (katana_run sol eli = kavrama yumruğu), GRIP ağırlığıyla ----
const FLEX = { Index: [16, 26, 10], Middle: [20, 32, 12], Ring: [25, 36, 14], Pinky: [30, 38, 15] };
const JW = [1, 0.6, 0.35];
const SPR = { Thumb: [0.6, 0.42], Index: [0.62, 0.34], Middle: [0.56, 0.32], Ring: [0.5, 0.3], Pinky: [0.44, 0.28] };
const PHs = { Thumb: 0.3, Index: 0, Middle: 0.7, Ring: 1.4, Pinky: 2.1 };
const spd = hand.map((h, f) => (f ? h.L.distanceTo(hand[f - 1].L) : 0)); const vmax = Math.max(0.02, ...spd);
const sec = {};
for (const kind of Object.keys(SPR)) {
  const [w, z] = SPR[kind]; let x = 0, v = 0; sec[kind] = [];
  for (let f = 0; f < LEN; f++) { v += -w * w * (x + 11 * spd[f] / vmax * (1 - GRIP(f))) - 2 * z * w * v; x += v; sec[kind].push(x + 1.5 * Math.sin(2 * Math.PI * (f + PH0) / 44 + PHs[kind])); }
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
for (const n of Object.keys(curl)) { const gq = Q(FINGERS[n].rot[0].slice(1)); curl[n] = curl[n].map((q, f) => q.clone().slerp(gq, GRIP(f))); }
Object.assign(fingerOut, curl);

// ---- dikiş (0. kare = 3[49]) ve bitiş (son kare = idle_drawn[0], yatay kök konumu hariç) ----
const SEAM = 9, ENDB = 24; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const r0 = {}, rE = {}, d0 = {}, dE = {};
for (const n of allNames) { const g0 = genAt(n, 0), gE = genAt(n, LEN - 1);
  r0[n] = g0.clone().invert().multiply(A3.local[n]); d0[n] = qAng(g0, A3.local[n]);
  rE[n] = gE.clone().invert().multiply(IDLE.local[n]); dE[n] = qAng(gE, IDLE.local[n]); }
const h0 = V(...A3.hl).sub(V(...outs[0].hipsLocal));
const hE = V(...IDLE.hl).sub(V(...outs[LEN - 1].hipsLocal)); hE.x = 0; hE.y = 0; // yalnız yükseklik (yerel z) eşlenir, yatay kök hareketi korunur
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const w0 = 1 - smooth(f / SEAM), wE = smooth((f - (LEN - 1 - ENDB)) / ENDB);
  for (const n of allNames) {
    let q = genAt(n, f).clone(); if (w0 > 0) q.multiply(powQ(r0[n], w0)); if (wE > 0) q.multiply(powQ(rE[n], wE));
    if (f === 0) q = A3.local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const hp = V(...outs[f].hipsLocal).add(h0.clone().multiplyScalar(w0)).add(hE.clone().multiplyScalar(wE));
  if (f === 0) hp.set(...A3.hl);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}

// ---- v6: kalkış anı yumuşatma (bacak zinciri, 15–21; binom çekirdeği, iki geçiş) — parmak ucundan kopuşta tek kare duruşu giderir ----
for (const [bs, fa, fb] of [[['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'], 17, 21]])
  for (let pass = 0; pass < 2; pass++) for (const n of bs) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
    for (let f = fa; f <= fb; f++) { const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[f + i - 2]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
      const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
// ---- v6: sol önkol pronasyonunu kavramaya giriş boyunca (1–18) tek yumuşak eğriye yay (önkol ekseni etrafında: el konumu değişmez) ----
{ const n = 'LeftForeArm', rq = Q(by[n].restQ), rqi = rq.clone().invert(); const twA = (f) => { const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))); return 2 * Math.atan2(d.y, d.w); };
  const a0 = 1, a1 = 18, t0 = twA(a0), t1 = twA(a1); const raw = []; for (let f = a0; f <= a1; f++) raw.push(twA(f));
  for (let f = a0 + 1; f < a1; f++) { const tn = t0 + (t1 - t0) * smooth((f - a0) / (a1 - a0)); const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), tn - raw[f - a0]));
    const q = rq.clone().multiply(d); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
// ---- v6: vuruş penceresinde kol zinciri yumuşatma (çözücünün kareler arası salınımını giderir); sol elin kabzadaki kayması ölçülür ----
const fkT = (f) => { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? Q(tracks[b.name].rot[f].slice(1)) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, cur }; };
const relLH = (f) => { const k = fkT(f); return { p: k.pos.LeftHand.clone().sub(k.pos.RightHand).applyQuaternion(k.cur.RightHand.clone().invert()), q: k.cur.RightHand.clone().invert().multiply(k.cur.LeftHand) }; };
const SA = 46, SB = 62; const rel0 = []; for (let f = SA; f <= SB; f++) rel0.push(relLH(f));
for (let pass = 0; pass < 2; pass++) for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = SA + 2; f <= SB - 2; f++) { const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[f + i - 2]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
    const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
// sol eli kabzaya geri oturt: omuz (serbest) + dirsek (yalnız menteşe) CCD, sonra el yönelimi (bilek bütçesi raporda ölçülür)
const parentOf = Object.fromEntries(bones.map((b) => [b.name, b.parent]));
const setLocal = (n, f, curW, k) => { const l = k.cur[parentOf[n]].clone().invert().multiply(curW); tracks[n].rot[f] = [f, l.x, l.y, l.z, l.w]; };
for (let f = SA; f <= SB; f++) {
  const k0 = fkT(f), r0 = rel0[f - SA]; const tp = k0.pos.RightHand.clone().add(r0.p.clone().applyQuaternion(k0.cur.RightHand)), tq = k0.cur.RightHand.clone().multiply(r0.q);
  for (let it = 0; it < 6; it++) for (const J of ['LeftArm', 'LeftForeArm']) {
    const k = fkT(f); const pJ = k.pos[J]; const v1 = k.pos.LeftHand.clone().sub(pJ), v2 = tp.clone().sub(pJ); let R;
    if (J === 'LeftForeArm') { const ax = RL.n0.clone().applyQuaternion(k.cur[J].clone().multiply(restW[J].clone().invert())).normalize();
      const a1 = v1.clone().sub(ax.clone().multiplyScalar(v1.dot(ax))), a2 = v2.clone().sub(ax.clone().multiplyScalar(v2.dot(ax)));
      R = new THREE.Quaternion().setFromAxisAngle(ax, Math.atan2(a1.clone().cross(a2).dot(ax), a1.dot(a2))); }
    else R = new THREE.Quaternion().setFromUnitVectors(v1.normalize(), v2.normalize());
    setLocal(J, f, R.multiply(k.cur[J]), k); }
  setLocal('LeftHand', f, tq, fkT(f));
}
{ let dm = 0, am = 0; for (let f = SA; f <= SB; f++) { const r = relLH(f), r0 = rel0[f - SA]; dm = Math.max(dm, r.p.distanceTo(r0.p)); am = Math.max(am, qAng(r.q, r0.q)); }
  let ax = 0, pp = 0; for (let f = SA; f <= SB; f++) { const d = relLH(f).p.sub(rel0[f - SA].p).applyQuaternion(restW.RightHand); const a_ = d.dot(b0); ax = Math.max(ax, Math.abs(a_)); pp = Math.max(pp, d.clone().sub(b0.clone().multiplyScalar(a_)).length()); }
  console.log('kol yumuşatma: sol elin sağ ele göre kayması max', (dm * 100).toFixed(2), 'cm (eksen boyunca', (ax * 100).toFixed(2), ', dik', (pp * 100).toFixed(2), 'cm),', am.toFixed(1), '°'); }
// ---- rapor (son izlerden FK ile ölçülür: dikiş harmanlamaları dahil) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − 3[49] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − idle[0] (sonda söner):', top(dE));
const seam = (C, fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = C.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(keyAt(t.rot, fa).slice(1)), qOf(n, fb)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seam(A3, A3.F, 0), [e0, e0n] = seam(IDLE, 0, LEN - 1);
console.log(`dikiş: 3[49]→4[0] max ${s0.toFixed(3)}° (${s0n}), kalça ${(V(...tracks.Hips.pos[0].slice(1)).distanceTo(V(...A3.hl)) * 1000).toFixed(2)} mm | 4[son]↔idle[0] max ${e0.toFixed(3)}° (${e0n}), kalça yükseklik ${((tracks.Hips.pos[LEN - 1][3] - IDLE.hl[2]) * 100).toFixed(2)} cm, yatay ${(Math.hypot(tracks.Hips.pos[LEN - 1][1] - IDLE.hl[0], tracks.Hips.pos[LEN - 1][2] - IDLE.hl[1]) * 100).toFixed(1)} cm (kök hareketi)`);
console.log('ilk kareler (max kemik °/kare):', [1, 2, 3, 4, 5, 6].map((f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mn = n; } } return m.toFixed(1) + ' ' + mn; }).join(', '));
// final FK
const FF = []; for (let f = 0; f < LEN; f++) { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? qOf(b.name, f) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); }
  const Dd = {}; for (const n of Object.keys(cur)) Dd[n] = cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos, D: Dd }); }
const palm = (s) => { const n = V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize(); return n; };
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: qMag(q), flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return m.toFixed(1) + '° (kare ' + mf + ')'; };
  console.log(s, 'bilek: fleksiyon max', mx('flex'), '| sapma max', mx('dev'), '| toplam max', mx('tot'), '| burulma max', mx('tw'));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const gF = [...Array(LEN).keys()].filter((f) => diag[f].gw > 0.99);
const gd = gF.map((f) => { const t = outs[f].p.bladeDir; return FF[f].pos.LeftHand.clone().sub(FF[f].pos.RightHand).dot(t) * 100; });
console.log('iki elli tam kavrama: kare', gF[0], '–', gF.at(-1), '| sol el sağ elden eksen boyunca', Math.min(...gd).toFixed(1), '..', Math.max(...gd).toFixed(1), 'cm | erişim hatası max R/L', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), '/', (Math.max(...diag.filter((d) => d.errL != null).map((d) => Math.abs(d.errL) * (d.gw))) * 1000).toFixed(1), 'mm');
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
const dd = diag.filter((d) => d.gw > 0);
console.log('β (roll sapması)', rng(diag.map((d) => d.x[5])), '| γ', rng(dd.map((d) => d.x[6])), '(tam kavrama', rng(diag.filter((d) => d.gw > 0.99).map((d) => d.x[6])) + ')', '| dirsek R', rng(diag.map((d) => d.bendR)), 'L(kavrama)', rng(dd.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), 'L', rng(dd.map((d) => d.tauL)), '| klavikula', rng(diag.flatMap((d) => d.x.slice(11))), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°');
const twOf = (n) => [...Array(LEN).keys()].map((f) => { const d = Q(by[n].restQ).invert().multiply(qOf(n, f)); return deg(2 * Math.atan2(d.y, d.w)); });
const stepMax = (a) => { let m = 0, mf = 0; a.slice(1).forEach((v, i) => { let dv = Math.abs(v - a[i]); if (dv > 180) dv = 360 - dv; if (dv > m) { m = dv; mf = i + 1; } }); return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kol burulma adımı max (°/kare): ', ['RightArm', 'RightForeArm', 'LeftArm', 'LeftForeArm'].map((n) => n + ' ' + stepMax(twOf(n))).join(', '));
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde', Math.min(...diag.map((d) => d.bc)).toFixed(3), '| bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '| uç-yer', Math.min(...diag.map((d) => d.tipY)).toFixed(3), '(kare', diag.reduce((a, d) => (d.tipY < a.tipY ? d : a)).f + ')');
console.log('eller göğüs önünde (m, min sağ/sol, yaw-ileri):', [42, 47, 52, 54, 56, 58, 62].map((f) => f + ':' + diag[f].handFwd.toFixed(2)).join(' '));
const F_ = [...Array(LEN).keys()];
const hy = F_.map((f) => FF[f].pos.Hips.y - restPos.Hips.y), hz = F_.map((f) => FF[f].pos.Hips.z);
const footY = F_.map((f) => Math.min(FF[f].pos.LeftToeBase.y, FF[f].pos.RightToeBase.y, FF[f].pos.LeftFoot.y - 0.06, FF[f].pos.RightFoot.y - 0.06) - (restPos.LeftToeBase.y));
const air = F_.filter((f) => footY[f] > 0.01);
console.log('zıplama: kalça tepe', (Math.max(...hy) * 100).toFixed(1), 'cm, havada', air.length, 'kare (', air[0], '–', air.at(-1), ') | ileri gidiş', ((hz[LEN - 1] - hz[0]) * 100).toFixed(1), 'cm (kalkış→iniş', ((hz[LAND] - hz[TOFF]) * 100).toFixed(1), ') | kalça en alçak', (Math.min(...hy.slice(LAND)) * 100).toFixed(1), 'cm');
console.log('dönüş: pelvis yaw', diag[0].pel.toFixed(0), '→', diag[LEN - 1].pel.toFixed(0), '(toplam', (diag[LEN - 1].pel - diag[0].pel).toFixed(0), '°) | bacak erişimi (yere basan ayak) max', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3));
const hipFlex = (f, s) => { const P_ = FF[f].pos; const th = P_[s + 'Leg'].clone().sub(P_[s + 'UpLeg']).applyQuaternion(FF[f].D.Hips.clone().invert()); return deg(Math.atan2(th.z, -th.y)); };
const airF = F_.filter((f) => f > TOFF && f < LAND);
console.log('uyluk fleksiyonu (pelvise göre) havada max sol/sağ', Math.max(...airF.map((f) => hipFlex(f, 'Left'))).toFixed(0), '/', Math.max(...airF.map((f) => hipFlex(f, 'Right'))).toFixed(0), '| 40–56:', [40, 44, 46, 48, 50, 52, 53, 54, 55, 56].map((f) => f + ':' + hipFlex(f, 'Left').toFixed(0) + '/' + hipFlex(f, 'Right').toFixed(0)).join(' '), '| hamlede (57) ön/arka', hipFlex(57, 'Left').toFixed(0), '/', hipFlex(57, 'Right').toFixed(0));
const kneeA = (f, s) => { const P_ = FF[f].pos; return deg(P_[s + 'Leg'].clone().sub(P_[s + 'UpLeg']).angleTo(P_[s + 'Foot'].clone().sub(P_[s + 'Leg']))); };
console.log('vuruş sonu kareleri: kare / el yüksekliği R,L (m) / bıçak açısı (° yataydan, − aşağı) / uç-yer (m) / kalça alçalması (cm) / pelvis eğimi / ön-arka diz / arka diz-yer (m)');
for (const f of [48, 50, 52, 53, 54, 55, 56, 57, 58, 60, 62, 64, 66]) { const P_ = FF[f].pos; const t = outs[f].p.bladeDir; const kh = P_.RightLeg.y - GROUND;
  console.log('  ', f, (P_.RightHand.y - GROUND).toFixed(2), (P_.LeftHand.y - GROUND).toFixed(2), deg(Math.asin(t.y)).toFixed(0), diag[f].tipY.toFixed(2), (hy[f] * 100).toFixed(0), diag[f].pel != null ? bodyAt(f).pel[1].toFixed(0) : '', kneeA(f, 'Left').toFixed(0) + '/' + kneeA(f, 'Right').toFixed(0), kh.toFixed(2)); }
const tipSp = F_.slice(1).map((f) => outs[f].p.tip.distanceTo(outs[f - 1].p.tip) * 60); console.log('bıçak ucu hızı (m/s) 48–58:', tipSp.slice(47, 58).map((v, i) => (i + 48) + ':' + v.toFixed(1)).join(' '));
const lyaw = (n, f) => { const d = Q(by[n].restQ).invert().multiply(qOf(n, f)); return deg(2 * Math.atan2(d.y, d.w)); };
console.log('yerel yaw (kemik Y ekseni, °) 14–60/2: kare | Hips Spine02 Spine01 Spine neck Head | pelvis yaw, göğüs yaw, ayrım σ, pelvis hızı');
for (let f = 14; f <= 60; f += 2) { const b = bodyAt(f); console.log('  ', f, '|', ['Hips', 'Spine02', 'Spine01', 'Spine', 'neck', 'Head'].map((n) => lyaw(n, f).toFixed(0)).join(' '), '|', b.pel[0].toFixed(0), b.chestYaw.toFixed(0), (b.chestYaw - b.pel[0]).toFixed(0), (bodyAt(f + 1).pel[0] - bodyAt(f - 1).pel[0]).toFixed(1) / 2); }
{ const v = F_.slice(1).map((f) => bodyAt(f).pel[0] - bodyAt(f - 1).pel[0]); const acc = v.slice(1).map((x, i) => Math.abs(x - v[i])); console.log('pelvis yaw hızı max', Math.max(...v).toFixed(1), '°/kare (kare', v.indexOf(Math.max(...v)) + 1, ') | ivme max', Math.max(...acc).toFixed(2), '°/kare² | baş−göğüs yaw max', Math.max(...F_.map((f) => { const b = bodyAt(f); return Math.abs(b.neck[0] + b.head[0]); })).toFixed(1)); }
{ const f = 58, P_ = FF[f].pos, b = bodyAt(f), Yi = Ry(-b.pel[0]); const rel = (v) => v.clone().sub(P_.Hips).applyQuaternion(Yi);
  const rh = rel(P_.RightHand), lh = rel(P_.LeftHand), tip = rel(outs[f].p.tip), lf = rel(P_.LeftFoot), lk = rel(P_.LeftLeg); const t = outs[f].p.bladeDir.clone().applyQuaternion(Yi);
  console.log('son poz (58, pelvis çerçevesi, x+ = karakterin solu, z+ = ileri; m): sağ el', rh.toArray().map((x) => x.toFixed(2)), 'sol el', lh.toArray().map((x) => x.toFixed(2)), '| sol diz', lk.toArray().map((x) => x.toFixed(2)), 'sol ayak', lf.toArray().map((x) => x.toFixed(2)), '| uç', tip.toArray().map((x) => x.toFixed(2)), 'uç-yer', diag[f].tipY.toFixed(2), '| bıçak yönü', t.toArray().map((x) => x.toFixed(2)), '| göğüs−pelvis', (b.chestYaw - b.pel[0]).toFixed(0)); }
const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
const DUMP = ARGS.find((x) => x.startsWith('--dump='))?.slice(7);   // --dump=<klasör>: klip + bıçak ucu izi (inceleme için)
if (DUMP) fs.writeFileSync(DUMP + '/agent3_cur.json', JSON.stringify(anim));
if (DUMP) fs.writeFileSync(DUMP + '/agent3_tip.json', JSON.stringify(outs.map((o, f) => ({ tip: o.p.tip.toArray(), C: o.p.r.C.toArray(), hips: FF[f].pos.Hips.toArray(), rh: FF[f].pos.RightHand.toArray(), head: FF[f].pos.Head.toArray() }))));
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log('5190 yüklendi', r);
  if (!ARGS.includes('--nosave')) { const s = await (await fetch(BASE + '/api/animations/save?name=' + NAME, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', s); }
}
