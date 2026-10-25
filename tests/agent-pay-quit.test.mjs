// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An AI agent's pay from its employer's own wallet (server/economy/households.js agentPay, 2026-10-23, the product owner:
// "the business's own wallet, that way users are kinda forced or atleast encorgade to make profitable businesses";
// "unpaid for days" it quits), in the fast-forward economy: an agent a player's company can't pay has an unpaid day each
// day it is paid less than half; after the policy's days in a row it quits (the server told); a day paid resets it; the
// city stands behind its own businesses, so an agent there is paid. And where agents are placed (server/sim/placement.js):
// only work a business pays for, never the employer it quit, until its days are over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { economyModel } from './helpers/econ-model.mjs';
import { placeAgents } from '../server/sim/placement.js';
import { WorldIndex } from '../server/sim/windex.js';

/** Makes resident p an AI agent's body, at its work (an office desk becomes an agent's). */
function agentAt(p, key) { p.vip = 1; p.agentId = key; p.role = 'Analyst'; if (p.job.kind === 'office') p.job.kind = 'vip'; }

test('a company that can\'t pay: unpaid days, then the agent quits; the city\'s own pays; a paid day resets', { timeout: 120000 }, () => {
  const m = economyModel({ population: 600, seed: 'agent-pay' });
  try {
    const e = m.econ, bz = e.parts.businesses, quits = [];
    e.d.agentQuit = q => quits.push(q);
    bz.sync();
    // an office worker at a company made a player's and broke; a café or shop's worker at a venue of the city's
    const a = m.people.find(p => p && !p.retired && p.job?.kind === 'office' && bz.companyOf(p.job.b));
    const c = m.people.find(p => p && !p.retired && p.job?.kind === 'staff' && p.job.venue !== 'lobby' && bz.at(p.job.b, p.job.f));
    assert.ok(a && c, 'an office worker at a company, a venue\'s worker');
    agentAt(a, 'agent-broke'); agentAt(c, 'agent-city');
    const broke = bz.companyOf(a.job.b);
    broke.owner_kind = 'account'; broke.owner_id = '7';                 // (a player's: no city support)
    broke.settings = { ...(broke.settings || {}), wages: { vip: 1e9, office: 1e9 } };  // (wages it can't meet)
    const drain = () => { const w = bz.wallet(broke), bal = e.ledger.walletOf('business', broke.id, 'business')?.balance ?? w.balance ?? 0; if (bal > 0) e.ledger.transfer(w.id, e.sink('imports').id, bal, { actor: 'system:test', force: true }); };
    const after = e.policy().agents.quitAfterDays;
    assert.equal(after, 3, 'the default: three days');
    for (let d = 1; d < after; d++) {
      drain(); m.step();
      assert.equal(a.unpaid?.days, d, `day ${d}: unpaid (${JSON.stringify(a.unpaid)})`);
      assert.equal(c.unpaid, undefined, 'the city\'s company pays its agent');
    }
    drain(); m.step();
    assert.equal(quits.length, 1, 'it quits on the third day');
    assert.equal(quits[0].p, a);
    assert.equal(quits[0].biz.id, broke.id);
    assert.equal(quits[0].days, after);
    assert.equal(a.unpaid, undefined, 'its count cleared');
    // a paid day resets the count
    a.unpaid = { biz: broke.id, days: 2 };
    broke.owner_kind = 'municipality'; broke.owner_id = 'city'; broke.settings = { ...broke.settings, wages: {} };
    m.step();
    assert.equal(a.unpaid, undefined, 'paid again: the count is gone');
    assert.equal(quits.length, 1);
  } finally { m.close(); }
});

test('placement: only work a business pays for; never the employer it quit while its days last', () => {
  const m = economyModel({ population: 400, seed: 'agent-place-pay' });
  try {
    const W = m.world, people = m.people, index = new WorldIndex(W);
    const p = people.find(x => x && !x.retired && x.job?.kind === 'office');
    agentAt(p, 'agent-mover');
    const quitB = p.job.b;
    p.job = { kind: 'free', title: 'Analyst', seek: 1, prev: 'vip' };
    p.quit = { b: quitB, untilDay: 15 };
    const places = { townOf: () => 'main', holderOf: () => 'city', flat: () => null, base: () => ({ town: 'main', x: W.buildings[quitB].x, z: W.buildings[quitB].z }), today: 10 };
    const i = people.indexOf(p);
    placeAgents(W, index, people, [{ i, owner: null }], places);
    const B = W.buildings[p.job.b], L = W.levels[B.lv[p.job.f]];
    assert.notEqual(p.job.b, quitB, 'not the employer it quit (though nearest)');
    assert.ok(B.type === 'office' || B.type === 'hq' || ['cafe', 'restaurant', 'shop', 'gym'].includes(L?.venue), `work a business pays for (${B.type}, ${L?.venue})`);
    // its days over: it may go back
    p.job = { kind: 'free', title: 'Analyst', seek: 1, prev: 'vip' };
    placeAgents(W, index, people, [{ i, owner: null }], { ...places, today: 15 });
    assert.equal(p.quit, undefined, 'the days over: forgotten');
  } finally { m.close(); }
});

test('work its owner gave it (a job, a post) it never quits: it tells its owner instead, every few days', { timeout: 120000 }, () => {
  const m = economyModel({ population: 600, seed: 'agent-pay-kept' });
  try {
    const e = m.econ, bz = e.parts.businesses, quits = [], notes = [];
    e.d.agentQuit = q => quits.push(q); e.d.agentUnpaid = n => notes.push(n);
    bz.sync();
    const staff = m.people.filter(p => p && !p.retired && p.job?.kind === 'office' && bz.companyOf(p.job.b));
    const [given, posted] = staff;
    agentAt(given, 'agent-given'); agentAt(posted, 'agent-posted');
    given.job.pin = 1;                                                       // (its owner gave it this desk)
    posted.post = { b: posted.job.b, f: posted.job.f, id: posted.job.id, k: posted.job.k, since: 1 };   // (on post there)
    const broke = bz.companyOf(given.job.b);
    broke.owner_kind = 'account'; broke.owner_id = '7';
    broke.settings = { ...(broke.settings || {}), wages: { vip: 1e9, office: 1e9 } };
    const drain = () => { const w = bz.wallet(broke), bal = e.ledger.walletOf('business', broke.id, 'business')?.balance ?? 0; if (bal > 0) e.ledger.transfer(w.id, e.sink('imports').id, bal, { actor: 'system:test', force: true }); };
    for (let d = 1; d <= 14 && (given.unpaid?.days || 0) < 7; d++) { drain(); m.step(); }   // (days it works: not its weekends)
    assert.equal(quits.length, 0, 'neither quits');
    assert.equal(given.job.b, broke.b, 'still at the desk it was given');
    assert.ok(posted.post, 'still on post');
    const days = who => notes.filter(n => n.p === who).map(n => n.days);
    assert.deepEqual(days(given), [3, 6], 'it tells its owner on day 3, then day 6');
    assert.deepEqual(days(posted), [3, 6]);
    assert.equal(notes.find(n => n.p === posted).post, true);
    assert.equal(given.unpaid.days, 7, 'still counting');
  } finally { m.close(); }
});
