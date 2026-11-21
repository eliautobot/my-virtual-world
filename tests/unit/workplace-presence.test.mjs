// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who is at work (server/workplace/presence.js), on a generated city with a virtual clock: the staff lists come from the jobs
// and posts already there, with roles from the furniture; a status from what each body is doing — on duty, on the way,
// late past the late mark, away (out with someone: the reason in words), back; the moments (late, arrived, left, back)
// once each; and nothing at all is said about how things are when the server starts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { PlayerNav } from '../../shared/playernav.js';
import { Companions } from '../../server/companions/companions.js';
import { WorkPresence, roleAt } from '../../server/workplace/presence.js';

function setup({ population = 400, hour = 6 } = {}) {
  const world = generateWorld({ seed: 'work-presence-unit', population });
  const roster = [{ agentId: 'w-agent-1', name: 'Luke', emoji: '🎙', role: 'Radio host' }, { agentId: 'w-agent-2', name: 'Sara', emoji: '🎧', role: 'Radio host' }];
  const people = generatePopulation(world, new WorldIndex(world), { population, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: hour * 3600, dayScale: 16 };
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `w-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `w-agent-${k}`, name: k === 1 ? 'Luke' : 'Sara', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const nav = new PlayerNav(world), players = { byId: new Map(), nav };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map() }), agents, life: () => ({ byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) }), world: () => null,
    setting: () => undefined, notify: () => {}, send: () => {}, principalFor: () => null, now: () => ms });
  comp.hookSim();
  const settings = {};
  const work = new WorkPresence({ sim: () => sim, world: () => world, agents, setting: k => settings[k], playerName: id => players.byId.get(id)?.name || null, now: () => ms });
  const events = [];
  work.on(e => events.push({ type: e.type, i: e.i, lateBy: e.lateBy ?? null, awayMin: e.awayMin ?? null, reason: e.reason || e.status?.reason || '' }));
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); if (Math.round(T * 2) % 8 === 0) work.tick(); } };
  const until = (fn, secs = 600) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  return { world, sim, work, comp, players, events, run, until, idx, settings, P: { account: { id: 7, displayName: 'Kim', login: 'kim' } }, t: () => T };
}

/** Gives person i the seat of resident worker j (who becomes free), with hours start..end every day. */
function takeSeat(c, i, j, start, end) {
  const r = c.sim.people[j].job;
  c.sim.people[j].job = { kind: 'free', title: 'Between jobs' };
  c.sim.people[i].job = { kind: 'staff', b: r.b, f: r.f, id: r.id, k: r.k, start, end, days: 127, title: `Barista at ${c.sim.brain.placeName(r.b, r.f)}`, venue: r.venue };
  c.sim.setJob(j); c.sim.setJob(i);
  c.work.index(true);
}

test('the staff lists come from the jobs and posts already there: roles from the furniture, one workplace per venue floor or room', () => {
  const c = setup();
  c.work.index(true);
  const staff = c.sim.people.map((p, i) => [p, i]).filter(([p]) => p && ['office', 'staff'].includes(p.job?.kind));
  assert.ok(staff.length > 20, `workers in the city (${staff.length})`);
  for (const [, i] of staff) assert.ok(c.work.positionOf(i), `everyone with a job at a desk or counter has a position (${i})`);
  assert.ok(c.work.places.size > 5, 'several workplaces');
  for (const place of c.work.places.values()) {
    assert.ok(place.name && place.members.length, 'a named workplace with people');
    for (const i of place.members) assert.equal(c.work.positionOf(i).key, place.key);
  }
  // roles: from the piece, else the job's title
  assert.equal(roleAt('broadcast_desk', 0), 'radio host');
  assert.equal(roleAt('studio_dj', 0), 'DJ');
  assert.equal(roleAt('ou_pass', 0), 'cook');
  assert.equal(roleAt('checkout', 0), 'cashier');
  assert.equal(roleAt('reception', 0), 'receptionist');
  assert.equal(roleAt('desk', 0, { title: 'Accountant at Tower 3' }), 'Accountant');
  assert.equal(roleAt('cafe_counter', 0, { venue: 'cafe', title: 'Staff at X' }), 'barista');
  // every status is a known one, with words
  for (const [, i] of staff.slice(0, 200)) {
    const s = c.work.status(i);
    assert.ok(['on_duty', 'coming', 'late', 'away', 'break', 'off'].includes(s.state), s.state);
    assert.ok(s.text && s.role && s.place);
  }
});

test('a shift: on the way, on duty; nothing said about how things were when the server started', () => {
  const c = setup({ hour: 3 });
  // the first look: no moments at all, whatever state anyone is in
  c.work.tick();
  assert.equal(c.events.length, 0, 'nothing to speak of at the start');
  c.run(60);
  // through the start of the morning café shift (6:30): most of those working today get there, on duty
  c.until(() => c.sim.brain.hour(c.t()) >= 7.2, 4000);
  const cafe = c.sim.people.map((p, i) => [p, i]).filter(([p, i]) => p?.job?.kind === 'staff' && p.job.start === 6.5 && c.work.status(i).onShift);
  assert.ok(cafe.length > 0, 'morning café staff on shift today');
  const states = cafe.map(([, i]) => c.work.status(i).state);
  const on = states.filter(s => s === 'on_duty').length;
  assert.ok(on >= Math.ceil(cafe.length * 0.6), `most of the morning staff are on duty by 7:12 (${on}/${cafe.length}: ${states.join(',')})`);
  const arrived = c.events.filter(e => e.type === 'arrived');
  assert.ok(arrived.length >= on - 2, 'their arrival noticed');
  // each moment once a shift
  const seen = new Set();
  for (const e of c.events.filter(x => x.type === 'arrived' || x.type === 'late')) { const k = `${e.type}:${e.i}`; assert.ok(!seen.has(k), `once: ${k}`); seen.add(k); }
});

test('an agent taken out by its owner during its shift: away (out with its owner), then back; kept away past its start: late, with the reason', () => {
  const c = setup({ hour: 6 });
  const i = c.idx(1);
  const j = c.sim.people.findIndex((p, k) => k !== i && p?.job?.kind === 'staff' && p.job.venue === 'cafe');
  assert.ok(j >= 0, 'a café worker to swap with');
  const h0 = c.sim.brain.hour(c.t());
  takeSeat(c, i, j, Math.ceil((h0 + 0.3) * 4) / 4, 14);
  c.work.tick();
  // its shift starts: it goes there and is on duty
  assert.ok(c.until(() => c.work.status(i)?.state === 'on_duty', 4000), `on duty (${JSON.stringify(c.work.status(i))})`);
  c.run(20);
  // its owner (in Play mode, near it) takes it along
  const pos = c.work.positionOf(i), B = c.world.buildings[pos.b];
  const spot = c.players.nav.openGround(B.x + B.w, B.z + B.d) || { x: B.x, z: B.z };
  c.players.byId.set(7, { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null });
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(c.until(() => c.work.status(i).state === 'away', 120), 'away');
  const s = c.work.status(i);
  assert.equal(s.reason, 'out with Kim', 'its reason, in words anyone could see');
  assert.match(s.text, /^Away — out with Kim/);
  assert.ok(c.until(() => c.events.some(e => e.type === 'left' && e.i === i), 60), 'its leaving noticed');
  // the team knows: its co-workers see it away
  const mate = c.work.places.get(pos.key).members.find(x => x !== i);
  if (mate !== undefined) assert.ok(c.work.workOf(mate).team.some(x => x.i === i && x.state === 'away'), 'a co-worker sees it away');
  // let go: it heads back and is on duty again, its time away noticed
  c.run(60);
  c.comp.command(c.P, { agent: 1, action: 'dismiss' });
  // on its way back: away, on the way back, with when it will be there
  assert.ok(c.until(() => c.work.status(i).reason === 'on the way back', 300), `on the way back (${JSON.stringify(c.work.status(i))})`);
  assert.match(c.work.status(i).text, /^Away — on the way back \((back any moment|back in about \d+ min)\)$/);
  assert.ok(c.until(() => c.work.status(i).state === 'on_duty', 1200), `back on duty (${JSON.stringify(c.work.status(i))})`);
  c.run(6);   // (the next look notices it)
  const back = c.events.find(e => e.type === 'back' && e.i === i);
  assert.ok(back && back.awayMin > 0, `back, after some minutes away (${JSON.stringify(back)})`);
});

test('kept away from the start of its shift: late past the late mark (its reason), then arrived late — once', () => {
  const c = setup({ hour: 6 });
  const i = c.idx(2);
  const j = c.sim.people.findIndex((p, k) => k !== i && p?.job?.kind === 'staff' && p.job.venue === 'cafe');
  const h0 = c.sim.brain.hour(c.t());
  // its owner has it along before its shift starts
  const pos0 = c.sim.people[j].job, B = c.world.buildings[pos0.b];
  const spot = c.players.nav.openGround(B.x + B.w + 30, B.z) || { x: B.x, z: B.z };
  c.players.byId.set(7, { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null });
  takeSeat(c, i, j, Math.ceil((h0 + 0.25) * 4) / 4, 14);
  c.comp.command(c.P, { agent: 2, action: 'follow', target: 'me' });
  c.settings['work.lateMinutes'] = 5;
  // its shift starts while it is out: away, then late past 5 minutes
  assert.ok(c.until(() => c.work.status(i).state === 'late', 4000), `late (${JSON.stringify(c.work.status(i))})`);
  c.run(6);
  const s = c.work.status(i);
  assert.ok(s.lateBy >= 5, `late by at least the mark (${s.lateBy})`);
  assert.equal(s.reason, 'out with Kim');
  assert.match(s.text, /^Late \(\d+ min\) — out with Kim/);
  assert.ok(c.events.some(e => e.type === 'late' && e.i === i && /out with Kim/.test(e.reason)), 'its lateness noticed, with the reason');
  // let go: it goes to work, arrives late — once
  c.comp.command(c.P, { agent: 2, action: 'dismiss' });
  assert.ok(c.until(() => c.work.status(i).state === 'on_duty', 1500), 'there at last');
  c.run(6);
  const arr = c.events.filter(e => e.type === 'arrived' && e.i === i);
  assert.equal(arr.length, 1);
  assert.ok(arr[0].lateBy >= 5, `arrived late by ${arr[0].lateBy} min`);
  assert.match(arr[0].reason, /^out with Kim(, then .+)?$/, `got in late with the real reasons, what kept it (not "on the way"): ${arr[0].reason}`);
  assert.equal(c.events.filter(e => e.type === 'late' && e.i === i).length, 1, 'late said once');
});

test('the late mark is a setting; the look is quick over a whole city', () => {
  const c = setup({ population: 1500, hour: 7 });
  c.run(30);
  const t0 = performance.now();
  c.work.index(true);
  const build = performance.now() - t0;
  const t1 = performance.now();
  for (let k = 0; k < 5; k++) { c.work.cache.clear(); c.work.tick(); }
  const look = (performance.now() - t1) / 5;
  assert.ok(c.work.byPerson.size > 300, `many at work (${c.work.byPerson.size})`);
  assert.ok(build < 120, `the staff lists made in ${build.toFixed(1)} ms`);
  assert.ok(look < 60, `a look at everyone at work in ${look.toFixed(1)} ms`);
  c.settings['work.lateMinutes'] = 15;
  assert.equal(c.work.lateMinutes(), 15);
  c.settings['work.lateMinutes'] = 'x';
  assert.equal(c.work.lateMinutes(), 5, 'a bad value: the default');
});
