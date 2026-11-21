// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who sits where in the cars people drive, beyond the driver (2026-11-16, the product owner: "the driver should be
// visible, and other companions aswell. so they are visible on the seat"). The driver is the car's own (the vehicle
// stream's driver, server/world/vehicles.js); this keeps the other places: a companion who gets in with its player
// (server/companions/) is given one and keeps it for the ride, and every page is told, so everyone near the car sees the
// same person in the same seat (render/car-occupants.js draws them there).
//
// Places are numbered as render/vehicle-seats.js orders the seats it finds in each model: 0 the driver's, 1 the front
// passenger's, then row by row toward the back, the driver's side first. A car has as many as its kind's seats
// (shared/vehicle-specs.js VEHICLE_KINDS .seats, checked against the models by tests/vehicle-seats.test.mjs). Someone
// getting in takes the lowest free place, so the same riders boarding in the same order always sit the same way.
//
// The pages hear { t: 'vseats', id, seats: [{ seat, kind, id }] } when a car's riders change (an empty list: nobody but
// the driver) and { t: 'vseats', all: [[id, seats], …] } — every car with riders — when they connect.

const keyOf = who => `${who.kind}:${who.id}`;

export class CarSeats {
  /**
   * @param {object} o
   * @param {(id: number) => number} o.places  passenger places car `id` has (0: no such car)
   * @param {(message: object) => void} o.announce  sends a message to every page
   */
  constructor({ places = () => 0, announce = () => {} } = {}) {
    this.places = places; this.announce = announce;
    this.cars = new Map();   // car id → [{ seat, kind, id }], by place
    this.at = new Map();     // rider key → car id
  }
  get size() { return this.cars.size; }
  /** The riders of car id (a copy). */
  of(id) { return (this.cars.get(id) || []).map(r => ({ ...r })); }
  /** The car `who` ({ kind: 'resident', id: body index }) is riding in, or null. */
  where(who) { return this.at.get(keyOf(who)) ?? null; }
  /** Free passenger places in car id. */
  free(id) { return Math.max(0, this.places(id) - (this.cars.get(id)?.length || 0)); }
  /**
   * Seats `who` in car id: the place it already has there, else the lowest free one (out of any other car first).
   * Returns the place (1…), or 0 when the car has none free or doesn't exist.
   */
  seat(id, who) {
    const k = keyOf(who), was = this.at.get(k);
    if (was === id) return this.cars.get(id).find(r => keyOf(r) === k).seat;
    const n = this.places(id);
    if (!(n > 0)) return 0;
    const list = this.cars.get(id) || [], taken = new Set(list.map(r => r.seat));
    let seat = 0;
    for (let s = 1; s <= n; s++) if (!taken.has(s)) { seat = s; break; }
    if (!seat) return 0;
    if (was !== undefined) this.unseat(who);
    list.push({ seat, kind: who.kind, id: who.id }); list.sort((a, b) => a.seat - b.seat);
    this.cars.set(id, list); this.at.set(k, id);
    this.announce(this.message(id));
    return seat;
  }
  /** Gets `who` out of whatever car it is in: that car's id, or null (it was in none). */
  unseat(who) {
    const k = keyOf(who), id = this.at.get(k);
    if (id === undefined) return null;
    this.at.delete(k);
    const list = (this.cars.get(id) || []).filter(r => keyOf(r) !== k);
    if (list.length) this.cars.set(id, list); else this.cars.delete(id);
    this.announce(this.message(id));
    return id;
  }
  /** Car id is gone: its riders with it. */
  clear(id) {
    const list = this.cars.get(id);
    if (!list) return;
    for (const r of list) this.at.delete(keyOf(r));
    this.cars.delete(id);
    this.announce(this.message(id));
  }
  /** Makes the riders exactly `want` ([{ kind, id, car }]): those no longer riding out, the rest in (each keeping its
   *  place). Who couldn't be seated (the car full or gone) is returned. */
  sync(want) {
    const keep = new Set(want.map(keyOf));
    for (const list of [...this.cars.values()]) for (const r of [...list]) if (!keep.has(keyOf(r))) this.unseat(r);
    const out = [];
    for (const w of want) if (this.where(w) !== w.car && !this.seat(w.car, w)) out.push(w);
    return out;
  }
  message(id) { return { t: 'vseats', id, seats: this.of(id) }; }
  /** Every car with riders, for a page that just connected. */
  state() { return { t: 'vseats', all: [...this.cars].map(([id, list]) => [id, list.map(r => ({ ...r }))]) }; }
}
