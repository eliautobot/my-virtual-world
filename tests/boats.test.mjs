// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How the fishing boats handle (shared/boat-model.js; docs/features/fishing.md §Boats): they reach their top speed and
// get on the plane; they turn under power, a little with way on, and lean into their turns; they ride a swell (heave,
// pitch and roll with it, never capsizing), and in a steep head sea at speed they fly off crests and slam; the shallows
// ground them and the docks stop them; at anchor they stay put in a wind; the lever runs through neutral to reverse.
// The water's plane fit and the boat's orientation agree with three.js. Its deck: walked from the wheel to every
// fishing spot (up on to the casting decks, round the console), never over the side; the server takes a deck position
// only where one can stand.
import './helpers/client-paths.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { BOATS, newBoat, stepBoat, fitPlane, boatPoint, boatQuat, knots, maxBoatSpeed, hullPoints, deckFloor, walkDeck, spotNear, DECK_STEP } from '../shared/boat-model.js';
import { Harbour } from '../server/world/boats.js';

const DT = 1 / 60;
const wave = (A, L, dir = 0) => { const k = 2 * Math.PI / L, w = Math.sqrt(9.81 * k), dx = Math.sin(dir), dz = Math.cos(dir); return (t, x, z) => A * Math.sin(k * (x * dx + z * dz) - w * t); };
/** An open sea: the surface (a function of t, x, z) under the hull, its depth everywhere d. */
const sea = (s, surf = () => 0, d = 30, extra = {}) => ({
  plane: (x, z, h) => fitPlane(s.S, s.S.probes.map(([px, pz]) => surf(s.t, x + px * Math.cos(h) + pz * Math.sin(h), z - px * Math.sin(h) + pz * Math.cos(h)))),
  depth: typeof d === 'function' ? d : () => d, ...extra,
});
const run = (s, secs, inp, env) => { const evs = []; for (let k = 0; k < secs / DT; k++) evs.push(...stepBoat(s, typeof inp === 'function' ? inp(s) : inp, typeof env === 'function' ? env(s) : env, DT)); return evs; };

test('top speed, getting on the plane, the lever through neutral to reverse', () => {
  for (const type of Object.keys(BOATS)) {
    const S = BOATS[type], s = newBoat(type, 0, 0, 0, 0), evs = run(s, 25, { leverTo: 1 }, sea(s));
    assert.ok(Math.abs(s.u - S.top) / S.top < 0.04, `${type}: ${knots(s.u).toFixed(0)} kn at full throttle`);
    assert.ok(evs.includes('plane') && s.planing > 0.9, `${type}: on the plane`);
    assert.ok(s.y > -S.draft * 0.35, `${type}: it rises on the plane`);
    const r = newBoat(type, 0, 0, 0, 0); run(r, 10, { leverTo: -1 }, sea(r));
    assert.ok(r.u < -1 && r.u > -S.top * 0.6, `${type}: astern, slower (${r.u.toFixed(1)} m/s)`);
    const l = newBoat(type, 0, 0, 0, 0); run(l, 2, { lever: 1 }, sea(l)); assert.ok(l.lever > 0.9);
    run(l, 0.5, { lever: -1 }, sea(l)); assert.ok(l.lever > 0.5);
    run(l, 3, { lever: -1 }, sea(l)); assert.equal(l.lever, 0, `${type}: the lever stops in neutral on its way back`);
    assert.ok(maxBoatSpeed(type) > S.top * 1.5);
  }
});

test('turning: under power, a little with way on, leaning into the turn; skidding outward a little', () => {
  const s = newBoat('coastal', 0, 0, 0, 0); run(s, 15, { leverTo: 1 }, sea(s));
  const h0 = s.heading; run(s, 3, { leverTo: 1, steer: 1 }, sea(s));
  assert.ok(s.heading < h0 - 1, 'full right rudder turns it to starboard (the heading falls)');
  assert.ok(s.roll > 0.08 && s.roll < 0.35, `it leans into the turn (${(s.roll * 57).toFixed(0)}°)`);
  assert.ok(s.v < 0, 'and skids out a little');
  const glide = newBoat('coastal', 0, 0, 0, 0); run(glide, 15, { leverTo: 1 }, sea(glide)); run(glide, 0.4, { neutral: true }, sea(glide));
  const g0 = glide.heading; run(glide, 2, { steer: 1 }, sea(glide));
  assert.ok(glide.heading < g0 - 0.05 && Math.abs(glide.heading - g0) < Math.abs(s.heading - h0), 'with the engine off it still answers the wheel, less');
});

test('it rides the swell — heaving, pitching, rolling with it, never over; a steep head sea at speed throws it off crests', () => {
  for (const type of Object.keys(BOATS)) {
    const s = newBoat(type, 0, 0, 0, 0.7), w1 = wave(0.6, 70, 0), w2 = wave(0.25, 25, 1.1);
    let lo = 9, hi = -9, roll = 0, pitch = 0;
    run(s, 30, {}, sea(s, (t, x, z) => w1(t, x, z) + w2(t, x, z)));
    for (let k = 0; k < 20 / DT; k++) { stepBoat(s, {}, sea(s, (t, x, z) => w1(t, x, z) + w2(t, x, z)), DT); lo = Math.min(lo, s.y); hi = Math.max(hi, s.y); roll = Math.max(roll, Math.abs(s.roll)); pitch = Math.max(pitch, Math.abs(s.pitch)); }
    assert.ok(hi - lo > 1.0 && hi - lo < 2.4, `${type}: heaves ${(hi - lo).toFixed(2)} m on a 1.7 m swell`);
    assert.ok(roll > 0.01 && roll < 0.45 && pitch > 0.02 && pitch < 0.45, `${type}: rolls ${(roll * 57).toFixed(0)}°, pitches ${(pitch * 57).toFixed(0)}°`);
    const storm = newBoat(type, 0, 0, 0, Math.PI), sw = wave(0.9, 45, 0);
    const evs = run(storm, 30, { leverTo: 1 }, sea(storm, (t, x, z) => sw(t, x, z)));
    assert.ok(evs.filter(e => e === 'slam').length >= 2, `${type}: slams in a storm sea at speed`);
    assert.ok(Math.abs(storm.roll) <= 0.5 && Math.abs(storm.pitch) <= 0.45);
    const calm = newBoat(type, 0, 0, 0, Math.PI), cw = wave(0.35, 140, 0);
    assert.ok(!run(calm, 20, { leverTo: 1 }, sea(calm, (t, x, z) => cw(t, x, z))).includes('slam'), `${type}: a long, low swell rides smooth`);
  }
});

test('the shallows ground it, the docks stop it, at anchor it stays put in a wind', () => {
  const s = newBoat('coastal', 0, 0, 0, 0);   // heading north (+z) into a beach at z = 60
  const evs = run(s, 20, { leverTo: 1 }, sea(s, () => 0, (x, z) => Math.max(0, 6 - z * 0.1)));
  assert.ok(evs.includes('aground'), 'it runs aground');
  assert.ok(s.z + BOATS.coastal.L * 0.45 < 60 - 0.5 * 10 + 6, `and stops in the shallows, not on the land (bow at ${(s.z + 4).toFixed(1)})`);
  const d = newBoat('skiff', 0, 0, 0, 0), dock = (x, z) => z > 20 && z < 22 && Math.abs(x) < 10;
  const ev2 = run(d, 10, { leverTo: 0.5 }, sea(d, () => 0, 30, { solid: dock }));
  assert.ok(ev2.includes('bump'), 'it bumps the dock');
  assert.ok(hullPoints(d).every(p => !dock(p[0], p[1])), 'and never passes through it');
  const a = newBoat('coastal', 0, 0, 0, 0); stepBoat(a, { anchor: true }, sea(a), DT);
  assert.ok(a.anchor, 'the anchor goes down');
  run(a, 60, {}, sea(a, () => 0, 30, { wind: { x: 12, z: 0 } }));
  assert.ok(Math.hypot(a.x, a.z) < 9, `at anchor in a 12 m/s wind it stays near (${Math.hypot(a.x, a.z).toFixed(1)} m)`);
  const free = newBoat('coastal', 0, 0, 0, 0); run(free, 60, {}, sea(free, () => 0, 30, { wind: { x: 12, z: 0 } }));
  assert.ok(free.x > 10, `adrift it goes with the wind (${free.x.toFixed(1)} m)`);
});

test('the water plane fit; the boat\'s points and orientation agree with three.js', () => {
  const S = BOATS.coastal, hs = S.probes.map(([x, z]) => 1 + 0.1 * z - 0.05 * x);   // rising to the bow, falling to port
  const P = fitPlane(S, hs); assert.ok(Math.abs(P.h - 1) < 1e-9 && Math.abs(P.sf - 0.1) < 1e-9 && Math.abs(P.ss - 0.05) < 1e-9);
  const s = { x: 5, y: 1, z: -3, heading: 0.8, pitch: 0.12, roll: -0.2 }, q = boatQuat(s), Q = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  for (const v of [[1, 0.5, 2], [-0.7, 1.2, -3], [0, 0, 4]]) {
    const a = boatPoint(s, ...v), b = new THREE.Vector3(...v).applyQuaternion(Q).add(new THREE.Vector3(s.x, s.y, s.z));
    assert.ok(a.x === a.x && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, `point ${v}`);
  }
  const bow = boatPoint({ x: 0, y: 0, z: 0, heading: 0, pitch: 0.2, roll: 0 }, 0, 0, 1); assert.ok(bow.y > 0, 'pitch up raises the bow');
  const stbd = boatPoint({ x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0.2 }, -1, 0, 0); assert.ok(stbd.y < 0, 'roll puts the starboard side down');
});

test('the deck: from the wheel to every fishing spot, up on to the casting decks, never over the side', () => {
  for (const [type, S] of Object.entries(BOATS)) {
    const H = S.helm, D = S.deck;
    assert.equal(deckFloor(type, H[0], H[2]), H[1], `${type}: the skipper stands on the deck at the wheel`);
    for (const sp of D.spots) assert.equal(deckFloor(type, sp.x, sp.z), sp.y, `${type}: the ${sp.name} spot is on the deck`);
    assert.ok(D.spots.length >= S.anglers, `${type}: a spot for each of its ${S.anglers} anglers`);
    // walked (as the page walks: walkDeck's small steps) — a flood from the wheel reaches every spot
    const h = 0.05, key = p => `${Math.round(p.x / h)},${Math.round(p.z / h)}`, start = { x: H[0], y: H[1], z: H[2] }, seen = new Map([[key(start), start]]), q = [start];
    while (q.length) {
      const a = q.shift();
      for (const [dx, dz] of [[h, 0], [-h, 0], [0, h], [0, -h]]) { const b = walkDeck(type, a, dx, dz); if (Math.hypot(b.x - a.x - dx, b.z - a.z - dz) > 1e-9) continue; if (b.y - a.y > DECK_STEP) continue; const k = key(b); if (!seen.has(k)) { seen.set(k, b); q.push(b); } }
    }
    for (const sp of D.spots) assert.ok(spotNear(type, sp.x, sp.z) && [...seen.values()].some(c => Math.hypot(c.x - sp.x, c.z - sp.z) < 0.08 && c.y === sp.y), `${type}: the ${sp.name} spot can be walked to`);
    assert.ok([...seen.values()].some(c => c.y > H[1] + 0.1), `${type}: up on to a casting deck`);
    // pushing at the side: along it, never over
    let p = { ...start };
    for (let k = 0; k < 400; k++) p = walkDeck(type, p, 0.03, 0.01);
    assert.ok(deckFloor(type, p.x, p.z) !== null && Math.abs(p.x) < S.B / 2, `${type}: still aboard (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
    assert.ok(p.z > start.z + 0.3, `${type}: it slid along the gunwale`);
  }
  // the server: where the page says its player stands — on the deck, or else the wheel
  const hb = Object.create(Harbour.prototype), b = { type: 'coastal' }, bow = BOATS.coastal.deck.spots[0];
  assert.deepEqual(hb.deckOf(b, [bow.x, bow.y, bow.z, 0, 52]).at, [bow.x, bow.y, bow.z], 'on the bow deck');
  assert.equal(hb.deckOf(b, [bow.x, bow.y, bow.z, 0, 52]).clip, 52);
  assert.equal(hb.deckOf(b, [2.5, 0.42, 0, 0, 3]).at, BOATS.coastal.helm, 'over the side: at the wheel');
  assert.equal(hb.deckOf(b, [0, 0.42, 0, 0, 3]).at, BOATS.coastal.helm, 'inside the console: at the wheel');
  assert.equal(hb.deckOf(b, [bow.x, 3, bow.z, 0, 3]).at, BOATS.coastal.helm, 'floating over the deck: at the wheel');
  assert.equal(hb.deckOf(b, null).at, BOATS.coastal.helm);
});
