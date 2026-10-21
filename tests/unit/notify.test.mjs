// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Notifications and Web Push (server/notify/; docs/features/CHAT.md §8): the message is encrypted so that only the
// browser can read it (RFC 8291 — decrypted here the way a browser does), the VAPID token is signed by the server's key
// for the push service's origin (RFC 8292 — verified here), only https addresses on the public internet are taken, and
// the store keeps, shows, pushes when nobody is looking, marks read, and drops a device the service says is gone.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { encrypt, vapidKeys, vapidAuth, checkSubscription } from '../../server/notify/push.js';
import { Notifications } from '../../server/notify/notifications.js';
import { SecretBox, newKey } from '../../server/secrets.js';
import { openDb } from '../../server/db.js';
import { tempDir } from '../helpers/server.mjs';

/** A browser's side: its key pair and secret, and decryption of an aes128gcm push message (RFC 8291 §3, RFC 8188). */
function browser() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    sub: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
    decrypt(body) {
      const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
      assert.equal(rs, 4096);
      const shared = ecdh.computeSecret(as), ua = ecdh.getPublicKey();
      const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
      const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
      const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
      const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      assert.equal(plain[plain.length - 1], 2, 'the last record\'s delimiter');
      return plain.subarray(0, plain.length - 1).toString();
    },
  };
}

test('a pushed message is readable only by the browser it was encrypted for', () => {
  const b = browser(), other = browser();
  const body = encrypt(Buffer.from('{"title":"an agent asks for your OK"}'), b.sub.p256dh, b.sub.auth);
  assert.equal(b.decrypt(body), '{"title":"an agent asks for your OK"}');
  assert.throws(() => other.decrypt(body), /Unsupported state|auth/i, 'another browser cannot');
  const again = encrypt(Buffer.from('x'), b.sub.p256dh, b.sub.auth);
  assert.notDeepEqual(again.subarray(0, 16), body.subarray(0, 16), 'a new salt and key every time');
  assert.throws(() => encrypt(Buffer.from('x'), 'AAAA', b.sub.auth), e => e.code === 'bad_subscription');
});

test('the VAPID token: ES256 by the server\'s key, for the push service\'s origin, for 12 hours', () => {
  const k = vapidKeys();
  const h = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', k, 'mailto:admin@example.com', 1_700_000_000_000);
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
  assert.ok(m); assert.equal(m[4], k.publicKey);
  const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: 1_700_000_000 + 43200, sub: 'mailto:admin@example.com' });
  const pub = Buffer.from(k.publicKey, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.equal(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), true);
});

test('only https push addresses on the public internet are taken (tests may name this machine)', () => {
  const b = browser();
  const ok = checkSubscription({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', keys: b.sub });
  assert.equal(ok.endpoint, 'https://updates.push.services.mozilla.com/wpush/v2/x');
  for (const ep of ['http://push.example.com/x', 'https://127.0.0.1/x', 'https://[fd00::5]/x', 'https://[::1]/x', 'https://u:p@push.example.com/x', 'javascript:alert(1)', 'x'.repeat(1001)]) {
    assert.throws(() => checkSubscription({ endpoint: ep, keys: b.sub }), e => e.code === 'bad_subscription', ep);
  }
  assert.throws(() => checkSubscription({ endpoint: 'https://push.example.com/x', keys: { p256dh: 'AAAA', auth: b.sub.auth } }), e => e.code === 'bad_subscription');
  assert.equal(checkSubscription({ endpoint: 'http://127.0.0.1:9/x', keys: b.sub }, { allowLocal: true }).local, true);
});

test('the store: kept, shown at once, pushed only when no page is open, read, and a gone device dropped', async () => {
  const dir = tempDir('mvw-notify-'), dbs = openDb(dir), box = new SecretBox(); box.setKeys([newKey()]);
  const frames = [], pushes = [];
  let online = true, reply = 201;
  const N = new Notifications(dbs, { box, send: (id, f) => frames.push([id, f]), online: () => online, subject: () => 'mailto:a@b.c', allowLocal: true,
    push: async (sub, msg) => { pushes.push([sub.endpoint, msg]); return { status: reply }; } });
  const k1 = N.publicKey();
  assert.equal(N.publicKey(), k1, 'made once');
  assert.equal(new Notifications(dbs, { box, send: () => {}, online: () => true, subject: () => '' }).publicKey(), k1, 'kept sealed, read back');
  assert.ok(!JSON.stringify(dbs.db.prepare("SELECT value FROM settings WHERE key = 'secret:push.vapid'").get()).includes('PRIVATE KEY'), 'never in the clear');
  const b = browser();
  assert.equal(N.subscribe(7, { endpoint: 'http://127.0.0.1:9/push/1', keys: b.sub }, 'Chrome on Android').devices, 1);
  N.create(7, { kind: 'approval', title: 'an agent asks for your OK', body: 'Buy a coffee — 3 VC', link: { approval: 'ap1', agent: 3 } });
  assert.equal(frames.at(-1)[1].n.title, 'an agent asks for your OK'); assert.equal(frames.at(-1)[1].unread, 1);
  assert.equal(pushes.length, 0, 'a page is open: not pushed');
  online = false;
  N.create(7, { kind: 'chat', title: 'Adam answered', body: 'Here is your plan', link: { agent: 3, session: 9 } });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(pushes.at(-1), ['http://127.0.0.1:9/push/1', { title: 'Adam answered', body: 'Here is your plan', url: '/?chat=3:9', tag: 'chat:3:9' }]);
  let l = N.list(7);
  assert.deepEqual([l.unread, l.notifications.length, l.devices, l.notifications[1].link.approval], [2, 2, 1, 'ap1']);
  assert.deepEqual(N.list(8).notifications, [], 'another account sees none');
  N.read(7, { approval: 'ap1' }); assert.equal(N.list(7).unread, 1, 'an answered approval is read');
  N.read(7, { agent: 3, session: 9 }); assert.equal(N.list(7).unread, 0, 'an opened chat is read');
  reply = 410;
  N.create(7, { kind: 'note', title: 'Hi', body: '' });
  await new Promise(r => setImmediate(r));
  assert.equal(N.list(7).devices, 0, 'a device the service says is gone is dropped');
  for (let i = 0; i < 230; i++) N.create(7, { kind: 'note', title: `n${i}` }, { push: false });
  assert.equal(N.list(7, { limit: 100 }).notifications.length, 100); assert.equal(dbs.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE account_id = 7').get().n, 200, 'kept: the newest 200');
  assert.throws(() => N.subscribe(7, { endpoint: 'https://[fd00::1]/x', keys: b.sub }), e => e.code === 'bad_subscription');
});

test('one agent\'s notifications (the chat window\'s Notifications): only its own, its own unread count, marked read together', () => {
  const dir = tempDir('mvw-notify-'), dbs = openDb(dir), box = new SecretBox(); box.setKeys([newKey()]);
  const N = new Notifications(dbs, { box, send: () => {}, online: () => true, subject: () => 'mailto:a@b.c' });
  N.create(7, { kind: 'approval', title: 'an agent asks for your OK', link: { approval: 'ap1', agent: 13 } });
  N.create(7, { kind: 'chat', title: 'Adam answered', link: { agent: 2, session: 9 } });
  N.create(7, { kind: 'note', title: 'an agent', body: 'Rent is due', link: { agent: 13 } });
  N.create(7, { kind: 'system', title: 'Welcome' });
  N.create(8, { kind: 'note', title: 'an agent (someone else\'s)', link: { agent: 13 } });
  const acon = N.list(7, { agent: 13 });
  assert.deepEqual(acon.notifications.map(n => n.title), ['an agent', 'an agent asks for your OK'], 'its own, newest first');
  assert.deepEqual([acon.agent, acon.agentUnread, acon.unread], [13, 2, 4], 'its unread, and the account\'s');
  assert.equal(N.list(7).agentUnread, undefined, 'the bell\'s list: every agent\'s');
  assert.deepEqual(N.list(7, { agent: 'x' }).notifications.length, 4, 'a bad agent: the whole list');
  N.read(7, { agent: 13 });
  assert.deepEqual([N.list(7, { agent: 13 }).agentUnread, N.list(7).unread], [0, 2], 'its own marked read together; the others stay');
  dbs.close();
});
