// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The furniture's interaction points (docs/features/interactions.md): every piece the world declares with slots
// (shared/catalog.js: its slots and their use — an arcade cabinet, the pool table, the piano, the dance floor, a bench, a
// treadmill, a shop's shelves and checkout …), today's and any added later, offered to an AI agent as a player would find
// them: where it may be (a public place, a park, its own home's rooms, its workplace), near it, free now, and what using
// it does for it (shared/catalog.js USES: its needs, a rate or once). Not offered: a post's slots (a job: server/agent-
// posts/), and what does nothing for it (paying at a counter alone, filing). Not here: eating — a meal is ordered at a
// table (its venue's service: ./places.js; beside its owner: ./body.js), never sat at without food.
//
// - An agent out with its owner (a companion: following them) — beside them: the pieces near its owner in their space,
//   used with them (Brain.useWith: it keeps at it while they are near, then is back at their side); seats are ./body.js's
//   (sitting down with them). Joining what its owner does there first (withLeader: they are at that piece or the next).
// - An agent on its own: any of them near it (Brain order 'use': it walks there and uses it for the slot's own time, as
//   a resident's visit there — the economy bills what one pays for there: an arcade's tokens, a gym's session).
import { USES } from '../../../shared/catalog.js';
import { ctxB, ctxF, ctxOf } from '../../../shared/constants.js';
import { CTX_OUT } from '../../../shared/proto.js';
import { toWorld } from '../../../shared/geom.js';
import { POST_USES } from '../../sim/population.js';
import { vc } from '../../economy/ledger.js';
import { versusOf } from '../../../shared/versus.js';

const NEAR_M = 18;        // m: pieces this close to an agent on its own
const WITH_M = 10;        // m: pieces this close to its owner, for a companion (Brain.useWith's USE_M)
const JOIN_M = 2.5;       // m: its owner this close to a piece is at it (joining them)
const SIT_USES = new Set(['bench', 'relax', 'chat', 'meeting']);   // (sitting down beside its owner: ./body.js)
const NOT_HERE = new Set(['eat']);   // (a meal is ordered at a table: never sat at without food)

/** Whether using a slot of this use does something for an agent (a need rises), and isn't a post's. */
export function worthUsing(use) {
  const u = USES[use];
  if (!u || POST_USES.has(use) || NOT_HERE.has(use)) return false;
  return [...Object.values(u.rate || {}), ...Object.values(u.once || {})].some(v => v > 0);
}
/** What using it does for its needs, in words ("fun ↑, social ↑"). */
export function effectWords(use) {
  const u = USES[use] || {}, up = [];
  for (const [k, v] of Object.entries({ ...(u.rate || {}), ...(u.once || {}) })) if (v > 0) up.push(k);
  return up.length ? `${up.join(', ')} up` : '';
}

/** The floor a body at (x, z) on ctx is on, to look round: { b, f, park } or null (the street, away from a park). */
export function spaceAt(brain, x, z, ctx) {
  if (ctx >= 0) return { b: ctxB(ctx), f: ctxF(ctx), park: brain.parkCtx?.(ctx) || false };
  if (ctx === CTX_OUT) { const B = brain.parkAt?.(x, z); return B ? { b: B.idx, f: 0, park: true } : null; }
  return null;
}

/** The pieces on floor sp ({ b, f, park }) an agent with person p may use: all of a public place's or a park's, its own
 *  home's (its flat's, not the neighbours'), its workplace's — Map id → { it, slots }, or null. */
export function piecesOn(brain, p, sp) {
  const B = brain.W.buildings[sp.b];
  if (!B || B.gone || sp.f < 0 || sp.f >= B.floors) return null;
  const m = brain.index.slots(B.lv[sp.f]);
  if (sp.park || brain.index.isPublicFloor(sp.b, sp.f)) return m;
  if (p.home && p.home.b === sp.b && p.home.f === sp.f) { const mine = new Set(brain.index.unitItems(B.lv[sp.f], p.home.u)); return new Map([...m].filter(([id]) => mine.has(id))); }
  if (p.job && p.job.b === sp.b && p.job.f === sp.f) return m;
  return null;
}

/**
 * The furniture source. o: { econ: () => households (sim.econ) | null, claimed: (item) → true when another source
 * carries that piece (an arcade machine that plays a game: server/play/arcade-crew.js — one honest way to use it, the
 * game itself, not a plain 'play' beside it), has: id → whether the registry has that source }.
 */
export function furnitureSource({ econ = () => null, claimed = () => false, has = () => false } = {}) {
  return {
    id: 'furniture',
    kinds: Object.keys(USES),
    near(ctx) {
      const { sim, a, p, me, leader, now } = ctx, brain = sim.brain, H = econ();
      const withLead = !!(leader && !leader.gone && Number.isFinite(leader.x) && a.order?.kind === 'follow');
      if (withLead && (leader.car || a.ride)) return [];
      const at = withLead ? leader : me, sp = spaceAt(brain, at.x, at.z, at.ctx);
      if (!sp) return [];
      const pieces = piecesOn(brain, p, sp);
      if (!pieces) return [];
      const B = brain.W.buildings[sp.b], ctxHere = ctxOf(sp.b, sp.f), L = brain.W.levels[B.lv[sp.f]];
      const vkind = L?.venue || (B.type === 'park' ? 'park' : null), win = [now, now + brain.wm(20)];
      const out = [];
      for (const [id, e] of pieces) {
        let mine = false;
        try { mine = !!claimed(e.it, { b: sp.b, f: sp.f, id }); } catch { mine = false; }
        if (mine) continue;
        const byUse = new Map();
        for (const s of e.slots) {
          if (!worthUsing(s.use) || (withLead && SIT_USES.has(s.use))) continue;
          (byUse.get(s.use) || byUse.set(s.use, []).get(s.use)).push(s);
        }
        for (const [use, slots] of byUse) {
          // (free for it: beside its owner held open-ended as a seat is — Brain.seatFree —; on its own, for the stay)
          const free = slots.filter(s => (withLead ? brain.seatFree(a, sp.b, sp.f, id, s.k) : !brain.taken(sp.b, sp.f, id, s.k, a.i, win)));
          if (!free.length) continue;
          const w = toWorld(B, free[0].lx, free[0].lz), d = Math.hypot(w.x - me.x, w.z - me.z);
          const dl = withLead ? Math.hypot(w.x - leader.x, w.z - leader.z) : 0;
          if (withLead ? dl > WITH_M : d > NEAR_M) continue;   // (its own space's, or its owner's: where `sp` was found)
          const info = brain.seatInfo(sp.b, sp.f, id, free[0].k);
          if (!info) continue;
          const joining = withLead && leader.using && slots.some(s => { const q = toWorld(B, s.lx, s.lz); return Math.hypot(q.x - leader.x, q.z - leader.z) <= JOIN_M + 1; }) && dl <= JOIN_M + 2;
          if (joining && versusOf(e.it?.t) && has('versus')) continue;   // (its owner at a table for two: playing them there is the versus source's — server/play/versus.js)
          // (what it costs: the economy's own quote for a visit's act there — an arcade's tokens, a gym's session)
          let cost = null;
          try { const q = H?.quote?.(a, { kind: vkind || 'visit', use, b: sp.b, f: sp.f, holdStart: now }); if (q && q.total) cost = q.total; } catch { cost = null; }
          if (withLead && vkind !== 'arcade' && vkind !== 'gym') cost = null;   // (beside its owner only those bill: Brain.useWith)
          const label = `${USES[use].label} — ${info.words}${joining ? ` (with ${leader.name}, who is there)` : withLead ? ` (near ${leader.name})` : ''}${cost ? ` (about ${vc(cost)})` : ''}`;
          out.push({ key: `${sp.b}.${sp.f}.${id}.${use}`, kind: use, label, where: { x: w.x, z: w.z, ctx: ctxHere, place: info.venue?.name || brain.placeName(sp.b, sp.f) },
            cost, effects: { rate: USES[use].rate || null, once: USES[use].once || null, words: effectWords(use) }, withLeader: joining, d: Math.round(d),
            piece: { b: sp.b, f: sp.f, id, use, words: info.words, dur: free[0].dur || null }, mode: withLead ? 'with' : 'own' });
        }
      }
      out.sort((x, y) => (y.withLeader ? 1 : 0) - (x.withLeader ? 1 : 0) || x.d - y.d);
      return out.slice(0, 16);
    },
    run(ctx, aff, params = {}) {
      const { sim, a, i, rec, leader } = ctx, brain = sim.brain, pc = aff.piece, label = USES[pc.use]?.label || 'Using it';
      const minutes = Number(params.minutes) > 0 ? Math.min(120, Number(params.minutes)) : pc.dur ? (pc.dur[0] + pc.dur[1]) / 2 : 15;
      const doing = label.charAt(0).toLowerCase() + label.slice(1);
      if (aff.mode === 'with') {
        const r = brain.useWith(a, { b: pc.b, f: pc.f, id: pc.id, use: pc.use, minutes });
        if (!r.ok) {
          const why = { not_following: `you are not with ${leader?.name || 'anyone'} now`, riding: 'you are in a car', leader_gone: `${leader?.name || 'they'} left`, gone: 'it is not there any more',
            far: `it is too far from ${leader?.name || 'them'}`, full: 'every place at it is taken', taken: 'someone else just took it', money: 'you have too little money for it', limits: 'your owner\'s spending limits don\'t allow it' }[r.why] || 'it was not possible just then';
          return { ok: false, text: `${rec.name} can't: ${why}`, brain: `you could not: ${why} — say so, don't pretend you did it` };
        }
        const paid = r.paid ? `, ${vc(r.paid.total)} from your own money` : '';
        return { ok: true, text: `${rec.name}: ${doing} — ${pc.words}${leader ? ` near ${leader.name}` : ''}`, brain: `you are ${doing} — ${pc.words}${leader ? `, near ${leader.name}` : ''} (for about ${Math.round(minutes)} min, then back at their side; you stop as soon as they walk off)${paid}`, effects: aff.effects };
      }
      const B = brain.W.buildings[pc.b], r = sim.order(i, { kind: 'use', venue: { b: pc.b, f: pc.f, x: B?.x ?? 0, z: B?.z ?? 0 }, piece: pc.id, use: pc.use, minutes, via: params.via || 'agent' });
      if (!r.ok) {
        const why = { no_money: 'it costs money and you have too little', nowhere: 'it is not there any more', not_possible: 'every place at it is taken just now', no_body: 'you have no body in the city right now' }[r.why] || 'it was not possible just then';
        return { ok: false, text: `${rec.name} can't: ${why}`, brain: `you could not: ${why} — say so, don't pretend you did it` };
      }
      const cost = aff.cost ? ' (what it costs there is paid from your own money)' : '';   // (the bill is the visit's own, when it gets there)
      return { ok: true, text: `${rec.name} is off to ${pc.words}: ${doing}`, brain: `you are on your way to ${pc.words}, ${doing} there for about ${Math.round(minutes)} min${cost}`, effects: aff.effects };
    },
  };
}
