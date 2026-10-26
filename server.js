// Unity Preview Editor sunucusu (eski adı Anim Ref): statik dosyalar + state API + SSE (editör <-> MCP köprüsü).
// Modlar: animasyon + VFX (docs/VFX.md) + materyal/shader (docs/MATERIAL.md) + model görüntüleyici (GLB/FBX/OBJ). Unity'ye .anim, VFX prefab, .mat/.shader gönderimi.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeEffect } from './public/vfx-schema.js';
import { normalizeShader, normalizeMaterial, normalizeLighting, shaderUnityName, safeAssetName, BUILTIN_TEXTURES, CUSTOM_PREFIX } from './public/shader-schema.js';
import { BUILTIN_SHADERS } from './public/shader-builtins.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.UPE_PORT || process.env.ANIMREF_PORT || 5177);
// 5177 ana editör project.json'u kullanır; diğer portlar (chat başına editör) kendi durum dosyasını tutar, ilk açılışta ana durumdan başlar
const MAIN_STATE = path.join(ROOT, 'project.json');
const STATE_FILE = PORT === 5177 ? MAIN_STATE : path.join(ROOT, '.ports', `project-${PORT}.json`);
const MODELS_DIR = path.join(ROOT, 'models');
const EXPORTS_DIR = path.join(ROOT, 'exports');
const ANIMS_DIR = path.join(ROOT, 'animations');
const PROPS_DIR = path.join(ROOT, 'props');
const VFX_DIR = path.join(ROOT, 'vfx'); // efekt kütüphanesi: vfx/<ad>.json
const VFX_TEX_DIR = path.join(VFX_DIR, 'textures'); // parçacık dokuları: vfx/textures/<ad>.png
const SHADERS_DIR = path.join(ROOT, 'shaders'); // özel shader'lar: shaders/<ad>.json (builtin'ler kodda: public/shader-builtins.js)
const MAT_DIR = path.join(ROOT, 'materials'); // materyaller: materials/<ad>.json
const MAT_TEX_DIR = path.join(MAT_DIR, 'textures'); // materyal dokuları: materials/textures/<ad>.png
const MESHES_DIR = path.join(ROOT, 'meshes'); // Model modunda görüntülenen genel modeller: çevre, düşman vb. (meshes/<ad>.glb|fbx|gltf|obj)
for (const d of [ANIMS_DIR, PROPS_DIR, VFX_DIR, VFX_TEX_DIR, SHADERS_DIR, MAT_DIR, MAT_TEX_DIR, MESHES_DIR]) fs.mkdirSync(d, { recursive: true });
const safeName = (n) => path.basename(String(n || '')).replace(/[^\w .-]+/g, '_');
fs.mkdirSync(MODELS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain; charset=utf-8', '.map': 'application/json',
};

// mode: editörün açık modu; vfx: editördeki efekt; vfxBaseline: Claude'un son verdiği hâl (kullanıcı farkı buna göre)
// material/shader: editördeki materyal/shader (+ *Baseline aynı mantık); lighting: ortak sahne ışığı; materialOverrides: { 'hero'|'hero:<mesh>'|'prop:<id>': materyal }
// modelView: Model sekmesi { file: { dir:'meshes'|'models'|'props', name } | null, view: görünüm ayarları, info: editörün ölçtüğü model bilgisi | null }
let state = { rig: null, modelName: null, anim: null, baseline: null, notes: [], props: [], version: 0, mode: 'anim', vfx: null, vfxBaseline: null,
  material: null, materialBaseline: null, shader: null, shaderBaseline: null, lighting: null, materialOverrides: {}, modelView: null };
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
try { state = { ...state, ...JSON.parse(fs.readFileSync(fs.existsSync(STATE_FILE) ? STATE_FILE : MAIN_STATE, 'utf8')) }; } catch { /* ilk çalıştırma */ }
const MODES = ['anim', 'vfx', 'material', 'shader', 'model'];
if (!MODES.includes(state.mode)) state.mode = 'anim';
const normOverrides = (o) => Object.fromEntries(Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).filter(([k, v]) => k && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]));
state.lighting = normalizeLighting(state.lighting); state.materialOverrides = normOverrides(state.materialOverrides);
const noteMode = (n) => n.mode || 'anim';

let saveTimer = null;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(STATE_FILE, JSON.stringify(state), () => {}), 300);
};

// ── Unity entegrasyonu: proje yolu + karakter ayarı; "gönder" = JSON'u Assets/AnimRef'e yaz, Unity otomatik .anim yapar
state.unity ||= { project: null, character: null, mode: 'Auto' };
const isUnityProject = (p) => fs.existsSync(path.join(p, 'Assets')) && fs.existsSync(path.join(p, 'ProjectSettings'));
function unityScan(project) { // Assets içindeki fbx/prefab dosyaları (karakter adayları)
  const out = []; const root = path.join(project, 'Assets');
  const walk = (dir, depth) => {
    if (out.length > 800 || depth > 8) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['AnimRef', 'Editor', 'Plugins', 'Packages'].includes(e.name)) walk(full, depth + 1); }
      else if (/\.(fbx|prefab)$/i.test(e.name)) out.push('Assets/' + path.relative(root, full).split(path.sep).join('/'));
    }
  };
  try { walk(root, 0); } catch { /* okunamadı */ }
  return out;
}
function unityInstall() { // importer script'lerini Unity projesine kopyala/güncelle (git pull ile güncellenir)
  const dest = path.join(state.unity.project, 'Assets', 'Editor', 'AnimRef'); fs.mkdirSync(dest, { recursive: true });
  for (const f of ['AnimRefImporter.cs', 'AnimRefAutoImport.cs']) {
    const src = fs.readFileSync(path.join(ROOT, 'unity', f)); const dst = path.join(dest, f);
    if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(src)) fs.writeFileSync(dst, src);
  }
}
function unityInfo() {
  const u = state.unity; const valid = !!u.project && isUnityProject(u.project);
  const characters = valid ? unityScan(u.project) : [];
  let guess = null;
  if (valid && !u.character) { const base = (state.modelName || '').replace(/\.\w+$/, '').replace(/[\s_-]/g, '').toLowerCase(); guess = characters.find((c) => base && path.basename(c).replace(/\.\w+$/, '').replace(/[\s_-]/g, '').toLowerCase() === base) || null; }
  return { ...u, valid, characters, guess };
}
const flatTracks = (anim) => Object.entries(anim.tracks || {}).map(([bone, t]) => ({ bone, rot: (t.rot || []).flat(), pos: (t.pos || []).flat() }));
async function unitySend({ animation, all }) {
  const u = state.unity;
  if (!u.project || !isUnityProject(u.project)) throw new Error('Unity proje klasörü ayarlı değil. Sağ panel → Unity bölümünden seç.');
  if (!state.rig) throw new Error('Rig bilgisi yok; editörde bir karakter yükle.');
  const info = unityInfo(); if (!u.character && info.guess) { u.character = info.guess; save(); }
  if (!u.character) throw new Error('Unity karakteri seçilmedi. Sağ panel → Unity → Karakter.');
  unityInstall();
  const list = [];
  if (all) { for (const f of fs.readdirSync(ANIMS_DIR).filter((x) => x.endsWith('.json'))) list.push(JSON.parse(fs.readFileSync(path.join(ANIMS_DIR, f), 'utf8'))); }
  else if (animation) { const f = path.join(ANIMS_DIR, safeName(animation) + '.json'); if (!fs.existsSync(f)) throw new Error('Kütüphanede yok: ' + animation); list.push(JSON.parse(fs.readFileSync(f, 'utf8'))); }
  else { if (!state.anim) throw new Error('Gönderilecek animasyon yok'); list.push(state.anim); }
  const dir = path.join(u.project, 'Assets', 'AnimRef'); fs.mkdirSync(path.join(dir, 'Clips'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ character: u.character, mode: u.mode || 'Auto' }));
  const started = Date.now() - 1000; const names = [];
  const sentAt = new Date().toISOString(); // Unity içerik özetine bakar: her gönderim farklı içerik = aynı animasyonu yeniden göndermek de aktarır
  for (const anim of list) {
    const name = safeName(anim.name || 'anim').replace(/\s+/g, '_');
    const payload = { format: 'animref-1', name, sentAt, fps: anim.fps, length: anim.length, loop: anim.loop, unitScale: state.rig.unitScale, bones: state.rig.bones, props: state.props || [], trackList: flatTracks(anim) };
    fs.writeFileSync(path.join(dir, name + '.animref.json'), JSON.stringify(payload)); names.push(name);
  }
  // Unity açıksa birkaç saniye içinde .anim oluşur; bekle ve sonucu bildir
  const pending = new Set(names); const done = [];
  for (let i = 0; i < 40 && pending.size; i++) {
    await new Promise((r) => setTimeout(r, 500));
    for (const n of [...pending]) { const c = path.join(dir, 'Clips', n + '.anim'); if (fs.existsSync(c) && fs.statSync(c).mtimeMs >= started) { pending.delete(n); done.push(n); } }
    try { const st = fs.readFileSync(path.join(dir, 'last_status.txt'), 'utf8').split('|'); if (st[1] === 'ERROR' && fs.statSync(path.join(dir, 'last_status.txt')).mtimeMs >= started) return { ok: false, sent: names, error: st.slice(2).join('|') }; } catch { /* henüz yok */ }
  }
  return { ok: pending.size === 0, sent: names, imported: done, waiting: [...pending], clips: done.map((n) => 'Assets/AnimRef/Clips/' + n + '.anim'),
    note: pending.size ? 'Unity açık değil ya da odakta değil; Unity\'ye geçince / açılınca otomatik aktarılır.' : 'Unity\'ye aktarıldı.' };
}

// ── VFX kütüphanesi + Unity'ye VFX gönderimi (docs/VFX.md)
const vfxFile = (name) => path.join(VFX_DIR, safeName(name).replace(/\.json$/i, '') + '.json');
const readVfx = (name) => { const f = vfxFile(name); if (!fs.existsSync(f)) return null; return JSON.parse(fs.readFileSync(f, 'utf8')); };
const listVfx = () => fs.readdirSync(VFX_DIR).filter((f) => f.endsWith('.json')).map((f) => {
  const full = path.join(VFX_DIR, f); const o = { name: f.slice(0, -5), file: f, modified: fs.statSync(full).mtimeMs, emitters: 0, duration: null };
  try { const e = JSON.parse(fs.readFileSync(full, 'utf8')); o.emitters = Array.isArray(e.emitters) ? e.emitters.length : 0; o.duration = e.duration ?? null; } catch { o.error = 'bozuk json'; }
  return o;
});
const listVfxTextures = () => fs.readdirSync(VFX_TEX_DIR).filter((f) => /\.png$/i.test(f)).map((f) => f.replace(/\.png$/i, '')).sort();
const copyIfChanged = (src, dst) => { const b = fs.readFileSync(src); if (fs.existsSync(dst) && fs.readFileSync(dst).equals(b)) return false; fs.writeFileSync(dst, b); return true; };
async function unitySendVfx({ name, all }) {
  const u = state.unity;
  if (!u.project || !isUnityProject(u.project)) throw new Error('Unity proje klasörü ayarlı değil. Sağ panel → Unity bölümünden seç (ya da MCP set_unity_project).');
  // 1) importer script'leri (unity/UnityPreviewVfx*.cs) → Assets/Editor/UnityPreview/
  const scripts = fs.readdirSync(path.join(ROOT, 'unity')).filter((f) => /^UnityPreviewVfx.*\.cs$/.test(f));
  const edDir = path.join(u.project, 'Assets', 'Editor', 'UnityPreview'); fs.mkdirSync(edDir, { recursive: true });
  for (const f of scripts) copyIfChanged(path.join(ROOT, 'unity', f), path.join(edDir, f));
  // 2) gönderilecek efektler: all → kütüphanenin tamamı, name → kütüphaneden, yoksa editördeki
  const list = [];
  if (all) { for (const it of listVfx()) { try { list.push({ ...readVfx(it.name), name: it.name }); } catch { /* bozuk json atlanır */ } } if (!list.length) throw new Error('VFX kütüphanesi boş (vfx/*.json yok)'); }
  else if (name) { const e = readVfx(name); if (!e) throw new Error('VFX kütüphanesinde yok: ' + name); list.push({ ...e, name: path.basename(vfxFile(name), '.json') }); }
  else { if (!state.vfx) throw new Error('Gönderilecek efekt yok (editörde VFX boş)'); list.push(state.vfx); }
  // 3) normalize → Assets/UnityPreview/VFX/<ad>.vfx.json, kullanılan dokular → Textures/<doku>.png
  const dir = path.join(u.project, 'Assets', 'UnityPreview', 'VFX'); const texDir = path.join(dir, 'Textures');
  fs.mkdirSync(texDir, { recursive: true });
  const started = Date.now() - 1000; const names = []; const missing = new Set(); const textures = new Set(); const warnings = {}; const errors = {};
  const usedMats = (effect) => [...new Set(effect.emitters.map((em) => em.renderer.material).filter(Boolean))];
  const effects = list.map((src) => {
    const { effect, warnings: w } = normalizeEffect(src);
    const base = safeName(effect.name || 'vfx').replace(/\s+/g, '_'); effect.name = base; // prefab adı = dosya adı = efekt adı
    if (w.length) warnings[base] = w;
    for (const em of effect.emitters) {
      const t = em.renderer.texture; if (em.renderer.material || !t || textures.has(t)) continue; textures.add(t); // materyalli emitter'da doku materyalden
      const s = path.join(VFX_TEX_DIR, t + '.png');
      if (fs.existsSync(s)) copyIfChanged(s, path.join(texDir, t + '.png')); else missing.add(t);
    }
    return effect;
  });
  // 3b) emitter materyalleri (renderer.material) + özel shader'ları → Assets/UnityPreview/Materials/ (VFX importer bunları bekler)
  const matNames = [...new Set(effects.flatMap(usedMats))]; let matOut = null;
  if (matNames.length) {
    const raws = matNames.map((n) => readMatRaw(n));
    const absent = matNames.filter((n, i) => !raws[i]);
    installMaterialScripts(u.project);
    matOut = await writeMaterialPayloads(u.project, raws.filter(Boolean));
    for (const effect of effects) { // materyali yazılamayan efekt gönderilmez (Unity'de eksik materyalle prefab üretilmesin)
      const bad = usedMats(effect).map((n) => (absent.includes(n) ? `${n}: kütüphanede yok (list_materials)` : matOut.errors[n] ? `${n}: ${matOut.errors[n]}` : null)).filter(Boolean);
      if (bad.length) errors[effect.name] = 'materyal gönderilemedi — ' + bad.join('; ');
    }
  }
  for (const effect of effects) { if (errors[effect.name]) continue; fs.writeFileSync(path.join(dir, effect.name + '.vfx.json'), JSON.stringify(effect, null, 1)); names.push(effect.name); } // json en son: importer dokuları hazır bulur
  // 4) Unity açıksa importer prefab'ı üretir: ≤ 20 sn bekle, last_status.txt (ad|OK|yol | ad|ERROR|mesaj) oku
  const pending = new Set(names); const done = []; const statusFile = path.join(dir, 'last_status.txt');
  for (let i = 0; i < 40 && pending.size; i++) {
    await new Promise((r) => setTimeout(r, 500));
    for (const n of [...pending]) { const pf = path.join(dir, n + '.prefab'); if (fs.existsSync(pf) && fs.statSync(pf).mtimeMs >= started) { pending.delete(n); done.push(n); } }
    try {
      if (fs.statSync(statusFile).mtimeMs >= started) for (const line of fs.readFileSync(statusFile, 'utf8').split(/\r?\n/)) {
        const st = line.split('|'); if (st[1] === 'ERROR' && pending.has(st[0])) { pending.delete(st[0]); errors[st[0]] = st.slice(2).join('|'); }
      }
    } catch { /* henüz yok */ }
  }
  const out = { ok: !pending.size && !Object.keys(errors).length, sent: names, imported: done, waiting: [...pending], prefabs: done.map((n) => 'Assets/UnityPreview/VFX/' + n + '.prefab'),
    textures: [...textures], missingTextures: [...missing] };
  if (matOut) { // Unity'nin materyal/shader durum satırları (özel shader derleme hatası prefab'ı bozmaz ama parçacık pembe çizilir)
    const lines = readStatus(path.join(matOut.dir, 'last_status.txt'), started);
    out.materials = matOut.names.map((n) => `Assets/UnityPreview/Materials/${n}.mat`);
    if (matOut.shaders.size) out.shaders = [...matOut.shaders.values()].filter((x) => x.path).map((x) => x.path);
    const matErr = Object.fromEntries(lines.filter((l) => matOut.names.includes(l.key) && l.status === 'ERROR').map((l) => [l.key, l.msg || 'hata']));
    const shErr = shaderErrsOf(lines).filter((e) => [...matOut.shaders.keys()].includes(e.shader));
    if (Object.keys(matErr).length) out.materialErrors = matErr;
    if (shErr.length) { out.shaderErrors = shErr; out.ok = false; }
    for (const [n, w] of Object.entries(matOut.warnings)) (out.warnings ??= {})['material:' + n] = w;
    if (matOut.missing.size) out.missingMaterialTextures = [...matOut.missing];
  }
  if (Object.keys(warnings).length) out.warnings = { ...warnings, ...out.warnings };
  if (!scripts.length) out.scriptsMissing = 'unity/UnityPreviewVfx*.cs bulunamadı; Unity tarafında importer kurulu değilse prefab üretilmez.';
  if (Object.keys(errors).length) { out.errors = errors; out.error = Object.entries(errors).map(([n, m]) => n + ': ' + m).join('; '); }
  else if (out.shaderErrors) out.error = out.shaderErrors.map((e) => `shader ${e.shader}${e.line != null ? ' satır ' + e.line : ''}: ${e.message}`).join('; ');
  else out.note = pending.size ? 'Unity açık değil ya da odakta değil; Unity\'ye geçince / açılınca prefab otomatik üretilir (batchmode: -executeMethod UnityPreviewVfxImporter.ProcessPending).' : 'Unity\'ye aktarıldı.';
  return out;
}

// ── Materyal + Shader kütüphanesi (docs/MATERIAL.md; format/mantık public/shader-schema.js)
const BUILTINS = BUILTIN_SHADERS.map((s) => normalizeShader(s).shader);
const lc = (s) => String(s ?? '').trim().toLowerCase();
const builtinOf = (n) => { const k = lc(n); return (k && BUILTINS.find((s) => lc(s.name) === k || lc(s.unityName) === k)) || null; };
const customBase = (n) => { const s = String(n ?? '').trim().replace(/\.json$/i, ''); return safeAssetName(lc(s).startsWith(lc(CUSTOM_PREFIX)) ? s.slice(CUSTOM_PREFIX.length) : s); }; // 'UnityPreview/x' | 'x' → 'x'
const isBuiltinName = (n) => !!(builtinOf(n) || builtinOf(customBase(n)));
function readCustomShader(n) {
  const b = customBase(n); if (!b) return null; const f = path.join(SHADERS_DIR, b + '.json'); if (!fs.existsSync(f)) return null;
  return normalizeShader({ ...JSON.parse(fs.readFileSync(f, 'utf8')), name: b, builtin: false }).shader;
}
const findShader = (n) => builtinOf(n) || readCustomShader(n); // kütüphane: builtin + shaders/
// materyal çözümlemesi: builtin → editördeki kaydedilmemiş özel çalışma kopyası (ad eşleşirse) → shaders/
const workingShader = (n) => { const s = state.shader; if (!s || s.builtin) return null; const b = customBase(n); return b && lc(safeAssetName(s.name)) === lc(b) ? normalizeShader(s).shader : null; };
const resolveShader = (n) => builtinOf(n) || workingShader(n) || readCustomShader(n);
const listShaders = () => [
  ...BUILTINS.map((s) => ({ name: s.name, unityName: s.unityName, builtin: true, description: s.description, properties: s.properties, modified: null })),
  ...fs.readdirSync(SHADERS_DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const name = f.slice(0, -5); const o = { name, unityName: CUSTOM_PREFIX + name, builtin: false, description: '', properties: [], modified: fs.statSync(path.join(SHADERS_DIR, f)).mtimeMs };
    try { const s = readCustomShader(name); o.description = s.description; o.properties = s.properties; } catch { o.error = 'bozuk json'; }
    return o;
  }),
];
const matFile = (n) => path.join(MAT_DIR, safeAssetName(String(n ?? '').replace(/\.json$/i, '')) + '.json');
const readMatRaw = (n) => { const b = safeAssetName(String(n ?? '').replace(/\.json$/i, '')); const f = path.join(MAT_DIR, b + '.json'); if (!b || !fs.existsSync(f)) return null; return { ...JSON.parse(fs.readFileSync(f, 'utf8')), name: b }; };
const normMat = (raw) => { const shader = resolveShader(raw?.shader); return { ...normalizeMaterial(raw, shader), shader }; };
const listMaterials = () => fs.readdirSync(MAT_DIR).filter((f) => f.endsWith('.json')).map((f) => {
  const full = path.join(MAT_DIR, f); const o = { name: f.slice(0, -5), file: f, modified: fs.statSync(full).mtimeMs, shader: null, target: null };
  try { const m = JSON.parse(fs.readFileSync(full, 'utf8')); o.shader = m.shader ?? null; o.target = m.preview?.target ?? null; } catch { o.error = 'bozuk json'; }
  return o;
});
const listMatTextures = () => fs.readdirSync(MAT_TEX_DIR).filter((f) => /\.png$/i.test(f)).map((f) => f.replace(/\.png$/i, '')).sort();

// ── Unity'ye materyal/shader gönderimi
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const requireUnityProject = () => { const u = state.unity; if (!u.project || !isUnityProject(u.project)) throw new Error('Unity proje klasörü ayarlı değil. Sağ panel → Unity bölümünden seç (ya da MCP set_unity_project).'); return u.project; };
function installMaterialScripts(project) { // unity/UnityPreviewMaterial*.cs → Assets/Editor/UnityPreview/ (değiştiyse)
  const scripts = fs.readdirSync(path.join(ROOT, 'unity')).filter((f) => /^UnityPreviewMaterial.*\.cs$/.test(f));
  const edDir = path.join(project, 'Assets', 'Editor', 'UnityPreview'); fs.mkdirSync(edDir, { recursive: true });
  for (const f of scripts) copyIfChanged(path.join(ROOT, 'unity', f), path.join(edDir, f));
  return scripts;
}
const SCRIPTS_MISSING = 'unity/UnityPreviewMaterial*.cs bulunamadı; Unity tarafında importer kurulu değilse .mat üretilmez.';
async function loadShaderGen() { // lib/shader-hlsl.js dinamik (yoksa/bozuksa anlaşılır hata); mtime sorgusu: dosya güncellenince yeniden yüklenir
  const f = path.join(ROOT, 'lib', 'shader-hlsl.js');
  if (!fs.existsSync(f)) throw new Error('lib/shader-hlsl.js yok — Unity HLSL üretici kurulu değil, özel shader Unity\'ye yazılamıyor.');
  let mod; try { mod = await import(pathToFileURL(f).href + '?v=' + fs.statSync(f).mtimeMs); } catch (e) { throw new Error('lib/shader-hlsl.js yüklenemedi: ' + (e?.message || e)); }
  if (typeof mod.generateUnityShader !== 'function') throw new Error('lib/shader-hlsl.js generateUnityShader dışa aktarmıyor.');
  return mod.generateUnityShader;
}
async function writeUnityShader(project, shader) { // özel shader → Assets/UnityPreview/Shaders/<ad>.shader (değiştiyse)
  if (shader.builtin) throw new Error(`${shader.unityName} hazır (builtin) bir Unity shader'ı; .shader yazılmaz.`);
  const gen = await loadShaderGen(); let out;
  try { out = gen(shader); } catch (e) { throw new Error(`${shader.name}: HLSL üretilemedi — ${e?.message || e}`); }
  if (!out || typeof out.source !== 'string' || !out.source.trim()) throw new Error(`${shader.name}: generateUnityShader boş kaynak döndürdü.`);
  const rel = `Assets/UnityPreview/Shaders/${shader.name}.shader`; const dst = path.join(project, ...rel.split('/'));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const buf = Buffer.from(out.source, 'utf8'); const changed = !(fs.existsSync(dst) && fs.readFileSync(dst).equals(buf));
  if (changed) fs.writeFileSync(dst, buf);
  return { name: shader.name, unityName: shader.unityName, path: rel, changed, warnings: Array.isArray(out.warnings) ? out.warnings : [] };
}
// Assets/UnityPreview/Materials/last_status.txt: '<ad>|OK|<yol>' · '<ad>|ERROR|<mesaj>' · 'shader:<ad>|OK|<yol>' · 'shader:<ad>|ERROR|<satır>: <mesaj>'
const readStatus = (file, since) => { try { if (fs.statSync(file).mtimeMs < since) return []; return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim()).map((l) => { const [key, status, ...rest] = l.split('|'); return { key: key.trim(), status: (status || '').trim(), msg: rest.join('|').trim() }; }); } catch { return []; } };
const shaderErr = (l) => { const m = /^(\d+)\s*:\s*([\s\S]*)$/.exec(l.msg); return { shader: l.key.slice(7), line: m ? +m[1] : null, message: m ? m[2] : l.msg }; };
const shaderErrsOf = (lines, only) => lines.filter((l) => l.key.startsWith('shader:') && l.status === 'ERROR' && (!only || l.key === 'shader:' + only)).map(shaderErr);
const UNITY_WAIT_NOTE = 'Unity açık değil ya da odakta değil; Unity\'ye geçince / açılınca otomatik işlenir (batchmode: -executeMethod UnityPreviewMaterialImporter.ProcessPending).';

async function unitySendMaterial({ name, all }) {
  const project = requireUnityProject();
  const scripts = installMaterialScripts(project); // 1) importer
  const list = []; // 2) materyaller: all → kütüphane, name → kütüphaneden, yoksa editördeki
  if (all) { for (const it of listMaterials()) { try { const m = readMatRaw(it.name); if (m) list.push(m); } catch { /* bozuk json atlanır */ } } if (!list.length) throw new Error('Materyal kütüphanesi boş (materials/*.json yok)'); }
  else if (name) { const m = readMatRaw(name); if (!m) throw new Error('Materyal kütüphanesinde yok: ' + name); list.push(m); }
  else { if (!state.material) throw new Error('Gönderilecek materyal yok (editörde materyal boş)'); list.push(state.material); }
  const started = Date.now() - 1000;
  const { dir, names, errors, warnings, missing, textures, shaders } = await writeMaterialPayloads(project, list);
  // 6) ≤25 sn: <ad>.mat mtime ≥ başlangıç ya da durum satırı
  const pending = new Set(names); const done = []; const statusFile = path.join(dir, 'last_status.txt'); let shaderErrors = [];
  const poll = () => {
    const lines = readStatus(statusFile, started); shaderErrors = shaderErrsOf(lines);
    for (const l of lines) if (pending.has(l.key) && (l.status === 'OK' || l.status === 'ERROR')) { pending.delete(l.key); if (l.status === 'ERROR') errors[l.key] = l.msg || 'hata'; else done.push(l.key); }
    for (const n of [...pending]) { const mf = path.join(dir, n + '.mat'); if (fs.existsSync(mf) && fs.statSync(mf).mtimeMs >= started) { pending.delete(n); done.push(n); } }
  };
  for (let i = 0; i < 50 && pending.size; i++) { await sleep(500); poll(); }
  poll(); // son durum (shader satırları)
  const out = { ok: names.length > 0 && !pending.size && !Object.keys(errors).length && !shaderErrors.length, sent: names, imported: done, waiting: [...pending],
    materials: done.map((n) => `Assets/UnityPreview/Materials/${n}.mat`), shaders: [...shaders.values()].filter((x) => x.path).map((x) => x.path), shaderErrors,
    textures: [...textures], missingTextures: [...missing], shaderDetails: [...shaders.values()] };
  if (Object.keys(warnings).length) out.warnings = warnings;
  if (!scripts.length) out.scriptsMissing = SCRIPTS_MISSING;
  const errText = [...Object.entries(errors).map(([n, msg]) => n + ': ' + msg), ...shaderErrors.map((e) => `shader ${e.shader}${e.line != null ? ' satır ' + e.line : ''}: ${e.message}`)];
  if (Object.keys(errors).length) out.errors = errors;
  if (errText.length) out.error = errText.join('; ');
  else out.note = pending.size ? UNITY_WAIT_NOTE : 'Unity\'ye aktarıldı.';
  return out;
}

// materyalleri (+ özel shader'ları, dokuları) Assets/UnityPreview/Materials/ altına yazar; beklemez. VFX gönderimi de kullanır
async function writeMaterialPayloads(project, list) {
  const dir = path.join(project, 'Assets', 'UnityPreview', 'Materials'); const texDir = path.join(dir, 'Textures'); fs.mkdirSync(texDir, { recursive: true });
  const sentAt = new Date().toISOString(); // sentAt: aynı materyali yeniden göndermek de içerik değiştirir → Unity yeniden içe alır
  const errors = {}, warnings = {}, missing = new Set(), textures = new Set(), shaders = new Map(), payloads = [];
  for (const raw of list) {
    const { material: m, warnings: w, shader } = normMat(raw); const n = m.name; const warn = [...w];
    if (!shader) { errors[n] = `shader bulunamadı: ${m.shader} (list_shaders ile bak)`; continue; }
    if (!shader.builtin) { // 3) özel shader → .shader (her shader bir kez)
      if (!shaders.has(shader.name)) { try { shaders.set(shader.name, await writeUnityShader(project, shader)); } catch (e) { shaders.set(shader.name, { name: shader.name, unityName: shader.unityName, error: String(e?.message || e) }); } }
      const sh = shaders.get(shader.name); if (sh.error) { errors[n] = 'özel shader Unity\'ye yazılamadı: ' + sh.error; continue; }
    }
    const texMap = {}; // 4) kullanılan dokular (white/black/gray/bump/@mesh ve unityPath'liler hariç)
    for (const p of shader.properties) {
      const v = p.type === 'texture' ? m.values[p.name] : null; if (!v || v.unityPath || BUILTIN_TEXTURES.includes(v.tex)) continue;
      if (v.tex === '@mesh') { warn.push(`${p.name}: '@mesh' için unityPath yok; Unity'de shader varsayılanı kalır`); continue; }
      const src = path.join(MAT_TEX_DIR, v.tex + '.png');
      if (fs.existsSync(src)) { copyIfChanged(src, path.join(texDir, v.tex + '.png')); texMap[v.tex] = `Assets/UnityPreview/Materials/Textures/${v.tex}.png`; textures.add(v.tex); } else missing.add(v.tex);
    }
    if (warn.length) warnings[n] = warn;
    payloads.push({ format: 'upe-material-export-1', name: n, sentAt, shaderName: shaderUnityName(shader), urpSurface: !!shader.urpSurface, renderQueue: m.renderQueue,
      properties: shader.properties.map((p) => ({ name: p.name, type: p.type, linear: !!p.linear })), values: m.values, textures: texMap });
  }
  const names = []; // 5) yük en son: importer shader/dokuları hazır bulur
  for (const pl of payloads) { fs.writeFileSync(path.join(dir, pl.name + '.mat.json'), JSON.stringify(pl, null, 1)); names.push(pl.name); }
  return { dir, names, errors, warnings, missing, textures, shaders };
}

async function unitySendShader({ name }) { // yalnız özel shader: .shader yaz, Unity derleme sonucunu (durum dosyası) bekle
  const project = requireUnityProject();
  const scripts = installMaterialScripts(project); // derleme sonucunu importer yazar
  let shader;
  if (name) { shader = resolveShader(name); if (!shader) throw new Error('Shader bulunamadı: ' + name + ' (list_shaders)'); }
  else { if (!state.shader) throw new Error('Gönderilecek shader yok (editörde shader boş)'); shader = normalizeShader(state.shader).shader; }
  if (shader.builtin) throw new Error(`${shader.unityName} hazır (builtin) bir Unity shader'ı; Unity'de zaten var, .shader yazılmaz. Materyali send-material ile gönder.`);
  const started = Date.now() - 1000;
  const sh = await writeUnityShader(project, shader);
  const statusFile = path.join(project, 'Assets', 'UnityPreview', 'Materials', 'last_status.txt'); const key = 'shader:' + shader.name;
  const base = { sent: [shader.name], shaders: [sh.path], shaderDetails: [sh], warnings: sh.warnings };
  if (!scripts.length) base.scriptsMissing = SCRIPTS_MISSING;
  if (!sh.changed) { // içerik aynı: Unity yeniden derlemez → son bilinen durum
    const last = readStatus(statusFile, 0).filter((l) => l.key === key); const shaderErrors = shaderErrsOf(last, shader.name);
    return { ok: !shaderErrors.length, ...base, unchanged: true, waiting: [], shaderErrors,
      note: 'Shader Unity\'de zaten güncel (değişiklik yok), yeniden derlenmedi.' + (last.length ? ` Son bilinen durum: ${last.at(-1).status}.` : '') };
  }
  let lines = [];
  for (let i = 0; i < 50 && !lines.length; i++) { await sleep(500); lines = readStatus(statusFile, started).filter((l) => l.key === key); }
  const shaderErrors = shaderErrsOf(lines, shader.name);
  const out = { ok: lines.length > 0 && !shaderErrors.length, ...base, compiled: lines.length > 0, waiting: lines.length ? [] : [shader.name], shaderErrors };
  if (shaderErrors.length) out.error = shaderErrors.map((e) => (e.line != null ? `satır ${e.line}: ` : '') + e.message).join('; ');
  else out.note = lines.length ? `Unity'de derlendi: ${sh.path}` : UNITY_WAIT_NOTE;
  return out;
}

// ── Model modu (model görüntüleyici): meshes/ genel modeller, models/ karakterler, props/ eşyalar
const MODEL_DIRS = { meshes: MESHES_DIR, models: MODELS_DIR, props: PROPS_DIR }; // arama sırası: meshes → models → props
const MODEL_EXT = /\.(fbx|glb|gltf|obj)$/i;
const listModelFiles = () => Object.fromEntries(Object.entries(MODEL_DIRS).map(([k, d]) => [k, fs.readdirSync(d).filter((f) => MODEL_EXT.test(f) && fs.statSync(path.join(d, f)).isFile()).sort()]));
const findModelFile = (name, dir) => { // ad (uzantılı ya da uzantısız, büyük/küçük harf duyarsız) → { dir, name } | null
  const files = listModelFiles(); const k = lc(path.basename(String(name ?? ''))); const bare = (f) => lc(f).replace(MODEL_EXT, '');
  for (const d of dir ? [dir] : Object.keys(MODEL_DIRS)) { const hit = files[d].find((f) => lc(f) === k) || files[d].find((f) => bare(f) === k); if (hit) return { dir: d, name: hit }; }
  return null;
};
const sameModelFile = (a, b) => !!a && !!b && a.dir === b.dir && a.name === b.name;

const clients = new Set();
const emit = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
};

const pendingRenders = new Map();
const pendingGifs = new Map();
const pendingCompiles = new Map(); // shader-compile id → çözücü (editör GLSL derleme sonucu)
const pendingModelViews = new Map(); // model-view id → çözücü (editör modeli yükleyip /api/model-view ile bildirir)

const listAnims = () => fs.readdirSync(ANIMS_DIR).filter((f) => /\.(json|fbx)$/i.test(f)).map((f) => {
  const full = path.join(ANIMS_DIR, f); const st = fs.statSync(full); const o = { file: f, name: f.replace(/\.(json|fbx)$/i, ''), kind: /\.fbx$/i.test(f) ? 'fbx' : 'json', modified: st.mtimeMs };
  if (o.kind === 'json') { try { const a = JSON.parse(fs.readFileSync(full, 'utf8')); o.fps = a.fps; o.length = a.length; o.tracks = Object.keys(a.tracks || {}).length; } catch { /* bozuk */ } }
  return o;
});

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const readJson = async (req) => JSON.parse((await readBody(req)).toString('utf8') || '{}');
const send = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const staticMaps = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/vendor/gifenc/', path.join(ROOT, 'node_modules/gifenc/')],
  ['/models/', MODELS_DIR + path.sep],
  ['/props/', PROPS_DIR + path.sep],
  ['/animations/', ANIMS_DIR + path.sep],
  ['/vfx-textures/', VFX_TEX_DIR + path.sep],
  ['/material-textures/', MAT_TEX_DIR + path.sep],
  ['/meshes/', MESHES_DIR + path.sep],
  ['/', path.join(ROOT, 'public') + path.sep],
];

function serveStatic(req, res, urlPath) {
  if (urlPath === '/') urlPath = '/index.html';
  for (const [prefix, dir] of staticMaps) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = decodeURIComponent(urlPath.slice(prefix.length));
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(path.normalize(dir))) break;
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404); res.end('not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/ping') return send(res, 200, { ok: true, version: state.version, clients: clients.size });
    if (p === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, state);
    if (p === '/api/models' && req.method === 'GET') {
      return send(res, 200, fs.readdirSync(MODELS_DIR).filter((f) => /\.(fbx|glb|gltf)$/i.test(f)));
    }
    if (p === '/api/upload-model' && req.method === 'POST') {
      const name = path.basename(url.searchParams.get('name') || 'model.fbx');
      fs.writeFileSync(path.join(MODELS_DIR, name), await readBody(req));
      return send(res, 200, { name });
    }
    if (p === '/api/export' && req.method === 'POST') { // GIF / Unity JSON çıktıları exports/ klasörüne
      const name = path.basename(url.searchParams.get('name') || 'export.bin');
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
      const file = path.join(EXPORTS_DIR, name);
      fs.writeFileSync(file, await readBody(req));
      return send(res, 200, { path: file });
    }
    if (p === '/api/animations' && req.method === 'GET') return send(res, 200, listAnims());
    if (p === '/api/animations/get' && req.method === 'GET') {
      const f = path.join(ANIMS_DIR, safeName(url.searchParams.get('name')) + '.json');
      if (!fs.existsSync(f)) return send(res, 404, { error: 'Animasyon bulunamadı' });
      return send(res, 200, JSON.parse(fs.readFileSync(f, 'utf8')));
    }
    if (p === '/api/animations/save' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name')); const body = await readJson(req);
      if (!name) return send(res, 400, { error: 'İsim gerekli' });
      fs.writeFileSync(path.join(ANIMS_DIR, name + '.json'), JSON.stringify({ ...body, name }));
      return send(res, 200, { name });
    }
    if (p === '/api/animations/delete' && req.method === 'POST') {
      const base = safeName(url.searchParams.get('name'));
      for (const ext of ['.json', '.fbx']) fs.rmSync(path.join(ANIMS_DIR, base + ext), { force: true });
      return send(res, 200, { ok: true });
    }
    if (p === '/api/upload-animation' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name') || 'anim.fbx');
      fs.writeFileSync(path.join(ANIMS_DIR, name), await readBody(req));
      return send(res, 200, { name });
    }
    if (p === '/api/claude/load-animation' && req.method === 'POST') {
      const b = await readJson(req); const base = safeName(b.name).replace(/\.(json|fbx)$/i, '');
      const jf = path.join(ANIMS_DIR, base + '.json');
      if (fs.existsSync(jf)) {
        state.anim = JSON.parse(fs.readFileSync(jf, 'utf8')); state.baseline = JSON.parse(JSON.stringify(state.anim)); state.version++; save();
        emit('anim', { anim: state.anim, version: state.version });
        return send(res, 200, { ok: true, kind: 'json' });
      }
      if (fs.existsSync(path.join(ANIMS_DIR, base + '.fbx'))) { emit('load-animation-fbx', { name: base + '.fbx' }); return send(res, 200, { ok: true, kind: 'fbx', clients: clients.size }); }
      return send(res, 404, { error: 'Kütüphanede yok: ' + b.name });
    }
    if (p === '/api/props-files' && req.method === 'GET') return send(res, 200, fs.readdirSync(PROPS_DIR).filter((f) => /\.(fbx|glb|gltf)$/i.test(f)));
    if (p === '/api/upload-prop' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name') || 'prop.glb');
      fs.writeFileSync(path.join(PROPS_DIR, name), await readBody(req));
      return send(res, 200, { name });
    }
    if (p === '/api/props' && req.method === 'POST') { state.props = (await readJson(req)).props || []; save(); return send(res, 200, { ok: true }); }
    if (p === '/api/claude/props' && req.method === 'POST') {
      state.props = (await readJson(req)).props || []; save(); emit('props', { props: state.props });
      return send(res, 200, { ok: true, clients: clients.size });
    }
    if (p === '/api/claude/gif' && req.method === 'POST') {
      if (!clients.size) return send(res, 409, { error: 'Editör tarayıcıda açık değil (http://localhost:' + PORT + ')' });
      const b = await readJson(req); const id = Math.random().toString(36).slice(2);
      const result = await new Promise((resolve) => {
        const t = setTimeout(() => { pendingGifs.delete(id); resolve(null); }, 180000);
        pendingGifs.set(id, (r) => { clearTimeout(t); resolve(r); });
        emit('gif', { id, ...b });
      });
      if (!result) return send(res, 504, { error: 'GIF zaman aşımı' });
      return send(res, 200, result);
    }
    if (p === '/api/gif-result' && req.method === 'POST') {
      const id = url.searchParams.get('id'); const name = safeName(url.searchParams.get('name') || 'anim.gif');
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
      const file = path.join(EXPORTS_DIR, name); fs.writeFileSync(file, await readBody(req));
      pendingGifs.get(id)?.({ path: file }); pendingGifs.delete(id);
      return send(res, 200, { path: file });
    }
    if (p === '/api/unity' && req.method === 'GET') return send(res, 200, unityInfo());
    if (p === '/api/unity/config' && req.method === 'POST') {
      const b = await readJson(req);
      const next = { project: b.project ? path.normalize(String(b.project).trim().replace(/^"|"$/g, '')) : state.unity.project, character: b.character ?? state.unity.character, mode: b.mode || state.unity.mode || 'Auto' };
      if (next.project && !isUnityProject(next.project)) return send(res, 400, { error: 'Burası bir Unity projesi değil (Assets ve ProjectSettings klasörleri yok): ' + next.project });
      state.unity = next; save();
      if (state.unity.project) unityInstall();
      return send(res, 200, unityInfo());
    }
    if (p === '/api/unity/send' && req.method === 'POST') {
      const b = await readJson(req);
      return send(res, 200, await unitySend(b));
    }
    // ── VFX modu
    if (p === '/api/vfx/list' && req.method === 'GET') return send(res, 200, listVfx());
    if (p === '/api/vfx/get' && req.method === 'GET') {
      const e = readVfx(url.searchParams.get('name'));
      return e ? send(res, 200, e) : send(res, 404, { error: 'Efekt bulunamadı' });
    }
    if (p === '/api/vfx/save' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name')).replace(/\.json$/i, ''); const body = await readJson(req);
      if (!name) return send(res, 400, { error: 'İsim gerekli' });
      fs.writeFileSync(vfxFile(name), JSON.stringify({ ...body, name }, null, 1));
      return send(res, 200, { name });
    }
    if (p === '/api/vfx/delete' && req.method === 'POST') { fs.rmSync(vfxFile(url.searchParams.get('name')), { force: true }); return send(res, 200, { ok: true }); }
    if (p === '/api/vfx/textures' && req.method === 'GET') return send(res, 200, listVfxTextures());
    if (p === '/api/upload-vfx-texture' && req.method === 'POST') { // ham PNG baytı; efekt dokuyu uzantısız adla anar
      const base = safeName(url.searchParams.get('name') || 'texture.png').replace(/\.png$/i, '');
      if (!base) return send(res, 400, { error: 'İsim gerekli' });
      fs.writeFileSync(path.join(VFX_TEX_DIR, base + '.png'), await readBody(req));
      return send(res, 200, { name: base, file: base + '.png' });
    }
    if (p === '/api/vfx' && req.method === 'POST') { // editörden gelen güncelleme (olay yok)
      state.vfx = await readJson(req); state.version++; save();
      return send(res, 200, { version: state.version });
    }
    if (p === '/api/vfx/baseline' && req.method === 'POST') { state.vfxBaseline = state.vfx ? JSON.parse(JSON.stringify(state.vfx)) : null; save(); return send(res, 200, { ok: true }); }
    if ((p === '/api/mode' || p === '/api/claude/mode') && req.method === 'POST') { // editör bildirir (olay yok) / Claude değiştirir (olay 'mode')
      const { mode } = await readJson(req);
      if (!MODES.includes(mode)) return send(res, 400, { error: `Geçersiz mod: ${mode} (${MODES.join('|')})` });
      state.mode = mode; save();
      if (p === '/api/claude/mode') emit('mode', { mode });
      return send(res, 200, { ok: true, mode, clients: clients.size });
    }
    if (p === '/api/claude/vfx' && req.method === 'POST') { // MCP'den gelen efekt
      const b = await readJson(req);
      if (!b.vfx || typeof b.vfx !== 'object') return send(res, 400, { error: 'vfx gerekli' });
      state.vfx = b.vfx; state.mode = 'vfx'; state.version++;
      if (b.setBaseline !== false) state.vfxBaseline = JSON.parse(JSON.stringify(b.vfx));
      save(); emit('vfx', { vfx: state.vfx });
      return send(res, 200, { clients: clients.size, version: state.version });
    }
    if (p === '/api/claude/vfx-load' && req.method === 'POST') {
      const b = await readJson(req); const raw = readVfx(b.name);
      if (!raw) return send(res, 404, { error: 'VFX kütüphanesinde yok: ' + b.name });
      const { effect, warnings } = normalizeEffect({ ...raw, name: raw.name || path.basename(vfxFile(b.name), '.json') });
      state.vfx = effect; state.vfxBaseline = JSON.parse(JSON.stringify(effect)); state.mode = 'vfx'; state.version++; save();
      emit('vfx', { vfx: state.vfx });
      return send(res, 200, { ok: true, name: effect.name, warnings, clients: clients.size });
    }
    if (p === '/api/unity/send-vfx' && req.method === 'POST') return send(res, 200, await unitySendVfx(await readJson(req)));
    // ── Shader modu: kütüphane (builtin + shaders/)
    if (p === '/api/shaders/list' && req.method === 'GET') return send(res, 200, listShaders());
    if (p === '/api/shaders/get' && req.method === 'GET') { // ad ya da unityName; working=1 → editördeki kaydedilmemiş özel kopya kütüphaneden önce
      const n = url.searchParams.get('name'); const s = url.searchParams.get('working') ? resolveShader(n) : findShader(n);
      return s ? send(res, 200, s) : send(res, 404, { error: 'Shader bulunamadı: ' + n });
    }
    if (p === '/api/shaders/save' && req.method === 'POST') { // builtin adları/unityName'leri ezilemez; builtin kopyası özel shader olur
      const body = await readJson(req); const raw = url.searchParams.get('name') || body.name; const name = customBase(raw);
      if (!name) return send(res, 400, { error: 'İsim gerekli' });
      if (isBuiltinName(raw) || isBuiltinName(name)) return send(res, 400, { error: `"${raw}" hazır (builtin) bir shader adı; ezilemez. Başka ad ver (ör. ${name}_ozel).` });
      const { shader, warnings } = normalizeShader({ ...body, name, builtin: false });
      if (body.builtin) warnings.push('builtin shader kopyası özel shader olarak kaydedildi: ' + shader.unityName);
      fs.writeFileSync(path.join(SHADERS_DIR, name + '.json'), JSON.stringify(shader, null, 1));
      return send(res, 200, { name, unityName: shader.unityName, warnings });
    }
    if (p === '/api/shaders/delete' && req.method === 'POST') {
      const raw = url.searchParams.get('name');
      if (isBuiltinName(raw)) return send(res, 400, { error: `"${raw}" hazır (builtin) bir shader; silinemez.` });
      const f = path.join(SHADERS_DIR, customBase(raw) + '.json'); const existed = !!customBase(raw) && fs.existsSync(f);
      if (existed) fs.rmSync(f, { force: true });
      return send(res, 200, { ok: true, deleted: existed });
    }
    // ── Materyal modu: kütüphane (materials/) + dokular (materials/textures/)
    if (p === '/api/materials/list' && req.method === 'GET') return send(res, 200, listMaterials());
    if (p === '/api/materials/get' && req.method === 'GET') {
      const m = readMatRaw(url.searchParams.get('name'));
      return m ? send(res, 200, m) : send(res, 404, { error: 'Materyal bulunamadı' });
    }
    if (p === '/api/materials/save' && req.method === 'POST') {
      const body = await readJson(req); const name = safeAssetName(String(url.searchParams.get('name') || body.name || '').replace(/\.json$/i, ''));
      if (!name) return send(res, 400, { error: 'İsim gerekli' });
      const { material, warnings } = normMat({ ...body, name });
      fs.writeFileSync(path.join(MAT_DIR, name + '.json'), JSON.stringify(material, null, 1));
      return send(res, 200, { name, warnings });
    }
    if (p === '/api/materials/delete' && req.method === 'POST') {
      const f = matFile(url.searchParams.get('name')); const existed = fs.existsSync(f); fs.rmSync(f, { force: true });
      return send(res, 200, { ok: true, deleted: existed });
    }
    if (p === '/api/material-textures' && req.method === 'GET') return send(res, 200, listMatTextures());
    if (p === '/api/upload-material-texture' && req.method === 'POST') { // ham PNG baytı; materyal dokuyu uzantısız adla anar
      const base = safeName(url.searchParams.get('name') || 'texture.png').replace(/\.png$/i, '').trim();
      if (!base) return send(res, 400, { error: 'İsim gerekli' });
      fs.writeFileSync(path.join(MAT_TEX_DIR, base + '.png'), await readBody(req));
      return send(res, 200, { name: base, file: base + '.png' });
    }
    // editörden gelen güncellemeler (olay yok)
    if (p === '/api/material' && req.method === 'POST') { state.material = await readJson(req); state.version++; save(); return send(res, 200, { version: state.version }); }
    if (p === '/api/material/baseline' && req.method === 'POST') { state.materialBaseline = state.material ? JSON.parse(JSON.stringify(state.material)) : null; save(); return send(res, 200, { ok: true }); }
    if (p === '/api/shader' && req.method === 'POST') { state.shader = await readJson(req); state.version++; save(); return send(res, 200, { version: state.version }); }
    if (p === '/api/shader/baseline' && req.method === 'POST') { state.shaderBaseline = state.shader ? JSON.parse(JSON.stringify(state.shader)) : null; save(); return send(res, 200, { ok: true }); }
    if ((p === '/api/lighting' || p === '/api/claude/lighting') && req.method === 'POST') { // gövde { lighting } (editör ham nesne de gönderebilir)
      const b = await readJson(req); state.lighting = normalizeLighting(b.lighting ?? b); save();
      if (p === '/api/claude/lighting') emit('lighting', { lighting: state.lighting });
      return send(res, 200, { ok: true, lighting: state.lighting, clients: clients.size });
    }
    if ((p === '/api/overrides' || p === '/api/claude/overrides') && req.method === 'POST') { // { 'hero'|'hero:<mesh>'|'prop:<id>': materyal }
      const b = await readJson(req); state.materialOverrides = normOverrides(b.overrides && typeof b.overrides === 'object' ? b.overrides : b); save();
      if (p === '/api/claude/overrides') emit('overrides', { overrides: state.materialOverrides });
      return send(res, 200, { ok: true, overrides: state.materialOverrides, clients: clients.size });
    }
    // MCP'den gelenler (olay + mod geçişi; setBaseline:false değilse kullanıcı farkı için referans olur)
    if (p === '/api/claude/material' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.material || typeof b.material !== 'object') return send(res, 400, { error: 'material gerekli' });
      state.material = b.material; state.mode = 'material'; state.version++;
      if (b.setBaseline !== false) state.materialBaseline = JSON.parse(JSON.stringify(b.material));
      save(); emit('material', { material: state.material });
      return send(res, 200, { clients: clients.size, version: state.version });
    }
    if (p === '/api/claude/shader' && req.method === 'POST') {
      const b = await readJson(req);
      if (!b.shader || typeof b.shader !== 'object') return send(res, 400, { error: 'shader gerekli' });
      state.shader = b.shader; state.mode = 'shader'; state.version++;
      if (b.setBaseline !== false) state.shaderBaseline = JSON.parse(JSON.stringify(b.shader));
      save(); emit('shader', { shader: state.shader });
      return send(res, 200, { clients: clients.size, version: state.version });
    }
    if (p === '/api/claude/material-load' && req.method === 'POST') {
      const b = await readJson(req); const raw = readMatRaw(b.name);
      if (!raw) return send(res, 404, { error: 'Materyal kütüphanesinde yok: ' + b.name });
      const { material, warnings } = normMat(raw);
      state.material = material; state.materialBaseline = JSON.parse(JSON.stringify(material)); state.mode = 'material'; state.version++; save();
      emit('material', { material });
      return send(res, 200, { ok: true, name: material.name, warnings, clients: clients.size });
    }
    if (p === '/api/claude/shader-load' && req.method === 'POST') {
      const b = await readJson(req); const shader = findShader(b.name);
      if (!shader) return send(res, 404, { error: 'Shader kütüphanesinde yok: ' + b.name });
      state.shader = shader; state.shaderBaseline = JSON.parse(JSON.stringify(shader)); state.mode = 'shader'; state.version++; save();
      emit('shader', { shader });
      return send(res, 200, { ok: true, name: shader.name, unityName: shader.unityName, builtin: shader.builtin, clients: clients.size });
    }
    if (p === '/api/claude/shader-compile' && req.method === 'POST') { // editör GLSL'e çevirip derler; ≤10 sn
      if (!clients.size) return send(res, 409, { error: 'Editör tarayıcıda açık değil (http://localhost:' + PORT + '); shader derlemesi denetlenemedi.' });
      const b = await readJson(req);
      if (!b.shader || typeof b.shader !== 'object') return send(res, 400, { error: 'shader gerekli' });
      const id = Math.random().toString(36).slice(2);
      const result = await new Promise((resolve) => {
        const t = setTimeout(() => { pendingCompiles.delete(id); resolve(null); }, 10000);
        pendingCompiles.set(id, (r) => { clearTimeout(t); resolve(r); });
        emit('shader-compile', { id, shader: b.shader });
      });
      if (!result) return send(res, 504, { error: 'Editör 10 sn içinde derleme sonucu döndürmedi (Shader modunu destekleyen editör sürümü açık mı?).' });
      return send(res, 200, result);
    }
    if (p === '/api/shader-compile-result' && req.method === 'POST') {
      const b = await readJson(req);
      pendingCompiles.get(b.id)?.({ ok: !!b.ok, errors: Array.isArray(b.errors) ? b.errors : [], warnings: Array.isArray(b.warnings) ? b.warnings : [], log: typeof b.log === 'string' ? b.log : '' }); pendingCompiles.delete(b.id);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/unity/send-material' && req.method === 'POST') return send(res, 200, await unitySendMaterial(await readJson(req)));
    if (p === '/api/unity/send-shader' && req.method === 'POST') return send(res, 200, await unitySendShader(await readJson(req)));
    // ── Model modu: dosya listesi, yükleme, editörün bildirimi, Claude'un view_model isteği
    if (p === '/api/model-files' && req.method === 'GET') return send(res, 200, listModelFiles());
    if (p === '/api/upload-mesh' && req.method === 'POST') { // ham dosya baytı → meshes/<ad>
      const name = safeName(url.searchParams.get('name'));
      if (!MODEL_EXT.test(name)) return send(res, 400, { error: `Desteklenmeyen model dosyası: ${name || '(ad yok)'} (fbx|glb|gltf|obj)` });
      fs.writeFileSync(path.join(MESHES_DIR, name), await readBody(req));
      return send(res, 200, { name });
    }
    if (p === '/api/model-view' && req.method === 'POST') { // editör bildirir (olay yok); id varsa bekleyen view_model isteğini çözer
      const b = await readJson(req);
      state.modelView = { file: b.file || null, view: b.view && typeof b.view === 'object' ? b.view : {}, info: b.info || null }; save();
      if (b.id) { pendingModelViews.get(b.id)?.(b); pendingModelViews.delete(b.id); }
      return send(res, 200, { ok: true });
    }
    if (p === '/api/claude/model-view' && req.method === 'POST') { // MCP: path (mutlak; meshes/'e kopyalanır) | name (+dir) | yalnız view; Model moduna geçer
      const b = await readJson(req); const prev = state.modelView; let file = prev?.file || null; let warning;
      if (b.dir != null && !Object.hasOwn(MODEL_DIRS, b.dir)) return send(res, 400, { error: `Geçersiz klasör: ${b.dir} (${Object.keys(MODEL_DIRS).join('|')})` });
      if (b.path) {
        const raw = String(b.path).trim().replace(/^"|"$/g, '');
        if (!path.isAbsolute(raw)) return send(res, 400, { error: 'path mutlak dosya yolu olmalı: ' + raw });
        const src = path.resolve(raw);
        if (!fs.existsSync(src)) return send(res, 404, { error: 'Dosya bulunamadı: ' + src });
        if (!fs.statSync(src).isFile()) return send(res, 400, { error: 'Dosya değil: ' + src });
        const name = safeName(path.basename(src));
        if (!MODEL_EXT.test(name)) return send(res, 400, { error: `Desteklenmeyen model biçimi: ${path.extname(src) || '(uzantı yok)'} (fbx|glb|gltf|obj)` });
        const dst = path.join(MESHES_DIR, name); if (path.relative(src, dst)) fs.copyFileSync(src, dst); // kaynak zaten meshes/<ad> ise kopyalanmaz
        file = { dir: 'meshes', name };
        if (/\.gltf$/i.test(name)) warning = '.gltf yalnız kendisi kopyalandı; harici .bin/doku dosyaları kullanıyorsa model eksik yüklenir (tek dosya GLB tercih et).';
      } else if (b.name) {
        file = findModelFile(b.name, b.dir);
        if (!file) return send(res, 404, { error: 'Model bulunamadı: ' + b.name, files: listModelFiles() });
      }
      const base = { ...(prev?.view || {}) };
      if (b.path || !sameModelFile(file, prev?.file)) for (const k of ['clip', 'hidden', 'time', 'paused']) delete base[k]; // dosyaya özgü ayarlar yeni modele taşınmaz
      const view = { ...base, ...(b.view && typeof b.view === 'object' ? b.view : {}) };
      // path ile yeniden kopyalanan dosyanın içeriği değişmiş olabilir: eski info atılır, olayda reload:true (editör aynı adı da yeniden yükler)
      state.mode = 'model'; state.modelView = { file, view, info: !b.path && sameModelFile(file, prev?.file) ? prev.info ?? null : null }; save();
      const extra = warning ? { warning } : {};
      if (!clients.size) return send(res, 200, { ok: true, clients: 0, file, view, ...extra });
      const id = Math.random().toString(36).slice(2);
      const r = await new Promise((resolve) => { // editör modeli yükleyip aynı id ile /api/model-view'e bildirir; ≤60 sn
        const t = setTimeout(() => { pendingModelViews.delete(id); resolve(null); }, 60000);
        pendingModelViews.set(id, (x) => { clearTimeout(t); resolve(x); });
        emit('model-view', { id, file, view, reload: !!b.path });
      });
      if (!r) return send(res, 200, { ok: true, clients: clients.size, timeout: true, file, view, ...extra });
      return send(res, 200, { ok: true, clients: clients.size, file: r.file || file, view: r.view || view, info: r.info || null, ...(r.error ? { error: String(r.error) } : {}), ...extra });
    }
    if (p === '/api/rig' && req.method === 'POST') {
      const b = await readJson(req);
      state.rig = b.rig; state.modelName = b.modelName; save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/anim' && req.method === 'POST') { // editörden gelen güncelleme
      state.anim = await readJson(req); state.version++; save();
      return send(res, 200, { version: state.version });
    }
    if (p === '/api/baseline' && req.method === 'POST') {
      state.baseline = JSON.parse(JSON.stringify(state.anim)); save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/note' && req.method === 'POST') { // not hangi moddan geldiğini taşır ('anim' varsayılan)
      const n = await readJson(req);
      state.notes.push({ ...n, mode: noteMode(n), time: Date.now() }); save();
      return send(res, 200, { ok: true });
    }
    if (p === '/api/notes/clear' && req.method === 'POST') { // ?mode=vfx → yalnız o moddaki notlar
      const m = url.searchParams.get('mode');
      state.notes = m ? state.notes.filter((n) => noteMode(n) !== m) : []; save(); return send(res, 200, { ok: true });
    }
    if (p === '/api/claude/anim' && req.method === 'POST') { // MCP'den gelen animasyon
      const b = await readJson(req);
      state.anim = b.anim; state.version++;
      if (b.setBaseline !== false) state.baseline = JSON.parse(JSON.stringify(b.anim));
      save(); emit('anim', { anim: state.anim, version: state.version });
      return send(res, 200, { version: state.version });
    }
    if (p === '/api/claude/load-model' && req.method === 'POST') {
      const b = await readJson(req);
      emit('load-model', b);
      return send(res, 200, { ok: true, clients: clients.size });
    }
    if (p === '/api/claude/render' && req.method === 'POST') {
      if (!clients.size) return send(res, 409, { error: 'Editör tarayıcıda açık değil (http://localhost:' + PORT + ')' });
      const b = await readJson(req);
      const id = Math.random().toString(36).slice(2);
      const result = await new Promise((resolve) => { // gövde olduğu gibi olaya geçer (kind:'vfx' / 'material' → kontak sayfası)
        const t = setTimeout(() => { pendingRenders.delete(id); resolve(null); }, 30000);
        pendingRenders.set(id, (png) => { clearTimeout(t); resolve(png); });
        emit('render', { id, ...b });
      });
      if (!result) return send(res, 504, { error: 'Render zaman aşımı' });
      return send(res, 200, { png: result });
    }
    if (p === '/api/render-result' && req.method === 'POST') {
      const b = await readJson(req);
      pendingRenders.get(b.id)?.(b.png); pendingRenders.delete(b.id);
      return send(res, 200, { ok: true });
    }
    serveStatic(req, res, p);
  } catch (e) {
    send(res, 500, { error: String(e?.message || e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`Unity Preview Editor: port ${PORT} zaten kullanımda (editör zaten çalışıyor olabilir).`); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => console.error(`Unity Preview Editor: http://localhost:${PORT}`));
