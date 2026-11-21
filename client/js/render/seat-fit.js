// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// How a body is fitted into a vehicle's seat (render/car-occupants.js draws it there; 2026-11-16, the product owner: "the
// driver should be visible, and other companions aswell. so they are visible on the seat ... make it look right"). The
// seat is the model's own (render/vehicle-seats.js: in the vehicle asset's frame, +Z forward, +X the vehicle's left, y up
// from the ground); the body's measurements are its own mesh's in each seated clip (tools/chars/extra-clips.mjs seatedOf,
// through render/characters.js seatedFit: root space, a body of height 1, with its height H and build B):
//   - the posture: a car's (the legs forward into the footwell: shared/car-seat.js) where the floor is close under the
//     seat, a chair's where it is deep (a bus's seats) — whichever's feet come nearer the floor;
//   - what it sits on rests on the cushion, sunk into it a little (SINK);
//   - the top of its head under the roof's lining (CLEAR): a body taller than the seat has room for is drawn that much
//     smaller (the vendored cabins are low for these bodies; tests/vehicle-seats.test.mjs keeps how much in view);
//   - its back against the backrest (never into it; the backrest leans back with height); a driver comes forward from it
//     as far as the wheel needs, so the hands are on the rim.
// Pure: no browser, no three.js (tests/vehicle-seats.test.mjs runs it against every model and every body).

// (the vendored cabins are low for these bodies — 0.6 to 0.7 m from a car's cushion to its lining, where a seated adult
//  needs about 0.9: a body sinks into a soft cushion, its hair may brush the lining, and only what is still too tall is
//  drawn smaller; 2026-11-16: at 5 cm and 1.5 cm under the lining, grown-ups were drawn three quarters of their size)
export const SINK = 0.05;      // m a body sinks into a seat's cushion
export const CLEAR = -0.05;    // m between the top of a head (its hair) and the roof lining over it: below 0, into it
export const BACK_GAP = 0.008; // m between a back and its backrest
export const MIN_SCALE = 0.3;  // (never smaller: a body is drawn at least this big, room or not)
export const FLOOR_IN = 0.22;  // m the feet may go into the floor before a body is drawn smaller: the footwell is out of sight under the dashboard and behind the doors, a body's size is not (the Classic cabins' floors are high)
export const REACH = 0.06;     // m a driver's hands may come past the wheel's middle before it is drawn smaller (the rim's grip)

/**
 * Where a body sits in `seat` as its driver or not. fitOf(clip) → { m, H, B } (render/characters.js seatedFit) for
 * 'car_drive' / 'car_ride' (a car's posture) and 'act_drive' / 'sit_idle' (a chair's), or null while unknown.
 * → { x, y, z (its root, in the seat's frame), k (its scale: 1 as tall as it is), posture ('car' | 'chair'), m, H, B }
 * into `out`, or null.
 */
export function seatBody(seat, driver, fitOf, out = {}) {
  const car = fitOf(driver ? 'car_drive' : 'car_ride'), chair = fitOf(driver ? 'act_drive' : 'sit_idle');
  if (!car && !chair) return null;
  const seatY = seat.top - SINK, depth = seatY - seat.floor, legs = f => (f.m.contact - f.m.sole) * f.H;
  const f = !chair || (car && Math.abs(legs(car) - depth) <= Math.abs(legs(chair) - depth)) ? car : chair, m = f.m;
  // as big as there is room for under the lining (never bigger than it is), and its feet not through the floor (a low
  // seat with legs longer than the drop to the floor: a little smaller, as for the roof)
  const legRoom = (seatY - seat.floor + FLOOR_IN) / Math.max(1e-6, (m.contact - m.sole) * f.H);
  let k = Math.max(MIN_SCALE, Math.min(1, (seat.lining - CLEAR - seatY) / ((m.top - m.contact) * f.H), legRoom > 0 ? legRoom : 1));
  // the back against the backrest: its face at height h, leaning back by `tilt` metres a metre up
  const face = h => seat.back + (h - seat.top - 0.12) * (seat.tilt || 0);
  const place = kk => {
    const sy = kk * f.H, sz = kk * f.H * f.B, y = seatY - m.contact * sy;
    let z = -Infinity;
    for (const b of [m.backLo, m.backHi]) z = Math.max(z, face(y + b[0] * sy) + BACK_GAP - b[1] * sz);
    // the driver: forward from it as far as the wheel needs (never back into it), the hands on the rim
    if (driver && seat.wheel && m.wheel) z = Math.max(z, seat.wheel.z - m.wheel[2] * sz);
    return { y, z, sz };
  };
  let p = place(k);
  // a driver too deep for a cab whose wheel is close to the backrest (the bus's): against the backrest its hands would
  // reach past the wheel — drawn that much smaller, as for the roof (the hands on the rim, its back not in the seat)
  if (driver && seat.wheel && m.wheel && p.z + m.wheel[2] * p.sz > seat.wheel.z + REACH) {
    for (let n = 0; n < 24 && k > MIN_SCALE && p.z + m.wheel[2] * p.sz > seat.wheel.z + REACH; n++) { k = Math.max(MIN_SCALE, k * 0.97); p = place(k); }
  }
  const { y, z } = p;
  out.x = seat.x; out.y = y; out.z = z; out.k = k; out.posture = f === car ? 'car' : 'chair';
  out.m = m; out.H = f.H; out.B = f.B;
  return out;
}
/** The flags' bits that draw a body at scale k (render/characters.js reads them: its height times 1 - q/300). */
export const seatScale = k => (Math.max(0, Math.min(255, Math.round((1 - k) * 300))) << 3);
