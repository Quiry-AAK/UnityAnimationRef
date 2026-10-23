# Materyal + Shader modu — entegrasyon sözleşmesi

Unity Preview Editor'e iki yeni mod: **Materyal** ve **Shader** (Animasyon | VFX | Materyal | Shader).
Formatların tek kaynağı `public/shader-schema.js` (`normalizeShader`, `normalizeMaterial`, `applyShaderChanges`,
`applyMaterialChanges`, `diffShaders`, `diffObjects`, `normalizeLighting`, `SHADER_REFERENCE`, `MATERIAL_REFERENCE`)
ve hazır shader'lar `public/shader-builtins.js` (`BUILTIN_SHADERS`, `TEMPLATES`). Tarayıcı ve Node aynı dosyaları import eder.

- Shader kodu **UPE-SL** (Unity HLSL alt kümesi, kurallar `SHADER_REFERENCE`'ta). Unity'de: `lib/shader-hlsl.js` URP şablonuna
  yerleştirir → `.shader`. Editörde: `public/shader-compile.js` GLSL ES 3.0'a çevirir → three.js ShaderMaterial.
- **builtin** shader = mevcut Unity shader'ının önizleme portu (`Elarion/ToonCharacter`, URP Lit/Unlit/Particles Unlit).
  Materyal Unity'de o shader'ı kullanır, `.shader` yazılmaz. Özel shader'lar `UnityPreview/<ad>` olarak yazılır.
- Materyal `shader` alanı Unity shader adıdır. Çözümleme: builtin'lerde `unityName`, özelde `UnityPreview/<name>`.

## Klasörler
- `shaders/<ad>.json` özel shader'lar · `materials/<ad>.json` materyaller · `materials/textures/<ad>.png` dokular
  (yerleşikler `tools/gen-material-textures.mjs`: noise, checker, ramp). Doku adları uzantısız. Özel adlar: white, black, gray, bump
  (önizlemede üretilir; Unity'de shader varsayılanı), `@mesh` (önizleme nesnesinin kendi dokusu; Unity'de `unityPath` gerekir).

## Sunucu (server.js)
state'e eklenenler: `material` (editördeki materyal), `materialBaseline`, `shader` (editördeki shader), `shaderBaseline`,
`lighting` (`normalizeLighting`), `materialOverrides` (`{ 'hero': '<materyal>', 'hero:<mesh>': ..., 'prop:<id>': ... }`).
Modlar: `anim | vfx | material | shader`. Notlar `mode: 'material' | 'shader'` taşıyabilir.

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/shaders/list` | | `[{ name, unityName, builtin, description, properties, modified }]` (builtin + özel) |
| `GET /api/shaders/get?name=` | ad ya da unityName | normalize shader |
| `POST /api/shaders/save?name=` | shader | `shaders/<ad>.json`; builtin adları/unityName'leri ezilemez (400) |
| `POST /api/shaders/delete?name=` | | builtin silinemez |
| `GET /api/materials/list` · `GET /api/materials/get?name=` · `POST /api/materials/save?name=` · `POST /api/materials/delete?name=` | | |
| `GET /api/material-textures` | | `['checker','noise',...]` |
| `POST /api/upload-material-texture?name=x.png` | ham bayt | `{ name }` |
| `POST /api/material` · `POST /api/material/baseline` | editörden (olay yok) | |
| `POST /api/shader` · `POST /api/shader/baseline` | editörden (olay yok) | |
| `POST /api/lighting` · `POST /api/overrides` | editörden (olay yok) | |
| `POST /api/claude/material` | `{ material, setBaseline? }` | olay `material`, mode=material |
| `POST /api/claude/shader` | `{ shader, setBaseline? }` | olay `shader`, mode=shader |
| `POST /api/claude/material-load` · `POST /api/claude/shader-load` | `{ name }` | kütüphaneden, baseline, olay |
| `POST /api/claude/shader-compile` | `{ shader }` | olay `shader-compile {id, shader}`; editör `POST /api/shader-compile-result {id, ok, errors:[{section,line,message}], log}` döner; ≤10 sn bekle; tarayıcı yoksa 409 |
| `POST /api/claude/lighting` · `POST /api/claude/overrides` | `{ lighting }` · `{ overrides }` | olay `lighting` · `overrides` |
| `POST /api/claude/render` | `{ kind:'material', views?, size?, target?, time?, bg? }` | mevcut render yolu, `{ png }` |
| `POST /api/unity/send-material` | `{ name?, all? }` | aşağıda |
| `POST /api/unity/send-shader` | `{ name }` | yalnız özel shader'ı yazar, Unity derleme sonucunu bekler |

Statik: `/material-textures/` → `materials/textures/`.

### Unity'ye gönderim (`send-material`)
1. `unity/UnityPreviewMaterial*.cs` → `<proje>/Assets/Editor/UnityPreview/` (değiştiyse).
2. Materyal(ler): `all` → kütüphanenin tamamı; `name` → kütüphaneden; yoksa `state.material`. Her biri `normalizeMaterial(m, shader)`.
3. Shader özelse: `generateUnityShader(shader)` (lib/shader-hlsl.js) → `Assets/UnityPreview/Shaders/<ad>.shader` (değiştiyse).
4. Kullanılan dokular (white/black/gray/bump/@mesh hariç) → `Assets/UnityPreview/Materials/Textures/<ad>.png`.
5. Dışa aktarım yükü → `Assets/UnityPreview/Materials/<ad>.mat.json`:
   `{ format:'upe-material-export-1', name, shaderName, urpSurface, renderQueue, properties:[{name,type,linear}], values, textures:{ <doku>: 'Assets/...png' } }`
6. ≤25 sn: `<ad>.mat` mtime ≥ başlangıç; `Assets/UnityPreview/Materials/last_status.txt` satırları:
   `<ad>|OK|<yol>` · `<ad>|ERROR|<mesaj>` · `shader:<ad>|OK|<yol>` · `shader:<ad>|ERROR|<satır>: <mesaj>`.
7. Yanıt: `{ ok, sent, imported, waiting, materials, shaders, shaderErrors, missingTextures, note | error }`.
   Unity kapalıyken: `-executeMethod UnityPreviewMaterialImporter.ProcessPending`.

## SSE olayları (editör dinler)
`material {material}` (Materyal moduna geçer) · `shader {shader}` (Shader moduna geçer) · `shader-compile {id, shader}` ·
`lighting {lighting}` · `overrides {overrides}` · `render {id, kind:'material', ...}` (kontak sayfası).

## MCP araçları (mcp.js)
| Araç | İş |
|---|---|
| `material_reference` | `SHADER_REFERENCE` + `MATERIAL_REFERENCE` + hazır shader/şablon listesi + doku listesi |
| `list_shaders` · `get_shader {name}` | |
| `new_shader {name, template?}` | `TEMPLATES[template]` ile yeni özel shader, editöre yükler |
| `set_shader {shader}` · `update_shader {changes:[{path,value}]}` | normalize/`applyShaderChanges` → editöre yükle → `shader-compile` sonucu (GLSL hataları bölüm+satır) döner |
| `save_shader {name?}` · `delete_shader {name}` (kullanıcı istemeden çağırma) | |
| `list_materials` · `get_material {name?}` | |
| `new_material {name, shader, values?}` · `set_material {material}` · `update_material {changes}` | `applyMaterialChanges`; yol örn. `values._RimPower`, `preview.target` |
| `save_material {name?}` · `delete_material {name}` | |
| `assign_material {target, material\|null}` | önizlemede kahramana/eşyaya giydir (tüm modlarda) |
| `get_lighting` · `set_lighting {lighting}` | |
| `render_material {views?, size?, target?, time?, bg?}` | kontak sayfası (görsel) |
| `get_material_user_edits {acknowledge?}` · `get_shader_user_edits {acknowledge?}` | `diffObjects` / `diffShaders` + notlar |
| `list_material_textures` | |
| `send_material_to_unity {name?, all?}` · `send_shader_to_unity {name}` | |
`set_editor_mode` enum'u `anim|vfx|material|shader` olur; `get_status` materyal/shader/override özeti döner.

## Unity: HLSL üretici (lib/shader-hlsl.js)
`export function generateUnityShader(shader) → { source, warnings }` (shader = `normalizeShader` çıktısı; builtin için hata).
`Shader "UnityPreview/<ad>"` · Properties (float/Range/[ToggleUI]/Color/[HDR] Color/Vector/2D) · SubShader Tags (RenderPipeline,
RenderType, Queue+offset) · HLSLINCLUDE: Core.hlsl, TEXTURE2D/SAMPLER, `CBUFFER_START(UnityPerMaterial)` (tüm özellikler +
`<doku>_ST`), UPE prelude (UPEVertex, UPEInput, SAMPLE, SAMPLE_LOD, splat2/3/4; TRANSFORM_TEX URP'de zaten var), code.common,
code.vertex, code.fragment, code.outlineFragment. Pass'ler: **UniversalForward** (renderState; UPEInput'u URP fonksiyonlarıyla
doldurur: GetMainLight(+gölge koordinatı, receiveShadows ise shadow multi_compile), SampleSH, GetNormalizedScreenSpaceUV,
UNITY_MATRIX_V[0/1], _WorldSpaceCameraPos, _Time.y, IS_FRONT_VFACE) · **Outline** (SRPDefaultUnlit, Cull Front, normal boyunca
dünya genişliği; outlineFrag ya da renk) · **ShadowCaster** (castShadows) · **DepthOnly** + **DepthNormals** (opak). Hepsinde vert().

## Unity: materyal importer (unity/UnityPreviewMaterialImporter.cs)
`*.mat.json` → `<ad>.mat` (GUID korunur), `Shader.Find(shaderName)`; değerler: color → SetColor(sRGB, Unity çevirir), hdrColor →
doğrusal(renk)×intensity Linear projede `.gamma` ile, float/range/toggle → SetFloat, vector → SetVector, texture → yol/unityPath
(+ import ayarı: linear → sRGB kapalı), tiling/offset. urpSurface: URP yüzey/karışım/cull/alfa-kesme keyword + blend + queue +
RenderType etiketi, Lit'te emisyon siyah değilse _EMISSION. Shader derleme hataları (`ShaderUtil.GetShaderMessages`) durum dosyasına.
