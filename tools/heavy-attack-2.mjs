// game_heavy_attack_2 üretici: ağır H2 — 2. hafif vuruştan sonra ağır tuşuyla dallanır; 0. kare = main'deki L2'nin son karesi
// (game_light_attack_2_wf[47]; kod L2'nin kombo penceresinden bu dikişe karışarak geçer).
// v4 (2026-10-25, kullanıcı kararı): tam tur dönüş KALDIRILDI ("bu dönmeyi başka yerde yaptık") → art arda İKİ ÇOK HIZLI KESİK, çarpı (X):
// 1. kesik sağ omuz üstünden sol-alta (kesa), kılıç sol yandan hızla sol omuz üstüne kalkar, 2. kesik sol-üstten sağ-alta (gyaku kesa).
// Her kesik ~6 kare (≈1400°/sn), iki kesik birlikte ~0,3 sn. v5 (doğallık): ayak işi kesikleri taşır — 1. kesik sol ayağın öne sert basışıyla
// (fumikomi), 2. kesik (tek el, ters elden) sağ ayağın öne geçişiyle (ayumi-ashi) iner; sol el bırakınca kalçaya çekilir (hikite); toparlanmada
// sağ ayak geri çekilir (zanshin), duruş idle'a kapanır.
// Hazırlık (0–22): kılıç sağ omuzun arkasına kurulur, sol el kabzayı kavrar, gövde sağa sarılır, kalça çöker. 22 = BEKLEME KARESİ (şarjda donar):
// iki ayak yerde, tüm hızlar sıfır. 1. kesikte ağırlık ön (sol) bacağa geçer (kalça öne → oyunda atılma). Ağır duruş + çöküş, toparlanmada
// iki adım ve sol el bırakır; son kare game_katana_idle[0]'a (oyundaki kılıç elde idle) bağlanır.
// Ayrıca preview_heavy_attack_2_charged üretir: bekleme karesi 0,6 sn tutulur, sonrası 1,3× (yalnız önizleme, Unity'ye gitmez).
// Yalnız --port ile verilen (bu oturumun) editörüne yükler/kaydeder. Çalıştır: node heavy-attack-2.mjs --port=<port> [--nosend] [--nosave] [--diag] [--combo]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
// editör portu ZORUNLU: yalnız bu oturumun MCP editörü (get_status → editorUrl). Portlar oturumlar yeniden başlayınca değişir; sabit port başka chat'in editörüne yazar.
const PORT = (process.argv.find((a) => a.startsWith('--port=')) || '').slice(7) || process.env.UPE_PORT;
if (!/^\d{4,5}$/.test(PORT || '')) { console.error('Port ver: node heavy-attack-2.mjs --port=<bu oturumun editör portu> (MCP get_status → editorUrl)'); process.exit(2); }
const BASE = 'http://127.0.0.1:' + PORT;
const NAME = 'game_heavy_attack_2', PREVIEW = 'preview_heavy_attack_2_charged';
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
const WRIST = 14;
const nW = b0.clone().cross(fr0).normalize();
const Wr = new THREE.Quaternion().setFromAxisAngle(nW, rad(WRIST));
const b1 = b0.clone().applyQuaternion(Wr);

const asArr = (v) => (Array.isArray(v) ? v : [v]);
// kenetsiz Catmull-Rom/Hermite; anahtarın 3. öğesi 'h' ise o anahtarda teğet sıfır (bekleme karesi: hız sıfır)
function spl(keys, f) {
  const n = keys.length; let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (keys[j][2] === 'h') return Pj.map(() => 0);
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
const L2_NAME = 'game_light_attack_2_wf';   // main'deki (Unity'ye giden) L2 = bilek uyarlamalı sürüm; dallanma dikişi = son karesi (47)
const A2 = clipPose(L2_NAME, 'last');
const IDLE_NAME = 'game_katana_idle';   // oyundaki kılıç elde idle (PR #17); eski fizik idle game_idle_drawn artık kullanılmıyor
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

// ---- Zaman çizelgesi (76 kare = 1,27 sn @60) ----
const LEN = 76, HOLD = 22;
const STEP_L = [24, 30], STEP_R = [35, 44], STEP_RE = [56, 66];   // sol ayak öne basar (1. kesik temasıyla iner), sağ ayak öne geçer (2. kesik temasıyla iner), sağ geri çekilir
const PH0 = 0;
// ayak dönüm noktaları (dünya, parmak eklemi = taban): L2 sonu duruşundan
const toeOf = (C, s) => C.pos[s + 'ToeBase'].clone();
const FL0 = toeOf(A2, 'Left'), FR0 = toeOf(A2, 'Right');
const FL1 = FL0.clone().add(V(-0.12, 0, 0.2));                         // sol ayak inişi (fumikomi): öne ve merkez çizgisine doğru
const FR1 = V(FL1.x - 0.3, FR0.y, FL1.z + 0.22);                          // sağ ayak inişi: solun 22 cm önü, 30 cm sağı
const idL = toeOf(IDLE, 'Left').sub(IDLE.hipsPos), idR = toeOf(IDLE, 'Right').sub(IDLE.hipsPos);
const HEND = FL1.clone().sub(idL); HEND.y = IDLE.hipsPos.y;               // son kalça: sol ayak yerinde kalır, sağ ayak idle duruşuna geri çekilir
const FRE = HEND.clone().add(idR); FRE.y = FR0.y;
const H0w = A2.hipsPos.clone(), H1w = FR0.clone().lerp(FL1, 0.6), H2w = FL1.clone().lerp(FR1, 0.55);
const yStart = A2.hipsPos.y - restPos.Hips.y, IDLE_Y = IDLE.hipsPos.y - restPos.Hips.y;
// kalça yüksekliği: ayak inişlerinde çöker (fumikomi 30, geçiş inişi 44), geçişte yükselir
const HY = [[0, yStart], [12, -0.17], [HOLD, -0.2, 'h'], [25, -0.16], [30, -0.22], [34, -0.19], [39, -0.15], [44, -0.23], [50, -0.24], [58, -0.2], [66, -0.08], [LEN - 1, IDLE_Y]];
const HZK = [[0, H0w.z], [16, H0w.z - 0.04], [HOLD, H0w.z - 0.04, 'h'], [31, H1w.z, 'h'], [35, H1w.z + 0.02], [45, H2w.z, 'h'], [55, H2w.z], [67, HEND.z, 'h'], [LEN - 1, HEND.z]];
const HXK = [[0, H0w.x], [HOLD, H0w.x, 'h'], [31, H1w.x, 'h'], [35, H1w.x], [45, H2w.x, 'h'], [55, H2w.x], [67, HEND.x, 'h'], [LEN - 1, HEND.x]];
function hipsAt(f) { return V(spl(HXK, f) - restPos.Hips.x, spl(HY, f), spl(HZK, f) - restPos.Hips.z); }
// pelvis yaw: sağa sarılma (bekleme −32) → 1. kesikte sola (+30) → 2. kesikte sağa (−22) → idle (0)
const YAW0 = ypr(A2.D.Hips)[0], YAWE = ypr(IDLE.D.Hips)[0];
const PY = [[0, YAW0], [12, -26], [HOLD, -34, 'h'], [25, -28], [28, -5], [31, 18], [34, 24], [38, 30], [42, 22], [45, 12], [50, 10], [60, 6], [68, 2], [LEN - 1, YAWE]];
const pelYawAt = (f) => spl(PY, f);

// gövde pitch/roll anahtarları (yaw ayrıca): + öne eğim; roll + = sağa yatma
const T = { start: 0, drop: 8, coil: 16, hold: HOLD, launch: 25, cut1: 29, end1: 33, cock2: 39, cut2: 43, end2: 46, stop: 51, rise: 62, rest: LEN - 1 };
const P = {
  start:  { pel: [0, 3, 0.8], s2: [0, 1, 1], s1: [0, 1.3, 1], ch: [0, 0.5, 1] },
  drop:   { pel: [0, 6, 1],   s2: [0, 2, 1], s1: [0, 2, 1],   ch: [0, 2, 1] },
  coil:   { pel: [0, 10, 2],  s2: [0, 3, 1], s1: [0, 3, 1.5], ch: [0, 2, 1.5] },
  hold:   { pel: [0, 12, 2],  s2: [0, 3, 1], s1: [0, 3, 1.5], ch: [0, 2, 2] },     // alçak, sağa sarılmış, kılıç sağ omuz arkasında
  launch: { pel: [0, 10, 1],  s2: [0, 2, 0], s1: [0, 2, 0], ch: [0, 1, 0] },
  cut1:   { pel: [0, 13, -3], s2: [0, 4, -1.5], s1: [0, 4, -2], ch: [0, 3, -2] },  // sol-alta keserken öne ve sola yüklenir
  end1:   { pel: [0, 15, -4], s2: [0, 5, -2], s1: [0, 5, -2], ch: [0, 3, -2] },
  cock2:  { pel: [0, 13, -1], s2: [0, 3, 0], s1: [0, 3, 0], ch: [0, 2, 0] },
  cut2:   { pel: [0, 14, 3],  s2: [0, 4, 1.5], s1: [0, 4, 2], ch: [0, 3, 2] },
  end2:   { pel: [0, 15, 4],  s2: [0, 5, 2], s1: [0, 5, 2], ch: [0, 4, 2] },
  stop:   { pel: [0, 14, 2],  s2: [0, 5, 1], s1: [0, 4, 1], ch: [0, 3, 0.5] },      // ağır duruş: kalça menteşesi + çöküş
  rise:   { pel: [0, 6, 0],   s2: [0, 2, 0], s1: [0, 2, 0], ch: [0, 1, 0] },
  rest:   { pel: [0, 3, 0],   s2: [0, 1, 0], s1: [0, 1, 0], ch: [0, 0, 0] },
};
{
  const inc = (C, c, p) => ypr(C.D[c].clone().multiply(C.D[p].clone().invert()));
  const S = P.start; S.pel = ypr(A2.D.Hips); S.s2 = inc(A2, 'Spine02', 'Hips'); S.s1 = inc(A2, 'Spine01', 'Spine02'); S.ch = inc(A2, 'Spine', 'Spine01');
  const E = P.rest; E.pel = ypr(IDLE.D.Hips); E.s2 = inc(IDLE, 'Spine02', 'Hips'); E.s1 = inc(IDLE, 'Spine01', 'Spine02'); E.ch = inc(IDLE, 'Spine', 'Spine01');
}
const startNeck = ypr(A2.D.neck.clone().multiply(A2.D.Spine.clone().invert())), startHead = ypr(A2.D.Head.clone().multiply(A2.D.neck.clone().invert()));
const idleNeck = ypr(IDLE.D.neck.clone().multiply(IDLE.D.Spine.clone().invert())), idleHead = ypr(IDLE.D.Head.clone().multiply(IDLE.D.neck.clone().invert()));
const LEAD = { pel: 3, s2: 1.6, s1: 0.6, ch: -0.6 };
// göğüs − pelvis yaw ayrımı σ: sarılma −30 (bekleme), kesiklerde kalça önde, göğüs kırbaçla geçer (1.: +26, 2.: −26), sonra oturur
const SG0 = P.start.s2[0] + P.start.s1[0] + P.start.ch[0], SGI = P.rest.s2[0] + P.rest.s1[0] + P.rest.ch[0];
const SEPK = [[0, SG0], [12, -20], [HOLD, -28, 'h'], [25, -32], [28, -14], [30, 8], [33, 24], [36, 26], [39, 20], [41, 0], [43, -28], [46, -38], [50, -30], [56, -16], [64, -6], [LEN - 1, SGI]];
const names = Object.keys(T);
const chestYawRaw = (f) => pelYawAt(f) + spl(SEPK, f);
// baş: hedefe (ileri) bakar — göğse göre ±50° içinde, yumuşak takip; uçlarda başlangıç/idle değerine harman
const HEADREL = (() => { const raw = []; for (let f = 0; f < LEN + 2; f++) raw.push(Math.max(-50, Math.min(50, -0.85 * chestYawRaw(f))));
  let x = raw[0], v = 0; const w = 0.6, z = 0.9; const o = raw.map((t) => { v += w * w * (t - x) - 2 * z * w * v; x += v; return x; });
  const s0 = startNeck[0] + startHead[0], sE = idleNeck[0] + idleHead[0];
  return o.map((r, f) => { const a = 1 - smooth(f / 10), b = smooth((f - 56) / 12); return (r * (1 - a) + s0 * a) * (1 - b) + sE * b; }); })();
const headRelAt = (f) => { const i = Math.max(0, Math.min(LEN, Math.floor(f))), u = Math.max(0, Math.min(1, f - i)); return HEADREL[i] * (1 - u) + HEADREL[i + 1] * u; };
const HPITCH = [[0, 0], [12, 2], [HOLD, 2, 'h'], [30, 0], [34, -2], [38, -2], [42, 0], [46, -3], [52, -3], [58, -1], [LEN - 1, 0]];
// canlılık katmanı (gövde çerçevesinde): fleksiyon (+ öne) / yan eğilme (+ sola); kinetik zincir gecikmeli yay
const LIFE_F = [[0, 0], [8, 3], [16, 6], [HOLD, 6, 'h'], [26, -4], [30, 6], [33, 7], [37, 0], [42, 5], [46, 8], [51, 5], [58, 2], [LEN - 1, 0]];
const LIFE_L = [[0, 0], [10, -2], [HOLD, -4, 'h'], [27, -2], [31, 6], [34, 7], [38, -2], [42, -7], [46, -6], [54, -2], [62, 0], [LEN - 1, 0]];
const springF = (arr, w, z) => { let x = arr[0], v = 0; return arr.map((t) => { v += w * w * (t - x) - 2 * z * w * v; x += v; return x; }); };
const LIFE = (() => {
  const fr = [...Array(LEN + 2).keys()]; const ramp = (f) => smooth(f / 7) * (1 - smooth((f - (LEN - 8)) / 7));
  const seg = (keys, lag, w, z) => springF(fr.map((f) => spl(keys, Math.max(0, f - lag)) * ramp(f)), w, z);
  const o = { s2: [seg(LIFE_F, 0, 0.9, 0.65), seg(LIFE_L, 0, 0.9, 0.65)], s1: [seg(LIFE_F, 0.8, 0.75, 0.55), seg(LIFE_L, 0.8, 0.75, 0.55)], ch: [seg(LIFE_F, 1.6, 0.65, 0.5), seg(LIFE_L, 1.6, 0.65, 0.5)] };
  const SH = { s2: 0.4, s1: 0.5, ch: 0.5 };
  for (const k of Object.keys(SH)) o[k] = o[k].map((a) => a.map((v) => v * SH[k]));
  const chP = fr.map((f) => o.s2[0][f] + o.s1[0][f] + o.ch[0][f]), chL = fr.map((f) => o.s2[1][f] + o.s1[1][f] + o.ch[1][f]);
  const lagP = springF(chP, 0.42, 0.42), lagL = springF(chL, 0.42, 0.42);
  o.neck = [fr.map((f) => 0.35 * (lagP[f] - chP[f])), fr.map((f) => 0.3 * (lagL[f] - chL[f]))];
  const lagP2 = springF(chP, 0.33, 0.4), lagL2 = springF(chL, 0.33, 0.4);
  o.head = [fr.map((f) => 0.45 * (lagP2[f] - chP[f])), fr.map((f) => 0.35 * (lagL2[f] - chL[f]))];
  return o;
})();
const lifeAt = (f) => { const i = Math.max(0, Math.min(LEN - 1, Math.round(f))); const g = (k) => [LIFE[k][0][i], LIFE[k][1][i]]; return { s2: g('s2'), s1: g('s1'), ch: g('ch'), neck: g('neck'), head: g('head') }; };
const Eb = (yw, pr) => Ry(yw).multiply(Rx(pr[0])).multiply(Rz(-pr[1])).multiply(Ry(-yw));
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
  for (const k of Object.keys(P.start)) r[k] = spl(names.map((n) => [T[n], P[n][k], n === 'hold' ? 'h' : undefined]), f + (LEAD[k] || 0) * ramp * (1 - smooth((f - 56) / 10)));
  { const pY = pelYawAt(f), sg = spl(SEPK, f), b = smooth(f / 10), e = smooth((f - 56) / 12);
    r.pel[0] = pY;
    for (const [k, w] of [['s2', 0.2], ['s1', 0.35], ['ch', 0.45]]) r[k][0] = (P.start[k][0] * (1 - b) + w * sg * b) * (1 - e) + P.rest[k][0] * e; }
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  const inc = headRelAt(f);
  const ws = 1 - smooth(f / 10), we = smooth((f - 56) / 12);
  const hp = spl(HPITCH, f - 1.5);
  const nk = [inc * 0.45, hp * 0.4, -0.3 * r.pel[2]], hd = [inc * 0.55, hp * 0.6, -0.4 * r.pel[2]];
  r.neck = nk.map((v, i) => (v * (1 - ws) + startNeck[i] * ws) * (1 - we) + idleNeck[i] * we);
  r.head = hd.map((v, i) => (v * (1 - ws) + startHead[i] * ws) * (1 - we) + idleHead[i] * we);
  r.hp = hipsAt(f).toArray();
  return r;
}

// ---- ayaklar: ikisi de yerde sabit (dönüş yok); kesiklerde arka topuk kalkabilir (erişim), toparlanmada iki adımla idle duruşuna ----
// taban noktası = parmak eklemi (ToeBase, metatars başları): yerdeki ayak bu nokta üzerinde kalkar → taban kaymaz
const VT = {}; for (const s of ['Left', 'Right']) VT[s] = V(...by[s + 'ToeBase'].restP).applyQuaternion(restW[s + 'Foot']);
const ankleFromToe = (s, toe, yaw, pitch) => toe.clone().sub(VT[s].clone().applyQuaternion(eul([yaw, Math.max(0, pitch), 0])));
const foot0 = {};
for (const s of ['Left', 'Right']) { const e = ypr(A2.D[s + 'Foot']); foot0[s] = { yaw: e[0], pitch: e[1], ball: A2.pos[s + 'ToeBase'].clone() }; }
const IDLE_FY = { Left: ypr(IDLE.D.LeftFoot)[0], Right: ypr(IDLE.D.RightFoot)[0] };
const stepArc = (a, b, k, h) => { const p = a.clone().lerp(b, smooth(k)); p.y = a.y + (b.y - a.y) * smooth(k) + h * Math.sin(Math.PI * Math.max(0, Math.min(1, k))); return p; };
// adım: parmak ucundan kalkış (topuk yüksek), havada düzleşir, düz iner; yerde dönüşler taban (parmak eklemi) üzerinde
const step = (a, b, f, W, h, yawA, yawB, p0) => { const k = (f - W[0]) / (W[1] - W[0]);
  return { ball: stepArc(a, b, k, h), yaw: yawA + (yawB - yawA) * smooth(k), pitch: p0 * (1 - smooth(k / 0.45)), ground: false }; };
const YL1 = 8, YR1 = 6;
function footAt(s, f) {
  if (s === 'Left') {
    const f0 = foot0.Left;
    if (f <= STEP_L[0]) return { ball: FL0.clone(), yaw: f0.yaw, pitch: f0.pitch * (1 - smooth(f / 10)), ground: true };
    if (f < STEP_L[1]) return step(FL0, FL1, f, STEP_L, 0.07, f0.yaw, YL1, 12);
    return { ball: FL1.clone(), yaw: YL1 + (IDLE_FY.Left - YL1) * smooth((f - 58) / 10), pitch: 0, ground: true };
  }
  const f0 = foot0.Right;
  if (f <= STEP_R[0]) return { ball: FR0.clone(), yaw: f0.yaw + 8 * smooth((f - 24) / 8), pitch: f0.pitch * (1 - smooth(f / 10)), ground: true };
  if (f < STEP_R[1]) return step(FR0, FR1, f, STEP_R, 0.09, f0.yaw + 8, YR1, 34);
  if (f <= STEP_RE[0]) return { ball: FR1.clone(), yaw: YR1, pitch: 0, ground: true };
  if (f < STEP_RE[1]) return step(FR1, FRE, f, STEP_RE, 0.05, YR1, IDLE_FY.Right, 10);
  return { ball: FRE.clone(), yaw: IDLE_FY.Right, pitch: 0, ground: true };
}

// ===== KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ (light-attack-4 v6 ile aynı model) =====
const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const FINGERS = JSON.parse(fs.readFileSync('C:/AnimRef/animations/katana_run.json', 'utf8')).tracks;
const PP = V(...(prop ? prop.pos : [-0.27084, 0.07551, 0.18772]));
const R0 = R, L0H = RL;
const PSCALE = prop ? prop.scale : 0.92385;
const eW0 = fr0.clone().sub(b1.clone().multiplyScalar(fr0.dot(b1))).normalize();
const EH = eW0.clone().applyQuaternion(Wr.clone().invert());
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
for (const s of ['Right', 'Left']) { const H = s === 'Right' ? R0 : L0H; const a1 = H.n0.clone(), a2 = H.f0.clone().cross(H.n0).normalize();
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

// ---- kılıç yolu (göğüs-yaw çerçevesi, göğüs eklemine göre; x sol, y yukarı, z ileri). e: kenar ----
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const toYaw = (sw, cy, org) => ({ C: sw.C.clone().sub(org).applyQuaternion(Ry(-cy)), t: sw.t.clone().applyQuaternion(Ry(-cy)), e: sw.e.clone().applyQuaternion(Ry(-cy)) });
const cyA = bodyAt(0).chestYaw, cyI = bodyAt(LEN - 1).chestYaw;
const SW0 = toYaw(swordFromHand(A2.D.RightHand, A2.pos.RightHand), cyA, A2.pos.Spine), SWI = toYaw(swordFromHand(IDLE.D.RightHand, IDLE.pos.RightHand), cyI, IDLE.pos.Spine);
// çapraz kesim düzlemleri (göğüs-yaw çerçevesi): DG1 sağ-yukarı (1. kesik: sağ-üstten sol-alta), DG2 sol-yukarı (2. kesik: sol-üstten sağ-alta).
// dg(φ): φ=90 bıçak düzlemin üst ucunu, φ=0 ileriyi gösterir; φ azaldıkça kesik iner; kenar hareket yönünde (φ=90'da ileri).
const DG2X = +(ARGS.find((x) => x.startsWith('--dg2='))?.slice(6) ?? 0.45);   // 2. kesik daha dik (sağ elle soldan sağa kenar önde kavrama sınırı)
const DG1 = V(-0.8, 1, 0).normalize(), DG2 = V(DG2X, 1, 0).normalize();
const dgp = (U) => (phi) => { const t = V(0, 0, 1).multiplyScalar(Math.cos(rad(phi))).add(U.clone().multiplyScalar(Math.sin(rad(phi))));
  const e = V(0, 0, 1).multiplyScalar(Math.sin(rad(phi))).sub(U.clone().multiplyScalar(Math.cos(rad(phi)))); return [t.toArray(), e.toArray()]; };
const dg1 = dgp(DG1), dg2 = dgp(DG2);
// iki kılıç çerçevesi (t, e) arasında küresel ara değer (sarılma ve kesikler arası kalkış için)
const mixTE = (A, B, k) => { const q = basisQ(V(...A[0]), V(...A[1])).slerp(basisQ(V(...B[0]), V(...B[1])), k); return [V(1, 0, 0).applyQuaternion(q).toArray(), V(0, 1, 0).applyQuaternion(q).toArray()]; };
const TE0 = [SW0.t.toArray(), SW0.e.toArray()], TEH = dg1(130), TE1E = dg1(-30), TE2S = dg2(145);
const KS = [
  [0, SW0.C.toArray(), SW0.t.toArray(), SW0.e.toArray()],
  [HOLD, [-0.3, 0.3, -0.05], ...TEH, 'h'],                                   // BEKLEME: hasso — kılıç sağ omuz üstünde dik, uç hafif geride
  [25, [-0.27, 0.32, 0.0], ...dg1(140)],
  [27, [-0.18, 0.3, 0.18], ...dg1(105)],                                      // 1. kesik: sağ-üstten sol-alta, ~6 kare
  [29, [-0.04, 0.12, 0.38], ...dg1(50)],
  [31, [0.1, -0.12, 0.4], ...dg1(0)],
  [33, [0.14, -0.24, 0.32], ...TE1E],
  [36, [0.22, -0.05, 0.25], ...mixTE(TE1E, TE2S, 0.45)],                     // kılıç sol yandan sol omuz üstüne kalkar (kesikten yavaş)
  [38, [0.24, 0.24, 0.02], ...mixTE(TE1E, TE2S, 0.9)],
  [40, [0.24, 0.28, -0.02], ...TE2S],
  [42, [0.14, 0.26, 0.18], ...dg2(105)],                                      // 2. kesik (tek el, ters elden): sol-üstten sağ-alta, ~4 kare
  [44, [0.0, 0.0, 0.4], ...dg2(25)],
  [46, [-0.06, -0.2, 0.38], ...dg2(-30)],
  [51, [-0.12, -0.28, 0.34], ...dg2(-36)],                                    // ağır duruş: kılıç önde-sağda alçak
  [59, [-0.22, -0.42, 0.18], [0.0, -0.42, 0.91], [0.1, -0.9, -0.42]],         // toparlanma: kılıç önde, idle'ın duruşuna
  [LEN - 1, SWI.C.toArray(), SWI.t.toArray(), SWI.e.toArray()],
];
const SPIN = [[25, 34], [40, 48]]; const SPINCAP = +(ARGS.find((x) => x.startsWith('--cap='))?.slice(6) ?? 6);   // kesiklerde kesim düzlemi sapma sınırı (°)
const inCut = (f) => SPIN.some(([a, b]) => f >= a && f <= b);
const WD = (f) => 1 + 5 * Math.max(...SPIN.map(([a, b]) => smooth((f - a) / 2) * (1 - smooth((f - b) / 2))));
const SPD = (f) => (f <= 5 ? 5 : 11);
function designAt(f) {
  const r = spl(KS.map((k) => [k[0], [...k[1], ...k[2], ...k[3]], k[4]]), f);
  const t = V(r[3], r[4], r[5]).normalize(); const e = V(r[6], r[7], r[8]); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return { C: V(r[0], r[1], r[2]), t, e };
}
const TWO = (f) => smooth((f - 11) / 9) * (1 - smooth((f - 33) / 5));   // iki el: 9–19 kavrar (kılıç omuz önüne gelince); 1. kesikten sonra 33–38 bırakır (2. kesik tek elle, ters elden)
const GRIP = TWO;

// ---- maliyet (light-attack-4 ile aynı; dönüşte yatay düzlem sapma sınırı dar) ----
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
    const wm = ik.wmag, wl = tag === 'L' ? 11 : 13.5; c += 0.002 * wm * wm + (wm > wl ? 4 * sq(wm - wl) : 0);
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
  // bıçak bacaklara girmesin (bel hizası süpürmede uyluklar yakın)
  for (const [a_, b_] of ctx.legs) { const ds = Math.min(...[0.3, 0.5, 0.7, 0.9].map((s) => segDist(a_, b_, pom.clone().lerp(tip, s)))); if (ds < 0.11) c += 3000 * sq(0.11 - ds); }
  c += 150 * ctx.wd * (ctx.cw ?? 1) * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) + 0.002 * ctx.wd * (ctx.aw ?? 1) * (x[3] * x[3] + x[4] * x[4]);
  c += 0.003 * x[5] * x[5] + (Math.abs(x[5]) > 24 ? 3 * sq(Math.abs(x[5]) - 24) : 0);
  for (const i of [11, 12, 13, 14]) c += 0.004 * x[i] * x[i] + (Math.abs(x[i]) > 12 ? 1 * sq(Math.abs(x[i]) - 12) : 0);
  if (prev) { c += 3000 * (sq(x[0] - prev[0]) + sq(x[1] - prev[1]) + sq(x[2] - prev[2])); for (let i = 3; i < x.length; i++) c += (i === 6 ? 0.1 : 0.03) * sq(x[i] - prev[i]);
    const dg = Math.abs(x[6] - prev[6]); if (dg > 3) c += 2 * sq(dg - 3); }
  { const cap = inCut(ctx.f) ? SPINCAP : 22; for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > cap ? 2 * sq(a - cap) : 0); } }
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
    for (let k = 0; k < 6; k++) { const y = x.map((v, i) => v + (rnd() * 2 - 1) * st[i] * 0.7); const fy = evalX(ctx, y); if (fy < fx) { x = y; fx = fy; imp = true; } }
    if (!imp) { st = st.map((s) => s * 0.5); if (st[0] < 2e-4) break; }
  }
  return { x, fx };
}

// ---- sol kol serbest (kavrama dışı) ----
const chestD = (f) => spineD(f, bodyAt(f)).Spine;
const Dc0i = chestD(0).invert(), DcEi = chestD(LEN - 1).invert();
const uL0c = RL.u0.clone().applyQuaternion(A2.D.LeftArm).applyQuaternion(Dc0i), fL0c = RL.f0.clone().applyQuaternion(A2.D.LeftForeArm).applyQuaternion(Dc0i);
const uLEc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcEi), fLEc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcEi);
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
const LU = [[0, uL0c.toArray()], [18, [0.15, -0.75, 0.6]], [35, [0.1, -0.75, 0.62]], [41, [0.3, -0.75, -0.55]], [50, [0.28, -0.8, -0.45]], [60, [0.3, -0.9, -0.1]], [LEN - 1, uLEc.toArray()]];   // bırakınca el kalçaya çekilir (hikite)
const LF = [[0, flx(uL0c, fL0c).toArray()], [18, [-0.4, 0.1, 0.9]], [35, [-0.4, 0.1, 0.9]], [41, [-0.15, 0.2, 1]], [50, [-0.1, 0.15, 1]], [60, [0.0, 0.2, 1]], [LEN - 1, flx(uLEc, fLEc).toArray()]];
const BEND_L = [[0, deg(uL0c.angleTo(fL0c))], [18, 50], [35, 50], [41, 88], [50, 85], [60, 45], [LEN - 1, deg(uLEc.angleTo(fLEc))]];
const lcache = {}; const TAUF = { a: 0, b: 0 }; const REINIT = 28;
const tauFree = (f) => (f <= 30 ? TAUF.a * sst(f / 18) : TAUF.b * (1 - sst((f - 33) / 14)));
function leftFree(f) {
  if (lcache[f]) return lcache[f];
  const Dc = chestD(f); const uc = V(...spl(LU, f)).normalize(), bend = spl(BEND_L, f);
  const fx = V(...spl(LF, f)); fx.sub(uc.clone().multiplyScalar(fx.dot(uc))).normalize();
  const u = uc.clone().applyQuaternion(Dc), hint = uc.clone().multiplyScalar(Math.cos(rad(bend))).add(fx.multiplyScalar(Math.sin(rad(bend)))).applyQuaternion(Dc);
  const hg = hinge(RL, bend);
  let base, acc0;
  if (f === 0) { base = A2.D.LeftArm.clone(); acc0 = 0; }
  else if (f === REINIT) { const idleArm = chestD(f).multiply(DcEi).multiply(IDLE.D.LeftArm); base = new THREE.Quaternion().setFromUnitVectors(RL.u0.clone().applyQuaternion(idleArm), u).multiply(idleArm); acc0 = 0; }   // dönüşte biriken burulmayı sil
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
const X0 = [0, 0, 0, 0, 0, 0, 0, WR0[0], WR0[1], 0, 0, 0, 0, 0, 0], XE = [0, 0, 0, 0, 0, 0, 0, WRI[0], WRI[1], 0, 0, 0, 0, 0, 0];
function solve(f, fit = false) {
  const p = bodyAt(f); const D = spineD(f, p);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(...p.hp));
  p.ground = {}; p.feet = {};
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const fb = footAt(s, f); const ft = { ankle: ankleFromToe(s, fb.ball, fb.yaw, fb.pitch), yaw: fb.yaw, pitch: fb.pitch };
    p.ground[s] = fb.ground; p.feet[s] = fb;
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    if (p.ground[s] && ft.ankle.distanceTo(hipJ) / (L1 + L2) > 0.962) { // yerde bacak erişimi ≤0,962: topuk kalkar (taban yerde)
      const ball = fb.ball;
      for (let pt = Math.max(0, ft.pitch); pt <= 46; pt += 0.5) { const a = ankleFromToe(s, ball, ft.yaw, pt); ft.ankle = a; ft.pitch = pt; if (a.distanceTo(hipJ) / (L1 + L2) <= 0.962) break; }
    }
    if (!p.ground[s]) { const dv0 = ft.ankle.clone().sub(hipJ); const r0 = dv0.length() / (L1 + L2); const K0 = 0.945, KW = 0.02;
      if (r0 > K0) ft.ankle = hipJ.clone().add(dv0.multiplyScalar((K0 + KW * Math.tanh((r0 - K0) / KW)) / r0)); }
    let dv = ft.ankle.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    p['reach' + s] = d / (L1 + L2); d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1).applyQuaternion(Ry(ft.yaw - (s === 'Left' ? 5 : -15))).normalize(); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h)); const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    { const fz = V(0, 0, 1), pl = knee.clone().sub(hipJ.clone().add(dir.clone().multiplyScalar(a))).normalize();
      const fr = (x0, x1) => basisQ(x1, pl).multiply(basisQ(x0, fz).invert());
      const wt = Math.min(1, f / 12), kt = sst(wt);   // 2. vuruşun burulmasından tutarlı çerçeveye yumuşak geçiş (dönüşte bacak burulması birikmez)
      const td = knee.clone().sub(hipJ).normalize(), sd = ankle.clone().sub(knee).normalize();
      D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), td).slerp(fr(restDir(s + 'UpLeg', s + 'Leg'), td), kt);
      D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), sd).slerp(fr(restDir(s + 'Leg', s + 'Foot'), sd), kt); }
    D[s + 'Foot'] = eul([ft.yaw, ft.pitch, 0]);
    { const bend = p.ground[s] ? -Math.min(Math.max(0, ft.pitch), 42) : 6;   // yerde parmaklar düz (taban üstünde dönüş), havada hafif uzanır
      D[s + 'ToeBase'] = eul([ft.yaw, ft.pitch + bend, 0]); }
    p.legSeg = p.legSeg || []; p.legSeg.push([hipJ.clone(), knee.clone()], [knee.clone(), ankle.clone()]);
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
  const Y = Ry(p.chestYaw); const des = designAt(f);
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C.clone().applyQuaternion(Y)), td: des.t.clone().applyQuaternion(Y), ed: des.e.clone().applyQuaternion(Y), pos0, D, g,
    Lf: { P: LfP, DH: LfDH }, meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, wf, legs: p.legSeg };
  const kS = 1 - smooth(f / 8), kE = smooth((f - 58) / 13);
  ctx.wd = WD(f); ctx.f = f; ctx.prevD = prevD; ctx.gam0 = g > 0 ? GAM0 : null;
  ctx.soft = 1 - Math.max(kS, kE); ctx.anchor = kS > 0 ? { xa: X0, k: 4 * kS } : kE > 0 ? { xa: XE, k: 4 * kE } : null;
  let x0 = prevX ? prevX.slice() : X0.slice();
  if (g <= 0) { x0[9] = wf[0]; x0[10] = wf[1]; x0[13] = 0; x0[14] = 0; if (ctx.prev) { ctx.prev = ctx.prev.slice(); ctx.prev[9] = wf[0]; ctx.prev[10] = wf[1]; } }
  if (g > 0 && prevX && TWO(f - 1) <= 0) { // kavramanın ilk karesi: γ taraması
    let best = null; const pv = prevX.slice(); pv[9] = wf[0]; pv[10] = wf[1];
    for (let gm = GAM0 - 15; gm <= GAM0 + 15; gm += 5) { const xs = x0.slice(); xs[6] = gm; ctx.prev = pv.slice(); ctx.prev[6] = gm; const r = optimize(ctx, xs, 80); if (!best || r.fx < best.fx) best = r; }
    x0 = best.x; ctx.prev = pv; ctx.prev[6] = x0[6];
  }
  if (fit) {   // anahtar uydurma: süreklilik yok; kabza noktası serbest (yakın olan tercih), bıçak yönü/kenarı sıkı → erişilebilir kabza
    ctx.prev = null; ctx.prevD = null; ctx.prevTau = null; ctx.anchor = null; ctx.soft = 1; ctx.cw = 0.2; ctx.aw = 12; ctx.gam0 = g > 0 ? GAM0 : null;
    let best = null; const xs0 = X0.slice(); if (g > 0) xs0[6] = GAM0;
    for (const dx of [-0.25, 0, 0.25]) for (const dy of [-0.15, 0, 0.15]) for (const dz of [-0.2, 0, 0.2]) { const xs = xs0.slice(); const o = V(dx, dy, dz).applyQuaternion(Y.clone().invert()); xs[0] = dx; xs[1] = dy; xs[2] = dz; const r = optimize(ctx, xs, 90); if (!best || r.fx < best.fx) best = r; }
    best = optimize(ctx, best.x, 400); const r = evalX(ctx, best.x, true);
    return { C: r.C.clone().sub(pos0.Spine).applyQuaternion(Y.clone().invert()), cost: best.fx, errR: r.ikR.err, errL: r.ikL ? r.ikL.err : 0, wR: r.ikR.wmag, wL: r.ikL ? r.ikL.wmag : 0, x: best.x };
  }
  const opt = f === 0 ? { x: X0.slice(), fx: evalX(ctx, X0) } : optimize(ctx, x0, 400);
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true); prevD = { RU: r.ikR.DU, RF: r.ikR.DF, LU: r.ikL ? r.ikL.DU : null, LF: r.ikL ? r.ikL.DF : null }; prevTau = { R: r.ikR.tau, L: r.ikL ? r.ikL.tau : null };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  if (r.ikL) { D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
    if (g < 0.95) { const k = smooth(1 - g / 0.95); D.LeftShoulder = r.DshL.clone().slerp(D.Spine, k); D.LeftArm = r.ikL.DU.clone().slerp(lF.arm, k); D.LeftForeArm = r.ikL.DF.clone().slerp(lF.fore, k); D.LeftHand = r.ikL.DH.clone().slerp(LfDH, k); } }
  else { D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH; }
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.gw = g; p.chest = pos0.Spine;
  p.bladeDir = r.t; p.tip = r.tip; p.tipY = r.tipY;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// anahtar uydurma: her ara KS anahtarında kabza noktasını erişilebilir en yakın konuma taşı (bıçak yönü/kenarı tasarımdaki gibi kalır)
{ const t0f = Date.now();
  for (const k of KS) { if (k[0] === 0 || k[0] === LEN - 1) continue; const r = solve(k[0], true);
    console.log('uydurma', k[0], 'C', k[1].map((v) => v.toFixed(2)).join(','), '→', r.C.toArray().map((v) => v.toFixed(2)).join(','), '| eR/eL', (r.errR * 1000).toFixed(0), (r.errL * 1000).toFixed(0), 'mm | w', r.wR.toFixed(1), r.wL.toFixed(1), '| c', r.cost.toFixed(1));
    k[1] = r.C.toArray(); }
  for (const kk of Object.keys(lcache)) delete lcache[kk]; console.log('uydurma süresi', ((Date.now() - t0f) / 1000).toFixed(1), 'sn'); }
// ön geçiş: sol kolun serbest anahtarlarını kavrama başı/sonu IK pozuna eşitle (kavramaya giriş/çıkışta burulma sıçraması olmaz)
const G_IN = 20, G_OUT = 33;
{ const cap = {};
  for (let f = 0; f < LEN; f++) { const r = solve(f); if (f === G_IN || f === G_OUT) { const ik = r.p.r.ikL; const Di = chestD(f).invert(); const uc = ik.u.clone().applyQuaternion(Di), fc = ik.fd.clone().applyQuaternion(Di); cap[f] = { u: uc.toArray(), fx: flx(uc, fc).toArray(), b: ik.bend, tau: ik.tau }; } }
  prevX = null; prevTau = null; prevD = null; SEED = 12345; for (const k of Object.keys(lcache)) delete lcache[k];
  const setK = (arr, f, v) => { const i = arr.findIndex((k) => k[0] === f); if (i >= 0) arr[i] = [f, v]; else { arr.push([f, v]); arr.sort((x, y) => x[0] - y[0]); } };
  TAUF.a = cap[G_IN].tau; TAUF.b = cap[G_OUT].tau; console.log('serbest önkol pronasyonu (kavrama başı/sonu):', TAUF.a.toFixed(0), TAUF.b.toFixed(0));
  for (const [fk, fc] of [[18, G_IN], [35, G_OUT]]) { setK(LU, fk, cap[fc].u); setK(LF, fk, cap[fc].fx); setK(BEND_L, fk, cap[fc].b); }
}
const outs = []; const diag = []; const hand = [];
const t0run = Date.now();
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r);
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL?.err, tauR: R_.ikR.tau, tauL: R_.ikL?.tau, bendR: R_.ikR.bend, bendL: R_.ikL?.bend, wR: R_.ikR.wmag, wL: R_.ikL?.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reachLeft, r.p.reachRight], ground: r.p.ground, gw: r.p.gw, cy: r.p.chestYaw, pel: r.p.pel[0] });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'g', d.gw.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', d.errL != null ? (d.errL * 1000).toFixed(1) : '-', 'wR', d.wR.toFixed(1), 'wL', d.wL?.toFixed(1) ?? '-', 'τR', d.tauR.toFixed(0), 'τL', d.tauL?.toFixed(0) ?? '-',
  'bR', d.bendR.toFixed(0), 'bL', d.bendL?.toFixed(0) ?? '-', 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2), 'pel', d.pel.toFixed(0), 'cy', d.cy.toFixed(0), 'reach', d.reach.map((v) => v.toFixed(2)).join('/'));

// ---- sol el parmakları: serbest (yaylı) ↔ kavrama, GRIP ağırlığıyla ----
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

// ---- dikiş (0. kare = 2[47]) ve bitiş (son kare = katana_idle[0], yatay kök konumu hariç) ----
const SEAM = 9, ENDB = 20; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const r0 = {}, rE = {}, d0 = {}, dE = {};
for (const n of allNames) { const g0 = genAt(n, 0), gE = genAt(n, LEN - 1);
  r0[n] = g0.clone().invert().multiply(A2.local[n]); d0[n] = qAng(g0, A2.local[n]);
  rE[n] = gE.clone().invert().multiply(IDLE.local[n]); dE[n] = qAng(gE, IDLE.local[n]); }
const h0 = V(...A2.hl).sub(V(...outs[0].hipsLocal));
const hE = V(...IDLE.hl).sub(V(...outs[LEN - 1].hipsLocal)); hE.x = 0; hE.y = 0;
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const w0 = 1 - smooth(f / SEAM), wE = smooth((f - (LEN - 1 - ENDB)) / ENDB);
  for (const n of allNames) {
    let q = genAt(n, f).clone(); if (w0 > 0) q.multiply(powQ(r0[n], w0)); if (wE > 0) q.multiply(powQ(rE[n], wE));
    if (f === 0) q = A2.local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const hp = V(...outs[f].hipsLocal).add(h0.clone().multiplyScalar(w0)).add(hE.clone().multiplyScalar(wE));
  if (f === 0) hp.set(...A2.hl);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}
// sol önkol pronasyonunu kavramaya giriş boyunca (1–15) tek yumuşak eğriye yay (önkol ekseni etrafında: el konumu değişmez)
{ const n = 'LeftForeArm', rq = Q(by[n].restQ), rqi = rq.clone().invert(); const twA = (f) => { const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))); return 2 * Math.atan2(d.y, d.w); };
  const a0 = 1, a1 = G_IN, t0 = twA(a0), t1 = twA(a1); const raw = []; for (let f = a0; f <= a1; f++) raw.push(twA(f));
  for (let f = a0 + 1; f < a1; f++) { const tn = t0 + (t1 - t0) * smooth((f - a0) / (a1 - a0)); const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), tn - raw[f - a0]));
    const q = rq.clone().multiply(d); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
// dönüş penceresinde kol zinciri yumuşatma + sol eli kabzaya yeniden oturtma
const fkT = (f) => { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? Q(tracks[b.name].rot[f].slice(1)) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, cur }; };
const relLH = (f) => { const k = fkT(f); return { p: k.pos.LeftHand.clone().sub(k.pos.RightHand).applyQuaternion(k.cur.RightHand.clone().invert()), q: k.cur.RightHand.clone().invert().multiply(k.cur.LeftHand) }; };
const SA = 18, SB = 33; const rel0 = []; for (let f = SA; f <= SB; f++) rel0.push(relLH(f));
for (let pass = 0; pass < 2; pass++) for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = SA + 2; f <= SB - 2; f++) { if (Math.abs(f - HOLD) <= 1) continue; const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[f + i - 2]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
    const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
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

// ---- bekleme karesi: tüm kemiklerde hız sıfır (şarjda donunca doğal dursun, dönüş o kareden temiz başlasın) ----
{ const W = 5, src = {}; for (const n of Object.keys(tracks)) src[n] = { rot: tracks[n].rot.map((k) => k.slice()), pos: tracks[n].pos ? tracks[n].pos.map((k) => k.slice()) : null };
  const g = (x) => { const a = Math.abs(x); return Math.sign(x) * (2 * a * a / W - a * a * a / (W * W)); };
  for (let f = HOLD - W + 1; f <= HOLD + W - 1; f++) { const sf = HOLD + g(f - HOLD), a = Math.floor(sf), u = sf - a;
    for (const n of Object.keys(tracks)) { const r = src[n].rot; const q = Q(r[a].slice(1)).slerp(Q(r[Math.min(LEN - 1, a + 1)].slice(1)), u); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w];
      if (src[n].pos) { const p = src[n].pos; tracks[n].pos[f] = [f, ...[1, 2, 3].map((c) => p[a][c] * (1 - u) + p[Math.min(LEN - 1, a + 1)][c] * u)]; } } } }
// ---- rapor (son izlerden FK ile) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − 2[47] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − idle[0] (sonda söner):', top(dE));
const seam = (C, fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = C.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(keyAt(t.rot, fa).slice(1)), qOf(n, fb)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seam(A2, A2.F, 0), [e0, e0n] = seam(IDLE, 0, LEN - 1);
console.log(`dikiş: 2[47]→H2[0] max ${s0.toFixed(3)}° (${s0n}), kalça ${(V(...tracks.Hips.pos[0].slice(1)).distanceTo(V(...A2.hl)) * 1000).toFixed(2)} mm | H2[son]↔idle[0] max ${e0.toFixed(3)}° (${e0n}), kalça yükseklik ${((tracks.Hips.pos[LEN - 1][3] - IDLE.hl[2]) * 100).toFixed(2)} cm`);
console.log('ilk kareler (max kemik °/kare):', [1, 2, 3, 4, 5, 6].map((f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mn = n; } } return m.toFixed(1) + ' ' + mn; }).join(', '));
const FF = []; for (let f = 0; f < LEN; f++) { const k = fkT(f); const Dd = {}; for (const n of Object.keys(k.cur)) Dd[n] = k.cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos: k.pos, D: Dd, cur: k.cur }); }
const palm = (s) => V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize();
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: ang, flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };   // toplam = HeroWristAudit gibi el ekseninin açısı (önkol burulması hariç)
const WRS = {};
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  WRS[s] = { flex: mx('flex'), dev: mx('dev'), tot: mx('tot') };
  console.log(s, 'bilek (HeroWristAudit tanımı): fleksiyon max', mx('flex')[0].toFixed(1), '° (kare', mx('flex')[1] + ') | sapma max', mx('dev')[0].toFixed(1), '° (kare', mx('dev')[1] + ') | toplam max', mx('tot')[0].toFixed(1), '° (kare', mx('tot')[1] + ') | burulma max', mx('tw')[0].toFixed(1));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const gF = [...Array(LEN).keys()].filter((f) => diag[f].gw > 0.99);
const gd = gF.map((f) => { const t = outs[f].p.bladeDir; return FF[f].pos.LeftHand.clone().sub(FF[f].pos.RightHand).dot(t) * 100; });
console.log('iki elli tam kavrama: kare', gF[0], '–', gF.at(-1), '| sol el sağ elden eksen boyunca', Math.min(...gd).toFixed(1), '..', Math.max(...gd).toFixed(1), 'cm | erişim hatası max R/L', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), '/', (Math.max(...diag.filter((d) => d.errL != null).map((d) => Math.abs(d.errL) * (d.gw))) * 1000).toFixed(1), 'mm');
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
const dd = diag.filter((d) => d.gw > 0);
console.log('β (roll sapması)', rng(diag.map((d) => d.x[5])), '| γ', rng(dd.map((d) => d.x[6])), '| dirsek R', rng(diag.map((d) => d.bendR)), 'L(kavrama)', rng(dd.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), 'L', rng(dd.map((d) => d.tauL)), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg', 'LeftFoot', 'RightFoot'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde', Math.min(...diag.map((d) => d.bc)).toFixed(3), '| bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '| uç-yer', Math.min(...diag.map((d) => d.tipY)).toFixed(3));
// ölçümler: kılıç ucu (prop ofsetiyle, son FK), vuruş penceresi, kök ilerlemesi, ayak kayması
const tipOf = (f) => { const c = FF[f].cur.RightHand, p = FF[f].pos.RightHand; const t = b0.clone().applyQuaternion(c.clone().multiply(restW.RightHand.clone().invert()));
  const C = p.clone().add(PPpR.clone().applyQuaternion(FF[f].D.RightHand)); return C.clone().add(t.multiplyScalar(HALF - SR)); };
const TIP = [...Array(LEN).keys()].map(tipOf);
const tv = TIP.map((p, f) => (f ? p.distanceTo(TIP[f - 1]) * 60 : 0)); const vpk = Math.max(...tv.slice(HOLD)); const fpk = tv.indexOf(vpk);
let ha = fpk, hb = fpk; while (ha > HOLD && tv[ha - 1] >= 0.55 * vpk) ha--; while (hb < LEN - 1 && tv[hb + 1] >= 0.55 * vpk) hb++;
const hipXZ = (f) => V(FF[f].pos.Hips.x, 0, FF[f].pos.Hips.z);
const sweep = (() => { let a = 0; for (let f = ha + 1; f <= hb; f++) { const u = TIP[f - 1].clone().sub(FF[f - 1].pos.Hips), w = TIP[f].clone().sub(FF[f].pos.Hips); let d = Math.atan2(w.x, w.z) - Math.atan2(u.x, u.z); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; a += deg(d); } return a; })();
const reach = Math.max(...TIP.slice(ha, hb + 1).map((p, i) => Math.hypot(p.x - FF[ha + i].pos.Hips.x, p.z - FF[ha + i].pos.Hips.z)));
const segs = []; { let a = -1; for (let f = HOLD; f < LEN; f++) { const on = tv[f] >= 0.55 * vpk; if (on && a < 0) a = f; if ((!on || f === LEN - 1) && a >= 0) { segs.push([a, on ? f : f - 1]); a = -1; } } }
console.log('vuruş pencereleri (uç hızı ≥%55 tepe):', segs.map(([a, b]) => `${a}–${b} (${(a / 60).toFixed(3)}–${(b / 60).toFixed(3)} sn, tepe ${Math.max(...tv.slice(a, b + 1)).toFixed(1)} m/s @${a + tv.slice(a, b + 1).indexOf(Math.max(...tv.slice(a, b + 1)))})`).join(' | '));
console.log(`en hızlı pencere: kare ${ha}–${hb} (${(ha / 60).toFixed(3)}–${(hb / 60).toFixed(3)} sn) | tepe ${vpk.toFixed(1)} m/s (kare ${fpk}) | süpürme ${sweep.toFixed(0)}° | uç yatay erişim max ${reach.toFixed(2)} m | uç yüksekliği ${rng(TIP.slice(ha, hb + 1).map((p) => (p.y - GROUND) * 100))} cm`);
console.log('uç hızı (m/s):', tv.map((v, f) => f + ':' + v.toFixed(1)).filter((_, f) => f % 2 === 0 || (f >= 24 && f <= 34)).join(' '));
console.log(`kök: kalça XZ başlangıç→son ${((hipXZ(LEN - 1).z - hipXZ(0).z) * 100).toFixed(1)} cm ileri, ${((hipXZ(LEN - 1).x - hipXZ(0).x) * 100).toFixed(1)} cm yan | bekleme (${HOLD}) → dönüş sonu: ${((hipXZ(40).z - hipXZ(HOLD).z) * 100).toFixed(1)} cm`);
const toeP = (s, f) => FF[f].pos[s + 'ToeBase'];
const slide = (s, a, b) => { let m = 0; for (let f = a + 1; f <= b; f++) m = Math.max(m, Math.hypot(toeP(s, f).x - toeP(s, a).x, toeP(s, f).z - toeP(s, a).z)); return m * 100; };
console.log(`ayak kayması (parmak eklemi XZ, cm, yerdeki evreler): sol 0–${STEP_L[0]} ${slide('Left', 0, STEP_L[0]).toFixed(1)}, sol ${STEP_L[1]}–${LEN - 1} ${slide('Left', STEP_L[1], LEN - 1).toFixed(1)} | sağ 0–${STEP_R[0]} ${slide('Right', 0, STEP_R[0]).toFixed(1)}, sağ ${STEP_R[1]}–${STEP_RE[0]} ${slide('Right', STEP_R[1], STEP_RE[0]).toFixed(1)}, sağ ${STEP_RE[1]}–${LEN - 1} ${slide('Right', STEP_RE[1], LEN - 1).toFixed(1)}`);
console.log(`bekleme karesi ${HOLD}: max kemik hızı ${(() => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, HOLD + 1), qOf(n, HOLD - 1)) / 2; if (a > m) { m = a; mn = n; } } return m.toFixed(2) + '°/kare (' + mn + ')'; })()} | kalça ${(V(...tracks.Hips.pos[HOLD + 1].slice(1)).distanceTo(V(...tracks.Hips.pos[HOLD - 1].slice(1))) * 50).toFixed(2)} cm/kare | ayak yerde: L ${diag[HOLD].ground.Left} R ${diag[HOLD].ground.Right}`);
console.log('pelvis yaw', diag[0].pel.toFixed(0), '→ bekleme', diag[HOLD].pel.toFixed(0), '→ 1. kesik sonu', diag[34].pel.toFixed(0), '→ 2. kesik sonu', diag[47].pel.toFixed(0), '→ son', diag[LEN - 1].pel.toFixed(0), '| bacak erişimi (yerde) max', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3));
for (const f of [0, 8, 14, HOLD, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 51, 56, 62, LEN - 1]) { const P2 = FF[f].pos; console.log('  kare', f, 'kalça y', (P2.Hips.y).toFixed(2), 'eller R/L y', P2.RightHand.y.toFixed(2), P2.LeftHand.y.toFixed(2), 'uç', TIP[f].toArray().map((v) => v.toFixed(2)).join(','), 'pel', diag[f].pel.toFixed(0), 'göğüs', diag[f].cy.toFixed(0), 'ayak yerde', diag[f].ground.Left ? 'L' : '-', diag[f].ground.Right ? 'R' : '-'); }

const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
// ---- şarjlı önizleme: 0..HOLD normal, HOLD 36 kare (0,6 sn) tutulur, sonrası 1,3× (slerp ile yeniden örnek) ----
function resample(src, frames) {   // frames: kaynak kare (ondalıklı) dizisi
  const out = {};
  for (const [n, t] of Object.entries(src.tracks)) {
    const o = {};
    if (t.rot) o.rot = frames.map((sf, i) => { const a = Math.floor(sf), b = Math.min(src.length - 1, a + 1), u = sf - a; const qa = Q(t.rot[a].slice(1)), qb = Q(t.rot[b].slice(1)); const q = qa.slerp(qb, u); return [i, q.x, q.y, q.z, q.w]; });
    if (t.pos) o.pos = frames.map((sf, i) => { const a = Math.floor(sf), b = Math.min(src.length - 1, a + 1), u = sf - a; return [i, ...[1, 2, 3].map((c) => t.pos[a][c] * (1 - u) + t.pos[b][c] * u)]; });
    out[n] = o;
  }
  return out;
}
const pf = []; for (let f = 0; f <= HOLD; f++) pf.push(f); for (let k = 0; k < 36; k++) pf.push(HOLD); for (let s = HOLD + 1.3; s < LEN - 1; s += 1.3) pf.push(s); pf.push(LEN - 1);
const preview = { name: PREVIEW, fps: 60, length: pf.length, loop: false, tracks: resample(anim, pf) };
console.log('önizleme (şarjlı):', pf.length, 'kare =', (pf.length / 60).toFixed(2), 'sn (bekleme', HOLD, '→', HOLD + 36, ')');
const DUMP = ARGS.find((x) => x.startsWith('--dump='))?.slice(7);
if (DUMP) fs.writeFileSync(DUMP + '/heavy2_cur.json', JSON.stringify(anim));
if (!NOSEND) {
  const post = async (url, body) => (await fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (!ARGS.includes('--nosave')) { console.log('kaydedildi', await post('/api/animations/save?name=' + NAME, anim)); console.log('kaydedildi', await post('/api/animations/save?name=' + PREVIEW, preview)); }
  if (ARGS.includes('--combo')) {   // L2 → H2 art arda (kaydedilmez, yalnız editörde gösterilir)
    const L2A = A2.A; const tr = {};
    for (const n of Object.keys(tracks)) { const a = L2A.tracks[n]; const o = {};
      o.rot = [...(a?.rot || Array.from({ length: L2A.length }, (_, i) => [i, ...tracks[n].rot[0].slice(1)])).map((k, i) => [i, ...k.slice(1)]), ...tracks[n].rot.slice(1).map((k) => [k[0] + L2A.length - 1, ...k.slice(1)])];
      if (tracks[n].pos) o.pos = [...a.pos.map((k, i) => [i, ...k.slice(1)]), ...tracks[n].pos.slice(1).map((k) => [k[0] + L2A.length - 1, ...k.slice(1)])];
      tr[n] = o; }
    console.log(PORT + ' yüklendi (L2→H2, kaydedilmedi)', await post('/api/claude/anim', { anim: { name: 'L2_to_heavy_attack_2', fps: 60, length: L2A.length + LEN - 1, loop: true, tracks: tr } }));
  } else console.log(PORT + ' yüklendi', await post('/api/claude/anim', { anim: ARGS.includes('--preview') ? preview : anim }));
}
