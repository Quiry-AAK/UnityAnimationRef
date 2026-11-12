// Unreal editörüne MCP istemcisi (docs/UNREAL.md). İki hedef:
//  - 'ue-mcp' / 'ue-mcp:<.uproject yolu>' (varsayılan, 2026-11-07): ue-mcp sunucusu stdio ile başlatılır (npx ue-mcp <uproject>);
//    Epic'in yerleşik araçlarına `epic(action:'call_tool', args:{ toolset, tool, input })` ile ulaşılır, sonuç `.result` içinde gelir.
//  - 'http(s)://…/mcp' (eski): Epic'in ModelContextProtocol eklentisi (Streamable HTTP), üst düzey `call_tool { toolset_name, tool_name, arguments }`.
// Dışarıya aynı API: callTool(toolset, tool, args) → aracın kendi sonucu (ör. { returnValue }).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const DEFAULT_MCP_URL = 'ue-mcp';
export const UE_MCP_VERSION = process.env.UPE_UE_MCP_VERSION || '1.4.12';
const DEFAULT_UPROJECT = process.env.UPE_UE_PROJECT || 'C:/Elarion/Elarion/Elarion.uproject';
const pool = new Map(); // hedef → { client, connecting }

export class UnrealMcpError extends Error {
  constructor(message, extra = {}) { super(message); this.name = 'UnrealMcpError'; Object.assign(this, extra); }
}

// hedef çözümü: { kind: 'uemcp', uproject, version } | { kind: 'http', url }
// ue-mcp sürümü hedefte sabitlenebilir: 'ue-mcp@1.4.13' / 'ue-mcp@1.4.13:<.uproject>' (yoksa UE_MCP_VERSION).
// Projedeki UE_MCP_Bridge eklentisi ue-mcp ile birlikte gelir: sunucu sürümü projenin kendi .mcp.json'undakiyle aynı olmalı.
export const UE_MCP_TARGET_RE = /^ue-mcp(?:@(\d+\.\d+\.\d+[\w.-]*))?(?::(.+))?$/i;
export function parseTarget(t) {
  const s = String(t || DEFAULT_MCP_URL).trim();
  if (/^https?:\/\//i.test(s)) return { kind: 'http', url: s, key: s };
  const m = s.match(UE_MCP_TARGET_RE);
  if (!m) throw new UnrealMcpError(`Geçersiz Unreal MCP hedefi: ${s} ('ue-mcp[@sürüm]', 'ue-mcp[@sürüm]:<.uproject>' ya da http(s)://… olmalı)`);
  const uproject = (m[2] || DEFAULT_UPROJECT).replace(/\\/g, '/');
  const version = m[1] || UE_MCP_VERSION;
  return { kind: 'uemcp', uproject, version, key: `ue-mcp@${version}:${uproject}` };
}
export const isUeMcp = (t) => parseTarget(t).kind === 'uemcp';

const withTimeout = (p, ms, what) => {
  let t; const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new UnrealMcpError(`${what}: ${ms} ms içinde yanıt yok (Unreal editörü meşgul ya da kapalı)`, { timeout: true })), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
};

function friendlyConnectError(e, tg) {
  const msg = String(e?.cause?.code || e?.code || e?.message || e);
  if (tg.kind === 'uemcp') return new UnrealMcpError(`ue-mcp@${tg.version} başlatılamadı/bağlanılamadı (${tg.uproject}): ${e?.message || e}. Node/npx kurulu mu, proje yolu doğru mu?`, { cause: e, connect: true });
  if (/ECONNREFUSED|fetch failed|ECONNRESET|EHOSTUNREACH/i.test(msg)) return new UnrealMcpError(`Unreal MCP'ye bağlanılamadı (${tg.url}). Unreal editörü açık ve ModelContextProtocol eklentisi etkin mi?`, { cause: e, connect: true });
  return new UnrealMcpError(`Unreal MCP bağlantı hatası (${tg.url}): ${e?.message || e}`, { cause: e, connect: true });
}

function makeTransport(tg) {
  if (tg.kind === 'http') return new StreamableHTTPClientTransport(new URL(tg.url));
  const npxArgs = ['-y', '--min-release-age=0', `ue-mcp@${tg.version}`, tg.uproject];
  // Windows'ta npx bir .cmd betiği: cmd üzerinden başlat
  if (process.platform === 'win32') return new StdioClientTransport({ command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npx', ...npxArgs], stderr: 'ignore' });
  return new StdioClientTransport({ command: 'npx', args: npxArgs, stderr: 'ignore' });
}

export async function getClient(target = DEFAULT_MCP_URL, { timeoutMs } = {}) {
  const tg = parseTarget(target);
  const cur = pool.get(tg.key);
  if (cur?.client) return cur.client;
  if (cur?.connecting) return cur.connecting;
  const connecting = (async () => {
    const client = new Client({ name: 'upe-unreal-vfx', version: '1.1.0' });
    try { await withTimeout(client.connect(makeTransport(tg)), timeoutMs || (tg.kind === 'uemcp' ? 90000 : 10000), 'Unreal MCP bağlantısı'); }
    catch (e) { pool.delete(tg.key); try { await client.close(); } catch {} throw e instanceof UnrealMcpError ? e : friendlyConnectError(e, tg); }
    client.onclose = () => { if (pool.get(tg.key)?.client === client) pool.delete(tg.key); };
    pool.set(tg.key, { client });
    return client;
  })();
  pool.set(tg.key, { connecting });
  return connecting;
}

export async function closeClient(target = DEFAULT_MCP_URL) {
  const key = parseTarget(target).key;
  const cur = pool.get(key); pool.delete(key);
  if (cur?.client) try { await cur.client.close(); } catch {}
}
export async function closeAll() { for (const k of [...pool.keys()]) await closeClient(k); }

// MCP içerik dizisinden JSON (yoksa metin) çıkar
export function parseResult(res) {
  const texts = (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  if (res?.structuredContent !== undefined) return res.structuredContent;
  const joined = texts.join('\n');
  try { return JSON.parse(joined); } catch {}
  if (texts.length > 1) { const all = []; for (const t of texts) { try { all.push(JSON.parse(t)); } catch { all.push(t); } } return all; }
  return joined;
}

// Ham MCP aracı çağrısı (hedefin kendi araç adlarıyla)
async function rawCall(target, name, args, timeoutMs) {
  const tg = parseTarget(target);
  const client = await getClient(target);
  let res;
  try { res = await withTimeout(client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }), timeoutMs + 1000, `Unreal MCP ${name}`); }
  catch (e) {
    if (e instanceof UnrealMcpError) throw e;
    if (/ECONNREFUSED|fetch failed|closed/i.test(String(e?.message))) { await closeClient(target); throw friendlyConnectError(e, tg); }
    throw new UnrealMcpError(`Unreal MCP ${name} hatası: ${e?.message || e}`, { cause: e });
  }
  return { res, out: parseResult(res) };
}

// ue-mcp köprüsü kapalıyken (editör kapalı) gelen hata metni
const bridgeDown = (o) => /bridge|not connected|editor (is )?not running|no editor/i.test(typeof o === 'string' ? o : (o?.error || o?.message || ''));

// Üst düzey araç (Epic adlarıyla: list_toolsets, describe_toolset, call_tool); ue-mcp'de epic kategorisine çevrilir
export async function callTop(name, args = {}, { mcpUrl, timeoutMs = 60000 } = {}) {
  const tg = parseTarget(mcpUrl);
  if (tg.kind === 'http') {
    const { res, out } = await rawCall(mcpUrl, name, args, timeoutMs);
    if (res?.isError) throw new UnrealMcpError(`${args.toolset_name ? args.toolset_name + '.' : ''}${args.tool_name || name}: ${typeof out === 'string' ? out : JSON.stringify(out)}`, { result: out, toolError: true });
    return out;
  }
  let epicArgs;
  if (name === 'list_toolsets') epicArgs = { action: 'list_toolsets' };
  else if (name === 'describe_toolset') epicArgs = { action: 'describe_toolset', args: { toolset: args.toolset_name } };
  else if (name === 'call_tool') epicArgs = { action: 'call_tool', args: { toolset: args.toolset_name, tool: args.tool_name, input: args.arguments || {} }, timeoutMs };
  else throw new UnrealMcpError(`ue-mcp: desteklenmeyen üst düzey araç ${name}`);
  const { res, out } = await rawCall(mcpUrl, 'epic', epicArgs, timeoutMs);
  const label = args.toolset_name ? `${args.toolset_name}.${args.tool_name || name}` : name;
  if (res?.isError || (out && typeof out === 'object' && out.success === false)) {
    const msg = typeof out === 'string' ? out : (out?.error || out?.message || JSON.stringify(out));
    throw new UnrealMcpError(`${label}: ${msg}`, { result: out, toolError: true, connect: bridgeDown(out) });
  }
  if (name === 'call_tool') return out && typeof out === 'object' && 'result' in out ? out.result : out;
  return out;
}

// Toolset aracı: callTool('NiagaraToolsets.NiagaraToolset_System', 'AddEmitter', {...}) → JSON
export async function callTool(toolset, tool, args = {}, opts = {}) {
  const out = await callTop('call_tool', { toolset_name: toolset, tool_name: tool, arguments: args }, opts);
  // bazı araçlar hata metnini başarı olarak döner
  if (out && typeof out === 'object' && !Array.isArray(out) && (out.success === false || out.bSuccess === false) && (out.error || out.message || out.Error)) {
    throw new UnrealMcpError(`${toolset}.${tool}: ${out.error || out.message || out.Error}`, { result: out, toolError: true });
  }
  return out;
}

// ue-mcp'nin kendi kategori eylemi (yalnız ue-mcp hedefinde): callUe('niagara', 'compile', { systemPath }) → JSON
export async function callUe(category, action, args = {}, { mcpUrl, timeoutMs = 60000 } = {}) {
  if (!isUeMcp(mcpUrl)) throw new UnrealMcpError(`callUe yalnız ue-mcp hedefinde: ${mcpUrl}`);
  const { res, out } = await rawCall(mcpUrl, category, { action, args, timeoutMs }, timeoutMs);
  if (res?.isError || (out && typeof out === 'object' && out.success === false)) {
    const msg = typeof out === 'string' ? out : (out?.error || out?.message || JSON.stringify(out));
    throw new UnrealMcpError(`${category}.${action}: ${msg}`, { result: out, toolError: true, connect: bridgeDown(out) });
  }
  return out;
}

export const listToolsets = (opts) => callTop('list_toolsets', {}, opts);
export const describeToolset = (name, opts) => callTop('describe_toolset', { toolset_name: name }, opts);
