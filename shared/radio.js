// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// MVW Radio (2026-10-26, R1 of the sound effects plan; the product owner: "an MVW radio that turns on when driving, and
// some radio stations while driving (think Grand Theft Auto, but with MVW and AI)"): the stations and what each plays
// when. A station's schedule is worked out from the world's library and the server's clock alone, the same in every
// browser, so everyone tuned to a station hears the same song at the same second: its songs in an order shuffled afresh
// for each round of them (seeded by the station and the round), with the station's ident after every few songs (its
// talkEvery, 3 unless its administrators chose otherwise: an ident slot of IDENT_SLOT seconds), where its hosts talk.
import { familyOf } from './music.js';

export const RADIO = Object.freeze({ identEvery: 3, identSlot: 9, crossfade: 1.2 });
/** How a station's hosts talk (2026-10-28, the product owner: "is there a way to control the frequency of breaks?"): every
 *  how many songs (its ident there, then the talk: 1 to 10), how long ('short' about 30 s, 'normal' about a minute,
 *  'long' about a minute and a half; unset: long on talk radio, else normal), and at most how many breaks a day (max:
 *  null, as often as set; 0, no talk; a number, spread over the day: "i set it to talk every 1 song but it doesnt seem
 *  to do it" — a limit set elsewhere held it back, so it is the station's own, beside how often, and none unless set). */
export const TALK_LENGTHS = Object.freeze(['short', 'normal', 'long']);
export const TALK_MAX = 2000;
export function talkOf(st) {
  const e = Number(st?.talkEvery), m = st?.talkMax;
  return { every: Number.isInteger(e) && e >= 1 && e <= 10 ? e : RADIO.identEvery, length: TALK_LENGTHS.includes(st?.talkLength) ? st.talkLength : st?.talk ? 'long' : 'normal',
    max: Number.isInteger(m) && m >= 0 && m <= TALK_MAX ? m : null };
}
/** What a station's talk comes to with the songs it plays (list: stationTracks): { slotMinutes (between its talk slots),
 *  slotsADay, breaksADay, minutesApart (between its breaks; null: none), capped (its max holds it back) }, or null with no
 *  songs. (A round shorter than its `every` songs: the slot at the round's end.) */
export function talkPace(list, st) {
  if (!list?.length) return null;
  const { every, max } = talkOf(st), avg = list.reduce((a, t) => a + t.seconds, 0) / list.length;
  const slot = Math.min(every, list.length) * avg + RADIO.identSlot, slots = 86400 / slot, breaks = max == null ? slots : Math.min(slots, max);
  return { slotMinutes: slot / 60, slotsADay: Math.round(slots), breaksADay: Math.round(breaks), minutesApart: breaks > 0 ? 1440 / breaks : null, capped: max != null && max < slots };
}
/** The world's first stations (2026-10-27: stations are the world's own data now, server/radio/radio.js, each made,
 *  edited and removed by its administrators; these four are what a new world starts with): id, name, frequency and band,
 *  what it plays (library families or genres, or its own playlist), its line, whether it is talk (an AM sound:
 *  band-limited), and its idents (client/assets/sfx: ident-<id>-n; a station made later has none of its own). */
export const STATIONS = Object.freeze([
  Object.freeze({ id: 'velvet', name: 'Velvet', freq: '88.3', band: 'FM', families: ['lounge'], line: 'Smooth jazz, lounge and late-night chill', color: '#c98bd9' }),
  Object.freeze({ id: 'bass', name: 'Bass Island', freq: '99.9', band: 'FM', families: ['club'], line: 'House, techno, trance, dubstep, reggaeton and hip hop', color: '#3ad1ff' }),
  Object.freeze({ id: 'sunday', name: 'Sunday Drive', freq: '94.7', band: 'FM', genres: ['score'], families: ['radio'], line: 'Easy music for the open road', color: '#ffc04d' }),
  Object.freeze({ id: 'grapevine', name: 'The Grapevine', freq: '1040', band: 'AM', genres: ['score', 'piano'], talk: true, line: 'The talk of the town', color: '#ff7a59' }),
]);
export const DEFAULT_STATIONS = STATIONS;
export const stationById = (id, list = STATIONS) => list.find(s => s.id === id) || null;
export const MAX_HOSTS = 3, MAX_STATIONS = 24, MAX_PLAYLIST = 400;
const PLAY_GENRES = new Set(['jazz', 'piano', 'bossa', 'lounge', 'soul', 'house', 'techno', 'trance', 'dubstep', 'reggaeton', 'hiphop', 'dance', 'pop', 'rock', 'other', 'score']);
const txt = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
/** A station as administrators may set it (an Error when it can't be): { id, name, freq, band, color, line, families,
 *  genres, playlist (library song ids, in order), order 'shuffle' | 'order', talk, talkEvery (songs, 1 to 10), talkLength
 *  ('short' | 'normal' | 'long' | null: by talk), talkMax (breaks a day at most; null: as often as set), hosts (agent ids,
 *  at most 3), ads { on, every }, studio (the room it is broadcast from) }. */
export function normalizeStation(o, prev = null) {
  const b = { ...(prev || {}), ...(o || {}) };
  const name = txt(b.name, 40); if (!name) return new Error('A station needs a name');
  const band = b.band === 'AM' ? 'AM' : 'FM', freq = txt(b.freq, 6);
  const fv = Number(freq);
  if (!(band === 'FM' ? fv >= 87.5 && fv <= 108 : fv >= 530 && fv <= 1710)) return new Error(band === 'FM' ? 'An FM frequency is 87.5 to 108.0' : 'An AM frequency is 530 to 1710');
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color.toLowerCase() : '#9aa4b1';
  const genres = [...new Set((Array.isArray(b.genres) ? b.genres : []).filter(g => PLAY_GENRES.has(g)))];
  const families = [...new Set((Array.isArray(b.families) ? b.families : []).filter(f => ['lounge', 'club', 'radio'].includes(f)))];
  const playlist = [...new Set((Array.isArray(b.playlist) ? b.playlist : []).map(x => txt(x, 40)).filter(Boolean))].slice(0, MAX_PLAYLIST);
  const hosts = [...new Set((Array.isArray(b.hosts) ? b.hosts : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  if (hosts.length > MAX_HOSTS) return new Error(`At most ${MAX_HOSTS} hosts a station`);
  const ads = { on: b.ads?.on !== false, every: Math.max(1, Math.min(6, Number(b.ads?.every) || 2)) };
  const te = Number(b.talkEvery);
  if (b.talkEvery != null && !(Number.isInteger(te) && te >= 1 && te <= 10)) return new Error('Talk every 1 to 10 songs');
  if (b.talkLength != null && !TALK_LENGTHS.includes(b.talkLength)) return new Error('Talk length: short, normal or long');
  const tm = b.talkMax === '' ? null : b.talkMax;
  if (tm != null && !(Number.isInteger(Number(tm)) && Number(tm) >= 0 && Number(tm) <= TALK_MAX)) return new Error(`At most 0 to ${TALK_MAX} breaks a day, or none set`);
  return { id: txt(b.id, 32) || null, name, freq: band === 'FM' ? fv.toFixed(1) : String(Math.round(fv)), band, color, line: txt(b.line, 80), families, genres, playlist,
    order: b.order === 'order' ? 'order' : 'shuffle', talk: !!b.talk, talkEvery: b.talkEvery != null ? te : RADIO.identEvery, talkLength: b.talkLength ?? null, talkMax: tm == null ? null : Number(tm), hosts, ads, studio: b.studio && typeof b.studio === 'object' ? { b: b.studio.b | 0, f: b.studio.f | 0, room: txt(b.studio.room, 32) } : null };
}

/** The songs a station plays from the library's tracks: approved, of its families or genres, by id (the same order everywhere). */
// (a song's status: an administrator's view of the library has it; everyone else's, and the server's own list(null),
//  have only approved songs and no status on them — so a song without one is approved: 2026-10-27, the hosts never
//  wrote a break, and a player who is no administrator heard nothing, because the songs read as unapproved)
const playable = t => t && (t.status == null || t.status === 'approved') && t.seconds > 20;
export function stationTracks(tracks, st) {
  if (st.playlist?.length) {   // its own playlist: those songs (approved), in its order
    const by = new Map(); for (const t of tracks) if (playable(t)) by.set(t.id, t);
    return st.playlist.map(id => by.get(id)).filter(Boolean);
  }
  const out = [];
  for (const t of tracks) {
    if (!playable(t)) continue;
    if ((st.genres || []).includes(t.genre) || (t.genre !== 'score' && (st.families || []).includes(familyOf(t.genre)))) out.push(t);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** The order of one round of a station's songs (a seeded shuffle). */
export function roundOrder(list, stationId, round, order = 'shuffle') {
  const a = list.slice(); if (order === 'order') return a;
  const r = rng(hash(`${stationId}:${round}`));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/**
 * What a station has on air at server time t (seconds): { kind: 'song', track, at (seconds into it), left, next } or
 * { kind: 'ident', n (which take, the same for everyone), at, left, next }, or null with nothing to play. A round is every
 * song once with an ident slot after every `every` songs (the station's talkOf().every); rounds follow each other from
 * time 0.
 */
export function onAir(list, stationId, t, order = 'shuffle', every = RADIO.identEvery) {
  if (!list.length) return null;
  const E = Math.max(1, every | 0) || RADIO.identEvery, slot = RADIO.identSlot;
  const len = list.reduce((a, s) => a + s.seconds, 0) + Math.floor(list.length / E) * slot + (list.length % E ? slot : 0);
  const round = Math.floor(t / len);
  let p = t - round * len;
  const ord = roundOrder(list, stationId, round, order);
  for (let i = 0; i < ord.length; i++) {
    const s = ord[i];
    if (p < s.seconds) return { kind: 'song', track: s, at: p, left: s.seconds - p, round, i, next: ord[i + 1] || null };
    p -= s.seconds;
    if ((i + 1) % E === 0 || i === ord.length - 1) {
      if (p < slot) return { kind: 'ident', n: hash(`${stationId}:${round}:${i}`) % 3, at: p, left: slot - p, round, i, next: ord[i + 1] || null };
      p -= slot;
    }
  }
  return null;
}

/** A host break's lines with their moments (s after the break starts: b.at): [{ host, text, audio, seconds, t0, t1 }];
 *  a line's length: its recording's, else its words read at the free voice's pace. A break from before ST5 (one text,
 *  one recording): one line. GAP: the breath between two hosts' lines. */
export const LINE_GAP = 0.35;
export function breakLines(b) {
  const src = b?.lines?.length ? b.lines : b ? [{ host: b.host, text: b.text || '', audio: b.audio || null, seconds: b.seconds || null }] : [];
  let t = 0;
  return src.map((l, i) => {
    const len = l.seconds || Math.max(1.5, String(l.text || '').split(/\s+/).length / 2.6), t0 = t;
    t += len + (i < src.length - 1 ? LINE_GAP : 0);
    return { ...l, t0, t1: t0 + len };
  });
}
/** The body indices talking at server time t (s): each break's line under way (the studio's desk: its speaker talks). */
export function talkingAt(breaks, t) {
  const out = new Set();
  for (const b of breaks) {
    const into = t - b.at; if (into < 0 || into > 400) continue;
    for (const l of breakLines(b)) if (into >= l.t0 && into < l.t1 && l.host?.body >= 0) out.add(l.host.body);
  }
  return out;
}
