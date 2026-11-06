# Unreal Engine desteği (VFX) — sözleşme

Amaç: efekt UPE'de yapılır (aynı şema, aynı önizleme, aynı MCP araçları), sonra **Unreal'e gönder** ile UE5 projesinde
**Niagara System** olur. Unity gönderimi aynen kalır; şimdilik Unreal desteği yalnız VFX içindir.

Aşama 1: `vfx-schema.js` modülleri → Niagara modülleri, dokulu yerleşik parçacık materyalleri.
Aşama 2: UPE-SL (özel shader) materyalleri → UE Custom HLSL düğümlü materyaller (`renderer.material`).

## Yol
UPE sunucusu (Node), çalışan Unreal editörünün MCP sunucusuna (Unreal'in kendi `ModelContextProtocol` eklentisi, HTTP,
varsayılan `http://127.0.0.1:8000/mcp`) MCP istemcisi olarak bağlanır ve `NiagaraToolsets.NiagaraToolset_System` araçlarıyla
(`CreateNiagaraSystem`, `AddEmitter`, `AddModule`, `SetStackInputData`, `AddRenderer`, `SetRendererData`, …) sistemi kurar.
Editörde Python betiği ya da eklenti kurulmaz. Editör kapalıysa gönderim anlaşılır hatayla durur.

Katmanlar:
- `lib/unreal-vfx.js` — **dönüştürücü + yürütücü** (tek giriş noktası `sendVfxToUnreal`). Saf eşleme kısmı
  (`effectToNiagaraPlan(effect) → plan`) editörsüz test edilebilir; yürütme `plan`'ı MCP çağrılarına çevirir.
- `lib/unreal-mcp-client.js` — Unreal MCP'ye HTTP istemcisi (`@modelcontextprotocol/sdk` Streamable HTTP; araçlar
  `call_tool { toolset_name, tool_name, arguments }` üzerinden).
- `server.js` — `state.unreal = { project, mcpUrl, contentPath }`, `POST /api/unreal/config`, `POST /api/unreal/send-vfx`.
- `mcp.js` — `send_vfx_to_unreal { name?, all? }`, `get_unreal_info`, `set_unreal_project`.
- `public/` — sağ panelde **Unreal** bölümü (proje yolu, MCP adresi, bağlantı durumu), VFX modunda üst barda
  **⇪ Unreal'e gönder**.

## Arayüz (`lib/unreal-vfx.js`)
```js
// effects: normalizeEffect'ten geçmiş efektler; opts.texturesDir: UPE vfx/textures klasörü
export async function sendVfxToUnreal(effects, { mcpUrl, contentPath = '/Game/UPE/VFX', texturesDir, log }) {
  // → { ok, systems: [{ name, path, warnings: [] }], errors: { [efektAdı]: mesaj } }
}
export async function unrealStatus({ mcpUrl }) { /* → { connected, projectName?, engineVersion?, error? } */ }
export function effectToNiagaraPlan(effect) { /* → { name, emitters: [...], warnings: [...] } saf, editörsüz */ }
```

## Varlıklar (UE projesinde)
- Sistem: `<contentPath>/NS_<efektAdı>` (aynı adla tekrar gönderim: varlık yerinde yeniden kurulur, yolu korunur).
- Dokular: `<contentPath>/Textures/T_UPE_<doku>` (UPE `vfx/textures/<doku>.png`).
- Ortak materyaller: `/Game/UPE/Materials/M_UPE_Particle_Additive`, `M_UPE_Particle_Alpha` (doku parametresi
  `Tex`, parçacık rengi × doku; HDR yoğunluk renkten gelir); emitter başına `MI_UPE_<doku>_<blend>` örnekleri.
- Kök oynatma: sistem tek varlık; `UNiagaraComponent` / `SpawnSystemAtLocation` tüm emitter'ları oynatır.

## Birim ve eksen
Şema Unity uzayında kalır (+X sağ, +Y yukarı, +Z ileri, metre). UE: +X ileri, +Y sağ, +Z yukarı, santimetre.
İkisi de sol elli; eşleme dönme içermeyen permütasyon:
`UE = (u.z, u.x, u.y) × 100` (konum, hız, kuvvet, boyut, şekil yarıçapı). Yerçekimi çarpanı `g` → `(0, 0, −981·g)`.
Açılar derece kalır (Niagara sprite dönüşü derece). Euler (şekil dönüşü, `attach.rotation`) matrisle çevrilir.
Renk: şemadaki hex sRGB → doğrusal `LinearColor`; `renderer.intensity` rengi çarpar (HDR, bloom).

## Modül eşlemesi
Karşılığı olmayan ya da yaklaşık alanlar `warnings` olarak döner; gönderim durmaz.

Her emitter `/Niagara/DefaultAssets/Templates/Emitters/Minimal` şablonundan kurulur (EmitterState, InitializeParticle,
ParticleState, Sprite renderer). Yerleşik modülü olan davranışlar yerleşik modülle; Unity'ye özgü olanlar (şekil + doğum
yönü, sabit sürtünme, ömür boyu hız ofseti, eğriler) **Set Parameters** modüllerinde HLSL ifadesiyle `vfx-sim.js`
formülleri birebir yazılır (modül adları editörde `SetVariables_…`; sırası aşağıdaki gibi). Eğriler (renk/alfa/boyut)
curve DI yerine parçalı doğrusal HLSL ifadesidir: anahtarlar ve ara değer UPE ile aynı. Rastgeleler `rand(1.0f)`;
emitter `bDeterminism` + efekt/emitter adından tohum (aynı dizi değil, ama her oynatmada aynı).
Kendi parçacık öznitelikleri `Particles.UPE_*` (R, R2, Col0, Size0, Rot0, AngV, Frame0, SDir, SPos, CS, Root, Tip).

| Şema alanı | Niagara | Not / yaklaşıklık |
|---|---|---|
| `emitter.name` | emitter adı | ASCII'ye çevrilir (`kıvılcım` → `kivilcim`), çakışırsa `_2` |
| `emitter.enabled=false` | — | emitter eklenmez (uyarı) |
| `emitter.position/rotation` | konum/yön ifadelerine gömülür | Niagara emitter'ının kendi dönüşümü yok; şekil, hız, `local` uzaylı vektörler ve Local hizalama bu dönüşümle çevrilir |
| `main.duration`, `looping` | EmitterState: Life Cycle Mode=Self, Loop Behavior Infinite/Once, Loop Duration | |
| `main.startDelay` | EmitterState: UseLoopDelay + Loop Delay (+ Delay First Loop Only) | prewarm'lı döngüde yok sayılır (Unity gibi) |
| `main.prewarm` | Sistem `WarmupTime` = en uzun prewarm'lı emitter süresi | sistem düzeyi: tüm emitter'lar ısınır (karışıksa uyarı) |
| `main.startLifetime` | InitializeParticle.Lifetime (HLSL `lerp(min,max,rand)`) | |
| `main.startSpeed` | Spawn `UPE_Spawn`: `Particles.Velocity` = şekil yönü × hız × 100 | |
| `main.startSize` | `UPE_Init` → `Particles.UPE_Size0` (cm), `UPE_Look` → `Particles.SpriteSize` | Unity quad kenarı = Niagara SpriteSize |
| `main.startRotation` | `UPE_Rot0` → `Particles.SpriteRotation` (derece) | işaret: UE'de ekran yönü doğrulanmadı |
| `main.startColor` | `UPE_Col0` = `lerp(A,B,rand)` (sRGB, tek rastgele) | |
| `main.gravity` | GravityForce `(0,0,−981·g)`, Coordinate Space World | |
| `main.simulationSpace` | emitter `bLocalSpace` | world'de doğum konumu/hızı `Engine.Owner.SystemLocalToWorld` ile çevrilir |
| `main.maxParticles` | `AllocationMode=ManualEstimate`, `PreAllocationCount` | Niagara CPU'da kesin üst sınır değil |
| `emission.rateOverTime` | SpawnRate | |
| `emission.bursts` (time, count, cycles, interval) | her döngü için bir SpawnBurst_Instantaneous (Spawn Time, Spawn Count) | `count[min,max]` → HLSL `round(lerp)`; süre dışı döngü atlanır; en çok 16 modül |
| `shape.*` (cone, sphere, hemisphere, box, circle, edge, donut; radius, radiusThickness, angle, arc, boxSize, donutRadius, position, rotation, randomDirection) | `UPE_ShapeDir` (`UPE_SDir`), `UPE_ShapePos` (`UPE_SPos`) Unity şekil uzayında, `UPE_Spawn` → `Particles.Position/Velocity` | vfx-sim `shapeSample` ile aynı formül; ShapeLocation kullanılmaz (Unity doğum yönünü vermiyor) |
| `shape.enabled=false` | kökte, +Z (Unity) yönü | |
| `velocity.linear/orbital/radial`, `space`, `speedModifier` | SolveForcesAndVelocity'den sonra `UPE_Motion`: `Particles.Position += (lin + ω×r + radial + gürültü)·sm·dt` (+ `(sm−1)·v·dt`) | Unity gibi birikmeyen hız ofseti; merkez = emitter konumu |
| `force.force`, `space` | AccelerationForce (Coordinate Space World/Local) | `local` + emitter dönüşü: dönüş uygulanmaz (uyarı) |
| `limitVelocity.drag` | `UPE_Drag` (çözücüden önce): hız her sn `drag` m/s azalır | Unity sabit yavaşlaması, Niagara Drag (doğrusal) değil |
| `limitVelocity.limit`, `dampen` | `UPE_Limit`: sınırı aşan hız kare başına `dampen` (60 fps) kırpılır | |
| `noise.strength/frequency/scrollSpeed/octaves` | `UPE_Motion` içinde sin tabanlı 3B alan (hız ofseti) | **yaklaşık**: Curl Noise Force kuvvet biriktirir (Unity'den çok farklı sürüklenir), bu yüzden kullanılmadı; genlik/frekans/oktav aynı, desen birebir değil (uyarı) |
| `colorOverLifetime.color/alpha` | `UPE_Look` → `Particles.UPE_CS = UPE_Col0 × gradyan(NormalizedAge)`; `UPE_Color` → `Particles.Color = float4(sRGB→doğrusal(CS.rgb) × intensity, CS.a)` | Unity Linear proje gibi: çarpım sRGB'de, sonra doğrusala |
| `sizeOverLifetime.curve` | `Particles.SpriteSize = UPE_Size0 × eğri` | |
| `rotationOverLifetime.angularVelocity` | `UPE_AngV` → `SpriteRotation = Rot0 + AngV·Age` | |
| `textureSheet.tilesX/Y`, `cycles`, `randomStart` | renderer `SubImageSize`; `Particles.SubImageIndex = (floor(frac(t·cycles)·tiles) + Frame0) mod tiles` | SubUVAnimation modülü yerine (Unity formülü) |
| `bladeTrail` (from, to, lifetime, subdiv) | Ribbon renderer (FacingMode `CustomSideVector`), SpawnRate 60, `UPE_Root/UPE_Tip` dünya konumu, `Particles.Position` = şerit merkezi, `RibbonWidth` = kök–uç × boyut eğrisi | `subdiv` (Catmull-Rom) → ribbon tessellation; UV yönü yaklaşık; velocity/force/noise/rotation/textureSheet izde yok sayılır |
| `renderer.mode billboard (view)` | Sprite: Alignment Unaligned, Facing FaceCamera | |
| `renderer.alignment local` | Alignment CustomAlignment + Facing CustomFacingVector (`SpriteFacing` = emitter −Z, `SpriteAlignment` = emitter +Y) | world'de her kare sistem dönüşüyle |
| `renderer.mode stretched` | Alignment VelocityAligned; `SpriteSize.y = boyut·lengthScale + |v|·velocityScale` | hız = `Particles.Velocity` (ofset hızları hariç) |
| `renderer.mode horizontal` | Facing CustomFacingVector, `SpriteFacing` = dünya +Z | |
| `renderer.mode vertical` | Alignment CustomAlignment (`SpriteAlignment` = dünya +Z), Facing FaceCameraPosition | |
| `renderer.texture` | `T_UPE_<doku>` (`<contentPath>/Textures`, Clamp, Effects LOD grubu) → `MI_UPE_<doku>_<Additive|Alpha>` `Tex` | yoksa içe aktarılır (TextureTools.import_file); varsa dokunulmaz |
| `renderer.blend` | `M_UPE_Particle_Additive` (Additive, emissive = renk·alfa) / `M_UPE_Particle_Alpha` (Translucent, emissive = renk, opacity = alfa); Unlit, iki yüzlü | |
| `renderer.intensity` | renk çarpanı (HDR) | |
| `renderer.sortingOrder` | renderer `SortOrderHint`; alfa karışımda `SortMode=ViewDistance` | |
| `renderer.material` (UPE-SL) | `MI_UPE_<materyal>` (ribbon'da `_Ribbon`) ← `M_UPE_<shader>` (Custom HLSL) | **Aşama 2** (aşağıda); intensity 1 (renk materyalde) |
| `attach` | — | oyunda bağlanır (SpawnSystemAttached); plan `metadata.attachUE` (UE göreli konum cm) + uyarı; sisteme gömülmez |
| `renderer.mode mesh` + `renderer.mesh` (arc, cylinder, plane) | `NiagaraMeshRendererProperties` (`Meshes[0].Mesh`, `bOverrideMaterials` + `OverrideMaterials[0].ExplicitMat`, FacingMode Default); varlık `<contentPath>/Meshes/SM_UPE_<şekil>_<özet>` | geometri `public/vfx-mesh.js` (önizlemeyle aynı), `mesh.rotation` gömülü; OBJ Unity m → UE cm, **UE OBJ içe aktarıcısı Y'yi aynaladığı için y çevrilir** (Elarion `slash_arc_obj.py` ölçümü), vt Unity düzeninde (UE v'yi çevirir → materyalde sprite ile aynı `(u, 1−v)`); `exports/ue_meshes/<varlık>.obj`. Özet değişince yeni varlık, aynıysa dokunulmaz. **İçe aktarma aracı belgelenmedi**: `StaticMeshTools.import_file/import_static_mesh`, `AssetTools.import_file/import_asset`, `TextureTools.import_file` sırayla denenir; hiçbiri olmazsa hata OBJ yolunu ve elle içe aktarılacak varlık adını söyler |
| `renderer.mesh` (file) | `meshes/<dosya>`: OBJ önizlemedeki dönüşümle (three → Unity x aynası, ≥20 birim → cm) yeniden yazılır; GLB/FBX olduğu gibi | GLB/FBX ekseni/ölçeği farklı olabilir (uyarı) |
| mesh: boyut, dönüş | `Particles.Scale = boyut (m)` (OBJ cm'de); `Particles.MeshOrientation = q(emitter dönüşü) ⊗ (UE +X etrafında −açı)`; world'de `Engine.Owner.Rotation ⊗` | vfx-sim mode 6: `Rem · Rz(−θ) · mesh`; kuaterniyon cebiri plan testinde doğrulandı, editörde görsel doğrulama bekliyor |
| `renderer.blend distortion` (+ `renderer.distortion` mode/strength/frequency/scroll) | `MI_UPE_<doku>_Distort_<özet>` ← `M_UPE_Particle_Distortion` (Translucent, Unlit): Custom HLSL (önizleme `DIST_FRAG` ile aynı ofset) → `float4(ofset.x, −ofset.y, maske, 0)` → `SceneColor(OffsetFraction).rgb` → Emissive, maske → Opacity | SceneColor = arkadaki sahne (önizlemedeki sahne hedefi); Refraction/Pixel Normal Offset yerine seçildi çünkü formül önizlemeyle birebir. Önündeki saydamları bükmez |
| `renderer.material` + `distortion` | `M_UPE_<shader>_Distort` + `MI_UPE_<materyal>_Distort_<güç×1000>`: `frag()` rg = yön, a = maske; `UPE_DistortStrength` | aynı `wireDistortionOutput` |
| `customData` (x,y,z,w ömür eğrileri) | `Particles.DynamicMaterialParameter` (UPE_Look / UPE_TrailLook) → materyalde `DynamicParameter` (Param1..4) → UPE-SL `i.custom` | Unity'de `i.custom` = 0 (Custom Vertex Streams bağlanmadı) |
| `light` single | ayrı emitter `<ad>_Isik`: aynı EmitterState, 1 parçacık (SpawnBurst 0), ömür = süre, `NiagaraLightRendererProperties` (`bUseInverseSquaredFalloff` false, `DefaultExponent` 2); `Particles.Color = doğrusal renk × yoğunluk × LIGHT_K × eğri(NormalizedAge)`, `Particles.LightRadius = yarıçap cm` | parlaklık birimi yaklaşık (önizleme three.js kandela); `LIGHT_K = 1` görsel kalibrasyon bekliyor; gölge yok |
| `light` perParticle | ayrı emitter: kaynak emitter'ın adımları **aynı RandomSeed** ile kopyalanır (Niagara determinizmi → aynı parçacıklar), renk adımı yerine `UPE_Light` | doğrulanmadı; `maxLights` Niagara'da sınır değil (uyarı) |
| `bladeTrail.width`, `taper` | `RibbonWidth = uzunluk × width(yaş) × sizeOverLifetime`; `Particles.Position` = tip: `lerp(uç, kök, w/2)`, root: `lerp(kök, uç, w/2)`, center: orta | |
| `bladeTrail.uvMode tile`, `tileLength` | Ribbon `UV0Settings { DistributionMode: TiledOverRibbonLength, TilingLength: cm }` | UPE uç yolu, Niagara şerit merkezi uzunluğu (yaklaşık) |
| `subEmitters` (death / birth) | kaynak: `GenerateDeathEvent` (Particle Update) / `GenerateLocationEvent` (Particle Spawn), `bRequiresPersistentIDs`; hedef: kendi yayımı yok, `EventHandlerScriptProps = [{ ExecutionMode: SpawnedParticles, SourceEmitterID, SourceEventName: DeathEvent|LocationEvent, SpawnNumber/MinSpawnNumber (count), bRandomSpawnNumber }]` (SetEmitterData), olay betiğine `ReceiveDeathEvent`/`ReceiveLocationEvent` + `UPE_EvSpawn`: `Position = olay konumu + UPE_SOff` (spawn'da saklanan şekil ofseti), `Velocity = UPE_V0 + olay hızı × inheritVelocity`, inheritColor (yalnız Location olayı) `UPE_Col0 × saturate(olay rengi.rgb)` | Event Handler seçildi: Particle Attribute Reader ölümü göremez ve DI kurulumu ister; olaylar CPU emitter'da yerleşik ve iki tetiği de karşılar. **Doğrulanmadı**: kaynak kimliği `GetSystemSummary` alanından okunur, `EventHandlerScriptProps` SetEmitterData ile yazılır, olay betiği adı `ParticleEventScript` (+ yedekler) denenir; olmazsa efekt durmaz, uyarı elle bağlama yönergesini verir. inheritSize Niagara olay yükünde yok (uyarı); ölüm olayında renk yok |
| `renderer.softParticles` | yerleşik: `M_UPE_Particle_<Alpha|Additive>Soft` (alfa → `DepthFade(Opacity, FadeDistance)`), `MI_UPE_<doku>_<blend>Soft<cm>` `FadeDistance` = distance cm; UPE-SL: `M_UPE_<shader>…_Soft`, Custom girdisi `UPE_DF` ← DepthFade (FadeDistance ← `UPE_SoftDistance`) → `i.softFade`, çıkış alfası çarpılır | önizleme sahne derinlik dokusu, aynı doğrusal sönme. `i.sceneDepth` → SceneDepth × 0,01 (m). DepthFade girdi adları (`Opacity`/`FadeDistance`) boşluklu yedekle denenir |
| `renderer.mode decal` + `renderer.decal` (size, projection, groundOnly) | `NiagaraDecalRendererProperties`; `Particles.DecalSize = (derinlik, en, boy)/2 × boyut` cm (UE yarı boyut, X = yansıtma), `Particles.DecalOrientation`: down → yerel X = UE −Z, Y = Unity +X, Z = Unity +Z (yerel uzayda `Owner⁻¹ ⊗`, dünya aşağısı sabit), forward → emitter +Z/+X/+Y (world'de `Owner ⊗`); dönüş yerel X etrafında −açı; renk `Particles.Color` (DecalColor) | materyal `MD_DeferredDecal`: yerleşik `M_UPE_Particle_DecalAlpha` (Translucent, DefaultLit BaseColor = DecalColor × doku, Opacity) / `DecalAdditive` (AlphaComposite, Unlit emissive, Opacity 0); UPE-SL `_Decal[_Add]` (renk DecalColor'dan). groundOnly UE'de yok: karakterde **Receives Decals** kapatılmalı. Flipbook yok sayılır. UV yönü ve DecalColor bağlaması editörde doğrulanmadı |
| `duration`, `loop`, `preview.*` (efekt) | — | yalnız önizleme |

Yürütme sırası: dokular → ortak materyaller (yoksa) → MI'ler → sistem (yoksa `DefaultSystem`'den; varsa tüm emitter'lar
silinip yerinde yeniden kurulur, yol ve başvurular korunur) → emitter'lar → `GetSystemCompileState` (ilk sorgu derlemeyi
başlatır; bayat/derleniyor bitene kadar sorulur) → `save_assets` (yalnız dokunulan varlıklar) → `GetStackIssues`
uyarıları. HLSL derleme hatası efekt hatası olarak döner.

**Editörde doğrulandı (2026-11-06, UE 5.8, hafif_l1–l4):** mesh renderer (yön, konum, ölçek) önizlemeyle birebir; Light renderer;
customData → Dynamic Parameter; UPE-SL kesik/kabuk/bükülme/zerre materyalleri. Bulunan ve düzeltilen hatalar:
- Material `DynamicParameter` çıkış adları `''/G/B/A` (ilki R; görünen `Param1..4` bağlanmıyor).
- `SceneColor`'ın tek girdisi kipe göre adlanıyor (`UVs`): `InputMode = OffsetFraction` yapılıp ad editörden okunuyor.
- **Renderer bağlaması bayat:** mesh renderer'ın `Particles.Scale`/`MeshOrientation` bağlaması (`bBindingExistsOnSource`)
  AddRenderer anında önbelleğe alınıyor, derlemeden sonra çoğu kez `false` kalıyor → mesh dönüşsüz/ölçeksiz çiziliyor (yay
  yanlış yöne bakıyor). Derlemeden sonra `refreshRendererBindings`: sprite dışı renderer'da bayat bağlama varsa o özniteliği
  yazan girdi metni farklı ama anlamı aynı (parantez sarmalı) ifadeyle yeniden yazılır (aynı metin değişiklik sayılmıyor),
  derleme beklenir, yeniden bakılır (en çok 4 kez); kalırsa uyarı.
- Art arda çok aktarım editör belleğini büyütüyor (~25 GB'ta bir kez çöktü): büyük aktarımlardan sonra editörü yeniden başlat.
- Görsel doğrulama yöntemi: `--freeze` kopyası + kamerası bilinen `CaptureViewport` + hesaplanan yay noktalarını görüntüye işaretlemek.

Araçlar: `tools/ue-vfx-plan-test.mjs` (editörsüz plan testi), `tools/ue-vfx-send.mjs [--content yol] [--preset a,b] <efekt…>`
(uçtan uca gönderim), `tools/ue-vfx-capture.mjs <sistem>` (Niagara editörünü açıp editör görüntüsünü
`exports/ue_vfx/`'e yazar; `CaptureAssetImage` Niagara sistemlerini desteklemiyor), keşif: `ue-vfx-explore/show/topo/probe.mjs`.

## Aşama 2: materyaller (`lib/ue-material.js`)
Emitter'ın `renderer.material` alanı doluysa materyal `materials/<ad>.json`'dan, shader'ı `shaders/<ad>.json` ya da hazırlardan
(`public/shader-builtins.js`; server.js `resolveShader` ile aynı kural) çözülür ve UE'de kurulur. Materyal kütüphanede yoksa ya da
shader derlenmezse efekt hata ile döner (Unity gönderimi gibi). `sendVfxToUnreal(..., { materialsDir, shadersDir })` ile klasör
değiştirilebilir (varsayılan depo `materials/`, `shaders/`).

Varlıklar:
- `/Game/UPE/Shaders/M_UPE_<shader>`: shader başına bir UE Material (Unlit). URP yüzey modlu hazırlarda blend materyal değerinden
  geldiği için `M_UPE_<shader>_<Blend>[_2S]`. Gövde tek **Custom** düğümü; Custom'ın `Description`'ı çeviri özeti (`UPE <hash>`):
  aynı özetle yeniden gönderimde dokunulmaz, farklıysa grafik silinip yeniden kurulur (yol/başvurular korunur). Özet yalnız başarılı
  derlemeden sonra yazılır.
- `/Game/UPE/Materials/MI_UPE_<materyal>` (sprite) ve `MI_UPE_<materyal>_Ribbon` (ribbon; UV düzeni farklı, `UPE_Ribbon` = 1):
  parametre değerleri materyal json'undan.
- `/Game/UPE/Materials/Textures/T_UPE_<doku>`: `materials/textures/<doku>.png` (sRGB; `linear:true` özellikte SRGB kapalı, TC_Masks).

Çeviri (Custom HLSL): UPE-SL kodu Custom düğümünde yerel bir `struct UPEShader`'ın içine girer (UE Custom düğümüne global fonksiyon
yazılamaz; struct üye fonksiyonları bilinen yol). Özellikler struct üyesi, `common` yardımcıları ve `frag()` üye fonksiyon; şablon
`UPEInput`'u doldurup `S.frag(upeIn)`'i çağırır. Kullanıcı bölümlerinin önüne `#line 1 "upe_common"` / `"upe_fragment"` konur:
UE derleyici hatası `upe_fragment:12:5: error: ...` olarak gelir ve efekt hatasında `fragment satır 12:5: ...` diye döner.

| UPE-SL | UE | Not |
|---|---|---|
| `i.uv` | TexCoord0 → `(u, 1−v)` (sprite) | UE v aşağı, Unity v yukarı; flipbook karesi UE SubUV'den (kare 0 sol üst, Unity ile aynı) — debug shader'ıyla doğrulandı |
| `i.uv` (ribbon) | TexCoord0 `(u, v)` | **doğrulanmadı** (iz hareket ister); UPE: x = iz yaşı 0 baş→1 kuyruk, y = kök→uç |
| `i.color` | ParticleColor (RGBA) | Aşama 1'in `Particles.Color`'ı: doğrusal renk, alfa = ömür eğrisi |
| `i.positionWS`, `i.cameraPosWS` | WorldPosition / CameraPositionWS `.yzx × 0.01` | Unity ekseni + metre |
| `i.normalWS`, `i.viewDirWS` | VertexNormalWS / CameraVectorWS `.yzx` | yalnız kodda geçerse bağlanır |
| `i.screenUV` | ScreenPosition.ViewportUV `(x, 1−y)` | |
| `i.positionCS` | `Parameters.SvPosition` | piksel, sol üst köken (yaklaşık) |
| `i.cameraRightWS/UpWS` | `ResolvedView.ViewToTranslatedWorld[0/1]` `.yzx` | |
| `i.time`, `_Time` | Time | `_Time = (t/20, t, 2t, 3t)` |
| `i.facing` | TwoSidedSign | |
| `i.lightDir/lightColor/shadow/ambient` | sabit (yukarıdan beyaz, gölge 1, ortam 0) | Unlit; Lit/Toon hazırları yaklaşık (uyarı) |
| float/range/toggle | ScalarParameter (toggle 0/1) | |
| color | VectorParameter (RGBA çıkışı), değer sRGB → doğrusal | Unity Linear proje gibi; alfa çevrilmez |
| hdrColor | VectorParameter = doğrusal(renk) × intensity | |
| vector | VectorParameter | MI aracı negatif bileşeni kabul etmeyebilir → 0'a kırpılır (uyarı) |
| texture | TextureObjectParameter `<ad>` + Custom'da `<ad>Sampler`; `<ad>_ST` VectorParameter | white/black/gray/bump → motor dokuları; `@mesh` → white (uyarı) |
| `SAMPLE(t, uv)` / `SAMPLE_LOD` | `Texture2DSample(t, tSampler, UPE_FlipV(uv))` / `Texture2DSampleLevel` | iç içe çağrılar çevrilir |
| `TRANSFORM_TEX(uv, t)` | `((uv) * t_ST.xy + t_ST.zw)` | |
| `splat2/3/4`, `clip`, `ddx/ddy`, `#define` | aynen (struct üyesi / HLSL yerlisi) | |

Render durumu (`renderState`, URP hazırlarında `_Surface/_Blend/_Cull`):

| UPE | UE BlendMode | Çıkış |
|---|---|---|
| alpha (SrcAlpha, 1−SrcAlpha) | Translucent | Emissive = rgb, Opacity = a |
| additive (SrcAlpha, One) | Additive | Emissive = rgb × a |
| premultiply (One, 1−SrcAlpha) | AlphaComposite | Emissive = rgb, Opacity = a |
| multiply (DstColor, Zero) | Modulate | Emissive = rgb |
| opaque (+ `clip` varsa Masked) | Opaque / Masked | Emissive = rgb (kesme Custom'daki clip ile) |

`cull off` → TwoSided, `back` → tek yüz, `front` → iki yüzlü (uyarı). `ztest always` → saydamda DisableDepthTest. zwrite/queue yok sayılır.
Her ana materyal `bUsedWithNiagaraSprites`, `bUsedWithNiagaraRibbons`.

Desteklenmeyen / yaklaşık: `code.vertex` (vert; World Position Offset karşılığı yok, uyarı), outline pass, ışık girdileri (Unlit),
`static const` (struct üyesi olarak derlenir), ribbon UV yönü (görsel doğrulama bekliyor).

Hazır shader'lar: hepsi aynı Custom yoluyla UPE-SL'den çevrilir (URP Particles/Unlit ve Unlit birebir, blend materyal değerinden;
Lit ve ToonCharacter ışıksız yaklaşık + uyarı). Aşama 1 ortak materyali kullanılmaz: `_BaseColor` ve `_ST` de taşınsın diye.

Araçlar: `tools/ue-vfx-plan-test.mjs` tüm `shaders/*.json` + hazırları (URP yüzey varyantlarıyla) çevirip yapısal denetler
(çevrilmemiş SAMPLE/TRANSFORM_TEX, parantez dengesi, eksik girdi) ve tüm `materials/*.json`'u planlar; gerçek derleme editörde.
`tools/ue-vfx-send.mjs` görsel kontrol seçenekleri: `--freeze T` (efektin T. saniyedeki hâli donmuş; arka planda editör çok yavaş
tick'lediği ve burst'ler güvenilir yakalanmadığı için), `--nomat` (Aşama 1 materyaliyle karşılaştırma), `--mat <ad>`
(materyali değiştir), `--materials/--shaders <klasör>` (test kütüphanesi); bunlar `/Game/UPE/VFX_Test`'e gider.
`tools/ue-vfx-cap.mjs [--dir x,y,z] [--target x,y,z] [--dist cm] [--times ..] <NS>`: Simulate'te sahneye geçici koyup
`exports/ue_vfx/cap_<tag>_<t>.png` yazar (harita kaydedilmez, aktör kaldırılır).
Not: yeni bir materyal ilk gönderimde arka planda Niagara köşe fabrikaları için derlenir; birkaç saniye görünmeyebilir.
