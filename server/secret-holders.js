// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Every place that keeps sealed values, registered with the SecretBox (server/secrets.js; DECISIONS C85, C97, C99), so
// the start-up check, re-sealing after a rotation, forgetting unreadable values and staging copies reach all of them.
// Tables that an older schema lacks are skipped: the deploy tools look at a database before it is migrated.
export const SECRET_PREFIX = 'secret:';
/** The HMAC key of the two-factor recovery codes: random, stored sealed (C97). */
export const RECOVERY_KEY = 'auth.recoveryKey';
export const aadInstall = (w, p) => `${w}|setting|install|${p}`;
export const aadAccount = (w, id, p) => `${w}|setting|account:${id}|${p}`;
/** Two-factor secrets keep release 1.2's binding (world|account), so 1.2 still reads them after a rollback (C93). */
export const aadTwofa = (w, id) => `${w}|${id}`;
/** A connection's credential fields (WP2.2): bound to the connection and the field, so one cannot be moved to another. */
export const aadConnection = (w, id, field) => `${w}|connection:${id}|${field}`;

/** A connected agent's wake-up link (server/agent-wakeup.js): bound to its slot. */
export const aadWakeup = (w, slot) => `${w}|agent-slot:${slot}|wakeup`;

const splitId = id => {
  const s = String(id), i = s.indexOf('|');
  return [Number(s.slice(0, i)), s.slice(i + 1)];
};

/** Registers the holders of this database with box; store = { db, worldId } (openDb() or a plain connection). */
export function registerSecretHolders(box, store) {
  const db = store.db, w = store.worldId;
  const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  if (has('connection_secrets')) {
    box.register({
      name: 'connection credentials', kind: 'connections',
      list: () => db.prepare('SELECT s.connection_id AS cid, s.field, s.sealed, c.label FROM connection_secrets s LEFT JOIN connections c ON c.id = s.connection_id WHERE s.world_id = ?')
        .all(w).map(r => ({ id: `${r.cid}|${r.field}`, sealed: r.sealed, aad: aadConnection(w, r.cid, r.field), label: `${r.field} of the connection ${r.label || r.cid}` })),
      update: (id, sealed) => { const [cid, field] = splitId(id); run('UPDATE connection_secrets SET sealed = ? WHERE world_id = ? AND connection_id = ? AND field = ?', sealed, w, cid, field); },
      forget: id => { const [cid, field] = splitId(id); run('DELETE FROM connection_secrets WHERE world_id = ? AND connection_id = ? AND field = ?', w, cid, field); },
    });
  }
  if (has('agent_wakeups')) {
    box.register({
      name: 'agent wake-up links', kind: 'wakeups',
      list: () => db.prepare('SELECT w.slot_id AS id, w.sealed, s.name FROM agent_wakeups w LEFT JOIN agent_slots s ON s.id = w.slot_id WHERE w.world_id = ?')
        .all(w).map(r => ({ id: r.id, sealed: r.sealed, aad: aadWakeup(w, r.id), label: `the wake-up link of ${r.name || `agent ${r.id}`}` })),
      update: (id, sealed) => run('UPDATE agent_wakeups SET sealed = ? WHERE world_id = ? AND slot_id = ?', sealed, w, Number(id)),
      forget: id => run('DELETE FROM agent_wakeups WHERE world_id = ? AND slot_id = ?', w, Number(id)),
    });
  }
  if (has('twofa')) {
    box.register({
      name: 'two-factor secrets', kind: 'twofa',
      list: () => db.prepare('SELECT t.account_id AS id, t.secret AS sealed, a.login FROM twofa t LEFT JOIN accounts a ON a.id = t.account_id WHERE t.world_id = ?')
        .all(w).map(r => ({ id: r.id, sealed: r.sealed, aad: aadTwofa(w, r.id), label: `the two-factor secret of ${r.login || `account ${r.id}`}` })),
      update: (id, sealed) => run('UPDATE twofa SET secret = ? WHERE account_id = ?', sealed, id),
      forget: id => {
        run('DELETE FROM twofa WHERE account_id = ?', id);
        if (has('recovery_codes')) run('DELETE FROM recovery_codes WHERE account_id = ?', id);
      },
    });
  }
  if (has('settings')) {
    const rk = SECRET_PREFIX + RECOVERY_KEY;
    box.register({
      name: 'recovery-code key', kind: 'recovery',
      list: () => db.prepare('SELECT value FROM settings WHERE world_id = ? AND key = ?').all(w, rk)
        .map(r => ({ id: RECOVERY_KEY, sealed: r.value, aad: aadInstall(w, RECOVERY_KEY), label: 'the recovery-code key' })),
      update: (id, sealed) => run('UPDATE settings SET value = ? WHERE world_id = ? AND key = ?', sealed, w, rk),
      forget: () => {
        run('DELETE FROM settings WHERE world_id = ? AND key = ?', w, rk);
        // Recovery codes cannot be checked without their key.
        if (has('recovery_codes')) run('DELETE FROM recovery_codes WHERE account_id IN (SELECT id FROM accounts WHERE world_id = ?)', w);
      },
    });
    box.register({
      name: 'installation secrets', kind: 'install',
      list: () => db.prepare("SELECT key, value FROM settings WHERE world_id = ? AND key LIKE 'secret:%' AND key <> ?").all(w, rk)
        .map(r => {
          const p = r.key.slice(SECRET_PREFIX.length);
          return { id: p, sealed: r.value, aad: aadInstall(w, p), label: `the installation setting ${p}` };
        }),
      update: (p, sealed) => run('UPDATE settings SET value = ? WHERE world_id = ? AND key = ?', sealed, w, SECRET_PREFIX + p),
      forget: p => run('DELETE FROM settings WHERE world_id = ? AND key = ?', w, SECRET_PREFIX + p),
    });
  }
  if (has('account_settings')) {
    box.register({
      name: 'account secrets', kind: 'account',
      list: () => db.prepare(`SELECT s.account_id, s.key, s.value, a.login FROM account_settings s LEFT JOIN accounts a ON a.id = s.account_id
        WHERE s.world_id = ? AND s.key LIKE 'secret:%'`).all(w)
        .map(r => {
          const p = r.key.slice(SECRET_PREFIX.length);
          return { id: `${r.account_id}|${p}`, sealed: r.value, aad: aadAccount(w, r.account_id, p), label: `${p} of ${r.login || `account ${r.account_id}`}` };
        }),
      update: (id, sealed) => { const [acc, p] = splitId(id); run('UPDATE account_settings SET value = ? WHERE account_id = ? AND key = ?', sealed, acc, SECRET_PREFIX + p); },
      forget: id => { const [acc, p] = splitId(id); run('DELETE FROM account_settings WHERE account_id = ? AND key = ?', acc, SECRET_PREFIX + p); },
    });
  }
  return box;
}
