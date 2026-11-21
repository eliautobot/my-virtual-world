// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who sits where in the cars people drive (server/world/car-seats.js): a rider takes the lowest free place and keeps it
// for the ride, a car takes no more than its seats, getting out frees the place, a page that connects is told every car's
// riders, and riders of two cars side by side never mix.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarSeats } from '../../server/world/car-seats.js';
import { VEHICLE_KINDS } from '../../shared/vehicle-specs.js';

const R = id => ({ kind: 'resident', id });
function setup(cars = { 10: 3, 11: 3 }) {
  const said = [];
  const seats = new CarSeats({ places: id => cars[id] ?? 0, announce: m => said.push(JSON.parse(JSON.stringify(m))) });
  return { seats, said, cars };
}

test('the lowest free place, kept for the ride; the same riders in the same order always sit the same way', () => {
  const { seats, said } = setup();
  assert.equal(seats.seat(10, R(5)), 1, 'the front passenger seat first');
  assert.equal(seats.seat(10, R(7)), 2);
  assert.equal(seats.seat(10, R(9)), 3);
  assert.equal(seats.seat(10, R(7)), 2, 'seating someone already in it gives the place it has');
  assert.deepEqual(seats.of(10), [{ seat: 1, kind: 'resident', id: 5 }, { seat: 2, kind: 'resident', id: 7 }, { seat: 3, kind: 'resident', id: 9 }]);
  assert.equal(said.length, 3, 'told once per change (not for someone who was already seated)');
  assert.deepEqual(said.at(-1), { t: 'vseats', id: 10, seats: seats.of(10) });
  // the middle one gets out: the others keep their places; the next one in takes the freed place
  assert.equal(seats.unseat(R(7)), 10);
  assert.deepEqual(seats.of(10).map(r => [r.id, r.seat]), [[5, 1], [9, 3]]);
  assert.equal(seats.seat(10, R(12)), 2);
  assert.deepEqual(seats.of(10).map(r => [r.id, r.seat]), [[5, 1], [12, 2], [9, 3]]);
  // the same riders boarding in the same order sit the same way, every time
  const again = setup().seats;
  for (const id of [5, 7, 9]) again.seat(10, R(id));
  const first = setup().seats;
  for (const id of [5, 7, 9]) first.seat(10, R(id));
  assert.deepEqual(again.of(10), first.of(10));
});

test('no more riders than the car has seats; getting out frees a seat; no car, no seat', () => {
  const { seats, said } = setup({ 10: 1 });
  assert.equal(seats.free(10), 1);
  assert.equal(seats.seat(10, R(1)), 1);
  assert.equal(seats.free(10), 0);
  assert.equal(seats.seat(10, R(2)), 0, 'full');
  assert.equal(seats.where(R(2)), null);
  assert.equal(seats.unseat(R(1)), 10);
  assert.deepEqual(said.at(-1), { t: 'vseats', id: 10, seats: [] }, 'an emptied car is told as no riders');
  assert.equal(seats.size, 0);
  assert.equal(seats.seat(10, R(2)), 1, 'the freed seat');
  assert.equal(seats.seat(99, R(3)), 0, 'a car that is not there');
  assert.equal(seats.unseat(R(3)), null, 'out of no car');
  // each kind's passenger places: its seats less the driver's
  for (const k of VEHICLE_KINDS) assert.ok(Number.isInteger(k.seats) && k.seats >= 2, `${k.n}: a driver and at least one passenger`);
});

test('a page that connects hears every car with riders; a car taken away takes its riders with it', () => {
  const { seats, said } = setup();
  seats.seat(10, R(1)); seats.seat(11, R(2)); seats.seat(11, R(3));
  assert.deepEqual(seats.state(), { t: 'vseats', all: [[10, [{ seat: 1, kind: 'resident', id: 1 }]], [11, [{ seat: 1, kind: 'resident', id: 2 }, { seat: 2, kind: 'resident', id: 3 }]]] });
  // (a page that kept the deltas has the same picture as one that connects now)
  const page = new Map();
  for (const m of said) if (m.id !== undefined) { if (m.seats.length) page.set(m.id, m.seats); else page.delete(m.id); }
  assert.deepEqual([...page], seats.state().all);
  seats.clear(11);
  assert.deepEqual(said.at(-1), { t: 'vseats', id: 11, seats: [] });
  assert.equal(seats.where(R(2)), null);
  assert.deepEqual(seats.state().all.map(([id]) => id), [10]);
});

test('two cars side by side never mix their riders; moving to another car leaves the first', () => {
  const { seats } = setup();
  seats.seat(10, R(1)); seats.seat(11, R(2)); seats.seat(10, R(3)); seats.seat(11, R(4));
  assert.deepEqual(seats.of(10).map(r => r.id), [1, 3]);
  assert.deepEqual(seats.of(11).map(r => r.id), [2, 4]);
  assert.equal(seats.seat(11, R(1)), 3, 'into the other car: its lowest free place');
  assert.deepEqual(seats.of(10).map(r => [r.id, r.seat]), [[3, 2]], 'out of the first');
  assert.equal(seats.where(R(1)), 11);
});

test('sync: the seats follow who is riding, however they got in or out; who can\'t be seated is returned', () => {
  const { seats } = setup({ 10: 2, 11: 3 });
  assert.deepEqual(seats.sync([{ ...R(1), car: 10 }, { ...R(2), car: 10 }, { ...R(3), car: 10 }]).map(w => w.id), [3], 'the car is full for the third');
  assert.deepEqual(seats.of(10).map(r => [r.id, r.seat]), [[1, 1], [2, 2]]);
  seats.sync([{ ...R(2), car: 10 }, { ...R(4), car: 11 }]);
  assert.deepEqual(seats.of(10).map(r => [r.id, r.seat]), [[2, 2]], 'who got out is out, the other keeps its place');
  assert.deepEqual(seats.of(11).map(r => [r.id, r.seat]), [[4, 1]]);
  seats.sync([]);
  assert.equal(seats.size, 0);
});
