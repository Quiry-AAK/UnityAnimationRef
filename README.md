# Unity Preview Editor (UPE)

Unity için önizleme editörü (three.js) + Claude için MCP + Unity'ye tek tıkla aktarım. Eski adı **Anim Ref**.
İşi Claude yapar (MCP araçlarıyla), kullanıcı editörde izler ve isterse değerlerle oynar; onaylanan iş Unity'ye gider.

Modlar (üst bardaki anahtar):
- **Animasyon** — Mixamo/Humanoid rig üzerinde key'li animasyon → Unity `.anim`
- **VFX** — Unity ParticleSystem'e birebir karşılık gelen çok katmanlı parçacık efektleri → Unity prefab
- (ileride) **Shader**

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

Ayrıntılı kullanım, kısayollar ve teknik notlar: [NOTLAR.md](NOTLAR.md) · VFX sözleşmesi: [docs/VFX.md](docs/VFX.md)

## Klasörler
- `models/` karakterler (repoda yok — kendin koy) · `props/` eşyalar (GLB/FBX)
- `animations/` animasyon kütüphanesi (json repoda, fbx değil) · `vfx/` efekt kütüphanesi (json) · `vfx/textures/` parçacık dokuları (png)
- `exports/` çıktılar · `unity/` Unity editör scriptleri (gönderimde projeye otomatik kurulur)
- `public/` editör (app.js animasyon, vfx.js + vfx-sim.js VFX, vfx-schema.js efekt formatı — MCP de bunu kullanır)
- `tools/` yardımcılar: `gen-vfx-textures.mjs` (yerleşik dokular), `mcp-smoke.mjs` (MCP uçtan uca testi), animasyon üreteçleri

## MCP araçları
- Genel: `get_status`, `set_editor_mode`
- Animasyon: `set_keys`, `set_animation`, `get_animation`, `clear_keys`, `sample_pose`, `get_user_edits`, `render_frame`, `list/save/load/delete_animation`, `list_props`, `attach/update/detach_prop`, `list_models`, `load_model`, `export_gif`, `export_for_unity`, `send_to_unity`
- VFX: `vfx_reference` (önce bu), `get_vfx`, `set_vfx`, `update_vfx`, `add_emitter`, `remove_emitter`, `get_vfx_user_edits`, `render_vfx`, `list/save/load/delete_vfx`, `list_vfx_textures`, `send_vfx_to_unity`
- Unity: `get_unity_info`, `set_unity_project`
