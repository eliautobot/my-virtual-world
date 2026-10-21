// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Connections (server/connections.js, PLAN WP2.2; DECISIONS C60, A8, A9; CHECKLIST I8.7, I8.13, X11): who may add and see what,
// sealed credentials that never come back, shares, probes with scrubbed results, and the secret holder.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { RANK } from '../../server/auth/permissions.js';
import { Connections, ConnectionError, checkConfig } from '../../server/connections.js';
import { openDb } from '../../server/db.js';
import { BUILTIN_MANIFESTS } from '../../server/providers/manifest.js';
import { Registry } from '../../server/providers/registry.js';
import mock from '../../server/providers/mock.js';
import { registerSecretHolders } from '../../server/secret-holders.js';
import { SecretBox } from '../../server/secrets.js';
import { tempDir } from '../helpers/server.mjs';

const P = (id, role) => ({ account: { id, login: `u${id}` }, role });
const can = (p, cap) => cap === 'connections.use' ? (RANK[p.role] ?? 0) >= 1 : cap === 'connections.manage' ? (RANK[p.role] ?? 0) >= 2 : false;
const [member, other, admin, owner] = [P(2, 'member'), P(3, 'member'), P(4, 'admin'), P(1, 'owner')];
const manifest = id => BUILTIN_MANIFESTS.find(m => m.id === id);

function make({ hostFn } = {}) {
  const dbs = openDb(tempDir('mvw-conn-')), box = new SecretBox();
  box.setKeys([crypto.randomBytes(32)]);
  registerSecretHolders(box, dbs);
  const registry = new Registry({ allowTest: true });
  registry.adopt([mock.manifest, manifest('openclaw'), manifest('codex')]);
  const audit = { rows: [], log(a, o) { this.rows.push({ a, ...o }); } };
  const calls = [];
  const host = { call: async (kind, method, params) => { calls.push({ kind, method, params }); return hostFn ? hostFn(kind, method, params) : { ok: true, detail: 'fine' }; } };
  const conns = new Connections(dbs, { box, registry, host, can, audit });
  return { conns, dbs, box, registry, audit, calls };
}
const expect = (fn, status, code) => assert.throws(fn, e => e instanceof ConnectionError && e.status === status && (!code || e.code === code), `${status} ${code || ''}`);

test('a member adds a personal remote connection; only its owner sees it, not even an admin (I8.13, X11)', () => {
  const { conns } = make();
  const c = conns.create(member, { kind: 'openclaw', label: 'Mine', config: { url: 'ws://127.0.0.1:18789' }, secrets: { token: 'tok-12345678' } });
  assert.equal(c.scope, 'account'); assert.equal(c.ownerId, 2);
  assert.equal(conns.level(member, c), 'manage');
  for (const p of [other, admin, owner]) { assert.equal(conns.level(p, c), null); expect(() => conns.need(p, c.id), 404, 'not_found'); assert.equal(conns.visible(p).length, 0); }
  assert.equal(conns.visible(member).length, 1);
});

test('a member cannot add an installation-wide connection or one that runs a program on the server (A9, I8.13)', () => {
  const { conns } = make();
  expect(() => conns.create(member, { kind: 'openclaw', scope: 'installation', config: {}, secrets: { token: 'tok-12345678' } }), 403, 'forbidden');
  expect(() => conns.create(member, { kind: 'codex', scope: 'account', config: {} }), 403, 'host_process_is_infrastructure');
  expect(() => conns.create(member, { kind: 'codex', scope: 'installation', config: {} }), 403, 'forbidden');
  expect(() => conns.create(P(9, 'guest'), { kind: 'openclaw', config: {}, secrets: { token: 'tok-12345678' } }), 403, 'forbidden');
  expect(() => conns.create({ account: null, role: 'guest' }, { kind: 'openclaw' }), 401, 'signed_out');
  expect(() => conns.create(member, { kind: 'nonsense' }), 400, 'bad_kind');
});

test('an admin adds installation-wide connections of any kind and shares them with roles or accounts', () => {
  const { conns } = make();
  const c = conns.create(admin, { kind: 'openclaw', label: 'Shared', scope: 'installation', config: {}, secrets: { token: 'tok-12345678' } });
  const h = conns.create(admin, { kind: 'codex', scope: 'installation', config: {} });
  assert.equal(conns.kindOf(h), 'host-process');
  assert.equal(conns.level(member, c), null, 'not shared yet'); expect(() => conns.need(member, c.id), 404);
  conns.share(admin, c.id, 'account', '2');
  assert.equal(conns.level(member, c), 'use'); assert.equal(conns.level(other, c), null);
  conns.share(admin, c.id, 'role', 'member');
  assert.equal(conns.level(other, c), 'use', 'a role share covers the role');
  assert.equal(conns.level(admin, c), 'manage'); assert.equal(conns.level(owner, c), 'manage');
  expect(() => conns.update(member, c.id, { label: 'Hijack' }), 403, 'forbidden');
  expect(() => conns.share(member, c.id, 'role', 'guest'), 403, 'forbidden');
  const v = conns.view(member, c);
  assert.equal(v.level, 'use'); assert.equal(v.config, undefined); assert.equal(v.secrets, undefined); assert.equal(v.shares, undefined, 'users of a shared connection see no settings');
  assert.equal(conns.view(admin, c).shares.length, 2);
  conns.unshare(admin, c.id, 'role', 'member'); conns.unshare(admin, c.id, 'account', '2');
  assert.equal(conns.level(member, c), null);
  expect(() => conns.share(admin, c.id, 'role', 'nobody'), 400, 'bad_role');
  expect(() => conns.share(admin, c.id, 'account', 'x'), 400, 'bad_account');
  const mine = conns.create(member, { kind: 'openclaw', config: {}, secrets: { token: 'tok-12345678' } });
  expect(() => conns.share(member, mine.id, 'role', 'admin'), 400, 'not_shareable');
});

test('credentials are sealed, come back only as set or not set, and a blank keeps the stored value (I8.7)', () => {
  const { conns, dbs, audit } = make();
  const c = conns.create(member, { kind: 'openclaw', config: {}, secrets: { token: 'tok-SECRET-12345' } });
  const raw = dbs.db.prepare('SELECT sealed FROM connection_secrets WHERE connection_id = ?').get(c.id).sealed;
  assert.match(raw, /^v1:/); assert.equal(raw.includes('SECRET'), false, 'sealed, not stored plain');
  assert.deepEqual(conns.view(member, c).secrets, { token: true, password: false }, 'every credential field, as set or not');
  assert.equal(JSON.stringify(conns.view(member, c)).includes('SECRET'), false);
  conns.update(member, c.id, { label: 'Renamed', secrets: { token: '' } });
  assert.equal(conns.secretsFor(c.id).token, 'tok-SECRET-12345', 'blank keeps');
  conns.update(member, c.id, { secrets: { token: 'tok-NEW-9999999' } });
  assert.equal(conns.secretsFor(c.id).token, 'tok-NEW-9999999');
  expect(() => conns.update(member, c.id, { secrets: { token: null } }), 400, 'bad_setting');   // required
  expect(() => conns.update(member, c.id, { secrets: { nothere: 'x' } }), 400, 'bad_setting');
  assert.equal(JSON.stringify(audit.rows).includes('SECRET'), false); assert.equal(JSON.stringify(audit.rows).includes('NEW-999'), false, 'no credential in the audit trail');
  assert.deepEqual(audit.rows.filter(r => r.a === 'connection.update').at(-1).detail.secretsChanged, ['token'], 'only which field changed');
});

test('settings are checked against the manifest: unknown ones, bad web addresses and passwords in addresses are refused', () => {
  const m = manifest('openclaw');
  assert.deepEqual(checkConfig(m, { url: 'ws://127.0.0.1:18789', access: 'chat' }), { url: 'ws://127.0.0.1:18789/', access: 'chat' });
  assert.throws(() => checkConfig(m, { bogus: 1 }), /not a setting/);
  assert.throws(() => checkConfig(m, { url: 'not a url' }), /web address/);
  assert.throws(() => checkConfig(m, { url: 'file:///etc/passwd' }), /http, https, ws or wss/);
  assert.throws(() => checkConfig(m, { url: 'ws://user:pass@host' }), /credential field/);
  assert.throws(() => checkConfig(m, { access: 'sideways' }), /one of/);
  assert.throws(() => checkConfig(m, { token: 'x' }), /not a setting/, 'a credential is not a plain setting');
});

test('removing a connection drops its secrets and shares and unlinks its agents', () => {
  const { conns, dbs } = make();
  const c = conns.create(admin, { kind: 'openclaw', scope: 'installation', config: {}, secrets: { token: 'tok-12345678' } });
  conns.share(admin, c.id, 'role', 'member');
  const now = Date.now();
  dbs.db.prepare("INSERT INTO agents (world_id, agent_key, name, connection_id, created, updated) VALUES (?, 'ax', 'Ax', ?, ?, ?)").run(dbs.worldId, c.id, now, now);
  conns.remove(admin, c.id);
  assert.equal(conns.get(c.id), null);
  assert.equal(dbs.db.prepare('SELECT COUNT(*) n FROM connection_secrets').get().n, 0); assert.equal(dbs.db.prepare('SELECT COUNT(*) n FROM connection_shares').get().n, 0);
  assert.equal(dbs.db.prepare("SELECT connection_id c FROM agents WHERE agent_key = 'ax'").get().c, null);
});

test('test, refresh and discover go through the helper with the credentials; results are scrubbed and stored as the status', async () => {
  const { conns, calls } = make({ hostFn: (k, m, p) => ({ ok: true, detail: `connected with ${p.secrets.token}`, token: p.secrets.token, agents: [{ name: 'A', apiKey: 'zzz' }] }) });
  const c = conns.create(member, { kind: 'openclaw', config: {}, secrets: { token: 'tok-SECRET-12345' } });
  const out = await conns.probe(member, c.id, 'test');
  assert.equal(calls.at(-1).params.secrets.token, 'tok-SECRET-12345', 'the helper gets the credential');
  assert.equal(JSON.stringify(out).includes('SECRET'), false); assert.equal(out.token, undefined); assert.equal(out.agents[0].apiKey, undefined);
  assert.equal(out.detail, 'connected with [hidden]');
  assert.equal(conns.get(c.id).status.ok, true);
  const d = await conns.probe(member, c.id, 'discover');
  assert.equal(JSON.stringify(d).includes('SECRET'), false);
  await assert.rejects(() => conns.probe(other, c.id, 'test'), e => e.status === 404, 'a stranger cannot even probe');
  await assert.rejects(() => conns.probe(member, c.id, 'explode'), e => e.code === 'bad_action');
});

test('a kind whose adapter is not built yet says it does not work here; a failing helper becomes a stored, readable status', async () => {
  const a = make();
  const h = a.conns.create(admin, { kind: 'codex', scope: 'installation', config: {} });
  a.registry.adopt([]);   // nothing implemented
  const r = await a.conns.probe(admin, h.id, 'test');
  assert.equal(r.ok, false); assert.match(r.error, /isn't available on this server/); assert.doesNotMatch(r.error, /WP\d/); assert.equal(a.calls.length, 0, 'the helper is not asked');
  assert.match(JSON.stringify(a.conns.view(admin, a.conns.get(h.id))), /"arrivesIn":"WP2\.6"/);
  const b = make({ hostFn: () => { throw Object.assign(new Error('The provider helper is not running'), { code: 'host_down' }); } });
  const c = b.conns.create(member, { kind: 'openclaw', config: {}, secrets: { token: 'tok-12345678' } });
  const out = await b.conns.probe(member, c.id, 'test');
  assert.equal(out.ok, false); assert.equal(out.code, 'host_down'); assert.equal(b.conns.get(c.id).status.ok, false);
});

test('the secret holder: credentials are found, re-sealed after a key rotation and forgotten when unreadable', () => {
  const { conns, box, dbs } = make();
  const c = conns.create(member, { kind: 'openclaw', config: {}, secrets: { token: 'tok-ROTATE-12345' } });
  const h = box.holders.find(x => x.kind === 'connections');
  assert.ok(h, 'registered'); assert.equal(h.list().length, 1); assert.match(h.list()[0].label, /token of the connection/);
  const old = box.keys[0], fresh = crypto.randomBytes(32);
  box.setKeys([fresh, old]);
  box.reseal();
  assert.equal(conns.secretsFor(c.id).token, 'tok-ROTATE-12345', 'still readable after re-sealing');
  assert.equal(SecretBox.fingerprintOf(dbs.db.prepare('SELECT sealed FROM connection_secrets').get().sealed), box.fps[0], 're-sealed with the new key');
  h.forget(h.list()[0].id);
  assert.equal(dbs.db.prepare('SELECT COUNT(*) n FROM connection_secrets').get().n, 0);
});
