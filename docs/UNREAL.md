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
Tablo `lib/unreal-vfx.js` yazılırken doldurulur (her satır: şema alanı → Niagara modülü/girdisi → not/yaklaşıklık).
Karşılığı olmayan ya da yaklaşık alanlar `warnings` olarak döner; gönderim durmaz.
