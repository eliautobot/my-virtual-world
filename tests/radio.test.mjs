// The radio's schedule (shared/radio.js): the same for everyone at the same time, every song once a round with idents,
// stations keep to their music; how often a station talks (its ident every 1 to 10 songs) and for how long.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STATIONS, stationTracks, onAir, roundOrder, RADIO, talkOf, talkPace, normalizeStation } from '../shared/radio.js';

const T = (id, genre, seconds) => ({ id, genre, seconds, status: 'approved' });
const lib = [T('a', 'jazz', 200), T('b', 'house', 180), T('c', 'score', 220), T('d', 'piano', 150), T('e', 'techno', 210), T('f', 'lounge', 190), T('g', 'jazz', 175), { ...T('h', 'jazz', 160), status: 'pending' }];

test('each station plays its own music, approved songs only', () => {
  const by = Object.fromEntries(STATIONS.map(s => [s.id, stationTracks(lib, s).map(t => t.id)]));
  assert.deepEqual(by.velvet, ['a', 'd', 'f', 'g']);
  assert.deepEqual(by.bass, ['b', 'e']);
  assert.deepEqual(by.sunday, ['c']);
  assert.deepEqual(by.grapevine, ['c', 'd']);
});
test('the same moment for everyone, and a round plays every song once with idents', () => {
  const list = stationTracks(lib, STATIONS[0]);
  assert.deepEqual(onAir(list, 'velvet', 12345.6), onAir(list.slice().reverse().sort((x, y) => x.id.localeCompare(y.id)), 'velvet', 12345.6));
  const seen = new Map(); let idents = 0, last = null;
  const len = list.reduce((a, s) => a + s.seconds, 0) + Math.ceil(list.length / RADIO.identEvery) * RADIO.identSlot;
  for (let t = 0; t < len; t += 0.5) {
    const a = onAir(list, 'velvet', t);
    const key = a.kind === 'song' ? a.track.id : `ident${a.i}`;
    if (key !== last) { if (a.kind === 'song') seen.set(a.track.id, (seen.get(a.track.id) || 0) + 1); else idents++; last = key; }
  }
  assert.equal(seen.size, list.length); for (const n of seen.values()) assert.equal(n, 1);
  assert.equal(idents, Math.ceil(list.length / RADIO.identEvery));
  assert.notDeepEqual(roundOrder(list, 'velvet', 1).map(t => t.id), roundOrder(list, 'velvet', 2).map(t => t.id));   // (each round shuffled afresh)
});
test('nothing to play: null', () => { assert.equal(onAir([], 'bass', 50), null); });
test('songs as a player and the server see them (no status: only approved ones are listed) play; pending ones do not', () => {
  const st = { id: 'velvet', genres: ['jazz'], families: [] };
  const seen = [{ id: 'a', genre: 'jazz', seconds: 200 }, { id: 'b', genre: 'jazz', seconds: 150, status: 'pending' }, { id: 'c', genre: 'jazz', seconds: 180, status: 'approved' }];
  assert.deepEqual(stationTracks(seen, st).map(t => t.id), ['a', 'c']);
  assert.deepEqual(stationTracks(seen, { ...st, playlist: ['c', 'b', 'a'] }).map(t => t.id), ['c', 'a']);
});

test('how often a station talks: its ident (where its hosts talk) after every 1 to 10 songs; how long: short, normal, long', () => {
  const list = Array.from({ length: 12 }, (_, i) => T(`s${i}`, 'jazz', 100));
  const idents = every => { const out = []; for (let t = 0; t < 1200; t += 1) { const a = onAir(list, 'x', t, 'order', every); if (a.kind === 'ident' && a.at < 1) out.push(a.i); } return out; };
  assert.deepEqual(idents(1).slice(0, 4), [0, 1, 2, 3], 'after every song');
  assert.deepEqual(idents(5).slice(0, 2), [4, 9], 'after every 5 songs');
  assert.deepEqual(idents(3).slice(0, 2), [2, 5]);
  assert.deepEqual(idents(undefined).slice(0, 2), [2, 5], 'unset: every 3, as before');
  assert.deepEqual(talkOf({}), { every: 3, length: 'normal', max: null }); assert.deepEqual(talkOf({ talk: true }), { every: 3, length: 'long', max: null }, 'talk radio: long unless chosen');
  assert.deepEqual(talkOf({ talk: true, talkEvery: 6, talkLength: 'short' }), { every: 6, length: 'short', max: null });
  const st = normalizeStation({ name: 'Talky', freq: '101.1', talkEvery: 1, talkLength: 'long' });
  assert.deepEqual([st.talkEvery, st.talkLength], [1, 'long']);
  assert.deepEqual([normalizeStation({ name: 'Plain', freq: '101.1' }).talkEvery, normalizeStation({ name: 'Plain', freq: '101.1' }).talkLength], [3, null]);
  assert.match(normalizeStation({ name: 'Bad', freq: '101.1', talkEvery: 11 }).message, /Talk every 1 to 10 songs/);
  assert.match(normalizeStation({ name: 'Bad', freq: '101.1', talkLength: 'epic' }).message, /Talk length/);
  assert.equal(normalizeStation({ talkEvery: 5 }, normalizeStation({ name: 'Kept', freq: '101.1', talkEvery: 2 })).talkEvery, 5, 'changed on an existing station');
  // at most how many a day: none unless set; 0 no talk; what it comes to
  assert.equal(talkOf({}).max, null); assert.equal(talkOf({ talkMax: 0 }).max, 0);
  assert.equal(normalizeStation({ name: 'L', freq: '101.1', talkMax: '' }).talkMax, null); assert.equal(normalizeStation({ name: 'L', freq: '101.1', talkMax: 60 }).talkMax, 60);
  assert.match(normalizeStation({ name: 'L', freq: '101.1', talkMax: -1 }).message, /At most 0 to 2000/);
  const songs = Array.from({ length: 10 }, (_, i) => T(`p${i}`, 'jazz', 171));   // (3 songs + its ident: 9 minutes)
  const free = talkPace(songs, { talkEvery: 3 }), held = talkPace(songs, { talkEvery: 3, talkMax: 60 });
  assert.deepEqual([Math.round(free.slotMinutes), free.slotsADay, free.capped], [9, 166, false]);
  assert.deepEqual([held.breaksADay, Math.round(held.minutesApart), held.capped], [60, 24, true]);
  assert.equal(talkPace([], {}), null);
});
