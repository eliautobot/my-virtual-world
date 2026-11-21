// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will in the moment (server/free-will/moments.js) on a generated city with a virtual clock and a scripted decision
// service: a companion with Free Will notices what happens (a line in its diary, its owner sitting down, a long quiet,
// its own hunger) and its decision service is asked at once, with what it senses and real options; it turns to look,
// goes over for a closer look and comes back, says something in its own words (with what it senses); its owner's
// message is checked first — a claim about the world is looked at, a request for its body is done, what its owner settles
// is kept for the outing; nothing without Free Will, nothing past its gap or its outing's cap, nothing when switched off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateWorld } from '../../server/world/generate.js';
import { generatePopulation } from '../../server/sim/population.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { Sim } from '../../server/sim/sim.js';
import { evalPlan } from '../../server/sim/plan.js';
import { PlayerNav } from '../../shared/playernav.js';
import { PF_USING } from '../../shared/playerproto.js';
import { Companions } from '../../server/companions/companions.js';
import { CarSeats } from '../../server/world/car-seats.js';
import { DatabaseSync } from '../../server/sqlite.js';
import { Senses } from '../../server/senses/senses.js';
import { Moments, GAP_MS, PER_OUTING } from '../../server/free-will/moments.js';
import { createInteractions } from '../../server/interactions/index.js';
import { toWorld } from '../../shared/geom.js';

function setup({ answers = () => ({}), fwOn = true, settings = {}, world: withWorld = false, spontaneity = 0.5, silent = false } = {}) {
  const world = generateWorld({ seed: 'moments-unit', population: 300 });
  const roster = [{ agentId: 'm-agent-1', name: 'Kai', emoji: '🤖', role: 'Tester' }, { agentId: 'm-agent-2', name: 'Juno', emoji: '🤖', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1e6;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 11 * 3600, dayScale: 16 };
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `m-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `m-agent-${k}`, name: k === 1 ? 'Kai' : 'Juno', emoji: '🤖', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, list: () => recs, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])), relations: () => [] };
  const nav = new PlayerNav(world), players = { byId: new Map(), nav }, cars = new Map();
  const seats = new CarSeats({ places: id => (cars.has(id) ? 3 : 0), announce: () => {} });
  const S0 = { 'companions.waitMinutes': 5, 'awareness.enabled': true, 'awareness.defaultMode': 'together', 'freeWill.moments': true, ...settings };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: cars, seats }), agents, life: () => life, world: () => null, setting: k => S0[k],
    notify: () => {}, send: () => {}, principalFor: () => null, now: () => ms });
  comp.hookSim();
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE agent_awareness (world_id TEXT, agent_id INTEGER, mode TEXT, updated INTEGER, updated_by INTEGER, PRIMARY KEY (world_id, agent_id))");
  const senses = new Senses({ dbs: { db, worldId: 'w' }, sim: () => sim, agents, life: () => life, players, vehicles: () => ({ all: cars, seats }), companions: () => comp,
    setting: k => S0[k], accountName: () => 'Kim', now: () => ms });
  const asked = [], said = [];
  // (a decision service scripted by the test: answers(request, o) → { name: choice | probability })
  const freeWill = {
    byPerson: new Map(fwOn ? [[idx(1), { agentId: 1 }]] : []), settingsOf: () => ({ spontaneity }), contextFn: () => ({ personality: ['curious'], likes: ['animals'], plans: [] }),
    async decideNow(agentId, request, o) {
      asked.push({ agentId, request, o });
      if (silent) return null;   // (no decision service answered: a timeout, an outage)
      const want = answers(request, o) || {};
      const out = request.questions.map(q => {
        const v = want[q.name];
        if (q.type === 'predicate') return { type: 'predicate', name: q.name, probability: typeof v === 'number' ? v : 0.1 };
        const choice = v ?? q.choices[0].value;
        return { type: 'choice', name: q.name, choice, confidence: 0.9, probabilities: q.choices.map(c => ({ value: c.value, probability: c.value === choice ? 0.9 : 0.1 / (q.choices.length - 1 || 1) })) };
      });
      o.summary?.(out);
      return { answers: out, ms: 5 };
    },
  };
  const mind = {
    remark: async (rec, situation, to, o) => { said.push({ kind: 'remark', rec: rec.id, situation, to, sense: o?.sense }); return { shown: true, text: 'Look at that!' }; },
    speak: async (rec, s) => { said.push({ kind: s.kind, rec: rec.id, heard: s.heard, sense: s.sense }); return { shown: true, text: 'Sure!' }; },
  };
  // (what it can do in the world: server/interactions/ — as on a server, when the test asks for it)
  const P0 = { account: { id: 7, displayName: 'Kim', login: 'kim' } };
  const interactions = withWorld ? createInteractions({ sim: () => sim, companions: () => comp, life: () => life, players, principalFor: () => P0, ownerOf: r => r.ownerId }) : null;
  const moments = new Moments({ freeWill, senses: () => senses, companions: () => comp, mind: () => mind, agents, players, sim: () => sim, interactions, setting: k => S0[k], now: () => ms });
  moments.attach(); clearInterval(moments.timer); moments.timer = null;   // (ticked by the test)
  const flush = () => new Promise(r => setImmediate(r));
  const run = async (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); senses.tick(); moments.tick(); await flush(); } };
  const at = i => evalPlan(sim.agents[i].plan, T);
  const near = (i, d = 6) => { const e = at(i); for (let r = d; r < 80; r += 2) for (let a = 0; a < 12; a++) { const x = e.x + Math.sin(a) * r, z = e.z + Math.cos(a) * r; if (nav.ok(x, z, -1) && !nav.wet(x, z)) return { x, z }; } return null; };
  const until = async (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; await run(1); } return !!fn(); };
  const P = { account: { id: 7, displayName: 'Kim', login: 'kim' } };
  return { sim, comp, senses, moments, freeWill, players, recs, idx, at, near, run, until, asked, said, P, S0, ms: () => ms, interactions, nav, world };
}

/** Kai out with its owner Kim, a player standing outdoors beside it. */
async function outWith(c) {
  const i = c.idx(1), spot = c.near(i, 6);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(await c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to its owner');
  await c.run(GAP_MS / 1000 + 2);
  c.asked.length = 0; c.said.length = 0;
  return p;
}

test('a moment: asked at once with what it senses and real options; it turns to look, and says something in its own words', async () => {
  const c = setup({ answers: r => (r.questions[0].choices.some(x => x.value === 'look0') ? { do: 'look0', speak: 'say' } : { do: 'stay', speak: 'quiet' }) });
  const p = await outWith(c), i = c.idx(1);
  // Juno walks up next to them
  const j = c.idx(2); void j;
  c.senses.note(1, 'saw', 'Saw 3 deer nearby, on the grass', { key: 'herd:1' });
  await c.run(3);
  assert.equal(c.asked.length, 1, 'asked once');
  const req = c.asked[0].request;
  assert.match(req.input, /WHAT KAI SENSES:\nWhere: outside/);
  assert.match(req.input, /JUST NOW: Saw 3 deer nearby/);
  assert.match(req.input, /Personality: curious/);
  assert.deepEqual(req.questions.map(q => q.name), ['do', 'speak']);
  assert.equal(req.questions[0].choices[0].value, 'stay', 'carrying on is always an option');
  assert.equal(c.asked[0].o.type, 'moment');
  const looked = req.questions[0].choices.some(x => x.value === 'look0');
  if (looked) assert.ok(c.sim.agents[i].attend, 'it turned to look');
  assert.equal(c.said.length, looked ? 1 : 0);
  if (looked) { assert.equal(c.said[0].kind, 'remark'); assert.match(c.said[0].sense, /^Where: /, 'its words come with what it senses'); assert.equal(c.said[0].to, 'Kim'); }
  void p;
});

test('its owner speaks out loud near it: a reply in its own words; a long quiet; its owner sits down; its own hunger asks about its own life', async () => {
  const c = setup({ answers: r => ({ speak: 'say', own: 'mention' }) });
  const p = await outWith(c);
  c.senses.heardPlayer(p, 'Nice day for a walk, right?');
  await c.run(2);
  const r = c.said.find(s => s.kind === 'reply');
  assert.ok(r, 'it answered its owner out loud');
  assert.equal(r.heard, 'Nice day for a walk, right?');
  // its owner sits down
  await c.run(GAP_MS / 1000 + 1);
  c.asked.length = 0;
  p.flags |= PF_USING;
  await c.run(4);
  // (not on a seat the city knows: what they are at is not claimed — "busy at something", as its senses say)
  assert.ok(c.asked.some(a => /JUST NOW: Kim \(your owner\) is busy at something here/.test(a.request.input)), 'its owner settling down at something is a moment');
  // hungry: asked about its own life, and it mentions it once
  await c.run(GAP_MS / 1000 + 1);
  c.asked.length = 0; c.said.length = 0;
  const a = c.sim.agents[c.idx(1)];
  c.sim.brain.needsAt = () => ({ hunger: 0.1, energy: 0.9, social: 0.8, fun: 0.8 });
  await c.run(4);
  const own = c.asked.find(x => x.request.questions.some(q => q.name === 'own'));
  assert.ok(own, 'its own hunger is a moment about its own life');
  assert.match(c.said.at(-1)?.situation || '', /I mention it to them, once\./);
  // (once an outing)
  c.asked.length = 0;
  await c.run(GAP_MS / 1000 + 4);
  assert.ok(!c.asked.some(x => x.request.questions.some(q => q.name === 'own')), 'not asked again this outing');
  void a;
});

test('going over for a closer look, then back to its owner\'s side', async () => {
  const c = setup();
  const p = await outWith(c), i = c.idx(1), a = c.sim.agents[i];
  // a point 15 m off on open ground
  const spot = (() => { for (let r = 14; r < 40; r += 2) for (let k = 0; k < 16; k++) { const x = p.x + Math.sin(k * 0.39) * r, z = p.z + Math.cos(k * 0.39) * r; if (c.players.nav.ok(x, z, -1) && !c.players.nav.wet(x, z)) return { x, z }; } return null; })();
  assert.ok(c.sim.brain.goSee(a, { x: spot.x, z: spot.z, ctx: -1, label: 'the deer', secs: c.sim.brain.wm(12), near: 3 }));
  assert.ok(await c.until(() => { const e = c.at(i); return Math.hypot(e.x - spot.x, e.z - spot.z) < 5; }, 60), 'it went over');
  assert.match(a.act.label, /the deer/);
  assert.ok(await c.until(() => !a.detour, 120), 'the look ends');
  assert.ok(await c.until(() => { const e = c.at(i); return Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }, 60), 'back at its owner\'s side');
});

test('its owner\'s message checked first: a claim about the world is looked at, a request is done, what is settled is kept for the outing', async () => {
  // (the message is the request's first line)
  const msg = r => r.input.split('\n')[0];
  const c = setup({ answers: (r, o) => (o.type === 'check' ? (/deer/.test(msg(r)) ? { about_world: 0.95, matches: 'unsure', settles: 0.1, act: 'none' }
    : /work/.test(msg(r)) ? { about_world: 0.1, matches: 'na', settles: 0.9, act: 'none' }
      : /over here/.test(msg(r)) ? { about_world: 0.3, matches: 'na', settles: 0.1, act: 'closer' } : {}) : {}) });
  await outWith(c);
  const rec = c.recs[0];
  const claim = await c.moments.checkMessage(rec, 7, 'There are deer right in front of us, see them?', { P: c.P });
  assert.match(claim.checked, /^You checked just now, because Kim said something about what is around you:\nWhere: /);
  assert.match(claim.checked, /never deny it/);
  assert.match(claim.brief, /^You checked just now, because Kim said something about what is around you\. Your senses don't show it/);
  assert.equal(claim.did, null);
  // a claim its senses bear out needs nothing more said: what matters goes with the message as it is
  const yes = setup({ answers: (r, o) => (o.type === 'check' ? { about_world: 0.95, matches: 'yes', settles: 0.1, act: 'none', needs_around: 0.9 } : {}) });
  await outWith(yes);
  const ok = await yes.moments.checkMessage(yes.recs[0], 7, 'Look at that guy over there', { P: yes.P });
  assert.equal(ok.about, true);
  assert.equal(ok.checked, null, 'nothing to correct: no look said twice');
  assert.deepEqual(ok.relevant, ['around'], 'who and what is around: what the message needs');
  assert.equal(ok.sight, false);
  const settled = await c.moments.checkMessage(rec, 7, 'Don\'t worry about work today, it\'s fine.', { P: c.P });
  assert.equal(settled.settled, true);
  assert.equal(settled.checked, null, 'not about the world: no look');
  assert.match(c.moments.outingLines(1)[0], /^Kim said: «Don't worry about work today, it's fine\.»/);
  const come = await c.moments.checkMessage(rec, 7, 'Come over here next to me', { P: c.P });
  assert.equal(come.did?.action, 'closer');
  assert.equal(c.asked.at(-1).o.type, 'check');
  // a new outing: what was settled is gone
  c.comp.command(c.P, { agent: 1, action: 'dismiss' }); await c.run(2);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }); await c.run(2);
  assert.deepEqual(c.moments.outingLines(1), []);
});

test('nothing without Free Will, past its gap or its outing\'s cap, or switched off', async () => {
  const off = setup({ fwOn: false });
  await outWith(off);
  off.senses.note(1, 'saw', 'Saw a deer', { key: 'h' });
  await off.run(3);
  assert.equal(off.asked.length, 0, 'Free Will off: no moments');
  assert.equal(await off.moments.checkMessage(off.recs[0], 7, 'see the deer?', { P: off.P }), null);
  const c = setup();
  await outWith(c);
  c.senses.note(1, 'saw', 'Saw a deer', { key: 'h1' });
  await c.run(3);
  c.senses.note(1, 'saw', 'Saw a horse', { key: 'h2' });
  await c.run(3);
  assert.equal(c.asked.length, 1, 'the gap between moments');
  c.moments.state.get(1).asked = PER_OUTING;
  await c.run(GAP_MS / 1000 + 1);
  c.senses.note(1, 'saw', 'Saw a cow', { key: 'h3' });
  await c.run(3);
  assert.equal(c.asked.length, 1, 'the outing\'s cap');
  c.S0['freeWill.moments'] = false;
  c.moments.state.get(1).asked = 0;
  c.senses.note(1, 'saw', 'Saw a sheep', { key: 'h4' });
  await c.run(GAP_MS / 1000 + 3);
  assert.equal(c.asked.length, 1, 'switched off');
});

test('its work while out with its owner: asked about once ("ask whether I can go"); "don\'t worry about the job" in the very message that takes it out is kept for that outing, and its work is not raised again', async () => {
  const msg = r => r.input.split('\n')[0];
  const c = setup({ answers: (r, o) => (o.type === 'check' ? (/the job/.test(msg(r)) ? { about_world: 0.1, matches: 'na', settles: 0.9, work_waits: 0.9, act: 'follow' } : {}) : { own: 'ask', speak: 'quiet' }) });
  const i = c.idx(1), rec = c.recs[0], spot = c.near(i, 6);
  const p = { id: 7, name: 'Kim', x: spot.x, z: spot.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  // an outing without a word about work: its work comes up (late for its shift), and it asks whether it may go — once
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(await c.until(() => { const e = c.at(i); return e.ctx === -1 && Math.hypot(e.x - p.x, e.z - p.z) < 3.5; }), 'it came out to its owner');
  await c.run(GAP_MS / 1000 + 2);
  c.asked.length = 0; c.said.length = 0;
  c.senses.note(1, 'work', 'Late for work at «Headquarters»');
  await c.run(3);
  const own = c.asked.find(x => x.request.questions.some(q => q.name === 'own'));
  assert.ok(own, 'its work is a moment about its own life');
  assert.match(own.request.input, /JUST NOW: Late for work/);
  assert.match(c.said.at(-1)?.situation || '', /I ask them whether I can go and deal with it\./);
  // let go; then taken out again with "don't worry about the job": that outing keeps it, though it began with that message
  c.comp.command(c.P, { agent: 1, action: 'dismiss' }); await c.run(2);
  const r = await c.moments.checkMessage(rec, 7, 'Come out with me, don\'t worry about the job, I\'m the boss.', { P: c.P });
  assert.equal(r.did?.action, 'follow', 'it comes along');
  assert.equal(r.settled, true);
  assert.match(c.moments.outingLines(1)[0] || '', /^Kim said: «Come out with me, don't worry about the job/, 'kept for the outing that message began');
  assert.equal(c.moments.workSettled(1), true);
  assert.ok(c.asked.at(-1).request.questions.some(q => q.name === 'work_waits'));
  await c.run(GAP_MS / 1000 + 2);
  c.asked.length = 0; c.said.length = 0;
  c.senses.note(1, 'work', 'Late for work at «Headquarters»');
  c.senses.note(1, 'work', 'Left work at «Headquarters» during your shift');
  await c.run(GAP_MS / 1000 + 3);
  assert.ok(!c.asked.some(x => x.request.questions.some(q => q.name === 'own')), 'not asked about its work again this outing');
  assert.equal(c.said.length, 0);
  // a new outing: settled no more
  c.comp.command(c.P, { agent: 1, action: 'dismiss' }); await c.run(2);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }); await c.run(2);
  assert.equal(c.moments.workSettled(1), false);
});

test('what it can do in the world is among its options (server/interactions/): its owner sits down on a park bench, it decides to sit with them — and its body really does', async () => {
  const c = setup({ world: true, answers: r => { const ch = r.questions[0]?.choices || []; const sit = ch.find(x => /^Sit down with Kim \(they are sitting on a bench\)/.test(x.description)); return sit ? { do: sit.value, speak: 'quiet' } : { do: 'stay', speak: 'quiet' }; } });
  const i = c.idx(1), A = c.sim.agents[i], B = c.sim.brain;
  c.comp.decides = () => true;
  // a park bench (both ends free) its owner can walk up to, nearest Kai
  const e = c.at(i);
  let bn = null, bd = Infinity;
  for (const v of c.sim.index.venues.park) for (const r of B.seatsOn(v.b, v.f).list) {
    if (r.t !== 'bench' || r.k !== 0) continue;
    const s0 = B.seatInfo(v.b, v.f, r.id, 0), s1 = B.seatInfo(v.b, v.f, r.id, 1), sl = c.sim.index.entry(v.b, v.f, r.id).slots[0], ap = toWorld(c.world.buildings[v.b], sl.ax, sl.az);
    if (B.taken(v.b, v.f, r.id, 0, -1) || B.taken(v.b, v.f, r.id, 1, -1) || !c.nav.ok(ap.x, ap.z, -1)) continue;
    const d = Math.hypot(ap.x - e.x, ap.z - e.z);
    if (d < bd) { bd = d; bn = { s0, s1, ap }; }
  }
  assert.ok(bn, 'a park bench');
  const p = { id: 7, name: 'Kim', x: bn.ap.x, z: bn.ap.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
  assert.ok(await c.until(() => { const x = c.at(i); return B.sameSpace(x.ctx, -1) && Math.hypot(x.x - p.x, x.z - p.z) < 3.5; }, 1500), 'it came to its owner');
  await c.run(GAP_MS / 1000 + 2);
  c.asked.length = 0;
  // its owner sits down on the bench
  p.x = bn.s0.x; p.z = bn.s0.z; p.flags |= PF_USING; B.playerTook(p.x, p.z, p.ctx);
  await c.run(4);
  const q = c.asked.find(a => /JUST NOW: Kim \(your owner\) sat down on a bench/.test(a.request.input));
  assert.ok(q, `its owner sitting down is a moment: ${c.asked.map(a => a.request.input.split('JUST NOW: ')[1]).join(' | ')}`);
  const opts = q.request.questions[0].choices.map(x => x.description);
  assert.ok(opts.some(d => /^Sit down with Kim \(they are sitting on a bench\)/.test(d)), `sitting with them is offered: ${opts.join(' | ')}`);
  assert.equal(opts.filter(d => /^Sit down with Kim/.test(d)).length, 1, 'once (the world\'s, not a list of its own as well)');
  assert.ok(await c.until(() => !!A.order?.seat, 10), 'its body sat down with them');
  assert.equal(A.order.seat.key, bn.s1.key, 'the other end of their bench');
  assert.equal(c.interactions.view().done, 1);
  // (its diary would have it on a server: server/index.mjs onDone)
});

test('its owner sits down on a bench placed on open land (a decoration, server/sim/decor-seats.js): the moment names it, it decides to sit with them — on the bench\'s other end, for real', async () => {
  const seatRe = /^Sit down with Kim \(they are sitting on a bench by «?[^»()]+»?\)$/;
  const c = setup({ world: true, answers: r => { const ch = r.questions[0]?.choices || []; const sit = ch.find(x => seatRe.test(x.description)); return sit ? { do: sit.value, speak: 'quiet' } : { do: 'stay', speak: 'quiet' }; } });
  const i = c.idx(1), A = c.sim.agents[i], B = c.sim.brain;
  c.comp.decides = () => true;
  const p = await outWith(c);
  // a bench on open ground beside them (its rectangle and both ends' steps walkable)
  let spot = null;
  for (let r = 3; r < 40 && !spot; r += 1) for (let a = 0; a < 16; a++) {
    const x = p.x + Math.sin(a * 0.4) * r, z = p.z + Math.cos(a * 0.4) * r;
    if ([[0, 0], [-0.95, -0.3], [0.95, 0.3], [-0.5, 0.85], [0.5, 0.85], [0, 2]].every(([dx, dz]) => c.nav.ok(x + dx, z + dz, -1) && !c.nav.wet(x + dx, z + dz))) { spot = { x, z }; break; }
  }
  assert.ok(spot, 'open ground by them');
  c.world.decorations = [{ id: 'd-1', t: 'bench', x: spot.x, z: spot.z, r: 0 }];
  const [s0] = B.decorEntry('d-1').slots;
  p.x = s0.lx; p.z = s0.lz; p.flags |= PF_USING; B.playerTook(p.x, p.z, p.ctx);
  await c.run(4);
  const q = c.asked.find(a => /JUST NOW: Kim \(your owner\) sat down on a bench by \S/.test(a.request.input));
  assert.ok(q, `its owner sitting down on the decoration is a moment, naming it: ${c.asked.map(a => a.request.input.split('JUST NOW: ')[1]).join(' | ')}`);
  const opts = q.request.questions[0].choices.map(x => x.description);
  assert.equal(opts.filter(d => seatRe.test(d)).length, 1, `sitting with them is offered once: ${opts.join(' | ')}`);
  assert.ok(await c.until(() => !!A.order?.seat, 10), 'its body sat down with them');
  assert.equal(A.order.seat.key, 'd:d-1:1', 'the other end of their bench');
});

test('a reserved companion is still asked when its owner sits down (joining is never filtered by spontaneity); no answer at all: it sits down with them anyway', async () => {
  for (const silent of [false, true]) {
    const c = setup({ world: true, spontaneity: 0, silent, answers: r => { const ch = r.questions[0]?.choices || []; const sit = ch.find(x => /^Sit down with Kim/.test(x.description)); return sit ? { do: sit.value, speak: 'quiet' } : { do: 'stay', speak: 'quiet' }; } });
    const i = c.idx(1), A = c.sim.agents[i], B = c.sim.brain;
    c.comp.decides = () => true;
    const e = c.at(i);
    let bn = null, bd = Infinity;
    for (const v of c.sim.index.venues.park) for (const r of B.seatsOn(v.b, v.f).list) {
      if (r.t !== 'bench' || r.k !== 0) continue;
      const s0 = B.seatInfo(v.b, v.f, r.id, 0), s1 = B.seatInfo(v.b, v.f, r.id, 1), sl = c.sim.index.entry(v.b, v.f, r.id).slots[0], ap = toWorld(c.world.buildings[v.b], sl.ax, sl.az);
      if (B.taken(v.b, v.f, r.id, 0, -1) || B.taken(v.b, v.f, r.id, 1, -1) || !c.nav.ok(ap.x, ap.z, -1)) continue;
      const d = Math.hypot(ap.x - e.x, ap.z - e.z);
      if (d < bd) { bd = d; bn = { s0, s1, ap }; }
    }
    const p = { id: 7, name: 'Kim', x: bn.ap.x, z: bn.ap.z, y: 0, ctx: -1, yaw: 0, flags: 0, vehicleId: null };
    c.players.byId.set(7, p);
    c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' });
    assert.ok(await c.until(() => { const x = c.at(i); return B.sameSpace(x.ctx, -1) && Math.hypot(x.x - p.x, x.z - p.z) < 3.5; }, 1500), 'it came to its owner');
    await c.run(GAP_MS / 1000 + 2);
    c.asked.length = 0;
    p.x = bn.s0.x; p.z = bn.s0.z; p.flags |= PF_USING; B.playerTook(p.x, p.z, p.ctx);
    await c.run(6);
    assert.ok(c.asked.some(a => /JUST NOW: Kim \(your owner\) sat down on a bench/.test(a.request.input)), `${silent ? 'no answer' : 'answered'}: the moment is asked even at spontaneity 0`);
    assert.ok(await c.until(() => !!A.order?.seat, 10), silent ? 'unanswered: it sat down with them by default' : 'its Free Will chose to sit: it did');
    assert.equal(A.order.seat.key, bn.s1.key);
  }
});

test('its owner got into an aircraft with room for it: a joining moment — asked even of a reserved companion, at once', async () => {
  const c = setup({ spontaneity: 0, answers: () => ({ do: 'stay', speak: 'quiet' }) });
  await outWith(c);
  c.senses.note(1, 'activity', 'Kim (your owner) got into the propeller plane — there is room for you (1 of 1 passenger seat free): you could fly with them');
  await c.run(8);
  assert.ok(c.asked.some(a => /JUST NOW: Kim \(your owner\) got into the propeller plane/.test(a.request.input)), 'asked about it (not filtered as a mere sight)');
});
