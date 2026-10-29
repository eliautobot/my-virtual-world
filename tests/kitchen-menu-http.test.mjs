// A kitchen follows its place's menu (shared/kitchen-module.js prepare; server/economy/businesses.js kitchensFollow; the
// product owner 2026-10-28: "yes if they havent been rearranged, then they should automatically re-lay/adjust the layout"
// and "to add fries to the menu, you will need a fryer ... they can either manually add a fryer ... or the fryer gets
// automatically added"), over HTTP: a café's menu changed, its kitchen is laid out again with what the menu needs; one
// arranged by hand stays as it is; "Add to the kitchen" (imod.piece) puts an appliance where there is room. Either way the
// kitchen's record says what its place sells (rec.data.menu): its Rushes order only that (shared/orderup/rules.js).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, tempDir } from './helpers/server.mjs';

let s, owner;
const edit = ops => owner.post('/api/edit', { ops });
const world = async () => (await owner.get('/api/world')).json.world;
before(async () => {
  s = await startServer({ data: tempDir('mvw-kmenu-'), population: 80 });
  owner = await ownerSession(s);
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
});
after(() => s?.stop());

test('a café\'s kitchen follows its menu, unless arranged by hand; an appliance is added where there is room', async () => {
  let W = await world();
  const kitchenOf = (W, b, f) => { const L = W.levels[W.buildings[b].lv[f]], m = (L.mods || []).find(x => x.kind === 'kitchen'); return m ? { m, items: L.items.filter(i => i.mod === m.id) } : null; };
  const biz = (await owner.get('/api/economy/businesses')).json.businesses.filter(x => x.kind === 'cafe' && kitchenOf(W, x.b, x.f));
  assert.ok(biz.length, 'a café with a kitchen');
  const B = biz.sort((a, b) => kitchenOf(W, b.b, b.f).items.length - kitchenOf(W, a.b, a.f).items.length)[0];
  const cfg = menu => owner.post('/api/economy/business/configure', { id: B.id, menu });
  const has = (k, t) => k.items.some(i => i.t === t);

  // espresso and latte only: the kitchen laid out again for them, no oven
  let r = await cfg(['espresso', 'latte']);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  W = await world(); let k = kitchenOf(W, B.b, B.f);
  assert.ok(has(k, 'ou_espresso') && has(k, 'ou_steamer') && !has(k, 'ou_oven') && !has(k, 'ou_pantry'), `espresso and latte: ${k.items.map(i => i.t).join(' ')}`);
  assert.deepEqual(Object.keys(k.m.data.needs).sort(), ['espresso', 'fridge', 'grinder', 'steamer']);
  assert.deepEqual(k.m.data.menu, ['espresso', 'latte'], 'what its Rushes order');
  assert.ok(!k.m.custom);

  // croissants on it too: an oven and a pantry come
  r = await cfg(['espresso', 'latte', 'croissant']);
  assert.equal(r.status, 200);
  W = await world(); k = kitchenOf(W, B.b, B.f);
  assert.ok(has(k, 'ou_oven') && has(k, 'ou_pantry'), 'pastries bring the oven and the pantry');

  // arranged by hand: a menu change leaves it as it is
  let moved = false;
  for (const it of k.items.filter(i => !['ou_pass', 'ou_rail', 'ou_extinguisher'].includes(i.t))) {
    for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) if ((await edit([{ op: 'item.move', b: B.b, f: B.f, id: it.id, x: it.x + dx, z: it.z + dz, r: it.r }])).status === 200) { moved = true; break; }
    if (moved) break;
  }
  assert.ok(moved, 'a station moved by hand');
  const before = (await world()); const was = kitchenOf(before, B.b, B.f).items.map(i => `${i.t}@${i.x},${i.z}`).sort();
  assert.equal((await cfg(['espresso'])).status, 200);
  W = await world(); k = kitchenOf(W, B.b, B.f);
  assert.deepEqual(k.items.map(i => `${i.t}@${i.x},${i.z}`).sort(), was, 'its arrangement stays');
  assert.ok(has(k, 'ou_oven'), 'nothing taken away');
  assert.ok(k.m.custom, 'still arranged by hand');
  assert.deepEqual(k.m.data.menu, ['espresso'], 'its Rushes follow the new menu all the same');
  assert.deepEqual(Object.keys(k.m.data.needs).sort(), ['espresso', 'grinder']);

  // "Add to the kitchen": a blender where there is room (making room first when there is none)
  r = await edit([{ op: 'imod.piece', b: B.b, f: B.f, id: k.m.id, t: 'ou_blender' }]);
  if (r.status !== 200) {
    assert.match(r.json.error, /no room/);
    const oven = k.items.find(i => i.t === 'ou_oven');
    assert.equal((await edit([{ op: 'item.del', b: B.b, f: B.f, id: oven.id }])).status, 200);
    r = await edit([{ op: 'imod.piece', b: B.b, f: B.f, id: k.m.id, t: 'ou_blender' }]);
  }
  assert.equal(r.status, 200, JSON.stringify(r.json));
  W = await world(); k = kitchenOf(W, B.b, B.f);
  assert.ok(k.items.some(i => i.t === 'ou_blender' && i.mod === k.m.id), 'the blender is the kitchen\'s');
  assert.ok(k.m.custom, 'arranged by hand');
  // not a piece a kitchen takes
  r = await edit([{ op: 'imod.piece', b: B.b, f: B.f, id: k.m.id, t: 'cafe_table' }]);
  assert.equal(r.status, 400);
});

test('a café laid with the world says what it sells: its kitchen\'s Rush orders from it', async () => {
  const W = await world();
  const recs = W.buildings.filter(b => b && !b.gone && b.type === 'cafe').flatMap(B => (W.levels[B.lv[0]]?.mods || []).filter(m => m.kind === 'kitchen'));
  assert.ok(recs.length >= 3, `${recs.length} café kitchens`);
  for (const m of recs) assert.ok(Array.isArray(m.data.menu) && m.data.menu.length, `${m.id}: its menu`);
  const { KITCHENS } = await import('../shared/orderup/kitchens.js'), { newRush } = await import('../shared/orderup/rules.js');
  // a café's usual menu (shared/food.js): its Rush orders only those of it it has stations for (no smoothie it doesn't sell)
  const m = recs.sort((a, b) => b.data.menu.length - a.data.menu.length)[0], S = newRush(Object.keys(KITCHENS.coffee.stations).map((t, i) => ({ id: i + 1, t })), { menu: m.data.menu });
  assert.ok(S.menu.length >= 3 && S.menu.every(d => (KITCHENS.coffee.dishes[d].items || [d]).some(i => m.data.menu.includes(i))), `${S.menu.join(' ')} of ${m.data.menu.join(' ')}`);
});
