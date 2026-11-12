// Uçtan uca animasyon → Unreal (docs/UNREAL.md "Animasyon"):
//   node tools/ue-anim-send.mjs --uproject <.uproject> [--rig <state.json>] [--skeleton /Game/...] [--content /Game/UPE/Animations] [--ue-mcp x.y.z] <anim...>
//   --probe      : yalnız oku — projedeki SkeletalMesh'leri ve rig'e uyumlarını listeler, hiçbir şey yazmaz
//   --dry        : planı kurar ve özetler (iskeleti okur), varlık yazmaz
//   --readback   : gönderimden sonra AnimSequence'ı ve birkaç kemik izini okuyup planla karşılaştırır
// Rig: UPE durum dosyası (project.json ya da .ports/project-<port>.json; editörün yüklediği karakterin kemikleri). Yalnız kullanıcı isteyince çalıştır.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { animToUnrealPlan, sendAnimToUnreal, matchBones, ueAssetName } from '../lib/unreal-anim.js';
import { callUe, closeAll } from '../lib/unreal-mcp-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const uproject = opt('--uproject'); const rigFile = opt('--rig') || path.join(root, 'project.json');
const skeleton = opt('--skeleton'); const content = opt('--content') || '/Game/UPE/Animations'; const ver = opt('--ue-mcp');
const animsDir = opt('--anims') || path.join(root, 'animations');
const probe = flag('--probe'), dry = flag('--dry'), readback = flag('--readback');
if (!uproject) { console.error('--uproject gerekli'); process.exit(2); }
// sürüm: --ue-mcp > projenin köprü eklentisi (Plugins/UE_MCP_Bridge/*.uplugin VersionName) > istemci varsayılanı (server.js ile aynı kural)
let bridgeVer = null;
try { const pd = path.join(path.dirname(uproject), 'Plugins', 'UE_MCP_Bridge'); const f = fs.readdirSync(pd).find((x) => /\.uplugin$/i.test(x)); bridgeVer = JSON.parse(fs.readFileSync(path.join(pd, f), 'utf8').trim()).VersionName || null; } catch { /* yok */ }
const v = ver || bridgeVer;
const mcpUrl = `ue-mcp${v ? '@' + v : ''}:${uproject.replace(/\\/g, '/')}`;
const st = JSON.parse(fs.readFileSync(rigFile, 'utf8')); const rig = st.rig;
if (!rig?.bones?.length) { console.error('Rig yok: ' + rigFile); process.exit(2); }
console.log(`rig: ${st.modelName} (${rig.bones.length} kemik, unitScale ${rig.unitScale}) · hedef ${mcpUrl}`);
const ue = (c, a, x, t = 120000) => callUe(c, a, x, { mcpUrl, timeoutMs: t });

try {
  if (probe) {
    const res = await ue('animation', 'list_skeletal_meshes', { limit: 500 });
    console.log('list_skeletal_meshes yanıt anahtarları:', Object.keys(res || {}).join(','));
    const rows = res?.meshes || res?.skeletalMeshes || res?.assets || res?.items || [];
    console.log(JSON.stringify(rows.slice(0, 3)).slice(0, 600));
    const paths = rows.map((r) => (typeof r === 'string' ? r : r.path || r.assetPath || r.objectPath)).filter((p) => p?.startsWith('/Game/'));
    for (const p of paths) {
      try {
        const info = await ue('animation', 'get_skeleton_info', { assetPath: p });
        const names = (info?.bones || []).map((b) => b.name);
        const m = matchBones(rig.bones.map((b) => b.name), names);
        console.log(`${(m.size / rig.bones.length * 100).toFixed(0).padStart(3)}%  ${p}  (${names.length} kemik: ${names.slice(0, 6).join(', ')}…)`);
      } catch (e) { console.log(`  —  ${p}: ${e.message.slice(0, 100)}`); }
    }
  } else {
    const anims = args.map((n) => JSON.parse(fs.readFileSync(path.join(animsDir, n.replace(/\.json$/, '') + '.json'), 'utf8')));
    if (!anims.length) { console.error('animasyon adı ver'); process.exit(2); }
    if (dry) {
      const bt = await ue('animation', 'get_bone_transforms', { skeletonPath: skeleton, space: 'local' });
      for (const a of anims) {
        const p = animToUnrealPlan(a, rig, bt.bones);
        console.log(JSON.stringify({ name: a.name, frames: p.numKeys, fps: p.frameRate, tracks: p.tracks.length, axes: p.axes, warnings: p.warnings, unmatched: p.unmatched }, null, 1));
      }
    } else {
      const t0 = Date.now();
      const r = await sendAnimToUnreal(anims, rig, { mcpUrl, contentPath: content, skeleton, log: (...m) => console.log('[ue-anim]', ...m) });
      console.log(JSON.stringify(r, null, 1), `\n${((Date.now() - t0) / 1000).toFixed(1)} sn`);
      if (readback) for (const s of r.sequences) {
        const seq = await ue('animation', 'read_sequence', { assetPath: s.path });
        console.log('read_sequence:', JSON.stringify({ numFrames: seq.numFrames, frameRate: seq.frameRate, lengthSeconds: seq.lengthSeconds, loop: seq.loop }));
        await compareJoints(anims.find((a) => a.name === s.name), s);
      }
    }
  }
} finally { await closeAll(); }

// Uçtan uca: UE'nin bileşen uzayı eklem konumları (read_bone_track space:'component', tüm kareler) ↔ UPE dünya eklemleri × eksen
// eşlemesi × ölçek (kök kemiğe göre). Her karede tüm eşleşen kemikler.
async function compareJoints(anim, s) {
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qrot = (q, v) => { const r = qmul(qmul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]); return r.slice(0, 3); };
  const nq = (q) => { const l = Math.hypot(...q); return q.map((x) => x / l); };
  const slerp = (a, b, t) => { let d = a.reduce((x, v, i) => x + v * b[i], 0); if (d < 0) { b = b.map((v) => -v); d = -d; } if (d > 0.9995) return nq(a.map((v, i) => v + (b[i] - v) * t)); const th = Math.acos(d), sn = Math.sin(th); return a.map((v, i) => v * Math.sin((1 - t) * th) / sn + b[i] * Math.sin(t * th) / sn); };
  const ev = (keys, f, n) => { if (!keys?.length) return null; const g = (k) => keys[k].slice(1, 1 + n); if (f <= keys[0][0]) return g(0); const m = keys.length; if (f >= keys[m - 1][0]) return g(m - 1); let k = 0; while (keys[k + 1][0] <= f) k++; const t = (f - keys[k][0]) / (keys[k + 1][0] - keys[k][0]); return n === 4 ? nq(slerp(g(k), g(k + 1), t)) : g(k).map((v, i) => v + (keys[k + 1][i + 1] - v) * t); };
  const M = s.axes.matrix; const mapV = (v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const byName = new Map(rig.bones.map((b) => [b.name, b])); const order = []; const seen = new Set();
  const add = (b) => { if (seen.has(b.name)) return; seen.add(b.name); if (b.parent && byName.has(b.parent)) add(byName.get(b.parent)); order.push(b); };
  rig.bones.forEach(add);
  const fk = (f) => { const W = new Map(), G = new Map(); for (const b of order) { const t = anim.tracks[b.name]; const lq = ev(t?.rot, f, 4) || b.restQ, lp = ev(t?.pos, f, 3) || b.restP; const pw = b.parent && W.get(b.parent); W.set(b.name, pw ? nq(qmul(pw, lq)) : lq); G.set(b.name, pw ? G.get(b.parent).map((x, i) => x + qrot(pw, lp)[i]) : lp); } return G; };
  const bt = await ue('animation', 'get_bone_transforms', { skeletonPath: s.skeleton, space: 'local' });
  const map = matchBones(rig.bones.map((b) => b.name), bt.bones.map((b) => b.name));
  const root = order[0].name; const N = Math.max(2, Math.round(anim.length)); const frames = [...Array(N).keys()];
  const ueC = new Map();
  for (const n of map.keys()) {
    const rb = await ue('animation', 'read_bone_track', { assetPath: s.path, boneName: map.get(n), frames, space: 'component', rotationFormat: 'quaternion' });
    ueC.set(n, (rb.samples || []).map((x) => [x.location.x, x.location.y, x.location.z]));
  }
  const G0 = fk(0); const rel = (G, n) => G.get(n).map((x, i) => x - G.get(root)[i]); const urel = (n, f) => ueC.get(n)[f].map((x, i) => x - ueC.get(root)[f][i]);
  const ratios = [...map.keys()].filter((n) => n !== root && Math.hypot(...rel(G0, n)) > 0.05).map((n) => Math.hypot(...urel(n, 0)) / Math.hypot(...rel(G0, n))).sort((a, b) => a - b);
  const sc = ratios[ratios.length >> 1];
  let worst = 0, at = '', cnt = 0;
  for (const f of frames) { const G = fk(f); for (const n of map.keys()) { if (!ueC.get(n)[f]) continue; const want = mapV(rel(G, n)).map((x) => x * sc); const d = Math.hypot(...want.map((x, i) => x - urel(n, f)[i])); cnt++; if (d > worst) { worst = d; at = `${n}@${f}`; } } }
  const hips = ueC.get('Hips') || ueC.get([...map.keys()][1]);
  console.log(`eklem karşılaştırması: ${map.size} kemik × ${N} kare (${cnt} örnek), ölçek ${sc.toFixed(3)}, en büyük sapma ${worst.toFixed(3)} cm (${at}); kalça yolu ${hips[0].map((x) => x.toFixed(1)).join(',')} → ${hips[N - 1].map((x) => x.toFixed(1)).join(',')} cm`);
}
