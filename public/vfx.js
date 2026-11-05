// VFX modu: efekt düzenleme arayüzü, oynatma, bloom'lu render, Claude köprüsü (kontak sayfası render'ı, uzaktan güncelleme).
// Veri şeması: vfx-schema.js · simülasyon: vfx-sim.js. app.js bunu initVfx(ctx) ile kurar ve moda göre etkinleştirir.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { EffectPlayer, clearTextureCache, texturesLoaded } from './vfx-sim.js';
import { materialTexturesLoaded } from './shader-compile.js';
import { MODULES, TEXTURES, defaultEffect, defaultEmitter, normalizeEffect, presetEmitter, evalGradient, evalCurve, clone } from './vfx-schema.js';

const PRESET_LABELS = { sparks: 'Kıvılcım', embers: 'Kor', fire: 'Alev', smoke: 'Duman', flash: 'Parlama', shockwave: 'Şok dalgası', glow: 'Hale', slash: 'Kılıç kesiği' };
// kaydırıcı aralıkları (yazarak sınırların dışına çıkılabilir)
const SLIDER = {
  'main.duration': [0.1, 10], 'main.startDelay': [0, 3], 'main.gravity': [-3, 3], 'main.maxParticles': [1, 2000],
  'emission.rateOverTime': [0, 300], 'shape.radius': [0, 3], 'shape.radiusThickness': [0, 1], 'shape.angle': [0, 90], 'shape.arc': [0, 360],
  'shape.donutRadius': [0, 1], 'shape.randomDirection': [0, 1], 'velocity.radial': [-10, 10], 'velocity.speedModifier': [0, 3],
  'limitVelocity.drag': [0, 10], 'limitVelocity.limit': [0, 30], 'limitVelocity.dampen': [0, 1],
  'noise.strength': [0, 5], 'noise.frequency': [0.01, 4], 'noise.scrollSpeed': [0, 4], 'noise.octaves': [1, 4],
  'textureSheet.tilesX': [1, 8], 'textureSheet.tilesY': [1, 8], 'textureSheet.cycles': [1, 8],
  'renderer.intensity': [0, 8], 'renderer.lengthScale': [0, 6], 'renderer.velocityScale': [0, 0.5], 'renderer.sortingOrder': [-10, 10],
  'effect.duration': [0.1, 10], 'effect.bloom': [0, 3],
};
const fmt = (v) => String(+(+v).toFixed(3));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export function initVfx(ctx) {
  const { scene, camera, renderer, orbit, viewport, api, toast, $ } = ctx;
  const player = new EffectPlayer(scene); player.setVisible(false);
  let effect = normalizeEffect(defaultEffect()).effect;
  let sel = 0, active = false, playing = true, speed = 1, dispTime = 0;
  const undoStack = [], redoStack = [];
  const openMods = new Set((() => { try { return JSON.parse(localStorage.getItem('upe-vfx-open')) || null; } catch { return null; } })() || ['_effect', 'main', 'emission', 'renderer']);
  const saveOpen = () => { try { localStorage.setItem('upe-vfx-open', JSON.stringify([...openMods])); } catch { /* yok */ } };

  // ── bloom'lu çizim
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.45, 1.0); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  let csz = '', fixedSize = false; // kontak sayfası çizilirken boyut denetimi kapalı
  const resize = () => { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(viewport.clientWidth, viewport.clientHeight); csz = viewport.clientWidth + 'x' + viewport.clientHeight + 'x' + renderer.getPixelRatio(); };
  function render() { // boyut her karede denetlenir (açılışta düzen oturmadan etkinleşince sıfır boyut kalmasın)
    if (!fixedSize && csz !== viewport.clientWidth + 'x' + viewport.clientHeight + 'x' + renderer.getPixelRatio()) resize();
    bloom.enabled = effect.preview.bloom > 0; bloom.strength = effect.preview.bloom; composer.render();
  }

  // ── bağlama (kemik / eşya), kahraman görünürlüğü, animasyonla eşleme
  const pivots = new Map();
  const findBone = (rig, n) => rig && (rig.byName.get(n) || rig.bones.find((b) => b.name.replace(/^mixamorig:?/, '') === n.replace(/^mixamorig:?/, '')) || rig.bones.find((b) => n && b.name.endsWith(n)));
  function pivotFor(obj, restQ) { // kemiğin/eşyanın altında ölçeği iptal eden çerçeve (eşya takma kuralıyla aynı)
    let p = pivots.get(obj.uuid);
    if (!p || p.parent !== obj) { p = new THREE.Object3D(); p.name = 'vfx-pivot'; obj.add(p); pivots.set(obj.uuid, p); }
    obj.updateWorldMatrix(true, false);
    const parentWs = obj.getWorldScale(new THREE.Vector3()).x || 1;
    if (restQ) p.quaternion.copy(restQ).invert(); else p.quaternion.identity();
    p.scale.setScalar(1 / parentWs); return p;
  }
  function attachParent() {
    const a = effect.attach;
    if (a.target === 'bone') { const b = findBone(ctx.getRig(), a.name); if (b) return pivotFor(b.obj, b.restWQ); }
    if (a.target === 'prop') { const p = ctx.getProps().find((x) => x.id === a.name || x.prop === a.name); if (p?.obj) return pivotFor(p.obj, null); }
    return scene;
  }
  function applyHeroVisibility(show) {
    const walk = (o) => { if (o === player.root || o.name === 'vfx-pivot') return; if (o.isMesh || o.isSkinnedMesh) o.visible = show; for (const c of o.children) walk(c); };
    walk(ctx.stage);
  }
  player.onBeforeStep = (t) => {
    if (!effect.preview.withAnimation) return;
    const anim = ctx.getAnim(); if (!ctx.getRig() || !anim) return;
    let f = effect.preview.startFrame + t * anim.fps; const end = anim.length - 1;
    f = anim.loop ? f % end : Math.min(f, end); ctx.poseAt(f);
  };
  player.onTexture = () => {};

  // ── emitter materyalleri (renderer.material): kütüphaneden shader'ıyla çözülür; yüklenince efekt yeniden kurulur
  const matRes = new Map(); // ad → { shader, values } | null (kütüphanede yok / shader bulunamadı)
  const matLoading = new Map(); // ad → söz (çözülüp efekt yeniden kurulunca biter)
  let matList = []; // [{ name, shader }] — seçici için
  async function loadMatList() { matList = await fetch('/api/materials/list').then((r) => r.json()).catch(() => matList); return matList; }
  function loadMat(name) {
    if (matRes.has(name) || matLoading.has(name)) return;
    matLoading.set(name, Promise.resolve(ctx.libMaterial?.(name)).catch(() => null).then((r) => {
      matRes.set(name, r || null); matLoading.delete(name);
      for (const s of document.querySelectorAll('.vmatstat')) if (s.dataset.mat === name) s.textContent = matStatus(name);
      if (active) rebuildPlayer(true);
    }));
  }
  player.materialFor = (name) => { if (matRes.has(name)) return matRes.get(name); loadMat(name); return null; };
  const matStatus = (name) => (!matRes.has(name) ? 'Yükleniyor…' : matRes.get(name) ? `Shader: ${matRes.get(name).shader.unityName} · doku, karışım ve parlaklık materyalden gelir` : 'Kütüphanede yok ya da shader\'ı bulunamadı — önizleme yerleşik görünümle çizer, Unity\'ye gönderilemez');

  // ── veri akışı
  let syncTimer = null;
  const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => api('/api/vfx', effect).catch(() => {}), 250); };
  const pushUndo = () => { undoStack.push(JSON.stringify(effect)); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; };
  const em = () => effect.emitters[sel];
  function rebuildPlayer(keepTime = true) {
    player.setEffect(effect); player.attachTo(attachParent());
    if (keepTime) player.seek(dispTime); else { player.reset(); dispTime = 0; }
  }
  // kullanıcı bir değeri değiştirdi: normalize et, simülasyonu aynı zamana sar, sunucuya yaz
  function edited({ structure = false } = {}) {
    effect = normalizeEffect(effect).effect; sel = Math.min(sel, effect.emitters.length - 1);
    rebuildPlayer(true); scheduleSync(); refreshLeft(); if (structure) buildRight(); applyPreviewSettings();
  }
  function replaceEffect(e, { undo = true, restart = true } = {}) {
    if (undo) pushUndo();
    effect = normalizeEffect(e).effect; sel = Math.max(0, Math.min(sel, effect.emitters.length - 1));
    rebuildPlayer(!restart); if (restart) playing = true;
    refreshLeft(); buildRight(); applyPreviewSettings(); scheduleSync();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(effect)); replaceEffect(JSON.parse(undoStack.pop()), { undo: false, restart: false }); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(effect)); replaceEffect(JSON.parse(redoStack.pop()), { undo: false, restart: false }); }

  function applyPreviewSettings() {
    if (!active) return;
    const p = effect.preview;
    scene.background = new THREE.Color(p.background); ctx.grid.visible = p.showGrid; applyHeroVisibility(p.showHero);
    $('#vfxName').value = document.activeElement === $('#vfxName') ? $('#vfxName').value : effect.name;
  }

  // ── oynatma
  function seekTo(t) { dispTime = Math.max(0, t); player.seek(dispTime); }
  function togglePlay() { playing = !playing; if (playing && !player.allLooping && dispTime >= effect.duration) restart(); syncTransport(); }
  function restart() { player.attachTo(attachParent()); player.reset(); dispTime = 0; playing = true; syncTransport(); }
  function tick(dt) {
    if (!active) return;
    player.attachTo(attachParent());
    if (playing) {
      player.advance(dt * speed); dispTime = player.time;
      if (dispTime >= effect.duration && !player.allLooping) {
        if (effect.loop) { player.reset(); dispTime = 0; }
        else if (player.count === 0) { playing = false; dispTime = effect.duration; }
      }
    }
    if (!effect.preview.withAnimation) ctx.restorePose?.();
    player.upload(camera); syncTransport();
  }
  function syncTransport() {
    const d = effect.duration, shown = player.allLooping ? dispTime % d : Math.min(dispTime, d);
    if (document.activeElement !== $('#vfxTime')) $('#vfxTime').value = Math.round((shown / d) * 1000);
    $('#vfxTimeLabel').textContent = `${shown.toFixed(2)} / ${d.toFixed(2)} sn`;
    $('#vfxPlay').textContent = playing ? '⏸' : '▶';
    $('#vfxStats').textContent = `${player.count} parçacık`;
    $('#hud').textContent = `VFX · ${effect.name} · ${effect.emitters.length} emitter`;
  }
  $('#vfxPlay').onclick = togglePlay; $('#vfxRestart').onclick = restart;
  $('#vfxTime').oninput = (e) => { playing = false; seekTo((+e.target.value / 1000) * effect.duration); syncTransport(); };
  $('#vfxSpeed').onchange = (e) => { speed = +e.target.value || 1; };
  function focus() { // kamerayı efektin şu anki parçacıklarına sığdır, bakış yönü korunur
    const f = frameBox([dispTime]); const dir = new THREE.Vector3().subVectors(camera.position, orbit.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.6, 0.35, 0.75); dir.normalize(); player.seek(dispTime);
    orbit.target.copy(f.center); camera.position.copy(f.center).addScaledVector(dir, f.dist); orbit.update();
  }
  $('#vfxFocus').onclick = focus;

  // ── sol panel: emitter listesi
  function refreshLeft() {
    if (document.activeElement !== $('#vfxName')) $('#vfxName').value = effect.name;
    const box = $('#vfxEmitters'); box.innerHTML = '';
    effect.emitters.forEach((e, i) => {
      const row = el('div', 'li' + (i === sel ? ' sel' : ''));
      row.innerHTML = '<input type="checkbox" title="Açık/kapalı"><span class="n"></span><small></small><button title="Çoğalt">⧉</button><button title="Yukarı">↑</button><button title="Aşağı">↓</button><button title="Sil">✕</button>';
      const [cb] = row.querySelectorAll('input'); cb.checked = e.enabled;
      row.querySelector('.n').textContent = e.name;
      row.querySelector('small').textContent = e.emission.bursts.length ? 'burst' : Math.round(e.emission.rateOverTime) + '/sn';
      cb.onclick = (ev) => { ev.stopPropagation(); pushUndo(); effect.emitters[i].enabled = cb.checked; edited({ structure: i === sel }); };
      const [bDup, bUp, bDown, bDel] = row.querySelectorAll('button');
      bDup.onclick = (ev) => { ev.stopPropagation(); pushUndo(); const c = clone(e); c.name = e.name + '_kopya'; effect.emitters.splice(i + 1, 0, c); sel = i + 1; edited({ structure: true }); };
      bUp.onclick = (ev) => { ev.stopPropagation(); if (!i) return; pushUndo(); effect.emitters.splice(i - 1, 0, effect.emitters.splice(i, 1)[0]); sel = i - 1; edited({ structure: true }); };
      bDown.onclick = (ev) => { ev.stopPropagation(); if (i >= effect.emitters.length - 1) return; pushUndo(); effect.emitters.splice(i + 1, 0, effect.emitters.splice(i, 1)[0]); sel = i + 1; edited({ structure: true }); };
      bDel.onclick = (ev) => { ev.stopPropagation(); if (!confirm(e.name + ' silinsin mi?')) return; pushUndo(); effect.emitters.splice(i, 1); sel = Math.max(0, Math.min(sel, effect.emitters.length - 1)); edited({ structure: true }); };
      row.onclick = () => { sel = i; refreshLeft(); buildRight(); };
      box.appendChild(row);
    });
    if (!effect.emitters.length) box.innerHTML = '<div class="hint-s">Emitter yok. "+ Emitter" ile ekle.</div>';
  }
  $('#vfxName').oninput = (e) => { effect.name = e.target.value; scheduleSync(); };
  $('#vfxName').onchange = () => { pushUndo(); edited(); };
  {
    const list = $('#vfxAddList');
    const add = (preset) => { pushUndo(); const e = preset ? presetEmitter(preset) : { ...defaultEmitter(), name: 'emitter' }; effect.emitters.push(e); sel = effect.emitters.length - 1; edited({ structure: true }); $('#vfxAddMenu').open = false; };
    const b0 = el('button', 'item', 'Boş emitter'); b0.onclick = () => add(null); list.appendChild(b0); list.appendChild(el('div', 'sep'));
    for (const [k, label] of Object.entries(PRESET_LABELS)) { const b = el('button', 'item', label); b.onclick = () => add(k); list.appendChild(b); }
  }

  // ── alan bileşenleri (get/set her seferinde güncel efekti okur)
  function scrubLabel(label, input, step, apply) { // etikete basılı tutup sağa-sola sürükle: değeri değiştir (Shift ×10, Alt ×0.1)
    label.classList.add('scrub'); label.title = 'Sürükle: değiştir (Shift hızlı, Alt ince)';
    label.addEventListener('pointerdown', (e) => {
      if (e.target === input) return; e.preventDefault(); label.setPointerCapture(e.pointerId); pushUndo();
      let v = +input.value || 0;
      const move = (ev) => { v += ev.movementX * step * (ev.shiftKey ? 10 : 1) * (ev.altKey ? 0.1 : 1); input.value = fmt(v); apply(v); };
      const up = () => { label.removeEventListener('pointermove', move); label.removeEventListener('pointerup', up); };
      label.addEventListener('pointermove', move); label.addEventListener('pointerup', up);
    });
  }
  const numInput = (v, step, onv) => {
    const i = el('input'); i.type = 'number'; i.step = step; i.value = fmt(v);
    i.onfocus = () => pushUndo(); i.oninput = () => { const x = parseFloat(i.value); if (Number.isFinite(x)) onv(x); };
    return i;
  };
  function field(type, label, ref, o = {}, sliderKey) {
    const wrap = el('div', 'vf'); const lab = el('label', 'vl', label); wrap.appendChild(lab);
    const step = o.step ?? 0.01; const set = (v, structure) => { ref.set(v); edited({ structure }); };
    switch (type) {
      case 'num': case 'int': {
        const sr = SLIDER[sliderKey] || (o.min !== undefined && o.max !== undefined && o.max - o.min <= 400 ? [o.min, o.max] : null);
        const row = el('div', 'vrow');
        const ni = numInput(ref.get(), type === 'int' ? 1 : step, (x) => { const v = type === 'int' ? Math.round(x) : x; if (rg) rg.value = v; set(v); });
        let rg = null;
        if (sr) { rg = el('input'); rg.type = 'range'; rg.min = sr[0]; rg.max = sr[1]; rg.step = type === 'int' ? 1 : step; rg.value = ref.get(); rg.onpointerdown = () => pushUndo(); rg.oninput = () => { ni.value = fmt(rg.value); set(+rg.value); }; row.appendChild(rg); }
        row.appendChild(ni); wrap.appendChild(row);
        scrubLabel(lab, ni, type === 'int' ? 0.25 : step, (v) => { v = type === 'int' ? Math.round(v) : v; if (rg) rg.value = v; set(v); });
        break;
      }
      case 'range': case 'vec3': {
        const n = type === 'range' ? 2 : 3, names = type === 'range' ? ['min', 'maks'] : ['X', 'Y', 'Z'];
        const row = el('div', 'vrow multi');
        for (let k = 0; k < n; k++) {
          const cell = el('label', 'vsub'); const span = el('span', '', names[k]); cell.appendChild(span);
          const apply = (x) => { const a = [...ref.get()]; a[k] = x; if (type === 'range' && k === 0 && a[1] < x) a[1] = x; if (type === 'range' && k === 1 && a[0] > x) a[0] = x; set(a); };
          const ni = numInput(ref.get()[k], step, apply); cell.appendChild(ni); row.appendChild(cell);
          scrubLabel(span, ni, step, apply);
        }
        wrap.appendChild(row); break;
      }
      case 'bool': { lab.classList.add('chk'); lab.textContent = ''; const c = el('input'); c.type = 'checkbox'; c.checked = ref.get(); c.onchange = () => { pushUndo(); set(c.checked); }; lab.append(c, ' ' + label); break; }
      case 'enum': {
        const s = el('select'); for (const [v, t] of o.options) s.add(new Option(t, v)); s.value = ref.get();
        s.onchange = () => { pushUndo(); set(s.value, true); }; wrap.appendChild(s); break;
      }
      case 'color2': {
        const row = el('div', 'vrow');
        for (let k = 0; k < 2; k++) { const c = el('input'); c.type = 'color'; c.value = ref.get()[k].slice(0, 7); c.onfocus = () => pushUndo(); c.oninput = () => { const a = [...ref.get()]; a[k] = c.value + (a[k].length > 7 ? a[k].slice(7) : ''); set(a); }; row.appendChild(c); }
        wrap.appendChild(row); break;
      }
      case 'texture': {
        const row = el('div', 'vrow'); const s = el('select'); const img = el('img', 'texthumb');
        const fill = (list) => { s.innerHTML = ''; for (const t of list) s.add(new Option(TEXTURES[t] ? `${t} — ${TEXTURES[t]}` : t, t)); if (!list.includes(ref.get())) s.add(new Option(ref.get() + ' (yok)', ref.get())); s.value = ref.get(); img.src = '/vfx-textures/' + encodeURIComponent(ref.get()) + '.png'; };
        fill(textures); s.onchange = () => { pushUndo(); img.src = '/vfx-textures/' + encodeURIComponent(s.value) + '.png'; set(s.value); };
        const up = el('label', 'btn small', 'PNG yükle…'); const fi = el('input'); fi.type = 'file'; fi.accept = '.png'; fi.hidden = true; up.appendChild(fi);
        fi.onchange = async () => { const f = fi.files[0]; if (!f) return; await fetch('/api/upload-vfx-texture?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }); clearTextureCache(); await loadTextures(); pushUndo(); set(f.name.replace(/\.png$/i, ''), true); };
        row.append(img, s); wrap.append(row, up); break;
      }
      case 'material': {
        const s = el('select'); const cur = ref.get();
        s.add(new Option('Yok — doku, karışım, parlaklık', ''));
        for (const m of matList) s.add(new Option(m.shader ? `${m.name} — ${m.shader}` : m.name, m.name));
        if (cur && !matList.some((m) => m.name === cur)) s.add(new Option(cur + ' (yok)', cur));
        s.value = cur; s.onchange = () => { pushUndo(); set(s.value, true); };
        wrap.appendChild(s);
        if (cur) { const st = el('div', 'hint-s vmatstat'); st.dataset.mat = cur; st.textContent = matStatus(cur); wrap.appendChild(st); }
        else wrap.appendChild(el('div', 'hint-s', 'Materyal/Shader modunda yapıp kaydettiğin bir materyali seçebilirsin.'));
        break;
      }
      case 'gradient': wrap.appendChild(gradientUI(ref)); break;
      case 'curve': wrap.appendChild(curveUI(ref)); break;
      case 'bursts': wrap.appendChild(burstsUI(ref)); break;
    }
    return wrap;
  }

  function gradientUI(ref) { // ref.get() → colorOverLifetime modülü {color, alpha}
    const box = el('div', 'grad'); const cv = el('canvas', 'gbar'); box.appendChild(cv);
    const draw = () => {
      const w = cv.width = 220, h = cv.height = 18, x = cv.getContext('2d'), g = ref.get();
      for (let i = 0; i < w; i += 6) for (let j = 0; j < h; j += 6) { x.fillStyle = ((i + j) / 6) % 2 ? '#555' : '#888'; x.fillRect(i, j, 6, 6); }
      for (let i = 0; i < w; i++) { const [r, gg, b, a] = evalGradient(g, i / (w - 1)); x.fillStyle = `rgba(${r * 255},${gg * 255},${b * 255},${a})`; x.fillRect(i, 0, 1, h); }
    };
    const rows = (key, isColor) => {
      const list = el('div', 'stops'); const g = ref.get();
      g[key].forEach((k, idx) => {
        const r = el('div', 'vrow');
        const t = numInput(k[0], 0.01, (v) => { ref.get()[key][idx][0] = Math.min(1, Math.max(0, v)); draw(); edited(); });
        t.title = 'Konum (0..1 ömür)'; r.appendChild(t);
        if (isColor) { const c = el('input'); c.type = 'color'; c.value = k[1].slice(0, 7); c.onfocus = () => pushUndo(); c.oninput = () => { ref.get()[key][idx][1] = c.value; draw(); edited(); }; r.appendChild(c); }
        else { const a = numInput(k[1], 0.05, (v) => { ref.get()[key][idx][1] = Math.min(1, Math.max(0, v)); draw(); edited(); }); a.title = 'Alfa'; r.appendChild(a); }
        const del = el('button', '', '✕'); del.onclick = () => { if (ref.get()[key].length < 2) return; pushUndo(); ref.get()[key].splice(idx, 1); edited({ structure: true }); }; r.appendChild(del);
        list.appendChild(r);
      });
      const add = el('button', 'small', isColor ? '+ renk' : '+ alfa');
      add.onclick = () => { if (ref.get()[key].length >= 8) return toast('En çok 8 anahtar (Unity sınırı)'); pushUndo(); const ks = ref.get()[key]; const last = ks[ks.length - 1]; ks.push([Math.min(1, (last?.[0] ?? 0) + 0.2), isColor ? '#ffffff' : 1]); edited({ structure: true }); };
      return [el('div', 'vl', isColor ? 'Renk anahtarları (konum, renk)' : 'Alfa anahtarları (konum, alfa)'), list, add];
    };
    box.append(...rows('color', true), ...rows('alpha', false)); draw(); return box;
  }

  function curveUI(ref) { // [[t, v]] — sürükle: taşı · çift tık: nokta ekle · sağ tık: sil
    const box = el('div', 'curve'); const cv = el('canvas'); cv.width = 440; cv.height = 180; box.appendChild(cv);
    box.appendChild(el('div', 'hint-s', 'Sürükle: taşı · çift tık: ekle · sağ tık: sil'));
    let ymax = 1, dragI = -1;
    const pts = () => ref.get();
    const toXY = ([t, v]) => [12 + t * (cv.width - 24), cv.height - 12 - (v / ymax) * (cv.height - 24)];
    const fromXY = (x, y) => [Math.min(1, Math.max(0, (x - 12) / (cv.width - 24))), Math.max(0, ((cv.height - 12 - y) / (cv.height - 24)) * ymax)];
    const draw = () => {
      const x = cv.getContext('2d'); x.clearRect(0, 0, cv.width, cv.height); x.fillStyle = '#1a1d23'; x.fillRect(0, 0, cv.width, cv.height);
      x.strokeStyle = '#353b47'; x.lineWidth = 1; for (let i = 0; i <= 4; i++) { const yy = 12 + (i * (cv.height - 24)) / 4; x.beginPath(); x.moveTo(12, yy); x.lineTo(cv.width - 12, yy); x.stroke(); }
      x.fillStyle = '#8b93a3'; x.font = '20px system-ui'; x.fillText(fmt(ymax), 16, 30);
      x.strokeStyle = '#4da3ff'; x.lineWidth = 3; x.beginPath();
      for (let i = 0; i <= 100; i++) { const [px, py] = toXY([i / 100, evalCurve(pts(), i / 100)]); i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke();
      for (const p of pts()) { const [px, py] = toXY(p); x.fillStyle = '#f5b942'; x.beginPath(); x.arc(px, py, 7, 0, Math.PI * 2); x.fill(); }
    };
    const fit = () => { ymax = Math.max(1, ...pts().map((p) => p[1] * 1.15)); };
    const local = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height]; };
    const hit = (x, y) => pts().findIndex((p) => { const [px, py] = toXY(p); return Math.hypot(px - x, py - y) < 14; });
    cv.addEventListener('pointerdown', (e) => { if (e.button) return; const [x, y] = local(e); dragI = hit(x, y); if (dragI >= 0) { pushUndo(); cv.setPointerCapture(e.pointerId); } });
    cv.addEventListener('pointermove', (e) => {
      if (dragI < 0) return; const [x, y] = local(e); const p = pts(); const [t, v] = fromXY(x, y);
      const lo = dragI > 0 ? p[dragI - 1][0] : 0, hi = dragI < p.length - 1 ? p[dragI + 1][0] : 1;
      p[dragI] = [+Math.min(hi, Math.max(lo, t)).toFixed(3), +v.toFixed(3)]; draw(); ref.set(p); player.setEffect(effect); player.seek(dispTime); scheduleSync();
    });
    cv.addEventListener('pointerup', () => { if (dragI >= 0) { dragI = -1; fit(); edited(); draw(); } });
    cv.addEventListener('dblclick', (e) => { const [x, y] = local(e); const p = [...pts()]; if (p.length >= 16) return; pushUndo(); const [t] = fromXY(x, y); p.push([+t.toFixed(3), +evalCurve(pts(), t).toFixed(3)]); p.sort((a, b) => a[0] - b[0]); ref.set(p); edited(); draw(); });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); const [x, y] = local(e); const i = hit(x, y); if (i < 0 || pts().length < 2) return; pushUndo(); const p = [...pts()]; p.splice(i, 1); ref.set(p); fit(); edited(); draw(); });
    fit(); draw(); return box;
  }

  function burstsUI(ref) {
    const box = el('div', 'bursts');
    box.appendChild(el('div', 'vl', 'zaman · min · maks · tekrar · aralık'));
    ref.get().forEach((b, idx) => {
      const r = el('div', 'vrow');
      const mk = (val, step, f) => { const i = numInput(val, step, (v) => { f(ref.get()[idx], v); edited(); }); r.appendChild(i); };
      mk(b.time, 0.01, (o, v) => { o.time = Math.max(0, v); }); mk(b.count[0], 1, (o, v) => { o.count = [Math.round(v), Math.max(Math.round(v), o.count[1])]; });
      mk(b.count[1], 1, (o, v) => { o.count = [Math.min(o.count[0], Math.round(v)), Math.round(v)]; }); mk(b.cycles, 1, (o, v) => { o.cycles = Math.max(1, Math.round(v)); }); mk(b.interval, 0.01, (o, v) => { o.interval = Math.max(0.01, v); });
      const del = el('button', '', '✕'); del.onclick = () => { pushUndo(); ref.get().splice(idx, 1); edited({ structure: true }); }; r.appendChild(del);
      box.appendChild(r);
    });
    const add = el('button', 'small', '+ burst'); add.onclick = () => { if (ref.get().length >= 8) return; pushUndo(); ref.get().push({ time: 0, count: [10, 10], cycles: 1, interval: 0.1 }); edited({ structure: true }); };
    box.appendChild(add); return box;
  }

  // ── sağ panel
  const R = (getObj, key) => ({ get: () => getObj()[key], set: (v) => { getObj()[key] = v; } });
  function section(title, open, key) {
    const d = el('details'); d.open = open; const s = el('summary', '', title); d.appendChild(s);
    if (key) d.ontoggle = () => { if (d.closest('#right') && document.querySelector('#panelFilter')?.value) return; if (d.open) openMods.add(key); else openMods.delete(key); saveOpen(); };
    return d;
  }
  function buildRight() {
    const box = $('#vfxRight'); const scroll = $('#right').scrollTop; box.innerHTML = '';
    // efekt
    const se = section('Efekt', openMods.has('_effect'), '_effect'); const E = () => effect;
    se.append(
      field('num', 'Önizleme süresi (sn)', R(E, 'duration'), { min: 0.05, max: 60, step: 0.05 }, 'effect.duration'),
      field('bool', 'Döngü (önizlemede tekrar)', R(E, 'loop')),
    );
    const A = () => effect.attach; const rig = ctx.getRig();
    const targets = [['none', 'Yok (sahne merkezi)'], ['bone', 'Kemik'], ['prop', 'Eşya']];
    se.appendChild(field('enum', 'Bağla', R(A, 'target'), { options: targets }));
    if (effect.attach.target !== 'none') {
      const opts = effect.attach.target === 'bone' ? (rig?.bones || []).map((b) => { const n = b.name.replace(/^mixamorig:?/, ''); return [n, n]; }) : ctx.getProps().map((p) => [p.id, `${p.id} (${p.prop})`]);
      if (effect.attach.name && !opts.some((o) => o[0] === effect.attach.name)) opts.unshift([effect.attach.name, effect.attach.name + ' (yok)']);
      if (!effect.attach.name && opts.length) effect.attach.name = opts[0][0];
      se.append(field('enum', effect.attach.target === 'bone' ? 'Kemik' : 'Eşya', R(A, 'name'), { options: opts }),
        field('vec3', 'Bağlantı konumu (m)', R(A, 'position'), { step: 0.01 }), field('vec3', 'Bağlantı dönüşü (°)', R(A, 'rotation'), { step: 1 }));
    }
    const P = () => effect.preview;
    se.append(
      field('bool', 'Animasyonla birlikte oynat', R(P, 'withAnimation')),
      field('int', 'Animasyon başlangıç karesi', R(P, 'startFrame'), { min: 0, max: Math.max(1, (ctx.getAnim()?.length || 2) - 1), step: 1 }),
      field('num', 'Bloom', R(P, 'bloom'), { min: 0, max: 5, step: 0.05 }, 'effect.bloom'),
      field('bool', 'Kahramanı göster', R(P, 'showHero')), field('bool', 'Zemin ızgarası', R(P, 'showGrid')),
    );
    { const w = el('div', 'vf'); w.appendChild(el('label', 'vl', 'Arka plan')); const c = el('input'); c.type = 'color'; c.value = effect.preview.background; c.onfocus = () => pushUndo(); c.oninput = () => { effect.preview.background = c.value; edited(); }; w.appendChild(c); se.appendChild(w); }
    box.appendChild(se);

    // seçili emitter
    const e = em();
    if (e) {
      const EM = () => em();
      const sh = section('Emitter: ' + e.name, true);
      const nw = el('div', 'vf'); nw.appendChild(el('label', 'vl', 'Ad')); const ni = el('input'); ni.value = e.name; ni.onfocus = () => pushUndo(); ni.onchange = () => { em().name = ni.value; edited({ structure: true }); }; nw.appendChild(ni);
      sh.append(nw, field('vec3', 'Konum (m)', R(EM, 'position'), { step: 0.01 }), field('vec3', 'Dönüş (°)', R(EM, 'rotation'), { step: 1 }));
      box.appendChild(sh);
      for (const mod of MODULES) {
        const M = () => em()[mod.key];
        const d = section('', openMods.has(mod.key), mod.key); const s = d.querySelector('summary');
        if (!mod.always) {
          const t = el('span', 'tgl' + (M().enabled ? ' on' : ''), M().enabled ? '●' : '○'); t.title = 'Modülü aç/kapat';
          t.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); pushUndo(); M().enabled = !M().enabled; if (M().enabled) openMods.add(mod.key); edited({ structure: true }); };
          s.appendChild(t);
        }
        s.appendChild(document.createTextNode(mod.label)); if (!mod.always && !M().enabled) d.classList.add('off');
        const body = el('div', 'vbody');
        for (const [key, type, label, o] of mod.fields) {
          if (mod.key === 'shape') { const ty = M().type; if ((key === 'angle' && ty !== 'cone') || (key === 'boxSize' && ty !== 'box') || (key === 'donutRadius' && ty !== 'donut') || (['radius', 'radiusThickness'].includes(key) && ty === 'box') || (key === 'arc' && !['cone', 'circle', 'donut'].includes(ty))) continue; }
          if (mod.key === 'renderer' && ['lengthScale', 'velocityScale'].includes(key) && M().mode !== 'stretched') continue;
          if (mod.key === 'renderer' && ['texture', 'blend', 'intensity'].includes(key) && M().material) continue; // materyalden gelir
          body.appendChild(type === 'gradient' ? field('gradient', label, { get: M, set: () => {} }) : field(type, label, R(M, key), o, `${mod.key}.${key}`));
        }
        d.appendChild(body); box.appendChild(d);
      }
    }

    // kütüphane
    const sl = section('VFX kütüphanesi', openMods.has('_lib'), '_lib');
    sl.innerHTML += '<div class="row"><input class="vlibname" placeholder="isim" style="flex:1;min-width:0"><button class="primary vlibsave">Kaydet</button></div><div class="list vliblist"></div>';
    sl.querySelector('.vlibname').value = effect.name;
    sl.querySelector('.vlibsave').onclick = () => saveLib(sl.querySelector('.vlibname').value || effect.name);
    box.appendChild(sl); fillLib(sl.querySelector('.vliblist'));

    $('#right').scrollTop = scroll;
  }

  // ── kütüphane / dokular / Unity
  let textures = Object.keys(TEXTURES);
  async function loadTextures() { textures = await fetch('/api/vfx/textures').then((r) => r.json()).catch(() => textures); return textures; }
  async function fillLib(box) {
    const list = await fetch('/api/vfx/list').then((r) => r.json()).catch(() => []);
    box.innerHTML = list.length ? '' : '<div class="hint-s">Henüz kayıtlı efekt yok.</div>';
    for (const it of list) {
      const r = el('div', 'li', '<span class="n"></span><small></small><button title="Sil">✕</button>');
      r.querySelector('.n').textContent = it.name; r.querySelector('small').textContent = (it.emitters ?? '?') + ' em.'; r.title = 'Yüklemek için tıkla';
      r.onclick = async () => { const e = await fetch('/api/vfx/get?name=' + encodeURIComponent(it.name)).then((x) => x.json()); if (e.error) return toast(e.error); sel = 0; replaceEffect(e); toast('Yüklendi: ' + it.name); };
      r.querySelector('button').onclick = async (ev) => { ev.stopPropagation(); if (!confirm(it.name + ' silinsin mi?')) return; await fetch('/api/vfx/delete?name=' + encodeURIComponent(it.name), { method: 'POST' }); fillLib(box); };
      box.appendChild(r);
    }
  }
  async function saveLib(name) {
    name = String(name).trim().replace(/[^\w .-]+/g, '_'); if (!name) return;
    effect.name = name; await fetch('/api/vfx/save?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(effect) });
    scheduleSync(); refreshLeft(); buildRight(); toast('Kütüphaneye kaydedildi: ' + name);
  }
  async function sendUnity({ all = false } = {}) {
    toast("Unity'ye gönderiliyor…"); await api('/api/vfx', effect);
    const r = await api('/api/unity/send-vfx', { all });
    return r.error ? 'Hata: ' + r.error : r.ok ? "Unity'ye aktarıldı: " + (r.prefabs || []).join(', ') : (r.note || 'Gönderildi');
  }
  // Unreal (docs/UNREAL.md): yanıt { ok, systems:[{ name, path, warnings }], errors:{ ad: mesaj } } ya da { ok:false, error }
  async function sendUnreal({ all = false } = {}) {
    toast("Unreal'e gönderiliyor…"); await api('/api/vfx', effect);
    const r = await api('/api/unreal/send-vfx', { all });
    const errs = Object.entries(r.errors || {}).map(([n, m]) => `${n}: ${m}`);
    if (r.error || errs.length) return 'Hata: ' + [r.error, ...errs].filter(Boolean).join('; ');
    const paths = (r.systems || []).map((s) => s.path || s.name);
    const nWarn = (r.systems || []).reduce((a, s) => a + (s.warnings?.length || 0), 0);
    return r.ok ? "Unreal'e aktarıldı: " + paths.join(', ') + (nWarn ? ` (${nWarn} uyarı)` : '') : 'Hata: Unreal gönderimi başarısız';
  }

  // ── kadraj + kontak sayfası (MCP render_vfx)
  function frameBox(times) {
    // emitter başına: uçtaki birkaç parçacık kadrajı bozmasın diye eksen başına %5–95 aralığı (az parçacıkta tam aralık),
    // parçacık boyutu kadar genişletilir; sonra emitter kutuları birleştirilir (tek parçacıklı parlama/halka dışarıda kalmaz)
    const box = new THREE.Box3(), p = new THREE.Vector3();
    const per = player.sims.map(() => ({ xs: [[], [], []], size: 0 }));
    for (const t of times) {
      player.seek(t); player.root.updateWorldMatrix(true, true); player.worldRoot.updateWorldMatrix(true, false);
      player.sims.forEach((s, k) => {
        if (!s) return; const o = per[k];
        for (let i = 0; i < s.n; i++) { p.fromArray(s.P, i * 3).applyMatrix4(s.mesh.matrixWorld); o.xs[0].push(p.x); o.xs[1].push(p.y); o.xs[2].push(p.z); o.size = Math.max(o.size, s.size[i]); }
      });
    }
    const q = (a, f) => a[Math.min(a.length - 1, Math.floor(f * (a.length - 1)))];
    for (const o of per) {
      if (!o.xs[0].length) continue; for (const a of o.xs) a.sort((u, v) => u - v);
      const f = o.xs[0].length >= 20 ? 0.05 : 0, h = o.size / 2;
      box.union(new THREE.Box3(new THREE.Vector3(q(o.xs[0], f) - h, q(o.xs[1], f) - h, q(o.xs[2], f) - h), new THREE.Vector3(q(o.xs[0], 1 - f) + h, q(o.xs[1], 1 - f) + h, q(o.xs[2], 1 - f) + h)));
    }
    if (effect.preview.showHero && ctx.getRig()) box.union(new THREE.Box3(new THREE.Vector3(-0.4, 0, -0.4), new THREE.Vector3(0.4, 1.75, 0.4)));
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 0.8, 0), new THREE.Vector3(1.5, 1.5, 1.5));
    const center = box.getCenter(new THREE.Vector3()), r = Math.max(0.4, box.getSize(p).length() / 2);
    return { center, dist: (r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.05 };
  }
  const PRESET_DIR = { front: [0, 0.15, 1], side: [1, 0.15, 0], top: [0, 1, 0.001], threequarter: [0.6, 0.35, 0.75] };
  async function renderSheet(d) {
    const was = active; if (!was) ctx.setMode('vfx', { notify: false });
    const count = Math.max(1, Math.min(24, d.count || 6)), dur = effect.duration;
    const times = d.times?.length ? d.times.slice(0, 24) : Array.from({ length: count }, (_, i) => +((dur * (i + 0.5)) / count).toFixed(3));
    const cols = Math.max(1, Math.min(times.length, d.cols || Math.min(times.length, 3))), rows = Math.ceil(times.length / cols);
    const size = Math.max(128, Math.min(1024, d.size || 320));
    const keep = { pos: camera.position.clone(), target: orbit.target.clone(), aspect: camera.aspect, time: dispTime, playing, bg: effect.preview.background, hero: effect.preview.showHero };
    playing = false;
    const loads = async () => { await Promise.all(matLoading.values()); await Promise.all([texturesLoaded(), materialTexturesLoaded()]); };
    await Promise.race([loads(), new Promise((r) => setTimeout(r, 5000))]); // dokular ve emitter materyalleri yüklenmeden çizme
    if (d.bg) effect.preview.background = d.bg; if (typeof d.showHero === 'boolean') effect.preview.showHero = d.showHero; applyPreviewSettings();
    const f = frameBox(times);
    const U = (v) => new THREE.Vector3(-v[0], v[1], v[2]); // MCP kamerayı Unity ekseninde verir (three = X aynası)
    const target = d.camera?.target ? U(d.camera.target) : f.center;
    if (d.camera?.position) camera.position.copy(U(d.camera.position));
    else camera.position.copy(target).addScaledVector(new THREE.Vector3(...(PRESET_DIR[d.camera?.preset] || PRESET_DIR.threequarter)).normalize(), f.dist);
    camera.lookAt(target); orbit.target.copy(target);
    const sheet = el('canvas'); sheet.width = cols * size; sheet.height = rows * size; const sx = sheet.getContext('2d');
    fixedSize = true; renderer.setPixelRatio(1); renderer.setSize(size, size, false); composer.setPixelRatio(1); composer.setSize(size, size); camera.aspect = 1; camera.updateProjectionMatrix();
    try {
      times.forEach((t, i) => {
        player.seek(t); player.onBeforeStep?.(t); player.upload(camera); render();
        const x = (i % cols) * size, y = Math.floor(i / cols) * size; sx.drawImage(renderer.domElement, x, y, size, size);
        sx.font = `${Math.round(size / 20)}px system-ui`; sx.fillStyle = '#ffffffcc'; sx.shadowColor = '#000'; sx.shadowBlur = 4;
        sx.fillText(`${t.toFixed(2)} sn · ${player.count} p`, x + 8, y + size / 14); sx.shadowBlur = 0;
        sx.strokeStyle = '#ffffff30'; sx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      });
    } finally {
      effect.preview.background = keep.bg; effect.preview.showHero = keep.hero;
      camera.position.copy(keep.pos); orbit.target.copy(keep.target); camera.aspect = keep.aspect; orbit.update();
      fixedSize = false; renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); ctx.onResize(); resize();
      seekTo(keep.time); playing = keep.playing; applyPreviewSettings();
      if (!was) ctx.setMode('anim', { notify: false });
    }
    return sheet.toDataURL('image/png');
  }

  // ── mod geçişi
  function activate() {
    active = true; player.setVisible(true); resize(); ctx.overlay.visible = false;
    matRes.clear(); ctx.forgetLibMaterials?.(); // Materyal/Shader modunda kaydedilen son hâller
    loadTextures(); rebuildPlayer(true); refreshLeft(); buildRight(); applyPreviewSettings();
    loadMatList().then(() => { if (active) buildRight(); });
  }
  function deactivate() {
    active = false; player.setVisible(false); ctx.overlay.visible = true; ctx.grid.visible = true; scene.background = new THREE.Color(ctx.BG); applyHeroVisibility(true);
  }
  function onRemoteEffect(e) { replaceEffect(e); toast('Claude efekti güncelledi (Ctrl+Z ile geri al)'); }
  function setFromState(e) { effect = normalizeEffect(e || defaultEffect()).effect; sel = 0; rebuildPlayer(false); }
  function nudge(dt) { playing = false; seekTo(Math.max(0, dispTime + dt)); syncTransport(); }

  return {
    activate, deactivate, get active() { return active; }, tick, render, onRemoteEffect, setFromState, renderSheet, undo, redo, togglePlay, restart, nudge,
    sendUnity: () => sendUnity({}), sendUnreal: (o) => sendUnreal(o || {}), frame: focus, get effect() { return effect; }, player,
    noteContext: () => { const t = player.allLooping ? dispTime % effect.duration : Math.min(dispTime, effect.duration); // ekranda görünen zaman
      return { label: `VFX · ${effect.name}${em() ? ' · emitter ' + em().name : ''} · ${t.toFixed(2)} sn`, data: { mode: 'vfx', emitter: em()?.name || null, effectTime: +t.toFixed(2) } }; },
    baseline: async () => { await api('/api/vfx', effect); await api('/api/vfx/baseline', {}); },
    get itemName() { return `Efekt <b>${effect.name}</b> · ${effect.emitters.length} katman · ${effect.duration} sn`; },
  };
}
