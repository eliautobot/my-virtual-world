// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat over one OpenClaw connection (docs/features/agent-providers.md §4–§5), inside the provider helper: a run is a
// chat.send into the agent's session (made with sessions.create when the chat is new), followed through the session's
// own events — the connection asks only for the sessions it follows (the session-scoped-events capability:
// sessions.messages.subscribe with approvals, counted per session, sent with only the documented fields so gateways
// older and newer than the client take it: the client's own coordinator adds fields a 2026.9 gateway refuses) — and
// translated (./translate.js) into the provider bus's events. Following OpenClaw's guide for clients: after a reconnect every followed session is subscribed again and
// a run that ended meanwhile is finished from the history; a run whose connection stays down is ended as interrupted.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { normalizeSessionProjectionRunId } from '@openclaw/gateway-client';
import { RunTranslator, historyOf, modelsOf, sessionOf, usageOf, textOf, commandsOf, mediaOf, mergeMedia } from './translate.js';

export const LAZY = '@new';
const SEND_TIMEOUT_MS = 30000;
const DOWN_GRACE_MS = 120000;   // a run whose connection is down this long is ended as interrupted
const FOREIGN_QUIET_MS = 600000; // another channel's run with nothing new this long is let go
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** A progress card as the chat window shows it: its steps, its notes, which version it is and when it was written. */
function cardOf(c) {
  return { steps: c && Array.isArray(c.steps) ? c.steps : [], markdown: (c && c.markdown) || '',
    ...(c && Number.isInteger(c.revision) ? { revision: c.revision } : {}), ...(c && Number.isFinite(c.updatedAt) ? { updatedAt: c.updatedAt } : {}) };
}

export class LinkChat {
  /** @param {import('./link.js').GatewayLink} link  @param {{ emit: (e: object) => void, kind: string }} o */
  constructor(link, { emit, kind }) {
    this.link = link; this.emit = emit; this.kind = kind;
    this.runs = new Map();     // our run id → { tr, key, agentId, base, approvals: Map(id → kind) }
    this.alias = new Map();    // the gateway's run id, when it is not ours → ours
    this.subs = new Map();     // session key → { refs, sub, agentId, client }
    this.prefs = new Map();    // session key → { model, effort } last applied
    this.watched = new Map();  // session key → { agentId, agent, until }: sessions a page has open (live activity from other channels)
    this.foreign = new Map();  // a run in a watched session that isn't ours → { tr, key, at }
    this.done = new Map();     // our runs that ended lately → when (a late frame of one is never taken for another channel's)
    this.downTimer = null;
  }

  // ---------------------------------------------------------------- following sessions
  async hold(key, agentId) {
    let s = this.subs.get(key);
    if (!s) { s = { refs: 0, on: false, agentId, client: null }; this.subs.set(key, s); }
    s.refs += 1;
    if (!s.on || s.client !== this.link.client) {
      try { await this.subscribe(key, s); } catch (e) { s.refs -= 1; if (!s.refs) this.subs.delete(key); throw e; }
    }
  }
  async subscribe(key, s) {
    s.client = this.link.client;
    let r;
    try { r = await this.link.request('sessions.messages.subscribe', { key, ...(s.agentId ? { agentId: s.agentId } : {}), includeApprovals: true }); }
    catch (e) { s.on = false; throw fail('provider_error', `Could not follow the session: ${e.message}`); }
    s.on = true;
    // approvals already waiting in it (the guide: backfill what predates the subscription)
    const replay = r && r.approvalReplay;
    if (replay && Array.isArray(replay.approvals)) for (const a of replay.approvals) this.onEvent({ event: 'session.approval', payload: { sessionKey: key, phase: 'pending', approval: a } });
  }
  letGo(key) {
    const s = this.subs.get(key);
    if (!s) return;
    s.refs -= 1;
    if (s.refs > 0) return;
    this.subs.delete(key);
    if (s.on && s.client === this.link.client && this.link.connected) this.link.request('sessions.messages.unsubscribe', { key, ...(s.agentId ? { agentId: s.agentId } : {}) }).catch(() => {});
  }

  // ---------------------------------------------------------------- the connection's own life
  /** Connected again: every followed session is subscribed again, and a run that ended meanwhile is finished. */
  async onHello() {
    clearTimeout(this.downTimer); this.downTimer = null;
    for (const [key, s] of this.subs) { s.on = false; this.subscribe(key, s).catch(() => {}); }
    for (const [runId, r] of this.runs) this.reconcile(runId, r).catch(() => {});
  }
  onDown() {
    if (this.downTimer || !this.runs.size) return;
    this.downTimer = setTimeout(() => {
      this.downTimer = null;
      for (const [, r] of this.runs) r.tr.feed({ event: 'chat', payload: { state: 'error', errorMessage: 'The connection to OpenClaw was lost' } });
    }, DOWN_GRACE_MS);
    this.downTimer.unref?.();
  }
  /** The connection is closed for good (Reconnect, switched off, removed, the helper stopping): every answer still being
   *  written here ends now, with why — never left waiting. */
  close(why) {
    clearTimeout(this.downTimer); this.downTimer = null;
    for (const [, r] of [...this.runs]) r.tr.feed({ event: 'chat', payload: { state: 'error', errorMessage: why } });
    for (const [, f] of [...this.foreign]) f.tr.feed({ event: 'chat', payload: { state: 'error', errorMessage: why } });
  }
  /** A run followed across a reconnect: still going (its events go on), or ended while away (finished from the history). */
  async reconcile(runId, r) {
    const h = await this.link.request('chat.history', { sessionKey: r.key, agentId: r.agentId, limit: 20 });
    const live = h && h.inFlightRun && normalizeSessionProjectionRunId(h.inFlightRun.runId);
    if (live === runId || this.alias.get(live) === runId) return;
    const last = [...(h && Array.isArray(h.messages) ? h.messages : [])].reverse().find(m => m && m.role === 'assistant');
    r.tr.feed({ event: 'chat', payload: { state: 'final', message: last ? { role: 'assistant', content: last.content } : { role: 'assistant', content: [] } } });
  }

  // ---------------------------------------------------------------- events
  /** One gateway event: to the run it belongs to (by its run id, or for an approval in a session, by the session's run). */
  onEvent(evt) {
    const p = evt && evt.payload;
    if (!p) return;
    let runId = null;
    if (evt.event === 'chat' || evt.event === 'agent') runId = this.ours(p.runId);
    else if (evt.event === 'question.requested' || evt.event === 'question.resolved') runId = this.ours(p.runId) || this.question(p.id) || this.bySession(p.sessionKey);
    else if (evt.event === 'progressCard.changed') {
      // (the session's progress card changed: read it, for the run going on there)
      const rid = this.bySession(p.sessionKey), r = rid && this.runs.get(rid);
      if (r) { this.link.request('progressCard.get', { sessionKey: p.sessionKey, agentId: r.agentId }).then(x => { if (this.runs.get(rid) === r) r.tr.feed({ event: 'progress.card', payload: x && x.card }); }, () => {}); return; }
      // (no run of ours there — its other channels, a refresh, a job: the card itself, for whoever has the session open)
      if (p.sessionKey) {
        this.link.request('progressCard.get', { sessionKey: p.sessionKey, ...(p.agentId ? { agentId: p.agentId } : {}) }).then(x => {
          const c = x && x.card;
          try { this.emit({ type: 'session.card', kind: this.kind, connectionId: this.link.connectionId, sessionKey: p.sessionKey, ...(p.agentId ? { agentKey: String(p.agentId) } : {}), ...cardOf(c) }); } catch { /* the bus refused it */ }
        }, () => {});
      }
      return;
    }
    else if (/^(exec|plugin)\.approval\.(requested|resolved)$/.test(evt.event)) runId = this.ours(p.request && p.request.runId) || this.bySession(p.request && p.request.sessionKey);
    else if (evt.event === 'session.approval') {
      runId = this.bySession(p.sessionKey);
      const a = p.approval || {}, pr = a.presentation || {};
      if (!runId || !a.id) return;
      // (OpenClaw's reviewer-safe form of the same approval: one request, whichever way it came)
      const kind = pr.kind === 'plugin' ? 'plugin' : pr.kind === 'system-agent' ? 'system-agent' : 'exec';
      const frame = p.phase === 'pending'
        ? { event: `${kind === 'plugin' ? 'plugin' : 'exec'}.approval.requested`, payload: { id: a.id, expiresAtMs: a.expiresAtMs, request: {
            command: pr.commandText, warningText: pr.warningText, title: pr.title, description: pr.description, toolName: pr.toolName, pluginId: pr.pluginId, allowedDecisions: pr.allowedDecisions } } }
        : { event: 'exec.approval.resolved', payload: { id: a.id, decision: a.status === 'allowed' ? (a.decision || 'allow-once') : 'deny' } };
      const r = this.runs.get(runId);
      if (r && p.phase === 'pending') r.approvals.set(String(a.id), kind);
      r?.tr.feed(frame);
      return;
    }
    if (!runId) { if (evt.event === 'chat' || evt.event === 'agent') this.observe(evt); return; }
    const r = this.runs.get(runId);
    if (!r) return;
    if (/\.approval\.requested$/.test(evt.event) && p.id) r.approvals.set(String(p.id), evt.event.startsWith('plugin') ? 'plugin' : 'exec');
    if (evt.event === 'question.requested' && p.id) r.questions.add(String(p.id));
    r.tr.feed(evt);
  }
  /** A run in a session a page has open that isn't ours (the agent answering on another channel, a scheduled job):
   *  followed and translated like ours, its events marked by its own run id — the server sends them to whoever watches. */
  observe(evt) {
    const p = evt.payload, key = p.sessionKey, w = key && this.watched.get(key);
    if (!w || !p.runId) return;
    if (w.until < Date.now()) { this.unwatch({ sessionKey: key }); return; }
    const id = normalizeSessionProjectionRunId(p.runId) || String(p.runId);
    if (this.done.has(id) || this.alias.has(id)) return;
    const now = Date.now();
    // (one that went quiet — its end missed — is let go: a run is never shown going on for ever)
    for (const [fid, f] of this.foreign) if (now - f.at > FOREIGN_QUIET_MS) { this.foreign.delete(fid); f.tr.feed({ event: 'chat', payload: { state: 'error', errorMessage: 'Lost track of this run' } }); }
    let o = this.foreign.get(id);
    if (!o) {
      // (only a run's beginning starts following it: a heartbeat's frames, say, are not a conversation to show)
      if (evt.event === 'agent' && p.isHeartbeat) return;
      const base = { kind: this.kind, connectionId: this.link.connectionId, agentKey: String(w.agent || w.agentId), sessionKey: key, runId: id };
      o = { key, at: now, tr: new RunTranslator({ emit: e => this.out(base, e, () => this.foreign.delete(id), () => [id]) }) };
      this.foreign.set(id, o);
      this.emit({ ...base, type: 'run.start' });
    }
    o.at = now;
    o.tr.feed(evt);
  }
  /** A page has a session open: its live activity is followed for it (a lease, renewed while it stays open). */
  async watch({ agentKey, agent, sessionKey, ms = 150000 }) {
    if (!sessionKey || sessionKey === LAZY) return { ok: false };
    const was = this.watched.get(sessionKey);
    this.watched.set(sessionKey, { agentId: String(agentKey || ''), agent: String(agent || agentKey || ''), until: Date.now() + Math.min(600000, ms) });
    if (!was) { try { await this.hold(sessionKey, String(agentKey || '')); } catch (e) { this.watched.delete(sessionKey); throw e; } }
    return { ok: true };
  }
  unwatch({ sessionKey }) {
    if (!this.watched.has(sessionKey)) return { ok: true };
    this.watched.delete(sessionKey);
    this.letGo(sessionKey);
    return { ok: true };
  }
  ours(id) {
    if (!id) return null;
    const n = normalizeSessionProjectionRunId(id) || String(id);
    if (this.runs.has(n)) return n;
    return this.alias.get(n) || null;
  }
  question(id) {
    if (!id) return null;
    for (const [runId, r] of this.runs) if (r.questions.has(String(id))) return runId;
    return null;
  }
  bySession(key) {
    if (!key) return null;
    for (const [runId, r] of this.runs) if (r.key === key) return runId;
    return null;
  }

  // ---------------------------------------------------------------- what the chat asks
  /**
   * Sends the person's message as a turn of the agent's session (a new chat: a new session, as OpenClaw's own new chats).
   * p: { runId, agent (this installation's agent key), agentKey (the OpenClaw agent), sessionKey, input, attachments
   * [{ name, mime, size, path }], model, effort }. Resolves { runId, sessionKey } once the gateway has the turn.
   */
  async run(p) {
    const l = this.link;
    await l.whenConnected();
    const agentId = String(p.agentKey || '');
    if (!agentId) throw fail('bad_request', 'Which agent?');
    let key = p.sessionKey && p.sessionKey !== LAZY ? String(p.sessionKey) : null;
    if (!key) {
      const c = await l.request('sessions.create', { agentId });
      if (!c || !c.key) throw fail('provider_error', 'OpenClaw did not make the session');
      key = String(c.key);
    }
    const attachments = await this.files(p.attachments || []);
    await this.hold(key, agentId);
    const runId = String(p.runId);
    const base = { kind: this.kind, connectionId: l.connectionId, agentKey: String(p.agent || agentId), sessionKey: key, runId };
    // (sent while the agent works in this session — a run of ours, or one from another channel: OpenClaw takes it as its
    // queue is set up; steered into that turn, its own run ends empty and its answer comes in that turn)
    const followup = [...this.runs.values()].some(x => x.key === key && !x.tr.ended) || [...this.foreign.values()].some(f => f.key === key);
    const r = { key, agentId, base, approvals: new Map(), questions: new Set(), tr: null, followup };
    r.tr = new RunTranslator({ emit: e => this.out(base, e, () => this.finish(runId), () => [runId, ...[...this.alias].filter(([, o]) => o === runId).map(([t]) => t)], r) });
    this.runs.set(runId, r);
    try {
      await this.prefsFor(key, agentId, p.model, p.effort);
      // (how a message sent while the agent works is taken: the gateway's own setting — messages.queue, steer by default —
      // as OpenClaw's Control UI sends it; queue 'later': after the running turn, whatever that setting)
      const sent = await l.request('chat.send', { sessionKey: key, agentId, message: String(p.input || ''), idempotencyKey: runId, ...(p.queue === 'later' ? { queueMode: 'followup' } : {}),
        ...(attachments.length ? { attachments } : {}) }, { timeoutMs: SEND_TIMEOUT_MS });
      const theirs = sent && sent.runId ? normalizeSessionProjectionRunId(sent.runId) : null;
      if (theirs && theirs !== runId) this.alias.set(theirs, runId);
    } catch (e) { this.finish(runId); throw e; }
    this.emit({ ...base, type: 'run.start' });
    return { runId, sessionKey: key };
  }
  /** A run's event on its way out. Its end waits a moment for the run's media: OpenClaw attaches them in its history (an
   *  agent's MEDIA lines become media blocks there, not in the live answer), so the answer arrives whole. */
  out(base, e, after, ids, r = null) {
    const send = x => { try { this.emit({ ...base, ...x }); } catch { /* the bus refused one event */ } };
    if (e.type !== 'run.end') { send(e); return; }
    this.withMedia(base.sessionKey, ids(), e).then(x => {
      // (a follow-up that ended with nothing of its own: taken into the running turn, which answers it)
      if (r && r.followup && x.status === 'ok' && !x.text && !(x.media && x.media.length)) x = { ...x, steered: true };
      send(x); after();
    });
  }
  async withMedia(sessionKey, runIds, e) {
    if (e.status !== 'ok' || !this.link.offers('chat.history')) return e;
    try {
      const h = await this.link.request('chat.history', { sessionKey, limit: 8 }, { timeoutMs: 5000 });
      const ofRun = m => m && m.role === 'assistant' && m.__openclaw && m.__openclaw.runId && runIds.includes(normalizeSessionProjectionRunId(m.__openclaw.runId) || String(m.__openclaw.runId));
      const found = (h && Array.isArray(h.messages) ? h.messages : []).filter(ofRun).map(m => mediaOf(m.content).media);
      const media = mergeMedia(e.media || [], ...found);
      return media.length ? { ...e, media } : e;
    } catch { return e; }   // (its words still arrive; the media show when the history is read again)
  }
  finish(runId) {
    const r = this.runs.get(runId);
    if (!r) return;
    this.runs.delete(runId);
    const now = Date.now();
    this.done.set(runId, now);
    for (const [id, t] of this.done) if (now - t > 600000) this.done.delete(id);
    for (const [a, ours] of this.alias) if (ours === runId) this.alias.delete(a);
    this.letGo(r.key);
  }
  /** The chat's model and thinking level as the session's own on the gateway (what OpenClaw's Control UI sets); a chat
   *  that names none leaves the session's as they are. */
  async prefsFor(key, agentId, model, effort) {
    const last = this.prefs.get(key) || {};
    const patch = {};
    if (model && model !== last.model) patch.model = String(model);
    if (effort && effort !== last.effort) patch.thinkingLevel = String(effort);
    if (!Object.keys(patch).length) return;
    await this.link.request('sessions.patch', { key, agentId, ...patch });
    this.prefs.set(key, { model: model || last.model, effort: effort || last.effort });
  }
  /** The person's files, as the gateway takes them (base64), checked against the limits it announced (never assumed). */
  async files(list) {
    const lim = (this.link.hello && this.link.hello.policy && this.link.hello.policy.attachments) || null;
    const maxPayload = this.link.hello && this.link.hello.policy && this.link.hello.policy.maxPayload;
    const out = [];
    let total = 0;
    for (const f of list.slice(0, 10)) {
      const image = /^image\//.test(f.mime || '');
      const cap = lim ? (image ? lim.maxImageBytes : lim.maxBytes) : null;
      if (cap && f.size > cap) throw fail('too_large', `${f.name} is larger than this OpenClaw gateway takes (${Math.round(cap / 1048576)} MB${image ? ' for an image' : ''})`);
      const buf = await fs.readFile(f.path);
      total += Math.ceil(buf.length / 3) * 4;
      if (maxPayload && total > maxPayload * 0.9) throw fail('too_large', 'These files together are more than the gateway takes in one message; send fewer at a time');
      out.push({ type: image ? 'image' : 'file', mimeType: f.mime || 'application/octet-stream', fileName: f.name, origin: 'file', content: buf.toString('base64'), sizeBytes: buf.length });
    }
    return out;
  }
  async stop({ runId }) {
    const r = this.runs.get(String(runId));
    if (!r) return { ok: false };
    await this.link.request('chat.abort', { sessionKey: r.key, agentId: r.agentId, runId: String(runId) });
    return { ok: true };
  }
  /** Answers an approval: decision allow-once, allow-always or deny (approved: true/false is once or deny). */
  async approve({ runId, approvalId, approved, decision }) {
    const r = this.runs.get(String(runId));
    const d = ['allow-once', 'allow-always', 'deny'].includes(decision) ? decision : approved ? 'allow-once' : 'deny';
    const kind = (r && r.approvals.get(String(approvalId))) || 'exec';
    if (this.link.offers('approval.resolve')) await this.link.request('approval.resolve', { id: String(approvalId), kind, decision: d });
    else await this.link.request(kind === 'plugin' ? 'plugin.approval.resolve' : 'exec.approval.resolve', { id: String(approvalId), decision: d });
    return { ok: true, decision: d };
  }
  /** Answers the agent's questions: answers { questionId: [the options chosen, or the words written] }, or cancel. */
  async answer({ questionId, answers, cancel }) {
    const id = String(questionId || '');
    if (!id) throw fail('bad_request', 'Which question?');
    if (cancel) return this.link.request('question.resolve', { id, cancel: true });
    const a = Object.fromEntries(Object.entries(answers || {}).slice(0, 3).map(([k, v]) => [String(k), (Array.isArray(v) ? v : [v]).slice(0, 8).map(x => String(x).slice(0, 2000))]));
    return this.link.request('question.resolve', { id, answers: { answers: a } });
  }
  /** The session's history as the chat window draws it, with its context use, model and progress card. The gateway's is the record. */
  async history({ agentKey, sessionKey }) {
    if (!sessionKey || sessionKey === LAZY) return { messages: [], authoritative: true };
    const [h, card] = await Promise.all([this.link.request('chat.history', { sessionKey, agentId: agentKey, limit: 300 }),
      this.link.offers('progressCard.get') ? this.link.request('progressCard.get', { sessionKey, agentId: agentKey }).catch(() => null) : null]);
    const info = h && h.sessionInfo, c = card && card.card;
    return { messages: historyOf(h && h.messages), authoritative: true, usage: usageOf(info), session: info ? sessionOf(info) : null,
      running: !!(h && h.inFlightRun), ...(c ? { plan: cardOf(c) } : {}),
      planCan: { refresh: this.link.offers('progressCard.refresh'), dismiss: this.link.offers('progressCard.put') } };
  }
  /** Asks the agent to bring its progress card up to date with its work (OpenClaw's Refresh task progress: no message
   *  in the chat; the card changes when it has). */
  async refreshCard({ agentKey, sessionKey, key }) {
    if (!sessionKey || sessionKey === LAZY) throw fail('bad_request', 'This chat has no progress card yet');
    // (a retry after a refresh that failed or got no answer is the same request: the gateway answers it once)
    const r = await this.link.request('progressCard.refresh', { sessionKey, agentId: agentKey, idempotencyKey: key || crypto.randomUUID() });
    return { accepted: !!(r && r.status === 'accepted'), revision: r && Number.isInteger(r.revision) ? r.revision : null };
  }
  /** Takes the progress card off the chat (OpenClaw's Dismiss): only the card as the person saw it — one the agent has
   *  written since is kept, and said so. */
  async dismissCard({ agentKey, sessionKey, revision }) {
    if (!sessionKey || sessionKey === LAZY) throw fail('bad_request', 'This chat has no progress card yet');
    const r = await this.link.request('progressCard.put', { sessionKey, agentId: agentKey, expectedRevision: revision });
    const c = r && r.card;
    return { dismissed: !c, ...(c ? { plan: cardOf(c) } : {}) };
  }
  /** The slash commands this agent takes, for the composer's / menu. */
  async commands({ agentKey, sessionKey }) {
    const r = await this.link.request('commands.list', { agentId: agentKey, ...(sessionKey && sessionKey !== LAZY ? { sessionKey } : {}), includeArgs: true });
    return { commands: commandsOf(r) };
  }
  async models({ agentKey, sessionKey }) {
    const r = await this.link.request('models.list', { agentId: agentKey, ...(sessionKey && sessionKey !== LAZY ? { sessionKey } : {}) });
    return modelsOf(r);
  }
  /** The agent's sessions on the gateway, newest first (the chat window's list, for those who manage the provider). */
  async sessions({ agentKey, limit = 100 }) {
    const r = await this.link.request('sessions.list', { agentId: agentKey, limit: Math.min(200, limit), includeDerivedTitles: true, includeLastMessage: true, excludeCron: true });
    return { sessions: (r && Array.isArray(r.sessions) ? r.sessions : []).filter(s => s && s.key && !s.isBackground).map(sessionOf) };
  }
  async patchSession({ agentKey, sessionKey, model, effort, label }) {
    if (!sessionKey || sessionKey === LAZY) return { ok: false };
    const patch = {};
    if (model !== undefined) patch.model = model || null;
    if (effort !== undefined) patch.thinkingLevel = effort || null;
    if (label !== undefined) patch.label = label || null;
    await this.link.request('sessions.patch', { key: sessionKey, agentId: agentKey, ...patch });
    const last = this.prefs.get(sessionKey) || {};
    this.prefs.set(sessionKey, { model: model !== undefined ? model || null : last.model, effort: effort !== undefined ? effort || null : last.effort });
    return { ok: true };
  }
  async deleteSession({ agentKey, sessionKey }) {
    if (!sessionKey || sessionKey === LAZY) return { ok: true };
    await this.link.request('sessions.delete', { key: sessionKey, agentId: agentKey });
    this.prefs.delete(sessionKey);
    return { ok: true };
  }
}
export { textOf };
