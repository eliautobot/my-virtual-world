// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Sights — what a body can see around it besides people and animals (docs/features/awareness.md §4): the cars near it
// (parked, driving by, one on its side or upside down after a crash, who was driving it) and the island's water in view
// (a waterfall, a lake, a river). 2026-11-18, the product owner: his companions "couldn't see" the car that had just flipped over beside
// them, nor the waterfall in front of them — their senses named people and animals only.
//
// One registry, like the activities (./activities.js): a provider { id, of(c) } where c = { env, w (whereOf: the body's
// place, x, z, ctx, yaw, outside, car), facing, nameOf (account → a player's name) } returns [{ words, d }] (d: metres, for
// the order) or nothing. A new module adds its own (a landmark, a module's attraction); nothing else changes.
import { VEHICLE_KINDS } from '../../shared/vehicle-specs.js';
import { sideOf, metres } from './where.js';

export const SIGHTS_MAX = 6;   // things in view told at most, nearest first
export const CAR_M = 45;       // cars this close are in view
export const FALLS_M = 600;    // a waterfall: seen and heard from afar
export const LAKE_M = 250;
export const RIVER_M = 60;

const an = w => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;

export class Sights {
  constructor({ log = null } = {}) { this.log = log; this.list = []; }
  add(p) {
    if (!p || typeof p.id !== 'string' || typeof p.of !== 'function') throw new Error('a sight needs an id and of()');
    this.list = this.list.filter(x => x.id !== p.id).concat(p);
    return () => { this.list = this.list.filter(x => x !== p); };
  }
  /** What is in view for c, nearest first: [{ id, words, d }]. */
  of(c) {
    const out = [];
    for (const p of this.list) {
      let got = null;
      try { got = p.of(c); } catch (e) { this.log?.warn?.(`[senses] the ${p.id} sight failed:`, e.message); }
      for (const s of Array.isArray(got) ? got : []) if (s && s.words) out.push({ id: p.id, words: String(s.words).slice(0, 200), d: Number.isFinite(s.d) ? s.d : 1e9 });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, SIGHTS_MAX);
  }
}

/** How upright a car stands (its rotation's up axis, y): 1 on its wheels, 0 on its side, −1 on its roof. */
export function uprightOf(q) {
  if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z)) return 1;
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

/** The cars near it (not the one it is riding in: its place says so). */
export const carSights = {
  id: 'cars',
  of({ env, w, facing, nameOf }) {
    const V = env.vehicles;
    if (!V?.all || !w || w.transit || !(w.ctx < 0 || w.outside)) return [];
    const out = [];
    for (const c of V.all.values()) {
      if (!c || (w.car && w.car.id === c.id) || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
      const d = Math.hypot(c.x - w.x, c.z - w.z);
      if (d > CAR_M) continue;
      const kind = VEHICLE_KINDS[c.k]?.n || 'car', up = uprightOf(c.rotation), speed = Math.abs(Number(c.v) || 0);
      const driver = c.driver ? nameOf(c.driver) : '', was = !c.driver && c.lastDriver ? nameOf(c.lastDriver) : '';
      const state = up < -0.3 ? 'upside down on its roof — it has crashed' : up < 0.55 ? 'on its side — it has rolled over' : driver ? (speed > 1 ? `${driver} driving it` : `${driver} at the wheel, stopped`) : speed > 1 ? 'rolling' : 'parked';
      out.push({ d, words: `${an(kind)}${was ? ` (${was} was driving it)` : ''} — ${state}, ${metres(d)}${d >= 1.5 ? `, ${sideOf(facing, c.x - w.x, c.z - w.z)}` : ''}` });
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 3);
  },
};

/** The island's water in view: a waterfall (seen from afar), a lake, a river — from the land as it is (the rivers traced,
 *  the lakes and the falls' plunge pools: the wildlife's haunts, which follow the land when it changes). */
export function waterSights(wildlife) {
  return {
    id: 'water',
    of({ w, facing }) {
      const W = wildlife?.();
      if (!W || !w || !w.outside || w.transit || w.car?.riding) return [];
      let H = null;
      try { const I = W.island?.(); H = I ? W.haunts?.(I) : null; } catch { H = null; }
      if (!H?.near) return [];
      const out = [], at = (f, what) => {
        const d = Math.max(0, f.d);
        out.push({ d, words: `${what} — ${d < 3 ? 'right here' : metres(d)}${d >= 3 ? `, ${sideOf(facing, f.x - w.x, f.z - w.z)}` : ''}` });
      };
      const falls = H.near('falls', w.x, w.z, FALLS_M), lake = H.near('lake', w.x, w.z, LAKE_M), river = H.near('river', w.x, w.z, RIVER_M);
      if (falls) at(falls, 'a waterfall');
      if (lake) at(lake, 'a lake');
      if (river) at(river, 'the river');
      return out;
    },
  };
}
