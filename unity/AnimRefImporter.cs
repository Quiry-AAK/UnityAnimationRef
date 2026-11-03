// Anim Ref editöründen çıkan *.animref.json dosyasını AnimationClip (.anim) yapar.
// Kullanım: bu dosyayı projede bir "Editor" klasörüne koy → Tools > Anim Ref > Import.
//  - Generic: Transform eğrileri (Mixamo FBX'in kendisi / Generic rig ile birebir).
//  - Humanoid: Karakter Humanoid avatar ise kareleri HumanPoseHandler ile muscle eğrilerine bake eder.
// Retarget dünya uzayında: hedefin rest pozu (A-poz vb.) kaynaktan (T-poz) farklı olabilir, kemik dünya dönüşleri aynalı aktarılır.
#if UNITY_EDITOR
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEngine;
using Object = UnityEngine.Object;

public static class AnimRefImporter
{
    public enum Mode { Auto, Generic, Humanoid }

    [Serializable] class BoneInfo { public string name, parent; public float[] restQ, restP; }
    [Serializable] class TrackInfo { public string bone; public float[] rot, pos; }
    [Serializable] class PropInfo { public string id, prop, bone; public float[] pos, rot; public float scale; }
    [Serializable] class Data { public string format, name; public float fps, unitScale; public int length; public bool loop; public BoneInfo[] bones; public TrackInfo[] trackList; public PropInfo[] props; }

    static string Norm(string s)
    {
        var sb = new StringBuilder();
        foreach (var c in s) if (char.IsLetterOrDigit(c)) sb.Append(c);
        return sb.ToString();
    }

    static Quaternion Mirror(Quaternion q) => new Quaternion(q.x, -q.y, -q.z, q.w); // sağ-el -> sol-el (X ayna)

    // Klip eğri adı: gövde kaslarında HumanTrait.MuscleName ile aynı, parmaklarda farklı
    // ("Left Index 1 Stretched" -> "LeftHand.Index.1 Stretched", "Left Thumb Spread" -> "LeftHand.Thumb.Spread")
    static string MuscleAttribute(string muscle)
    {
        foreach (var side in new[] { "Left", "Right" })
        {
            if (!muscle.StartsWith(side + " ")) continue;
            var p = muscle.Substring(side.Length + 1).Split(' ');
            if (Array.IndexOf(new[] { "Thumb", "Index", "Middle", "Ring", "Little" }, p[0]) < 0) continue;
            if (p.Length == 3) return side + "Hand." + p[0] + "." + p[1] + " " + p[2];
            if (p.Length == 2) return side + "Hand." + p[0] + "." + p[1];
        }
        return muscle;
    }

    static Quaternion EvalRot(float[] a, float f)
    {
        int n = a.Length / 5;
        Quaternion Q(int i) => new Quaternion(a[i * 5 + 1], a[i * 5 + 2], a[i * 5 + 3], a[i * 5 + 4]);
        if (f <= a[0]) return Q(0);
        if (f >= a[(n - 1) * 5]) return Q(n - 1);
        int k = 0; while (a[(k + 1) * 5] <= f) k++;
        float t = (f - a[k * 5]) / (a[(k + 1) * 5] - a[k * 5]);
        var q0 = Q(k); var q1 = Q(k + 1);
        if (Quaternion.Dot(q0, q1) < 0) q1 = new Quaternion(-q1.x, -q1.y, -q1.z, -q1.w);
        return Quaternion.Slerp(q0, q1, t);
    }

    static Vector3 EvalPos(float[] a, float f)
    {
        int n = a.Length / 4;
        Vector3 P(int i) => new Vector3(a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]);
        if (f <= a[0]) return P(0);
        if (f >= a[(n - 1) * 4]) return P(n - 1);
        int k = 0; while (a[(k + 1) * 4] <= f) k++;
        return Vector3.Lerp(P(k), P(k + 1), (f - a[k * 4]) / (a[(k + 1) * 4] - a[k * 4]));
    }

    static AnimationCurve LinearCurve(List<float> times, List<float> values)
    {
        var keys = new Keyframe[times.Count];
        for (int i = 0; i < keys.Length; i++)
        {
            float inT = i > 0 ? (values[i] - values[i - 1]) / (times[i] - times[i - 1]) : 0f;
            float outT = i < keys.Length - 1 ? (values[i + 1] - values[i]) / (times[i + 1] - times[i]) : 0f;
            keys[i] = new Keyframe(times[i], values[i], inT, outT);
        }
        return new AnimationCurve(keys);
    }

    class Bound
    {
        public BoneInfo info; public Bound parent; public Transform t; public TrackInfo track;
        public Quaternion unityRestQ, k = Quaternion.identity; public Vector3 unityRestP; public float posRatio;
        public Quaternion wg; public Vector3 pg; public bool write; // wg/pg: UPE dünya dönüşü/konumu (karakter kökü = kimlik)
    }

    static Vector3 V3(float[] a) => new Vector3(a[0], a[1], a[2]);
    static Vector3 MirrorP(Vector3 p) => new Vector3(-p.x, p.y, p.z);
    const float AxisMatchDeg = 10f;

    // UPE ileri kinematik (sağ-el); izi olmayan kemik rest'te kalır
    static void Fk(Bound b, float frame, bool rest = false)
    {
        var tr = rest ? null : b.track;
        var lq = tr?.rot != null && tr.rot.Length >= 5 ? EvalRot(tr.rot, frame) : new Quaternion(b.info.restQ[0], b.info.restQ[1], b.info.restQ[2], b.info.restQ[3]);
        var lp = tr?.pos != null && tr.pos.Length >= 4 ? EvalPos(tr.pos, frame) : V3(b.info.restP);
        b.wg = b.parent == null ? lq : Quaternion.Normalize(b.parent.wg * lq);
        b.pg = b.parent == null ? lp : b.parent.pg + b.parent.wg * lp;
    }

    // Dünya uzayı retarget. Rest pozlar farklı olabilir (UPE Player.glb T-poz, Unity Player.fbx A-poz): rest'e göre yerel delta
    // A-poz kolun üstüne binip zincir boyunca kayar. Bunun yerine her kemiğin UPE dünya dönüşü hedefe aynalı verilir: Wu = Mirror(Wg).
    // Bu, kemik eksenleri iki rigde aynıysa (Mixamo) doğrudur; çocuk kemiğin yerel ofseti (pozdan bağımsız) hedefte başka yöne
    // bakıyorsa eksenler farklıdır, o kemikte rest'ler aynı poz sayılır: Wu = Mirror(Wg) * K, K = inv(Mirror(WgRest)) * WuRest.
    static List<Bound> Bind(Data data, Transform root, Dictionary<string, Transform> byNorm)
    {
        var tracks = new Dictionary<string, TrackInfo>();
        foreach (var tr in data.trackList) tracks[tr.bone] = tr;
        var byName = new Dictionary<string, Bound>();
        foreach (var b in data.bones) byName[b.name] = new Bound { info = b };
        var order = new List<Bound>(); // ebeveyn önce
        void Add(Bound b)
        {
            if (order.Contains(b)) return;
            if (b.info.parent != null && byName.TryGetValue(b.info.parent, out var p)) { b.parent = p; Add(p); }
            order.Add(b);
        }
        foreach (var b in data.bones) Add(byName[b.name]);

        var axesMatch = new Dictionary<Bound, bool>();
        foreach (var b in order)
        {
            tracks.TryGetValue(b.info.name, out b.track);
            Fk(b, 0, true);
            if (!byNorm.TryGetValue(Norm(b.info.name), out b.t)) continue;
            b.unityRestQ = b.t.localRotation; b.unityRestP = b.t.localPosition;
            var r3 = V3(b.info.restP);
            b.posRatio = r3.magnitude > 1e-4f ? b.t.localPosition.magnitude / r3.magnitude : data.unitScale;
            if (b.posRatio < 1e-6f) b.posRatio = data.unitScale;
        }
        foreach (var b in order)
        {
            if (b.t == null) continue;
            float worst = -1f;
            foreach (var c in order)
                if (c.parent == b && c.t != null && c.t.parent == b.t && c.t.localPosition.magnitude > 1e-5f && V3(c.info.restP).magnitude > 1e-5f)
                    worst = Mathf.Max(worst, Vector3.Angle(MirrorP(V3(c.info.restP)), c.t.localPosition));
            // uç kemik (çocuksuz): ebeveynin kararı
            bool match = worst >= 0f ? worst < AxisMatchDeg : b.parent == null || !axesMatch.TryGetValue(b.parent, out var pm) || pm;
            axesMatch[b] = match;
            if (match) continue;
            b.k = Quaternion.Inverse(Mirror(b.wg)) * (Quaternion.Inverse(root.rotation) * b.t.rotation);
            Debug.LogWarning($"AnimRef: {b.info.name} kemik eksenleri hedefte farklı ({worst:F0}°); bu kemikte rest pozlar aynı varsayıldı");
        }
        // kök: model uzayında mutlak konum, hedef/kaynak yükseklik oranıyla
        foreach (var b in order)
            if (b.parent == null && b.t != null && b.pg.magnitude > 1e-4f)
                b.posRatio = root.InverseTransformPoint(b.t.position).magnitude / b.pg.magnitude;
        return order;
    }

    // Ana giriş. targetRoot: karakterin kökü (Animator'ın olduğu obje). Dönen: oluşturulan clip.
    public static AnimationClip Import(string jsonPath, GameObject targetRoot, string outAssetPath, Mode mode = Mode.Auto)
    {
        var data = JsonUtility.FromJson<Data>(File.ReadAllText(jsonPath));
        if (data == null || data.format != "animref-1") throw new Exception("Geçersiz animref JSON");

        var animatorSrc = targetRoot.GetComponentInChildren<Animator>();
        bool humanoid = mode == Mode.Humanoid || (mode == Mode.Auto && animatorSrc != null && animatorSrc.avatar != null && animatorSrc.avatar.isHuman);
        if (mode == Mode.Humanoid && (animatorSrc == null || animatorSrc.avatar == null || !animatorSrc.avatar.isHuman))
            throw new Exception("Humanoid modu için hedefte Humanoid avatarlı Animator gerekli");

        // Hedefin geçici kopyası üzerinde çalış (sahne/prefab bozulmasın)
        var inst = Object.Instantiate(targetRoot);
        inst.hideFlags = HideFlags.HideAndDontSave;
        inst.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
        try
        {
            var byNorm = new Dictionary<string, Transform>();
            foreach (var t in inst.GetComponentsInChildren<Transform>(true)) byNorm[Norm(t.name)] = t;
            var root = inst.transform;
            var order = Bind(data, root, byNorm);
            var bound = order.FindAll(b => b.t != null);
            var missing = new List<string>();
            foreach (var tr in data.trackList)
                if (!bound.Exists(b => b.track == tr)) missing.Add(tr.bone);
            if (!bound.Exists(b => b.track != null)) throw new Exception("Hiçbir kemik eşleşmedi. Hedef Mixamo rigi mi?");

            void Apply(float frame)
            {
                foreach (var b in order)
                {
                    Fk(b, frame);
                    if (b.t == null) continue;
                    b.t.rotation = root.rotation * Mirror(b.wg) * b.k;
                    if (b.track?.pos == null || b.track.pos.Length < 4) continue;
                    if (b.parent == null) b.t.position = root.TransformPoint(MirrorP(b.pg) * b.posRatio);
                    else b.t.localPosition = b.unityRestP + MirrorP(EvalPos(b.track.pos, frame) - V3(b.info.restP)) * b.posRatio;
                }
            }

            // Generic: izli kemikler ve izsiz olup hedefin rest'inden farklı duranlar (ör. T/A poz farkı) yazılır
            Apply(0);
            foreach (var b in bound) b.write = b.track != null || Quaternion.Angle(b.t.localRotation, b.unityRestQ) > 0.1f;

            var clip = new AnimationClip { frameRate = data.fps, name = string.IsNullOrEmpty(data.name) ? "AnimRef" : data.name };
            int frames = Mathf.Max(2, data.length);
            var times = new List<float>(frames);
            for (int f = 0; f < frames; f++) times.Add(f / data.fps);

            if (!humanoid)
            {
                var curves = new Dictionary<string, List<float>>();
                List<float> L(string key) { if (!curves.TryGetValue(key, out var l)) curves[key] = l = new List<float>(frames); return l; }
                for (int f = 0; f < frames; f++)
                {
                    Apply(f);
                    foreach (var b in bound)
                    {
                        string path = AnimationUtility.CalculateTransformPath(b.t, inst.transform);
                        if (b.write)
                        {
                            var q = b.t.localRotation;
                            L(path + "|localRotation.x").Add(q.x); L(path + "|localRotation.y").Add(q.y); L(path + "|localRotation.z").Add(q.z); L(path + "|localRotation.w").Add(q.w);
                        }
                        if (b.track?.pos != null && b.track.pos.Length >= 4)
                        {
                            var p = b.t.localPosition;
                            L(path + "|localPosition.x").Add(p.x); L(path + "|localPosition.y").Add(p.y); L(path + "|localPosition.z").Add(p.z);
                        }
                    }
                }
                foreach (var kv in curves)
                {
                    var split = kv.Key.Split('|');
                    clip.SetCurve(split[0], typeof(Transform), split[1], LinearCurve(times, kv.Value));
                }
                clip.EnsureQuaternionContinuity();
            }
            else
            {
                var animator = inst.GetComponentInChildren<Animator>();
                var handler = new HumanPoseHandler(animator.avatar, animator.transform);
                var pose = new HumanPose();
                int mc = HumanTrait.MuscleCount;
                var muscle = new List<float>[mc]; for (int i = 0; i < mc; i++) muscle[i] = new List<float>(frames);
                var rt = new List<float>[7]; for (int i = 0; i < 7; i++) rt[i] = new List<float>(frames);
                for (int f = 0; f < frames; f++)
                {
                    Apply(f);
                    handler.GetHumanPose(ref pose);
                    for (int i = 0; i < mc; i++) muscle[i].Add(pose.muscles[i]);
                    rt[0].Add(pose.bodyPosition.x); rt[1].Add(pose.bodyPosition.y); rt[2].Add(pose.bodyPosition.z);
                    rt[3].Add(pose.bodyRotation.x); rt[4].Add(pose.bodyRotation.y); rt[5].Add(pose.bodyRotation.z); rt[6].Add(pose.bodyRotation.w);
                }
                handler.Dispose();
                string[] rn = { "RootT.x", "RootT.y", "RootT.z", "RootQ.x", "RootQ.y", "RootQ.z", "RootQ.w" };
                for (int i = 0; i < 7; i++)
                    AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("", typeof(Animator), rn[i]), LinearCurve(times, rt[i]));
                for (int i = 0; i < mc; i++)
                    AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("", typeof(Animator), MuscleAttribute(HumanTrait.MuscleName[i])), LinearCurve(times, muscle[i]));
            }

            var settings = AnimationUtility.GetAnimationClipSettings(clip);
            settings.loopTime = data.loop;
            if (humanoid)
            {
                // Editörde kök hiç hareket etmez, gövde (Hips) yerel olarak oynar: kök hareketi poza gömülü, orijinal konum/yönelim korunur
                settings.loopBlendOrientation = settings.loopBlendPositionY = settings.loopBlendPositionXZ = true;
                settings.keepOriginalOrientation = settings.keepOriginalPositionY = settings.keepOriginalPositionXZ = true;
            }
            AnimationUtility.SetAnimationClipSettings(clip, settings);

            Directory.CreateDirectory(Path.GetDirectoryName(outAssetPath) ?? "Assets");
            var existing = AssetDatabase.LoadAssetAtPath<AnimationClip>(outAssetPath);
            if (existing != null) { EditorUtility.CopySerialized(clip, existing); clip = existing; EditorUtility.SetDirty(existing); }
            else AssetDatabase.CreateAsset(clip, outAssetPath);
            AssetDatabase.SaveAssets(); AssetDatabase.Refresh();
            if (missing.Count > 0) Debug.LogWarning("AnimRef: eşleşmeyen kemikler: " + string.Join(", ", missing));
            Debug.Log($"AnimRef: {outAssetPath} ({(humanoid ? "Humanoid" : "Generic")}, {frames} kare, {bound.Count} kemik)");
            return clip;
        }
        finally { Object.DestroyImmediate(inst); }
    }


    // ---- Eşyalar (silah vb.): JSON'daki props'u karakterin kemiklerine ekler ----
    // Karakter bind/T-pose'ta olmalı. builtin:* eşyalar basit primitiflerle üretilir; dosya eşyaları
    // projedeki aynı adlı prefab/model ile eşleşir (bulunamazsa küp yer tutucu). Sahnedeki karaktere eklenir.
    static readonly Dictionary<string, (Vector3 size, Vector3 pos)[]> Builtin = new Dictionary<string, (Vector3, Vector3)[]>
    {
        ["pistol"] = new[] { (new Vector3(0.032f, 0.11f, 0.045f), new Vector3(0, -0.02f, -0.005f)), (new Vector3(0.036f, 0.045f, 0.19f), new Vector3(0, 0.055f, 0.06f)), (new Vector3(0.02f, 0.03f, 0.05f), new Vector3(0, 0, 0.04f)) },
        ["rifle"] = new[] { (new Vector3(0.05f, 0.07f, 0.55f), new Vector3(0, 0.04f, 0.2f)), (new Vector3(0.035f, 0.1f, 0.04f), new Vector3(0, -0.03f, 0)), (new Vector3(0.045f, 0.09f, 0.2f), new Vector3(0, 0.03f, -0.2f)), (new Vector3(0.02f, 0.02f, 0.3f), new Vector3(0, 0.05f, 0.62f)), (new Vector3(0.03f, 0.14f, 0.06f), new Vector3(0, -0.07f, 0.2f)) },
        ["sword"] = new[] { (new Vector3(0.03f, 0.12f, 0.03f), new Vector3(0, 0, 0)), (new Vector3(0.12f, 0.02f, 0.04f), new Vector3(0, 0.07f, 0)), (new Vector3(0.04f, 0.8f, 0.01f), new Vector3(0, 0.48f, 0)) },
        ["box"] = new[] { (new Vector3(0.2f, 0.2f, 0.2f), Vector3.zero) },
    };

    static GameObject BuildProp(string prop)
    {
        var root = new GameObject("prop");
        if (prop.StartsWith("builtin:"))
        {
            if (!Builtin.TryGetValue(prop.Substring(8), out var parts)) parts = Builtin["box"];
            foreach (var (size, pos) in parts)
            {
                var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Object.DestroyImmediate(c.GetComponent<Collider>());
                c.transform.SetParent(root.transform, false);
                c.transform.localScale = size; c.transform.localPosition = new Vector3(-pos.x, pos.y, pos.z);
            }
            return root;
        }
        string nameOnly = Path.GetFileNameWithoutExtension(prop);
        GameObject asset = null;
        foreach (var guid in AssetDatabase.FindAssets(nameOnly + " t:GameObject"))
        {
            var p = AssetDatabase.GUIDToAssetPath(guid);
            if (Path.GetFileNameWithoutExtension(p) == nameOnly) { asset = AssetDatabase.LoadAssetAtPath<GameObject>(p); break; }
        }
        if (asset == null)
        {
            Debug.LogWarning("AnimRef: eşya asset'i bulunamadı (" + prop + "), küp yer tutucu kullanıldı");
            var c = GameObject.CreatePrimitive(PrimitiveType.Cube); Object.DestroyImmediate(c.GetComponent<Collider>());
            c.transform.SetParent(root.transform, false); c.transform.localScale = Vector3.one * 0.2f; return root;
        }
        // editördeki gibi: 1 m'ye normalize et ve merkeze al
        var inst = (GameObject)PrefabUtility.InstantiatePrefab(asset);
        inst.transform.SetParent(root.transform, false);
        var b = new Bounds(); bool first = true;
        foreach (var r in inst.GetComponentsInChildren<Renderer>()) { if (first) { b = r.bounds; first = false; } else b.Encapsulate(r.bounds); }
        float max = Mathf.Max(b.size.x, b.size.y, b.size.z, 1e-6f);
        inst.transform.position -= b.center; // merkeze al (root kimlikte)
        root.transform.localScale = Vector3.one / max;
        var wrapper = new GameObject("prop"); root.transform.SetParent(wrapper.transform, false); return wrapper;
    }

    static Quaternion EulerXYZ(float rx, float ry, float rz)
    {
        Quaternion Ax(float a, Vector3 v) { float h = a * Mathf.Deg2Rad * 0.5f; return new Quaternion(v.x * Mathf.Sin(h), v.y * Mathf.Sin(h), v.z * Mathf.Sin(h), Mathf.Cos(h)); }
        return Ax(rx, Vector3.right) * Ax(ry, Vector3.up) * Ax(rz, Vector3.forward); // three.js XYZ (sağ-el)
    }

    public static GameObject[] AddProps(string jsonPath, GameObject character)
    {
        var data = JsonUtility.FromJson<Data>(File.ReadAllText(jsonPath));
        var result = new List<GameObject>();
        if (data?.props == null) return result.ToArray();
        var byNorm = new Dictionary<string, Transform>();
        foreach (var t in character.GetComponentsInChildren<Transform>(true)) byNorm[Norm(t.name)] = t;
        foreach (var p in data.props)
        {
            if (!byNorm.TryGetValue(Norm(p.bone), out var bone)) { Debug.LogWarning("AnimRef: eşya kemiği yok: " + p.bone); continue; }
            var pivot = new GameObject("AnimRefProp_" + p.prop.Replace("builtin:", "") + "_" + p.id);
            pivot.transform.SetPositionAndRotation(bone.position, Quaternion.identity); // dünya eksenlerine hizalı (bind pozda)
            pivot.transform.SetParent(bone, true);
            pivot.transform.localScale = Vector3.one / Mathf.Max(bone.lossyScale.x, 1e-6f);
            var item = BuildProp(p.prop);
            item.transform.SetParent(pivot.transform, false);
            item.transform.localPosition = new Vector3(-p.pos[0], p.pos[1], p.pos[2]);
            item.transform.localRotation = Mirror(EulerXYZ(p.rot[0], p.rot[1], p.rot[2]));
            item.transform.localScale *= p.scale;
            result.Add(pivot);
        }
        Debug.Log("AnimRef: " + result.Count + " eşya eklendi");
        return result.ToArray();
    }

    // Kod/MCP ile çağırmak için: targetPath "Assets/..." ise prefab, değilse sahnedeki obje adı.
    public static string ImportByPaths(string jsonPath, string targetPath, string outAssetPath, string mode = "Auto")
    {
        GameObject go = targetPath.StartsWith("Assets/") ? AssetDatabase.LoadAssetAtPath<GameObject>(targetPath) : GameObject.Find(targetPath);
        if (go == null) throw new Exception("Hedef bulunamadı: " + targetPath);
        Import(jsonPath, go, outAssetPath, (Mode)Enum.Parse(typeof(Mode), mode, true));
        return outAssetPath;
    }
}

public class AnimRefImportWindow : EditorWindow
{
    string jsonPath = ""; GameObject target; string outPath = "Assets/Animations/AnimRef.anim"; AnimRefImporter.Mode mode;

    [MenuItem("Tools/Anim Ref/Import")]
    static void Open() => GetWindow<AnimRefImportWindow>("Anim Ref");

    void OnGUI()
    {
        EditorGUILayout.LabelField("animref.json → AnimationClip", EditorStyles.boldLabel);
        EditorGUILayout.BeginHorizontal();
        jsonPath = EditorGUILayout.TextField("JSON", jsonPath);
        if (GUILayout.Button("…", GUILayout.Width(28))) { var p = EditorUtility.OpenFilePanel("animref.json", "", "json"); if (!string.IsNullOrEmpty(p)) { jsonPath = p; outPath = "Assets/Animations/" + Path.GetFileNameWithoutExtension(Path.GetFileNameWithoutExtension(p)) + ".anim"; } }
        EditorGUILayout.EndHorizontal();
        target = (GameObject)EditorGUILayout.ObjectField("Karakter (bind pozda)", target, typeof(GameObject), true);
        outPath = EditorGUILayout.TextField("Çıktı (.anim)", outPath);
        mode = (AnimRefImporter.Mode)EditorGUILayout.EnumPopup("Mod", mode);
        using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(jsonPath) || target == null))
            if (GUILayout.Button("Eşyaları karaktere ekle (sahne objesi, T-pose)"))
            {
                try { AnimRefImporter.AddProps(jsonPath, target); }
                catch (Exception e) { Debug.LogError("AnimRef: " + e.Message); }
            }
        using (new EditorGUI.DisabledScope(string.IsNullOrEmpty(jsonPath) || target == null))
            if (GUILayout.Button("Import"))
            {
                try { var c = AnimRefImporter.Import(jsonPath, target, outPath, mode); EditorGUIUtility.PingObject(c); }
                catch (Exception e) { Debug.LogError("AnimRef: " + e.Message); }
            }
    }
}
#endif
