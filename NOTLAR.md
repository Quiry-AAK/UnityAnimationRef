# Anim Ref – Çalıştırma ve Kullanım Notları

## Çalıştırma
- `npm install` (ilk kez) → `npm start` → http://localhost:5177
- MCP (Claude) çalışırken editör sunucusu otomatik başlar; elle `npm start` gerekmez. Port doluysa (`5177`) sunucu zaten çalışıyordur. Port değiştirmek için `ANIMREF_PORT` ortam değişkeni.
- Editörü tarayıcıda açık tut: `render_frame` ve `export_gif` gibi MCP araçları tarayıcıdan render alır.
- Kod değişince (özellikle `server.js`, `mcp.js`) sunucuyu durdurup yeniden başlat; sadece `public/` dosyaları için sayfayı yenilemek yeter.
- Windows'ta sunucuyu durdurmak: `Get-NetTCPConnection -LocalPort 5177 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`

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
- **Unity importer** karakteri bind/T-pose'ta bekler (rest pozu hedeften okur). Humanoid avatar varsa kareleri muscle eğrilerine çevirir, yoksa Transform eğrileri yazar. X ekseni aynalanır (sağ-el → sol-el). `props` bilgisi JSON'da var ama importer eşya oluşturmaz. **Unity tarafı henüz gerçek projede test edilmedi.**
- Veri klasörleri: `models/` (karakter), `animations/` (kütüphane: json düzenlenebilir, fbx ham), `props/` (eşya), `exports/` (çıktı). `project.json` son oturumun durumunu tutar (repoda yok).
- Mixamo FBX'leri repoda yok (yeniden dağıtım); yeni kurulumda `models/` içine tekrar koy.

## Sorun giderme
- Sayfa donuyor / boş: tarayıcı konsolunu kontrol et; model yüklenirken hata olduysa `project.json` içindeki `modelName`'i silip yenile.
- "Editör tarayıcıda açık değil" hatası: http://localhost:5177 sekmesini aç.
- Eşya görünmüyor: kemik arkasında kalmış olabilir; eşyayı listeden seç, W/E ile sahnede oynat ya da `update_prop` ile `position/rotation` ver.
