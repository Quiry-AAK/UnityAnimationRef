# Unity Preview Editor (UPE)

Unity için önizleme editörü (three.js) + Claude için MCP + Unity'ye tek tıkla aktarım; **VFX ve animasyon artık Unreal Engine 5'e de
gönderilir** (Niagara System / AnimSequence, çalışan UE editörüne ue-mcp üzerinden). Eski adı **Anim Ref**.
İşi Claude yapar (MCP araçlarıyla), kullanıcı editörde izler ve isterse değerlerle oynar; onaylanan iş Unity'ye ya da Unreal'e gider
(yalnız kullanıcı gönder deyince; hiçbir şey kendiliğinden motora gitmez).

Modlar (üst bardaki anahtar):
- **Animasyon** — Mixamo/Humanoid rig üzerinde key'li animasyon → Unity `.anim` ya da **Unreal AnimSequence**
- **VFX** — Unity ParticleSystem'e birebir karşılık gelen çok katmanlı parçacık efektleri → Unity prefab ya da **Unreal Niagara System**
- **Materyal** — Unity materyalleri (oyunun shader'ları, URP Lit/Unlit/Particles ya da özel shader) küre/kahraman/eşya üzerinde → Unity `.mat`
- **Shader** — özel shader'lar UPE-SL ile (Unity HLSL alt kümesi): Unity'de aynen URP shader'ı olur, editör GLSL'e çevirip önizler → Unity `.shader`
- **Model** — GLB/FBX/OBJ görüntüleyici: ölçü, üçgen, parça, materyal, doku, kemik bilgisi; kil/normal/UV/tel kafes/iskelet görünümleri, gömülü animasyon (yalnız görüntüleme, Unity'ye gönderim yok)

## Kurulum (herhangi bir klasörde)
```bash
git clone <repo-url> AnimRef
cd AnimRef
npm install
npm start            # editör: http://localhost:5177
```
Gereken: Node.js 18+. Port: `UPE_PORT` (eski `ANIMREF_PORT` da geçerli).

## Claude'a bağlama (MCP)
Claude Code'da bir kez:
```bash
claude mcp add unity-preview -- node C:/YOL/AnimRef/mcp.js
```
ya da proje klasörüne `.mcp.json.example` dosyasını `.mcp.json` olarak kopyalayıp yolu düzelt. MCP çalışınca editör sunucusu
otomatik başlar (her chat kendi portunu alır).

Ayrıntılı kullanım, kısayollar ve teknik notlar: [NOTLAR.md](NOTLAR.md) · Sözleşmeler: [docs/VFX.md](docs/VFX.md), [docs/MATERIAL.md](docs/MATERIAL.md), [docs/UNREAL.md](docs/UNREAL.md)

## Unreal'e gönderme (VFX + animasyon)
UE5 editörü açık ve projede ue-mcp köprü eklentisi (`UE_MCP_Bridge`) yüklü olmalı; UPE `npx ue-mcp@<sürüm> <uproject>`'i kendisi başlatır
(sürüm boşsa projenin kendi `.mcp.json`'undaki ue-mcp sürümü). Sağ panel → **Unreal** (proje, MCP hedefi, ue-mcp sürümü, içerik yolu,
animasyonda hedef iskelet; bağlantı göstergesi) → üst bar **⇪ Unreal'e gönder** (Ctrl+Shift+Enter) ya da MCP `send_vfx_to_unreal` /
`send_animation_to_unreal`.
- VFX: `<içerik yolu>/NS_<ad>` Niagara System (varsayılan `/Game/UPE/VFX`).
- Animasyon: `<içerik yolu>/A_<ad>` AnimSequence (varsayılan `/Game/UPE/Animations`), UE'deki aynı Mixamo karakterinin iskeletine yazılır.

Editöre betik kurulmaz. Ayrıntı: [docs/UNREAL.md](docs/UNREAL.md).

## Klasörler
- `models/` karakterler (repoda yok — kendin koy) · `props/` eşyalar (GLB/FBX) · `meshes/` Model sekmesinde görüntülenen genel modeller (repoda yok)
- `animations/` animasyon kütüphanesi (json repoda, fbx değil) · `vfx/` efekt kütüphanesi (json) · `vfx/textures/` parçacık dokuları (png)
- `shaders/` özel shader'lar (json) · `materials/` materyaller (json) · `materials/textures/` materyal dokuları (png)
- `exports/` çıktılar · `unity/` Unity editör scriptleri (gönderimde projeye otomatik kurulur)
- `public/` editör (app.js animasyon + mod sistemi, vfx*.js VFX, material.js Materyal/Shader modları, model.js Model modu, shader-compile.js UPE-SL→GLSL,
  shader-schema.js + vfx-schema.js formatlar, shader-builtins.js hazır shader portları — MCP de şema dosyalarını kullanır)
- `lib/shader-hlsl.js` UPE shader → Unity URP `.shader` üretici · `lib/unreal-vfx.js` VFX → Unreal Niagara · `lib/unreal-anim.js` animasyon → Unreal AnimSequence · `lib/unreal-mcp-client.js` UE MCP (ue-mcp) istemcisi
- `tools/` yardımcılar: `gen-vfx-textures.mjs`, `gen-material-textures.mjs` (yerleşik dokular), `mcp-smoke.mjs` (MCP uçtan uca testi), `hlsl-gen-test.mjs`, `ue-vfx-plan-test.mjs` / `ue-anim-plan-test.mjs` (Unreal dönüştürme, editörsüz), animasyon üreteçleri

## MCP araçları
- Genel: `get_status`, `set_editor_mode`
- Animasyon: `set_keys`, `set_animation`, `get_animation`, `clear_keys`, `sample_pose`, `get_user_edits`, `render_frame`, `list/save/load/delete_animation`, `list_props`, `attach/update/detach_prop`, `list_models`, `load_model`, `export_gif`, `export_for_unity`, `send_to_unity`, `send_animation_to_unreal`
- VFX: `vfx_reference` (önce bu), `get_vfx`, `set_vfx`, `update_vfx`, `add_emitter`, `remove_emitter`, `get_vfx_user_edits`, `render_vfx`, `fit_arc_from_animation`, `list/save/load/delete_vfx`, `list_vfx_textures`, `send_vfx_to_unity`, `send_vfx_to_unreal`
- Materyal/Shader: `material_reference` (önce bu), `list/get/new/set/update/save/load/delete_material`, `list/get/new/set/update/save/load/delete_shader`
  (set/update shader editörün GLSL derleme sonucunu döner), `assign_material` (kahramana/eşyaya giydir), `get/set_lighting`, `render_material`,
  `get_material_user_edits`, `get_shader_user_edits`, `list_material_textures`, `send_material_to_unity`, `send_shader_to_unity`
- Model: `list_model_files`, `view_model` (ad ya da mutlak yol + görünüm ayarları; modelin bilgisini döner), `get_model_view`, `render_model`
- Unity: `get_unity_info`, `set_unity_project` · Unreal: `get_unreal_info`, `set_unreal_project`
