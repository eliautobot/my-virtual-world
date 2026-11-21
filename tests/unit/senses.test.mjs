// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's senses (server/senses/, docs/features/awareness.md) on a generated city with a virtual clock: its owner's
// choice of how much it is told (and the installation's default and switch); exactly where it is — the seat of its
// owner's car, who drives, the way and the speed; together or apart; what goes with a message in each mode; the diary
// (getting in and out of the car, becoming a companion, its owner coming over, lines heard and said); which way someone
// is from where it faces; a shared picture's caption; its look and recent tools.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { PlayerNav } from '../../shared/playernav.js';
import { Companions } from '../../server/companions/companions.js';
import { CarSeats } from '../../server/world/car-seats.js';
import { DatabaseSync } from '../../server/sqlite.js';
import { Senses, MODES, NEAR_M, SAW_MS, SENT_MS, tokensOf } from '../../server/senses/senses.js';
import { sideOf, compass, groundAt } from '../../server/senses/where.js';
import { Plan } from '../../server/sim/plan.js';
import { defaultIsland, Island, GroundQuery } from '../../shared/terrain.js';
import { generateIslandRoads } from '../../shared/island-roads.js';
import { makeGrid } from '../../shared/city.js';
import { sharedSpecies, Wildlife } from '../../server/world/wildlife.js';
import { FOOD } from '../../shared/food.js';
import { ctxOf } from '../../shared/constants.js';
import { sensesTools } from '../../server/senses/brain-tools.js';
import { Diary, MERGE_MS, MAX, EARS_MAX } from '../../server/senses/diary.js';

function setup({ settings = {} } = {}) {
  const world = generateWorld({ seed: 'senses-unit', population: 300 });
  const roster = [{ agentId: 's-agent-1', name: 'Lara', emoji: '🤖', role: 'Tester' }, { agentId: 's-agent-2', name: 'Juno', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 };
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `s-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `s-agent-${k}`, name: k === 1 ? 'Lara' : 'Juno', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, list: () => recs, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])), relations: () => [] };
  const nav = new PlayerNav(world);
  const players = { byId: new Map(), nav };
  const cars = new Map();
  const seats = new CarSeats({ places: id => (cars.has(id) ? 3 : 0), announce: () => {} });
  const S0 = { 'companions.waitMinutes': 5, 'awareness.enabled': true, 'awareness.defaultMode': 'together', ...settings };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: cars, seats }), agents, life: () => life, world: () => null, setting: k => S0[k],
    notify: () => {}, send: () => {}, principalFor: () => null, now: () => ms });
  comp.hookSim();
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE agent_awareness (world_id TEXT NOT NULL, agent_id INTEGER NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('off', 'ask', 'together', 'always')),
    updated INTEGER NOT NULL, updated_by INTEGER, PRIMARY KEY (world_id, agent_id))`);
  const senses = new Senses({ dbs: { db, worldId: 'w' }, sim: () => sim, agents, life: () => life, players, vehicles: () => ({ all: cars, seats }),
    companions: () => comp, setting: k => S0[k], accountName: () => 'Kim', now: () => ms });
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); senses.tick(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  const near = (i, d = 6) => { const e = at(i); for (let r = d; r < 80; r += 2) for (let a = 0; a < 12; a++) { const x = e.x + Math.sin(a) * r, z = e.z + Math.cos(a) * r; if (nav.ok(x, z, -1) && !nav.wet(x, z)) return { x, z }; } return null; };
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  return { world, sim, comp, senses, players, cars, seats, recs, run, until, at, near, idx, S0, P: { account: { id: 7, displayName: 'Kim', login: 'kim' } } };
}

/** An island beyond the city (shared/terrain.js), an AI agent held wherever the test puts it, a fake wildlife whose herds
 *  the test sets, and its owner (account 7, Kim) wherever the test puts them. */
function islandSetup() {
  const world = generateWorld({ seed: 'senses-island', population: 0 }), g = makeGrid(world.grid);
  world.terrain = defaultIsland({ seed: 'senses-island:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  world.roads = generateIslandRoads(new Island(world.terrain), world.grid);
  const I = new Island(world.terrain, { roads: world.roads }), G = new GroundQuery(I);
  const people = generatePopulation(world, new WorldIndex(world), { population: 30, roster: [{ agentId: 'i-1', name: 'Lara', emoji: '🤖', role: 'Tester' }] });
  let T = 100, ms = 1e6;
  const sim = new Sim(world, people, { budgetMs: 1e9, clock: { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 } });
  sim.now = () => T;
  sim.start();
  const i = people.findIndex(p => p?.agentId === 'i-1'), rec = { id: 1, key: 'i-1', name: 'Lara', enabled: true, ownerId: 7 };
  const agents = { get: id => (Number(id) === 1 ? rec : null), byKey: k => (k === 'i-1' ? rec : null), list: () => [rec] };
  const life = { byAgent: new Map([[1, i]]), relations: () => [] }, players = { byId: new Map(), ground: G };
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE agent_awareness (world_id TEXT, agent_id INTEGER, mode TEXT, updated INTEGER, updated_by INTEGER, PRIMARY KEY (world_id, agent_id))');
  const wild = { species: sharedSpecies(), t: 50, herds: [], view() { return { wt: this.t, herds: this.herds }; }, island: () => I, haunts(J) { return Wildlife.prototype.haunts.call(this, J); } };
  const cars = new Map();
  const S = new Senses({ dbs: { db, worldId: 'w' }, sim: () => sim, agents, life: () => life, players, wildlife: () => wild, vehicles: () => ({ all: cars, seats: null }), accountName: () => 'Kim', now: () => ms });
  // held at (x, z) facing yaw (0: +z ahead, +x on its left)
  const place = (x, z, yaw = 0) => { const P = new Plan(T, { x, y: 0, z, ctx: -1, yaw }); P.hold(1e6, 0, 0); sim.agents[i].plan = P; sim.agents[i].act = null; };
  // the first point of each kind of ground, on a spiral over the island
  const find = kind => {
    const c = world.terrain.center || { x: 0, z: 0 }, R = world.terrain.radius || 3000;
    for (let k = 0; k < 40000; k++) { const a = k * 2.399, r = R * (0.05 + (k % 37) / 37 * 1.1), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (groundAt(world, G, x, z)?.kind === kind) return { x, z }; }
    return null;
  };
  const herd = (id, s, at, pts, mode = 0, t1 = 60) => ({ id, s, m: pts.map(([dx, dz, ex = dx, ez = dz]) => [at.x + dx, at.z + dz, at.x + ex, at.z + ez, 40, t1, mode, 0, 0]) });
  return { world, g, G, I, sim, S, rec, wild, players, cars, place, find, herd, tick: (secs = 2) => { ms += secs * 1000; S.tick(); }, wait: s => { ms += s * 1000; } };
}

test('the ground underfoot: the beach, the woods, the water, a riverbank; the street and the sidewalk in the city', () => {
  const c = islandSetup(), { S, rec, g, world, G } = c;
  const beach = c.find('edge') || c.find('beach'), woods = c.find('forest'), water = c.find('water');
  assert.ok(beach && woods && water, 'a generated island has beaches, woods and water');
  c.place(beach.x, beach.z);
  assert.match(S.line(rec), /— outside on the beach( at the water's edge)?(, near «[^»]+»)?\./);
  assert.match(S.look(rec).text, /^Where: outside on the beach/);
  c.place(woods.x, woods.z);
  assert.match(S.whereWords(rec), /^outside in the woods/);
  c.place(water.x, water.z);
  assert.match(S.whereWords(rec), /^outside (swimming|wading) in the (sea|lake|river)/);
  const bank = c.find('riverbank');
  if (bank) { c.place(bank.x, bank.z); assert.match(S.whereWords(rec), /^outside on the riverbank/); }
  // in the city: the street between the blocks, the sidewalk along them
  const zMid = (g.Z[0] + g.Z[1]) / 2;
  assert.deepEqual(groundAt(world, G, g.X[1], zMid), { kind: 'street', words: 'in the street' });
  assert.deepEqual(groundAt(world, G, g.X[1] + g.hr + 1, zMid), { kind: 'sidewalk', words: 'on the sidewalk' });
  // (kept per cell: the same answer, and cheap, the second time)
  assert.equal(groundAt(world, G, woods.x + 0.2, woods.z), groundAt(world, G, woods.x, woods.z));
});

test('animals around it: herds near it counted and named after the people, which way they go; seen once in its diary', () => {
  const c = islandSetup(), { S, rec, wild, players } = c;
  const at = c.find('meadow') || c.find('field') || c.find('forest');
  c.place(at.x, at.z, 0);
  // three deer grazing about 10 m ahead (+z), a wild horse walking away 30 m on its left (+x), a wolf too far to see
  wild.herds = [c.herd('r:deer:0', 'deer', at, [[-1, 10], [1, 11], [0, 9]]), c.herd('r:horse:0', 'horse', at, [[28, 0, 60, 0]], 1, 80), c.herd('r:wolf:0', 'wolf', at, [[0, -160]])];
  players.byId.set(7, { id: 7, name: 'Kim', x: at.x - 6, z: at.z, ctx: -1, flags: 0, vehicleId: null });
  const L = S.look(rec, { account: 7 });
  assert.match(L.text, /Around you: Kim \(your owner, the one writing to you\) — here, 6 m away, on your right; 3 deer — grazing, about 10 m away, ahead of you; a wild horse — walking away, about \d+ m away, on your left\./);
  assert.doesNotMatch(L.text, /wol(f|ves)/, 'too far to see');
  assert.deepEqual(L.data.around.filter(x => x.kind === 'animal').map(x => [x.species, x.count]), [['deer', 3], ['horse', 1]]);
  // the diary: once when a herd comes near enough to notice (SAW_M: shy animals keep their distance), not again while it
  // stays, again after a while away
  c.tick(); c.tick(); c.tick(); c.tick(30);
  const saw = () => S.diary.read(1).filter(l => l.kind === 'saw').map(l => l.text);
  assert.equal(saw().filter(t => /deer/.test(t)).length, 1, saw().join(' | '));
  assert.match(saw().find(t => /deer/.test(t)), /^Saw 3 deer nearby, (in|on) /);
  wild.herds = [];
  c.tick(); c.wait(SAW_MS / 1000 + 5);
  wild.herds = [c.herd('r:deer:0', 'deer', at, [[0, 8], [1, 9], [-1, 9]])];
  c.tick();
  assert.equal(saw().filter(t => /deer/.test(t)).length, 2, 'back after a while: seen again');
  // indoors or in the city nothing is around but people
  wild.herds = [c.herd('r:deer:0', 'deer', { x: 0, z: 0 }, [[0, 3]])];
  c.place(0, 0);
  assert.doesNotMatch(S.look(rec).text, /Around you: [^\n]*deer/, 'no herd in the city');
});

test('its owner in sight: the line says where they are; out of sight, that they are not with it', () => {
  const c = islandSetup(), { S, rec, players } = c;
  const at = c.find('meadow') || c.find('forest');
  c.place(at.x, at.z, 0);
  players.byId.set(7, { id: 7, name: 'Kim', x: at.x + 25, z: at.z, ctx: -1, flags: 0, vehicleId: null });
  assert.match(S.line(rec, { account: 7 }), /\. Kim is about 25 m away, on your left \(not with you\)\.$/);
  assert.doesNotMatch(S.line(rec), /Kim/, 'the line for nobody in particular');
  const p = S.pack(rec, 7);
  assert.equal(p.told, 'line');
  assert.match(p.text, /Kim is about 25 m away, on your left \(not with you\)\. For more, look around: tool "look"/);
  assert.doesNotMatch(p.text, /not with you right now/, 'not denied when they stand there');
  players.byId.get(7).x = at.x + 300;
  assert.doesNotMatch(S.line(rec, { account: 7 }), /Kim/, 'far: nothing');
  assert.match(S.pack(rec, 7).text, /\(Kim is not with you right now\./);
  players.byId.get(7).ctx = 64;   // (indoors somewhere: not in sight however close)
  players.byId.get(7).x = at.x + 5;
  assert.doesNotMatch(S.line(rec, { account: 7 }), /Kim/);
});

test('the full picture says once what has not changed: unchanged sections are named, not repeated; a new conversation gets it all', () => {
  const c = islandSetup(), { S, rec } = c;
  const at = c.find('meadow') || c.find('forest');
  c.place(at.x, at.z);
  S.setMode(1, 'always');
  S.activities.add({ id: 'work', of: ({ self }) => (self ? { title: 'At work: Tester at «Lab 1»', lines: ['on shift until 6 PM'] } : null) });
  const places = [{ kind: 'cafe', name: 'Café 21', minutes: 4, price: 450 }];
  const first = S.pack(rec, 7, { since: null, places }).text;
  assert.match(first, /At work: Tester at «Lab 1»: on shift until 6 PM\./);
  assert.match(first, /Places near you \(use these exact names\): café «Café 21»/);
  assert.doesNotMatch(first, /Unchanged/);
  c.wait(30);
  const second = S.pack(rec, 7, { since: S.now() - 20000, places });
  assert.match(second.text, /^Where: /m, 'where it is: always');
  assert.match(second.text, /^Around you: /m);
  assert.match(second.text, /^Time: /m);
  assert.doesNotMatch(second.text, /At work:|Places near you \(/, 'what has not changed is not said again');
  assert.match(second.text, /\nUnchanged since the last message: (what is in view, )?your work, places near you\.$/, '(the island\'s water may be in view there too)');
  assert.ok(second.tokens < tokensOf(first), 'fewer words');
  // the places changed: not sent again (its look tool has them), only pointed to
  const third = S.pack(rec, 7, { since: S.now() - 1000, places: [{ kind: 'park', name: 'Elm Park', minutes: 2 }] }).text;
  assert.doesNotMatch(third, /Elm Park/);
  assert.match(third, /Unchanged since the last message: (what is in view, )?your work\.\nThe places near you now: look around \(tool "look"\)\./);
  // a new conversation, or a while without a message: everything again
  assert.doesNotMatch(S.pack(rec, 7, { since: null, places }).text, /Unchanged/);
  c.wait(SENT_MS / 1000 + 1);
  const later = S.pack(rec, 7, { since: S.now() - 1000, places }).text;
  assert.match(later, /At work: Tester/);
  assert.doesNotMatch(later, /Unchanged/);
  // its look tool always says it all
  assert.match(S.look(rec, { account: 7, places }).text, /At work: Tester[\s\S]*Places near you/);
});

test('its owner\'s bus: in a seat on Kim\'s bus, riding in your bus, Kim driving the bus you are in', () => {
  const c = setup(), S = c.senses, i = c.idx(1), lara = c.recs[0];
  c.run(1);
  const e = c.at(i);
  c.cars.set(60, { id: 60, k: 5, x: e.x, z: e.z, yaw: 0, v: 0, vx: 0, vz: 0, driver: 7 });
  c.players.byId.set(7, { id: 7, name: 'Kim', x: e.x, z: e.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: 60 });
  assert.equal(c.seats.seat(60, { kind: 'resident', id: i }), 1);
  assert.match(S.whereWords(lara), /^in a seat on Kim's bus, Kim driving/);
  assert.deepEqual(S.together(lara, 7), { yes: true, how: 'riding in your bus' });
  assert.match(S.look(lara, { account: 7 }).text, /Kim \(your owner, the one writing to you\) — driving the bus you are in, beside you, at the wheel/);
});

test('its owner chooses how much it is told; the installation\'s default and switch', () => {
  const c = setup(), S = c.senses, lara = c.recs[0];
  assert.deepEqual(MODES, ['off', 'ask', 'together', 'always']);
  assert.equal(S.modeOf(1), 'together', 'the default');
  assert.equal(S.ownMode(1), null);
  assert.equal(S.setMode(1, 'always', 7), 'always');
  assert.equal(S.modeOf(1), 'always');
  assert.equal(S.ownMode(1), 'always');
  assert.throws(() => S.setMode(1, 'loud'), /off, ask, together or always/);
  // (kept: a new Senses on the same database reads it back)
  const again = new Senses({ dbs: { db: S.db, worldId: 'w' }, sim: S.sim, agents: S.agents, life: S.lifeOf, setting: S.setting });
  assert.equal(again.modeOf(1), 'always');
  c.S0['awareness.enabled'] = false;
  assert.equal(S.modeOf(1), 'off', 'the installation switched it off for everyone');
  c.S0['awareness.enabled'] = true;
  assert.equal(S.setMode(1, null), 'together', 'back to the default');
  c.S0['awareness.defaultMode'] = 'ask';
  assert.equal(S.modeOf(1), 'ask');
  assert.equal(S.modeOf(lara.id), 'ask');
});

test('riding in its owner\'s car: exactly where it is, together, the full picture, and the diary of it', () => {
  const c = setup(), S = c.senses, i = c.idx(1), lara = c.recs[0];
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.run(2);   // (the diary's first look: where it is)
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to its owner');
  c.run(3);
  assert.equal(S.together(lara, 7).yes, true, 'with its owner');
  assert.match(S.together(lara, 7).how, /companion/);
  assert.equal(S.together(lara, 99).yes, false, 'not with someone else');
  // its companion, but stepped away (to sleep, eat, work): together only if it is really near
  const view = c.comp.view.bind(c.comp);
  c.comp.view = a => ({ ...view(a), state: 'away' });
  assert.equal(S.together(lara, 7).yes, true, 'stepped away, but right here: near');
  assert.match(S.together(lara, 7).how, /^(right beside you|near you)/, 'not "out with you"');
  const px = p.x; p.x += 400;
  assert.equal(S.together(lara, 7).yes, false, 'stepped away and far: apart');
  p.x = px; c.comp.view = view;
  // its owner gets in a sedan and drives north at 10 m/s (−z is north)
  c.cars.set(50, { id: 50, k: 0, x: p.x + 2, z: p.z, yaw: 0, v: 10, vx: 0, vz: -10, driver: 7 });
  p.vehicleId = 50;
  c.run(3);
  assert.ok(c.sim.agents[i].ride, 'in the car');
  const w = S.whereWords(lara);
  assert.match(w, /front passenger seat of Kim's sedan, Kim driving/);
  assert.match(w, /heading north at about 36 km\/h/);
  assert.deepEqual(S.together(lara, 7), { yes: true, how: 'riding in your car' });
  // what goes with its owner's message, in each mode
  const full = S.pack(lara, 7);
  assert.equal(full.mode, 'together');
  assert.equal(full.told, 'full');
  assert.match(full.text, /You and Kim are together right now: riding in your car/);
  assert.match(full.text, /Kim \(your owner, the one writing to you\) — driving the car you are in, beside you, at the wheel/);
  assert.match(full.text, /Got into Kim's sedan/, 'what happened lately');
  assert.ok(full.tokens > 40 && full.tokens < 500, `a bounded picture (${full.tokens} tokens)`);
  S.setMode(1, 'ask');
  const ask = S.pack(lara, 7);
  assert.equal(ask.told, 'pointer');
  assert.doesNotMatch(ask.text, /sedan/, 'only the time and that it may look');
  assert.match(ask.text, /tool "look"/);
  assert.equal(S.pack(lara, 7, { canLook: false }).told, 'line', 'a brain that can\'t look gets the line');
  S.setMode(1, 'off');
  const off = S.pack(lara, 7);
  assert.equal(off.told, 'none');
  assert.match(off.text, /switched off your awareness/);
  assert.equal(off.tools, false);
  // apart: the line in 'together', the full picture in 'always'
  S.setMode(1, null);
  p.vehicleId = null; p.x += 500; c.run(6);
  assert.equal(S.together(lara, 7).yes, true, 'still its companion, catching up');
  c.comp.command(c.P, { agent: 1, action: 'dismiss' });
  c.run(4);
  p.x += 500; c.run(2);   // (it had caught up: its owner walks off)
  assert.equal(S.together(lara, 7).yes, false, 'apart now');
  const line = S.pack(lara, 7);
  assert.equal(line.told, 'line');
  assert.match(line.text, /Kim is not with you right now/);
  assert.ok(line.tokens < 90, `one short line (${line.tokens} tokens)`);
  S.setMode(1, 'always');
  const always = S.pack(lara, 7);
  assert.equal(always.told, 'full');
  assert.match(always.text, /You and Kim are apart right now/);
  // the diary: what it lived, in order
  const d = S.diary.read(1).map(l => l.text);
  const k = n => d.findIndex(t => n.test(t));
  assert.ok(k(/^Became Kim's companion/) >= 0, d.join(' | '));
  assert.ok(k(/^Got into Kim's sedan \(the front passenger seat\)/) > k(/^Became Kim's companion/), d.join(' | '));
  assert.ok(k(/^Got out of Kim's sedan/) > k(/^Got into Kim's sedan/), d.join(' | '));
  assert.ok(k(/^Stopped being Kim companion|^Stopped being Kim's? companion/) > 0, d.join(' | '));
});

test('only what matters to the message: small talk gets where it is in short — no street, no speed — the rest a look away; a question about the way gets the place', () => {
  const c = setup(), S = c.senses, i = c.idx(1), lara = c.recs[0];
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.run(2);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }));
  c.cars.set(50, { id: 50, k: 0, x: p.x + 2, z: p.z, yaw: 0, v: 10, vx: 0, vz: -10, driver: 7 });
  p.vehicleId = 50;
  c.run(3);
  assert.ok(c.sim.agents[i].ride, 'in the car');
  // "how are you doing today?": nothing of its surroundings is needed
  const chat = S.pack(lara, 7, { only: new Set() });
  assert.equal(chat.told, 'full');
  assert.match(chat.text, /You and Kim are together right now: riding in your car/);
  assert.match(chat.text, /Where: in Kim's sedan/, 'where it is, in short');
  assert.doesNotMatch(chat.text, /km\/h|heading|Around you|Time:|Lately|Got into/, 'no speed, street, people, time or diary');
  assert.match(chat.text, /a look away: tool "look"/, 'the rest is a look away');
  assert.ok(chat.tokens < S.pack(lara, 7, { since: null }).tokens / 2, `far fewer words (${chat.tokens})`);
  // "how far is it?": the place and the way
  const way = S.pack(lara, 7, { only: new Set(['place']), since: null });
  assert.match(way.text, /heading north at about 36 km\/h/);
  assert.doesNotMatch(way.text, /Around you|Time:/);
  // "who's that?": who and what is around, not the speed
  const who = S.pack(lara, 7, { only: new Set(['around']), since: null });
  assert.match(who.text, /Around you:/);
  assert.doesNotMatch(who.text, /km\/h|Time:/);
  // its companion still on its way to them: not "together right now" — on its way, not beside them yet
  const far = { ...p, id: 8, name: 'Mo', x: p.x + 300, vehicleId: null };
  c.players.byId.set(8, far);
  c.comp.view = (v => a => ({ ...v(a), state: 'following' }))(c.comp.view.bind(c.comp));
  c.sim.agents[i].order = { ...c.sim.agents[i].order, kind: 'follow', lead: { kind: 'player', id: 8 } };
  const coming = S.pack(lara, 8, { only: new Set() });
  assert.match(coming.text, /^You are \S+'s companion, on your way to each other — not beside them yet \(about 300 m away\)\./);
  assert.doesNotMatch(coming.text, /together right now/);
  // not judged (no decision service): all of it, as before
  const all = S.pack(lara, 7, { since: null });
  assert.match(all.text, /km\/h/); assert.match(all.text, /Time:/); assert.doesNotMatch(all.text, /a look away/);
  // a brain that can't look around (another platform's): not told it may
  assert.doesNotMatch(S.pack(lara, 7, { only: new Set(), canLook: false }).text, /tool "look"/);
});

test('lines out loud near it are heard, its own are said; which way someone is from where it faces', () => {
  const c = setup(), S = c.senses, i = c.idx(1), j = c.idx(2);
  c.run(2);
  const me = c.at(i);
  S.heard({ t: 'say', i, text: 'Lovely day for it.' });
  assert.match(S.diary.read(1).at(-1).text, /^You said: «Lovely day for it\.»/);
  // a line from someone far away is not heard
  const far = c.sim.people.findIndex((p, k) => { if (!p || k === i) return false; const e = evalPlan(c.sim.agents[k].plan, c.sim.now()); return e.ctx !== me.ctx || Math.hypot(e.x - me.x, e.z - me.z) > 40; });
  S.heard({ t: 'say', i: far, text: 'Nobody hears this.' });
  assert.ok(!S.diary.read(1).some(l => /Nobody hears this/.test(l.text)));
  // a player in proximity chat near it
  c.players.byId.set(8, { id: 8, name: 'Sam', x: me.x + 3, z: me.z, ctx: me.ctx, flags: 0 });
  S.heardPlayer(c.players.byId.get(8), 'Hi Lara!');
  assert.match(S.diary.read(1).at(-1).text, /^Sam: «Hi Lara!»/);
  assert.equal(S.diary.read(2).some(l => /Hi Lara/.test(l.text)), j >= 0 && (() => { const e = c.at(j); return e.ctx === me.ctx && Math.hypot(e.x - me.x - 3, e.z - me.z) <= 12; })());
  // facing +z (yaw 0): +x is on its left, −x on its right, +z ahead, −z behind
  assert.equal(sideOf(0, 5, 0), 'on your left');
  assert.equal(sideOf(0, -5, 0), 'on your right');
  assert.equal(sideOf(0, 0, 5), 'ahead of you');
  assert.equal(sideOf(0, 0, -5), 'behind you');
  assert.equal(sideOf(Math.PI / 2, 0, -5), 'on your left', 'facing +x, −z is its left');
  assert.equal(sideOf(Math.PI / 2, 0, 5), 'on your right');
  assert.equal(compass(0, -1), 'north');
  assert.equal(compass(1, 0), 'east');
});

test('a picture of the city its owner shared: who is in it, checked against the world', () => {
  const c = setup(), S = c.senses, i = c.idx(1), j = c.idx(2), lara = c.recs[0];
  c.run(1);
  const e = c.at(i);
  c.players.byId.set(7, { id: 7, name: 'Kim', x: e.x + 4, z: e.z, ctx: e.ctx, flags: 0 });
  const far = { x: e.x + 5000, z: e.z };
  const cap = S.viewNote(lara, 7, { cam: { x: e.x + 6, y: 2, z: e.z, ctx: e.ctx, yaw: 0 }, visible: [{ kind: 'resident', i }, { kind: 'player', id: 7 }, { kind: 'resident', i: 99999 }], at: S.now() });
  assert.match(cap, /^This picture is Kim's own view of the city, taken just now/);
  assert.match(cap, /Lara \(that's you\)/);
  assert.match(cap, /Kim/);
  assert.equal(S.viewNote(lara, 7, { cam: { x: 'here', z: 1 }, visible: [] }), null, 'not a camera');
  assert.equal(S.viewNote(lara, 7, null), null);
  assert.equal(S.viewNote(lara, 7, { cam: { ...far, ctx: -1 }, visible: [{ kind: 'resident', i }] }).includes('Lara'), false, 'someone far from that camera is left out');
  assert.equal(S.viewNote(lara, 7, { cam: { x: e.x, z: e.z, ctx: -1 }, visible: [], at: S.now() - 60 * 60e3 }), null, 'too old to say');
  void j;
});

test('its look and recent tools: what it looked up is kept; off, only its own day', () => {
  const c = setup(), S = c.senses, lara = c.recs[0];
  c.run(2);
  S.note(1, 'move', 'Went into «Café 21»');
  const box = sensesTools(S, lara, 7, { mode: 'together', today: [{ when: '9:00 AM', label: 'Breakfast at home' }] });
  assert.deepEqual(box.names, ['look', 'recent']);
  const r = box.run([{ tool: 'look' }, { tool: 'recent' }, { tool: 'nope' }]);
  assert.equal(r.length, 2);
  assert.match(r[0].text, /^Where: /);
  assert.match(r[1].text, /Today so far: 9:00 AM Breakfast at home/);
  assert.match(r[1].text, /Went into «Café 21»/);
  assert.deepEqual(box.used.map(u => u.tool), ['look', 'recent']);
  const off = sensesTools(S, lara, 7, { mode: 'off', today: [{ when: '9:00 AM', label: 'Breakfast at home' }] });
  assert.deepEqual(off.names, ['recent']);
  assert.equal(off.run([{ tool: 'look' }]).length, 0, 'it can\'t look around');
  assert.doesNotMatch(off.run([{ tool: 'recent' }])[0].text, /Café 21/, 'only its own day');
});

test('the diary: bounded, lines about the same thing close together merge', () => {
  let t = 0;
  const d = new Diary({ now: () => t, clock: () => '1:00 PM' });
  for (let k = 0; k < 100; k++) { t += 1000; d.add(1, 'move', `line ${k}`); }
  assert.equal(d.read(1).length, MAX);
  assert.equal(d.read(1)[0].text, 'line 40');
  // what it heard is kept apart: a busy room's talk never pushes out what it did
  for (let k = 0; k < 100; k++) { t += 1000; d.add(1, 'heard', `talk ${k}`); }
  assert.equal(d.read(1).length, MAX + EARS_MAX);
  assert.equal(d.read(1).filter(l => l.kind === 'move').length, MAX, 'everything it did still there');
  assert.equal(d.read(1).at(-1).text, 'talk 99');
  t += 1000; d.add(1, 'with', 'Kim came over', { key: 'owner' });
  t += 1000; d.add(1, 'with', 'Kim came over', { key: 'owner' });
  assert.equal(d.read(1).at(-1).text, 'Kim came over');
  assert.notEqual(d.read(1).at(-2).text, 'Kim came over', 'the same again soon: one line');
  assert.equal(d.read(1).at(-1).at, t, 'its time moved on');
  t += 1000; d.add(1, 'move', 'Got into Kim\'s sedan', { key: 'car' });
  t += 1000; d.add(1, 'move', 'Got out of Kim\'s sedan', { key: 'car' });
  assert.deepEqual(d.read(1).slice(-2).map(l => l.text), ['Got into Kim\'s sedan', 'Got out of Kim\'s sedan'], 'different moments stay apart');
  t += MERGE_MS + 1; d.add(1, 'move', 'Got out of Kim\'s sedan', { key: 'car' });
  assert.equal(d.read(1).at(-2).text, 'Got out of Kim\'s sedan', 'a while later: a line of its own');
  assert.equal(d.read(1, { since: t - 1 }).length, 1);
  assert.equal(d.read(1, { limit: 2 }).length, 2);
  assert.equal(d.add(1, 'note', '   '), null);
  void NEAR_M;
});

test('its eyes: only from where the writer\'s page draws the world — near their character, in the same space', () => {
  const c = islandSetup(), { S, rec, players } = c;
  const at = c.find('meadow') || c.find('forest');
  c.place(at.x, at.z, 0);
  assert.equal(S.eyesFor(rec, 7), null, 'its owner has no character in the world: no page draws it');
  players.byId.set(7, { id: 7, name: 'Kim', x: at.x + 12, z: at.z, ctx: -1, flags: 0, vehicleId: null });
  const e = S.eyesFor(rec, 7);
  assert.ok(e && Number.isInteger(e.i) && e.ctx === -1 && e.d === 12, JSON.stringify(e));
  assert.ok(Math.abs(e.x - at.x) < 0.11 && Math.abs(e.z - at.z) < 0.11, 'from where it stands');
  assert.equal(S.eyesFor(rec, 8), null, 'not for someone with no character here');
  assert.equal(S.eyesFor(rec, null), null);
  players.byId.get(7).x = at.x + 45;
  assert.equal(S.eyesFor(rec, 7), null, 'across the way: their page does not have its place drawn as it sees it');
  players.byId.get(7).x = at.x + 5; players.byId.get(7).ctx = 64;
  assert.equal(S.eyesFor(rec, 7), null, 'its owner indoors, it outside: not the same space');
  players.byId.get(7).ctx = -1; players.byId.get(7).vehicleId = 9;
  assert.ok(S.eyesFor(rec, 7), 'its owner in a car beside it: outside all the same');
});

test('its owner talking with it in person: still with them — not "stepped away"; someone else: stepped away, and who', () => {
  const c = setup(), S = c.senses, i = c.idx(1), lara = c.recs[0];
  const spot = c.near(i, 8);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to its owner');
  c.run(3);
  // (its owner talks with it in the chat window in Play mode: it stops and turns to them — server/agent-talk/ face())
  assert.ok(c.sim.hold(i, p.x, p.z, undefined, '', null, null, 7));
  c.run(1);
  const v = c.comp.view(c.sim.agents[i]);
  assert.notEqual(v.state, 'away', 'with them');
  assert.equal(v.talking, true);
  assert.equal(v.doing, 'Talking with you');
  const w = S.companionWords(lara);
  assert.doesNotMatch(w, /stepped away/);
  assert.match(w, /^you are Kim's companion, beside them, talking with them$/);
  assert.match(S.together(lara, 7).how, /out with you, as your companion/);
  assert.match(S.look(lara, { account: 7 }).text, /talking with them/);
  // (someone else walks up and talks with it: it stepped away from its owner for them — and says who)
  assert.ok(c.sim.hold(i, p.x + 1, p.z, undefined, '', null, 'Sam', 8));
  c.run(1);
  const v2 = c.comp.view(c.sim.agents[i]);
  assert.equal(v2.state, 'away'); assert.equal(v2.talking, false);
  assert.match(S.companionWords(lara), /stepped away: talking with sam/);
});

test('in view: a car on its side after a crash (and who was driving it), a parked one; a waterfall, a lake, the river from the land itself', () => {
  const c = islandSetup(), { S, rec, cars, wild, I } = c;
  const at = c.find('meadow') || c.find('field') || c.find('forest');
  c.place(at.x, at.z, 0);
  // (2026-11-18: Kim's car rolled over in a meadow beside them; his companions said there was no car)
  const side = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) };
  cars.set(5, { id: 5, k: 0, x: at.x, z: at.z + 6, v: 0, driver: 0, lastDriver: 7, rotation: side });
  cars.set(6, { id: 6, k: 3, x: at.x + 20, z: at.z, v: 0, driver: 0, rotation: { x: 0, y: 0, z: 0, w: 1 } });
  cars.set(7, { id: 7, k: 0, x: at.x + 400, z: at.z, v: 0, driver: 0, rotation: side });
  const L = S.look(rec, { account: 7 });
  assert.match(L.text, /In view: a sedan \(Kim was driving it\) — on its side — it has rolled over, 6 m away, ahead of you; a van — parked, about 20 m away, on your left/);
  assert.doesNotMatch(L.text, /about 400 m/, 'too far to see');
  cars.get(5).rotation = { x: 1, y: 0, z: 0, w: 0 };
  assert.match(S.look(rec, { account: 7 }).text, /a sedan \(Kim was driving it\) — upside down on its roof — it has crashed/);
  cars.clear();
  // a waterfall from the island's own rivers: seen from a few hundred metres, which way
  const H = wild.haunts(I);
  if (H.count.falls) {
    const f = H.near('falls', at.x, at.z, 1e6);
    let spot = null;
    for (let r = 60; r < 400 && !spot; r += 20) for (let k = 0; k < 16 && !spot; k++) {
      const x = f.x + Math.cos(k * 0.39) * r, z = f.z + Math.sin(k * 0.39) * r, g = groundAt(c.world, c.G, x, z);
      if (g && g.kind !== 'water' && g.kind !== 'edge') spot = { x, z };
    }
    if (spot) {
      c.place(spot.x, spot.z, 0);
      assert.match(S.look(rec, { account: 7 }).text, /In view: [^\n]*a waterfall — about \d+ m away, /, 'a waterfall in view');
    }
  }
  // nothing to see in the city's streets but what is there
  c.place(0, 0);
  assert.doesNotMatch(S.look(rec).text, /a waterfall/);
});

test('its food and drink: what it was really served, nothing in front of it where food is served, what the one beside it is having', () => {
  const c = setup(), { sim, senses, recs } = c, i = c.idx(1), j = c.idx(2);
  const v = sim.index.venues.restaurant.find(x => x.f === 0) || sim.index.venues.restaurant[0];
  assert.ok(v, 'a restaurant');
  const ctx = ctxOf(v.b, v.f), at = sim.brain.standAt(ctx, v.x, v.z);
  const T = sim.now();
  const hold = (k, x, z) => { const P = new Plan(T, { x, y: 0, z, ctx, yaw: 0 }); P.hold(1e6, 0, 0); sim.agents[k].plan = P; sim.agents[k].act = null; sim.agents[k].order = null; };
  hold(i, at.x, at.z);
  hold(j, at.x + 1, at.z);
  // (2026-11-18: Lara "had a croissant" for twenty minutes with nothing on the table)
  let L = senses.look(recs[0], { account: 7 }).text;
  assert.match(L, /Your food and drink: nothing — no food or drink in front of you: you have not ordered anything here \(to eat or drink something, use the tool eat_with/);
  // what it was served (and Sam said "pho" over what he really had)
  const dish = FOOD.find(f => f.course === 'main'), drink = FOOD.find(f => f.course === 'drink');
  sim.agents[i].act = { kind: 'meal', use: 'eat', label: 'Lunch', place: 'Restaurant 16', order: [dish.id, drink.id], holdStart: T - 5, holdEnd: T + 600, b: v.b, f: v.f, id: -1, k: -1 };
  L = senses.look(recs[0], { account: 7, only: new Set(['place']) }).text;
  assert.match(L, new RegExp(`Your food and drink: you are eating ${dish.name.toLowerCase()} and ${drink.name.toLowerCase()} at «Restaurant 16» — that is all that is in front of you`), 'said whatever the message is about');
  // ordered, not there yet
  sim.agents[i].act.holdStart = T + 30;
  assert.match(senses.look(recs[0], { account: 7 }).text, /you ordered .+; you are on your way to your seat — not eating yet/);
  // the one beside it: what they are having, as anyone at the next seat sees it
  sim.agents[i].act = null;
  sim.agents[j].act = { kind: 'meal', use: 'eat', label: 'Lunch at Restaurant 16', place: 'Restaurant 16', order: [dish.id], holdStart: T - 5, holdEnd: T + 600, b: v.b, f: v.f, id: -1, k: -1 };
  assert.match(senses.look(recs[0], { account: 7 }).text, new RegExp(`Juno \\(another of your owner's agents\\) — lunch at restaurant 16 — having ${dish.name.toLowerCase()}`));
  // outdoors with nothing: nothing said about food at all
  const out = c.near(i, 20) || { x: 0, z: 0 };
  const P = new Plan(T, { x: out.x, y: 0, z: out.z, ctx: -1, yaw: 0 }); P.hold(1e6, 0, 0); sim.agents[i].plan = P;
  assert.doesNotMatch(senses.look(recs[0], { account: 7 }).text, /Your food and drink/);
});

test('its owner\'s meal at their seat: what they are having, in the note whatever the message is about', async () => {
  const { writerMealActivity } = await import('../../server/senses/activities.js');
  const { PF_USING } = await import('../../shared/playerproto.js');
  const dish = FOOD.find(f => f.course === 'main'), drink = FOOD.find(f => f.course === 'drink');
  const p = { id: 7, flags: PF_USING };
  const env = { players: { byId: new Map([[7, p]]), mealOf: q => (q === p ? { ids: [dish.id, drink.id] } : null) } };
  const card = writerMealActivity.of({ env, account: 7, who: 'Kim', self: false });
  assert.equal(card.title, 'Kim\'s food and drink');
  assert.equal(card.lines[0], `Kim is having ${dish.name.toLowerCase()} and ${drink.name.toLowerCase()} at their table — what they ordered`);
  assert.equal(writerMealActivity.of({ env, account: 7, who: 'Kim', self: true }), null, 'its own is the meal card\'s');
  p.flags = 0;
  assert.equal(writerMealActivity.of({ env, account: 7, who: 'Kim', self: false }), null, 'up from their table: nothing');
});
