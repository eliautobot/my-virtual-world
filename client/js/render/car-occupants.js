// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The people in cars, drawn in their seats (2026-11-16, the product owner: "i think driving and companions shouldnt be
// hidden visually. the driver should be visible, and other companions aswell. so they are visible on the seat. This
// should also be the same for agents using cars to go places, they should appear as drivers inside the car, so please
// make it look right"). Who sits where:
//   - a player driving: at the wheel of their car (the vehicle stream's driver) — this page's own player, or another
//     player as the player stream shows them (driving: render/remote.js doesn't draw them walking meanwhile);
//   - companions riding with a player: in the seats the server gave them (server/world/car-seats.js, kept by core/net.js
//     vseats), while their plan has them hidden in the car;
//   - residents and agents driving their own cars: at the wheel of the car render/resident-cars.js draws.
// Their bodies stay hidden for everything else (picking, the cars' physics): this only draws them, and moves their name
// tags and voices (render/agents.js rx/ry/rz) to where they sit.
//
// A car's frame is the one its body is drawn with this frame (render/traffic.js carMatrix, render/resident-cars.js each),
// and this runs after those poses are known and before the people are drawn (render/agents.js update), so a person moves
// with their car exactly, at any speed. The seats are the model's own (render/vehicle-seats.js, through the vehicle
// asset); each body is fitted to its seat from its own measurements (render/seat-fit.js: the posture, on the cushion, the
// head under the roof, the back against the backrest, a driver's hands on the wheel), and a driver's hands turn the wheel
// as the car steers.
import * as THREE from 'three';
import { CLIP } from './anim.js';
import { PLAYER_APP } from './agents.js';
import { evalDecoded, F_HIDDEN } from '/shared/proto.js';
import { carSteerPhase } from '/shared/car-seat.js';
import { seatBody, seatScale } from './seat-fit.js';

const WHEEL_TURN = 1.5;      // the steering wheel turns this much more than the road wheels (as drawn)
const WHEELBASE = 2.7;       // m: a resident's car's turn from how its road bends
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _e = { k: 0, u: 0, x: 0, y: 0, z: 0 }, _fit = {};

/** Where the name tag of someone drawn in a car goes (render/labels.js): over the top of their head, as a standing
 *  person's is over theirs; null when they are not in a car this frame. */
export function seatedTagY(app, key, over) {
  const q = app.carOccupants?.placed.get(key);
  return q ? q.head + over : null;
}
export class CarOccupants {
  constructor(app) {
    this.app = app;
    this.stats = { cars: 0, people: 0, drivers: 0, riders: 0, ms: 0 };
    this.placed = new Map();   // who was put where this frame: 'r' + resident / 'p' + player id → { x, y, z, yaw, car }
  }
  /** One frame, from render/agents.js update (after the cars' poses are known, before the people are drawn). F: the
   *  frame's { t (sim time), frame, cp (camera), PL (frustum planes), L0, L1, L2 (squared LOD distances), now (s) }. */
  draw(A, F) {
    const t0 = performance.now(), app = this.app, st = this.stats;
    st.cars = st.people = st.drivers = st.riders = 0;
    this.placed.clear();
    // players' cars and those they used, and the companions in them (the vehicle stream: player/vehicles.js)
    const V = app.driving, T = app.traffic, seats = app.net?.vseats;
    if (V?.ready && T?.carMatrix && T.assets) {
      const me = app.player, R = app.remote;
      for (const r of V.byId.values()) {
        const c = r.draw || r.latest, riders = seats?.get(c.id);
        // the driver's look: this page's own player at the wheel of its car (its draw state, from this page's own physics,
        // carries no driver), or another player the player stream shows driving (render/remote.js: by the same state)
        let who = -1, key = null;
        if (c.id === V.id) { if (me?.active && me.state === 'drive') { who = PLAYER_APP; key = 'me'; } }
        else { const pid = r.latest?.driver || c.driver, p = pid ? R?.byPid.get(pid) : null; if (p?.driving) { who = p.extra.app; key = 'p' + pid; } }
        if (who < 0 && !riders) continue;
        const asset = T.assets[c.k];
        if (!asset) continue;
        T.carMatrix(c, _m);
        st.cars++;
        if (who >= 0 && this.put(A, F, asset.seats, 0, true, who, _m, -(c.steering || 0) * WHEEL_TURN, key, c.id)) st.drivers++;
        if (riders) for (const s of riders) if (s.kind === 'resident' && this.rider(A, F, s.id, asset.seats, s.seat, _m, c.id)) st.riders++;
      }
    }
    // residents at the wheel of their own cars (render/resident-cars.js)
    const RC = app.residentCars;
    if (RC?.each) {
      const kinds = RC.kinds();
      RC.each(F.t, (D, k, m, info) => {
        if (!info.wheel) return;
        st.cars++;
        if (this.put(A, F, kinds[k].asset.seats, 0, true, D.i, m, Math.atan(info.turn * WHEELBASE) * WHEEL_TURN, 'r' + D.i, 'r' + D.key)) { st.drivers++; this.mark(A, F, D.i); }
      });
    }
    st.people = st.drivers + st.riders;
    st.ms = performance.now() - t0;
  }
  /** A companion in seat `seat` of a car: drawn there while its plan has it hidden in the car (getting in and out are the
   *  plan's: no one is drawn twice, nor at the old place). */
  rider(A, F, i, seats, seat, m, car) {
    const p = this.app.net?.plans?.[i];
    if (!p || !(i < A.n)) return false;
    evalDecoded(p, F.t, _e);
    if (!(p.flags[_e.k] & F_HIDDEN)) return false;
    if (!this.put(A, F, seats, seat, false, i, m, 0, 'r' + i, car)) return false;
    this.mark(A, F, i);
    return true;
  }
  /** A resident drawn in a car this frame: its name tag and voice where it sits (render/agents.js rx/ry/rz), and out of the
   *  car it snaps to where its plan has it (no glide through the door). */
  mark(A, F, i) {
    const q = this.placed.get('r' + i);
    if (!q) return;
    A.rx[i] = q.x; A.ry[i] = q.y; A.rz[i] = q.z; A.yaw[i] = q.yaw; A.ctx[i] = -1;
    A.last[i] = F.frame; A.carF[i] = F.frame;
  }
  /**
   * Draws `app` (an appearance slot: a resident's index, a player's) in place `n` of a car whose body is drawn with
   * matrix m. turn: the wheel's turn for a driver (radians, + to their right). key: who, for this.placed.
   */
  put(A, F, seats, n, driver, app, m, turn, key, car) {
    const seat = seats?.[n];
    if (!seat || (driver && seat.role !== 'driver')) return false;
    const fit = seatBody(seat, driver, clip => A.chars.seatedFit(app, clip), _fit);
    if (!fit) return false;
    _p.set(fit.x, fit.y, fit.z).applyMatrix4(m);
    const e = m.elements, yaw = Math.atan2(e[8], e[10]);   // (the car's +Z, where the seat faces)
    // (head: the top of the head, for the name tag over it — render/labels.js)
    this.placed.set(key, { x: _p.x, y: _p.y, z: _p.z, yaw, car, head: _p.y + fit.m.top * fit.k * fit.H });
    // drawn when on screen and near enough (as render/agents.js draws people)
    const cp = F.cp, dx = _p.x - cp.x, dy = _p.y + 0.9 - cp.y, dz = _p.z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
    const lod = d2 < F.L0 ? 0 : d2 < F.L1 ? 1 : d2 < F.L2 ? 2 : -1;
    if (lod < 0) return true;
    for (const P of F.PL) if (P.normal.x * _p.x + P.normal.y * (_p.y + 0.9) + P.normal.z * _p.z + P.constant < -1.3) return true;
    const clip = fit.posture === 'car' ? (driver ? CLIP.car_drive : CLIP.car_ride) : (driver ? CLIP.drive : CLIP.sit_relax);
    let ph;
    if (clip === CLIP.car_drive) ph = carSteerPhase(turn);
    else if (clip === CLIP.drive) { const u = Math.max(-0.07, Math.min(0.07, turn / 6.85)); ph = u - Math.floor(u); }   // (the racing cabinet's clip: its wheel straight at phase 0)
    else { ph = F.now / 8 + (app * 0.381966) % 1; ph -= Math.floor(ph); }
    A.chars.push(lod, _p.x, _p.y, _p.z, yaw, clip, ph, clip, ph, 0, app, 0, seatScale(fit.k));
    return true;
  }
}

export function init(app) {
  if (!app.agents) return;
  const occ = app.carOccupants = new CarOccupants(app);
  app.agents.seated = occ;
}
