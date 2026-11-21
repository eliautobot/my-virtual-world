// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents at the airport (server/play/flight-crew.js), in a living city (the real simulation, companions, fleet and play
// core): a companion gets into its owner's aircraft with them (a passenger seat of its own, hidden in its seat and carried
// along), one with no seat left stays on the ground and says so and waits there for them to land, both are back with them
// when they step out; asked in plain words, or its Free Will's choice from the registry; an agent walks out to an aircraft
// and flies a ring course itself — the fleet shares its aircraft's poses with everyone near, its run is judged by the
// module's own check and recorded as its own, and it lands, gets out and goes back to its owner's side; the registry's
// 'airport' source (what is offered where, honest refusals).
import assert from 'node:assert/strict';
import test from 'node:test';
import { openDb } from '../../server/db.js';
import { tempDir } from '../helpers/server.mjs';
import { PlayCore } from '../../server/play/play.js';
import { FlightCrew } from '../../server/play/flight-crew.js';
import { Fleet } from '../../server/world/aircraft.js';
import { Interactions } from '../../server/interactions/registry.js';
import { makeContext } from '../../server/interactions/context.js';
import { verifyFlight, COURSE_BY_ID } from '../../shared/airport.js';
import { STANDS } from '../../shared/airport-layout.js';
import { whereOf } from '../../server/senses/where.js';

const OWNER = 7, LARA = 1, MAX = 2;

/** A city with its residents and two AI agents of OWNER's (Lara, Max), the simulation running on a test clock; an airport
 *  laid on open ground next to Lara (its prop stand p1 there); the fleet, a play core on a throwaway database, the flight
 *  crew and the companions over them. */
async function city() {
  const { generateWorld } = await import('../../server/world/generate.js');
  const { generatePopulation } = await import('../../server/sim/population.js');
  const { WorldIndex } = await import('../../server/sim/windex.js');
  const { Sim } = await import('../../server/sim/sim.js');
  const { evalPlan } = await import('../../server/sim/plan.js');
  const { PlayerNav } = await import('../../shared/playernav.js');
  const { Companions } = await import('../../server/companions/companions.js');
  const { CarSeats } = await import('../../server/world/car-seats.js');
  const world = generateWorld({ seed: 'flight-crew-city', population: 200 });
  const people = generatePopulation(world, new WorldIndex(world), { population: 200, roster: [{ agentId: 'air-1', name: 'Lara', emoji: '🛩️', role: 'Pilot' }, { agentId: 'air-2', name: 'Max', emoji: '🚁', role: 'Pilot' }] });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  const C = { T: 0, ms: 1e6 };
  sim.now = () => C.T; sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 10 * 3600, dayScale: 16 }; sim.start();
  const iL = people.findIndex(p => p?.agentId === 'air-1'), iM = people.findIndex(p => p?.agentId === 'air-2');
  const recs = [{ id: LARA, key: 'air-1', name: 'Lara', emoji: '🛩️', enabled: true, ownerId: OWNER }, { id: MAX, key: 'air-2', name: 'Max', emoji: '🚁', enabled: true, ownerId: OWNER }];
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs, isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const nav = new PlayerNav(world), frames = [], notes = [], said = [];
  const players = { byId: new Map(), nav, canPlay: () => true, toAccount: (id, m) => frames.push({ id, ...m }) };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats: new CarSeats({ places: () => 0 }) }), agents, life: () => ({ byAgent: new Map([[LARA, iL], [MAX, iM]]) }), world: () => null, setting: () => undefined, now: () => C.ms });
  comp.hookSim();
  // open ground beside Lara for the airport's propeller stand (the airport frame: rot 0 — f along +z, s along +x)
  const e0 = evalPlan(sim.agents[iL].plan, C.T);
  let spot = null;
  for (let r = 10; r < 120 && !spot; r += 2) for (let k = 0; k < 16; k++) {
    const x = e0.x + Math.sin(k * 0.4) * r, z = e0.z + Math.cos(k * 0.4) * r;
    if ([[0, 0], [3, 0], [-3, 0], [0, 4], [0, -4], [6, 0]].every(([dx, dz]) => nav.ok(x + dx, z + dz, -1) && !nav.wet(x + dx, z + dz))) { spot = { x, z }; break; }
  }
  assert.ok(spot, 'open ground near Lara');
  const p1 = STANDS.find(s => s.id === 'p1'), gy = e0.y ?? 0;
  const m = { id: 'wm1', kind: 'airport', name: 'Sky Harbour', x: spot.x - p1.s, z: spot.z - p1.f, y: gy, rot: 0 };
  const W = { worldModules: [m], buildings: [] };
  const fleet = new Fleet({ world: () => W, players, now: () => C.ms, groundAt: () => gy });
  const dir = tempDir('mvw-flight-crew-'), dbs = openDb(dir);
  const play = new PlayCore({ dbs, now: () => C.ms, contextFor: (id, where) => (id === 'airport' && where === m.id ? { airport: { id: m.id, x: m.x, z: m.z, y: m.y, yaw: m.rot }, clearAt: () => gy } : { airport: null }) });
  const crew = new FlightCrew({ play, fleet: () => fleet, players, sim: () => sim, agents, companions: () => comp, world: () => W,
    ground: () => ({ height: () => gy, water: () => null, roof: () => -Infinity, hit: () => null }),
    say: (i, text) => said.push({ i, text }), toAccount: (id, f) => frames.push({ id, ...f }), note: (id, kind, text) => notes.push({ id, kind, text }), now: () => C.ms });
  comp.flight = crew;
  const reg = new Interactions({ contextFor: makeContext({ sim: () => sim, companions: () => comp, life: () => ({ byAgent: new Map([[LARA, iL], [MAX, iM]]) }), players }) });
  reg.add(crew.source());
  comp.ctxOf = rec => reg.contextFor(rec);
  /** Real seconds go by: the flights ten times a second, the city and the companions twice. */
  const run = secs => { const end = C.ms + secs * 1000; while (C.ms < end) { C.ms += 100; C.T += 0.1; crew.tick(); if (Math.round(C.ms / 100) % 5 === 0) { sim.tick(); sim.flush(); comp.tick(); } } };
  const at = i => evalPlan(sim.agents[i].plan, C.T);
  const owner = { id: OWNER, name: 'Kim', x: spot.x, y: gy, z: spot.z, ctx: -1, yaw: 0, flags: 0, vehicleId: null, aircraftId: null, ver: 0, dirty: false, lastAt: 0, seq: 0 };
  players.byId.set(OWNER, owner);
  const P = { account: { id: OWNER, displayName: 'Kim', login: 'kim' } };
  const ws = { pid: OWNER, readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
  return { world, sim, C, iL, iM, recs, comp, fleet, play, crew, reg, run, at, owner, P, ws, frames, notes, said, m, spot, gy, players, dbs, close: () => dbs.close?.() };
}
/** The owner, standing beside aircraft A, gets in (the fleet's own boarding). */
function ownerBoards(R, A) {
  const at = R.fleet.place(A);
  Object.assign(R.owner, { x: at.x + 5, z: at.z, y: R.gy });
  R.fleet.board(R.ws, { id: A.id });
  assert.equal(R.owner.aircraftId, A.id, R.ws.sent.at(-1)?.text);
}
/** Its owner flies aircraft A: poses at real speeds (the fleet checks them), out and up and back down on its stand. */
function ownerFlies(R, A, { secs = 20, v = 40 } = {}) {
  const h0 = A.home.yaw, q = [0, Math.sin(h0 / 2), 0, Math.cos(h0 / 2)], gearH = 1.3;
  let x = A.home.x, z = A.home.z, y = R.gy + gearH, ts = 0;
  const pose = (g, vv) => { ts += 0.5; R.fleet.pose(R.ws, { x, y, z, q, v: vv, g, ts }); };
  for (let k = 0; k < secs * 2; k++) {   // out and climbing
    const vv = Math.min(v, 6 + k * 3); x += Math.sin(h0) * vv * 0.5; z += Math.cos(h0) * vv * 0.5; y = R.gy + gearH + Math.max(0, (k - 8) * 4);
    pose(y > R.gy + gearH + 0.5 ? 0 : 1, vv); R.C.ms += 500; R.C.T += 0.5; R.crew.tick(); R.sim.tick(); R.sim.flush(); R.comp.tick();
  }
  return { back: () => {   // back down and home, stopped on its stand
    for (let k = 0; k < secs * 2; k++) {
      const left = Math.hypot(x - A.home.x, z - A.home.z), step = Math.min(left, v * 0.5);
      if (left > 0.01) { x -= (x - A.home.x) / left * step; z -= (z - A.home.z) / left * step; }
      y = Math.max(R.gy + gearH, y - 8);
      pose(y <= R.gy + gearH + 0.01 ? 1 : 0, left > 1 ? 20 : 0); R.C.ms += 500; R.C.T += 0.5; R.crew.tick(); R.sim.tick(); R.sim.flush(); R.comp.tick();
    }
    pose(1, 0);
  } };
}

test('a companion flies with its owner: in their aircraft with them (a seat of its own, hidden and carried along), the next one with no seat left waits on the ground, both back with them when they step out', async () => {
  const R = await city();
  try {
    for (const id of [LARA, MAX]) assert.equal(R.comp.command(R.P, { agent: id, action: 'follow', target: 'me' }).ok, true);
    for (let k = 0; k < 300 && [R.iL, R.iM].some(i => Math.hypot(R.at(i).x - R.owner.x, R.at(i).z - R.owner.z) > 5); k++) R.run(1);
    for (const i of [R.iL, R.iM]) assert.ok(Math.hypot(R.at(i).x - R.owner.x, R.at(i).z - R.owner.z) <= 5, 'both came over to their owner');
    // the owner gets into the propeller plane on its stand (one passenger seat): the first in, the other stays
    const A = R.fleet.all.get('wm1:p1');
    ownerBoards(R, A);
    R.run(2);
    const aboard = [R.iL, R.iM].filter(i => R.sim.agents[i].ride?.aircraft === A.id);
    assert.equal(aboard.length, 1, 'one passenger seat: one aboard');
    const inI = aboard[0], outI = inI === R.iL ? R.iM : R.iL, inId = inI === R.iL ? LARA : MAX, outId = inId === LARA ? MAX : LARA;
    assert.equal(R.fleet.seats.of(A.id)[0]?.id, inI, 'its seat kept by the fleet (the back seat)');
    assert.ok(R.notes.some(n => n.id === inId && /^Got into Kim's propeller plane with them — the back seat/.test(n.text)), 'its diary');
    assert.ok(R.frames.some(f => f.id === OWNER && f.t === 'crew_note' && /got in with you — the back seat of your propeller plane/.test(f.text)), 'its owner\'s page');
    assert.ok(R.notes.some(n => n.id === outId && /propeller plane was full \(it takes 1 passenger\) — you stayed on the ground/.test(n.text)), 'the one left out says why');
    assert.ok(R.frames.some(f => f.id === OWNER && /stays on the ground — your propeller plane has no free seat/.test(f.text)));
    const v = R.comp.view(R.sim.agents[inI]);
    assert.equal(v.state, 'riding'); assert.equal(v.air.role, 'passenger'); assert.equal(v.air.seatWords, 'the back seat');
    // up and away: carried along hidden in its seat; the other waits where it stood (it doesn't run after a plane)
    const stood = R.at(outI);
    const fl = ownerFlies(R, A, { secs: 15 });
    R.run(1);
    const e = R.at(inI), seat = R.crew.seatAt(A, 1);
    assert.ok(e.s.flags & 1, 'hidden in the simulation (the models paint their windows on: nobody inside is drawn)');
    assert.ok(Math.hypot(e.x - seat.x, e.z - seat.z) < 25 && e.y > R.gy + 20, `in its seat up in the air (${Math.hypot(e.x - seat.x, e.z - seat.z).toFixed(1)} m from it, ${(e.y - R.gy).toFixed(0)} m up)`);
    assert.ok(Math.hypot(R.at(outI).x - stood.x, R.at(outI).z - stood.z) < 8, 'the one left behind waits on the ground');
    assert.equal(R.comp.view(R.sim.agents[outI]).state, 'waiting');
    assert.match(R.comp.view(R.sim.agents[outI]).doing, /Waiting for Kim to land the propeller plane/);
    assert.ok(R.notes.some(n => n.id === outId && /took off in the propeller plane without you — you are waiting on the ground/.test(n.text)));
    const w = whereOf({ sim: R.sim, fleet: R.fleet, players: R.players }, inI);
    assert.match(w.text, /^in the back seat of Kim's propeller plane, Kim flying, about \d+ m above the ground/, w.text);
    assert.equal(R.sim.agents[inI].ride.use, 'fly', 'flying: its fun need rises (shared/catalog.js USES.fly)');
    // home again: stopped on its stand, the owner steps out — out beside them, seen, the other comes over
    fl.back();
    R.fleet.exit(R.ws);
    assert.equal(R.owner.aircraftId, null, 'the owner is out');
    R.run(3);
    assert.equal(R.sim.agents[inI].ride, null, 'out of the plane');
    assert.equal(R.fleet.seats.of(A.id).length, 0, 'its seat free again');
    assert.ok(R.notes.some(n => n.id === inId && /^Got out of Kim's propeller plane with them/.test(n.text)));
    R.run(12);
    for (const i of [inI, outI]) { const x = R.at(i); assert.ok(!(x.s?.flags & 1) && Math.hypot(x.x - R.owner.x, x.z - R.owner.z) < 8, 'beside its owner again, seen'); }
  } finally { R.close(); }
});

test('asked in plain words ("come fly with me"), or its Free Will\'s choice from the registry: in with them; nothing to get into, said so', async () => {
  const R = await city();
  try {
    assert.equal(R.comp.command(R.P, { agent: LARA, action: 'follow', target: 'me' }).ok, true);
    for (let k = 0; k < 300 && Math.hypot(R.at(R.iL).x - R.owner.x, R.at(R.iL).z - R.owner.z) > 5; k++) R.run(1);
    const rec = R.recs[0];
    // nothing to get into yet: no
    const no = R.comp.heard(R.P, rec, 'Lara, come fly with me');
    assert.equal(no.action, 'fly'); assert.equal(no.ok, false); assert.match(no.text, /not in an aircraft/);
    // its Free Will decides: it doesn't get in by itself — the moment is offered (its diary), the registry has 'board'
    R.comp.decides = () => true;
    const A = R.fleet.all.get('wm1:p1');
    ownerBoards(R, A);
    R.run(2);
    assert.ok(!R.sim.agents[R.iL].ride, 'its Free Will decides: not in by itself');
    assert.ok(R.notes.some(n => n.id === LARA && n.kind === 'activity' && /got into the propeller plane — there is room for you \(1 of 1 passenger seat free\)/.test(n.text)), 'the moment, offered');
    const opts = R.reg.nearFor(rec);
    const b = opts.find(x => x.id === `airport:board:${A.id}`);
    assert.ok(b && b.withLeader && /^Get into Kim's propeller plane with them and fly along/.test(b.label), JSON.stringify(opts.map(x => x.id)));
    assert.equal(opts[0].id, b.id, 'joining its owner comes first');
    const r = R.reg.doFor(rec, b.id);
    assert.equal(r.ok, true, r.text); assert.match(r.brain, /you got into Kim's propeller plane with them \(the back seat\)/);
    assert.equal(R.sim.agents[R.iL].ride?.aircraft, A.id);
    // out with them (the owner steps out on the stand), then in again by the reflex's words
    R.fleet.exit(R.ws); R.run(3);
    assert.equal(R.sim.agents[R.iL].ride, null);
    ownerBoards(R, A);
    const yes = R.comp.heard(R.P, rec, 'get in the plane');
    assert.equal(yes.action, 'fly'); assert.equal(yes.ok, true, yes.text);
    assert.equal(R.sim.agents[R.iL].ride?.aircraft, A.id, 'in by its owner\'s words');
    // "get in" (the car's words) while its owner sits in an aircraft: into that
    R.fleet.exit(R.ws); R.run(3); ownerBoards(R, A);
    assert.equal(R.comp.heard(R.P, rec, 'get in').ok, true);
    assert.equal(R.sim.agents[R.iL].ride?.aircraft, A.id);
  } finally { R.close(); }
});

test('at the controls: an agent walks out to a free plane, its autopilot flies a ring course for real (shared with everyone near), judged by the module\'s own check and recorded as its own; it lands, gets out and is back at its owner\'s side', async () => {
  const R = await city();
  try {
    const rec = R.recs[0];
    assert.equal(R.comp.command(R.P, { agent: LARA, action: 'follow', target: 'me' }).ok, true);
    for (let k = 0; k < 300 && Math.hypot(R.at(R.iL).x - R.owner.x, R.at(R.iL).z - R.owner.z) > 5; k++) R.run(1);
    // what the airport offers it: the courses open to it (only the first, at first), in a free aircraft of their class
    const opts = R.reg.nearFor(rec).filter(x => x.source === 'airport');
    assert.deepEqual(opts.map(x => x.id), ['airport:fly:first-flight'], 'only First Flight is open to a new pilot');
    assert.match(opts[0].label, /^Fly First Flight in the propeller plane \(not flown yet\)$/);
    // a course not open to it: no
    const locked = R.crew.fly(R.reg.contextFor(rec), 'coast-cruise');
    assert.equal(locked.ok, false); assert.match(locked.text, /finish First Flight first/);
    const finished = [];
    R.play.on(ev => { if (ev.type === 'finish' && ev.account === -LARA) finished.push(ev); });
    const r = R.reg.doFor(rec, 'airport:fly:first-flight');
    assert.equal(r.ok, true, r.text); assert.match(r.text, /walking out to the propeller plane to fly First Flight/);
    const A = R.fleet.all.get('wm1:p1');
    assert.equal(A.pilot, -LARA, 'the plane is its own now'); assert.equal(A.pilotName, 'Lara');
    // somebody else can't take it meanwhile
    R.owner.x = A.home.x + 4; R.owner.z = A.home.z; R.fleet.board(R.ws, { id: A.id });
    assert.match(R.ws.sent.at(-1).text, /Lara is flying it/);
    // it walks out (the simulation's walk: everyone sees it go), then in
    const from = R.at(R.iL);
    for (let k = 0; k < 120 && R.crew.view(LARA)?.phase === 'walking out'; k++) R.run(1);
    assert.notEqual(R.crew.view(LARA).phase, 'walking out', 'it got to the plane');
    void from;
    // the flight: a real one — the fleet shares its poses as anyone's aircraft (its name as the pilot)
    R.run(60);
    const viewer = { readyState: 1, pid: 99, view: { x: A.home.x, z: A.home.z }, got: [], send(s) { this.got.push(JSON.parse(s)); } };
    R.fleet.sentVer = -2; R.fleet.tick([viewer]);
    const row = viewer.got.at(-1)?.near?.find(x => x[0] === A.id);
    assert.ok(row && row[1] === 'prop' && row[2] === 1 && row[row.length - 1] === 'Lara', 'every page near draws its plane flying, Lara at the controls');
    assert.ok(R.at(R.iL).s.flags & 1, 'its body hidden at the controls');
    assert.match(R.comp.view(R.sim.agents[R.iL]).doing, /Flying First Flight in the propeller plane/);
    for (let k = 0; k < 600 && R.crew.view(LARA); k++) R.run(1);
    assert.equal(R.crew.view(LARA), null, 'its flight is over');
    // its run: through every ring, reported from its own path, the module's check said yes — recorded as its own
    assert.equal(finished.length, 1, 'one run reported');
    const res = finished[0].result;
    assert.equal(res.ok, true); assert.ok(res.score > 0 && res.score <= COURSE_BY_ID['first-flight'].limit, `${res.score} s`);
    const best = R.play.progress(-LARA).modules.airport.best['first-flight'];
    assert.equal(best.score, res.score, 'its own best on First Flight');
    assert.ok(R.play.progress(-LARA).modules.airport.unlocked.includes('coast-cruise'), 'and the next course opens to it');
    assert.ok(R.frames.some(f => f.id === OWNER && /^✈️ Lara flew First Flight in /.test(f.text)), 'its owner\'s page hears its time');
    assert.ok(R.said.some(s => s.i === R.iL && /First Flight: /.test(s.text)), 'said out loud');
    // landed: the plane back on its stand, its body out beside it and back with its owner (its order as before)
    assert.equal(A.pilot, null); assert.equal(A.mode, 'stand', 'back on its stand');
    assert.equal(R.sim.agents[R.iL].ride, null);
    assert.equal(R.sim.agents[R.iL].order?.kind, 'follow', 'its owner\'s companion again');
    R.run(15);
    const e = R.at(R.iL);
    assert.ok(!(e.s?.flags & 1) && Math.hypot(e.x - R.owner.x, e.z - R.owner.z) < 8, 'beside its owner again, seen');
    // what it offers now: its best said, and the next course
    const now = R.reg.nearFor(rec).filter(x => x.source === 'airport').map(x => x.label);
    assert.ok(now.some(l => /^Fly First Flight in the propeller plane \(your best: [\d:.]+ ★+\)$/.test(l)), now.join(' | '));
    assert.ok(now.some(l => /^Fly Coastline Cruise in the propeller plane/.test(l)));
  } finally { R.close(); }
});

test('its run is its own flight path: the report the play core judged is a path the module\'s check accepts, and nothing is recorded for a flight given up', async () => {
  const R = await city();
  try {
    const rec = R.recs[1];
    // Max on his own (no order) walks out to the helicopter … then is told to give it up before he is through
    const e = R.at(R.iM), h1 = R.fleet.all.get('wm1:h1');
    // (his body put at the airport: the helipads, beside h1)
    R.sim.brain.interruptSoon(R.sim.agents[R.iM], { x: h1.home.x + 6, y: R.gy, z: h1.home.z, ctx: -1 });
    R.run(1);
    void e;
    const ctx = R.reg.contextFor(rec);
    // the helicopter's courses are not open to him yet: First Flight is (a propeller plane free on its stand)
    assert.deepEqual(R.reg.nearFor(rec).filter(x => x.source === 'airport').map(x => x.id), ['airport:fly:first-flight']);
    let reported = null;
    R.play.on(ev => { if (ev.account === -MAX && ev.type === 'finish') reported = ev; });
    assert.equal(R.crew.fly(ctx, 'first-flight').ok, true);
    for (let k = 0; k < 200 && !(R.crew.view(MAX)?.passes >= 1); k++) R.run(1);
    assert.ok(R.crew.view(MAX)?.passes >= 1, 'through the gate');
    const stop = R.reg.nearFor(rec).find(x => x.id === 'airport:stop');
    assert.ok(stop && /^Give up First Flight and fly back to land/.test(stop.label));
    assert.equal(R.reg.doFor(rec, 'airport:stop').ok, true);
    assert.equal(R.play.runOf(-MAX), null, 'the run given up: nothing recorded');
    for (let k = 0; k < 600 && R.crew.view(MAX); k++) R.run(1);
    assert.equal(reported, null);
    assert.equal(R.play.progress(-MAX).modules.airport.runs, 0);
    assert.equal(R.fleet.all.get('wm1:p1').pilot, null, 'the plane landed and was given back');
    assert.equal(R.sim.agents[R.iM].ride, null);
    assert.equal(R.sim.agents[R.iM].order, null, 'back to his own day');
    assert.ok(R.notes.some(n => n.id === MAX && /Got out of the propeller plane/.test(n.text)));
    // a flight the agent did finish: its own report passes the module's own check once more, from the outside
    R.run(2);
    const go = R.crew.fly(R.reg.contextFor(rec), 'first-flight');
    assert.equal(go.ok, true, go.text);
    let report = null;
    const orig = R.play.finish.bind(R.play);
    R.play.finish = (acct, id, rep) => { report = { rep, run: R.play.runs.get(id) }; return orig(acct, id, rep); };
    for (let k = 0; k < 900 && R.crew.view(MAX); k++) R.run(1);
    assert.ok(report, 'reported');
    const again = verifyFlight(COURSE_BY_ID['first-flight'], report.rep, { serverMs: 3600e3, data: report.run.data });
    assert.equal(again.ok, true, again.why);
    assert.equal(report.rep.aircraft, 'prop');
  } finally { R.close(); }
});
