// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Web Push (docs/features/CHAT.md §8): a notification to a phone or a browser that isn't open, through the push
// service its browser chose (Google's, Mozilla's, Apple's…) — the standard protocol, on node's own crypto, no library:
//   VAPID (RFC 8292): the server's own P-256 key pair; each request carries a short ES256-signed token for the push
//   service's origin, so only this server can push to the subscriptions it was given.
//   Encryption (RFC 8291, aes128gcm, RFC 8188): the message is encrypted for the browser's own key (p256dh) and secret
//   (auth); the push service sees only ciphertext.
// The address a browser gives is someone else's: it must be https on the public internet, checked on every connection
// (a name that later points inside is refused), never followed elsewhere. A subscription the service says is gone
// (404, 410) is dropped by the caller.
import crypto from 'node:crypto';
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { privateAddress } from '../providers/models.js';

const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s || ''), 'base64url');
export const PAYLOAD_MAX = 3000;   // bytes of message (a push service takes 4 KB with the encryption's overhead)

/** A new VAPID key pair: { publicKey (65-byte uncompressed point, base64url), privateKey (PKCS#8 PEM) }. */
export function vapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { publicKey: b64u(rawPublic(publicKey)), privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }) };
}
function rawPublic(keyObject) {
  const j = keyObject.export({ format: 'jwk' });
  return Buffer.concat([Buffer.from([4]), unb64u(j.x), unb64u(j.y)]);
}

/** The Authorization header for one request to `endpoint`: vapid t=<ES256 JWT for its origin>, k=<public key>. */
export function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: crypto.createPrivateKey(keys.privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** The message encrypted for one subscription (aes128gcm: salt, record size, the server's one-time public key, the
 *  ciphertext of the message and its end-of-record byte). */
export function encrypt(payload, p256dh, auth, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || ua[0] !== 4) throw Object.assign(new Error('The subscription\'s key is not a P-256 public key'), { code: 'bad_subscription' });
  if (secret.length !== 16) throw Object.assign(new Error('The subscription\'s secret is not 16 bytes'), { code: 'bad_subscription' });
  const e = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) e.generateKeys();
  const as = e.getPublicKey();
  const shared = e.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = as.length;
  return Buffer.concat([header, as, body]);
}

/** Whether a subscription a browser gave is one we may use: { endpoint: https://…, keys: { p256dh, auth } }. */
export function checkSubscription(sub, { allowLocal = false } = {}) {
  const fail = m => Object.assign(new Error(m), { code: 'bad_subscription' });
  if (!sub || typeof sub !== 'object') throw fail('No subscription');
  const ep = String(sub.endpoint || '');
  if (ep.length > 1000) throw fail('The push address is too long');
  let u; try { u = new URL(ep); } catch { throw fail('The push address is not a web address'); }
  const local = allowLocal && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw fail('The push address must use https');
  if (u.username || u.password) throw fail('The push address can\'t carry a password');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!local && net.isIP(host) && privateAddress(host)) throw fail('The push address is not on the public internet');
  const p = unb64u(sub.keys?.p256dh), a = unb64u(sub.keys?.auth);
  if (p.length !== 65 || p[0] !== 4 || a.length !== 16) throw fail('The subscription\'s keys are not valid');
  return { endpoint: u.href, p256dh: b64u(p), auth: b64u(a), local };
}

function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, list) => {
    if (err) return cb(err);
    const ok = (list || []).filter(x => !privateAddress(x.address));
    if (!ok.length || ok.length !== list.length) return cb(Object.assign(new Error('That push service is not on the public internet'), { code: 'blocked' }));
    if (options && options.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

/**
 * Sends one message to one subscription: { status } — 201 delivered, 404/410 gone (drop it), anything else a failure.
 * o: { ttl (seconds the service keeps it for a device that is away), urgency, topic (a later message with the same
 * topic replaces it), allowLocal (tests only) }.
 */
export function send(sub, payload, keys, subject, { ttl = 86400, urgency = 'normal', topic = null, allowLocal = false, timeoutMs = 10000 } = {}) {
  const s = checkSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, { allowLocal });
  const data = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  if (data.length > PAYLOAD_MAX) return Promise.reject(Object.assign(new Error('The message is too long to push'), { code: 'too_long' }));
  const body = encrypt(data, s.p256dh, s.auth);
  const u = new URL(s.endpoint), lib = u.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm', 'Content-Length': body.length, TTL: String(ttl), Urgency: urgency,
        ...(topic ? { Topic: String(topic).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}), Authorization: vapidAuth(s.endpoint, keys, subject) },
      ...(s.local ? {} : { lookup: guardedLookup, autoSelectFamily: false }),
    }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
    req.on('timeout', () => req.destroy(Object.assign(new Error('The push service did not answer'), { code: 'timeout' })));
    req.on('error', e => reject(e.code ? e : Object.assign(e, { code: 'network' })));
    req.end(body);
  });
}
