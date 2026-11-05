// node tools/ue-vfx-topo.mjs <systemRefPath> <emitterName> [--values] : emitter yığınının özeti (keşif)
import { callTool, closeAll } from '../lib/unreal-mcp-client.js';
const [sys, em, flag] = process.argv.slice(2);
const T = 'NiagaraToolsets.NiagaraToolset_System';
try {
  const r = (await callTool(T, 'GetEmitterTopology', { emitterRef: { system: { refPath: sys }, emitterName: em, scriptName: '', moduleName: '', rendererIndex: -1, inputNameStack: [] } })).returnValue;
  for (const k of Object.keys(r)) {
    const s = r[k]; if (!s?.modules) continue;
    console.log('==', s.scriptName);
    for (const m of s.modules) {
      console.log('  -', m.moduleName, m.enabled === false ? '(kapalı)' : '', m.moduleScript?.refPath || '');
      for (const i of m.inputs || []) console.log('      ', i.bIsVisible ? '' : '(gizli)', i.inputName || i.name, ':', i.type?.classStructOrEnum?.refPath || JSON.stringify(i.type || '').slice(0, 80), i.bIsStaticSwitch ? '[switch]' : '', i.bIsDynamic ? '[dyn]' : '');
    }
  }
  console.log('renderers', JSON.stringify(r.renderers || r.rendererReferences || r.rendererClasses));
  if (flag === '--values') console.log(JSON.stringify(await callTool(T, 'GetEmitterInputValues', { emitterRef: { system: { refPath: sys }, emitterName: em, scriptName: '', moduleName: '', rendererIndex: -1, inputNameStack: [] } }), null, 1).slice(0, 20000));
} catch (e) { console.error('HATA', e.message.slice(0, 3000)); }
await closeAll();
