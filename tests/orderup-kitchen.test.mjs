// Order Up's kitchens (phase 3, 2026-10-27, "make sure you test everything"): in every café style and floor size with a
// kitchen, every station has somewhere in front of it the cook can walk to from the middle of the kitchen (the same
// geometry as client/js/play/order-up.js: the kitchen's frame from the pass, the stations' boxes, the cook's radius), and
// the kitchen has a menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, freshLevel } from '../server/world/generate.js';
import { kitchenReach } from './helpers/orderup-reach.mjs';
import { CAFE_STYLE_IDS } from '../shared/floor-themes.js';
import { newRush } from '../shared/orderup/rules.js';
import { kitchenFloor, checkItem, KITCHEN_WHY } from '../shared/edit.js';

test('every café kitchen: every station can be walked up to, and there is a menu', () => {
  const w = generateWorld({ seed: 'orderup-kitchens', population: 300 });
  const offices = w.buildings.filter(b => b && !b.gone && (b.type === 'office' || b.type === 'hq') && b.floors >= 3).sort((a, b) => b.w * b.d - a.w * a.d);
  const floors = [...offices.filter((_, i) => i % Math.max(1, Math.floor(offices.length / 8)) === 0).map(b => [b, 1]), ...w.buildings.filter(b => b && b.type === 'cafe').slice(0, 4).map(b => [b, b.floors > 1 ? 1 : 0])];
  let kitchens = 0; const bad = [];
  for (const [b, f] of floors) for (const st of CAFE_STYLE_IDS) {
    const L = freshLevel(b, f, 777, 'cafe', st), reach = kitchenReach(L.items); if (!reach) continue;
    kitchens++;
    for (const r of reach) if (!r.ok) bad.push(`${st} ${b.w.toFixed(1)}x${b.d.toFixed(1)}: ${r.t}`);
    const menu = newRush(L.items.filter(i => i.t.startsWith('ou_')).map((i, k) => ({ id: k, t: i.t }))).menu;
    if (menu.length < 2) bad.push(`${st} ${b.w.toFixed(1)}x${b.d.toFixed(1)}: menu ${menu.join(',')}`);
  }
  assert.ok(kitchens >= 20, `${kitchens} kitchens looked at`);
  assert.deepEqual(bad, []);
});

test('kitchens go only where food or drink is served: cafés, restaurants, lounges, clubs, arcades; not offices, flats, shops or gyms', () => {
  // (the product owner 2026-10-27: "placable in food only locations, meaning, Cafes, Dinners, Restaurants...etc", then
  // "lounges and clubs and even arcades should have a kitchen")
  const w = generateWorld({ seed: 'orderup-kitchens', population: 300 }), live = w.buildings.filter(b => b && !b.gone);
  const one = (pred, f) => { const b = live.find(pred); assert.ok(b, 'a building of that kind'); f ??= b.floors - 1; return [b, f, w.levels[b.lv[f]]]; };
  const yes = {
    'a café': one(b => b.type === 'cafe', 0),
    "a café's upstairs": one(b => b.type === 'cafe' && b.floors > 1, 1),
    'a restaurant': one(b => b.type === 'restaurant', 0),
    'the café under flats': one(b => b.type === 'apartment' && b.mixed === 'cafe', 0),
    'the restaurant under flats': one(b => b.type === 'apartment' && b.mixed === 'restaurant', 0),
  };
  const no = {
    'an office floor': one(b => b.type === 'office' && b.floors > 1, 1),
    "an office lobby's coffee corner": one(b => b.type === 'office' && b.mixed === 'cafe', 0),
    'a flat': one(b => b.type === 'apartment' && b.floors > 1, 1),
    'a block of flats\' lobby': one(b => b.type === 'apartment' && !b.mixed, 0),
    'a shop': one(b => b.type === 'shop', 0),
    'the shop under flats': one(b => b.type === 'apartment' && b.mixed === 'shop', 0),
    'a gym': one(b => b.type === 'gym', 0),
    'a park': one(b => b.type === 'park', 0),
    "a headquarters' Sky Lounge": one(b => b.type === 'hq' && b.floors > 2, null),
  };
  for (const [k, [b, f, L]] of Object.entries(yes)) assert.equal(kitchenFloor(b, f, L), true, k);
  for (const [k, [b, f, L]] of Object.entries(no)) assert.equal(kitchenFloor(b, f, L), false, k);
  // a floor themed as a place is that place, whatever its building is
  const [ob, of] = no['an office floor'], [cb] = yes['a café'];
  for (const th of ['cafe', 'restaurant', 'lounge', 'club', 'arcade']) assert.equal(kitchenFloor(ob, of, freshLevel(ob, of, 5, th)), true, `an office floor themed as ${th}`);
  for (const th of ['office', 'shop', 'gym', 'conference']) assert.equal(kitchenFloor(cb, 0, { items: [], theme: th }), false, `a café's floor themed as ${th}`);
  assert.equal(kitchenFloor({ type: 'terminal', floors: 2 }, 1, { venue: 'cafe', items: [] }), false, "the airport's café");
  // the editor and the server refuse a station anywhere else, and only there
  const [lb, lf, LL] = no['an office floor'];
  assert.equal(checkItem(lb, lf, LL, { t: 'ou_pass', x: 0, z: 0, r: 0 }), KITCHEN_WHY);
  assert.notEqual(checkItem(cb, 0, yes['a café'][2], { t: 'ou_pass', x: 0, z: 0, r: 0 }), KITCHEN_WHY);
  assert.notEqual(checkItem(lb, lf, LL, { t: 'cafe_table', x: 0, z: 0, r: 0 }), KITCHEN_WHY, 'other pieces as before');
});

