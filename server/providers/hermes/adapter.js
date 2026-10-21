// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Hermes adapter (docs/features/agent-providers.md §9): runs in the provider helper process (../host-main.mjs) and
// keeps one live connection per Hermes connection (./link.js) - to a `hermes serve` / `hermes dashboard` backend, as Hermes
// Desktop connects to a Remote gateway. Every call carries the connection's settings and credentials; the connection is
// (re)built from them when they change. The calls are the same as every live provider's (../openclaw/adapter.js): the
// universal chat window and Agent Providers know nothing of which provider answers them.
import dns from 'node:dns/promises';
import net from 'node:net';
import { BUILTIN_MANIFESTS } from '../manifest.js';
import { privateAddress } from '../models.js';
import { HermesLink, KIND, probe } from './link.js';
import { LinkChat } from './chat.js';
import { LinkActivity } from './activity.js';
import { LinkTasks } from './tasks.js';
import { menuCall } from './menu.js';
import { filesCall } from './files.js';
import { LinkScreen } from './screen.js';

const manifest = BUILTIN_MANIFESTS.find(m => m.id === KIND);
const DEFAULTS = Object.fromEntries(manifest.fields.filter(f => f.type !== 'secret' && f.default !== undefined).map(f => [f.key, f.default]));
/** The largest medium an answer's media are fetched up to (Hermes' own file route caps its own size too). */
export const MEDIA_MAX = 40 * 1024 * 1024;
const links = new Map();   // connectionId → HermesLink
let host = { emit: () => {}, persist: () => {} };
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** The live connection for a call's connection, (re)built for its settings. A person's own connection may only reach a
 *  public address (an administrator's installation connection may reach this machine and the local network). */
async function linkFor({ connectionId, config = {}, secrets = {}, allowPrivate = false }) {
  if (!connectionId) throw fail('bad_request', 'Which connection?');
  const id = String(connectionId), cfg = { ...DEFAULTS, ...config };
  let l = links.get(id);
  if (!l) {
    l = new HermesLink({ connectionId: id, emit: e => host.emit(e), persist: (field, value) => host.persist(id, field, value),
      onEvent: evt => { l.chat.onEvent(evt); l.activity.onEvent(evt); l.tasks.onEvent(evt); },
      onRequest: rq => l.chat.onRequest(rq),
      onReady: () => { l.chat.onReady(); l.activity.onReady(); },
      onDown: () => { l.chat.onDown(); l.activity.onDown(); l.tasks.onDown(); } });
    l.chat = new LinkChat(l, { emit: e => host.emit(e), kind: KIND });
    l.activity = new LinkActivity(l, { emit: e => host.emit(e), kind: KIND, profiles: () => (l.info && Array.isArray(l.info.profiles) ? l.info.profiles : ['default']).filter(x => typeof x === 'string').slice(0, 50) });
    l.tasks = new LinkTasks(l, { emit: e => host.emit(e), kind: KIND, chat: l.chat });
    l.screen = new LinkScreen(l);
    links.set(id, l);
  }
  const where = `${cfg.url}|${allowPrivate === true}`;
  if (l.checked !== where) {
    if (!(await publicOrAllowed(cfg.url, allowPrivate === true))) {
      await l.stop();
      throw fail('address_not_public', 'Your own provider connection must use a public address', { fix: 'A Hermes on this machine or the local network is added by an administrator for the whole installation.' });
    }
    l.checked = where;
  }
  l.configure(cfg, secrets);
  return l;
}
async function publicOrAllowed(url, allowPrivate) {
  if (allowPrivate) return true;
  let u; try { u = new URL(url); } catch { return false; }
  const h = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) return !privateAddress(h);
  try { const list = await dns.lookup(h, { all: true }); return list.length > 0 && list.every(x => !privateAddress(x.address)); } catch { return false; }
}
function screenAccess(p) {
  if ((p.config || {}).access === 'chat') throw fail('forbidden', 'This connection is set up for chat only: the agent\'s screen needs Full access', { fix: 'Edit the connection and choose Full access.' });
}

const adapter = {
  manifest,
  attach(h) { host = h; },
  async shutdown() { await Promise.all([...links.values()].map(l => { l.chat.close('My Virtual World\'s provider helper stopped'); return l.stop(); })); links.clear(); },

  async connect(p) { const l = await linkFor(p); return l.snapshot(); },
  async disconnect({ connectionId }) {
    const l = links.get(String(connectionId));
    if (l) { links.delete(String(connectionId)); l.chat.close('The connection to Hermes was closed here (reconnected, switched off or changed)'); await l.stop(); }
    return { ok: true };
  },
  /** The connection is being removed: Hermes keeps no record of this client (a session token, or sign-in tokens it lets
   *  expire), so there is nothing to take off it; the link closes. */
  async forget({ connectionId }) {
    const l = links.get(String(connectionId));
    if (l) { links.delete(String(connectionId)); l.chat.close('The Hermes connection was removed'); await l.stop(); }
    return { unpaired: false };
  },
  async status({ connectionId }) { const l = links.get(String(connectionId)); return l ? l.snapshot() : { state: 'offline' }; },
  async test(p) {
    const l = await linkFor(p);
    const s = await l.settle();
    if (s.state === 'connected') return { ok: true, detail: s.detail, state: s.state, version: s.version };
    return { ok: false, error: s.detail || 'Not connected', fix: s.fix, state: s.state, code: s.code };
  },
  async refresh(p) { return adapter.test(p); },

  /** Hermes' agents - its profiles: { defaultId, agents: [{ id, name, emoji }] }, named as Hermes shows them. */
  async agents(p) {
    const l = await linkFor(p);
    const r = await l.request('profiles.list', {});
    const list = (r && Array.isArray(r.profiles) ? r.profiles : []).filter(x => x && typeof x.name === 'string' && x.name && x.role !== 'setup').slice(0, 200);
    const def = list.find(x => x.is_default);
    return { defaultId: def ? def.name : null,
      agents: list.map(x => ({ id: x.name.slice(0, 120), name: String(x.display_name || x.name).slice(0, 60), emoji: String((x.ui_meta && (x.ui_meta.emoji || x.ui_meta.avatar_emoji)) || '').slice(0, 32) })) };
  },
  async discover(p) {
    try { const r = await adapter.agents(p); return { ok: true, agents: r.agents.map(a => ({ nativeId: a.id, name: a.name })) }; }
    catch (e) { return { ok: false, error: e.message, fix: e.fix }; }
  },

  // ---------------------------------------------------------------- the chat (./chat.js)
  async run(p) { return (await linkFor(p)).chat.run(p); },
  async stop(p) { return (await linkFor(p)).chat.stop(p); },
  async approve(p) { return (await linkFor(p)).chat.approve(p); },
  async answer(p) { return (await linkFor(p)).chat.answer(p); },
  async history(p) { return (await linkFor(p)).chat.history(p); },
  async models(p) { return (await linkFor(p)).chat.models(p); },
  async sessions(p) { return (await linkFor(p)).chat.sessions(p); },
  async patchSession(p) { return (await linkFor(p)).chat.patchSession(p); },
  async deleteSession(p) { return (await linkFor(p)).chat.deleteSession(p); },
  async branch(p) { return (await linkFor(p)).chat.branch(p); },
  async archive(p) { return (await linkFor(p)).chat.archive(p); },
  async watch(p) { return (await linkFor(p)).chat.watch(p); },
  async unwatch(p) { return (await linkFor(p)).chat.unwatch(p); },
  async commands(p) { return (await linkFor(p)).chat.commands(p); },
  async native(p) { return (await linkFor(p)).chat.native(p); },
  async tasks(p) { return (await linkFor(p)).tasks.list(p); },
  async task(p) { return (await linkFor(p)).tasks.get(p); },
  async taskHistory(p) { return (await linkFor(p)).tasks.history(p); },
  async cancelTask(p) { return (await linkFor(p)).tasks.cancel(p); },
  async steerTask(p) { return (await linkFor(p)).tasks.steer(p); },
  /** Hermes takes a remote client's attachment in one frame (its Desktop's: up to 256 MB raw); this installation's own
   *  limit applies first. Nothing smaller is announced. */
  async limits() { return {}; },

  /** One of an answer's media ({ sessionKey, agentKey, ref: { source } }: the path the agent wrote in a MEDIA line),
   *  fetched through Hermes' own file route with this connection's credential - Hermes' file policy decides what it serves. */
  async media(p) {
    const l = await linkFor(p);
    const ref = (p && p.ref) || {};
    if (typeof ref.source !== 'string' || !ref.source) throw fail('bad_request', 'Which attachment?');
    if (/^https?:\/\//i.test(ref.source)) throw fail('unavailable', 'This attachment is a web address: open it there');
    let res;
    try { res = await l.rest('GET', '/api/files/download', { query: { path: ref.source, profile: String(p.agentKey || '') || undefined }, raw: true, timeoutMs: 60000 }); }
    catch (e) { throw fail('unavailable', `Hermes did not send it (${e.message})`); }
    if (res.status === 401 || res.status === 403) throw fail('unavailable', 'Hermes does not let this connection read that file');
    if (!res.ok) throw fail('unavailable', res.status === 404 ? 'Hermes has no such file' : res.status === 413 ? 'Too large to show here' : `Hermes answered ${res.status}`);
    if (Number(res.headers.get('content-length')) > MEDIA_MAX) { res.body?.cancel().catch(() => {}); throw fail('too_large', 'Too large to show here'); }
    const parts = [];
    let n = 0;
    for await (const c of res.body) { n += c.length; if (n > MEDIA_MAX) throw fail('too_large', 'Too large to show here'); parts.push(c); }
    const mime = String(res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    return { mime, data: Buffer.concat(parts).toString('base64') };
  },

  // ---------------------------------------------------------------- the sub-menu (./menu.js)
  /** One of the sub-menu's calls. Hermes has no access levels of its own for a connection: with Chat only access this
   *  adapter takes none of the calls that change something. */
  async menu(p) {
    const method = String(p.method || '');
    if ((p.config || {}).access === 'chat' && manifest.menuWrite.includes(method)) throw fail('forbidden', 'This connection has Chat only access: Hermes\' settings are not changed from here', { fix: 'Edit the connection and choose Full access.' });
    return menuCall(await linkFor(p), method, p.params || {});
  },

  /** Its agent's own computer in the owner's PC (./files.js): { op, … }; a change needs Full access. */
  async files(p) {
    const op = String(p.op || '');
    if (!manifest.computer.ops.includes(op)) throw fail('unsupported', `There is no file call ${op}`);
    if ((p.config || {}).access === 'chat' && manifest.computer.writes.includes(op)) throw fail('forbidden', 'This connection has Chat only access: files on Hermes\' computer are not changed from here');
    return filesCall(await linkFor(p), op, p.params || {});
  },

  // ---------------------------------------------------------------- its screen (./screen.js: Hermes' Bot Desktop)
  /** The agent's own screen: watching it, taking it over and starting it are its machine's - Full access only (as
   *  OpenClaw's browser needs Full access). viewer: the person asking (their own viewer id on Hermes). */
  async screenState(p) {
    if ((p.config || {}).access === 'chat') return { available: false, reason: 'This connection is set up for chat only: the agent\'s screen needs Full access (Agent Providers → its settings).' };
    return (await linkFor(p)).screen.state(p);
  },
  async screenAct(p) { screenAccess(p); return (await linkFor(p)).screen.act(p); },
  async screenTicket(p) { screenAccess(p); return (await linkFor(p)).screen.ticket(p); },
  async screenThumb(p) { screenAccess(p); return (await linkFor(p)).screen.thumb(p); },

  async detect({ candidates = [] }) {
    const list = [...new Set((Array.isArray(candidates) ? candidates : []).filter(u => typeof u === 'string' && /^https?:\/\//.test(u)))].slice(0, 6);
    const found = [];
    await Promise.all(list.map(async u => { if (await probe(u)) found.push(u); }));
    return { found: list.filter(u => found.includes(u)) };
  },
};

export default adapter;
