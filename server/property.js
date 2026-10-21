// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Property (WP4.13, wp4-world-spec.md §5, DECISIONS E25): lots, their title and its append-only history, tenure state,
// delegated rights, access and the rules that decide who may change what. Every change runs in one database
// transaction with a revision check, is idempotent under a caller-supplied key bound to actor + payload, writes its
// title events and an audit entry in the same transaction, and either happens completely or not at all.
// Geometry and lot rules come from shared/lots.js (exact integer micrometres, BigInt arithmetic).
import crypto from 'node:crypto';
import { normalize, area2, bbox, overlaps, contains, checkMerge, checkUnmerge, checkPartition, DEFAULT_LOT_POLICY } from '../shared/lots.js';

export const MUNICIPALITY = Object.freeze({ kind: 'municipality', id: 'city' });
const SUBJECT_KINDS = new Set(['account', 'agent', 'business', 'municipality']);
const LIFECYCLES = new Set(['unreleased', 'available', 'reserved', 'owned', 'leased', 'permit', 'municipal', 'custodial', 'retired']);
const ACCESS = new Set(['public', 'friends', 'private']);
/** Rights a holder may delegate on a lot (spec §5.0). */
export const LOT_RIGHTS = Object.freeze(['build', 'furnish', 'decorate', 'manage']);

export class PropertyError extends Error {
  constructor(code, message, status = 400, detail = null) { super(message); this.code = code; this.status = status; this.detail = detail; }
}
const subj = s => {
  if (!s || !SUBJECT_KINDS.has(s.kind) || s.id === undefined || s.id === null || String(s.id) === '') throw new PropertyError('subject', 'Unknown owner.');
  return { kind: s.kind, id: String(s.id) };
};
const sameSubj = (a, b) => !!a && !!b && a.kind === b.kind && String(a.id) === String(b.id);
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');

export class Property {
  /**
   * @param {object} dbs   openDb() result (db, worldId, tx)
   * @param {object} [o]   { audit, policy (lot policy overrides), now, idPrefix }
   */
  constructor(dbs, { audit = null, policy = null, now = () => Date.now(), log = null } = {}) {
    this.dbs = dbs; this.db = dbs.db; this.w = dbs.worldId; this.audit = audit; this.now = now; this.log = log;
    this.policy = Object.freeze({ ...DEFAULT_LOT_POLICY, ...(policy || {}) });
    const db = this.db;
    this.q = {
      lot: db.prepare('SELECT * FROM lots WHERE world_id = ? AND id = ?'),
      title: db.prepare('SELECT * FROM lot_titles WHERE lot_id = ?'),
      active: db.prepare("SELECT * FROM lots WHERE world_id = ? AND lifecycle != 'retired' ORDER BY id"),
      inBox: db.prepare("SELECT * FROM lots WHERE world_id = ? AND lifecycle != 'retired' AND x0 <= ? AND x1 >= ? AND z0 <= ? AND z1 >= ?"),
      ofHolder: db.prepare("SELECT l.* FROM lots l JOIN lot_titles t ON t.lot_id = l.id WHERE l.world_id = ? AND l.lifecycle != 'retired' AND t.holder_kind = ? AND t.holder_id = ? ORDER BY l.id"),
      insertLot: db.prepare(`INSERT INTO lots (id, world_id, region, block, poly_json, area_twice, x0, z0, x1, z1, zoning, lifecycle, origins, parents_json, frontage_json, access, policy_version, revision, created)
        VALUES ($id, $w, $region, $block, $poly, $area, $x0, $z0, $x1, $z1, $zoning, $lifecycle, $origins, $parents, $frontage, $access, 1, 1, $at)`),
      setLifecycle: db.prepare('UPDATE lots SET lifecycle = $lifecycle, revision = revision + 1 WHERE id = $id AND world_id = $w AND revision = $rev'),
      retire: db.prepare("UPDATE lots SET lifecycle = 'retired', retired = $at, children_json = $children, revision = revision + 1 WHERE id = $id AND world_id = $w AND revision = $rev"),
      unretire: db.prepare("UPDATE lots SET lifecycle = $lifecycle, retired = NULL, children_json = NULL, revision = revision + 1 WHERE id = $id AND world_id = $w AND revision = $rev"),
      setAccess: db.prepare('UPDATE lots SET access = $access, revision = revision + 1 WHERE id = $id AND world_id = $w AND revision = $rev'),
      setZoning: db.prepare('UPDATE lots SET zoning = $zoning, revision = revision + 1 WHERE id = $id AND world_id = $w AND revision = $rev'),
      nameNew: db.prepare('UPDATE lots SET name = $name, note = $note WHERE id = $id AND world_id = $w'),
      setInfo: db.prepare('UPDATE lots SET name = $name, note = $note, revision = revision + 1 WHERE id = $id AND world_id = $w AND revision = $rev'),
      upsertTitle: db.prepare(`INSERT INTO lot_titles (lot_id, world_id, holder_kind, holder_id, event_seq, since) VALUES ($lot, $w, $kind, $hid, $seq, $at)
        ON CONFLICT (lot_id) DO UPDATE SET holder_kind = excluded.holder_kind, holder_id = excluded.holder_id, event_seq = excluded.event_seq, since = excluded.since`),
      event: db.prepare(`INSERT INTO title_events (world_id, lot_id, kind, from_kind, from_id, to_kind, to_id, related_json, actor_kind, actor_id, account_id, reason, idem_key, tx_ref, corrects, at)
        VALUES ($w, $lot, $kind, $fk, $fid, $tk, $tid, $related, $ak, $aid, $acc, $reason, $idem, $tx, $corrects, $at)`),
      history: db.prepare('SELECT * FROM title_events WHERE world_id = ? AND lot_id = ? ORDER BY seq'),
      allEvents: db.prepare('SELECT * FROM title_events WHERE world_id = ? ORDER BY seq'),
      delegations: db.prepare('SELECT * FROM lot_delegations WHERE world_id = ? AND lot_id = ?'),
      delegation: db.prepare('SELECT * FROM lot_delegations WHERE world_id = ? AND lot_id = ? AND subject_kind = ? AND subject_id = ?'),
      sharedWith: db.prepare('SELECT lot_id, rights FROM lot_delegations WHERE world_id = ? AND subject_kind = ? AND subject_id = ? ORDER BY lot_id'),
      putDelegation: db.prepare(`INSERT INTO lot_delegations (lot_id, world_id, subject_kind, subject_id, rights, granted_by, at) VALUES ($lot, $w, $k, $id, $rights, $by, $at)
        ON CONFLICT (lot_id, subject_kind, subject_id) DO UPDATE SET rights = excluded.rights, granted_by = excluded.granted_by, at = excluded.at`),
      dropDelegation: db.prepare('DELETE FROM lot_delegations WHERE world_id = ? AND lot_id = ? AND subject_kind = ? AND subject_id = ?'),
      dropAllDelegations: db.prepare('DELETE FROM lot_delegations WHERE world_id = ? AND lot_id = ?'),
      opGet: db.prepare('SELECT * FROM property_ops WHERE world_id = ? AND key = ?'),
      opPut: db.prepare('INSERT INTO property_ops (key, world_id, actor, payload_hash, result_json, at) VALUES (?, ?, ?, ?, ?, ?)'),
      maxId: db.prepare("SELECT id FROM lots WHERE world_id = ? AND id LIKE 'L%'"),
      count: db.prepare("SELECT COUNT(*) AS n FROM lots WHERE world_id = ? AND lifecycle != 'retired'"),
    };
  }

  // ------------------------------------------------------------------------------------------------ reading
  /** A lot with its current holder, or null. */
  get(id) {
    const r = this.q.lot.get(this.w, String(id));
    return r ? this._row(r) : null;
  }
  _row(r) {
    const t = this.q.title.get(r.id);
    return {
      id: r.id, region: r.region, block: r.block, poly: JSON.parse(r.poly_json), areaTwice: BigInt(r.area_twice), bbox: { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 },
      zoning: r.zoning, lifecycle: r.lifecycle, origins: r.origins, parents: r.parents_json ? JSON.parse(r.parents_json) : [], children: r.children_json ? JSON.parse(r.children_json) : [],
      frontage: r.frontage_json ? JSON.parse(r.frontage_json) : [], access: r.access, revision: r.revision, created: r.created, retired: r.retired || null,
      name: r.name || null, note: r.note || null,
      holder: t ? { kind: t.holder_kind, id: t.holder_id } : null, holderSince: t ? t.since : null,
    };
  }
  /** Every lot in use (not retired). */
  all() { return this.q.active.all(this.w).map(r => this._row(r)); }
  count() { return this.q.count.get(this.w).n; }
  /** Lots whose bounding box meets a box (µm). */
  inBox(b) { return this.q.inBox.all(this.w, b.x1, b.x0, b.z1, b.z0).map(r => this._row(r)); }
  /** Lots held by a subject. */
  heldBy(s) { const h = subj(s); return this.q.ofHolder.all(this.w, h.kind, h.id).map(r => this._row(r)); }
  history(id) { return this.q.history.all(this.w, String(id)).map(e => ({ ...e, related: e.related_json ? JSON.parse(e.related_json) : null })); }
  /** The lots whose holders shared rights with subject s: [{ id, rights }]. */
  sharedWith(s) { const h = subj(s); return this.q.sharedWith.all(this.w, h.kind, h.id).map(d => ({ id: d.lot_id, rights: d.rights.split(',') })); }
  delegations(id) { return this.q.delegations.all(this.w, String(id)).map(d => ({ subject: { kind: d.subject_kind, id: d.subject_id }, rights: d.rights.split(','), grantedBy: d.granted_by, at: d.at })); }
  /** The lots a footprint polygon (µm) lies on, with how it lies: [{ lot, inside }]. */
  under(poly) {
    const P = normalize(poly), b = bbox(P), out = [];
    for (const l of this.inBox(b)) if (overlaps(l.poly, P)) out.push({ lot: l, inside: contains(l.poly, P) });
    return out;
  }

  // ------------------------------------------------------------------------------------------------ rights
  /**
   * May `actor` do `right` on lot `id`? Holders do everything on their own lot; delegates what they were given;
   * administrators act for the municipality on municipal land and moderate elsewhere (spec §5.0).
   * actor: { subject, admin }. right: 'build' | 'furnish' | 'decorate' | 'manage' | 'merge' | 'transfer'.
   */
  can(actor, id, right) {
    const lot = typeof id === 'object' ? id : this.get(id);
    if (!lot || lot.lifecycle === 'retired') return false;
    if (actor?.admin && lot.holder && sameSubj(lot.holder, MUNICIPALITY)) return true;
    if (!actor?.subject) return false;
    if (lot.holder && sameSubj(lot.holder, actor.subject)) return lot.lifecycle !== 'custodial';
    if (right === 'merge' || right === 'transfer') return false;
    const d = this.q.delegation.get(this.w, lot.id, actor.subject.kind, String(actor.subject.id));
    return !!d && d.rights.split(',').includes(right);
  }

  // ------------------------------------------------------------------------------------------------ writing
  /**
   * Runs one property operation: idempotency (same key + same actor + same payload → the stored result; same key with
   * anything different → refused), one transaction, the audit entry. fn returns the result object.
   */
  _op(name, { actor, key = null, payload = {} }, fn) {
    const who = actor?.subject ? `${actor.subject.kind}:${actor.subject.id}` : actor?.admin ? 'admin' : 'system';
    const ph = hash({ name, payload });
    return this.dbs.tx(() => {
      if (key) {
        const prev = this.q.opGet.get(this.w, String(key));
        if (prev) {
          if (prev.actor !== who || prev.payload_hash !== ph) throw new PropertyError('idempotency', 'This request key was already used for a different request.', 409);
          return { ...JSON.parse(prev.result_json), replayed: true };
        }
      }
      const result = fn();
      if (key) this.q.opPut.run(String(key), this.w, who, ph, JSON.stringify(result, (k, v) => (typeof v === 'bigint' ? v.toString() : v)), this.now());
      if (this.audit) this.audit.log(`property.${name}`, { actor: actor?.account ? { id: actor.account.id, login: actor.account.login } : null, detail: { ...payload, result: summary(result) } });
      return result;
    });
  }
  _event(lotId, kind, { from = null, to = null, related = null, actor, reason, key = null, tx = null, corrects = null }) {
    const a = actor?.subject || (actor?.admin ? { kind: 'account', id: String(actor.account?.id ?? 'admin') } : MUNICIPALITY);
    const r = this.q.event.run({ w: this.w, lot: lotId, kind, fk: from?.kind ?? null, fid: from ? String(from.id) : null, tk: to?.kind ?? null, tid: to ? String(to.id) : null,
      related: related ? JSON.stringify(related) : null, ak: a.kind, aid: String(a.id), acc: actor?.account?.id ?? null, reason: String(reason || '').slice(0, 300) || kind,
      idem: key, tx, corrects, at: this.now() });
    return Number(r.lastInsertRowid);
  }
  _setTitle(lotId, holder, seq) { this.q.upsertTitle.run({ lot: lotId, w: this.w, kind: holder.kind, hid: String(holder.id), seq, at: this.now() }); }
  _nextIds(n) {
    let max = 0;
    for (const r of this.q.maxId.all(this.w)) { const v = parseInt(r.id.slice(1), 36); if (Number.isFinite(v) && v > max) max = v; }
    return Array.from({ length: n }, (_, k) => 'L' + (max + 1 + k).toString(36).toUpperCase().padStart(5, '0'));
  }
  _lock(id, rev) {
    const lot = this.get(id);
    if (!lot) throw new PropertyError('missing', `Lot ${id} doesn't exist.`, 404);
    if (rev !== undefined && rev !== null && lot.revision !== rev) throw new PropertyError('stale', `Lot ${id} changed since you looked at it; reload and try again.`, 409, { revision: lot.revision });
    return lot;
  }

  /**
   * Administrators plat new lots (spec §5.5): exact polygons that overlap no existing lot, granted to `holder` (the
   * municipality by default). lots: [{ poly, block?, region?, zoning?, frontage?, access?, lifecycle? }]. Returns ids.
   */
  plat(lots, { actor, key = null, holder = MUNICIPALITY, reason = 'Platted' } = {}) {
    if (!actor?.admin) throw new PropertyError('rights', 'Only administrators can create lots.', 403);
    if (!Array.isArray(lots) || !lots.length) throw new PropertyError('input', 'No lots to create.');
    const h = subj(holder);
    const polys = lots.map(l => normalize(l.poly));
    return this._op('plat', { actor, key, payload: { polys, holder: h } }, () => {
      const probs = checkPartition(polys.map((p, i) => ({ id: `new${i}`, poly: p })));
      if (probs.length) throw new PropertyError('overlap', probs[0].message, 409);
      for (const p of polys) for (const ex of this.inBox(bbox(p))) if (overlaps(ex.poly, p)) throw new PropertyError('overlap', `The new lot overlaps lot ${ex.id}.`, 409);
      const ids = this._nextIds(polys.length), at = this.now();
      polys.forEach((p, i) => {
        const l = lots[i], b = bbox(p);
        const lifecycle = l.lifecycle || (sameSubj(h, MUNICIPALITY) ? 'municipal' : 'owned');
        if (!LIFECYCLES.has(lifecycle) || lifecycle === 'retired') throw new PropertyError('input', 'Bad lot state.');
        if (l.access && !ACCESS.has(l.access)) throw new PropertyError('input', 'Bad access setting.');
        this.q.insertLot.run({ id: ids[i], w: this.w, region: String(l.region || 'main'), block: Number.isInteger(l.block) ? l.block : null, poly: JSON.stringify(p), area: area2(p).toString(),
          x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, zoning: String(l.zoning || 'mixed'), lifecycle, origins: 1, parents: null, frontage: l.frontage ? JSON.stringify(l.frontage) : null,
          access: l.access || 'public', at });
        const seq = this._event(ids[i], 'grant', { to: h, actor, reason, key });
        this._setTitle(ids[i], h, seq);
      });
      return { ids };
    });
  }

  /**
   * A new world's lots from its starting map (server/world/starter.js): each keeps its id (the buildings on it name it),
   * granted to the municipality. Only into a world without lots. lots: [{ id, poly, block?, region?, zoning?, frontage?,
   * access?, lifecycle?, name?, note? }]. Returns ids.
   */
  seed(lots, { reason = 'The starting map' } = {}) {
    if (!Array.isArray(lots) || !lots.length) return { ids: [] };
    if (this.q.maxId.all(this.w).length) throw new PropertyError('input', 'This world has lots already.', 409);
    const polys = lots.map(l => normalize(l.poly));
    const probs = checkPartition(polys.map((p, i) => ({ id: lots[i].id, poly: p })));
    if (probs.length) throw new PropertyError('overlap', probs[0].message, 409);
    const actor = { admin: true, subject: MUNICIPALITY };
    return this._op('seed', { actor, payload: { lots: lots.length } }, () => {
      const at = this.now(), ids = [];
      lots.forEach((l, i) => {
        const id = String(l.id || ''), p = polys[i], b = bbox(p), lifecycle = l.lifecycle || 'municipal';
        if (!/^L[0-9A-Z]{5}$/.test(id)) throw new PropertyError('input', `Bad lot id ${id}.`);
        if (!LIFECYCLES.has(lifecycle) || lifecycle === 'retired') throw new PropertyError('input', 'Bad lot state.');
        if (l.access && !ACCESS.has(l.access)) throw new PropertyError('input', 'Bad access setting.');
        this.q.insertLot.run({ id, w: this.w, region: String(l.region || 'main'), block: Number.isInteger(l.block) ? l.block : null, poly: JSON.stringify(p), area: area2(p).toString(),
          x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, zoning: String(l.zoning || 'mixed'), lifecycle, origins: 1, parents: null, frontage: l.frontage ? JSON.stringify(l.frontage) : null,
          access: l.access || 'public', at });
        if (l.name || l.note) this.q.setInfo.run({ id, w: this.w, rev: 1, name: String(l.name || '').slice(0, 80), note: String(l.note || '').slice(0, 500) });
        this._setTitle(id, MUNICIPALITY, this._event(id, 'grant', { to: MUNICIPALITY, actor, reason }));
        ids.push(id);
      });
      return { ids };
    });
  }

  /**
   * Administrators retire lots the city holds that nothing stands on (a platting mistake, land given back to nature):
   * they leave the map but keep their history (spec §5.5). inUse(id): whether a building stands on lot id.
   */
  retire(ids, { actor, key = null, reason = 'Retired', inUse = () => false } = {}) {
    if (!actor?.admin) throw new PropertyError('rights', 'Only administrators can retire lots.', 403);
    if (!Array.isArray(ids) || !ids.length || ids.length > 5000) throw new PropertyError('input', 'No lots to retire.');
    return this._op('retire', { actor, key, payload: { ids } }, () => {
      const at = this.now();
      for (const id of ids) {
        const lot = this._lock(String(id));
        if (!sameSubj(lot.holder, MUNICIPALITY) || !['municipal', 'available', 'unreleased'].includes(lot.lifecycle)) throw new PropertyError('holder', `Lot ${lot.id} isn't unused city land; only those can be retired.`, 409);
        if (inUse(lot.id)) throw new PropertyError('in_use', `A building stands on lot ${lot.id}.`, 409);
        this._event(lot.id, 'retire', { from: lot.holder, actor, reason, key });
        if (this.q.retire.run({ at, children: JSON.stringify([]), id: lot.id, w: this.w, rev: lot.revision }).changes !== 1) throw new PropertyError('stale', 'A lot changed meanwhile.', 409);
        this.q.dropAllDelegations.run(this.w, lot.id);
      }
      return { ids: ids.map(String) };
    });
  }

  /**
   * Transfer title (administrators in WP4; sales arrive with the Land Sales package and call this inside their own
   * settlement transaction). Refused for leased, listed, held or retired lots.
   */
  transfer(id, to, { actor, key = null, revision, reason = 'Transfer', lifecycle = null, tx = null } = {}) {
    if (!actor?.admin) throw new PropertyError('rights', 'Only administrators can transfer lots for now.', 403);
    const dest = subj(to);
    return this._op('transfer', { actor, key, payload: { id, to: dest, revision, lifecycle } }, () => {
      const lot = this._lock(id, revision);
      if (!['owned', 'municipal', 'available', 'unreleased', 'custodial'].includes(lot.lifecycle)) throw new PropertyError('state', `Lot ${id} is ${lot.lifecycle} and can't be transferred now.`, 409);
      const next = lifecycle || (sameSubj(dest, MUNICIPALITY) ? 'municipal' : 'owned');
      if (!LIFECYCLES.has(next) || next === 'retired') throw new PropertyError('input', 'Bad lot state.');
      const seq = this._event(lot.id, 'transfer', { from: lot.holder, to: dest, actor, reason, key, tx });
      this._setTitle(lot.id, dest, seq);
      if (this.q.setLifecycle.run({ lifecycle: next, id: lot.id, w: this.w, rev: lot.revision }).changes !== 1) throw new PropertyError('stale', 'The lot changed meanwhile.', 409);
      this.q.dropAllDelegations.run(this.w, lot.id);   // a new holder starts with no inherited delegations
      return { id: lot.id, holder: dest, revision: lot.revision + 1 };
    });
  }

  /**
   * Merge lots into one (spec §5.5): holders up to policy.maxMergeLots original lots side by side in an allowed shape;
   * administrators without the holder limits. The parents are retired with links to the new lot (lineage).
   */
  merge(ids, { actor, key = null, revisions = null, reason = 'Merged' } = {}) {
    return this._op('merge', { actor, key, payload: { ids, revisions } }, () => {
      const lots = ids.map((id, i) => this._lock(id, revisions ? revisions[i] : undefined));
      const admin = !!actor?.admin && lots.every(l => sameSubj(l.holder, MUNICIPALITY));
      const res = checkMerge(lots.map(l => ({ ...l, encumbrances: l.lifecycle === 'leased' || l.lifecycle === 'reserved' ? [l.lifecycle] : [] })), { actor: actor?.subject, admin, policy: this.policy });
      if (!res.ok) throw new PropertyError(res.problems[0].code, res.problems[0].message, res.problems[0].code === 'rights' || res.problems[0].code === 'holder' ? 403 : 409, { problems: res.problems });
      const holder = lots[0].holder, [nid] = this._nextIds(1), b = bbox(res.merged.poly), at = this.now();
      this.q.insertLot.run({ id: nid, w: this.w, region: lots[0].region, block: lots.every(l => l.block === lots[0].block) ? lots[0].block : null, poly: JSON.stringify(res.merged.poly),
        area: res.merged.areaTwice.toString(), x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, zoning: lots[0].zoning, lifecycle: lots[0].lifecycle, origins: res.merged.origins,
        parents: JSON.stringify(lots.map(l => l.id)), frontage: JSON.stringify(lots.flatMap(l => l.frontage)), access: lots[0].access, at });
      const named = lots.find(l => l.name);   // the merged lot keeps the first name its lots had
      if (named) this.q.nameNew.run({ name: named.name, note: named.note || null, id: nid, w: this.w });
      for (const l of lots) {
        this._event(l.id, 'merge', { from: holder, to: holder, related: { into: nid }, actor, reason, key });
        if (this.q.retire.run({ at, children: JSON.stringify([nid]), id: l.id, w: this.w, rev: l.revision }).changes !== 1) throw new PropertyError('stale', 'A lot changed meanwhile.', 409);
        this.q.dropAllDelegations.run(this.w, l.id);
      }
      const seq = this._event(nid, 'merge', { to: holder, related: { from: lots.map(l => l.id) }, actor, reason, key });
      this._setTitle(nid, holder, seq);
      return { id: nid, parents: lots.map(l => l.id), origins: res.merged.origins };
    });
  }

  /**
   * Split a merged lot back into exactly the original lots it was made from, through any earlier merges (spec §5.5). footprints: the polygons of buildings
   * standing on it (from the world), so a building never ends up across a lot line. The originals come back to life
   * with the merged lot's holder and lifecycle.
   */
  unmerge(id, { actor, key = null, revision, footprints = [], reason = 'Split back into its original lots' } = {}) {
    return this._op('unmerge', { actor, key, payload: { id, revision } }, () => {
      const lot = this._lock(id, revision);
      if (!lot.parents.length) throw new PropertyError('lineage', 'This lot was never merged.', 409);
      const originals = this._originals(lot);
      if (originals.some(o => !o || o.lifecycle !== 'retired')) throw new PropertyError('lineage', 'The original lots are not available.', 409);
      const admin = !!actor?.admin && sameSubj(lot.holder, MUNICIPALITY);
      const res = checkUnmerge({ ...lot, encumbrances: lot.lifecycle === 'leased' || lot.lifecycle === 'reserved' ? [lot.lifecycle] : [] }, originals.map(o => o.poly), footprints, { actor: actor?.subject, admin });
      if (!res.ok) throw new PropertyError(res.problems[0].code, res.problems[0].message, res.problems[0].code === 'rights' ? 403 : 409, { problems: res.problems });
      const into = originals.map(o => o.id);
      this._event(lot.id, 'split', { from: lot.holder, to: lot.holder, related: { into }, actor, reason, key });
      if (this.q.retire.run({ at: this.now(), children: JSON.stringify(into), id: lot.id, w: this.w, rev: lot.revision }).changes !== 1) throw new PropertyError('stale', 'The lot changed meanwhile.', 409);
      this.q.dropAllDelegations.run(this.w, lot.id);
      for (const o of originals) {
        if (this.q.unretire.run({ lifecycle: lot.lifecycle, id: o.id, w: this.w, rev: o.revision }).changes !== 1) throw new PropertyError('stale', 'An original lot changed meanwhile.', 409);
        const seq = this._event(o.id, 'split', { to: lot.holder, related: { from: lot.id }, actor, reason, key });
        this._setTitle(o.id, lot.holder, seq);
      }
      return { ids: into, from: lot.id };
    });
  }
  /** The original (never merged) lots a merged lot was built from, following its lineage through earlier merges. */
  _originals(lot) {
    const out = [], seen = new Set(), walk = id => {
      if (seen.has(id)) return; seen.add(id);
      const l = this.get(id);
      if (!l) { out.push(null); return; }
      if (l.parents.length && l.origins > 1) for (const p of l.parents) walk(p); else out.push(l);
    };
    for (const p of lot.parents) walk(p);
    return out;
  }

  /** Holders choose who may enter their lot and its buildings (spec E25(8c) defaults). */
  setAccess(id, access, { actor, key = null, revision } = {}) {
    if (!ACCESS.has(access)) throw new PropertyError('input', 'Access must be public, friends or private.');
    return this._op('access', { actor, key, payload: { id, access, revision } }, () => {
      const lot = this._lock(id, revision);
      if (!this.can(actor, lot, 'manage')) throw new PropertyError('rights', 'Only the lot\'s holder can change who may enter.', 403);
      this.q.setAccess.run({ access, id: lot.id, w: this.w, rev: lot.revision });
      return { id: lot.id, access, revision: lot.revision + 1 };
    });
  }
  /** Holders name their lot and write a short note about it (shown on the map and the lot's card). */
  setInfo(id, { name = '', note = '' } = {}, { actor, key = null, revision } = {}) {
    const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
    const nm = clean(name, 40), nt = clean(note, 200);
    return this._op('info', { actor, key, payload: { id, nm, nt, revision } }, () => {
      const lot = this._lock(id, revision);
      if (!this.can(actor, lot, 'manage')) throw new PropertyError('rights', 'Only the lot\'s holder can name it.', 403);
      this.q.setInfo.run({ name: nm || null, note: nt || null, id: lot.id, w: this.w, rev: lot.revision });
      return { id: lot.id, name: nm || null, note: nt || null, revision: lot.revision + 1 };
    });
  }
  /** Administrators put the city's land up for sale (available) or take it off sale (municipal) — the city keeps the
   *  title either way; selling itself arrives with the land-sales package (spec §5.8). */
  offer(id, on, { actor, key = null, revision } = {}) {
    if (!actor?.admin) throw new PropertyError('rights', 'Only administrators put city land up for sale.', 403);
    return this._op(on ? 'offer' : 'withdraw', { actor, key, payload: { id, on: !!on, revision } }, () => {
      const lot = this._lock(id, revision);
      if (!lot.holder || !sameSubj(lot.holder, MUNICIPALITY)) throw new PropertyError('holder', `Lot ${lot.id} isn't the city's to sell.`, 409);
      const ok = on ? ['municipal', 'unreleased'].includes(lot.lifecycle) : lot.lifecycle === 'available';
      if (!ok) throw new PropertyError('state', on ? `Lot ${lot.id} is ${lot.lifecycle} and can't be put up for sale.` : `Lot ${lot.id} isn't for sale.`, 409);
      const next = on ? 'available' : 'municipal';
      if (this.q.setLifecycle.run({ lifecycle: next, id: lot.id, w: this.w, rev: lot.revision }).changes !== 1) throw new PropertyError('stale', 'The lot changed meanwhile.', 409);
      return { id: lot.id, lifecycle: next, revision: lot.revision + 1 };
    });
  }
  /** Administrators set zoning (spec §5.0). */
  setZoning(id, zoning, { actor, key = null, revision } = {}) {
    if (!actor?.admin) throw new PropertyError('rights', 'Only administrators can change zoning.', 403);
    const z = String(zoning || '').trim().slice(0, 32);
    if (!/^[a-z][a-z0-9-]*$/.test(z)) throw new PropertyError('input', 'Bad zoning name.');
    return this._op('zoning', { actor, key, payload: { id, z, revision } }, () => {
      const lot = this._lock(id, revision);
      this.q.setZoning.run({ zoning: z, id: lot.id, w: this.w, rev: lot.revision });
      return { id: lot.id, zoning: z, revision: lot.revision + 1 };
    });
  }
  /** Holders delegate rights on their lot to someone else, or change/revoke them (empty rights). */
  delegate(id, to, rights, { actor, key = null } = {}) {
    const s = subj(to), list = [...new Set((rights || []).map(String))];
    if (list.some(r => !LOT_RIGHTS.includes(r))) throw new PropertyError('input', `Rights are: ${LOT_RIGHTS.join(', ')}.`);
    return this._op('delegate', { actor, key, payload: { id, to: s, list } }, () => {
      const lot = this._lock(id);
      if (!(lot.holder && actor?.subject && sameSubj(lot.holder, actor.subject)) && !(actor?.admin && sameSubj(lot.holder, MUNICIPALITY))) throw new PropertyError('rights', 'Only the lot\'s holder can share rights on it.', 403);
      if (sameSubj(s, lot.holder)) throw new PropertyError('input', 'The holder already has every right.');
      if (list.length) this.q.putDelegation.run({ lot: lot.id, w: this.w, k: s.kind, id: s.id, rights: list.join(','), by: `${lot.holder.kind}:${lot.holder.id}`, at: this.now() });
      else this.q.dropDelegation.run(this.w, lot.id, s.kind, s.id);
      return { id: lot.id, to: s, rights: list };
    });
  }
  /** Custodial hold (account deletion without a transfer, disputes): the holder keeps title but can't act on the lot. */
  hold(id, { actor, key = null, revision, reason } = {}) {
    if (!actor?.admin) throw new PropertyError('rights', 'Only administrators can hold a lot.', 403);
    if (!reason) throw new PropertyError('input', 'Give a reason for the hold.');
    return this._op('hold', { actor, key, payload: { id, revision, reason } }, () => {
      const lot = this._lock(id, revision);
      if (lot.lifecycle === 'custodial' || lot.lifecycle === 'retired') throw new PropertyError('state', `Lot ${id} is ${lot.lifecycle}.`, 409);
      this._event(lot.id, 'custodial_hold', { from: lot.holder, to: lot.holder, related: { was: lot.lifecycle }, actor, reason, key });
      this.q.setLifecycle.run({ lifecycle: 'custodial', id: lot.id, w: this.w, rev: lot.revision });
      return { id: lot.id, lifecycle: 'custodial' };
    });
  }
  release(id, { actor, key = null, revision, reason } = {}) {
    if (!actor?.admin) throw new PropertyError('rights', 'Only administrators can release a hold.', 403);
    return this._op('release', { actor, key, payload: { id, revision, reason } }, () => {
      const lot = this._lock(id, revision);
      if (lot.lifecycle !== 'custodial') throw new PropertyError('state', `Lot ${id} isn't held.`, 409);
      const was = this.history(lot.id).reverse().find(e => e.kind === 'custodial_hold')?.related?.was || (sameSubj(lot.holder, MUNICIPALITY) ? 'municipal' : 'owned');
      this._event(lot.id, 'release_hold', { from: lot.holder, to: lot.holder, actor, reason: reason || 'Hold released', key });
      this.q.setLifecycle.run({ lifecycle: was, id: lot.id, w: this.w, rev: lot.revision });
      return { id: lot.id, lifecycle: was };
    });
  }

  // ------------------------------------------------------------------------------------------------ land sales
  // The economy's realty (server/economy/realty.js: lots bought for Virtual Coin) settles sales through these three,
  // inside its own transaction (spec §5.8): no route reaches them directly, so their only rights check is the realty's.
  /**
   * Holds a lot for one buyer while they pay: it becomes `reserved` (merges, splits and transfers wait) and keeps its
   * title. seller: the holder the sale expects (anyone else holding it now means the listing is stale). Returns what
   * the lot was, to go back to.
   */
  reserve(id, { seller, buyer, ref, key = null } = {}) {
    const s = subj(seller);
    return this._op('reserve', { actor: { subject: buyer ? subj(buyer) : null }, key, payload: { id, seller: s, ref } }, () => {
      const lot = this._lock(id);
      if (!lot.holder || !sameSubj(lot.holder, s)) throw new PropertyError('holder', `Lot ${lot.id} changed hands; it isn't for sale by this seller any more.`, 409);
      if (!['available', 'owned'].includes(lot.lifecycle)) throw new PropertyError('state', lot.lifecycle === 'reserved' ? `Lot ${lot.id} is being bought by someone else right now.` : `Lot ${lot.id} is ${lot.lifecycle} and can't be sold now.`, 409);
      if (this.q.setLifecycle.run({ lifecycle: 'reserved', id: lot.id, w: this.w, rev: lot.revision }).changes !== 1) throw new PropertyError('stale', 'The lot changed meanwhile.', 409);
      return { id: lot.id, was: lot.lifecycle, revision: lot.revision + 1 };
    });
  }
  /** Lets a reserved lot go back to what it was (a checkout that expired or was cancelled, an offer that lapsed). */
  unreserve(id, was, { key = null } = {}) {
    if (!['available', 'owned'].includes(was)) throw new PropertyError('input', 'Bad lot state.');
    return this._op('unreserve', { actor: null, key, payload: { id, was } }, () => {
      const lot = this._lock(id);
      if (lot.lifecycle !== 'reserved') return { id: lot.id, lifecycle: lot.lifecycle, revision: lot.revision };
      if (this.q.setLifecycle.run({ lifecycle: was, id: lot.id, w: this.w, rev: lot.revision }).changes !== 1) throw new PropertyError('stale', 'The lot changed meanwhile.', 409);
      return { id: lot.id, lifecycle: was, revision: lot.revision + 1 };
    });
  }
  /**
   * Completes a paid sale: the reserved lot's title passes from seller to buyer (a transfer in its history that names
   * the order), it becomes `owned`, and rights the seller shared on it end.
   */
  sell(id, { seller, buyer, order, reason, key = null } = {}) {
    const s = subj(seller), b = subj(buyer);
    return this._op('sell', { actor: { subject: b }, key, payload: { id, seller: s, buyer: b, order } }, () => {
      const lot = this._lock(id);
      if (lot.lifecycle !== 'reserved') throw new PropertyError('state', `Lot ${lot.id} isn't held for this sale.`, 409);
      if (!lot.holder || !sameSubj(lot.holder, s)) throw new PropertyError('holder', `Lot ${lot.id} changed hands before the sale completed.`, 409);
      const seq = this._event(lot.id, 'transfer', { from: lot.holder, to: b, related: { order }, actor: { subject: b, account: b.kind === 'account' ? { id: Number(b.id) } : null }, reason: reason || 'Bought', key, tx: order });
      this._setTitle(lot.id, b, seq);
      if (this.q.setLifecycle.run({ lifecycle: 'owned', id: lot.id, w: this.w, rev: lot.revision }).changes !== 1) throw new PropertyError('stale', 'The lot changed meanwhile.', 409);
      this.q.dropAllDelegations.run(this.w, lot.id);
      return { id: lot.id, holder: b, revision: lot.revision + 1 };
    });
  }

  // ------------------------------------------------------------------------------------------------ checking
  /**
   * Re-verifies every invariant without changing anything (spec §5.4): lots never overlap and stay simple, every lot in
   * use has exactly one title that matches its history, retired lots link to their successors, history is append-only
   * (the triggers are present). Returns problems: [{ code, message }].
   */
  reconcile() {
    const out = [], lots = this.all();
    for (const p of checkPartition(lots)) out.push(p);
    for (const l of lots) {
      const h = this.history(l.id);
      if (!l.holder) { out.push({ code: 'title', message: `Lot ${l.id} has no title.` }); continue; }
      const last = [...h].reverse().find(e => e.to_kind);
      if (!last || last.to_kind !== l.holder.kind || last.to_id !== l.holder.id) out.push({ code: 'title', message: `Lot ${l.id}: its title doesn't match its history.` });
      if (area2(normalize(l.poly)) !== l.areaTwice) out.push({ code: 'area', message: `Lot ${l.id}: stored area doesn't match its shape.` });
    }
    const triggers = this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('title_events_no_update', 'title_events_no_delete', 'lots_never_deleted')").all();
    if (triggers.length !== 3) out.push({ code: 'guard', message: 'A property safeguard (database trigger) is missing.' });
    return out;
  }
}

function summary(r) { if (!r || typeof r !== 'object') return r; const o = {}; for (const [k, v] of Object.entries(r)) if (typeof v !== 'bigint') o[k] = v; return o; }
