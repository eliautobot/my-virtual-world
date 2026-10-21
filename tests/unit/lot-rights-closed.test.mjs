// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Lot rights fail closed (step 8, 2026-10-08): an edit op the rights table doesn't name is the administrators' - one added
// later never opens to lot holders by omission.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LotRights } from '../../server/lot-rights.js';

test('an op with no rights named is the administrators\' only', () => {
  const R = new LotRights({ count: () => 1, get: () => null, can: () => true }, () => ({ buildings: [] }));
  const member = { admin: false, subject: { kind: 'account', id: '7' } }, admin = { admin: true, subject: { kind: 'account', id: '1' } };
  assert.match(R.check({ op: 'something.new', b: 0 }, member) || '', /Only administrators/);
  assert.equal(R.check({ op: 'something.new', b: 0 }, admin), null);
});
