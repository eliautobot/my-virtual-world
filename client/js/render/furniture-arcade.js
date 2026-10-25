// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's furniture (Floor Themes' arcade, 2026-10-23: "arcade themed furniture, tables, lights, decorations, walls
// ... billiards, maybe bowling, maybe riding one of those mechanical bulls ... look and feel fun"): the games (billiards,
// a mini bowling lane, a mechanical bull, air hockey, a claw machine, skee-ball, basketball hoops, pinball, a sit-down
// racer, a dance machine, whack-a-mole, a punching machine, foosball, a photo booth), the prize corner (a prize case, a
// prize wall, a token machine), a snack bar, seats (neon booths, high-top tables, gaming chairs) and the lights (neon
// signs, pixel murals, LED pillars, floor light strips, a giant joystick). Item-local frame as render/furniture.js: +z the
// front, y up, the origin the item's middle on the floor; the sizes match shared/catalog.js.
// Light: col(hex, tint, emit) with emit 1 screen, 3 neon, 4 disco (animated tiles), 5 chase (marquee bulbs running),
// 6 cycle (slowly through the colours) — render/mats.js makeFurnMat. tint + neon: the item's own colour glows.
import * as THREE from 'three';
import { WHACK, SKEE, HOOPS, BULL, HOCKEY, FOOS, PIN, POOL, BOWL, foosMen, pinAt, poolRack, bowlPins, skeeLane } from '/shared/arcade/machines.js';
import { CUSHIONS } from '/shared/arcade/games/pool-shark.js';

const TAU = Math.PI * 2, P = Math.PI, H = Math.PI / 2;
const C = { black: '#121317', dark: '#1d2030', chrome: '#d2d6dc', steel: '#9aa0a8', white: '#f4f2ec', wood: '#a87a50', woodD: '#5a3a24' };
const tilt = (f, a) => { f.m.multiply(new THREE.Matrix4().makeRotationX(a)); };
/** A soft halo round a neon tube: translucent, glowing (glass that lights up). */
const halo = (f, hex) => { f.glass(hex); f.c[3] = 6; };

// ------------------------------------------------------------------ neon lettering (our own stroke letters, 0.6 × 1)
const GLYPH = {
  A: [[[0, 0], [0.3, 1], [0.6, 0]], [[0.12, 0.38], [0.48, 0.38]]],
  R: [[[0, 0], [0, 1], [0.45, 1], [0.6, 0.86], [0.6, 0.64], [0.45, 0.5], [0, 0.5]], [[0.3, 0.5], [0.6, 0]]],
  C: [[[0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85], [0, 0.15], [0.15, 0], [0.45, 0], [0.6, 0.15]]],
  D: [[[0, 0], [0, 1], [0.4, 1], [0.6, 0.8], [0.6, 0.2], [0.4, 0], [0, 0]]],
  E: [[[0.6, 1], [0, 1], [0, 0], [0.6, 0]], [[0, 0.5], [0.45, 0.5]]],
  G: [[[0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85], [0, 0.15], [0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 0.45], [0.32, 0.45]]],
  M: [[[0, 0], [0, 1], [0.3, 0.55], [0.6, 1], [0.6, 0]]],
  O: [[[0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85], [0, 0.15], [0.15, 0]]],
  N: [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]],
  P: [[[0, 0], [0, 1], [0.45, 1], [0.6, 0.86], [0.6, 0.64], [0.45, 0.5], [0, 0.5]]],
  I: [[[0.3, 0], [0.3, 1]], [[0.12, 0], [0.48, 0]], [[0.12, 1], [0.48, 1]]],
  Z: [[[0, 1], [0.6, 1], [0, 0], [0.6, 0]]],
  S: [[[0.6, 0.85], [0.45, 1], [0.15, 1], [0, 0.85], [0, 0.64], [0.15, 0.5], [0.45, 0.5], [0.6, 0.36], [0.6, 0.15], [0.45, 0], [0.15, 0], [0, 0.15]]],
  K: [[[0, 0], [0, 1]], [[0.6, 1], [0, 0.42]], [[0.2, 0.6], [0.6, 0]]],
  V: [[[0, 1], [0.3, 0], [0.6, 1]]],
  L: [[[0, 1], [0, 0], [0.6, 0]]],
  U: [[[0, 1], [0, 0.15], [0.15, 0], [0.45, 0], [0.6, 0.15], [0.6, 1]]],
  B: [[[0, 0], [0, 1], [0.42, 1], [0.57, 0.87], [0.57, 0.63], [0.42, 0.5], [0, 0.5]], [[0.42, 0.5], [0.6, 0.36], [0.6, 0.14], [0.45, 0], [0, 0]]],
};
/** Neon words centred at (cx, y0) on the plane z, letters h tall: tubes that glow in col, a halo round them. */
export function neonText(f, str, cx, y0, z, h, col, r = 0.014) {
  const w = 0.6 * h, gap = 0.28 * h, sp = 0.5 * h;
  const total = [...str].reduce((t, ch) => t + (ch === ' ' ? sp : w + gap), -gap);
  let x = cx - total / 2;
  for (const ch of str) {
    if (ch === ' ') { x += sp; continue; }
    for (const line of GLYPH[ch] || []) for (let i = 0; i + 1 < line.length; i++) {
      const a = [x + line[i][0] * h, y0 + line[i][1] * h, z], b = [x + line[i + 1][0] * h, y0 + line[i + 1][1] * h, z];
      f.col(col, 0, 3); f.rod(a, b, r, 6);
      halo(f, col); f.rod(a, b, r * 2.6, 6);
    }
    x += w + gap;
  }
}
/** A neon outline through points (closed), glowing in col. */
export function neonLine(f, pts, z, col, r = 0.013, closed = true) {
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    f.col(col, 0, 3); f.rod([a[0], a[1], z], [b[0], b[1], z], r, 6);
    halo(f, col); f.rod([a[0], a[1], z], [b[0], b[1], z], r * 2.6, 6);
  }
}
const ring = (cx, cy, rad, n = 18) => Array.from({ length: n }, (_, k) => [cx + Math.cos(k / n * TAU) * rad, cy + Math.sin(k / n * TAU) * rad]);
/** A sign's backing: dark acrylic on two stand-offs, the plane at z (against a wall behind −z). */
function backer(f, w, y0, y1) {
  f.col('#0b0c12'); f.box(-w / 2, y0, -0.06, w / 2, y1, -0.035);
  f.col(C.chrome); for (const x of [-w / 2 + 0.08, w / 2 - 0.08]) for (const y of [y0 + 0.06, y1 - 0.06]) f.cyl(x, -0.03, 0.012, y - 0.012, y + 0.012, 6);
}

// ------------------------------------------------------------------ pixel art (our own: Star Siege drones, Maze Dash)
const SPACE = [
  '..................................',
  '..*.......*..........*......*.....',
  '......GGGGG.....PPPPP.....GGGGG...',
  '....GGGGGGGGG.PPPPPPPPP.GGGGGGGGG.',
  '....GG.GGG.GG.PP.PPP.PP.GG.GGG.GG.',
  '....GGGGGGGGG.PPPPPPPPP.GGGGGGGGG.',
  '......G..G..G...P..P..P...G..G..G.',
  '.*......................*.........',
  '...........Y.......OOOO...........',
  '...........Y......OOOOOO......*...',
  '...*.......Y......OOOOOO..........',
  '...........Y.......OOOO...........',
  '..................................',
  '.....*...........C.......*........',
  '................CCC...............',
  '..............CCCCCCC.............',
  '..............CC.C.CC.............',
  '..................................',
];
const MAZE = [
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  'B.o..o..o..o..o.BB.o..o..o..o..o.B',
  'B.BBBBB.BBBBBB..BB..BBBBBB.BBBBB.B',
  'B.o.....o...........o.......o..o.B',
  'B.BBB.BBBBB..BBBBBB..BBBBB.BBB.B.B',
  'B..o...o......B..B......o...o..B.B',
  'BBBB.BBBBB.....RR.....BBBBB.BBBB.B',
  'B..o.......P..RRRR..G........o...B',
  'B.BBBB.BBB...RR.RR.....BBB.BBBB..B',
  'B....o..B.....RRRR.....B..o......B',
  'B.BBBBB.B..o...........B.BBBBBBB.B',
  'B.o.....B......YYY.....B.....o...B',
  'B.BBB.BBBBB...YYYYY...BBBBB.BBB..B',
  'B..o......o...YY.YY.......o......B',
  'B.BBBBBBB.BBB..YYY..BBB.BBBBBBBB.B',
  'B..o..o.....o.......o.......o..o.B',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
];
const PIX = { '*': '#f8fafc', G: '#4ade80', P: '#f472b6', Y: '#facc15', O: '#fb923c', C: '#22d3ee', B: '#3b5bff', o: '#fde68a', R: '#f43f5e' };
function pixelPanel(f, map, w, y0, y1) {
  const rows = map.length, cols = map[0].length, cw = w / cols, ch = (y1 - y0) / rows;
  f.col('#05060b'); f.box(-w / 2 - 0.05, y0 - 0.05, -0.04, w / 2 + 0.05, y1 + 0.05, -0.012);
  f.col('#2a2e3a'); f.box(-w / 2 - 0.07, y0 - 0.07, -0.045, w / 2 + 0.07, y1 + 0.07, -0.038);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = map[r][c], col = PIX[k]; if (!col) continue;
    const x = -w / 2 + c * cw, y = y1 - (r + 1) * ch, s = k === '*' || k === 'o' ? 0.3 : 0.06;
    f.col(col, 0, 3); f.box(x + cw * s, y + ch * s, -0.012, x + cw * (1 - s), y + ch * (1 - s), -0.004);
  }
}

// ------------------------------------------------------------------ small parts
function plush(f, x, y, z, s, col) {   // a teddy: body, head, ears, a muzzle
  f.col(col); f.sph(x, y + 0.11 * s, z, 0.1 * s, 0.11 * s, 0.09 * s, 9, 6); f.sph(x, y + 0.27 * s, z, 0.085 * s, 0.08 * s, 0.08 * s, 9, 6);
  for (const k of [-1, 1]) f.sph(x + k * 0.065 * s, y + 0.34 * s, z, 0.03 * s, 0.03 * s, 0.025 * s, 6, 4);
  f.col('#f5e6d3'); f.sph(x, y + 0.255 * s, z + 0.07 * s, 0.035 * s, 0.028 * s, 0.025 * s, 6, 4);
  f.col('#111'); for (const k of [-1, 1]) f.sph(x + k * 0.03 * s, y + 0.29 * s, z + 0.07 * s, 0.009 * s, 0.009 * s, 0.006 * s, 4, 3);
}
const PLUSH = ['#f472b6', '#60a5fa', '#facc15', '#a78bfa', '#34d399', '#fb923c', '#f87171', '#c4b5fd'];
function barStool(f, x, z) {
  f.col(C.black); f.cyl(x, z, 0.19, 0, 0.03, 12); f.col(C.chrome); f.cyl(x, z, 0.026, 0.03, 0.7, 8);
  f.lathe(x, z, [[0.15, 0.28], [0.16, 0.28], [0.16, 0.295], [0.15, 0.295]], 12);
  f.tint(); f.cyl(x, z, 0.19, 0.7, 0.75, 14); f.col('#22d3ee', 0, 6); f.cyl(x, z, 0.195, 0.69, 0.705, 14);
}
function chaseBulbs(f, x0, x1, y, z, step = 0.09, col = '#fff1c2') { f.col(col, 0, 5); for (let x = x0; x <= x1 + 1e-6; x += step) f.box(x - 0.016, y - 0.016, z, x + 0.016, y + 0.016, z + 0.012); }
function screen(f, x0, y0, x1, y1, z, bg = '#0a1a36') { f.col(C.black); f.box(x0 - 0.03, y0 - 0.03, z - 0.02, x1 + 0.03, y1 + 0.03, z); f.col(bg, 0, 1); f.box(x0, y0, z, x1, y1, z + 0.003); }

export function addArcadeFurniture(D) {
  // ---------------------------------------------------------------- the games
  D.pool_table = f => {
    // (shared/arcade/machines.js POOL and Pool Shark's cushions: the cloth, cushions, pockets and balls the game plays on)
    const T = POOL.top, R = POOL.ballR;
    f.col(C.woodD); for (const [x, z] of [[-0.66, -1.24], [0.66, -1.24], [-0.66, 1.24], [0.66, 1.24]]) f.lathe(x, z, [[0.1, 0], [0.12, 0.05], [0.07, 0.2], [0.1, 0.42], [0.08, 0.6], [0.1, 0.62], [0, 0.62]], 10);
    f.tint(); f.box(-0.79, 0.6, -1.39, 0.79, 0.78, 1.39);
    f.col('#ff2bd6', 0, 3); f.box(-0.8, 0.6, -1.4, 0.8, 0.616, 1.4);                         // the glow under the apron
    f.col(C.woodD); f.box(-0.85, 0.78, -1.45, 0.85, 0.845, -1.3); f.box(-0.85, 0.78, 1.3, 0.85, 0.845, 1.45);
    f.box(-0.85, 0.78, -1.3, -0.7, 0.845, 1.3); f.box(0.7, 0.78, -1.3, 0.85, 0.845, 1.3);
    f.col('#f4e7c8'); for (const z of [-0.98, -0.65, -0.33, 0.33, 0.65, 0.98]) for (const x of [-0.775, 0.775]) f.box(x - 0.012, 0.845, z - 0.012, x + 0.012, 0.848, z + 0.012);
    for (const x of [-0.35, 0, 0.35]) for (const z of [-1.375, 1.375]) f.box(x - 0.012, 0.845, z - 0.012, x + 0.012, 0.848, z + 0.012);
    f.col('#0f8a5f'); f.box(-0.7, 0.78, -1.3, 0.7, T, 1.3);
    f.col('#f8fafc'); f.cyl(POOL.head[0], POOL.head[1], 0.006, T, T + 0.001, 8); f.cyl(POOL.foot[0], POOL.foot[1], 0.006, T, T + 0.001, 8);
    // the cushions, with the gaps and jaws at the pockets (each a rubber nose on the rail behind it)
    f.col('#0b6b4b');
    for (const [ax, az, bx, bz] of CUSHIONS) {
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz), mx = (ax + bx) / 2, mz = (az + bz) / 2, yaw = Math.atan2(-dz, dx);
      const out = Math.sin(yaw) * mx + Math.cos(yaw) * mz > 0 ? 1 : -1;   // (behind the face: away from the middle of the table)
      f.push(mx, 0, mz, yaw); f.box(-l / 2, T, out > 0 ? 0 : -0.045, l / 2, 0.84, out > 0 ? 0.045 : 0); f.pop();
    }
    f.col('#08090b'); for (const [x, z] of POOL.pockets) f.cyl(x, z, POOL.pocketR, 0.795, 0.848, 14);
    f.col('#c8a24a'); for (const [x, z] of POOL.pockets) f.lathe(x, z, [[POOL.pocketR, 0.848], [POOL.pocketR + 0.012, 0.848], [POOL.pocketR + 0.012, 0.85], [POOL.pocketR, 0.85]], 14);
    // the balls, racked: parts (Pool Shark rolls them; render/venue-motion.js leaves them be)
    const COL = ['#fbfbf7', '#facc15', '#2563eb', '#dc2626', '#7c3aed', '#f97316', '#16a34a', '#7f1d1d', '#111111'];
    const order = [1, 10, 2, 11, 8, 3, 12, 4, 13, 5, 9, 6, 14, 7, 15], spots = poolRack();
    const ballAt = (n, x, z) => {
      f.part(`ball${n}`, [x, T + R, z], { kind: 'poolball', n });
      if (n < 9) { f.col(COL[n]); f.sph(x, T + R, z, R, R, R, 12, 8); }
      else {   // a stripe: white, its colour round the middle
        f.col(C.white); f.sph(x, T + R, z, R, R, R, 12, 8);
        f.col(COL[n - 8]); f.lathe(x, z, Array.from({ length: 7 }, (_, k) => { const y = (k / 6 - 0.5) * 1.1 * R; return [Math.sqrt(R * R - y * y) + 0.0005, T + R + y]; }), 14);
      }
      f.endPart();
    };
    ballAt(0, POOL.head[0], POOL.head[1]);
    order.forEach((n, i) => ballAt(n, spots[i][0], spots[i][1]));
    // two cues laid on the table: a part, put away while someone plays Pool Shark
    f.part('cues', [0, 0.84, 0], { kind: 'cues' });
    for (const [a, b] of [[[-0.5, 0.86, 0.95], [0.25, 0.86, -0.25]], [[0.55, 0.86, 1.0], [0.6, 0.86, -0.3]]]) { f.col('#e7cf9f'); f.rod(a, b, 0.011, 6); f.col('#2b1b12'); f.rod(a, [a[0] + (b[0] - a[0]) * 0.3, 0.86, a[2] + (b[2] - a[2]) * 0.3], 0.014, 6); }
    f.endPart();
    // the lamp over the table: a shade, its light, its score display facing the near end (Pool Shark's score on it)
    const Lp = POOL.lamp, S = POOL.sign;
    f.part('lamp', [0, Lp.y0, 0], { kind: 'lamp' });   // (a part: put aside while Pool Shark is played on a phone held upright)
    f.col(C.chrome); for (const x of [-0.25, 0.25]) f.rod([x, Lp.y1, 0], [x, 2.3, 0], 0.006, 5);
    f.col('#14532d'); f.box(-Lp.hx, Lp.y0, -Lp.hz, Lp.hx, Lp.y1, Lp.hz);
    f.col('#fff7d6', 0, 3); f.box(-Lp.hx + 0.04, Lp.y0 - 0.004, -Lp.hz + 0.04, Lp.hx - 0.04, Lp.y0, Lp.hz - 0.04);
    f.col('#0b1120', 0, 1); f.box(S.x0, S.y0, Lp.hz, S.x1, S.y1, S.z - 0.002);
    f.endPart();
  };
  D.bowling_lane = f => {
    f.col('#22252e'); f.box(-0.75, 0, -3.4, 0.75, 0.06, 3.4);
    f.col('#e8c995'); f.box(-0.42, 0.06, -2.78, 0.42, 0.09, 2.2);
    f.col('#cfa86f'); for (let x = -0.35; x <= 0.36; x += 0.105) f.box(x - 0.004, 0.09, -2.78, x + 0.004, 0.0906, 2.2);
    f.col('#8a3b22'); for (const x of [-0.24, -0.12, 0, 0.12, 0.24]) { const z = 0.75 + Math.abs(x) * 1.4; f.box(x - 0.018, 0.09, z - 0.06, x + 0.018, 0.0915, z + 0.06); }
    f.col('#2b2e36'); f.box(-0.58, 0.04, -2.78, -0.42, 0.075, 2.2); f.box(0.42, 0.04, -2.78, 0.58, 0.075, 2.2);
    f.tint('#5b5f68'); f.box(-0.75, 0.06, -3.4, -0.58, 0.42, 2.45); f.box(0.58, 0.06, -3.4, 0.75, 0.42, 2.45);
    f.col('#ffffff', 1, 3); f.box(-0.6, 0.42, -3.35, -0.57, 0.44, 2.4); f.box(0.57, 0.42, -3.35, 0.6, 0.44, 2.4);
    f.col('#c99e64'); f.box(-0.58, 0.06, 2.2, 0.58, 0.085, 3.4);
    f.col('#e11d48', 0, 3); f.box(-0.42, 0.09, 2.18, 0.42, 0.093, 2.22);
    f.col(C.dark); f.box(-0.75, 0.06, 2.55, -0.58, 0.55, 3.3); f.col(C.chrome); f.box(-0.74, 0.55, 2.55, -0.59, 0.57, 3.3);
    for (const [z, col] of [[2.75, '#2563eb'], [2.98, '#e11d48'], [3.18, '#16a34a']]) { f.col(col); f.sph(-0.665, 0.65, z, 0.085, 0.085, 0.085, 10, 7); }
    f.col('#f1e7d2', 0, 1); f.box(-0.42, 0.06, -3.15, 0.42, 0.095, -2.78);
    f.col('#0e0f14'); f.box(-0.58, 0.06, -3.4, 0.58, 0.6, -3.2);
    // the ten pins: parts on their spots (shared/arcade/machines.js bowlPins: Strike Lane knocks them down and sets them up)
    const pin = [[0, 0], [0.024, 0], [0.042, 0.07], [0.047, 0.12], [0.03, 0.2], [0.021, 0.245], [0.03, 0.3], [0.022, 0.33], [0, 0.34]];
    bowlPins().forEach(([x, z], k) => {
      f.part(`pin${k}`, [x, BOWL.top + 0.005, z], { kind: 'pin', k });
      f.col(C.white); f.lathe(x, z, pin.map(([a, b]) => [a, b + 0.095]), 12);
      f.col('#dc2626'); f.lathe(x, z, [[0.0255, 0.312], [0.0255, 0.326]], 12);
      f.endPart();
    });
    f.col('#121318'); f.box(-0.75, 0.62, -3.4, 0.75, 1.12, -2.68);
    chaseBulbs(f, -0.7, 0.7, 1.07, -2.68, 0.1); chaseBulbs(f, -0.7, 0.7, 0.67, -2.68, 0.1, '#7dd3fc');
    f.col(C.black); f.box(-0.06, 1.12, -3.25, 0.06, 1.2, -3.15);
    screen(f, -0.68, 1.22, 0.68, 1.68, -3.15);
    for (let i = 0; i < 10; i++) { f.col(i % 3 ? '#f8fafc' : '#facc15', 0, 1); f.box(-0.62 + i * 0.125, 1.45, -3.146, -0.53 + i * 0.125, 1.6, -3.144); }
    f.col('#22d3ee', 0, 1); f.box(-0.62, 1.28, -3.146, 0.2, 1.38, -3.144);
  };
  D.mech_bull = f => {
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) / n * TAU;
      f.push(Math.sin(a) * 1.42, 0, Math.cos(a) * 1.42, a);
      f.col(k % 2 ? '#e11d48' : '#facc15'); f.boxC(0, 0.22, 0, 0.38, 0.22, 0.2);
      f.sph(0, 0.44, 0, 0.38, 0.09, 0.2, 10, 4, { cut: 0 });
      f.pop();
    }
    f.col('#1d4ed8'); f.cyl(0, 0, 1.25, 0, 0.1, 24); f.col('#3b82f6'); f.cyl(0, 0, 0.9, 0.1, 0.12, 24);
    f.col(C.dark); f.cyl(0, 0, 0.28, 0.12, 0.2, 14); f.col(C.chrome); f.cyl(0, 0, 0.1, 0.2, 0.72, 12);
    // the bull on its pole: a part, still but for Bull Rider, which turns and rocks it (play/machines/bull-rider.js)
    f.part('bull', [...BULL.pivot], { kind: 'bull' });
    f.col(C.chrome); f.sph(0, 0.74, 0, 0.09, 0.06, 0.09, 10, 6);
    f.col('#4a2c1d'); f.sph(0, 0.98, -0.05, 0.3, 0.26, 0.6, 14, 9);
    f.sph(0, 1.07, 0.55, 0.19, 0.2, 0.22, 12, 8);
    f.col('#2e1a10'); f.sph(0, 0.99, 0.74, 0.13, 0.11, 0.11, 10, 6);
    f.col(C.chrome); f.lathe(0, 0.86, [[0.05, 0.92], [0.06, 0.93], [0.05, 0.94], [0.04, 0.93]], 10);
    f.col('#111'); for (const s of [-1, 1]) f.sph(s * 0.12, 1.14, 0.7, 0.025, 0.025, 0.02, 6, 4);
    f.col('#3a2418'); for (const s of [-1, 1]) f.sph(s * 0.18, 1.18, 0.5, 0.07, 0.03, 0.04, 6, 4);
    f.col('#f1ead8'); for (const s of [-1, 1]) { f.rod([s * 0.12, 1.18, 0.56], [s * 0.36, 1.26, 0.55], 0.032, 6); f.rod([s * 0.36, 1.26, 0.55], [s * 0.44, 1.42, 0.6], 0.022, 6); }
    f.col('#7f1d1d'); f.sph(0, 1.2, -0.08, 0.24, 0.07, 0.3, 12, 5); f.col('#b45309'); f.cyl(0, 0.16, 0.035, 1.22, 1.33, 8);
    f.col('#2e1a10'); f.rod([0, 0.95, -0.62], [0, 0.6, -0.78], 0.025, 6);
    f.endPart();
    f.col('#facc15', 0, 5); for (let k = 0; k < 24; k++) { const a = k / 24 * TAU; f.box(Math.sin(a) * 1.62 - 0.02, 0.02, Math.cos(a) * 1.62 - 0.02, Math.sin(a) * 1.62 + 0.02, 0.05, Math.cos(a) * 1.62 + 0.02); }
  };
  D.air_hockey = f => {
    const G = HOCKEY.goal, T = HOCKEY.top;   // (shared/arcade/machines.js: the surface, the goals, the puck and strikers Puck Rush plays with)
    f.col(C.black); for (const [x, z] of [[-0.6, -1.1], [0.6, -1.1], [-0.6, 1.1], [0.6, 1.1]]) f.box(x - 0.06, 0, z - 0.06, x + 0.06, 0.16, z + 0.06);
    f.tint(); f.box(-0.7, 0.16, -1.22, 0.7, 0.78, 1.22);
    f.col('#f472b6', 0, 3); f.box(-0.71, 0.3, -1.23, 0.71, 0.32, 1.23);
    f.col('#22d3ee', 0, 3); f.box(-0.72, 0.78, -1.25, -0.64, 0.84, 1.25); f.box(0.64, 0.78, -1.25, 0.72, 0.84, 1.25);
    f.col('#f472b6', 0, 3); f.box(-0.64, 0.78, -1.25, -G, 0.84, -1.17); f.box(G, 0.78, -1.25, 0.64, 0.84, -1.17); f.box(-0.64, 0.78, 1.17, -G, 0.84, 1.25); f.box(G, 0.78, 1.17, 0.64, 0.84, 1.25);
    f.col(C.black); f.box(-G, 0.7, -1.25, G, 0.8, -1.17); f.box(-G, 0.7, 1.17, G, 0.8, 1.25);
    f.col('#e9f4ff'); f.box(-0.64, 0.78, -1.17, 0.64, T, 1.17);
    f.col('#93c5fd'); for (let x = -0.56; x <= 0.57; x += 0.08) for (let z = -1.08; z <= 1.09; z += 0.08) f.box(x - 0.004, T, z - 0.004, x + 0.004, T + 0.0015, z + 0.004);
    f.col('#ef4444'); f.box(-0.64, T, -0.006, 0.64, T + 0.002, 0.006); f.lathe(0, 0, [[0.17, T], [0.185, T], [0.185, T + 0.002], [0.17, T + 0.002]], 22);
    f.col('#2563eb'); f.box(-0.64, T, -0.556, 0.64, T + 0.002, -0.544); f.box(-0.64, T, 0.544, 0.64, T + 0.002, 0.556);
    for (const s of [-1, 1]) { f.col(s > 0 ? '#ef4444' : '#2563eb'); f.lathe(0, s * 1.17, [[G - 0.01, T], [G, T], [G, T + 0.002], [G - 0.01, T + 0.002]], 24, s > 0 ? H : -H, s > 0 ? 3 * H : H); }   // (the creases round the goals)
    const R = HOCKEY.strikerR;
    for (const [z, col] of [[HOCKEY.park, '#ef4444'], [-HOCKEY.park, '#2563eb']]) {   // (the table's strikers: put away while a player has theirs at that end)
      f.part(z > 0 ? 'parked0' : 'parked1', [0, T, z], { kind: 'parked', user: [0, z > 0 ? 1.5 : -1.5], clip: 'hockey' });
      f.col(col); f.cyl(0, z, R, T, T + 0.035, 16); f.col(C.white); f.cyl(0, z, R * 0.7, T + 0.035, T + 0.038, 14); f.col(col); f.cyl(0, z, 0.022, T + 0.035, T + 0.1, 8); f.sph(0, T + 0.105, z, 0.03, 0.025, 0.03, 8, 5);
      f.endPart();
    }
    f.part('puck', [0, T, 0], { kind: 'puck', users: [[0, 1.5], [0, -1.5]], clip: 'hockey' }); f.col('#111'); f.cyl(0, 0, HOCKEY.puckR, T, T + 0.01, 16); f.col('#facc15', 0, 3); f.lathe(0, 0, [[HOCKEY.puckR * 0.55, T + 0.01], [HOCKEY.puckR * 0.75, T + 0.01], [HOCKEY.puckR * 0.75, T + 0.011], [HOCKEY.puckR * 0.55, T + 0.011]], 16); f.endPart();
    f.col(C.black); f.box(-0.71, 0.84, -0.12, -0.66, 1.0, 0.12); f.col('#ff3b3b', 0, 3); f.box(-0.66, 0.88, -0.09, -0.655, 0.96, -0.01); f.col('#3b82f6', 0, 3); f.box(-0.66, 0.88, 0.01, -0.655, 0.96, 0.09);
    // the scoreboard over the far goal (Puck Rush's score on it)
    const B = HOCKEY.sign;
    f.col(C.chrome); for (const x of [-0.33, 0.33]) f.box(x - 0.015, 0.84, -1.25, x + 0.015, B.y1 + 0.02, -1.22);
    f.col(C.black); f.box(-0.34, B.y0 - 0.03, -1.27, 0.34, B.y1 + 0.03, B.z - 0.004);
    screen(f, B.x0, B.y0, B.x1, B.y1, B.z - 0.003, '#0b1120');
    f.col('#ef4444', 0, 3); f.box(-0.335, B.y1 + 0.03, -1.255, -0.005, B.y1 + 0.04, -1.24); f.col('#3b82f6', 0, 3); f.box(0.005, B.y1 + 0.03, -1.255, 0.335, B.y1 + 0.04, -1.24);
  };
  D.claw_machine = f => {
    f.tint(); f.box(-0.46, 0, -0.46, 0.46, 0.92, 0.46);
    f.col('#0e0f12'); f.box(-0.38, 0.22, 0.46, -0.08, 0.52, 0.475); f.col('#f472b6', 0, 3); f.box(-0.38, 0.52, 0.46, -0.08, 0.535, 0.48);
    f.col(C.dark); f.box(-0.46, 0.92, 0.3, 0.46, 0.99, 0.5);
    f.col(C.black); f.cyl(-0.18, 0.4, 0.035, 0.99, 1.0, 10); f.col(C.chrome); f.cyl(-0.18, 0.4, 0.008, 1.0, 1.07, 6); f.col('#e11d48'); f.sph(-0.18, 1.085, 0.4, 0.022, 0.022, 0.022, 8, 5);
    f.col('#22d3ee', 0, 3); f.cyl(0.18, 0.4, 0.04, 0.99, 1.02, 14);
    f.col(C.chrome); for (const [x, z] of [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]]) f.box(x - 0.02, 0.92, z - 0.02, x + 0.02, 1.8, z + 0.02);
    f.glass('#d6ecff'); f.box(-0.44, 0.94, -0.44, 0.44, 1.78, 0.44, 'tb');
    // the prizes in the glass: a part, put away while Claw Catch has its own out (play/machines/claw-catch.js)
    f.part('prizes', [0, 0.94, 0], { kind: 'prizes' });
    for (let i = 0; i < 18; i++) { const a = i * 2.4, r = 0.08 + (i % 5) * 0.06; plush(f, Math.sin(a) * r, 0.94 + (i % 3) * 0.04, Math.cos(a) * r * 0.9, 0.55 + (i % 2) * 0.15, PLUSH[i % PLUSH.length]); }
    f.endPart();
    // the gantry (a bar across, a bar along), the cable and the claw: parts, moved by the player's joystick and button
    const cu = { user: [0, 0.75], clip: 'claw' };
    f.col(C.chrome); f.part('clawZ', [0, 1.73, 0], { kind: 'claw', axis: 'z', ...cu }); f.box(-0.42, 1.72, -0.02, 0.42, 1.74, 0.02); f.endPart();
    f.part('clawX', [0.08, 1.73, 0], { kind: 'claw', axis: 'x', ...cu }); f.box(0.06, 1.72, -0.42, 0.1, 1.74, 0.42); f.endPart();
    f.part('cable', [0.08, 1.72, 0], { kind: 'claw', axis: 'cable', ...cu }); f.rod([0.08, 1.72, 0.0], [0.08, 1.5, 0.0], 0.006, 4); f.endPart();
    f.part('claw', [0.08, 1.5, 0], { kind: 'claw', axis: 'head', ...cu }); f.cyl(0.08, 0, 0.04, 1.44, 1.5, 10);
    for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; f.rod([0.08 + Math.sin(a) * 0.03, 1.45, Math.cos(a) * 0.03], [0.08 + Math.sin(a) * 0.08, 1.35, Math.cos(a) * 0.08], 0.008, 4); }
    f.endPart();
    f.tint(); f.box(-0.48, 1.8, -0.48, 0.48, 2.05, 0.48);
    f.col('#fdf2f8', 0, 3); f.box(-0.4, 1.86, 0.481, 0.4, 1.99, 0.485);
    chaseBulbs(f, -0.42, 0.42, 1.825, 0.48, 0.07); chaseBulbs(f, -0.42, 0.42, 2.025, 0.48, 0.07);
  };
  D.skeeball = f => {
    // (built to shared/arcade/machines.js SKEE, where the game Skee Roll is played: the lane rising to the hump, the ring
    // board rising away beyond it, its cups and 100 pockets)
    const L = skeeLane(), [ly0, lz0] = SKEE.laneNear, [ly1, lz1] = SKEE.laneHump, W = SKEE.laneW;
    f.tint(); f.box(-0.42, 0, -1.55, -0.36, 0.95, 1.5); f.box(0.36, 0, -1.55, 0.42, 0.95, 1.5);
    f.col(C.dark); f.box(-0.36, 0, -1.55, 0.36, 0.6, 1.5);
    f.col('#22d3ee', 0, 3); f.box(-0.425, 0.92, -1.5, -0.415, 0.96, 1.5); f.box(0.415, 0.92, -1.5, 0.425, 0.96, 1.5);
    // the lane: polished wood, its boards, the rails
    f.push(0, ly0, lz0); tilt(f, Math.atan2(ly1 - ly0, lz0 - lz1));
    f.col('#d6a86a'); f.box(-W, -0.04, -L.len, W, 0, 0.12);
    f.col('#b88a52'); for (let x = -W + 0.1; x < W - 0.05; x += 0.1) f.box(x - 0.003, 0, -L.len, x + 0.003, 0.002, 0.12);
    f.col('#7c3aed', 0, 3); f.box(-W - 0.04, 0, -L.len, -W, 0.05, 0.12); f.box(W, 0, -L.len, W + 0.04, 0.05, 0.12);
    f.pop();
    // the hump: a rounded lip across the lane's end
    f.col('#f59e0b'); f.rod([-W, ly1 + 0.005, lz1 - 0.04], [W, ly1 + 0.005, lz1 - 0.04], 0.04, 12);
    f.col(C.dark); f.box(-0.36, 0.6, lz1 - 0.2, 0.36, ly1, lz1 - 0.02);
    // the ring board, rising away: local -z up it, y its face
    f.push(0, SKEE.board0[0], SKEE.board0[1]); tilt(f, SKEE.boardSlope);
    f.col('#1e1b4b'); f.box(-0.36, -0.06, -SKEE.boardLen - 0.04, 0.36, 0, 0.02);
    const cz = -SKEE.ringsAt, rings = [...SKEE.rings].reverse(), col = { 20: '#22c55e', 30: '#facc15', 40: '#fb923c', 50: '#f43f5e' };
    f.col('#0b1330'); f.lathe(0, cz, [[0, 0.001], [rings[0][0] + 0.03, 0.001]], 26);
    for (const [r, pts] of rings) { f.col(col[pts], 0, 3); f.lathe(0, cz, [[r - 0.012, 0], [r, 0.03], [r + 0.012, 0]], 26); }
    f.col('#020617'); f.cyl(0, cz, SKEE.rings[0][0] - 0.004, -0.005, 0.004, 16);
    for (const [r] of SKEE.rings.slice(1)) { f.col('#0f1d48'); f.lathe(0, cz, [[r - 0.04, 0.002], [r - 0.016, 0.002]], 26); }
    for (const [px, pu] of SKEE.pockets) { f.col('#e879f9', 0, 3); f.lathe(px, -pu, [[SKEE.pocketR - 0.01, 0], [SKEE.pocketR, 0.025], [SKEE.pocketR + 0.01, 0]], 16); f.col('#020617'); f.cyl(px, -pu, SKEE.pocketR - 0.006, -0.005, 0.004, 14); }
    f.pop();
    f.col('#141519'); f.box(-0.42, 0.95, -1.55, 0.42, 2.05, -1.42);
    screen(f, -0.3, 1.55, 0.3, 1.85, -1.42, '#1a0b2e');
    f.col('#fb923c', 0, 3); for (let i = 0; i < 4; i++) f.box(-0.22 + i * 0.12, 1.62, -1.418, -0.14 + i * 0.12, 1.78, -1.415);
    neonLine(f, [[-0.38, 1.2], [0.38, 1.2], [0.38, 2.0], [-0.38, 2.0]], -1.405, '#f472b6', 0.01);
    f.glass('#e0f2fe'); f.box(-0.415, 0.95, -1.42, -0.405, 1.55, 0.6, 'tb'); f.box(0.405, 0.95, -1.42, 0.415, 1.55, 0.6, 'tb');
    f.col('#7c3aed'); for (let i = 0; i < 5; i++) f.sph(-0.24 + i * 0.12, 0.78, 1.38, SKEE.ballR + 0.005, SKEE.ballR + 0.005, SKEE.ballR + 0.005, 8, 5);
  };
  D.hoop_shot = f => {
    f.tint(); f.box(-0.6, 0, -1.35, -0.54, 1.0, 1.3); f.box(0.54, 0, -1.35, 0.6, 1.0, 1.3);
    f.col(C.dark); f.box(-0.54, 0, -1.35, 0.54, 0.62, 1.3);
    f.push(0, 0.78, 1.25); tilt(f, Math.atan2(0.35, 2.4)); f.col('#3f3f46'); f.box(-0.54, 0, -2.4, 0.54, 0.02, 0); f.pop();
    f.col(C.chrome); for (const [x, z] of [[-0.57, 1.3], [0.57, 1.3], [-0.57, -1.35], [0.57, -1.35]]) f.box(x - 0.018, 1.0, z - 0.018, x + 0.018, 2.5, z + 0.018);
    f.box(-0.57, 2.48, -1.35, 0.57, 2.5, -1.33); f.box(-0.57, 2.48, 1.28, 0.57, 2.5, 1.3); f.box(-0.59, 2.48, -1.35, -0.55, 2.5, 1.3); f.box(0.55, 2.48, -1.35, 0.59, 2.5, 1.3);
    f.col('#9ca3af'); for (const x of [-0.57, 0.57]) { for (let z = -1.2; z < 1.3; z += 0.25) f.rod([x, 1.0, z], [x, 2.48, z], 0.004, 3); for (let y = 1.2; y < 2.5; y += 0.25) f.rod([x, y, -1.35], [x, y, 1.3], 0.004, 3); }
    f.col(C.white); f.box(-0.45, 1.55, -1.33, 0.45, 2.25, -1.3); f.col('#f97316'); f.box(-0.15, 1.7, -1.3, 0.15, 1.92, -1.297);
    // the rim and its net, on a track along the board (a part: Hoop Fever slides it in bonus time)
    const [, ry, rz] = HOOPS.rim, rr = HOOPS.rimR;
    f.col(C.chrome); f.box(-0.42, ry - 0.025, HOOPS.board.z, 0.42, ry - 0.005, HOOPS.board.z + 0.025);
    f.part('hoop', [0, ry, rz], { kind: 'hoop' });
    const hp = Array.from({ length: 16 }, (_, k) => [Math.sin(k / 16 * TAU) * rr, ry, rz + Math.cos(k / 16 * TAU) * rr]);
    f.col('#f97316'); for (let k = 0; k < 16; k++) f.rod(hp[k], hp[(k + 1) % 16], 0.01, 4);
    f.box(-0.04, ry - 0.02, rz - rr - 0.01, 0.04, ry + 0.01, HOOPS.board.z);
    f.col('#e5e7eb'); for (let k = 0; k < 16; k += 2) f.rod(hp[k], [hp[k][0] * 0.55, ry - 0.27, rz + (hp[k][2] - rz) * 0.55], 0.004, 3);
    f.endPart();
    f.col(C.black); f.box(-0.6, 2.25, -1.38, 0.6, 2.6, -1.3); f.col('#ef4444', 0, 3); for (let i = 0; i < 4; i++) f.box(-0.3 + i * 0.16, 2.33, -1.298, -0.2 + i * 0.16, 2.52, -1.295);
    chaseBulbs(f, -0.55, 0.55, 2.28, -1.3, 0.1); chaseBulbs(f, -0.55, 0.55, 2.57, -1.3, 0.1);
    f.col('#ea580c'); for (let i = 0; i < 5; i++) f.sph(-0.32 + i * 0.16, 0.92, 1.12, 0.07, 0.07, 0.07, 10, 7);
  };
  D.pinball = f => {
    // (shared/arcade/machines.js PIN: the playfield Star Pinball is played on, falling toward the player; pinAt() the same
    // point in the item's frame, for the parts' pivots)
    const t = PIN.tilt, sn = Math.sin(t), S = PIN.surf, Wx = PIN.wallX, L = PIN.lane;
    f.col(C.chrome); for (const [x, z] of [[-0.32, -0.6], [0.32, -0.6], [-0.32, 0.6], [0.32, 0.6]]) f.box(x - 0.025, 0, z - 0.025, x + 0.025, PIN.pivot[1] - z * sn + 0.01, z + 0.025);
    f.push(...PIN.pivot); tilt(f, t);
    f.tint(); f.box(-0.37, 0, -0.66, 0.37, 0.2, 0.66);
    f.box(-0.37, 0.2, -0.66, -0.34, S + 0.06, 0.66); f.box(0.34, 0.2, -0.66, 0.37, S + 0.06, 0.66); f.box(-0.34, 0.2, 0.63, 0.34, S + 0.06, 0.66);
    f.col('#1e1b4b'); f.box(-0.34, 0.2, -0.66, 0.34, S, 0.63);
    const up = [0, 1, 0], flat = (pts, y = S + 0.0006) => f.quad(pts.map(q => [q[0], y, q[1]]), up);
    // the art: a big gold star under the bumpers, the lane arrows, the shooter lane's stripe
    f.col('#facc15', 0, 1);
    for (let k = 0; k < 5; k++) {
      const a0 = -H + (k * TAU) / 5, c = [-0.03, 0.1], R1 = 0.1, R0 = 0.04, p = a => [c[0] + Math.cos(a) * R1, c[1] + Math.sin(a) * R1], q = a => [c[0] + Math.cos(a) * R0, c[1] + Math.sin(a) * R0];
      flat([c, q(a0 - TAU / 10), p(a0), q(a0 + TAU / 10)]);
    }
    f.col('#7c3aed', 0, 1); for (const x of PIN.lanes) flat([[x - 0.018, -0.3], [x + 0.018, -0.3], [x, -0.33], [x, -0.33]]);
    f.col('#312e81'); flat([[L.x, -0.17], [Wx, -0.17], [Wx, 0.63], [L.x, 0.63]], S + 0.0004);
    // the walls, the arch, the shooter lane, the gate, the guides
    const wall = (a, b, h = 0.035, w = 0.004) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); f.push((a[0] + b[0]) / 2, S, (a[1] + b[1]) / 2, Math.atan2(-dz, dx)); f.box(-l / 2 - w, 0, -w, l / 2 + w, h, w); f.pop(); };
    f.col(C.chrome);
    const A = PIN.arch, ap = k => [A.r * Math.cos((k / 16) * P), A.cz - A.r * Math.sin((k / 16) * P)];
    for (let k = 0; k < 16; k++) wall(ap(k), ap(k + 1), 0.045, 0.006);
    wall([-Wx, A.cz], [-Wx, 0.63], 0.045, 0.006); wall([Wx, A.cz], [Wx, 0.63], 0.045, 0.006); wall([L.x, L.top], [L.x, 0.63], 0.04);
    wall(PIN.gate[0], PIN.gate[1], 0.02, 0.002);
    f.col(C.white); for (const [a, b] of PIN.guides) { wall(a, b, 0.03, 0.005); f.col(C.chrome); f.cyl(a[0], a[1], 0.007, S, S + 0.034, 10); f.col(C.white); }   // (a post where the inlane and the outlane part)
    // the slingshots: a lit plate, white rubber round it (the kicking edge thicker)
    PIN.slings.forEach(([sa, sb, sc], i) => {
      f.col(i ? '#22d3ee' : '#f472b6', 0, 3); f.quad([[sa[0], S + 0.025, sa[1]], [sb[0], S + 0.025, sb[1]], [sc[0], S + 0.025, sc[1]], [sc[0], S + 0.025, sc[1]]], up);
      f.col(C.white); wall(sa, sb, 0.025, 0.004); wall(sb, sc, 0.025, 0.004); wall(sa, sc, 0.028, 0.007);
    });
    // the pop bumpers: a dark base, a lit cap, a white top
    PIN.bumpers.forEach(([x, z], i) => {
      f.col(C.dark); f.cyl(x, z, PIN.bumperR, S, S + 0.022, 16); f.col(C.chrome); f.cyl(x, z, PIN.bumperR + 0.006, S + 0.022, S + 0.026, 16);
      f.col(['#f472b6', '#22d3ee', '#facc15'][i], 0, 3); f.cyl(x, z, PIN.bumperR * 0.95, S + 0.026, S + 0.042, 16); f.col(C.white); f.cyl(x, z, PIN.bumperR * 0.6, S + 0.042, S + 0.046, 14);
    });
    // the rollover lanes' guides (posts and rubber) and their lights (lit by the game)
    for (const x of PIN.laneGuides) { f.col(C.chrome); for (const z of PIN.laneZ) f.cyl(x, z, 0.006, S, S + 0.032, 8); f.col(C.white); wall([x, PIN.laneZ[0]], [x, PIN.laneZ[1]], 0.022, 0.004); }
    f.col('#9a3412', 0, 1); for (const x of PIN.lanes) f.cyl(x, -0.39, 0.012, S, S + 0.001, 12);
    // the drop targets: parts, knocked down by the ball (play/machines/star-pinball.js)
    PIN.targets.forEach((z, j) => {
      f.part(`drop${j}`, pinAt(PIN.targetX, z), { kind: 'droptarget' });
      f.col(['#f472b6', '#22d3ee', '#facc15'][j], 0, 3); f.box(PIN.targetX - 0.004, S, z - PIN.targetH, PIN.targetX + 0.004, S + 0.032, z + PIN.targetH);
      f.endPart();
    });
    // the flippers: parts about their pivots (pinAt), turned about the playfield's own up (render/venue-motion.js)
    const pu = { user: [0, 0.88], clip: 'pinball' };
    PIN.flippers.forEach(({ at }, i) => {
      const ar = (PIN.flipRest / 1024) * TAU, dir = i ? [-Math.cos(ar), Math.sin(ar)] : [Math.cos(ar), Math.sin(ar)], Lf = PIN.flipLen;
      f.part(i ? 'flipR' : 'flipL', pinAt(at[0], at[1]), { kind: 'flipper', side: i ? 'R' : 'L', sgn: i ? -1 : 1, ...pu });
      f.push(at[0], S, at[1], Math.atan2(-dir[1], dir[0]));
      f.col(C.white); f.cyl(0, 0, PIN.flipR0, 0, 0.026, 12); f.cyl(Lf, 0, PIN.flipR1, 0, 0.026, 10);
      f.quad([[0, 0.026, -PIN.flipR0], [Lf, 0.026, -PIN.flipR1], [Lf, 0.026, PIN.flipR1], [0, 0.026, PIN.flipR0]], up);
      f.quad([[0, 0, PIN.flipR0], [Lf, 0, PIN.flipR1], [Lf, 0.026, PIN.flipR1], [0, 0.026, PIN.flipR0]], [0, 0, 1]);
      f.quad([[Lf, 0, -PIN.flipR1], [0, 0, -PIN.flipR0], [0, 0.026, -PIN.flipR0], [Lf, 0.026, -PIN.flipR1]], [0, 0, -1]);
      f.col('#dc2626'); f.quad([[0, 0.008, PIN.flipR0 + 0.001], [Lf, 0.008, PIN.flipR1 + 0.001], [Lf, 0.018, PIN.flipR1 + 0.001], [0, 0.018, PIN.flipR0 + 0.001]], [0, 0, 1]);
      f.col(C.chrome); f.cyl(0, 0, 0.004, 0.026, 0.03, 8);
      f.pop();
      f.endPart();
    });
    // the ball, waiting on the plunger (play/machines/star-pinball.js moves it), and the plunger
    f.col('#d4d8de'); f.part('ball', pinAt(L.rest[0], L.rest[1], PIN.ballR), { kind: 'pinball', ...pu }); f.sph(L.rest[0], S + PIN.ballR, L.rest[1], PIN.ballR, PIN.ballR, PIN.ballR, 12, 8); f.endPart();
    f.part('plunger', pinAt(L.rest[0], 0.6), { kind: 'plunger' });
    f.col(C.chrome); f.rod([L.rest[0], S + 0.012, L.rest[1] + PIN.ballR + 0.002], [L.rest[0], S + 0.012, 0.72], 0.005, 8);
    f.col('#dc2626'); f.sph(L.rest[0], S + 0.012, 0.73, 0.016, 0.016, 0.022, 10, 6);
    f.endPart();
    // the apron over the drain, the glass, the coin door, the flipper buttons
    f.col('#0f172a'); f.box(-0.34, S, PIN.drain + 0.012, L.x, S + 0.03, 0.63);
    f.col('#f472b6', 0, 3); f.box(-0.2, S + 0.03, PIN.drain + 0.03, 0.14, S + 0.032, PIN.drain + 0.034);
    f.col(C.chrome); f.box(-0.37, S + 0.06, -0.66, -0.335, S + 0.066, 0.66); f.box(0.335, S + 0.06, -0.66, 0.37, S + 0.066, 0.66); f.box(-0.37, S + 0.06, 0.625, 0.37, S + 0.066, 0.66);   // (the glass's frame: no pane, so the playfield's colours read)
    f.col('#e2e8f0', 0, 1); f.box(-0.3, 0.06, 0.66, -0.2, 0.15, 0.67); f.box(0.2, 0.06, 0.66, 0.3, 0.15, 0.67);
    f.col('#facc15'); f.box(-0.375, 0.13, 0.48, -0.37, 0.17, 0.53); f.box(0.37, 0.13, 0.48, 0.375, 0.17, 0.53);
    f.pop();
    // the backbox: the score display (Star Pinball's score on it) and the backglass over it
    f.tint(); f.box(-0.37, 0.88, -0.68, 0.37, 1.95, -0.52);
    const D = PIN.screen;
    screen(f, D.x0, D.y0, D.x1, D.y1, D.z - 0.005, '#1a0f05');
    f.col('#2e1065', 0, 1); f.box(-0.32, 1.48, -0.522, 0.32, 1.9, -0.519);
    neonText(f, 'PINBALL', 0, 1.53, -0.517, 0.085, '#f472b6');
    const st = Array.from({ length: 10 }, (_, k) => { const a = -H + (k * P) / 5, r = k % 2 ? 0.035 : 0.085; return [Math.cos(a) * r, 1.765 - Math.sin(a) * r]; });
    neonLine(f, st, -0.517, '#facc15');
    chaseBulbs(f, -0.33, 0.33, 1.92, -0.52, 0.066);
  };
  D.racing_sim = f => {
    f.col('#15171b'); f.box(-0.55, 0, -0.95, 0.55, 0.12, 0.95);
    f.col('#22d3ee', 0, 6); f.box(-0.56, 0.02, -0.96, 0.56, 0.05, 0.96, 't');
    f.tint(); f.box(-0.25, 0.12, 0.25, 0.25, 0.4, 0.62);
    f.col(C.black); f.box(-0.24, 0.4, 0.22, 0.24, 0.48, 0.66);
    f.push(0, 0.46, 0.7); tilt(f, -0.32); f.col(C.black); f.box(-0.25, 0, -0.06, 0.25, 0.72, 0.06); f.tint(); f.box(-0.18, 0.08, 0.06, 0.18, 0.62, 0.075); f.pop();
    f.col('#3f3f46'); f.box(-0.12, 0.12, -0.45, 0.12, 0.2, -0.25); f.col(C.chrome); f.box(-0.1, 0.2, -0.38, -0.02, 0.22, -0.3); f.box(0.02, 0.2, -0.38, 0.1, 0.22, -0.3);
    f.col(C.dark); f.box(-0.08, 0.12, -0.12, 0.08, 0.72, 0.0);
    f.part('wheel', [0, 0.82, 0.02], { kind: 'wheel', axis: [0, -Math.sin(1.1), Math.cos(1.1)], user: [0, 0.42], clip: 'drive' });   // (turned by the driver: shared/arcade-motion.js steer)
    f.push(0, 0.82, 0.02); tilt(f, -1.1);
    const wr = Array.from({ length: 16 }, (_, k) => [Math.sin(k / 16 * TAU) * 0.15, 0, Math.cos(k / 16 * TAU) * 0.15]);
    f.col('#111'); for (let k = 0; k < 16; k++) f.rod(wr[k], wr[(k + 1) % 16], 0.016, 5);
    f.rod([-0.15, 0, 0], [0.15, 0, 0], 0.012, 4); f.col('#ef4444'); f.cyl(0, 0, 0.035, -0.01, 0.02, 10);
    f.pop();
    f.endPart();
    f.tint(); f.box(-0.55, 0.12, -0.95, -0.48, 1.85, -0.3); f.box(0.48, 0.12, -0.95, 0.55, 1.85, -0.3); f.box(-0.55, 1.62, -0.95, 0.55, 1.85, -0.3);
    f.col(C.dark); f.box(-0.48, 0.12, -0.95, 0.48, 1.62, -0.5);
    screen(f, -0.44, 0.78, 0.44, 1.56, -0.48, '#1e3a8a');
    f.col('#fb923c', 0, 1); f.box(-0.44, 0.78, -0.477, 0.44, 1.02, -0.476);
    f.col('#475569', 0, 1); f.push(0, 0, -0.475); f.quad([[-0.32, 0.78, 0], [0.32, 0.78, 0], [0.05, 1.12, 0], [-0.05, 1.12, 0]], [0, 0, 1]); f.pop();
    f.col('#f8fafc', 0, 1); for (let i = 0; i < 4; i++) f.box(-0.008, 0.8 + i * 0.08, -0.4745, 0.008, 0.84 + i * 0.08, -0.4743);
    f.col('#ef4444', 0, 1); f.box(-0.07, 0.82, -0.4742, 0.07, 0.88, -0.474);
    f.col('#f472b6', 0, 3); f.box(-0.555, 1.85, -0.95, 0.555, 1.87, -0.3); chaseBulbs(f, -0.5, 0.5, 1.74, -0.3, 0.1);
  };
  D.dance_machine = f => {
    f.col('#1b1b22'); f.box(-1.0, 0, -0.1, 1.0, 0.12, 1.0);
    const arrow = ['#f472b6', '#22d3ee', '#22d3ee', '#f472b6'];
    for (const cx of [-0.45, 0.45]) {
      f.col('#0b0c10'); f.box(cx - 0.42, 0.12, 0.02, cx + 0.42, 0.13, 0.86);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const x = cx + (i - 1) * 0.27, z = 0.44 + (j - 1) * 0.27, center = i === 1 && j === 1, corner = i !== 1 && j !== 1;
        if (corner) { f.col('#2a2d38'); f.box(x - 0.12, 0.13, z - 0.12, x + 0.12, 0.14, z + 0.12); continue; }
        if (center) { f.col('#3f3f46'); f.box(x - 0.12, 0.13, z - 0.12, x + 0.12, 0.14, z + 0.12); continue; }
        f.col(arrow[(i + j * 3) % 4], 0, 4); f.box(x - 0.12, 0.13, z - 0.12, x + 0.12, 0.145, z + 0.12);
      }
      f.col(C.chrome); f.rod([cx - 0.38, 0.12, 0.92], [cx - 0.38, 0.95, 0.92], 0.018, 6); f.rod([cx + 0.38, 0.12, 0.92], [cx + 0.38, 0.95, 0.92], 0.018, 6); f.rod([cx - 0.38, 0.95, 0.92], [cx + 0.38, 0.95, 0.92], 0.018, 6);
    }
    f.tint(); f.box(-0.95, 0, -1.0, 0.95, 2.4, -0.12);
    screen(f, -0.68, 1.05, 0.68, 1.95, -0.12, '#3b0764');
    f.col('#22d3ee', 0, 4); for (let i = 0; i < 6; i++) f.box(-0.6 + i * 0.22, 1.12, -0.117, -0.46 + i * 0.22, 1.2 + (i % 3) * 0.12, -0.114);
    f.col(C.black); for (const x of [-0.82, 0.82]) { f.box(x - 0.12, 0.3, -0.125, x + 0.12, 0.95, -0.11); f.col('#f472b6', 0, 4); f.cyl(x, -0.105, 0.08, 0.5, 0.52, 14); f.col(C.black); }
    f.col('#fef08a', 0, 3); f.box(-0.8, 2.1, -0.118, 0.8, 2.3, -0.112);
    chaseBulbs(f, -0.9, 0.9, 2.36, -0.12, 0.1);
  };
  D.whack_mole = f => {
    f.tint(); f.box(-0.5, 0, -0.4, 0.5, 0.82, 0.55);
    f.col('#facc15'); f.box(-0.5, 0.82, -0.4, 0.5, 0.86, 0.55);
    f.col('#22d3ee', 0, 3); f.box(-0.505, 0.6, -0.4, 0.505, 0.63, 0.555);
    const holes = WHACK.holes;   // (shared/arcade/machines.js: where Mole Mayhem's moles come up)
    holes.forEach(([x, z], i) => {
      f.col('#111'); f.cyl(x, z, 0.085, 0.86, 0.862, 14);
      // the mole, drawn all the way up: it pops up and ducks (render/venue-motion.js 'mole', with the player's whacks)
      const up = 0.1;
      f.part(`mole${i}`, [x, 0.86, z], { kind: 'mole', idx: i, user: [0, 0.85], clip: 'whack' });
      f.col('#8b5a2b'); f.sph(x, 0.86 + up, z, 0.07, 0.07 + up * 0.5, 0.07, 10, 6, { cut: -0.3 });
      f.col('#111'); for (const s of [-1, 1]) f.sph(x + s * 0.025, 0.9 + up, z + 0.06, 0.012, 0.012, 0.008, 5, 3); f.col('#f9a8d4'); f.sph(x, 0.885 + up, z + 0.068, 0.016, 0.012, 0.01, 6, 4);
      f.endPart();
    });
    f.part('mallet', [0.2, 0.875, 0.43], { kind: 'parked', user: [0, 0.85], clip: 'whack' });
    f.col('#7c2d12'); f.rod([0.32, 0.875, 0.45], [0.05, 0.875, 0.4], 0.016, 6); f.col('#ef4444'); f.push(0.36, 0.89, 0.45); f.m.multiply(new THREE.Matrix4().makeRotationZ(H)); f.cyl(0, 0, 0.055, -0.07, 0.07, 12); f.pop();
    f.endPart();
    f.tint(); f.box(-0.5, 0.86, -0.55, 0.5, 1.65, -0.4);
    screen(f, -0.4, 1.1, 0.4, 1.55, -0.4, '#14532d');
    f.col('#8b5a2b', 0, 1); f.sph(-0.12, 1.3, -0.395, 0.09, 0.1, 0.005, 10, 6); f.col('#facc15', 0, 3); for (let i = 0; i < 3; i++) f.box(0.08 + i * 0.09, 1.38, -0.396, 0.15 + i * 0.09, 1.48, -0.393);
    chaseBulbs(f, -0.46, 0.46, 1.6, -0.4, 0.08);
  };
  D.boxer = f => {
    f.col(C.dark); f.box(-0.42, 0, -0.42, 0.42, 0.18, 0.42);
    f.tint(); f.box(-0.32, 0.18, -0.42, 0.32, 2.2, -0.12);
    screen(f, -0.25, 1.75, 0.25, 2.1, -0.12, '#1c0606');
    f.col('#ef4444', 0, 3); for (let i = 0; i < 3; i++) f.box(-0.19 + i * 0.13, 1.81, -0.117, -0.09 + i * 0.13, 2.04, -0.114);
    f.part('bag', [0, 1.4, -0.12], { kind: 'bag', user: [0, 0.8], clip: 'punch' });   // (the ball on its arm: knocked up by a punch)
    f.col(C.chrome); f.box(-0.04, 1.36, -0.12, 0.04, 1.44, 0.12);
    f.col('#dc2626'); f.sph(0, 1.4, 0.22, 0.16, 0.18, 0.1, 12, 8);
    f.col('#facc15', 0, 3); f.lathe(0, 0.32, [[0.13, 1.4], [0.15, 1.4], [0.15, 1.42], [0.13, 1.42]], 16);
    f.endPart();
    f.col('#f472b6', 0, 6); f.box(-0.325, 0.4, -0.13, -0.315, 1.7, -0.11); f.box(0.315, 0.4, -0.13, 0.325, 1.7, -0.11);
    f.col('#e11d48'); f.sph(0.22, 0.95, 0.0, 0.08, 0.1, 0.07, 10, 6); f.sph(-0.22, 0.95, 0.0, 0.08, 0.1, 0.07, 10, 6);
    chaseBulbs(f, -0.28, 0.28, 2.16, -0.12, 0.07);
  };
  D.foosball = f => {
    const T = FOOS.top, Y = FOOS.rodY;   // (shared/arcade/machines.js: the field, rods and men Foos Frenzy plays with)
    f.col(C.black); for (const [x, z] of [[-0.3, -0.6], [0.3, -0.6], [-0.3, 0.6], [0.3, 0.6]]) f.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.62, z + 0.04);
    f.tint(); f.box(-0.38, 0.62, -0.72, 0.38, 0.92, -FOOS.hl); f.box(-0.38, 0.62, FOOS.hl, 0.38, 0.92, 0.72);
    f.box(-0.38, 0.62, -FOOS.hl, -FOOS.hw, 0.92, FOOS.hl); f.box(FOOS.hw, 0.62, -FOOS.hl, 0.38, 0.92, FOOS.hl); f.box(-FOOS.hw, 0.62, -FOOS.hl, FOOS.hw, T - 0.01, FOOS.hl);
    f.col('#15803d'); f.box(-FOOS.hw, T - 0.01, -FOOS.hl, FOOS.hw, T, FOOS.hl);
    f.col(C.white); f.box(-FOOS.hw, T, -0.004, FOOS.hw, T + 0.002, 0.004); f.lathe(0, 0, [[0.09, T], [0.1, T], [0.1, T + 0.002], [0.09, T + 0.002]], 18);
    for (const zs of [-1, 1]) { f.box(-0.2, T, zs * (FOOS.hl - 0.12) - 0.002, 0.2, T + 0.002, zs * (FOOS.hl - 0.12) + 0.002); for (const x of [-0.2, 0.2]) f.box(x - 0.002, T, zs > 0 ? FOOS.hl - 0.12 : -FOOS.hl, x + 0.002, T + 0.002, zs > 0 ? FOOS.hl : -FOOS.hl + 0.12); }
    f.col(C.black); f.box(-FOOS.goal, T - 0.05, -0.72, FOOS.goal, 0.9, -FOOS.hl); f.box(-FOOS.goal, T - 0.05, FOOS.hl, FOOS.goal, 0.9, 0.72);
    FOOS.rods.forEach((z, i) => {
      const red = FOOS.red[i], x1 = red ? 0.62 : -0.62, x0 = -x1;
      // (each rod a part, turned and slid by the player on its side: the two in their hands as they twist them)
      const hand = { 3: 'R', 5: 'L', 4: 'R', 2: 'L' }[i] || null;
      f.part(`rod${i}`, [0, Y, z], { kind: 'rod', user: [red ? 0.88 : -0.88, 0], clip: 'foos', hand, dir: red ? -1 : 1 });
      f.col(C.chrome); f.rod([x0 * 0.62, Y, z], [x1, Y, z], 0.008, 6);
      f.col('#111'); f.rod([x1 * 0.85, Y, z], [x1, Y, z], 0.022, 8);
      for (const x of foosMen(i).xs) {   // a man: head, shoulders round the rod, body, the foot down to the ball
        f.col('#f2c9a0'); f.sph(x, Y + 0.042, z, 0.013, 0.014, 0.013, 8, 6);
        f.col(red ? '#dc2626' : '#2563eb'); f.box(x - 0.016, Y - 0.014, z - 0.011, x + 0.016, Y + 0.028, z + 0.011);
        f.box(x - 0.012, Y - 0.04, z - 0.009, x + 0.012, Y - 0.014, z + 0.009);
        f.col(C.black); f.box(x - FOOS.manW, Y - FOOS.foot, z - FOOS.manD, x + FOOS.manW, Y - 0.04, z + FOOS.manD);
      }
      f.endPart();
    });
    // the score panel on the far side, facing the red player (Foos Frenzy's score on it)
    const B = FOOS.sign;
    f.col(C.black); f.box(-0.4, 0.92, B.cz + B.x0 - 0.04, -0.37, B.y1 + 0.03, B.cz + B.x1 + 0.04);
    f.col('#0b1120', 0, 1); f.box(-0.37, B.y0, B.cz + B.x0, -0.367, B.y1, B.cz + B.x1);
    f.col('#ef4444', 0, 3); f.box(-0.395, B.y1 + 0.03, B.cz + B.x0 - 0.035, -0.375, B.y1 + 0.04, B.cz); f.col('#3b82f6', 0, 3); f.box(-0.395, B.y1 + 0.03, B.cz, -0.375, B.y1 + 0.04, B.cz + B.x1 + 0.035);
    f.col('#facc15', 0, 6); f.box(-0.385, 0.64, -0.725, 0.385, 0.66, 0.725, 't');
  };
  D.photo_booth = f => {
    f.tint(); f.box(-0.65, 0, -0.6, 0.65, 2.1, -0.52); f.box(-0.65, 0, -0.52, -0.57, 2.1, 0.45); f.box(0.57, 0, -0.52, 0.65, 2.1, 0.45); f.box(-0.65, 1.95, -0.52, 0.65, 2.1, 0.45);
    f.box(-0.65, 0, 0.37, 0.0, 1.95, 0.45);
    f.col('#7f1d1d'); for (let i = 0; i < 6; i++) f.box(0.0 + i * 0.095, 0.08, 0.38 + (i % 2) * 0.02, 0.09 + i * 0.095, 1.94, 0.42 + (i % 2) * 0.02);
    f.col(C.chrome); f.rod([0.0, 1.94, 0.4], [0.57, 1.94, 0.4], 0.01, 5);
    f.col(C.dark); f.box(-0.57, 0, -0.52, 0.57, 0.02, 0.37); screen(f, -0.25, 1.15, 0.25, 1.5, -0.51, '#1e293b');
    f.col(C.black); f.cyl(-0.1, -0.15, 0.17, 0.0, 0.03, 12); f.col(C.chrome); f.cyl(-0.1, -0.15, 0.025, 0.03, 0.45, 8); f.col('#dc2626'); f.cyl(-0.1, -0.15, 0.17, 0.45, 0.5, 14);
    f.col(C.white, 0, 1); f.box(-0.5, 0.95, 0.451, -0.2, 1.75, 0.455);
    ['#f472b6', '#22d3ee', '#facc15', '#a78bfa'].forEach((c, i) => { f.col(c, 0, 1); f.box(-0.47, 1.55 - i * 0.19, 0.455, -0.23, 1.72 - i * 0.19, 0.457); });
    f.col(C.black); f.box(-0.5, 2.1, -0.1, 0.5, 2.3, 0.0);
    neonLine(f, [[-0.12, 2.14], [0.12, 2.14], [0.12, 2.27], [-0.12, 2.27]], 0.01, '#f472b6', 0.009);
    neonLine(f, ring(0, 2.205, 0.045, 12), 0.01, '#22d3ee', 0.008);
  };
  // ---------------------------------------------------------------- the prize corner, the snack bar
  D.prize_case = f => {
    f.tint(); f.box(-0.75, 0, -0.32, 0.75, 0.55, 0.32);
    f.col('#facc15', 0, 3); f.box(-0.755, 0.5, 0.32, 0.755, 0.53, 0.325);
    f.col('#fef9c3', 0, 1); f.box(-0.72, 0.55, -0.29, 0.72, 0.56, 0.29);
    for (let i = 0; i < 9; i++) plush(f, -0.6 + i * 0.15, 0.56, (i % 2 ? -0.1 : 0.08), 0.75, PLUSH[(i * 3) % PLUSH.length]);
    f.col('#38bdf8'); f.sph(-0.35, 0.85, 0.12, 0.06, 0.06, 0.06, 8, 5); f.col('#facc15'); f.box(0.3, 0.56, 0.05, 0.42, 0.68, 0.17);
    f.glass('#e0f2fe'); f.box(-0.74, 0.55, -0.31, 0.74, 1.08, 0.31, 'b');
    f.col(C.chrome); for (const [x, z] of [[-0.74, -0.31], [0.74, -0.31], [-0.74, 0.31], [0.74, 0.31]]) f.box(x - 0.012, 0.55, z - 0.012, x + 0.012, 1.1, z + 0.012);
  };
  D.prize_wall = f => {
    f.tint(); f.box(-1.2, 0, -0.22, 1.2, 2.4, -0.16); f.box(-1.2, 0, -0.22, -1.15, 2.4, 0.2); f.box(1.15, 0, -0.22, 1.2, 2.4, 0.2);
    f.col('#f472b6', 0, 3); f.box(-1.205, 2.38, -0.22, 1.205, 2.41, 0.21); f.box(-1.205, 0, 0.2, -1.195, 2.4, 0.21); f.box(1.195, 0, 0.2, 1.205, 2.4, 0.21);
    let k = 0;
    for (const y of [0.05, 0.5, 0.95, 1.4]) {
      f.col('#e8e1d5'); f.box(-1.15, y, -0.16, 1.15, y + 0.03, 0.2);
      f.col('#fde68a', 0, 1); f.box(-1.15, y + 0.03, 0.19, 1.15, y + 0.045, 0.2);
      for (let x = -1.0; x <= 1.01; x += 0.25) { plush(f, x, y + 0.03, 0.02, y < 1 ? 0.95 : 1.1, PLUSH[k % PLUSH.length]); k++; }
    }
    f.col('#e8e1d5'); f.box(-1.15, 1.85, -0.16, 1.15, 1.88, 0.2);
    plush(f, 0, 1.88, 0.0, 1.6, '#a16207'); plush(f, -0.7, 1.88, 0.0, 1.3, '#f472b6'); plush(f, 0.7, 1.88, 0.0, 1.3, '#60a5fa');
  };
  D.token_machine = f => {
    f.tint(); f.box(-0.34, 0, -0.28, 0.34, 1.6, 0.22);
    screen(f, -0.2, 1.0, 0.2, 1.3, 0.22, '#0c4a6e');
    f.col('#facc15', 0, 1); f.lathe(0, 0.225, [[0.06, 1.13], [0.07, 1.13], [0.07, 1.17], [0.06, 1.17]], 16);
    f.col(C.black); f.box(-0.12, 0.8, 0.22, 0.12, 0.86, 0.24); f.col(C.chrome); f.box(-0.15, 0.4, 0.22, 0.15, 0.5, 0.28); f.col('#111'); f.box(-0.12, 0.41, 0.24, 0.12, 0.49, 0.285);
    f.col('#facc15'); for (let i = 0; i < 4; i++) f.cyl(-0.06 + i * 0.04, 0.26, 0.016, 0.415, 0.42, 10);
    f.col(C.dark); f.box(-0.34, 1.6, -0.28, 0.34, 1.85, 0.22);
    neonLine(f, ring(0, 1.725, 0.085, 16), 0.235, '#facc15', 0.012);
    f.col('#facc15', 0, 3); f.box(-0.02, 1.68, 0.23, 0.02, 1.77, 0.235);
    f.col('#22d3ee', 0, 3); f.box(-0.345, 0.3, 0.2, -0.335, 1.55, 0.225); f.box(0.335, 0.3, 0.2, 0.345, 1.55, 0.225);
  };
  D.snack_bar = f => {
    f.tint(); f.box(-1.6, 0, 0.1, 1.6, 1.02, 0.55);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 3; j++) { f.col((i + j) % 2 ? '#111' : C.white); f.box(-1.6 + i * 0.2, 0.15 + j * 0.2, 0.55, -1.4 + i * 0.2, 0.35 + j * 0.2, 0.555); }
    f.col('#fb923c', 0, 3); f.box(-1.6, 0.97, 0.55, 1.6, 1.0, 0.565);
    f.col('#f1f0ec'); f.box(-1.65, 1.02, 0.05, 1.65, 1.06, 0.6);
    f.col(C.dark); f.box(-1.6, 0, -0.6, 1.6, 0.92, -0.3);
    f.col('#7f1d1d'); f.box(-1.4, 0.92, -0.55, -0.85, 1.0, -0.3);
    f.glass('#fff7d6'); f.box(-1.38, 1.0, -0.53, -0.87, 1.45, -0.32); f.col('#dc2626'); f.box(-1.4, 1.45, -0.55, -0.85, 1.52, -0.3);
    f.col('#fde68a', 0, 1); for (let i = 0; i < 26; i++) f.sph(-1.33 + (i % 7) * 0.07, 1.02 + Math.floor(i / 7) * 0.05, -0.5 + (i % 3) * 0.08, 0.025, 0.022, 0.025, 5, 3);
    f.col('#cbd5e1'); f.box(-0.4, 0.92, -0.55, 0.4, 1.35, -0.32); f.col('#111'); for (let i = 0; i < 4; i++) f.box(-0.3 + i * 0.2 - 0.03, 1.05, -0.32, -0.3 + i * 0.2 + 0.03, 1.12, -0.29);
    ['#dc2626', '#16a34a', '#2563eb', '#f59e0b'].forEach((c, i) => { f.col(c, 0, 1); f.box(-0.33 + i * 0.2, 1.22, -0.32, -0.27 + i * 0.2, 1.3, -0.318); });
    f.col(C.white); for (let i = 0; i < 4; i++) f.cyl(0.8 + i * 0.12, -0.42, 0.04, 0.92, 1.12 - (i % 2) * 0.05, 10);
    f.col(C.black); f.box(-1.55, 1.55, -0.6, 1.55, 2.38, -0.52);
    f.col('#111827', 0, 1); f.box(-1.5, 1.6, -0.52, 1.5, 2.33, -0.518);
    ['#fde68a', '#fca5a5', '#93c5fd', '#86efac', '#f9a8d4', '#fdba74'].forEach((c, i) => { const x = -1.35 + (i % 3) * 0.95, y = 2.12 - Math.floor(i / 3) * 0.3; f.col(c, 0, 1); f.box(x, y, -0.517, x + 0.22, y + 0.14, -0.515); f.col('#f8fafc', 0, 1); f.box(x + 0.28, y + 0.05, -0.517, x + 0.7, y + 0.09, -0.515); });
    f.col('#f472b6', 0, 3); f.box(-1.555, 2.36, -0.53, 1.555, 2.39, -0.51); f.box(-1.555, 1.55, -0.53, 1.555, 1.58, -0.51);
    f.col(C.dark); f.box(1.05, 1.06, 0.2, 1.4, 1.22, 0.45); f.col('#22c55e', 0, 1); f.box(1.08, 1.12, 0.45, 1.37, 1.2, 0.452);
  };
  // ---------------------------------------------------------------- seats and tables
  D.neon_booth = f => {
    f.col(C.black); f.box(-1.1, 0, -0.85, 1.1, 0.12, -0.35); f.box(-1.15, 0, -0.35, -0.65, 0.12, 0.6); f.box(0.65, 0, -0.35, 1.15, 0.12, 0.6);
    f.col('#22d3ee', 0, 6); f.box(-1.105, 0.03, -0.355, 1.105, 0.06, -0.345); f.box(-0.655, 0.03, -0.35, -0.645, 0.06, 0.6); f.box(0.645, 0.03, -0.35, 0.655, 0.06, 0.6);
    f.tint(); f.box(-1.1, 0.12, -0.75, 1.1, 0.45, -0.3); f.box(-1.15, 0.12, -0.3, -0.62, 0.45, 0.6); f.box(0.62, 0.12, -0.3, 1.15, 0.45, 0.6);
    f.box(-1.1, 0.45, -0.85, 1.1, 1.2, -0.66); f.box(-1.15, 0.45, -0.66, -0.98, 1.2, 0.6); f.box(0.98, 0.45, -0.66, 1.15, 1.2, 0.6);
    f.col('#0b0b0f'); for (let x = -0.9; x <= 0.91; x += 0.3) f.box(x - 0.01, 0.5, -0.665, x + 0.01, 1.15, -0.655);
    f.col(C.chrome); f.box(-1.1, 1.2, -0.85, 1.1, 1.22, -0.66); f.box(-1.15, 1.2, -0.66, -0.98, 1.22, 0.6); f.box(0.98, 1.2, -0.66, 1.15, 1.22, 0.6);
    f.col(C.chrome); f.cyl(0, 0.08, 0.2, 0, 0.03, 16); f.cyl(0, 0.08, 0.04, 0.03, 0.72, 10);
    f.col('#f8fafc'); f.cyl(0, 0.08, 0.45, 0.72, 0.76, 22); f.col('#f472b6', 0, 6); f.lathe(0, 0.08, [[0.45, 0.72], [0.46, 0.72], [0.46, 0.76], [0.45, 0.76]], 22);
    f.col('#facc15'); f.cyl(0.12, 0.0, 0.04, 0.76, 0.86, 10); f.col('#dc2626'); f.cyl(-0.15, 0.18, 0.045, 0.76, 0.8, 12);
  };
  D.hightop_table = f => {
    f.col(C.chrome); f.cyl(0, 0, 0.24, 0, 0.03, 16); f.cyl(0, 0, 0.04, 0.03, 1.02, 10);
    f.col('#18181b'); f.cyl(0, 0, 0.36, 1.02, 1.06, 22); f.col('#ffffff', 1, 3); f.lathe(0, 0, [[0.36, 1.02], [0.372, 1.02], [0.372, 1.06], [0.36, 1.06]], 22);
    f.col('#facc15', 0, 3); f.cyl(0, 0, 0.03, 1.06, 1.08, 8);
    for (const [x, z] of [[0, -0.52], [0.45, 0.26], [-0.45, 0.26]]) barStool(f, x, z);
  };
  D.gaming_chair = f => {
    f.col(C.black); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; f.rod([0, 0.07, 0], [Math.sin(a) * 0.3, 0.05, Math.cos(a) * 0.3], 0.02, 5); f.sph(Math.sin(a) * 0.3, 0.03, Math.cos(a) * 0.3, 0.03, 0.03, 0.03, 6, 4); }
    f.col(C.chrome); f.cyl(0, 0, 0.03, 0.07, 0.42, 8);
    f.col(C.black); f.box(-0.27, 0.42, -0.24, 0.27, 0.5, 0.26); f.tint(); f.box(-0.18, 0.5, -0.2, 0.18, 0.52, 0.24);
    f.push(0, 0.5, -0.26); tilt(f, -0.18);
    f.col(C.black); f.box(-0.28, 0, -0.06, 0.28, 0.85, 0.04); f.tint(); f.box(-0.17, 0.05, 0.04, 0.17, 0.78, 0.06);
    f.col(C.black); f.box(-0.3, 0.55, -0.06, -0.22, 0.85, 0.08); f.box(0.22, 0.55, -0.06, 0.3, 0.85, 0.08);
    f.col('#a855f7', 0, 6); f.box(-0.285, 0.02, 0.04, -0.27, 0.84, 0.05); f.box(0.27, 0.02, 0.04, 0.285, 0.84, 0.05);
    f.pop();
    f.col(C.dark); for (const s of [-1, 1]) { f.box(s * 0.27 - 0.03, 0.5, -0.05, s * 0.27 + 0.03, 0.66, 0.0); f.box(s * 0.27 - 0.035, 0.66, -0.15, s * 0.27 + 0.035, 0.69, 0.15); }
  };
  // ---------------------------------------------------------------- the lights and the walls
  D.giant_joystick = f => {
    f.col(C.black); f.box(-0.72, 0, -0.72, 0.72, 0.45, 0.72);
    f.col('#22d3ee', 0, 6); f.box(-0.725, 0.04, -0.725, 0.725, 0.07, 0.725, 'tb');
    f.tint(); f.box(-0.7, 0.45, -0.7, 0.7, 0.5, 0.7);
    f.col(C.black); f.cyl(-0.15, -0.1, 0.25, 0.5, 0.56, 20); f.col(C.chrome); f.cyl(-0.15, -0.1, 0.06, 0.56, 1.95, 12);
    f.col('#e11d48'); f.sph(-0.15, 2.05, -0.1, 0.32, 0.32, 0.32, 16, 12);
    for (const [x, z, c] of [[0.38, 0.3, '#facc15'], [0.42, -0.25, '#22d3ee'], [-0.35, 0.42, '#4ade80']]) { f.col(C.black); f.cyl(x, z, 0.14, 0.5, 0.53, 16); f.col(c, 0, 3); f.cyl(x, z, 0.11, 0.53, 0.6, 16); }
  };
  D.led_pillar = f => {
    f.col(C.chrome); f.box(-0.24, 0, -0.24, 0.24, 0.12, 0.24); f.box(-0.24, 2.68, -0.24, 0.24, 2.8, 0.24);
    f.col(C.black); f.box(-0.2, 0.12, -0.2, 0.2, 2.68, 0.2);
    f.col('#ffffff', 0, 6); for (let y = 0.2; y < 2.6; y += 0.3) f.box(-0.205, y, -0.205, 0.205, y + 0.22, 0.205, 'tb');
  };
  D.floor_neon = f => { f.col('#ffffff', 1, 3); f.box(-1.0, 0, -0.03, 1.0, 0.024, 0.03); f.col(C.black); f.box(-1.0, 0, -0.05, 1.0, 0.016, 0.05, 'b'); };   // (above the floor's finish: 6 mm up)
  D.neon_arcade = f => {
    backer(f, 2.7, 2.15, 2.95);
    neonText(f, 'ARCADE', 0, 2.33, -0.015, 0.44, '#ff2bd6', 0.017);
    neonLine(f, [[-1.28, 2.2], [1.28, 2.2], [1.28, 2.9], [-1.28, 2.9]], -0.02, '#22d3ee', 0.011);
  };
  D.neon_gameon = f => {
    backer(f, 2.6, 2.2, 2.9);
    neonText(f, 'GAME', -0.4, 2.33, -0.015, 0.42, '#22d3ee', 0.016);
    neonText(f, 'ON', 0.85, 2.33, -0.015, 0.42, '#facc15', 0.016);
  };
  D.neon_prizes = f => {
    backer(f, 2.2, 2.2, 2.85);
    neonText(f, 'PRIZES', 0, 2.32, -0.015, 0.4, '#facc15', 0.016);
    for (const x of [-0.98, 0.98]) neonLine(f, Array.from({ length: 10 }, (_, k) => { const a = k / 10 * TAU - H, r = k % 2 ? 0.05 : 0.11; return [x + Math.cos(a) * r, 2.52 + Math.sin(a) * r]; }), -0.015, '#f472b6', 0.008);
  };
  D.neon_snacks = f => {
    backer(f, 2.2, 2.2, 2.85);
    neonText(f, 'SNACKS', 0, 2.32, -0.015, 0.4, '#fb923c', 0.016);
  };
  D.neon_joystick = f => {
    backer(f, 1.1, 2.05, 2.95);
    neonLine(f, [[-0.38, 2.15], [0.38, 2.15], [0.38, 2.35], [-0.38, 2.35]], -0.015, '#22d3ee', 0.014);
    neonLine(f, [[-0.1, 2.35], [-0.1, 2.62]], -0.015, '#22d3ee', 0.014, false);
    neonLine(f, ring(-0.1, 2.72, 0.11, 16), -0.015, '#f472b6', 0.014);
    neonLine(f, ring(0.2, 2.25, 0.045, 10), -0.015, '#facc15', 0.01);
  };
  D.neon_invader = f => {
    backer(f, 1.2, 2.15, 2.9);
    const map = ['...XXXXX...', '.XXXXXXXXX.', 'XX.XXXXX.XX', 'XXXXXXXXXXX', '..X..X..X..', '.X.X...X.X.'], s = 0.085;
    map.forEach((row, r) => [...row].forEach((ch, c) => { if (ch !== 'X') return; const x = (c - 5) * s, y = 2.78 - r * s; f.col('#4ade80', 0, 3); f.box(x - s * 0.42, y - s * 0.42, -0.02, x + s * 0.42, y + s * 0.42, -0.012); }));
  };
  D.pixel_mural = f => pixelPanel(f, SPACE, 2.4, 1.15, 2.9);
  D.pixel_mural_maze = f => pixelPanel(f, MAZE, 2.4, 1.15, 2.9);
}
