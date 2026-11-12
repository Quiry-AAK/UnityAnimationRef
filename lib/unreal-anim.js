// Animasyon → Unreal AnimSequence (docs/UNREAL.md "Animasyon"). Yol: ue-mcp'nin animation eylemleri; FBX/glTF ara dosyası yok.
//   1) hedef iskelet (UE'deki aynı Mixamo karakteri; SkeletalMesh ya da Skeleton yolu) → get_bone_transforms (yerel rest pozu)
//   2) saf dönüştürme animToUnrealPlan: UPE kemik izleri → UE iskeletinin yerel anahtarları (her kare, tüm eşleşen kemikler)
//   3) create_sequence (numFrames/frameRate) → bake_keyframes_batch (tek işlem, kaydet) → set_sequence_properties { loop }
// Retarget dünya uzayında, unity/AnimRefImporter.cs ile aynı fikir: her kemiğin UPE dünya dönüşü hedefe eksen eşlemesiyle verilir
// (Wue = M(Wg) · K); kemik eksenleri hedefte farklıysa K = o kemikte rest'ler aynı poz sayılır. Eksen eşlemesi M (Unity: X aynası)
// burada sabit değil: UE'nin FBX içe aktarma ayarına (Convert Scene, Force Front X) göre değişir, bu yüzden 48 işaretli eksen
// permütasyonundan rest pozdaki kemik yönlerine en iyi oturan seçilir (UE FBX varsayılanı: UE = (x, z, y) × 100).
import { callUe, UnrealMcpError } from './unreal-mcp-client.js';

export const DEFAULT_ANIM_CONTENT_PATH = '/Game/UPE/Animations';

// ── kuaterniyon / vektör ([x,y,z,w], [x,y,z])
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const qangle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(qdot(qnorm(a), qnorm(b))))) * 180 / Math.PI;
function qslerp(a, b, t) {
  let d = qdot(a, b); if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qnorm(a.map((v, i) => v + (b[i] - v) * t));
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + b[i] * wb);
}
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vangle = (a, b) => { const l = vlen(a) * vlen(b); return l < 1e-12 ? 0 : Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / l))) * 180 / Math.PI; };
const xyz = (o, d = [0, 0, 0]) => (o && typeof o === 'object' ? (Array.isArray(o) ? [o[0], o[1], o[2]] : [o.x ?? d[0], o.y ?? d[1], o.z ?? d[2]]) : d);
const xyzw = (o) => (Array.isArray(o) ? [o[0], o[1], o[2], o[3]] : o && typeof o === 'object' ? [o.x ?? 0, o.y ?? 0, o.z ?? 0, o.w ?? 1] : [0, 0, 0, 1]);
const r6 = (v) => Math.round(v * 1e6) / 1e6 || 0;

// ── eksen eşlemesi: işaretli permütasyon matrisi (satırlar). mapV(v) = M·v; mapQ: R' = M R Mᵀ → eksen det·M·a, açı aynı
export function axisCandidates() {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]; const out = [];
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const M = [0, 1, 2].map((r) => { const row = [0, 0, 0]; row[p[r]] = (s >> r) & 1 ? -1 : 1; return row; });
    out.push(M);
  }
  return out;
}
const det3 = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
const mapper = (M) => {
  const d = det3(M);
  const mapV = (v) => [0, 1, 2].map((r) => M[r][0] * v[0] + M[r][1] * v[1] + M[r][2] * v[2]);
  return { M, det: d, mapV, mapQ: (q) => { const a = mapV(q); return [d * a[0], d * a[1], d * a[2], q[3]]; } };
};
export const UE_FBX_DEFAULT_AXES = [[1, 0, 0], [0, 0, 1], [0, 1, 0]]; // UE = (x, z, y): Y-up → Z-up + Y aynası (karakter +Y'ye bakar)

// kemik adı eşleme: yalnız harf/rakam (Unity Norm gibi), sonra "mixamorig" önekisiz
const norm = (s) => String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const bare = (s) => norm(s).replace(/^mixamorig\d*/, '');
export function matchBones(upeNames, ueNames) {
  const exact = new Map(), loose = new Map();
  for (const n of ueNames) { if (!exact.has(norm(n))) exact.set(norm(n), n); if (!loose.has(bare(n))) loose.set(bare(n), n); }
  const map = new Map(); const used = new Set();
  for (const n of upeNames) { const u = exact.get(norm(n)); if (u && !used.has(u)) { map.set(n, u); used.add(u); } }
  for (const n of upeNames) { if (map.has(n)) continue; const u = loose.get(bare(n)); if (u && bare(n) && !used.has(u)) { map.set(n, u); used.add(u); } }
  return map; // UPE adı → UE adı
}

// UPE izlerinin değerlendirmesi (app.js / AnimRefImporter.cs ile aynı: kare numarasıyla slerp/lerp, uçlarda sabit)
function evalRot(keys, f) {
  if (!keys?.length) return null;
  if (f <= keys[0][0]) return qnorm(keys[0].slice(1, 5));
  const n = keys.length; if (f >= keys[n - 1][0]) return qnorm(keys[n - 1].slice(1, 5));
  let k = 0; while (keys[k + 1][0] <= f) k++;
  return qnorm(qslerp(keys[k].slice(1, 5), keys[k + 1].slice(1, 5), (f - keys[k][0]) / (keys[k + 1][0] - keys[k][0])));
}
function evalPos(keys, f) {
  if (!keys?.length) return null;
  if (f <= keys[0][0]) return keys[0].slice(1, 4);
  const n = keys.length; if (f >= keys[n - 1][0]) return keys[n - 1].slice(1, 4);
  let k = 0; while (keys[k + 1][0] <= f) k++;
  const t = (f - keys[k][0]) / (keys[k + 1][0] - keys[k][0]);
  return keys[k].slice(1, 4).map((v, i) => v + (keys[k + 1][i + 1] - v) * t);
}

// UE rest pozu (get_bone_transforms yerel) → sıralı kemikler + bileşen uzayı
function prepUE(ueBones) {
  const list = [...ueBones].map((b, i) => ({ name: b.name, index: b.index ?? i, parentIndex: b.parentIndex ?? -1, loc: xyz(b.location), rot: qnorm(xyzw(b.rotation)) }))
    .sort((a, b) => a.index - b.index);
  const byIndex = new Map(list.map((b) => [b.index, b]));
  for (const b of list) {
    const p = byIndex.get(b.parentIndex); b.parent = p || null;
    b.compRot = p ? qnorm(qmul(p.compRot, b.rot)) : b.rot;
    b.compPos = p ? vadd(p.compPos, qrot(p.compRot, b.loc)) : b.loc;
  }
  return { list, byName: new Map(list.map((b) => [b.name, b])) };
}

// UPE rig (state.rig: bones [{ name, parent, restQ, restP }]) → ebeveyn önce sıralı, rest FK
function prepUPE(rig) {
  const byName = new Map(); for (const b of rig.bones || []) byName.set(b.name, { ...b });
  const order = []; const seen = new Set();
  const add = (b) => { if (seen.has(b.name)) return; seen.add(b.name); const p = b.parent && byName.get(b.parent); if (p) add(p); order.push(b); };
  for (const b of byName.values()) add(b);
  for (const b of order) {
    const p = b.parent && byName.get(b.parent); b.p = p || null;
    b.restQ = qnorm(b.restQ || [0, 0, 0, 1]); b.restP = b.restP || [0, 0, 0];
    b.restW = p ? qnorm(qmul(p.restW, b.restQ)) : b.restQ;
    b.restG = p ? vadd(p.restG, qrot(p.restW, b.restP)) : b.restP;
  }
  return { order, byName };
}

// Eksen eşlemesi kalibrasyonu: eşleşen kemik çiftlerinin (çocuk − ebeveyn) bileşen uzayı yönleri
export function calibrateAxes(upe, ue, map) {
  const pairs = [];
  for (const b of upe.order) {
    if (!b.p || !map.has(b.name) || !map.has(b.p.name)) continue;
    const d1 = vsub(b.restG, b.p.restG); const B = ue.byName.get(map.get(b.name)), P = ue.byName.get(map.get(b.p.name));
    const d2 = vsub(B.compPos, P.compPos);
    if (vlen(d1) > 1e-6 && vlen(d2) > 1e-6) pairs.push([d1, d2]);
  }
  if (!pairs.length) return { mapper: mapper(UE_FBX_DEFAULT_AXES), score: 0, pairs: 0, fallback: true };
  let best = null;
  for (const M of axisCandidates()) {
    const m = mapper(M); let s = 0;
    for (const [a, b] of pairs) s += Math.cos(vangle(m.mapV(a), b) * Math.PI / 180);
    s /= pairs.length;
    // eşitlikte UE FBX varsayılanı önce
    if (!best || s > best.score + 1e-9 || (Math.abs(s - best.score) <= 1e-9 && JSON.stringify(M) === JSON.stringify(UE_FBX_DEFAULT_AXES))) best = { mapper: m, score: s };
  }
  return { ...best, pairs: pairs.length };
}

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const AXIS_MATCH_DEG = 10;

// Saf dönüştürme (editörsüz test edilir). anim: { name, fps, length, loop, tracks: { kemik: { rot:[[f,x,y,z,w]], pos:[[f,x,y,z]] } } }
// ueBones: get_bone_transforms { bones } (yerel). → { numFrames, numKeys, frameRate, loop, tracks:[{ bone, keyframes }], mapping, axes, warnings, unmatched }
export function animToUnrealPlan(anim, rig, ueBones, { axes } = {}) {
  if (!rig?.bones?.length) throw new Error('Rig bilgisi yok; editörde bir karakter yükle.');
  if (!Array.isArray(ueBones) || !ueBones.length) throw new Error('Unreal iskeletinde kemik yok (get_bone_transforms boş döndü).');
  const warnings = [];
  const upe = prepUPE(rig); const ue = prepUE(ueBones);
  const map = matchBones(upe.order.map((b) => b.name), ue.list.map((b) => b.name));
  const tracks = anim?.tracks || {};
  const tracked = Object.keys(tracks).filter((n) => tracks[n]?.rot?.length || tracks[n]?.pos?.length);
  const unmatched = tracked.filter((n) => !map.has(n));
  if (!map.size) throw new Error('Hiçbir kemik eşleşmedi: Unreal iskeleti UPE rigiyle aynı (Mixamo) kemik adlarını taşımıyor. Hedef iskelet olarak UE\'deki aynı karakteri seç (retarget için docs/UNREAL.md).');
  if (tracked.length && unmatched.length === tracked.length) throw new Error(`İzli kemiklerin hiçbiri Unreal iskeletinde yok (${unmatched.slice(0, 5).join(', ')}…)`);
  if (unmatched.length) warnings.push(`${unmatched.length} izli kemik Unreal iskeletinde yok, atlandı: ${unmatched.slice(0, 8).join(', ')}${unmatched.length > 8 ? '…' : ''}`);

  const cal = axes ? { mapper: mapper(axes), score: null, pairs: 0 } : calibrateAxes(upe, ue, map);
  const { mapV, mapQ } = cal.mapper;
  if (cal.fallback) warnings.push('Eksen eşlemesi kalibre edilemedi (eşleşen kemik çifti yok); UE FBX varsayılanı (x, z, y) kullanıldı.');
  else if (cal.score != null && cal.score < 0.9) warnings.push(`Eksen eşlemesi zayıf (uyum ${cal.score.toFixed(2)}): rest pozlar çok farklı ya da iskelet başka bir rig olabilir.`);

  // kemik başına: UE karşılığı, eksen uyumu (K), konum oranı
  const B = new Map();
  for (const b of upe.order) {
    const u = map.has(b.name) ? ue.byName.get(map.get(b.name)) : null; if (!u) continue;
    B.set(b.name, { u, k: [0, 0, 0, 1], ratio: null, axesMatch: true });
  }
  const ratios = [];
  for (const b of upe.order) {
    const e = B.get(b.name); if (!e) continue;
    if (vlen(b.restP) > 1e-6 && vlen(e.u.loc) > 1e-6 && b.p && B.get(b.p.name)?.u === e.u.parent) { e.ratio = vlen(e.u.loc) / vlen(b.restP); ratios.push(e.ratio); }
  }
  const ratioG = median(ratios) ?? (rig.unitScale === 0.01 ? 1 : 100);
  const axisMismatch = [];
  for (const b of upe.order) {
    const e = B.get(b.name); if (!e) continue;
    let worst = -1;
    for (const c of upe.order) {
      const ce = c.p === b && B.get(c.name); if (!ce || ce.u.parent !== e.u) continue;
      if (vlen(c.restP) > 1e-5 && vlen(ce.u.loc) > 1e-5) worst = Math.max(worst, vangle(mapV(c.restP), ce.u.loc));
    }
    e.axesMatch = worst >= 0 ? worst < AXIS_MATCH_DEG : !b.p || (B.get(b.p.name)?.axesMatch ?? true);
    if (!e.axesMatch) { e.k = qnorm(qmul(qinv(mapQ(b.restW)), e.u.compRot)); axisMismatch.push(b.name); }
    if (e.ratio == null) e.ratio = ratioG;
  }
  if (axisMismatch.length) warnings.push(`${axisMismatch.length} kemikte eksenler hedefte farklı; bu kemiklerde rest pozlar aynı varsayıldı: ${axisMismatch.slice(0, 6).join(', ')}${axisMismatch.length > 6 ? '…' : ''}`);
  // kök (ebeveynsiz UPE kemiği): bileşen uzayında mutlak konum, hedef/kaynak yükseklik oranıyla
  for (const b of upe.order) {
    const e = B.get(b.name); if (!e || b.p) continue;
    e.rootRatio = vlen(b.restG) > 1e-4 && vlen(e.u.compPos) > 1e-4 ? vlen(e.u.compPos) / vlen(b.restG) : ratioG;
  }

  // kareler
  let fps = Number(anim?.fps) || 30;
  if (Math.abs(fps - Math.round(fps)) > 1e-6) { warnings.push(`UE kare hızı tam sayı: ${fps} → ${Math.round(fps)}`); }
  fps = Math.max(1, Math.round(fps));
  const numKeys = Math.max(2, Math.round(Number(anim?.length) || 2));
  const out = new Map(); // UE adı → { keyframes, hasLoc, differs }
  for (const [n, e] of B) out.set(e.u.name, { upe: n, keyframes: [], hasLoc: !!tracks[n]?.pos?.length, differs: !!tracks[n]?.rot?.length || !!tracks[n]?.pos?.length });
  // 2 geçiş: 1) hangi kemik hedef rest'inden ayrılıyor; 2) ayrılmayanlar UE rest'inde sabit (yazılmaz), çocukları ona göre
  for (const pass of [1, 2]) {
  if (pass === 2) for (const o of out.values()) { o.keyframes = []; if (!o.differs) o.fixed = true; }
  for (let f = 0; f < numKeys; f++) {
    // UPE FK
    const W = new Map(), G = new Map();
    for (const b of upe.order) {
      const t = tracks[b.name];
      const lq = evalRot(t?.rot, f) || b.restQ; const lp = evalPos(t?.pos, f) || b.restP;
      const pw = b.p ? W.get(b.p.name) : null;
      W.set(b.name, pw ? qnorm(qmul(pw, lq)) : lq);
      G.set(b.name, pw ? vadd(G.get(b.p.name), qrot(pw, lp)) : lp);
    }
    // UE FK (indeks sırası = ebeveyn önce)
    const compR = new Map(), compP = new Map();
    for (const u of ue.list) {
      const pr = u.parent ? compR.get(u.parent.index) : [0, 0, 0, 1], pp = u.parent ? compP.get(u.parent.index) : [0, 0, 0];
      const o = out.get(u.name); let lr = u.rot, ll = u.loc;
      if (o && !o.fixed) {
        const b = upe.byName.get(o.upe); const e = B.get(o.upe);
        const wue = qnorm(qmul(mapQ(W.get(b.name)), e.k));
        lr = qnorm(qmul(qinv(pr), wue));
        if (o.hasLoc) {
          if (!b.p) ll = qrot(qinv(pr), vsub(vscale(mapV(G.get(b.name)), e.rootRatio), pp));
          else {
            const d = qrot(W.get(b.p.name), vsub(evalPos(tracks[b.name].pos, f), b.restP)); // UPE dünyasında rest'ten sapma
            ll = vadd(u.loc, qrot(qinv(pr), vscale(mapV(d), e.ratio)));
          }
        }
        const prev = o.keyframes[o.keyframes.length - 1]?.q; if (prev && qdot(prev, lr) < 0) lr = lr.map((v) => -v); // yarı küre sürekliliği
        if (!o.differs && qangle(lr, u.rot) > 0.05) o.differs = true;
        o.keyframes.push({ q: lr, l: o.hasLoc ? ll : null });
      }
      compR.set(u.index, qnorm(qmul(pr, lr))); compP.set(u.index, vadd(pp, qrot(pr, ll)));
    }
  }
  }
  const outTracks = [];
  for (const [bone, o] of out) {
    if (!o.differs) continue; // izsiz ve hedef rest'iyle aynı kalan kemik yazılmaz (UE rest'i kullanır)
    outTracks.push({ bone, keyframes: o.keyframes.map(({ q, l }) => (l ? { rotation: { x: r6(q[0]), y: r6(q[1]), z: r6(q[2]), w: r6(q[3]) }, location: { x: r6(l[0]), y: r6(l[1]), z: r6(l[2]) } } : { rotation: { x: r6(q[0]), y: r6(q[1]), z: r6(q[2]), w: r6(q[3]) } })) });
  }
  return {
    name: anim?.name || 'anim', numKeys, numFrames: numKeys - 1, frameRate: fps, loop: !!anim?.loop, tracks: outTracks,
    mapping: Object.fromEntries([...B].map(([n, e]) => [n, e.u.name])), unmatched,
    axes: { matrix: cal.mapper.M, score: cal.score, pairs: cal.pairs }, warnings,
  };
}

// UE varlık adı: ASCII, harf/rakam/_
export function ueAssetName(name, prefix = 'A_') {
  const tr = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
  const s = String(name || 'anim').replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => tr[c]).normalize('NFKD').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'anim';
  return s.startsWith(prefix) ? s : prefix + s;
}

// ── yürütme (gerçek UE editörü; ue-mcp hedefi gerekir)
// MCP yanıtından /Game/... varlık yollarını topla (list_skeletal_meshes yanıt biçimine bağlı kalmamak için)
function collectPaths(o, out = new Set()) {
  if (typeof o === 'string') { if (/^\/(Game|[A-Z]\w*)\/[^\s]+$/.test(o) && !/\/Script\//.test(o)) out.add(o); }
  else if (Array.isArray(o)) for (const v of o) collectPaths(v, out);
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (/path|asset|mesh|object/i.test(k) || typeof v === 'object') collectPaths(v, out);
  return out;
}
const boneNamesOf = (r) => (Array.isArray(r?.bones) ? r.bones.map((b) => (typeof b === 'string' ? b : b?.name)).filter(Boolean) : []);

// UPE rigine en çok uyan iskelet (UE'deki SkeletalMesh'ler arasından); ayarlı değilse kullanılır
export async function findSkeleton(rig, { mcpUrl, log = () => {}, limit = 40 } = {}) {
  const res = await callUe('animation', 'list_skeletal_meshes', { limit: 500 }, { mcpUrl, timeoutMs: 120000 });
  const cands = [...collectPaths(res)].filter((p) => p.startsWith('/Game/')).slice(0, limit);
  const upeNames = (rig.bones || []).map((b) => b.name);
  let best = null;
  for (const p of cands) {
    let info; try { info = await callUe('animation', 'get_skeleton_info', { assetPath: p }, { mcpUrl, timeoutMs: 60000 }); } catch { continue; }
    const names = boneNamesOf(info); if (!names.length) continue;
    const score = matchBones(upeNames, names).size / Math.max(1, upeNames.length);
    log(`iskelet adayı ${p}: ${(score * 100).toFixed(0)}%`);
    if (!best || score > best.score) best = { path: p, score };
  }
  if (!best || best.score < 0.5) throw new UnrealMcpError(`UE projesinde UPE rigine uyan iskelet bulunamadı (${cands.length} SkeletalMesh denendi${best ? `, en iyi ${best.path} %${(best.score * 100).toFixed(0)}` : ''}). Mixamo karakterini UE'ye içe aktar ya da set_unreal_project { animSkeleton } ile yolu ver.`);
  return best;
}

const notFound = (e) => /not found|failed to load|could not (load|find)|does not exist|no (anim|asset)|cannot load|invalid asset/i.test(String(e?.message || e));

// anims: [{ name, fps, length, loop, tracks }], rig: state.rig. → { ok, sequences:[{ name, path, skeleton, frames, fps, bones, warnings }], errors, skeleton }
export async function sendAnimToUnreal(anims, rig, { mcpUrl, contentPath = DEFAULT_ANIM_CONTENT_PATH, skeleton, log = () => {}, timeoutMs = Number(process.env.UPE_UE_TIMEOUT_MS) || 300000 } = {}) {
  const ue = (cat, action, args, t = 120000) => callUe(cat, action, args, { mcpUrl, timeoutMs: t });
  const out = { ok: false, sequences: [], errors: {} };
  let skel = skeleton;
  if (!skel) { const f = await findSkeleton(rig, { mcpUrl, log }); skel = f.path; out.skeletonAuto = { path: f.path, match: Math.round(f.score * 100) / 100 }; }
  out.skeleton = skel;
  const bt = await ue('animation', 'get_bone_transforms', { skeletonPath: skel, space: 'local' });
  const ueBones = bt?.bones; if (!Array.isArray(ueBones) || !ueBones.length) throw new UnrealMcpError(`İskelet okunamadı: ${skel} (get_bone_transforms kemik döndürmedi)`);
  for (const anim of anims) {
    const name = ueAssetName(anim.name);
    try {
      const plan = animToUnrealPlan(anim, rig, ueBones);
      const target = `${contentPath}/${name}`;
      // varsa: aynı kare sayısı/hızıyla yerinde yeniden yaz (başvurular korunur), değilse sil (başvurusu varsa durur) ve yeniden kur
      let path = null;
      try {
        const ex = await ue('animation', 'read_sequence', { assetPath: target });
        const keys = Number(ex?.numFrames ?? ex?.numberOfFrames), rate = Number(ex?.frameRate ?? ex?.samplingFrameRate);
        const len = Number(ex?.lengthSeconds ?? ex?.sequenceLength);
        const sameLen = Number.isFinite(len) ? Math.abs(len - plan.numFrames / plan.frameRate) < 1e-3 : keys === plan.numKeys;
        if (sameLen && (!Number.isFinite(rate) || Math.abs(rate - plan.frameRate) < 1e-3)) { path = ex?.assetPath || ex?.path || target; log(`${name}: var, yerinde güncelleniyor`); }
        else {
          log(`${name}: var ama uzunluk farklı → silinip yeniden kurulacak`);
          try { await ue('asset', 'delete', { assetPath: target, force: false }); }
          catch (e) { throw new UnrealMcpError(`${target} zaten var, uzunluğu farklı ve silinemedi (${e.message}). Başka varlıklar kullanıyorsa farklı adla gönder ya da elle sil.`); }
        }
      } catch (e) { if (e instanceof UnrealMcpError && /silinemedi/.test(e.message)) throw e; if (!notFound(e) && !(e instanceof UnrealMcpError && e.toolError)) throw e; }
      if (!path) {
        const c = await ue('animation', 'create_sequence', { name, skeletonPath: skel, packagePath: contentPath, numFrames: plan.numFrames, frameRate: plan.frameRate, onConflict: 'error' });
        path = c?.path || target;
      }
      if (!plan.tracks.length) throw new Error('Yazılacak kemik izi yok (animasyon boş ya da tümü rest pozda).');
      log(`${name}: ${plan.tracks.length} kemik × ${plan.numKeys} anahtar yazılıyor`);
      await ue('animation', 'bake_keyframes_batch', { assetPath: path, tracks: plan.tracks, save: true }, timeoutMs);
      try { await ue('animation', 'set_sequence_properties', { assetPaths: [path], properties: { loop: plan.loop } }); }
      catch (e) { plan.warnings.push('loop ayarlanamadı: ' + e.message); }
      out.sequences.push({ name: anim.name, path, skeleton: skel, frames: plan.numKeys, fps: plan.frameRate, bones: plan.tracks.length, axes: plan.axes, warnings: plan.warnings });
    } catch (e) {
      if (e instanceof UnrealMcpError && e.connect) throw e; // editör kapalı: diğerlerini denemenin anlamı yok
      out.errors[anim.name] = String(e?.message || e);
    }
  }
  out.ok = out.sequences.length > 0 && !Object.keys(out.errors).length;
  if (Object.keys(out.errors).length) out.error = Object.entries(out.errors).map(([n, m]) => `${n}: ${m}`).join('; ');
  return out;
}
