// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The interaction registry set up for the server (docs/features/interactions.md): the context builder and the world's
// own sources — its body beside its owner (./sources/body.js), the furniture (./sources/furniture.js), the outdoor
// decorations with slots (./sources/decor.js: a bench on open land, a dock's picnic table), the signs within reach
// (./sources/signs.js: reading one), the city's places (./sources/places.js). Play modules add their own
// (interactions.add) where they are set up.
import { Interactions } from './registry.js';
import { makeContext } from './context.js';
import { bodySource } from './sources/body.js';
import { furnitureSource } from './sources/furniture.js';
import { decorSource } from './sources/decor.js';
import { signsSource } from './sources/signs.js';
import { placesSource } from './sources/places.js';

export { Interactions } from './registry.js';

/** o: { sim: () => Sim, companions: () => Companions, life: () => AgentLife, players, principalFor: account → principal,
 *  ownerOf: rec → account id, log }. */
export function createInteractions({ sim, companions = () => null, life = () => null, players = null, principalFor = () => null, ownerOf, log = null }) {
  const contextFor = makeContext({ sim, companions, life, players, ...(ownerOf ? { ownerOf } : {}) });
  const I = new Interactions({ log, contextFor });
  const econ = () => sim()?.econ || null;
  I.add(bodySource({ companions, principalFor }));
  I.add(furnitureSource({ econ, claimed: (it, where) => I.claimed(it, where), has: id => I.sources.has(id) }));
  I.add(decorSource());
  I.add(signsSource());
  // (a companion's quick errand — a bite, a coffee, the shop — and back to its owner: server/companions/ errand, as its owner)
  I.add(placesSource({ econ, errand: (ctx, go, via) => { const C = companions(), P = principalFor(ctx.owner); return C && P ? C.errand(P, ctx.rec, ctx.i, go, via) : { ok: false, text: 'Not now', brain: 'you could not go just now' }; } }));
  return I;
}
