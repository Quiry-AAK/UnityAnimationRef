// Anim Ref -> Unity otomatik aktarım. Editör (Anim Ref) "Unity'ye gönder" dediğinde
// Assets/AnimRef/<ad>.animref.json yazılır; bu script onu otomatik .anim'e çevirir:
//   Assets/AnimRef/Clips/<ad>.anim
// Karakter ve mod Assets/AnimRef/settings.json'dan okunur (editör yazar). Mod "Auto": karakter Humanoid ise
// Humanoid, değilse Generic. Unity kapalıyken gönderilenler Unity açılınca işlenir.
// Yeniden aktarım kararı dosya tarihine değil içeriğe bakar (git checkout/pull tarihleri gelişigüzel yazar): klip,
// üretildiği json'un SHA1 özetini kendi .meta'sında (importer userData "animref-sha1=<özet>") taşır; klip yoksa ya da
// özet farklıysa aktarılır. Editör her gönderime sentAt yazar, yani aynı animasyonu yeniden göndermek de aktarır.
// Özetsiz eski klip (bu sürümden önce üretilmiş): json'da sentAt yoksa aktarılmaz, yalnız özet kaydedilir.
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using UnityEditor;
using UnityEngine;

[InitializeOnLoad]
public class AnimRefAutoImport : AssetPostprocessor
{
    const string Dir = "Assets/AnimRef";
    const string ShaTag = "animref-sha1=";
    [Serializable] class Settings { public string character; public string mode; }
    [Serializable] class Stamp { public string sentAt; }

    static double nextPoll; static bool busy;
    static readonly Dictionary<string, (DateTime time, long size, string sha)> shaCache = new Dictionary<string, (DateTime, long, string)>();

    static AnimRefAutoImport()
    {
        EditorApplication.delayCall += ProcessPending;
        EditorApplication.update += Poll; // Unity arka plandayken de (odak olmasa da) yeni gönderimleri yakalar
    }

    static void Poll()
    {
        if (busy || EditorApplication.timeSinceStartup < nextPoll) return;
        nextPoll = EditorApplication.timeSinceStartup + 1.5;
        if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
        busy = true;
        try { ProcessPending(); } finally { busy = false; }
    }

    static void OnPostprocessAllAssets(string[] imported, string[] deleted, string[] moved, string[] movedFrom)
    {
        foreach (var p in imported)
            if (p.StartsWith(Dir + "/") && p.EndsWith(".animref.json")) { EditorApplication.delayCall += ProcessPending; return; }
    }

    [MenuItem("Tools/Anim Ref/Process pending imports")]
    public static void ProcessPending()
    {
        if (!Directory.Exists(Dir)) return;
        Settings settings = new Settings { mode = "Auto" };
        string sp = Dir + "/settings.json";
        if (File.Exists(sp)) { try { settings = JsonUtility.FromJson<Settings>(File.ReadAllText(sp)); } catch { /* varsayılan */ } }
        foreach (var json in Directory.GetFiles(Dir, "*.animref.json"))
        {
            string name = Path.GetFileName(json).Replace(".animref.json", "");
            string clipPath = Dir + "/Clips/" + name + ".anim";
            string sha = Sha1(json);
            if (File.Exists(clipPath))
            {
                string stored = StoredSha(clipPath);
                if (stored == sha) continue;
                if (stored == null && !Sent(json)) { RecordSha(clipPath, sha); continue; } // geçiş: eski klibe dokunma
            }
            string status;
            try
            {
                var ch = string.IsNullOrEmpty(settings.character) ? null : AssetDatabase.LoadAssetAtPath<GameObject>(settings.character);
                if (ch == null) throw new Exception("Karakter bulunamadı: '" + settings.character + "' (Anim Ref > Unity bölümünden karakteri seç)");
                var mode = (AnimRefImporter.Mode)Enum.Parse(typeof(AnimRefImporter.Mode), string.IsNullOrEmpty(settings.mode) ? "Auto" : settings.mode, true);
                AnimRefImporter.Import(json, ch, clipPath, mode);
                RecordSha(clipPath, sha);
                File.SetLastWriteTimeUtc(clipPath, DateTime.UtcNow); // editör bekler: klip tarihi ≥ gönderim zamanı = aktarıldı
                status = name + "|OK|" + clipPath;
            }
            catch (Exception e) { status = name + "|ERROR|" + e.Message.Replace('\n', ' '); Debug.LogError("AnimRef: " + e.Message); }
            File.WriteAllText(Dir + "/last_status.txt", status);
        }
    }

    // json'un içerik özeti; git autocrlf satır sonlarını değiştirse de aynı kalsın diye \r sayılmaz
    static string Sha1(string path)
    {
        var fi = new FileInfo(path);
        if (shaCache.TryGetValue(path, out var c) && c.time == fi.LastWriteTimeUtc && c.size == fi.Length) return c.sha;
        var bytes = File.ReadAllBytes(path);
        int n = 0; foreach (var b in bytes) if (b != '\r') bytes[n++] = b;
        string sha;
        using (var s = SHA1.Create()) sha = BitConverter.ToString(s.ComputeHash(bytes, 0, n)).Replace("-", "").ToLowerInvariant();
        shaCache[path] = (fi.LastWriteTimeUtc, fi.Length, sha);
        return sha;
    }

    // Diskteki .meta'dan okunur: git pull sonrası AssetDatabase henüz yenilenmemişken de klibin gerçek özeti görülsün
    static string StoredSha(string clipPath)
    {
        string meta = clipPath + ".meta";
        if (!File.Exists(meta)) return null;
        string text = File.ReadAllText(meta);
        int i = text.IndexOf(ShaTag, StringComparison.Ordinal);
        return i < 0 || i + ShaTag.Length + 40 > text.Length ? null : text.Substring(i + ShaTag.Length, 40);
    }

    static void RecordSha(string clipPath, string sha)
    {
        var importer = AssetImporter.GetAtPath(clipPath);
        if (importer == null) return; // AssetDatabase klibi henüz tanımıyor; sonraki turda
        importer.userData = ShaTag + sha;
        importer.SaveAndReimport();
    }

    static bool Sent(string json)
    {
        try { return !string.IsNullOrEmpty(JsonUtility.FromJson<Stamp>(File.ReadAllText(json))?.sentAt); }
        catch { return false; }
    }
}
#endif
