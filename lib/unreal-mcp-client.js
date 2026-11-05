// Unreal editörünün MCP sunucusuna (ModelContextProtocol eklentisi, Streamable HTTP) istemci.
// Araçlar üst düzey `call_tool { toolset_name, tool_name, arguments }` üzerinden çağrılır (docs/UNREAL.md).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const DEFAULT_MCP_URL = 'http://127.0.0.1:8000/mcp';
const pool = new Map(); // url → { client, connecting }

export class UnrealMcpError extends Error {
  constructor(message, extra = {}) { super(message); this.name = 'UnrealMcpError'; Object.assign(this, extra); }
}

const withTimeout = (p, ms, what) => {
  let t; const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new UnrealMcpError(`${what}: ${ms} ms içinde yanıt yok (Unreal editörü meşgul ya da kapalı)`, { timeout: true })), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
};

function friendlyConnectError(e, url) {
  const msg = String(e?.cause?.code || e?.code || e?.message || e);
  if (/ECONNREFUSED|fetch failed|ECONNRESET|EHOSTUNREACH/i.test(msg)) return new UnrealMcpError(`Unreal MCP'ye bağlanılamadı (${url}). Unreal editörü açık ve ModelContextProtocol eklentisi etkin mi?`, { cause: e, connect: true });
  return new UnrealMcpError(`Unreal MCP bağlantı hatası (${url}): ${e?.message || e}`, { cause: e, connect: true });
}

export async function getClient(mcpUrl = DEFAULT_MCP_URL, { timeoutMs = 10000 } = {}) {
  const url = mcpUrl || DEFAULT_MCP_URL;
  const cur = pool.get(url);
  if (cur?.client) return cur.client;
  if (cur?.connecting) return cur.connecting;
  const connecting = (async () => {
    const client = new Client({ name: 'upe-unreal-vfx', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    try { await withTimeout(client.connect(transport), timeoutMs, 'Unreal MCP bağlantısı'); }
    catch (e) { pool.delete(url); try { await client.close(); } catch {} throw e instanceof UnrealMcpError ? e : friendlyConnectError(e, url); }
    client.onclose = () => { if (pool.get(url)?.client === client) pool.delete(url); };
    pool.set(url, { client });
    return client;
  })();
  pool.set(url, { connecting });
  return connecting;
}

export async function closeClient(mcpUrl = DEFAULT_MCP_URL) {
  const cur = pool.get(mcpUrl || DEFAULT_MCP_URL); pool.delete(mcpUrl || DEFAULT_MCP_URL);
  if (cur?.client) try { await cur.client.close(); } catch {}
}
export async function closeAll() { for (const u of [...pool.keys()]) await closeClient(u); }

// MCP içerik dizisinden JSON (yoksa metin) çıkar
export function parseResult(res) {
  const texts = (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text);
  if (res?.structuredContent !== undefined) return res.structuredContent;
  const joined = texts.join('\n');
  try { return JSON.parse(joined); } catch {}
  if (texts.length > 1) { const all = []; for (const t of texts) { try { all.push(JSON.parse(t)); } catch { all.push(t); } } return all; }
  return joined;
}

// Üst düzey araç (list_toolsets, describe_toolset, call_tool)
export async function callTop(name, args = {}, { mcpUrl, timeoutMs = 60000 } = {}) {
  const client = await getClient(mcpUrl);
  let res;
  try { res = await withTimeout(client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs }), timeoutMs + 1000, `Unreal MCP ${name}`); }
  catch (e) {
    if (e instanceof UnrealMcpError) throw e;
    if (/ECONNREFUSED|fetch failed|closed/i.test(String(e?.message))) { await closeClient(mcpUrl); throw friendlyConnectError(e, mcpUrl || DEFAULT_MCP_URL); }
    throw new UnrealMcpError(`Unreal MCP ${name} hatası: ${e?.message || e}`, { cause: e });
  }
  const out = parseResult(res);
  if (res?.isError) throw new UnrealMcpError(`${args.toolset_name ? args.toolset_name + '.' : ''}${args.tool_name || name}: ${typeof out === 'string' ? out : JSON.stringify(out)}`, { result: out, toolError: true });
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

export const listToolsets = (opts) => callTop('list_toolsets', {}, opts);
export const describeToolset = (name, opts) => callTop('describe_toolset', { toolset_name: name }, opts);
