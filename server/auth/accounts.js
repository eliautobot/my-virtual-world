// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Accounts and sessions (DECISIONS C56–C58, C71, A16–A18): sign-in with limits and lockout, sessions behind HttpOnly
// cookies, the first owner's temporary password, password, username and display-name changes, devices, and the
// user management that the WP1.4 screens build on. Tokens are stored as SHA-256 hashes; passwords as Argon2id.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import qrcode from 'qrcode-generator';
import { hashPassword, verifyPassword, burnVerify, checkPassword, temporaryPassword, needsRehash } from './passwords.js';
import { RANK } from './permissions.js';
import { verifyTotp, newSecret, otpauthUrl, newRecoveryCodes, normalizeRecovery, base32Decode } from './totp.js';
import { RECOVERY_KEY, SECRET_PREFIX, aadInstall, aadTwofa } from '../secret-holders.js';
import { nameProblem, NAME_REFUSED } from '../mind/speech.js';

export const OWNER_FILE = 'first-owner-password.txt';
export const SETUP_FILE = 'setup-code.txt';
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
export const LIMITS = Object.freeze({
  sessionIdleMs: 30 * DAY, sessionMaxMs: 90 * DAY, touchMs: MIN, reauthMs: 10 * MIN, tempTtlMs: 72 * HOUR, sessionsPerAccount: 50,
  // Wrong passwords: 5 for one account (or unknown name) from one address lock that address out of it for 15 minutes;
  // 50 from any addresses lock the account for everyone; 20 failures from one address block it for 15 minutes.
  // Counted within 15 minutes; kept in the database, so a restart does not reset them (DECISIONS C71).
  lockAfter: 5, accountLockAfter: 50, addressLimit: 20, windowMs: 15 * MIN, lockMs: 15 * MIN,
  // Two-factor: the second sign-in step must follow within 5 minutes and 5 tries. Invites last 1 to 30 days.
  // Open self-registration: at most 5 new accounts per client address per 15 minutes.
  ticketMs: 5 * MIN, ticketTries: 5, inviteMaxDays: 30, registrationsPerAddress: 5,
});
const ref = a => (a ? { id: a.id, login: a.login } : null);
const actorOf = P => (P && P.account ? { id: P.account.id, login: P.account.login } : null);
export const GUEST = Object.freeze({ account: null, role: 'guest', restricted: false, session: null });

export class AuthError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}
const badCredentials = () => new AuthError(401, 'bad_credentials', 'Wrong username or password');
const minutes = ms => Math.max(1, Math.ceil(ms / MIN));
const locked = ms => new AuthError(429, 'locked', `Too many failed attempts. Try again in ${minutes(ms)} minutes`, { retryAfter: Math.ceil(ms / 1000) });
const rateLimited = ms => new AuthError(429, 'rate_limited', `Too many sign-in attempts from your network. Try again in ${minutes(ms)} minutes`, { retryAfter: Math.ceil(ms / 1000) });

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
// A setup code: 4+4 of 32 letters and digits that can't be mistaken for each other (40 bits), e.g. 7KQ2-M9XD.
const SETUP_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const setupCode = () => { const b = crypto.randomBytes(8); let c = ''; for (let i = 0; i < 8; i++) c += SETUP_ALPHABET[b[i] % 32] + (i === 3 ? '-' : ''); return c; };
const normSetupCode = c => String(c ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 32);
const newToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const cleanName = s => String(s).normalize('NFKC').trim().replace(/\s+/g, ' ');
/** Usernames are compared after NFKC normalisation, lower case. */
export const normLogin = s => String(s ?? '').normalize('NFKC').trim().toLowerCase();
// Characters that look alike in common fonts count as the same for display-name uniqueness; the name is shown as typed.
const CONFUSABLE = new Map(Object.entries({
  0: 'o', 1: 'l', i: 'l', '|': 'l',
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'l', ј: 'j', ѕ: 's', ԁ: 'd',
  α: 'a', β: 'b', ε: 'e', ι: 'l', κ: 'k', μ: 'u', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ɡ: 'g',
}));
/** The uniqueness key of a display name: normalised, lower case, look-alikes folded, separators unified. */
export function displayKey(s) {
  const low = cleanName(s).toLowerCase().replace(/rn/g, 'm').replace(/vv/g, 'w');
  return [...low].map(c => CONFUSABLE.get(c) || c).join('').replace(/[\s._-]+/g, ' ');
}
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export function checkLogin(s) {
  return LOGIN_RE.test(normLogin(s)) ? null
    : 'Use 2 to 32 characters for the username: letters, digits, dot, dash or underscore, starting with a letter or digit';
}
export function checkDisplayName(s) {
  if (typeof s !== 'string') return 'Enter a display name';
  const n = cleanName(s), len = [...n].length;
  if (len < 2 || len > 32) return 'Use 2 to 32 characters for the display name';
  if (/[\p{Cc}<>]|(?!\u200d)\p{Cf}/u.test(n)) return 'The display name contains characters that are not allowed';
  if (nameProblem(n)) return NAME_REFUSED;   // (outside AIs read display names: server/mind/speech.js)
  return null;
}
const isUnique = (e, col) => /UNIQUE constraint failed/.test(String(e && e.message)) && String(e.message).includes(col);

/** Writes a file readable only by its owner: created exclusively with mode 0600, then renamed into place. */
export function writeSecretFile(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.rmSync(tmp, { force: true });
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export class Accounts {
  /**
   * @param {object} store   openDb() result
   * @param {object} o
   * @param {string} o.dataDir  folder of first-owner-password.txt (the server's data folder)
   * @param {function} [o.log]
   * @param {function} [o.now]
   */
  /**
   * @param {object} [o.audit]          Audit instance (server/auth/audit.js); every account action is recorded
   * @param {object} [o.box]            SecretBox (server/secrets.js): seals two-factor secrets and the recovery-code key
   * @param {function} [o.requireTwofa] () => whether admins and the owner must use two-factor sign-in
   * @param {string} [o.issuer]         the name authenticator apps show
   */
  constructor(store, { dataDir, log = () => {}, now = () => Date.now(), audit = null, box = null, requireTwofa = () => false, issuer = 'My Virtual World' } = {}) {
    this.store = store;
    this.w = store.worldId;
    this.dataDir = dataDir;
    this.log = log;
    this.now = now;
    this.audit = audit;
    this.box = box;
    this.requireTwofa = requireTwofa;
    this.issuer = issuer;
    this.tickets = new Map();       // second sign-in steps: sha256(ticket) → { id, ip, ua, expires, tries }
    this.listeners = new Set();   // session changes, for the WebSocket guard: ({ account, session, except, refresh })
    this.journal = null;          // the edit journal, set by the server (WP1.8)
    const db = store.db;
    const SESSION = `SELECT s.id AS sid, s.csrf, s.created AS s_created, s.last_seen, s.auth_at, s.needs_twofa, a.*,
      (SELECT enabled_at FROM twofa t WHERE t.account_id = a.id) AS twofa_on FROM sessions s JOIN accounts a ON a.id = s.account_id`;
    this.q = {
      byLogin: db.prepare('SELECT * FROM accounts WHERE world_id = $w AND login = $login'),
      byId: db.prepare('SELECT * FROM accounts WHERE world_id = $w AND id = $id'),
      owner: db.prepare("SELECT * FROM accounts WHERE world_id = $w AND role = 'owner'"),
      insert: db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, must_change, temp_expires,
        password_changed, created, updated) VALUES ($w, $login, $name, $key, $role, $hash, $must, $exp, $now, $now, $now)`),
      setHash: db.prepare('UPDATE accounts SET password_hash = $hash WHERE id = $id'),
      setPassword: db.prepare(`UPDATE accounts SET password_hash = $hash, must_change = $must, temp_expires = $exp, password_changed = $now,
        no_password = 0, updated = $now WHERE id = $id`),
      setName: db.prepare('UPDATE accounts SET display_name = $name, display_key = $key, updated = $now WHERE id = $id'),
      setLogin: db.prepare('UPDATE accounts SET login = $login, updated = $now WHERE id = $id'),
      setRole: db.prepare('UPDATE accounts SET role = $role, updated = $now WHERE id = $id'),
      setStatus: db.prepare('UPDATE accounts SET status = $status, updated = $now WHERE id = $id'),
      list: db.prepare(`SELECT a.id, a.login, a.display_name, a.role, a.status, a.must_change, a.temp_expires, a.created,
        (SELECT MAX(last_seen) FROM sessions s WHERE s.account_id = a.id) AS last_seen,
        (SELECT enabled_at FROM twofa t WHERE t.account_id = a.id) AS twofa_on FROM accounts a WHERE a.world_id = $w ORDER BY a.id`),
      counts: db.prepare('SELECT role, status, COUNT(*) AS n FROM accounts WHERE world_id = $w GROUP BY role, status'),
      insertSession: db.prepare(`INSERT INTO sessions (world_id, token_hash, account_id, csrf, created, last_seen, auth_at, ip, user_agent, needs_twofa)
        VALUES ($w, $hash, $acc, $csrf, $now, $now, $now, $ip, $ua, $needs)`),
      sessionByHash: db.prepare(`${SESSION} WHERE s.world_id = $w AND s.token_hash = $hash`),
      sessionById: db.prepare(`${SESSION} WHERE s.id = $sid`),
      touch: db.prepare('UPDATE sessions SET last_seen = $now, ip = coalesce($ip, ip) WHERE id = $sid'),
      reauth: db.prepare('UPDATE sessions SET auth_at = $now WHERE id = $sid'),
      delSession: db.prepare('DELETE FROM sessions WHERE id = $sid'),
      delSessionOf: db.prepare('DELETE FROM sessions WHERE id = $sid AND account_id = $acc'),
      delSessionsOf: db.prepare('DELETE FROM sessions WHERE account_id = $acc'),
      delSessionsExcept: db.prepare('DELETE FROM sessions WHERE account_id = $acc AND id <> $sid'),
      sessionsOf: db.prepare('SELECT id, created, last_seen, ip, user_agent FROM sessions WHERE account_id = $acc ORDER BY last_seen DESC'),
      trim: db.prepare(`DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE account_id = $acc
        ORDER BY last_seen DESC LIMIT -1 OFFSET $keep)`),
      purge: db.prepare('DELETE FROM sessions WHERE world_id = $w AND (last_seen < $idle OR created < $max)'),
      clearSessions: db.prepare('DELETE FROM sessions WHERE world_id = $w'),
      sessionCount: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE world_id = $w'),
      failGet: db.prepare('SELECT count, first, locked_until FROM auth_failures WHERE world_id = $w AND key = $key'),
      failPut: db.prepare(`INSERT INTO auth_failures (world_id, key, count, first, locked_until) VALUES ($w, $key, $count, $first, $until)
        ON CONFLICT (world_id, key) DO UPDATE SET count = excluded.count, first = excluded.first, locked_until = excluded.locked_until`),
      failDel: db.prepare('DELETE FROM auth_failures WHERE world_id = $w AND key = $key'),
      failDelAccount: db.prepare('DELETE FROM auth_failures WHERE world_id = $w AND (key = $key OR key LIKE $pairs)'),
      failPurge: db.prepare('DELETE FROM auth_failures WHERE world_id = $w AND locked_until < $now AND first < $old'),
      twofaOf: db.prepare('SELECT * FROM twofa WHERE account_id = $acc'),
      settingGet: db.prepare('SELECT value FROM settings WHERE world_id = $w AND key = $key'),
      settingPut: db.prepare('INSERT INTO settings (world_id, key, value) VALUES ($w, $key, $value) ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value'),
      recoveryDelAll: db.prepare('DELETE FROM recovery_codes WHERE account_id IN (SELECT id FROM accounts WHERE world_id = $w)'),
      twofaPut: db.prepare(`INSERT INTO twofa (account_id, world_id, secret, enabled_at, last_step, created) VALUES ($acc, $w, $secret, NULL, 0, $now)
        ON CONFLICT (account_id) DO UPDATE SET secret = excluded.secret, enabled_at = NULL, last_step = 0, created = excluded.created`),
      twofaOn: db.prepare('UPDATE twofa SET enabled_at = $now, last_step = $step WHERE account_id = $acc'),
      twofaStep: db.prepare('UPDATE twofa SET last_step = $step WHERE account_id = $acc'),
      twofaDel: db.prepare('DELETE FROM twofa WHERE account_id = $acc'),
      recoveryDel: db.prepare('DELETE FROM recovery_codes WHERE account_id = $acc'),
      recoveryAdd: db.prepare('INSERT INTO recovery_codes (account_id, world_id, code_hash) VALUES ($acc, $w, $hash)'),
      recoveryFind: db.prepare('SELECT id FROM recovery_codes WHERE account_id = $acc AND code_hash = $hash AND used_at IS NULL'),
      recoveryUse: db.prepare('UPDATE recovery_codes SET used_at = $now WHERE id = $id'),
      recoveryLeft: db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE account_id = $acc AND used_at IS NULL'),
      inviteAdd: db.prepare(`INSERT INTO invites (world_id, token_hash, role, note, created_by, created, expires)
        VALUES ($w, $hash, $role, $note, $by, $now, $expires)`),
      inviteByHash: db.prepare('SELECT * FROM invites WHERE world_id = $w AND token_hash = $hash'),
      inviteById: db.prepare('SELECT * FROM invites WHERE world_id = $w AND id = $id'),
      inviteUse: db.prepare('UPDATE invites SET used_by = $acc, used_at = $now WHERE id = $id AND used_at IS NULL AND revoked_at IS NULL'),
      inviteRevoke: db.prepare('UPDATE invites SET revoked_at = $now WHERE id = $id AND used_at IS NULL AND revoked_at IS NULL'),
      invites: db.prepare(`SELECT i.id, i.role, i.note, i.created, i.expires, i.used_at, i.revoked_at, c.login AS created_by, u.login AS used_by
        FROM invites i LEFT JOIN accounts c ON c.id = i.created_by LEFT JOIN accounts u ON u.id = i.used_by
        WHERE i.world_id = $w ORDER BY i.id DESC LIMIT 500`),
      invitesByCreator: db.prepare('SELECT id, role, note, created, expires, used_at, revoked_at FROM invites WHERE world_id = $w AND created_by = $acc'),
      invitesReassign: db.prepare('UPDATE invites SET created_by = $to WHERE world_id = $w AND created_by = $acc'),
      invitesRevokeBy: db.prepare('UPDATE invites SET revoked_at = $now WHERE world_id = $w AND created_by = $acc AND used_at IS NULL AND revoked_at IS NULL'),
      delAccount: db.prepare('DELETE FROM accounts WHERE world_id = $w AND id = $id'),
      admins: db.prepare("SELECT id, login, display_name, role, status FROM accounts WHERE world_id = $w AND role IN ('owner', 'admin') ORDER BY role DESC, id"),
    };
  }

  // ---------------------------------------------------------------- change notifications
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn(ev); } catch (e) { this.log('[auth] listener failed', e.message); } } }

  // ---------------------------------------------------------------- principals
  principalOf(row) {
    // A restricted session may only replace a temporary password, or set up two-factor sign-in when it is required for
    // admins and the owner (C77: sessions started while it was required and not yet set up); otherwise it counts as a
    // guest. Setting it up, or switching the requirement off, lifts the restriction.
    const needTwofa = !!row.needs_twofa && !row.twofa_on && (row.role === 'admin' || row.role === 'owner') && this.requireTwofa();
    return {
      account: { id: row.id, login: row.login, displayName: row.display_name, role: row.role, mustChange: !!row.must_change, twofa: !!row.twofa_on, noPassword: !!row.no_password },
      role: row.role,
      restricted: !!row.must_change || needTwofa,
      restrictedWhy: row.must_change ? 'password' : needTwofa ? 'twofa' : null,
      session: { id: row.sid, csrf: row.csrf, authAt: row.auth_at, created: row.s_created, lastSeen: row.last_seen },
    };
  }
  /**
   * An account's principal when an AI app acts for it with the person's grant (server/connector/): no browser session -
   * so nothing that needs a fresh password, and no CSRF token -, and null when the account can't act (disabled, or a
   * temporary password still to replace).
   */
  connectorPrincipal(id) {
    const row = this.q.byId.get({ w: this.w, id: Number(id) });
    if (!row || row.status !== 'active' || row.must_change) return null;
    return {
      account: { id: row.id, login: row.login, displayName: row.display_name, role: row.role, mustChange: false, twofa: false, noPassword: !!row.no_password },
      role: row.role, restricted: false, restrictedWhy: null, session: null,
    };
  }
  /** Session row → principal, or null (and the session is deleted) when it has ended. */
  live(row, ip) {
    if (!row) return null;
    const now = this.now();
    if (now - row.last_seen > LIMITS.sessionIdleMs || now - row.s_created > LIMITS.sessionMaxMs || row.status !== 'active'
      || (row.must_change && row.temp_expires && now > row.temp_expires)) {
      this.q.delSession.run({ sid: row.sid });
      return null;
    }
    if (now - row.last_seen >= LIMITS.touchMs) {
      this.q.touch.run({ sid: row.sid, now, ip: ip ?? null });
      row.last_seen = now;
    }
    return this.principalOf(row);
  }
  /** The principal of a session cookie value. Guests get GUEST; stale is set when a cookie no longer works. */
  resolve(token, { ip = null } = {}) {
    if (!token) return GUEST;
    if (typeof token !== 'string' || token.length > 128) return { ...GUEST, stale: true };
    return this.live(this.q.sessionByHash.get({ w: this.w, hash: sha256(token) }), ip) || { ...GUEST, stale: true };
  }
  /** The current principal of a session id, or null when it has ended (used by the WebSocket guard). */
  refresh(sessionId) { return this.live(this.q.sessionById.get({ sid: sessionId }), null); }

  // ---------------------------------------------------------------- failure counters
  /** Milliseconds until key is unlocked (0 = not locked). */
  lockLeft(key, now) {
    const r = this.q.failGet.get({ w: this.w, key });
    return r && r.locked_until > now ? r.locked_until - now : 0;
  }
  /** One more failure for key within the window; at limit the key locks for LIMITS.lockMs and its count restarts. */
  bump(key, limit, now) {
    const r = this.q.failGet.get({ w: this.w, key });
    let count = 1, first = now;
    if (r && r.locked_until <= now && now - r.first < LIMITS.windowMs) { count = r.count + 1; first = r.first; }
    const until = count >= limit ? now + LIMITS.lockMs : 0;
    this.q.failPut.run({ w: this.w, key, count: until ? 0 : count, first, until });
  }
  /** Keys of an attempt: the client address, the account (or unknown name), and the pair of both. */
  keys(acc, login, ip) {
    const who = acc ? `acct:${acc.id}` : `name:${login}`, addr = `ip:${ip || '-'}`;
    return { addr, who, pair: `pair:${who}|${ip || '-'}` };
  }
  /** Throws when the address is blocked or the account (from this address, or everywhere) is locked. */
  checkLocks(k, now) {
    const a = this.lockLeft(k.addr, now);
    if (a) throw rateLimited(a);
    const l = Math.max(this.lockLeft(k.pair, now), this.lockLeft(k.who, now));
    if (l) throw locked(l);
  }
  noteFailure(k, now) {
    this.store.tx(() => {
      this.bump(k.addr, LIMITS.addressLimit, now);
      this.bump(k.pair, LIMITS.lockAfter, now);
      this.bump(k.who, LIMITS.accountLockAfter, now);
    });
  }
  noteSuccess(k) {
    this.store.tx(() => {
      this.q.failDel.run({ w: this.w, key: k.pair });
      this.q.failDel.run({ w: this.w, key: k.who });
    });
  }

  // ---------------------------------------------------------------- sign-in
  async signIn({ login, password, ip = null, userAgent = '' }) {
    const key = normLogin(login), now = this.now();
    if (typeof password !== 'string' || !password || !key || key.length > 64 || password.length > 4096) {
      throw new AuthError(400, 'bad_request', 'Enter your username and password');
    }
    const acc = this.q.byLogin.get({ w: this.w, login: key }), k = this.keys(acc, key, ip);
    this.checkLocks(k, now);   // unknown names are counted and locked exactly like accounts
    const ok = acc ? await verifyPassword(password, acc.password_hash) : await burnVerify(password);
    if (!ok) {
      this.noteFailure(k, now);
      // Never the typed name of an unknown account: people sometimes type their password into the name field.
      this.audit?.log('auth.signin_failed', { target: ref(acc), ip, detail: acc ? null : { unknown: true } });
      throw badCredentials();
    }
    if (acc.status !== 'active') throw new AuthError(403, 'disabled', 'This account is disabled');
    if (acc.must_change && acc.temp_expires && now > acc.temp_expires) {
      throw new AuthError(403, 'temp_expired', acc.role === 'owner'
        ? 'This temporary password has expired. On the server, run: node tools/admin.mjs reset-owner'
        : 'This temporary password has expired. Ask an admin for a new one');
    }
    if (needsRehash(acc.password_hash)) this.q.setHash.run({ id: acc.id, hash: await hashPassword(password) });
    const tf = this.q.twofaOf.get({ acc: acc.id });
    if (tf && tf.enabled_at) {   // the password was right; the code comes in a second request (signInTwofa)
      const ticket = newToken(24);
      this.pruneTickets(now);
      this.tickets.set(sha256(ticket), { id: acc.id, ip, ua: userAgent, expires: now + LIMITS.ticketMs, tries: 0 });
      return { twofa: true, ticket };
    }
    this.noteSuccess(k);
    return this.startSession(acc, { ip, userAgent });
  }
  /** A new session for an account that has proven who it is; records the sign-in. */
  startSession(acc, { ip = null, userAgent = '', via = null } = {}) {
    const token = newToken(), csrf = newToken(24), hash = sha256(token), now = this.now();
    const tf = this.q.twofaOf.get({ acc: acc.id });
    const needs = (acc.role === 'admin' || acc.role === 'owner') && !(tf && tf.enabled_at) && this.requireTwofa() ? 1 : 0;
    this.store.tx(() => {
      this.q.insertSession.run({ w: this.w, hash, acc: acc.id, csrf, now, ip, ua: String(userAgent || '').slice(0, 200), needs });
      this.q.trim.run({ acc: acc.id, keep: LIMITS.sessionsPerAccount });
    });
    this.audit?.log('auth.signin', { actor: ref(acc), ip, detail: via ? { via } : null });
    return { token, principal: this.principalOf(this.q.sessionByHash.get({ w: this.w, hash })) };
  }
  pruneTickets(now) { for (const [h, t] of this.tickets) if (t.expires <= now) this.tickets.delete(h); }
  /** The second sign-in step: a code from the authenticator app, or an unused recovery code. */
  async signInTwofa({ ticket, code, ip = null, userAgent = '' }) {
    const now = this.now(), h = sha256(String(ticket || '')), t = this.tickets.get(h);
    if (!t || t.expires <= now || t.ip !== ip) {
      this.tickets.delete(h);
      throw new AuthError(401, 'ticket_expired', 'Sign in again: the sign-in took too long or came from another network');
    }
    const acc = this.q.byId.get({ w: this.w, id: t.id }), k = this.keys(acc, acc?.login, ip);
    if (!acc || acc.status !== 'active') { this.tickets.delete(h); throw badCredentials(); }
    this.checkLocks(k, now);
    const via = this.checkSecondFactor(acc, code, now);
    if (!via) {
      t.tries++;
      if (t.tries >= LIMITS.ticketTries) this.tickets.delete(h);
      this.noteFailure(k, now);
      this.audit?.log('auth.twofa_failed', { target: ref(acc), ip });
      throw new AuthError(401, 'bad_code', t.tries >= LIMITS.ticketTries ? 'Too many wrong codes. Sign in again' : 'That code is not right');
    }
    this.tickets.delete(h);
    this.noteSuccess(k);
    if (via === 'recovery') this.audit?.log('twofa.recovery_used', { actor: ref(acc), ip, detail: { left: this.q.recoveryLeft.get({ acc: acc.id }).n } });
    return this.startSession(acc, { ip, userAgent: userAgent || t.ua, via });
  }
  /** 'totp' or 'recovery' when code proves the second factor (and uses it up), else null. */
  checkSecondFactor(acc, code, now) {
    const tf = this.q.twofaOf.get({ acc: acc.id });
    if (!tf || !tf.enabled_at) return null;
    const c = String(code || '').trim();
    if (/^\d{6}$/.test(c.replace(/\s/g, ''))) {
      const step = verifyTotp(base32Decode(this.openSecret(acc.id, tf.secret)), c, now, tf.last_step);
      if (step === null) return null;
      this.q.twofaStep.run({ acc: acc.id, step });
      return 'totp';
    }
    if (normalizeRecovery(c).length !== 8) return null;
    const rk = this.recoveryKey(false);
    if (!rk) return null;
    const r = this.q.recoveryFind.get({ acc: acc.id, hash: this.recoveryHash(c, rk) });
    if (!r) return null;
    this.q.recoveryUse.run({ id: r.id, now });
    return 'recovery';
  }
  /** Checks the password of a signed-in account, with the same limits and lockout as sign-in. */
  async confirm(P, password, ip = null) {
    const acc = this.q.byId.get({ w: this.w, id: P.account.id }), now = this.now();
    if (!acc) throw new AuthError(401, 'signin_required', 'Sign in first');
    // (an account without a password of its own - made by a sign-in provider in an older world - needs an admin's reset)
    if (acc.no_password) throw new AuthError(403, 'no_password', 'Your account has no password: ask an administrator to reset it');
    const k = this.keys(acc, acc.login, ip);
    this.checkLocks(k, now);
    if (typeof password !== 'string' || !(await verifyPassword(password, acc.password_hash))) {
      this.noteFailure(k, now);
      this.audit?.log('auth.confirm_failed', { actor: ref(acc), ip });
      throw new AuthError(403, 'wrong_password', 'That password is not right');
    }
    this.noteSuccess(k);
    return acc;
  }
  async reauth(P, password, ip = null) {
    await this.confirm(P, password, ip);
    this.q.reauth.run({ sid: P.session.id, now: this.now() });
    return this.refresh(P.session.id);
  }
  signOut(P, { everywhere = false } = {}, ip = null) {
    if (!P.session) return;
    if (everywhere) {
      this.q.delSessionsOf.run({ acc: P.account.id });
      this.emit({ account: P.account.id, session: null });
    } else {
      this.q.delSession.run({ sid: P.session.id });
      this.emit({ account: P.account.id, session: P.session.id });
    }
    this.audit?.log(everywhere ? 'auth.signout_all' : 'auth.signout', { actor: actorOf(P), ip });
  }

  // ---------------------------------------------------------------- the own account
  async changePassword(P, { current, password }, ip = null) {
    const acc = await this.confirm(P, current, ip);
    const why = checkPassword(password, { login: acc.login, displayName: acc.display_name });
    if (why) throw new AuthError(400, 'weak_password', why);
    if (await verifyPassword(password, acc.password_hash)) throw new AuthError(400, 'same_password', 'Choose a new password, not the current one');
    const hash = await hashPassword(password), now = this.now();
    this.store.tx(() => {
      this.q.setPassword.run({ id: acc.id, hash, must: 0, exp: null, now });
      this.q.delSessionsExcept.run({ acc: acc.id, sid: P.session.id });
      this.q.reauth.run({ sid: P.session.id, now });
    });
    if (acc.role === 'owner') this.removeOwnerFile();
    this.audit?.log('account.password', { actor: ref(acc), target: ref(acc), ip, detail: acc.must_change ? { replacedTemporary: true } : null });
    this.emit({ account: acc.id, session: null, except: P.session.id });   // the other devices' live streams end
    this.emit({ account: acc.id, refresh: true });                           // this one is no longer restricted
    return this.refresh(P.session.id);
  }
  setDisplayName(P, name, ip = null) {
    const why = checkDisplayName(name);
    if (why) throw new AuthError(400, 'bad_name', why);
    const n = cleanName(name);
    this.audit?.log('account.name', { actor: actorOf(P), target: actorOf(P), ip, detail: { from: P.account.displayName, to: n } });
    try {
      this.q.setName.run({ id: P.account.id, name: n, key: displayKey(n), now: this.now() });
    } catch (e) {
      if (isUnique(e, 'display_key')) throw new AuthError(409, 'name_taken', 'That display name is taken, or looks too much like one that is');
      throw e;
    }
    this.emit({ account: P.account.id, refresh: true });
    return n;
  }
  /** Changes the own username (the route needs a recent password entry). */
  setLogin(P, login, ip = null) {
    const why = checkLogin(login);
    if (why) throw new AuthError(400, 'bad_request', why);
    const key = normLogin(login);
    try {
      this.q.setLogin.run({ id: P.account.id, login: key, now: this.now() });
    } catch (e) {
      if (isUnique(e, 'accounts.login')) throw new AuthError(409, 'login_taken', 'That username is taken');
      throw e;
    }
    this.audit?.log('account.login', { actor: { id: P.account.id, login: key }, target: { id: P.account.id, login: key }, ip, detail: { from: P.account.login, to: key } });
    this.emit({ account: P.account.id, refresh: true });
    return key;
  }
  devices(P) {
    return this.q.sessionsOf.all({ acc: P.account.id }).map(s => ({
      id: s.id, created: s.created, lastSeen: s.last_seen, ip: s.ip, userAgent: s.user_agent, current: s.id === P.session.id,
    }));
  }
  revokeDevice(P, id, ip = null) {
    if (!this.q.delSessionOf.run({ sid: id, acc: P.account.id }).changes) throw new AuthError(404, 'not_found', 'No such device');
    this.audit?.log('account.device_revoke', { actor: actorOf(P), target: actorOf(P), ip, detail: { session: id } });
    this.emit({ account: P.account.id, session: id });
  }

  // ---------------------------------------------------------------- user management (always below the own role)
  publicUser(a) {
    return {
      id: a.id, login: a.login, displayName: a.display_name, role: a.role, status: a.status, mustChange: !!a.must_change,
      tempExpires: a.must_change ? a.temp_expires : null, created: a.created, lastSeen: a.last_seen ?? null, twofa: !!a.twofa_on,
    };
  }
  listUsers() { return this.q.list.all({ w: this.w }).map(a => this.publicUser(a)); }
  async createAccount({ login, displayName, role, password = null, mustChange = true }) {
    let why = checkLogin(login) || checkDisplayName(displayName);
    if (why) throw new AuthError(400, 'bad_request', why);
    if (!['owner', 'admin', 'member'].includes(role)) throw new AuthError(400, 'bad_role', 'Choose member or admin');
    const key = normLogin(login), name = cleanName(displayName);
    if (password !== null && (why = checkPassword(password, { login: key, displayName: name }))) throw new AuthError(400, 'weak_password', why);
    const temp = password === null ? temporaryPassword() : null, now = this.now();
    const hash = await hashPassword(password ?? temp), exp = mustChange ? now + LIMITS.tempTtlMs : null;
    let id;
    try {
      id = Number(this.q.insert.run({ w: this.w, login: key, name, key: displayKey(name), role, hash, must: mustChange ? 1 : 0, exp, now }).lastInsertRowid);
    } catch (e) {
      if (isUnique(e, 'accounts.login')) throw new AuthError(409, 'login_taken', 'That username is taken');
      if (isUnique(e, 'display_key')) throw new AuthError(409, 'name_taken', 'That display name is taken, or looks too much like one that is');
      if (isUnique(e, 'world_id') && role === 'owner') throw new AuthError(409, 'owner_exists', 'There is already an owner');
      throw e;
    }
    return { user: this.publicUser(this.q.byId.get({ w: this.w, id })), temporaryPassword: temp, expires: exp };
  }
  async createUser(actor, { login, displayName, role = 'member' }, ip = null) {
    if (!['admin', 'member'].includes(role)) throw new AuthError(400, 'bad_role', 'Choose member or admin');
    if (RANK[role] >= RANK[actor.role]) throw new AuthError(403, 'forbidden', 'You can only create accounts below your own role');
    const r = await this.createAccount({ login, displayName, role });
    this.audit?.log('account.create', { actor: actorOf(actor), target: ref(r.user), ip, detail: { role } });
    return r;
  }
  async updateUser(actor, id, { role, status, resetPassword = false, resetTwofa = false } = {}, ip = null) {
    const t = this.q.byId.get({ w: this.w, id });
    if (!t) throw new AuthError(404, 'not_found', 'No such account');
    if (t.id === actor.account.id) throw new AuthError(403, 'forbidden', 'Change your own account in Account settings');
    if (RANK[t.role] >= RANK[actor.role]) throw new AuthError(403, 'forbidden', 'You can only manage accounts below your own role');
    if (role !== undefined) {
    if (!['admin', 'member'].includes(role)) throw new AuthError(400, 'bad_role', 'Choose member or admin');
      if (RANK[role] >= RANK[actor.role]) throw new AuthError(403, 'forbidden', 'You can only give roles below your own');
    }
    if (status !== undefined && !['active', 'disabled'].includes(status)) throw new AuthError(400, 'bad_request', 'Status is active or disabled');
    const now = this.now();
    let temp = null, hash = null;
    if (resetPassword) { temp = temporaryPassword(); hash = await hashPassword(temp); }
    this.store.tx(() => {
      if (role !== undefined && role !== t.role) this.q.setRole.run({ id, role, now });
      if (status !== undefined && status !== t.status) this.q.setStatus.run({ id, status, now });
      if (hash) {
        this.q.setPassword.run({ id, hash, must: 1, exp: now + LIMITS.tempTtlMs, now });
        this.clearFailures(id);
      }
      if (resetTwofa) { this.q.twofaDel.run({ acc: id }); this.q.recoveryDel.run({ acc: id }); }
      if (hash || status === 'disabled' || resetTwofa) this.q.delSessionsOf.run({ acc: id });
    });
    const a = actorOf(actor), tg = ref(t);
    if (role !== undefined && role !== t.role) this.audit?.log('account.role', { actor: a, target: tg, ip, detail: { from: t.role, to: role } });
    if (status !== undefined && status !== t.status) this.audit?.log('account.status', { actor: a, target: tg, ip, detail: { to: status } });
    if (hash) this.audit?.log('account.reset', { actor: a, target: tg, ip });
    if (resetTwofa) this.audit?.log('twofa.reset', { actor: a, target: tg, ip });
    if (hash || status === 'disabled' || resetTwofa) this.emit({ account: id, session: null });
    else if (role !== undefined) this.emit({ account: id, refresh: true });
    return { user: this.publicUser(this.q.byId.get({ w: this.w, id })), temporaryPassword: temp, expires: temp ? now + LIMITS.tempTtlMs : null };
  }
  /** Forgets the failure counters and locks of an account, from every address. */
  clearFailures(id) { this.q.failDelAccount.run({ w: this.w, key: `acct:${id}`, pairs: `pair:acct:${id}|%` }); }

  // ---------------------------------------------------------------- the first owner
  ownerFile() { return path.join(this.dataDir, OWNER_FILE); }
  removeOwnerFile() { fs.rmSync(this.ownerFile(), { force: true }); }
  writeOwnerFile(login, password, expires) {
    const data = path.resolve(this.dataDir);
    writeSecretFile(this.ownerFile(), [
      'My Virtual World: owner sign-in',
      '',
      `Username: ${login}`,
      `Temporary password: ${password}`,
      `Expires: ${new Date(expires).toISOString()}`,
      '',
      'Sign in with these, then choose your own password. This file is deleted once you have.',
      'If the password has expired, run this in the server\'s code folder:',
      `  node tools/admin.mjs reset-owner --data ${JSON.stringify(data)}`,
      '',
    ].join('\n'));
  }
  // ---------------------------------------------------------------- the first start: the administrator creates their account
  // A new installation has no account. Whoever installed it opens the world and creates the administrator (the owner)
  // with their own username and password; a one-time setup code proves they are the one who installed it: it is in
  // <data>/setup-code.txt (readable only by the server's user) and the server's output, never in a web page. Wrong codes
  // count like wrong passwords (one address locks out after 5 within 15 minutes; 50 from anywhere lock setup for everyone).
  setupFile() { return path.join(this.dataDir, SETUP_FILE); }
  /** Whether the installation still waits for its administrator. */
  needsSetup() { return !this.q.owner.get({ w: this.w }); }
  /** The setup code on file, or null. */
  setupCode() {
    try { return /^Setup code: (\S+)$/m.exec(fs.readFileSync(this.setupFile(), 'utf8'))?.[1] || null; } catch { return null; }
  }
  /** Writes a new setup code (or keeps the one on file); returns it. */
  newSetupCode({ keep = true } = {}) {
    const had = keep ? this.setupCode() : null;
    if (had) return had;
    const code = setupCode();
    writeSecretFile(this.setupFile(), [
      'My Virtual World: set up the administrator account',
      '',
      `Setup code: ${code}`,
      '',
      'Open My Virtual World in a browser, enter this code, and choose the administrator\'s username and password.',
      'The code works once, and this file is deleted when the account is made. For a new code, run in the server\'s code folder:',
      `  node tools/admin.mjs reset-owner --data ${JSON.stringify(path.resolve(this.dataDir))}`,
      '',
    ].join('\n'));
    return code;
  }
  /** On every start: an installation without its administrator gets a setup code. Returns it then, else null. */
  async ensureOwner() {
    const owner = this.q.owner.get({ w: this.w });
    if (owner) {
      fs.rmSync(this.setupFile(), { force: true });
      if (!owner.must_change) this.removeOwnerFile();
      else if (!fs.existsSync(this.ownerFile())) this.log('[auth] the owner still has a temporary password, but', OWNER_FILE, 'is gone: run node tools/admin.mjs reset-owner');
      return null;
    }
    return this.newSetupCode();
  }
  /** The administrator account, made by whoever holds the setup code; signs them in. */
  async setupOwner({ code, login, displayName, password, ip = null, userAgent = '' }) {
    const now = this.now(), addr = `setup:${ip || '-'}`, all = 'setup:*';
    if (!this.needsSetup()) throw new AuthError(409, 'owner_exists', 'This world already has its administrator. Sign in instead.');
    const wait = Math.max(this.lockLeft(addr, now), this.lockLeft(all, now));
    if (wait) throw locked(wait);
    const want = this.setupCode(), got = normSetupCode(code);
    if (!want || got.length !== normSetupCode(want).length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(normSetupCode(want)))) {
      this.bump(addr, LIMITS.lockAfter, now); this.bump(all, LIMITS.accountLockAfter, now);
      this.audit?.log('account.setup_refused', { ip });
      throw new AuthError(403, 'bad_setup_code', want ? 'That setup code is not right. It is in the setup-code.txt file in the server\'s data folder, and in the server\'s output.' : 'There is no setup code: restart the server, or run node tools/admin.mjs reset-owner');
    }
    let made;
    try { made = await this.createAccount({ login, displayName, role: 'owner', password, mustChange: false }); }
    catch (e) { if (e.code === 'owner_exists') throw new AuthError(409, 'owner_exists', 'This world already has its administrator. Sign in instead.'); throw e; }
    fs.rmSync(this.setupFile(), { force: true });
    this.audit?.log('account.create', { actor: ref(made.user), target: ref(made.user), ip, detail: { role: 'owner', first: true, via: 'setup' } });
    this.log(`[auth] the administrator account "${made.user.login}" was created`);
    return this.startSession(this.q.byId.get({ w: this.w, id: made.user.id }), { ip, userAgent, via: 'setup' });
  }
  /** A new temporary owner password (tools/admin.mjs reset-owner): unlocks and re-enables the owner, ends its sessions. */
  async resetOwner() {
    const owner = this.q.owner.get({ w: this.w });
    if (!owner) { this.newSetupCode({ keep: false }); return { file: this.setupFile(), setup: true }; }
    const pw = temporaryPassword(), now = this.now(), exp = now + LIMITS.tempTtlMs, hash = await hashPassword(pw);
    this.store.tx(() => {
      this.q.setPassword.run({ id: owner.id, hash, must: 1, exp, now });
      this.q.setStatus.run({ id: owner.id, status: 'active', now });
      this.q.delSessionsOf.run({ acc: owner.id });
      this.q.twofaDel.run({ acc: owner.id });          // a lost authenticator must not lock the owner out
      this.q.recoveryDel.run({ acc: owner.id });
      this.clearFailures(owner.id);
    });
    this.audit?.log('host.reset_owner', { target: ref(owner) });
    this.writeOwnerFile(owner.login, pw, exp);
    this.emit({ account: owner.id, session: null });
    return { file: this.ownerFile(), created: false, expires: exp, login: owner.login };
  }

  // ---------------------------------------------------------------- invites and open registration (I14.4)
  publicInvite(r) {
    const now = this.now();
    return {
      id: r.id, role: r.role, note: r.note, created: r.created, expires: r.expires, createdBy: r.created_by ?? null, usedBy: r.used_by ?? null,
      state: r.used_at ? 'used' : r.revoked_at ? 'revoked' : r.expires <= now ? 'expired' : 'open',
    };
  }
  /** An invite link's token (shown once) for a role below the creator's own. */
  createInvite(actor, { role = 'member', days = 7, note = '' } = {}, ip = null) {
    if (!['admin', 'member'].includes(role)) throw new AuthError(400, 'bad_role', 'Invite as member or admin');
    if (RANK[role] >= RANK[actor.role]) throw new AuthError(403, 'forbidden', 'You can only invite below your own role');
    const d = Math.round(Number(days));
    if (!(d >= 1 && d <= LIMITS.inviteMaxDays)) throw new AuthError(400, 'bad_request', `An invite lasts 1 to ${LIMITS.inviteMaxDays} days`);
    const token = newToken(), now = this.now(), expires = now + d * DAY;
    const n = String(note || '').normalize('NFKC').replace(/[\p{Cc}<>]/gu, '').trim().slice(0, 80) || null;
    const id = Number(this.q.inviteAdd.run({ w: this.w, hash: sha256(token), role, note: n, by: actor.account.id, now, expires }).lastInsertRowid);
    this.audit?.log('invite.create', { actor: actorOf(actor), ip, detail: { invite: id, role, days: d } });
    return { invite: this.publicInvite({ ...this.q.inviteById.get({ w: this.w, id }), created_by: actor.account.login }), token };
  }
  listInvites() { return this.q.invites.all({ w: this.w }).map(r => this.publicInvite(r)); }
  revokeInvite(actor, id, ip = null) {
    const r = this.q.inviteById.get({ w: this.w, id });
    if (!r) throw new AuthError(404, 'not_found', 'No such invite');
    if (RANK[r.role] >= RANK[actor.role]) throw new AuthError(403, 'forbidden', 'You can only revoke invites below your own role');
    if (!this.q.inviteRevoke.run({ id, now: this.now() }).changes) throw new AuthError(409, 'not_open', 'That invite was already used or revoked');
    this.audit?.log('invite.revoke', { actor: actorOf(actor), ip, detail: { invite: id } });
  }
  /** { valid, role, expires } for an invite token, without using it. */
  checkInvite(token) {
    const r = typeof token === 'string' && token.length <= 128 ? this.q.inviteByHash.get({ w: this.w, hash: sha256(token) }) : null;
    const p = r && this.publicInvite(r);
    if (!p || p.state !== 'open') return { valid: false, reason: p ? p.state : 'unknown' };
    return { valid: true, role: p.role, expires: p.expires };
  }
  /** Creates the account an invite grants, signs it in, and uses the invite up. */
  async acceptInvite({ token, login, displayName, password, ip = null, userAgent = '' }) {
    const r = typeof token === 'string' && token.length <= 128 ? this.q.inviteByHash.get({ w: this.w, hash: sha256(token) }) : null;
    if (!r || this.publicInvite(r).state !== 'open') throw new AuthError(410, 'invite_invalid', 'This invite link is no longer valid; ask for a new one');
    const { user } = await this.createAccount({ login, displayName, role: r.role, password, mustChange: false });
    if (!this.q.inviteUse.run({ id: r.id, acc: user.id, now: this.now() }).changes) {   // used by someone else meanwhile
      this.q.delAccount.run({ w: this.w, id: user.id });
      throw new AuthError(410, 'invite_invalid', 'This invite link is no longer valid; ask for a new one');
    }
    this.audit?.log('invite.accept', { actor: ref(user), target: ref(user), ip, detail: { invite: r.id, role: r.role } });
    return this.startSession(this.q.byId.get({ w: this.w, id: user.id }), { ip, userAgent, via: 'invite' });
  }
  /** Open self-registration (only when the admins switched it on; the route checks): a member account, signed in. */
  async register({ login, displayName, password, ip = null, userAgent = '' }) {
    const now = this.now(), key = `reg:${ip || '-'}`;
    if (this.lockLeft(key, now)) throw rateLimited(this.lockLeft(key, now));
    const { user } = await this.createAccount({ login, displayName, role: 'member', password, mustChange: false });
    this.bump(key, LIMITS.registrationsPerAddress, now);
    this.audit?.log('account.register', { actor: ref(user), target: ref(user), ip });
    return this.startSession(this.q.byId.get({ w: this.w, id: user.id }), { ip, userAgent, via: 'register' });
  }

  // ---------------------------------------------------------------- deleting accounts, ownership (I14.5, I14.7)
  /** Everything an account owns besides its row: today its invites (agents, connections and chats come in P2). */
  removeOwned(id, { data = 'delete', to = null } = {}) {
    if (data === 'reassign') this.q.invitesReassign.run({ w: this.w, acc: id, to });
    else this.q.invitesRevokeBy.run({ w: this.w, acc: id, now: this.now() });
    this.journal?.forgetAccount(id);   // its world edits stay as history under its display name (DECISIONS C116)
    this.players?.forgetAccount(id);   // its player and saved position go (WP1.10)
    this.friends?.forgetAccount(id);   // and every friendship and request
    this.connector?.forgetAccount(id); // and every AI app acting for it (server/connector/auth.js)
  }
  /** Deletes an account below the actor's role; its data is deleted or reassigned to another active account. */
  deleteUser(actor, id, { data = 'delete', to = null } = {}, ip = null) {
    const t = this.q.byId.get({ w: this.w, id });
    if (!t) throw new AuthError(404, 'not_found', 'No such account');
    if (t.id === actor.account.id) throw new AuthError(403, 'forbidden', 'Delete your own account in Account settings');
    if (RANK[t.role] >= RANK[actor.role]) throw new AuthError(403, 'forbidden', 'You can only delete accounts below your own role');
    if (!['delete', 'reassign'].includes(data)) throw new AuthError(400, 'bad_request', 'Choose to delete or reassign the account\'s data');
    let dest = null;
    if (data === 'reassign') {
      dest = this.q.byId.get({ w: this.w, id: Number(to) });
      if (!dest || dest.id === t.id || dest.status !== 'active') throw new AuthError(400, 'bad_request', 'Choose an active account to receive the data');
    }
    this.store.tx(() => {
      this.removeOwned(t.id, { data, to: dest && dest.id });
      this.clearFailures(t.id);
      this.q.delAccount.run({ w: this.w, id: t.id });
    });
    this.audit?.log('account.delete', { actor: actorOf(actor), target: ref(t), ip, detail: { data, to: dest ? dest.login : null } });
    this.emit({ account: t.id, session: null });
  }
  /** Deletes the own account after the password (the owner must hand over ownership first). */
  async deleteSelf(P, password, ip = null) {
    if (P.role === 'owner') throw new AuthError(403, 'owner_cannot_delete', 'Hand ownership to an admin first, then delete your account');
    const acc = await this.confirm(P, password, ip);
    this.store.tx(() => {
      this.removeOwned(acc.id);
      this.clearFailures(acc.id);
      this.q.delAccount.run({ w: this.w, id: acc.id });
    });
    this.audit?.log('account.delete', { actor: ref(acc), target: ref(acc), ip, detail: { self: true } });
    this.emit({ account: acc.id, session: null });
  }
  /** The owner hands ownership to an active admin and becomes an admin (C76). */
  transferOwner(actor, id, ip = null) {
    if (actor.role !== 'owner') throw new AuthError(403, 'forbidden', 'Only the owner can hand over ownership');
    const t = this.q.byId.get({ w: this.w, id });
    if (!t || t.role !== 'admin' || t.status !== 'active') throw new AuthError(400, 'bad_request', 'Ownership can only go to an active admin');
    const now = this.now();
    this.store.tx(() => {
      this.q.setRole.run({ id: actor.account.id, role: 'admin', now });   // one owner at a time: step down first
      this.q.setRole.run({ id: t.id, role: 'owner', now });
    });
    this.removeOwnerFile();
    this.audit?.log('owner.transfer', { actor: actorOf(actor), target: ref(t), ip, detail: { from: actor.account.login, to: t.login } });
    this.emit({ account: actor.account.id, refresh: true });
    this.emit({ account: t.id, refresh: true });
  }

  // ---------------------------------------------------------------- two-factor sign-in (I14.7, C77, C81)
  /** The secret store (server/secrets.js, C85): it seals two-factor secrets and the recovery-code key. */
  needBox() {
    if (!this.box || !this.box.ready) throw new AuthError(503, 'secrets_unavailable', 'Two-factor sign-in is not available: this server has no key for stored secrets');
    return this.box;
  }
  unreadable() {
    return new AuthError(409, 'twofa_unreadable', 'Two-factor sign-in cannot be checked on this server because its key is missing. An admin can reset your two-factor sign-in (the owner: node tools/admin.mjs reset-owner)');
  }
  sealSecret(accountId, secret) { return this.needBox().seal(secret, aadTwofa(this.w, accountId)); }
  /** The stored secret, or an AuthError when this server's key cannot open it. */
  openSecret(accountId, sealed) {
    const box = this.needBox();
    try { return box.open(sealed, aadTwofa(this.w, accountId)); } catch { throw this.unreadable(); }
  }
  /**
   * The random HMAC key of the recovery codes, stored sealed like every other secret (C97), so that a copy of the
   * database alone does not let anyone try all codes and key rotations keep them valid. It is created on first use,
   * when the recovery codes release 1.2 keyed differently (none exist) are deleted. null: it does not exist yet.
   */
  recoveryKey(create = false) {
    const box = this.needBox(), key = SECRET_PREFIX + RECOVERY_KEY, aad = aadInstall(this.w, RECOVERY_KEY);
    const row = this.q.settingGet.get({ w: this.w, key });
    if (row) {
      try { return Buffer.from(box.open(row.value, aad), 'base64'); } catch { throw this.unreadable(); }
    }
    if (!create) return null;
    const k = crypto.randomBytes(32);
    this.store.tx(() => {
      this.q.recoveryDelAll.run({ w: this.w });
      this.q.settingPut.run({ w: this.w, key, value: box.seal(k.toString('base64'), aad) });
    });
    return k;
  }
  recoveryHash(code, key) { return crypto.createHmac('sha256', key).update(`recovery|${this.w}|${normalizeRecovery(code)}`).digest('hex'); }
  /** A new, not yet active secret: its key text, the otpauth address and a QR code (SVG) for authenticator apps. */
  twofaSetup(P) {
    const cur = this.q.twofaOf.get({ acc: P.account.id });
    if (cur && cur.enabled_at) throw new AuthError(409, 'twofa_on', 'Two-factor sign-in is already on; turn it off first to set up a new app');
    const secret = newSecret();
    this.q.twofaPut.run({ acc: P.account.id, w: this.w, secret: this.sealSecret(P.account.id, secret), now: this.now() });
    const url = otpauthUrl({ issuer: this.issuer, account: P.account.login, secret });
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    return { secret: secret.replace(/(.{4})/g, '$1 ').trim(), otpauth: url, svg: q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) };
  }
  /** Turns two-factor on after one good code; returns the recovery codes (shown once). */
  twofaEnable(P, code, ip = null) {
    const tf = this.q.twofaOf.get({ acc: P.account.id });
    if (!tf) throw new AuthError(409, 'twofa_setup', 'Start the setup first');
    if (tf.enabled_at) throw new AuthError(409, 'twofa_on', 'Two-factor sign-in is already on');
    const step = verifyTotp(base32Decode(this.openSecret(P.account.id, tf.secret)), code, this.now(), 0);
    if (step === null) throw new AuthError(400, 'bad_code', 'That code is not right. Check the time on your phone, and use the newest code');
    const codes = newRecoveryCodes(), rk = this.recoveryKey(true);
    this.store.tx(() => {
      this.q.twofaOn.run({ acc: P.account.id, now: this.now(), step });
      this.q.recoveryDel.run({ acc: P.account.id });
      for (const c of codes) this.q.recoveryAdd.run({ acc: P.account.id, w: this.w, hash: this.recoveryHash(c, rk) });
    });
    this.audit?.log('twofa.enable', { actor: actorOf(P), target: actorOf(P), ip });
    this.emit({ account: P.account.id, refresh: true });
    return { codes };
  }
  twofaDisable(P, ip = null) {
    const tf = this.q.twofaOf.get({ acc: P.account.id });
    if (!tf || !tf.enabled_at) throw new AuthError(409, 'twofa_off', 'Two-factor sign-in is not on');
    this.store.tx(() => { this.q.twofaDel.run({ acc: P.account.id }); this.q.recoveryDel.run({ acc: P.account.id }); });
    this.audit?.log('twofa.disable', { actor: actorOf(P), target: actorOf(P), ip });
    this.emit({ account: P.account.id, refresh: true });
  }
  twofaRecovery(P, ip = null) {
    const tf = this.q.twofaOf.get({ acc: P.account.id });
    if (!tf || !tf.enabled_at) throw new AuthError(409, 'twofa_off', 'Two-factor sign-in is not on');
    const codes = newRecoveryCodes(), rk = this.recoveryKey(true);
    this.store.tx(() => {
      this.q.recoveryDel.run({ acc: P.account.id });
      for (const c of codes) this.q.recoveryAdd.run({ acc: P.account.id, w: this.w, hash: this.recoveryHash(c, rk) });
    });
    this.audit?.log('twofa.recovery_new', { actor: actorOf(P), target: actorOf(P), ip });
    return { codes };
  }
  twofaStatus(P) {
    const tf = this.q.twofaOf.get({ acc: P.account.id });
    return { on: !!(tf && tf.enabled_at), since: tf?.enabled_at ?? null, recoveryLeft: tf && tf.enabled_at ? this.q.recoveryLeft.get({ acc: P.account.id }).n : 0 };
  }

  // ---------------------------------------------------------------- the own data (I14.7)
  exportData(P, ip = null) {
    const a = this.q.byId.get({ w: this.w, id: P.account.id });
    const data = {
      exported: new Date(this.now()).toISOString(),
      account: { id: a.id, login: a.login, displayName: a.display_name, role: a.role, status: a.status, created: new Date(a.created).toISOString(),
        passwordChanged: a.no_password ? null : new Date(a.password_changed).toISOString(), twofa: this.twofaStatus(P).on },
      devices: this.devices(P).map(d => ({ ...d, created: new Date(d.created).toISOString(), lastSeen: new Date(d.lastSeen).toISOString() })),
      invitesCreated: this.q.invitesByCreator.all({ w: this.w, acc: a.id }).map(r => this.publicInvite(r)),
      auditEvents: this.audit ? this.audit.list({ account: a.id, limit: 5000 }).map(r => ({ ...r, at: new Date(r.at).toISOString() })) : [],
      worldEdits: this.journal ? this.journal.byAccount(a.id) : [],
      friends: this.friends ? this.friends.list(a.id) : null,
      note: 'Agents, connections and chats will be included once they exist (later packages).',
    };
    this.audit?.log('account.export', { actor: ref(a), target: ref(a), ip });
    return data;
  }
  /** Clears the sign-in failure locks of an account (tools/admin.mjs unlock). */
  unlock(login) {
    const a = this.q.byLogin.get({ w: this.w, login: normLogin(login) });
    if (!a) throw new AuthError(404, 'not_found', `No account signs in as "${login}"`);
    this.clearFailures(a.id);
    this.audit?.log('host.unlock', { target: ref(a) });
    return a.login;
  }
  listAdmins() { return this.q.admins.all({ w: this.w }).map(r => ({ id: r.id, login: r.login, displayName: r.display_name, role: r.role, status: r.status })); }

  // ---------------------------------------------------------------- housekeeping
  purgeSessions() {
    const now = this.now();
    this.q.failPurge.run({ w: this.w, now, old: now - LIMITS.windowMs });
    return this.q.purge.run({ w: this.w, idle: now - LIMITS.sessionIdleMs, max: now - LIMITS.sessionMaxMs }).changes;
  }
  clearSessions() {
    const n = this.q.clearSessions.run({ w: this.w }).changes;
    this.audit?.log('host.sessions_clear', { detail: { sessions: Number(n) } });
    return n;
  }
  status() {
    const owner = this.q.owner.get({ w: this.w }), now = this.now();
    return {
      worldId: this.w,
      owner: owner ? { login: owner.login, displayName: owner.display_name, status: owner.status, temporaryPassword: !!owner.must_change,
        tempExpires: owner.must_change ? owner.temp_expires : null, locked: this.lockLeft(`acct:${owner.id}`, now) > 0 } : null,
      accounts: this.q.counts.all({ w: this.w }).map(r => ({ role: r.role, status: r.status, n: r.n })),
      sessions: this.q.sessionCount.get({ w: this.w }).n,
      ownerFile: fs.existsSync(this.ownerFile()),
    };
  }
}
