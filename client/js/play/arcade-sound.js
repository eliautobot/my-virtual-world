// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's sounds (docs/features/arcade.md): little synthesised chip-tune effects and a racer's engine, no sound
// files. A game in the sealed box names an effect ('laser', 'clear' with how many rows…) and the cabinet plays it here, at Settings → Sound →
// "Aircraft and games" (audio/mixer.js), so the top bar's mute silences it like everything else.
import { bus } from '../core/state.js';
import { level } from '../audio/mixer.js';

let ac = null, out = null, noiseBuf = null;
const NOTE = n => 440 * 2 ** ((n - 69) / 12);   // a MIDI note's frequency

function ensure() {
  if (!ac) {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    out = ac.createGain(); out.connect(ac.destination);
    const n = ac.sampleRate * 1.0, b = ac.createBuffer(1, n, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    noiseBuf = b;
    setVol();
    bus.on('sound', setVol);
  }
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}
function setVol() { if (out) out.gain.value = 0.55 * level('aircraft'); }
/** Unlocks the sound on a tap or click (phones need one before a page may play). */
export function unlockSound() { ensure(); }

function tone(f0, dur, { type = 'square', vol = 0.1, f1 = null, at = 0, attack = 0.004 } = {}) {
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, { vol = 0.2, freq = 1200, at = 0, type = 'lowpass', f1 = null } = {}) {
  const t = ac.currentTime + at, s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; fl.type = type; fl.frequency.setValueAtTime(freq, t);
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl); fl.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
}
const arp = (notes, step, o = {}) => notes.forEach((n, i) => tone(NOTE(n), step * 1.4, { ...o, at: i * step }));

const FX = {
  // ---- the arcade's machines (shared/arcade/catalog.js machine games)
  molepop: () => tone(320, 0.07, { type: 'triangle', vol: 0.07, f1: 640 }),
  whack: n => { noise(0.07, { vol: 0.2, freq: 2600, f1: 600 }); tone(170 + 14 * Math.min(20, n || 0), 0.09, { vol: 0.12, f1: 85 }); },
  buzzer: () => { tone(130, 0.75, { vol: 0.11 }); tone(98, 0.75, { vol: 0.07, type: 'sawtooth' }); },
  skeeroll: p => noise(0.7, { vol: 0.1, freq: 260 + (p || 0) * 380, f1: 140 }),
  skeeland: () => { tone(230, 0.09, { type: 'triangle', vol: 0.14, f1: 150 }); noise(0.06, { vol: 0.1, freq: 900 }); },
  hoopshot: () => noise(0.24, { vol: 0.07, freq: 600, f1: 2600, type: 'bandpass' }),
  rim: () => { tone(830, 0.14, { vol: 0.06, f1: 770 }); tone(1240, 0.1, { type: 'triangle', vol: 0.05 }); },
  swish: () => noise(0.2, { vol: 0.11, freq: 3800, f1: 6500, type: 'highpass' }),
  punchhit: p => { const k = Math.max(0.2, Math.min(1, p || 0.5)); noise(0.18 + 0.2 * k, { vol: 0.18 + 0.2 * k, freq: 900, f1: 120 }); tone(110 - 30 * k, 0.25 + 0.2 * k, { type: 'sine', vol: 0.2 + 0.15 * k, f1: 40 }); },
  puckhit: v => { const k = Math.max(0.15, Math.min(1, (v || 0.02) / 0.08)); noise(0.05, { vol: 0.12 + 0.2 * k, freq: 3200, f1: 1500, type: 'bandpass' }); tone(900 + 500 * k, 0.04, { type: 'triangle', vol: 0.05 + 0.08 * k, f1: 600 }); },
  goalhorn: () => { tone(220, 0.55, { type: 'sawtooth', vol: 0.08 }); tone(277, 0.55, { type: 'sawtooth', vol: 0.06 }); noise(0.35, { vol: 0.12, freq: 1800, f1: 300 }); },
  footkick: v => { const k = Math.max(0.3, Math.min(1, (v || 0.05) / 0.06)); tone(260 - 60 * k, 0.07, { type: 'sine', vol: 0.18 * k, f1: 120 }); noise(0.05, { vol: 0.1 * k, freq: 1400, f1: 500 }); },
  flipper: () => { noise(0.05, { vol: 0.16, freq: 700, f1: 200 }); tone(95, 0.07, { type: 'square', vol: 0.06, f1: 60 }); },
  popbumper: i => { tone(520 + 140 * (i || 0), 0.09, { type: 'square', vol: 0.07, f1: 1100 }); noise(0.06, { vol: 0.14, freq: 2400, f1: 800 }); },
  sling: () => { noise(0.04, { vol: 0.14, freq: 2000, f1: 600 }); tone(330, 0.05, { type: 'triangle', vol: 0.06, f1: 200 }); },
  droptarget: () => { noise(0.05, { vol: 0.14, freq: 1200, f1: 400 }); tone(180, 0.08, { type: 'square', vol: 0.05, f1: 90 }); },
  rollover: j => { tone(880 + 220 * (j || 0), 0.12, { type: 'sine', vol: 0.08 }); tone(1320 + 220 * (j || 0), 0.1, { type: 'sine', vol: 0.05, at: 0.06 }); },
  plunger: p => { const k = Math.max(0.2, Math.min(1, p || 0.5)); noise(0.12, { vol: 0.1 + 0.1 * k, freq: 900, f1: 2400 }); tone(140, 0.1, { type: 'triangle', vol: 0.08, f1: 300 }); },
  kick: () => { tone(150, 0.16, { type: 'sine', vol: 0.32, f1: 42 }); noise(0.02, { vol: 0.08, freq: 2000 }); },
  snare: () => { noise(0.16, { vol: 0.16, freq: 3000, f1: 1200, type: 'bandpass' }); tone(220, 0.08, { type: 'triangle', vol: 0.07, f1: 160 }); },
  hat: () => { noise(0.04, { vol: 0.05, freq: 8000, type: 'highpass' }); },
  bass: f => { tone(f || 110, 0.26, { type: 'sawtooth', vol: 0.07, f1: (f || 110) * 0.98 }); tone((f || 110) / 2, 0.26, { type: 'sine', vol: 0.12 }); },
  stab: f => { for (const k of [1, 1.2, 1.5]) tone((f || 220) * k, 0.22, { type: 'square', vol: 0.025 }); },
  clawmotor: () => { tone(180, 0.7, { type: 'sawtooth', vol: 0.025, f1: 140 }); noise(0.7, { vol: 0.03, freq: 500, f1: 300 }); },
  bullbuck: lv => { const k = Math.min(1, 0.4 + (lv || 0) * 0.12); noise(0.16, { vol: 0.12 * k, freq: 700, f1: 160 }); tone(70, 0.22, { type: 'square', vol: 0.06 * k, f1: 45 }); },
  tick: () => tone(660, 0.025, { vol: 0.05 }),
  turn: () => tone(880, 0.04, { vol: 0.06, f1: 1100 }),
  bump: () => tone(130, 0.05, { vol: 0.06 }),
  land: () => tone(220, 0.05, { type: 'triangle', vol: 0.1 }),
  lock: () => tone(200, 0.07, { vol: 0.09, f1: 120 }),
  drop: () => { noise(0.12, { vol: 0.22, freq: 900 }); tone(130, 0.12, { type: 'triangle', vol: 0.2, f1: 55 }); },
  clear: n => { arp([72, 76, 79, 84, 88, 91].slice(0, Math.max(2, (n || 1) + 1)), 0.055, { vol: 0.09 }); if (n >= 5) arp([96, 100, 103, 108], 0.04, { vol: 0.05, type: 'triangle' }); },
  level: () => arp([67, 71, 74, 79], 0.08, { type: 'triangle', vol: 0.14 }),
  fanfare: () => arp([72, 72, 76, 79, 84, 79, 84], 0.09, { vol: 0.09 }),
  over: () => { tone(440, 0.9, { vol: 0.1, f1: 70 }); tone(330, 0.9, { vol: 0.06, f1: 50, type: 'triangle', at: 0.1 }); },
  laser: () => tone(1300, 0.12, { vol: 0.06, f1: 280 }),
  boom: () => noise(0.22, { vol: 0.16, freq: 1800, f1: 300 }),
  bigboom: () => { noise(0.55, { vol: 0.3, freq: 1200, f1: 120 }); tone(90, 0.5, { type: 'sine', vol: 0.25, f1: 35 }); },
  die: () => { noise(0.9, { vol: 0.32, freq: 1500, f1: 80 }); tone(300, 0.8, { vol: 0.08, f1: 40 }); },
  march: n => tone(NOTE([45, 43, 47, 43][n & 3]), 0.09, { vol: 0.13, type: 'square' }),
  ufo: () => { for (let i = 0; i < 6; i++) tone(i & 1 ? 900 : 640, 0.08, { type: 'sine', vol: 0.05, at: i * 0.07 }); },
  clash: () => tone(900, 0.05, { vol: 0.05, f1: 500 }),
  chip: () => noise(0.04, { vol: 0.08, freq: 3000, type: 'highpass' }),
  coin: () => { tone(988, 0.08, { vol: 0.08 }); tone(1319, 0.25, { vol: 0.08, at: 0.08 }); },
  eat: () => { tone(880, 0.06, { vol: 0.08, f1: 1320 }); tone(1320, 0.05, { vol: 0.05, at: 0.05 }); },
  bonus: () => arp([84, 88, 91, 96], 0.045, { vol: 0.08 }),
  pillar: () => tone(110, 0.25, { type: 'triangle', vol: 0.12, f1: 70 }),
  paddle: () => tone(330, 0.05, { type: 'triangle', vol: 0.14 }),
  wall: () => tone(220, 0.03, { type: 'triangle', vol: 0.07 }),
  brick: r => tone(NOTE(84 - Math.min(7, r || 0) * 2), 0.06, { vol: 0.08 }),
  crack: () => tone(600, 0.05, { vol: 0.07, f1: 420 }),
  steel: () => { tone(1500, 0.06, { type: 'triangle', vol: 0.06 }); tone(2200, 0.05, { type: 'sine', vol: 0.04 }); },
  power: () => arp([67, 74, 79, 86], 0.05, { vol: 0.08, type: 'triangle' }),
  lost: () => tone(300, 0.5, { vol: 0.1, f1: 60 }),
  thrust: () => noise(0.07, { vol: 0.05, freq: 400 }),
  warp: () => { tone(200, 0.3, { type: 'sine', vol: 0.1, f1: 1600 }); noise(0.25, { vol: 0.05, freq: 3000, type: 'highpass' }); },
  rock: size => noise(size >= 3 ? 0.45 : size === 2 ? 0.3 : 0.18, { vol: size >= 3 ? 0.3 : 0.2, freq: size >= 3 ? 700 : size === 2 ? 1200 : 2200, f1: 150 }),
  sfire: () => tone(500, 0.1, { vol: 0.05, f1: 900, type: 'sawtooth' }),
  hop: () => tone(520, 0.05, { vol: 0.06, f1: 780, type: 'square' }),
  splash: () => noise(0.4, { vol: 0.2, freq: 2400, f1: 300 }),
  squish: () => { noise(0.15, { vol: 0.22, freq: 600 }); tone(160, 0.2, { vol: 0.1, f1: 60 }); },
  home: () => arp([72, 79, 84], 0.07, { vol: 0.1 }),
  flap: () => tone(420, 0.07, { vol: 0.07, f1: 760, type: 'triangle' }),
  point: () => { tone(988, 0.05, { vol: 0.06 }); tone(1319, 0.08, { vol: 0.05, at: 0.05 }); },
  orb: () => arp([88, 91, 96], 0.035, { vol: 0.06, type: 'triangle' }),
  thump: () => { noise(0.18, { vol: 0.22, freq: 500 }); tone(140, 0.25, { vol: 0.14, f1: 45 }); },
  spark: n => tone(n & 1 ? 760 : 640, 0.025, { vol: 0.035, type: 'square' }),
  core: () => { tone(220, 0.35, { vol: 0.1, f1: 880, type: 'sawtooth' }); },
  catch: n => arp([72 + (n || 0) * 3, 79 + (n || 0) * 3, 84 + (n || 0) * 3], 0.05, { vol: 0.09 }),
  chip: () => arp([79, 83, 86, 91], 0.04, { vol: 0.07 }),
  launch: () => noise(0.18, { vol: 0.08, freq: 1800, f1: 600, type: 'bandpass' }),
  burst: () => { noise(0.35, { vol: 0.16, freq: 900, f1: 200 }); },
  chain: n => tone(NOTE(76 + Math.min(12, (n || 1) * 2)), 0.09, { vol: 0.07, type: 'triangle' }),
  split: () => tone(1200, 0.12, { vol: 0.05, f1: 500, type: 'sawtooth' }),
  domeLost: () => { noise(0.8, { vol: 0.3, freq: 600, f1: 60 }); tone(110, 0.8, { vol: 0.12, f1: 35 }); },
  click: () => tone(1800, 0.02, { vol: 0.04 }),
  tally: () => arp([72, 76, 79, 84, 88], 0.07, { vol: 0.07 }),
  near: n => { tone(NOTE(74 + Math.min(14, (n || 1) * 2)), 0.08, { vol: 0.06, type: 'square' }); noise(0.38, { vol: 0.22, freq: 2200, f1: 380, type: 'bandpass' }); },   // (the chime, and the car whooshing by)
  honk: () => { tone(470, 0.42, { type: 'square', vol: 0.05, f1: 380 }); tone(590, 0.42, { type: 'square', vol: 0.04, f1: 478 }); },   // (the car passed close leans on its horn, dropping as it goes by)
  crash: () => { noise(0.9, { vol: 0.35, freq: 1400, f1: 90 }); tone(90, 0.6, { vol: 0.2, f1: 30 }); },
  scrape: () => noise(0.12, { vol: 0.1, freq: 3500, type: 'highpass' }),
  slam: () => { noise(0.3, { vol: 0.3, freq: 900, f1: 200 }); tone(160, 0.22, { vol: 0.14, f1: 60 }); noise(0.25, { vol: 0.08, freq: 4200, type: 'highpass', at: 0.05 }); },
  horn: () => { tone(415, 0.26, { type: 'square', vol: 0.045 }); tone(523, 0.26, { type: 'square', vol: 0.035 }); },   // (a rival about to swing at you)
  boostOn: () => { noise(0.5, { vol: 0.2, freq: 500, f1: 3000, type: 'bandpass' }); tone(120, 0.25, { type: 'sine', vol: 0.18, f1: 60 }); },
  checkpoint: () => arp([79, 84, 88, 91, 96], 0.06, { vol: 0.09 }),
  go: () => arp([72, 72, 84], 0.18, { vol: 0.1 }),
  select: () => tone(740, 0.03, { vol: 0.05 }),
  start: () => arp([60, 64, 67, 72], 0.05, { vol: 0.08 }),
  back: () => tone(520, 0.06, { vol: 0.05, f1: 300 }),
};
// The engine of a racing game, held while it drives: the motor (two detuned saws and a sub an octave down, through a
// filter that opens with the revs: rpm is where it is in its gear, so it climbs, drops at a shift and climbs again),
// the wind and the road (noise that grows with the speed), a turbo whistle and a rush of air while boosting, and the
// tyres squealing in a hard swerve. v = the speed 0 … 1 (below 0: it all fades out); o = { rpm, boost, skid }.
let eng = null;
const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
export function engine(v, o = {}) {
  if (!(v >= 0) || !level('aircraft')) {
    if (eng && ac) {
      const e = eng; eng = null;
      for (const g of [e.g, e.wg, e.tg, e.sg]) g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.08);
      setTimeout(() => { for (const n of e.src) try { n.stop(); } catch { /* stopped */ } }, 600);
    }
    return;
  }
  if (!ensure()) return;
  const t = ac.currentTime;
  if (!eng) {
    const osc = (type, to) => { const n = ac.createOscillator(); n.type = type; n.connect(to); n.start(); return n; };
    const loop = (to) => { const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true; n.connect(to); n.start(); return n; };
    const gain = (to, v0 = 0.0001) => { const g = ac.createGain(); g.gain.value = v0; g.connect(to); return g; };
    const filt = (type, f, q, to) => { const n = ac.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.connect(to); return n; };
    // the motor
    const g = gain(out), f = filt('lowpass', 500, 5, g), o1 = osc('sawtooth', f), o2 = osc('sawtooth', f), sub = gain(f, 0.55), o3 = osc('square', sub);
    // the wind and the road
    const wg = gain(out), wf = filt('bandpass', 600, 0.7, wg), w = loop(wf);
    // the turbo's whistle
    const tg = gain(out), t1 = osc('sine', tg);
    // the tyres
    const sg = gain(out), sf = filt('bandpass', 2600, 7, sg), sk = loop(sf);
    eng = { g, f, o1, o2, o3, wg, wf, tg, t1, sg, sf, src: [o1, o2, o3, w, t1, sk] };
  }
  const rpm = clamp01(o.rpm ?? v), boost = !!o.boost, skid = clamp01(o.skid);
  const hz = 52 + rpm * 150 + v * 40;   // (a higher gear: a little higher at the same revs)
  eng.o1.frequency.setTargetAtTime(hz, t, 0.04); eng.o2.frequency.setTargetAtTime(hz * 1.012, t, 0.04); eng.o3.frequency.setTargetAtTime(hz * 0.5, t, 0.04);
  eng.f.frequency.setTargetAtTime(420 + rpm * 2400 + (boost ? 900 : 0), t, 0.05);
  eng.g.gain.setTargetAtTime(0.06 + rpm * 0.05 + v * 0.03 + (boost ? 0.05 : 0), t, 0.06);
  eng.wf.frequency.setTargetAtTime(380 + v * 1500 + (boost ? 700 : 0), t, 0.1);
  eng.wg.gain.setTargetAtTime(0.0001 + v * v * 0.16 + (boost ? 0.1 : 0), t, 0.12);
  eng.t1.frequency.setTargetAtTime(1700 + v * 1500, t, 0.15);
  eng.tg.gain.setTargetAtTime(boost ? 0.018 : 0.0001, t, boost ? 0.15 : 0.08);
  eng.sg.gain.setTargetAtTime(0.0001 + skid * 0.06, t, 0.05);
}
/** Plays a named effect (unknown names are quiet). */
export function sfx(name, p) {
  if (!level('aircraft') || !ensure() || !FX[name]) return;
  try { FX[name](p); } catch { /* a busy audio thread: skip one */ }
}
/** A short buzz on a phone that has one (Android; iPhones' browsers don't). */
export function buzz(ms) {
  if (ms > 0 && matchMedia('(pointer: coarse)').matches) try { navigator.vibrate?.(Math.min(250, ms)); } catch { /* not allowed */ }
}
