// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agent registry (server/agents.js, PLAN WP2.1, I8.8, I8.12, E20): records, ownership, shares, the boot sync of
// residents that are agents already, and the rule that the registry never reads inside the opaque references.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agents, AgentError, peopleResolver, emptyExt } from '../../server/agents.js';
import { openDb } from '../../server/db.js';
import { tempDir } from '../helpers/server.mjs';

const PEOPLE = [
  { id: 'n1', name: 'Citizen', vip: 0, app: { skin: 3 } },
  { id: 'vip-a1', name: 'Ada', vip: 1, emoji: '🤖', role: 'Builder', agentId: 'a1', app: { skin: 1 } },
  { id: 'vip-a2', name: 'Bo', vip: 1, emoji: '🧠', role: 'Analyst', agentId: 'a2', app: { skin: 2 } },
];
const P = (id, role) => ({ account: { id, login: `u${id}` }, role });
function make(people = PEOPLE) {
  const dbs = openDb(tempDir('mvw-agents-')), audit = { rows: [], log(a, o) { this.rows.push({ a, ...o }); } };
  const reg = new Agents(dbs, { audit, resolver: peopleResolver(() => people) });
  return { reg, audit, dbs };
}

test('residents that are agents already get records once; the sync is idempotent (I8.8)', () => {
  const { reg } = make();
  assert.equal(reg.sync(PEOPLE), 2);
  assert.equal(reg.sync(PEOPLE), 0, 'nothing more on the next boot');
  assert.deepEqual(reg.list().map(a => a.key), ['a1', 'a2'], 'in registry order, citizens are not agents');
  const a = reg.byKey('a1');
  assert.equal(a.ownerId, null, 'the installation owner, resolved when asked'); assert.equal(a.bodyRef, 'person:vip-a1'); assert.equal(a.enabled, true);
});

test('the record is ready for the economy: a stable id and a reserved, versioned extension object (E20)', () => {
  const { reg, dbs } = make();
  reg.sync(PEOPLE);
  const a = reg.byKey('a2');
  assert.ok(Number.isInteger(a.id), 'a stable subject id');
  assert.deepEqual(a.ext, emptyExt()); assert.equal(a.ext.v, 1);
  const cols = dbs.db.prepare('PRAGMA table_info(agents)').all().map(c => c.name);
  for (const c of ['wallet', 'balance', 'coin', 'vc', 'contract', 'licence', 'xp', 'rep', 'civic']) assert.equal(cols.some(x => x.includes(c)), false, `no ${c} column: the economy gets its own tables`);
  assert.ok(cols.includes('ext_json') && cols.includes('body_ref') && cols.includes('look_ref') && cols.includes('desk_json'));
});

test('the registry never reads inside the opaque references: only the resolver does (E20)', () => {
  const { reg } = make();
  const weird = { format: 'v9-rework', anything: [1, 2, 3] };
  const a = reg.create({ key: 'x1', name: 'Xi', bodyRef: 'body://future/42', lookRef: JSON.stringify(weird), desk: { any: 'shape' } });
  assert.equal(a.bodyRef, 'body://future/42'); assert.equal(a.lookRef, JSON.stringify(weird), 'stored and returned untouched');
  assert.deepEqual(a.desk, { any: 'shape' });
  const b = reg.update(a.id, { name: 'Xi2' });
  assert.equal(b.bodyRef, 'body://future/42'); assert.equal(b.lookRef, a.lookRef, 'an update does not disturb them');
  const r = peopleResolver(() => PEOPLE);
  assert.equal(r.resolveBody('person:vip-a2'), 2); assert.equal(r.resolveBody('body://future/42'), -1, 'a reference the resolver does not know is not an error here');
  assert.deepEqual(r.resolveLook('person:vip-a1'), { skin: 1 });
});

test('create, update, remove keep the record for history; duplicates and bad input are refused', () => {
  const { reg, audit } = make();
  const a = reg.create({ key: 'k1', name: '  <b>Kay</b>  ', role: 'Tester' }, { id: 1, login: 'owner' });
  assert.equal(a.name, 'bKay/b', 'markup characters stripped');
  assert.throws(() => reg.create({ key: 'k1', name: 'Again' }), e => e instanceof AgentError && e.code === 'exists');
  assert.throws(() => reg.create({ key: 'k2', name: '' }), e => e.code === 'bad_name');
  assert.throws(() => reg.update(999, {}), e => e.status === 404);
  reg.update(a.id, { role: 'Lead', enabled: false });
  assert.equal(reg.get(a.id).role, 'Lead'); assert.equal(reg.enabled().length, 0);
  reg.remove(a.id);
  assert.equal(reg.get(a.id), null, 'gone from the list');
  assert.equal(reg.q.byId.get(reg.w, a.id).deleted !== null, true, 'the row stays so history still resolves');
  assert.deepEqual(audit.rows.map(r => r.a), ['agent.create', 'agent.update', 'agent.remove']);
});

test('who may use and manage: owners manage, shares give use or manage, roles count upwards, an admin alone gets nothing (I8.12)', () => {
  const { reg } = make();
  const own = reg.create({ key: 'o1', name: 'Owned', ownerId: 5 });
  const inst = reg.create({ key: 'i1', name: 'Platform' });   // owner_id null: the installation owner
  assert.equal(reg.level(P(5, 'member'), own), 'manage');
  assert.equal(reg.level(P(6, 'member'), own), null);
  assert.equal(reg.level(P(7, 'admin'), own), null, 'an admin\'s role alone grants nothing');
  assert.equal(reg.level(P(1, 'owner'), inst), 'manage'); assert.equal(reg.level(P(6, 'admin'), inst), null);
  assert.equal(reg.level(null, own), null); assert.equal(reg.level({ account: null, role: 'guest' }, own), null);
  reg.share(own.id, 'account', '6', 'use');
  assert.equal(reg.level(P(6, 'member'), own), 'use'); assert.equal(reg.canManage(P(6, 'member'), own), false);
  reg.share(own.id, 'account', '6', 'manage');
  assert.equal(reg.canManage(P(6, 'member'), own), true, 'the level of an existing share is replaced');
  reg.share(own.id, 'role', 'admin', 'use');
  assert.equal(reg.level(P(7, 'admin'), own), 'use'); assert.equal(reg.level(P(8, 'owner'), own), 'use', 'a role share covers the roles above');
  assert.equal(reg.level(P(9, 'member'), own), null, 'but not below');
  assert.deepEqual(reg.usable(P(7, 'admin')).map(a => a.key), ['o1']);
  reg.unshare(own.id, 'account', '6');
  assert.equal(reg.level(P(6, 'member'), own), null);
  assert.throws(() => reg.share(own.id, 'role', 'nobody', 'use'), e => e.code === 'bad_role');
  assert.throws(() => reg.share(own.id, 'account', 'x', 'use'), e => e.code === 'bad_account');
  assert.throws(() => reg.share(own.id, 'account', '1', 'root'), e => e.code === 'bad_level');
  reg.remove(own.id);
  assert.equal(reg.q.shares.all(reg.w, own.id).length, 0, 'removing an agent removes its shares');
});

test('a disabled agent is not offered for use', () => {
  const { reg } = make();
  const a = reg.create({ key: 'd1', name: 'Dee', ownerId: 3 });
  assert.equal(reg.usable(P(3, 'member')).length, 1);
  reg.update(a.id, { enabled: false });
  assert.equal(reg.usable(P(3, 'member')).length, 0);
});
