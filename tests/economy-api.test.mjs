// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy over HTTP (server/economy/; docs/features/ECONOMY.md): switched off until the owner turns it on (genesis:
// every wallet with its starting money); players pay each other and ask to be paid, within limits, with the password
// again for large amounts; nobody spends someone else's money; administrators grant, correct and freeze with a reason;
// a world day settles (wages, rent, sales, taxes, benefits) into balanced, signed, reconciled books; the city's budget,
// the market and the lenses answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ownerSession, userSession } from '../tools/lib/testserver.mjs';

const VC = n => n * 100;

test('economy: off by default, genesis, payments, requests, limits, rights, admin tools, a settled day', { timeout: 120000 }, async () => {
  const s = await startServer({ population: 300 });
  try {
    const owner = await ownerSession(s);
    const alice = await userSession(s, owner, { login: 'alice' }), bob = await userSession(s, owner, { login: 'bob' });
    const guest = { get: p => fetch(s.url + p).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })), post: (p, b) => fetch(s.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) })) };

    // off until the owner turns it on; members can't turn it on
    let st = (await guest.get('/api/economy/status')).json;
    assert.equal(st.enabled, false);
    assert.equal((await alice.post('/api/economy/pay', { to: { kind: 'account', login: 'bob' }, amount: 100 })).json.code, 'off');
    assert.equal((await alice.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 403);
    const on = await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true });
    assert.equal(on.status, 200, on.text);
    st = (await alice.get('/api/economy/status')).json;
    assert.equal(st.enabled, true); assert.equal(st.scale, 100);
    assert.equal(st.balance, VC(500), 'every player starts with their endowment');

    // genesis made the treasury, the businesses and every resident's wallet; the books balance and the chain verifies
    let health = (await owner.get('/api/economy/admin/health')).json;
    assert.equal(health.ok, true, JSON.stringify(health.problems));
    assert.ok(health.supply.wallets > 300, 'a wallet for every resident, player and business');
    assert.equal(health.supply.total, health.supply.issued - health.supply.destroyed);
    const biz = (await guest.get('/api/economy/businesses')).json.businesses;
    assert.ok(biz.length > 5 && biz.some(b => b.kind === 'cafe') && biz.some(b => b.kind === 'office'), 'venues and companies are businesses');

    // paying: rights, inputs, idempotency. A new account sends only a little a day for its first days (starter money
    // farmed through throwaway accounts); the rest of this test lifts that rule.
    const pay = (c, b) => c.post('/api/economy/pay', b);
    const lim = await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: VC(150) });
    assert.equal(lim.json.code, 'limit', 'a new account sends at most 100 VC a day');
    assert.equal((await owner.post('/api/economy/admin/policy', { policy: { limits: { newAccountDays: 0 } } })).status, 200);
    assert.equal((await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: 1.5 })).status, 400);
    assert.equal((await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: -100 })).status, 400);
    assert.equal((await pay(alice, { to: { kind: 'account', login: 'nobody' }, amount: 100 })).status, 404);
    assert.equal((await pay(alice, { to: { kind: 'account', login: 'alice' }, amount: 100 })).status, 400, 'not to yourself');
    assert.equal((await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: VC(501) })).json.code, 'funds');
    const r1 = await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: VC(25), memo: 'lunch', idem: 'k1' });
    assert.equal(r1.status, 200, r1.text); assert.equal(r1.json.amount, -VC(25));
    const r2 = await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: VC(25), memo: 'lunch', idem: 'k1' });
    assert.equal(r2.json.seq, r1.json.seq, 'the same request is paid once');
    assert.equal((await bob.get('/api/economy/me')).json.wallet.balance, VC(525));
    // someone else's wallet: refused; a guest: refused
    const bobWallet = (await bob.get('/api/economy/me')).json.wallet.id;
    assert.equal((await pay(alice, { from: bobWallet, to: { kind: 'account', login: 'alice' }, amount: 100 })).status, 403);
    assert.equal((await alice.get(`/api/economy/statement?wallet=${bobWallet}`)).status, 403);
    assert.equal((await guest.post('/api/economy/pay', { to: { kind: 'account', login: 'bob' }, amount: 100 })).status, 401);
    // statements say who was on the other side and why
    const stmt = (await alice.get('/api/economy/statement')).json.statement;
    assert.ok(stmt.some(l => l.amount === -VC(25) && l.memo === 'lunch' && /bob/i.test(l.with)));

    // payment requests
    const rq = await bob.post('/api/economy/request', { from: { kind: 'account', login: 'alice' }, amount: VC(10), memo: 'tickets' });
    assert.equal(rq.status, 200, rq.text);
    const toPay = (await alice.get('/api/economy/me')).json.requestsToPay;
    assert.equal(toPay.length, 1); assert.equal(toPay[0].memo, 'tickets');
    assert.equal((await bob.post('/api/economy/request/answer', { id: toPay[0].id, answer: 'pay' })).status, 403, 'only the payer pays');
    const paid = await alice.post('/api/economy/request/answer', { id: toPay[0].id, answer: 'pay' });
    assert.equal(paid.status, 200, paid.text); assert.equal(paid.json.request.status, 'paid');
    assert.equal((await alice.post('/api/economy/request/answer', { id: toPay[0].id, answer: 'pay' })).status, 404, 'once');

    // administrators: a grant needs a reason; corrections reverse; a frozen wallet can't pay
    assert.equal((await owner.post('/api/economy/admin/grant', { to: { kind: 'account', login: 'alice' }, amount: VC(100) })).status, 400);
    assert.equal((await alice.post('/api/economy/admin/grant', { to: { kind: 'account', login: 'alice' }, amount: VC(100), memo: 'x' })).status, 403);
    const g = await owner.post('/api/economy/admin/grant', { to: { kind: 'account', login: 'alice' }, amount: VC(100), memo: 'Prize for the photo contest' });
    assert.equal(g.status, 200, g.text);
    const c = await owner.post('/api/economy/admin/correct', { tx: g.json.seq, memo: 'Wrong winner' });
    assert.equal(c.status, 200, c.text);
    assert.equal((await owner.post('/api/economy/admin/correct', { tx: g.json.seq, memo: 'again' })).json.code, 'conflict');
    const aw = (await alice.get('/api/economy/me')).json.wallet;
    assert.equal(aw.balance, VC(500 - 25 - 10));
    const fr = await owner.post('/api/economy/admin/freeze', { wallet: aw.id, frozen: true, memo: 'Investigating' });
    assert.equal(fr.status, 200, fr.text);
    assert.equal((await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: 100 })).json.code, 'frozen');
    await owner.post('/api/economy/admin/freeze', { wallet: aw.id, frozen: false });
    assert.equal((await pay(alice, { to: { kind: 'account', login: 'bob' }, amount: 100 })).status, 200);

    // policy: validated, applied, audited
    assert.equal((await owner.post('/api/economy/admin/policy', { policy: { taxes: { sales: 99999 } } })).status, 400);
    assert.equal((await owner.post('/api/economy/admin/policy', { policy: { wages: { office: 10 } } })).status, 400, 'below the minimum wage');
    const pol = await owner.post('/api/economy/admin/policy', { policy: { taxes: { sales: 700 } } });
    assert.equal(pol.status, 200, pol.text); assert.equal(pol.json.policy.taxes.sales, 700);

    // a world day: let residents live a little, then jump past the settlement hour
    await new Promise(r => setTimeout(r, 2500));
    const day0 = (await guest.get('/api/economy/status')).json.day;
    await owner.post('/api/clock', { skip: 4 }); await owner.post('/api/clock', { skip: 5.25 });   // 04:00, then 05:15: past one settlement
    let settled = null;
    for (let k = 0; k < 40 && !settled; k++) { await new Promise(r => setTimeout(r, 250)); const b = (await guest.get('/api/economy/budget')).json; if (b.history?.length) settled = b; }
    assert.ok(settled, 'the day settled');
    assert.ok((await guest.get('/api/economy/status')).json.day > day0);
    health = (await owner.get('/api/economy/admin/health')).json;
    assert.equal(health.ok, true, JSON.stringify(health.problems));
    assert.equal(health.chain.ok, true);
    const ov = (await guest.get('/api/economy/overview')).json;
    assert.ok(ov.yesterday, 'the overview has yesterday');
    assert.ok(ov.yesterday.wages > 0 || ov.yesterday.welfare > 0, 'money reached residents');
    assert.ok(ov.yesterday.rent > 0, 'residents paid rent');
    assert.ok(ov.supply.total > 0);
    assert.ok(['homes', 'shops', 'jobs'].every(k => Number.isFinite(ov.demand[k])));
    // the treasury's ledger is public; the market, the price index and the lenses answer
    const tr = (await guest.get('/api/economy/treasury')).json;
    assert.ok(tr.statement.length >= 1);
    assert.ok((await guest.get('/api/economy/market')).json.commodities.length >= 5);
    assert.ok(Number.isFinite((await guest.get('/api/economy/index')).json.level));
    for (const k of ['revenue', 'rent', 'wealth', 'jobs', 'land']) { const l = await guest.get(`/api/economy/lens?kind=${k}`); assert.equal(l.status, 200, k); }
    assert.equal((await guest.get('/api/economy/lens?kind=nope')).status, 400);
  } finally { await s.stop(); }
});
