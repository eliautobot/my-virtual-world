// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The decorations' interaction points (docs/features/interactions.md): every outdoor decoration whose catalog item has
// slots — a bench placed on open land, a picnic table on a lot, a fountain out in the country, a dock's own benches and
// picnic tables (shared/dock-layout.js dockDecor), any item with slots placed outdoors later — offered to an AI agent as
// a player finds them (client/js/player/player.js decorNear: walk up, E). The sim's index of them is
// server/sim/decor-seats.js (their slots in the world, their land's height, a seat in plain words, held by key).
//
// - An agent out with its owner (a companion: following them) — beside them: the decorations near its owner (WITH_M),
//   used with them (Brain.useWith with dec: it sits or uses it while they are near, then is back at their side). While
//   its owner sits, sitting is ./body.js's (down with them where they sit: their bench's other end — Brain.pickSeat
//   finds decorations' seats too).
// - An agent on its own: any of them near it (Brain order 'use' with decor: it walks there and sits or uses it for the
//   slot's own time). Open land sells nothing: it costs nothing, and a table's seat is only sat at (Brain.decorAct).
import { USES } from '../../../shared/catalog.js';
import { CTX_OUT } from '../../../shared/proto.js';
import { worthUsing, effectWords } from './furniture.js';

const NEAR_M = 18;        // m: decorations this close to an agent on its own (the furniture's)
const WITH_M = 10;        // m: this close to its owner, for a companion (Brain.useWith's USE_M)
const JOIN_M = 2.5;       // m: its owner this close to it is at it (joining them)

/** How one is at a seat in words: at a table, in an armchair, on a bench (the body source's and Free Will's own). */
const prep = w => (/\btable\b/.test(w) ? 'at' : /\b(armchair|sofa|couch)\b/.test(w) ? 'in' : 'on');

/** The decorations source. */
export function decorSource() {
  return {
    id: 'decor',
    kinds: Object.keys(USES),
    near(ctx) {
      const { sim, a, me, leader, now } = ctx, brain = sim.brain;
      if (!brain?.decorNear) return [];
      const withLead = !!(leader && !leader.gone && Number.isFinite(leader.x) && a.order?.kind === 'follow');
      if (withLead && (leader.car || a.ride)) return [];
      // (outdoors: the street, open land, a dock, a park's grounds — where a player walks up to them)
      const at = withLead ? leader : me;
      if (!brain.sameSpace(at.ctx, CTX_OUT)) return [];
      const reach = withLead ? WITH_M : NEAR_M, win = [now, now + brain.wm(20)], out = [];
      for (const e of brain.decorNear(at.x, at.z, reach + 3)) {
        const groups = new Map();
        for (const s of e.slots) {
          const act = brain.decorAct(s);
          if (!act || !worthUsing(act)) continue;
          if (withLead && leader.seat && s.seated) continue;   // (its owner sitting: down with them is ./body.js's)
          const g = `${s.use}>${act}`;
          (groups.get(g) || groups.set(g, { use: s.use, act, seated: s.seated, slots: [] }).get(g)).slots.push(s);
        }
        for (const { use, act, seated, slots } of groups.values()) {
          // (free for it: beside its owner held open-ended as a seat is; on its own, for the stay)
          const free = slots.filter(s => (withLead ? brain.decorFree(a, e.id, s.k) : !brain.decorTaken(e.id, s.k, a.i, win)))
            .sort((p, q) => Math.hypot(p.lx - at.x, p.lz - at.z) - Math.hypot(q.lx - at.x, q.lz - at.z));
          if (!free.length) continue;
          const s = free[0], d = Math.hypot(s.lx - me.x, s.lz - me.z), dl = withLead ? Math.hypot(s.lx - leader.x, s.lz - leader.z) : 0;
          if (withLead ? dl > WITH_M : d > NEAR_M) continue;
          const words = brain.decorWords(e), joining = withLead && !!leader.using && dl <= JOIN_M + 2;
          const what = seated ? `Sit down ${prep(words)} ${words}` : `${USES[act].label} — ${words}`;
          const label = `${what}${joining ? ` (with ${leader.name}, who is there)` : withLead ? ` (near ${leader.name})` : ''}`;
          out.push({ key: `${e.id}.${use}`, kind: act, label, where: { x: s.lx, z: s.lz, ctx: CTX_OUT, place: brain.decorPlace(e) }, cost: null,
            effects: { rate: USES[act].rate || null, once: USES[act].once || null, words: effectWords(act) }, withLeader: joining, d: Math.round(d),
            decor: { id: e.id, use, act, words, seated, dur: s.dur || null }, mode: withLead ? 'with' : 'own' });
        }
      }
      out.sort((x, y) => (y.withLeader ? 1 : 0) - (x.withLeader ? 1 : 0) || x.d - y.d);
      return out.slice(0, 12);
    },
    run(ctx, aff, params = {}) {
      const { sim, a, i, rec, leader } = ctx, brain = sim.brain, dc = aff.decor, label = USES[dc.act]?.label || 'Using it';
      const minutes = Number(params.minutes) > 0 ? Math.min(120, Number(params.minutes)) : dc.dur ? (dc.dur[0] + dc.dur[1]) / 2 : 15;
      const doing = dc.seated ? `sitting ${prep(dc.words)} ${dc.words}` : `${label.charAt(0).toLowerCase() + label.slice(1)} — ${dc.words}`;
      if (aff.mode === 'with') {
        const r = brain.useWith(a, { dec: dc.id, use: dc.use, minutes });
        if (!r.ok) {
          const why = { not_following: `you are not with ${leader?.name || 'anyone'} now`, riding: 'you are in a car', leader_gone: `${leader?.name || 'they'} left`, gone: 'it is not there any more',
            far: `it is too far from ${leader?.name || 'them'}`, full: 'every place at it is taken', taken: 'someone else just took it' }[r.why] || 'it was not possible just then';
          return { ok: false, text: `${rec.name} can't: ${why}`, brain: `you could not: ${why} — say so, don't pretend you did it` };
        }
        const soon = (r.arrive ?? 0) - sim.now() <= 10;
        return { ok: true, text: `${rec.name}: ${doing}${leader ? ` near ${leader.name}` : ''}`,
          brain: `you are ${soon ? '' : 'on your way to '}${doing}${leader ? `, near ${leader.name}` : ''} (for about ${Math.round(minutes)} min, then back at their side; you get up as soon as they walk off)`, effects: aff.effects };
      }
      const r = sim.order(i, { kind: 'use', decor: dc.id, use: dc.use, minutes, via: params.via || 'agent' });
      if (!r.ok) {
        const why = { nowhere: 'it is not there any more', not_possible: 'every place at it is taken just now', no_body: 'you have no body in the city right now' }[r.why] || 'it was not possible just then';
        return { ok: false, text: `${rec.name} can't: ${why}`, brain: `you could not: ${why} — say so, don't pretend you did it` };
      }
      const there = dc.seated ? `sit ${prep(dc.words)} ${dc.words}` : `${label.charAt(0).toLowerCase() + label.slice(1)} at ${dc.words}`;
      return { ok: true, text: `${rec.name} goes to ${there}`, brain: `you are on your way to ${there}, for about ${Math.round(minutes)} min (it costs nothing)`, effects: aff.effects };
    },
  };
}
