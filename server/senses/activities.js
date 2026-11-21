// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Activities — what is in hand (docs/features/awareness.md §5): a few lines about the activity a body or a player is in
// right now, so an agent with its owner knows what they are doing together (fishing: the spot, what is on the line, what
// was caught; flying: climbing, at what height; a car: who drives, where to) and nothing about the rest of the map.
//
// One registry. A provider: { id, of(c) } where c = { env, i (a body, or -1), account (a player's account id, an agent
// playing as −its id, or null), who (how to name them: 'you' or a name), self (the agent itself), now } and of() returns
// { title, lines: [...] } or null (not doing it). Providers are asked only when an agent's brain is about to be asked
// (never on a timer); a provider that fails is left out. A new module or job adds its own; nothing else changes.
import { AIRCRAFT } from '../../shared/aircraft-specs.js';
import { VEHICLE_KINDS } from '../../shared/vehicle-specs.js';
import { compass, clean, q } from './where.js';
import { evalPlan } from '../sim/plan.js';
import { mealOf, foodWords, foodPlaceAt } from './meals.js';
import { PF_USING } from '../../shared/playerproto.js';

export const MAX_LINES = 4;      // lines one card may give
export const TITLE_MAX = 120;    // characters a card's title may have
/** A card's own words, one line: kept as written («» too — names in them are quoted by q()), no control characters. */
const line = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const kmh = v => Math.round(Math.abs(Number(v) || 0) * 3.6);

export class Activities {
  constructor({ log = null } = {}) { this.log = log; this.list = []; }
  /** Adds a provider (replacing one with the same id). Returns a function that removes it. */
  add(p) {
    if (!p || typeof p.id !== 'string' || typeof p.of !== 'function') throw new Error('an activity needs an id and of()');
    this.list = this.list.filter(x => x.id !== p.id).concat(p);
    return () => { this.list = this.list.filter(x => x !== p); };
  }
  /** The cards for c, in the order the providers were added. */
  cards(c) {
    const out = [];
    for (const p of this.list) {
      let card = null;
      try { card = p.of(c); } catch (e) { this.log?.warn?.(`[senses] the ${p.id} activity failed:`, e.message); }
      if (!card || !card.title) continue;
      const lines = (Array.isArray(card.lines) ? card.lines : []).map(l => line(l, 200)).filter(Boolean).slice(0, MAX_LINES);
      out.push({ id: p.id, title: line(card.title, TITLE_MAX), lines });
    }
    return out;
  }
}

/** A player driving a car (the writer, together with its agent): the car, who rides with them, the street, the way. */
export const drivingActivity = {
  id: 'driving',
  of({ env, account, who, self }) {
    if (self || account == null || account < 0) return null;
    const p = env.players?.byId?.get(account), V = env.vehicles;
    if (!p?.vehicleId || !V) return null;
    const c = V.all?.get(p.vehicleId);
    if (!c) return null;
    const kind = VEHICLE_KINDS[c.k]?.n || 'car', speed = kmh(Math.hypot(Number(c.vx) || 0, Number(c.vz) || 0) || c.v);
    let street = ''; try { street = env.sim?.nav?.addressAt?.(c.x, c.z) || ''; } catch { /* no address */ }
    const riders = (V.seats?.of(c.id) || []).map(r => (r.kind === 'resident' ? clean(env.sim?.people?.[r.id]?.name, 40) : '')).filter(Boolean);
    return { title: `${who} driving a ${kind}`, lines: [
      speed >= 3 ? `${street ? `along ${q(street)}, ` : ''}heading ${compass(Number(c.vx) || 0, Number(c.vz) || 0)} at about ${speed} km/h` : `stopped${street ? ` at ${q(street)}` : ''}`,
      riders.length ? `in the car with ${who === 'you' ? 'you' : who}: ${riders.join(', ')}` : '',
    ] };
  },
};

/** A player flying one of the airport's aircraft: what, the phase of the flight, the height above the ground, the speed. */
export const flyingActivity = {
  id: 'flying',
  of({ env, account, who, self }) {
    if (self || account == null || account < 0) return null;
    const F = env.fleet, a = F?.byPilot?.get(account);
    if (!a || !a.pose) return null;
    const spec = AIRCRAFT[a.type] || {}, P = a.pose, v = Number(P.v) || 0;
    let ground = 0; try { ground = Number(F.groundAt?.(P.x, P.z)) || 0; } catch { ground = 0; }
    const h = Math.max(0, Math.round((Number(P.y) || 0) - ground - (spec.gearH || 0)));
    // (the phase from what the pose says, and the climb since the last look: env.track keeps the last height a moment)
    const climb = env.track ? env.track(`air:${account}`, P.y) : 0;
    const phase = P.g ? (v < 2 ? 'on the ground, stopped' : v < (spec.rotate || 25) * 0.8 ? 'taxiing on the ground' : 'taking off down the runway')
      : h < 60 && climb < -0.5 ? 'coming in to land' : climb > 1 ? 'climbing' : climb < -1 ? 'descending' : 'flying level';
    return { title: `${who} flying a ${String(spec.label || 'plane').toLowerCase()}`, lines: [
      `${phase}${P.g ? '' : `, about ${h} m above the ground`}, ${kmh(v)} km/h`,
    ] };
  },
};

/** A player out on a boat from a fishing dock. */
export const boatingActivity = {
  id: 'boating',
  of({ env, account, who, self }) {
    if (self || account == null || account < 0) return null;
    const H = env.harbour, b = H?.bySkipper?.get(account);
    if (!b) return null;
    const P = b.pose || {}, v = Number(P.v) || 0;
    return { title: `${who} out on a boat`, lines: [v > 0.5 ? `under way at about ${kmh(v)} km/h` : 'stopped on the water'] };
  },
};

/** An agent's own work right now (server/workplace/presence.js): on duty, late, away — and who is there with it. */
export const workActivity = {
  id: 'work',
  of({ env, i, self }) {
    if (!self || !(i >= 0)) return null;
    const w = env.work?.workOf?.(i);
    if (!w || !w.onShift) return null;
    const team = (w.team || []).slice(0, 6).map(x => `${clean(x.name, 40)} (${clean(x.role, 30)}): ${String(x.text || '').toLowerCase()}`);
    return { title: `At work: ${clean(w.role, 40)} at ${q(w.place, 60)}`, lines: [
      `you are ${String(w.text || '').replace(/^On duty$/, 'on duty').toLowerCase()} (${w.hours})`,
      team.length ? `co-workers on this shift: ${team.join('; ')}` : '',
    ] };
  },
};

/**
 * An agent's own food and drink (./meals.js): what the city really served it — eating it, ordered and on its way to the
 * table, at the counter, finished — or, in a place that serves food, that it has nothing at all. Its brain says what it
 * eats from this, never from what it meant to order (2026-11-18: "a croissant" with nothing on the table).
 */
export const mealActivity = {
  id: 'meal',
  of({ env, i, self, now }) {
    if (!self || !(i >= 0)) return null;
    const sim = env.sim, a = sim?.agents?.[i];
    if (!a?.plan) return null;
    const t = Number.isFinite(now) ? now : sim.now();
    const m = mealOf(a, t), title = 'Your food and drink';
    if (m) {
      const what = foodWords(m.items), at = m.place ? ` at ${q(m.place, 60)}` : '';
      const paid = Number.isFinite(m.paid) && m.paid > 0 ? ` (you paid ${(m.paid / 100).toFixed(2)} VC)` : '';
      return { title, lines: [m.state === 'eating' ? `you are eating ${what}${at}${paid} — that is all that is in front of you`
        : m.state === 'coming' ? `you ordered ${what}${at}; you are on your way to your seat — not eating yet`
          : m.state === 'ordering' ? `you are buying ${what}${at}`
            : `you finished your ${what}${at}; nothing is in front of you now`] };
    }
    // (nothing: said only where food is served — where it would otherwise be guessed at)
    const e = evalPlan(a.plan, t);
    if (!foodPlaceAt(sim.world, e.ctx)) return null;
    return { title, lines: ['nothing — no food or drink in front of you: you have not ordered anything here (to eat or drink something, use the tool eat_with: it orders it and pays)'] };
  },
};

/** The writer's meal, together with its agent (server/world/players.js serveMeal): what is in front of them at their seat. */
export const writerMealActivity = {
  id: 'writer-meal',
  of({ env, account, who, self }) {
    if (self || account == null || account < 0) return null;
    const p = env.players?.byId?.get(account), m = p && (p.flags & PF_USING) ? env.players.mealOf?.(p) : null;
    if (!m?.ids?.length) return null;
    return { title: `${who}'s food and drink`, lines: [`${who} is having ${foodWords(m.ids)} at their table — what they ordered`] };
  },
};

export const BUILT_IN = [drivingActivity, flyingActivity, boatingActivity, workActivity, mealActivity, writerMealActivity];
