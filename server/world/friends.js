// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Friends (owner request 2026-09-28, DECISIONS C118): a request the other account accepts or declines; friendship is
// mutual; either side can remove it; the sender can cancel a pending request. Friends are listed first in the online
// list, are told when the other comes online (unless that account appears offline), and can fly to each other.
// One row per pair (a < b): status 'pending' (with who asked) or 'friends'.
import { displayKey } from '../auth/accounts.js';

export const MAX_FRIENDS = 200, MAX_PENDING = 50;

export class FriendError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export class Friends {
  constructor(dbs, { accounts, now = () => Date.now() }) {
    this.dbs = dbs; this.db = dbs.db; this.w = dbs.worldId; this.accounts = accounts; this.now = now;
    this.listeners = new Set();   // (accountId, change) - the server pushes the new list to that account's pages
    const db = this.db;
    this.q = {
      get: db.prepare('SELECT * FROM friends WHERE world_id = ? AND a = ? AND b = ?'),
      put: db.prepare('INSERT INTO friends (world_id, a, b, status, asked_by, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      accept: db.prepare("UPDATE friends SET status = 'friends', updated = ? WHERE world_id = ? AND a = ? AND b = ?"),
      del: db.prepare('DELETE FROM friends WHERE world_id = ? AND a = ? AND b = ?'),
      mine: db.prepare(`SELECT f.*, x.id AS other_id, x.display_name AS other_name FROM friends f
        JOIN accounts x ON x.id = CASE WHEN f.a = $me THEN f.b ELSE f.a END
        WHERE f.world_id = $w AND (f.a = $me OR f.b = $me) AND x.status = 'active' ORDER BY x.display_key`),
      countFriends: db.prepare("SELECT COUNT(*) AS n FROM friends WHERE world_id = ? AND (a = ? OR b = ?) AND status = 'friends'"),
      countAsked: db.prepare("SELECT COUNT(*) AS n FROM friends WHERE world_id = ? AND asked_by = ? AND status = 'pending'"),
      byName: db.prepare("SELECT id, display_name FROM accounts WHERE world_id = ? AND display_key = ? AND status = 'active'"),
      byId: db.prepare("SELECT id, display_name FROM accounts WHERE world_id = ? AND id = ? AND status = 'active'"),
      forget: db.prepare('DELETE FROM friends WHERE world_id = ? AND (a = ? OR b = ?)'),
    };
  }
  pair(x, y) { return x < y ? [x, y] : [y, x]; }
  emit(id, change) { for (const fn of this.listeners) { try { fn(id, change); } catch { /* the listener's problem */ } } }
  /** The other account for a request: by id, or by display name (the same matching as sign-up uses). */
  target(me, { id = null, name = null }) {
    let r = null;
    if (Number.isInteger(id)) r = this.q.byId.get(this.w, id);
    else if (typeof name === 'string' && name.trim()) r = this.q.byName.get(this.w, displayKey(name.trim()));
    if (!r) throw new FriendError(404, 'no_such_player', 'No player by that name');
    if (r.id === me) throw new FriendError(400, 'self', 'That is you');
    return r;
  }
  /** Sends a request, or accepts theirs when they already asked. */
  request(me, who) {
    const o = this.target(me, who), [a, b] = this.pair(me, o.id), row = this.q.get.get(this.w, a, b);
    if (row && row.status === 'friends') throw new FriendError(409, 'already_friends', `You and ${o.display_name} are already friends`);
    if (row && row.asked_by === me) throw new FriendError(409, 'already_asked', `You already asked ${o.display_name}`);
    if (row) return this.accept(me, { id: o.id });   // they asked first: this is a yes
    if (Number(this.q.countAsked.get(this.w, me).n) >= MAX_PENDING) throw new FriendError(429, 'too_many_requests', `At most ${MAX_PENDING} requests can wait at once`);
    if (Number(this.q.countFriends.get(this.w, me, me).n) >= MAX_FRIENDS) throw new FriendError(409, 'too_many_friends', `At most ${MAX_FRIENDS} friends`);
    const t = this.now();
    this.q.put.run(this.w, a, b, 'pending', me, t, t);
    this.emit(me, { kind: 'asked', other: o.id });
    this.emit(o.id, { kind: 'request', other: me });
    return { state: 'pending', other: { id: o.id, name: o.display_name } };
  }
  accept(me, who) {
    const o = this.target(me, who), [a, b] = this.pair(me, o.id), row = this.q.get.get(this.w, a, b);
    if (!row || row.status !== 'pending' || row.asked_by === me) throw new FriendError(404, 'no_request', `${o.display_name} has not asked to be your friend`);
    if (Number(this.q.countFriends.get(this.w, me, me).n) >= MAX_FRIENDS) throw new FriendError(409, 'too_many_friends', `At most ${MAX_FRIENDS} friends`);
    this.q.accept.run(this.now(), this.w, a, b);
    this.emit(me, { kind: 'friends', other: o.id });
    this.emit(o.id, { kind: 'accepted', other: me });
    return { state: 'friends', other: { id: o.id, name: o.display_name } };
  }
  /** Declines their request, cancels mine, or ends a friendship: whatever the pair has, it goes. */
  remove(me, who) {
    const o = this.target(me, who), [a, b] = this.pair(me, o.id), row = this.q.get.get(this.w, a, b);
    if (!row) throw new FriendError(404, 'not_friends', `You and ${o.display_name} are not friends`);
    this.q.del.run(this.w, a, b);
    const kind = row.status === 'friends' ? 'removed' : row.asked_by === me ? 'cancelled' : 'declined';
    this.emit(me, { kind, other: o.id });
    this.emit(o.id, { kind: row.status === 'friends' ? 'removed' : 'gone', other: me });
    return { state: 'none', was: kind, other: { id: o.id, name: o.display_name } };
  }
  /** Everything one account sees: friends, requests to answer, requests it sent. */
  list(me) {
    const out = { friends: [], incoming: [], outgoing: [] };
    for (const r of this.q.mine.all({ w: this.w, me })) {
      const o = { id: r.other_id, name: r.other_name, since: r.updated };
      if (r.status === 'friends') out.friends.push(o);
      else if (r.asked_by === me) out.outgoing.push(o);
      else out.incoming.push(o);
    }
    return out;
  }
  friendIds(me) { return new Set(this.list(me).friends.map(f => f.id)); }
  /** A deleted account leaves every friendship and request. */
  forgetAccount(id) {
    const others = [...this.friendIdsAll(id)];
    this.q.forget.run(this.w, id, id);
    for (const o of others) this.emit(o, { kind: 'gone', other: id });
  }
  friendIdsAll(me) { const l = this.list(me); return new Set([...l.friends, ...l.incoming, ...l.outgoing].map(f => f.id)); }
}
