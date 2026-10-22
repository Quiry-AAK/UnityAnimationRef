# Anim Ref – Çalıştırma ve Kullanım Notları

## Çalıştırma
- `npm install` (ilk kez) → `npm start` → http://localhost:5177
- MCP (Claude) çalışırken editör sunucusu otomatik başlar; elle `npm start` gerekmez. Port doluysa (`5177`) sunucu zaten çalışıyordur. Port değiştirmek için `ANIMREF_PORT` ortam değişkeni.
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
