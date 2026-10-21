// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Jobs (shared/work.js, server/economy/jobs.js; docs/features/ECONOMY.md §8): orders made deterministically from a seed,
// scored from raw inputs only (a needle stopped too soon to be human scores nothing); a shift started at a venue, served
// order by order at a human pace, paid from the venue for the time worked × the stars, with tips and income tax; the
// residents it covered lose those hours at the settlement; experience, reputation and reviews; places that fill up,
// closed hours, one shift at a time; agents' automatic shifts at 80% of the wage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOrder, publicOrder, scoreStep, scoreOrder, needleAt, meterAt, ROLES, levelOf } from '../shared/work.js';
import { economyModel } from './helpers/econ-model.mjs';

/** The perfect report for a step (what a skilled player would send). */
function perfect(step) {
  if (step.kind === 'timing') { for (let t = 200; t < 20000; t += 7) if (Math.abs(needleAt(step, t) - step.target) < 0.01) return { t }; return { t: 200 }; }
  if (step.kind === 'meter') return { ms: Math.round(step.target * step.fill) };
  if (step.kind === 'choice') return { pick: step.answer };
  return { picks: step.order };
}

test('work games: deterministic orders, answers kept from the browser, scores from raw inputs', () => {
  for (const role of Object.keys(ROLES)) {
    const a = makeOrder(role, 'seed-1', 3), b = makeOrder(role, 'seed-1', 3), c = makeOrder(role, 'seed-1', 4);
    assert.deepEqual(a, b, `${role}: the same seed, the same order`);
    assert.notDeepEqual(a, c);
    const pub = publicOrder(a);
    for (const s of pub.steps) if (s.kind === 'choice') assert.equal(s.answer, undefined, 'the answer stays on the server');
    const r = scoreOrder(a, a.steps.map(perfect), a.expectMs * 0.6);
    assert.equal(r.stars, 5, `${role}: perfect play is five stars (${JSON.stringify(r)})`);
    const bad = scoreOrder(a, a.steps.map(() => ({ t: 50, ms: 50, pick: -1, picks: [] })), a.expectMs);
    assert.equal(bad.stars, 1); assert.equal(bad.tip, 0);
  }
  const o = makeOrder('barista', 's', 0), tm = o.steps.find(s => s.kind === 'timing');
  assert.equal(scoreStep(tm, { t: 80 }), 0, 'faster than a person can react scores nothing');
  assert.equal(scoreStep(tm, { t: 'x' }), 0);
  assert.ok(needleAt(tm, 0) >= 0 && needleAt(tm, 12345) <= 1);
  const seq = { kind: 'sequence', order: [2, 0, 1] };
  assert.equal(scoreStep(seq, { picks: [2, 0, 1] }), 1);
  assert.equal(Math.round(scoreStep(seq, { picks: [2, 1, 0] }) * 3), 1);
  assert.equal(scoreStep({ kind: 'meter', fill: 1000, target: 0.7, band: 0.1 }, { ms: 700 }), 1);
  assert.ok(meterAt({ fill: 1000 }, 5000) <= 1.2);
  assert.equal(levelOf(0), 1); assert.equal(levelOf(50), 2); assert.equal(levelOf(200), 3);
});

test('jobs: a shift - start, a human pace, scored orders, pay with tax, XP, trust, reviews, covered residents', () => {
  let clock = 1_000_000_000_000;
  const m = economyModel({ population: 600, seed: 'econ-jobs', jobs: true, now: () => clock });
  try {
    const e = m.econ, J = e.parts.jobs, bz = e.parts.businesses;
    e.hourOf = () => 12;   // midday: everything is open
    const cafe = bz.open().find(b => b.kind === 'cafe' && m.people.some(p => p.job?.kind === 'staff' && p.job.b === b.b && p.job.f === b.f));   // a café with residents on its staff
    const alice = { kind: 'account', id: 7 };
    e.walletFor({ kind: 'account', id: '7' });
    const start0 = e.ledger.walletOf('account', '7', 'main').balance;
    assert.throws(() => J.start(alice, { business: cafe.id, role: 'chef' }), /doesn't need/);
    let s = J.start(alice, { business: cafe.id, role: 'barista' });
    assert.equal(s.status, 'active'); assert.ok(s.order.steps.length >= 3);
    assert.throws(() => J.start(alice, { business: cafe.id, role: 'barista' }), /already working/);
    // too fast to be human: refused, the order stays
    const order = () => JSON.parse(e.db.prepare('SELECT state_json FROM econ_work WHERE id = ?').get(s.id).state_json).order;
    assert.throws(() => J.act(alice, { session: s.id, n: 0, reports: order().steps.map(perfect) }), e2 => e2.code === 'too_fast');
    // a walk-in (nobody bought yet): served and paid for the time, but no tip and no review
    clock += 9000;
    const w0 = J.act(alice, { session: s.id, n: 0, reports: order().steps.map(perfect) });
    assert.equal(w0.result.ticket, false); assert.equal(w0.result.tip, 0, 'a walk-in leaves no tip');
    // ten real customers buy coffee: their tickets are the next orders
    const buyers = m.people.filter(p => p && !p.retired && p.job?.kind !== 'staff').slice(0, 10);
    for (const p of buyers) J.ticket(cafe, { kind: 'resident', id: p.id, name: p.name }, ['coffee'], `visit:${p.id}`);
    assert.equal(J.waiting(cafe.id), 10, 'ten customers wait');
    // ten orders at a human pace, played well
    // (the order after the walk-in was handed out before they came: it is a walk-in too)
    let lastStars = 0, linked = 0;
    for (let n = 1; n < 12; n++) {
      clock += 9000;
      const r = J.act(alice, { session: s.id, n, reports: order().steps.map(perfect) });
      lastStars = r.result.stars; linked += r.result.ticket ? 1 : 0;
      assert.equal(r.session.served, n + 1);
    }
    assert.equal(lastStars, 5);
    assert.equal(linked, 10, 'every waiting customer was served'); assert.equal(J.waiting(cafe.id), 0);
    assert.throws(() => J.act(alice, { session: s.id, n: 3, reports: [] }), /already served/);
    assert.throws(() => J.act({ kind: 'account', id: 8 }, { session: s.id, n: 10, reports: [] }), /isn't yours/);
    const bw = bz.wallet(cafe), before = e.ledger.wallet(bw.id).balance, T0 = e.treasury().balance;
    const end = J.end(alice, { session: s.id });
    assert.ok(end.pay > 0, 'paid');
    assert.equal(end.hours, Math.round(108 / 3600 * 16 * 100) / 100, '108 seconds of work at the usual pace');
    const got = e.ledger.walletOf('account', '7', 'main').balance - start0, cost = before - e.ledger.wallet(bw.id).balance, tax = e.treasury().balance - T0;
    assert.equal(got, end.pay); assert.equal(cost + end.tips, got + tax, 'the venue paid the wage and its tax; the customers paid the tips');
    assert.ok(end.tips > 0, 'five-star orders earn tips from the customers who left them');
    assert.ok(end.tips <= Math.floor(end.gross * 0.6), 'tips at most 60% of the wages');
    assert.throws(() => J.end(alice, { session: s.id }), /already ended/);
    // experience, reputation, the ledger
    const me = J.of(alice);
    assert.equal(me.xp[0].role, 'barista'); assert.ok(me.xp[0].xp >= 60); assert.equal(me.active, null);
    assert.ok(me.trust.dims.work > 500, 'good work builds trust');
    assert.deepEqual(e.ledger.reconcile(), []);
    // the places fill up, closed hours are closed
    const slots = J.slotsOf(cafe).barista, workers = Array.from({ length: slots }, (_, k) => ({ kind: 'account', id: 100 + k }));
    for (const w of workers) J.start(w, { business: cafe.id, role: 'barista' });
    assert.throws(() => J.start({ kind: 'account', id: 99 }, { business: cafe.id, role: 'barista' }), e2 => e2.code === 'full');
    for (const w of workers) J.end(w, { session: J.of(w).active.id });
    e.hourOf = () => 3;
    assert.throws(() => J.start({ kind: 'account', id: 99 }, { business: cafe.id, role: 'barista' }), e2 => e2.code === 'closed');
    e.hourOf = () => 12;
    // an agent's automatic shift (spec 02 §9): only in a role it has played there, 30% of the wage, capped a day, no tips
    const agent = { kind: 'agent', id: 3 };
    assert.throws(() => J.start(agent, { business: cafe.id, role: 'barista', mode: 'auto' }), /by playing before/);
    const sp = J.start(agent, { business: cafe.id, role: 'barista' });
    const aorder = () => JSON.parse(e.db.prepare('SELECT state_json FROM econ_work WHERE id = ?').get(sp.id).state_json).order;
    for (let n = 0; n < 5; n++) { clock += 9000; J.act(agent, { session: sp.id, n, reports: aorder().steps.map(perfect) }); }
    J.end(agent, { session: sp.id });
    const sa = J.start(agent, { business: cafe.id, role: 'barista', mode: 'auto' });
    assert.throws(() => J.act(agent, { session: sa.id, n: 0, reports: [] }), /no orders/);
    clock += 30 * 60000;
    const ea = J.end(agent, { session: sa.id });
    const wage = bz.wageOf(cafe, 'barista');
    assert.equal(ea.gross, Math.min(12000, Math.floor(0.5 * 16 * wage * 0.3))); assert.equal(ea.tips, 0);
    // the daily cap: a second automatic shift the same day earns only what is left of it
    const sa2 = J.start(agent, { business: cafe.id, role: 'barista', mode: 'auto' });
    clock += 2 * 3600e3;
    const ea2 = J.end(agent, { session: sa2.id });
    assert.ok(ea.gross + ea2.gross <= 12000, `auto pay capped a day: ${ea.gross} + ${ea2.gross}`);
    assert.throws(() => J.start(alice, { business: cafe.id, role: 'barista', mode: 'auto' }), /agents may also/);
    // an idle shift is ended by the sweep and paid for the time it was worked
    const si = J.start(alice, { business: cafe.id, role: 'barista' });
    clock += 9000; J.act(alice, { session: si.id, n: 0, reports: JSON.parse(e.db.prepare('SELECT state_json FROM econ_work WHERE id = ?').get(si.id).state_json).order.steps.map(perfect) });
    clock += 4 * 60000; J.sweep();
    assert.equal(J.of(alice).active, null); assert.equal(J.of(alice).history[0].status, 'ended');
    // the residents the shifts covered aren't paid for those hours
    const covered = J.covered(e.econDay());
    assert.ok(covered.get(cafe.id) > 0);
    for (const p of m.people) if (p.job?.kind === 'staff' && p.job.b === cafe.b && p.job.f === cafe.f) e.parts.households._res(e.econDay(), p.id).h = 6;   // they came in today
    const r = m.step();
    assert.ok(r.s.covered > 0, 'the settlement took the covered hours off the café\'s residents');
    assert.deepEqual(e.ledger.reconcile(), []);
    assert.ok(J.reviews(cafe.id).length >= 1, 'customers wrote reviews');
  } finally { m.close(); }
});
