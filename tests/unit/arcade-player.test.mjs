// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's own player (shared/arcade/player.js): one player for every built-in game from the sim's interface alone —
// its controls found by trying the sim, its play a real input log the module's own check accepts (replayed from the seed,
// no quicker than the clock), its thinking bounded, fair (it never sees the game's own dice), better with skill, and a
// game it is told to wind up ends.
import assert from 'node:assert/strict';
import test from 'node:test';
import { GAMES, gameOf } from '../../shared/arcade/catalog.js';
import { SIMS } from '../../shared/arcade/sims.js';
import { BTN, replay, TICK_HZ } from '../../shared/arcade/core.js';
import { verifyArcade } from '../../shared/arcade.js';
import { ArcadePlayer, playRun, controlsOf, cloneState, skillOfLevel } from '../../shared/arcade/player.js';

const BUILTIN = GAMES.filter(g => g.kind === 'builtin');
const course = g => ({ id: g.id, label: g.title, stars: g.stars });
const check = (g, seed, r) => verifyArcade(course(g), { log: r.log, score: r.score }, { data: { seed }, serverMs: Math.ceil((r.ticks * 1000) / TICK_HZ) });

test('every built-in game has a sim, and the player finds its controls by trying it', () => {
  assert.equal(BUILTIN.length, Object.keys(SIMS).length);
  for (const g of BUILTIN) {
    const c = controlsOf(SIMS[g.id]);
    assert.equal(c.inputs[0], 0, `${g.id}: holding nothing is one of its choices`);
    assert.ok(c.inputs.length >= 2, `${g.id}: at least one input does something`);
    assert.ok(c.stepUs > 0 && c.probeMs < 1000, `${g.id}: a bounded probe (${c.probeMs} ms)`);
  }
  // what the sims read, as found: a one-button flyer flaps (A or ▲) and nothing else; the snake steers four ways
  const flap = controlsOf(SIMS['flap-dash']).inputs, snake = controlsOf(SIMS['neon-snake']).inputs;
  assert.ok(flap.includes(BTN.A) && !flap.includes(BTN.L) && !flap.includes(BTN.B), `flap-dash: ${flap}`);
  for (const b of [BTN.U, BTN.D, BTN.L, BTN.R]) assert.ok(snake.includes(b), 'neon-snake steers');
  assert.ok(!snake.includes(BTN.A), 'neon-snake has no button');
  assert.ok(controlsOf(SIMS['city-shield']).pointer?.x, 'city-shield reads the pointer');
  assert.equal(controlsOf(SIMS['neon-snake']).pointer, null, 'neon-snake does not');
});

test('the player plays every game to its end, and the module\'s own check accepts the run (replayed from the seed, the same score)', () => {
  for (const g of BUILTIN) {
    const seed = 1000 + g.id.length * 7919;
    const r = playRun(SIMS[g.id], seed, { skill: 0.5, stars: g.stars, thinkUs: 3000, maxTicks: 25 * TICK_HZ });
    assert.equal(r.over, true, `${g.id}: the game ended (wound up after 25 s)`);
    const v = check(g, seed, r);
    assert.equal(v.ok, true, `${g.id}: ${v.why}`);
    assert.equal(v.score, r.score, `${g.id}: the server's own score is the player's`);
    assert.ok(!v.detail?.claimed, `${g.id}: nothing claimed that wasn't played`);
    // never quicker than the clock: the same run sent before its time is refused
    const early = verifyArcade(course(g), { log: r.log, score: r.score }, { data: { seed }, serverMs: Math.max(0, (r.ticks * 1000) / TICK_HZ - 6000) });
    if (r.ticks > 7 * TICK_HZ) assert.equal(early.ok, false, `${g.id}: a run sent before its time is refused`);
  }
});

test('fair and bounded: its thinking never touches the game it plays (the dice are its own), and stays within its budget', () => {
  const g = gameOf('star-siege'), sim = SIMS[g.id];
  const p = new ArcadePlayer(sim, 77, { skill: 1, stars: g.stars, stepsPerTick: 400 });
  p.play(20 * TICK_HZ);
  // the real game is exactly what its recorded inputs make of the seed
  const again = replay(sim, 77, p.encode());
  assert.deepEqual({ ...again.state, ev: [] }, { ...cloneState(p.s), ev: [] });
  // its budget: about stepsPerTick sim steps for each step played (plus what it may save up)
  assert.ok(p.stats.thought <= 400 * p.ticks + 400 * 30 + 1000, `thought ${p.stats.thought} for ${p.ticks} steps`);
  assert.ok(p.stats.plans > 100, 'it thought about many plans');
  // the dice it thinks with are not the game's: its copies' own (cloneState copies; the state's rs is replaced in them)
  const c = cloneState(p.s);
  c.rs[0] ^= 1; c.ev.push({ k: 'x' });
  assert.notEqual(c.rs[0], p.s.rs[0]);
  assert.equal(p.s.ev.includes(c.ev[c.ev.length - 1]), false);
});

test('skill: a player at its best scores more than a new one (the same games, the same seeds), and a beginner is human, not a machine', () => {
  for (const id of ['mole-mayhem', 'star-siege']) {
    const g = gameOf(id), sim = SIMS[id];
    let lo = 0, hi = 0;
    for (const seed of [11, 12]) {
      lo += playRun(sim, seed, { skill: 0, stars: g.stars, stepsPerTick: 200, maxTicks: 60 * TICK_HZ }).score;
      hi += playRun(sim, seed, { skill: 1, stars: g.stars, stepsPerTick: 200, maxTicks: 60 * TICK_HZ }).score;
    }
    assert.ok(hi > lo, `${id}: skill 1 ${hi / 2} > skill 0 ${lo / 2}`);
    // a beginner: about bronze, never far past gold (its concentration goes once it plays past a beginner's score)
    assert.ok(lo / 2 < g.stars[2], `${id}: a beginner ${lo / 2} stays under gold ${g.stars[2]}`);
  }
  assert.equal(skillOfLevel(1), 0);
  assert.equal(skillOfLevel(12), 1);
  assert.ok(skillOfLevel(6) > 0.4 && skillOfLevel(6) < 0.5);
});

test('winding up: a game it is told to stop lets it run out — it ends', () => {
  for (const id of ['flap-dash', 'brick-blitz', 'neon-snake', 'star-siege']) {
    const g = gameOf(id), p = new ArcadePlayer(SIMS[id], 5, { skill: 1, stars: g.stars, thinkUs: 3000 });
    p.play(10 * TICK_HZ);
    if (p.over) continue;
    p.windUp();
    while (!p.over && p.ticks < 3 * 60 * TICK_HZ) p.play(TICK_HZ);
    assert.equal(p.over, true, `${id}: over after winding up`);
  }
});
