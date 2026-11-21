// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions on a generated city with a virtual clock (server/companions/companions.js, server/sim/companion-moves.js):
// a follower keeps its place by its player as the player walks; gets in the player's car when it is close (hidden in it,
// carried along) and out beside it when the player gets out; waits by the parked character in sim mode; waits where a
// player left, and after companions.waitMinutes goes back to its day with its owner told. Strangers can't command it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { PlayerNav } from '../../shared/playernav.js';
import { PF_OBSERVING } from '../../shared/playerproto.js';
import { F_HIDDEN } from '../../shared/proto.js';
import { Companions, CompanionError } from '../../server/companions/companions.js';
import { CarSeats } from '../../server/world/car-seats.js';

function setup() {
  const world = generateWorld({ seed: 'companions-unit', population: 300 });
  const roster = [{ agentId: 'c-agent-1', name: 'Riley', emoji: '🤖', role: 'Tester' }, { agentId: 'c-agent-2', name: 'Max', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 };
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `c-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `c-agent-${k}`, name: k === 1 ? 'Riley' : 'Max', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) };
  const nav = new PlayerNav(world);
  const players = { byId: new Map(), nav };
  const cars = new Map(), said = [];
  // (a car's passenger seats: its kind's, less the driver's — 3 for a sedan, 1 for a van)
  const seats = new CarSeats({ places: id => (cars.has(id) ? cars.get(id).places ?? 3 : 0), announce: m => said.push(JSON.parse(JSON.stringify(m))) });
  const notes = [], settings = { 'companions.waitMinutes': 1 };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: cars, seats }), agents, life: () => life, world: () => null, setting: k => settings[k],
    notify: (id, m) => notes.push({ id, m }), send: () => {}, principalFor: () => null, now: () => ms });
  comp.hookSim();
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  // an open spot near agent i, for the player
  const near = (i, d = 6) => { const e = at(i); for (let r = d; r < 80; r += 2) for (let a = 0; a < 12; a++) { const x = e.x + Math.sin(a) * r, z = e.z + Math.cos(a) * r; if (nav.ok(x, z, -1) && !nav.wet(x, z)) return { x, z }; } return nav.openGround(e.x, e.z); };
  // runs until fn() is true (or the time is up): the first time it is
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  return { world, sim, comp, players, cars, seats, said, recs, notes, run, until, at, near, idx, P: { account: { id: 7, displayName: 'Kim', login: 'kim' } }, t: () => T };
}

test('it keeps its place by the walking player, gets in the car close by, rides along hidden and gets out beside it', () => {
  const c = setup(), i = c.idx(1);
  // the player outdoors, near where the agent is (it comes out to them)
  const spot = c.near(i, 8);
  assert.ok(spot, 'open ground near it');
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  const r = c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.equal(r.ok, true);
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to the player');
  c.run(4);
  const e = c.at(i);
  assert.ok(Math.hypot(e.x - p.x, e.z - p.z) < 3.5, `beside the player (${Math.hypot(e.x - p.x, e.z - p.z).toFixed(1)} m)`);
  assert.equal(c.sim.agents[i].act.kind, 'follow');
  // the player gets in a car right there: it gets in too (hidden in it)
  c.cars.set(50, { id: 50, x: p.x + 2, z: p.z, yaw: 0 });
  p.vehicleId = 50;
  c.run(2);
  assert.ok(c.sim.agents[i].ride, 'in the car');
  assert.ok(at(c, i).s.flags & F_HIDDEN, 'hidden in it');
  assert.deepEqual(c.seats.of(50), [{ seat: 1, kind: 'resident', id: i }], 'in the front passenger seat');
  assert.deepEqual(c.said.at(-1), { t: 'vseats', id: 50, seats: [{ seat: 1, kind: 'resident', id: i }] }, 'every page told');
  assert.equal(c.comp.list(c.P).companions[0].state, 'riding');
  // the car drives off: it is carried along
  const car = c.cars.get(50), from = { x: car.x, z: car.z };
  const dest = c.near(i, 30) || { x: car.x + 30, z: car.z };
  car.x = dest.x; car.z = dest.z;
  c.run(2);
  const ride = c.at(i);
  assert.ok(Math.hypot(ride.x - car.x, ride.z - car.z) < 1.5, 'where the car is');
  assert.ok(Math.hypot(ride.x - from.x, ride.z - from.z) > 10, 'moved with it');
  // the player gets out: so does it, beside the car, and it goes on following
  p.vehicleId = null; p.x = car.x; p.z = car.z;
  c.run(6);
  assert.equal(c.sim.agents[i].ride, null, 'out of the car');
  assert.ok(!(at(c, i).s.flags & F_HIDDEN), 'seen again');
  assert.deepEqual(c.seats.of(50), [], 'its seat free again');
  assert.deepEqual(c.said.at(-1), { t: 'vseats', id: 50, seats: [] });
  assert.ok(Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 6, 'beside the player');
});

test('walking with the player: it keeps up beside them all the way, at their pace (no stop-and-go), and stops when they stop', () => {
  const c = setup(), i = c.idx(1);
  const spot = c.near(i, 8);
  // a straight 24 m of open ground from there, for the walk
  const open = (x0, z0, dx, dz) => { for (let s = 0; s <= 26; s += 0.5) { const x = x0 + dx * s, z = z0 + dz * s; if (!c.players.nav.ok(x, z, -1) || c.players.nav.wet(x, z)) return false; } return true; };
  let start = null, dir = null;
  for (let r = 0; r < 60 && !start; r += 3) for (let k = 0; k < 16 && !start; k++) {
    const x = spot.x + Math.sin(k * 0.39) * r, z = spot.z + Math.cos(k * 0.39) * r;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (open(x, z, dx, dz)) { start = { x, z }; dir = { dx, dz }; break; }
  }
  assert.ok(start, 'a straight walk near it');
  const p = { id: 7, name: 'Kim', x: start.x, z: start.z, y: 0, ctx: -1, yaw: Math.atan2(dir.dx, dir.dz), flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came to the player');
  c.run(5);
  // the player walks 24 m at 1.6 m/s (as a player walks), a step every 0.25 s
  const far = [], still = [];
  let prev = c.at(i);
  for (let s = 0; s < 15; s += 0.25) {
    p.x += dir.dx * 0.4; p.z += dir.dz * 0.4;
    c.run(0.25, 0.25);
    const e = c.at(i), d = Math.hypot(e.x - p.x, e.z - p.z);
    if (s >= 2.5) { if (d > 3) far.push(d.toFixed(1)); if (Math.hypot(e.x - prev.x, e.z - prev.z) < 0.05) still.push(s); }
    prev = e;
  }
  assert.equal(far.length, 0, `kept beside the player (too far: ${far.join(', ')} m)`);
  assert.ok(still.length <= 2, `walked on with them, not stop-and-go (stood still ${still.length} times)`);
  // the player stops: it stops beside them
  c.run(5);
  const e = c.at(i);
  assert.ok(Math.hypot(e.x - p.x, e.z - p.z) < 3, `stopped beside them (${Math.hypot(e.x - p.x, e.z - p.z).toFixed(1)} m)`);
  assert.equal(c.comp.list(c.P).companions[0].state, 'following');
});

test('sim mode: it waits by the parked character; the player gone, it waits, then goes back to its day and its owner is told', () => {
  const c = setup(), i = c.idx(1);
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: PF_OBSERVING, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.equal(c.comp.list(c.P).companions[0].coming, true, 'on its way to them (not "waiting by your character" yet)');
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it went over to the parked character');
  assert.equal(c.comp.list(c.P).companions[0].state, 'waiting', 'waiting by the parked character');
  assert.equal(c.comp.list(c.P).companions[0].coming, false, 'there now');
  // the player leaves the world: it waits where they were
  c.players.byId.delete(7);
  c.run(30);
  const v = c.comp.list(c.P).companions[0];
  assert.equal(v.state, 'waiting');
  assert.equal(v.leader.away, true);
  // after companions.waitMinutes (1 real minute here): back to its day, its owner told
  c.run(40);
  assert.equal(c.comp.list(c.P).companions.length, 0, 'not a companion any more');
  assert.equal(c.sim.orderOf(i), null);
  assert.ok(c.notes.some(n => n.id === 7 && /went back to their day/.test(n.m.text)), 'its owner was told');
});

test('only its owner commands it; the cap and going with another of the owner\'s agents', () => {
  const c = setup();
  c.players.byId.set(7, { id: 7, name: 'Kim', x: 0, z: 0, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null });
  assert.throws(() => c.comp.command({ account: { id: 99 } }, { agent: 1, action: 'follow', target: 'me' }), e => e instanceof CompanionError && e.status === 404);
  const r = c.comp.command(c.P, { agent: 2, action: 'follow', target: 'Riley' });
  assert.equal(r.ok, true);
  assert.equal(r.companion.leader.kind, 'agent');
  assert.equal(r.companion.leader.name, 'Riley');
  c.run(5);
  // Riley then follows the player: Max goes with it — the player's group (a second follow joins the player's)
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  const r2 = c.comp.command(c.P, { agent: 2, action: 'follow', target: 'Riley' });
  assert.equal(r2.companion.leader.kind, 'player');
  assert.equal(c.comp.list(c.P).following, 2);
  const d = c.comp.command(c.P, { agent: 2, action: 'dismiss' });
  assert.equal(d.dismissed, true);
  assert.equal(c.comp.list(c.P).following, 1);
});

test('two agents off together by their own choice: shown in their owner\'s Companions, ended by "Let everyone go" too', () => {
  const c = setup();
  c.players.byId.set(7, { id: 7, name: 'Kim', x: 0, z: 0, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null });
  const A = { id: 1, name: 'Riley' }, B = { id: 2, name: 'Max' };
  const r = c.comp.together(A, B, 'a walk');
  assert.equal(r.ok, true, JSON.stringify(r));
  c.run(2);
  const l = c.comp.list(c.P).companions;
  assert.ok(l.some(x => x.via === 'agent' && x.kind === 'follow' && x.name === 'Max'), 'Max goes with Riley: in the bar');
  const d = c.comp.dismissAll(c.P);
  assert.deepEqual(d.dismissed.sort(), [1, 2]);
  c.run(2);
  assert.equal(c.comp.list(c.P).companions.length, 0, 'all let go');
  assert.throws(() => c.comp.dismissAll({ account: { id: 99 } }).dismissed.length || (() => { throw new Error('none'); })(), /none/, 'a stranger lets none of them go');
});

function at(c, i) { return evalPlan(c.sim.agents[i].plan, c.t()); }

test('the car\'s own seats: two players\' cars side by side each take their own companions, a full car takes no more, and getting in or out by any way keeps the seats right', () => {
  const c = setup(), i = c.idx(1), j = c.idx(2);
  c.recs[1].ownerId = 8;   // (Max is the second player's)
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  const q = { id: 8, name: 'Sam', x: spot.x + 1.5, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p); c.players.byId.set(8, q);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  c.comp.command({ account: { id: 8, displayName: 'Sam', login: 'sam' } }, { agent: 2, action: 'follow', target: 'me' });
  assert.ok(c.until(() => [i, j].every(k => { const e = c.at(k); return e.ctx === -1 && Math.hypot(e.x - spot.x, e.z - spot.z) < 6; })), 'both came out to their players');
  // two cars side by side, 2.2 m apart; the second a van with one passenger seat
  c.cars.set(60, { id: 60, x: spot.x, z: spot.z + 2, yaw: 0, places: 3 });
  c.cars.set(61, { id: 61, x: spot.x + 2.2, z: spot.z + 2, yaw: 0, places: 1 });
  p.vehicleId = 60; q.vehicleId = 61;
  c.run(2);
  assert.deepEqual(c.seats.of(60).map(r => r.id), [i], 'Riley in its own player\'s car');
  assert.deepEqual(c.seats.of(61).map(r => r.id), [j], 'Max in its own player\'s car');
  assert.equal(c.comp.freeSeats(61), 0, 'the van is full');
  // asked to get in a full car: refused
  q.vehicleId = null; c.run(3); q.vehicleId = 61;
  c.cars.get(61).places = 0;   // (its one seat taken by someone else meanwhile)
  assert.throws(() => c.comp.command({ account: { id: 8, displayName: 'Sam', login: 'sam' } }, { agent: 2, action: 'ride' }), e => e.code === 'car_full');
  // dismissed while riding: out of the car, its seat free
  c.comp.command(c.P, { agent: 1, action: 'dismiss' });
  assert.equal(c.sim.agents[i].ride, null);
  assert.deepEqual(c.seats.of(60), []);
  // a rider whose car went away (its seat with it) gets out where it is
  c.cars.get(61).places = 1; q.vehicleId = 61; c.run(2);
  assert.ok(c.sim.agents[j].ride, 'Max back in the van');
  c.cars.delete(61); c.seats.clear(61); q.vehicleId = null;
  c.run(2);
  assert.equal(c.sim.agents[j].ride, null, 'out of the car that went away');
  assert.equal(c.seats.size, 0);
});

/** Riley's shift (its job's desk) starting `inH` world hours from now, every day; and a Free Will that only counts its
 *  choice points (the routine always decides): [[sim t, type]]. */
function onShiftSoon(c, i, inH) {
  const h = c.sim.brain.hour(c.t()), j = c.sim.people[i].job;
  assert.ok(j && Number.isInteger(j.b), 'Riley has a job at a desk');
  Object.assign(j, { start: h + inH, end: h + 8, days: 127 });
  const takes = [];
  c.sim.freeWill = { isActive: k => k === i, take: (a, P, hh, day, type) => { if (a.i === i) takes.push([c.t(), type]); return null; }, done() {} };
  return takes;
}

test('on shift and out with its owner: its shift (tired too) does not take it away, nor ask round after round; let go, it goes to work', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i];
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  const takes = onShiftSoon(c, i, 0.25);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to its owner');
  // its shift starts and goes on; it gets tired (2026-11-17: then the shift came first at every round's end, it walked
  // off to work, and its owner's moving called it back — six shift choice points in 45 seconds); its owner steps about
  const away = [], far = [];
  for (let s = 0; s < 420; s += 2) {
    if (s === 120) A.needs.energy = 0.15;
    if (s % 40 === 0) p.x += 1.5;
    c.run(2);
    if (A.act?.kind !== 'follow') away.push(`${A.act?.kind}: ${A.act?.label}`);
    const e = c.at(i);
    if (s > 10 && Math.hypot(e.x - p.x, e.z - p.z) > 6) far.push(Math.hypot(e.x - p.x, e.z - p.z).toFixed(1));
  }
  assert.ok(c.sim.brain.onShift(A, A.plan, c.sim.brain.hour(c.t()), c.sim.brain.day(c.t())), 'its shift is on');
  assert.deepEqual(away, [], 'it stayed with its owner');
  assert.deepEqual(far, [], 'beside them');
  assert.deepEqual(takes, [], 'no choice point about its shift while it is with them');
  assert.equal(c.comp.list(c.P).companions[0]?.state, 'following');
  // its owner lets it go: it goes to work
  c.comp.command(c.P, { agent: 1, action: 'dismiss' });
  assert.ok(c.until(() => A.act?.kind === 'work', 30), `it went to work (${A.act?.kind}: ${A.act?.label})`);
  assert.ok(takes.length <= 1 && takes.every(x => x[1] === 'shift'), 'one choice point about its shift, when it was let go');
  c.run(20);
  assert.equal(A.act?.kind, 'work', 'and keeps going');
});

test('waiting for its owner where they asked it to: its shift (tired too) does not take it away either', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i];
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  const takes = onShiftSoon(c, i, 0.25);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to its owner');
  c.comp.command(c.P, { agent: 1, action: 'stay', place: 'here' });
  const here = c.at(i), away = [];
  for (let s = 0; s < 300; s += 2) {
    A.needs.energy = 0.15;
    c.run(2);
    if (A.act?.kind !== 'follow') away.push(`${A.act?.kind}: ${A.act?.label}`);
  }
  assert.ok(c.sim.brain.onShift(A, A.plan, c.sim.brain.hour(c.t()), c.sim.brain.day(c.t())), 'its shift is on');
  assert.deepEqual(away, [], 'still waiting');
  assert.equal(c.sim.orderOf(i)?.kind, 'hold');
  assert.ok(Math.hypot(c.at(i).x - here.x, c.at(i).z - here.z) < 3, 'where it was asked to wait');
  assert.deepEqual(takes, []);
});

test('riding in its owner\'s car when it stops, tired and on shift: it stays in the car (as Sam did not, 2026-11-17)', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i];
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  const takes = onShiftSoon(c, i, 0.25);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to its owner');
  c.cars.set(50, { id: 50, x: p.x + 2, z: p.z, yaw: 0 });
  p.vehicleId = 50;
  c.run(2);
  assert.ok(A.ride, 'in the car');
  // the car stands (its owner parked with the engine on, talking): no re-plan from the car moving; its rounds end
  const out = [];
  for (let s = 0; s < 300; s += 2) {
    A.needs.energy = 0.15;
    c.run(2);
    if (!A.ride || A.act?.kind !== 'follow') out.push(`${A.act?.kind}: ${A.act?.label}`);
  }
  assert.deepEqual(out, [], 'still riding with its owner');
  assert.deepEqual(c.seats.of(50).map(r => r.id), [i]);
  assert.deepEqual(takes, []);
});

test('agents off together by their own choice: one too tired to go on goes off, its part over (not called back round after round)', () => {
  const c = setup(), j = c.idx(2), B = c.sim.agents[j];
  c.players.byId.set(7, { id: 7, name: 'Kim', x: 0, z: 0, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null });
  const r = c.comp.together({ id: 1, name: 'Riley' }, { id: 2, name: 'Max' }, 'a walk');
  assert.equal(r.ok, true, JSON.stringify(r));
  c.run(10);
  B.needs.energy = 0.1;
  assert.ok(c.until(() => !c.sim.orderOf(j), 120), 'its part ended');
  assert.equal(B.orderEnded?.why, 'needs');
  c.run(20);
  assert.equal(c.sim.orderOf(j), null, 'not called back');
  assert.notEqual(B.act?.kind, 'follow');
});

// an open spot at least `min` metres from (x, z), for a player who travels across the map
function farSpot(c, x, z, min = 250) {
  const nav = c.players.nav;
  for (let r = min; r < min + 400; r += 25) for (let a = 0; a < 16; a++) {
    const sx = x + Math.sin(a * 0.4) * r, sz = z + Math.cos(a * 0.4) * r;
    if (nav.ok(sx, sz, -1) && !nav.wet(sx, sz)) return { x: sx, z: sz };
  }
  return null;
}

test('the player travels across the map: its companion comes along at once and walks on with them; an agent not with them stays', () => {
  const c = setup(), i = c.idx(1), j = c.idx(2);
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'with the player');
  const other = c.at(j);
  // "Travel here" on the map: the player is somewhere far at once
  const to = farSpot(c, p.x, p.z);
  assert.ok(to, 'somewhere far to travel to');
  p.x = to.x; p.z = to.z;
  const moved = c.comp.travelled(p, 'travel');
  assert.deepEqual(moved, [i], 'its companion came along (only it)');
  c.run(1);
  const e = c.at(i);
  assert.ok(e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 4, `beside them there (${Math.hypot(e.x - p.x, e.z - p.z).toFixed(1)} m)`);
  assert.equal(c.sim.orderOf(i)?.kind, 'follow', 'still with them');
  const o = c.at(j);
  assert.ok(Math.hypot(o.x - p.x, o.z - p.z) > 100 && Math.hypot(o.x - other.x, o.z - other.z) < 60, 'the agent not with them went nowhere near them');
  // they walk on: it keeps up there as before
  const w = c.near(i, 10);
  p.x = w.x; p.z = w.z;
  c.run(20);
  const f = c.at(i);
  assert.ok(Math.hypot(f.x - p.x, f.z - p.z) < 4, 'walking on with them');
  // a small step of an admin's warp (not across the map): it just walks over, nobody is moved
  p.x += 6;
  assert.deepEqual(c.comp.travelled(p, 'warp'), [], 'close by: nobody moved at once');
});

test('the player travels while its companion is busy beside them: it finishes, then joins them wherever they are', () => {
  const c = setup(), i = c.idx(1);
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 3.5), 'with the player');
  // (busy at something of its own beside them — a Rush in a kitchen: that module keeps its body meanwhile)
  let busy = true;
  c.comp.busy.push({ busyWith: a => (busy && a.i === i ? { kind: 'orderup', label: 'Cooking' } : null), watch: a => busy && a.i === i });
  const was = c.at(i), to = farSpot(c, p.x, p.z);
  p.x = to.x; p.z = to.z;
  assert.deepEqual(c.comp.travelled(p, 'travel'), [], 'busy: not taken away from it');
  c.run(3);
  assert.ok(Math.hypot(c.at(i).x - was.x, c.at(i).z - was.z) < 5, 'still where it was busy');
  busy = false;   // (its Rush is over)
  c.run(2);
  const e = c.at(i);
  assert.ok(Math.hypot(e.x - p.x, e.z - p.z) < 4, `then beside them (${Math.hypot(e.x - p.x, e.z - p.z).toFixed(1)} m)`);
  assert.equal(c.comp.pendingJoin.size, 0);
});

test('a restart: the companion out with the player is put back beside them (where they were saved), waits, and goes on with them; the others start their day', () => {
  const c = setup(), i = c.idx(1), j = c.idx(2);
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 3.5), 'with the player');
  // (Max was with them earlier and let go: not with anyone when the server stops)
  c.comp.command(c.P, { agent: 2, action: 'follow', target: 'me' });
  c.comp.command(c.P, { agent: 2, action: 'dismiss' });
  // the server restarts: a new city from the same residents (the order kept on each), its bodies warm-started where
  // their routine has them — before the companions are there to say where anyone is
  const people = c.sim.people, world = c.world;
  const sim2 = new Sim(world, people, { budgetMs: 1e9 });
  let T = c.t(), ms = 5e6;
  sim2.now = () => T;
  sim2.clock = c.sim.clock;
  sim2.start();
  const saved = { x: p.x, z: p.z, ctx: -1, yaw: 0 };
  const players = { byId: new Map(), nav: c.players.nav, savedAt: id => (id === 7 ? saved : null) };
  const recs = c.recs, agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, people.findIndex(q => q && q.agentId === r.key)])) };
  const comp = new Companions({ sim: () => sim2, players, agents, life: () => life, world: () => null, setting: k => ({ 'companions.waitMinutes': 5 })[k],
    notify: () => {}, send: () => {}, principalFor: id => (id === 7 ? c.P : null), now: () => ms });
  comp.hookSim();
  const at = k => evalPlan(sim2.agents[k].plan, T);
  const run = secs => { const end = T + secs; while (T < end) { T += 0.5; ms += 500; sim2.tick(); sim2.flush(); comp.tick(); } };
  const maxWas = at(j);
  assert.deepEqual(comp.restored(), [i], "only the one that was out with them");
  run(2);
  const e = at(i);
  assert.ok(Math.hypot(e.x - saved.x, e.z - saved.z) < 4, `beside where they were (${Math.hypot(e.x - saved.x, e.z - saved.z).toFixed(1)} m)`);
  assert.equal(sim2.orderOf(i)?.kind, 'follow', 'still out with them');
  assert.match(comp.list(c.P).companions[0].doing, /Waiting for Kim/, 'waiting for them to come back');
  assert.ok(Math.hypot(at(j).x - saved.x, at(j).z - saved.z) > 20 || Math.hypot(at(j).x - maxWas.x, at(j).z - maxWas.z) < 30, 'Max started his day as he would');
  // they come back (their page reconnects, at their saved place): it is right there and goes on with them
  const back = { ...p, x: saved.x, z: saved.z };
  players.byId.set(7, back);
  assert.deepEqual(comp.rejoined(back), [], 'beside them already: nobody moved');
  const w = c.near(i, 10);
  back.x = w.x; back.z = w.z;
  run(20);
  assert.ok(Math.hypot(at(i).x - back.x, at(i).z - back.z) < 4, 'walking on with them');
});

test('two out with the same player spend that time together: they meet (the outings they already shared count), then know each other better each outing', () => {
  const c = setup(), i = c.idx(1), j = c.idx(2);
  const bonds = [], rel = new Map();
  const life = { byAgent: new Map(c.recs.map(r => [r.id, c.idx(r.id)])), clockAt: () => 'Mon 9:00 AM',
    relationTo: (a, kind, id) => rel.get(`${a}|${id}`) || null,
    bond: (a, who, day, time, place, o) => { bonds.push({ a, who: who.name, note: o.note }); rel.set(`${a}|${who.id}`, { interactions: 1 }); } };
  c.comp.lifeOf = () => life;
  c.comp.outingsTogether = (account, a, b) => (account === 7 ? 3 : 0);   // (three outings with Kim together before)
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  for (const k of [1, 2]) c.comp.command(c.P, { agent: k, action: 'follow', target: 'me' });
  assert.ok(c.until(() => [i, j].every(k => Math.hypot(c.at(k).x - p.x, c.at(k).z - p.z) < 4), 900), 'both with the player');
  c.run(2);
  // each of them: the meeting, and the three outings before it (4 steps closer), noted as who they are to each other
  assert.equal(bonds.filter(b => b.a === 1 && b.who === 'Max').length, 4);
  assert.equal(bonds.filter(b => b.a === 2 && b.who === 'Riley').length, 4);
  assert.ok(bonds.every(b => b.note === 'We go out with Kim together'));
  // the same outing: not again
  c.run(20);
  assert.equal(bonds.length, 8, 'once per outing');
  // a new outing (let go, then asked along again): one step closer
  for (const k of [1, 2]) c.comp.command(c.P, { agent: k, action: 'dismiss' });
  c.run(2);
  for (const k of [1, 2]) c.comp.command(c.P, { agent: k, action: 'follow', target: 'me' });
  assert.ok(c.until(() => bonds.length > 8, 600), 'together again');
  c.run(2);
  assert.equal(bonds.length, 10, 'one more each, the outings before no longer counted');
});

test('put beside its player who stands in the water (swimming, off a boat): on the nearest dry ground, never in the water', () => {
  const c = setup(), i = c.idx(1);
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 3.5), 'with the player');
  // (2026-11-19: after a restart the player's saved place was out at sea where the boat had been) — water round where they
  // are now: 12 m all round them
  const to = farSpot(c, p.x, p.z), open0 = c.sim.leads.open, wet = (x, z) => Math.hypot(x - to.x, z - to.z) < 12;
  c.sim.leads.open = (x, z, ctx) => !(ctx < 0 && wet(x, z)) && open0(x, z, ctx);
  c.sim.leads.wet = (x, z) => wet(x, z);
  p.x = to.x; p.z = to.z;
  assert.deepEqual(c.comp.travelled(p, 'travel'), [i]);
  c.run(1);
  const e = c.at(i), d = Math.hypot(e.x - p.x, e.z - p.z);
  assert.ok(!wet(e.x, e.z), `not in the water (${d.toFixed(1)} m from them)`);
  assert.ok(d <= 24, 'on the dry ground nearest them');
});
