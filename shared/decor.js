// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Decorations (WP4.7, wp4-world-spec.md §4.1, §9): outdoor items people place on the land itself - trees, bushes,
// flower beds, benches, picnic tables, fountains - kept in world.decorations ({ id, t, x, z, r (radians) }) and drawn
// on the ground. Lot holders (and those they share build rights with) place them inside their own lots;
// administrators on public land. The rules here are the same in the browser's ghost and on the server; who may place
// where is checked against the lots (server/lot-rights.js). The Marketing tools' billboards and street signs
// (shared/signs.js) are decorations too, put up by administrators only, with their own rules: a street sign may stand on
// a sidewalk (clear of the corners), an overhanging billboard stands on its pole's base and its board may hang over the
// sidewalk but never over a road; each keeps its own content for the house's turns (hc).
import { CATALOG } from './catalog.js';
import { inItemRect } from './geom.js';
import { blockAt, blockRect, lotRect } from './city.js';
import { AD_ASSETS, AD_ASSET_TYPES } from './signs.js';
import { normalizeAdCreative } from './ads.js';
import { moduleAt } from './world-modules.js';

export const DECOR_TYPES = ['tree', 'tree_pine', 'bush', 'flowers', 'bench', 'picnic_table', 'fountain', ...AD_ASSET_TYPES];
/** Items only administrators put up (the Marketing tools): billboards and street signs carry the ads (shared/ads.js). */
export const DECOR_ADMIN_ONLY = AD_ASSET_TYPES;
export const DECOR_LIMITS = Object.freeze({ total: 20000, perLot: 250 });
/** Colours offered for the items that take one (leaves, blooms); the first is the default. */
export const DECOR_TINTS = Object.freeze({
  tree: ['#5a9447', '#4f8a3c', '#6d9a4c', '#8a9a3c', '#b5652b'], bush: ['#4f8a3c', '#5e9a45', '#3f6f33', '#7a9a4a'],
  flowers: ['#e05a7a', '#f2c14e', '#9b5de5', '#f15bb5', '#ff8c42', '#f8f4e3'],
});
const cm = v => Math.round(v * 100) / 100;

/** A checked decoration ({ t, x, z, r }) or an Error. */
export function normalizeDecor(o) {
  if (!o || !DECOR_TYPES.includes(o.t)) return new Error('That is not something to place outdoors');
  const x = +o.x, z = +o.z, r = +(o.r || 0);
  if (![x, z, r].every(Number.isFinite)) return new Error('Bad position');
  const out = { t: o.t, x: cm(x), z: cm(z), r: Math.round((((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1000) / 1000 };
  if (DECOR_TINTS[o.t]) out.c = /^#[0-9a-f]{6}$/i.test(o.c || '') ? o.c.toLowerCase() : DECOR_TINTS[o.t][0];
  if (AD_ASSETS[o.t] && o.hc) {   // its own content for the house's turns (a design with a link)
    const hc = normalizeAdCreative(o.hc, { images: 'any' });
    if (hc instanceof Error) return hc;
    out.hc = hc;
  }
  return out;
}
/** Where an item touches the ground: an overhanging billboard's pole base, else its whole rectangle. */
export function decorBase(d, pad = 0) {
  const B = AD_ASSETS[d.t]?.base;
  return B ? rectCorners(d, B, pad) : decorCorners(d, pad);
}
/** The item's footprint corners in world space (its catalogue rectangle, turned). */
export function decorCorners(d, pad = 0) { return rectCorners(d, CATALOG[d.t].rect, pad); }
function rectCorners(d, R, pad) {
  const c = Math.cos(d.r), s = Math.sin(d.r);
  return [[R[0] - pad, R[1] - pad], [R[2] + pad, R[1] - pad], [R[2] + pad, R[3] + pad], [R[0] - pad, R[3] + pad]].map(([lx, lz]) => ({ x: d.x + lx * c + lz * s, z: d.z - lx * s + lz * c }));
}
/**
 * Why decoration d can't go there, or null. env: { isWater(x, z), roads (RoadNetwork or null), city: makeGrid result,
 * buildings, decorations }; ignoreId: the decoration being moved.
 */
export function checkDecor(d, env, ignoreId = null) {
  const pts = decorCorners(d), ground = decorBase(d), g = env.city, A = AD_ASSETS[d.t];
  if (ground.some(p => env.isWater && env.isWater(p.x, p.z))) return 'That is in the water';
  if (env.modules?.length) { const m = ground.map(p => moduleAt({ worldModules: env.modules }, p.x, p.z, 1)).find(Boolean); if (m) return `That is ${m.name || 'a world module'}'s land`; }
  if (env.roads && env.roads.corridorHits(ground, 0).length) return 'Keep it off the road';
  if (A?.base && env.roads && env.roads.corridorHits(pts, 0).length) return 'The board may hang over the sidewalk, not over the road';
  if (g && !g.empty) {   // in the city: on a block (its lot), not in a street
    const inCity = p => p.x >= g.minX && p.x <= g.maxX && p.z >= g.minZ && p.z <= g.maxZ;
    if (d.t === 'street_sign') {   // on a lot or the sidewalk, clear of the corners where people cross
      if (pts.some(inCity) && !pts.every(p => blockAt(g, p.x, p.z))) return 'Keep it off the street';
      const k = blockAt(g, d.x, d.z);
      if (k && !onBlock(g, d.x, d.z)) {
        const r = blockRect(g, k.i, k.j), nearX = Math.min(d.x - r.x0, r.x1 - d.x), nearZ = Math.min(d.z - r.z0, r.z1 - d.z);
        if (nearX < 4.5 && nearZ < 4.5) return 'Keep it clear of the corner, where people cross';
      }
    } else {
      if (ground.some(inCity) && !ground.every(p => onBlock(g, p.x, p.z))) return 'Keep it off the street and the sidewalk';
      if (A?.base && pts.some(inCity) && !pts.every(p => blockAt(g, p.x, p.z))) return 'The board may hang over the sidewalk, not over the street';
    }
  }
  for (const B of env.buildings || []) {
    if (!B || B.gone || B.type === 'park') continue;
    const rB = (B.rot || 0) * Math.PI / 180, rect = [-B.w / 2 - 0.3, -B.d / 2 - 0.3, B.w / 2 + 0.3, B.d / 2 + 0.3];
    const bc = [[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]].map(([lx, lz]) => ({ x: B.x + lx * Math.cos(rB) + lz * Math.sin(rB), z: B.z - lx * Math.sin(rB) + lz * Math.cos(rB) }));
    if (pts.some(p => inItemRect(p.x, p.z, B.x, B.z, rB, rect)) || inItemRect(d.x, d.z, B.x, B.z, rB, rect) || bc.some(p => inItemRect(p.x, p.z, d.x, d.z, d.r, CATALOG[d.t].rect))) return `Too close to ${B.name || 'a building'}`;
    if (B.door) {   // never in front of a door
      const c = Math.cos(rB), s = Math.sin(rB), ox = B.x + B.door.x * c + (B.d / 2 + 1.5) * s, oz = B.z - B.door.x * s + (B.d / 2 + 1.5) * c;
      if (Math.hypot(d.x - ox, d.z - oz) < 2.2) return `That blocks the door of ${B.name || 'a building'}`;
    }
  }
  const R = CATALOG[d.t].rect, mine = Math.hypot(R[2] - R[0], R[3] - R[1]) / 2;
  for (const o of env.decorations || []) {
    if (o.id === ignoreId) continue;
    const Ro = CATALOG[o.t]?.rect; if (!Ro) continue;
    if (Math.hypot(o.x - d.x, o.z - d.z) < mine + Math.hypot(Ro[2] - Ro[0], Ro[3] - Ro[1]) / 2 - 0.25) return 'Too close to another one';
  }
  return null;
}
/** Whether (x, z) lies on a city block's land (inside its sidewalks). */
function onBlock(g, x, z) {
  const k = blockAt(g, x, z); if (!k) return false;
  const r = lotRect(g, k.i, k.j);
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}
