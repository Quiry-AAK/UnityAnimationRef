// game_hit_react / game_hit_react_heavy üretici: önden gelen darbeye sarsılma (Aşama 3, G15).
// Taban = game_katana_idle[0]; ilk ve son kare idle[0]'a birebir eşit (dikişsiz). Üstüne dünya ekseninde katmanlar eklenir:
// kalça geri/aşağı, omurga aşağıdan yukarı kırbaçla geriye savrulur (göğüs gecikmeli), baş en geç ve en çok, kollar
// eylemsizlikle öne-dışa açılır (kılıç ucu düşer, katana elde), dirsekler menteşe ekseninde. El ve parmak yerel dönüşleri
// idle'daki gibi kalır → bilek açısı idle[0] ile aynı (bilek bütçesi korunur). Bacaklar iki kemikli IK ile: hafifte ayaklar
// yerinde (ağırlık arka ayağa), ağırda arka (sağ) ayak geri tutunma adımı atar, toparlanmada yerine döner.
// Yatay geri itmeyi oyun kodu yapar (knockback kaydırması); klip yerinde biter.
// Çalıştır: node hit-react.mjs <editorUrl> [--heavy] [--nosend]   (editorUrl: MCP get_status → editorUrl; sabit port yok)
import * as THREE from 'file:///C:/AnimRef/node_modules/three/build/three.module.js';
import fs from 'fs';
const ARGS = process.argv.slice(2);
const BASE = ARGS.find((a) => /^https?:\/\//.test(a));
if (!BASE) { console.error('kullanım: node hit-react.mjs <editorUrl> [--heavy] [--nosend]'); process.exit(1); }
const HEAVY = ARGS.includes('--heavy'), NOSEND = ARGS.includes('--nosend');
const NAME = HEAVY ? 'game_hit_react_heavy' : 'game_hit_react';
const st = await (await fetch(BASE + '/api/state')).json();
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad, deg = THREE.MathUtils.radToDeg;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = (a) => new THREE.Quaternion(...a);
const AX = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
const rot = (axis, d) => new THREE.Quaternion().setFromAxisAngle(axis, rad(d));
// dünya farkı: [yaw (Y, + sola), pitch (X, + öne), roll (Z, + karakterin soluna yatma)]
const eul = (e) => rot(AX.y, e[0]).multiply(rot(AX.x, e[1])).multiply(rot(AX.z, e[2]));
const qAng = (a, b) => deg(2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))));

const restW = {}, restPos = {};
for (const b of bones) {
  const q = Q(b.restQ);
  if (!b.parent) { restW[b.name] = q; restPos[b.name] = V(...b.restP); }
  else { restW[b.name] = restW[b.parent].clone().multiply(q); restPos[b.name] = restPos[b.parent].clone().add(V(...b.restP).applyQuaternion(restW[b.parent])); }
}
const armQ = Q(by.Armature.restQ);

// ---- idle[0] FK ----
const IDLE = JSON.parse(fs.readFileSync('C:/AnimRef/animations/game_katana_idle.json', 'utf8'));
const k0 = (t) => (t && t.rot && t.rot.length ? Q(t.rot[0].slice(1)) : null);
const iLocal = {}, iCur = {}, iPos = {};
const iHl = IDLE.tracks.Hips.pos[0].slice(1);
const hipsLocalToWorld = (hl) => restPos.Hips.clone().add(V(hl[0] - by.Hips.restP[0], hl[1] - by.Hips.restP[1], hl[2] - by.Hips.restP[2]).applyQuaternion(armQ));
const iHips = hipsLocalToWorld(iHl);
for (const b of bones) {
  if (!b.parent) { iCur[b.name] = Q(b.restQ); iPos[b.name] = V(...b.restP); continue; }
  const l = k0(IDLE.tracks[b.name]) || Q(b.restQ); iLocal[b.name] = l;
  iCur[b.name] = iCur[b.parent].clone().multiply(l);
  iPos[b.name] = b.parent === 'Armature' ? iHips.clone() : iPos[b.parent].clone().add(V(...b.restP).applyQuaternion(iCur[b.parent]));
}

// ---- eğri: tek yönlü kübik (Fritsch–Carlson; aşma yok) ----
const asArr = (v) => (Array.isArray(v) ? v : [v]);
function spl(keys, f) {
  const n = keys.length; if (f <= keys[0][0]) return keys[0][1]; if (f >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0; while (i < n - 2 && f > keys[i + 1][0]) i++;
  const arr = Array.isArray(keys[0][1]); const C = asArr(keys[0][1]).length; const out = [];
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
const sst = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * t * (10 - 15 * t + 6 * t * t); };

// ---- zaman çizelgesi ve katmanlar ----
// Darbe 0. karede gelir (oyun hit stop'u bunun üstüne). Kalça 1–2 karede tepki verir, göğüs 1 kare, baş 2–3 kare gecikir
// (kırbaç). Hafif: 27 kare (0,45 sn), tepe ~6, toparlanma 12–26. Ağır: 46 kare (0,77 sn), tepe ~10, tutunma adımı 4–13,
// sendeleme 13–22, geri kurulma adımı 24–34, oturma 34–45.
const S = HEAVY ? 1.0 : 0.5;     // genlik ölçeği (ağır = 1)
const LEN = HEAVY ? 46 : 27;
const IMPACT = 0;
// her kanal: [kare, değer] — açılar derece, konumlar m (dünya: +Z ileri, +Y yukarı, +X karakterin solu)
const K = HEAVY ? {
  hz: [[0, 0], [4, -0.07], [10, -0.17], [16, -0.2], [22, -0.17], [28, -0.08], [35, -0.01], [40, 0.008], [45, 0]],
  hy: [[0, 0], [5, -0.05], [11, -0.1], [17, -0.11], [24, -0.06], [30, -0.035], [36, -0.03], [41, -0.012], [45, 0]],
  hx: [[0, 0], [8, -0.025], [16, -0.03], [28, -0.01], [45, 0]],
  pel: [[0, [0, 0, 0]], [4, [5, -9, -2]], [10, [8, -12, -3]], [17, [6, -7, -2]], [26, [2, 0, 0]], [33, [0, 3, 0]], [40, [0, 0.8, 0]], [45, [0, 0, 0]]],
  sp: [[0, [0, 0, 0]], [3, [2, -7, -1]], [7, [5, -13, -2]], [12, [5, -10, -2]], [19, [3, -3, -1]], [27, [1, 3, 0]], [34, [0, 2.5, 0]], [41, [0, 0.4, 0]], [45, [0, 0, 0]]],
  head: [[0, [0, 0, 0]], [2, [0, 2, 0]], [6, [4, -17, 4]], [10, [6, -14, 3]], [15, [3, 1, 0]], [21, [1, 7, -1]], [28, [0, 2, 0]], [36, [0, 0.5, 0]], [45, [0, 0, 0]]],
  // kollar: üst kol dünya dönüşü (omuzdan, tüm kol), dirsek menteşesi (+ büker, − açar)
  rArm: [[0, [0, 0, 0]], [3, [-6, 8, -10]], [8, [-10, 16, -18]], [14, [-8, 10, -12]], [22, [-3, 2, -4]], [30, [0, -1, 0]], [38, [0, 0, 0]], [45, [0, 0, 0]]],
  rElb: [[0, 0], [4, -10], [9, -18], [16, -8], [25, 2], [33, 0], [45, 0]],
  lArm: [[0, [0, 0, 0]], [3, [6, 10, 14]], [9, [10, 20, 24]], [15, [7, 12, 14]], [24, [2, 2, 3]], [32, [0, -1, 0]], [40, [0, 0, 0]], [45, [0, 0, 0]]],
  lElb: [[0, 0], [4, -12], [10, -22], [17, -10], [26, 2], [34, 0], [45, 0]],
} : {
  hz: [[0, 0], [3, -0.035], [6, -0.06], [10, -0.055], [16, -0.025], [22, -0.004], [26, 0]],
  hy: [[0, 0], [3, -0.02], [6, -0.04], [11, -0.035], [17, -0.012], [26, 0]],
  hx: [[0, 0], [5, -0.012], [12, -0.008], [26, 0]],
  pel: [[0, [0, 0, 0]], [2, [3, -5, -1]], [5, [5, -8, -2]], [10, [3, -4, -1]], [16, [1, 1, 0]], [21, [0, 1, 0]], [26, [0, 0, 0]]],
  sp: [[0, [0, 0, 0]], [2, [1, -5, -1]], [5, [4, -10, -2]], [9, [3, -6, -1]], [14, [1, 2, 0]], [19, [0, 1.5, 0]], [26, [0, 0, 0]]],
  head: [[0, [0, 0, 0]], [2, [0, 2, 0]], [5, [3, -13, 3]], [8, [4, -9, 2]], [12, [1, 4, 0]], [17, [0, 2, 0]], [22, [0, 0.3, 0]], [26, [0, 0, 0]]],
  rArm: [[0, [0, 0, 0]], [2, [-4, 6, -7]], [6, [-7, 11, -12]], [11, [-4, 4, -5]], [17, [-1, -1, 0]], [22, [0, 0, 0]], [26, [0, 0, 0]]],
  rElb: [[0, 0], [3, -7], [7, -12], [12, -3], [18, 1], [26, 0]],
  lArm: [[0, [0, 0, 0]], [2, [4, 7, 10]], [7, [7, 13, 17]], [12, [3, 4, 5]], [18, [0, -1, 0]], [26, [0, 0, 0]]],
  lElb: [[0, 0], [3, -8], [8, -15], [13, -4], [19, 1], [26, 0]],
};
// omurga payları (aşağıdan yukarı kırbaç: üst segment daha geç ve biraz daha çok) ve boyun/baş payları
const SPINE = [['Spine02', 0.3, 0], ['Spine01', 0.33, 0.7], ['Spine', 0.37, 1.4]];
const HEADS = [['neck', 0.4, 2.0], ['Head', 0.6, 2.6]];
const at = (keys, f, lag = 0) => spl(keys, Math.max(0, f - lag));

// ---- ayaklar ----
// ağır: arka (sağ) ayak geri tutunma adımı (4–13) ve geri kurulma adımı (24–34); ön (sol) ayak ağırlık arkaya geçince
// topukta hafif açılır (parmaklar kalkar), sonra iner. hafif: iki ayak yerde, ön ayak parmakları çok az kalkar.
function footAt(side, f) {
  const a0 = iPos[side + 'Foot'].clone(); let lift = 0, pitchUp = 0, back = 0;
  if (HEAVY && side === 'Right') {
    const s1 = sst((f - 4) / 9), s2 = sst((f - 24) / 10);
    back = 0.2 * s1 - 0.2 * s2;
    lift = 0.07 * Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 4) / 9))) + 0.05 * Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 24) / 10)));
  }
  if (side === 'Left') pitchUp = HEAVY ? spl([[0, 0], [5, 10], [13, 14], [20, 6], [27, 0], [45, 0]], f) : spl([[0, 0], [4, 4], [8, 5], [13, 0], [26, 0]], f);
  return { ankle: a0.add(V(0, lift, -back)), pitchUp };
}

// ---- dirsek menteşe ekseni (idle'dan) ----
const elbowAxis = (side, cur) => {
  const u = iPos[side + 'ForeArm'].clone().sub(iPos[side + 'Arm']).normalize(), fd = iPos[side + 'Hand'].clone().sub(iPos[side + 'ForeArm']).normalize();
  return u.cross(fd).normalize().applyQuaternion(cur);
};
const L1 = { Left: iPos.LeftLeg.distanceTo(iPos.LeftUpLeg), Right: iPos.RightLeg.distanceTo(iPos.RightUpLeg) };
const L2 = { Left: iPos.LeftFoot.distanceTo(iPos.LeftLeg), Right: iPos.RightFoot.distanceTo(iPos.RightLeg) };

function solve(f) {
  const A = {}; const I = new THREE.Quaternion();
  const pel = at(K.pel, f, 0);
  // kalça: dönüş + konum
  A.Hips = eul(pel);
  const sp = SPINE.map(([n, w, lag]) => [n, at(K.sp, f, lag).map((v) => v * w)]);
  let acc = A.Hips.clone(); for (const [n, e] of sp) { acc = eul(e).multiply(acc); A[n] = acc.clone(); }
  for (const [n, w, lag] of HEADS) { const e = at(K.head, f, lag).map((v) => v * w); acc = eul(e).multiply(acc); A[n] = acc.clone(); }
  const chestA = A.Spine.clone();
  A.LeftShoulder = chestA.clone(); A.RightShoulder = chestA.clone();
  A.RightArm = eul(at(K.rArm, f)).multiply(chestA); A.LeftArm = eul(at(K.lArm, f)).multiply(chestA);
  A.RightForeArm = rot(elbowAxis('Right', A.RightArm), at(K.rElb, f)).multiply(A.RightArm);
  A.LeftForeArm = rot(elbowAxis('Left', A.LeftArm), at(K.lElb, f)).multiply(A.LeftArm);
  // dünya yönelimleri: A'sı olmayan kemik ebeveyninin A'sını taşır (yerel dönüşü idle'daki gibi kalır)
  const cur = {}, Ab = {};
  for (const b of bones) {
    if (!b.parent) { cur[b.name] = iCur[b.name].clone(); Ab[b.name] = I.clone(); continue; }
    Ab[b.name] = A[b.name] ? A[b.name] : Ab[b.parent];
    cur[b.name] = Ab[b.name].clone().multiply(iCur[b.name]);
  }
  const hips = iHips.clone().add(V(at(K.hx, f), at(K.hy, f), at(K.hz, f)));
  const pos = {};
  const fk = () => { for (const b of bones) { if (!b.parent) { pos[b.name] = V(...b.restP); continue; }
    pos[b.name] = b.parent === 'Armature' ? hips.clone() : pos[b.parent].clone().add(V(...b.restP).applyQuaternion(cur[b.parent])); } };
  fk();
  // bacak IK: idle'daki diz düzlemi korunur (en kısa yay döndürmesi), ayak dünya yönelimi idle'daki gibi (+ ön ayak parmak kalkışı)
  const legInfo = {};
  for (const s of ['Left', 'Right']) {
    const { ankle, pitchUp } = footAt(s, f);
    const hipJ = pos[s + 'UpLeg'];
    const a = L1[s], b2 = L2[s];
    let dv = ankle.clone().sub(hipJ); let d = dv.length(); const dir = dv.clone().normalize(); const dRaw = d;
    d = Math.min(d, a + b2 - 1e-3);
    const iKnee = iPos[s + 'Leg'], iHip = iPos[s + 'UpLeg'], iAnk = iPos[s + 'Foot'];
    const iDir = iAnk.clone().sub(iHip).normalize();
    const poleI = iKnee.clone().sub(iHip); poleI.sub(iDir.clone().multiplyScalar(poleI.dot(iDir)));
    const pole = poleI.clone().applyQuaternion(new THREE.Quaternion().setFromUnitVectors(iDir, dir)); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
    const x = (a * a - b2 * b2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
    const knee = hipJ.clone().add(dir.clone().multiplyScalar(x)).add(pole.multiplyScalar(h));
    const ank = hipJ.clone().add(dir.clone().multiplyScalar(d));
    const thI = iKnee.clone().sub(iHip).normalize(), shI = iAnk.clone().sub(iKnee).normalize();
    const qT = new THREE.Quaternion().setFromUnitVectors(thI, knee.clone().sub(hipJ).normalize());
    cur[s + 'UpLeg'] = qT.clone().multiply(iCur[s + 'UpLeg']);
    const shNow = shI.clone().applyQuaternion(qT);
    const qS = new THREE.Quaternion().setFromUnitVectors(shNow, ank.clone().sub(knee).normalize());
    cur[s + 'Leg'] = qS.clone().multiply(qT).multiply(iCur[s + 'Leg']);
    // ayak: dünya yönelimi idle; parmak kalkışı ayağın yan ekseninde (dünya X ≈ yan)
    cur[s + 'Foot'] = rot(AX.x, -pitchUp).multiply(iCur[s + 'Foot']);
    const toe = s + 'ToeBase'; cur[toe] = cur[s + 'Foot'].clone().multiply(iLocal[toe]);
    const bend = 180 - deg(knee.clone().sub(hipJ).angleTo(ank.clone().sub(knee))) ; // 180 = düz
    legInfo[s] = { reachShort: dRaw - d, knee: 180 - bend };
  }
  fk();
  // yerel dönüşler
  const out = {};
  for (const b of bones) { if (!b.parent) continue; out[b.name] = cur[b.parent].clone().invert().multiply(cur[b.name]); }
  const off = hips.clone().sub(restPos.Hips).applyQuaternion(armQ.clone().invert());
  const hl = by.Hips.restP; const hipsLocal = [hl[0] + off.x, hl[1] + off.y, hl[2] + off.z];
  return { out, hipsLocal, pos, cur, legInfo };
}

// ---- kılıç ucu (prop yönü, el çerçevesinde) ----
const prop = st.props?.find((p) => p.id === 'katana');
const pr = prop ? prop.rot : [-25.281, -54.674, -2.581];
const Qp = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(pr[0]), rad(pr[1]), rad(pr[2]), 'XYZ'));
const bladeLocal = V(0, 0, 1).applyQuaternion(Qp).normalize().applyQuaternion(restW.RightHand.clone().invert());

const tracks = {}; const prev = {}; const diag = [];
for (let f = 0; f < LEN; f++) {
  const { out, hipsLocal, pos, cur, legInfo } = solve(f);
  for (const [n, q] of Object.entries(out)) {
    const pq = prev[n]; if (pq && pq.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); prev[n] = q.clone();
    (tracks[n] ||= { rot: [] }).rot.push([f, q.x, q.y, q.z, q.w]);
  }
  (tracks.Hips.pos ||= []).push([f, ...hipsLocal]);
  const bdir = bladeLocal.clone().applyQuaternion(cur.RightHand);
  const tip = pos.RightHand.clone().add(bdir.clone().multiplyScalar(0.95));
  diag.push({ f, tip, head: pos.Head.clone(), hips: pos.Hips.clone(), legInfo, lHand: pos.LeftHand.clone(), rHand: pos.RightHand.clone(),
    wristR: qAng(out.RightHand, iLocal.RightHand), wristL: qAng(out.LeftHand, iLocal.LeftHand) });
}
// dikiş kontrolü: ilk/son kare ile idle[0] farkı
let seam0 = 0, seamN = 0;
for (const n of Object.keys(tracks)) { if (!iLocal[n]) continue; const r = tracks[n].rot;
  seam0 = Math.max(seam0, qAng(Q(r[0].slice(1)), iLocal[n])); seamN = Math.max(seamN, qAng(Q(r[LEN - 1].slice(1)), iLocal[n])); }
const fmt = (v) => `(${(v.x * 100).toFixed(0)},${(v.y * 100).toFixed(0)},${(v.z * 100).toFixed(0)})`;
console.log(NAME, 'kare', LEN, `(${(LEN / 60).toFixed(2)} sn)`, '| dikiş° ilk', seam0.toFixed(3), 'son', seamN.toFixed(3));
console.log('bilek yerel farkı (idle[0]\'a göre, °) sağ max', Math.max(...diag.map((d) => d.wristR)).toFixed(3), 'sol max', Math.max(...diag.map((d) => d.wristL)).toFixed(3));
const d0 = diag[0];
for (const d of diag.filter((d, i) => i % 3 === 0 || i === LEN - 1)) {
  console.log(`k${String(d.f).padStart(2)} uç Δcm ${fmt(d.tip.clone().sub(d0.tip))} baş Δ ${fmt(d.head.clone().sub(d0.head))} kalça Δ ${fmt(d.hips.clone().sub(d0.hips))}`
    + ` diz L/R ${d.legInfo.Left.knee.toFixed(0)}/${d.legInfo.Right.knee.toFixed(0)} erişim eksiği ${(d.legInfo.Left.reachShort * 100).toFixed(1)}/${(d.legInfo.Right.reachShort * 100).toFixed(1)}cm`);
}
let mxStep = 0; for (let i = 1; i < LEN; i++) mxStep = Math.max(mxStep, diag[i].tip.distanceTo(diag[i - 1].tip));
console.log('kılıç ucu max hız cm/kare', (mxStep * 100).toFixed(1), '| sol el idle\'dan max uzaklık cm', (Math.max(...diag.map((d) => d.lHand.distanceTo(d0.lHand))) * 100).toFixed(1));
const anim = { name: NAME, fps: 60, length: LEN, loop: false, tracks };
if (!NOSEND) {
  const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json(); console.log(r);
  const s = await (await fetch(BASE + '/api/animations/save?name=' + anim.name, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) })).json(); console.log('kaydedildi', s);
}
