// Anim Ref MCP sunucusu (stdio). Editör sunucusuna (server.js) HTTP ile bağlanır; çalışmıyorsa başlatır.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as THREE from 'three';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ANIMREF_PORT || 5177);
const BASE = `http://127.0.0.1:${PORT}`;
const EXPORTS = path.join(ROOT, 'exports');

const get = (p) => fetch(BASE + p).then((r) => r.json());
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j;
};
async function ensureServer() {
  try { await get('/api/ping'); return; } catch { /* başlat */ }
  spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();
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

const server = new McpServer({ name: 'anim-ref', version: '1.0.0' });

server.registerTool('get_status', {
  description: 'Editörün durumu: açık model, kemik listesi, animasyon özeti, kullanıcı notu sayısı. Önce bunu çağır.',
  inputSchema: {},
}, async () => {
  await ensureServer(); const st = await get('/api/state'); const ping = await get('/api/ping');
  const a = st.anim;
  return text({
    editorUrl: BASE, browserConnected: ping.clients > 0, model: st.modelName,
    bones: st.rig?.bones.map((b) => b.name + (b.parent ? ` (<- ${b.parent})` : '')) ?? [],
    unitScale: st.rig?.unitScale,
    anim: a ? { name: a.name, fps: a.fps, length: a.length, loop: a.loop, tracks: Object.fromEntries(Object.entries(a.tracks).map(([k, t]) => [k, { rotKeys: t.rot?.length ?? 0, posKeys: t.pos?.length ?? 0 }])) } : null,
    pendingNotes: st.notes.length,
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
  const result = { notes: st.notes.map((n) => ({ frame: n.frame, bone: n.bone, text: n.text })), changes: [], addedKeys: {}, removedKeys: {} };
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
  if (acknowledge) { await post('/api/notes/clear'); await post('/api/baseline'); }
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

await ensureServer().catch(() => {});
await server.connect(new StdioServerTransport());
