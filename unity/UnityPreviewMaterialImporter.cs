// Unity Preview Editor -> Unity materyal/shader aktarımı (docs/MATERIAL.md "Unity: materyal importer", "Unity'ye gönderim").
// Sunucu özel shader'ı Assets/UnityPreview/Shaders/<ad>.shader (lib/shader-hlsl.js), materyali Assets/UnityPreview/Materials/<ad>.mat.json
// (upe-material-export-1) olarak yazar; bu script:
//   1) değişen .shader'ları içe alır, pass'leri derletir, sonucu durum dosyasına yazar:
//      shader:<ad>|OK|<yol> · shader:<ad>|ERROR|<satır>: [<bölüm>:<bölüm satırı>] <mesaj> (hata başına bir satır, en çok 5)
//   2) *.mat.json → <ad>.mat (varsa yerinde güncellenir, GUID korunur): değerler, dokular (+ import ayarı), URP yüzey kurulumu, renderQueue
// Durum dosyası: Assets/UnityPreview/Materials/last_status.txt (<ad>|OK|<yol> · <ad>|ERROR|<mesaj>); sunucu .mat mtime'ına da bakar.
// Yalnız Assets/UnityPreview altına yazar; oyunun dokularına (unityPath) yalnız okumak için dokunur, import ayarlarını değiştirmez.
// Unity açıkken ~1.5 sn'de bir yeni gönderimleri yakalar (oyun modunda değil). Batchmode: -executeMethod UnityPreviewMaterialImporter.ProcessPending
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;
using BlendMode = UnityEngine.Rendering.BlendMode;

[InitializeOnLoad]
public static class UnityPreviewMaterialImporter
{
    const string Root = "Assets/UnityPreview";
    const string ShaderDir = Root + "/Shaders";
    const string MatDir = Root + "/Materials";
    const string StatusFile = MatDir + "/last_status.txt";
    const string StateFile = ShaderDir + "/.upe_shader_state"; // '.' ile başlayan dosyayı Unity içe almaz
    const string Ext = ".mat.json";
    const string Format = "upe-material-export-1";
    const string CustomPrefix = "UnityPreview/";
    const string Tag = "UnityPreview Material: ";
    const int MaxShaderErrors = 5;
    static readonly string[] BuiltinTextures = { "white", "black", "gray", "grey", "bump" };

    static double nextPoll;
    static bool busy;
    // Hatalı json'lar her poll'da yeniden denenip log'u doldurmasın: dosya değişene dek atlanır
    static readonly Dictionary<string, DateTime> failed = new Dictionary<string, DateTime>();
    // Bir çalıştırmada aynı doku hem sRGB hem doğrusal istenirse uyar (son istek kazanır)
    static readonly Dictionary<string, bool> texLinearThisRun = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);

    static UnityPreviewMaterialImporter()
    {
        if (Application.isBatchMode) return; // batchmode'da -executeMethod ile açıkça çağrılır
        EditorApplication.delayCall += Tick;
        EditorApplication.update += Poll; // Unity arka plandayken de yeni gönderimleri yakalar
    }

    static void Poll()
    {
        if (busy || EditorApplication.timeSinceStartup < nextPoll) return;
        nextPoll = EditorApplication.timeSinceStartup + 1.5;
        if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return;
        Tick();
    }

    static void Tick()
    {
        if (EditorApplication.isPlayingOrWillChangePlaymode) return;
        try { ProcessPending(); }
        catch (Exception e) { Debug.LogError(Tag + e); }
    }

    // ───────────────────────────── bekleyenler

    [MenuItem("Tools/Unity Preview/Process pending materials")]
    public static void ProcessPending()
    {
        if (busy) return;
        busy = true;
        try
        {
            var state = LoadState();
            var shaders = FindChangedShaders(state, out bool shaderFresh);
            var mats = FindPending(out bool matFresh);
            if (shaders.Count == 0 && mats.Count == 0) return;
            // Sunucu shader → dokular → json sırasıyla yazar: yeni yazılmış dosya varsa hepsini birlikte bir sonraki poll'a bırak
            // (shader ve materyal satırları aynı durum dosyasına girsin)
            if (!Application.isBatchMode && (shaderFresh || matFresh)) return;

            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport); // dışarıdan yazılan shader/doku/json içeri
            texLinearThisRun.Clear();
            var lines = new List<string>();
            foreach (var s in shaders)
            {
                lines.AddRange(CheckShader(s.Key, s.Value.name));
                state[s.Value.name] = s.Value.stamp;
            }
            if (shaders.Count > 0) SaveState(state);

            foreach (var json in mats)
            {
                string name = BaseName(json);
                try
                {
                    string mat = Import(json);
                    failed.Remove(json);
                    lines.Add(name + "|OK|" + mat);
                    Debug.Log(Tag + name + " → " + mat);
                }
                catch (Exception e)
                {
                    if (File.Exists(json)) failed[json] = File.GetLastWriteTimeUtc(json);
                    lines.Add(name + "|ERROR|" + OneLine(e.Message));
                    Debug.LogError(Tag + name + ": " + e.Message + "\n" + e.StackTrace);
                }
            }
            Directory.CreateDirectory(MatDir);
            File.WriteAllText(StatusFile, string.Join("\n", lines), new UTF8Encoding(false));
        }
        finally { busy = false; }
    }

    struct ShaderFile { public string name; public string stamp; }

    // son işlenişten beri değişen (mtime/boyut) .shader dosyaları; fresh: biri az önce yazıldı
    static Dictionary<string, ShaderFile> FindChangedShaders(Dictionary<string, string> state, out bool fresh)
    {
        fresh = false;
        var list = new Dictionary<string, ShaderFile>(StringComparer.Ordinal);
        if (!Directory.Exists(ShaderDir)) return list;
        foreach (var f in Directory.GetFiles(ShaderDir, "*.shader"))
        {
            string path = f.Replace('\\', '/');
            if (!path.EndsWith(".shader", StringComparison.OrdinalIgnoreCase)) continue;
            var t = File.GetLastWriteTimeUtc(path);
            string stamp = t.Ticks.ToString(CultureInfo.InvariantCulture) + ":" + new FileInfo(path).Length.ToString(CultureInfo.InvariantCulture);
            string name = Path.GetFileNameWithoutExtension(path);
            if (state.TryGetValue(name, out var old) && old == stamp) continue;
            double age = (DateTime.UtcNow - t).TotalSeconds;
            if (age >= 0 && age < 1.0) fresh = true;
            list[path] = new ShaderFile { name = name, stamp = stamp };
        }
        return list;
    }

    // .mat'ı olmayan ya da json'u .mat'tan yeni olanlar
    static List<string> FindPending(out bool fresh)
    {
        fresh = false;
        var list = new List<string>();
        if (!Directory.Exists(MatDir)) return list;
        foreach (var f in Directory.GetFiles(MatDir, "*" + Ext))
        {
            string json = f.Replace('\\', '/');
            if (!json.EndsWith(Ext, StringComparison.OrdinalIgnoreCase)) continue;
            var jt = File.GetLastWriteTimeUtc(json);
            string mat = MatDir + "/" + BaseName(json) + ".mat";
            if (File.Exists(mat) && File.GetLastWriteTimeUtc(mat) >= jt) continue;
            if (failed.TryGetValue(json, out var ft) && ft == jt) continue;
            double age = (DateTime.UtcNow - jt).TotalSeconds;
            if (age >= 0 && age < 0.5) fresh = true;
            list.Add(json);
        }
        list.Sort(StringComparer.Ordinal);
        return list;
    }

    static Dictionary<string, string> LoadState()
    {
        var d = new Dictionary<string, string>(StringComparer.Ordinal);
        try
        {
            if (!File.Exists(StateFile)) return d;
            foreach (var l in File.ReadAllLines(StateFile))
            {
                int k = l.IndexOf('|');
                if (k > 0) d[l.Substring(0, k)] = l.Substring(k + 1).Trim();
            }
        }
        catch (Exception e) { Debug.LogWarning(Tag + "durum okunamadı (" + StateFile + "): " + e.Message); }
        return d;
    }

    static void SaveState(Dictionary<string, string> d)
    {
        var sb = new StringBuilder();
        foreach (var kv in d) sb.Append(kv.Key).Append('|').Append(kv.Value).Append('\n');
        try { Directory.CreateDirectory(ShaderDir); File.WriteAllText(StateFile, sb.ToString(), new UTF8Encoding(false)); }
        catch (Exception e) { Debug.LogWarning(Tag + "durum yazılamadı: " + e.Message); }
    }

    // ───────────────────────────── shader derleme sonucu

    static List<string> CheckShader(string path, string name)
    {
        var res = new List<string>();
        string key = "shader:" + name;
        AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport); // Refresh almadıysa (değişmediyse işlem yapmaz)
        var sh = AssetDatabase.LoadAssetAtPath<Shader>(path);
        if (sh == null) { res.Add(key + "|ERROR|shader yüklenemedi: " + path); Debug.LogError(Tag + res[0]); return res; }

        // İçe aktarma tüm varyantları derlemez: her pass'in varsayılan varyantını eşzamanlı derlet (hatalar mesajlara düşer)
        Material tmp = null;
        try
        {
            tmp = new Material(sh) { hideFlags = HideFlags.HideAndDontSave };
            for (int p = 0; p < tmp.passCount; p++) ShaderUtil.CompilePass(tmp, p, true);
        }
        catch (Exception e) { Debug.LogWarning(Tag + name + ": pass derletilemedi (" + e.Message + "), içe aktarma sonucu kullanılıyor"); }
        finally { if (tmp != null) UnityEngine.Object.DestroyImmediate(tmp); }

        var sections = ReadSections(path);
        var seen = new HashSet<string>();
        foreach (var m in ShaderUtil.GetShaderMessages(sh))
        {
            if (m.severity != UnityEditor.Rendering.ShaderCompilerMessageSeverity.Error) continue;
            string msg = OneLine(m.message).Trim();
            string file = (m.file ?? "").Replace('\\', '/');
            bool own = file.Length == 0 || file.EndsWith("/" + Path.GetFileName(path), StringComparison.OrdinalIgnoreCase) || file == Path.GetFileName(path);
            string entry;
            if (own && m.line > 0)
            {
                string sec = SectionOf(sections, m.line);
                entry = m.line.ToString(CultureInfo.InvariantCulture) + ": " + (sec != null ? "[" + sec + "] " : "") + msg;
            }
            else entry = msg + (file.Length > 0 ? " (" + file + ":" + m.line.ToString(CultureInfo.InvariantCulture) + ")" : "");
            if (!seen.Add(entry)) continue; // aynı hata farklı platform/varyantta tekrar eder
            res.Add(key + "|ERROR|" + entry);
            if (res.Count >= MaxShaderErrors) break;
        }
        if (res.Count == 0 && ShaderUtil.ShaderHasError(sh)) res.Add(key + "|ERROR|derleme hatası (ayrıntı Unity Console'da)");
        if (res.Count == 0)
        {
            res.Add(key + "|OK|" + path);
            Debug.Log(Tag + "shader " + name + " derlendi: " + path);
        }
        else Debug.LogError(Tag + "shader " + name + " derlenemedi:\n" + string.Join("\n", res));
        return res;
    }

    // lib/shader-hlsl.js kullanıcı kodunu '//#upe-section <bölüm>' … '//#upe-section end' arasına aynen koyar:
    // dosya satırı L, işaret satırı M → bölüm satırı L - M (editördeki kod satırıyla aynı)
    struct Section { public string key; public int marker; public int end; }

    static List<Section> ReadSections(string path)
    {
        var list = new List<Section>();
        try
        {
            var lines = File.ReadAllLines(path);
            Section cur = default; bool open = false;
            for (int i = 0; i < lines.Length; i++)
            {
                string l = lines[i].Trim();
                if (!l.StartsWith("//#upe-section ", StringComparison.Ordinal)) continue;
                string k = l.Substring(15).Trim();
                if (open) { cur.end = i + 1; list.Add(cur); open = false; }
                if (k != "end") { cur = new Section { key = k, marker = i + 1 }; open = true; }
            }
        }
        catch { /* eşleme yoksa yalnız dosya satırı */ }
        return list;
    }

    static string SectionOf(List<Section> sections, int line)
    {
        foreach (var s in sections)
            if (line > s.marker && line < s.end) return s.key + ":" + (line - s.marker).ToString(CultureInfo.InvariantCulture);
        return null;
    }

    // ───────────────────────────── materyal

    // jsonPath: <ad>.mat.json. Dönen: Assets/UnityPreview/Materials/<ad>.mat
    public static string Import(string jsonPath)
    {
        jsonPath = jsonPath.Replace('\\', '/');
        if (!File.Exists(jsonPath)) throw new FileNotFoundException("JSON bulunamadı: " + jsonPath);
        var root = Json.Parse(File.ReadAllText(jsonPath, Encoding.UTF8)) as Dictionary<string, object>;
        if (root == null) throw new Exception("JSON kökü bir nesne değil");
        string format = Str(root, "format", Format);
        if (format != Format) Debug.LogWarning(Tag + "beklenmeyen format '" + format + "' (" + Format + " bekleniyordu), yine de deneniyor");

        string fileName = BaseName(jsonPath);
        string matPath = MatDir + "/" + fileName + ".mat";
        string shaderName = Str(root, "shaderName", "").Trim();
        if (shaderName.Length == 0) throw new Exception("shaderName yok");
        var shader = FindShader(shaderName);
        if (shader == null)
            throw new Exception("shader bulunamadı: " + shaderName + (shaderName.StartsWith(CustomPrefix, StringComparison.Ordinal)
                ? " (Assets/UnityPreview/Shaders'a yazılmadı ya da ShaderLab hatası var; durum dosyasındaki shader satırına bak)" : ""));
        EnsureFolder(MatDir);

        var mat = AssetDatabase.LoadAssetAtPath<Material>(matPath);
        bool created = mat == null;
        if (created) mat = new Material(shader);
        else if (mat.shader != shader) mat.shader = shader;
        mat.name = fileName;

        var values = Obj(root, "values");
        var textures = Obj(root, "textures");
        foreach (var po in Arr(root, "properties"))
        {
            if (!(po is Dictionary<string, object> p)) continue;
            string pn = Str(p, "name", "").Trim();
            string type = Str(p, "type", "");
            if (pn.Length == 0) continue;
            if (!mat.HasProperty(pn)) { Debug.LogWarning(Tag + fileName + ": '" + pn + "' " + shaderName + " shader'ında yok, atlandı"); continue; }
            if (!values.TryGetValue(pn, out var v) || v == null) continue; // shader varsayılanı kalır
            string where = fileName + "." + pn;
            switch (type)
            {
                case "color":
                    mat.SetColor(pn, ParseColor(v, Color.white, where)); // sRGB; Linear projede Unity doğrusala çevirir
                    break;
                case "hdrColor":
                {
                    Color c; float k = 1f;
                    if (v is Dictionary<string, object> hd) { c = ParseColor(hd.TryGetValue("color", out var cc) ? cc : null, Color.white, where); k = Mathf.Max(0f, Num(hd, "intensity", 1f)); }
                    else c = ParseColor(v, Color.white, where);
                    Color lin = c.linear * k; // doğrusal = renk × şiddet
                    lin.a = c.a;
                    // Unity [HDR] renkleri doğrusal sayar (çevirmez; Unity'de ölçüldü). [HDR] olmayan renk özelliğinde Linear projede
                    // SetColor değeri gamma sayıp doğrusala çevirir → orada doğrusal hedefin gamma karşılığı verilir.
                    int pi = mat.shader.FindPropertyIndex(pn);
                    bool hdr = pi >= 0 && (mat.shader.GetPropertyFlags(pi) & UnityEngine.Rendering.ShaderPropertyFlags.HDR) != 0;
                    mat.SetColor(pn, hdr || PlayerSettings.colorSpace != ColorSpace.Linear ? lin : lin.gamma);
                    break;
                }
                case "float":
                case "range":
                    mat.SetFloat(pn, ToF(v, mat.GetFloat(pn)));
                    break;
                case "toggle":
                    mat.SetFloat(pn, v is bool b ? (b ? 1f : 0f) : (ToF(v, 0f) != 0f ? 1f : 0f));
                    break;
                case "vector":
                {
                    var l = v as List<object>; var d = mat.GetVector(pn);
                    mat.SetVector(pn, l == null ? d : new Vector4(l.Count > 0 ? ToF(l[0], d.x) : d.x, l.Count > 1 ? ToF(l[1], d.y) : d.y, l.Count > 2 ? ToF(l[2], d.z) : d.z, l.Count > 3 ? ToF(l[3], d.w) : d.w));
                    break;
                }
                case "texture":
                    ApplyTexture(mat, pn, v, textures, Bool(p, "linear", false), where);
                    break;
                default:
                    Debug.LogWarning(Tag + where + ": tip '" + type + "' bilinmiyor, atlandı");
                    break;
            }
        }

        bool urpSurface = Bool(root, "urpSurface", false);
        if (urpSurface) SetupUrpSurface(mat);
        int rq = Int(root, "renderQueue", -1);
        if (rq >= 0) mat.renderQueue = Mathf.Clamp(rq, 0, 5000);
        else if (!urpSurface) mat.renderQueue = -1; // shader'ınki (önceki elle kuyruk kalmasın)

        if (created) AssetDatabase.CreateAsset(mat, matPath); // varsa yeniden kullanılır → GUID korunur
        else EditorUtility.SetDirty(mat);
        AssetDatabase.SaveAssetIfDirty(mat);
        // Sunucu .mat mtime'ına bakıyor; içerik aynı olsa da "yeni aktarıldı" görünsün
        File.SetLastWriteTimeUtc(matPath, DateTime.UtcNow);
        return matPath;
    }

    static Shader FindShader(string name)
    {
        var sh = Shader.Find(name);
        if (sh == null && name.StartsWith(CustomPrefix, StringComparison.Ordinal))
            sh = AssetDatabase.LoadAssetAtPath<Shader>(ShaderDir + "/" + name.Substring(CustomPrefix.Length) + ".shader"); // yeni içe alındıysa
        return sh;
    }

    // texture değeri: { tex, tiling:[x,y], offset:[x,y], unityPath? } · tex: white/black/gray/bump/@mesh → shader varsayılanı (null)
    static void ApplyTexture(Material mat, string pn, object v, Dictionary<string, object> textures, bool linear, string where)
    {
        var tv = v as Dictionary<string, object> ?? new Dictionary<string, object> { { "tex", v as string ?? "" } };
        string texName = Str(tv, "tex", "").Trim();
        string unityPath = Str(tv, "unityPath", "").Trim().Replace('\\', '/');
        string path = null;
        if (unityPath.StartsWith("Assets/", StringComparison.Ordinal)) path = unityPath;
        else if (texName == "@mesh") Debug.LogWarning(Tag + where + ": '@mesh' için unityPath yok, shader varsayılanı kalır");
        else if (texName.Length > 0 && Array.IndexOf(BuiltinTextures, texName.ToLowerInvariant()) < 0)
        {
            if (textures.TryGetValue(texName, out var tp) && tp is string s && s.StartsWith("Assets/", StringComparison.Ordinal)) path = s.Replace('\\', '/');
            else
            {
                string guess = MatDir + "/Textures/" + texName + ".png";
                if (File.Exists(guess)) path = guess;
                else Debug.LogWarning(Tag + where + ": doku '" + texName + "' gönderilmedi (" + guess + " yok), shader varsayılanı kalır");
            }
        }
        if (path != null && (path.Contains("..") || Path.IsPathRooted(path))) { Debug.LogWarning(Tag + where + ": geçersiz doku yolu '" + path + "'"); path = null; }
        mat.SetTexture(pn, path != null ? LoadTexture(path, linear, where) : null);
        mat.SetTextureScale(pn, V2(tv, "tiling", Vector2.one));
        mat.SetTextureOffset(pn, V2(tv, "offset", Vector2.zero));
    }

    static Texture LoadTexture(string path, bool linear, string where)
    {
        if (!File.Exists(path)) { Debug.LogWarning(Tag + where + ": doku yok: " + path); return null; }
        AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport); // değişmediyse işlem yapmaz
        // İmport ayarı yalnız UnityPreview'in kendi dokularında (oyun dokularının .meta'sına yazılmaz)
        if (path.StartsWith(Root + "/", StringComparison.Ordinal) && AssetImporter.GetAtPath(path) is TextureImporter ti)
        {
            if (texLinearThisRun.TryGetValue(path, out bool was) && was != linear)
                Debug.LogWarning(Tag + where + ": " + path + " başka bir özellikte " + (was ? "doğrusal" : "sRGB") + " kullanıldı; son ayar (" + (linear ? "doğrusal" : "sRGB") + ") geçerli");
            texLinearThisRun[path] = linear;
            bool changed = false;
            if (ti.textureType != TextureImporterType.Default) { ti.textureType = TextureImporterType.Default; changed = true; }
            if (ti.sRGBTexture != !linear) { ti.sRGBTexture = !linear; changed = true; }
            if (ti.alphaSource != TextureImporterAlphaSource.FromInput) { ti.alphaSource = TextureImporterAlphaSource.FromInput; changed = true; }
            if (ti.alphaIsTransparency != !linear) { ti.alphaIsTransparency = !linear; changed = true; }
            if (ti.wrapModeU != TextureWrapMode.Repeat || ti.wrapModeV != TextureWrapMode.Repeat || ti.wrapModeW != TextureWrapMode.Repeat)
            { ti.wrapMode = TextureWrapMode.Repeat; changed = true; }
            if (!ti.mipmapEnabled) { ti.mipmapEnabled = true; changed = true; }
            if (changed) ti.SaveAndReimport();
        }
        var tex = AssetDatabase.LoadAssetAtPath<Texture>(path);
        if (tex == null) Debug.LogWarning(Tag + where + ": doku yüklenemedi: " + path);
        return tex;
    }

    // ───────────────────────────── URP yüzey kurulumu
    // URP 17 BaseShaderGUI.SetupMaterialBlendModeInternal + UpdateMaterialSurfaceOptions + SetMaterialKeywords karşılığı
    // (derleme bağımlılığı yok). _Surface: 0 opak, 1 saydam · _Blend: 0 alfa, 1 premultiply, 2 additive, 3 multiply ·
    // _Cull: 0 kapalı, 1 ön, 2 arka · _AlphaClip + _Cutoff

    static void SetupUrpSurface(Material mat)
    {
        bool alphaClip = mat.HasProperty("_AlphaClip") && mat.GetFloat("_AlphaClip") >= 0.5f;
        SetKeyword(mat, "_ALPHATEST_ON", alphaClip);

        int queue = mat.shader.renderQueue;
        mat.SetOverrideTag("RenderType", "");
        bool transparent = false;
        if (mat.HasProperty("_Surface"))
        {
            transparent = mat.GetFloat("_Surface") >= 0.5f;
            SetKeyword(mat, "_SURFACE_TYPE_TRANSPARENT", transparent);
            bool zwrite, alphaToMask = false;
            if (!transparent)
            {
                if (alphaClip) { queue = (int)UnityEngine.Rendering.RenderQueue.AlphaTest; mat.SetOverrideTag("RenderType", "TransparentCutout"); alphaToMask = true; }
                else { queue = (int)UnityEngine.Rendering.RenderQueue.Geometry; mat.SetOverrideTag("RenderType", "Opaque"); }
                SetBlend(mat, BlendMode.One, BlendMode.Zero, BlendMode.One, BlendMode.Zero);
                zwrite = true;
                mat.DisableKeyword("_ALPHAPREMULTIPLY_ON");
                mat.DisableKeyword("_ALPHAMODULATE_ON");
            }
            else
            {
                int blend = Mathf.RoundToInt(mat.HasProperty("_Blend") ? mat.GetFloat("_Blend") : 0f);
                BlendMode src = BlendMode.One, dst = BlendMode.OneMinusSrcAlpha, srcA = BlendMode.One, dstA = BlendMode.OneMinusSrcAlpha;
                switch (blend)
                {
                    case 0: src = BlendMode.SrcAlpha; dst = BlendMode.OneMinusSrcAlpha; srcA = BlendMode.One; dstA = dst; break; // alfa
                    case 1: src = BlendMode.One; dst = BlendMode.OneMinusSrcAlpha; srcA = src; dstA = dst; break;              // premultiply
                    case 2: src = BlendMode.SrcAlpha; dst = BlendMode.One; srcA = BlendMode.One; dstA = dst; break;            // additive
                    case 3: src = BlendMode.DstColor; dst = BlendMode.Zero; srcA = BlendMode.Zero; dstA = BlendMode.One; break; // multiply
                }
                // Lit'te _BlendModePreserveSpecular (varsayılan 1): alfa çarpımı shader'a taşınır
                bool preserveSpecular = mat.HasProperty("_BlendModePreserveSpecular") && mat.GetFloat("_BlendModePreserveSpecular") > 0f && blend != 3 && blend != 1;
                if (preserveSpecular) src = BlendMode.One;
                SetBlend(mat, src, dst, srcA, dstA);
                SetKeyword(mat, "_ALPHAPREMULTIPLY_ON", preserveSpecular);
                SetKeyword(mat, "_ALPHAMODULATE_ON", blend == 3);
                mat.SetOverrideTag("RenderType", "Transparent");
                zwrite = false;
                queue = (int)UnityEngine.Rendering.RenderQueue.Transparent;
            }
            if (mat.HasProperty("_AlphaToMask")) mat.SetFloat("_AlphaToMask", alphaToMask ? 1f : 0f);
            if (mat.HasProperty("_ZWrite")) mat.SetFloat("_ZWrite", zwrite ? 1f : 0f);
            mat.SetShaderPassEnabled("DepthOnly", zwrite);
        }
        else mat.SetShaderPassEnabled("DepthOnly", true);
        if (mat.HasProperty("_QueueOffset")) queue += (int)mat.GetFloat("_QueueOffset");
        mat.renderQueue = queue;

        // gölge: _CastShadows yoksa opaklığa göre (Lit/Unlit davranışı)
        bool castShadows = mat.HasProperty("_CastShadows") ? mat.GetFloat("_CastShadows") != 0f : !transparent;
        mat.SetShaderPassEnabled("ShadowCaster", castShadows);
        if (mat.HasProperty("_ReceiveShadows")) SetKeyword(mat, "_RECEIVE_SHADOWS_OFF", mat.GetFloat("_ReceiveShadows") == 0f);
        if (mat.HasProperty("_Cull")) mat.doubleSidedGI = Mathf.RoundToInt(mat.GetFloat("_Cull")) != 2; // RenderFace.Front = 2

        // SetMaterialKeywords: lightmapper için _MainTex/_Color eşlemesi, normal haritası, emisyon
        if (mat.HasProperty("_MainTex") && mat.HasProperty("_BaseMap"))
        {
            mat.SetTexture("_MainTex", mat.GetTexture("_BaseMap"));
            mat.SetTextureScale("_MainTex", mat.GetTextureScale("_BaseMap"));
            mat.SetTextureOffset("_MainTex", mat.GetTextureOffset("_BaseMap"));
        }
        if (mat.HasProperty("_Color") && mat.HasProperty("_BaseColor")) mat.SetColor("_Color", mat.GetColor("_BaseColor"));
        if (mat.HasProperty("_BumpMap")) SetKeyword(mat, "_NORMALMAP", mat.GetTexture("_BumpMap") != null);
        if (mat.HasProperty("_EmissionColor"))
        {
            var e = mat.GetColor("_EmissionColor");
            bool emissive = e.maxColorComponent > 1e-4f;
            var flags = mat.globalIlluminationFlags;
            if (emissive)
            {
                flags &= ~MaterialGlobalIlluminationFlags.EmissiveIsBlack;
                if ((flags & MaterialGlobalIlluminationFlags.AnyEmissive) == 0) flags |= MaterialGlobalIlluminationFlags.BakedEmissive;
            }
            else flags |= MaterialGlobalIlluminationFlags.EmissiveIsBlack;
            mat.globalIlluminationFlags = flags;
            SetKeyword(mat, "_EMISSION", emissive);
        }
    }

    static void SetBlend(Material mat, BlendMode src, BlendMode dst, BlendMode srcA, BlendMode dstA)
    {
        if (mat.HasProperty("_SrcBlend")) mat.SetFloat("_SrcBlend", (float)src);
        if (mat.HasProperty("_DstBlend")) mat.SetFloat("_DstBlend", (float)dst);
        if (mat.HasProperty("_SrcBlendAlpha")) mat.SetFloat("_SrcBlendAlpha", (float)srcA);
        if (mat.HasProperty("_DstBlendAlpha")) mat.SetFloat("_DstBlendAlpha", (float)dstA);
    }

    static void SetKeyword(Material mat, string kw, bool on)
    {
        if (on) mat.EnableKeyword(kw); else mat.DisableKeyword(kw);
    }

    // ───────────────────────────── yardımcılar

    static Color ParseColor(object o, Color def, string where)
    {
        if (o is string s)
        {
            s = s.Trim();
            if (!s.StartsWith("#")) s = "#" + s;
            if (ColorUtility.TryParseHtmlString(s, out var c)) return c; // #rgb, #rrggbb, #rrggbbaa
        }
        else if (o is List<object> l && l.Count >= 3) // [r,g,b,a] gamma değerleri (1'i aşabilir; Unity materyalindeki gibi)
            return new Color(ToF(l[0], 1f), ToF(l[1], 1f), ToF(l[2], 1f), l.Count > 3 ? ToF(l[3], 1f) : 1f);
        Debug.LogWarning(Tag + where + ": geçersiz renk '" + o + "', varsayılan kullanıldı");
        return def;
    }

    static string BaseName(string path)
    {
        string f = Path.GetFileName(path);
        if (f.EndsWith(Ext, StringComparison.OrdinalIgnoreCase)) return f.Substring(0, f.Length - Ext.Length);
        return Path.GetFileNameWithoutExtension(f);
    }

    static string OneLine(string s) => (s ?? "").Replace("\r", " ").Replace("\n", " ").Replace("|", "/"); // '|' durum satırı ayıracı

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

    static Vector2 V2(Dictionary<string, object> d, string k, Vector2 def)
    {
        if (d == null || !d.TryGetValue(k, out var v) || !(v is List<object> l)) return def;
        return new Vector2(l.Count > 0 ? ToF(l[0], def.x) : def.x, l.Count > 1 ? ToF(l[1], def.y) : def.y);
    }

    // ───────────────────────────── küçük JSON ayrıştırıcı (UnityPreviewVfxImporter'dakinin kopyası)
    // JsonUtility sözlük / karışık tip okuyamaz. Çıktı: Dictionary<string,object>, List<object>, double, string, bool, null.
    // Sayılar InvariantCulture (makine Türkçe yerel ayarlı: ondalık virgül tuzağı).
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
