// Ağır saldırı (H*) VFX shader'ları: shaders/*.json üretir (UPE-SL). Hepsi özel; hazır doku ve düz çizgi yok (Docs/VFX_Kurallari.md).
//  kesik_agir        : mesh yay (U yay boyunca, V iç 0 → dış 1), additive. Dış kenarda beyaz çekirdek → camgöbeği → mavi → mor iç;
//                      akan lifler, açılma i.custom.x (baş), kuyruktan yenme + aşınma, sivri uç.
//  kesik_agir_golge  : aynı şekil, alfa; koyu lacivert gövde (parlaklığın arkasında kontrast).
//  kesik_agir_tel    : yay boyunca kıvrılan yumuşak enerji telleri (sinüs + gürültü, kırık/düz değil), titreşir.
//  halka_enerji      : quad (billboard/yatay) üzerinde genişleyen, kenarı gürültüyle kırılmış yumuşak enerji halkası + iç ışıma.
//  duman_enerji      : prosedürel kıvrımlı enerji dumanı (domain-warp fbm, tohum parçacık renginden, yaşla açılır/aşınır), alfa.
//  duman_enerji_isik : aynı duman, additive (parlak tutam).
// Çalıştır: node tools/gen-agir-shaders.mjs (sonra editörde load_shader ile yeniden yükle)
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
// yay izi: görünen bölüm [kuyruk, baş]; x = 0 kuyruk → 1 baş, y = maske, z = uç sivrilmesi (1 gövde → 0 uç)
const TRAIL = `
float3 trail(float u, float head, float life)
{
    float eat = saturate((life - _Eat) / max(1.0 - _Eat, 0.001));
    float tailS = max(head - _Tail, eat * 1.02);
    float len = max(head - tailS, 0.001);
    float k = (u - tailS) / len;
    float m = smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(head, head + 0.012, u)) * step(tailS, u);
    float tipT = 1.0 - smoothstep(0.8, 1.0, u / max(head, 0.001)) * step(0.995, head);
    float lead = 1.0 - smoothstep(head - 0.06, head, u) * (1.0 - step(0.995, head));
    return float3(k, m, tipT * lead);
}
`;
const rs = (blend, q = 1) => ({ blend, cull: 'off', zwrite: false, ztest: 'lequal', queue: 'transparent', queueOffset: q });
const P = {
  hdr: (name, label, color, intensity) => ({ name, type: 'hdrColor', label, default: { color, intensity } }),
  col: (name, label, d) => ({ name, type: 'color', label, default: d }),
  rng: (name, label, min, max, d) => ({ name, type: 'range', label, min, max, default: d }),
};
const trailProps = [P.rng('_Tail', 'İz uzunluğu (yay kesri)', 0.1, 1, 0.8), P.rng('_Eat', 'Kuyruktan yenme başı (ömür)', 0, 0.9, 0.2)];

const shaders = {
  kesik_agir: {
    description: 'Ağır kesik katmanı (additive, mesh yay): dış kenarda beyaz çekirdek → camgöbeği → mavi → mor iç; akan lifler; baştan açılır (i.custom.x), kuyruktan yenir ve aşınır, uç sivrilir.',
    properties: [P.hdr('_Core', 'Çekirdek (dış kenar)', '#f2f8ff', 2.4), P.hdr('_ColA', 'Camgöbeği', '#5cc6ff', 1.5), P.hdr('_ColB', 'Mavi', '#2552ff', 1.2),
      P.hdr('_ColC', 'Mor (iç)', '#6a2cff', 0.9), P.rng('_Width', 'Gövde kalınlığı (V)', 0.05, 0.9, 0.6), P.rng('_CoreW', 'Çekirdek kalınlığı (V)', 0.002, 0.1, 0.02),
      P.rng('_Fiber', 'Lif sıklığı', 4, 120, 40), P.rng('_Scroll', 'Lif akışı', 0, 12, 4), P.rng('_Gain', 'Genel parlaklık', 0, 4, 1), ...trailProps],
    renderState: rs('additive', 1),
    common: NOISE + TRAIL,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float3 tr = trail(u, i.custom.x, life);
    float k = saturate(tr.x);
    float flow = u * 7.0 - i.time * _Scroll;
    float f1 = fbm(float2(v * _Fiber, flow));
    float f2 = vnoise(float2(v * _Fiber * 2.6 + 4.0, flow * 2.3));
    float fib = saturate(f1 * 0.85 + f2 * 0.4);
    float clump = vnoise(float2(u * 9.0 - i.time * _Scroll * 0.4, 7.0));
    float w = _Width * (0.25 + 0.75 * k) * tr.z;
    float inner = 1.0 - w * (0.75 + (f1 - 0.5) * 0.8 + (clump - 0.5) * 0.4);
    float band = smoothstep(inner - 0.01, inner + 0.08, v) * (1.0 - smoothstep(0.975, 1.0, v));
    float d = saturate((v - inner) / max(1.0 - inner, 0.001));
    float3 col = lerp(_ColC.rgb, _ColB.rgb, smoothstep(0.0, 0.45, d));
    col = lerp(col, _ColA.rgb, smoothstep(0.45, 0.85, d));
    col *= 0.35 + 1.1 * fib;
    float cw = max(_CoreW * (0.3 + 0.7 * k) * (0.3 + 0.7 * tr.z), 0.001);
    float core = (1.0 - smoothstep(0.0, cw, abs(v - (0.985 - cw * 0.4)))) * smoothstep(0.0, 0.3, tr.z);
    float body = band * (0.3 + 0.7 * d) * (0.35 + 0.65 * fib) * 1.6;
    float er = fbm(float2(u * 8.0 - i.time * 1.2, v * 7.0));
    float erodeM = saturate((er + 0.55 - life * 1.15) * 5.0);
    float fadeAll = 1.0 - smoothstep(0.6, 1.0, life);
    float ramp = 0.25 + 0.75 * pow(k, 1.3);
    col = (col * body + _Core.rgb * core) * tr.y * ramp * erodeM * fadeAll * _Gain * i.color.rgb;
    return float4(col, 1.0);
}
`,
  },
  kesik_agir_golge: {
    description: 'Ağır kesiğin koyu gövdesi (alfa, mesh yay): parlak katmanların arkasında lacivert-siyah, lifli, kontrast verir. kesik_agir ile aynı iz/açılma.',
    properties: [P.col('_Dark', 'Koyu', '#03081c'), P.col('_Mid', 'Orta', '#0e2470'), P.rng('_Width', 'Kalınlık (V)', 0.05, 0.9, 0.7),
      P.rng('_Opacity', 'Opaklık', 0, 1, 0.7), P.rng('_Fiber', 'Lif sıklığı', 4, 80, 26), ...trailProps],
    renderState: rs('alpha', 0),
    common: NOISE + TRAIL,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float3 tr = trail(u, i.custom.x, life);
    float k = saturate(tr.x);
    float fib = fbm(float2(v * _Fiber, u * 5.0 - i.time * 2.0));
    float w = _Width * (0.3 + 0.7 * k) * tr.z;
    float inner = 1.0 - w * (0.8 + (fib - 0.5) * 0.7);
    float band = smoothstep(inner - 0.01, inner + 0.1, v) * (1.0 - smoothstep(0.96, 1.0, v));
    float d = saturate((v - inner) / max(1.0 - inner, 0.001));
    float er = fbm(float2(u * 7.0, v * 6.0 - i.time));
    float erodeM = saturate((er + 0.5 - life * 1.2) * 5.0);
    float3 col = lerp(_Dark.rgb, _Mid.rgb, d * (0.5 + 0.5 * fib));
    float a = band * tr.y * erodeM * (0.4 + 0.6 * fib) * _Opacity * (1.0 - smoothstep(0.55, 1.0, life));
    return float4(col, saturate(a));
}
`,
  },
  kesik_agir_tel: {
    description: 'Yay boyunca kıvrılan yumuşak enerji telleri (additive, mesh yay): sinüs + gürültüyle dalgalanan ince ışık telleri (kırık/düz değil), birkaç tane, zamanla akar ve titreşir. kesik_agir ile aynı iz.',
    properties: [P.hdr('_Color', 'Tel', '#bfe4ff', 2.2), P.hdr('_Halo', 'Tel ışıması', '#3d7bff', 0.9), P.rng('_Width', 'Bant (V)', 0.05, 0.9, 0.55),
      P.rng('_Thick', 'Tel kalınlığı (V)', 0.001, 0.03, 0.006), P.rng('_Wave', 'Dalga', 0, 1, 0.5), P.rng('_Speed', 'Akış', 0, 20, 6), ...trailProps],
    renderState: rs('additive', 2),
    common: NOISE + TRAIL,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float3 tr = trail(u, i.custom.x, life);
    float k = saturate(tr.x);
    float w = _Width * (0.3 + 0.7 * k) * tr.z;
    float lines = 0.0;
    float halo = 0.0;
    for (int n = 0; n < 3; n++)
    {
        float fn = float(n);
        float ph = u * (9.0 + fn * 4.0) - i.time * _Speed * (1.0 + fn * 0.3) + fn * 2.1;
        float wav = sin(ph) * 0.5 + (vnoise(float2(u * 12.0 - i.time * _Speed * 0.5, fn * 5.0)) - 0.5);
        float c = 1.0 - w * (0.3 + 0.22 * fn + _Wave * 0.18 * wav);
        float seg = smoothstep(0.25, 0.55, vnoise(float2(u * 5.0 - i.time * 3.0, fn * 9.0 + 3.0)));
        float dd = abs(v - c);
        lines += seg * (1.0 - smoothstep(0.0, _Thick, dd));
        halo += seg * exp(-dd / max(_Thick * 5.0, 0.0001)) * 0.4;
    }
    float m = tr.y * (0.3 + 0.7 * k) * (1.0 - smoothstep(0.5, 0.95, life)) * step(0.001, w);
    float3 col = (_Color.rgb * saturate(lines) + _Halo.rgb * halo) * m * i.color.rgb;
    return float4(col, 1.0);
}
`,
  },
  halka_enerji: {
    description: 'Genişleyen yumuşak enerji halkası (additive, quad): kenarı gürültüyle kırılmış parlak halka + içe doğru sönen ışıma; yaşla incelir ve aşınır (life = 1 - parçacık alfası). Boyut ömür boyu boyut eğrisiyle büyür.',
    properties: [P.hdr('_Ring', 'Halka', '#cfe6ff', 2), P.hdr('_Fill', 'İç ışıma', '#3f6dff', 0.6), P.rng('_Radius', 'Halka yarıçapı', 0.3, 0.95, 0.78),
      P.rng('_Thick', 'Halka kalınlığı', 0.01, 0.3, 0.08), P.rng('_Break', 'Kırıklık', 0, 1, 0.55)],
    renderState: rs('additive', 2),
    common: NOISE,
    fragment: `float4 frag(UPEInput i)
{
    float2 p = i.uv * 2.0 - 1.0;
    float r = length(p);
    float life = 1.0 - i.color.a;
    float ang = atan2(p.y, p.x);
    float2 q = float2(cos(ang), sin(ang)) * 2.2;
    float n = fbm(q * 1.5 + float2(life * 2.0, 3.0));
    float th = _Thick * (1.0 - life * 0.7) * (0.6 + 0.8 * n);
    float ring = exp(-pow((r - _Radius) / max(th, 0.002), 2.0));
    float n2 = vnoise(q * 4.0 + float2(life * 3.0, 9.0));
    float erode = smoothstep(life * 1.2 - 0.25, life * 1.2 + 0.05, n * 0.7 + n2 * 0.3);
    float brk = (1.0 - _Break + _Break * (n * 0.6 + n2 * 0.4)) * erode;
    float fill = smoothstep(_Radius, 0.0, r) * (1.0 - life) * 0.5;
    float edge = 1.0 - smoothstep(0.92, 1.0, r);
    float3 col = (_Ring.rgb * ring * brk + _Fill.rgb * fill) * edge * (1.0 - smoothstep(0.6, 1.0, life)) * i.color.rgb;
    return float4(col, 1.0);
}
`,
  },
};
const smoke = (blend) => ({
  description: `Prosedürel kıvrımlı enerji dumanı (${blend === 'alpha' ? 'alfa' : 'additive'}, quad): domain-warp fbm, her parçacıkta farklı (tohum parçacık renginden), yaşla açılır, kıvrılır, eşik yükselir (aşınır); kenarlar lifli ve parlak. Hazır duman dokusu yerine.`,
  properties: [P.hdr('_Tint', 'Renk', blend === 'alpha' ? '#1c2c60' : '#4a74ff', blend === 'alpha' ? 1 : 1.2), P.hdr('_EdgeCol', 'Kenar', blend === 'alpha' ? '#3a5ab0' : '#a8c8ff', 1),
    P.rng('_Density', 'Yoğunluk', 0, 2, blend === 'alpha' ? 0.8 : 0.6), P.rng('_Curl', 'Kıvrım', 0, 2, 1), P.rng('_Scale', 'Ölçek', 0.5, 4, 1.8)],
  renderState: rs(blend, blend === 'alpha' ? 0 : 2),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float2 p = i.uv * 2.0 - 1.0;
    float life = 1.0 - i.color.a;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 40.0;
    float2 s = p * _Scale * (0.8 + 0.5 * life);
    float2 wq = float2(fbm(s * 0.9 + float2(seed, life * 0.8)), fbm(s * 0.9 + float2(seed + 5.2, -life * 0.7))) - 0.5;
    float2 sp = s + wq * _Curl * (1.2 + life);
    float n = fbm(sp + float2(seed * 0.3, life * 1.1));
    float fib = fbm(float2(sp.x * 3.0, sp.y * 0.8) + seed);
    float fall = saturate(1.0 - length(p) * (0.9 + 0.2 * (n - 0.5)));
    float th = 0.32 + 0.45 * life;
    float a = smoothstep(th, th + 0.2, n * (0.6 + 0.6 * fall) + fall * 0.3) * smoothstep(0.0, 0.35, fall);
    float edge = smoothstep(th, th + 0.06, n) * (1.0 - smoothstep(th + 0.06, th + 0.25, n));
    float3 col = lerp(_Tint.rgb, _EdgeCol.rgb, saturate(edge * 1.5 + fib * 0.3));
    float alpha = saturate(a * _Density * (1.0 - smoothstep(0.65, 1.0, life)) * smoothstep(0.0, 0.08, life));
${blend === 'alpha' ? '    return float4(col * i.color.rgb, alpha);' : '    return float4(col * i.color.rgb * alpha, 1.0);'}
}
`,
});
shaders.duman_enerji = smoke('alpha');
shaders.duman_enerji_isik = smoke('additive');

for (const [name, s] of Object.entries(shaders)) {
  const out = { name, description: s.description, properties: s.properties, renderState: s.renderState,
    lighting: { receiveShadows: false, castShadows: false }, outline: { enabled: false }, code: { common: s.common, vertex: '', fragment: s.fragment, outlineFragment: '' } };
  fs.writeFileSync(path.join(ROOT, 'shaders', name + '.json'), JSON.stringify(out, null, 1));
  console.log('yazıldı shaders/' + name + '.json');
}
