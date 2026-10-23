// Materyal/shader önizlemesi için küçük yardımcılar (three bağımlılığı yok).
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// '#rrggbb[aa]' → [r,g,b,a] doğrusal (alfa olduğu gibi) — Unity Linear projede SetColor(sRGB) ile aynı sonuç
export function parseColorLinear(hex) {
  let s = String(hex || '#ffffff').replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((x) => x + x).join('');
  const n = (i) => parseInt(s.slice(i, i + 2), 16) / 255;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(s)) return [1, 1, 1, 1];
  return [s2l(n(0)), s2l(n(2)), s2l(n(4)), s.length === 8 ? n(6) : 1];
}

// Unity yönlü ışık Euler'i (derece, Z→X→Y) → ışığa DOĞRU birim vektör (Unity ekseni) = -(Q * ileri)
export function unityLightDir(rot) {
  const [x, y, z] = rot.map((d) => (d * Math.PI) / 180);
  // Q = Qy * Qx * Qz uygulanmış (0,0,1)
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y);
  // Qz ileri vektörü değiştirmez; Qx: (0, -sx, cx); Qy: (cy*X + sy*Z, Y, -sy*X + cy*Z)
  const fx = 0, fy = -sx, fz = cx;
  const wx = cy * fx + sy * fz, wy = fy, wz = -sy * fx + cy * fz;
  void z;
  return [-wx, -wy, -wz];
}
