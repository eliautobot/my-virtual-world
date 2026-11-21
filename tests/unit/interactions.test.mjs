// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The interaction registry (server/interactions/): what an AI agent can do in the world, found from what the world
// declares, carried out by the sim with real effects and an honest result — on a generated city with a virtual clock and
// the real economy. A companion beside its player in an arcade plays the cabinet near them (billed its tokens from its
// own money), stops and follows when they walk off; an honest no when nothing is free; an agent on its own goes for a
// meal (one meal, the economy's bill, its hunger filled), goes shopping (its purchase at the checkout), uses a park's
// bench; the registry's own contract (an id that isn't there, a source that throws).
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
import { ctxOf } from '../../shared/constants.js';
import { toWorld } from '../../shared/geom.js';
import { USES } from '../../shared/catalog.js';
import { Companions } from '../../server/companions/companions.js';
import { createInteractions, Interactions } from '../../server/interactions/index.js';
import { worldTools } from '../../server/interactions/brain-tools.js';
import { economyModel } from '../helpers/econ-model.mjs';

afterEach(() => setPlayerSpots(null));

function setup() {
  const world = generateWorld({ seed: 'companions-unit', population: 300 });
  const roster = [{ agentId: 'c-agent-1', name: 'Riley', emoji: '🤖', role: 'Tester' }, { agentId: 'c-agent-2', name: 'Max', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 12 * 3600, dayScale: 16 };
  const model = economyModel({ city: { world, people } });
  model.econ.parts.businesses.sync();
  const H = model.econ.parts.households;
  sim.econ = H;
  sim.onAct = (a, act) => H.onAct(a, act);
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `c-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `c-agent-${k}`, name: k === 1 ? 'Riley' : 'Max', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) };
  const nav = new PlayerNav(world);
  const players = { byId: new Map(), nav };
  setPlayerSpots(() => { const out = []; for (const p of players.byId.values()) if ((p.flags & PF_USING) && p.ctx >= -1) out.push({ x: p.x, z: p.z, ctx: p.ctx }); return out; });
  const P = { account: { id: 7, displayName: 'Kim', login: 'kim' } };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats: null }), agents, life: () => life, world: () => null,
    setting: k => ({ 'companions.waitMinutes': 5 })[k], notify: () => {}, send: () => {}, principalFor: () => P, now: () => ms });
  comp.hookSim();
  comp.decides = () => true;   // (Free Will decides: nothing by itself here)
  const I = createInteractions({ sim: () => sim, companions: () => comp, life: () => life, players, principalFor: () => P, ownerOf: r => r.ownerId });
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  return { world, sim, comp, players, nav, recs, run, until, at, idx, model, H, I, P, close: () => model.close() };
}

/** A paid piece to use (an arcade's cabinet — else a gym's machine) on a public floor, one of its slots free and its
 *  approach point walkable: { v, ctx, use, ap, kind }. */
function paidPiece(c) {
  const B = c.sim.brain;
  for (const [kind, uses] of [['arcade', ['play']], ['gym', ['run', 'lift', 'yoga']]]) {
    for (const v of c.sim.index.venues[kind] || []) {
      const Bd = c.world.buildings[v.b], m = c.sim.index.slots(Bd.lv[v.f]);
      for (const [id, e] of m) for (const s of e.slots) {
        if (!uses.includes(s.use) || B.taken(v.b, v.f, id, s.k, -1)) continue;
        const ap = toWorld(Bd, s.ax, s.az);
        if (c.nav.ok(ap.x, ap.z, ctxOf(v.b, v.f))) return { v, ctx: ctxOf(v.b, v.f), use: s.use, ap, kind };
      }
    }
  }
  return null;
}

test('a companion beside its player at an arcade or a gym: the machines near them are offered (from the catalog\'s slots), it uses one for real — billed as a visit there — and follows when they walk off', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0];
  const ac = paidPiece(c);
  assert.ok(ac, 'an arcade or a gym with a free machine');
  // the player at a cabinet in the arcade
  const p = { id: 7, name: 'Kim', x: ac.ap.x, z: ac.ap.z, y: 0, ctx: ac.ctx, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  assert.equal(c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }).ok, true);
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === p.ctx && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }, 1500), 'it came to the player there');
  p.flags |= PF_USING; c.sim.brain.playerTook(p.x, p.z, p.ctx);
  c.run(2);
  const list = c.I.nearFor(rec, { limit: 20 });
  const plays = list.filter(x => x.source === 'furniture' && x.kind === ac.use);
  assert.ok(plays.length > 0, `${ac.use} is offered: ${list.map(x => x.label).join(' | ')}`);
  assert.ok(plays.every(x => /near Kim|with Kim/.test(x.label)), 'beside its player');
  assert.ok(list.filter(x => x.source === 'places').every(x => x.errand && /— then back to Kim$/.test(x.label)), 'out with them: only a quick errand and back');
  assert.ok(list.some(x => x.source === 'body' && x.kind === 'sit'), 'sitting down is there too');
  assert.ok(!list.some(x => x.kind === 'eat' && x.source === 'furniture'), 'no table sat at without food');
  const before = c.H.available(A.p);
  const pick = plays.find(x => x.withLeader) || plays[0];
  const r = c.I.doFor(rec, pick.id, { via: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.brain, new RegExp(`^you are ${USES[ac.use].label.toLowerCase()}`));
  assert.equal(A.order.kind, 'follow', 'still its companion');
  assert.equal(A.order.seat.mode, 'use');
  assert.ok(c.until(() => A.act?.use === ac.use && A.act.id === pick.piece.id && !!c.at(i).s?.h, 60), 'it is using that machine');
  assert.equal(A.act.label, `${USES[ac.use].label} with Kim`);
  assert.ok(c.until(() => !!c.comp.list(c.P).companions[0]?.using, 60), 'there, at it');
  const v = c.comp.list(c.P).companions[0];
  assert.equal(v.state, 'following');
  assert.equal(v.using?.use, ac.use);
  assert.equal(v.seat, null, 'not a seat');
  // its tokens: the economy's own bill, from its own money (one bill a visit)
  c.run(5);
  const rc = c.H.receipts.get(A.p.id) || [];
  assert.ok(rc.some(x => x.items.includes(ac.kind === 'arcade' ? 'game_tokens' : 'session')), `billed as a visit there: ${JSON.stringify(rc)}`);
  assert.ok(c.H.available(A.p) < before, 'from its own money');
  // the player leaves (out of the building, onto the street): it stops and follows
  p.flags = 0;
  const Bd = c.world.buildings[ac.v.b];
  let out = null;
  for (let r = 14; r < 40 && !out; r += 2) for (let k = 0; k < 24 && !out; k++) { const x = Bd.x + Math.sin(k * 0.26) * r, z = Bd.z + Math.cos(k * 0.26) * r; if (c.nav.ok(x, z, -1)) out = { x, z }; }
  assert.ok(out, 'the street outside');
  Object.assign(p, { x: out.x, z: out.z, ctx: -1 });
  assert.ok(c.until(() => !A.order.seat, 20), 'it stopped');
  assert.equal(A.order.kind, 'follow', 'still its companion');
  assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 4; }, 300), 'and followed them out');
  c.close();
});

test('an honest no: something taken meanwhile is "no longer there"; an id that isn\'t there; a source that throws', () => {
  const c = setup(), rec = c.recs[1];
  const r1 = c.I.doFor(rec, 'furniture:999.0.1.play');
  assert.equal(r1.ok, false);
  assert.match(r1.brain, /no longer there/);
  const r2 = c.I.doFor(rec, 'nothing:at:all');
  assert.equal(r2.ok, false);
  assert.match(r2.brain, /nothing like that/);
  const R = new Interactions({ contextFor: () => ({}) });
  R.add({ id: 'boom', near: () => [{ key: 'x', kind: 'use', label: 'A thing' }], run: () => { throw new Error('broke'); } });
  R.add({ id: 'blind', near: () => { throw new Error('dark'); }, run: () => ({ ok: true }) });
  assert.deepEqual(R.nearFor({ id: 1 }).map(x => x.id), ['boom:x'], 'a source that can\'t look is left out');
  const r3 = R.doFor({ id: 1 }, 'boom:x');
  assert.equal(r3.ok, false);
  assert.match(r3.brain, /could not be done: broke/);
  assert.equal(R.view().failed, 1);
  c.close();
});

test('an agent on its own: the city\'s places offered (from the routine\'s own rules); a meal for real — one meal, the bill, its hunger filled', () => {
  const c = setup(), i = c.idx(2), A = c.sim.agents[i], rec = c.recs[1];
  c.run(2);
  const list = c.I.nearFor(rec, { limit: 30 });
  const meals = list.filter(x => x.source === 'places' && x.kind === 'eat');
  assert.ok(list.some(x => x.source === 'places'), `places are offered: ${list.map(x => x.label).join(' | ')}`);
  assert.ok(!list.some(x => x.source === 'body'), 'nobody to sit with');
  assert.ok(meals.length > 0, 'a meal somewhere (noon: lunch)');
  const m = meals[0];
  const r = c.I.doFor(rec, m.id, { via: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(A.order.kind, 'meal');
  assert.ok(c.until(() => A.act?.kind === 'meal', 900), 'it sat down to its meal');
  const n0 = c.sim.brain.needsAt(A, c.sim.now(), {}).hunger;
  assert.ok(c.until(() => !!c.at(i).s?.h && A.act?.kind === 'meal', 60));
  const t0 = A.act.holdStart, end = A.act.holdEnd;
  c.until(() => c.sim.now() > Math.min(end, t0 + 200), 400);
  const n1 = c.sim.brain.needsAt(A, c.sim.now(), {}).hunger;
  assert.ok(n1 > n0, `its hunger filled: ${n0} → ${n1}`);
  const rc = c.H.receipts.get(A.p.id) || [];
  assert.ok(rc.some(x => x.t === t0 && x.total > 0), `the economy's bill for it: ${JSON.stringify(rc)}`);
  // one meal: then the order is over
  assert.ok(c.until(() => !A.order || A.order.kind !== 'meal', 900), 'one meal, then its own day');
  c.close();
});

test('an agent on its own goes shopping (its purchase at the checkout) and uses a park bench by an order of its own', () => {
  const c = setup(), i = c.idx(2), A = c.sim.agents[i], rec = c.recs[1];
  c.run(2);
  const shop = c.I.nearFor(rec, { limit: 30 }).find(x => x.source === 'places' && x.go?.kind === 'shop');
  assert.ok(shop, 'a shop');
  {
    const r = c.I.doFor(rec, shop.id, { via: 'test' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(A.order.kind, 'shop');
    assert.ok(c.until(() => A.act?.kind === 'shop', 900), 'it went shopping');
  }
  // a park's bench, by an order to use it (the furniture source's way for an agent on its own)
  const B = c.sim.brain, v = c.sim.index.venues.park[0], r0 = B.seatsOn(v.b, v.f).list.find(r => r.use === 'bench' && !B.taken(v.b, v.f, r.id, r.k, -1));
  assert.ok(r0, 'a free bench');
  const o = c.sim.order(i, { kind: 'use', venue: { b: v.b, f: v.f, x: v.x, z: v.z }, piece: r0.id, use: 'bench', minutes: 30 });
  assert.equal(o.ok, true, JSON.stringify(o));
  assert.ok(c.until(() => A.act?.use === 'bench' && A.act.id === r0.id, 1500), 'it sat on that bench');
  assert.equal(A.p.order?.use, 'bench', 'kept on the resident (a restart keeps it)');
  assert.equal(A.p.order?.piece, r0.id);
  // an order to use what isn't there: refused, nothing cut
  const bad = c.sim.order(i, { kind: 'use', venue: { b: v.b, f: v.f, x: v.x, z: v.z }, piece: 99999, use: 'bench' });
  assert.deepEqual(bad, { ok: false, why: 'nowhere' });
  c.close();
});

test('the brain\'s world tools: things_to_do lists refs, do carries one out for real or says why not', () => {
  const c = setup(), rec = c.recs[1];
  c.run(2);
  const T = worldTools(c.I, rec, { via: 'brain' });
  assert.deepEqual(T.names, ['things_to_do', 'do']);
  const [l] = T.run([{ tool: 'things_to_do' }]);
  assert.equal(l.ok, true);
  assert.match(l.text, /^THINGS TO DO NOW: \[T1\] /);
  const [no] = T.run([{ tool: 'do', what: 'T99' }]);
  assert.equal(no.ok, false);
  assert.match(no.text, /^not done: T99 is not one of THINGS TO DO/);
  const [yes] = T.run([{ tool: 'do', what: 'T1' }]);
  assert.match(yes.text, /^(done|not done): /);
  if (yes.ok) assert.ok(c.sim.agents[c.idx(2)].order, 'its body has the order');
  c.close();
});

test('a quick errand while out with its owner: a bite at a place near, its bill and its hunger — then back to them by itself', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0];
  const e = c.at(i), spot = (() => { for (let r = 4; r < 60; r += 2) for (let k = 0; k < 12; k++) { const x = e.x + Math.sin(k) * r, z = e.z + Math.cos(k) * r; if (c.nav.ok(x, z, -1) && !c.nav.wet(x, z)) return { x, z }; } return null; })();
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  assert.equal(c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }).ok, true);
  assert.ok(c.until(() => Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 4, 600), 'with its owner');
  const meal = c.I.nearFor(rec, { limit: 30 }).find(x => x.source === 'places' && x.errand && x.kind === 'eat');
  assert.ok(meal, 'a bite to eat somewhere near is offered as an errand');
  const before = (c.H.receipts.get(A.p.id) || []).length;
  const r = c.I.doFor(rec, meal.id, { via: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.brain, /when you are done you go back to Kim by yourself/);
  assert.equal(A.order.kind, 'meal');
  assert.ok(c.until(() => A.act?.kind === 'meal' && !!c.at(i).s?.h, 1500), 'it sat down to its meal there');
  assert.ok(c.until(() => A.order?.kind === 'follow' && A.order.lead?.id === 7, 3000), 'its meal over, it follows its owner again');
  assert.ok((c.H.receipts.get(A.p.id) || []).length > before, 'it paid for it');
  assert.ok(c.until(() => Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 5, 900), 'and came back to them');
  assert.equal(A.order.via, 'ui', 'back with them as their companion because they asked (not "by its own choice")');
  c.close();
});

test('in a place that serves food with its owner: its meal there near them, never an errand to the same place', () => {
  const c = setup(), i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0], B = c.sim.brain;
  // a café or restaurant floor its owner can stand in (2026-11-18: The Roastery, Kim on the sofa; Restaurant 16, Sam "off to
  // «Restaurant 16» — back with you after" while sitting in it with Kim)
  let v = null, spot = null;
  for (const k of ['cafe', 'restaurant']) for (const x of c.sim.index.venues[k] || []) {
    if (spot) break;
    const ctx = ctxOf(x.b, x.f), s = B.standAt(ctx, x.x, x.z);
    if (s && c.nav.ok(s.x, s.z, ctx)) { v = x; spot = { ...s, ctx }; }
  }
  assert.ok(spot, 'a place that serves food');
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: spot.ctx, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  assert.equal(c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }).ok, true);
  assert.ok(c.until(() => B.sameSpace(c.at(i).ctx, p.ctx) && Math.hypot(c.at(i).x - p.x, c.at(i).z - p.z) < 4, 900), 'with its owner in there');
  const list = c.I.nearFor(rec, { limit: 40 });
  const here = B.placeName(v.b, v.f);
  assert.ok(!list.some(x => x.errand && x.where?.place === here), 'no errand to the place they are in');
  const eat = list.find(x => x.source === 'body' && x.kind === 'eat');
  assert.ok(eat, 'eating there near them is offered');
  assert.match(eat.label, new RegExp(`^Order something to eat or drink here at «${here.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}» and have it at a table near Kim`));
  const r = c.I.doFor(rec, eat.id, { via: 'test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(A.order.kind, 'follow', 'still with them');
  assert.equal(A.order.seat?.mode, 'eat');
  c.close();
});
