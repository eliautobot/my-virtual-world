// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How many people live in the city (2026-10-20, the product owner: "the population should be based on buildings, homes,
// businesses … not an arbitrary number"): its homes decide. The residents fill a share of the beds in its apartment
// buildings - "Homes filled" (Settings → Residents, world.homesFilled, in %) - and only homes bring people: offices,
// shops and restaurants bring jobs, which the residents take. The city settles towards that number by itself, both ways
// and a little at a time, by the world's clock (paused: nothing changes):
//   - fewer residents than that, and free beds: people move in, about 1/24 of the gap each world hour and at least one
//     (a new building is mostly full within a world day or two, not at once)
//   - more than that (the setting lowered, homes taken away): people move away the same way - first those without a
//     home, then those without work, then anyone; never an agent's resident
//   - a resident without a home for a whole world day moves away (when no free home turned up meanwhile)
// A new world starts with its homes already filled to that share (server/index.mjs). Moving in and away goes through the
// editor as the city itself (no undo entry, no activity line): the same homes, jobs and patches as any other change.
import { worldSeconds } from '../../shared/constants.js';

export const DEFAULT_HOMES_FILLED = 30;   // % of the beds
const STEP_MAX = 40;                      // people moving in or away in one step
const HOUR = 3600, DAY = 24 * HOUR;

/** The beds in the city's apartment buildings (its homes). */
export function bedsOf(world, index) {
  let beds = 0;
  for (const B of world.buildings || []) {
    if (!B || B.gone || B.type !== 'apartment') continue;
    for (const lv of B.lv || []) for (const e of index.slots(lv).values()) for (const s of e.slots) if (s.use === 'sleep') beds++;
  }
  return beds;
}
/** The residents the homes call for: the beds × the share (whole people). */
export const targetOf = (beds, pct) => Math.max(0, Math.round(beds * Math.max(0, Math.min(100, pct)) / 100));

export class Housing {
  /**
   * @param {{ world: () => object, sim: () => object, editor: object, pct: () => number, log?: object }} o
   *   editor.apply(ops, actor, { journal }) moves people in (person.add) and away (person.del)
   */
  constructor({ world, sim, editor, pct, log = null }) {
    Object.assign(this, { worldOf: world, simOf: sim, editor, pctOf: pct, log });
    this.last = null;          // world seconds at the last step
    this.carry = 0;            // a fraction of a person owed between steps
    this.dir = 0;              // which way the city was settling (1 moving in, -1 moving away)
    this.homeless = new Map(); // person id → world seconds when it was first seen without a home
    this.moved = { in: 0, away: 0 };
  }
  pct() { const v = Number(this.pctOf()); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_HOMES_FILLED; }
  /** The numbers as they are: { beds, pct, target, residents, housed, homeless, agents, movedIn, movedAway }. */
  status() {
    const W = this.worldOf(), sim = this.simOf();
    const beds = bedsOf(W, sim.index), pct = this.pct();
    let residents = 0, housed = 0, homeless = 0, agents = 0;
    for (const p of sim.people) {
      if (!p || p.retired) continue;
      residents++;
      if (p.agentId || p.vip) agents++;
      if (p.home) housed++; else homeless++;
    }
    return { beds, pct, target: targetOf(beds, pct), residents, housed, homeless, agents, movedIn: this.moved.in, movedAway: this.moved.away };
  }
  /** One step by the world's clock (call it often: it does what the world time since the last step calls for). */
  step() {
    const sim = this.simOf();
    if (!sim?.clock) return null;
    const now = worldSeconds(sim.clock, sim.now());
    if (this.last === null || now < this.last) { this.last = now; return null; }
    const dt = now - this.last;
    if (dt < 60) return null;   // (less than a world minute: nothing yet)
    this.last = now;
    const s = this.status(), out = { in: 0, away: 0 };
    // people without a home: how long; a whole world day and none turned up → they move away
    const leave = [];
    sim.people.forEach((p, i) => {
      if (!p || p.retired || p.agentId || p.vip) { if (p) this.homeless.delete(p.id); return; }
      if (p.home) { this.homeless.delete(p.id); return; }
      const since = this.homeless.get(p.id);
      if (since === undefined) this.homeless.set(p.id, now);
      else if (now - since >= DAY) leave.push(i);
    });
    // towards the target: 1/24 of the gap each world hour, at least one person a world hour while there is a gap
    // (what is owed carries over between steps - never more than the gap, and not into the other direction)
    const gap = s.target - s.residents, dir = Math.sign(gap);
    if (dir !== this.dir) { this.carry = 0; this.dir = dir; }
    if (dir) this.carry = Math.min(Math.abs(gap), this.carry + Math.max(Math.abs(gap) * Math.min(1, dt / DAY), Math.min(dt, DAY) / HOUR));
    let n = Math.min(STEP_MAX, Math.abs(gap), Math.floor(this.carry));
    if (gap > 0) n = Math.min(n, Math.max(0, s.beds - s.housed));   // (only into free beds)
    this.carry -= n;
    if (gap > 0 && n > 0) out.in = this.moveIn(n);
    if (gap < 0 && n > 0) leave.push(...this.toLeave(n, new Set(leave)));
    if (leave.length) out.away = this.moveAway([...new Set(leave)].slice(0, STEP_MAX));
    this.moved.in += out.in; this.moved.away += out.away;
    return out;
  }
  moveIn(n) {
    const r = this.editor.apply(Array.from({ length: n }, () => ({ op: 'person.add' })), { system: 'population', name: 'The city' }, { journal: false });
    return r.results.length;
  }
  /** Who moves away first: no home, then no work, then anyone (never an agent's resident); the newest first among equals. */
  toLeave(n, already) {
    const sim = this.simOf(), rank = p => (!p.home ? 0 : p.job?.kind === 'free' ? 1 : 2), list = [];
    sim.people.forEach((p, i) => { if (p && !p.retired && !p.agentId && !p.vip && !already.has(i)) list.push(i); });
    list.sort((a, b) => rank(sim.people[a]) - rank(sim.people[b]) || b - a);
    return list.slice(0, n);
  }
  moveAway(list) {
    const r = this.editor.apply(list.map(i => ({ op: 'person.del', i })), { system: 'population', name: 'The city' }, { journal: false });
    for (const i of list) this.homeless.delete(this.simOf().people[i]?.id);
    return r.results.length;
  }
}
