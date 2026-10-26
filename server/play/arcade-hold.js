// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A machine game or a cabinet holds its whole machine while it is open (2026-10-26, the product owner: "While playing arcade
// games like the pool, agents come up to the table and play ... make sure this doesnt happen"): POST /api/arcade/hold
// { b, f, id, on } (the sim: server/sim/agents.js holdPiece). The game (client/js/play/machine-play.js, arcade.js) holds it
// as it opens, again every 30 s, and lets it go as it closes; a hold lapses 75 s after the last. One machine per account;
// a machine another player holds is busy; only arcade machines (a machine with a game, or a cabinet).
import { machineGame } from '../../shared/arcade/catalog.js';
import { CATALOG } from '../../shared/catalog.js';

export const HOLD_MS = 75000;

/** @param o { sim() → the Sim (its brain), world() → the world } */
export function addArcadeHoldRoutes(router, { sim, world }) {
  const holds = new Map();   // account id → 'b:f:id'
  router.add({ method: 'POST', path: '/api/arcade/hold', cap: 'play.use', handler: ({ body, P }) => {
    const brain = sim()?.brain, W = world(), me = P.account.id;
    const b = Number(body?.b), f = Number(body?.f ?? 0), id = Number(body?.id), key = `${b}:${f}:${id}`;
    const prev = holds.get(me);
    if (prev && (prev !== key || body?.on === false)) { const [pb, pf, pid] = prev.split(':').map(Number); brain?.releasePiece(pb, pf, pid); holds.delete(me); }
    if (body?.on === false || !brain) return { status: 200, json: { ok: true, held: false } };
    const B = [b, f, id].every(Number.isInteger) ? W.buildings[b] : null, t = B && !B.gone ? W.levels[B.lv?.[f]]?.items?.find(x => x.id === id)?.t : null;
    if (!t || !(machineGame(t) || CATALOG[t]?.arcade) || !brain.index.entry(b, f, id)) return { status: 400, json: { error: 'not_a_machine', message: 'That is not an arcade machine' } };
    for (const [acc, k] of holds) if (k === key && acc !== me && brain.pieceHeld(b, f, id)) return { status: 200, json: { ok: true, held: false, busy: true } };
    const sent = brain.holdPiece(b, f, id, HOLD_MS); holds.set(me, key);
    return { status: 200, json: { ok: true, held: true, sent } };
  } });
}
