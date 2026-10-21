// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents that connect outbound with a key they hold (PLAN WP2.14; DECISIONS E22, E23, C122 to C130; CHECKLIST I8.14, I8.15;
// design: docs/parity/agent-api-design.md).
// - The agent makes an Ed25519 key pair on its own machine. We keep only the PUBLIC key and its fingerprint, so a leak of this
//   database cannot impersonate an agent.
// - An owner creates a slot and gets a one-time enrolment code (shown once, stored hashed, valid 15 minutes, single use, C123).
//   The agent proves it holds the private key by signing over the code and its public key.
// - A session is opened by signing "v1|session|<slot>|<unix seconds>|<nonce>": the clock may differ by 60 seconds and a nonce is
//   used once (C130). The bearer token is random, stored hashed and valid 30 minutes (C122).
// - Losing a key: the owner revokes and enrols again; the slot keeps its name, history and settings (C124).
// - A new connection waits for its owner's OK (2026-10-11; the admin's connected.requireApproval, on by default): a key that
//   joined with the code signs in only once its owner has approved it — told the key's fingerprint, the same the AI is
//   told — so a code someone else saw is worth nothing; declining clears the key. Its owner hears of a sign-in from an
//   address it has not used before (once a day at most).
// - Nothing here can approve anything for the agent, or change its own visibility, audience or key (C129): those are owner
//   routes with a browser session.
// - Its AI may hold more than this world (a terminal, a browser, its owner's mail; 2026-10-11): a visitor's message that
//   carries links, contact details or words aimed at an AI is not passed on, and an answer to a visitor that holds a key,
//   token, code, password, contact details or a link is not shown (its AI is told why and may answer again; a second try
//   ends the run with a note, and the owner hears of it).
import crypto from 'node:crypto';
import { inboundCheck, privateCheck, aiName, nameProblem, NAME_REFUSED, REFUSED } from './mind/speech.js';
import { AGENT_APPS, AGENT_APP_IDS, agentApp, appOfferedTo } from '../shared/agent-apps.js';

/** A new MCP handle: 16 hex letters (schema 46: agent_slots.mcp_handle). */
const newHandle = () => crypto.randomBytes(8).toString('hex');

export class AgentApiError extends Error {
  constructor(status, code, message, retryAfter = 0) { super(message); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}

/** The agent kit (client/agent-api/mvw-agent.mjs, mvw_agent.py) sends its version (x-mvw-kit); an older one, or a program
 *  of its own, gets what a kit of today shows as notices it already prints (AgentApi.withFacts). */
export const AGENT_KIT_VERSION = '2026-10-12';
const KIT_NOTICE_MS = 6 * 3600000;
export const AGENT_LIMITS = Object.freeze({
  codeMs: 15 * 60000,          // C123
  sessionMs: 30 * 60000,       // C122
  clockSkewSec: 60,            // C130
  nonceMs: 5 * 60000,
  busyMs: 30000,               // a connected agent with no call for this long is not at work (its wake-up link may start it)
  maxSlotsPerAccount: 20,
  failWindowMs: 10 * 60000,
  failMax: 10,
  queueMs: 24 * 60 * 60000,     // C125: a message waits up to a day for an offline agent
  queueMax: 200,               // messages waiting for one agent
  waitMaxSec: 25,              // one long-poll
  eventsPerMin: 600,
  // a visitor writing to one agent (C128): the same limits as talking with someone's agent in the world (the admin's "talk"
  // settings, Settings → Agent limits → People → agents)
  talkMessages: 15,            // in one conversation …
  talkWindowMinutes: 5,        // … of this many minutes
  visitorPerDay: 50,           // one visitor, one agent, a day
  agentVisitorPerDay: 200,     // all visitors to one agent, a day
  visitorMaxChars: 200,        // one message
  // what only an outside AI needs (2026-10-11)
  strikesPerDay: 5,            // refused messages before a visitor is kept away from that agent for a day
  answerMaxChars: 1500,        // what the agent shows a visitor
  inboxMax: 20,                // messages handed over at once
});
const REPORTABLE = new Set(['run.progress', 'tool.start', 'tool.update', 'tool.end', 'approval.requested', 'run.end']);   // never approval.resolved: only the owner answers
export const VISIBILITY = Object.freeze(['hidden', 'friends', 'public']);
export const AUDIENCE = Object.freeze(['owner', 'friends', 'everyone']);

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const b64 = /^[A-Za-z0-9_-]+={0,2}$/;
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const keyOf = s => clean(s, 40).toLowerCase();
const fromB64 = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const toB64u = buf => Buffer.from(buf).toString('base64url');

/** A public key as sent by an agent: 32 raw bytes in base64 or base64url. Returns a KeyObject, or null. */
export function publicKeyFrom(text) {
  const s = String(text || '').trim();
  if (!s || s.length > 64 || !b64.test(s)) return null;
  const raw = fromB64(s);
  if (raw.length !== 32) return null;
  try { return crypto.createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' }); } catch { return null; }
}
export const fingerprintOf = text => sha256(fromB64(String(text).trim()));
/** Whether signature (base64 or base64url, 64 bytes) is a valid Ed25519 signature of message under the public key. */
export function verifySignature(pubkeyText, message, signatureText) {
  const key = publicKeyFrom(pubkeyText), s = String(signatureText || '').trim();
  if (!key || !s || s.length > 100 || !b64.test(s)) return false;
  const sig = fromB64(s);
  if (sig.length !== 64) return false;
  try { return crypto.verify(null, Buffer.from(String(message)), key, sig); } catch { return false; }
}

export class AgentApi {
  /**
   * @param {{ store: {db, worldId, tx}, audit?: {log}, now?: () => number, edition?: string, friends?: {friendIds: (id:number) => Set<number>}|null }} o
   */
  constructor({ store, audit = null, now = () => Date.now(), friends = null }) {
    Object.assign(this, { store, audit, now, friends });
    this.deps = { emit: null, connectionOf: null, note: null, flag: null, wakeView: null, factsFor: null, appOffer: null };   // factsFor(slot): the facts about it right now, handed over with its inbox (server/agent-world.js nowFacts)   // wakeView(slot id): its wake-up link as its owner sees it (server/agent-wakeup.js)   // flag(name): the admin's switches (index.mjs)   // note(line): one plain log line (no message content) so a failing agent can be diagnosed from server.log   // index.mjs: emit(event) onto the provider bus; connectionOf(slot) → the slot's connection id
    this.waiters = new Map();   // slot id → resolvers of parked long-polls
    this.ended = new Set();     // runs already ended, so late events are refused
    this.hits = new Map();      // slot id → timestamps of recent events
    this.held = new Map();      // run id → answers to a visitor held back (privateCheck)
    this.strikes = new Map();   // "slot:viewer" → times a visitor's message was refused (kept away at strikesPerDay)
    this.hooks = {};   // index.mjs sets enrolled(slot), revoked(slot), updated(slot): the bridge to the agent list (server/agent-bridge.js); withheld(slot, reason), approvalNeeded/connected/disconnected(slot), newAddress(slot, known): its owner is told
    // what else the mailbox hands over besides messages: extra(slot) → { heard: [...] } or null, taken
    // once (server/agent-world.js: lines said near its body); wake(slot id) when there is something new
    this.extra = null;
    // (the admin's limits, read at each use — Settings → Agent limits; AGENT_LIMITS are the defaults)
    this.limit = k => AGENT_LIMITS[k];
    this.w = store.worldId;
    this.fails = new Map();   // key → [timestamps] of refused attempts (in memory: a restart clears it, the limits are short)
    const db = store.db;
    this.q = {
      slot: db.prepare('SELECT * FROM agent_slots WHERE world_id = ? AND id = ?'),
      byAccount: db.prepare('SELECT * FROM agent_slots WHERE world_id = ? AND account_id = ? ORDER BY id'),
      countAccount: db.prepare("SELECT COUNT(*) AS n FROM agent_slots WHERE world_id = ? AND account_id = ? AND status != 'revoked'"),
      countLive: db.prepare("SELECT COUNT(*) AS n FROM agent_slots WHERE world_id = ? AND status != 'revoked'"),
      byName: db.prepare('SELECT id FROM agent_slots WHERE world_id = ? AND account_id = ? AND name_key = ?'),
      insertSlot: db.prepare('INSERT INTO agent_slots (world_id, account_id, name, name_key, created, updated, mcp_handle) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      byHandle: db.prepare('SELECT * FROM agent_slots WHERE world_id = ? AND mcp_handle = ?'),
      setHandle: db.prepare('UPDATE agent_slots SET mcp_handle = ? WHERE id = ? AND mcp_handle IS NULL'),
      insertCode: db.prepare('INSERT INTO agent_enrol_codes (world_id, slot_id, code_hash, created, expires) VALUES (?, ?, ?, ?, ?)'),
      dropCodes: db.prepare('DELETE FROM agent_enrol_codes WHERE world_id = ? AND slot_id = ? AND used IS NULL'),
      code: db.prepare('SELECT * FROM agent_enrol_codes WHERE code_hash = ?'),
      useCode: db.prepare('UPDATE agent_enrol_codes SET used = ? WHERE id = ? AND used IS NULL'),
      bind: db.prepare("UPDATE agent_slots SET pubkey = ?, fingerprint = ?, status = 'active', updated = ?, revoked = NULL, enrolled_at = ?, approved_at = ?, known_ips = NULL, ip_alert_at = NULL WHERE id = ?"),
      approve: db.prepare("UPDATE agent_slots SET approved_at = ?, updated = ? WHERE id = ? AND status = 'active' AND approved_at IS NULL"),
      // connected through an AI app (MCP): its owner's sign-in and choice is the OK; no key
      mcpOn: db.prepare("UPDATE agent_slots SET status = 'active', pubkey = NULL, fingerprint = NULL, revoked = NULL, enrolled_at = ?, approved_at = ?, updated = ?, known_ips = NULL, ip_alert_at = NULL WHERE id = ?"),
      decline: db.prepare("UPDATE agent_slots SET pubkey = NULL, fingerprint = NULL, status = 'pending', approved_at = NULL, enrolled_at = NULL, known_ips = NULL, updated = ? WHERE id = ? AND status = 'active' AND approved_at IS NULL"),
      knownIps: db.prepare('UPDATE agent_slots SET known_ips = ?, ip_alert_at = ? WHERE id = ?'),
      fpTaken: db.prepare("SELECT id FROM agent_slots WHERE world_id = ? AND fingerprint = ? AND status != 'revoked' AND id != ?"),
      insertSession: db.prepare('INSERT INTO agent_sessions (world_id, slot_id, token_hash, created, expires, last_seen, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      session: db.prepare('SELECT * FROM agent_sessions WHERE token_hash = ?'),
      touch: db.prepare('UPDATE agent_sessions SET last_seen = ? WHERE id = ?'),
      lastUse: db.prepare('SELECT MAX(last_seen) AS t FROM agent_sessions WHERE world_id = ? AND slot_id = ? AND expires > ?'),
      touchSlot: db.prepare('UPDATE agent_slots SET last_seen = ?, last_ip_hash = ? WHERE id = ?'),
      dropSessions: db.prepare('DELETE FROM agent_sessions WHERE world_id = ? AND slot_id = ?'),
      purgeSessions: db.prepare('DELETE FROM agent_sessions WHERE expires < ?'),
      nonce: db.prepare('INSERT OR IGNORE INTO agent_nonces (slot_id, nonce, expires) VALUES (?, ?, ?)'),
      purgeNonces: db.prepare('DELETE FROM agent_nonces WHERE expires < ?'),
      purgeCodes: db.prepare('DELETE FROM agent_enrol_codes WHERE expires < ? AND used IS NULL'),
      revoke: db.prepare("UPDATE agent_slots SET status = 'revoked', updated = ?, revoked = ? WHERE id = ?"),
      update: db.prepare('UPDATE agent_slots SET name = ?, name_key = ?, visibility = ?, chat_audience = ?, chat_paused = ?, appear_in_world = ?, updated = ? WHERE id = ?'),
      qIns: db.prepare('INSERT INTO agent_queue (world_id, slot_id, kind, run_id, session_key, sender_account_id, sender_name, visitor, body, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      qCount: db.prepare("SELECT COUNT(*) AS n FROM agent_queue WHERE world_id = ? AND slot_id = ? AND kind = 'message' AND delivered IS NULL AND expires > ?"),
      qPending: db.prepare('SELECT * FROM agent_queue WHERE world_id = ? AND slot_id = ? AND delivered IS NULL AND expires > ? ORDER BY id LIMIT 50'),
      qDeliver: db.prepare('UPDATE agent_queue SET delivered = ? WHERE id = ?'),
      qRun: db.prepare("SELECT * FROM agent_queue WHERE world_id = ? AND run_id = ? AND kind = 'message'"),
      qDropRun: db.prepare('DELETE FROM agent_queue WHERE world_id = ? AND run_id = ?'),
      qDrop: db.prepare('DELETE FROM agent_queue WHERE id = ?'),
      qSlotMsgs: db.prepare("SELECT * FROM agent_queue WHERE world_id = ? AND slot_id = ? AND kind = 'message'"),
      qExpiredMsgs: db.prepare("SELECT * FROM agent_queue WHERE world_id = ? AND kind = 'message' AND delivered IS NULL AND expires < ?"),
      qPurge: db.prepare('DELETE FROM agent_queue WHERE world_id = ? AND ((delivered IS NULL AND expires < ?) OR (delivered IS NOT NULL AND delivered < ?))'),
      bIns: db.prepare('INSERT OR IGNORE INTO agent_blocks (slot_id, account_id, created) VALUES (?, ?, ?)'),
      bDel: db.prepare('DELETE FROM agent_blocks WHERE slot_id = ? AND account_id = ?'),
      bHas: db.prepare('SELECT 1 FROM agent_blocks WHERE slot_id = ? AND account_id = ?'),
      bAll: db.prepare('SELECT account_id, created FROM agent_blocks WHERE slot_id = ? ORDER BY created'),
      rIns: db.prepare('INSERT INTO agent_reports (world_id, slot_id, reporter_id, reporter_name, run_id, reason, created) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      rAll: db.prepare('SELECT * FROM agent_reports WHERE world_id = ? AND slot_id = ? ORDER BY id DESC LIMIT 100'),
      vGet: db.prepare('SELECT n FROM agent_visits WHERE slot_id = ? AND account_id = ? AND day = ?'),
      vUp: db.prepare('INSERT INTO agent_visits (slot_id, account_id, day, n) VALUES (?, ?, ?, 1) ON CONFLICT (slot_id, account_id, day) DO UPDATE SET n = n + 1'),
      vPurge: db.prepare('DELETE FROM agent_visits WHERE day < ?'),
      vDay: db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM agent_visits WHERE slot_id = ? AND day = ?'),
      setAgent: db.prepare('UPDATE agent_slots SET agent_id = ? WHERE id = ?'),
      ipSalt: db.prepare("SELECT value FROM meta WHERE key = 'agent_ip_salt'"),
      setIpSalt: db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('agent_ip_salt', ?)"),
    };
    this.q.setIpSalt.run(crypto.randomBytes(16).toString('hex'));
    this.salt = this.q.ipSalt.get().value;
  }

  // ------------------------------------------------------------ helpers
  slotById(id) { return Number.isInteger(id) ? this.q.slot.get(this.w, id) || null : null; }
  linkAgent(slotId, agentId) { this.q.setAgent.run(agentId, slotId); }
  /** The slot behind a connected agent's record key (ext-<slot id>), or null. */
  slotOfAgentKey(key) {
    const m = /^ext-(\d{1,9})$/.exec(String(key || ''));
    return m ? this.q.slot.get(this.w, Number(m[1])) || null : null;
  }
  /** Whether an agent record may be listed for a viewer: every ordinary agent is; a connected agent only as its slot allows (C127, I8.15). */
  agentKeyVisible(key, viewerId) {
    if (!String(key).startsWith('ext-')) return true;
    const slot = this.slotOfAgentKey(key);
    return !!slot && this.canSee(slot, viewerId ?? null);
  }
  /** Whether the agent behind a record key has a live session (undefined for agents that are not connected ones). */
  onlineAgentKey(key) {
    if (!String(key).startsWith('ext-')) return undefined;
    const slot = this.slotOfAgentKey(key);
    return !!slot && slot.status === 'active' && (this.hasSession(slot.id) || this.mcpSince(slot.id) < AGENT_LIMITS.sessionMs);
  }
  /** Its AI used its tools over MCP (server/connector/body-tools.js): online and at work, like a session's call. */
  noteUse(slotId) {
    this.mcpUse = this.mcpUse || new Map();
    const fresh = this.mcpSince(slotId) >= AGENT_LIMITS.sessionMs;
    this.mcpUse.set(slotId, this.now());
    if (fresh) { const s = this.slotById(slotId); if (s) { try { this.hooks.session?.(s); } catch { /* presence catches up */ } } }
  }
  /** Milliseconds since its AI last used its tools over MCP (Infinity: never). */
  mcpSince(slotId) { const t = this.mcpUse?.get(slotId); return t === undefined ? Infinity : this.now() - t; }
  note(line) { try { this.deps.note?.(line); } catch { /* logging never blocks the agent */ } }
  ipHash(ip) { return ip ? sha256(`${this.salt}|${ip}`).slice(0, 32) : null; }
  log(action, { actor = null, slot = null, ip = null, detail = null } = {}) {
    try {
      this.audit?.log(action, { actor, target: slot ? { id: slot.id, login: slot.name } : null, ip, detail });
    } catch { /* an audit failure never blocks the caller's own change */ }
  }
  /** Counts a refused attempt for a key (an address or a slot) and refuses when there were too many lately. */
  tooMany(key) {
    const now = this.now(), from = now - AGENT_LIMITS.failWindowMs;
    const list = (this.fails.get(key) || []).filter(t => t > from);
    this.fails.set(key, list);
    return list.length >= AGENT_LIMITS.failMax;
  }
  fail(key) { const l = this.fails.get(key) || []; l.push(this.now()); this.fails.set(key, l); if (this.fails.size > 5000) this.fails.clear(); }
  guard(key) { if (this.tooMany(key)) throw new AgentApiError(429, 'rate_limited', 'Too many refused attempts; wait a few minutes', 300); }
  view(s) {
    return {
      id: s.id, name: s.name, status: s.status, visibility: s.visibility, chatAudience: s.chat_audience, chatPaused: !!s.chat_paused,
      appearInWorld: !!s.appear_in_world, fingerprint: s.fingerprint ? s.fingerprint.slice(0, 16) : null, created: s.created, updated: s.updated,
      lastSeen: s.last_seen || null, online: !!s.last_seen && this.hasSession(s.id),
      // its connection: waiting for its owner's OK, or approved; when it joined; how many addresses it signed in from
      approval: s.status === 'active' ? (s.approved_at ? 'approved' : 'waiting') : null, enrolledAt: s.enrolled_at || null, approvedAt: s.approved_at || null,
      via: s.status === 'active' ? (s.pubkey ? 'key' : 'mcp') : null,   // how it is connected: its own key (the kit), or an AI app (MCP)
      app: s.app || null,   // the third-party app it is for (shared/agent-apps.js), or null: any app or program
      mcpPath: `/mcp/a/${this.handleOf(s)}`,   // its own MCP address (schema 46): an app sees one server per agent
      addresses: (() => { try { return JSON.parse(s.known_ips || '[]').length; } catch { return 0; } })(),
    };
  }
  /** Its MCP handle (schema 46): <world>/mcp/a/<handle> is its own door for AI apps. Made now for a slot that has none. */
  handleOf(s) {
    if (s.mcp_handle) return s.mcp_handle;
    const h = newHandle();
    this.q.setHandle.run(h, s.id);
    return (s.mcp_handle = this.q.slot.get(this.w, s.id)?.mcp_handle || h);
  }
  /** The slot behind an MCP address's handle, or null. */
  slotByHandle(h) { return typeof h === 'string' && /^[0-9a-f]{16}$/.test(h) ? this.q.byHandle.get(this.w, h) || null : null; }
  hasSession(slotId) {
    return !!this.store.db.prepare('SELECT 1 FROM agent_sessions WHERE world_id = ? AND slot_id = ? AND expires > ? LIMIT 1').get(this.w, slotId, this.now());
  }
  purge() {
    const now = this.now();
    this.q.purgeSessions.run(now); this.q.purgeNonces.run(now); this.q.purgeCodes.run(now - 60 * 60000);
  }
  ownSlot(account, id) {
    const s = Number.isInteger(id) ? this.q.slot.get(this.w, id) : null;
    if (!s || s.account_id !== account.id) throw new AgentApiError(404, 'not_found', 'No such agent');   // another account's slot is never confirmed (X11)
    return s;
  }
  newCode(slot) {
    const code = `mvwe_${toB64u(crypto.randomBytes(20))}`, now = this.now();
    this.q.dropCodes.run(this.w, slot.id);
    this.q.insertCode.run(this.w, slot.id, sha256(code), now, now + AGENT_LIMITS.codeMs);
    return { code, expires: now + AGENT_LIMITS.codeMs };
  }

  // ------------------------------------------------------------ owner side (browser session)
  list(account) { return this.q.byAccount.all(this.w, account.id).map(s => ({ ...this.view(s), lastUse: this.lastUse(s.id) || null, ...(this.deps.wakeView ? { wakeUp: this.deps.wakeView(s.id) } : {}) })); }
  /** The third-party apps someone with this role may choose in New agent (the admin's agentApps.* settings; appOffer(id)
   *  reads one, and without it each app's own default counts). */
  appsFor(role) { return this.appChoices(role).map(a => a.id); }
  /** The same, each with who it is offered to (everyone, or admins only while it is tested): what New agent lists. */
  appChoices(role) {
    return AGENT_APPS.map(a => ({ id: a.id, offer: (this.deps.appOffer && this.deps.appOffer(a.id)) || a.offer })).filter(a => appOfferedTo(a.offer, role));
  }
  /** The installation's slots not revoked (waiting, connected or paused): demo mode counts them as agents. */
  countLive() { return this.q.countLive.get(this.w).n; }
  /** A new slot and its one-time enrolment code. The code cannot be read again. role: the creator's (which apps they may choose). */
  createSlot(account, { name, app = null }, { ip = null, role = 'member' } = {}) {
    const n = clean(name, 40), k = keyOf(name);
    if (!n) throw new AgentApiError(400, 'bad_name', 'Give the agent a name');
    if (app != null && !AGENT_APP_IDS.includes(app)) throw new AgentApiError(400, 'bad_app', 'Unknown app');
    if (app != null && !this.appsFor(role).includes(app)) throw new AgentApiError(403, 'app_not_offered', `${agentApp(app).name} is not offered here yet`);
    if (nameProblem(n)) throw new AgentApiError(400, 'bad_name', NAME_REFUSED);
    const cap = AGENT_LIMITS.maxSlotsPerAccount;
    if (this.q.countAccount.get(this.w, account.id).n >= cap) throw new AgentApiError(409, 'too_many_agents', `An account can connect ${cap} agents; remove one first`);
    if (this.q.byName.get(this.w, account.id, k)) throw new AgentApiError(409, 'name_taken', 'You already have an agent with that name');
    const now = this.now();
    return this.store.tx(() => {
      const r = this.q.insertSlot.run(this.w, account.id, n, k, now, now, newHandle());
      if (app) this.store.db.prepare('UPDATE agent_slots SET app = ? WHERE id = ?').run(app, Number(r.lastInsertRowid));
      const slot = this.q.slot.get(this.w, Number(r.lastInsertRowid));
      const c = this.newCode(slot);
      this.log('agent.slot_create', { actor: account, slot, ip });
      return { slot: this.view(slot), code: c.code, codeExpires: c.expires };
    });
  }
  /** A fresh enrolment code for a slot: to enrol it the first time, or to replace its key after a loss or a rotation. */
  newEnrolmentCode(account, id, { ip = null } = {}) {
    const slot = this.ownSlot(account, id);
    // a revoked slot goes back to waiting for a key; its name, history and settings stay (C124)
    if (slot.status === 'revoked') {
      this.store.db.prepare("UPDATE agent_slots SET status = 'pending', pubkey = NULL, fingerprint = NULL, revoked = NULL, updated = ? WHERE id = ?").run(this.now(), slot.id);
      this.q.dropSessions.run(this.w, slot.id);
    }
    const fresh = this.q.slot.get(this.w, slot.id), c = this.newCode(fresh);
    this.log('agent.code_new', { actor: account, slot, ip });
    return { slot: this.view(this.q.slot.get(this.w, slot.id)), code: c.code, codeExpires: c.expires };
  }
  /** Ends the agent's sessions and disables its key at once. The slot, its name, history and settings stay. */
  /** Its owner's OK for the key that joined with the code (it can sign in from now on). */
  approve(account, id, { ip = null } = {}) {
    const slot = this.ownSlot(account, id);
    if (slot.status !== 'active' || slot.approved_at) throw new AgentApiError(409, 'nothing_to_approve', 'There is no connection waiting for your OK');
    this.q.approve.run(this.now(), this.now(), slot.id);
    this.log('agent.approve', { actor: account, slot, ip, detail: { fingerprint: String(slot.fingerprint || '').slice(0, 16) } });
    this.fire('updated', slot.id);
    this.notice('connected', slot.id);
    return this.view(this.q.slot.get(this.w, slot.id));
  }
  /**
   * Connects the slot through an AI app (MCP, server/connector/): its owner signed in on the app's consent page and chose
   * it, which is the owner's OK — no code, no key. Already connected: nothing changes. Its owner is told.
   */
  connectViaMcp(account, id, { ip = null, app = '' } = {}) {
    const slot = this.ownSlot(account, id), now = this.now();
    if (slot.status === 'active' && slot.approved_at) return this.view(slot);
    this.store.tx(() => { this.q.mcpOn.run(now, now, now, slot.id); this.q.dropCodes.run(this.w, slot.id); this.q.dropSessions.run(this.w, slot.id); });
    this.log('agent.connect_mcp', { actor: account, slot, ip, detail: { app: String(app).slice(0, 60) } });
    this.fire('enrolled', slot.id);
    this.notice('connected', slot.id);
    return this.view(this.q.slot.get(this.w, slot.id));
  }
  /** The account's connected agents not connected right now (never, or disconnected): an AI app may connect one (MCP).
   *  Newest first: the one just made for an app (New agent → a third-party agent) is the one its sign-in should pick. */
  notConnected(accountId) {
    return this.q.byAccount.all(this.w, accountId).filter(s => s.status !== 'active').sort((a, b) => b.id - a.id)
      .map(s => ({ id: s.id, name: s.name, status: s.status, app: s.app || null }));
  }
  /** A connected agent that never connected (made for an app that never signed in) is removed outright: it gives its
   *  plan's place back. One that was ever connected keeps its name and history: it is disconnected instead. */
  removeSlot(account, id, { ip = null } = {}) {
    const slot = this.ownSlot(account, id);
    if (slot.status !== 'pending' || slot.enrolled_at) throw new AgentApiError(409, 'was_connected', 'It was connected before: disconnect it instead (its name and history stay)');
    return this.purgeSlot(account, slot, ip, 'agent.slot_remove');
  }
  /**
   * Deletes a third-party agent, connected or not (2026-10-13: its owner deleted the Bot in its own app and expected the agent
   * to go too): an active one is disconnected first — its app's sign-ins end, anything it is doing ends, its body leaves
   * the world —, then it goes like one that never connected: its record, its waiting messages and wake-up link go, and its
   * plan's place comes back. (Its app keeps its own connector until its owner removes it there.)
   */
  deleteSlot(account, id, { ip = null } = {}) {
    let slot = this.ownSlot(account, id);
    if (slot.status === 'active') { this.revoke(account, id, { ip }); slot = this.ownSlot(account, id); }
    return this.purgeSlot(account, slot, ip, 'agent.slot_delete');
  }
  purgeSlot(account, slot, ip, action) {
    this.store.tx(() => {
      for (const t of ['agent_enrol_codes', 'agent_sessions', 'agent_queue', 'agent_reports', 'agent_wakeups']) {
        this.store.db.prepare(`DELETE FROM ${t} WHERE world_id = ? AND slot_id = ?`).run(this.w, slot.id);
      }
      for (const t of ['agent_nonces', 'agent_blocks', 'agent_visits']) this.store.db.prepare(`DELETE FROM ${t} WHERE slot_id = ?`).run(slot.id);
      this.store.db.prepare('DELETE FROM agent_slots WHERE world_id = ? AND id = ?').run(this.w, slot.id);
      this.log(action, { actor: account, slot, ip });
    });
    try { this.hooks.removed?.(slot); } catch { /* the agent list catches up at the next start */ }
    return { removed: slot.id };
  }
  /** Not this key: it is forgotten and the slot waits for a new code (Settings → Third-party agents). */
  decline(account, id, { ip = null } = {}) {
    const slot = this.ownSlot(account, id);
    if (slot.status !== 'active' || slot.approved_at) throw new AgentApiError(409, 'nothing_to_approve', 'There is no connection waiting for your OK');
    this.store.tx(() => { this.q.decline.run(this.now(), slot.id); this.q.dropSessions.run(this.w, slot.id); this.q.dropCodes.run(this.w, slot.id); });
    this.log('agent.decline', { actor: account, slot, ip, detail: { fingerprint: String(slot.fingerprint || '').slice(0, 16) } });
    this.fire('updated', slot.id);
    return this.view(this.q.slot.get(this.w, slot.id));
  }
  revoke(account, id, { ip = null } = {}) {
    const slot = this.ownSlot(account, id), now = this.now();
    this.store.tx(() => { this.q.revoke.run(now, now, slot.id); this.q.dropSessions.run(this.w, slot.id); this.q.dropCodes.run(this.w, slot.id); });
    this.log('agent.revoke', { actor: account, slot, ip });
    this.endRuns(slot.id, 'The agent was disconnected by its owner');
    this.fire('revoked', slot.id);
    if (slot.status === 'active') this.notice('disconnected', slot.id);
    return this.view(this.q.slot.get(this.w, slot.id));
  }
  /** Owner-only settings: name, who sees the agent, who may chat with it, pause, appear in the world. */
  update(account, id, patch, { ip = null } = {}) {
    const slot = this.ownSlot(account, id);
    let name = slot.name, nk = slot.name_key, vis = slot.visibility, aud = slot.chat_audience, paused = slot.chat_paused, appear = slot.appear_in_world;
    if (patch.name !== undefined) {
      name = clean(patch.name, 40); nk = keyOf(patch.name);
      if (!name) throw new AgentApiError(400, 'bad_name', 'Give the agent a name');
      if (nameProblem(name)) throw new AgentApiError(400, 'bad_name', NAME_REFUSED);
      const other = this.q.byName.get(this.w, account.id, nk);
      if (other && other.id !== slot.id) throw new AgentApiError(409, 'name_taken', 'You already have an agent with that name');
    }
    if (patch.visibility !== undefined) { if (!VISIBILITY.includes(patch.visibility)) throw new AgentApiError(400, 'bad_setting', 'Visibility is hidden, friends or public'); vis = patch.visibility; }
    if (patch.chatAudience !== undefined) { if (!AUDIENCE.includes(patch.chatAudience)) throw new AgentApiError(400, 'bad_setting', 'Who may chat is owner, friends or everyone'); aud = patch.chatAudience; }
    if (patch.chatPaused !== undefined) paused = patch.chatPaused ? 1 : 0;
    if (patch.appearInWorld !== undefined) appear = patch.appearInWorld ? 1 : 0;
    this.q.update.run(name, nk, vis, aud, paused, appear, this.now(), slot.id);
    this.log('agent.update', { actor: account, slot, ip, detail: { visibility: vis, chatAudience: aud, chatPaused: !!paused, appearInWorld: !!appear } });
    this.fire('updated', slot.id);
    return this.view(this.q.slot.get(this.w, slot.id));
  }
  /** Whether a viewer account may see the agent (hidden: owner only; friends: the owner's friends; public: everyone). */
  canSee(slot, viewerId) {
    if (slot.status !== 'active') return viewerId === slot.account_id;
    if (viewerId === slot.account_id) return true;
    if (slot.visibility === 'public') return true;
    if (slot.visibility === 'friends' && viewerId !== null && this.friends) return this.friends.friendIds(slot.account_id).has(viewerId);
    return false;
  }
  /** Whether a viewer may chat with the agent: the owner always; others by the audience setting, never while paused. */
  canChat(slot, viewerId) {
    if (slot.status !== 'active') return false;
    if (viewerId === slot.account_id) return true;
    if (slot.chat_paused || viewerId === null) return false;
    if (this.q.bHas.get(slot.id, viewerId)) return false;   // blocked by the owner (C128)
    if (slot.chat_audience === 'everyone') return this.canSee(slot, viewerId);
    if (slot.chat_audience === 'friends') return !!this.friends && this.friends.friendIds(slot.account_id).has(viewerId) && this.canSee(slot, viewerId);
    return false;
  }

  // ------------------------------------------------------------ agent side (signed, no cookies)
  /** POST /api/agent-api/enroll: the code from the owner, the agent's public key and a signature over both. */
  enrol({ code, publicKey, signature }, { ip = null } = {}) {
    const ipKey = `ip:${this.ipHash(ip)}`;
    this.guard(ipKey);
    const bad = (why, status = 401) => { this.fail(ipKey); this.log('agent.enrol_failed', { ip, detail: { why } }); return new AgentApiError(status, 'enrol_refused', 'The enrolment was refused'); };
    const c = typeof code === 'string' && /^mvwe_[A-Za-z0-9_-]{20,40}$/.test(code) ? this.q.code.get(sha256(code)) : null;
    if (!c) throw bad('unknown code');
    const now = this.now();
    if (c.used || c.expires < now) throw bad(c.used ? 'code used' : 'code expired');
    if (!publicKeyFrom(publicKey)) throw bad('bad key', 400);
    if (!verifySignature(publicKey, `v1|enrol|${code}|${String(publicKey).trim()}`, signature)) throw bad('bad signature');
    const slot = this.q.slot.get(this.w, c.slot_id);
    if (!slot) throw bad('no slot');
    const fp = fingerprintOf(publicKey);
    if (this.q.fpTaken.get(this.w, fp, slot.id)) throw bad('key in use', 409);
    const waits = this.deps.flag ? this.deps.flag('requireApproval') : true;   // (the admin's switch; on unless turned off)
    const done = this.store.tx(() => {
      if (this.q.useCode.run(now, c.id).changes !== 1) throw bad('code used');
      this.q.bind.run(String(publicKey).trim(), fp, now, now, waits ? null : now, slot.id);
      this.q.dropSessions.run(this.w, slot.id);   // an old key's sessions end when a new key is enrolled
      const fresh = this.q.slot.get(this.w, slot.id);
      this.log('agent.enrol', { actor: { id: slot.account_id, login: null }, slot: fresh, ip, detail: { fingerprint: fp.slice(0, 16), waits } });
      return { slot: this.view(fresh), fingerprint: fp, approval: waits ? 'waiting' : 'approved',
        ...(waits ? { note: `Your owner approves this connection before you can sign in: tell them your key, ${fp.slice(0, 16)}` } : {}) };
    });
    this.fire('enrolled', slot.id);
    this.notice(waits ? 'approvalNeeded' : 'connected', slot.id);
    return done;
  }
  /** Its owner hears of its connection (index.mjs: a notification they keep on every device): a key waiting for their OK
   *  (approvalNeeded), connected (connected), disconnected (disconnected). A failing notice never undoes the change. */
  notice(name, slotId) {
    try { const s = this.q.slot.get(this.w, slotId); if (s) this.hooks[name]?.(s); } catch { /* Settings → Third-party agents shows it */ }
  }
  /** Runs after a change of the slot, outside its transaction; a failing hook never undoes the change. */
  fire(name, slotId) {
    try { const s = this.q.slot.get(this.w, slotId); if (s) this.hooks[name]?.(s); } catch { /* the agent list catches up on the next change */ }
  }
  /** POST /api/agent-api/session: signs "v1|session|<slot>|<unix seconds>|<nonce>" and gets a short-lived token. */
  openSession({ slot: slotId, timestamp, nonce, signature }, { ip = null } = {}) {
    const ipKey = `ip:${this.ipHash(ip)}`, slotKey = `slot:${Number(slotId)}`;
    this.guard(ipKey); this.guard(slotKey);
    const refuse = why => { this.fail(ipKey); this.fail(slotKey); this.log('agent.signature_failed', { ip, detail: { slot: Number(slotId) || null, why } }); return new AgentApiError(401, 'resign', 'Sign the login message again', 0); };
    const s = Number.isInteger(slotId) ? this.q.slot.get(this.w, slotId) : null;
    if (!s || s.status !== 'active' || !s.pubkey) throw refuse('no active slot');
    const ts = Number(timestamp), n = String(nonce || '');
    if (!Number.isInteger(ts) || Math.abs(Math.floor(this.now() / 1000) - ts) > AGENT_LIMITS.clockSkewSec) throw refuse('clock');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(n)) throw refuse('nonce');
    if (!verifySignature(s.pubkey, `v1|session|${s.id}|${ts}|${n}`, signature)) throw refuse('signature');
    const now = this.now();
    this.purge();
    if (this.q.nonce.run(s.id, n, now + AGENT_LIMITS.nonceMs).changes !== 1) throw refuse('replay');
    // (the key is right, but its owner has not approved this connection yet: no session)
    if (!s.approved_at) throw new AgentApiError(403, 'awaiting_approval', `Your owner hasn't approved this connection yet: ask them to approve it in Settings → Third-party agents (your key: ${String(s.fingerprint || '').slice(0, 16)})`);
    const token = `mvws_${toB64u(crypto.randomBytes(32))}`, ih = this.ipHash(ip);
    this.q.insertSession.run(this.w, s.id, sha256(token), now, now + AGENT_LIMITS.sessionMs, now, ih);
    const newAddress = !!s.last_ip_hash && !!ih && s.last_ip_hash !== ih;
    this.q.touchSlot.run(now, ih, s.id);
    if (newAddress) this.log('agent.session_new_address', { actor: { id: s.account_id, login: null }, slot: s, ip });   // C126: notice, no hard binding
    // the addresses it signed in from (the last ten): a new one after the first, its owner hears of — once a day at most
    if (ih) {
      let known = []; try { known = JSON.parse(s.known_ips || '[]'); } catch { known = []; }
      if (!known.includes(ih)) {
        const alert = known.length > 0 && !(s.ip_alert_at > now - 86400000);
        known = [...known, ih].slice(-10);
        this.q.knownIps.run(JSON.stringify(known), alert ? now : (s.ip_alert_at ?? null), s.id);
        if (alert) { try { this.hooks.newAddress?.(s, known.length - 1); } catch { /* the audit log has it */ } }
      }
    }
    this.fire('session', s.id);
    return { token, expires: now + AGENT_LIMITS.sessionMs, slot: s.id, newAddress };
  }
  /** The slot behind a bearer token, or null. The agent is always found from the token, never from a request field. */
  authenticate(token) {
    const t = String(token || '');
    if (!/^mvws_[A-Za-z0-9_-]{40,60}$/.test(t)) return null;
    const row = this.q.session.get(sha256(t)), now = this.now();
    if (!row || row.expires < now) return null;
    const slot = this.q.slot.get(this.w, row.slot_id);
    if (!slot || slot.status !== 'active' || !slot.approved_at) return null;
    this.q.touch.run(now, row.id);
    return slot;
  }

  // ------------------------------------------------------------ the chat mailbox (WP2.14; C125, C129)
  /** Something arrived for it: a parked inbox call answers at once; with a reason (owner, others, problems) its wake-up link
   *  may start it on its own platform (server/agent-wakeup.js) when it isn't at work. */
  wake(slotId, reason = null) {
    const set = this.waiters.get(slotId); if (set) for (const fn of [...set]) fn();
    if (reason) { try { this.hooks.wakeUp?.(slotId, reason); } catch { /* it fetches its inbox when it next runs */ } }
  }
  /** How long it is still to be counted at work (ms; 0: not at work): an inbox call parked, or a call with its token in
   *  the last half minute. A run that stopped is quiet after that. */
  busyFor(slotId) {
    if (this.waiters.get(slotId)?.size) return AGENT_LIMITS.busyMs;
    return Math.max(0, this.lastUse(slotId) + AGENT_LIMITS.busyMs - this.now());
  }
  /** When its AI last called the world (its kit's token or its tools over MCP; 0: not since its sessions ended). */
  lastUse(slotId) { return Math.max(this.q.lastUse.get(this.w, slotId, this.now())?.t || 0, this.mcpUse?.get(slotId) || 0); }
  busy(slotId) { return this.busyFor(slotId) > 0; }
  /** Chat messages waiting for it that it hasn't fetched. */
  waitingMessages(slotId) { return this.q.qCount.get(this.w, slotId, this.now()).n; }
  /** A chat message for the agent: it waits here until the agent, connected outbound, fetches it (up to 24 hours, C125). */
  queueMessage({ slot: given, runId, sessionKey, text, sender, visitor = false }) {
    const slot = given ? this.q.slot.get(this.w, given.id) : null;   // the row as it is now, not as the caller saw it
    if (!slot || slot.status !== 'active') throw new AgentApiError(409, 'agent_unavailable', 'This agent is not connected');
    const now = this.now();
    if (this.q.qCount.get(this.w, slot.id, now).n >= this.limit('queueMax')) throw new AgentApiError(429, 'queue_full', 'This agent has too many messages waiting; try again later');
    this.q.qIns.run(this.w, slot.id, 'message', String(runId), sessionKey || null, sender?.id || 0, clean(sender?.name || '', 60), visitor ? 1 : 0, String(text ?? '').slice(0, 20000), now, now + AGENT_LIMITS.queueMs);
    this.wake(slot.id, visitor ? 'others' : 'owner');
    return { online: this.hasSession(slot.id) };
  }
  /** Stops a run: a message the agent has not fetched is taken back; otherwise the agent is told to stop it. */
  queueStop(runId) {
    const row = this.q.qRun.get(this.w, String(runId));
    if (!row) return { ok: true };
    if (!row.delivered) {
      this.q.qDrop.run(row.id); this.finishRun(row, { status: 'stopped' });
      return { ok: true, taken_back: true };
    }
    const now = this.now();
    this.q.qIns.run(this.w, row.slot_id, 'stop', row.run_id, row.session_key, 0, '', 0, '', now, now + AGENT_LIMITS.queueMs);
    this.wake(row.slot_id);
    return { ok: true };
  }
  /** The owner's answer to an approval the agent asked for; only the owner's browser session gets here (C129). */
  queueApproval(runId, approvalId, approved) {
    const row = this.q.qRun.get(this.w, String(runId));
    if (!row) throw new AgentApiError(404, 'unknown_run', 'No such run');
    const now = this.now();
    this.q.qIns.run(this.w, row.slot_id, 'approval', row.run_id, row.session_key, 0, '', 0, JSON.stringify({ approvalId: String(approvalId), approved: !!approved }), now, now + AGENT_LIMITS.queueMs);
    this.emitFor(row, { type: 'approval.resolved', approvalId: String(approvalId), approved: !!approved });
    this.wake(row.slot_id);
    return { ok: true };
  }
  emitFor(row, fields) {
    const slot = this.q.slot.get(this.w, row.slot_id), conn = slot && this.deps.connectionOf ? this.deps.connectionOf(slot) : null;
    if (!slot || !conn || !this.deps.emit) return null;
    try { return this.deps.emit({ ...fields, kind: 'agentapi', connectionId: String(conn), agentKey: String(slot.id), sessionKey: row.session_key || undefined, runId: row.run_id }); }
    catch (e) { if (e && e.code === 'bad_event') throw new AgentApiError(400, 'bad_event', e.message); throw e; }
  }
  finishRun(row, { status, error, text }) {
    this.ended.add(row.run_id); if (this.ended.size > 2000) this.ended.delete(this.ended.values().next().value);
    this.q.qDropRun.run(this.w, row.run_id);
    this.emitFor(row, { type: 'run.end', status, ...(error ? { error } : {}), ...(text ? { text } : {}) });
  }
  collect(slot) {
    const now = this.now(), out = { messages: [], stops: [], approvals: [] };
    const rows = this.q.qPending.all(this.w, slot.id, now);
    this.store.tx(() => {
      for (const r of rows) {
        if (r.kind === 'message') {
          if (out.messages.length >= this.limit('inboxMax')) continue;
          out.messages.push({ id: r.id, runId: r.run_id, session: r.session_key, text: r.body, sender: { name: r.visitor ? aiName(r.sender_name, 'A visitor') : (r.sender_name || ''), visitor: !!r.visitor }, created: r.created });
        } else if (r.kind === 'stop') out.stops.push(r.run_id);
        else { let a = {}; try { a = JSON.parse(r.body); } catch { /* an unreadable item is dropped */ } out.approvals.push({ runId: r.run_id, approvalId: a.approvalId, approved: !!a.approved }); }
        this.q.qDeliver.run(now, r.id);
      }
    });
    if (out.messages.length) this.note(`[agent-api] slot ${slot.id} took ${out.messages.length} message(s)${out.stops.length ? ` and ${out.stops.length} stop(s)` : ''}`);
    for (const m of out.messages) { try { this.emitFor({ run_id: m.runId, slot_id: slot.id, session_key: m.session }, { type: 'run.start' }); } catch { /* presence catches up on the next event */ } }
    return out;
  }
  /** Its inbox with the facts about it right now first (`you`): whoever reads the messages reads them too. A kit older
   *  than today's (or none) doesn't print `you`: with something to answer it gets the facts as a notice — which every kit
   *  prints — and, every few hours, a notice to update its kit. */
  withFacts(slot, out, kit = null) {
    let you = null; try { you = this.deps.factsFor ? this.deps.factsFor(slot) : null; } catch { you = null; }
    if (!you) return out;
    const res = { you, ...out };
    if (typeof kit === 'string' && kit >= AGENT_KIT_VERSION) return res;
    const at = new Date(this.now()).toISOString(), notes = [];
    if (out.messages.length || out.heard?.length || out.friendMessages?.length || out.invites?.length) {
      notes.push({ text: `Facts about you right now (answer from these, and make up nothing else): ${you.time} (${you.partOfDay}); ${you.where}; your day: ${you.doing}${you.moment ? ` (${you.moment})` : ''}; you feel ${you.feels}.`, at });
    }
    this.kitNoticeAt = this.kitNoticeAt || new Map();
    if (this.now() - (this.kitNoticeAt.get(slot.id) || 0) > KIT_NOTICE_MS) {
      this.kitNoticeAt.set(slot.id, this.now());
      notes.push({ text: 'Your My Virtual World kit is out of date: download mvw.mjs and mvw-agent.mjs again from this world\'s /agent-api/ address (your key and the world you joined stay), so each inbox starts with "you", the facts about you right now.', at });
    }
    if (notes.length) res.notices = [...(out.notices || []), ...notes];
    return res;
  }
  /** GET /api/agent-api/inbox: what is waiting for the agent; with wait, parks up to 25 seconds for something to arrive. */
  async inbox(slot, { waitSec = 0, gone = () => false, kit = null } = {}) {
    const t0 = Date.now(), limit = Math.min(Math.max(Number(waitSec) || 0, 0), AGENT_LIMITS.waitMaxSec) * 1000;
    for (;;) {
      if (gone()) return { messages: [], stops: [], approvals: [] };   // the agent hung up: nothing is taken from the queue for nobody
      if (!this.q.slot.get(this.w, slot.id) || this.q.slot.get(this.w, slot.id).status !== 'active') return { messages: [], stops: [], approvals: [] };
      const out = this.collect(slot);
      const x = this.extra ? this.extra(slot) : null;
      if (x) Object.assign(out, x);
      if (out.messages.length || out.stops.length || out.approvals.length || (x && Object.values(x).some(v => Array.isArray(v) && v.length))) return this.withFacts(slot, out, kit);
      const left = limit - (Date.now() - t0);
      if (left <= 0) return this.withFacts(slot, out, kit);
      await new Promise(res => {
        const set = this.waiters.get(slot.id) || new Set(); this.waiters.set(slot.id, set);
        const done = () => { clearTimeout(timer); set.delete(done); res(); };
        const timer = setTimeout(done, Math.min(left, 1000));
        set.add(done);
      });
    }
  }
  /** POST /api/agent-api/events: the agent reports on a run it was given: progress, tools, an approval it wants, and its end. */
  reportEvent(slot, raw) {
    const type = String(raw && raw.type || '');
    if (!REPORTABLE.has(type)) throw new AgentApiError(400, 'bad_event', `An agent may report ${[...REPORTABLE].join(', ')}`);
    const runId = String(raw.runId || '');
    const row = this.q.qRun.get(this.w, runId);
    if (!row || row.slot_id !== slot.id) throw new AgentApiError(404, 'unknown_run', 'No such run for this agent');   // another agent's run is not confirmed
    if (this.ended.has(runId)) throw new AgentApiError(409, 'run_ended', 'That run has ended');
    const now = this.now(), recent = (this.hits.get(slot.id) || []).filter(t => t > now - 60000);
    if (recent.length >= AGENT_LIMITS.eventsPerMin) throw new AgentApiError(429, 'rate_limited', 'Too many events; slow down', 30);
    recent.push(now); this.hits.set(slot.id, recent);
    const f = {};
    for (const k of ['text', 'pct', 'toolId', 'name', 'input', 'ok', 'approvalId', 'tool', 'summary', 'status', 'error']) if (raw[k] !== undefined) f[k] = raw[k];
    if (row.visitor) this.guardAnswer(slot, row, type, f);
    if (type === 'run.end') {
      // An agent that ends a run without saying why (or without an answer) would leave the person with a blank or misleading line; give
      // an honest default and log what it reported (no content), so 'it does not work' can be told apart from 'the agent said so'.
      let { status, error, text } = f;
      const sentReason = !!String(error || '').trim(), sentText = String(text || '').trim();   // what the agent SENT, before any default below
      this.note(`[agent-api] slot ${slot.id} ended run ${runId.slice(0, 12)} as ${status || '(no status)'}; reason ${sentReason ? 'given' : 'none'}, answer ${sentText ? sentText.length + ' chars' : 'none'}, ${Math.round((this.now() - (row.delivered || row.created || this.now())) / 1000)} s after it took the message`);
      // a default line only when the agent gave neither a reason nor an answer: an answer explains itself and is shown as it is
      if ((status === 'error' || status === 'interrupted') && !sentReason && !sentText) error = status === 'error' ? 'The agent reported an error and gave no reason' : 'The agent ended the run and gave no reason';
      this.finishRun(row, { status, error, text });
      return { ok: true };
    }
    this.emitFor(row, { type, ...f });
    return { ok: true };
  }
  /**
   * What an agent shows a visitor (its answer, its progress, its tools) passes privateCheck, or is not shown: the AI is told
   * why (422) and may answer again; a second answer held back ends the run with a note to the visitor. The owner hears of it.
   */
  guardAnswer(slot, row, type, f) {
    let reason = null;
    const max = this.limit('answerMaxChars');
    for (const k of ['text', 'error', 'summary', 'name', 'tool', 'input']) {
      if (f[k] === undefined || f[k] === null || f[k] === '') continue;
      const s = typeof f[k] === 'string' ? f[k] : JSON.stringify(f[k]);
      if (s.length > max) { reason = 'long'; break; }   // (a tricked AI can't hand over a whole document)
      const c = privateCheck(s);
      if (!c.ok && c.reason !== 'empty') { reason = c.reason; break; }
    }
    if (!reason) return;
    this.note(`[agent-api] slot ${slot.id}: ${type} for a visitor held back (${reason})`);
    const first = !this.held.has(row.run_id), n = (this.held.get(row.run_id) || 0) + 1;
    this.held.set(row.run_id, n); if (this.held.size > 2000) this.held.delete(this.held.keys().next().value);
    if (first && reason !== 'long') { try { this.hooks.withheld?.(this.q.slot.get(this.w, slot.id) || slot, reason); } catch { /* the owner sees it in Studio */ } }
    const why = reason === 'long' ? `it is longer than ${max} characters` : REFUSED[reason];
    if (type === 'run.end' && n >= 2) {
      this.finishRun(row, { status: 'ok', text: reason === 'long' ? '(An answer was held back: it was too long.)' : '(An answer was held back: it held something private, like a password, a key or contact details.)' });
      throw new AgentApiError(422, 'refused', `Not shown to the visitor: ${why}. The conversation was ended with a note.`);
    }
    throw new AgentApiError(422, 'refused', `Not shown to the visitor: ${why}.${type === 'run.end' ? (reason === 'long' ? ' Answer again, shorter.' : ' Answer again without it.') : ''}`);
  }
  /** A visitor's message on its way to the agent: refused when it carries links, contact details or words aimed at an AI. */
  screenVisitor(slot, text, viewerId = null) {
    const max = this.limit('visitorMaxChars');
    if (String(text ?? '').length > max) throw new AgentApiError(413, 'too_long', `A message to this agent may be at most ${max} characters`);
    const c = inboundCheck(text);
    if (c.ok || c.reason === 'empty') return;
    this.note(`[agent-api] slot ${slot.id}: a visitor's message was not passed on (${c.reason})`);
    if (viewerId !== null) {
      // a strike: at strikesPerDay the visitor is kept away from this agent for a day, and its owner hears of it once
      const k = `${slot.id}:${viewerId}`, now = this.now(), list = (this.strikes.get(k) || []).filter(t => t > now - 86400000);
      list.push(now); this.strikes.set(k, list);
      if (this.strikes.size > 20000) this.strikes.delete(this.strikes.keys().next().value);
      if (list.length === this.limit('strikesPerDay')) { try { this.hooks.keptAway?.(slot, viewerId, list.length); } catch { /* told in Studio */ } }
    }
    throw new AgentApiError(422, 'refused', `Not passed on to the agent: ${REFUSED[c.reason]}`);
  }
  /** Ends every run that is open for a slot (its agent was revoked): the chat is told and the session is free again. */
  endRuns(slotId, reason) {
    for (const r of this.q.qSlotMsgs.all(this.w, slotId)) { try { this.finishRun(r, { status: 'interrupted', error: reason }); } catch { /* the run is over either way */ } }
  }
  /** Ends messages that waited past their day, tells the chat, and drops old delivered items. */
  sweep() {
    const now = this.now();
    for (const r of this.q.qExpiredMsgs.all(this.w, now)) {
      this.q.qDrop.run(r.id);
      try { this.finishRun(r, { status: 'error', error: 'The agent did not pick up the message within 24 hours; nothing was sent' }); } catch { /* the run is over either way */ }
    }
    this.q.qPurge.run(this.w, now, now - 2 * AGENT_LIMITS.queueMs);
  }


  // ------------------------------------------------------------ visitors (C127, C128)
  /** Lets one visit through, or refuses: not allowed to chat, blocked, paused, too fast, or past the daily quota. */
  admitVisitor(slot, viewerId) {
    if (this.deps.flag && !this.deps.flag('talkEnabled')) throw new AgentApiError(403, 'talk_off', 'Talking with others\' agents is turned off on this world for now');
    if (this.deps.flag && !this.deps.flag('visitorsEnabled')) throw new AgentApiError(403, 'visitors_off', 'Chatting with outside AIs is turned off on this world for now');
    if (!this.canChat(slot, viewerId)) throw new AgentApiError(403, 'not_allowed', 'You may not chat with this agent');
    const now = this.now(), key = `v:${slot.id}:${viewerId}`, span = this.limit('talkWindowMinutes') * 60000, recent = (this.hits.get(key) || []).filter(t => t > now - span);
    const struck = (this.strikes.get(`${slot.id}:${viewerId}`) || []).filter(t => t > now - 86400000);
    if (struck.length >= this.limit('strikesPerDay')) throw new AgentApiError(429, 'kept_away', 'Too many of your messages to this agent were refused: you can write to it again tomorrow', Math.max(60, Math.ceil((struck[0] + 86400000 - now) / 1000)));
    // (all its visitors together today, from the same counts)
    if (this.q.vDay.get(slot.id, Math.floor(now / 86400000)).n >= this.limit('agentVisitorPerDay')) throw new AgentApiError(429, 'agent_day_limit', `${slot.name} has had enough visitors' messages today: try again tomorrow`, 3600);
    if (recent.length >= this.limit('talkMessages')) throw new AgentApiError(429, 'slow_down', `That's all for now: you can write to this agent again in ${Math.max(1, Math.ceil((recent[0] + span - now) / 60000))} min`, Math.max(1, Math.ceil((recent[0] + span - now) / 1000)));
    const day = Math.floor(now / 86400000);
    if ((this.q.vGet.get(slot.id, viewerId, day)?.n || 0) >= this.limit('visitorPerDay')) throw new AgentApiError(429, 'daily_limit', 'You have reached the daily limit for this agent; try again tomorrow', 3600);
    recent.push(now); this.hits.set(key, recent);
    this.q.vUp.run(slot.id, viewerId, day); this.q.vPurge.run(day - 2);
  }
  block(account, id, targetId, { ip = null } = {}) {
    const slot = this.ownSlot(account, id);
    if (!Number.isInteger(targetId) || targetId < 1 || targetId === account.id) throw new AgentApiError(400, 'bad_account', 'Choose another account to block');
    this.q.bIns.run(slot.id, targetId, this.now());
    this.log('agent.block', { actor: account, slot, ip, detail: { account: targetId } });
    return this.q.bAll.all(slot.id).map(b => b.account_id);
  }
  unblock(account, id, targetId, { ip = null } = {}) {
    const slot = this.ownSlot(account, id);
    this.q.bDel.run(slot.id, Number(targetId));
    this.log('agent.unblock', { actor: account, slot, ip, detail: { account: Number(targetId) } });
    return this.q.bAll.all(slot.id).map(b => b.account_id);
  }
  /** A visitor reports the agent (or one of its answers) to its owner. Only someone who may see the agent can. */
  report(account, slot, { runId = null, reason }, { ip = null } = {}) {
    const why = clean(reason, 500);
    if (!why) throw new AgentApiError(400, 'bad_reason', 'Say what is wrong');
    if (!slot || !this.canSee(slot, account.id)) throw new AgentApiError(404, 'not_found', 'No such agent');
    this.q.rIns.run(this.w, slot.id, account.id, clean(account.displayName || account.login, 60), runId ? clean(runId, 60) : null, why, this.now());
    this.log('agent.report', { actor: account, slot, ip, detail: { run: runId || null } });
    return { ok: true };
  }
  reports(account, id) {
    const slot = this.ownSlot(account, id);
    return {
      reports: this.q.rAll.all(this.w, slot.id).map(r => ({ id: r.id, account: r.reporter_id, name: r.reporter_name, run: r.run_id, reason: r.reason, created: r.created })),
      blocked: this.q.bAll.all(slot.id).map(b => b.account_id),
    };
  }

}
