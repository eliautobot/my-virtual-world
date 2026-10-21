// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Cafés' and restaurants' kinds and menus over HTTP (server/economy/businesses.js, shared/food.js): every one has a kind
// of place and a menu of pack items; its owner (the city's: an administrator) changes the kind (its usual menu comes
// with it), adds or removes any item, prices one in the same change; bad menus are refused; nobody else may change
// them; prices of items taken off are forgotten; shops keep their own lists; and the simulation orders from the new menu.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { CUISINE_OF, FOOD_BY_ID, MENU_MAX, FOOD } from '../shared/food.js';
import { Households } from '../server/economy/households.js';

let s, owner, ann;
before(async () => {
  s = await startServer({ population: 260, agents: 0 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
});
after(async () => { await s?.stop(); });
const list = async () => (await owner.get('/api/economy/businesses')).json.businesses;

test('every café and restaurant has a kind of place and a menu of pack items at prices; shops keep theirs', async () => {
  const all = await list();
  const food = all.filter(b => b.kind === 'cafe' || b.kind === 'restaurant');
  assert.ok(food.length > 3);
  for (const b of food) {
    assert.ok(CUISINE_OF[b.cuisine], `${b.name}: ${b.cuisine}`);
    assert.ok(b.menu.length >= 10 && b.menu.every(m => FOOD_BY_ID[m.id] && m.n === FOOD_BY_ID[m.id].n && m.price > 0 && m.course));
  }
  const shop = all.find(b => b.kind === 'shop');
  if (shop) { assert.equal(shop.cuisine, undefined); assert.ok(shop.menu.some(m => m.id === 'groceries')); }
});

test('the owner changes the kind (its usual menu comes), adds any item with its price; bad menus and strangers are refused', async () => {
  const R = (await list()).find(b => b.kind === 'restaurant' && b.cuisine !== 'japanese');
  const cfg = (who, body) => who.post('/api/economy/business/configure', { id: R.id, ...body });
  // somebody who doesn't run it
  assert.equal((await cfg(ann, { cuisine: 'japanese' })).status, 403);
  // a new kind: its usual menu
  let r = await cfg(owner, { cuisine: 'japanese' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.business.cuisine, 'japanese');
  assert.deepEqual(r.json.business.menu.map(m => m.id), CUISINE_OF.japanese.menu);
  assert.equal(r.json.business.ownMenu, false);
  // a pizza at a sushi bar, priced in the same change
  r = await cfg(owner, { menu: [...CUISINE_OF.japanese.menu, 'pepperoni'], prices: { pepperoni: 1700, ramen: 1500 } });
  assert.equal(r.status, 200, r.text);
  const pep = r.json.business.menu.find(m => m.id === 'pepperoni');
  assert.equal(pep.price, 1700); assert.equal(r.json.business.menu.find(m => m.id === 'ramen').price, 1500);
  assert.equal(r.json.business.ownMenu, true);
  // refused: unknown, repeated, empty, too long, a kind that doesn't exist, a price out of bounds
  for (const bad of [{ menu: ['ramen', 'not_food'] }, { menu: ['ramen', 'ramen'] }, { menu: [] }, { menu: FOOD.slice(0, MENU_MAX + 1).map(i => i.id) }, { cuisine: 'moon' }, { menu: ['ramen'], prices: { ramen: 1 } }]) {
    const x = await cfg(owner, bad);
    assert.equal(x.status, 400, JSON.stringify(bad));
  }
  // taking the pizza off forgets its price; back to the usual list is the kind's own menu again
  r = await cfg(owner, { menu: CUISINE_OF.japanese.menu });
  assert.equal(r.status, 200);
  assert.equal(r.json.business.ownMenu, false);
  assert.equal(r.json.business.settings.prices.pepperoni, undefined);
  assert.equal(r.json.business.settings.prices.ramen, 1500, 'a price of an item still sold is kept');
  // a shop has no menu to change
  const shop = (await list()).find(b => b.kind === 'shop');
  if (shop) assert.equal((await owner.post('/api/economy/business/configure', { id: shop.id, cuisine: 'pizza' })).status, 400);
  // the owner's view carries the city's food prices for the editor; others don't see settings
  const v = (await owner.get(`/api/economy/business/${R.id}`)).json;
  assert.equal(v.business.foodPricing.pct, 100);
  assert.equal((await ann.get(`/api/economy/business/${R.id}`)).json.business.foodPricing, undefined);
});

test('administrators set the city\'s food prices (a percentage, or one item); a price for an unknown item is refused', async () => {
  let r = await owner.post('/api/economy/admin/policy', { policy: { food: { pricePct: 120, prices: { latte: 600 } } } });
  assert.equal(r.status, 200, r.text);
  const cafe = (await list()).find(b => b.kind === 'cafe' && b.menu.some(m => m.id === 'latte') && b.menu.some(m => m.id === 'espresso'));
  assert.equal(cafe.menu.find(m => m.id === 'latte').base, 600);
  assert.equal(cafe.menu.find(m => m.id === 'espresso').base, 360, '300 × 120%');
  assert.equal((await owner.post('/api/economy/admin/policy', { policy: { food: { prices: { moon_pie: 100 } } } })).status, 400);
  assert.equal((await owner.post('/api/economy/admin/policy', { policy: { food: { pricePct: 100, prices: { latte: null } } } })).status, 200);
});

test('the simulation orders from a place\'s own menu and bills what it showed', () => {
  // (in process: a resident at a venue whose menu is the economy's)
  const H = Object.create(Households.prototype);
  const biz = { id: 'biz_x', kind: 'restaurant' };
  H.e = { parts: { businesses: { at: () => biz, menuIdsOf: () => ['margherita', 'cola'] } } };
  assert.deepEqual(H.menuAt(1, 0), ['margherita', 'cola']);
  assert.deepEqual(H.basket('p1', 100, 'restaurant', { order: ['margherita', 'cola'], kind: 'meal', use: 'eat' }), ['margherita', 'cola'], 'the bill is the order shown');
  assert.deepEqual(H.basket('p1', 100, 'shop', { kind: 'shop', use: 'buy' }).length, 1, 'shops keep their own baskets');
});
