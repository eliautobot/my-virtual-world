// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An AI agent as its owner's opponent at the tables for two (server/play/versus.js, shared/versus.js, docs/features/
// versus.md): which pieces are played by two (from the catalog), the other end, an agent's hand (never weaker than the
// computer; 50 is the computer's own exactly), the other side's score kept by the sims and checked by the module, the
// words; then in a living city with a real play core: its owner steps up to an air hockey table, the companion takes the
// other end (while their game holds the whole table) and is drawn playing there; their game is laid out with its hand;
// the result is recorded for both — the owner's run as before, the agent's own run of the same game from its side — with
// its bubble and diary; it is back at their side when they leave. Free Will asked (and an honest no); the reflex; ping-pong.
import assert from 'node:assert/strict';
import test from 'node:test';
import { versusOf, farSlot, handFor, handWords, goodGame, foeOf, waitState, tally, HAND_MIN, HAND_MAX } from '../../shared/versus.js';
import { handOf, InputLog, inputValue, inputBits, replay, TICK_HZ } from '../../shared/arcade/core.js';
import { SIMS } from '../../shared/arcade/sims.js';
import { GAMES } from '../../shared/arcade/catalog.js';
import { verifyArcade } from '../../shared/arcade.js';
import { parseCommand } from '../../server/companions/intent.js';

// ------------------------------------------------------------------------------------------------ the bots (tests only)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** A player's hand for each two-sided game: the input of one step from the state (deterministic). */
const BOTS = {
  'puck-rush': (s, sim) => { const [px, py] = sim.toPx(clamp(s.px, -0.6, 0.6), Math.max(0.1, s.pz + 0.06)); return inputValue(0, px, py, 1); },
  'foos-frenzy': (s, sim) => { const [px, py] = sim.toPx(s.bx, s.bz); return inputValue(s.t % 20 === 0 ? 16 : 0, px, py, 1); },
  'pool-shark': (s) => (s.ph === 'aim' ? (s.chg < 0 || s.chg < 40 ? 16 : 0) : 0),   // (hold A, let go: a shot straight on)
};
/** Plays game id from seed with hand o to its end: { s, log, ticks }. */
function playOut(id, seed, o = null, maxT = 3 * 3600 * TICK_HZ) {
  const sim = SIMS[id], s = sim.init(seed, o), log = new InputLog();
  while (!sim.over(s) && s.t < maxT) { const v = BOTS[id](s, sim); log.push(v); s.ev.length = 0; sim.step(s, inputBits(v)); }
  return { s, log: log.encode(), ticks: log.ticks };
}

// ------------------------------------------------------------------------------------------------ pure
test('the tables for two, from the catalog: the two-sided machines and a pastime\'s facing pair; the other end', () => {
  for (const [t, game] of [['pool_table', 'pool-shark'], ['air_hockey', 'puck-rush'], ['foosball', 'foos-frenzy']]) {
    const v = versusOf(t);
    assert.ok(v, t);
    assert.equal(v.game?.id, game);
    assert.ok(v.slots.length >= 2 && Array.isArray(v.you), `${t}: its ends and its player's`);
  }
  const pp = versusOf('pingpong');
  assert.ok(pp && pp.game === null && pp.use === 'pingpong' && pp.slots.length === 2, 'the ping-pong table: two facing ends, no machine game');
  for (const t of ['dance_floor', 'cafe_table', 'guest_table', 'meeting_table', 'dance_machine', 'bench', 'skeeball', 'arcade_cabinet']) assert.equal(versusOf(t), null, `${t} is not a table for two`);
  // every two-sided game says where its player is and what a tally counts
  for (const g of GAMES.filter(x => x.cpu)) { assert.ok(Array.isArray(g.you), g.id); assert.ok(['goals', 'balls'].includes(g.count), g.id); assert.equal(typeof SIMS[g.id].other, 'function', `${g.id}: the other side's game`); }
  // the far end: opposite the player's (the camera's) end; a pastime's, the end away from its player
  assert.equal(farSlot(versusOf('air_hockey')), 1);
  assert.equal(farSlot(versusOf('pool_table')), 1);
  assert.equal(farSlot(versusOf('foosball')), 1);
  assert.equal(farSlot(versusOf('pingpong'), [0, 1.85]), 1);
  assert.equal(farSlot(versusOf('pingpong'), [0, -1.85]), 0);
  assert.equal(farSlot(versusOf('air_hockey'), null, [1]), 0, 'its far end taken: the other');
});

test('an agent\'s hand: from its arcade level and stars, never weaker than the computer (50: the computer\'s own, exactly)', () => {
  assert.equal(handFor(1, 0), HAND_MIN);
  assert.equal(handFor(6, 0), 70);
  assert.equal(handFor(6, 3), 79);
  assert.equal(handFor(40, 3), HAND_MAX);
  assert.equal(handFor(-3, -1), HAND_MIN);
  assert.equal(handOf(null), null);
  assert.deepEqual(handOf({ k: 50 }), { sp: 1, err: 1 });
  assert.ok(handOf({ k: 95 }).sp > 1 && handOf({ k: 95 }).err < 1);
  assert.equal(handWords(50), 'as good as the computer');
  assert.equal(handWords(90), 'a lot better than the computer');
  // a hand of 50 plays the very game the computer plays; a better one another
  for (const id of ['puck-rush', 'foos-frenzy', 'pool-shark']) {
    const a = playOut(id, 1234, null), b = playOut(id, 1234, { k: 50 }), c = playOut(id, 1234, { k: 95 });
    assert.equal(a.log, b.log, `${id}: the computer's hand is 50`);
    assert.equal(SIMS[id].score(a.s), SIMS[id].score(b.s));
    assert.ok(a.log !== c.log || SIMS[id].other(a.s).score !== SIMS[id].other(c.s).score || a.s.t !== c.s.t, `${id}: a better hand plays another game`);
  }
});

test('the other side\'s game: kept by the sim by the same rules, checked by the module from the same log (side −1)', () => {
  for (const id of ['puck-rush', 'foos-frenzy', 'pool-shark']) {
    const vs = { k: 80, name: 'Kai', game: id }, seed = 77;
    const r = playOut(id, seed, vs), sim = SIMS[id], o = sim.other(r.s), mine = sim.detail(r.s);
    assert.ok(r.s.over, `${id} ended`);
    // the player's run, checked with the agent's hand; the agent's, the same log from its side
    const ms = Math.round((r.ticks * 1000) / TICK_HZ) + 10;
    const v1 = verifyArcade({ id }, { log: r.log, score: sim.score(r.s) }, { data: { seed, vs }, serverMs: ms });
    const v2 = verifyArcade({ id }, { log: r.log }, { data: { seed, vs, side: -1 }, serverMs: ms });
    assert.equal(v1.ok, true, JSON.stringify(v1)); assert.equal(v2.ok, true, JSON.stringify(v2));
    assert.equal(v1.score, sim.score(r.s)); assert.equal(v1.detail.vs, true);
    assert.equal(v2.score, o.score); assert.deepEqual({ ...v2.detail, vs: undefined }, { ...o.detail, vs: undefined });
    // (the same log checked without the agent's hand is another game: its hand is part of the run)
    const v3 = verifyArcade({ id }, { log: r.log }, { data: { seed }, serverMs: ms });
    assert.ok(!v3.ok || v3.score !== v1.score || JSON.stringify(v3.detail) !== JSON.stringify({ ...v1.detail, vs: undefined }) || id === 'pool-shark', `${id}: the hand counts`);
    if (id !== 'pool-shark') {
      assert.equal(o.detail.me, mine.cpu); assert.equal(o.detail.them, mine.me);
      assert.equal(o.detail.win, mine.cpu > mine.me); assert.equal(o.detail.draw, mine.cpu === mine.me);
      assert.ok(o.score >= 100 * mine.cpu + (o.detail.win ? 500 : 0), `${id}: 100 a goal, 500 a win (${o.score})`);
    } else {
      assert.equal(o.detail.me, r.s.potted[1]); assert.equal(o.detail.them, r.s.potted[0]);
      assert.equal(o.detail.win, !mine.win && !o.detail.draw);
    }
    // a one-sided game has no other side
    assert.equal(verifyArcade({ id: 'block-drop' }, { log: r.log }, { data: { seed, side: -1 }, serverMs: ms }).ok, false);
  }
  // the old runs play the same as before (no hand: the computer)
  const old = playOut('puck-rush', 9);
  assert.equal(replay(SIMS['puck-rush'], 9, old.log).state.score, SIMS['puck-rush'].score(old.s));
});

test('its words: good game, the tally; who is at the other end on the screen; what the game does while it waits', () => {
  assert.equal(goodGame({ win: false, draw: false, me: 2, them: 3 }), 'Good game! 3–2 to you');
  assert.equal(goodGame({ win: true, draw: false, me: 5, them: 3 }), 'Good game! 5–3 to me');
  assert.equal(goodGame({ win: false, draw: true, me: 2, them: 2 }), 'Good game! A draw, 2–2');
  assert.match(goodGame({ win: true, me: 6, them: 4 }, 'balls'), /^Good game! That one's mine/);
  assert.match(goodGame({ win: false, me: 2, them: 7 }, 'balls'), /^Good game! You got me/);
  assert.equal(tally(3, 2), '3–2');
  assert.deepEqual(foeOf(null), { agent: false, name: 'the computer', Name: 'The computer', short: 'CPU', emoji: '🖥️' });
  const f = foeOf({ name: 'Kai Nakamura', emoji: '🦊' });
  assert.equal(f.agent, true); assert.equal(f.short, 'KAI'); assert.equal(f.name, 'Kai Nakamura');
  assert.equal(foeOf({ name: '<b>x</b>' }).name.includes('<'), false);
  assert.deepEqual(waitState(null), { wait: false, text: null, foe: null });
  const ready = { vs: { name: 'Kai', emoji: '🦊', state: 'ready' } };
  assert.equal(waitState(ready).foe.name, 'Kai');
  assert.match(waitState({ vs: { name: 'Kai', emoji: '🦊', state: 'coming' } }).text, /Kai is walking to the other end/);
  assert.equal(waitState({ vs: { name: 'Kai', state: 'coming' } }, 31000).wait, false, 'not forever');
  assert.match(waitState({ pending: { agents: [{ name: 'Kai', emoji: '🦊' }, { name: 'Sam', emoji: '' }] } }).text, /Kai and Sam are thinking about a game/);
  const no = waitState({ declined: { name: 'Kai', emoji: '🦊', why: 'chose to carry on as they were' } });
  assert.equal(no.wait, false); assert.match(no.text, /Kai chose to carry on as they were: you play the computer/);
});

test('the reflex: "let\'s play pool", "play with me", "stop playing" — and what is not one', () => {
  assert.deepEqual(parseCommand("let's play pool", { name: 'Kai' }), { action: 'versus', game: 'pool', sentence: "let's play pool" });
  assert.equal(parseCommand('Kai, play air hockey with me').game, 'air hockey');
  assert.equal(parseCommand('fancy a game of foosball?').action, 'versus');
  assert.equal(parseCommand('do you want to play ping pong').game, 'ping pong');
  assert.equal(parseCommand('play with me').action, 'versus');
  assert.equal(parseCommand("let's play").action, 'versus');
  assert.equal(parseCommand('stop playing').action, 'unversus');
  for (const t of ["let's play the piano", 'I played pool yesterday', 'the pool is closed', 'who won the hockey game']) assert.equal(parseCommand(t), null, t);
});

// ------------------------------------------------------------------------------------------------ a living city
async function city({ swap = 'air_hockey', decides = false, hour = 20 } = {}) {
  const { generateWorld } = await import('../../server/world/generate.js');
  const { generatePopulation } = await import('../../server/sim/population.js');
  const { WorldIndex } = await import('../../server/sim/windex.js');
  const { Sim } = await import('../../server/sim/sim.js');
  const { evalPlan } = await import('../../server/sim/plan.js');
  const { setPlayerSpots } = await import('../../server/sim/agents.js');
  const { PlayerNav } = await import('../../shared/playernav.js');
  const { PF_USING } = await import('../../shared/playerproto.js');
  const { ctxOf } = await import('../../shared/constants.js');
  const { toWorld } = await import('../../shared/geom.js');
  const { Companions } = await import('../../server/companions/companions.js');
  const { createInteractions } = await import('../../server/interactions/index.js');
  const { PlayCore } = await import('../../server/play/play.js');
  const { Versus } = await import('../../server/play/versus.js');
  const { economyModel } = await import('../helpers/econ-model.mjs');
  const world = generateWorld({ seed: 'versus-unit', population: 300 });
  // a table for two on a public floor (the generated city has its lounge's ping-pong table; an arcade's machine stands in
  // for it, the same size, when the test is about one)
  let at = null;
  for (const B of world.buildings) { if (at || B.gone) continue; for (let f = 0; f < B.floors && !at; f++) { const it = (world.levels[B.lv[f]].items || []).find(x => x.t === 'pingpong'); if (it) at = { b: B.idx, f, it }; } }
  assert.ok(at, 'a ping-pong table in the city');
  if (swap) at.it.t = swap;
  const roster = [{ agentId: 'v-agent-1', name: 'Kai', emoji: '🦊', role: 'Tester' }, { agentId: 'v-agent-2', name: 'Sam', emoji: '🐼', role: 'Tester' }];
  const people = generatePopulation(world, new WorldIndex(world), { population: 300, roster });
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0, ms = 1.8e12;
  sim.now = () => T;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: hour * 3600, dayScale: 16 };
  const model = economyModel({ city: { world, people } });
  sim.start();
  const idx = k => people.findIndex(p => p && p.agentId === `v-agent-${k}`);
  const recs = [1, 2].map(k => ({ id: k, key: `v-agent-${k}`, name: k === 1 ? 'Kai' : 'Sam', emoji: k === 1 ? '🦊' : '🐼', enabled: true, ownerId: 7 }));
  const agents = { get: id => recs.find(r => r.id === Number(id)) || null, byKey: k => recs.find(r => r.key === k) || null, enabled: () => recs,
    isOwner: (P, a) => P?.account?.id === a.ownerId, canManage: () => false };
  const life = { byAgent: new Map(recs.map(r => [r.id, idx(r.id)])) };
  const nav = new PlayerNav(world), players = { byId: new Map(), nav };
  setPlayerSpots(() => { const out = []; for (const p of players.byId.values()) if ((p.flags & PF_USING) && p.ctx >= -1) out.push({ x: p.x, z: p.z, ctx: p.ctx }); return out; });
  const P = { account: { id: 7, displayName: 'Kim', login: 'kim' } };
  const comp = new Companions({ sim: () => sim, players, vehicles: () => ({ all: new Map(), seats: null }), agents, life: () => life, world: () => null,
    setting: k => ({ 'companions.waitMinutes': 5 })[k], notify: () => {}, send: () => {}, principalFor: () => P, now: () => ms });
  comp.hookSim();
  comp.decides = () => decides;
  const I = createInteractions({ sim: () => sim, companions: () => comp, life: () => life, players, principalFor: () => P, ownerOf: r => r.ownerId });
  const play = new PlayCore({ dbs: model.dbs, now: () => ms });
  const said = [], frames = [], notes = [], near = [], asked = [], remarks = [];
  comp.remark = (i, s) => remarks.push({ i, s });
  const V = new Versus({ play, players, sim: () => sim, agents, companions: () => comp, interactions: I, decides: rec => !!comp.decides(rec),
    ask: (rec, text, after) => { asked.push({ rec, text, after }); return true; },
    say: (i, text) => said.push({ i, text }), toAccount: (id, f) => frames.push({ id, ...f }), note: (id, kind, text) => notes.push({ id, kind, text }), noteNear: (id, text) => near.push({ id, text }),
    nameOf: id => (id === 7 ? 'Kim' : null), now: () => ms }).attach({ timer: false });
  I.add(V.source());
  comp.versus = V;
  { const ctx0 = play.contextFor; play.contextFor = (id, where, account) => (id === 'arcade' ? { ...(ctx0(id, where, account) || {}), ...V.context(where, account) } : ctx0(id, where, account)); }
  const run = (secs, step = 0.5) => { const end = T + secs; while (T < end) { T += step; ms += step * 1000; sim.tick(); sim.flush(); comp.tick(); V.tick(); } };
  const until = (fn, secs = 300) => { const end = T + secs; while (T < end) { if (fn()) return true; run(1); } return !!fn(); };
  const B = world.buildings[at.b], e = sim.index.entry(at.b, at.f, at.it.id), slotW = k => toWorld(B, e.slots[k].lx, e.slots[k].lz), apW = k => toWorld(B, e.slots[k].ax, e.slots[k].az);
  const ctx = ctxOf(at.b, at.f);
  return { world, sim, comp, I, play, V, P, recs, players, nav, idx, run, until, said, frames, notes, near, asked, remarks, at, B, e, slotW, apW, ctx, evalPlan, PF_USING, model, ms: () => ms, addMs: d => { ms += d; },
    close: () => { V.stop(); setPlayerSpots(null); model.close(); } };
}
/** Its owner at the player's end of the table (k) with Kai following them there; → the player's record. */
function ownerAt(c, k) {
  const w = c.apW(k), s = c.slotW(k);
  const p = { id: 7, name: 'Kim', x: w.x, z: w.z, y: 0, ctx: c.ctx, yaw: 0, flags: 0, vehicleId: null };
  c.players.byId.set(7, p);
  assert.equal(c.comp.command(c.P, { agent: 1, action: 'follow', target: 'me' }).ok, true);
  const i = c.idx(1);
  assert.ok(c.until(() => { const e = c.evalPlan(c.sim.agents[i].plan, c.sim.now()); return e.ctx === p.ctx && Math.hypot(e.x - p.x, e.z - p.z) < 4; }, 2000), 'Kai came to Kim at the table');
  Object.assign(p, { x: s.x, z: s.z, flags: c.PF_USING });   // (Kim steps up to their end: Player mode's use)
  c.sim.brain.playerTook(p.x, p.z, p.ctx);
  return p;
}
/** Kim's game against whoever is at the other end, played out by a bot: → the play core's finish. */
function ownerGame(c, id, where) {
  const st = c.play.start({ id: 7 }, 'arcade', id, where);
  const r = playOut(id, st.data.seed, st.data.vs || null);
  c.addMs(Math.round((r.ticks * 1000) / TICK_HZ) + 500);
  return { st, r, res: c.play.finish({ id: 7 }, st.run, { log: r.log, score: SIMS[id].score(r.s), ticks: r.ticks }) };
}

test('at the air hockey table: Kai takes the other end while Kim\'s game holds it, plays as itself, and the result is recorded for both', async () => {
  const c = await city({ swap: 'air_hockey' });
  try {
    const i = c.idx(1), A = c.sim.agents[i], rec = c.recs[0], { b, f } = c.at, id = c.at.it.id;
    const p = ownerAt(c, 0);
    // Kim's game opens: the whole table is theirs (the arcade hold) and Kai — no Free Will to decide: it joins in by itself
    c.sim.brain.holdPiece(b, f, id, 75000);
    const view = c.V.table(7, { b, f, id });
    assert.equal(view.ok, true);
    assert.ok(view.vs, `Kai is coming: ${JSON.stringify(view)}`);
    assert.equal(view.vs.name, 'Kai'); assert.equal(view.vs.state, 'coming'); assert.equal(view.vs.hand, 50, 'a beginner plays as well as the computer');
    assert.equal(A.order.kind, 'follow', 'still Kim\'s companion');
    assert.equal(A.order.seat.mode, 'use'); assert.equal(A.order.seat.k, 1, 'the far end');
    assert.ok(c.frames.some(x => x.t === 'versus' && x.id === 7 && /Kai is heading to the other end/.test(x.text)), 'Kim\'s page hears it');
    assert.ok(c.notes.some(x => x.id === 1 && /Went to the other end of the Air Hockey to play Puck Rush \(air hockey\) against Kim/.test(x.text)), `its diary: ${JSON.stringify(c.notes)}`);
    // nobody else may take that end (a resident), and Kim's hold — refreshed — doesn't send Kai away
    const other = c.sim.agents.find(x => x?.plan && !x.p.vip);
    assert.equal(c.sim.brain.taken(b, f, id, 1, other.i), true, 'held for Kai');
    assert.equal(c.sim.brain.taken(b, f, id, 1, i), false, 'free for Kai, a guest of the table');
    assert.ok(c.until(() => c.V.view(7).vs?.state === 'ready', 200), 'Kai got to the other end');
    c.sim.brain.holdPiece(b, f, id, 75000);
    c.run(3);
    assert.equal(c.V.view(7).vs?.state, 'ready', 'still there after the hold was refreshed');
    const e = c.evalPlan(A.plan, c.sim.now()), far = c.slotW(1);
    assert.ok(Math.hypot(e.x - far.x, e.z - far.z) < 0.5, 'its body at the far end');
    assert.equal(e.s?.anim, c.e.slots[1].anim, 'playing there (the table\'s own clip: the striker in its hand)');
    assert.equal(A.act.label, 'Playing arcade with Kim');
    // Kim's game is laid out with Kai: its name, its hand
    const where = { b, f, id };
    const { st, r, res } = ownerGame(c, 'puck-rush', where);
    assert.deepEqual({ name: st.data.vs.name, k: st.data.vs.k, agent: st.data.vs.agent }, { name: 'Kai', k: 50, agent: 1 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.score, SIMS['puck-rush'].score(r.s), 'Kim\'s run as ever');
    assert.ok(res.vs, 'Kai\'s side on Kim\'s results card');
    const o = SIMS['puck-rush'].other(r.s);
    assert.equal(res.vs.score, o.score); assert.equal(res.vs.me, r.s.cpu); assert.equal(res.vs.them, r.s.me);
    assert.equal(res.vs.line, goodGame(o.detail));
    assert.ok(res.vs.xp >= 1);
    // Kai's own record: its arcade progress, its run
    const pr = c.play.progress(-1);
    assert.equal(pr.modules.arcade.runs, 1, 'a run of its own');
    assert.equal(pr.modules.arcade.best['puck-rush'].score, o.score);
    assert.ok(pr.badges.some(x => x.id === 'arc_coin_op'), 'its first game: the platform\'s badge');
    assert.equal(c.play.progress(7).modules.arcade.runs, 1, 'Kim\'s too');
    assert.ok(c.said.some(x => x.i === i && x.text === res.vs.line), 'its word in a bubble');
    assert.ok(c.notes.some(x => x.id === 1 && /^(Beat|Lost to|Drew with) Kim at Puck Rush/.test(x.text)), 'its diary');
    assert.ok(c.near.some(x => x.id === 7 && /Kim (beat|lost to|drew with) Kai at Puck Rush/.test(x.text)), 'near Kim');
    assert.equal(c.V.view(7).vs.games, 1);
    // a game without the table's where (Kim chose the computer): the computer's
    const st2 = c.play.start({ id: 7 }, 'arcade', 'puck-rush', null);
    assert.equal(st2.data.vs, undefined);
    c.play.abandon({ id: 7 }, st2.run);
    // Kim closes the game and walks off: Kai is back at their side
    c.V.table(7, { on: false });
    Object.assign(p, { flags: 0 });
    const out = c.apW(0); Object.assign(p, { x: out.x + 1.5, z: out.z });
    assert.ok(c.until(() => !c.V.matchView(1), 60), 'the match is over');
    assert.equal(A.order.kind, 'follow');
    assert.ok(c.until(() => !A.order.seat, 20), 'up from the table');
    assert.equal(c.sim.brain.isGuest(b, f, id, i), false, 'the table no longer its');
    assert.ok(c.notes.some(x => x.id === 1 && /^Played Puck Rush \(air hockey\) against Kim at the Air Hockey \(1 game/.test(x.text)), `its diary: ${c.notes.map(x => x.text).join(' | ')}`);
  } finally { c.close(); }
});

test('Free Will decides: the moment is offered (its options have the other end first); a no is said to Kim\'s game; a yes plays', async () => {
  const c = await city({ swap: 'foosball', decides: true });
  try {
    const i = c.idx(1), rec = c.recs[0], { b, f } = c.at, id = c.at.it.id;
    ownerAt(c, 0);
    c.sim.brain.holdPiece(b, f, id, 75000);   // (the game's page holds the whole table as it opens: client/js/play/machine-play.js)
    const v = c.V.table(7, { b, f, id });
    assert.equal(v.vs, null);
    assert.equal(c.asked.length, 1, 'Free Will asked');
    assert.match(c.asked[0].text, /Kim \(your owner\) stepped up to the Foosball Table to play Foos Frenzy \(foosball\)/);
    assert.ok(c.V.view(7).pending?.agents.some(x => x.name === 'Kai'), 'Kim\'s game waits for it');
    const opts = c.I.nearFor(rec, { limit: 6 }).filter(x => x.source === 'versus');   // (what the moment offers: the first six)
    assert.equal(opts.length, 1, `among its options: ${c.I.nearFor(rec, { limit: 20 }).map(x => `${x.source}:${x.label}:${x.d}`).join(' | ')}`);
    assert.match(opts[0].label, /^Play Foos Frenzy \(foosball\) against Kim — from the other end of the Foosball Table/);
    assert.equal(opts[0].withLeader, true); assert.equal(opts[0].d, 0, 'joining what Kim does there');
    // it chose something else: Kim's game hears so, and plays the computer
    c.asked[0].after({ kind: 'world', label: 'Turn and look at the dog' }, 'turned to look');
    const no = c.V.view(7);
    assert.equal(no.pending, null);
    assert.match(no.declined.why, /^chose to turn and look at the dog instead/);
    // asked again (Kim opened the game again): this time it plays — the registry's do, as Free Will does it
    c.V.table(7, { b, f, id });
    const r = c.I.doFor(rec, opts[0].id, { via: 'freewill' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.brain, /^you are walking to the other end of the Foosball Table to play Foos Frenzy \(foosball\) against Kim: on their screen the other player is you — your own play, at your arcade level 1/);
    c.asked[1]?.after(opts[0], 'chose to play');
    assert.equal(c.V.view(7).vs?.name, 'Kai');
    assert.equal(c.V.view(7).declined, null);
    // Sam can't take the same table: Kai is there
    assert.ok(c.until(() => c.V.view(7).vs?.state === 'ready', 200));
    assert.equal(c.sim.agents[i].order.seat.k, 1);
    // stopping, as asked (its chat's do, the reflex's "stop playing")
    const stop = c.V.command(c.P, rec, { action: 'unversus' }, 'chat', x => c.I.contextFor(x));
    assert.equal(stop.ok, true); assert.match(stop.text, /Kai stops playing and comes back to Kim/);
    assert.equal(c.V.matchView(1), null);
  } finally { c.close(); }
});

test('the reflex: "let\'s play pool" near the table — Kai goes to the far end and waits; Kim steps up: their game is against Kai', async () => {
  const c = await city({ swap: 'pool_table' });
  try {
    const i = c.idx(1), rec = c.recs[0], { b, f } = c.at, id = c.at.it.id;
    const p = ownerAt(c, 0);
    Object.assign(p, { flags: 0 });   // (beside the table, not at it yet)
    const w = c.apW(0); Object.assign(p, { x: w.x + 0.8, z: w.z });
    const no = c.V.command(c.P, rec, { action: 'versus', game: 'air hockey' }, 'chat', x => c.I.contextFor(x));
    assert.equal(no.ok, false); assert.match(no.text, /There is no air hockey free near you/);
    assert.equal(c.V.command(c.P, rec, { action: 'versus' }, 'chat', x => c.I.contextFor(x)) !== null, true, 'a table for two near: "let\'s play" is this');
    c.V.end(c.V.matchView(1) ? c.V.matches.get(1) : { agent: 0 }, 'asked');
    const r = c.V.command(c.P, rec, { action: 'versus', game: 'pool' }, 'chat', x => c.I.contextFor(x));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(c.sim.agents[i].order.seat.k, 1, 'the far end, opposite the player\'s');
    assert.ok(c.until(() => c.V.view(7).vs?.state === 'ready', 200));
    // Kim steps up and plays: Kai is not sent away by it
    Object.assign(p, { x: c.slotW(0).x, z: c.slotW(0).z, flags: c.PF_USING });
    c.sim.brain.playerTook(p.x, p.z, p.ctx);
    c.sim.brain.holdPiece(b, f, id, 75000);
    c.run(2);
    assert.equal(c.V.view(7).vs?.state, 'ready');
    const { st, res } = ownerGame(c, 'pool-shark', { b, f, id });
    assert.equal(st.data.vs.name, 'Kai');
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.vs.count, 'balls');
    assert.match(res.vs.line, /^Good game!/);
  } finally { c.close(); }
});

test('ping-pong: Kim at one end — Kai (no Free Will) takes the other, plays while they do, says good game when they stop', async () => {
  const c = await city({ swap: null, hour: 10 });   // (a quiet morning at the lounge: no resident has the other end booked)
  try {
    const i = c.idx(1), A = c.sim.agents[i];
    const p = ownerAt(c, 0);
    // (the tick sees Kim at one end: Kai is asked — it simply joins in, once the other end is free of a resident's booking)
    c.run(1);
    const m = c.V.matchView(1);
    assert.ok(m, 'Kai plays Kim');
    assert.equal(m.game, null); assert.equal(m.k, 1);
    assert.ok(c.until(() => c.V.view(7).vs?.state === 'ready', 200));
    assert.equal(A.act.use, 'pingpong'); assert.equal(c.evalPlan(A.plan, c.sim.now()).s?.prop, c.e.slots[1].prop, 'the paddle');
    // no other way to the same table offered (furniture's joining): the versus source's
    const list = c.I.nearFor(c.recs[1], { limit: 20 });
    assert.ok(!list.some(x => x.source === 'furniture' && x.kind === 'pingpong' && x.withLeader), 'one way to play them, not two');
    c.run(30);
    assert.ok(c.V.matchView(1), 'still playing while Kim plays');
    Object.assign(p, { flags: 0 });
    assert.ok(c.until(() => !c.V.matchView(1), 40), 'Kim stopped: the match is over');
    assert.ok(c.said.some(x => x.i === i && x.text === 'Good game, Kim!'));
    assert.ok(c.notes.some(x => x.id === 1 && /^Played ping-pong against Kim at the Ping-Pong Table for \d+ min/.test(x.text)), c.notes.map(x => x.text).join(' | '));
    assert.ok(c.until(() => !A.order.seat, 20), 'back at their side');
  } finally { c.close(); }
});
