// Hazır shader'lar (UPE-SL). builtin: mevcut Unity shader'larının önizleme portu — materyal Unity'de o shader'ı kullanır,
// .shader dosyası yazılmaz; özellik adları Unity'dekiyle birebir. TEMPLATES: yeni özel shader başlangıçları (UnityPreview/<ad>).

const urpSurfaceProps = [
  { name: '_Surface', type: 'float', label: 'Yüzey (0 opak, 1 saydam)', default: 0 },
  { name: '_Blend', type: 'float', label: 'Karışım (0 alfa, 1 premultiply, 2 additive, 3 multiply)', default: 0 },
  { name: '_Cull', type: 'float', label: 'Cull (0 kapalı, 1 ön, 2 arka)', default: 2 },
  { name: '_AlphaClip', type: 'toggle', label: 'Alfa kesme', default: false },
  { name: '_Cutoff', type: 'range', label: 'Kesme eşiği', min: 0, max: 1, default: 0.5 },
];
// URP yüzey modu: saydamda premultiply/multiply renk düzeltmesi (URP _ALPHAPREMULTIPLY_ON / _ALPHAMODULATE_ON gibi)
const urpSurfaceCommon = `
float4 UPE_URPSurface(float4 c)
{
    if (_AlphaClip > 0.5) clip(c.a - _Cutoff);
    if (_Surface < 0.5) { c.a = 1.0; return c; }
    if (abs(_Blend - 1.0) < 0.5) c.rgb *= c.a;
    if (abs(_Blend - 3.0) < 0.5) c.rgb = lerp(splat3(1.0), c.rgb, c.a);
    return c;
}
`;

export const BUILTIN_SHADERS = [
  {
    name: 'elarion_toon', builtin: true, unityName: 'Elarion/ToonCharacter',
    description: 'Oyunun kahraman shader\'ı (Assets/Shaders/ElarionToon.shader) — 3 bant toon, kameraya göre mavi dolgu, turuncu rim, inverted-hull outline, Bayer solma. Birebir port.',
    properties: [
      { name: '_BaseMap', type: 'texture', label: 'Base Map', default: 'white' },
      { name: '_BaseColor', type: 'color', label: 'Base Color', default: '#ffffff' },
      { name: '_ShadowTint', type: 'color', label: 'Shadow Tint', default: '#6b739e' },
      { name: '_LightThreshold', type: 'range', label: 'Light Threshold', min: -1, max: 1, default: 0.35 },
      { name: '_MidThreshold', type: 'range', label: 'Mid Threshold', min: -1, max: 1, default: -0.1 },
      { name: '_FillColor', type: 'color', label: 'Fill Color', default: '#7399f2' },
      { name: '_FillStrength', type: 'range', label: 'Fill Strength', min: 0, max: 2, default: 1.1 },
      { name: '_RimColor', type: 'color', label: 'Rim Color', default: '#ff6b14' },
      { name: '_RimPower', type: 'range', label: 'Rim Power', min: 0.5, max: 8, default: 2.2 },
      { name: '_RimThreshold', type: 'range', label: 'Rim Threshold', min: 0, max: 1, default: 0.35 },
      { name: '_RimStrength', type: 'range', label: 'Rim Strength', min: 0, max: 1, default: 1 },
      { name: '_OutlineColor', type: 'color', label: 'Outline Color', default: '#08050a' },
      { name: '_OutlineWidth', type: 'range', label: 'Outline Width (world)', min: 0, max: 0.05, default: 0.012 },
      { name: '_Fade', type: 'range', label: 'Fade', min: 0, max: 1, default: 1 },
    ],
    renderState: { blend: 'opaque', cull: 'back', zwrite: true, queue: 'geometry' },
    lighting: { receiveShadows: true, castShadows: true },
    outline: { enabled: true, width: '_OutlineWidth', color: '_OutlineColor' },
    code: {
      common: `
// Kamera kapatma solması: _Fade < 1 iken ekran uzayı 4x4 Bayer desenine göre piksel atılır (opak kalır).
static const float kElarionBayer4x4[16] = { 0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0 };
void ElarionFadeClip(float4 positionCS)
{
    if (_Fade < 1.0)
    {
        uint2 p = uint2(positionCS.xy) & 3u;
        float threshold = (kElarionBayer4x4[p.y * 4u + p.x] + 0.5) * (1.0 / 16.0);
        clip(_Fade - threshold);
    }
}
`,
      fragment: `
float4 frag(UPEInput i)
{
    ElarionFadeClip(i.positionCS);
    float3 N = normalize(i.normalWS);
    float3 V = i.viewDirWS;
    float3 albedo = SAMPLE(_BaseMap, TRANSFORM_TEX(i.uv, _BaseMap)).rgb * _BaseColor.rgb;

    float ndl = dot(N, i.lightDir);
    ndl = lerp(-1.0, ndl, step(0.5, i.shadow));

    // 3 kademeli sert bant: karanlık / orta / aydınlık
    float mid = step(_MidThreshold, ndl);
    float lit = step(_LightThreshold, ndl);
    float bandMix = mid * 0.5 + lit * 0.5;
    float3 lightCol = saturate(i.lightColor * 0.8);
    float3 col = albedo * lerp(_ShadowTint.rgb, lightCol, bandMix);

    // Kameraya göre soğuk mavi dolgu ışığı (sert bant)
    float3 fillDir = normalize(V - i.cameraRightWS * 0.5 + i.cameraUpWS * 0.5);
    float fillDot = dot(N, fillDir);
    float fillBand = step(0.0, fillDot);
    float fillHi = step(0.55, fillDot);
    col += albedo * _FillColor.rgb * _FillStrength * (fillBand * 0.7 + fillHi * 0.5) * (1.0 - bandMix);

    // Turuncu rim light (fresnel), ışığa bakan kenarlarda
    float fres = 1.0 - saturate(dot(N, V));
    float rim = smoothstep(_RimThreshold, _RimThreshold + 0.06, pow(fres, _RimPower));
    float rimMask = smoothstep(-0.35, 0.2, ndl);
    col = lerp(col, _RimColor.rgb, rim * rimMask * _RimStrength);

    return float4(col, 1.0);
}
`,
      outlineFragment: `
float4 outlineFrag(UPEInput i)
{
    ElarionFadeClip(i.positionCS);
    return _OutlineColor;
}
`,
    },
  },
  {
    name: 'urp_lit', builtin: true, unityName: 'Universal Render Pipeline/Lit', urpSurface: true,
    description: 'URP Lit önizleme portu (metalik iş akışı, URP BRDF\'i). Yaklaşık: dolaylı yansıma ortam rengiyle taklit edilir (Unity\'de yansıma probu/skybox), normal/occlusion haritaları önizlemede yok.',
    properties: [
      { name: '_BaseMap', type: 'texture', label: 'Base Map', default: 'white' },
      { name: '_BaseColor', type: 'color', label: 'Base Color', default: '#ffffff' },
      { name: '_Metallic', type: 'range', label: 'Metallic', min: 0, max: 1, default: 0 },
      { name: '_Smoothness', type: 'range', label: 'Smoothness', min: 0, max: 1, default: 0.5 },
      { name: '_EmissionColor', type: 'hdrColor', label: 'Emission', default: { color: '#000000', intensity: 1 } },
      { name: '_EmissionMap', type: 'texture', label: 'Emission Map', default: 'white' },
      ...urpSurfaceProps,
    ],
    code: {
      common: urpSurfaceCommon + `
float3 UPE_URPLit(float3 albedo, float metallic, float smoothness, UPEInput i)
{
    float3 N = normalize(i.normalWS);
    float3 V = i.viewDirWS;
    float oneMinusReflectivity = 0.96 - metallic * 0.96;
    float reflectivity = 1.0 - oneMinusReflectivity;
    float3 brdfDiffuse = albedo * oneMinusReflectivity;
    float3 brdfSpecular = lerp(float3(0.04, 0.04, 0.04), albedo, metallic);
    float perceptualRoughness = 1.0 - smoothness;
    float roughness = max(perceptualRoughness * perceptualRoughness, 0.0078125);
    float roughness2 = max(roughness * roughness, 6.103515625e-5);
    float normalizationTerm = roughness * 4.0 + 2.0;
    float roughness2MinusOne = roughness2 - 1.0;
    float grazingTerm = saturate(smoothness + reflectivity);
    // dolaylı: SH ortam + yansıma (önizlemede ortam rengi)
    float fresnelTerm = pow(1.0 - saturate(dot(N, V)), 4.0);
    float surfaceReduction = 1.0 / (roughness2 + 1.0);
    float3 color = i.ambient * brdfDiffuse + i.ambient * surfaceReduction * lerp(brdfSpecular, splat3(grazingTerm), fresnelTerm);
    // ana ışık
    float3 L = i.lightDir;
    float3 radiance = i.lightColor * (i.shadow * saturate(dot(N, L)));
    float3 H = normalize(L + V);
    float NoH = saturate(dot(N, H));
    float LoH = saturate(dot(L, H));
    float d = NoH * NoH * roughness2MinusOne + 1.00001;
    float specularTerm = roughness2 / ((d * d) * max(0.1, LoH * LoH) * normalizationTerm);
    color += (brdfDiffuse + brdfSpecular * specularTerm) * radiance;
    return color;
}
`,
      fragment: `
float4 frag(UPEInput i)
{
    float2 uv = TRANSFORM_TEX(i.uv, _BaseMap);
    float4 base = SAMPLE(_BaseMap, uv) * _BaseColor;
    float3 col = UPE_URPLit(base.rgb, _Metallic, _Smoothness, i);
    col += SAMPLE(_EmissionMap, uv).rgb * _EmissionColor.rgb;
    return UPE_URPSurface(float4(col, base.a));
}
`,
    },
  },
  {
    name: 'urp_unlit', builtin: true, unityName: 'Universal Render Pipeline/Unlit', urpSurface: true,
    description: 'URP Unlit önizleme portu.',
    properties: [
      { name: '_BaseMap', type: 'texture', label: 'Base Map', default: 'white' },
      { name: '_BaseColor', type: 'color', label: 'Base Color', default: '#ffffff' },
      ...urpSurfaceProps,
    ],
    lighting: { receiveShadows: false, castShadows: true },
    code: {
      common: urpSurfaceCommon,
      fragment: `
float4 frag(UPEInput i)
{
    return UPE_URPSurface(SAMPLE(_BaseMap, TRANSFORM_TEX(i.uv, _BaseMap)) * _BaseColor);
}
`,
    },
  },
  {
    name: 'urp_particles_unlit', builtin: true, unityName: 'Universal Render Pipeline/Particles/Unlit', urpSurface: true,
    description: 'URP Particles/Unlit önizleme portu (köşe rengi çarpımı).',
    properties: [
      { name: '_BaseMap', type: 'texture', label: 'Base Map', default: 'white' },
      { name: '_BaseColor', type: 'color', label: 'Base Color', default: '#ffffff' },
      ...urpSurfaceProps,
    ],
    lighting: { receiveShadows: false, castShadows: false },
    code: {
      common: urpSurfaceCommon,
      fragment: `
float4 frag(UPEInput i)
{
    return UPE_URPSurface(SAMPLE(_BaseMap, TRANSFORM_TEX(i.uv, _BaseMap)) * _BaseColor * i.color);
}
`,
    },
  },
];

// ── yeni özel shader şablonları
export const TEMPLATES = {
  unlit: { label: 'Unlit (doku × renk)', shader: {} },
  toon: {
    label: 'Toon (2 bant + rim + outline)',
    shader: {
      properties: [
        { name: '_BaseMap', type: 'texture', label: 'Doku', default: 'white' },
        { name: '_BaseColor', type: 'color', label: 'Renk', default: '#ffffff' },
        { name: '_ShadowColor', type: 'color', label: 'Gölge rengi', default: '#5a6488' },
        { name: '_Threshold', type: 'range', label: 'Bant eşiği', min: -1, max: 1, default: 0.1 },
        { name: '_RimColor', type: 'hdrColor', label: 'Rim', default: { color: '#ff6b14', intensity: 1 } },
        { name: '_RimPower', type: 'range', label: 'Rim gücü', min: 0.5, max: 8, default: 3 },
        { name: '_OutlineColor', type: 'color', label: 'Outline rengi', default: '#08050a' },
        { name: '_OutlineWidth', type: 'range', label: 'Outline kalınlığı (m)', min: 0, max: 0.05, default: 0.01 },
      ],
      outline: { enabled: true, width: '_OutlineWidth', color: '_OutlineColor' },
      code: {
        fragment: `
float4 frag(UPEInput i)
{
    float3 N = normalize(i.normalWS);
    float3 albedo = SAMPLE(_BaseMap, TRANSFORM_TEX(i.uv, _BaseMap)).rgb * _BaseColor.rgb;
    float ndl = dot(N, i.lightDir);
    float lit = step(_Threshold, ndl) * step(0.5, i.shadow);
    float3 col = albedo * lerp(_ShadowColor.rgb, i.lightColor, lit) + albedo * i.ambient * 0.3;
    float rim = pow(1.0 - saturate(dot(N, i.viewDirWS)), _RimPower);
    col += _RimColor.rgb * step(0.5, rim);
    return float4(col, 1.0);
}
`,
      },
    },
  },
  fresnel: {
    label: 'Fresnel kalkan (additive)',
    shader: {
      properties: [
        { name: '_Color', type: 'hdrColor', label: 'Renk', default: { color: '#3aa0ff', intensity: 2 } },
        { name: '_Power', type: 'range', label: 'Kenar gücü', min: 0.5, max: 8, default: 3 },
        { name: '_Base', type: 'range', label: 'İç parlaklık', min: 0, max: 1, default: 0.08 },
        { name: '_Pulse', type: 'range', label: 'Nabız hızı', min: 0, max: 10, default: 2 },
      ],
      renderState: { blend: 'additive', cull: 'back', zwrite: false, queue: 'transparent' },
      lighting: { receiveShadows: false, castShadows: false },
      code: {
        fragment: `
float4 frag(UPEInput i)
{
    float f = pow(1.0 - saturate(dot(normalize(i.normalWS), i.viewDirWS)), _Power);
    float pulse = 0.85 + 0.15 * sin(i.time * _Pulse);
    return float4(_Color.rgb * (f + _Base) * pulse, 1.0);
}
`,
      },
    },
  },
  dissolve: {
    label: 'Dissolve (gürültüyle eriyen + kızgın kenar)',
    shader: {
      properties: [
        { name: '_BaseMap', type: 'texture', label: 'Doku', default: 'white' },
        { name: '_BaseColor', type: 'color', label: 'Renk', default: '#ffffff' },
        { name: '_NoiseMap', type: 'texture', label: 'Gürültü', default: 'noise', linear: true },
        { name: '_Amount', type: 'range', label: 'Erime', min: 0, max: 1, default: 0.35 },
        { name: '_EdgeWidth', type: 'range', label: 'Kenar genişliği', min: 0, max: 0.2, default: 0.05 },
        { name: '_EdgeColor', type: 'hdrColor', label: 'Kenar rengi', default: { color: '#ff6a1a', intensity: 4 } },
      ],
      renderState: { blend: 'opaque', cull: 'off', queue: 'alphatest' },
      lighting: { receiveShadows: true, castShadows: false },
      code: {
        fragment: `
float4 frag(UPEInput i)
{
    float n = SAMPLE(_NoiseMap, TRANSFORM_TEX(i.uv, _NoiseMap)).r;
    clip(n - _Amount);
    float3 N = normalize(i.normalWS) * i.facing;
    float3 albedo = SAMPLE(_BaseMap, TRANSFORM_TEX(i.uv, _BaseMap)).rgb * _BaseColor.rgb;
    float3 col = albedo * (i.ambient + i.lightColor * saturate(dot(N, i.lightDir)) * i.shadow);
    float edge = 1.0 - step(_Amount + _EdgeWidth, n);
    return float4(lerp(col, _EdgeColor.rgb, edge), 1.0);
}
`,
      },
    },
  },
  scroll: {
    label: 'Kayan doku (enerji/akış, additive)',
    shader: {
      properties: [
        { name: '_MainTex', type: 'texture', label: 'Doku', default: 'noise', linear: true },
        { name: '_Color', type: 'hdrColor', label: 'Renk', default: { color: '#ff7a2a', intensity: 2 } },
        { name: '_Speed', type: 'vector', label: 'Hız (xy)', default: [0.15, 0.4, 0, 0] },
        { name: '_Contrast', type: 'range', label: 'Kontrast', min: 0.5, max: 6, default: 2 },
      ],
      renderState: { blend: 'additive', cull: 'off', zwrite: false, queue: 'transparent' },
      lighting: { receiveShadows: false, castShadows: false },
      code: {
        fragment: `
float4 frag(UPEInput i)
{
    float2 uv = TRANSFORM_TEX(i.uv, _MainTex);
    float a = SAMPLE(_MainTex, uv + _Speed.xy * i.time).r;
    float b = SAMPLE(_MainTex, uv * 1.7 - _Speed.xy * i.time * 0.6).r;
    float v = pow(saturate(a * b * 2.0), _Contrast);
    return float4(_Color.rgb * v * i.color.rgb, 1.0);
}
`,
      },
    },
  },
};
