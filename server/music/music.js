// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's music (2026-10-23, the product owner: "the club be able to play users songs"; "some kind of way to add to
// the playlist ... a UI that can be interacted with when a player or user interacts with the jazz stage or the dj booth
// ... admin should have full control for now"): the library and each stage's deck (docs/features/music.md).
//
//   the library  every track: title, artist, genre (shared/music.js), length, loudness, who added it, its status
//                (approved, pending an administrator's review, rejected); the files are in <data>/music/, one MP3 each
//   a deck       one for each Lounge Stage and DJ Stage: what plays (since when, by the server's clock: everyone in the
//                room hears the same moment), the requests waiting, the playlist's next songs, its settings (requests
//                on or off, a genre for the night, its own playlist or all of its family's music)
//
// Music plays only while the band (someone at the stage with the use 'perform') or the DJ ('dj') is there: the sim's
// people, looked at every 2 s. When they leave the song stops (a request cut short goes back to the front of the queue);
// when they come back the next one starts. The band leaves a few seconds between songs; the DJ blends one track into the
// next (MUSIC.clubBlend). A stage with no music in the library for it keeps the synthesised band and DJ (client).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { GENRES, STAGES, PERFORM_USES, MUSIC, familyOf, placeKey, parsePlace } from '../../shared/music.js';

export class MusicError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, msg) => { throw new MusicError(status, code, msg); };
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export class Music {
  /**
   * @param o { dbs, dataDir, sim(), world(), broadcast(msg), nameOf(accountId), log }
   */
  constructor(o) {
    Object.assign(this, { dbs: o.dbs, sim: o.sim, world: o.world, broadcast: o.broadcast || (() => {}), nameOf: o.nameOf || (() => ''), log: o.log || console });
    this.dir = path.join(o.dataDir, 'music');
    fs.mkdirSync(this.dir, { recursive: true });
    this.tracks = new Map();
    this.decks = new Map();
    this.seen = new Map();   // stage → when someone was last seen performing there (tick: MUSIC.grace)
    this.version = 1;
    this.saveSoon = new Set();
    this.load();
  }

  // ---------------------------------------------------------------- storage
  load() {
    const W = this.dbs.worldId;
    for (const r of this.dbs.db.prepare('SELECT * FROM music_tracks WHERE world_id = ?').all(W)) this.tracks.set(r.id, this.fromRow(r));
    for (const r of this.dbs.db.prepare('SELECT place, state_json FROM music_decks WHERE world_id = ?').all(W)) {
      const at = parsePlace(r.place); if (!at) continue;
      let st = {}; try { st = JSON.parse(r.state_json) || {}; } catch { /* a fresh deck */ }
      const d = this.newDeck(r.place, at, st.family || 'lounge');
      Object.assign(d.settings, st.settings || {});
      d.queue = Array.isArray(st.queue) ? st.queue.filter(q => this.tracks.has(q.id)).slice(0, MUSIC.queueMax) : [];
      d.history = Array.isArray(st.history) ? st.history.slice(-12) : [];
      this.decks.set(r.place, d);
    }
  }
  fromRow(r) {
    let meta = null; try { meta = r.meta_json ? JSON.parse(r.meta_json) : null; } catch { /* none */ }
    return { id: r.id, title: r.title, artist: r.artist, genre: r.genre, mood: r.mood || null, bpm: r.bpm || null, seconds: r.seconds, file: r.file, bytes: r.bytes,
      gain: r.gain_db || 0, source: r.source, status: r.status, explicit: !!r.explicit, uploader: r.uploader ?? null, rights: r.rights || '', reason: r.reason || '',
      loop: r.loop_start != null && r.loop_end != null ? [r.loop_start, r.loop_end] : null, meta, plays: r.plays || 0, created: r.created, updated: r.updated };
  }
  writeTrack(t) {
    this.dbs.db.prepare(`INSERT INTO music_tracks (id, world_id, title, artist, genre, mood, bpm, seconds, file, bytes, gain_db, source, status, explicit, uploader, rights, reason, loop_start, loop_end, meta_json, plays, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET title = excluded.title, artist = excluded.artist, genre = excluded.genre, mood = excluded.mood, bpm = excluded.bpm, status = excluded.status,
        explicit = excluded.explicit, reason = excluded.reason, plays = excluded.plays, updated = excluded.updated`)
      .run(t.id, this.dbs.worldId, t.title, t.artist, t.genre, t.mood, t.bpm, t.seconds, t.file, t.bytes, t.gain, t.source, t.status, t.explicit ? 1 : 0, t.uploader,
        t.rights || null, t.reason || null, t.loop ? t.loop[0] : null, t.loop ? t.loop[1] : null, t.meta ? JSON.stringify(t.meta) : null, t.plays, t.created, t.updated);
  }
  saveDeck(d) {
    this.saveSoon.add(d.place);
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 1000);
    this.saveTimer.unref?.();
  }
  /** Writes the decks changed since the last time (a second after a change; on shutdown at once). */
  flush() {
    clearTimeout(this.saveTimer); this.saveTimer = null;
    {
      const q = this.dbs.db.prepare('INSERT INTO music_decks (world_id, place, state_json, updated) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, place) DO UPDATE SET state_json = excluded.state_json, updated = excluded.updated');
      const del = this.dbs.db.prepare('DELETE FROM music_decks WHERE world_id = ? AND place = ?');
      for (const p of this.saveSoon) {
        const x = this.decks.get(p);
        try { if (x) q.run(this.dbs.worldId, p, JSON.stringify({ family: x.family, settings: x.settings, queue: x.queue, history: x.history }), Date.now()); else del.run(this.dbs.worldId, p); } catch (e) { this.log.error?.('[music] saving a deck failed', e.message); }
      }
      this.saveSoon.clear();
    }
  }
  libraryChanged() { this.version++; this.broadcast({ t: 'music_lib', v: this.version }); }

  // ---------------------------------------------------------------- the library
  /** A track as a viewer sees it (admin: the review's details too). */
  pub(t, admin = false, me = null) {
    const o = { id: t.id, title: t.title, artist: t.artist, genre: t.genre, mood: t.mood, bpm: t.bpm, seconds: Math.round(t.seconds * 10) / 10, explicit: t.explicit,
      gain: t.gain, loop: t.loop, plays: t.plays, source: t.source };
    if (t.uploader != null) o.by = this.nameOf(t.uploader) || 'a player';
    if (admin || (me != null && t.uploader === me)) Object.assign(o, { status: t.status, reason: t.reason || '', rights: t.rights || '', added: t.created, mine: t.uploader === me });
    return o;
  }
  /** The library as viewer P sees it: the approved tracks; their own pending or rejected ones; an administrator all. */
  list(me, admin) {
    const out = [];
    for (const t of this.tracks.values()) if (t.status === 'approved' || admin || (me != null && t.uploader === me)) out.push(this.pub(t, admin, me));
    out.sort((a, b) => (a.genre === b.genre ? a.title.localeCompare(b.title) : a.genre.localeCompare(b.genre)));
    return { version: this.version, tracks: out };
  }
  /** The file of track id for viewer me (approved: anyone; otherwise its uploader or an administrator): { path, size } or null. */
  fileOf(id, me, admin) {
    const t = this.tracks.get(String(id));
    if (!t || !(t.status === 'approved' || admin || (me != null && t.uploader === me))) return null;
    const p = path.join(this.dir, t.file);
    try { return { path: p, size: fs.statSync(p).size }; } catch { return null; }
  }
  /** Adds a track from a file in the library folder (already converted): its row; approved straight away or pending review. */
  add({ file, seconds, gain = 0, title, artist, genre, mood = null, bpm = null, explicit = false, uploader = null, rights = '', source = 'upload', status = 'pending', loop = null, meta = null, id = null }) {
    if (!GENRES[genre]) fail(400, 'bad_genre', 'Pick one of the genres');
    if (!(seconds >= MUSIC.minSeconds && seconds <= MUSIC.maxSeconds)) fail(400, 'bad_length', `A song is ${MUSIC.minSeconds} seconds to ${MUSIC.maxSeconds / 60} minutes long`);
    title = clean(title, MUSIC.titleMax); artist = clean(artist, MUSIC.artistMax);
    if (!title) fail(400, 'bad_title', 'Give the song a title');
    const now = Date.now(), t = { id: id || `t${crypto.randomBytes(6).toString('hex')}`, title, artist: artist || 'Unknown artist', genre, mood: mood ? clean(mood, 40) : null, bpm: Number(bpm) || null,
      seconds: Math.round(seconds * 1000) / 1000, file, bytes: fs.statSync(path.join(this.dir, file)).size, gain: Number(gain) || 0, source, status, explicit: !!explicit,
      uploader: uploader == null ? null : Number(uploader), rights: clean(rights, MUSIC.rightsMax), reason: '', loop, meta, plays: 0, created: now, updated: now };
    this.writeTrack(t); this.tracks.set(t.id, t);
    if (t.status === 'approved') { this.libraryChanged(); this.refill(); } else this.broadcast({ t: 'music_review' });
    return t;
  }
  newFileName(ext = 'mp3') { return `${crypto.randomBytes(9).toString('hex')}.${ext}`; }
  /** Changes a track's details (an administrator). */
  edit(id, patch) {
    const t = this.track(id);
    if (patch.title !== undefined) { const v = clean(patch.title, MUSIC.titleMax); if (!v) fail(400, 'bad_title', 'Give the song a title'); t.title = v; }
    if (patch.artist !== undefined) t.artist = clean(patch.artist, MUSIC.artistMax) || 'Unknown artist';
    if (patch.genre !== undefined) { if (!GENRES[patch.genre]) fail(400, 'bad_genre', 'Pick one of the genres'); t.genre = patch.genre; }
    if (patch.explicit !== undefined) t.explicit = !!patch.explicit;
    t.updated = Date.now(); this.writeTrack(t); this.libraryChanged(); this.refill();
    return t;
  }
  /** An administrator's review: approved (it plays) or rejected (with a reason its uploader reads). */
  review(id, approve, reason = '') {
    const t = this.track(id);
    t.status = approve ? 'approved' : 'rejected'; t.reason = approve ? '' : clean(reason, MUSIC.reasonMax) || 'Not right for the city';
    t.updated = Date.now(); this.writeTrack(t); this.libraryChanged(); this.refill();
    this.broadcast({ t: 'music_review' });
    return t;
  }
  /** Deletes a track and its file (an administrator; or its uploader, while it is not approved). */
  remove(id) {
    const t = this.track(id);
    this.dbs.db.prepare('DELETE FROM music_tracks WHERE world_id = ? AND id = ?').run(this.dbs.worldId, t.id);
    this.tracks.delete(t.id);
    try { fs.unlinkSync(path.join(this.dir, t.file)); } catch { /* gone */ }
    for (const d of this.decks.values()) {
      const before = JSON.stringify([d.queue, d.settings.playlist, d.upcoming]);
      d.queue = d.queue.filter(q => q.id !== t.id);
      if (d.settings.playlist) d.settings.playlist = d.settings.playlist.filter(x => x !== t.id);
      d.upcoming = d.upcoming.filter(x => x !== t.id);
      if (JSON.stringify([d.queue, d.settings.playlist, d.upcoming]) !== before) { this.fill(d); this.changed(d); }
    }
    this.libraryChanged();
  }
  track(id) { const t = this.tracks.get(String(id)); if (!t) fail(404, 'not_found', 'That song is not in the library'); return t; }
  pending() { return [...this.tracks.values()].filter(t => t.status === 'pending').sort((a, b) => a.created - b.created); }
  /** How many songs account `me` has waiting for review (a limit against floods). */
  pendingOf(me) { let n = 0; for (const t of this.tracks.values()) if (t.uploader === me && t.status === 'pending') n++; return n; }

  // ---------------------------------------------------------------- decks
  newDeck(place, at, family) {
    return { place, ...at, family, settings: { requests: true, genre: null, playlist: null }, queue: [], history: [], upcoming: [], now: null, prev: null, live: false, cursor: 0 };
  }
  /** The stage piece at a place: { it, family } or null (gone, or not a stage). */
  stageAt(at) {
    const W = this.world(), B = W?.buildings?.[at.b];
    if (!B || B.gone || at.f >= (B.floors || 0)) return null;
    const it = W.levels?.[B.lv?.[at.f]]?.items?.find(i => i.id === at.id), st = it && STAGES[it.t];
    return st ? { it, family: st.family } : null;
  }
  /** The deck of a place (created when asked for a stage that has none yet), or null (no stage there). */
  deckOf(place, create = true) {
    const at = typeof place === 'string' ? parsePlace(place) : place;
    if (!at) return null;
    const key = placeKey(at.b, at.f, at.id), st = this.stageAt(at);
    let d = this.decks.get(key);
    if (!st) { if (d) { this.decks.delete(key); this.saveDeck(d); this.broadcast({ t: 'music', gone: key }); } return null; }
    if (d && d.family !== st.family) { this.decks.delete(key); d = null; }
    if (!d && create) { d = this.newDeck(key, at, st.family); this.decks.set(key, d); this.fill(d); }
    return d || null;
  }
  /** The songs a deck chooses from by itself: its own playlist, else every approved song of its family (and genre). */
  pool(d) {
    const ok = t => t && t.status === 'approved' && familyOf(t.genre) !== 'score';
    if (d.settings.playlist) return d.settings.playlist.map(id => this.tracks.get(id)).filter(ok);
    return [...this.tracks.values()].filter(t => ok(t) && familyOf(t.genre) === d.family && (!d.settings.genre || t.genre === d.settings.genre))
      .sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  }
  /** Whether the library has music for this deck (else the browser's synthesised band or DJ plays). */
  hasMusic(d) { return d.queue.length > 0 || this.pool(d).length > 0; }
  /** Tops up the playlist's next songs: in order through its own playlist; shuffled, not the last few, from all (never a
   *  song asked for or on now, unless the stage has no other). */
  fill(d) {
    const pool = this.pool(d), asked = new Set(d.queue.map(q => q.id));
    let ok = pool.filter(t => !asked.has(t.id) && t.id !== d.now?.id);
    if (!ok.length) ok = pool.filter(t => !asked.has(t.id));
    const okIds = new Set(ok.map(t => t.id));
    d.upcoming = d.upcoming.filter(id => okIds.has(id));
    if (!ok.length) return;
    const want = Math.min(MUSIC.upcoming, ok.length), recent = new Set([...d.history.slice(-Math.min(4, Math.max(0, ok.length - 2))), ...d.upcoming]);
    for (let guard = 0; d.upcoming.length < want && guard < pool.length * 2 + 10; guard++) {
      let t;
      if (d.settings.playlist) { t = pool[d.cursor % pool.length]; d.cursor = (d.cursor + 1) % pool.length; if (!okIds.has(t.id) || d.upcoming.includes(t.id)) continue; }
      else {
        const left = ok.filter(x => !recent.has(x.id)), from = left.length ? left : ok.filter(x => !d.upcoming.includes(x.id));
        t = from[Math.floor(Math.random() * from.length)];
        if (!t) break;
      }
      d.upcoming.push(t.id); recent.add(t.id);
    }
  }
  refill() { for (const d of this.decks.values()) { const was = d.upcoming.join(); this.fill(d); if (d.upcoming.join() !== was) this.changed(d); } }
  /** A deck as everyone sees it (the room's music; the panel). */
  pubDeck(d) {
    return { place: d.place, b: d.b, f: d.f, id: d.id, family: d.family, live: d.live, music: this.hasMusic(d),
      now: d.now ? { id: d.now.id, at: d.now.at, by: d.now.by ?? null, name: d.now.name || null } : null,
      prev: d.prev ? { id: d.prev.id, at: d.prev.at, end: d.prev.end } : null,
      queue: d.queue.map(q => ({ id: q.id, by: q.by, name: q.name, at: q.at })), upcoming: d.upcoming.slice(),
      settings: { requests: d.settings.requests, genre: d.settings.genre, playlist: d.settings.playlist ? d.settings.playlist.slice() : null } };
  }
  changed(d, save = true) { this.broadcast({ t: 'music', deck: this.pubDeck(d) }); if (save) this.saveDeck(d); }
  decksAll() { return [...this.decks.values()].filter(d => this.stageAt(d)).map(d => this.pubDeck(d)); }

  /** A player asks for a song at a stage (one request each at a time there; asking again replaces it). */
  request(me, name, place, id) {
    const d = this.deckOf(place); if (!d) fail(404, 'no_stage', 'There is no stage there');
    if (!d.settings.requests) fail(409, 'requests_off', 'Requests are off here right now');
    const t = this.track(id);
    if (t.status !== 'approved') fail(409, 'not_approved', 'That song is waiting for review');
    if (familyOf(t.genre) === 'score' || (familyOf(t.genre) !== d.family && !d.settings.playlist?.includes(t.id))) fail(409, 'wrong_stage', `That song isn't played at the ${STAGES[this.stageAt(d).it.t].name}`);
    if (d.now?.id === t.id || d.queue.some(q => q.id === t.id && q.by !== me)) fail(409, 'already', 'That song is already playing or asked for');
    const mine = d.queue.findIndex(q => q.by === me);
    const q = { id: t.id, by: me, name: clean(name, 40) || 'A guest', at: Date.now() };
    if (mine >= 0) d.queue[mine] = q;
    else { if (d.queue.length >= MUSIC.queueMax) fail(409, 'queue_full', 'The requests are full here; try again in a few songs'); d.queue.push(q); }
    this.fill(d); this.changed(d);
    return { position: d.queue.findIndex(x => x.by === me) + 1, replaced: mine >= 0 };
  }
  cancel(me, place, admin = false, index = null) {
    const d = this.deckOf(place, false); if (!d) fail(404, 'no_stage', 'There is no stage there');
    const k = admin && index != null ? Number(index) : d.queue.findIndex(q => q.by === me);
    if (!(k >= 0 && k < d.queue.length)) fail(404, 'no_request', 'No request of yours waits here');
    d.queue.splice(k, 1); this.fill(d); this.changed(d);
  }
  /** An administrator's settings: { requests, genre (null: all), playlist (null: all of its family; else track ids) }. */
  configure(place, s) {
    const d = this.deckOf(place); if (!d) fail(404, 'no_stage', 'There is no stage there');
    if (s.requests !== undefined) d.settings.requests = !!s.requests;
    if (s.genre !== undefined) {
      if (s.genre !== null && (!GENRES[s.genre] || familyOf(s.genre) !== d.family)) fail(400, 'bad_genre', 'Pick one of this stage\'s genres');
      d.settings.genre = s.genre;
    }
    if (s.playlist !== undefined) {
      if (s.playlist === null) d.settings.playlist = null;
      else {
        if (!Array.isArray(s.playlist) || s.playlist.length > 300) fail(400, 'bad_playlist', 'A playlist is a list of up to 300 songs');
        const ids = [...new Set(s.playlist.map(String))].filter(id => { const t = this.tracks.get(id); return t && familyOf(t.genre) !== 'score'; });
        d.settings.playlist = ids; d.cursor = 0;
      }
    }
    d.upcoming = []; this.fill(d); this.changed(d);
    return this.pubDeck(d);
  }
  /** The next song now (an administrator). */
  skip(place) {
    const d = this.deckOf(place); if (!d) fail(404, 'no_stage', 'There is no stage there');
    if (!d.now) return;
    d.skip = true; this.advance(d, d.live, Date.now());
  }
  clear(place) { const d = this.deckOf(place); if (!d) fail(404, 'no_stage', 'There is no stage there'); d.queue = []; this.fill(d); this.changed(d); }

  // ---------------------------------------------------------------- the music going on
  /** The stages someone performs at now: place → family (the sim's people and what they are doing). */
  performing() {
    const S = this.sim(), out = new Map();
    if (!S?.agents) return out;
    const t = S.now(), fam = { [PERFORM_USES.lounge]: 'lounge', [PERFORM_USES.club]: 'club' };
    for (const a of S.agents) {
      const x = a?.act;
      if (!x || !fam[x.use] || x.id < 0 || x.holdStart > t || x.holdEnd < t || a.p?.retired) continue;
      out.set(placeKey(x.b, x.f, x.id), fam[x.use]);
    }
    return out;
  }
  tick(now = Date.now()) {
    const live = this.performing();
    for (const [place, family] of live) { const d = this.deckOf(place); if (d && d.family === family) { this.seen.set(d.place, now); this.advance(d, true, now); } }
    // (a stage that looked empty a moment ago plays on for MUSIC.grace: its performer is between one stretch at work and
    // the next, a fraction of a second, and the song stopped and another began — 2026-10-24)
    for (const d of [...this.decks.values()]) if (!live.has(d.place)) this.advance(d, now - (this.seen.get(d.place) ?? -Infinity) < MUSIC.grace * 1000, now);
  }
  /** One deck's next moment: stops with no one on stage, starts or follows on with someone there. */
  advance(d, live, t) {
    let changed = false;
    const cur = d.now ? this.tracks.get(d.now.id) : null;
    if (d.now && !cur) { d.now = null; changed = true; }
    if (d.prev && t > d.prev.end + 500) { d.prev = null; changed = true; }
    if (!live) {
      if (d.now) {
        if (d.now.by != null && cur && t - d.now.at < cur.seconds * 500 && !d.queue.some(q => q.by === d.now.by)) d.queue.unshift({ id: cur.id, by: d.now.by, name: d.now.name, at: d.now.at });
        d.now = null; d.prev = null; changed = true;
      }
      if (d.live) { d.live = false; changed = true; }
      if (changed) this.changed(d);
      return;
    }
    if (!d.live) { d.live = true; changed = true; }
    const end = cur ? d.now.at + cur.seconds * 1000 : 0;
    const club = d.family === 'club', lead = (MUSIC.startDelay * 1000) + 500;
    const start = !cur || d.skip ? t + MUSIC.startDelay * 1000 : club ? end - MUSIC.clubBlend * 1000 : end + MUSIC.loungeGap * 1000;
    if (!cur || d.skip || t >= start - lead) {
      const next = this.take(d);
      if (next) {
        if (cur) d.prev = { id: cur.id, at: d.now.at, end: d.skip ? t + 2500 : Math.max(end, start) };
        d.now = { id: next.id, at: Math.max(start, t), by: next.by ?? null, name: next.name || null };
        const tr = this.tracks.get(next.id); tr.plays++; tr.updated = Date.now();
        try { this.dbs.db.prepare('UPDATE music_tracks SET plays = ? WHERE world_id = ? AND id = ?').run(tr.plays, this.dbs.worldId, tr.id); } catch { /* counted next time */ }
        d.history.push(next.id); if (d.history.length > 12) d.history.shift();
        changed = true;
      } else if (cur && (t >= end || d.skip)) { d.prev = null; d.now = null; changed = true; }
    }
    d.skip = false;
    if (changed) this.changed(d);
  }
  /** The next song: the first request, else the playlist's next. */
  take(d) {
    while (d.queue.length) { const q = d.queue.shift(), t = this.tracks.get(q.id); if (t && t.status === 'approved') { d.upcoming = d.upcoming.filter(id => id !== q.id); this.fill(d); return q; } }
    this.fill(d);
    const id = d.upcoming.shift();
    this.fill(d);
    return id ? { id } : null;
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log.error?.('[music] a tick failed', e.message); } }, 2000);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
}
