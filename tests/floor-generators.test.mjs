// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The floor generators (floor layouts step 4, 2026-10-04): apartment floors of real flats (studios, one- and
// two-bedroom) and office floors of rooms and desk clusters, both counted out from the elevator in fixed widths so that a
// resize changes only what is at the far edge; every flat has what a home needs and nothing is left out of reach.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevels, validate } from '../server/world/generate.js';
import { coreFor, buildLevel, packUnits } from '../server/world/layouts.js';
import { RNG } from '../shared/rng.js';
import { CATALOG } from '../shared/catalog.js';

const bld = (type, w, d, floors = 4, seed = 4242) => { const b = { idx: 0, type, floors, w, d, x: 0, z: 0, rot: 0, seed, door: { x: 0, w: type === 'apartment' ? 1.8 : 2.4 }, style: 'brick' }; b.core = coreFor(b); return b; };
const floor = (b, f = 1) => buildLevel(b, f, new RNG(`${b.seed}:floor:${f}`));
const inside = (it, u) => it.x >= u.x0 && it.x <= u.x1 && it.z >= Math.min(u.z0, u.z1) && it.z <= Math.max(u.z0, u.z1);

test('flats are counted out from the elevator in fixed widths; only the last one takes what is left', () => {
  const kinds = k => ['one', 'two', 'studio'][k % 3];
  const a = packUnits(30, kinds, 6.7), b = packUnits(31, kinds, 6.7);
  assert.deepEqual(a.slice(0, -1).map(u => u.w), [8.4, 10.8], 'fixed widths');
  assert.deepEqual(b.slice(0, a.length - 1), a.slice(0, -1), 'a metre more changes only the last flat (it may become two)');
  assert.ok(Math.abs(a.reduce((s, u) => s + u.w, 0) - 30) < 1e-9 && Math.abs(b.reduce((s, u) => s + u.w, 0) - 31) < 1e-9, 'the row is filled');
  assert.ok(packUnits(12, kinds, 5.5).every(u => u.kind === 'studio'), 'shallow flats are studios');
});

test('every flat has a bed, a toilet, a shower or bath, a basin, a kitchen and a fridge, all within reach', () => {
  for (const [w, d] of [[17, 17], [23.25, 21.6], [30, 20], [13, 17], [40, 30], [20.5, 17], [55, 22]]) {
    const b = bld('apartment', w, d), raw = floor(b), kept = validate(b, structuredClone(raw), 1);
    const lost = raw.items.filter(i => !kept.items.some(k => k.t === i.t && k.x === i.x && k.z === i.z)).map(i => i.t);
    assert.ok(!lost.some(t => /bed|toilet|shower|bathtub|sink|kitchen|counter|fridge/.test(t)) && lost.length <= 2, `${w}×${d}: what a home needs is within reach (out of reach: ${lost.join(', ') || 'nothing'})`);
    assert.ok(raw.units.length >= 2, `${w}×${d}: flats on both sides`);
    for (const u of raw.units) {
      const ts = new Set(raw.items.filter(it => inside(it, u)).map(it => it.t)), has = (...t) => t.some(x => ts.has(x));
      for (const [what, ok] of [['bed', has('bed_double', 'bed_single')], ['toilet', has('toilet')], ['shower or bath', has('shower', 'bathtub')], ['basin', has('sink')], ['kitchen', has('kitchen', 'counter')], ['fridge', has('fridge')]]) {
        assert.ok(ok, `${w}×${d}: a ${u.kind} flat at x ${u.x0}…${u.x1} has a ${what}`);
      }
      const beds = raw.items.filter(it => inside(it, u)).reduce((n, it) => n + (CATALOG[it.t].slots || []).filter(s => s.use === 'sleep').length, 0);
      if (u.kind === 'two') assert.ok(beds >= 3, `a two-bedroom flat sleeps 3 (${beds})`);
    }
  }
});

const key = (it, a) => `${it.t}|${(it.x - a.x).toFixed(2)}|${(it.z - a.z).toFixed(2)}|${it.r}`;
function stays(b, grow) {
  const A = floor(b), nb = { ...b, ...grow }; nb.core = coreFor(nb);
  const Bv = floor(nb), core = L => L.items.find(i => CATALOG[i.t].fixed);
  const want = new Map();
  for (const it of A.items) { const k = key(it, core(A)); want.set(k, (want.get(k) || 0) + 1); }
  let n = 0;
  for (const it of Bv.items) { const k = key(it, core(Bv)); if (want.get(k)) { want.set(k, want.get(k) - 1); n++; } }
  return n / A.items.length;
}
test('a metre wider: most of an apartment floor and an office floor stays exactly where it was', () => {
  for (const [w, d] of [[23.25, 21.6], [30, 20], [40, 30]]) assert.ok(stays(bld('apartment', w, d), { w: w + 1 }) >= 0.6, `apartments ${w}×${d}`);
  for (const [w, d] of [[20, 18], [30, 22], [44, 30]]) {
    assert.ok(stays(bld('office', w, d), { w: w + 1 }) >= 0.75, `offices ${w}×${d}`);   // (a small one has one room a side: the one that gives)
    assert.ok(stays(bld('office', w, d), { d: d + 1 }) >= 0.8, `offices ${w}×${d} deeper`);
  }
});

test('office floors: rooms along the back, desks in front, a private office\'s desk within reach, desks on a narrow floor too', () => {
  for (const [w, d] of [[10.8, 15], [20, 18], [30, 22], [44, 30]]) {
    const b = bld('office', w, d), raw = floor(b), kept = validate(b, structuredClone(raw), 1);
    const work = kept.items.reduce((n, it) => n + (CATALOG[it.t].slots || []).filter(s => s.use === 'work').length, 0);
    assert.ok(work >= Math.floor(w * d / 30), `${w}×${d}: ${work} work places`);
    if (w >= 20) assert.ok(raw.items.some(i => i.t === 'meeting_table' || i.t === 'cafe_table4') && raw.items.some(i => i.t === 'kitchen'), `${w}×${d}: a meeting room and a kitchen`);
    assert.ok(raw.items.length - kept.items.length <= 2, `${w}×${d}: (almost) nothing out of reach`);
  }
});

test('every floor has its own dice: a building of another width keeps the same first flats', () => {
  const W = { levels: [], buildings: [] }, b = bld('apartment', 30, 20), c = bld('apartment', 31, 20);
  generateLevels(W, b, null);
  const W2 = { levels: [], buildings: [] };
  generateLevels(W2, c, null);
  const first = (Wx, bx) => { const L = Wx.levels[bx.lv[1]], u = L.units[0]; return L.items.filter(it => inside(it, u)).map(it => [it.t, +(it.x - u.x0).toFixed(3), it.z, it.r]); };
  assert.deepEqual(first(W2, c), first(W, b));
});

// Street floors (cafés, restaurants, shops, gyms, lobbies): laid out from the entrance - or from the elevator on the
// floors above the street - with the staff's place by the door, everything within reach, and a resize changing only the edges.
function staysFrom(b, f, grow, anchor) {
  const A = floor(b, f), nb = { ...b, ...grow }; nb.core = coreFor(nb);
  const Bv = floor(nb, f), want = new Map();
  for (const it of A.items) { const k = key(it, anchor(b, A)); want.set(k, (want.get(k) || 0) + 1); }
  let n = 0;
  for (const it of Bv.items) { const k = key(it, anchor(nb, Bv)); if (want.get(k)) { want.set(k, want.get(k) - 1); n++; } }
  return n / A.items.length;
}
const door = b => ({ x: b.door.x, z: b.d / 2 - 0.25 }), lift = (b, L) => L.items.find(i => CATALOG[i.t].fixed);
test('street floors: the staff place by the door, seats or shelves, everything within reach', () => {
  const staffOf = L => L.items.reduce((n, it) => n + (CATALOG[it.t].slots || []).filter(s => s.use === 'staff').length, 0);
  for (const [type, w, d, floors] of [['cafe', 14, 14, 1], ['cafe', 20, 16, 2], ['restaurant', 18, 16, 1], ['restaurant', 24, 20, 2], ['shop', 14, 12, 1], ['shop', 22, 18, 2], ['gym', 16, 14, 1], ['gym', 26, 18, 3], ['office', 24, 18, 4]]) {
    const b = bld(type, w, d, floors);
    for (let f = 0; f < Math.min(floors, type === 'office' ? 1 : 2); f++) {
      const raw = floor(b, f), kept = validate(b, structuredClone(raw), f), name = `${type} ${w}×${d} floor ${f + 1}`;
      assert.ok(raw.items.length - kept.items.length <= 2, `${name}: within reach (lost ${raw.items.length - kept.items.length})`);
      if (f === 0) assert.ok(staffOf(kept) >= 1, `${name}: a place for the staff`);
      const uses = new Set(kept.items.flatMap(it => (CATALOG[it.t].slots || []).map(s => s.use)));
      if (type === 'cafe' || type === 'restaurant') assert.ok(uses.has('eat'), `${name}: seats`);
      if (type === 'shop') assert.ok(uses.has('browse'), `${name}: shelves`);
      if (type === 'gym') assert.ok(uses.has('run') && uses.has('lift'), `${name}: machines`);
    }
  }
});
test('street floors: a metre wider keeps most of the floor in place around the entrance (or the elevator upstairs)', () => {
  for (const [type, w, d] of [['cafe', 18, 16], ['restaurant', 22, 18], ['shop', 20, 16], ['gym', 24, 18]]) {
    const one = bld(type, w, d, 1), two = bld(type, w, d, 2);
    assert.ok(staysFrom(one, 0, { w: w + 1 }, door) >= 0.6, `${type} street floor`);
    assert.ok(staysFrom(two, 1, { w: w + 1 }, lift) >= 0.6, `${type} upstairs`);
  }
  assert.ok(staysFrom(bld('office', 26, 20), 0, { w: 27 }, door) >= 0.7, 'office lobby');
});

test('a fishing dock\'s store is a tackle shop: rod racks, the lure wall, the live bait and the fish market\'s counter, all within reach', () => {
  for (const [w, d, floors] of [[14, 10, 1], [10, 8, 1], [18, 12, 1]]) {
    const b = { ...bld('shop', w, d, floors), tackle: true, name: 'Dock Store' }, raw = floor(b, 0), kept = validate(b, structuredClone(raw), 0), t = new Set(kept.items.map(i => i.t));
    assert.ok(t.has('fish_counter') && t.has('rod_rack') && t.has('lure_wall'), `${w}×${d}: ${[...t].join(', ')}`);
    assert.ok(!t.has('checkout') && !t.has('shop_shelf') && !t.has('clothes_rack'), 'no ordinary shop fittings');
    for (const k of ['rod_rack', 'lure_wall', 'bait_fridge', 'fish_counter']) assert.ok(CATALOG[k]?.slots?.length, `${k} is in the catalog with somewhere to stand`);
  }
});
