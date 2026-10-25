// game_heavy_attack_1 üretici: AĞIR H1 "savunma kırma" = TSUBAME-GAESHI (kırlangıç dönüşü) — 1. hafif vuruşun son pozundan (41)
// dikişsiz dallanır. L1 kılıcı sağ altta, önde bırakır; H1 geri çekmez, oradan döner (kullanıcı kararı 2026-10-25):
// Dönüş (0–22, "kırlangıç suya değer"): L1'in inişinin momentumu sürer — bilek döner, uç önde aşağı düşer, sağ yanda yeri SIYIRARAK
// geriye kayar (uç yerden ~3 cm), sol el kabzayı kılıç sağ yana gelince yakalar; gövde sağa sarılır, kalça çöker = BEKLEME KARESİ (22:
// alçak waki, iki el, iki ayak yerde). Vuruş (22–38): arka bacak iter, sol ayak öne
// basar (fumikomi, temasla), kalça → göğüs → kollar → kılıç; kılıç iki elle tek çapraz düzlemde (kiri-age, ~32° yatık, roll sabit,
// kenar önde) sağ alttan sol üste sert yükselir: temas göğüs hizasında, rakibin savunmasını yukarı savurur; takipte eller sol omzun
// üstüne uzanır, gövde yukarı açılır. Zanshin (38–44), sonra kılıcın ağırlığı düşer, gövde çöker ve oturur; sol el bırakır; son kare
// game_katana_idle[0] (yatay kök hariç). Çözücü (iki elli kılıç-öncelikli kol IK, bilek ≤14°) light-attack-4.mjs'ten.
// Yalnız bu chat'in editörüne (UPE_PORT, varsayılan 5184) yükler/kaydeder. Çalıştır: node heavy-attack-1.mjs [--nosend] [--nosave] [--diag]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const BASE = 'http://127.0.0.1:' + (process.env.UPE_PORT || '5184');   // yalnız bu chat'in MCP editörü (get_status → editorUrl)
const NAME = 'game_heavy_attack_1', PREVIEW = 'preview_heavy_attack_1_charged';
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

// ---- eğri: monoton kübik Hermite (Fritsch–Butland teğeti; uç noktalarda ve 'z' işaretli anahtarda teğet 0 → aşma yok) ----
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (j === 0 || j === n - 1 || keys[j][2] === 'z') return Pj.map(() => 0);
    const a = asArr(keys[j - 1][1]), b = asArr(keys[j + 1][1]); const h0 = keys[j][0] - keys[j - 1][0], h1 = keys[j + 1][0] - keys[j][0];
    return Pj.map((p, c) => { const d0 = (p - a[c]) / h0, d1 = (b[c] - p) / h1; if (d0 * d1 <= 0) return 0;
      return 3 * (h0 + h1) / ((2 * h1 + h0) / d0 + (h1 + 2 * h0) / d1); }); };
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
const A1 = clipPose('game_light_attack_1', 'last');
const IDLE_NAME = 'game_katana_idle';                       // oyundaki kılıç elde idle (PR #17)
const IDLE = clipPose(IDLE_NAME, 0);

function mkHinge(side) {
  const u0 = restDir(side + 'Arm', side + 'ForeArm'), f0 = restDir(side + 'ForeArm', side + 'Hand');
  const n0 = u0.clone().cross(f0).normalize(); const ang0 = u0.angleTo(f0);
  const test = u0.angleTo(f0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(n0, 0.1)));
  return { u0, f0, n0, ang0, sgn: test > ang0 ? 1 : -1 };
}
const R = mkHinge('Right'), RL = mkHinge('Left');
R.f0 = fr0;
const hinge = (H, bend) => new THREE.Quaternion().setFromAxisAngle(H.n0, H.sgn * (rad(bend) - H.ang0));

// ---- Zaman çizelgesi (74 kare = 1,23 sn @60) ----
// 0 L1 sonu → 8 toplanma (sol el kabzaya) → 16 sarılma → 22 BEKLEME (alçak, uç sağ-aşağıda) → 26 itiş (gövde ilerler, göğüs sarılı)
// → 29 açılma → 30 sol ayak basar → 31 TEMAS (göğüs hizası) → 34 yükseliş → 38 tepe (eller sol omzun üstünde) → 42 zanshin
// → 50 kılıcın ağırlığı düşer, gövde çöker → 50–62 sol el bırakır → 73 katana_idle[0]
const LEN = 74, HOLD = 22, LANDF = 29, HIT = 30, TOP = 38, STOP = 42, BOT = TOP, PH0 = 41;
const yStart = A1.hipsPos.y - restPos.Hips.y, zStart = A1.hipsPos.z - restPos.Hips.z, xStart = A1.hipsPos.x - restPos.Hips.x;
const IDLE_Y = IDLE.hipsPos.y - restPos.Hips.y, IDLE_X = IDLE.hipsPos.x - restPos.Hips.x;
const HY = [[0, yStart], [6, -0.12], [12, -0.19], [17, -0.205], [HOLD, -0.2, 'z'], [26, -0.175], [29, -0.155], [HIT, -0.14], [34, -0.1], [TOP, -0.095], [STOP, -0.11, 'z'], [50, -0.165], [56, -0.13], [64, -0.05], [LEN - 1, IDLE_Y]];
const HZ = [[0, zStart], [10, zStart - 0.01], [HOLD, zStart - 0.02, 'z'], [26, zStart + 0.06], [29, zStart + 0.22], [HIT, zStart + 0.35], [34, zStart + 0.43], [TOP, zStart + 0.47], [46, zStart + 0.49], [56, zStart + 0.51], [LEN - 1, zStart + 0.54]];
const HX = [[0, xStart], [HOLD, -0.035, 'z'], [HIT, 0.0], [TOP, 0.03], [50, 0.02], [LEN - 1, IDLE_X]];
const hipsAt = (f) => V(spl(HX, f), spl(HY, f), spl(HZ, f));

// gövde: pel = dünya [yaw (+ sola), pitch (+ öne), roll]; s2/s1/ch = omurga artımları (ebeveyne göre)
const T = { start: 0, gather: 8, coil: 16, hold: HOLD, drive: 26, snap: 29, hit: HIT, through: 34, top: TOP, zan: STOP, settle: 50, rise: 60, rest: LEN - 1 };
const P = {
  start:   { pel: [0, 0, 0], s2: [0, 0, 0], s1: [0, 0, 0], ch: [0, 0, 0] },
  gather:  { pel: [4, 7, -1],    s2: [-3, 1, 0],   s1: [-4, 1, 0],   ch: [-4, 0, 0] },
  coil:    { pel: [-12, 11, -2], s2: [-5, 0, 1],   s1: [-8, 0, 1],   ch: [-9, 1, 1] },
  hold:    { pel: [-15, 12, -3], s2: [-6, 0, 2],   s1: [-9, 0, 2],   ch: [-10, 1, 1] },   // göğüs −40° (sol omuz öne), alçak, ağırlık arkada
  drive:   { pel: [-6, 13, -1],  s2: [-6, 0, 1],   s1: [-9, 0, 1],   ch: [-9, 0, 0] },    // gövde ilerler, sarılma korunur
  snap:    { pel: [12, 10, 1],   s2: [-2, -1, 0],  s1: [-3, -1, 0],  ch: [-3, -1, 0] },
  hit:     { pel: [24, 6, 2],    s2: [1, -2, -1],  s1: [2, -3, -1],  ch: [3, -3, -1] },   // göğüs açılır, gövde kılıçla yükselir
  through: { pel: [32, 2, 2],    s2: [3, -3, -2],  s1: [4, -4, -2],  ch: [4, -4, -2] },
  top:     { pel: [35, 0, 1],    s2: [3, -4, -2],  s1: [4, -5, -2],  ch: [5, -4, -2] },   // tam açılma: kollar sol-yukarı uzanır
  zan:     { pel: [34, 1, 0],    s2: [3, -3, -2],  s1: [4, -4, -2],  ch: [4, -3, -2] },
  settle:  { pel: [24, 8, 0],    s2: [2, 1, 0],    s1: [2, 1, 0],    ch: [2, 0, 0] },     // kılıcın ağırlığı düşer: gövde öne çöker
  rise:    { pel: [8, 3, 0],     s2: [0, 0, 0],    s1: [0, 0, 0],    ch: [0, 0, 0] },
  rest:    { pel: [0, 0, 0], s2: [0, 0, 0], s1: [0, 0, 0], ch: [0, 0, 0] },
};
const ZK = new Set(['hold', 'zan']);
{
  const inc = (C, c, p) => ypr(C.D[c].clone().multiply(C.D[p].clone().invert()));
  const S = P.start; S.pel = ypr(A1.D.Hips); S.s2 = inc(A1, 'Spine02', 'Hips'); S.s1 = inc(A1, 'Spine01', 'Spine02'); S.ch = inc(A1, 'Spine', 'Spine01');
  const g = PH0; S.ch[1] -= 0.9 * Math.sin(2 * Math.PI * g / 44); S.s1[1] -= 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6); S.pel[2] -= 0.8 * Math.sin(g * 0.11);
  const E = P.rest; E.pel = ypr(IDLE.D.Hips); E.s2 = inc(IDLE, 'Spine02', 'Hips'); E.s1 = inc(IDLE, 'Spine01', 'Spine02'); E.ch = inc(IDLE, 'Spine', 'Spine01');
  const gE = PH0 + LEN - 1; E.ch[1] -= 0.9 * Math.sin(2 * Math.PI * gE / 44); E.s1[1] -= 0.5 * Math.sin(2 * Math.PI * gE / 44 + 0.6); E.pel[2] -= 0.8 * Math.sin(gE * 0.11);
}
const startNeck = ypr(A1.D.neck.clone().multiply(A1.D.Spine.clone().invert())), startHead = ypr(A1.D.Head.clone().multiply(A1.D.neck.clone().invert()));
const idleNeck = ypr(IDLE.D.neck.clone().multiply(IDLE.D.Spine.clone().invert())), idleHead = ypr(IDLE.D.Head.clone().multiply(IDLE.D.neck.clone().invert()));
// kinetik zincir: pelvis önde, göğüs geride; bekleme karesinde hepsi aynı anda durur (gecikme bekleme çevresinde söner)
const LEAD = { pel: 2.2, s2: 1.2, s1: 0.4, ch: -0.6 };
const leadW = (f) => smooth(Math.abs(f - HOLD) / 4) * smooth(f / 6);
const names = Object.keys(T);
// baş: dönüşte hafif öne (kılıca) → bekleme hedefe → yükselişte kılıcı izleyip kalkar → zanshin'de hedefte → çöküşte öne → idle
const HPITCH = [[0, 0], [10, 3], [HOLD, 2, 'z'], [29, 0], [33, -6], [TOP, -8], [STOP, -5], [50, 3], [58, -2], [LEN - 1, 0]];
// ---- canlılık katmanı (light-attack-4 v6 gibi): gövde çerçevesinde omurga fleksiyonu (+ öne) / yan eğilme (− sola), kademeli yaylı gecikme;
// dönüşte gövde kılıca eğilir ve sıkışır (yay kurulur), yükselişte açılır (geriye gerilme) + sola yan eğilme, zanshin'de gergin kalır,
// kılıcın ağırlığı düşerken öne kasılır, doğrulurken bir nefes (göğüs açılır), sonra söner
const LIFE_F = [[0, 0], [6, 4], [12, 7], [17, 6], [HOLD, 6], [26, 4], [29, 0], [HIT, -6], [34, -12], [TOP, -11], [STOP, -8], [47, -2], [52, 5], [58, 1], [64, -3], [70, -1], [LEN - 1, 0]];
const LIFE_L = [[0, 0], [10, 4], [HOLD, 6], [27, 3], [HIT, -4], [35, -9], [STOP, -8], [50, -3], [58, 0], [LEN - 1, 0]];
const springF = (arr, w, z) => { let x = arr[0], v = 0; return arr.map((t) => { v += w * w * (t - x) - 2 * z * w * v; x += v; return x; }); };
const LIFE = (() => {
  const fr = [...Array(LEN + 2).keys()]; const ramp = (f) => smooth(f / 7) * (1 - smooth((f - (LEN - 9)) / 8));
  const seg = (keys, lag, w, z) => springF(fr.map((f) => spl(keys, Math.max(0, f - lag)) * ramp(f)), w, z);
  const o = { s2: [seg(LIFE_F, 0, 0.9, 0.65), seg(LIFE_L, 0, 0.9, 0.65)], s1: [seg(LIFE_F, 0.8, 0.75, 0.55), seg(LIFE_L, 0.8, 0.75, 0.55)], ch: [seg(LIFE_F, 1.6, 0.65, 0.5), seg(LIFE_L, 1.6, 0.65, 0.5)] };
  const SH = { s2: 0.4, s1: 0.5, ch: 0.5 };
  for (const k of Object.keys(SH)) o[k] = o[k].map((a) => a.map((v) => v * SH[k]));
  const chP = fr.map((f) => o.s2[0][f] + o.s1[0][f] + o.ch[0][f]), chL = fr.map((f) => o.s2[1][f] + o.s1[1][f] + o.ch[1][f]);
  const lagP = springF(chP, 0.42, 0.42), lagL = springF(chL, 0.42, 0.42);
  const gz = (f) => smooth((f - 30) / 6) * (1 - smooth((f - 54) / 10));   // vuruşta bakış sabitleme
  o.neck = [fr.map((f) => 0.35 * (lagP[f] - chP[f]) - 0.3 * chP[f] * gz(f)), fr.map((f) => 0.3 * (lagL[f] - chL[f]))];
  const lagP2 = springF(chP, 0.33, 0.4), lagL2 = springF(chL, 0.33, 0.4);
  o.head = [fr.map((f) => 0.45 * (lagP2[f] - chP[f]) - 0.35 * chP[f] * gz(f)), fr.map((f) => 0.35 * (lagL2[f] - chL[f]) - 0.4 * chL[f] * gz(f))];
  return o;
})();
const lifeAt = (f) => { const i = Math.max(0, Math.min(LEN - 1, Math.round(f))); const g = (k) => [LIFE[k][0][i], LIFE[k][1][i]]; return { s2: g('s2'), s1: g('s1'), ch: g('ch'), neck: g('neck'), head: g('head') }; };
const Eb = (yw, pr) => Ry(yw).multiply(Rx(pr[0])).multiply(Rz(-pr[1])).multiply(Ry(-yw));   // gövde çerçevesinde: + öne, + sola
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
  const r = {}; const lw = leadW(f);
  for (const k of Object.keys(P.start)) r[k] = spl(names.map((n) => [T[n], P[n][k], ZK.has(n) ? 'z' : undefined]), f + (LEAD[k] || 0) * lw);
  const g = f + PH0; r.ch[1] += 0.9 * Math.sin(2 * Math.PI * g / 44); r.s1[1] += 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6); r.pel[2] += 0.8 * Math.sin(g * 0.11);
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  const tilt = r.pel[1] + r.s2[1] + r.s1[1] + r.ch[1];
  // baş: hedefe (dünya +Z) bakar; göğüs dönüşünü ±38° içinde telafi eder, gövdenin öne eğimini kısmen geri alır
  const spot = Math.max(-42, Math.min(42, -cy)); const ws = 1 - smooth(f / 10), we = smooth((f - 52) / 18);
  const inc = spot * (1 - we) + (idleNeck[0] + idleHead[0]) * we;
  const hp = spl(HPITCH, f - 1.5) - 0.45 * Math.max(0, tilt - 8) * (1 - we);
  r.neck = [inc * 0.45 * (1 - ws) + startNeck[0] * ws, (hp * 0.4) * (1 - ws) * (1 - we) + startNeck[1] * ws + idleNeck[1] * we * (1 - ws), (-0.3 * r.pel[2]) * (1 - ws) * (1 - we) + startNeck[2] * ws + idleNeck[2] * we];
  r.head = [inc * 0.55 * (1 - ws) + startHead[0] * ws, (hp * 0.6) * (1 - ws) * (1 - we) + startHead[1] * ws + idleHead[1] * we * (1 - ws), (-0.4 * r.pel[2] + 0.8 * Math.sin(g * 0.09 + 1)) * (1 - ws) * (1 - we) + startHead[2] * ws + idleHead[2] * we];
  r.hp = hipsAt(f).toArray();
  return r;
}

// ---- ayaklar (taban noktası = top; yerde sabit). Sol: 25–32 fumikomi adımı; sağ: 26–30 topuk kalkar, 30–38 kayarak toplanır; sonra idle duruşu ----
const FOOTL = 0.13;
const ankleFromBall = (ball, yaw, pitch, clampP = true) => { const p = clampP ? Math.max(0, pitch) : pitch; return ball.clone().add(V(0, FOOTL * Math.sin(rad(p)), -FOOTL * Math.cos(rad(p))).applyQuaternion(Ry(yaw))); };
const foot0 = {};
for (const s of ['Left', 'Right']) { const e = ypr(A1.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  foot0[s] = { yaw: e[0], pitch: e[1], ball: A1.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0]))) }; }
const hipsEnd = restPos.Hips.clone().add(hipsAt(LEN - 1));
const footIdle = {};
for (const s of ['Left', 'Right']) { const e = ypr(IDLE.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  const ball = IDLE.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0])));
  footIdle[s] = { yaw: e[0], pitch: e[1], ball: ball.clone().sub(IDLE.hipsPos).add(hipsEnd).setY(ball.y) }; }
const STEP_L = V(-0.02, 0, 0.42), SLIDE_R = V(0.04, 0, 0.42);
const landL = foot0.Left.ball.clone().add(STEP_L), slideR = foot0.Right.ball.clone().add(SLIDE_R);
const REACH_MAX = (() => { let m = 0; for (const s of ['Left', 'Right']) { const hipJ = IDLE.pos[s + 'UpLeg']; m = Math.max(m, IDLE.pos[s + 'Foot'].distanceTo(hipJ) / (V(...by.RightLeg.restP).length() + V(...by.RightFoot.restP).length())); } return Math.max(0.962, m + 0.003); })();
const FT = { L: { up: 23, land: LANDF, adj0: 60, adj1: 70 }, R: { heel: 23, s0: 26, s1: 38, st0: 52, st1: 62 } };
function footAt(s, f) { const r = footAt0(s, f); r.ball.y += (footIdle[s].ball.y - foot0[s].ball.y) * smooth(f / 12); return r; }
function footAt0(s, f) {
  if (s === 'Left') {
    const F0 = foot0.Left, FI = footIdle.Left, k = FT.L;
    if (f <= k.up) return { ball: F0.ball.clone(), yaw: F0.yaw, pitch: F0.pitch, ground: true, cw: 1 };
    if (f < k.land) { const u = (f - k.up) / (k.land - k.up); const ball = F0.ball.clone().lerp(landL, sst(u)); ball.y += 0.09 * Math.sin(Math.PI * Math.min(1, u * 1.08));
      const pitch = spl([[0, F0.pitch], [0.25, 10], [0.6, -8], [0.86, -12], [1, 0]], u);       // önce topuk kalkar, havada parmak yukarı, düz basar
      return { ball, yaw: F0.yaw + (4 - F0.yaw) * sst(u), pitch, ground: false, cw: 0.3, unclamped: true }; }
    if (f < k.adj0) return { ball: landL.clone(), yaw: 4, pitch: 0, ground: true, cw: 1 };
    const u = Math.min(1, (f - k.adj0) / (k.adj1 - k.adj0)); const ball = landL.clone().lerp(FI.ball, sst(u)); ball.y += 0.03 * Math.sin(Math.PI * u);
    return { ball, yaw: 4 + (FI.yaw - 4) * sst(u), pitch: FI.pitch * sst(u), ground: u >= 1 || u <= 0, cw: 1 };
  }
  const F0 = foot0.Right, FI = footIdle.Right, k = FT.R;
  if (f <= k.heel) return { ball: F0.ball.clone(), yaw: F0.yaw, pitch: F0.pitch, ground: true, cw: 1 };
  if (f <= k.s0) return { ball: F0.ball.clone(), yaw: F0.yaw, pitch: F0.pitch + (30 - F0.pitch) * smooth((f - k.heel) / (k.s0 - k.heel)), ground: true, cw: 1 };
  if (f <= k.s1) { const u = (f - k.s0) / (k.s1 - k.s0); const ball = F0.ball.clone().lerp(slideR, smooth(u)); ball.y += 0.012 * Math.sin(Math.PI * u);
    return { ball, yaw: F0.yaw + (-16 - F0.yaw) * sst(u), pitch: 30 - 3 * sst(u), ground: true, cw: 1 }; }
  if (f <= k.st0) return { ball: slideR.clone(), yaw: -16, pitch: 27 - 17 * smooth((f - (k.s1 + 4)) / (k.st0 - k.s1 - 4)), ground: true, cw: 1 };
  const u = Math.min(1, (f - k.st0) / (k.st1 - k.st0)); const ball = slideR.clone().lerp(FI.ball, sst(u)); ball.y += 0.05 * Math.sin(Math.PI * u);
  return { ball, yaw: -16 + (FI.yaw + 16) * sst(u), pitch: 10 + (FI.pitch - 10) * sst(u) + 14 * Math.sin(Math.PI * u), ground: u >= 1, cw: u >= 1 ? 1 : 0.5 };
}

// ===== KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ (light-attack-4.mjs ile aynı) =====
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
const WR0 = [0, 0]; { const a = ARM.Right; WR0[0] = WRIST * nW.dot(a.a1); WR0[1] = WRIST * nW.dot(a.a2); }
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

// ---- kılıç yolu (tasarım çerçevesi: x sol, y yukarı, z ileri; göğüs eklemine göre). C = kabza noktası, t = bıçak, e = kenar ----
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const toYaw = (sw, cy, org) => ({ C: sw.C.clone().sub(org).applyQuaternion(Ry(-cy)), t: sw.t.clone().applyQuaternion(Ry(-cy)), e: sw.e.clone().applyQuaternion(Ry(-cy)) });
const cyA = bodyAt(0).chestYaw, cyI = bodyAt(LEN - 1).chestYaw;
const SW0 = toYaw(swordFromHand(A1.D.RightHand, A1.pos.RightHand), cyA, A1.pos.Spine), SWI = toYaw(swordFromHand(IDLE.D.RightHand, IDLE.pos.RightHand), cyI, IDLE.pos.Spine);
// tek çapraz kesim düzlemi (kiri-age, yatığa yakın): F' öne, U' sola-yukarı (yataydan ~32°). φ = 0 ileri, +90 sol-yukarı, −90 sağ-aşağı,
// −110 sağ-aşağı-geri (waki). Kenar artan φ yönünde (önde). Dönüşte düzlem göğüsle döner, vuruşta hedefe (+Z) oturur.
// Not: bıçak sağ altta DİK aşağı bakarken iki elli kavrama çözülemiyor (kenar dirseğin karşısında, sol el kabzaya yetişmiyor);
// bekleme karesi H4'te çözülebildiği görülen alçak waki tutuşudur (bıçak sağa-geriye yatık, kenar aşağı-önde).
const PF = V(0, 0.05, 1).normalize(); const PU = V(0.85, 0.53, 0); PU.sub(PF.clone().multiplyScalar(PU.dot(PF))).normalize();
const pl = (phi) => { const c = Math.cos(rad(phi)), s = Math.sin(rad(phi));
  return [PF.clone().multiplyScalar(c).add(PU.clone().multiplyScalar(s)).toArray(), PF.clone().multiplyScalar(-s).add(PU.clone().multiplyScalar(c)).toArray()]; };
const WAKI = [[-0.2, -0.34, 0.31], [-0.88, -0.3, -0.37], [-0.25, -0.8, 0.55]];
const KS = [
  [0, SW0.C.toArray(), SW0.t.toArray(), SW0.e.toArray()],
  [6, null, null, null],                                  // bilek döner: uç önde aşağı düşer (aşağıda doldurulur)
  [12, [-0.26, -0.47, 0.27], V(-0.45, -0.75, 0.45).normalize().toArray(), null],  // uç sağ-önde yere iner
  [17, [-0.24, -0.43, 0.29], V(-0.8, -0.55, 0.1).normalize().toArray(), null],    // yeri sıyırarak sağa-geriye kayar, sol el kabzayı yakalar
  [HOLD, ...WAKI, 'z'],                                   // BEKLEME: alçak waki (eller sağ kalçada, bıçak sağa-geriye yatık, kenar aşağı-önde)
  [25, [-0.195, -0.335, 0.325], ...WAKI.slice(1)],         // itişte kılıç geride kalır (sürüklenme)
  [27, [-0.19, -0.31, 0.36], ...pl(-94)],
  [28, [-0.165, -0.285, 0.39], ...pl(-78)],
  [29, [-0.11, -0.22, 0.43], ...pl(-46)],
  [HIT, [-0.04, -0.12, 0.45], ...pl(-8)],                // TEMAS: göğüs hizası, bıçak ileri
  [31, [0.03, 0.0, 0.44], ...pl(30)],
  [32, [0.1, 0.11, 0.4], ...pl(62)],
  [33, [0.15, 0.2, 0.37], ...pl(82)],                    // savunmayı yukarı-sola savurur
  [35, [0.19, 0.27, 0.34], ...pl(95)],
  [TOP, [0.21, 0.31, 0.32], ...pl(106)],               // tepe: kılıç biraz aşar (eller sol omzun önünde-üstünde, bıçak sola-yukarı)
  [STOP, [0.2, 0.295, 0.31], ...pl(99), 'z'],           // zanshin: geri oturur
  [46, [0.19, 0.26, 0.32], ...pl(96)],
  [52, [0.05, -0.02, 0.31], ...pl(55)],                  // kılıcın ağırlığı düşer
  [60, [-0.12, -0.24, 0.27], null, null],                // toparlanma: öne, sağa iner (aşağıda doldurulur)
  [LEN - 1, SWI.C.toArray(), SWI.t.toArray(), SWI.e.toArray()],
];
{ const i = KS.findIndex((k) => k[0] === 6), a = KS[i - 1], b = KS[i + 1]; KS[i] = [6, V(...a[1]).lerp(V(...b[1]), 0.5).toArray(), V(...a[2]).add(V(...b[2])).normalize().toArray(), null];
  // dönüş anahtarlarının kenarı: L1 sonundan waki'ye yumuşak (bıçağa dik)
  for (const k of KS) if (k[0] > 0 && k[0] < HOLD && !k[3]) { const t = V(...k[2]), e = V(...SW0.e.toArray()).lerp(V(...WAKI[2]), smooth(k[0] / HOLD)); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize(); k[3] = e.toArray(); } }
{ const i = KS.findIndex((k) => k[0] === 60), a = KS[i - 1], b = KS[i + 1];
  const t = V(...a[2]).add(V(...b[2])).normalize(), e = V(...a[3]).add(V(...b[3])); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize(); KS[i] = [60, KS[i][1], t.toArray(), e.toArray()]; }
const WD = (f) => 1 + 3 * smooth((f - 16) / 4) * (1 - smooth((f - 25) / 2)) + 6 * smooth((f - 27) / 2) * (1 - smooth((f - 44) / 4));
const SPD = (f) => (f <= 5 ? 5 : f >= 26 && f <= 38 ? 28 : 11);
function designAt(f) {
  const r = spl(KS.map((k) => [k[0], [...k[1], ...k[2], ...k[3]], k[4]]), f);
  const t = V(r[3], r[4], r[5]).normalize(); const e = V(r[6], r[7], r[8]); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return { C: V(r[0], r[1], r[2]), t, e };
}
const TWO = (f) => smooth((f - 8) / 15) * (1 - smooth((f - 27) / 8));    // iki el: 8–23 kavrar (bekleme iki elle), vuruşa geçerken 27–35 bırakır
const GRIP = TWO;
const G_ON = 23, G_OFF = 27;

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
  let c = 0; const T_ = {};
  c += 4e4 * sq(ikR.err); if (ikL) c += 4e4 * g * g * sq(ikL.err);   // sol el kabzaya kademeli çekilir (kavrama girişinde sağ kol sıçramasın)
  const outR = V(-1, 0, 0).applyQuaternion(D.Spine), outL = V(1, 0, 0).applyQuaternion(D.Spine), down = V(0, -1, 0);
  for (const [ik, out, tag] of [[ikR, outR, 'R'], [ikL, outL, 'L']]) {
    if (!ik) continue;
    const wm = ik.wmag; c += 0.002 * wm * wm + (wm > 13.5 ? 4 * sq(wm - 13.5) : 0);
    const a = Math.abs(ik.tau); c += (a > 60 ? 0.02 * sq(a - 60) : 0) + (a > 78 ? 3 * sq(a - 78) : 0);
    const b = ik.bend; c += (b < 22 ? 0.3 * sq(22 - b) : 0) + (b > 125 ? 0.3 * sq(b - 125) : 0);
    const h = ik.PH.clone().sub(ik.S).normalize(); const m = ik.E.clone().sub(ik.S); m.sub(h.clone().multiplyScalar(m.dot(h)));
    if (m.length() > 0.01 && ctx.soft > 0) { const pref = out.clone().add(down.clone().multiplyScalar(0.6)).normalize(); c += ctx.soft * 4 * sq(Math.max(0, 0.35 - m.normalize().dot(pref))); }
    const el = ik.E, wr = ik.S.clone().add(ik.u.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lu)).add(ik.fd.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lf));
    for (const [pt, r] of [[el, 0.06], [el.clone().lerp(wr, 0.5), 0.05], [wr, 0.05]]) { const d = meas(pt, r); if (d < 0.03) c += ctx.soft * 3000 * sq(0.03 - d); T_[tag] = Math.min(T_[tag] ?? 9, d); }
  }
  const pom = C.clone().add(t.clone().multiplyScalar(-HALF - SR)), tip = C.clone().add(t.clone().multiplyScalar(HALF - SR));
  let bc = 9; for (let s = 0.1; s <= 0.92; s += 0.1) { const d = meas(pom.clone().lerp(tip, s), 0.015); bc = Math.min(bc, d); if (d < 0.03) c += 3000 * sq(0.03 - d); }
  const hc = segDist(pom, tip, ctx.headC) - 0.13; if (hc < 0.09) c += 20000 * sq(0.09 - hc);
  const tipY = tip.y - GROUND, tmin = 0.13 - 0.1 * smooth((ctx.f - 9) / 3) * (1 - smooth((ctx.f - 18) / 3)); if (tipY < tmin) c += 3000 * sq(tmin - tipY);   // dönüşte uç yeri sıyırır
  c += 150 * ctx.wd * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) + 0.002 * ctx.wd * (x[3] * x[3] + x[4] * x[4]);
  { const rl = ctx.f > HIT + 2 ? 50 : 24; c += 0.003 * x[5] * x[5] + (Math.abs(x[5]) > rl ? 3 * sq(Math.abs(x[5]) - rl) : 0); }   // vuruştan sonra kenar yönü serbestleşir
  for (const i of [11, 12, 13, 14]) c += 0.004 * x[i] * x[i] + (Math.abs(x[i]) > 12 ? 1 * sq(Math.abs(x[i]) - 12) : 0);
  if (prev) { c += 3000 * (sq(x[0] - prev[0]) + sq(x[1] - prev[1]) + sq(x[2] - prev[2])); for (let i = 3; i < x.length; i++) c += (i === 6 ? 0.1 : 0.03) * sq(x[i] - prev[i]);
    const dg = Math.abs(x[6] - prev[6]); if (dg > 3) c += 2 * sq(dg - 3); }
  { const cap = ctx.f >= 29 && ctx.f <= 34 ? 8 : 22; for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > cap ? 2 * sq(a - cap) : 0); } }
  if (ctx.prevTau) { for (const [ik, k] of [[ikR, 'R'], [ikL, 'L']]) { if (!ik || ctx.prevTau[k] == null) continue; const d = Math.abs(ik.tau - ctx.prevTau[k]), dl = ctx.f >= 26 && ctx.f <= 36 ? 20 : 10; c += 0.006 * d * d + (d > dl ? 0.3 * sq(d - dl) : 0); } }
  if (ctx.gam0 != null) { const d = Math.abs(x[6] - ctx.gam0); if (d > 14) c += 0.5 * sq(d - 14); }
  if (ctx.prevD) { const lim = SPD(ctx.f);
    for (const [ik, k, H] of [[ikR, 'R', R], [ikL, 'L', RL]]) { if (!ik || !ctx.prevD[k + 'U']) continue;
      for (const [Dn, Dp, ax] of [[ik.DU, ctx.prevD[k + 'U'], H.u0], [ik.DF, ctx.prevD[k + 'F'], H.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
        const tw = Math.abs(twistDeg(dq, ax)), twl = ctx.f >= 26 && ctx.f <= 36 ? 15 : 6.5; if (tw > twl) c += 0.4 * sq(tw - twl); if (ctx.f <= 6) { const an = qMag(dq); if (an > lim) c += 0.3 * sq(an - lim); } } } }
  if (ctx.anchor) { const { xa, k } = ctx.anchor; c += k * (3000 * (sq(x[0] - xa[0]) + sq(x[1] - xa[1]) + sq(x[2] - xa[2])) + 0.05 * [3, 4, 5, 7, 8, 11, 12].reduce((a, i) => a + sq(x[i] - xa[i]), 0)); }
  if (g < 1 && ikL) c += (1 - g) * (0.05 * (sq(x[9] - ctx.wf[0]) + sq(x[10] - ctx.wf[1])) + 0.05 * (sq(x[13]) + sq(x[14])));
  if (!full) return c;
  return { c, C, t, e, DHR, DshR, DshL, ikR, ikL, tip, tipY, hc, bc, T: T_, PLg };
}
let SEED = 12345; const rnd = () => ((SEED = (SEED * 1103515245 + 12345) % 2147483648) / 2147483648);
const STEP0 = [0.02, 0.02, 0.02, 4, 4, 4, 8, 3, 3, 3, 3, 3, 3, 3, 3];
function optimize(ctx, x0, iters = 400, scale = 1) {
  let x = x0.slice(), fx = evalX(ctx, x); let st_ = STEP0.map((s) => s * scale);
  for (let it = 0; it < iters; it++) {
    let imp = false;
    for (let i = 0; i < x.length; i++) {
      if (i === 6 && ctx.g <= 0) continue; if (i >= 9 && i <= 10 && ctx.g <= 0) continue; if (i >= 13 && ctx.g <= 0) continue;
      for (const sg of [1, -1]) { const y = x.slice(); y[i] += sg * st_[i]; const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; break; } }
    }
    for (let k = 0; k < 6; k++) { const y = x.map((v, i) => v + (rnd() * 2 - 1) * st_[i] * 0.7); const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; } }
    if (!imp) { st_ = st_.map((s) => s * 0.5); if (st_[0] < 2e-4) break; }
  }
  return { x, fx };
}

// ---- sol kol serbest (kavrama dışı) ----
const chestD = (f) => spineD(f, bodyAt(f)).Spine;
const Dc0i = chestD(0).invert(), DcEi = chestD(LEN - 1).invert();
const uL0c = RL.u0.clone().applyQuaternion(A1.D.LeftArm).applyQuaternion(Dc0i), fL0c = RL.f0.clone().applyQuaternion(A1.D.LeftForeArm).applyQuaternion(Dc0i);
const uLEc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcEi), fLEc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcEi);
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
const LU = [[0, uL0c.toArray()], [21, [0.15, -0.75, 0.6]], [29, [0.1, -0.75, 0.62]], [36, [0.62, -0.42, -0.66]], [44, [0.55, -0.7, -0.45]], [LEN - 1, uLEc.toArray()]];   // bırakınca sol kol karşı denge için sola-geriye açılır
const LF = [[0, flx(uL0c, fL0c).toArray()], [21, [-0.4, 0.1, 0.9]], [29, [-0.4, 0.1, 0.9]], [36, [0.25, 0.35, 0.9]], [44, [0.1, 0.2, 1]], [LEN - 1, flx(uLEc, fLEc).toArray()]];
const BEND_L = [[0, deg(uL0c.angleTo(fL0c))], [21, 50], [29, 50], [36, 22], [44, 32], [LEN - 1, deg(uLEc.angleTo(fLEc))]];
const lcache = {}; const TAUF = { a: 0, b: 0 };
const tauFree = (f) => (f <= 24 ? TAUF.a * sst(f / 21) : TAUF.b * (1 - sst((f - G_OFF) / 14)));
function leftFree(f) {
  if (lcache[f]) return lcache[f];
  const Dc = chestD(f); const uc = V(...spl(LU, f)).normalize(), bend = spl(BEND_L, f);
  const fx = V(...spl(LF, f)); fx.sub(uc.clone().multiplyScalar(fx.dot(uc))).normalize();
  const u = uc.clone().applyQuaternion(Dc), hint = uc.clone().multiplyScalar(Math.cos(rad(bend))).add(fx.multiplyScalar(Math.sin(rad(bend)))).applyQuaternion(Dc);
  const hg = hinge(RL, bend);
  let base, acc0;
  if (f === 0) { base = A1.D.LeftArm.clone(); acc0 = 0; }
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

let prevX = null, prevTau = null, prevD = null, GAM0 = 230;
const WRI = swingOf('Right', IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand));
const WRS = swingOf('Right', A1.D.RightForeArm.clone().invert().multiply(A1.D.RightHand));
const X0 = [0, 0, 0, 0, 0, 0, 0, WRS[0], WRS[1], 0, 0, 0, 0, 0, 0], XE = [0, 0, 0, 0, 0, 0, 0, WRI[0], WRI[1], 0, 0, 0, 0, 0, 0];
function solve(f) {
  const p = bodyAt(f); const D = spineD(f, p);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(...p.hp));
  p.ground = {}; p.reach = {};
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s, f); let pitch = ft.pitch;
    let ankle = ankleFromBall(ft.ball, ft.yaw, pitch, !ft.unclamped);
    p.ground[s] = ft.ground;
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    const RMX = f > LEN - 14 ? REACH_MAX : 0.962;
    if (ft.ground && ankle.distanceTo(hipJ) / (L1 + L2) > RMX) { // yerde bacak erişimi ≤0,962: topuk kalkar (parmak ucu yerde)
      for (let pt = Math.max(0, pitch); pt <= 50; pt += 0.5) { ankle = ankleFromBall(ft.ball, ft.yaw, pt); pitch = pt; if (ankle.distanceTo(hipJ) / (L1 + L2) <= RMX) break; }
    }
    if (!ft.ground) { const dv0 = ankle.clone().sub(hipJ); const r0 = dv0.length() / (L1 + L2); const K0 = 0.945, KW = 0.02;
      if (r0 > K0) ankle = hipJ.clone().add(dv0.multiplyScalar((K0 + KW * Math.tanh((r0 - K0) / KW)) / r0)); }
    let dv = ankle.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    p.reach[s] = d / (L1 + L2); d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1).applyQuaternion(Ry(ft.yaw - (s === 'Left' ? 5 : -15))).normalize(); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h)); ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    { const fz = V(0, 0, 1), pl_ = knee.clone().sub(hipJ.clone().add(dir.clone().multiplyScalar(a))).normalize();
      const fr = (x0, x1) => basisQ(x1, pl_).multiply(basisQ(x0, fz).invert());
      const wt = Math.min(1, f / 14), kt = sst(wt);   // 1. vuruşun bacak burulmasından tutarlı çerçeveye yumuşak geçiş
      const td = knee.clone().sub(hipJ).normalize(), sd = ankle.clone().sub(knee).normalize();
      D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), td).slerp(fr(restDir(s + 'UpLeg', s + 'Leg'), td), kt);
      D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), sd).slerp(fr(restDir(s + 'Leg', s + 'Foot'), sd), kt); }
    D[s + 'Foot'] = eul([ft.yaw, pitch, 0]);
    { const bend = ft.cw * -Math.min(Math.max(0, pitch), 42) + (1 - ft.cw) * 9; D[s + 'ToeBase'] = eul([ft.yaw, pitch + bend, 0]); }
    p['pitch' + s] = pitch;
  }
  const fkPos = () => { const cur = {}, pos = {}, out = {}; for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
      cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ));
      out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]);
      pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, out }; };
  const pos0 = fkPos().pos;
  const lF = leftFree(f);
  const lag = leftFree(Math.max(0, f - 3)).fore; let rl = lF.fore.clone().invert().multiply(lag); const ang = qMag(rl);
  rl = new THREE.Quaternion().slerp(rl, ang > 9 ? 9 / ang : 1); const wf = swingOf('Left', rl);
  const SL0 = shoulderAt('Left', pos0, D.Spine);
  const LfP = SL0.clone().add(RL.u0.clone().applyQuaternion(lF.arm).multiplyScalar(ARM.Left.lu)).add(RL.f0.clone().applyQuaternion(lF.fore).multiplyScalar(ARM.Left.lf));
  const LfDH = lF.fore.clone().multiply(wristQ('Left', wf));
  const g = TWO(f);
  const kY = smooth((f - 22) / 6) * (1 - smooth((f - 46) / 16)); const Y = Ry(p.chestYaw * (1 - kY)); const des = designAt(f); // vuruşta tasarım çerçevesi = hedef (+Z)
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C.clone().applyQuaternion(Y)), td: des.t.clone().applyQuaternion(Y), ed: des.e.clone().applyQuaternion(Y), pos0, D, g,
    Lf: { P: LfP, DH: LfDH }, meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, wf };
  const kS = 1 - smooth(f / 8), kE = smooth((f - (LEN - 1 - 14)) / 14);
  ctx.wd = WD(f); ctx.f = f; ctx.prevD = prevD; ctx.gam0 = g > 0 ? GAM0 : null;
  ctx.soft = 1 - Math.max(kS, kE); ctx.anchor = kS > 0 ? { xa: X0, k: 4 * kS } : kE > 0 ? { xa: XE, k: 4 * kE } : null;
  let x0 = prevX ? prevX.slice() : X0.slice();
  if (g <= 0) { x0[9] = wf[0]; x0[10] = wf[1]; x0[13] = 0; x0[14] = 0; if (ctx.prev) { ctx.prev = ctx.prev.slice(); ctx.prev[9] = wf[0]; ctx.prev[10] = wf[1]; } }
  if (g > 0 && prevX && TWO(f - 1) <= 0) { // kavramanın ilk karesi: γ taraması
    let best = null; const pv = prevX.slice(); pv[9] = wf[0]; pv[10] = wf[1];
    for (let gm = GAM0 - 30; gm <= GAM0 + 30; gm += 5) { const xs = x0.slice(); xs[6] = gm; ctx.prev = pv.slice(); ctx.prev[6] = gm; const r = optimize(ctx, xs, 80); if (!best || r.fx < best.fx) best = r; }
    x0 = best.x; ctx.prev = pv; ctx.prev[6] = x0[6];
  }
  const opt = f === 0 ? { x: X0.slice(), fx: evalX(ctx, X0) } : optimize(ctx, x0, 400);
  if (ARGS.includes('--dbg') && [13, 22, 27, 37, 41].includes(f)) { for (const [nm, xx] of [['tasarım', [0, 0, 0, ...opt.x.slice(3)]], ['çözüm', opt.x]]) { const rr = evalX(ctx, xx, true);
    console.log('DBG', f, nm, 'c', rr.c.toFixed(1), 'eR', (rr.ikR.err * 1000).toFixed(1), 'bR', rr.ikR.bend.toFixed(0), 'wR', rr.ikR.wmag.toFixed(1), 'τR', rr.ikR.tau.toFixed(0), 'eL', rr.ikL ? (rr.ikL.err * 1000).toFixed(1) : '-', 'bL', rr.ikL?.bend.toFixed(0), 'wL', rr.ikL?.wmag.toFixed(1), 'bl', rr.bc.toFixed(2), 'hd', rr.hc.toFixed(2), 'T', JSON.stringify(rr.T), 'omuzR→C', shoulderAt('Right', pos0, rr.DshR).distanceTo(rr.C).toFixed(3), 'kol', (ARM.Right.lu + ARM.Right.lf).toFixed(3)); } }
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true);
  prevD = { RU: r.ikR.DU, RF: r.ikR.DF, LU: r.ikL ? r.ikL.DU : null, LF: r.ikL ? r.ikL.DF : null };
  prevTau = { R: r.ikR.tau, L: r.ikL ? r.ikL.tau : null };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  if (r.ikL) { D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
    if (g < 0.95) { const k = smooth(1 - g / 0.95); D.LeftShoulder = r.DshL.clone().slerp(D.Spine, k); D.LeftArm = r.ikL.DU.clone().slerp(lF.arm, k); D.LeftForeArm = r.ikL.DF.clone().slerp(lF.fore, k); D.LeftHand = r.ikL.DH.clone().slerp(LfDH, k); } }
  else { D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH; }
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.gw = g;
  p.bladeDir = r.t; p.tip = r.tip; p.tipY = r.tipY;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// ön geçiş: sol kolun serbest anahtarlarını kavrama başı/sonu IK pozuna eşitle (kavramaya giriş/çıkışta burulma sıçraması olmaz)
{ const cap = {};
  for (let f = 0; f <= G_OFF; f++) { const r = solve(f); if (f === G_ON || f === G_OFF) { const ik = r.p.r.ikL; const Di = chestD(f).invert(); const uc = ik.u.clone().applyQuaternion(Di), fc = ik.fd.clone().applyQuaternion(Di); cap[f] = { u: uc.toArray(), fx: flx(uc, fc).toArray(), b: ik.bend, tau: ik.tau }; } }
  prevX = null; prevTau = null; prevD = null; SEED = 12345; for (const k of Object.keys(lcache)) delete lcache[k];
  const setK = (arr, f, v) => { const i = arr.findIndex((k) => k[0] === f); if (i >= 0) arr[i] = [f, v]; else { arr.push([f, v]); arr.sort((x, y) => x[0] - y[0]); } };
  TAUF.a = cap[G_ON].tau; TAUF.b = cap[G_OFF].tau; console.log('serbest önkol pronasyonu (kavrama başı/sonu):', TAUF.a.toFixed(0), TAUF.b.toFixed(0));
  for (const [fk, fc] of [[21, G_ON], [29, G_OFF]]) { setK(LU, fk, cap[fc].u); setK(LF, fk, cap[fc].fx); setK(BEND_L, fk, cap[fc].b); }
}
const outs = []; const diag = []; const hand = [];
const t0run = Date.now();
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL?.err, tauR: R_.ikR.tau, tauL: R_.ikL?.tau, bendR: R_.ikR.bend, bendL: R_.ikL?.bend, wR: R_.ikR.wmag, wL: R_.ikL?.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reach.Left, r.p.reach.Right], ground: r.p.ground, gw: r.p.gw, cy: r.p.chestYaw, pel: r.p.pel[0], pitch: [r.p.pitchLeft, r.p.pitchRight] });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'g', d.gw.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', d.errL != null ? (d.errL * 1000).toFixed(1) : '-', 'wR', d.wR.toFixed(1), 'wL', d.wL?.toFixed(1) ?? '-', 'τR', d.tauR.toFixed(0), 'τL', d.tauL?.toFixed(0) ?? '-',
  'bR', d.bendR.toFixed(0), 'bL', d.bendL?.toFixed(0) ?? '-', 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2), 'reach', d.reach.map((v) => v.toFixed(3)).join('/'), 'pitch', d.pitch.map((v) => v.toFixed(0)).join('/'));

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

// ---- dikiş (0. kare = L1[41]) ve bitiş (son kare = katana_idle[0], yatay kök konumu hariç) ----
const SEAM = 9, ENDB = 18; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const r0 = {}, rE = {}, d0 = {}, dE = {};
for (const n of allNames) { const g0 = genAt(n, 0), gE = genAt(n, LEN - 1);
  r0[n] = g0.clone().invert().multiply(A1.local[n]); d0[n] = qAng(g0, A1.local[n]);
  rE[n] = gE.clone().invert().multiply(IDLE.local[n]); dE[n] = qAng(gE, IDLE.local[n]); }
const h0 = V(...A1.hl).sub(V(...outs[0].hipsLocal));
const hE = V(...IDLE.hl).sub(V(...outs[LEN - 1].hipsLocal)); hE.x = 0; hE.y = 0; // yalnız yükseklik (yerel z) eşlenir, yatay kök hareketi korunur
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const w0 = 1 - smooth(f / SEAM), wE = smooth((f - (LEN - 1 - ENDB)) / ENDB);
  for (const n of allNames) {
    let q = genAt(n, f).clone(); if (w0 > 0) q.multiply(powQ(r0[n], w0)); if (wE > 0) q.multiply(powQ(rE[n], wE));
    if (f === 0) q = A1.local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const hp = V(...outs[f].hipsLocal).add(h0.clone().multiplyScalar(w0)).add(hE.clone().multiplyScalar(wE));
  if (f === 0) hp.set(...A1.hl);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}

// ---- sol önkol pronasyonunu kavramaya giriş boyunca (1–G_ON) tek yumuşak eğriye yay (önkol ekseni etrafında: el konumu değişmez) ----
{ const n = 'LeftForeArm', rq = Q(by[n].restQ), rqi = rq.clone().invert(); const twA = (f) => { const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))); return 2 * Math.atan2(d.y, d.w); };
  const a0 = 1, a1 = G_ON, t0 = twA(a0), t1 = twA(a1); const raw = []; for (let f = a0; f <= a1; f++) raw.push(twA(f));
  for (let f = a0 + 1; f < a1; f++) { const tn = t0 + (t1 - t0) * smooth((f - a0) / (a1 - a0)); const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), tn - raw[f - a0]));
    const q = rq.clone().multiply(d); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
// ---- vuruş sonrası (32–50) kol zinciri yumuşatma (çözücünün kareler arası salınımı); sol el kabzaya geri oturtulur ----
const fkT = (f) => { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? Q(tracks[b.name].rot[f].slice(1)) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, cur }; };
const relLH = (f) => { const k = fkT(f); return { p: k.pos.LeftHand.clone().sub(k.pos.RightHand).applyQuaternion(k.cur.RightHand.clone().invert()), q: k.cur.RightHand.clone().invert().multiply(k.cur.LeftHand) }; };
const SA = 32, SB = 50; const REGRIP = TWO(SA) > 0.99 && TWO(SB) > 0.99; const rel0 = []; for (let f = SA; f <= SB; f++) rel0.push(relLH(f));
for (let pass = 0; pass < 2; pass++) for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', ...(REGRIP ? ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'] : [])]) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = SA + 2; f <= SB - 2; f++) { const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[f + i - 2]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
    const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
const parentOf = Object.fromEntries(bones.map((b) => [b.name, b.parent]));
const setLocal = (n, f, curW, k) => { const l = k.cur[parentOf[n]].clone().invert().multiply(curW); tracks[n].rot[f] = [f, l.x, l.y, l.z, l.w]; };
for (let f = SA; f <= SB && REGRIP; f++) {
  const k0 = fkT(f), r0_ = rel0[f - SA]; const tp = k0.pos.RightHand.clone().add(r0_.p.clone().applyQuaternion(k0.cur.RightHand)), tq = k0.cur.RightHand.clone().multiply(r0_.q);
  for (let it = 0; it < 16; it++) for (const J of ['LeftArm', 'LeftForeArm']) {
    const k = fkT(f); const pJ = k.pos[J]; const v1 = k.pos.LeftHand.clone().sub(pJ), v2 = tp.clone().sub(pJ); let Rq;
    if (J === 'LeftForeArm') { const ax = RL.n0.clone().applyQuaternion(k.cur[J].clone().multiply(restW[J].clone().invert())).normalize();
      const a1 = v1.clone().sub(ax.clone().multiplyScalar(v1.dot(ax))), a2 = v2.clone().sub(ax.clone().multiplyScalar(v2.dot(ax)));
      Rq = new THREE.Quaternion().setFromAxisAngle(ax, Math.atan2(a1.clone().cross(a2).dot(ax), a1.dot(a2))); }
    else Rq = new THREE.Quaternion().setFromUnitVectors(v1.normalize(), v2.normalize());
    setLocal(J, f, Rq.multiply(k.cur[J]), k); }
  setLocal('LeftHand', f, tq, fkT(f));
}
{ let dm = 0, am = 0; for (let f = SA; f <= SB; f++) { const r = relLH(f), r0_ = rel0[f - SA]; dm = Math.max(dm, r.p.distanceTo(r0_.p)); am = Math.max(am, qAng(r.q, r0_.q)); }
  console.log('kol yumuşatma: sol elin sağ ele göre kayması max', (dm * 100).toFixed(2), 'cm,', am.toFixed(1), '°'); }

// ---- bilek kenedi (son geçiş): el salınımı önkol çerçevesinde fleksiyon/sapma ≤14,5°, toplam ≤17,5° olacak şekilde ölçeklenir (burulma korunur) ----
const palmN = (s) => V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize();
let CLAMPED = 0;
for (let f = 0; f < LEN; f++) for (const s of ['Right', 'Left']) {
  const H = s === 'Right' ? R : RL; const k = fkT(f); const Df = k.cur[s + 'ForeArm'].clone().multiply(restW[s + 'ForeArm'].clone().invert()), Dh = k.cur[s + 'Hand'].clone().multiply(restW[s + 'Hand'].clone().invert());
  let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.clone().invert());
  const pn = palmN(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); if (ang < 1e-4) continue; const ax = V(sw.x, sw.y, sw.z).normalize(); if (sw.w < 0) ax.negate();
  const fl = Math.abs(ang * ax.dot(fa)), dv = Math.abs(ang * ax.dot(pnp)); const kk = Math.min(1, 14.5 / Math.max(fl, 1e-6), 14.5 / Math.max(dv, 1e-6), 17.5 / ang);
  if (kk >= 1) continue; CLAMPED++;
  const sw2 = new THREE.Quaternion().setFromAxisAngle(ax, rad(ang * kk)); const Dh2 = Df.clone().multiply(sw2.multiply(twq));
  setLocal(s + 'Hand', f, Dh2.multiply(restW[s + 'Hand']), k);
}
console.log('bilek kenedi: düzeltilen el-kare sayısı', CLAMPED);
// ---- rapor (son izlerden FK ile) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − L1[41] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − idle[0] (sonda söner):', top(dE));
const seam = (C, fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = C.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(keyAt(t.rot, fa).slice(1)), qOf(n, fb)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seam(A1, A1.F, 0), [e0, e0n] = seam(IDLE, 0, LEN - 1);
console.log(`dikiş: L1[41]→H1[0] max ${s0.toFixed(3)}° (${s0n}), kalça ${(V(...tracks.Hips.pos[0].slice(1)).distanceTo(V(...A1.hl)) * 1000).toFixed(2)} mm | H1[son]↔idle[0] max ${e0.toFixed(3)}° (${e0n}), kalça yükseklik ${((tracks.Hips.pos[LEN - 1][3] - IDLE.hl[2]) * 100).toFixed(2)} cm`);
const stepAt = (f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
console.log('ilk kareler (max kemik °/kare):', [1, 2, 3, 4, 5, 6].map((f) => stepAt(f)[0].toFixed(1) + ' ' + stepAt(f)[1]).join(', '));
console.log('bekleme çevresi (max kemik °/kare):', [HOLD - 2, HOLD - 1, HOLD, HOLD + 1, HOLD + 2].map((f) => f + ':' + stepAt(f)[0].toFixed(2) + ' ' + stepAt(f)[1]).join(', '));
// L1'in son kare hızı ile H1'in ilk kare hızı (dikişte hız sürekliliği)
{ const l1 = (n, f) => Q(keyAt(A1.A.tracks[n].rot, f).slice(1)); let m = 0, mn = ''; for (const n of ['Hips', 'Spine', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'Head']) { const a = qAng(l1(n, A1.F), l1(n, A1.F - 1)), b = qAng(qOf(n, 1), qOf(n, 0)); if (Math.abs(a - b) > m) { m = Math.abs(a - b); mn = n + ` (${a.toFixed(2)}→${b.toFixed(2)})`; } } console.log('dikiş hız farkı max °/kare:', m.toFixed(2), mn); }
const FF = []; for (let f = 0; f < LEN; f++) { const { pos, cur } = fkT(f); const Dd = {}; for (const n of Object.keys(cur)) Dd[n] = cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos, D: Dd }); }
const palm = (s) => V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize();
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: ang, flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };   // toplam = salınım (HeroWristAudit gibi; önkol burulması sayılmaz)
const WRIST_MAX = {};
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  WRIST_MAX[s] = { flex: mx('flex'), dev: mx('dev'), tot: mx('tot') };
  console.log(s, 'bilek: fleksiyon max', mx('flex')[0].toFixed(1) + '° (kare ' + mx('flex')[1] + ')', '| sapma max', mx('dev')[0].toFixed(1) + '° (kare ' + mx('dev')[1] + ')', '| toplam max', mx('tot')[0].toFixed(1) + '° (kare ' + mx('tot')[1] + ')', '| burulma max', mx('tw')[0].toFixed(1));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const gF = [...Array(LEN).keys()].filter((f) => diag[f].gw > 0.99);
const gd = gF.map((f) => FF[f].pos.LeftHand.clone().sub(FF[f].pos.RightHand).dot(outs[f].p.bladeDir) * 100);
console.log('iki elli tam kavrama: kare', gF[0], '–', gF.at(-1), '| sol el sağ elden eksen boyunca', Math.min(...gd).toFixed(1), '..', Math.max(...gd).toFixed(1), 'cm | erişim hatası max R/L', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), '/', (Math.max(...diag.filter((d) => d.errL != null).map((d) => Math.abs(d.errL) * (d.gw))) * 1000).toFixed(1), 'mm');
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
const dd = diag.filter((d) => d.gw > 0);
console.log('β (roll sapması)', rng(diag.map((d) => d.x[5])), '| γ', rng(dd.map((d) => d.x[6])), '| dirsek R', rng(diag.map((d) => d.bendR)), 'L(kavrama)', rng(dd.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), 'L', rng(dd.map((d) => d.tauL)), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['Hips', 'Spine', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Head', 'LeftUpLeg', 'RightUpLeg'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): kol-gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde', Math.min(...diag.map((d) => d.bc)).toFixed(3), '| bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '(kare', diag.reduce((a, d) => (d.hc < a.hc ? d : a)).f + ') | uç-yer', Math.min(...diag.map((d) => d.tipY)).toFixed(3));
// uç izi (son izlerden): katana soketi = sağ el + PPp, uç = C + t·(HALF−SR)
const tipOf = (f) => { const Dh = FF[f].D.RightHand; const t = b0.clone().applyQuaternion(Dh); return FF[f].pos.RightHand.clone().add(PPpR.clone().applyQuaternion(Dh)).add(t.multiplyScalar(HALF - SR)); };
const TIP = [...Array(LEN).keys()].map(tipOf); const tsp = TIP.map((p, f) => (f ? p.distanceTo(TIP[f - 1]) * 60 : 0));
const vpk = Math.max(...tsp), fpk = tsp.indexOf(vpk); let ha = fpk, hb = fpk; while (ha > 1 && tsp[ha - 1] >= 0.55 * vpk) ha--; while (hb < LEN - 1 && tsp[hb + 1] >= 0.55 * vpk) hb++;
const peaks = tsp.map((v, f) => (f > 0 && f < LEN - 1 && v >= tsp[f - 1] && v >= tsp[f + 1] && v >= 0.35 * vpk ? f + ':' + v.toFixed(1) : null)).filter(Boolean);
console.log('uç hızı (m/s):', tsp.map((v, f) => f + ':' + v.toFixed(1)).slice(20, 46).join(' '));
console.log(`vuruş: tepe ${vpk.toFixed(1)} m/s kare ${fpk} | %55 penceresi ${ha}–${hb} | tepe adayları (≥%35): ${peaks.join(' ')} | uç ileri ilerleme ${ha}–${hb}: ${((TIP[hb].z - TIP[ha - 1].z) * 100).toFixed(0)} cm`);
const F_ = [...Array(LEN).keys()];
const hy = F_.map((f) => FF[f].pos.Hips.y - restPos.Hips.y), hz = F_.map((f) => FF[f].pos.Hips.z);
console.log('kök: kalça ileri', ((hz[LEN - 1] - hz[0]) * 100).toFixed(1), 'cm (bekleme→tepe', ((hz[TOP] - hz[HOLD]) * 100).toFixed(1), ') | en alçak', (Math.min(...hy) * 100).toFixed(1), 'cm | bekleme', (hy[HOLD] * 100).toFixed(1), 'cm');
// bekleme karesi: ayaklar yerde mi, ağırlık merkezi tabanların arasında mı
{ const f = HOLD, Pp = FF[f].pos; const W = { Hips: 0.3, Spine02: 0.12, Spine01: 0.1, Spine: 0.1, Head: 0.08, LeftArm: 0.025, RightArm: 0.025, LeftForeArm: 0.02, RightForeArm: 0.02, LeftUpLeg: 0.05, RightUpLeg: 0.05, LeftLeg: 0.045, RightLeg: 0.045, LeftFoot: 0.01, RightFoot: 0.01 };
  const com = V(0, 0, 0); let ws = 0; for (const [n, w] of Object.entries(W)) { com.add(Pp[n].clone().multiplyScalar(w)); ws += w; } com.divideScalar(ws);
  const a = Pp.LeftToeBase.clone().setY(0), b = Pp.RightFoot.clone().setY(0); const c = com.clone().setY(0); const ab = b.clone().sub(a); const u = c.clone().sub(a).dot(ab) / ab.lengthSq();
  console.log(`bekleme ${f}: ayak yükseklikleri L/R ${((Pp.LeftToeBase.y - restPos.LeftToeBase.y) * 100).toFixed(1)}/${((Pp.RightToeBase.y - restPos.RightToeBase.y) * 100).toFixed(1)} cm, topuk açısı L/R ${diag[f].pitch.map((v) => v.toFixed(0)).join('/')}°, ağırlık merkezi ön ayak→arka ayak doğrusunda u=${u.toFixed(2)} (0 ön, 1 arka), doğrudan sapma ${(a.clone().add(ab.multiplyScalar(u)).distanceTo(c) * 100).toFixed(1)} cm | yerde erişim L/R ${diag[f].reach.map((v) => v.toFixed(3)).join('/')}`); }
console.log('REACH_MAX', REACH_MAX.toFixed(3), 'yerde bacak erişimi max:', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3));
for (const f of [HIT, TOP]) { const Pp = FF[f].pos; const rel = (v) => v.clone().sub(Pp.Hips).toArray().map((x) => x.toFixed(2));
  console.log(`duruş ${f}: sağ el ${rel(Pp.RightHand)} sol el ${rel(Pp.LeftHand)} uç ${rel(TIP[f])} (kalçaya göre, x+ sol, z+ ileri) | uç yükseklik ${TIP[f].y.toFixed(2)} m, bıçak yönü ${outs[f].p.bladeDir.toArray().map((x) => x.toFixed(2))}`); }

const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
// ---- şarjlı önizleme: bekleme karesi 0,6 sn (36 kare) tutulur, sonrası 1,3× hızlı (yalnız editör önizlemesi; Unity'ye gitmez) ----
function resample(src, times) {
  const out = {};
  for (const [n, t] of Object.entries(src.tracks)) {
    const o = {}; if (t.rot) o.rot = times.map((s, i) => { const a = Math.floor(s), b = Math.min(src.length - 1, a + 1), u = s - a; const qa = Q(t.rot[a].slice(1)), qb = Q(t.rot[b].slice(1)); const q = qa.slerp(qb, u); return [i, q.x, q.y, q.z, q.w]; });
    if (t.pos) o.pos = times.map((s, i) => { const a = Math.floor(s), b = Math.min(src.length - 1, a + 1), u = s - a; const pa = t.pos[a], pb = t.pos[b]; return [i, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u, pa[3] + (pb[3] - pa[3]) * u]; });
    out[n] = o;
  }
  return out;
}
const HOLDN = 36, SPEED = 1.3; const times = [];
for (let f = 0; f <= HOLD; f++) times.push(f); for (let i = 0; i < HOLDN; i++) times.push(HOLD); for (let s = HOLD + SPEED; s < LEN - 1; s += SPEED) times.push(s); times.push(LEN - 1);
const preview = { name: PREVIEW, fps: 60, length: times.length, loop: false, tracks: resample(anim, times) };
console.log('şarjlı önizleme:', times.length, 'kare (', (times.length / 60).toFixed(2), 'sn ) | bekleme', HOLD, '→', HOLD + HOLDN, '| vuruş', HOLD + HOLDN + Math.round((HIT - HOLD) / SPEED));
if (ARGS.includes('--dump')) fs.writeFileSync('C:/Users/KULLAN~1/AppData/Local/Temp/claude/C--Elarion--claude-worktrees-agir-saldiri-h1-54091a/ccda5050-445a-448c-8aa0-6947372b882e/scratchpad/heavy1_cur.json', JSON.stringify(anim));
if (!NOSEND) {
  const post = (u, b) => fetch(BASE + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  if (!ARGS.includes('--nosave')) { console.log('kaydedildi', await post('/api/animations/save?name=' + NAME, anim)); console.log('kaydedildi', await post('/api/animations/save?name=' + PREVIEW, preview)); }
  const show = ARGS.includes('--show-preview') ? preview : anim;
  console.log(BASE + ' yüklendi', show.name, await post('/api/claude/anim', { anim: show }));
}
