// Epic araç seti uyum katmanı (docs/UNREAL.md "UE 5.9"). Gönderici araçları eski (UE ≤5.8) Python adlarıyla çağırır:
//   editor_toolset.toolsets.asset.AssetTools.exists { path }, …material.MaterialTools.add_expression { material_or_function, … }
// UE 5.9'da bu Python araç setleri kaldırıldı; yerlerinde C++ EditorToolset.* var (yöntemler PascalCase, argümanlar camelCase):
//   EditorToolset.AssetToolset.Exists { path }, EditorToolset.MaterialToolset.AddExpression { materialOrFunction, … }
// Niagara araç setinin adı aynı ama bazı argümanlar yeniden adlandırıldı (renderer → rendererRef …).
// Hangi kuşağın kayıtlı olduğu editörün araç seti listesinden bir kez anlaşılır (detectModern); çeviri saf (translateCall).

export const LEGACY_TO_MODERN = {
  'editor_toolset.toolsets.asset.AssetTools': 'EditorToolset.AssetToolset',
  'editor_toolset.toolsets.object.ObjectTools': 'EditorToolset.ObjectToolset',
  'editor_toolset.toolsets.material.MaterialTools': 'EditorToolset.MaterialToolset',
  'editor_toolset.toolsets.material_instance.MaterialInstanceTools': 'EditorToolset.MaterialInstanceToolset',
  'editor_toolset.toolsets.texture.TextureTools': 'EditorToolset.TextureToolset',
  'editor_toolset.toolsets.static_mesh.StaticMeshTools': 'EditorToolset.StaticMeshToolset',
};

// Niagara: UE 5.9 argüman adları (eski → yeni), araç başına
const NIAGARA_ARG_RENAMES = {
  SetRendererData: { renderer: 'rendererRef' },
  SetEmitterData: { emitter: 'emitterRef' },
  RemoveRenderer: { rendererToRemove: 'rendererRef' },
  RemoveEmitter: { emitterToRemove: 'emitterRef' },
};

// 5.9'da karşılığı olmayan eski araçlar: çağrı "bulunamadı" hatası verir (içe aktarma döngüsü sıradakini dener)
const MODERN_MISSING = new Set([
  'editor_toolset.toolsets.asset.AssetTools.import_file',
  'editor_toolset.toolsets.asset.AssetTools.import_asset',
  'editor_toolset.toolsets.static_mesh.StaticMeshTools.import_static_mesh',
]);

const pascal = (s) => s.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join('');
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };
const camelKeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.includes('_') ? camel(k) : k, v]));

// → [{ toolset, tool, args }] (sırayla çağrılacak; save_assets birden çok SaveAsset olur) ya da { missing: mesaj }
export function translateCall(modern, toolset, tool, args = {}) {
  if (!modern) return [{ toolset, tool, args }];
  if (toolset.startsWith('NiagaraToolsets.')) {
    const ren = NIAGARA_ARG_RENAMES[tool];
    if (!ren) return [{ toolset, tool, args }];
    return [{ toolset, tool, args: Object.fromEntries(Object.entries(args).map(([k, v]) => [ren[k] && !(ren[k] in args) ? ren[k] : k, v])) }];
  }
  const ts = LEGACY_TO_MODERN[toolset];
  if (!ts) return [{ toolset, tool, args }]; // zaten yeni ad ya da bilinmeyen araç seti: olduğu gibi
  if (MODERN_MISSING.has(`${toolset}.${tool}`)) return { missing: `${toolset}.${tool}: UE 5.9'da karşılığı yok (${ts})` };
  if (ts === 'EditorToolset.AssetToolset' && tool === 'save_assets') {
    return (args.asset_paths || args.assetPaths || []).map((p) => ({ toolset: ts, tool: 'SaveAsset', args: { assetPath: p } }));
  }
  return [{ toolset: ts, tool: pascal(tool), args: camelKeys(args) }];
}

// Editörde yeni (C++) kuşak mı kayıtlı: list_toolsets yanıtında EditorToolset.AssetToolset var, eski Python AssetTools yok
export function isModernToolsetList(list) {
  const s = typeof list === 'string' ? list : JSON.stringify(list || '');
  if (s.includes('editor_toolset.toolsets.asset.AssetTools')) return false;
  return s.includes('EditorToolset.AssetToolset') || s.includes('EditorToolset.MaterialToolset');
}
