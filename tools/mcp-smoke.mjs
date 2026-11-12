// MCP uçtan uca duman testi: `node mcp.js`'i ayrı portta (UPE_PORT, varsayılan 5291) başlatır, tarayıcı gerektirmeyen
// VFX + materyal/shader araçlarını + eski animasyon araçlarından birkaçını dener (sahte Unity yanıtı dahil). Her adım PASS/FAIL/SKIP; hata varsa çıkış kodu 1.
// Sahte Unity projesi: UPE_SMOKE_UNITY (yoksa %TEMP%/upe_smoke_fakeunity), sahte Unreal projesi: UPE_SMOKE_UNREAL (yoksa %TEMP%/upe_smoke_fakeunreal);
// klasörde .upe-smoke işareti yoksa dokunulmaz. Unreal adımları MCP adresini boş bir porta ayarlar (gerçek UE editörüne gönderilmez).
// Çalıştır: node tools/mcp-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { defaultLighting } from '../public/shader-schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.UPE_PORT || 5291);
if (PORT === 5177) { console.error('5177 ana editör; duman testini başka portta çalıştır.'); process.exit(1); }
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'smoke_test_vfx', TEX = 'smoke_test_tex';
const SH = 'smoke_test_shader', MAT = 'smoke_test_mat', MAT2 = 'smoke_test_mat2', MTEX = 'smoke_test_mtex'; // materyal/shader testi
const FAKE = path.resolve(process.env.UPE_SMOKE_UNITY || path.join(os.tmpdir(), 'upe_smoke_fakeunity'));

let fails = 0; const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const ping = () => fetch(BASE + '/api/ping').then((r) => r.ok, () => false);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// sahte Unity projesi (yalnız işaretli klasör temizlenir)
if (fs.existsSync(FAKE) && !fs.existsSync(path.join(FAKE, '.upe-smoke'))) { console.error('Sahte Unity klasörü işaretsiz, dokunulmuyor: ' + FAKE); process.exit(1); }
fs.rmSync(FAKE, { recursive: true, force: true });
for (const d of ['Assets', 'ProjectSettings']) fs.mkdirSync(path.join(FAKE, d), { recursive: true });
fs.writeFileSync(path.join(FAKE, '.upe-smoke'), 'mcp-smoke');
// sahte Unreal projesi (.uproject'li klasör; yalnız işaretliyse temizlenir)
const FAKE_UE = path.resolve(process.env.UPE_SMOKE_UNREAL || path.join(os.tmpdir(), 'upe_smoke_fakeunreal'));
if (fs.existsSync(FAKE_UE) && !fs.existsSync(path.join(FAKE_UE, '.upe-smoke'))) { console.error('Sahte Unreal klasörü işaretsiz, dokunulmuyor: ' + FAKE_UE); process.exit(1); }
fs.rmSync(FAKE_UE, { recursive: true, force: true }); fs.mkdirSync(FAKE_UE, { recursive: true });
fs.writeFileSync(path.join(FAKE_UE, 'SmokeUE.uproject'), JSON.stringify({ FileVersion: 3, EngineAssociation: '5.8' }));
fs.writeFileSync(path.join(FAKE_UE, '.upe-smoke'), 'mcp-smoke');
// boş port: bağlanılınca reddedilir (sahte "editör kapalı")
const deadPort = () => new Promise((ok, no) => { const s = net.createServer(); s.once('error', no); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

if (await ping()) { console.error(`Port ${PORT} zaten kullanımda (eski bir sunucu açık olabilir); duman testi kendi sunucusunu başlatamaz.`); process.exit(1); }

const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'mcp.js')], cwd: ROOT, env: { ...process.env, UPE_PORT: String(PORT) }, stderr: 'inherit' });
const client = new Client({ name: 'upe-smoke', version: '1.0.0' });
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
  const t = r.content?.find((c) => c.type === 'text')?.text;
  let json = null; try { json = t ? JSON.parse(t) : null; } catch { /* düz metin */ }
  return { isError: !!r.isError, text: t || '', json, raw: r };
};
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, 'istisna: ' + (e?.stack || e)); } };
const postJ = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
// sahte Unity: trigger() doğru olunca respond() bir kez (importer'ın .mat / durum satırı yazmasını taklit eder)
const fakeUnity = (trigger, respond) => { let done = false; const t = setInterval(() => { try { if (!done && trigger()) { done = true; respond(); } } catch { /* henüz yok */ } }, 100); return () => clearInterval(t); };

try {
  await client.connect(transport);
  check('MCP bağlantısı', true, `port ${PORT}`);

  await step('araç listesi', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    const need = ['get_status', 'list_animations', 'set_keys', 'send_to_unity', 'vfx_reference', 'get_vfx', 'set_vfx', 'update_vfx', 'add_emitter', 'remove_emitter', 'get_vfx_user_edits', 'render_vfx', 'list_vfx', 'save_vfx', 'load_vfx', 'delete_vfx', 'list_vfx_textures', 'set_editor_mode', 'send_vfx_to_unity'];
    const missing = need.filter((n) => !names.includes(n));
    check('araç listesi', !missing.length, missing.length ? 'eksik: ' + missing.join(', ') : `${names.length} araç`);
    check('sunucu adı', client.getServerVersion()?.name === 'unity-preview-editor' && client.getServerVersion()?.version === '2.0.0', JSON.stringify(client.getServerVersion()));
  });

  await step('get_status', async () => {
    const r = await call('get_status'); const s = r.json;
    check('get_status', !r.isError && s && s.editorUrl?.includes(String(PORT)) && 'mode' in s && 'vfx' in s && Array.isArray(s.bones), `mode=${s?.mode} url=${s?.editorUrl}`);
  });

  await step('list_animations (eski)', async () => {
    const r = await call('list_animations');
    check('list_animations (eski)', !r.isError && Array.isArray(r.json), `${r.json?.length} animasyon`);
  });

  await step('vfx_reference', async () => {
    const r = await call('vfx_reference');
    check('vfx_reference', !r.isError && r.text.includes('upe-vfx-1') && r.text.includes('Dokular') && r.text.includes('sparks'), `${r.text.length} karakter`);
  });

  await step('set_vfx (2 şablonlu emitter)', async () => {
    const r = await call('set_vfx', { effect: { name: NAME, duration: 1.5, emitters: [{ preset: 'fire', name: 'alev', main: { startSize: [0.3, 0.5] } }, { preset: 'embers' }] } });
    const g = (await call('get_vfx')).json;
    const ok = !r.isError && r.json?.ok && g?.name === NAME && g.emitters.length === 2 && g.emitters[0].name === 'alev' && g.emitters[0].renderer.texture === 'flame'
      && g.emitters[0].main.startSize[1] === 0.5 && g.emitters[1].renderer.texture === 'ember';
    check('set_vfx (2 şablonlu emitter)', ok, `emitters=${g?.emitters?.map((e) => e.name).join(',')} warnings=${r.json?.warnings?.length}`);
    const st = (await call('get_status')).json;
    check('get_status VFX özeti', st?.mode === 'vfx' && st.vfx?.name === NAME && st.vfx.emitters.length === 2 && st.vfx.emitters[0].texture === 'flame' && 'bursts' in st.vfx.emitters[0] && 'rateOverTime' in st.vfx.emitters[0], JSON.stringify(st?.vfx?.emitters?.[0]));
  });

  await step('update_vfx (1 geçerli + 1 geçersiz)', async () => {
    const r = await call('update_vfx', { changes: [{ emitter: 'alev', path: 'renderer.intensity', value: 3.5 }, { emitter: 'alev', path: 'main.yokBoyleAlan', value: 1 }] });
    const g = (await call('get_vfx', { emitters: ['alev'] })).json;
    check('update_vfx (1 geçerli + 1 geçersiz)', !r.isError && r.json?.errors?.length === 1 && r.json.applied?.length === 1 && g?.emitters?.[0]?.renderer?.intensity === 3.5, `errors=${JSON.stringify(r.json?.errors)}`);
    const r2 = await call('update_vfx', { changes: [{ path: 'preview.bloom', value: 99 }] }); // efekt düzeyi + kırpma
    check('update_vfx efekt düzeyi (kırpma)', !r2.isError && r2.json?.applied?.[0]?.value === 5, JSON.stringify(r2.json?.applied));
  });

  await step('add_emitter (sparks)', async () => {
    const r = await call('add_emitter', { preset: 'sparks' });
    const g = (await call('get_vfx')).json;
    check('add_emitter (sparks)', !r.isError && g?.emitters?.length === 3 && g.emitters[2].renderer.texture === 'spark' && r.json?.added === g.emitters[2].name, `added=${r.json?.added}`);
  });

  await step('remove_emitter', async () => {
    const r = await call('remove_emitter', { emitter: 'kor' });
    const g = (await call('get_vfx')).json;
    check('remove_emitter', !r.isError && g?.emitters?.length === 2 && !g.emitters.some((e) => e.name === 'kor'), `kalan=${g?.emitters?.map((e) => e.name).join(',')}`);
    const r2 = await call('remove_emitter', { emitter: 'yok_boyle' });
    check('remove_emitter (olmayan → hata)', r2.isError, r2.text.slice(0, 80));
  });

  await step('get_vfx_user_edits', async () => {
    const r0 = (await call('get_vfx_user_edits')).json;
    check('get_vfx_user_edits (Claude değişikliği referans)', r0 && r0.changes?.length === 0, `changes=${r0?.changes?.length}`);
    // tarayıcı düzeltmesini taklit et: /api/vfx (olaysız) + VFX notu
    const st = await (await fetch(BASE + '/api/state')).json(); const v = st.vfx; v.emitters[0].main.startSize = [0.4, 0.6];
    await fetch(BASE + '/api/vfx', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) });
    await fetch(BASE + '/api/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'vfx', text: 'alev biraz daha büyük', emitter: 'alev' }) });
    await fetch(BASE + '/api/note', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'animasyon notu', frame: 3 }) });
    const r1 = (await call('get_vfx_user_edits')).json;
    const c = r1?.changes?.find((x) => x.path === 'emitters.alev.main.startSize');
    check('get_vfx_user_edits (fark + yalnız VFX notu)', !!c && c.to[0] === 0.4 && r1.notes.length === 1 && r1.notes[0].text === 'alev biraz daha büyük', JSON.stringify({ c, notes: r1?.notes }));
    const r2 = (await call('get_vfx_user_edits', { acknowledge: true })).json; void r2;
    const r3 = (await call('get_vfx_user_edits')).json;
    const s = (await call('get_status')).json;
    check('get_vfx_user_edits acknowledge', r3?.changes?.length === 0 && r3.notes.length === 0 && s?.pendingNotes >= 1, `anim notları korunur: ${s?.pendingNotes}`);
    const a = (await call('get_user_edits')).json;
    check('get_user_edits (eski) yalnız anim notları', a && !a.notes.some((n) => n.text === 'alev biraz daha büyük') && a.notes.some((n) => n.text === 'animasyon notu'), `notes=${a?.notes?.length}`);
    await call('get_user_edits', { acknowledge: true }); // test notunu temizle
  });

  await step('save/list/load/delete_vfx', async () => {
    const s = await call('save_vfx', { name: NAME });
    const file = path.join(ROOT, 'vfx', NAME + '.json');
    check('save_vfx', !s.isError && s.json?.saved === NAME && fs.existsSync(file), s.text.slice(0, 80));
    const l = (await call('list_vfx')).json; const it = l?.find((x) => x.name === NAME);
    check('list_vfx', !!it && it.emitters === 2 && it.duration === 1.5, JSON.stringify(it));
    await call('update_vfx', { changes: [{ path: 'duration', value: 0.7 }] });
    const ld = await call('load_vfx', { name: NAME }); const g = (await call('get_vfx')).json;
    check('load_vfx', !ld.isError && ld.json?.loaded === NAME && g?.duration === 1.5, `duration=${g?.duration}`);
    const ld2 = await call('load_vfx', { name: 'yok_boyle_efekt' });
    check('load_vfx (olmayan → hata)', ld2.isError, ld2.text.slice(0, 80));
    const d = await call('delete_vfx', { name: NAME }); const l2 = (await call('list_vfx')).json;
    check('delete_vfx', !d.isError && !l2.some((x) => x.name === NAME) && !fs.existsSync(file), d.text);
  });

  await step('list_vfx_textures', async () => {
    const r = (await call('list_vfx_textures')).json;
    check('list_vfx_textures', r && ['soft', 'spark', 'flame', 'ember'].every((k) => k in r.builtin) && Array.isArray(r.custom), `özel=${r?.custom?.length}`);
  });

  await step('HTTP: doku yükleme + /vfx-textures/ + mod doğrulama', async () => { // tarayıcının kullandığı uçlar
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await (await fetch(BASE + `/api/upload-vfx-texture?name=${TEX}.png`, { method: 'POST', body: png })).json();
    const list = await (await fetch(BASE + '/api/vfx/textures')).json();
    const got = Buffer.from(await (await fetch(BASE + `/vfx-textures/${TEX}.png`)).arrayBuffer());
    const t = (await call('list_vfx_textures')).json;
    check('doku yükleme + statik eşleme', up.name === TEX && list.includes(TEX) && got.equals(png) && t?.custom?.includes(TEX), JSON.stringify(up));
    const bad = await fetch(BASE + '/api/mode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'yok' }) });
    check('geçersiz mod → 400', bad.status === 400, String(bad.status));
  });

  await step('set_editor_mode', async () => {
    const a = await call('set_editor_mode', { mode: 'anim' }); const s1 = (await call('get_status')).json;
    const b = await call('set_editor_mode', { mode: 'vfx' }); const s2 = (await call('get_status')).json;
    check('set_editor_mode', !a.isError && !b.isError && s1?.mode === 'anim' && s2?.mode === 'vfx', `${s1?.mode} → ${s2?.mode}`);
  });

  await step('render_vfx (tarayıcı yok → anlaşılır hata)', async () => {
    const r = await call('render_vfx', { count: 4 });
    check('render_vfx (tarayıcı yok → anlaşılır hata)', r.isError && /tarayıcı/i.test(r.text), r.text.slice(0, 120));
  });

  await step('send_vfx_to_unity', async () => {
    const u = await call('set_unity_project', { project: FAKE });
    check('set_unity_project (sahte proje)', !u.isError && u.json?.valid === true && path.resolve(u.json.project) === FAKE, u.text.slice(0, 120));
    if (u.isError || path.resolve(u.json?.project || '') !== FAKE) throw new Error('Unity projesi sahte klasöre ayarlanamadı; gönderim atlandı (gerçek projeye yazmamak için).');
    const bad = await call('send_vfx_to_unity', { name: 'yok_boyle_efekt' });
    check('send_vfx_to_unity (olmayan → hata)', bad.isError, bad.text.slice(0, 80));
    const t0 = Date.now(); const r = await call('send_vfx_to_unity'); const j = r.json;
    check('send_vfx_to_unity yanıtı (waiting)', !r.isError && j && j.ok === false && j.sent?.includes(NAME) && j.waiting?.includes(NAME) && Array.isArray(j.missingTextures), `${((Date.now() - t0) / 1000).toFixed(1)} sn, missingTextures=${JSON.stringify(j?.missingTextures)}`);
    const dir = path.join(FAKE, 'Assets', 'UnityPreview', 'VFX');
    let eff = null; try { eff = JSON.parse(fs.readFileSync(path.join(dir, NAME + '.vfx.json'), 'utf8')); } catch { /* yok */ }
    check('VFX json kopyası', eff?.format === 'upe-vfx-1' && eff.name === NAME && eff.emitters.length === 2, eff ? `${eff.emitters.map((e) => e.name).join(',')}` : 'dosya yok');
    const used = [...new Set((eff?.emitters || []).map((e) => e.renderer.texture))];
    const texBad = used.filter((t) => {
      const src = path.join(ROOT, 'vfx', 'textures', t + '.png'), dst = path.join(dir, 'Textures', t + '.png');
      return fs.existsSync(src) ? !(fs.existsSync(dst) && fs.readFileSync(src).equals(fs.readFileSync(dst))) : !j.missingTextures.includes(t);
    });
    check('doku kopyaları (ya da missingTextures)', used.length > 0 && !texBad.length, `kullanılan=${used.join(',')} kopyalanan=${used.filter((t) => !j.missingTextures.includes(t)).join(',') || '—'}`);
    const cs = fs.readdirSync(path.join(ROOT, 'unity')).filter((f) => /^UnityPreviewVfx.*\.cs$/.test(f));
    if (!cs.length) console.log('SKIP  importer .cs kopyası — unity/UnityPreviewVfx*.cs henüz yok');
    else {
      const csBad = cs.filter((f) => { const d = path.join(FAKE, 'Assets', 'Editor', 'UnityPreview', f); return !(fs.existsSync(d) && fs.readFileSync(d).equals(fs.readFileSync(path.join(ROOT, 'unity', f)))); });
      check('importer .cs kopyası', !csBad.length, csBad.length ? 'eksik: ' + csBad.join(',') : cs.join(', '));
    }
  });

  // ── Unreal (docs/UNREAL.md): editör yok; MCP adresi boş bir porta ayarlanır (gerçek UE editörüne asla gönderilmez)
  await step('U: Unreal araçları', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    const missing = ['get_unreal_info', 'set_unreal_project', 'send_vfx_to_unreal', 'send_animation_to_unreal'].filter((n) => !names.includes(n));
    check('U: araç listesi', !missing.length, missing.length ? 'eksik: ' + missing.join(', ') : '');
    const deadUrl = `http://127.0.0.1:${await deadPort()}/mcp`;
    const bad = await call('set_unreal_project', { project: os.tmpdir() });
    check('U: set_unreal_project (.uproject yok → hata)', bad.isError && /uproject/i.test(bad.text), bad.text.slice(0, 100));
    const badC = await call('set_unreal_project', { contentPath: 'Game/yanlis yol' });
    check('U: set_unreal_project (geçersiz içerik yolu → hata)', badC.isError && /Game/.test(badC.text), badC.text.slice(0, 100));
    const s = await call('set_unreal_project', { project: path.join(FAKE_UE, 'SmokeUE.uproject'), mcpUrl: deadUrl, contentPath: '/Game/UPE/SmokeVFX/' });
    const j = s.json;
    check('U: set_unreal_project (.uproject yolu → klasör)', !s.isError && path.resolve(j?.project || '') === FAKE_UE && j.projectValid === true && j.projectName === 'SmokeUE' && j.mcpUrl === deadUrl && j.contentPath === '/Game/UPE/SmokeVFX', s.text.slice(0, 160));
    if (j?.mcpUrl !== deadUrl) throw new Error('MCP adresi boş porta ayarlanamadı; gönderim atlandı (gerçek editöre gitmesin).');
    const info = await call('get_unreal_info');
    check('U: get_unreal_info (editör yok)', !info.isError && info.json?.status && info.json.status.connected === false && info.json.mcpUrl === deadUrl, JSON.stringify(info.json?.status).slice(0, 120));
    await wait(600); // durum dosyası gecikmeli yazılır (save 300 ms)
    let saved = null; try { saved = JSON.parse(fs.readFileSync(path.join(ROOT, '.ports', `project-${PORT}.json`), 'utf8')).unreal; } catch { /* yok */ }
    check('U: ayar kalıcı (durum dosyası)', saved && path.resolve(saved.project || '') === FAKE_UE && saved.mcpUrl === deadUrl && saved.contentPath === '/Game/UPE/SmokeVFX', JSON.stringify(saved));
    const none = await call('send_vfx_to_unreal', { name: 'yok_boyle_efekt' });
    check('U: send_vfx_to_unreal (olmayan → hata)', !none.isError && none.json?.ok === false && /yok_boyle_efekt/.test(none.json.error || ''), none.text.slice(0, 100));
    const r = await call('send_vfx_to_unreal'); const rj = r.json; // editördeki efekt (kütüphane kopyası yukarıda silindi)
    const msg = [rj?.error, ...Object.values(rj?.errors || {})].filter(Boolean).join('; ');
    check('U: send_vfx_to_unreal (editör yok → anlaşılır hata)', !r.isError && rj?.ok === false && msg.length > 0, msg.slice(0, 120));
    const http = await fetch(BASE + '/api/unreal/status').then((x) => x.json());
    check('U: GET /api/unreal/status', http.status?.connected === false && http.projectName === 'SmokeUE', '');
  });

  // ── Animasyon → Unreal AnimSequence (docs/UNREAL.md "Animasyon"): saf dönüştürme + sahte proje; gerçek editöre gönderilmez
  await step('UA: saf dönüştürme (animToUnrealPlan)', async () => {
    const { runAnimPlanTest } = await import('./ue-anim-plan-test.mjs');
    for (const [label, opts] of [['FBX varsayılanı', {}], ['Force Front X', { M: [[0, 0, 1], [-1, 0, 0], [0, 1, 0]] }], ['kökü olmayan iskelet', { ueRoot: false }]]) {
      const cs = runAnimPlanTest(opts); const bad = cs.filter((c) => !c.ok);
      check(`UA: plan (${label})`, !bad.length, bad.length ? bad.map((c) => `${c.name}: ${c.info}`).join(' | ') : `${cs.length} denetim · ${cs.find((c) => /eklem konumları/.test(c.name))?.info}`);
    }
  });
  await step('UA: send_animation_to_unreal + ayarlar', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'send_animation_to_unreal');
    check('UA: araç listesi + onay kuralı açıklamada', names.includes('send_animation_to_unreal') && /AÇIKÇA/.test(tool?.description || ''), '');
    const deadUrl = (await call('get_unreal_info')).json?.mcpUrl;
    if (!/^http/.test(deadUrl || '')) throw new Error('MCP hedefi boş port değil; animasyon gönderimi atlandı (gerçek editöre gitmesin).');
    // ayarlar: doğrulama + kalıcılık
    const badA = await call('set_unreal_project', { animContentPath: 'Game/yanlis' });
    const badS = await call('set_unreal_project', { animSkeleton: 'YBot' });
    const badV = await call('set_unreal_project', { ueMcpVersion: 'son' });
    check('UA: geçersiz animContentPath / animSkeleton / ueMcpVersion → hata', badA.isError && badS.isError && badV.isError, [badA, badS, badV].map((x) => x.text.slice(0, 40)).join(' | '));
    const s = (await call('set_unreal_project', { animContentPath: '/Game/UPE/SmokeAnim/', animSkeleton: '/Game/Smoke/YBot' })).json;
    check('UA: set_unreal_project (anim yolu + iskelet)', s?.animContentPath === '/Game/UPE/SmokeAnim' && s.animSkeleton === '/Game/Smoke/YBot' && s.mcpUrl === deadUrl, JSON.stringify({ a: s?.animContentPath, s: s?.animSkeleton }));
    // ue-mcp sürümü: projenin .mcp.json'u → köprü eklentisi (.uplugin) önce gelir → ayar en önce (farklıysa uyarı) → boş ayar projeye döner
    fs.writeFileSync(path.join(FAKE_UE, '.mcp.json'), JSON.stringify({ mcpServers: { 'ue-mcp': { command: 'npx', args: ['-y', 'ue-mcp@9.9.8', path.join(FAKE_UE, 'SmokeUE.uproject')] } } }));
    const v1 = (await call('get_unreal_info')).json;
    fs.mkdirSync(path.join(FAKE_UE, 'Plugins', 'UE_MCP_Bridge'), { recursive: true });
    fs.writeFileSync(path.join(FAKE_UE, 'Plugins', 'UE_MCP_Bridge', 'UE_MCP_Bridge.uplugin'), String.fromCharCode(0xFEFF) + JSON.stringify({ FileVersion: 3, VersionName: '9.9.9' }));
    const v2 = (await call('get_unreal_info')).json;
    const v3 = (await call('set_unreal_project', { ueMcpVersion: '1.2.3' })).json;
    const v4 = (await call('set_unreal_project', { ueMcpVersion: '' })).json;
    check('UA: ue-mcp sürümü (.mcp.json → köprü eklentisi → ayar+uyarı → proje)', v1?.ueMcpVersionUsed === '9.9.8' && v1.ueMcpVersionSource === 'proje .mcp.json'
      && v2?.ueMcpVersionUsed === '9.9.9' && v2.ueMcpVersionSource === 'proje köprü eklentisi' && !v2.ueMcpVersionWarning
      && v3?.ueMcpVersionUsed === '1.2.3' && v3.ueMcpVersionSource === 'ayar' && /9\.9\.9/.test(v3.ueMcpVersionWarning || '')
      && v4?.ueMcpVersionUsed === '9.9.9' && v4.ueMcpVersion === null,
      [v1, v2, v3, v4].map((v) => `${v?.ueMcpVersionUsed}/${v?.ueMcpVersionSource}`).join(' → '));
    // rig yokken / olmayan animasyon / http hedefi (editör yok): anlaşılır hata, isError değil
    await postJ('/api/rig', { modelName: null, rig: null });
    const noRig = (await call('send_animation_to_unreal')).json;
    check('UA: rig yok → anlaşılır hata', noRig?.ok === false && /Rig/.test(noRig.error || ''), (noRig?.error || '').slice(0, 80));
    await postJ('/api/rig', { modelName: 'smoke', rig: { unitScale: 1, bones: [{ name: 'mixamorigHips', parent: null, restQ: [0, 0, 0, 1], restP: [0, 1, 0] }, { name: 'mixamorigSpine', parent: 'mixamorigHips', restQ: [0, 0, 0, 1], restP: [0, 0.1, 0] }] } });
    await postJ('/api/anim', { name: 'smoke_anim', fps: 30, length: 3, loop: false, tracks: { mixamorigSpine: { rot: [[0, 0, 0, 0, 1], [2, 0.1, 0, 0, 0.995]] } } });
    const none = (await call('send_animation_to_unreal', { animation: 'yok_boyle_anim' })).json;
    check('UA: olmayan animasyon → hata', none?.ok === false && /yok_boyle_anim/.test(none.error || ''), (none?.error || '').slice(0, 80));
    const r = await call('send_animation_to_unreal'); const rj = r.json;
    check('UA: send_animation_to_unreal (editör yok → anlaşılır hata)', !r.isError && rj?.ok === false && /ue-mcp/.test(rj.error || ''), (rj?.error || '').slice(0, 120));
  });

  await step('get_status (eski araç, son)', async () => {
    const r = await call('get_status');
    check('get_status (son)', !r.isError && r.json?.mode === 'vfx', '');
  });

  // ── Materyal + Shader (docs/MATERIAL.md)
  await step('M: araç listesi', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name);
    const need = ['material_reference', 'list_shaders', 'get_shader', 'new_shader', 'set_shader', 'update_shader', 'save_shader', 'load_shader', 'delete_shader', 'get_shader_user_edits', 'list_materials', 'get_material', 'new_material', 'set_material', 'update_material', 'save_material', 'load_material', 'delete_material', 'get_material_user_edits', 'assign_material', 'get_lighting', 'set_lighting', 'render_material', 'list_material_textures', 'send_material_to_unity', 'send_shader_to_unity'];
    const missing = need.filter((n) => !names.includes(n));
    check('M: araç listesi', !missing.length, missing.length ? 'eksik: ' + missing.join(', ') : `${names.length} araç`);
    const st = (await call('get_status')).json;
    check('M: get_status alanları', st && 'material' in st && 'shader' in st && 'overrides' in st && Array.isArray(st.lighting?.rotation) && 'pendingMaterialNotes' in st && 'pendingShaderNotes' in st, Object.keys(st || {}).join(','));
  });

  await step('M: material_reference', async () => {
    const r = await call('material_reference');
    check('M: material_reference', !r.isError && ['upe-shader-1', 'upe-material-1', 'UPEInput', 'Elarion/ToonCharacter', 'dissolve', 'checker', '@mesh'].every((k) => r.text.includes(k)), `${r.text.length} karakter`);
  });

  await step('M: list_shaders + get_shader (builtin)', async () => {
    const l = (await call('list_shaders')).json; const bi = (l || []).filter((s) => s.builtin);
    check('M: list_shaders (4 builtin)', bi.length === 4 && bi.some((s) => s.unityName === 'Elarion/ToonCharacter' && s.properties.includes('_RimPower:range')) && bi.some((s) => s.unityName === 'Universal Render Pipeline/Lit'), bi.map((s) => s.unityName).join(', '));
    const g1 = (await call('get_shader', { name: 'Elarion/ToonCharacter' })).json;
    const g2 = (await call('get_shader', { name: 'elarion_toon', parts: ['properties'] })).json;
    check('M: get_shader builtin (unityName + ad + parts)', g1?.name === 'elarion_toon' && g1.builtin === true && g1.outline?.enabled && /frag\s*\(/.test(g1.code?.fragment) && g2?.properties?.length === g1.properties.length && !('code' in g2), `${g1?.properties?.length} özellik`);
    const g3 = await call('get_shader', { name: 'yok_boyle_shader' });
    check('M: get_shader (olmayan → hata)', g3.isError, g3.text.slice(0, 80));
  });

  await step('M: new_shader', async () => {
    const r = await call('new_shader', { name: SH, template: 'toon' }); const j = r.json;
    const g = (await call('get_shader')).json; const s = (await call('get_status')).json;
    check('M: new_shader (toon şablonu → editör)', !r.isError && j?.shader?.unityName === 'UnityPreview/' + SH && g?.name === SH && g.builtin === false && g.properties.some((p) => p.name === '_RimPower') && g.outline.enabled && s?.mode === 'shader' && s.shader?.name === SH, `mode=${s?.mode} props=${j?.shader?.properties?.length}`);
    check('M: new_shader derleme denetimi (tarayıcı yok → not)', j?.compile?.checked === false && /denetlenemedi/.test(j.compile.note || ''), (j?.compile?.note || '').slice(0, 90));
    const b = await call('new_shader', { name: 'elarion_toon' });
    check('M: new_shader (builtin adı → hata)', b.isError, b.text.slice(0, 80));
  });

  await step('M: update_shader', async () => {
    const r = await call('update_shader', { changes: [{ path: 'properties._RimPower.max', value: 10 }, { path: 'properties._DetailMap', value: { type: 'texture', label: 'Detay', default: 'white' } }, { path: 'renderState.cull', value: 'off' }, { path: 'yok.alan', value: 1 }] });
    const j = r.json; const g = (await call('get_shader')).json; const rp = g?.properties?.find((p) => p.name === '_RimPower');
    check('M: update_shader (3 geçerli + 1 geçersiz)', !r.isError && j?.errors?.length === 1 && j.applied?.length === 3 && rp?.max === 10 && g.properties.some((p) => p.name === '_DetailMap' && p.type === 'texture') && g.renderState.cull === 'off' && j.compile?.checked === false, `errors=${JSON.stringify(j?.errors)}`);
    const r2 = await call('update_shader', { changes: [{ path: 'properties._YokOzellik.max', value: 2 }] });
    check('M: update_shader (yalnız geçersiz → gönderilmez)', !r2.isError && r2.json?.ok === false && r2.json.errors?.length === 1 && !!r2.json.info, JSON.stringify(r2.json?.errors));
  });

  await step('M: get_shader_user_edits', async () => {
    const r0 = (await call('get_shader_user_edits')).json;
    check('M: get_shader_user_edits (Claude değişikliği referans)', r0?.changes?.length === 0, `changes=${r0?.changes?.length}`);
    const st = await (await fetch(BASE + '/api/state')).json(); const s = st.shader; // tarayıcı düzeltmesini taklit et: /api/shader (olaysız) + Shader notu
    s.properties.find((p) => p.name === '_RimPower').default = 4; s.code.fragment = s.code.fragment.replace('return float4(col, 1.0);', 'return float4(col * 1.1, 1.0);');
    await postJ('/api/shader', s); await postJ('/api/note', { mode: 'shader', text: 'rim biraz daha güçlü' });
    const r1 = (await call('get_shader_user_edits')).json;
    const c1 = r1?.changes?.find((x) => x.path === 'properties._RimPower.default'), c2 = r1?.changes?.find((x) => x.path === 'code.fragment');
    check('M: get_shader_user_edits (özellik + kod farkı + not)', c1?.to === 4 && c2?.changed === true && c2.to.includes('col * 1.1') && r1.notes.length === 1 && r1.notes[0].text === 'rim biraz daha güçlü', JSON.stringify({ c1, code: !!c2, notes: r1?.notes?.length }));
    await call('get_shader_user_edits', { acknowledge: true }); const r2 = (await call('get_shader_user_edits')).json;
    check('M: get_shader_user_edits acknowledge', r2?.changes?.length === 0 && r2.notes.length === 0, '');
  });

  await step('M: save/list/load/delete_shader + builtin koruması', async () => {
    const file = path.join(ROOT, 'shaders', SH + '.json');
    const s = await call('save_shader');
    check('M: save_shader', !s.isError && s.json?.saved === SH && s.json.unityName === 'UnityPreview/' + SH && fs.existsSync(file), s.text.slice(0, 100));
    const it = (await call('list_shaders')).json?.find((x) => x.name === SH);
    check('M: list_shaders (özel)', it?.builtin === false && it.unityName === 'UnityPreview/' + SH && it.properties.includes('_DetailMap:texture') && it.modified > 0, JSON.stringify(it?.properties));
    const b1 = await call('save_shader', { name: 'elarion_toon' }), b2 = await call('save_shader', { name: 'Universal Render Pipeline/Lit' }), b3 = await call('delete_shader', { name: 'Elarion/ToonCharacter' });
    check('M: builtin ezilemez/silinemez', b1.isError && b2.isError && b3.isError && !fs.existsSync(path.join(ROOT, 'shaders', 'elarion_toon.json')), [b1, b2, b3].map((x) => x.text.slice(0, 40)).join(' | '));
    await call('update_shader', { changes: [{ path: 'renderState.cull', value: 'front' }] });
    const ld = await call('load_shader', { name: 'UnityPreview/' + SH }); const g = (await call('get_shader')).json;
    check('M: load_shader (kayıtlı hâle döner)', !ld.isError && ld.json?.loaded === SH && g?.renderState?.cull === 'off', `cull=${g?.renderState?.cull}`);
    const tmp = SH + '_tmp'; await call('save_shader', { name: tmp, shader: g });
    const d = await call('delete_shader', { name: tmp });
    check('M: delete_shader', !d.isError && /Silindi/.test(d.text) && !fs.existsSync(path.join(ROOT, 'shaders', tmp + '.json')), d.text);
    const lb = await call('load_shader', { name: 'Universal Render Pipeline/Lit' }); const fork = await call('save_shader', { name: tmp }); // editörde urp_lit → başka adla
    const fg = (await call('get_shader', { name: tmp })).json;
    check('M: builtin kopyası özel shader olarak kaydedilir', !lb.isError && lb.json?.builtin === true && !fork.isError && fork.json?.unityName === 'UnityPreview/' + tmp && fg?.builtin === false && fg.urpSurface === true && fork.json.warnings?.some((w) => /builtin/.test(w)), fork.text.slice(0, 100));
    await call('delete_shader', { name: tmp });
  });

  await step('M: new_material + update_material', async () => {
    const r = await call('new_material', { name: MAT, shader: 'Elarion/ToonCharacter', values: { _BaseColor: '#c03030' } });
    const g = (await call('get_material')).json; const s = (await call('get_status')).json; const v = g?.material?.values;
    check('M: new_material (Elarion/ToonCharacter, varsayılanlarla)', !r.isError && g?.material?.shader === 'Elarion/ToonCharacter' && v?._RimPower === 2.2 && v._BaseColor === '#c03030' && Object.keys(v).length === 14 && v._BaseMap?.tex === 'white' && s?.mode === 'material' && s.material?.name === MAT, `values=${Object.keys(v || {}).length} mode=${s?.mode}`);
    const b = await call('new_material', { name: 'smoke_x', shader: 'Yok/Shader' });
    check('M: new_material (olmayan shader → hata)', b.isError, b.text.slice(0, 80));
    const u = await call('update_material', { changes: [{ path: 'values._RimPower', value: 3.5 }, { path: 'values._OutlineWidth', value: 9 }, { path: 'preview.target', value: 'cube' }, { path: 'values._YokBoyle', value: 1 }] });
    const g2 = (await call('get_material')).json?.material;
    check('M: update_material (3 geçerli + 1 geçersiz, kırpma)', !u.isError && u.json?.errors?.length === 1 && u.json.applied?.length === 3 && g2?.values?._RimPower === 3.5 && g2.values._OutlineWidth === 0.05 && g2.preview.target === 'cube', `errors=${JSON.stringify(u.json?.errors)} applied=${JSON.stringify(u.json?.applied)}`);
  });

  await step('M: get_material_user_edits', async () => {
    const r0 = (await call('get_material_user_edits')).json;
    check('M: get_material_user_edits (Claude değişikliği referans)', r0?.changes?.length === 0, `changes=${r0?.changes?.length}`);
    const st = await (await fetch(BASE + '/api/state')).json(); const m = st.material; m.values._RimColor = '#00ff00';
    await postJ('/api/material', m); await postJ('/api/note', { mode: 'material', text: 'rim yeşil olsun' }); await postJ('/api/note', { mode: 'shader', text: 'shader notu' });
    const r1 = (await call('get_material_user_edits')).json; const c = r1?.changes?.find((x) => x.path === 'values._RimColor');
    check('M: get_material_user_edits (fark + yalnız materyal notu)', c?.from === '#ff6b14' && c.to === '#00ff00' && r1.changes.length === 1 && r1.notes.length === 1 && r1.notes[0].text === 'rim yeşil olsun', JSON.stringify({ c, notes: r1?.notes }));
    await call('get_material_user_edits', { acknowledge: true }); const r2 = (await call('get_material_user_edits')).json; const s = (await call('get_status')).json;
    check('M: get_material_user_edits acknowledge', r2?.changes?.length === 0 && r2.notes.length === 0 && s?.pendingShaderNotes === 1, `shader notu korunur: ${s?.pendingShaderNotes}`);
    await call('get_shader_user_edits', { acknowledge: true }); // test notunu temizle (shader baseline zaten güncel)
  });

  await step('M: save/list/load/delete_material + assign_material', async () => {
    const file = path.join(ROOT, 'materials', MAT + '.json');
    const s = await call('save_material');
    check('M: save_material', !s.isError && s.json?.saved === MAT && fs.existsSync(file), s.text.slice(0, 100));
    const it = (await call('list_materials')).json?.find((x) => x.name === MAT);
    check('M: list_materials', it?.shader === 'Elarion/ToonCharacter' && it.target === 'cube', JSON.stringify(it));
    await call('update_material', { changes: [{ path: 'values._RimPower', value: 1 }] });
    const ld = await call('load_material', { name: MAT }); const g = (await call('get_material')).json?.material;
    check('M: load_material (kayıtlı hâle döner)', !ld.isError && ld.json?.loaded === MAT && g?.values?._RimPower === 3.5 && g.values._RimColor === '#00ff00', `_RimPower=${g?.values?._RimPower}`);
    const ld2 = await call('load_material', { name: 'yok_boyle_mat' });
    check('M: load_material (olmayan → hata)', ld2.isError, ld2.text.slice(0, 80));
    const gl = (await call('get_material', { name: MAT })).json;
    check('M: get_material (kütüphaneden)', gl?.material?.name === MAT && gl.shader?.unityName === 'Elarion/ToonCharacter', '');
    const a = await call('assign_material', { target: 'hero', material: MAT }); const s1 = (await call('get_status')).json;
    const a2 = await call('assign_material', { target: 'yanlis_hedef', material: MAT }); const a3 = await call('assign_material', { target: 'hero:Body', material: 'yok_boyle_mat' });
    check('M: assign_material (hero + geçersizler → hata)', !a.isError && a.json?.overrides?.hero === MAT && s1?.overrides?.hero === MAT && a2.isError && a3.isError, JSON.stringify(s1?.overrides));
    const a4 = await call('assign_material', { target: 'hero', material: null }); const s2 = (await call('get_status')).json;
    check('M: assign_material null (kaldır)', !a4.isError && !('hero' in (s2?.overrides || { hero: 1 })), JSON.stringify(s2?.overrides));
    const tmp = MAT + '_tmp'; await call('save_material', { name: tmp });
    const d = await call('delete_material', { name: tmp });
    check('M: delete_material', !d.isError && /Silindi/.test(d.text) && !fs.existsSync(path.join(ROOT, 'materials', tmp + '.json')) && !(await call('list_materials')).json.some((x) => x.name === tmp), d.text);
  });

  await step('M: set/get_lighting + set_editor_mode', async () => {
    const r = await call('set_lighting', { lighting: { intensity: 1.5, color: '#FFEEDD' } }); const g = (await call('get_lighting')).json;
    const d = defaultLighting();
    check('M: set/get_lighting (birleştirme)', !r.isError && g?.intensity === 1.5 && g.color === '#ffeedd' && JSON.stringify(g.rotation) === JSON.stringify(d.rotation), JSON.stringify(g));
    await call('set_lighting', { lighting: { intensity: d.intensity, color: d.color } });
    const a = await call('set_editor_mode', { mode: 'material' }); const s1 = (await call('get_status')).json;
    const b = await call('set_editor_mode', { mode: 'shader' }); const s2 = (await call('get_status')).json;
    check('M: set_editor_mode material/shader', !a.isError && !b.isError && s1?.mode === 'material' && s2?.mode === 'shader', `${s1?.mode} → ${s2?.mode}`);
  });

  await step('M: render_material / shader-compile (tarayıcı yok)', async () => {
    const r = await call('render_material', { size: 256 });
    check('M: render_material (tarayıcı yok → anlaşılır hata)', r.isError && /tarayıcı/i.test(r.text), r.text.slice(0, 100));
    const c = await postJ('/api/claude/shader-compile', { shader: { name: 'x' } });
    check('M: /api/claude/shader-compile (tarayıcı yok → 409)', c.status === 409, String(c.status));
  });

  await step('M: HTTP doku yükleme + /material-textures/', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const up = await (await fetch(BASE + `/api/upload-material-texture?name=${MTEX}.png`, { method: 'POST', body: png })).json();
    const list = await (await fetch(BASE + '/api/material-textures')).json();
    const got = Buffer.from(await (await fetch(BASE + `/material-textures/${MTEX}.png`)).arrayBuffer());
    const t = (await call('list_material_textures')).json;
    check('M: doku yükleme + statik eşleme + list_material_textures', up.name === MTEX && list.includes(MTEX) && got.equals(png) && t?.files?.includes(MTEX) && t.files.includes('noise') && '@mesh' in (t.special || {}), JSON.stringify(up));
  });

  const HAS_HLSL = fs.existsSync(path.join(ROOT, 'lib', 'shader-hlsl.js'));
  const matDir = path.join(FAKE, 'Assets', 'UnityPreview', 'Materials');
  await step('M: send_material_to_unity (builtin shader → waiting)', async () => {
    await call('load_material', { name: MAT });
    await call('update_material', { changes: [{ path: 'values._BaseMap', value: { tex: MTEX, tiling: [2, 2] } }] }); await call('save_material');
    const bad = await call('send_material_to_unity', { name: 'yok_boyle_mat' });
    check('M: send_material_to_unity (olmayan → hata)', bad.isError, bad.text.slice(0, 80));
    const t0 = Date.now(); const r = await call('send_material_to_unity', { name: MAT }); const j = r.json;
    check('M: send_material_to_unity yanıtı (waiting)', !r.isError && j?.ok === false && j.sent?.includes(MAT) && j.waiting?.includes(MAT) && Array.isArray(j.missingTextures) && Array.isArray(j.shaderErrors) && !j.error, `${((Date.now() - t0) / 1000).toFixed(1)} sn, note=${(j?.note || j?.error || '').slice(0, 60)}`);
    let pl = null; try { pl = JSON.parse(fs.readFileSync(path.join(matDir, MAT + '.mat.json'), 'utf8')); } catch { /* yok */ }
    const texRel = `Assets/UnityPreview/Materials/Textures/${MTEX}.png`;
    check('M: .mat.json yükü', pl?.format === 'upe-material-export-1' && pl.name === MAT && pl.shaderName === 'Elarion/ToonCharacter' && pl.urpSurface === false && pl.renderQueue === -1 && pl.properties?.length === 14
      && pl.properties.some((p) => p.name === '_BaseMap' && p.type === 'texture' && p.linear === false) && pl.values?._RimPower === 3.5 && pl.values._BaseMap?.tex === MTEX && pl.textures?.[MTEX] === texRel, pl ? JSON.stringify({ shaderName: pl.shaderName, textures: pl.textures }) : 'dosya yok');
    const src = path.join(ROOT, 'materials', 'textures', MTEX + '.png'), dst = path.join(FAKE, ...texRel.split('/'));
    check('M: doku kopyası', fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(src)) && j?.textures?.includes(MTEX), texRel);
    const cs = fs.readdirSync(path.join(ROOT, 'unity')).filter((f) => /^UnityPreviewMaterial.*\.cs$/.test(f));
    if (!cs.length) console.log('SKIP  M: importer .cs kopyası — unity/UnityPreviewMaterial*.cs henüz yok' + (j?.scriptsMissing ? ' (yanıtta scriptsMissing var)' : ''));
    else {
      const csBad = cs.filter((f) => { const d = path.join(FAKE, 'Assets', 'Editor', 'UnityPreview', f); return !(fs.existsSync(d) && fs.readFileSync(d).equals(fs.readFileSync(path.join(ROOT, 'unity', f)))); });
      check('M: importer .cs kopyası', !csBad.length, csBad.length ? 'eksik: ' + csBad.join(',') : cs.join(', '));
    }
  });

  await step('M: send_material_to_unity (özel shader + sahte Unity yanıtı)', async () => {
    const n = await call('new_material', { name: MAT2, shader: 'UnityPreview/' + SH, values: { _BaseMap: { tex: 'noise' }, _DetailMap: { tex: 'yok_doku' } } });
    await call('save_material');
    check('M: new_material (özel shader, kütüphaneden)', !n.isError && n.json?.material?.shader === 'UnityPreview/' + SH && '_DetailMap' in (n.json.material.values || {}), n.text.slice(0, 80));
    if (!HAS_HLSL) {
      const r = await call('send_material_to_unity', { name: MAT2 }); const j = r.json;
      check('M: lib yokken anlaşılır hata', !r.isError && j?.ok === false && /shader-hlsl/.test(j.errors?.[MAT2] || '') && !j.sent.length, (j?.error || '').slice(0, 100));
      console.log('SKIP  M: .shader dosyası + shaderErrors — lib/shader-hlsl.js henüz yok');
      return;
    }
    const t0 = Date.now(); // sahte Unity: .mat.json gelince .mat + durum satırları (shader derleme hatası) yazar
    const stop = fakeUnity(() => { const f = path.join(matDir, MAT2 + '.mat.json'); return fs.existsSync(f) && fs.statSync(f).mtimeMs >= t0; }, () => {
      fs.writeFileSync(path.join(matDir, MAT2 + '.mat'), 'fake');
      fs.writeFileSync(path.join(matDir, 'last_status.txt'), `shader:${SH}|ERROR|12: undeclared identifier 'foo'\n${MAT2}|OK|Assets/UnityPreview/Materials/${MAT2}.mat\n`);
    });
    const r = await call('send_material_to_unity', { name: MAT2 }); stop(); const j = r.json;
    const shFile = path.join(FAKE, 'Assets', 'UnityPreview', 'Shaders', SH + '.shader'); const src = fs.existsSync(shFile) ? fs.readFileSync(shFile, 'utf8') : '';
    check('M: özel shader .shader dosyası', src.includes(`UnityPreview/${SH}`) && j?.shaders?.[0] === `Assets/UnityPreview/Shaders/${SH}.shader` && j.shaderDetails?.[0]?.changed === true, `${src.length} karakter, warnings=${j?.shaderDetails?.[0]?.warnings?.length}`);
    check('M: sahte Unity yanıtı (imported + shaderErrors)', !r.isError && j?.imported?.includes(MAT2) && !j.waiting.length && j.ok === false && j.shaderErrors?.[0]?.shader === SH && j.shaderErrors[0].line === 12 && /undeclared/.test(j.shaderErrors[0].message) && /satır 12/.test(j.error || ''), `${((Date.now() - t0) / 1000).toFixed(1)} sn ${JSON.stringify(j?.shaderErrors)}`);
    check('M: missingTextures + yerleşik doku kopyası', j?.missingTextures?.includes('yok_doku') && j.textures?.includes('noise') && fs.existsSync(path.join(matDir, 'Textures', 'noise.png')), JSON.stringify({ missing: j?.missingTextures, textures: j?.textures }));
  });

  await step('M: send_shader_to_unity', async () => {
    const b = await call('send_shader_to_unity', { name: 'Elarion/ToonCharacter' });
    check('M: send_shader_to_unity (builtin → hata)', b.isError && /builtin/.test(b.text), b.text.slice(0, 80));
    if (!HAS_HLSL) {
      const r = await call('send_shader_to_unity', { name: SH });
      check('M: send_shader_to_unity lib yokken anlaşılır hata', r.isError && /shader-hlsl/.test(r.text), r.text.slice(0, 100));
      console.log('SKIP  M: send_shader_to_unity derleme bekleme — lib/shader-hlsl.js henüz yok');
      return;
    }
    const r1 = (await call('send_shader_to_unity', { name: SH })).json; // send_material zaten yazdı → değişmedi, son durum ERROR
    check('M: send_shader_to_unity (değişmedi → son bilinen durum)', r1?.unchanged === true && r1.ok === false && r1.shaderErrors?.length === 1, (r1?.note || '').slice(0, 90));
    await call('load_shader', { name: SH }); await call('update_shader', { changes: [{ path: 'code.common', value: '// smoke: içerik değişsin\n' }] }); // kaydedilmemiş çalışma kopyası gider
    await wait(1200); // eski durum dosyası başlangıç penceresinin (−1 sn) dışında kalsın
    const t0 = Date.now(); const shFile = path.join(FAKE, 'Assets', 'UnityPreview', 'Shaders', SH + '.shader');
    const stop = fakeUnity(() => fs.existsSync(shFile) && fs.statSync(shFile).mtimeMs >= t0, () => fs.writeFileSync(path.join(matDir, 'last_status.txt'), `shader:${SH}|OK|Assets/UnityPreview/Shaders/${SH}.shader\n`));
    const r2 = await call('send_shader_to_unity', { name: SH }); stop(); const j = r2.json;
    check('M: send_shader_to_unity (değişti → derlendi)', !r2.isError && j?.ok === true && j.compiled === true && j.shaderDetails?.[0]?.changed === true && j.shaders?.[0] === `Assets/UnityPreview/Shaders/${SH}.shader` && !j.shaderErrors.length && fs.readFileSync(shFile, 'utf8').includes('smoke: içerik değişsin'), `${((Date.now() - t0) / 1000).toFixed(1)} sn ${(j?.note || j?.error || '').slice(0, 60)}`);
  });
} catch (e) {
  check('beklenmeyen hata', false, String(e?.stack || e));
} finally {
  // geçici kütüphane dosyası kalmasın
  fs.rmSync(path.join(ROOT, 'vfx', NAME + '.json'), { force: true });
  fs.rmSync(path.join(ROOT, 'vfx', 'textures', TEX + '.png'), { force: true });
  for (const n of [SH, SH + '_tmp']) fs.rmSync(path.join(ROOT, 'shaders', n + '.json'), { force: true });
  for (const n of [MAT, MAT2, MAT + '_tmp']) fs.rmSync(path.join(ROOT, 'materials', n + '.json'), { force: true });
  fs.rmSync(path.join(ROOT, 'materials', 'textures', MTEX + '.png'), { force: true });
  await client.close().catch(() => {});
  let down = false; for (let i = 0; i < 25 && !(down = !(await ping())); i++) await wait(200);
  check('sunucu kapandı', down, down ? '' : `port ${PORT} hâlâ açık`);
  if (down) fs.rmSync(path.join(ROOT, '.ports', `project-${PORT}.json`), { force: true }); // bu portun durum dosyası (sahte Unity yolunu taşır)
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? `, ${fails} FAIL` : ''}`);
  process.exit(fails ? 1 : 0);
}
