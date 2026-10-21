// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Hermes' own stream for its chat view (docs/features/agent-providers.md §9 "Drawn as Hermes Desktop draws it"): beside
// the universal events (the run's text, its end, presence), a Hermes run sends what its Desktop builds a turn from - where
// a thinking or a text section begins, each tool call with Hermes' own arguments and result, its status lines, its todo
// list - so the chat window's Hermes view lays the turn out in Hermes' order. Each operation is rebuilt here from a
// whitelist, field by field, length-limited (the provider bus's rule: nothing else a provider sends travels further).
const OPS = new Set(['seg', 'tool', 'status', 'todo', 'ask', 'title', 'side', 'control']);
const ASKS = new Set(['clarify', 'secret', 'sudo']);
const SIDES = { 'btw.complete': 'btw', 'background.complete': 'bg', 'review.summary': 'review' };
const TODO = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const s = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);
const int = v => (Number.isInteger(v) && v >= 0 ? v : undefined);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const bool = v => (typeof v === 'boolean' ? v : undefined);
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * One operation of a Hermes turn, or null (not one of them):
 *   seg     { k: text|think, at }  a text or thinking section begins at that offset of the run's text (or reasoning)
 *   tool    { ph: start|end, id, name, ctx, args, ok, exit, ms, out, diff, err, blocked }  a tool call as Hermes reports it
 *           (args: its arguments as JSON, clipped; out: its result; diff: Hermes' inline diff of a file edit)
 *   status  { kind, text }  one of Hermes' status lines (a retry and its countdown, compacting, a goal …)
 *   todo    { items: [{ text, status }], rev }  the todo tool's whole list
 *   title   { text }  Hermes named (or renamed) the session
 *   ask     { id, kind: clarify|secret|sudo, command, env, prompt, desc }  what one of Hermes' requests to the person
 *           says beyond its questions (the command a sudo password is for, the variable a secret goes into) - never
 *           an answer
 *   control { control }  the session's goal, loop and heartbeat as Hermes holds them (session.control.update) - rebuilt
 *           field by field (controlOf below)
 *   side    { kind: btw|bg|review, id, question, text }  a side question (/btw) or a background task (/bg) the chat
 *           started answered (Hermes' btw.complete / background.complete), or what Hermes' self-improvement review saved
 *           to its memory or skills after a turn (review.summary) - a session's, outside any turn
 */
export function nativeOp(v) {
  if (!v || typeof v !== 'object' || !OPS.has(v.op)) return null;
  if (v.op === 'seg') return v.k === 'text' || v.k === 'think' ? { op: 'seg', k: v.k, at: int(v.at) ?? 0 } : null;
  if (v.op === 'tool') {
    const id = s(v.id, 120), name = s(v.name, 80);
    if (!id || !name || (v.ph !== 'start' && v.ph !== 'end')) return null;
    return clean({ op: 'tool', ph: v.ph, id, name, ctx: s(v.ctx, 500), args: s(v.args, 2000), ok: bool(v.ok), exit: num(v.exit), ms: num(v.ms),
      out: s(v.out, 4000), diff: s(v.diff, 8000), err: s(v.err, 1000), blocked: bool(v.blocked) });
  }
  if (v.op === 'ask') {
    const id = s(v.id, 200);
    if (!id || !ASKS.has(v.kind)) return null;
    return clean({ op: 'ask', id, kind: v.kind, command: s(v.command, 2000), env: s(v.env, 100), prompt: s(v.prompt, 1000), desc: s(v.desc, 1000) });
  }
  if (v.op === 'title') return s(v.text, 200) ? { op: 'title', text: s(v.text, 200) } : null;
  if (v.op === 'control') return { op: 'control', control: controlOf(v.control) };
  if (v.op === 'side') {
    if (v.kind !== 'btw' && v.kind !== 'bg' && v.kind !== 'review') return null;
    return clean({ op: 'side', kind: v.kind, id: s(v.id, 80), question: s(v.question, 2000), text: typeof v.text === 'string' ? v.text.slice(0, 40000) : '' });
  }
  if (v.op === 'status') return clean({ op: 'status', kind: s(v.kind, 40), text: s(v.text, 300) || '' });
  if (v.op === 'todo') {
    const items = (Array.isArray(v.items) ? v.items : []).slice(0, 50).filter(x => x && typeof x.text === 'string' && x.text)
      .map(x => ({ text: x.text.slice(0, 300), status: TODO.has(x.status) ? x.status : 'pending' }));
    return clean({ op: 'todo', items, rev: int(v.rev) });
  }
  return null;
}

// ------------------------------------------------------------------ a session's goal, loop and heartbeat (Hermes' session control)
const S = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const NUM = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const INT = v => (Number.isInteger(v) ? v : undefined);
const ONE = list => v => (list.includes(v) ? v : undefined);
const tidy = o => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));
function goalOf(g) {
  if (!g || typeof g !== 'object' || typeof g.title !== 'string') return null;
  const c = g.contract && typeof g.contract === 'object' ? g.contract : {};
  const w = g.wait_barrier && typeof g.wait_barrier === 'object' ? g.wait_barrier : null;
  return tidy({ title: g.title.slice(0, 1000), status: ONE(['active', 'done', 'paused'])(g.status) || 'active', turns_used: INT(g.turns_used) ?? 0, max_turns: INT(g.max_turns) ?? 0,
    contract: tidy({ outcome: S(c.outcome, 2000), verification: S(c.verification, 2000), constraints: S(c.constraints, 2000), boundaries: S(c.boundaries, 2000), stop_when: S(c.stop_when, 2000) }),
    subgoals: (Array.isArray(g.subgoals) ? g.subgoals : []).filter(x => typeof x === 'string').slice(0, 50).map(x => x.slice(0, 1000)),
    gates: (Array.isArray(g.gates) ? g.gates : []).filter(x => x && typeof x.command === 'string').slice(0, 20).map(x => tidy({ command: x.command.slice(0, 1000),
      timeout_seconds: INT(x.timeout_seconds), max_retries: INT(x.max_retries), attempts: INT(x.attempts), last_exit_code: x.last_exit_code === null ? null : INT(x.last_exit_code) })),
    last_reason: S(g.last_reason, 2000), last_verdict: ONE(['blocked', 'continue', 'done', 'skipped', 'wait'])(g.last_verdict), paused_reason: S(g.paused_reason, 1000),
    wait_barrier: w && ['until', 'session', 'pid'].includes(w.type) ? tidy({ type: w.type, until_at: NUM(w.until_at), target: typeof w.target === 'string' ? w.target.slice(0, 200) : INT(w.target), reason: S(w.reason, 1000) }) : undefined,
    created_at: NUM(g.created_at), updated_at: NUM(g.updated_at) });
}
function loopOf(l) {
  if (!l || typeof l !== 'object' || typeof l.prompt !== 'string') return null;
  return tidy({ prompt: l.prompt.slice(0, 4000), status: ONE(['active', 'done', 'paused'])(l.status) || 'active', mode: ONE(['interval', 'self_paced'])(l.mode) || 'interval',
    interval_seconds: NUM(l.interval_seconds), current_delay: NUM(l.current_delay), times: INT(l.times) ?? 0, until: S(l.until, 1000), max_ticks: INT(l.max_ticks), ticks_fired: INT(l.ticks_fired) ?? 0,
    created_at: NUM(l.created_at), last_fired_at: NUM(l.last_fired_at), next_due_at: NUM(l.next_due_at), awaiting_response: typeof l.awaiting_response === 'boolean' ? l.awaiting_response : undefined,
    deferred_by_goal: typeof l.deferred_by_goal === 'boolean' ? l.deferred_by_goal : undefined, paused_reason: S(l.paused_reason, 1000), last_stop_reason: S(l.last_stop_reason, 1000) });
}
function heartbeatOf(h) {
  if (!h || typeof h !== 'object' || typeof h.prompt !== 'string') return null;
  return tidy({ prompt: h.prompt.slice(0, 4000), status: ONE(['active', 'paused'])(h.status) || 'active', interval_seconds: NUM(h.interval_seconds), created_at: NUM(h.created_at),
    last_fired_at: NUM(h.last_fired_at), fire_count: INT(h.fire_count) ?? 0 });
}
/** A session's control snapshot (its goal, loop, heartbeat), rebuilt - or null. */
export function controlOf(v) {
  if (!v || typeof v !== 'object') return null;
  return { goal: goalOf(v.goal), loop: loopOf(v.loop), heartbeat: heartbeatOf(v.heartbeat), revision: S(v.revision, 100) || '', updated_at: NUM(v.updated_at) ?? 0 };
}
const CONTROL_ACTIONS = ['goal.clear', 'goal.pause', 'goal.resume', 'goal.unwait', 'heartbeat.clear', 'heartbeat.pause', 'heartbeat.resume', 'loop.pause', 'loop.resume', 'loop.stop',
  'subgoal.add', 'subgoal.clear', 'subgoal.remove'];

/** A Hermes event that is one of the side answers above (btw.complete, background.complete), as its operation; else null. */
export function sideOf(evt) {
  const kind = evt && SIDES[evt.type], p = (evt && evt.payload) || {};
  if (!kind) return null;
  // (a review's words start with Hermes' 💾, which the line draws as its own glyph - as its Desktop)
  const text = typeof p.text === 'string' ? (kind === 'review' ? p.text.trim().replace(/^[^\p{L}\p{N}]+/u, '') : p.text) : '';
  return nativeOp({ op: 'side', kind, id: typeof p.task_id === 'string' ? p.task_id : undefined, question: typeof p.question === 'string' ? p.question : undefined, text });
}

// ------------------------------------------------------------------ Hermes' own calls, for its view's composer
// What Hermes Desktop's composer calls beside a message: its slash commands - Hermes runs them (slash.exec, falling back
// to command.dispatch for a skill, a quick command, a plugin's), some through the dedicated call its Desktop uses
// (session.status, session.save, session.compress, session.title, config.get/set for /reasoning and /yolo,
// session.interrupt and process.stop for /stop) -, its suggestions while one is typed (complete.slash, commands.catalog)
// and while an @reference is (complete.path), its side question (/btw: prompt.btw) and background task (/bg:
// prompt.background). Only these; each one's arguments rebuilt here field by field, and the session it acts on always the
// chat's own - named by the server, never by the page. session: 'need' (acts on the chat's session: a new chat's is made
// on Hermes first), 'opt' (the chat's when it has one, else the agent's profile), 'none'.
const word = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const oneOf = list => v => (list.includes(v) ? v : undefined);
const CALLS = {
  'commands.catalog': { session: 'opt', args: {} },
  'complete.slash': { session: 'opt', args: { text: v => word(v, 500) }, need: ['text'] },
  'complete.path': { session: 'opt', args: { word: v => word(v, 500) }, need: ['word'] },
  'slash.exec': { session: 'need', args: { command: v => word(v, 8000) }, need: ['command'], timeoutMs: 90000 },
  'command.dispatch': { session: 'need', args: { name: v => word(v, 120), arg: v => word(v, 8000) }, need: ['name'], timeoutMs: 60000 },
  'session.status': { session: 'need', args: {} },
  'session.save': { session: 'need', args: {} },
  // (summarizing a long conversation outlives every ordinary wait: Hermes waits for it up to ~630 s, then says pending)
  'session.compress': { session: 'need', args: { focus_topic: v => word(v, 1000) }, timeoutMs: 660000 },
  'session.title': { session: 'need', args: { title: v => word(v, 200) }, need: ['title'] },
  'session.interrupt': { session: 'need', args: {} },
  'process.stop': { session: 'none', args: {} },
  'prompt.btw': { session: 'need', args: { text: v => word(v, 8000) }, need: ['text'] },
  'prompt.background': { session: 'need', args: { text: v => word(v, 8000) }, need: ['text'] },
  'config.get': { session: 'need', args: { key: oneOf(['reasoning']) }, need: ['key'] },
  // (its goal, loop and heartbeat - read, and its own actions on them: only a chat with its session on Hermes has them)
  'session.control.read': { session: 'have', args: {} },
  'session.control': { session: 'have', args: { action: oneOf(CONTROL_ACTIONS), args: v => (v && typeof v === 'object' && !Array.isArray(v) ? (typeof v.text === 'string' ? { text: v.text.slice(0, 2000) } : Number.isInteger(v.index) && v.index >= 0 ? { index: v.index } : {}) : {}) },
    need: ['action'], check: a => (a.action === 'subgoal.add' ? !!(a.args && a.args.text && a.args.text.trim()) : a.action === 'subgoal.remove' ? !!(a.args && Number.isInteger(a.args.index)) : true) },
  // (/reasoning - this chat's, or --global: Hermes' own setting -, /yolo: this chat's only)
  'config.set': { session: 'need', args: { key: oneOf(['reasoning', 'yolo']), value: v => word(v, 60), scope: oneOf(['session', 'global']) }, need: ['key', 'value'],
    check: a => !(a.key === 'yolo' && a.scope === 'global') },
};
/** One of the calls above with its arguments rebuilt - { method, params, session, timeoutMs } - or null (not one of them,
 *  or not as it takes them). */
export function nativeCall(method, params) {
  const c = typeof method === 'string' && Object.hasOwn(CALLS, method) ? CALLS[method] : null;
  if (!c) return null;
  const src = params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const out = {};
  for (const [k, f] of Object.entries(c.args)) { const v = f(src[k]); if (v !== undefined) out[k] = v; }
  if ((c.need || []).some(k => out[k] === undefined || out[k] === '')) return null;
  if (c.check && !c.check(out)) return null;
  return { method, params: out, session: c.session, timeoutMs: c.timeoutMs || 30000 };
}

const short = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const pairs = v => (Array.isArray(v) ? v : []).slice(0, 500).filter(p => Array.isArray(p) && typeof p[0] === 'string').map(p => [p[0].slice(0, 120), String(p[1] ?? '').slice(0, 400)]);
const items = (v, kind) => (Array.isArray(v) ? v : []).slice(0, 120).filter(x => x && typeof x.text === 'string').map(x => clean({ text: x.text.slice(0, 500),
  display: short(typeof x.display === 'string' ? x.display : undefined, 300), meta: short(typeof x.meta === 'string' ? x.meta : undefined, 400), ...(kind ? { kind: short(x.kind, 20) } : {}) }));
/** A command's answer as Hermes gives it to its Desktop (command.dispatch's shapes; slash.exec's output). */
const dispatchOf = r => clean({ type: oneOf(['exec', 'plugin', 'alias', 'skill', 'send', 'prefill'])(r.type), output: short(r.output, 40000), warning: short(r.warning, 1000),
  target: short(r.target, 120), name: short(r.name, 120), message: short(r.message, 100000), display: short(r.display, 2000), notice: short(r.notice, 2000) });
const RESULTS = {
  'commands.catalog': r => clean({
    categories: (Array.isArray(r.categories) ? r.categories : []).slice(0, 40).filter(c => c && typeof c.name === 'string').map(c => ({ name: c.name.slice(0, 80), pairs: pairs(c.pairs) })),
    pairs: pairs(r.pairs),
    commands: r.commands && typeof r.commands === 'object' ? Object.fromEntries(Object.entries(r.commands).slice(0, 600).filter(([k]) => /^\/[\w:.-]{1,80}$/.test(k))
      .map(([k, m]) => [k, clean({ desktop: short(m && m.desktop, 40), argument_mode: oneOf(['mixed', 'options', 'text'])(m && m.argument_mode) })])) : undefined,
    canon: r.canon && typeof r.canon === 'object' ? Object.fromEntries(Object.entries(r.canon).slice(0, 800).filter(([k, v]) => typeof v === 'string' && /^\/[\w:.-]{1,80}$/.test(k)).map(([k, v]) => [k, v.slice(0, 80)])) : undefined,
    skill_count: int(r.skill_count), warning: short(r.warning, 500) }),
  'complete.slash': r => clean({ items: items(r.items, true), replace_from: int(r.replace_from) }),
  'complete.path': r => ({ items: items(r.items, false) }),
  'slash.exec': dispatchOf,
  'command.dispatch': dispatchOf,
  'session.status': r => clean({ output: short(r.output, 20000) }),
  'session.save': r => clean({ file: short(r.file, 1000) }),
  'session.compress': r => {
    const sm = r.summary && typeof r.summary === 'object' ? r.summary : null, u = r.usage && typeof r.usage === 'object' ? r.usage : null;
    return clean({ status: short(r.status, 40), message: short(r.message, 1000), removed: int(r.removed),
      summary: sm ? clean({ headline: short(sm.headline, 500), token_line: short(sm.token_line, 500), note: short(sm.note, 500), noop: bool(sm.noop), aborted: bool(sm.aborted) }) : undefined,
      host: short(r.host_ack && r.host_ack.output, 4000), title: short(r.info && r.info.title, 200),
      usage: u && num(u.context_used) !== undefined ? clean({ used: num(u.context_used), size: num(u.context_max) }) : undefined });
  },
  'session.title': r => clean({ title: short(r.title, 200), pending: bool(r.pending) }),
  'session.interrupt': r => clean({ status: short(r.status, 40) }),
  'process.stop': r => clean({ killed: int(r.killed) }),
  'prompt.btw': r => clean({ task_id: short(r.task_id, 80) }),
  'prompt.background': r => clean({ task_id: short(r.task_id, 80) }),
  'config.get': r => clean({ value: short(r.value, 60), display: short(r.display, 60) }),
  'config.set': r => clean({ key: short(r.key, 40), value: short(r.value, 60), scope: short(r.scope, 20) }),
  'session.control.read': r => ({ control: controlOf(r.control) }),
  'session.control': r => {
    const d = r.dispatch && typeof r.dispatch === 'object' ? r.dispatch : {};
    return { control: controlOf(r.control), dispatch: clean({ type: oneOf(['exec', 'send'])(d.type), output: short(d.output, 4000), notice: short(d.notice, 4000), message: short(d.message, 20000), display: short(d.display, 2000) }) };
  },
};
/** Hermes' answer to one of the calls above, rebuilt field by field. */
export function nativeResult(method, r) {
  return Object.hasOwn(RESULTS, method) ? RESULTS[method](r && typeof r === 'object' && !Array.isArray(r) ? r : {}) : {};
}
