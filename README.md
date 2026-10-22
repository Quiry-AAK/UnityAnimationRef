# Anim Ref

Mixamo rig üzerinde animasyon editörü (three.js) + Claude için MCP + Unity AnimationClip importer.

## Kurulum (herhangi bir klasörde)
```bash
git clone <repo-url> AnimRef
cd AnimRef
npm install
npm start            # editör: http://localhost:5177
```
Gereken: Node.js 18+.

## Claude'a bağlama (MCP)
Claude Code'da bir kez:
```bash
claude mcp add anim-ref -- node C:/YOL/AnimRef/mcp.js
```
ya da kullandığın proje klasörüne `.mcp.json.example` dosyasını `.mcp.json` olarak kopyalayıp yolu düzelt. MCP çalışınca editör sunucusu otomatik başlar.

## Klasörler
- `models/` karakterler (Mixamo FBX, repoda yok — kendin koy) · `props/` eşyalar (GLB/FBX)
- `animations/` animasyon kütüphanesi (json repoda, fbx değil) · `exports/` çıktılar (gif, *.animref.json)
- `unity/AnimRefImporter.cs` → Unity projesinde `Assets/Editor/` → Tools > Anim Ref > Import
- `tools/run-cycle.mjs` örnek run animasyonu üretici

## MCP araçları
get_status, set_keys, set_animation, get_user_edits, render_frame, list/save/load/delete_animation, list_props, attach/update/detach_prop, load_model, export_gif, export_for_unity (animation / all)
