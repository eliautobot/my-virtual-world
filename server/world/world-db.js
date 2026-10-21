// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The world store (WP4.1, wp4-world-spec.md §4.1): the editable world and its residents live in next.db, next to the
// accounts, the lots and their titles and the edit journal, so an edit, its journal entry and any title change commit
// together (one transaction) and an edit writes the rows it changed, never the whole world.
// - Rows: one per building, floor layout (level) and resident, keyed by their ids as they are today (the index in their
//   list, which never changes: buildings are marked gone, residents retired, never deleted); every other part of the
//   world (roads, terrain, decorations, stations, the grid, …) is one document row.
// - Dirty tracking: the editor names what it changed (mark); anything else asks for a sweep, which compares every row
//   with what was last written and writes only the differences.
// - world.json and people.json stay as exports: written at every clean stop and every few minutes, so backups, the
//   release tools and an older release (after a rollback) keep working. When they are replaced by something else (a
//   restore, an older release, a hand edit), the next start takes them in; the store remembers the hash of the files it
//   wrote itself to tell the difference.
import crypto from 'node:crypto';
import fs from 'node:fs';

const LISTS = { building: 'buildings', level: 'levels' };
export const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
export function fileHash(file) { try { return sha(fs.readFileSync(file)); } catch { return null; } }

export class WorldDb {
  constructor(dbs, { log = null } = {}) {
    this.dbs = dbs; this.w = dbs.worldId; this.log = log;
    const db = dbs.db;
    this.q = {
      row: db.prepare('INSERT INTO world_rows (world_id, kind, id, json, rev) VALUES (?, ?, ?, ?, ?) ON CONFLICT (world_id, kind, id) DO UPDATE SET json = excluded.json, rev = excluded.rev'),
      doc: db.prepare('INSERT INTO world_docs (world_id, key, json, rev) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, key) DO UPDATE SET json = excluded.json, rev = excluded.rev'),
      dropRows: db.prepare('DELETE FROM world_rows WHERE world_id = ? AND kind = ? AND id >= ?'),
      dropDoc: db.prepare('DELETE FROM world_docs WHERE world_id = ? AND key = ?'),
      clearRows: db.prepare('DELETE FROM world_rows WHERE world_id = ? AND kind = ?'),
      clearDocs: db.prepare("DELETE FROM world_docs WHERE world_id = ? AND key NOT LIKE '$%'"),
      rows: db.prepare('SELECT id, json FROM world_rows WHERE world_id = ? AND kind = ? ORDER BY id'),
      docs: db.prepare("SELECT key, json FROM world_docs WHERE world_id = ? AND key NOT LIKE '$%'"),
      meta: db.prepare('SELECT json FROM world_docs WHERE world_id = ? AND key = ?'),
      count: db.prepare('SELECT COUNT(*) AS n FROM world_rows WHERE world_id = ? AND kind = ?'),
    };
    this.rev = this.getMeta('$rev') || 0;
    this.last = { building: [], level: [], person: [], doc: new Map() };   // what each row holds in the database
    this.dirty = this.clean();
    this.stats = { flushes: 0, rows: 0, lastMs: 0, maxMs: 0 };
    dbs.onRollback?.(() => this.resync());
  }
  /** After a rollback the database may hold less than the caches say: forget them and compare everything next time. */
  resync() {
    this.last = { building: [], level: [], person: [], doc: new Map() };
    this.sweep();
  }
  clean() { return { building: new Set(), level: new Set(), person: new Set(), doc: new Set(), allDocs: false, sweepWorld: false, sweepPeople: false }; }
  getMeta(key) { const r = this.q.meta.get(this.w, key); try { return r ? JSON.parse(r.json) : null; } catch { return null; } }
  setMeta(key, v) { this.q.doc.run(this.w, key, JSON.stringify(v), this.rev); }
  /** Whether this world has been stored (a world document and its buildings). */
  has(part = 'world') {
    if (part === 'people') return this.q.count.get(this.w, 'person').n > 0;
    return !!this.q.meta.get(this.w, 'format') && this.q.count.get(this.w, 'building').n > 0;
  }
  /** The world as stored, or null. */
  loadWorld() {
    if (!this.has('world')) return null;
    const world = {};
    for (const r of this.q.docs.all(this.w)) { world[r.key] = JSON.parse(r.json); this.last.doc.set(r.key, r.json); }
    for (const [kind, list] of Object.entries(LISTS)) {
      world[list] = [];
      this.last[kind] = [];
      for (const r of this.q.rows.all(this.w, kind)) { world[list][r.id] = JSON.parse(r.json); this.last[kind][r.id] = r.json; }
    }
    return world;
  }
  /** The residents as stored, or null. */
  loadPeople() {
    if (!this.has('people')) return null;
    const people = [];
    this.last.person = [];
    for (const r of this.q.rows.all(this.w, 'person')) { people[r.id] = JSON.parse(r.json); this.last.person[r.id] = r.json; }
    return people;
  }
  /** Replaces the stored world (and/or residents) entirely: a first import, a restore taken in, new residents. */
  replace(world, people) {
    this.dbs.tx(() => {
      this.rev++;
      if (world) {
        this.q.clearDocs.run(this.w);
        for (const kind of Object.keys(LISTS)) this.q.clearRows.run(this.w, kind);
        this.last.doc.clear(); this.last.building = []; this.last.level = [];
        this.writeWorld(world, true);
      }
      if (people) { this.q.clearRows.run(this.w, 'person'); this.last.person = []; this.writePeople(people, true); }
      this.setMeta('$rev', this.rev);
    });
  }
  // ---------------------------------------------------------------- dirty tracking
  /** What an edit changed: { buildings, levels, people (indices), docs (top-level world keys) }. */
  mark({ buildings, levels, people, docs } = {}) {
    for (const b of buildings || []) this.dirty.building.add(b);
    for (const lv of levels || []) this.dirty.level.add(lv);
    for (const i of people || []) this.dirty.person.add(i);
    if (docs === '*') this.dirty.allDocs = true; else for (const k of docs || []) this.dirty.doc.add(k);
  }
  /** Something changed that nobody named: compare everything at the next flush. */
  sweep({ world = true, people = true } = {}) { if (world) this.dirty.sweepWorld = true; if (people) this.dirty.sweepPeople = true; }
  pending() { const d = this.dirty; return d.sweepWorld || d.sweepPeople || d.allDocs || d.building.size || d.level.size || d.person.size || d.doc.size; }
  /** Writes what changed in one transaction (joining an open one: an edit and its journal entry). Rows written. */
  flush(world, people) {
    if (!this.pending()) return 0;
    const t0 = performance.now(), d = this.dirty;
    let n = 0;
    try {
      this.dbs.tx(() => {
        this.rev++;
        n += this.writeWorld(world, false, d.sweepWorld ? null : d);
        n += this.writePeople(people, false, d.sweepPeople ? null : d.person);
        if (n) this.setMeta('$rev', this.rev);
      });
    } catch (e) { this.sweep(); throw e; }   // nothing was written: compare everything next time
    this.dirty = this.clean();
    const ms = performance.now() - t0;
    this.stats.flushes++; this.stats.rows += n; this.stats.lastMs = ms; this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    return n;
  }
  // ---------------------------------------------------------------- writing
  writeWorld(world, all, d = null) {
    let n = 0;
    const docKeys = Object.keys(world).filter(k => !Object.values(LISTS).includes(k));
    const keys = all || !d || d.allDocs ? docKeys : [...d.doc, 'version'].filter(k => k in world);
    for (const k of keys) {
      const json = JSON.stringify(world[k] ?? null);
      if (!all && this.last.doc.get(k) === json) continue;
      this.q.doc.run(this.w, k, json, this.rev); this.last.doc.set(k, json); n++;
    }
    if (all || !d) for (const k of this.last.doc.keys()) if (!(k in world)) { this.q.dropDoc.run(this.w, k); this.last.doc.delete(k); n++; }
    for (const [kind, list] of Object.entries(LISTS)) n += this.writeList(kind, world[list] || [], all, d ? d[kind] : null);
    return n;
  }
  writePeople(people, all, ids = null) { return people ? this.writeList('person', people, all, ids) : 0; }
  writeList(kind, arr, all, ids) {
    const last = this.last[kind];
    let n = 0;
    const one = i => {
      if (i < 0 || i >= arr.length) return;
      const json = JSON.stringify(arr[i] ?? null);
      if (!all && last[i] === json) return;
      this.q.row.run(this.w, kind, i, json, this.rev); last[i] = json; n++;
    };
    if (ids) for (const i of ids) one(i);
    else for (let i = 0; i < arr.length; i++) one(i);
    // new entries past the end are always written (an edit names them; a sweep finds them), and a shorter list drops rows
    if (ids) for (let i = last.length; i < arr.length; i++) one(i);
    if (last.length > arr.length) { this.q.dropRows.run(this.w, kind, arr.length); last.length = arr.length; n++; }
    return n;
  }
  // ---------------------------------------------------------------- the export files
  /** Whether an export file is one this store wrote or took in (its last 20 hashes: a backup may copy the files a
   *  moment before the database). Anything else replaced it, and it is taken in at the next start. */
  knownFile(name, hash) { return !!hash && ((this.getMeta('$files') || {})[name] || []).includes(hash); }
  rememberFile(name, hash) {
    this.dbs.tx(() => { const f = this.getMeta('$files') || {}; f[name] = [hash, ...(f[name] || []).filter(h => h !== hash)].slice(0, 20); this.setMeta('$files', f); });
  }
}
