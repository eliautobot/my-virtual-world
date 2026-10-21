// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Password hashing (Argon2id through node:crypto, PHC strings with the parameters and salt of each hash) and the
// password policy (DECISIONS C58).
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const argon2 = promisify(crypto.argon2);
/** OWASP's minimum Argon2id configuration: 19 MiB of memory, 2 passes, 1 lane (about 20 ms on the test host). */
export const PARAMS = Object.freeze({ m: 19456, t: 2, p: 1 });
export const MIN_LENGTH = 12, MAX_LENGTH = 1024;
const MAX_RUNNING = 4, MAX_QUEUED = 64;

// At most MAX_RUNNING hashes at once (each needs 19 MiB); past MAX_QUEUED waiting callers the server answers 503.
let running = 0;
const waiting = [];
async function slot(fn) {
  if (running < MAX_RUNNING) running++;
  else {
    if (waiting.length >= MAX_QUEUED) throw Object.assign(new Error('The server is busy; try again in a moment'), { status: 503, code: 'busy' });
    await new Promise(resolve => waiting.push(resolve));   // a finishing hash hands its slot over
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); else running--;
  }
}

const b64 = buf => buf.toString('base64').replace(/=+$/, '');
/** Passwords are compared after Unicode NFKC normalisation, so the same password typed on any device matches. */
export const normalizePassword = pw => String(pw).normalize('NFKC');

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const tag = await slot(() => argon2('argon2id', {
    message: normalizePassword(pw), nonce: salt, parallelism: PARAMS.p, tagLength: 32, memory: PARAMS.m, passes: PARAMS.t,
  }));
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(tag)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]{16,})\$([A-Za-z0-9+/]{16,})$/;
export async function verifyPassword(pw, phc) {
  const m = PHC.exec(String(phc || ''));
  if (!m || typeof pw !== 'string') return false;
  const mem = +m[1], t = +m[2], p = +m[3], want = Buffer.from(m[5], 'base64');
  if (mem < 8 * p || mem > 262144 || t < 1 || t > 10 || p < 1 || p > 8 || want.length < 16 || want.length > 64) return false;
  const got = await slot(() => argon2('argon2id', {
    message: normalizePassword(pw), nonce: Buffer.from(m[4], 'base64'), parallelism: p, tagLength: want.length, memory: mem, passes: t,
  }));
  return crypto.timingSafeEqual(got, want);
}

/** Whether a stored hash uses other parameters than today's (it is replaced at the next successful sign-in). */
export const needsRehash = phc => !String(phc).startsWith(`$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$`);

let dummy = null;
/** Creates the comparison hash for unknown usernames at start, so the first one costs no more than the rest. */
export async function warmUp() {
  dummy ||= await hashPassword(crypto.randomBytes(18).toString('base64'));
}
/** Spends the time of one verification, so unknown usernames answer as slowly as wrong passwords. */
export async function burnVerify(pw) {
  await warmUp();
  await verifyPassword(String(pw ?? ''), dummy);
  return false;
}

let common = null;
function commonPasswords() {
  common ||= new Set(zlib.gunzipSync(fs.readFileSync(new URL('./common-passwords.txt.gz', import.meta.url))).toString('utf8').split('\n').filter(Boolean));
  return common;
}

/** Why a new password is refused, or null. 12 to 1,024 characters, not the sign-in or display name, not common. */
export function checkPassword(pw, { login = '', displayName = '' } = {}) {
  if (typeof pw !== 'string' || !pw) return 'Enter a password';
  const n = normalizePassword(pw), len = [...n].length, low = n.toLowerCase();
  if (len < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters`;
  if (len > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters`;
  if (login && low === String(login).normalize('NFKC').toLowerCase()) return 'The password cannot be your username';
  if (displayName && low === String(displayName).normalize('NFKC').toLowerCase()) return 'The password cannot be your display name';
  if (new Set(n).size < 5) return 'Use more different characters';
  if (commonPasswords().has(low)) return 'That password is on a list of common passwords; choose another';
  return null;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';   // no 0/O, 1/l/I
/** A random temporary password (20 characters, about 116 bits). */
export function temporaryPassword(n = 20) {
  let s = '';
  for (let k = 0; k < n; k++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}
