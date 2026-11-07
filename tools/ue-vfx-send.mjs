// Uçtan uca: node tools/ue-vfx-send.mjs [--content /Game/UPE/VFX] [--mcp url] [--preset sparks,fire,...] <efektAdı...>
// vfx/<ad>.json efektlerini (ya da --preset ile şablonlardan kurulan tek emitter'lı efektleri) çalışan Unreal editörüne gönderir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEffect, presetEmitter, defaultEffect, evalGradient, evalCurve } from '../public/vfx-schema.js';
import { sendVfxToUnreal, unrealStatus } from '../lib/unreal-vfx.js';
import { closeAll } from '../lib/unreal-mcp-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const contentPathOpt = opt('--content');
const mcpUrl = opt('--mcp');
const presets = opt('--preset');
const part = opt('--part');
const only = opt('--only')?.split(',').filter(Boolean); // yalnız bu parça adları (ör. agir_h2_hilal_2,agir_h2_hilal_3) // iz | ana: emitter.follow ile bölünen efektin yalnız bir parçası
// --loop: görsel kontrol için tüm emitter'lar döngülü, gecikmesiz (ad sonuna _loop); varsayılan klasör /Game/UPE/VFX_Test
// --freeze T: efektin T. saniyedeki görünümü donmuş (görsel kontrol; arka plandaki editör yavaş tick'lediği için): her emitter'ın
// parçacık yaşı T'ye göre hesaplanır, renk/alfa/boyut eğrileri o andaki sabit değere çekilir, ömür uzun, döngülü. Ad sonuna _f<T>
const freeze = opt('--freeze');
const materialsDir = opt('--materials'), shadersDir = opt('--shaders'); // UPE materials/ ve shaders/ yerine (test)
const matOverride = opt('--mat'); // tüm materyalli emitter'larda materyali değiştir (test)
const nomatIdx = args.indexOf('--nomat'); const nomat = nomatIdx >= 0; if (nomat) args.splice(nomatIdx, 1); // materyalsiz (Aşama 1 yerleşik) karşılaştırma
const loopIdx = args.indexOf('--loop'); const loop = loopIdx >= 0; if (loop) args.splice(loopIdx, 1);
const effects = [];
for (const name of args) {
  const file = path.join(root, 'vfx', name.replace(/\.json$/, '') + '.json');
  const { effect, warnings } = normalizeEffect(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (warnings.length) console.log(`[${name}] normalize:`, warnings.join('; '));
  if (loop) {
    effect.name += '_loop';
    for (const em of effect.emitters) { em.main.looping = true; em.main.startDelay = 0; em.main.prewarm = true; if (em.main.duration > 1.2) em.main.duration = 1.2; }
  }
  if (matOverride) { effect.name += '_' + matOverride; for (const em of effect.emitters) if (em.renderer.material) em.renderer.material = matOverride; }
  if (nomat) { effect.name += '_nomat'; for (const em of effect.emitters) em.renderer.material = ''; }
  if (freeze !== undefined) {
    const T = +freeze; effect.name += '_f' + String(freeze).replace('.', '_');
    for (const em of effect.emitters) {
      const b0 = em.emission.bursts.length ? Math.min(...em.emission.bursts.map((b) => b.time)) : 0;
      const life = em.bladeTrail?.enabled ? em.bladeTrail.lifetime : (em.main.startLifetime[0] + em.main.startLifetime[1]) / 2;
      const tn = (T - em.main.startDelay - b0) / Math.max(life, 1e-3);
      if (tn < 0 || tn > 1 || em.bladeTrail?.enabled) { em.enabled = false; continue; }
      const g = evalGradient(em.colorOverLifetime.enabled ? em.colorOverLifetime : null, tn);
      const hex = '#' + g.slice(0, 3).map((v) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')).join('');
      em.colorOverLifetime = { enabled: true, color: [[0, hex], [1, hex]], alpha: [[0, g[3]], [1, g[3]]] };
      if (em.sizeOverLifetime.enabled) { const k = evalCurve(em.sizeOverLifetime.curve, tn); em.sizeOverLifetime.curve = [[0, k], [1, k]]; }
      // burst'ler (editör arka planda yavaşken) güvenilir yakalanmıyor → aynı sayıda parçacığı hızla doğur
      const nb = em.emission.bursts.reduce((n, x) => n + x.count[1] * x.cycles, 0);
      if (nb) { em.emission.bursts = []; em.emission.rateOverTime = nb * 20; em.main.maxParticles = nb; }
      em.main.startLifetime = [1000, 1000]; em.main.looping = false; em.main.startDelay = 0; em.main.duration = 1000;
    }
  }
  effects.push(effect);
}
if (presets) {
  const list = presets.split(',').filter(Boolean);
  effects.push(normalizeEffect({ ...defaultEffect(), name: `upe_presets_${list.join('_')}`, duration: 2, emitters: list.map((p) => presetEmitter(p)) }).effect);
}
const contentPath = contentPathOpt || (loop || nomat || matOverride || freeze !== undefined ? '/Game/UPE/VFX_Test' : '/Game/UPE/VFX');
console.log('durum:', JSON.stringify(await unrealStatus({ mcpUrl })));
const t0 = Date.now();
const res = await sendVfxToUnreal(effects, { mcpUrl, contentPath, materialsDir, shadersDir, part, only, log: (m) => console.log(m) });
for (const s of res.systems) {
  console.log(`\n✓ ${s.name} → ${s.path} (${s.compile}) emitter: ${s.emitters.join(', ')}`);
  for (const w of s.warnings) console.log('   uyarı:', w);
}
for (const [k, v] of Object.entries(res.errors)) console.log(`\n✗ ${k}: ${v}`);
console.log(`\n${res.ok ? 'TAMAM' : 'HATA'} · ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
await closeAll();
process.exitCode = res.ok ? 0 : 1;
