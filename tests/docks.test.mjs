// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing docks (docs/features/fishing.md §Venues; shared/dock-layout.js): their layouts hold together (decks join
// up, the slips sit between the fingers and clear of them, the boats' water is inside the dredged basin), the placing
// tool squares a dock to the shore it is pointed at, the rules say where one may stand (dry land behind, the water's
// edge at the quay, its own kind of water out front, open water beyond the basin), the ramp's ground slopes into the
// water (a sloped terrain pad), the decks are stood on (and not from under them), and on a generated island docks fit.
import assert from 'node:assert/strict';
import test from 'node:test';
import { DOCKS, dockPads, dockDecks, dockWalls, dockWhy, fitToShore, slipsAt, rampOf, deckTop, dockLadders, toFrame } from '../shared/dock-layout.js';
import { WORLD_KINDS, checkWorldModule, worldModulePads, moduleBoxes, moduleDecks, deckUnder, boatSlips, terminalSpec, hasBuilding, levelFor } from '../shared/world-modules.js';
import { Island, defaultIsland } from '../shared/terrain.js';
import { coastline } from '../shared/coasts.js';

const BOATS = { coastal: { len: 8.2, beam: 2.9 }, skiff: { len: 5.0, beam: 1.9 } };

test('the layouts hold together: decks joined, slips between the fingers, boats in the basin, the store on the land', () => {
  for (const [kind, K] of Object.entries(DOCKS)) {
    const B = BOATS[K.boat];
    assert.equal(K.slips.length, 5, `${kind}: 5 boats`);
    const fingers = K.decks.filter(d => d.kind === 'finger');
    for (const sl of K.slips) {
      const f0 = sl.f - B.beam / 2, f1 = sl.f + B.beam / 2, s0 = sl.s - B.len / 2, s1 = sl.s + B.len / 2;
      for (const d of K.decks) assert.ok(f1 <= d.f0 + 1e-6 || f0 >= d.f1 - 1e-6 || s1 <= d.s0 + 1e-6 || s0 >= d.s1 - 1e-6, `${kind} ${sl.id}: the boat clear of the ${d.kind} at ${d.s0},${d.f0}`);
      const left = fingers.filter(d => d.f1 <= f0 + 1e-6).sort((a, b) => b.f1 - a.f1)[0], right = fingers.filter(d => d.f0 >= f1 - 1e-6).sort((a, b) => a.f0 - b.f0)[0];
      assert.ok(left && right && f0 - left.f1 >= 0.3 && right.f0 - f1 >= 0.3, `${kind} ${sl.id}: a finger either side, room for fenders`);
      assert.ok(s0 >= K.basin.s0 && s1 <= K.basin.s1 + 10 && f0 >= K.basin.f0 && f1 <= K.basin.f1, `${kind} ${sl.id}: in the dredged basin`);
    }
    // every boat's way out is clear: straight ahead from its slip to the basin's mouth, no deck in the way
    for (const sl of K.slips) for (let sv = sl.s - B.len / 2; sv > K.basin.s0; sv -= 0.5) for (const df of [-B.beam / 2, 0, B.beam / 2])
      assert.ok(!K.decks.some(d => sv > d.s0 && sv < d.s1 && sl.f + df > d.f0 && sl.f + df < d.f1), `${kind} ${sl.id}: clear water ahead (a ${K.decks.find(d => sv > d.s0 && sv < d.s1 && sl.f + df > d.f0 && sl.f + df < d.f1)?.kind} at s ${sv})`);
    // every deck touches another or the land (you can walk from the store to every finger)
    const touch = (a, b) => a.s0 <= b.s1 + 0.05 && b.s0 <= a.s1 + 0.05 && a.f0 <= b.f1 + 0.05 && b.f0 <= a.f1 + 0.05;
    const seen = new Set(), stack = K.decks.filter(d => d.s1 >= 0);   // (those reaching the quay)
    while (stack.length) { const d = stack.pop(); if (seen.has(d)) continue; seen.add(d); for (const o of K.decks) if (!seen.has(o) && touch(d, o)) stack.push(o); }
    assert.equal(seen.size, K.decks.length, `${kind}: every deck reached from the quay`);
    assert.ok(K.store.s0 >= K.land.s0 && K.store.s1 <= K.land.s1, `${kind}: the store on the land`);
    assert.ok(K.roadEnd.s === K.land.s1, `${kind}: its road comes in at the land's back edge`);
    const pad = { s0: K.pad.sc - K.pad.hs, s1: K.pad.sc + K.pad.hs };
    assert.ok(pad.s0 <= K.basin.s0 && pad.s1 >= K.land.s1 && K.pad.hf >= Math.max(-K.land.f0, K.land.f1), `${kind}: its footprint holds all of it`);
  }
  assert.ok(DOCKS.lakedock.pad.hs < DOCKS.marina.pad.hs && BOATS.skiff.len < BOATS.coastal.len, 'the lake dock is the smaller, with smaller boats');
});

// a straight coast: land east of x = 0 rising gently, the sea west of it (deepening), a lake to the north-east
const coastEnv = (sea = 'sea') => {
  const ground = (x, z) => (x > 0 ? 0.5 + x * 0.02 : x * 0.03);
  const lake = (x, z) => Math.hypot(x - 600, z - 600) < 150;
  return {
    heightAt: (x, z) => (lake(x, z) ? 18 - (150 - Math.hypot(x - 600, z - 600)) * 0.06 : ground(x, z)),
    waterAt: (x, z) => (lake(x, z) ? { kind: 'lake', level: 18, id: 'lake1' } : ground(x, z) < 0 ? { kind: sea, level: 0 } : null),
    isWater(x, z) { return !!this.waterAt(x, z); },
    roads: null,
  };
};
const W0 = { grid: { cols: 2, rows: 2 }, buildings: [], decorations: [], stations: [], worldModules: [] };

test('the placing tool squares a dock to the shore; the rules: dry land, the quay at the water, its water, open water beyond', () => {
  const env = coastEnv();
  const fit = fitToShore('marina', 40, 300, env);   // pointed at the land 40 m up from the shore
  assert.ok(fit, 'it fits itself to the shore');
  const m = { kind: 'marina', ...fit };
  const out = { x: -Math.cos(m.rot), z: Math.sin(m.rot) };   // its seaward way (−s)
  assert.ok(out.x < -0.95, `its piers point out to sea (${out.x.toFixed(2)}, ${out.z.toFixed(2)})`);
  assert.ok(Math.abs(fit.x - 1) < 1.5, `its quay at the water's edge (x ${fit.x.toFixed(1)})`);
  const r = dockWhy(m, env); assert.equal(r.why, null, r.why); assert.equal(r.level, 0);
  assert.equal(checkWorldModule(W0, m, env), null);
  const inWater = fitToShore('marina', -30, 300, env); assert.ok(inWater && Math.abs(inWater.x - 1) < 1.5, 'pointed at the water, it comes back up to the shore');
  assert.match(dockWhy({ ...m, x: m.x + 80 }, env).why, /more than 16 m out|over the sea/, 'too far up the land');
  assert.match(dockWhy({ ...m, x: m.x - 60 }, env).why, /dry land|in the water/, 'too far out');
  assert.match(dockWhy({ ...m, rot: m.rot + Math.PI }, env).why, /slips must be over the sea/, 'facing the land');
  assert.match(dockWhy({ ...m, kind: 'lakedock' }, env).why, /over a lake/, 'a lake dock on the sea');
  const lake = fitToShore('lakedock', 600, 770, env); assert.ok(lake);
  assert.equal(dockWhy({ kind: 'lakedock', ...lake }, env).why, null, 'a lake dock on the lake');
  const shallow = { ...coastEnv(), heightAt: (x, z) => (x > 0 ? 0.5 + x * 0.02 : -0.4) };
  assert.match(dockWhy(m, shallow).why, /too shallow for boats/, 'boats must get out to deep water');
  assert.match(dockWhy(m, { ...env, coastWhy: () => 'It would enter the clear water kept in front of the protected waterfront' }).why, /protected/);
});

test('the ground: the land level a little over the water, the ramp sloping into it, the basin dredged; the walls and decks', () => {
  const env = coastEnv(), fit = fitToShore('marina', 40, 300, env), K = WORLD_KINDS.marina;
  const m = { kind: 'marina', ...fit, wy: 0, id: 'wm1', name: 'Test Marina' };
  m.y = levelFor((x, z) => 9, m); assert.equal(m.y, 3.5, 'a high road: the land no more than 3.5 m over the water');
  m.y = levelFor((x, z) => 0.2, m); assert.equal(m.y, 1.2, 'a low one: no less than 1.2 m');
  m.y = 2;
  const pads = dockPads(m), [ramp, land, basin] = pads, R = rampOf(m);
  assert.ok(ramp.k > 0 && land.y === 2 && basin.y === -K.dock.basin.depth, 'a sloped ramp, the level land, the dredged basin');
  const isl = new Island(defaultIsland(), { pads: [] }).withPads(pads);
  const at = (s, f) => { const c = Math.cos(m.rot), n = Math.sin(m.rot); return [m.x + s * c + f * n, m.z - s * n + f * c]; };
  for (const sv of [R.top - 1, R.top - 10, 0, R.s0 + 2]) {
    const [x, z] = at(sv, (R.f0 + R.f1) / 2), want = m.y + (sv - R.top) * R.slope - 0.05;
    assert.ok(Math.abs(isl.padLevel(x, z) - want) < 0.02, `the ramp's ground at s ${sv}: ${isl.padLevel(x, z).toFixed(2)} (want ${want.toFixed(2)})`);
  }
  assert.ok(R.y0 < m.wy - 1, 'the ramp runs down under the water');
  const [bx, bz] = at(-40, 10); assert.ok(Math.abs(isl.padLevel(bx, bz) - (basin.y - 0.05)) < 1e-6, 'the basin floor');
  const [lx, lz] = at(30, 0); assert.ok(Math.abs(isl.padLevel(lx, lz) - (2 - 0.05)) < 1e-6, 'the land');
  // walls (rails, the kiosk, the bench) and the decks
  const walls = dockWalls(m); assert.ok(walls.some(w => w.label === 'the fuel kiosk') && walls.filter(w => w.label === 'a rail').length >= 8);
  const decks = dockDecks(m), pier = decks.find(d => d.kind === 'pier' && d.y0 === d.y1), [px, pz] = at(-50, -4);
  assert.equal(deckTop(pier, px, pz), 1.6, 'the pier 1.6 m over the water');
  assert.equal(deckUnder(decks, px, pz, 1.6), 1.6, 'stood on');
  assert.equal(deckUnder(decks, px, pz, -1.2), null, 'not by a swimmer under it');
  const root = decks.find(d => d.kind === 'pier' && d.y0 !== d.y1), [rx, rz] = at(-4, -4);
  assert.ok(Math.abs(deckTop(root, rx, rz) - (1.6 + 2) / 2) < 1e-6, 'its root slopes up to the promenade');
  const [gx, gz] = at(-32.5, 1), gang = decks.find(d => d.kind === 'gang'); assert.ok(deckTop(gang, gx, gz) < 1.6 && deckTop(gang, gx, gz) > 0.45, 'the gangway down to the float');
  for (const L of dockLadders(m)) assert.equal(L.top, 1.6);
  const slips = slipsAt(m); assert.equal(slips.length, 5);
  for (const s of slips) { const fr = toFrame(m, s.x, s.z); assert.ok(fr.s < -35, 'the boats lie out over the water'); assert.ok(Math.sin(s.yaw) * -Math.cos(m.rot) + Math.cos(s.yaw) * Math.sin(m.rot) > 0.999, 'bows out over the water (−s)'); }
  // through the world
  const w = { ...W0, worldModules: [m] };
  assert.equal(worldModulePads(w).length, 4); assert.ok(worldModulePads(w)[3].clear, 'the shore in front of its quay kept clear'); assert.equal(moduleDecks(w).length, DOCKS.marina.decks.length); assert.equal(boatSlips(w).length, 5);
  assert.ok(moduleBoxes(w).every(b => b.mid === 'wm1'));
  assert.ok(hasBuilding(m) && hasBuilding({ kind: 'airport' }));
  const store = terminalSpec(m); assert.equal(store.type, 'shop'); assert.ok(store.tackle && store.module === 'wm1' && /Dock Store/.test(store.name));
});

test('on a generated island, marinas and lake docks fit along its shores', () => {
  const P = defaultIsland(), isl = new Island(P);
  const env = { heightAt: (x, z) => isl.height(x, z), isWater: (x, z) => !!isl.waterAt(x, z), waterAt: (x, z) => isl.waterAt(x, z), roads: null };
  let sea = 0, lake = 0;
  for (const c of coastline(isl)) {
    const dx = c.x - P.center.x, dz = c.z - P.center.z, d = Math.hypot(dx, dz), fit = fitToShore('marina', c.x - dx / d * 30, c.z - dz / d * 30, env);
    if (fit && !checkWorldModule(W0, { kind: 'marina', ...fit }, env)) sea++;
  }
  for (const k of isl.lakes.slice(0, 12)) for (let a = 0; a < 8; a++) {
    const fit = fitToShore('lakedock', k.x + Math.cos(a * 0.785) * k.r * 1.3, k.z + Math.sin(a * 0.785) * k.r * 1.3, env);
    if (fit && !checkWorldModule(W0, { kind: 'lakedock', ...fit }, env)) lake++;
  }
  assert.ok(sea >= 10, `marinas fit on ${sea} stretches of coast`);
  assert.ok(lake >= 10, `lake docks fit at ${lake} lake shores`);
});

test('a module\'s access road: long enough to climb from its land to the road it joins, or the place is refused; the road held level with the land at its gate', async () => {
  const { accessRoadPath, placeLevel } = await import('../shared/world-modules.js');
  const { RoadNetwork } = await import('../shared/roads.js');
  const { IslandRoads, DRAW_LIFT } = await import('../shared/island-roads.js');
  const base = coastEnv();
  const fit = fitToShore('marina', 30, 0, base); assert.ok(fit, 'a marina at the coast');
  const m = { kind: 'marina', ...fit };
  // the shore rises behind its land (15 %): a road 45 m behind it is well above it
  const steep = { ...base, heightAt: (x, z) => (x > 80 ? 2.1 + (x - 80) * 0.15 : base.heightAt(x, z)) };
  const back = { x: m.x + Math.cos(m.rot) * (78 + 45), z: m.z - Math.sin(m.rot) * (78 + 45) }, along = { x: -Math.sin(m.rot), z: -Math.cos(m.rot) };
  const um = v => Math.round(v * 1e6), rec = (id, a, b) => ({ id, profile: 'country', name: id, pts: [{ x: um(a.x), z: um(a.z) }, { x: um(b.x), z: um(b.z) }] });
  const road = rec('r1', { x: back.x - along.x * 3000, z: back.z - along.z * 3000 }, { x: back.x + along.x * 3000, z: back.z + along.z * 3000 });
  const env = { ...steep, roads: RoadNetwork.fromJSON([road]) };
  const level = placeLevel(m, env), plain = accessRoadPath(m, env.roads), R = accessRoadPath(m, env.roads, { heightAt: env.heightAt, level });
  const len = P => P.reduce((L, p, k) => (k ? L + Math.hypot(p.x - P[k - 1].x, p.z - P[k - 1].z) : 0), 0);
  assert.ok(plain.length === 2 && len(plain) < 60, `without the climb: straight to the road behind (${Math.round(len(plain))} m)`);
  const dh = env.heightAt(R.at(-1).x, R.at(-1).z) - level;
  assert.ok(!R.steep && len(R) * 0.09 >= dh, `with it: a road long enough to climb ${dh.toFixed(1)} m (${Math.round(len(R))} m, ${R.length} points)`);
  assert.equal(checkWorldModule(W0, m, env), null, 'so it may stand there');
  // no room to climb (a cliff of a shore and the road right behind it): refused, saying why
  const cliff = { ...env, heightAt: (x, z) => (x > 80 ? 2.1 + (x - 80) * 1.6 : base.heightAt(x, z)) };
  assert.match(checkWorldModule(W0, m, cliff) || '', /road can't climb that|rises or falls/, 'a cliff: refused');
  // the gate: the road's end at the module held level with its land (its surface flush with the paving), the end open
  const gate = { x: R[0].x, z: R[0].z, y: 0.6 }, recs = [{ id: 'a1', profile: 'country', name: 'Marina Road', pts: R.map(p => ({ x: um(p.x), z: um(p.z), ...(p.r ? { r: um(p.r) } : {}) })) }, road];
  const IR = new IslandRoads(recs, (x, z) => steep.heightAt(x, z), { gates: [gate] });
  assert.ok(Math.abs(IR.top(gate.x, gate.z) - 0.6) < 0.02, `flush with the land at its gate: ${IR.top(gate.x, gate.z).toFixed(3)}`);
  assert.ok(IR.isGate('a1', 0) && !IR.isGate('r1', 0), 'its end there is a gate');
  const free = new IslandRoads(recs, (x, z) => steep.heightAt(x, z));
  assert.ok(Math.abs(free.top(gate.x, gate.z) - 0.6) > 1, 'without the gate it followed the ground (a step at the land)');
  void DRAW_LIFT;
});

test('a dock\'s benches stand along the quay looking out over the water (the catalog\'s bench faces its +z)', async () => {
  const { dockDecor } = await import('../shared/dock-layout.js');
  for (const rot of [0, 1.1, -2.4]) {
    const m = { kind: 'marina', x: 100, z: -50, rot, y: 1 }, out = { x: -Math.cos(rot), z: Math.sin(rot) }, along = { x: Math.sin(rot), z: Math.cos(rot) };   // (−s: to the water; f: along the quay)
    for (const d of dockDecor(m).filter(x => x.t === 'bench')) {
      const face = { x: Math.sin(d.r), z: Math.cos(d.r) }, length = { x: Math.cos(d.r), z: -Math.sin(d.r) };
      assert.ok(face.x * out.x + face.z * out.z > 0.99, `faces the water at rot ${rot}`);
      assert.ok(Math.abs(length.x * along.x + length.z * along.z) > 0.99, 'its length along the quay');
    }
  }
});
