// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an account is told (docs/features/CHAT.md §8): an agent asking for its OK (an approval), a note from an agent,
// an answer that came while it was away. Each is kept (notifications, schema 28) and shown at once on every page the
// account has open (a 'notify' frame: the bell); when it has none open, it is pushed to the browsers and phones that
// asked for it (Web Push, ./push.js). The server's VAPID key pair is made on first use and kept sealed like every other
// secret (the settings table, 'secret:push.vapid': a key rotation re-seals it).
import { vapidKeys, send as pushSend, checkSubscription } from './push.js';
import { SECRET_PREFIX, aadInstall } from '../secret-holders.js';

const KEEP = 200;                       // notifications kept per account (the oldest go first)
const KEEP_READ_MS = 30 * 86400000;     // read ones, this long
const MAX_FAILS = 5;                    // a subscription that fails this often in a row is dropped
const MAX_DEVICES = 10;                 // browsers and phones per account
const KINDS = new Set(['approval', 'note', 'chat', 'problem', 'system', 'phone', 'pc']);   // (phone: an agent's phone - a text, a missed call, a draft: server/phone/; pc: work an agent did on its PC, server/pc/work.js)
const VAPID = 'push.vapid';
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export class NotifyError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export class Notifications {
  /**
   * o: { box (the SecretBox), send(accountId, frame) (its open pages), online(accountId) (whether it has a page open),
   *      subject () => the VAPID contact (mailto: or https:), allowLocal (tests: a push service on this machine),
   *      push (tests: the sender), log, now }
   */
  constructor(dbs, { box, send, online, subject, allowLocal = false, push = pushSend, log = null, now = () => Date.now() }) {
    Object.assign(this, { db: dbs.db, w: dbs.worldId, box, sendFn: send, online, subject, allowLocal, pushFn: push, log, now });
    const db = this.db;
    this.q = {
      add: db.prepare('INSERT INTO notifications (world_id, account_id, kind, title, body, link_json, created) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      trim: db.prepare('DELETE FROM notifications WHERE world_id = ? AND account_id = ? AND id NOT IN (SELECT id FROM notifications WHERE world_id = ? AND account_id = ? ORDER BY id DESC LIMIT ?)'),
      list: db.prepare('SELECT * FROM notifications WHERE world_id = ? AND account_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
      // (one agent's: what it asked, told or answered - the chat window's Notifications)
      listAgent: db.prepare("SELECT * FROM notifications WHERE world_id = ? AND account_id = ? AND json_extract(link_json, '$.agent') = ? AND id < ? ORDER BY id DESC LIMIT ?"),
      unreadAgent: db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE world_id = ? AND account_id = ? AND json_extract(link_json, '$.agent') = ? AND read_at IS NULL"),
      unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE world_id = ? AND account_id = ? AND read_at IS NULL'),
      readAll: db.prepare('UPDATE notifications SET read_at = ? WHERE world_id = ? AND account_id = ? AND read_at IS NULL'),
      readOne: db.prepare('UPDATE notifications SET read_at = ? WHERE world_id = ? AND account_id = ? AND id = ? AND read_at IS NULL'),
      readApproval: db.prepare("UPDATE notifications SET read_at = ? WHERE world_id = ? AND account_id = ? AND json_extract(link_json, '$.approval') = ? AND read_at IS NULL"),
      readChat: db.prepare("UPDATE notifications SET read_at = ? WHERE world_id = ? AND account_id = ? AND json_extract(link_json, '$.agent') = ? AND (json_extract(link_json, '$.session') = ? OR ? IS NULL) AND read_at IS NULL"),
      purge: db.prepare('DELETE FROM notifications WHERE world_id = ? AND read_at IS NOT NULL AND read_at < ?'),
      subs: db.prepare('SELECT * FROM push_subscriptions WHERE world_id = ? AND account_id = ?'),
      subPut: db.prepare(`INSERT INTO push_subscriptions (world_id, account_id, endpoint, p256dh, auth, device, created) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (world_id, endpoint) DO UPDATE SET account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, fails = 0`),
      subDel: db.prepare('DELETE FROM push_subscriptions WHERE world_id = ? AND account_id = ? AND endpoint = ?'),
      subDelAll: db.prepare('DELETE FROM push_subscriptions WHERE world_id = ? AND account_id = ?'),
      subDrop: db.prepare('DELETE FROM push_subscriptions WHERE id = ?'),
      subOk: db.prepare('UPDATE push_subscriptions SET last_ok = ?, fails = 0 WHERE id = ?'),
      subFail: db.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE id = ?'),
      subCount: db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE world_id = ? AND account_id = ?'),
      keyGet: db.prepare('SELECT value FROM settings WHERE world_id = ? AND key = ?'),
      keyPut: db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?) ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value'),
    };
    this.vapid = null;
    this.stats = { created: 0, pushed: 0, pushFailed: 0, dropped: 0 };
    this.timer = null;
  }
  attach() { this.timer = setInterval(() => this.purge(), 3600000); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); }

  /** The server's VAPID key pair, made and stored sealed on first use. */
  keys() {
    if (this.vapid) return this.vapid;
    const key = SECRET_PREFIX + VAPID, aad = aadInstall(this.w, VAPID);
    const row = this.q.keyGet.get(this.w, key);
    if (row) { this.vapid = JSON.parse(this.box.open(row.value, aad)); return this.vapid; }
    const k = vapidKeys();
    this.q.keyPut.run(this.w, key, this.box.seal(JSON.stringify(k), aad));
    this.vapid = k;
    return k;
  }
  publicKey() { return this.keys().publicKey; }

  view(r) {
    let link = null; try { link = r.link_json ? JSON.parse(r.link_json) : null; } catch { link = null; }
    return { id: r.id, kind: r.kind, title: r.title, body: r.body, link, created: r.created, read: r.read_at !== null };
  }
  /** Tells account `accountId`: kept, shown on its open pages, pushed to its devices when none is open. */
  create(accountId, { kind, title, body = '', link = null }, { push = true } = {}) {
    if (!Number.isInteger(accountId) || accountId < 1) return null;
    const k = KINDS.has(kind) ? kind : 'system', t = clean(title, 120) || 'My Virtual World', b = clean(body, 400);
    const at = this.now(), lj = link ? JSON.stringify(link) : null;
    const id = Number(this.q.add.run(this.w, accountId, k, t, b, lj, at).lastInsertRowid);
    this.q.trim.run(this.w, accountId, this.w, accountId, KEEP);
    this.stats.created++;
    const n = { id, kind: k, title: t, body: b, link, created: at, read: false };
    try { this.sendFn(accountId, { t: 'notify', n, unread: this.unread(accountId) }); } catch { /* no page */ }
    if (push && !this.online(accountId)) this.pushTo(accountId, { title: t, body: b, url: this.urlOf(link), tag: `${k}:${link ? Object.values(link).join(':') : id}` }).catch(() => {});
    return n;
  }
  unread(accountId) { return this.q.unread.get(this.w, accountId).n; }
  /** The newest first; with `agent`, only that agent's (and how many of its are unread: `agentUnread`). */
  list(accountId, { limit = 50, before = null, agent = null } = {}) {
    const b = Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER, n = Math.max(1, Math.min(100, Number(limit) || 50));
    const ag = Number.isInteger(Number(agent)) && Number(agent) > 0 ? Number(agent) : null;
    const rows = ag ? this.q.listAgent.all(this.w, accountId, ag, b, n) : this.q.list.all(this.w, accountId, b, n);
    return { notifications: rows.map(r => this.view(r)), unread: this.unread(accountId), devices: this.q.subCount.get(this.w, accountId).n,
      ...(ag ? { agent: ag, agentUnread: this.q.unreadAgent.get(this.w, accountId, ag).n } : {}) };
  }
  /** Marks read: one (id), all, every one about an approval (answered), or about a chat (opened: agent, session). */
  read(accountId, { id = null, all = false, approval = null, agent = null, session = null } = {}) {
    const at = this.now();
    if (all) this.q.readAll.run(at, this.w, accountId);
    else if (approval) this.q.readApproval.run(at, this.w, accountId, String(approval));
    else if (Number.isInteger(Number(agent)) && Number(agent) > 0) { const s = Number.isInteger(Number(session)) && Number(session) > 0 ? Number(session) : null; this.q.readChat.run(at, this.w, accountId, Number(agent), s, s); }
    else if (Number.isInteger(Number(id)) && Number(id) > 0) this.q.readOne.run(at, this.w, accountId, Number(id));
    const unread = this.unread(accountId);
    try { this.sendFn(accountId, { t: 'notify', read: true, unread }); } catch { /* no page */ }
    return { unread };
  }
  /** Where a notification takes the person (a page link the client and the service worker understand). */
  urlOf(link) {
    if (!link) return '/';
    if (link.approval) return `/?approval=${encodeURIComponent(link.approval)}${link.agent ? `&agent=${link.agent}` : ''}`;
    // (an agent's phone: the conversation or the call it is about)
    if (link.agent && link.phone) return `/?phone=${link.agent}${link.phone.peer ? `&peer=${encodeURIComponent(link.phone.peer)}` : ''}${link.phone.call ? '&calls=1' : ''}`;
    if (link.agent) return `/?chat=${link.agent}${link.session ? `:${link.session}` : ''}`;
    return '/';
  }

  // ------------------------------------------------------------------ devices
  subscribe(accountId, sub, device = '') {
    let s;
    try { s = checkSubscription(sub, { allowLocal: this.allowLocal }); } catch (e) { throw new NotifyError(400, e.code || 'bad_subscription', e.message); }
    const known = this.q.subs.all(this.w, accountId).some(x => x.endpoint === s.endpoint);
    if (!known && this.q.subCount.get(this.w, accountId).n >= MAX_DEVICES) throw new NotifyError(409, 'too_many', `At most ${MAX_DEVICES} devices get notifications; turn them off on one first`);
    this.q.subPut.run(this.w, accountId, s.endpoint, s.p256dh, s.auth, clean(device, 80), this.now());
    return { ok: true, devices: this.q.subCount.get(this.w, accountId).n };
  }
  unsubscribe(accountId, endpoint) {
    this.q.subDel.run(this.w, accountId, String(endpoint || ''));
    return { ok: true, devices: this.q.subCount.get(this.w, accountId).n };
  }
  /** Every device of the account stops being told (signed out everywhere). */
  forgetDevices(accountId) { return Number(this.q.subDelAll.run(this.w, accountId).changes); }
  /** Pushes a message to every device of the account; a gone one (404/410) or one failing MAX_FAILS times is dropped. */
  async pushTo(accountId, msg) {
    const subs = this.q.subs.all(this.w, accountId);
    if (!subs.length) return { sent: 0 };
    const keys = this.keys(), subject = this.subject();
    let sent = 0;
    await Promise.all(subs.map(async s => {
      try {
        const r = await this.pushFn({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, msg, keys, subject, { allowLocal: this.allowLocal, topic: msg.tag ? msg.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : null });
        if (r.status >= 200 && r.status < 300) { this.q.subOk.run(this.now(), s.id); sent++; this.stats.pushed++; return; }
        if (r.status === 404 || r.status === 410) { this.q.subDrop.run(s.id); this.stats.dropped++; return; }
        throw Object.assign(new Error(`HTTP ${r.status}`), { code: 'refused' });
      } catch (e) {
        this.stats.pushFailed++;
        this.q.subFail.run(s.id);
        if (s.fails + 1 >= MAX_FAILS) { this.q.subDrop.run(s.id); this.stats.dropped++; }
        this.log?.warn?.(`[notify] a push failed (${e.code || e.message}); ${s.fails + 1} in a row for that device`);
      }
    }));
    return { sent };
  }
  purge() { try { this.q.purge.run(this.w, this.now() - KEEP_READ_MS); } catch (e) { this.log?.warn?.('[notify] purge failed:', e.message); } }
}
