// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The radio's shows, kept (2026-10-28, the product owner: each agent on the air speaks for itself, "that way the
// conversations and dialog are real back and forth, this also maintains true memories" — one conversation a break, kept
// and readable, never in anyone's chat window): every break as it went out — when, where, who was on (and who spoke),
// what about, every line by its speaker. A station's recent shows for its window; an agent's shows for its owner (its
// Agent Studio). Kept KEEP_DAYS days: one file a station a day (data/radio/shows/<station>/<day>.jsonl), appended to,
// the oldest days let go.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const KEEP_DAYS = 30;
const DAY_MS = 86400e3;
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const okId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(id);   // (a station's id: a word, or s + hex)

export class ShowLog {
  /** @param {{ dir: string, now?: () => number, log?: Function }} d dir: the radio's data folder */
  constructor({ dir, now = () => Date.now(), log = null }) {
    this.root = path.join(dir, 'shows'); this.now = now; this.log = log;
    fs.mkdirSync(this.root, { recursive: true });
    this.cache = new Map();   // station → its newest shows (newest first), read once
    this.importOld(path.join(dir, 'shows.json'));
    this.prune();
  }
  /** The shows kept before (shows.json: a station's last 20), into their days once. */
  importOld(file) {
    if (!fs.existsSync(file)) return;
    try {
      const old = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      for (const [st, list] of Object.entries(old)) {
        if (!okId(st) || !Array.isArray(list)) continue;
        for (const x of list.slice().reverse()) this.write(st, { id: this.newId(x.at), at: x.at, station: st, hosts: x.hosts || [], topics: x.topics || '', lines: (x.lines || []).map(l => ({ host: l.host, text: l.text })) });
      }
      fs.renameSync(file, `${file}.imported`);
    } catch (e) { this.log?.warn?.('[radio] the old shows could not be read:', e.message); }
  }
  newId(at = this.now()) { return `${dayOf(at)}-${crypto.randomBytes(5).toString('hex')}`; }
  write(st, rec) {
    const dir = path.join(this.root, st); fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${dayOf(rec.at)}.jsonl`), `${JSON.stringify(rec)}\n`);
  }
  /** A show that went out on station st: { at, air, name, cast: [{ id, name, part, spoke }], hosts, topics, lines: [{ id, host, text }] } → its record. */
  add(st, show) {
    if (!okId(st)) return null;
    const rec = { id: this.newId(show.at ?? this.now()), at: this.now(), station: st, ...show };
    this.write(st, rec);
    const c = this.cache.get(st); if (c) { c.unshift(rec); c.length = Math.min(c.length, 50); }
    return rec;
  }
  /** A station's days, newest first. */
  days(st) { try { return fs.readdirSync(path.join(this.root, st)).filter(f => /^\d{4}-\d\d-\d\d\.jsonl$/.test(f)).sort().reverse(); } catch { return []; } }
  read(st, file) {
    try { return fs.readFileSync(path.join(this.root, st, file), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); } catch { return []; }
  }
  /** A station's newest n shows (newest first). */
  recent(st, n = 5) {
    if (!okId(st)) return [];
    let c = this.cache.get(st);
    if (!c) {
      c = [];
      for (const f of this.days(st)) { c.push(...this.read(st, f)); if (c.length >= 50) break; }
      c.length = Math.min(c.length, 50); this.cache.set(st, c);
    }
    return c.slice(0, Math.max(0, n));
  }
  /** One show, by its id (its day is in it), or null. */
  get(id) {
    const m = typeof id === 'string' && id.match(/^(\d{4}-\d\d-\d\d)-[a-f0-9]{10}$/); if (!m) return null;
    for (const st of this.stations()) for (const x of this.read(st, `${m[1]}.jsonl`)) if (x.id === id) return x;
    return null;
  }
  stations() { try { return fs.readdirSync(this.root).filter(okId); } catch { return []; } }
  /** The shows agent id was on in the days kept (newest first, at most limit); name: theirs, for shows kept before they
   *  were kept with who was who (shows.json's: names only). */
  ofAgent(id, limit = 100, name = null) {
    const out = [], days = new Set();
    for (const st of this.stations()) for (const f of this.days(st)) days.add(f);
    for (const f of [...days].sort().reverse()) {
      for (const st of this.stations()) for (const x of this.read(st, f)) if (x.cast ? x.cast.some(c => c.id === id) : name && (x.hosts || []).includes(name)) out.push(x);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => b.at - a.at).slice(0, limit);
  }
  /** Days older than KEEP_DAYS let go. */
  prune() {
    const before = dayOf(this.now() - KEEP_DAYS * DAY_MS);
    for (const st of this.stations()) for (const f of this.days(st)) if (f.slice(0, 10) < before) { try { fs.rmSync(path.join(this.root, st, f), { force: true }); } catch { /* in use */ } this.cache.delete(st); }
  }
}
