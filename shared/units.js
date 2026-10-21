// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Lengths and positions of the editable world (roads, lots, terrain edits) are stored as integer micrometres (µm).
// One foot is exactly 304,800 µm and one metre 1,000,000 µm. Exact on entry: metres to six decimals, feet to hundredths
// (0.01 ft = 3,048 µm) and inches to eighths (1/8 in = 3,175 µm). Finer values (0.001 ft = 304.8 µm, 1/16 in =
// 1,587.5 µm) are rounded to the nearest micrometre when entered - the declared storage quantum, an error of at most
// 0.5 µm. Stored geometry is then exact: overlaps, containment and areas are computed on the stored integers with no
// further rounding. People see and type feet (shown to 0.01 ft); the renderer and the simulation work in metres
// (DECISIONS E25, wp4-world-spec.md §3.1).
export const UM_PER_M = 1_000_000;
export const UM_PER_FT = 304_800;
export const M_PER_FT = 0.3048;
/** One imported classic tile is 4 ft. */
export const FT_PER_TILE = 4;
/** Largest stored coordinate magnitude (±1,000 km): far inside Number.MAX_SAFE_INTEGER, and products stay exact in BigInt. */
export const MAX_UM = 1e12;

const check = u => {
  if (!Number.isSafeInteger(u) || Math.abs(u) > MAX_UM) throw new RangeError(`length out of range: ${u}`);
  return u;
};
/** Metres to µm, rounded to the nearest micrometre (exact for six decimals). */
export const mToUm = m => check(Math.round(m * UM_PER_M));
export const umToM = u => u / UM_PER_M;
/** Feet to µm, rounded to the nearest micrometre (exact for hundredths of a foot). */
export const QUANTUM_UM = 1;
export const ftToUm = ft => check(Math.round(ft * UM_PER_FT));
export const umToFt = u => u / UM_PER_FT;
export const ftToM = ft => ft * M_PER_FT;
export const mToFt = m => m / M_PER_FT;
export const isUm = u => Number.isSafeInteger(u) && Math.abs(u) <= MAX_UM;
/** Snap a µm length to a step given in feet (e.g. 1 for whole feet, 0.01 for hundredths). */
export const snapUmToFt = (u, stepFt = 1) => { const s = Math.round(stepFt * UM_PER_FT); return check(Math.round(u / s) * s); };

/** A length for display: "12 ft", "12.5 ft", "1,320 ft"; at most `decimals` decimals, trailing zeros dropped. */
export function formatFt(u, decimals = 2) {
  const ft = umToFt(u), f = 10 ** decimals, r = Math.round(ft * f) / f;
  return `${r.toLocaleString('en-US', { maximumFractionDigits: decimals })} ft`;
}
/** An area (µm²) for display in square feet; BigInt input is accepted for exact areas. */
export function formatSqFt(um2) {
  const sq = typeof um2 === 'bigint' ? Number(um2 / 92_903_040_000n) + Number(um2 % 92_903_040_000n) / 92_903_040_000 : um2 / (UM_PER_FT * UM_PER_FT);
  return `${Math.round(sq).toLocaleString('en-US')} sq ft`;
}
/** Parse a typed length: "12", "12 ft", "12'", "12' 6\"", "3.5 m". Returns µm, or null when it can't be read. */
export function parseLength(text) {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;
  let m = /^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?)$/.exec(s);
  if (m) return mToUm(+m[1]);
  m = /^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches?))?$/.exec(s);
  if (m) { const ft = +m[1] + (m[2] ? Math.sign(+m[1] || 1) * (+m[2]) / 12 : 0); return ftToUm(ft); }
  return null;
}
