// Anim Ref -> Unity otomatik aktarım. Editör (Anim Ref) "Unity'ye gönder" dediğinde
// Assets/AnimRef/<ad>.animref.json yazılır; bu script onu otomatik .anim'e çevirir:
//   Assets/AnimRef/Clips/<ad>.anim
// Karakter ve mod Assets/AnimRef/settings.json'dan okunur (editör yazar). Mod "Auto": karakter Humanoid ise
// Humanoid, değilse Generic. Unity kapalıyken gönderilenler Unity açılınca işlenir.
#if UNITY_EDITOR
using System;
using System.IO;
using UnityEditor;
using UnityEngine;

[InitializeOnLoad]
public class AnimRefAutoImport : AssetPostprocessor
{
    const string Dir = "Assets/AnimRef";
    [Serializable] class Settings { public string character; public string mode; }

    static double nextPoll; static bool busy;

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
            if (File.Exists(clipPath) && File.GetLastWriteTimeUtc(clipPath) >= File.GetLastWriteTimeUtc(json)) continue;
            string status;
            try
            {
                var ch = string.IsNullOrEmpty(settings.character) ? null : AssetDatabase.LoadAssetAtPath<GameObject>(settings.character);
                if (ch == null) throw new Exception("Karakter bulunamadı: '" + settings.character + "' (Anim Ref > Unity bölümünden karakteri seç)");
                var mode = (AnimRefImporter.Mode)Enum.Parse(typeof(AnimRefImporter.Mode), string.IsNullOrEmpty(settings.mode) ? "Auto" : settings.mode, true);
                AnimRefImporter.Import(json, ch, clipPath, mode);
                File.SetLastWriteTimeUtc(clipPath, DateTime.UtcNow);
                status = name + "|OK|" + clipPath;
            }
            catch (Exception e) { status = name + "|ERROR|" + e.Message.Replace('\n', ' '); Debug.LogError("AnimRef: " + e.Message); }
            File.WriteAllText(Dir + "/last_status.txt", status);
        }
    }
}
#endif
