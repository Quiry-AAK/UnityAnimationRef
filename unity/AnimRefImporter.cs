// Anim Ref editöründen çıkan *.animref.json dosyasını AnimationClip (.anim) yapar.
// Kullanım: bu dosyayı projede bir "Editor" klasörüne koy → Tools > Anim Ref > Import.
//  - Generic: Transform eğrileri (Mixamo FBX'in kendisi / Generic rig ile birebir).
//  - Humanoid: Karakter Humanoid avatar ise kareleri HumanPoseHandler ile muscle eğrilerine bake eder.
// Karakter (hedef) bind/T-pose'ta olmalı: rest pozu hedeften okunur.
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
        public Transform t; public TrackInfo track; public BoneInfo info;
        public Quaternion unityRestQ; public Vector3 unityRestP; public float posRatio;
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
            var infos = new Dictionary<string, BoneInfo>();
            foreach (var b in data.bones) infos[b.name] = b;

            var bound = new List<Bound>();
            var missing = new List<string>();
            foreach (var tr in data.trackList)
            {
                if (!byNorm.TryGetValue(Norm(tr.bone), out var t)) { missing.Add(tr.bone); continue; }
                var info = infos[tr.bone];
                var bd = new Bound { t = t, track = tr, info = info, unityRestQ = t.localRotation, unityRestP = t.localPosition };
                var r3 = new Vector3(info.restP[0], info.restP[1], info.restP[2]);
                bd.posRatio = r3.magnitude > 1e-4f ? t.localPosition.magnitude / r3.magnitude : data.unitScale;
                if (bd.posRatio < 1e-6f) bd.posRatio = data.unitScale;
                bound.Add(bd);
            }
            if (bound.Count == 0) throw new Exception("Hiçbir kemik eşleşmedi. Hedef Mixamo rigi mi?");

            void Apply(float frame)
            {
                foreach (var b in bound)
                {
                    if (b.track.rot != null && b.track.rot.Length >= 5)
                    {
                        var r3 = new Quaternion(b.info.restQ[0], b.info.restQ[1], b.info.restQ[2], b.info.restQ[3]);
                        var q3 = EvalRot(b.track.rot, frame);
                        b.t.localRotation = Mirror(q3 * Quaternion.Inverse(r3)) * b.unityRestQ;
                    }
                    if (b.track.pos != null && b.track.pos.Length >= 4)
                    {
                        var dp = EvalPos(b.track.pos, frame) - new Vector3(b.info.restP[0], b.info.restP[1], b.info.restP[2]);
                        b.t.localPosition = b.unityRestP + new Vector3(-dp.x, dp.y, dp.z) * b.posRatio;
                    }
                }
            }

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
                        if (b.track.rot != null && b.track.rot.Length >= 5)
                        {
                            var q = b.t.localRotation;
                            L(path + "|localRotation.x").Add(q.x); L(path + "|localRotation.y").Add(q.y); L(path + "|localRotation.z").Add(q.z); L(path + "|localRotation.w").Add(q.w);
                        }
                        if (b.track.pos != null && b.track.pos.Length >= 4)
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
                    AnimationUtility.SetEditorCurve(clip, EditorCurveBinding.FloatCurve("", typeof(Animator), HumanTrait.MuscleName[i]), LinearCurve(times, muscle[i]));
            }

            var settings = AnimationUtility.GetAnimationClipSettings(clip);
            settings.loopTime = data.loop;
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
