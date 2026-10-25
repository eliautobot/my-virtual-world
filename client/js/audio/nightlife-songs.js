// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The songs the lounge's band and the club's DJ play (audio/nightlife-music.js): our own tunes, chord changes and grooves
// written for the game, played by the synthesiser in the browser (nothing recorded, nothing to license).
//
// A jazz tune: its feel ('swing', 'ballad', 'bossa', 'blues'), tempo, a chorus of bars (one or two chords a bar) played
// `choruses` times. A club track: tempo, a four-chord loop (two bars each), its bass and lead styles and its sections.

export const JAZZ = [
  { name: 'Velvet Hour', feel: 'swing', bpm: 126, choruses: 3, seed: 11,
    bars: ['Fmaj7', 'Dm7', 'Gm7', 'C7', 'Am7', 'D7', 'Gm7', 'C7', 'Fmaj7', 'F7', 'Bbmaj7', 'Bbm7 Eb7', 'Am7', 'D7', 'Gm7 C7', 'Fmaj7 C7'] },
  { name: 'Copper Moon', feel: 'ballad', bpm: 70, choruses: 2, seed: 23,
    bars: ['Ebmaj7', 'Cm7', 'Fm7', 'Bb7', 'Gm7', 'C7', 'Fm7', 'Bb7', 'Abmaj7', 'Abm7 Db7', 'Gm7', 'C7', 'Fm7', 'Bb7', 'Ebmaj7', 'Fm7 Bb7'] },
  { name: 'Rio Lanterns', feel: 'bossa', bpm: 136, choruses: 3, seed: 37,
    bars: ['Am7', 'Am7', 'D7', 'D7', 'Gm7', 'C7', 'Fmaj7', 'Fmaj7', 'Bm7b5', 'E7', 'Am7', 'Am7', 'Dm7', 'G7', 'Cmaj7', 'E7'] },
  { name: 'Midnight Walk', feel: 'swing', bpm: 140, choruses: 3, seed: 41,
    bars: ['Bbmaj7 G7', 'Cm7 F7', 'Dm7 G7', 'Cm7 F7', 'Fm7 Bb7', 'Ebmaj7 Ab7', 'Dm7 G7', 'Cm7 F7', 'Bbmaj7 G7', 'Cm7 F7', 'Dm7 G7', 'Cm7 F7', 'Fm7 Bb7', 'Ebmaj7 Ab7', 'Cm7 F7', 'Bbmaj7'] },
  { name: 'Blue Terrazzo', feel: 'blues', bpm: 112, choruses: 4, seed: 53,
    bars: ['F7', 'Bb7', 'F7', 'Cm7 F7', 'Bb7', 'Bdim7', 'F7', 'Am7 D7', 'Gm7', 'C7', 'F7 D7', 'Gm7 C7'] },
  { name: 'Soft Focus', feel: 'bossa', bpm: 120, choruses: 3, seed: 67,
    bars: ['Dmaj7', 'Dmaj7', 'Em7', 'A7', 'F#m7', 'B7', 'Em7', 'A7', 'Gmaj7', 'Gm7 C7', 'F#m7', 'B7', 'Em7', 'A7', 'Dmaj7', 'A7'] },
  { name: 'Brass and Smoke', feel: 'swing', bpm: 118, choruses: 3, seed: 71,
    bars: ['Cm7', 'Cm7', 'Fm7', 'Fm7', 'Dm7b5', 'G7', 'Cm7', 'G7', 'Abmaj7', 'Fm7', 'Dm7b5', 'G7', 'Cm7', 'Ab7', 'Dm7b5 G7', 'Cm7 G7'] },
  { name: 'Late Train Home', feel: 'ballad', bpm: 76, choruses: 2, seed: 89,
    bars: ['Gmaj7', 'Em7', 'Am7', 'D7', 'Bm7', 'E7', 'Am7', 'D7', 'Cmaj7', 'Cm7 F7', 'Bm7', 'E7', 'Am7', 'D7', 'Gmaj7', 'Am7 D7'] },
];

/** A club track's sections: [name, bars]. */
const FORM = [['intro', 16], ['build', 8], ['drop', 16], ['break', 8], ['build', 8], ['drop', 16], ['outro', 8]];
export const CLUB = [
  { name: 'Neon Tide', bpm: 124, root: 57, loop: ['m', 'VI', 'III', 'VII'], bass: 'offbeat', lead: 'arp', seed: 101, form: FORM },
  { name: 'Palm Static', bpm: 126, root: 54, loop: ['m', 'VI', 'III', 'VII'], bass: 'rolling', lead: 'hook', seed: 113, form: FORM },
  { name: 'Ocean Drive', bpm: 122, root: 48, loop: ['m', 'VI', 'III', 'VII'], bass: 'offbeat', lead: 'stab', seed: 127, form: FORM },
  { name: 'Velvet Rope', bpm: 125, root: 50, loop: ['m', 'iv', 'VI', 'v'], bass: 'rolling', lead: 'arp', seed: 131, form: FORM },
  { name: 'Sunset Strobe', bpm: 128, root: 52, loop: ['m', 'VI', 'III', 'VII'], bass: 'rolling', lead: 'hook', seed: 149, form: FORM },
  { name: 'After Hours', bpm: 123, root: 55, loop: ['m', 'VII', 'VI', 'VII'], bass: 'offbeat', lead: 'stab', seed: 157, form: FORM },
];
