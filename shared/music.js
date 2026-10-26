// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's music (2026-10-23, the product owner: the jazz stage and the DJ booth need "some kind of way to add to the
// playlist ... a UI that can be interacted with when a player or user interacts with the jazz stage or the dj booth ...
// admin should have full control for now"; "people who make music and want to put it in MVW they can"): the library's
// genres, which stage plays which, and the limits. The library and each stage's deck: server/music/music.js; the panel:
// client/js/ui/music-panel.js; the sound: client/js/audio/nightlife-music.js (docs/features/music.md).

/** A track's genre: its name and family (which stages play it: 'lounge' the Lounge Stage, 'club' the DJ Stage; 'radio'
 *  none by itself, only where someone adds it to a playlist; 'score' the game's own background music, never on a stage). */
export const GENRES = Object.freeze({
  jazz: { name: 'Jazz', family: 'lounge' },
  piano: { name: 'Piano', family: 'lounge' },
  bossa: { name: 'Bossa nova', family: 'lounge' },
  lounge: { name: 'Lounge', family: 'lounge' },
  soul: { name: 'Soul & R&B', family: 'lounge' },
  house: { name: 'House', family: 'club' },
  techno: { name: 'Techno', family: 'club' },
  trance: { name: 'Trance', family: 'club' },
  dubstep: { name: 'Dubstep', family: 'club' },
  reggaeton: { name: 'Reggaeton', family: 'club' },
  hiphop: { name: 'Hip hop', family: 'club' },
  dance: { name: 'Dance / EDM', family: 'club' },
  pop: { name: 'Pop', family: 'radio' },
  rock: { name: 'Rock', family: 'radio' },
  other: { name: 'Other', family: 'radio' },
  score: { name: 'Game music', family: 'score', internal: true },
});
export const GENRE_IDS = Object.freeze(Object.keys(GENRES));
/** The genres anyone may give a song they add (not the game's own music). */
export const UPLOAD_GENRES = Object.freeze(GENRE_IDS.filter(g => !GENRES[g].internal));
export const familyOf = g => GENRES[g]?.family || 'radio';

/** The stages with a deck: the piece's type → the family it plays, its word. */
export const STAGES = Object.freeze({
  lounge_stage: { family: 'lounge', name: 'Lounge Stage', who: 'the band' },
  dj_stage: { family: 'club', name: 'DJ Stage', who: 'the DJ' },
});
/** Whose being there starts the music (the piece's slot uses, shared/catalog.js USES): the band, the DJ. */
export const PERFORM_USES = Object.freeze({ lounge: 'perform', club: 'dj' });

export const MUSIC = Object.freeze({
  minSeconds: 30, maxSeconds: 600,          // a song's length
  maxUploadMB: 25,                          // one file
  queueMax: 20,                             // requests waiting at one stage
  upcoming: 3,                              // the playlist's next songs shown
  loungeGap: 3,                             // s between the band's songs (applause, the next count-in)
  clubBlend: 8,                             // s the DJ blends one track into the next
  startDelay: 1.5,                          // s from choosing a song to its first note (everyone's browser loads it)
  grace: 20,                                // s a stage may look empty and the song goes on (its performer between one stretch at work and the next)
  titleMax: 80, artistMax: 60, rightsMax: 300, reasonMax: 200,
  lufs: -16,                                // every track's loudness in the library
});

/** A stage's deck key: building, floor, the piece's id. */
export const placeKey = (b, f, id) => `${b}:${f}:${id}`;
export function parsePlace(s) {
  const m = /^(\d{1,6}):(\d{1,3}):(\d{1,9})$/.exec(String(s || ''));
  return m ? { b: +m[1], f: +m[2], id: +m[3] } : null;
}
export const fmtTime = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** The city's own music (the 'score' family; client/js/audio/score.js, 2026-10-26): which of its moods fits the moment,
 *  'build' while building, else by the hour: 'day' from 5:30, 'evening' from 17:30, 'night' from 20:30. A track plays
 *  for turn[0] to turn[1] seconds (looping between its loop points) before the next of its mood comes in over fade
 *  seconds; a change of mood comes in over quick seconds. */
export const SCORE = Object.freeze({ day: 5.5, evening: 17.5, night: 20.5, turn: Object.freeze([150, 230]), fade: 7, quick: 4, level: 0.8 });
export function scoreMood(hour, building = false) {
  if (building) return 'build';
  const h = (((Number(hour) || 0) % 24) + 24) % 24;
  return h >= SCORE.night || h < SCORE.day ? 'night' : h >= SCORE.evening ? 'evening' : 'day';
}
/** The tracks for mood m among the library's (the score's approved ones; any of them when none has that mood). */
export function scoreTracks(tracks, m) {
  const all = [...tracks].filter(t => familyOf(t.genre) === 'score' && (!t.status || t.status === 'approved') && t.seconds > 10);
  const fit = all.filter(t => t.mood === m);
  return fit.length ? fit : all;
}
/** The next track: one of list, not the one playing nor the last one of its mood when there is a choice. */
export function scoreNext(list, playing = null, lastOfMood = null, rnd = Math.random) {
  let pool = list.filter(t => t.id !== playing && t.id !== lastOfMood);
  if (!pool.length) pool = list.filter(t => t.id !== playing);
  if (!pool.length) pool = list;
  return pool.length ? pool[Math.floor(rnd() * pool.length) % pool.length] : null;
}
