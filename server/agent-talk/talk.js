// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Talking with someone else's agent in the city (docs/features/CHAT.md §14; 2026-10-08). A player walking up to it —
// or anyone choosing it on the map — talks through a short bar; its answers show in its speech bubble, to them alone.
// Its owner talks with it in the chat window instead (it is theirs: no limits, every tool).
// - Short on purpose, against prompt injection and runaway cost (the owner's brain, or the installation's for a plan):
//   a conversation is at most talk.maxMessages messages of talk.maxChars characters, and talk.windowMinutes after its
//   first message it is cleared — the next message starts a new one, with nothing of the last (admin settings, read on
//   every message). The server counts and refuses; the bar only shows what is left.
// - Private: the answer goes to the talker only (chat.js run events); nothing is said in the world for others to see.
//   The agent stops and turns to whom it talks with (sim.js hold), and is not called away meanwhile.
// - Its owner reads every conversation anyone had with their agents, and blocks a player (or another agent) from
//   talking with any of them again (talk_blocks).
// - Who answers: the city's own agents (a model provider: the Mind, as a visitor's chat — no tools, no money, never
//   its owner's notes) and connected agents (their platform's visitor handling). An agent on an outside platform with
//   tools on real machines (OpenClaw…) never gets a stranger's words: it greets, as residents do.
// - What its owner gives others (the Studio's Visitors tab, the job brief's publicMode — §14.3): its job, its life in
//   the city, or only a greeting.
// A conversation is a chat session of kind 'talk' (never in the chat window's lists); kept 30 days for its owner's review.
export class TalkError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; Object.assign(this, extra); }
}

export const TALK_KINDS = new Set(['models', 'agentapi']);   // (the brains that handle a visitor safely)
const KEEP_DAYS = 30;
const clean = t => String(t ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

export class Talk {
  /**
   * @param {{ dbs, agents, connections, sessions, transcripts, chat, setting: (path: string) => any, sim: () => object|null,
   *   ownerOf: (agent) => number|null, work?: object, log?: object, now?: () => number }} o
   */
  constructor({ dbs, agents, connections, sessions, transcripts, chat, setting, sim, ownerOf, work = null, log = null, now = () => Date.now() }) {
    Object.assign(this, { dbs, agents, connections, sessions, transcripts, chat, setting, simOf: sim, ownerOf, work, log, now });
    const db = dbs.db, w = dbs.worldId;
    this.w = w;
    this.q = {
      blocked: db.prepare('SELECT 1 FROM talk_blocks WHERE world_id = ? AND owner_id = ? AND account_id = ?'),
      blockedAgent: db.prepare('SELECT 1 FROM talk_blocks WHERE world_id = ? AND owner_id = ? AND agent_id = ?'),
      block: db.prepare('INSERT OR IGNORE INTO talk_blocks (world_id, owner_id, account_id, agent_id, created) VALUES (?, ?, ?, ?, ?)'),
      unblockAccount: db.prepare('DELETE FROM talk_blocks WHERE world_id = ? AND owner_id = ? AND account_id = ?'),
      unblockAgent: db.prepare('DELETE FROM talk_blocks WHERE world_id = ? AND owner_id = ? AND agent_id = ?'),
      blocks: db.prepare('SELECT * FROM talk_blocks WHERE world_id = ? AND owner_id = ? ORDER BY id DESC'),
      account: db.prepare('SELECT id, login, display_name FROM accounts WHERE world_id = ? AND id = ?'),
      // (the day's counts, from what is kept: a restart doesn't start them again)
      visitorDay: db.prepare(`SELECT COUNT(*) AS n FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id AND s.world_id = m.world_id
        WHERE m.world_id = ? AND m.agent_id = ? AND m.account_id = ? AND m.role = 'user' AND m.ts > ? AND s.kind = 'talk'`),
      agentDay: db.prepare(`SELECT COUNT(*) AS n FROM chat_sessions s JOIN chat_messages m ON m.session_id = s.id AND m.world_id = s.world_id
        WHERE s.world_id = ? AND s.agent_id = ? AND s.kind = 'talk' AND s.updated > ? AND m.role = 'user' AND m.ts > ?`),
    };
    this.timer = null;
  }
  attach() { this.timer = setInterval(() => this.tidy(), 3600000); this.timer.unref?.(); this.tidy(); return this; }
  stop() { clearInterval(this.timer); }
  tidy() { try { this.sessions.dropOldTalks(this.now() - KEEP_DAYS * 86400000); } catch (e) { this.log?.warn?.('[talk] tidy failed:', e.message); } }

  /** The admin's limits, now. */
  limits() {
    const n = (k, d, lo, hi) => { const v = Number(this.setting(k)); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d; };
    return { enabled: this.setting('talk.enabled') !== false, maxMessages: n('talk.maxMessages', 15, 1, 100), maxChars: n('talk.maxChars', 200, 20, 2000),
      windowMs: n('talk.windowMinutes', 5, 1, 60) * 60000,
      // a day's worth, over every conversation: one person with one agent, and all visitors with one agent
      visitorPerDay: n('talk.visitorPerDay', 50, 1, 1000), agentVisitorPerDay: n('talk.agentVisitorPerDay', 200, 1, 5000) };
  }
  nameOf(accountId) { const r = this.q.account.get(this.w, Number(accountId)); return r ? (r.display_name || r.login) : 'Someone'; }
  isBlocked(ownerId, accountId) { return !!(ownerId && accountId && this.q.blocked.get(this.w, ownerId, accountId)); }
  /** Whether an owner keeps another agent from talking with their agents (the agents' own meetings, server/mind/). */
  blocksAgent(ownerId, agentId) { return !!(ownerId && agentId && this.q.blockedAgent.get(this.w, ownerId, agentId)); }

  /** What this account gets from agent `id`: 'own' (the chat window), 'talk' (the bar, with where its conversation
   *  stands), or 'greet' (a resident's greeting) with why. */
  state(P, id) {
    const a = this.agentOf(id);
    if (this.agents.isOwner(P, a)) return { mode: 'own', agent: a.id };
    const why = this.whyNot(P, a);
    if (why) return { mode: 'greet', agent: a.id, why: why.code, message: why.message };
    const L = this.limits(), s = this.current(P.account.id, a.id, L);
    return { mode: 'talk', agent: a.id, name: a.name, ...this.window(s, s ? this.transcripts.userCount(s.id) : 0, L) };
  }
  /** One message from this account to agent `id` (`at`: where the talker stands, for the agent to turn to). Starts the
   *  answer (chat.js: the talker's account gets its pieces and its end) and says where the conversation stands. */
  async say(P, id, text, at = null) {
    const a = this.agentOf(id);
    if (this.agents.isOwner(P, a)) throw new TalkError(409, 'own', `${a.name} is yours: talk with it in the chat window`);
    const why = this.whyNot(P, a);
    if (why) throw why;
    const L = this.limits(), t = clean(text);
    if (!t) throw new TalkError(400, 'empty', 'Write something to say');
    if (t.length > L.maxChars) throw new TalkError(413, 'too_long', `A message may be at most ${L.maxChars} characters`, { maxChars: L.maxChars });
    let s = this.current(P.account.id, a.id, L), used = s ? this.transcripts.userCount(s.id) : 0;
    if (s && used >= L.maxMessages) {
      throw new TalkError(429, 'talk_limit', `That's all for now: this conversation can start again in ${Math.max(1, Math.ceil((s.created + L.windowMs - this.now()) / 60000))} min`,
        { resetAt: s.created + L.windowMs });
    }
    // a day's worth (24 hours, every conversation together): of this person with this agent, and of all its visitors
    const dayAgo = this.now() - 86400000;
    if (this.q.visitorDay.get(this.w, a.id, P.account.id, dayAgo).n >= L.visitorPerDay) throw new TalkError(429, 'visitor_day_limit', `That's enough talking with ${a.name} for today: try again tomorrow`);
    if (this.q.agentDay.get(this.w, a.id, dayAgo, dayAgo).n >= L.agentVisitorPerDay) throw new TalkError(429, 'agent_day_limit', `${a.name} has talked with enough visitors today: try again tomorrow`);
    // it stops and turns to them (asleep, it doesn't: nobody talks with it then)
    const i = this.bodyOf(a), sim = this.simOf();
    if (i >= 0 && sim) {
      const me = sim.agents[i]?.plan ? sim.agentInfo(i) : null;
      const x = Number.isFinite(at?.x) ? at.x : (me?.pos.x ?? 0) + 1, z = Number.isFinite(at?.z) ? at.z : (me?.pos.z ?? 0) + 1;
      if (me?.act && (me.act.use === 'sleep' || me.act.use === 'nap')) throw new TalkError(409, 'asleep', `${a.name} is asleep`);
      sim.hold(i, x, z);
    }
    if (!s) { s = this.sessions.createTalk(P.account.id, a.id, `Talk with ${a.name}`); used = 0; }
    const out = await this.chat.startRun(P, { input: t }, { a, s });
    return { runId: out.runId, ...this.window(s, used + 1, L) };
  }
  /** Its owner, in person (Play mode): their agent stops and turns to them while they talk in the chat window. */
  face(P, id, at) {
    const a = this.agentOf(id);
    if (!this.agents.isOwner(P, a)) throw new TalkError(404, 'not_found', 'No such agent');
    const i = this.bodyOf(a), sim = this.simOf();
    if (i < 0 || !sim || !at) return { ok: false };
    return { ok: !!sim.hold(i, at.x, at.z) };
  }
  /** The conversation now open between the account and the agent (null: none, or its time is up — the next message
   *  starts a new one). */
  current(accountId, agentId, L = this.limits()) {
    const s = this.sessions.latestTalk(accountId, agentId);
    return s && this.now() - s.created < L.windowMs ? s : null;
  }
  window(s, used, L) {
    return { session: s ? s.id : null, used, maxMessages: L.maxMessages, left: Math.max(0, L.maxMessages - used), maxChars: L.maxChars,
      windowMs: L.windowMs, endsAt: s ? s.created + L.windowMs : null };
  }
  agentOf(id) {
    const a = Number.isInteger(Number(id)) ? this.agents.get(Number(id)) : null;
    if (!a || !a.enabled) throw new TalkError(404, 'not_found', 'No such agent');
    return a;
  }
  bodyOf(a) { try { return this.agents.resolver.resolveBody(a.bodyRef); } catch { return -1; } }
  /** Why this account can't talk with agent a, or null. */
  whyNot(P, a) {
    if (!P || !P.account) return new TalkError(401, 'signin_required', 'Sign in to talk with agents');
    if (!this.limits().enabled) return new TalkError(403, 'talk_off', `${a.name} only greets passers-by here`);
    const c = a.connectionId ? this.connections.get(a.connectionId) : null;
    if (!c || !c.enabled || !TALK_KINDS.has(c.kind) || this.publicMode(a) === 'greet') return new TalkError(409, 'greets_only', `${a.name} only greets passers-by`);
    if (this.isBlocked(this.ownerOf(a), P.account.id)) return new TalkError(403, 'blocked', `${a.name} isn't talking with you`);
    return null;
  }

  /** Whether anyone signed in may talk with agent a (the info dock's Public agents): talking is on in the city, its brain
   *  takes a stranger's words and its owner gives others its work or its life, not only a greeting. */
  isPublic(a) {
    if (!a || !this.limits().enabled) return false;
    const c = a.connectionId ? this.connections.get(a.connectionId) : null;
    return !!(c && c.enabled && TALK_KINDS.has(c.kind) && this.publicMode(a) !== 'greet');
  }

  /** What its owner gives others: 'work', 'life' or 'greet'. */
  publicMode(a) { try { return this.work ? this.work.brief(a.id).publicMode : 'life'; } catch { return 'life'; } }

  // ---------------------------------------------------------------- its owner's review
  /** Everyone who talked with agent a, newest first: who, when, how many messages, whether they are blocked. */
  conversations(a, limit = 100) {
    const owner = this.ownerOf(a);
    return this.sessions.talksOf(a.id, limit).map(s => ({ id: s.id, account: { id: s.accountId, name: this.nameOf(s.accountId) }, started: s.created, updated: s.updated,
      messages: this.transcripts.userCount(s.id), blocked: this.isBlocked(owner, s.accountId) }));
  }
  conversation(a, sessionId) {
    const s = this.sessions.talkOf(a.id, sessionId);
    if (!s) throw new TalkError(404, 'not_found', 'No such conversation');
    return { id: s.id, account: { id: s.accountId, name: this.nameOf(s.accountId) }, started: s.created,
      messages: this.transcripts.read(s.accountId, a.id, s.id, 200).filter(m => m.role !== 'system').map(m => ({ role: m.role, text: m.text, ts: m.ts })) };
  }
  /** An owner keeps a player (account) or another agent from talking with any of their agents — or lets them again. */
  setBlock(ownerId, { account = null, agent = null, on = true }) {
    const acc = Number.isInteger(Number(account)) && Number(account) > 0 ? Number(account) : null, ag = Number.isInteger(Number(agent)) && Number(agent) > 0 ? Number(agent) : null;
    if (!acc === !ag) throw new TalkError(400, 'bad_request', 'Block a player (account) or an agent (agent)');
    if (acc && acc === ownerId) throw new TalkError(400, 'bad_request', 'That is you');
    if (on) { this.q.block.run(this.w, ownerId, acc, ag, this.now()); if (ag) try { this.onBlockAgent?.(ownerId, ag); } catch (e) { this.log?.warn?.('[talk] block hook:', e.message); } }
    else if (acc) this.q.unblockAccount.run(this.w, ownerId, acc);
    else this.q.unblockAgent.run(this.w, ownerId, ag);
    return this.blocks(ownerId);
  }
  blocks(ownerId) {
    return this.q.blocks.all(this.w, ownerId).map(r => r.account_id
      ? { account: { id: r.account_id, name: this.nameOf(r.account_id) }, created: r.created }
      : { agent: { id: r.agent_id, name: this.agents.get(r.agent_id)?.name || 'An agent' }, created: r.created });
  }
}
