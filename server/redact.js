// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One redaction helper for every settings endpoint and the logger (PLAN WP1.5; DECISIONS C89, C94): fields whose names
// hold credentials, and every secret value this process has handled, never reach a settings response or a log line.

// A field name holds a credential when its letters and digits end with one of these (C94; checked against all 75
// answers of Jev batches 21b and 23 in tests/secrets.test.mjs).
const CREDENTIAL_ENDINGS = Object.freeze(['token', 'secret', 'password', 'passphrase', 'apikey', 'privatekey', 'signingkey',
  'secretkey', 'secretaccesskey', 'masterkey', 'cookie', 'authorization', 'bearer', 'basicauth', 'authheader', 'credential',
  'credentials', 'connectionstring', 'dsn', 'recoverycode', 'recoverycodes', 'pincode']);
const NOT_CREDENTIALS = Object.freeze(['csrftoken', 'setcookie', 'sentrydsn']);
export const REDACTED = '[redacted]';

const norm = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Whether a field of that name holds a credential (C89, C94). */
export function isCredentialName(name) {
  const n = norm(name);
  if (!n || NOT_CREDENTIALS.some(x => n.endsWith(x))) return false;
  return CREDENTIAL_ENDINGS.some(x => n.endsWith(x));
}

// "Bearer <token>" / "Basic <token>" in free text: the token must look like one (12+ characters with a digit or a
// symbol), so that ordinary words after "Basic" stay.
const AUTH_SCHEME_RE = /\b(Bearer|Basic)\s+(?=[A-Za-z0-9._~+/-]*[0-9._~+/-])[A-Za-z0-9._~+/-]{12,}=*/g;
/** A text with every known secret, and Bearer / Basic credentials, replaced by [redacted]. */
export function scrub(text, known = null) {
  let s = String(text);
  if (known && known.size) {
    for (const k of known) if (k && s.includes(k)) s = s.split(k).join(REDACTED);
  }
  return s.replace(AUTH_SCHEME_RE, `$1 ${REDACTED}`);
}

/**
 * A copy of value in which fields named like credentials are replaced by [redacted] (booleans and empty values stay:
 * "secret: true" is a flag, not a secret), the Set-Cookie header too, and known secrets are scrubbed from every text.
 * @param {*} value
 * @param {Set<string>} [known]  secret values this process has handled (SecretBox.known)
 */
export function redact(value, known = null, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') return scrub(value, known);
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return scrub(value.stack || String(value), known);
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  if (depth > 12) return '[too deep]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map(v => redact(v, known, depth + 1, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const hides = (isCredentialName(k) || k.toLowerCase() === 'set-cookie') && v !== null && v !== undefined && v !== '' && typeof v !== 'boolean';
    out[k] = hides ? REDACTED : redact(v, known, depth + 1, seen);
  }
  return out;
}
