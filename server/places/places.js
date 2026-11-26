// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Places (docs/features/places.md): what people think of a building, and a word to its owner — opened from its billboard
// (render/signs.js → ui/sign-panel.js), the way a map's place card is.
// - Reviews: one per account and building, 1–5 stars and words if they want; everyone who can watch the world reads them
//   (signed-out visitors see "A resident" for a name, as on the lot map). The building's average floats over its rooftop
//   billboards. An owner can't review their own place. Administrators can take a review down (the author reads why; it is
//   kept, so writing it again can't undo that) and show it again.
// - Messages: private, to whoever holds the building's lot when they are sent — an account, or for the city's own
//   buildings its administrators — and to nobody else; the owner is told (the bell, and a push when no page is open).
// Both are kept per building index (buildings are never renumbered: a demolished one keeps its index), and an account's
// are deleted with it (forgetAccount) so an account number used again never inherits them.

const REVIEW_MAX = 1000, MESSAGE_MAX = 1000, PAGE = 30;
const clean = (s, n, lines = 0) => {
  let t = String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
  t = lines ? t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim() : t.replace(/\s+/g, ' ').trim();
  if (lines) { const L = t.split('\n'); if (L.length > lines) t = `${L.slice(0, lines).join('\n')} ${L.slice(lines).join(' ')}`; }
  return t.slice(0, n);
};
const round2 = v => Math.round(v * 100) / 100;

export class PlaceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export class Places {
  /**
   * d: { dbs, world() (the world: buildings), property (server/property.js: a lot's holder), perms (Permissions),
   *      notifications?, send?(accountId, frame), broadcast?(frame), audit?, log?, now? }
   */
  constructor(d) {
    Object.assign(this, { d, db: d.dbs.db, w: d.dbs.worldId, now: d.now || (() => Date.now()) });
    const q = sql => this.db.prepare(sql);
    this.q = {
      ratings: q('SELECT building, AVG(stars) AS avg, COUNT(*) AS n FROM place_reviews WHERE world_id = ? AND hidden IS NULL GROUP BY building'),
      rating: q('SELECT AVG(stars) AS avg, COUNT(*) AS n FROM place_reviews WHERE world_id = ? AND building = ? AND hidden IS NULL'),
      dist: q('SELECT stars, COUNT(*) AS n FROM place_reviews WHERE world_id = ? AND building = ? AND hidden IS NULL GROUP BY stars'),
      listNew: q('SELECT * FROM place_reviews WHERE world_id = ? AND building = ? AND hidden IS NULL ORDER BY updated DESC, id DESC LIMIT ? OFFSET ?'),
      listHigh: q('SELECT * FROM place_reviews WHERE world_id = ? AND building = ? AND hidden IS NULL ORDER BY stars DESC, updated DESC, id DESC LIMIT ? OFFSET ?'),
      listLow: q('SELECT * FROM place_reviews WHERE world_id = ? AND building = ? AND hidden IS NULL ORDER BY stars ASC, updated DESC, id DESC LIMIT ? OFFSET ?'),
      listHidden: q('SELECT * FROM place_reviews WHERE world_id = ? AND building = ? AND hidden IS NOT NULL ORDER BY updated DESC LIMIT 50'),
      mine: q('SELECT * FROM place_reviews WHERE world_id = ? AND building = ? AND author_id = ?'),
      byId: q('SELECT * FROM place_reviews WHERE world_id = ? AND id = ?'),
      put: q(`INSERT INTO place_reviews (world_id, building, author_id, stars, text, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (world_id, building, author_id) DO UPDATE SET stars = excluded.stars, text = excluded.text, updated = excluded.updated`),
      del: q('DELETE FROM place_reviews WHERE world_id = ? AND building = ? AND author_id = ?'),
      hide: q('UPDATE place_reviews SET hidden = ? WHERE world_id = ? AND id = ?'),
      name: q('SELECT display_name FROM accounts WHERE world_id = ? AND id = ?'),
      staff: q("SELECT id FROM accounts WHERE world_id = ? AND role IN ('owner', 'admin') AND status = 'active' ORDER BY id LIMIT 20"),
      msgAdd: q('INSERT INTO place_messages (world_id, building, owner_id, author_id, text, created) VALUES (?, ?, ?, ?, ?, ?)'),
      msgOfPlace: q('SELECT * FROM place_messages WHERE world_id = ? AND building = ? AND owner_id IS ? ORDER BY id DESC LIMIT ?'),
      msgAll: q('SELECT * FROM place_messages WHERE world_id = ? AND (owner_id = ? OR (? AND owner_id IS NULL)) ORDER BY id DESC LIMIT ?'),
      msgUnread: q('SELECT COUNT(*) AS n FROM place_messages WHERE world_id = ? AND building = ? AND owner_id IS ? AND read_at IS NULL'),
      msgUnreadAll: q('SELECT COUNT(*) AS n FROM place_messages WHERE world_id = ? AND (owner_id = ? OR (? AND owner_id IS NULL)) AND read_at IS NULL'),
      msgCount: q('SELECT COUNT(*) AS n FROM place_messages WHERE world_id = ? AND building = ? AND owner_id IS ?'),
      msgRead: q('UPDATE place_messages SET read_at = ? WHERE world_id = ? AND building = ? AND owner_id IS ? AND read_at IS NULL'),
      msgById: q('SELECT * FROM place_messages WHERE world_id = ? AND id = ?'),
      msgDel: q('DELETE FROM place_messages WHERE world_id = ? AND id = ?'),
      msgTrim: q('DELETE FROM place_messages WHERE world_id = ? AND building = ? AND owner_id IS ? AND id NOT IN (SELECT id FROM place_messages WHERE world_id = ? AND building = ? AND owner_id IS ? ORDER BY id DESC LIMIT 500)'),
      forgetReviews: q('SELECT DISTINCT building FROM place_reviews WHERE world_id = ? AND author_id = ?'),
      delReviewsBy: q('DELETE FROM place_reviews WHERE world_id = ? AND author_id = ?'),
      delMessagesOf: q('DELETE FROM place_messages WHERE world_id = ? AND (author_id = ? OR owner_id = ?)'),
    };
    this.cache = null;
    this.buckets = new Map();
  }

  // ------------------------------------------------------------------------------------------------ who and where
  building(b) {
    const i = Number(b);
    const B = Number.isInteger(i) && i >= 0 ? this.d.world()?.buildings?.[i] : null;
    if (!B || B.gone) throw new PlaceError(404, 'not_found', 'That place is not in the city any more');
    return B;
  }
  /** Who a place's messages go to: { kind: 'account', id } — or 'city' (the city's own land: its administrators), or
   *  'none' (held by an agent or a business: nobody reads messages for it). */
  ownerOf(B) {
    let lot = null;
    try { lot = B.lot ? this.d.property?.get(B.lot) : null; } catch { lot = null; }
    const h = lot?.holder;
    if (h?.kind === 'account' && Number(h.id) > 0) return { kind: 'account', id: Number(h.id) };
    if (!h || h.kind === 'municipality') return { kind: 'city', id: null };
    return { kind: 'none', id: null };
  }
  isOwner(P, o) {
    if (!P?.account) return false;
    if (o.kind === 'account') return P.account.id === o.id;
    if (o.kind === 'city') return !!this.d.perms?.allowed(P, 'property.admin');
    return false;
  }
  isAdmin(P) { return !!(P?.account && this.d.perms?.allowed(P, 'world.edit')); }
  nameOf(id, P) {
    if (!P?.account) return 'A resident';
    return this.q.name.get(this.w, Number(id))?.display_name || 'A former resident';
  }
  /** A small leaky bucket per account and kind: refill one every `every` ms, at most `burst` at once. */
  brake(kind, id, every, burst) {
    const k = `${kind}:${id}`, now = this.now(), b = this.buckets.get(k) || { t: now, n: 0 };
    b.n = Math.max(0, b.n - (now - b.t) / every); b.t = now;
    if (b.n + 1 > burst) { this.buckets.set(k, b); return true; }
    b.n += 1; this.buckets.set(k, b);
    if (this.buckets.size > 5000) for (const [key, v] of this.buckets) if (now - v.t > 3600e3) this.buckets.delete(key);
    return false;
  }

  // ------------------------------------------------------------------------------------------------ ratings
  /** Every place's average and count ({ [building]: { avg, n } }), for the stars over the billboards. */
  ratings() {
    if (this.cache) return this.cache;
    const W = this.d.world(), out = {};
    for (const r of this.q.ratings.all(this.w)) {
      const B = W?.buildings?.[r.building];
      if (B && !B.gone && r.n > 0) out[r.building] = { avg: round2(r.avg), n: r.n };
    }
    return (this.cache = out);
  }
  ratingOf(b) {
    const r = this.q.rating.get(this.w, b);
    return { avg: r?.n ? round2(r.avg) : 0, n: r?.n || 0 };
  }
  changed(b) {
    this.cache = null;
    const r = this.ratingOf(b);
    try { this.d.broadcast?.({ t: 'place_rating', b, avg: r.avg, n: r.n }); } catch { /* no pages */ }
    return r;
  }

  // ------------------------------------------------------------------------------------------------ reading a place
  view(r, P) {
    return { id: r.id, stars: r.stars, text: r.text, author: { id: P?.account ? r.author_id : null, name: this.nameOf(r.author_id, P) },
      mine: !!(P?.account && P.account.id === r.author_id), created: r.created, updated: r.updated, edited: r.updated - r.created > 60e3,
      ...(r.hidden !== null && r.hidden !== undefined ? { hidden: r.hidden } : {}) };
  }
  /** A place as the caller sees it: its rating, its reviews (newest, highest or lowest first; 30 at a time), the caller's
   *  own review and what they may do; its owner also sees how many messages are waiting. */
  place(P, b, { sort = 'new', offset = 0 } = {}) {
    const B = this.building(b), o = this.ownerOf(B), mine = this.isOwner(P, o);
    const off = Math.max(0, Math.min(5000, Number(offset) || 0));
    const list = (sort === 'high' ? this.q.listHigh : sort === 'low' ? this.q.listLow : this.q.listNew).all(this.w, B.idx, PAGE + 1, off);
    const dist = [0, 0, 0, 0, 0];
    for (const r of this.q.dist.all(this.w, B.idx)) if (r.stars >= 1 && r.stars <= 5) dist[r.stars - 1] = r.n;
    const own = P?.account ? this.q.mine.get(this.w, B.idx, P.account.id) : null;
    const signedIn = !!P?.account, allowed = signedIn && !!this.d.perms?.allowed(P, 'places.review');
    const out = {
      b: B.idx, name: B.name || 'This place', type: B.type || null,
      owner: { kind: o.kind, name: o.kind === 'account' ? this.nameOf(o.id, P) : o.kind === 'city' ? `City of ${this.d.world()?.name || 'the world'}` : 'Its business' },
      mine, rating: { ...this.ratingOf(B.idx), dist },
      reviews: list.slice(0, PAGE).map(r => this.view(r, P)), more: list.length > PAGE, offset: off, sort: ['high', 'low'].includes(sort) ? sort : 'new',
      myReview: own ? this.view(own, P) : null,
      can: { review: allowed && !mine, message: allowed && !mine && o.kind !== 'none', moderate: this.isAdmin(P) },
      signedIn,
    };
    if (mine) out.inbox = { unread: this.q.msgUnread.get(this.w, B.idx, o.id).n, total: this.q.msgCount.get(this.w, B.idx, o.id).n };
    if (out.can.moderate) out.hidden = this.q.listHidden.all(this.w, B.idx).map(r => this.view(r, P));
    return out;
  }

  // ------------------------------------------------------------------------------------------------ reviewing
  review(P, body) {
    if (!P?.account) throw new PlaceError(401, 'signin_required', 'Sign in to leave a review');
    const B = this.building(body?.b), o = this.ownerOf(B);
    if (this.isOwner(P, o)) throw new PlaceError(403, 'own_place', 'You can\'t review your own place');
    const stars = Number(body?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new PlaceError(400, 'bad_stars', 'Choose from 1 to 5 stars');
    const text = clean(body?.text, REVIEW_MAX, 12);
    const was = this.q.mine.get(this.w, B.idx, P.account.id);
    if (was?.hidden) throw new PlaceError(409, 'hidden', `An administrator took your review down: ${was.hidden}`);
    if (this.brake('review', P.account.id, 20e3, 6)) throw new PlaceError(429, 'slow_down', 'Too many reviews at once; wait a moment.');
    const at = this.now();
    this.q.put.run(this.w, B.idx, P.account.id, stars, text, at, at);
    const rating = this.changed(B.idx);
    // the owner hears of a new review (not of every edit)
    if (!was) this.tell(B, o, { title: `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} New review of ${B.name || 'your place'}`, body: `${this.nameOf(P.account.id, P)}${text ? `: ${text}` : ' rated it'}`, tab: 'reviews' }, P.account.id);
    return { ok: true, review: this.view(this.q.mine.get(this.w, B.idx, P.account.id), P), rating };
  }
  unreview(P, body) {
    if (!P?.account) throw new PlaceError(401, 'signin_required', 'Sign in first');
    const B = this.building(body?.b);
    const was = this.q.mine.get(this.w, B.idx, P.account.id);
    if (!was) throw new PlaceError(404, 'not_found', 'You haven\'t reviewed this place');
    if (was.hidden) throw new PlaceError(409, 'hidden', `An administrator took your review down: ${was.hidden}`);
    this.q.del.run(this.w, B.idx, P.account.id);
    return { ok: true, rating: this.changed(B.idx) };
  }
  /** An administrator takes a review down (reason: what its author reads) or shows it again (reason ''). */
  hide(P, body) {
    if (!this.isAdmin(P)) throw new PlaceError(403, 'forbidden', 'Only administrators take reviews down');
    const r = this.q.byId.get(this.w, Number(body?.id));
    if (!r) throw new PlaceError(404, 'not_found', 'No such review');
    const why = clean(body?.reason, 200);
    if (body?.show !== true && !why) throw new PlaceError(400, 'reason_required', 'Say why it is taken down; its author reads it');
    this.q.hide.run(body?.show === true ? null : why, this.w, r.id);
    this.d.audit?.log(body?.show === true ? 'place.review.show' : 'place.review.hide', { actor: { id: P.account.id, login: P.account.login }, target: { id: r.author_id }, detail: { building: r.building, stars: r.stars, text: r.text.slice(0, 300), reason: why || null } });
    return { ok: true, rating: this.changed(r.building) };
  }

  // ------------------------------------------------------------------------------------------------ messages
  message(P, body) {
    if (!P?.account) throw new PlaceError(401, 'signin_required', 'Sign in to leave a message');
    const B = this.building(body?.b), o = this.ownerOf(B);
    if (o.kind === 'none') throw new PlaceError(409, 'no_owner', 'Nobody reads messages for this place');
    if (this.isOwner(P, o)) throw new PlaceError(403, 'own_place', 'This is your own place');
    const text = clean(body?.text, MESSAGE_MAX, 20);
    if (!text) throw new PlaceError(400, 'empty', 'Write a message first');
    if (this.brake('message', P.account.id, 60e3, 5)) throw new PlaceError(429, 'slow_down', 'Too many messages at once; wait a minute.');
    const id = Number(this.q.msgAdd.run(this.w, B.idx, o.id, P.account.id, text, this.now()).lastInsertRowid);
    this.q.msgTrim.run(this.w, B.idx, o.id, this.w, B.idx, o.id);
    this.tell(B, o, { title: `✉ Message about ${B.name || 'your place'}`, body: `${this.nameOf(P.account.id, P)}: ${text}`, tab: 'messages' }, P.account.id);
    return { ok: true, id };
  }
  /** Tells a place's owner (the city's: its administrators) — the bell, a push when no page is open, and a live frame. */
  tell(B, o, { title, body, tab }, except) {
    const to = o.kind === 'account' ? [o.id] : o.kind === 'city' ? this.q.staff.all(this.w).map(r => r.id) : [];
    for (const id of to) {
      if (id === except) continue;
      try { this.d.notifications?.create(id, { kind: 'place', title, body, link: { place: B.idx, tab } }); } catch (e) { this.d.log?.warn?.('[places] could not tell the owner:', e.message); }
      try { this.d.send?.(id, { t: 'place_inbox', b: B.idx, tab }); } catch { /* no page */ }
    }
  }
  msgView(m, P) {
    const B = this.d.world()?.buildings?.[m.building];
    return { id: m.id, b: m.building, place: B && !B.gone ? B.name || 'A place' : 'A place no longer in the city', text: m.text,
      from: { id: m.author_id, name: this.nameOf(m.author_id, P) }, created: m.created, read: m.read_at !== null };
  }
  /** The caller's messages: for one place of theirs (b), or for all of them (and, for administrators, the city's). */
  messages(P, { b = null } = {}) {
    if (!P?.account) throw new PlaceError(401, 'signin_required', 'Sign in first');
    const admin = !!this.d.perms?.allowed(P, 'property.admin');
    if (b !== null && b !== undefined && b !== '') {
      const B = this.building(b), o = this.ownerOf(B);
      if (!this.isOwner(P, o)) throw new PlaceError(403, 'not_yours', 'Only its owner reads the messages left for a place');
      return { b: B.idx, messages: this.q.msgOfPlace.all(this.w, B.idx, o.id, 200).map(m => this.msgView(m, P)), unread: this.q.msgUnread.get(this.w, B.idx, o.id).n };
    }
    return { messages: this.q.msgAll.all(this.w, P.account.id, admin ? 1 : 0, 200).map(m => this.msgView(m, P)), unread: this.q.msgUnreadAll.get(this.w, P.account.id, admin ? 1 : 0).n };
  }
  read(P, body) {
    if (!P?.account) throw new PlaceError(401, 'signin_required', 'Sign in first');
    const B = this.building(body?.b), o = this.ownerOf(B);
    if (!this.isOwner(P, o)) throw new PlaceError(403, 'not_yours', 'Only its owner reads the messages left for a place');
    this.q.msgRead.run(this.now(), this.w, B.idx, o.id);
    return { ok: true, unread: 0 };
  }
  deleteMessage(P, body) {
    if (!P?.account) throw new PlaceError(401, 'signin_required', 'Sign in first');
    const m = this.q.msgById.get(this.w, Number(body?.id));
    const admin = !!this.d.perms?.allowed(P, 'property.admin');
    if (!m || !(m.owner_id === P.account.id || (m.owner_id === null && admin))) throw new PlaceError(404, 'not_found', 'No such message');
    this.q.msgDel.run(this.w, m.id);
    return { ok: true };
  }

  // ------------------------------------------------------------------------------------------------ accounts
  /** An account deleted: its reviews go (the places' ratings follow) and every message it wrote or was sent. */
  forgetAccount(id) {
    const n = Number(id); if (!(n > 0)) return 0;
    const bs = this.q.forgetReviews.all(this.w, n).map(r => r.building);
    this.q.delReviewsBy.run(this.w, n);
    this.q.delMessagesOf.run(this.w, n, n);
    for (const b of bs) this.changed(b);
    return bs.length;
  }
}
