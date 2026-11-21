// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an AI agent buys to take home is in its bag (server/economy/households.js stow, cookFromBag; 2026-11-17, the
// product owner: "idk if he actually grabbed them"): groceries or a shopping bag bought at a shop's checkout go into its
// inventory once a purchase (planned again or replayed: still once), what it eats or drinks at a café does not, a meal at
// home is cooked from its groceries (one bag used, not bought again by the day's settlement), and residents are as before
// — their purchases sums of the day, no inventory. An errand of its plans buys what it came for (act.buy).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { economyModel } from '../helpers/econ-model.mjs';
import { Inventory } from '../../server/economy/inventory.js';
import { WorldIndex } from '../../server/sim/windex.js';
import { subj } from '../../server/economy/economy.js';
import { takeHomeItem, takeHomeNamed } from '../../shared/items.js';

function setup() {
  const recs = [{ id: 7, key: 'th-agent', name: 'Sam', ownerId: 1, enabled: true }];
  const agents = { byKey: k => recs.find(r => r.key === k) || null, get: id => recs.find(r => r.id === Number(id)) || null, byId: id => recs.find(r => r.id === Number(id)) || null, enabled: () => recs };
  const m = economyModel({ population: 300, seed: 'take-home', agents });
  const e = m.econ, H = e.parts.households, inv = e.parts.inventory = new Inventory(e);
  e.parts.businesses.sync();
  const homed = m.people.filter(x => x && !x.retired && !x.vip && x.home);
  const p = homed[0], r = homed[1];
  p.vip = 1; p.agentId = 'th-agent';
  const me = subj('agent', 7), w = e.walletFor(me, 'main');
  if (w.balance < 20000) e.ledger.transfer(e.treasury().id, w.id, 20000, { actor: 'system:test', force: true });
  const index = new WorldIndex(m.world), shop = index.venues.shop[0], cafe = index.venues.cafe[0];
  const at = (q, act) => H.onAct({ i: m.people.indexOf(q), p: q }, act);
  const visit = (q, t, extra = {}) => at(q, { kind: 'shop', use: 'buy', b: shop.b, f: shop.f, holdStart: t, holdEnd: t + 0.01, ...extra });
  const homeMeal = (q, t) => at(q, { kind: 'meal', use: 'eat', b: q.home.b, f: q.home.f, holdStart: t, holdEnd: t + 0.02 });
  const bag = item => inv.has(me, item);
  return { m, e, H, inv, p, r, me, shop, cafe, at, visit, homeMeal, bag, close: () => m.close() };
}

test('the shops\' lines to take home are items; what is had on the spot is not', () => {
  assert.equal(takeHomeItem('groceries'), 'goods:groceries');
  assert.equal(takeHomeItem('goods'), 'goods:bag');
  for (const x of ['coffee', 'meal', 'session', 'cover']) assert.equal(takeHomeItem(x), null, x);
  assert.deepEqual(takeHomeNamed('Groceries at Store 21 after work'), ['groceries']);
  assert.deepEqual(takeHomeNamed('Pick up a shopping bag of things'), ['goods']);
  assert.deepEqual(takeHomeNamed('Text Pema about sushi'), []);
});

test('an AI agent\'s groceries go into its bag once a purchase; a café\'s coffee does not; a resident\'s purchase stays a sum', () => {
  const c = setup();
  try {
    const { H, p, r, visit, bag } = c;
    visit(p, 0.3, { buy: ['groceries'] });
    assert.equal(H.receipts.get(p.id)?.length, 1, 'a sale');
    assert.equal(bag('goods:groceries'), 1, 'its groceries are in its bag');
    const row = c.e.db.prepare("SELECT kind, src, dst, memo, value FROM inv_moves WHERE item = 'goods:groceries'").get();
    assert.deepEqual({ ...row }, { kind: 'buy', src: null, dst: 'agent:7', memo: c.e.parts.businesses.at(c.shop.b, c.shop.f).name, value: 500 });
    // the same visit planned again (a re-plan): one purchase a visit — and replayed with the economy's memory gone (a
    // restart): bought again by the books as before, in its bag still once
    visit(p, 0.3, { buy: ['groceries'] });
    assert.equal(H.receipts.get(p.id).length, 1);
    H.lastBuy.delete(p.id);
    visit(p, 0.3, { buy: ['groceries'] });
    assert.equal(bag('goods:groceries'), 1, 'never twice for one visit');
    // another visit: another bag; a shopping bag is a shopping bag
    H.lastBuy.delete(p.id);
    visit(p, 0.6, { buy: ['groceries'] });
    assert.equal(bag('goods:groceries'), 2);
    H.lastBuy.delete(p.id);
    visit(p, 0.7, { buy: ['goods'] });
    assert.equal(bag('goods:bag'), 1);
    // a coffee at a café is had there
    const before = c.inv.list(c.me).length;
    c.at(p, { kind: 'visit', use: 'cafe', b: c.cafe.b, f: c.cafe.f, holdStart: 0.8, holdEnd: 0.81, order: ['coffee'] });
    assert.ok(H.receipts.get(p.id).some(x => x.kind === 'cafe'), 'it paid for its coffee');
    assert.equal(c.inv.list(c.me).length, before, 'nothing to carry home');
    // a resident: the sale as ever, no inventory
    visit(r, 0.3, { buy: ['groceries'] });
    assert.equal(H.receipts.get(r.id)?.length, 1);
    assert.equal(c.e.db.prepare("SELECT COUNT(*) AS n FROM inv_items WHERE owner NOT LIKE 'agent:%'").get().n, 0, 'no resident has an inventory');
  } finally { c.close(); }
});

test('an errand buys what it came for; a plain visit to the checkout draws as before', () => {
  const c = setup();
  try {
    const { H, p } = c, act = { kind: 'shop', use: 'buy' };
    assert.deepEqual(H.basket(p.id, 0.3, 'shop', { ...act, buy: ['groceries'] }), ['groceries']);
    const plain = H.basket(p.id, 0.3, 'shop', act);
    assert.equal(plain.length, 1);
    assert.ok(['groceries', 'goods'].includes(plain[0]));
    assert.deepEqual(H.basket(p.id, 0.3, 'shop', { kind: 'shop', use: 'browse', buy: ['groceries'] }), [], 'browsing buys nothing');
  } finally { c.close(); }
});

test('a meal at home is cooked from its groceries: one bag a meal, not bought again by the settlement; without any, as before', () => {
  const c = setup();
  try {
    const { H, p, r, visit, homeMeal, bag } = c;
    visit(p, 0.2, { buy: ['groceries'] }); H.lastBuy.delete(p.id); visit(p, 0.25, { buy: ['groceries'] });
    assert.equal(bag('goods:groceries'), 2);
    homeMeal(p, 0.5);
    assert.equal(bag('goods:groceries'), 1, 'one bag used');
    assert.equal(H.days.get(0)?.res.get(p.id)?.hm || 0, 0, 'that meal is paid for already');
    homeMeal(p, 0.5);
    assert.equal(bag('goods:groceries'), 1, 'the same meal again uses nothing more');
    homeMeal(p, 0.6);
    assert.equal(bag('goods:groceries'), 0);
    homeMeal(p, 0.7);
    assert.equal(H.days.get(0).res.get(p.id).hm, 1, 'none left: the settlement\'s groceries, as before');
    const used = c.e.db.prepare("SELECT kind, src, qty FROM inv_moves WHERE kind = 'use'").all().map(x => ({ ...x }));
    assert.deepEqual(used, [{ kind: 'use', src: 'agent:7', qty: 1 }, { kind: 'use', src: 'agent:7', qty: 1 }]);
    homeMeal(r, 0.5);
    assert.equal(H.days.get(0).res.get(r.id).hm, 1, 'a resident\'s meal at home: groceries at the settlement');
    // the day settles: its two bags from the shop, and groceries for the one meal it had none for (one bag makes
    // mealsPerBag meals) — not for the two it cooked from its bag (four meals would have been two bags)
    const bz = c.e.parts.businesses, plan = H.plan(0), wAgent = c.e.walletFor(c.me, 'main').id;
    const bought = bz.priceOf(bz.at(c.shop.b, c.shop.f), 'groceries'), near = bz.priceOf(H._shopFinder(c.m.world)(p.home.b), 'groceries');
    assert.equal(c.e.policy().households.mealsPerBag, 2);
    assert.equal(-(plan.wallets.get(wAgent)?.parts?.get('spent') || 0), bought * 2 + near * 1);
  } finally { c.close(); }
});
