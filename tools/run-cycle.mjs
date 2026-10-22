// Run cycle üretici: pozlar DÜNYA eksenlerinde tanımlanır (+Z ileri, +X karakterin solu, +Y yukarı),
// kemik local eksenlerine (Mixamo'da world'e hizalı değil) FK ile çevrilir. Sonuç editöre /api/claude/anim ile gider.
import * as THREE from 'three';
const BASE = 'http://127.0.0.1:' + (process.env.ANIMREF_PORT || 5177);
const st = await (await fetch(BASE + '/api/state')).json();
const P = 'mixamorig';
const bones = st.rig.bones; const by = Object.fromEntries(bones.map((b) => [b.name, b]));
const rad = THREE.MathUtils.degToRad;
const Rx = (d) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), rad(d));
const Ry = (d) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad(d));
const Rz = (d) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(d));
const mul = (...qs) => qs.reduce((a, b) => a.clone().multiply(b));

const restW = {}; // rest dünya oryantasyonu
for (const b of bones) { const q = new THREE.Quaternion(...b.restQ); restW[b.name] = b.parent ? restW[b.parent].clone().multiply(q) : q; }

const FRAMES = 24, FPS = 30; // 24 karede 1 tam döngü (0.8 sn)
const tracks = {};
for (let f = 0; f <= FRAMES; f++) {
  const ph = (2 * Math.PI * f) / FRAMES;
  const D = {}; // kemik adı -> dünya-uzayı delta
  const side = (s, phi, sgn) => { // s: 'Left'|'Right', sgn: Left +1 / Right -1
    const thighF = 7.5 + 37.5 * Math.sin(phi);                       // ileri açı
    const knee = 20 + 70 * Math.pow(Math.max(0, Math.cos(phi + 0.35)), 2);
    const shin = -thighF + knee;                                      // + = geri
    D[P + s + 'UpLeg'] = Rx(-thighF);
    D[P + s + 'Leg'] = Rx(shin);
    D[P + s + 'Foot'] = Rx(-shin * 0.8 + 10);
    const armF = 42 * Math.sin(phi + Math.PI);                        // karşı bacakla ters
    const elbow = 85 + 10 * Math.sin(phi + Math.PI);
    const down = -sgn * 72;                                           // kolu T'den aşağı indir
    D[P + s + 'Arm'] = mul(Rx(-armF), Rz(down));
    // Ön kol: kullanıcının 19. karedeki pozundan türetilen yön (dünya uzayı): geriye bakar, aşağı/yukarı salınır.
    const phi19 = (2 * Math.PI * 19) / FRAMES;
    const target = new THREE.Vector3(-0.25 * sgn, -0.8 * Math.cos(phi - phi19 + (sgn > 0 ? 0 : 0)), -0.6).normalize();
    const hand = by[P + s + 'Hand'];
    const restDir = new THREE.Vector3(...hand.restP).applyQuaternion(restW[P + s + 'ForeArm']).normalize();
    D[P + s + 'ForeArm'] = new THREE.Quaternion().setFromUnitVectors(restDir, target);
    D[P + s + 'Hand'] = D[P + s + 'ForeArm'];
  };
  side('Left', ph, 1); side('Right', ph + Math.PI, -1);
  D[P + 'Hips'] = mul(Ry(-8 * Math.sin(ph)), Rx(8));
  D[P + 'Spine'] = mul(Ry(-2 * Math.sin(ph)), Rx(11));
  D[P + 'Spine1'] = mul(Ry(4 * Math.sin(ph)), Rx(13));
  D[P + 'Spine2'] = mul(Ry(8 * Math.sin(ph)), Rx(14));
  D[P + 'Neck'] = Rx(8);
  D[P + 'Head'] = Rx(2);

  const cur = {};
  for (const b of bones) {
    const par = b.parent ? cur[b.parent] : new THREE.Quaternion();
    let local;
    if (D[b.name]) local = par.clone().invert().multiply(D[b.name].clone().multiply(restW[b.name]));
    else local = new THREE.Quaternion(...b.restQ);
    cur[b.name] = par.clone().multiply(local);
    if (D[b.name]) (tracks[b.name] ||= { rot: [] }).rot.push([f, local.x, local.y, local.z, local.w]);
  }
  const hips = by[P + 'Hips'];
  (tracks[P + 'Hips'].pos ||= []).push([f, hips.restP[0], hips.restP[1] - 3 + 3 * Math.cos(2 * ph), hips.restP[2]]);
}
const anim = { name: 'run', fps: FPS, length: FRAMES + 1, loop: true, tracks };
const r = await (await fetch(BASE + '/api/claude/anim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anim }) })).json();
console.log('run animasyonu gönderildi', r, Object.keys(tracks).length, 'track');
