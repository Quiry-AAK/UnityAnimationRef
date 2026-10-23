// Unity Preview Editor sunucusu (eski adı Anim Ref): statik dosyalar + state API + SSE (editör <-> MCP köprüsü).
// Modlar: animasyon + VFX (sözleşme: docs/VFX.md). Unity'ye animasyon (.anim) ve VFX (prefab) gönderimi.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEffect } from './public/vfx-schema.js';

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
for (const d of [ANIMS_DIR, PROPS_DIR, VFX_DIR, VFX_TEX_DIR]) fs.mkdirSync(d, { recursive: true });
const safeName = (n) => path.basename(String(n || '')).replace(/[^\w .-]+/g, '_');
fs.mkdirSync(MODELS_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.fbx': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.map': 'application/json',
};

// mode: editörün açık modu; vfx: editördeki efekt; vfxBaseline: Claude'un son verdiği hâl (kullanıcı farkı buna göre)
let state = { rig: null, modelName: null, anim: null, baseline: null, notes: [], props: [], version: 0, mode: 'anim', vfx: null, vfxBaseline: null };
fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
try { state = { ...state, ...JSON.parse(fs.readFileSync(fs.existsSync(STATE_FILE) ? STATE_FILE : MAIN_STATE, 'utf8')) }; } catch { /* ilk çalıştırma */ }
const MODES = ['anim', 'vfx']; // ileride 'shader'
if (!MODES.includes(state.mode)) state.mode = 'anim';
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
  const started = Date.now() - 1000; const names = []; const missing = new Set(); const textures = new Set(); const warnings = {};
  const effects = list.map((src) => {
    const { effect, warnings: w } = normalizeEffect(src);
    const base = safeName(effect.name || 'vfx').replace(/\s+/g, '_'); effect.name = base; // prefab adı = dosya adı = efekt adı
    if (w.length) warnings[base] = w;
    for (const em of effect.emitters) {
      const t = em.renderer.texture; if (!t || textures.has(t)) continue; textures.add(t);
      const s = path.join(VFX_TEX_DIR, t + '.png');
      if (fs.existsSync(s)) copyIfChanged(s, path.join(texDir, t + '.png')); else missing.add(t);
    }
    return effect;
  });
  for (const effect of effects) { fs.writeFileSync(path.join(dir, effect.name + '.vfx.json'), JSON.stringify(effect, null, 1)); names.push(effect.name); } // json en son: importer dokuları hazır bulur
  // 4) Unity açıksa importer prefab'ı üretir: ≤ 20 sn bekle, last_status.txt (ad|OK|yol | ad|ERROR|mesaj) oku
  const pending = new Set(names); const done = []; const errors = {}; const statusFile = path.join(dir, 'last_status.txt');
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
  if (Object.keys(warnings).length) out.warnings = warnings;
  if (!scripts.length) out.scriptsMissing = 'unity/UnityPreviewVfx*.cs bulunamadı; Unity tarafında importer kurulu değilse prefab üretilmez.';
  if (Object.keys(errors).length) { out.errors = errors; out.error = Object.entries(errors).map(([n, m]) => n + ': ' + m).join('; '); }
  else out.note = pending.size ? 'Unity açık değil ya da odakta değil; Unity\'ye geçince / açılınca prefab otomatik üretilir (batchmode: -executeMethod UnityPreviewVfxImporter.ProcessPending).' : 'Unity\'ye aktarıldı.';
  return out;
}

const clients = new Set();
const emit = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(msg);
};

const pendingRenders = new Map();
const pendingGifs = new Map();

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
      const result = await new Promise((resolve) => { // gövde olduğu gibi olaya geçer (kind:'vfx' → kontak sayfası)
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
