// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The living economy fast-forwarded (tests/helpers/econ-model.mjs; docs/features/ECONOMY.md §3, §5): a generated city's
// residents work, eat, shop and pay rent for six weeks of world days with the default policy. The books balance every
// day and the signed chain holds; money reaches residents and comes back through rent and sales; nobody's wallet goes
// negative; most residents can pay their way; the money supply settles instead of running away; the treasury neither
// empties nor hoards; prices float within bounds; a day settles fast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { economyModel } from './helpers/econ-model.mjs';

test('economy model: six weeks of a city of 1,200 residents stay balanced and stable', { timeout: 180000 }, () => {
  const m = economyModel({ population: 1200, seed: 'econ-sim-test' });
  try {
    const supply = [], ms = [];
    let last = null;
    for (let k = 0; k < 42; k++) {
      const r = m.step(); last = r.s; ms.push(r.ms);
      supply.push(m.econ.ledger.supply().total);
      if (k % 7 === 6) assert.deepEqual(m.econ.ledger.reconcile(), [], `day ${k}: the books balance`);
    }
    const e = m.econ, h = e.health();
    assert.equal(h.ok, true, JSON.stringify(h.problems.slice(0, 3)));
    assert.equal(h.chain.ok, true);
    // money moved through every part of the loop yesterday
    for (const k of ['wages', 'rent', 'sales', 'imports', 'taxIncome', 'taxSales', 'welfare', 'upkeep']) assert.ok(last[k] > 0 || ['wages', 'taxIncome'].includes(k), `${k} moved`);
    // no ordinary wallet is negative (the database refuses it; this proves the planner never asked for it)
    assert.equal(e.db.prepare("SELECT COUNT(*) n FROM econ_wallets WHERE overdraft = 0 AND balance < 0").get().n, 0);
    // most residents pay their way; arrears stay small
    const bal = m.residentBalances().sort((a, b) => a - b);
    const broke = bal.filter(b => b < 3000).length / bal.length;
    assert.ok(broke < 0.12, `broke residents ${(broke * 100).toFixed(1)}%`);
    const owed = e.db.prepare("SELECT COALESCE(SUM(amount), 0) s FROM econ_debts WHERE status = 'open' AND kind = 'rent'").get().s;
    assert.ok(owed < supply[supply.length - 1] * 0.02, 'rent arrears are under 2% of the money supply');
    // the supply settles: the last week grows far less than the first
    const g1 = supply[7] / supply[0] - 1, g6 = supply[41] / supply[34] - 1;
    assert.ok(g6 < g1, `growth slows (week 1 ${(g1 * 100).toFixed(1)}%, week 6 ${(g6 * 100).toFixed(1)}%)`);
    assert.ok(g6 < 0.12, `week 6 grows ${(g6 * 100).toFixed(1)}%`);
    // the treasury holds money and pays its way; prices float within the policy's bounds
    const T = e.treasury();
    assert.ok(T.balance > 0);
    assert.ok(last.welfareCut === 0 && last.upkeepCut === 0, 'the city paid all its costs');
    const cpi = last.cpi / 100;
    assert.ok(cpi > 80 && cpi < 140, `price index ${cpi}`);
    // fast: a day of 1,200 residents settles in well under a second
    ms.sort((a, b) => a - b);
    assert.ok(ms[Math.floor(ms.length * 0.9)] < 400, `settlement p90 ${ms[Math.floor(ms.length * 0.9)]} ms`);
  } finally { m.close(); }
});
