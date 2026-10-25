// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Character rig + procedural animation clips. Clips are evaluated once at startup and baked into a float texture
// (model-space 3x4 skinning matrices per bone per frame); the character vertex shader samples it (rigid skinning).
import * as THREE from 'three';
import { ANIMS } from '/shared/anims.js';
import { applyTripoTiming } from './charClips.js';

export const NB = 16, FRAMES = 32, TEX_W = 1024;
export const PEL = 0, SPI = 1, CHE = 2, HEA = 3, LUA = 4, LFA = 5, LHA = 6, RUA = 7, RFA = 8, RHA = 9,
  LTH = 10, LSH = 11, LFO = 12, RTH = 13, RSH = 14, RFO = 15;
// Rest pivots (model space, metres; character faces +z, its left side is +x).
export const PIVOT = [
  [0, 0.94, 0], [0, 1.03, 0], [0, 1.2, 0], [0, 1.445, 0],
  [0.19, 1.4, 0], [0.2, 1.12, 0], [0.205, 0.875, 0],
  [-0.19, 1.4, 0], [-0.2, 1.12, 0], [-0.205, 0.875, 0],
  [0.095, 0.915, 0], [0.095, 0.5, 0.004], [0.095, 0.085, 0],
  [-0.095, 0.915, 0], [-0.095, 0.5, 0.004], [-0.095, 0.085, 0],
];
export const PARENT = [-1, 0, 1, 2, 2, 4, 5, 2, 7, 8, 0, 10, 11, 0, 13, 14];
export const SIT_H = 0.54, LIE_H = 0.62;

const TAU = Math.PI * 2, PI = Math.PI;
const { sin, cos, pow } = Math;
const pos = x => (x > 0 ? x : 0);
const S = (u, k = 1, o = 0) => sin(TAU * k * u + o);
const C = (u, k = 1, o = 0) => cos(TAU * k * u + o);
/** Smooth cyclic pulse centred at c with half-width w (0..1). */
function bump(u, c, w) {
  const d = Math.abs((((u - c) % 1) + 1.5) % 1 - 0.5);
  return d < w ? 0.5 + 0.5 * cos(PI * d / w) : 0;
}
const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class Pose {
  constructor() { this.r = new Float32Array(NB * 3); this.o = [0, 0, 0]; }
  reset() { this.r.fill(0); this.o[0] = this.o[1] = this.o[2] = 0; return this; }
  rot(b, x = 0, y = 0, z = 0) { const k = b * 3; this.r[k] += x; this.r[k + 1] += y; this.r[k + 2] += z; return this; }
  off(x = 0, y = 0, z = 0) { this.o[0] += x; this.o[1] += y; this.o[2] += z; return this; }
  /** side +1 = left arm. flex < 0 swings forward, abd > 0 lifts sideways, elbow < 0 bends, fz < 0 turns the forearm inward. */
  arm(side, flex, abd, elbow, fz = 0, wrist = 0, twist = 0) {
    const u = side > 0 ? LUA : RUA;
    this.rot(u, flex, twist * side, abd * side);
    this.rot(u + 1, elbow, 0, fz * side);
    this.rot(u + 2, wrist, 0, 0);
    return this;
  }
  /** hip < 0 swings the thigh forward, knee > 0 bends, ankle > 0 points the toes down. */
  leg(side, hip, knee, ankle = 0, abd = 0, twist = 0) {
    const t = side > 0 ? LTH : RTH;
    this.rot(t, hip, twist * side, abd * side);
    this.rot(t + 1, knee, 0, 0);
    this.rot(t + 2, ankle, 0, 0);
    return this;
  }
  copy(o) { this.r.set(o.r); this.o[0] = o.o[0]; this.o[1] = o.o[1]; this.o[2] = o.o[2]; return this; }
  mix(a, b, t) { for (let k = 0; k < this.r.length; k++) this.r[k] = a.r[k] + (b.r[k] - a.r[k]) * t; for (let k = 0; k < 3; k++) this.o[k] = a.o[k] + (b.o[k] - a.o[k]) * t; return this; }
}

// ------------------------------------------------------------------ shared pose pieces
function standLegs(P, u, amp = 1) {
  const s = S(u);
  P.off(0.014 * s * amp, -0.006 + 0.004 * S(u, 2), 0);
  P.rot(PEL, 0, 0.03 * s * amp, 0.035 * s * amp);
  P.leg(1, -0.03 + 0.03 * s * amp, 0.04 + 0.06 * pos(-s) * amp, 0, 0.035);
  P.leg(-1, -0.03 - 0.03 * s * amp, 0.04 + 0.06 * pos(s) * amp, 0, 0.035);
}
function relaxedArms(P, u) {
  const c = C(u), s2 = S(u, 2);
  P.arm(1, 0.02 + 0.02 * c, 0.08, -0.14 - 0.03 * s2);
  P.arm(-1, 0.02 - 0.02 * c, 0.08, -0.14 + 0.03 * s2);
}
function sitBase(P, u) {
  P.off(0, SIT_H - 0.94, 0);
  P.leg(1, -1.52, 1.5, 0, 0.07);
  P.leg(-1, -1.52, 1.5, 0, 0.07);
  P.rot(SPI, -0.02 + 0.01 * S(u), 0, 0);
  P.rot(CHE, 0.012 * S(u, 2), 0, 0);
}
function relaxLegs(P) {
  P.off(0, SIT_H - 0.94, 0);
  P.leg(1, -1.35, 0.62, 0.25, 0.1);
  P.leg(-1, -1.35, 0.62, 0.25, 0.1);
}
function walkCore(P, p, hold) {
  const s = sin(p), c = cos(p);
  P.off(0, -0.012 + 0.02 * cos(2 * p), 0);
  P.rot(PEL, 0, -0.1 * s, -0.04 * c);
  P.rot(SPI, 0.04, 0.03 * s, 0.02 * c);
  P.rot(CHE, 0, 0.12 * s, 0.02 * c);
  P.rot(HEA, 0, -0.05 * s, 0);
  for (const side of [1, -1]) {
    const q = side > 0 ? p : p + PI, sq = sin(q), cq = cos(q);
    P.leg(side, -0.46 * sq, 0.1 + 0.95 * pow(pos(cos(q + 0.5)), 1.5), 0.3 * pos(-sin(q - 0.4)) - 0.12 * pos(cq), 0.02);
  }
  P.arm(1, 0.42 * s, 0.07, -0.2 - 0.25 * pos(-s));
  if (hold) P.arm(-1, -0.32 + 0.04 * s, 0.1, -1.35, -0.25);
  else P.arm(-1, -0.42 * s, 0.07, -0.2 - 0.25 * pos(s));
}

// ------------------------------------------------------------------ clips
const DEF = {
  idle: { dur: 6, fn(u, P) {
    standLegs(P, u);
    P.rot(SPI, 0.01, 0, 0.02 * S(u));
    P.rot(CHE, 0.015 + 0.012 * S(u, 2), 0.02 * C(u), 0.015 * S(u));
    P.rot(HEA, 0.02 + 0.03 * S(u, 1, 1), 0.12 * S(u, 1, 0.5), 0.02 * S(u));
    relaxedArms(P, u);
  } },
  walk: { gait: 1.42, fn(u, P) { walkCore(P, TAU * u, false); } },
  run: { gait: 2.8, fn(u, P) {
    const p = TAU * u, s = sin(p), c = cos(p);
    P.off(0, -0.06 + 0.045 * cos(2 * p), 0);
    P.rot(PEL, 0, -0.16 * s, -0.05 * c);
    P.rot(SPI, 0.16, 0.05 * s, 0);
    P.rot(CHE, 0.05, 0.2 * s, 0.03 * c);
    P.rot(HEA, -0.12, -0.08 * s, 0);
    for (const side of [1, -1]) {
      const q = side > 0 ? p : p + PI, sq = sin(q), cq = cos(q);
      P.leg(side, -0.12 - 0.8 * sq, 0.35 + 1.55 * pow(pos(cos(q + 0.45)), 1.2), 0.35 * pos(-sin(q - 0.3)) - 0.15 * pos(cq), 0.03);
    }
    P.arm(1, 0.7 * s, 0.12, -1.5 + 0.2 * s, -0.15);
    P.arm(-1, -0.7 * s, 0.12, -1.5 - 0.2 * s, -0.15);
  } },
  jog: { gait: 2.15, fn(u, P) {
    const p = TAU * u, s = sin(p), c = cos(p);
    P.off(0, -0.04 + 0.035 * cos(2 * p), 0);
    P.rot(PEL, 0, -0.13 * s, -0.045 * c);
    P.rot(SPI, 0.1, 0.04 * s, 0);
    P.rot(CHE, 0.03, 0.16 * s, 0.02 * c);
    P.rot(HEA, -0.08, -0.06 * s, 0);
    for (const side of [1, -1]) {
      const q = side > 0 ? p : p + PI, sq = sin(q), cq = cos(q);
      P.leg(side, -0.08 - 0.62 * sq, 0.25 + 1.25 * pow(pos(cos(q + 0.45)), 1.3), 0.3 * pos(-sin(q - 0.35)) - 0.12 * pos(cq), 0.03);
    }
    P.arm(1, 0.55 * s, 0.1, -1.3 + 0.15 * s, -0.12);
    P.arm(-1, -0.55 * s, 0.1, -1.3 - 0.15 * s, -0.12);
  } },
  sit: { dur: 7, fn(u, P) {
    sitBase(P, u);
    P.rot(HEA, 0.08, 0.14 * S(u, 1, 1), 0);
    P.arm(1, -0.12, 0.02, -1.05, -0.1);
    P.arm(-1, -0.12, 0.02, -1.05, -0.1);
  } },
  sit_type: { dur: 4.8, fn(u, P) {
    sitBase(P, u);
    P.rot(SPI, 0.06, 0, 0);
    P.rot(HEA, 0.1 + 0.03 * S(u), 0.12 * S(u, 1, 0.7), 0);
    P.arm(1, -0.62, 0.16, -1.02 + 0.04 * S(u, 8), -0.3, 0.12 * S(u, 8));
    P.arm(-1, -0.62, 0.16, -1.02 + 0.04 * S(u, 8, 2), -0.3, 0.12 * S(u, 8, 2));
  } },
  sit_talk: { dur: 7, fn(u, P) {
    sitBase(P, u);
    const gR = pow(pos(S(u)), 2), gL = pow(pos(S(u, 1, 2.5)), 2);
    P.rot(HEA, 0.05 + 0.05 * S(u, 3), 0.4 * S(u, 1, 1.2), 0);
    P.rot(CHE, 0, 0.1 * S(u, 1, 1.2), 0);
    P.arm(1, -0.5 - 0.25 * gL, 0.1 + 0.2 * gL, -0.95 - 0.45 * gL, -0.2 + 0.4 * gL);
    P.arm(-1, -0.5 - 0.3 * gR, 0.15 + 0.25 * gR, -0.95 - 0.5 * gR, -0.2 + 0.5 * gR);
  } },
  sit_eat: { dur: 6, fn(u, P) {
    sitBase(P, u);
    const w = bump(u, 0.45, 0.14) + bump(u, 0.85, 0.1) * 0.8;
    P.rot(CHE, 0.05, 0, 0);
    P.rot(HEA, 0.12 - 0.1 * w, 0.05 * S(u), 0);
    P.arm(1, -0.55, 0.12, -0.95, -0.2);
    P.arm(-1, -0.55 - 0.25 * w, 0.15 + 0.25 * w, -0.95 - 1.1 * w, -0.2 - 0.3 * w);
  } },
  sit_relax: { dur: 9, fn(u, P) {
    relaxLegs(P);
    P.rot(SPI, -0.2, 0, 0);
    P.rot(CHE, -0.05 + 0.015 * S(u, 2), 0, 0);
    P.rot(HEA, 0.18, 0.3 * S(u, 1, 0.4), 0);
    P.arm(1, 0.05, 0.35, -0.35 + 0.05 * S(u));
    P.arm(-1, 0.05, 0.35, -0.35 - 0.05 * S(u));
  } },
  sit_high: { dur: 7, fn(u, P) {
    P.off(0, SIT_H - 0.94, 0);
    P.leg(1, -1.38, 1.9, 0.2, 0.08);
    P.leg(-1, -1.38, 1.9, 0.2, 0.08);
    const w = bump(u, 0.6, 0.12);
    P.rot(SPI, 0.05, 0, 0);
    P.rot(HEA, 0.05, 0.3 * S(u, 1, 1), 0);
    P.arm(1, -0.72, 0.12, -0.85, -0.2);
    P.arm(-1, -0.72 - 0.2 * w, 0.12 + 0.2 * w, -0.85 - 1.1 * w, -0.2);
  } },
  sit_play: { dur: 3.2, fn(u, P) {
    sitBase(P, u);
    P.rot(SPI, 0.05, 0, 0.05 * S(u));
    P.rot(HEA, 0.15, 0.1 * S(u), 0);
    P.arm(1, -0.62, 0.2 + 0.12 * S(u), -1.0, -0.25 + 0.15 * S(u), 0.15 * S(u, 6));
    P.arm(-1, -0.62, 0.2 + 0.12 * S(u, 1, 2), -1.0, -0.25 + 0.15 * S(u, 1, 2), 0.15 * S(u, 6, 1.3));
  } },
  sit_phone: { dur: 6, fn(u, P) {
    sitBase(P, u);
    P.rot(HEA, 0.38, -0.1, 0);
    P.arm(-1, -0.3, 0.12, -1.95, -0.35, 0.08 * S(u, 5));
    P.arm(1, -0.12, 0.02, -1.05, -0.1);
  } },
  lie: { dur: 10, fn(u, P) {
    P.off(0, LIE_H - 0.94, 0);
    P.rot(PEL, -PI / 2, 0, 0);
    P.leg(1, 0.02, 0.06, 0.35, 0.06);
    P.leg(-1, 0.02, 0.06, 0.35, 0.06);
    P.rot(CHE, 0.02 * S(u, 2), 0, 0);
    P.rot(HEA, -0.08, 0.1 * S(u), 0);
    P.arm(1, 0.02, 0.14, -0.2);
    P.arm(-1, 0.02, 0.14, -0.2);
  } },
  talk: { dur: 6.5, fn(u, P) {
    standLegs(P, u);
    const gR = pow(pos(S(u)), 1.5), gL = pow(pos(S(u, 1, 3)), 1.5);
    P.rot(CHE, 0.01, 0.06 * S(u), 0);
    P.rot(HEA, 0.04 * S(u, 4), 0.18 * S(u, 1, 0.3), 0);
    P.arm(-1, -0.2 - 0.35 * gR, 0.1 + 0.2 * gR, -0.35 - 0.9 * gR, 0.3 * gR);
    P.arm(1, -0.1 - 0.3 * gL, 0.1 + 0.15 * gL, -0.3 - 0.8 * gL, 0.2 * gL);
  } },
  drink: { dur: 6, fn(u, P) {
    standLegs(P, u);
    const w = bump(u, 0.5, 0.16);
    P.rot(HEA, -0.12 * w, 0.1 * S(u, 1, 1), 0);
    P.arm(-1, -0.32 - 0.3 * w, 0.12 + 0.3 * w, -1.35 - 0.85 * w, -0.25 - 0.2 * w);
    P.arm(1, 0.02, 0.08, -0.15);
  } },
  use: { dur: 3, fn(u, P) {
    standLegs(P, u, 0.5);
    P.rot(SPI, 0.06, 0, 0);
    P.rot(HEA, 0.28, 0.05 * S(u), 0);
    P.arm(1, -0.55 + 0.06 * S(u), 0.15, -0.85, -0.2, 0.18 * S(u, 2));
    P.arm(-1, -0.55 + 0.06 * S(u, 1, 2), 0.15, -0.85, -0.2, 0.18 * S(u, 2, 1.5));
  } },
  cook: { dur: 2.4, fn(u, P) {
    standLegs(P, u, 0.4);
    P.rot(SPI, 0.08, 0, 0);
    P.rot(HEA, 0.35, -0.1, 0);
    P.arm(-1, -0.62 + 0.12 * S(u), 0.18 + 0.12 * C(u), -1.05, -0.2);
    P.arm(1, -0.45, 0.12, -1.25, -0.15);
  } },
  wash: { dur: 1.6, fn(u, P) {
    standLegs(P, u, 0.3);
    P.rot(SPI, 0.18, 0, 0);
    P.rot(HEA, 0.42, 0, 0);
    P.arm(1, -0.4, 0.1 + 0.08 * S(u, 2), -0.75 + 0.15 * S(u, 2), -0.3);
    P.arm(-1, -0.4, 0.1 - 0.08 * S(u, 2), -0.75 - 0.15 * S(u, 2), -0.3);
  } },
  browse: { dur: 8, fn(u, P) {
    standLegs(P, u);
    const w = bump(u, 0.35, 0.14);
    P.rot(HEA, 0.08 + 0.12 * S(u), 0.3 * S(u, 1, 1), 0);
    P.arm(-1, -0.15 - 0.95 * w, 0.12 - 0.05 * w, -0.3 - 0.35 * w);
    P.arm(1, -0.1, 0.08, -0.5, -0.3);
  } },
  phone: { dur: 6, fn(u, P) {
    standLegs(P, u);
    P.rot(HEA, 0.4 - 0.3 * bump(u, 0.7, 0.1), -0.08, 0);
    P.arm(-1, -0.28, 0.1, -1.8, -0.35, 0.06 * S(u, 6));
    P.arm(1, -0.12, 0.06, -0.45, -0.2);
  } },
  wave: { dur: 1.3, fn(u, P) {
    standLegs(P, u, 0.3);
    P.rot(HEA, 0, -0.1, 0.05);
    P.arm(-1, -0.25, 2.45, -0.35, 0.45 * S(u, 2));
    P.arm(1, 0.02, 0.08, -0.15);
  } },
  dance: { dur: 0.95, fn(u, P) {
    const s = S(u), b = 0.5 - 0.5 * C(u, 2);
    P.off(0.05 * s, -0.03 - 0.05 * b, 0);
    P.rot(PEL, 0, 0.15 * s, 0.1 * s);
    P.rot(SPI, 0.05, -0.1 * s, -0.06 * s);
    P.rot(CHE, 0.05 * b, -0.1 * s, -0.05 * s);
    P.rot(HEA, 0.1 * b - 0.05, 0.15 * s, 0.1 * s);
    P.arm(1, -0.5 - 0.6 * pos(s), 0.35 + 0.8 * pos(s), -1.3 + 0.4 * pos(s));
    P.arm(-1, -0.5 - 0.6 * pos(-s), 0.35 + 0.8 * pos(-s), -1.3 + 0.4 * pos(-s));
    P.leg(1, -0.1 - 0.1 * b - 0.15 * pos(s), 0.15 + 0.25 * b + 0.2 * pos(s), 0, 0.08);
    P.leg(-1, -0.1 - 0.1 * b - 0.15 * pos(-s), 0.15 + 0.25 * b + 0.2 * pos(-s), 0, 0.08);
  } },
  cheer: { dur: 0.8, fn(u, P) {
    P.off(0, 0.03 * pos(S(u)), 0);
    P.leg(1, -0.05, 0.1 + 0.1 * pos(-S(u)), 0, 0.05); P.leg(-1, -0.05, 0.1 + 0.1 * pos(-S(u)), 0, 0.05);
    P.rot(HEA, -0.15, 0, 0);
    P.arm(1, -0.2, 2.5 + 0.25 * S(u), -0.25); P.arm(-1, -0.2, 2.5 + 0.25 * S(u), -0.25);
  } },
  yoga: { dur: 18, fn(u, P) {
    const k = Math.floor(u * 3) % 3, l = u * 3 - Math.floor(u * 3);
    const t = smooth((l - 0.75) / 0.25);
    const a = YOGA[k], b = YOGA[(k + 1) % 3];
    P.mix(a, b, t);
  } },
  lift: { dur: 2.6, fn(u, P) {
    const curl = 0.5 - 0.5 * C(u);
    P.leg(1, -0.06, 0.12, 0, 0.08); P.leg(-1, -0.06, 0.12, 0, 0.08);
    P.off(0, -0.01, 0);
    P.rot(CHE, -0.03 * curl, 0, 0);
    P.rot(HEA, 0.05, 0, 0);
    P.arm(-1, -0.08 - 0.15 * curl, 0.1, -0.2 - 1.9 * curl, -0.1);
    P.arm(1, 0.15, 0.55, -1.5, -0.4);
  } },
  pingpong: { dur: 1.3, fn(u, P) {
    const s = S(u);
    P.off(0.08 * S(u, 1, 1), -0.08, 0);
    P.leg(1, -0.3, 0.5, -0.15, 0.12); P.leg(-1, -0.3, 0.5, -0.15, 0.12);
    P.rot(SPI, 0.22, 0, 0);
    P.rot(PEL, 0, 0.25 * s, 0);
    P.rot(CHE, 0, 0.15 * s, 0);
    P.rot(HEA, -0.1, -0.35 * s, 0);
    P.arm(-1, -0.45 - 0.35 * s, 0.35 + 0.15 * C(u), -1.2 + 0.2 * s, 0, 0, 0.3 * s);
    P.arm(1, -0.35, 0.3, -1.1);
  } },
  play: { dur: 1.1, fn(u, P) {
    standLegs(P, u, 0.3);
    P.rot(PEL, 0, 0.04 * S(u), 0);
    P.rot(SPI, 0.05 + 0.02 * S(u), 0, 0);
    P.rot(HEA, 0.08, 0, 0);
    P.arm(1, -0.62, 0.12, -1.25, -0.2, 0.1 * S(u), 0.1 * S(u));
    P.arm(-1, -0.62, 0.12, -1.25, -0.2, 0.18 * S(u, 4));
  } },
  present: { dur: 7, fn(u, P) {
    standLegs(P, u, 0.6);
    const pt = pow(pos(S(u)), 0.7), g = pos(-S(u));
    P.rot(CHE, 0, -0.2 * pt, 0);
    P.rot(HEA, 0, -0.85 * pt + 0.1 * (1 - pt), 0);
    P.arm(-1, -0.45 - 0.2 * pt, 0.5 + 0.8 * pt, -0.35 + 0.1 * pt);
    P.arm(1, -0.2 - 0.3 * g, 0.12 + 0.15 * g, -0.5 - 0.7 * g);
  } },
  wait: { dur: 7, fn(u, P) {
    standLegs(P, u);
    P.rot(HEA, -0.05 + 0.05 * S(u, 2), 0.35 * S(u, 1, 0.5), 0);
    P.arm(1, -0.35, 0.02, -1.55, -0.9, 0, 0.3);
    P.arm(-1, -0.35, 0.02, -1.55, -0.9, 0, 0.3);
  } },
  staff: { dur: 5, fn(u, P) {
    standLegs(P, u, 0.5);
    const w = bump(u, 0.55, 0.15);
    P.rot(HEA, 0.12, 0.3 * S(u, 1, 0.4), 0);
    P.arm(1, -0.45, 0.14, -0.62, -0.15);
    P.arm(-1, -0.45 - 0.45 * w, 0.14, -0.62 + 0.25 * w, -0.15);
  } },
  jump: { dur: 1.0, fn(u, P) {
    const up = pow(pos(S(u)), 1.5), dn = pos(-S(u));
    P.off(0, 0.25 * up - 0.08 * dn, 0);
    P.leg(1, -0.2 * dn, 0.1 + 0.6 * dn, 0.3 * up, 0.05); P.leg(-1, -0.2 * dn, 0.1 + 0.6 * dn, 0.3 * up, 0.05);
    P.arm(1, -0.3 * up, 0.3 + 1.8 * up, -0.3); P.arm(-1, -0.3 * up, 0.3 + 1.8 * up, -0.3);
  } },
  clap: { dur: 0.55, fn(u, P) {
    standLegs(P, u, 0.3);
    const w = 0.5 + 0.5 * C(u);
    P.arm(1, -0.75, 0.15 + 0.3 * w, -1.1, -0.6);
    P.arm(-1, -0.75, 0.15 + 0.3 * w, -1.1, -0.6);
  } },
  // ---- client-only clips (not referenced by the server) ----
  walk_hold: { gait: 1.42, fn(u, P) { walkCore(P, TAU * u, true); } },
  idle_hold: { dur: 6, fn(u, P) {
    DEF.idle.fn(u, P);
    P.r.fill(0, RUA * 3, RHA * 3 + 3);
    P.arm(-1, -0.32 + 0.02 * S(u), 0.1, -1.35, -0.25);
  } },
  sit_read: { dur: 8, fn(u, P) {
    relaxLegs(P);
    P.rot(SPI, -0.08, 0, 0);
    P.rot(HEA, 0.45, 0.05 * S(u), 0);
    const pg = bump(u, 0.8, 0.06);
    P.arm(1, -0.45, 0.15, -1.35, -0.5);
    P.arm(-1, -0.45, 0.15, -1.35, -0.5 + 0.4 * pg);
  } },
};
// the eating clips (baked characters only: tools/chars/extra-clips.mjs) are the seated meal on the procedural ones
for (const n of ['eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon', 'eat_lap']) DEF[n] = DEF.sit_eat;
for (const n of ['eat_stand', 'eat_stand_hands']) DEF[n] = DEF.drink || DEF.idle;
DEF.prep = DEF.cook || DEF.use;
// yoga key poses
const YOGA = (() => {
  const a = new Pose(), b = new Pose(), c = new Pose();
  a.arm(1, -0.1, 2.95, -0.05); a.arm(-1, -0.1, 2.95, -0.05); a.rot(HEA, -0.15, 0, 0); a.leg(1, 0, 0.02, 0, 0.03); a.leg(-1, 0, 0.02, 0, 0.03);
  b.leg(1, -0.8, 2.0, 0.3, 0.9, 0.6); b.leg(-1, 0, 0.03, 0, 0.02); b.arm(1, -0.2, 2.7, -0.6, -0.6); b.arm(-1, -0.2, 2.7, -0.6, -0.6); b.off(-0.03, 0, 0);
  c.rot(PEL, 0.4, 0, 0); c.leg(1, -0.4, 0.05, 0, 0.04); c.leg(-1, -0.4, 0.05, 0, 0.04); c.rot(SPI, 0.7, 0, 0); c.rot(CHE, 0.45, 0, 0); c.rot(HEA, 0.3, 0, 0);
  c.arm(1, -1.3, 0.05, -0.1); c.arm(-1, -1.3, 0.05, -0.1);
  return [a, b, c];
})();

export const CLIP_NAMES = [...ANIMS, 'walk_hold', 'idle_hold', 'sit_read', 'stand_work', 'swim_idle', 'swim', 'swim_under', 'walk_phone', 'phone_look', 'sit_drink',
  'eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon', 'eat_lap', 'eat_stand', 'eat_stand_hands', 'prep',
  'helm', 'fish_idle', 'fish_cast', 'fish_reel', 'fish_fight', 'fish_net', 'fish_show',
  'bar_idle'];   // (a player's clip goes to the server in 7 bits: 128 at most; bar_idle: a bartender with no order, chosen by render/agents.js)
export const CLIP = Object.fromEntries(CLIP_NAMES.map((n, i) => [n, i]));
export const NCLIP = CLIP_NAMES.length;
export const CLIP_DUR = new Float32Array(NCLIP);
export const CLIP_STRIDE = new Float32Array(NCLIP);
for (let c = 0; c < NCLIP; c++) {
  const d = DEF[CLIP_NAMES[c]] || DEF.idle;
  CLIP_DUR[c] = d.dur || 0;
  CLIP_STRIDE[c] = d.gait || 0;
}
// Character lab: clip timings come from the baked Tripo clips (charClips.js), not the procedural definitions above.
applyTripoTiming(CLIP_NAMES, CLIP_DUR, CLIP_STRIDE);
export const SEATED_CLIPS = new Set(['sit', 'sit_type', 'sit_talk', 'sit_eat', 'sit_relax', 'sit_high', 'sit_play', 'sit_phone', 'sit_read', 'sit_drink', 'piano', 'drive',
  'eat_hands', 'eat_hand', 'eat_knife', 'eat_spoon', 'eat_lap'].map(n => CLIP[n]));

/** Evaluate clip c at phase u into pose P (reset first). */
export function evalClip(c, u, P) {
  P.reset();
  const d = DEF[CLIP_NAMES[c]] || DEF.idle;
  d.fn(((u % 1) + 1) % 1, P);
  return P;
}

/** Forward kinematics -> 16 skinning matrices (model space, rest-pose vertices). */
export function skinMatrices(P, out) {
  const e = _e, rot = _rot, tmp = _tmp;
  for (let b = 0; b < NB; b++) {
    e.set(P.r[b * 3], P.r[b * 3 + 1], P.r[b * 3 + 2], 'ZXY');
    rot.makeRotationFromEuler(e);
    const w = _world[b];
    if (b === 0) {
      tmp.makeTranslation(PIVOT[0][0] + P.o[0], PIVOT[0][1] + P.o[1], PIVOT[0][2] + P.o[2]);
      w.multiplyMatrices(tmp, rot);
    } else {
      const p = PARENT[b];
      tmp.makeTranslation(PIVOT[b][0] - PIVOT[p][0], PIVOT[b][1] - PIVOT[p][1], PIVOT[b][2] - PIVOT[p][2]);
      w.multiplyMatrices(_world[p], tmp).multiply(rot);
    }
    tmp.makeTranslation(-PIVOT[b][0], -PIVOT[b][1], -PIVOT[b][2]);
    out[b].multiplyMatrices(w, tmp);
  }
  return out;
}
const _e = new THREE.Euler(), _rot = new THREE.Matrix4(), _tmp = new THREE.Matrix4();
const _world = Array.from({ length: NB }, () => new THREE.Matrix4());

export function bakeAnimTexture() {
  const texels = NCLIP * FRAMES * NB * 3;
  const H = Math.ceil(texels / TEX_W);
  const data = new Float32Array(TEX_W * H * 4);
  const P = new Pose(), mats = Array.from({ length: NB }, () => new THREE.Matrix4());
  for (let c = 0; c < NCLIP; c++) {
    for (let f = 0; f < FRAMES; f++) {
      evalClip(c, f / FRAMES, P);
      skinMatrices(P, mats);
      for (let b = 0; b < NB; b++) {
        const m = mats[b].elements, base = ((c * FRAMES + f) * NB + b) * 3 * 4;
        // rows of the 3x4 matrix (elements are column-major)
        data[base] = m[0]; data[base + 1] = m[4]; data[base + 2] = m[8]; data[base + 3] = m[12];
        data[base + 4] = m[1]; data[base + 5] = m[5]; data[base + 6] = m[9]; data[base + 7] = m[13];
        data[base + 8] = m[2]; data[base + 9] = m[6]; data[base + 10] = m[10]; data[base + 11] = m[14];
      }
    }
  }
  const tex = new THREE.DataTexture(data, TEX_W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
