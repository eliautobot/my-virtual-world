// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's own music in the background (2026-10-26, the product owner: "are the background world music working? do the
// sound settings have it to control normal background music vol?" ... "ok build it"): the game's score (the library's
// 'score' songs: server/music/soundtrack/, each with its mood and its loop points) as you go about the world.
//
//   which      the mood of the moment (shared/music.js scoreMood): 'build' while building or furnishing, else by the
//              city's hour: day, evening, night. A song loops between its loop points (seamless: baked so,
//              tools-bin/loop-music.py) for two and a half to four minutes, then another of its mood comes in over a
//              slow crossfade; a new mood (dusk falls, you start building) comes in sooner.
//   how loud   Settings → Sound → Background music (audio/mixer.js 'score'; the top bar's mute and the master volume
//              too). It makes way: it fades out where live music plays (a lounge's band, a club's DJ: the louder they
//              are here, the less of it), dips while an agent speaks or the page listens to you, and while a machine's
//              or a cabinet's game is open.
//   what it    fetches a song only when it is to play (none while its volume is 0), keeps at most two decoded (the one
//   costs      playing and the next), at 32 kHz; nothing plays until the first click or key (browser rules), and the
//              page's sound stops while it is hidden.
import { S, bus } from '../core/state.js';
import { level } from './mixer.js';
import { SCORE, scoreMood, scoreTracks, scoreNext } from '/shared/music.js';

let app = null, ac = null, out = null, cur = null, seq = 0, lastT = 0, quietSince = 0, speaking = 0, failUntil = 0;
const ducks = new Set(), lastOf = new Map(), cache = new Map();   // mood → the last song of it; song id → its decoding

export function init(a) {
  app = a;
  const start = () => { if (!ac) begin(); else if (ac.state === 'suspended' && !document.hidden) ac.resume().catch(() => {}); };
  window.addEventListener('pointerdown', start, { passive: true });
  window.addEventListener('keydown', start);
  bus.on('sound', () => tick(true));
  bus.on('music', () => tick(true));
  bus.on('mode', () => tick(true));
  bus.on('frame', () => tick(false));
  bus.on('audio:duck', ({ who, on } = {}) => { if (!who) return; if (on) ducks.add(who); else ducks.delete(who); tick(true); });
  bus.on('audio:speaking', on => { speaking = Math.max(0, speaking + (on ? 1 : -1)); tick(true); });
  document.addEventListener('visibilitychange', () => { if (ac) (document.hidden ? ac.suspend() : ac.resume()).catch(() => {}); });
  a.score = {
    get state() {
      return { audio: ac ? ac.state : null, mood: wantMood(), song: cur ? { id: cur.t.id, title: cur.t.title, mood: cur.t.mood, for: +(ac.currentTime - cur.at).toFixed(1), turn: Math.round(cur.turn) } : null,
        gain: out ? +out.gain.value.toFixed(3) : 0, target: +target().toFixed(3), decoded: [...cache.keys()] };
    },
  };
}

function begin() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  out = ac.createGain(); out.gain.value = 0; out.connect(ac.destination);
  tick(true);
}

const building = () => S.mode === 'build' || S.mode === 'furnish';
const wantMood = () => scoreMood(S.hour, building());

/** How loud the score is to be now (0..1): its volume, made way for live music, voices, a game being played. */
function target() {
  let k = level('score');
  if (!k) return 0;
  let live = 0;
  for (const v of app?.nightMusic?.playing || []) live = Math.max(live, Number(v.gain) || 0);
  if (live > 0) k *= Math.max(0, 1 - live * 25);   // (a band or a DJ heard here at all: theirs is the music; their level is by distance, about 0.04 looking in from above)
  if (speaking) k *= 0.35;
  if (ducks.size) k *= 0.15;
  if (app?.arcade?.session || app?.machinePlay?.active) k *= 0.3;
  return k * SCORE.level;
}

function tick(force) {
  const now = performance.now();
  if (!force && now - lastT < 250) return;
  lastT = now;
  if (!ac || !out) return;
  const k = target();
  out.gain.setTargetAtTime(k, ac.currentTime, k > out.gain.value ? 1.2 : 0.6);
  if (level('score') === 0) {   // (turned off: the song goes after its fade, nothing more is fetched)
    if (!quietSince) quietSince = now;
    if (cur && now - quietSince > 4000) stopAll();
    return;
  }
  quietSince = 0;
  if (!S.music?.ready || S.hour == null || now < failUntil) return;
  const mood = wantMood(), list = scoreTracks(S.music.tracks.values(), mood);
  if (!list.length) return;
  if (!cur) { play(scoreNext(list, null, lastOf.get(mood)), 2.5); return; }
  if (cur.loading) return;
  const fits = list.some(t => t.id === cur.t.id);
  if (!fits) play(scoreNext(list, cur.t.id, lastOf.get(mood)), SCORE.quick);
  else if (ac.currentTime - cur.at > cur.turn && list.length > 1) play(scoreNext(list, cur.t.id, lastOf.get(mood)), SCORE.fade);
  else if (ac.currentTime - cur.at > cur.turn) cur.turn += SCORE.turn[0];   // (only one of its mood: it plays on)
}

/** A song decoded (32 kHz is plenty for the score and half the memory of 48), fetched once; kept: this one and the one playing. */
function decoded(t) {
  if (!cache.has(t.id)) {
    const p = fetch(`/api/music/file/${encodeURIComponent(t.id)}`).then(r => { if (!r.ok) throw new Error(`song ${r.status}`); return r.arrayBuffer(); })
      .then(buf => {
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        try { if (OAC) return new OAC(2, 1, 32000).decodeAudioData(buf); } catch { /* the page's own context then */ }
        return ac.decodeAudioData(buf);
      });
    p.catch(() => cache.delete(t.id));
    cache.set(t.id, p);
  }
  for (const id of [...cache.keys()]) if (id !== t.id && id !== cur?.t.id) cache.delete(id);
  return cache.get(t.id);
}

async function play(t, fade) {
  if (!t) return;
  const my = ++seq, was = cur;
  if (was) was.loading = true;
  else cur = { t, loading: true, at: ac.currentTime, turn: SCORE.turn[0] };
  let buf;
  try { buf = await decoded(t); } catch { if (my === seq) { if (was) was.loading = false; else cur = null; failUntil = performance.now() + 20000; } return; }   // (a song that won't come: try again in a while)
  if (my !== seq || !ac) return;
  const src = ac.createBufferSource(), g = ac.createGain(), now = ac.currentTime;
  src.buffer = buf; src.loop = true;
  if (Array.isArray(t.loop) && t.loop[1] > t.loop[0]) { src.loopStart = t.loop[0]; src.loopEnd = Math.min(t.loop[1], buf.duration); }
  const vol = Math.pow(10, (Number(t.gain) || 0) / 20);
  g.gain.value = 0; src.connect(g); g.connect(out);
  src.start(now);
  g.gain.setTargetAtTime(vol, now, fade / 3);
  if (was?.src) { was.g.gain.cancelScheduledValues(now); was.g.gain.setTargetAtTime(0, now, fade / 3); try { was.src.stop(now + fade * 1.8); } catch { /* gone */ } }
  cur = { t, src, g, at: now, turn: SCORE.turn[0] + Math.random() * (SCORE.turn[1] - SCORE.turn[0]), loading: false };
  lastOf.set(t.mood, t.id);
}

function stopAll() {
  seq++;
  if (cur?.src) { try { cur.src.stop(); } catch { /* gone */ } }
  cur = null; cache.clear();
}
