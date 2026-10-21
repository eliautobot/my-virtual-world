// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The water's surface where the boats float (docs/features/fishing.md §Boats: "the sea the boat feels is the sea you
// see"). On the sea, at medium and high quality, the ocean's own waves are asked for at the boats' hull points — the
// GPU probe in render/ocean-fft.js (up to 32 points a frame, the answers a frame or two later; damped in the shallows
// as the sea draws them); at low quality, the same four Gerstner waves render/water.js draws (render/water.js WAVES),
// worked out here. On a lake, a light chop by the wind. heights(key, pts) gives a caller's points' surface heights
// (absolute y) — from the last answer for that caller's slot, else worked out — and asks again for the next frame.
import { GU } from './scene.js';
import { bus } from '../core/state.js';

const MAX = 32;
let app = null, frameAt = -1, frames = 0;
const slots = new Map();                  // a caller → { base, n, seen (frame), since (frame it was first asked) }
const pts = Array.from({ length: MAX }, () => ({ x: 0, z: 0, k: 0 }));

export function init(a) { app = a; bus.on('frame', () => { frames++; }); }

/** The low-quality sea's four Gerstner waves (render/water.js gerstner): its height at p, by the wind and the wave size. */
export function gerstnerHeight(x, z, t, H, wx, wz) {
  const l = Math.hypot(wx, wz) || 1, dx = wx / l, dz = wz / l;
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const ang = (i - 1.5) * 0.38, c = Math.cos(ang), s = Math.sin(ang), Dx = dx * c - dz * s, Dz = dx * s + dz * c;
    const L = 64 / Math.pow(1.85, i), k = 2 * Math.PI / L, w = Math.sqrt(9.81 * k), A = H * 0.5 * Math.pow(0.62, i);
    y += A * Math.sin(k * (Dx * x + Dz * z) - w * t + i * 1.7);
  }
  return y;
}
/** A lake's chop: a few centimetres, more in a breeze. */
export function lakeChop(x, z, t, wind) {
  const A = 0.025 + 0.012 * Math.min(10, wind);
  return A * (Math.sin(0.55 * x + 1.7 * t) + 0.8 * Math.sin(0.62 * z - 1.4 * t + 1.1) + 0.5 * Math.sin(0.9 * (x + z) + 2.3 * t));
}
const sstep = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/**
 * The surface's height at a caller's points this frame: pts [{ x, z }] → Float32Array of absolute heights. key: who
 * asks (each caller keeps its own slots in the probe while it asks every frame, so the answers never mix). level: the
 * calm water's height there (the sea's or the lake's); lake: on a lake (a chop; no probe).
 */
export function heights(key, list, level, lake = false) {
  const t = GU.uTime.value, out = new Float32Array(list.length), W = GU.uWind.value, wind = W.w || 0;
  const T = app?.terrain, ocean = T?.sea, fft = ocean?.waves, H = ocean?.u?.uWaveH?.value ?? 0.3;
  const frame = frames;
  if (frame !== frameAt) { submit(fft, frameAt); frameAt = frame; }
  const shoal = (x, z) => { const g = T?.pointHeight ? T.pointHeight(x, z) : level - 20; return sstep(0.3, 3.5, level - g); };
  if (lake) { for (let i = 0; i < list.length; i++) out[i] = level + lakeChop(list[i].x, list[i].z, t, wind); return out; }
  const s = fft ? slotFor(key, list.length, frame) : null;
  for (let i = 0; i < list.length; i++) {
    const k = shoal(list[i].x, list[i].z);
    if (s) { const P = pts[s.base + i]; P.x = list[i].x; P.z = list[i].z; P.k = k; }
    // the ocean's own waves once its answers for these slots have come (a few frames), else the low sea's shape
    out[i] = level + (s && frame - s.since > 3 && fft.probeCount > s.base + i ? fft.probeOut[(s.base + i) * 3] : gerstnerHeight(list[i].x, list[i].z, t, H * (fft ? 0.8 : 1), W.x, W.z) * k);
  }
  return out;
}
function slotFor(key, n, frame) {
  let s = slots.get(key);
  if (!s || s.n !== n) {
    let base = 0;
    for (const o of [...slots.values()].sort((a, b) => a.base - b.base)) { if (o === s) continue; if (base + n <= o.base) break; base = Math.max(base, o.base + o.n); }
    if (base + n > MAX) return null;
    s = { base, n, since: frame, seen: frame }; slots.set(key, s);
  }
  s.seen = frame;
  return s;
}
/** Once a frame: the slots still asked for go to the probe (the answers come in a frame or two); the rest are freed. */
function submit(fft, last) {
  for (const [k, s] of slots) if (s.seen < last) slots.delete(k);
  if (!fft || !slots.size) return;
  let n = 0; for (const s of slots.values()) n = Math.max(n, s.base + s.n);
  fft.probe(pts.slice(0, n));
}
/** The calm water under a point: { level, lake } (the sea's or a lake's), or null on land. */
export function waterUnder(x, z) {
  const w = app?.terrain?.ground?.water(x, z);
  return w ? { level: w.level, lake: w.kind !== 'sea' } : null;
}
