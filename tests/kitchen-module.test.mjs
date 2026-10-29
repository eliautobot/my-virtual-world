// The Kitchen as an interior module (shared/kitchen-module.js, PLAN-RESTAURANT-GAME.md 6b K2, the product owner
// 2026-10-27: "a placable module inside a building so that users can switch it ... maybe it needs to be bigger or
// smaller"): every size facing every way has every station within reach and a menu; it goes only where food or drink is
// served; a café's own kitchen is a module record whose pieces are exactly its kitchen, and laid again it is the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, freshLevel } from '../server/world/generate.js';
import { CATALOG } from '../shared/catalog.js';
import { CAFE_STYLE_IDS } from '../shared/floor-themes.js';
import { interiorBounds, KITCHEN_WHY, checkItem } from '../shared/edit.js';
import { CUISINE_OF } from '../shared/food.js';
const CUISINE_OF_CAFE = () => [...CUISINE_OF.cafe.menu];
import { INTERIOR_KINDS, normalizeModule, checkModule, layModule, modsAt } from '../shared/interior-kinds.js';
import { KITCHEN_SIZES, PASS_BAND } from '../shared/kitchen-module.js';
import { newRush } from '../shared/orderup/rules.js';
import { kitchenReach } from './helpers/orderup-reach.mjs';

const w = generateWorld({ seed: 'orderup-kitchens', population: 300 }), live = w.buildings.filter(b => b && !b.gone);
const ou = items => items.filter(i => i.t.startsWith('ou_'));
const menuOf = items => newRush(ou(items).map((i, k) => ({ id: k + 1, t: i.t }))).menu;
/** Floor f of B cleared (the building's own pieces kept), as an owner would before placing. */
const cleared = (B, f) => { const L = w.levels[B.lv[f]]; return { ...L, items: L.items.filter(i => CATALOG[i.t]?.fixed || i.t === 'door'), walls: [], zones: [], mods: undefined }; };

test('the kitchen kind: free, one to a floor, any size from 4.5 x 4 to 16 x 12 m, its stations movable, only where food or drink is served', () => {
  const K = INTERIOR_KINDS.kitchen;
  assert.ok(K, 'registered');
  assert.equal(K.price, 0); assert.equal(K.perFloor, 1); assert.equal(K.who, 'owner');
  assert.equal(K.locked, false, 'its stations move as you like');
  assert.equal(K.joins('ou_oven'), true, 'an appliance placed inside joins it'); assert.equal(K.joins('cafe_table'), false);
  assert.deepEqual([K.size.min, K.size.max, K.size.step, K.size.start], [[4.4, 4], [16, 12], 0.5, [6.5, 4]]);
  assert.deepEqual(KITCHEN_SIZES.map(s => [s.id, s.w, s.d]), [['small', 4.5, 4], ['medium', 6.5, 4], ['large', 8.5, 5], ['xl', 12, 8]]);
  const cafe = live.find(b => b.type === 'cafe'), office = live.find(b => b.type === 'office' && b.floors > 1);
  assert.equal(K.allowed(cafe, 0, w.levels[cafe.lv[0]]), null);
  assert.equal(K.allowed(office, 1, w.levels[office.lv[1]]), KITCHEN_WHY);
  // a request's size goes to the half metre, within the limits
  const r = normalizeModule({ kind: 'kitchen', x0: 0, z0: 0, x1: 6.2, z1: 4.3, face: 0 });
  assert.deepEqual([r.x1 - r.x0, r.z1 - r.z0].map(v => +v.toFixed(2)), [6, 4.5]);
  const t = normalizeModule({ kind: 'kitchen', x0: 0, z0: 0, x1: 30, z1: 2, face: 1 });
  assert.deepEqual([t.x1 - t.x0, t.z1 - t.z0].map(v => +v.toFixed(2)), [16, 4]);
});

test('every size, facing every way, against a wall of an empty restaurant floor: every station within reach, a menu, the pass in front', () => {
  const B = live.filter(b => b.type === 'restaurant' && b.w >= 16 && b.d >= 16).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  assert.ok(B, 'a restaurant big enough');
  const f = B.floors > 1 ? 1 : 0, L = cleared(B, f), ib = interiorBounds(B), bad = [];
  const menus = {};
  for (const S of KITCHEN_SIZES) for (const face of [0, 1, 2, 3]) {
    // its back wall against the building's wall opposite its face, in the middle of that wall
    const w0 = face % 2 ? S.d : S.w, d0 = face % 2 ? S.w : S.d;
    const cx = face === 1 ? ib.x0 + w0 / 2 : face === 3 ? ib.x1 - w0 / 2 : (ib.x0 + ib.x1) / 2;
    const cz = face === 0 ? ib.z0 + d0 / 2 : face === 2 ? ib.z1 - d0 / 2 : (ib.z0 + ib.z1) / 2;
    // (slid along the wall until it is clear of the elevator and the entrance)
    let rec = null, why = 'nowhere';
    for (let k = 0; k < 40 && !rec; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5, sx = face % 2 ? 0 : off, sz = face % 2 ? off : 0;
      const r = { ...normalizeModule({ kind: 'kitchen', x0: cx + sx - w0 / 2, z0: cz + sz - d0 / 2, x1: cx + sx + w0 / 2, z1: cz + sz + d0 / 2, face }), id: 'm1' };
      why = checkModule(B, f, L, r); if (!why) rec = r;
    }
    if (!rec) { bad.push(`${S.id} face ${face}: ${why}`); continue; }
    const got = layModule(B, f, L, rec);
    if (got.why) { bad.push(`${S.id} face ${face}: ${got.why}`); continue; }
    const mine = got.L.items.filter(i => i.mod === 'm1');
    assert.equal(mine.length, ou(mine).length, 'its pieces are its own');
    const reach = kitchenReach(mine);
    if (!reach) { bad.push(`${S.id} face ${face}: no pass`); continue; }
    for (const r of reach) if (!r.ok) bad.push(`${S.id} face ${face}: ${r.t} out of reach`);
    const pass = mine.find(i => i.t === 'ou_pass'), fwd = [Math.sin(pass.r), Math.cos(pass.r)], n = [[0, 1], [1, 0], [0, -1], [-1, 0]][face];
    if (fwd[0] * n[0] + fwd[1] * n[1] < 0.99) bad.push(`${S.id} face ${face}: the pass faces away from the dining room`);
    const out = (pass.x - (rec.x0 + rec.x1) / 2) * n[0] + (pass.z - (rec.z0 + rec.z1) / 2) * n[1];   // (how far towards the face it stands)
    const half = (face % 2 ? rec.x1 - rec.x0 : rec.z1 - rec.z0) / 2;
    if (Math.abs(out - (half - PASS_BAND)) > 0.02) bad.push(`${S.id} face ${face}: the pass is not in the front wall`);
    assert.ok(modsAt(got.L).some(m => m.rec.id === 'm1' && m.kind.kind === 'kitchen'));
    (menus[S.id] ||= new Set()).add(menuOf(mine).join(','));
  }
  assert.deepEqual(bad, []);
  // a bigger kitchen cooks at least as much; the large one the whole café menu
  const size = id => Math.min(...[...menus[id]].map(m => m.split(',').length));
  assert.ok(size('small') >= 2, `small: ${[...menus.small]}`);
  assert.ok(size('medium') >= size('small') && size('large') >= size('medium'), JSON.stringify(Object.fromEntries(Object.entries(menus).map(([k, v]) => [k, [...v]]))));
  assert.equal(size('large'), 5, `large: ${[...menus.large]}`);
  assert.equal(size('xl'), 5, `extra large: ${[...menus.xl]}`);
});

test('a café\'s own kitchen is a module record: its pieces are the kitchen, and laid again it is the same', () => {
  const offices = live.filter(b => (b.type === 'office' || b.type === 'hq') && b.floors >= 3), cafes = live.filter(b => b.type === 'cafe');
  let n = 0; const bad = [];
  for (const [b, f] of [...offices.slice(0, 6).map(b => [b, 1]), ...cafes.slice(0, 6).map(b => [b, 0])]) for (const st of CAFE_STYLE_IDS) {
    const L = freshLevel(b, f, 777, 'cafe', st), k = modsAt(L).filter(m => m.kind.kind === 'kitchen');
    if (!ou(L.items).length) { if (k.length) bad.push(`${b.idx}:${f} ${st}: a record without a kitchen`); continue; }
    n++;
    if (k.length !== 1) { bad.push(`${b.idx}:${f} ${st}: ${k.length} kitchen records`); continue; }
    const rec = k[0].rec, mine = L.items.filter(i => i.mod === rec.id);
    if (mine.length !== ou(L.items).length) bad.push(`${b.idx}:${f} ${st}: ${mine.length} of ${ou(L.items).length} pieces tagged`);
    if (!L.walls.some(x => x[5] === rec.id) || !L.zones.some(z => z[5] === rec.id)) bad.push(`${b.idx}:${f} ${st}: its walls or floor untagged`);
    const again = layModule(b, f, L, rec);
    if (again.why) { bad.push(`${b.idx}:${f} ${st}: ${again.why}`); continue; }
    // (the same pieces in the same places, to the centimetre a module is laid to)
    const was = L.items.filter(i => i.mod === rec.id), now = again.L.items.filter(i => i.mod === rec.id);
    const same = now.length === was.length && was.every(a => now.some(c => c.t === a.t && Math.abs(c.x - a.x) < 0.02 && Math.abs(c.z - a.z) < 0.02 && Math.abs(Math.sin(c.r - a.r)) < 0.01 && Math.cos(c.r - a.r) > 0));
    if (!same) bad.push(`${b.idx}:${f} ${st}: laid again it differs`);
  }
  assert.ok(n >= 20, `${n} kitchens looked at`);
  assert.deepEqual(bad, []);
});

test('a kitchen\'s door and pass face into the room: one facing the building\'s wall, or too close to it, is refused', () => {
  const B = live.filter(b => b.type === 'restaurant' && b.w >= 16 && b.d >= 16)[0], f = B.floors > 1 ? 1 : 0, L = cleared(B, f), ib = interiorBounds(B), S = KITCHEN_SIZES[1];
  const at = (face, x0, z0) => ({ ...normalizeModule({ kind: 'kitchen', x0, z0, x1: x0 + (face % 2 ? S.d : S.w), z1: z0 + (face % 2 ? S.w : S.d), face }), id: 'm1' });
  const cx = (ib.x0 + ib.x1) / 2 - S.w / 2;
  // against the back wall: facing into the room is fine, facing the back wall is not
  const ok = at(0, cx, ib.z0), back = at(2, cx, ib.z0);
  assert.equal(INTERIOR_KINDS.kitchen.check(B, f, L, ok), null);
  assert.match(INTERIOR_KINDS.kitchen.check(B, f, L, back) || '', /face the building's wall/);
  assert.match(checkModule(B, f, L, back) || '', /face the building's wall/, 'the same in the ghost and on the server');
  // a hand's breadth from the side wall, facing it: no room to stand at the pass
  const side = at(1, ib.x1 - S.d - 0.3, (ib.z0 + ib.z1) / 2 - S.w / 2);
  assert.match(INTERIOR_KINDS.kitchen.check(B, f, L, side) || '', /face the building's wall/);
});


test('a café\'s own kitchen keeps its size when renamed or turned in place (not snapped to Small, Medium or Large)', () => {
  const b = live.filter(x => (x.type === 'office' || x.type === 'hq') && x.floors >= 3)[1], L = freshLevel(b, 1, 777, 'cafe', 'bistro');
  const prev = modsAt(L).find(m => m.kind.kind === 'kitchen').rec;
  const named = normalizeModule({ name: 'The Bistro Kitchen' }, prev);
  assert.deepEqual([named.x0, named.z0, named.x1, named.z1], [prev.x0, prev.z0, prev.x1, prev.z1].map(v => Math.round(v * 100) / 100));
  assert.equal(checkModule(b, 1, L, { ...named, id: prev.id }, prev.id), null, 'nothing in its way: it is where it was');
  assert.equal(named.name, 'The Bistro Kitchen');
});

test('a kitchen\'s stations follow its menu: what it needs, more of the most needed, the rest left out', async () => {
  const { kitchenLayout, kitchenNeeds, placeMenu } = await import('../shared/kitchen-module.js');
  const { DRINKS } = await import('../shared/nightlife.js');
  const B = live.filter(b => b.type === 'restaurant' && b.w >= 16 && b.d >= 16)[0], f = B.floors > 1 ? 1 : 0, ib = interiorBounds(B);
  const lay = (ids, w, d) => {
    const rec = { id: 'm1', kind: 'kitchen', x0: (ib.x0 + ib.x1) / 2 - w / 2, z0: ib.z0, x1: (ib.x0 + ib.x1) / 2 + w / 2, z1: ib.z0 + d, face: 0, data: { needs: kitchenNeeds(ids) } };
    const c = {}; for (const it of kitchenLayout(B, rec).items) c[it.t] = (c[it.t] || 0) + 1; return c;
  };
  const coffee = lay(['espresso', 'latte'], 6.5, 4);
  for (const t of ['ou_espresso', 'ou_grinder', 'ou_steamer', 'ou_fridge', 'ou_plating', 'ou_pass']) assert.ok(coffee[t], `espresso and latte: ${t}`);
  for (const t of ['ou_oven', 'ou_pantry', 'ou_press', 'ou_blender']) assert.ok(!coffee[t], `espresso and latte: no ${t}`);
  const more = lay(['espresso', 'latte', 'croissant', 'muffin'], 6.5, 4);
  assert.ok(more.ou_oven && more.ou_pantry, 'pastries bring the oven and the pantry');
  const big = lay(['espresso', 'latte', 'cappuccino', 'flat_white', 'macchiato', 'mocha', 'coffee', 'croissant'], 12, 8);
  assert.ok(big.ou_espresso > big.ou_oven, `a coffee bar's big kitchen: more espresso machines than ovens (${big.ou_espresso} / ${big.ou_oven})`);
  assert.ok(big.ou_fridge <= 2, `storage: few more fridges (${big.ou_fridge})`);
  // what a place sells as it comes
  const cafeL = freshLevel(live.find(b => b.type === 'cafe'), 0, 5);
  assert.deepEqual(placeMenu({ ...cafeL, name: 'Corner Café', venue: 'cafe' }), CUISINE_OF_CAFE());
  assert.deepEqual(placeMenu({ items: [], theme: 'lounge' }), [...DRINKS.lounge_bar]);
  assert.equal(placeMenu({ items: [], venue: 'gym' }), null);
});

test('one more appliance fits among a kitchen\'s pieces where there is room ("Add to the kitchen")', () => {
  const B = live.filter(b => b.type === 'restaurant' && b.w >= 16 && b.d >= 16)[0], f = B.floors > 1 ? 1 : 0, L = cleared(B, f), ib = interiorBounds(B);
  const rec = { ...normalizeModule({ kind: 'kitchen', x0: (ib.x0 + ib.x1) / 2 - 4.25, z0: ib.z0, x1: (ib.x0 + ib.x1) / 2 + 4.25, z1: ib.z0 + 5, face: 0, data: { needs: { espresso: 2, grinder: 2, fridge: 2 } } }), id: 'm1' };
  const got = layModule(B, f, L, rec).L;
  const at = INTERIOR_KINDS.kitchen.fit(B, f, got, rec, 'ou_blender');
  assert.ok(at, 'a place for a blender');
  assert.equal(checkItem(B, f, got, { ...at, t: 'ou_blender' }), null, 'clear of everything there');
  assert.ok(at.x > rec.x0 && at.x < rec.x1 && at.z > rec.z0 && at.z < rec.z1, 'inside the kitchen');
});
