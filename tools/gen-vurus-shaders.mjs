// İsabet (vuruş) VFX shader'ları + materyalleri. Hazır doku/düz çizgi/yıldız yok (Docs/VFX_Kurallari.md).
//  vurus_cakma : organik isabet patlaması (additive, billboard quad): yumuşak çekirdek + açıya göre gürültüyle şekillenen,
//                kavisle kıvrılan dil dil ışık (yıldız kolu/düz ışın değil); her parçacıkta farklı (tohum renkten), yaşla
//                dışa açılır, incelir ve söner (life = 1 - alfa).
// Çalıştır: node tools/gen-vurus-shaders.mjs (sonra editörde load_shader / load_material)
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
`;
const P = {
  hdr: (name, label, color, intensity) => ({ name, type: 'hdrColor', label, default: { color, intensity } }),
  rng: (name, label, min, max, d) => ({ name, type: 'range', label, min, max, default: d }),
};

const shaders = {
  vurus_cakma: {
    description: 'İsabet patlaması (additive, billboard): yumuşak çekirdek + açıya göre gürültüyle şekillenen, kavisle kıvrılan dil dil ışık (yıldız kolu/düz ışın yok). Tohum parçacık renginden; yaşla açılır, incelir, söner (life = 1 - alfa).',
    properties: [P.hdr('_Core', 'Çekirdek', '#ffffff', 2.4), P.hdr('_Glow', 'Dil rengi', '#5aa8ff', 1.4), P.hdr('_Edge', 'Dış hale', '#2f55ff', 0.6),
      P.rng('_Lobes', 'Dil sıklığı', 1, 8, 3), P.rng('_Reach', 'Dil uzunluğu', 0.2, 1, 0.75), P.rng('_Curl', 'Kıvrım', 0, 3, 1.2),
      P.rng('_CoreSize', 'Çekirdek darlığı', 5, 80, 28), P.rng('_Thin', 'Yaşla incelme', 0, 1, 0.6)],
    renderState: { blend: 'additive', cull: 'off', zwrite: false, ztest: 'lequal', queue: 'transparent', queueOffset: 4 },
    fragment: `float4 frag(UPEInput i)
{
    float2 p = i.uv * 2.0 - 1.0;
    float life = 1.0 - i.color.a;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7);
    float r = length(p);
    // alan bükülmesi: dil dil kıvrılan, bulut gibi düzensiz enerji (açıya bağlı ışın/yıldız kolu yok)
    float2 s = float2(seed * 7.0, seed * 11.0);
    float2 w = float2(fbm(p * 2.2 + s), fbm(p * 2.2 + s + 5.2)) - 0.5;
    float2 pw = p + w * _Curl * 0.7;
    float rr = length(pw);
    float n = fbm(pw * _Lobes + s * 1.7 + life * 1.5);
    float n2 = vnoise(pw * _Lobes * 2.6 + 9.0);
    float reach = _Reach * (0.4 + 0.6 * smoothstep(0.0, 0.3, life));
    float th = 0.12 + life * 0.28 * (1.0 + _Thin) + (rr / max(reach, 0.05)) * 0.32;
    float inside = smoothstep(th, th + 0.1, n) * (1.0 - smoothstep(reach * 0.65, reach, rr));
    // kenarı parlak, içi sönük dil (enerji; mat duman değil)
    float rimT = (smoothstep(th - 0.01, th + 0.04, n) - smoothstep(th + 0.06, th + 0.16, n)) * (1.0 - smoothstep(reach * 0.7, reach, rr));
    float tongue = inside * (0.25 + 0.3 * n2) + rimT * 1.6;
    float core = exp(-r * r * _CoreSize * (1.0 + life * 3.0)) * 0.55;
    float halo = exp(-r * 3.4) * 0.3;
    float edgeFade = 1.0 - smoothstep(0.8, 1.0, r);
    float3 col = _Core.rgb * core + lerp(_Glow.rgb, _Core.rgb, smoothstep(reach * 0.55, 0.0, rr) * 0.65) * tongue + _Edge.rgb * halo * (1.0 - life);
    float fade = 1.0 - smoothstep(0.45, 1.0, life);
    return float4(col * edgeFade * fade * i.color.rgb * (0.4 + 0.6 * i.color.a), 1.0);
}
`,
  },
  halka_kirik: {
    description: 'Kırık şok halkası (additive, billboard): ince parlak halka, kalınlığı açı boyunca gürültüyle değişir, yaşla parçalara ayrılır ve söner; içe doğru hafif ışıma. Düz daire değil. Tohum parçacık renginden (life = 1 - alfa).',
    properties: [P.hdr('_Ring', 'Halka', '#f2f8ff', 2.0), P.hdr('_Glow', 'İç ışıma', '#4a8cff', 0.5), P.rng('_Radius', 'Yarıçap', 0.3, 0.95, 0.72),
      P.rng('_Thick', 'Kalınlık', 0.005, 0.2, 0.035), P.rng('_Break', 'Kırıklık', 0, 1, 0.6)],
    renderState: { blend: 'additive', cull: 'off', zwrite: false, ztest: 'lequal', queue: 'transparent', queueOffset: 3 },
    fragment: `float4 frag(UPEInput i)
{
    float2 p = i.uv * 2.0 - 1.0;
    float life = 1.0 - i.color.a;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 20.0;
    float r = length(p);
    float a = atan2(p.y, p.x);
    float2 q = float2(cos(a), sin(a));
    float wob = (fbm(q * 2.0 + seed + life) - 0.5) * 0.08;
    float w = _Thick * (1.0 - life * 0.7) * (0.4 + 1.2 * fbm(q * 3.0 + seed * 1.3));
    float d = (r - _Radius - wob) / max(w, 0.001);
    float ring = exp(-d * d);
    float brk = smoothstep(_Break * 0.35 + life * 0.6, _Break * 0.35 + life * 0.6 + 0.2, fbm(q * 4.5 + seed * 2.1 + 7.0));
    float inner = smoothstep(_Radius, 0.0, r) * smoothstep(0.0, _Radius, r) * 0.6;
    float fade = 1.0 - smoothstep(0.5, 1.0, life);
    float3 col = (_Ring.rgb * ring * brk + _Glow.rgb * inner * (1.0 - life)) * fade;
    return float4(col * i.color.rgb, 1.0);
}
`,
  },
  sis_yumusak: {
    description: 'Yumuşak hava/sis tutamı (alfa, billboard): eşiksiz, kıvrımlı yoğunluk (domain-warp fbm) × yumuşak yuvarlak düşüş; pul pul parçalanmaz, kenarı hep yumuşak. Tohum parçacık renginden; yaşla açılır ve incelir. Renk/alfa parçacıktan.',
    properties: [P.hdr('_Tint', 'Renk', '#9aaccc', 1), P.rng('_Density', 'Yoğunluk', 0, 2, 0.8), P.rng('_Curl', 'Kıvrım', 0, 2, 1), P.rng('_Scale', 'Ölçek', 0.5, 4, 1.6)],
    renderState: { blend: 'alpha', cull: 'off', zwrite: false, ztest: 'lequal', queue: 'transparent', queueOffset: 0 },
    fragment: `float4 frag(UPEInput i)
{
    float2 p = i.uv * 2.0 - 1.0;
    float life = 1.0 - i.color.a;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 20.0;
    float2 w = float2(fbm(p * _Scale + seed), fbm(p * _Scale + seed + 4.3)) - 0.5;
    float2 q = p + w * _Curl * (0.6 + life * 0.6);
    float n = fbm(q * _Scale * 1.3 + seed * 0.7 + life * 0.8);
    float fall = saturate(1.0 - length(q) * 1.15);
    fall = fall * fall * (3.0 - 2.0 * fall);
    float a = saturate(fall * (0.35 + n * 0.9) * _Density) * (1.0 - life * 0.35);
    float3 col = _Tint.rgb * (0.85 + 0.3 * n);
    return float4(col, a * i.color.a);
}
`,
  },
  halka_bukulme: {
    description: 'Halka şok bükülmesi (distortion, billboard): genişleyen halka bandında sahneyi merkezden dışa iter (rg = radyal yön, a = halka maskesi, kenarı gürültüyle kırık); yaşla incelir ve söner (parry: zaman sarsıntısı).',
    properties: [P.rng('_Radius', 'Yarıçap', 0.3, 0.95, 0.7), P.rng('_Thick', 'Kalınlık', 0.02, 0.4, 0.14)],
    renderState: { blend: 'alpha', cull: 'off', zwrite: false, ztest: 'lequal', queue: 'transparent', queueOffset: 0 },
    fragment: `float4 frag(UPEInput i)
{
    float2 p = i.uv * 2.0 - 1.0;
    float life = 1.0 - i.color.a;
    float r = length(p);
    float2 dir = p / max(r, 0.001);
    float a = atan2(p.y, p.x);
    float n = fbm(float2(cos(a), sin(a)) * 3.0 + life * 2.0);
    float w = _Thick * (1.0 - life * 0.6) * (0.6 + 0.8 * n);
    float d = (r - _Radius) / max(w, 0.001);
    float m = exp(-d * d) * (1.0 - smoothstep(0.4, 1.0, life));
    return float4(dir, 0.0, saturate(m));
}
`,
  },
};

for (const [name, s] of Object.entries(shaders)) {
  const out = { name, description: s.description, properties: s.properties, renderState: s.renderState,
    lighting: { receiveShadows: false, castShadows: false }, outline: { enabled: false }, code: { common: NOISE, vertex: '', fragment: s.fragment, outlineFragment: '' } };
  fs.writeFileSync(path.join(ROOT, 'shaders', name + '.json'), JSON.stringify(out, null, 1));
  console.log('yazıldı shaders/' + name + '.json');
}

const hdr = (color, intensity) => ({ color, intensity });
const materials = {
  // hafif: sade, küçük, soğuk mavi-beyaz
  vurus_hafif_cakma: ['vurus_cakma', { _Core: hdr('#f4f9ff', 2.0), _Glow: hdr('#7cc2ff', 1.4), _Edge: hdr('#2f55ff', 0.4), _Lobes: 4.2, _Reach: 0.62, _Curl: 0.6, _CoreSize: 30, _Thin: 0.6 }],
  // ağır: şaşalı, katmanlı (beyaz → camgöbeği → mavi → mor)
  vurus_agir_cakma: ['vurus_cakma', { _Core: hdr('#ffffff', 1.7), _Glow: hdr('#6cc0ff', 1.5), _Edge: hdr('#5a3cff', 0.8), _Lobes: 4.5, _Reach: 0.8, _Curl: 0.9, _CoreSize: 22, _Thin: 0.55 }],
  vurus_agir_halka: ['sok_halka', { _Core: hdr('#eef8ff', 1.1), _Glow: hdr('#5aa8ff', 0.5), _Width: 0.1 }],
  vurus_agir_duman: ['duman_enerji_isik', { _Tint: hdr('#3554e0', 0.8), _EdgeCol: hdr('#9ab8ff', 0.9), _Density: 0.5, _Curl: 1.6, _Scale: 1.8 }],
  vurus_agir_bukulme: ['dalga_bukulme', { _Width: 0.5, _Freq: 8 }],
  // kahramana isabet: tehlike rengi (turuncu-kırmızı, Elarion renk dili)
  vurus_kahraman_cakma: ['vurus_cakma', { _Core: hdr('#fff1e2', 2.0), _Glow: hdr('#ff7a3e', 1.9), _Edge: hdr('#c4201a', 0.6), _Lobes: 4.2, _Reach: 0.7, _Curl: 0.7, _CoreSize: 26, _Thin: 0.6 }],
  // savunma: blok gümüş-beyaz (metal), parry parlak beyaz-camgöbeği (ödül anı), dodge soluk gri-mavi hava
  blok_cakma: ['vurus_cakma', { _Core: hdr('#ffffff', 1.8), _Glow: hdr('#c8dcf4', 1.2), _Edge: hdr('#5a78b0', 0.3), _Lobes: 5, _Reach: 0.55, _Curl: 0.5, _CoreSize: 40, _Thin: 0.7 }],
  // blok = çelik çeliğe: enerji yok, sıcak-beyaz metal kıvılcım (mavi değil)
  zerre_metal: ['zerre_yumusak', { _Core: hdr('#fff8ee', 2.4), _Halo: hdr('#e2c8a4', 0.5), _CoreSize: 46, _HaloSize: 7, _Wobble: 0.15, _Twinkle: 0.6 }],
  blok_toz: ['sis_yumusak', { _Tint: hdr('#9a968e', 1), _Density: 0.8, _Curl: 0.9, _Scale: 1.7 }],
  parry_cakma: ['vurus_cakma', { _Core: hdr('#ffffff', 2.2), _Glow: hdr('#6fe2ff', 2.0), _Edge: hdr('#3a62ff', 0.5), _Lobes: 4.5, _Reach: 0.7, _Curl: 0.7, _CoreSize: 30, _Thin: 0.6 }],
  parry_halka: ['halka_kirik', { _Ring: hdr('#f0fdff', 2.4), _Glow: hdr('#3fb4ff', 0.6), _Radius: 0.72, _Thick: 0.03, _Break: 0.5 }],
  parry_bukulme: ['halka_bukulme', { _Radius: 0.7, _Thick: 0.16 }],
  zerre_parry: ['zerre_yumusak', { _Core: hdr('#f2fdff', 2.2), _Halo: hdr('#4cc8ff', 0.9), _CoreSize: 30, _HaloSize: 4.5, _Wobble: 0.3, _Twinkle: 0.3 }],
  dodge_sis: ['sis_yumusak', { _Tint: hdr('#a4b4d4', 1), _Density: 0.9, _Curl: 1.1, _Scale: 1.5 }],
  dodge_toz: ['sis_yumusak', { _Tint: hdr('#8c867c', 1), _Density: 1.0, _Curl: 1.0, _Scale: 1.8 }],
  zerre_tehlike: ['zerre_yumusak', { _Core: hdr('#fff0e0', 2.0), _Halo: hdr('#ff6a3a', 0.8), _CoreSize: 26, _HaloSize: 5, _Wobble: 0.3, _Twinkle: 0.35 }],
};
for (const [name, [shader, values]] of Object.entries(materials)) {
  const out = { format: 'upe-material-1', name, shader: 'UnityPreview/' + shader, values, renderQueue: -1,
    preview: { target: 'sphere', background: '#1a1d24', bloom: 0.6, rotate: true, showGrid: false } };
  fs.writeFileSync(path.join(ROOT, 'materials', name + '.json'), JSON.stringify(out, null, 1));
  console.log('yazıldı materials/' + name + '.json');
}
