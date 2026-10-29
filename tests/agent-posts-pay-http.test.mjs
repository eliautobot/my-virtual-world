// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A position's pay over HTTP (server/agent-posts/posts.js setPay, 2026-10-28: "in the ... button there should be a Pay
// option and the user picks a payment amount for that post/position"): the floor's counters say what each place to work
// pays and who pays it (the business there); its owner sets an amount an hour, at least the minimum wage; back to the
// usual; someone else may not; with the economy off there is no pay to set.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { isServiceDesk } from '../shared/catalog.js';

let s, owner, ann, spot;
const floorOf = async (who, b, f) => (await who.get(`/api/agent-posts/floor?b=${b}&f=${f}`)).json;
const slotNow = async () => (await floorOf(owner, spot.b, spot.f)).items.find(x => x.id === spot.item).slots.find(x => x.k === spot.k);

before(async () => {
  s = await startServer({ population: 300, agents: 1 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const w = (await owner.get('/api/world')).json.world;
  for (const Bd of w.buildings) {
    if (!Bd || Bd.gone || spot) continue;
    for (let f = 0; f < Bd.floors && !spot; f++) {
      if (!w.levels[Bd.lv[f]]?.items.some(it => isServiceDesk(it.t))) continue;
      const it = ((await floorOf(owner, Bd.idx, f)).items || []).find(x => x.slots[0]?.pay);
      if (it) spot = { b: Bd.idx, f, item: it.id, k: it.slots[0].k };
    }
  }
});
after(async () => { await s?.stop(); });

test('the floor says what each place to work pays and who pays it', async () => {
  assert.ok(spot, 'a counter with its pay');
  const p = (await slotNow()).pay;
  assert.equal(p.payer, 'business'); assert.equal(p.set, false); assert.equal(p.rate, p.usual);
  assert.ok(p.usual >= p.min && p.name, JSON.stringify(p));
});

test('its owner sets an amount an hour, at least the minimum wage; back to the usual', async () => {
  const r = await owner.post('/api/agent-posts/pay', { ...spot, slot: spot.k, rate: 2000 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.pay[0].rate, r.json.pay[0].set], [2000, true]);
  assert.deepEqual([(await slotNow()).pay.rate, (await slotNow()).pay.set], [2000, true]);
  for (const bad of [100, 0, -5, 1.5, 'lots']) {
    const x = await owner.post('/api/agent-posts/pay', { ...spot, slot: spot.k, rate: bad });
    assert.equal(x.status, 400, `${bad}: ${x.text}`);
  }
  const back = await owner.post('/api/agent-posts/pay', { ...spot, slot: spot.k, rate: null });
  assert.equal(back.status, 200);
  const p = (await slotNow()).pay;
  assert.deepEqual([p.set, p.rate === p.usual], [false, true]);
});

test('someone else may not set it; with the economy off there is no pay', async () => {
  assert.equal((await ann.post('/api/agent-posts/pay', { ...spot, slot: spot.k, rate: 2000 })).status, 403);
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: false })).status, 200);
  const r = await owner.post('/api/agent-posts/pay', { ...spot, slot: spot.k, rate: 2000 });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'no_economy');
  assert.equal((await slotNow()).pay, null, 'the floor shows no pay');
});
