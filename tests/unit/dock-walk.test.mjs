// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Walking on a dock's decks (server/sim/dock-walk.js): someone out on a marina's or a lake dock's pier, float or finger is
// reached by the dock's own way — to its quay on land, then down its decks — never by the city's (which stops at the
// water: companions "ran the opposite way, as if they lost my location", 2026-11-17); from one point on a dock to
// another, up its way only as far as the two ways meet; off a dock, up to its quay first. Every point of the way is on a
// deck (or the quay), with the deck's height.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCKS, dockDecks, deckTop } from '../../shared/dock-layout.js';
import { toWorldAt, toFrame } from '../../shared/airport-layout.js';
import { deckAt, dockWay, dockRoute } from '../../server/sim/dock-walk.js';

const onDeck = (m, p) => dockDecks(m).some(D => deckTop(D, p.x, p.z, 0.35) !== null) || Math.abs(toFrame(m, p.x, p.z).s - 1.5) < 0.6;

for (const kind of ['marina', 'lakedock']) {
  test(`${kind}: on to the dock, along it, and off it again by its own way`, () => {
    const m = { id: 'wmX', kind, x: 100, z: -40, rot: 0.6, y: 1.5, wy: 0 }, world = { worldModules: [m], buildings: [] }, K = DOCKS[kind];
    const sl = K.slips[K.slips.length - 1], end = dockRoute(kind, sl.f).at(-1), far = toWorldAt(m, ...end);   // (out at the float, by the last slip)
    const B = deckAt(world, far.x, far.z);
    assert.ok(B && B.m.id === 'wmX' && Number.isFinite(B.y), 'the float is a deck, with its height');
    // from the land behind the quay: to the quay first (by the city's ways), then down the decks to them
    const land = toWorldAt(m, 30, 0);
    assert.equal(deckAt(world, land.x, land.z), null, 'the land is no deck');
    const on = dockWay(world, land, far);
    assert.ok(on && on.land && on.pts.length >= 2, JSON.stringify(on));
    assert.ok(Math.abs(toFrame(m, on.land.x, on.land.z).s - 1.5) < 0.1, 'to the quay first');
    for (const p of on.pts) assert.ok(onDeck(m, p), `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}) is on the dock`);
    assert.ok(Math.hypot(on.pts.at(-1).x - far.x, on.pts.at(-1).z - far.z) < 0.01, 'and ends where they are');
    // along it: from the pier to the float — no detour up to the quay and back (the ways meet on the pier)
    const pier = K.decks.find(d => d.kind === 'pier'), mid = toWorldAt(m, (pier.s0 + pier.s1) / 2, (pier.f0 + pier.f1) / 2);
    const along = dockWay(world, mid, far);
    assert.ok(along && !along.land && !along.then, JSON.stringify(along));
    assert.ok(along.pts.every(p => toFrame(m, p.x, p.z).s < 1), 'it never goes back up on to the quay');
    // off it: up to the quay, then the city's ways to them
    const off = dockWay(world, far, land);
    assert.ok(off && !off.land && off.then && Math.abs(toFrame(m, off.pts.at(-1).x, off.pts.at(-1).z).s - 1.5) < 0.1, JSON.stringify(off));
    // neither on a dock: nothing to do with docks
    assert.equal(dockWay(world, land, toWorldAt(m, 40, 10)), null);
  });
}
