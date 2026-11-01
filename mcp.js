// Unity Preview Editor MCP sunucusu (stdio; eski adı Anim Ref). Editör sunucusuna (server.js) HTTP ile bağlanır; çalışmıyorsa başlatır.
// Araçlar: animasyon (anahtar kare, eşya, Unity .anim) + VFX (parçacık efekti, kontak sayfası render, Unity prefab; docs/VFX.md)
// + materyal/shader (UPE-SL shader, materyal, ışık, giydirme, Unity .mat/.shader; docs/MATERIAL.md) + model görüntüleyici (GLB/FBX/OBJ; Model sekmesi).
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as THREE from 'three';
import { normalizeEffect, applyChanges, diffEffects, presetEmitter, defaultEffect, findEmitter, getPath, PRESETS, TEXTURES, VFX_REFERENCE } from './public/vfx-schema.js';
import { normalizeShader, normalizeMaterial, applyShaderChanges, applyMaterialChanges, diffShaders, diffObjects, normalizeLighting, defaultLighting, shaderUnityName, defaultShader, clone, SHADER_REFERENCE, MATERIAL_REFERENCE, BUILTIN_TEXTURES, PREVIEW_TARGETS } from './public/shader-schema.js';
import { BUILTIN_SHADERS, TEMPLATES } from './public/shader-builtins.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Her MCP süreci (= her chat) kendi editör portunu alır; UPE_PORT (yoksa ANIMREF_PORT) verilirse o sabit kullanılır (ör. 5177 elle açılan editör).
const FIXED_PORT = process.env.UPE_PORT || process.env.ANIMREF_PORT;
const freePort = (port) => new Promise((ok) => { const s = net.createServer(); s.once('error', () => ok(false)); s.listen(port, '127.0.0.1', () => s.close(() => ok(true))); });
let lockFile = null;
async function pickPort() {
  if (FIXED_PORT) return Number(FIXED_PORT);
  const dir = path.join(ROOT, '.ports'); fs.mkdirSync(dir, { recursive: true });
  for (let p = 5178; p < 5278; p++) {
    const lock = path.join(dir, p + '.lock');
    try { const pid = Number(fs.readFileSync(lock, 'utf8')); try { process.kill(pid, 0); continue; } catch { fs.unlinkSync(lock); } } catch { /* kilit yok */ }
    try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); } catch { continue; }
    if (await freePort(p)) { lockFile = lock; return p; }
    fs.unlinkSync(lock);
  }
  throw new Error('Boş editör portu yok');
}
const PORT = await pickPort();
const BASE = `http://127.0.0.1:${PORT}`;
let child = null;
const stopChild = () => { try { child?.kill(); } catch { /* yok */ } try { if (lockFile) fs.unlinkSync(lockFile); } catch { /* yok */ } };
process.on('exit', stopChild);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopChild(); process.exit(0); });
process.stdin.on('end', () => { stopChild(); process.exit(0); });
const EXPORTS = path.join(ROOT, 'exports');

const get = (p) => fetch(BASE + p).then((r) => r.json());
const getOk = async (p) => { const r = await fetch(BASE + p); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; };
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
};
async function ensureServer() {
  try { await get('/api/ping'); return; } catch { /* başlat */ }
  child = spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, stdio: 'ignore', windowsHide: true, env: { ...process.env, UPE_PORT: String(PORT) } });
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 200)); try { await get('/api/ping'); return; } catch { /* bekle */ } }
  throw new Error('Editör sunucusu başlatılamadı');
}

// ── animasyon matematiği
const A = new THREE.Quaternion(), B = new THREE.Quaternion();
function evalRot(arr, f, out) {
  if (!arr?.length) return null;
  if (f <= arr[0][0]) return out.set(arr[0][1], arr[0][2], arr[0][3], arr[0][4]);
  const last = arr.at(-1);
  if (f >= last[0]) return out.set(last[1], last[2], last[3], last[4]);
  let i = 0; while (arr[i + 1][0] <= f) i++;
  const a = arr[i], b = arr[i + 1], t = (f - a[0]) / (b[0] - a[0]);
  A.set(a[1], a[2], a[3], a[4]); B.set(b[1], b[2], b[3], b[4]);
  return out.copy(A).slerp(B, t);
}
const deg = THREE.MathUtils.radToDeg, rad = THREE.MathUtils.degToRad;
const eulerDeg = (q) => { const e = new THREE.Euler().setFromQuaternion(q, 'XYZ'); return [deg(e.x), deg(e.y), deg(e.z)].map((v) => +v.toFixed(2)); };
function putKey(arr, key) {
  const i = arr.findIndex((k) => k[0] >= key[0]);
  if (i === -1) arr.push(key); else if (arr[i][0] === key[0]) arr[i] = key; else arr.splice(i, 0, key);
}
const requireAnim = (st) => { if (!st.anim) throw new Error('Henüz animasyon yok. Önce set_animation / set_keys kullan veya editörde bir şey oluştur.'); return st.anim; };
const restOf = (st, name) => { const b = st.rig?.bones.find((x) => x.name === name); if (!b) throw new Error(`Kemik bulunamadı: ${name}`); return b; };
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 1) }] });

const server = new McpServer({ name: 'unity-preview-editor', version: '2.0.0' });

// ── VFX yardımcıları (mantık public/vfx-schema.js'de; burada yalnız editörle alışveriş)
const notesOf = (st, mode) => (st.notes || []).filter((n) => (n.mode || 'anim') === mode);
const curVfx = (st) => (st.vfx ? normalizeEffect(st.vfx).effect : null);
const vfxSummary = (e) => (e ? {
  name: e.name, duration: e.duration, loop: e.loop, attach: e.attach.target === 'none' ? undefined : e.attach,
  emitters: e.emitters.map((m) => ({ name: m.name, enabled: m.enabled, rateOverTime: m.emission.rateOverTime, bursts: m.emission.bursts.length, ...(m.renderer.material ? { material: m.renderer.material } : { texture: m.renderer.texture }) })),
} : null);
// emitter içinde { preset:'fire', ...üzerineYazılanlar } kısayolu → presetEmitter ile açılır
const expandPresets = (effect) => (Array.isArray(effect?.emitters)
  ? { ...effect, emitters: effect.emitters.map((em) => (em && typeof em === 'object' && em.preset ? (({ preset, ...rest }) => presetEmitter(preset, rest))(em) : em)) } : effect);
const pushVfx = async (effect, setBaseline = true) => (await post('/api/claude/vfx', { vfx: effect, setBaseline })).clients > 0;

// ── Materyal/Shader yardımcıları (mantık public/shader-schema.js'de)
const enc = encodeURIComponent;
const pathGet = (o, p) => String(p).split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
// shader çözümü (ad ya da unityName): builtin → editördeki kaydedilmemiş özel çalışma kopyası → shaders/
const shaderByName = async (n) => (n ? fetch(BASE + '/api/shaders/get?working=1&name=' + enc(n)).then((r) => (r.ok ? r.json() : null), () => null) : null);
const shaderNames = async () => (await get('/api/shaders/list').catch(() => [])).map((s) => s.unityName).join(', ');
const requireShaderOf = async (n) => { const s = await shaderByName(n); if (!s) throw new Error(`Shader bulunamadı: ${n}. Var olanlar: ${await shaderNames()}`); return s; };
const curShader = (st) => (st.shader ? normalizeShader(st.shader).shader : null);
const curMaterial = async (st) => { if (!st.material) return null; const shader = await shaderByName(st.material.shader); return { ...normalizeMaterial(st.material, shader), shader }; };
const shaderSummary = (s) => (s ? { name: s.name, unityName: s.unityName, builtin: s.builtin, properties: s.properties.map((p) => `${p.name}:${p.type}`), renderState: s.renderState, outline: s.outline.enabled ? s.outline : undefined, urpSurface: s.urpSurface || undefined } : null);
const materialSummary = (m) => (m ? { name: m.name, shader: m.shader, target: m.preview.target, renderQueue: m.renderQueue, values: m.values } : null);
const pushMaterial = async (m, setBaseline = true) => (await post('/api/claude/material', { material: m, setBaseline })).clients > 0;
const pushShader = async (s, setBaseline = true) => (await post('/api/claude/shader', { shader: s, setBaseline })).clients > 0;
async function compileCheck(shader) { // editör (tarayıcı) UPE-SL → GLSL çevirip derler; tarayıcı yoksa denetlenemez
  const ping = await get('/api/ping').catch(() => ({ clients: 0 }));
  if (!ping.clients) return { checked: false, note: `Shader editör durumuna kaydedildi ama editör tarayıcıda açık değil (${BASE}); GLSL derlemesi denetlenemedi. Editörü açınca kendisi derler; sonra update_shader/set_shader ile yeniden denetleyebilirsin.` };
  try { const r = await post('/api/claude/shader-compile', { shader }); return { checked: true, ok: !!r.ok, errors: r.errors || [], ...(r.warnings?.length ? { warnings: r.warnings } : {}), ...(r.log ? { log: r.log } : {}) }; }
  catch (e) { return { checked: false, note: 'Derleme denetlenemedi: ' + e.message }; }
}
const shaderPathGet = (s, p) => { const m = /^properties\.([^.]+)(?:\.(.+))?$/.exec(p); if (!m) return pathGet(s, p); const pr = s.properties.find((x) => x.name === m[1]); return m[2] ? pathGet(pr, m[2]) : (pr ?? null); };
const BUILTIN_EDIT_WARN = `Bu hazır (builtin) bir shader: değişiklikler yalnız önizlemede, Unity'ye .shader yazılmaz. Kalıcı/Unity'ye gidecek sürüm için save_shader { name:"<yeni_ad>" } ile özel kopya oluştur (UnityPreview/<yeni_ad>).`;
const shownValue = (p, v) => (typeof v === 'string' && /^code\./.test(p) ? `(${v.length} karakter)` : v);

// ── Model modu yardımcıları (bilgiyi editör ölçer; info biçimi public/model.js)
const countOf = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v);
const clipName = (c) => (typeof c === 'string' ? c : c?.name);
const modelInfoSummary = (i) => (i && typeof i === 'object' ? { // büyük parts/textures listeleri olmadan
  size: i.size, triangles: i.triangles, vertices: i.vertices, meshes: countOf(i.meshes ?? i.parts), materials: countOf(i.materials), textures: countOf(i.textures),
  bones: countOf(i.bones), clips: Array.isArray(i.clips) ? i.clips.map(clipName) : i.clips,
} : null);
const modelViewSummary = (mv) => (mv ? { file: mv.file ?? null, view: mv.view ?? {}, info: modelInfoSummary(mv.info) } : null);
const LIST_CAP = 100; // view_model yanıtında uzun listeler kırpılır (tamamı get_model_view'da)
const capInfo = (i) => (i && typeof i === 'object' ? Object.fromEntries(Object.entries(i).map(([k, v]) => [k, Array.isArray(v) && v.length > LIST_CAP ? [...v.slice(0, LIST_CAP), `… +${v.length - LIST_CAP} daha (get_model_view)`] : v])) : i);

server.registerTool('get_status', {
  description: 'Editörün durumu: açık mod (anim|vfx|material|shader|model), model, kemik listesi, animasyon özeti, VFX özeti (ad, süre, emitter başına ad/enabled/rateOverTime/burst sayısı/doku), materyal özeti (ad, shader, önizleme hedefi, değerler), shader özeti (ad, unityName, builtin, özellikler, renderState), giydirmeler (materialOverrides), sahne ışığı, Model sekmesi özeti (modelView: dosya, görünüm ayarları, boyut/üçgen/köşe/parça/materyal/kemik sayısı, animasyon adları), mod başına kullanıcı notu sayısı. Önce bunu çağır.',
  inputSchema: {},
}, async () => {
  await ensureServer(); const st = await get('/api/state'); const ping = await get('/api/ping');
  const a = st.anim; const mat = await curMaterial(st);
  return text({
    editorUrl: BASE, browserConnected: ping.clients > 0, mode: st.mode || 'anim', model: st.modelName,
    bones: st.rig?.bones.map((b) => b.name + (b.parent ? ` (<- ${b.parent})` : '')) ?? [],
    unitScale: st.rig?.unitScale,
    anim: a ? { name: a.name, fps: a.fps, length: a.length, loop: a.loop, tracks: Object.fromEntries(Object.entries(a.tracks).map(([k, t]) => [k, { rotKeys: t.rot?.length ?? 0, posKeys: t.pos?.length ?? 0 }])) } : null,
    vfx: vfxSummary(curVfx(st)),
    material: mat ? { ...materialSummary(mat.material), shaderFound: !!mat.shader } : null,
    shader: shaderSummary(curShader(st)),
    overrides: st.materialOverrides || {}, lighting: normalizeLighting(st.lighting), modelView: modelViewSummary(st.modelView),
    pendingNotes: notesOf(st, 'anim').length, pendingVfxNotes: notesOf(st, 'vfx').length,
    pendingMaterialNotes: notesOf(st, 'material').length, pendingShaderNotes: notesOf(st, 'shader').length, pendingModelNotes: notesOf(st, 'model').length,
  });
});

server.registerTool('get_animation', {
  description: 'Mevcut animasyonun ham verisi. Anahtarlar: tracks[bone].rot = [[frame,x,y,z,w],...] (local quaternion, Mixamo/three uzayı), pos = [[frame,x,y,z]]. Büyük olabilir; bones ile filtrele.',
  inputSchema: { bones: z.array(z.string()).optional().describe('Sadece bu kemikler (tam isim)') },
}, async ({ bones }) => {
  await ensureServer(); const st = await get('/api/state'); const a = requireAnim(st);
  const tracks = bones ? Object.fromEntries(bones.filter((b) => a.tracks[b]).map((b) => [b, a.tracks[b]])) : a.tracks;
  return text({ ...a, tracks });
});

server.registerTool('set_animation', {
  description: 'Animasyonun tamamını değiştirir (editör anında güncellenir, kullanıcı Ctrl+Z ile geri alabilir). Bu aynı zamanda diff için "referans" olur: kullanıcının sonraki edit\'leri bununla kıyaslanır.',
  inputSchema: {
    name: z.string().optional(), fps: z.number().default(30), length: z.number().int().min(2).describe('Toplam kare sayısı'), loop: z.boolean().default(true),
    tracks: z.record(z.string(), z.object({ rot: z.array(z.array(z.number()).length(5)).optional(), pos: z.array(z.array(z.number()).length(4)).optional() })),
  },
}, async (anim) => {
  await ensureServer(); await post('/api/claude/anim', { anim: { name: anim.name || 'claude-anim', ...anim } });
  return text(`Animasyon güncellendi: ${Object.keys(anim.tracks).length} track, ${anim.length} kare.`);
});

server.registerTool('set_keys', {
  description: 'Euler (derece, local, XYZ) ile kemik key\'leri koy/değiştir. mode "set": kemiğin local rotasyonunu bu değere ayarlar (rest poza göre DEĞİL, doğrudan local euler). mode "offset": o karedeki mevcut pozun üstüne ebeveyn uzayında ekler (rest pozdan sapma vermek için en kolayı bu). Hips için position da verilebilir.',
  inputSchema: {
    keys: z.array(z.object({
      bone: z.string(), frame: z.number().int().min(0),
      euler: z.tuple([z.number(), z.number(), z.number()]).optional(), mode: z.enum(['set', 'offset']).default('offset'),
      position: z.tuple([z.number(), z.number(), z.number()]).optional().describe('local position (model birimi, Mixamo\'da cm)'),
    })),
    length: z.number().int().optional().describe('Kare sayısını güncelle'), fps: z.number().optional(), loop: z.boolean().optional(), name: z.string().optional(),
  },
}, async ({ keys, length, fps, loop, name }) => {
  await ensureServer(); const st = await get('/api/state');
  const anim = st.anim || { name: 'claude-anim', fps: 30, length: 60, loop: true, tracks: {} };
  if (length) anim.length = length; if (fps) anim.fps = fps; if (loop !== undefined) anim.loop = loop; if (name) anim.name = name;
  const q = new THREE.Quaternion();
  for (const k of keys) {
    const b = restOf(st, k.bone); const t = (anim.tracks[k.bone] ||= {});
    if (k.euler) {
      const d = new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(k.euler[0]), rad(k.euler[1]), rad(k.euler[2]), 'XYZ'));
      let out = d;
      if (k.mode === 'offset') { const cur = evalRot(t.rot, k.frame, q) ? q.clone() : new THREE.Quaternion(...b.restQ); out = d.clone().multiply(cur); }
      t.rot ||= []; if (!t.rot.length && k.frame !== 0) t.rot.push([0, ...b.restQ]);
      putKey(t.rot, [k.frame, out.x, out.y, out.z, out.w]);
    }
    if (k.position) { t.pos ||= []; if (!t.pos.length && k.frame !== 0) t.pos.push([0, ...b.restP]); putKey(t.pos, [k.frame, ...k.position]); }
  }
  await post('/api/claude/anim', { anim });
  return text(`${keys.length} key işlendi. Toplam track: ${Object.keys(anim.tracks).length}.`);
});

server.registerTool('clear_keys', {
  description: 'Bir kemiğin track\'ini (veya belirli karelerdeki key\'lerini) siler. bone verilmezse tüm animasyon temizlenir.',
  inputSchema: { bone: z.string().optional(), frames: z.array(z.number().int()).optional() },
}, async ({ bone, frames }) => {
  await ensureServer(); const st = await get('/api/state'); const anim = requireAnim(st);
  if (!bone) anim.tracks = {};
  else if (!frames) delete anim.tracks[bone];
  else { const t = anim.tracks[bone]; if (t) for (const k of ['rot', 'pos']) if (t[k]) t[k] = t[k].filter((x) => !frames.includes(x[0])); }
  await post('/api/claude/anim', { anim, setBaseline: false });
  return text('Silindi.');
});

server.registerTool('sample_pose', {
  description: 'Belirli karedeki poz: her animasyonlu kemik için local euler (derece). Küçük düzeltme yapmadan önce mevcut değeri görmek için.',
  inputSchema: { frame: z.number(), bones: z.array(z.string()).optional() },
}, async ({ frame, bones }) => {
  await ensureServer(); const st = await get('/api/state'); const anim = requireAnim(st);
  const q = new THREE.Quaternion(); const out = {};
  for (const [n, t] of Object.entries(anim.tracks)) { if (bones && !bones.includes(n)) continue; if (t.rot?.length) { evalRot(t.rot, frame, q); out[n] = eulerDeg(q); } }
  return text(out);
});

server.registerTool('get_user_edits', {
  description: 'Kullanıcının editörde yaptığı küçük edit\'ler: referans animasyona (en son set_animation/set_keys veya "Referans al") göre değişen key\'ler (parent-uzayı euler delta, derece) + kullanıcının yazdığı notlar. Kullanıcı "şunu düzelttim" dediğinde bunu çağır. Edit\'ten sonra bu farkları kendi animasyonlarına uygula.',
  inputSchema: { acknowledge: z.boolean().default(false).describe('true: notları temizle ve mevcut hali yeni referans yap') },
}, async ({ acknowledge }) => {
  await ensureServer(); const st = await get('/api/state'); const cur = st.anim, base = st.baseline;
  const result = { notes: notesOf(st, 'anim').map((n) => ({ frame: n.frame, bone: n.bone, text: n.text })), changes: [], addedKeys: {}, removedKeys: {} };
  if (cur && base) {
    const names = new Set([...Object.keys(cur.tracks), ...Object.keys(base.tracks)]);
    const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
    for (const n of names) {
      const fc = new Set((cur.tracks[n]?.rot || []).map((k) => k[0])), fb = new Set((base.tracks[n]?.rot || []).map((k) => k[0]));
      const added = [...fc].filter((f) => !fb.has(f)), removed = [...fb].filter((f) => !fc.has(f));
      if (added.length) result.addedKeys[n] = added; if (removed.length) result.removedKeys[n] = removed;
      for (const f of [...new Set([...fc, ...fb])].sort((a, b) => a - b)) {
        const c = evalRot(cur.tracks[n]?.rot, f, q1) ? q1.clone() : null, b = evalRot(base.tracks[n]?.rot, f, q2) ? q2.clone() : null;
        if (!c || !b) continue;
        const d = c.multiply(b.invert()); const ang = deg(2 * Math.acos(Math.min(1, Math.abs(d.w))));
        if (ang > 0.5) result.changes.push({ bone: n, frame: f, deltaEulerDeg: eulerDeg(d), angleDeg: +ang.toFixed(1) });
      }
    }
    for (const k of ['fps', 'length', 'loop']) if (cur[k] !== base[k]) result.changes.push({ setting: k, from: base[k], to: cur[k] });
  } else result.info = 'Referans yok (henüz set_animation yapılmamış).';
  if (acknowledge) { await post('/api/notes/clear?mode=anim'); await post('/api/baseline'); }
  return text(result);
});

server.registerTool('render_frame', {
  description: 'Editördeki karakterin belirli karesini PNG olarak render eder (tarayıcıda editör açık olmalı). Animasyonu görsel kontrol için kullan.',
  inputSchema: {
    frame: z.number().optional(), size: z.number().int().min(128).max(1024).default(512), bg: z.string().default('#ffffff'),
    camera: z.object({ position: z.tuple([z.number(), z.number(), z.number()]).optional(), target: z.tuple([z.number(), z.number(), z.number()]).optional() }).optional()
      .describe('Varsayılan kamera (2.2,1.4,3.4) → (0,0.9,0). Yan görünüm için position [4,1.2,0]'),
  },
}, async (args) => {
  await ensureServer(); const r = await post('/api/claude/render', args);
  return { content: [{ type: 'image', data: r.png.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' }] };
});

server.registerTool('list_models', { description: 'models/ klasöründeki karakterler.', inputSchema: {} }, async () => { await ensureServer(); return text(await get('/api/models')); });
server.registerTool('load_model', {
  description: 'Editörde karakteri değiştirir ("demo" = prosedürel iskelet). Mevcut animasyon ve takılı eşyalar korunur (kemik adları eşleşiyorsa). Modeli önce models/ klasörüne koy.',
  inputSchema: { name: z.string() },
}, async ({ name }) => { await ensureServer(); const r = await post('/api/claude/load-model', { name }); return text(r.clients ? 'Yükleniyor.' : 'Editör tarayıcıda açık değil; açılınca son model yüklenir.'); });



// ── animasyon kütüphanesi
const flat = (anim) => Object.entries(anim.tracks || {}).map(([bone, t]) => ({ bone, rot: (t.rot || []).flat(), pos: (t.pos || []).flat() }));
const safe = (n) => String(n).replace(/[^\w .-]+/g, '_');
const findBone = (st, n) => { const b = st.rig?.bones.find((x) => x.name === n) || st.rig?.bones.find((x) => x.name.replace(/^mixamorig:?/, '') === n.replace(/^mixamorig:?/, '')); if (!b) throw new Error('Kemik bulunamadı: ' + n + ' (get_status ile listele)'); return b; };

server.registerTool('list_animations', {
  description: 'Animasyon kütüphanesi (animations/ klasörü): kayıtlı animasyonlar (json = düzenlenebilir, fbx = Mixamo dosyası; yüklenince bake edilir).',
  inputSchema: {},
}, async () => { await ensureServer(); return text(await get('/api/animations')); });

server.registerTool('save_animation', {
  description: 'Animasyonu kütüphaneye kaydeder. animation verilmezse editördeki mevcut animasyon kaydedilir.',
  inputSchema: {
    name: z.string(),
    animation: z.object({ fps: z.number(), length: z.number().int(), loop: z.boolean().default(true), tracks: z.record(z.string(), z.any()) }).optional(),
  },
}, async ({ name, animation }) => {
  await ensureServer(); const st = await get('/api/state'); const anim = animation || requireAnim(st);
  const r = await post('/api/animations/save?name=' + encodeURIComponent(safe(name)), anim);
  return text('Kaydedildi: ' + r.name);
});

server.registerTool('load_animation', {
  description: 'Kütüphaneden bir animasyonu editöre yükler. Karakterden bağımsızdır: kemik adları eşleşen herhangi bir Mixamo karakterinde çalışır. fbx girdileri tarayıcıda bake edilir (editör açık olmalı).',
  inputSchema: { name: z.string() },
}, async ({ name }) => { await ensureServer(); const r = await post('/api/claude/load-animation', { name }); return text(r.kind === 'fbx' ? 'FBX bake ediliyor (editörde).' : 'Yüklendi.'); });

server.registerTool('compare_animations', {
  description: 'Kütüphanedeki animasyonları (json) editördeki ana karakterin yanında, her biri kendi kopyasında yan yana ve aynı anda oynatır; adları kafalarının üstünde yazar. Kullanıcı editördeki listeden ekleyip çıkarabilir. Ana animasyon değişmez. Boş liste karşılaştırmayı kapatır.',
  inputSchema: {
    names: z.array(z.string()).describe('Kütüphane adları, sırayla (satırda 8 yuva, ilki ana karakter; sonraki satırlar arkaya)'),
    tags: z.record(z.string(), z.string()).optional().describe('ad → kısa etiket (ör. "oyunda: L1"), adın altında ikinci satırda yazar'),
  },
}, async ({ names, tags }) => {
  await ensureServer(); const r = await post('/api/compare', { names, tags });
  return text({ showing: r.names, tags: r.tags, missing: r.missing, editorOpen: r.clients > 0 });
});

server.registerTool('delete_animation', {
  description: 'Kütüphaneden animasyonu siler (geri alınamaz; kullanıcı istemeden çağırma).',
  inputSchema: { name: z.string() },
}, async ({ name }) => { await ensureServer(); await post('/api/animations/delete?name=' + encodeURIComponent(safe(name))); return text('Silindi.'); });

// ── eşyalar
server.registerTool('list_props', {
  description: 'Takılabilir eşyalar: yerleşik (builtin:pistol, builtin:rifle, builtin:sword, builtin:box) + props/ klasöründeki GLB/FBX dosyaları, ve şu an takılı olanlar.',
  inputSchema: {},
}, async () => {
  await ensureServer(); const st = await get('/api/state');
  return text({ builtin: ['builtin:pistol', 'builtin:rifle', 'builtin:sword', 'builtin:box'], files: await get('/api/props-files'), attached: st.props });
});

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const propSchema = {
  position: vec3.optional().describe('Metre; kemiğin REST (T-pose) dünya eksenlerinde: +X karakterin solu, +Y yukarı, +Z ileri'),
  rotation: vec3.optional().describe('Derece (XYZ euler), aynı eksenlerde. Eşya modelinin +Z ucu "ileri" (namlu), +Y "yukarı". Varsayılan: sağ el [0,0,-90], sol el [0,0,90] (namlu ileri, kabza parmak yönünde)'),
  scale: z.number().optional().describe('Ölçek çarpanı (yerleşikler doğal boyutta=1; dosya eşyaları 1 metreye normalize edilir, varsayılan 0.3)'),
};
server.registerTool('attach_prop', {
  description: 'Karaktere eşya (silah vb.) takar. bone: "RightHand", "LeftHand" gibi kısa ad veya tam ad. Takıldıktan sonra render_frame ile kontrol et ve position/rotation ile ince ayar yap (update_prop).',
  inputSchema: { prop: z.string(), bone: z.string().default('RightHand'), id: z.string().optional(), ...propSchema },
}, async ({ prop, bone, id, position, rotation, scale }) => {
  await ensureServer(); const st = await get('/api/state'); const b = findBone(st, bone);
  const props = (st.props || []).filter((p) => p.id !== id);
  const rot = rotation || (/RightHand$/.test(b.name) ? [0, 0, -90] : /LeftHand$/.test(b.name) ? [0, 0, 90] : [0, 0, 0]);
  const a = { id: id || Math.random().toString(36).slice(2, 8), prop, bone: b.name, pos: position || [0, 0, 0], rot, scale: scale ?? (prop.startsWith('builtin:') ? 1 : 0.3) };
  props.push(a); const r = await post('/api/claude/props', { props });
  return text({ attached: a, browserConnected: r.clients > 0 });
});

server.registerTool('update_prop', {
  description: 'Takılı eşyanın konum/dönüş/ölçeğini veya bağlı olduğu kemiği değiştirir.',
  inputSchema: { id: z.string(), bone: z.string().optional(), ...propSchema },
}, async ({ id, bone, position, rotation, scale }) => {
  await ensureServer(); const st = await get('/api/state'); const props = st.props || [];
  const a = props.find((p) => p.id === id); if (!a) throw new Error('Eşya bulunamadı: ' + id);
  if (bone) a.bone = findBone(st, bone).name; if (position) a.pos = position; if (rotation) a.rot = rotation; if (scale !== undefined) a.scale = scale;
  await post('/api/claude/props', { props }); return text({ updated: a });
});

server.registerTool('detach_prop', {
  description: 'Eşyayı kaldırır. id verilmezse tüm eşyalar kaldırılır.',
  inputSchema: { id: z.string().optional() },
}, async ({ id }) => {
  await ensureServer(); const st = await get('/api/state');
  await post('/api/claude/props', { props: id ? (st.props || []).filter((p) => p.id !== id) : [] }); return text('Kaldırıldı.');
});

// ── dışa aktarma
server.registerTool('export_gif', {
  description: 'Mevcut animasyonu GIF olarak exports/ klasörüne yazar (editör tarayıcıda açık olmalı). Yol döner.',
  inputSchema: { size: z.number().int().min(64).max(1024).default(400), fps: z.number().min(1).max(50).default(25), transparent: z.boolean().default(false), bg: z.string().default('#ffffff'), name: z.string().optional() },
}, async (args) => { await ensureServer(); return text(await post('/api/claude/gif', args)); });

server.registerTool('export_for_unity', {
  description: 'Unity için exports/<ad>.animref.json yazar (Unity: Tools > Anim Ref > Import veya AnimRefImporter.ImportByPaths .anim üretir). animation: kütüphaneden bu animasyonu dışa aktar (yoksa mevcut). all: kütüphanedeki TÜM json animasyonları. Eşya bilgisi (props) JSON\'a eklenir. Yol(lar)ı döner.',
  inputSchema: { animation: z.string().optional(), all: z.boolean().default(false) },
}, async ({ animation, all }) => {
  await ensureServer(); const st = await get('/api/state');
  if (!st.rig) throw new Error('Rig bilgisi yok; editörde bir model yükle.');
  const list = [];
  if (all) { for (const it of await get('/api/animations')) if (it.kind === 'json') list.push(await get('/api/animations/get?name=' + encodeURIComponent(it.name))); }
  else if (animation) list.push(await get('/api/animations/get?name=' + encodeURIComponent(animation)));
  else list.push(requireAnim(st));
  fs.mkdirSync(EXPORTS, { recursive: true });
  const paths = list.map((anim) => {
    const payload = { format: 'animref-1', name: anim.name, fps: anim.fps, length: anim.length, loop: anim.loop, unitScale: st.rig.unitScale, bones: st.rig.bones, props: st.props || [], trackList: flat(anim) };
    const file = path.join(EXPORTS, safe(anim.name || 'anim').replace(/\s+/g, '_') + '.animref.json');
    fs.writeFileSync(file, JSON.stringify(payload)); return file;
  });
  return text({ paths });
});


// ── Unity'ye tek adımda gönderim
server.registerTool('get_unity_info', {
  description: 'Unity entegrasyonu durumu: ayarlı proje klasörü, seçili karakter, Unity projesindeki karakter adayları (fbx/prefab).',
  inputSchema: {},
}, async () => { await ensureServer(); return text(await get('/api/unity')); });

server.registerTool('set_unity_project', {
  description: 'Unity proje klasörünü ve karakterini ayarlar (bir kez yapılır; VFX gönderimi için yalnız project yeter). Importer scriptleri projeye otomatik kurulur/güncellenir. character: Unity içindeki yol, örn. "Assets/Characters/YBot.fbx" (get_unity_info ile adayları gör). mode: Auto (önerilen; Humanoid avatar varsa Humanoid yoksa Generic) | Generic (birebir, avatarı Generic olmalı) | Humanoid.',
  inputSchema: { project: z.string().describe('Unity proje klasörü (içinde Assets ve ProjectSettings olan)'), character: z.string().optional(), mode: z.enum(['Auto', 'Generic', 'Humanoid']).optional() },
}, async ({ project, character, mode }) => { await ensureServer(); const r = await post('/api/unity/config', { project, character, mode }); return text({ project: r.project, character: r.character || r.guess, mode: r.mode, valid: r.valid, candidates: r.characters.slice(0, 30) }); });

server.registerTool('send_to_unity', {
  description: 'Animasyonu TEK ADIMDA Unity projesine gönderir: Assets/AnimRef/ içine yazar ve Unity otomatik .anim (Assets/AnimRef/Clips/<ad>.anim) üretir. animation: kütüphaneden ad (yoksa editördeki mevcut), all: tüm kütüphane. Unity açıksa ~birkaç saniyede biter; kapalıysa açılınca aktarılır. Önce set_unity_project ayarlı olmalı.',
  inputSchema: { animation: z.string().optional(), all: z.boolean().default(false) },
}, async ({ animation, all }) => { await ensureServer(); return text(await post('/api/unity/send', { animation, all })); });

// ── VFX modu (parçacık efektleri; her emitter = Unity ParticleSystem). Format: vfx_reference / public/vfx-schema.js
const emitterSel = z.union([z.string(), z.number().int().min(0)]).describe('Emitter adı (ör. "alev") ya da sırası (0\'dan)');
const presetList = () => Object.entries(PRESETS).map(([k, p]) => {
  const em = presetEmitter(k); const rng = (a) => (a[0] === a[1] ? String(a[0]) : a.join('–'));
  const emis = em.emission.bursts.length ? `burst ${em.emission.bursts.map((b) => rng(b.count)).join('+')} parçacık` : `${em.emission.rateOverTime}/sn`;
  return `- ${k}: "${em.name}" — doku ${em.renderer.texture}, ${em.renderer.blend}, ${em.renderer.mode}, ${emis}, ömür ${rng(em.main.startLifetime)} sn${em.main.looping ? '' : ', tek atım'}`;
}).join('\n');

server.registerTool('vfx_reference', {
  description: 'VFX efekt formatının tam başvurusu (alanlar, birimler, Unity eksenleri, modüller), doku listesi, emitter\'a bağlanabilecek kütüphane materyalleri ve hazır emitter şablonları. VFX işine başlamadan ÖNCE bunu oku.',
  inputSchema: {},
}, async () => {
  await ensureServer(); const files = await get('/api/vfx/textures').catch(() => []);
  const tex = Object.entries(TEXTURES).map(([k, d]) => `- ${k}: ${d}${files.includes(k) ? '' : ' (dosya henüz yok)'}`).concat(files.filter((f) => !(f in TEXTURES)).map((f) => `- ${f}: özel doku (vfx/textures/${f}.png)`)).join('\n');
  const mats = (await get('/api/materials/list').catch(() => [])).map((m) => `- ${m.name}: ${m.shader ?? '?'}`).join('\n') || '- (kütüphanede materyal yok — new_material/set_material + save_material ile oluştur)';
  return text(`${VFX_REFERENCE}
## Dokular (renderer.texture alanına uzantısız ad)
${tex}

## Kütüphane materyalleri (renderer.material alanına ad; shader'ı ve değerleriyle parçacığı çizer)
${mats}

## Hazır emitter şablonları (add_emitter preset / set_vfx'te emitters[i].preset)
${presetList()}

## Araç akışı
- Sıfırdan: set_vfx { effect } (emitter'da { preset:'fire', ...üzerineYaz } kısayolu geçerli) ya da add_emitter + update_vfx ile adım adım.
- İnce ayar: update_vfx changes=[{ emitter:'alev', path:'main.startSize', value:[0.2,0.4] }, { path:'preview.bloom', value:1.2 }].
- Görsel kontrol: render_vfx (editör tarayıcıda açık olmalı) → zaman karelerinden kontak sayfası.
- Kullanıcı editörde düzeltince: get_vfx_user_edits (fark + notlar), farkı öğren; acknowledge:true ile referansı yenile.
- Özel görünüm (dissolve, kayan doku, fresnel…): material_reference → new_shader/set_shader (UPE-SL) → new_material/set_material + save_material
  → update_vfx [{ emitter:'alev', path:'renderer.material', value:'<materyal>' }] ('' kaldırır) → render_vfx ile kontrol.
- Bitince: save_vfx { name } → send_vfx_to_unity { name } (Unity'de Assets/UnityPreview/VFX/<ad>.prefab; bağlı materyaller de gönderilir).
`);
});

server.registerTool('get_vfx', {
  description: 'Editördeki efekt (normalize edilmiş tam JSON: name, duration, loop, attach, preview, emitters[]). Büyük olabilir; emitters ile filtrele.',
  inputSchema: { emitters: z.array(z.string()).optional().describe('Yalnız bu emitter\'lar (ad ya da "0","1" gibi sıra)') },
}, async ({ emitters }) => {
  await ensureServer(); const st = await get('/api/state'); const e = curVfx(st);
  if (!e) return text({ effect: null, info: 'Editörde efekt yok. set_vfx / add_emitter / load_vfx ile başla.' });
  if (!emitters) return text(e);
  const picked = emitters.map((s) => findEmitter(e, s)).filter(Boolean);
  return text({ ...e, emitters: picked, missingEmitters: emitters.filter((s) => !findEmitter(e, s)) });
});

server.registerTool('set_vfx', {
  description: 'Efektin TAMAMINI değiştirir; editör VFX moduna geçer ve anında günceller (kullanıcı Ctrl+Z ile geri alabilir). Bu hâl kullanıcı düzeltmeleri için referans olur (get_vfx_user_edits buna göre kıyaslar). Önce vfx_reference oku. '
    + 'effect = { name, duration (sn), loop, attach?, preview?: { bloom, background, showHero, ... }, emitters: [ { name, main:{ startLifetime:[min,max] sn, startSpeed:[min,max] m/sn, startSize:[min,max] m, startColor:["#hex","#hex"], gravity, ... }, emission:{ rateOverTime, bursts:[{time,count:[min,max],cycles,interval}] }, shape:{...}, colorOverLifetime:{ enabled, color:[[t,"#hex"]], alpha:[[t,a]] }, renderer:{ mode, texture, blend, intensity } } ] }. '
    + 'Kısayol: emitter yerine { preset:"fire", name:"alev", main:{...} } yaz → şablon + üzerine yazılanlar. Eksik alanlar varsayılanla dolar, bilinmeyen/geçersiz olanlar atılıp warnings\'te döner. Unity koordinatları: +X sağ, +Y yukarı, +Z ileri; metre/saniye/derece.',
  inputSchema: { effect: z.record(z.string(), z.any()).describe('Efekt nesnesi (format: vfx_reference)') },
}, async ({ effect }) => {
  await ensureServer();
  const { effect: e, warnings } = normalizeEffect(expandPresets(effect));
  const browserConnected = await pushVfx(e);
  return text({ ok: true, warnings, summary: vfxSummary(e), browserConnected });
});

server.registerTool('update_vfx', {
  description: 'Efektte yol bazlı küçük değişiklikler (editör anında güncellenir; sonuç yeni referans olur). changes: [{ emitter?, path, value }]. emitter verilirse yol emitter içinde (ör. "main.startSize" → [0.1,0.3], "main.startColor" → ["#ffb347","#ff5a1f"], "emission.rateOverTime" → 40, "renderer.intensity" → 3, "renderer.texture" → "spark", "renderer.material" → "ates_parcacik" (kütüphane materyali; "" kaldırır), "shape.angle" → 25, "noise.enabled" → true, "enabled" → false); '
    + 'emitter yoksa efekt düzeyi (ör. "duration" → 1.2, "preview.bloom" → 1.2, "attach.target" → "bone"). value bütün bir alt nesne de olabilir (ör. path "colorOverLifetime.alpha"). Geçerli değişiklikler uygulanır, geçersiz yollar errors\'ta döner; değerler sınırlara kırpılır (applied\'da son değeri gör). Editörde efekt yoksa varsayılan efektle başlar.',
  inputSchema: { changes: z.array(z.object({ emitter: emitterSel.optional(), path: z.string().describe('Nokta ile yol, ör. "main.startSize"'), value: z.any() })).min(1) },
}, async ({ changes }) => {
  await ensureServer(); const st = await get('/api/state'); const base = curVfx(st) || defaultEffect();
  const { effect: e, errors, warnings } = applyChanges(base, changes);
  const appliedN = changes.length - errors.length; let browserConnected = null;
  if (appliedN > 0) browserConnected = await pushVfx(e);
  const applied = changes.map((c) => { const t = c.emitter === undefined || c.emitter === null || c.emitter === '' ? e : findEmitter(e, c.emitter); const v = t ? getPath(t, c.path) : undefined; return v === undefined ? null : { emitter: c.emitter, path: c.path, value: v }; }).filter(Boolean);
  return text({ ok: errors.length === 0, applied, errors, warnings, summary: vfxSummary(e), browserConnected, ...(appliedN ? {} : { info: 'Geçerli değişiklik yok; editöre gönderilmedi.' }) });
});

server.registerTool('add_emitter', {
  description: `Efekte yeni emitter (katman) ekler; şablonla başlamak en kolayı: ${Object.keys(PRESETS).join(', ')} (ayrıntı: vfx_reference). overrides şablonun üstüne derin birleştirilir (ör. { main:{ startColor:["#7ab8ff","#3a6dff"] }, renderer:{ intensity:3 } }). Ad çakışırsa _2 eklenir. Editörde efekt yoksa boş bir efekt açılır. Sonuç yeni referans olur.`,
  inputSchema: {
    preset: z.enum(Object.keys(PRESETS)).optional().describe('Şablon adı (verilmezse varsayılan beyaz koni emitter)'),
    name: z.string().optional().describe('Emitter adı (efekt içinde benzersiz)'),
    overrides: z.record(z.string(), z.any()).optional().describe('Şablonun üstüne yazılacak alanlar (emitter formatında)'),
    index: z.number().int().min(0).optional().describe('Listedeki yeri (verilmezse sona; çizim sırası için renderer.sortingOrder)'),
  },
}, async ({ preset, name, overrides, index }) => {
  await ensureServer(); const st = await get('/api/state'); const base = curVfx(st) || { ...defaultEffect(), emitters: [] };
  const em = presetEmitter(preset, { ...(overrides || {}), ...(name ? { name } : {}) });
  const at = index === undefined ? base.emitters.length : Math.min(index, base.emitters.length);
  base.emitters.splice(at, 0, em);
  const { effect: e, warnings } = normalizeEffect(base);
  const browserConnected = await pushVfx(e);
  return text({ ok: true, added: e.emitters[at].name, index: at, warnings, summary: vfxSummary(e), browserConnected });
});

server.registerTool('remove_emitter', {
  description: 'Efektten bir emitter\'ı siler (editör anında güncellenir, Ctrl+Z ile geri alınabilir; sonuç yeni referans olur). Geçici kapatmak için update_vfx { emitter, path:"enabled", value:false } daha iyi.',
  inputSchema: { emitter: emitterSel },
}, async ({ emitter }) => {
  await ensureServer(); const st = await get('/api/state'); const base = curVfx(st) || defaultEffect();
  const em = findEmitter(base, emitter); if (!em) throw new Error(`Emitter yok: ${emitter} (var olanlar: ${base.emitters.map((x) => x.name).join(', ') || '—'})`);
  base.emitters.splice(base.emitters.indexOf(em), 1);
  const { effect: e } = normalizeEffect(base);
  const browserConnected = await pushVfx(e);
  return text({ ok: true, removed: em.name, summary: vfxSummary(e), browserConnected });
});

server.registerTool('get_vfx_user_edits', {
  description: 'Kullanıcının editörde efekte yaptığı düzeltmeler: referansa (Claude\'un son set_vfx/update_vfx/add_emitter/remove_emitter/load_vfx hâli) göre değişen alanlar [{ path:"emitters.<ad>.main.startSize", from, to }], eklenen/silinen emitter\'lar + VFX modunda yazılan notlar. Kullanıcı "düzelttim/şöyle olsun" dediğinde çağır; farkı öğren. acknowledge:true notları temizler ve mevcut hâli yeni referans yapar.',
  inputSchema: { acknowledge: z.boolean().default(false).describe('true: VFX notlarını temizle ve mevcut hâli yeni referans yap') },
}, async ({ acknowledge }) => {
  await ensureServer(); const st = await get('/api/state'); const cur = curVfx(st);
  const base = st.vfxBaseline ? normalizeEffect(st.vfxBaseline).effect : null;
  const result = { notes: notesOf(st, 'vfx').map(({ mode, ...n }) => n) };
  if (cur && base) Object.assign(result, diffEffects(base, cur));
  else result.info = cur ? 'Referans yok (henüz set_vfx / load_vfx yapılmamış).' : 'Editörde efekt yok.';
  if (acknowledge) { await post('/api/notes/clear?mode=vfx'); await post('/api/vfx/baseline'); }
  return text(result);
});

server.registerTool('render_vfx', {
  description: 'Editördeki efekti zaman karelerinden bir kontak sayfası PNG\'si olarak çizer (hücreler soldan sağa, yukarıdan aşağı zaman sırasıyla). Editör tarayıcıda (uygulama içi tarayıcı) açık olmalı. Görsel kontrol için her önemli değişiklikten sonra kullan. '
    + 'times verilmezse 0..duration arası count eşit aralıklı kare (t = duration·(i+0.5)/count). Kamera verilmezse otomatik kadraj: tüm karelerdeki parçacıkların %5–95 sınırları (+ showHero ise kahraman) çapraz açıdan sığdırılır. '
    + 'Hazırlar yalnız yönü seçer, uzaklık otomatik: front (karakterin önünden, +Z), side (yandan), top (üstten), threequarter (çapraz, varsayılan). Ya da position/target (metre, Unity eksenleri: +X karakterin sağı, +Y yukarı, +Z ileri). Hücre etiketi: zaman + parçacık sayısı.',
  inputSchema: {
    times: z.array(z.number().min(0)).max(24).optional().describe('Çizilecek anlar (sn, efekt başından), ör. [0.05,0.1,0.2,0.4]'),
    count: z.number().int().min(1).max(24).default(6).describe('times yoksa kare sayısı'),
    cols: z.number().int().min(1).max(8).optional().describe('Sütun sayısı (varsayılan otomatik)'),
    size: z.number().int().min(96).max(1024).default(320).describe('Hücre boyu (px)'),
    camera: z.object({ preset: z.enum(['front', 'side', 'top', 'threequarter']).optional(), position: vec3.optional(), target: vec3.optional() }).optional(),
    showHero: z.boolean().optional().describe('Kahramanı göster (ölçek için; varsayılan efektin preview.showHero)'),
    bg: z.string().optional().describe('Arka plan rengi (varsayılan preview.background)'),
  },
}, async (args) => {
  await ensureServer();
  const ping = await get('/api/ping');
  if (!ping.clients) throw new Error(`Editör tarayıcıda açık değil (http://localhost:${PORT}). render_vfx görüntüyü tarayıcıdaki editör çizer: editörü uygulama içi tarayıcıda aç, sonra tekrar dene.`);
  const r = await post('/api/claude/render', { kind: 'vfx', ...args });
  if (!r.png) throw new Error('Editör görüntü döndürmedi (VFX modunu destekleyen editör sürümü açık mı?).');
  return { content: [{ type: 'image', data: r.png.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' }] };
});

server.registerTool('list_vfx', {
  description: 'VFX kütüphanesi (vfx/ klasörü): kayıtlı efektler [{ name, file, modified, emitters (sayı), duration }].',
  inputSchema: {},
}, async () => { await ensureServer(); return text(await get('/api/vfx/list')); });

server.registerTool('save_vfx', {
  description: 'Efekti kütüphaneye kaydeder (vfx/<name>.json; aynı ad varsa üzerine yazar). effect verilmezse editördeki mevcut efekt kaydedilir. Kayıtlı ad = efekt adı = Unity prefab adı.',
  inputSchema: { name: z.string().describe('Dosya/efekt adı, ör. "alev_kesigi"'), effect: z.record(z.string(), z.any()).optional() },
}, async ({ name, effect }) => {
  await ensureServer(); const st = await get('/api/state');
  const src = effect ? expandPresets(effect) : curVfx(st);
  if (!src) throw new Error('Kaydedilecek efekt yok (editörde VFX boş; effect ver ya da set_vfx kullan).');
  const { effect: e, warnings } = normalizeEffect({ ...src, name });
  const r = await post('/api/vfx/save?name=' + encodeURIComponent(e.name), e);
  return text({ saved: r.name, warnings });
});

server.registerTool('load_vfx', {
  description: 'Kütüphaneden efekti editöre yükler (editör VFX moduna geçer; yüklenen hâl yeni referans olur).',
  inputSchema: { name: z.string() },
}, async ({ name }) => {
  await ensureServer(); const r = await post('/api/claude/vfx-load', { name });
  const st = await get('/api/state');
  return text({ loaded: r.name, warnings: r.warnings, summary: vfxSummary(curVfx(st)), browserConnected: r.clients > 0 });
});

server.registerTool('delete_vfx', {
  description: 'Kütüphaneden efekti siler (geri alınamaz; kullanıcı istemeden çağırma).',
  inputSchema: { name: z.string() },
}, async ({ name }) => {
  await ensureServer(); const had = (await get('/api/vfx/list')).some((x) => x.name === name);
  await post('/api/vfx/delete?name=' + encodeURIComponent(name));
  return text(had ? 'Silindi: ' + name : 'Kütüphanede yoktu: ' + name);
});

server.registerTool('list_vfx_textures', {
  description: 'Parçacık dokuları (vfx/textures/*.png): yerleşikler açıklamalarıyla + kullanıcının eklediği özel dokular. renderer.texture alanına uzantısız ad yazılır (ör. "spark"). Hepsi beyaz + alfa; renk startColor/colorOverLifetime\'dan gelir.',
  inputSchema: {},
}, async () => {
  await ensureServer(); const files = await get('/api/vfx/textures');
  return text({
    builtin: Object.fromEntries(Object.entries(TEXTURES).map(([k, d]) => [k, files.includes(k) ? d : `${d} (dosya henüz yok: vfx/textures/${k}.png)`])),
    custom: files.filter((f) => !(f in TEXTURES)),
  });
});

server.registerTool('set_editor_mode', {
  description: 'Kullanıcının ekranındaki editör modunu değiştirir: anim (animasyon) | vfx (parçacık efekti) | material (materyal) | shader (shader kodu) | model (model görüntüleyici: GLB/FBX/OBJ). set_vfx/update_vfx/load_vfx VFX moduna, new_material/set_material/update_material/load_material Materyal moduna, new_shader/set_shader/update_shader/load_shader Shader moduna, view_model Model moduna zaten geçirir; bunu yalnız kullanıcıya başka modu göstermek için kullan.',
  inputSchema: { mode: z.enum(['anim', 'vfx', 'material', 'shader', 'model']) },
}, async ({ mode }) => { await ensureServer(); const r = await post('/api/claude/mode', { mode }); return text({ mode: r.mode, browserConnected: r.clients > 0 }); });

server.registerTool('send_vfx_to_unity', {
  description: 'Efekti TEK ADIMDA Unity projesine gönderir: Assets/UnityPreview/VFX/<ad>.vfx.json + kullandığı dokular (Textures/) yazılır, importer script\'leri Assets/Editor/UnityPreview/\'a kurulur; Unity açıksa birkaç saniyede Assets/UnityPreview/VFX/<ad>.prefab (kökte Play() tüm emitter\'ları oynatır) üretir. '
    + 'renderer.material bağlı emitter\'ların kütüphane materyalleri (+ özel shader\'ları, dokuları) da Assets/UnityPreview/Materials/\'a yazılır ve prefab\'daki renderer\'a bağlanır; kütüphanede olmayan materyal o efekti durdurur (errors). '
    + 'name: kütüphaneden ad (verilmezse editördeki efekt), all: tüm kütüphane. ≤20 sn bekler; Unity kapalıysa "waiting" döner ve açılınca işlenir. Karakter gerekmez; önce set_unity_project ile proje ayarlı olmalı. Yanıt: { ok, sent, imported, waiting, prefabs, missingTextures, materials?, materialErrors?, shaderErrors?, note | error }.',
  inputSchema: { name: z.string().optional(), all: z.boolean().default(false) },
}, async ({ name, all }) => { await ensureServer(); return text(await post('/api/unity/send-vfx', { name, all })); });

// ── Materyal + Shader modu (docs/MATERIAL.md). Shader = UPE-SL kodu (Unity HLSL alt kümesi), materyal = shader + değerler. Format: material_reference
const changeSchema = z.object({ path: z.string().describe('Nokta ile yol'), value: z.any() });
const templateList = () => Object.entries(TEMPLATES).map(([k, t]) => `- ${k}: ${t.label}`).join('\n');
const builtinList = () => BUILTIN_SHADERS.map((s) => `- ${s.unityName} (ad: ${s.name}) — ${s.description}\n  özellikler: ${s.properties.map((p) => p.name).join(', ')}`).join('\n');
const SPECIAL_TEX = { white: 'düz beyaz (önizlemede üretilir; Unity\'de shader varsayılanı)', black: 'düz siyah', gray: 'düz gri', bump: 'düz normal haritası (0.5,0.5,1)', '@mesh': 'önizleme nesnesinin kendi dokusu (ör. kahramanın base color\'ı); Unity\'de unityPath:"Assets/..." gerekir' };
const isBuiltinShaderName = (n) => BUILTIN_SHADERS.some((b) => [b.name, b.unityName].some((x) => x.toLowerCase() === String(n).trim().toLowerCase()));

server.registerTool('material_reference', {
  description: 'Shader (UPE-SL kod kuralları, UPEInput girdileri, özellik tipleri, renderState) ve materyal formatının tam başvurusu + hazır (builtin) shader\'lar ve özellikleri + yeni shader şablonları + doku listesi + araç akışı. Materyal ya da shader işine başlamadan ÖNCE bunu oku.',
  inputSchema: {},
}, async () => {
  await ensureServer(); const files = await get('/api/material-textures').catch(() => []);
  const custom = (await get('/api/shaders/list').catch(() => [])).filter((s) => !s.builtin);
  return text(`${SHADER_REFERENCE}
${MATERIAL_REFERENCE}
## Hazır shader'lar (builtin; ezilemez/silinemez — değiştirmek için load_shader/get_shader → set_shader ile BAŞKA adla özel kopya)
${builtinList()}
${custom.length ? `\n## Kütüphanedeki özel shader'lar\n${custom.map((s) => `- ${s.unityName}${s.description ? ' — ' + s.description : ''}`).join('\n')}\n` : ''}
## Yeni shader şablonları (new_shader template)
${templateList()}

## Dokular (texture değerinde tex: uzantısız ad)
- Dosyalar (materials/textures/): ${files.join(', ') || '—'}
- Özel adlar: ${Object.keys(SPECIAL_TEX).join(', ')} (list_material_textures)

## Araç akışı
- Materyal: new_material { name, shader:'Elarion/ToonCharacter', values? } (shader varsayılanlarıyla başlar) → update_material changes=[{ path:'values._RimPower', value:3 }, { path:'values._BaseMap', value:{ tex:'checker', tiling:[2,2] } }, { path:'preview.target', value:'hero' }] → render_material ile bak.
- Shader: new_shader { name, template:'toon' } → update_shader changes=[{ path:'code.fragment', value:'float4 frag(UPEInput i)\\n{ ... }' }, { path:'properties._RimPower.max', value:10 }, { path:'properties._Glow', value:{ type:'range', min:0, max:4, default:1 } }, { path:'renderState.blend', value:'additive' }]. Yanıttaki compile = editörün GLSL derleme sonucu (errors: bölüm+satır+mesaj); hata varsa düzelt. Sonra bu shader'la materyal: new_material { shader:'UnityPreview/<ad>' }.
- Claude'un her new_/set_/update_/load_ çağrısı yeni referanstır; kullanıcı editörde düzeltince get_material_user_edits / get_shader_user_edits (fark + notlar) → farkı öğren; acknowledge:true referansı yeniler.
- Önizlemede giydirme: assign_material { target:'hero' | 'hero:<mesh>' | 'prop:<id>', material } (tüm modlarda görünür). Işık: get_lighting / set_lighting.
- Bitince: save_shader (özelse) → save_material → send_material_to_unity { name } (özel shader'ın .shader'ı da gider; Unity: Assets/UnityPreview/Materials/<ad>.mat). Yalnız shader: send_shader_to_unity { name } (Unity derleme hatalarını döndürür).
- Model sekmesi (GLB/FBX/OBJ görüntüleyici): view_model { path:'C:/.../x.glb' } → render_model ile bak → kullanıcı editörde inceler (notları get_model_view).
`);
});

// shader
server.registerTool('list_shaders', {
  description: 'Shader listesi: hazır (builtin: Elarion/ToonCharacter, URP Lit/Unlit/Particles Unlit — Unity\'de zaten var, .shader yazılmaz) + kütüphanedeki özel shader\'lar (shaders/<ad>.json; Unity\'de UnityPreview/<ad>). Her biri: name, unityName, builtin, description, properties ("_Ad:tip"), modified.',
  inputSchema: {},
}, async () => { await ensureServer(); return text((await get('/api/shaders/list')).map((s) => ({ ...s, properties: s.properties.map((p) => `${p.name}:${p.type}`) }))); });

server.registerTool('get_shader', {
  description: 'Shader\'ın tam JSON\'u (normalize: properties, renderState, lighting, outline, urpSurface, code.common/vertex/fragment/outlineFragment). name: ad ("elarion_toon", "kalkan") ya da unityName ("Elarion/ToonCharacter", "UnityPreview/kalkan"); verilmezse editördeki shader. Editörde aynı adlı kaydedilmemiş çalışma kopyası varsa o döner. Yalnız bazı alanlar için parts.',
  inputSchema: { name: z.string().optional(), parts: z.array(z.enum(['description', 'properties', 'renderState', 'lighting', 'outline', 'urpSurface', 'code'])).optional().describe('Yalnız bu alanlar (+ name/unityName/builtin)') },
}, async ({ name, parts }) => {
  await ensureServer();
  const s = name ? await requireShaderOf(name) : curShader(await get('/api/state'));
  if (!s) return text({ shader: null, info: 'Editörde shader yok. new_shader / load_shader / set_shader ile başla.' });
  return text(parts ? Object.fromEntries(Object.entries(s).filter(([k]) => ['name', 'unityName', 'builtin', ...parts].includes(k))) : s);
});

server.registerTool('new_shader', {
  description: `Yeni ÖZEL shader oluşturur ve editöre yükler (Shader moduna geçer, yeni referans; KAYDETMEZ — kalıcı olması için save_shader). template: ${Object.keys(TEMPLATES).join(' | ')} (ayrıntı material_reference). Unity adı UnityPreview/<name> olur; hazır shader adları kullanılamaz. Yanıt editörün GLSL derleme sonucunu içerir (tarayıcı yoksa "kaydedildi, derleme denetlenemedi" notu). Önce material_reference oku.`,
  inputSchema: { name: z.string().describe('Shader adı (harf/rakam/_/-), ör. "kalkan_fresnel"'), template: z.enum(Object.keys(TEMPLATES)).default('unlit'), description: z.string().optional() },
}, async ({ name, template, description }) => {
  await ensureServer();
  const tpl = clone(TEMPLATES[template].shader);
  const { shader, warnings } = normalizeShader({ ...defaultShader(), ...tpl, name, description: description ?? TEMPLATES[template].label, builtin: false });
  if (isBuiltinShaderName(shader.name) || isBuiltinShaderName(name)) throw new Error(`"${name}" hazır (builtin) bir shader adı; başka ad ver.`);
  if ((await get('/api/shaders/list')).some((s) => !s.builtin && s.name === shader.name)) warnings.push(`Kütüphanede aynı adlı shader var (shaders/${shader.name}.json); save_shader üzerine yazar.`);
  const browserConnected = await pushShader(shader); const compile = await compileCheck(shader);
  return text({ ok: compile.ok !== false, shader: shaderSummary(shader), template, warnings, compile, browserConnected });
});

server.registerTool('set_shader', {
  description: 'Editördeki shader\'ın TAMAMINI değiştirir (Shader moduna geçer; bu hâl kullanıcı düzeltmeleri için referans olur). Önce material_reference oku. '
    + 'shader = { name, description, properties:[{ name:"_RimPower", type:"range", label, min, max, default }], renderState:{ blend, cull, zwrite, ztest, queue, queueOffset }, lighting:{ receiveShadows, castShadows }, outline:{ enabled, width:"_OutlineWidth", color:"_OutlineColor" }, code:{ common, vertex:"void vert(inout UPEVertex v) {...}", fragment:"float4 frag(UPEInput i) {...}", outlineFragment } }. '
    + 'Eksikler varsayılanla dolar, geçersizler atılıp warnings\'te döner. Yanıt editörün GLSL derleme sonucunu içerir (compile: { checked, ok, errors:[{ section, line, message }] }); tarayıcı yoksa "kaydedildi, derleme denetlenemedi". KAYDETMEZ (save_shader).',
  inputSchema: { shader: z.record(z.string(), z.any()).describe('Shader nesnesi (format: material_reference)') },
}, async ({ shader: input }) => {
  await ensureServer(); const { shader, warnings } = normalizeShader(input); if (shader.builtin) warnings.push(BUILTIN_EDIT_WARN);
  const browserConnected = await pushShader(shader); const compile = await compileCheck(shader);
  return text({ ok: compile.ok !== false, shader: shaderSummary(shader), warnings, compile, browserConnected });
});

server.registerTool('update_shader', {
  description: 'Editördeki shader\'da yol bazlı değişiklikler: changes=[{ path, value }]. Yollar: "code.fragment" | "code.common" | "code.vertex" | "code.outlineFragment" (kodun TAMAMI, string), "properties._RimPower.max" / "properties._RimPower.default" (özellik alanı), "properties._Glow" (nesne → ekle/birleştir, null → sil), "properties" (tüm dizi), "renderState.blend" (opaque|alpha|additive|premultiply|multiply), "renderState.cull" (back|front|off), "renderState.queue", "lighting.castShadows", "outline.enabled", "urpSurface", "name", "description". '
    + 'Geçerliler uygulanır ve editöre gider (yeni referans), geçersiz yollar errors\'ta döner. Yanıt editörün GLSL derleme sonucunu içerir (compile.errors: bölüm+satır+mesaj); tarayıcı yoksa "kaydedildi, derleme denetlenemedi". KAYDETMEZ (save_shader).',
  inputSchema: { changes: z.array(changeSchema).min(1) },
}, async ({ changes }) => {
  await ensureServer(); const base = curShader(await get('/api/state'));
  if (!base) throw new Error('Editörde shader yok. Önce new_shader / set_shader / load_shader.');
  const { shader, errors, warnings } = applyShaderChanges(base, changes); if (shader.builtin) warnings.push(BUILTIN_EDIT_WARN);
  const out = { ok: false, applied: [], errors, warnings };
  if (changes.length > errors.length) { out.browserConnected = await pushShader(shader); out.compile = await compileCheck(shader); }
  else out.info = 'Geçerli değişiklik yok; editöre gönderilmedi.';
  out.ok = !errors.length && out.compile?.ok !== false;
  out.applied = changes.map((c) => { const v = shaderPathGet(shader, c.path); return v === undefined ? null : { path: c.path, value: shownValue(c.path, v) }; }).filter(Boolean);
  out.shader = shaderSummary(shader);
  return text(out);
});

server.registerTool('save_shader', {
  description: 'Özel shader\'ı kütüphaneye kaydeder (shaders/<name>.json; aynı ad varsa üzerine yazar). shader verilmezse editördeki; name verilmezse shader\'ın adı. Hazır (builtin) adlar ezilemez (hata); builtin bir shader\'ı başka adla kaydetmek özel kopya (UnityPreview/<name>) oluşturur.',
  inputSchema: { name: z.string().optional(), shader: z.record(z.string(), z.any()).optional() },
}, async ({ name, shader: input }) => {
  await ensureServer();
  const src = input ? normalizeShader(input).shader : curShader(await get('/api/state'));
  if (!src) throw new Error('Kaydedilecek shader yok (editörde shader boş; shader ver ya da new_shader kullan).');
  const r = await post('/api/shaders/save?name=' + enc(name || src.name), src);
  return text({ saved: r.name, unityName: r.unityName, warnings: r.warnings });
});

server.registerTool('load_shader', {
  description: 'Kütüphaneden (hazır ya da özel) shader\'ı editöre yükler (Shader moduna geçer; yüklenen hâl yeni referans olur). Hazır shader\'ı incelemek/çatallamak için de kullan (değiştir → save_shader ile başka adla).',
  inputSchema: { name: z.string().describe('Ad ya da unityName') },
}, async ({ name }) => {
  await ensureServer(); const r = await post('/api/claude/shader-load', { name }); const st = await get('/api/state');
  return text({ loaded: r.name, unityName: r.unityName, builtin: r.builtin, shader: shaderSummary(curShader(st)), browserConnected: r.clients > 0 });
});

server.registerTool('delete_shader', {
  description: 'Kütüphaneden özel shader\'ı siler (geri alınamaz; kullanıcı istemeden çağırma). Hazır (builtin) shader\'lar silinemez.',
  inputSchema: { name: z.string() },
}, async ({ name }) => { await ensureServer(); const r = await post('/api/shaders/delete?name=' + enc(name)); return text(r.deleted ? 'Silindi: ' + name : 'Kütüphanede yoktu: ' + name); });

server.registerTool('get_shader_user_edits', {
  description: 'Kullanıcının editörde shader\'a yaptığı düzeltmeler: referansa (Claude\'un son new_/set_/update_/load_shader hâli) göre değişen alanlar [{ path:"properties._RimPower.default", from, to }], eklenen/silinen özellikler, kod değişiklikleri ({ path:"code.fragment", changed:true, to:<yeni kodun tamamı> }) + Shader modunda yazılan notlar. Kullanıcı "düzelttim" dediğinde çağır. acknowledge:true notları temizler ve mevcut hâli yeni referans yapar.',
  inputSchema: { acknowledge: z.boolean().default(false).describe('true: Shader notlarını temizle ve mevcut hâli yeni referans yap') },
}, async ({ acknowledge }) => {
  await ensureServer(); const st = await get('/api/state'); const cur = curShader(st);
  const result = { notes: notesOf(st, 'shader').map(({ mode, ...n }) => n), changes: [] };
  if (cur && st.shaderBaseline) result.changes = diffShaders(normalizeShader(st.shaderBaseline).shader, cur);
  else result.info = cur ? 'Referans yok (henüz new_shader / set_shader / load_shader yapılmamış).' : 'Editörde shader yok.';
  if (acknowledge) { await post('/api/notes/clear?mode=shader'); await post('/api/shader/baseline'); }
  return text(result);
});

// materyal
server.registerTool('list_materials', {
  description: 'Materyal kütüphanesi (materials/<ad>.json): [{ name, file, modified, shader, target }].',
  inputSchema: {},
}, async () => { await ensureServer(); return text(await get('/api/materials/list')); });

server.registerTool('get_material', {
  description: 'Materyalin tam JSON\'u (normalize: shader, values — shader\'ın tüm özellikleri, verilmeyenler varsayılan —, renderQueue, preview) + shader özeti. name verilmezse editördeki materyal, verilirse kütüphaneden.',
  inputSchema: { name: z.string().optional() },
}, async ({ name }) => {
  await ensureServer();
  const raw = name ? await getOk('/api/materials/get?name=' + enc(name)) : (await get('/api/state')).material;
  if (!raw) return text({ material: null, info: 'Editörde materyal yok. new_material / load_material ile başla.' });
  const shader = await shaderByName(raw.shader); const { material, warnings } = normalizeMaterial(raw, shader);
  return text({ material, warnings, shader: shaderSummary(shader) });
});

server.registerTool('new_material', {
  description: 'Yeni materyal oluşturur ve editöre yükler (Materyal moduna geçer, yeni referans; KAYDETMEZ — save_material). shader: Unity adı ya da ad ("Elarion/ToonCharacter", "Universal Render Pipeline/Lit", "UnityPreview/kalkan", "kalkan"). '
    + 'Değerler shader\'ın varsayılanlarıyla başlar; values verilenleri üzerine yazar (ör. { _BaseColor:"#c03030", _RimPower:3, _EmissionColor:{ color:"#ff6a1a", intensity:4 }, _BaseMap:{ tex:"checker", tiling:[2,2] } }). Önce material_reference oku.',
  inputSchema: {
    name: z.string().describe('Materyal adı (Unity .mat adı), ör. "kahraman_toon"'), shader: z.string(),
    values: z.record(z.string(), z.any()).optional(), renderQueue: z.number().int().optional().describe('-1 = shader\'ınki'),
    preview: z.record(z.string(), z.any()).optional().describe(`{ target: ${PREVIEW_TARGETS.join('|')}|prop:<id>, background, bloom, rotate, showGrid }`),
  },
}, async ({ name, shader: sn, values, renderQueue, preview }) => {
  await ensureServer(); const shader = await requireShaderOf(sn);
  const { material, warnings } = normalizeMaterial({ name, shader: shaderUnityName(shader), values: values || {}, renderQueue, preview }, shader);
  const browserConnected = await pushMaterial(material);
  return text({ ok: true, material: materialSummary(material), warnings, shader: shaderSummary(shader), browserConnected });
});

server.registerTool('set_material', {
  description: 'Editördeki materyalin TAMAMINI değiştirir (Materyal moduna geçer, yeni referans; KAYDETMEZ). material = { name, shader (Unity adı ya da ad), values:{ _Ad: değer }, renderQueue?, preview? }. '
    + 'Değer biçimleri: color "#rrggbb[aa]" (sRGB) · hdrColor { color, intensity } · float/range sayı · toggle bool · vector [x,y,z,w] · texture { tex, tiling:[x,y], offset:[x,y], unityPath? }. Shader\'da olmayan değerler atılır, eksikler varsayılan (warnings).',
  inputSchema: { material: z.record(z.string(), z.any()) },
}, async ({ material: input }) => {
  await ensureServer(); const shader = await requireShaderOf(input.shader || 'Universal Render Pipeline/Lit');
  const { material, warnings } = normalizeMaterial({ ...input, shader: shaderUnityName(shader) }, shader);
  const browserConnected = await pushMaterial(material);
  return text({ ok: true, material: materialSummary(material), warnings, shader: shaderSummary(shader), browserConnected });
});

server.registerTool('update_material', {
  description: 'Editördeki materyalde yol bazlı değişiklikler: changes=[{ path, value }]. Yollar: "values._RimPower" → 3, "values._BaseColor" → "#ff8040", "values._EmissionColor" → { color:"#ff6a1a", intensity:4 }, "values._BaseMap" → { tex:"checker", tiling:[2,2] }, "values._BaseMap.tiling" → [4,4], "preview.target" → "hero", "preview.bloom" → 1.2, "renderQueue" → 3000, "name", "shader" (değişince aynı adlı değerler korunur, diğerleri varsayılan). '
    + 'Değerler sınırlara kırpılır (applied\'da son hâli gör); shader\'da olmayan özellik / geçersiz yol errors\'ta döner, geçerliler uygulanır. Sonuç editöre gider ve yeni referans olur. KAYDETMEZ.',
  inputSchema: { changes: z.array(changeSchema).min(1) },
}, async ({ changes }) => {
  await ensureServer(); const cur = await curMaterial(await get('/api/state'));
  if (!cur) throw new Error('Editörde materyal yok. Önce new_material / set_material / load_material.');
  const list = changes.map((c) => ({ ...c })); let shader = cur.shader;
  const sc = list.filter((c) => c.path === 'shader').at(-1);
  if (sc) { shader = await requireShaderOf(String(sc.value)); for (const c of list) if (c.path === 'shader') c.value = shaderUnityName(shader); }
  if (!shader) throw new Error(`Materyalin shader'ı bulunamadı: ${cur.material.shader}. Önce "shader" yolunu geçerli bir shader'a ayarla (list_shaders).`);
  const { material, errors, warnings } = applyMaterialChanges(cur.material, list, shader);
  const out = { ok: !errors.length, applied: [], errors, warnings };
  if (list.length > errors.length) out.browserConnected = await pushMaterial(material); else out.info = 'Geçerli değişiklik yok; editöre gönderilmedi.';
  out.applied = list.map((c) => { const v = pathGet(material, c.path); return v === undefined ? null : { path: c.path, value: v }; }).filter(Boolean);
  out.material = materialSummary(material);
  return text(out);
});

server.registerTool('save_material', {
  description: 'Materyali kütüphaneye kaydeder (materials/<name>.json; aynı ad varsa üzerine yazar). material verilmezse editördeki; name verilmezse materyalin adı. Kayıtlı ad = Unity .mat adı. Özel shader kullanıyorsa shader\'ı da save_shader ile kaydet.',
  inputSchema: { name: z.string().optional(), material: z.record(z.string(), z.any()).optional() },
}, async ({ name, material: input }) => {
  await ensureServer(); const src = input || (await get('/api/state')).material;
  if (!src) throw new Error('Kaydedilecek materyal yok (editörde materyal boş; material ver ya da new_material kullan).');
  const shader = await shaderByName(src.shader);
  const { material, warnings } = normalizeMaterial({ ...src, ...(name ? { name } : {}), ...(shader ? { shader: shaderUnityName(shader) } : {}) }, shader);
  if (shader && !shader.builtin && !(await get('/api/shaders/list')).some((s) => s.unityName === shader.unityName)) warnings.push(`Özel shader ${shader.unityName} kütüphanede kayıtlı değil (yalnız editörde); kalıcı olması için save_shader.`);
  const r = await post('/api/materials/save?name=' + enc(material.name), material);
  return text({ saved: r.name, shader: material.shader, warnings: [...new Set([...warnings, ...(r.warnings || [])])] });
});

server.registerTool('load_material', {
  description: 'Kütüphaneden materyali editöre yükler (Materyal moduna geçer; yüklenen hâl yeni referans olur).',
  inputSchema: { name: z.string() },
}, async ({ name }) => {
  await ensureServer(); const r = await post('/api/claude/material-load', { name }); const cur = await curMaterial(await get('/api/state'));
  return text({ loaded: r.name, warnings: r.warnings, material: materialSummary(cur?.material), browserConnected: r.clients > 0 });
});

server.registerTool('delete_material', {
  description: 'Kütüphaneden materyali siler (geri alınamaz; kullanıcı istemeden çağırma).',
  inputSchema: { name: z.string() },
}, async ({ name }) => { await ensureServer(); const r = await post('/api/materials/delete?name=' + enc(name)); return text(r.deleted ? 'Silindi: ' + name : 'Kütüphanede yoktu: ' + name); });

server.registerTool('get_material_user_edits', {
  description: 'Kullanıcının editörde materyale yaptığı düzeltmeler: referansa (Claude\'un son new_/set_/update_/load_material hâli) göre değişen alanlar [{ path:"values._RimPower", from, to }] + Materyal modunda yazılan notlar. Kullanıcı "düzelttim/şöyle olsun" dediğinde çağır; farkı öğren. acknowledge:true notları temizler ve mevcut hâli yeni referans yapar.',
  inputSchema: { acknowledge: z.boolean().default(false).describe('true: Materyal notlarını temizle ve mevcut hâli yeni referans yap') },
}, async ({ acknowledge }) => {
  await ensureServer(); const st = await get('/api/state'); const cur = await curMaterial(st);
  const result = { notes: notesOf(st, 'material').map(({ mode, ...n }) => n), changes: [] };
  if (cur && st.materialBaseline) result.changes = diffObjects(normalizeMaterial(st.materialBaseline, await shaderByName(st.materialBaseline.shader)).material, cur.material);
  else result.info = cur ? 'Referans yok (henüz new_material / set_material / load_material yapılmamış).' : 'Editörde materyal yok.';
  if (acknowledge) { await post('/api/notes/clear?mode=material'); await post('/api/material/baseline'); }
  return text(result);
});

server.registerTool('assign_material', {
  description: 'Önizlemede kahramana/eşyaya materyal giydirir (YALNIZ önizleme; animasyon/VFX dahil tüm modlarda görünür, Unity prefab\'ına bağlamaz). target: "hero" (tüm kahraman), "hero:<mesh adı>" (tek mesh), "prop:<id>" (takılı eşya; id list_props → attached). material: kütüphanedeki materyal adı (önce save_material) ya da null (giydirmeyi kaldır).',
  inputSchema: { target: z.string().regex(/^(hero(:.+)?|prop:.+)$/, 'target: hero | hero:<mesh> | prop:<id>'), material: z.string().nullable() },
}, async ({ target, material }) => {
  await ensureServer(); const st = await get('/api/state'); const next = { ...(st.materialOverrides || {}) }; const warnings = [];
  if (material === null) delete next[target];
  else {
    const lib = await get('/api/materials/list');
    if (!lib.some((m) => m.name === material)) {
      if (st.material?.name !== material) throw new Error(`Materyal yok: ${material}. Kütüphane: ${lib.map((m) => m.name).join(', ') || '—'} (önce save_material).`);
      warnings.push('Materyal kütüphanede yok, yalnız editörde; kalıcı olması için save_material ile kaydet.');
    }
    next[target] = material;
  }
  if (target.startsWith('prop:') && !(st.props || []).some((p) => p.id === target.slice(5))) warnings.push(`Takılı eşya yok: ${target.slice(5)} (list_props → attached)`);
  const r = await post('/api/claude/overrides', { overrides: next });
  return text({ overrides: r.overrides, warnings, browserConnected: r.clients > 0 });
});

server.registerTool('get_lighting', {
  description: 'Önizlemenin ortak sahne ışığı (tüm UPE shader\'ları; Unity ekseninde): rotation (yönlü ışık Euler\'i, derece), color, intensity, ambient, ambientIntensity.',
  inputSchema: {},
}, async () => { await ensureServer(); return text(normalizeLighting((await get('/api/state')).lighting)); });

server.registerTool('set_lighting', {
  description: `Önizleme sahne ışığını değiştirir (verilen alanlar birleştirilir, diğerleri korunur). lighting = { rotation:[x,y,z] (Unity yönlü ışık Euler'i, derece), color:"#rrggbb", intensity, ambient:"#rrggbb", ambientIntensity }; varsayılan ${JSON.stringify(defaultLighting())}. Yalnız önizleme; Unity sahnesine dokunmaz.`,
  inputSchema: { lighting: z.object({ rotation: vec3.optional(), color: z.string().optional(), intensity: z.number().min(0).optional(), ambient: z.string().optional(), ambientIntensity: z.number().min(0).optional() }) },
}, async ({ lighting }) => {
  await ensureServer(); const st = await get('/api/state');
  const r = await post('/api/claude/lighting', { lighting: normalizeLighting({ ...normalizeLighting(st.lighting), ...lighting }) });
  return text({ lighting: r.lighting, browserConnected: r.clients > 0 });
});

server.registerTool('render_material', {
  description: 'Editördeki materyali kontak sayfası PNG\'si olarak çizer (bakış açıları/anlar yan yana). Editör tarayıcıda (uygulama içi tarayıcı) açık olmalı. Her önemli değişiklikten sonra görsel kontrol için kullan. '
    + 'views: bakış açıları (front | side | back | top | threequarter; varsayılan ["threequarter","front","side"]; uzaklık otomatik), ya da camera { position, target } (metre, Unity eksenleri) tek kare. target: önizleme nesnesi (sphere|cube|plane|capsule|torus|hero|prop:<id>; verilmezse materyalin preview.target), time: zaman kullanan shader için an (sn), size: hücre boyu (px), bg: arka plan rengi.',
  inputSchema: {
    views: z.array(z.enum(['front', 'side', 'back', 'top', 'threequarter'])).min(1).max(8).optional(), size: z.number().int().min(128).max(1024).default(320).describe('Hücre boyu (px)'),
    target: z.string().optional(), time: z.number().min(0).optional(), bg: z.string().optional(),
    camera: z.object({ position: vec3, target: vec3.optional() }).optional(),
  },
}, async (args) => {
  await ensureServer(); const ping = await get('/api/ping');
  if (!ping.clients) throw new Error(`Editör tarayıcıda açık değil (${BASE}). render_material görüntüyü tarayıcıdaki editör çizer: editörü uygulama içi tarayıcıda aç, sonra tekrar dene.`);
  if (!(await get('/api/state')).material) throw new Error('Editörde materyal yok. Önce new_material / load_material.');
  const r = await post('/api/claude/render', { kind: 'material', ...args });
  if (!r.png) throw new Error('Editör görüntü döndürmedi (Materyal modunu destekleyen editör sürümü açık mı?).');
  return { content: [{ type: 'image', data: r.png.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' }] };
});

server.registerTool('list_material_textures', {
  description: 'Materyal dokuları: materials/textures/*.png (texture değerinde tex: uzantısız ad, ör. "checker") + özel adlar (white/black/gray/bump: önizlemede üretilir, Unity\'de shader varsayılanı; @mesh: önizleme nesnesinin kendi dokusu, Unity\'de unityPath gerekir). Veri dokuları (gürültü, maske) için shader özelliğinde linear:true.',
  inputSchema: {},
}, async () => { await ensureServer(); return text({ files: await get('/api/material-textures'), special: SPECIAL_TEX }); });

server.registerTool('send_material_to_unity', {
  description: 'Materyali TEK ADIMDA Unity projesine gönderir: importer script\'leri Assets/Editor/UnityPreview/\'a kurulur, özel shader\'ın .shader\'ı Assets/UnityPreview/Shaders/ (UnityPreview/<ad>), kullandığı dokular Assets/UnityPreview/Materials/Textures/, yük Assets/UnityPreview/Materials/<ad>.mat.json yazılır; Unity açıksa birkaç saniyede <ad>.mat üretir. '
    + 'name: kütüphaneden ad (verilmezse editördeki materyal), all: tüm kütüphane. Editörde aynı adlı kaydedilmemiş özel shader çalışma kopyası varsa o gider. ≤25 sn bekler; Unity kapalıysa "waiting" döner ve açılınca işlenir. Önce set_unity_project. '
    + 'Yanıt: { ok, sent, imported, waiting, materials (.mat yolları), shaders (.shader yolları), shaderDetails, shaderErrors:[{ shader, line, message }] (Unity derleme hataları), textures, missingTextures, warnings?, note | error }.',
  inputSchema: { name: z.string().optional(), all: z.boolean().default(false) },
}, async ({ name, all }) => { await ensureServer(); return text(await post('/api/unity/send-material', { name, all })); });

server.registerTool('send_shader_to_unity', {
  description: 'Yalnız ÖZEL shader\'ı Unity\'ye yazar (Assets/UnityPreview/Shaders/<ad>.shader, Unity adı UnityPreview/<ad>) ve Unity derleme sonucunu bekler (≤25 sn): shaderErrors:[{ shader, line, message }]. Hazır (builtin) shader\'lar gönderilemez (Unity\'de zaten var). '
    + 'name: ad ya da unityName (verilmezse editördeki shader; editörde aynı adlı kaydedilmemiş çalışma kopyası varsa o gider). İçerik değişmediyse Unity yeniden derlemez: unchanged:true + son bilinen durum döner. Önce set_unity_project.',
  inputSchema: { name: z.string().optional() },
}, async ({ name }) => { await ensureServer(); return text(await post('/api/unity/send-shader', { name })); });

// ── Model modu (model görüntüleyici: GLB/FBX/GLTF/OBJ). Modeli editör (tarayıcı) yükler ve ölçer; bilgi /api/model-view ile döner
const MODEL_DIR_NAMES = ['meshes', 'models', 'props'];
const modelViewSchema = z.object({
  shading: z.enum(['texture', 'clay', 'normals', 'uv', 'unlit']).optional().describe('Doku | Kil | Normaller | UV kontrol | Işıksız'),
  wireframe: z.boolean().optional().describe('Tel kafes (üstte)'), skeleton: z.boolean().optional().describe('İskelet'),
  bounds: z.boolean().optional().describe('Sınır kutusu + ölçüler'), axes: z.boolean().optional().describe('Orijin/pivot eksenleri'),
  grid: z.boolean().optional().describe('Zemin ızgarası'), scaleRef: z.boolean().optional().describe('1,8 m boy referansı'),
  rotate: z.boolean().optional().describe('Döner tabla'), env: z.boolean().optional().describe('Ortam yansıması (IBL)'),
  exposure: z.number().min(0).optional().describe('Pozlama'), background: z.string().optional().describe('Arka plan rengi (#hex)'),
  unit: z.enum(['auto', 'm', 'cm']).optional().describe('Dosyanın birimi (auto: otomatik)'),
  clip: z.string().nullable().optional().describe('Gömülü animasyon adı (null: animasyonsuz / bind pozu)'),
  speed: z.number().optional().describe('Oynatma hızı çarpanı'), paused: z.boolean().optional().describe('Duraklat (time ile o karede durur)'),
  time: z.number().min(0).optional().describe('Animasyon anı (sn)'), hidden: z.array(z.string()).optional().describe('Gizlenecek parça (mesh) adları'),
});

server.registerTool('list_model_files', {
  description: 'Model sekmesinde görüntülenebilecek modeller (GLB/FBX/GLTF/OBJ): meshes/ genel modeller (çevre, düşman vb.), models/ karakterler, props/ eşyalar. Yanıt { meshes:[...], models:[...], props:[...] }; view_model { name, dir } ile aç.',
  inputSchema: {},
}, async () => { await ensureServer(); return text(await get('/api/model-files')); });

server.registerTool('view_model', {
  description: 'Editörü Model sekmesine geçirir ve modeli yükler. path: mutlak dosya yolu (GLB/FBX/GLTF/OBJ) → meshes/\'e kopyalanır (aynı ad üzerine yazılır; .gltf harici .bin/doku kullanıyorsa GLB tercih et). name: kütüphanedeki dosya (list_model_files; uzantısız da olur), dir verilmezse meshes → models → props sırasıyla aranır. '
    + 'name/path yoksa yalnız görünüm ayarlarını değiştirir (view birleştirilir, verilmeyenler korunur; model değişince clip/hidden/time/paused sıfırlanır, clip verilmezse ilk gömülü animasyon oynar).Yanıt modelin bilgisini içerir (editör ölçer: boyut m, üçgen, köşe, parça, materyal, doku, kemik, gömülü animasyonlar); editör 60 sn içinde yükleyemezse timeout:true. '
    + 'Kullanıcıya göstermek için bundan sonra editörü tarayıcıda (uygulama içi tarayıcı) açık tut; görsel kontrol: render_model, kullanıcının notları: get_model_view.',
  inputSchema: {
    name: z.string().optional().describe('Dosya adı (list_model_files), ör. "Elarion_Katana.glb" ya da "Elarion_Katana"'),
    dir: z.enum(MODEL_DIR_NAMES).optional().describe('Yalnız bu klasörde ara'),
    path: z.string().optional().describe('Mutlak dosya yolu, ör. "C:/Elarion/Art/Arena/sutun.glb" (meshes/\'e kopyalanır)'),
    view: modelViewSchema.optional().describe('Görünüm ayarları (verilenler mevcutların üstüne yazılır)'),
  },
}, async ({ name, dir, path: src, view }) => {
  await ensureServer();
  const r = await fetch(BASE + '/api/claude/model-view', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, dir, path: src, view }) });
  const j = await r.json();
  if (!r.ok) throw new Error((j.error || r.statusText) + (j.files ? ' — mevcut: ' + Object.entries(j.files).map(([d, l]) => `${d}/ ${l.join(', ') || '—'}`).join(' · ') : ''));
  const out = { ok: !j.error && !j.timeout, file: j.file, view: j.view, browserConnected: j.clients > 0 };
  if (!j.clients) out.note = `Editör tarayıcıda açık değil (${BASE}); açılınca son model yüklenir.`;
  else if (j.timeout) out.note = 'Editör 60 sn içinde modeli yükleyip bildirmedi (dosya çok büyük mü? Model sekmesini destekleyen editör sürümü açık mı?). Sonra get_model_view ile bak.';
  else { out.info = capInfo(j.info); if (j.error) out.error = j.error; }
  if (!j.file) out.note = (out.note ? out.note + ' ' : '') + 'Açık model yok: name (list_model_files) ya da path ver.';
  if (j.warning) out.warning = j.warning;
  return text(out);
});

server.registerTool('get_model_view', {
  description: 'Model sekmesinin tam durumu: açık model (file: { dir, name }), görünüm ayarları (view), editörün ölçtüğü tam bilgi (info: boyut, üçgen, köşe, parçalar, materyaller, dokular, kemikler, animasyonlar) + Model modunda yazılan kullanıcı notları. Kullanıcı modelde bir şey gösterdiğinde / not yazdığında çağır. acknowledge:true Model notlarını temizler.',
  inputSchema: { acknowledge: z.boolean().default(false).describe('true: Model notlarını temizle') },
}, async ({ acknowledge }) => {
  await ensureServer(); const st = await get('/api/state'); const mv = st.modelView || {};
  const result = { file: mv.file ?? null, view: mv.view ?? {}, info: mv.info ?? null, notes: notesOf(st, 'model').map(({ mode, ...n }) => n) };
  if (!result.file) result.note = 'Model sekmesinde model yok; view_model { name | path } ile aç.';
  else if (!result.info) result.note = 'Model bilgisi henüz yok: editör modeli yükleyip bildirmedi (tarayıcıda açık mı?).';
  if (acknowledge) await post('/api/notes/clear?mode=model');
  return text(result);
});

server.registerTool('render_model', {
  description: 'Model sekmesindeki modeli kontak sayfası PNG\'si olarak çizer (bakış açıları yan yana). Editör tarayıcıda (uygulama içi tarayıcı) açık olmalı; önce view_model. views: front | side | back | top | threequarter (varsayılan ["threequarter","front","side"]; uzaklık otomatik, model kadraja sığar) ya da camera { position, target } (metre, Unity eksenleri: +X sağ, +Y yukarı, +Z ileri) tek kare. '
    + 'view: yalnız bu render için geçici görünüm ayarları (ör. { shading:"clay", wireframe:true } topoloji, { shading:"uv" } UV kontrolü, { bounds:true, scaleRef:true } ölçek; editördeki ayarlar değişmez). time: animasyon anı (sn; view.clip ile klip seçilir). size: hücre boyu (px).',
  inputSchema: {
    views: z.array(z.enum(['front', 'side', 'back', 'top', 'threequarter'])).min(1).max(8).optional(), size: z.number().int().min(128).max(1024).default(320).describe('Hücre boyu (px)'),
    camera: z.object({ position: vec3, target: vec3.optional() }).optional().describe('Tek kare kamera (metre, Unity eksenleri)'),
    view: modelViewSchema.optional().describe('Yalnız bu render için geçici görünüm ayarları'), time: z.number().min(0).optional().describe('Animasyon anı (sn)'),
  },
}, async ({ views, size, camera, view, time }) => {
  await ensureServer(); const ping = await get('/api/ping');
  if (!ping.clients) throw new Error(`Editör tarayıcıda açık değil (${BASE}). render_model görüntüyü tarayıcıdaki editör çizer: editörü uygulama içi tarayıcıda aç, sonra tekrar dene.`);
  if (!(await get('/api/state')).modelView?.file) throw new Error('Model sekmesinde model yok. Önce view_model { name | path }.');
  const r = await post('/api/claude/render', { kind: 'model', views: views ?? (camera ? undefined : ['threequarter', 'front', 'side']), size, camera, view, time });
  if (!r.png) throw new Error('Editör görüntü döndürmedi (Model sekmesini destekleyen editör sürümü açık mı?).');
  return { content: [{ type: 'image', data: r.png.replace(/^data:image\/png;base64,/, ''), mimeType: 'image/png' }] };
});

await ensureServer().catch(() => {});
await server.connect(new StdioServerTransport());
