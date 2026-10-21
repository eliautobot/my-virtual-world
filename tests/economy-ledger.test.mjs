// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Virtual Coin ledger (server/economy/ledger.js; docs/features/ECONOMY.md §2): balanced, atomic, idempotent,
// append-only and signed; holds, reversals, freezing; the money supply; reconciliation and the chain check finding
// changes made behind the server's back; thousands of transfers conserving every coin.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { Ledger, LedgerError, vc } from '../server/economy/ledger.js';

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-ledger-'));
  const dbs = openDb(dir), key = crypto.randomBytes(32);
  const L = new Ledger(dbs, { key: () => key });
  return { dir, dbs, L, key, close: () => { dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const code = fn => { try { fn(); } catch (e) { return e instanceof LedgerError ? e.code : `other:${e.message}`; } return null; };

test('ledger: wallets, balanced posting, faucets and sinks, the money supply', () => {
  const { L, close } = fresh();
  try {
    const faucet = L.ensure('system', 'econ', 'faucet:endowment'), sink = L.ensure('system', 'econ', 'sink:imports');
    const a = L.ensure('account', 1), b = L.ensure('account', 2);
    assert.equal(L.ensure('account', 1).id, a.id, 'the same subject, the same wallet');
    assert.equal(faucet.overdraft, 1); assert.equal(a.overdraft, 0); assert.equal(sink.overdraft, 0);
    const r = L.transfer(faucet.id, a.id, 50000, { kind: 'grant', actor: 'system:genesis', memo: 'Welcome' });
    assert.equal(r.postings.find(p => p.wallet === a.id).balance, 50000);
    assert.equal(L.wallet(a.id).balance, 50000);
    assert.equal(L.wallet(faucet.id).balance, -50000, 'a faucet goes negative: that is the money it made');
    L.post({ kind: 'purchase', actor: 'account:1', postings: [{ wallet: a.id, amount: -1000 }, { wallet: b.id, amount: 700 }, { wallet: sink.id, amount: 300 }] });
    const s = L.supply();
    assert.equal(s.total, 50000 - 300); assert.equal(s.issued, 50000); assert.equal(s.destroyed, 300);
    assert.equal(s.total, s.issued - s.destroyed, 'the supply is what was made less what was destroyed');
    assert.deepEqual(L.reconcile(), []);
    assert.equal(vc(1234), '12.34 VC'); assert.equal(vc(1200), '12 VC'); assert.equal(vc(-5), '−0.05 VC');
  } finally { close(); }
});

test('ledger: bad postings, overdrafts and closed doors are refused with nothing changed', () => {
  const { L, close } = fresh();
  try {
    const f = L.ensure('system', 'econ', 'faucet:test'), a = L.ensure('account', 1), b = L.ensure('account', 2);
    L.transfer(f.id, a.id, 1000, { actor: 'system:test' });
    const before = L.count().n;
    assert.equal(code(() => L.post({ kind: 'transfer', actor: 'account:1', postings: [{ wallet: a.id, amount: -100 }, { wallet: b.id, amount: 99 }] })), 'input', 'unbalanced');
    assert.equal(code(() => L.post({ kind: 'transfer', actor: 'account:1', postings: [{ wallet: a.id, amount: -1.5 }, { wallet: b.id, amount: 1.5 }] })), 'input', 'fractions');
    assert.equal(code(() => L.post({ kind: 'transfer', actor: 'account:1', postings: [{ wallet: a.id, amount: -1e15 }, { wallet: b.id, amount: 1e15 }] })), 'input', 'huge');
    assert.equal(code(() => L.post({ kind: 'transfer', actor: 'account:1', postings: [{ wallet: a.id, amount: 0 }, { wallet: b.id, amount: 0 }] })), 'input', 'zero');
    assert.equal(code(() => L.post({ kind: 'transfer', actor: 'account:1', postings: [{ wallet: a.id, amount: -5 }, { wallet: a.id, amount: 5 }] })), 'input', 'one wallet twice');
    assert.equal(code(() => L.post({ kind: 'transfer', actor: 'account:1', postings: [{ wallet: a.id, amount: -5 }] })), 'input', 'one posting');
    assert.equal(code(() => L.post({ kind: 'transfer', actor: '', postings: [{ wallet: a.id, amount: -5 }, { wallet: b.id, amount: 5 }] })), 'input', 'no actor');
    assert.equal(code(() => L.post({ kind: 'DROP TABLE', actor: 'account:1', postings: [{ wallet: a.id, amount: -5 }, { wallet: b.id, amount: 5 }] })), 'input', 'bad kind');
    assert.equal(code(() => L.transfer(a.id, 'w_nope', 5, { actor: 'account:1' })), 'not_found');
    assert.equal(code(() => L.transfer(a.id, b.id, 1001, { actor: 'account:1' })), 'funds', 'no overdraft');
    assert.equal(code(() => L.transfer(a.id, a.id, 1, { actor: 'account:1' })), 'input');
    assert.equal(code(() => L.transfer(a.id, b.id, -5, { actor: 'account:1' })), 'input');
    assert.equal(L.count().n, before, 'nothing was written');
    assert.equal(L.wallet(a.id).balance, 1000); assert.equal(L.wallet(b.id).balance, 0);
    // a three-way posting that would overdraw one wallet fails as a whole
    const c = L.ensure('account', 3);
    assert.equal(code(() => L.post({ kind: 'transfer', actor: 'account:1', postings: [{ wallet: a.id, amount: -500 }, { wallet: c.id, amount: -1 }, { wallet: b.id, amount: 501 }] })), 'funds');
    assert.equal(L.wallet(a.id).balance, 1000, 'no partial posting');
    assert.deepEqual(L.reconcile(), []);
  } finally { close(); }
});

test('ledger: idempotency keys replay the first result and refuse a different request', () => {
  const { L, close } = fresh();
  try {
    const f = L.ensure('system', 'econ', 'faucet:test'), a = L.ensure('account', 1), b = L.ensure('account', 2);
    L.transfer(f.id, a.id, 1000, { actor: 'system:test' });
    const one = L.transfer(a.id, b.id, 300, { actor: 'account:1', idem: 'pay-1', memo: 'lunch' });
    const two = L.transfer(a.id, b.id, 300, { actor: 'account:1', idem: 'pay-1', memo: 'lunch' });
    assert.equal(two.replay, true); assert.equal(two.seq, one.seq);
    assert.equal(L.wallet(a.id).balance, 700, 'paid once');
    assert.equal(code(() => L.transfer(a.id, b.id, 301, { actor: 'account:1', idem: 'pay-1', memo: 'lunch' })), 'idempotency_conflict');
    assert.equal(code(() => L.transfer(a.id, L.ensure('account', 9).id, 300, { actor: 'account:1', idem: 'pay-1', memo: 'lunch' })), 'idempotency_conflict');
  } finally { close(); }
});

test('ledger: holds set money aside; capture spends it, release gives it back, expiry releases it', () => {
  const { L, close } = fresh();
  try {
    const f = L.ensure('system', 'econ', 'faucet:test'), a = L.ensure('account', 1), b = L.ensure('account', 2);
    L.transfer(f.id, a.id, 1000, { actor: 'system:test' });
    const h = L.hold(a.id, 600, { purpose: 'offer', ref: 'o1' });
    assert.equal(L.available(a.id), 400);
    assert.equal(code(() => L.transfer(a.id, b.id, 401, { actor: 'account:1' })), 'funds', 'held money can\'t be spent');
    assert.equal(code(() => L.hold(a.id, 401, { purpose: 'offer', ref: 'o2' })), 'funds');
    assert.equal(code(() => L.hold(a.id, 1, { purpose: 'offer', ref: 'o1' })), 'conflict', 'one open hold per reference');
    const t = L.post({ kind: 'purchase', actor: 'account:1', capture: [h.id], postings: [{ wallet: a.id, amount: -600 }, { wallet: b.id, amount: 600 }] });
    assert.equal(L.wallet(a.id).balance, 400); assert.equal(L.wallet(a.id).held, 0);
    assert.equal(L.holdOf(h.id).status, 'captured'); assert.equal(L.holdOf(h.id).tx, t.seq);
    assert.equal(code(() => L.post({ kind: 'purchase', actor: 'account:1', capture: [h.id], postings: [{ wallet: a.id, amount: -1 }, { wallet: b.id, amount: 1 }] })), 'conflict', 'a hold is spent once');
    const h2 = L.hold(a.id, 300, { purpose: 'offer', ref: 'o3' });
    assert.equal(L.release(h2.id), true); assert.equal(L.release(h2.id), false);
    assert.equal(L.available(a.id), 400);
    // capture of part of a hold: the rest goes back to the wallet's available money
    const h3 = L.hold(a.id, 300, { purpose: 'offer', ref: 'o4' });
    L.post({ kind: 'purchase', actor: 'account:1', capture: [h3.id], postings: [{ wallet: a.id, amount: -100 }, { wallet: b.id, amount: 100 }] });
    assert.equal(L.wallet(a.id).balance, 300); assert.equal(L.wallet(a.id).held, 0);
    // expiry
    let now = Date.now();
    const L2 = new Ledger(L.dbs, { key: L._key, now: () => now });
    L2.hold(a.id, 50, { purpose: 'offer', ref: 'o5', expires: now + 1000 });
    assert.equal(L2.available(a.id), 250);
    now += 2000;
    assert.equal(L2.expireHolds(), 1);
    assert.equal(L2.available(a.id), 300);
    assert.deepEqual(L.reconcile(), []);
  } finally { close(); }
});

test('ledger: reversals, freezing, append-only rows', () => {
  const { L, dbs, close } = fresh();
  try {
    const f = L.ensure('system', 'econ', 'faucet:test'), a = L.ensure('account', 1), b = L.ensure('account', 2);
    L.transfer(f.id, a.id, 1000, { actor: 'system:test' });
    const t = L.transfer(a.id, b.id, 250, { actor: 'account:1' });
    const r = L.reverse(t.seq, { actor: 'admin:1', memo: 'Paid the wrong person' });
    assert.equal(L.wallet(a.id).balance, 1000); assert.equal(L.wallet(b.id).balance, 0);
    assert.equal(r.reverses, t.seq);
    assert.equal(code(() => L.reverse(t.seq, { actor: 'admin:1' })), 'conflict', 'once');
    assert.equal(code(() => L.reverse(r.seq, { actor: 'admin:1' })), 'input', 'a reversal is final');
    L.setFrozen(a.id, true, 'Reported stolen');
    assert.equal(code(() => L.transfer(a.id, b.id, 1, { actor: 'account:1' })), 'frozen');
    L.transfer(b.id === a.id ? f.id : f.id, a.id, 5, { actor: 'system:test' });   // money may still arrive
    L.transfer(a.id, b.id, 5, { actor: 'admin:1', force: true });               // an administrator's correction may move it
    L.setFrozen(a.id, false);
    L.transfer(a.id, b.id, 1, { actor: 'account:1' });
    assert.throws(() => dbs.db.prepare("UPDATE econ_tx SET memo = 'x'").run(), /append-only/);
    assert.throws(() => dbs.db.prepare('DELETE FROM econ_postings').run(), /append-only/);
    assert.throws(() => dbs.db.prepare('DELETE FROM econ_wallets').run(), /never deleted/);
    assert.throws(() => dbs.db.prepare(`UPDATE econ_wallets SET balance = -5 WHERE id = '${a.id}'`).run(), /CHECK/);
    assert.deepEqual(L.reconcile(), []);
  } finally { close(); }
});

test('ledger: the signed chain finds changes made outside the server; reconciliation finds drift', () => {
  const { L, dbs, key, close } = fresh();
  try {
    const f = L.ensure('system', 'econ', 'faucet:test'), a = L.ensure('account', 1), b = L.ensure('account', 2);
    L.transfer(f.id, a.id, 1000, { actor: 'system:test' });
    for (let k = 0; k < 20; k++) L.transfer(a.id, b.id, 10, { actor: 'account:1', memo: `n${k}` });
    assert.equal(L.verify().ok, true); assert.equal(L.verify().checked, 21);
    // someone with the database file (but not the key) changes a memo
    dbs.db.exec('DROP TRIGGER econ_tx_no_update');
    dbs.db.prepare("UPDATE econ_tx SET memo = 'forged' WHERE seq = 10").run();
    const v = L.verify();
    assert.equal(v.ok, false); assert.equal(v.brokenAt, 10);
    dbs.db.prepare("UPDATE econ_tx SET memo = 'n8' WHERE seq = 10").run();
    assert.equal(L.verify().ok, true);
    // a posting's amount changed: the chain breaks, and the balances drift
    dbs.db.exec('DROP TRIGGER econ_postings_no_update');
    dbs.db.prepare('UPDATE econ_postings SET amount = 999 WHERE tx = 5 AND amount > 0').run();
    assert.equal(L.verify().brokenAt, 5);
    const probs = L.reconcile();
    assert.ok(probs.some(p => p.kind === 'drift') && probs.some(p => p.kind === 'unbalanced_tx'));
    // a different key can't vouch for the chain
    const other = new Ledger(dbs, { key: () => crypto.randomBytes(32) });
    assert.equal(other.verify().ok, false);
    void key;
  } finally { close(); }
});

test('ledger: a transaction inside a failed outer transaction leaves nothing behind', () => {
  const { L, dbs, close } = fresh();
  try {
    const f = L.ensure('system', 'econ', 'faucet:test'), a = L.ensure('account', 1), b = L.ensure('account', 2);
    L.transfer(f.id, a.id, 1000, { actor: 'system:test' });
    const seen = [];
    L.listeners.add(ev => seen.push(ev.id));
    assert.throws(() => dbs.tx(() => { L.transfer(a.id, b.id, 300, { actor: 'account:1' }); throw new Error('the order failed'); }), /order failed/);
    assert.equal(L.wallet(a.id).balance, 1000, 'rolled back, and the cache knows');
    assert.equal(L.wallet(b.id).balance, 0);
    const ok = dbs.tx(() => L.transfer(a.id, b.id, 300, { actor: 'account:1' }));
    assert.equal(L.wallet(b.id).balance, 300);
    assert.equal(L.verify().ok, true, 'the chain continues from the committed transaction');
    return new Promise(res => setTimeout(() => { assert.deepEqual(seen, [ok.id], 'only the committed one was announced'); res(); }, 10));
  } finally { setTimeout(close, 30); }
});

test('ledger: 1,000 concurrent transfers between 50 wallets conserve every coin', async () => {
  const { L, close } = fresh();
  try {
    const f = L.ensure('system', 'econ', 'faucet:test');
    const ws = Array.from({ length: 50 }, (_, k) => L.ensure('account', k + 1));
    for (const w of ws) L.transfer(f.id, w.id, 100, { actor: 'system:test' });
    let ok = 0, refused = 0;
    const jobs = Array.from({ length: 1000 }, (_, k) => new Promise(res => setImmediate(() => {
      const from = ws[(k * 7) % 50], to = ws[(k * 13 + 1) % 50];
      try { if (from.id !== to.id) { L.transfer(from.id, to.id, 1 + (k % 30), { actor: 'account:1', idem: `j${k}` }); ok++; } } catch (e) { if (e.code === 'funds') refused++; else throw e; }
      res();
    })));
    await Promise.all(jobs);
    // the same 1,000 again: every one is a replay or still refused, nothing moves twice
    const total0 = ws.reduce((s, w) => s + L.wallet(w.id).balance, 0);
    for (let k = 0; k < 1000; k++) { const from = ws[(k * 7) % 50], to = ws[(k * 13 + 1) % 50]; try { if (from.id !== to.id) L.transfer(from.id, to.id, 1 + (k % 30), { actor: 'account:1', idem: `j${k}` }); } catch (e) { if (e.code !== 'funds') throw e; } }
    const total = ws.reduce((s, w) => s + L.wallet(w.id).balance, 0);
    assert.equal(total0, 5000); assert.equal(total, 5000, 'not one hundredth made or lost');
    assert.ok(ok > 500, `most went through (${ok}, ${refused} refused)`);
    for (const w of ws) assert.ok(L.wallet(w.id).balance >= 0);
    assert.deepEqual(L.reconcile(), []);
    assert.equal(L.verify().ok, true);
  } finally { close(); }
});
