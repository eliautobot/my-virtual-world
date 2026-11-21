// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents cooking Order Up by their own choice (server/play/kitchen-play.js), on a generated city with its café kitchens, the
// real simulation, companions and the play core: an agent on its own goes into a public café's kitchen and cooks a Rush —
// its body at the stations, laid out, cooked at its level and recorded by the server as a player's (the kitchen shifts'
// own lay / record); a companion cooks alongside its owner's Rush (the same orders, their clock, nothing pressed before it
// got there), joins by itself without Free Will of its own, and gives its Rush up honestly when its owner walks off; the
// reflex's "let's cook"; its view busy (Free Will's moments don't pull it away for a glance); the cook bot joining late.
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
import { kitchenOf } from '../../shared/orderup/kitchens.js';
import { COURSES, BEAT } from '../../shared/orderup/module.js';
import { cookRush } from '../../shared/orderup/cook-bot.js';
import { Companions } from '../../server/companions/companions.js';
import { parseCommand } from '../../server/companions/intent.js';
import { createInteractions } from '../../server/interactions/index.js';
import { PlayCore } from '../../server/play/play.js';
import { CookRecord } from '../../server/play/cook.js';
import { KitchenShifts } from '../../server/play/kitchen-shifts.js';
import { KitchenPlay, JOIN_MS } from '../../server/play/kitchen-play.js';
import { economyModel } from '../helpers/econ-model.mjs';

afterEach(() => setPlayerSpots(null));
const WARMUP = COURSES[0];

function setup() {
  const world = generateWorld({ seed: 'companions-unit', population: 300 });
  const roster = [{ agentId: 'c-agent-1', name: 'Riley', emoji: '🤖', role: 'Tester' }, { agentId: 'c-agent-2', name: 'Max', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1.8e12;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 12 * 3600, dayScale: 16 };
  const model = economyModel({ city: { world, people } });
  model.econ.parts.businesses.sync();
  const H = model.econ.parts.households;
  sim.econ = H; sim.onAct = (a, act) => H.onAct(a, act);
  const said = [];
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `c-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `c-agent-${k}`, name: k === 1 ? 'Riley' : 'Max', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs, list: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) };
  const nav = new PlayerNav(world);
  const players = { byId: new Map(), nav };
  setPlayerSpots(() => { const out = []; for (const p of players.byId.values()) if ((p.flags & PF_USING) && p.ctx >= -1) out.push({ x: p.x, z: p.z, ctx: p.ctx }); return out; });
  const P = { account: { id: 7, displayName: 'Kim', login: 'kim' } };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats: null }), agents, life: () => life, world: () => null,
    setting: k => ({ 'companions.waitMinutes': 5 })[k], notify: () => {}, send: () => {}, principalFor: () => P, now: () => ms });
  comp.hookSim();
  let fw = true;
  comp.decides = () => fw;
  const I = createInteractions({ sim: () => sim, companions: () => comp, life: () => life, players, principalFor: () => P, ownerOf: r => r.ownerId });
  // the play core, the cooks' record and the kitchen shifts' machinery, on the city's database; Order Up's context as the
  // server lays a Rush out (server/index.mjs orderUpContext: the kitchen's stations, a seed — an agent's may be named)
  let cooks = null, n = 0;
  const play = new PlayCore({ dbs: model.dbs, now: () => ms, contextFor: (id, where, acc) => {
    if (id !== 'orderup') return {};
    const B = world.buildings[where?.b], L = B ? world.levels[B.lv[where.f]] : null, rec = (L?.mods || []).find(m => m.kind === 'kitchen');
    if (!rec) return { kitchen: null };
    const K = kitchenOf(rec.data?.kitchen), stations = L.items.filter(it => it.mod === rec.id && K.stations[it.t]).map(it => ({ id: it.id, t: it.t }));
    return { seed: acc.id < 0 && where.seed ? where.seed : `abcdef${String(++n).padStart(4, '0')}`, skills: cooks.skillsOf(acc.id), kitchen: { b: where.b, f: where.f, stations, kitchen: rec.data?.kitchen || null, menu: rec.data?.menu || null } };
  } });
  cooks = new CookRecord({ dbs: model.dbs, play, now: () => ms });
  const posts = { agents: { list: () => [], get: id => recs.find(r => r.id === id) || null }, bodyOf: () => -1, simOf: () => sim, clockNow: () => ({ h: 12, day: 1 }) };
  const notes = [], toasts = [], owned = [];
  const shifts = new KitchenShifts({ play, cooks, posts, world: () => world, notify: (id, m) => owned.push([id, m.text]), now: () => ms });
  const kp = new KitchenPlay({ play, shifts, sim: () => sim, agents, players, companions: () => comp, world: () => world, ctxOf: r => I.contextFor(r),
    say: (i, text) => said.push([i, text]), toAccount: (id, f) => toasts.push([id, f]), note: (id, kind, text) => notes.push([id, kind, text]), now: () => ms });
  I.add(kp.source());
  comp.busy.push(kp);
  comp.ctxOf = r => I.contextFor(r);
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); kp.tick(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  return { world, sim, comp, players, nav, recs, run, until, at, idx, model, I, P, play, cooks, shifts, kp, notes, toasts, said, owned, setFw: v => { fw = v; }, close: () => model.close() };
}

/** The first café kitchen with a walkable spot just inside its floor and a street spot outside its building. */
function kitchen(c) {
  for (const k of c.kp.allKitchens()) {
    if (!c.sim.brain.index.isPublicFloor(k.b, k.f) || k.f !== 0) continue;
    const B = c.world.buildings[k.b], ctx = ctxOf(k.b, k.f);
    let inside = null, out = null;
    for (const s of k.stations) { const w = toWorld(B, s.lx, s.lz); if (c.nav.ok(w.x, w.z, ctx)) { inside = { x: w.x, z: w.z, ctx }; break; } }
    for (let r = 12; r < 40 && !out; r += 2) for (let j = 0; j < 24 && !out; j++) { const x = B.x + Math.sin(j * 0.26) * r, z = B.z + Math.cos(j * 0.26) * r; if (c.nav.ok(x, z, -1)) out = { x, z, ctx: -1 }; }
    if (inside && out) return { k, B, ctx, inside, out };
  }
  return null;
}
/** Puts body i at (x, z) on ctx at once. */
function jump(c, i, p) { c.sim.brain.interruptSoon(c.sim.agents[i], { x: p.x, y: 0, z: p.z, ctx: p.ctx }); }
const nearStation = (c, K, e) => K.k.stations.some(s => { const w = toWorld(K.B, s.lx, s.lz); return Math.hypot(w.x - e.x, w.z - e.z) < 0.6; });

test('the cook bot joining a Rush under way presses nothing before it got there, and the server replays it all the same', () => {
  const stations = ['ou_fridge', 'ou_pantry', 'ou_prep', 'ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_oven', 'ou_plating', 'ou_pass', 'ou_dishes', 'ou_sink', 'ou_bin'].map((t, i) => ({ id: `s${i}`, t }));
  const data = { seed: 'late1', stations, menu: ['espresso', 'latte', 'croissant'] }, lunch = COURSES[1];
  const whole = cookRush(data, lunch, { level: 3 }), late = cookRush(data, lunch, { level: 3, from: Math.round(60 / BEAT) });
  assert.ok(late.log.length && late.log.every(x => x[0] >= 60 / BEAT), 'not a press before it got there');
  assert.equal(cookRush(data, lunch, { level: 3 }).log.length, whole.log.length, 'the same Rush cooked again, the same presses (a shift\'s are unchanged)');
  assert.ok(late.S.score < whole.S.score && late.S.lost >= whole.S.lost, `a minute late, less done (${late.S.score} < ${whole.S.score}; ${late.S.lost} walked out)`);
});

test('an agent on its own goes into a public café\'s kitchen and cooks a Rush: its body at the stations, recorded by the server as a player\'s, said in a bubble, its owner\'s page and its diary', () => {
  const c = setup();
  try {
    const K = kitchen(c); assert.ok(K, 'a café kitchen');
    const i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0];
    jump(c, i, K.inside); c.run(2);
    assert.equal(c.at(i).ctx, K.ctx, 'in the café');
    const list = c.I.nearFor(rec, { limit: 30 }).filter(x => x.source === 'orderup');
    const cook = list.find(x => x.kind === 'cook' && x.kitchen.b === K.k.b && x.kitchen.f === K.k.f);
    assert.ok(cook, `offered: ${list.map(x => x.label).join(' | ')}`);
    assert.match(cook.label, /^Cook a Warm-up in «.+»'s kitchen \(2 min; your Order Up level 1, a first go at it\)$/);
    const r = c.I.doFor(rec, cook.id, { via: 'test' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(c.until(() => c.kp.view(1)?.phase === 'cooking', 60), 'into the kitchen, its Rush begun');
    const v = c.kp.view(1), run = c.play.runs.get(v.run);
    assert.ok(run && run.account === -1 && run.auto && run.chosen === 'own', 'its own run, unattended, by its own choice');
    assert.match(A.act.label, /^Cooking a Warm-up/);
    assert.ok(c.toasts.some(([id, f]) => id === 7 && /Riley started cooking a Warm-up in «.+»'s kitchen/.test(f.text)), 'its owner\'s page told');
    assert.ok(c.said.some(([j, t]) => j === i && /Warm-up — orders up!/.test(t)), 'a bubble');
    // its body goes from station to station in the kitchen, cooking
    const seen = new Set();
    for (let s = 0; s < 100; s += 2) { c.run(2); const e = c.at(i); if (e.ctx === K.ctx && nearStation(c, K, e)) seen.add(`${Math.round(e.x * 2)}:${Math.round(e.z * 2)}`); }
    assert.ok(seen.size >= 3, `at several stations (${seen.size})`);
    assert.equal(c.I.nearFor(rec).find(x => x.source === 'orderup')?.kind, 'stop', 'while it cooks: only stopping');
    assert.ok(c.until(() => !c.kp.view(1), 60), 'its Rush over');
    const pr = c.play.progress(-1).modules.orderup;
    assert.equal(pr.runs, 1, 'recorded as its own');
    assert.ok(pr.xp > 0);
    assert.ok(c.toasts.some(([id, f]) => id === 7 && /Riley finished a Warm-up .*pts/.test(f.text)), c.toasts.map(t => t[1].text).join(' | '));
    assert.ok(c.said.some(([j, t]) => j === i && /^🍳 Warm-up: \d+ pts/.test(t)), 'its result in a bubble');
    assert.ok(c.notes.some(([id, k, t]) => id === 1 && k === 'activity' && /^Started cooking a Warm-up/.test(t)), 'its diary');
    assert.equal(c.shifts.today(1).today, 1, 'counted against its day with its shifts\'');
  } finally { c.close(); }
});

test('a companion cooks alongside its owner\'s Rush (the same orders, their clock) — it joins by itself without Free Will; when its owner walks off it gives its Rush up and nothing is recorded', () => {
  const c = setup();
  try {
    const K = kitchen(c); assert.ok(K);
    const i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0];
    // its owner in the café, it beside them
    const p = { id: 7, name: 'Kim', x: K.inside.x, z: K.inside.z, y: 0, ctx: K.ctx, yaw: 0, flags: 0, vehicleId: null };
    c.players.byId.set(7, p);
    assert.equal(c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }).ok, true);
    assert.ok(c.until(() => { const e = c.at(i); return e.ctx === p.ctx && Math.hypot(e.x - p.x, e.z - p.z) < 4; }, 1500), 'with them in the café');
    // their Rush begins (their page's Order Up): with Free Will it is offered, joining what they do first
    const own = c.play.start({ id: 7 }, 'orderup', WARMUP.id, { b: K.k.b, f: K.k.f });
    c.run(1);
    assert.ok(c.notes.some(([id, k, t]) => id === 1 && k === 'activity' && /Kim started a Warm-up in «.+»'s kitchen/.test(t)), 'told (its Free Will\'s moment)');
    const list = c.I.nearFor(rec, { limit: 20 });
    assert.equal(list[0]?.kind, 'along', `joining them first: ${list.map(x => x.label).join(' | ')}`);
    assert.match(list[0].label, /^Cook alongside Kim in «.+»'s kitchen: your own Warm-up, the same orders on their clock/);
    assert.ok(!c.kp.view(1), 'with Free Will it waits for its own choice');
    c.run(JOIN_MS / 1000 + 2);
    assert.ok(!c.kp.view(1), 'still its choice');
    // without Free Will of its own: it joins in by itself
    c.setFw(false); c.run(2);
    assert.ok(c.kp.view(1), 'joined');
    assert.ok(c.until(() => c.kp.view(1)?.phase === 'cooking', 60), 'cooking');
    const mine = c.play.runs.get(c.kp.view(1).run);
    assert.equal(mine.along, own.run, 'along on its owner\'s Rush');
    assert.equal(mine.data.seed, own.data.seed, 'the same orders');
    assert.equal(mine.at, c.play.runs.get(own.run).at, 'on their clock');
    const mm = c.kp.cooking.get(1);
    assert.ok(mm.run.log.every(x => x[0] * BEAT >= (mm.startedAt - mine.at) / 1000 - 0.05), 'nothing pressed before it got there');
    assert.equal(A.order.kind, 'follow', 'still its companion');
    assert.equal(c.comp.list(c.P).companions[0]?.busy?.kind, 'orderup', 'busy (its view)');
    assert.equal(c.comp.list(c.P).companions[0]?.state, 'following');
    // its owner walks out of the café: it stops (nothing recorded) and follows them
    Object.assign(p, { x: K.out.x, z: K.out.z, ctx: -1 });
    for (let r = 50; r < 120; r += 5) { const x = K.B.x + r, z = K.B.z; if (c.nav.ok(x, z, -1)) { Object.assign(p, { x, z }); break; } }
    assert.ok(c.until(() => !c.kp.view(1), 20), 'it stopped');
    assert.equal(c.kp.last.stopped, 'leader');
    assert.equal(c.play.progress(-1).modules.orderup.runs, 0, 'nothing recorded');
    assert.ok(c.notes.some(([id, k, t]) => id === 1 && /^Gave up your Warm-up .*Kim left the kitchen — it doesn't count/.test(t)), 'said honestly');
    assert.equal(A.order.kind, 'follow');
  } finally { c.close(); }
});

test('a companion asked to cook ("let\'s cook") cooks alongside the Rush its owner cooks, and the whole of it is recorded as its own', () => {
  const c = setup();
  try {
    const K = kitchen(c); assert.ok(K);
    const i = c.idx(2), rec = c.recs[1];
    const p = { id: 7, name: 'Kim', x: K.inside.x, z: K.inside.z, y: 0, ctx: K.ctx, yaw: 0, flags: 0, vehicleId: null };
    c.players.byId.set(7, p);
    assert.equal(c.comp.command(c.P, { agent: 2, action: 'follow', target: 'me' }).ok, true);
    assert.ok(c.until(() => c.at(i).ctx === p.ctx, 1500));
    assert.equal(parseCommand('Max, help me in the kitchen', { name: 'Max' }).action, 'cook');
    // nothing cooking yet: a Rush of its own in the kitchen right there
    const no = c.kp.command(c.P, rec, 'uncook');
    assert.equal(no.ok, false); assert.match(no.text, /isn't cooking/);
    const own = c.play.start({ id: 7 }, 'orderup', WARMUP.id, { b: K.k.b, f: K.k.f });
    c.run(1);
    const r = c.comp.heard(c.P, rec, "let's cook");
    assert.equal(r?.ok, true, JSON.stringify(r));
    assert.match(r.brain, /^you are cooking your own Warm-up alongside Kim/);
    assert.ok(c.until(() => c.kp.view(2)?.phase === 'cooking', 60));
    // its owner's Rush is played on their page (finished there or not, it cooks its own to the end)
    c.play.abandon({ id: 7 }, own.run);
    assert.ok(c.until(() => !c.kp.view(2), WARMUP.dur + 30), 'its Rush over');
    assert.equal(c.kp.last.stopped, undefined, 'finished, not given up');
    assert.equal(c.play.progress(-2).modules.orderup.runs, 1, 'recorded as its own');
    assert.ok(c.until(() => c.sim.agents[i].act?.kind === 'follow' && !/Cooking/.test(c.sim.agents[i].act.label), 20), 'back at its owner\'s side');
  } finally { c.close(); }
});

test('honest noes: a closed café, a Rush level not opened, cooking already, no body', () => {
  const c = setup();
  try {
    const K = kitchen(c), rec = c.recs[0], i = c.idx(1);
    jump(c, i, K.inside); c.run(2);
    const ctx = c.I.contextFor(rec), aff = c.kp.near(ctx).find(x => x.kind === 'cook');
    assert.ok(aff);
    // the café closed for the night: not offered, and refused when asked
    const day = c.sim.clock.dayBase; c.sim.clock.dayBase = 23 * 3600;
    assert.ok(!c.kp.near(c.I.contextFor(rec)).some(x => x.kind === 'cook' && x.kitchen.b === aff.kitchen.b && x.kitchen.f === aff.kitchen.f), 'closed: not offered');
    const closed = c.kp.run(c.I.contextFor(rec), aff, {});
    assert.equal(closed.ok, false); assert.match(closed.brain, /closed now/);
    c.sim.clock.dayBase = day;
    const locked = c.kp.run(ctx, aff, { course: 'critic' });
    assert.equal(locked.ok, false); assert.match(locked.brain, /haven't opened Critic's Night yet/);
    assert.equal(c.kp.run(ctx, aff, {}).ok, true);
    const again = c.kp.run(c.I.contextFor(rec), aff, {});
    assert.equal(again.ok, false); assert.match(again.brain, /cooking a Rush already/);
    assert.equal(c.kp.run(c.I.contextFor(rec), { kind: 'stop' }, {}).ok, true, 'stopped when asked');
    assert.equal(c.play.progress(-1).modules.orderup.runs, 0);
    assert.equal(c.kp.run({ rec, a: null }, aff, {}).ok, false);
  } finally { c.close(); }
});

test('the reflex: plain words for cooking with them, and what is not a command', () => {
  const p = t => parseCommand(t, { name: 'Lara' })?.action ?? null;
  for (const t of ['let\'s cook', 'Lara, cook with me', 'help me in the kitchen', 'give me a hand in the kitchen', 'come cook with us', 'cook a rush', 'let\'s do a rush', 'get cooking', 'help me cook please']) assert.equal(p(t), 'cook', t);
  for (const t of ['stop cooking', 'leave the kitchen', 'that\'s enough cooking', 'get out of the kitchen']) assert.equal(p(t), 'uncook', t);
  for (const t of ['cook', 'I love to cook', 'what are you cooking?', 'can you cook dinner tonight', 'who\'s cooking?']) assert.equal(p(t), null, t);
  assert.equal(p('let\'s eat'), 'eat', 'a meal is still a meal');
  assert.equal(p('let\'s fish'), 'fish', 'fishing unchanged');
});
