// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's music as this page knows it (server/music/, docs/features/music.md): the library (S.music.tracks) and each
// stage's deck (S.music.decks: what plays and since when by the server's clock, the requests, the playlist's next
// songs), kept up to date by the server's 'music' messages. bus 'music' { place } on every change; the sound
// (audio/nightlife-music.js) and the panel (ui/music-panel.js) follow it.
import { S, bus } from './state.js';
import { getJSON } from './net.js';
import { auth } from './auth.js';

let busy = null, again = false, libBusy = null;
/** Everything again (the page starting, the socket back, someone signing in or out). */
async function load() {
  if (busy) { again = true; return busy; }
  busy = (async () => {
    do {
      again = false;
      try {
        const j = await getJSON('/api/music/state');
        setLibrary(j.library);
        S.music.decks = new Map((j.decks || []).map(d => [d.place, d]));
        S.music.can = j.can || {};
        S.music.ready = true;
        bus.emit('music', { all: true });
      } catch { /* the next hello */ }
    } while (again);
  })().finally(() => { busy = null; });
  return busy;
}
function setLibrary(lib) {
  if (!lib) return;
  S.music.tracks = new Map((lib.tracks || []).map(t => [t.id, t]));
  S.music.version = lib.version || 0;
}
async function loadLibrary() {
  if (libBusy) return libBusy;
  libBusy = getJSON('/api/music/library').then(lib => { setLibrary(lib); bus.emit('music', { library: true }); }, () => {}).finally(() => { libBusy = null; });
  return libBusy;
}
/** One stage's deck now (made on the server if it has none yet): the panel opening on a stage nobody played at. */
async function fetchDeck(place) {
  const j = await getJSON(`/api/music/deck?place=${encodeURIComponent(place)}`);
  if (j.deck) { S.music.decks.set(j.deck.place, j.deck); bus.emit('music', { place: j.deck.place }); }
  return j.deck || null;
}

export function init(app) {
  S.music = { tracks: new Map(), decks: new Map(), can: {}, version: 0, ready: false };
  bus.on('hello', () => load());
  bus.on('auth', () => load());
  bus.on('msg:music', m => {
    if (m.gone) S.music.decks.delete(m.gone);
    else if (m.deck) S.music.decks.set(m.deck.place, m.deck);
    bus.emit('music', { place: m.gone || m.deck?.place });
  });
  bus.on('msg:music_lib', m => { if (m.v !== S.music.version) loadLibrary(); });
  bus.on('msg:music_review', () => { if (S.music.can.manage || auth.account) loadLibrary(); });
  app.music = { load, loadLibrary, fetchDeck, deck: place => S.music.decks.get(place) || null, track: id => S.music.tracks.get(id) || null };
  load();
}
