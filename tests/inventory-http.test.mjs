// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The inventory over HTTP (server/economy/inventory.js, docs/features/INVENTORY.md): an administrator's grant (a plain
// stack, a one-of-a-kind fish), giving to another player (part of a stack, a fish with its length and weight intact),
// what can't be given (more than you have, someone else's, to yourself), a new account's daily cap, a repeat that
// doesn't give twice, throwing away, the history, and the shared list's categories and sorting.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { itemOf, sortStacks, ITEM_CATS, allItems, WELCOME_KIT } from '../shared/items.js';

let s, owner, ann, bob, ids;
before(async () => {
  s = await startServer({ population: 40 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob' });
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  ids = { ann: ann.id, bob: bob.id };
});
after(async () => { await s?.stop(); });

test('the shared list: every item in a category, worth something or nothing, and sorting by what matters', () => {
  const cats = new Set(ITEM_CATS.map(c => c.id));
  assert.ok(allItems().length > 300 && allItems().every(i => cats.has(i.cat)), `${allItems().length} items, each in a category`);
  assert.ok(itemOf('fish:redsnapper') && itemOf('fish:redsnapper').unique, 'a fish is one of a kind');
  assert.ok(itemOf('lure:dough') && !itemOf('lure:dough').unique, 'lures stack');
  const st = [{ item: 'lure:worm', qty: 30, got: 3 }, { item: 'fish:redsnapper', qty: 1, attrs: { vc: 5000 }, got: 1 }, { item: 'goods:gift', qty: 1, got: 2 }];
  assert.deepEqual(sortStacks(st, 'value').map(x => x.item), ['fish:redsnapper', 'goods:gift', 'lure:worm']);
  assert.deepEqual(sortStacks(st, 'qty')[0].item, 'lure:worm');
  assert.deepEqual(sortStacks(st, 'newest')[0].item, 'lure:worm');
  assert.deepEqual(sortStacks(st, 'name').map(x => itemOf(x.item).name), ['Gift box', 'Nightcrawlers', 'Red Snapper'].sort((a, b) => a.localeCompare(b)));
});

test('a grant, giving part of a stack and a fish, what can\'t be given, a repeat, throwing away, the history', async () => {
  assert.ok(ids.ann && ids.bob, `accounts: ${JSON.stringify(ids)}`);
  // only an administrator grants
  assert.equal((await bob.post('/api/inventory/grant', { to: { kind: 'account', id: ids.ann }, item: 'lure:dough', qty: 3 })).status, 403);
  assert.equal((await owner.post('/api/inventory/grant', { to: { kind: 'account', id: ids.ann }, item: 'lure:dough', qty: 5 })).status, 200);
  assert.equal((await owner.post('/api/inventory/grant', { to: { kind: 'account', id: ids.ann }, item: 'fish:redsnapper', qty: 1, attrs: { cm: 52, kg: 2.1, vc: 900 } })).status, 200);
  assert.equal((await owner.post('/api/inventory/grant', { to: { kind: 'account', id: ids.ann }, item: 'lure:dough', qty: 2 })).status, 200);
  let inv = (await ann.get('/api/inventory')).json;
  const shrimp = inv.stacks.find(x => x.item === 'lure:dough'), fish = inv.stacks.find(x => x.item === 'fish:redsnapper');
  assert.equal(shrimp.qty, 7, 'a plain stack grows'); assert.equal(inv.stacks.filter(x => x.item === 'lure:dough').length, 1, 'one row for it');
  assert.deepEqual([fish.qty, fish.attrs.cm, fish.attrs.kg], [1, 52, 2.1]);
  assert.ok(inv.welcome === true && inv.stacks.some(x => x.item === 'gear:rod_starter'), 'her first look: the welcome kit');
  assert.ok(inv.value >= 900 && inv.max >= 100 && inv.used >= 2);
  assert.equal((await ann.get('/api/inventory')).json.welcome, false, 'only once');
  // giving: part of a stack; the fish, intact
  const g1 = await ann.post('/api/inventory/give', { stack: shrimp.id, qty: 3, to: { kind: 'account', id: ids.bob }, idem: 'x1' });
  assert.equal(g1.status, 200, JSON.stringify(g1.json));
  const again = await ann.post('/api/inventory/give', { stack: shrimp.id, qty: 3, to: { kind: 'account', id: ids.bob }, idem: 'x1' });
  assert.equal(again.status, 200); assert.ok(again.json.dup, 'the same request again: nothing more given');
  assert.equal((await ann.post('/api/inventory/give', { stack: fish.id, to: { kind: 'account', id: ids.bob } })).status, 200);
  inv = (await ann.get('/api/inventory')).json;
  assert.equal(inv.stacks.find(x => x.item === 'lure:dough').qty, 4); assert.ok(!inv.stacks.some(x => x.item === 'fish:redsnapper'));
  const bb = (await bob.get('/api/inventory')).json, bf = bb.stacks.find(x => x.item === 'fish:redsnapper');
  assert.equal(bb.stacks.find(x => x.item === 'lure:dough').qty, 3); assert.ok(bf && bf.attrs.cm === 52 && bf.attrs.vc === 900, 'the fish keeps its length, weight and price');
  // what can't be given
  const sid = inv.stacks.find(x => x.item === 'lure:dough').id;
  assert.equal((await ann.post('/api/inventory/give', { stack: sid, qty: 9, to: { kind: 'account', id: ids.bob } })).status, 409, 'more than she has');
  assert.equal((await bob.post('/api/inventory/give', { stack: sid, qty: 1, to: { kind: 'account', id: ids.ann } })).status, 404, 'someone else\'s');
  assert.equal((await ann.post('/api/inventory/give', { stack: sid, qty: 1, to: { kind: 'account', id: ids.ann } })).status, 400, 'to herself');
  assert.equal((await ann.post('/api/inventory/give', { stack: sid, qty: 1, to: { kind: 'account', id: 999999 } })).status, 404, 'nobody');
  // throwing away; the history
  assert.equal((await ann.post('/api/inventory/discard', { stack: sid, qty: 4 })).status, 200);
  inv = (await ann.get('/api/inventory?history=1')).json;
  assert.ok(!inv.stacks.some(x => x.item === 'lure:dough' || x.item === 'fish:redsnapper'), 'all gone');
  assert.ok(inv.history.some(h => h.kind === 'give' && h.dir === 'out' && h.with === 'Bob') && inv.history.some(h => h.kind === 'grant' && h.dir === 'in') && inv.history.some(h => h.kind === 'discard'), `her history: ${inv.history.map(h => h.kind).join(', ')}`);
});

test('a new account gives at most its daily amount (by what the things are worth)', async () => {
  // gifts worth 15 VC each: a new account may give 100 VC a day (the policy's newAccountSendPerDay)
  assert.equal((await owner.post('/api/inventory/grant', { to: { kind: 'account', id: ids.bob }, item: 'goods:gift', qty: 9 })).status, 200);
  const gift = (await bob.get('/api/inventory')).json.stacks.find(x => x.item === 'goods:gift');
  assert.equal((await bob.post('/api/inventory/give', { stack: gift.id, qty: 6, to: { kind: 'account', id: ids.ann } })).status, 200, '90 VC: fine');
  const over = await bob.post('/api/inventory/give', { stack: gift.id, qty: 1, to: { kind: 'account', id: ids.ann } });
  assert.equal(over.status, 429, 'past 100 VC today: refused'); assert.match(over.json.error, /New accounts/);
});

test('the welcome kit: a player\'s first look at the inventory, and an agent\'s, once each', async () => {
  const kim = await userSession(s, owner, { login: 'kim', displayName: 'Kim' });
  const first = (await kim.get('/api/inventory')).json;
  assert.equal(first.welcome, true);
  for (const [item, qty] of WELCOME_KIT.account) assert.equal(first.stacks.find(x => x.item === item)?.qty, qty, `${item} × ${qty}`);
  const again = (await kim.get('/api/inventory')).json;
  assert.equal(again.welcome, false); assert.equal(again.stacks.length, first.stacks.length, 'nothing more');
});

test('a trade: both sides put things and coin in, a change takes back the acceptance, both accept — it all swaps at once', async () => {
  const tia = await userSession(s, owner, { login: 'tia', displayName: 'Tia' }), udo = await userSession(s, owner, { login: 'udo', displayName: 'Udo' });
  const ti = (await tia.get('/api/inventory')).json, ud = (await udo.get('/api/inventory')).json;   // (their welcome kits)
  const tShrimp = ti.stacks.find(x => x.item === 'lure:shrimp'), uGift = ud.stacks.find(x => x.item === 'goods:gift'), uCoffee = ud.stacks.find(x => x.item === 'food:coffee');
  const tVc0 = (await tia.get('/api/economy/me')).json.wallet.balance, uVc0 = (await udo.get('/api/economy/me')).json.wallet.balance;
  // Tia opens it (by name), puts 4 shrimp and 2 VC in; Udo his gift box
  const op = await tia.post('/api/inventory/trade/open', { to: 'Udo', memo: 'Bait for your gift?' });
  assert.equal(op.status, 200, JSON.stringify(op.json));
  const id = op.json.id;
  assert.equal((await tia.post('/api/inventory/trade/open', { to: { kind: 'account', id: udo.id } })).json.id, id, 'one open trade between two');
  assert.equal((await tia.post('/api/inventory/trade/offer', { trade: id, items: [{ stack: tShrimp.id, qty: 4 }], vc: 200 })).status, 200);
  assert.equal((await udo.post('/api/inventory/trade/offer', { trade: id, items: [{ stack: uGift.id, qty: 1 }] })).status, 200);
  assert.equal((await tia.post('/api/inventory/trade/offer', { trade: id, items: [{ stack: tShrimp.id, qty: 99 }] })).status, 409, 'more than she has');
  assert.equal((await tia.post('/api/inventory/trade/offer', { trade: id, items: [{ stack: tShrimp.id, qty: 4 }], vc: 200 })).status, 200);
  let v = (await tia.post('/api/inventory/trade/accept', { trade: id })).json;
  assert.ok(v.myOk && !v.theirOk && v.status === 'open');
  // Udo adds a coffee: Tia's acceptance is taken back; she sees the new offer and accepts again
  v = (await udo.post('/api/inventory/trade/offer', { trade: id, items: [{ stack: uGift.id, qty: 1 }, { stack: uCoffee.id, qty: 1 }] })).json;
  assert.ok(!v.myOk && !v.theirOk, 'a change: nobody\'s acceptance stands');
  const seen = (await tia.get('/api/inventory/trades')).json.trades.find(x => x.id === id);
  assert.deepEqual(seen.them.items.map(l => l.item).sort(), ['food:coffee', 'goods:gift']); assert.equal(seen.me.vc, 200);
  assert.equal((await tia.post('/api/inventory/trade/accept', { trade: id })).status, 200);
  const done = (await udo.post('/api/inventory/trade/accept', { trade: id })).json;
  assert.equal(done.status, 'done', JSON.stringify(done));
  // it all moved, both ways
  const ti2 = (await tia.get('/api/inventory')).json, ud2 = (await udo.get('/api/inventory')).json;
  assert.equal(ti2.stacks.find(x => x.item === 'lure:shrimp').qty, tShrimp.qty - 4);
  assert.ok(ti2.stacks.some(x => x.item === 'goods:gift') && ti2.stacks.find(x => x.item === 'food:coffee').qty === 2, 'Tia: the gift and a second coffee');
  assert.equal(ud2.stacks.find(x => x.item === 'lure:shrimp').qty, 14, 'Udo: his 10 and her 4');
  assert.equal((await tia.get('/api/economy/me')).json.wallet.balance, tVc0 - 200); assert.equal((await udo.get('/api/economy/me')).json.wallet.balance, uVc0 + 200);
  assert.equal((await tia.post('/api/inventory/trade/accept', { trade: id })).status, 409, 'done: nothing more');
});

test('a trade that can\'t go through stays open (something moved since); declining; someone else\'s trade', async () => {
  const vic = await userSession(s, owner, { login: 'vic', displayName: 'Vic' }), wes = await userSession(s, owner, { login: 'wes', displayName: 'Wes' });
  const vi = (await vic.get('/api/inventory')).json, we = (await wes.get('/api/inventory')).json;
  const gift = vi.stacks.find(x => x.item === 'goods:gift');
  const id = (await vic.post('/api/inventory/trade/open', { to: 'wes' })).json.id;
  await vic.post('/api/inventory/trade/offer', { trade: id, items: [{ stack: gift.id, qty: 1 }] });
  await wes.post('/api/inventory/trade/offer', { trade: id, items: [{ stack: we.stacks.find(x => x.item === 'food:coffee').id, qty: 1 }] });
  assert.equal((await vic.post('/api/inventory/trade/accept', { trade: id })).status, 200);
  // Vic gives the gift box away before Wes accepts
  assert.equal((await vic.post('/api/inventory/give', { stack: gift.id, to: { kind: 'account', id: wes.id } })).status, 200);
  const late = await wes.post('/api/inventory/trade/accept', { trade: id });
  assert.equal(late.status, 404, `it can't go through: ${JSON.stringify(late.json)}`); assert.match(late.json.error, /couldn't go through/);
  const st = (await vic.get('/api/inventory/trades')).json.trades.find(x => x.id === id);
  assert.ok(st.status === 'open' && !st.myOk && !st.theirOk && st.me.items[0].gone, 'still open, nobody\'s acceptance, the gift shown gone');
  assert.equal((await owner.post('/api/inventory/trade/accept', { trade: id })).status, 403, 'not his trade');
  assert.equal((await wes.post('/api/inventory/trade/decline', { trade: id })).json.status, 'declined');
  assert.equal((await vic.post('/api/inventory/trade/accept', { trade: id })).status, 409);
});
