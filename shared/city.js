// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// City grid layout helpers shared by server (generation, navigation) and client (rendering, traffic).
// Streets run along z at x = X[i] (i = 0..nx) and along x at z = Z[j] (j = 0..nz).
// Block (i, j) sits between streets i/i+1 and j/j+1. Block side ids: 0 = +z edge, 1 = +x, 2 = -z, 3 = -x.
// A world may have no city grid (nx or nz 0: a clean island the owner builds on with roads and lots of its own). Its
// grid is empty: no streets, no blocks, X and Z empty and its bounds empty (min +Infinity, max −Infinity), so every
// point is beyond the city.
import { SIDEWALK, WALK_BAND } from './constants.js';

/** Whether a world's grid spec has a city (at least one block). */
export const hasCity = spec => !!spec && (spec.nx | 0) > 0 && (spec.nz | 0) > 0;

export function makeGrid(spec) {
  const nx = spec?.nx | 0, nz = spec?.nz | 0, bw = +spec?.bw || 0, bd = +spec?.bd || 0, road = +spec?.road || 0;
  const px = bw + road, pz = bd + road;
  if (nx < 1 || nz < 1) return { nx: 0, nz: 0, bw, bd, road, px, pz, X: [], Z: [], hr: road / 2, empty: true,
    minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const x0 = -nx * px / 2, z0 = -nz * pz / 2;
  const X = [], Z = [];
  for (let i = 0; i <= nx; i++) X.push(x0 + i * px);
  for (let j = 0; j <= nz; j++) Z.push(z0 + j * pz);
  const hr = road / 2;
  return { nx, nz, bw, bd, road, px, pz, X, Z, hr,
    minX: X[0] - hr, maxX: X[nx] + hr, minZ: Z[0] - hr, maxZ: Z[nz] + hr };
}
/** The rectangle views frame (the overview, the minimap, the camera's first bounds): the city's; without a city the
 *  island's plain where one would stand (terrain.city), else 600 m round the origin. { x0, z0, x1, z1 } (m). */
export function viewRect(world) {
  const g = makeGrid(world?.grid);
  if (!g.empty) return { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ };
  const c = world?.terrain?.city;
  return c ? { x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1 } : { x0: -300, z0: -300, x1: 300, z1: 300 };
}
export const blockIndex = (g, i, j) => j * g.nx + i;
export const blockIJ = (g, bi) => ({ i: bi % g.nx, j: Math.floor(bi / g.nx) });
export const ixIndex = (g, i, j) => j * (g.nx + 1) + i;
export const ixIJ = (g, ix) => ({ i: ix % (g.nx + 1), j: Math.floor(ix / (g.nx + 1)) });

export function blockRect(g, i, j) {
  return { x0: g.X[i] + g.hr, x1: g.X[i + 1] - g.hr, z0: g.Z[j] + g.hr, z1: g.Z[j + 1] - g.hr };
}
export function lotRect(g, i, j) {
  const r = blockRect(g, i, j);
  return { x0: r.x0 + SIDEWALK, x1: r.x1 - SIDEWALK, z0: r.z0 + SIDEWALK, z1: r.z1 - SIDEWALK };
}
/** Block containing (x, z) (sidewalk included), or null if the point is on a street. */
export function blockAt(g, x, z) {
  if (g.empty) return null;
  const i = Math.floor((x - g.X[0]) / g.px), j = Math.floor((z - g.Z[0]) / g.pz);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return null;
  const r = blockRect(g, i, j);
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 ? { i, j, bi: blockIndex(g, i, j) } : null;
}
/** Walking-band corner c (0: x0z0, 1: x1z0, 2: x1z1, 3: x0z1). */
export function cornerPoint(g, i, j, c) {
  const r = blockRect(g, i, j), w = WALK_BAND;
  switch (c) {
    case 0: return { x: r.x0 + w, z: r.z0 + w };
    case 1: return { x: r.x1 - w, z: r.z0 + w };
    case 2: return { x: r.x1 - w, z: r.z1 - w };
    default: return { x: r.x0 + w, z: r.z1 - w };
  }
}
export const SIDE_CORNERS = [[3, 2], [1, 2], [0, 1], [0, 3]];
export const SIDE_N = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export function rotToSide(rotDeg) { const r = ((Math.round(rotDeg) % 360) + 360) % 360; return r === 0 ? 0 : r === 90 ? 1 : r === 180 ? 2 : 3; }
export const sideToRot = s => [0, 90, 180, 270][s & 3];
/** Project a point onto the walking band of a block side; returns {x, z, t} with t = distance from the side's first corner. */
export function bandPoint(g, i, j, side, x, z) {
  const r = blockRect(g, i, j), w = WALK_BAND;
  const a = cornerPoint(g, i, j, SIDE_CORNERS[side][0]);
  if (side === 0 || side === 2) {
    const zz = side === 0 ? r.z1 - w : r.z0 + w;
    const xx = Math.min(Math.max(x, r.x0 + w), r.x1 - w);
    return { x: xx, z: zz, t: Math.abs(xx - a.x) };
  }
  const xx = side === 1 ? r.x1 - w : r.x0 + w;
  const zz = Math.min(Math.max(z, r.z0 + w), r.z1 - w);
  return { x: xx, z: zz, t: Math.abs(zz - a.z) };
}
/** Street lamp positions (on the sidewalk, near the curb) — deterministic. */
export function lampPositions(g) {
  const out = [];
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const r = blockRect(g, i, j), inset = 0.7;
    const spanX = r.x1 - r.x0, spanZ = r.z1 - r.z0;
    const nX = Math.max(2, Math.round(spanX / 22)), nZ = Math.max(2, Math.round(spanZ / 22));
    for (let k = 0; k < nX; k++) {
      const x = r.x0 + 8 + (spanX - 16) * (k / (nX - 1));
      out.push({ x, z: r.z0 + inset, face: 2 }, { x, z: r.z1 - inset, face: 0 });
    }
    for (let k = 1; k < nZ - 1; k++) {
      const z = r.z0 + 8 + (spanZ - 16) * (k / (nZ - 1));
      out.push({ x: r.x0 + inset, z, face: 3 }, { x: r.x1 - inset, z, face: 1 });
    }
  }
  return out;
}
/** Street tree positions on sidewalks (between lamps), deterministic. */
export function streetTreePositions(g, skip) {
  const out = [];
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const r = blockRect(g, i, j), inset = 1.1;
    const spanX = r.x1 - r.x0, spanZ = r.z1 - r.z0;
    const nX = Math.max(1, Math.round(spanX / 11)), nZ = Math.max(1, Math.round(spanZ / 11));
    for (let k = 0; k < nX; k++) {
      const x = r.x0 + 5.5 + (spanX - 11) * ((k + 0.5) / nX);
      if (!skip || !skip(x, r.z0 + inset)) out.push({ x, z: r.z0 + inset });
      if (!skip || !skip(x, r.z1 - inset)) out.push({ x, z: r.z1 - inset });
    }
    for (let k = 0; k < nZ; k++) {
      const z = r.z0 + 5.5 + (spanZ - 11) * ((k + 0.5) / nZ);
      if (!skip || !skip(r.x0 + inset, z)) out.push({ x: r.x0 + inset, z });
      if (!skip || !skip(r.x1 - inset, z)) out.push({ x: r.x1 - inset, z });
    }
  }
  return out;
}
export const AVENUES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave', '5th Ave', '6th Ave', '7th Ave', '8th Ave', '9th Ave', '10th Ave', '11th Ave', '12th Ave', '13th Ave', '14th Ave', '15th Ave', '16th Ave', '17th Ave'];
export const STREETS = ['Harbor St', 'Oak St', 'Maple St', 'Pine St', 'Elm St', 'Cedar St', 'Birch St', 'Walnut St', 'Spruce St', 'Chestnut St', 'Aspen St', 'Willow St', 'Hazel St', 'Laurel St', 'Poplar St', 'Juniper St', 'Linden St'];
export function addressOf(g, x, z) {
  if (g.empty) return '';
  const i = Math.round((x - g.X[0]) / g.px), j = Math.round((z - g.Z[0]) / g.pz);
  return `${AVENUES[Math.min(Math.max(i, 0), AVENUES.length - 1)]} & ${STREETS[Math.min(Math.max(j, 0), STREETS.length - 1)]}`;
}
