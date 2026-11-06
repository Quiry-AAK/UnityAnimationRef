// VFX mesh parçacıkları: yerleşik prosedürel mesh'ler, animasyondan yay oturtma, Unreal için OBJ. DOM/three bağımlılığı yok:
// editör (vfx-sim.js), MCP ve Niagara dönüştürücüsü (lib/unreal-vfx.js) aynı geometriyi üretir.
// Koordinatlar Unity uzayında (sol-el, +X sağ, +Y yukarı, +Z ileri), metre. Mesh parçacığın yerelinde durur; parçacık boyutu
// (startSize × sizeOverLifetime) mesh'i düzgün ölçekler.

const D2R = Math.PI / 180;

// renderer.mesh → { positions: Float32Array (xyz), normals, uvs (uv), indices: Uint32Array }
//  arc:      XY düzleminde halka dilimi; açı 0 = +X, +Y'ye doğru `angle` derece. U = yay boyunca 0→1, V = iç yarıçap 0 → dış 1.
//  cylinder: Y ekseni etrafında, taban y=0, tepe y=height; alt yarıçap outerRadius, üst yarıçap innerRadius (koni/hortum),
//            açı 0 = +X, +Z'ye doğru. U = açı boyunca, V = alttan üste.
//  plane:    XY düzleminde 1×1 kare (merkez orijin). U = +X, V = +Y.
//  hilal:    hacimli 3B hilal: XY düzleminde yay (açı 0 = +X, +Y'ye doğru `angle`), ön (dış) kenar outerRadius, ortadaki
//            en geniş iç kenar innerRadius (uçlarda genişlik 0), Z yönünde mercek kesitli kalınlık (en fazla `height`, kenarlara
//            ve uçlara doğru 0). Kapalı yüzey (üst + alt). U = yay boyunca 0→1, V = enine iç 0 → dış/ön 1 (üst ve alt yüzde aynı).
// Normaller -Z (arc/plane: Unity Local hizalı quad gibi -Z tarafından aynasız görünür), silindirde dışa.
export function proceduralMesh(m) {
  if (m.shape === 'hilal') return crescentMesh(m);
  const seg = Math.max(1, Math.round(m.segments || 1)), rings = Math.max(1, Math.round(m.rings || 1));
  const nv = (seg + 1) * (rings + 1);
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2);
  let k = 0;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    for (let j = 0; j <= rings; j++, k++) {
      const v = j / rings;
      let x, y, z, nx = 0, ny = 0, nz = -1;
      if (m.shape === 'cylinder') {
        const a = u * m.angle * D2R, r = m.outerRadius + (m.innerRadius - m.outerRadius) * v;
        x = Math.cos(a) * r; z = Math.sin(a) * r; y = v * m.height; nx = Math.cos(a); nz = Math.sin(a);
      } else if (m.shape === 'plane') { x = u - 0.5; y = v - 0.5; z = 0; }
      else { const a = u * m.angle * D2R, r = m.innerRadius + (m.outerRadius - m.innerRadius) * v; x = Math.cos(a) * r; y = Math.sin(a) * r; z = 0; }
      P.set([x, y, z], k * 3); N.set([nx, ny, nz], k * 3); UV.set([u, v], k * 2);
    }
  }
  const I = new Uint32Array(seg * rings * 6); let t = 0;
  const id = (i, j) => i * (rings + 1) + j;
  for (let i = 0; i < seg; i++) for (let j = 0; j < rings; j++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    I.set([a, b, c, a, c, d], t); t += 6;
  }
  return { positions: P, normals: N, uvs: UV, indices: I };
}

// hacimli hilal (bkz. üstteki açıklama): seg × rings ızgara; rings kesit çevresini dolaşır (üst yüz iç→dış, alt yüz dış→iç)
function crescentMesh(m) {
  const seg = Math.max(4, Math.round(m.segments || 64)), rings = Math.max(4, Math.round(m.rings || 16)) * 2;
  const R = m.outerRadius, W = Math.max(0.001, m.outerRadius - m.innerRadius), T = (m.height || 0.3) * 0.5, A = m.angle * D2R;
  const pt = (u, v) => {
    const side = v <= 0.5 ? 1 : -1, c = v <= 0.5 ? v * 2 : (1 - v) * 2;
    const su = Math.sin(Math.PI * u), w = W * Math.pow(su, 0.9), r = R - w * (1 - c);
    const t = T * Math.pow(su, 0.7) * Math.pow(Math.sin(Math.PI * c), 0.6);
    const a = u * A; return [Math.cos(a) * r, Math.sin(a) * r, side * t, c];
  };
  const nv = (seg + 1) * (rings + 1);
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2);
  const e = 1e-3; let k = 0;
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    for (let j = 0; j <= rings; j++, k++) {
      const v = j / rings, p = pt(u, v);
      const pu1 = pt(Math.min(1, u + e), v), pu0 = pt(Math.max(0, u - e), v), pv1 = pt(u, Math.min(1, v + e)), pv0 = pt(u, Math.max(0, v - e));
      const du = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]], dv = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
      let n = [du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]];
      const nl = Math.hypot(...n);
      n = nl > 1e-9 ? n.map((x) => -x / nl) : [0, 0, v <= 0.5 ? 1 : -1];   // du×dv içe bakar; dışa çevir
      P.set(p.slice(0, 3), k * 3); N.set(n, k * 3); UV.set([u, p[3]], k * 2);
    }
  }
  const I = new Uint32Array(seg * rings * 6); let t = 0;
  const id = (i, j) => i * (rings + 1) + j;
  for (let i = 0; i < seg; i++) for (let j = 0; j < rings; j++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    I.set([a, c, b, a, d, c], t); t += 6;   // dışa bakan sarım (cull back yalnız yakın yüzü çizsin)
  }
  return { positions: P, normals: N, uvs: UV, indices: I };
}

// mesh.rotation (Unity Euler, derece) uygulanmış geometri (Niagara'ya giden OBJ ve önizleme aynı tabanı kullanır)
export function unityEulerMatrix(deg) {
  const [x, y, z] = (deg || [0, 0, 0]).map((v) => v * D2R);
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), ff = Math.sin(z);
  const ce = c * e, cf = c * ff, de = d * e, df = d * ff;
  return [[ce + df * b, de * b - cf, a * d], [a * ff, a * e, -b], [cf * b - de, df + ce * b, a * c]];
}
// satır-ana 3x3 → Unity Euler (Z→X→Y; unityEulerMatrix'in tersi), derece
export function matrixToUnityEuler(M) {
  const sx = Math.max(-1, Math.min(1, -M[1][2]));
  const x = Math.asin(sx);
  let y, z;
  if (Math.abs(sx) < 0.99999) { y = Math.atan2(M[0][2], M[2][2]); z = Math.atan2(M[1][0], M[1][1]); }
  else { y = Math.atan2(-M[2][0], M[0][0]); z = 0; } // gimbal: z'yi y'ye kat
  return [x, y, z].map((v) => +(v / D2R).toFixed(3));
}
export function transformMesh(g, deg) {
  if (!deg || deg.every((v) => !v)) return g;
  const M = unityEulerMatrix(deg);
  const tr = (A) => { const o = new Float32Array(A.length); for (let i = 0; i < A.length; i += 3) for (let r = 0; r < 3; r++) o[i + r] = M[r][0] * A[i] + M[r][1] * A[i + 1] + M[r][2] * A[i + 2]; return o; };
  return { ...g, positions: tr(g.positions), normals: tr(g.normals) };
}

// Geometri imzası (Unreal varlık adı / önbellek): şekil parametreleri değişince yeni varlık
export function meshKey(m) {
  const s = m.shape === 'file' ? `file:${m.file}` : JSON.stringify([m.shape, m.innerRadius, m.outerRadius, m.angle, m.height, m.segments, m.rings, m.rotation]);
  let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Unreal OBJ: Unity (m) → UE (+X ileri = Unity Z, +Y sağ = Unity X, +Z yukarı = Unity Y; cm). UE'nin OBJ içe aktarıcısı Y'yi
// aynalıyor (Elarion slash_arc_obj.py, asimetrik üçgenle ölçüldü) → y yazılırken çevrilir. vt Unity düzeninde (v yukarı); UE
// içe aktarırken v'yi çevirir, böylece materyaldeki (u, 1−v) kuralı sprite ile aynı kalır.
export function meshToOBJ(g, name = 'UPE_Mesh') {
  const L = [`# UPE vfx mesh (Unity → UE cm, Y içe aktarıcı aynası için çevrildi)`, `o ${name}`];
  const P = g.positions, N = g.normals, UV = g.uvs;
  const f = (v) => +v.toFixed(5);
  for (let i = 0; i < P.length; i += 3) L.push(`v ${f(P[i + 2] * 100)} ${f(-P[i] * 100)} ${f(P[i + 1] * 100)}`);
  for (let i = 0; i < UV.length; i += 2) L.push(`vt ${f(UV[i])} ${f(UV[i + 1])}`);
  for (let i = 0; i < N.length; i += 3) L.push(`vn ${f(N[i + 2])} ${f(-N[i])} ${f(N[i + 1])}`);
  const I = g.indices;
  for (let i = 0; i < I.length; i += 3) { const [a, b, c] = [I[i] + 1, I[i + 1] + 1, I[i + 2] + 1]; L.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`); }
  return L.join('\n') + '\n';
}

// ───────────────────────────── yay oturtma (Elarion Scripts/VfxTools/arc_fit.py ile aynı yöntem)
// tips/grips: [[x,y,z]] Unity, aynı uzayda (ör. efekt kökü), zaman sırasıyla. Düzlem: uç noktalarının en küçük varyans yönü;
// çember: düzlemde cebirsel en küçük kareler; dönüş yönü ilk örnekten itibaren açı artacak şekilde.
// → { center, rotation (Unity Euler: yerel +X merkezden ilk uca, +X'ten +Y'ye dönüş, Z = X×Y), radius, angle (°), inner
//     (tutuş yarıçapı / uç yarıçapı), axes, progress: [her örnek için 0..1 yay kesri], error: { circleMax, planeMax } (m) }
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return scl(a, 1 / l); };

// simetrik 3x3 özdeğer (Jacobi) → [{ value, vector }] büyükten küçüğe
export function eigenSym3(A) {
  const a = A.map((r) => [...r]); const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1; for (const [i, j] of [[0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-14) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  return [0, 1, 2].map((i) => ({ value: a[i][i], vector: [V[0][i], V[1][i], V[2][i]] })).sort((x, y) => y.value - x.value);
}

export function fitArc(tips, grips = []) {
  if (!tips || tips.length < 3) throw new Error('yay oturtmak için en az 3 uç örneği gerekli');
  const n = tips.length;
  const c0 = scl(tips.reduce(add, [0, 0, 0]), 1 / n);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const t of tips) { const d = sub(t, c0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  const ev = eigenSym3(C);
  let e1 = ev[0].vector, e2 = ev[1].vector, nrm = ev[2].vector;
  const P = tips.map((t) => { const d = sub(t, c0); return [dot(d, e1), dot(d, e2)]; });
  // çember: x² + y² + Dx + Ey + F = 0 (normal denklemler)
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bv = [0, 0, 0];
  for (const [x, y] of P) { const r = [x, y, 1], b = -(x * x + y * y); for (let i = 0; i < 3; i++) { bv[i] += r[i] * b; for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j]; } }
  const [D, E, F] = solve3(M, bv);
  let cx = -D / 2, cy = -E / 2;
  const R = Math.sqrt(Math.max(cx * cx + cy * cy - F, 1e-12));
  const center = add(c0, add(scl(e1, cx), scl(e2, cy)));
  const unwrap = () => { const out = []; let prev = 0; P.forEach(([x, y], i) => { let a = Math.atan2(y - cy, x - cx); if (i) { while (a - prev > Math.PI) a -= 2 * Math.PI; while (a - prev < -Math.PI) a += 2 * Math.PI; } out.push(a); prev = a; }); return out; };
  let ang = unwrap();
  if (ang[n - 1] < ang[0]) { nrm = scl(nrm, -1); e2 = scl(e2, -1); for (const p of P) p[1] = -p[1]; cy = -cy; ang = unwrap(); }
  let X = sub(tips[0], center); X = norm(sub(X, scl(nrm, dot(X, nrm))));
  const a0 = ang[0], amax = Math.max(...ang);
  const mid = ang.reduce((bi, a, i) => (Math.abs(a - (a0 + amax) / 2) < Math.abs(ang[bi] - (a0 + amax) / 2) ? i : bi), 0);
  let Y = sub(tips[mid], center); Y = sub(Y, scl(nrm, dot(Y, nrm))); Y = norm(sub(Y, scl(X, dot(Y, X))));
  if (Math.abs(amax - a0) < 1e-6) Y = norm(cross(nrm, X));
  const Z = cross(X, Y);
  const rot = [[X[0], Y[0], Z[0]], [X[1], Y[1], Z[1]], [X[2], Y[2], Z[2]]];
  const sweep = (amax - a0) / D2R;
  const gd = grips.map((g) => { const d = sub(g, center); return Math.hypot(...sub(d, scl(nrm, dot(d, nrm)))); }).sort((a, b) => a - b);
  const inner = gd.length ? gd[Math.floor(gd.length / 2)] / R : 0;
  const resid = P.map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - R));
  const planar = tips.map((t) => Math.abs(dot(sub(t, center), nrm)));
  let best = a0; const progress = ang.map((a) => { best = Math.max(best, a); return sweep > 1e-6 ? +((best - a0) / (amax - a0)).toFixed(4) : 0; });
  const r3 = (v) => v.map((x) => +x.toFixed(4));
  return {
    center: r3(center), rotation: matrixToUnityEuler(rot), radius: +R.toFixed(4), angle: +sweep.toFixed(2), inner: +inner.toFixed(4),
    axes: { X: r3(X), Y: r3(Y), Z: r3(Z) }, progress,
    error: { circleMax: +Math.max(...resid).toFixed(4), planeMax: +Math.max(...planar).toFixed(4) }, samples: n,
  };
}
function solve3(A, b) { // Gauss (kısmi pivot)
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < 3; r++) if (r !== c) { const k = M[r][c] / d; for (let j = c; j < 4; j++) M[r][j] -= k * M[c][j]; }
  }
  return [0, 1, 2].map((i) => M[i][3] / (M[i][i] || 1e-12));
}
