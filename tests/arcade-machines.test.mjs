// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's machines as games (docs/features/arcade.md "The machines"; 2026-10-24, the product owner: "every single
// machine or game that isn't decorative has to be a real mini game players can play ... I'm noticing multiple agents
// play over each other on the same spot for the same machine"): each machine game belongs to a piece the arcade has, is
// off the cabinets' library, is a course of the play module, and its sim — played by random hands — always ends, never
// breaks and replays to the same score (the server's check). And a player at a piece keeps it: the sim gives that place
// to nobody else, and whoever was on their way there goes elsewhere.
import assert from 'node:assert/strict';
import test from 'node:test';
import { InputLog, replay, inputValue, inputBits, BTN } from '../shared/arcade/core.js';
import { GAMES, machineGame } from '../shared/arcade/catalog.js';
import { SIMS } from '../shared/arcade/sims.js';
import { CATALOG } from '../shared/catalog.js';
import { playOf } from '../shared/play.js';
import '../shared/arcade.js';
import { generateWorld, freshLevel } from '../server/world/generate.js';
import { generatePopulation, reassign } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Sim } from '../server/sim/sim.js';
import { setPlayerSpots } from '../server/sim/agents.js';
import { RNG } from '../shared/rng.js';
import { ctxOf } from '../shared/constants.js';
import { toWorld } from '../shared/geom.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WHACK, SKEE, HOOPS, CLAW } from '../shared/arcade/machines.js';
import * as MOLE from '../shared/arcade/games/mole-mayhem.js';
import * as SKEEG from '../shared/arcade/games/skee-roll.js';
import * as HOOP from '../shared/arcade/games/hoop-fever.js';
import * as PUNCH from '../shared/arcade/games/power-punch.js';
import * as CLAWG from '../shared/arcade/games/claw-catch.js';
import * as BULLG from '../shared/arcade/games/bull-rider.js';
import * as PUCK from '../shared/arcade/games/puck-rush.js';
import * as FOOSG from '../shared/arcade/games/foos-frenzy.js';
import * as PING from '../shared/arcade/games/star-pinball.js';
import { HOCKEY, FOOS, PIN, foosMen } from '../shared/arcade/machines.js';
import * as POOLG from '../shared/arcade/games/pool-shark.js';
import * as BOWLG from '../shared/arcade/games/strike-lane.js';
import * as DANCEG from '../shared/arcade/games/neon-steps.js';
import { POOL } from '../shared/arcade/machines.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MACHINES = GAMES.filter(g => g.machine);

test('each machine game is played at an arcade piece of its own, off the cabinets, a course with a sim', () => {
  assert.ok(MACHINES.length >= 4, `machine games: ${MACHINES.map(g => g.id).join(', ')}`);
  const arcade = playOf('arcade');
  for (const g of MACHINES) {
    const def = CATALOG[g.machine];
    assert.ok(def && def.cat === 'Arcade' && def.slots?.length, `${g.id}: ${g.machine} is an arcade piece people use`);
    assert.equal(machineGame(g.machine)?.id, g.id, `${g.machine} plays ${g.id}`);
    assert.ok(SIMS[g.id], `${g.id}: the server can replay it`);
    assert.ok(arcade.courses.some(c => c.id === g.id), `${g.id}: a course (leaderboard, stars)`);
    assert.ok(Array.isArray(g.stars) && g.stars.length === 3 && g.stars[0] < g.stars[1] && g.stars[1] < g.stars[2], `${g.id}: three stars`);
    if (g.id !== 'turbo-rush') assert.equal(g.cabinet, false, `${g.id}: not on the cabinets' library`);
  }
  assert.equal(machineGame('arcade'), null, 'a cabinet plays its library');
});

test('played for real on the machine (2026-10-24: "not a second gaming version ... the 3D asset becomes its own mini game"): each has its part in the world, no screen of its own, and its rules use the machine\'s measurements', () => {
  for (const g of MACHINES.filter(x => x.id !== 'turbo-rush')) {
    assert.ok(fs.existsSync(path.join(ROOT, 'client/js/play/machines', `${g.id}.js`)), `${g.id}: played in the world (client/js/play/machines)`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'client/arcade/games', `${g.id}.js`)), `${g.id}: no game screen of its own`);
  }
  // the moles come up out of the machine's own holes
  assert.equal(MOLE.N, WHACK.holes.length);
  for (let i = 0; i < MOLE.N; i++) assert.equal(MOLE.pxHole(MOLE.holePx(i)), i, `hole ${i}: the pointer tells it`);
  // the skee-ball board's cups where its model draws them
  assert.equal(SKEEG.cupAt(0, SKEE.ringsAt), 50, 'the middle cup pays 50');
  for (const [px, pu] of SKEE.pockets) assert.equal(SKEEG.cupAt(px, pu), 100, 'the corner pockets pay 100');
  assert.equal(SKEEG.cupAt(0.3, 0.1), 10, 'the rest of the board pays 10');
  // the hoop's rim: the sim's, put in the machine's frame, is the model's
  const r = HOOP.toItem(0, HOOP.HOOP_Y, HOOP.HOOP_Z);
  assert.deepEqual(r.map(v => +v.toFixed(6)), HOOPS.rim.map(v => +v.toFixed(6)), 'the rim the ball goes through is the one drawn');
});

test('batch 2 on their machines: the punch reads truer for a full, centred swing; the claw\'s prizes lie in its box, off the chute, a golden star among them; the bull can be ridden', () => {
  // power punch: the same wind-up, the light dead centre, beats it at the edge; a full one beats a half one
  const at = (charge, light) => { const s = PUNCH.init(5); s.ph = 'aim'; s.charge = charge; s.light = light; return s; };
  assert.ok(PUNCH.powerOf(PUNCH.WIND) >= 0.99 && PUNCH.powerOf(0) < 0.2, 'winding up builds the power');
  for (const seed of [1, 9, 33]) {
    const s = PUNCH.init(seed); let t = 0, held = 0;
    while (!PUNCH.over(s) && t < 60 * 60) {
      // (starting the wind-up so it is full just as the light reaches the middle)
      if (s.ph !== 'aim') held = 0;
      else if (s.charge < 0) held = Math.abs(PUNCH.lightAt(s.pt + 1 + PUNCH.WIND, s.sweep, s.punch)) < 0.05 ? BTN.A : 0;
      else held = s.charge < PUNCH.WIND ? BTN.A : 0;
      s.ev.length = 0; PUNCH.step(s, inputBits(inputValue(held, 0, 0, 0))); t++;
    }
    assert.ok(PUNCH.over(s) && PUNCH.score(s) >= 2400, `a strong, true puncher scores well (seed ${seed}: ${PUNCH.score(s)})`);
  }
  // claw: 14 prizes inside its reach, none on the chute, one golden star
  for (const seed of [2, 8, 61]) {
    const s = CLAWG.init(seed);
    assert.ok(s.prizes.length >= 10 && s.prizes.some(p => p.kind === 3), `seed ${seed}: prizes and the star`);
    for (const p of s.prizes) {
      assert.ok(Math.abs(p.x) <= CLAW.reach && Math.abs(p.z) <= CLAW.reach, 'in the box');
      assert.ok(Math.hypot(p.x - CLAW.chute[0], p.z - CLAW.chute[1]) >= 0.16, 'off the chute');
    }
    const [px, py] = CLAWG.toPx(s.prizes[0].x, s.prizes[0].z);
    assert.ok(px >= 0 && px <= 255 && py >= 0 && py <= 255, 'the pointer can reach every prize');
  }
  // claw: aimed right over prizes, it wins some
  let wins = 0;
  for (const seed of [3, 4, 5, 6]) {
    const s = CLAWG.init(seed); let t = 0;
    while (!CLAWG.over(s) && t < 60 * 60 * 3) {
      let v = inputValue(0, 0, 0, 0);
      if (s.ph === 'steer') {
        const p = s.prizes.filter(q => !q.won && !q.held && q.kind < 3).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
        const [px, py] = CLAWG.toPx(p.x, p.z);
        v = Math.hypot(p.x - s.x, p.z - s.z) < 0.004 ? inputValue(BTN.A, 0, 0, 0) : inputValue(0, px, py, 1);
      }
      s.ev.length = 0; CLAWG.step(s, inputBits(v)); t++;
    }
    wins += s.wins;
  }
  assert.ok(wins >= 12, `aimed true, the claw mostly holds (${wins} of 20)`);
  // bull: leaning against it rides far longer than letting go
  const ride = lean => { let total = 0; for (const seed of [1, 2, 3, 4]) { const s = BULLG.init(seed); let t = 0;
    while (!BULLG.over(s) && t < 60 * 90) {
      let b = 0;
      if (lean) { const fx = s.lx + s.vx * 10, fz = s.lz + s.vz * 10; if (fx > 0.04) b |= BTN.L; if (fx < -0.04) b |= BTN.R; if (fz > 0.04) b |= BTN.U; if (fz < -0.04) b |= BTN.D; }
      s.ev.length = 0; BULLG.step(s, inputBits(inputValue(b, 0, 0, 0))); t++;
    } total += s.ride; } return total / 4 / 60; };
  const idle = ride(false), riding = ride(true);
  assert.ok(idle < 15, `left alone the bull throws you soon (${idle.toFixed(1)} s)`);
  assert.ok(riding > idle * 2 && riding > 12, `leaning against it keeps you on (${riding.toFixed(1)} s vs ${idle.toFixed(1)} s)`);
});

test('machine games: random hands always reach the end, and the replay gives the very same score', () => {
  for (const g of MACHINES.filter(x => x.id !== 'turbo-rush')) {
    const sim = SIMS[g.id];
    for (const seed of [1, 77, 4242]) {
      const s = sim.init(seed), log = new InputLog();
      let r = seed * 7919 + 13, t = 0, held = 0, hold = 0;
      const rnd = n => { r = (r * 1103515245 + 12345) & 0x7fffffff; return r % n; };
      while (!sim.over(s) && t < 60 * 60 * 6) {
        if (hold-- <= 0) { held = [0, BTN.A, BTN.A, BTN.L, BTN.R, BTN.U, BTN.D, BTN.A | BTN.L][rnd(8)]; hold = 6 + rnd(50); }
        const v = inputValue(held, rnd(256), rnd(256), rnd(3) === 0 ? 1 : 0);
        log.push(v); s.ev.length = 0; sim.step(s, inputBits(v)); t++;
      }
      assert.ok(sim.over(s), `${g.id} seed ${seed}: it ended (${t} steps)`);
      const again = replay(sim, seed, log.encode());
      assert.ok(again.over && sim.score(again.state) === sim.score(s), `${g.id} seed ${seed}: replayed ${sim.score(again.state)} = played ${sim.score(s)}`);
      assert.ok(Number.isInteger(sim.score(s)) && sim.score(s) >= 0, `${g.id}: a whole score`);
    }
  }
});

test('a player at a piece keeps it: nobody else is given that place, and those on their way go elsewhere', { timeout: 120000 }, () => {
  const seed = 'player-spot', world = generateWorld({ seed, population: 400 });
  const B = world.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3 && b.w >= 18)[0];
  const L = freshLevel(B, 1, 1, 'arcade'); world.levels.push(L); B.lv[1] = world.levels.length - 1;
  const index = new WorldIndex(world), people = generatePopulation(world, index, { population: 400, roster: [] });
  reassign(world, index, people, new RNG(`${seed}:boot`));
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0; sim.now = () => T; sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 5 * 3600, dayScale: 16 }; sim.start();
  const brain = sim.brain, it = L.items.find(i => i.t === 'skeeball'), e = index.entry(B.idx, 1, it.id), sl = e.slots[0], w = toWorld(B, sl.lx, sl.lz);
  const spots = [];
  setPlayerSpots(() => spots);
  try {
    // an agent on its way there first
    const a = sim.agents.find(x => x && x.plan && !x.p.retired && !x.p.post);
    assert.ok(brain.reserve(a, B.idx, 1, it.id, 0, [T + 10, T + 400]), 'free: reserved');
    const before = a.plan;
    spots.push({ x: w.x, z: w.z, ctx: ctxOf(B.idx, 1) });
    assert.ok(brain.taken(B.idx, 1, it.id, 0, -1), 'a player there: taken');
    const b = sim.agents.find(x => x && x !== a && x.plan && !x.p.retired && !x.p.post);
    assert.equal(brain.reserve(b, B.idx, 1, it.id, 0, [T + 5, T + 300]), false, 'nobody else may reserve it');
    assert.equal(brain.playerTook(w.x, w.z, ctxOf(B.idx, 1)), 1, 'the one on its way is turned round');
    assert.notEqual(a.plan, before, 'its plan was made again');
    assert.ok(!(brain.res.get(brain.key(B.idx, 1, it.id, 0)) || []).some(r => r[0] === a.i), 'it holds the place no more');
    // a stay well after the player came (they will be gone by then) is not refused for them
    assert.equal(brain.taken(B.idx, 1, it.id, 0, -1, [T + brain.wm(60), T + brain.wm(70)]), false, 'later on: free again');
    spots.length = 0;
    assert.equal(brain.taken(B.idx, 1, it.id, 0, -1), false, 'the player gone: free');
  } finally { setPlayerSpots(null); }
});

test('batch 3 on their tables: air hockey and foosball against the computer are won by playing well and lost by not, the puck and the ball stay on the table; pinball keeps its ball on the playfield, the flippers keep it alive, a launch can make the skill shot', () => {
  const run = (G, seed, hand, cap = 60 * 60 * 6, inside = () => true) => {
    const s = G.init(seed); let t = 0;
    while (!G.over(s) && t < cap) { s.ev.length = 0; G.step(s, inputBits(hand(s, t))); t++; assert.ok(inside(s), `on the table (step ${t})`); }
    return { s, t };
  };
  // air hockey: a player who goes round behind the puck and through it toward the goal
  const RR = HOCKEY.puckR + HOCKEY.strikerR;
  const striker = s => {
    let tx = s.px * 0.4, tz = HOCKEY.hl - 0.28;
    if (s.pz > 0.02) {
      let ux = -s.px, uz = -HOCKEY.hl - s.pz; const d = Math.hypot(ux, uz); ux /= d; uz /= d;
      const bx = s.sx - s.px, bz = s.sz - s.pz;
      if (bx * ux + bz * uz < -RR * 0.6 && Math.abs(bx * uz - bz * ux) < 0.05) { tx = s.px + ux * 0.2; tz = s.pz + uz * 0.2; }
      else { tx = s.px - ux * (RR + 0.05); tz = s.pz - uz * (RR + 0.05); }
    }
    const [px, py] = PUCK.toPx(Math.max(-HOCKEY.hw, Math.min(HOCKEY.hw, tx)), Math.max(0, Math.min(HOCKEY.hl, tz)));
    return inputValue(0, px, py, 1);
  };
  const onTable = s => s.ph === 'goal' || (Math.abs(s.px) <= HOCKEY.hw && Math.abs(s.pz) <= HOCKEY.hl);
  let won = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) { const { s } = run(PUCK, seed, striker, undefined, onTable); assert.ok(PUCK.over(s), 'it ends'); if (s.win) won++; assert.ok(s.me >= 3, `seed ${seed}: goals scored (${s.me}-${s.cpu})`); }
  assert.ok(won >= 4, `playing well beats the computer (${won} of 6)`);
  // (with the puck on your side and your hands still, it waits for you: the clock runs out at 0-0)
  const idle = run(PUCK, 9, () => inputValue(0)).s;
  assert.ok(idle.over && idle.me === 0 && idle.cpu === 0, 'idle: nobody scores, the clock ends it');
  // foosball: the men follow the ball and kick it when it is at a red man's feet
  const RODS = FOOSG.RODS;
  for (let i = 0; i < 8; i++) { const { xs, travel } = foosMen(i); for (const x of xs) assert.ok(Math.abs(x) + travel <= FOOS.hw && travel > 0, `rod ${i}: its men stay in the field`); }
  const foos = (s, t) => {
    const kick = t % 2 && RODS.some((R, i) => R.red && Math.abs(s.bz - R.z) < FOOSG.REACH && FOOSG.menOf(s, i).some(m => Math.abs(m - s.bx) < 0.03));
    const [px, py] = FOOSG.toPx(Math.max(-FOOS.hw, Math.min(FOOS.hw, s.bx + s.vx * 6)), s.bz);
    return inputValue(kick ? BTN.A : 0, px, py, 1);
  };
  const inField = s => s.ph === 'goal' || (Math.abs(s.bx) <= FOOS.hw && Math.abs(s.bz) <= FOOS.hl);
  let fw = 0, fg = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) { const { s } = run(FOOSG, seed, foos, undefined, inField); if (s.win) fw++; fg += s.me; }
  assert.ok(fw >= 2 && fg >= 15, `playing well wins some (${fw} of 6, ${fg} goals)`);
  for (const seed of [1, 2, 3]) { const { s } = run(FOOSG, seed, () => inputValue(0), undefined, inField); assert.ok(s.over && s.cpu === FOOSG.GOALS && !s.win, `idle: the computer wins (${s.me}-${s.cpu})`); }
  // pinball: the ball on the playfield (or in the shooter lane), the flippers keep it longer
  const onField = s => s.ph !== 'play' || (s.x >= -PIN.wallX && s.x <= PIN.wallX && s.z >= PIN.arch.cz - PIN.arch.r - 0.001 && s.z <= PIN.drain + 0.1);
  const flipper = (s, t) => {
    if (s.ph === 'lane') return inputValue(t % 90 < 30 ? BTN.D : 0);
    let b = 0;
    PIN.flippers.forEach(({ at }, i) => { if (s.vz > -0.004 && s.z > at[1] - 0.075 && s.z < at[1] + 0.05 && (i ? s.x > at[0] - 0.1 && s.x < at[0] + 0.02 : s.x < at[0] + 0.1 && s.x > at[0] - 0.02)) b |= i ? BTN.R : BTN.L; });
    return inputValue(b);
  };
  const still = (s, t) => inputValue(s.ph === 'lane' && t % 90 < 30 ? BTN.D : 0);
  let tf = 0, tn = 0, sf = 0, sn = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const a = run(PING, seed, flipper, 60 * 60 * 20, onField), b = run(PING, seed, still, 60 * 60 * 20, onField);
    assert.ok(PING.over(a.s) && PING.over(b.s), 'three balls, then over');
    tf += a.t; tn += b.t; sf += a.s.score; sn += b.s.score;
  }
  assert.ok(tf > tn * 1.4 && sf > sn, `the flippers keep it alive (${(tf / 360).toFixed(0)} s against ${(tn / 360).toFixed(0)} s, ${sf} against ${sn})`);
  let skill = 0;
  for (let p = 6; p <= 30; p += 3) {
    const s = PING.init(5); let t = 0;
    while (t < 60 * 8 && s.ph !== 'drain') { s.ev.length = 0; PING.step(s, inputBits(inputValue(t < p ? BTN.D : 0))); if (s.ev.some(e => e.k === 'skill')) skill++; t++; }
  }
  assert.ok(skill >= 1, `a launch of the right strength makes the skill shot (${skill})`);
});

test('a table played against the computer is all the player\'s: nobody is sent to its other end', { timeout: 120000 }, () => {
  const seed = 'player-table', world = generateWorld({ seed, population: 400 });
  const B = world.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];   // (a big floor: its arcade has tables)
  const L = freshLevel(B, 1, 1, 'arcade'); world.levels.push(L); B.lv[1] = world.levels.length - 1;
  const index = new WorldIndex(world), people = generatePopulation(world, index, { population: 400, roster: [] });
  reassign(world, index, people, new RNG(`${seed}:boot`));
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0; sim.now = () => T; sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 5 * 3600, dayScale: 16 }; sim.start();
  const brain = sim.brain, it = L.items.find(i => i.t === 'air_hockey' || i.t === 'foosball');
  assert.ok(it, 'the arcade has a table');
  const e = index.entry(B.idx, 1, it.id), w0 = toWorld(B, e.slots[0].lx, e.slots[0].lz), spots = [];
  setPlayerSpots(() => spots);
  try {
    const a = sim.agents.find(x => x && x.plan && !x.p.retired && !x.p.post);
    assert.ok(brain.reserve(a, B.idx, 1, it.id, 1, [T + 10, T + 400]), 'the far end: reserved');
    const before = a.plan;
    spots.push({ x: w0.x, z: w0.z, ctx: ctxOf(B.idx, 1) });
    assert.ok(brain.taken(B.idx, 1, it.id, 1, -1), 'a player at the near end: the far end is taken too');
    assert.ok(brain.playerTook(w0.x, w0.z, ctxOf(B.idx, 1)) >= 1 && a.plan !== before, 'the one bound for the far end is turned round');
    spots.length = 0;
    assert.equal(brain.taken(B.idx, 1, it.id, 1, -1), false, 'the player gone: free');
  } finally { setPlayerSpots(null); }
});

test('batch 4: pool against the computer is won by aiming well, its balls stay on the cloth or drop; bowling scores as bowling does and the pocket is where the strikes are; the dance machine judges steps by their timing', () => {
  // pool: a player who aims by the ghost ball (the angle sent exactly) and strikes as hard as the shot needs
  const R = POOL.ballR;
  const want = s => {
    const c = s.balls[0], g = s.group, mine = s.balls.filter(b => !b.in && b.n && (g ? (POOLG.left(s, g) ? POOLG.groupOf(b.n) === g : b.n === 8) : b.n !== 8));
    let best = null;
    for (const t of mine) for (const [px, pz] of POOL.pockets) {
      let ux = px - t.x, uz = pz - t.z; const d2 = Math.hypot(ux, uz); ux /= d2; uz /= d2;
      const gx = t.x - ux * 2 * R, gz = t.z - uz * 2 * R; let vx = gx - c.x, vz = gz - c.z; const d1 = Math.hypot(vx, vz); vx /= d1; vz /= d1;
      const cos = vx * ux + vz * uz; if (cos < 0.4) continue;
      const val = (cos * cos) / (0.3 + d1 + d2 * 1.5); if (!best || val > best.val) best = { val, dx: gx - c.x, dz: gz - c.z, d: d1 + d2 / (cos * cos) };
    }
    if (!best) { const t = mine[0] || s.balls.find(b => !b.in && b.n); return { dx: t.x - c.x, dz: t.z - c.z, d: 1 }; }
    return best;
  };
  let won = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const s = POOLG.init(seed); let t = 0, w = null;
    while (!POOLG.over(s) && t < 60 * 60 * 15) {
      let v = inputValue(0);
      if (s.ph !== 'aim') w = null;
      else {
        if (!w) { w = want(s); w.t = 0; w.pw = s.shots === 0 ? 0.95 : Math.min(0.85, Math.max(0.12, (Math.sqrt(w.d) * 0.034 + 0.004 - 0.008) / 0.092)); }
        const [px, py] = POOLG.toPx(w.dx, w.dz); w.t++;
        v = inputValue(w.t > 8 && (s.chg < 0 || (s.pw < w.pw - 0.02 && s.chg < 60)) ? BTN.A : 0, px, py, 1);
      }
      s.ev.length = 0; POOLG.step(s, inputBits(v)); t++;
      for (const b of s.balls) assert.ok(b.in || (Math.abs(b.x) <= POOL.hw + 0.08 && Math.abs(b.z) <= POOL.hl + 0.08), `ball ${b.n} on the table`);
    }
    assert.ok(POOLG.over(s), `seed ${seed}: the game ends`);
    if (s.win) won++;
  }
  assert.ok(won >= 3, `aiming well beats the computer (${won} of 6)`);
  const idle = POOLG.init(3); let it = 0; while (!POOLG.over(idle) && it < 60 * 60 * 6) { idle.ev.length = 0; POOLG.step(idle, inputBits(inputValue(0))); it++; }
  assert.ok(idle.over && !idle.win && it < 60 * 90, `idle: three shots let run out and the game is the computer's (${(it / 60).toFixed(0)} s)`);
  // bowling: the scoring
  const tot = rolls => BOWLG.total({ rolls });
  assert.equal(tot(Array(12).fill(10)), 300, 'a perfect game');
  assert.equal(tot(Array(21).fill(5)), 150, 'all spares, fives');
  assert.equal(tot([10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1]), 167, 'a mixed game');
  // … the pins: into the pocket at an angle strikes most, straight at the head pin less, off the middle never (since
  // 2026-10-26 a strike is rarer: harder pins, a skid on a hard throw; the sway is the next test's)
  const shot = (seed, x0, tx, pw) => { const s = BOWLG.init(seed); s.x0 = x0; s.tx = tx; s.chg = 5; s.pw = pw; s.prev = BTN.A; BOWLG.step(s, inputBits(inputValue(0))); let t = 0; while (s.ph === 'roll' && t < 1000) { s.ev.length = 0; BOWLG.step(s, inputBits(inputValue(0))); t++; } return s.rolls[0]; };
  const strikes = (x0, tx, pw) => { let n = 0; for (let seed = 1; seed <= 30; seed++) if (shot(seed, x0, tx + ((seed % 7) - 3) * 0.004, pw) === 10) n++; return n; };
  const pocket = strikes(0.18, 0.035, 0.75), head = strikes(0, 0, 0.55), off = strikes(0, 0.09, 0.55);
  assert.ok(pocket >= 5 && pocket > head && head >= off && off <= 2, `strikes in 30: the pocket ${pocket}, the head pin ${head}, off the middle ${off}`);
  for (let seed = 1; seed <= 6; seed++) assert.ok(shot(seed, 0, 0.42, 0.5) === 0, 'a ball rolled at the edge goes into the gutter');
  // the dance machine: steps right on time are PERFECT all through (a full combo); a little off, GREAT; none, the song stops
  const KEYS = [BTN.L, BTN.D, BTN.U, BTN.R];
  const dance = (seed, off) => {
    const s = DANCEG.init(seed), plan = new Map();
    if (off !== null) for (const n of s.notes) plan.set(n.t + off, (plan.get(n.t + off) || 0) | KEYS[n.c]);
    let t = 0; while (!DANCEG.over(s) && t < 60 * 60 * 3) { s.ev.length = 0; DANCEG.step(s, inputBits(inputValue(plan.get(s.t + 1) || 0))); t++; }
    return s;
  };
  const p = dance(4, 0); assert.ok(p.full && p.judged.perfect === p.total && p.judged.miss === 0 && !p.failed, `on time: a full combo (${p.score})`);
  const g = dance(4, 4); assert.ok(g.judged.great === g.total && g.score < p.score, 'four steps late: GREAT each');
  const none = dance(4, null); assert.ok(none.failed && none.over && none.t < DANCEG.END / 4, 'standing still: the song stops early');
  assert.ok(p.total >= 120, `a full song of steps (${p.total})`);
});

test('bowling takes a steady hand (2026-10-26, "way too easy"): the aim sways about the mark while the power builds, more the harder; let go without watching it and a game scores as a casual bowler does', () => {
  const s = BOWLG.init(7), px = BOWLG.toPx(0.03);
  for (let i = 0; i < 10; i++) BOWLG.step(s, { b: 0, pd: true, px });
  assert.ok(Math.abs(s.tx - s.aim) < 1e-9, 'no sway before the power builds');
  let lo = 0, hi = 0;
  for (let i = 0; i < 49; i++) { BOWLG.step(s, { b: BTN.A, pd: true, px }); const d = Math.abs(s.tx - s.aim); if (s.pw < 0.3) lo = Math.max(lo, d); if (s.pw > 0.8) hi = Math.max(hi, d); }
  assert.ok(hi > 0.09 && lo < hi * 0.7, `the sway: ${lo.toFixed(3)} m at low power, ${hi.toFixed(3)} m at high`);
  // whole games: aimed at the pocket (or the middle of what stands), let go at full power whenever the sway happens to be
  let total = 0, strikes = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = BOWLG.init(seed); let guard = 0;
    while (!g.over && guard++ < 60) {
      while (!g.over && g.ph !== 'aim') { g.ev.length = 0; BOWLG.step(g, { b: 0, pd: false, px: 128 }); }
      if (g.over) break;
      const up = g.pins.filter(p => p.up && !p.out), at = up.length && up.length < 10 ? up.reduce((a, p) => a + p.x, 0) / up.length : 0.03;
      const hold = 44 + ((seed * 7 + guard * 3) % 11);
      for (let i = 0; i < 20; i++) { g.ev.length = 0; BOWLG.step(g, { b: 0, pd: true, px: BOWLG.toPx(at) }); }
      for (let i = 0; i < hold; i++) { g.ev.length = 0; BOWLG.step(g, { b: BTN.A, pd: true, px: BOWLG.toPx(at) }); }
      g.ev.length = 0; BOWLG.step(g, { b: 0, pd: true, px: BOWLG.toPx(at) });
    }
    assert.ok(g.over, 'the game ends'); total += BOWLG.score(g); strikes += g.strikes;
  }
  assert.ok(total / 12 < 175 && strikes / 12 < 4, `a casual game: ${(total / 12).toFixed(0)} on average, ${(strikes / 12).toFixed(1)} strikes (was about 240 and 8)`);
});

test('a machine a player\'s game is open on is all theirs, wherever they are (2026-10-26: agents walked up and played at a pool table a player was playing)', { timeout: 120000 }, () => {
  const seed = 'player-hold', world = generateWorld({ seed, population: 400 });
  const B = world.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  const L = freshLevel(B, 1, 1, 'arcade'); world.levels.push(L); B.lv[1] = world.levels.length - 1;
  const index = new WorldIndex(world), people = generatePopulation(world, index, { population: 400, roster: [] });
  reassign(world, index, people, new RNG(`${seed}:boot`));
  const sim = new Sim(world, people, { budgetMs: 1e9 });
  let T = 0; sim.now = () => T; sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 5 * 3600, dayScale: 16 }; sim.start();
  const brain = sim.brain, it = L.items.find(i => i.t === 'pool_table') || L.items.find(i => i.t === 'air_hockey');
  assert.ok(it, 'the arcade has a pool table');
  const e = index.entry(B.idx, 1, it.id), [a, c] = sim.agents.filter(x => x && x.plan && !x.p.retired && !x.p.post);
  assert.ok(brain.reserve(a, B.idx, 1, it.id, 0, [T, T + 400]), 'one is at the table');
  assert.ok(brain.reserve(c, B.idx, 1, it.id, e.slots.length - 1, [T + 20, T + 400]), 'another on the way to its other end');
  const before = [a.plan, c.plan];
  // the player is nowhere near it (looking in from above): their game holds it all the same
  assert.equal(brain.holdPiece(B.idx, 1, it.id, 60000), 2, 'both sent elsewhere');
  assert.ok(a.plan !== before[0] && c.plan !== before[1], 'their plans were cut');
  for (let k = 0; k < e.slots.length; k++) assert.ok(brain.taken(B.idx, 1, it.id, k, -1), `spot ${k}: nobody else's`);
  assert.equal(brain.reserve(c, B.idx, 1, it.id, 0, [T + 5, T + 100]), false, 'and nobody can book it');
  brain.releasePiece(B.idx, 1, it.id);
  assert.equal(brain.taken(B.idx, 1, it.id, 0, -1), false, 'let go: free again');
  brain.holdPiece(B.idx, 1, it.id, -1);
  assert.equal(brain.pieceHeld(B.idx, 1, it.id), false, 'a hold that ran out holds nothing');
});
