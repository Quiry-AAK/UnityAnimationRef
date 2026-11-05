// UPE VFX → Unreal Niagara (docs/UNREAL.md). Sahibi: Unreal dönüştürücü işi. Sunucu yalnız aşağıdaki üç işlevi kullanır.

// Saf, editörsüz: normalize edilmiş efekt → Niagara kurulum planı
export function effectToNiagaraPlan(effect) {
  return { name: effect?.name || 'vfx', emitters: [], warnings: ['effectToNiagaraPlan henüz yazılmadı'] };
}

// Çalışan Unreal editörünün MCP sunucusuna bağlanabiliyor mu
export async function unrealStatus({ mcpUrl } = {}) {
  return { connected: false, error: 'unreal-vfx henüz yazılmadı', mcpUrl };
}

// effects: normalizeEffect'ten geçmiş efektler
export async function sendVfxToUnreal(effects, { mcpUrl, contentPath = '/Game/UPE/VFX', texturesDir, log } = {}) {
  const errors = {};
  for (const e of effects || []) errors[e?.name || 'vfx'] = 'Unreal dönüştürücüsü henüz yazılmadı (lib/unreal-vfx.js)';
  return { ok: false, systems: [], errors };
}
