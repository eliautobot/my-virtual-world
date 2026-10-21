// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The append-only audit log (DECISIONS C74, C75, C78): who did what to which account, when and from which address.
// Rows live in next.db; triggers refuse UPDATE and DELETE (only the recorded retention purge may delete), and each row
// carries a SHA-256 over the previous row's hash and its own fields, so changes made outside the server show up in
// verify(). Details never hold secrets.
import crypto from 'node:crypto';

/** Action names grouped for the viewer's filter (grouping checked by Jev, batch 19, DECISIONS C82). */
export const AUDIT_GROUPS = Object.freeze({
  'sign-in': ['auth.signin', 'auth.signin_failed', 'auth.signout', 'auth.signout_all', 'auth.confirm_failed', 'auth.twofa_failed'],
  accounts: ['account.create', 'account.register', 'account.role', 'account.status', 'account.delete', 'account.name', 'account.login', 'owner.transfer'],
  credentials: ['account.password', 'account.reset', 'account.device_revoke', 'twofa.enable', 'twofa.disable', 'twofa.recovery_new', 'twofa.recovery_used', 'twofa.reset', 'account.secret'],
  invites: ['invite.create', 'invite.revoke', 'invite.accept'],
  settings: ['permissions.set', 'settings.change', 'settings.world', 'settings.security', 'audit.purge'],
  data: ['account.export', 'audit.export', 'world.backup', 'world.restore', 'world.reset_population', 'promo.set'],
  agents: ['agent.slot_create', 'agent.slot_delete', 'agent.enrol', 'agent.enrol_failed', 'agent.signature_failed', 'agent.session_new_address', 'agent.revoke', 'agent.code_new', 'agent.update', 'agent.block', 'agent.unblock', 'agent.report'],
  licence: ['licence.activate', 'licence.deactivate', 'licence.import', 'licence.refused'],
  host: ['host.reset_owner', 'host.unlock', 'host.sessions_clear', 'host.create_account', 'host.rotate_key', 'host.forget_secrets'],
  // the connections to providers, and changes made to a provider from its sub-menu (Agent Providers)
  providers: ['connection.create', 'connection.update', 'connection.remove', 'connection.share', 'connection.unshare', 'provider.change', 'provider.computer'],
});
const FIELDS = ['at', 'actor_id', 'actor_login', 'action', 'target_id', 'target_login', 'ip', 'detail'];
const hashRow = (prev, world, row) => crypto.createHash('sha256').update(JSON.stringify([prev, world, ...FIELDS.map(f => row[f] ?? null)])).digest('hex');
const DAY = 86400000;

export class Audit {
  constructor(store, { now = () => Date.now() } = {}) {
    this.store = store;
    this.w = store.worldId;
    this.now = now;
    const db = store.db;
    this.q = {
      last: db.prepare('SELECT hash FROM audit WHERE world_id = $w ORDER BY id DESC LIMIT 1'),
      insert: db.prepare(`INSERT INTO audit (world_id, at, actor_id, actor_login, action, target_id, target_login, ip, detail, prev_hash, hash)
        VALUES ($w, $at, $actor_id, $actor_login, $action, $target_id, $target_login, $ip, $detail, $prev, $hash)`),
      all: db.prepare('SELECT * FROM audit WHERE world_id = $w ORDER BY id'),
      purgeOn: db.prepare('INSERT INTO audit_purge (ok) VALUES (1)'),
      purgeOff: db.prepare('DELETE FROM audit_purge'),
      purge: db.prepare('DELETE FROM audit WHERE world_id = $w AND at < $before'),
    };
  }
  /**
   * Records one event. actor / target: { id, login } (or null); detail: a small object without secrets.
   */
  log(action, { actor = null, target = null, ip = null, detail = null } = {}) {
    this.store.tx(() => {
      const prev = this.q.last.get({ w: this.w })?.hash || 'genesis';
      const row = {
        at: this.now(), actor_id: actor?.id ?? null, actor_login: actor?.login ?? null, action,
        target_id: target?.id ?? null, target_login: target?.login ?? null, ip: ip ?? null,
        detail: detail ? JSON.stringify(detail).slice(0, 2000) : null,
      };
      this.q.insert.run({ w: this.w, ...row, prev, hash: hashRow(prev, this.w, row) });
    });
  }
  /**
   * Events, newest first. Filters: group (AUDIT_GROUPS key) or action, account (id: as actor or target), from / to
   * (ms), before (id, for paging), limit (default 200, at most 5,000).
   */
  list({ group = null, action = null, account = null, from = null, to = null, before = null, limit = 200 } = {}) {
    const where = ['world_id = ?'], args = [this.w];
    const acts = group && AUDIT_GROUPS[group] ? AUDIT_GROUPS[group] : action ? [action] : null;
    if (acts) { where.push(`action IN (${acts.map(() => '?').join(',')})`); args.push(...acts); }
    if (Number.isInteger(account)) { where.push('(actor_id = ? OR target_id = ?)'); args.push(account, account); }
    if (Number.isFinite(from)) { where.push('at >= ?'); args.push(from); }
    if (Number.isFinite(to)) { where.push('at < ?'); args.push(to); }
    if (Number.isInteger(before)) { where.push('id < ?'); args.push(before); }
    const n = Math.max(1, Math.min(5000, limit | 0 || 200));
    const rows = this.store.db.prepare(`SELECT id, at, actor_id, actor_login, action, target_id, target_login, ip, detail FROM audit
      WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ${n}`).all(...args);
    return rows.map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  }
  /** Checks the hash chain. The first remaining row starts the chain (older rows may have been purged). */
  verify() {
    let prev = null, n = 0;
    for (const r of this.q.all.all({ w: this.w })) {
      if (prev !== null && r.prev_hash !== prev) return { ok: false, rows: n, brokenAt: r.id, why: 'a row is missing or was changed before this one' };
      if (hashRow(r.prev_hash, this.w, r) !== r.hash) return { ok: false, rows: n, brokenAt: r.id, why: 'this row was changed' };
      prev = r.hash;
      n++;
    }
    return { ok: true, rows: n };
  }
  /** Deletes events older than retentionDays and records the purge (C75). Returns how many were deleted. */
  purge(retentionDays, { actor = null } = {}) {
    if (!(retentionDays > 0)) return 0;
    const before = this.now() - retentionDays * DAY;
    let n = 0;
    this.store.tx(() => {
      this.q.purgeOn.run();
      try { n = Number(this.q.purge.run({ w: this.w, before }).changes); } finally { this.q.purgeOff.run(); }
      if (n) this.log('audit.purge', { actor, detail: { deleted: n, before: new Date(before).toISOString(), retentionDays } });
    });
    return n;
  }
  /** The filtered events as CSV or JSON Lines. */
  export(format, filters = {}) {
    const rows = this.list({ ...filters, limit: 5000 });
    if (format === 'jsonl') return rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
    const cell = v => {
      const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;           // no formulas when opened in a spreadsheet
      return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const head = ['id', 'time', 'actor_id', 'actor', 'action', 'target_id', 'target', 'address', 'detail'];
    return [head.join(','), ...rows.map(r => [r.id, new Date(r.at).toISOString(), r.actor_id, r.actor_login, r.action, r.target_id, r.target_login, r.ip, r.detail].map(cell).join(','))].join('\n') + '\n';
  }
}
