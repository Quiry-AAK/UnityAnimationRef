// Uçtan uca: node tools/ue-vfx-send.mjs [--content /Game/UPE/VFX] [--mcp url] [--preset sparks,fire,...] <efektAdı...>
// vfx/<ad>.json efektlerini (ya da --preset ile şablonlardan kurulan tek emitter'lı efektleri) çalışan Unreal editörüne gönderir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEffect, presetEmitter, defaultEffect } from '../public/vfx-schema.js';
import { sendVfxToUnreal, unrealStatus } from '../lib/unreal-vfx.js';
import { closeAll } from '../lib/unreal-mcp-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const contentPath = opt('--content') || '/Game/UPE/VFX';
const mcpUrl = opt('--mcp');
const presets = opt('--preset');
const effects = [];
for (const name of args) {
  const file = path.join(root, 'vfx', name.replace(/\.json$/, '') + '.json');
  const { effect, warnings } = normalizeEffect(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (warnings.length) console.log(`[${name}] normalize:`, warnings.join('; '));
  effects.push(effect);
}
if (presets) {
  const list = presets.split(',').filter(Boolean);
  effects.push(normalizeEffect({ ...defaultEffect(), name: `upe_presets_${list.join('_')}`, duration: 2, emitters: list.map((p) => presetEmitter(p)) }).effect);
}
console.log('durum:', JSON.stringify(await unrealStatus({ mcpUrl })));
const t0 = Date.now();
const res = await sendVfxToUnreal(effects, { mcpUrl, contentPath, log: (m) => console.log(m) });
for (const s of res.systems) {
  console.log(`\n✓ ${s.name} → ${s.path} (${s.compile}) emitter: ${s.emitters.join(', ')}`);
  for (const w of s.warnings) console.log('   uyarı:', w);
}
for (const [k, v] of Object.entries(res.errors)) console.log(`\n✗ ${k}: ${v}`);
console.log(`\n${res.ok ? 'TAMAM' : 'HATA'} · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
await closeAll();
process.exitCode = res.ok ? 0 : 1;
