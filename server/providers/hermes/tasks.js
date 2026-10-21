// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A chat's background tasks on Hermes (docs/features/agent-providers.md §4 the side panel, §9): the subagents its agent
// delegated work to from that session (delegate_task) - Hermes' subagent.list for the session (its live children), and
// the subagent.start / progress / complete events it sends while they work - each with its goal, status, tools and
// output; its live transcript's tail (subagent.tail); Stop (subagent.interrupt). Or all of the agent's: its children in
// every session this connection has, and its scheduled jobs (Hermes' cron) - which belong to no chat.
// Changes of an agent with a chat open on a page go to the bus as session.task (a running one at most every SETTLE_MS).
const SETTLE_MS = 400;
const KEEP = 100;           // finished children remembered per connection
const fail = (code, message) => Object.assign(new Error(message), { code });
const STATUS = { queued: 'queued', running: 'running', completed: 'completed', failed: 'failed', error: 'failed', timeout: 'timed_out', interrupted: 'cancelled' };
const iso = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v < 1e11 ? v * 1000 : v) : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : undefined);

/** A Hermes subagent (an event's payload - `type` its event -, or a subagent.list row) as a task of the side panel. */
export function taskOf(c, prev = {}, type = '') {
  const status = STATUS[String(c.status || '')] || prev.status || 'running';
  const tail = Array.isArray(c.output_tail) ? c.output_tail.slice(-1)[0] : null;
  const t = { ...prev, id: String(c.subagent_id || prev.id), status, title: String(c.goal || prev.title || 'Subagent').slice(0, 300), runtime: 'subagent', kind: 'subagent' };
  if (typeof c.model === 'string' && c.model) t.model = c.model.slice(0, 120);
  const tool = c.tool_name || c.last_tool || (tail && tail.tool);
  if (tool) t.lastToolName = String(tool).slice(0, 80);
  // (read by the event, as Hermes Desktop reads them: a thinking event's words are its spinner - not what it does; a
  // progress event's are; a finished child's summary - else its last words - is its result)
  const said = [c.tool_preview, tail && tail.preview, type === 'subagent.progress' ? c.text : null].find(x => typeof x === 'string' && x.trim());
  if (said) t.lastActivity = String(said).slice(0, 2000);
  // (its spinner's words, as Hermes Desktop shows them under a child that has done nothing else yet)
  if (type === 'subagent.thinking' && typeof c.text === 'string' && c.text.trim()) t.progressSummary = c.text.trim().slice(0, 300);
  const summary = c.summary || (type === 'subagent.complete' ? c.text : null);
  if (summary) t.terminalSummary = String(summary).slice(0, 2000);
  if (Number.isInteger(c.tool_count)) t.toolUseCount = c.tool_count;
  const start = iso(c.started_at);
  if (start) t.startedAt = start;
  if (!t.createdAt) t.createdAt = start || Date.now();
  if (!['queued', 'running'].includes(status)) { t.endedAt = t.endedAt || Date.now(); if (Number.isFinite(c.duration_seconds) && t.startedAt) t.endedAt = t.startedAt + Math.round(c.duration_seconds * 1000); }
  t.updatedAt = Date.now();
  t.hasTranscript = true;
  t.execution = { state: ['queued'].includes(status) ? 'queued' : status === 'running' ? 'running' : 'finished', ...(status === 'running' && t.lastToolName ? { tool: { name: t.lastToolName } } : {}) };
  return t;
}
/** A Hermes scheduled job as a task of the agent's (it belongs to no chat). */
export function jobTaskOf(j) {
  const st = String(j.state || '').toLowerCase(), last = String(j.last_status || '').toLowerCase();
  const status = st === 'running' ? 'running' : !j.last_run_at ? 'queued' : /^(ok|success|completed|delivered)$/.test(last) ? 'completed' : last ? 'failed' : 'completed';
  return { id: `cron:${j.job_id || j.id}`, status, title: String(j.name || j.prompt_preview || j.job_id).slice(0, 300), runtime: 'cron', kind: 'cron',
    ...(j.prompt_preview ? { progressSummary: String(j.prompt_preview).slice(0, 2000) } : {}),
    ...(j.last_error || j.last_fire_error ? { error: String(j.last_error || j.last_fire_error).slice(0, 2000) } : {}),
    ...(iso(j.last_run_at) ? { endedAt: iso(j.last_run_at), startedAt: iso(j.last_run_at) } : {}), ...(iso(j.next_run_at) ? { updatedAt: iso(j.next_run_at) } : {}),
    hasTranscript: false, here: false };
}

export class LinkTasks {
  /** @param {import('./link.js').HermesLink} link  @param {{ emit: (e: object) => void, kind: string, chat: import('./chat.js').LinkChat }} o */
  constructor(link, { emit, kind, chat }) {
    Object.assign(this, { link, emit, kind, chat });
    this.kids = new Map();      // subagent id → { task, key, profile, sid }
    this.pending = new Map();
  }
  sidFor(key) { const l = this.chat.live.get(key); return l && l.gen === this.link.gen ? l.sid : null; }
  remember(id, x) {
    this.kids.set(id, x);
    if (this.kids.size > KEEP * 2) for (const [k, v] of this.kids) { if (this.kids.size <= KEEP * 2) break; if (!['queued', 'running'].includes(v.task.status)) this.kids.delete(k); }
  }
  async liveOf(key, profile) {
    const sid = this.sidFor(key) || await this.chat.liveFor(key, profile).catch(() => null);
    if (!sid) return [];
    const r = await this.link.request('subagent.list', { session_id: sid, profile }, { timeoutMs: 10000 }).catch(() => null);
    const out = [];
    for (const c of (r && Array.isArray(r.subagents) ? r.subagents : [])) {
      if (!c || !c.subagent_id) continue;
      const was = this.kids.get(String(c.subagent_id));
      const task = taskOf(c, was ? was.task : {});
      this.remember(task.id, { task, key, profile, sid });
      out.push(task);
    }
    return out;
  }
  /** { active, recent }: running and queued; the latest finished, the most recent first. */
  async list({ agentKey, sessionKey, scope = 'chat' }) {
    const profile = String(agentKey || '');
    if (scope !== 'agent' && (!sessionKey || sessionKey === '@new')) throw fail('bad_request', 'This chat has no tasks yet');
    const keys = scope === 'agent' ? [...new Set([...this.chat.live.entries()].filter(([, l]) => l.profile === profile).map(([k]) => k))] : [sessionKey];
    await Promise.all(keys.map(k => this.liveOf(k, profile)));
    const mine = [...this.kids.values()].filter(x => x.profile === profile && keys.includes(x.key)).map(x => ({ ...x.task, here: x.key === sessionKey }));
    let jobs = [];
    if (scope === 'agent') {
      const r = await this.link.rest('GET', '/api/cron/jobs', { query: { profile } }).catch(() => null);
      jobs = (Array.isArray(r) ? r : (r && Array.isArray(r.jobs) ? r.jobs : [])).filter(j => j && (j.job_id || j.id)).map(jobTaskOf);
    }
    const all = [...mine, ...jobs];
    const by = (a, b) => (b.endedAt || b.updatedAt || 0) - (a.endedAt || a.updatedAt || 0);
    return { active: all.filter(t => ['queued', 'running'].includes(t.status)).slice(0, 200), recent: all.filter(t => !['queued', 'running'].includes(t.status)).sort(by).slice(0, 100) };
  }
  mine({ agentKey, sessionKey, taskId, scope = 'chat' }) {
    const x = this.kids.get(String(taskId || ''));
    if (!x || x.profile !== String(agentKey || '') || (scope !== 'agent' && x.key !== sessionKey)) throw fail('not_found', 'This task is no longer available.');
    return x;
  }
  async get(p) {
    if (String(p.taskId || '').startsWith('cron:')) {
      const id = String(p.taskId).slice(5);
      const j = await this.link.rest('GET', `/api/cron/jobs/${encodeURIComponent(id)}`, { query: { profile: String(p.agentKey || '') } });
      return { task: { ...jobTaskOf(j && (j.job || j)), prompt: String((j && (j.prompt || (j.job && j.job.prompt))) || '') } };
    }
    const x = this.mine(p);
    return { task: { ...x.task, prompt: x.task.title, ...(x.task.terminalSummary ? { result: x.task.terminalSummary } : {}), here: x.key === p.sessionKey } };
  }
  /** The child's live transcript (its last 16 KB, as Hermes keeps it) as one message. */
  async history(p) {
    if (String(p.taskId || '').startsWith('cron:')) return { messages: [] };
    const x = this.mine(p);
    const r = await this.link.request('subagent.tail', { session_id: x.sid, profile: x.profile, subagent_id: x.task.id }, { timeoutMs: 10000 }).catch(() => null);
    const text = r && r.available !== false ? String(r.text || '') : '';
    return { messages: text ? [{ role: 'assistant', text: `${r.truncated ? '…\n' : ''}${text}`, ts: x.task.updatedAt || null }] : [] };
  }
  /** Words for a running child, taken into its next step (Hermes' subagent.steer: no interrupt). */
  async steer(p) {
    const x = this.mine(p), text = String(p.text || '').trim();
    if (!text) throw fail('bad_request', 'What should it do?');
    const r = await this.link.request('subagent.steer', { session_id: x.sid, profile: x.profile, subagent_id: x.task.id, text: text.slice(0, 4000) });
    const ok = !!(r && (r.ok || r.queued || r.status === 'queued' || r.status === 'steered' || r.found));
    return { steered: ok, ...(ok ? {} : { reason: String((r && (r.reason || r.error || r.status)) || 'It did not take it').slice(0, 300) }) };
  }
  async cancel(p) {
    if (String(p.taskId || '').startsWith('cron:')) throw fail('bad_request', 'A scheduled job is paused from the provider\'s Automations page');
    const x = this.mine(p);
    const r = await this.link.request('subagent.interrupt', { session_id: x.sid, profile: x.profile, subagent_id: x.task.id });
    if (r && r.found) { x.task = { ...x.task, status: 'cancelled', endedAt: Date.now(), execution: { state: 'finished' } }; this.tell(x); }
    return { cancelled: !!(r && r.found), ...(r && !r.found ? { reason: 'It had already finished' } : {}), task: x.task };
  }

  /** subagent.* events: the child's task, to the pages that have its agent's chats open. */
  onEvent(evt) {
    if (!evt || !/^subagent\.(start|progress|complete|thinking|tool)$/.test(evt.type)) return;
    const p = evt.payload || {}, sid = String(evt.session_id || '');
    const key = this.chat.byLive.get(sid);
    if (!key || !p.subagent_id) return;
    const live = this.chat.live.get(key), id = String(p.subagent_id), was = this.kids.get(id);
    const extra = evt.type === 'subagent.start' ? { status: p.status || 'running' } : evt.type === 'subagent.complete' ? {} : { status: p.status || 'running' };
    const x = { task: taskOf({ ...p, ...extra }, was ? was.task : {}, evt.type), key, profile: live ? live.profile : '', sid };
    this.remember(id, x);
    this.tell(x);
  }
  tell(x) {
    const open = this.chat.watched;
    for (const [key, w] of open) {
      if (w.profile !== x.profile) continue;
      const e = { sessionKey: key, change: 'upserted', task: { ...x.task, here: key === x.key }, here: key === x.key };
      const id = `${x.task.id}|${key}`, was = this.pending.get(id);
      if (['queued', 'running'].includes(x.task.status)) {
        if (was) { was.event = e; continue; }
        const t = { event: e, timer: setTimeout(() => { this.pending.delete(id); this.send(t.event); }, SETTLE_MS) };
        this.pending.set(id, t);
        continue;
      }
      if (was) { clearTimeout(was.timer); this.pending.delete(id); }
      this.send(e);
    }
  }
  send(e) { try { this.emit({ type: 'session.task', kind: this.kind, connectionId: this.link.connectionId, ...e }); } catch { /* the bus refused it */ } }
  onDown() { for (const x of this.pending.values()) clearTimeout(x.timer); this.pending.clear(); }
}
