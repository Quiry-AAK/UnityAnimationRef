// Unity Preview Editor (eski adı Anim Ref) -> Unity VFX aktarımı.
// Editör "Unity'ye gönder" dediğinde Assets/UnityPreview/VFX/<ad>.vfx.json yazılır (public/vfx-schema.js
// normalizeEffect çıktısı, tüm alanlar dolu); bu script onu ParticleSystem prefab'ına çevirir:
//   Assets/UnityPreview/VFX/<ad>.prefab
//   Assets/UnityPreview/VFX/Materials/<ad>__<emitter>.mat   (dokular: Textures/<doku>.png, sunucu kopyalar)
// renderer.material dolu emitter'lar kendi .mat'ını üretmez, kütüphane materyalini bağlar:
//   Assets/UnityPreview/Materials/<materyal>.mat   (sunucu efektle birlikte yazar; UnityPreviewMaterialImporter üretir)
// Kök: efekt adında GameObject + emisyonsuz, renderer'ı kapalı ParticleSystem (kökte Play() tüm çocukları oynatır).
// Her emitter bir çocuk GameObject + ParticleSystem; modüller VFX_REFERENCE'taki alanlarla birebir.
// Tekrar aktarımda prefab ve malzemeler yerinde güncellenir (GUID'ler korunur, oyundaki referanslar kopmaz).
// Unity açıkken ~1.5 sn'de bir yeni gönderimleri yakalar; Unity kapalıyken gönderilenler açılınca işlenir.
// Batchmode: -executeMethod UnityPreviewVfxImporter.ProcessPending
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

[InitializeOnLoad]
public static class UnityPreviewVfxImporter
{
    const string Dir = "Assets/UnityPreview/VFX";
    const string TexDir = Dir + "/Textures";
    const string MatDir = Dir + "/Materials";
    const string Ext = ".vfx.json";
    const string Format = "upe-vfx-1";
    const string Tag = "UnityPreview VFX: ";
    const string UrpShader = "Universal Render Pipeline/Particles/Unlit";
    const string BuiltinShader = "Particles/Standard Unlit";
    const string LibMatDir = "Assets/UnityPreview/Materials"; // kütüphane materyalleri (UnityPreviewMaterialImporter)
    const double MaterialWaitSeconds = 60; // materyal .mat'ı henüz üretilmediyse efekt en çok bu kadar bekletilir

    static double nextPoll;
    static bool busy;
    // Hatalı json'lar her poll'da yeniden denenip log'u doldurmasın: dosya değişene dek atlanır
    static readonly Dictionary<string, DateTime> failed = new Dictionary<string, DateTime>();

    static UnityPreviewVfxImporter()
    {
        if (Application.isBatchMode) return; // batchmode'da -executeMethod ile açıkça çağrılır
        EditorApplication.delayCall += Tick;
        EditorApplication.update += Poll; // Unity arka plandayken de (odak olmasa da) yeni gönderimleri yakalar
    }

    static void Poll()
    {
        if (busy || EditorApplication.timeSinceStartup < nextPoll) return;
        nextPoll = EditorApplication.timeSinceStartup + 1.5;
        if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return; // oyun modunda (ör. PlayMode testleri) prefab yazma
        Tick();
    }

    static void Tick()
    {
        try { ProcessPending(); }
        catch (Exception e) { Debug.LogError(Tag + e); }
    }

    // ───────────────────────────── bekleyenler

    [MenuItem("Tools/Unity Preview/Process pending VFX")]
    public static void ProcessPending()
    {
        if (busy) return;
        busy = true;
        try
        {
            var pending = FindPending();
            if (pending.Count == 0) return;
            ProcessMaterialsFirst(); // emitter'ların bağladığı kütüphane materyalleri önce üretilsin
            // Dosyalar dışarıdan (sunucu) yazıldı: dokular, klasörler AssetDatabase'e girsin
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var lines = new List<string>();
            foreach (var json in pending)
            {
                string name = BaseName(json);
                if (WaitingForMaterial(json)) continue; // materyal importer'ı henüz .mat üretmedi: sonraki poll'da tekrar
                try
                {
                    string prefab = Import(json);
                    failed.Remove(json);
                    lines.Add(name + "|OK|" + prefab);
                    Debug.Log(Tag + name + " → " + prefab);
                }
                catch (Exception e)
                {
                    if (File.Exists(json)) failed[json] = File.GetLastWriteTimeUtc(json);
                    lines.Add(name + "|ERROR|" + OneLine(e.Message));
                    Debug.LogError(Tag + name + ": " + e.Message + "\n" + e.StackTrace);
                }
            }
            if (lines.Count > 0 && Directory.Exists(Dir)) File.WriteAllText(Dir + "/last_status.txt", string.Join("\n", lines));
        }
        finally { busy = false; }
    }

    // UnityPreviewMaterialImporter kuruluysa bekleyen materyalleri işlet (yansıma: materyal script'i olmayan projede de derlenir)
    static void ProcessMaterialsFirst()
    {
        foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
        {
            var t = asm.GetType("UnityPreviewMaterialImporter");
            if (t == null) continue;
            try { t.GetMethod("ProcessPending", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)?.Invoke(null, null); }
            catch (Exception e) { Debug.LogWarning(Tag + "materyal importer'ı çalıştırılamadı: " + (e.InnerException ?? e).Message); }
            return;
        }
    }

    // efektin bağladığı bir materyalin .mat'ı yok ama .mat.json'u yeni yazılmışsa (materyal importer'ı sırada) bekle;
    // batchmode'da ya da süre dolunca beklemez — Import eksik materyali anlaşılır hatayla bildirir
    static bool WaitingForMaterial(string json)
    {
        if (Application.isBatchMode) return false;
        Dictionary<string, object> fx;
        try { fx = Json.Parse(File.ReadAllText(json, Encoding.UTF8)) as Dictionary<string, object>; } catch { return false; }
        foreach (var o in Arr(fx, "emitters"))
        {
            string m = Str(Obj(o as Dictionary<string, object>, "renderer"), "material", "").Trim();
            if (m.Length == 0 || File.Exists(LibMatDir + "/" + m + ".mat")) continue;
            string mj = LibMatDir + "/" + m + ".mat.json";
            if (File.Exists(mj) && (DateTime.UtcNow - File.GetLastWriteTimeUtc(mj)).TotalSeconds < MaterialWaitSeconds)
            {
                if (waitLogged.Add(json + "|" + m)) Debug.Log(Tag + BaseName(json) + ": materyal bekleniyor (" + m + ".mat henüz üretilmedi)");
                return true;
            }
        }
        return false;
    }
    static readonly HashSet<string> waitLogged = new HashSet<string>(); // bekleme mesajı efekt+materyal başına bir kez

    static Material LoadLibraryMaterial(string matName, string emitter)
    {
        string path = LibMatDir + "/" + matName + ".mat";
        var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (mat == null)
            throw new Exception(emitter + ".renderer.material: " + path + " yok — materyal Unity'de üretilemedi (" + LibMatDir
                + "/last_status.txt'ye bak) ya da kütüphanede yok; editörde kaydedip efekti yeniden gönder");
        return mat;
    }

    // prefab'ı olmayan ya da json'u prefab'dan yeni olanlar
    static List<string> FindPending()
    {
        var list = new List<string>();
        if (!Directory.Exists(Dir)) return list;
        foreach (var f in Directory.GetFiles(Dir, "*" + Ext))
        {
            string json = f.Replace('\\', '/');
            if (!json.EndsWith(Ext, StringComparison.OrdinalIgnoreCase)) continue;
            var jt = File.GetLastWriteTimeUtc(json);
            string prefab = Dir + "/" + BaseName(json) + ".prefab";
            if (File.Exists(prefab) && File.GetLastWriteTimeUtc(prefab) >= jt) continue;
            if (failed.TryGetValue(json, out var ft) && ft == jt) continue;
            // Sunucu json'dan hemen sonra dokuları kopyalıyor: yeni yazılmış dosyayı bir sonraki poll'a bırak
            double age = (DateTime.UtcNow - jt).TotalSeconds;
            if (!Application.isBatchMode && age >= 0 && age < 0.5) continue;
            list.Add(json);
        }
        list.Sort(StringComparer.Ordinal);
        return list;
    }

    // ───────────────────────────── içe aktarma

    // jsonPath: <ad>.vfx.json (Assets altında ya da mutlak). Dönen: Assets/UnityPreview/VFX/<ad>.prefab
    public static string Import(string jsonPath)
    {
        jsonPath = jsonPath.Replace('\\', '/');
        if (!File.Exists(jsonPath)) throw new FileNotFoundException("JSON bulunamadı: " + jsonPath);
        var fx = Json.Parse(File.ReadAllText(jsonPath, Encoding.UTF8)) as Dictionary<string, object>;
        if (fx == null) throw new Exception("JSON kökü bir nesne değil");
        string format = Str(fx, "format", Format);
        if (format != Format) Debug.LogWarning(Tag + "beklenmeyen format '" + format + "' (" + Format + " bekleniyordu), yine de deneniyor");

        string fileName = BaseName(jsonPath);
        string fxName = Str(fx, "name", fileName).Trim();
        if (fxName.Length == 0) fxName = fileName;
        string prefabPath = Dir + "/" + fileName + ".prefab";
        EnsureFolder(Dir);
        EnsureFolder(MatDir);

        var emitters = Arr(fx, "emitters");
        var matPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase); // aynı efektte malzeme adı çakışmasın

        GameObject root = null;
        bool loaded = false;
        Scene temp = default;
        if (File.Exists(prefabPath))
        {
            // Mevcut prefab'ı yerinde güncelle: kök ve aynı adlı çocuklar yeniden kullanılır (fileID'ler de korunur)
            try { root = PrefabUtility.LoadPrefabContents(prefabPath); loaded = true; }
            catch (Exception e) { Debug.LogWarning(Tag + "mevcut prefab açılamadı, yeniden kuruluyor: " + e.Message); }
        }
        if (root == null)
        {
            // Yeni prefab: geçici kök kullanıcının sahnesine değil önizleme sahnesine kurulur (sahne "kirli" olmasın)
            temp = EditorSceneManager.NewPreviewScene();
            root = NewObject(fxName, null, temp);
        }
        try
        {
            root.name = fxName;
            ConfigureRoot(root, Num(fx, "duration", 2f));

            var old = new List<Transform>();
            foreach (Transform c in root.transform) old.Add(c);
            var used = new HashSet<Transform>();
            int index = 0;
            for (int i = 0; i < emitters.Count; i++)
            {
                var em = emitters[i] as Dictionary<string, object>;
                if (em == null) { Debug.LogWarning(Tag + fileName + ": " + (i + 1) + ". emitter nesne değil, atlandı"); continue; }
                string emName = Str(em, "name", "emitter" + (i + 1)).Trim();
                if (emName.Length == 0) emName = "emitter" + (i + 1);
                Transform child = old.Find(t => t != null && !used.Contains(t) && t.name == emName);
                if (child == null) child = NewObject(emName, root.transform, default).transform;
                used.Add(child);
                child.SetSiblingIndex(index++);
                BuildEmitter(child.gameObject, em, fileName, matPaths);
            }
            foreach (var t in old) if (t != null && !used.Contains(t)) Object.DestroyImmediate(t.gameObject);

            AssetDatabase.SaveAssets(); // malzeme değişiklikleri diske
            PrefabUtility.SaveAsPrefabAsset(root, prefabPath, out bool ok);
            if (!ok) throw new Exception("Prefab kaydedilemedi: " + prefabPath);
            // kaldırılan/yeniden adlandırılan emitter'lardan kalan <efekt>__*.mat dosyaları silinir
            if (Directory.Exists(MatDir))
                foreach (var f in Directory.GetFiles(MatDir, SafeFile(fileName) + "__*.mat"))
                { string ap = f.Replace('\\', '/'); if (!matPaths.Contains(ap)) AssetDatabase.DeleteAsset(ap); }
        }
        finally
        {
            if (loaded) PrefabUtility.UnloadPrefabContents(root);
            else Object.DestroyImmediate(root);
            if (temp.IsValid()) EditorSceneManager.ClosePreviewScene(temp);
        }
        // Sunucu prefab mtime'ına bakıyor; içerik aynı olsa da "yeni aktarıldı" görünsün
        File.SetLastWriteTimeUtc(prefabPath, DateTime.UtcNow);
        return prefabPath;
    }

    static void ConfigureRoot(GameObject root, float duration)
    {
        root.transform.localScale = Vector3.one;
        var ps = GetOrAdd<ParticleSystem>(root);
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
        var main = ps.main;
        main.duration = Mathf.Clamp(duration, 0.05f, 100000f);
        main.loop = false;
        main.prewarm = false;
        main.startDelay = 0f;
        main.playOnAwake = true;
        main.scalingMode = ParticleSystemScalingMode.Hierarchy;
        var emission = ps.emission;
        emission.enabled = false;
        emission.rateOverTime = 0f;
        emission.SetBursts(new ParticleSystem.Burst[0]);
        var shape = ps.shape;
        shape.enabled = false;
        var r = GetOrAdd<ParticleSystemRenderer>(root);
        r.enabled = false;
    }

    static void BuildEmitter(GameObject go, Dictionary<string, object> em, string fxFile, HashSet<string> matPaths)
    {
        string name = go.name;
        go.transform.localPosition = V3(em, "position", Vector3.zero);
        go.transform.localRotation = Quaternion.Euler(V3(em, "rotation", Vector3.zero)); // veri zaten Unity koordinatlarında
        go.transform.localScale = Vector3.one;

        var ps = GetOrAdd<ParticleSystem>(go);
        var pr = GetOrAdd<ParticleSystemRenderer>(go);
        ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear); // süre yalnız dururken değiştirilebilir

        // ── main
        var m = Obj(em, "main");
        var main = ps.main;
        main.duration = Mathf.Clamp(Num(m, "duration", 2f), 0.05f, 100000f);
        bool loop = Bool(m, "looping", true);
        main.loop = loop;
        main.prewarm = loop && Bool(m, "prewarm", false); // Unity prewarm'ı yalnız döngülü sistemde kullanır
        main.startDelay = Mathf.Max(0f, Num(m, "startDelay", 0f));
        main.startLifetime = Curve(Range(m, "startLifetime", 1f, 1.5f));
        main.startSpeed = Curve(Range(m, "startSpeed", 1f, 2f));
        main.startSize3D = false;
        main.startSize = Curve(Range(m, "startSize", 0.1f, 0.2f));
        main.startRotation3D = false;
        main.startRotation = Curve(Range(m, "startRotation", 0f, 0f) * Mathf.Deg2Rad); // derece → radyan
        main.flipRotation = 0f;
        var cols = Arr(m, "startColor");
        Color ca = ParseColor(cols.Count > 0 ? cols[0] : null, Color.white, name + ".main.startColor");
        Color cb = ParseColor(cols.Count > 1 ? cols[1] : (cols.Count > 0 ? cols[0] : null), ca, name + ".main.startColor");
        main.startColor = ca == cb ? new ParticleSystem.MinMaxGradient(ca) : new ParticleSystem.MinMaxGradient(ca, cb);
        main.gravityModifier = Num(m, "gravity", 0f);
        main.simulationSpace = IsWorld(m, "simulationSpace", false) ? ParticleSystemSimulationSpace.World : ParticleSystemSimulationSpace.Local;
        main.maxParticles = Mathf.Max(1, Int(m, "maxParticles", 500));
        main.scalingMode = ParticleSystemScalingMode.Hierarchy;
        main.playOnAwake = true;
        main.stopAction = ParticleSystemStopAction.None;

        // ── emission
        var e = Obj(em, "emission");
        var emission = ps.emission;
        emission.enabled = true;
        emission.rateOverTime = Mathf.Max(0f, Num(e, "rateOverTime", 20f));
        emission.rateOverDistance = 0f;
        var bursts = new List<ParticleSystem.Burst>();
        foreach (var bo in Arr(e, "bursts"))
        {
            if (!(bo is Dictionary<string, object> b)) continue;
            var count = Range(b, "count", 10f, 10f);
            count = new Vector2(Mathf.Max(0f, Mathf.Round(count.x)), Mathf.Max(0f, Mathf.Round(count.y)));
            var burst = new ParticleSystem.Burst(Mathf.Max(0f, Num(b, "time", 0f)), Curve(count),
                Mathf.Max(1, Int(b, "cycles", 1)), Mathf.Max(0.01f, Num(b, "interval", 0.1f)));
            burst.probability = 1f;
            bursts.Add(burst);
        }
        emission.SetBursts(bursts.ToArray());

        // ── shape
        var s = Obj(em, "shape");
        var shape = ps.shape;
        shape.enabled = Bool(s, "enabled", true);
        string type = Lower(Str(s, "type", "cone"));
        switch (type)
        {
            case "cone": shape.shapeType = ParticleSystemShapeType.Cone; break;
            case "sphere": shape.shapeType = ParticleSystemShapeType.Sphere; break;
            case "hemisphere": shape.shapeType = ParticleSystemShapeType.Hemisphere; break;
            case "box": shape.shapeType = ParticleSystemShapeType.Box; break;
            case "circle": shape.shapeType = ParticleSystemShapeType.Circle; break;
            case "edge": shape.shapeType = ParticleSystemShapeType.SingleSidedEdge; break; // radius = yarı uzunluk
            case "donut": shape.shapeType = ParticleSystemShapeType.Donut; break;
            default:
                Debug.LogWarning(Tag + name + ".shape.type '" + type + "' bilinmiyor, koni kullanıldı");
                shape.shapeType = ParticleSystemShapeType.Cone; break;
        }
        shape.radius = Mathf.Max(0.0001f, Num(s, "radius", 0.1f));
        shape.radiusThickness = Mathf.Clamp01(Num(s, "radiusThickness", 1f));
        shape.radiusMode = ParticleSystemShapeMultiModeValue.Random;
        shape.angle = Mathf.Clamp(Num(s, "angle", 15f), 0f, 90f);
        shape.arc = Mathf.Clamp(Num(s, "arc", 360f), 0f, 360f);
        shape.arcMode = ParticleSystemShapeMultiModeValue.Random;
        shape.scale = type == "box" ? V3(s, "boxSize", Vector3.one) : Vector3.one;
        shape.donutRadius = Mathf.Max(0.0001f, Num(s, "donutRadius", 0.1f));
        shape.position = V3(s, "position", Vector3.zero);
        shape.rotation = V3(s, "rotation", new Vector3(-90f, 0f, 0f));
        shape.randomDirectionAmount = Mathf.Clamp01(Num(s, "randomDirection", 0f));
        shape.sphericalDirectionAmount = 0f;
        shape.randomPositionAmount = 0f;
        shape.alignToDirection = false;

        // ── velocityOverLifetime
        var v = Obj(em, "velocity");
        var vol = ps.velocityOverLifetime;
        vol.enabled = Bool(v, "enabled", false);
        var lin = V3(v, "linear", Vector3.zero);
        vol.x = lin.x; vol.y = lin.y; vol.z = lin.z;
        var orb = V3(v, "orbital", Vector3.zero);
        vol.orbitalX = orb.x; vol.orbitalY = orb.y; vol.orbitalZ = orb.z;
        vol.orbitalOffsetX = 0f; vol.orbitalOffsetY = 0f; vol.orbitalOffsetZ = 0f;
        vol.radial = Num(v, "radial", 0f);
        vol.space = IsWorld(v, "space", false) ? ParticleSystemSimulationSpace.World : ParticleSystemSimulationSpace.Local;
        vol.speedModifier = Num(v, "speedModifier", 1f);

        // ── forceOverLifetime
        var f = Obj(em, "force");
        var fol = ps.forceOverLifetime;
        fol.enabled = Bool(f, "enabled", false);
        var fv = V3(f, "force", Vector3.zero);
        fol.x = fv.x; fol.y = fv.y; fol.z = fv.z;
        fol.space = IsWorld(f, "space", true) ? ParticleSystemSimulationSpace.World : ParticleSystemSimulationSpace.Local;
        fol.randomized = false;

        // ── limitVelocityOverLifetime
        var l = Obj(em, "limitVelocity");
        var lvl = ps.limitVelocityOverLifetime;
        lvl.enabled = Bool(l, "enabled", false);
        lvl.separateAxes = false;
        lvl.limit = Mathf.Max(0f, Num(l, "limit", 1f));
        lvl.dampen = Mathf.Clamp01(Num(l, "dampen", 0f));
        lvl.drag = Mathf.Max(0f, Num(l, "drag", 0f));
        lvl.multiplyDragByParticleSize = false;
        lvl.multiplyDragByParticleVelocity = false;

        // ── noise
        var n = Obj(em, "noise");
        var noise = ps.noise;
        noise.enabled = Bool(n, "enabled", false);
        noise.separateAxes = false;
        noise.strength = Num(n, "strength", 0.5f);
        noise.frequency = Mathf.Max(0.0001f, Num(n, "frequency", 0.5f));
        noise.scrollSpeed = Num(n, "scrollSpeed", 0f);
        noise.octaveCount = Mathf.Clamp(Int(n, "octaves", 1), 1, 4);
        noise.damping = false;
        noise.remapEnabled = false;

        // ── colorOverLifetime
        var c = Obj(em, "colorOverLifetime");
        var col = ps.colorOverLifetime;
        col.enabled = Bool(c, "enabled", true);
        col.color = new ParticleSystem.MinMaxGradient(BuildGradient(c, name));

        // ── sizeOverLifetime
        var so = Obj(em, "sizeOverLifetime");
        var sol = ps.sizeOverLifetime;
        sol.enabled = Bool(so, "enabled", false);
        sol.separateAxes = false;
        sol.size = new ParticleSystem.MinMaxCurve(1f, LinearCurve(Arr(so, "curve")));

        // ── rotationOverLifetime (°/sn → rad/sn)
        var ro = Obj(em, "rotationOverLifetime");
        var rol = ps.rotationOverLifetime;
        rol.enabled = Bool(ro, "enabled", false);
        rol.separateAxes = false;
        var av = Range(ro, "angularVelocity", 0f, 0f) * Mathf.Deg2Rad;
        var zero = av.x == av.y ? new ParticleSystem.MinMaxCurve(0f) : new ParticleSystem.MinMaxCurve(0f, 0f); // eksenler aynı modda
        rol.x = zero; rol.y = zero;
        rol.z = Curve(av);

        // ── textureSheetAnimation
        var ts = Obj(em, "textureSheet");
        var tsa = ps.textureSheetAnimation;
        tsa.enabled = Bool(ts, "enabled", false);
        tsa.mode = ParticleSystemAnimationMode.Grid;
        tsa.timeMode = ParticleSystemAnimationTimeMode.Lifetime;
        int tilesX = Mathf.Clamp(Int(ts, "tilesX", 1), 1, 64), tilesY = Mathf.Clamp(Int(ts, "tilesY", 1), 1, 64);
        tsa.numTilesX = tilesX;
        tsa.numTilesY = tilesY;
        tsa.animation = ParticleSystemAnimationType.WholeSheet;
        tsa.frameOverTime = new ParticleSystem.MinMaxCurve(1f, AnimationCurve.Linear(0f, 0f, 1f, 1f)); // ömür boyunca tüm kareler
        tsa.cycleCount = Mathf.Max(1, Int(ts, "cycles", 1));
        int frames = tilesX * tilesY;
        // Unity frameOverTime/startFrame'i karelere göre normalize (0..1) saklar (inspector kare sayısıyla çarpıp gösterir)
        tsa.startFrame = Bool(ts, "randomStart", false) && frames > 1
            ? new ParticleSystem.MinMaxCurve(0f, (frames - 1) / (float)frames)
            : new ParticleSystem.MinMaxCurve(0f);

        // ── eşlenmeyen modüller kapalı (yeniden kullanılan prefab'da elle açılmış kalmasın)
        DisableUnmapped(ps);

        // ── renderer
        var r = Obj(em, "renderer");
        string mode = Lower(Str(r, "mode", "billboard"));
        switch (mode)
        {
            case "stretched": pr.renderMode = ParticleSystemRenderMode.Stretch; break;
            case "horizontal": pr.renderMode = ParticleSystemRenderMode.HorizontalBillboard; break;
            case "vertical": pr.renderMode = ParticleSystemRenderMode.VerticalBillboard; break;
            case "billboard": pr.renderMode = ParticleSystemRenderMode.Billboard; break;
            default:
                Debug.LogWarning(Tag + name + ".renderer.mode '" + mode + "' bilinmiyor, billboard kullanıldı");
                pr.renderMode = ParticleSystemRenderMode.Billboard; break;
        }
        pr.lengthScale = Num(r, "lengthScale", 2f);
        pr.velocityScale = Num(r, "velocityScale", 0f);
        pr.cameraVelocityScale = 0f;
        // local: quad emitter'ın XY düzleminde (kesik gibi 3B düzlemli şekiller); yalnız billboard'da anlamlı
        pr.alignment = mode == "billboard" && Lower(Str(r, "alignment", "view")) == "local" ? ParticleSystemRenderSpace.Local : ParticleSystemRenderSpace.View;
        pr.minParticleSize = 0f; pr.maxParticleSize = 10f; // önizleme ekran boyutunu kırpmaz; Unity varsayılanı (0.5) yakın planda büyük parlamaları keserdi
        pr.sortingOrder = Int(r, "sortingOrder", 0);
        bool additive = Lower(Str(r, "blend", "additive")) != "alpha";
        string libMat = Str(r, "material", "").Trim();
        pr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
        pr.receiveShadows = false;
        pr.enabled = true;
        if (libMat.Length > 0)
        {
            // kütüphane materyali: doku/karışım/parlaklık materyalden; karışımı bilinmediğinden uzaktan yakına sıralı (alfa için doğru, toplamalıda zararsız)
            pr.sortMode = ParticleSystemSortMode.Distance;
            pr.sharedMaterial = LoadLibraryMaterial(libMat, name);
        }
        else
        {
            pr.sortMode = additive ? ParticleSystemSortMode.None : ParticleSystemSortMode.Distance;
            pr.sharedMaterial = BuildMaterial(fxFile, name, Str(r, "texture", "soft"), additive, Mathf.Max(0f, Num(r, "intensity", 1f)), matPaths);
        }

        // ── kılıç izi (bladeTrail): parçacık değil şerit mesh (UnityPreviewBladeTrail); ParticleSystem yalnız saat olarak kalır
        var bt = Obj(em, "bladeTrail");
        var trail = go.GetComponent<UnityPreviewBladeTrail>();
        if (Bool(bt, "enabled", false))
        {
            if (trail == null) trail = go.AddComponent<UnityPreviewBladeTrail>();
            BuildBladeTrail(ps, pr, trail, em, bt, ca);
        }
        else if (trail != null) Object.DestroyImmediate(trail, true);

        go.SetActive(Bool(em, "enabled", true));
    }

    // Saat: tek görünmez parçacık (renderer kapalı) gecikme + süre + iz ömrü boyunca yaşar; kökte IsAlive(true) kuyruk sönene kadar
    // true kalır. Zamanlama (startDelay, duration, looping, simulationSpeed) bileşen tarafından bu sistemden okunur.
    static void BuildBladeTrail(ParticleSystem ps, ParticleSystemRenderer pr, UnityPreviewBladeTrail trail, Dictionary<string, object> em,
        Dictionary<string, object> bt, Color startColor)
    {
        string name = trail.gameObject.name;
        trail.from = V3(bt, "from", Vector3.zero);
        trail.to = V3(bt, "to", Vector3.forward);
        trail.lifetime = Mathf.Clamp(Num(bt, "lifetime", 0.25f), 0.02f, 3f);
        trail.subdiv = Mathf.Clamp(Int(bt, "subdiv", 4), 1, 12);
        trail.startColor = startColor;
        var c = Obj(em, "colorOverLifetime");
        trail.colorOverLifetimeEnabled = Bool(c, "enabled", false);
        trail.colorOverLifetime = BuildGradient(c, name);
        var so = Obj(em, "sizeOverLifetime");
        trail.sizeOverLifetimeEnabled = Bool(so, "enabled", false);
        trail.sizeOverLifetime = LinearCurve(Arr(so, "curve"));
        trail.material = pr.sharedMaterial;

        var main = ps.main;
        main.startLifetime = main.startDelay.constant + main.duration + trail.lifetime;
        main.startSpeed = 0f;
        main.startSize = 0f;
        main.maxParticles = 1;
        main.simulationSpace = ParticleSystemSimulationSpace.Local;
        main.gravityModifier = 0f;
        var emission = ps.emission;
        emission.enabled = true;
        emission.rateOverTime = 0f;
        emission.SetBursts(new[] { new ParticleSystem.Burst(0f, 1) });
        var shape = ps.shape; shape.enabled = false;
        var v = ps.velocityOverLifetime; v.enabled = false;
        var lv = ps.limitVelocityOverLifetime; lv.enabled = false;
        var f = ps.forceOverLifetime; f.enabled = false;
        var n = ps.noise; n.enabled = false;
        var col = ps.colorOverLifetime; col.enabled = false;
        var sol = ps.sizeOverLifetime; sol.enabled = false;
        var rol = ps.rotationOverLifetime; rol.enabled = false;
        var tsa = ps.textureSheetAnimation; tsa.enabled = false;
        pr.enabled = false;
    }

    static void DisableUnmapped(ParticleSystem ps)
    {
        var a = ps.inheritVelocity; a.enabled = false;
        var b = ps.lifetimeByEmitterSpeed; b.enabled = false;
        var c = ps.externalForces; c.enabled = false;
        var d = ps.colorBySpeed; d.enabled = false;
        var e = ps.sizeBySpeed; e.enabled = false;
        var f = ps.rotationBySpeed; f.enabled = false;
        var g = ps.collision; g.enabled = false;
        var h = ps.trigger; h.enabled = false;
        var i = ps.subEmitters; i.enabled = false;
        var j = ps.lights; j.enabled = false;
        var k = ps.trails; k.enabled = false;
        var m = ps.customData; m.enabled = false;
    }

    static Gradient BuildGradient(Dictionary<string, object> c, string where)
    {
        var ck = new List<GradientColorKey>();
        foreach (var o in Arr(c, "color"))
        {
            if (!(o is List<object> k) || k.Count < 2) continue;
            ck.Add(new GradientColorKey(ParseColor(k[1], Color.white, where + ".colorOverLifetime.color"), Mathf.Clamp01(ToF(k[0], 0f))));
            if (ck.Count == 8) break; // Unity sınırı
        }
        var ak = new List<GradientAlphaKey>();
        foreach (var o in Arr(c, "alpha"))
        {
            if (!(o is List<object> k) || k.Count < 2) continue;
            ak.Add(new GradientAlphaKey(Mathf.Clamp01(ToF(k[1], 1f)), Mathf.Clamp01(ToF(k[0], 0f))));
            if (ak.Count == 8) break;
        }
        if (ck.Count == 0) { ck.Add(new GradientColorKey(Color.white, 0f)); ck.Add(new GradientColorKey(Color.white, 1f)); }
        if (ak.Count == 0) { ak.Add(new GradientAlphaKey(1f, 0f)); ak.Add(new GradientAlphaKey(1f, 1f)); }
        var g = new Gradient { mode = GradientMode.Blend };
        g.SetKeys(ck.ToArray(), ak.ToArray());
        return g;
    }

    // [[t, değer], ...] → anahtarlar arası doğrusal eğri (uçlarda sabit)
    static AnimationCurve LinearCurve(List<object> pts)
    {
        var t = new List<float>(); var val = new List<float>();
        foreach (var o in pts)
        {
            if (!(o is List<object> p) || p.Count < 2) continue;
            float tt = Mathf.Clamp01(ToF(p[0], 0f));
            if (t.Count > 0 && tt <= t[t.Count - 1]) tt = t[t.Count - 1] + 1e-4f; // aynı zamanda iki anahtar olamaz
            t.Add(tt); val.Add(Mathf.Max(0f, ToF(p[1], 1f)));
        }
        if (t.Count == 0) { t.Add(0f); val.Add(1f); t.Add(1f); val.Add(1f); }
        var keys = new Keyframe[t.Count];
        for (int i = 0; i < keys.Length; i++)
        {
            float inT = i > 0 ? (val[i] - val[i - 1]) / (t[i] - t[i - 1]) : 0f;
            float outT = i < keys.Length - 1 ? (val[i + 1] - val[i]) / (t[i + 1] - t[i]) : 0f;
            keys[i] = new Keyframe(t[i], val[i], inT, outT);
        }
        var curve = new AnimationCurve(keys);
        for (int i = 0; i < curve.length; i++)
        {
            AnimationUtility.SetKeyLeftTangentMode(curve, i, AnimationUtility.TangentMode.Linear);
            AnimationUtility.SetKeyRightTangentMode(curve, i, AnimationUtility.TangentMode.Linear);
        }
        return curve;
    }

    // ───────────────────────────── malzeme + doku

    static Material BuildMaterial(string fxFile, string emitter, string texName, bool additive, float intensity, HashSet<string> matPaths)
    {
        string baseName = SafeFile(fxFile) + "__" + SafeFile(emitter);
        string matPath = MatDir + "/" + baseName + ".mat";
        for (int k = 2; matPaths.Contains(matPath); k++) matPath = MatDir + "/" + baseName + "_" + k + ".mat";
        matPaths.Add(matPath);

        var shader = Shader.Find(UrpShader);
        bool urp = shader != null;
        if (!urp)
        {
            shader = Shader.Find(BuiltinShader);
            if (shader == null) throw new Exception("Parçacık shader'ı bulunamadı ('" + UrpShader + "' ya da '" + BuiltinShader + "')");
            Debug.LogWarning(Tag + "URP parçacık shader'ı yok, '" + BuiltinShader + "' kullanılıyor");
        }

        var mat = AssetDatabase.LoadAssetAtPath<Material>(matPath);
        bool created = mat == null;
        if (created) mat = new Material(shader);
        else if (mat.shader != shader) mat.shader = shader;
        mat.name = Path.GetFileNameWithoutExtension(matPath);

        var tex = LoadTexture(texName, emitter);
        if (urp) SetupUrp(mat, tex, additive, intensity);
        else SetupBuiltin(mat, tex, additive, intensity);

        if (created) AssetDatabase.CreateAsset(mat, matPath); // varsa yeniden kullanılır → GUID korunur
        else EditorUtility.SetDirty(mat);
        return mat;
    }

    static readonly string[] OffKeywords =
    {
        "_ALPHATEST_ON", "_ALPHAPREMULTIPLY_ON", "_ALPHAMODULATE_ON", "_ALPHABLEND_ON",
        "_COLOROVERLAY_ON", "_COLORCOLOR_ON", "_COLORADDSUBDIFF_ON",
        "_FLIPBOOKBLENDING_ON", "_SOFTPARTICLES_ON", "_FADING_ON", "_DISTORTION_ON", "_NORMALMAP", "_EMISSION",
    };

    // URP BaseShaderGUI.SetupMaterialBlendModeInternal + ParticleGUI.SetMaterialKeywords karşılığı (derleme bağımlılığı yok)
    static void SetupUrp(Material mat, Texture2D tex, bool additive, float intensity)
    {
        var src = UnityEngine.Rendering.BlendMode.SrcAlpha;
        var dst = additive ? UnityEngine.Rendering.BlendMode.One : UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha;
        SetF(mat, "_Surface", 1f);                // Transparent
        SetF(mat, "_Blend", additive ? 2f : 0f);  // URP BlendMode: Alpha 0, Additive 2
        SetF(mat, "_BlendOp", (float)UnityEngine.Rendering.BlendOp.Add);
        SetF(mat, "_SrcBlend", (float)src);
        SetF(mat, "_DstBlend", (float)dst);
        SetF(mat, "_SrcBlendAlpha", (float)UnityEngine.Rendering.BlendMode.One);
        SetF(mat, "_DstBlendAlpha", (float)dst);
        SetF(mat, "_ZWrite", 0f);
        SetF(mat, "_AlphaClip", 0f);
        SetF(mat, "_AlphaToMask", 0f);
        SetF(mat, "_Cull", 0f);                   // iki yüz: yatay billboard alttan da görünsün
        SetF(mat, "_ColorMode", 0f);              // Multiply: parçacık rengi × doku × _BaseColor
        SetF(mat, "_FlipbookBlending", 0f);
        SetF(mat, "_SoftParticlesEnabled", 0f);
        SetF(mat, "_CameraFadingEnabled", 0f);
        SetF(mat, "_DistortionEnabled", 0f);
        SetF(mat, "_QueueOffset", 0f);
        foreach (var k in OffKeywords) mat.DisableKeyword(k);
        mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
        mat.SetOverrideTag("RenderType", "Transparent");
        mat.SetShaderPassEnabled("DepthOnly", false);
        mat.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent; // 3000
        if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", tex);
        if (mat.HasProperty("_BaseColor")) mat.SetColor("_BaseColor", Intensity(intensity));
    }

    // Built-in "Particles/Standard Unlit" (URP yoksa): StandardParticlesShaderGUI'deki Fade/Additive kurulumu
    static void SetupBuiltin(Material mat, Texture2D tex, bool additive, float intensity)
    {
        SetF(mat, "_Mode", additive ? 4f : 2f); // 2 Fade, 4 Additive
        SetF(mat, "_BlendOp", (float)UnityEngine.Rendering.BlendOp.Add);
        SetF(mat, "_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
        SetF(mat, "_DstBlend", (float)(additive ? UnityEngine.Rendering.BlendMode.One : UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha));
        SetF(mat, "_ZWrite", 0f);
        SetF(mat, "_Cull", 0f);
        SetF(mat, "_ColorMode", 0f);
        foreach (var k in OffKeywords) mat.DisableKeyword(k);
        mat.EnableKeyword("_ALPHABLEND_ON");
        mat.SetOverrideTag("RenderType", "Transparent");
        mat.renderQueue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
        if (mat.HasProperty("_MainTex")) mat.SetTexture("_MainTex", tex);
        if (mat.HasProperty("_Color")) mat.SetColor("_Color", Intensity(intensity));
    }

    // beyaz × intensity, shader'a DOĞRUSAL değer olarak varsın: Linear uzayda SetColor gamma kabul edip doğrusala çevirir
    static Color Intensity(float i)
    {
        var c = new Color(i, i, i, 1f);
        return PlayerSettings.colorSpace == ColorSpace.Linear ? c.gamma : c;
    }

    static void SetF(Material mat, string prop, float v) { if (mat.HasProperty(prop)) mat.SetFloat(prop, v); }

    static Texture2D LoadTexture(string texName, string emitter)
    {
        texName = (texName ?? "").Trim();
        if (texName.EndsWith(".png", StringComparison.OrdinalIgnoreCase)) texName = texName.Substring(0, texName.Length - 4);
        if (texName.Length == 0) return null;
        if (texName.Contains("..") || Path.IsPathRooted(texName))
        {
            Debug.LogWarning(Tag + emitter + ": geçersiz doku adı '" + texName + "' (malzeme dokusuz kalır)");
            return null;
        }
        string p = TexDir + "/" + texName + ".png";
        if (!File.Exists(p))
        {
            Debug.LogWarning(Tag + emitter + ": doku yok: " + p + " (malzeme dokusuz kalır)");
            return null;
        }
        AssetDatabase.ImportAsset(p, ImportAssetOptions.ForceSynchronousImport); // değişmediyse işlem yapmaz
        if (AssetImporter.GetAtPath(p) is TextureImporter ti)
        {
            bool changed = false;
            if (ti.textureType != TextureImporterType.Default) { ti.textureType = TextureImporterType.Default; changed = true; }
            if (!ti.sRGBTexture) { ti.sRGBTexture = true; changed = true; }
            if (ti.alphaSource != TextureImporterAlphaSource.FromInput) { ti.alphaSource = TextureImporterAlphaSource.FromInput; changed = true; }
            if (!ti.alphaIsTransparency) { ti.alphaIsTransparency = true; changed = true; }
            if (ti.wrapModeU != TextureWrapMode.Clamp || ti.wrapModeV != TextureWrapMode.Clamp || ti.wrapModeW != TextureWrapMode.Clamp)
            { ti.wrapMode = TextureWrapMode.Clamp; changed = true; }
            if (!ti.mipmapEnabled) { ti.mipmapEnabled = true; changed = true; }
            if (changed) ti.SaveAndReimport();
        }
        var tex = AssetDatabase.LoadAssetAtPath<Texture2D>(p);
        if (tex == null) Debug.LogWarning(Tag + emitter + ": doku yüklenemedi: " + p + " (malzeme dokusuz kalır)");
        return tex;
    }

    // ───────────────────────────── yardımcılar

    // new GameObject() önce etkin sahnede doğar ve onu kirli işaretler: gizli/kaydedilmez doğup hedefe taşınır
    static GameObject NewObject(string name, Transform parent, Scene scene)
    {
        var go = EditorUtility.CreateGameObjectWithHideFlags(name, HideFlags.HideAndDontSave);
        if (parent != null) go.transform.SetParent(parent, false);
        else if (scene.IsValid()) SceneManager.MoveGameObjectToScene(go, scene);
        go.hideFlags = HideFlags.None;
        return go;
    }

    static T GetOrAdd<T>(GameObject go) where T : Component
    {
        var c = go.GetComponent<T>(); // editörde eksik bileşen "sahte null" döner: ?? kullanma
        if (c == null) c = go.AddComponent<T>();
        return c;
    }

    static ParticleSystem.MinMaxCurve Curve(Vector2 r) =>
        Mathf.Approximately(r.x, r.y) ? new ParticleSystem.MinMaxCurve(r.x) : new ParticleSystem.MinMaxCurve(r.x, r.y);

    static Color ParseColor(object o, Color def, string where)
    {
        if (o is string s)
        {
            s = s.Trim();
            if (!s.StartsWith("#")) s = "#" + s;
            if (ColorUtility.TryParseHtmlString(s, out var c)) return c; // #rgb, #rrggbb, #rrggbbaa
        }
        Debug.LogWarning(Tag + where + ": geçersiz renk '" + o + "', varsayılan kullanıldı");
        return def;
    }

    static string BaseName(string path)
    {
        string f = Path.GetFileName(path);
        if (f.EndsWith(Ext, StringComparison.OrdinalIgnoreCase)) return f.Substring(0, f.Length - Ext.Length);
        return Path.GetFileNameWithoutExtension(f);
    }

    static string OneLine(string s) => (s ?? "").Replace("\r", " ").Replace("\n", " ");

    static string Lower(string s) => (s ?? "").Trim().ToLowerInvariant(); // Türkçe yerel ayarda I/ı tuzağı yok

    // Dosya adı için: Türkçe harfler ASCII'ye, diğer güvensiz karakterler '_'
    static string SafeFile(string s)
    {
        var sb = new StringBuilder();
        foreach (char ch in s ?? "")
        {
            char c;
            switch (ch)
            {
                case 'ı': c = 'i'; break; case 'İ': c = 'I'; break;
                case 'ş': c = 's'; break; case 'Ş': c = 'S'; break;
                case 'ğ': c = 'g'; break; case 'Ğ': c = 'G'; break;
                case 'ü': c = 'u'; break; case 'Ü': c = 'U'; break;
                case 'ö': c = 'o'; break; case 'Ö': c = 'O'; break;
                case 'ç': c = 'c'; break; case 'Ç': c = 'C'; break;
                default: c = ch; break;
            }
            bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.';
            sb.Append(ok ? c : '_');
        }
        string r = sb.ToString().Trim('.');
        return r.Length == 0 ? "_" : r;
    }

    static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path)) return;
        string parent = Path.GetDirectoryName(path).Replace('\\', '/');
        if (!string.IsNullOrEmpty(parent)) EnsureFolder(parent);
        if (Directory.Exists(path))
        {
            // Diskte var ama AssetDatabase bilmiyor (sunucu yazdı): içeri al
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            if (!AssetDatabase.IsValidFolder(path)) AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            if (AssetDatabase.IsValidFolder(path)) return;
        }
        AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        if (!AssetDatabase.IsValidFolder(path)) throw new Exception("Klasör oluşturulamadı: " + path);
    }

    // ── JSON erişimi (eksik/yanlış tipte alanlarda varsayılan)
    static Dictionary<string, object> Obj(Dictionary<string, object> d, string k) =>
        d != null && d.TryGetValue(k, out var v) && v is Dictionary<string, object> o ? o : new Dictionary<string, object>();

    static List<object> Arr(Dictionary<string, object> d, string k) =>
        d != null && d.TryGetValue(k, out var v) && v is List<object> l ? l : new List<object>();

    static float ToF(object v, float def)
    {
        if (v is double x) return double.IsNaN(x) || double.IsInfinity(x) ? def : (float)x;
        if (v is bool b) return b ? 1f : 0f;
        if (v is string s && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var y)) return (float)y;
        return def;
    }

    static float Num(Dictionary<string, object> d, string k, float def) => d != null && d.TryGetValue(k, out var v) ? ToF(v, def) : def;
    static int Int(Dictionary<string, object> d, string k, int def) => Mathf.RoundToInt(Num(d, k, def));
    static bool Bool(Dictionary<string, object> d, string k, bool def) => d != null && d.TryGetValue(k, out var v) && v is bool b ? b : def;
    static string Str(Dictionary<string, object> d, string k, string def) => d != null && d.TryGetValue(k, out var v) && v is string s ? s : def;
    static bool IsWorld(Dictionary<string, object> d, string k, bool def)
    {
        string s = Lower(Str(d, k, def ? "world" : "local"));
        return s == "world";
    }

    // [min, max] (tek sayı da kabul) → Vector2(min, max), min ≤ max
    static Vector2 Range(Dictionary<string, object> d, string k, float defMin, float defMax)
    {
        if (d == null || !d.TryGetValue(k, out var v)) return new Vector2(defMin, defMax);
        float a, b;
        if (v is List<object> l && l.Count > 0) { a = ToF(l[0], defMin); b = l.Count > 1 ? ToF(l[1], a) : a; }
        else if (v is double) { a = b = ToF(v, defMin); }
        else return new Vector2(defMin, defMax);
        return a <= b ? new Vector2(a, b) : new Vector2(b, a);
    }

    static Vector3 V3(Dictionary<string, object> d, string k, Vector3 def)
    {
        if (d == null || !d.TryGetValue(k, out var v) || !(v is List<object> l)) return def;
        return new Vector3(l.Count > 0 ? ToF(l[0], def.x) : def.x, l.Count > 1 ? ToF(l[1], def.y) : def.y, l.Count > 2 ? ToF(l[2], def.z) : def.z);
    }

    // ───────────────────────────── küçük JSON ayrıştırıcı
    // JsonUtility iç içe dizi / karışık tip ([[t,'#hex']]) okuyamaz. Çıktı: Dictionary<string,object>, List<object>,
    // double, string, bool, null. Sayılar InvariantCulture (makine Türkçe yerel ayarlı: ondalık virgül tuzağı).
    static class Json
    {
        public static object Parse(string s)
        {
            if (s == null) throw new FormatException("JSON boş");
            int i = 0;
            if (s.Length > 0 && s[0] == '﻿') i = 1; // BOM
            object v = Value(s, ref i);
            Ws(s, ref i);
            if (i < s.Length) throw Err(s, i, "fazladan karakter");
            return v;
        }

        static Exception Err(string s, int i, string msg)
        {
            int line = 1, colNo = 1;
            for (int k = 0; k < i && k < s.Length; k++) { if (s[k] == '\n') { line++; colNo = 1; } else colNo++; }
            return new FormatException("JSON hatası (satır " + line + ", sütun " + colNo + "): " + msg);
        }

        static void Ws(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
        }

        static object Value(string s, ref int i)
        {
            Ws(s, ref i);
            if (i >= s.Length) throw Err(s, i, "beklenmedik son");
            char c = s[i];
            switch (c)
            {
                case '{': return ParseObject(s, ref i);
                case '[': return ParseArray(s, ref i);
                case '"': return ParseString(s, ref i);
                case 't': Literal(s, ref i, "true"); return true;
                case 'f': Literal(s, ref i, "false"); return false;
                case 'n': Literal(s, ref i, "null"); return null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) return ParseNumber(s, ref i);
                    throw Err(s, i, "beklenmedik karakter '" + c + "'");
            }
        }

        static void Literal(string s, ref int i, string word)
        {
            if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) throw Err(s, i, word + " bekleniyordu");
            i += word.Length;
        }

        static Dictionary<string, object> ParseObject(string s, ref int i)
        {
            var d = new Dictionary<string, object>();
            i++; // {
            Ws(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return d; }
            while (true)
            {
                Ws(s, ref i);
                if (i >= s.Length || s[i] != '"') throw Err(s, i, "anahtar (\"...\") bekleniyordu");
                string key = ParseString(s, ref i);
                Ws(s, ref i);
                if (i >= s.Length || s[i] != ':') throw Err(s, i, "':' bekleniyordu");
                i++;
                d[key] = Value(s, ref i);
                Ws(s, ref i);
                if (i >= s.Length) throw Err(s, i, "'}' bekleniyordu");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == '}') { i++; return d; }
                throw Err(s, i, "',' ya da '}' bekleniyordu");
            }
        }

        static List<object> ParseArray(string s, ref int i)
        {
            var l = new List<object>();
            i++; // [
            Ws(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return l; }
            while (true)
            {
                l.Add(Value(s, ref i));
                Ws(s, ref i);
                if (i >= s.Length) throw Err(s, i, "']' bekleniyordu");
                if (s[i] == ',') { i++; continue; }
                if (s[i] == ']') { i++; return l; }
                throw Err(s, i, "',' ya da ']' bekleniyordu");
            }
        }

        static string ParseString(string s, ref int i)
        {
            var sb = new StringBuilder();
            i++; // "
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }
                if (i >= s.Length) break;
                char e = s[i++];
                switch (e)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        if (i + 4 > s.Length || !int.TryParse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int code))
                            throw Err(s, i, "geçersiz \\u kaçışı");
                        sb.Append((char)code); i += 4; break;
                    default: throw Err(s, i - 1, "geçersiz kaçış '\\" + e + "'");
                }
            }
            throw Err(s, i, "kapanmamış metin");
        }

        static double ParseNumber(string s, ref int i)
        {
            int start = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            string t = s.Substring(start, i - start);
            if (!double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out double v)) throw Err(s, start, "geçersiz sayı '" + t + "'");
            return v;
        }
    }
}
#endif
