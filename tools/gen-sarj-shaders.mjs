// Ağır saldırı şarj VFX shader'ları + materyalleri (agir_sarj). Hazır doku/düz çizgi yok (Docs/VFX_Kurallari.md).
//  sarj_kilif          : kılıcı saran enerji kılıfı (additive, mesh silindir; U çevre, V kabza 0 → uç 1). Silüette parlayan (fresnel)
//                        akan lifli enerji; i.custom.x = dolum cephesi (V), cephe gürültüyle dalgalı ve parlak; i.custom.y = ek beyaz parlama.
//  sarj_kilif_bukulme  : aynı silindirde sıcak hava bükülmesi (distortion; rg yön, a maske), dolum cephesine kadar.
// Çalıştır: node tools/gen-sarj-shaders.mjs (sonra editörde load_shader / load_material ile yeniden yükle)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOISE = `float hash21(float2 p)
{
    p = frac(p * float2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return frac(p.x * p.y);
}

float vnoise(float2 p)
{
    float2 c = floor(p);
    float2 f = frac(p);
    float2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(c);
    float b = hash21(c + float2(1.0, 0.0));
    float d = hash21(c + float2(0.0, 1.0));
    float e = hash21(c + float2(1.0, 1.0));
    return lerp(lerp(a, b, u.x), lerp(d, e, u.x), u.y);
}

float fbm(float2 p)
{
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 4; k++) { v += a * vnoise(p); p = p * 2.03 + float2(1.7, 9.2); a *= 0.5; }
    return v;
}

// silindir çevresinde dikişsiz koordinat (U 0..1 → açı)
float ringX(float u)
{
    float a = u * 6.2831853;
    return sin(a) * 1.6 + cos(a) * 0.7;
}
`;
const rs = (blend, q = 1) => ({ blend, cull: 'off', zwrite: false, ztest: 'lequal', queue: 'transparent', queueOffset: q });
const P = {
  hdr: (name, label, color, intensity) => ({ name, type: 'hdrColor', label, default: { color, intensity } }),
  rng: (name, label, min, max, d) => ({ name, type: 'range', label, min, max, default: d }),
};

const shaders = {
  sarj_kilif: {
    description: 'Şarj kılıfı (additive, mesh silindir; U çevre, V kabza→uç): silüette parlayan akan lifli enerji. i.custom.x = dolum cephesi (V; >1 tam dolu), cephe dalgalı ve parlak; i.custom.y = ek beyaz parlama. Uçlar yumuşak söner.',
    properties: [P.hdr('_Core', 'Cephe / çekirdek', '#f4faff', 2.2), P.hdr('_ColA', 'Camgöbeği', '#6fd0ff', 1.4), P.hdr('_ColB', 'Mavi', '#2f6bff', 1.0), P.hdr('_ColC', 'Mor (dış silüet)', '#6a48ff', 0.8),
      P.rng('_Rim', 'Silüet keskinliği', 0.5, 6, 2.2), P.rng('_Flow', 'Lif akışı (uca doğru)', 0, 12, 5), P.rng('_Fiber', 'Lif sıklığı (çevre)', 1, 20, 6),
      P.rng('_Body', 'Gövde', 0, 2, 1), P.rng('_Front', 'Cephe parlaklığı', 0, 6, 1.5), P.rng('_FrontW', 'Cephe kalınlığı (V)', 0.01, 0.3, 0.05),
      P.rng('_Pulse', 'Nabız', 0, 1, 0), P.rng('_Gain', 'Genel parlaklık', 0, 4, 1)],
    renderState: rs('additive', 2),
    common: NOISE,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float t = i.time;
    float x = ringX(u);
    // enerji lifleri: çevre boyunca sık, bıçak boyunca uzun ve hızla uca akan, kıvrılarak (buz lekesi değil, akış)
    float warp = fbm(float2(v * 4.0 - t * _Flow * 0.45, x * 0.8 + 4.0)) * 3.6;
    float n = fbm(float2(x * _Fiber + warp, v * 3.6 - t * _Flow));
    float n2 = fbm(float2(x * _Fiber * 1.9 - warp * 0.7 + 9.0, v * 3.4 - t * _Flow * 1.6));
    float flick = 0.82 + 0.18 * vnoise(float2(t * 11.0, 3.0));
    // cephe: çevre boyunca dalgalı, dil dil (düz halka değil)
    float tong = fbm(float2(x * 2.2 + 2.0, t * 1.6));
    float front = i.custom.x + (tong - 0.5) * 0.22;
    float body = 1.0 - smoothstep(front - 0.07, front + 0.01, v);
    float fd = (v - front) / max(_FrontW, 0.001);
    float band = exp(-fd * fd) * step(i.custom.x, 1.02);
    float ndv = abs(dot(normalize(i.normalWS), normalize(i.viewDirWS)));
    // silüet yırtık: gürültüyle dil dil aşınır, düz tüp kenarı kalmaz
    float wisp = fbm(float2(x * 2.6 + 11.0, v * 4.0 - t * _Flow * 1.4));
    float sil = smoothstep(0.02, 0.45, ndv + (wisp - 0.5) * 1.0);
    float edge = saturate(1.0 - ndv);
    float rim = pow(edge, _Rim) * sil;
    float inner = pow(ndv, 2.0) * 0.22;
    float strand = smoothstep(0.42, 0.78, n);
    float strand2 = smoothstep(0.5, 0.82, n2);
    float ends = smoothstep(0.0, 0.1, v) * (1.0 - smoothstep(0.8, 1.0, v));
    float pulse = 1.0 + _Pulse * sin(t * 7.0 + v * 6.0) * 0.5;
    // renk: koyu mavi gövde → camgöbeği lifler → beyaz sıcak lif; dış silüete hafif mor
    float3 base = lerp(_ColB.rgb, _ColC.rgb, smoothstep(0.35, 0.95, edge));
    float3 col = base * (rim * 1.1 + inner) * 0.55;
    col += _ColA.rgb * strand * (rim * 1.2 + inner * 1.6) * 1.1;
    col += _Core.rgb * strand * strand2 * (0.25 + 0.75 * rim) * 0.7;
    col *= body * _Body * pulse * flick;
    col += lerp(_ColA.rgb, _Core.rgb, 0.6) * band * (0.35 + 0.8 * n) * (0.15 + 0.85 * rim) * _Front;
    col += _Core.rgb * i.custom.y * (0.3 + 0.7 * rim) * (0.4 + 0.6 * strand) * body;
    col *= ends * _Gain * i.color.rgb * i.color.a;
    return float4(col, 1.0);
}
`,
  },
  sarj_hale: {
    description: 'Şarj halesi (additive, mesh silindir): kılıfın çevresinde ortadan dışa yumuşakça sönen ışıma (silüette 0, sert kenar yok), dolum cephesine kadar (i.custom.x), yavaş kıvrılan gürültüyle nefes alır.',
    properties: [P.hdr('_Col', 'Renk', '#3d6dff', 0.8), P.hdr('_ColC', 'Mor', '#5a3cff', 0.6), P.rng('_Soft', 'Yumuşaklık', 1, 8, 3), P.rng('_Flow', 'Akış', 0, 8, 2.5), P.rng('_Pulse', 'Nabız', 0, 1, 0.2)],
    renderState: rs('additive', 1),
    common: NOISE,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float t = i.time;
    float x = ringX(u);
    float ndv = abs(dot(normalize(i.normalWS), normalize(i.viewDirWS)));
    float glow = pow(ndv, _Soft);
    float n = fbm(float2(x * 1.4 + 3.0, v * 3.0 - t * _Flow));
    float front = i.custom.x + (fbm(float2(x * 2.0, t * 1.4)) - 0.5) * 0.2;
    float body = 1.0 - smoothstep(front - 0.12, front + 0.02, v);
    float ends = smoothstep(0.0, 0.15, v) * (1.0 - smoothstep(0.7, 1.0, v));
    float pulse = 1.0 + _Pulse * sin(t * 6.0 + v * 4.0) * 0.5;
    float3 col = lerp(_ColC.rgb, _Col.rgb, n) * glow * (0.55 + 0.6 * n) * body * ends * pulse;
    return float4(col * i.color.rgb * i.color.a, 1.0);
}
`,
  },
  sarj_kilif_bukulme: {
    description: 'Şarj kılıfı bükülmesi (distortion, mesh silindir): sıcak hava gibi uca doğru akan titreşim; rg = yön, a = maske (silüette güçlü, dolum cephesine kadar, uçlarda söner).',
    properties: [P.rng('_Freq', 'Sıklık', 2, 30, 10), P.rng('_Flow', 'Akış', 0, 10, 3), P.rng('_Mask', 'Maske gücü', 0, 2, 1)],
    renderState: rs('alpha', 0),
    common: NOISE,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float t = i.time;
    float x = ringX(u);
    float a = fbm(float2(x * 1.2, v * _Freq - t * _Flow));
    float b = fbm(float2(x * 1.2 + 7.3, v * _Freq - t * _Flow + 3.1));
    float2 dir = float2(a, b) * 2.0 - 1.0;
    float body = 1.0 - smoothstep(i.custom.x - 0.06, i.custom.x + 0.01, v);
    float ndv = abs(dot(normalize(i.normalWS), normalize(i.viewDirWS)));
    float ends = smoothstep(0.0, 0.1, v) * (1.0 - smoothstep(0.8, 1.0, v));
    float m = (0.35 + 0.65 * (1.0 - ndv)) * body * ends * _Mask * i.color.a;
    return float4(dir, 0.0, saturate(m));
}
`,
  },
};

for (const [name, s] of Object.entries(shaders)) {
  const out = { name, description: s.description, properties: s.properties, renderState: s.renderState,
    lighting: { receiveShadows: false, castShadows: false }, outline: { enabled: false }, code: { common: s.common, vertex: '', fragment: s.fragment, outlineFragment: '' } };
  fs.writeFileSync(path.join(ROOT, 'shaders', name + '.json'), JSON.stringify(out, null, 1));
  console.log('yazıldı shaders/' + name + '.json');
}

const hdr = (color, intensity) => ({ color, intensity });
const materials = {
  // buz gibi okunmasın (2026-11-07, kullanıcı): açık camgöbeği leke yerine koyu mavi gövde + akan lifler + mor dış silüet
  agir_sarj_kilif: ['sarj_kilif', { _Core: hdr('#f2f7ff', 2.2), _ColA: hdr('#4fb4ff', 1.6), _ColB: hdr('#1f45ff', 1.1), _ColC: hdr('#6a48ff', 0.9), _Rim: 1.8, _Flow: 5, _Fiber: 6, _Body: 1, _Front: 0.6, _FrontW: 0.035, _Pulse: 0, _Gain: 1 }],
  agir_sarj_kilif_dolu: ['sarj_kilif', { _Core: hdr('#f4f8ff', 2.4), _ColA: hdr('#62c0ff', 2.0), _ColB: hdr('#2a52ff', 1.3), _ColC: hdr('#7350ff', 1.0), _Rim: 1.6, _Flow: 6.5, _Fiber: 7, _Body: 1.25, _Front: 0, _FrontW: 0.05, _Pulse: 0.35, _Gain: 1.15 }],
  agir_sarj_kilif_parlama: ['sarj_kilif', { _Core: hdr('#ffffff', 2.2), _ColA: hdr('#8fd4ff', 1.6), _ColB: hdr('#3a62ff', 1.2), _ColC: hdr('#7350ff', 0.8), _Rim: 1.4, _Flow: 6, _Fiber: 6, _Body: 0, _Front: 1.2, _FrontW: 0.06, _Pulse: 0, _Gain: 1 }],
  // kılıfın çevresinde yumuşak hale: kılıç kaplanmış değil, ışıyor görünsün
  agir_sarj_hale: ['sarj_hale', { _Col: hdr('#3a68ff', 0.75), _ColC: hdr('#5a3cff', 0.55), _Soft: 3, _Flow: 2.5, _Pulse: 0.2 }],
  agir_sarj_aura: ['duman_enerji_isik', { _Tint: hdr('#3554e0', 0.85), _EdgeCol: hdr('#8fb2ff', 0.9), _Density: 0.5, _Curl: 1.5, _Scale: 1.8 }],
  agir_sarj_bukulme: ['sarj_kilif_bukulme', { _Freq: 10, _Flow: 3, _Mask: 1 }],
};
for (const [name, [shader, values]] of Object.entries(materials)) {
  const out = { format: 'upe-material-1', name, shader: 'UnityPreview/' + shader, values, renderQueue: -1,
    preview: { target: 'sphere', background: '#1a1d24', bloom: 0.6, rotate: true, showGrid: false } };
  fs.writeFileSync(path.join(ROOT, 'materials', name + '.json'), JSON.stringify(out, null, 1));
  console.log('yazıldı materials/' + name + '.json');
}
