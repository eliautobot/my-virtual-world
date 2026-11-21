// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Seats found in each vehicle model (render/vehicle-seats.js, through render/vehicle-assets.js) and people fitted into
// them (render/seat-fit.js; 2026-11-16, the product owner: "the driver should be visible, and other companions aswell. so
// they are visible on the seat"): every kind has its driver behind the wheel on the left, as many places as the server
// seats people in (shared/vehicle-specs.js), each inside the body with room over it; every character of every height and
// build sits on its seat, its head under the roof, its back not in the backrest, a driver's hands at the wheel.
import './helpers/client-paths.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createVehicleAsset } from '../client/js/render/vehicle-assets.js';
import { seatBody, seatScale, SINK, CLEAR, BACK_GAP, FLOOR_IN } from '../client/js/render/seat-fit.js';
import { VEHICLE_KINDS } from '../shared/vehicle-specs.js';
import { CAR_DRIVE, carSteerPhase, carSteerOfFrame } from '../shared/car-seat.js';

const assets = VEHICLE_KINDS.map(k => ({ k, a: createVehicleAsset(k) }));
const venue = (() => { try { return JSON.parse(fs.readFileSync(new URL('../client/assets/chars/venue-clips.json', import.meta.url), 'utf8')); } catch { return null; } })();

test('every kind: as many places as the server seats people in, the driver first, on the left, behind the wheel', () => {
  for (const { k, a } of assets) {
    const S = a.seats;
    assert.equal(S.length, k.seats, `${k.n}: ${S.length} places found, ${k.seats} in shared/vehicle-specs.js`);
    assert.equal(S.filter(s => s.role === 'driver').length, 1, `${k.n}: one driver's place`);
    const d = S[0];
    assert.equal(d.role, 'driver', `${k.n}: the driver's place is place 0`);
    assert.ok(d.x > 0.2, `${k.n}: the driver sits on the left (the asset's +X), as in the US`);
    assert.ok(d.wheel && d.wheel.z > d.front - 0.05 && d.wheel.z < d.front + 0.6, `${k.n}: the wheel just in front of the driver's cushion`);
    assert.ok(Math.abs(d.wheel.x - d.x) < 0.05, `${k.n}: the wheel in line with the driver`);
    assert.ok(d.wheel.y > d.top + 0.15 && d.wheel.y < d.top + 0.55, `${k.n}: the wheel at a hand's height over the seat (${(d.wheel.y - d.top).toFixed(2)} m)`);
    // the front passenger beside the driver (a bus's driver has its cab alone), then row by row, the driver's side first
    if (S.some((s, n) => n && s.row === d.row)) assert.ok(S[1].row === d.row && S[1].x < 0, `${k.n}: place 1 is the front passenger's, on the right`);
    for (let n = 2; n < S.length; n++) assert.ok(S[n].row > S[n - 1].row || (S[n].row === S[n - 1].row && S[n - 1].x > S[n].x), `${k.n}: place ${n} after ${n - 1} (row by row, the left first)`);
  }
});

test('every place is inside its vehicle\'s body, with a backrest behind, a floor under and a roof over it, apart from the others', () => {
  for (const { k, a } of assets) {
    for (const [n, s] of a.seats.entries()) {
      const at = `${k.n} place ${n}`;
      assert.ok(Math.abs(s.x) + s.room / 2 < k.W / 2, `${at}: across, inside the body`);
      assert.ok(s.back > -k.L / 2 && s.front < k.L / 2 && s.back < s.front, `${at}: along, inside the body, its backrest behind its front edge`);
      assert.ok(s.floor > 0 && s.floor < s.top, `${at}: a floor under the cushion`);
      assert.ok(s.top < s.lining && s.lining < k.H, `${at}: the lining over it, under the roof`);
      assert.ok(s.lining - s.top > 0.5, `${at}: room to sit (${(s.lining - s.top).toFixed(2)} m)`);
      assert.ok(Math.abs(s.tilt) < 0.3, `${at}: the backrest near upright (${s.tilt.toFixed(2)}: the Classic front seats' lean a little forward at the top)`);
      assert.ok(s.wallIn > 0.05, `${at}: the door clear of its middle`);
      for (const [m, o] of a.seats.entries()) if (m > n) assert.ok(Math.hypot(s.x - o.x, (s.back + s.front) / 2 - (o.back + o.front) / 2) > 0.45, `${at} and ${m}: apart`);
    }
  }
});

test('the driver\'s clip: its frames turn the wheel from full left to full right, the phase is the turn', () => {
  assert.equal(carSteerOfFrame(0), -CAR_DRIVE.turn);
  assert.equal(carSteerOfFrame(CAR_DRIVE.frames - 1), CAR_DRIVE.turn);
  assert.ok(Math.abs(carSteerOfFrame((CAR_DRIVE.frames - 1) / 2)) < 1e-9, 'straight in the middle');
  for (const turn of [-2, -0.9, -0.3, 0, 0.45, 0.9, 3]) {
    const ph = carSteerPhase(turn);
    assert.ok(ph >= 0 && ph <= (CAR_DRIVE.frames - 1) / CAR_DRIVE.frames + 1e-9, 'never past the last frame (it would blend back into the first)');
    assert.ok(Math.abs(carSteerOfFrame(ph * CAR_DRIVE.frames) - Math.max(-CAR_DRIVE.turn, Math.min(CAR_DRIVE.turn, turn))) < 1e-9, `the frame of ${turn} turns the wheel by it`);
  }
  for (const k of [1, 0.9, 0.6, 0.3]) assert.ok(Math.abs((1 - (seatScale(k) >> 3) / 300) - k) < 0.002, `scale ${k} through the flags`);
  assert.equal(seatScale(1), 0, 'full size: no bits');
  assert.equal(seatScale(1) & 7, 0, 'the low bits (selected, hovered, indoors) left alone');
});

test('every character of every height and build sits right in every seat of every vehicle', { skip: !venue?.seated && 'the characters are not here (client/assets/chars)' }, () => {
  const kinds = Object.keys(venue.seated);
  assert.ok(kinds.length >= 20, 'the characters\' seated measurements are baked (tools/chars/extra-clips.mjs --set venue)');
  let small = { k: 1 }, worstHands = { d: 0 }, worstFeet = { d: 0 }, n = 0;
  for (const { k: vk, a } of assets) for (const [p, seat] of a.seats.entries()) for (const kind of kinds) for (const H of [0.85, 1, 1.12]) for (const B of [0.85, 1.2]) {
    const driver = seat.role === 'driver', at = `${vk.n} place ${p}, ${kind} (height ${H}, build ${B})`;
    const fit = seatBody(seat, driver, clip => (venue.seated[kind][clip] ? { m: venue.seated[kind][clip], H, B } : null));
    assert.ok(fit, `${at}: fitted`);
    n++;
    const { m, k } = fit, sy = k * fit.H, sz = k * fit.H * fit.B;
    // on the cushion (sunk into it as much as SINK), its head under the lining, never bigger than it is
    assert.ok(Math.abs(fit.y + m.contact * sy - (seat.top - SINK)) < 1e-9, `${at}: on the cushion`);
    assert.ok(k <= 1 && k >= 0.3, `${at}: its size (${k.toFixed(2)})`);
    if (k > 0.3) assert.ok(fit.y + m.top * sy <= seat.lining - CLEAR + 1e-9, `${at}: the head under the roof's lining`);
    // its back: not into the backrest (which leans back with height)
    for (const b of [m.backLo, m.backHi]) {
      const y = fit.y + b[0] * sy, face = seat.back + (y - seat.top - 0.12) * seat.tilt;
      assert.ok(fit.z + b[1] * sz >= face + BACK_GAP - 1e-9, `${at}: its back not in the backrest`);
    }
    // the posture whose feet come nearest the floor (a car's in a car's low seats, a chair's on a bus's high ones): the
    // feet on it, not through it (a few centimetres into it at most: the sole's measure is the toes', pointing down)
    const feet = fit.y + m.sole * sy - seat.floor;
    // (into it only as far as FLOOR_IN: the footwell is out of sight, a body's size is not — render/seat-fit.js)
    assert.ok(feet > -FLOOR_IN - 0.01 && feet < 0.24, `${at}: the feet on the floor (${(feet * 100).toFixed(1)} cm), the ${fit.posture}'s posture`);
    if (['sedan', 'compact', 'taxi'].includes(vk.n)) assert.equal(fit.posture, 'car', `${at}: a car's posture in a low car`);
    if (Math.abs(feet) > Math.abs(worstFeet.d)) worstFeet = { d: feet, at };
    // a driver's hands at the wheel: its clip's wheel point on the wheel's middle (when the backrest lets it come so far
    // forward — the bus's wheel is close: there it sits back against the backrest, the hands at most a hand's width off)
    if (driver && m.wheel) {
      const wz = fit.z + m.wheel[2] * sz, wy = fit.y + m.wheel[1] * sy, d = Math.hypot(wz - seat.wheel.z, wy - seat.wheel.y);
      assert.ok(d < seat.wheel.r + 0.05, `${at}: the hands on the wheel (its clip's wheel ${(d * 100).toFixed(1)} cm from its middle, its rim ${(seat.wheel.r * 100).toFixed(0)} cm out)`);
      assert.ok(Math.abs(wz - seat.wheel.z) < 0.09, `${at}: the hands at the wheel's rim, not in front of it nor behind (${((wz - seat.wheel.z) * 100).toFixed(1)} cm)`);
      if (d > worstHands.d) worstHands = { d, at };
    }
    if (k < small.k) small = { k, at };
  }
  console.log(`  ${n} fits; the smallest ${small.k.toFixed(2)} (${small.at}); hands farthest from the wheel's middle ${(worstHands.d * 100).toFixed(1)} cm (${worstHands.at}); feet farthest off the floor ${(worstFeet.d * 100).toFixed(1)} cm (${worstFeet.at})`);
});
