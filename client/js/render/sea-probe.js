// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The water's surface where the boats float (docs/features/fishing.md §Boats: "the sea the boat feels is the sea you
// see"). On the sea, at medium and high quality, the ocean's own waves are asked for at the boats' hull points — the
// GPU probe in render/ocean-fft.js (up to 96 points a frame, the answers a frame or two later; damped in the shallows
// as the sea draws them); at low quality, the same four Gerstner waves render/water.js draws (render/water.js WAVES),
// worked out here. On a lake, a light chop by the wind. heights(key, pts) gives a caller's points' surface heights
// (absolute y) — from the last answer for that caller's slot, else worked out — and asks again for the next frame.
import { GU } from './scene.js';
import { bus } from '../core/state.js';
import { PROBES } from './ocean-fft.js';
import { calmAt, CALM_SWELL } from './water.js';

const MAX = PROBES;
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

// ---- the surf (2026-10-15 — the product owner: "the boats need to also react to the waves at shores"): the breakers the
// sea draws over the shallows (render/water.js SWASH_GLSL swSurf, sharp 0, as its mesh rises), here too, so a boat in
// them — in the marina's basin too — rides them. (Each wave's own size: its average — the GPU's sine of a wave's number
// isn't the same as this one's.)
const SW_K = 3.4, SW_F = 0.2, fract = x => x - Math.floor(x);
const swHash = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);
function swNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz; fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const n = ix + iz * 57, a = swHash(n), b = swHash(n + 1), c = swHash(n + 57), d = swHash(n + 58);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}
const swWob = (x, z) => Math.sin(x * 0.013 + z * 0.009) * 0.35 + Math.sin(x * 0.029 - z * 0.021 + 1.7) * 0.12;
/** The surf at (x, z) over d m of water: { h (m about the sea's level), br (0 a swell … 1 a broken bore), crest (white
 *  water: its breaking crest and the bore's face, 0..1) } — or null outside it. surf: the day's (terrain.uSurf). */
export function surfAt(x, z, d, t, surf) {
  const H0 = 0.36 + 0.55 * surf, db = H0 * 1.3, reach = Math.max(5, H0 * 6.5);
  if (!(d > 0) || d >= reach) return null;
  const sho = 1 - sstep(db, reach, d), br = 1 - sstep(db * 0.7, db * 1.05, d);
  const k = 0.5 + 0.08 * Math.max(sho * sho, br);
  const ph = SW_K * Math.sqrt(d) + t * SW_F + swWob(x, z), c = fract(ph), n = Math.floor(ph + 1 - k);
  const amp = H0 * (0.75 + 0.5 * swNoise(x * 0.012 + n * 0.37, z * 0.012 + n * 0.11));
  let H = amp * (0.3 + 0.7 * sho) * (1 + 0.3 * sho);
  H = H + (Math.min(H, 0.6 * d + 0.08) - H) * br;
  H *= sstep(reach, reach * 0.6, d) * sstep(0, 0.06, d);
  const u = c < k ? 0.5 + 0.5 * Math.cos(Math.PI * c / k) : 0.5 - 0.5 * Math.cos(Math.PI * (c - k) / (1 - k));
  const crest = c < 0.5 ? 1 - sstep(0, 0.07, c) : sstep(0.88, 1, c), face = sstep(k + 0.15 * (1 - k), 0.97, c), big = sstep(0.12, 0.35, amp);
  return { h: H * (u - 0.32), br, crest: Math.max(crest * sstep(db * 1.3, db * 0.98, d) * 0.95, br * Math.max(face, 1 - sstep(0, 0.1, c))) * big, H };
}

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
  // the swell calming over the shallows as the sea draws it (render/water.js: the full sea's mesh over 0.3–6 m of water,
  // the low sea's over 0.3–3.5 m)
  const deep = fft ? 6 : 3.5;
  if (lake) { for (let i = 0; i < list.length; i++) out[i] = level + lakeChop(list[i].x, list[i].z, t, wind); return out; }
  const s = fft ? slotFor(key, list.length, frame) : null, surf = T?.uSurf?.value ?? 1, cam = app?.stage?.camera?.position;
  // (the depth as the sea is drawn with it — its own depth maps — not the ground's: where they differ, the marina's
  // dredged basin drawn as the beach it was, the surf the boats felt ran out of step with the one on the screen —
  // a wave came up, the boat went down, 2026-10-15)
  const depth = (x, z) => ocean?.depthAt?.(x, z, !fft) ?? (T?.pointHeight ? level - T.pointHeight(x, z) : 20);
  for (let i = 0; i < list.length; i++) {
    // (in a harbour — render/water.js setCalm — no surf, and the open sea's swell cut down, as it is drawn there)
    const x = list[i].x, z = list[i].z, d = depth(x, z), calm = calmAt(x, z), k = sstep(0.3, deep, d) * (1 - calm) + CALM_SWELL * calm;
    // the surf as the sea's mesh rises with it (render/water.js: near the camera, where its vertices are close enough)
    let sh = 0;
    const sf = d > 0 && d < 9 && calm < 1 ? surfAt(x, z, d, t, surf) : null;
    if (sf) {
      const vd = cam ? Math.hypot(x - cam.x, z - cam.z) : 0, near = 1 - sstep(700, 1500, vd);
      let geo = 1;
      if (fft) { const gx = depth(x + 2, z) - depth(x - 2, z), gz = depth(x, z + 2) - depth(x, z - 2), crestM = 2 * Math.sqrt(Math.max(d, 0.02)) / (SW_K * Math.max(Math.hypot(gx, gz) / 4, 1e-3)); geo = 1 - sstep(0.16, 0.28, Math.max(1.25, vd * 0.04) / crestM); }
      sh = sf.h * near * geo * (1 - calm);
    }
    if (s) { const P = pts[s.base + i]; P.x = x; P.z = z; P.k = k; }
    // the ocean's own waves once its answers for these slots have come (a few frames), else the low sea's shape
    out[i] = level + sh + (s && frame - s.since > 3 && fft.probeCount > s.base + i ? fft.probeOut[(s.base + i) * 3] : gerstnerHeight(x, z, t, H * (fft ? 0.8 : 1), W.x, W.z) * k);
  }
  return out;
}
/**
 * The surf's shove on a boat at (x, z) (m/s², toward the shore): a breaking crest or a bore running in carries it with
 * it; { x, z } or null where there is none.
 */
export function surfPush(x, z, level) {
  const T = app?.terrain, O = T?.sea, low = !O?.waves;
  if (!T?.pointHeight) return null;
  const depth = (px, pz) => O?.depthAt?.(px, pz, low) ?? level - T.pointHeight(px, pz);   // (as the sea is drawn)
  const calm = calmAt(x, z);
  if (calm >= 1) return null;   // (none in a harbour)
  const d = depth(x, z), sf = surfAt(x, z, d, GU.uTime.value, T.uSurf?.value ?? 1);
  if (!sf || sf.crest * (1 - calm) < 0.05) return null;
  const gx = depth(x + 3, z) - depth(x - 3, z), gz = depth(x, z + 3) - depth(x, z - 3), l = Math.hypot(gx, gz);   // (the depth falling: toward the shore)
  if (l < 1e-4) return null;
  const a = sf.crest * sf.H * (0.6 + 1.4 * sf.br) * 2.2 * (1 - calm);
  return { x: -gx / l * a, z: -gz / l * a };
}
/** How many frames old the sea's answers are (the GPU probe: asked one frame, drawn the next, read back a frame or two
 *  after); 0 where they are worked out at once (the low sea, a lake). */
export function probeFrames(lake = false) { return !lake && app?.terrain?.sea?.waves ? 3 : 0; }
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
