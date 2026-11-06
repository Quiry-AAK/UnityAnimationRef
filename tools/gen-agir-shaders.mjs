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
// ───────────── Varyant shader'ları (H1: yarık / dalga / kütle)
const VORO = `
float2 hash22(float2 p)
{
    p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
    return frac(sin(p) * 43758.5453);
}

// hücre kenarına uzaklık (çatlak çizgileri için); girdi gürültüyle bükülürse çatlaklar kavisli olur
float voroEdge(float2 x)
{
    float2 n = floor(x);
    float2 f = frac(x);
    float md = 8.0;
    float2 mr = float2(0.0, 0.0);
    float2 mg = float2(0.0, 0.0);
    for (int j = -1; j <= 1; j++)
    {
        for (int i = -1; i <= 1; i++)
        {
            float2 g = float2(float(i), float(j));
            float2 r = g + hash22(n + g) - f;
            float d = dot(r, r);
            if (d < md) { md = d; mr = r; mg = g; }
        }
    }
    md = 8.0;
    for (int j2 = -2; j2 <= 2; j2++)
    {
        for (int i2 = -2; i2 <= 2; i2++)
        {
            float2 g2 = mg + float2(float(i2), float(j2));
            float2 r2 = g2 + hash22(n + g2) - f;
            float2 dr = r2 - mr;
            if (dot(dr, dr) > 0.00001) { md = min(md, dot(0.5 * (mr + r2), normalize(dr))); }
        }
    }
    return md;
}
`;
// yarık geometrisi: vc merkez çizgisi (V), hw yarı genişlik; açıklık i.custom.y (0 kapalı → 1 tam açık), iz kesik_agir ile aynı
const RIFT = `
float2 riftShape(float u, float v, float3 tr, float open, float t)
{
    float k = saturate(tr.x);
    float lens = (0.35 + 0.65 * exp(-pow((u - _Hit) / 0.18, 2.0))) * smoothstep(0.0, 0.15, k) * tr.z;
    float wob = (vnoise(float2(u * 30.0, t * 2.0)) - 0.5) * 0.5 + (vnoise(float2(u * 90.0, 3.0)) - 0.5) * 0.25;
    float hw = _Open * open * lens * (1.0 + wob);
    float dv = abs(v - _Center);
    return float2(dv, hw);
}
`;
const propsRift = [P.rng('_Center', 'Yarık merkezi (V)', 0.5, 1, 0.9), P.rng('_Open', 'Açıklık (V)', 0.005, 0.3, 0.12), P.rng('_Hit', 'En geniş yer (yay kesri)', 0, 1, 0.85)];
Object.assign(shaders, {
  yarik_ic: {
    description: 'Yarığın içi (alfa, mesh yay): iki kenar arasını dolduran yarı saydam açık mavi-beyaz sis, içinde yavaş akan açık akış (siyah/koyu boşluk değil: o Karanlık elementine ait). Açıklık i.custom.y, iz/açılma i.custom.x (kesik_agir ile aynı).',
    properties: [P.col('_Void', 'İç', '#a8c4ec'), P.hdr('_Swirl', 'İç akış', '#e2eeff', 1.2), P.rng('_Opacity', 'Opaklık', 0, 1, 0.45), ...propsRift, ...trailProps],
    renderState: rs('alpha', 1),
    common: NOISE + TRAIL + RIFT,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float3 tr = trail(u, i.custom.x, life);
    float2 rs2 = riftShape(u, v, tr, i.custom.y, i.time);
    float inside = 1.0 - smoothstep(rs2.y * 0.7, rs2.y, rs2.x);
    float sw = fbm(float2(u * 14.0 - i.time * 0.8, (v - _Center) / max(rs2.y, 0.002) * 1.5 + i.time * 0.5));
    float3 col = lerp(_Void.rgb, _Swirl.rgb, smoothstep(0.45, 0.85, sw) * 0.8);
    float a = inside * tr.y * step(0.0005, rs2.y);
    return float4(col, saturate(a * _Opacity));
}
`,
  },
  yarik_kenar: {
    description: 'Yarığın kenarı (additive, mesh yay): boşluğun iki kenarında beyaz-camgöbeği parlak dudak, kenardan dışa kavisli çatlaklar (bükülmüş hücre kenarları; düz çizgi değil) ve kenara yakın ışıma. Çatlaklar açıklıkla uzar, sonra söner.',
    properties: [P.hdr('_Lip', 'Kenar', '#eaf6ff', 2.6), P.hdr('_Crack', 'Çatlak', '#8fd0ff', 2), P.hdr('_Glow', 'Işıma', '#3c6cff', 0.9),
      P.rng('_Reach', 'Çatlak erimi (V)', 0.01, 0.4, 0.16), P.rng('_CellsU', 'Çatlak sıklığı (yay)', 4, 120, 46), P.rng('_CellsV', 'Çatlak sıklığı (V)', 2, 40, 10), ...propsRift, ...trailProps],
    renderState: rs('additive', 2),
    common: NOISE + VORO + TRAIL + RIFT,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float open = i.custom.y;
    float3 tr = trail(u, i.custom.x, life);
    float2 rs2 = riftShape(u, v, tr, open, i.time);
    float outside = rs2.x - rs2.y;
    float lip = exp(-max(outside, 0.0) / 0.006) * step(-0.002, outside) * step(0.0005, rs2.y);
    float2 q = float2(u * _CellsU, v * _CellsV);
    q += (float2(fbm(q * 0.35 + 2.0), fbm(q * 0.35 + 7.0)) - 0.5) * 1.6;
    float e = voroEdge(q);
    float reach = _Reach * open * (0.4 + 0.6 * saturate(tr.x));
    float near = 1.0 - smoothstep(0.0, max(reach, 0.001), outside);
    float crack = (1.0 - smoothstep(0.0, 0.06, e)) * near * step(0.0, outside) * step(0.0005, rs2.y);
    float glow = exp(-max(outside, 0.0) / max(reach * 0.5, 0.004)) * 0.45 * step(0.0005, rs2.y) * step(0.0, outside);
    float fade = 1.0 - smoothstep(0.55, 0.95, life);
    float3 col = (_Lip.rgb * lip + _Crack.rgb * crack + _Glow.rgb * glow) * tr.y * fade * i.color.rgb;
    return float4(col, 1.0);
}
`,
  },
  kirik_parca: {
    description: 'Yarıktan kopan kırık parçası (alfa, quad): 3 rastgele kesme düzleminin kesişimi olan köşeli camsı kıymık (kenarlar çok hafif kavisli, her parçacıkta farklı), yüzeyleri farklı parlaklıkta (faset), ince parlak camgöbeği kenar; yaşla söner.',
    properties: [P.col('_Fill', 'İç', '#060c22'), P.hdr('_Facet', 'Faset ışığı', '#5f86d0', 1.0), P.hdr('_Rim', 'Kenar', '#cfeaff', 3.0), P.rng('_Stretch', 'Uzunluk', 1, 4, 2.2)],
    renderState: rs('alpha', 3),
    common: NOISE,
    fragment: `float4 frag(UPEInput i)
{
    float2 p = i.uv * 2.0 - 1.0;
    float life = 1.0 - i.color.a;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 50.0;
    p.x *= _Stretch * (0.8 + 0.4 * hash21(float2(seed, 1.0)));
    float edge = 10.0;
    float facet = 0.0;
    for (int k = 0; k < 3; k++)
    {
        float fk = float(k);
        float th = (fk + hash21(float2(fk, seed)) * 0.6) * 2.0944;
        float2 n = float2(cos(th), sin(th));
        float2 t = float2(-n.y, n.x);
        float d = 0.35 + 0.45 * hash21(float2(fk + 7.0, seed)) + 0.04 * sin(dot(p, t) * 4.0 + seed);
        float e = d - dot(p, n);
        if (e < edge) { edge = e; facet = hash21(float2(fk * 3.1, seed + 2.0)); }
    }
    float inside = smoothstep(0.0, 0.025, edge);
    float rim = exp(-edge / 0.03) * inside;
    float3 col = _Fill.rgb + _Facet.rgb * (0.25 + 0.75 * facet) * saturate(edge * 2.5) + _Rim.rgb * rim * (1.0 - life * 0.7);
    float a = inside * i.color.a;
    return float4(col * i.color.rgb, saturate(a));
}
`,
  },
  dalga_kenar: {
    description: 'Basınç dalgası (additive, mesh yay): ileri uçan şeffaf hilal hava bıçağı; öndeki dış kenar parlak ve ince, içe doğru sönen yumuşak gövde, gövdede kavisli hava lifleri; uçlar sivri, yaşla incelir ve söner (life = 1 - alfa).',
    properties: [P.hdr('_Edge', 'Ön kenar', '#d8ecff', 1.6), P.hdr('_Body', 'Gövde', '#5f8fe8', 0.6), P.rng('_Width', 'Gövde (V)', 0.05, 0.8, 0.35), P.rng('_Fiber', 'Lif', 4, 80, 30)],
    renderState: rs('additive', 2),
    common: NOISE,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float ends = pow(saturate(sin(3.14159 * u)), 0.8);
    float w = _Width * ends * (1.0 - life * 0.5);
    float inner = 1.0 - w;
    float body = smoothstep(inner - 0.02, inner + 0.15, v) * (1.0 - smoothstep(0.97, 1.0, v));
    float d = saturate((v - inner) / max(w, 0.001));
    float edge = exp(-abs(v - 0.975) / 0.012) * ends;
    float fib = 0.5 + 0.5 * fbm(float2(v * _Fiber, u * 6.0 - i.time * 3.0));
    float er = fbm(float2(u * 10.0, v * 8.0 + life * 2.0));
    float erode = saturate((er + 0.6 - life * 1.1) * 4.0);
    float fade = (1.0 - smoothstep(0.5, 1.0, life)) * smoothstep(0.0, 0.08, life);
    float3 col = (_Body.rgb * body * pow(d, 1.5) * fib + _Edge.rgb * edge) * erode * fade * i.color.rgb;
    return float4(col, 1.0);
}
`,
  },
  dalga_bukulme: {
    description: 'Basınç dalgasının bükülmesi (renderer.blend distortion, mesh yay): rg = kayan gürültü yönü, a = dalga gövdesi maskesi (dalga_kenar ile aynı şekil); güçlü, kısa.',
    properties: [P.rng('_Width', 'Gövde (V)', 0.05, 0.8, 0.4), P.rng('_Freq', 'Gürültü sıklığı', 1, 40, 8)],
    renderState: rs('alpha', 0),
    common: NOISE,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float ends = pow(saturate(sin(3.14159 * u)), 0.8);
    float w = _Width * ends;
    float band = smoothstep(1.0 - w, 1.0 - w * 0.5, v) * (1.0 - smoothstep(0.92, 1.0, v));
    float2 p = float2(u * _Freq, v * _Freq * 0.5 - i.time * 2.0);
    float2 dir = float2(vnoise(p) - 0.5, vnoise(p + float2(13.1, 4.7)) - 0.5) * 2.0;
    return float4(dir, 0.0, saturate(band * (1.0 - life)));
}
`,
  },
  kutle: {
    description: 'Ağır kütle gövdesi (alfa, mesh yay): kalın, yoğun, akan enerji sisi (domain-warp fbm), lacivert-siyah içinde açık mavi girdaplar; bıçakla açılır, kalınlığı uca doğru artar, sonra dağılarak (aşınarak) söner.',
    properties: [P.col('_Dark', 'Koyu', '#040a22'), P.col('_Light', 'Girdap', '#2f56b8'), P.rng('_Width', 'Kalınlık (V)', 0.1, 1, 0.8), P.rng('_Density', 'Yoğunluk', 0, 1.5, 0.95), ...trailProps],
    renderState: rs('alpha', 1),
    common: NOISE + TRAIL,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float3 tr = trail(u, i.custom.x, life);
    float k = saturate(tr.x);
    float2 s = float2(u * 10.0 - i.time * 1.5, v * 3.5);
    float2 wq = float2(fbm(s * 0.8 + float2(1.0, i.time * 0.4)), fbm(s * 0.8 + float2(6.0, -i.time * 0.3))) - 0.5;
    float n = fbm(s + wq * 2.0);
    float w = _Width * (0.35 + 0.65 * k) * tr.z;
    float inner = 1.0 - w * (0.8 + (n - 0.5) * 0.8);
    float band = smoothstep(inner - 0.03, inner + 0.12, v) * (1.0 - smoothstep(0.95, 1.0, v));
    float er = saturate((n + 0.65 - life * 1.25) * 4.0);
    float d = saturate((v - inner) / max(1.0 - inner, 0.001));
    float3 col = lerp(_Dark.rgb, _Light.rgb, smoothstep(0.35, 0.8, n) * (0.5 + 0.5 * d));
    float a = band * tr.y * er * _Density * (0.6 + 0.4 * n);
    return float4(col, saturate(a));
}
`,
  },
  kutle_kenar: {
    description: 'Kütlenin kor gibi kenarı (additive, mesh yay): dış kenarda kalın, titreşen sıcak-beyaz/camgöbeği kor bandı, kenar boyunca kıpırdayan ışık düğümleri; kütle ile aynı iz.',
    properties: [P.hdr('_Hot', 'Kor', '#e6f4ff', 2.6), P.hdr('_Warm', 'Kor çevresi', '#4a8cff', 1.4), P.rng('_EdgeW', 'Kenar kalınlığı (V)', 0.005, 0.15, 0.05), ...trailProps],
    renderState: rs('additive', 2),
    common: NOISE + TRAIL,
    fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float3 tr = trail(u, i.custom.x, life);
    float k = saturate(tr.x);
    float fl = vnoise(float2(u * 40.0 - i.time * 8.0, i.time * 6.0));
    float knots = smoothstep(0.6, 0.95, vnoise(float2(u * 18.0 - i.time * 5.0, 2.0)));
    float ew = _EdgeW * (0.4 + 0.6 * k) * (0.3 + 0.7 * tr.z) * (0.8 + 0.4 * fl);
    float dv = 0.97 - v;
    float hot = exp(-abs(dv) / max(ew * 0.25, 0.001));
    float warm = exp(-max(dv, 0.0) / max(ew * 1.6, 0.001)) * step(-0.03, dv);
    float fade = 1.0 - smoothstep(0.5, 0.95, life);
    float3 col = (_Hot.rgb * hot * (0.7 + 0.6 * knots) + _Warm.rgb * warm * 0.6) * tr.y * (0.3 + 0.7 * pow(k, 1.2)) * fade * i.color.rgb;
    return float4(col, 1.0);
}
`,
  },
});

shaders.ruzgar_hilal = {
  description: 'Rüzgâr hilali (additive, mesh yay; dış kenar V=1 gidiş yönündeki bombeli ön): sıkışmış havadan hilal. Önde keskin, ince, parlak hava cephesi (uçlara doğru incelir), arkasında içe doğru sönen yumuşak pus; pusun içinde yay boyunca akan düşük kontrastlı, uzamış rüzgâr dokusu (çizgili/barkod değil); arka (iç) kenar gürültüyle tutam tutam dağılır; uçlar kıvrılan tutamlarla biter. Hafif saldırı kesiğinin dolu mavi gövdesi değil: beyaz → soluk camgöbeği → açık çelik mavisi, çok şeffaf. life = 1 - alfa.',
  properties: [P.hdr('_Front', 'Ön cephe', '#f2f8ff', 2.4), P.hdr('_Body', 'Pus', '#bcdcff', 0.9), P.hdr('_Deep', 'İç pus', '#7aa4e8', 0.35),
    P.rng('_Width', 'Gövde (V)', 0.1, 0.9, 0.55), P.rng('_EdgeW', 'Cephe kalınlığı (V)', 0.003, 0.08, 0.018), P.rng('_Speed', 'Akış', 0, 20, 6)],
  renderState: rs('additive', 2),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float ends = pow(saturate(sin(3.14159 * u)), 0.65);
    // akış dokusu: yay boyunca uzamış (u yavaş, v hızlı değişen) fbm, zamanla uca doğru akar
    float2 fq = float2(u * 4.0 - i.time * _Speed * 0.35, v * 18.0);
    float flow = fbm(fq + float2(0.0, fbm(fq * 0.5) * 1.5));
    float w = _Width * ends * (1.0 - life * 0.3);
    // arka (iç) kenar: tutam tutam dağılan sınır
    float wisp = fbm(float2(u * 14.0 - i.time * 2.0, life * 2.0)) - 0.5;
    float inner = 1.0 - w * (0.85 + wisp * 0.6);
    float body = smoothstep(inner - 0.06, inner + 0.2, v) * (1.0 - smoothstep(0.975, 1.0, v));
    float d = saturate((v - inner) / max(1.0 - inner, 0.001));
    float frontW = _EdgeW * (0.35 + 0.65 * ends);
    float front = exp(-pow((v - (0.985 - frontW)) / max(frontW, 0.001), 2.0)) * smoothstep(0.02, 0.2, ends);
    float glow = exp(-max(0.99 - v, 0.0) / 0.06) * ends * 0.35;
    float3 col = lerp(_Deep.rgb, _Body.rgb, pow(d, 1.4)) * body * (0.55 + 0.6 * flow) * pow(d, 0.8);
    col += _Front.rgb * (front + glow);
    float er = fbm(float2(u * 7.0 + life * 2.5, v * 5.0));
    float erode = saturate((er + 0.7 - life * 1.15) * 3.5);
    float fade = (1.0 - smoothstep(0.6, 1.0, life)) * smoothstep(0.0, 0.05, life);
    return float4(col * erode * fade * i.color.rgb, 1.0);
}
`,
};

shaders.hilal_enerji = {
  description: 'Dolu enerji hilali (additive, mesh yay; dış kenar V=1 gidiş yönündeki bombeli ön): kalın, içi dolu, parlak hilal. Kalınlık ortada en fazla, uçlarda sivri. Bant içinde öne yakın beyaz-sıcak çekirdek, dışa ve içe doğru camgöbeği → açık mavi; ön kenar keskin parlak dudak; içeride yavaşça dönen enerji akışı (parlaklığı hafifçe dalgalandırır); arka (iç) kenar yumuşak ışıma ile söner. Hafif saldırı kesiğinin ince kenar + lifli yassı gövdesi değil. life = 1 - alfa.',
  properties: [P.hdr('_Core', 'Çekirdek', '#f6fbff', 3.0), P.hdr('_Mid', 'Orta', '#9ad8ff', 2.0), P.hdr('_Outer', 'Dış', '#4a90ff', 1.3),
    P.rng('_Width', 'Kalınlık (V)', 0.1, 1, 0.75), P.rng('_CorePos', 'Çekirdek konumu (0 iç-1 ön)', 0, 1, 0.68), P.rng('_Flow', 'Akış', 0, 10, 3)],
  renderState: rs('additive', 2),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float ends = pow(saturate(sin(3.14159 * u)), 0.9);
    float w = _Width * ends;
    float inner = 1.0 - w;
    float d = saturate((v - inner) / max(w, 0.001));               // 0 iç → 1 ön
    float band = smoothstep(inner - 0.05, inner + 0.12, v) * (1.0 - smoothstep(0.982, 1.0, v));
    float core = exp(-pow((d - _CorePos) / 0.2, 2.0)) * smoothstep(0.05, 0.35, ends);
    float lip = exp(-pow((v - 0.975) / 0.012, 2.0)) * ends;
    float n = fbm(float2(u * 5.0 - i.time * _Flow, d * 3.0 + i.time * 0.7));
    float pulse = 0.8 + 0.4 * n;
    float3 col = lerp(_Outer.rgb, _Mid.rgb, smoothstep(0.0, 0.55, d));
    col = lerp(col, _Core.rgb, core);
    float body = band * (0.35 + 0.65 * smoothstep(0.0, 0.5, d)) * pulse;
    float glowIn = smoothstep(inner - 0.25, inner, v) * (1.0 - band) * ends * 0.25;   // iç kenardan geriye yumuşak ışıma
    float er = fbm(float2(u * 6.0 + life * 2.0, v * 5.0));
    float erode = saturate((er + 0.75 - life * 1.2) * 3.5);
    float fade = (1.0 - smoothstep(0.6, 1.0, life)) * smoothstep(0.0, 0.05, life);
    float3 outc = (col * body + _Core.rgb * lip * 0.8 + _Mid.rgb * glowIn) * erode * fade * i.color.rgb;
    return float4(outc, 1.0);
}
`,
};

shaders.hilal_hacim = {
  description: 'Hacimli enerji hilali (additive, renderer.mesh shape "hilal": U yay boyunca uç→uç, V enine iç 0 → ön 1). Işıkla değil çizimle okunur: önde keskin (bulanık değil) ince beyaz kenar ve hemen arkasında ince ikinci bir pah çizgisi; gövde yarı saydam mavi, içinde yay boyunca akan ince parlak lifler (sırtlı gürültü, kıvrık); iç kenar keskin sınırlı biçimde liflere ayrılıp çözülür, çözülme sınırında ince ışıltı; uçlar sivri, kenar uca doğru incelir. Yalnız kameraya dönük yüz çizilir (cull back), tek katman. life = 1 - alfa.',
  properties: [P.hdr('_Front', 'Ön kenar', '#f4faff', 1.4), P.hdr('_Body', 'Lifler', '#7cc0ff', 0.9), P.hdr('_Inner', 'Gövde', '#2a5cc8', 0.6),
    P.hdr('_Rim', 'Hacim halesi', '#cfe8ff', 0.55), P.rng('_RimPow', 'Hale keskinliği', 0.5, 8, 3.0), P.rng('_Flow', 'Akış', 0, 10, 3), P.rng('_Edge', 'Ön kenar kalınlığı', 0.005, 0.2, 0.035)],
  renderState: { ...rs('additive', 2), cull: 'back' },
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float c = i.uv.y;
    float life = 1.0 - i.color.a;
    float t = i.time;
    float3 N = normalize(i.normalWS);
    float3 Vd = normalize(i.viewDirWS);
    float facing = abs(dot(N, Vd));
    float sU = sin(3.14159 * u);
    // kıvrık enine koordinat: lifler düz çizgi olmasın
    float warp = fbm(float2(u * 2.5 - t * _Flow * 0.25, c * 1.5)) - 0.5;
    float cc = c + warp * 0.14;
    // sırtlı gürültü: ince, keskin, yay boyunca akan lifler
    float f1 = vnoise(float2(u * 3.0 - t * _Flow * 0.6, cc * 14.0));
    float f2 = vnoise(float2(u * 6.0 - t * _Flow, cc * 28.0 + 5.3));
    float fil = pow(1.0 - abs(2.0 * f1 - 1.0), 7.0) * 0.8 + pow(1.0 - abs(2.0 * f2 - 1.0), 12.0) * 0.5;
    // ön kenar: keskin ana hat + ince pah çizgisi + dar hale
    float d = 1.0 - c;
    float ew = _Edge * (0.7 + 0.6 * vnoise(float2(u * 10.0 - t * _Flow * 1.2, 7.0))) * (0.35 + 0.65 * sU);
    float edge = 1.0 - smoothstep(ew * 0.55, ew, d);
    float bevel = exp(-pow((d - ew * 2.4) / max(ew * 0.35, 0.001), 2.0)) * 0.55;
    float halo = exp(-d / max(ew * 3.0, 0.001)) * 0.3;
    // iç kenardan çözülme: keskin sınır + sınırda ince ışıltı
    float dn = fbm(float2(u * 5.0 - t * 0.8, c * 3.0));
    float thr = c * 1.2 + 0.12 + (dn - 0.5) * 0.5 - smoothstep(0.3, 1.0, life) * 0.9 - (1.0 - sU) * 0.25;
    float alive = smoothstep(0.2, 0.25, thr);
    float cut = smoothstep(0.14, 0.2, thr) * (1.0 - smoothstep(0.24, 0.32, thr));
    float3 col = _Inner.rgb * (0.3 + 0.2 * facing) * smoothstep(0.1, 0.8, c) * alive;
    col += _Body.rgb * fil * alive * smoothstep(0.15, 0.75, c);
    float graze = smoothstep(0.03, 0.45, facing);              // kenardan (arkadan) bakışta yüzey yığılıp beyaza patlamasın
    col += _Rim.rgb * pow(1.0 - facing, _RimPow) * alive * graze;
    col += _Body.rgb * cut * 0.45;
    float tipE = smoothstep(0.0, 0.04, u) * smoothstep(1.0, 0.96, u);
    float sil = 1.0 - 0.85 * smoothstep(0.15, 0.8, facing);   // ön kenar ancak siluette ince hat; önden bakınca geniş alana yayılmasın
    col += (_Front.rgb * (edge + bevel) + _Body.rgb * halo) * tipE * sil;
    float fade = (1.0 - smoothstep(0.55, 1.0, life)) * smoothstep(0.0, 0.04, life);
    return float4(col * fade * i.color.rgb, 1.0);
}
`,
};

shaders.yer_cizik = {
  description: 'Zemindeki çizik (additive, yatay quad): hilalin yere değdiği yerde kalan parlak oluk; uzunlamasına (V boyunca) uzanan, kenarları gürültüyle düzensiz, ortası beyaz-camgöbeği sıcak, dışa doğru soğuk mavi; uçları yumuşak (art arda dizilen quad\'lar kesintisiz iz oluşturur); yaşla soğur ve incelir (life = 1 - alfa). Siyah/yanık değil.',
  properties: [P.hdr('_Hot', 'Sıcak çekirdek', '#eef6ff', 2.4), P.hdr('_Cool', 'Soğuk kenar', '#4a7ce8', 1.0), P.rng('_Width', 'Genişlik (U)', 0.02, 0.5, 0.16), P.rng('_Rough', 'Kenar düzensizliği', 0, 1, 0.5)],
  renderState: rs('additive', 1),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float2 uv = i.uv;
    float life = 1.0 - i.color.a;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 30.0;
    float along = uv.y;
    float ends = smoothstep(0.0, 0.18, along) * smoothstep(1.0, 0.82, along);
    float wob = (fbm(float2(along * 6.0 + seed, 1.0)) - 0.5) * 0.12 * _Rough;
    float x = abs(uv.x - 0.5 - wob);
    float w = _Width * (0.6 + 0.6 * fbm(float2(along * 9.0 + seed, 4.0))) * (1.0 - life * 0.55);
    float core = exp(-pow(x / max(w * 0.25, 0.001), 2.0));
    float body = exp(-pow(x / max(w, 0.001), 2.0));
    float grit = smoothstep(0.55, 0.85, vnoise(float2(uv.x * 40.0 + seed, along * 25.0))) * body;
    float heat = 1.0 - smoothstep(0.0, 0.6, life);
    float brk = smoothstep(0.25, 0.6, fbm(float2(along * 5.0 + seed, 9.0)));
    float3 col = (_Hot.rgb * core * (0.4 + 0.6 * heat) * brk + _Cool.rgb * body * (0.35 + 0.4 * brk) + _Cool.rgb * grit * 0.9) * ends * (1.0 - smoothstep(0.55, 1.0, life)) * i.color.rgb;
    return float4(col, 1.0);
}
`,
};

shaders.duman_enerji = smoke('alpha');
shaders.duman_enerji_isik = smoke('additive');

shaders.gecikme_kesik = {
  description: 'H3 gecikmeli kesik (additive, mesh yay bandı: U yol boyunca, V enine 0→1). Bandın ortasında ince, keskin, hafif dalgalı bir kesik hattı; i.custom.x = açılma (u < x görünür, bıçağın arkasından), i.custom.y = patlama parlaması (0 sakin, 1 tepe), i.custom.z = genişleme (hat patlamada kalınlaşır, kenarlarından lifler taşar). Sakin hâlde kıl inceliğinde ve ılımlı; patlamada çekirdek beyazlaşır. Uçlar sivri. Siyah yok. life = 1 - alfa.',
  properties: [P.hdr('_Core', 'Çekirdek', '#f4faff', 1.6), P.hdr('_Glow', 'Hale', '#6fb0ff', 0.8), P.rng('_Width', 'Hat kalınlığı (V)', 0.005, 0.3, 0.035),
    P.rng('_Open', 'Patlamada kalınlaşma', 0, 8, 1.6), P.rng('_Flash', 'Patlama parlaması', 0, 6, 0.9), P.rng('_Wave', 'Dalgalanma', 0, 1, 0.35), P.rng('_TailFade', 'Yol boyunca sönme (0 yok → 1 sonda biter)', 0, 1, 0)],
  renderState: rs('additive', 3),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float reveal = i.custom.x;
    float flash = i.custom.y;
    float widen = i.custom.z;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 20.0;
    float vis = 1.0 - smoothstep(reveal - 0.02, reveal + 0.005, u);
    float cN = 0.5 + (fbm(float2(u * 5.0 + seed, 3.0)) - 0.5) * 0.18 * _Wave;
    float sU = sin(3.14159 * saturate(u));
    float w = _Width * (0.2 + 0.8 * pow(sU, 0.7)) * (1.0 + widen * 0.25);   // çekirdek patlamada da ince kalır
    float d = abs(v - cN) / max(w, 0.0005);
    float core = 1.0 - smoothstep(0.35, 1.0, d);
    float dg = abs(v - cN) / max(_Width * (0.2 + 0.8 * pow(sU, 0.7)), 0.0005);   // hale genişlemeden bağımsız: patlamada bulut olmasın
    float glow = exp(-dg * dg * 0.12);
    // patlamada kenardan taşan lifler (enine değil, yol boyunca uzanan)
    float fib = fbm(float2(u * 3.0 - i.time * 1.5 + seed, v * 26.0));
    float fibers = smoothstep(0.55, 0.85, fib) * exp(-dg / max(1.0 + widen * _Open * 4.0, 1.0)) * widen;   // lifler hattın iki yanına taşar
    float3 col = _Core.rgb * core * (0.55 + flash * _Flash) + _Glow.rgb * glow * (0.25 + 0.35 * flash) + _Glow.rgb * fibers * 0.6;
    float fade = (1.0 - smoothstep(0.7, 1.0, life)) * (1.0 - _TailFade * smoothstep(0.0, 0.7, u));   // başta dolu, yol sonuna doğru saydamlaşır
    return float4(col * vis * fade * i.color.rgb, 1.0);
}
`,
};

shaders.delis_ok = {
  description: 'H3 delme ok ucu (additive, renderer.mesh shape "ok": U arka 0 → uç 1, V enine 0.5 eksen). Ok biçimini shader keser. Gürültü saçı değil, tasarlanmış katmanlar: (1) hafif dolu hacim (zarf içinde yumuşak doluluk), (2) uca yakınsayan 7 ayrı keskin alev-bıçak (her biri farklı başlangıç, kalınlık, yan; ortası sıcak çizgi, kenarı keskin, uca doğru incelir, hafif kıvrılır), (3) zarfın keskin dış hattı, (4) eksende omurga ve uçta parıltı, (5) uca doğru akan hafif nabız. Arka uç bıçaklara ayrılarak biter. i.custom.x = uzanma (u < x görünür), i.custom.y = arkadan öne çözülme. Renk derin mavi → mavi → beyaz-camgöbeği; siyah yok. life = 1 - alfa.',
  properties: [P.hdr('_Core', 'Omurga / uç', '#eef8ff', 1.0), P.hdr('_Mid', 'Bıçaklar', '#5aa6ff', 0.9), P.hdr('_Edge', 'Hacim / kenar', '#2160e0', 0.6),
    P.rng('_Flow', 'Akış (uca doğru)', 0, 10, 4), P.rng('_Fill', 'Hacim doluluğu', 0, 1, 0.22), P.rng('_Sharp', 'Sivrilik', 0.3, 3, 0.9), P.rng('_Seed', 'Desen tohumu', 0, 50, 3)],
  renderState: rs('additive', 3),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float sa = (i.uv.y - 0.5) * 2.0;
    float life = 1.0 - i.color.a;
    float t = i.time;
    float h = pow(saturate(1.0 - u), _Sharp) * (0.3 + 0.7 * smoothstep(0.0, 0.45, u));
    float s = sa / max(h, 0.002);                       // -1..1 zarf içinde; çizgiler uçta birleşir
    float sab = abs(s);
    float pulse = 0.75 + 0.25 * fbm(float2(u * 3.0 - t * _Flow, 1.7 + _Seed));
    // (1) hacim
    float fill = pow(saturate(1.0 - sab * sab), 1.5) * smoothstep(0.05, 0.55, u) * _Fill;
    // (2) ayrı alev-bıçaklar
    float blades = 0.0;
    float hot = 0.0;
    for (int k = 0; k < 7; k++)
    {
        float fk = float(k);
        float r1 = hash21(float2(fk, _Seed));
        float r2 = hash21(float2(fk + 11.0, _Seed));
        float r3 = hash21(float2(fk + 23.0, _Seed));
        float side = (fmod(fk, 2.0) < 0.5) ? 1.0 : -1.0;
        float sk = side * (0.12 + 0.8 * r1);
        float u0 = 0.02 + 0.5 * r2;
        float along = saturate((u - u0) / (1.0 - u0));
        sk += (vnoise(float2(u * 2.5 - t * _Flow * 0.3, fk * 3.1)) - 0.5) * 0.12 * (1.0 - along);
        float wk = (0.05 + 0.08 * r3) * pow(1.0 - along, 0.35);
        float dk = abs(s - sk);
        float onk = smoothstep(u0, u0 + 0.12, u);
        blades += (1.0 - smoothstep(wk * 0.55, wk, dk)) * onk * (0.45 + 0.55 * along);
        hot += exp(-pow(dk / max(wk * 0.22, 0.002), 2.0)) * onk * along;
    }
    // (3) dış hat, (4) omurga + uç
    float rim = exp(-pow((sab - 0.96) / 0.035, 2.0)) * smoothstep(0.2, 0.7, u);
    float spine = exp(-s * s * 140.0) * smoothstep(0.3, 0.85, u);
    float tipG = smoothstep(0.88, 1.0, u) * exp(-s * s * 12.0);
    float inside = 1.0 - smoothstep(0.98, 1.06, sab);
    float3 col = _Edge.rgb * fill + _Mid.rgb * blades * 0.55 * pulse + _Core.rgb * hot * 0.5 + _Mid.rgb * rim * 0.6;
    col *= inside;
    col += _Core.rgb * (spine * 0.6 + tipG * 0.8);
    float grow = 1.0 - smoothstep(i.custom.x - 0.03, i.custom.x, u);
    float n2 = vnoise(float2(u * 8.0, s * 3.0 + _Seed));
    float dis = smoothstep(i.custom.y * 1.3 - 0.15, i.custom.y * 1.3, u + (n2 - 0.5) * 0.3);
    float fade = 1.0 - smoothstep(0.85, 1.0, life);
    return float4(col * grow * dis * fade * i.color.rgb, 1.0);
}
`,
};

shaders.delme_koni = {
  description: 'H3 delme konisi (additive, renderer.mesh shape "cylinder" koni: U çevre 0..1, V arka 0 → uç 1; mesh dönüşüyle ekseni +Z). Hacimli 3B ok: siluet fresnel ile keskin okunur (kenara dönen yüzey parlak, kameraya dönük iç yarı saydam); yüzeyde sarmal (helis) rüzgâr şeritleri arkaya doğru akar ve döner (düz değil, gürültüyle kıvrık, keskin sınırlı); uca doğru yoğunlaşır, uçta sıcak beyaz; arka uç şeritlere ayrılıp söner. i.custom.y = arkadan öne çözülme. Siyah yok. life = 1 - alfa.',
  properties: [P.hdr('_Core', 'Uç / çekirdek', '#eef8ff', 1.2), P.hdr('_Mid', 'Şeritler', '#5aa8ff', 0.9), P.hdr('_Edge', 'Siluet', '#3478f0', 0.8),
    P.rng('_Count', 'Şerit sayısı (çevre)', 1, 24, 7), P.rng('_Twist', 'Sarmal', -6, 6, 1.6), P.rng('_Spin', 'Dönüş hızı', -10, 10, 2.5), P.rng('_Flow', 'Arkaya akış', 0, 20, 6),
    P.rng('_Thr', 'Şerit eşiği (ince ↔ dolu)', 0.2, 0.9, 0.55), P.rng('_FresPow', 'Siluet keskinliği', 0.5, 8, 2.5), P.rng('_Fill', 'İç doluluk', 0, 1, 0.12)],
  renderState: rs('additive', 3),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float t = i.time;
    float3 N = normalize(i.normalWS);
    float3 Vd = normalize(i.viewDirWS);
    float facing = abs(dot(N, Vd));
    float fres = pow(1.0 - facing, _FresPow);
    // sarmal koordinat (çevre periyodik: u * sayı tam sayı turu)
    float a = u * _Count + v * _Twist - t * _Spin;
    float n = fbm(float2(a, v * 2.5 + t * _Flow));
    float n2 = fbm(float2(a * 2.0 + 7.3, v * 6.0 + t * _Flow * 1.6));
    float band = n * 0.7 + n2 * 0.4;
    float detail = 0.5 + 0.5 * smoothstep(0.32, 0.72, fbm(float2(a * 7.0 + 3.1, v * 20.0 + t * _Flow * 2.2)));   // şerit içinde ince akış lifleri (düz bant olmasın)
    float vol = 0.45 + 0.55 * pow(1.0 - facing, 0.6);                                         // kenara dönen yüzey yoğun: hacim okunur
    float streak = smoothstep(_Thr, _Thr + 0.12, band) * detail * vol;
    float hotLine = smoothstep(_Thr + 0.2, _Thr + 0.3, band);
    float tipW = smoothstep(0.0, 1.0, v);
    float back = smoothstep(0.0, 0.4, v + (n - 0.5) * 0.5);
    float3 col = _Edge.rgb * fres * (0.35 + 0.65 * tipW) * (0.45 + 0.55 * smoothstep(0.3, 0.7, n2)) * detail;   // siluet de liflere bölünür, düz plastik yüzey olmasın
    col += _Mid.rgb * streak * (0.25 + 0.75 * tipW) + _Core.rgb * hotLine * tipW * 0.6;
    col += _Mid.rgb * _Fill * tipW;
    col += _Core.rgb * pow(v, 16.0) * 0.35;
    float dis = smoothstep(i.custom.y * 1.3 - 0.15, i.custom.y * 1.3, v + (n2 - 0.5) * 0.3);
    float fade = (1.0 - smoothstep(0.8, 1.0, life)) * smoothstep(0.0, 0.06, life);
    return float4(col * back * dis * fade * i.color.rgb, 1.0);
}
`,
};

shaders.sok_halka = {
  description: 'H3 ses duvarı halkası (additive, mesh arc 360°: U çevre, V iç 0 → dış 1). İnce, keskin bir ışık halkası; çevresi gürültüyle kırık (düz daire değil), içe doğru yumuşak hale; yaşla incelir, parçalanır ve söner. life = 1 - alfa.',
  properties: [P.hdr('_Core', 'Halka', '#eef8ff', 1.4), P.hdr('_Glow', 'Hale', '#5aa8ff', 0.7), P.rng('_Width', 'Kalınlık (V)', 0.02, 0.5, 0.12)],
  renderState: rs('additive', 4),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 20.0;
    float wob = (fbm(float2(u * 9.0 + seed, life * 2.0)) - 0.5) * 0.25;
    float w = _Width * (1.0 - life * 0.6);
    float d = abs(v - 0.65 - wob) / max(w, 0.001);
    float core = 1.0 - smoothstep(0.3, 1.0, d);
    float glow = exp(-d * d * 0.15) * smoothstep(0.0, 0.65, v);
    float brk = smoothstep(0.1 + life * 0.55, 0.4 + life * 0.55, fbm(float2(u * 16.0 + seed, 3.0 + life * 1.5)));
    float3 col = (_Core.rgb * core + _Glow.rgb * glow * 0.5) * brk;
    float fade = 1.0 - smoothstep(0.4, 1.0, life);
    return float4(col * fade * i.color.rgb, 1.0);
}
`,
};

shaders.delme_cizgi = {
  description: 'H3 delme çizgisi (additive, renderer.mesh shape "kivrim": U 0 çıkış → 1 son, V enine 0.5 orta). Profesyonel enerji çizgisi: çıkışta kalın, sona doğru kıl inceliğinde incelir; keskin sıcak çekirdek + renkli yumuşak hale; boyunca renk geçişi (beyaz → camgöbeği → derin mavi, siyah yok); içinde geriye akan ışık nabızları; çizilirken önde parlayan baş (i.custom.x = çizilme, u < x görünür); son kısımda enerji parçalarına bölünür ve _TailFade ile söner. life = 1 - alfa.',
  properties: [P.hdr('_Core', 'Çekirdek', '#f4faff', 1.5), P.hdr('_Mid', 'Hale (orta)', '#68b4ff', 0.8), P.hdr('_Deep', 'Hale (son)', '#2a5cd8', 0.6),
    P.rng('_Width', 'Kalınlık (V)', 0.01, 0.4, 0.09), P.rng('_Speed', 'Nabız hızı', 0, 20, 7), P.rng('_Wave', 'Kıvrılma', 0, 1, 0.5), P.rng('_TailFade', 'Sona doğru sönme', 0, 1, 1), P.rng('_Break', 'Sonda kopukluk', 0, 1, 0.6)],
  renderState: rs('additive', 3),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float t = i.time;
    float reveal = i.custom.x;
    float seed = frac(dot(i.color.rgb, float3(17.31, 31.7, 7.13)) * 3.7) * 20.0;
    float taper = pow(saturate(1.0 - u), 0.65) * smoothstep(0.0, 0.035, u);
    float w = _Width * max(taper, 0.02);
    float cN = 0.5 + (fbm(float2(u * 4.0 + seed, 2.0)) - 0.5) * 0.18 * _Wave;
    float d = abs(v - cN) / w;
    float core = exp(-d * d * 7.0);
    float glow = exp(-d * d * 0.45);
    float3 hue = lerp(_Mid.rgb, _Deep.rgb, smoothstep(0.25, 0.95, u));
    float pulse = 0.6 + 0.4 * smoothstep(0.45, 0.85, fbm(float2(u * 6.0 - t * _Speed + seed, 1.3)));
    float brk = lerp(1.0, smoothstep(0.3, 0.55, vnoise(float2(u * 28.0 + seed, 0.7))), _Break * smoothstep(0.35, 0.85, u));
    float head = exp(-pow((u - reveal) / 0.035, 2.0)) * step(reveal, 0.995);
    float vis = 1.0 - smoothstep(reveal - 0.005, reveal + 0.005, u);
    float3 col = (_Core.rgb * core * (1.0 - 0.5 * smoothstep(0.3, 1.0, u)) + hue * glow * 0.55) * pulse * brk;
    col += _Core.rgb * head * core * 1.6;
    float fade = (1.0 - smoothstep(0.7, 1.0, life)) * (1.0 - _TailFade * smoothstep(0.0, 0.85, u));
    return float4(col * vis * fade * i.color.rgb, 1.0);
}
`,
};

shaders.donus_iz = {
  description: 'H4 dönüş izi (additive, mesh yay: U yay boyunca 0 → 1 baş, V iç 0 → dış 1 = uç yolu). Kılıcın arkasında kalan rüzgâr-enerji izi: dış kenarda (uç yolu) ince keskin beyaz-camgöbeği hat, içe doğru yay boyunca akan kıvrık lifler ve sönen mavi pus; baş i.custom.x ile bıçağı izler, arkasında _Tail uzunluğunda kuyruk incelir ve söner (baştan kuyruğa sönme). Hafif saldırı kesiğinin dolu gövdesi değil; siyah yok. life = 1 - alfa.',
  properties: [P.hdr('_Edge', 'Kenar', '#f2f9ff', 1.4), P.hdr('_Body', 'Lifler', '#5aa6ff', 0.8), P.hdr('_Haze', 'Pus', '#2f66dc', 0.35),
    P.rng('_EdgeW', 'Kenar kalınlığı (V)', 0.01, 0.3, 0.06), P.rng('_Tail', 'Kuyruk uzunluğu (U)', 0.05, 1, 0.55), P.rng('_Fib', 'Lif sıklığı', 2, 40, 16)],
  renderState: rs('additive', 3),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float u = i.uv.x;
    float v = i.uv.y;
    float life = 1.0 - i.color.a;
    float t = i.time;
    float head = i.custom.x;
    float behind = head - u;
    float vis = smoothstep(-0.01, 0.01, behind);
    float tail = 1.0 - smoothstep(0.0, _Tail, behind);
    float tailW = 0.35 + 0.65 * tail;                                   // kuyruk inceliyor
    float e = (1.0 - v) / max(_EdgeW * tailW, 0.002);
    float edge = exp(-e * e);
    float n = fbm(float2(u * 3.0 - t * 1.5, v * _Fib));
    float n2 = fbm(float2(u * 7.0 - t * 2.5 + 3.0, v * _Fib * 1.8));
    float fib = smoothstep(0.45, 0.8, n * 0.7 + n2 * 0.4) * smoothstep(1.0 - 0.75 * tailW, 1.0, v);
    float haze = smoothstep(0.35, 1.0, v) * (0.5 + 0.5 * n);
    float3 col = _Edge.rgb * edge + _Body.rgb * fib * 0.7 + _Haze.rgb * haze * 0.4;
    float fade = 1.0 - smoothstep(0.6, 1.0, life);
    return float4(col * vis * tail * fade * i.color.rgb, 1.0);
}
`,
};

shaders.zemin_catlak = {
  description: 'H4 zemin çatlakları (additive, yere yatırılmış plane mesh: UV 0..1, merkez 0.5 = darbe noktası). Kutupsal uzatılmış Voronoi kenarlarından merkezden dışa ışınsal, kırık kırık (düz değil) ışıyan çatlaklar; i.custom.x = yayılma yarıçapı (0 → 1 kenar), merkezde sıcak beyaz havuz, uca doğru camgöbeği → mavi; yaşla soğur, incelir ve söner. Yanık/siyah değil. life = 1 - alfa.',
  properties: [P.hdr('_Hot', 'Sıcak', '#f4faff', 1.6), P.hdr('_Cool', 'Soğuk', '#3f86f0', 0.9), P.rng('_Rays', 'Işın sıklığı', 3, 30, 11), P.rng('_Width', 'Çatlak kalınlığı', 0.005, 0.2, 0.05), P.rng('_Pool', 'Merkez havuz', 0, 1, 0.5)],
  renderState: rs('additive', 2),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float2 q = (i.uv - 0.5) * 2.0;
    float r = length(q);
    float ang = atan2(q.y, q.x) / 6.28318 + 0.5;
    float life = 1.0 - i.color.a;
    float grow = i.custom.x;
    float2 p = float2(ang * _Rays, r * 3.2 - r * r * 0.8);
    p += (float2(fbm(q * 3.0), fbm(q * 3.0 + 5.0)) - 0.5) * 0.35;
    // Voronoi F2 - F1 (açısal eksende periyodik değil; kesik dikiş görünmesin diye ağırlık düşük)
    float2 c = floor(p);
    float2 f = frac(p);
    float f1 = 8.0;
    float f2 = 8.0;
    for (int y = -1; y <= 1; y++)
    {
        for (int x = -1; x <= 1; x++)
        {
            float2 g = float2(float(x), float(y));
            float2 o = float2(hash21(c + g), hash21(c + g + 17.0));
            float d = length(g + o - f);
            if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
        }
    }
    float edgeD = f2 - f1;
    float w = _Width * (1.2 - 0.8 * r) * (1.0 - life * 0.6);
    float crack = 1.0 - smoothstep(w * 0.4, w, edgeD);
    float reach = 1.0 - smoothstep(grow - 0.08, grow, r);
    float heat = 1.0 - smoothstep(0.0, 0.7, life);
    float3 colr = lerp(_Hot.rgb, _Cool.rgb, smoothstep(0.05, 0.8, r + life * 0.4));
    float pool = exp(-r * r * 30.0) * _Pool * (0.4 + 0.6 * heat);
    float edgeFade = 1.0 - smoothstep(0.75, 1.0, r);
    float3 col = colr * crack * (0.35 + 0.65 * heat) + _Hot.rgb * pool;
    float fade = 1.0 - smoothstep(0.65, 1.0, life);
    return float4(col * reach * edgeFade * fade * i.color.rgb, 1.0);
}
`,
};

shaders.iz_serit = {
  description: 'Kılıç izi şeridi (additive, bladeTrail; emitter.follow ile kılıca bağlı): uv.x = iz yaşı (0 baş/kılıç → 1 kuyruk), uv.y = 0 kök → 1 uç. Kılıcın gerçek yolunu birebir izler. Uç kenarında ince keskin beyaz-camgöbeği hat, köke doğru yaş boyunca akan kıvrık lifler ve sönen mavi pus; kuyruk incelip söner, kuyruk ucu liflere ayrılır. Siyah yok. Renk/alfa parçacık renginden (colorOverLifetime yaşa göre).',
  properties: [P.hdr('_Edge', 'Uç hattı', '#f2f9ff', 1.5), P.hdr('_Body', 'Lifler', '#5aa6ff', 1.1), P.hdr('_Haze', 'Pus', '#3570e0', 0.55),
    P.rng('_EdgeW', 'Uç hattı kalınlığı', 0.01, 0.4, 0.09), P.rng('_Fib', 'Lif sıklığı', 2, 40, 14), P.rng('_Reach', 'Köke doğru yayılma', 0.1, 1, 0.65)],
  renderState: rs('additive', 3),
  common: NOISE,
  fragment: `float4 frag(UPEInput i)
{
    float age = saturate(i.uv.x);
    float v = i.uv.y;
    float t = i.time;
    float keep = 1.0 - age;
    float e = (1.0 - v) / max(_EdgeW * (0.35 + 0.65 * keep), 0.002);
    float edge = exp(-e * e);
    float n = fbm(float2(age * 4.0 + t * 1.5, v * _Fib));
    float n2 = fbm(float2(age * 9.0 + t * 2.5 + 3.0, v * _Fib * 1.8));
    float reach = 1.0 - _Reach * keep;                                    // genç izde lifler köke kadar iner, yaşlandıkça uca çekilir
    float fib = smoothstep(0.45, 0.8, n * 0.7 + n2 * 0.4) * smoothstep(reach - 0.15, reach + 0.25, v);
    float haze = smoothstep(reach - 0.2, 1.0, v) * (0.5 + 0.5 * n);
    float shred = lerp(1.0, smoothstep(0.35, 0.65, n2), smoothstep(0.55, 1.0, age));
    float3 col = _Edge.rgb * edge + _Body.rgb * fib * 0.75 + _Haze.rgb * haze * 0.45;
    float fade = 1.0 - smoothstep(0.55, 1.0, age);
    return float4(col * shred * fade * i.color.rgb * i.color.a, 1.0);
}
`,
};

for (const [name, s] of Object.entries(shaders)) {
  const out = { name, description: s.description, properties: s.properties, renderState: s.renderState,
    lighting: { receiveShadows: false, castShadows: false }, outline: { enabled: false }, code: { common: s.common, vertex: '', fragment: s.fragment, outlineFragment: '' } };
  fs.writeFileSync(path.join(ROOT, 'shaders', name + '.json'), JSON.stringify(out, null, 1));
  console.log('yazıldı shaders/' + name + '.json');
}
