// Simulate'te Niagara sistemini sahneye geçici koyup görüntü alır (sonra kaldırır):
//   node tools/ue-vfx-cap.mjs [--dir x,y,z] [--target x,y,z] [--dist cm] [--times 0.3,0.4] [--tag ad] <NS yolu>
// --dir: hedeften kameraya yön (UE), --target: sistem köküne göre bakılan nokta (cm). Çıktı exports/ue_vfx/cap_<tag>_<t>.png
// Not: harita kaydedilmez; aktör kaldırılır. Editör başka oturumla ortak olabilir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callTool, closeAll } from '../lib/unreal-mcp-client.js';

const ST = 'editor_toolset.toolsets.scene.SceneTools', EA = 'EditorToolset.EditorAppToolset';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'exports', 'ue_vfx'); fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const vec = (s) => s.split(',').map(Number);
const dir = vec(opt('--dir', '-1,0,0.15')), target = vec(opt('--target', '0,0,0')), dist = +opt('--dist', '350');
const times = opt('--times', '0.15,0.4,0.8').split(',').map(Number);
const tag = opt('--tag', 'x');
const sys = args[0];
if (!sys) { console.log('kullanım: node tools/ue-vfx-cap.mjs [--dir x,y,z] [--target x,y,z] [--dist cm] [--times a,b] [--tag ad] <NS yolu>'); process.exit(1); }
const Z = 3000;
const L = Math.hypot(...dir); const d = dir.map((v) => v / L);
const tgt = [target[0], target[1], target[2] + Z];
const loc = tgt.map((v, i) => v + d[i] * dist);
const yaw = Math.atan2(-d[1], -d[0]) * 180 / Math.PI, pitch = Math.asin(-d[2]) * 180 / Math.PI;
let actor = null;
try {
  actor = (await callTool(ST, 'add_to_scene_from_asset', { asset_path: sys, name: 'UPE_Cap', xform: { location: { x: 0, y: 0, z: Z }, rotation: { pitch: 0, yaw: 0, roll: 0 }, scale: { x: 1, y: 1, z: 1 } }, snap_to_ground: false })).returnValue;
  const cam = { location: { x: loc[0], y: loc[1], z: loc[2] }, rotation: { pitch, yaw, roll: 0 }, scale: { x: 1, y: 1, z: 1 } };
  await callTool(EA, 'StartPIE', { options: { bSimulate: true, playMode: 'PlayMode_Simulate', warmupSeconds: 0 } });
  const t0 = Date.now();
  for (const t of times) {
    const wait = t * 1000 - (Date.now() - t0); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const r = await callTool(EA, 'CaptureViewport', { captureTransform: cam, bShowUI: false, annotations: { gridSpacing: 0, gridExtent: 0, gridHeight: 0, maxLabelDistance: 0, classFilter: { refPath: '/Script/Engine.Actor' }, maxLabels: 0 } });
    const f = path.join(out, `cap_${tag}_${((Date.now() - t0) / 1000).toFixed(2)}s.png`);
    fs.writeFileSync(f, Buffer.from((r.returnValue ?? r).image.data, 'base64')); console.log('yazıldı', f);
  }
} catch (e) { console.log('HATA', e.message); } finally {
  try { await callTool(EA, 'StopPIE', {}); } catch (e) { console.log('StopPIE', e.message); }
  if (actor) try { await callTool(ST, 'remove_from_scene', { actor }); } catch (e) { console.log('remove', e.message); }
  await closeAll(); process.exit(0);
}
