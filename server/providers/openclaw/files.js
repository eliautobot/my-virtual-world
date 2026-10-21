// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An OpenClaw agent's own computer in its owner's PC (docs/features/agent-pc.md §4.1): its workspace through the
// gateway's own read-only browsing (agents.workspace.list / .get - paths inside the agent's workspace only, symlink and
// hardlink escapes refused by OpenClaw, text and pictures only, size-capped), and its agent documents (AGENTS.md,
// SOUL.md… - agents.files.list / .get / .set, a change sent with the hash it was read at, so one made meanwhile is
// refused). A fixed set of operations; nothing else reaches the gateway from here.
const fail = (code, message) => Object.assign(new Error(message), { code });
const rel = p => String(p ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').slice(0, 1000);
const ms = v => (Number.isFinite(Number(v)) ? Number(v) : null);


export async function filesCall(link, op, p = {}) {
  const agentId = String(p.agentId || '');
  if (!agentId) throw fail('bad_request', 'Which agent?');
  switch (op) {
    case 'list': {
      const r = await link.request('agents.workspace.list', { agentId, path: rel(p.path), offset: Math.max(0, Number(p.offset) || 0), limit: Math.min(500, Math.max(1, Number(p.limit) || 250)) }, { timeoutMs: 20000 });
      return { path: r.path || '', parent: r.parentPath ?? (r.path ? '' : null), total: r.totalEntries ?? (r.entries || []).length,
        entries: (r.entries || []).map(e => ({ name: e.name, path: e.path, dir: e.kind === 'directory', size: e.size ?? null, modified: ms(e.updatedAtMs) })) };
    }
    case 'read': {
      const r = await link.request('agents.workspace.get', { agentId, path: rel(p.path) }, { timeoutMs: 30000 });
      const f = r.file || {};
      return { name: f.name, path: f.path, size: f.size, modified: ms(f.updatedAtMs), mime: f.mimeType || 'text/plain', encoding: f.encoding === 'base64' ? 'base64' : 'utf8', content: f.content ?? '' };
    }
    case 'docs': {
      const r = await link.request('agents.files.list', { agentId }, { timeoutMs: 20000 });
      return { files: (r.files || []).map(f => ({ name: f.name, size: f.size ?? null, modified: ms(f.updatedAtMs ?? f.mtimeMs), missing: !!f.missing })) };
    }
    case 'doc': {
      const r = await link.request('agents.files.get', { agentId, name: String(p.name || '').slice(0, 200) }, { timeoutMs: 20000 });
      const f = r.file || r;
      return { name: f.name || p.name, content: f.content ?? '', hash: f.hash ?? r.hash ?? null, missing: !!f.missing };
    }
    case 'docSet': {
      if (typeof p.content !== 'string') throw fail('bad_request', 'Send the text');
      if (Buffer.byteLength(p.content) > 2 * 1048576) throw fail('too_large', 'An agent document is at most 2 MB');
      const r = await link.request('agents.files.set', { agentId, name: String(p.name || '').slice(0, 200), content: p.content, ...(p.expectedHash ? { expectedHash: String(p.expectedHash) } : {}) }, { timeoutMs: 30000 })
        .catch(e => { throw e?.details?.type === 'agent_file_conflict' || /changed since it was read/.test(e?.message || '') ? fail('conflict', `${p.name} was changed since it was read: open it again`) : e; });
      return { name: p.name, hash: r.hash ?? r.file?.hash ?? null, ok: true };
    }
    default: throw fail('unsupported', `There is no file call ${op}`);
  }
}
