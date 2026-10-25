// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The arcade's game core (docs/features/arcade.md), shared by the game box in the browser (client/arcade/kit.js) and the
// server (shared/arcade.js verify): a built-in game is a SIM that steps 60 times a second from a seed and the buttons held
// at each step, and nothing else. The browser records what was held at every step; the server plays the same steps
// again and works the score out itself, so a score on the board is one that was really played.
//
// Determinism rules for a sim (the browser and the server must step to the very same state):
//   - + − × ÷ and Math.sqrt/floor/round/abs/min/max/imul only (every engine rounds these the same, whole numbers or
//     not); never Math.sin/cos/atan2/pow/exp/random (their last bits differ between browsers): angles come from
//     SIN/COS below, dice from roll() below
//   - no clocks, no DOM, no async; the state is plain data
//   - events for the screen and the speaker go in state.ev (cleared by the kit each step) and never change the play
// This file is self-contained on purpose: the sealed game box may load only /shared/arcade/ and /arcade/.

export const TICK_HZ = 60;
/** The buttons of the standard controller, one bit each (what a sim reads; START and pausing never reach a sim). */
export const BTN = Object.freeze({ U: 1, D: 2, L: 4, R: 8, A: 16, B: 32 });
export const BTN_MASK = 63;
/** Most steps a run may have (3 hours): a longer report is refused before it is played. */
export const MAX_TICKS = 3 * 3600 * TICK_HZ;

// ------------------------------------------------------------------------------------------- dice
/** A seeded random number generator (sfc32): rng() → an integer 0 … 2^32−1; the same seed, the same numbers. */
export function makeRng(seed) {
  let a = seed >>> 0, b = (seed ^ 0x9e3779b9) >>> 0, c = (seed ^ 0x85ebca6b) >>> 0, d = (seed ^ 0xc2b2ae35) >>> 0;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
    const r = (t + d) | 0; c = (c + r) | 0;
    return r >>> 0;
  };
  for (let k = 0; k < 12; k++) next();
  return next;
}
/** The dice of a state: an integer 0 … n−1 (the generator's own state lives in s.rs, plain numbers, so it is copied with s). */
export function roll(s, n) {
  let [a, b, c, d] = s.rs;
  const t = (a + b) | 0;
  a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
  const r = (t + d) | 0; c = (c + r) | 0;
  s.rs[0] = a; s.rs[1] = b; s.rs[2] = c; s.rs[3] = d;
  return Math.floor(((r >>> 0) / 4294967296) * n);
}
/** The four numbers a state's dice start from. */
export function rngState(seed) {
  const r = makeRng(seed);
  return [r() | 0, r() | 0, r() | 0, r() | 0];
}
/** Shuffles arr in place with the state's dice. */
export function shuffle(s, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = roll(s, i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// ------------------------------------------------------------------------------------------- angles
/** Angles in 1024ths of a turn; SIN[a & 1023] and COS[a & 1023] in 1/4096ths, the same in every browser (a table made
 *  with + − × ÷ only, which every engine rounds alike, never Math.sin). */
export const ANG = 1024, FX = 4096;
export const SIN = new Int32Array(ANG), COS = new Int32Array(ANG);
(() => {
  // a quarter turn by its Taylor series: sin(x) for x in [0, π/2] with x = k·(π/2)/256, mirrored to the full turn
  const PI2 = 1.5707963267948966;
  for (let k = 0; k <= 256; k++) {
    const x = (k / 256) * PI2, x2 = x * x;
    // sin x = x − x³/3! + x⁵/5! − … (terms to x¹⁵: well under 1/4096 off)
    let term = x, sum = x;
    for (let n = 1; n <= 7; n++) { term = (-term * x2) / ((2 * n) * (2 * n + 1)); sum += term; }
    const v = Math.round(sum * FX);
    SIN[k] = v; SIN[512 - k] = v; SIN[(512 + k) & 1023] = -v; SIN[(1024 - k) & 1023] = -v;
  }
  for (let k = 0; k < ANG; k++) COS[k] = SIN[(k + 256) & 1023];
})();

// ------------------------------------------------------------------------------------------- the input log
// What was held at each step, as runs: [value, steps] pairs, each number a varint (7 bits a byte), the bytes in base64.
// A value is the buttons (bits 0–5) and, for a game that reads the pointer, its x (bits 8–15), y (bits 16–23) and
// whether it is down (bit 24): px/py are 0 … 255 across the game's screen.
export const inputValue = (b, px = 0, py = 0, pd = 0) => ((b & BTN_MASK) | ((px & 255) << 8) | ((py & 255) << 16) | ((pd ? 1 : 0) << 24)) >>> 0;
export const inputBits = v => ({ b: v & BTN_MASK, px: (v >>> 8) & 255, py: (v >>> 16) & 255, pd: (v >>> 24) & 1 });

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = (() => { const m = new Int16Array(128).fill(-1); for (let i = 0; i < 64; i++) m[B64.charCodeAt(i)] = i; return m; })();
function toB64(bytes, n) {
  let out = '';
  for (let i = 0; i < n; i += 3) {
    const a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, c = i + 2 < n ? bytes[i + 2] : 0, v = (a << 16) | (b << 8) | c;
    out += B64[(v >>> 18) & 63] + B64[(v >>> 12) & 63] + (i + 1 < n ? B64[(v >>> 6) & 63] : '') + (i + 2 < n ? B64[v & 63] : '');
  }
  return out;
}
function fromB64(s) {
  const n = s.length, out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const q = [0, 1, 2, 3].map(k => (i + k < n ? B64I[s.charCodeAt(i + k) & 127] : 0));
    if (q.some(x => x < 0)) throw new Error('bad log');
    const v = (q[0] << 18) | (q[1] << 12) | (q[2] << 6) | q[3];
    out[o++] = (v >>> 16) & 255;
    if (i + 2 < n) out[o++] = (v >>> 8) & 255;
    if (i + 3 < n) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}

/** Records the input of every step: push(value) each step, then encode() → the log. */
export class InputLog {
  constructor() { this.bytes = new Uint8Array(4096); this.n = 0; this.cur = -1; this.run = 0; this.ticks = 0; }
  push(v) {
    this.ticks++;
    if (v === this.cur) { this.run++; return; }
    if (this.run) this.flush();
    this.cur = v; this.run = 1;
  }
  varint(x) {
    if (this.n + 6 > this.bytes.length) { const b = new Uint8Array(this.bytes.length * 2); b.set(this.bytes); this.bytes = b; }
    x = x >>> 0;
    while (x >= 128) { this.bytes[this.n++] = (x & 127) | 128; x >>>= 7; }
    this.bytes[this.n++] = x;
  }
  flush() { this.varint(this.cur); this.varint(this.run); this.run = 0; }
  encode() {
    const keep = { n: this.n, run: this.run };
    if (this.run) this.flush();
    const s = toB64(this.bytes, this.n);
    this.n = keep.n; this.run = keep.run;
    return s;
  }
}
/** A log back to runs: [[value, steps], …] (throws on a bad one). */
export function decodeLog(s, maxTicks = MAX_TICKS) {
  if (typeof s !== 'string' || s.length > 700000 || /[^A-Za-z0-9_-]/.test(s)) throw new Error('bad log');
  const b = fromB64(s), runs = [];
  let i = 0, total = 0;
  const vi = () => {
    let x = 0, sh = 0, c;
    do { if (i >= b.length || sh > 28) throw new Error('bad log'); c = b[i++]; x += (c & 127) * 2 ** sh; sh += 7; } while (c & 128);
    return x;
  };
  while (i < b.length) {
    const v = vi(), n = vi();
    if (n < 1) throw new Error('bad log');
    total += n;
    if (total > maxTicks) throw new Error('too long');
    runs.push([v >>> 0, n]);
  }
  return { runs, ticks: total };
}

// ------------------------------------------------------------------------------------------- playing it again
/**
 * Plays a sim from its seed through a log: → { state, ticks, over }. The sim stops at the step it ends on (later steps
 * in the log do not count). sim: { init(seed) → state, step(state, input), over(state), score(state) }.
 */
export function replay(sim, seed, log, maxTicks = MAX_TICKS) {
  const { runs } = typeof log === 'string' ? decodeLog(log, maxTicks) : { runs: log };
  const s = sim.init(seed >>> 0);
  let t = 0;
  for (const [v, n] of runs) {
    const inp = inputBits(v);
    for (let k = 0; k < n; k++) {
      if (sim.over(s)) return { state: s, ticks: t, over: true };
      s.ev.length = 0;
      sim.step(s, inp);
      t++;
    }
  }
  return { state: s, ticks: t, over: sim.over(s) };
}

/** A fresh state's common part: the tick, the dice, the events. */
export const baseState = seed => ({ t: 0, rs: rngState(seed), ev: [] });
