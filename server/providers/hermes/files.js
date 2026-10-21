// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A Hermes agent's own computer in its owner's PC (docs/features/agent-pc.md §4.1): the machine Hermes runs on, through
// Hermes' own managed files (its dashboard's Files: GET /api/files, /api/files/read, POST /api/files/upload,
// /api/files/mkdir, DELETE /api/files) - whatever Hermes itself allows there (its locked root when it has one, its
// refusal of sensitive files). A fixed set of operations; changes only for a connection with Full access (adapter.js).
const fail = (code, message) => Object.assign(new Error(message), { code });
const pth = p => String(p ?? '').slice(0, 2000);
const MIME_OK = /^[\w.+-]+\/[\w.+-]+$/;


// (what Hermes refused, as the codes the PC answers with: a bad path, a sensitive or locked-out file, one there already…)
const BY_STATUS = { 400: 'bad_request', 403: 'forbidden', 409: 'conflict', 413: 'too_large', 415: 'unsupported' };

export async function filesCall(link, op, p = {}) {
  await link.whenConnected();
  const l = { rest: (...a) => link.rest(...a).catch(e => { throw BY_STATUS[e.httpStatus] ? Object.assign(e, { code: BY_STATUS[e.httpStatus] }) : e; }) };
  switch (op) {
    case 'list': {
      const r = await l.rest('GET', '/api/files', { query: p.path ? { path: pth(p.path) } : {} });
      return { path: r.path || '', parent: r.parent ?? null, root: r.locked_root ?? r.root ?? null, total: (r.entries || []).length,
        entries: (r.entries || []).slice(0, 2000).map(e => ({ name: e.name, path: e.path, dir: !!e.is_directory, size: e.size ?? null, modified: e.mtime ? Math.round(e.mtime * 1000) : null, mime: e.mime_type || null })) };
    }
    case 'read': {
      const r = await l.rest('GET', '/api/files/read', { query: { path: pth(p.path) }, timeoutMs: 60000 });
      const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(r.data_url || ''));
      if (!m) throw fail('unreadable', 'Hermes sent the file in a form that could not be read');
      return { name: r.name, path: r.path, size: r.size, mime: r.mime_type || m[1] || 'application/octet-stream', encoding: 'base64', content: m[2] ? m[3] : Buffer.from(decodeURIComponent(m[3])).toString('base64') };
    }
    case 'write': {
      if (typeof p.content !== 'string') throw fail('bad_request', 'Send the file');
      const mime = typeof p.mime === 'string' && MIME_OK.test(p.mime) ? p.mime : 'application/octet-stream';
      const data = p.encoding === 'base64' ? p.content : Buffer.from(p.content, 'utf8').toString('base64');
      if (data.length > 34 * 1048576) throw fail('too_large', 'That file is too large to send to Hermes from here');
      const r = await l.rest('POST', '/api/files/upload', { body: { path: pth(p.path), data_url: `data:${mime};base64,${data}`, overwrite: p.overwrite !== false }, timeoutMs: 120000 });
      return { ok: true, path: r.path || p.path };
    }
    case 'mkdir': { const r = await l.rest('POST', '/api/files/mkdir', { body: { path: pth(p.path) } }); return { ok: true, path: r.path || p.path }; }
    case 'remove': { await l.rest('DELETE', '/api/files', { body: { path: pth(p.path), recursive: p.recursive === true } }); return { ok: true }; }
    default: throw fail('unsupported', `There is no file call ${op}`);
  }
}
