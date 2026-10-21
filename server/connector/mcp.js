// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The world's MCP endpoint (POST /mcp; ./http.js authenticates first): JSON-RPC 2.0 over Streamable HTTP for AI apps
// acting as a person's agent (./auth.js, ./tools.js). A "dual-era" server (MCP 2026-07-28, Versioning):
// - modern requests (2026-07-28) carry their protocol version in params._meta and the MCP-Protocol-Version header, the
//   method in Mcp-Method and a tool's name in Mcp-Name (Base64 "=?base64?…?=" decoded): each is checked against the body
//   (400, HeaderMismatch -32020) and an unknown version is answered with the versions served (400, -32022). Results carry
//   resultType "complete". server/discover says what is served.
// - legacy requests (2025-03-26 … 2025-11-25) open with initialize, which is answered with the client's version when
//   served (else the newest legacy one); no session is kept: every request stands alone (the endpoint mints no
//   Mcp-Session-Id).
// Every answer is a single JSON object; notifications get 202 with no body. Only tools are offered.

export const MODERN = Object.freeze(['2026-07-28']);
export const LEGACY = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26']);
export const SUPPORTED = Object.freeze([...MODERN, ...LEGACY]);
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';

const E = { parse: -32700, invalidRequest: -32600, notFound: -32601, invalidParams: -32602, internal: -32603, headerMismatch: -32020, unsupportedVersion: -32022 };
const err = (id, code, message, data) => ({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), error: { code, message, ...(data ? { data } : {}) } });

/** A header value as sent: plain, or the Base64 sentinel "=?base64?…?=" decoded (Streamable HTTP, Value Encoding). */
export function headerValue(v) {
  if (typeof v !== 'string') return null;
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v);
  if (!m) return v;
  try { return Buffer.from(m[1], 'base64').toString('utf8'); } catch { return null; }
}

/**
 * One POST to the MCP endpoint. → { status, json } (json null: no body).
 * @param {object} o
 * @param {any} o.body                 the parsed JSON body (undefined: it wasn't JSON)
 * @param {object} o.headers           the request's headers (lower-case names)
 * @param {object} o.tools             { list(): tool[], call(name, args): Promise<{ content, structuredContent?, isError? }> }
 * @param {object} o.server            { name, version, instructions }
 */
export async function handleMcp({ body, headers, tools, server }) {
  if (body === undefined) return { status: 400, json: err(null, E.parse, 'The body is not JSON') };
  if (Array.isArray(body)) return { status: 400, json: err(null, E.invalidRequest, 'Send one JSON-RPC message per request (no batches)') };
  if (!body || typeof body !== 'object' || body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    if (body && typeof body === 'object' && body.jsonrpc === '2.0' && ('result' in body || 'error' in body)) return { status: 400, json: err(null, E.invalidRequest, 'A client sends requests, not responses') };
    return { status: 400, json: err(body?.id ?? null, E.invalidRequest, 'Not a JSON-RPC 2.0 request') };
  }
  const isNotification = !('id' in body), id = body.id, method = body.method, params = body.params && typeof body.params === 'object' ? body.params : {};
  if (isNotification) return { status: 202, json: null };   // (notifications/initialized and the like: nothing to do)
  if (!(typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)))) return { status: 400, json: err(null, E.invalidRequest, 'The id must be a string or a number') };

  const metaVersion = params._meta && typeof params._meta === 'object' ? params._meta[VERSION_KEY] : undefined;
  const hVersion = headers['mcp-protocol-version'];
  const modern = metaVersion !== undefined;
  if (modern) {
    // the headers mirror the body; any difference is refused
    if (typeof hVersion !== 'string' || hVersion !== metaVersion) return { status: 400, json: err(id, E.headerMismatch, 'Header mismatch: MCP-Protocol-Version must equal params._meta protocolVersion') };
    if (!MODERN.includes(metaVersion)) return { status: 400, json: err(id, E.unsupportedVersion, 'Unsupported protocol version', { supported: [...SUPPORTED], requested: String(metaVersion).slice(0, 40) }) };
    if (headers['mcp-method'] !== method) return { status: 400, json: err(id, E.headerMismatch, 'Header mismatch: Mcp-Method must equal the method') };
    if (method === 'tools/call') {
      const name = headerValue(headers['mcp-name']);
      if (name === null || name !== params.name) return { status: 400, json: err(id, E.headerMismatch, 'Header mismatch: Mcp-Name must equal params.name') };
    }
  } else if (method !== 'initialize' && hVersion !== undefined && !LEGACY.includes(hVersion)) {
    // a version header without the modern _meta: a legacy client naming a version this server doesn't serve
    return { status: 400, json: err(id, E.unsupportedVersion, 'Unsupported protocol version', { supported: [...SUPPORTED], requested: String(hVersion).slice(0, 40) }) };
  }
  const done = result => ({ status: 200, json: { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result } : result } });
  const serverInfo = { name: server.name, version: server.version };

  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return done({ protocolVersion: LEGACY.includes(asked) ? asked : LEGACY[0], capabilities: { tools: { listChanged: false } }, serverInfo, instructions: server.instructions });
    }
    case 'server/discover':
      return done({ supportedVersions: [...SUPPORTED], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo }, instructions: server.instructions, ttlMs: 300000, cacheScope: 'private' });
    case 'ping':
      return done({});
    case 'tools/list':
      return done({ tools: tools.list(), ...(modern ? { ttlMs: 300000, cacheScope: 'private' } : {}) });
    case 'tools/call': {
      if (typeof params.name !== 'string') return { status: 200, json: err(id, E.invalidParams, 'params.name: the tool to call') };
      const args = params.arguments === undefined ? {} : params.arguments;
      if (!args || typeof args !== 'object' || Array.isArray(args)) return { status: 200, json: err(id, E.invalidParams, 'params.arguments must be an object') };
      if (!tools.has(params.name)) return { status: 200, json: err(id, E.invalidParams, `Unknown tool: ${params.name.slice(0, 60)}`) };
      const r = await tools.call(params.name, args);
      return done({ content: r.content, ...(r.structuredContent !== undefined ? { structuredContent: r.structuredContent } : {}), isError: !!r.isError });
    }
    default:
      return { status: modern ? 404 : 200, json: err(id, E.notFound, `Method not found: ${method.slice(0, 60)}`) };
  }
}
