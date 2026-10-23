import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { initVfx } from './vfx.js';
import { initMaterials } from './material.js';

const $ = (s) => document.querySelector(s);
const toast = (msg, type) => { // type: 'ok' | 'err' (yoksa mesajdan tahmin)
  const t = $('#toast'); msg = String(msg); type ||= /^hata|hatas|bulunamad|geçersiz|açık değil/i.test(msg) ? 'err' : '';
  t.textContent = msg; t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), type === 'err' ? 5000 : 2800);
};
const api = (path, body, method = 'POST') => fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json());

// ───────────────────────── sahne
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.prepend(renderer.domElement);
const scene = new THREE.Scene();
const BG = 0x2b2f36;
scene.background = new THREE.Color(BG);
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(2.2, 1.4, 3.4);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.9, 0);
orbit.update();
scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(2, 4, 3); scene.add(sun);
const grid = new THREE.GridHelper(6, 12, 0x5a6275, 0x3a4150); scene.add(grid);
const stage = new THREE.Group(); scene.add(stage);
const overlay = new THREE.Group(); scene.add(overlay); // marker + iskelet çizgileri

const tc = new TransformControls(camera, renderer.domElement);
tc.setSize(0.8); tc.setSpace('local');
const tcHelper = tc.getHelper(); scene.add(tcHelper);

function onResize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  updateGuide();
}
new ResizeObserver(onResize).observe(viewport);

// ───────────────────────── veri
const newAnim = () => ({ name: 'anim', fps: 30, length: 60, loop: true, tracks: {} });
let anim = newAnim();
let rig = null; // { bones:[{name,parent,restQ,restP,obj,marker}], byName:Map, unitScale, modelName }
let sel = null;
let curFrame = 0;
let playing = false;
let poseClip = null;
let mode = 'anim'; // editör modu: 'anim' | 'vfx'

const undoStack = [], redoStack = [];
const pushUndo = () => { undoStack.push(JSON.stringify(anim)); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; };
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(anim)); anim = JSON.parse(undoStack.pop()); afterAnimReplaced(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(anim)); anim = JSON.parse(redoStack.pop()); afterAnimReplaced(); }

function normalizeAnim(a) {
  a = a || {};
  return { name: a.name || 'anim', fps: a.fps || 30, length: Math.max(2, a.length || 60), loop: a.loop !== false, tracks: a.tracks || {} };
}

let syncTimer = null;
const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => api('/api/anim', anim).catch(() => {}), 250); };

function afterAnimReplaced() {
  anim = normalizeAnim(anim);
  curFrame = Math.min(curFrame, anim.length - 1);
  $('#animName').value = anim.name; $('#animFps').value = anim.fps; $('#animLen').value = anim.length; $('#animLoop').checked = anim.loop;
  refreshPose(); refreshBoneList(); uiUpdate(); scheduleSync();
}

// ───────────────────────── track yardımcıları
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function findSeg(arr, f) { // arr[i][0] <= f < arr[i+1][0]
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m][0] <= f) lo = m; else hi = m; }
  return lo;
}
function evalRot(arr, f, out) {
  if (f <= arr[0][0]) return out.set(arr[0][1], arr[0][2], arr[0][3], arr[0][4]);
  const last = arr[arr.length - 1];
  if (f >= last[0]) return out.set(last[1], last[2], last[3], last[4]);
  const i = findSeg(arr, f), a = arr[i], b = arr[i + 1], t = (f - a[0]) / (b[0] - a[0]);
  qa.set(a[1], a[2], a[3], a[4]); qb.set(b[1], b[2], b[3], b[4]);
  return out.copy(qa).slerp(qb, t);
}
function evalPos(arr, f, out) {
  if (f <= arr[0][0]) return out.set(arr[0][1], arr[0][2], arr[0][3]);
  const last = arr[arr.length - 1];
  if (f >= last[0]) return out.set(last[1], last[2], last[3]);
  const i = findSeg(arr, f), a = arr[i], b = arr[i + 1], t = (f - a[0]) / (b[0] - a[0]);
  return out.set(a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t);
}
function putKey(arr, key) {
  const i = arr.findIndex((k) => k[0] >= key[0]);
  if (i === -1) arr.push(key);
  else if (arr[i][0] === key[0]) arr[i] = key;
  else arr.splice(i, 0, key);
}
const getTrack = (name) => (anim.tracks[name] ||= {});
function setRotKey(b, f, q) {
  const t = getTrack(b.name); t.rot ||= [];
  if (!t.rot.length && f !== 0) t.rot.push([0, ...b.restQ]);
  putKey(t.rot, [f, q.x, q.y, q.z, q.w]);
}
function setPosKey(b, f, p) {
  const t = getTrack(b.name); t.pos ||= [];
  if (!t.pos.length && f !== 0) t.pos.push([0, ...b.restP]);
  putKey(t.pos, [f, p.x, p.y, p.z]);
}
function delKeysAt(name, f) {
  const t = anim.tracks[name]; if (!t) return;
  for (const k of ['rot', 'pos']) if (t[k]) t[k] = t[k].filter((x) => x[0] !== f);
  if (!(t.rot?.length) && !(t.pos?.length)) delete anim.tracks[name];
}
const hasKeyAt = (name, f) => { const t = anim.tracks[name]; return !!t && (t.rot?.some((k) => k[0] === f) || t.pos?.some((k) => k[0] === f)); };

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function refreshPose(frame = curFrame) {
  if (!rig) return;
  for (const b of rig.bones) {
    const t = anim.tracks[b.name];
    if (t?.rot?.length) evalRot(t.rot, frame, _q); else _q.set(...b.restQ);
    b.obj.quaternion.copy(_q);
    if (t?.pos?.length) evalPos(t.pos, frame, _v); else _v.set(...b.restP);
    b.obj.position.copy(_v);
  }
}

// ───────────────────────── rig kurulumu
const markerGeo = new THREE.SphereGeometry(0.022, 10, 8);
const matIdle = new THREE.MeshBasicMaterial({ color: 0x66b8ff, depthTest: false, transparent: true, opacity: 0.85 });
const matSel = new THREE.MeshBasicMaterial({ color: 0xffc233, depthTest: false });
let lines = null;

function clearModel() {
  tc.detach(); sel = null;
  stage.clear(); overlay.clear(); lines = null; rig = null;
  stage.scale.setScalar(1); stage.position.set(0, 0, 0);
}

function buildRig(root, modelName) {
  const bones = []; const byName = new Map();
  // FBXLoader, skin için aynı isimli çocuk "kopya" kemikler üretir (parent ile aynı ad); bunları atla
  root.traverse((o) => { if (o.isBone && !(o.parent?.isBone && o.parent.name === o.name) && !byName.has(o.name)) { const e = { name: o.name, obj: o, parent: o.parent?.isBone ? o.parent.name : null, restQ: o.quaternion.toArray(), restP: o.position.toArray() }; bones.push(e); byName.set(o.name, e); } });
  if (!bones.length) throw new Error('Modelde kemik (skeleton) bulunamadı');
  for (const b of bones) { const q = new THREE.Quaternion(...b.restQ); b.restWQ = b.parent ? byName.get(b.parent).restWQ.clone().multiply(q) : q; }
  stage.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const b of bones) box.expandByPoint(b.obj.getWorldPosition(new THREE.Vector3()));
  const h = Math.max(box.max.y - box.min.y, 1e-3);
  const s = 1.7 / h;
  stage.scale.setScalar(s); stage.position.y = -box.min.y * s;
  rig = { bones, byName, unitScale: h > 10 ? 0.01 : 1, modelName };
  for (const b of bones) {
    const m = new THREE.Mesh(markerGeo, matIdle); m.userData.bone = b; m.renderOrder = 10; if (/Hand(Thumb|Index|Middle|Ring|Pinky)|Toe/.test(b.name)) m.scale.setScalar(0.45); overlay.add(m); b.marker = m;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bones.length * 6), 3));
  lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x9fd0ff, depthTest: false, transparent: true, opacity: 0.6 }));
  lines.frustumCulled = false; lines.renderOrder = 9; overlay.add(lines);
  api('/api/rig', { modelName, rig: { unitScale: rig.unitScale, bones: bones.map(({ name, parent, restQ, restP }) => ({ name, parent, restQ, restP })) } });
  refreshBoneList(); fillPropBones();
  selectBone(byName.get(guessName(byName, 'Hips')) || bones[0]);
}
const guessName = (byName, part) => [...byName.keys()].find((n) => n.endsWith(part)) || '';

function updateOverlay() {
  if (!rig) return;
  stage.updateMatrixWorld(true);
  const arr = lines.geometry.attributes.position.array; const p = new THREE.Vector3(), pp = new THREE.Vector3();
  rig.bones.forEach((b, i) => {
    b.obj.getWorldPosition(p); b.marker.position.copy(p);
    b.marker.material = b === sel ? matSel : matIdle;
    const par = b.parent ? rig.byName.get(b.parent).obj.getWorldPosition(pp) : p;
    arr.set([p.x, p.y, p.z, par.x, par.y, par.z], i * 6);
  });
  lines.geometry.attributes.position.needsUpdate = true;
}

// ───────────────────────── demo rig (Mixamo isimli prosedürel iskelet, cm)
const DEMO = [
  ['Hips', null, [0, 100, 0]], ['Spine', 'Hips', [0, 10, 0]], ['Spine1', 'Spine', [0, 12, 0]], ['Spine2', 'Spine1', [0, 14, 0]],
  ['Neck', 'Spine2', [0, 16, 0]], ['Head', 'Neck', [0, 10, 0]], ['HeadTop_End', 'Head', [0, 22, 0]],
  ...['Left', 'Right'].flatMap((s, i) => { const x = i ? -1 : 1; return [
    [s + 'Shoulder', 'Spine2', [4 * x, 12, 0]], [s + 'Arm', s + 'Shoulder', [14 * x, 0, 0]], [s + 'ForeArm', s + 'Arm', [27 * x, 0, 0]], [s + 'Hand', s + 'ForeArm', [25 * x, 0, 0]],
    [s + 'UpLeg', 'Hips', [9 * x, -5, 0]], [s + 'Leg', s + 'UpLeg', [0, -42, 0]], [s + 'Foot', s + 'Leg', [0, -42, 0]], [s + 'ToeBase', s + 'Foot', [0, -8, 10]], [s + 'Toe_End', s + 'ToeBase', [0, 0, 8]],
  ]; }),
];
function buildDemo() {
  clearModel();
  const root = new THREE.Group(); const objs = {};
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a94a8, roughness: 0.7 });
  for (const [n, par, off] of DEMO) {
    const b = new THREE.Bone(); b.name = 'mixamorig' + n; b.position.set(...off); objs[n] = b;
    (par ? objs[par] : root).add(b);
    if (par) { // segment: ebeveyn kemikten bu kemiğe silindir
      const len = Math.hypot(...off);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3, len, 8), mat);
      m.position.copy(b.position).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.position.clone().normalize());
      objs[par].add(m);
    }
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(10, 16, 12), mat); head.position.set(0, 10, 0); objs.Head.add(head);
  stage.add(root);
  buildRig(root, 'demo');
  buildProps();
}

// ───────────────────────── model yükleme
const fbxLoader = new FBXLoader(), gltfLoader = new GLTFLoader();
async function loadModel(name, { keepAnim = false } = {}) {
  const url = '/models/' + encodeURIComponent(name);
  clearModel(); selProp = null;
  let root, clips;
  if (/\.fbx$/i.test(name)) { root = await fbxLoader.loadAsync(url); clips = root.animations; }
  else { const g = await gltfLoader.loadAsync(url); root = g.scene; clips = g.animations; }
  stage.add(root);
  buildRig(root, name);
  if (!Object.keys(anim.tracks).length && clips?.length) bakeClip(clips[0], root); // dosyada gömülü animasyon varsa ve elimizde yoksa
  afterAnimReplaced();
  await buildProps();
  toast('Model yüklendi: ' + name);
}

function bakeClip(clip, root, inPlace = $('#inPlace').checked) {
  pushUndo();
  const fps = 30, n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const mixer = new THREE.AnimationMixer(stage.children[0] || root);
  const action = mixer.clipAction(clip); action.play();
  const posNames = new Set(clip.tracks.filter((t) => t.name.endsWith('.position')).map((t) => t.name.slice(0, -9)));
  const tracks = {};
  for (let f = 0; f < n; f++) {
    mixer.setTime(f / fps);
    for (const b of rig.bones) {
      const t = (tracks[b.name] ||= { rot: [] });
      const q = b.obj.quaternion; t.rot.push([f, q.x, q.y, q.z, q.w]);
      if (posNames.has(b.name)) {
        const p = b.obj.position; (t.pos ||= []).push([f, inPlace ? b.restP[0] : p.x, p.y, inPlace ? b.restP[2] : p.z]);
      }
    }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot());
  anim = { name: clip.name && clip.name !== 'mixamo.com' ? clip.name : 'mixamo', fps, length: n, loop: true, tracks };
  for (const b of rig.bones) { b.obj.quaternion.set(...b.restQ); b.obj.position.set(...b.restP); }
  curFrame = 0;
}

async function upload(file) {
  await fetch('/api/upload-model?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
  await refreshModelList(); return file.name;
}
async function refreshModelList(select) {
  const list = await fetch('/api/models').then((r) => r.json());
  const sel_ = $('#modelSelect'); sel_.innerHTML = '';
  for (const n of list) sel_.add(new Option(n, n));
  if (select) sel_.value = select;
}
async function importAnimBuffer(buf, baseName) {
  if (!rig) return toast('Önce bir model yükle');
  const obj = fbxLoader.parse(buf, '');
  if (!obj.animations?.length) return toast('Dosyada animasyon yok');
  bakeClip(obj.animations[0], stage.children[0]);
  anim.name = baseName;
  afterAnimReplaced(); await saveToLibrary(baseName); toast(`İçe aktarıldı ve kaydedildi: ${baseName} (${anim.length} kare)`);
}
const importAnimFile = async (file) => importAnimBuffer(await file.arrayBuffer(), file.name.replace(/\.fbx$/i, ''));

// ───────────────────────── seçim / gizmo
function selectBone(b) {
  selProp = null; refreshPropList();
  sel = b || null;
  if (sel) tc.attach(sel.obj); else tc.detach();
  for (const el of document.querySelectorAll('.bone')) el.classList.toggle('sel', el.dataset.name === sel?.name);
  $('#boneName').textContent = sel ? sel.name : '—';
  uiUpdate();
}

let drag = null;
const propGizmo = () => selProp && selProp.obj && tc.object === selProp.obj;
tc.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  if (propGizmo()) { if (!e.value) scheduleProps(); return; }
  if (e.value && sel) {
    pushUndo();
    const t = anim.tracks[sel.name];
    drag = { bone: sel, q0: sel.obj.quaternion.clone(), snap: t?.rot ? t.rot.map((k) => k.slice()) : null };
    if ($('#offsetAll').checked && tc.mode === 'rotate' && !drag.snap) {
      setRotKey(sel, 0, sel.obj.quaternion); drag.snap = anim.tracks[sel.name].rot.map((k) => k.slice());
    }
  } else if (drag) { drag = null; refreshPose(); refreshBoneList(); uiUpdate(); scheduleSync(); }
});
tc.addEventListener('axis-changed', (e) => {
  if (!e.value || propGizmo()) return;
  if (playing) playing = false;
  if (curFrame !== Math.round(curFrame)) { curFrame = Math.round(curFrame); refreshPose(); }
  uiUpdate();
});
tc.addEventListener('objectChange', () => {
  if (propGizmo()) return readPropTransform(selProp);
  if (!drag) return;
  const b = drag.bone, f = Math.round(curFrame);
  if (tc.mode === 'translate') setPosKey(b, f, b.obj.position);
  else if ($('#offsetAll').checked) {
    const d = b.obj.quaternion.clone().multiply(drag.q0.clone().invert());
    const t = anim.tracks[b.name];
    t.rot = drag.snap.map((k) => { const q = d.clone().multiply(new THREE.Quaternion(k[1], k[2], k[3], k[4])); return [k[0], q.x, q.y, q.z, q.w]; });
  } else setRotKey(b, f, b.obj.quaternion);
  uiUpdate(); scheduleSync();
});

// viewport tıklama ile kemik seçimi
const ray = new THREE.Raycaster(); let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (mode === 'vfx' || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || tc.dragging || tc.axis) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hits = ray.intersectObjects(overlay.children.filter((o) => o.userData.bone), false);
  if (hits.length) selectBone(hits[0].object.userData.bone);
});


// ───────────────────────── eşyalar (silah vb.)
let props = []; // { id, prop, bone, pos[m], rot[deg], scale, obj, pivot }
let selProp = null, buildToken = 0;
const propCache = new Map();
const propData = () => props.map(({ id, prop, bone, pos, rot, scale }) => ({ id, prop, bone, pos, rot, scale }));
let propsTimer = null;
const scheduleProps = () => { clearTimeout(propsTimer); propsTimer = setTimeout(() => api('/api/props', { props: propData() }).catch(() => {}), 250); };

function builtinProp(name) { // orijin = tutma noktası, +Z ileri, +Y yukarı (metre)
  const g = new THREE.Group();
  const box = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.35 })); m.position.set(x, y, z); g.add(m); };
  if (name === 'pistol') { box(0.032, 0.11, 0.045, 0, -0.02, -0.005, 0x2b3038); box(0.036, 0.045, 0.19, 0, 0.055, 0.06, 0x1d2025); box(0.02, 0.03, 0.05, 0, 0.0, 0.04, 0x1d2025); }
  else if (name === 'rifle') { box(0.05, 0.07, 0.55, 0, 0.04, 0.2, 0x262a30); box(0.035, 0.1, 0.04, 0, -0.03, 0, 0x1d2025); box(0.045, 0.09, 0.2, 0, 0.03, -0.2, 0x3a2f26); box(0.02, 0.02, 0.3, 0, 0.05, 0.62, 0x15171a); box(0.03, 0.14, 0.06, 0, -0.07, 0.2, 0x1d2025); }
  else if (name === 'sword') { box(0.03, 0.12, 0.03, 0, 0, 0, 0x4a3524); box(0.12, 0.02, 0.04, 0, 0.07, 0, 0x8a7a3a); box(0.04, 0.8, 0.01, 0, 0.48, 0, 0xc9d1da); }
  else box(0.2, 0.2, 0.2, 0, 0, 0, 0xb5651d);
  return g;
}
function getPropTemplate(name) {
  if (!propCache.has(name)) propCache.set(name, (async () => {
    if (name.startsWith('builtin:')) return builtinProp(name.slice(8));
    const url = '/props/' + encodeURIComponent(name);
    const obj = /\.fbx$/i.test(name) ? await fbxLoader.loadAsync(url) : (await gltfLoader.loadAsync(url)).scene;
    const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    obj.position.sub(c); const inner = new THREE.Group(); inner.add(obj); inner.scale.setScalar(1 / Math.max(size.x, size.y, size.z, 1e-6));
    const wrap = new THREE.Group(); wrap.add(inner); return wrap; // 1 m'ye normalize
  })());
  return propCache.get(name);
}
async function buildProps() {
  const token = ++buildToken;
  for (const a of props) { a.pivot?.removeFromParent(); a.pivot = a.obj = null; }
  if (selProp && !selProp.obj) { selProp = null; if (sel) tc.attach(sel.obj); else tc.detach(); }
  if (!rig) return refreshPropList();
  for (const a of props) {
    const bone = rig.byName.get(a.bone); if (!bone) continue;
    let tpl; try { tpl = await getPropTemplate(a.prop); } catch { toast('Eşya yüklenemedi: ' + a.prop); continue; }
    if (token !== buildToken) return;
    stage.updateMatrixWorld(true);
    const ws = bone.obj.getWorldScale(new THREE.Vector3()).x || 1;
    const pivot = new THREE.Object3D(); pivot.quaternion.copy(bone.restWQ).invert(); pivot.scale.setScalar(1 / ws);
    const obj = tpl.clone(true);
    obj.position.set(...a.pos); obj.rotation.set(...a.rot.map(THREE.MathUtils.degToRad)); obj.scale.setScalar(a.scale);
    pivot.add(obj); bone.obj.add(pivot); a.pivot = pivot; a.obj = obj;
  }
  refreshPropList(); mats.onSceneChanged(); // giydirilmiş materyaller yeni eşya mesh'lerine
}
function readPropTransform(a) {
  a.pos = a.obj.position.toArray().map((v) => +v.toFixed(4));
  a.rot = [a.obj.rotation.x, a.obj.rotation.y, a.obj.rotation.z].map((v) => +THREE.MathUtils.radToDeg(v).toFixed(1));
  a.scale = +a.obj.scale.x.toFixed(4);
}
const shortBone = (n) => n.replace(/^mixamorig:?/, '');
function refreshPropList() {
  const box = $('#propList'); box.innerHTML = '';
  for (const a of props) {
    const el = document.createElement('div'); el.className = 'li' + (a === selProp ? ' sel' : '');
    el.innerHTML = '<span class="n"></span><input type="number" step="0.1" style="width:56px" title="Ölçek"><button title="Kaldır">✕</button>';
    el.querySelector('.n').textContent = a.prop.replace('builtin:', '') + ' → ' + shortBone(a.bone);
    const sc = el.querySelector('input'); sc.value = a.scale;
    sc.onclick = (e) => e.stopPropagation();
    sc.oninput = () => { a.scale = Math.max(0.01, +sc.value || 1); a.obj?.scale.setScalar(a.scale); scheduleProps(); };
    el.querySelector('button').onclick = (e) => { e.stopPropagation(); props = props.filter((p) => p !== a); a.pivot?.removeFromParent(); if (selProp === a) { selProp = null; if (sel) tc.attach(sel.obj); else tc.detach(); } refreshPropList(); scheduleProps(); };
    el.onclick = () => { if (!a.obj) return; selProp = a; tc.attach(a.obj); refreshPropList(); };
    box.appendChild(el);
  }
}
function fillPropBones() {
  const s = $('#propBone'); s.innerHTML = '';
  for (const b of rig.bones) s.add(new Option(shortBone(b.name), b.name));
  const rh = rig.bones.find((b) => /RightHand$/.test(b.name)); if (rh) s.value = rh.name;
}
async function refreshPropFiles() {
  const s = $('#propSelect'); const files = await fetch('/api/props-files').then((r) => r.json()).catch(() => []);
  s.innerHTML = '';
  for (const n of ['pistol', 'rifle', 'sword', 'box']) s.add(new Option('● ' + n, 'builtin:' + n));
  for (const f of files) s.add(new Option(f, f));
}
const defaultPropRot = (bone) => (/RightHand$/.test(bone) ? [0, 0, -90] : /LeftHand$/.test(bone) ? [0, 0, 90] : [0, 0, 0]);
$('#btnPropAdd').onclick = async () => {
  if (!rig) return;
  const prop = $('#propSelect').value, bone = $('#propBone').value; if (!prop || !bone) return;
  const a = { id: Math.random().toString(36).slice(2, 8), prop, bone, pos: [0, 0, 0], rot: defaultPropRot(bone), scale: prop.startsWith('builtin:') ? 1 : 0.3 };
  props.push(a); await buildProps(); scheduleProps();
  selProp = a; if (a.obj) tc.attach(a.obj); refreshPropList();
};
$('#filePropUp').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  await fetch('/api/upload-prop?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
  await refreshPropFiles(); $('#propSelect').value = f.name; toast('Eşya yüklendi: ' + f.name); e.target.value = '';
};

// ───────────────────────── animasyon kütüphanesi
async function saveToLibrary(name) {
  name = (name || anim.name || 'anim').trim().replace(/[^\w .-]+/g, '_');
  anim.name = name; $('#animName').value = name;
  await fetch('/api/animations/save?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(anim) });
  scheduleSync(); await refreshLib(); return name;
}
async function loadFromLibrary(item) {
  if (item.kind === 'fbx') { const buf = await fetch('/animations/' + encodeURIComponent(item.file)).then((r) => r.arrayBuffer()); return importAnimBuffer(buf, item.name); }
  const a = await fetch('/api/animations/get?name=' + encodeURIComponent(item.name)).then((r) => r.json());
  pushUndo(); anim = normalizeAnim(a); curFrame = 0; afterAnimReplaced(); toast('Yüklendi: ' + item.name);
}
async function refreshLib() {
  const list = await fetch('/api/animations').then((r) => r.json()).catch(() => []);
  const box = $('#libList'); box.innerHTML = '';
  if (!list.length) box.innerHTML = '<div class="hint-s">Henüz kayıtlı animasyon yok.</div>';
  for (const it of list) {
    const el = document.createElement('div'); el.className = 'li';
    el.innerHTML = '<span class="n"></span><small></small><button title="Sil">✕</button>';
    el.querySelector('.n').textContent = it.name; el.querySelector('small').textContent = it.kind === 'fbx' ? 'fbx' : it.length + ' kare';
    el.title = 'Yüklemek için tıkla';
    el.onclick = () => loadFromLibrary(it).catch((e) => toast(e.message));
    el.querySelector('button').onclick = async (e) => { e.stopPropagation(); if (!confirm(it.name + ' silinsin mi?')) return; await fetch('/api/animations/delete?name=' + encodeURIComponent(it.name), { method: 'POST' }); refreshLib(); };
    box.appendChild(el);
  }
}
$('#btnLibSave').onclick = async () => { const n = await saveToLibrary($('#libName').value || anim.name); $('#libName').value = ''; toast('Kütüphaneye kaydedildi: ' + n); };
$('#btnLibSave2').onclick = async () => { const n = await saveToLibrary(anim.name); toast('Kütüphaneye kaydedildi: ' + n); };
$('#fileLib').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return; e.target.value = '';
  if (/\.fbx$/i.test(f.name)) return importAnimFile(f).catch((er) => toast(er.message));
  try { const a = normalizeAnim(JSON.parse(await f.text())); pushUndo(); anim = a; afterAnimReplaced(); await saveToLibrary(f.name.replace(/\.json$/i, '')); toast('Yüklendi'); } catch { toast('Geçersiz dosya'); }
};

// ───────────────────────── sol panel (kemik listesi)
function refreshBoneList() {
  const box = $('#boneList'); box.innerHTML = '';
  if (!rig) return;
  const q = $('#boneSearch').value.toLowerCase();
  const depth = (b) => { let d = 0; while (b.parent && d < 64) { b = rig.byName.get(b.parent); d++; } return d; };
  for (const b of rig.bones) {
    if (q && !b.name.toLowerCase().includes(q)) continue;
    const el = document.createElement('div');
    el.className = 'bone' + (anim.tracks[b.name] ? ' keyed' : '') + (b === sel ? ' sel' : '');
    el.dataset.name = b.name; el.style.paddingLeft = 4 + depth(b) * 8 + 'px';
    el.textContent = b.name.replace(/^mixamorig:?/, '');
    el.onclick = () => selectBone(b);
    box.appendChild(el);
  }
}
$('#boneSearch').oninput = refreshBoneList;

// ───────────────────────── timeline
const tl = $('#timeline'); const tctx = tl.getContext('2d');
const PAD = 16, RULER = 22, ROW = 26;
let tlDrag = null;
const frameToX = (f) => PAD + (f / (anim.length - 1)) * (tl.clientWidth - PAD * 2);
const xToFrame = (x) => Math.max(0, Math.min(anim.length - 1, Math.round(((x - PAD) / (tl.clientWidth - PAD * 2)) * (anim.length - 1))));

function drawTimeline() {
  const w = tl.clientWidth, h = tl.clientHeight, dpr = devicePixelRatio;
  if (tl.width !== w * dpr || tl.height !== h * dpr) { tl.width = w * dpr; tl.height = h * dpr; }
  const c = tctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  c.fillStyle = '#8b93a3'; c.font = '10px system-ui'; c.textAlign = 'center';
  const step = Math.max(1, Math.ceil(anim.length / (w / 40)));
  for (let f = 0; f < anim.length; f += step) { const x = frameToX(f); c.fillRect(x, RULER - 6, 1, 6); c.fillText(f, x, 11); }
  const rows = [['Hepsi', null], [sel ? sel.name.replace(/^mixamorig:?/, '') : '—', sel]];
  rows.forEach(([label, bone], i) => {
    const y = RULER + i * ROW; c.fillStyle = i % 2 ? '#1f232a' : '#22262e'; c.fillRect(0, y, w, ROW);
    c.fillStyle = '#5c6577'; c.textAlign = 'left'; c.fillText(label, 4, y + 9);
    const frames = new Map();
    const add = (name, k, kind) => { for (const key of k || []) frames.set(key[0], kind); };
    if (bone) { const t = anim.tracks[bone.name]; add(bone.name, t?.pos, 'pos'); add(bone.name, t?.rot, 'rot'); }
    else for (const t of Object.values(anim.tracks)) { add('', t.pos, 'rot'); add('', t.rot, 'rot'); }
    for (const [f, kind] of frames) {
      const x = frameToX(f), cy = y + ROW / 2 + 4;
      c.fillStyle = kind === 'pos' ? '#5ee08a' : '#f5b942';
      c.beginPath(); c.moveTo(x, cy - 6); c.lineTo(x + 5, cy); c.lineTo(x, cy + 6); c.lineTo(x - 5, cy); c.fill();
    }
  });
  const px = frameToX(curFrame); c.fillStyle = '#ff4d4d'; c.fillRect(px - 0.5, 0, 1.5, h);
}
function keyFramesOfRow(row) {
  const s = new Set();
  if (row === 0) { for (const t of Object.values(anim.tracks)) for (const k of [...(t.rot || []), ...(t.pos || [])]) s.add(k[0]); }
  else if (sel) { const t = anim.tracks[sel.name]; for (const k of [...(t?.rot || []), ...(t?.pos || [])]) s.add(k[0]); }
  return s;
}
tl.addEventListener('pointerdown', (e) => {
  tl.setPointerCapture(e.pointerId);
  const r = tl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const row = y >= RULER && y < RULER + ROW ? 0 : y >= RULER + ROW && y < RULER + 2 * ROW ? 1 : -1;
  if (row >= 0) {
    for (const f of keyFramesOfRow(row)) if (Math.abs(frameToX(f) - x) < 7) { tlDrag = { row, from: f, to: f, moved: false }; return; }
  }
  tlDrag = { scrub: true }; playing = false; setFrame(xToFrame(x));
});
tl.addEventListener('pointermove', (e) => {
  if (!tlDrag) return;
  const r = tl.getBoundingClientRect(), f = xToFrame(e.clientX - r.left);
  if (tlDrag.scrub) return setFrame(f);
  if (f !== tlDrag.to) { tlDrag.to = f; tlDrag.moved = true; setFrame(f); }
});
tl.addEventListener('pointerup', () => {
  if (tlDrag && !tlDrag.scrub && tlDrag.moved && tlDrag.from !== tlDrag.to) {
    pushUndo();
    const names = tlDrag.row === 0 ? Object.keys(anim.tracks) : sel ? [sel.name] : [];
    for (const n of names) {
      const t = anim.tracks[n];
      for (const k of ['rot', 'pos']) {
        const key = t[k]?.find((x) => x[0] === tlDrag.from); if (!key) continue;
        t[k] = t[k].filter((x) => x[0] !== tlDrag.from); putKey(t[k], [tlDrag.to, ...key.slice(1)]);
      }
    }
    refreshPose(); scheduleSync();
  }
  tlDrag = null; uiUpdate();
});

// ───────────────────────── kare / oynatma
function setFrame(f) { curFrame = f; refreshPose(); uiUpdate(); }
function uiUpdate() {
  $('#frameLabel').textContent = `${Math.floor(curFrame)} / ${anim.length - 1}`;
  $('#btnPlay').textContent = playing ? '⏸' : '▶';
  $('#btnKey').classList.toggle('has', !!sel && hasKeyAt(sel.name, Math.round(curFrame)));
  $('#tip').classList.toggle('gone', !!rig && Object.keys(anim.tracks).length > 0 || performance.now() > 20000);
  if (sel && document.activeElement?.type !== 'number') {
    const e = new THREE.Euler().setFromQuaternion(sel.obj.quaternion, 'XYZ');
    for (const [id, v] of [['ex', e.x], ['ey', e.y], ['ez', e.z]]) $('#' + id).value = (THREE.MathUtils.radToDeg(v)).toFixed(1);
  }
  $('#hud').textContent = rig ? `${rig.modelName} · ${rig.bones.length} kemik · ${Object.keys(anim.tracks).length} track` : '';
  drawTimeline();
}
let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  if (playing && rig && mode === 'anim') {
    curFrame += ((now - last) / 1000) * anim.fps;
    const end = anim.length - 1;
    if (curFrame >= end) { if (anim.loop) curFrame %= end; else { curFrame = end; playing = false; } }
    refreshPose(); uiUpdate();
  }
  const dt = (now - last) / 1000; last = now;
  orbit.update();
  mats?.tick(dt); // giydirilmiş UPE materyallerinin ışık/zaman uniform'ları (tüm modlarda)
  const mod = modeModule(mode);
  if (mod?.active) { mod.tick(dt); mod.render(); return; }
  updateOverlay(); renderer.render(scene, camera);
}

$('#btnPlay').onclick = () => { playing = !playing; if (playing) curFrame = Math.floor(curFrame); else { curFrame = Math.round(curFrame); refreshPose(); } uiUpdate(); };
$('#btnPrev').onclick = () => { playing = false; setFrame(Math.max(0, Math.round(curFrame) - 1)); };
$('#btnNext').onclick = () => { playing = false; setFrame(Math.min(anim.length - 1, Math.round(curFrame) + 1)); };

// ───────────────────────── key işlemleri
const frameNow = () => Math.round(curFrame);
function addKey() { if (!sel) return; pushUndo(); setRotKey(sel, frameNow(), sel.obj.quaternion); if (hasPosTrack(sel)) setPosKey(sel, frameNow(), sel.obj.position); afterEdit(); }
const hasPosTrack = (b) => !!anim.tracks[b.name]?.pos?.length;
function addKeyAll() { if (!rig) return; pushUndo(); for (const b of rig.bones) { setRotKey(b, frameNow(), b.obj.quaternion); if (hasPosTrack(b)) setPosKey(b, frameNow(), b.obj.position); } afterEdit(); }
function delKey() { if (!sel) return; pushUndo(); delKeysAt(sel.name, frameNow()); afterEdit(); }
function afterEdit() { refreshPose(); refreshBoneList(); uiUpdate(); scheduleSync(); }
const toggleKey = () => { if (sel && hasKeyAt(sel.name, frameNow())) delKey(); else addKey(); };
$('#btnKey').onclick = toggleKey; $('#btnKeyAll').onclick = addKeyAll;
$('#btnCopy').onclick = () => { if (!rig) return; poseClip = rig.bones.map((b) => ({ b, q: b.obj.quaternion.clone(), p: b.obj.position.clone() })); toast('Poz kopyalandı'); };
$('#btnPaste').onclick = () => {
  if (!poseClip) return; pushUndo();
  for (const { b, q, p } of poseClip) { setRotKey(b, frameNow(), q); if (hasPosTrack(b)) setPosKey(b, frameNow(), p); }
  afterEdit();
};
$('#btnLoop').onclick = () => { // 0. kare pozunu son kareye kopyala
  if (!rig) return; pushUndo(); const f0 = curFrame; refreshPose(0);
  for (const b of rig.bones) { if (!anim.tracks[b.name]) continue; setRotKey(b, anim.length - 1, b.obj.quaternion); if (hasPosTrack(b)) setPosKey(b, anim.length - 1, b.obj.position); }
  curFrame = f0; afterEdit(); toast('Son kare = ilk kare');
};
$('#btnRestBone').onclick = () => { if (!sel) return; pushUndo(); setRotKey(sel, frameNow(), new THREE.Quaternion(...sel.restQ)); afterEdit(); };
$('#btnRestAll').onclick = () => { if (!rig) return; pushUndo(); for (const b of rig.bones) if (anim.tracks[b.name]) setRotKey(b, frameNow(), new THREE.Quaternion(...b.restQ)); afterEdit(); };

for (const id of ['ex', 'ey', 'ez']) {
  const el = $('#' + id);
  el.onfocus = () => pushUndo();
  el.oninput = () => {
    if (!sel) return;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...['ex', 'ey', 'ez'].map((i) => THREE.MathUtils.degToRad(+$('#' + i).value || 0)), 'XYZ'));
    sel.obj.quaternion.copy(q); setRotKey(sel, frameNow(), q); refreshBoneList(); drawTimeline(); scheduleSync();
  };
}
const setMode = (m) => { tc.setMode(m); $('#modeRot').classList.toggle('on', m === 'rotate'); $('#modePos').classList.toggle('on', m === 'translate'); };
$('#modeRot').onclick = () => setMode('rotate'); $('#modePos').onclick = () => setMode('translate');
$('#spaceBtn').onclick = (e) => { const s = tc.space === 'local' ? 'world' : 'local'; tc.setSpace(s); e.target.textContent = s === 'local' ? 'Local' : 'World'; };

$('#animName').oninput = (e) => { anim.name = e.target.value; scheduleSync(); };
$('#animFps').onchange = (e) => { pushUndo(); anim.fps = Math.max(1, +e.target.value || 30); scheduleSync(); };
$('#animLen').onchange = (e) => { pushUndo(); anim.length = Math.max(2, +e.target.value || 60); curFrame = Math.min(curFrame, anim.length - 1); uiUpdate(); scheduleSync(); };
$('#animLoop').onchange = (e) => { anim.loop = e.target.checked; scheduleSync(); };


// ───────────────────────── üst bar
$('#modelSelect').onchange = () => { const n = $('#modelSelect').value; if (n) loadModel(n).catch((e) => toast(e.message)); };
// menü öğesine tıklayınca menüyü kapat, dışına tıklayınca da kapat
document.addEventListener('click', (e) => { for (const m of document.querySelectorAll('details.menu[open]')) if (!m.contains(e.target) || e.target.closest('button.item')) m.open = false; });
document.querySelectorAll('label.item input[type=file]').forEach((i) => i.addEventListener('change', () => document.querySelectorAll('details.menu[open]').forEach((m) => (m.open = false))));
$('#btnDemo').onclick = () => { buildDemo(); anim = newAnim(); afterAnimReplaced(); };
$('#btnUndo').onclick = () => { const m = modeModule(mode); m ? m.undo() : undo(); }; $('#btnRedo').onclick = () => { const m = modeModule(mode); m ? m.redo() : redo(); };
$('#fileModel').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const n = await upload(f); loadModel(n).catch((er) => toast(er.message)); e.target.value = ''; };
$('#fileAnim').onchange = async (e) => { const f = e.target.files[0]; if (f) await importAnimFile(f).catch((er) => toast(er.message)); e.target.value = ''; };
$('#fileJson').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { pushUndo(); anim = normalizeAnim(JSON.parse(await f.text())); afterAnimReplaced(); toast('JSON yüklendi'); } catch (er) { toast('Geçersiz JSON'); }
  e.target.value = '';
};
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
  if (/\.json$/i.test(f.name)) { anim = normalizeAnim(JSON.parse(await f.text())); afterAnimReplaced(); return; }
  if (!rig || rig.modelName === 'demo') { const n = await upload(f); loadModel(n).catch((er) => toast(er.message)); }
  else importAnimFile(f).catch((er) => toast(er.message));
});

function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

function unityPayload() {
  return {
    format: 'animref-1', name: anim.name, fps: anim.fps, length: anim.length, loop: anim.loop, unitScale: rig.unitScale,
    bones: rig.bones.map(({ name, parent, restQ, restP }) => ({ name, parent, restQ, restP })),
    props: propData(),
    trackList: Object.entries(anim.tracks).map(([bone, t]) => ({ bone, rot: (t.rot || []).flat(), pos: (t.pos || []).flat() })),
  };
}
$('#btnUnity').onclick = async () => {
  if (!rig) return;
  const data = JSON.stringify(unityPayload());
  const fname = (anim.name || 'anim').replace(/[^\w-]+/g, '_') + '.animref.json';
  const r = await fetch('/api/export?name=' + encodeURIComponent(fname), { method: 'POST', body: data }).then((x) => x.json());
  download(new Blob([data], { type: 'application/json' }), fname);
  toast('Kaydedildi: ' + (r.path || fname));
};

// ───────────────────────── temiz render + GIF
function withCleanScene(fn) {
  const vis = [grid.visible, overlay.visible, tcHelper.visible];
  grid.visible = overlay.visible = tcHelper.visible = false;
  try { return fn(); } finally { [grid.visible, overlay.visible, tcHelper.visible] = vis; }
}
function updateGuide() {
  const g = $('#guide'); const on = $('#gifGuide').checked;
  g.hidden = !on; if (!on) return;
  const a = (+$('#gifSize').value || 1) / (+$('#gifSize').value || 1); // kare kadraj
  g.style.width = viewport.clientHeight * a + 'px';
}
$('#gifGuide').onchange = updateGuide; $('#gifSize').oninput = updateGuide;

async function renderFrames(size, frames, { transparent, bg, onFrame }) {
  const prevBg = scene.background; const keep = curFrame;
  renderer.setPixelRatio(1); renderer.setSize(size, size, false);
  const cam = camera.aspect; camera.aspect = 1; camera.updateProjectionMatrix();
  scene.background = transparent ? null : new THREE.Color(bg);
  renderer.setClearColor(0x000000, 0);
  const cv = document.createElement('canvas'); cv.width = cv.height = size; const cx = cv.getContext('2d', { willReadFrequently: true });
  try {
    for (let i = 0; i < frames.length; i++) {
      refreshPose(frames[i]);
      withCleanScene(() => renderer.render(scene, camera));
      cx.clearRect(0, 0, size, size); cx.drawImage(renderer.domElement, 0, 0, size, size);
      await onFrame(cx, cv, i);
    }
  } finally {
    scene.background = prevBg; renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    camera.aspect = cam; camera.updateProjectionMatrix(); curFrame = keep; refreshPose(); onResize();
  }
}

async function makeGif({ size, fps, transparent, bg }, onProgress) {
  size = Math.max(64, Math.min(1024, size)); fps = Math.max(1, Math.min(50, fps)); playing = false;
  const n = Math.max(1, Math.round((anim.length / anim.fps) * fps));
  const frames = Array.from({ length: n }, (_, i) => Math.min(anim.length - 1, (i * anim.fps) / fps));
  const gif = GIFEncoder();
  await renderFrames(size, frames, {
    transparent, bg,
    onFrame: async (cx, cv, i) => {
      const { data } = cx.getImageData(0, 0, size, size);
      const fmt = transparent ? 'rgba4444' : 'rgb565';
      const palette = quantize(data, 256, transparent ? { format: fmt, oneBitAlpha: true } : { format: fmt });
      const index = applyPalette(data, palette, fmt);
      const ti = transparent ? palette.findIndex((c) => c[3] === 0) : -1;
      gif.writeFrame(index, size, size, { palette, delay: Math.round(1000 / fps), repeat: anim.loop ? 0 : -1, transparent: ti >= 0, transparentIndex: Math.max(0, ti), dispose: transparent ? 2 : -1 });
      onProgress(i + 1, n);
      if (i % 3 === 0) await new Promise((r) => setTimeout(r));
    },
  });
  gif.finish(); return gif.bytes();
}
$('#btnGif').onclick = async () => {
  if (!rig) return;
  const st = $('#gifStatus');
  const bytes = await makeGif({ size: +$('#gifSize').value || 400, fps: +$('#gifFps').value || 25, transparent: $('#gifTransparent').checked, bg: $('#gifBg').value }, (i, n) => { st.textContent = `GIF: ${i}/${n}`; });
  const fname = (anim.name || 'anim').replace(/[^\w-]+/g, '_') + '.gif';
  const r = await fetch('/api/export?name=' + encodeURIComponent(fname), { method: 'POST', body: bytes }).then((x) => x.json()).catch(() => ({}));
  download(new Blob([bytes], { type: 'image/gif' }), fname);
  st.textContent = `GIF hazır (${(bytes.length / 1024).toFixed(0)} KB) ${r.path ? '· ' + r.path : ''}`;
};

// ───────────────────────── açılır/kapanır paneller
const LEFT_NAMES = { anim: 'Kemikler', vfx: 'Efekt katmanları', material: 'Materyaller', shader: "Shader'lar" };
// sol panel her modda varsayılan kapalı; eski panel2-*-left kayıtları sayılmasın diye ayrı anahtar
const panelKey = (side) => side === 'left' ? `upe-left-${mode}` : `panel2-${mode}-${side}`;
function setPanel(side, open) {
  document.body.classList.toggle(side + '-open', open);
  $(side === 'left' ? '#togLeft' : '#togRight').classList.toggle('on', open);
  if (side === 'left') {
    const h = $('#leftEdge');
    h.querySelector('.chev').textContent = open ? '‹' : '›'; h.querySelector('.lbl').textContent = LEFT_NAMES[mode];
    h.title = `${LEFT_NAMES[mode]} paneli (B)`;
  }
  try { localStorage.setItem(panelKey(side), open ? '1' : '0'); } catch { /* yok say */ }
  setTimeout(() => { onResize(); drawTimeline(); }, 220);
}
const panelOpen = (side) => document.body.classList.contains(side + '-open');
$('#togLeft').onclick = $('#leftEdge').onclick = () => setPanel('left', !panelOpen('left'));
$('#togRight').onclick = () => setPanel('right', !panelOpen('right'));
const savedPanel = (s, d = s === 'right') => { try { const v = localStorage.getItem(panelKey(s)); return v === null ? d : v === '1'; } catch { return d; } };
setPanel('left', savedPanel('left')); setPanel('right', savedPanel('right'));


// ───────────────────────── Unity'ye tek tık gönderim
async function refreshUnity() {
  const u = await fetch('/api/unity').then((r) => r.json()).catch(() => null); if (!u) return;
  if (document.activeElement !== $('#uProject')) $('#uProject').value = u.project || '';
  const sel_ = $('#uChar'); sel_.innerHTML = '';
  const short = (c) => c.replace(/^Assets[/]/, '');
  for (const c of u.characters) sel_.add(new Option(short(c), c));
  if (u.character && !u.characters.includes(u.character)) sel_.add(new Option(short(u.character), u.character));
  sel_.value = u.character || u.guess || (u.characters[0] || '');
  $('#uMode').value = u.mode || 'Auto';
  $('#uStatus').textContent = u.valid ? `Proje bulundu · ${u.characters.length} karakter adayı` : u.project ? 'Geçersiz klasör (Assets/ProjectSettings yok)' : 'Önce Unity proje klasörünü yaz';
  return u;
}
async function saveUnityCfg() {
  const r = await api('/api/unity/config', { project: $('#uProject').value, character: $('#uChar').value || null, mode: $('#uMode').value });
  if (r.error) { toast(r.error); $('#uStatus').textContent = r.error; return false; }
  await refreshUnity(); return true;
}
async function sendUnity() {
  await refreshUnity();
  if (!$('#uProject').value.trim()) { openUnityDialog('Önce Unity proje klasörünü ayarla.'); return 'Unity projesi ayarlı değil'; }
  if (!(await saveUnityCfg())) return 'Hata: Unity ayarı kaydedilemedi';
  toast("Unity'ye gönderiliyor…"); $('#uStatus').textContent = 'Gönderiliyor…';
  await api('/api/anim', anim);
  const r = await api('/api/unity/send', { all: $('#uAll').checked });
  const msg = r.error ? 'Hata: ' + r.error : r.ok ? "Unity'ye aktarıldı: " + (r.clips || []).join(', ') : (r.note || 'Gönderildi');
  $('#uStatus').textContent = msg; return msg;
}
$('#btnUSave').onclick = async () => { if (await saveUnityCfg()) { toast('Unity ayarı kaydedildi', 'ok'); refreshStatusUnity(); } };
$('#btnUSend').onclick = () => sendCurrent();

// ───────────────────────── klavye
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') { e.preventDefault(); return openHelp(); }
  if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); if (!panelOpen('right')) setPanel('right', true); return $('#panelFilter').focus(); }
  if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); return sendCurrent(); }
  if (document.querySelector('dialog[open]')) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) && !['checkbox', 'range'].includes(document.activeElement.type)) return;
  if (!e.ctrlKey && !e.altKey && ['1', '2', '3', '4'].includes(e.key)) return setEditorMode(MODES[+e.key - 1]);
  if (!e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); return openNote(); }
  if (e.key === '?') return openHelp();
  if (mode === 'vfx') {
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? vfx.redo() : vfx.undo(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); vfx.redo(); }
    else if (e.code === 'Space') { e.preventDefault(); vfx.togglePlay(); }
    else if (e.key === 'Home') vfx.restart();
    else if (e.key === 'ArrowLeft') vfx.nudge(-0.05);
    else if (e.key === 'ArrowRight') vfx.nudge(0.05);
    else if (e.key.toLowerCase() === 'f') vfx.frame();
    else if (e.key.toLowerCase() === 'b') $('#togLeft').click();
    else if (e.key.toLowerCase() === 'p') $('#togRight').click();
    return;
  }
  if (mode === 'material' || mode === 'shader') {
    const m = modeModule(mode);
    if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? m.redo() : m.undo(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); m.redo(); }
    else if (e.key.toLowerCase() === 'f') m.frame();
    else if (e.key.toLowerCase() === 'b') $('#togLeft').click();
    else if (e.key.toLowerCase() === 'p') $('#togRight').click();
    return;
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
  else if (e.code === 'Space') { e.preventDefault(); $('#btnPlay').click(); }
  else if (e.key === 'ArrowLeft') $('#btnPrev').click();
  else if (e.key === 'ArrowRight') $('#btnNext').click();
  else if (e.key.toLowerCase() === 'b') $('#togLeft').click();
  else if (e.key.toLowerCase() === 'p') $('#togRight').click();
  else if (e.key.toLowerCase() === 'k') toggleKey();
  else if (e.key === 'Delete') delKey();
  else if (e.key.toLowerCase() === 'e') setMode('rotate');
  else if (e.key.toLowerCase() === 'w') setMode('translate');
  else if (e.key.toLowerCase() === 'f') focusView();
});
window.addEventListener('resize', drawTimeline);

// ───────────────────────── modlar: Animasyon / VFX / Materyal / Shader
const vfx = initVfx({
  scene, camera, renderer, orbit, viewport, stage, grid, overlay, api, toast, $, BG,
  getRig: () => rig, getProps: () => props, getAnim: () => anim,
  poseAt: (f) => refreshPose(f), restorePose: () => refreshPose(), onResize: () => onResize(),
  setMode: (m, o) => setEditorMode(m, o),
});
const mats = initMaterials({
  scene, camera, renderer, orbit, viewport, stage, grid, overlay, api, toast, $, BG, sun,
  getRig: () => rig, getProps: () => props, onResize: () => onResize(),
  setMode: (m, o) => setEditorMode(m, o), setHeroVisible: (v) => { stage.visible = v; },
});
const MODES = ['anim', 'vfx', 'material', 'shader'];
const modeModule = (m) => ({ vfx, material: mats.material, shader: mats.shader })[m] || null;
const camByMode = {}; // her modun kamerası ayrı hatırlanır
function setEditorMode(m, { notify = true } = {}) {
  m = MODES.includes(m) ? m : 'anim';
  const prev = mode, changed = m !== prev;
  if (changed) { camByMode[prev] = { pos: camera.position.clone(), target: orbit.target.clone() }; const pm = modeModule(prev); if (pm?.active) pm.deactivate(); }
  mode = m; document.body.dataset.mode = m;
  for (const k of MODES) $('#mode' + k[0].toUpperCase() + k.slice(1))?.classList.toggle('on', k === m);
  $('#togLeft').title = LEFT_NAMES[m] + ' paneli (B)';
  $('#sendLabel').textContent = SEND_LABEL[m]; $('#stHint').textContent = HINTS[m]; $('#panelFilter').value = ''; applyFilter();
  if (m === 'anim') { if (sel) tc.attach(sel.obj); refreshPose(); uiUpdate(); } else { playing = false; tc.detach(); }
  const mod = modeModule(m); if (mod && !mod.active) mod.activate();
  if (changed) { const c = camByMode[m]; if (c) { camera.position.copy(c.pos); orbit.target.copy(c.target); orbit.update(); } else mod?.frame?.(); }
  if (changed || !notify) { setPanel('left', savedPanel('left')); setPanel('right', savedPanel('right')); }
  updateStatusItem(); if (helpOpen()) fillHelp();
  if (notify) api('/api/mode', { mode }).catch(() => {});
}
for (const k of MODES) { const b = $('#mode' + k[0].toUpperCase() + k.slice(1)); if (b) b.onclick = () => setEditorMode(k); }

// ───────────────────────── genel arayüz: Unity'ye gönder, Claude'a not, yardım, durum çubuğu, kamera, panel araması
const SEND_LABEL = { anim: "Unity'ye gönder", vfx: "Unity'ye gönder", material: "Unity'ye gönder", shader: "Unity'de derle" };
const HINTS = {
  anim: 'Space oynat · ←/→ kare · K key · E döndür / W taşı · F odakla',
  vfx: 'Space oynat · Home baştan · ←/→ zaman · etiketi sürükle: değer · F odakla',
  material: 'Etiketi sürükle: değer · Giydir: kahramana tak · F odakla',
  shader: 'Kod değişince kendisi derlenir · hataya tıkla: satıra git · F odakla',
};
const SEND_WHAT = { anim: 'animasyonu (.anim)', vfx: 'efekti (prefab)', material: 'materyali (.mat)', shader: "shader'ı (.shader derleme denetimi)" };
async function sendCurrent() {
  const u = await fetch('/api/unity').then((r) => r.json()).catch(() => null);
  if (!u?.valid) { openUnityDialog(u?.project ? 'Kayıtlı klasör Unity projesi değil; düzelt.' : 'Önce Unity proje klasörünü ayarla.'); return; }
  setUnityStatus('warn', 'Unity: gönderiliyor…');
  let msg;
  try { msg = mode === 'anim' ? await sendUnity() : mode === 'vfx' ? await vfx.sendUnity() : await mats.sendUnity(mode); } catch (e) { msg = 'Hata: ' + (e.message || e); }
  toast(msg || 'Gönderildi', /^Hata/.test(msg || '') ? 'err' : 'ok'); refreshStatusUnity(msg);
}
$('#btnSendUnity').onclick = () => sendCurrent();
$('#btnSendUnity').onmouseenter = () => { $('#btnSendUnity').title = `Bu moddaki ${SEND_WHAT[mode]} Unity projesine gönderir (Ctrl+Enter)`; };

// Claude'a not (her modda): bağlam moddan gelir
const shortBoneName = (n) => String(n || '').replace(/^mixamorig:?/, '');
function noteContext() {
  if (mode === 'anim') return { label: `Animasyon · ${anim.name} · kare ${frameNow()}${sel ? ' · kemik ' + shortBoneName(sel.name) : ''}`, data: { mode: 'anim', frame: frameNow(), bone: sel?.name || null } };
  return modeModule(mode)?.noteContext?.() || { label: mode, data: { mode } };
}
function openNote() { $('#noteCtx').textContent = 'Bağlam: ' + noteContext().label; $('#dlgNote').showModal(); $('#noteText').focus(); }
$('#btnNoteOpen').onclick = openNote;
$('#btnNote').onclick = async () => {
  const text = $('#noteText').value.trim(); if (!text) return $('#noteText').focus();
  await api('/api/note', { text, ...noteContext().data }); $('#noteText').value = ''; $('#dlgNote').close(); toast('Not Claude için kaydedildi', 'ok');
};
$('#noteText').addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); $('#btnNote').click(); } e.stopPropagation(); });
$('#btnBaseline').onclick = async () => {
  if (mode === 'anim') { await api('/api/anim', anim); await api('/api/baseline', {}); } else await modeModule(mode)?.baseline?.();
  toast('Referans alındı: Claude bundan sonraki değişikliklerini buna göre okur', 'ok');
};

// Unity projesi penceresi + durum çubuğu
async function openUnityDialog(msg) {
  const u = await fetch('/api/unity').then((r) => r.json()).catch(() => null);
  $('#dlgUProject').value = u?.project || '';
  $('#dlgUStatus').textContent = msg || (u?.valid ? '✓ Unity projesi bulundu' : u?.project ? '✗ Bu klasör Unity projesi değil (Assets ve ProjectSettings yok)' : 'Proje klasörü ayarlı değil');
  $('#dlgUnity').showModal(); $('#dlgUProject').focus();
}
$('#dlgUSave').onclick = async () => {
  const r = await api('/api/unity/config', { project: $('#dlgUProject').value });
  if (r.error) { $('#dlgUStatus').textContent = '✗ ' + r.error; return; }
  $('#dlgUStatus').textContent = '✓ Kaydedildi'; refreshUnity(); refreshStatusUnity(); setTimeout(() => $('#dlgUnity').close(), 450);
};
$('#dlgUProject').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#dlgUSave').click(); } e.stopPropagation(); });
$('#stUnity').onclick = () => openUnityDialog();
function setUnityStatus(cls, text, title) { const el = $('#stUnity'); el.className = 'st link ' + cls; el.lastElementChild.textContent = text; if (title) el.title = title; }
async function refreshStatusUnity(lastMsg) {
  const u = await fetch('/api/unity').then((r) => r.json()).catch(() => null);
  if (!u) return setUnityStatus('bad', 'Unity: sunucuya ulaşılamadı');
  const name = u.project ? u.project.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : '';
  setUnityStatus(u.valid ? 'ok' : 'warn', u.valid ? `Unity: ${name}` : 'Unity: proje ayarlı değil', (u.project || 'Tıkla: Unity proje klasörünü ayarla') + (lastMsg ? '\nSon gönderim: ' + lastMsg : ''));
}
function setConn(ok) { const el = $('#stConn'); el.className = 'st ' + (ok ? 'ok' : 'bad'); el.lastElementChild.textContent = ok ? 'Bağlı' : 'Bağlantı yok — sunucu kapalı mı?'; }
function claudeTouched(what) { $('#stClaude').textContent = `Claude ${what} · ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`; }
function updateStatusItem() {
  const it = mode === 'anim' ? `Animasyon <b>${anim.name}</b> · ${anim.length} kare · ${anim.fps} fps` : modeModule(mode)?.itemName || '';
  if ($('#stItem').innerHTML !== it) $('#stItem').innerHTML = it;
}

// kamera: hazır açılar + odakla
const VIEW_DIR = { front: [0, 0.1, 1], side: [1, 0.1, 0], top: [0, 1, 0.001], threequarter: [0.6, 0.35, 0.75] };
for (const b of document.querySelectorAll('#viewbar [data-view]')) b.onclick = () => { const d = new THREE.Vector3(...VIEW_DIR[b.dataset.view]).normalize(); const dist = Math.max(0.5, camera.position.distanceTo(orbit.target)); camera.position.copy(orbit.target).addScaledVector(d, dist); orbit.update(); };
function focusView() { const m = modeModule(mode); if (m?.frame) return m.frame(); orbit.target.set(0, 0.9, 0); camera.position.set(2.2, 1.4, 3.4); orbit.update(); }
$('#vbFocus').onclick = focusView;

// sağ panelde arama: eşleşen alanlar kalır, bölümleri açılır
function applyFilter() {
  const q = $('#panelFilter').value.trim().toLocaleLowerCase('tr');
  const root = [...document.querySelectorAll('#right > div[data-modes]')].find((d) => d.offsetParent !== null);
  for (const e of document.querySelectorAll('#right .f-hide')) e.classList.remove('f-hide');
  for (const d of document.querySelectorAll('#right details[data-was-open]')) { if (!q) { d.open = d.dataset.wasOpen === '1'; delete d.dataset.wasOpen; } }
  if (!q || !root) return;
  const low = (el) => (el?.textContent || '').toLocaleLowerCase('tr');
  for (const d of root.querySelectorAll(':scope > details')) {
    if (d.dataset.wasOpen === undefined) d.dataset.wasOpen = d.open ? '1' : '0';
    const head = low(d.querySelector('summary')).includes(q);
    const rows = [...d.querySelectorAll('.vf, .fl, .grid2 > label, .eul, .li, :scope > label.chk, :scope > .row')].filter((r) => !r.parentElement.closest('.vf'));
    let any = head;
    for (const r of rows) { const hit = head || low(r.querySelector('.vl') || r).includes(q); r.classList.toggle('f-hide', !hit); any ||= hit; }
    d.classList.toggle('f-hide', !any); if (any) d.open = true;
  }
}
$('#panelFilter').addEventListener('input', applyFilter);
$('#panelFilter').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; applyFilter(); e.target.blur(); } e.stopPropagation(); });
{ let ft; new MutationObserver(() => { if (!$('#panelFilter').value) return; clearTimeout(ft); ft = setTimeout(applyFilter, 60); }).observe($('#right'), { childList: true, subtree: true }); }

// yardım (ilk açılışta hoş geldin)
const HELP = {
  anim: ['Animasyon', ['Sol panelden ya da viewport\'taki mavi noktalardan kemik seç; <kbd>E</kbd> döndür, <kbd>W</kbd> taşı.', '<kbd>K</kbd> o karede key koyar/siler; zaman çizelgesinde key\'leri sürükleyebilirsin.', '<kbd>Space</kbd> oynat, <kbd>←</kbd>/<kbd>→</kbd> kare. Sağ panel: kütüphane, eşyalar (silah takma), ayarlar.', 'Mixamo FBX\'i pencereye sürükle-bırak: animasyon olarak eklenir.']],
  vfx: ['VFX', ['Efekt = parçacık katmanları (emitter). Solda aç/kapat, çoğalt, sırala; <b>+ Emitter</b> hazır şablonlar (kıvılcım, alev, duman…).', 'Sağ panelde Unity\'nin parçacık modülleri; başlıktaki ●/○ modülü açar/kapatır.', 'Sayı etiketini basılı tutup sürükle → değer değişir (<kbd>Shift</kbd> hızlı, <kbd>Alt</kbd> ince).', '<kbd>Space</kbd> oynat, <kbd>Home</kbd> baştan, alt çubukta hız ve zaman.']],
  material: ['Materyal', ['Shader seç (oyunun toon shader\'ı, URP ya da özel), özellikleri değiştir.', 'Önizleme nesnesi: küre, küp… ya da <b>Kahraman</b>; <b>Giydir</b> materyali kahramana/eşyaya takar (diğer modlarda da görünür).', '<b>Işık</b> bölümü tüm materyaller için ortak sahne ışığıdır.']],
  shader: ['Shader', ['Kod Unity HLSL\'inin bir alt kümesi (UPE-SL); Unity\'de aynen çalışır, burada önizlenir.', 'Kod değişince kendisi derlenir; hatalar sağ altta, tıklayınca satır seçilir.', 'Hazır shader\'lar salt okunur: <b>Özel kopya oluştur</b> ile düzenlenebilir hâle getir.']],
};
const helpOpen = () => $('#dlgHelp').open;
function fillHelp() {
  const sec = (k) => { const [t, items] = HELP[k]; return `<section class="${k === mode ? 'cur' : ''}"><h4>${t}${k === mode ? ' <small style="color:var(--acc)">· şu anki mod</small>' : ''}</h4><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul></section>`; };
  $('#helpBody').innerHTML = `<section class="full"><h4>Nasıl çalışır?</h4><p>İşi Claude yapar; sen izlersin, istersen değerlerle oynarsın. Beğenmediğin bir şey için <b>💬 Claude'a not</b> yaz ya da elle düzeltip Claude'a "düzelttim" de; değişikliklerini kendisi okur. Beğendiğinde <b>⇪ Unity'ye gönder</b>.</p><p>Üstteki sekmeler modlar: <kbd>1</kbd> Animasyon · <kbd>2</kbd> VFX · <kbd>3</kbd> Materyal · <kbd>4</kbd> Shader. Alttaki çubukta bağlantı, Claude'un son güncellemesi ve Unity projesi görünür.</p></section>`
    + ['anim', 'vfx', 'material', 'shader'].map(sec).join('')
    + `<section class="full"><h4>Kısayollar</h4><p><kbd>F1</kbd> yardım · <kbd>N</kbd> Claude'a not · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> Unity'ye gönder · <kbd>Ctrl</kbd>+<kbd>F</kbd> ayar ara · <kbd>F</kbd> odakla · <kbd>B</kbd>/<kbd>P</kbd> sol/sağ panel · <kbd>Ctrl</kbd>+<kbd>Z</kbd> geri al · <kbd>Ctrl</kbd>+<kbd>Y</kbd> yinele · Fare: sol sürükle döndür, sağ sürükle kaydır, tekerlek yakınlaştır</p></section>`;
}
function openHelp(welcome = false) {
  $('#helpTitle').textContent = welcome ? 'Unity Preview Editor\'e hoş geldin' : 'Yardım ve kısayollar';
  let off = false; try { off = localStorage.getItem('upe-help-off') === '1'; } catch { /* yok */ }
  $('#helpNoMore').checked = off; fillHelp(); $('#dlgHelp').showModal();
}
$('#helpNoMore').onchange = (e) => { try { localStorage.setItem('upe-help-off', e.target.checked ? '1' : '0'); } catch { /* yok */ } };
$('#btnHelp').onclick = () => openHelp();

// ───────────────────────── sunucu bağlantısı (Claude köprüsü)
let markReady; const ready = new Promise((r) => { markReady = r; }); // açılış (model + durum) bitti
const es = new EventSource('/api/events');
es.onopen = () => setConn(true); es.onerror = () => setConn(false);
es.addEventListener('anim', (e) => {
  const d = JSON.parse(e.data); pushUndo(); anim = d.anim; afterAnimReplaced(); toast('Claude animasyonu güncelledi (Ctrl+Z ile geri al)'); claudeTouched('animasyonu güncelledi');
});
es.addEventListener('props', (e) => { props = JSON.parse(e.data).props; selProp = null; buildProps(); });
es.addEventListener('load-animation-fbx', async (e) => {
  const d = JSON.parse(e.data); const buf = await fetch('/animations/' + encodeURIComponent(d.name)).then((r) => r.arrayBuffer());
  importAnimBuffer(buf, d.name.replace(/\.fbx$/i, '')).catch((er) => toast(er.message));
});
es.addEventListener('gif', async (e) => {
  const d = JSON.parse(e.data);
  const bytes = await makeGif({ size: d.size || 400, fps: d.fps || 25, transparent: !!d.transparent, bg: d.bg || '#ffffff' }, () => {});
  const name = (d.name || anim.name || 'anim').replace(/[^\w-]+/g, '_') + '.gif';
  await fetch('/api/gif-result?id=' + d.id + '&name=' + encodeURIComponent(name), { method: 'POST', body: bytes });
});
es.addEventListener('load-model', (e) => { const d = JSON.parse(e.data); (d.name === 'demo' ? Promise.resolve(buildDemo()) : loadModel(d.name)).catch((er) => toast(er.message)); });
es.addEventListener('material', (e) => { const d = JSON.parse(e.data); claudeTouched('materyali güncelledi'); if (mode !== 'material') setEditorMode('material', { notify: false }); mats.onRemoteMaterial(d.material); });
es.addEventListener('shader', (e) => { const d = JSON.parse(e.data); claudeTouched("shader'ı güncelledi"); if (mode !== 'shader') setEditorMode('shader', { notify: false }); mats.onRemoteShader(d.shader); });
es.addEventListener('shader-compile', async (e) => { const d = JSON.parse(e.data); await ready; let r; try { r = mats.onCompileRequest(d); } catch (er) { r = { ok: false, errors: [{ section: 'şablon', line: 0, message: String(er.message || er) }] }; } api('/api/shader-compile-result', { id: d.id, ...r }); });
es.addEventListener('lighting', (e) => mats.onLighting(JSON.parse(e.data).lighting));
es.addEventListener('overrides', (e) => mats.onOverrides(JSON.parse(e.data).overrides));
es.addEventListener('vfx', (e) => { const d = JSON.parse(e.data); claudeTouched('efekti güncelledi'); if (mode !== 'vfx') setEditorMode('vfx', { notify: false }); vfx.onRemoteEffect(d.vfx); });
es.addEventListener('mode', (e) => setEditorMode(JSON.parse(e.data).mode, { notify: false }));
es.addEventListener('render', async (e) => {
  const d = JSON.parse(e.data); await ready;
  if (d.kind === 'vfx') { let png = ''; try { png = await vfx.renderSheet(d); } catch (er) { toast('VFX render hatası: ' + er.message); } return api('/api/render-result', { id: d.id, png }); }
  if (d.kind === 'material') { let png = ''; try { png = await mats.renderSheet(d); } catch (er) { toast('Materyal render hatası: ' + er.message); } return api('/api/render-result', { id: d.id, png }); }
  const size = d.size || 512; let png = '';
  const camBackup = [camera.position.clone(), orbit.target.clone()];
  if (d.camera) { const [px, py, pz] = d.camera.position || []; if (px !== undefined) camera.position.set(px, py, pz); if (d.camera.target) orbit.target.set(...d.camera.target); orbit.update(); }
  await renderFrames(size, [d.frame ?? curFrame], { transparent: false, bg: d.bg || '#ffffff', onFrame: async (cx, cv) => { png = cv.toDataURL('image/png'); } });
  if (d.camera) { camera.position.copy(camBackup[0]); orbit.target.copy(camBackup[1]); orbit.update(); }
  api('/api/render-result', { id: d.id, png });
});

// ───────────────────────── başlangıç
(async function init() {
  onResize(); await refreshModelList(); refreshPropFiles(); refreshLib(); refreshUnity();
  const st = await fetch('/api/state').then((r) => r.json());
  props = (st.props || []).map((p) => ({ ...p }));
  try {
    if (st.modelName && st.modelName !== 'demo') await loadModel(st.modelName, { keepAnim: true }); else buildDemo();
  } catch { buildDemo(); }
  anim = normalizeAnim(st.anim); afterAnimReplaced();
  vfx.setFromState(st.vfx);
  await mats.setFromState(st);
  setEditorMode(MODES.includes(st.mode) ? st.mode : 'anim', { notify: false });
  requestAnimationFrame(tick); markReady();
  refreshStatusUnity(); setInterval(updateStatusItem, 1000);
  let off = false; try { off = localStorage.getItem('upe-help-off') === '1' || localStorage.getItem('upe-welcomed') === '1'; localStorage.setItem('upe-welcomed', '1'); } catch { /* yok */ }
  if (!off) openHelp(true);
})();
window.__app = { get props() { return props; }, get anim() { return anim; }, get rig() { return rig; }, setFrame, selectBone, scene, camera, renderer, orbit, get mode() { return mode; } }; // hata ayıklama
