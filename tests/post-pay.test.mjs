// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a position pays (server/economy/households.js payInfo and the settlement, 2026-10-28, the product owner: "every
// post should have a Pay ... the user picks a payment amount for that post/position"; "for world modules (admin
// controlled) the city pays. now for private/account businesses then the buisness or owner pays"; "If the buisness doesnt
// make enough and the user cant pay, the agent still maintains the post ... agents cant quit"), in the fast-forward
// economy: a seat's own rate pays whoever works it, the business there paying; at a world module's piece the city pays
// an agent on post there, for every hour on duty; at a place of the owner's with no business, nothing until the owner
// sets a rate, then from the owner's wallet; an owner who can't pay: the agent on post is owed, never quits, its owner
// told.
import test from 'node:test';
import assert from 'node:assert/strict';
import { economyModel } from './helpers/econ-model.mjs';
import { WorldIndex } from '../server/sim/windex.js';
import { isServiceDesk } from '../shared/catalog.js';

const partOf = (plan, walletId, label) => plan.wallets.get(walletId)?.parts?.get(label) || 0;

test('a seat\'s own rate pays whoever works it: the business there pays it', { timeout: 120000 }, () => {
  const m = economyModel({ population: 600, seed: 'post-pay-1' });
  try {
    const e = m.econ, bz = e.parts.businesses, H = e.parts.households;
    bz.sync();
    const p = m.people.find(x => x && !x.retired && x.job?.kind === 'staff' && x.job.venue !== 'lobby' && bz.at(x.job.b, x.job.f) && ((x.job.days ?? 31) & 1));
    assert.ok(p, 'a venue\'s worker');
    const j = p.job, key = `${j.b}:${j.f}:${j.id}:${j.k}`, biz = bz.at(j.b, j.f);
    const info0 = H.payInfo(j.b, j.f, j.id, j.k);
    assert.equal(info0.payer, 'business'); assert.equal(info0.set, false); assert.equal(info0.rate, info0.usual);
    m.world.postPay = { [key]: 2500 };   // (25 VC an hour)
    const info = H.payInfo(j.b, j.f, j.id, j.k);
    assert.deepEqual([info.rate, info.set, info.name], [2500, true, biz.name]);
    m.setDay(0); m.live();
    const R = H.days.get(0)?.res.get(p.id);
    assert.ok(R?.h > 0, 'it worked that day');
    const plan = H.plan(0), w = e.walletFor({ kind: 'resident', id: p.id }, 'main').id;
    const hours = Math.min(R.h, Math.min(16, j.end - j.start) + 0.5);
    assert.equal(partOf(plan, w, 'wages'), Math.floor(hours * 2500), 'paid at the seat\'s rate');
    assert.ok(partOf(plan, bz.wallet(biz).id, 'wages') <= -Math.floor(hours * 2500), 'by the business');
  } finally { m.close(); }
});

/** A floor with a counter, checkout or reception desk in a building with no business; an agent posted at it, on duty. */
function postedAgent(m, seed) {
  const bz = m.econ.parts.businesses, index = new WorldIndex(m.world);
  for (const B of m.world.buildings) {
    if (!B || B.gone || B.type === 'hq') continue;
    for (let f = 0; f < B.floors; f++) {
      const it = m.world.levels[B.lv[f]]?.items.find(x => isServiceDesk(x.t));
      const e = it ? index.entry(B.idx, f, it.id) : null, k = e?.slots.findIndex(s => s.use === 'staff');
      if (!e || k < 0) continue;
      const p = m.people.find(x => x && !x.retired && !x.vip);
      p.vip = 1; p.agentId = `agent-${seed}`; p.role = 'Host'; p.job = { kind: 'free', title: 'Host', prev: 'vip' };
      p.post = { b: B.idx, f, id: it.id, k, since: 0 };
      // (the building made one with no business: every place in the test city has one)
      const at0 = bz.at.bind(bz), co0 = bz.companyOf.bind(bz);
      bz.at = (b, ff) => (b === B.idx ? null : at0(b, ff)); bz.companyOf = b => (b === B.idx ? null : co0(b));
      return { p, B, f, it, k, i: m.people.indexOf(p) };
    }
  }
  return null;
}
const onDuty = (m, x, hours) => m.econ.parts.households.onAct({ i: x.i, p: x.p }, { kind: 'post', use: 'staff', b: x.B.idx, f: x.f, holdStart: m.day + 0.1, holdEnd: m.day + 0.1 + hours * 3600 / 16 });

test('a world module\'s position: the city pays the agent on post there, for every hour on duty', { timeout: 120000 }, () => {
  const m = economyModel({ population: 500, seed: 'post-pay-2' });
  try {
    const e = m.econ, H = e.parts.households;
    e.parts.businesses.sync();
    const x = postedAgent(m, 'city'); assert.ok(x, 'a piece in a building with no business');
    x.B.module = 'radio-1';
    const info = H.payInfo(x.B.idx, x.f, x.it.id, x.k);
    assert.equal(info.payer, 'city'); assert.ok(info.rate >= info.min);
    m.setDay(0); onDuty(m, x, 20);
    const plan = H.plan(0), w = e.walletFor(e.personSubject(x.p), 'main').id, T = e.treasury().id;
    const R = H.days.get(0).res.get(x.p.id);
    assert.ok(R.ph > 19, `20 hours on duty (${R.ph})`);
    const want = Math.floor(R.ph * info.rate);
    assert.equal(partOf(plan, w, 'wages'), want, 'paid for every hour on duty, past a day\'s shift');
    assert.ok(partOf(plan, T, 'wages') <= -want, 'by the city');
  } finally { m.close(); }
});

test('the owner\'s own place with no business: unpaid until its owner sets a rate; then from the owner\'s wallet; short, owed and never a quit', { timeout: 180000 }, () => {
  const m = economyModel({ population: 500, seed: 'post-pay-3' });
  try {
    const e = m.econ, bz = e.parts.businesses, H = e.parts.households, notes = [], quits = [];
    e.d.agentQuit = q => quits.push(q); e.d.agentUnpaid = n => notes.push(n);
    bz.sync();
    m.account(7, 'member');
    const x = postedAgent(m, 'own'); assert.ok(x);
    bz.ownerOfBuilding = B => (B === x.B ? { kind: 'account', id: '7' } : { kind: 'municipality', id: 'city' });
    let info = H.payInfo(x.B.idx, x.f, x.it.id, x.k);
    assert.deepEqual([info.payer, info.rate, info.free], ['owner', 0, true], 'unpaid until a rate is set');
    m.setDay(0); onDuty(m, x, 8);
    const aw = e.walletFor(e.personSubject(x.p), 'main').id;
    assert.equal(partOf(H.plan(0), aw, 'wages'), 0, 'nobody pays it');
    m.world.postPay = { [`${x.B.idx}:${x.f}:${x.it.id}:${x.k}`]: 1200 };
    info = H.payInfo(x.B.idx, x.f, x.it.id, x.k);
    assert.deepEqual([info.payer, info.rate], ['owner', 1200]);
    const ow = e.walletFor({ kind: 'account', id: '7' }, 'main').id, plan = H.plan(0), R = H.days.get(0).res.get(x.p.id);
    assert.equal(partOf(plan, aw, 'wages'), Math.floor(R.ph * 1200), 'paid at its rate');
    assert.equal(partOf(plan, ow, 'wages'), -Math.floor(R.ph * 1200), 'from the owner\'s wallet');
    // the owner's wallet empty: owed, unpaid days, its owner told; it never quits its post
    const drain = () => { const bal = e.ledger.wallet(ow).balance; if (bal > 0) e.ledger.transfer(ow, e.sink('imports').id, bal, { actor: 'system:test', memo: 'drain', system: true }); };
    for (let d = 0; d < 7; d++) { drain(); onDuty(m, x, 8); m.step(); }
    assert.equal(quits.length, 0, 'never quits');
    assert.ok(x.p.post, 'still on post');
    assert.ok(x.p.unpaid?.days >= 3 && notes.length >= 1, `unpaid ${x.p.unpaid?.days} days, its owner told ${notes.length}×`);
  } finally { m.close(); }
});
