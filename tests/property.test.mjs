// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.13 property store: lots and titles in next.db with append-only history, idempotent revision-checked operations,
// holder/administrator rights (spec §5.0), merges up to 4 lots and unmerge, delegation, holds and the reconciliation
// check (wp4-world-spec.md §5, DECISIONS E25).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { Audit } from '../server/auth/audit.js';
import { Property, PropertyError, MUNICIPALITY } from '../server/property.js';
import { ftToUm } from '../shared/units.js';

const F = ftToUm;
const rect = (x0, z0, x1, z1) => [{ x: F(x0), z: F(z0) }, { x: F(x1), z: F(z0) }, { x: F(x1), z: F(z1) }, { x: F(x0), z: F(z1) }];
const admin = { admin: true, account: { id: 1, login: 'owner' } };
const alice = { subject: { kind: 'account', id: '2' }, account: { id: 2, login: 'alice' } };
const bob = { subject: { kind: 'account', id: '3' }, account: { id: 3, login: 'bob' } };
function make() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-prop-'));
  const dbs = openDb(dir), audit = new Audit(dbs);
  let t = 1_700_000_000_000;
  const P = new Property(dbs, { audit, now: () => ++t });
  return { dir, dbs, audit, P, close() { dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const grid = (P, cols, rows) => P.plat(Array.from({ length: cols * rows }, (_, k) => ({ poly: rect((k % cols) * 100, Math.floor(k / cols) * 100, (k % cols) * 100 + 100, Math.floor(k / cols) * 100 + 100), zoning: 'res' })), { actor: admin }).ids;
const code = fn => { try { fn(); return 'ok'; } catch (e) { if (e instanceof PropertyError) return e.code; throw e; } };

test('platting creates municipal lots with a grant in their history; overlapping or non-admin platting is refused', () => {
  const f = make();
  try {
    const ids = grid(f.P, 3, 2);
    assert.equal(ids.length, 6);
    const l = f.P.get(ids[0]);
    assert.equal(l.lifecycle, 'municipal'); assert.deepEqual(l.holder, MUNICIPALITY); assert.equal(l.areaTwice, 2n * BigInt(F(100)) ** 2n);
    assert.deepEqual(f.P.history(ids[0]).map(e => e.kind), ['grant']);
    assert.equal(code(() => f.P.plat([{ poly: rect(50, 50, 150, 150) }], { actor: admin })), 'overlap');
    assert.equal(code(() => f.P.plat([{ poly: rect(500, 0, 600, 100) }], { actor: alice })), 'rights');
    assert.equal(code(() => f.P.plat([{ poly: rect(500, 0, 600, 100) }, { poly: rect(550, 0, 650, 100) }], { actor: admin })), 'overlap', 'new lots overlapping each other');
    assert.equal(f.P.count(), 6, 'refused operations leave nothing behind');
    assert.deepEqual(f.P.reconcile(), []);
  } finally { f.close(); }
});

test('title history and lots are guarded by the database itself: no update, no delete', () => {
  const f = make();
  try {
    grid(f.P, 1, 1);
    assert.throws(() => f.dbs.db.exec("UPDATE title_events SET to_id = 'x'"), /append-only/);
    assert.throws(() => f.dbs.db.exec('DELETE FROM title_events'), /append-only/);
    assert.throws(() => f.dbs.db.exec('DELETE FROM lots'), /never deleted/);
  } finally { f.close(); }
});

test('transfer: administrators only, revision-checked, idempotent per key; a reused key with another request is refused', () => {
  const f = make();
  try {
    const [id] = grid(f.P, 1, 1);
    assert.equal(code(() => f.P.transfer(id, alice.subject, { actor: alice })), 'rights');
    const r1 = f.P.transfer(id, alice.subject, { actor: admin, key: 'k1', revision: 1, reason: 'Test grant' });
    assert.equal(r1.revision, 2);
    const again = f.P.transfer(id, alice.subject, { actor: admin, key: 'k1', revision: 1, reason: 'Test grant' });
    assert.equal(again.replayed, true, 'same key + same request → the stored result, nothing done twice');
    assert.equal(f.P.history(id).filter(e => e.kind === 'transfer').length, 1);
    assert.equal(code(() => f.P.transfer(id, bob.subject, { actor: admin, key: 'k1', revision: 2 })), 'idempotency');
    assert.equal(code(() => f.P.transfer(id, bob.subject, { actor: admin, revision: 1 })), 'stale', 'an old revision loses');
    const l = f.P.get(id);
    assert.deepEqual(l.holder, alice.subject); assert.equal(l.lifecycle, 'owned');
    assert.deepEqual(f.P.heldBy(alice.subject).map(x => x.id), [id]);
    assert.ok(f.audit.list({ action: 'property.transfer' }).length === 1, 'audited once');
  } finally { f.close(); }
});

test('holders merge up to 4 side-by-side lots; parents retire with lineage; unmerge restores them; others can\'t', () => {
  const f = make();
  try {
    const ids = grid(f.P, 4, 2);
    for (const id of ids) f.P.transfer(id, alice.subject, { actor: admin });
    assert.equal(code(() => f.P.merge([ids[0], ids[1]], { actor: bob })), 'rights');
    const m = f.P.merge([ids[0], ids[1]], { actor: alice, key: 'm1' });
    const lot = f.P.get(m.id);
    assert.equal(lot.origins, 2); assert.deepEqual(lot.parents, [ids[0], ids[1]]); assert.deepEqual(lot.holder, alice.subject);
    assert.equal(f.P.get(ids[0]).lifecycle, 'retired');
    assert.deepEqual(f.P.get(ids[0]).children, [m.id]);
    assert.equal(lot.areaTwice, 2n * 2n * BigInt(F(100)) ** 2n, 'area adds up exactly');
    assert.equal(code(() => f.P.merge([m.id, ids[2], ids[3]], { actor: alice })), 'ok', 'a merged pair plus two more = 4 originals');
    const big = f.P.heldBy(alice.subject).find(l => l.origins === 4);
    assert.equal(code(() => f.P.merge([big.id, ids[4]], { actor: alice })), 'limit');
    assert.equal(code(() => f.P.merge([ids[4], ids[6]], { actor: alice })), 'apart');
    const u = f.P.unmerge(big.id, { actor: alice });
    assert.deepEqual(u.ids.sort(), ids.slice(0, 4).sort(), 'splits back into the four original lots, through the earlier merge');
    assert.equal(code(() => f.P.unmerge(ids[4], { actor: alice })), 'lineage');
    assert.deepEqual(f.P.reconcile(), [], 'every invariant still holds');
    const all = f.P.all();
    assert.equal(all.reduce((s, l) => s + l.areaTwice, 0n), 8n * 2n * BigInt(F(100)) ** 2n, 'total area conserved through merges and splits');
  } finally { f.close(); }
});

test('unmerge is refused while a building stands across an original line', () => {
  const f = make();
  try {
    const ids = grid(f.P, 2, 1);
    for (const id of ids) f.P.transfer(id, alice.subject, { actor: admin });
    const m = f.P.merge(ids, { actor: alice });
    assert.equal(code(() => f.P.unmerge(m.id, { actor: alice, footprints: [rect(50, 10, 150, 90)] })), 'building');
    assert.equal(code(() => f.P.unmerge(m.id, { actor: alice, footprints: [rect(10, 10, 90, 90)] })), 'ok');
  } finally { f.close(); }
});

test('rights: holders do everything on their lot, delegates what they were given, admins act on municipal land only', () => {
  const f = make();
  try {
    const [a, b] = grid(f.P, 2, 1);
    f.P.transfer(a, alice.subject, { actor: admin });
    assert.ok(f.P.can(alice, a, 'build') && f.P.can(alice, a, 'merge'));
    assert.ok(!f.P.can(bob, a, 'build'));
    assert.ok(!f.P.can(admin, a, 'build'), 'administrators don\'t build on private land');
    assert.ok(f.P.can(admin, b, 'build'), 'administrators act for the municipality');
    assert.ok(!f.P.can(alice, b, 'build'));
    f.P.delegate(a, bob.subject, ['build', 'furnish'], { actor: alice });
    assert.ok(f.P.can(bob, a, 'build') && f.P.can(bob, a, 'furnish') && !f.P.can(bob, a, 'manage') && !f.P.can(bob, a, 'merge'));
    assert.equal(code(() => f.P.delegate(a, alice.subject, ['build'], { actor: bob })), 'rights');
    f.P.delegate(a, bob.subject, [], { actor: alice });
    assert.ok(!f.P.can(bob, a, 'build'), 'revoked');
    f.P.setAccess(a, 'private', { actor: alice });
    assert.equal(f.P.get(a).access, 'private');
    assert.equal(code(() => f.P.setAccess(a, 'public', { actor: bob })), 'rights');
    f.P.delegate(a, bob.subject, ['build'], { actor: alice });
    f.P.transfer(a, bob.subject, { actor: admin });
    assert.deepEqual(f.P.delegations(a), [], 'a new holder starts without inherited delegations');
  } finally { f.close(); }
});

test('custodial hold freezes the holder without taking the title; release restores it', () => {
  const f = make();
  try {
    const [a] = grid(f.P, 1, 1);
    f.P.transfer(a, alice.subject, { actor: admin });
    assert.equal(code(() => f.P.hold(a, { actor: admin })), 'input', 'a hold needs a reason');
    f.P.hold(a, { actor: admin, reason: 'Account deletion in progress' });
    const l = f.P.get(a);
    assert.equal(l.lifecycle, 'custodial'); assert.deepEqual(l.holder, alice.subject, 'title unchanged');
    assert.ok(!f.P.can(alice, a, 'build'));
    f.P.release(a, { actor: admin, reason: 'Kept' });
    assert.equal(f.P.get(a).lifecycle, 'owned');
    assert.deepEqual(f.P.history(a).map(e => e.kind), ['grant', 'transfer', 'custodial_hold', 'release_hold']);
  } finally { f.close(); }
});

test('a failure inside an operation leaves nothing behind (all or nothing)', () => {
  const f = make();
  try {
    const ids = grid(f.P, 2, 1);
    const before = f.P.history(ids[0]).length, lots = f.P.count();
    const orig = f.P._setTitle;
    f.P._setTitle = () => { throw new Error('crash mid-merge'); };
    assert.throws(() => f.P.merge(ids, { actor: admin }), /crash mid-merge/);
    f.P._setTitle = orig;
    assert.equal(f.P.count(), lots, 'no new lot');
    assert.equal(f.P.get(ids[0]).lifecycle, 'municipal', 'parents not retired');
    assert.equal(f.P.history(ids[0]).length, before, 'no history written');
    assert.deepEqual(f.P.reconcile(), []);
  } finally { f.close(); }
});
