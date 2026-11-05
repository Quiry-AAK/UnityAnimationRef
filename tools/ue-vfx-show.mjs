// node tools/ue-vfx-show.mjs <dumpfile> <tool> [--defs] : aracın açıklaması + şeması (keşif yardımcısı)
import fs from 'node:fs';
const [f, name, flag] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(f, 'utf8')); const tools = d.tools || d;
for (const t of tools.filter((t) => t.name.endsWith('.' + name) || t.name === name)) {
  console.log('##', t.name, '\n', t.description);
  const s = t.inputSchema || t.input_schema || t.parameters;
  const { $defs, definitions, ...rest } = s || {};
  console.log('SCHEMA', JSON.stringify(rest));
  if (flag === '--defs') console.log('DEFS', JSON.stringify($defs || definitions));
  if (t.outputSchema) console.log('OUT', JSON.stringify(t.outputSchema).slice(0, 1500));
}
