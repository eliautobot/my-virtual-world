// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Two-factor sign-in: TOTP (RFC 6238, HMAC-SHA-1, 30-second steps, 6 digits, as every authenticator app expects) and
// recovery codes. Their secrets are sealed by the secret store (server/secrets.js, DECISIONS C85).
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('not base32');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) for a counter. */
export function hotp(key, counter, digits = 6, algorithm = 'sha1') {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac(algorithm, key).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}
export const STEP = 30;
export const stepAt = (ms, step = STEP) => Math.floor(ms / 1000 / step);
/** TOTP (RFC 6238) at a time in milliseconds. */
export const totp = (key, ms, { digits = 6, step = STEP, algorithm = 'sha1' } = {}) => hotp(key, stepAt(ms, step), digits, algorithm);

/**
 * Checks a 6-digit code against the steps around now (one step of clock drift either way). Returns the matching step,
 * or null. Steps at or before lastStep are refused, so a code works only once.
 */
export function verifyTotp(key, code, ms, lastStep = 0, window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now = stepAt(ms);
  for (let d = -window; d <= window; d++) {
    const s = now + d;
    if (s <= lastStep) continue;
    const want = Buffer.from(hotp(key, s)), got = Buffer.from(c);
    if (crypto.timingSafeEqual(want, got)) return s;
  }
  return null;
}

/** A new 160-bit secret, base32. */
export const newSecret = () => base32Encode(crypto.randomBytes(20));
/** The address authenticator apps read from the QR code. */
export function otpauthUrl({ issuer, account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

/** Ten recovery codes like "k4w9-2mxq" (about 40 bits each) and their SHA-256 hashes for storage. */
export function newRecoveryCodes(n = 10) {
  const alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes = [];
  for (let k = 0; k < n; k++) {
    let s = '';
    for (let i = 0; i < 8; i++) s += alpha[crypto.randomInt(alpha.length)];
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return codes;
}
export const normalizeRecovery = c => String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
