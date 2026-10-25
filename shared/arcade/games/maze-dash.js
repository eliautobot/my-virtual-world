// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Maze Dash (docs/features/arcade.md): our own maze chase. Zip, a little glowing bot, collects every spark in the maze
// while four drones hunt it, each its own way: the Hunter goes straight for Zip, the Ambusher heads to where Zip is
// going, the Flanker closes in from the side the Hunter isn't on, the Drifter comes close and then wanders off. Now and
// then they all fall back to their corners. A power core turns them blue for a while: Zip can catch them then (200,
// 400, 800, 1600). A bonus chip appears twice a level. Clear the maze for the next level: faster drones, shorter power.
// The tunnel at the sides wraps round. Controls: ▲ ▼ ◀ ▶ (a turn waits for its corner). The sim (rules only; the
// screen is client/arcade/games/maze-dash.js): deterministic, see shared/arcade/core.js.
import { BTN, baseState, roll } from '../core.js';

// our own maze: '#' wall, '.' spark, 'o' power core, '-' the drones' door, 'H' their home, ' ' open
export const MAZE = [
  '###################',
  '#........#........#',
  '#o##.###.#.###.##o#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.### # ###.####',
  '   #.#       #.#   ',
  '####.# ##-## #.####',
  '    .  #HHH#  .    ',
  '####.# ##### #.####',
  '   #.#       #.#   ',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#...........#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
];
export const COLS = 19, ROWS = 21, CELL = 18, TUNNEL = 9;
export const DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0];
const START = [9, 15], DOOR_OUT = [9, 7], HOMES = [[9, 7], [9, 9], [8, 9], [10, 9]], CORNERS = [[17, -2], [1, -2], [18, 22], [0, 22]];
const RELEASE = [0, 90, 330, 600];
const MODES = [420, 1200, 420, 1200, 300, 1200, 300];   // scatter, chase, scatter… (then chase for good)
const at = (c, r) => (r < 0 || r >= ROWS ? '#' : c < 0 || c >= COLS ? (r === TUNNEL ? ' ' : '#') : MAZE[r][c]);
const wrapC = c => (c < 0 ? c + COLS : c >= COLS ? c - COLS : c);
/** Whether who ('zip', or a drone with its state) may go into cell (c, r). */
function open(c, r, who) {
  const ch = at(c, r);
  if (ch === '#') return false;
  if (ch === '-' || ch === 'H') return who === 'eyes';
  return true;
}
/** An entity's position in maze pixels. */
export const posOf = e => [wrapPx((e.c + DX[e.dir] * (e.off / CELL)) * CELL + CELL / 2), (e.r + DY[e.dir] * (e.off / CELL)) * CELL + CELL / 2];
const wrapPx = x => (x < -CELL / 2 ? x + COLS * CELL : x > COLS * CELL - CELL / 2 ? x - COLS * CELL : x);

function sparks() {
  const d = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) d[r * COLS + c] = MAZE[r][c] === '.' ? 1 : MAZE[r][c] === 'o' ? 2 : 0;
  d[START[1] * COLS + START[0]] = 0;
  return d;
}
function place(s) {
  s.zip = { c: START[0], r: START[1], dir: 3, off: 0, want: 3, stopped: false };
  s.drones = HOMES.map(([c, r], k) => ({ k, c, r, dir: k === 0 ? 3 : 0, off: 0, state: k === 0 ? 'active' : 'home', release: s.levelT + RELEASE[k], path: null, scared: 0 }));
  s.readyT = 100; s.power = 0; s.chain = 0; s.mode = 0; s.modeT = 0;
}
export function init(seed) {
  const s = { ...baseState(seed), level: 1, lives: 3, score: 0, extraAt: 10000, dots: sparks(), left: 0, eatenDots: 0, chip: null, levelT: 0,
    prev: 0, over: false, deadT: 0, clearT: 0, caught: 0 };
  s.left = s.dots.reduce((a, v) => a + (v ? 1 : 0), 0);
  place(s);
  return s;
}
const zipSpeed = s => Math.min(1.75, 1.5 + (s.level - 1) * 0.05);
const droneSpeed = s => Math.min(1.7, 1.35 + (s.level - 1) * 0.07);
export const powerTicks = s => Math.max(110, 480 - (s.level - 1) * 60);
function addScore(s, n) { s.score += n; while (s.score >= s.extraAt) { if (s.lives < 5) { s.lives++; s.ev.push({ k: 'life' }); } s.extraAt += 10000; } }
function reverse(e) { if (e.off > 0) { e.c = wrapC(e.c + DX[e.dir]); e.r += DY[e.dir]; e.off = CELL - e.off; } e.dir = (e.dir + 2) % 4; }

/** Moves entity e up to `speed` px along the maze; at each cell's middle `decide(e)` picks the way (or -1 to stop). */
function advance(e, speed, decide, who, arrive) {
  let rem = speed, guard = 0;
  while (rem > 1e-9 && guard++ < 8) {
    if (e.off === 0) {
      const d = decide(e);
      if (d < 0) return;
      e.dir = d;
      if (!open(e.c + DX[d], e.r + DY[d], who(e))) return;
    }
    const step = Math.min(rem, CELL - e.off);
    e.off += step; rem -= step;
    if (e.off >= CELL - 1e-9) { e.off = 0; e.c = wrapC(e.c + DX[e.dir]); e.r += DY[e.dir]; arrive?.(e); }
  }
}
function droneTarget(s, d) {
  const z = s.zip, H = s.drones[0];
  if (d.state === 'eyes') return DOOR_OUT;
  if (s.mode % 2 === 0 && s.mode < MODES.length) return CORNERS[d.k];
  if (d.k === 0) return [z.c, z.r];
  if (d.k === 1) return [z.c + DX[z.dir] * 4, z.r + DY[z.dir] * 4];
  if (d.k === 2) { const px = z.c + DX[z.dir] * 2, py = z.r + DY[z.dir] * 2; return [px * 2 - H.c, py * 2 - H.r]; }
  const dd = (z.c - d.c) ** 2 + (z.r - d.r) ** 2;
  return dd > 64 ? [z.c, z.r] : CORNERS[3];
}
function droneDecide(s, d) {
  const opts = [];
  for (const dir of [0, 3, 2, 1]) {
    if (dir === (d.dir + 2) % 4) continue;
    if (open(d.c + DX[dir], d.r + DY[dir], d.state === 'eyes' ? 'eyes' : 'drone')) opts.push(dir);
  }
  if (!opts.length) return (d.dir + 2) % 4;
  if (d.scared && d.state === 'active') return opts[roll(s, opts.length)];
  const [tx, ty] = droneTarget(s, d);
  let best = opts[0], bd = Infinity;
  for (const dir of opts) { const nx = d.c + DX[dir], ny = d.r + DY[dir], dist = (nx - tx) ** 2 + (ny - ty) ** 2; if (dist < bd) { bd = dist; best = dir; } }
  return best;
}
/** A drone moving in a straight line between fixed points (into and out of its home): true when it got there. */
function walk(d, speed) {
  const [tx, ty] = d.path[0], x = d.c * CELL + CELL / 2 + (d.px || 0), y = d.r * CELL + CELL / 2 + (d.py || 0);
  const gx = tx * CELL + CELL / 2, gy = ty * CELL + CELL / 2, dx = gx - x, dy = gy - y, dist = Math.abs(dx) + Math.abs(dy);
  if (dist <= speed) { d.c = tx; d.r = ty; d.px = 0; d.py = 0; d.path.shift(); return !d.path.length; }
  const k = speed / dist;
  d.px = (d.px || 0) + dx * k; d.py = (d.py || 0) + dy * k;
  return false;
}
export const dronePos = d => (d.path ? [d.c * CELL + CELL / 2 + (d.px || 0), d.r * CELL + CELL / 2 + (d.py || 0)] : posOf(d));

function eat(s, z) {
  const i = z.r * COLS + z.c, v = z.r >= 0 && z.r < ROWS && z.c >= 0 && z.c < COLS ? s.dots[i] : 0;
  if (!v) return;
  s.dots[i] = 0; s.left--; s.eatenDots++;
  if (v === 1) { addScore(s, 10); s.ev.push({ k: 'spark' }); }
  else {
    addScore(s, 50); s.power = powerTicks(s); s.chain = 0;
    for (const d of s.drones) if (d.state === 'active') { d.scared = 1; reverse(d); }
    s.ev.push({ k: 'power', c: z.c, r: z.r });
  }
  if (s.eatenDots === 70 || s.eatenDots === 170) { s.chip = { t: 560 }; s.ev.push({ k: 'chipIn' }); }
  if (!s.left) { s.clearT = 150; s.ev.push({ k: 'cleared', level: s.level }); }
}
export function step(s, inp) {
  s.t++;
  if (s.over) return;
  const b = inp.b, pressed = b & ~s.prev;
  s.prev = b;
  for (const [bit, d] of [[BTN.U, 0], [BTN.R, 1], [BTN.D, 2], [BTN.L, 3]]) if (pressed & bit) s.zip.want = d;   // (the last way pressed: kept until another)
  if (s.clearT) { if (--s.clearT <= 0) { s.level++; s.dots = sparks(); s.left = s.dots.reduce((a, v) => a + (v ? 1 : 0), 0); s.eatenDots = 0; s.chip = null; s.levelT = s.t; place(s); s.ev.push({ k: 'level', level: s.level }); } return; }
  if (s.deadT) { if (--s.deadT <= 0) { if (s.lives <= 0) { s.over = true; s.ev.push({ k: 'over' }); } else { s.levelT = s.t; place(s); } } return; }
  if (s.readyT) { s.readyT--; if (!s.readyT) s.ev.push({ k: 'go' }); return; }
  // scatter and chase, by the clock (not while the drones are blue)
  if (!s.power && s.mode < MODES.length && ++s.modeT >= MODES[s.mode]) { s.mode++; s.modeT = 0; for (const d of s.drones) if (d.state === 'active') reverse(d); }
  if (s.power && --s.power === 0) for (const d of s.drones) d.scared = 0;
  // Zip: turns back at once, other turns at the next middle of a cell
  const z = s.zip;
  if (z.want === (z.dir + 2) % 4 && z.off > 0) reverse(z);
  advance(z, zipSpeed(s), e => {
    if (open(e.c + DX[e.want], e.r + DY[e.want], 'zip')) return e.want;
    return open(e.c + DX[e.dir], e.r + DY[e.dir], 'zip') ? e.dir : -1;
  }, () => 'zip', e => eat(s, e));
  if (z.off === 0) eat(s, z);
  if (s.clearT) return;
  // the drones
  for (const d of s.drones) {
    if (d.state === 'home') {
      if (s.t >= d.release && !s.power) { d.state = 'leaving'; d.path = [[9, 9], DOOR_OUT]; }
      continue;
    }
    if (d.state === 'leaving' || d.state === 'entering') {
      if (walk(d, d.state === 'leaving' ? 1 : 2.4)) {
        d.path = null;
        if (d.state === 'leaving') { d.state = 'active'; d.dir = 3; d.off = 0; d.scared = 0; }
        else { d.state = 'leaving'; d.path = [DOOR_OUT]; }
      }
      continue;
    }
    const tunnel = d.r === TUNNEL && (d.c < 4 || d.c > 14);
    const v = d.state === 'eyes' ? 3 : d.scared ? 0.85 : tunnel ? 0.8 : droneSpeed(s);
    advance(d, v, e => droneDecide(s, e), e => (e.state === 'eyes' ? 'eyes' : 'drone'));
    if (d.state === 'eyes' && d.off === 0 && d.c === DOOR_OUT[0] && d.r === DOOR_OUT[1]) { d.state = 'entering'; d.path = [[9, 9]]; d.scared = 0; }
  }
  // meetings
  const [zx, zy] = posOf(z);
  for (const d of s.drones) {
    if (d.state !== 'active') continue;
    const [dx, dy] = dronePos(d);
    if (Math.abs(dx - zx) + Math.abs(dy - zy) >= 12) continue;
    if (d.scared) {
      const pts = 200 * 2 ** Math.min(3, s.chain); s.chain++; s.caught++;
      addScore(s, pts); d.state = 'eyes'; d.scared = 0;
      s.ev.push({ k: 'catch', x: dx, y: dy, pts });
    } else {
      s.lives--; s.deadT = 110; s.ev.push({ k: 'die', x: zx, y: zy });
      return;
    }
  }
  // the bonus chip, below the drones' home
  if (s.chip) {
    if (--s.chip.t <= 0) s.chip = null;
    else if (Math.abs(zx - (9 * CELL + CELL / 2)) + Math.abs(zy - (11 * CELL + CELL / 2)) < 12) { const pts = 100 + 100 * s.level; addScore(s, pts); s.chip = null; s.ev.push({ k: 'chip', pts }); }
  }
}
export const over = s => s.over;
export const score = s => s.score;
export const detail = s => ({ level: s.level, caught: s.caught });
