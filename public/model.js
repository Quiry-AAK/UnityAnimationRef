// Model modu: GLB/FBX/OBJ görüntüleyici. Bilgi (ölçü, üçgen, parça, materyal, doku, kemik, gömülü animasyon), görünüm
// (doku/kil/normal/UV/ışıksız, tel kafes, iskelet, sınır kutusu, pivot, 1,8 m boy referansı), parça gizleme, gömülü animasyon
// oynatma, Claude köprüsü (view_model → 'model-view' olayı, render_model → kontak sayfası).
// Dosyalar: meshes/ (genel modeller), models/ (karakterler), props/ (eşyalar). Eksenler UPE kuralında: Unity (x, y, z) = three (-x, y, z).
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const DIRS = { meshes: 'Modeller', models: 'Karakterler', props: 'Eşyalar' };
const SHADING = { texture: 'Doku', clay: 'Kil', normals: 'Normal', uv: 'UV', unlit: 'Işıksız' };
const PRESET_DIR = { front: [0, 0.12, 1], side: [1, 0.12, 0], back: [0, 0.12, -1], top: [0, 1, 0.001], threequarter: [0.62, 0.32, 0.72] };
const DEFAULT_VIEW = { shading: 'texture', wireframe: false, skeleton: false, bounds: false, axes: false, grid: true, scaleRef: false, rotate: false, env: true,
  exposure: 1, background: '#2b2f36', unit: 'auto', clip: null, speed: 1, paused: false, time: 0, hidden: [] };
const MESH_EXT = /\.(glb|gltf|fbx|obj)$/i;

export function normalizeView(v) {
  const o = { ...DEFAULT_VIEW, ...(v && typeof v === 'object' ? v : {}) };
  if (!SHADING[o.shading]) o.shading = 'texture';
  for (const k of ['wireframe', 'skeleton', 'bounds', 'axes', 'grid', 'scaleRef', 'rotate', 'env', 'paused']) o[k] = !!o[k];
  o.exposure = Math.min(4, Math.max(0.05, +o.exposure || 1)); o.speed = Math.min(4, Math.max(0.05, +o.speed || 1)); o.time = Math.max(0, +o.time || 0);
  if (!/^#[0-9a-f]{6}$/i.test(o.background)) o.background = DEFAULT_VIEW.background;
  if (!['auto', 'm', 'cm'].includes(o.unit)) o.unit = 'auto';
  o.clip = typeof o.clip === 'string' && o.clip ? o.clip : null;
  o.hidden = Array.isArray(o.hidden) ? [...new Set(o.hidden.map(String))] : [];
  return o;
}

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => Math.round(n).toLocaleString('tr-TR');
const kilo = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + ' M' : n >= 1e4 ? (n / 1e3).toFixed(1) + ' b' : num(n));
const bytesStr = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB');
const m3 = (v) => v.map((x) => (+x).toFixed(2).replace('.', ',')).join(' × ');
const partName = (m) => m.name || '(adsız)';

function checkerTexture() { // UV kontrol dokusu: sütun harfi (u) + satır numarası (v, alttan)
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); const n = 8, s = 512 / n;
  x.font = 'bold 22px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    x.fillStyle = `hsl(${(i * 360) / n}, 55%, ${(i + j) % 2 ? 36 : 60}%)`; x.fillRect(i * s, j * s, s, s);
    x.fillStyle = '#ffffffd0'; x.fillText(String.fromCharCode(65 + i) + (n - j), i * s + s / 2, j * s + s / 2);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}
function makeAxes(len) { // Unity ekseninde: kırmızı +X (three -X), yeşil +Y, mavi +Z
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -len, 0, 0, 0, 0, 0, 0, len, 0, 0, 0, 0, 0, 0, len], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.3, 0.3, 1, 0.3, 0.3, 0.4, 1, 0.4, 0.4, 1, 0.4, 0.35, 0.6, 1, 0.35, 0.6, 1], 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, toneMapped: false })); l.renderOrder = 20; return l;
}

export function initModel(ctx) {
  const { scene, camera, renderer, orbit, api, toast, $ } = ctx;

  // ── durum
  let file = null; // { dir, name }
  let view = normalizeView();
  let info = null, loadError = null;
  let active = false;
  let loaded = null; // { root, clips, bytes, ext, autoUnit }
  let loadedKey = null, loadingKey = null, loadingP = null, loadToken = 0;
  let mixer = null, action = null;
  let selPart = null;
  const undoV = [], redoV = [];
  const openSecs = new Set((() => { try { return JSON.parse(localStorage.getItem('upe-mdl-open')) || null; } catch { return null; } })() || ['_info', '_view', '_anim']);
  const saveOpen = () => { try { localStorage.setItem('upe-mdl-open', JSON.stringify([...openSecs])); } catch { /* yok */ } };

  // ── sahne düğümleri: root (sabit) → turn (döner tabla) → holder (birim ölçeği) → model
  const root = new THREE.Group(); root.name = 'model-root'; root.visible = false; scene.add(root);
  const turn = new THREE.Group(); root.add(turn);
  const holder = new THREE.Group(); turn.add(holder);
  const baseBox = new THREE.Box3(); // bind pozunda, döner tabla 0'dayken sınır kutusu (metre, three ekseni)
  const boxHelper = new THREE.Box3Helper(baseBox, 0x2cc9e0); boxHelper.visible = false; turn.add(boxHelper);
  let axes = null, skelHelper = null, selHelper = null;
  const ref = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.36, 8, 24), new THREE.MeshStandardMaterial({ color: 0x8a93a6, roughness: 0.9, transparent: true, opacity: 0.45 }));
  ref.position.y = 0.9; ref.visible = false; root.add(ref);

  // ── görünüm materyalleri
  const clayMat = new THREE.MeshStandardMaterial({ color: 0xb9bdc6, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
  const uvMat = new THREE.MeshBasicMaterial({ map: checkerTexture(), side: THREE.DoubleSide });
  const noUvMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide });
  const wireMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, wireframe: true, transparent: true, opacity: 0.28, depthWrite: false });
  const unlitCache = new Map();
  const unlitOf = (m) => {
    if (!unlitCache.has(m)) unlitCache.set(m, new THREE.MeshBasicMaterial({ map: m.map || null, color: m.color ? m.color.clone() : 0xffffff, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, side: m.side, vertexColors: m.vertexColors }));
    return unlitCache.get(m);
  };
  let envTex = null;
  const envMap = () => (envTex ||= new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture);

  const eachMesh = (fn) => { if (loaded) loaded.root.traverse((o) => { if (o.isMesh && !o.userData.mvWire) fn(o); }); };
  const wires = [];

  // ── yükleme
  const gltfLoader = new GLTFLoader(), fbxLoader = new FBXLoader(), objLoader = new OBJLoader();
  const keyOf = (f) => (f ? f.dir + '/' + f.name : '');
  const urlOf = (f) => `/${f.dir}/` + encodeURIComponent(f.name);
  function ensureLoaded(opts) { // file'daki modeli (bir kez) yükler
    const k = keyOf(file); if (!k || k === loadedKey) return Promise.resolve();
    if (k === loadingKey) return loadingP;
    loadingKey = k; loadingP = loadFile(file, opts).finally(() => { if (loadingKey === k) loadingKey = null; });
    return loadingP;
  }
  async function loadFile(f, { resetView = false, autoClip = false } = {}) {
    const tok = ++loadToken; loadError = null;
    if (active) { $('#hud').textContent = 'Model yükleniyor: ' + f.name; buildUI(); }
    try {
      const res = await fetch(urlOf(f)); if (!res.ok) throw new Error('Model bulunamadı: ' + f.dir + '/' + f.name);
      const buf = await res.arrayBuffer(); const ext = f.name.split('.').pop().toLowerCase();
      let o, clips = [];
      if (ext === 'fbx') { o = fbxLoader.parse(buf, `/${f.dir}/`); clips = o.animations || []; }
      else if (ext === 'obj') o = objLoader.parse(new TextDecoder().decode(buf));
      else { const g = await gltfLoader.parseAsync(buf, `/${f.dir}/`); o = g.scene; clips = g.animations || []; }
      if (tok !== loadToken) { dispose(o); return; }
      clearModel();
      o.traverse((n) => { if (n.isMesh) { n.userData.mvOrig = n.material; if (n.isSkinnedMesh) n.frustumCulled = false; } });
      holder.add(o); holder.scale.setScalar(1); turn.rotation.y = 0;
      root.updateMatrixWorld(true);
      const raw = new THREE.Box3().setFromObject(o, true).getSize(new THREE.Vector3());
      loaded = { root: o, clips, bytes: buf.byteLength, ext, autoUnit: Math.max(raw.x, raw.y, raw.z) > 20 ? 'cm' : 'm' };
      loadedKey = keyOf(f); selPart = null;
      if (resetView) { pushUndo(); view = normalizeView({ ...view, clip: clips[0]?.name ?? null, hidden: [], time: 0, paused: false }); }
      else if ((autoClip && !view.clip) || (view.clip && !clips.some((c) => c.name === view.clip))) view.clip = clips[0]?.name ?? null; // klip seçilmedi / başka modelden kalan ad
      if (o.getObjectByProperty('isBone', true)) { skelHelper = new THREE.SkeletonHelper(o); skelHelper.material.depthTest = false; skelHelper.material.toneMapped = false; skelHelper.renderOrder = 19; root.add(skelHelper); }
      applyUnit(); info = computeInfo(); setupAnim(); applyAll();
      if (active) { buildUI(); frame(); }
      sync();
    } catch (e) {
      if (tok !== loadToken) return;
      loadError = String(e.message || e); if (active) { toast('Model yüklenemedi: ' + loadError, 'err'); buildUI(); }
      throw e;
    }
  }
  function dispose(o) {
    o.traverse((n) => {
      if (!n.isMesh || n.userData.mvWire) return;
      n.geometry?.dispose();
      for (const m of [n.userData.mvOrig || n.material].flat()) { if (!m) continue; for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); }
    });
  }
  function clearModel() {
    mixer?.stopAllAction(); mixer = null; action = null;
    for (const w of wires) w.removeFromParent(); wires.length = 0;
    skelHelper?.removeFromParent(); skelHelper?.dispose(); skelHelper = null;
    selHelper?.removeFromParent(); selHelper = null;
    if (loaded) { loaded.root.removeFromParent(); dispose(loaded.root); }
    for (const u of unlitCache.values()) u.dispose(); unlitCache.clear();
    loaded = null; loadedKey = null; info = null;
  }

  // ── birim + yardımcılar (sınır kutusu, pivot, boy referansı)
  const unitNow = () => (view.unit === 'auto' ? loaded?.autoUnit || 'm' : view.unit);
  function applyUnit() {
    if (!loaded) return;
    const r = turn.rotation.y; turn.rotation.y = 0;
    holder.scale.setScalar(unitNow() === 'cm' ? 0.01 : 1); root.updateMatrixWorld(true);
    baseBox.setFromObject(holder, true); if (baseBox.isEmpty()) baseBox.setFromCenterAndSize(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(1, 1, 1));
    turn.rotation.y = r;
    const size = baseBox.getSize(new THREE.Vector3());
    axes?.removeFromParent(); axes = makeAxes(Math.max(0.15, Math.max(size.x, size.y, size.z) * 0.35)); turn.add(axes);
    const rad = Math.max(Math.abs(baseBox.min.x), Math.abs(baseBox.max.x), Math.abs(baseBox.min.z), Math.abs(baseBox.max.z));
    ref.position.x = rad + 0.45; // önden bakınca sağda (Unity -X tarafı)
    if (info) { info.unit = unitNow(); info.size = size.toArray().map((v) => +v.toFixed(4)); const c = baseBox.getCenter(new THREE.Vector3()); info.center = [-c.x, c.y, c.z].map((v) => +v.toFixed(4)); }
  }
  function applyShading() {
    const pick = (m, o) => {
      switch (view.shading) {
        case 'clay': return clayMat; case 'normals': return normalMat; case 'unlit': return unlitOf(o);
        case 'uv': return m.geometry.hasAttribute('uv') ? uvMat : noUvMat;
        default: return o;
      }
    };
    eachMesh((m) => { const o = m.userData.mvOrig; m.material = Array.isArray(o) ? o.map((x) => pick(m, x)) : pick(m, o); });
  }
  function applyWire() {
    for (const w of wires) w.removeFromParent(); wires.length = 0;
    if (!view.wireframe) return;
    wireMat.color.set(view.shading === 'texture' || view.shading === 'unlit' ? 0xbfe9ff : 0x1b2230); wireMat.opacity = view.shading === 'texture' || view.shading === 'unlit' ? 0.28 : 0.4; // açık zeminde koyu çizgi
    eachMesh((m) => { const w = m.clone(false); w.material = wireMat; w.userData = { mvWire: true }; if (m.morphTargetInfluences) w.morphTargetInfluences = m.morphTargetInfluences; m.parent.add(w); wires.push(w); });
  }
  function applyHidden() {
    const h = new Set(view.hidden);
    eachMesh((m) => { m.visible = !h.has(partName(m)); });
    for (const w of wires) w.visible = !h.has(partName(w));
  }
  function applyScene() { // arka plan, ortam, pozlama, ızgara, yardımcıların görünürlüğü
    if (!active) return;
    scene.background = new THREE.Color(view.background); scene.environment = view.env ? envMap() : null;
    renderer.toneMappingExposure = view.exposure; ctx.grid.visible = view.grid;
    boxHelper.visible = view.bounds && !!loaded; if (axes) axes.visible = view.axes && !!loaded; ref.visible = view.scaleRef;
    if (skelHelper) skelHelper.visible = view.skeleton;
    if (!view.rotate) turn.rotation.y = 0;
  }
  function applyAll() { applyShading(); applyWire(); applyHidden(); applyAnim(); applyScene(); refreshSelHelper(); } // birim ayrı: applyUnit (sınır kutusu hesabı pahalı)
  const SCENE_KEYS = ['grid', 'env', 'exposure', 'background', 'bounds', 'axes', 'scaleRef', 'skeleton', 'rotate'], ANIM_KEYS = ['clip', 'speed', 'paused', 'time'];

  // ── gömülü animasyon
  function setupAnim() {
    mixer?.stopAllAction(); mixer = null; action = null;
    if (loaded?.clips.length) mixer = new THREE.AnimationMixer(loaded.root);
  }
  function applyAnim() {
    if (!mixer) return;
    const clip = loaded.clips.find((c) => c.name === view.clip) || null;
    if (action?.getClip() !== clip) { mixer.stopAllAction(); action = clip ? mixer.clipAction(clip) : null; action?.play(); }
    if (!action) { loaded.root.traverse((o) => { if (o.isBone && o.userData.mvRest) { o.position.copy(o.userData.mvRest[0]); o.quaternion.copy(o.userData.mvRest[1]); o.scale.copy(o.userData.mvRest[2]); } }); return; }
    if (view.paused) mixer.setTime(view.time);
    refreshTransport();
  }
  const clipLen = () => action?.getClip().duration || 0;
  const animTime = () => (action ? (clipLen() ? action.time % clipLen() : 0) : 0);

  // ── bilgi
  function computeInfo() {
    const o = loaded.root; let tris = 0, verts = 0, meshes = 0, skinned = 0, vcol = false, noUv = 0, morphs = 0;
    const mats = new Map(), texs = new Map(), bones = new Set(), parts = new Map();
    o.traverse((n) => {
      if (n.isBone) { bones.add(n); n.userData.mvRest = [n.position.clone(), n.quaternion.clone(), n.scale.clone()]; }
      if (!n.isMesh || n.userData.mvWire) return;
      const g = n.geometry; const vc = g.attributes.position?.count || 0; const tc = Math.round(g.index ? g.index.count / 3 : vc / 3);
      meshes++; tris += tc; verts += vc; if (n.isSkinnedMesh) skinned++; if (g.hasAttribute('color')) vcol = true; if (!g.hasAttribute('uv')) noUv++;
      morphs = Math.max(morphs, Object.keys(n.morphTargetDictionary || {}).length);
      const ms = [n.userData.mvOrig].flat().filter(Boolean);
      for (const m of ms) {
        if (!mats.has(m.uuid)) mats.set(m.uuid, { name: m.name || '(adsız)', type: m.type, color: m.color ? '#' + m.color.getHexString() : null, maps: [], transparent: !!m.transparent, doubleSided: m.side === THREE.DoubleSide });
        for (const [k, v] of Object.entries(m)) {
          if (!v?.isTexture) continue;
          const mi = mats.get(m.uuid); if (!mi.maps.includes(k)) mi.maps.push(k);
          if (!texs.has(v.uuid)) texs.set(v.uuid, { tex: v, slots: new Set() }); texs.get(v.uuid).slots.add(k);
        }
      }
      const pn = partName(n); const p = parts.get(pn) || { name: pn, count: 0, triangles: 0, vertices: 0, materials: new Set(), skinned: false, uv: true };
      p.count++; p.triangles += tc; p.vertices += vc; p.skinned ||= !!n.isSkinnedMesh; p.uv &&= g.hasAttribute('uv'); for (const m of ms) p.materials.add(m.name || '(adsız)'); parts.set(pn, p);
    });
    const size = baseBox.getSize(new THREE.Vector3()); const c = baseBox.getCenter(new THREE.Vector3());
    let ti = 0;
    return {
      file: file.name, dir: file.dir, format: loaded.ext, bytes: loaded.bytes, unit: unitNow(),
      size: size.toArray().map((v) => +v.toFixed(4)), center: [-c.x, c.y, c.z].map((v) => +v.toFixed(4)),
      meshes, skinned, triangles: tris, vertices: verts, bones: bones.size, morphTargets: morphs, vertexColors: vcol, missingUv: noUv,
      materials: [...mats.values()],
      textures: [...texs.values()].map(({ tex, slots }) => ({ name: tex.name || String(tex.image?.src || '').split('/').pop().split('?')[0] || 'doku ' + ++ti, width: tex.image?.width || 0, height: tex.image?.height || 0, slots: [...slots], _tex: tex })),
      clips: loaded.clips.map((cl) => ({ name: cl.name, duration: +cl.duration.toFixed(3), tracks: cl.tracks.length })),
      parts: [...parts.values()].slice(0, 400).map((p) => ({ ...p, materials: [...p.materials] })),
    };
  }
  const infoOut = () => (info ? { ...info, textures: info.textures.map(({ _tex, ...t }) => ({ ...t, width: _tex.image?.width || t.width, height: _tex.image?.height || t.height })) } : null);

  // ── veri akışı + geri al
  let syncT = null;
  const sync = () => { clearTimeout(syncT); syncT = setTimeout(() => api('/api/model-view', { file, view, info: infoOut() }).catch(() => {}), 250); };
  const pushUndo = () => { undoV.push(JSON.stringify(view)); if (undoV.length > 100) undoV.shift(); redoV.length = 0; };
  function setView(patch, { rebuild = true, undo = true } = {}) {
    if (undo) pushUndo();
    const prev = view; view = normalizeView({ ...view, ...patch });
    const changed = Object.keys(patch).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(view[k]));
    if (changed.includes('unit')) { applyUnit(); frame(); }
    if (changed.some((k) => !SCENE_KEYS.includes(k) && !ANIM_KEYS.includes(k))) applyAll(); else { applyScene(); applyAnim(); }
    if (rebuild) buildUI(); sync();
  }
  function undo() { if (!undoV.length) return; redoV.push(JSON.stringify(view)); view = normalizeView(JSON.parse(undoV.pop())); applyUnit(); applyAll(); buildUI(); sync(); }
  function redo() { if (!redoV.length) return; undoV.push(JSON.stringify(view)); view = normalizeView(JSON.parse(redoV.pop())); applyUnit(); applyAll(); buildUI(); sync(); }

  // ── kamera
  function frameBox() {
    const box = new THREE.Box3(); root.updateMatrixWorld(true);
    if (selPart) eachMesh((m) => { if (partName(m) === selPart && m.visible) box.expandByObject(m, true); });
    if (box.isEmpty()) { box.copy(baseBox).applyMatrix4(turn.matrixWorld); if (view.scaleRef && !box.isEmpty()) box.expandByObject(ref); }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(1, 1.8, 1));
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.05, box.getSize(new THREE.Vector3()).length() / 2);
    return { center: c, dist: (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1 };
  }
  function fitClip(dist) { camera.near = Math.max(0.005, dist / 500); camera.far = Math.max(100, dist * 20); camera.updateProjectionMatrix(); }
  function frame() {
    const f = frameBox(); const dir = camera.position.clone().sub(orbit.target); if (dir.lengthSq() < 1e-6) dir.set(...PRESET_DIR.threequarter);
    orbit.target.copy(f.center); camera.position.copy(f.center).addScaledVector(dir.normalize(), f.dist); fitClip(f.dist); orbit.update();
  }

  // ── parça seçimi (viewport tıklaması ya da liste)
  function refreshSelHelper() {
    selHelper?.removeFromParent(); selHelper = null;
    if (!selPart || !loaded) return;
    const g = new THREE.Group(); eachMesh((m) => { if (partName(m) === selPart) { const h = new THREE.BoxHelper(m, 0xffd400); h.material.depthTest = false; h.material.toneMapped = false; h.renderOrder = 21; h.userData.src = m; g.add(h); } });
    selHelper = g; root.add(g);
  }
  function selectPart(name) { selPart = name || null; refreshSelHelper(); buildUI(); }
  const ray = new THREE.Raycaster(); let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = active ? [e.clientX, e.clientY] : null; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!active || !loaded || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const list = []; eachMesh((m) => { if (m.visible) list.push(m); });
    const hit = ray.intersectObjects(list, false)[0];
    selectPart(hit ? partName(hit.object) : null);
  });

  // ── tick + çizim
  function tick(dt) {
    if (!active) return;
    if (view.rotate && loaded) turn.rotation.y += dt * 0.4;
    if (mixer && action && !view.paused) { mixer.update(dt * view.speed); refreshTransport(); }
    if (selHelper) for (const h of selHelper.children) h.update();
    $('#hud').textContent = loaded && info ? `Model · ${file.name} · ${kilo(info.triangles)} üçgen · ${m3(info.size)} m${selPart ? ' · seçili: ' + selPart : ''}${view.scaleRef ? ' · gri kapsül 1,8 m' : ''}`
      : loadError ? 'Model yüklenemedi: ' + loadError : file ? 'Model yükleniyor: ' + file.name : 'Model · soldan bir model seç ya da pencereye sürükle-bırak';
  }
  const render = () => renderer.render(scene, camera);

  // ── alt çubuk: gömülü animasyon
  function refreshTransport() {
    const bar = $('#mdlTransport'); const has = !!loaded?.clips.length; bar.classList.toggle('empty', !has); if (!has) return;
    $('#mdlPlay').textContent = action && !view.paused ? '⏸' : '▶';
    const len = clipLen(), t = animTime();
    if (document.activeElement !== $('#mdlTime')) $('#mdlTime').value = len ? Math.round((t / len) * 1000) : 0;
    $('#mdlTimeLabel').textContent = `${t.toFixed(2)} / ${len.toFixed(2)} sn`;
  }
  function fillClipSelect() {
    const s = $('#mdlClip'); s.innerHTML = ''; s.add(new Option('— bind pozu —', ''));
    for (const c of loaded?.clips || []) s.add(new Option(`${c.name || '(adsız)'} · ${c.duration.toFixed(2)} sn`, c.name));
    s.value = view.clip || ''; $('#mdlSpeed').value = String(view.speed);
  }
  function togglePlay() { if (!action) return; setView({ paused: !view.paused, time: animTime() }, { rebuild: false, undo: false }); refreshTransport(); }
  function nudge(dt) { if (!action) return; const len = clipLen() || 1; setView({ paused: true, time: Math.min(len, Math.max(0, animTime() + dt)) }, { rebuild: false, undo: false }); }
  $('#mdlPlay').onclick = togglePlay;
  $('#mdlClip').onchange = (e) => setView({ clip: e.target.value || null, time: 0, paused: false });
  $('#mdlSpeed').onchange = (e) => setView({ speed: +e.target.value }, { rebuild: false });
  $('#mdlTime').oninput = (e) => { if (!action) return; view.paused = true; view.time = (+e.target.value / 1000) * clipLen(); mixer.setTime(view.time); refreshTransport(); };
  $('#mdlTime').onchange = () => sync();

  // ── sol panel: kütüphane
  let files = { meshes: [], models: [], props: [] };
  async function refreshLib() {
    files = await fetch('/api/model-files').then((r) => (r.ok ? r.json() : null)).catch(() => null) || files;
    fillLib();
  }
  function fillLib() {
    const box = $('#mdlLib'); box.innerHTML = ''; const q = $('#mdlSearch').value.trim().toLocaleLowerCase('tr');
    let any = false;
    for (const [dir, title] of Object.entries(DIRS)) {
      const list = (files[dir] || []).filter((n) => !q || n.toLocaleLowerCase('tr').includes(q)); if (!list.length) continue;
      any = true; box.appendChild(el('div', 'vl grp', `${title} <small>${dir}/</small>`));
      for (const n of list) {
        const cur = file && file.dir === dir && file.name === n;
        const r = el('div', 'li' + (cur ? ' sel' : ''), '<span class="n"></span><small></small>');
        r.querySelector('.n').textContent = n.replace(MESH_EXT, ''); r.querySelector('small').textContent = n.split('.').pop().toLowerCase(); r.title = `${dir}/${n}`;
        r.onclick = () => openFile({ dir, name: n });
        box.appendChild(r);
      }
    }
    if (!any) box.appendChild(el('div', 'hint-s', q ? 'Eşleşen model yok.' : 'Henüz model yok. GLB/FBX/OBJ dosyasını yükle ya da pencereye sürükle-bırak.'));
  }
  function openFile(f) { file = f; loadingKey = null; fillLib(); ensureLoaded({ resetView: true }).catch(() => {}); } // tıklama her zaman yeni yükleme başlatır (takılanı da geçer)
  async function dropFile(f) {
    if (!MESH_EXT.test(f.name)) return toast('Model dosyası değil (GLB, glTF, FBX, OBJ)', 'err');
    const r = await fetch('/api/upload-mesh?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }).then((x) => x.json()).catch((e) => ({ error: e.message }));
    if (r.error || !r.name) return toast('Hata: ' + (r.error || 'yüklenemedi'), 'err');
    await refreshLib(); openFile({ dir: 'meshes', name: r.name }); toast('Yüklendi: meshes/' + r.name, 'ok');
  }
  $('#mdlSearch').oninput = fillLib;
  $('#mdlFile').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) dropFile(f); };

  // ── sağ panel
  function section(title, key) {
    const d = el('details'); d.open = openSecs.has(key); d.appendChild(el('summary', '', title));
    d.ontoggle = () => { if ($('#panelFilter')?.value) return; if (d.open) openSecs.add(key); else openSecs.delete(key); saveOpen(); };
    return d;
  }
  const tog = (label, key) => { const l = el('label', 'chk vtog'); const c = el('input'); c.type = 'checkbox'; c.checked = view[key]; c.onchange = () => setView({ [key]: c.checked }); l.append(c, ' ' + label); return l; };
  function buildUI() {
    if (!active) return;
    fillClipSelect(); refreshTransport();
    const box = $('#mdlRight'); const scroll = $('#right').scrollTop; box.innerHTML = '';
    // bilgi
    const si = section('Bilgi', '_info');
    if (!file) si.appendChild(el('div', 'hint-s', 'Soldaki listeden bir model seç.'));
    else if (loadError) si.appendChild(el('div', 'hint-s err', 'Yüklenemedi: ' + esc(loadError)));
    else if (!info) si.appendChild(el('div', 'hint-s', 'Yükleniyor: ' + esc(file.name)));
    else {
      const kv = el('div', 'kv'); const row = (k, v, title) => { const a = el('span'); a.textContent = k; const b = el('b'); b.textContent = v; if (title) b.title = title; kv.append(a, b); };
      row('Dosya', `${file.dir}/${file.name}`, `${file.dir}/${file.name}`); row('Biçim', `${info.format.toUpperCase()} · ${bytesStr(info.bytes)}`);
      row('Ölçü (G × Y × D)', m3(info.size) + ' m'); row('Birim', `${info.unit === 'cm' ? 'santimetre (×0,01)' : 'metre'}${view.unit === 'auto' ? ' · otomatik' : ''}`);
      row('Parça (mesh)', `${num(info.meshes)}${info.skinned ? ` · ${info.skinned} skinned` : ''}`); row('Üçgen', num(info.triangles)); row('Köşe', num(info.vertices));
      row('Materyal', num(info.materials.length)); row('Doku', num(info.textures.length)); row('Kemik', num(info.bones));
      row('Animasyon', info.clips.length ? info.clips.length + ' klip' : 'yok');
      if (info.morphTargets) row('Morph', num(info.morphTargets)); if (info.vertexColors) row('Köşe rengi', 'var');
      if (info.missingUv) row('UV yok', info.missingUv + ' parçada');
      si.appendChild(kv);
    }
    box.appendChild(si);
    // görünüm
    const sv = section('Görünüm', '_view');
    const seg = el('div', 'seg');
    for (const [k, label] of Object.entries(SHADING)) { const b = el('button', view.shading === k ? 'on' : '', label); b.title = { texture: 'Özgün materyaller', clay: 'Gri kil: biçime bak', normals: 'Yüzey normalleri', uv: 'UV kontrol dokusu (harf = u, sayı = v)', unlit: 'Yalnız doku rengi, ışık yok' }[k]; b.onclick = () => setView({ shading: k }); seg.appendChild(b); }
    sv.appendChild(seg);
    const tg = el('div', 'grid2 togs');
    tg.append(tog('Tel kafes', 'wireframe'), tog('İskelet', 'skeleton'), tog('Sınır kutusu', 'bounds'), tog('Pivot eksenleri', 'axes'), tog('Boy referansı', 'scaleRef'), tog('Zemin ızgarası', 'grid'), tog('Döner tabla', 'rotate'), tog('Ortam yansıması', 'env'));
    sv.appendChild(tg);
    const ex = el('div', 'vf'); ex.appendChild(el('label', 'vl', 'Pozlama')); const exr = el('div', 'vrow'); const rg = el('input'); rg.type = 'range'; rg.min = 0.2; rg.max = 3; rg.step = 0.01; rg.value = view.exposure;
    const ev = el('span', 'hint-s', view.exposure.toFixed(2)); rg.onpointerdown = () => pushUndo(); rg.oninput = () => { ev.textContent = (+rg.value).toFixed(2); setView({ exposure: +rg.value }, { rebuild: false, undo: false }); };
    exr.append(rg, ev); ex.appendChild(exr); sv.appendChild(ex);
    const two = el('div', 'grid2');
    const bg = el('label', '', 'Arka plan'); const bgi = el('input'); bgi.type = 'color'; bgi.value = view.background; bgi.onfocus = () => pushUndo(); bgi.oninput = () => setView({ background: bgi.value }, { rebuild: false, undo: false }); bg.appendChild(bgi);
    const un = el('label', '', 'Birim'); const us = el('select'); for (const [v, t] of [['auto', 'Otomatik'], ['m', 'Metre'], ['cm', 'Santimetre']]) us.add(new Option(t, v)); us.value = view.unit; us.onchange = () => setView({ unit: us.value }); un.appendChild(us);
    two.append(bg, un); sv.appendChild(two);
    sv.appendChild(el('div', 'hint-s', 'Pivot: kırmızı X, yeşil Y, mavi Z (Unity ekseni). Gri kapsül 1,8 m boyunda.'));
    box.appendChild(sv);
    if (info) {
      // gömülü animasyonlar
      if (info.clips.length) {
        const sa = section(`Animasyonlar (${info.clips.length})`, '_anim'); const l = el('div', 'list');
        for (const c of info.clips) { const r = el('div', 'li' + (c.name === view.clip ? ' sel' : ''), '<span class="n"></span><small></small>'); r.querySelector('.n').textContent = c.name || '(adsız)'; r.querySelector('small').textContent = c.duration.toFixed(2) + ' sn'; r.onclick = () => setView({ clip: c.name, time: 0, paused: false }); l.appendChild(r); }
        sa.appendChild(l); box.appendChild(sa);
      }
      // parçalar
      const sp = section(`Parçalar (${info.parts.length})`, '_parts');
      const hidden = new Set(view.hidden);
      if (hidden.size) { const b = el('button', 'small', `Hepsini göster (${hidden.size} gizli)`); b.onclick = () => setView({ hidden: [] }); sp.appendChild(b); }
      const pl = el('div', 'list');
      for (const p of info.parts) {
        const r = el('div', 'li' + (p.name === selPart ? ' sel' : ''), '<input type="checkbox" title="Göster / gizle"><span class="n"></span><small></small><button title="Bu parçaya odakla">◎</button>');
        const c = r.querySelector('input'); c.checked = !hidden.has(p.name); c.onclick = (e) => e.stopPropagation();
        c.onchange = () => setView({ hidden: c.checked ? view.hidden.filter((n) => n !== p.name) : [...view.hidden, p.name] });
        r.querySelector('.n').textContent = p.name + (p.count > 1 ? ` ×${p.count}` : ''); r.querySelector('small').textContent = kilo(p.triangles) + ' △';
        r.title = `${p.name}\nmateryal: ${p.materials.join(', ') || '—'}\n${num(p.triangles)} üçgen · ${num(p.vertices)} köşe${p.skinned ? ' · skinned' : ''}${p.uv ? '' : ' · UV yok'}`;
        r.querySelector('button').onclick = (e) => { e.stopPropagation(); selectPart(p.name); frame(); };
        r.onclick = () => selectPart(p.name === selPart ? null : p.name);
        pl.appendChild(r);
      }
      sp.appendChild(pl); box.appendChild(sp);
      // materyaller + dokular
      const sm = section(`Materyaller (${info.materials.length})`, '_mats'); const ml = el('div', 'list');
      for (const m of info.materials) {
        const r = el('div', 'li', '<i class="sw"></i><span class="n"></span><small></small>'); r.querySelector('.sw').style.background = m.color || 'transparent';
        r.querySelector('.n').textContent = m.name; r.querySelector('small').textContent = m.type.replace(/^Mesh|Material$/g, '');
        r.title = `${m.name} · ${m.type}\ndokular: ${m.maps.join(', ') || '—'}${m.transparent ? '\nsaydam' : ''}${m.doubleSided ? '\nçift yüz' : ''}`; ml.appendChild(r);
      }
      sm.appendChild(ml);
      if (info.textures.length) {
        const tg2 = el('div', 'texgrid');
        for (const t of info.textures) {
          const cell = el('div', 'tex'); const cv = el('canvas'); cv.width = cv.height = 64; const img = t._tex.image;
          try { if (img?.width) cv.getContext('2d').drawImage(img, 0, 0, 64, 64); } catch { /* çizilemeyen doku */ }
          const w = img?.width || t.width, h = img?.height || t.height;
          cell.append(cv, el('small', '', esc(t.name))); cell.title = `${t.name}\n${w}×${h}\n${t.slots.join(', ')}`; tg2.appendChild(cell);
        }
        sm.appendChild(tg2);
      }
      box.appendChild(sm);
    }
    $('#right').scrollTop = scroll;
  }

  // ── kontak sayfası (MCP render_model)
  async function renderSheet(d) {
    const prevMode = ctx.getMode(); const was = active; if (!was) ctx.setMode('model', { notify: false });
    const size = Math.max(128, Math.min(1024, d.size || 320));
    try { await ensureLoaded(); } catch { /* aşağıda hata karesi */ }
    if (!loaded) {
      const c = el('canvas'); c.width = size * 2; c.height = size / 2; const x = c.getContext('2d'); x.fillStyle = '#2b2f36'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#fff'; x.font = `${Math.round(size / 16)}px system-ui`; x.fillText(loadError ? 'Model yüklenemedi: ' + loadError : 'Model yüklü değil (önce view_model)', 12, c.height / 2);
      if (!was) ctx.setMode(prevMode, { notify: false });
      return c.toDataURL('image/png');
    }
    const views = d.camera?.position ? ['kamera'] : (Array.isArray(d.views) && d.views.length ? d.views : ['threequarter', 'front', 'side']).slice(0, 8);
    const keep = { view, pos: camera.position.clone(), target: orbit.target.clone(), aspect: camera.aspect, near: camera.near, far: camera.far, spin: turn.rotation.y };
    if (d.view || typeof d.time === 'number') { view = normalizeView({ ...view, ...(d.view || {}), ...(typeof d.time === 'number' ? { paused: true, time: d.time } : {}) }); if (view.unit !== keep.view.unit) applyUnit(); applyAll(); }
    turn.rotation.y = 0;
    const f = frameBox(); const cols = Math.min(views.length, 4), rows = Math.ceil(views.length / cols);
    const sheet = el('canvas'); sheet.width = cols * size; sheet.height = rows * size; const sx = sheet.getContext('2d');
    renderer.setPixelRatio(1); renderer.setSize(size, size, false); camera.aspect = 1; fitClip(f.dist); camera.updateProjectionMatrix();
    try {
      const U = (a) => new THREE.Vector3(-a[0], a[1], a[2]); // Unity ekseni → three
      views.forEach((v, i) => {
        if (d.camera?.position) { camera.position.copy(U(d.camera.position)); camera.lookAt(d.camera.target ? U(d.camera.target) : f.center); }
        else { const dir = new THREE.Vector3(...(PRESET_DIR[v] || PRESET_DIR.threequarter)); dir.x = -dir.x; camera.position.copy(f.center).addScaledVector(dir.normalize(), f.dist); camera.lookAt(f.center); }
        if (selHelper) for (const h of selHelper.children) h.update();
        render();
        const x = (i % cols) * size, y = Math.floor(i / cols) * size; sx.drawImage(renderer.domElement, x, y, size, size);
        sx.font = `${Math.round(size / 20)}px system-ui`; sx.fillStyle = '#ffffffcc'; sx.shadowColor = '#000'; sx.shadowBlur = 4; sx.fillText(v, x + 8, y + size / 14);
        if (i === 0) { sx.font = `${Math.round(size / 26)}px system-ui`; sx.fillText(`${file.name} · ${m3(info.size)} m · ${kilo(info.triangles)} üçgen`, x + 8, y + size - 10); }
        sx.shadowBlur = 0; sx.strokeStyle = '#ffffff30'; sx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      });
    } finally {
      if (keep.view !== view) { const u = view.unit !== keep.view.unit; view = keep.view; if (u) applyUnit(); applyAll(); }
      turn.rotation.y = keep.spin; camera.position.copy(keep.pos); orbit.target.copy(keep.target); camera.aspect = keep.aspect; camera.near = keep.near; camera.far = keep.far; camera.updateProjectionMatrix(); orbit.update();
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); ctx.onResize();
      if (!was) ctx.setMode(prevMode, { notify: false });
    }
    return sheet.toDataURL('image/png');
  }

  // ── mod geçişi
  let prevTone = null, prevClip = null;
  function activate() {
    active = true; root.visible = true; ctx.overlay.visible = false; ctx.setHeroVisible(false);
    prevTone = [renderer.toneMapping, renderer.toneMappingExposure]; renderer.toneMapping = THREE.NeutralToneMapping;
    prevClip = [camera.near, camera.far];
    applyScene(); refreshLib(); buildUI();
    ensureLoaded().catch(() => {});
  }
  function deactivate() {
    active = false; root.visible = false; ctx.overlay.visible = true; ctx.grid.visible = true; ctx.setHeroVisible(true);
    scene.background = new THREE.Color(ctx.BG); scene.environment = null;
    if (prevTone) [renderer.toneMapping, renderer.toneMappingExposure] = prevTone;
    if (prevClip) { [camera.near, camera.far] = prevClip; camera.updateProjectionMatrix(); }
  }

  // ── Claude olayları
  async function onRemoteView(d) { // view_model: modeli yükle (gerekirse) + görünümü uygula, sonucu (bilgi) geri bildir
    let error = null; const autoClip = !(d.view && Object.hasOwn(d.view, 'clip')); // Claude klip vermediyse yeni modelin ilk klibi
    pushUndo(); view = normalizeView(d.view);
    if (d.file) file = d.file;
    if (d.reload && keyOf(file) === loadedKey) loadedKey = null; // path ile yeniden kopyalandı: içerik değişmiş olabilir
    try { await ensureLoaded({ autoClip }); applyUnit(); applyAll(); buildUI(); refreshLib(); if (loaded && d.file) frame(); } catch (e) { error = String(e.message || e); }
    api('/api/model-view', { id: d.id, file, view, info: infoOut(), error }).catch(() => {});
    if (!error) toast('Claude modeli açtı: ' + (file?.name || ''), 'ok');
  }
  function setFromState(mv) { if (mv?.file) file = mv.file; view = normalizeView(mv?.view); }

  return {
    activate, deactivate, get active() { return active; }, tick, render, undo, redo, frame,
    togglePlay, nudge, dropFile, onRemoteView, setFromState, renderSheet,
    get debug() { return { file, loadedKey, loadingKey, loadToken, loadError, loaded: !!loaded, info: !!info, view }; }, // hata ayıklama
    noteContext: () => ({ label: `Model · ${file?.name || '—'}${selPart ? ' · parça ' + selPart : ''} · görünüm ${SHADING[view.shading]}`, data: { mode: 'model', target: file ? `${file.dir}/${file.name}` : null, part: selPart } }),
    baseline: () => api('/api/model-view', { file, view, info: infoOut() }),
    get itemName() { return file ? `Model <b>${esc(file.name)}</b>${info ? ` · ${kilo(info.triangles)} üçgen · ${m3(info.size)} m` : loadError ? ' · <span style="color:var(--err)">yüklenemedi</span>' : ' · yükleniyor…'}` : 'Model · seçilmedi'; },
  };
}
