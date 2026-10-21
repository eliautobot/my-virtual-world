// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The ambient soundscape (WP4.18, wp4-world-spec.md §6.4): synthesised in the browser with Web Audio — no recordings,
// so nothing to license or download. Beds of shaped noise for wind (with gusts), rain, surf near the coast and the city's
// hum; birdsong by day and crickets at night in the countryside, gulls by the sea, thunder after lightning. Levels follow
// the weather (render/weather.js), the hour, and where the camera is (near the sea, in the city, high up). The volume is
// the World sounds volume (Settings → Sound, audio/mixer.js); audio starts after the first click or key (browser rules). While
// the page listens to someone (a voice conversation, dictation) it is turned down to a whisper ('audio:duck' on the bus),
// so the microphone hears them and not the city — and finds the pause when they stop.
import { S, bus } from '../core/state.js';
import { level } from './mixer.js';
import { GU } from '../render/scene.js';

const DUCK = 0.08;          // (of its level, while the page listens)
const ducks = new Set();    // who is listening now: 'voice-mode', 'dictation'
let app = null, ctx = null, master = null, beds = null, nextChirp = 0, nextGull = 0, nextCricket = 0;

export function init(a) {
  app = a;
  const start = () => { if (!ctx) begin(); else if (ctx.state === 'suspended') ctx.resume(); };
  window.addEventListener('pointerdown', start, { passive: true });
  window.addEventListener('keydown', start);
  bus.on('sound', () => setVolume());
  bus.on('audio:duck', ({ who, on } = {}) => { if (!who) return; if (on) ducks.add(who); else ducks.delete(who); setVolume(); });
  bus.on('thunder', e => thunder(e));
  a.ambience = { get gain() { return master ? master.gain.value : null; } };   // (how loud it is set now: the checks read it)
  bus.on('frame', update);
  document.addEventListener('visibilitychange', () => { if (ctx) (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {}); });
}
function begin() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const white = noise('white'), brown = noise('brown');
  beds = {
    wind: bed(brown, [['bandpass', 380, 0.6]]),
    rain: bed(white, [['highpass', 900, 0.5], ['lowpass', 7000, 0.4]]),
    surf: bed(brown, [['lowpass', 520, 0.5]]),
    city: bed(brown, [['lowpass', 260, 0.5], ['highpass', 50, 0.5]]),
    river: bed(white, [['bandpass', 1300, 0.7], ['lowpass', 4500, 0.4]]),
  };
  setVolume();
}
function setVolume() { if (master) master.gain.setTargetAtTime(level('world') * (ducks.size ? DUCK : 1), ctx.currentTime, ducks.size ? 0.15 : 0.6); }
/** A two-second looping noise buffer: white, or brown (integrated, deep). */
function noise(kind) {
  const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w * 0.5; }
  return b;
}
function bed(buffer, filters) {
  const src = ctx.createBufferSource(); src.buffer = buffer; src.loop = true;
  let node = src;
  for (const [type, f, q] of filters) { const bq = ctx.createBiquadFilter(); bq.type = type; bq.frequency.value = f; bq.Q.value = q; node.connect(bq); node = bq; }
  const g = ctx.createGain(); g.gain.value = 0; node.connect(g); g.connect(master);
  src.start(ctx.currentTime + Math.random());
  return g;
}
const set = (g, v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.6);

/** Where the camera is: near the sea (0..1), in the city (0..1), out in the country (0..1), height above the ground (m). */
function place() {
  const cam = app.cam, T = app.terrain, t = cam.target, g = S.grid;
  const cp = app.stage.camera.position, ground = T ? Math.max(T.params.seaLevel, T.heightAt(cp.x, cp.z)) : 0, alt = Math.max(0, cp.y - ground);
  let sea = 0;
  if (T) for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (T.isWater(t.x + Math.cos(a) * 140, t.z + Math.sin(a) * 140)) sea += 1 / 8; }
  const out = g ? Math.max(g.minX - t.x, t.x - g.maxX, g.minZ - t.z, t.z - g.maxZ) : 0;
  const city = out <= 0 ? 1 : Math.max(0, 1 - out / 250);
  // running water: near a river's channel, louder where it falls steeply
  let river = 0;
  const I = T?.ground?.island;
  if (I?.rivers?.length) for (const [ox, oz] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]]) { const r = I.riverAt(t.x + ox, t.z + oz); if (r) river = Math.max(river, (1 - r.d / (r.width / 2 + 16)) * (0.55 + Math.min(0.45, r.slope * 2))); }
  return { sea, city, country: (1 - city) * (1 - sea), alt, river };
}
function update() {
  if (!ctx || ctx.state !== 'running' || !beds) return;
  const w = app.weather?.now || { rain: 0, wind: { speed: 3 }, storm: 0 }, P = place(), night = app.stage.state.night, gust = GU.uWind.value.y;
  const near = Math.max(0, 1 - P.alt / 350), inside = S.focus && S.focus.b >= 0 ? 0.35 : 1;
  set(beds.wind, inside * (0.04 + 0.022 * w.wind.speed) * (0.6 + 0.6 * gust) * (0.6 + 0.4 * Math.min(1, P.alt / 120 + P.country)));
  set(beds.rain, inside * w.rain * 0.55 * (0.3 + 0.7 * near));
  const swell = 0.6 + 0.4 * Math.sin(ctx.currentTime * 0.85) * Math.sin(ctx.currentTime * 0.31 + 1);
  set(beds.surf, inside * P.sea * 0.5 * swell * (0.4 + 0.6 * near));
  set(beds.city, inside * P.city * near * (0.12 + 0.1 * (1 - night)));
  set(beds.river, inside * P.river * near * 0.4);
  // creatures: birds by day in the country (not in rain), crickets on warm nights, gulls by the sea
  const now = ctx.currentTime, calm = 1 - Math.min(1, w.rain * 1.5 + w.storm);
  if (now > nextChirp) { nextChirp = now + 0.4 + Math.random() * 2.2 / Math.max(0.05, P.country * (1 - night) * calm); if (P.country * (1 - night) * calm * near > 0.15) chirp(); }
  if (now > nextCricket) { nextCricket = now + 0.25 + Math.random() * 0.5; if (night > 0.6 && P.country * calm * near > 0.2) cricket(0.05 * P.country * near); }
  if (now > nextGull) { nextGull = now + 3 + Math.random() * 9; if (P.sea * (1 - night) * calm > 0.2) gull(0.06 * P.sea); }
}

/** A songbird phrase: a few quick frequency sweeps, panned somewhere around the listener. */
function chirp() {
  const t0 = ctx.currentTime + 0.02, base = 2600 + Math.random() * 2400, n = 2 + Math.floor(Math.random() * 5), pan = ctx.createStereoPanner(), g = ctx.createGain();
  pan.pan.value = Math.random() * 1.6 - 0.8; g.gain.value = 0; g.connect(pan); pan.connect(master);
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(), t = t0 + i * (0.09 + Math.random() * 0.06), f = base * (0.85 + Math.random() * 0.4);
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.7), t + 0.07);
    o.connect(g); o.start(t); o.stop(t + 0.09);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.012); g.gain.linearRampToValueAtTime(0, t + 0.085);
  }
  setTimeout(() => { pan.disconnect(); }, (n * 0.16 + 0.5) * 1000);
}
function cricket(level) {
  const t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner();
  o.type = 'triangle'; o.frequency.value = 4300 + Math.random() * 500; pan.pan.value = Math.random() * 1.4 - 0.7;
  o.connect(g); g.connect(pan); pan.connect(master); g.gain.value = 0;
  for (let k = 0; k < 3; k++) { const s = t + k * 0.055; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(level, s + 0.01); g.gain.linearRampToValueAtTime(0, s + 0.04); }
  o.start(t); o.stop(t + 0.2); o.onended = () => pan.disconnect();
}
function gull(level) {
  const t = ctx.currentTime + 0.02, o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter(), pan = ctx.createStereoPanner();
  o.type = 'sawtooth'; f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 2; pan.pan.value = Math.random() * 1.6 - 0.8;
  o.connect(f); f.connect(g); g.connect(pan); pan.connect(master);
  const calls = 2 + Math.floor(Math.random() * 3);
  for (let k = 0; k < calls; k++) {
    const s = t + k * 0.32; o.frequency.setValueAtTime(1500, s); o.frequency.exponentialRampToValueAtTime(820, s + 0.26);
    g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(level, s + 0.03); g.gain.linearRampToValueAtTime(0, s + 0.27);
  }
  o.start(t); o.stop(t + calls * 0.32 + 0.1); o.onended = () => pan.disconnect();
}
/** Thunder: a low rumble with a crack, after the flash by the distance's delay. */
function thunder(e) {
  if (!ctx || ctx.state !== 'running') return;
  const when = ctx.currentTime + Math.max(0, (e.at - performance.now()) / 1000) + e.delay, loud = Math.max(0.15, e.loud || 0.5);
  const src = ctx.createBufferSource(); src.buffer = noise('brown');
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(260, when); lp.frequency.exponentialRampToValueAtTime(70, when + 3.5);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(0.9 * loud, when + 0.15); g.gain.exponentialRampToValueAtTime(0.001, when + 4.5);
  src.connect(lp); lp.connect(g); g.connect(master); src.start(when); src.stop(when + 4.6);
}
