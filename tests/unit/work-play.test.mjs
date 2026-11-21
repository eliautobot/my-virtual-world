// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents working a shift as a game (server/play/work-play.js; shared/work-bot.js), on a generated city with the real
// simulation, companions and the economy's jobs core: the work bot plays each module's orders from what a player's panel
// shows (never the server's answer), at a person's pace, better with its level; an agent on its own takes a place behind a
// café's counter and works a barista's shift — the orders scored, the shift paid into its own wallet by the core, said in
// its bubble, its owner's page and its diary; a companion works where its owner is and ends the shift (paid for the time)
// when they walk off; honest noes (its owner hasn't allowed work, every place taken, already on a shift).
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
import { ROLES, makeOrder, publicOrder, scoreOrder, minMsOf } from '../../shared/work.js';
import { workOrder, readChoice } from '../../shared/work-bot.js';
import { RNG } from '../../shared/rng.js';
import { Companions } from '../../server/companions/companions.js';
import { createInteractions } from '../../server/interactions/index.js';
import { WorkPlay } from '../../server/play/work-play.js';
import { subj } from '../../server/economy/economy.js';
import { economyModel } from '../helpers/econ-model.mjs';

afterEach(() => setPlayerSpots(null));

test('the work bot plays every role\'s orders from the public order at a person\'s pace, better with its level', () => {
  for (const role of Object.keys(ROLES)) {
    const avg = level => { const rng = new RNG(`t:${role}:${level}`); let s = 0; for (let n = 0; n < 30; n++) { const o = makeOrder(role, 'bot1', n, {}), p = publicOrder(o);
      assert.ok(p.steps.every(st => st.answer === undefined), 'the panel\'s order: no answers');
      const w = workOrder(p, { level, rng }); assert.ok(w.ms >= minMsOf(o), `${role}: never faster than a person`); s += scoreOrder(o, w.reports, w.ms).stars; } return s / 30; };
    const lo = avg(1), hi = avg(12);
    assert.ok(lo >= 2.5 && hi >= lo - 0.2, `${role}: ${lo.toFixed(2)} → ${hi.toFixed(2)} stars`);
  }
  // a choice read from what the customer said (this step's memo, or an earlier one's: the server's table)
  const o = publicOrder(makeOrder('server', 'bot2', 3, {}));
  assert.equal(o.steps[1].options[readChoice(o, 1)], o.title.replace('Table ', ''), 'the table said before');
});

function setup() {
  const world = generateWorld({ seed: 'companions-unit', population: 300 });
  const roster = [{ agentId: 'c-agent-1', name: 'Riley', emoji: '🤖', role: 'Tester' }, { agentId: 'c-agent-2', name: 'Max', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1.8e12;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 12 * 3600, dayScale: 16 };
  const model = economyModel({ city: { world, people }, jobs: true, now: () => ms });
  model.econ.parts.businesses.sync();
  const H = model.econ.parts.households;
  sim.econ = H; sim.onAct = (a, act) => H.onAct(a, act);
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `c-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `c-agent-${k}`, name: k === 1 ? 'Riley' : 'Max', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, byId: id => recs.find(r => r.id === Number(id)) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  model.econ.d.agents = agents;
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) };
  const nav = new PlayerNav(world);
  const players = { byId: new Map(), nav };
  setPlayerSpots(() => { const out = []; for (const p of players.byId.values()) if ((p.flags & PF_USING) && p.ctx >= -1) out.push({ x: p.x, z: p.z, ctx: p.ctx }); return out; });
  const P = { account: { id: 7, displayName: 'Kim', login: 'kim' } };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats: null }), agents, life: () => life, world: () => null,
    setting: k => ({ 'companions.waitMinutes': 5 })[k], notify: () => {}, send: () => {}, principalFor: () => P, now: () => ms });
  comp.hookSim();
  comp.decides = () => true;
  const I = createInteractions({ sim: () => sim, companions: () => comp, life: () => life, players, principalFor: () => P, ownerOf: r => r.ownerId });
  const notes = [], toasts = [], said = [];
  const wp = new WorkPlay({ econ: () => model.econ, sim: () => sim, agents, players, companions: () => comp, ctxOf: r => I.contextFor(r),
    say: (i, text) => said.push([i, text]), toAccount: (id, f) => toasts.push([id, f]), note: (id, kind, text) => notes.push([id, kind, text]), now: () => ms });
  I.add(wp.source());
  comp.busy.push(wp);
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); wp.tick(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  return { world, sim, comp, players, nav, recs, run, until, at, idx, model, I, P, wp, notes, toasts, said, econ: model.econ, close: () => model.close() };
}
/** A café business with barista places, and a walkable spot on its floor. */
function cafe(c) {
  for (const biz of c.econ.parts.businesses.open()) {
    if (biz.kind !== 'cafe' || !(biz.f >= 0)) continue;
    const B = c.world.buildings[biz.b], ctx = ctxOf(biz.b, biz.f), list = c.sim.index.findUsesCached(B.lv[biz.f], ['staff']);
    if (!list.length) continue;
    for (const e of c.sim.index.findUsesCached(B.lv[biz.f], ['eat', 'order', 'relax'])) { const w = toWorld(B, e[2].ax, e[2].az); if (c.nav.ok(w.x, w.z, ctx)) return { biz, B, ctx, inside: { x: w.x, z: w.z, ctx } }; }
  }
  return null;
}
const jump = (c, i, p) => c.sim.brain.interruptSoon(c.sim.agents[i], { x: p.x, y: 0, z: p.z, ctx: p.ctx });

test('an agent on its own works a barista\'s shift at a café as a game: behind the counter, its orders scored, paid into its own wallet by the jobs core, said', () => {
  const c = setup();
  try {
    const K = cafe(c); assert.ok(K, 'a café with a counter');
    const i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0];
    jump(c, i, K.inside); c.run(2);
    const list = c.I.nearFor(rec, { limit: 30 }).filter(x => x.source === 'work');
    const aff = list.find(x => x.biz === K.biz.id && x.role === 'barista');
    assert.ok(aff, `offered: ${list.map(x => x.label).join(' | ')}`);
    assert.match(aff.label, /^Work a shift as Barista at «.+» \(about 6 min; your barista level 1; .+ a world hour × your stars/);
    const wallet = c.econ.walletFor(subj('agent', 1)), before = c.econ.ledger.walletOf('agent', '1', 'main').balance;
    const r = c.I.doFor(rec, aff.id, { via: 'test', minutes: 2 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(c.until(() => c.wp.view(1)?.phase === 'working', 60), 'there, on shift');
    assert.equal(c.econ.parts.jobs.of({ kind: 'agent', id: 1 }).active?.role, 'barista', 'the core\'s own shift');
    assert.equal(A.act.label, 'Working as Barista');
    const w = c.wp.working.get(1), e = c.at(i);
    assert.ok(e.ctx === K.ctx && Math.hypot(e.x - w.x, e.z - w.z) < 0.8, 'behind the counter');
    assert.equal(c.I.nearFor(rec).find(x => x.source === 'work')?.kind, 'stop', 'on shift: only ending it');
    c.run(70);
    assert.ok(c.wp.view(1).done >= 4, `orders worked at a person's pace (${c.wp.view(1).done})`);
    assert.ok(c.until(() => !c.wp.view(1), 90), 'its time up');
    assert.equal(c.wp.last.stopped, 'done');
    const hist = c.econ.parts.jobs.of({ kind: 'agent', id: 1 }).history[0];
    assert.ok(hist && hist.served === c.wp.last.done && hist.avgStars >= 2, JSON.stringify(hist));
    assert.ok(c.econ.ledger.walletOf('agent', '1', 'main').balance > before, 'paid into its own wallet');
    void wallet;
    assert.ok(c.toasts.some(([id, f]) => id === 7 && /Riley worked a shift as Barista at «.+»: \d+ drinks/.test(f.text)), c.toasts.map(t => t[1].text).join(' | '));
    assert.ok(c.said.some(([j, t]) => j === i && /Shift done/.test(t)));
    assert.ok(c.notes.some(([id, k, t]) => id === 1 && k === 'activity' && /^Worked a shift as Barista/.test(t)));
    assert.ok(c.econ.parts.jobs.of({ kind: 'agent', id: 1 }).xp.some(x => x.role === 'barista' && x.xp > 0), 'its experience in the role');
  } finally { c.close(); }
});

test('a companion works where its owner is; when they walk off it ends the shift (paid for the time) and goes with them; honest noes', () => {
  const c = setup();
  try {
    const K = cafe(c); assert.ok(K);
    const i = c.idx(2), A = c.sim.agents[i], rec = c.recs[1];
    const p = { id: 7, name: 'Kim', x: K.inside.x, z: K.inside.z, y: 0, ctx: K.ctx, yaw: 0, flags: 0, vehicleId: null };
    c.players.byId.set(7, p);
    assert.equal(c.comp.command(c.P, { agent: 2, action: 'follow', target: 'me' }).ok, true);
    assert.ok(c.until(() => c.at(i).ctx === K.ctx, 1500), 'with them in the café');
    const aff = c.I.nearFor(rec, { limit: 30 }).find(x => x.source === 'work' && x.biz === K.biz.id);
    assert.ok(aff && /where Kim is/.test(aff.label), aff?.label);
    // its owner hasn't allowed it work: not offered, refused in words
    c.econ.parts.agents.setLimits({ id: 7 }, 2, { scopes: ['buy'] });
    assert.ok(!c.I.nearFor(rec, { limit: 30 }).some(x => x.source === 'work'), 'not offered');
    const no = c.wp.run(c.I.contextFor(rec), aff, {});
    assert.equal(no.ok, false); assert.match(no.brain, /hasn't allowed "work"/);
    c.econ.parts.agents.setLimits({ id: 7 }, 2, { scopes: ['work', 'buy'] });
    assert.equal(c.I.doFor(rec, aff.id, { via: 'test' }).ok, true);
    assert.ok(c.until(() => c.wp.view(2)?.phase === 'working', 60));
    assert.equal(A.order.kind, 'follow', 'still its companion');
    assert.equal(c.comp.list(c.P).companions[0]?.busy?.kind, 'work');
    const again = c.wp.run(c.I.contextFor(rec), aff, {});
    assert.equal(again.ok, false); assert.match(again.brain, /working a shift already/);
    c.run(25);
    // its owner walks out and away: the shift ends, paid for the time worked
    for (let r = 60; r < 140; r += 5) { const x = K.B.x + r, z = K.B.z; if (c.nav.ok(x, z, -1)) { Object.assign(p, { x, z, ctx: -1 }); break; } }
    assert.ok(c.until(() => !c.wp.view(2), 20), 'ended');
    assert.equal(c.wp.last.stopped, 'leader');
    assert.ok(c.wp.last.result && c.wp.last.result.served >= 1, JSON.stringify(c.wp.last.result));
    assert.ok(c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 6; }, 300), 'went with them');
  } finally { c.close(); }
});
