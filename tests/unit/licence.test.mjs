// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Licence keys (server/licence.js, PLAN WP1.11, I15.1, I15.3) against an in-process fake Lemon Squeezy: activation,
// the product check, the refusals, deactivation, offline use forever (E19), the sealed receipt and the release 1
// carry-over without a new activation (C109). The real key is never used here.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Licence, LicenceError, STORE_ID, PRODUCT_IDS, LS_API, DEMO_AGENTS, LOCKS, mask, BUY_URL } from '../../server/licence.js';
import { SecretBox, newKey } from '../../server/secrets.js';
import { openDb } from '../../server/db.js';
import { tempDir } from '../helpers/server.mjs';

const KEY = 'AAAA1111-BBBB-2222-CCCC-3333DDDD4444';
// The fake licence server: keys and what it answers for them; every call is recorded.
const fake = { calls: [], keys: new Map(), down: false };
function meta(o = {}) {
  return { store_id: Number(STORE_ID), product_id: PRODUCT_IDS[0], product_name: 'My Virtual World', variant_id: 7, variant_name: 'Early Bird',
    customer_name: 'Test Customer', customer_email: 'test@example.invalid', ...o };
}
function reset() {
  fake.calls = []; fake.down = false; fake.broken = false; fake.keys = new Map([
    [KEY, { status: 'active', meta: meta(), instances: new Set(['inst-old']), next: 1 }],
    ['EXPIRED-KEY-0000', { error: 'This license key is expired.' }],
    ['DISABLED-KEY-000', { error: 'This license key is disabled.' }],
    ['LIMIT-KEY-000000', { error: 'This license key has reached the activation limit.' }],
    ['OTHER-STORE-KEY0', { status: 'active', meta: meta({ store_id: 999 }), instances: new Set(), next: 1 }],
    ['OTHER-PRODUCT-K0', { status: 'active', meta: meta({ product_id: 42 }), instances: new Set(), next: 1 }],
    ['FULL-KEY-0000000', { status: 'active', meta: meta({ variant_name: 'Default', product_name: 'My Virtual World' }), instances: new Set(), next: 1 }],
  ]);
}
let srv, api;
before(async () => {
  reset();
  srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; }).on('end', () => {
      const what = req.url.split('/').pop(), p = Object.fromEntries(new URLSearchParams(body));
      fake.calls.push({ what, ...p, ctype: req.headers['content-type'] });
      const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (fake.down) { req.socket.destroy(); return; }
      if (fake.broken) { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<html>Bad gateway</html>'); return; }
      const k = fake.keys.get(p.license_key);
      if (!k) return send(404, { error: 'license_key not found.' });
      if (k.error) return send(400, { error: k.error, activated: false, valid: false });
      if (what === 'activate') {
        const id = `inst-${k.next++}`; k.instances.add(id);
        return send(200, { activated: true, error: null, instance: { id, name: p.instance_name }, meta: k.meta, license_key: { status: k.status } });
      }
      if (what === 'validate') {
        if (!k.instances.has(p.instance_id)) return send(404, { valid: false, error: 'license_key instance not found.' });
        return send(200, { valid: true, error: null, instance: { id: p.instance_id }, meta: k.meta, license_key: { status: k.status } });
      }
      if (what === 'deactivate') {
        if (!k.instances.delete(p.instance_id)) return send(404, { deactivated: false, error: 'license_key instance not found.' });
        return send(200, { deactivated: true, error: null, meta: k.meta });
      }
      return send(404, { error: 'no such call' });
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${srv.address().port}/v1/licenses`;
});
after(() => srv?.close());

function make({ key = newKey(), dir = tempDir('mvw-lic-'), a = api } = {}) {
  const box = new SecretBox(); box.setKeys([key]);
  const dbs = openDb(dir), audit = { rows: [], log(action, o) { this.rows.push({ action, ...o }); } };
  return { lic: new Licence(dbs, { box, audit, api: a, timeoutMs: 2000 }), dbs, box, audit, dir, key };
}
const refused = async (p, code) => {
  await assert.rejects(p, e => { assert.ok(e instanceof LicenceError, e.message); assert.equal(e.code, code, e.message); return true; });
};

test('the defaults are the product\'s own: Lemon Squeezy, store 321733, product 1140366, 3 agents in demo mode', () => {
  assert.equal(LS_API, 'https://api.lemonsqueezy.com/v1/licenses');
  assert.equal(STORE_ID, '321733');
  assert.deepEqual([...PRODUCT_IDS], [1140366]);
  assert.equal(DEMO_AGENTS, 3);
  assert.deepEqual(Object.keys(LOCKS).sort(), ['agents.more', 'edit']);
  assert.ok(Object.isFrozen(PRODUCT_IDS) && Object.isFrozen(LOCKS), 'nothing can change them at run time');
});

test('where to buy a key: the product\'s own Lemon Squeezy checkout, in the status for demo mode and licensed alike', () => {
  assert.equal(BUY_URL, 'https://myvirtualoffice.lemonsqueezy.com/checkout/buy/47d3437d-0969-40bd-ba22-a00c886a898f');
  reset();
  const { lic } = make();
  assert.equal(lic.status().buyUrl, BUY_URL, 'demo mode links to it');
});

test('demo mode until a key is active: every lock stands and the status says why (I15.2)', () => {
  reset();
  const { lic } = make();
  assert.equal(lic.active, false);
  for (const k of Object.keys(LOCKS)) assert.equal(lic.locked(k), true, k);
  const s = lic.status();
  assert.equal(s.mode, 'demo'); assert.equal(s.agentLimit, 3); assert.match(s.message, /licence key unlocks/);
});

test('activating a key: one activation for the installation, sealed, then unlocked (I15.1)', async () => {
  reset();
  const { lic, dbs, audit } = make();
  const s = await lic.activate(`  ${KEY}  `, { id: 1, login: 'owner' });
  assert.equal(s.active, true); assert.equal(s.tier, 'EARLY'); assert.equal(s.tierName, 'Early Bird');
  assert.equal(s.key, mask(KEY)); assert.equal(s.key.includes(KEY.slice(5, 20)), false, 'the owner sees the key masked');
  const call = fake.calls.find(c => c.what === 'activate');
  assert.equal(call.license_key, KEY, 'trimmed before sending');
  assert.equal(call.instance_name, 'My Virtual World');
  assert.match(call.ctype, /x-www-form-urlencoded/);
  for (const k of Object.keys(LOCKS)) assert.equal(lic.locked(k), false, k);
  const row = dbs.db.prepare("SELECT value FROM settings WHERE key = 'secret:licence.receipt'").get();
  assert.ok(row, 'kept in the secret store');
  assert.equal(row.value.includes(KEY), false, 'sealed: the key is not in the database in the clear');
  assert.equal(row.value.includes('Test Customer'), false);
  const pub = lic.status();
  assert.equal(JSON.stringify(pub).includes(KEY), false, 'the public status carries no key');
  assert.equal(JSON.stringify(pub).includes('Test Customer'), false, 'nor customer details');
  assert.ok(audit.rows.some(r => r.action === 'licence.activate' && !JSON.stringify(r).includes(KEY)), 'recorded without the key');
  await refused(lic.activate('FULL-KEY-0000000'), 'already_active');
});

test('once activated it works offline forever: no re-check, even with the licence server gone (E19)', async () => {
  reset();
  const ctx = make();
  await ctx.lic.activate(KEY);
  const n = fake.calls.length;
  // a new process on the same data and key, with the licence server unreachable
  const again = new Licence(openDb(ctx.dir), { box: ctx.box, api: 'http://127.0.0.1:9/v1/licenses', timeoutMs: 300 });
  assert.equal(again.active, true);
  assert.equal(again.locked('edit'), false);
  const far = new Licence(openDb(ctx.dir), { box: ctx.box, api: 'http://127.0.0.1:9/v1/licenses', now: () => Date.now() + 10 * 365 * 86400000 });
  assert.equal(far.active, true, 'ten years later it is still licensed');
  assert.equal(fake.calls.length, n, 'nothing was asked of the licence server');
});

test('the receipt only opens with this installation\'s key and in its own place', async () => {
  reset();
  const ctx = make();
  await ctx.lic.activate(KEY);
  const other = new SecretBox(); other.setKeys([newKey()]);
  assert.equal(new Licence(openDb(ctx.dir), { box: other }).active, false, 'another key cannot open it: demo mode');
  // a sealed value copied into another place (the AAD) does not open either
  const dbs = openDb(ctx.dir), v = dbs.db.prepare("SELECT value FROM settings WHERE key = 'secret:licence.receipt'").get().value;
  dbs.db.prepare("UPDATE settings SET key = 'secret:something.else' WHERE key = 'secret:licence.receipt'").run();
  dbs.db.prepare("INSERT INTO settings (world_id, key, value) VALUES (?, 'secret:licence.receipt', ?)").run(dbs.worldId, ctx.box.seal(v, 'wrong-place'));
  assert.equal(new Licence(openDb(ctx.dir), { box: ctx.box }).active, false);
});

test('refused keys say why: wrong store, wrong product, expired, disabled, limit, invalid, unreachable (I15.1)', async () => {
  reset();
  const { lic } = make();
  await refused(lic.activate('OTHER-STORE-KEY0'), 'wrong_product');
  assert.equal(fake.keys.get('OTHER-STORE-KEY0').instances.size, 0, 'a key of another store gets its activation back');
  await refused(lic.activate('OTHER-PRODUCT-K0'), 'wrong_product');
  assert.equal(fake.keys.get('OTHER-PRODUCT-K0').instances.size, 0, 'and so does another product\'s');
  await refused(lic.activate('EXPIRED-KEY-0000'), 'expired');
  await refused(lic.activate('DISABLED-KEY-000'), 'disabled');
  await refused(lic.activate('LIMIT-KEY-000000'), 'activation_limit');
  await refused(lic.activate('NO-SUCH-KEY-0000'), 'invalid_key');
  await refused(lic.activate(''), 'bad_key');
  await refused(lic.activate('has spaces inside'), 'bad_key');
  fake.down = true;
  await refused(lic.activate(KEY), 'unreachable');
  fake.down = false;
  assert.equal(lic.active, false, 'still demo mode after every refusal');
  const s = make({ a: 'http://127.0.0.1:9/v1/licenses' });
  await refused(s.lic.activate(KEY), 'unreachable');
});

test('a full licence is FULL; deactivating frees the activation and returns to demo mode (I15.1)', async () => {
  reset();
  const { lic, audit } = make();
  const s = await lic.activate('FULL-KEY-0000000');
  assert.equal(s.tier, 'FULL'); assert.equal(s.tierName, 'Full License');
  assert.equal(fake.keys.get('FULL-KEY-0000000').instances.size, 1);
  const d = await lic.deactivate({ id: 1, login: 'owner' });
  assert.equal(d.freed, true); assert.equal(d.active, false);
  assert.equal(fake.keys.get('FULL-KEY-0000000').instances.size, 0, 'freed with Lemon Squeezy (release 1 only deleted its file)');
  assert.equal(lic.locked('edit'), true);
  assert.ok(audit.rows.some(r => r.action === 'licence.deactivate'));
  await refused(lic.deactivate(), 'not_active');
});

test('deactivation with the licence server down keeps the licence, unless the owner removes it anyway', async () => {
  reset();
  const { lic } = make();
  await lic.activate(KEY);
  fake.down = true;
  await refused(lic.deactivate(), 'deactivate_failed');
  assert.equal(lic.active, true, 'nothing lost when it could not be freed');
  const d = await lic.deactivate(null, { force: true });
  assert.equal(d.freed, false); assert.equal(lic.active, false);
  fake.down = false;
});

test('a release 1 receipt carries over without a new activation (I15.3, C109)', async () => {
  reset();
  const { lic, dir, audit } = make();
  const old = { key: KEY, instanceId: 'inst-old', tier: 'EARLY', activated: true, activatedAt: '2026-06-17T05:02:22Z', customerName: 'x' };
  const r1 = tempDir('mvw-r1-');
  fs.writeFileSync(path.join(r1, 'license.json'), JSON.stringify(old));
  const s = await lic.importRelease1(r1, { id: 1, login: 'owner' });
  assert.equal(s.active, true); assert.equal(s.imported, true); assert.equal(s.tier, 'EARLY');
  assert.deepEqual(fake.calls.map(c => c.what), ['validate'], 'validated only: no activation was used');
  assert.equal(fake.calls[0].instance_id, 'inst-old', 'with release 1\'s own activation id');
  assert.equal(fake.keys.get(KEY).instances.size, 1, 'the activation count did not change');
  assert.ok(audit.rows.some(r => r.action === 'licence.import'));
  assert.equal(new Licence(openDb(dir), { box: lic.box }).active, true, 'kept, sealed, like an activation');
  fs.rmSync(r1, { recursive: true, force: true });
});

test('carry-over refuses what does not hold: a foreign activation, another product, no receipt, not activated', async () => {
  reset();
  const { lic } = make();
  await refused(lic.importReceipt({ key: KEY, instanceId: 'inst-somebody-else', activated: true }), 'invalid_key');
  fake.keys.get('OTHER-PRODUCT-K0').instances.add('i1');
  await refused(lic.importReceipt({ key: 'OTHER-PRODUCT-K0', instanceId: 'i1', activated: true }), 'wrong_product');
  await refused(lic.importReceipt({ key: 'EXPIRED-KEY-0000', instanceId: 'i1', activated: true }), 'expired');
  await refused(lic.importReceipt({ key: KEY, instanceId: 'inst-old', activated: false }), 'no_receipt');
  await refused(lic.importReceipt(null), 'no_receipt');
  await refused(lic.importRelease1(tempDir('mvw-empty-')), 'no_receipt');
  await refused(lic.importRelease1('/no/such/folder'), 'not_found');
  assert.equal(lic.active, false);
});

test('a receipt imported on the host reaches a running server within about a second', async () => {
  reset();
  const ctx = make();
  let changed = 0;
  ctx.lic.listeners.add(() => changed++);
  let t = 1000;
  const running = new Licence(openDb(ctx.dir), { box: ctx.box, api, now: () => t });
  running.listeners.add(() => changed++);
  assert.equal(running.active, false);
  await ctx.lic.importReceipt({ key: KEY, instanceId: 'inst-old', activated: true });
  assert.equal(running.active, false, 'not re-read within the second');
  t += 1500;
  assert.equal(running.active, true, 'then it is');
  assert.equal(changed, 2, 'and both said the licence changed');
});

test('while online it asks now and then: a valid activation stays; offline or an outage changes nothing (E19)', async () => {
  reset();
  const ctx = make();
  await ctx.lic.activate(KEY);
  assert.deepEqual(await ctx.lic.recheck(), { checked: true, valid: true });
  fake.down = true;
  assert.equal((await ctx.lic.recheck()).checked, false); assert.equal(ctx.lic.active, true, 'offline: still licensed');
  fake.down = false; fake.broken = true;
  for (let i = 0; i < 3; i++) assert.equal((await ctx.lic.recheck()).ended, undefined);
  assert.equal(ctx.lic.active, true, 'an outage\'s error page: still licensed');
});

test('a clear refusal twice, an hour apart, ends the licence: activation removed, key disabled, a receipt never activated', async () => {
  for (const how of ['removed', 'disabled', 'forged']) {
    reset();
    let t = Date.UTC(2026, 9, 21, 12);
    const dir = tempDir('mvw-lic-'), box = new SecretBox(); box.setKeys([newKey()]);
    const audit = { rows: [], log(action, o) { this.rows.push({ action, ...o }); } };
    const lic = new Licence(openDb(dir), { box, audit, api, timeoutMs: 2000, now: () => t });
    if (how === 'forged') lic.store({ key: 'MADE-UP-KEY-1234', instanceId: 'inst-made-up', tier: 'FULL', storeId: STORE_ID, productId: PRODUCT_IDS[0], activated: true });
    else await lic.activate(KEY);
    if (how === 'removed') fake.keys.get(KEY).instances.clear();
    if (how === 'disabled') fake.keys.get(KEY).status = 'disabled';
    const first = await lic.recheck();
    assert.equal(first.ended, false, `${how}: the first refusal only warns`);
    assert.equal(lic.active, true);
    t += 20 * 60000;
    assert.equal((await lic.recheck()).ended, false, `${how}: not within the hour`);
    t += 45 * 60000;
    const second = await lic.recheck();
    assert.equal(second.ended, true, `${how}: ended (${second.why})`);
    assert.equal(lic.active, false); assert.equal(lic.locked('edit'), true, `${how}: demo mode again`);
    assert.ok(audit.rows.some(r => r.action === 'licence.ended'), `${how}: audited`);
  }
});

test('a refusal followed by a valid answer starts over', async () => {
  reset();
  let t = Date.UTC(2026, 9, 21, 12);
  const dir = tempDir('mvw-lic-'), box = new SecretBox(); box.setKeys([newKey()]);
  const lic = new Licence(openDb(dir), { box, api, timeoutMs: 2000, now: () => t });
  await lic.activate(KEY);
  const inst = [...fake.keys.get(KEY).instances].at(-1);
  fake.keys.get(KEY).instances.delete(inst);
  assert.equal((await lic.recheck()).ended, false);
  fake.keys.get(KEY).instances.add(inst);
  t += 2 * 3600000;
  assert.equal((await lic.recheck()).valid, true);
  fake.keys.get(KEY).instances.delete(inst);
  t += 2 * 3600000;
  assert.equal((await lic.recheck()).ended, false, 'counted afresh');
  assert.equal(lic.active, true);
});
