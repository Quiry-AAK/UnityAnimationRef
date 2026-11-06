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
| `GET /api/unreal` | | `{ project, projectValid, uproject, projectName, mcpUrl, contentPath }` (bağlantı denemesi yok) |
| `GET /api/unreal/status` | | yukarıdaki + `status: { connected, projectName?, engineVersion?, error? }` (`unrealStatus`) |
| `POST /api/unreal/config` | `{ project?, mcpUrl?, contentPath? }` | doğrular (proje: `.uproject` içeren klasör ya da `.uproject` yolu; içerik yolu `/Game/...`), kalıcı; hata 400 |
| `POST /api/unreal/send-vfx` | `{ name?, all? }` | aşağıda (Unreal) |

Statik: `/vfx-textures/` → `vfx/textures/`.

### Unity'ye VFX gönderimi
1. Unity proje ayarı (`state.unity.project`) geçerli olmalı; karakter GEREKMEZ.
2. `unity/UnityPreviewVfx*.cs` → `<proje>/Assets/Editor/UnityPreview/` (değiştiyse yaz).
3. Efekt(ler): `all` → kütüphanedeki tüm `vfx/*.json`; `name` → kütüphaneden; ikisi de yoksa `state.vfx`.
4. Her efekt normalize edilip `<proje>/Assets/UnityPreview/VFX/<ad>.vfx.json` olarak yazılır; kullandığı dokular
   `<proje>/Assets/UnityPreview/VFX/Textures/<doku>.png` olarak kopyalanır (değiştiyse). `renderer.material` bağlı
   emitter'ların kütüphane materyalleri (+ özel shader'ları, dokuları) önce `send-material` gibi
   `Assets/UnityPreview/Materials/` altına yazılır (`writeMaterialPayloads`); kütüphanede olmayan ya da yazılamayan
   materyal o efekti durdurur (`errors`). Yanıta `materials`, `materialErrors`, `shaderErrors` eklenir.
5. ≤ 20 sn: `<proje>/Assets/UnityPreview/VFX/<ad>.prefab` mtime ≥ başlangıç olana dek beklenir;
   `Assets/UnityPreview/VFX/last_status.txt` (`ad|OK|yol` ya da `ad|ERROR|mesaj`) okunur.
6. Yanıt: `{ ok, sent, imported, waiting, prefabs, note | error }`. Unity kapalıysa açılınca işlenir; batchmode için
   `-executeMethod UnityPreviewVfxImporter.ProcessPending`.

## SSE olayları (editör dinler)
- `vfx` `{ vfx }` → editör VFX moduna geçer, efekti yükler (geri alınabilir)
- `mode` `{ mode }`
- `render` `{ id, kind:'vfx', ... }` → editör efektin zaman karelerini kontak sayfası PNG'si olarak çizer ve
  `POST /api/render-result { id, png }` gönderir. `kind` yoksa eski karakter render'ı.

### Unreal'e VFX gönderimi (sözleşme: [UNREAL.md](UNREAL.md))
1. `state.unreal = { project, mcpUrl ('http://127.0.0.1:8000/mcp'), contentPath ('/Game/UPE/VFX') }`; proje gönderim için zorunlu değil.
2. Efekt seçimi Unity ile aynı (`all` → kütüphane, `name` → kütüphaneden, yoksa `state.vfx`); `normalizeEffect`, adda boşluk/nokta/tire → `_`.
3. `sendVfxToUnreal(effects, { mcpUrl, contentPath, texturesDir: vfx/textures, log })` (`lib/unreal-vfx.js`, değişince yeniden yüklenir)
   → yanıt aynen: `{ ok, systems: [{ name, path, warnings }], errors: { ad: mesaj } }`; istisna → `{ ok:false, error }`.

## MCP araçları (mcp.js, sunucu adı `unity-preview-editor`)
Mevcut animasyon araçları aynen kalır. `get_status` ayrıca `mode` ve `vfx` özeti döner.

| Araç | Girdi | İş |
|---|---|---|
| `vfx_reference` | | `VFX_REFERENCE` + doku listesi + kütüphane materyalleri + şablon adları |
| `get_vfx` | `emitters?: string[]` | editördeki efekt (normalize) |
| `set_vfx` | `effect` (nesne) | normalize → `/api/claude/vfx`; uyarılar + özet |
| `update_vfx` | `changes: [{ emitter?, path, value }]` | `applyChanges` → `/api/claude/vfx`; hatalar/uyarılar |
| `add_emitter` | `preset?, name?, overrides?, index?` | `presetEmitter` ile ekler |
| `remove_emitter` | `emitter` | |
| `get_vfx_user_edits` | `acknowledge?` | `diffEffects(vfxBaseline, vfx)` + `mode:'vfx'` notları; acknowledge → notları temizle + baseline |
| `render_vfx` | `times?, count?=6, cols?, size?=320, camera?{ preset?: front|side|top|threequarter, position?, target? }, showHero?, bg?` | kontak sayfası (görsel) |
| `fit_arc_from_animation` | `target?: prop|bone, name?, tip?, root?, rootBone?, startFrame?, endFrame?, threshold?, emitter?, apply?, outerExtend?` | animasyondaki uç yolundan yay oturtur (`public/vfx-mesh.js` `fitArc`); `emitter` verilirse mesh yayına çevirir (aşağıda) |
| `list_vfx` / `save_vfx {name, effect?}` / `load_vfx {name}` / `delete_vfx {name}` | | kütüphane |
| `list_vfx_textures` | | dokular + yerleşik açıklamaları |
| `set_editor_mode` | `mode: anim|vfx` | kullanıcının ekranındaki modu değiştirir |
| `send_vfx_to_unity` | `name?, all?` | `/api/unity/send-vfx` |
| `send_vfx_to_unreal` | `name?, all?` | `/api/unreal/send-vfx` |
| `get_unreal_info` | | `/api/unreal/status` (editör kapalıyken de çalışır) |
| `set_unreal_project` | `project?, mcpUrl?, contentPath?` | `/api/unreal/config` |

## Unity dönüştürücüsü (unity/UnityPreviewVfxImporter.cs)
`Assets/UnityPreview/VFX/*.vfx.json` → `Assets/UnityPreview/VFX/<ad>.prefab` (+ `Materials/<ad>__<emitter>.mat`).
Kök: efekt adında GameObject + emisyonsuz, renderer'ı kapalı ParticleSystem (Play() tüm çocukları oynatır).
Her emitter bir çocuk GameObject + ParticleSystem; `enabled:false` olan pasif. Modül eşlemesi `VFX_REFERENCE`'taki
alanlarla birebir; Unity API'si radyan istediği yerde (startRotation, rotationOverLifetime) derece→radyan çevrilir.
Malzeme: URP `Universal Render Pipeline/Particles/Unlit` (yoksa `Particles/Standard Unlit`), saydam, additive/alpha,
`_BaseColor` = beyaz × intensity (doğrusal), `_BaseMap` = doku.

### Emitter materyali (`renderer.material`)
Doluysa emitter kendi `.mat`'ını üretmez; `Assets/UnityPreview/Materials/<materyal>.mat` bağlanır (sıralama: uzaklık).
Importer önce (yansımayla) `UnityPreviewMaterialImporter.ProcessPending`'i çalıştırır; `.mat` henüz yoksa ama `.mat.json`
≤ 60 sn önce yazıldıysa efekt bir sonraki poll'a bırakılır (batchmode'da beklemez). Yoksa anlaşılır hatayla durur.
Önizleme (`shader-compile.js` `buildParticlePrograms`): UPE-SL shader'ı aynı instanced quad'la çizilir; `v.positionOS` köşenin
dünya konumu (Unity'de parçacık köşeleri dünyada), `v.color` parçacık rengi (doğrusal), `v.uv` flipbook karesi. Unity şablonu
POSITION/NORMAL/TEXCOORD0/COLOR okur — ParticleSystemRenderer'ın varsayılan akışları; ek ayar gerekmez.

## BDO seviyesi katmanlar (2026-11)
Hepsi şemada (`VFX_REFERENCE`), önizlemede, MCP'de ve Niagara dönüştürücüsünde; eski efektler değişmeden çalışır (yeni alanlar varsayılanla dolar).
- **Mesh parçacıkları** — `renderer.mode: 'mesh'`, `renderer.mesh { shape: arc|cylinder|plane|file, file, innerRadius, outerRadius, angle,
  height, segments, rings, rotation }`. Geometri `public/vfx-mesh.js` (`proceduralMesh`, `transformMesh`; tarayıcı + Node ortak). Önizleme:
  `vfx-sim.js` `uMode 6` (instanced mesh; konum `iPos + uAlign · Rz(açı) · mesh × boyut`), UPE-SL'de `v.uv` = mesh UV, `v.normalOS` = mesh normali.
  Dosya mesh'i `meshes/` (GLB/GLTF/OBJ/FBX) tarayıcıda yüklenir (`player.meshFor`), Unity eksenine çevrilir; render bekler.
- **Animasyondan yay** — MCP `fit_arc_from_animation` → `POST /api/claude/render { kind: 'vfx-fit-arc', ... }` (render kanalı; editör
  `vfx.fitArcFromAnimation` sonucu JSON metni olarak döner). Uç/tutuş: eşyanın yerel sınır kutusunun en uzun ekseninin uçları (elden uzak
  olan uç). Kareler 0,5 adımla örneklenir, efekt kökü çerçevesine (Unity) çevrilir; pencere verilmezse uç hızı tepe bölümü. `fitArc`: PCA düzlemi +
  cebirsel çember (Elarion `arc_fit.py`). Uygulanınca: position/rotation, mesh iç = tutuş yarıçapı, dış = uç × (1+outerExtend), açı, startSize 1,
  startDelay = pencere başı, ömür ≥ savuruş + 0,15 sn, `customData.x` = açılma eğrisi (uç yolunun yay kesri; UPE-SL'de `i.uv.x < i.custom.x`).
- **Bükülme** — `renderer.blend: 'distortion'`, `renderer.distortion { mode: radial|noise|normal, strength, frequency, scroll }`. Önizleme:
  `vfx.js` sahneyi (bükülme parçacıkları gizli) yarım-float bir hedefe çizer (`player.shared.uScene`), bükülme materyali o dokuyu
  `gl_FragCoord/çözünürlük + yön × maske × güç` noktasında örnekler (maske kenarında ofset 0 → dikişsiz). UPE-SL materyalinde `frag()` rg = yön, a = maske.
- **Işık** — `light { enabled, mode: single|perParticle, color, useParticleColor, intensity, radius, curve, maxLights, shadows:false }`;
  three.js PointLight havuzu (efekt kurulunca sabit sayı, kullanılmayan 0 yoğunluk). `preview.showGround` koyu zemin diski (ışığı görmek için).
- **İz** — `bladeTrail.width` (yaş eğrisi), `taper: tip|center|root`, `uvMode: stretch|tile` + `tileLength` (döşenen doku ayrı RepeatWrapping önbelleği).
- **Özel veri** — `customData { x, y, z, w }` ömür eğrileri → UPE-SL `i.custom` (`UPEInput.custom`; Unity şablonunda 0).
- **Alt emitter** — `subEmitters { enabled, items: [{ emitter, trigger: death|birth, count, inheritColor, inheritSize, inheritVelocity }] }`.
  Hedef kendi yayımını yapmaz; kaynak adımlandıktan sonra olaylar hedefe verilir (hedef sırada önceyse bir sonraki adımda). inheritColor
  yalnız RGB (ölümde ömür alfası ~0 olduğundan alfa çocuğun kendi eğrisinden). Niagara: Event Handler (UNREAL.md).
- **Yumuşak parçacık** — `renderer.softParticles { enabled, distance }`. Sahne hedefine derinlik dokusu eklendi (`player.shared.uDepth`;
  parçacıklar derinlik yazmadığı için = katı sahne); alfa × `clamp((sahne derinliği − parçacık derinliği) / distance)`. UPE-SL: `i.softFade`
  (otomatik uygulanır), `i.sceneDepth` (m).
- **Yere iz (decal)** — `renderer.mode: 'decal'`, `renderer.decal { size, projection: down|forward, groundOnly }`. Parçacık başına birim kutu,
  arka yüzleri derinlik testsiz çizilir; parça sahne derinliğinden dünya konumu kurulur (`uInvProj`, `uCamWorld`), iz yereline çevrilir, dışı
  atılır; groundOnly yansıtma yönüne bakmayan yüzeyleri (kahramanın yanları) atar. UPE-SL'de `i.uv` iz UV'si, `i.positionWS/normalWS` yüzey.
  Efektte decal varsa zemin diski kendiliğinden görünür.
- Unity dönüştürücüsü bunları henüz bilmez: mesh/decal → billboard, distortion → additive, ışık/alt emitter/özel veri/yumuşaklık yok sayılır.
- Örnekler: `vfx/_ornek_mesh_yay.json`, `_ornek_bukulme_isik.json`, `_ornek_iz_alt_emitter.json`, `_ornek_yay_animasyondan.json`,
  `_ornek_yumusak_decal.json`, `_ornek_alt_emitter.json`.
- Ertelenen: hareket bulanıklığı (stretched + velocityScale hıza göre uzatmayı zaten veriyor; gerçek
  motion blur UE post-process işi), flipbook kare karışımı (BDO kesikleri flipbook'tan çok mesh + kayan doku kullanıyor; gerekirse sonra).
