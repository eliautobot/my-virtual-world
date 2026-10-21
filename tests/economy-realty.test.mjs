// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Property for Virtual Coin over HTTP (server/economy/realty.js; docs/features/ECONOMY.md §7, §12): the city sells land
// for VC and players resell it (the title passes in the payment's transaction; the 10% world
// fee is destroyed); a flat is let for VC - the first day at once, then by the day at the settlement - and edits can't
// destroy it while it is let; leases end by the tenant, or after the days of grace when the rent goes unpaid.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { flatRef } from '../shared/flat-ref.js';

const VC = n => n * 100;
async function city(env = {}, demo = false) {
  const dir = tempDir('mvw-realty-');
  await (await startServer({ data: dir, population: 200, demo, env })).stop();
  const r = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '3', '--nz', '2'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = await startServer({ data: dir, population: 200, demo, env });
  return { s, close: async () => { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); for (const f of fs.readdirSync(path.dirname(dir))) if (f.startsWith(path.basename(dir) + '.')) fs.rmSync(path.join(path.dirname(dir), f), { recursive: true, force: true }); } };
}

test('property for VC: land sold and resold, a flat let by the day, guarded, ended', { timeout: 180000 }, async () => {
  const C = await city();
  try {
    const { s } = C, owner = await ownerSession(s);
    const alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
    const bal = async c => (await c.get('/api/economy/me')).json.wallet.balance;
    const lots = (await owner.get('/api/property/lots')).json.lots.filter(l => l.holder.kind === 'municipality' && l.origins === 1 && !l.buildings.length);
    const L1 = lots[0];
    // the city's land for VC: only administrators list it; the lot shows as for sale
    assert.equal((await alice.post('/api/economy/realty/list', { kind: 'lot', target: L1.id, price: VC(200) })).status, 403);
    assert.equal((await owner.post('/api/economy/realty/list', { kind: 'lot', target: L1.id, price: 5 })).status, 400, 'at least 1 VC');
    const li = await owner.post('/api/economy/realty/list', { kind: 'lot', target: L1.id, price: VC(200) });
    assert.equal(li.status, 200, li.text);
    assert.equal((await owner.get(`/api/property/lot/${L1.id}`)).json.lot.lifecycle, 'available');
    // Alice buys it: 200 VC; the city gets 180, 20 is destroyed; the title is hers
    const T0 = (await owner.get('/api/economy/treasury')).json.wallet.balance, sup0 = (await owner.get('/api/economy/admin/health')).json.supply;
    const buy = await alice.post('/api/economy/realty/take', { id: li.json.listing.id });
    assert.equal(buy.status, 200, buy.text);
    assert.equal(buy.json.fee, VC(20));
    assert.equal(await bal(alice), VC(300));
    assert.equal((await owner.get('/api/economy/treasury')).json.wallet.balance - T0, VC(180));
    const sup1 = (await owner.get('/api/economy/admin/health')).json.supply;
    assert.equal(sup1.destroyed - sup0.destroyed, VC(20), 'the world fee is destroyed');
    const lot = (await alice.get(`/api/property/lot/${L1.id}`)).json.lot;
    assert.equal(lot.holder.kind, 'account'); assert.equal(lot.lifecycle, 'owned');
    assert.equal((await bob.post('/api/economy/realty/take', { id: li.json.listing.id })).status, 404, 'sold once');
    // Alice resells; Bob can't pay more than he holds; at 300 he can
    const l2 = await alice.post('/api/economy/realty/list', { kind: 'lot', target: L1.id, price: VC(600) });
    assert.equal(l2.status, 200, l2.text);
    assert.equal((await bob.post('/api/economy/realty/take', { id: l2.json.listing.id })).json.code, 'funds');
    assert.equal((await owner.get(`/api/property/lot/${L1.id}`)).json.lot.holder.kind, 'account', 'nothing changed hands');
    const l3 = await alice.post('/api/economy/realty/list', { kind: 'lot', target: L1.id, price: VC(300) });
    assert.equal(l3.json.listing.id, l2.json.listing.id, 'listing again changes the price');
    assert.equal((await bob.post('/api/economy/realty/take', { id: l3.json.listing.id })).status, 200);
    assert.equal(await bal(alice), VC(300 + 270)); assert.equal(await bal(bob), VC(200));

    // a flat let for VC
    const W = (await owner.get('/api/world')).json.world, allLots = (await owner.get('/api/property/lots')).json.lots;
    const B = W.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors > 1 && allLots.find(l => l.id === b.lot)?.holder.kind === 'municipality' && W.levels[b.lv[1]]?.units?.length);
    const ref = flatRef(B, 1, W.levels[B.lv[1]], 0);
    const fl = await owner.post('/api/economy/realty/list', { kind: 'flat_rent', target: ref, price: VC(900) });
    assert.equal(fl.status, 200, fl.text); assert.equal(fl.json.listing.perDay, VC(30));
    const r = await alice.post('/api/economy/realty/take', { id: fl.json.listing.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(await bal(alice), VC(570 - 30), 'the first day at once');
    const rec = (await owner.get('/api/world')).json.world.flats?.[`${B.idx}:1:0`];
    assert.equal(rec.deal, 'rented'); assert.equal(rec.vc, 1); assert.equal(rec.tenants[0].kind, 'account');
    assert.equal((await bob.post('/api/economy/realty/take', { id: fl.json.listing.id })).status, 404);
    // while it is let, edits can't destroy it
    const del = await owner.post('/api/edit', { ops: [{ op: 'flat.del', b: B.idx, f: 1, u: 0 }] });
    assert.ok(del.json?.ok === false && /Virtual Coin/.test(del.json.error), JSON.stringify(del.json));
    const regen = await owner.post('/api/edit', { ops: [{ op: 'lvl.regen', b: B.idx, f: 1 }] });
    assert.ok(regen.json?.ok === false && /Virtual Coin/.test(regen.json.error));
    // a settled day charges the rent
    const before = await bal(alice);
    await owner.post('/api/clock', { skip: 4 }); await owner.post('/api/clock', { skip: 5.25 });   // 04:00, then 05:15: past one settlement
    for (let k = 0; k < 40; k++) { await new Promise(res => setTimeout(res, 250)); if ((await owner.get('/api/economy/budget')).json.history?.length) break; }
    assert.equal(before - await bal(alice), VC(30), 'a day of rent');
    const me = (await alice.get('/api/economy/me')).json;
    assert.equal(me.leases.rent[0].status, 'active');
    assert.ok(me.trust.dims.pay >= 500, 'paying rent builds trust');
    // the tenant ends it and moves out
    const end = await alice.post('/api/economy/realty/end', { lease: me.leases.rent[0].id });
    assert.equal(end.status, 200, end.text); assert.equal(end.json.lease.status, 'ended');
    const rec2 = (await owner.get('/api/world')).json.world.flats?.[`${B.idx}:1:0`];
    assert.equal(rec2.deal, 'own'); assert.ok(!rec2.tenants.length);
    const h = (await owner.get('/api/economy/admin/health')).json;
    assert.equal(h.ok, true, JSON.stringify(h.problems));
  } finally { await C.close(); }
});

test('renting a business to run: the tenant runs it and keeps its takings, the landlord collects the rent, the floor is kept', { timeout: 180000 }, async () => {
  const C = await city();
  try {
    const { s } = C, owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true });
    await owner.post('/api/economy/admin/policy', { policy: { limits: { newAccountDays: 0 } } });
    const W = (await owner.get('/api/world')).json.world;
    // a city café
    let biz = null, B = null;
    for (const b of W.buildings) {
      if (!b || b.gone || b.type === 'apartment' || b.type === 'park') continue;
      for (let f = 0; f < (b.floors || 0) && !biz; f++) { const j = (await owner.get(`/api/economy/place?b=${b.idx}&f=${f}`)).json; if (j.business?.kind === 'cafe' && j.business.owner.kind === 'municipality') { biz = j; B = b; } }
      if (biz) break;
    }
    assert.ok(biz, 'a city café');
    assert.equal(biz.landlord, true, 'the city\'s land: administrators let it');
    assert.equal((await alice.get(`/api/economy/place?b=${biz.business.b}&f=${biz.business.f}`)).json.landlord, false);
    const place = biz.place;
    assert.match(place, /^venue:/);
    assert.equal((await alice.post('/api/economy/realty/list', { kind: 'venue_rent', target: place, price: VC(600) })).status, 403, 'only the landlord lets it');
    const li = await owner.post('/api/economy/realty/list', { kind: 'venue_rent', target: place, price: VC(600) });
    assert.equal(li.status, 200, li.text); assert.equal(li.json.listing.perDay, VC(20)); assert.equal(li.json.listing.business.id, biz.business.id);
    // Alice rents it: the first day at once; she runs it now
    const T0 = (await owner.get('/api/economy/treasury')).json.wallet.balance, a0 = (await alice.get('/api/economy/me')).json.wallet.balance;
    const r = await alice.post('/api/economy/realty/take', { id: li.json.listing.id });
    assert.equal(r.status, 200, r.text);
    assert.equal(a0 - (await alice.get('/api/economy/me')).json.wallet.balance, VC(20));
    const card = (await alice.get(`/api/economy/business/${biz.business.id}`)).json;
    assert.equal(card.business.owner.kind, 'account'); assert.equal(card.mayManage, true); assert.equal(card.tenant, true);
    assert.ok((await owner.get('/api/economy/treasury')).json.wallet.balance > T0, 'the till went to the city, its landlord, with the first rent');
    assert.equal((await bob.post('/api/economy/realty/take', { id: li.json.listing.id })).status, 404, 'let once');
    // she runs it: funds the till, sets a price; someone else buys there and the takings are hers
    assert.equal((await alice.post('/api/economy/business/move', { id: biz.business.id, dir: 'fund', amount: VC(50) })).status, 200);
    const cf = await alice.post('/api/economy/business/configure', { id: biz.business.id, prices: { coffee: 400 } });
    assert.equal(cf.status, 200, cf.text);
    assert.equal((await owner.post('/api/economy/business/configure', { id: biz.business.id, prices: { coffee: 300 } })).status, 403, 'the landlord doesn\'t run it now');
    assert.equal((await alice.get('/api/economy/me')).json.businesses.length, 1, 'in her wallet\'s businesses');
    // the landlord can't re-lay its floor or take the building down while it is let
    const relay = await owner.post('/api/edit', { ops: [{ op: 'lvl.regen', b: B.idx, f: biz.business.f }] });
    assert.ok(relay.json?.ok === false && /let for Virtual Coin/.test(relay.json.error), JSON.stringify(relay.json));
    const del = await owner.post('/api/edit', { ops: [{ op: 'bld.del', b: B.idx }] });
    assert.ok(del.json?.ok === false && /let for Virtual Coin/.test(del.json.error));
    // a settled day: the rent from her wallet to the city
    const before = (await alice.get('/api/economy/me')).json.wallet.balance;
    await owner.post('/api/clock', { skip: 4 }); await owner.post('/api/clock', { skip: 5.25 });
    for (let k = 0; k < 40; k++) { await new Promise(res => setTimeout(res, 250)); if ((await owner.get('/api/economy/budget')).json.history?.length) break; }
    const after = (await alice.get('/api/economy/me')).json.wallet.balance;
    assert.ok(before - after >= VC(20), `a day of rent (${before - after})`);
    // she stops: the business goes back to the city, its till to her
    const till = (await alice.get(`/api/economy/statement?wallet=${(await alice.get('/api/economy/me')).json.businesses[0].wallet.id}`)).json.wallet.balance;
    const L = (await alice.get(`/api/economy/business/${biz.business.id}`)).json.lease;
    const end = await alice.post('/api/economy/realty/end', { lease: L.id });
    assert.equal(end.status, 200, end.text);
    const back = (await owner.get(`/api/economy/business/${biz.business.id}`)).json;
    assert.equal(back.business.owner.kind, 'municipality');
    assert.equal((await alice.get('/api/economy/me')).json.wallet.balance - after, till, 'the till came back to her');
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'lvl.regen', b: B.idx, f: biz.business.f }] })).json?.ok, true, 'the floor is free again');
    const h = (await owner.get('/api/economy/admin/health')).json;
    assert.equal(h.ok, true, JSON.stringify(h.problems));
  } finally { await C.close(); }
});

