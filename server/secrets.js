// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The key for stored secrets and the encrypted-field service (PLAN WP1.5; DECISIONS C85–C88, C93, C95, C97).
// The key comes from MVW_SECRET_KEY or from the key file named by MVW_KEY_FILE, exactly one of them, never from inside
// the data folder, so backups and copies of the data do not carry it. Every place that keeps sealed values registers
// as a holder, so the start-up check, re-sealing after a rotation and forgetting unreadable values reach all of them.
// Sealed values look like "v1:<iv>:<ciphertext>:<tag>:<key fingerprint>" (AES-256-GCM, bound to where they are
// stored). Release 1.2 wrote them without the fingerprint, and reads this form too (rollbacks, C93).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class KeyConfigError extends Error {}
export class SealError extends Error {}

/** How often the server looks at its key file (rotate-key writes a new one while it runs; C87). */
export const KEY_POLL_MS = 2000;   // how often the key file is checked by default (MVW_KEY_POLL_MS, server/config.js)
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const NO_KEY_HELP = 'No key for stored secrets. Set MVW_KEY_FILE to the absolute path of a file outside the data folder (the server creates it, '
  + 'readable only by its user, when it does not exist yet), or MVW_SECRET_KEY to a 32-byte key in base64 '
  + '(node tools/admin.mjs new-key <file> writes one). Back the key up separately from the data: without it, stored '
  + 'secrets are lost.';

/** A new random 32-byte key. */
export const newKey = () => crypto.randomBytes(32);
/** A short public name for a key: 12 hex characters of a hash of it (it reveals nothing about the key). */
export const fingerprint = key => crypto.createHash('sha256').update('my-virtual-world secret key\n').update(key).digest('hex').slice(0, 12);

export function parseKey(text, where) {
  const t = String(text ?? '').trim();
  if (!KEY_RE.test(t)) throw new KeyConfigError(`${where} is not a 32-byte key in base64 (44 characters, ending in "=")`);
  return Buffer.from(t, 'base64');
}

/** The keys in a key file: the current key, then the previous one if any, one per line. */
export function readKeyFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new KeyConfigError(`Cannot read the key file ${file}: ${e.message}`); }
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (lines.length < 1 || lines.length > 2) throw new KeyConfigError(`The key file ${file} must hold one key, or the current and the previous key, one per line`);
  return lines.map((l, i) => parseKey(l, `The key file ${file}, line ${i + 1},`));
}

/** Writes a key file (mode 0600) in one step: a new file next to it, renamed over the old one; exclusive: only when
 *  it does not exist yet. The current key comes first, which is also what release 1.2 reads. */
export function writeKeyFile(file, keys, { exclusive = false } = {}) {
  const text = keys.map(k => k.toString('base64')).join('\n') + '\n';
  const write = target => {
    const fd = fs.openSync(target, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (exclusive) return write(file);
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    write(tmp);
    fs.renameSync(tmp, file);
  } catch (e) {
    throw new KeyConfigError(`Cannot write the key file ${file}: ${e.message}`);
  }
}

function realOrResolved(p) {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch { /* it may not exist yet */ }
  try { return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { return abs; }
}
/** Whether child is parent or lies inside it. */
export function isInside(child, parent) {
  const r = path.relative(realOrResolved(parent), realOrResolved(child));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

/** Where the key comes from (C86, C95): { source: 'env' | 'file', file }. */
export function keySource(env, dataDir) {
  const hasEnv = !!String(env.MVW_SECRET_KEY || '').trim(), hasFile = !!String(env.MVW_KEY_FILE || '').trim();
  if (hasEnv && hasFile) throw new KeyConfigError('Both MVW_SECRET_KEY and MVW_KEY_FILE are set: set only one of them.');
  if (!hasEnv && !hasFile) throw new KeyConfigError(NO_KEY_HELP);
  if (hasEnv) return { source: 'env', file: null };
  const given = String(env.MVW_KEY_FILE).trim();
  if (!path.isAbsolute(given)) {
    throw new KeyConfigError(`MVW_KEY_FILE must be an absolute path, not "${given}": a relative path depends on the folder each program `
      + 'starts in, and the service runs from the current release\'s folder, which later promotions delete (DECISIONS C101).');
  }
  const file = realOrResolved(given);
  if (dataDir && isInside(file, dataDir)) {
    throw new KeyConfigError(`MVW_KEY_FILE (${file}) lies inside the data folder, so every copy of the data would carry the key. `
      + 'Move it outside the data folder (for example next to it), or use MVW_SECRET_KEY.');
  }
  return { source: 'file', file };
}

/** A key file readable by others is tightened to 0600 when this user owns it, otherwise reported (C95). */
export function checkKeyFileMode(file) {
  const st = fs.statSync(file);
  if (!(st.mode & 0o077)) return [];
  if (typeof process.getuid === 'function' && st.uid === process.getuid()) {
    try {
      fs.chmodSync(file, 0o600);
      return [`the key file ${file} was readable by other users; it is now readable only by its owner (0600)`];
    } catch { /* a read-only file system */ }
  }
  return [`the key file ${file} is readable by other users (mode ${(st.mode & 0o777).toString(8)}); make it readable only by the server's user, unless it is a read-only secret managed elsewhere (for example a Docker secret)`];
}

/** What to do when stored secrets cannot be opened (C88). */
export function unreadableHelp(bad, box) {
  const byFp = new Map();
  for (const b of bad) byFp.set(b.fp || '', (byFp.get(b.fp || '') || 0) + 1);
  const what = [...byFp].map(([fp, n]) => (fp ? `${n} sealed with key ${fp}` : `${n} without a key fingerprint (written by release 1.2)`)).join(', ');
  const loaded = box.fps.length ? `The loaded key${box.fps.length > 1 ? 's are' : ' is'} ${box.fps.join(' and ')}. ` : '';
  const where = box.source === 'env' ? 'MVW_SECRET_KEY' : 'MVW_KEY_FILE';
  return `The database holds secrets this server cannot open: ${what}. ${loaded}Point ${where} at the key that sealed them `
    + '(a backup restored on another machine needs its key too), or delete them with: node tools/admin.mjs forget-secrets '
    + '--unreadable (the accounts concerned set up two-factor sign-in again).';
}

export class SecretBox {
  constructor() {
    this.keys = [];
    this.fps = [];
    this.holders = [];
    this.known = new Set();   // secret values this process handled: the logger and settings responses scrub them
    this.source = null;
    this.file = null;
    this.watching = null;
  }
  get ready() { return this.keys.length > 0; }
  setKeys(keys) {
    this.keys = [...keys];
    this.fps = this.keys.map(fingerprint);
  }
  /**
   * @param {object} h  a place that keeps sealed values
   * @param {string} h.name
   * @param {function} h.list    () => [{ id, sealed, aad, label }]
   * @param {function} h.update  (id, sealed) => void
   * @param {function} h.forget  (id) => void: deletes the value (and what depends on it)
   */
  /** h.kind (optional) names the holder for the tools: twofa, recovery, install, account. */
  register(h) {
    for (const f of ['name', 'list', 'update', 'forget']) if (!h[f]) throw new Error(`secret holder: ${f} is missing`);
    this.holders.push(h);
    return this;
  }
  remember(v) { if (typeof v === 'string' && v.length >= 8) this.known.add(v); }
  seal(plain, aad) {
    if (!this.ready) throw new SealError('no key for stored secrets is loaded');
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', this.keys[0], iv);
    c.setAAD(Buffer.from(String(aad)));
    const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
    this.remember(String(plain));
    return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url'), this.fps[0]].join(':');
  }
  static fingerprintOf(sealed) {
    const p = String(sealed ?? '').split(':');
    return p[0] === 'v1' && p.length === 5 ? p[4] : null;
  }
  open(sealed, aad) {
    const p = String(sealed ?? '').split(':');
    if (p[0] !== 'v1' || (p.length !== 4 && p.length !== 5)) throw new SealError('not a sealed value');
    const fp = p[4] || null;
    let plain = this.tryOpen(p, fp, aad);
    // Sealed with a key this process has not loaded yet: a rotation may just have written it (C87), so look now.
    if (plain === null && fp && !this.fps.includes(fp) && this.checkNow && !this.inCheck) {
      this.checkNow();
      plain = this.tryOpen(p, fp, aad);
    }
    if (plain === null) throw new SealError(fp && !this.fps.includes(fp) ? `sealed with key ${fp}, which is not loaded` : 'cannot be opened with the loaded keys');
    this.remember(plain);
    return plain;
  }
  tryOpen(p, fp, aad) {
    const keys = fp ? this.keys.filter((k, i) => this.fps[i] === fp) : this.keys;
    for (const key of keys) {
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(p[1], 'base64url'));
        d.setAAD(Buffer.from(String(aad)));
        d.setAuthTag(Buffer.from(p[3], 'base64url'));
        return Buffer.concat([d.update(Buffer.from(p[2], 'base64url')), d.final()]).toString('utf8');
      } catch { /* try the next key */ }
    }
    return null;
  }
  /** What the admin Settings screen shows: where the key comes from, the fingerprints, and a problem if any (C98). */
  status() { return { source: this.source, fingerprints: [...this.fps], problem: this.problem || null }; }
  /** Every sealed value of every holder: [{ holder, id, sealed, aad, label }]. */
  values() {
    const out = [];
    for (const h of this.holders) for (const v of h.list()) out.push({ holder: h, ...v });
    return out;
  }
  /** The values the loaded keys cannot open: [{ holder, id, label, fp }]. */
  unreadable() {
    const bad = [];
    for (const v of this.values()) {
      try { this.open(v.sealed, v.aad); } catch { bad.push({ holder: v.holder, id: v.id, label: v.label, fp: SecretBox.fingerprintOf(v.sealed) }); }
    }
    return bad;
  }
  /** Re-seals, with the current key, every value sealed with another loaded key. Returns how many. */
  reseal(tx = fn => fn()) {
    if (!this.ready) return 0;
    return tx(() => {
      let n = 0;
      for (const v of this.values()) {
        if (SecretBox.fingerprintOf(v.sealed) === this.fps[0]) continue;
        let plain;
        try { plain = this.open(v.sealed, v.aad); } catch { continue; }
        v.holder.update(v.id, this.seal(plain, v.aad));
        n++;
      }
      return n;
    });
  }
  /** Deletes the given values (from unreadable() or values()). */
  forget(list, tx = fn => fn()) {
    return tx(() => {
      for (const v of list) v.holder.forget(v.id);
      return list.length;
    });
  }
  /**
   * Loads the key (C86): MVW_SECRET_KEY (+ MVW_SECRET_KEY_PREVIOUS) or the key file, which is created (0600) when it
   * does not exist and nothing is sealed yet. Throws KeyConfigError with what to do.
   * @returns {{ source, file, created, warnings: string[] }}
   */
  load({ env = process.env, dataDir = null, create = true } = {}) {
    const { source, file } = keySource(env, dataDir);
    const warnings = [];
    let keys, created = false;
    if (source === 'env') {
      keys = [parseKey(env.MVW_SECRET_KEY, 'MVW_SECRET_KEY')];
      if (String(env.MVW_SECRET_KEY_PREVIOUS || '').trim()) keys.push(parseKey(env.MVW_SECRET_KEY_PREVIOUS, 'MVW_SECRET_KEY_PREVIOUS'));
      warnings.push('the key comes from MVW_SECRET_KEY: other programs of this user, the service manager and docker inspect can read '
        + 'environment variables; a key file (MVW_KEY_FILE; with Docker, a secret file) is readable only by its owner (DECISIONS C101)');
    } else {
      if (String(env.MVW_SECRET_KEY_PREVIOUS || '').trim()) warnings.push('MVW_SECRET_KEY_PREVIOUS is ignored: with MVW_KEY_FILE, the previous key is the second line of the key file');
      if (!fs.existsSync(file)) {
        const n = this.values().length;
        if (n) {
          throw new KeyConfigError(`The key file ${file} (MVW_KEY_FILE) does not exist, but the database holds ${n} sealed secret${n === 1 ? '' : 's'}. `
            + 'Point MVW_KEY_FILE at the key file that belongs to this data, or delete the secrets with: node tools/admin.mjs forget-secrets --all --yes '
            + '(the accounts concerned set up two-factor sign-in again).');
        }
        if (!create) throw new KeyConfigError(`The key file ${file} (MVW_KEY_FILE) does not exist`);
        writeKeyFile(file, [newKey()], { exclusive: true });
        created = true;
      }
      warnings.push(...checkKeyFileMode(file));
      keys = readKeyFile(file);
    }
    this.source = source;
    this.file = file;
    this.setKeys(keys);
    return { source, file, created, warnings };
  }
  /**
   * Follows the key file while the server runs (C87): new keys are taken when they open every stored value, and values
   * are then re-sealed with the new current key. Keys that cannot open everything are taken only when a rotation
   * recorded the new key's fingerprint first (expectedKey): what is left is then opened with the keys loaded before and
   * sealed with the new one. Otherwise the loaded keys stay, and an error is logged every minute until the file is
   * fixed (C98); status() reports it to admins.
   */
  watch({ tx, log, intervalMs = KEY_POLL_MS, expectedKey = () => null }) {
    if (this.source !== 'file' || this.watching) return;
    const file = this.file;
    let lastComplaint = 0;
    const complain = (msg, shown = msg) => {
      this.problem = shown;   // admins see this (status()); the log gets the details
      const now = Date.now();
      if (now - lastComplaint < 60000) return;
      lastComplaint = now;
      (log.error || log)(`[secrets] ${msg}`);
    };
    const settle = () => { lastComplaint = 0; this.problem = null; };
    const check = () => {
      if (this.inCheck) return;
      this.inCheck = true;
      try {
        let keys;
        try { keys = readKeyFile(file); } catch (e) { return complain(`the key file cannot be read (${e.message}); keeping the keys loaded before`, 'the key file cannot be read; keeping the keys loaded before'); }
        const fps = keys.map(fingerprint);
        if (fps.join() === this.fps.join()) return settle();
        const before = this.keys;
        this.setKeys(keys);
        const bad = this.unreadable();
        if (bad.length) {
          if (expectedKey() === fps[0]) {
            this.setKeys([...keys, ...before.filter(k => !fps.includes(fingerprint(k)))]);
            const n = this.reseal(tx);
            this.setKeys(keys);
            settle();
            return log(`[secrets] the key file changed to the recorded new key ${fps[0]}; ${n} value${n === 1 ? '' : 's'} re-sealed with it`);
          }
          this.setKeys(before);
          return complain(`the key file changed to key ${fps.join(' / ')}, which cannot open ${bad.length} stored secret${bad.length === 1 ? '' : 's'}; keeping the keys loaded before (${this.fps.join(' / ')}) until it is fixed`);
        }
        settle();
        const n = this.reseal(tx);
        log(`[secrets] the key file changed: current key ${fps[0]}${fps[1] ? `, previous ${fps[1]}` : ''}; ${n} value${n === 1 ? '' : 's'} re-sealed`);
      } finally {
        this.inCheck = false;
      }
    };
    this.checkNow = check;
    // Stat polling notices a file replaced by a rename (how rotate-key writes it); the timer re-checks a broken file,
    // so the error keeps being logged (once a minute) until it is fixed.
    const listener = () => check();
    fs.watchFile(file, { interval: intervalMs, persistent: false }, listener);
    const timer = setInterval(() => { if (this.problem) check(); }, Math.max(intervalMs, 1000));
    timer.unref();
    this.watching = { file, listener, timer };
  }
  unwatch() {
    if (!this.watching) return;
    fs.unwatchFile(this.watching.file, this.watching.listener);
    clearInterval(this.watching.timer);
    this.watching = null;
    this.checkNow = null;
  }
}
