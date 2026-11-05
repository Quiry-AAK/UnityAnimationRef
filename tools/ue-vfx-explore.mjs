// Keşif: node tools/ue-vfx-explore.mjs list | describe <toolset> [tool] | call <toolset> <tool> '<json>'
import fs from 'node:fs';
import { listToolsets, describeToolset, callTool, closeAll } from '../lib/unreal-mcp-client.js';
const [cmd, a, b, c] = process.argv.slice(2);
try {
  if (cmd === 'list') console.log(JSON.stringify(await listToolsets(), null, 1));
  else if (cmd === 'describe') {
    const d = await describeToolset(a);
    fs.mkdirSync('tools/tmp', { recursive: true }); fs.writeFileSync(`tools/tmp/ue_${a}.json`, JSON.stringify(d, null, 1));
    const tools = d.tools || d;
    if (b) console.log(JSON.stringify((Array.isArray(tools) ? tools : []).filter((t) => t.name === b || t.name?.endsWith('.' + b)), null, 1));
    else console.log((Array.isArray(tools) ? tools : []).map((t) => t.name + ' — ' + String(t.description || '').slice(0, 150)).join('\n') || JSON.stringify(d).slice(0, 2000));
  } else if (cmd === 'call') console.log(JSON.stringify(await callTool(a, b, c ? JSON.parse(c) : {}), null, 1));
} catch (e) { console.error('HATA', e.message); process.exitCode = 1; }
await closeAll();
