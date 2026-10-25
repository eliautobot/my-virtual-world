// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The night club's furniture (Floor Themes' club, 2026-10-23: "a big DJ booth in the center, like a center stage, dance
// floor all around ... sort of like a lounge with tables and booths, larger tables for big parties ... a big bar ...
// lights, lasers, speakers ... make the night club fun and really pretty to look at. Think of high end Miami beach
// clubs"): the DJ's round stage under a ring of moving lights, a mirror ball and lasers; LED dance floors round it; a
// long backlit onyx bar; VIP booths with champagne and sparklers; party tables; line-array speakers; light towers; laser
// bars; an LED video wall; go-go podiums; neon (a palm over MIAMI, VIP); royal palms; velvet ropes. Item-local frame as
// render/furniture.js: +z the front, y up; the sizes match shared/catalog.js. Light: col(hex, tint, emit): 1 a soft
// glow, 3 bright, 4 a pulse, 5 sparkle, 8 deep colours slowly cycling, 9 a flash on every beat of the music playing on
// the floor, 10 tiles lit a few at a time with the beat; glass with emit 7 (glow) is light in the air after dark.
// Moving parts (f.part: render/venue-motion.js moves them with the music): the moving heads (kind 'head': its beam's
// rest direction), the mirror ball and the light it throws, the lasers' fans, the decks' platters, the speakers' cones.
import * as THREE from 'three';
import { band, pad, barStool, diningChair, prism } from './furniture-lounge.js';
import { neonText, neonLine } from './furniture-arcade.js';

const TAU = Math.PI * 2, P = Math.PI, H = Math.PI / 2;
const C = { black: '#141418', gloss: '#0d0d12', white: '#f3f0ea', gold: '#c9a227', chrome: '#d4d8de', steel: '#6f757e', marble: '#1c1b20', pink: '#ff2bd6', cyan: '#00e5ff', violet: '#8b5cf6', amber: '#ffb347', green: '#39ff6a' };
const glow = (f, hex) => { f.glass(hex); f.c[3] = 14; };   // (seen only after dark: render/mats.js emit 7)
const rotX = (f, a) => { f.m.multiply(new THREE.Matrix4().makeRotationX(a)); };
const seeded = k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; };
/** A cone of light from p, its axis toward q, opening to radius r at q (a beam: seen after dark). */
function beam(f, p, q, r, hex) {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], L = Math.hypot(dx, dy, dz);
  const c = new THREE.Color(hex).multiplyScalar(0.5);   // (a beam is faint: light in the haze, not a solid)
  glow(f, '#' + c.getHexString()); f.push(p[0], p[1], p[2]);
  f.m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx / L, dy / L, dz / L))));
  f.lathe(0, 0, [[0.04, 0], [r, -L], [0.01, -L]], 16); f.pop();
}
/** A moving head on a yoke at (x, y, z), aimed at a point: its lens lit, its beam. The head and its beam are a part
 *  (`name`) that turns about the head's middle: the show (render/venue-motion.js). */
function movingHead(f, x, y, z, aim, hex, name) {
  f.col(C.black); f.box(x - 0.13, y, z - 0.05, x + 0.13, y + 0.05, z + 0.05); f.box(x - 0.13, y - 0.22, z - 0.03, x - 0.1, y, z + 0.03); f.box(x + 0.1, y - 0.22, z - 0.03, x + 0.13, y, z + 0.03);
  const dx = aim[0] - x, dy = aim[1] - (y - 0.16), dz = aim[2] - z, L = Math.hypot(dx, dy, dz);
  f.part(name, [x, y - 0.16, z], { kind: 'head', dir: [dx / L, dy / L, dz / L] });
  f.col('#1b1b20'); f.sph(x, y - 0.16, z, 0.1, 0.11, 0.1, 10, 7);
  f.col(hex, 0, 3); f.sph(x + dx / L * 0.09, y - 0.16 + dy / L * 0.09, z + dz / L * 0.09, 0.045, 0.045, 0.045, 8, 5);
  beam(f, [x, y - 0.16, z], aim, 0.42, hex);
  f.endPart();
}
/** A truss: two rails between a and b, a zigzag between them (chrome). */
function truss(f, a, b, off) {
  const n = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.35));
  const A = [a, [a[0] + off[0], a[1] + off[1], a[2] + off[2]]], B = [b, [b[0] + off[0], b[1] + off[1], b[2] + off[2]]];
  f.col(C.chrome); f.rod(A[0], B[0], 0.022, 6); f.rod(A[1], B[1], 0.022, 6);
  for (let i = 0; i < n; i++) { const t0 = i / n, t1 = (i + 1) / n, p = (s, t) => [A[s][0] + (B[s][0] - A[s][0]) * t, A[s][1] + (B[s][1] - A[s][1]) * t, A[s][2] + (B[s][2] - A[s][2]) * t]; f.rod(p(0, t0), p(1, t1), 0.011, 4); }
}
/** A flat sector of a ring at height y (an LED tile, a slice of floor). */
function sector(f, ra, rb, a0, a1, y) {
  const m = Math.max(1, Math.ceil((a1 - a0) / 0.14));
  for (let j = 0; j < m; j++) {
    const t0 = a0 + (a1 - a0) * j / m, t1 = a0 + (a1 - a0) * (j + 1) / m;
    f.quad([[Math.sin(t0) * ra, y, Math.cos(t0) * ra], [Math.sin(t0) * rb, y, Math.cos(t0) * rb], [Math.sin(t1) * rb, y, Math.cos(t1) * rb], [Math.sin(t1) * ra, y, Math.cos(t1) * ra]], [0, 1, 0]);
  }
}
/** The LED dance floor: a raised ring from r0 to r1 round the DJ's stage, its tiles lit by turns (through the colours,
 *  pulsing pink, glossy black), a chrome rim with a white light along it. */
function danceRing(f, r0, r1) {
  const y = 0.1, rings = r1 - r0 > 2.6 ? 3 : 2;
  f.col('#0b0b0f'); f.lathe(0, 0, [[r1, 0], [r1, y - 0.004]], 64); f.lathe(0, 0, [[r0, y - 0.004], [r0, 0]], 48); f.lathe(0, 0, [[r0, y - 0.006], [r1, y - 0.006]], 64);
  for (let i = 0; i < rings; i++) {
    const ra = r0 + (r1 - r0) * i / rings + 0.035, rb = r0 + (r1 - r0) * (i + 1) / rings - 0.035, n = Math.round(TAU * (ra + rb) / 2 / 0.95);
    for (let k = 0; k < n; k++) {
      const a0 = k / n * TAU + 0.025, a1 = (k + 1) / n * TAU - 0.025, m = (i + k) % 3;
      if (m === 0) f.col('#ffffff', 0, 8); else if (m === 1) f.col(['#a3157d', '#0a8fa3', '#5a2aa8'][(k + i) % 3], 0, 10); else f.col('#16161c');
      sector(f, ra, rb, a0, a1, y);
    }
  }
  f.col(C.chrome); f.lathe(0, 0, [[r1, y + 0.012], [r1 + 0.07, y + 0.012], [r1 + 0.07, 0], [r1 + 0.06, 0]], 64);
  f.col('#ffffff', 0, 3); f.lathe(0, 0, [[r1 + 0.071, 0.03], [r1 + 0.078, 0.03], [r1 + 0.078, 0.07], [r1 + 0.071, 0.07]], 64);
}

export function addClubFurniture(D) {
  // ---------------------------------------------------------------- the DJ's stage in the middle
  D.dj_stage = f => {
    f.col('#0a0a0d'); f.cyl(0, 0, 2.2, 0, 0.06, 48);
    f.col(C.white); f.lathe(0, 0, [[2.2, 0.06], [2.3, 0.1], [2.3, 0.5], [2.26, 0.55], [0, 0.55]], 56);
    f.col(C.gold); f.lathe(0, 0, [[2.302, 0.42], [2.31, 0.42], [2.31, 0.46], [2.302, 0.46]], 56);
    f.col('#ffffff', 0, 8); f.lathe(0, 0, [[2.205, 0.02], [2.24, 0.02], [2.24, 0.055], [2.205, 0.055]], 56);
    f.col('#15151a'); f.cyl(0, 0, 2.16, 0.55, 0.556, 48);
    f.col(C.white); f.box(-0.6, 0, -2.78, 0.6, 0.19, -2.25); f.box(-0.6, 0, -2.52, 0.6, 0.37, -2.25);   // (the steps up, at the back)
    // the booth: a curved front lit through the colours round the decks, gold on top; the decks at a working height (about
    // 1.05 m over the stage, where the DJ stands: the clip act_dj's hands), close to the DJ, the laptop off to the side
    const DY = 1.55;
    f.col('#0f0f14'); band(f, 0, -0.35, pad(0.88, 0.55, 1.02, DY + 0.07, 0.02), -1.15, 1.15, 26);
    f.col('#ffffff', 0, 8); band(f, 0, -0.35, pad(1.02, 0.62, 1.034, DY + 0.01, 0.004), -1.1, 1.1, 26);
    f.col(C.gold); band(f, 0, -0.35, pad(0.86, DY + 0.07, 1.05, DY + 0.105, 0.008), -1.17, 1.17, 26);
    f.col('#101015'); band(f, 0, -0.35, pad(0.4, 0.55, 0.87, DY, 0.01), -1.1, 1.1, 26);   // (the desk inside the front; the DJ in its hollow)
    for (const [k, x] of [-0.3, 0.3].entries()) {   // two decks and their jog wheels (turning: parts), the mixer, a laptop
      f.col('#1d1d22'); f.box(x - 0.14, DY, 0.1, x + 0.14, DY + 0.05, 0.4);
      f.part(`jog${k}`, [x, DY + 0.06, 0.25], { kind: 'spin' });
      f.col('#2b2b31'); f.cyl(x, 0.25, 0.11, DY + 0.05, DY + 0.07, 18); f.col(C.cyan, 0, 3); f.lathe(x, 0.25, [[0.112, DY + 0.06], [0.122, DY + 0.06], [0.122, DY + 0.072], [0.112, DY + 0.072]], 18);
      f.col('#d4d8de'); f.box(x - 0.006, DY + 0.07, 0.25, x + 0.006, DY + 0.074, 0.34);   // (a mark on the platter: it is seen to turn)
      f.endPart();
    }
    f.col('#1d1d22'); f.box(-0.14, DY, 0.12, 0.14, DY + 0.07, 0.4); for (let i = 0; i < 8; i++) { f.col(i % 2 ? C.pink : C.green, 0, 9); f.box(-0.12 + i * 0.033, DY + 0.07, 0.33, -0.105 + i * 0.033, DY + 0.08, 0.35); }
    f.push(0.55, DY, 0.0, -0.9); f.col('#c0c4ca'); f.box(-0.15, 0, -0.1, 0.15, 0.01, 0.1); f.push(0, 0.01, -0.1, 0); rotX(f, -0.35); f.box(-0.15, 0, -0.005, 0.15, 0.2, 0.005); f.col('#7dd3fc', 0, 1); f.box(-0.13, 0.02, 0.006, 0.13, 0.18, 0.008); f.pop(); f.pop();
    // the truss: a ring over it all on four legs, eight moving lights, a mirror ball, two lasers
    const TR = 2.0, TY = 3.35, legs = [0.25, 0.75, 1.25, 1.75].map(k => k * P);
    for (const a of legs) truss(f, [Math.sin(a) * TR, 0.55, Math.cos(a) * TR], [Math.sin(a) * TR, TY, Math.cos(a) * TR], [Math.cos(a) * 0.14, 0, -Math.sin(a) * 0.14]);
    for (let k = 0; k < 24; k++) { const a0 = k / 24 * TAU, a1 = (k + 1) / 24 * TAU; truss(f, [Math.sin(a0) * TR, TY, Math.cos(a0) * TR], [Math.sin(a1) * TR, TY, Math.cos(a1) * TR], [0, -0.22, 0]); }
    f.col(C.chrome); f.rod([-TR, TY - 0.11, 0], [TR, TY - 0.11, 0], 0.02, 6); f.rod([0, TY - 0.11, -TR], [0, TY - 0.11, TR], 0.02, 6);
    const cols = [C.pink, C.cyan, C.violet, C.amber];
    for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * TAU; movingHead(f, Math.sin(a) * TR, TY - 0.24, Math.cos(a) * TR, [Math.sin(a + 0.35) * 4.4, 0.1, Math.cos(a + 0.35) * 4.4], cols[k % 4], `head${k}`); }
    f.col(C.chrome); f.cyl(0, 0, 0.008, TY - 0.6, TY - 0.11, 4);
    // the mirror ball (turning), and the specks of light it throws round the room (turning with it: seen after dark)
    f.part('ball', [0, TY - 0.86, 0], { kind: 'ball' });
    f.col('#dfe3ea'); f.sph(0, TY - 0.86, 0, 0.27, 0.27, 0.27, 16, 12);
    const rnd = seeded(31); f.col('#ffffff', 0, 5); for (let i = 0; i < 46; i++) { const u = rnd() * TAU, v = Math.acos(rnd() * 2 - 1); f.box(Math.sin(v) * Math.cos(u) * 0.27 - 0.018, TY - 0.86 + Math.cos(v) * 0.27 - 0.018, Math.sin(v) * Math.sin(u) * 0.27 - 0.018, Math.sin(v) * Math.cos(u) * 0.27 + 0.018, TY - 0.86 + Math.cos(v) * 0.27 + 0.018, Math.sin(v) * Math.sin(u) * 0.27 + 0.018); }
    f.endPart();
    f.part('specks', [0, 0, 0], { kind: 'ball' });
    const r3 = seeded(57);
    for (let i = 0; i < 70; i++) {
      const a = r3() * TAU, r = r3() < 0.75 ? 2.55 + r3() * 1.65 : 6.05 + r3() * 0.9, y = r < 4.3 ? 0.135 : 0.03, s = 0.022 + r3() * 0.02;   // (on the dance floor, on the floor beyond it)
      glow(f, '#e8f4ff'); f.lathe(Math.sin(a) * r, Math.cos(a) * r, [[s, y], [0, y]], 8);   // (a round spot of light)
    }
    f.endPart();
    for (const [sx, hex] of [[-1, C.green], [1, C.cyan]]) {
      const ex = sx * 1.2, ez = 1.6, ey = TY - 0.3;
      f.col(C.black); f.box(ex - 0.12, ey - 0.08, ez - 0.12, ex + 0.12, ey + 0.08, ez + 0.12);
      f.part(sx < 0 ? 'laser0' : 'laser1', [ex, ey, ez + 0.12], { kind: 'laser', side: sx });   // (its fan sweeps the room)
      f.col(hex, 0, 3); f.sph(ex, ey - 0.02, ez + 0.13, 0.025, 0.025, 0.025, 6, 4);
      for (let i = 0; i < 9; i++) { const a = sx * 0.35 + (i - 4) * 0.13; glow(f, hex); f.rod([ex, ey, ez + 0.12], [ex + Math.sin(a) * 9, 0.4 + (i % 3) * 0.5, ez + Math.cos(a) * 9], 0.011, 3); }
      f.endPart();
    }
  };
  D.dance_ring = f => danceRing(f, 2.45, 5.8);
  D.dance_ring_s = f => danceRing(f, 2.45, 4.3);
  // ---------------------------------------------------------------- the bar
  D.club_bar = f => {
    // the back bar: a mirror wall with lit glass shelves of bottles, a pink neon line along its top
    f.col('#0f0f14'); f.box(-3.3, 0, -0.55, 3.3, 2.75, -0.42);
    f.glass('#d9dfe6'); f.box(-3.15, 1.0, -0.42, 3.15, 2.5, -0.41);
    f.col('#15151a'); f.box(-3.3, 0, -0.42, 3.3, 0.95, -0.12); f.col(C.marble); f.box(-3.32, 0.95, -0.44, 3.32, 0.99, -0.1);
    const rnd = seeded(7);
    for (const y of [1.3, 1.72, 2.14]) {
      f.col('#ffe0b0', 0, 1); f.box(-3.1, y - 0.02, -0.41, 3.1, y, -0.2);
      for (let x = -3.0; x < 3.02; x += 0.1 + rnd() * 0.05) { const c = ['#1f4d2c', '#d9c38a', '#6b1f2a', '#e8e8e8', '#c9a227', '#3a2a6b'][Math.floor(rnd() * 6)], h = 0.2 + rnd() * 0.12; f.col(c); f.lathe(x, -0.31, [[0, y], [0.036, y], [0.037, y + h * 0.62], [0.014, y + h * 0.8], [0.012, y + h], [0, y + h]], 7); }
    }
    f.col(C.pink, 0, 3); f.rod([-3.2, 2.62, -0.4], [3.2, 2.62, -0.4], 0.016, 6); glow(f, C.pink); f.rod([-3.2, 2.62, -0.4], [3.2, 2.62, -0.4], 0.045, 6);
    // the bar itself: a backlit onyx front, a black marble top with a gold edge, a gold foot rail, stools
    f.col('#121216'); f.box(-3.2, 0.12, 0.35, 3.2, 1.0, 0.86);
    f.col('#0a0a0d'); f.box(-3.15, 0, 0.4, 3.15, 0.12, 0.84); f.col(C.pink, 0, 3); f.box(-3.15, 0, 0.84, 3.15, 0.014, 0.88);
    f.col(C.amber, 0, 1); f.box(-3.18, 0.14, 0.86, 3.18, 0.98, 0.885);
    const r2 = seeded(19); f.col('#c46a1c', 0, 1); for (let i = 0; i < 26; i++) { const x = -3.1 + r2() * 6.2, y = 0.2 + r2() * 0.7, w = 0.1 + r2() * 0.35; f.push(x, y, 0.886, 0); f.m.multiply(new THREE.Matrix4().makeRotationZ((r2() - 0.5) * 1.2)); f.box(-w, -0.006, 0, w, 0.006, 0.002); f.pop(); }
    f.col(C.marble); f.box(-3.3, 1.0, 0.3, 3.3, 1.07, 1.02); f.col(C.gold); f.box(-3.3, 1.07, 0.98, 3.3, 1.074, 1.02); f.box(-3.3, 0.995, 1.0, 3.3, 1.07, 1.024);
    f.col(C.gold); f.rod([-3.15, 0.22, 1.02], [3.15, 0.22, 1.02], 0.018, 6); for (const x of [-3, -1.5, 0, 1.5, 3]) f.rod([x, 0.22, 1.02], [x, 0.12, 0.88], 0.012, 4);
    for (const x of [-2.2, 0.3, 2.5]) { f.glass('#e8f0f4'); f.lathe(x, 0.6, [[0, 1.07], [0.035, 1.07], [0.008, 1.1], [0.008, 1.18], [0.03, 1.2], [0.035, 1.28], [0, 1.28]], 8); }
    f.col(C.chrome); f.lathe(-0.9, 0.62, [[0, 1.07], [0.11, 1.07], [0.13, 1.3], [0, 1.3]], 14); f.col('#1f4d2c'); f.lathe(-0.9, 0.62, [[0, 1.2], [0.04, 1.2], [0.04, 1.4], [0.015, 1.48], [0, 1.52]], 8);
    for (let i = 0; i < 8; i++) barStool(f, -2.8 + i * 0.8, 1.25, P);
  };
  // ---------------------------------------------------------------- VIP and party seating
  D.vip_booth = f => {
    const t0 = P - 1.65, t1 = P + 1.65;
    f.col('#0c0c10'); band(f, 0, 0, pad(1.3, 0, 1.95, 0.1, 0.01), t0, t1, 40);
    f.tint(); band(f, 0, 0, pad(1.24, 0.1, 1.97, 0.42, 0.05), t0, t1, 40);
    f.tint('#f6f6f6'); band(f, 0, 0, pad(1.2, 0.4, 1.8, 0.5, 0.05), t0, t1, 40);
    f.tint('#e2e2e2'); band(f, 0, 0, pad(1.78, 0.42, 2.06, 1.3, 0.1), t0, t1, 40);
    f.col(C.gold); band(f, 0, 0, pad(1.8, 1.29, 2.06, 1.325, 0.006), t0, t1, 40);
    for (const [y, o] of [[0.66, 0], [0.86, 0.5], [1.06, 0]]) for (let k = 0; k < 18; k++) { const t = t0 + 0.12 + (k + o) / 18 * (t1 - t0 - 0.24); f.col(C.gold); f.sph(Math.sin(t) * 1.775, y, Math.cos(t) * 1.775, 0.014, 0.014, 0.014, 5, 3); }
    // the table: black marble on gold, two ice buckets of champagne, a lit bottle, sparklers, flutes
    const ell = Array.from({ length: 32 }, (_, i) => [Math.sin(i / 32 * TAU) * 0.86, -0.12 + Math.cos(i / 32 * TAU) * 0.5]);
    f.col(C.gold); f.cyl(0, -0.12, 0.3, 0, 0.03, 20); f.cyl(0, -0.12, 0.05, 0.03, 0.6, 10);
    f.col(C.marble); prism(f, ell, 0.6, 0.65, true); f.col(C.gold); prism(f, ell.map(([x, z]) => [x * 1.012, -0.12 + (z + 0.12) * 1.02]), 0.6, 0.605, true);
    for (const x of [-0.42, 0.42]) {
      f.col(C.chrome); f.lathe(x, -0.12, [[0, 0.65], [0.1, 0.65], [0.13, 0.88], [0.11, 0.88], [0, 0.7]], 14);
      for (const [dx, dz, c] of [[-0.03, 0.02, '#1f4d2c'], [0.04, -0.03, '#d9c38a']]) { f.col(c); f.lathe(x + dx, -0.12 + dz, [[0, 0.7], [0.04, 0.7], [0.04, 0.95], [0.015, 1.03], [0, 1.06]], 8); f.col(C.gold); f.cyl(x + dx, -0.12 + dz, 0.016, 0.98, 1.05, 6); }
      f.col('#e8e8e8'); f.rod([x + 0.05, 0.9, -0.1], [x + 0.08, 1.18, -0.08], 0.004, 3); f.col('#fff4c2', 0, 5); f.sph(x + 0.08, 1.2, -0.08, 0.035, 0.035, 0.035, 6, 4); glow(f, '#ffd27a'); f.sph(x + 0.08, 1.2, -0.08, 0.11, 0.11, 0.11, 8, 6);
    }
    f.col('#ffffff', 0, 8); f.lathe(0, -0.12, [[0, 0.65], [0.05, 0.65], [0.05, 0.9], [0.02, 0.98], [0, 1.0]], 10);
    for (const [x, z] of [[-0.6, 0.12], [-0.2, 0.2], [0.2, 0.2], [0.6, 0.12]]) { f.glass('#f2eadc'); f.lathe(x, z, [[0, 0.65], [0.03, 0.65], [0.005, 0.67], [0.005, 0.74], [0.022, 0.76], [0.024, 0.85], [0, 0.85]], 7); }
  };
  D.party_table = f => {
    f.col(C.gold); for (const x of [-1.05, 1.05]) { f.box(x - 0.04, 0, -0.32, x + 0.04, 0.72, -0.28); f.box(x - 0.04, 0, 0.28, x + 0.04, 0.72, 0.32); f.box(x - 0.04, 0.02, -0.32, x + 0.04, 0.06, 0.32); }
    f.col(C.marble); f.box(-1.5, 0.72, -0.48, 1.5, 0.77, 0.48); f.col(C.gold); f.box(-1.505, 0.74, -0.485, 1.505, 0.77, 0.485, 'tb');
    f.col(C.chrome); f.lathe(0, 0, [[0, 0.77], [0.12, 0.77], [0.15, 1.0], [0.13, 1.0], [0, 0.8]], 14);
    for (const [dx, c] of [[-0.04, '#1f4d2c'], [0.05, '#d9c38a']]) { f.col(c); f.lathe(dx, 0.02, [[0, 0.8], [0.04, 0.8], [0.04, 1.05], [0.015, 1.13], [0, 1.16]], 8); }
    for (const x of [-0.9, 0.9]) { f.col('#f4ead8'); f.cyl(x, 0, 0.03, 0.77, 0.86, 10); f.col('#ffb347', 0, 2); f.sph(x, 0.875, 0, 0.012, 0.022, 0.012, 6, 4); f.glass('#f0e6d6'); f.cyl(x, 0, 0.05, 0.77, 0.9, 10, 0.045, false); }
    for (const x of [-1.05, -0.35, 0.35, 1.05]) { diningChair(f, x, 0.85, P); diningChair(f, x, -0.85, 0); }
  };
  // ---------------------------------------------------------------- sound and light
  D.speaker_stack = f => {
    f.col('#141417'); f.box(-0.46, 0, -0.4, 0.46, 0.78, 0.4);
    f.col('#202026'); f.box(-0.42, 0.06, 0.4, 0.42, 0.72, 0.41);
    for (const [k, x] of [-0.2, 0.2].entries()) { f.part(`cone${k}`, [x, 0.39, 0.41], { kind: 'cone' }); f.push(x, 0.39, 0.41, 0); rotX(f, H); f.col('#0c0c0f'); f.cyl(0, 0, 0.17, 0, 0.012, 18); f.col('#2c2c33'); f.cyl(0, 0, 0.07, 0.012, 0.03, 12); f.pop(); f.endPart(); }
    f.col(C.steel); f.box(-0.4, 0.78, -0.3, -0.36, 2.55, -0.26); f.box(0.36, 0.78, -0.3, 0.4, 2.55, -0.26);
    for (let i = 0; i < 5; i++) {
      const y = 0.82 + i * 0.34; f.push(0, y, 0, 0); rotX(f, -0.04 * i);
      f.col('#141417'); f.box(-0.38, 0, -0.32, 0.38, 0.3, 0.28); f.col('#26262c'); f.box(-0.36, 0.02, 0.28, 0.36, 0.28, 0.29); f.col('#38bdf8', 0, 3); f.box(0.3, 0.24, 0.29, 0.33, 0.26, 0.3);
      f.pop();
    }
  };
  D.light_tower = f => {
    f.col('#1a1a1f'); f.box(-0.32, 0, -0.32, 0.32, 0.05, 0.32);
    for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1]]) { f.col(C.chrome); f.rod([x, 0.05, z], [x, 2.85, z], 0.018, 6); }
    for (let i = 0; i < 8; i++) { const y0 = 0.05 + i * 0.35, y1 = y0 + 0.35; f.col(C.chrome); f.rod([-0.1, y0, 0.1], [0.1, y1, 0.1], 0.009, 4); f.rod([0.1, y0, -0.1], [-0.1, y1, -0.1], 0.009, 4); }
    f.col(C.chrome); f.box(-0.5, 2.85, -0.05, 0.5, 2.9, 0.05);
    movingHead(f, -0.38, 2.85, 0.05, [-1.6, 0.1, 4.6], C.violet, 'head0'); movingHead(f, 0.38, 2.85, 0.05, [1.6, 0.1, 4.6], C.cyan, 'head1');
    f.col('#ffffff', 0, 9); f.box(-0.18, 2.62, 0.11, 0.18, 2.74, 0.13); f.col(C.black); f.box(-0.2, 2.6, 0.08, 0.2, 2.76, 0.11);
  };
  D.laser_bar = f => {
    f.col(C.black); f.box(-0.6, 2.5, -0.12, 0.6, 2.66, 0.1);
    for (const [k, [x, hex]] of [[-0.38, C.green], [0, C.cyan], [0.38, C.pink]].entries()) {
      f.part(`fan${k}`, [x, 2.56, 0.1], { kind: 'laser', side: k - 1 });
      f.col(hex, 0, 3); f.sph(x, 2.56, 0.11, 0.025, 0.025, 0.025, 6, 4);
      for (let i = 0; i < 5; i++) { const a = (i - 2) * 0.2 + x * 0.6; glow(f, hex); f.rod([x, 2.56, 0.1], [x + Math.sin(a) * 8, 0.6 + (i % 3) * 0.45, 0.1 + Math.cos(a) * 8], 0.01, 3); }
      f.endPart();
    }
  };
  D.led_wall = f => {
    f.col('#0b0b0e'); f.box(-2.5, 0.45, -0.1, 2.5, 2.95, -0.02);
    const nx = 25, ny = 12, w = 4.8 / nx, h = 2.3 / ny, rnd = seeded(43);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const k = rnd(); if (k < 0.75) f.col('#ffffff', 0, 8); else if (k < 0.9) f.col(['#a3157d', '#0a8fa3', '#5a2aa8'][Math.floor(rnd() * 3)], 0, 10); else f.col('#cfcfcf', 0, 5);
      f.box(-2.4 + i * w + 0.006, 0.55 + j * h + 0.006, -0.02, -2.4 + (i + 1) * w - 0.006, 0.55 + (j + 1) * h - 0.006, -0.012);
    }
    f.col(C.steel); f.box(-2.5, 0.0, -0.1, -2.42, 0.45, -0.04); f.box(2.42, 0.0, -0.1, 2.5, 0.45, -0.04);
  };
  D.go_go_podium = f => {
    f.col('#0a0a0d'); f.cyl(0, 0, 0.48, 0, 0.05, 24);
    f.col(C.white); f.lathe(0, 0, [[0.48, 0.05], [0.52, 0.1], [0.52, 0.82], [0.56, 0.86], [0.56, 0.9], [0, 0.9]], 28);
    f.col('#ff3fc8', 0, 9); f.lathe(0, 0, [[0.522, 0.74], [0.528, 0.74], [0.528, 0.8], [0.522, 0.8]], 28);
    f.col(C.gold); f.lathe(0, 0, [[0.561, 0.86], [0.566, 0.86], [0.566, 0.905], [0.561, 0.905]], 28);
    glow(f, '#7a1466'); f.cyl(0, 0, 0.58, 0.05, 0.85, 20, 0.58, false);
  };
  // ---------------------------------------------------------------- neon, palms, ropes
  D.neon_palm = f => {
    f.col(C.black); for (const [x, y] of [[-0.5, 1.6], [0.5, 1.6], [0, 2.55]]) f.box(x - 0.02, y - 0.02, -0.08, x + 0.02, y + 0.02, -0.02);
    const trunk = Array.from({ length: 9 }, (_, i) => [0.18 * Math.sin(i / 8 * 1.6) - 0.05, 1.55 + i * 0.12]);
    neonLine(f, trunk, -0.02, '#ff4fa3', 0.014, false);
    const top = trunk[8];
    for (const [a, len] of [[-2.4, 0.55], [-1.7, 0.6], [-0.9, 0.5], [0.15, 0.6], [0.85, 0.55], [1.5, 0.5]]) {
      const pts = Array.from({ length: 6 }, (_, i) => { const t = i / 5; return [top[0] + Math.cos(a) * len * t, top[1] + Math.sin(a) * len * t * 0.55 + 0.22 * Math.sin(t * P) - 0.12 * t * t]; });
      neonLine(f, pts, -0.02, '#2ee6c8', 0.013, false);
    }
    neonText(f, 'MIAMI', 0, 1.2, -0.02, 0.24, '#ffb347', 0.014);
  };
  D.neon_vip = f => {
    f.col(C.black); f.box(-0.78, 1.7, -0.08, 0.78, 2.5, -0.05);
    neonText(f, 'VIP', 0, 1.88, -0.03, 0.44, C.gold, 0.018);
    neonLine(f, [[-0.72, 1.76], [0.72, 1.76], [0.72, 2.44], [-0.72, 2.44]], -0.03, C.pink, 0.012);
  };
  D.royal_palm = f => {
    f.col(C.white); f.lathe(0, 0, [[0, 0], [0.34, 0], [0.48, 0.2], [0.5, 0.62], [0.46, 0.68], [0, 0.64]], 24);
    f.col(C.gold); f.lathe(0, 0, [[0.5, 0.6], [0.505, 0.6], [0.505, 0.64], [0.5, 0.64]], 24);
    f.col('#3d2b1e'); f.cyl(0, 0, 0.44, 0.62, 0.66, 18);
    f.col('#a9a39a'); f.cyl(0, 0, 0.09, 0.66, 2.7, 10, 0.075); f.col('#8f897f'); for (let y = 0.8; y < 2.6; y += 0.18) f.cyl(0, 0, 0.095, y, y + 0.025, 10);
    f.col('#5f7f3a'); f.cyl(0, 0, 0.08, 2.7, 3.0, 10, 0.06);
    for (let i = 0; i < 11; i++) {
      const a = i * 2.39, lean = 0.5 + (i % 3) * 0.28, len = 1.3 + (i % 2) * 0.3;
      let px = 0, py = 3.0, pz = 0;
      for (let s = 0; s < 6; s++) {
        const t = (s + 1) / 6, nx = Math.sin(a) * Math.sin(lean) * len * t, nz = Math.cos(a) * Math.sin(lean) * len * t, ny = 3.0 + Math.cos(lean) * len * t * 0.6 - 0.9 * t * t * len * 0.5;
        f.col('#4f7a33'); f.rod([px, py, pz], [nx, ny, nz], 0.012, 4);
        f.push((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2, a); f.col(i % 2 ? '#5b8c3a' : '#6fa046'); f.box(-0.2 * (1 - t * 0.6), -0.01, -0.05, 0.2 * (1 - t * 0.6), 0.01, 0.05); f.pop();
        px = nx; py = ny; pz = nz;
      }
    }
  };
  D.velvet_rope = f => {
    for (const x of [-0.8, 0.8]) { f.col(C.gold); f.cyl(x, 0, 0.14, 0, 0.03, 16); f.cyl(x, 0, 0.022, 0.03, 0.95, 8); f.sph(x, 0.98, 0, 0.045, 0.045, 0.045, 10, 7); }
    const pts = Array.from({ length: 11 }, (_, i) => { const t = i / 10, x = -0.78 + t * 1.56; return [x, 0.9 - 0.32 * Math.sin(t * P), 0]; });
    f.tint(); for (let i = 0; i < 10; i++) f.rod(pts[i], pts[i + 1], 0.024, 6);
  };
}
