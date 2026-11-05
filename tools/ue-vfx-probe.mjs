// Deneme: node tools/ue-vfx-probe.mjs <script.mjs gövdesi dosyası> — helper'larla çalıştırır
import fs from 'node:fs';
import * as C from '../lib/unreal-mcp-client.js';
const T = 'NiagaraToolsets.NiagaraToolset_System';
const SYS = '/Game/UPE/_Probe/NS_P1.NS_P1';
const ref = (o = {}) => ({ system: { refPath: o.sys || SYS }, emitterName: o.em || '', scriptName: o.script || '', moduleName: o.mod || '', rendererIndex: o.ri ?? -1, inputNameStack: o.inputs || [] });
const call = (tool, args, ts = T) => C.callTool(ts, tool, args);
const show = (x) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 1).slice(0, 6000));
const body = fs.readFileSync(process.argv[2], 'utf8');
try { await (new Function('C', 'T', 'SYS', 'ref', 'call', 'show', `return (async () => { ${body} })()`))(C, T, SYS, ref, call, show); }
catch (e) { console.error('HATA', e.message.slice(0, 4000)); }
await C.closeAll();
