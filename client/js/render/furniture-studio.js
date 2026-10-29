// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio studio's furniture (ST4 of PLAN-SOUND-EFFECTS-AND-RADIO.md; the product owner 2026-10-27: "the radio studio
// looks nothing like a real radio studio room, where are the mics, the control boards, the big table ... dj area, vinyl
// records for decorations ... make it like a nice real studio for broadcasting music"; earlier: "very detailed, like real
// radio/dj/broadcast studios"): the broadcast desk (a mixing console with faders, knobs and lit level meters, screens on
// arms, three microphones on boom arms with pop filters, headphones, the hosts' side), the DJ booth (two turntables, a
// mixer, a laptop, a lit front), the guests' table with its microphones, gear racks blinking, a wall of vinyl, acoustic
// foam panels, the ON AIR sign, the studio clock, monitor speakers on stands, a crate of records. Item-local frame as
// render/furniture.js: +z the front (the hosts' side of the desk, the room side of a wall piece), y up; the sizes match
// shared/catalog.js. Light: col(hex, tint, emit): 3 bright, 4 a pulse; f.part spins the turntables (render/venue-motion.js).
import * as THREE from 'three';
import { neonText } from './furniture-arcade.js';

const TAU = Math.PI * 2, P = Math.PI;
const C = { black: '#121317', panel: '#1b1d22', alu: '#9aa1aa', steel: '#5c626b', walnut: '#5a3a24', oak: '#8a6040', foamA: '#2b2f3a', foamB: '#3a3150', red: '#e02424', white: '#f2f2ee', cyan: '#22d3ee', green: '#22c55e', amber: '#f59e0b' };
const rotX = (f, a) => { f.m.multiply(new THREE.Matrix4().makeRotationX(a)); };
const seeded = k => () => { k = (k * 16807) % 2147483647; return k / 2147483647; };

/** A microphone on a boom arm: its clamp at (x, y, z) on the desk's back edge, reaching forward and down to the
 *  speaker's mouth at (mx, my, mz); the mic (a body with its grille), its shock mount, a round pop filter before it. */
function boomMic(f, x, y, z, mx, my, mz) {
  const ex = (x + mx) / 2, ey = Math.max(y, my) + 0.32, ez = (z + mz) / 2;   // the arm's elbow, up over the desk
  f.col(C.black); f.cyl(x, z, 0.03, y, y + 0.12, 10);                       // the clamp's post
  f.col('#2a2c31'); f.rod([x, y + 0.12, z], [ex, ey, ez], 0.014, 6); f.rod([x + 0.02, y + 0.12, z], [ex + 0.02, ey - 0.03, ez], 0.008, 5);
  f.rod([ex, ey, ez], [mx, my + 0.12, mz - 0.12], 0.012, 6);
  f.col(C.red); f.sph(ex, ey, ez, 0.022, 0.022, 0.022, 8, 5);              // (a joint)
  f.col('#3a3d44'); f.rod([mx, my + 0.12, mz - 0.12], [mx, my, mz - 0.05], 0.01, 5);
  f.col('#1e2024'); f.cyl(mx, mz - 0.05, 0.028, my - 0.11, my + 0.03, 14);  // the mic body
  f.col('#6b7078'); f.sph(mx, my + 0.05, mz - 0.05, 0.03, 0.045, 0.03, 12, 8);   // its grille
  f.col(C.alu); f.cyl(mx, mz - 0.05, 0.034, my - 0.02, my - 0.005, 14);   // the shock mount's ring
  f.push(mx, my + 0.03, mz + 0.06, 0); rotX(f, P / 2);
  f.glass('#20232a'); f.cyl(0, 0, 0.075, -0.004, 0.004, 20);               // the pop filter's mesh
  f.col('#0e0f12'); f.lathe(0, 0, [[0.075, -0.006], [0.082, -0.006], [0.082, 0.006], [0.075, 0.006]], 20);
  f.pop();
}
/** A studio chair at (x, z), facing −z (the desk): a five-star base, the gas lift, a padded seat and a tall back. */
function chair(f, x, z) {
  f.col('#2a2c31'); for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; f.rod([x, 0.08, z], [x + Math.sin(a) * 0.3, 0.05, z + Math.cos(a) * 0.3], 0.02, 5); f.col('#111'); f.sph(x + Math.sin(a) * 0.3, 0.03, z + Math.cos(a) * 0.3, 0.03, 0.03, 0.03, 6, 4); f.col('#2a2c31'); }
  f.col(C.alu); f.cyl(x, z, 0.025, 0.08, 0.42, 8);
  f.col('#1f2937'); f.box(x - 0.25, 0.42, z - 0.24, x + 0.25, 0.5, z + 0.24);
  f.col('#111827'); f.box(x - 0.24, 0.5, z + 0.2, x + 0.24, 1.15, z + 0.27);
  f.col(C.red); f.box(x - 0.2, 0.95, z + 0.271, x + 0.2, 0.98, z + 0.275);
}
/** Headphones lying on the desk at (x, y, z). */
function headphones(f, x, y, z, yaw = 0) {
  f.push(x, y, z, yaw);
  f.col('#16171b'); for (const s of [-1, 1]) { f.cyl(s * 0.09, 0, 0.045, 0, 0.035, 14); f.col('#2c2f36'); f.cyl(s * 0.09, 0, 0.034, 0.035, 0.04, 14); f.col('#16171b'); }
  f.col('#2a2c31'); for (let k = 0; k < 8; k++) { const a0 = P * k / 8, a1 = P * (k + 1) / 8; f.rod([-Math.cos(a0) * 0.09, 0.03 + Math.sin(a0) * 0.012, -Math.sin(a0) * 0.1], [-Math.cos(a1) * 0.09, 0.03 + Math.sin(a1) * 0.012, -Math.sin(a1) * 0.1], 0.01, 5); }
  f.pop();
}
/** A screen on a stand or an arm: its face toward +z, lit. */
function screen(f, x, y, z, w, h, yaw, hex = '#1e3a5f') {
  f.push(x, y, z, yaw);
  f.col(C.black); f.box(-w / 2, 0, -0.02, w / 2, h, 0.01);
  f.col(hex, 0, 3); f.box(-w / 2 + 0.015, 0.015, 0.011, w / 2 - 0.015, h - 0.015, 0.013);
  f.col('#f8fafc', 0, 3); for (let k = 0; k < 4; k++) f.box(-w / 2 + 0.04, h - 0.06 - k * 0.05, 0.014, -w / 2 + 0.04 + (0.3 + (k % 3) * 0.15) * w * 0.8, h - 0.045 - k * 0.05, 0.015);   // (lines of text)
  f.col(C.green, 0, 3); f.box(w / 2 - 0.16, 0.04, 0.014, w / 2 - 0.04, 0.12, 0.015);
  f.pop();
}
/** The console's top: a sloped panel of channel strips (faders, knobs, a lit meter each), master section at the right. */
function console(f, x0, x1, y, z0, z1, strips = 12) {
  f.push(0, y, 0, 0);
  f.col('#23262c'); f.quad([[x0, 0, z1], [x1, 0, z1], [x1, 0.09, z0], [x0, 0.09, z0]], [0, 0.82, 0.57]);   // the sloped face
  f.col('#16181c'); f.box(x0, 0, z0 - 0.06, x1, 0.1, z0); f.box(x0 - 0.02, 0, z0 - 0.06, x0, 0.1, z1); f.box(x1, 0, z0 - 0.06, x1 + 0.02, 0.1, z1);
  const W = (x1 - x0) / (strips + 2), slope = (s) => 0.09 * (1 - (s - z0) / (z1 - z0));
  for (let i = 0; i < strips + 2; i++) {
    const cx = x0 + W * (i + 0.5), master = i >= strips;
    f.col(master ? '#c0c4ca' : '#8a9099'); f.box(cx - 0.005, slope(z1 - 0.05) + 0.002, z1 - 0.12, cx + 0.005, slope(z1 - 0.05) + 0.006, z1 - 0.02);   // the fader slot
    f.col(master ? C.red : '#e5e7eb'); const fz = z1 - 0.05 - ((i * 37) % 7) * 0.012; f.box(cx - 0.012, slope(fz) + 0.004, fz - 0.008, cx + 0.012, slope(fz) + 0.022, fz + 0.008);   // its cap
    for (let k = 0; k < 3; k++) { const kz = z0 + 0.06 + k * 0.045; f.col(['#ef4444', '#f59e0b', '#38bdf8'][k]); f.cyl(cx, kz, 0.007, slope(kz), slope(kz) + 0.012, 8); }   // knobs
    const mz = z0 + 0.025; for (let k = 0; k < 6; k++) { f.col(k < 3 ? C.green : k < 5 ? C.amber : C.red, 0, k < 4 ? 3 : 4); f.box(cx - 0.006, slope(mz) + 0.002 + k * 0.006, mz - 0.006, cx + 0.006, slope(mz) + 0.006 + k * 0.006, mz); }   // the meter
  }
  f.pop();
}

export function addStudioFurniture(D) {
  // ---------------------------------------------------------------- the broadcast desk: 3.2 m, the hosts on its +z side
  D.broadcast_desk = f => {
    const Y = 0.76;
    // the desk: a walnut top on a black body, a lit strip under its lip, its front (−z, the room) panelled
    f.col(C.black); f.box(-1.55, 0, -0.55, 1.55, Y - 0.04, 0.3);
    f.col(C.walnut); f.box(-1.6, Y - 0.04, -0.6, 1.6, Y, 0.45);
    f.col('#1a1c20'); f.box(-1.6, Y, -0.6, 1.6, Y + 0.01, -0.55);
    f.col(C.cyan, 0, 3); f.box(-1.5, 0.08, -0.556, 1.5, 0.1, -0.55);
    f.col('#2a2d33'); for (let k = -1; k <= 1; k++) f.box(k * 1.0 - 0.42, 0.18, -0.557, k * 1.0 + 0.42, 0.62, -0.551);   // panels
    f.col('#f1f5f9', 0, 3); neonText(f, 'MVW RADIO', 0, 0.36, -0.562, 0.11, '#f8fafc', 0.008);
    // the console in the middle, the hosts' places either side
    console(f, -0.55, 0.55, Y + 0.01, -0.5, -0.1, 12);
    screen(f, -0.95, Y + 0.08, -0.45, 0.55, 0.34, 0.25); screen(f, 0.95, Y + 0.08, -0.45, 0.55, 0.34, -0.25, '#3b1f5f');
    f.col(C.steel); for (const x of [-0.95, 0.95]) f.cyl(x, -0.47, 0.025, Y, Y + 0.08, 8);
    // three microphones on boom arms, one before each host
    for (const x of [-1.05, 0, 1.05]) boomMic(f, x + (x ? -0.25 * Math.sign(x) : 0.45), Y, -0.35, x, Y + 0.38, 0.32);
    for (const x of [-1.1, 1.1]) headphones(f, x + 0.15, Y + 0.005, 0.2, 0.3 * Math.sign(x));
    headphones(f, 0.25, Y + 0.005, 0.22, -0.2);
    f.col('#f5f5f4'); f.box(-0.3, Y, 0.1, 0.02, Y + 0.004, 0.32); f.box(0.6, Y, 0.12, 0.85, Y + 0.004, 0.36);   // papers
    f.col(C.red); f.cyl(-1.42, 0.25, 0.04, Y, Y + 0.1, 12); f.col('#3b2416'); f.cyl(-1.42, 0.25, 0.034, Y + 0.09, Y + 0.095, 12);   // a mug
    for (const x of [-1.05, 0, 1.05]) chair(f, x, 0.85);   // the hosts' chairs (their places: shared/catalog.js)
  };
  // ---------------------------------------------------------------- the DJ booth: two turntables and a mixer
  D.studio_dj = f => {
    const Y = 1.0;
    f.col(C.black); f.box(-1.15, 0, -0.45, 1.15, Y - 0.04, 0.4);
    f.col('#2b2e35'); f.box(-1.2, Y - 0.04, -0.5, 1.2, Y, 0.45);
    f.col('#a855f7', 0, 3); f.box(-1.1, 0.12, -0.456, 1.1, 0.15, -0.45); f.col(C.cyan, 0, 3); f.box(-1.1, 0.8, -0.456, 1.1, 0.83, -0.45);
    for (const [k, x] of [-0.62, 0.62].entries()) {   // the turntables: their platters (turning), records, tone arms
      f.col('#1f2126'); f.box(x - 0.24, Y, -0.22, x + 0.24, Y + 0.08, 0.22);
      f.part(`deck${k}`, [x - 0.03, Y + 0.09, 0], { kind: 'spin' });
      f.col('#9ca3af'); f.cyl(x - 0.03, 0, 0.16, Y + 0.08, Y + 0.095, 28);
      f.col('#0b0b0d'); f.cyl(x - 0.03, 0, 0.15, Y + 0.095, Y + 0.1, 28);
      f.col(['#ef4444', '#facc15'][k]); f.cyl(x - 0.03, 0, 0.045, Y + 0.1, Y + 0.103, 16);
      f.col('#e5e7eb'); f.box(x - 0.05, Y + 0.101, -0.002, x - 0.03, Y + 0.104, 0.12);
      f.endPart();
      f.col(C.alu); f.cyl(x + 0.18, -0.15, 0.025, Y + 0.08, Y + 0.12, 10); f.rod([x + 0.18, Y + 0.12, -0.15], [x + 0.04, Y + 0.115, 0.08], 0.008, 5);
    }
    f.col('#1a1c20'); f.box(-0.2, Y, -0.22, 0.2, Y + 0.09, 0.22);   // the mixer between
    console(f, -0.18, 0.18, Y + 0.09, -0.2, 0.2, 3);
    screen(f, 0.95, Y + 0.02, -0.38, 0.32, 0.22, -0.3, '#0f3d2e');   // the laptop's screen, off to the side
    f.col('#2b2e35'); f.box(0.8, Y, -0.36, 1.1, Y + 0.02, -0.1);
    headphones(f, -1.0, Y + 0.002, 0.22, 0.4);
    // the DJ's own microphone on a boom from the back corner, up to where the DJ stands (2026-10-28, the product owner: the
    // DJ table "needs a mic similar to the ones from the main host table ... DJs ... can talk as well")
    boomMic(f, -1.0, Y, -0.38, -0.32, Y + 0.5, 0.45);
  };
  // ---------------------------------------------------------------- the guests' table: round, two microphones on stands
  D.guest_table = f => {
    f.col(C.black); f.cyl(0, 0, 0.08, 0, 0.72, 12); f.cyl(0, 0, 0.35, 0, 0.03, 20);
    f.col(C.oak); f.cyl(0, 0, 0.62, 0.72, 0.76, 36);
    f.col('#1d1f24'); f.lathe(0, 0, [[0.62, 0.72], [0.63, 0.72], [0.63, 0.76], [0.62, 0.76]], 36);
    // its two guests face each other across it (their seats: shared/catalog.js, ±0.95 m): a microphone and headphones at
    // each place, and their chairs (2026-10-28, the product owner: "the guest table ... is missing the chairs")
    for (const s of [-1, 1]) {
      f.col(C.black); f.cyl(0, s * 0.3, 0.06, 0.76, 0.775, 12); f.col(C.steel); f.rod([0, 0.775, s * 0.3], [0, 1.08, s * 0.4], 0.01, 5);
      f.col('#1e2024'); f.cyl(0, s * 0.4, 0.026, 1.05, 1.17, 12); f.col('#6b7078'); f.sph(0, 1.19, s * 0.4, 0.03, 0.04, 0.03, 10, 6);
      headphones(f, 0.24, 0.765, s * 0.42, s > 0 ? 0 : P);
      f.push(0, 0, s * 0.95, s > 0 ? 0 : P); chair(f, 0, 0); f.pop();   // (the chair's back away from the table)
    }
    f.col('#e7e5e4'); f.cyl(0.05, -0.2, 0.04, 0.76, 0.85, 12);   // a glass of water
  };
  // ---------------------------------------------------------------- the gear rack: units with blinking lights
  D.gear_rack = f => {
    f.col(C.black); f.box(-0.28, 0, -0.32, 0.28, 1.8, 0.3);
    const rnd = seeded(7);
    for (let i = 0; i < 9; i++) {
      const y0 = 0.08 + i * 0.185;
      f.col(i % 3 ? '#2a2d33' : '#3a3e46'); f.box(-0.26, y0, 0.3, 0.26, y0 + 0.16, 0.315);
      for (let k = 0; k < 5; k++) { f.col([C.green, C.amber, C.cyan, C.red][Math.floor(rnd() * 4)], 0, rnd() < 0.5 ? 4 : 3); f.box(-0.22 + k * 0.04, y0 + 0.11, 0.315, -0.205 + k * 0.04, y0 + 0.125, 0.318); }
      f.col('#9ca3af'); for (let k = 0; k < 3; k++) f.cyl(0.08 + k * 0.06, 0.32, 0.012, y0 + 0.05, y0 + 0.06, 8);
    }
  };
  // ---------------------------------------------------------------- the wall of vinyl: sleeves on shelves, records framed
  D.vinyl_wall = f => {
    f.col(C.oak); for (let r = 0; r <= 4; r++) f.box(-1.2, 0.2 + r * 0.42, -0.14, 1.2, 0.23 + r * 0.42, 0.14);
    for (const x of [-1.2, 0, 1.2]) f.box(x - 0.02, 0.2, -0.14, x + 0.02, 1.91, 0.14);
    const rnd = seeded(11), cols = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#f5f5f4', '#111827', '#14b8a6', '#eab308'];
    for (let r = 0; r < 4; r++) for (let x = -1.17; x < 1.15; x += 0.022 + rnd() * 0.012) {
      if (Math.abs(x) < 0.03) continue;
      const lean = (rnd() - 0.5) * 0.08, top = 0.23 + r * 0.42 + 0.31 + rnd() * 0.02;
      f.col(cols[Math.floor(rnd() * cols.length)]); f.box(x, 0.23 + r * 0.42, -0.12 + lean, x + 0.018, top, 0.12 + lean);
    }
    for (const [k, x] of [-0.8, 0, 0.8].entries()) {   // three records on show above
      f.col('#0b0b0d'); f.box(x - 0.2, 2.0, -0.13, x + 0.2, 2.4, -0.11);
      f.push(x, 2.2, -0.105, 0); rotX(f, P / 2); f.col('#111'); f.cyl(0, 0, 0.17, 0, 0.006, 28); f.col(['#f97316', '#22d3ee', '#ec4899'][k]); f.cyl(0, 0, 0.055, 0.006, 0.009, 18); f.pop();
    }
  };
  // ---------------------------------------------------------------- acoustic foam: a wall of panels, bass traps above
  D.acoustic_wall = f => {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) {
      const x0 = -1.2 + i * 0.4, y0 = 0.3 + j * 0.42, dark = (i + j) % 2;
      f.col(dark ? C.foamA : C.foamB); f.box(x0 + 0.01, y0, -0.06, x0 + 0.39, y0 + 0.4, 0);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { f.col(dark ? '#353a47' : '#47395f'); f.box(x0 + 0.04 + a * 0.12, y0 + 0.03 + b * 0.125, 0, x0 + 0.1 + a * 0.12, y0 + 0.11 + b * 0.125, 0.05); }   // the wedges
    }
    f.col('#22252d'); f.box(-1.2, 2.45, -0.06, 1.2, 2.62, 0.08);
  };
  // ---------------------------------------------------------------- the ON AIR sign over the door: red, its letters lit
  D.on_air_sign = f => {
    f.col('#1a1a1d'); f.box(-0.5, 2.25, -0.06, 0.5, 2.6, 0.02);
    f.col(C.red, 0, 3); f.box(-0.46, 2.28, 0.02, 0.46, 2.57, 0.03);
    neonText(f, 'ON AIR', 0, 2.34, 0.035, 0.17, '#fff7ed', 0.012);
  };
  // ---------------------------------------------------------------- the studio clock: a round face ringed in red lights
  D.studio_clock = f => {   // a broadcast studio's clock (2026-10-28, the product owner: "what is this supposed to be?" — a bare red bar): its
    // ring of 60 dots (every fifth brighter), the hour and minute hands on the world's clock and a lit dot running round
    // the ring with the seconds (render/venue-motion.js MOVES.clock)
    f.col(C.black); f.push(0, 1.9, -0.03, 0); rotX(f, P / 2); f.cyl(0, 0, 0.28, 0, 0.04, 36);
    f.col('#0b0b0d'); f.cyl(0, 0, 0.25, 0.04, 0.045, 36); f.pop();
    for (let k = 0; k < 60; k++) {
      const a = k / 60 * TAU, big = k % 5 === 0, r = big ? 0.009 : 0.005;
      if (big) f.col(C.red, 0, 3); else f.col('#4a1414');
      f.box(Math.sin(a) * 0.22 - r, 1.9 + Math.cos(a) * 0.22 - r, 0.016, Math.sin(a) * 0.22 + r, 1.9 + Math.cos(a) * 0.22 + r, 0.022);
    }
    f.part('hour', [0, 1.9, 0.024], { kind: 'clock', hand: 'hour' }); f.col('#f5f5f4', 0, 2); f.box(-0.011, 1.885, 0.022, 0.011, 1.9 + 0.11, 0.028); f.endPart();
    f.part('min', [0, 1.9, 0.03], { kind: 'clock', hand: 'min' }); f.col('#f5f5f4', 0, 2); f.box(-0.007, 1.885, 0.028, 0.007, 1.9 + 0.175, 0.033); f.endPart();
    f.part('sec', [0, 1.9, 0.036], { kind: 'clock', hand: 'sec' }); f.col('#ff4d4d', 0, 4); f.box(-0.011, 1.9 + 0.209, 0.03, 0.011, 1.9 + 0.231, 0.038); f.endPart();
    f.col('#d4d4d8'); f.push(0, 1.9, 0.034, 0); rotX(f, P / 2); f.cyl(0, 0, 0.016, 0, 0.012, 12); f.pop();
  };
  // ---------------------------------------------------------------- monitor speakers on their stands
  D.studio_monitors = f => {
    for (const s of [-1, 1]) {
      const x = s * 0.62;
      f.col(C.steel); f.cyl(x, 0, 0.16, 0, 0.03, 16); f.cyl(x, 0, 0.03, 0.03, 1.0, 8);
      f.col('#17181c'); f.box(x - 0.17, 1.0, -0.2, x + 0.17, 1.45, 0.2);
      f.push(x, 1.13, 0.201, 0); rotX(f, P / 2); f.col('#0c0c0f'); f.cyl(0, 0, 0.11, 0, 0.012, 18); f.col('#e5e7eb'); f.cyl(0, 0, 0.035, 0.012, 0.02, 12); f.pop();
      f.push(x, 1.36, 0.201, 0); rotX(f, P / 2); f.col('#26272c'); f.cyl(0, 0, 0.04, 0, 0.012, 12); f.pop();
      f.col(C.cyan, 0, 3); f.box(x - 0.012, 1.03, 0.201, x + 0.012, 1.045, 0.205);
    }
  };
  // ---------------------------------------------------------------- a crate of records on the floor
  D.record_crate = f => {
    f.col(C.oak); f.box(-0.33, 0, -0.23, 0.33, 0.03, 0.23);
    for (const [x0, x1, z0, z1] of [[-0.33, 0.33, -0.23, -0.21], [-0.33, 0.33, 0.21, 0.23], [-0.33, -0.31, -0.23, 0.23], [0.31, 0.33, -0.23, 0.23]]) f.box(x0, 0, z0, x1, 0.3, z1);
    const rnd = seeded(23), cols = ['#ef4444', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#f5f5f4', '#ec4899', '#111827'];
    for (let x = -0.29; x < 0.29; x += 0.02) { f.col(cols[Math.floor(rnd() * cols.length)]); f.box(x, 0.03, -0.19, x + 0.012, 0.33 + rnd() * 0.02, 0.19); }
  };
}
