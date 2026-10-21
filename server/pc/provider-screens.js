// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an Agent Providers' agent (OpenClaw, Hermes) does, on its screens in the world (docs/features/agent-pc.md §2.2,
// §4.1). It works on its own computer, not on this PC, so its screen follows its provider's own events instead of PC
// commands: each step it takes shows what that step works on — the page it browses (a browser tool, or a terminal command
// that drives one), the file it reads or changes with the text it read or wrote, its search and what it found, a picture,
// its calendar, its tasks (./recognize.js: each app recognizes its own work; a step no app claims is the terminal's) —
// then what its run says it is doing, and what its provider says it is busy with elsewhere (another channel, a schedule).
// The screen is the PC's ordinary one (os.screen: kept in memory, sent to its owner's account only); what only sets the
// scene (a step of the terminal's, its run writing between steps) never covers the window it works in for long (os.js
// HOLD_MS). A talk in the city is not shown (quiet). At most one update per agent every GAP_MS: the last one waits its turn.
import { isProviderKey } from '../agent-providers.js';
import { recognize, finish, planBoard } from './recognize.js';

const GAP_MS = 400;
const RUNS_MAX = 2000, TOOLS_MAX = 500;
const line = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const outLines = (text, n = 3) => String(text ?? '').split('\n').filter(l => l.trim()).slice(0, n).map(l => `  ${l.slice(0, 150)}`);

export class ProviderScreens {
  /**
   * @param {{ pc: import('./os.js').PcOS, agentOf: (e: object) => object|null, quiet?: (runId: string) => boolean, now?: () => number }} o
   *   agentOf: the agent an event is about (the presence coordinator's own rule)
   */
  constructor({ pc, agentOf, quiet = () => false, now = () => Date.now() }) {
    Object.assign(this, { pc, agentOf, quiet, now });
    this.runs = new Map();    // run id → agent id (a run's later events name only the run)
    this.tools = new Map();   // step id → { agent, claim, input, shown } (what its end fills in)
    this.last = new Map();    // agent id → when its screen last changed
    this.waiting = new Map(); // agent id → { timer, screen } (the next one, waiting its turn)
  }
  start(bus) { this.off = bus.on(e => { try { this.on(e); } catch { /* the screen is not the work */ } }); return this; }
  stop() { this.off?.(); for (const w of this.waiting.values()) clearTimeout(w.timer); this.waiting.clear(); }

  /** The agent of a provider's event, or null (an agent made here: its PC tells its screen itself). */
  agent(e) {
    let a = e.agentKey ? this.agentOf(e) : null;
    if (a && e.runId) { this.runs.set(e.runId, a.id); if (this.runs.size > RUNS_MAX) this.runs.delete(this.runs.keys().next().value); }
    if (!a && e.runId && this.runs.has(e.runId)) a = this.pc.agents.get(this.runs.get(e.runId));
    return a && isProviderKey(a.key) ? a : null;
  }
  on(e) {
    if (!e || !e.type) return;
    if (e.type === 'run.end') {
      const id = this.runs.get(e.runId);
      this.runs.delete(e.runId);
      for (const [k, t] of this.tools) if (t.run === e.runId) this.tools.delete(k);
      if (id == null || this.quiet(e.runId)) return;
      // (its answer, written: on its screen as sent; a run that failed says so in its terminal)
      if (e.status === 'error') this.put(id, ['other', 'The run stopped', line(e.error, 200), { log: [`✗ ${line(e.error, 150) || 'the run stopped'}`] }]);
      else if (e.status === 'ok') this.put(id, ['chat', 'Sent its answer', '', { view: { kind: 'chat', text: line(e.text, 600), done: true }, log: ['✓ answered'] }]);
      return;
    }
    if (!['run.start', 'run.progress', 'run.status', 'tool.start', 'tool.update', 'tool.end', 'plan.update', 'agent.activity'].includes(e.type)) return;
    if (e.runId && this.quiet(e.runId)) return;
    if (e.type === 'tool.update' || e.type === 'tool.end') return this.step(e);
    const a = this.agent(e);
    if (!a) return;
    if (e.type === 'tool.start') return this.step(e, a);
    // (its provider saying it is busy while a run of this installation's is going: that run's own steps say more)
    if (e.type === 'agent.activity' && [...this.runs.values()].includes(a.id)) return;
    const s = this.screenOf(e);
    if (s) this.put(a.id, s);
  }
  /**
   * A step: shown as what it works on once its input says (OpenClaw names a step before its arguments come: a later
   * update carries them), its window filled in from its result when it ends; the terminal gets the command and the start
   * of what it said.
   */
  step(e, a = null) {
    const key = `${e.runId}|${e.toolId}`;
    let t = this.tools.get(key);
    if (e.type === 'tool.start') {
      t = { run: e.runId, agent: a.id, name: e.name, kind: e.toolKind, title: e.title, input: e.input || '', raw: e.raw || '', claim: null, shown: '' };
      this.tools.set(key, t);
      if (this.tools.size > TOOLS_MAX) this.tools.delete(this.tools.keys().next().value);
    }
    if (!t) return;
    if (e.type === 'tool.update') {
      // (its arguments, come later: what it works on is known now; its output as it runs is the terminal's, at its end)
      if ((!e.input || e.input === t.input) && (!e.raw || e.raw === t.raw)) return;
      if (e.input) t.input = e.input;
      if (e.raw) t.raw = e.raw;
    }
    // (its arguments whole where its provider gives them — the words of a file it writes — else its one line)
    if (e.type !== 'tool.end' || !t.claim) t.claim = recognize({ name: t.name, toolKind: t.kind, title: t.title, input: t.raw || t.input });
    const c = t.claim;
    if (!c) { if (e.type === 'tool.end') this.tools.delete(key); return; }   // (MVW's own PC, reached as a tool: it shows that itself)
    const cmd = c.step.cmd || '';
    if (e.type === 'tool.end') {
      this.tools.delete(key);
      const v = finish(c, { text: e.text, ok: e.ok });
      if (v) this.put(t.agent, [c.app, c.title, '', { view: v, log: outLines(e.text) }]);
      else if (c.app === 'terminal' || !t.shown) this.put(t.agent, [c.app === 'terminal' ? 'terminal' : c.app, c.title, '', { ...(t.shown ? {} : c.view ? { view: c.view } : {}), log: [...(t.shown ? [] : [cmd ? `$ ${line(cmd, 150)}` : `› ${c.title}`]), ...(e.ok === false ? [`✗ ${line(e.text, 150) || 'failed'}`] : outLines(e.text))] }]);
      return;
    }
    // (a step named before its arguments came: nothing to see yet)
    if (!t.input && !t.raw && c.app === 'terminal') return;
    const sig = `${c.app}|${c.title}|${JSON.stringify(c.view || null)}`;
    if (sig === t.shown) return;
    t.shown = sig;
    const log = [cmd ? `$ ${line(cmd, 150)}` : `› ${c.title}`, ...(!cmd && t.input && c.app === 'terminal' ? [`  ${line(t.input, 240)}`] : [])];
    this.put(t.agent, [c.app, c.title, line(t.input, 240), { ...(c.view ? { view: c.view } : {}), log }]);
  }
  /** [app, title, detail, { view, log, soft }] for a run's own events, or null when it changes nothing to see. What only
   *  sets the scene — its run starting, its words between steps — is soft: it doesn't cover the window it works in. */
  screenOf(e) {
    switch (e.type) {
      case 'run.start': return ['chat', 'Working on a message', '', { view: { kind: 'chat', text: '' }, log: ['● working on a message'], soft: true }];
      case 'run.status': return e.phase ? ['chat', line(e.phase, 120), '', { view: { kind: 'chat', text: line(e.phase, 300) }, soft: true }] : null;
      case 'run.progress': return e.text ? ['chat', line(e.text, 120), '', { view: { kind: 'chat', text: line(e.text, 300) }, soft: true }] : null;
      // (its plan, as it keeps it: a board of its steps)
      case 'plan.update': return Array.isArray(e.steps) && e.steps.length ? ['board', line(e.title, 120) || 'Its plan', '', { view: planBoard(e.steps, e.title), log: [`› ${line(e.title, 120) || 'its plan'}`] }] : null;
      // (busy elsewhere: what it is busy with, over what its screen shows — its steps there show once they are followed,
      // ./screen-watch.js)
      case 'agent.activity': return e.active ? ['other', line(e.task, 120) || 'Busy on its own computer', '', { soft: true }] : null;
      default: return null;
    }
  }
  put(agentId, [app, title, detail = '', o = {}]) {
    const now = this.now(), since = now - (this.last.get(agentId) || 0);
    const w = this.waiting.get(agentId);
    if (since >= GAP_MS && !w) { this.last.set(agentId, now); this.pc.screen(agentId, app, title, detail, o); return; }
    // (one waiting its turn: the newest is shown — unless it only sets the scene and the one waiting is a window it works
    // in — and every step still goes to its terminal)
    if (w) {
      const log = [...(w.screen[3]?.log || []), ...(o.log || [])];
      const keep = (o.soft || !o.view) && w.screen[3]?.view && !w.screen[3]?.soft;
      w.screen = keep ? [w.screen[0], w.screen[1], w.screen[2], { ...w.screen[3], log }] : [app, title, detail, { ...o, log }];
      return;
    }
    const timer = setTimeout(() => {
      const x = this.waiting.get(agentId);
      this.waiting.delete(agentId);
      if (!x) return;
      this.last.set(agentId, this.now());
      try { this.pc.screen(agentId, ...x.screen); } catch { /* gone */ }
    }, GAP_MS - since);
    timer.unref?.();
    this.waiting.set(agentId, { timer, screen: [app, title, detail, o] });
  }
}
