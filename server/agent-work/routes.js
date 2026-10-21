// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's work over HTTP (docs/features/CHAT.md §13): its job brief, its work notes and the files it knows. Only the
// agent's owner, or an account it is shared with to manage, may read or change any of it (agents.profile); everyone else
// gets 404 — a business's instructions and notes are private. Every route goes through the server's pipeline (session,
// capability, Origin, CSRF, JSON).
import fs from 'node:fs';
import { WorkError } from './work.js';

/**
 * @param {object} router
 * @param {import('./work.js').Work} work
 * @param {{ agents: object, attachments: object, audit?: object }} d
 */
export function addWorkRoutes(router, work, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { const r = await fn(ctx); return r && r.pre ? r : ok(r); } catch (e) {
      if (e instanceof WorkError) return ok({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  };
  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN);
  const mine = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !P.account || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new WorkError(404, 'not_found', 'No such agent');
    return a;
  };
  const q = (url, k) => url.searchParams.get(k);
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: run(fn) });
  const FIELDS = ['company', 'instructions', 'tone', 'timezone', 'knowledge', 'notes', 'defaultMode', 'publicMode'];

  R('GET', '/api/agent-work', ({ P, url }) => work.all(mine(P, num(q(url, 'agent'))).id));
  R('POST', '/api/agent-work', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    const patch = Object.fromEntries(FIELDS.filter(k => b[k] !== undefined).map(k => [k, b[k]]));
    if (!Object.keys(patch).length) throw new WorkError(400, 'nothing', 'Nothing to change');
    const before = work.brief(a.id), brief = work.setBrief(a.id, patch);
    const changed = FIELDS.filter(k => before[k] !== brief[k]);
    if (changed.length) d.audit?.log('agent.work', { actor: { id: P.account.id, login: P.account.login }, detail: { agent: a.id, fields: changed } });
    if (changed.includes('publicMode')) d.publicChanged?.();   // (whether it is public: everyone's team list)
    return { brief, budget: work.budget(a.id) };
  });

  R('POST', '/api/agent-work/notes', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    if (b.add !== undefined) {
      if (!b.add || typeof b.add.text !== 'string') throw new WorkError(400, 'bad_note', 'Write the note (add.text)');
      if (!work.addNote(a.id, b.add.text, 'owner')) throw new WorkError(409, 'duplicate', 'It already has that note');
      return { notes: work.notes(a.id) };
    }
    const id = num(b.id);
    if (!Number.isInteger(id) || b.remove !== true) throw new WorkError(400, 'nothing', 'Send add, or id with remove');
    work.removeNote(a.id, id);
    return { notes: work.notes(a.id) };
  });

  // a file it knows: one of this account's uploads (the chat's attachments), copied; drop: the upload was only for this,
  // so it leaves the account's Library once copied
  R('POST', '/api/agent-work/files', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    const f = d.attachments.pathOf(P.account.id, num(b.attachment));
    if (!f) throw new WorkError(404, 'not_found', 'No such upload');   // someone else's, or gone: not confirmed
    const r = work.addFile(a.id, f);
    if (b.drop === true) d.attachments.remove(P.account.id, f.id);
    return { ...r, files: work.files(a.id), budget: work.budget(a.id) };
  });
  R('POST', '/api/agent-work/files/remove', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    work.removeFile(a.id, num(b.id));
    return { files: work.files(a.id), budget: work.budget(a.id) };
  });
  // one of its files, to look at (an image or a PDF opens; anything else downloads)
  R('GET', '/api/agent-work/file', ({ P, url }) => {
    const a = mine(P, num(q(url, 'agent'))), f = work.fileOf(a.id, num(q(url, 'id')));
    let body = null;
    try { body = f ? fs.readFileSync(f.path) : null; } catch { body = null; }
    if (!body) throw new WorkError(404, 'not_found', 'No such file');
    const inline = /^image\/(png|jpeg|gif|webp)$/.test(f.mime) || f.mime === 'application/pdf';
    const name = String(f.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
    return { status: 200, pre: { body }, headers: { 'content-type': f.mime, 'cache-control': 'private, no-store', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"` } };
  });
}
