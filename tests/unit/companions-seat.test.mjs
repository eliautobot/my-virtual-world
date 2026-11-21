// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions sitting down with their leader (server/sim/companion-moves.js seats, server/companions/companions.js sit, eat,
// stand, autoSeat) on a generated city with a virtual clock: told to sit while its player sits on a park bench, it takes
// the bench's other end (held for it: nobody else sits there) and sits; it gets up and follows when the player walks off;
// a full bench is an honest no (its brain is told it could not); at a restaurant table it joins the meal — at the same
// table, ordering as residents do there and paying from its own money (the real economy), or only sitting when it can't
// pay; 'stand'; without Free Will it sits down by itself once its player has sat a few seconds, and gets up with them.
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { setPlayerSpots } from '../../server/sim/agents.js';
import { PlayerNav } from '../../shared/playernav.js';
import { PF_USING } from '../../shared/playerproto.js';
import { SEATED } from '../../shared/anims.js';
import { toWorld } from '../../shared/geom.js';
import { Companions } from '../../server/companions/companions.js';
import { economyModel } from '../helpers/econ-model.mjs';
import { companionLine } from '../../server/companions/brain-tools.js';
import { foodName } from '../../shared/food.js';

afterEach(() => setPlayerSpots(null));

function setup({ econ = false } = {}) {
  const world = generateWorld({ seed: 'companions-unit', population: 300 });
  const roster = [{ agentId: 'c-agent-1', name: 'Riley', emoji: '🤖', role: 'Tester' }, { agentId: 'c-agent-2', name: 'Max', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 12 * 3600, dayScale: 16 };
  // the real economy on a throwaway database: what residents buy is charged as on a server (sim.onAct)
  let model = null;
  if (econ) {
    model = economyModel({ city: { world, people } });
    model.econ.parts.businesses.sync();
    const H = model.econ.parts.households;
    sim.econ = H;
    sim.onAct = (a, act) => H.onAct(a, act);
  }
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `c-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `c-agent-${k}`, name: k === 1 ? 'Riley' : 'Max', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) };
  const nav = new PlayerNav(world);
  const players = { byId: new Map(), nav };
  // (as the server does: players at furniture — a seat indoors, a park's bench outdoors — are nobody else's place)
  setPlayerSpots(() => { const out = []; for (const p of players.byId.values()) if ((p.flags & PF_USING) && p.ctx >= -1) out.push({ x: p.x, z: p.z, ctx: p.ctx }); return out; });
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats: null }), agents, life: () => life, world: () => null,
    setting: k => ({ 'companions.waitMinutes': 5 })[k], notify: () => {}, send: () => {}, principalFor: () => null, now: () => ms });
  comp.hookSim();
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  const close = () => model?.close();
  return { world, sim, comp, players, nav, recs, run, until, at, idx, model, close, P: { account: { id: 7, displayName: 'Kim', login: 'kim' } }, t: () => T };
}

/** Where one stands to sit on seat s (its approach point). */
function approach(c, s) { const sl = c.sim.index.entry(s.b, s.f, s.id).slots[s.k]; return toWorld(c.world.buildings[s.b], sl.ax, sl.az); }
const free = (c, s) => !c.sim.brain.taken(s.b, s.f, s.id, s.k, -1);
/** A park bench (both ends free) nearest body i, that a player can walk up to: { s0, s1, ap }. */
function parkBench(c, i) {
  const e = c.at(i), B = c.sim.brain;
  let best = null, bd = Infinity;
  for (const v of c.sim.index.venues.park) for (const r of B.seatsOn(v.b, v.f).list) {
    if (r.t !== 'bench' || r.k !== 0) continue;
    const s0 = B.seatInfo(v.b, v.f, r.id, 0), s1 = B.seatInfo(v.b, v.f, r.id, 1), ap = approach(c, s0);
    if (!free(c, s0) || !free(c, s1) || !c.nav.ok(ap.x, ap.z, -1)) continue;
    const d = Math.hypot(ap.x - e.x, ap.z - e.z);
    if (d < bd) { bd = d; best = { s0, s1, ap }; }
  }
  return best;
}
/** A restaurant's four-seat table (not its bar's stools) on its ground floor (all free) nearest body i: { seats: [4], ap (to sit on the first) }. */
function restaurantTable(c, i) {
  const e = c.at(i), B = c.sim.brain;
  let best = null, bd = Infinity;
  for (const v of c.sim.index.venues.restaurant) {
    if (v.f !== 0) continue;
    const by = new Map();
    for (const r of B.seatsOn(v.b, v.f).list) if (r.use === 'eat' && /table/.test(r.t)) (by.get(r.id) || by.set(r.id, []).get(r.id)).push(r);
    for (const [id, l] of by) {
      if (l.length !== 4) continue;
      const seats = l.map(r => B.seatInfo(v.b, v.f, id, r.k));
      if (!seats.every(s => free(c, s))) continue;
      const d = Math.hypot(v.x - e.x, v.z - e.z);
      if (d < bd) { bd = d; best = { seats, ap: approach(c, seats[0]) }; }
    }
  }
  return best;
}
/** The player at its seat (their page's PF_USING; the sim told, as the server does: playerTook). */
function sitDown(c, p, s) { p.x = s.x; p.z = s.z; p.flags |= PF_USING; c.sim.brain.playerTook(p.x, p.z, p.ctx); }
/** Body i sitting on seat s now (there, staying, in a sitting clip). */
function seatedOn(c, i, s) { const e = c.at(i); return Math.hypot(e.x - s.x, e.z - s.z) < 0.35 && !!e.s?.h && SEATED.has(e.s.anim); }
/** The player walks `dist` m from where it stands in a direction it can (steps the server would accept). */
function walkOff(c, p, dist) {
  for (let k = 0; k < 16; k++) {
    const dx = Math.sin(k * 0.39), dz = Math.cos(k * 0.39);
    let ok = true;
    for (let s = 0.5; s <= dist && ok; s += 0.5) ok = c.nav.ok(p.x + dx * s, p.z + dz * s, p.ctx);
    if (!ok) continue;
    for (let s = 0; s < dist; s += 0.4) { p.x += dx * 0.4; p.z += dz * 0.4; c.run(0.25, 0.25); }
    return true;
  }
  return false;
}
/** Agent k follows the player and is beside it. */
function withPlayer(c, k, p) {
  const i = c.idx(k);
  assert.equal(c.comp.command(c.P, { agent: k, action: 'follow', target: 'me' }).ok, true);
  assert.ok(c.until(() => { const e = c.at(i); return c.sim.brain.sameSpace(e.ctx, p.ctx) && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }, 900), 'it came to the player');
  c.run(3);
  return i;
}

test('a park bench: told to sit, it takes the other end (held for it) and sits; it stays while the player sits; up and following when they walk off', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i];
  c.comp.decides = () => true;   // (Free Will decides: nothing by itself here)
  const bn = parkBench(c, i);
  assert.ok(bn, 'a park bench');
  const p = { id: 7, name: 'Kim', x: bn.ap.x, z: bn.ap.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  withPlayer(c, 1, p);
  sitDown(c, p, bn.s0);
  assert.equal(c.comp.leaderSeat(7)?.words, 'a bench', 'where the player sits, in words');
  assert.equal(c.comp.leaderSeat(7)?.venue?.kind, 'park');
  const r = c.comp.command(c.P, { agent: 1, action: 'sit' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.action, 'sit');
  assert.match(r.text, /^Riley (sits down|is going over to sit down) on a bench beside you$/);
  assert.match(r.brain, /^you (sat down|are walking over to sit down) on a bench beside Kim/);
  assert.equal(A.order.kind, 'follow', 'still a companion\'s follow order (not an order of its own)');
  assert.equal(A.order.seat.key, bn.s1.key, 'the bench\'s other end');
  assert.ok(c.until(() => seatedOn(c, i, bn.s1), 30), 'it sat down there');
  assert.equal(A.act.use, 'bench');
  assert.match(A.act.label, /^Sitting with Kim/);
  // held for it: nobody else sits there
  const j = c.sim.agents.findIndex((x, k) => k !== i && x?.plan);
  assert.ok(c.sim.brain.taken(bn.s1.b, bn.s1.f, bn.s1.id, 1, j), 'the seat is held for it');
  const v = c.comp.list(c.P).companions[0];
  assert.equal(v.state, 'following');
  assert.equal(v.doing, 'Sitting with you on a bench');
  assert.deepEqual([v.seat.words, v.seat.use, v.seat.item, v.seat.mode], ['a bench', 'bench', 'bench', 'sit']);
  // the player sits on: so does it (rounds of sitting, no getting up in between)
  const up = [];
  for (let s = 0; s < 60; s += 2) { c.run(2); if (!seatedOn(c, i, bn.s1)) up.push(s); }
  assert.deepEqual(up, [], 'it stayed sitting');
  // the player gets up and stands there: it sits on (told to sit, not only because they did)
  p.flags = 0; p.x = bn.ap.x; p.z = bn.ap.z;
  c.run(6);
  assert.ok(seatedOn(c, i, bn.s1), 'still sitting while they stand near');
  // they walk off: it gets up and follows
  assert.ok(walkOff(c, p, 9), 'somewhere to walk');
  assert.ok(c.until(() => !A.order.seat && !SEATED.has(c.at(i).s?.anim), 10), 'it got up');
  assert.ok(c.until(() => Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 3.5, 30), 'and followed them');
  assert.equal(A.order.kind, 'follow');
  assert.equal(c.comp.list(c.P).companions[0].seat, null);
  assert.ok(!c.sim.brain.taken(bn.s1.b, bn.s1.f, bn.s1.id, 1, j), 'its seat free again');
  c.close();
});

test('every seat near the player taken: an honest no, its brain told it could not sit; "stand" when not sitting', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i];
  c.comp.decides = () => true;
  const bn = parkBench(c, i);
  const p = { id: 7, name: 'Kim', x: bn.ap.x, z: bn.ap.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  withPlayer(c, 1, p);
  sitDown(c, p, bn.s0);
  // the other end and every other seat within a few metres held by residents
  const B = c.sim.brain, others = c.sim.agents.filter((x, k) => k !== i && x?.plan && !x.p.vip);
  let n = 0;
  for (const r of B.seatsOn(bn.s0.b, bn.s0.f).list) {
    const s = B.seatInfo(bn.s0.b, bn.s0.f, r.id, r.k);
    if (s.key === bn.s0.key || Math.hypot(s.x - bn.s0.x, s.z - bn.s0.z) > 12 && r.id !== bn.s0.id) continue;   // (every seat it would take: the bench's other end, those within a few metres, and a few steps further — SEAT_FAR_M)
    if (!B.taken(s.b, s.f, s.id, s.k, i)) assert.ok(B.reserve(others[n++], s.b, s.f, s.id, s.k), 'held by a resident');
  }
  const r = c.comp.command(c.P, { agent: 1, action: 'sit' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'full');
  assert.equal(r.text, 'Riley can\'t sit down: every seat near you is taken');
  assert.equal(r.brain, 'you could not sit down: every seat near Kim is taken');
  assert.doesNotMatch(r.brain, /sat down/);
  assert.ok(!A.order.seat, 'no seat');
  assert.equal(A.order.kind, 'follow', 'still with them');
  c.run(5);
  assert.ok(!SEATED.has(c.at(i).s?.anim), 'standing');
  // 'eat' at a park bench: no table, no food
  const e = c.comp.command(c.P, { agent: 1, action: 'eat' });
  assert.deepEqual([e.ok, e.reason], [false, 'not_food']);
  assert.equal(e.brain, 'you could not join Kim\'s meal: Kim is not at a place that serves food');
  const s = c.comp.command(c.P, { agent: 1, action: 'stand' });
  assert.equal(s.ok, true);
  assert.match(s.brain, /you were not sitting down/);
  c.close();
});

test('a restaurant: the player at a table, "eat" — at the same table, its order on its act and its own money spent; it can\'t pay: it only sits; "stand"; they leave: it gets up', () => {
  const c = setup({ econ: true }), i = c.idx(1), j = c.idx(2), A = c.sim.agents[i], M = c.sim.agents[j];
  c.comp.decides = () => true;
  const H = c.model.econ.parts.households;
  const tb = restaurantTable(c, i);
  assert.ok(tb, 'a restaurant table');
  const s0 = tb.seats[0];
  const p = { id: 7, name: 'Kim', x: tb.ap.x, z: tb.ap.z, y: 0, ctx: s0.ctx, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  withPlayer(c, 1, p);
  sitDown(c, p, s0);
  const before = H.available(A.p), receipts = (H.receipts.get(A.p.id) || []).length;
  const r = c.comp.command(c.P, { agent: 1, action: 'eat' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(A.order.seat.id, s0.id, 'at the same table');
  assert.notEqual(A.order.seat.k, s0.k);
  assert.ok(A.act.order?.length, 'what it ordered is on its act');
  assert.equal(A.act.kind, 'meal');
  assert.match(r.brain, /^you (sat down|are walking over to sit down) at a table at «.+» with Kim( \(the seat is kept for you\))? and ordered .+ \(.+ VC from your own money\); you are eating with Kim$/);
  assert.match(r.text, /^Riley (sits down|is going over to sit down) at a table at «.+» with you and orders .+$/);
  const rc = H.receipts.get(A.p.id);
  assert.equal(rc.length, receipts + 1, 'a bill');
  assert.equal(rc.at(-1).kind, 'restaurant');
  assert.ok(rc.at(-1).total > 0);
  assert.equal(H.available(A.p), before - rc.at(-1).total, 'paid from its own money');
  const seat = A.order.seat;
  assert.ok(c.until(() => seatedOn(c, i, seat), 30), 'it sat down at the table');
  assert.equal(A.act.use, 'eat');
  const v = c.comp.list(c.P).companions.find(x => x.agent === 1);
  assert.equal(v.state, 'following', 'with them, not stepped away');
  assert.match(v.doing, /^Eating with you at «.+»$/);
  assert.equal(v.seat.eating, true);
  // Max can't pay: it sits with them, no order, and its brain is told so
  withPlayer(c, 2, p);
  H.pending.set(M.p.id, 1e12);
  const m = c.comp.command(c.P, { agent: 2, action: 'eat' });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.match(m.brain, /but did not order anything: you have too little money — you are only sitting with Kim$/);
  assert.match(m.text, /but can't pay for anything$/);
  assert.equal(M.order.seat.id, s0.id, 'at the same table too');
  assert.ok(!M.act.order, 'nothing ordered');
  assert.equal((H.receipts.get(M.p.id) || []).filter(x => x.kind === 'restaurant').length, 0, 'no bill');
  // 'stand': Max gets up
  const st = c.comp.command(c.P, { agent: 2, action: 'stand' });
  assert.equal(st.ok, true);
  assert.match(st.brain, /^you got up from a table at «.+» and are standing beside Kim again$/);
  assert.ok(!M.order.seat);
  assert.ok(c.until(() => !SEATED.has(evalPlan(M.plan, c.t()).s?.anim), 10), 'Max stood up');
  // the player leaves the table and walks off: the meal is cut short, it gets up and goes with them
  p.flags = 0; p.x = tb.ap.x; p.z = tb.ap.z;
  const away = c.sim.brain.standAt(p.ctx, p.x + 9, p.z + 9) || c.sim.brain.standAt(p.ctx, p.x - 9, p.z - 9);
  p.x = away.x; p.z = away.z;
  assert.ok(c.until(() => !A.order.seat, 10), 'it got up');
  assert.ok(c.until(() => Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 4, 40), 'and went with them');
  c.close();
});

test('without Free Will it sits down by itself once its player has sat a few seconds, and gets up with them; with Free Will it waits to be told', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i];
  const bn = parkBench(c, i);
  const p = { id: 7, name: 'Kim', x: bn.ap.x, z: bn.ap.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  withPlayer(c, 1, p);
  assert.equal(c.comp.decides({ id: 1 }), false, 'the default: nobody\'s Free Will decides');
  sitDown(c, p, bn.s0);
  c.run(2);
  assert.ok(!A.order.seat, 'not at once');
  assert.ok(c.until(() => seatedOn(c, i, bn.s1), 20), 'it sat down beside them by itself');
  assert.equal(A.order.seat.auto, true);
  // the player gets up (still beside the bench): so does it
  p.flags = 0; p.x = bn.ap.x; p.z = bn.ap.z;
  assert.ok(c.until(() => !A.order.seat && !SEATED.has(c.at(i).s?.anim), 10), 'it got up with them');
  c.run(10);
  assert.ok(!SEATED.has(c.at(i).s?.anim), 'and stays up');
  // with Free Will: nothing by itself
  c.comp.decides = () => true;
  sitDown(c, p, bn.s0);
  c.run(12);
  assert.ok(!A.order.seat, 'it waits to be told');
  assert.ok(!SEATED.has(c.at(i).s?.anim));
  c.close();
});

test('seatAt: a player or a resident on a seat, in plain words; nothing off a seat', () => {
  const c = setup(), B = c.sim.brain;
  const park = c.sim.index.venues.park[0], f = B.seatsOn(park.b, 0).list.find(r => r.t === 'fountain');
  const s = B.seatInfo(park.b, 0, f.id, f.k);
  assert.equal(B.seatAt(s.x + 0.3, s.z, -1)?.words, 'the edge of the fountain', 'outdoors, in the park\'s grounds');
  assert.equal(B.seatAt(s.x, s.z, s.ctx)?.key, s.key, 'on the park\'s own floor too');
  assert.equal(B.seatAt(s.x + 2, s.z + 2, -1)?.key === s.key, false);
  const rv = c.sim.index.venues.restaurant[0], t = B.seatsOn(rv.b, rv.f).list.find(r => r.use === 'eat' && /table/.test(r.t));
  const ts = B.seatInfo(rv.b, rv.f, t.id, t.k);
  assert.equal(B.seatAt(ts.x, ts.z, ts.ctx).words, `a table at «${B.placeName(rv.b, rv.f)}»`);
  assert.deepEqual(B.seatAt(ts.x, ts.z, ts.ctx).venue, { kind: 'restaurant', name: B.placeName(rv.b, rv.f) });
  assert.equal(B.seatAt(ts.x, ts.z, -1), null, 'not outdoors');
  assert.equal(B.seatAt(0, 0, -1), null);
  c.close();
});

test('its owner sitting and it standing: its brain is told so plainly (never "sitting across from you" while it stands); told to sit, then sitting', () => {
  const c = setup(), i = c.idx(1);
  c.comp.decides = () => true;   // (Free Will decides: it stays standing until something sits it down)
  const bn = parkBench(c, i);
  const p = { id: 7, name: 'Kim', x: bn.ap.x, z: bn.ap.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  withPlayer(c, 1, p);
  sitDown(c, p, bn.s0);
  c.run(2);
  const rec = c.recs[0];
  c.comp.lifeOf = () => ({ byAgent: new Map([[1, i]]) });
  const line = companionLine(c.comp, rec);
  assert.match(line, /is sitting on a bench; you are standing beside them, NOT sitting/, line);
  assert.match(line, /sit_down/);
  assert.equal(c.comp.command(c.P, { agent: 1, action: 'sit' }).ok, true);
  assert.ok(c.until(() => seatedOn(c, i, bn.s1), 30));
  assert.match(companionLine(c.comp, rec), /sitting with them on a bench/);
  c.close();
});

test('a player still sitting keeps their chair: a resident whose stay there was planned for later (beyond the hold\'s window when they sat) goes elsewhere as its time comes near — never on to them', () => {
  const c = setup(), B = c.sim.brain;
  const t = restaurantTable(c, c.idx(1));
  assert.ok(t, 'a restaurant table');
  const s = t.seats[0];
  // a resident's stay on that chair planned for 40 world minutes from now (as a plan made before the player sat down)
  const r = c.sim.agents.find((x, k) => x?.plan && !c.sim.people[k]?.agentId && !x.p.vip);
  const now = c.sim.now(), from = now + B.wm(40), to = now + B.wm(70);
  assert.ok(B.reserve(r, s.b, s.f, s.id, s.k, [from, to]), 'held for the resident later');
  B.holdFor(r, s.key, from, to);
  // the player sits down on it now
  const p = { id: 7, name: 'Kim', x: s.x, z: s.z, y: 0, ctx: s.ctx, yaw: 0, flags: PF_USING, vehicleId: null };
  c.players.byId.set(7, p);
  B.playerTook(p.x, p.z, p.ctx);
  const held = () => (B.res.get(s.key) || []).some(q => q[0] === r.i && q[2] > c.sim.now());
  assert.ok(held(), 'beyond the hold\'s window when they sat: still the resident\'s later stay');
  // time passes with the player still there: once the stay is within the window, it is sent elsewhere
  c.run(B.wm(20), 2);
  assert.ok(held(), 'by itself (no one asked again) it would still go there');
  B.keepPlayerSeats();
  c.run(2);
  assert.ok(!held(), 'the resident goes elsewhere: the chair stays the player\'s');
  c.close();
});

test('its owner\'s table though a resident booked a chair there for later in the day; what it chose from the menu is what it gets', () => {
  const c = setup({ econ: true }), i = c.idx(1), A = c.sim.agents[i], B = c.sim.brain;
  c.comp.decides = () => true;
  const tb = restaurantTable(c, i);
  assert.ok(tb, 'a restaurant table');
  const [s0, s1, s2, s3] = tb.seats;
  // every other chair at the table booked by residents for two hours from now (a busy restaurant's evening)
  const others = c.sim.agents.filter((x, k) => x?.plan && !c.sim.people[k]?.agentId && !x.p.vip);
  const now = c.sim.now();
  [s1, s2, s3].forEach((s, k) => { assert.ok(B.reserve(others[k], s.b, s.f, s.id, s.k, [now + B.wm(120), now + B.wm(160)])); B.holdFor(others[k], s.key, now + B.wm(120), now + B.wm(160)); });
  const p = { id: 7, name: 'Kim', x: tb.ap.x, z: tb.ap.z, y: 0, ctx: s0.ctx, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  withPlayer(c, 1, p);
  sitDown(c, p, s0);
  // its choice from the menu (in its own words: a dish's name)
  const menu = B.menuAt(s0.b, s0.f), want = menu.find(id => /burger|pasta|pizza|steak|salad|soup|curry|noodle/i.test(id)) || menu[0];
  const r = c.comp.command(c.P, { agent: 1, action: 'eat', items: [foodName(want)] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(A.order.seat.id, s0.id, 'at its owner\'s table — a booking for later in the day doesn\'t bar it');
  assert.deepEqual(A.act.order, [want], `what it chose (${foodName(want)}) is what it ordered`);
  assert.match(r.brain, new RegExp(`ordered ${foodName(want).toLowerCase()}`));
  c.close();
});

test('a place that serves food, its owner not at a table (on a sofa, standing at the counter): "eat" — a table near them there, its meal ordered; on while they stay in that place, over when they leave it', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i];
  const tb = restaurantTable(c, i);
  assert.ok(tb, 'a restaurant');
  const s0 = tb.seats[0];
  const p = { id: 7, name: 'Kim', x: tb.ap.x, z: tb.ap.z, y: 0, ctx: s0.ctx, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  withPlayer(c, 1, p);
  // (2026-11-18: in The Roastery with its owner on the sofa, the only way to eat was an errand to a table of its own)
  const r = c.comp.command(c.P, { agent: 1, action: 'eat' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(A.order.seat.mode, 'eat');
  assert.equal(A.order.seat.near, true, 'a table near them, not theirs');
  assert.ok(Math.hypot(A.order.seat.x - p.x, A.order.seat.z - p.z) <= 14, 'near them');
  assert.ok(A.order.seat.meal?.order?.length, 'its meal ordered');
  assert.match(r.brain, /^you (sat down|are walking over to sit down) at .+ and ordered .+; you are eating with Kim$/);
  assert.ok(c.until(() => seatedOn(c, i, A.order.seat), 120), 'it sat down to it');
  c.run(5);
  assert.ok(A.order.seat, 'eating on while they stand by in the same place');
  // they leave the place (out on the street): it gets up and goes on with them
  const B0 = c.world.buildings[s0.b];
  let out = null;
  for (let r = Math.max(B0.w, B0.d) / 2 + 2; r < 80 && !out; r += 2) for (let k = 0; k < 16 && !out; k++) { const x = B0.x + Math.sin(k * 0.39) * r, z = B0.z + Math.cos(k * 0.39) * r; if (c.nav.ok(x, z, -1)) out = { x, z }; }
  assert.ok(out, 'the street outside');
  Object.assign(p, { x: out.x, z: out.z, ctx: -1 });
  assert.ok(c.until(() => !A.order.seat, 60), 'up when they left');
  c.close();
});
