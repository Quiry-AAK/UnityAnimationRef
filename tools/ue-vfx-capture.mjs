// Niagara editöründe sistemi açıp editör görüntüsünü yakalar: node tools/ue-vfx-capture.mjs <assetPath> [bekleme_ms]
// → exports/ue_vfx/<ad>_editor.png. (CaptureAssetImage Niagara sistemlerini desteklemiyor; önizleme Niagara editöründe oynar.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClient, closeAll } from '../lib/unreal-mcp-client.js';
const [asset, waitMs = '1500'] = process.argv.slice(2);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../exports/ue_vfx');
fs.mkdirSync(out, { recursive: true });
const client = await getClient();
const call = (tool, args) => client.callTool({ name: 'call_tool', arguments: { toolset_name: 'EditorToolset.EditorAppToolset', tool_name: tool, arguments: args } });
await call('OpenEditorForAsset', { assetPath: asset });
await new Promise((r) => setTimeout(r, +waitMs));
const res = await call('CaptureEditorImage', {});
const img = (res.content || []).find((c) => c.type === 'image');
let data = img?.data;
if (!data) { const t = (res.content || []).find((c) => c.type === 'text')?.text; try { data = JSON.parse(t).returnValue?.data; } catch { console.log('yanıt:', String(t).slice(0, 300)); } }
if (data) { const file = path.join(out, path.basename(asset).split('.')[0] + '_editor.png'); fs.writeFileSync(file, Buffer.from(data, 'base64')); console.log('→', file); }
await closeAll();
