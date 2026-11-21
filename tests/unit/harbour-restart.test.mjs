// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The boats out across a restart of the server (server/world/boats.js; 2026-11-19, the product owner: out fishing with Lara and Sam, the
// server restarted — the boat gone, all three in the water; then a new boat "wasn't moving"): the boats out are saved —
// where, whose, which companions aboard at which spot — and back where they were; their skipper, back within RESUME_MS, is
// at the helm again and the crew handed back; not back in time, the boat goes home; an old save is not taken in; a page
// still driving a boat the harbour doesn't give it is told to let it go (bgone).
import assert from 'node:assert/strict';
import test from 'node:test';
import { Harbour } from '../../server/world/boats.js';
import { fitToShore } from '../../shared/dock-layout.js';
import { boatSlips } from '../../shared/world-modules.js';

// a straight coast: land east of x = 0, the sea west of it (as tests/docks.test.mjs) and a marina on it
const env = { heightAt: (x) => (x > 0 ? 0.5 + x * 0.02 : x * 0.03), waterAt: (x) => (x < 0 ? { kind: 'sea', level: 0 } : null), isWater(x, z) { return !!this.waterAt(x, z); }, roads: null };
const world = { grid: { cols: 2, rows: 2 }, buildings: [], decorations: [], stations: [], worldModules: [{ kind: 'marina', ...fitToShore('marina', 40, 300, env), wy: 0, y: 2, id: 'wm1', name: 'Test Marina' }] };

function rig({ store, T }) {
  const sent = [], players = { byId: new Map(), nav: null, canPlay: () => true, toAccount: (id, m) => sent.push({ id, ...m }) };
  const H = new Harbour({ world: () => world, players, store, now: () => T.now, groundAt: env.heightAt, waterAt: env.waterAt });
  return { H, players, sent };
}
const memStore = () => { const m = new Map(); return { m, save: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), load: k => m.get(k) ?? null }; };
const ws = pid => ({ pid, readyState: 1, out: [], send(s) { this.out.push(JSON.parse(s)); } });

test('a skipper out at sea across a restart: the boat saved where it was, back at the helm when they are back, the crew handed back', () => {
  assert.ok(boatSlips(world).length >= 5, 'the marina\'s slips');
  const store = memStore(), T = { now: 1e9 };
  const A = rig({ store, T });
  const slip = boatSlips(world)[0], p = { id: 7, name: 'Kim', x: slip.x, y: slip.y, z: slip.z, ctx: -1, yaw: 0, ver: 1, flags: 0 };
  A.players.byId.set(7, p);
  const w = ws(7);
  A.H.board(w, { id: slip.id });
  assert.equal(w.out.at(-1).ok, true, 'took the boat');
  A.H.crewOf = id => (id === slip.id ? [{ agent: 75, spot: 1 }, { agent: 76, spot: 2 }] : []);
  // out to sea: 40 m, in poses a boat can make
  for (let k = 1; k <= 8; k++) { T.now += 1000; A.H.pose(w, { x: slip.x - 5 * k, y: slip.y, z: slip.z, h: 1, v: 5, ts: k }); }
  const pose = A.H.all.get(slip.id).pose;
  assert.ok(Math.abs(pose.x - (slip.x - 40)) < 0.01, 'out where it was driven');
  // the server stops
  A.H.close();
  const saved = store.m.get('harbour');
  assert.deepEqual(saved.boats.map(b => [b.id, b.mode, b.skipper, b.crew]), [[slip.id, 'out', 7, [{ agent: 75, spot: 1 }, { agent: 76, spot: 2 }]]]);
  // …and starts again: the boat out where it was, kept for its skipper; nobody else may take it meanwhile
  T.now += 60000;
  const B = rig({ store, T }), b = B.H.all.get(slip.id);
  assert.equal(b.mode, 'out'); assert.equal(b.skipper, 7); assert.ok(Math.abs(b.pose.x - pose.x) < 0.01 && b.pose.v === 0);
  assert.equal(B.H.crewWaitingFor(75), b, 'its crew waits to go back aboard');
  const other = { id: 8, name: 'Ann', x: b.pose.x, y: b.pose.y, z: b.pose.z, ctx: -1, ver: 1 };
  B.players.byId.set(8, other);
  const w8 = ws(8); B.H.board(w8, { id: slip.id });
  assert.equal(w8.out.at(-1).ok, false, 'someone else can\'t take it while it waits for its skipper');
  // its skipper's page connects: back at the helm, the crew handed back to be put aboard
  const back = { id: 7, name: 'Kim', x: 0, y: 0, z: 0, ctx: -1, ver: 1 };
  B.players.byId.set(7, back);
  let handed = null;
  B.H.onResume = (boat, crew) => { handed = [boat.id, crew]; };
  assert.equal(B.H.resume(7), b);
  assert.equal(back.boatId, slip.id, 'aboard');
  assert.ok(Math.hypot(back.x - b.pose.x, back.z - b.pose.z) < 4, 'at the helm, out at sea');
  assert.deepEqual(handed, [slip.id, [{ agent: 75, spot: 1 }, { agent: 76, spot: 2 }]]);
  assert.equal(B.H.crewWaitingFor(75), null);
  const st = B.H.stateFor(7);
  assert.equal(st.resumed, true); assert.equal(st.id, slip.id);
  assert.equal(B.H.resume(7), null, 'once');
});

test('not back in time, the boat goes home; an old save is not taken in; a page driving a boat it doesn\'t have is told to let go', () => {
  const store = memStore(), T = { now: 2e9 }, slip = boatSlips(world)[1];
  store.save('harbour', { at: T.now, boats: [{ id: slip.id, type: slip.kind, mode: 'out', skipper: 9, skipperName: 'Zoe', pose: { x: slip.x - 30, y: slip.y, z: slip.z, h: 0 }, crew: [] }] });
  const A = rig({ store, T });
  assert.equal(A.H.all.get(slip.id).skipper, 9);
  T.now += 11 * 60e3;
  A.H.tick([]);
  const b = A.H.all.get(slip.id);
  assert.deepEqual([b.mode, b.skipper, A.H.bySkipper.has(9)], ['slip', null, false], 'home again');
  // a save from long ago: the boats stay in their slips
  store.save('harbour', { at: T.now - 2 * 3600e3, boats: [{ id: slip.id, type: slip.kind, mode: 'out', skipper: 9, pose: { x: 0, y: 0, z: 0, h: 0 } }] });
  assert.equal(rig({ store, T }).H.all.get(slip.id).mode, 'slip');
  // a page still sending its boat's poses, the harbour giving it none: told to let go (not every pose)
  const C = rig({ store: memStore(), T }), p = { id: 9, name: 'Zoe', x: 5, y: 1, z: 6, ctx: -1, ver: 1 };
  C.players.byId.set(9, p);
  const w = ws(9);
  C.H.pose(w, { x: 1, y: 0, z: 1, h: 0 }); C.H.pose(w, { x: 1, y: 0, z: 1, h: 0 });
  assert.equal(w.out.filter(m => m.t === 'bgone').length, 1);
  assert.deepEqual(w.out[0], { t: 'bgone', x: 5, y: 1, z: 6, ctx: -1, text: 'The boat is not yours any more — it went back to its slip' });
});
