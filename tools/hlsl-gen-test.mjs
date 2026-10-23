// lib/shader-hlsl.js sınaması: hazır shader'lar (builtin:false, test_<ad>) + tüm şablonlar (test_tpl_<ad>) → .shader dosyaları.
// Unity'de derlemek için: çıktıyı <proje>/Assets/UnityPreview/Shaders/ altına kopyala (importer derleme sonucunu durum dosyasına yazar).
// Kullanım: node tools/hlsl-gen-test.mjs [çıktı klasörü]
import fs from 'node:fs';
import path from 'node:path';
import { normalizeShader } from '../public/shader-schema.js';
import { BUILTIN_SHADERS, TEMPLATES } from '../public/shader-builtins.js';
import { generateUnityShader } from '../lib/shader-hlsl.js';

const DEFAULT_OUT = 'C:\\Users\\KULLAN~1\\AppData\\Local\\Temp\\claude\\C--Users-Kullan-c---claude-spares-spare-GmT25Y\\cfc7f4b3-8610-4502-860f-dc197b019d03\\scratchpad\\agentU2_shaders';
const outDir = path.resolve(process.argv[2] || DEFAULT_OUT);
fs.mkdirSync(outDir, { recursive: true });

const inputs = [
  ...BUILTIN_SHADERS.map((b) => ({ ...b, builtin: false, unityName: '', name: 'test_' + b.name })),
  ...Object.entries(TEMPLATES).map(([k, t]) => ({ ...t.shader, name: 'test_tpl_' + k })),
];

let fail = 0;
const check = (ok, msg) => { if (!ok) { fail++; console.log('  HATA: ' + msg); } };

// builtin için hata beklenir
try { generateUnityShader(normalizeShader(BUILTIN_SHADERS[0]).shader); check(false, 'builtin shader için hata fırlatılmadı'); } catch { /* beklenen */ }

for (const raw of inputs) {
  const { shader, warnings: nw } = normalizeShader(raw);
  let res;
  try { res = generateUnityShader(shader); } catch (e) { fail++; console.log(`${shader.name}: ÜRETİLEMEDİ — ${e.message}`); continue; }
  const { source, warnings, sections } = res;
  const file = path.join(outDir, shader.name + '.shader');
  fs.writeFileSync(file, source);
  console.log(`${shader.name}.shader  (${source.split('\n').length} satır)`);
  for (const w of nw.filter((x) => !/bilinmeyen alan atıldı: (builtin|unityName)/.test(x))) console.log('  normalize: ' + w);
  for (const w of warnings) console.log('  uyarı: ' + w);

  // basit yapı denetimleri
  const count = (re) => (source.match(re) || []).length;
  let depth = 0, minDepth = 0; for (const ch of source.replace(/"[^"\n]*"/g, '').replace(/\/\/[^\n]*/g, '')) { if (ch === '{') depth++; else if (ch === '}') { depth--; minDepth = Math.min(minDepth, depth); } }
  check(depth === 0 && minDepth >= 0, `süslü parantez dengesiz (${depth})`);
  check(count(/CBUFFER_START\(UnityPerMaterial\)/g) === 1, 'CBUFFER tek olmalı (HLSLINCLUDE)');
  check(count(/HLSLINCLUDE/g) === 1 && count(/HLSLPROGRAM/g) === count(/ENDHLSL/g) - 1, 'HLSL blokları dengesiz');
  const passes = [...source.matchAll(/LightMode"="(\w+)"/g)].map((m) => m[1]);
  console.log('  pass: ' + passes.join(', ') + '  · bölümler: ' + Object.entries(sections).map(([k, v]) => `${k}@${v.start}`).join(' '));
  check(passes.includes('UniversalForward'), 'UniversalForward yok');
  check(passes.includes('SRPDefaultUnlit') === !!shader.outline.enabled, 'Outline pass uyuşmuyor');
  check(passes.includes('ShadowCaster') === (shader.lighting.castShadows && (shader.urpSurface || shader.renderState.blend === 'opaque')), 'ShadowCaster uyuşmuyor');
  const opaque = shader.urpSurface || shader.renderState.blend === 'opaque';
  check(passes.includes('DepthOnly') === opaque && passes.includes('DepthNormals') === opaque, 'Depth pass\'leri uyuşmuyor');
  for (const p of shader.properties) {
    check(new RegExp(`^\\s+(\\[[^\\]]+\\]\\s*)*${p.name} \\(`, 'm').test(source), `Properties'te ${p.name} yok`);
    check(source.includes(p.type === 'texture' ? `float4 ${p.name}_ST;` : ` ${p.name};`), `CBUFFER'da ${p.name} yok`);
  }
  // bölüm işaretleri: kod satırları aynen
  const lines = source.split('\n');
  for (const [k, v] of Object.entries(sections)) {
    check(lines[v.marker - 1] === `//#upe-section ${k}`, `${k} işaret satırı yanlış`);
    const body = String(shader.code[k] || '').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    check(lines.slice(v.start - 1, v.end).join('\n') === body, `${k} kodu aynen değil`);
  }
}
console.log(fail ? `\n${fail} hata` : `\nTamam — ${inputs.length} shader → ${outDir}`);
process.exit(fail ? 1 : 0);
