// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The shape of the lounge's island bars (Floor Themes' lounge, 2026-10-23: "a bigger nicer bar, something unique and
// extravagant and elegant and simple at the same time ... central bars that aren't only against a wall"): a racetrack
// (two straights joined by half circles; no straights makes it round) the counter, its stools and its bartenders follow.
// Shared so the catalog's seats (shared/catalog.js) sit exactly where the model (client/js/render/furniture-lounge.js)
// draws its stools. Item-local frame: +z the front, y up; u runs round from the back middle (0, −r) toward +x.
const P = Math.PI, H = P / 2;

/** How the loop is split: the back's two half straights, the right end, the front straight, the left end. */
function parts(hx) { const fs = hx > 0.01 ? 0.125 : 0; return { fs, fa: (1 - 4 * fs) / 2 }; }

/** The point at u (0…1 round the loop) of a racetrack with straights of half length hx and ends of radius r. */
export function trackAt(u, hx, r) {
  const { fs, fa } = parts(hx);
  u = ((u % 1) + 1) % 1;
  if (u < fs) return [u / fs * hx, -r];
  if (u < fs + fa) { const a = -H + (u - fs) / fa * P; return [hx + Math.cos(a) * r, Math.sin(a) * r]; }
  if (u < 3 * fs + fa) return [hx - (u - fs - fa) / (2 * fs) * 2 * hx, r];
  if (u < 3 * fs + 2 * fa) { const a = H + (u - 3 * fs - fa) / fa * P; return [-hx + Math.cos(a) * r, Math.sin(a) * r]; }
  return [-hx + (u - 3 * fs - 2 * fa) / fs * hx, -r];
}
/** The u either side of the back middle that leaves a gap of half width `half` metres (the bartenders' way in). */
export function gapU(hx, r, half) {
  const { fs } = parts(hx);
  if (fs > 0 && half <= hx) return half / hx * fs;
  return Math.asin(Math.min(1, half / r)) / (2 * P);
}
/** n points round the loop at radius r, from u0 to 1 − u0 (u0 = 0: closed, the last point not repeated). */
export function trackPath(hx, r, n, u0 = 0) {
  return Array.from({ length: n }, (_, i) => trackAt(u0 > 0 ? u0 + i / (n - 1) * (1 - 2 * u0) : i / n, hx, r));
}
/** Where a bar of this shape seats people: stools every ~0.8 m round the counter, the way in at the back left free;
 *  each { x, z, yaw } with the stool facing the counter (yaw: +z is 0, +x is π/2). */
export function barStools(hx, r) {
  const R = r + 0.55, u0 = gapU(hx, R, 0.75), len = 4 * hx + 2 * P * R, n = Math.max(4, Math.floor(len * (1 - 2 * u0) / 0.8));
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = u0 + (i + 0.5) / n * (1 - 2 * u0), [x, z] = trackAt(u, hx, R), [ix, iz] = trackAt(u, hx, r - 0.2);
    out.push({ x, z, yaw: Math.atan2(ix - x, iz - z) });
  }
  return out;
}
/** The bartenders' places in the well between the counter and the bottle tower, facing out. */
export function barStaff(hx, r) {
  const m = (r - 0.72 + 0.3) / 2;
  return hx > 0.6 ? [{ x: -hx * 0.55, z: m, yaw: 0 }, { x: hx * 0.55, z: -m, yaw: P }, { x: hx + 0.32, z: 0, yaw: H }] : [{ x: 0, z: m, yaw: 0 }, { x: 0, z: -m, yaw: P }];   // (several bartenders: three on an island, two round)
}
