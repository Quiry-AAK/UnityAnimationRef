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
const mcpUrl = `ue-mcp${ver ? '@' + ver : ''}:${uproject.replace(/\\/g, '/')}`;
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
        console.log('read_sequence:', JSON.stringify(seq).slice(0, 700));
        const bt = await ue('animation', 'get_bone_transforms', { skeletonPath: s.skeleton, space: 'local' });
        const plan = animToUnrealPlan(anims.find((a) => a.name === s.name), rig, bt.bones);
        let worst = 0, worstBone = '';
        for (const tr of plan.tracks.slice(0, 12)) {
          const rb = await ue('animation', 'read_bone_track', { assetPath: s.path, boneName: tr.bone, rotationFormat: 'quaternion' });
          const keys = rb?.keyframes || rb?.frames || rb?.keys || [];
          keys.forEach((k, i) => {
            const want = tr.keyframes[i]?.rotation; const got = k.rotation; if (!want || !got) return;
            const d = Math.abs(want.x * got.x + want.y * got.y + want.z * got.z + want.w * got.w);
            const ang = 2 * Math.acos(Math.min(1, d)) * 180 / Math.PI; if (ang > worst) { worst = ang; worstBone = `${tr.bone}@${i}`; }
          });
          if (tr === plan.tracks[0]) console.log('read_bone_track örnek:', JSON.stringify(rb).slice(0, 400));
        }
        console.log(`geri okuma: en büyük dönüş farkı ${worst.toFixed(3)}° (${worstBone})`);
      }
    }
  }
} finally { await closeAll(); }
