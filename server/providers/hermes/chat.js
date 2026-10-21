// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat over one Hermes connection (docs/features/agent-providers.md §9), inside the provider helper.
// - A chat's session is a Hermes stored session (its id is the session key here). Hermes runs a turn in a *live* session
//   of its backend process: made with session.create (a new chat: tagged source 'myvirtualworld', for the agent's
//   profile) or attached with session.resume (an existing one; it also brings this connection that session's events),
//   again after every reconnect. Events name the live id; this keeps which stored session each is.
// - A run is one message: prompt.submit. Hermes answers it at once (streaming), after the turn in progress (queued:
//   its turn comes with a later message.start), or takes it into that turn (steered, redirected: its own run ends empty,
//   the running turn answers it) — as its busy_input_mode says, or queued when the person asked for "after this answer".
// - Hermes' requests to the client in a session with a run of ours (approvals, its clarify questions, masked prompts)
//   become that run's approvals and questions; the person's answer is the response to that request (or, if the socket
//   that brought it is gone, Hermes' approval.respond / request.answer).
import fs from 'node:fs/promises';
import path from 'node:path';
import { RunTranslator, approvalOf, questionsOf, answerFor, DECISION_TO_CHOICE, historyOf, modelsOf, sessionOf, commandsOf, parseModelRef, stepsOf } from './translate.js';
import { nativeCall, nativeResult, sideOf, controlOf } from './native.js';

export const LAZY = '@new';
export const SOURCE = 'myvirtualworld';
const DOWN_GRACE_MS = 120000;        // a run whose connection is down this long is ended as interrupted
const FOREIGN_QUIET_MS = 600000;     // another client's turn with nothing new this long is let go
const ASKS = new Set(['approval', 'clarify', 'secret', 'sudo']);
const TURN_EVENTS = new Set(['message.start', 'message.delta', 'message.interim', 'message.complete', 'reasoning.delta', 'reasoning.available', 'thinking.delta',
  'tool.start', 'tool.generating', 'tool.complete', 'status.update', 'todo.updated', 'moa.reference', 'error',
  // (as its Desktop: the session named or renamed as it goes, and its usage — while a turn of ours is there)
  'session.title', 'session.usage']);
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const IMAGE = /^image\/(png|jpe?g|gif|webp|bmp)$/i;

export class LinkChat {
  /** @param {import('./link.js').HermesLink} link  @param {{ emit: (e: object) => void, kind: string }} o */
  constructor(link, { emit, kind }) {
    this.link = link; this.emit = emit; this.kind = kind;
    this.live = new Map();       // stored key → { sid, profile, gen }: the live session this connection has for it
    this.byLive = new Map();     // live id → stored key
    this.runs = new Map();       // our run id → { key, profile, base, tr, started, approvals, questions, followup, ended }
    this.turns = new Map();      // stored key → [run ids], in the order Hermes answers them
    this.asks = new Map();       // Hermes' request id → { runId, method, params, gen, sid }
    this.prefs = new Map();      // stored key → { model, effort } last applied
    this.todos = new Map();      // stored key → the latest todo list (the progress card)
    this.watched = new Map();    // stored key → { agentKey, agent, until }: sessions a page has open
    this.foreign = new Map();    // stored key → { tr, at, runId }: a turn there that isn't ours (another client)
    this.renamed = new Map();    // a stored key → the id Hermes continued it under (a compaction rotated it)
    this.usage = new Map();      // stored key → { used, size }: its context use, as its latest turn reported it
    this.downTimer = null; this.seq = 0;
  }

  // ---------------------------------------------------------------- live sessions
  /** The live session for a stored one on this connection (attached once per socket: session.resume). */
  async liveFor(key, profile) {
    const l = this.link, have = this.live.get(key);
    if (have && have.gen === l.gen) return have.sid;
    const r = await l.request('session.resume', { session_id: this.renamed.get(key) || key, profile, lazy: true, omit_messages: true });
    if (!r || !r.session_id) throw fail('provider_error', 'Hermes did not open the session');
    this.bind(key, String(r.session_id), profile);
    if (r.todo_state && Array.isArray(r.todo_state.todos)) this.todos.set(key, { steps: stepsOf(r.todo_state.todos), revision: r.todo_state.revision });
    return String(r.session_id);
  }
  bind(key, sid, profile) {
    const old = this.live.get(key);
    if (old) this.byLive.delete(old.sid);
    this.live.set(key, { sid, profile, gen: this.link.gen });
    this.byLive.set(sid, key);
  }

  // ---------------------------------------------------------------- the connection's own life
  /** Connected again: open runs are reattached to their sessions; one that ended meanwhile is finished from the history. */
  onReady() {
    clearTimeout(this.downTimer); this.downTimer = null;
    for (const key of new Set([...this.runs.values()].filter(r => !r.ended).map(r => r.key))) this.reattach(key).catch(() => {});
    for (const [key, w] of this.watched) if (!this.turns.get(key)?.length) this.liveFor(key, w.profile).catch(() => {});
  }
  onDown() {
    // (Hermes' requests on the lost socket can no longer be answered there: Hermes' own request.answer takes them)
    if (this.downTimer || ![...this.runs.values()].some(r => !r.ended)) return;
    this.downTimer = setTimeout(() => {
      this.downTimer = null;
      for (const [, r] of this.runs) if (!r.ended) r.tr.end('interrupted', { error: 'The connection to Hermes was lost' });
    }, DOWN_GRACE_MS);
    this.downTimer.unref?.();
  }
  /** The connection is closed for good (Reconnect, switched off, removed, the helper stopping): every answer still
   *  being written here ends now, with why — never left waiting. */
  close(why) {
    clearTimeout(this.downTimer); this.downTimer = null;
    for (const [, r] of this.runs) if (!r.ended) r.tr.end('interrupted', { error: why });
    for (const [key, o] of this.foreign) { o.tr.end('interrupted', { error: why }); this.foreign.delete(key); }
  }
  async reattach(key) {
    const runs = (this.turns.get(key) || []).map(id => this.runs.get(id)).filter(Boolean);
    if (!runs.length) return;
    const profile = runs[0].profile;
    // (as Hermes' own client: the session attached again — its live events wait —, then every event missed while the
    // socket was down fetched again and delivered in order, then the waiting ones: nothing lost, nothing twice)
    const oldSid = this.live.get(key)?.sid, canReplay = this.link.canReplay(oldSid);
    if (canReplay) this.link.holdFor(oldSid);
    let r;
    try { r = await this.link.request('session.resume', { session_id: this.renamed.get(key) || key, profile, lazy: true, omit_messages: true }); }
    catch (e) { if (canReplay) this.link.release(oldSid); throw e; }
    if (r && r.session_id) this.bind(key, String(r.session_id), profile);
    let rp = null;
    if (canReplay) { if (r && String(r.session_id) === String(oldSid)) rp = await this.link.replay(oldSid); else this.link.release(oldSid); }
    if (r && r.running) {
      // (still answering: its questions still open are asked again)
      const open = new Map([...(Array.isArray(r.open_requests) ? r.open_requests : []), ...(rp && rp.open ? rp.open : [])].filter(q => q && q.id).map(q => [String(q.id), q]));
      for (const q of open.values()) this.onRequest({ id: q.id, method: q.method, params: q.params || {} }, { replay: true });
      return;
    }
    // (the replay brought its end: nothing more to do)
    if (!runs.some(x => !x.ended)) return;
    // ended while the connection was down: its answer is in the history — what Hermes stored after this message (its
    // own row), never an earlier answer; none there: Hermes stopped before it answered (a restart)
    const head = runs.find(x => x.started) || runs[0];
    const raw = await this.link.rest('GET', `/api/sessions/${encodeURIComponent(this.renamed.get(key) || key)}/messages`, { query: { profile } }).catch(() => null);
    const rows = (raw && Array.isArray(raw.messages) ? raw.messages : []).filter(m => Number.isFinite(head.userRow) ? Number(m.id) > head.userRow : false);
    const ans = historyOf(rows).filter(m => m.role === 'assistant').pop();
    if (ans && (ans.text || (ans.meta && ans.meta.media))) head.tr.feed({ type: 'message.complete', payload: { text: ans.text, status: 'complete' } });
    else head.tr.end('interrupted', { error: 'Hermes stopped before it answered (it restarted, or the turn was cut off)' });
    for (const x of runs) if (x !== head && !x.ended) x.tr.end('interrupted', { error: 'Hermes restarted before this message was answered' });
  }

  // ---------------------------------------------------------------- events
  onEvent(evt) {
    const p = evt.payload || {};
    if (evt.type === 'session.info' && p.stored_session_id) {
      // (a compaction continues the conversation under a new stored id: the chat keeps its own, Hermes' is followed)
      const key = this.byLive.get(String(evt.session_id || ''));
      if (key && p.stored_session_id !== key && p.stored_session_id !== this.renamed.get(key)) this.renamed.set(key, String(p.stored_session_id));
    }
    if (evt.type === 'request.cancel') { this.cancelled(String(p.id || ''), p.reason); return; }
    if (evt.type === 'approval.cancelled') { for (const id of Array.isArray(p.request_ids) ? p.request_ids : []) this.cancelled(String(id), p.reason, true); return; }
    const key = this.byLive.get(String(evt.session_id || ''));
    if (!key) return;
    // (a side question or a background task the chat started, answered: the session's, whatever turn runs)
    const side = sideOf(evt);
    if (side) { try { this.emit({ kind: this.kind, connectionId: this.link.connectionId, sessionKey: key, type: 'session.native', ev: side }); } catch { /* the bus refused it */ } return; }
    // (its goal, loop or heartbeat changed — set, a turn counted, paused, done: the status stack follows)
    if (evt.type === 'session.control.update') { try { this.emit({ kind: this.kind, connectionId: this.link.connectionId, sessionKey: key, type: 'session.native', ev: { op: 'control', control: controlOf(p.control) } }); } catch { /* the bus refused it */ } return; }
    if (evt.type === 'todo.updated') this.todos.set(key, { steps: stepsOf(p.todos), revision: p.revision });
    if (!TURN_EVENTS.has(evt.type) && evt.type !== 'session.info') return;
    const r = this.current(key, evt.type === 'message.start');
    if (r) { r.tr.feed(evt); return; }
    if (evt.type !== 'session.info') this.observe(key, evt);
  }
  /** The run Hermes' turn in a session belongs to: the one answering, or — a turn beginning — the next one waiting. */
  current(key, starting) {
    const list = this.turns.get(key) || [];
    for (const id of list) {
      const r = this.runs.get(id);
      if (!r || r.ended) continue;
      if (r.started) return r;
      if (starting) { r.started = true; return r; }
      return null;
    }
    return null;
  }
  /** A turn in a session a page has open that isn't ours (Hermes Desktop or its dashboard answering there): shown to
   *  whoever watches, like ours, under its own run id. */
  observe(key, evt) {
    const w = this.watched.get(key);
    if (!w) return;
    if (w.until < Date.now()) { this.unwatch({ sessionKey: key }); return; }
    let o = this.foreign.get(key);
    const now = Date.now();
    if (o && now - o.at > FOREIGN_QUIET_MS) { o.tr.end('error', { error: 'Lost track of this turn' }); this.foreign.delete(key); o = null; }
    if (!o) {
      if (evt.type !== 'message.start') return;   // (only a turn's beginning starts following it)
      const runId = `h${Date.now().toString(36)}${(++this.seq).toString(36)}`;
      const base = { kind: this.kind, connectionId: this.link.connectionId, agentKey: String(w.agent || w.agentKey), sessionKey: key, runId };
      o = { at: now, runId, tr: new RunTranslator({ emit: e => { try { this.emit({ ...base, ...e }); } catch { /* the bus refused one */ } if (e.type === 'run.end') this.foreign.delete(key); } }) };
      this.foreign.set(key, o);
      this.emit({ ...base, type: 'run.start' });
    }
    o.at = now;
    o.tr.feed(evt);
  }
  /** A request from Hermes to this client. Returns undefined (answered later, by the person), or null (not answered
   *  here: Hermes is told so at once) — only in a session where we have a run; in another one it is left to Hermes' other
   *  clients. */
  onRequest(rq, { replay = false } = {}) {
    const p = rq.params || {};
    const key = this.byLive.get(String(p.session_id || ''));
    const r = key ? this.current(key, false) || (this.turns.get(key) || []).map(id => this.runs.get(id)).find(x => x && !x.ended) : null;
    if (!r) return key && !ASKS.has(rq.method) ? null : undefined;
    if (!ASKS.has(rq.method)) return null;
    const id = String(rq.id);
    if (this.asks.has(id) && !replay) return undefined;
    this.asks.set(id, { runId: r.id, method: rq.method, params: p, gen: this.link.gen, sid: String(p.session_id || '') });
    if (rq.method === 'approval') {
      const a = approvalOf(rq);
      r.approvals.set(a.approvalId, id);
      if (!r.shown.has(a.approvalId)) { r.shown.add(a.approvalId); r.tr.status('Waiting for your approval'); this.out(r, a); }
    } else {
      const questions = questionsOf(rq);
      if (!questions.length) { this.asks.delete(id); return null; }
      r.questions.add(id);
      if (!r.shown.has(id)) {
        r.shown.add(id); r.tr.status('Waiting for your answer');
        // (the Hermes view: what the request says beyond its questions — the command a sudo password is for, the
        // variable a secret goes into — drawn as Hermes Desktop's dialogs draw them)
        this.out(r, { type: 'native', ev: { op: 'ask', id, kind: rq.method, ...(p.command ? { command: String(p.command) } : {}), ...(p.env_var ? { env: String(p.env_var) } : {}),
          ...(p.prompt ? { prompt: String(p.prompt) } : {}), ...(p.description ? { desc: String(p.description) } : {}) } });
        this.out(r, { type: 'question.requested', questionId: id, questions });
      }
    }
    return undefined;
  }
  /** Hermes withdrew one of its requests (answered elsewhere, timed out, the turn stopped). */
  cancelled(id, reason, approval = false) {
    let ask = this.asks.get(id), approvalId = id;
    if (!ask && approval) {
      // (approval.cancelled names Hermes' approval ids, not its request ids)
      for (const [rid, a] of this.asks) if (a.method === 'approval' && String(a.params.request_id || '') === id) { ask = a; approvalId = id; this.asks.delete(rid); break; }
    } else this.asks.delete(id);
    if (!ask) return;
    const r = this.runs.get(ask.runId);
    if (!r || r.ended) return;
    r.tr.lastPhase = null;
    if (ask.method === 'approval') {
      const aid = String(ask.params.request_id || approvalId);
      r.approvals.delete(aid);
      this.out(r, { type: 'approval.resolved', approvalId: aid, approved: false, decision: 'cancelled' });
    } else { r.questions.delete(id); this.out(r, { type: 'question.resolved', questionId: id, status: /time/i.test(String(reason || '')) ? 'expired' : 'cancelled' }); }
  }
  out(r, e) { try { this.emit({ ...r.base, ...e }); } catch { /* the bus refused one event */ } }

  // ---------------------------------------------------------------- what the chat asks
  /**
   * Sends the person's message as a turn of the agent's session (a new chat: a new Hermes session for the agent's profile).
   * p: { runId, agent, agentKey (the Hermes profile), sessionKey, input, attachments [{ name, mime, size, path }], model,
   * effort, queue }. Resolves { runId, sessionKey } once Hermes has the message.
   */
  async run(p) {
    const l = this.link;
    await l.whenConnected();
    const profile = String(p.agentKey || '');
    if (!profile) throw fail('bad_request', 'Which agent?');
    let key = p.sessionKey && p.sessionKey !== LAZY ? String(p.sessionKey) : null, sid;
    const want = p.model ? parseModelRef(p.model) : null;
    if (!key) {
      const c = await l.request('session.create', { profile, source: SOURCE, ...(want && want.model ? { model: want.model, ...(want.provider ? { provider: want.provider } : {}) } : {}),
        ...(p.effort ? { reasoning_effort: String(p.effort) } : {}) });
      if (!c || !c.session_id || !c.stored_session_id) throw fail('provider_error', 'Hermes did not make the session');
      key = String(c.stored_session_id); sid = String(c.session_id);
      this.bind(key, sid, profile);
      this.prefs.set(key, { model: p.model || null, effort: p.effort || null });
    } else {
      sid = await this.liveFor(key, profile);
      await this.prefsFor(key, sid, profile, p.model, p.effort);
    }
    const runId = String(p.runId);
    const base = { kind: this.kind, connectionId: l.connectionId, agentKey: String(p.agent || profile), sessionKey: key, runId };
    const busy = (this.turns.get(key) || []).some(id => { const x = this.runs.get(id); return x && !x.ended; }) || this.foreign.has(key);
    const r = { id: runId, key, profile, base, started: false, ended: false, followup: busy, approvals: new Map(), questions: new Set(), shown: new Set(), tr: null };
    r.tr = new RunTranslator({ emit: e => this.fromRun(r, e) });
    this.runs.set(runId, r);
    const list = this.turns.get(key) || [];
    list.push(runId); this.turns.set(key, list);
    let text = String(p.input || '');
    try {
      text = await this.files(sid, profile, p.attachments || [], text);
      // (Hermes Desktop's Enter while a turn runs: redirect it — the turn stops at a safe point and goes on with these
      // words, recorded as the person's message after what it wrote so far. Hermes queues it for the next turn while the
      // turn is still being built; one it can't redirect goes as an ordinary message, queued for the next turn.)
      let sent = null;
      if (busy && p.queue === 'redirect' && !(p.attachments || []).length && text.trim()) {
        sent = await l.request('session.redirect', { session_id: sid, profile, text }).catch(e => (e.rpcCode === 4010 ? { status: 'rejected' } : Promise.reject(e)));
        if (sent && sent.status === 'rejected') sent = null;
      }
      // (an edit, a checkpoint restored, an answer written again — Hermes Desktop's rewind: Hermes drops that message of
      // the person's and everything after it from its record, then takes this one from there)
      const rewind = Number.isInteger(p.rewind) && p.rewind >= 0 && !busy ? { confirm_truncate: true, truncate_before_row_id: p.rewind } : {};
      // (going back to the chat's first message replaces the whole of it: Hermes asks to be told so — the person asked)
      if (!sent) sent = await l.request('prompt.submit', { session_id: sid, profile, text, ...(busy && p.queue ? { queued: true } : {}), ...rewind })
        .catch(e => (e.rpcCode === 4028 && rewind.confirm_truncate ? l.request('prompt.submit', { session_id: sid, profile, text, ...rewind, confirm_empty_truncate: true }) : Promise.reject(e)));
      const st = sent && sent.status;
      if (sent && Number.isFinite(sent.user_row_id)) r.userRow = sent.user_row_id;
      if (st === 'steered' || st === 'redirected') {
        // (redirected: what the turn wrote so far is a section of its own — the person's words come after it, the rest
        // of the turn after them)
        const cur = st === 'redirected' ? list.map(id => this.runs.get(id)).find(x => x && x !== r && x.started && !x.ended) : null;
        if (cur) { if (cur.tr.text) { cur.tr.segments.push(cur.tr.text); cur.tr.text = ''; } cur.tr.seg = null; }
        // (taken into the turn in progress, which answers it: this message's own run ends with nothing of its own)
        this.emit({ ...base, type: 'run.start' });
        r.tr.ended = true;
        this.finish(r, { type: 'run.end', status: 'ok', text: '', steered: true });
        return { runId, sessionKey: key };
      }
      // (queued behind another message of ours still waiting: Hermes merges text-only messages into that one waiting
      // turn — one answer for both — so this one is taken into it, as a steered one is; a message with pictures waits
      // for a turn of its own)
      const pictures = (p.attachments || []).some(f => IMAGE.test(f.mime || ''));
      const waiting = st === 'queued' && !pictures && list.some(id => { const x = this.runs.get(id); return x && x !== r && !x.ended && !x.started && !x.pictures; });
      if (waiting) {
        this.emit({ ...base, type: 'run.start' });
        r.tr.ended = true;
        this.finish(r, { type: 'run.end', status: 'ok', text: '', steered: true });
        return { runId, sessionKey: key };
      }
      r.pictures = pictures;
      if (st !== 'queued' && !busy) r.started = true;
    } catch (e) { this.drop(r); throw e; }
    this.emit({ ...base, type: 'run.start' });
    return { runId, sessionKey: key };
  }
  fromRun(r, e) {
    if (e.type === 'run.end') { this.finish(r, e); return; }
    if (e.type === 'usage.update') this.usage.set(r.key, { used: e.used ?? null, size: e.size ?? null });
    this.out(r, e);
  }
  finish(r, e) {
    if (r.ended && !e.steered) return;
    r.ended = true;
    // (what it still asked is withdrawn with it)
    for (const [id, a] of this.asks) if (a.runId === r.id) this.asks.delete(id);
    this.out(r, e);
    this.drop(r);
  }
  drop(r) {
    this.runs.delete(r.id);
    const list = (this.turns.get(r.key) || []).filter(id => id !== r.id);
    if (list.length) this.turns.set(r.key, list); else this.turns.delete(r.key);
  }
  /** The chat's model and thinking level as the session's own on Hermes — for that chat only (`--session`), as Hermes
   *  Desktop sets a secondary chat's — never the profile's default. A chat that names none leaves the session's. */
  async prefsFor(key, sid, profile, model, effort) {
    const last = this.prefs.get(key) || {};
    if (model && model !== last.model) {
      const m = parseModelRef(model);
      const r = await this.link.request('config.set', { session_id: sid, profile, key: 'model', value: `${m.model}${m.provider ? ` --provider ${m.provider}` : ''} --session` });
      if (r && r.confirm_required) throw fail('confirm_required', String(r.confirm_message || 'Hermes asks to confirm this model (it is expensive); choose it in Hermes first').slice(0, 300));
    }
    if (effort && effort !== last.effort) await this.link.request('config.set', { session_id: sid, profile, key: 'reasoning', value: String(effort) });
    this.prefs.set(key, { model: model || last.model || null, effort: effort || last.effort || null });
  }
  /** The person's files, as Hermes takes them from a remote client: pictures queued for the turn (image.attach_bytes),
   *  any other file staged into the session's workspace (file.attach), its @file: reference added to the message. */
  async files(sid, profile, list, text) {
    const refs = [];
    for (const f of list.slice(0, 10)) {
      const buf = await fs.readFile(f.path);
      if (IMAGE.test(f.mime || '')) {
        const r = await this.link.request('image.attach_bytes', { session_id: sid, profile, content_base64: buf.toString('base64'), filename: f.name, ext: path.extname(f.name || '').replace('.', '') || undefined }, { timeoutMs: 60000 });
        if (r && r.attached === false) throw fail('attachment_refused', `Hermes did not take ${f.name}${r.message ? `: ${r.message}` : ''}`);
      } else {
        const r = await this.link.request('file.attach', { session_id: sid, profile, name: f.name, data_url: `data:${f.mime || 'application/octet-stream'};base64,${buf.toString('base64')}` }, { timeoutMs: 120000 });
        if (!r || r.attached === false) throw fail('attachment_refused', `Hermes did not take ${f.name}`);
        if (r.ref_text) refs.push(String(r.ref_text));
      }
    }
    return refs.length ? `${text}${text ? '\n\n' : ''}${refs.join('\n')}` : text;
  }
  async stop({ runId }) {
    const r = this.runs.get(String(runId));
    if (!r) return { ok: false };
    const live = this.live.get(r.key);
    if (!live) return { ok: false };
    await this.link.request('session.interrupt', { session_id: live.sid, profile: r.profile });
    // (a message still waiting its turn: Hermes keeps it queued — it is ended here, and the interrupt answers the running one)
    if (!r.started) r.tr.end('stopped');
    return { ok: true };
  }
  /** Answers an approval: allow once, for this chat, always, or deny. */
  async approve({ runId, approvalId, approved, decision }) {
    const r = this.runs.get(String(runId));
    const rqId = r && r.approvals.get(String(approvalId));
    const ask = rqId && this.asks.get(rqId);
    if (!r || !ask) throw fail('not_found', 'That approval is no longer waiting');
    const d = DECISION_TO_CHOICE[decision] ? decision : approved ? 'allow-once' : 'deny';
    const choice = DECISION_TO_CHOICE[d];
    if (!this.link.respond(rqId, { choice }, ask.gen)) {
      const live = this.live.get(r.key);
      await this.link.request('approval.respond', { session_id: live ? live.sid : ask.sid, profile: r.profile, choice, request_id: String(ask.params.request_id || '') });
    }
    this.asks.delete(rqId); r.approvals.delete(String(approvalId)); r.tr.lastPhase = null;
    this.out(r, { type: 'approval.resolved', approvalId: String(approvalId), approved: d !== 'deny', decision: d });
    return { ok: true, decision: d };
  }
  /** Answers the agent's questions (clarify: { qid: [choices or words] }; a masked prompt: { value }), or cancels them. */
  async answer({ runId, questionId, answers, cancel }) {
    const id = String(questionId || '');
    const ask = this.asks.get(id), r = this.runs.get(String(runId));
    if (!ask || !r) throw fail('not_found', 'That question is no longer waiting');
    const result = answerFor({ method: ask.method }, answers, cancel);
    if (!this.link.respond(id, result, ask.gen)) await this.link.request('request.answer', { id, result, profile: r.profile });
    this.asks.delete(id); r.questions.delete(id); r.tr.lastPhase = null;
    const secret = ask.method !== 'clarify';
    const shown = !cancel && !secret ? Object.fromEntries(Object.entries(answers || {}).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])) : undefined;
    this.out(r, { type: 'question.resolved', questionId: id, status: cancel ? 'cancelled' : 'answered', ...(shown ? { answers: shown } : {}) });
    return { ok: true };
  }
  /** The session's history as the chat window draws it (Hermes' stored messages: its record), with its context use, model
   *  and the agent's todo list. */
  async history({ agentKey, sessionKey }) {
    if (!sessionKey || sessionKey === LAZY) return { messages: [], authoritative: true };
    const profile = String(agentKey || '');
    let id = this.renamed.get(sessionKey) || sessionKey;
    const read = x => Promise.all([this.link.rest('GET', `/api/sessions/${encodeURIComponent(x)}/messages`, { query: { profile } }),
      this.link.rest('GET', `/api/sessions/${encodeURIComponent(x)}`, { query: { profile } }).catch(() => null)]);
    let h, row;
    try { [h, row] = await read(id); }
    catch (e) {
      // (the id Hermes continued it under is not there: the chat's own)
      if (e.code !== 'not_found' || id === sessionKey) throw e;
      this.renamed.delete(sessionKey); id = sessionKey; [h, row] = await read(id);
    }
    const s = row && (row.session || row);
    const running = (this.turns.get(sessionKey) || []).some(x => this.runs.get(x) && !this.runs.get(x).ended) || this.foreign.has(sessionKey);
    // (a turn stopped or redirected part-way: Hermes' store keeps its row hidden and empty; what it wrote is in Hermes'
    // live transcript — session.history, which its Desktop reads — fetched only then)
    // (also when the store ends on the person's message: a turn just stopped may not be stored yet — its live transcript
    // has it; an answer there that the store doesn't have yet is taken, in its place by row)
    let visible = null, rows = h && Array.isArray(h.messages) ? h.messages : [];
    const shown = rows.filter(m => m && m.active !== 0 && m.display_kind !== 'hidden' && (m.role === 'user' || m.role === 'assistant'));
    if (rows.some(m => m && m.role === 'assistant' && m.display_kind === 'hidden' && !String(m.content || '').trim()) || (shown.length && shown.at(-1).role === 'user' && !running)) {
      try {
        const sid = await this.liveFor(sessionKey, profile);
        const g = await this.link.request('session.history', { session_id: sid, profile }, { timeoutMs: 20000 });
        const live = (g && Array.isArray(g.messages) ? g.messages : []).filter(x => x && x.role === 'assistant' && Number.isFinite(x.row_id) && x.text);
        visible = new Map(live.map(x => [x.row_id, x]));
        const ids = new Set(rows.map(m => Number(m.id)));
        const extra = live.filter(x => !ids.has(x.row_id)).map(x => ({ id: x.row_id, role: 'assistant', content: x.text, reasoning: x.reasoning || null, timestamp: x.timestamp, active: 1 }));
        if (extra.length) rows = [...rows, ...extra].sort((a, b) => Number(a.id) - Number(b.id));
      } catch { /* the stored messages still show */ }
    }
    const used = this.usage.get(sessionKey) || null;
    const todo = this.todos.get(sessionKey);
    return { messages: historyOf(rows, { visible }), authoritative: true, ...(used ? { usage: used } : {}),
      session: s ? { model: s.model ? String(s.model) : null, effort: null } : null, running,
      ...(todo && todo.steps.length ? { plan: { steps: todo.steps, markdown: '', ...(Number.isInteger(todo.revision) ? { revision: todo.revision } : {}) } } : {}),
      planCan: { refresh: false, dismiss: false } };
  }
  /** The slash commands this agent takes, for the composer's / menu. */
  async commands({ agentKey, sessionKey }) {
    const live = sessionKey && sessionKey !== LAZY ? this.live.get(sessionKey) : null;
    const r = await this.link.request('commands.catalog', { profile: String(agentKey || ''), ...(live && live.gen === this.link.gen ? { session_id: live.sid } : {}) });
    return { commands: commandsOf(r) };
  }
  /**
   * One of Hermes' own calls for the chat's view (native.js: its slash commands, its completions, its side questions), on
   * the chat's session — a new chat's made on Hermes first, as its Desktop makes one for a command typed into a new chat.
   * Resolves { result (rebuilt), sessionKey (the chat's on Hermes, when it has one) }.
   */
  async native({ agentKey, sessionKey, method, params, model = null, effort = null }) {
    const c = nativeCall(method, params);
    if (!c) throw fail('bad_request', 'Hermes does not take that here');
    const l = this.link;
    await l.whenConnected();
    const profile = String(agentKey || '');
    if (!profile) throw fail('bad_request', 'Which agent?');
    let key = sessionKey && sessionKey !== LAZY ? String(sessionKey) : null, sid = null;
    // (only a chat with its session on Hermes has this: none yet — nothing to ask)
    if (c.session === 'have' && !key) return { result: nativeResult(c.method, {}) };
    if (c.session === 'need' && !key) {
      const want = model ? parseModelRef(model) : null;
      const made = await l.request('session.create', { profile, source: SOURCE, ...(want && want.model ? { model: want.model, ...(want.provider ? { provider: want.provider } : {}) } : {}),
        ...(effort ? { reasoning_effort: String(effort) } : {}) });
      if (!made || !made.session_id || !made.stored_session_id) throw fail('provider_error', 'Hermes did not make the session');
      key = String(made.stored_session_id); sid = String(made.session_id);
      this.bind(key, sid, profile);
      this.prefs.set(key, { model: model || null, effort: effort || null });
    } else if (c.session !== 'none' && key) sid = await this.liveFor(key, profile);
    const r = await l.request(c.method, { ...c.params, ...(sid ? { session_id: sid } : {}), profile }, { timeoutMs: c.timeoutMs });
    const result = nativeResult(c.method, r);
    // (compressed: the context it uses now is the meter's)
    if (c.method === 'session.compress' && key && result.usage) this.usage.set(key, { used: result.usage.used ?? null, size: result.usage.size ?? null });
    return { result, ...(key ? { sessionKey: key } : {}) };
  }
  async models({ agentKey, sessionKey }) {
    const live = sessionKey && sessionKey !== LAZY ? this.live.get(sessionKey) : null;
    const r = await this.link.request('model.options', { profile: String(agentKey || ''), ...(live && live.gen === this.link.gen ? { session_id: live.sid } : {}) }, { timeoutMs: 45000 });
    return modelsOf(r);
  }
  /** The agent's stored sessions on Hermes, newest first — from every channel (its Desktop, Telegram…), not its scheduled
   *  jobs' — for whoever manages the provider. */
  async sessions({ agentKey, limit = 100 }) {
    const r = await this.link.rest('GET', '/api/sessions', { query: { profile: String(agentKey || ''), limit: Math.min(200, limit) } });
    const rows = (r && Array.isArray(r.sessions) ? r.sessions : []).filter(s => s && s.id && s.source !== 'cron' && !s.parent_session_id && !s.hidden && !s.archived);
    return { sessions: rows.map(sessionOf) };
  }
  async patchSession({ agentKey, sessionKey, model, effort, label }) {
    if (!sessionKey || sessionKey === LAZY) return { ok: false };
    const profile = String(agentKey || '');
    if (label !== undefined) await this.link.rest('PATCH', `/api/sessions/${encodeURIComponent(this.renamed.get(sessionKey) || sessionKey)}`, { query: { profile }, body: { title: label || '' } });
    if (model !== undefined || effort !== undefined) {
      const sid = await this.liveFor(sessionKey, profile);
      await this.prefsFor(sessionKey, sid, profile, model || null, effort || null);
    }
    return { ok: true };
  }
  /** A new session copied from this one up to `count` entries of Hermes' record (Hermes Desktop's "Branch in new chat";
   *  Hermes names it from its lineage). Resolves { sessionKey, title }. */
  async branch({ agentKey, sessionKey, count }) {
    if (!sessionKey || sessionKey === LAZY) throw fail('bad_request', 'Nothing to branch yet');
    const profile = String(agentKey || '');
    const sid = await this.liveFor(sessionKey, profile);
    // (a count: up to an answer; none: the whole chat — session.branch_whole, as its Desktop's chat menu)
    const r = await this.link.request(count ? 'session.branch' : 'session.branch_whole', { session_id: sid, profile, ...(count ? { count: Number(count) } : {}) }, { timeoutMs: 30000 });
    if (!r || !r.stored_session_id) throw fail('provider_error', 'Hermes did not make the branch');
    // (the branch's live session is Hermes' own until a message goes there: closed here, taken up again when needed)
    if (r.session_id) this.link.request('session.close', { session_id: String(r.session_id), profile }).catch(() => {});
    return { sessionKey: String(r.stored_session_id), title: r.title ? String(r.title) : '' };
  }
  /** Archives a session on Hermes (session.archive: kept, out of its lists). */
  async archive({ agentKey, sessionKey }) {
    if (!sessionKey || sessionKey === LAZY) throw fail('bad_request', 'Nothing to archive yet');
    const r = await this.link.request('session.archive', { session_key: this.renamed.get(sessionKey) || sessionKey, archived: true, profile: String(agentKey || '') });
    return { archived: !!(r && r.archived !== false) };
  }
  async deleteSession({ agentKey, sessionKey }) {
    if (!sessionKey || sessionKey === LAZY) return { ok: true };
    const profile = String(agentKey || '');
    const live = this.live.get(sessionKey);
    // (Hermes refuses to delete a session that is live in its process: it is closed first)
    if (live && live.gen === this.link.gen) { await this.link.request('session.close', { session_id: live.sid, profile }).catch(() => {}); this.byLive.delete(live.sid); }
    if (live) this.link.forget?.(live.sid);
    this.live.delete(sessionKey);
    await this.link.rest('DELETE', `/api/sessions/${encodeURIComponent(this.renamed.get(sessionKey) || sessionKey)}`, { query: { profile } });
    this.prefs.delete(sessionKey); this.todos.delete(sessionKey); this.renamed.delete(sessionKey);
    return { ok: true };
  }
  /** A page has a session open: its live activity is followed for it (Hermes sends a resumed session's events to every
   *  client attached to it) — a lease, renewed while it stays open. */
  async watch({ agentKey, agent, sessionKey, ms = 150000 }) {
    if (!sessionKey || sessionKey === LAZY) return { ok: false };
    const profile = String(agentKey || '');
    this.watched.set(sessionKey, { agentKey: profile, agent: String(agent || profile), profile, until: Date.now() + Math.min(600000, ms) });
    try { await this.liveFor(sessionKey, profile); } catch (e) { this.watched.delete(sessionKey); throw e; }
    return { ok: true };
  }
  unwatch({ sessionKey }) { this.watched.delete(sessionKey); return { ok: true }; }
}
