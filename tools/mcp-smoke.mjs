// MCP uçtan uca duman testi: `node mcp.js`'i ayrı portta (UPE_PORT, varsayılan 5291) başlatır, tarayıcı gerektirmeyen
// VFX araçlarını + eski animasyon araçlarından birkaçını dener. Her adım PASS/FAIL; hata varsa çıkış kodu 1.
// Sahte Unity projesi: UPE_SMOKE_UNITY (yoksa %TEMP%/upe_smoke_fakeunity); klasörde .upe-smoke işareti yoksa dokunulmaz.
// Çalıştır: node tools/mcp-smoke.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.UPE_PORT || 5291);
if (PORT === 5177) { console.error('5177 ana editör; duman testini başka portta çalıştır.'); process.exit(1); }
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'smoke_test_vfx', TEX = 'smoke_test_tex';
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

  await step('get_status (eski araç, son)', async () => {
    const r = await call('get_status');
    check('get_status (son)', !r.isError && r.json?.mode === 'vfx', '');
  });
} catch (e) {
  check('beklenmeyen hata', false, String(e?.stack || e));
} finally {
  // geçici kütüphane dosyası kalmasın
  fs.rmSync(path.join(ROOT, 'vfx', NAME + '.json'), { force: true });
  fs.rmSync(path.join(ROOT, 'vfx', 'textures', TEX + '.png'), { force: true });
  await client.close().catch(() => {});
  let down = false; for (let i = 0; i < 25 && !(down = !(await ping())); i++) await wait(200);
  check('sunucu kapandı', down, down ? '' : `port ${PORT} hâlâ açık`);
  if (down) fs.rmSync(path.join(ROOT, '.ports', `project-${PORT}.json`), { force: true }); // bu portun durum dosyası (sahte Unity yolunu taşır)
  console.log(`\n${results.length - fails}/${results.length} PASS${fails ? `, ${fails} FAIL` : ''}`);
  process.exit(fails ? 1 : 0);
}
