# VFX modülü — entegrasyon sözleşmesi

Unity Preview Editor (eski adı Anim Ref) artık iki modlu: **Animasyon** ve **VFX**. İleride Shader modu eklenecek;
mod sistemi buna göre genişletilebilir tutulur. Efekt veri formatının tek kaynağı `public/vfx-schema.js`
(`VFX_REFERENCE` metni, `MODULES` alan tanımları, `normalizeEffect`, `applyChanges`, `diffEffects`, `PRESETS`).
Tarayıcı (`/vfx-schema.js`) ve MCP (`./public/vfx-schema.js`) aynı dosyayı import eder.

## Klasörler
- `vfx/<ad>.json` — efekt kütüphanesi (repoda)
- `vfx/textures/<ad>.png` — parçacık dokuları (yerleşikler `tools/gen-vfx-textures.mjs` ile üretilir, repoda). Efekt
  `renderer.texture` alanında uzantısız adla anılır.

## Sunucu (server.js)
Ortam değişkeni: `UPE_PORT` (yoksa `ANIMREF_PORT`, yoksa 5177).

state'e eklenenler: `mode: 'anim' | 'vfx'`, `vfx` (editördeki efekt), `vfxBaseline` (Claude'un son verdiği hâl; kullanıcı
farkı buna göre). Notlar `mode` alanı taşır (`'anim'` varsayılan).

| Uç | Gövde / sorgu | Yanıt |
|---|---|---|
| `GET /api/vfx/list` | | `[{ name, file, modified, emitters, duration }]` |
| `GET /api/vfx/get?name=` | | efekt JSON (yoksa 404) |
| `POST /api/vfx/save?name=` | efekt | `{ name }` → `vfx/<ad>.json` (`{...body, name}`) |
| `POST /api/vfx/delete?name=` | | `{ ok }` |
| `GET /api/vfx/textures` | | `['ember', 'flame', ...]` (vfx/textures içindeki png adları, uzantısız) |
| `POST /api/upload-vfx-texture?name=x.png` | ham bayt | `{ name }` |
| `POST /api/vfx` | efekt | editörden güncelleme (olay yayınlamaz) `{ version }` |
| `POST /api/vfx/baseline` | | `vfxBaseline = vfx` |
| `POST /api/mode` | `{ mode }` | editör modunu bildirir (olay yok) |
| `POST /api/notes/clear?mode=vfx` | | yalnız o moddaki notları siler (mode yoksa hepsi) |
| `POST /api/claude/vfx` | `{ vfx, setBaseline? }` | `state.vfx = vfx`, baseline (false değilse), `mode='vfx'`, olay `vfx` → `{ clients }` |
| `POST /api/claude/vfx-load` | `{ name }` | kütüphaneden yükler, baseline yapar, olay `vfx` |
| `POST /api/claude/mode` | `{ mode }` | olay `mode` |
| `POST /api/claude/render` | `{ kind:'vfx', times?, count?, cols?, size?, camera?, showHero?, bg? }` | olay `render`, `{ png }` (zaman aşımı 30 sn) |
| `POST /api/unity/send-vfx` | `{ name?, all? }` | aşağıda |

Statik: `/vfx-textures/` → `vfx/textures/`.

### Unity'ye VFX gönderimi
1. Unity proje ayarı (`state.unity.project`) geçerli olmalı; karakter GEREKMEZ.
2. `unity/UnityPreviewVfx*.cs` → `<proje>/Assets/Editor/UnityPreview/` (değiştiyse yaz).
3. Efekt(ler): `all` → kütüphanedeki tüm `vfx/*.json`; `name` → kütüphaneden; ikisi de yoksa `state.vfx`.
4. Her efekt normalize edilip `<proje>/Assets/UnityPreview/VFX/<ad>.vfx.json` olarak yazılır; kullandığı dokular
   `<proje>/Assets/UnityPreview/VFX/Textures/<doku>.png` olarak kopyalanır (değiştiyse).
5. ≤ 20 sn: `<proje>/Assets/UnityPreview/VFX/<ad>.prefab` mtime ≥ başlangıç olana dek beklenir;
   `Assets/UnityPreview/VFX/last_status.txt` (`ad|OK|yol` ya da `ad|ERROR|mesaj`) okunur.
6. Yanıt: `{ ok, sent, imported, waiting, prefabs, note | error }`. Unity kapalıysa açılınca işlenir; batchmode için
   `-executeMethod UnityPreviewVfxImporter.ProcessPending`.

## SSE olayları (editör dinler)
- `vfx` `{ vfx }` → editör VFX moduna geçer, efekti yükler (geri alınabilir)
- `mode` `{ mode }`
- `render` `{ id, kind:'vfx', ... }` → editör efektin zaman karelerini kontak sayfası PNG'si olarak çizer ve
  `POST /api/render-result { id, png }` gönderir. `kind` yoksa eski karakter render'ı.

## MCP araçları (mcp.js, sunucu adı `unity-preview-editor`)
Mevcut animasyon araçları aynen kalır. `get_status` ayrıca `mode` ve `vfx` özeti döner.

| Araç | Girdi | İş |
|---|---|---|
| `vfx_reference` | | `VFX_REFERENCE` + doku listesi + şablon adları |
| `get_vfx` | `emitters?: string[]` | editördeki efekt (normalize) |
| `set_vfx` | `effect` (nesne) | normalize → `/api/claude/vfx`; uyarılar + özet |
| `update_vfx` | `changes: [{ emitter?, path, value }]` | `applyChanges` → `/api/claude/vfx`; hatalar/uyarılar |
| `add_emitter` | `preset?, name?, overrides?, index?` | `presetEmitter` ile ekler |
| `remove_emitter` | `emitter` | |
| `get_vfx_user_edits` | `acknowledge?` | `diffEffects(vfxBaseline, vfx)` + `mode:'vfx'` notları; acknowledge → notları temizle + baseline |
| `render_vfx` | `times?, count?=6, cols?, size?=320, camera?{ preset?: front|side|top|threequarter, position?, target? }, showHero?, bg?` | kontak sayfası (görsel) |
| `list_vfx` / `save_vfx {name, effect?}` / `load_vfx {name}` / `delete_vfx {name}` | | kütüphane |
| `list_vfx_textures` | | dokular + yerleşik açıklamaları |
| `set_editor_mode` | `mode: anim|vfx` | kullanıcının ekranındaki modu değiştirir |
| `send_vfx_to_unity` | `name?, all?` | `/api/unity/send-vfx` |

## Unity dönüştürücüsü (unity/UnityPreviewVfxImporter.cs)
`Assets/UnityPreview/VFX/*.vfx.json` → `Assets/UnityPreview/VFX/<ad>.prefab` (+ `Materials/<ad>__<emitter>.mat`).
Kök: efekt adında GameObject + emisyonsuz, renderer'ı kapalı ParticleSystem (Play() tüm çocukları oynatır).
Her emitter bir çocuk GameObject + ParticleSystem; `enabled:false` olan pasif. Modül eşlemesi `VFX_REFERENCE`'taki
alanlarla birebir; Unity API'si radyan istediği yerde (startRotation, rotationOverLifetime) derece→radyan çevrilir.
Malzeme: URP `Universal Render Pipeline/Particles/Unlit` (yoksa `Particles/Standard Unlit`), saydam, additive/alpha,
`_BaseColor` = beyaz × intensity (doğrusal), `_BaseMap` = doku.
