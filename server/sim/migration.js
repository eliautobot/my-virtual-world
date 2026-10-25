// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// People moving between towns (2026-10-23, the product owner: towns need "enough workplaces, enough homes, enough public
// services ... so now the city/towns become the macro management sim game"; "a town has too many businesses, and
// therefore there's a lot of homeless or agents are travelling to neighboring towns for homes"). What each town needs
// (server/town-needs.js) now moves its people, a few at a time by the world's clock:
//   - a resident who works in another town that has free homes moves there (people like to live where they work);
//   - a resident out of work in a town with too few open jobs moves to a town with open jobs and free homes, and looks
//     for work there;
//   - now and then a resident leaves a town that does much worse than another with free homes (its homes, jobs and
//     services: its overall score);
//   - newcomers (server/sim/housing.js) choose a town by its pull: how well it does, and its open jobs (population.js
//     reassign, through server/towns.js places().pull).
// Never an agent's resident, never one its flat's owner moved in (a tenant there). Off: Settings → Residents.
import { RNG } from '../../shared/rng.js';
import { worldSeconds } from '../../shared/constants.js';

const HOUR = 3600, DAY = 24 * HOUR;
export const MOVE_MAX = 12;                         // people moving between towns in one world hour, at most
const P_COMMUTER = 0.05, P_JOBLESS = 0.1, P_DRIFT = 0.01, DRIFT_GAP = 25;   // (a chance each world hour; overall points)

/** How strongly a town draws newcomers: how well it does (squared), and more if it has work for them. */
export function pullOf(t) {
  if (!t || !(t.freeBeds > 0)) return 0;
  const o = (t.scores?.overall ?? 50) / 100;
  return o * o + (t.freeJobs > t.unemployed ? 0.5 : 0) + 0.05;
}

/**
 * Who moves this world hour: { world, index, people, townOf: b → town, needs: { towns: [...] } (town-needs.js), flat(b, f,
 * u) → record, rng } → [{ i, b (an apartment building with a free bed there), seek (looks for work there), why }].
 */
export function planMoves({ world, index, people, townOf, needs, flat = () => null, rng, max = MOVE_MAX }) {
  const T = new Map((needs?.towns || []).map(t => [t.id, t]));
  if (T.size < 2) return [];
  // free beds by building, and the apartment buildings of each town that have some
  const used = new Set();
  for (const p of people) if (p && !p.retired && p.home?.bed) used.add(`${p.home.b}:${p.home.f}:${p.home.bed[0]}:${p.home.bed[1]}`);
  const free = new Map();   // town → [{ b, n }]
  for (const B of world.buildings || []) {
    if (!B || B.gone || B.type !== 'apartment') continue;
    let n = 0;
    for (let f = 1; f < B.floors; f++) {
      const lv = B.lv[f], L = world.levels[lv];
      for (let u = 0; u < (L?.units || []).length; u++) {
        const rec = flat(B.idx, f, u); if (rec && (rec.deal !== 'own' || rec.tenants?.length)) continue;   // (let, sold or assigned: its own)
        for (const id of index.unitItems(lv, u)) for (const s of index.slots(lv).get(id).slots) if (s.use === 'sleep' && !used.has(`${B.idx}:${f}:${id}:${s.k}`)) n++;
      }
    }
    if (n) { const t = townOf(B.idx); (free.get(t) || free.set(t, []).get(t)).push({ b: B.idx, n }); }
  }
  const room = t => (free.get(t) || []).reduce((a, x) => a + x.n, 0);
  const take = t => { const l = free.get(t) || []; const x = l.sort((a, b) => b.n - a.n)[0]; if (!x || !x.n) return -1; x.n--; return x.b; };
  const best = [...T.values()].filter(t => room(t.id) > 0);
  const out = [], moved = new Set();
  const order = people.map((p, i) => i).sort(() => rng.next() - 0.5);
  for (const i of order) {
    if (out.length >= max) break;
    const p = people[i];
    if (!p || p.retired || p.vip || p.agentId || !p.home || moved.has(i)) continue;
    const rec = flat(p.home.b, p.home.f, p.home.u ?? -1);
    if (rec?.tenants?.some(t => t.kind === 'person' && Number(t.id) === i)) continue;   // (moved in by its flat's owner)
    const ht = townOf(p.home.b), H = T.get(ht), j = p.job || {};
    const jt = j.b !== undefined && j.b >= 0 ? townOf(j.b) : null;
    let to = null, seek = false, why = '';
    if (jt && jt !== ht && room(jt) > 0 && rng.next() < P_COMMUTER) { to = jt; why = 'to live where it works'; }
    else if (j.kind === 'free' && (j.lost || j.seek || j.title === 'Between jobs') && H && H.freeJobs < H.unemployed && rng.next() < P_JOBLESS) {
      const t = best.filter(x => x.id !== ht && x.freeJobs > x.unemployed).sort((a, b) => (b.freeJobs - b.unemployed) - (a.freeJobs - a.unemployed))[0];
      if (t) { to = t.id; seek = true; why = 'for work'; }
    } else if (H && H.scores?.overall != null && rng.next() < P_DRIFT) {
      const t = best.filter(x => x.id !== ht && x.scores?.overall != null && x.scores.overall >= H.scores.overall + DRIFT_GAP).sort((a, b) => b.scores.overall - a.scores.overall)[0];
      if (t) { to = t.id; seek = !jt || jt !== t.id; why = 'for a better town'; }
    }
    if (!to) continue;
    const b = take(to); if (b < 0) continue;
    out.push({ i, b, from: ht, to, seek: seek && !(jt === to), why }); moved.add(i);
  }
  return out;
}

export class Migration {
  /**
   * @param {{ world: () => object, sim: () => object, editor: object, towns: object, needs: () => object, on: () => boolean,
   *   log?: object }} o — needs: what each town needs now (town-needs.js); editor.apply moves people (person.set)
   */
  constructor({ world, sim, editor, towns, needs, on, log = null }) {
    Object.assign(this, { worldOf: world, simOf: sim, editor, towns, needsOf: needs, onOf: on, log });
    this.last = null; this.day = null; this.today = new Map();   // town → { in, out } this world day
    this.pullCache = { at: 0, map: new Map() };
  }
  /** How strongly each town draws newcomers now (cached a minute): town → weight. */
  pulls() {
    if (Date.now() - this.pullCache.at > 60000) {
      try { const N = this.needsOf(); this.pullCache = { at: Date.now(), map: new Map((N?.towns || []).map(t => [t.id, pullOf(t)])) }; } catch { /* keep the last */ }
    }
    return this.pullCache.map;
  }
  /** Moved in and away today, by town: town → { in, out }. */
  moves() { return this.today; }
  /** One step by the world's clock: once a world hour, the people who move (planMoves) move. */
  step() {
    const sim = this.simOf();
    if (!sim?.clock || !this.onOf()) return null;
    const now = worldSeconds(sim.clock, sim.now());
    if (this.last === null || now < this.last) { this.last = now; return null; }
    if (now - this.last < HOUR) return null;
    this.last = now;
    const day = Math.floor(now / DAY);
    if (day !== this.day) { this.day = day; this.today = new Map(); }
    const W = this.worldOf(), bt = this.towns.buildingTowns(), needs = this.needsOf();
    const list = planMoves({ world: W, index: sim.index, people: sim.people, townOf: b => bt.get(b), needs, flat: (b, f, u) => W.flats?.[`${b}:${f}:${u}`] || null, rng: new RNG(`moves:${now}`) });
    if (!list.length) return [];
    const done = [];
    for (const m of list) {   // (one at a time: one that can't move doesn't stop the rest)
      try { this.editor.apply([{ op: 'person.set', i: m.i, home: { b: m.b }, ...(m.seek ? { job: 'auto' } : {}) }], { system: 'population', name: 'The city' }, { journal: false }); done.push(m); }
      catch (e) { this.log?.warn?.('[towns] a move between towns failed:', e.message); }
    }
    for (const m of done) {
      const a = this.today.get(m.to) || { in: 0, out: 0 }, b = this.today.get(m.from) || { in: 0, out: 0 };
      a.in++; b.out++; this.today.set(m.to, a); this.today.set(m.from, b);
    }
    if (done.length) this.log?.(`[towns] ${done.length} moved between towns (${[...new Set(done.map(m => m.why))].join(', ')})`);
    return done;
  }
}
