// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A chat's background tasks on an OpenClaw gateway (docs/features/agent-providers.md §4, the side panel): the work its
// agent started from that session — subagents, scheduled jobs, CLI and ACP runs — from OpenClaw's task ledger, as its
// Control UI shows them beside a chat: the running ones and the latest finished, each with what it is doing or waiting
// for; one task's prompt, result and transcript; Stop. Or all of the agent's — as OpenClaw's Tasks page lists them for
// one agent: its scheduled jobs and command runs belong to no chat (2026-10-16, a real gateway: 2,435 of 2,669 tasks were
// jobs with no session). The gateway announces every change (`task` events); those of an agent with a chat open on a page
// go to the provider bus as session.task — marked `here` when the task is that chat's — at most a few a second per task.
import { historyOf } from './translate.js';

const ACTIVE = ['queued', 'running'];
const FINISHED = ['completed', 'failed', 'timed_out', 'cancelled'];
const ACTIVE_LIMIT = 200;   // (OpenClaw's Control UI: 200 running, the latest 100 finished, a transcript 100 messages a page)
const RECENT_LIMIT = 100;
const HISTORY_LIMIT = 100;
const SETTLE_MS = 400;      // a running task's changes (each tool it calls) are reported at most this often
const fail = (code, message) => Object.assign(new Error(message), { code });

/** Whether a task was started from this session of this agent (its requester); anything else is not this chat's to see. */
export function belongs(t, agentKey, sessionKey) {
  if (!t || !sessionKey) return false;
  if (t.sessionKey !== sessionKey && t.ownerKey !== sessionKey) return false;
  return !t.agentId || !agentKey || String(t.agentId).toLowerCase() === String(agentKey).toLowerCase();
}
/** Whether a task is this agent's (as OpenClaw's Tasks page decides: its agent, else the agent its sessions are under). */
export function agentOf(t) {
  if (!t) return '';
  if (t.agentId) return String(t.agentId).toLowerCase();
  for (const k of [t.sessionKey, t.childSessionKey, t.ownerKey]) { const m = /^agent:([^:]+):/.exec(String(k || '')); if (m) return m[1].toLowerCase(); }
  return '';
}
const isAgents = (t, agentKey) => !!agentKey && agentOf(t) === String(agentKey).toLowerCase();

export class LinkTasks {
  /** @param {import('./link.js').GatewayLink} link  @param {{ emit: (e: object) => void, kind: string, watched: () => Map<string, object> }} o */
  constructor(link, { emit, kind, watched }) {
    Object.assign(this, { link, emit, kind, watched });
    this.pending = new Map();   // 'task id|session key' → { timer, event }: a running task's latest change, waiting to be reported
  }
  need(sessionKey, scope) { if (scope !== 'agent' && !sessionKey) throw fail('bad_request', 'This chat has no tasks yet'); }

  /**
   * The tasks: { active, recent } — running and queued; the latest finished, the most recent first. scope 'chat': the
   * session's; 'agent': all of the agent's, each marked `here` when it is the session's.
   */
  async list({ agentKey, sessionKey, scope = 'chat' }) {
    this.need(sessionKey, scope);
    const all = scope === 'agent';
    if (all && !agentKey) throw fail('bad_request', 'Which agent?');
    const base = all ? { agentId: agentKey } : { sessionKey, ...(agentKey ? { agentId: agentKey } : {}) };
    const [a, r] = await Promise.all([this.link.request('tasks.list', { ...base, status: ACTIVE, limit: ACTIVE_LIMIT }),
      this.link.request('tasks.list', { ...base, status: FINISHED, sortBy: 'endedAt', limit: RECENT_LIMIT })]);
    const of = x => (x && Array.isArray(x.tasks) ? x.tasks : []).filter(t => (all ? isAgents(t, agentKey) : belongs(t, agentKey, sessionKey)))
      .map(t => ({ ...t, here: belongs(t, agentKey, sessionKey) }));
    return { active: of(a), recent: of(r) };
  }
  /** One of the session's tasks (scope 'agent': of the agent's), as the gateway has it now — with its prompt and result. */
  async mine({ agentKey, sessionKey, taskId, scope = 'chat' }) {
    this.need(sessionKey, scope);
    if (typeof taskId !== 'string' || !taskId) throw fail('bad_request', 'Which task?');
    let r;
    try { r = await this.link.request('tasks.get', { taskId }); } catch (e) { if (e.code === 'INVALID_REQUEST' || e.code === 'NOT_FOUND') throw fail('not_found', 'This task is no longer available.'); throw e; }
    const t = r && r.task;
    if (!(scope === 'agent' ? isAgents(t, agentKey) : belongs(t, agentKey, sessionKey))) throw fail('not_found', 'This task is no longer available.');
    return t;
  }
  async get(p) { return { task: await this.mine(p) }; }
  /** A page of the task's own transcript (its child session), oldest first, read as the chat reads a history. */
  async history(p) {
    const t = await this.mine(p);
    if (t.hasTranscript === false) return { messages: [] };
    const r = await this.link.request('tasks.history', { taskId: t.id, limit: HISTORY_LIMIT, ...(typeof p.cursor === 'string' && p.cursor ? { cursor: p.cursor.slice(0, 8192) } : {}) });
    return { messages: historyOf(r && r.messages), ...(r && typeof r.nextCursor === 'string' && r.nextCursor ? { nextCursor: r.nextCursor } : {}) };
  }
  /** Stops a running task (OpenClaw's tasks.cancel): { cancelled, reason, task }. */
  async cancel(p) {
    const t = await this.mine(p);
    const r = await this.link.request('tasks.cancel', { taskId: t.id, reason: 'Stopped from My Virtual World' });
    return { cancelled: !!(r && r.cancelled), ...(r && r.reason ? { reason: String(r.reason) } : {}), ...(r && r.task ? { task: r.task } : {}) };
  }

  /** A `task` event: a change in a task of an agent with a chat open on a page goes to the bus for that chat, marked `here`
   *  when the task is the chat's (a running task's at most every SETTLE_MS; one that ends, at once). A task gone, or the
   *  list restored, concerns every open chat of this gateway. */
  onEvent(evt) {
    if (!evt || evt.event !== 'task' || !evt.payload) return;
    const p = evt.payload, open = this.watched();
    if (!open.size) return;
    if (p.action === 'upserted' && p.task && p.task.id) {
      const t = p.task;
      for (const [key, w] of open) {
        if (!isAgents(t, w.agentId)) continue;
        const e = { sessionKey: key, change: 'upserted', task: t, here: belongs(t, w.agentId, key) };
        const id = `${t.id}|${key}`, was = this.pending.get(id);
        if (ACTIVE.includes(t.status)) {
          if (was) { was.event = e; continue; }
          const x = { event: e, timer: setTimeout(() => { this.pending.delete(id); this.send(x.event); }, SETTLE_MS) };
          this.pending.set(id, x);
          continue;
        }
        if (was) { clearTimeout(was.timer); this.pending.delete(id); }
        this.send(e);
      }
    } else if (p.action === 'deleted' && p.taskId) {
      for (const [id, was] of this.pending) if (id.startsWith(`${p.taskId}|`)) { clearTimeout(was.timer); this.pending.delete(id); }
      for (const key of open.keys()) this.send({ sessionKey: key, change: 'deleted', taskId: String(p.taskId) });
    } else if (p.action === 'restored') {
      for (const key of open.keys()) this.send({ sessionKey: key, change: 'restored' });
    }
  }
  send(e) {
    try { this.emit({ type: 'session.task', kind: this.kind, connectionId: this.link.connectionId, ...e }); } catch { /* the bus refused it */ }
  }
  onDown() { for (const x of this.pending.values()) clearTimeout(x.timer); this.pending.clear(); }
}
