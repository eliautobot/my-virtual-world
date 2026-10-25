// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade (docs/features/arcade.md): the shared core (dice, angles, the input log), the built-in games' sims played by
// bots and by random hands (they never break, they always end, the same steps give the same game), and the play module:
// a run's score is the server's own replay, never the browser's word.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BTN, InputLog, decodeLog, replay, inputValue, inputBits, makeRng, SIN, COS, FX } from '../shared/arcade/core.js';
import * as BD from '../shared/arcade/games/block-drop.js';
import * as SS from '../shared/arcade/games/star-siege.js';
import * as NS from '../shared/arcade/games/neon-snake.js';
import * as BB from '../shared/arcade/games/brick-blitz.js';
import * as RD from '../shared/arcade/games/rock-drift.js';
import * as RH from '../shared/arcade/games/road-hopper.js';
import * as FD from '../shared/arcade/games/flap-dash.js';
import * as MD from '../shared/arcade/games/maze-dash.js';
import * as CS from '../shared/arcade/games/city-shield.js';
import * as TR from '../shared/arcade/games/turbo-rush.js';
import { SIMS } from '../shared/arcade/sims.js';
import { GAMES } from '../shared/arcade/catalog.js';
import { playOf } from '../shared/play.js';
import { openDb } from '../server/db.js';
import { PlayCore } from '../server/play/play.js';
import { tempDir } from './helpers/server.mjs';

// ------------------------------------------------------------------------------------------- bots
/** Plays sim from seed with brain(s) → input value each step, recording; → { s, log, ticks }. */
function play(sim, seed, brain, max = 200000) {
  const s = sim.init(seed), log = new InputLog();
  let t = 0;
  while (!sim.over(s) && t < max) { const v = brain(s, t); log.push(v); s.ev.length = 0; sim.step(s, inputBits(v)); t++; }
  return { s, log: log.encode(), ticks: t };
}
/** A Block Drop bot: for each new piece, the turn and column that leave the lowest, fullest well; then taps there. */
function blockBot(skill = 1) {
  let plan = null, piece = null, q = [];
  const evalPlace = (s, k, r, x) => {
    if (!BD.fits(s, k, r, x, 0)) return null;
    let y = 0; while (BD.fits(s, k, r, x, y + 1)) y++;
    const g = s.grid.slice();
    for (const [cx, cy] of BD.PIECES[k].rots[r]) g[(y + cy) * BD.COLS + x + cx] = 1;
    let lines = 0, holes = 0, agg = 0, bump = 0, prevH = -1;
    for (let yy = 0; yy < BD.ROWS; yy++) { let full = true; for (let xx = 0; xx < BD.COLS; xx++) if (!g[yy * BD.COLS + xx]) full = false; if (full) lines++; }
    for (let xx = 0; xx < BD.COLS; xx++) {
      let h = 0, seen = false;
      for (let yy = 0; yy < BD.ROWS; yy++) { if (g[yy * BD.COLS + xx]) { if (!seen) { h = BD.ROWS - yy; seen = true; } } else if (seen) holes++; }
      agg += h; if (prevH >= 0) bump += Math.abs(h - prevH); prevH = h;
    }
    return -0.51 * agg + 0.76 * lines - 0.36 * holes * skill - 0.18 * bump;
  };
  return s => {
    if (!s.cur) { q = []; return 0; }
    if (s.cur !== piece) {
      piece = s.cur; plan = null; let best = -Infinity;
      for (let r = 0; r < 4; r++) for (let x = -2; x < BD.COLS; x++) { const v = evalPlace(s, s.cur.k, r, x); if (v !== null && v > best) { best = v; plan = { r, x }; } }
      q = [];
      if (plan) {
        for (let k = 0; k < plan.r; k++) q.push(BTN.A, 0);
        const dx = plan.x - s.cur.x;   // (an approximation: a kick may shift it; the bot just aims)
        for (let k = 0; k < Math.abs(dx); k++) q.push(dx < 0 ? BTN.L : BTN.R, 0);
        q.push(BTN.U, 0);
      }
    }
    return q.length ? q.shift() : 0;
  };
}
/** A Star Siege bot: under the nearest drone, firing all the time. */
const siegeBot = s => {
  let tx = s.px, bd = 1e9;
  for (let k = 0; k < s.alive.length; k++) if (s.alive[k]) { const [ax] = SS.alienAt(s, k); const d = Math.abs(ax + SS.AW / 2 - s.px); if (d < bd) { bd = d; tx = ax + SS.AW / 2; } }
  return BTN.A | (tx < s.px - 2 ? BTN.L : tx > s.px + 2 ? BTN.R : 0);
};
/** A Neon Snake bot: toward the orb by the shortest safe step (no look-ahead: it gets itself boxed in sooner or later). */
const snakeBot = () => {
  let last = -1;
  return s => {
    if (s.moveT !== NS.speedAt(s.level) - 1 || s.queue.length) return 0;
    const [hx, hy] = s.body[0], goal = s.bonus || s.food, blocked = new Set(s.body.slice(0, -1).map(([x, y]) => y * NS.COLS + x).concat(s.pillars));
    let best = -1, bd = Infinity;
    for (let d = 0; d < 4; d++) {
      if (d === (s.dir + 2) % 4) continue;
      const nx = hx + NS.DIRS[d][0], ny = hy + NS.DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= NS.COLS || ny >= NS.ROWS || blocked.has(ny * NS.COLS + nx)) continue;
      const dist = goal ? Math.abs(goal.x - nx) + Math.abs(goal.y - ny) : 0;
      if (dist < bd) { bd = dist; best = d; }
    }
    if (best < 0 || best === s.dir) { last = -1; return 0; }
    if (best === last) { last = -1; return 0; }
    last = best;
    return [BTN.U, BTN.R, BTN.D, BTN.L][best];
  };
};
/** A Brick Blitz bot: the pointer under the lowest falling ball; launches when the ball sits on the paddle. */
const brickBot = (good = true) => { let k = 0; return s => {
  k++;
  if (s.balls.some(b => b.stuck)) return k % 2 ? BTN.A : 0;
  if (!good) return 0;
  const ball = s.balls.filter(b => b.vy > 0).sort((a, b) => b.y - a.y)[0] || s.balls[0];
  return inputValue(0, Math.round(((ball.x - BB.WALL_L) / (BB.WALL_R - BB.WALL_L)) * 255), 0, 1);
}; };
/** A Rock Drift bot: turns toward the nearest rock and fires. */
const rockBot = s => {
  let best = null, bd = Infinity;
  for (const r of s.rocks) { const [dx, dy] = RD.delta(s.x, s.y, r.x, r.y), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [dx, dy]; } }
  if (!best) return 0;
  const want = Math.round((Math.atan2(best[0], -best[1]) / (2 * Math.PI)) * 1024) & 1023, diff = ((want - s.ang + 1536) & 1023) - 512;
  return BTN.A | (diff < -10 ? BTN.L : diff > 10 ? BTN.R : 0);
};
/** A Road Hopper bot: hops up when where it lands is safe a moment later, else waits (or steps aside to a portal). */
const hopBot = () => { let wait = 0; return s => {
  if (s.dead || s.hop || s.nextT) return 0;
  if (wait) { wait--; return 0; }
  const r = s.row - 1, x = s.x;
  const safeAt = (row, px) => {
    if (row === 0) { const i = RH.PORTALS.findIndex(c => Math.abs(RH.colX(c) - px) <= 13); return i >= 0 && !s.filled[i]; }
    const L = s.lanes[row]; if (!L) return true;
    const later = o => o.x + L.dir * L.v * 9;
    if (RH.ROAD.includes(row)) return !L.objs.some(o => px + 16 > later(o) && px - 16 < later(o) + o.len);
    return L.objs.some(o => px >= later(o) + 10 && px <= later(o) + o.len - 10 && RH.afloat(s, o));
  };
  if (s.row === 1) {   // line up under a free portal
    const i = RH.PORTALS.map((c, k) => k).filter(k => !s.filled[k]).sort((a, b) => Math.abs(RH.colX(RH.PORTALS[a]) - x) - Math.abs(RH.colX(RH.PORTALS[b]) - x))[0];
    const tx = RH.colX(RH.PORTALS[i]);
    if (Math.abs(tx - x) <= 12) { wait = 2; return BTN.U; }
    wait = 2; return tx < x ? BTN.L : BTN.R;
  }
  if (safeAt(r, x)) { wait = 2; return BTN.U; }
  return 0;
}; };
/** A Flap Dash bot: flaps when below the next gap's middle and not already rising fast. */
const flapBot = (skill = 1) => { let gap = 0; return s => {
  if (gap) { gap--; return 0; }
  if (!s.started) { gap = 2; return BTN.A; }
  const p = s.pylons.find(q => q.x + FD.PYLON_W > FD.BIRD_X - FD.BIRD_R);
  const target = p ? FD.gapY(s, p) + 8 : 240;
  if (skill > 0 && s.y > target && s.vy > -1) { gap = 2; return BTN.A; }
  return 0;
}; };
/** A Maze Dash bot: the shortest way to the nearest spark, turning away from a drone that is close. */
const mazeBot = () => { let last = -1; return s => {
  const z = s.zip, open = (c, r) => { const ch = (r >= 0 && r < MD.ROWS) ? (c < 0 || c >= MD.COLS ? (r === MD.TUNNEL ? ' ' : '#') : MD.MAZE[r][c]) : '#'; return ch !== '#' && ch !== '-' && ch !== 'H'; };
  const danger = new Set(s.drones.filter(d => d.state === 'active' && !d.scared).map(d => `${d.c},${d.r}`));
  // breadth first from Zip's cell
  const seen = new Map([[`${z.c},${z.r}`, -1]]), q = [[z.c, z.r, -1]];
  let goal = null;
  while (q.length && !goal) {
    const [c, r, first] = q.shift();
    for (let d = 0; d < 4; d++) {
      const nc = (c + MD.DX[d] + MD.COLS) % MD.COLS, nr = r + MD.DY[d], key = `${nc},${nr}`;
      if (seen.has(key) || !open(nc, nr) || danger.has(key)) continue;
      const f = first < 0 ? d : first; seen.set(key, f); q.push([nc, nr, f]);
      if (s.dots[nr * MD.COLS + nc]) { goal = f; break; }
    }
  }
  const want = goal ?? z.dir;
  if (want === last) { last = -1; return 0; }
  last = want;
  return [BTN.U, BTN.R, BTN.D, BTN.L][want];
}; };
/** A City Shield bot: aims at the lowest missile ahead of where it will be, fires every 18 steps. */
const shieldBot = (good = true) => { let cool = 0; return s => {
  if (!good) return 0;
  if (cool) { cool--; return inputValue(0, Math.round((s.cross.x / CS.W) * 255), Math.round((s.cross.y / CS.H) * 255), 1); }
  const m = [...s.missiles].sort((a, b) => b.y - a.y)[0];
  if (!m) return 0;
  // where it will be when the interceptor gets there and its blast has grown
  const base = CS.LAUNCHERS.map((x, i) => [x, i]).filter(([, i]) => s.launchers[i].alive && s.launchers[i].ammo).sort((a, b) => Math.abs(a[0] - m.x) - Math.abs(b[0] - m.x))[0];
  if (!base) return 0;
  let tx = m.x, ty = m.y;
  for (let k = 0; k < 3; k++) { const T = Math.hypot(tx - base[0], ty - (CS.GROUND - 14)) / (base[1] === 1 ? 7.5 : 5.5) + 10; tx = m.x + m.vx * T; ty = Math.min(CS.GROUND - 40, m.y + m.vy * T); }
  cool = 18;
  return inputValue(BTN.A, Math.round((tx / CS.W) * 255), Math.round((ty / CS.H) * 255), 1);
}; };
/** A Turbo Rush bot: into whichever of our lanes is clearest ahead, boosting when the meter is full enough. */
const rushBot = s => {
  const ahead = l => Math.min(...[...s.traffic, ...s.rivals].filter(t => Math.abs(t.x - TR.LANES[l]) < 1.8 && t.z > s.z - 6).map(t => t.z - s.z), 400);
  const lane = [2, 3].sort((a, b) => ahead(b) - ahead(a))[0], tx = TR.LANES[lane];
  const steer = tx < s.x - 0.25 ? BTN.L : tx > s.x + 0.25 ? BTN.R : 0;
  return steer | (s.boost > 60 && ahead(lane) > 140 ? BTN.A : 0);
};
const randomHands = seed => { const r = makeRng(seed); let v = 0; return () => { if ((r() & 7) === 0) v = r() & 63; return v; }; };

// ------------------------------------------------------------------------------------------- tests
test('the core: the input log codes runs and back, the dice repeat, the angle table is the real one', () => {
  const r = makeRng(7), log = new InputLog(), want = [];
  for (let k = 0; k < 3000; k++) { const v = k % 50 < 20 ? inputValue(r() & 63, r() & 255, r() & 255, r() & 1) : 0; log.push(v); want.push(v); }
  const { runs, ticks } = decodeLog(log.encode());
  assert.equal(ticks, 3000);
  assert.deepEqual(runs.flatMap(([v, n]) => Array(n).fill(v)), want);
  assert.throws(() => decodeLog('***'), /bad log/);
  const a = makeRng(42), b = makeRng(42);
  for (let k = 0; k < 100; k++) assert.equal(a(), b());
  assert.equal(SIN[0], 0); assert.equal(SIN[256], FX); assert.equal(COS[0], FX); assert.equal(SIN[768], -FX);
  for (let k = 0; k < 1024; k += 7) assert.ok(Math.abs(SIN[k] - Math.round(Math.sin((k / 1024) * 2 * Math.PI) * FX)) <= 1, `sin ${k}`);
});

test('the library: every built-in game has a sim, controls, stars that rise, and is a course of the arcade module', () => {
  const m = playOf('arcade');
  assert.ok(m, 'the arcade is a play module');
  assert.equal(m.score.better, 'higher');
  for (const g of GAMES.filter(x => x.kind === 'builtin')) {
    assert.ok(SIMS[g.id], `${g.id} has a sim`);
    for (const f of ['init', 'step', 'over', 'score']) assert.equal(typeof SIMS[g.id][f], 'function', `${g.id}.${f}`);
    assert.ok(g.stars[0] < g.stars[1] && g.stars[1] < g.stars[2], `${g.id}: stars rise`);
    assert.ok(['dpad', 'lr', 'tap'].includes(g.controls.layout), `${g.id}: a controller layout`);
    assert.ok(g.keysHint && g.blurb && g.color && g.accent, `${g.id}: its words and colours`);
    assert.ok(m.courses.find(c => c.id === g.id), `${g.id} is a course`);
  }
});

test('Block Drop: a bot clears rows, levels go up, five-block pieces join, the game ends, and a replay is the same game', () => {
  const R = play(BD, 12345, blockBot(), 120000);
  assert.ok(R.s.lines >= 10, `lines ${R.s.lines}`);
  assert.ok(R.s.level >= 2 && R.s.score > 1000, `level ${R.s.level} score ${R.s.score}`);
  const again = replay(BD, 12345, R.log);
  assert.equal(again.ticks, R.ticks); assert.equal(BD.score(again.state), R.s.score); assert.equal(again.state.lines, R.s.lines);
  // a weak bot tops out: the game ends
  const W = play(BD, 99, blockBot(-3), 200000);
  assert.ok(BD.over(W.s), 'the well fills and the game ends');
  // every piece of the set turns in place and fits its box
  for (const p of BD.PIECES) for (const r of p.rots) for (const [x, y] of r) assert.ok(x >= 0 && y >= 0 && x < p.n && y < p.n, `${p.name}`);
  // pieces of five only from level 3
  const s = BD.init(5);
  assert.ok(![...s.bag, ...s.next, s.cur.k].some(k => BD.PIECES[k].size === 5), 'no five at level 1');
});

test('Star Siege: a bot shoots drones and saucers, waves go on, the game ends, and a replay is the same game', () => {
  const R = play(SS, 777, siegeBot, 200000);
  assert.ok(SS.over(R.s), 'the game ends');
  assert.ok(R.s.kills >= 20 && R.s.score > 300, `kills ${R.s.kills} score ${R.s.score}`);
  const again = replay(SS, 777, R.log);
  assert.equal(again.ticks, R.ticks); assert.equal(SS.score(again.state), R.s.score); assert.equal(again.state.wave, R.s.wave);
  // standing still and not firing: the fleet lands or the bombs win
  const idle = play(SS, 3, () => 0, 200000);
  assert.ok(SS.over(idle.s) && idle.s.kills === 0);
});

test('Neon Snake: a bot eats, the snake grows and speeds up, pillars rise, it ends, and a replay is the same game', () => {
  const R = play(NS, 4242, snakeBot(), 200000);
  assert.ok(NS.over(R.s), 'the game ends');
  assert.ok(R.s.eaten >= 10 && R.s.level >= 3 && R.s.score > 200, `eaten ${R.s.eaten} level ${R.s.level} score ${R.s.score}`);
  assert.ok(R.s.pillars.length >= 2, 'pillars from level 3');
  const again = replay(NS, 4242, R.log);
  assert.equal(again.ticks, R.ticks); assert.equal(NS.score(again.state), R.s.score);
  // never straight back
  const s = NS.init(1); NS.step(s, { b: BTN.L }); assert.deepEqual(s.queue, []);
});

test('Brick Blitz: a tracking bot breaks bricks and clears walls; left alone the balls fall and it ends; a replay is the same', () => {
  const R = play(BB, 99, brickBot(), 60000);
  assert.ok(R.s.broken >= 40, `bricks ${R.s.broken}`);
  assert.ok(R.s.score > 2000, `score ${R.s.score}`);
  const again = replay(BB, 99, R.log, 60000);
  assert.equal(BB.score(again.state), R.s.score); assert.equal(again.state.broken, R.s.broken);
  const lazy = play(BB, 5, brickBot(false), 60000);
  assert.ok(BB.over(lazy.s) && lazy.s.lives === 0, 'three balls lost: over');
});

test('Rock Drift: a bot breaks rocks into smaller ones, waves go on, it ends, and a replay is the same game', () => {
  const R = play(RD, 2024, rockBot, 120000);
  assert.ok(RD.over(R.s), 'the game ends');
  assert.ok(R.s.kills >= 12 && R.s.score > 1000, `kills ${R.s.kills} score ${R.s.score}`);
  const again = replay(RD, 2024, R.log);
  assert.equal(again.ticks, R.ticks); assert.equal(RD.score(again.state), R.s.score);
});

test('Road Hopper: a careful bot crosses into portals; the clock and the traffic end it; a replay is the same game', () => {
  const R = play(RH, 31, hopBot(), 100000);
  assert.ok(RH.over(R.s), 'the game ends');
  assert.ok(R.s.homes >= 1 && R.s.score > 200, `homes ${R.s.homes} score ${R.s.score}`);
  const again = replay(RH, 31, R.log);
  assert.equal(again.ticks, R.ticks); assert.equal(RH.score(again.state), R.s.score);
  // standing still: the clock runs out three times
  const idle = play(RH, 3, () => 0, 20000);
  assert.ok(RH.over(idle.s) && idle.s.score === 0);
});

test('Flap Dash: it waits for the first flap; a bot flies through pylons; doing nothing ends it; a replay is the same', () => {
  const idle = FD.init(1); for (let k = 0; k < 300; k++) FD.step(idle, { b: 0 });
  assert.equal(idle.started, false, 'hovering until the first flap'); assert.equal(idle.over, false);
  const R = play(FD, 77, flapBot(), 30000);
  assert.ok(R.s.passed >= 15, `pylons ${R.s.passed}`);
  const again = replay(FD, 77, R.log, 30000);
  assert.equal(FD.score(again.state), R.s.score); assert.equal(again.state.passed, R.s.passed);
  const drop = play(FD, 2, flapBot(0), 5000);
  assert.ok(FD.over(drop.s) && drop.s.passed === 0, 'one flap and nothing more: down');
});

test('Maze Dash: a bot clears sparks, the drones catch it in the end, and a replay is the same game', () => {
  const R = play(MD, 515, mazeBot(), 150000);
  assert.ok(MD.over(R.s), 'the game ends');
  assert.ok(R.s.score >= 800, `score ${R.s.score} level ${R.s.level}`);
  const again = replay(MD, 515, R.log);
  assert.equal(again.ticks, R.ticks); assert.equal(MD.score(again.state), R.s.score);
  // the maze: every row its width, every open cell reachable from the start
  assert.ok(MD.MAZE.every(r => r.length === MD.COLS) && MD.MAZE.length === MD.ROWS);
  const seen = new Set(['9,15']), q = [[9, 15]];
  while (q.length) { const [c, r] = q.shift(); for (let d = 0; d < 4; d++) { const nc = (c + MD.DX[d] + MD.COLS) % MD.COLS, nr = r + MD.DY[d]; if (nr < 0 || nr >= MD.ROWS) continue; const ch = MD.MAZE[nr][nc]; if ('#-H'.includes(ch) || seen.has(`${nc},${nr}`)) continue; seen.add(`${nc},${nr}`); q.push([nc, nr]); } }
  let sparks = 0, reached = 0;
  MD.MAZE.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '.' || ch === 'o') { sparks++; if (seen.has(`${c},${r}`)) reached++; } }));
  assert.equal(reached, sparks, 'every spark can be reached');
});

test('City Shield: a bot bursts missiles in chains over waves; left alone the cities fall; a replay is the same game', () => {
  const R = play(CS, 808, shieldBot(), 40000);
  assert.ok(R.s.killed >= 20 && R.s.wave >= 2, `killed ${R.s.killed} wave ${R.s.wave}`);
  const again = replay(CS, 808, R.log, 40000);
  assert.equal(CS.score(again.state), R.s.score); assert.equal(again.state.killed, R.s.killed);
  const lazy = play(CS, 9, shieldBot(false), 80000);
  assert.ok(CS.over(lazy.s) && !lazy.s.domes.some(Boolean), 'no defence: every city falls and it ends');
});

test('Turbo Rush: a bot weaves through traffic and past rivals to new stages until the clock runs out; a replay is the same game', () => {
  const R = play(TR, 4040, rushBot, 120000);
  assert.ok(TR.over(R.s), 'the clock runs out and the car rolls to a stop');
  assert.ok(R.s.z >= TR.STAGE_LEN && R.s.checkpoints >= 1, `metres ${Math.round(R.s.z)} checkpoints ${R.s.checkpoints}`);
  assert.ok(R.s.score > 1500, `score ${R.s.score}`);
  const again = replay(TR, 4040, R.log);
  assert.equal(again.ticks, R.ticks); assert.equal(TR.score(again.state), R.s.score);
  // into the oncoming lanes and staying there: crashes, near misses, and it still ends
  const ram = play(TR, 11, s => (s.x > TR.LANES[0] ? BTN.L : 0), 20000);
  assert.ok(TR.over(ram.s));
  // a takedown: boosting into a rival
  const s = TR.init(5); s.startT = 0; s.v = 60; const r = s.rivals[0]; r.z = s.z + 6; r.x = s.x; r.v = 50; s.boost = 50; s.traffic = []; s.spawnZ = 1e9;
  for (let k = 0; k < 30 && !s.takedowns; k++) { s.ev.length = 0; TR.step(s, { b: BTN.A }); }
  assert.equal(s.takedowns, 1, 'boosting into a rival takes it down'); assert.equal(s.boost > 95, true, 'a takedown fills the boost');
  // passing a rival in the next lane is an overtake; a near miss on a car fills the boost and grows the multiplier
  // (we pass two lanes over: out of its reach, so it can't swing at us)
  const o = TR.init(6); o.startT = 0; o.v = 70; o.x = TR.LANES[1]; o.rivals = [{ ...o.rivals[0], x: TR.LANES[3], lane: 3, to: 3, z: o.z + 5, v: 40, want: 40, rb: 0 }]; o.traffic = []; o.spawnZ = 1e9;
  for (let k = 0; k < 90; k++) { o.ev.length = 0; TR.step(o, { b: 0 }); }
  assert.equal(o.overtakes, 1, 'the rival passed');
  const n = TR.init(7); n.startT = 0; n.v = 65; n.x = 3.0; n.rivals = []; n.traffic = [{ id: 99, lane: 3, x: TR.LANES[3], z: n.z + 15, v: 25, w: 1.85, l: 4.6, kind: 'sedan', to: 3, passed: false, slip: 0, color: 0 }]; n.spawnZ = 1e9; n.boost = 10;
  for (let k = 0; k < 60; k++) { n.ev.length = 0; TR.step(n, { b: 0 }); }
  assert.ok(n.near === 1 && n.close === 1 && n.boost > 25 && TR.multOf(n) === 2, `a close call: near ${n.near} close ${n.close} boost ${n.boost} mult ${TR.multOf(n)}`);
  // the car holds its line through a bend (no pull) and steers a lane over quickly
  const b = TR.init(8); b.startT = 0; b.v = 70; b.traffic = []; b.rivals = []; b.spawnZ = 1e9; b.track = [{ z: 0, len: 5000, curve: 0.0025, hill: 0 }];
  const x0 = b.x; for (let k = 0; k < 120; k++) { b.ev.length = 0; TR.step(b, { b: 0 }); }
  assert.ok(Math.abs(b.x - x0) < 0.01, `no pull in a bend: x ${b.x} from ${x0}`);
  let ticks = 0; while (b.x > TR.LANES[1] && ticks < 60) { b.ev.length = 0; TR.step(b, { b: BTN.L }); ticks++; }
  assert.ok(ticks >= 18 && ticks <= 26, `a lane over in ${ticks} steps (about 0.4 s: firm, not a snap)`);
  // a rival on a clear road boosts past our cruising speed
  const v = TR.init(9); v.startT = 0; v.v = 60; v.traffic = []; v.spawnZ = 1e9; v.rivals = [{ ...v.rivals[0], z: v.z + 60, x: TR.LANES[3], lane: 3, to: 3, v: 60, rb: 100 }];
  let topV = 0; for (let k = 0; k < 120; k++) { v.ev.length = 0; TR.step(v, { b: 0 }); topV = Math.max(topV, v.rivals[0]?.v || 0); }
  assert.ok(topV > 85, `rivals boost too: top ${topV.toFixed(1)} m/s`);
  // alongside us on a clear road a rival warns, swings and slams us off our line; boosting, we take it down instead
  const sl = TR.init(10); sl.startT = 0; sl.v = 60; sl.x = TR.LANES[2]; sl.traffic = []; sl.spawnZ = 1e9; sl.rivals = [{ ...sl.rivals[0], z: sl.z + 1, x: TR.LANES[3], lane: 3, to: 3, v: 60, want: 60, rb: 0 }];
  const seen = new Set(); for (let k = 0; k < 600 && !seen.has('slammed'); k++) { sl.ev.length = 0; TR.step(sl, { b: 0 }); for (const e of sl.ev) seen.add(e.k); }
  assert.ok(seen.has('lunge') && seen.has('slammed') && sl.shoved > 0, `a slam: ${[...seen]}`);
  const tk = TR.init(10); tk.startT = 0; tk.v = 60; tk.x = TR.LANES[2]; tk.traffic = []; tk.spawnZ = 1e9; tk.boost = 100; tk.rivals = [{ ...tk.rivals[0], z: tk.z + 1, x: TR.LANES[3], lane: 3, to: 3, v: 60, want: 60, rb: 0 }];
  let lunged = false; for (let k = 0; k < 600 && !tk.takedowns; k++) { tk.ev.length = 0; TR.step(tk, { b: lunged ? BTN.A : 0 }); if (tk.ev.some(e => e.k === 'lunge')) lunged = true; if (lunged && tk.rivals[0]) tk.rivals[0].v = tk.v; }
  assert.equal(tk.takedowns, 1, 'a rival that swings into us while we boost goes down');
  // the checkpoint tells our place among the stage's rivals
  const cp = TR.init(11); cp.startT = 0; cp.v = 70; cp.traffic = []; cp.spawnZ = 1e9; cp.z = TR.STAGE_LEN - 5; cp.rivals.forEach(r => { r.z = cp.z + 200; });
  let ev = null; for (let k = 0; k < 30 && !ev; k++) { cp.ev.length = 0; TR.step(cp, { b: 0 }); ev = cp.ev.find(e => e.k === 'checkpoint'); }
  assert.ok(ev && ev.place === 4, `three rivals ahead: 4th (${ev?.place})`);
});

test('random hands never break a game, and the same hands always make the same game', () => {
  for (const [id, sim] of Object.entries(SIMS)) {
    for (const seed of [1, 2, 3]) {
      const R = play(sim, seed * 1000 + 17, randomHands(seed), 40000);
      const again = replay(sim, seed * 1000 + 17, R.log);
      assert.equal(again.ticks, R.ticks, `${id} ${seed}`);
      assert.equal(sim.score(again.state), sim.score(R.s), `${id} ${seed}`);
      assert.deepEqual(again.state.rs, R.s.rs, `${id} ${seed}: the dice are where they were`);
    }
  }
});

test('the play module: the server seeds a run, plays the report again and records its own score; bad runs do not count', () => {
  const dir = tempDir('mvw-arcade-'), dbs = openDb(dir), now = { t: 1_800_000_000_000 };
  const t0 = Date.now(), id = Number(dbs.db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
    VALUES (?, 'ann', 'Ann', 'ann', 'member', 'x', ?, ?, ?)`).run(dbs.worldId, t0, t0, t0).lastInsertRowid);
  const acc = { id }, P = new PlayCore({ dbs, now: () => now.t });
  const run = (brain, max, clock = 1) => {
    const st = P.start(acc, 'arcade', 'block-drop');
    assert.ok(Number.isSafeInteger(st.data.seed));
    const R = play(BD, st.data.seed, brain, max);
    now.t += Math.round((R.ticks * 1000) / 60 * clock) + 1600;
    return { st, R };
  };
  // a real game: recorded with the server's score
  const a = run(blockBot(-3), 200000);
  const ok = P.finish(acc, a.st.run, { log: a.R.log, score: 999999999, ticks: a.R.ticks });
  assert.equal(ok.ok, true, ok.why);
  assert.equal(ok.score, a.R.s.score, 'the score is the replay\'s, not the claim');
  assert.ok(ok.xp > 0);
  const board = P.leaderboard('arcade', 'block-drop', {});
  assert.equal(board.rows[0].score, a.R.s.score);
  // a game that had not ended
  const b = P.start(acc, 'arcade', 'block-drop'); now.t += 5000;
  const L = new InputLog(); for (let k = 0; k < 120; k++) L.push(0);
  assert.equal(P.finish(acc, b.run, { log: L.encode() }).ok, false);
  now.t += 2000;
  // quicker than the clock
  const c = run(() => 0, 400000, 0.2);   // (left alone: pieces fall row by row, a game of minutes)
  const fast = P.finish(acc, c.st.run, { log: c.R.log });
  assert.equal(fast.ok, false); assert.match(fast.why, /quicker than the clock/);
  now.t += 2000;
  // a broken log
  const d = P.start(acc, 'arcade', 'star-siege'); now.t += 3000;
  assert.equal(P.finish(acc, d.run, { log: '!!' }).ok, false);
  dbs.close?.();
});
