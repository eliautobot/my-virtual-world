// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What each person in the city did lately (the selection card's activity feed: client/js/ui/sel-feeds.js). It only watches
// the simulation (Sim.actObservers, like an agent's life) and keeps the last few activities of everyone, in memory: in
// the same words as an agent's activity log ("Coffee at Café 21", server/agent-life/activity.js), consecutive parts of
// one activity as one line. Nothing is stored: after a restart the feeds fill again as people live. Activities are
// planned a little ahead; one that has not begun yet is not shown.
import { classifyAct } from './agent-life/activity.js';
import { WEEKDAYS, formatClock, mod } from '../shared/constants.js';

export const KEEP = 12;   // lines kept per person (~5,000 residents: ~60,000 small records)

export class Recent {
  /** @param {object} sim the simulation (server/sim/sim.js) */
  constructor(sim) {
    this.sim = sim;
    this.by = new Map();   // person index → [{ kind, label, place, icon, t, end }], oldest first
    this.observer = (a, act) => this.observe(a, act);
    sim.actObservers.add(this.observer);
  }
  stop() { this.sim.actObservers.delete(this.observer); }
  observe(a, act) {
    if (!a.p || a.p.retired) return;
    const c = classifyAct(this.sim, a, act);
    if (!c) return;
    let list = this.by.get(a.i);
    if (!list) this.by.set(a.i, list = []);
    const last = list[list.length - 1];
    if (last && last.kind === c.kind && last.place === (c.place || null) && c.kind !== 'chat') { last.end = Math.max(last.end, act.holdEnd); return; }
    list.push({ kind: c.kind, label: c.label, place: c.place || null, icon: act.icon || '', t: act.holdStart, end: act.holdEnd });
    if (list.length > KEEP) list.shift();
  }
  /** Person i's recent activity, oldest first, the one going on now marked: [{ kind, label, place, icon, when, minutes, now }]. */
  of(i) {
    const sim = this.sim, B = sim.brain, now = sim.now(), scale = sim.clock.dayScale;
    const list = (this.by.get(i) || []).filter(r => r.t <= now);
    return list.map((r, k) => ({
      kind: r.kind, label: r.label, place: r.place, icon: r.icon,
      when: `${WEEKDAYS[mod(B.day(r.t), 7)]} ${formatClock(B.hour(r.t))}`,
      minutes: Math.max(0, Math.round((Math.min(r.end, now) - r.t) * scale / 60)), now: k === list.length - 1 && now < r.end,
    }));
  }
  /** A person who left the city (or a new one in their place) starts afresh. */
  forget(i) { this.by.delete(i); }
}
