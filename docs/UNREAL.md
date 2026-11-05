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
| `renderer.material` (UPE-SL) | — | **Aşama 2**; şimdilik doku + blend yerleşik materyalle, intensity 1 (uyarı) |
| `attach` | — | oyunda bağlanır (SpawnSystemAttached); plan `metadata.attachUE` (UE göreli konum cm) + uyarı; sisteme gömülmez |
| `duration`, `loop`, `preview.*` (efekt) | — | yalnız önizleme |

Yürütme sırası: dokular → ortak materyaller (yoksa) → MI'ler → sistem (yoksa `DefaultSystem`'den; varsa tüm emitter'lar
silinip yerinde yeniden kurulur, yol ve başvurular korunur) → emitter'lar → `GetSystemCompileState` (ilk sorgu derlemeyi
başlatır; bayat/derleniyor bitene kadar sorulur) → `save_assets` (yalnız dokunulan varlıklar) → `GetStackIssues`
uyarıları. HLSL derleme hatası efekt hatası olarak döner.

Araçlar: `tools/ue-vfx-plan-test.mjs` (editörsüz plan testi), `tools/ue-vfx-send.mjs [--content yol] [--preset a,b] <efekt…>`
(uçtan uca gönderim), `tools/ue-vfx-capture.mjs <sistem>` (Niagara editörünü açıp editör görüntüsünü
`exports/ue_vfx/`'e yazar; `CaptureAssetImage` Niagara sistemlerini desteklemiyor), keşif: `ue-vfx-explore/show/topo/probe.mjs`.
