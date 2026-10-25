// game_heavy_attack_4 üretici: ağır H4 = BÜYÜK BİTİRİCİ. 4. hafif vuruştan (game_light_attack_4) sonra ağır tuşuyla dallanır.
// 0. kare = game_light_attack_4 (v2, kütüphanede game_light_attack_4_v2)[61]: vuruş sonrası en derin çökme/ağırlık karesi (kalça en alçakta, kılıç durmuş, iki el kabzada;
// L4'ün vuruş penceresi 53–56 bitmiş, kombo penceresi açık).
// Hazırlık (0–32): gövde çökmeden doğrulur, kılıç alçaktan sağ kalçaya çekilir (waki-gamae: uç geride-aşağıda), kalça/göğüs sağa
// kurulur, ağırlık geriye kayar, arka topuk yere iner. Bekleme karesi 32 (şarjda donar): iki ayak yerde, kılıç kurulu.
// Vuruş (32–52): arka bacak iter, sol ayak öne basar (fumikomi), kalça → göğüs → kollar → kılıç; sağ alttan sol üste tek düzlemde
// büyük yükselen çapraz kesik (kiri-age, kenar önde), tüm vücut açılır, arka ayak toparlanır (hikitsuke).
// Zanshin (52–66), sol el bırakır; sağ elle chiburi (kılıç başın sağına kalkar, sağ-aşağıya silkelenir) + arka ayak idle duruşuna adım;
// son kare game_katana_idle[0] (yatay kök hariç). Kılıç kına girmez.
// Yalnız bu oturumun editör portuna yükler/kaydeder (--port= zorunlu). Çalıştır: node heavy-attack-4.mjs [--nosend] [--nosave] [--diag] [--l4h4] [--charged]
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const PORT = (process.argv.find((a) => a.startsWith('--port=')) || '').slice(7);   // zorunlu: bu oturumun editör portu (MCP get_status editorUrl); yeniden başlatmada portlar yeniden dağıtılır
if (!/^\d+$/.test(PORT)) { console.error('--port=<editör portu> zorunlu (get_status editorUrl)'); process.exit(2); }
const BASE = 'http://127.0.0.1:' + PORT;
const NAME = 'game_heavy_attack_4', PREVIEW = 'preview_heavy_attack_4_charged';
const st = await (await fetch(BASE + '/api/state')).json();
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (a) => new THREE.Quaternion(...a);
const Ry = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), rad(d));
const Rx = (d) => new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), rad(d));
const Rz = (d) => new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), rad(d));
const eul = (e) => Ry(e[0]).multiply(Rx(e[1])).multiply(Rz(e[2])); // yaw, pitch (+ öne), roll (+ sağa) — dünya
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

// katana tutuşu (prop'a dokunulmaz; hafif kliplerle aynı)
const prop = st.props?.find((p) => p.id === 'katana');
const pr = prop ? prop.rot : [-25.281, -54.674, -2.581];
const Qp = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(pr[0]), rad(pr[1]), rad(pr[2]), 'XYZ'));
const b0 = V(0, 0, 1).applyQuaternion(Qp).normalize();
const fr0 = restDir('RightForeArm', 'RightHand');
const WRIST = 14;
const nW = b0.clone().cross(fr0).normalize();
const Wr = new THREE.Quaternion().setFromAxisAngle(nW, rad(WRIST));
const b1 = b0.clone().applyQuaternion(Wr);

// spline: anahtar [kare, değer, dur?]; dur = 1 → o anahtarda teğet sıfır (bekleme karesi gibi duruşlar)
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (keys[j][2]) return Pj.map(() => 0);
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
const SRC_F = 61;
const L4_NAME = 'game_light_attack_4_v2';                                // Light4 v2 (PR #20; Unity'de game_light_attack_4 adıyla bağlı): kare 13–69 iki elli kavrama
const A4 = clipPose(L4_NAME, SRC_F);
const IDLE_NAME = 'game_katana_idle';                                   // oyundaki kılıç elde idle (PR #17)
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

// ===== zaman çizelgesi v2 (112 kare = 1,87 sn @60): çömelik dönerek atılma (sola 360°, iki adım, ~1 m) + büyük yükselen kesik =====
const LEN = 112, HOLD = 22, HIT = 46, REL = 26;
// gövde segmentleri: pelvis mutlak [yaw, pitch, roll]; omurga artışları kendi yön çerçevesinde (önce eğim, sonra yaw)
const FR = (b, p, r) => Ry(b).multiply(Rx(p)).multiply(Rz(r)).multiply(Ry(-b));
const incr = (base, e) => Ry(e[0]).multiply(FR(base, e[1], e[2]));
const wrap = (a) => ((a + 540) % 360) - 180;
const decomp = (q, base) => { const e = ypr(q.clone().multiply(Ry(base))); return [wrap(e[0] - base), e[1], e[2]]; };
function segs(C) {
  const pel = ypr(C.D.Hips); const q2 = C.D.Spine02.clone().multiply(C.D.Hips.clone().invert()), q1 = C.D.Spine01.clone().multiply(C.D.Spine02.clone().invert()), qc = C.D.Spine.clone().multiply(C.D.Spine01.clone().invert());
  const s2 = decomp(q2, pel[0]), s1 = decomp(q1, pel[0] + s2[0]), ch = decomp(qc, pel[0] + s2[0] + s1[0]);
  const cy = pel[0] + s2[0] + s1[0] + ch[0];
  const qn = C.D.neck.clone().multiply(C.D.Spine.clone().invert()), qh = C.D.Head.clone().multiply(C.D.neck.clone().invert());
  const nk = decomp(qn, cy), hd = decomp(qh, cy + nk[0]);
  return { pel, s2, s1, ch, cy, nk, hd };
}
const S0 = segs(A4), SE = segs(IDLE);
const TY = SE.pel[0];                                                    // hedef yönü = idle pelvis yönü (dönüş sonunda +360)
// pelvis: toplanmada sağa kurulur, bekleme (22), sonra sola tek tur (~1070°/sn), vuruşta hedefi 20° geçer, chiburi'de geri oturur
const PEL = [
  [0, S0.pel], [8, [-4, 20, 1]], [16, [-20, 16, 2]], [HOLD, [-28, 15, 2], 1],
  [25, [-18, 15, 0]], [28, [18, 16, -4]], [31, [68, 16, -6]], [34, [120, 16, -7]], [37, [172, 15, -7]], [40, [225, 15, -7]], [43, [278, 14, -6]],
  [45, [312, 13, -5]], [47, [345, 12, -5]], [49, [366, 11, -4]], [51, [378, 11, -3]], [54, [385, 11, -2]], [58, [387, 11, -2]],
  [66, [386, 10, -1]], [72, [384, 6, -1]], [76, [380, 3, -1]], [80, [373, 5, 1]], [84, [366, 9, 2]], [90, [363, 7, 1]], [LEN - 1, [SE.pel[0] + 360, SE.pel[1], SE.pel[2]]],
].map((k) => (k[0] === 0 || k[0] === LEN - 1 ? k : [k[0], [k[1][0] + TY, k[1][1], k[1][2]], k[2]]));
// göğüs − pelvis yaw ayrımı: dönüşü kalça başlatır (göğüs geride), dönüş sonunda göğüs kesik için yeniden gerilir, sonra kırbaç
const SEP0 = S0.s2[0] + S0.s1[0] + S0.ch[0], SEPE = SE.s2[0] + SE.s1[0] + SE.ch[0];
const SEP = [[0, SEP0], [8, 4], [16, -18], [HOLD, -30, 1], [25, -36], [28, -30], [34, -18], [40, -18], [43, -20], [45, -14], [47, -6], [49, 4], [51, 9], [54, 10], [58, 9],
  [66, 11], [72, 9], [78, 0], [82, -6], [86, -2], [92, 0], [LEN - 1, SEPE]];
const SHARE = { s2: 0.2, s1: 0.35, ch: 0.45 };
const SPP = [[0, [S0.s2[1], S0.s1[1], S0.ch[1]]], [8, [6, 6, 5]], [16, [3, 3, 3]], [HOLD, [3, 3, 3], 1], [28, [3, 3, 3]], [43, [2, 2, 2]], [HIT, [2, 2, 2]], [52, [3, 3, 3]],
  [58, [3, 3, 3]], [64, [2, 2, 2]], [70, [1, 1, 1]], [78, [0, 0, 0]], [84, [2, 3, 3]], [90, [1, 2, 2]], [LEN - 1, [SE.s2[1], SE.s1[1], SE.ch[1]]]];
const SPR = [[0, [S0.s2[2], S0.s1[2], S0.ch[2]]], [8, [2, 3, 3]], [16, [1, 2, 2]], [HOLD, [1, 2, 3], 1], [28, [-1, -1, -2]], [40, [-1, -1, -2]], [HIT, [-1, -1, -2]], [52, [-1, -1, -1]],
  [58, [0, 0, -1]], [70, [0, 0, 0]], [80, [1, 1, 1]], [84, [1, 2, 2]], [90, [0, 1, 1]], [LEN - 1, [SE.s2[2], SE.s1[2], SE.ch[2]]]];
// kalça konumu (başlangıca göre, dünya): geri toplanma → dönerken alçakta ~0,9 m ileri → vuruşta yükselir → chiburi'de arka ayakla öne → idle yüksekliği
const IDLE_DY = IDLE.hipsPos.y - A4.hipsPos.y, IDLE_DX = IDLE.hipsPos.x - A4.hipsPos.x;
const HIPK = [
  [0, [0, 0, 0]], [8, [0, 0.04, -0.03]], [16, [-0.02, 0.06, -0.09]], [HOLD, [-0.02, 0.07, -0.12], 1], [25, [-0.01, 0.06, -0.07]],
  [28, [0.02, 0.06, 0.03]], [31, [0.05, 0.075, 0.15]], [34, [0.07, 0.07, 0.27]], [37, [0.08, 0.045, 0.39]], [40, [0.09, 0.085, 0.52]], [43, [0.08, 0.11, 0.64]],
  [45, [0.07, 0.10, 0.71]], [48, [0.06, 0.075, 0.80]], [51, [0.04, 0.10, 0.88]], [54, [0.03, 0.135, 0.92]], [58, [0.02, 0.15, 0.94]],
  [66, [0.02, 0.16, 0.95]], [72, [0.01, 0.20, 0.97]], [76, [0.0, 0.24, 1.01]], [80, [0.0, 0.25, 1.05]], [84, [0.0, 0.23, 1.08]], [90, [0.0, 0.29, 1.10]],
  [LEN - 1, [IDLE_DX, IDLE_DY, 1.10]],
];
const GAZE = [[12, 6], [HOLD, 4], [40, 4], [44, 3], [48, 11], [53, 6], [60, 3], [70, 2], [84, 8]];   // başın dünya eğimi (+ aşağı)
const hipsAt = (f) => A4.hipsPos.clone().add(V(...spl(HIPK, f)));
// baş: hedefe kilitli; dönüşte göğse göre ±62°'de kalır, sırt hedefe dönünce (kare ~37) 4 karede öbür omuza çevrilir (spotting)
const SPOT = 37;
function bodyAt(f) {
  const r = {};
  r.pel = spl(PEL, f);
  const sep = spl(SEP, f), pp = spl(SPP, f), rr = spl(SPR, f); const b = smooth(f / 8), e = smooth((f - (LEN - 1 - 16)) / 16);
  ['s2', 's1', 'ch'].forEach((k, i) => { r[k] = [(S0[k][0] * (1 - b) + SHARE[k] * sep * b) * (1 - e) + SE[k][0] * e, pp[i], rr[i]]; });
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  const cl = (v) => Math.max(-62, Math.min(62, v)); const sw = sst((f - SPOT + 1) / 6);
  const look = cl(TY - cy) * (1 - sw) + cl(TY + 360 - cy) * sw;
  const tp = r.pel[1] + pp[0] + pp[1] + pp[2], tr = r.pel[2] + rr[0] + rr[1] + rr[2];
  const gz = spl(GAZE, f); const hp = Math.max(-34, Math.min(30, gz - tp));
  const ws = 1 - smooth(f / 10), we = smooth((f - (LEN - 1 - 18)) / 18);
  const nk = [0.45 * look, 0.4 * hp, -0.3 * tr], hd = [0.55 * look, 0.6 * hp, -0.35 * tr];
  r.neck = nk.map((v, i) => v * (1 - ws) + S0.nk[i] * ws).map((v, i) => v * (1 - we) + SE.nk[i] * we);
  r.head = hd.map((v, i) => v * (1 - ws) + S0.hd[i] * ws).map((v, i) => v * (1 - we) + SE.hd[i] * we);
  r.hp = hipsAt(f); r.f = f;
  return r;
}
// toplanmada sıkışma, dönüş başında açılma, adım basışlarında (36, 47) sıkışma, dönüşte içe (sola) yatma, vuruşta "kırbaç" (öne + sağa geri tepme)
const LIFE_F = [[0, 0], [8, 3], [16, 5], [HOLD, 4], [24, 3], [27, -6], [31, -3], [35, 2], [37, 5], [40, 0], [44, 3], [46, 7], [48, 8], [51, 4], [56, 2], [64, 1], [72, 0], [84, 2], [90, 0], [LEN - 1, 0]];
const LIFE_L = [[0, 0], [16, -2], [HOLD, -2], [26, 2], [30, 7], [38, 8], [44, 6], [46, -3], [49, -6], [54, -3], [62, 0], [LEN - 1, 0]];
const springF = (arr, w, z) => { let x = arr[0], v = 0; return arr.map((t) => { v += w * w * (t - x) - 2 * z * w * v; x += v; return x; }); };
const LIFE = (() => {
  const fr = [...Array(LEN + 2).keys()]; const ramp = (f) => smooth(f / 7) * (1 - smooth((f - (LEN - 1 - 14)) / 14));
  const seg = (keys, lag, w, z) => springF(fr.map((f) => spl(keys, Math.max(0, f - lag)) * ramp(f)), w, z);
  const o = { s2: [seg(LIFE_F, 0, 0.9, 0.65), seg(LIFE_L, 0, 0.9, 0.65)], s1: [seg(LIFE_F, 0.8, 0.75, 0.55), seg(LIFE_L, 0.8, 0.75, 0.55)], ch: [seg(LIFE_F, 1.6, 0.65, 0.5), seg(LIFE_L, 1.6, 0.65, 0.5)] };
  const SH = { s2: 0.4, s1: 0.5, ch: 0.5 };
  for (const k of Object.keys(SH)) o[k] = o[k].map((a) => a.map((v) => v * SH[k]));
  const chP = fr.map((f) => o.s2[0][f] + o.s1[0][f] + o.ch[0][f]), chL = fr.map((f) => o.s2[1][f] + o.s1[1][f] + o.ch[1][f]);
  const lagP = springF(chP, 0.42, 0.42), lagL = springF(chL, 0.42, 0.42), lagP2 = springF(chP, 0.33, 0.4), lagL2 = springF(chL, 0.33, 0.4);
  o.neck = [fr.map((f) => 0.35 * (lagP[f] - chP[f])), fr.map((f) => 0.3 * (lagL[f] - chL[f]))];
  o.head = [fr.map((f) => 0.45 * (lagP2[f] - chP[f])), fr.map((f) => 0.35 * (lagL2[f] - chL[f]))];
  return o;
})();
const lifeAt = (f) => { const i = Math.max(0, Math.min(LEN - 1, Math.round(f))); const g = (k) => [LIFE[k][0][i], LIFE[k][1][i]]; return { s2: g('s2'), s1: g('s1'), ch: g('ch'), neck: g('neck'), head: g('head') }; };
const Eb = (yw, pr) => Ry(yw).multiply(Rx(pr[0])).multiply(Rz(-pr[1])).multiply(Ry(-yw));
function spineD(p) {
  const D = {}; const L = lifeAt(p.f ?? 0);
  D.Hips = eul(p.pel);
  let base = p.pel[0];
  D.Spine02 = Eb(base + p.s2[0], L.s2).multiply(incr(base, p.s2)).multiply(D.Hips); base += p.s2[0];
  D.Spine01 = Eb(base + p.s1[0], L.s1).multiply(incr(base, p.s1)).multiply(D.Spine02); base += p.s1[0];
  D.Spine = Eb(base + p.ch[0], L.ch).multiply(incr(base, p.ch)).multiply(D.Spine01); base += p.ch[0];
  D.neck = Eb(base + p.neck[0], L.neck).multiply(incr(base, p.neck)).multiply(D.Spine); base += p.neck[0];
  D.Head = Eb(base + p.head[0], L.head).multiply(incr(base, p.head)).multiply(D.neck);
  return D;
}

// ---- ayaklar: taban noktası (ball) + yaw + topuk eğimi; adımlar ----
const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
const FOOTL = 0.13;
const TOEOFF = { Left: restPos.LeftToeBase.clone().sub(restPos.LeftFoot), Right: restPos.RightToeBase.clone().sub(restPos.RightFoot) };
let ankleSide = 'Left';
const ankleFromBall = (ball, yaw, pitch, side = ankleSide) => ball.clone().sub(TOEOFF[side].clone().applyQuaternion(eul([yaw, Math.max(0, pitch), 0])));
const ballOf = (C, s) => { const e = ypr(C.D[s + 'Foot']); return { yaw: e[0], pitch: e[1], ball: C.pos[s + 'Foot'].clone().add(TOEOFF[s].clone().applyQuaternion(eul([e[0], Math.max(0, e[1]), 0]))) }; };
const foot0 = { Left: ballOf(A4, 'Left'), Right: ballOf(A4, 'Right') };
const hipsEnd = hipsAt(LEN - 1);
const footIdle = {};
for (const s of ['Left', 'Right']) { const b = ballOf(IDLE, s); footIdle[s] = { yaw: b.yaw, pitch: b.pitch, ball: b.ball.clone().sub(IDLE.hipsPos).add(hipsEnd).setY(b.ball.y) }; }
// ayak planı (dönerek atılma): sağ ayak toplanır (6–16) → bekleme (22) → sol ayağın üstünde dönüş, sağ ayak dolanıp önde basar (26–36)
// → sağ ayağın üstünde dönüş, sol ayak dolanıp son yerine basar (38–47, vuruştan hemen önce) → sağ ayak toparlanır (50–60) → chiburi'de idle duruşuna adım (72–84).
// Dolanan ayak, destek ayağının çevresinde kutupsal yayla gider (destek bacağın içinden geçmez); destek ayağı topukta değil taban önünde döner.
const pelYawAt = (f) => spl(PEL, f)[0];
const rightOf = (yw) => V(-Math.cos(rad(yw)), 0, Math.sin(rad(yw)));
const R1 = foot0.Right.ball.clone().add(V(0.02, 0, 0.30));                                     // toplanma adımı
const R2 = (() => { const p = hipsAt(36); const b = p.clone().add(rightOf(pelYawAt(36)).multiplyScalar(0.06)).add(V(0, 0, 0.22)); b.y = foot0.Right.ball.y; return b; })();
const R3 = R2.clone().lerp(footIdle.Right.ball, 0.5); R3.y = R2.y;                               // hikitsuke
const STEP = { Left: [38, 47], Right: [72, 84] };
const DRAG = [50, 60];
function orbit(A, B, P, u) {   // A'dan B'ye P çevresinde, sola dönüş yönünde (açı artar) yay
  const a = A.clone().sub(P), b = B.clone().sub(P); let aa = Math.atan2(a.x, a.z), ab = Math.atan2(b.x, b.z); while (ab < aa) ab += 2 * Math.PI;
  const ra = Math.hypot(a.x, a.z), rb = Math.hypot(b.x, b.z); const t = aa + (ab - aa) * u, rr = ra + (rb - ra) * u;
  return V(P.x + rr * Math.sin(t), A.y + (B.y - A.y) * u, P.z + rr * Math.cos(t));
}
function footAt(s, f) {
  ankleSide = s; const f0 = foot0[s], fi = footIdle[s]; const fiy = fi.yaw + 360;
  let ball, yaw, pitch, ground = true;
  if (s === 'Left') {
    const [sa, sb] = STEP.Left;
    const pivY = (g) => spl([[0, f0.yaw], [HOLD, 0], [26, 0], [30, pelYawAt(30) - 15], [34, pelYawAt(34) - 15], [sa, pelYawAt(sa) - 15]], g);
    if (f <= sa) { ball = f0.ball.clone(); yaw = pivY(f); pitch = spl([[0, f0.pitch], [16, 0], [HOLD, 0, 1], [26, 10], [sa - 2, 12], [sa, 18]], f); }
    else if (f < sb) { const u = sst((f - sa) / (sb - sa)); ball = orbit(f0.ball, fi.ball, R2, u); ball.y += 0.09 * Math.sin(Math.PI * (f - sa) / (sb - sa)); ground = false;
      yaw = pivY(sa) + (fiy - pivY(sa)) * u; pitch = 18 * (1 - u) + 4 * u; }
    else { ball = fi.ball.clone(); yaw = fiy; pitch = spl([[sb, 4], [sb + 2, 0], [LEN - 1, fi.pitch]], f); }
  } else {
    const [sa, sb] = STEP.Right; const T0 = 26, T1 = 36;
    const pivY = (g) => spl([[T1, pelYawAt(T1) - 12], [40, pelYawAt(40) - 12], [44, pelYawAt(44) - 12], [47, pelYawAt(47) - 12], [DRAG[0], pelYawAt(DRAG[0]) - 14], [DRAG[1], fiy - 10]], g);
    if (f <= 6) { ball = f0.ball.clone(); yaw = f0.yaw; pitch = spl([[0, f0.pitch], [6, 26]], f); }
    else if (f < 16) { const u = sst((f - 6) / 10); ball = f0.ball.clone().lerp(R1, u); ball.y += 0.04 * Math.sin(Math.PI * u); ground = false; yaw = f0.yaw + (-5 - f0.yaw) * u; pitch = 26 * (1 - u) + 4 * u; }
    else if (f <= T0) { ball = R1.clone(); yaw = -5; pitch = spl([[16, 4], [HOLD, 3, 1], [T0, 30]], f); }
    else if (f < T1) { const u = sst((f - T0) / (T1 - T0)); ball = orbit(R1, R2, f0.ball.clone().setY(R1.y), u); ball.y += 0.08 * Math.sin(Math.PI * (f - T0) / (T1 - T0)); ground = false;
      yaw = -5 + (pivY(T1) + 5) * u; pitch = 30 * (1 - u) + 10 * u; }
    else if (f <= sa) { const kd = sst((f - DRAG[0]) / (DRAG[1] - DRAG[0])); ball = R2.clone().lerp(R3, kd); yaw = pivY(f);
      pitch = spl([[T1, 10], [44, 12], [47, 30], [DRAG[1], 28], [sa, 26]], f); }
    else if (f < sb) { const u = sst((f - sa) / (sb - sa)); ball = R3.clone().lerp(fi.ball, u); ball.y += 0.07 * Math.sin(Math.PI * (f - sa) / (sb - sa)); ground = false;
      yaw = pivY(sa) + (fiy - pivY(sa)) * u; pitch = 26 * (1 - u) + 4 * u; }
    else { ball = fi.ball.clone(); yaw = fiy; pitch = spl([[sb, 4], [sb + 2, 0], [LEN - 1, fi.pitch]], f); }
  }
  return { ankle: ankleFromBall(ball, yaw, pitch), yaw, pitch, ground };
}

// ===== KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ (light-attack-4 ile aynı) =====
const FINGERS = JSON.parse(fs.readFileSync('C:/AnimRef/animations/katana_run.json', 'utf8')).tracks;
const PP = V(...(prop ? prop.pos : [-0.27084, 0.07551, 0.18772]));
const PSCALE = prop ? prop.scale : 0.92385;
const eW0 = fr0.clone().sub(b1.clone().multiplyScalar(fr0.dot(b1))).normalize();
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
  const SE2 = E.clone().sub(S); const dist = SE2.length(); const u = SE2.divideScalar(dist);
  const bend = deg(u.angleTo(fd)); const hg = hinge(H, bend);
  const v = H.u0.clone().applyQuaternion(hg.clone().invert()), vp = u.clone().applyQuaternion(DF.clone().invert());
  const a = v.clone().sub(f0.clone().multiplyScalar(v.dot(f0))), b = vp.clone().sub(f0.clone().multiplyScalar(vp.dot(f0)));
  const tau = -deg(Math.atan2(a.clone().cross(b).dot(f0), a.dot(b)));
  const DU = DF.clone().multiply(new THREE.Quaternion().setFromAxisAngle(f0, -rad(tau))).multiply(hg.clone().invert());
  return { DF, DU, DH, E, err: dist - A.lu, tau, bend, fd, u, S, PH, wmag: Math.hypot(w[0], w[1]) };
}
function clavD(s, Dsp, c) { const sg = s === 'Right' ? -1 : 1; return Dsp.clone().multiply(Rz(sg * c[0])).multiply(Ry(-sg * c[1])); }
function shoulderAt(s, pos0, Dsh) { return pos0[s + 'Shoulder'].clone().add(V(...by[s + 'Arm'].restP).applyQuaternion(Dsh.clone().multiply(restW[s + 'Shoulder']))); }
const segDist = (a, b, p) => { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return a.clone().add(ab.multiplyScalar(t)).distanceTo(p); };

// gövde (göğüs + leğen elipsleri) + bacaklar (uyluk/baldır kapsülleri, palto payıyla)
function clearance(pos, D) {
  const upF = D.Spine01.clone().invert(); const loF = D.Hips.clone().invert();
  const legs = []; for (const s of ['Left', 'Right']) { legs.push([pos[s + 'UpLeg'], pos[s + 'Leg'], 0.1], [pos[s + 'Leg'], pos[s + 'Foot'], 0.07]); }
  return (pt, r, legsOn = true) => { let best = 9;
    let l = pt.clone().sub(pos.Spine02).applyQuaternion(upF);
    if (l.y > -0.02 && l.y < 0.5) best = Math.min(best, (Math.hypot(l.x / (0.18 + r), l.z / (0.14 + r)) - 1) * 0.17);
    l = pt.clone().sub(pos.Hips).applyQuaternion(loF);
    if (l.y > -0.55 && l.y < 0.12) best = Math.min(best, (Math.hypot(l.x / (0.24 + r), l.z / (0.18 + r)) - 1) * 0.2);
    if (legsOn) for (const [a, b, rr] of legs) best = Math.min(best, segDist(a, b, pt) - rr - r);
    return best; };
}
const GROUND = restPos.LeftToeBase.y - 0.03;

// ---- kılıç yolu (hedef çerçevesi: yaw TY, göğüs eklemine göre; x sol, y yukarı, z ileri). 'c' anahtarları göğüs-yaw çerçevesinde yazılır ----
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const toFrame = (sw, yaw, org) => ({ C: sw.C.clone().sub(org).applyQuaternion(Ry(-yaw)), t: sw.t.clone().applyQuaternion(Ry(-yaw)), e: sw.e.clone().applyQuaternion(Ry(-yaw)) });
const SW0 = toFrame(swordFromHand(A4.D.RightHand, A4.pos.RightHand), TY, A4.pos.Spine), SWI = toFrame(swordFromHand(IDLE.D.RightHand, IDLE.pos.RightHand), TY, IDLE.pos.Spine);
const WR0 = [WRIST * nW.dot(ARM.Right.a1), WRIST * nW.dot(ARM.Right.a2)];                  // tutuşun nötr sağ bileği
// başlangıç serbestlikleri L4[61]'den: sağ/sol bilek salınımı, sol elin kabza etrafındaki açısı γ
const WRS = swingOf('Right', A4.D.RightForeArm.clone().invert().multiply(A4.D.RightHand)), WLS = swingOf('Left', A4.D.LeftForeArm.clone().invert().multiply(A4.D.LeftHand));
const GAM_S = (() => { const sw = swordFromHand(A4.D.RightHand, A4.pos.RightHand); const eL = V(0, 1, 0).applyQuaternion(A4.D.LeftHand.clone().multiply(QH0L));
  const a = sw.e.clone().sub(sw.t.clone().multiplyScalar(sw.e.dot(sw.t))).normalize(), b = eL.clone().sub(sw.t.clone().multiplyScalar(eL.dot(sw.t))).normalize();
  let g = deg(Math.atan2(a.clone().cross(b).dot(sw.t), a.dot(b))); if (g < 0) g += 360; return g; })();
const GAM0 = GAM_S;
const WRI = swingOf('Right', IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand));
const clavOf = (C, s) => { const sg = s === 'Right' ? -1 : 1; const e = new THREE.Euler().setFromQuaternion(C.D.Spine.clone().invert().multiply(C.D[s + 'Shoulder']), 'ZYX'); return [deg(e.z) / sg, -deg(e.y) / sg]; };
const CLS = { R: clavOf(A4, 'Right'), L: clavOf(A4, 'Left') }, CLE = clavOf(IDLE, 'Right');
const X0 = [0, 0, 0, 0, 0, 0, GAM_S, WRS[0], WRS[1], WLS[0], WLS[1], ...CLS.R, ...CLS.L], XE = [0, 0, 0, 0, 0, 0, GAM_S, WRI[0], WRI[1], 0, 0, ...CLE, 0, 0];
console.log('başlangıç: köprücük R/L', CLS.R.map((v) => v.toFixed(1)), CLS.L.map((v) => v.toFixed(1)), 'idle R', CLE.map((v) => v.toFixed(1)), '| γ', GAM_S.toFixed(1), 'sağ bilek', WRS.map((v) => v.toFixed(1)), 'sol bilek', WLS.map((v) => v.toFixed(1)), '| L4[61] göğüs yaw', S0.cy.toFixed(1), 'idle', SE.cy.toFixed(1));
// kesim düzlemi (kiri-age): ileri + sol-yukarı; φ: bıçağın düzlemdeki açısı (0 = ileri, + sol-yukarıya dönüş), kenar artan φ yönünde (önde)
const U2 = V(0.8, 1, 0).normalize(), FW = V(0, 0, 1);
const kg = (phi) => { const c = Math.cos(rad(phi)), s = Math.sin(rad(phi)); return [FW.clone().multiplyScalar(c).add(U2.clone().multiplyScalar(s)).toArray(), FW.clone().multiplyScalar(-s).add(U2.clone().multiplyScalar(c)).toArray()]; };
const SHR = V(-0.19, 0.05, 0);                                               // sağ omuz (göğse göre, yaklaşık)
const autoE = (C, t) => { const h = V(...C).sub(SHR).normalize().add(V(0, 0.5, 0)); const T_ = V(...t).normalize(); return h.sub(T_.clone().multiplyScalar(h.dot(T_))).normalize().toArray(); };
const KSRAW = [
  [0, 'w', SW0.C.toArray(), SW0.t.toArray(), SW0.e.toArray()],
  [8, 'wr', [0.10, -0.42, 0.26], [0.10, -0.58, 0.81], null],                  // doğrulma: eller ortaya
  [16, 'cr', [-0.03, -0.44, 0.20], [-0.47, -0.32, 0.82], [0.72, -0.67, 0.15]],
  [18, 'cr', [-0.07, -0.445, 0.215], [-0.66, -0.28, 0.69], [0.62, -0.73, 0.29]],
  [20, 'cr', [-0.12, -0.44, 0.23], [-0.86, -0.22, 0.45], [0.44, -0.77, 0.46]],     // kılıç sağa-alçağa açılır
  [HOLD, 'cr', [-0.18, -0.42, 0.24], [-0.95, -0.20, 0.18], [0.26, -0.79, 0.56], 1],   // BEKLEME: alçak, kurulu; kılıç sağ yana yatay uzanır (süpürmeye hazır)
  [28, 'cq', [-0.36, -0.33, 0.24], [-0.90, -0.30, 0.30], [0.30, -0.35, 0.88]],        // dönüş: sol el bırakır, kılıç dışarı açılır (göğüs çerçevesi)
  [34, 'cq', [-0.41, -0.28, 0.30], [-0.80, -0.18, 0.57], [0.56, -0.20, 0.80]],        // sağ kol tam uzanır, kılıç sağ-önde yatay
  [40, 'cq', [-0.43, -0.24, 0.32], [-0.74, -0.08, 0.67], [0.66, -0.12, 0.74]],
  [44, 'cq', [-0.44, -0.20, 0.33], [-0.70, -0.02, 0.71], [0.70, -0.08, 0.71]],         // dönüşün son çeyreği: VURUŞ (bıçak sağdan öne süpürür)
  [48, 'cq', [-0.38, -0.24, 0.35], [-0.60, -0.12, 0.79], [0.78, -0.12, 0.61]],
  [52, 'q', [0.02, -0.28, 0.50], [0.22, -0.16, 0.96], [0.96, -0.10, -0.22]],          // dönüş biter: bıçak hedefi gösterir
  [56, 'q', [0.06, -0.28, 0.48], [0.36, -0.18, 0.91], [0.92, -0.10, -0.38]],
  [62, 'q', [0.07, -0.27, 0.47], [0.38, -0.18, 0.91], [0.92, -0.10, -0.40], 1],      // zanshin: alçak duruş, kılıç önde-solda uzanır
  [67, 'q', [0.05, -0.16, 0.38], [0.30, 0.15, 0.94], null],                           // chiburi'ye kalkış
  [75, 'w', [0.04, 0.34, 0.18], [0.2, 0.97, -0.1], null],                    // chiburi: kılıç dikleşir, eller tepeye
  [80, 'q', [-0.14, 0.30, 0.12], [-0.25, 0.93, -0.27], null, 1],             // sağ el başın sağında, bıçak dik (kısa duruş)
  [84, 'q', [-0.22, 0.14, 0.26], [-0.36, 0.62, 0.70], null],                // silkeleme: öne-aşağı, sağda
  [88, 'q', [-0.29, -0.12, 0.31], [-0.42, -0.15, 0.89], null],
  [93, 'q', [-0.32, -0.36, 0.24], [-0.42, -0.48, 0.77], null, 1],           // chiburi sonu: bıçak sağ-önde-aşağıda
  [99, 'q', [-0.29, -0.45, 0.06], [-0.14, -0.36, 0.92], null],              // toparlanma: bıçak idle'daki gibi ileri doğrulur
  [LEN - 1, 'w', SWI.C.toArray(), SWI.t.toArray(), SWI.e.toArray()],
];
// erişim onarımı ('r' iki el, 'q' yalnız sağ el): verilen bıçak yönelimiyle önkollar sabit kabul edilir (nötr bilek), dirsek = el − önkol;
// kabza noktası, dirsek–omuz mesafesi üst kol boyuna eşit olacak biçimde tasarıma en yakın yere taşınır (ardışık küre izdüşümü).
function torsoAt(f) { const p = bodyAt(f); const D = spineD(p); const cur = {}, pos = {};
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? p.hp.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); }
  return { pos, D, S: { Right: shoulderAt('Right', pos, D.Spine), Left: shoulderAt('Left', pos, D.Spine) } }; }
// sol el kavrama açısı hedef eğrisi: toplanmada kabza sağ kalçaya gelirken ~100° döner, kesikten sonra L4/idle kavramasına geri döner
const GTGT = (f) => (f <= 20 ? GAM0 + 80 * smooth((f - 4) / 16) : f <= 24 ? GAM0 + 80 : f <= 48 ? GAM0 + 80 + 20 * smooth((f - 24) / 6) : f <= 66 ? GAM0 + 100 - 50 * smooth((f - 48) / 16) : GAM0);   // bekleme çevresinde (20–24) sabit
const REPAIR = [], GAMK = []; let GPREV = null, BPREV = null;
// arama: bıçak dönmesi β (kenar, ±BMAX) ve sol elin kabza etrafındaki açısı γ (GAM0 ± GMAX); puan = kabza kayması + açı payları
function repairC(f, C, t, e, two, BMAX = 30, GMAX = 100, bd = 0) {
  const T_ = torsoAt(f); const Y = Ry(TY); const org = T_.pos.Spine;
  const Cw = org.clone().add(C.clone().applyQuaternion(Y)); const tw = t.clone().applyQuaternion(Y), ew0 = e.clone().applyQuaternion(Y);
  let best = null;
  for (let be = -BMAX; be <= BMAX; be += 5) for (let ga = two ? GAM0 - GMAX : GAM0; ga <= (two ? GAM0 + GMAX : GAM0); ga += 5) {
    const ew = ew0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tw, rad(be)));
    const DHR = basisQ(tw, ew).multiply(QH0Ri);
    const fdR = R.f0.clone().applyQuaternion(DHR.clone().multiply(wristQ('Right', WR0).invert()));
    const oR = PPpR.clone().applyQuaternion(DHR).negate().sub(fdR.clone().multiplyScalar(ARM.Right.lf));
    let oL = null;
    if (two) { const eL = ew.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tw, rad(ga))); const DHL = basisQ(tw, eL).multiply(QH0Li);
      const fdL = RL.f0.clone().applyQuaternion(DHL); oL = tw.clone().multiplyScalar(DLT).sub(PPpL.clone().applyQuaternion(DHL)).sub(fdL.clone().multiplyScalar(ARM.Left.lf)); }
    const X = Cw.clone();
    for (let it = 0; it < 60; it++) for (const [o, S, L] of [[oR, T_.S.Right, ARM.Right.lu], [oL, T_.S.Left, ARM.Left.lu]]) { if (!o) continue;
      const d = X.clone().add(o).sub(S); const err = d.length() - L; X.sub(d.normalize().multiplyScalar(err * 0.6)); }
    if (two && GPREV && Math.abs(ga - GPREV[1]) > 5 * (f - GPREV[0])) continue;   // γ sürekliliği: ≤5°/kare
    if (BPREV && f <= 50 && f - BPREV[0] <= 6 && Math.abs(bd + be - BPREV[1]) > 14 * (f - BPREV[0])) continue;   // kenar dönmesi (toplam β): ≤14°/kare
    const sc = X.distanceTo(Cw) + 0.002 * Math.abs(be) + 0.0015 * Math.abs(ga - GTGT(f));
    if (!best || sc < best.sc) best = { sc, be, ga, X: X.clone(), ew: ew.clone() };
  }
  REPAIR.push(f + ': β' + (bd + best.be) + ' γ' + best.ga.toFixed(0) + ' kayma ' + (best.X.distanceTo(Cw) * 100).toFixed(0) + ' cm');
  if (two) { GAMK.push([f, best.ga, f === HOLD ? 1 : 0]); GPREV = [f, best.ga]; } BPREV = [f, bd + best.be];
  return { C: best.X.sub(org).applyQuaternion(Y.clone().invert()), e: best.ew.applyQuaternion(Y.clone().invert()) };
}
if (ARGS.includes('--explore')) {
  for (const [f, fr, C, t, eK] of KSRAW.filter((k) => k[1] === 'r' || k[0] === HOLD)) {
    const T_ = torsoAt(f); const Y = Ry(TY); const org = T_.pos.Spine; let tv = V(...t).normalize(), Cv = V(...C); const e0 = V(...(eK || autoE(C, t)));
    if (fr === 'c') { const q = Ry(bodyAt(f).chestYaw - TY); Cv.applyQuaternion(q); tv.applyQuaternion(q); e0.applyQuaternion(q); }
    const tw = tv.clone().applyQuaternion(Y), Cw = org.clone().add(Cv.clone().applyQuaternion(Y));
    e0.applyQuaternion(Y).sub(tw.clone().multiplyScalar(e0.dot(tw))).normalize();
    let best = null; const res = [];
    for (let be = -180; be < 180; be += 15) for (let ga = 150; ga < 360; ga += 15) {
      const ew = e0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tw, rad(be)));
      const DHR = basisQ(tw, ew).multiply(QH0Ri); const fdR = R.f0.clone().applyQuaternion(DHR.clone().multiply(wristQ('Right', WR0).invert()));
      const ER = Cw.clone().sub(PPpR.clone().applyQuaternion(DHR)).sub(fdR.clone().multiplyScalar(ARM.Right.lf));
      const eL = ew.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tw, rad(ga))); const DHL = basisQ(tw, eL).multiply(QH0Li); const fdL = RL.f0.clone().applyQuaternion(DHL);
      const EL = Cw.clone().add(tw.clone().multiplyScalar(DLT)).sub(PPpL.clone().applyQuaternion(DHL)).sub(fdL.clone().multiplyScalar(ARM.Left.lf));
      const r = Math.abs(ER.distanceTo(T_.S.Right) - ARM.Right.lu), l = Math.abs(EL.distanceTo(T_.S.Left) - ARM.Left.lu);
      const sc = r + l + 0.0005 * Math.abs(be); if (!best || sc < best.sc) best = { sc, be, ga, r, l };
      if (be === 0 && Math.abs(ga - GAM0) < 40) res.push('γ' + ga + ' R' + (r * 100).toFixed(0) + ' L' + (l * 100).toFixed(0));
    }
    console.log('kare', f, 'en iyi β', best.be, 'γ', best.ga, 'hata R/L', (best.r * 100).toFixed(1), (best.l * 100).toFixed(1), 'cm | β=0:', res.join(' '));
  }
  process.exit(0);
}
const CR = [16, 48], CK = [];
const KS = KSRAW.map(([f, fr, C, t, e, z, bd = 0]) => {
  let Cv = V(...C), tv = V(...t).normalize(), ev = e ? V(...e) : V(...autoE(C, t));
  if (bd) ev.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(tv, rad(bd)));
  if (fr.includes('c')) { const q = Ry(bodyAt(f).chestYaw - TY); Cv.applyQuaternion(q); tv.applyQuaternion(q); ev.applyQuaternion(q); }
  ev.sub(tv.clone().multiplyScalar(ev.dot(tv))).normalize();
  if (fr.includes('r') || fr.includes('q')) { const rp = repairC(f, Cv, tv, ev, fr.includes('r'), f >= 50 && f < 72 ? 60 : 30, 100, bd); Cv = rp.C; ev = rp.e; }
  if (fr.includes('c') && f >= CR[0] && f <= CR[1]) { const qi = Ry(-(bodyAt(f).chestYaw - TY)); CK.push([f, [...Cv.clone().applyQuaternion(qi).toArray(), ...tv.clone().applyQuaternion(qi).toArray(), ...ev.clone().applyQuaternion(qi).toArray()], z]); }
  return [f, [...Cv.toArray(), ...tv.toArray(), ...ev.toArray()], z];
});
// dönüş boyunca (CR) kılıç göğüs çerçevesinde yazılır ve her kare o karenin göğüs yönüyle dünyaya çevrilir (seyrek anahtarlar arasında kiriş kısalması olmaz)
const KSW = [...KS.filter((k) => k[0] < CR[0] || k[0] > CR[1])];
for (let f = CR[0]; f <= CR[1]; f++) { const c = spl(CK, f); const q = Ry(bodyAt(f).chestYaw - TY);
  KSW.push([f, [...V(c[0], c[1], c[2]).applyQuaternion(q).toArray(), ...V(c[3], c[4], c[5]).applyQuaternion(q).toArray(), ...V(c[6], c[7], c[8]).applyQuaternion(q).toArray()]]); }
KSW.sort((a, b) => a[0] - b[0]);
console.log('erişim onarımı:', REPAIR.join(' | '));
const GAMS = [[0, GAM_S], ...GAMK.sort((a, b) => a[0] - b[0])];
const gamAt = (f) => spl(GAMS, f);
function designAt(f) {
  const r = spl(KSW, f);
  const t = V(r[3], r[4], r[5]).normalize(); const e = V(r[6], r[7], r[8]); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return { C: V(r[0], r[1], r[2]), t, e };
}
const WD = (f) => 1 + 3 * smooth((f - 18) / 3) * (1 - smooth((f - 25) / 2)) + 4 * smooth((f - 40) / 2) * (1 - smooth((f - 52) / 3));   // tasarım ağırlığı (bekleme + vuruş)
const SPD = (f) => (f <= 5 ? 5 : 11);
const TWO = (f) => 1 - smooth((f - REL) / 6);                                // iki el: 0–26 kavrar (toplanma + bekleme), 26–32 sol el bırakır; dönüş tek elle, kılıç dışarıda
const GRIP = TWO;
const ACT = (f) => f >= 42 && f <= 50;

// ---- maliyet ----
const sq = (v) => v * v;
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
    const wm = ik.wmag, wcap = tag === 'L' ? 10.5 : 13.5; c += 0.002 * wm * wm + (wm > wcap ? 12 * sq(wm - wcap) : 0);   // sol: kabzaya oturtma payı
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
    const dg = Math.abs(x[6] - prev[6]); if (dg > 6) c += 2 * sq(dg - 6); }
  { const cap = ACT(ctx.f) ? 8 : 22; for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > cap ? 2 * sq(a - cap) : 0); } }
  if (ctx.prevTau) { for (const [ik, k] of [[ikR, 'R'], [ikL, 'L']]) { if (!ik || ctx.prevTau[k] == null) continue; const d = Math.abs(ik.tau - ctx.prevTau[k]); c += 0.006 * d * d + (d > 10 ? 0.3 * sq(d - 10) : 0); } }
  if (ctx.gam0 != null) { const d = Math.abs(x[6] - ctx.gam0); if (d > 10) c += 3 * sq(d - 10); }   // sol el kavrama açısı planı (onarım anahtarları) izlenir
  if (ctx.prevD) { const lim = SPD(ctx.f);
    for (const [ik, k, H] of [[ikR, 'R', R], [ikL, 'L', RL]]) { if (!ik || !ctx.prevD[k + 'U']) continue;
      for (const [Dn, Dp, ax] of [[ik.DU, ctx.prevD[k + 'U'], H.u0], [ik.DF, ctx.prevD[k + 'F'], H.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
        const tw = Math.abs(twistDeg(dq, ax)); if (tw > 6.5) c += 0.4 * sq(tw - 6.5); if (ctx.f <= 6) { const an = qMag(dq); if (an > lim) c += 0.3 * sq(an - lim); } } } }
  if (ctx.anchor) { const { xa, k } = ctx.anchor; c += k * (3000 * (sq(x[0] - xa[0]) + sq(x[1] - xa[1]) + sq(x[2] - xa[2])) + 0.05 * [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].reduce((a, i) => a + sq(x[i] - xa[i]), 0)); }
  if (g < 1 && ikL) c += (1 - g) * (0.05 * (sq(x[9] - ctx.wf[0]) + sq(x[10] - ctx.wf[1])) + 0.05 * (sq(x[13]) + sq(x[14])));
  if (!full) return c;
  return { c, C, t, e, DHR, DshR, DshL, ikR, ikL, tip, tipY, hc, bc, T, PLg };
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

// ---- sol kol serbest (bırakmadan sonra; chiburi'de sol el sol kalçaya iner, idle duruşuna) ----
const chestD = (f) => spineD(bodyAt(f)).Spine;
const Dc0i = chestD(0).invert(), DcEi = chestD(LEN - 1).invert();
const uL0c = RL.u0.clone().applyQuaternion(A4.D.LeftArm).applyQuaternion(Dc0i), fL0c = RL.f0.clone().applyQuaternion(A4.D.LeftForeArm).applyQuaternion(Dc0i);
const uLEc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcEi), fLEc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcEi);
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
const LU = [[0, uL0c.toArray()], [REL + 2, uL0c.toArray()], [33, [0.55, -0.70, 0.20]], [38, [0.86, -0.26, -0.43]], [41, [0.82, -0.36, -0.30]], [45, [0.45, -0.80, 0.40]], [48, [0.40, -0.82, 0.42]], [53, [0.80, -0.42, -0.42]], [60, [0.62, -0.70, -0.22]], [80, [0.45, -0.85, 0.05]], [92, uLEc.toArray()], [LEN - 1, uLEc.toArray()]];
const LF = [[0, flx(uL0c, fL0c).toArray()], [REL + 2, flx(uL0c, fL0c).toArray()], [33, [0.1, 0.25, 0.96]], [38, [0.2, 0.3, 0.9]], [41, [0.2, 0.3, 0.9]], [45, [-0.6, 0.3, 0.75]], [48, [-0.6, 0.3, 0.75]], [53, [0.2, 0.3, 0.9]], [60, [0.1, 0.2, 0.97]], [80, [0.1, 0.1, 1]], [92, flx(uLEc, fLEc).toArray()], [LEN - 1, flx(uLEc, fLEc).toArray()]];
const BEND_L = [[0, deg(uL0c.angleTo(fL0c))], [REL + 2, deg(uL0c.angleTo(fL0c))], [33, 35], [38, 20], [41, 26], [45, 85], [48, 90], [53, 30], [60, 30], [80, 35], [92, deg(uLEc.angleTo(fLEc))], [LEN - 1, deg(uLEc.angleTo(fLEc))]];
const lcache = {}; const TAUF = { b: 0 };
const tauFree = (f) => TAUF.b * (1 - sst((f - REL) / 22));
function leftFree(f) {
  if (lcache[f]) return lcache[f];
  const Dc = chestD(f); const uc = V(...spl(LU, f)).normalize(), bend = spl(BEND_L, f);
  const fx = V(...spl(LF, f)); fx.sub(uc.clone().multiplyScalar(fx.dot(uc))).normalize();
  const u = uc.clone().applyQuaternion(Dc), hint = uc.clone().multiplyScalar(Math.cos(rad(bend))).add(fx.multiplyScalar(Math.sin(rad(bend)))).applyQuaternion(Dc);
  const hg = hinge(RL, bend);
  let base, acc0;
  if (f === 0) { base = A4.D.LeftArm.clone(); acc0 = 0; }
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

let prevX = null, prevTau = null, prevD = null;
function solve(f) {
  const p = bodyAt(f); const D = spineD(p);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = p.hp.clone();
  p.ground = {};
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s, f);
    p.ground[s] = ft.ground;
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    if (ft.ground && ft.ankle.distanceTo(hipJ) / (L1 + L2) > 0.962) { // yerde bacak erişimi ≤0,962: topuk kalkar (parmak ucu yerde)
      const pp0 = Math.max(0, ft.pitch); const ball = ft.ankle.clone().add(TOEOFF[s].clone().applyQuaternion(eul([ft.yaw, pp0, 0])));
      for (let pt = pp0; pt <= 46; pt += 0.5) { const a = ankleFromBall(ball, ft.yaw, pt, s); ft.ankle = a; ft.pitch = pt; if (a.distanceTo(hipJ) / (L1 + L2) <= 0.962) break; }
    }
    if (!ft.ground) { const dv0 = ft.ankle.clone().sub(hipJ); const r0 = dv0.length() / (L1 + L2); const K0 = 0.945, KW = 0.02;
      if (r0 > K0) ft.ankle = hipJ.clone().add(dv0.multiplyScalar((K0 + KW * Math.tanh((r0 - K0) / KW)) / r0)); }
    let dv = ft.ankle.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    p['reach' + s] = d / (L1 + L2); d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1).applyQuaternion(Ry(ft.yaw - (s === 'Left' ? 5 : -15))).normalize(); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h)); const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    { const fz = V(0, 0, 1), pl = knee.clone().sub(hipJ.clone().add(dir.clone().multiplyScalar(a))).normalize();
      const fr = (x0, x1) => basisQ(x1, pl).multiply(basisQ(x0, fz).invert());
      const kt = sst(Math.min(1, f / 14));
      const td = knee.clone().sub(hipJ).normalize(), sd = ankle.clone().sub(knee).normalize();
      D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), td).slerp(fr(restDir(s + 'UpLeg', s + 'Leg'), td), kt);
      D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), sd).slerp(fr(restDir(s + 'Leg', s + 'Foot'), sd), kt); }
    D[s + 'Foot'] = eul([ft.yaw, ft.pitch, 0]);
    { const cw = ft.ground ? 1 : 0.2; const bend = cw * -Math.min(Math.max(0, ft.pitch), 42) + (1 - cw) * 6;
      D[s + 'ToeBase'] = eul([ft.yaw, ft.pitch + bend, 0]); }
  }
  const fkPos = () => { const cur = {}, pos = {}, out = {}; for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
      cur[b.name] = D[b.name] ? D[b.name].clone().multiply(restW[b.name]) : cur[b.parent].clone().multiply(Q(b.restQ));
      out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]);
      pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, out }; };
  const pos0 = fkPos().pos;
  const lF = leftFree(f);
  const lag = leftFree(f > REL ? Math.max(REL, f - 3) : Math.max(0, f - 3)).fore; let rl = lF.fore.clone().invert().multiply(lag); const ang = qMag(rl);
  rl = new THREE.Quaternion().slerp(rl, ang > 9 ? 9 / ang : 1); const wf = swingOf('Left', rl);
  const SL0 = shoulderAt('Left', pos0, D.Spine);
  const LfP = SL0.clone().add(RL.u0.clone().applyQuaternion(lF.arm).multiplyScalar(ARM.Left.lu)).add(RL.f0.clone().applyQuaternion(lF.fore).multiplyScalar(ARM.Left.lf));
  const LfDH = lF.fore.clone().multiply(wristQ('Left', wf));
  const g = TWO(f);
  const Y = Ry(TY); const des = designAt(f);
  const ctx = { Y, Cd: pos0.Spine.clone().add(des.C.clone().applyQuaternion(Y)), td: des.t.clone().applyQuaternion(Y), ed: des.e.clone().applyQuaternion(Y), pos0, D, g,
    Lf: { P: LfP, DH: LfDH }, meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, wf };
  const kS = 1 - smooth(f / 8), kE = smooth((f - (LEN - 1 - 14)) / 14);
  ctx.wd = WD(f); ctx.f = f; ctx.prevD = prevD; ctx.gam0 = g > 0 ? gamAt(f) : null;
  ctx.soft = 1 - Math.max(kS, kE); ctx.anchor = kS > 0 ? { xa: X0, k: 4 * kS } : kE > 0 ? { xa: XE, k: 4 * kE } : null;
  let x0 = prevX ? prevX.slice() : X0.slice();
  if (g <= 0) { x0[9] = wf[0]; x0[10] = wf[1]; x0[13] = 0; x0[14] = 0; if (ctx.prev) { ctx.prev = ctx.prev.slice(); ctx.prev[9] = wf[0]; ctx.prev[10] = wf[1]; } }
  const opt = optimize(ctx, x0, f === 0 ? 600 : 400);
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true);
  prevD = { RU: r.ikR.DU, RF: r.ikR.DF, LU: r.ikL ? r.ikL.DU : null, LF: r.ikL ? r.ikL.DF : null };
  prevTau = { R: r.ikR.tau, L: r.ikL ? r.ikL.tau : null };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  if (r.ikL) { D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
    if (g < 0.95) { const k = smooth(1 - g / 0.95); D.LeftShoulder = r.DshL.clone().slerp(D.Spine, k); D.LeftArm = r.ikL.DU.clone().slerp(lF.arm, k); D.LeftForeArm = r.ikL.DF.clone().slerp(lF.fore, k); D.LeftHand = r.ikL.DH.clone().slerp(LfDH, k); } }
  else { D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH; }
  { // bitiş: kollar göğse göre idle pozuna yakınsar (son harmanın yükü azalır; idle'ın bilek burulması dahil)
    const wI = sst((f - (LEN - 1 - 16)) / 16); if (wI > 0) { const rel = D.Spine.clone().multiply(IDLE.D.Spine.clone().invert());
      for (const sd of ['Right', 'Left']) { let par = D.Spine, parI = IDLE.D.Spine;
        for (const b of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) { const n = sd + b; const cur = D[n] || par; const lc = par.clone().invert().multiply(cur), li = parI.clone().invert().multiply(IDLE.D[n]);
          const nw = par.clone().multiply(lc.slerp(li, wI)); par = nw; parI = IDLE.D[n]; D[n] = nw; } } } }
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.gw = g; p.chest = pos0.Spine;
  p.bladeDir = r.t; p.tip = r.tip; p.tipY = r.tipY;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// sol kolun serbest anahtarları bırakma başındaki (REL) kavrama IK pozuna eşitlenir → bırakmada burulma sıçraması olmaz.
// REL'e kadar sol el kabzada (g = 1), serbest kol kullanılmaz: tek geçişte REL karesinde yakalanır, önbellek temizlenir.
function captureRelease(r) {
  const ikc = r.p.r.ikL;
  const ik = r.p.r.ikL; const Di = chestD(REL).invert(); const uc = ik.u.clone().applyQuaternion(Di), fc = ik.fd.clone().applyQuaternion(Di);
  const setK = (arr, f, v) => { const i = arr.findIndex((k) => k[0] === f); if (i >= 0) arr[i] = [f, v]; else { arr.push([f, v]); arr.sort((x, y) => x[0] - y[0]); } };
  TAUF.b = ik.tau; console.log('serbest sol önkol pronasyonu (bırakma başı):', TAUF.b.toFixed(0));
  for (const fk of [0, REL + 2]) { setK(LU, fk, uc.toArray()); setK(LF, fk, flx(uc, fc).toArray()); setK(BEND_L, fk, ik.bend); }
  for (const k of Object.keys(lcache)) delete lcache[k];
  lcache[REL] = { arm: r.D.LeftArm.clone(), fore: r.D.LeftForeArm.clone(), acc: 0, bend: ikc.bend, fixed: true };
}
const outs = []; const diag = []; const hand = [];
const t0run = Date.now();
for (let f = 0; f < LEN; f++) {
  const r = solve(f); outs.push(r); if (f === REL) captureRelease(r);
  if (f % 10 === 0) process.stderr.write('kare ' + f + ' ' + ((Date.now() - t0run) / 1000).toFixed(0) + ' sn\n');
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL?.err, tauR: R_.ikR.tau, tauL: R_.ikL?.tau, bendR: R_.ikR.bend, bendL: R_.ikL?.bend, wR: R_.ikR.wmag, wL: R_.ikL?.wmag,
    clr: R_.T, bc: R_.bc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reachLeft, r.p.reachRight], ground: r.p.ground, gw: r.p.gw, cy: r.p.chestYaw, pel: r.p.pel[0] });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'g', d.gw.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', d.errL != null ? (d.errL * 1000).toFixed(1) : '-', 'wR', d.wR.toFixed(1), 'wL', d.wL?.toFixed(1) ?? '-', 'τR', d.tauR.toFixed(0), 'τL', d.tauL?.toFixed(0) ?? '-',
  'bR', d.bendR.toFixed(0), 'bL', d.bendL?.toFixed(0) ?? '-', 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2), 'reach', d.reach.map((v) => v.toFixed(2)).join('/'), 'cy', (d.cy - TY).toFixed(0), 'pel', (d.pel - TY).toFixed(0));

// ---- sol el parmakları: serbest (yaylı) ↔ kavrama (katana_run sol eli), GRIP ağırlığıyla ----
const FLEX = { Index: [16, 26, 10], Middle: [20, 32, 12], Ring: [25, 36, 14], Pinky: [30, 38, 15] };
const JW = [1, 0.6, 0.35];
const SPRF = { Thumb: [0.6, 0.42], Index: [0.62, 0.34], Middle: [0.56, 0.32], Ring: [0.5, 0.3], Pinky: [0.44, 0.28] };
const PHs = { Thumb: 0.3, Index: 0, Middle: 0.7, Ring: 1.4, Pinky: 2.1 };
const spd = hand.map((h, f) => (f ? h.L.distanceTo(hand[f - 1].L) : 0)); const vmax = Math.max(0.02, ...spd);
const sec = {};
for (const kind of Object.keys(SPRF)) {
  const [w, z] = SPRF[kind]; let x = 0, v = 0; sec[kind] = [];
  for (let f = 0; f < LEN; f++) { v += -w * w * (x + 11 * spd[f] / vmax * (1 - GRIP(f))) - 2 * z * w * v; x += v; sec[kind].push(x + 1.5 * Math.sin(2 * Math.PI * f / 44 + PHs[kind]) * (1 - GRIP(f))); }
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
for (const n of Object.keys(curl)) { const gq = A4.local[n] ? A4.local[n].clone() : Q(FINGERS[n].rot[0].slice(1));   // sol kavrama = L4 v2[61]'deki sol el kavraması
  curl[n] = curl[n].map((q, f) => q.clone().slerp(gq, GRIP(f)).slerp(IDLE.local[n], sst((f - (LEN - 1 - 16)) / 16))); }
Object.assign(fingerOut, curl);

// ---- dikiş (0. kare = L4[61]) ve bitiş (son kare = game_katana_idle[0], yatay kök konumu hariç) ----
const SEAM = 9, ENDB = 18; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
const genAt = (n, f) => (fingerOut[n] ? fingerOut[n][f] : outs[f].out[n]);
const r0 = {}, rE = {}, d0 = {}, dE = {};
for (const n of allNames) { const g0 = genAt(n, 0), gE = genAt(n, LEN - 1);
  r0[n] = g0.clone().invert().multiply(A4.local[n]); d0[n] = qAng(g0, A4.local[n]);
  rE[n] = gE.clone().invert().multiply(IDLE.local[n]); dE[n] = qAng(gE, IDLE.local[n]); }
const h0 = V(...A4.hl).sub(V(...outs[0].hipsLocal));
const hE = V(...IDLE.hl).sub(V(...outs[LEN - 1].hipsLocal)); hE.x = 0; hE.y = 0;
const tracks = {}; const prev = {};
for (let f = 0; f < LEN; f++) {
  const w0 = 1 - smooth(f / SEAM), wE = smooth((f - (LEN - 1 - ENDB)) / ENDB);
  for (const n of allNames) {
    let q = genAt(n, f).clone(); if (w0 > 0) q.multiply(powQ(r0[n], w0)); if (wE > 0) q.multiply(powQ(rE[n], wE));
    if (f === 0) q = A4.local[n].clone();
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  const hp = V(...outs[f].hipsLocal).add(h0.clone().multiplyScalar(w0)).add(hE.clone().multiplyScalar(wE));
  if (f === 0) hp.set(...A4.hl);
  (tracks.Hips.pos ||= []).push([f, hp.x, hp.y, hp.z]);
}

// ---- kol zinciri yumuşatma (iki elli bölüm; çözücünün kareler arası salınımı) + sol eli kabzaya yeniden oturtma ----
const fkT = (f) => { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? Q(tracks[b.name].rot[f].slice(1)) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, cur }; };
const relLH = (f) => { const k = fkT(f); return { p: k.pos.LeftHand.clone().sub(k.pos.RightHand).applyQuaternion(k.cur.RightHand.clone().invert()), q: k.cur.RightHand.clone().invert().multiply(k.cur.LeftHand) }; };
const SA = 4, SB = Math.max(REL, HIT) + 7; const rel0 = []; for (let f = SA; f <= SB; f++) rel0.push(relLH(f));   // vuruş ve sol elin bırakması pencerenin içinde (sınırda kalırsa uç hızında çukur oluşur)
const HOLDZ = (f) => Math.abs(f - HOLD) <= 1;   // bekleme karesi ve komşuları yumuşatılmaz (duruş korunur)
for (let pass = 0; pass < 2; pass++) for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = SA + 2; f <= SB - 2; f++) { if (HOLDZ(f)) continue; const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[f + i - 2]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
    const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
const parentOf = Object.fromEntries(bones.map((b) => [b.name, b.parent]));
const setLocal = (n, f, curW, k) => { const l = k.cur[parentOf[n]].clone().invert().multiply(curW); tracks[n].rot[f] = [f, l.x, l.y, l.z, l.w]; };
for (let f = SA; f <= SB; f++) {
  if (TWO(f) <= 0) continue;
  const k0 = fkT(f), rr0 = rel0[f - SA]; const tp = k0.pos.RightHand.clone().add(rr0.p.clone().applyQuaternion(k0.cur.RightHand)), tq = k0.cur.RightHand.clone().multiply(rr0.q);
  for (let it = 0; it < 6; it++) for (const J of ['LeftArm', 'LeftForeArm']) {
    const k = fkT(f); const pJ = k.pos[J]; const v1 = k.pos.LeftHand.clone().sub(pJ), v2 = tp.clone().sub(pJ); let Rq;
    if (J === 'LeftForeArm') { const ax = RL.n0.clone().applyQuaternion(k.cur[J].clone().multiply(restW[J].clone().invert())).normalize();
      const a1 = v1.clone().sub(ax.clone().multiplyScalar(v1.dot(ax))), a2 = v2.clone().sub(ax.clone().multiplyScalar(v2.dot(ax)));
      Rq = new THREE.Quaternion().setFromAxisAngle(ax, Math.atan2(a1.clone().cross(a2).dot(ax), a1.dot(a2))); }
    else Rq = new THREE.Quaternion().setFromUnitVectors(v1.normalize(), v2.normalize());
    setLocal(J, f, Rq.multiply(k.cur[J]), k); }
  setLocal('LeftHand', f, tq, fkT(f));
}
{ let dm = 0, am = 0; for (let f = SA; f <= SB; f++) { if (TWO(f) <= 0) continue; const r = relLH(f), rr0 = rel0[f - SA]; dm = Math.max(dm, r.p.distanceTo(rr0.p)); am = Math.max(am, qAng(r.q, rr0.q)); }
  console.log('kol yumuşatma: sol elin sağ ele göre kayması max', (dm * 100).toFixed(2), 'cm,', am.toFixed(1), '°'); }

// ---- rapor (son izlerden FK) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − L4[61] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − idle[0] (sonda söner):', top(dE));
const seam = (C, fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = C.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(keyAt(t.rot, fa).slice(1)), qOf(n, fb)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seam(A4, A4.F, 0), [e0, e0n] = seam(IDLE, 0, LEN - 1);
console.log(`dikiş: L4[61]→H4[0] max ${s0.toFixed(3)}° (${s0n}), kalça ${(V(...tracks.Hips.pos[0].slice(1)).distanceTo(V(...A4.hl)) * 1000).toFixed(2)} mm | H4[son]↔idle[0] max ${e0.toFixed(3)}° (${e0n}), kalça yükseklik ${((tracks.Hips.pos[LEN - 1][3] - IDLE.hl[2]) * 100).toFixed(2)} cm`);
{ // L4[61]→[62] ile H4[0]→[1] hız farkı (dikişte hız sürekliliği)
  const L4n = clipPose(L4_NAME, SRC_F + 1); let m = 0, mn = '';
  for (const n of allNames) { const t = A4.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(A4.local[n], L4n.local[n]), b = qAng(qOf(n, 0), qOf(n, 1)); if (Math.abs(a - b) > m) { m = Math.abs(a - b); mn = n; } }
  console.log('dikiş hız farkı (°/kare, L4[61→62] vs H4[0→1]) max', m.toFixed(2), mn); }
console.log('ilk kareler (max kemik °/kare):', [1, 2, 3, 4, 5, 6, 8, 10].map((f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mn = n; } } return f + ':' + m.toFixed(1) + ' ' + mn; }).join(', '));
console.log('bekleme karesi çevresi (max kemik °/kare):', [HOLD - 2, HOLD - 1, HOLD, HOLD + 1, HOLD + 2, HOLD + 3].map((f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mn = n; } } return f + ':' + m.toFixed(1) + ' ' + mn; }).join(', '));
const FF = []; for (let f = 0; f < LEN; f++) { const k = fkT(f); const Dd = {}; for (const n of Object.keys(k.cur)) Dd[n] = k.cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos: k.pos, D: Dd }); }
// bıçak: son izlerden (sağ el + prop)
const blade = FF.map((F) => { const sw = swordFromHand(F.D.RightHand, F.pos.RightHand); const tip = sw.C.clone().add(sw.t.clone().multiplyScalar(HALF - SR)); return { ...sw, tip }; });
const palm = (s) => { const n = V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize(); return n; };
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: ang, flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };   // toplam = el ekseninin açısı (HeroWristAudit gibi; burulma ayrı)
const WSTAT = {};
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  WSTAT[s] = { flex: mx('flex'), dev: mx('dev'), tot: mx('tot'), tw: mx('tw') };
  console.log(s, 'bilek: fleksiyon max', WSTAT[s].flex[0].toFixed(1) + '° (kare ' + WSTAT[s].flex[1] + ')', '| sapma max', WSTAT[s].dev[0].toFixed(1) + '° (kare ' + WSTAT[s].dev[1] + ')', '| toplam max', WSTAT[s].tot[0].toFixed(1) + '° (kare ' + WSTAT[s].tot[1] + ')', '| burulma max', WSTAT[s].tw[0].toFixed(1));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
const dd = diag.filter((d) => d.gw > 0);
console.log('β (roll sapması)', rng(diag.map((d) => d.x[5])), '| γ', rng(dd.map((d) => d.x[6])), '| dirsek R', rng(diag.map((d) => d.bendR)), 'L', rng(dd.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), 'L', rng(dd.map((d) => d.tauL)), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°',
  '| erişim hatası max R/L', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), '/', (Math.max(...diag.filter((d) => d.errL != null).map((d) => Math.abs(d.errL) * d.gw)) * 1000).toFixed(1), 'mm');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
if (ARGS.includes('--lstep')) console.log('sol kol kare adımları (LeftArm/LeftForeArm/LeftHand °/kare, sol bilek burulma):', [...Array(LEN).keys()].slice(46).map((f) => f + ':' + ['LeftArm', 'LeftForeArm', 'LeftHand'].map((n) => (f ? qAng(qOf(n, f), qOf(n, f - 1)) : 0).toFixed(0)).join('/') + '/' + wristStat('Left', f).tw.toFixed(0)).join(' '));
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Hips', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg'].map((n) => n + ' ' + rotStep(n)).join(', '));
const cl = {}; for (const d of diag) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): kol-gövde/bacak', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde/bacak', Math.min(...diag.map((d) => d.bc)).toFixed(3), '(kare', diag.reduce((a, d) => (d.bc < a.bc ? d : a)).f + ') | bıçak-kafa', Math.min(...diag.map((d) => d.hc)).toFixed(3), '(kare', diag.reduce((a, d) => (d.hc < a.hc ? d : a)).f + ') | uç-yer', Math.min(...diag.map((d) => d.tipY)).toFixed(3), '(kare', diag.reduce((a, d) => (d.tipY < a.tipY ? d : a)).f + ')');
const F_ = [...Array(LEN).keys()];
const tipSp = F_.map((f) => (f ? blade[f].tip.distanceTo(blade[f - 1].tip) * 60 : 0));
const vpk = Math.max(...tipSp), fpk = tipSp.indexOf(vpk); let ha = fpk, hb = fpk; while (ha > 1 && tipSp[ha - 1] >= 0.55 * vpk) ha--; while (hb < LEN - 1 && tipSp[hb + 1] >= 0.55 * vpk) hb++;
console.log('bıçak ucu hızı (m/s):', F_.slice(30, 58).map((f) => f + ':' + tipSp[f].toFixed(1)).join(' '), '| tepe', vpk.toFixed(1), 'm/s kare', fpk, '| ≥%55 pencere', ha + '–' + hb, '| chiburi tepe', Math.max(...tipSp.slice(66)).toFixed(1), 'kare', tipSp.indexOf(Math.max(...tipSp.slice(66))));
const angSp = F_.map((f) => (f ? deg(blade[f].t.angleTo(blade[f - 1].t)) * 60 : 0)); console.log('bıçak açısal hız tepe', Math.max(...angSp.slice(30, 60)).toFixed(0), '°/sn');
{ // kenar önde: etkin karelerde kenar ile ucun bıçağa dik hızı arası açı
  const hs = []; for (let f = Math.max(1, ha); f <= hb; f++) { const v = blade[f].tip.clone().sub(blade[f - 1].tip); const t = blade[f].t; v.sub(t.clone().multiplyScalar(v.dot(t))); hs.push(deg(v.angleTo(blade[f].e))); }
  console.log('kenar hizası (etkin kareler, 0° = ideal):', hs.map((v) => v.toFixed(0)).join(' ')); }
const hy = F_.map((f) => FF[f].pos.Hips.y - restPos.Hips.y), hz = F_.map((f) => FF[f].pos.Hips.z);
console.log('kök: kalça ileri', ((hz[LEN - 1] - hz[0]) * 100).toFixed(1), 'cm | bekleme', ((hz[HOLD] - hz[0]) * 100).toFixed(1), 'cm, vuruş sonu (52)', ((hz[52] - hz[0]) * 100).toFixed(1), 'cm | kalça yüksekliği 0/32/43/52/80/son', [0, HOLD, HIT, 52, 80, LEN - 1].map((f) => (hy[f] * 100).toFixed(0)).join('/'), 'cm');
console.log('bacak erişimi (yerdeki ayak) max', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3), '| ayaklar havada: sol', F_.filter((f) => !diag[f].ground.Left).join(','), 'sağ', F_.filter((f) => !diag[f].ground.Right).join(','));
{ // yerdeki ayak kayması (ball noktası)
  const slip = (s) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { if (!diag[f].ground[s] || !diag[f - 1].ground[s]) continue; if (s === 'Right' && f > DRAG[0] && f <= DRAG[1]) continue;
    const a = FF[f].pos[s + 'ToeBase'], b = FF[f - 1].pos[s + 'ToeBase']; const d = Math.hypot(a.x - b.x, a.z - b.z); if (d > m) { m = d; mf = f; } } return (m * 1000).toFixed(1) + ' mm (k' + mf + ')'; };
  console.log('yerdeki ayak parmağı kayması max/kare: sol', slip('Left'), 'sağ', slip('Right')); }
{ const f = HOLD, P = FF[f].pos; const rel = (v) => v.clone().sub(P.Hips).applyQuaternion(Ry(-TY));
  console.log('bekleme karesi', f, ': sağ el', rel(P.RightHand).toArray().map((x) => x.toFixed(2)), 'sol el', rel(P.LeftHand).toArray().map((x) => x.toFixed(2)), 'uç', rel(blade[f].tip).toArray().map((x) => x.toFixed(2)), 'uç-yer', (blade[f].tip.y - GROUND).toFixed(2), '| sol ayak', rel(P.LeftFoot).toArray().map((x) => x.toFixed(2)), 'sağ ayak', rel(P.RightFoot).toArray().map((x) => x.toFixed(2)), '| göğüs yaw', (diag[f].cy - TY).toFixed(0), 'pelvis', (diag[f].pel - TY).toFixed(0)); }

if (ARGS.includes('--keyprobe')) for (const f of [16, 18, 20, HOLD, 24]) { const b = blade[f], org = FF[f].pos.Spine, q = Ry(-bodyAt(f).chestYaw); const v = (x) => x.toArray().map((u) => +u.toFixed(3));
  console.log('gerçekleşen kılıç (göğüs çerçevesi) kare', f, 'C', v(b.C.clone().sub(org).applyQuaternion(q)), 't', v(b.t.clone().applyQuaternion(q)), 'e', v(b.e.clone().applyQuaternion(q))); }
const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
// ---- önizleme: bekleme karesi 0,6 sn tutulur, sonrası 1,3× hızlı (yalnız editör önizlemesi; Unity'ye gitmez) ----
function resample(tr, srcF) { const f0 = Math.floor(srcF), f1 = Math.min(LEN - 1, f0 + 1), u = srcF - f0; const out = {};
  for (const [n, t] of Object.entries(tr)) { const a = Q(t.rot[f0].slice(1)), b = Q(t.rot[f1].slice(1)); if (a.dot(b) < 0) b.set(-b.x, -b.y, -b.z, -b.w); const q = a.slerp(b, u); out[n] = { q };
    if (t.pos) { const p0 = t.pos[f0], p1 = t.pos[f1]; out[n].p = [1, 2, 3].map((i) => p0[i] * (1 - u) + p1[i] * u); } } return out; }
function buildPreview() {
  const frames = []; for (let f = 0; f <= HOLD; f++) frames.push(f);
  for (let k = 0; k < 36; k++) frames.push(HOLD);
  for (let s = HOLD + 1.3; s < LEN - 1; s += 1.3) frames.push(s); frames.push(LEN - 1);
  const tr = {}; frames.forEach((sf, i) => { const r = resample(tracks, sf); for (const [n, v] of Object.entries(r)) { const t = (tr[n] ||= { rot: [] }); const pq = t.rot.length ? Q(t.rot.at(-1).slice(1)) : null; const q = v.q; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    t.rot.push([i, q.x, q.y, q.z, q.w]); if (v.p) (t.pos ||= []).push([i, ...v.p]); } });
  return { name: PREVIEW, fps: 60, length: frames.length, loop: false, tracks: tr };
}
const preview = buildPreview();
console.log('önizleme', PREVIEW, ':', preview.length, 'kare (', (preview.length / 60).toFixed(2), 'sn; bekleme', HOLD, '→', HOLD + 36, ')');
fs.writeFileSync('C:/AnimRef/tools/.heavy4_last.json', JSON.stringify({ blade: blade.map((b) => ({ tip: b.tip.toArray(), C: b.C.toArray() })), hips: FF.map((F) => F.pos.Hips.toArray()), WSTAT, hit: [ha, hb, fpk] }));
if (!NOSEND) {
  const load = async (a) => (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim: a }) })).json();
  const save = async (a) => (await fetch(BASE + '/api/animations/save?name=' + a.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })).json();
  if (!ARGS.includes('--nosave')) { console.log('kaydedildi', await save(anim), await save(preview)); }
  if (ARGS.includes('--l4h4')) { // L4 (0–60) + H4 art arda: yalnız editöre yüklenir, kaydedilmez
    const L = JSON.parse(fs.readFileSync('C:/AnimRef/animations/' + L4_NAME + '.json', 'utf8')); const tr = {};
    for (const n of Object.keys(tracks)) { const src = L.tracks[n]; tr[n] = { rot: [] }; for (let f = 0; f < SRC_F; f++) { const k = src && src.rot && src.rot.length ? keyAt(src.rot, f) : null; const q = k ? k.slice(1) : by[n].restQ; tr[n].rot.push([f, ...q]); }
      for (const k of tracks[n].rot) tr[n].rot.push([k[0] + SRC_F, ...k.slice(1)]);
      if (tracks[n].pos) { tr[n].pos = []; for (let f = 0; f < SRC_F; f++) tr[n].pos.push([f, ...keyAt(src.pos, f).slice(1)]); for (const k of tracks[n].pos) tr[n].pos.push([k[0] + SRC_F, ...k.slice(1)]); } }
    console.log('L4→H4 yüklendi', await load({ name: 'onizleme_L4_H4', fps: 60, length: SRC_F + LEN, loop: true, tracks: tr }));
  } else if (ARGS.includes('--charged')) console.log('önizleme yüklendi', await load(preview));
  else console.log(BASE + ' yüklendi', await load(anim));
}
