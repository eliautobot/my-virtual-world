// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat contract over the provider registry (PLAN WP2.2; DECISIONS C11, C14, C119, C120, A8, A9; CHECKLIST I11.4, I11.9, X11).
// - Every call names an agent and checks that the account may use it (agents.canUse); otherwise the agent does not exist for it (404).
// - A session belongs to one account and one agent (C119). Run, tool and approval events go ONLY to the account that started the run.
// - A run needs the agent's connection to exist, be enabled and have a working adapter. A submission whose delivery became uncertain
//   is reported and never retried (A9); a provider-helper restart interrupts in-flight runs and never replays them (C120).
// - History is the provider's export merged with the local transcript mirror.
import crypto from 'node:crypto';
import { isExtKey } from '../agents.js';
import { LAZY_KEY } from './sessions.js';
import { mergeHistory } from './transcript.js';
import { task as cleanTask, NATIVE_CALLS } from '../providers/bus.js';
import { isAv } from './attachments.js';

/** An adapter's error codes about the request itself, as HTTP statuses (any other error is the provider's: 502). */
const ADAPTER_STATUS = Object.freeze({ bad_request: 400, not_found: 404, forbidden: 403 });
import { MODES, validZone } from '../agent-work/work.js';

export class ChatError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const EVENT_BUFFER = 500;
const RUN_KEEP_MS = 5 * 60 * 1000;
const INPUT_MAX = 100000;   // (a pasted document or log)
const EFFORTS = ['off', 'low', 'medium', 'high'];
// (a provider names its own thinking levels per model - OpenClaw: off, minimal, low, medium, high, xhigh…; the provider
// checks the level against the model, this only that it is a level's name)
const EFFORT_NAME = /^[a-z][a-z0-9_-]{0,23}$/;
const effortOk = (v, kind) => (kind && kind !== 'models' ? EFFORT_NAME.test(v) : EFFORTS.includes(v));
const DECISIONS = ['allow-once', 'allow-session', 'allow-always', 'deny'];
const SYNC_MS = 15000;   // a provider's own session list is read again at most this often per account and agent
const DEFAULT_LABEL = /^(New session|New chat)$/;
const VISITOR_HIDDEN = /^(tool\.|approval\.|question\.|plan\.|native$)/;   // a visitor sees the answer, not the agent's tools or what it asks its owner
const MAX_ATTACHMENTS = 10;
// only these event fields leave the server (the bus already whitelists them; this is the browser-facing subset)
const PUBLIC = ['type', 'ts', 'text', 'thinking', 'pct', 'status', 'error', 'toolId', 'name', 'input', 'ok', 'approvalId', 'tool', 'summary', 'approved',
  'model', 'effort', 'tokensIn', 'tokensOut', 'cost', 'ms', 'title',
  // (Agent Providers: what a run is doing, a step's kind and how it ended, an approval's command and its choices, the context meter)
  'phase', 'replace', 'toolKind', 'exitCode', 'cwd', 'approvalKind', 'command', 'options', 'decision', 'expiresAt', 'used', 'size',
  'questionId', 'questions', 'answers', 'explanation', 'steps', 'markdown', 'media', 'steered',
  // (a provider's own stream for its chat view: one operation, rebuilt by its own whitelist on the bus)
  'ev'];
const pub = e => Object.fromEntries(PUBLIC.filter(k => e[k] !== undefined).map(k => [k, e[k]]));

export class Chat {
  /**
   * @param {{ agents, connections, registry, host, bus, sessions, transcripts, attachments, references, agentOk: (key: string) => boolean,
   *   send: (accountId: number, frame: object) => void, log?: object, now?: () => number }} o
   */
  constructor({ agents, connections, registry, host, bus, sessions, transcripts, attachments, references, projects = null, work = null, agentOk, send, inproc = {}, media = null, log = null, now = () => Date.now() }) {
    this.media = media;     // the media of providers' answers (./provider-media.js): signed addresses, fetched once, cached
    this.inproc = inproc;   // kinds the server itself answers for (the connected agents of WP2.14): kind → async (connection, method, params)
    Object.assign(this, { agents, connections, registry, host, sessions, transcripts, attachments, references, projects, work, agentOk, send, log, now });
    this.working = new Map();   // connection id → provider agent key → its session keys running a turn (agent.activity)
    this.runs = new Map();   // runId → { accountId, agentId, agentKey, sessionId, kind, connectionId, seq, events, done, uncertain, at }
    this.watchers = new Map();   // `${connectionId}|${sessionKey}` → Map(accountId → { agentId, sessionId, until }) (Agent Providers: live activity)
    this.observed = new Map();   // a run of another channel being shown → { key, partial, thinking, seq }
    this.sides = new Map();      // a side task a chat started (Hermes' /btw, /bg) → { accountId, agentId, sessionId, at }: who its answer goes to
    bus.on(e => this.onEvent(e));
  }

  // ---------------------------------------------------------------- who and what
  /** The agent, if this principal may use it; else a 404 that confirms nothing. */
  agentFor(P, id) {
    const a = this.agents.get(id);
    if (!P || !P.account || !a || !a.enabled || !this.agents.canUse(P, a)) throw new ChatError(404, 'not_found', 'No such agent');
    return a;
  }
  need(P, agentId, sessionId) {
    const a = this.agentFor(P, agentId);
    const s = sessionId === undefined || sessionId === null ? null : this.sessions.get(P.account.id, sessionId);
    if (sessionId !== undefined && sessionId !== null && (!s || s.agentId !== a.id)) throw new ChatError(404, 'not_found', 'No such session');
    return { a, s };
  }
  /** The connection an agent talks through, or the reason it cannot. */
  linkOf(a) {
    if (!this.agentOk(a.key)) throw new ChatError(403, 'licence_required', 'This agent is not active in demo mode. A licence key unlocks more agents.');
    const c = a.connectionId ? this.connections.get(a.connectionId) : null;
    if (!c) throw new ChatError(409, 'not_connected', 'This agent is not connected to an agent platform yet. Connect it in Settings → Connections.');
    if (!c.enabled) throw new ChatError(409, 'not_connected', 'The connection of this agent is switched off.');
    if (!this.registry.implemented(c.kind)) {
      const m = this.registry.manifest(c.kind);
      throw new ChatError(409, 'not_connected', `${m ? m.label : c.kind} isn't available on this server.`);
    }
    return c;
  }
  async call(c, method, params, opts) {
    if (this.inproc[c.kind]) {
      try { return await this.inproc[c.kind](c, method, params); }
      catch (e) {
        if (e instanceof ChatError) throw e;
        if (e.code === 'unsupported') throw new ChatError(501, 'unsupported', 'This agent does not do that');
        throw new ChatError(e.status || 502, e.code || 'provider_error', e.message);
      }
    }
    try { return await this.host.call(c.kind, method, { connectionId: String(c.id), config: c.config, secrets: this.connections.secretsFor(c.id), allowPrivate: c.scope === 'installation', ...params }, opts); }
    catch (e) {
      if (e.code === 'host_down' || e.code === 'timeout' || e.code === 'run_uncertain') throw new ChatError(502, e.code, e.message);
      if (e.code === 'unsupported') throw new ChatError(501, 'unsupported', 'This agent platform does not do that');
      // (the adapter's own answers about the request - not the provider failing)
      if (Object.hasOwn(ADAPTER_STATUS, e.code)) throw new ChatError(ADAPTER_STATUS[e.code], e.code, e.message);
      throw new ChatError(502, e.code || 'provider_error', e.message);
    }
  }

  // ---------------------------------------------------------------- sessions (C119)
  listSessions(P, agentId) { const { a } = this.need(P, agentId); return this.syncProvider(P, a).then(() => ({ sessions: this.sessions.list(P.account.id, a.id) })); }
  /**
   * A provider that keeps its own sessions (Agent Providers: OpenClaw - started here, in its Control UI or from its
   * channels): whoever manages its connection sees them all in the chat window, each kept as a chat of theirs here (made
   * when first seen, its title the provider's while it has the default one). Anyone else sees only the chats they start.
   * Read again at most every SYNC_MS; a provider that can't answer leaves the list as it is.
   */
  async syncProvider(P, a) {
    const c = a.connectionId ? this.connections.get(a.connectionId) : null;
    const m = c && this.registry.manifest(c.kind);
    if (!c || !c.enabled || !m || !m.live || !m.capabilities?.sessions || !this.registry.implemented(c.kind) || !this.agentOk(a.key)) return;
    if (this.connections.level(P, c) !== 'manage') return;
    this.synced = this.synced || new Map();
    const k = `${P.account.id}:${a.id}`, at = this.synced.get(k) || 0;
    if (this.now() - at < SYNC_MS) return;
    this.synced.set(k, this.now());
    let list;
    try { list = (await this.call(c, 'sessions', { agentKey: a.nativeId || a.key })).sessions; } catch { this.synced.delete(k); return; }
    if (!Array.isArray(list)) return;
    for (const x of list.slice(0, 200)) {
      if (!x || typeof x.key !== 'string' || !x.key || x.key.length > 300) continue;
      const s = this.sessions.byKey(P.account.id, a.id, x.key);
      const title = String(x.title || '').slice(0, 60) || 'Chat';
      if (!s) this.sessions.adopt(P.account.id, a.id, x.key, title, Number(x.updatedAt) || this.now());
      // (a provider whose own titles are the record - Hermes, which names its sessions and renames them as they go -: its
      // title; else only a chat still unnamed here takes it)
      else if (title !== 'Chat' && title !== s.label && (DEFAULT_LABEL.test(s.label) || m.capabilities?.titles)) this.sessions.rename(P.account.id, s.id, title);
    }
  }
  /**
   * A chat copied into a new one up to one of its answers (`upto`: the provider's own count of its record's entries
   * there), as Hermes Desktop's "Branch in new chat": the provider makes the new session (its title, from its lineage);
   * it is this person's chat here at once. Resolves { session }.
   */
  async branchSession(P, agentId, sessionId, upto) {
    const { a, s } = this.need(P, agentId, sessionId);
    const c = this.linkOf(a), m = this.registry.manifest(c.kind);
    if (!m?.capabilities?.branch || !s || s.key === LAZY_KEY) throw new ChatError(400, 'bad_request', 'This chat can\'t be branched');
    // (upto: up to one of its answers; none - the whole chat, as Desktop's chat menu branches it)
    if (upto !== undefined && upto !== null && !(Number.isInteger(upto) && upto > 0)) throw new ChatError(400, 'bad_request', 'Branch from which answer?');
    if ([...this.runs.values()].some(r => r.sessionId === s.id && !r.done && !r.uncertain)) throw new ChatError(409, 'busy', 'Stop the current turn before branching this chat.');
    const r = await this.call(c, 'branch', { agentKey: a.nativeId || a.key, sessionKey: s.key, ...(upto ? { count: upto } : {}) });
    if (!r || typeof r.sessionKey !== 'string' || !r.sessionKey || r.sessionKey.length > 300) throw new ChatError(502, 'provider_error', 'Branch failed');
    const title = String(r.title || `${s.label} (branch)`).slice(0, 60);
    const ns = this.sessions.byKey(P.account.id, a.id, r.sessionKey) || this.sessions.adopt(P.account.id, a.id, r.sessionKey, title, this.now());
    return { session: this.sessions.get(P.account.id, ns.id) };
  }
  /** Archives a chat on the provider (Hermes keeps it, out of its lists); here it leaves the list. */
  async archiveSession(P, agentId, sessionId) {
    const { a, s } = this.need(P, agentId, sessionId);
    const c = this.linkOf(a), m = this.registry.manifest(c.kind);
    if (!m?.capabilities?.archive || !s || s.key === LAZY_KEY) throw new ChatError(400, 'bad_request', 'This chat can\'t be archived');
    if ([...this.runs.values()].some(r => r.sessionId === s.id && !r.done && !r.uncertain)) throw new ChatError(409, 'busy', 'Stop the running answer before archiving this chat');
    await this.call(c, 'archive', { agentKey: a.nativeId || a.key, sessionKey: s.key });
    this.sessions.remove(P.account.id, s.id);
    return { archived: true };
  }
  /**
   * One of the provider's own calls for its chat view (Hermes: its slash commands as its Desktop runs them, its / and @
   * suggestions, its side questions and background tasks - server/providers/hermes/native.js), on this chat's session:
   * only one of that provider's calls, its arguments rebuilt, its answer too. Only for whoever manages the provider (a
   * command changes how the agent works - its approvals, its thinking -, reads its machine's files, runs its tools). A new
   * chat's session is made on the provider first and is this chat's from then on. Resolves { result, session }.
   */
  async native(P, agentId, sessionId, method, params = {}, preview = null) {
    const { a, s } = this.need(P, agentId, sessionId ?? undefined);
    const c = this.linkOf(a), m = this.registry.manifest(c.kind), calls = NATIVE_CALLS[c.kind];
    if (!m?.capabilities?.native || !calls || !this.patches(a)) throw new ChatError(400, 'not_supported', 'This agent\'s provider has no commands of its own here');
    if (this.connections.level(P, c) !== 'manage') throw new ChatError(403, 'forbidden', 'Only whoever manages this agent\'s provider runs its commands');
    const call = calls.call(method, params);
    if (!call) throw new ChatError(400, 'bad_request', 'That is not a command this agent takes here');
    if (call.session === 'need' && !s) throw new ChatError(400, 'bad_request', 'Which session?');
    // (a new chat's session is made with the chat's model and thinking level, as its first message would make it)
    const out = await this.call(c, 'native', { agentKey: a.nativeId || a.key, sessionKey: s ? s.key : null, method: call.method, params: call.params,
      ...(s && s.key === LAZY_KEY ? { model: s.model ?? null, effort: s.effort ?? null } : {}) }, { timeoutMs: call.timeoutMs + 15000 });
    const result = calls.result(call.method, out && out.result);
    // (a new chat: its session on the provider is this chat's now - named, until the provider names it, after the command
    // that began it, as Hermes Desktop's list shows such a chat)
    if (s && s.key === LAZY_KEY && out && typeof out.sessionKey === 'string' && out.sessionKey && out.sessionKey.length <= 300) {
      this.sessions.setKey(s.id, out.sessionKey);
      if (typeof preview === 'string' && preview.trim() && DEFAULT_LABEL.test(s.label || '')) { try { this.sessions.rename(P.account.id, s.id, preview.trim().slice(0, 60)); } catch { /* the session went */ } }
    }
    // (a side task: its answer comes later, outside any turn - to this person)
    if (s && result.task_id) {
      this.sides.set(result.task_id, { accountId: P.account.id, agentId: a.id, sessionId: s.id, at: this.now() });
      for (const [k, v] of this.sides) if (this.sides.size > 500 || this.now() - v.at > 6 * 3600000) this.sides.delete(k); else break;
    }
    // (renamed there - or named while compressing: its name here follows, as Hermes' titles do)
    const title = call.method === 'session.title' ? result.title : call.method === 'session.compress' ? result.title : null;
    if (s && title && m.capabilities?.titles) { try { this.sessions.rename(P.account.id, s.id, title.slice(0, 120)); } catch { /* the session went */ } }
    return { result, ...(s ? { session: this.sessions.get(P.account.id, s.id) } : {}) };
  }
  /** One of a session's own events, outside any turn (Hermes: a side question or background task answered): to whoever
   *  started it from a chat here, and whoever has that session open. */
  onSessionNative(e) {
    const to = new Map(), side = e.ev && e.ev.op === 'side' && e.ev.id ? this.sides.get(e.ev.id) : null;
    if (side) { to.set(side.accountId, { agentId: side.agentId, sessionId: side.sessionId }); this.sides.delete(e.ev.id); }
    const w = this.watchers.get(`${e.connectionId}|${e.sessionKey}`), now = this.now();
    if (w) for (const [accountId, x] of w) if (x.until >= now && !to.has(accountId)) to.set(accountId, { agentId: x.agentId, sessionId: x.sessionId });
    // (one that follows a turn - a review of it: to whoever's turn it was, still known for a while after its end)
    for (const r of this.runs.values()) {
      if (to.has(r.accountId) || String(r.connectionId) !== String(e.connectionId)) continue;
      const s = this.sessions.get(r.accountId, r.sessionId);
      if (s && s.key === e.sessionKey) to.set(r.accountId, { agentId: r.agentId, sessionId: r.sessionId });
    }
    for (const [accountId, x] of to) {
      try { this.send(accountId, { t: 'chat', agent: x.agentId, session: x.sessionId, side: e.ev }); } catch { /* gone with the page */ }
    }
  }
  /** New Session is lazy and non-destructive: the platform's own session is created with the first run. */
  createSession(P, agentId, label) { const { a } = this.need(P, agentId); return this.sessions.create(P.account.id, a.id, LAZY_KEY, label); }
  switchSession(P, agentId, sessionId) { const { s } = this.need(P, agentId, sessionId); this.sessions.touch(s.id); return { session: this.sessions.get(P.account.id, s.id) }; }
  /** Renames a chat; a provider that keeps its own sessions is told too (its own list shows the same name). */
  async renameSession(P, agentId, sessionId, label) {
    const { a, s } = this.need(P, agentId, sessionId);
    const out = this.sessions.rename(P.account.id, s.id, label);
    if (s.key !== LAZY_KEY && this.patches(a)) { try { await this.call(this.linkOf(a), 'patchSession', { agentKey: a.nativeId || a.key, sessionKey: s.key, label: out.label }); } catch { /* named here at least */ } }
    return out;
  }
  /** Whether an agent's provider takes a chat's settings into its own session at once (Agent Providers). */
  patches(a) {
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c && this.registry.manifest(c.kind);
    return !!(m && m.live && m.capabilities?.sessions && this.registry.implemented(c.kind));
  }
  /** Delete is the only destructive action: it removes the session, the local mirror and, where it can, the platform's own copy. */
  async deleteSession(P, agentId, sessionId) {
    const { a, s } = this.need(P, agentId, sessionId);
    if ([...this.runs.values()].some(r => r.sessionId === s.id && !r.done && !r.uncertain)) throw new ChatError(409, 'busy', 'Stop the running answer before deleting this session');
    if (s.key !== LAZY_KEY) { try { const c = this.linkOf(a); await this.call(c, 'deleteSession', { agentKey: a.nativeId || a.key, sessionKey: s.key }); } catch { /* the platform's copy may be gone or unsupported */ } }
    this.sessions.remove(P.account.id, s.id);
    this.transcripts.remove(P.account.id, a.id, s.id);
    return { deleted: s.id };
  }

  // ---------------------------------------------------------------- runs
  /**
   * Sends a message (or writes the last answer again: regenerate; or replaces one of the person's own messages and
   * everything after it: editFrom = its id). model / effort: this run's (else the session's own, else the agent's).
   */
  async startRun(P, { agent, session, input, attachments = [], model, effort, regenerate = false, editFrom = null, tz = null, queue = null, rewind = null }, talk = null) {
    let text = String(input ?? '').trim();
    if (text.length > INPUT_MAX) throw new ChatError(413, 'too_long', 'That message is too long');
    // (talk: a conversation with someone else's agent in the city - server/agent-talk/ found the agent and its session
    // and checked who may talk with it; such a run is always a visitor's: its tools and what it asks its owner unseen)
    const { a, s } = talk ? { a: talk.a, s: talk.s } : this.need(P, agent, session);
    if (!s) throw new ChatError(400, 'bad_request', 'Which session?');
    const c = this.linkOf(a);
    // (a provider that takes messages while its agent works - OpenClaw: into the running turn, or after it - gets them;
    // anything else answers one message at a time. Writing again or editing waits for the answer either way.)
    const busy = [...this.runs.values()].some(r => r.sessionId === s.id && !r.done && !r.uncertain);
    const m = this.registry.manifest(c.kind);
    if (busy && (!m || !m.capabilities?.queue || regenerate || (editFrom !== null && editFrom !== undefined) || (rewind !== null && rewind !== undefined))) throw new ChatError(409, 'busy', 'This session is still answering; stop it or wait');
    // (rewind: the provider's own record, rewound to before one of the person's messages - its row there - and this message
    // sent from that point: an edit, a checkpoint restored, an answer written again, as Hermes Desktop does them)
    if (rewind !== null && rewind !== undefined && (!m?.capabilities?.rewind || !(Number.isInteger(rewind) && rewind >= 0) || talk || s.key === LAZY_KEY)) throw new ChatError(400, 'bad_request', 'That message can\'t be gone back to');
    // (a message while it works: "later" - after this answer -, or "redirect" - into the turn under way, which stops at a
    // safe point and goes on with it: Hermes' session.redirect; a provider without one takes it as its own queue does)
    if (queue !== null && queue !== undefined && queue !== 'later' && queue !== 'redirect') throw new ChatError(400, 'bad_request', 'queue is "later", "redirect" or nothing');
    if (model !== undefined && model !== null && (typeof model !== 'string' || !model.trim() || model.length > 200 || /[\s\u0000-\u001f]/.test(model))) throw new ChatError(400, 'bad_model', 'That is not a model name');
    if (effort !== undefined && effort !== null && (typeof effort !== 'string' || !effortOk(effort, c.kind))) throw new ChatError(400, 'bad_effort', c.kind === 'models' ? 'Thinking effort is off, low, medium or high' : 'That is not a thinking level');
    if (tz !== null && tz !== undefined && (typeof tz !== 'string' || tz.length > 64)) throw new ChatError(400, 'bad_timezone', 'That is not a time zone');
    const zone = tz && validZone(tz) ? tz : null;   // (a zone this server's clock doesn't know: the agent goes by the server's)
    // what is written again: the last message the person sent, and its attachments, after what followed it is gone
    let ids = attachments, after = null;
    if (regenerate) {
      const list = this.transcripts.read(P.account.id, a.id, s.id, 400);
      const last = [...list].reverse().find(m => m.role === 'user');
      if (!last) throw new ChatError(400, 'nothing', 'There is nothing to answer again');
      text = last.text; ids = (last.meta?.attachments || []).map(f => f.id);
      after = list.find(m => m.id > last.id) || null;   // (what followed it goes once the request is known to be good)
    } else if (editFrom !== null && editFrom !== undefined) {
      const m = this.transcripts.get(P.account.id, s.id, editFrom);
      if (!m || m.role !== 'user') throw new ChatError(404, 'not_found', 'No such message');
    }
    if (!Array.isArray(ids) || ids.length > MAX_ATTACHMENTS) throw new ChatError(400, 'bad_attachments', `At most ${MAX_ATTACHMENTS} attachments`);
    if (!text && !ids.length) throw new ChatError(400, 'empty', 'Write something to send');
    const files = ids.map(id => {
      const f = this.attachments.pathOf(P.account.id, id);
      if (!f) throw new ChatError(404, 'not_found', 'No such attachment');   // someone else's, or gone: not confirmed
      return { id: f.id, name: f.name, mime: f.mime, size: f.size, path: f.path };
    });
    // (video and audio only where the provider takes any file - OpenClaw keeps it for the agent; a built-in brain can't watch it)
    const av = files.find(f => isAv(f.mime));
    if (av && !this.registry.manifest(c.kind)?.capabilities?.files) throw new ChatError(415, 'unsupported_file', `${a.name} can't take videos or recordings - ${av.name}. Send images, PDFs, documents or text files.`);
    if (regenerate && after) this.transcripts.truncateFrom(P.account.id, s.id, after.id);
    if (!regenerate && editFrom !== null && editFrom !== undefined) this.transcripts.truncateFrom(P.account.id, s.id, editFrom);
    const prefs = { model: model ?? s.model ?? null, effort: effort ?? s.effort ?? null };
    const runId = `r${crypto.randomBytes(8).toString('hex')}`;
    const run = { accountId: P.account.id, agentId: a.id, agentKey: a.key, sessionId: s.id, kind: c.kind, connectionId: String(c.id), seq: 0, events: [], done: false, uncertain: false, at: this.now(),
      partial: '', thinking: '', label: s.label,
      // WP2.14: a connected agent's owner is not the one who wrote (a visitor); approvals then go to the owner only (C129)
      visitor: !!talk || (isExtKey(a.key) && !this.agents.isOwner(P, a)), ownerId: a.ownerId, approvals: new Map(), talk: !!talk };
    this.runs.set(runId, run);
    const meta = files.length ? { attachments: files.map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size })) } : null;
    if (!regenerate) run.userMessage = this.transcripts.append(P.account.id, a.id, s.id, { role: 'user', text, runId, meta });
    this.sessions.touch(s.id);
    try {
      // a kind the server answers for itself also gets who wrote, which agent, and the conversation so far (the mirror,
      // with each message's attachments where they are still stored)
      // (a chat in a project: the project's name and its instructions go with every message - CHAT.md §12)
      const proj = s.projectId && this.projects ? this.projects.get(P.account.id, s.projectId) : null;
      if (proj) this.projects.touch(proj.id);
      // (its owner's chats with an agent whose brain is the Mind: the chat's Work or Life, and the writer's time zone - CHAT.md §13)
      // (and whether it switched between them: its earlier answers may be from the other)
      const recent = this.inproc[c.kind] ? this.transcripts.read(P.account.id, a.id, s.id, 80) : [];
      const inproc = this.inproc[c.kind] ? { sender: { id: P.account.id, name: P.account.displayName || P.account.login }, agentId: a.id,
        ...(proj ? { project: { name: proj.name, instructions: proj.instructions } } : {}), ...(s.mode ? { mode: s.mode } : {}), ...(zone ? { tz: zone } : {}),
        ...(recent.some(m => m.role === 'system' && m.status === 'mode') ? { switched: true } : {}),
        history: recent.filter(m => m.role !== 'system').map(m => ({ id: m.id, role: m.role, text: m.text,
          files: (m.meta?.attachments || []).map(f => this.attachments.pathOf(P.account.id, f.id)).filter(Boolean).map(f => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, path: f.path })) })) } : {};
      // (agent: this installation's key for the agent, which its events carry; agentKey: the provider's own name for it)
      const out = await this.call(c, 'run', { runId, agent: a.key, agentKey: a.nativeId || a.key, sessionKey: s.key, input: text, attachments: files, ...prefs, ...inproc, ...(busy && queue ? { queue } : {}),
        ...(rewind !== null && rewind !== undefined ? { rewind } : {}) });
      if (out && out.sessionKey && s.key === LAZY_KEY) this.sessions.setKey(s.id, out.sessionKey);
      this.tellRun(run);
    } catch (e) {
      if (e.code === 'run_uncertain') {
        run.uncertain = true;
        this.transcripts.append(P.account.id, a.id, s.id, { role: 'system', text: 'Delivery of this message is uncertain. It may or may not have reached the agent. Check before sending it again.', runId, status: 'uncertain' });
        this.finish(runId, run, { type: 'run.end', runId, status: 'error', error: e.message });
      } else { this.runs.delete(runId); this.transcripts.append(P.account.id, a.id, s.id, { role: 'system', text: e.message, runId, status: 'failed' }); }
      throw e;
    }
    return { runId, session: this.sessions.get(P.account.id, s.id), message: run.userMessage || null };
  }
  finish(runId, run, e) {
    if (run.done) return;
    run.done = true; run.at = this.now();
    this.push(run, runId, { ...e, ts: this.now() });
    this.tellRun(run);
    const t = setTimeout(() => this.runs.delete(runId), RUN_KEEP_MS); t.unref?.();
  }
  push(run, runId, e) {
    run.seq += 1;
    const item = { seq: run.seq, event: pub(e) };
    run.events.push(item); if (run.events.length > EVENT_BUFFER) run.events.shift();
    try {
      const frame = { t: 'chat', run: runId, agent: run.agentId, session: run.sessionId, seq: item.seq, event: item.event };
      if (!run.visitor || !VISITOR_HIDDEN.test(e.type)) this.send(run.accountId, frame);
      if (run.visitor && /^approval\./.test(e.type) && run.ownerId) this.send(run.ownerId, { ...frame, visitorRun: true });
    } catch (err) { this.log?.warn?.('[chat] could not send an event:', err.message); }
  }
  /** Events from the provider bus: to the run's own account only, and the assistant's reply into the transcript mirror. */
  onEvent(e) {
    if (e.type === 'session.card') { this.onCard(e); return; }
    if (e.type === 'session.task') { this.onTask(e); return; }
    if (e.type === 'session.native') { this.onSessionNative(e); return; }
    if (e.type === 'agent.activity') { this.onActivity(e); return; }
    if (e.type === 'provider.disconnected') { this.dropWorking(e.connectionId); return; }
    if (!e.runId) return;
    const run = this.runs.get(e.runId);
    if (!run) { this.onObserved(e); return; }
    if (run.done) return;
    if (e.type === 'run.delta') {
      // a piece of the answer as it is written: sent on, and kept whole (a page that reconnects gets it with events());
      // never in the event buffer (an answer is thousands of pieces). Each piece says where it starts (at, tat), so a page
      // that also read the whole so far (the events route) never adds a piece twice. replace: the provider rewrote the
      // answer so far - the piece is all of it, from 0.
      if (e.replace && typeof e.text === 'string') {
        run.partial = e.text.slice(0, 100000);
        try { this.send(run.accountId, { t: 'chat', run: e.runId, agent: run.agentId, session: run.sessionId, seq: run.seq, delta: { text: run.partial, at: 0, replace: true } }); } catch { /* the page catches up with events() */ }
        return;
      }
      const at = run.partial.length, tat = run.thinking.length;
      if (e.text) run.partial = (run.partial + e.text).slice(0, 100000);
      if (e.thinking) run.thinking = (run.thinking + e.thinking).slice(0, 100000);
      try { this.send(run.accountId, { t: 'chat', run: e.runId, agent: run.agentId, session: run.sessionId, seq: run.seq, delta: { ...(e.text ? { text: e.text, at } : {}), ...(e.thinking ? { thinking: e.thinking, tat } : {}) } }); }
      catch (err) { this.log?.warn?.('[chat] could not send a piece of an answer:', err.message); }
      return;
    }
    if (e.type === 'run.end') {
      // (the media it attached, as the page gets them: signed addresses here, never the provider's own references)
      const media = e.media && this.media ? this.media.view(run.agentId, run.sessionId, e.media) : [];
      e = { ...e, media: media.length ? media : undefined };
      const role = e.status === 'ok' && (e.text || media.length) ? 'assistant' : 'system';
      // (a message the provider took into the turn already running: its answer comes in that turn - nothing of its own)
      if (e.steered && e.status === 'ok' && !e.text && !media.length) { this.sessions.touch(run.sessionId); this.finish(e.runId, run, e); return; }
      // (an approval the answer filed - an agent's payment waiting for its owner's OK - stays with the answer, by its id)
      const approvals = run.visitor ? [] : [...run.approvals].map(([id, a]) => ({ id, tool: a.tool, summary: a.summary })).slice(0, 4);
      const meta = Object.fromEntries(Object.entries({ model: e.model, effort: e.effort, tokensIn: e.tokensIn, tokensOut: e.tokensOut, cost: e.cost, ms: e.ms,
        thinking: e.thinking ? e.thinking.slice(0, 6000) : undefined, approvals: approvals.length ? approvals : undefined, media: e.media }).filter(([, v]) => v !== undefined));
      const m = Object.keys(meta).length ? meta : null;
      // whatever the agent wrote is the person's to read, however the run ended (the product owner 19:27: a listener sent its answer and ended the run 'interrupted')
      const written = e.text || (e.status !== 'ok' ? run.partial : '');
      if (e.status !== 'ok' && written) this.transcripts.append(run.accountId, run.agentId, run.sessionId, { role: 'assistant', text: written, runId: e.runId, status: e.status, meta: m });
      const text = e.status === 'ok' ? (e.text || (media.length ? '' : 'The agent finished without sending an answer.')) : e.status === 'interrupted' ? (e.error || !written ? `The answer was interrupted: ${e.error || 'no reason was given'}. Send it again if you still want it.` : 'The agent ended the run before finishing.') : e.status === 'stopped' ? (written ? '' : 'Stopped.') : `The agent could not answer: ${e.error || 'unknown error'}`;
      if (text || media.length) this.transcripts.append(run.accountId, run.agentId, run.sessionId, { role, text, runId: e.runId, status: e.status, meta: role === 'assistant' ? m : null });
      // the first answer names a new chat (the agent's own short title for it)
      if (e.title && (DEFAULT_LABEL.test(run.label || '') || this.registry.manifest(run.kind)?.capabilities?.titles)) { try { this.sessions.rename(run.accountId, run.sessionId, e.title); } catch { /* the session went */ } }
      this.sessions.touch(run.sessionId);
      // (a talk in the city is answered in the talker's bubble while they are there: nothing to tell them later)
      if (!run.talk) { try { this.onAnswer?.(run, { ...e, text: written || e.text }); } catch (err) { this.log?.warn?.('[chat] the answer hook failed:', err.message); } }
      this.finish(e.runId, run, { ...e, ...(written && !e.text ? { text: written } : {}) });
      return;
    }
    if (e.type === 'approval.requested') run.approvals.set(e.approvalId, { tool: e.tool || '', summary: e.summary || '', title: e.title || '', command: e.command || '', options: e.options || null });
    // (a chat waiting for the person, or no longer: its mark in the Sidebar)
    if (/^(approval|question)\.(requested|resolved)$/.test(e.type)) queueMicrotask(() => this.tellRun(run));
    if (e.type === 'question.requested') (run.questions = run.questions || new Map()).set(e.questionId, e.questions);
    if (e.type === 'question.resolved') run.questions?.delete(e.questionId);
    if (e.type === 'approval.resolved' && !/^econ:/.test(e.approvalId)) run.approvals.delete(e.approvalId);
    this.push(run, e.runId, e);
  }
  // ---------------------------------------------------------------- live activity (Agent Providers)
  /**
   * A page has one of its provider sessions open: the provider's activity in it that this installation didn't start (the
   * agent answering on another channel, a scheduled job) is shown there as it happens. Only for whoever manages the
   * provider (its other channels' conversations are theirs); a lease the page renews while the chat stays open.
   */
  async watch(P, agentId, sessionId, on = true) {
    const { a, s } = this.need(P, agentId, sessionId);
    if (!s || s.key === LAZY_KEY) return { ok: false };
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c && this.registry.manifest(c.kind);
    if (!c || !m || !m.capabilities?.observe || !this.patches(a) || this.connections.level(P, c) !== 'manage') return { ok: false };
    const k = `${c.id}|${s.key}`;
    let w = this.watchers.get(k);
    if (!on) {
      w?.delete(P.account.id);
      if (w && !w.size) { this.watchers.delete(k); try { await this.call(this.linkOf(a), 'unwatch', { sessionKey: s.key }); } catch { /* it lapses by itself */ } }
      return { ok: true };
    }
    if (!w) { w = new Map(); this.watchers.set(k, w); }
    w.set(P.account.id, { agentId: a.id, sessionId: s.id, until: this.now() + 150000 });
    await this.call(this.linkOf(a), 'watch', { agent: a.key, agentKey: a.nativeId || a.key, sessionKey: s.key, ms: 150000 });
    return { ok: true };
  }
  /**
   * One of an agent's sessions on its provider - any, not only a chat here: one it works in on another channel or a
   * schedule - followed for its screens while its owner watches its PC (server/pc/screen-watch.js): its runs' events go to
   * the provider bus like a watched chat's. The same rights as watch() (its owner, managing the connection); a lease that
   * lapses by itself (150 s) unless followed again. Returns whether it is followed.
   */
  async followKey(P, agentId, sessionKey) {
    if (typeof sessionKey !== 'string' || !sessionKey || sessionKey === LAZY_KEY || sessionKey.length > 300) return false;
    const { a } = this.need(P, agentId);
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c && this.registry.manifest(c.kind);
    if (!c || !m || !m.capabilities?.observe || !this.patches(a) || this.connections.level(P, c) !== 'manage') return false;
    await this.call(this.linkOf(a), 'watch', { agent: a.key, agentKey: a.nativeId || a.key, sessionKey, ms: 150000 });
    return true;
  }
  /** A session's progress card changed with no run of ours there: to whoever has that session open. */
  onCard(e) {
    const w = this.watchers.get(`${e.connectionId}|${e.sessionKey}`);
    if (!w) return;
    const now = this.now(), card = { steps: e.steps || [], markdown: e.markdown || '', ...(e.revision ? { revision: e.revision } : {}), ...(e.updatedAt ? { updatedAt: e.updatedAt } : {}) };
    for (const [accountId, x] of w) {
      if (x.until < now) continue;
      try { this.send(accountId, { t: 'chat', agent: x.agentId, session: x.sessionId, card }); } catch { /* it is read again with the history */ }
    }
  }
  // ---------------------------------------------------------------- background tasks (Agent Providers' side panel)
  /**
   * The background tasks a provider's agent started from a chat (subagents, jobs): for whoever manages the provider, as
   * its own sessions and live activity are - the tasks run with the provider's tools and see its other channels' work.
   */
  /** The agent and chat a task request is about (scope 'chat': the chat's tasks - it must be given; 'agent': all of the
   *  agent's, wherever they started - its scheduled jobs and command runs belong to no chat), and how the provider is asked. */
  managed(P, agentId, sessionId, scope = 'chat') {
    const all = scope === 'agent';
    const { a, s } = this.need(P, agentId, sessionId ?? undefined);
    if (!s && !all) throw new ChatError(400, 'bad_request', 'Which session?');
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c && this.registry.manifest(c.kind);
    if (!c || !m || !m.capabilities?.tasks || !this.patches(a)) throw new ChatError(400, 'not_supported', 'This agent\'s provider has no background tasks');
    if (this.connections.level(P, c) !== 'manage') throw new ChatError(403, 'forbidden', 'Only whoever manages this provider sees its tasks');
    return { a, s, at: { agentKey: a.nativeId || a.key, ...(s && s.key !== LAZY_KEY ? { sessionKey: s.key } : {}), scope: all ? 'agent' : 'chat' } };
  }
  tasksOf(list) { return (Array.isArray(list) ? list : []).flatMap(t => { try { const x = cleanTask('task', t); delete x.prompt; delete x.result; return [x]; } catch { return []; } }); }
  async tasks(P, agentId, sessionId, scope = 'chat') {
    const { a, at } = this.managed(P, agentId, sessionId, scope);
    if (at.scope === 'chat' && !at.sessionKey) return { active: [], recent: [] };
    const r = await this.call(this.linkOf(a), 'tasks', at);
    return { active: this.tasksOf(r && r.active), recent: this.tasksOf(r && r.recent) };
  }
  /** One task with its prompt and result. */
  async task(P, agentId, sessionId, taskId, scope = 'chat') {
    const { a, at } = this.managed(P, agentId, sessionId, scope);
    const r = await this.call(this.linkOf(a), 'task', { ...at, taskId: String(taskId || '') });
    try { return { task: cleanTask('task', r && r.task) }; } catch { throw new ChatError(404, 'not_found', 'This task is no longer available.'); }
  }
  /** A page of a task's transcript (its own session), read as a chat's history is. */
  async taskHistory(P, agentId, sessionId, taskId, cursor = null, scope = 'chat') {
    const { a, at } = this.managed(P, agentId, sessionId, scope);
    const r = await this.call(this.linkOf(a), 'taskHistory', { ...at, taskId: String(taskId || ''), ...(typeof cursor === 'string' && cursor ? { cursor } : {}) });
    const messages = (Array.isArray(r && r.messages) ? r.messages : []).slice(0, 200).map(m => ({ role: m.role, text: String(m.text || '').slice(0, 20000),
      ...(m.ts ? { ts: m.ts } : {}), ...(m.meta && Array.isArray(m.meta.steps) && m.meta.steps.length ? { steps: m.meta.steps.slice(0, 200).map(x => ({ title: String(x.title || x.name || 'Step').slice(0, 200), status: x.status })) } : {}) }));
    return { messages, ...(r && typeof r.nextCursor === 'string' ? { nextCursor: r.nextCursor } : {}) };
  }
  /** Words for a running task (a provider's subagent), taken into its next step - where the provider offers it. */
  async steerTask(P, agentId, sessionId, taskId, text, scope = 'chat') {
    const { a, at } = this.managed(P, agentId, sessionId, scope);
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw new ChatError(400, 'bad_request', 'What should it do? (at most 4000 characters)');
    const r = await this.call(this.linkOf(a), 'steerTask', { ...at, taskId: String(taskId || ''), text });
    return { steered: !!(r && r.steered), ...(r && r.reason ? { reason: String(r.reason).slice(0, 300) } : {}) };
  }
  /** Stops a running task. */
  async cancelTask(P, agentId, sessionId, taskId, scope = 'chat') {
    const { a, at } = this.managed(P, agentId, sessionId, scope);
    const r = await this.call(this.linkOf(a), 'cancelTask', { ...at, taskId: String(taskId || '') });
    let t = null; try { t = r && r.task ? cleanTask('task', r.task) : null; } catch { /* not shown */ }
    if (t) { delete t.prompt; delete t.result; }
    return { cancelled: !!(r && r.cancelled), ...(r && r.reason ? { reason: String(r.reason).slice(0, 500) } : {}), ...(t ? { task: t } : {}) };
  }
  // ---------------------------------------------------------------- the agents' browser (Agent Providers' side panel)
  /** The provider's own browser - the one its agents browse with: for whoever manages the provider (it may show pages
   *  the agents are signed in to), through an agent of it. */
  browserOf(P, agentId) {
    const a = this.agentFor(P, agentId);
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c && this.registry.manifest(c.kind);
    if (!c || !m || !m.capabilities?.browser || !this.patches(a)) throw new ChatError(400, 'not_supported', 'This agent\'s provider has no browser');
    if (this.connections.level(P, c) !== 'manage') throw new ChatError(403, 'forbidden', 'Only whoever manages this provider sees its browser');
    return a;
  }
  async browser(P, agentId, tab = null) {
    const a = this.browserOf(P, agentId);
    return this.call(this.linkOf(a), 'browserState', { ...(tab ? { tab: String(tab) } : {}) });
  }
  /** One of the panel's actions (start, open, focus, close, navigate, reload, back, forward, click, scroll, key, text). */
  async browserAct(P, agentId, b) {
    const a = this.browserOf(P, agentId);
    const pick = ['action', 'tab', 'url', 'fx', 'fy', 'double', 'dx', 'dy', 'key', 'text'];
    return this.call(this.linkOf(a), 'browserAct', Object.fromEntries(pick.filter(k => b[k] !== undefined).map(k => [k, b[k]])));
  }
  /** The tab's next picture after `after` ({ seq, head, jpeg } or { seq }: no change), waiting a few seconds for one. */
  async browserFrame(P, agentId, tab, after = 0) {
    const a = this.browserOf(P, agentId);
    return this.call(this.linkOf(a), 'browserFrame', { tab: String(tab || ''), after: Number(after) || 0, waitMs: 4000 }, { timeoutMs: 15000 });
  }
  // ---------------------------------------------------------------- the agent's own screen (Hermes' Bot Desktop)
  /** A provider agent's own screen - where its browser opens and its computer use acts (docs/features/agent-pc.md §4.2):
   *  for whoever manages the provider, as its browser is. Each person is their own viewer there (viewer: their account). */
  screenOf(P, agentId) {
    const a = this.agentFor(P, agentId);
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c && this.registry.manifest(c.kind);
    if (!c || !m || !m.capabilities?.screen || !this.patches(a)) throw new ChatError(400, 'not_supported', 'This agent has no screen of its own');
    if (this.connections.level(P, c) !== 'manage') throw new ChatError(403, 'forbidden', 'Only whoever manages this provider sees its agents\' screens');
    return { a, at: { agentKey: a.nativeId || a.key, viewer: String(P.account.id) } };
  }
  async screen(P, agentId) {
    const { a, at } = this.screenOf(P, agentId);
    return this.call(this.linkOf(a), 'screenState', at, { timeoutMs: 20000 });
  }
  /** start, stop, take (take over), release (hand back), browser (its browser on its screen: on true / false). */
  async screenAct(P, agentId, b) {
    const { a, at } = this.screenOf(P, agentId);
    const action = String(b.action || '');
    if (!['start', 'stop', 'take', 'release', 'browser'].includes(action)) throw new ChatError(400, 'bad_request', 'Not something the screen does');
    return this.call(this.linkOf(a), 'screenAct', { ...at, action, ...(b.on !== undefined ? { on: b.on === true } : {}), ...(b.force === true ? { force: true } : {}) }, { timeoutMs: 45000 });
  }
  /** One picture of it now: { jpeg (base64) | null }. */
  async screenThumb(P, agentId) {
    const { a, at } = this.screenOf(P, agentId);
    return this.call(this.linkOf(a), 'screenThumb', at, { timeoutMs: 20000 });
  }
  /** Where this person's viewer connects, once: { url (the provider's own address - nothing else), allowPrivate }. */
  async screenTicket(P, agentId) {
    const { a, at } = this.screenOf(P, agentId);
    const c = this.linkOf(a);
    const r = await this.call(c, 'screenTicket', at, { timeoutMs: 20000 });
    let u, own;
    try { u = new URL(String(r && r.url)); own = new URL(String(c.config && c.config.url)); } catch { throw new ChatError(502, 'provider_error', 'The provider did not open its screen'); }
    // (the relay dials the connection's own address, never one the answer names)
    if (!/^wss?:$/.test(u.protocol) || u.host !== own.host || (u.protocol === 'wss:') !== (own.protocol === 'https:')) throw new ChatError(502, 'provider_error', 'The provider named another address for its screen');
    return { url: u.href, allowPrivate: c.scope === 'installation', account: P.account.id };
  }
  // ---------------------------------------------------------------- which chats are working (the Sidebar's marks)
  /** Whether a chat is working now: an answer of this installation's being written in it, or - a provider session - the
   *  provider running a turn there (its activity feed: another channel, a job, a task). */
  /** Whether a chat works now: true, 'waiting' (for the person: an approval, a question), or false. */
  isWorking(s, a = this.agents.get(s.agentId)) {
    for (const r of this.runs.values()) if (r.sessionId === s.id && !r.done && !r.uncertain) return r.approvals.size || (r.questions && r.questions.size) ? 'waiting' : true;
    const per = a && a.connectionId && s.key ? this.working.get(String(a.connectionId)) : null, keys = per?.get(a.nativeId || a.key);
    if (!(keys && keys.has(s.key))) return false;
    return this.waitingKeys?.get(String(a.connectionId))?.get(a.nativeId || a.key)?.has(s.key) ? 'waiting' : true;
  }
  withWorking(list) { return list.map(s => { const w = this.isWorking(s); return w ? { ...s, working: w } : s; }); }
  /** The provider says which of an agent's sessions run a turn (agent.activity): the chats whose state changed are told. */
  onActivity(e) {
    const conn = String(e.connectionId), per = this.working.get(conn) || new Map();
    const was = per.get(e.agentKey) || new Set(), now = new Set(e.active && Array.isArray(e.keys) ? e.keys : []);
    // (which of them wait for the person)
    this.waitingKeys = this.waitingKeys || new Map();
    const wper = this.waitingKeys.get(conn) || new Map(), wwas = wper.get(e.agentKey) || new Set(), wnow = new Set(e.active && Array.isArray(e.waiting) ? e.waiting : []);
    if (wnow.size) wper.set(e.agentKey, wnow); else wper.delete(e.agentKey);
    if (wper.size) this.waitingKeys.set(conn, wper); else this.waitingKeys.delete(conn);
    if (now.size) per.set(e.agentKey, now); else per.delete(e.agentKey);
    if (per.size) this.working.set(conn, per); else this.working.delete(conn);
    const changed = [...new Set([...was, ...now, ...wwas, ...wnow])].filter(k => was.has(k) !== now.has(k) || wwas.has(k) !== wnow.has(k));
    if (changed.length) this.tellKeys(conn, e.agentKey, changed);
  }
  dropWorking(connectionId) {
    const per = this.working?.get(String(connectionId));
    if (!per) return;
    this.working.delete(String(connectionId));
    for (const [agentKey, keys] of per) this.tellKeys(String(connectionId), agentKey, [...keys]);
  }
  /** Tells every account with a chat on these provider sessions whether it works now. */
  tellKeys(conn, agentKey, keys) {
    const agents = this.agents.list().filter(a => a.connectionId && String(a.connectionId) === conn && (a.nativeId || a.key) === agentKey);
    for (const a of agents) for (const key of keys) for (const row of this.sessions.withKey(a.id, key)) {
      try { this.send(row.accountId, { t: 'chat', agent: a.id, session: row.id, working: this.isWorking({ id: row.id, key, agentId: a.id }, a) }); } catch { /* read with the list */ }
    }
  }
  /** An answer of this installation's began or ended in a chat: its account is told whether the chat works now. */
  tellRun(run) {
    const s = this.sessions.get(run.accountId, run.sessionId);
    if (!s) return;
    try { this.send(run.accountId, { t: 'chat', agent: run.agentId, session: s.id, working: this.isWorking(s) }); } catch { /* read with the list */ }
  }
  /** A background task of a session someone has open changed: to each of them (they manage the provider: see watch). */
  onTask(e) {
    const w = this.watchers.get(`${e.connectionId}|${e.sessionKey}`);
    if (!w) return;
    const t = e.task ? { ...e.task } : null;
    if (t) { delete t.prompt; delete t.result; }
    const now = this.now(), change = { change: e.change, ...(t ? { task: t } : {}), ...(e.taskId ? { taskId: e.taskId } : {}), ...(typeof e.here === 'boolean' ? { here: e.here } : {}) };
    for (const [accountId, x] of w) {
      if (x.until < now) continue;
      try { this.send(accountId, { t: 'chat', agent: x.agentId, session: x.sessionId, task: change }); } catch { /* it is read again when the panel opens */ }
    }
  }
  /** Asks a provider's agent to bring the session's progress card up to date (OpenClaw's Refresh task progress). */
  async refreshCard(P, agentId, sessionId, key = null) {
    const { a, s } = this.need(P, agentId, sessionId);
    if (!s || s.key === LAZY_KEY) throw new ChatError(400, 'bad_request', 'This chat has no progress card yet');
    if (key !== null && (typeof key !== 'string' || !/^[\w-]{8,80}$/.test(key))) throw new ChatError(400, 'bad_request', 'Not a request key');
    return this.call(this.linkOf(a), 'refreshCard', { agentKey: a.nativeId || a.key, sessionKey: s.key, ...(key ? { key } : {}) });
  }
  /** Takes the session's progress card off (OpenClaw's Dismiss) - the version the person saw, not one written since. */
  async dismissCard(P, agentId, sessionId, revision) {
    const { a, s } = this.need(P, agentId, sessionId);
    if (!s || s.key === LAZY_KEY) throw new ChatError(400, 'bad_request', 'This chat has no progress card yet');
    if (!Number.isInteger(revision) || revision < 1) throw new ChatError(400, 'bad_request', 'Which version of the card?');
    const r = await this.call(this.linkOf(a), 'dismissCard', { agentKey: a.nativeId || a.key, sessionKey: s.key, revision });
    return { dismissed: !!(r && r.dismissed), ...(r && r.plan ? { plan: r.plan } : {}) };
  }
  /** A run this installation didn't start, in a session someone is watching: to each of them, marked observed. */
  onObserved(e) {
    if (!e.sessionKey) return;
    const k = `${e.connectionId}|${e.sessionKey}`, w = this.watchers.get(k);
    if (!w) return;
    let o = this.observed.get(e.runId);
    if (!o) { if (e.type === 'run.end') return; o = { key: k, partial: '', thinking: '', seq: 0 }; this.observed.set(e.runId, o); }
    const now = this.now();
    for (const [accountId, x] of w) {
      if (x.until < now) { w.delete(accountId); continue; }
      const frame = { t: 'chat', run: e.runId, agent: x.agentId, session: x.sessionId, observed: true };
      try {
        if (e.type === 'run.delta') {
          // (pieces said where they start, like a run's own; a rewrite is all of it)
          const at = e.replace ? 0 : o.partial.length, tat = o.thinking.length;
          this.send(accountId, { ...frame, seq: o.seq, delta: { ...(e.text ? { text: e.text, at, ...(e.replace ? { replace: true } : {}) } : {}), ...(e.thinking ? { thinking: e.thinking, tat } : {}) } });
        } else this.send(accountId, { ...frame, seq: o.seq + 1, event: pub({ ...e, ts: now, media: e.media && this.media ? this.media.view(x.agentId, x.sessionId, e.media) : undefined }) });
      } catch { /* the page catches up from the history */ }
    }
    if (e.type === 'run.delta') {
      if (e.replace && typeof e.text === 'string') o.partial = e.text; else if (e.text) o.partial += e.text;
      if (e.thinking) o.thinking += e.thinking;
    } else o.seq += 1;
    if (e.type === 'run.end') this.observed.delete(e.runId);
    if (!w.size) this.watchers.delete(k);
  }

  /** The buffered events of one run after `since`; only the account that started it. */
  events(P, runId, since = 0) {
    const run = this.runs.get(String(runId));
    if (!run || !P.account || run.accountId !== P.account.id) throw new ChatError(404, 'not_found', 'No such run');
    return { done: run.done, uncertain: run.uncertain, seq: run.seq, partial: run.done ? undefined : run.partial, thinking: run.done || run.visitor ? undefined : run.thinking || undefined,
      events: run.events.filter(x => x.seq > since && (!run.visitor || !VISITOR_HIDDEN.test(x.event.type))) };
  }
  /** The run an approval belongs to: for a visitor's run only the agent's owner may answer (C129); the visitor is told so, others are not told it exists. */
  approvalRun(P, runId) {
    const run = this.runs.get(String(runId));
    if (!run || !P.account) throw new ChatError(404, 'not_found', 'No such run');
    if (!run.visitor) { if (run.accountId !== P.account.id) throw new ChatError(404, 'not_found', 'No such run'); return run; }
    if (P.account.id === run.ownerId) return run;
    if (P.account.id === run.accountId) throw new ChatError(403, 'forbidden', 'Only the owner of this agent can approve what it asks');
    throw new ChatError(404, 'not_found', 'No such run');
  }
  /** Approvals waiting on visitors' runs of the agents this account owns. */
  pendingApprovals(P) {
    const out = [];
    if (!P.account) return { approvals: out };
    for (const [id, run] of this.runs) {
      if (!run.visitor || run.done || run.ownerId !== P.account.id) continue;
      for (const [approval, a] of run.approvals) out.push({ run: id, agent: run.agentId, session: run.sessionId, approval, tool: a.tool, summary: a.summary });
    }
    return { approvals: out };
  }
  ownRun(P, runId) {
    const run = this.runs.get(String(runId));
    if (!run || !P.account || run.accountId !== P.account.id) throw new ChatError(404, 'not_found', 'No such run');
    return run;
  }
  async stop(P, runId) {
    const run = this.ownRun(P, runId);
    const { a } = this.need(P, run.agentId);
    await this.call(this.linkOf(a), 'stop', { runId });
    return { ok: true };
  }
  /** Answers what a run asks: approved (true or false), or a decision where the provider offers more (allow-once,
   *  allow-session - for this chat, Hermes -, allow-always, deny - Agent Providers). */
  async approve(P, runId, approvalId, approved, decision = null) {
    const run = this.approvalRun(P, runId);
    const { a } = this.need(P, run.agentId);
    if (decision !== null && decision !== undefined) {
      if (!DECISIONS.includes(decision)) throw new ChatError(400, 'bad_request', 'Allow once, for this chat, always, or deny');
      const asked = run.approvals.get(String(approvalId ?? ''));
      if (asked && Array.isArray(asked.options) && !asked.options.includes(decision)) throw new ChatError(400, 'bad_request', 'That answer is not one this step takes');
      approved = decision !== 'deny';
    }
    if (typeof approved !== 'boolean') throw new ChatError(400, 'bad_request', 'Approve or decline');
    await this.call(this.linkOf(a), 'approve', { runId, approvalId: String(approvalId ?? ''), approved, ...(decision ? { decision } : {}) });
    return { ok: true };
  }

  /** Answers what the agent asks (Agent Providers: its questions): answers { questionId: [choices or words] }, or cancel.
   *  Only whoever started the run (for a visitor's, the agent's owner) answers, as with approvals. */
  async answer(P, runId, questionId, { answers = null, cancel = false } = {}) {
    const run = this.approvalRun(P, runId);
    const { a } = this.need(P, run.agentId);
    const asked = run.questions && run.questions.get(String(questionId ?? ''));
    if (!asked) throw new ChatError(404, 'not_found', 'No such question (it may have been answered already)');
    if (!cancel) {
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new ChatError(400, 'bad_request', 'Answer the questions');
      for (const [k, v] of Object.entries(answers)) {
        const q = asked.find(x => x.questionId === k);
        const list = Array.isArray(v) ? v : [v];
        if (!q || !list.length || list.some(x => typeof x !== 'string' || !x.trim() || x.length > 2000)) throw new ChatError(400, 'bad_request', 'That is not an answer to these questions');
        if (!q.multiSelect && list.length > 1) throw new ChatError(400, 'bad_request', `"${q.header || q.question}" takes one answer`);
        if (!q.other && !q.secret && list.some(x => !q.options.some(o => o.label === x))) throw new ChatError(400, 'bad_request', 'Choose one of the options');
      }
    }
    await this.call(this.linkOf(a), 'answer', { runId, questionId: String(questionId), ...(cancel ? { cancel: true } : { answers }) });
    return { ok: true };
  }
  /** The largest file the agent's provider takes ({ maxBytes, maxImageBytes } as it announced; {} when it says nothing),
   *  for the composer to say so before uploading. */
  async limits(P, agentId) {
    const a = this.agentFor(P, agentId), c = a.connectionId ? this.connections.get(a.connectionId) : null;
    if (!c || this.inproc[c.kind] || !this.patches(a)) return {};
    try {
      const r = await this.call(this.linkOf(a), 'limits', {});
      return Object.fromEntries(['maxBytes', 'maxImageBytes'].filter(k => Number.isFinite(r?.[k]) && r[k] > 0).map(k => [k, r[k]]));
    } catch { return {}; }
  }
  /** The slash commands the agent takes (Agent Providers), for the composer's / menu. */
  async commands(P, agentId, sessionId = null) {
    const { a, s } = this.need(P, agentId, sessionId ?? undefined);
    return await this.call(this.linkOf(a), 'commands', { agentKey: a.nativeId || a.key, sessionKey: s ? s.key : null });
  }

  // ---------------------------------------------------------------- reading
  async history(P, agentId, sessionId) {
    const { a, s } = this.need(P, agentId, sessionId);
    if (!s) throw new ChatError(400, 'bad_request', 'Which session?');
    // (an answer of this person's still being written in this chat - begun before this page was opened, or in another
    // tab: the page follows it from here, the events route giving what it missed)
    const liveRun = [...this.runs].find(([, r]) => r.sessionId === s.id && r.accountId === P.account.id && !r.done && !r.uncertain);
    const live = liveRun ? { live: liveRun[0] } : {};
    const mirror = this.transcripts.read(P.account.id, a.id, s.id);
    let provider = [], out = null;
    if (s.key !== LAZY_KEY) {
      try { out = await this.call(this.linkOf(a), 'history', { agentKey: a.nativeId || a.key, sessionKey: s.key }); provider = Array.isArray(out && out.messages) ? out.messages : []; } catch { /* the mirror still shows */ }
    }
    // a provider whose history is the record (Agent Providers: OpenClaw keeps every turn, its steps and reasoning): its
    // messages, with only this installation's own notes after them (a message that could not be sent)
    if (out && out.authoritative) {
      const last = provider.reduce((t, m) => Math.max(t, Number(m.ts) || 0), 0);
      // (the files a person sent are this installation's - the provider keeps its own copies apart: each of the person's
      // messages gets back the files it went with, matched in order by its words)
      const sent = mirror.filter(m => m.role === 'user' && m.meta && m.meta.attachments);
      const withFiles = m => {
        if (m.role !== 'user' || !sent.length) return m;
        const k = sent.findIndex(x => x.text === m.text);
        if (k < 0) return m;
        const [x] = sent.splice(k, 1);
        return { ...m, meta: { ...(m.meta || {}), attachments: x.meta.attachments } };
      };
      // (the media of its answers: signed addresses for this agent and session)
      const withMedia = m => (m.meta && m.meta.media ? { ...m, meta: { ...m.meta, media: this.media ? this.media.view(a.id, s.id, m.meta.media) : undefined } } : m);
      return { messages: [...provider.map(m => ({ ...withMedia(withFiles(m)), source: 'provider' })), ...mirror.filter(m => m.role === 'system' && m.ts > last && /^(failed|uncertain)$/.test(m.status || ''))],
        ...(out.usage ? { usage: out.usage } : {}), ...(out.session ? { session: { model: out.session.model, effort: out.session.effort } } : {}), ...(out.running ? { running: true } : {}),
        ...(out.plan ? { plan: out.plan } : {}), ...(out.planCan ? { planCan: { refresh: !!out.planCan.refresh, dismiss: !!out.planCan.dismiss } } : {}), ...live };
    }
    return { messages: mergeHistory(provider, mirror), ...live };
  }
  /**
   * One of a provider answer's media, for whoever may read its session: the file here ({ file, mime, size }), fetched
   * once through the provider. Its address must be one this server signed for that agent and session.
   */
  async mediaFile(P, agentId, sessionId, r, sig) {
    const ref = this.media && this.media.open(agentId, sessionId, r, sig);
    if (!ref) throw new ChatError(404, 'not_found', 'No such attachment');
    const { a, s } = this.need(P, agentId, sessionId);
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c && this.registry.manifest(c.kind);
    if (!s || s.key === LAZY_KEY || !c || !m || !m.capabilities?.media) throw new ChatError(404, 'not_found', 'No such attachment');
    const link = this.linkOf(a);
    return this.media.get(`${c.id}|${s.key}|${JSON.stringify(ref)}`, () => this.call(link, 'media', { agentKey: a.nativeId || a.key, sessionKey: s.key, ref }, { timeoutMs: 90000 }));
  }
  /**
   * Whether this person can chat with agent `id` now, and if not why, in one short line with the fix where there is one
   * (the chat window says it before anything is typed; docs/features/CHAT.md §6). An agent this person may not use is
   * named - it walks the city in plain sight - but nothing more is said about it.
   * { ok, kind, caps, manage } or { ok: false, reason, message, fix? }.
   */
  canChat(P, id) {
    const a = this.agents.get(Number(id));
    if (!P || !P.account) return { ok: false, reason: 'signin', message: 'Sign in to chat with agents.' };
    if (!a || !a.enabled) return { ok: false, reason: 'gone', message: 'This agent isn\'t here any more.' };
    if (!this.agents.canUse(P, a)) return { ok: false, reason: 'not_shared', message: `${a.name}'s owner hasn't shared chat with you.` };
    const manage = this.agents.isOwner(P, a) || (this.agents.level ? this.agents.level(P, a) === 'manage' : false);
    if (!this.agentOk(a.key)) return { ok: false, reason: 'licence', message: `${a.name} isn't active in demo mode. A licence key unlocks more agents.` };
    const c = a.connectionId ? this.connections.get(a.connectionId) : null, m = c ? this.registry.manifest(c.kind) : null;
    if (!c || !c.enabled || !m || !m.capabilities?.chat || !this.registry.implemented(c.kind)) {
      return manage ? { ok: false, reason: 'no_brain', message: `${a.name} has no chat brain yet. Connect one and you can talk to it here.`, fix: 'brain' }
        : { ok: false, reason: 'no_brain', message: `${a.name} can't chat right now.` };
    }
    const block = this.chatBlock ? this.chatBlock(P, a, c) : null;   // (the Mind: switched off, the owner's plan, a limit)
    if (block) return { ok: false, ...block, ...(manage && block.fix ? {} : { fix: undefined }) };
    return { ok: true, kind: c.kind, caps: { ...m.capabilities }, manage, ...(this.hasModes(P, a, c) ? { modes: { default: this.work.brief(a.id).defaultMode } } : {}) };
  }
  /** Whether this account's chats with the agent have Work and Life (CHAT.md §13): its owner's, when its brain is the Mind. */
  hasModes(P, a, c = null) {
    const conn = c || (a.connectionId ? this.connections.get(a.connectionId) : null);
    return !!(this.work && conn && conn.kind === 'models' && this.agents.isOwner(P, a));
  }
  /** The session's own model and effort (null: the agent's) and whether it is pinned. */
  async setPrefs(P, agentId, sessionId, body = {}) {
    const { a, s } = this.need(P, agentId, sessionId);
    if (!s) throw new ChatError(400, 'bad_request', 'Which session?');
    const conn = a.connectionId ? this.connections.get(a.connectionId) : null;
    const p = {};
    if (body.model !== undefined) {
      if (body.model !== null && (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200 || /[\s\u0000-\u001f]/.test(body.model))) throw new ChatError(400, 'bad_model', 'That is not a model name');
      p.model = body.model;
    }
    if (body.effort !== undefined) {
      if (body.effort !== null && (typeof body.effort !== 'string' || !effortOk(body.effort, conn && conn.kind))) throw new ChatError(400, 'bad_effort', !conn || conn.kind === 'models' ? 'Thinking effort is off, low, medium or high' : 'That is not a thinking level');
      p.effort = body.effort;
    }
    // (a provider that keeps its own sessions takes the model and thinking level into the session at once - as its own
    // pickers do - and refuses one the model hasn't; a chat not started there yet takes them with its first message)
    if ((p.model || p.effort) && s.key !== LAZY_KEY && this.patches(a)) {
      await this.call(this.linkOf(a), 'patchSession', { agentKey: a.nativeId || a.key, sessionKey: s.key, ...(p.model ? { model: p.model } : {}), ...(p.effort ? { effort: p.effort } : {}) });
    }
    if (body.pinned !== undefined) p.pinned = !!body.pinned;
    // Work or Life (CHAT.md §13; null: the agent's default): a change of what a chat with messages is in is marked in it
    // (the line comes back, for the window to show)
    let switched = null;
    if (body.mode !== undefined) {
      if (body.mode !== null && !MODES.includes(body.mode)) throw new ChatError(400, 'bad_mode', 'The mode is work or life');
      if (!this.hasModes(P, a)) throw new ChatError(400, 'no_modes', `${a.name} has no Work and Life here`);
      // (the line that marks the switch goes after the answer being written, never inside it)
      if ([...this.runs.values()].some(r => r.sessionId === s.id && !r.done && !r.uncertain)) throw new ChatError(409, 'busy', 'Let it finish answering, or stop it, before switching');
      const def = this.work.brief(a.id).defaultMode, was = s.mode || def, now = body.mode || def;
      p.mode = body.mode;
      if (was !== now) switched = now;
    }
    const session = this.sessions.setPrefs(P.account.id, s.id, p);
    const line = switched && this.transcripts.read(P.account.id, a.id, s.id, 1).length
      ? this.transcripts.append(P.account.id, a.id, s.id, { role: 'system', text: switched === 'work' ? 'Switched to Work' : 'Switched to Life', status: 'mode', meta: { mode: switched } }) : null;
    return { session, ...(line ? { line } : {}) };
  }
  /** Every chat of this account with the agents it may still use (the window's list), newest first, pinned on top; with
   *  `agentId`, only that agent's (the Sidebar of the agent it is on); with `projectId` too, only that project's. */
  recent(P, agentId = null, projectId = null) {
    if (!P || !P.account) throw new ChatError(404, 'not_found', 'No chats');
    if (projectId !== null && projectId !== undefined) { const p = this.ownProject(P, agentId, projectId); return { sessions: this.withWorking(this.sessions.inProject(P.account.id, p.id)), project: p }; }
    if (agentId !== null && agentId !== undefined) {
      const { a } = this.need(P, agentId);
      return this.syncProvider(P, a).then(() => ({ sessions: this.withWorking(this.sessions.recent(P.account.id, 200, a.id)), projects: this.projects ? this.projects.list(P.account.id, a.id) : [] }));
    }
    return { sessions: this.withWorking(this.sessions.recent(P.account.id).filter(s => { const a = this.agents.get(s.agentId); return a && a.enabled && this.agents.canUse(P, a); })) };
  }
  /** This account's messages that match the words of `q` (with `agentId`, only its chats with that agent). */
  search(P, q, agentId = null) {
    if (!P || !P.account) throw new ChatError(404, 'not_found', 'No chats');
    const only = agentId !== null && agentId !== undefined ? this.need(P, agentId).a.id : null;
    const hits = this.transcripts.search(P.account.id, String(q || '').slice(0, 200), 40, only);
    const out = [];
    for (const h of hits) {
      const a = this.agents.get(h.agent);
      if (!a || !a.enabled || !this.agents.canUse(P, a)) continue;
      const s = this.sessions.get(P.account.id, h.session);
      if (s && !s.kind) out.push({ ...h, label: s.label });   // (a talk in the city is not one of its chats)
    }
    return { results: out };
  }
  // ---------------------------------------------------------------- projects (CHAT.md §12)
  needProjects() { if (!this.projects) throw new ChatError(501, 'unsupported', 'Projects are not available here'); return this.projects; }
  listProjects(P, agentId) { const { a } = this.need(P, agentId); return { projects: this.needProjects().list(P.account.id, a.id) }; }
  createProject(P, agentId, body = {}) {
    const { a } = this.need(P, agentId);
    try { return { project: this.needProjects().create(P.account.id, a.id, { name: body.name, instructions: body.instructions }) }; }
    catch (e) { if (e.status) throw new ChatError(e.status, e.code, e.message); throw e; }
  }
  /** A project of this account with this agent, or a 404 that confirms nothing. */
  ownProject(P, agentId, projectId) {
    const { a } = this.need(P, agentId), p = this.needProjects().get(P.account.id, projectId);
    if (!p || p.agentId !== a.id) throw new ChatError(404, 'not_found', 'No such project');
    return p;
  }
  updateProject(P, agentId, projectId, body = {}) {
    const p = this.ownProject(P, agentId, projectId);
    try { return { project: this.projects.update(P.account.id, p.id, { name: body.name, instructions: body.instructions }) }; }
    catch (e) { if (e.status) throw new ChatError(e.status, e.code, e.message); throw e; }
  }
  deleteProject(P, agentId, projectId) { const p = this.ownProject(P, agentId, projectId); this.projects.remove(P.account.id, p.id); return { deleted: p.id }; }
  /** Puts one of this account's chats with the agent in one of its projects with the agent (null: in none). */
  moveSession(P, agentId, sessionId, projectId) {
    const { s } = this.need(P, agentId, sessionId);
    if (!s) throw new ChatError(400, 'bad_request', 'Which chat?');
    const p = projectId === null || projectId === undefined || projectId === '' ? null : this.ownProject(P, agentId, projectId);
    return { session: this.sessions.setProject(P.account.id, s.id, p ? p.id : null) };
  }
  async models(P, agentId) {
    const { a } = this.need(P, agentId);
    return await this.call(this.linkOf(a), 'models', { agentKey: a.nativeId || a.key });
  }
  async taskProgress(P, agentId, sessionId) {
    const { a, s } = this.need(P, agentId, sessionId);
    return await this.call(this.linkOf(a), 'taskProgress', { agentKey: a.nativeId || a.key, sessionKey: s ? s.key : null });
  }
}
