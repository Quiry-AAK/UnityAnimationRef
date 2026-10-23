// Materyal + Shader modları: önizleme nesnesi/kahraman üzerinde UPE materyalleri, özellik paneli, ışık, shader kod editörü,
// derleme denetimi, kütüphane, Unity'ye gönderim ve Claude köprüsü (kontak sayfası, uzaktan güncelleme).
// Şema: shader-schema.js · hazır shader'lar: shader-builtins.js · GLSL çevirisi/materyal: shader-compile.js
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { normalizeShader, normalizeMaterial, defaultMaterial, normalizeLighting, clone, CUSTOM_PREFIX, PROPERTY_TYPES, BUILTIN_TEXTURES } from './shader-schema.js';
import { BUILTIN_SHADERS, TEMPLATES } from './shader-builtins.js';
import { createUPEMaterial, updateUPEValues, shared, installErrorHook, captureErrors, materialTexturesLoaded, clearMaterialTextureCache } from './shader-compile.js';
import { parseColorLinear, unityLightDir } from './shader-util.js';

const fmt = (v) => String(+(+v).toFixed(3));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const TARGET_LABELS = { sphere: 'Küre', cube: 'Küp', plane: 'Düzlem', capsule: 'Kapsül', torus: 'Simit', hero: 'Kahraman' };
const PRESET_DIR = { front: [0, 0.12, 1], side: [1, 0.12, 0], back: [0, 0.12, -1], top: [0, 1, 0.001], threequarter: [0.62, 0.32, 0.72] };

export function initMaterials(ctx) {
  const { scene, camera, renderer, orbit, viewport, api, toast, $ } = ctx;
  installErrorHook(renderer);

  // ── shader kayıt defteri: Unity adı → normalize shader (hazırlar + özel kütüphane)
  const shaders = new Map();
  for (const b of BUILTIN_SHADERS) { const s = normalizeShader(b).shader; shaders.set(s.unityName, s); }
  async function loadCustomShaders() {
    const list = await fetch('/api/shaders/list').then((r) => r.json()).catch(() => []);
    for (const it of list) {
      if (it.builtin) continue;
      const s = await fetch('/api/shaders/get?name=' + encodeURIComponent(it.name)).then((r) => r.json()).catch(() => null);
      if (s && !s.error) { const n = normalizeShader(s).shader; shaders.set(n.unityName, n); }
    }
  }
  const resolveShader = (unityName) => shaders.get(unityName) || null;
  const matCache = new Map(); // override için kütüphane materyalleri
  async function libMaterial(name) {
    if (!matCache.has(name)) matCache.set(name, fetch('/api/materials/get?name=' + encodeURIComponent(name)).then((r) => r.json()).then((m) => (m.error ? null : m)).catch(() => null));
    return matCache.get(name);
  }
  // VFX emitter'ları için: kütüphanedeki (kaydedilmiş) materyal + shader'ı; özel shader kayıtta yoksa sunucudan alınır
  async function libMaterialResolved(name) {
    const m = await libMaterial(name); if (!m) return null;
    let sh = resolveShader(m.shader);
    if (!sh) {
      const s = await fetch('/api/shaders/get?name=' + encodeURIComponent(m.shader)).then((r) => r.json()).catch(() => null);
      if (s && !s.error) { sh = normalizeShader(s).shader; shaders.set(sh.unityName, sh); }
    }
    return sh ? { shader: sh, values: normalizeMaterial(m, sh).material.values } : null;
  }

  // ── durum
  const def = () => normalizeMaterial(defaultMaterial(), resolveShader(defaultMaterial().shader)).material;
  let material = def();
  let editShader = normalizeShader({ ...TEMPLATES.unlit.shader, name: 'yeni_shader' }).shader; // Shader modunda düzenlenen
  let shaderPreviewValues = {}; // Shader modunda önizleme değerleri
  let lighting = normalizeLighting();
  let overrides = {};
  let mode = null; // 'material' | 'shader' | null (etkin değil)
  let compileState = { ok: true, errors: [], warnings: [] };
  const undoM = [], redoM = [], undoS = [], redoS = [];
  const openSecs = new Set((() => { try { return JSON.parse(localStorage.getItem('upe-mat-open')) || null; } catch { return null; } })() || ['_mat', '_props', '_prev', '_sh', '_pv']);
  const saveOpen = () => { try { localStorage.setItem('upe-mat-open', JSON.stringify([...openSecs])); } catch { /* yok */ } };

  // ── çizim (bloom'lu)
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 1.0); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let csz = '', fixedSize = false; // kontak sayfası çizilirken boyut denetimi kapalı
  const resize = () => { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(viewport.clientWidth, viewport.clientHeight); csz = viewport.clientWidth + 'x' + viewport.clientHeight + 'x' + renderer.getPixelRatio(); };
  const previewOf = () => material.preview;
  function render() { // boyut her karede denetlenir (açılışta düzen oturmadan etkinleşince sıfır boyut kalmasın)
    if (!fixedSize && csz !== viewport.clientWidth + 'x' + viewport.clientHeight + 'x' + renderer.getPixelRatio()) resize();
    const p = previewOf(); bloom.enabled = p.bloom > 0; bloom.strength = p.bloom; composer.render();
  }

  // ── ışık + zaman (her karede, tüm modlarda — giydirilmiş materyaller için)
  const t0 = performance.now(); let timeOverride = null;
  function updateShared() {
    const d = unityLightDir(lighting.rotation); shared.upeLightDir.value.set(d[0], d[1], d[2]);
    const c = parseColorLinear(lighting.color); shared.upeLightColor.value.set(c[0], c[1], c[2]).multiplyScalar(lighting.intensity);
    const a = parseColorLinear(lighting.ambient); shared.upeAmbient.value.set(a[0], a[1], a[2]).multiplyScalar(lighting.ambientIntensity);
    const t = timeOverride ?? (performance.now() - t0) / 1000; shared._Time.value.set(t / 20, t, t * 2, t * 3);
    const v = renderer.getDrawingBufferSize(new THREE.Vector2()); shared.upeResolution.value.copy(v);
    if (ctx.sun) ctx.sun.position.set(-d[0] * 5, d[1] * 5, d[2] * 5); // standart materyaller de aynı yönden aydınlansın
  }

  // ── önizleme nesneleri
  const previewRoot = new THREE.Group(); previewRoot.name = 'upe-preview'; previewRoot.visible = false; scene.add(previewRoot);
  const GEOS = {
    sphere: () => new THREE.SphereGeometry(0.5, 96, 48), cube: () => new THREE.BoxGeometry(1, 1, 1), plane: () => new THREE.PlaneGeometry(1.4, 1.4),
    capsule: () => new THREE.CapsuleGeometry(0.4, 0.8, 16, 48), torus: () => new THREE.TorusGeometry(0.42, 0.16, 48, 128),
  };
  let previewMesh = null, previewKind = null, spin = 0;
  function ensurePreviewMesh(kind) {
    if (previewKind === kind && previewMesh) return previewMesh;
    if (previewMesh) { unapply(previewMesh); previewMesh.geometry.dispose(); previewMesh.removeFromParent(); }
    previewMesh = new THREE.Mesh(GEOS[kind](), new THREE.MeshBasicMaterial()); previewMesh.position.y = 1; previewMesh.userData.upePreview = true;
    previewRoot.add(previewMesh); previewKind = kind; return previewMesh;
  }

  // ── mesh'lere UPE materyali uygula / geri al
  const applied = new Map(); // mesh → { inst, outline, key, shader }
  function unapply(mesh) {
    const a = applied.get(mesh); if (!a) return;
    a.outline?.removeFromParent(); a.inst.main.dispose(); a.inst.outline?.dispose();
    if (mesh.userData.upeOrig) mesh.material = mesh.userData.upeOrig;
    applied.delete(mesh);
  }
  function applyMat(mesh, shader, values, key) {
    const a = applied.get(mesh);
    if (!mesh.userData.upeOrig && !a) mesh.userData.upeOrig = mesh.material; // özgün materyal ('@mesh' dokusu buradan)
    const meshMap = (Array.isArray(mesh.userData.upeOrig) ? mesh.userData.upeOrig[0] : mesh.userData.upeOrig)?.map || null;
    const shaderKey = shader.unityName + '|' + JSON.stringify([shader.code, shader.properties, shader.outline, shader.renderState, shader.urpSurface]);
    if (a && a.key === key && a.shaderKey === shaderKey) { updateUPEValues(a.inst, shader, values, meshMap); return; }
    unapply(mesh);
    if (!mesh.userData.upeOrig) mesh.userData.upeOrig = mesh.material;
    const inst = createUPEMaterial(shader, values, { meshMap, vertexColors: !!mesh.geometry?.hasAttribute('color') });
    mesh.material = inst.main;
    let outline = null;
    if (inst.outline) { outline = mesh.clone(false); outline.material = inst.outline; outline.userData = { upeOutline: true }; outline.castShadow = false; mesh.parent.add(outline); outline.renderOrder = mesh.renderOrder; }
    applied.set(mesh, { inst, outline, key, shaderKey, shader });
  }
  // kahraman + eşya mesh'leri (VFX ve önizleme düğümleri hariç) — hedef anahtarlarıyla
  function sceneMeshes() {
    const out = []; const props = ctx.getProps() || [];
    const propOf = new Map(); for (const p of props) p.obj?.traverse((o) => { if (o.isMesh) propOf.set(o, p.id); });
    const walk = (o) => {
      if (o.name === 'vfx-root' || o.name === 'vfx-pivot' || o.userData.upeOutline || o.userData.vfx) return;
      if (o.isMesh && !o.userData.upePreview) out.push({ mesh: o, keys: propOf.has(o) ? ['prop:' + propOf.get(o)] : ['hero', 'hero:' + o.name] });
      for (const c of o.children) walk(c);
    };
    walk(ctx.stage); return out;
  }
  let syncToken = 0;
  async function syncScene() { // her mesh için istenen materyal: (Materyal/Shader modunda önizleme hedefi) > override > yok
    const token = ++syncToken;
    const list = sceneMeshes();
    const tgt = mode ? currentTarget() : null;
    const prev = mode ? currentPreview() : null;
    const wanted = new Map();
    for (const { mesh, keys } of list) {
      if (prev && tgt !== null && keys.includes(tgt)) { wanted.set(mesh, { shader: prev.shader, values: prev.values, key: 'preview' }); continue; }
      const ov = keys.map((k) => overrides[k]).find(Boolean);
      if (ov) {
        const m = await libMaterial(ov); if (token !== syncToken) return;
        const sh = m && resolveShader(m.shader);
        if (sh) wanted.set(mesh, { shader: sh, values: normalizeMaterial(m, sh).material.values, key: 'ov:' + ov });
      }
    }
    for (const mesh of [...applied.keys()]) if (!mesh.userData.upePreview && !wanted.has(mesh)) unapply(mesh);
    for (const [mesh, w] of wanted) applyMat(mesh, w.shader, w.values, w.key);
    for (const { mesh } of list) if (!mesh.parent) unapply(mesh);
  }
  function currentPreview() { // { shader, values } — Materyal modunda materyal, Shader modunda düzenlenen shader + önizleme değerleri
    if (mode === 'shader') {
      const vals = { ...shaderPreviewValues };
      if (!GEOS[currentTarget()]) for (const n of ['_BaseMap', '_MainTex']) if (vals[n] === undefined && editShader.properties.some((p) => p.name === n && p.type === 'texture')) vals[n] = { tex: '@mesh' }; // kahramanda kendi dokusu
      return { shader: editShader, values: normalizeMaterial({ shader: editShader.unityName, values: vals }, editShader).material.values };
    }
    const sh = resolveShader(material.shader); return sh ? { shader: sh, values: material.values } : null;
  }
  const currentTarget = () => previewOf().target;
  function refreshPreview() {
    if (!mode) { previewRoot.visible = false; ctx.setHeroVisible?.(true); return; }
    const tgt = currentTarget(); const primitive = !!GEOS[tgt];
    previewRoot.visible = primitive; ctx.setHeroVisible?.(!primitive); // küre vb. kahramanın yerinde durur
    scene.background = new THREE.Color(previewOf().background); ctx.grid.visible = previewOf().showGrid;
    if (mode === 'shader' && !compileState.ok) return; // derlenemeyen shader uygulanmaz; son çalışan görüntü kalır
    const prev = currentPreview();
    if (primitive && prev) applyMat(ensurePreviewMesh(tgt), prev.shader, prev.values, 'preview');
    syncScene();
  }

  // ── derleme denetimi: test küresini küçük bir hedefe çizip GLSL hatalarını yakala
  const testScene = new THREE.Scene(); const testCam = new THREE.PerspectiveCamera(40, 1, 0.1, 10); testCam.position.set(0, 0, 3);
  const testRT = new THREE.WebGLRenderTarget(32, 32); const compileMemo = new Map();
  function compileCheck(shader) {
    const key = JSON.stringify([shader.code, shader.properties, shader.outline]);
    if (compileMemo.has(key)) return compileMemo.get(key);
    const inst = createUPEMaterial(shader, {}, {});
    const meshes = [new THREE.Mesh(GEOS.sphere(), inst.main)]; if (inst.outline) meshes.push(new THREE.Mesh(meshes[0].geometry, inst.outline));
    testScene.add(...meshes);
    const prevRT = renderer.getRenderTarget();
    const errors = captureErrors(() => { renderer.setRenderTarget(testRT); renderer.render(testScene, testCam); });
    renderer.setRenderTarget(prevRT);
    testScene.remove(...meshes); meshes[0].geometry.dispose(); inst.main.dispose(); inst.outline?.dispose();
    const r = { ok: !errors.length, errors, warnings: inst.warnings };
    compileMemo.set(key, r); return r;
  }

  // ── veri akışı
  const timers = {};
  const debounce = (k, fn, ms = 250) => { clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); };
  const syncMaterial = () => debounce('m', () => api('/api/material', material).catch(() => {}));
  const syncShader = () => debounce('s', () => api('/api/shader', editShader).catch(() => {}));
  const syncLighting = () => debounce('l', () => api('/api/lighting', lighting).catch(() => {}));
  const pushUndoM = () => { undoM.push(JSON.stringify(material)); if (undoM.length > 100) undoM.shift(); redoM.length = 0; };
  const pushUndoS = () => { undoS.push(JSON.stringify({ editShader, shaderPreviewValues })); if (undoS.length > 100) undoS.shift(); redoS.length = 0; };
  const pushUndo = () => (mode === 'shader' ? pushUndoS() : pushUndoM());
  function materialEdited({ structure = false } = {}) {
    material = normalizeMaterial(material, resolveShader(material.shader)).material;
    refreshPreview(); syncMaterial(); if (structure) buildMatUI(); else refreshMatLeft();
  }
  function setMaterial(m, { undo = true } = {}) {
    if (undo) pushUndoM();
    material = normalizeMaterial(m, resolveShader(m?.shader)).material;
    refreshPreview(); buildMatUI(); syncMaterial(); if (mode === 'material') frame();
  }
  function shaderEdited({ structure = false, recompile = true } = {}) {
    editShader = normalizeShader(editShader).shader;
    if (!editShader.builtin) shaders.set(editShader.unityName, editShader);
    if (recompile) compileState = compileCheck(editShader);
    refreshPreview(); syncShader(); showCompile();
    if (structure) buildShaderUI();
  }
  function setShader(s, { undo = true } = {}) {
    if (undo) pushUndoS();
    editShader = normalizeShader(s).shader; shaderPreviewValues = {};
    if (!editShader.builtin) shaders.set(editShader.unityName, editShader);
    compileState = compileCheck(editShader);
    refreshPreview(); buildShaderUI(); syncShader();
  }
  function undo() {
    if (mode === 'shader') { if (!undoS.length) return; redoS.push(JSON.stringify({ editShader, shaderPreviewValues })); const o = JSON.parse(undoS.pop()); setShader(o.editShader, { undo: false }); shaderPreviewValues = o.shaderPreviewValues; refreshPreview(); return; }
    if (!undoM.length) return; redoM.push(JSON.stringify(material)); setMaterial(JSON.parse(undoM.pop()), { undo: false });
  }
  function redo() {
    if (mode === 'shader') { if (!redoS.length) return; undoS.push(JSON.stringify({ editShader, shaderPreviewValues })); const o = JSON.parse(redoS.pop()); setShader(o.editShader, { undo: false }); shaderPreviewValues = o.shaderPreviewValues; refreshPreview(); return; }
    if (!redoM.length) return; undoM.push(JSON.stringify(material)); setMaterial(JSON.parse(redoM.pop()), { undo: false });
  }

  // ── kamera kadrajı
  function frameBox() {
    const tgt = currentTarget(); const box = new THREE.Box3();
    if (GEOS[tgt] && previewMesh) box.setFromObject(previewMesh);
    else if (tgt === 'hero') box.set(new THREE.Vector3(-0.45, 0, -0.45), new THREE.Vector3(0.45, 1.75, 0.45));
    else { const p = ctx.getProps().find((x) => 'prop:' + x.id === tgt); if (p?.obj) box.setFromObject(p.obj); }
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 1, 1));
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.35, box.getSize(new THREE.Vector3()).length() / 2);
    return { center: c, dist: (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.1 };
  }
  function frame() { const f = frameBox(); const dir = camera.position.clone().sub(orbit.target); if (dir.lengthSq() < 1e-6) dir.set(...PRESET_DIR.threequarter); orbit.target.copy(f.center); camera.position.copy(f.center).addScaledVector(dir.normalize(), f.dist); orbit.update(); }

  // ── tick
  function tick(dt) {
    updateShared();
    if (!mode) return;
    if (previewMesh && previewOf().rotate && previewRoot.visible) { spin += dt * 0.35; previewMesh.rotation.y = spin; }
    $('#hud').textContent = mode === 'shader' ? `Shader · ${editShader.unityName}${compileState.ok ? '' : ' · DERLEME HATASI'}` : `Materyal · ${material.name} · ${material.shader}`;
  }

  // ── alan bileşenleri (VFX panelindeki gibi: etiketi sürükle → değer)
  function scrubLabel(label, input, step, apply) {
    label.classList.add('scrub'); label.title = 'Sürükle: değiştir (Shift hızlı, Alt ince)';
    label.addEventListener('pointerdown', (e) => {
      if (e.target === input) return; e.preventDefault(); label.setPointerCapture(e.pointerId); pushUndo();
      let v = +input.value || 0;
      const move = (ev) => { v += ev.movementX * step * (ev.shiftKey ? 10 : 1) * (ev.altKey ? 0.1 : 1); input.value = fmt(v); apply(v); };
      const up = () => { label.removeEventListener('pointermove', move); label.removeEventListener('pointerup', up); };
      label.addEventListener('pointermove', move); label.addEventListener('pointerup', up);
    });
  }
  const numInput = (v, step, onv) => { const i = el('input'); i.type = 'number'; i.step = step; i.value = fmt(v); i.onfocus = () => pushUndo(); i.oninput = () => { const x = parseFloat(i.value); if (Number.isFinite(x)) onv(x); }; return i; };
  let textures = [];
  async function loadTextures() { textures = await fetch('/api/material-textures').then((r) => r.json()).catch(() => []); return textures; }

  // p: shader özelliği · get/set: değer · onChange(structure)
  function propField(p, get, set, onChange) {
    const wrap = el('div', 'vf'); const lab = el('label', 'vl', p.label + ' <small>' + p.name + '</small>'); wrap.appendChild(lab);
    const ch = (v, structure) => { set(v); onChange(structure); };
    switch (p.type) {
      case 'float': case 'range': {
        const row = el('div', 'vrow'); let rg = null;
        const ni = numInput(get(), 0.01, (x) => { if (rg) rg.value = x; ch(x); });
        if (p.type === 'range') { rg = el('input'); rg.type = 'range'; rg.min = p.min; rg.max = p.max; rg.step = (p.max - p.min) / 500 || 0.001; rg.value = get(); rg.onpointerdown = () => pushUndo(); rg.oninput = () => { ni.value = fmt(rg.value); ch(+rg.value); }; row.appendChild(rg); }
        row.appendChild(ni); wrap.appendChild(row);
        scrubLabel(lab, ni, p.type === 'range' ? (p.max - p.min) / 200 || 0.01 : 0.01, (v) => { if (rg) rg.value = v; ch(v); });
        break;
      }
      case 'toggle': { lab.classList.add('chk'); lab.textContent = ''; const c = el('input'); c.type = 'checkbox'; c.checked = !!get(); c.onchange = () => { pushUndo(); ch(c.checked); }; lab.append(c, ' ' + p.label); break; }
      case 'color': {
        if (Array.isArray(get())) { // [r,g,b,a] (1'i aşabilir): sayılarla düzenlenir
          const row = el('div', 'vrow multi');
          ['r', 'g', 'b', 'a'].forEach((n, k) => { const cell = el('label', 'vsub'); const sp = el('span', '', n); const ni = numInput(get()[k], 0.01, (x) => { const a = [...get()]; a[k] = Math.max(0, x); ch(a); }); cell.append(sp, ni); row.appendChild(cell); scrubLabel(sp, ni, 0.01, (x) => { const a = [...get()]; a[k] = Math.max(0, x); ch(a); }); });
          wrap.appendChild(row); break;
        }
        const row = el('div', 'vrow'); const c = el('input'); c.type = 'color'; c.value = get().slice(0, 7); c.onfocus = () => pushUndo();
        c.oninput = () => ch(c.value + (get().length > 7 ? get().slice(7) : '')); row.appendChild(c);
        if (get().length > 7 || p.name === '_BaseColor') { const a = numInput(get().length > 7 ? parseInt(get().slice(7), 16) / 255 : 1, 0.05, (x) => { const v = Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0'); ch(get().slice(0, 7) + v); }); a.title = 'Alfa'; row.appendChild(a); }
        wrap.appendChild(row); break;
      }
      case 'hdrColor': {
        const row = el('div', 'vrow'); const c = el('input'); c.type = 'color'; c.value = get().color; c.onfocus = () => pushUndo();
        c.oninput = () => ch({ ...get(), color: c.value });
        const k = numInput(get().intensity, 0.05, (x) => ch({ ...get(), intensity: Math.max(0, x) })); k.title = 'Yoğunluk (HDR)';
        row.append(c, el('span', 'vl', '×'), k); wrap.appendChild(row); break;
      }
      case 'vector': {
        const row = el('div', 'vrow multi');
        ['x', 'y', 'z', 'w'].forEach((n, k) => { const cell = el('label', 'vsub'); const s = el('span', '', n); const ni = numInput(get()[k], 0.01, (x) => { const a = [...get()]; a[k] = x; ch(a); }); cell.append(s, ni); row.appendChild(cell); scrubLabel(s, ni, 0.01, (x) => { const a = [...get()]; a[k] = x; ch(a); }); });
        wrap.appendChild(row); break;
      }
      case 'texture': {
        const row = el('div', 'vrow'); const img = el('img', 'texthumb'); const s = el('select');
        const opts = [...BUILTIN_TEXTURES, '@mesh', ...textures];
        for (const t of opts) s.add(new Option(t === '@mesh' ? '@mesh (nesnenin kendi dokusu)' : t, t));
        if (!opts.includes(get().tex)) s.add(new Option(get().tex + ' (yok)', get().tex));
        s.value = get().tex;
        const thumb = () => { const t = get().tex; img.src = BUILTIN_TEXTURES.includes(t) || t === '@mesh' ? '' : '/material-textures/' + encodeURIComponent(t) + '.png'; img.style.background = { white: '#fff', black: '#000', gray: '#808080', bump: '#8080ff' }[t] || '#0d1018'; };
        thumb(); s.onchange = () => { pushUndo(); ch({ ...get(), tex: s.value }); thumb(); };
        row.append(img, s); wrap.appendChild(row);
        const st = el('div', 'vrow multi');
        [['tx', 0, 'tiling'], ['ty', 1, 'tiling'], ['ox', 0, 'offset'], ['oy', 1, 'offset']].forEach(([n, k, f]) => { const cell = el('label', 'vsub'); const sp = el('span', '', n); const ni = numInput(get()[f][k], 0.01, (x) => { const o = clone(get()); o[f][k] = x; ch(o); }); cell.append(sp, ni); st.appendChild(cell); scrubLabel(sp, ni, 0.01, (x) => { const o = clone(get()); o[f][k] = x; ch(o); }); });
        wrap.appendChild(st);
        const up = el('label', 'btn small', 'PNG yükle…'); const fi = el('input'); fi.type = 'file'; fi.accept = '.png'; fi.hidden = true; up.appendChild(fi);
        fi.onchange = async () => { const f = fi.files[0]; if (!f) return; await fetch('/api/upload-material-texture?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }); clearMaterialTextureCache(); await loadTextures(); pushUndo(); ch({ ...get(), tex: f.name.replace(/\.png$/i, '') }, true); };
        wrap.appendChild(up);
        if (get().unityPath) wrap.appendChild(el('div', 'hint-s', 'Unity: ' + get().unityPath));
        break;
      }
    }
    return wrap;
  }
  function section(title, key, open) {
    const d = el('details'); d.open = open ?? openSecs.has(key); d.appendChild(el('summary', '', title));
    if (key) d.ontoggle = () => { if (document.querySelector('#panelFilter')?.value) return; if (d.open) openSecs.add(key); else openSecs.delete(key); saveOpen(); };
    return d;
  }
  function shaderSelect(value, onChange) {
    const s = el('select'); const groups = { 'Hazır (oyun / URP)': [], 'Özel (UnityPreview)': [] };
    for (const sh of shaders.values()) groups[sh.builtin ? 'Hazır (oyun / URP)' : 'Özel (UnityPreview)'].push(sh);
    for (const [g, list] of Object.entries(groups)) { if (!list.length) continue; const og = el('optgroup'); og.label = g; for (const sh of list) og.appendChild(new Option(sh.unityName, sh.unityName)); s.appendChild(og); }
    if (!shaders.has(value)) s.add(new Option(value + ' (bulunamadı)', value));
    s.value = value; s.onchange = () => onChange(s.value); return s;
  }
  function lightingSection(onChange) {
    const sl = section('Işık (tüm UPE shader\'ları)', '_light');
    const L = lighting;
    const fld = (label, get, set, o) => propField({ name: '', label, type: o.type, min: o.min, max: o.max }, get, set, () => { lighting = normalizeLighting(lighting); syncLighting(); onChange?.(); });
    sl.append(
      fld('Yükseklik (°)', () => L.rotation[0], (v) => { L.rotation[0] = v; }, { type: 'range', min: -90, max: 90 }),
      fld('Yön (°)', () => L.rotation[1], (v) => { L.rotation[1] = v; }, { type: 'range', min: -180, max: 180 }),
      fld('Işık rengi', () => L.color, (v) => { L.color = v; }, { type: 'color' }),
      fld('Şiddet', () => L.intensity, (v) => { L.intensity = v; }, { type: 'range', min: 0, max: 4 }),
      fld('Ortam rengi', () => L.ambient, (v) => { L.ambient = v; }, { type: 'color' }),
      fld('Ortam şiddeti', () => L.ambientIntensity, (v) => { L.ambientIntensity = v; }, { type: 'range', min: 0, max: 4 }),
    );
    return sl;
  }
  function previewSection(onChange) {
    const sp = section('Önizleme', '_prev'); const P = previewOf();
    const row = el('div', 'seg targets');
    const targets = [...Object.keys(TARGET_LABELS), ...ctx.getProps().map((p) => 'prop:' + p.id)];
    for (const t of targets) { const b = el('button', P.target === t ? 'on' : '', TARGET_LABELS[t] || t.slice(5)); b.onclick = () => { pushUndo(); P.target = t; onChange(true); frame(); }; row.appendChild(b); }
    sp.appendChild(row);
    const fld = (label, type, get, set, o = {}) => propField({ name: '', label, type, ...o }, get, set, () => onChange(false));
    sp.append(fld('Bloom', 'range', () => P.bloom, (v) => { P.bloom = v; }, { min: 0, max: 3 }), fld('Döner tabla', 'toggle', () => P.rotate, (v) => { P.rotate = v; }), fld('Zemin ızgarası', 'toggle', () => P.showGrid, (v) => { P.showGrid = v; ctx.grid.visible = v; }), fld('Arka plan', 'color', () => P.background, (v) => { P.background = v; scene.background = new THREE.Color(v); }));
    return sp;
  }

  // ── Materyal modu arayüzü
  function refreshMatLeft() {
    if (document.activeElement !== $('#matName')) $('#matName').value = material.name;
  }
  async function fillMatLib(box) {
    const list = await fetch('/api/materials/list').then((r) => r.json()).catch(() => []);
    box.innerHTML = list.length ? '' : '<div class="hint-s">Henüz kayıtlı materyal yok.</div>';
    for (const it of list) {
      const r = el('div', 'li' + (it.name === material.name ? ' sel' : ''), '<span class="n"></span><small></small><button title="Sil">✕</button>');
      r.querySelector('.n').textContent = it.name; r.querySelector('small').textContent = (it.shader || '').split('/').pop(); r.title = it.shader || '';
      r.onclick = async () => { const m = await fetch('/api/materials/get?name=' + encodeURIComponent(it.name)).then((x) => x.json()); if (m.error) return toast(m.error); setMaterial(m); toast('Yüklendi: ' + it.name); };
      r.querySelector('button').onclick = async (ev) => { ev.stopPropagation(); if (!confirm(it.name + ' silinsin mi?')) return; await fetch('/api/materials/delete?name=' + encodeURIComponent(it.name), { method: 'POST' }); matCache.delete(it.name); fillMatLib(box); };
      box.appendChild(r);
    }
  }
  function buildMatUI() {
    refreshMatLeft(); fillMatLib($('#matLib'));
    const box = $('#matRight'); const scroll = $('#right').scrollTop; box.innerHTML = '';
    const sh = resolveShader(material.shader);
    const sm = section('Materyal', '_mat');
    const sw = el('div', 'vf'); sw.appendChild(el('label', 'vl', 'Shader')); sw.appendChild(shaderSelect(material.shader, (v) => { pushUndoM(); material.shader = v; material.values = {}; materialEdited({ structure: true }); })); sm.appendChild(sw);
    if (sh?.description) sm.appendChild(el('div', 'hint-s', sh.description));
    sm.appendChild(propField({ name: '', label: 'Render kuyruğu (-1 shader\'ınki)', type: 'float' }, () => material.renderQueue, (v) => { material.renderQueue = Math.round(v); }, () => materialEdited()));
    box.appendChild(sm);
    const spp = section('Özellikler', '_props');
    if (!sh) spp.appendChild(el('div', 'hint-s', 'Shader bulunamadı: ' + material.shader));
    else for (const p of sh.properties) spp.appendChild(propField(p, () => material.values[p.name], (v) => { material.values[p.name] = v; }, (structure) => materialEdited({ structure })));
    box.appendChild(spp);
    // giydirme
    const sg = section('Giydir (önizleme, tüm modlarda)', '_wear');
    const targets = ['hero', ...ctx.getProps().map((p) => 'prop:' + p.id)];
    for (const t of targets) {
      const r = el('div', 'li'); const cur = overrides[t];
      r.innerHTML = '<span class="n"></span><small></small><button class="primary">Giydir</button><button title="Kaldır">✕</button>';
      r.querySelector('.n').textContent = t === 'hero' ? 'Kahraman' : t.slice(5); r.querySelector('small').textContent = cur || '—';
      const [bOn, bOff] = r.querySelectorAll('button');
      bOn.onclick = async () => { await saveMatLib(material.name, { quiet: true }); setOverride(t, material.name); };
      bOff.onclick = () => setOverride(t, null);
      sg.appendChild(r);
    }
    sg.appendChild(el('div', 'hint-s', 'Giydirmek materyali kütüphaneye kaydeder; Unity\'deki prefab\'a bağlamak ayrı iştir.'));
    box.appendChild(sg);
    box.appendChild(lightingSection());
    box.appendChild(previewSection((structure) => { materialEdited({ structure }); }));
    box.appendChild(librarySection('Materyal kütüphanesi', '_lib', material.name, (n) => saveMatLib(n)));
    $('#right').scrollTop = scroll;
  }
  function librarySection(title, key, name, onSave) {
    const sl = section(title, key);
    sl.innerHTML += '<div class="row"><input class="libname" placeholder="isim" style="flex:1;min-width:0"><button class="primary libsave">Kaydet</button></div>';
    sl.querySelector('.libname').value = name; sl.querySelector('.libsave').onclick = () => onSave(sl.querySelector('.libname').value || name);
    return sl;
  }
  async function saveMatLib(name, { quiet = false } = {}) {
    name = String(name).trim().replace(/[^A-Za-z0-9_-]+/g, '_'); if (!name) return;
    material.name = name;
    await fetch('/api/materials/save?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(material) });
    matCache.delete(name); syncMaterial(); if (!quiet) { toast('Kaydedildi: ' + name); buildMatUI(); }
    syncScene();
  }
  function setOverride(target, name) {
    if (name) overrides[target] = name; else delete overrides[target];
    api('/api/overrides', { overrides }).catch(() => {}); syncScene(); if (mode === 'material') buildMatUI();
    toast(name ? `${target} → ${name}` : `${target} özgün materyale döndü`);
  }
  async function sendUnity(kind) {
    if (kind === 'material') { await saveMatLib(material.name, { quiet: true }); const r = await api('/api/unity/send-material', { name: material.name }); return r.error ? 'Hata: ' + r.error : r.ok ? 'Unity\'ye aktarıldı: ' + (r.materials || []).join(', ') : (r.note || 'Gönderildi') + (r.shaderErrors && Object.keys(r.shaderErrors).length ? ' · shader hatası: ' + JSON.stringify(r.shaderErrors) : ''); }
    if (editShader.builtin) return 'Hazır shader Unity\'de zaten var; özel kopya oluşturup gönder.';
    await saveShaderLib(editShader.name, { quiet: true });
    const r = await api('/api/unity/send-shader', { name: editShader.name });
    return r.error ? 'Hata: ' + r.error : r.ok ? 'Unity derledi: ' + (r.shaders || []).join(', ') : (r.note || 'Gönderildi') + (r.shaderErrors ? ' · ' + JSON.stringify(r.shaderErrors) : '');
  }
  $('#matName').oninput = (e) => { material.name = e.target.value; syncMaterial(); };
  $('#matName').onchange = () => { pushUndoM(); materialEdited(); };
  {
    const list = $('#matAddList');
    const build = () => {
      list.innerHTML = '';
      for (const sh of shaders.values()) { const b = el('button', 'item', (sh.builtin ? '● ' : '◆ ') + sh.unityName); b.onclick = () => { $('#matAddMenu').open = false; setMaterial({ ...defaultMaterial(), name: 'yeni_' + sh.name, shader: sh.unityName, preview: clone(material.preview) }); }; list.appendChild(b); }
    };
    $('#matAddMenu').addEventListener('toggle', () => { if ($('#matAddMenu').open) build(); });
  }

  // ── Shader modu arayüzü
  async function fillShaderList() {
    const box = $('#shList'); box.innerHTML = '';
    for (const sh of shaders.values()) {
      const r = el('div', 'li' + (sh.unityName === editShader.unityName ? ' sel' : ''), '<span class="n"></span><small></small>' + (sh.builtin ? '' : '<button title="Sil">✕</button>'));
      r.querySelector('.n').textContent = sh.unityName; r.querySelector('small').textContent = sh.builtin ? 'hazır' : 'özel'; r.title = sh.description || '';
      r.onclick = () => { setShader(sh); frame(); };
      r.querySelector('button')?.addEventListener('click', async (ev) => { ev.stopPropagation(); if (!confirm(sh.name + ' silinsin mi?')) return; await fetch('/api/shaders/delete?name=' + encodeURIComponent(sh.name), { method: 'POST' }); shaders.delete(sh.unityName); fillShaderList(); });
      box.appendChild(r);
    }
  }
  const CODE_TABS = [['fragment', 'Fragment'], ['vertex', 'Vertex'], ['common', 'Ortak'], ['outlineFragment', 'Outline']];
  let codeTab = 'fragment';
  function buildCodePanel() {
    const tabs = $('#shTabs'); tabs.innerHTML = '';
    for (const [k, label] of CODE_TABS) { const b = el('button', k === codeTab ? 'on' : '', label + (editShader.code[k].trim() ? '' : ' ·')); b.onclick = () => { codeTab = k; buildCodePanel(); }; tabs.appendChild(b); }
    const ta = $('#shCodeText'); ta.value = editShader.code[codeTab]; ta.readOnly = editShader.builtin;
    ta.placeholder = { vertex: 'void vert(inout UPEVertex v) { v.positionOS += v.normalOS * 0.0; }', common: '// yardımcı fonksiyonlar', outlineFragment: 'float4 outlineFrag(UPEInput i) { return _OutlineColor; }', fragment: 'float4 frag(UPEInput i) { ... }' }[codeTab];
    showCompile();
  }
  $('#shCodeText').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; t.setRangeText('    ', s, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input')); }
    e.stopPropagation();
  });
  $('#shCodeText').addEventListener('focus', () => pushUndoS());
  $('#shCodeText').addEventListener('input', (e) => { if (editShader.builtin) return; editShader.code[codeTab] = e.target.value; syncShader(); debounce('compile', () => shaderEdited(), 450); });
  function showCompile() {
    const box = $('#shLog'); box.innerHTML = '';
    const c = compileState;
    const head = el('div', c.ok ? 'ok' : 'err', c.ok ? '✓ Derlendi (GLSL önizleme)' : `✗ ${c.errors.length} hata`); box.appendChild(head);
    for (const e of c.errors) {
      const r = el('div', 'err', `${e.section}${e.line ? ':' + e.line : ''} — ${e.message.replace(/</g, '&lt;')}`);
      if (CODE_TABS.some(([k]) => k === e.section)) { r.classList.add('link'); r.onclick = () => { codeTab = e.section; buildCodePanel(); const ta = $('#shCodeText'); const lines = ta.value.split('\n'); const st = lines.slice(0, Math.max(0, e.line - 1)).join('\n').length + (e.line > 1 ? 1 : 0); ta.focus(); ta.setSelectionRange(st, st + (lines[e.line - 1] || '').length); }; }
      box.appendChild(r);
    }
    for (const w of c.warnings || []) box.appendChild(el('div', 'warn', '⚠ ' + w));
  }
  function buildShaderUI() {
    fillShaderList(); buildCodePanel();
    if (document.activeElement !== $('#shName')) $('#shName').value = editShader.name;
    $('#shName').disabled = editShader.builtin;
    const box = $('#shRight'); const scroll = $('#right').scrollTop; box.innerHTML = '';
    const S = editShader; const ro = S.builtin;
    const si = section('Shader', '_sh');
    si.appendChild(el('div', 'hint-s', `<b>${S.unityName}</b>${ro ? ' · hazır port (salt okunur)' : ''}`));
    if (S.description) si.appendChild(el('div', 'hint-s', S.description));
    if (ro) { const b = el('button', 'primary', 'Özel kopya oluştur'); b.onclick = () => { const c = clone(S); c.builtin = false; c.name = S.name + '_kopya'; c.description = 'Kopya: ' + S.unityName; setShader(c); }; si.appendChild(b); }
    box.appendChild(si);
    // önizleme değerleri
    const pv = section('Önizleme değerleri', '_pv');
    const vals = normalizeMaterial({ shader: S.unityName, values: shaderPreviewValues }, S).material.values;
    for (const p of S.properties) pv.appendChild(propField(p, () => vals[p.name], (v) => { vals[p.name] = v; shaderPreviewValues = vals; }, () => refreshPreview()));
    box.appendChild(pv);
    if (!ro) {
      // özellik tanımları
      const sp = section('Özellik tanımları', '_pdef');
      S.properties.forEach((p, idx) => {
        const r = el('div', 'propdef');
        const name = el('input'); name.value = p.name; name.title = 'Ad'; name.onchange = () => { pushUndoS(); p.name = name.value.trim(); shaderEdited({ structure: true }); };
        const ty = el('select'); for (const t of PROPERTY_TYPES) ty.add(new Option(t, t)); ty.value = p.type; ty.onchange = () => { pushUndoS(); S.properties[idx] = { name: p.name, type: ty.value, label: p.label }; shaderEdited({ structure: true }); };
        const lab = el('input'); lab.value = p.label; lab.title = 'Etiket'; lab.onchange = () => { pushUndoS(); p.label = lab.value; shaderEdited({ structure: true, recompile: false }); };
        const del = el('button', '', '✕'); del.onclick = () => { pushUndoS(); S.properties.splice(idx, 1); shaderEdited({ structure: true }); };
        r.append(name, ty, lab, del);
        if (p.type === 'range') { const mn = numInput(p.min, 0.01, (x) => { p.min = x; shaderEdited({ recompile: false }); }), mx = numInput(p.max, 0.01, (x) => { p.max = x; shaderEdited({ recompile: false }); }); mn.title = 'min'; mx.title = 'maks'; r.append(mn, mx); }
        if (p.type === 'texture') { const l = el('label', 'chk'); const c = el('input'); c.type = 'checkbox'; c.checked = p.linear; c.onchange = () => { p.linear = c.checked; shaderEdited(); }; l.append(c, ' linear'); r.appendChild(l); }
        sp.appendChild(r);
        if (p.type === 'texture') { // varsayılan doku = ad (white/black/gray/bump ya da kütüphane dokusu)
          const w = el('div', 'vf'); w.appendChild(el('label', 'vl', 'varsayılan')); const ds = el('select');
          for (const t of [...BUILTIN_TEXTURES, ...textures]) ds.add(new Option(t, t)); if (![...BUILTIN_TEXTURES, ...textures].includes(p.default)) ds.add(new Option(p.default, p.default));
          ds.value = p.default; ds.onchange = () => { pushUndoS(); p.default = ds.value; shaderEdited({ recompile: false }); }; w.appendChild(ds); sp.appendChild(w);
        } else sp.appendChild(propField({ ...p, label: 'varsayılan' }, () => p.default, (v) => { p.default = v; }, () => shaderEdited({ recompile: false })));
      });
      const add = el('button', 'small', '+ özellik'); add.onclick = () => { pushUndoS(); let n = '_Yeni'; let k = 1; while (S.properties.some((p) => p.name === n)) n = '_Yeni' + ++k; S.properties.push({ name: n, type: 'float', label: n.slice(1), default: 0 }); shaderEdited({ structure: true }); };
      sp.appendChild(add); box.appendChild(sp);
      // render durumu
      const rs = section('Render durumu', '_rs'); const R = S.renderState;
      const en = (label, key, opts) => propEnum(label, () => R[key], (v) => { R[key] = v; }, opts);
      rs.append(en('Karışım', 'blend', ['opaque', 'alpha', 'additive', 'premultiply', 'multiply']), en('Cull', 'cull', ['back', 'front', 'off']), en('ZTest', 'ztest', ['lequal', 'less', 'equal', 'gequal', 'greater', 'notequal', 'always']), en('Kuyruk', 'queue', ['geometry', 'alphatest', 'transparent']));
      rs.appendChild(propField({ name: '', label: 'ZWrite', type: 'toggle' }, () => R.zwrite, (v) => { R.zwrite = v; }, () => shaderEdited({ recompile: false })));
      rs.appendChild(propField({ name: '', label: 'Kuyruk ofseti', type: 'float' }, () => R.queueOffset, (v) => { R.queueOffset = Math.round(v); }, () => shaderEdited({ recompile: false })));
      rs.appendChild(propField({ name: '', label: 'Gölge alır', type: 'toggle' }, () => S.lighting.receiveShadows, (v) => { S.lighting.receiveShadows = v; }, () => shaderEdited({ recompile: false })));
      rs.appendChild(propField({ name: '', label: 'Gölge düşürür', type: 'toggle' }, () => S.lighting.castShadows, (v) => { S.lighting.castShadows = v; }, () => shaderEdited({ recompile: false })));
      rs.appendChild(propField({ name: '', label: 'Outline (inverted hull)', type: 'toggle' }, () => S.outline.enabled, (v) => { S.outline.enabled = v; }, () => shaderEdited({ structure: true })));
      if (S.outline.enabled) { const names = S.properties.map((p) => [p.name, p.name]); rs.append(propEnum('Outline genişliği', () => S.outline.width, (v) => { S.outline.width = v; }, names), propEnum('Outline rengi', () => S.outline.color, (v) => { S.outline.color = v; }, names)); }
      box.appendChild(rs);
    }
    box.appendChild(lightingSection());
    box.appendChild(previewSection(() => refreshPreview()));
    if (!ro) box.appendChild(librarySection('Shader kütüphanesi', '_shlib', S.name, (n) => saveShaderLib(n)));
    $('#right').scrollTop = scroll;
  }
  function propEnum(label, get, set, opts) {
    const w = el('div', 'vf'); w.appendChild(el('label', 'vl', label)); const s = el('select');
    for (const o of opts) { const [v, t] = Array.isArray(o) ? o : [o, o]; s.add(new Option(t, v)); } s.value = get();
    s.onchange = () => { pushUndoS(); set(s.value); shaderEdited({ structure: true }); }; w.appendChild(s); return w;
  }
  async function saveShaderLib(name, { quiet = false } = {}) {
    if (editShader.builtin) return toast('Hazır shader kaydedilemez; özel kopya oluştur');
    name = String(name).trim().replace(/[^A-Za-z0-9_-]+/g, '_'); if (!name) return;
    if (name !== editShader.name) { shaders.delete(editShader.unityName); editShader.name = name; editShader = normalizeShader(editShader).shader; }
    const r = await fetch('/api/shaders/save?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(editShader) }).then((x) => x.json());
    if (r.error) return toast(r.error);
    shaders.set(editShader.unityName, editShader); syncShader(); if (!quiet) { toast('Kaydedildi: ' + editShader.unityName); buildShaderUI(); }
  }
  $('#shName').onchange = () => { if (editShader.builtin) return; pushUndoS(); shaders.delete(editShader.unityName); editShader.name = $('#shName').value; shaderEdited({ structure: true }); };
  {
    const list = $('#shAddList');
    for (const [k, t] of Object.entries(TEMPLATES)) { const b = el('button', 'item', t.label); b.onclick = () => { $('#shAddMenu').open = false; let n = 'yeni_' + k, i = 1; while (shaders.has(CUSTOM_PREFIX + n)) n = `yeni_${k}_${++i}`; setShader({ ...clone(t.shader), name: n }); frame(); }; list.appendChild(b); }
  }

  // ── kontak sayfası (MCP render_material)
  async function renderSheet(d) {
    const want = mode || 'material'; const was = mode; if (!was) ctx.setMode(want, { notify: false });
    const views = d.camera?.position ? ['kamera'] : (Array.isArray(d.views) && d.views.length ? d.views : ['threequarter', 'front', 'side']).slice(0, 8);
    const size = Math.max(128, Math.min(1024, d.size || 320));
    const keep = { pos: camera.position.clone(), target: orbit.target.clone(), aspect: camera.aspect, tgt: previewOf().target, bg: previewOf().background, spin };
    if (d.target) { previewOf().target = d.target; refreshPreview(); }
    if (d.bg) { previewOf().background = d.bg; scene.background = new THREE.Color(d.bg); }
    if (typeof d.time === 'number') timeOverride = d.time;
    await syncScene(); await Promise.race([materialTexturesLoaded(), new Promise((r) => setTimeout(r, 5000))]);
    if (previewMesh) previewMesh.rotation.y = 0;
    const f = frameBox(); const cols = Math.min(views.length, 4), rows = Math.ceil(views.length / cols);
    const sheet = el('canvas'); sheet.width = cols * size; sheet.height = rows * size; const sx = sheet.getContext('2d');
    fixedSize = true; renderer.setPixelRatio(1); renderer.setSize(size, size, false); composer.setPixelRatio(1); composer.setSize(size, size); camera.aspect = 1; camera.updateProjectionMatrix();
    try {
      const U = (a) => new THREE.Vector3(-a[0], a[1], a[2]); // Unity ekseni → three
      views.forEach((v, i) => {
        if (d.camera?.position) { const tg = d.camera.target ? U(d.camera.target) : f.center; camera.position.copy(U(d.camera.position)); camera.lookAt(tg); }
        else { const dir = new THREE.Vector3(...(PRESET_DIR[v] || PRESET_DIR.threequarter)); dir.x = -dir.x; camera.position.copy(f.center).addScaledVector(dir.normalize(), f.dist); camera.lookAt(f.center); }
        updateShared(); render();
        const x = (i % cols) * size, y = Math.floor(i / cols) * size; sx.drawImage(renderer.domElement, x, y, size, size);
        sx.font = `${Math.round(size / 20)}px system-ui`; sx.fillStyle = '#ffffffcc'; sx.shadowColor = '#000'; sx.shadowBlur = 4; sx.fillText(v, x + 8, y + size / 14); sx.shadowBlur = 0;
        sx.strokeStyle = '#ffffff30'; sx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      });
    } finally {
      timeOverride = null; previewOf().target = keep.tgt; previewOf().background = keep.bg; scene.background = new THREE.Color(keep.bg); spin = keep.spin;
      camera.position.copy(keep.pos); orbit.target.copy(keep.target); camera.aspect = keep.aspect; orbit.update();
      fixedSize = false; renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); ctx.onResize(); resize(); refreshPreview();
      if (!was) ctx.setMode('anim', { notify: false });
    }
    return sheet.toDataURL('image/png');
  }

  // ── mod geçişi (Materyal ve Shader ayrı modlar, aynı önizleme)
  function activate(m) {
    mode = m; resize(); ctx.overlay.visible = false;
    const P = previewOf(); scene.background = new THREE.Color(P.background); ctx.grid.visible = P.showGrid;
    loadTextures().then(() => (m === 'material' ? buildMatUI() : buildShaderUI()));
    if (m === 'shader') compileState = compileCheck(editShader);
    refreshPreview(); if (m === 'material') buildMatUI(); else buildShaderUI();
  }
  function deactivate() { mode = null; previewRoot.visible = false; ctx.setHeroVisible?.(true); ctx.overlay.visible = true; ctx.grid.visible = true; scene.background = new THREE.Color(ctx.BG); syncScene(); }
  const modeObj = (m) => ({ // tick app.js'te her karede mats.tick ile
    activate: () => activate(m), deactivate, get active() { return mode === m; }, tick: () => {}, render, undo, redo, frame,
    noteContext: () => (m === 'shader' ? { label: `Shader · ${editShader.unityName}${compileState.ok ? '' : ' · derleme hatası var'}`, data: { mode: 'shader', target: editShader.unityName } }
      : { label: `Materyal · ${material.name} · ${material.shader} · önizleme: ${material.preview.target}`, data: { mode: 'material', target: material.name } }),
    baseline: () => (m === 'shader' ? api('/api/shader', editShader).then(() => api('/api/shader/baseline', {})) : api('/api/material', material).then(() => api('/api/material/baseline', {}))),
    get itemName() { return m === 'shader' ? `Shader <b>${editShader.unityName}</b>${editShader.builtin ? ' · hazır (salt okunur)' : ''}${compileState.ok ? '' : ' · <span style="color:var(--err)">derleme hatası</span>'}` : `Materyal <b>${material.name}</b> · ${material.shader}`; },
  });

  // ── Claude olayları
  function onRemoteMaterial(m) { setMaterial(m); toast('Claude materyali güncelledi (Ctrl+Z ile geri al)'); }
  function onRemoteShader(s) { setShader(s); toast('Claude shader\'ı güncelledi (Ctrl+Z ile geri al)'); }
  function onCompileRequest(d) { const sh = normalizeShader(d.shader).shader; const r = compileCheck(sh); return { ok: r.ok, errors: r.errors, warnings: r.warnings }; }
  function onLighting(l) { lighting = normalizeLighting(l); if (mode) (mode === 'material' ? buildMatUI() : buildShaderUI()); }
  function onOverrides(o) { overrides = { ...(o || {}) }; for (const k of Object.keys(overrides)) matCache.delete(overrides[k]); syncScene(); if (mode === 'material') buildMatUI(); }
  async function setFromState(st) {
    await loadCustomShaders();
    lighting = normalizeLighting(st.lighting); overrides = { ...(st.materialOverrides || {}) };
    if (st.shader) { editShader = normalizeShader(st.shader).shader; if (!editShader.builtin) shaders.set(editShader.unityName, editShader); }
    if (st.material) material = normalizeMaterial(st.material, resolveShader(st.material.shader)).material;
    else material = def();
    syncScene();
  }

  return {
    material: modeObj('material'), shader: modeObj('shader'), sendUnity: (m) => sendUnity(m === 'shader' ? 'shader' : 'material'),
    tick: (dt) => tick(dt),
    onSceneChanged: () => { // model/eşya yeniden kurulunca: sahneden düşen mesh'lerin kaydını at, sonra yeniden giydir
      const inScene = (o) => { while (o) { if (o === scene) return true; o = o.parent; } return false; };
      for (const [m, a] of [...applied]) if (!m.userData.upePreview && !inScene(m)) { a.outline?.removeFromParent(); a.inst.main.dispose(); a.inst.outline?.dispose(); applied.delete(m); }
      syncScene();
    },
    onRemoteMaterial, onRemoteShader, onCompileRequest, onLighting, onOverrides, setFromState, renderSheet, libMaterialResolved,
    forgetLibMaterials: () => matCache.clear(), // VFX moduna geçerken: kütüphanedeki son kayıtlar okunsun
    reloadShaders: async () => { await loadCustomShaders(); },
  };
}
