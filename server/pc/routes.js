// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC over HTTP (docs/features/agent-pc.md): what the PC window asks. Every route acts as the signed-in person
// ({ human: their account }), so the engine (./os.js) gives them their own account's PC and nothing else — another
// account's agent, team, file or task is "not found", as one that isn't there. Each route goes through the server's
// pipeline first (session, capability agents.pc, Origin, CSRF, JSON).
// Where a request points: profile=<agent> (that agent's view: ~, /teams/<team>) or space=<id> (a team's space, from
// the Teams app), with path=. Files are served for viewing only when they can't run anything on this site (pictures,
// PDFs, recordings, plain text — sandboxed); everything else is a download.
import { PcError } from './os.js';

const INLINE = /^(image\/(png|jpeg|gif|webp|avif)|application\/pdf|audio\/[\w.+-]+|video\/[\w.+-]+)$/;

/** Reads a raw request body up to `max` bytes (throws 413 beyond it). */
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let n = 0, done = false;
    req.on('data', d => {
      if (done) return;
      n += d.length;
      if (n > max) { done = true; req.resume(); reject(new PcError(413, 'too_large', `A file is at most ${Math.round(max / 1048576)} MB here`)); return; }
      parts.push(d);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(parts)); } });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}

/**
 * @param {object} router
 * @param {import('./os.js').PcOS} pc
 * @param {{ agents: object, names?: (tag: string) => string, work?: () => object, own?: { of: Function, call: Function } }} d
 *   own: an Agent Providers' agent's own computer (server/agent-providers.js computerOf / computer)
 */
export function addPcRoutes(router, pc, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { const r = await fn(ctx); return r && r.raw ? r.raw : ok(r); } catch (e) {
      if (e instanceof PcError) return ok({ error: e.message, code: e.code, ...(e.hint ? { hint: e.hint } : {}), ...(e.version != null ? { version: e.version } : {}) }, e.status);
      throw e;
    }
  };
  const R = (method, path, fn, o = {}) => router.add({ method, path, cap: 'agents.pc', ...o, handler: run(fn) });
  const me = P => { if (!P.account) throw new PcError(401, 'signed_out', 'Sign in'); return { human: P.account.id }; };
  const num = v => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : null);
  const str = (v, n = 2000) => (typeof v === 'string' ? v.slice(0, n) : '');
  /** Where a request points: { path, opt } from a query (GET) or a body (POST). */
  const where = src => {
    const g = k => (src instanceof URLSearchParams ? src.get(k) : src?.[k]);
    const profile = num(g('profile')), space = num(g('space'));
    if (profile == null && space == null) throw new PcError(400, 'where', 'Say whose PC (profile) or which team space (space)');
    return { path: str(g('path')) || (space != null ? '/' : '~'), opt: { ...(profile != null ? { profile } : {}), ...(space != null ? { space } : {}) } };
  };
  const names = tag => (d.names ? d.names(tag) : tag);
  const withNames = o => ({ ...o, byName: o.by ? names(o.by) : undefined });

  // ------------------------------------------------------------------ the PC as a whole
  R('GET', '/api/pc', ({ P }) => {
    const who = me(P);
    const agents = pc.agentsOf(who.human).map(a => ({ id: a.id, key: a.key, name: a.name, emoji: a.emoji, role: a.role, screen: pc.screenOf(a.id), body: d.body ? d.body(a) : null,
      zone: d.work ? d.work().zoneOf?.(a.id) || null : null, ...(d.own ? { own: d.own.of(P, a) } : {}) }));
    // (realBrowser: the built-in agents browse in a real browser here — the built-in Chrome; else the reader)
    const realBrowser = !!(d.browser && d.browser()?.chrome?.available());
    return { agents, teams: pc.teamsOf(who), goneTeams: pc.goneTeams(who), usage: pc.usage(who.human), limits: pc.limits(), realBrowser };
  });
  R('GET', '/api/pc/screens', ({ P }) => ({ screens: pc.agentsOf(me(P).human).map(a => pc.screenOf(a.id)).filter(Boolean) }));
  R('GET', '/api/pc/activity', ({ P, url }) => ({ items: pc.activity(me(P), { agent: num(url.searchParams.get('agent')), before: num(url.searchParams.get('before')), limit: num(url.searchParams.get('limit')) || 50 }) }));
  R('GET', '/api/pc/history', ({ P, url }) => ({ pages: pc.history(me(P), { agent: num(url.searchParams.get('agent')), limit: num(url.searchParams.get('limit')) || 50 }) }));

  // ------------------------------------------------------------------ files
  R('GET', '/api/pc/ls', ({ P, url }) => {
    const w = where(url.searchParams);
    const r = pc.list(me(P), w.path, { ...w.opt, limit: num(url.searchParams.get('limit')) || 500, offset: num(url.searchParams.get('from')) || 0 });
    return { ...r, entries: r.entries.map(withNames) };
  });
  R('GET', '/api/pc/stat', ({ P, url }) => { const w = where(url.searchParams); return withNames(pc.stat(me(P), w.path, w.opt)); });
  R('GET', '/api/pc/text', ({ P, url }) => {
    const w = where(url.searchParams);
    const f = pc.readText(me(P), w.path, w.opt);
    return { path: f.path, text: f.text, kind: f.kind, truncated: !!f.truncated, info: withNames(f.info) };
  });
  // the file itself: to show (inline, sandboxed) or to download; version= an older one
  R('GET', '/api/pc/file', ({ P, url }) => {
    const w = where(url.searchParams);
    const v = num(url.searchParams.get('version'));
    const f = v != null ? pc.versionBytes(me(P), w.path, v, w.opt) : pc.readFile(me(P), w.path, w.opt);
    const mime = f.node.mime || 'application/octet-stream';
    const show = url.searchParams.get('download') !== '1' && INLINE.test(mime);
    const name = encodeURIComponent(f.node.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return { raw: { body: f.buf, headers: { 'content-type': show ? mime : 'application/octet-stream', 'content-disposition': `${show ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'" } } };
  });
  R('POST', '/api/pc/write', ({ P, body }) => {
    const w = where(body);
    if (typeof body.text !== 'string') throw new PcError(400, 'nothing', 'Send the text');
    const r = pc.write(me(P), w.path, body.text, { ...w.opt, expect: num(body.expect) ?? undefined, force: body.force === true });
    return { ...r, info: withNames(r.info) };
  });
  // a file uploaded as it is: the body is the file; ?profile|space & path name where it goes
  R('POST', '/api/pc/upload', async ({ P, req, url }) => {
    const w = where(url.searchParams);
    const max = pc.limits().fileMB > 0 ? pc.limits().fileMB * 1048576 : 2 ** 31;
    let buf;
    try { buf = await readBody(req, max); } catch (e) { req.resume(); throw e; }
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    const r = pc.write(me(P), w.path, buf, { ...w.opt, mime: mime && mime !== 'application/octet-stream' ? mime : undefined, force: url.searchParams.get('replace') === '1' });
    return { ...r, info: withNames(r.info) };
  }, { raw: true });
  R('POST', '/api/pc/mkdir', ({ P, body }) => { const w = where(body); return pc.mkdir(me(P), w.path, w.opt); });
  R('POST', '/api/pc/move', ({ P, body }) => { const w = where(body); return pc.move(me(P), w.path, str(body.to), w.opt); });
  R('POST', '/api/pc/copy', ({ P, body }) => { const w = where(body); return pc.copy(me(P), w.path, str(body.to), w.opt); });
  R('POST', '/api/pc/remove', ({ P, body }) => { const w = where(body); return pc.remove(me(P), w.path, w.opt); });
  R('GET', '/api/pc/trash', ({ P, url }) => { const w = where(url.searchParams); return pc.trashList(me(P), w.path, w.opt); });
  R('POST', '/api/pc/restore', ({ P, body }) => pc.restore(me(P), num(body.id)));
  R('POST', '/api/pc/empty-trash', ({ P, body }) => { const w = where(body); return pc.emptyTrash(me(P), w.path, { ...w.opt, ...(num(body.id) != null ? { id: num(body.id) } : {}) }); });
  R('GET', '/api/pc/versions', ({ P, url }) => { const w = where(url.searchParams); return pc.versions(me(P), w.path, w.opt); });
  R('POST', '/api/pc/revert', ({ P, body }) => { const w = where(body); return pc.revert(me(P), w.path, num(body.version), w.opt); });
  R('GET', '/api/pc/find', ({ P, url }) => {
    const prof = num(url.searchParams.get('profile'));
    return pc.find(me(P), str(url.searchParams.get('q'), 200), { ...(prof != null ? { profile: prof } : {}), in: url.searchParams.get('in') || null, limit: 50 });
  });

  // ------------------------------------------------------------------ the agent at work
  const work = () => { const w = d.work ? d.work() : null; if (!w) throw new PcError(503, 'starting', 'The PC is still starting'); return w; };
  const ownAgent = (P, id) => {
    const a = d.agents.get(num(id));
    if (!a || pc.accountOf(a) !== me(P).human) throw new PcError(404, 'not_found', 'No such agent');
    return a;
  };
  R('POST', '/api/pc/work', ({ P, body }) => work().workOn(me(P), num(body.card)));
  R('POST', '/api/pc/work/stop', ({ P, body }) => work().stopWork(me(P), num(body.card)));
  R('GET', '/api/pc/profile', ({ P, url }) => { const a = ownAgent(P, url.searchParams.get('agent')); return { agent: a.id, ...work().status(a.id) }; });
  R('POST', '/api/pc/profile', ({ P, body }) => { const a = ownAgent(P, body.agent); if (typeof body.autoWork !== 'boolean') throw new PcError(400, 'nothing', 'Send autoWork: true or false'); return { agent: a.id, ...work().setAutoWork(a.id, body.autoWork) }; });
  // the command line as one of the person's own agents (its PC's Terminal, and connected agents' "pc" tool over MCP):
  // the agent's own view — its home and its teams — never the owner's whole PC. session: which shell (its folder and
  // the versions it read carry on), kept 15 minutes
  const shells = new Map();
  R('POST', '/api/pc/shell', async ({ P, body }) => {
    const a = ownAgent(P, body.agent);
    if (typeof body.run !== 'string' || !body.run.trim()) throw new PcError(400, 'nothing', 'Send the command in run');
    const key = `${P.account.id}:${a.id}:${str(body.session, 60) || 'default'}`, t = Date.now();
    for (const [k, v] of shells) if (t - v.at > 15 * 60000) shells.delete(k);
    let e = shells.get(key);
    if (!e) { if (shells.size >= 1000) shells.delete(shells.keys().next().value); e = { shell: d.shellFor(a), at: t }; shells.set(key, e); }
    e.at = t;
    const extra = {};
    for (const k of ['text', 'find', 'replace']) if (typeof body[k] === 'string') extra[k] = body[k].slice(0, 2 * 1048576);
    const r = await e.shell.run(body.run.slice(0, 20000), extra);
    return { text: r.text, results: r.results.map(x => ({ line: x.line, ok: x.ok })), cwd: e.shell.cwd };
  });

  // what its browser shows (a browser service's screen after its last step), for its owner's PC window: a JPEG, or 204
  R('GET', '/api/pc/browser/shot', ({ P, url }) => {
    const a = ownAgent(P, url.searchParams.get('agent'));
    const s = d.browser ? d.browser()?.shotOf(a.id) : null;
    if (!s) return { raw: { status: 204, body: Buffer.alloc(0), headers: { 'cache-control': 'no-store' } } };
    return { raw: { body: s.jpeg, headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-page-url': encodeURIComponent(s.url || ''), 'x-shot-at': String(s.at) } } };
  });

  // ------------------------------------------------------------------ its real browser, live (§5): watched and taken over
  // an agent's real browser (the built-in Chrome, or its owner's browser service): its tab, the page live — a picture
  // each time it paints, while someone watches — and its owner's clicks, scrolling, keys and typing on it. The same
  // shapes as the Agent Providers' browser (client/js/ui/provider-browser.js shows both). Its owner only (ownAgent).
  const browser = () => { const b = d.browser ? d.browser() : null; if (!b) throw new PcError(503, 'starting', 'The PC is still starting'); return b; };
  const PICK = ['action', 'tab', 'url', 'fx', 'fy', 'double', 'dx', 'dy', 'key', 'text'];
  R('GET', '/api/pc/browser', async ({ P, url }) => browser().liveState(ownAgent(P, url.searchParams.get('agent'))));
  R('POST', '/api/pc/browser', async ({ P, body }) => {
    const a = ownAgent(P, body.agent);
    return browser().liveAct(a, Object.fromEntries(PICK.filter(k => body[k] !== undefined).map(k => [k, typeof body[k] === 'string' ? body[k].slice(0, 5000) : body[k]])));
  });
  R('GET', '/api/pc/browser/frame', async ({ P, url }) => {
    const a = ownAgent(P, url.searchParams.get('agent'));
    const wait = url.searchParams.get('wait') === '0' ? 0 : 4000;
    const f = await browser().liveFrame(a, num(url.searchParams.get('after')) || 0, wait);
    if (f === undefined) throw new PcError(404, 'no_page', 'Its browser isn\'t open');
    const h = { 'cache-control': 'no-store', 'x-frame-seq': String(f?.seq || 0) };
    if (!f) return { raw: { status: 204, body: Buffer.alloc(0), headers: h } };
    return { raw: { body: f.jpeg, headers: { ...h, 'content-type': 'image/jpeg', 'x-page-width': String(f.w), 'x-page-height': String(f.h), 'x-page-url': encodeURIComponent(f.url || '') } } };
  });

  // ------------------------------------------------------------------ its own computer (an Agent Providers' agent, §4.1)
  // the computer OpenClaw or Hermes lives on, through its provider (server/agent-providers.js computer()): for the PC's
  // owner when they manage that provider; reading here, a change (a POST) only with the password entered lately
  const own = (P, id) => {
    const a = ownAgent(P, id), o = d.own ? d.own.of(P, a) : null;
    if (!o) throw new PcError(404, 'no_computer', 'This agent has no computer of its own here');
    return a;
  };
  const ownCall = async (P, a, op, params, change = false) => {
    try { return await d.own.call(P, a, op, params, { id: P.account.id, login: P.account.login }, { change }); }
    catch (e) { if (Number.isInteger(e.status) && e.code) throw new PcError(e.status, e.code, e.message); throw e; }
  };
  // a page watches these agents' screens (their PC window, their live screens in the world): their work that started
  // elsewhere is followed meanwhile (./screen-watch.js) — a lease, said again while it watches
  R('POST', '/api/pc/watch', async ({ P, body }) => { me(P); return d.watch ? d.watch(P, Array.isArray(body.agents) ? body.agents.map(num).filter(x => x != null) : []) : { watching: [] }; });
  const READS = ['list', 'read', 'docs', 'doc'];
  R('GET', '/api/pc/own', async ({ P, url }) => {
    const sp = url.searchParams, a = own(P, sp.get('agent')), op = str(sp.get('op'), 20);
    if (!READS.includes(op)) throw new PcError(400, 'bad_request', 'Which call?');
    return ownCall(P, a, op, { path: str(sp.get('path')), name: str(sp.get('name'), 200), offset: num(sp.get('from')) || 0 });
  });
  // a file of it as itself: to show (pictures, recordings, PDFs — sandboxed) or to download
  R('GET', '/api/pc/own/file', async ({ P, url }) => {
    const sp = url.searchParams, a = own(P, sp.get('agent'));
    const f = await ownCall(P, a, 'read', { path: str(sp.get('path')) });
    const body = Buffer.from(String(f.content ?? ''), f.encoding === 'base64' ? 'base64' : 'utf8');
    const mime = String(f.mime || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const show = sp.get('download') !== '1' && INLINE.test(mime);
    const name = encodeURIComponent(String(f.name || 'file').slice(0, 200)).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    return { raw: { body, headers: { 'content-type': show ? mime : 'application/octet-stream', 'content-disposition': `${show ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'" } } };
  });
  R('POST', '/api/pc/own', async ({ P, body }) => {
    const a = own(P, body.agent), op = str(body.op, 20);
    const p = { path: str(body.path), name: str(body.name, 200) };
    if (typeof body.content === 'string') p.content = body.content;
    for (const k of ['encoding', 'mime', 'expectedHash']) if (typeof body[k] === 'string') p[k] = str(body[k], 200);
    for (const k of ['overwrite', 'recursive']) if (typeof body[k] === 'boolean') p[k] = body[k];
    return ownCall(P, a, op, p, true);
  }, { reauth: true });
  // a file uploaded onto it as it is (Hermes' machine): the body is the file; ?agent & path name where it goes
  R('POST', '/api/pc/own/upload', async ({ P, req, url }) => {
    const sp = url.searchParams;
    let a, buf;
    try { a = own(P, sp.get('agent')); buf = await readBody(req, 25 * 1048576); } catch (e) { req.resume(); throw e; }
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    return ownCall(P, a, 'write', { path: str(sp.get('path')), content: buf.toString('base64'), encoding: 'base64', mime: mime || 'application/octet-stream', overwrite: sp.get('replace') === '1' }, true);
  }, { raw: true, reauth: true });

  // ------------------------------------------------------------------ teams
  R('GET', '/api/pc/teams', ({ P }) => ({ teams: pc.teamsOf(me(P)), gone: pc.goneTeams(me(P)) }));
  R('POST', '/api/pc/teams', ({ P, body }) => pc.createTeam(me(P), { name: str(body.name, 100), brief: str(body.brief, 5000), color: str(body.color, 20) }));
  R('POST', '/api/pc/teams/update', ({ P, body }) => pc.updateTeam(me(P), num(body.id), {
    ...(body.name !== undefined ? { name: str(body.name, 100) } : {}), ...(body.brief !== undefined ? { brief: str(body.brief, 5000) } : {}),
    ...(body.color !== undefined ? { color: str(body.color, 20) } : {}), ...(body.office !== undefined ? { office: body.office } : {}) }));
  R('POST', '/api/pc/teams/delete', ({ P, body }) => pc.deleteTeam(me(P), num(body.id)));
  R('POST', '/api/pc/teams/restore', ({ P, body }) => pc.restoreTeam(me(P), num(body.id)));
  R('POST', '/api/pc/teams/member', ({ P, body }) => pc.setMember(me(P), num(body.team), num(body.agent), body.role == null ? null : str(body.role, 10)));

  // ------------------------------------------------------------------ boards
  const boardWhere = src => { const w = where(src); return { at: w.opt.space != null ? '/' : w.path, opt: w.opt }; };
  R('GET', '/api/pc/board', ({ P, url }) => { const w = boardWhere(url.searchParams); return pc.board(me(P), w.at, w.opt); });
  R('POST', '/api/pc/cards', ({ P, body }) => {
    const w = boardWhere(body);
    return pc.addCard(me(P), w.at, { title: str(body.title, 300), notes: str(body.notes, 9000), assignee: num(body.assignee), due: body.due ?? null, col: str(body.col, 10) || 'todo' }, w.opt);
  });
  R('POST', '/api/pc/cards/update', ({ P, body }) => {
    const patch = {};
    for (const k of ['col', 'title', 'notes', 'addNote']) if (typeof body[k] === 'string') patch[k] = body[k];
    if (body.assignee !== undefined) patch.assignee = body.assignee === null ? null : num(body.assignee);
    if (body.due !== undefined) patch.due = body.due;
    if (body.pos !== undefined) patch.pos = body.pos;
    return pc.updateCard(me(P), num(body.id), patch);
  });
  R('POST', '/api/pc/cards/remove', ({ P, body }) => pc.removeCard(me(P), num(body.id)));

  // ------------------------------------------------------------------ calendars
  R('GET', '/api/pc/events', ({ P, url }) => {
    const sp = url.searchParams;
    const prof = num(sp.get('profile')), space = num(sp.get('space'));
    const o = { ...(prof != null ? { profile: prof } : {}) };
    if (space != null) { o.space = space; o.where = '/'; } else if (sp.get('where')) o.where = str(sp.get('where'), 200);
    return pc.events(me(P), Number(sp.get('from')), Number(sp.get('to')), o);
  });
  R('POST', '/api/pc/events', ({ P, body }) => {
    const w = boardWhere(body);
    return pc.addEvent(me(P), w.at, { title: str(body.title, 300), start: body.start, end: body.end, allDay: body.allDay === true, place: str(body.place, 200), notes: str(body.notes, 9000) }, w.opt);
  });
  R('POST', '/api/pc/events/update', ({ P, body }) => {
    const patch = {};
    for (const k of ['title', 'place', 'notes']) if (typeof body[k] === 'string') patch[k] = body[k];
    for (const k of ['start', 'end']) if (body[k] !== undefined) patch[k] = body[k];
    if (body.allDay !== undefined) patch.allDay = body.allDay === true;
    return pc.updateEvent(me(P), num(body.id), patch);
  });
  R('POST', '/api/pc/events/remove', ({ P, body }) => pc.removeEvent(me(P), num(body.id)));
}
