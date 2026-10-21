// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's sounds (docs/features/play-modules.md §Airport), synthesised with Web Audio like the ambience
// (audio/ambience.js): no recordings to licence or download. While flying: the engine - a propeller plane's buzzing
// piston and its prop beat, a small jet's roar and turbine whine, a helicopter's rotor "whop" and turbine - following the
// throttle (or the rotor's speed); the wind growing with the airspeed; the stall horn; a thump on touchdown. The ring game:
// a chime through each ring (brighter through the gate), a fanfare at the end by the stars, a low tone when time runs out;
// a crash. Other players' aircraft near the camera are heard too, quieter with distance (the nearest one: one voice).
// The volume is Aircraft and games (Settings → Sound, audio/mixer.js); it is quiet while the page listens (audio:duck), and silent
// when the tab is hidden. Nothing plays until the first click or key (browser rules), and nothing runs while nobody flies.
import { bus } from '../core/state.js';
import { level } from './mixer.js';
import { AIRCRAFT } from '/shared/aircraft-specs.js';

let app = null, ctx = null, master = null, meter = null, meterBuf = null, white = null, own = null, other = null, wind = null, stallV = null, ducks = new Set(), wasGround = true, lastType = null;

export function init(a) {
  app = a;
  const start = () => { if (!ctx) begin(); else if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  window.addEventListener('pointerdown', start, { passive: true });
  window.addEventListener('keydown', start);
  bus.on('sound', () => setVolume());
  bus.on('audio:duck', ({ who, on } = {}) => { if (!who) return; if (on) ducks.add(who); else ducks.delete(who); setVolume(); });
  document.addEventListener('visibilitychange', () => { if (ctx) (document.hidden ? ctx.suspend() : ctx.resume()).catch(() => {}); });
  bus.on('flight', ev => { if (!ctx) return; if (ev.on) { voiceFor(ev.type); wasGround = true; } else { quiet(own?.g); quiet(wind?.g); quiet(stallV?.g); } });   // (quiet(own) threw: the engine and the wind played on after getting out)
  bus.on('flight-crash', () => crash());
  bus.on('ring:pass', e => chime(e?.gate ? [784, 1175, 1568] : [1047, 1568], e?.gate ? 0.14 : 0.1));
  bus.on('ring:finish', e => fanfare(e?.stars || 0));
  bus.on('ring:fail', () => tones([392, 330, 262], 0.18, 'triangle', 0.16));
  bus.on('frame', update);
  app.flightSound = {
    get on() { return !!ctx; }, get state() { return ctx?.state || 'none'; },
    /** How loud the aircraft's sounds are right now (RMS of the output, 0..1). */
    level() { if (!meter) return 0; meter.getFloatTimeDomainData(meterBuf); let s = 0; for (const v of meterBuf) s += v * v; return Math.sqrt(s / meterBuf.length); },
  };
}
function begin() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  meter = ctx.createAnalyser(); meter.fftSize = 1024; meterBuf = new Float32Array(meter.fftSize); master.connect(meter);   // how loud it is (app.flightSound.level)
  white = noise();
  setVolume();
  if (app.flight?.active) voiceFor(app.flight.type);
}
function setVolume() { if (master) master.gain.setTargetAtTime(level('aircraft') * (ducks.size ? 0.08 : 1), ctx.currentTime, 0.3); }
function noise() {
  const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
const at = (p, v, k = 0.08) => p.setTargetAtTime(v, ctx.currentTime, k);
function quiet(g) { if (g && ctx) at(g.gain || g, 0, 0.25); }

// ------------------------------------------------------------------ voices
/** An engine voice of a kind: { g (its gain), set(level 0..1, speed m/s) }. */
function engine(kind) {
  const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
  if (kind === 'prop') {   // a piston's buzz (a sawtooth and its octave through a low-pass) with the propeller's beat
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), beat = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; lp.type = 'lowpass'; lp.Q.value = 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(beat); beat.connect(out);
    lfo.connect(depth); depth.connect(beat.gain); beat.gain.value = 0.7; depth.gain.value = 0.3;
    for (const o of [o1, o2, lfo]) o.start();
    return { g: out, set(l) { const f = 32 + 78 * l; at(o1.frequency, f); at(o2.frequency, f * 2.01); at(lp.frequency, 400 + 1600 * l); at(lfo.frequency, f / 2); at(out.gain, 0.05 + 0.2 * l); } };
  }
  if (kind === 'jet') {    // a roar (noise through a band that rises with the spool) and the turbine's whine
    const src = buf(), bp = ctx.createBiquadFilter(), whine = ctx.createOscillator(), wg = ctx.createGain(), roar = ctx.createGain();
    bp.type = 'bandpass'; bp.Q.value = 0.7; src.connect(bp); bp.connect(roar); roar.connect(out);
    whine.type = 'sine'; whine.connect(wg); wg.connect(out); whine.start();
    return { g: out, set(l) { at(bp.frequency, 500 + 2200 * l); at(roar.gain, 0.15 + 0.6 * l); at(whine.frequency, 1800 + 3200 * l); at(wg.gain, 0.012 + 0.03 * l); at(out.gain, 0.06 + 0.22 * l); } };
  }
  // the helicopter: the rotor's whop (noise chopped by the blade-pass rate) and the turbine's whine
  const src = buf(), lp = ctx.createBiquadFilter(), chop = ctx.createGain(), lfo = ctx.createOscillator(), depth = ctx.createGain(), whine = ctx.createOscillator(), wg = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 520; src.connect(lp); lp.connect(chop); chop.connect(out);
  lfo.type = 'sawtooth'; lfo.connect(depth); depth.connect(chop.gain); chop.gain.value = 0.55; depth.gain.value = 0.5; lfo.start();
  whine.type = 'triangle'; whine.connect(wg); wg.connect(out); whine.start();
  return { g: out, set(l) { at(lfo.frequency, 2 + 13 * l, 0.3); at(whine.frequency, 900 + 1700 * l, 0.3); at(wg.gain, 0.01 + 0.025 * l); at(out.gain, 0.04 + 0.32 * l); } };
}
function buf() { const s = ctx.createBufferSource(); s.buffer = white; s.loop = true; s.start(ctx.currentTime + Math.random()); return s; }
function voiceFor(type) {
  if (!ctx) return;
  if (own && lastType === type) return;
  if (own) { quiet(own.g); const old = own.g; setTimeout(() => old.disconnect(), 1500); }
  own = engine(AIRCRAFT[type]?.kind === 'heli' ? 'heli' : type === 'jet' ? 'jet' : 'prop'); lastType = type;
  if (!wind) {
    const src = buf(), bp = ctx.createBiquadFilter(), g = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.5; g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(master); wind = { g, bp };
  }
  if (!stallV) {
    const o = ctx.createOscillator(), g = ctx.createGain(), am = ctx.createGain(), lfo = ctx.createOscillator(), d = ctx.createGain();
    o.type = 'square'; o.frequency.value = 2650; lfo.type = 'square'; lfo.frequency.value = 5; lfo.connect(d); d.gain.value = 0.5; d.connect(am.gain); am.gain.value = 0.5;
    o.connect(am); am.connect(g); g.gain.value = 0; g.connect(master); o.start(); lfo.start(); stallV = { g };
  }
}
let otherType = null, updAt = 0;
function update() {
  if (!ctx || ctx.state !== 'running') return;
  const nowMs = performance.now(); if (nowMs - updAt < 50) return; updAt = nowMs;   // twenty times a second is plenty (and light on a phone)
  const F = app.flight;
  if (F?.active) {
    const s = F.state(), i = F.instruments(); if (!s || !i) return;
    if (!own) voiceFor(F.type);
    const S = AIRCRAFT[F.type], level = S.kind === 'heli' ? s.rpm : Math.max(0.08, s.engine);
    if (!s.crashed) own.set(level, i.speed);
    at(wind.g.gain, Math.min(0.5, (i.speed / S.max) ** 2 * 0.45), 0.2); at(wind.bp.frequency, 400 + i.speed * 12, 0.2);
    at(stallV.g.gain, i.stall ? 0.05 : 0, 0.03);
    if (s.onGround && !wasGround && !s.crashed) thump(Math.min(1, Math.abs(s.v.y) / 4 + 0.3));
    wasGround = s.onGround;
  }
  // the nearest other aircraft in the air near the camera: heard, quieter with distance
  const near = app.flight?.nearest?.();
  if (near && near.d < 600) {
    const kind = AIRCRAFT[near.type]?.kind === 'heli' ? 'heli' : near.type === 'jet' ? 'jet' : 'prop';
    if (!other || otherType !== kind) { if (other) { quiet(other.g); const old = other.g; setTimeout(() => old.disconnect(), 1500); } other = engine(kind); otherType = kind; }
    other.set(Math.max(0.3, near.th || 0.6), 0);
    at(other.g.gain, Math.min(0.25, 18 / Math.max(20, near.d)) * (near.flying ? 1 : 0.4), 0.3);
  } else if (other) at(other.g.gain, 0, 0.5);
}

// ------------------------------------------------------------------ one-shots
function tones(freqs, step, type = 'sine', vol = 0.12) {
  if (!ctx) return;
  freqs.forEach((f, k) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + k * step;
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t + step * 2.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + step * 2.4);
  });
}
const chime = (freqs, step) => tones(freqs, step, 'sine', 0.14);
function fanfare(stars) { tones(stars >= 3 ? [523, 659, 784, 1047, 1319] : stars === 2 ? [523, 659, 784, 1047] : stars === 1 ? [523, 659, 784] : [440, 523], 0.11, 'triangle', 0.16); }
function thump(k) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.25);
  g.gain.setValueAtTime(0.3 * k, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.32);
  const n = ctx.createBufferSource(), ng = ctx.createGain(), hp = ctx.createBiquadFilter(); n.buffer = white; hp.type = 'highpass'; hp.frequency.value = 1800;   // the tyres' chirp
  ng.gain.setValueAtTime(0.05 * k, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18); n.connect(hp); hp.connect(ng); ng.connect(master); n.start(t); n.stop(t + 0.2);
}
function crash() {
  if (!ctx) return;
  quiet(own?.g); quiet(wind?.g); quiet(stallV?.g);
  const t = ctx.currentTime, n = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
  n.buffer = white; lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(120, t + 1.4);
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.6); n.connect(lp); lp.connect(g); g.connect(master); n.start(t); n.stop(t + 1.7);
  thump(1);
}
