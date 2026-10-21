#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Clips added to every baked character, and where each character holds things (client/assets/chars/extra-clips.json).
//
// Swimming (2026-10-05: treading water, swimming on the surface, swimming under water): posed from the character's idle
// stance by aiming its bones (spine, neck, head, arms, hands, legs, feet) along directions given per phase of each stroke,
// in the body's own frame (x its left, y up, z forward), with the whole body turned (prone for the strokes) about the
// hips. Aiming bones rather than adding angles makes the result the same on the A-posed and the T-posed rigs. Each stroke
// also gives the palm's direction per phase (2026-10-06: the strokes pushed the water with the backs of the hands);
// the forearm and the hand turn about their own length to face it, and the fingers lie flat along the hand: a paddle.
//
// Mended loops (2026-10-06: "a slight hitch" walking and running): the bake's walk and run don't close — the walk's
// first frames hold the hips ~5 cm forward, the run's two strides don't end where they began. Each is rebuilt from its own
// frames (LOOPS): the cleanest whole stride in it, played as often as the clip held strides, the hips' leftover offset over
// the stride taken out. They replace the bake's clips of the same name as the frames load.
//
// Holding (2026-10-07, agents working on a phone or a laptop, drinking a coffee, reading — the bake has no clip that holds
// anything): the walk (mended), the idle and the seated idle with an arm or both brought up to hold something — a cup in
// front, a phone looked at, a sip, an open book. Each hand is placed by reaching (two-bone: the elbow falls down and out)
// for a point given from the character's own shoulders and head, so it fits every body, and turned so its palm faces the
// way given; the fingers close round what it holds. Bones not posed go on as in the clip below (the walk's legs, the
// idle's sway, the other arm).
//
// Doing things (2026-10-07): cooking, washing up, browsing a shelf, using a machine, a dumbbell curl, a ping-pong forehand
// — short loops posed the same way on the idle's first stance (still: the legs stand), so a cook stirs and a shopper
// reaches for the shelf instead of looking round.
//
// Eating at a table (2026-10-07, "proper eating animations depending on the meal"): four seated clips — a burger or
// a sandwich in both hands, a slice or a pastry in one, knife and fork (cutting, then the fork to the mouth), and one
// hand with a spoon, a fork or chopsticks (two spoonfuls a cycle). Each reaches for the dish where render/food-table.js
// puts it and for the mouth as the head bows, leaning in from the hips; what is held is placed in the hand by the grip
// points of shared/eating.js (the same ones render/char-props.js draws it at), so a fork's tines meet the lips and the
// dish whatever the body.
//
// Grips: where each character holds things, written to extra-clips.json for the renderer (render/char-props.js): per hand,
// a frame in bind space at the palm (y along the fingers, z out of the palm, x = y × z; origin on the palm's surface), so
// a thing drawn in that frame and moved by the hand's bone sits in the palm in every clip; and the desk: where a seated
// typist's fingers rest (root space), for a laptop on the table under them.
//
// Writes, next to the characters: <kind>.extra.bin (the new frames: 3 rows of RGBA half floats per bone per frame, as in
// the bake) and extra-clips.json (the clips, the kinds that have them, the grips). The browser appends the frames to each
// character's animation texture as it loads (render/characters.js). The big .bin files are not touched.
// Usage: node tools/chars/extra-clips.mjs [--only f01,m15] [--check] [--verify [--no-twist]]   (--check: prints joint
// residuals; --verify: how well each stroke's palms lead the hands through the water and how well each hold reaches its
// mark; neither writes anything)
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  TAU, PI, f2h, mul, app, rotv, I, add, sub, scale, len, nrm, cross, dot, rotAbout, V, mir, lerpDir, smooth, keyed,
  loadRig, frameOf, jointsOf, palmsOf, poseFrom, kindsIn, inv, AIM,
} from './rig.mjs';
import { BOTH_R, BOTH_LIFT, BITE_TIP, toolTip, toolDir, TABLE_TOP, DISH_AHEAD, WRIST_MAX, STOVE_PAN, PREP_BOARD } from '../../shared/eating.js';

const { values: o } = parseArgs({ options: { only: { type: 'string' }, check: { type: 'boolean' }, verify: { type: 'boolean' }, 'no-twist': { type: 'boolean' }, dir: { type: 'string' } } });
const DIR = path.resolve(o.dir || 'client/assets/chars');

// ------------------------------------------------------------------ the strokes (directions in the body's frame)
const STRAIGHT = { Spine: V(0, 1, 0), Spine1: V(0, 1, 0), Spine2: V(0, 1, 0) };
const FLAT = { Left: 'flat', Right: 'flat' };
export const CLIPS = [
  { // treading water, upright: sculling hands, an eggbeater kick
    name: 'swim_idle', frames: 36, dur: 2.4, stride: 0,
    pose(u) {
      const s = Math.sin(TAU * 2 * u), c = Math.cos(TAU * 2 * u), d = {};
      Object.assign(d, { Spine: V(0, 1, 0.08), Spine1: V(0, 1, 0.04), Spine2: V(0, 1, 0), Neck: V(0, 1, 0.12), Head: V(0, 1, 0.06) });
      const arm = V(0.78, -0.42, 0.3 + 0.3 * s), fore = V(0.42 - 0.38 * s, -0.22, 0.88), hand = V(0.42 - 0.5 * s, -0.4, 0.8);
      Object.assign(d, { LeftArm: arm, LeftForeArm: fore, LeftHand: hand, RightArm: mir(arm), RightForeArm: mir(fore), RightHand: mir(hand) });
      // sculling: the palms face down, tilted toward the way the hands sweep (out, then in)
      const palm = V(-0.55 * c, -1, 0.1);
      d.palm = { Left: palm, Right: mir(palm) };
      for (const [side, ph] of [['Left', 0], ['Right', PI]]) {
        const t = TAU * u + ph, k = side === 'Left' ? 1 : -1, cs = Math.cos(t), sn = Math.sin(t);
        d[side + 'UpLeg'] = V(k * (0.28 + 0.14 * cs), -0.78, 0.42 + 0.26 * sn);
        d[side + 'Leg'] = V(k * (0.32 + 0.2 * sn), -0.86, -0.38 + 0.22 * cs);
        d[side + 'Foot'] = V(k * 0.25, -0.45, 0.86);
      }
      return { pitch: 0.1, roll: 0, dy: 0.025 * Math.sin(TAU * 2 * u + 0.6), d, hands: FLAT };
    },
  },
  { // the front crawl on the surface: arms over in turn, the body rolling with them, a six-beat flutter kick
    name: 'swim', frames: 36, dur: 1.5, stride: 1.95,
    pose(u) {
      const d = { ...STRAIGHT, Neck: V(0, 1, -0.05), Head: V(0, 1, -0.32) };   // the head lifted to see ahead
      for (const [side, ph] of [['Left', 0], ['Right', PI]]) {
        const f = (TAU * u + ph) % TAU, k = side === 'Left' ? 1 : -1;
        let arm, fore;
        if (f < PI) {   // the pull: from reaching ahead, down under the body (+z, toward the bottom) to the hip
          arm = V(k * 0.12, Math.cos(f), 0.95 * Math.sin(f) + 0.05);
          fore = nrm([arm[0], arm[1] * 0.85, arm[2] + 0.45 * Math.sin(f)]);
        } else {        // the recovery: the elbow high over the back (−z), the forearm hanging toward the water
          arm = V(k * (0.3 + 0.25 * Math.sin(f - PI)), Math.cos(f), 0.7 * Math.sin(f));
          fore = nrm([k * 0.15, Math.cos(f) * 0.9 + 0.1, 0.55 + 0.35 * Math.sin(f)]);
        }
        const hand = nrm([fore[0], fore[1], fore[2] + 0.15]);
        Object.assign(d, { [side + 'Arm']: arm, [side + 'ForeArm']: fore, [side + 'Hand']: hand });
        // the palm (prone: y is ahead, z toward the bottom): down at the catch, back toward the feet through the pull,
        // up to the thigh at the exit, back and out over the water, down again for the entry
        (d.palm ||= {})[side] = keyed([[0, V(-k * 0.1, 0.05, 1)], [0.25, V(-k * 0.1, -1, 0.1)], [0.47, V(-k * 0.45, -0.35, -0.8)], [0.66, V(k * 0.6, -0.8, -0.15)], [0.88, V(k * 0.4, 0.1, 0.9)]], f / TAU);
        const t = TAU * 3 * u + ph;
        d[side + 'UpLeg'] = V(k * 0.07, -1, 0.17 * Math.sin(t));
        d[side + 'Leg'] = V(k * 0.06, -1, 0.17 * Math.sin(t) + 0.22 * Math.max(0, Math.sin(t - 0.9)));
        d[side + 'Foot'] = V(k * 0.05, -1, 0.3);   // toes pointed
      }
      return { pitch: 1.42, roll: 0.34 * Math.sin(TAU * u + PI / 2), dy: 0, d, hands: FLAT };
    },
  },
  { // under water: a breaststroke — a sweep out and in, a frog kick, then a glide
    name: 'swim_under', frames: 40, dur: 1.9, stride: 1.6,
    pose(u) {
      const d = { ...STRAIGHT, Neck: V(0, 1, -0.08), Head: V(0, 1, -0.38) };   // the head lifted to look ahead: aimed along the spine it folded down and showed the neck (2026-10-05)
      const aKeys = [[0.0, V(0.12, 1, 0.05)], [0.28, V(0.92, 0.25, 0.3)], [0.42, V(0.75, -0.2, 0.62)], [0.55, V(0.3, 0.35, 0.9)], [0.72, V(0.1, 1, 0.12)]];
      const fKeys = [[0.0, V(0.05, 1, 0.05)], [0.28, V(0.55, 0.45, 0.7)], [0.42, V(0.1, 0.2, 1)], [0.55, V(-0.2, 0.85, 0.5)], [0.72, V(0.03, 1, 0.05)]];
      const uKeys = [[0.0, V(0.06, -1, 0)], [0.4, V(0.12, -1, 0.05)], [0.55, V(0.42, -0.62, 0.66)], [0.7, V(0.6, -0.8, 0.05)], [0.82, V(0.08, -1, 0)]];
      const lKeys = [[0.0, V(0.05, -1, 0)], [0.4, V(0.08, -1, 0.05)], [0.55, V(0.5, 0.3, -0.81)], [0.7, V(0.62, -0.78, -0.1)], [0.82, V(0.05, -1, 0)]];
      const ftKeys = [[0.0, V(0, -1, 0.25)], [0.55, V(0.7, 0.1, 0.7)], [0.7, V(0.5, -0.6, 0.6)], [0.82, V(0, -1, 0.25)]];
      const arm = keyed(aKeys, u), fore = keyed(fKeys, u), up = keyed(uKeys, u), leg = keyed(lKeys, u), ft = keyed(ftKeys, u);
      Object.assign(d, { LeftArm: arm, LeftForeArm: fore, LeftHand: fore, RightArm: mir(arm), RightForeArm: mir(fore), RightHand: mir(fore),
        LeftUpLeg: up, LeftLeg: leg, LeftFoot: ft, RightUpLeg: mir(up), RightLeg: mir(leg), RightFoot: mir(ft) });
      // the palms: down in the glide, out and back on the outsweep, in and back on the insweep, together under the chest,
      // then down again as the hands shoot forward (the left hand's; the right mirrors it)
      const palm = keyed([[0.0, V(0.15, 0, 1)], [0.2, V(0.75, -0.2, 0.65)], [0.36, V(0.55, -0.75, 0.35)], [0.48, V(-0.6, -0.65, 0.45)], [0.6, V(-0.9, 0.1, 0.2)], [0.74, V(-0.2, 0, 1)]], u);
      d.palm = { Left: palm, Right: mir(palm) };
      return { pitch: 1.5, roll: 0, dy: 0.03 * Math.sin(TAU * u), d, hands: FLAT };
    },
  },
];

// ------------------------------------------------------------------ mended loops
export const LOOPS = ['walk', 'run'];
const LOOP_KEY = ['LeftFoot', 'RightFoot', 'LeftHand', 'RightHand', 'LeftLeg', 'RightLeg', 'LeftForeArm', 'RightForeArm', 'Spine2', 'Head'];
/** One clip's frames (k strides of `per` frames from `s`, the hips' drift over the stride removed), from the bake's M. */
function mendLoop(M, idx, c) {
  const hips = idx.Hips, key = LOOP_KEY.map(n => idx[n]);
  // a pose: the key bones' skinning, their translations from the hips' (so where the body drifts doesn't count)
  const pose = fr => { const h = M(fr, hips); return key.flatMap(b => M(fr, b).map((v, q) => (q % 4 === 3 ? v - h[q] : v))); };
  const P = Array.from({ length: c.len }, (_, k) => pose(c.off + k)), dist = (a, b) => Math.sqrt(a.reduce((t, v, i) => t + (v - b[i]) ** 2, 0));
  const steps = P.slice(1).map((p, k) => dist(P[k], p)).sort((x, y) => x - y), med = steps[steps.length >> 1];
  // the stride: a whole share of the clip (2 strides, 3 …) whose frame `per` on matches its first best
  let best = null;
  for (let k = 2; c.len / k >= c.len * 0.3; k++) {
    if (c.len % k) continue;
    const per = c.len / k;
    for (let s0 = 0; s0 + per < c.len; s0++) { const g = dist(P[s0], P[s0 + per]) / med; if (!best || g < best.gap) best = { k, per, s: s0, gap: g }; }
  }
  const { k, per, s: s0 } = best, H = f => { const m = M(c.off + f, hips); return [m[3], m[7], m[11]]; };
  const h0 = H(s0), h1 = H(s0 + per), drift = [h1[0] - h0[0], h1[1] - h0[1], h1[2] - h0[2]];
  const frames = [];
  for (let r = 0; r < k; r++) for (let j = 0; j < per; j++) {
    const t = j / per, row = [];
    for (let b = 0; b < M.NB; b++) { const m = M(c.off + s0 + j, b).slice(); m[3] -= drift[0] * t; m[7] -= drift[1] * t; m[11] -= drift[2] * t; row.push(m); }
    frames.push(row);
  }
  return { frames, k, per, s: s0, gap: best.gap, seamBefore: dist(P[c.len - 1], P[0]) / med };
}

// ------------------------------------------------------------------ holding
/**
 * Arm directions that put the wrist at `target` (two bones from the shoulder `S`, lengths a and b), the elbow falling
 * toward `pole`. Out of reach: as near as the arm goes.
 */
function reach(S, a, b, target, pole) {
  const tv = sub(target, S), d0 = len(tv), d = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, d0)), u = scale(tv, 1 / (d0 || 1));
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const pp = nrm(sub(pole, scale(u, dot(pole, u)))), E = add(add(S, scale(u, x)), scale(pp, h)), T = add(S, scale(u, d));
  return { arm: nrm(sub(E, S)), fore: nrm(sub(T, E)) };
}
/**
 * Where to hold: { side: { at → wrist point, along (fingers' way), palm, grip, pole } } from the body's landmarks L
 * (its joints in the base frame, the mouth, L.at(side, offsets): a point from a shoulder for an arm of 0.46 m), all in
 * the body's frame. The base clip goes on wherever nothing is
 * held; `head` tilts the neck and head forward (radians) to look at what is held.
 */
export const HOLDS = [
  { // a cup or a coffee carried in front while walking; the arm swings a little with the stride
    name: 'hold_walk', base: 'walk', step: 1,
    pose(u, L) {
      const sw = Math.sin(TAU * u);   // (the walk's arm swing, much smaller)
      return { Right: { at: L.at('Right', [0.06, -0.25 + 0.012 * Math.sin(TAU * 2 * u), 0.27 + 0.02 * sw]), along: V(0.35, 0.12, 1), palm: V(1, 0.05, -0.3), grip: 0.85, pole: V(-0.45, -1, -0.35) } };
    },
  },
  { // a phone looked at while walking: held up in front of the chest, the head bowed to it
    name: 'hold_walk_phone', base: 'walk', step: 1,
    pose(u, L) {
      return { head: 0.32, Right: { at: L.at('Right', [0.11, -0.26 + 0.01 * Math.sin(TAU * 2 * u), 0.27]), along: V(0.55, 0.45, 0.7), palm: V(0.25, 0.55, -0.8), grip: 0.5, pole: V(-0.4, -1, -0.25) } };
    },
  },
  { // standing with a cup or a coffee in hand
    name: 'hold_idle', base: 'idle', step: 2,
    pose(u, L) {
      return { Right: { at: L.at('Right', [0.06, -0.24 + 0.01 * Math.sin(TAU * 3 * u), 0.26]), along: V(0.35, 0.12, 1), palm: V(1, 0.05, -0.3), grip: 0.85, pole: V(-0.45, -1, -0.35) } };
    },
  },
  { // standing, looking at a phone held in both hands (texting, reading, working on it)
    name: 'hold_phone', base: 'idle', step: 2,
    pose(u, L) {
      const tap = 0.006 * Math.sin(TAU * 9 * u);
      return { head: 0.42,
        Right: { at: L.at('Right', [0.12, -0.27 + tap, 0.26]), along: V(0.6, 0.45, 0.65), palm: V(0.2, 0.6, -0.78), grip: 0.45, pole: V(-0.4, -1, -0.2) },
        Left: { at: L.at('Left', [-0.12, -0.28 - tap, 0.25]), along: V(-0.6, 0.45, 0.65), palm: V(-0.2, 0.6, -0.78), grip: 0.45, pole: V(0.4, -1, -0.2) } };
    },
  },
  { // standing with a drink, two sips a cycle: the cup comes up to the mouth and tips
    name: 'hold_drink', base: 'idle', step: 2,
    pose(u, L) {
      const sip = Math.max(smooth(1 - Math.abs(u - 0.3) / 0.13), smooth(1 - Math.abs(u - 0.78) / 0.13));
      const low = { at: L.at('Right', [0.06, -0.24, 0.26]), along: V(0.35, 0.12, 1), palm: V(1, 0.05, -0.3) };
      // at the mouth: the palm toward the face's middle, the fingers ahead, the cup's top tipped toward the lips
      const along = V(0.35, 0.25, 0.9), palm = V(0.9, -0.1, -0.35);
      return { head: -0.08 * sip, Right: { at: lerpPt(low.at, L.sipWrist(along, palm), sip), along: lerpDir(low.along, along, sip), palm: lerpDir(low.palm, palm, sip), grip: 0.85, pole: V(-0.5, -1, -0.15) } };
    },
  },
  { // seated, looking at a phone in both hands
    name: 'hold_sit_phone', base: 'sit_idle', step: 2,
    pose(u, L) {
      const tap = 0.006 * Math.sin(TAU * 7 * u);
      return { head: 0.45,
        Right: { at: L.at('Right', [0.12, -0.3 + tap, 0.27]), along: V(0.6, 0.45, 0.65), palm: V(0.2, 0.6, -0.78), grip: 0.45, pole: V(-0.4, -1, -0.15) },
        Left: { at: L.at('Left', [-0.12, -0.31 - tap, 0.26]), along: V(-0.6, 0.45, 0.65), palm: V(-0.2, 0.6, -0.78), grip: 0.45, pole: V(0.4, -1, -0.15) } };
    },
  },
  { // seated with a drink at a table: held low, a sip now and then
    name: 'hold_sit_drink', base: 'sit_idle', step: 2,
    pose(u, L) {
      const sip = smooth(1 - Math.abs(u - 0.62) / 0.16);
      // held on the table (its top where the fingertips rest typing: L.desk), the cup's foot on it
      const low = { at: add(L.desk, [-0.15 * L.k, 0.05, -0.17]), along: V(0.4, 0.05, 1), palm: V(1, 0.05, -0.35) };
      const along = V(0.35, 0.25, 0.9), palm = V(0.9, -0.1, -0.35);
      return { head: -0.06 * sip, Right: { at: lerpPt(low.at, L.sipWrist(along, palm), sip), along: lerpDir(low.along, along, sip), palm: lerpDir(low.palm, palm, sip), grip: 0.85, pole: V(-0.5, -1, -0.1) } };
    },
  },
  { // seated, reading an open book held in both hands; a page turned once a cycle
    name: 'hold_sit_read', base: 'sit_idle', step: 2,
    pose(u, L) {
      const turn = smooth(1 - Math.abs(u - 0.8) / 0.06);
      return { head: 0.38,
        Right: { at: L.at('Right', [0.08, -0.33, 0.27]), along: V(0.3, 0.35, 0.9), palm: V(0.45, 0.8, -0.4), grip: 0.35, pole: V(-0.4, -1, -0.1) },
        Left: { at: L.at('Left', [-0.08 - 0.06 * turn, -0.33 + 0.03 * turn, 0.27]), along: V(-0.3, 0.35, 0.9), palm: V(-0.45, 0.8, -0.4), grip: 0.35, pole: V(0.4, -1, -0.1) } };
    },
  },
  // ---- doing things with the hands (2026-10-07: cooking, washing up, browsing a shelf, a machine, the gym played the
  // idle's look round or a stretch): short loops on the idle's first, still stance — each frame is downloaded
  { // stirring a pot on the stove, the other hand on its handle
    // — in the pan on the stove's front right burner (shared/eating.js STOVE_PAN: render/food-table.js puts it there), a
    // spoon in the right hand (render/char-props.js), the left on the pan's handle (2026-10-08: it stirred the air)
    name: 'act_cook', base: 'idle', still: 1, frames: 32, dur: 2.4,
    pose(u, L) {
      const a = TAU * u, P0 = STOVE_PAN, tip = [P0[0] + 0.035 * Math.cos(a), P0[1] + 0.03, P0[2] + 0.035 * Math.sin(a)];
      const sp = L.aimTool(toolDir(false), V(0.3, -0.8, 0.5), V(0.3, -0.9, 0.2));
      return { head: 0.5, lean: 0.2,
        Right: { p: toolTip(false), target: tip, along: sp.along, palm: sp.palm, grip: 0.75, pole: V(-0.8, -0.9, -0.3) },
        Left: { p: [0, 0, 0.014], target: [P0[0] + 0.21, P0[1] + 0.045, P0[2] - 0.01], along: V(-0.25, -0.15, 1), palm: V(0.05, -1, 0.05), grip: 0.85, pole: V(0.8, -1, -0.3) } };
    },
  },
  { // washing up at a sink: both hands down in it, scrubbing back and forth
    name: 'act_wash', base: 'idle', still: 1, frames: 24, dur: 2,
    pose(u, L) {
      const sw = Math.sin(TAU * u);
      return { head: 0.42,
        Right: { at: L.at('Right', [0.1 + 0.04 * sw, -0.34, 0.25 + 0.02 * Math.cos(TAU * u)]), along: V(0.35, -0.6, 0.75), palm: V(0.5, -0.4, -0.3), grip: 0.4, pole: V(-0.5, -1, -0.3) },
        Left: { at: L.at('Left', [-0.1 + 0.04 * sw, -0.34, 0.25]), along: V(-0.35, -0.6, 0.75), palm: V(-0.5, -0.4, -0.3), grip: 0.4, pole: V(0.5, -1, -0.3) } };
    },
  },
  { // at a shelf: reaches for something, brings it close to look at, puts it back
    name: 'act_browse', base: 'idle', still: 1, frames: 48, dur: 6,
    pose(u, L) {
      const shelf = L.at('Right', [0.05, -0.1, 0.44]), look = L.at('Right', [0.13, -0.24, 0.27]);
      const k = u < 0.2 ? smooth(u / 0.2) : u < 0.55 ? 1 : u < 0.75 ? 1 - smooth((u - 0.55) / 0.2) : 0;   // 0 at the shelf, 1 held close
      return { head: 0.12 + 0.2 * k,
        Right: { at: lerpPt(shelf, look, k), along: lerpDir(V(0.1, 0.05, 1), V(0.45, 0.35, 0.8), k), palm: lerpDir(V(0.9, -0.1, 0.1), V(0.3, 0.8, -0.5), k), grip: 0.7, pole: V(-0.5, -1, -0.2) } };
    },
  },
  { // using a machine (a coffee machine, a ticket machine, a printer): pressing its buttons
    name: 'act_use', base: 'idle', still: 1, frames: 24, dur: 2,
    pose(u, L) {
      const press = Math.max(0, Math.sin(TAU * 2 * u)) ** 2;
      return { head: 0.1,
        Right: { at: L.at('Right', [0.09 + 0.03 * Math.sin(TAU * u), -0.16, 0.38 + 0.035 * press]), along: V(0.15, 0.05, 1), palm: V(0.2, -1, 0.1), grip: 0.55, pole: V(-0.5, -1, -0.25) } };
    },
  },
  { // a dumbbell curl with the right arm: the elbow by the side, the forearm up to the shoulder and down
    name: 'act_lift', base: 'idle', still: 1, frames: 32, dur: 3,
    pose(u, L) {
      const t = 0.5 - 0.5 * Math.cos(TAU * u), ang = 0.15 + 2.2 * t;   // the forearm's angle up from hanging
      const fore = V(0.05, -Math.cos(ang), Math.sin(ang) + 0.05);
      return { Right: { arm: V(-0.08, -1, 0.08), fore, along: fore, palm: V(0.2, Math.sin(ang) * 0.3, Math.cos(ang) * 0.3 + 0.7), grip: 1, pole: V(-0.4, -1, -0.3) } };
    },
  },
  { // a ping-pong forehand: back and low, then through and up across the body
    name: 'act_pingpong', base: 'idle', still: 1, frames: 24, dur: 1.2,
    pose(u, L) {
      const k = u < 0.55 ? smooth(u / 0.55) : 1 - smooth((u - 0.55) / 0.45);   // 0 drawn back, 1 swung through
      return { head: 0.05,
        Right: { at: lerpPt(L.at('Right', [-0.08, -0.3, 0.12]), L.at('Right', [0.24, -0.16, 0.33]), k), along: lerpDir(V(-0.4, 0.1, 0.9), V(0.6, 0.25, 0.75), k), palm: lerpDir(V(-0.2, 0, 1), V(0.6, 0.1, 0.8), k), grip: 0.9, pole: V(-0.6, -1, -0.1) },
        Left: { at: L.at('Left', [-0.02, -0.3, 0.2]), along: V(0, -0.4, 1), palm: V(-0.6, -0.3, 0.2), grip: 0.4, pole: V(0.5, -1, -0.2) } };
    },
  },
  // ---- eating at a table (2026-10-07): on the seated idle's first, still stance; `k` runs 0 at the dish → 1 at the mouth
  // in both hands (a burger, a sandwich, a wrap): held over the dish, up to the mouth for a bite, held up chewing, down
  { name: 'eat_hands', base: 'sit_idle', still: 1, frames: 48, dur: 6, pose: bothHands(() => [0, TABLE_TOP + 0.1, DISH_AHEAD - 0.12]) },
  // in one hand (a slice, a fry, a cookie): picked up from the dish's right side, to the mouth from the right, down; the
  // other hand rests on the table by the dish
  { name: 'eat_hand', base: 'sit_idle', still: 1, frames: 48, dur: 6, pose: oneHand(() => [-0.035, TABLE_TOP + 0.05, DISH_AHEAD - 0.03], L => L.restLeft()) },
  // with no table (2026-10-08, no table, the food in the hands): on a seat, held over the lap, the other hand on
  // the thigh (both hands: eat_hands, its rest needs no table); standing in the kitchen, held in front, the other arm down
  { name: 'eat_lap', base: 'sit_idle', still: 1, frames: 48, dur: 6, pose: oneHand(L => [-0.035, L.Hips[1] + 0.14, L.Hips[2] + 0.32], L => L.restLap()) },
  { name: 'eat_stand', base: 'idle', still: 1, frames: 48, dur: 6, pose: oneHand(L => [-0.05, L.Hips[1] + 0.2, L.Hips[2] + 0.3], () => null) },
  { name: 'eat_stand_hands', base: 'idle', still: 1, frames: 48, dur: 6, pose: bothHands(L => [0, L.Hips[1] + 0.24, L.Hips[2] + 0.3]) },
  { // making something cold on a counter's board (a home without a stove, 2026-10-08): the knife chops, the other hand
    // holds what is cut (shared/eating.js PREP_BOARD: render/food-table.js puts the dish there)
    name: 'act_prep', base: 'idle', still: 1, frames: 24, dur: 2,
    pose(u, L) {
      const B = PREP_BOARD, chop = Math.max(0, Math.sin(TAU * 3 * u)) ** 0.7;
      const kn = L.aimTool(toolDir(false), V(0.55, -0.5, 0.67), V(-0.2, -1, 0.1));
      return { head: 0.55, lean: 0.22,
        Right: { p: toolTip(false), target: [B[0] - 0.05, B[1] + 0.006 + 0.045 * chop, B[2] - 0.03], along: kn.along, palm: kn.palm, grip: 0.8, pole: V(-0.8, -0.9, -0.3) },
        Left: { p: [0, 0, 0.02], target: [B[0] + 0.05, B[1] + 0.025, B[2] - 0.02], along: V(-0.35, -0.2, 0.92), palm: V(0.1, -1, 0.1), grip: 0.45, pole: V(0.8, -1, -0.3) } };
    },
  },
  { // knife and fork: cutting (the fork holds, the knife saws), the fork to the mouth (its tines down), chewing
    name: 'eat_knife', base: 'sit_idle', still: 1, frames: 64, dur: 8,
    pose(u, L) {
      const k = ks([[0, 0], [0.34, 0], [0.47, 1], [0.53, 1], [0.66, 0], [1, 0]], u);
      const cut = u < 0.32 ? Math.sin(TAU * 3 * u / 0.32) * smooth(Math.min(u, 0.32 - u) / 0.04) : 0;
      const chew = u > 0.62 ? 0.018 * Math.sin(TAU * 8 * u) : 0, head = 0.4 - 0.3 * k + chew, m = L.mouthAt(head);
      // the knife: its point in the food right of the middle, sawing along itself; it rests on the plate's edge while the
      // fork is up
      const kn = L.aimTool(toolDir(false), V(0.4, -0.5, 0.77), V(-0.25, -1, 0.1)), kd = nrm([0.4, -0.5, 0.77]);
      const kTip = add(lerpPt([-0.02, TABLE_TOP + 0.022, DISH_AHEAD - 0.01], [-0.085, TABLE_TOP + 0.03, DISH_AHEAD - 0.06], smooth(k)), scale(kd, 0.02 * cut));
      // the fork: tines down in the food left of the knife, then up to the lips (the hand out front-left, the fork aimed back)
      const fk = L.aimTool(toolDir(true), lerpDir(V(-0.4, -0.55, 0.73), V(-0.45, 0.28, -0.85), k), lerpDir(V(0.25, -1, 0.1), V(0, -1, 0.15), k));
      const fTip = lerpPt([0.035, TABLE_TOP + 0.026, DISH_AHEAD + 0.005], add(m, [0, -0.004, 0.006]), smooth(k));
      return { head, lean: 0.08 + 0.06 * k,
        Right: { p: toolTip(false), target: kTip, along: kn.along, palm: kn.palm, grip: 0.8, pole: V(-0.9, -0.8, -0.35) },
        Left: { p: toolTip(true), target: fTip, along: fk.along, palm: fk.palm, grip: 0.8, pole: V(0.9, -0.8, -0.35) } };
    },
  },
  { // a spoon, a fork or chopsticks in the right hand: into the bowl or the plate, up to the lips level, twice a cycle;
    // the other hand rests on the table by the dish
    name: 'eat_spoon', base: 'sit_idle', still: 1, frames: 56, dur: 7,
    pose(u, L) {
      const k = ks([[0, 0], [0.12, 0], [0.24, 1], [0.3, 1], [0.42, 0], [0.56, 0], [0.68, 1], [0.74, 1], [0.86, 0], [1, 0]], u);
      const head = 0.42 - 0.3 * k, m = L.mouthAt(head);
      const sp = L.aimTool(toolDir(false), lerpDir(V(0.35, -0.6, 0.72), V(0.5, 0.15, -0.85), k), lerpDir(V(0.45, -0.9, 0), V(0.3, -1, 0.1), k));
      const tip = lerpPt([0, TABLE_TOP + 0.045, DISH_AHEAD - 0.015], add(m, [0, -0.004, 0.008]), smooth(k));
      return { head, lean: 0.07 + 0.07 * k,
        Right: { p: toolTip(false), target: tip, along: sp.along, palm: sp.palm, grip: 0.7, pole: V(-0.85, -0.85, -0.3) },
        Left: L.restLeft() };
    },
  },
  // ---- out in a boat (2026-10-14, the fishing game: docs/features/fishing.md §The angler): at the wheel; a rod held
  // ready, the cast, reeling, fighting a fish (leaning back, pumping), landing it in the net, the catch held up. The rod
  // runs through the right fist along its grip's x (render/char-props.js rod), so the hand is turned to point it (rodPose).
  { // both hands on the wheel in front, steering a little
    name: 'helm', base: 'idle', still: 1, frames: 24, dur: 3,
    pose(u, L) {
      const sw = 0.025 * Math.sin(TAU * u);
      return { head: 0.06,
        Right: { at: L.at('Right', [0.11, -0.2 + sw, 0.33]), along: V(0.5, 0.45, 0.75), palm: V(0.35, -0.8, 0.3), grip: 0.85, pole: V(-0.5, -1, -0.3) },
        Left: { at: L.at('Left', [-0.11, -0.2 - sw, 0.33]), along: V(-0.5, 0.45, 0.75), palm: V(-0.35, -0.8, 0.3), grip: 0.85, pole: V(0.5, -1, -0.3) } };
    },
  },
  { // the rod held ready, forward and up: the right fist at the reel before the belly, the left on the fore grip
    name: 'fish_idle', base: 'idle', still: 1, frames: 24, dur: 4,
    pose(u, L) { return rodPose(L, V(-0.1, 0.6, 0.8), [0.14, -0.28 + 0.01 * Math.sin(TAU * u), 0.15], 0.06, 0.12); },
  },
  { // a cast: the rod swung back over the right shoulder, snapped forward to point the line out, the follow-through
    name: 'fish_cast', base: 'idle', still: 1, frames: 30, dur: 1.3,
    pose(u, L) {
      const ready = V(-0.12, 0.55, 0.83), back = V(-0.1, 0.75, -0.65), out = V(-0.08, 0.2, 0.98);
      const k = u < 0.32 ? smooth(u / 0.32) : u < 0.52 ? 1 - smooth((u - 0.32) / 0.2) : 0;           // 1: all the way back
      const f = u < 0.32 ? 0 : u < 0.52 ? smooth((u - 0.32) / 0.2) * 1 : 1 - 0.6 * smooth((u - 0.52) / 0.48);   // the snap past ready, settling
      const D = nrm(lerpDir(lerpDir(ready, out, f), back, k));
      const w = lerpPt(lerpPt([0.14, -0.28, 0.15], [0.13, -0.26, 0.2], f), [0.12, 0.0, 0.04], k);
      return { ...rodPose(L, D, w, 0.06 - 0.1 * k, 0.12 - 0.37 * smooth(k)), lean: -0.08 * k + 0.1 * f * (1 - k) };   // (the left hand down to the butt as it goes back)
    },
  },
  { // reeling: the rod held up, the left hand turning the reel's handle round under it
    name: 'fish_reel', base: 'idle', still: 1, frames: 16, dur: 0.9,
    pose(u, L) {
      const D = nrm(V(-0.1, 0.7, 0.7)), P = rodPose(L, D, [0.13, -0.22, 0.13], 0.1), a = TAU * u;
      const hub = add(P.rodAt, add(scale(D, 0.07), [0.07 * L.k, -0.09 * L.k, 0]));                 // the reel under the rod, its handle out to the left
      const up = nrm(cross(D, V(1, 0, 0))), r = 0.055 * L.k;
      const knob = add(hub, add(scale(up, r * Math.cos(a)), scale(D, r * Math.sin(a))));
      P.Left = { at: L.wristFor('Left', V(0.3, -0.6, 0.6), V(1, 0.1, 0.2), [0, 0, 0], knob), along: V(0.3, -0.6, 0.6), palm: V(1, 0.1, 0.2), grip: 0.7, pole: V(0.6, -1, -0.2) };
      delete P.rodAt; return P;
    },
  },
  { // fighting a fish: leaning back, the rod high, the left hand up it, pumping it up, then down again winning line
    name: 'fish_fight', base: 'idle', still: 1, frames: 32, dur: 1.8,
    pose(u, L) {
      const pump = 0.5 - 0.5 * Math.cos(TAU * u), D = nrm(lerpDir(V(-0.1, 0.62, 0.78), V(-0.08, 0.93, 0.36), pump));
      return { ...rodPose(L, D, [0.13, -0.28 + 0.12 * pump, 0.15 - 0.03 * pump], -0.05, 0.16), lean: -0.15 - 0.07 * pump };
    },
  },
  { // landing it: bent forward over the side, both hands on the net's handle (the right at its grip, the left down it),
    // reaching it out and down to the water, then scooping up
    name: 'fish_net', base: 'idle', still: 1, frames: 28, dur: 1.6,
    pose(u, L) {
      const k = u < 0.55 ? smooth(u / 0.55) : 1 - 0.6 * smooth((u - 0.55) / 0.45);   // reaching down, then lifting
      const D = nrm(lerpDir(V(-0.1, -0.12, 0.99), V(-0.08, -0.58, 0.81), k));
      return { ...rodPose(L, D, [0.13, -0.18 - 0.04 * k, 0.08 + 0.04 * k], 0.35 + 0.15 * k, 0.13), lean: 0.2 + 0.25 * k };
    },
  },
  { // the catch held up to show it: both hands before the chest a little apart, palms up under it
    name: 'fish_show', base: 'idle', still: 1, frames: 24, dur: 3,
    pose(u, L) {
      const b = 0.012 * Math.sin(TAU * u);
      return { head: -0.04,
        Right: { at: L.at('Right', [0.06, -0.2 + b, 0.33]), along: V(0.65, 0.1, 0.75), palm: V(0.1, 1, -0.15), grip: 0.6, pole: V(-0.6, -1, -0.2) },
        Left: { at: L.at('Left', [-0.06, -0.2 + b, 0.33]), along: V(-0.65, 0.1, 0.75), palm: V(-0.1, 1, -0.15), grip: 0.6, pole: V(0.6, -1, -0.2) } };
    },
  },
];
/**
 * Holding a rod pointed along D (the body's frame: x the left, y up, z ahead): the right fist at `wrist` (from the right
 * shoulder, as L.at) turned so its grip's x lies along the rod (the thumb on top, the reel hanging below in the fingers),
 * the left hand `ahead` metres up the rod from the right's grip (behind it: on the butt), its thumb toward the tip; the
 * head bowed `head`.
 * rodAt: where the rod passes through the right fist. A shorter arm than that reaches takes the left hand along the rod
 * toward the right one (no nearer than a hand's breadth), until it can.
 */
function rodPose(L, D, wrist, head = 0.04, ahead = -0.22) {
  const d = nrm(D), square = v => nrm(sub(v, scale(d, dot(v, d))));
  const palmR = square(V(1, 0.15, 0)), alongR = nrm(cross(palmR, d));     // (x = y × z = d)
  const palmL = scale(palmR, -1), alongL = nrm(cross(d, palmL));          // (the left's x is its little finger's side: back down the rod)
  const R = L.at('Right', wrist), rodAt = sub(R, L.wristFor('Right', alongR, palmR, [0, 0, 0], [0, 0, 0]));
  const far = 0.46 * L.k * 0.96, sg = Math.sign(ahead) || 1;
  let a = Math.abs(ahead), wl;
  for (;;) {
    wl = L.wristFor('Left', alongL, palmL, [0, 0, 0], add(rodAt, scale(d, sg * a * L.k)));
    if (len(sub(wl, L.LeftArm)) <= far || a <= 0.095) break;
    a = Math.max(0.095, a - 0.01);
  }
  return { head, rodAt,
    Right: { at: R, along: alongR, palm: palmR, grip: 0.95, pole: V(-0.5, -1, -0.3) },
    Left: { at: wl, along: alongL, palm: palmL, grip: 0.9, pole: V(0.6, -1, -0.2) } };
}
function lerpPt(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
/** Eating with both hands (a burger, a sandwich): its middle held at rest(L), up to the mouth for a bite, held up
 *  chewing, down again. */
function bothHands(rest) {
  return (u, L) => {
    const k = ks([[0, 0], [0.2, 0], [0.36, 1], [0.45, 1], [0.58, 0.45], [0.84, 0.45], [1, 0]], u);
    const chew = u > 0.5 && u < 0.86 ? 0.02 * Math.sin(TAU * 9 * u) : 0, head = 0.34 - 0.27 * Math.min(1, k * 1.3) + chew;
    const m = L.mouthAt(head);
    // its middle: at rest, held up in front of the chin, or its back edge at the lips
    const up = add(m, [0, -0.13, 0.15]), bite = add(m, [0, -0.012, BOTH_R]);
    const C = k < 0.45 ? lerpPt(rest(L), up, smooth(k / 0.45)) : lerpPt(up, bite, smooth((k - 0.45) / 0.55));
    // the palms face each other across it, the fingers up over its top (BOTH_LIFT: then it stands upright), its far
    // side tipped up a little toward the mouth as it rises
    const lift = BOTH_LIFT + 0.12 * k, along = V(0.08, Math.sin(lift), Math.cos(lift)), palm = V(1, 0, -0.06), p = [0, -0.012, BOTH_R];
    return { head, lean: 0.04 + 0.1 * smooth(k),
      Right: { p, target: C, along, palm, grip: 0.38, pole: V(-0.8, -1, -0.3) },
      Left: { p, target: C, along: mir(along), palm: mir(palm), grip: 0.38, pole: V(0.8, -1, -0.3) } };
  };
}
/** Eating with one hand (a slice, a fry, a cookie): the bitten end held at rest(L) (the palm up, it lies on the
 *  fingers), into the mouth from the right (the palm turned in), down again; left(L): the other hand (null: as it was). */
function oneHand(rest, left) {
  return (u, L) => {
    const k = ks([[0, 0], [0.22, 0], [0.38, 1], [0.46, 1], [0.62, 0], [1, 0]], u);
    const chew = u > 0.6 ? 0.02 * Math.sin(TAU * 7 * u) : 0, head = 0.36 - 0.28 * k + chew, m = L.mouthAt(head);
    const tip = lerpPt(rest(L), add(m, [0, -0.004, 0.008]), smooth(k));
    const t = L.aimTool(nrm([BITE_TIP[0], BITE_TIP[1], 0]), lerpDir(V(0.35, -0.25, 0.9), V(0.72, 0.12, -0.68), k), lerpDir(V(0.15, 1, 0.1), V(0.45, 0.35, 0.82), k));
    const h = { head, lean: 0.04 + 0.08 * k, Right: { p: BITE_TIP, target: tip, along: t.along, palm: t.palm, grip: 0.55, pole: V(-0.7, -1, -0.25) } };
    const l = left(L);
    if (l) h.Left = l;
    return h;
  };
}
/** A value keyed [[u, v], …] (u from 0 to 1, the last back at 1), eased between keys. */
function ks(keys, u) {
  for (let i = 0; i + 1 < keys.length; i++) {
    const [u0, a] = keys[i], [u1, b] = keys[i + 1];
    if (u >= u0 && u <= u1) return a + (b - a) * smooth((u - u0) / (u1 - u0 || 1));
  }
  return keys[keys.length - 1][1];
}

/** A hand's size in bind space: wrist to the middle knuckle, and its thickness (half the knuckles' spread is a fair measure of it across bodies). */
function handOf(R, side) {
  const J = R.J, i = R.idx, w = J[i[side + 'Hand']], m1 = J[i[side + 'HandMiddle1']];
  return { len: len(sub(m1, w)), thick: Math.min(0.03, Math.max(0.012, len(sub(J[i[side + 'HandIndex1']], J[i[side + 'HandPinky1']])) * 0.28)) };
}
// where the grip frame's origin is: this share of the way from the wrist to the middle knuckle, on the palm's surface
const GRIP_ALONG = 0.55;
// a cup in the right hand (render/char-props.js upright(): radius, height; its middle 12 mm toward the fingers, against the palm)
const CUP_R = 0.04, CUP_H = 0.1, CUP_Y = 0.012;

/** The body's landmarks in a frame: each joint, and the mouth (in front of and below the head's joint). */
function landmarks(R, X, desk) {
  const L = { desk };
  R.N.forEach((n, b) => { if (X[b]) L[n] = X[b]; });
  const up = nrm(sub(X[R.idx.HeadTop_End], X[R.idx.Head])), fwd = [0, 0, 1];
  L.mouth = add(add(X[R.idx.Head], scale(up, -0.005)), scale(fwd, 0.105));
  // a point from a shoulder, the offsets given for an arm of 0.46 m (shoulder to wrist; the characters' run 0.40–0.51)
  const J = R.J, i = R.idx, arm = s => len(sub(J[i[s + 'ForeArm']], J[i[s + 'Arm']])) + len(sub(J[i[s + 'Hand']], J[i[s + 'ForeArm']]));
  L.k = (arm('Left') + arm('Right')) / 2 / 0.46;
  L.at = (side, v) => add(L[side + 'Arm'], scale(v, L.k));
  // the wrist that brings a cup in the right hand, the hand turned (along, palm), to rest on the lips: its middle ahead of
  // the mouth and a little below, so the rim meets them
  const h = handOf(R, 'Right');
  L.sipWrist = (along, palm) => {
    const up = nrm(cross(along, palm)), mid = sub(add(L.mouth, [0, 0, CUP_R * 0.95]), scale(up, CUP_H * 0.36));
    return sub(sub(mid, scale(along, GRIP_ALONG * h.len + CUP_Y)), scale(palm, h.thick + CUP_R + 0.003));
  };
  // eating: the mouth once the neck and head are bowed by `head` (as holdFrame bows them: the neck 0.45 of it, the head
  // 1.1 in all)
  L.mouthAt = head => {
    const N = X[R.idx.Neck], Hd = X[R.idx.Head], rx = t => rotAbout([1, 0, 0], t, [0, 0, 0]);
    return add(add(N, rotv(rx(head * 0.45), sub(Hd, N))), rotv(rx(head * 1.1), sub(L.mouth, Hd)));
  };
  // the wrist that puts point p of a hand's grip frame (shared/eating.js) at `target`, the hand turned (along, palm)
  L.wristFor = (side, along, palm, p, target) => {
    const y = nrm(along), z = nrm(sub(palm, scale(y, dot(palm, y)))), x = cross(y, z), hs = handOf(R, side);
    return sub(target, add(add(scale(x, p[0]), scale(y, p[1] + GRIP_ALONG * hs.len)), scale(z, p[2] + hs.thick)));
  };
  // the hand's turn that points a thing held along kd (in its grip frame) the body's way fd, the palm facing n (as square
  // to fd as it goes): the rotation taking the frame (kd, the palm square to it) to (fd, n square to it)
  L.aimTool = (kd, fd, n) => {
    const frame = (t, z) => { const e1 = nrm(t), e2 = nrm(sub(z, scale(e1, dot(z, e1)))); return [e1, e2, cross(e1, e2)]; };
    const A = frame(kd, [0, 0, 1]), B = frame(fd, n), map = v => [0, 1, 2].reduce((r, i) => add(r, scale(B[i], dot(A[i], v))), [0, 0, 0]);
    return { along: nrm(map([0, 1, 0])), palm: nrm(map([0, 0, 1])) };
  };
  // the left hand at rest on the table, left of the dish, palm down on it (the wrist near straight, as the eating hands)
  // with no table, on the left thigh (palm down, the fingers along it toward the knee)
  L.restLap = () => ({ p: [0, 0, 0], target: add(lerpPt(L.LeftUpLeg, L.LeftLeg, 0.62), [0, 0.07, 0]), along: V(-0.12, -0.25, 0.96), palm: V(0, -1, 0.15), grip: 0.35, pole: V(0.7, -1, -0.4) });
  L.restLeft = () => ({ p: [0, 0, 0], target: [L.LeftArm[0] - 0.02 * L.k, TABLE_TOP + 0.004, DISH_AHEAD - 0.08], along: V(-0.3, -0.12, 0.95), palm: V(0.05, -1, 0.1), grip: 0.3, pole: V(0.7, -1, -0.2) });
  return L;
}
/**
 * Where the wrist goes, and the hand's turn, for a hold that sends point s.p of the hand's grip to s.target with the hand
 * turned (s.along, s.palm): if the hand would bend more than s.bend (radians, WRIST_MAX by default) from the forearm the
 * arm reaches it with, it is turned toward the forearm (the palm with it) and the wrist placed again — a few rounds, as
 * the forearm moves with the wrist.
 */
function wristLimited(L, side, S, a, b, s) {
  const max = s.bend ?? WRIST_MAX;
  let along = s.along, palm = s.palm, at = L.wristFor(side, along, palm, s.p, s.target);
  for (let it = 0; it < 12; it++) {
    const fore = reach(S, a, b, at, s.pole).fore, ang = Math.acos(Math.max(-1, Math.min(1, dot(fore, along))));
    if (ang <= max + 0.01) break;
    const axis = nrm(cross(fore, along)), turn = rotAbout(axis, max - ang, [0, 0, 0]);   // (back toward the forearm)
    along = nrm(rotv(turn, along)); palm = nrm(rotv(turn, palm));
    at = L.wristFor(side, along, palm, s.p, s.target);
  }
  return { at, along, palm };
}
/** The spine's bones leaned forward by `lean` (radians at the chest) from the hips, from the base frame's joints X. */
function leanDirs(R, X, lean) {
  const d = {};
  for (const [n, k] of [['Spine', 0.45], ['Spine1', 0.8], ['Spine2', 1]]) d[n] = nrm(rotv(rotAbout([1, 0, 0], lean * k, [0, 0, 0]), sub(X[R.idx[AIM[n]]], X[R.idx[n]])));
  return d;
}
/** One frame of a hold, from the base frame F0: { F (the skinning), h (where the hold sent the hands) }. */
function holdFrame(R, F0, hold, u, desk) {
  let X0 = jointsOf(R, F0), L = landmarks(R, X0, desk), h = hold.pose(u, L);
  if (h.lean) {   // leaning in toward the table: the spine first, then the arms reach (and the mouth is) from there
    F0 = poseFrom(R, F0, { d: leanDirs(R, X0, h.lean) });
    X0 = jointsOf(R, F0); L = landmarks(R, X0, desk); h = hold.pose(u, L);
  }
  const d = {}, hands = {}, palm = {};
  for (const side of ['Left', 'Right']) {
    const s = h[side];
    if (!s) continue;
    const a = len(sub(R.J[R.idx[side + 'ForeArm']], R.J[R.idx[side + 'Arm']])), b = len(sub(R.J[R.idx[side + 'Hand']], R.J[R.idx[side + 'ForeArm']]));
    // a point of the hand's grip (p) sent to a target (eating): the hand turned no more than s.bend from its forearm —
    // turned toward it until it is, the wrist placed again so the point still reaches (the arm follows)
    if (s.target) Object.assign(s, wristLimited(L, side, X0[R.idx[side + 'Arm']], a, b, s));
    // (an arm is placed by where its wrist goes, or by the directions of its two bones)
    const r = s.at ? reach(X0[R.idx[side + 'Arm']], a, b, s.at, s.pole) : { arm: s.arm, fore: s.fore };
    Object.assign(d, { [side + 'Arm']: r.arm, [side + 'ForeArm']: r.fore, [side + 'Hand']: s.along });
    palm[side] = s.palm; hands[side] = s.grip;
  }
  if (h.head) {   // bow the neck and head forward from where they are in the base frame
    for (const [n, k] of [['Neck', 0.45], ['Head', 0.55]]) {
      const dir = nrm(sub(X0[R.idx[n === 'Neck' ? 'Head' : 'HeadTop_End']], X0[R.idx[n]]));
      d[n] = nrm(rotv(rotAbout([1, 0, 0], h.head * k * (n === 'Head' ? 2 : 1), [0, 0, 0]), dir));
    }
  }
  d.palm = palm;
  return { F: poseFrom(R, F0, { d, hands, noTwist: o['no-twist'] }), h };
}

/**
 * Grip frames (bind space, 3×4: y along the fingers, z out of the palm, x = y × z — the right hand's index finger's side,
 * the left's little finger's — origin on the palm's surface GRIP_ALONG of the way from the wrist to the middle knuckle) for
 * each hand, and the desk point (deskOf).
 */
function gripsOf(R) {
  const J = R.J, idx = R.idx, out = {};
  for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
    const w = J[idx[side + 'Hand']], m1 = J[idx[side + 'HandMiddle1']];
    const along = nrm(sub(m1, w)), across0 = sub(J[idx[side + 'HandIndex1']], J[idx[side + 'HandPinky1']]);
    const palm = nrm(cross(along, across0).map(v => v * sg)), x = nrm(cross(along, palm));   // (right-handed: the right hand's x is its index finger's side, the left's its little finger's)
    const o0 = add(add(w, scale(sub(m1, w), GRIP_ALONG)), scale(palm, handOf(R, side).thick));
    out[side[0]] = [x[0], along[0], palm[0], o0[0], x[1], along[1], palm[1], o0[1], x[2], along[2], palm[2], o0[2]].map(v => +v.toFixed(5));
  }
  const desk = deskOf(R);
  if (desk) out.desk = desk;
  return out;
}
/** Where a seated typist's fingertips rest, root space ([0, height, ahead]) — the top of the table before them. */
function deskOf(R) {
  const c = R.clip('sit_work'), idx = R.idx;
  if (c) {
    let y = 0, z = 0, n = 0;
    for (let f = 0; f < c.len; f += 4) {
      const X = jointsOf(R, frameOf(R, c.off + f));
      for (const side of ['Left', 'Right']) for (const fg of ['Index', 'Middle', 'Ring']) {
        // (a finger's end joint never moves against the one before it, so the bake can't place it: the tip is taken
        // a little past the last knuckle, along the finger's last bone)
        const k3 = X[idx[`${side}Hand${fg}3`]], k2 = X[idx[`${side}Hand${fg}2`]], t = add(k3, scale(sub(k3, k2), 0.8));
        y += t[1]; z += t[2]; n++;
      }
    }
    return [0, +(y / n).toFixed(4), +(z / n).toFixed(4)];
  }
  return null;
}

// ------------------------------------------------------------------ per character
function bake(kind) {
  const R = loadRig(DIR, kind);
  if (!R) return null;
  const { man, M, N, idx, NB } = R, hips = idx.Hips;
  if (o.check) {
    console.log(kind, 'foot→toe', sub(R.J[idx.LeftToeBase], R.J[idx.LeftFoot]).map(v => v.toFixed(3)).join(' '), 'hand→middle', sub(R.J[idx.LeftHandMiddle1], R.J[idx.LeftHand]).map(v => v.toFixed(3)).join(' '));
    const i0 = (R.clip('idle') || man.clips[0]).off, X = b => app(M(i0, b), R.J[b]);
    for (const [side, sg] of [['Left', 1], ['Right', -1]]) {
      const pn = nrm(cross(sub(X(idx[side + 'HandMiddle1']), X(idx[side + 'Hand'])), sub(X(idx[side + 'HandIndex1']), X(idx[side + 'HandPinky1']))).map(v => v * sg));
      console.log(`  ${side} palm in the idle pose (x its left, y up, z forward):`, pn.map(v => v.toFixed(2)).join(' '), '· hand at', X(idx[side + 'Hand']).map(v => v.toFixed(2)).join(' '), '· thumb tip at', X(idx[side + 'HandThumb3'] ?? idx[side + 'HandThumb2']).map(v => v.toFixed(2)).join(' '), '· nose/head', X(idx.Head).map(v => v.toFixed(2)).join(' '), '· toe', X(idx[side + 'ToeBase']).map(v => v.toFixed(2)).join(' '));
    }
    return { kind, rms: R.rms };
  }
  // swimming: from the first idle frame
  const idle = R.clip('idle') || man.clips[0];
  const F0 = frameOf(R, idle.off), X0 = jointsOf(R, F0);
  const frames = [], track = {};
  for (const clip of CLIPS) for (let fr = 0; fr < clip.frames; fr++) {
    const pose = clip.pose(fr / clip.frames), hip = X0[hips];
    // the whole body: pitched forward (prone), rolled about its own length, raised/lowered a little
    let root = rotAbout([1, 0, 0], pose.pitch, hip);
    if (pose.roll) root = mul(root, rotAbout(nrm(sub(X0[idx.Neck], hip)), pose.roll, hip));
    root[7] += pose.dy || 0;
    const F = poseFrom(R, F0, { d: pose.d, hands: pose.hands, root, noTwist: o['no-twist'] });
    for (const m of F) frames.push(m);
    if (o.verify) {
      const X = jointsOf(R, F), palms = palmsOf(R, X);
      for (const side of ['Left', 'Right']) {
        const h = idx[side + 'Hand'];
        (track[clip.name] ||= []).push({ side, fr, pos: X[h], palm: palms[side], ahead: rotv(root, [0, 1, 0]), want: pose.d.palm?.[side] ? rotv(root, pose.d.palm[side]) : null });
      }
    }
  }
  // the mended loops, after the swimming
  const mended = {}, mendedFrames = {};
  for (const name of LOOPS) {
    const c = R.clip(name);
    if (!c) continue;
    const L = mendLoop(M, idx, c);
    for (const row of L.frames) for (const m of row) frames.push(m);
    mendedFrames[name] = L.frames;
    mended[name] = { len: L.frames.length, dur: c.dur, stride: c.stride, per: L.per, s: L.s, gap: +L.gap.toFixed(2), seamBefore: +L.seamBefore.toFixed(2) };
  }
  // holding, after the loops: from the walk (mended), the idle and the seated idle
  const holds = {}, reachErr = {}, bendMax = {}, desk = deskOf(R) || [0, 0.755, 0.55];
  for (const hold of HOLDS) {
    const base = mendedFrames[hold.base] ? { frames: mendedFrames[hold.base] } : R.clip(hold.base);
    if (!base) throw new Error(`${kind}: no ${hold.base} to hold from`);
    // (slow clips — the idle's sway, sitting — keep every other frame: the shader blends between frames, and each frame
    // of every character is downloaded)
    const nb = base.frames ? base.frames.length : base.len, n = hold.still ? hold.frames : Math.floor(nb / hold.step);
    for (let fr = 0; fr < n; fr++) {
      const at = hold.still ? 0 : fr * hold.step, Fb = base.frames ? base.frames[at] : frameOf(R, base.off + at);
      const { F, h } = holdFrame(R, Fb, hold, fr / n, desk);
      for (const m of F) frames.push(m);
      if (o.verify) {   // how far each wrist ended from where it was sent
        const X = jointsOf(R, F);
        for (const side of ['Left', 'Right']) if (h[side]?.at) reachErr[hold.name] = Math.max(reachErr[hold.name] || 0, len(sub(X[idx[side + 'Hand']], h[side].at)));
        // eating: how far the hand turns from its forearm (worst, degrees)
        for (const side of ['Left', 'Right']) if (h[side]?.target) {
          const fo = nrm(sub(X[idx[side + 'Hand']], X[idx[side + 'ForeArm']])), hd = nrm(sub(X[idx[side + 'HandMiddle1']], X[idx[side + 'Hand']]));
          bendMax[hold.name] = Math.max(bendMax[hold.name] || 0, Math.acos(Math.max(-1, Math.min(1, dot(fo, hd)))) * 180 / PI);
        }
      }
    }
    holds[hold.name] = n;
  }
  if (o.verify) console.log(kind, 'loops', JSON.stringify(mended), 'holds: worst reach miss (m)', JSON.stringify(Object.fromEntries(Object.entries(reachErr).map(([k, v]) => [k, +v.toFixed(3)]))), 'eating: worst wrist bend (°)', JSON.stringify(Object.fromEntries(Object.entries(bendMax).map(([k, v]) => [k, Math.round(v)]))));
  if (o.verify) {
    // a stroke pushes when the hand moves back along the body through the water: there the palm should face the way the
    // hand moves (dot > 0: palm first; < 0: the back of the hand first)
    const out = {};
    for (const [name, T] of Object.entries(track)) {
      const nf = CLIPS.find(c => c.name === name).frames, push = [], aimed = [];
      for (const t of T) {
        const prev = T.find(q => q.side === t.side && q.fr === (t.fr - 1 + nf) % nf), next = T.find(q => q.side === t.side && q.fr === (t.fr + 1) % nf);
        const vel = sub(next.pos, prev.pos);
        if (len(vel) > 1e-4 && dot(nrm(vel), t.ahead) < -0.3) push.push(dot(t.palm, nrm(vel)));
        if (t.want) aimed.push(dot(t.palm, nrm(t.want)));
      }
      const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
      out[name] = { pushFrames: push.length, palmFirst: +mean(push).toFixed(2), worst: +Math.min(...push).toFixed(2), onTarget: +mean(aimed).toFixed(2) };
    }
    console.log(kind, JSON.stringify(out));
    return { kind, rms: R.rms };
  }
  const out = new Uint16Array(frames.length * 12);
  frames.forEach((m, i) => { for (let q = 0; q < 12; q++) out[i * 12 + q] = f2h(m[q]); });
  fs.writeFileSync(path.join(DIR, kind + '.extra.bin'), Buffer.from(out.buffer));
  return { kind, rms: R.rms, frames: frames.length / NB, mended, holds, grips: gripsOf(R) };
}

let kinds = kindsIn(DIR);
if (o.only) kinds = o.only.split(',');
const done = {}, results = {}, grips = {};
let worst = 0;
for (const k of kinds) {
  const r = bake(k);
  if (r) results[k] = r;
  if (!r) { console.log(`${k}: no bake, skipped`); continue; }
  worst = Math.max(worst, r.rms);
  if (r.frames) { done[k] = r.frames; grips[k] = r.grips; }
  console.log(`${k}: joints rms ${(r.rms * 1000).toFixed(2)} mm${r.frames ? `, ${r.frames} frames written` : ''}`);
}
if (o.check || o.verify) process.exit(0);
const listPath = path.join(DIR, 'extra-clips.json');
const prev = fs.existsSync(listPath) ? JSON.parse(fs.readFileSync(listPath, 'utf8')) : { kinds: {} };
let off = 0;
const clips = CLIPS.map(c => { const e = { name: c.name, off, len: c.frames, dur: c.dur, stride: c.stride }; off += c.frames; return e; });
// (the mended loops and the holds: the same length for every character, checked)
const ms = Object.values(results).map(r => r.mended).filter(Boolean);
for (const name of LOOPS) {
  const m = ms.map(x => x[name]).filter(Boolean);
  if (!m.length) continue;
  if (m.some(x => x.len !== m[0].len)) throw new Error(`${name}: characters' clips differ in length`);
  clips.push({ name, off, len: m[0].len, dur: m[0].dur, stride: m[0].stride, mended: true }); off += m[0].len;
}
const hs = Object.values(results).map(r => r.holds).filter(Boolean);
for (const hold of HOLDS) {
  const n = hs.map(x => x[hold.name]);
  if (n.some(x => x !== n[0])) throw new Error(`${hold.name}: characters' clips differ in length`);
  const base = clips.find(c => c.name === hold.base && c.mended) || null;
  const man0 = JSON.parse(fs.readFileSync(path.join(DIR, Object.keys(done)[0] + '.json'), 'utf8')), bc = base || man0.clips.find(c => c.name === hold.base);
  clips.push({ name: hold.name, off, len: n[0], dur: hold.dur ?? bc.dur, stride: hold.dur ? 0 : bc.stride || 0, hold: hold.base }); off += n[0];
}
fs.writeFileSync(listPath, JSON.stringify({
  about: 'Clips added to the baked characters (tools/chars/extra-clips.mjs): <kind>.extra.bin frames follow the bake\'s own; off is from its first frame; "mended" ones replace the bake\'s clip of that name; "hold" ones are posed from that clip. grips: where each character holds things (bind space; render/char-props.js).',
  clips, kinds: { ...prev.kinds, ...done }, grips: { ...(prev.grips || {}), ...grips },
}, null, 1) + '\n');
console.log(`extra-clips.json: ${clips.map(c => c.name).join(', ')} for ${Object.keys({ ...prev.kinds, ...done }).length} characters; worst joint rms ${(worst * 1000).toFixed(2)} mm`);
