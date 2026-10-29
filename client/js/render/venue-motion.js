// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The pieces that move on a night out (2026-10-23, the product owner: "we need animations for EVERthing as well as the
// assets need to look alive, like the games at the arcade, the lights and the lasers at the night club"): every frame,
// the moving parts of the furniture on the floor looked into (render/furniture.js part, render/interiors.js
// animateParts) move by their kind, in time with the music playing there (audio/nightlife-music.js beatAt: the deck's
// song by the server's clock, else the synthesised set) — and the lights drawn to flash with the beat follow it (the
// shader's uBeat, uBeatOn: render/mats.js emits 9 and 10). With no music they rest or drift slowly.
//   head    a moving light: its beam swept in shows that change every eight bars (all together, circles, a wave,
//           crossing), a slow drift when nothing plays
//   ball    the mirror ball and the specks of light it throws: turning
//   spin    a platter on the DJ's decks: turning while the music plays
//   laser   a laser's fan: sweeping, its pattern changing every four bars
//   cone    a speaker's cone: pushed out on every beat
//   clock   a radio studio's clock: its hands and its seconds' dot
// The arcade's machines (2026-10-24, "the arcade games interaction animations need way more work"): their parts move
// with whoever plays them (info.user: the slot, item frame; info.clip: what they play — the person there doing it, by
// render/agents.js, their clip's phase into shared/arcade-motion.js, the same motion their clip was made from):
//   wheel   the racing cabinet's wheel, turned with the driver's hands
//   claw    the claw machine's gantry, cable and claw, steered by the joystick, dropped by the button
//   bag     the punching machine's ball, knocked up by the punch
//   rod     a foosball rod and its players, twisted and slid by the hand on it
//   mole    a whack-a-mole mole, up out of its hole until whacked (the others bob)
//   flipper a pinball flipper, flicked with the button; pinball: the ball rolling about
//   puck    the air hockey puck, sliding while anyone plays; parked: a machine's own striker or mallet, away while played
import * as THREE from 'three';
import { S, bus } from '../core/state.js';
import { GU } from './scene.js';
import { CLIP } from './anim.js';
import { steer, claw, bagSwing, foos, whack, flippers } from '/shared/arcade-motion.js';
import { PIN, pinAt } from '/shared/arcade/machines.js';

const TAU = Math.PI * 2, P = Math.PI;
const _q = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _e = new THREE.Euler();
let app = null;

/** How each kind of part moves: (e, part, M, c) sets M (about the part's pivot, in the item's frame) or returns false
 *  (at rest). c: { t (s), on (music plays), beat (beats into the song), kick (1 on a beat, falling off) }. */
export const MOVES = {
  head(e, part, M, c) {
    const k = Number(part.name.replace(/\D/g, '')) || 0, d0 = part.info.dir;
    let pan, tilt;
    if (c.on) {
      const b = c.beat, show = Math.floor(b / 32) % 4;
      if (show === 0) { pan = 0.7 * Math.sin(TAU * b / 8); tilt = 0.25 * Math.sin(TAU * b / 16); }   // all together
      else if (show === 1) { const a = TAU * b / 4 + k * TAU / 8; pan = 0.5 * Math.cos(a); tilt = 0.32 * Math.sin(a); }   // circles
      else if (show === 2) { const a = TAU * b / 8 + k * P / 4; pan = 0.65 * Math.sin(a); tilt = 0.2 * Math.cos(a); }   // a wave round the ring
      else { pan = (k % 2 ? 1 : -1) * 0.8 * Math.sin(TAU * b / 8); tilt = 0.28 * Math.sin(TAU * b / 4); }   // crossing
    } else { pan = 0.3 * Math.sin(c.t * 0.25 + k * 1.7); tilt = 0.12 * Math.sin(c.t * 0.19 + k); }
    // its beam's rest direction, turned about the vertical (pan) and up or down (tilt)
    const h = Math.hypot(d0[0], d0[2]) || 1, yaw = Math.atan2(d0[0], d0[2]) + pan, el = Math.max(-1.5, Math.min(-0.15, Math.atan2(d0[1], h) + tilt));
    _a.set(d0[0], d0[1], d0[2]); _b.set(Math.sin(yaw) * Math.cos(el), Math.sin(el), Math.cos(yaw) * Math.cos(el));
    M.makeRotationFromQuaternion(_q.setFromUnitVectors(_a, _b));
  },
  ball(e, part, M, c) { M.makeRotationY(c.t * (c.on ? 0.55 : 0.12)); },
  spin(e, part, M, c) { if (!c.on) return false; M.makeRotationY(-c.t * 3.5); },
  laser(e, part, M, c) {
    if (!c.on) return false;
    const s = part.info.side || 0, b = c.beat, show = Math.floor(b / 16) % 3;
    const yaw = show === 0 ? 0.45 * Math.sin(TAU * b / 8 + s) : show === 1 ? 0.6 * Math.sin(TAU * b / 4) * (s >= 0 ? 1 : -1) : 0.3 * Math.sin(TAU * b / 2 + s * 2);
    M.makeRotationFromEuler(_e.set(0.12 * Math.sin(TAU * b / 16 + s), yaw, 0, 'YXZ'));
  },
  cone(e, part, M, c) { if (!c.on) return false; M.makeTranslation(0, 0, 0.012 * c.kick); },
  // ---- a radio studio's clock (render/furniture-studio.js): hours and minutes by the world's clock, the seconds' dot by
  //      the real one (the world's minutes go by in seconds), ticking from dot to dot
  clock(e, part, M) {
    const h = ((S.hour ?? 12) % 12 + 12) % 12, a = part.info.hand === 'hour' ? h / 12 : part.info.hand === 'min' ? h % 1 : Math.floor(Date.now() / 1000) % 60 / 60;
    M.makeRotationZ(-a * TAU);
  },
  // ---- the arcade: with whoever plays the machine
  wheel(e, part, M) { const u = userPhase(e, part.info); if (u < 0) return false; M.makeRotationAxis(_a.set(...part.info.axis), -steer(u)); },
  claw(e, part, M) {
    const u = userPhase(e, part.info); if (u < 0) return false;
    const k = claw(u), dx = k.x - 0.08, ax = part.info.axis;
    if (ax === 'z') M.makeTranslation(0, 0, k.z);
    else if (ax === 'x') M.makeTranslation(dx, 0, 0);
    else if (ax === 'head') M.makeTranslation(dx, -0.36 * k.drop, k.z);
    else M.makeTranslation(dx, 0, k.z).multiply(_m.makeScale(1, (0.22 + 0.36 * k.drop) / 0.22, 1));   // (the cable paid out)
  },
  bag(e, part, M) { const u = userPhase(e, part.info); if (u < 0) return false; M.makeRotationX(-0.9 * bagSwing(u)); },
  rod(e, part, M, c) {
    const u = userPhase(e, part.info); if (u < 0) return false;
    const i = part.info, f = i.hand ? foos(u, i.hand) : { twist: 0.25 * Math.sin(c.t * 2.3 + part.pivot[2] * 9), slide: 0 };
    M.makeTranslation(i.dir * f.slide, 0, 0).multiply(_m.makeRotationX(i.dir * f.twist));
  },
  mole(e, part, M, c) {
    const i = part.info.idx, u = userPhase(e, part.info);
    let h;
    if (u >= 0 && i < 3) h = whack(u).moles[i];
    else if (u >= 0) h = Math.max(0, Math.sin(c.t * (1.7 + i * 0.4) + i * 2.1));   // (the back row: popping up now and then)
    else h = [1, 0.2, 0.7, 0, 0.5][i];   // (nobody playing: some up, some down, as they were left)
    M.makeTranslation(0, (h - 1) * 0.1, 0);
  },
  flipper(e, part, M) { const u = userPhase(e, part.info); if (u < 0) return false; M.makeRotationAxis(PIN_UP, part.info.sgn * 0.9 * flippers(u)[part.info.side]); },
  pinball(e, part, M, c) {
    const u = userPhase(e, part.info); if (u < 0) return false;
    // (about the playfield, from where it waits on the plunger: shared/arcade/machines.js PIN)
    const t = c.t * 1.3, p = pinAt(-0.03 + 0.2 * Math.sin(t * 1.7), -0.3 + 0.72 * Math.abs(Math.sin(t)), PIN.ballR);
    M.makeTranslation(p[0] - PIN_REST[0], p[1] - PIN_REST[1], p[2] - PIN_REST[2]);
  },
  puck(e, part, M, c) {
    const on = part.info.users.some(us => userPhase(e, { ...part.info, user: us }) >= 0);
    if (!on) { M.makeTranslation(-0.2, 0, 0.2); return; }
    const t = c.t; M.makeTranslation(0.52 * tri(t * 0.61), 0, 1.0 * tri(t * 0.37 + 0.25));
  },
  parked(e, part, M) { if (userPhase(e, part.info) < 0) return false; M.makeScale(1e-4, 1e-4, 1e-4); },
  hoop() { return false; },   // (still, but for Hoop Fever's bonus time: play/machine-play.js)
  bull() { return false; },   // (still, but for Bull Rider)
  prizes() { return false; }, // (the claw machine's prizes: put away while Claw Catch has its own)
};
const _m = new THREE.Matrix4();
const PIN_UP = new THREE.Vector3(0, Math.cos(PIN.tilt), Math.sin(PIN.tilt)), PIN_REST = pinAt(PIN.lane.rest[0], PIN.lane.rest[1], PIN.ballR);   // (the pinball's playfield: its own up, the ball's place on the plunger)
const tri = x => { const f = ((x % 1) + 1) % 1; return 4 * Math.abs(f - 0.5) - 1; };   // (a triangle wave: back and forth between -1 and 1)
/** The phase of whoever plays at slot info.user of item e with clip info.clip (a resident or a player), else -1. */
const users = new Map();
function userPhase(e, info) {
  const key = `${e.b}:${e.f}:${e.id}:${info.user[0]}:${info.user[1]}`;
  let v = users.get(key);
  if (v !== undefined) return v;
  v = -1;
  const A = app.agents, cid = CLIP[info.clip], co = Math.cos(e.yaw), si = Math.sin(e.yaw);
  const sx = e.x + info.user[0] * co + info.user[1] * si, sz = e.z - info.user[0] * si + info.user[1] * co;
  if (A && cid !== undefined) {
    for (let n = 0; n < A.nDrawn && v < 0; n++) { const i = A.drawn[n]; if (A.clip[i] === cid && Math.abs(A.rx[i] - sx) < 0.6 && Math.abs(A.rz[i] - sz) < 0.6) v = A.lph[i]; }
    for (const x of A.extra || []) if (v < 0 && x.clip === cid && Math.abs(x.x - sx) < 0.6 && Math.abs(x.z - sz) < 0.6) v = x.ph;
  }
  users.set(key, v);
  return v;
}

const ctx = { t: 0, on: false, beat: 0, kick: 0 };
function frame() {
  const inter = app.inter, b = S.focus.b, m = b >= 0 ? app.nightMusic?.beatAt?.(b, S.focus.f) : null;
  ctx.t = performance.now() / 1000; ctx.on = !!m?.on; ctx.beat = ctx.on ? m.beat : 0;
  ctx.kick = ctx.on ? Math.pow(1 - (((ctx.beat % 1) + 1) % 1), 6) : 0;
  GU.uBeat.value = ctx.beat; GU.uBeatOn.value = ctx.on ? 1 : 0;
  users.clear();
  // (a machine being played for real moves its own parts: play/machine-play.js — the moles of the game, its sliding hoop)
  if (inter?.foc?.anim?.length) inter.animateParts((e, part, M) => { const mp = app.machinePlay?.move(e, part, M); if (mp !== undefined) return mp; const fn = MOVES[part.info?.kind]; return fn ? fn(e, part, M, ctx) : false; });
}

export function init(a) {
  app = a;
  bus.on('frame', frame);
  app.venueMotion = { get beat() { return { ...ctx }; } };
}
