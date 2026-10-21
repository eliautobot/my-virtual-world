// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The OpenClaw adapter (docs/features/agent-providers.md): runs in the provider helper process (../host-main.mjs) and
// keeps one live connection per OpenClaw connection (./link.js). Every call carries the connection's settings and
// credentials; the connection is (re)built from them when they change.
// - connect / disconnect / status: the live connection (the server's Agent Providers service opens it at start and
//   whenever the connection changes; its state flows as provider.status events).
// - test / refresh: connect and wait until the state settles (connected, waiting for approval, or what is wrong).
// - discover / agents: the gateway's agents (agents.list).
// - detect: which of the given addresses has an OpenClaw gateway listening (it sends connect.challenge first; nothing
//   is sent to it and no credential is used).
import fs from 'node:fs';
import dns from 'node:dns/promises';
import net from 'node:net';
import WebSocket from 'ws';
import { BUILTIN_MANIFESTS } from '../manifest.js';
import { privateAddress } from '../models.js';
import { GatewayLink, KIND } from './link.js';
import { LinkChat } from './chat.js';
import { LinkActivity } from './activity.js';
import { LinkTasks } from './tasks.js';
import { LinkBrowser } from './browser.js';
import { menuCall } from './menu.js';
import { filesCall } from './files.js';

const manifest = BUILTIN_MANIFESTS.find(m => m.id === KIND);
/** Runs the calls `n` at a time; each gives its answer, or null when it failed. */
async function pooled(calls, n) {
  const out = new Array(calls.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, calls.length) }, async () => { while (next < calls.length) { const i = next++; try { out[i] = await calls[i](); } catch { out[i] = null; } } }));
  return out;
}
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version || '0.0.0'; } catch { return '0.0.0'; } })();
const links = new Map();   // connectionId → GatewayLink
let host = { emit: () => {}, persist: () => {} };
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** The largest medium an answer's media are fetched up to (a longer video says so and is opened in OpenClaw). */
export const MEDIA_MAX = 40 * 1024 * 1024;
const DEFAULTS = Object.fromEntries(manifest.fields.filter(f => f.type !== 'secret' && f.default !== undefined).map(f => [f.key, f.default]));

/** The live connection for a call's connection, (re)built for its settings. A connection that isn't an installation's
 *  (allowPrivate: an administrator's) may only reach a public address: checked whenever the address changes, here as well
 *  as by the server. */
async function linkFor({ connectionId, config = {}, secrets = {}, allowPrivate = false }) {
  if (!connectionId) throw fail('bad_request', 'Which connection?');
  const id = String(connectionId), cfg = { ...DEFAULTS, ...config };
  let l = links.get(id);
  if (!l) {
    l = new GatewayLink({ connectionId: id, clientVersion: VERSION, emit: e => host.emit(e), persist: (field, value) => host.persist(id, field, value),
      onEvent: evt => { l.activity.onEvent(evt); l.chat.onEvent(evt); l.tasks.onEvent(evt); }, onHello: () => { l.chat.onHello(); l.activity.onHello(); },
      onDown: () => { l.chat.onDown(); l.activity.onDown(); l.tasks.onDown(); l.browser.onDown(); } });
    l.chat = new LinkChat(l, { emit: e => host.emit(e), kind: KIND });
    l.activity = new LinkActivity(l, { emit: e => host.emit(e), kind: KIND });   // (what its agents are doing, wherever: live presence)
    l.tasks = new LinkTasks(l, { emit: e => host.emit(e), kind: KIND, watched: () => l.chat.watched });   // (the background tasks of the chats a page has open)
    l.browser = new LinkBrowser(l, { origin: () => (l.url ? httpBase(l.url) : null) });   // (its agents' browser, in the chat's side panel)
    links.set(id, l);
  }
  const where = `${cfg.url}|${allowPrivate === true}`;
  if (l.checked !== where) {
    if (!(await publicOrAllowed(cfg.url, allowPrivate === true))) {
      await l.stop();
      throw fail('address_not_public', 'Your own provider connection must use a public address', { fix: 'A gateway on this machine or the local network is added by an administrator for the whole installation.' });
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

/** The gateway's own web address beside its WebSocket one: the same host and port, http(s), and its path as the base
 *  (a gateway served under a path — behind a proxy — is reached there for both). */
export function httpBase(url) {
  const u = new URL(url);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}
async function fetchMedia(url, auth, mimeHint = null) {
  let res;
  try { res = await fetch(url, { headers: auth ? { authorization: `Bearer ${auth}` } : {}, redirect: 'error', signal: AbortSignal.timeout(60000) }); }
  catch (e) { throw fail('unavailable', `The gateway did not send it (${e.name === 'TimeoutError' ? 'it took too long' : 'no answer'})`); }
  if (res.status === 401 || res.status === 403) throw fail('unavailable', 'OpenClaw does not let this session show that file');
  if (!res.ok) throw fail('unavailable', res.status === 404 ? 'OpenClaw has no such file for this session' : `The gateway answered ${res.status}`);
  if (Number(res.headers.get('content-length')) > MEDIA_MAX) { res.body?.cancel().catch(() => {}); throw fail('too_large', 'Too large to show here'); }
  const parts = [];
  let n = 0;
  for await (const c of res.body) {
    n += c.length;
    if (n > MEDIA_MAX) { throw fail('too_large', 'Too large to show here'); }
    parts.push(c);
  }
  const mime = String(res.headers.get('content-type') || mimeHint || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  return { mime, data: Buffer.concat(parts).toString('base64') };
}

/** Whether an OpenClaw gateway answers at a ws(s):// address: it opens with a connect.challenge event. */
export function probe(url, timeoutMs = 2500, WS = WebSocket) {
  return new Promise(resolve => {
    let ws, done = false;
    const end = ok => { if (done) return; done = true; clearTimeout(t); try { ws.terminate(); } catch { /* gone */ } resolve(ok); };
    const t = setTimeout(() => end(false), timeoutMs);
    try { ws = new WS(url, { handshakeTimeout: timeoutMs, maxPayload: 65536 }); } catch { end(false); return; }
    ws.on('message', d => { try { const f = JSON.parse(String(d)); end(f && f.type === 'event' && f.event === 'connect.challenge'); } catch { end(false); } });
    ws.on('error', () => end(false));
    ws.on('close', () => end(false));
  });
}

const adapter = {
  manifest,
  attach(h) { host = h; },
  async shutdown() { await Promise.all([...links.values()].map(l => { l.chat.close('My Virtual World\'s provider helper stopped'); return l.stop(); })); links.clear(); },

  async connect(p) { const l = await linkFor(p); return l.snapshot(); },
  async disconnect({ connectionId }) {
    const l = links.get(String(connectionId));
    if (l) { links.delete(String(connectionId)); l.chat.close('The connection to OpenClaw was closed here (reconnected, switched off or changed)'); await l.stop(); }
    return { ok: true };
  },
  /** The connection is being removed: its device takes itself off the gateway's paired devices where it may (access
   *  'full': operator.admin covers device.pair.remove), then the link closes. { unpaired } says whether it did. */
  async forget({ connectionId }) {
    const l = links.get(String(connectionId));
    if (!l) return { unpaired: false };
    links.delete(String(connectionId));
    l.chat.close('The OpenClaw connection was removed');
    let unpaired = false;
    const scopes = l.hello && l.hello.auth && Array.isArray(l.hello.auth.scopes) ? l.hello.auth.scopes : [];
    if (l.connected && l.identity && l.offers('device.pair.remove') && scopes.includes('operator.admin')) {
      try { await l.request('device.pair.remove', { deviceId: l.identity.deviceId }, { timeoutMs: 4000 }); unpaired = true; } catch { /* it stays listed in OpenClaw's Devices */ }
    }
    await l.stop();
    return { unpaired };
  },
  async status({ connectionId }) { const l = links.get(String(connectionId)); return l ? l.snapshot() : { state: 'offline' }; },

  async test(p) {
    const l = await linkFor(p);
    const s = await l.settle();
    if (s.state === 'connected') return { ok: true, detail: s.detail, state: s.state, version: s.version };
    return { ok: false, error: s.detail || 'Not connected', fix: s.fix, state: s.state, requestId: s.requestId, code: s.code };
  },
  async refresh(p) { return adapter.test(p); },

  /** The gateway's agents: { defaultId, agents: [{ id, name, emoji }] } (discover: the same, for Settings → Connections).
   *  Their names and emojis as OpenClaw shows them: agents.list carries only what its settings say, so each agent's
   *  identity is asked too (agent.identity.get: its settings, or its workspace's IDENTITY.md). OpenClaw's own agents
   *  (kind system) are not listed. */
  async agents(p) {
    const l = await linkFor(p);
    const r = await l.request('agents.list', {});
    const list = (Array.isArray(r && r.agents) ? r.agents : []).filter(a => a && typeof a.id === 'string' && a.id && a.kind !== 'system').slice(0, 200);
    const ids = l.offers('agent.identity.get') ? await pooled(list.map(a => () => l.request('agent.identity.get', { agentId: a.id }, { timeoutMs: 8000 })), 4) : [];
    return { defaultId: r && r.defaultId ? String(r.defaultId) : null,
      agents: list.map((a, i) => {
        const id = ids[i] || {}, cfg = a.identity || {};
        // (a name OpenClaw only made up — its generic default, "Assistant" — gives way to the one in its list, else its id:
        // two agents with no name of their own stay told apart)
        const name = (id.name && id.nameSource !== 'default' && id.name) || cfg.name || a.name || a.id;
        return { id: a.id.slice(0, 120), name: String(name).slice(0, 60), emoji: String(id.emoji || cfg.emoji || '').slice(0, 32) };
      }) };
  },
  async discover(p) {
    try { const r = await adapter.agents(p); return { ok: true, agents: r.agents.map(a => ({ nativeId: a.id, name: a.name })) }; }
    catch (e) { return { ok: false, error: e.message, fix: e.fix }; }
  },

  // ---------------------------------------------------------------- the chat (./chat.js)
  async run(p) { return (await linkFor(p)).chat.run(p); },
  async stop(p) { return (await linkFor(p)).chat.stop(p); },
  async approve(p) { return (await linkFor(p)).chat.approve(p); },
  async history(p) { return (await linkFor(p)).chat.history(p); },
  async models(p) { return (await linkFor(p)).chat.models(p); },
  async sessions(p) { return (await linkFor(p)).chat.sessions(p); },
  async patchSession(p) { return (await linkFor(p)).chat.patchSession(p); },
  async deleteSession(p) { return (await linkFor(p)).chat.deleteSession(p); },
  async answer(p) { return (await linkFor(p)).chat.answer(p); },
  async watch(p) { return (await linkFor(p)).chat.watch(p); },
  async unwatch(p) { return (await linkFor(p)).chat.unwatch(p); },
  async commands(p) { return (await linkFor(p)).chat.commands(p); },
  async refreshCard(p) { return (await linkFor(p)).chat.refreshCard(p); },
  async dismissCard(p) { return (await linkFor(p)).chat.dismissCard(p); },
  async tasks(p) { return (await linkFor(p)).tasks.list(p); },
  async task(p) { return (await linkFor(p)).tasks.get(p); },
  async taskHistory(p) { return (await linkFor(p)).tasks.history(p); },
  async cancelTask(p) { return (await linkFor(p)).tasks.cancel(p); },
  /** The attachment limits the gateway announced (its hello: policy.attachments). */
  async limits(p) { const a = (await linkFor(p)).hello?.policy?.attachments || {}; return { maxBytes: a.maxBytes, maxImageBytes: a.maxImageBytes }; },
  async browserState(p) { return (await linkFor(p)).browser.state(p); },
  async browserAct(p) { return (await linkFor(p)).browser.act(p); },
  async browserFrame(p) { return (await linkFor(p)).browser.frame(p); },

  /**
   * One of an answer's media, fetched the way OpenClaw's own UI fetches it ({ sessionKey, agentKey, ref }): a kept one
   * (ref.artifactId) through artifacts.download — its bytes, or a short-lived link carrying its own ticket — and a path or
   * address an agent wrote (ref.source) through the gateway's assistant-media route, signed in with this device's token;
   * OpenClaw's own rules decide which files a session may show. Returns { mime, data } (base64), at most MEDIA_MAX.
   */
  async media(p) {
    const l = await linkFor(p);
    const ref = (p && p.ref) || {}, sessionKey = String(p.sessionKey || '');
    if (!sessionKey) throw fail('bad_request', 'Which session?');
    const cfg = { ...DEFAULTS, ...(p.config || {}) }, base = httpBase(cfg.url), auth = l.bearer();
    if (typeof ref.artifactId === 'string' && ref.artifactId) {
      const r = await l.request('artifacts.download', { sessionKey, artifactId: ref.artifactId }, { timeoutMs: 30000 });
      const mime = r && r.artifact && r.artifact.mimeType;
      if (r && typeof r.data === 'string') {
        const b = Buffer.from(r.data, 'base64');
        if (b.length > MEDIA_MAX) throw fail('too_large', 'Too large to show here');
        return { mime: mime || 'application/octet-stream', data: b.toString('base64') };
      }
      if (r && typeof r.url === 'string' && r.url.startsWith('/')) return fetchMedia(base + r.url, auth, mime);
      throw fail('unavailable', 'OpenClaw keeps this attachment where it can\'t be fetched');
    }
    if (typeof ref.source === 'string' && ref.source) {
      const q = new URLSearchParams({ sessionKey, source: ref.source });
      if (p.agentKey) q.set('agentId', String(p.agentKey));
      return fetchMedia(`${base}/__openclaw__/assistant-media?${q}`, auth);
    }
    throw fail('bad_request', 'Which attachment?');
  },

  // ---------------------------------------------------------------- the sub-menu (./menu.js)
  /** One of the sub-menu's calls: { method, params } — only the listed ones; no secret's value comes back. */
  async menu(p) { return menuCall(await linkFor(p), String(p.method || ''), p.params || {}); },
  /** Its agent's own computer in the owner's PC (./files.js): { op, agentId, … }; a change needs Full access. */
  async files(p) {
    const op = String(p.op || '');
    if (!manifest.computer.ops.includes(op)) throw fail('unsupported', `There is no file call ${op}`);
    if ((p.config || {}).access === 'chat' && manifest.computer.writes.includes(op)) throw fail('forbidden', 'This connection has Chat only access: its agents\' documents are not changed from here');
    return filesCall(await linkFor(p), op, p.params || {});
  },

  async detect({ candidates = [] }) {
    const list = [...new Set((Array.isArray(candidates) ? candidates : []).filter(u => typeof u === 'string' && /^wss?:\/\//.test(u)))].slice(0, 6);
    const found = [];
    await Promise.all(list.map(async u => { if (await probe(u)) found.push(u); }));
    return { found: list.filter(u => found.includes(u)) };
  },
};

export default adapter;
