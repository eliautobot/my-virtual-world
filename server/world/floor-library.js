// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Saved floor layouts (floor layouts, 2026-10-04: "users can save/archive floor layouts in case they want to
// apply/rebuild/or share it ... apply a layout to other similarly zoned buildings"). A layout belongs to the account that
// saved it and is private to it; its owner shares it with players by username, and they may apply it too (a public
// catalogue comes later). What is kept: the floor's furniture, inner walls, floor areas and apartment units, local to the
// floor (shared/edit.js layoutToSave), the kind of floor it suits (floorUse) and the size it was made for, so op
// lvl.apply can fit it onto another floor (shared/edit.js fitSaved).

const MAX_PER_ACCOUNT = 200, MAX_JSON = 512 * 1024, MAX_NAME = 40, MAX_SHARES = 50;
const clean = s => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME);

export class LibraryError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export class FloorLibrary {
  /** @param {{ db, worldId }} dbs */
  constructor(dbs) {
    const db = this.db = dbs.db;
    this.dbs = dbs; this.w = dbs.worldId;
    this.q = {
      one: db.prepare('SELECT * FROM floor_layouts WHERE world_id = ? AND id = ?'),
      mine: db.prepare('SELECT id, owner_id, name, use, w, d, pieces, created, updated FROM floor_layouts WHERE world_id = ? AND owner_id = ? ORDER BY updated DESC'),
      count: db.prepare('SELECT COUNT(*) AS n FROM floor_layouts WHERE world_id = ? AND owner_id = ?'),
      sharedTo: db.prepare(`SELECT l.id, l.owner_id, l.name, l.use, l.w, l.d, l.pieces, l.created, l.updated, a.display_name AS owner_name
        FROM floor_layout_shares s JOIN floor_layouts l ON l.id = s.layout_id LEFT JOIN accounts a ON a.world_id = l.world_id AND a.id = l.owner_id
        WHERE s.world_id = ? AND s.account_id = ? ORDER BY s.at DESC`),
      sharesOf: db.prepare(`SELECT s.account_id, a.display_name, a.login FROM floor_layout_shares s LEFT JOIN accounts a ON a.world_id = s.world_id AND a.id = s.account_id
        WHERE s.world_id = ? AND s.layout_id = ? ORDER BY s.at`),
      isShared: db.prepare('SELECT 1 FROM floor_layout_shares WHERE world_id = ? AND layout_id = ? AND account_id = ?'),
      nShares: db.prepare('SELECT COUNT(*) AS n FROM floor_layout_shares WHERE world_id = ? AND layout_id = ?'),
      add: db.prepare('INSERT INTO floor_layouts (world_id, owner_id, name, use, w, d, pieces, json, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      rename: db.prepare('UPDATE floor_layouts SET name = ?, updated = ? WHERE world_id = ? AND id = ?'),
      del: db.prepare('DELETE FROM floor_layouts WHERE world_id = ? AND id = ?'),
      delShares: db.prepare('DELETE FROM floor_layout_shares WHERE world_id = ? AND layout_id = ?'),
      share: db.prepare('INSERT OR IGNORE INTO floor_layout_shares (layout_id, world_id, account_id, at) VALUES (?, ?, ?, ?)'),
      unshare: db.prepare('DELETE FROM floor_layout_shares WHERE world_id = ? AND layout_id = ? AND account_id = ?'),
    };
  }
  summary(r) { return { id: r.id, owner: r.owner_id, name: r.name, use: r.use, w: r.w, d: r.d, pieces: r.pieces, created: r.created, updated: r.updated, ...(r.owner_name !== undefined ? { ownerName: r.owner_name || 'A former account' } : {}) }; }
  /** The caller's own layouts (with whom each is shared) and the ones shared with them. */
  list(accountId) {
    const mine = this.q.mine.all(this.w, accountId).map(r => ({ ...this.summary(r), shares: this.q.sharesOf.all(this.w, r.id).map(s => ({ id: s.account_id, name: s.display_name || 'A former account', login: s.login || null })) }));
    return { mine, shared: this.q.sharedTo.all(this.w, accountId).map(r => this.summary(r)) };
  }
  /** A layout the account may use (its own, or shared with it), with its content; null otherwise. */
  usable(id, accountId) {
    const r = this.q.one.get(this.w, Number(id));
    if (!r || (r.owner_id !== accountId && !this.q.isShared.get(this.w, r.id, accountId))) return null;
    return { ...this.summary(r), layout: JSON.parse(r.json) };
  }
  own(id, accountId) {
    const r = this.q.one.get(this.w, Number(id));
    if (!r || r.owner_id !== accountId) throw new LibraryError(404, 'not_found', 'No such saved layout');
    return r;
  }
  /** Saves layout (shared/edit.js layoutToSave) made on a floor of kind `use`, w × d. Returns the new summary. */
  save(accountId, { name, use, w, d, layout }) {
    const nm = clean(name);
    if (!nm) throw new LibraryError(400, 'input', 'Give the layout a name');
    if (this.q.count.get(this.w, accountId).n >= MAX_PER_ACCOUNT) throw new LibraryError(400, 'full', `You can keep up to ${MAX_PER_ACCOUNT} layouts; delete some first`);
    const json = JSON.stringify(layout);
    if (json.length > MAX_JSON) throw new LibraryError(400, 'too_big', 'That floor is too big to save');
    const now = Date.now(), r = this.q.add.run(this.w, accountId, nm, String(use), +w, +d, (layout.items || []).length, json, now, now);
    return this.summary(this.q.one.get(this.w, Number(r.lastInsertRowid)));
  }
  rename(id, accountId, name) {
    const r = this.own(id, accountId), nm = clean(name);
    if (!nm) throw new LibraryError(400, 'input', 'Give the layout a name');
    this.q.rename.run(nm, Date.now(), this.w, r.id);
    return this.summary(this.q.one.get(this.w, r.id));
  }
  remove(id, accountId) {
    const r = this.own(id, accountId);
    this.dbs.tx(() => { this.q.delShares.run(this.w, r.id); this.q.del.run(this.w, r.id); });
    return { id: r.id };
  }
  share(id, accountId, toId) {
    const r = this.own(id, accountId);
    if (toId === accountId) throw new LibraryError(400, 'input', 'That is your own account');
    if (this.q.nShares.get(this.w, r.id).n >= MAX_SHARES) throw new LibraryError(400, 'full', `A layout can be shared with up to ${MAX_SHARES} players`);
    this.q.share.run(r.id, this.w, toId, Date.now());
    return { id: r.id };
  }
  /** The owner takes a share back, or the player it was shared with drops it from their list. */
  unshare(id, accountId, fromId) {
    const r = this.q.one.get(this.w, Number(id));
    if (!r || (r.owner_id !== accountId && fromId !== accountId)) throw new LibraryError(404, 'not_found', 'No such saved layout');
    this.q.unshare.run(this.w, r.id, fromId);
    return { id: r.id };
  }
}
