// Niagara sistem küçük resimleri: node tools/ue-vfx-thumbs.mjs <assetPath...> → exports/ue_vfx/<ad>.png (EditorAppToolset.CaptureAssetImage)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClient, closeAll } from '../lib/unreal-mcp-client.js';
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../exports/ue_vfx');
fs.mkdirSync(out, { recursive: true });
const client = await getClient();
for (const a of process.argv.slice(2)) {
  const res = await client.callTool({ name: 'call_tool', arguments: { toolset_name: 'EditorToolset.EditorAppToolset', tool_name: 'CaptureAssetImage', arguments: { assetPath: a } } });
  const img = (res.content || []).find((c) => c.type === 'image');
  let data = img?.data, mime = img?.mimeType;
  if (!data) { const t = (res.content || []).find((c) => c.type === 'text')?.text; try { const j = JSON.parse(t); data = j.returnValue?.data; mime = j.returnValue?.mimeType; } catch { console.log(a, 'yanıt:', String(t).slice(0, 300)); } }
  if (!data) continue;
  const file = path.join(out, path.basename(a).split('.')[0] + (mime?.includes('jpeg') ? '.jpg' : '.png'));
  fs.writeFileSync(file, Buffer.from(data, 'base64')); console.log(a, '→', file, mime);
}
await closeAll();
