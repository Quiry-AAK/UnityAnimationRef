// game_heavy_attack_3 üretici: AĞIR H3 "yere düşürme" — 3. hafif vuruştan (L3[49]) ağır tuşla dallanır; 0. kare = L3'ün son karesi.
// Yön (kullanıcı kararı): SOLDAN SAĞA yerden süpürme — L3 kılıcı solda bırakır, H3 oradan keser (geri çekmez).
// Kavrama modelinde kenar dirseğin karşısındadır (bilek ≤14°): bıçak yatayken soldan sağa kenar öne dönmüyor (sağ önkol ~90° fazla
// pronasyon); bıçak dik aşağı (eğim ~−55°, orak gibi), eller bel hizasında ve temasta ortanın sağında, göğüs temasta hâlâ sola dönükken
// (backhand) kenar sağa-aşağı ~40° sapmayla öne gelir — uç yerden ~15–20 cm yüksekte yatay süpürür (kahin taraması: heavy3 notları).
// Hazırlık (0–24): kılıç L3 sonundan solda aşağı sarkar (uç sola-aşağı, yere yakın), sol el kabzaya (sağ elin pommel tarafı, 9 cm) gelir;
// sol (ön) ayak öne adım, ön dize derin çöküş, gövde sola kurulur.
// Bekleme karesi (HOLD = 24): iki ayak yerde, tüm kanallar durağan (sıfır hız) — şarjda bu kare donar, vuruş buradan temiz başlar.
// Vuruş (24–46): kalça → göğüs → kollar → kılıç kinetik zinciri; soldan sağa TEK yatay süpürme (uç sabit yükseklikte, eğim/roll sabit),
// temas önde ve tepe hızda (~35), takip sağ yana; ağırlık ön dizde, kalça süpürmeyle biraz daha çöker.
// Toparlanma: kılıç sağ yandan kalkıp öne gelir (idle'ın eli zaten sağ kalça önünde), sol el bırakır, ayaklar toplanır; son kare
// game_katana_idle[0]'a dikişsiz bağlanır (yatay kök konumu hariç).
// Yaklaşım light-attack-4.mjs ile aynı (kılıç-öncelikli çift kol çözücü, bilek ≤14°, dikiş/bitiş harmanı).
// Yalnız bu oturumun editörüne yükler/kaydeder. Çalıştır: node heavy-attack-3.mjs --port=N [--nosend] [--nosave] [--diag] [--l3]
//   --l3: kayıttan sonra editöre L3→H3→idle art arda önizlemeyi yükler (kaydetmez).
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const PORT = process.argv.find((a) => a.startsWith('--port='))?.slice(7);   // yalnız bu oturumun editörü; port oturuma özel, her seferinde MCP get_status → editorUrl
if (!PORT) { console.error('--port=<editör portu> gerekli (MCP get_status → editorUrl)'); process.exit(1); }
const BASE = 'http://127.0.0.1:' + PORT;
const NAME = 'game_heavy_attack_3', PREVIEW = 'preview_heavy_attack_3_charged';
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
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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

// spline: anahtar [kare, değer, 0] → o anahtarda teğet sıfır (durağan kare; bekleme karesi böyle yazılır)
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const [t0, p0] = keys[i], [t1, p1] = keys[i + 1]; const arr = Array.isArray(p0);
  const A = asArr(p0), B = asArr(p1);
  const tan = (j) => { const Pj = asArr(keys[j][1]);
    if (keys[j][2] === 0) return Pj.map(() => 0);
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
const IDLE = clipPose('game_katana_idle', 0);   // oyundaki kılıç elde idle (PR #17); eski fizik idle'ı game_idle_drawn değil

function mkHinge(side) {
  const u0 = restDir(side + 'Arm', side + 'ForeArm'), f0 = restDir(side + 'ForeArm', side + 'Hand');
  const n0 = u0.clone().cross(f0).normalize(); const ang0 = u0.angleTo(f0);
  const test = u0.angleTo(f0.clone().applyQuaternion(new THREE.Quaternion().setFromAxisAngle(n0, 0.1)));
  return { u0, f0, n0, ang0, sgn: test > ang0 ? 1 : -1 };
}
const R = mkHinge('Right'), RL = mkHinge('Left');
R.f0 = fr0;
const hinge = (H, bend) => new THREE.Quaternion().setFromAxisAngle(H.n0, H.sgn * (rad(bend) - H.ang0));

// ---- Zaman çizelgesi (75 kare = 1,25 sn @60) ----
const LEN = 75, HOLD = 24, SEND = 46, PH0 = 137;   // PH0: mikro hareket fazı 1→2→3 zincirinden sürer (L4 ile aynı)
const GRIP_IN = 20, GRIP_OUT = 52;                  // iki el: 8–20 kavrar (kılıç bekleme yönüne yaklaşınca), 52–68 bırakır
const yStart = A3.hipsPos.y - restPos.Hips.y, zStart = A3.hipsPos.z - restPos.Hips.z, xStart = A3.hipsPos.x - restPos.Hips.x;
const IDLE_Y = IDLE.hipsPos.y - restPos.Hips.y;
const ZH = zStart + 0.25, ZE = zStart + 0.29;       // adımla öne (bekleme), vuruşta ön dize biniş
// kalça: hazırlığa küçük yükselmeyle (yükü boşaltma) girer, bekleme derinliğini hafif aşıp oturur (yay kurulur); temasta ağırlık
// kesiğe düşer, kısa sekme; toparlanmada kalkış sonunda küçük oturma
const HK = {
  y: [[0, yStart], [3, yStart + 0.012], [9, -0.37], [17, -0.452], [HOLD, -0.44, 0], [30, -0.455], [35, -0.48], [39, -0.488], [43, -0.462], [SEND, -0.468, 0], [52, -0.4], [58, -0.24], [66, -0.07], [70, -0.035], [LEN - 1, IDLE_Y, 0]],
  z: [[0, zStart], [4, zStart + 0.015], [15, ZH - 0.025], [HOLD, ZH, 0], [35, ZE], [SEND, ZE, 0], [LEN - 1, ZE, 0]],
  x: [[0, xStart], [HOLD, 0.06, 0], [35, 0.02], [41, -0.03], [SEND, -0.04, 0], [LEN - 1, 0, 0]],   // takipte ağırlık sağa taşınır
};
const hipsAt = (f) => V(spl(HK.x, f), spl(HK.y, f), spl(HK.z, f));

// ---- gövde: pelvis/göğüs yaw (kinetik zincir), eğilme/yan eğilme anahtarları ----
const inc = (C, c, p) => ypr(C.D[c].clone().multiply(C.D[p].clone().invert()));
const S0 = { pel: ypr(A3.D.Hips), s2: inc(A3, 'Spine02', 'Hips'), s1: inc(A3, 'Spine01', 'Spine02'), ch: inc(A3, 'Spine', 'Spine01') };
{ const g = PH0; S0.ch[1] -= 0.9 * Math.sin(2 * Math.PI * g / 44); S0.s1[1] -= 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6); S0.pel[2] -= 0.8 * Math.sin(g * 0.11); }
const SE = { pel: ypr(IDLE.D.Hips), s2: inc(IDLE, 'Spine02', 'Hips'), s1: inc(IDLE, 'Spine01', 'Spine02'), ch: inc(IDLE, 'Spine', 'Spine01') };
const CY0 = S0.pel[0] + S0.s2[0] + S0.s1[0] + S0.ch[0], CYI = SE.pel[0] + SE.s2[0] + SE.s1[0] + SE.ch[0];
const PEL_H = 60, PEL_F = -30, CH_H = 90, CH_F = -55;
// takip aşması: kılıcın momentumu gövdeyi hedefin ötesine taşır, sonra geri oturur (sin² çan: uçlarda değer ve hız sıfır)
const bump = (f, a, b) => { const u = (f - a) / (b - a); return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2; };
const pelYawAt = (f) => {
  if (f <= HOLD) return spl([[0, S0.pel[0]], [10, 56], [HOLD, PEL_H, 0]], f);   // sola kurulma (L3'ün dönüşü sürer)
  if (f <= SEND) return PEL_H + (PEL_F - PEL_H) * sst((f - HOLD) / 14) - 7 * bump(f, 33, 46);   // kalça önde
  return spl([[SEND, PEL_F, 0], [60, -10], [LEN - 1, SE.pel[0], 0]], f);
};
const chestYawAt = (f) => {
  if (f <= HOLD) return spl([[0, CY0], [10, 86], [HOLD, CH_H, 0]], f);
  if (f <= SEND) return CH_H + (CH_F - CH_H) * sst((f - HOLD - 1) / 16) - 12 * bump(f, 36, 46);   // göğüs ~1 kare geride, temasta açılmış
  return spl([[SEND, CH_F, 0], [60, -18], [LEN - 1, CYI, 0]], f);
};
// eğilme (pitch, + öne) ve yan eğilme (roll, + sağa): [pel, s2, s1, ch] her biri [pitch, roll]
const T = { start: 0, sink: 8, hold: HOLD, drive: 29, hit: 35, follow: 41, send: SEND, rise: 60, rest: LEN - 1 };
const P = {
  start: { pel: S0.pel.slice(1), s2: S0.s2.slice(1), s1: S0.s1.slice(1), ch: S0.ch.slice(1) },
  sink:  { pel: [16, -3], s2: [4, -1], s1: [4, -1], ch: [3, -1] },
  hold:  { pel: [22, -4], s2: [4, -2], s1: [4, -2], ch: [4, -2] },          // gövde ~34° öne, sola hafif yatık (kılıç sol altta)
  drive: { pel: [24, -2], s2: [5, -1], s1: [5, -1], ch: [4, -1] },
  hit:   { pel: [27, 1], s2: [6, 1], s1: [6, 1], ch: [6, 1] },              // temas: göğüs ~45° öne, bakış yerde
  follow:{ pel: [25, 3], s2: [6, 2], s1: [5, 2], ch: [4, 2] },
  send:  { pel: [22, 3], s2: [4, 1], s1: [4, 1], ch: [3, 1] },
  rise:  { pel: [8, 1], s2: [2, 0], s1: [2, 0], ch: [1, 0] },
  rest:  { pel: SE.pel.slice(1), s2: SE.s2.slice(1), s1: SE.s1.slice(1), ch: SE.ch.slice(1) },
};
const names = Object.keys(T);
const ZT = new Set(['hold', 'send']);   // durağan anahtarlar
const startNeck = ypr(A3.D.neck.clone().multiply(A3.D.Spine.clone().invert())), startHead = ypr(A3.D.Head.clone().multiply(A3.D.neck.clone().invert()));
const idleNeck = ypr(IDLE.D.neck.clone().multiply(IDLE.D.Spine.clone().invert())), idleHead = ypr(IDLE.D.Head.clone().multiply(IDLE.D.neck.clone().invert()));
const HPITCH = [[0, 0], [HOLD, 8, 0], [30, 13], [36, 16], [SEND, 11, 0], [60, 3], [LEN - 1, 0, 0]];   // bakış hedefin ayaklarına iner
// ---- canlılık katmanı (L4 ile aynı yöntem): gövde çerçevesinde omurga fleksiyonu (+ öne) / yan eğilme (+ sola); kinetik zincir
// pelvis → Spine02 → Spine01 → Spine → boyun → baş (kademeli gecikme + yay). Hazırlık: sıkışma, kılıç tarafına (sola) yatma; itiş: açılma;
// temas: fleksiyon "çatlaması"; takip: kılıcın ağırlığı gövdeyi sağa çeker, sönümlenir. Bekleme karesi sonradan durağanlaştırılır.
const LIFE_F = [[0, 0], [6, 3], [14, 8], [20, 10], [HOLD, 9], [28, 3], [31, -3], [35, 7], [38, 11], [42, 7], [47, 3], [52, 5], [60, 2], [LEN - 1, 0]];
const LIFE_L = [[0, 0], [10, 4], [20, 7], [HOLD, 7], [29, 3], [33, -2], [37, -8], [41, -11], [45, -7], [51, -3], [62, -1], [LEN - 1, 0]];
const springF = (arr, w, z) => { let x = arr[0], v = 0; return arr.map((t) => { v += w * w * (t - x) - 2 * z * w * v; x += v; return x; }); };
const LIFE = (() => {
  const fr = [...Array(LEN + 2).keys()]; const ramp = (f) => smooth(f / 7);
  const seg = (keys, lag, w, z) => springF(fr.map((f) => spl(keys, Math.max(0, f - lag)) * ramp(f)), w, z);
  const o = { s2: [seg(LIFE_F, 0, 0.9, 0.65), seg(LIFE_L, 0, 0.9, 0.65)], s1: [seg(LIFE_F, 0.8, 0.75, 0.55), seg(LIFE_L, 0.8, 0.75, 0.55)], ch: [seg(LIFE_F, 1.6, 0.65, 0.5), seg(LIFE_L, 1.6, 0.65, 0.5)] };
  const SH = { s2: 0.4, s1: 0.5, ch: 0.5 };   // toplam ×1,4
  for (const k of Object.keys(SH)) o[k] = o[k].map((a) => a.map((v) => v * SH[k]));
  // boyun/baş: göğüs hareketinin gecikmeli takibi (sürüklenme + küçük aşma); vuruşta bakış hedefte sabitlenir
  const chP = fr.map((f) => o.s2[0][f] + o.s1[0][f] + o.ch[0][f]), chL = fr.map((f) => o.s2[1][f] + o.s1[1][f] + o.ch[1][f]);
  const lagP = springF(chP, 0.42, 0.42), lagL = springF(chL, 0.42, 0.42);
  o.neck = [fr.map((f) => 0.35 * (lagP[f] - chP[f])), fr.map((f) => 0.3 * (lagL[f] - chL[f]))];
  const lagP2 = springF(chP, 0.33, 0.4), lagL2 = springF(chL, 0.33, 0.4);
  const gz = (f) => smooth((f - HOLD + 4) / 6) * (1 - smooth((f - 50) / 10));
  o.neck[0] = o.neck[0].map((v, f) => v - 0.3 * chP[f] * gz(f));
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
  const r = {};
  for (const k of ['pel', 's2', 's1', 'ch']) r[k] = [0, ...spl(names.map((n) => (ZT.has(n) ? [T[n], P[n][k], 0] : [T[n], P[n][k]])), f)];
  const g = f + PH0; r.ch[1] += 0.9 * Math.sin(2 * Math.PI * g / 44); r.s1[1] += 0.5 * Math.sin(2 * Math.PI * g / 44 + 0.6); r.pel[2] += 0.8 * Math.sin(g * 0.11);
  // yaw: pelvis + göğüs–pelvis ayrımı σ, omurgada aşağıdan yukarı paylaşım (0,2/0,35/0,45); başta L3'ün dağılımından, sonda idle'ınkine harman
  const pY = pelYawAt(f), sg = chestYawAt(f) - pY, b = smooth(f / 10), e = smooth((f - 56) / 16);
  r.pel[0] = pY;
  for (const [k, w] of [['s2', 0.2], ['s1', 0.35], ['ch', 0.45]]) r[k][0] = (S0[k][0] * (1 - b) + w * sg * b) * (1 - e) + SE[k][0] * e;
  const cy = r.pel[0] + r.s2[0] + r.s1[0] + r.ch[0]; r.chestYaw = cy;
  // baş: hedefe (dünya yaw 0) bakar, göğse göre ±55° içinde; boyun payı böler
  const spot = clamp(0 - cy, -55, 55);
  const ws = 1 - smooth(f / 9), we = smooth((f - 56) / 16);
  const incY = spot * (1 - we) + (idleNeck[0] + idleHead[0]) * we;
  const hp = spl(HPITCH, f);
  r.neck = [incY * 0.45 * (1 - ws) + startNeck[0] * ws, hp * 0.4 * (1 - ws) + startNeck[1] * ws, (-0.3 * r.pel[2]) * (1 - ws) + startNeck[2] * ws];
  r.head = [incY * 0.55 * (1 - ws) + startHead[0] * ws, hp * 0.6 * (1 - ws) + startHead[1] * ws, (-0.4 * r.pel[2] + 0.8 * Math.sin(g * 0.09 + 1)) * (1 - ws) + startHead[2] * ws];
  r.hp = hipsAt(f).toArray();
  return r;
}

// ---- ayaklar: taban sabit; sol öne adım (2–14), vuruşta iki ayak top üstünde pivot (sağ topuk kalkar), toparlanmada idle duruşuna ----
const FOOTL = 0.13;
const ankleFromBall = (ball, yaw, pitch) => ball.clone().add(V(0, FOOTL * Math.sin(rad(Math.max(0, pitch))), -FOOTL * Math.cos(rad(Math.max(0, pitch)))).applyQuaternion(Ry(yaw)));
const foot0 = {};
for (const s of ['Left', 'Right']) { const e = ypr(A3.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  foot0[s] = { yaw: e[0], pitch: e[1], ball: A3.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0]))) }; }
const hipsEnd = restPos.Hips.clone().add(hipsAt(LEN - 1));
const footIdle = {};
for (const s of ['Left', 'Right']) { const e = ypr(IDLE.D[s + 'Foot']); const pe = rad(Math.max(0, e[1]));
  const ball = IDLE.pos[s + 'Foot'].clone().sub(V(0, FOOTL * Math.sin(pe), -FOOTL * Math.cos(pe)).applyQuaternion(Ry(e[0])));
  footIdle[s] = { yaw: e[0], pitch: e[1], ball: ball.clone().sub(IDLE.hipsPos).add(hipsEnd).setY(ball.y) }; }
// sol (ön) ayak öne adım atar (2–14); vuruşta kalça sağa dönerken iki ayak top üstünde sağa döner (sağ topuk kalkar);
// toparlanmada arka (sağ) ayak öne toplanır (48–60), ön ayak idle'a oturur (58–70)
const STEP_L = 0.25, STEP_AZ = 24;
const ballL1 = foot0.Left.ball.clone().add(V(Math.sin(rad(STEP_AZ)), 0, Math.cos(rad(STEP_AZ))).multiplyScalar(STEP_L));
const YAW_L1 = 38, YAW_L2 = 6, YAW_R1 = 52, YAW_R2 = -12;
const SLIDE_R = V(0.03, 0, 0.07);   // arka ayak parmak ucunda dönerken kayar (kalçanın sağa açılma momentumu)
const stepArc = (a, b, f, f0, f1, lift) => { const s = clamp((f - f0) / (f1 - f0), 0, 1); const p = a.clone().lerp(b, sst(s)); p.y += lift * Math.sin(Math.PI * s); return p; };
function footAt(s, f) {
  const f0 = foot0[s], fi = footIdle[s];
  let ball, yaw, pitch, ground = true;
  if (s === 'Left') {
    if (f < 14) { ball = stepArc(f0.ball, ballL1, f, 2, 14, 0.05); yaw = f0.yaw + (YAW_L1 - f0.yaw) * sst((f - 2) / 12); pitch = spl([[0, f0.pitch], [2, 0], [5, 16], [9, 4], [14, 0, 0]], f); ground = f <= 3; }
    else if (f < 58) { ball = ballL1.clone(); yaw = YAW_L1 + (YAW_L2 - YAW_L1) * sst((f - 27) / 14); pitch = 0; }
    else { ball = stepArc(ballL1, fi.ball, f, 58, 70, 0.035); yaw = YAW_L2 + (fi.yaw - YAW_L2) * sst((f - 58) / 12); pitch = spl([[58, 0], [60, 10], [65, 3], [70, 0, 0]], f); ground = f >= 70; }
  } else {
    if (f < 48) { ball = f0.ball.clone().add(SLIDE_R.clone().multiplyScalar(sst((f - 31) / 13)));
      yaw = f < HOLD ? f0.yaw + (YAW_R1 - f0.yaw) * sst((f - 4) / 16) : YAW_R1 + (YAW_R2 - YAW_R1) * sst((f - 26) / 15);
      pitch = spl([[0, f0.pitch], [6, 0], [HOLD, 0, 0], [27, 0], [33, 20], [39, 24], [SEND, 20], [48, 18]], f); }
    else { ball = stepArc(f0.ball.clone().add(SLIDE_R), fi.ball, f, 48, 60, 0.05); yaw = YAW_R2 + (fi.yaw - YAW_R2) * sst((f - 48) / 12); pitch = spl([[48, 20], [52, 12], [57, 3], [60, 0, 0]], f); ground = f >= 60; }
  }
  return { ankle: ankleFromBall(ball, yaw, pitch), yaw, pitch, ground };
}

// ===== KILIÇ-ÖNCELİKLİ ÇİFT KOL ÇÖZÜCÜ (light-attack-4 ile aynı) =====
const L1 = V(...by.RightLeg.restP).length(), L2 = V(...by.RightFoot.restP).length();
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
const WR0 = [0, 0]; { const a = ARM.Right; WR0[0] = WRIST * nW.dot(a.a1); WR0[1] = WRIST * nW.dot(a.a2); }
const swingOf = (s, q) => { const A = ARM[s]; if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const ang = 2 * Math.acos(Math.min(1, q.w));
  if (ang < 1e-6) return [0, 0]; const ax = V(q.x, q.y, q.z).normalize(); return [deg(ang) * ax.dot(A.a1), deg(ang) * ax.dot(A.a2)]; };
const twistDeg = (q, ax) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); return deg(2 * Math.atan2(V(q.x, q.y, q.z).dot(ax), q.w)); };

function armIK(s, S, PH, DH, w) {
  const A = ARM[s], H = A.H, f0 = H.f0;
  const W = wristQ(s, w); const DF = DH.clone().multiply(W.clone().invert());
  const fd = f0.clone().applyQuaternion(DF);
  const E = PH.clone().sub(fd.clone().multiplyScalar(A.lf));
  const SE_ = E.clone().sub(S); const dist = SE_.length(); const u = SE_.divideScalar(dist);
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
const sq = (v) => v * v;
const segDist = (a, b, p) => { const ab = b.clone().sub(a); const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())); return a.clone().add(ab.multiplyScalar(t)).distanceTo(p); };

// ---- kılıç yolu tasarımı: dünya-yaw çerçevesi (hedef +z, x sol). C: kabza noktası (sağ el ekseni), kalçaya göre yatay [x, z],
// y = yerden yükseklik. Bıçak yönü (az, el) dünyada; kenar ρ: 0 = soldan sağa süpürmenin ilerleme yönü (yatay), +90 = yukarı ----
const tFrom = (az, el) => V(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), Math.cos(rad(az)) * Math.cos(rad(el)));
const sweepBasis = (t, az) => { const m = V(-Math.cos(rad(az)), 0, Math.sin(rad(az))); m.sub(t.clone().multiplyScalar(m.dot(t))).normalize();
  const u = m.clone().cross(t).normalize(); if (u.y < 0) u.negate(); return { m, u }; };
const eFrom = (az, el, rho) => { const t = tFrom(az, el); const { m, u } = sweepBasis(t, az); return m.multiplyScalar(Math.cos(rad(rho))).add(u.multiplyScalar(Math.sin(rad(rho)))); };
const rhoOf = (t, e) => { const az = deg(Math.atan2(t.x, t.z)); const { m, u } = sweepBasis(t, az); return deg(Math.atan2(e.dot(u), e.dot(m))); };
const swordFromHand = (Dh, Ph) => ({ C: Ph.clone().add(PPpR.clone().applyQuaternion(Dh)), t: b0.clone().applyQuaternion(Dh), e: EH.clone().applyQuaternion(Dh) });
const relSw = (sw, hips) => ({ C: [sw.C.x - hips.x, sw.C.y - GROUND, sw.C.z - hips.z], t: sw.t, e: sw.e });
const SW0 = relSw(swordFromHand(A3.D.RightHand, A3.pos.RightHand), A3.hipsPos);
const SWI = relSw(swordFromHand(IDLE.D.RightHand, IDLE.pos.RightHand), IDLE.hipsPos);
const azOf = (t) => deg(Math.atan2(t.x, t.z)), elOf = (t) => deg(Math.asin(clamp(t.y, -1, 1)));
const RHO0 = rhoOf(SW0.t, SW0.e), RHOI = rhoOf(SWI.t, SWI.e);
// vuruş (HOLD..SEND) analitik: tek çan hız profili → temas önde (az = 0) tepe hızda; kabza kalça çevresinde yay (eller bıçağın önünde),
// bıçak YATAY, incik-diz hizasında, sabit yükseklik/eğim; roll neredeyse sabit (kenar aşağı-geride: bacaklara sırtıyla vurur)
const AZ_H = 115, AZ_F = -110, PHI_H = 80, PHI_F = -80, RHO_H = -155, RHO_S = -140;
const strikeAt = (f) => ({
  az: AZ_H + (AZ_F - AZ_H) * sst((f - HOLD - 2) / 18) - 10 * bump(f, 37, 46),
  phi: PHI_H + (PHI_F - PHI_H) * sst((f - HOLD - 1) / 18),
  r: spl([[HOLD, 0.36, 0], [30, 0.42], [35, 0.45], [41, 0.43], [SEND, 0.40, 0]], f),
  h: spl([[HOLD, 0.62, 0], [30, 0.57], [35, 0.55], [41, 0.58], [SEND, 0.62, 0]], f),
  el: spl([[HOLD, -10, 0], [35, -12], [SEND, -8, 0]], f),
  rho: spl([[HOLD, RHO_H, 0], [35, RHO_S], [SEND, RHO_S, 0]], f),
});
const stH = strikeAt(HOLD), stE = strikeAt(SEND);
const polar = (phi, r) => [r * Math.sin(rad(phi)), r * Math.cos(rad(phi))];
// hazırlık anahtarları [kare, C[x,h,z], az, el, ρ]: kılıç solda kalır, ucu aşağı sarkar; ρ L3 sonundaki ~163'ten (kenar geride-yukarıda)
// arkadan geçerek aşağıya (265 ≡ −95) döner
const KW = [
  [0, SW0.C, azOf(SW0.t), elOf(SW0.t), RHO0],
  [5, [...[polar(75, 0.44)].flatMap(([x, z]) => [x, 0.97, z])], 66, -18, 180],
  [10, [...[polar(36, 0.36)].flatMap(([x, z]) => [x, 0.84, z])], 76, -32, 192],
  [15, [...[polar(4, 0.31)].flatMap(([x, z]) => [x, 0.85, z])], 85, -46, 222],
  [20, [...[polar(-5, 0.29)].flatMap(([x, z]) => [x, 0.85, z])], 92, -55, 238],
  [HOLD, [polar(PHI_H, stH.r)[0], stH.h, polar(PHI_H, stH.r)[1]], AZ_H, stH.el, RHO_H, 0],
];
// toparlanma anahtarları: sağ yandaki takipten idle korumasına (eller zaten sağ kalça önünde; uç öne kalkar, kenar aşağı)
const KR = [
  [SEND, [polar(stE.phi, stE.r)[0], stE.h, polar(stE.phi, stE.r)[1]], stE.az, stE.el, stE.rho, 0],
  [53, [...[polar(-84, 0.36)].flatMap(([x, z]) => [x, 0.72, z])], -85, -12, -125],
  [60, [...[polar(-87, 0.32)].flatMap(([x, z]) => [x, 0.86, z])], -45, -16, -100],
  [67, [...[polar(-89, 0.29)].flatMap(([x, z]) => [x, 0.96, z])], -12, -15, -80],
  [LEN - 1, SWI.C, azOf(SWI.t), elOf(SWI.t), RHOI],
];
const keyVec = (k) => { const t = tFrom(k[2], k[3]); const e = eFrom(k[2], k[3], k[4]); return [...k[1], ...t.toArray(), ...e.toArray()]; };
const KWv = KW.map((k) => (k[5] === 0 ? [k[0], keyVec(k), 0] : [k[0], keyVec(k)])); KWv[0][1] = [...SW0.C, ...SW0.t.toArray(), ...SW0.e.toArray()];
const KRv = KR.map((k) => (k[5] === 0 ? [k[0], keyVec(k), 0] : [k[0], keyVec(k)])); KRv[KRv.length - 1][1] = [...SWI.C, ...SWI.t.toArray(), ...SWI.e.toArray()];
function designAt(f) {
  if (f >= HOLD && f <= SEND) { const s = strikeAt(f); const [x, z] = polar(s.phi, s.r); return { C: V(x, s.h, z), t: tFrom(s.az, s.el), e: eFrom(s.az, s.el, s.rho), s }; }
  const r = spl(f < HOLD ? KWv : KRv, f);
  const t = V(r[3], r[4], r[5]).normalize(); const e = V(r[6], r[7], r[8]); e.sub(t.clone().multiplyScalar(e.dot(t))).normalize();
  return { C: V(r[0], r[1], r[2]), t, e };
}
const TWO = (f) => smooth((f - GRIP_IN + 12) / 12) * (1 - smooth((f - GRIP_OUT) / 16));
const GRIP = TWO;
const STRIKE = (f) => smooth((f - HOLD - 2) / 3) * (1 - smooth((f - SEND + 2) / 4));   // vuruş penceresi ağırlığı
const WD = (f) => 1 + 5 * STRIKE(f) + 2 * smooth((f - HOLD + 4) / 3) * (1 - smooth((f - HOLD - 2) / 2)); // tasarım ağırlığı (bekleme + vuruş)
const SPD = (f) => (f <= 5 ? 5 : 12);

// ---- maliyet ----
function evalX(ctx, x, full = false) {
  const { Cd, td, ed, pos0, D, g, Lf, meas, prev } = ctx;
  const C = Cd.clone().add(V(x[0], x[1], x[2]));
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
    const wm = ik.wmag; c += 0.002 * wm * wm + (wm > 13.5 ? 4 * sq(wm - 13.5) : 0);
    const a = Math.abs(ik.tau); c += (a > 60 ? 0.02 * sq(a - 60) : 0) + (a > 78 ? 3 * sq(a - 78) : 0);
    const b = ik.bend; c += (b < 22 ? 0.3 * sq(22 - b) : 0) + (b > 125 ? 0.3 * sq(b - 125) : 0);
    const h = ik.PH.clone().sub(ik.S).normalize(); const m = ik.E.clone().sub(ik.S); m.sub(h.clone().multiplyScalar(m.dot(h)));
    if (m.length() > 0.01 && ctx.soft > 0) { const pref = out.clone().add(down.clone().multiplyScalar(0.6)).normalize(); c += ctx.soft * 4 * sq(Math.max(0, 0.35 - m.normalize().dot(pref))); }
    const el = ik.E, wr = ik.S.clone().add(ik.u.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lu)).add(ik.fd.clone().multiplyScalar(ARM[tag === 'R' ? 'Right' : 'Left'].lf));
    for (const [pt, r] of [[el, 0.06], [el.clone().lerp(wr, 0.5), 0.05], [wr, 0.05]]) { const d = meas(pt, r); if (d < 0.03) c += ctx.soft * 3000 * sq(0.03 - d); TT[tag] = Math.min(TT[tag] ?? 9, d); }
  }
  const pom = C.clone().add(t.clone().multiplyScalar(-HALF - SR)), tip = C.clone().add(t.clone().multiplyScalar(HALF - SR));
  let bc = 9; for (let s = 0.1; s <= 0.92; s += 0.1) { const d = meas(pom.clone().lerp(tip, s), 0.015); bc = Math.min(bc, d); if (d < 0.03) c += 3000 * sq(0.03 - d); }
  // bacaklar: bıçak uyluk/baldırdan uzak (diz hizası süpürme)
  let lc = 9; for (const s of ['Left', 'Right']) for (const [a, b] of [[pos0[s + 'UpLeg'], pos0[s + 'Leg']], [pos0[s + 'Leg'], pos0[s + 'Foot']]])
    for (let k = 0.15; k <= 0.95; k += 0.1) { const pt = C.clone().lerp(tip, k); const d = segDist(a, b, pt) - 0.07; lc = Math.min(lc, d); if (d < 0.04) c += 3000 * sq(0.04 - d); }
  const hc = segDist(pom, tip, ctx.headC) - 0.13; if (hc < 0.11) c += 20000 * sq(0.11 - hc);
  const tipY = tip.y - GROUND; if (tipY < 0.13) c += 3000 * sq(0.13 - tipY);
  c += 150 * ctx.wd * (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]) + 0.002 * ctx.wd * (x[3] * x[3] + x[4] * x[4]);
  c += 0.003 * x[5] * x[5] + (Math.abs(x[5]) > 24 ? 3 * sq(Math.abs(x[5]) - 24) : 0);
  for (const i of [11, 12, 13, 14]) c += 0.004 * x[i] * x[i] + (Math.abs(x[i]) > 12 ? 1 * sq(Math.abs(x[i]) - 12) : 0);
  if (prev) { c += 3000 * (sq(x[0] - prev[0]) + sq(x[1] - prev[1]) + sq(x[2] - prev[2])); for (let i = 3; i < x.length; i++) c += (i === 6 ? 0.1 : 0.03) * sq(x[i] - prev[i]);
    const dg = Math.abs(x[6] - prev[6]); if (dg > 3) c += 2 * sq(dg - 3); }
  { const cap = STRIKE(ctx.f) > 0.5 ? 8 : 22; for (const i of [3, 4]) { const a = Math.abs(x[i]); c += 0.003 * a * a + (a > cap ? 2 * sq(a - cap) : 0); } }
  if (STRIKE(ctx.f) > 0.5) c += 0.03 * x[5] * x[5];   // etkin pencerede roll sabit kalsın
  if (ctx.prevTau) { for (const [ik, k] of [[ikR, 'R'], [ikL, 'L']]) { if (!ik || ctx.prevTau[k] == null) continue; const d = Math.abs(ik.tau - ctx.prevTau[k]); c += 0.006 * d * d + (d > 10 ? 0.3 * sq(d - 10) : 0); } }
  if (ctx.gam0 != null) { const d = Math.abs(x[6] - ctx.gam0); if (d > 14) c += 0.5 * sq(d - 14); }
  if (ctx.prevD) { const lim = SPD(ctx.f);
    for (const [ik, k, H] of [[ikR, 'R', R], [ikL, 'L', RL]]) { if (!ik || !ctx.prevD[k + 'U']) continue;
      for (const [Dn, Dp, ax] of [[ik.DU, ctx.prevD[k + 'U'], H.u0], [ik.DF, ctx.prevD[k + 'F'], H.f0]]) { const dq = Dp.clone().invert().multiply(Dn);
        const tw = Math.abs(twistDeg(dq, ax)); if (tw > 6.5) c += 0.4 * sq(tw - 6.5); if (ctx.f <= 6) { const an = qMag(dq); if (an > lim) c += 0.3 * sq(an - lim); } } } }
  if (ctx.anchor) { const { xa, k } = ctx.anchor; c += k * (3000 * (sq(x[0] - xa[0]) + sq(x[1] - xa[1]) + sq(x[2] - xa[2])) + 0.05 * [3, 4, 5, 7, 8, 11, 12].reduce((a, i) => a + sq(x[i] - xa[i]), 0)); }
  if (g < 1 && ikL) c += (1 - g) * (0.05 * (sq(x[9] - ctx.wf[0]) + sq(x[10] - ctx.wf[1])) + 0.05 * (sq(x[13]) + sq(x[14])));
  if (!full) return c;
  return { c, C, t, e, DHR, DshR, DshL, ikR, ikL, tip, tipY, hc, bc, lc, T: TT, PLg };
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

// ---- sol kol serbest (kavrama dışı) ----
const chestD = (f) => spineD(f, bodyAt(f)).Spine;
const Dc0i = chestD(0).invert(), DcEi = chestD(LEN - 1).invert();
const uL0c = RL.u0.clone().applyQuaternion(A3.D.LeftArm).applyQuaternion(Dc0i), fL0c = RL.f0.clone().applyQuaternion(A3.D.LeftForeArm).applyQuaternion(Dc0i);
const uLEc = RL.u0.clone().applyQuaternion(IDLE.D.LeftArm).applyQuaternion(DcEi), fLEc = RL.f0.clone().applyQuaternion(IDLE.D.LeftForeArm).applyQuaternion(DcEi);
const flx = (u, f) => f.clone().sub(u.clone().multiplyScalar(f.dot(u))).normalize();
// bırakma: el kabzayı sağ yanda bırakır, önden (gövdenin dışından) sol yana döner
const LU = [[0, uL0c.toArray()], [GRIP_IN - 2, [0.15, -0.75, 0.6]], [GRIP_OUT + 2, [0.1, -0.75, 0.62]], [60, [0.08, -0.55, 0.83]], [67, [0.35, -0.8, 0.48]], [LEN - 1, uLEc.toArray()]];
const LF = [[0, flx(uL0c, fL0c).toArray()], [GRIP_IN - 2, [-0.4, 0.1, 0.9]], [GRIP_OUT + 2, [-0.4, 0.1, 0.9]], [60, [0.35, 0.1, 0.93]], [67, [0.2, 0.2, 1]], [LEN - 1, flx(uLEc, fLEc).toArray()]];
const BEND_L = [[0, deg(uL0c.angleTo(fL0c))], [GRIP_IN - 2, 50], [GRIP_OUT + 2, 50], [60, 48], [67, 34], [LEN - 1, deg(uLEc.angleTo(fLEc))]];
const lcache = {}; const TAUF = { a: 0, b: 0 };
const tauFree = (f) => (f <= 30 ? TAUF.a * sst(f / GRIP_IN) : TAUF.b * (1 - sst((f - GRIP_OUT) / 20)));
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

let prevX = null, prevTau = null, prevD = null; const GAM0 = 230;
const WRI = swingOf('Right', IDLE.D.RightForeArm.clone().invert().multiply(IDLE.D.RightHand));
const X0 = [0, 0, 0, 0, 0, 0, 0, WR0[0], WR0[1], 0, 0, 0, 0, 0, 0], XE = [0, 0, 0, 0, 0, 0, 0, WRI[0], WRI[1], 0, 0, 0, 0, 0, 0];
function solve(f) {
  const p = bodyAt(f); const D = spineD(f, p);
  const curW = (n) => D[n].clone().multiply(restW[n]);
  const hipsPos = restPos.Hips.clone().add(V(...p.hp));
  p.ground = {}; p.reach = {};
  for (const [s, sg] of [['Left', 1], ['Right', -1]]) {
    const ft = footAt(s, f);
    p.ground[s] = ft.ground;
    const hipJ = hipsPos.clone().add(V(...by[s + 'UpLeg'].restP).applyQuaternion(curW('Hips')));
    if (ft.ground && ft.ankle.distanceTo(hipJ) / (L1 + L2) > 0.962) { // yerde bacak erişimi ≤0,962: topuk kalkar (parmak ucu yerde)
      const pp0 = Math.max(0, ft.pitch); const ball = ft.ankle.clone().sub(V(0, FOOTL * Math.sin(rad(pp0)), -FOOTL * Math.cos(rad(pp0))).applyQuaternion(Ry(ft.yaw)));
      for (let pt = pp0; pt <= 46; pt += 0.5) { const a = ankleFromBall(ball, ft.yaw, pt); ft.ankle = a; ft.pitch = pt; if (a.distanceTo(hipJ) / (L1 + L2) <= 0.962) break; }
    }
    let dv = ft.ankle.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize();
    p.reach[s] = d / (L1 + L2); d = Math.min(d, L1 + L2 - 1e-3);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d); const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = V(0.15 * sg, 0, 1).applyQuaternion(Ry(ft.yaw - (s === 'Left' ? 5 : -15))).normalize(); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(a)).add(pole.multiplyScalar(h)); const ankle = hipJ.clone().add(dir.clone().multiplyScalar(d));
    { const fz = V(0, 0, 1), pl = knee.clone().sub(hipJ.clone().add(dir.clone().multiplyScalar(a))).normalize();
      const fr = (x0, x1) => basisQ(x1, pl).multiply(basisQ(x0, fz).invert());
      const wt = Math.min(1, f / 16), kt = sst(wt);   // L3'ün burulmasından tutarlı çerçeveye yumuşak geçiş
      const td = knee.clone().sub(hipJ).normalize(), sd = ankle.clone().sub(knee).normalize();
      D[s + 'UpLeg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'UpLeg', s + 'Leg'), td).slerp(fr(restDir(s + 'UpLeg', s + 'Leg'), td), kt);
      D[s + 'Leg'] = new THREE.Quaternion().setFromUnitVectors(restDir(s + 'Leg', s + 'Foot'), sd).slerp(fr(restDir(s + 'Leg', s + 'Foot'), sd), kt); }
    D[s + 'Foot'] = eul([ft.yaw, ft.pitch, 0]);
    D[s + 'ToeBase'] = eul([ft.yaw, ft.pitch - Math.min(Math.max(0, ft.pitch), 42) * (ft.ground ? 1 : 0.6), 0]);   // topuk kalkınca parmaklar yerde
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
  const des = designAt(f);
  const Cd = V(hipsPos.x + des.C.x, GROUND + des.C.y, hipsPos.z + des.C.z);
  const ctx = { Cd, td: des.t, ed: des.e, pos0, D, g, Lf: { P: LfP, DH: LfDH }, meas: clearance(pos0, D), headC: pos0.Head.clone().add(V(0, 0.1, 0).applyQuaternion(D.Head)), prev: prevX, prevTau, wf };
  const kS = 1 - smooth(f / 8), kE = smooth((f - 60) / 12);
  ctx.wd = WD(f); ctx.f = f; ctx.prevD = prevD; ctx.gam0 = g > 0 ? GAM0 : null;
  ctx.soft = 1 - Math.max(kS, kE); ctx.anchor = kS > 0 ? { xa: X0, k: 4 * kS } : kE > 0 ? { xa: XE, k: 4 * kE } : null;
  let x0 = prevX ? prevX.slice() : X0.slice(); if (!prevX && g > 0) x0[6] = GAM0;
  if (g <= 0) { x0[9] = wf[0]; x0[10] = wf[1]; x0[13] = 0; x0[14] = 0; if (ctx.prev) { ctx.prev = ctx.prev.slice(); ctx.prev[9] = wf[0]; ctx.prev[10] = wf[1]; } }
  if (g > 0 && prevX && TWO(f - 1) <= 0) { // kavramanın ilk karesi: γ taraması
    let best = null; const pv = prevX.slice(); pv[9] = wf[0]; pv[10] = wf[1];
    for (let gm = GAM0 - 15; gm <= GAM0 + 15; gm += 5) { const xs = x0.slice(); xs[6] = gm; ctx.prev = pv.slice(); ctx.prev[6] = gm; const r = optimize(ctx, xs, 80); if (!best || r.fx < best.fx) best = r; }
    x0 = best.x; ctx.prev = pv; ctx.prev[6] = x0[6];
  }
  const opt = f === 0 ? { x: X0.slice(), fx: evalX(ctx, X0) } : optimize(ctx, x0, prevX ? 400 : 1500);
  prevX = opt.x;
  const r = evalX(ctx, opt.x, true);
  prevD = { RU: r.ikR.DU, RF: r.ikR.DF, LU: r.ikL ? r.ikL.DU : null, LF: r.ikL ? r.ikL.DF : null };
  prevTau = { R: r.ikR.tau, L: r.ikL ? r.ikL.tau : null };
  D.RightShoulder = r.DshR; D.RightArm = r.ikR.DU; D.RightForeArm = r.ikR.DF; D.RightHand = r.ikR.DH;
  if (r.ikL) { D.LeftShoulder = r.DshL; D.LeftArm = r.ikL.DU; D.LeftForeArm = r.ikL.DF; D.LeftHand = r.ikL.DH;
    if (g < 0.95) { const k = smooth(1 - g / 0.95); D.LeftShoulder = r.DshL.clone().slerp(D.Spine, k); D.LeftArm = r.ikL.DU.clone().slerp(lF.arm, k); D.LeftForeArm = r.ikL.DF.clone().slerp(lF.fore, k); D.LeftHand = r.ikL.DH.clone().slerp(LfDH, k); } }
  else { D.LeftArm = lF.arm; D.LeftForeArm = lF.fore; D.LeftHand = LfDH; }
  const { pos, out } = fkPos();
  p.x = opt.x; p.cost = opt.fx; p.r = r; p.gw = g; p.des = des;
  p.bladeDir = r.t; p.tip = r.tip; p.tipY = r.tipY;
  const hl = by.Hips.restP; const off = hipsPos.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  return { out, hipsLocal: [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z], p, pos, D };
}

// ön geçiş: sol kolun serbest anahtarlarını kavrama başı/sonu IK pozuna eşitle → kavramaya giriş/çıkışta burulma sıçraması olmaz
{ const cap = {};
  for (let f = 0; f < LEN; f++) { const r = solve(f); if (f === GRIP_IN || f === GRIP_OUT) { const ik = r.p.r.ikL; const Di = chestD(f).invert(); const uc = ik.u.clone().applyQuaternion(Di), fc = ik.fd.clone().applyQuaternion(Di); cap[f] = { u: uc.toArray(), fx: flx(uc, fc).toArray(), b: ik.bend, tau: ik.tau }; } }
  prevX = null; prevTau = null; prevD = null; SEED = 12345; for (const k of Object.keys(lcache)) delete lcache[k];
  const setK = (arr, f, v) => { const i = arr.findIndex((k) => k[0] === f); if (i >= 0) arr[i] = [f, v]; else { arr.push([f, v]); arr.sort((x, y) => x[0] - y[0]); } };
  TAUF.a = cap[GRIP_IN].tau; TAUF.b = cap[GRIP_OUT].tau; console.log('serbest önkol pronasyonu (kavrama başı/sonu):', TAUF.a.toFixed(0), TAUF.b.toFixed(0));
  for (const [fk, fc] of [[GRIP_IN - 2, GRIP_IN], [GRIP_OUT + 2, GRIP_OUT]]) { setK(LU, fk, cap[fc].u); setK(LF, fk, cap[fc].fx); setK(BEND_L, fk, cap[fc].b); }
}
const outs = []; const diag = []; const hand = [];
const t0run = Date.now();
// bekleme karesi taze çözülür (yol bağımlılığı yok: hazırlıktaki kılıç yolu sağ önkolu burulmuş kola kilitliyordu); hazırlık (1..HOLD−1)
// kollarda eklem uzayında L3 sonu → bekleme çözümü aralaması (yerel dönmeler, bekleme karesinde sıfır hız); vuruş bekleme çözümünden sürer
prevX = null; prevTau = null; prevD = null;
const holdSol = solve(HOLD); const holdState = { x: prevX, tau: prevTau, D: prevD };
const ARMB = ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'];
const fkOut = (out, hipsPos) => { const cur = {}, pos = {}; for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; }
    cur[b.name] = cur[b.parent].clone().multiply(out[b.name] || Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, cur }; };
prevX = null; prevTau = null; prevD = null; SEED = 12345;
for (let f = 0; f < LEN; f++) {
  if (f === HOLD) { prevX = holdState.x; prevTau = holdState.tau; prevD = holdState.D; }
  const r = f === HOLD ? holdSol : solve(f); outs.push(r);
  if (f > 0 && f < HOLD) { const w = sst(f / (HOLD - 4)) + 0.07 * bump(f, 12, HOLD); r.interp = true;
    for (const n of ARMB) { const a = A3.local[n].clone(), b = holdSol.out[n]; if (a.dot(b) < 0) a.set(-a.x, -a.y, -a.z, -a.w); r.out[n] = a.slerp(b, n.endsWith("Hand") ? Math.min(1, w) : w); }   // aşma yalnız kol zincirinde; el (bilek) aralamada kalır
    r.pos = fkOut(r.out, restPos.Hips.clone().add(hipsAt(f))).pos; }
  hand.push({ R: r.pos.RightHand.clone(), L: r.pos.LeftHand.clone() });
  const R_ = r.p.r;
  diag.push({ f, cost: r.p.cost, x: r.p.x, errR: R_.ikR.err, errL: R_.ikL?.err, tauR: R_.ikR.tau, tauL: R_.ikL?.tau, bendR: R_.ikR.bend, bendL: R_.ikL?.bend, wR: R_.ikR.wmag, wL: R_.ikL?.wmag,
    clr: R_.T, bc: R_.bc, lc: R_.lc, hc: R_.hc, tipY: R_.tipY, reach: [r.p.reach.Left, r.p.reach.Right], ground: r.p.ground, gw: r.p.gw, cy: r.p.chestYaw, pel: r.p.pel[0] });
}
console.log('çözüm süresi', ((Date.now() - t0run) / 1000).toFixed(1), 'sn');
if (ARGS.includes('--diag')) for (const d of diag) console.log(d.f, 'c', d.cost.toFixed(2), 'g', d.gw.toFixed(2), 'eR', (d.errR * 1000).toFixed(1), 'eL', d.errL != null ? (d.errL * 1000).toFixed(1) : '-', 'wR', d.wR.toFixed(1), 'wL', d.wL?.toFixed(1) ?? '-', 'τR', d.tauR.toFixed(0), 'τL', d.tauL?.toFixed(0) ?? '-',
  'bR', d.bendR.toFixed(0), 'bL', d.bendL?.toFixed(0) ?? '-', 'dC', d.x.slice(0, 3).map((v) => (v * 100).toFixed(0)).join('/'), 'dt', d.x.slice(3, 5).map((v) => v.toFixed(0)).join('/'), 'β', d.x[5].toFixed(0), 'γ', d.x[6].toFixed(0),
  'clav', d.x.slice(11).map((v) => v.toFixed(0)).join('/'), 'clr', JSON.stringify(Object.fromEntries(Object.entries(d.clr).map(([k, v]) => [k, +v.toFixed(2)]))), 'bl', d.bc.toFixed(2), 'leg', d.lc.toFixed(2), 'hd', d.hc.toFixed(2), 'tip', d.tipY.toFixed(2),
  'reach', d.reach.map((v) => v.toFixed(2)).join('/'), 'pel', d.pel.toFixed(0), 'cy', d.cy.toFixed(0));

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

// ---- dikiş (0. kare = L3[49]) ve bitiş (son kare = katana_idle[0], yatay kök konumu hariç) ----
const SEAM = 9, ENDB = 22; const allNames = Object.keys(outs[0].out).filter((n) => n !== 'Armature');
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

// ---- sol önkol pronasyonunu kavramaya giriş boyunca (1–GRIP_IN) tek yumuşak eğriye yay (önkol ekseni etrafında: el konumu değişmez) ----
{ const n = 'LeftForeArm', rq = Q(by[n].restQ), rqi = rq.clone().invert(); const twA = (f) => { const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))); return 2 * Math.atan2(d.y, d.w); };
  const a0 = 1, a1 = GRIP_IN, t0 = twA(a0), t1 = twA(a1); const raw = []; for (let f = a0; f <= a1; f++) raw.push(twA(f));
  for (let f = a0 + 1; f < a1; f++) { const tn = t0 + (t1 - t0) * smooth((f - a0) / (a1 - a0)); const d = rqi.clone().multiply(Q(tracks[n].rot[f].slice(1))).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), tn - raw[f - a0]));
    const q = rq.clone().multiply(d); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
// ---- bırakmada (sol el kabzadan ayrılıp sol yana döner) sol kol zinciri yumuşatma: tepe açısal hızı düşürür ----
for (let pass = 0; pass < 3; pass++) for (const n of ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = GRIP_OUT + 2; f <= Math.min(LEN - 4, GRIP_OUT + 20); f++) { const acc = [0, 0, 0, 0]; [1, 6, 15, 20, 15, 6, 1].forEach((w, i) => { const q = src[f + i - 3]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
    const q = new THREE.Quaternion(...acc).normalize(); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
// ---- vuruş penceresinde kol zinciri yumuşatma (çözücünün kareler arası salınımını giderir); sol el kabzaya yeniden oturtulur ----
const fkT = (f) => { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? Q(tracks[b.name].rot[f].slice(1)) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } return { pos, cur }; };
const relLH = (f) => { const k = fkT(f); return { p: k.pos.LeftHand.clone().sub(k.pos.RightHand).applyQuaternion(k.cur.RightHand.clone().invert()), q: k.cur.RightHand.clone().invert().multiply(k.cur.LeftHand) }; };
const HW = 6, SA = HOLD - HW, SB = SEND + 4; const rel0 = []; for (let f = SA; f <= SB; f++) rel0.push(relLH(f));
// ---- bekleme karesi: HOLD'a giriş ve çıkışta tüm kemiklerde sıfır hız (log uzayında kübik Hermite, HW kare); HOLD karesi değişmez ----
{ const logQ = (q) => { if (q.w < 0) q = new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w); const a = 2 * Math.acos(Math.min(1, q.w)); return a < 1e-9 ? V(0, 0, 0) : V(q.x, q.y, q.z).normalize().multiplyScalar(a); };
  const expQ = (v) => { const a = v.length(); return a < 1e-9 ? new THREE.Quaternion() : new THREE.Quaternion().setFromAxisAngle(v.clone().divideScalar(a), a); };
  const H = (s, p0, v0, p1, v1) => p0.clone().multiplyScalar(2 * s ** 3 - 3 * s ** 2 + 1).add(v0.clone().multiplyScalar((s ** 3 - 2 * s ** 2 + s) * HW)).add(p1.clone().multiplyScalar(-2 * s ** 3 + 3 * s ** 2)).add(v1.clone().multiplyScalar((s ** 3 - s ** 2) * HW));
  const Z = V(0, 0, 0);
  for (const n of allNames) { const src = tracks[n].rot.map((k) => Q(k.slice(1))); const qH = src[HOLD], qHi = qH.clone().invert(); const L = (f) => logQ(qHi.clone().multiply(src[f]));
    const pA = L(HOLD - HW), vA = L(HOLD - HW).sub(L(HOLD - HW - 1)), pB = L(HOLD + HW), vB = L(HOLD + HW + 1).sub(L(HOLD + HW));
    for (let f = HOLD - HW + 1; f < HOLD; f++) { const q = qH.clone().multiply(expQ(H((f - HOLD + HW) / HW, pA, vA, Z, Z))); if (q.dot(src[f]) < 0) q.set(-q.x, -q.y, -q.z, -q.w); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; }
    for (let f = HOLD + 1; f < HOLD + HW; f++) { const q = qH.clone().multiply(expQ(H((f - HOLD) / HW, Z, Z, pB, vB))); if (q.dot(src[f]) < 0) q.set(-q.x, -q.y, -q.z, -q.w); tracks[n].rot[f] = [f, q.x, q.y, q.z, q.w]; } }
  const hp = tracks.Hips.pos.map((k) => V(...k.slice(1))); const pH = hp[HOLD];
  const pA = hp[HOLD - HW].clone().sub(pH), vA = hp[HOLD - HW].clone().sub(hp[HOLD - HW - 1]), pB = hp[HOLD + HW].clone().sub(pH), vB = hp[HOLD + HW + 1].clone().sub(hp[HOLD + HW]);
  for (let f = HOLD - HW + 1; f < HOLD; f++) tracks.Hips.pos[f] = [f, ...pH.clone().add(H((f - HOLD + HW) / HW, pA, vA, Z, Z)).toArray()];
  for (let f = HOLD + 1; f < HOLD + HW; f++) tracks.Hips.pos[f] = [f, ...pH.clone().add(H((f - HOLD) / HW, Z, Z, pB, vB)).toArray()]; }
for (let pass = 0; pass < 2; pass++) for (const n of ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand']) { const src = tracks[n].rot.map((k) => Q(k.slice(1)));
  for (let f = HOLD + 3; f <= SB - 2; f++) { const acc = [0, 0, 0, 0]; [1, 4, 6, 4, 1].forEach((w, i) => { const q = src[f + i - 2]; const sg = q.dot(src[f]) < 0 ? -w : w; acc[0] += sg * q.x; acc[1] += sg * q.y; acc[2] += sg * q.z; acc[3] += sg * q.w; });
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
{ let dm = 0, am = 0; for (let f = SA; f <= SB; f++) { const r = relLH(f), rr = rel0[f - SA]; dm = Math.max(dm, r.p.distanceTo(rr.p)); am = Math.max(am, qAng(r.q, rr.q)); }
  console.log('kol yumuşatma: sol elin sağ ele göre kayması max', (dm * 100).toFixed(2), 'cm,', am.toFixed(1), '°'); }

// ---- rapor (son izlerden FK ile ölçülür: dikiş harmanlamaları dahil) ----
const qOf = (n, f) => Q(tracks[n].rot[f].slice(1));
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, v]) => n + ' ' + v.toFixed(1)).join(', ');
console.log('üretilen 0. kare − L3[49] (dikişte söner):', top(d0), '| kalça', (h0.length() * 100).toFixed(1), 'cm');
console.log('üretilen son kare − idle[0] (sonda söner):', top(dE));
const seam = (C, fa, fb) => { let m = 0, mn = ''; for (const n of allNames) { const t = C.A.tracks[n]; if (!t || !t.rot || !t.rot.length) continue; const a = qAng(Q(keyAt(t.rot, fa).slice(1)), qOf(n, fb)); if (a > m) { m = a; mn = n; } } return [m, mn]; };
const [s0, s0n] = seam(A3, A3.F, 0), [e0, e0n] = seam(IDLE, 0, LEN - 1);
console.log(`dikiş: L3[49]→H3[0] max ${s0.toFixed(3)}° (${s0n}), kalça ${(V(...tracks.Hips.pos[0].slice(1)).distanceTo(V(...A3.hl)) * 1000).toFixed(2)} mm | H3[son]↔idle[0] max ${e0.toFixed(3)}° (${e0n}), kalça yükseklik ${((tracks.Hips.pos[LEN - 1][3] - IDLE.hl[2]) * 100).toFixed(2)} cm`);
// L3'ün son iki karesinden hız sürekliliği (dikiş kırığı): L3[48→49] ile H3[0→1] arası en büyük kemik açısal hız farkı
{ let m = 0, mn = ''; for (const n of allNames) { const t = A3.A.tracks[n]; if (!t || !t.rot || t.rot.length < 2) continue; const va = qAng(Q(keyAt(t.rot, A3.F - 1).slice(1)), Q(keyAt(t.rot, A3.F).slice(1))), vb = qAng(qOf(n, 0), qOf(n, 1)); if (Math.abs(va - vb) > m) { m = Math.abs(va - vb); mn = n; } }
  console.log('dikiş hız farkı (°/kare) max', m.toFixed(2), mn); }
const FF = []; for (let f = 0; f < LEN; f++) { const cur = {}, pos = {}; const hp = tracks.Hips.pos[f]; const hipsPos = restPos.Hips.clone().add(V(hp[1] - by.Hips.restP[0], hp[2] - by.Hips.restP[1], hp[3] - by.Hips.restP[2]).applyQuaternion(armQ));
  for (const b of bones) { if (!b.parent) { cur[b.name] = Q(b.restQ); continue; } cur[b.name] = cur[b.parent].clone().multiply(tracks[b.name] ? qOf(b.name, f) : Q(b.restQ));
    pos[b.name] = b.parent === 'Armature' ? hipsPos.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); }
  const Dd = {}; for (const n of Object.keys(cur)) Dd[n] = cur[n].clone().multiply(restW[n].clone().invert()); FF.push({ pos, D: Dd, cur }); }
const palm = (s) => V(...by[s + 'HandIndex1'].restP).sub(V(...by[s + 'HandPinky1'].restP)).applyQuaternion(restW[s + 'Hand']).cross(V(...by[s + 'HandMiddle1'].restP).applyQuaternion(restW[s + 'Hand'])).normalize();
const wristStat = (s, f) => { const H = s === 'Right' ? R : RL; const Df = FF[f].D[s + 'ForeArm'], Dh = FF[f].D[s + 'Hand']; let q = Df.clone().invert().multiply(Dh); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const tw = twistDeg(q, H.f0); const twq = new THREE.Quaternion().setFromAxisAngle(H.f0, rad(tw)); const sw = q.clone().multiply(twq.invert());
  const pn = palm(s); const pnp = pn.clone().sub(H.f0.clone().multiplyScalar(pn.dot(H.f0))).normalize(); const fa = H.f0.clone().cross(pnp).normalize();
  const ang = qMag(sw); const ax = ang > 1e-4 ? V(sw.x, sw.y, sw.z).normalize() : V(1, 0, 0);
  return { tot: ang, flex: Math.abs(ang * ax.dot(fa)), dev: Math.abs(ang * ax.dot(pnp)), tw: Math.abs(tw) }; };   // toplam = salınım (HeroWristAudit gibi; önkol burulması sayılmaz)
const WMAX = {};
for (const s of ['Right', 'Left']) { const ws = [...Array(LEN).keys()].map((f) => wristStat(s, f)); const mx = (k) => { let m = 0, mf = 0; ws.forEach((w, f) => { if (w[k] > m) { m = w[k]; mf = f; } }); return [m, mf]; };
  WMAX[s] = { flex: mx('flex'), dev: mx('dev'), tot: mx('tot'), tw: mx('tw') };
  console.log(s, 'bilek: fleksiyon max', WMAX[s].flex[0].toFixed(1), '° (kare', WMAX[s].flex[1] + ') | sapma max', WMAX[s].dev[0].toFixed(1), '° (kare', WMAX[s].dev[1] + ') | toplam max', WMAX[s].tot[0].toFixed(1), '° (kare', WMAX[s].tot[1] + ') | burulma max', WMAX[s].tw[0].toFixed(1));
  if (ARGS.includes('--wr')) console.log('  ', ws.map((w, f) => f + ':' + w.tot.toFixed(0)).join(' ')); }
const gF = [...Array(LEN).keys()].filter((f) => diag[f].gw > 0.99);
const gd = gF.map((f) => { const t = outs[f].p.bladeDir; return FF[f].pos.LeftHand.clone().sub(FF[f].pos.RightHand).dot(t) * 100; });
console.log('iki elli tam kavrama: kare', gF[0], '–', gF.at(-1), '| sol el sağ elden eksen boyunca', Math.min(...gd).toFixed(1), '..', Math.max(...gd).toFixed(1), 'cm | erişim hatası max R/L', (Math.max(...diag.map((d) => Math.abs(d.errR))) * 1000).toFixed(1), '/', (Math.max(...diag.filter((d) => d.errL != null).map((d) => Math.abs(d.errL) * (d.gw))) * 1000).toFixed(1), 'mm');
const rng = (a) => Math.min(...a).toFixed(0) + '..' + Math.max(...a).toFixed(0);
const dd = diag.filter((d) => d.gw > 0);
console.log('β (roll sapması)', rng(diag.map((d) => d.x[5])), '| γ', rng(dd.map((d) => d.x[6])), '| dirsek R', rng(diag.map((d) => d.bendR)), 'L(kavrama)', rng(dd.map((d) => d.bendL)), '| τ R', rng(diag.map((d) => d.tauR)), 'L', rng(dd.map((d) => d.tauL)), '| kılıç yol sapması max', (Math.max(...diag.map((d) => Math.hypot(d.x[0], d.x[1], d.x[2]))) * 100).toFixed(1), 'cm,', Math.max(...diag.map((d) => Math.hypot(d.x[3], d.x[4]))).toFixed(0), '°');
const rotStep = (n) => { let m = 0, mf = 0; for (let f = 1; f < LEN; f++) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mf = f; } } return m.toFixed(1) + '(k' + mf + ')'; };
console.log('kemik dönüş hızı max (°/kare):', ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'Spine', 'Head', 'LeftUpLeg', 'RightUpLeg'].map((n) => n + ' ' + rotStep(n)).join(', '));
const dg = diag.filter((d) => d.f >= HOLD); const cl = {}; for (const d of dg) for (const [k, v] of Object.entries(d.clr)) cl[k] = Math.min(cl[k] ?? 9, v);
console.log('min mesafeler (m): kol-gövde', JSON.stringify(Object.fromEntries(Object.entries(cl).map(([k, v]) => [k, +v.toFixed(3)]))), '| bıçak-gövde', Math.min(...dg.map((d) => d.bc)).toFixed(3), '| bıçak-bacak', Math.min(...dg.map((d) => d.lc)).toFixed(3), '(kare', dg.reduce((a, d) => (d.lc < a.lc ? d : a)).f + ') | bıçak-kafa', Math.min(...dg.map((d) => d.hc)).toFixed(3), '(bekleme ve sonrası)');
// bekleme karesi durağanlığı: HOLD−1→HOLD ve HOLD→HOLD+1 en büyük kemik dönüşü + kalça hızı
const stepAt = (f) => { let m = 0, mn = ''; for (const n of allNames) { const a = qAng(qOf(n, f), qOf(n, f - 1)); if (a > m) { m = a; mn = n; } } return m.toFixed(2) + '° ' + mn; };
const hipStep = (f) => (V(...tracks.Hips.pos[f].slice(1)).distanceTo(V(...tracks.Hips.pos[f - 1].slice(1))) * 1000).toFixed(1) + ' mm';
console.log('bekleme karesi', HOLD, `(${(HOLD / 60).toFixed(3)} sn): giriş adımı`, stepAt(HOLD), hipStep(HOLD), '| çıkış adımı', stepAt(HOLD + 1), hipStep(HOLD + 1), '| ayaklar yerde', JSON.stringify(diag[HOLD].ground), '| uç-yer', diag[HOLD].tipY.toFixed(2), 'm');
// uç hızı, etkin pencere (vuruşta tepe hızın ≥ %55'i), temas (bıçak az = 0), kenar hizası
const tipW = (f) => { const k = FF[f]; return k.pos.RightHand.clone().add(PP.clone().add(b0.clone().multiplyScalar(HALF)).applyQuaternion(k.D.RightHand)); };
{ // FK ile tüm kareler: uç-yer, bıçak-bacak (uyluk/baldır), hazırlıkta sol elin sağ ele uzaklığı (kavramaya varış)
  let tm = 9, tf = 0, lm = 9, lf = 0;
  for (let f = 0; f < LEN; f++) { const k = FF[f], tip = tipW(f), hilt = k.pos.RightHand.clone().add(PP.clone().applyQuaternion(k.D.RightHand)); const ty = tip.y - GROUND; if (ty < tm) { tm = ty; tf = f; }
    for (const sd of ['Left', 'Right']) for (const [a, b] of [[k.pos[sd + 'UpLeg'], k.pos[sd + 'Leg']], [k.pos[sd + 'Leg'], k.pos[sd + 'Foot']]])
      for (let q = 0.2; q <= 1.0; q += 0.1) { const d = segDist(a, b, hilt.clone().lerp(tip, q)) - 0.07; if (d < lm) { lm = d; lf = f; } } }
  console.log('FK: uç-yer min', (tm * 100).toFixed(1), 'cm (kare', tf + ') | bıçak-bacak min', (lm * 100).toFixed(1), 'cm (kare', lf + ') | sol el–sağ el (cm) hazırlık:', [8, 12, 16, 18, 20, 22, HOLD].map((f) => f + ':' + (FF[f].pos.LeftHand.distanceTo(FF[f].pos.RightHand) * 100).toFixed(0)).join(' '));
}
const bladeT = (f) => b0.clone().applyQuaternion(FF[f].D.RightHand), edgeT = (f) => EH.clone().applyQuaternion(FF[f].D.RightHand);
const F_ = [...Array(LEN).keys()];
const tipS = F_.map((f) => (f ? tipW(f).distanceTo(tipW(f - 1)) * 60 : 0));
const angS = F_.map((f) => (f ? deg(bladeT(f).angleTo(bladeT(f - 1))) * 60 : 0));
const sw = F_.filter((f) => f > HOLD && f <= SEND); const vpk = Math.max(...sw.map((f) => tipS[f])); const fpk = sw.find((f) => tipS[f] === vpk);
let ha = fpk, hb = fpk; while (ha - 1 > HOLD && tipS[ha - 1] >= 0.55 * vpk) ha--; while (hb + 1 <= SEND && tipS[hb + 1] >= 0.55 * vpk) hb++;
const azW = F_.map((f) => azOf(bladeT(f))); const fc = sw.find((f) => (azW[f - 1] < 0) !== (azW[f] < 0) && Math.abs(azW[f]) < 90);
const edgeAl = (f) => { const v = tipW(Math.min(LEN - 1, f + 1)).sub(tipW(Math.max(0, f - 1))); const t = bladeT(f); v.sub(t.clone().multiplyScalar(v.dot(t))); return deg(edgeT(f).angleTo(v)); };
console.log('uç hızı (m/s)', sw.map((f) => f + ':' + tipS[f].toFixed(1)).join(' '));
console.log('kenar hizası / ρ kare kare (etkin ±2):', F_.slice(Math.max(HOLD + 1, ha - 2), Math.min(SEND, hb + 2) + 1).map((f) => f + ':' + edgeAl(f).toFixed(0) + '/' + rhoOf(bladeT(f), edgeT(f)).toFixed(0)).join(' '));
console.log(`vuruş: tepe ${vpk.toFixed(1)} m/s (kare ${fpk}), ${Math.max(...sw.map((f) => angS[f])).toFixed(0)}°/sn | etkin kareler ${ha}–${hb} (${(ha / 60).toFixed(3)}–${(hb / 60).toFixed(3)} sn) | temas (bıçak öne) kare ${fc} | uç yüksekliği etkin ${rng(F_.slice(ha, hb + 1).map((f) => (tipW(f).y - GROUND) * 100))} cm | bıçak eğimi ${rng(F_.slice(ha, hb + 1).map((f) => elOf(bladeT(f))))}° | kenar hizası (0 = ideal) ${rng(F_.slice(ha, hb + 1).map(edgeAl))}° | roll ρ ${rng(F_.slice(ha, hb + 1).map((f) => rhoOf(bladeT(f), edgeT(f))))}°`);
const hz = F_.map((f) => FF[f].pos.Hips.clone()); const hy = F_.map((f) => (FF[f].pos.Hips.y - restPos.Hips.y) * 100);
console.log(`kök: ileri ilerleme ${((hz[LEN - 1].z - hz[0].z) * 100).toFixed(1)} cm (bekleme karesine kadar ${((hz[HOLD].z - hz[0].z) * 100).toFixed(1)}), yanal ${((hz[LEN - 1].x - hz[0].x) * 100).toFixed(1)} cm | kalça en alçak ${Math.min(...hy).toFixed(1)} cm (kare ${hy.indexOf(Math.min(...hy))}), beklemede ${hy[HOLD].toFixed(1)} cm`);
const kneeA = (f, s) => { const Pp = FF[f].pos; return deg(Pp[s + 'Leg'].clone().sub(Pp[s + 'UpLeg']).angleTo(Pp[s + 'Foot'].clone().sub(Pp[s + 'Leg']))); };
console.log('diz bükümü (sol/ön, sağ/arka) beklemede', kneeA(HOLD, 'Left').toFixed(0), '/', kneeA(HOLD, 'Right').toFixed(0), '| temasta', fc != null ? kneeA(fc, 'Left').toFixed(0) + '/' + kneeA(fc, 'Right').toFixed(0) : '-', '| yerde bacak erişimi max', Math.max(...diag.flatMap((d) => [d.ground.Left ? d.reach[0] : 0, d.ground.Right ? d.reach[1] : 0])).toFixed(3));
const ftSlide = (s) => { let m = 0; for (let f = 1; f < LEN; f++) if (diag[f].ground[s] && diag[f - 1].ground[s]) { const a = FF[f].pos[s + 'ToeBase'], b = FF[f - 1].pos[s + 'ToeBase']; m = Math.max(m, Math.hypot(a.x - b.x, a.z - b.z)); } return (m * 1000).toFixed(1); };
console.log('yerdeki ayak parmağı kayması max (mm/kare) sol/sağ', ftSlide('Left'), '/', ftSlide('Right'));

const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };

// ---- şarjlı önizleme: bekleme karesi 0,6 sn tutulur, sonrası 1,3× hızlı (yalnız önizleme; Unity'ye gitmez) ----
function chargedPreview(src, hold = 36, speed = 1.3) {
  const outT = {}; const n0 = src.length; const tail = (n0 - 1 - HOLD) / speed; const NT = Math.round(tail);
  const sample = (tr, ft) => { const a = Math.floor(ft), b = Math.min(n0 - 1, a + 1), w = ft - a; const qa = Q(tr.rot[a].slice(1)), qb = Q(tr.rot[b].slice(1)); return qa.slerp(qb, w); };
  const frames = []; for (let f = 0; f <= HOLD; f++) frames.push(f); for (let k = 0; k < hold; k++) frames.push(HOLD); for (let k = 1; k <= NT; k++) frames.push(HOLD + (n0 - 1 - HOLD) * k / NT);
  for (const [n, tr] of Object.entries(src.tracks)) { outT[n] = { rot: frames.map((ft, i) => { const q = sample(tr, ft); return [i, q.x, q.y, q.z, q.w]; }) };
    if (tr.pos) outT[n].pos = frames.map((ft, i) => { const a = Math.floor(ft), b = Math.min(n0 - 1, a + 1), w = ft - a; return [i, ...[1, 2, 3].map((c) => tr.pos[a][c] * (1 - w) + tr.pos[b][c] * w)]; }); }
  return { name: PREVIEW, fps: 60, length: frames.length, loop: true, tracks: outT, holdFrames: [HOLD, HOLD + hold] };
}
// ---- L3 → H3 → idle (1 sn) art arda (yalnız editöre yüklenir, kaydedilmez); idle kalçası H3'ün yatay kök konumuna kaydırılır ----
function l3Then(src) {
  const L3 = A3.A; const outT = {}; const n3 = L3.length;
  for (const [n, tr] of Object.entries(src.tracks)) { const t3 = L3.tracks[n];
    const r3 = Array.from({ length: n3 - 1 }, (_, f) => { const k = t3 && t3.rot && t3.rot.length ? keyAt(t3.rot, f) : [0, ...by[n].restQ]; return [f, ...k.slice(1)]; });
    outT[n] = { rot: [...r3, ...tr.rot.map((k) => [k[0] + n3 - 1, ...k.slice(1)])] };
    if (tr.pos) { const p3 = Array.from({ length: n3 - 1 }, (_, f) => [f, ...keyAt(L3.tracks[n].pos, f).slice(1)]); outT[n].pos = [...p3, ...tr.pos.map((k) => [k[0] + n3 - 1, ...k.slice(1)])]; } }
  const NI = 60, o = n3 - 1 + src.length, IA = IDLE.A, hl = src.tracks.Hips.pos[src.length - 1], i0 = keyAt(IA.tracks.Hips.pos, 0);
  for (const n of Object.keys(outT)) { const ti = IA.tracks[n]; const last = outT[n].rot[outT[n].rot.length - 1];
    for (let f = 1; f <= NI; f++) outT[n].rot.push([o + f - 1, ...(ti && ti.rot && ti.rot.length ? keyAt(ti.rot, f).slice(1) : last.slice(1))]);
    if (outT[n].pos) for (let f = 1; f <= NI; f++) { const k = keyAt(IA.tracks.Hips.pos, f); outT[n].pos.push([o + f - 1, k[1] - i0[1] + hl[1], k[2] - i0[2] + hl[2], k[3]]); } }
  return { name: 'onizleme_L3_H3_idle', fps: 60, length: o + NI, loop: true, tracks: outT };
}
const post = async (url, body) => (await fetch(BASE + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
if (!NOSEND) {
  const prv = chargedPreview(anim); console.log('şarjlı önizleme:', prv.length, 'kare, bekleme', prv.holdFrames.join('–'));
  if (!ARGS.includes('--nosave')) {
    console.log('kaydedildi', await post('/api/animations/save?name=' + NAME, anim));
    const { holdFrames, ...pv } = prv; console.log('kaydedildi', await post('/api/animations/save?name=' + PREVIEW, pv));
  }
  if (ARGS.includes('--l3')) console.log(PORT + ' yüklendi (L3→H3→idle)', await post('/api/claude/anim', { anim: l3Then(anim) }));
  else console.log(PORT + ' yüklendi', await post('/api/claude/anim', { anim }));
}
