// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Live music on a night out (2026-10-23, the product owner: "music for the jazz (different songs) that when the musicians
// are playing it's music through the floor and the user can also hear it if they are in the floor in player or sim
// mode ... the closer the player or camera is the higher the music ... the same for the nightclub ... a DJ that plays
// music"). Synthesised in the browser with Web Audio from our own songs (audio/nightlife-songs.js): nothing recorded.
//
//   the lounge   while its band is on stage (people at the Lounge Stage with the use 'perform', shared/nightlife.js), a
//                jazz trio from the stage: an electric piano (comping, and the tune when nobody sings), an upright bass
//                walking (when the bassist is there), a scat voice (when the singer is at the microphone)
//   the club     while the DJ is at the decks (use 'dj'), house from the DJ's stage: kick, claps, hats, a rolling or
//                off-beat bass, supersaw chords pumping with the kick, a plucked lead, builds with a riser and a snare
//                roll into the drop, a breakdown
//
// Who hears it: on that floor, a player walking it, or the camera looking into it; louder the closer (the distance from
// the player, else from the camera, to the stage), panned to where the stage is. Which song and where in it come from the
// clock (the same for everyone; leave and come back and the set has moved on). The volume is Settings → Sound → Music
// (audio/mixer.js 'music'); audio starts with the first click or key (browser rules).
//
// With songs in the city's library for a stage (core/music.js, server/music/: its deck says so), the band and the DJ
// play those instead: the recording the deck has on now, from the second it is at by the server's clock (the same moment
// for everyone in the room), streamed and kept in step; the DJ's next track blended in over the last seconds of the one
// before. The synthesised band and DJ play only where the library has nothing for the stage.
import { S, bus } from '../core/state.js';
import { level } from './mixer.js';
import { USE_ID } from '/shared/catalog.js';
import { ctxB, ctxF, ctxOf, floorAt } from '/shared/constants.js';
import { MUSIC, placeKey } from '/shared/music.js';
import { toWorld, toLocal } from '/shared/geom.js';
import { JAZZ, CLUB } from './nightlife-songs.js';

const LOOK = 0.25;            // s of music scheduled ahead
const NEAR = 6;               // m: full volume this close
const REC = 0.5;              // a recording's level (the library is at -16 LUFS) against the synthesised band's
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUALITY = { maj7: [0, 4, 7, 11], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9], m: [0, 3, 7, 10], '': [0, 4, 7, 11] };
const SCALE = { maj7: [0, 2, 4, 5, 7, 9, 11], 7: [0, 2, 4, 5, 7, 9, 10], m7: [0, 2, 3, 5, 7, 9, 10], m7b5: [0, 1, 3, 5, 6, 8, 10], dim7: [0, 2, 3, 5, 6, 8, 9, 11], 6: [0, 2, 4, 7, 9], m6: [0, 2, 3, 5, 7, 9], m: [0, 2, 3, 5, 7, 8, 10], '': [0, 2, 4, 5, 7, 9, 11] };
const DEGREE = { m: [0, 'm'], iv: [5, 'm'], v: [7, 'm'], VI: [8, 'M'], III: [3, 'M'], VII: [10, 'M'] };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const rnd = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

let app = null, ac = null, master = null, verb = null, noiseBuf = null, lastScan = 0;
const venues = new Map();   // a stage (placeKey: building, floor, the piece) → its band or DJ

export function init(a) {
  app = a;
  const start = () => { if (!ac) begin(); else if (ac.state === 'suspended') ac.resume(); };
  window.addEventListener('pointerdown', start, { passive: true });
  window.addEventListener('keydown', start);
  bus.on('sound', () => setVolume());
  bus.on('frame', update);
  document.addEventListener('visibilitychange', () => { if (ac) (document.hidden ? ac.suspend() : ac.resume()).catch(() => {}); });
  a.nightMusic = { get playing() { return [...venues.values()].filter(v => v.audible).map(v => ({ kind: v.kind, place: v.place, song: v.songName, gain: +v.g.toFixed(3), players: Object.keys(v.players).filter(k => v.players[k]),
    recording: v.recs?.size ? [...v.recs.values()].map(r => ({ id: r.id, at: +r.el.currentTime.toFixed(2), paused: r.el.paused, level: +r.g.gain.value.toFixed(3) })) : null })); }, render: renderOffline, beatAt };
}
function begin() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  build(ac, ac.destination);
  setVolume();
}
/** The shared chain: the music's level, a soft limiter, a room's reverb. */
function build(ctx, dest) {
  ac = ctx;
  master = ac.createGain(); master.gain.value = 0;
  const lim = ac.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 8; lim.ratio.value = 6; lim.attack.value = 0.004; lim.release.value = 0.2;
  master.connect(lim); lim.connect(dest);
  verb = ac.createConvolver(); verb.buffer = impulse(2.4); const vg = ac.createGain(); vg.gain.value = 0.55; verb.connect(vg); vg.connect(master);
  const n = ac.sampleRate * 2; noiseBuf = ac.createBuffer(1, n, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
}
function impulse(sec) {
  const n = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, n, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6) * (i < 200 ? i / 200 : 1); }
  return b;
}
function setVolume() { if (master && ac) master.gain.setTargetAtTime(level('music'), ac.currentTime, 0.3); }

// ------------------------------------------------------------------ who is playing, and who is listening
/** A stage on a floor: { it, x, y, z } in world coordinates — the piece with that id, else of that type nearest (wx, wz). */
function stageOf(B, f, type, id = null, wx = 0, wz = 0) {
  const L = S.world.levels[B.lv?.[f]];
  let best = null, bd = Infinity;
  for (const it of L?.items || []) {
    if (id != null ? it.id !== id : it.t !== type) continue;
    const w = toWorld(B, it.x, it.z), d = Math.hypot(w.x - wx, w.z - wz);
    if (d < bd) { bd = d; best = { it, x: w.x, y: floorAt(B, f) + 1.3, z: w.z }; }
  }
  return best;
}
/** Which of the band someone at the Lounge Stage is, by where they stand on it (the piano left, the microphone in front,
 *  the double bass right: shared/catalog.js lounge_stage). */
function bandRole(B, st, wx, wz) {
  const l = toLocal(B, wx, wz), r = st.it.r || 0, c = Math.cos(r), s = Math.sin(r), dx = l.x - st.it.x, dz = l.z - st.it.z;
  const x = dx * c - dz * s, z = dx * s + dz * c;
  return x < -0.35 ? 'piano' : x > 0.8 ? 'bass' : z > 0.1 ? 'voice' : 'piano';
}
function scan() {
  const A = app.agents; if (!A || !S.world) return;
  const seen = new Map();   // place → { kind, players, B, f, st }
  // who is on stage (the people this page sees): the band's players by where they stand, the DJ
  for (let i = 0; i < A.n; i++) {
    const u = A.use[i], c = A.ctx[i];
    if (c < 0 || (u !== USE_ID.perform && u !== USE_ID.dj)) continue;
    const B = S.world.buildings[ctxB(c)]; if (!B) continue;
    const f = ctxF(c), dj = u === USE_ID.dj, st = stageOf(B, f, dj ? 'dj_stage' : 'lounge_stage', null, A.rx[i], A.rz[i]);
    if (!st) continue;
    const place = placeKey(B.idx, f, st.it.id);
    let e = seen.get(place);
    if (!e) seen.set(place, e = { kind: dj ? 'club' : 'jazz', players: {}, B, f, st });
    if (dj) e.players.dj = true; else e.players[bandRole(B, st, A.rx[i], A.rz[i])] = true;
  }
  // the stages playing the library's songs (their decks: the server sees the performers too)
  for (const d of S.music?.decks?.values() || []) {
    if (!d.music || !d.live || !(d.now || d.prev) || seen.has(d.place)) continue;
    const B = S.world.buildings[d.b], st = B && stageOf(B, d.f, null, d.id);
    if (st) seen.set(d.place, { kind: d.family === 'club' ? 'club' : 'jazz', players: {}, B, f: d.f, st });
  }
  for (const [place, e] of seen) {
    let v = venues.get(place);
    if (!v || v.kind !== e.kind) { if (v) drop(v); v = make(place, e.kind, e.B, e.f); venues.set(place, v); }
    v.players = e.players; v.src = e.st;
  }
  for (const [place, v] of venues) if (!seen.has(place)) v.players = {};
}
/** Where the listener is for a floor: the player walking it, else the camera looking into it; null: not there. */
function listenerFor(v) {
  const P = app.player;
  if (P && P.active) return P.ctx === v.ctx ? { x: P.x, y: P.y + 1.6, z: P.z } : null;
  if (S.focus && S.focus.b === v.b && S.focus.f === v.f) { const p = app.stage.camera.position; return { x: p.x, y: p.y, z: p.z }; }
  return null;
}
function update() {
  if (!ac || ac.state !== 'running') return;
  const now = performance.now();
  if (now - lastScan > 400) { lastScan = now; scan(); }
  const cam = app.stage.camera, right = { x: cam.matrixWorld.elements[0], z: cam.matrixWorld.elements[2] };
  for (const v of venues.values()) {
    const d = S.music?.decks?.get(v.place), rec = !!d?.music;   // (the library's songs, else the synthesised band)
    const on = rec ? !!(d.live && (d.now || d.prev)) : Object.values(v.players).some(Boolean), L = on ? listenerFor(v) : null;
    let g = 0, pan = 0;
    if (L) {
      const dx = v.src.x - L.x, dy = v.src.y - L.y, dz = v.src.z - L.z, d = Math.hypot(dx, dy, dz);
      g = Math.min(1, Math.pow(NEAR / Math.max(NEAR, d), 1.35));
      const h = Math.hypot(dx, dz) || 1, rl = Math.hypot(right.x, right.z) || 1;
      pan = Math.max(-0.7, Math.min(0.7, (dx * right.x + dz * right.z) / h / rl * Math.min(1, h / 4)));
    }
    v.g = g;
    v.out.gain.setTargetAtTime(g * (v.kind === 'club' ? 0.9 : 1), ac.currentTime, 0.25);
    v.send.gain.setTargetAtTime(g * (v.kind === 'club' ? 0.18 : 0.32) * (rec ? 0.3 : 1), ac.currentTime, 0.25);   // (a recording has its own room)
    v.pan.pan.setTargetAtTime(pan, ac.currentTime, 0.2);
    const audible = g > 0.004;
    if (rec) {
      v.quietSince = audible ? 0 : v.quietSince || now;
      recSync(v, d, audible || now - v.quietSince < 4000);   // (a moment's quiet keeps the stream)
      v.audible = audible;
      continue;
    }
    if (v.recs?.size) dropRecs(v);
    if (audible && !v.audible) cue(v);
    v.audible = audible;
    if (audible) while (v.next < ac.currentTime + LOOK) step(v);
  }
}

/** The beat of the music on floor f of building b (the lights move to it: render/venue-motion.js): { on, bpm, beat } —
 *  a deck's song by the server's clock (heard or not), else the synthesised band's or DJ's set while they play. */
function beatAt(b, f) {
  for (const d of S.music?.decks?.values() || []) {
    if (d.b !== b || d.f !== f || !d.music || !d.live || !d.now) continue;
    const tr = S.music.tracks.get(d.now.id), s = app.net.realNow() - d.now.at / 1000;
    if (tr && s >= 0) return { on: true, bpm: tr.bpm || 120, beat: s * (tr.bpm || 120) / 60 };
  }
  for (const v of venues.values()) {
    if (v.b !== b || v.f !== f || S.music?.decks?.get(v.place)?.music || !Object.values(v.players).some(Boolean)) continue;
    const s = (v.kind === 'club' ? CLUB : JAZZ)[v.song], bpm = s?.bpm || 120;
    if (ac && v.next && v.audible) return { on: true, bpm, beat: v.beat - (v.next - ac.currentTime) * bpm / 60 };
    return { on: true, bpm, beat: performance.now() / 1000 * bpm / 60 };
  }
  return { on: false, bpm: 0, beat: 0 };
}

// ------------------------------------------------------------------ the library's songs: streamed, in step with the deck
/** Plays what deck d has on (and, while the DJ blends, the track before), each at the second the server's clock says. */
function recSync(v, d, keep) {
  v.recs = v.recs || new Map();
  const t = app.net.realNow() * 1000, want = new Map();
  if (keep) {
    for (const [w, role] of [[d.now, 'now'], [d.prev, 'prev']]) {
      const tr = w && S.music.tracks.get(w.id); if (!tr) continue;
      const end = role === 'prev' ? w.end : w.at + tr.seconds * 1000;
      if (t < end + 300) want.set(`${w.id}@${w.at}`, { w, tr, role, end });
    }
  }
  for (const [k, r] of v.recs) if (!want.has(k)) { dropRec(r); v.recs.delete(k); }
  for (const [k, x] of want) {
    let r = v.recs.get(k);
    if (!r) { r = newRec(v, x.tr); v.recs.set(k, r); }
    const pos = (t - x.w.at) / 1000, el = r.el;
    let lvl = REC * Math.pow(10, (x.tr.gain || 0) / 20);
    if (x.role === 'now' && d.prev && d.family === 'club') lvl *= Math.max(0, Math.min(1, pos / MUSIC.clubBlend));   // the next track comes in
    if (x.role === 'prev') lvl *= Math.max(0, Math.min(1, (x.end - t) / 1000 / (d.family === 'club' ? MUSIC.clubBlend : 2.5)));   // the last one goes
    if (pos < 0 || pos >= x.tr.seconds) { lvl = 0; if (!el.paused) el.pause(); }
    else if (el.readyState >= 1 && !r.starting) {
      if (el.paused) {
        r.starting = true;
        try { el.currentTime = pos; } catch { /* not seekable yet */ }
        el.play().then(() => { r.starting = false; }, () => { r.starting = false; });
      } else if (!el.seeking && Math.abs(el.currentTime - pos) > 0.35) el.currentTime = pos + 0.05;   // (kept in step)
    }
    r.g.gain.setTargetAtTime(lvl, ac.currentTime, 0.08);
    if (x.role === 'now') v.songName = x.tr.title;
  }
}
function newRec(v, tr) {
  const el = new Audio(); el.preload = 'auto'; el.src = `/api/music/file/${tr.id}`;
  const node = ac.createMediaElementSource(el), g = ac.createGain(); g.gain.value = 0;
  node.connect(g); g.connect(v.bus);
  return { id: tr.id, el, node, g, starting: false };
}
function dropRec(r) { try { r.el.pause(); r.el.removeAttribute('src'); r.el.load(); r.node.disconnect(); r.g.disconnect(); } catch { /* gone */ } }
function dropRecs(v) { for (const r of v.recs.values()) dropRec(r); v.recs.clear(); }

// ------------------------------------------------------------------ a band or a DJ: its sound chain and its place in the set
function make(place, kind, B, f) {
  const out = ac.createGain(); out.gain.value = 0;
  const pan = ac.createStereoPanner(); out.connect(pan); pan.connect(master);
  const send = ac.createGain(); send.gain.value = 0; send.connect(verb);
  const bus = ac.createGain(); bus.connect(out); bus.connect(send);
  const v = { place, ctx: ctxOf(B.idx, f), b: B.idx, f, kind, out, pan, send, bus, players: {}, g: 0, audible: false, next: 0, song: 0, beat: 0, seed: hash(`${B.idx}:${f}`), recs: new Map() };
  if (kind === 'club') {
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.12;
    comp.connect(bus); v.dry = comp;
    v.duck = ac.createGain(); v.duck.connect(comp);   // (what pumps with the kick: the bass, the chords)
  } else v.dry = bus;
  return v;
}
function drop(v) { dropRecs(v); try { v.out.disconnect(); v.send.disconnect(); } catch { /* gone */ } }
/** Where the set is now (the clock: the same for everyone), and the next beat on the audio clock. */
function cue(v) {
  const list = v.kind === 'club' ? CLUB : JAZZ, beats = list.map(s => songBeats(v.kind, s));
  const secs = list.map((s, k) => beats[k] * 60 / s.bpm), total = secs.reduce((a, b) => a + b, 0);
  let t = ((Date.now() / 1000 + (v.seed % 3600)) % total), k = 0;
  while (t >= secs[k]) { t -= secs[k]; k = (k + 1) % list.length; }
  const bd = 60 / list[k].bpm, b = Math.floor(t / bd);
  v.song = k; v.beat = b; v.next = ac.currentTime + 0.06 + (bd - (t - b * bd));
}
/** A song's length in beats (a jazz tune: its choruses and two bars to ring out and breathe). */
const songBeats = (kind, s) => (kind === 'club' ? s.form.reduce((a, [, n]) => a + n, 0) * 4 : s.bars.length * s.choruses * 4 + 8);
function step(v) {
  const list = v.kind === 'club' ? CLUB : JAZZ, s = list[v.song], bd = 60 / s.bpm, total = songBeats(v.kind, s);
  v.songName = s.name;
  if (v.beat < total) (v.kind === 'club' ? clubBeat : jazzBeat)(v, s, v.beat, v.next, bd);
  v.next += bd; v.beat++;
  if (v.beat >= total) { v.beat = 0; v.song = (v.song + 1) % list.length; }
}

// ------------------------------------------------------------------ harmony
function chord(sym) {
  const m = /^([A-G])([b#]?)(maj7|m7b5|dim7|m7|m6|7|6|m)?$/.exec(sym) || ['', 'C', '', 'maj7'];
  const root = (PITCH[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0) + 12) % 12, q = m[3] || '';
  return { root, q, tones: QUALITY[q] || QUALITY[''], scale: SCALE[q] || SCALE[''] };
}
function chordAt(s, bar, beat) { const syms = s.bars[bar % s.bars.length].split(' '); return chord(syms[syms.length > 1 && beat >= 2 ? 1 : 0]); }
/** A chord voiced without its root between lo and hi (3rd, 5th or 13th, 7th, 9th), as a pianist's left hand. */
function voicing(c, lo = 50, hi = 67) {
  const pcs = [c.tones[1], c.q === 'm7b5' || c.q === 'dim7' ? c.tones[2] : (c.q === '7' ? 9 : c.tones[2]), c.tones[3], 14].map(i => (c.root + i) % 12);
  return pcs.map(pc => { let n = lo + ((pc - lo) % 12 + 12) % 12; while (n > hi) n -= 12; return n; }).sort((a, b) => a - b);
}
const nearPc = (pc, around) => { let n = around + (((pc - around) % 12) + 18) % 12 - 6; return n; };

// ------------------------------------------------------------------ the instruments
function osc(type, f, t, end, dest) { const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.connect(dest); o.start(t); o.stop(end); return o; }
function env(t, a, peak, dec, sus, rel, len) {
  const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(sus, t + a, dec); g.gain.setValueAtTime(sus, t + len); g.gain.setTargetAtTime(0, t + len, rel);
  return g;
}
/** An electric piano (two-operator FM with a bell-like tine): the lounge's piano. */
function epiano(v, t, midi, len, vel) {
  const f = mtof(midi), g = ac.createGain(), end = t + len + 1.6;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.004); g.gain.setTargetAtTime(0.035 * vel, t + 0.01, 0.45); g.gain.setTargetAtTime(0, t + len, 0.28);
  g.connect(v.dry);
  const car = osc('sine', f, t, end, g), mod = ac.createOscillator(), mg = ac.createGain();
  mod.frequency.value = f; mg.gain.setValueAtTime(f * (1.6 + vel), t); mg.gain.setTargetAtTime(f * 0.18, t, 0.35);
  mod.connect(mg); mg.connect(car.frequency); mod.start(t); mod.stop(end);
  const tg = ac.createGain(); tg.gain.setValueAtTime(0.05 * vel, t); tg.gain.setTargetAtTime(0, t, 0.05); tg.connect(v.dry);
  osc('sine', f * 7.1, t, t + 0.3, tg);
}
/** An upright bass: a plucked, warm low note that sags a little in pitch. */
function upright(v, t, midi, len, vel) {
  const f = mtof(midi), end = t + len + 0.4, lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.setTargetAtTime(380, t, 0.12);
  const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.006); g.gain.setTargetAtTime(0.16 * vel, t + 0.01, 0.12); g.gain.setTargetAtTime(0, t + len * 0.92, 0.06);
  lp.connect(g); g.connect(v.dry);
  for (const [type, k] of [['triangle', 1], ['sine', 0.5]]) { const o = osc(type, f * k * 1.012, t, end, lp); o.frequency.setTargetAtTime(f * k, t, 0.03); }
}
/** A scat voice: a sung "doo" or "bah" (a buzzing tone through two vowel formants, a little vibrato). */
const VOWEL = { oo: [320, 800], ah: [730, 1150], oh: [500, 900], ee: [300, 2200] };
function voice(v, t, midi, len, vel, vowel) {
  const f = mtof(midi), end = t + len + 0.3, [f1, f2] = VOWEL[vowel] || VOWEL.oo, o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.985, t); o.frequency.setTargetAtTime(f, t, 0.04);
  const vib = ac.createOscillator(), vg = ac.createGain(); vib.frequency.value = 5.4; vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.35, len)); vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(end);
  const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 * vel, t + 0.05); g.gain.setValueAtTime(0.1 * vel, t + len * 0.8); g.gain.setTargetAtTime(0, t + len * 0.85, 0.07);
  for (const [ff, q, k] of [[f1, 7, 1], [f2, 9, 0.55], [2600, 6, 0.18]]) { const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q; const bg = ac.createGain(); bg.gain.value = k; o.connect(bp); bp.connect(bg); bg.connect(g); }
  g.connect(v.dry); o.start(t); o.stop(end);
}
function noise(v, t, len, type, f, q, peak, decay, dest = v.dry) {
  const src = ac.createBufferSource(); src.buffer = noiseBuf; const bq = ac.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q;
  const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.002); g.gain.setTargetAtTime(0, t + 0.004, decay);
  src.connect(bq); bq.connect(g); g.connect(dest); src.start(t, Math.random() * 1.5); src.stop(t + len); return g;
}

// ------------------------------------------------------------------ the lounge's trio
function jazzBeat(v, s, beat, t, bd) {
  const P = v.players, bar = Math.floor(beat / 4), b = beat % 4, form = s.bars.length * s.choruses, R = rnd(s.seed * 1000 + beat);
  if (bar >= form) {   // the ending: a last chord rung out, then a breath before the next tune
    if (bar === form && b === 0 && (P.piano || P.voice || P.bass)) { const c = chordAt(s, 0, 0); for (const n of voicing(c, 52, 70)) epiano(v, t, n, bd * 6, 0.8); if (P.bass) upright(v, t, 36 + c.root, bd * 5, 0.9); }
    return;
  }
  const c = chordAt(s, bar, b), swing = s.feel === 'swing' || s.feel === 'blues', sw = swing ? 0.66 : 0.5;
  const nextC = chordAt(s, b >= 2 || s.bars[bar % s.bars.length].split(' ').length === 1 ? bar + 1 : bar, b >= 2 ? 0 : 2);
  // the bass: walking quarters (swing, blues), two to a bar (ballad), the bossa's root and fifth
  if (P.bass) {
    const root = 36 + ((c.root + 4) % 12) - 4 + 0;
    if (s.feel === 'ballad') { if (b === 0 || b === 2) upright(v, t, b === 0 ? root : root + 7, bd * 1.9, 0.85); }
    else if (s.feel === 'bossa') { if (b === 0) upright(v, t, root, bd * 1.4, 0.9); if (b === 1) upright(v, t + bd * 0.5, root + 7, bd * 0.45, 0.7); if (b === 2) upright(v, t, root + 7, bd * 1.4, 0.85); if (b === 3) upright(v, t + bd * 0.5, root, bd * 0.45, 0.7); }
    else {
      const next = 36 + ((nextC.root + 4) % 12) - 4;
      const n = b === 0 ? root : b === 3 ? next + (R() < 0.5 ? 1 : -1) : root + c.tones[b === 1 ? 1 : 2] - (R() < 0.3 ? 12 : 0);
      upright(v, t, Math.max(28, n), bd * 0.92, b === 0 ? 0.95 : 0.8);
    }
  }
  // the piano's left hand: comping in the feel's rhythm
  if (P.piano) {
    const vs = voicing(c), hit = (off, len, vel) => { for (const n of vs) epiano(v, t + off * bd, n, len * bd, vel); };
    if (s.feel === 'ballad') { if (b === 0) hit(0, 3.6, 0.7); else if (b === 2 && R() < 0.5) for (const [k, n] of vs.entries()) epiano(v, t + k * 0.12 * bd, n + 12, bd * 1.8, 0.4); }
    else if (s.feel === 'bossa') { if (b === 0 || (b === 1 && R() < 0.8) || b === 3) hit(b === 1 ? 0.5 : 0, 0.8, 0.6); }
    else { const pat = (s.seed + bar) % 3; if ((pat === 0 && (b === 0 || b === 1)) || (pat === 1 && (b === 1 || b === 3)) || (pat === 2 && b === 2)) hit(b === 0 ? 0 : sw, b === 0 ? 1.2 : 0.6, 0.62); }
  }
  // the tune: sung (scat) when the singer is at the microphone, else the piano's right hand
  const lead = P.voice ? 'voice' : P.piano ? 'piano' : null;
  if (lead) {
    const phrase = rnd(s.seed * 77 + Math.floor(bar / 2))() < 0.72;   // (phrases of two bars, with breaths between)
    if (phrase && !(bar % 2 === 1 && b === 3)) {
      const lo = lead === 'voice' ? 60 : 67, hi = lead === 'voice' ? 76 : 86;
      v.mel = v.mel || Math.round((lo + hi) / 2);
      const offs = s.feel === 'ballad' ? [0] : R() < 0.65 ? [0, sw] : [0];
      for (const off of offs) {
        if (R() < 0.18) continue;
        const strong = off === 0 && (b === 0 || b === 2), scale = s.feel === 'blues' ? [0, 3, 5, 6, 7, 10] : strong ? c.tones : c.scale;
        let best = v.mel, bestD = 99;
        for (const iv of scale) { const n = nearPc((c.root + iv) % 12, Math.round(v.mel + (R() - 0.5) * 6)); if (n >= lo && n <= hi) { const d = Math.abs(n - v.mel) + R() * 2.2; if (d < bestD && n !== v.mel) { bestD = d; best = n; } } }
        v.mel = best;
        const len = (offs.length > 1 ? (off === 0 ? sw : 1 - sw) : s.feel === 'ballad' ? 1.6 : 0.9) * bd;
        if (lead === 'voice') voice(v, t + off * bd, best, len * 0.95, strong ? 0.9 : 0.7, ['oo', 'ah', 'oh', 'oo'][Math.floor(R() * 4)]);
        else epiano(v, t + off * bd, best, len, strong ? 0.75 : 0.55);
      }
    }
  }
  // brushes on a ride for the swing (the band's own hands: a light shuffle the pianist taps out)
  if (swing && P.bass && P.piano) { noise(v, t, 0.2, 'highpass', 7500, 0.7, 0.025, 0.06); if (b % 2 === 1) noise(v, t + sw * bd, 0.15, 'highpass', 7500, 0.7, 0.018, 0.04); }
}

// ------------------------------------------------------------------ the club's DJ
function sectionAt(s, bar) { let b = bar; for (const [name, n] of s.form) { if (b < n) return { name, bar: b, bars: n }; b -= n; } return { name: 'outro', bar: 0, bars: 1 }; }
function clubChord(s, bar) { const [deg, kind] = DEGREE[s.loop[Math.floor(bar / 2) % s.loop.length]]; const root = s.root + deg; return { root, tones: kind === 'm' ? [0, 3, 7] : [0, 4, 7] }; }
function kick(v, t) {
  const g = ac.createGain(), o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.002); g.gain.setTargetAtTime(0, t + 0.02, 0.13);
  o.connect(g); g.connect(v.dry); o.start(t); o.stop(t + 0.6);
  noise(v, t, 0.03, 'highpass', 2500, 0.7, 0.12, 0.006);
  if (v.duck) { v.duck.gain.cancelScheduledValues(t); v.duck.gain.setValueAtTime(0.28, t); v.duck.gain.linearRampToValueAtTime(1, t + 0.22); }
}
function clap(v, t) { for (const k of [0, 0.011, 0.023]) noise(v, t + k, 0.05, 'bandpass', 1300, 1.2, 0.35, 0.012); noise(v, t + 0.03, 0.4, 'bandpass', 1500, 0.8, 0.14, 0.09); }
function bassSynth(v, t, midi, len, vel) {
  const f = mtof(midi), end = t + len + 0.1, lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6; lp.frequency.setValueAtTime(260, t); lp.frequency.linearRampToValueAtTime(1100 * vel, t + 0.02); lp.frequency.setTargetAtTime(240, t + 0.03, 0.08);
  const g = env(t, 0.004, 0.32 * vel, 0.1, 0.22 * vel, 0.03, len); lp.connect(g); g.connect(v.duck || v.dry);
  osc('sawtooth', f, t, end, lp); osc('square', f / 2, t, end, lp);
}
/** Supersaw chords: five saws a note, spread, through a filter (cutoff: how open). */
function saws(v, t, notes, len, vel, cutoff, attack = 0.005) {
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 1.2;
  const g = env(t, attack, 0.05 * vel, 0.25, 0.035 * vel, 0.12, len); lp.connect(g); g.connect(v.duck || v.dry);
  for (const n of notes) for (const d of [-14, -6, 0, 7, 13]) { const o = osc('sawtooth', mtof(n), t, t + len + 0.6, lp); o.detune.value = d; }
}
function pluck(v, t, midi, vel) {
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4; lp.frequency.setValueAtTime(4800 * vel, t); lp.frequency.setTargetAtTime(500, t, 0.07);
  const g = env(t, 0.002, 0.1 * vel, 0.09, 0.0, 0.05, 0.2); lp.connect(g); g.connect(v.dry);
  osc('sawtooth', mtof(midi), t, t + 0.5, lp); const o2 = osc('square', mtof(midi + 12), t, t + 0.5, lp); o2.detune.value = 5;
}
function clubBeat(v, s, beat, t, bd) {
  if (!v.players.dj) return;
  const bar = Math.floor(beat / 4), b = beat % 4, sec = sectionAt(s, bar), c = clubChord(s, bar), R = rnd(s.seed * 1000 + beat), q = bd / 4;
  const name = sec.name, last = sec.bar === sec.bars - 1;
  const drums = name === 'drop' || name === 'outro' || name === 'intro' || (name === 'build' && sec.bar < sec.bars - 2);
  // kick, and the drop's crash
  if (drums && !(name === 'build' && last)) kick(v, t);
  if (name === 'drop' && sec.bar === 0 && b === 0) noise(v, t, 2.5, 'highpass', 5000, 0.5, 0.25, 0.8);
  // claps and hats
  if ((name === 'drop' || name === 'outro' || (name === 'intro' && sec.bar >= 8)) && (b === 1 || b === 3)) clap(v, t);
  if (name !== 'break' && !(name === 'intro' && sec.bar < 4)) { noise(v, t + 2 * q, 0.05, 'highpass', 8500, 0.7, 0.13, 0.018); if (name === 'drop' && b === 3) noise(v, t + 2 * q, 0.3, 'highpass', 7500, 0.6, 0.09, 0.09); }
  if (name === 'drop') for (const k of [1, 3]) noise(v, t + k * q, 0.03, 'highpass', 11000, 0.6, 0.04, 0.008);
  // the build: a snare roll that quickens and a rising sweep
  if (name === 'build') {
    const n = sec.bar < 4 ? 1 : sec.bar < 6 ? 2 : 4, lvl = 0.06 + 0.2 * (sec.bar * 4 + b) / (sec.bars * 4);
    if (!(last && b === 3)) for (let k = 0; k < n; k++) noise(v, t + k * bd / n, 0.08, 'bandpass', 1900, 0.9, lvl, 0.03);
    if (sec.bar === 0 && b === 0) { const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true; const hp = ac.createBiquadFilter(); hp.type = 'bandpass'; hp.Q.value = 2; const len = sec.bars * 4 * bd; hp.frequency.setValueAtTime(300, t); hp.frequency.exponentialRampToValueAtTime(9000, t + len); const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + len); g.gain.setValueAtTime(0, t + len); src.connect(hp); hp.connect(g); g.connect(v.dry); src.start(t); src.stop(t + len + 0.05); }
  }
  // the bass: off the beat, or rolling sixteenths
  const bassOn = name === 'drop' || name === 'outro' || (name === 'intro' && sec.bar >= 8) || (name === 'build' && sec.bar < sec.bars - 2);
  if (bassOn) {
    const root = 36 + ((c.root - 36) % 12 + 12) % 12;
    if (s.bass === 'rolling') for (const k of [1, 2, 3]) bassSynth(v, t + k * q, root + (k === 3 && R() < 0.3 ? 12 : 0), q * 0.9, 0.8);
    else bassSynth(v, t + 2 * q, root, q * 1.8, 0.9);
  }
  // the chords: stabs on the off-beats in the drop, a held pad in the intro, the build (opening) and the break
  const triad = c.tones.map(i => 60 + ((c.root + i - 60) % 12 + 12) % 12 - (c.root % 12 > 7 ? 12 : 0));
  if (name === 'drop') { if (s.lead === 'stab' || R() < 0.6) saws(v, t + 2 * q, triad, q * 1.4, 0.9, 3200); }
  else if ((name === 'break' || name === 'intro' || name === 'build') && bar % 2 === 0 && b === 0) {
    const open = name === 'build' ? 600 + 3400 * sec.bar / sec.bars : name === 'break' ? 2400 : 900;
    saws(v, t, [...triad, triad[0] - 12], bd * 7.6, 0.8, open, 0.6);
  }
  // the lead: an arpeggio, a hook of its own, in the drop and the break
  if (name === 'drop' || (name === 'break' && sec.bar >= 4)) {
    const notes = [...triad.map(n => n + 12), triad[0] + 24];
    if (s.lead === 'arp') for (let k = 0; k < 4; k++) pluck(v, t + k * q, notes[(beat * 4 + k) % notes.length], name === 'break' ? 0.5 : 0.8);
    else if (s.lead === 'hook') { const H = rnd(s.seed * 31 + (bar % 2) * 4 + b); for (let k = 0; k < 4; k += H() < 0.5 ? 1 : 2) if (H() < 0.75) pluck(v, t + k * q, notes[Math.floor(H() * notes.length)], 0.85); }
  }
}

// ------------------------------------------------------------------ a recording (lab checks; tools-bin/nightlife-music-check.mjs)
/** Renders `seconds` of a style offline ('jazz' with the whole band, or 'club' mid-drop) to a Float32Array per channel. */
async function renderOffline(kind = 'jazz', seconds = 20, songIdx = 0, at = 0) {
  const sr = 44100, oc = new OfflineAudioContext(2, sr * seconds, sr), keep = { ac, master, verb, noiseBuf };
  build(oc, oc.destination); master.gain.value = 1;
  const v = make(-9, kind, { idx: 0 }, 0); v.players = kind === 'club' ? { dj: true } : { piano: true, bass: true, voice: true };
  v.out.gain.value = 1; v.send.gain.value = kind === 'club' ? 0.18 : 0.32; v.song = songIdx; v.beat = at; v.next = 0.05;
  while (v.next < seconds) step(v);
  ({ ac, master, verb, noiseBuf } = keep);   // (the live sound as it was)
  const buf = await oc.startRendering();
  return [buf.getChannelData(0), buf.getChannelData(1)];
}
