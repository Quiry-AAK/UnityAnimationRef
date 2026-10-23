# Unity Preview Editor (eski Anim Ref) – Çalıştırma ve Kullanım Notları

## Çalıştırma
- `npm install` (ilk kez) → `npm start` → http://localhost:5177
- MCP (Claude) çalışırken editör sunucusu otomatik başlar; elle `npm start` gerekmez. Port doluysa (`5177`) sunucu zaten çalışıyordur. Port değiştirmek için `UPE_PORT` ortam değişkeni (eski adı `ANIMREF_PORT` da geçer).
- Editörü tarayıcıda açık tut: `render_frame` ve `export_gif` gibi MCP araçları tarayıcıdan render alır.
- Kod değişince (özellikle `server.js`, `mcp.js`) sunucuyu durdurup yeniden başlat; sadece `public/` dosyaları için sayfayı yenilemek yeter.
- Windows'ta sunucuyu durdurmak: `Get-NetTCPConnection -LocalPort 5177 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`

## Unity'ye tek tıkla gönderme (önerilen)
1. Sağ panel → **Unity**: Unity proje klasörünü yaz (içinde `Assets` ve `ProjectSettings` olan klasör), karakteri seç (Unity'deki Y Bot FBX/prefab'ı; adı eşleşiyorsa otomatik seçilir), **Kaydet**. Importer scriptleri projeye `Assets/Editor/AnimRef/` altına kendiliğinden kurulur ve her gönderimde güncellenir.
2. **Dışa aktar → Unity'ye gönder** (ya da sağ paneldeki buton / MCP `send_to_unity`). Animasyon `Assets/AnimRef/` içine yazılır, Unity kendisi `Assets/AnimRef/Clips/<ad>.anim` üretir (Unity odakta olmasa da birkaç saniye içinde; kapalıysa açılınca).
3. Mod **Otomatik**: karakter Humanoid ise Humanoid, değilse Generic. Mod seçmen gerekmez.
4. Eşyalar (silah) için Unity'de Tools > Anim Ref > Import penceresindeki "Eşyaları karaktere ekle" kullanılır.

## Tipik akış
1. Mixamo'dan karakteri **FBX, T-pose** olarak indir → `models/` klasörüne at (ya da editöre sürükle). Mixamo'dan animasyon indirirsen (FBX) editöre sürükle: kareler düzenlenebilir key'lere çevrilir ve kütüphaneye kaydolur.
2. Editörde kemiği seç (viewport'taki mavi nokta ya da ☰ Kemikler), döndür/taşı, **◆ Key** ile key koy. Küçük düzeltmeler için "Tüm kareleri etkile" işaretle.
3. Claude'a söylemek zor olan şeyi editörde elle düzelt → "düzelttim" de → Claude `get_user_edits` ile farkı okur. Sağ panelde "Claude'a not" kutusu da var.
4. Bitince: **Dışa aktar → GIF** ya da **Unity için kaydet** (`exports/*.animref.json`).
5. Unity: `unity/AnimRefImporter.cs` → `Assets/Editor/` → Tools > Anim Ref > Import (JSON + T-pose'ta karakter seç).

## VFX modu
Üst bardaki **Animasyon | VFX** anahtarıyla geçilir (Claude bir efekt gönderince editör kendisi VFX'e geçer).
- **Sol panel:** efekt adı, emitter (katman) listesi — aç/kapat, çoğalt, sırala, sil; **+ Emitter** menüsünde boş emitter ve hazır
  şablonlar (kıvılcım, kor, alev, duman, parlama, şok dalgası, hale, kılıç kesiği).
- **Sağ panel:** Efekt ayarları (önizleme süresi, döngü, kemiğe/eşyaya bağlama, animasyonla birlikte oynatma + başlangıç karesi,
  bloom, arka plan, kahraman/ızgara), seçili emitter'ın Unity modülleri (Ana, Yayım, Şekil, Ömür boyu hız, Kuvvet, Hız sınırı,
  Gürültü, Ömür boyu renk/boyut/dönüş, Doku karesi, Görünüm). Modül başlığındaki ●/○ modülü açar/kapatır.
  Sayı etiketini basılı tutup sağa-sola sürüklemek değeri değiştirir (Shift hızlı, Alt ince). Eğri: sürükle / çift tık ekle / sağ tık sil.
- **Alt çubuk:** baştan, oynat/durdur, zaman çubuğu, hız (0.1×–2×), ◎ kamerayı efekte odakla, parçacık sayısı.
- Simülasyon Unity ParticleSystem'i taklit eder, sabit adımlı ve tohumludur: aynı efekt aynı anda hep aynı görünür (Claude'un
  `render_vfx` kontak sayfası ile kullanıcının gördüğü aynıdır). Unity'de birebir değil ama yakındır (gürültü alanı, drag/dampen
  formülleri yaklaşık). Değerler Unity koordinatlarında (+Z ileri, +Y yukarı), metre/saniye/derece.
- Kullanıcı değer değiştirince Claude `get_vfx_user_edits` ile farkı okur (yol bazında `from → to`); "Claude'a not" kutusu da var.
- **Unity'ye gönder** (üst bar ya da sağ panel → Unity): efekt `Assets/UnityPreview/VFX/<ad>.vfx.json` + dokular `Textures/` olarak
  yazılır, Unity (açıksa birkaç saniyede) `Assets/UnityPreview/VFX/<ad>.prefab` ve `Materials/` üretir. Kök objede `Play()` tüm
  katmanları oynatır. Unity kapalıyken: `-executeMethod UnityPreviewVfxImporter.ProcessPending`. Aynı adla tekrar gönderim prefab'ı
  yerinde günceller (GUID korunur). Malzeme: URP Particles/Unlit, additive/alpha, `_BaseColor` = intensity (HDR, bloom).
- Dokular `vfx/textures/*.png` (beyaz + alfa; renk parçacıktan gelir). Yerleşikleri yeniden üretmek: `npm run textures`.
  Özel doku: sağ panel → Görünüm → PNG yükle.
- Kısayollar (VFX): Space oynat · Home baştan · ←/→ ±0.05 sn · Ctrl+Z / Ctrl+Y · B/P paneller.
- MCP uçtan uca testi: `npm run smoke` (5291 portunda kendi sunucusunu açar, tarayıcı gerektirmez).

## Materyal ve Shader modları
- **Materyal:** solda materyal adı, **+ Materyal** (shader seçerek yeni), kütüphane. Sağda shader seçimi, shader'ın özellikleri
  (renk, HDR renk × yoğunluk, kaydırıcılar, vektör, doku + tiling/offset + PNG yükleme), **Giydir** (kahramana/eşyaya; tüm modlarda,
  animasyon ve VFX önizlemesinde de görünür), **Işık** (tüm UPE shader'ları için ortak yönlü ışık + ortam), **Önizleme** (küre, küp,
  düzlem, kapsül, simit, kahraman, eşyalar; bloom, döner tabla, arka plan), kütüphane, Unity, Claude'a not. F: kamerayı nesneye odakla.
- **Shader:** solda shader listesi (hazır portlar salt okunur, "Özel kopya oluştur" ile düzenlenebilir), **+ Shader** şablonları (unlit,
  toon, fresnel kalkan, dissolve, kayan doku). Altta kod paneli (Fragment / Vertex / Ortak / Outline sekmeleri) ve derleme günlüğü:
  hata satırına tıklayınca o satır seçilir. Sağda önizleme değerleri, özellik tanımları, render durumu (karışım, cull, ztest, kuyruk,
  zwrite, gölge, outline), ışık, kütüphane, "Unity'de derle".
- **UPE-SL:** Unity HLSL alt kümesi; kurallar `public/shader-schema.js` → `SHADER_REFERENCE` (MCP `material_reference`). Unity'de kod
  aynen URP şablonuna girer (`UnityPreview/<ad>`, forward + outline + gölge + derinlik pass'leri); editörde GLSL ES 3.0'a çevrilir.
  Dünya girdileri (konum, normal, ışık, kamera) Unity ekseninde gelir, iki tarafta da aynı sonucu verir. Önizlemede gölge yok (shadow = 1).
- **Hazır shader'lar** mevcut Unity shader'larının portudur: `Elarion/ToonCharacter` (oyunun kahraman shader'ı, birebir), URP Lit
  (yaklaşık PBR; yansıma ortam rengiyle taklit), Unlit, Particles/Unlit. Bunları kullanan materyal Unity'de o shader'ı kullanır.
- **Unity'ye:** materyal `Assets/UnityPreview/Materials/<ad>.mat` (+ `Textures/`), özel shader `Assets/UnityPreview/Shaders/<ad>.shader`.
  Unity kapalıyken `-executeMethod UnityPreviewMaterialImporter.ProcessPending`. Shader derleme hataları `send_*` yanıtında döner.
  '@mesh' dokusu yalnız önizlemedir; Unity'de kullanılacak dokuyu `unityPath` ile ver.
- Dokular `materials/textures/*.png`; yerleşikleri yeniden üretmek: `node tools/gen-material-textures.mjs`.

## Kısayollar
Space oynat · ←/→ kare · K key koy/sil · E döndür · W taşı · B kemik paneli · P ayar paneli · Ctrl+Z / Ctrl+Y

## Önemli teknik notlar
- **Animasyon kemik adlarına bağlı**, karaktere değil: aynı Mixamo kemik adlarına sahip her karakterde çalışır. Karakter değişince animasyon ve eşyalar korunur.
- **Mixamo kemik eksenleri dünya eksenine hizalı değil.** `tools/run-cycle.mjs` poz verirken dünya eksenlerinde (+Z ileri, +X karakterin solu, +Y yukarı) tanımlayıp FK ile local'e çevirir. `set_keys` ise parent-uzayı euler ile çalışır; "offset" modu rest poza göre sapma vermenin en kolay yoludur.
- **Y Bot FBX'inde her kemiğin aynı isimli bir "skin" kopyası var** (three.js FBXLoader üretiyor). Kod, ebeveyniyle aynı adı taşıyan kemikleri atlar; yoksa liste sonsuz döngüye girer.
- **Eşyalar** kemiğin REST (T-pose) dünya yönelimine göre konumlanır. Eşya modelinde +Z = ileri (namlu), +Y = yukarı, orijin = tutma noktası. Varsayılan el rotasyonu: sağ el `[0,0,-90]`, sol el `[0,0,90]`. Dosya eşyaları 1 metreye normalize edilir (varsayılan ölçek 0.3).
- **Unity importer** (Unity 6000.0.58f1 + Y Bot ile test edildi): karakteri bind/T-pose'ta bekler (rest pozu hedeften okur), X ekseni aynalanır (sağ-el → sol-el).
  - **Generic** mod: Transform eğrileri yazar; gerçek Animator'da kemik konumları editörle birebir (mm düzeyi) çıktı. Animator'ın avatarı **Generic/None** olmalı (Humanoid avatarlı Animator transform eğrilerini yok sayar).
  - **Humanoid** mod: kareleri HumanPoseHandler ile muscle eğrilerine bake eder. Humanoid kas limitleri yüzünden yaklaşık sonuç verir (el/ayak ~1–4 cm sapma, kalça yüksekliği birkaç cm). Humanoid karakterde bunu kullan.
  - Eşyalar: Window'daki "Eşyaları karaktere ekle" (ya da `AnimRefImporter.AddProps`) JSON'daki `props`'u kemiklere takar. `builtin:*` eşyalar primitiflerle üretilir; dosya eşyaları projedeki aynı adlı prefab/model ile eşleşir (yoksa küp yer tutucu). Karakter T-pose'ta ve sahnede olmalı.
  - Batch/`-nographics` testlerinde Animator'ı `cullingMode = AlwaysAnimate` yap; yoksa FBX'in varsayılan "Based On Renderers" ayarı yüzünden poz hiç güncellenmez (yanlış hata gibi görünür).
- Veri klasörleri: `models/` (karakter), `animations/` (kütüphane: json düzenlenebilir, fbx ham), `props/` (eşya), `exports/` (çıktı). `project.json` son oturumun durumunu tutar (repoda yok).
- Mixamo FBX'leri repoda yok (yeniden dağıtım); yeni kurulumda `models/` içine tekrar koy.

## Sorun giderme
- Sayfa donuyor / boş: tarayıcı konsolunu kontrol et; model yüklenirken hata olduysa `project.json` içindeki `modelName`'i silip yenile.
- "Editör tarayıcıda açık değil" hatası: http://localhost:5177 sekmesini aç.
- Eşya görünmüyor: kemik arkasında kalmış olabilir; eşyayı listeden seç, W/E ile sahnede oynat ya da `update_prop` ile `position/rotation` ver.
