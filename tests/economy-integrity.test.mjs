// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy's integrity rules (docs/features/ECONOMY.md §1, §2.4; the reviewer's review of 2026-10-05): no way to make money
// out of nothing (businesses closed and reopened, agents connected, ads on your own sign), no buying from yourself, no
// trust from passing coins back and forth, debts paid before owners, missed days settled in order or skipped in the
// open, a lease ending survives a stop, a price index from prices actually paid, reviews only from real customers,
// work modules that plug in without touching the economy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { economyModel } from './helpers/econ-model.mjs';
import { registerModule, moduleOf, ROLES, makeOrder, scoreOrder } from '../shared/work.js';
import { checkPolicy, POLICY_DEFAULTS } from '../server/economy/policy.js';

const VC = n => Math.round(n * 100);

test('no money from nothing: a business closed and reopened, a member\'s agents, the owner\'s agents', () => {
  const agents = new Map([[1, { id: 1, name: 'A1', ownerId: 10, enabled: true }], [2, { id: 2, name: 'A2', ownerId: 10, enabled: true }], [3, { id: 3, name: 'A3', ownerId: 10, enabled: true }],
    [4, { id: 4, name: 'Owner\'s', ownerId: 11, enabled: true }], [5, { id: 5, name: 'Owner\'s 2', ownerId: 11, enabled: true }], [6, { id: 6, name: 'Owner\'s 3', ownerId: 11, enabled: true }]]);
  const m = economyModel({ population: 120, seed: 'integrity-1', agents: { byId: id => agents.get(id) || null, enabled: () => [] } });
  try {
    const e = m.econ, bz = e.parts.businesses, L = e.ledger;
    m.account(10, 'member'); m.account(11, 'owner');
    // a member's agents: starting money for the first endowment.memberAgents (2) only
    const got = [1, 2, 3].map(id => e.walletFor({ kind: 'agent', id: String(id) }).balance);
    assert.deepEqual(got, [POLICY_DEFAULTS.endowment.agent, POLICY_DEFAULTS.endowment.agent, 0], 'the third agent starts empty');
    // the installation's owner's agents always get it (an administrator can grant money anyway)
    assert.ok([4, 5, 6].every(id => e.walletFor({ kind: 'agent', id: String(id) }).balance === POLICY_DEFAULTS.endowment.agent));
    // a venue a player holds is closed and reopened (its floor made something else and back): no new money
    const cafe = bz.open().find(b => b.kind === 'cafe');
    m.world.buildings[cafe.b].lot = 'L-test';
    bz.d.property = { get: id => (id === 'L-test' ? { holder: { kind: 'account', id: '10' } } : null) };
    bz.sync();
    assert.equal(bz.get(cafe.id).owner_kind, 'account', 'the player owns the café');
    const issued0 = L.supply().issued;
    const lv = m.world.levels[m.world.buildings[cafe.b].lv[cafe.f]], kind = lv.venue;
    for (let k = 0; k < 5; k++) {
      lv.venue = 'shop'; bz.sync();
      lv.venue = kind; bz.sync();
    }
    const reopened = bz.at(cafe.b, cafe.f);
    assert.notEqual(reopened.id, cafe.id);
    assert.equal(bz.wallet(reopened).balance, 0, 'a player\'s new business starts empty');
    assert.equal(L.supply().issued, issued0, 'closing and reopening made no money');
    assert.deepEqual(e.health().problems, []);
  } finally { m.close(); }
});

test('a business closing pays its staff\'s back wages before its owner, in one transaction', () => {
  const m = economyModel({ population: 120, seed: 'integrity-2' });
  try {
    const e = m.econ, bz = e.parts.businesses, L = e.ledger;
    const cafe = bz.open().find(b => b.kind === 'cafe'), bw = bz.wallet(cafe);
    const worker = e.walletFor({ kind: 'resident', id: m.people.find(p => p && !p.retired && !p.vip).id });
    e.db.prepare(`INSERT INTO econ_debts (id, world_id, debtor, creditor, kind, amount, original, ref, status, created, updated) VALUES ('d1', ?, ?, ?, 'wages', ?, ?, 'test', 'open', 0, 0)`).run(e.w, bw.id, worker.id, VC(40), VC(40));
    const T0 = e.treasury().balance, w0 = worker.balance, cash = bw.balance;
    const lv = m.world.levels[m.world.buildings[cafe.b].lv[cafe.f]];
    lv.venue = 'none'; bz.sync();
    assert.equal(L.wallet(worker.id).balance - w0, VC(40), 'the back wages first');
    assert.equal(e.treasury().balance - T0, cash - VC(40), 'the rest to the owner (the city)');
    assert.equal(e.db.prepare("SELECT status FROM econ_debts WHERE id = 'd1'").get().status, 'paid');
    assert.deepEqual(e.health().problems, []);
  } finally { m.close(); }
});

test('no buying from yourself; a new account pays players a little a day; paying a request earns no trust', () => {
  let clock = 1_000_000_000_000;
  const m = economyModel({ population: 120, seed: 'integrity-3', now: () => clock });
  try {
    const e = m.econ, bz = e.parts.businesses;
    m.account(20, 'member', clock); m.account(21, 'member', clock - 30 * 86400e3);
    const shop = bz.open().find(b => b.kind === 'cafe');
    m.world.buildings[shop.b].lot = 'L-own';
    bz.d.property = { get: id => (id === 'L-own' ? { holder: { kind: 'account', id: '21' } } : null) };
    bz.sync();
    const owner = { kind: 'account', id: 21 }, fresh = { kind: 'account', id: 20 };
    e.walletFor({ kind: 'account', id: '20' }); e.walletFor({ kind: 'account', id: '21' });
    assert.throws(() => e.buy({ actor: owner }, { business: shop.id, items: [{ id: 'coffee', n: 1 }] }), /is yours/);
    // a new account: at most 100 VC a day to other players and their businesses (the city's venues are free of it)
    e.pay({ actor: fresh, reauthOk: true }, { to: { kind: 'account', id: 21 }, amount: VC(95) });
    assert.throws(() => e.buy({ actor: fresh }, { business: shop.id, items: [{ id: 'club_sandwich', n: 1 }] }), e2 => e2.code === 'limit');
    const city = bz.open().find(b => b.kind === 'cafe' && b.owner_kind === 'municipality');
    assert.ok(e.buy({ actor: fresh }, { business: city.id, items: [{ id: 'club_sandwich', n: 1 }] }).total > 0, 'a city café is fine');
    // paying requests between two accounts moves the same coins and builds no trust
    const t0 = e.parts.trust.of({ kind: 'account', id: '21' }).dims.pay;
    for (let k = 0; k < 5; k++) {
      const r = e.request({ actor: fresh }, { from: { kind: 'account', id: 21 }, amount: VC(1) });
      e.answerRequest({ actor: owner, reauthOk: true }, r.id, 'pay');
    }
    assert.equal(e.parts.trust.of({ kind: 'account', id: '21' }).dims.pay, t0, 'no trust from requests');
    assert.deepEqual(e.health().problems, []);
  } finally { m.close(); }
});

test('missed days settle in order a few at a time; a stretch without any activity is skipped in the open', () => {
  const m = economyModel({ population: 150, seed: 'integrity-4', policy: { settlement: { maxDaysPerTick: 2 } } });
  try {
    const e = m.econ, H = e.parts.households;
    H.genesisDone();
    for (let d = 0; d < 4; d++) { m.live(); m.setDay(d + 1); }   // four lived days, unsettled
    m.setDay(20);                                                 // then the world jumps on: days 4 … 19 had no life
    const a = H.catchUp(), b = H.catchUp(), c = H.catchUp(), d = H.catchUp();
    assert.deepEqual(a.map(x => x.day), [0, 1], 'two a call, in order');
    assert.deepEqual(b.map(x => x.day), [2, 3]);
    assert.deepEqual(c, [{ day: 19, skipped: { from: 4, to: 19 } }], 'the empty stretch is one skipped record');
    assert.deepEqual(d, []);
    const rows = e.db.prepare('SELECT day, status FROM econ_days WHERE world_id = ? ORDER BY day').all(e.w).map(r => `${r.day}:${r.status}`);
    assert.deepEqual(rows.filter(r => !r.startsWith('-1')), ['0:done', '1:done', '2:done', '3:done', '19:skipped']);
    assert.deepEqual(e.health().problems, []);
  } finally { m.close(); }
});

test('the price index: prices actually paid, no venue more than its share, thin items marked, sample sizes published', () => {
  const m = economyModel({ population: 600, seed: 'integrity-5', policy: { index: { minSamples: 30, venueCapPct: 10 } } });
  try {
    const e = m.econ, bz = e.parts.businesses;
    m.step(); m.step();
    const idx = e.parts.market.index(10);
    const coffee = idx.items.find(i => i.id === 'coffee');
    assert.ok(coffee.samples > 0 && coffee.median > 0, 'coffee priced from real sales');
    assert.match(idx.method, /^v2/);
    // one café sells coffee at its top price to many: the median doesn't follow it past its share
    m.live();   // a day of sales at every café
    const cafes = bz.open().filter(b => b.kind === 'cafe'), top = cafes[0], H = e.parts.households, day = m.day;
    const B = H._biz(day, top.id); B.px.coffee = { [String(bz.priceOf(top, 'coffee') * 3)]: 5000 };
    const plan = H.plan(day);
    const r = e.parts.market.priceIndex(day, plan.books, plan.rentNights, plan.prices);
    assert.ok(r.items.coffee.median < bz.priceOf(top, 'coffee') * 3, `capped: median ${r.items.coffee.median}`);
    assert.ok(r.items.coffee.samples >= 5000);
    // an item nobody bought enough of is thin: it carries its last price
    const thin = e.parts.market.priceIndex(day, new Map(), [], new Map());
    assert.equal(thin.items.coffee.thin, true); assert.equal(thin.items.coffee.median, null);
  } finally { m.close(); }
});

test('work modules: registered, validated, mapped to venues by policy, scored by their own rubric', () => {
  assert.throws(() => registerModule({ id: 'Bad id' }), /id/);
  assert.throws(() => registerModule({ id: 'usher_x', version: 1, label: 'Usher', icon: '🎟️', unit: 'guest', units: 'guests', venues: ['cinema'], makeOrder() {}, rubric: { quality: 0.5, speed: 0.4 } }), /quality \+ speed/);
  const m = registerModule({ id: 'usher_test', version: 1, label: 'Usher', icon: '🎟️', unit: 'guest', units: 'guests', venues: ['cinema_test'], stage: 10,
    rubric: { quality: 1, speed: 0, stars: [0.2, 0.4, 0.6, 0.8] },
    makeOrder: (r, { customer }) => ({ title: `${customer}'s seat`, item: 'ticket', expectMs: 5000, steps: [{ kind: 'choice', label: 'Which screen?', options: ['1', '2'], answer: 1, hint: '' }] }) });
  assert.equal(moduleOf('usher_test'), m);
  assert.equal(ROLES.usher_test.label, 'Usher');
  const o = makeOrder('usher_test', 'seed', 0, { customer: 'Ava' });
  assert.equal(o.module, 'usher_test'); assert.equal(o.title, 'Ava\'s seat');
  assert.equal(scoreOrder(o, [{ pick: 1 }], 99999).stars, 5, 'its own rubric: quality only');
  // the policy maps venue kinds to modules; unknown modules are refused
  const p = checkPolicy(structuredClone(POLICY_DEFAULTS), { jobs: { roles: { cafe: ['barista', 'usher_test'] } } });
  assert.deepEqual(p.jobs.roles.cafe, ['barista', 'usher_test']);
  assert.throws(() => checkPolicy(structuredClone(POLICY_DEFAULTS), { jobs: { roles: { cafe: ['nope'] } } }), /known work modules/);
  // and the jobs core uses it at once
  const em = economyModel({ population: 120, seed: 'integrity-6', jobs: true, policy: { jobs: { roles: { cafe: ['barista', 'usher_test'] } } } });
  try {
    const cafe = em.econ.parts.businesses.open().find(b => b.kind === 'cafe');
    assert.deepEqual(em.econ.parts.jobs.rolesAt('cafe'), ['barista', 'usher_test']);
    const s = em.econ.parts.jobs.start({ kind: 'account', id: 5 }, { business: cafe.id, role: 'usher_test' });
    assert.equal(s.order.module, 'usher_test');
    assert.equal(s.order.steps[0].answer, undefined, 'the answer stays on the server');
  } finally { em.close(); }
});

test('reviews come from real customers only, once each', () => {
  const m = economyModel({ population: 400, seed: 'integrity-7', jobs: true });
  try {
    const e = m.econ;
    for (let k = 0; k < 3; k++) m.step();
    const rows = e.db.prepare('SELECT author, ref FROM econ_reviews WHERE world_id = ?').all(e.w);
    assert.ok(rows.length > 0, 'customers reviewed');
    for (const r of rows) {
      const [kind, id] = r.author.split(':');
      assert.equal(kind, 'resident');
      assert.ok(e.residentById(id), `a real resident: ${r.author}`);
    }
    assert.equal(new Set(rows.map(r => r.ref)).size, rows.length, 'each counts once');
  } finally { m.close(); }
});

test('activity never lands on a settled day (the clock went back a little after a crash)', () => {
  const m = economyModel({ population: 150, seed: 'integrity-8' });
  try {
    const e = m.econ, H = e.parts.households;
    m.step(); m.step();                       // days 0 and 1 settled
    assert.equal(H.lastSettled, 1);
    assert.equal(H.dayFor(1.4), 2, 'a moment of day 1 after it settled counts in day 2');
    assert.equal(H.dayFor(2.3), 2);
    const p = m.people.find(x => x && !x.retired && x.home), cafe = e.parts.businesses.open().find(b => b.kind === 'cafe');
    H.onAct({ i: 0, p }, { kind: 'visit', use: 'cafe', b: cafe.b, f: cafe.f, holdStart: 1.4 });
    assert.ok(!H.days.has(1) && H.days.has(2), 'the purchase is on the open day');
  } finally { m.close(); }
});

test('an agent on post is paid: its own job\'s wages for the hours on post, up to its shift; without a job, the post\'s business pays (2026-10-14)', () => {
  const m = economyModel({ population: 200, seed: 'integrity-post' });
  try {
    const e = m.econ, H = e.parts.households, bz = e.parts.businesses, db = e.db;
    const office = m.people.find(p => p && !p.retired && !p.vip && p.job?.kind === 'office' && bz.companyOf(p.job.b));
    const idle = m.people.find(p => p && !p.retired && !p.vip && p !== office && p.home);
    const cafe = bz.open().find(b => b.kind === 'cafe');
    assert.ok(office && idle && cafe);
    // the office worker is posted elsewhere all day (never at its desk); the other has no job and serves at a café counter
    office.job.days = 0; office.post = { b: cafe.b, f: cafe.f, id: 1, k: 0, since: 0 };
    idle.job = { kind: 'free', title: 'unemployed' }; idle.post = { b: cafe.b, f: cafe.f, id: 2, k: 0, since: 0 };
    const t = m.day + 0.01;
    for (const p of [office, idle]) for (let h = 0; h < 24; h++) H.onAct({ i: 0, p }, { kind: 'post', use: 'staff', b: cafe.b, f: cafe.f, holdStart: t, holdEnd: t + 3600 / 16 });   // an hour on post, 24 times (the model's sim seconds)
    m.step();
    const note = p => db.prepare(`SELECT p.note FROM econ_postings p JOIN econ_wallets w ON w.id = p.wallet WHERE w.owner_kind = 'resident' AND w.owner_id = ? ORDER BY p.rowid DESC LIMIT 1`).get(String(p.id))?.note || '';
    const wages = p => { const m2 = /wages \+([\d,.]+)/.exec(note(p)); return m2 ? Math.round(Number(m2[1].replace(/,/g, '')) * 100) : 0; };
    const shift = Math.min(16, office.job.end - office.job.start) + 0.5, pol = e.policy();
    assert.equal(wages(office), Math.floor(shift * bz.wageOf(bz.companyOf(office.job.b), 'office')), `its job's wages for a full shift (${note(office)})`);
    assert.equal(wages(idle), Math.floor(8.5 * bz.wageOf(cafe, pol.staffRole.cafe)), `the café pays its barista a day's shift (${note(idle)})`);
  } finally { m.close(); }
});
