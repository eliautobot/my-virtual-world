// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where an AI agent is and who it is with, for the interaction registry (./registry.js): what its sources look round.
//   ctx = { rec (the agent's record), i (its body), a (its sim agent), p (its person), sim, now (sim time),
//           me: { x, z, ctx } (where its body is now: a building's floor, or outdoors),
//           leader: null | { kind: 'player' | 'person', account?, i?, name, x, z, ctx, seat (Brain.seatAt's: they are sitting
//                   on it), using (a player at some furniture: PF_USING), car (in a vehicle), boat (a player's boat id), gone },
//           companion: its companion view (server/companions/ view) or null, owner (its owner's account id) }
import { evalPlan } from '../sim/plan.js';
import { CTX_OUT, CTX_UNDER } from '../../shared/proto.js';
import { PF_USING, PF_OBSERVING } from '../../shared/playerproto.js';

/** The context builder: contextFor(rec) → ctx, or null (no body in the city now). */
export function makeContext({ sim, companions = () => null, life = () => null, players = null, ownerOf = rec => rec?.ownerId ?? null }) {
  return function contextFor(rec) {
    const S = sim(), L = life();
    if (!S || !L || !rec) return null;
    const i = L.byAgent?.get(rec.id), a = Number.isInteger(i) ? S.agents[i] : null, p = Number.isInteger(i) ? S.people[i] : null;
    if (!a?.plan || !p || p.retired) return null;
    const now = S.now(), e = evalPlan(a.plan, now);
    const me = { x: e.x, z: e.z, ctx: e.ctx === CTX_UNDER ? CTX_OUT : e.ctx };
    const C = companions();
    let companion = null, leader = null;
    try { companion = a.order && C ? C.view(a) : null; } catch { companion = null; }
    const o = a.order;
    if (o?.kind === 'follow' && o.lead) {
      if (o.lead.kind === 'player') {
        const pl = players?.byId?.get(o.lead.id);
        if (pl) leader = { kind: 'player', account: o.lead.id, name: pl.name || companion?.leader?.name || 'your owner', x: pl.x, z: pl.z, ctx: pl.ctx,
          seat: C?.leaderSeat?.(o.lead.id) || null, using: !!(pl.flags & PF_USING), observing: !!(pl.flags & PF_OBSERVING), car: pl.vehicleId || null, boat: pl.boatId || null, gone: false };
        else leader = { kind: 'player', account: o.lead.id, name: companion?.leader?.name || 'your owner', gone: true };
      } else if (o.lead.kind === 'person' && Number.isInteger(o.lead.i)) {
        const t = S.agents[o.lead.i], le = t?.plan ? evalPlan(t.plan, now) : null;
        if (le) leader = { kind: 'person', i: o.lead.i, name: S.people[o.lead.i]?.name || '', x: le.x, z: le.z, ctx: le.ctx === CTX_UNDER ? CTX_OUT : le.ctx,
          seat: S.brain.leaderSeatOf?.(o, now) || null, using: false, car: null, gone: false };
      }
    }
    return { rec, i, a, p, sim: S, now, me, leader, companion, owner: ownerOf(rec) };
  };
}
