// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Shared editing rules: the client uses them for live placement previews, the server re-checks every edit.
import { CATALOG } from './catalog.js';
import { WALL_T, MAX_FLOORS } from './constants.js';
import { itemAABB, footprint, rectsOverlap, toWorld, toLocal, segDist } from './geom.js';
import { buildGrid, flood, nearestFree } from './navgrid.js';
import { levelEntries, elevatorStops, gatePoints, doorPoints } from './building.js';
import { makeGrid, lotRect, blockAt, bandPoint, blockIJ, rotToSide } from './city.js';

// (not the Marketing tools' billboards and street signs: they stand outdoors only)
export const EDIT_TYPES = Object.keys(CATALOG).filter(t => !CATALOG[t].fixed && !CATALOG[t].outdoor && t !== 'door');
export const BUILD_TYPES = ['office', 'apartment', 'cafe', 'restaurant', 'shop', 'gym', 'park'];
export const BUILD_STYLES = ['glass', 'brick', 'concrete', 'modern', 'classic', 'stucco'];
export const ROOF_KINDS = ['hvac', 'garden', 'water_tower', 'helipad', 'none'];

export function interiorBounds(b) {
  const m = b.type === 'park' ? 0 : WALL_T;
  return { x0: -b.w / 2 + m, x1: b.w / 2 - m, z0: -b.d / 2 + m, z1: b.d / 2 - m };
}
function wallHitsRect(w, bb) {
  const pad = 0.06, x0 = bb.x0 - pad, x1 = bb.x1 + pad, z0 = bb.z0 - pad, z1 = bb.z1 + pad;
  const L = Math.hypot(w[2] - w[0], w[3] - w[1]), n = Math.max(2, Math.ceil(L / 0.08));
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = w[0] + (w[2] - w[0]) * t, z = w[1] + (w[3] - w[1]) * t;
    if (x > x0 && x < x1 && z > z0 && z < z1) return true;
  }
  return false;
}
/** Areas that must stay clear on a floor (entrance, park gates, elevator doors). */
export function keepClear(b, f) {
  const out = [];
  if (b.type !== 'park' && f === 0 && b.door) {
    const iz1 = b.d / 2 - WALL_T;
    out.push({ x0: b.door.x - b.door.w / 2 - 0.15, x1: b.door.x + b.door.w / 2 + 0.15, z0: iz1 - 1.3, z1: iz1 + 0.01, why: 'the entrance' });
  }
  if (b.type === 'park') for (const g of gatePoints(b)) out.push({ x0: g.inside.x - 1.2, x1: g.inside.x + 1.2, z0: g.inside.z - 1.2, z1: g.inside.z + 1.2, why: 'a gate' });
  for (const s of elevatorStops(b)) out.push({ x0: s.x - 0.8, x1: s.x + 0.8, z0: s.z - 0.8, z1: s.z + 0.8, why: 'the elevator' });
  return out;
}
/** Returns null when the item can be placed, else a human-readable reason. */
export function checkItem(b, f, level, it, ignoreId = null) {
  const def = CATALOG[it.t];
  if (!def) return 'Unknown item type';
  if (def.fixed || it.t === 'door') return 'That is part of the building';
  if (![it.x, it.z, it.r].every(Number.isFinite)) return 'Bad position';
  const bb = itemAABB(it, def.rect), ib = interiorBounds(b);
  if (bb.x0 < ib.x0 - 0.001 || bb.x1 > ib.x1 + 0.001 || bb.z0 < ib.z0 - 0.001 || bb.z1 > ib.z1 + 0.001) return 'Outside the floor';
  if (def.block === false) return null;
  for (const c of keepClear(b, f)) if (rectsOverlap(bb, c, 0)) return `Blocks ${c.why}`;
  for (const o of level.items) {
    if (o.id === ignoreId) continue;
    const od = CATALOG[o.t];
    if (!od || od.block === false) continue;
    if (rectsOverlap(bb, itemAABB(o, od.rect), 0.02)) return `Overlaps the ${od.name.toLowerCase()}`;
  }
  for (const w of level.walls || []) if (wallHitsRect(w, bb)) return 'Overlaps a wall';
  return null;
}
/** Every entrance / elevator stop of the floor must stay reachable from the first one. */
export function levelConnected(b, f, level) {
  const g = buildGrid(b, level);
  const seeds = levelEntries(b, f).map(p => nearestFree(g, p.x, p.z, 3));
  if (!seeds.length) return true;
  if (seeds.some(s => s < 0)) return false;
  const reach = flood(g, [seeds[0]]);
  return seeds.every(s => reach[s]);
}

const FOLLOW = 1.2, FOLLOW_WALL = 0.3;   // m: furniture this close to a side moves with it; wall ends this close
const r3e = v => Math.round(v * 1000) / 1000;
/** How the inside of building B changes when it takes geometry g ({ x, z, w, d, rot }) — as in the Sims: whatever stands
 *  against a side that moves (furniture within FOLLOW m, the elevator, the ends of inner walls touching it) moves with
 *  that side; everything else goes with the side that moved least (it stays where it stands in the world while one side
 *  is dragged, and comes along when the building is also moved). Moving or turning without a new size keeps the inside
 *  as it is. Returns { shift(x0, x1, z0, z1, near) → [dx, dz] for a box in B's old local frame, c: the new middle in the
 *  old frame } or null when nothing moves relative to the building. */
function follower(B, g) {
  const nb = { ...B, ...g };
  if ((((nb.rot || 0) - (B.rot || 0)) % 360 + 360) % 360 !== 0) return null;
  if (nb.w === B.w && nb.d === B.d) return null;
  const c = toLocal(B, nb.x, nb.z), ib = interiorBounds(B), nib = interiorBounds(nb);
  const dx0 = c.x + nib.x0 - ib.x0, dx1 = c.x + nib.x1 - ib.x1, dz0 = c.z + nib.z0 - ib.z0, dz1 = c.z + nib.z1 - ib.z1;
  const least = (a, b) => (a * b > 0 ? (Math.abs(a) < Math.abs(b) ? a : b) : 0);
  const mx = least(dx0, dx1), mz = least(dz0, dz1);
  const shift = (x0, x1, z0, z1, near) => [
    dx1 && ib.x1 - x1 < near ? dx1 : dx0 && x0 - ib.x0 < near ? dx0 : mx,
    dz1 && ib.z1 - z1 < near ? dz1 : dz0 && z0 - ib.z0 < near ? dz0 : mz,
  ];
  return { shift, c };
}
/** The building's elevator core after B takes geometry g (it stands against a side and moves with it), local to g. */
export function followCore(B, g) {
  const f = follower(B, g), core = B.core;
  if (!core || !f) return core ? { ...core } : null;
  const bb = itemAABB(core, CATALOG[core.t].rect), [sx, sz] = f.shift(bb.x0, bb.x1, bb.z0, bb.z1, FOLLOW);
  return { ...core, x: r3e(core.x + sx - f.c.x), z: r3e(core.z + sz - f.c.z) };
}
/** A floor layout L of building B as it will be after B takes geometry g: a copy, positions local to g (see follower). */
export function followLayout(B, g, L) {
  const f = follower(B, g);
  if (!f || !L) return L;
  const items = L.items.map(it => {
    const def = CATALOG[it.t]; if (!def) return it;
    const bb = itemAABB(it, def.rect), [sx, sz] = f.shift(bb.x0, bb.x1, bb.z0, bb.z1, FOLLOW);
    return { ...it, x: r3e(it.x + sx - f.c.x), z: r3e(it.z + sz - f.c.z) };
  });
  const end = (x, z) => { const [sx, sz] = f.shift(x, x, z, z, FOLLOW_WALL); return [r3e(x + sx - f.c.x), r3e(z + sz - f.c.z)]; };
  const walls = (L.walls || []).map(w => { const a = end(w[0], w[1]), b = end(w[2], w[3]); return [a[0], a[1], b[0], b[1], ...w.slice(4)]; });
  return { ...L, items, ...(L.walls ? { walls } : {}) };
}

/**
 * Moving, turning or resizing a standing building (op bld.place): its floors' furniture and walls follow the sides they
 * stand against (followLayout), and the building must still hold all of it, keep the entrance and the elevator clear
 * and every floor walkable. B: the building; g: its new { x, z, w, d, rot }; levelAt(lv): a floor layout as it is now.
 * full=false skips the walkability test (cheap enough while dragging). Returns null, or what is in the way in words.
 */
export function interiorFits(B, g, levelAt, full = true) {
  const nb = { ...B, ...g, core: followCore(B, g) }, ib = interiorBounds(nb), seen = new Set();
  const where = f => (B.floors > 1 ? `floor ${f + 1}` : B.type === 'park' ? 'the park' : 'the floor');
  const out = bb => bb.x0 < ib.x0 - 0.001 || bb.x1 > ib.x1 + 0.001 || bb.z0 < ib.z0 - 0.001 || bb.z1 > ib.z1 + 0.001;
  for (let f = 0; f < B.floors; f++) {
    const orig = levelAt(B.lv[f]), L = followLayout(B, g, orig); if (!L) continue;
    const key = `${B.lv[f]}:${f === 0 ? 0 : 1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // what moved with a side must not land on something else or on an inner wall
    for (let k = 0; k < L.items.length; k++) {
      const it = L.items[k], o = orig.items[k], def = CATALOG[it.t];
      if (!def || def.block === false) continue;
      const a = toWorld(B, o.x, o.z), b = toWorld(nb, it.x, it.z);
      if (Math.hypot(a.x - b.x, a.z - b.z) < 0.01) continue;
      const bb = itemAABB(it, def.rect), nm = def.fixed ? 'elevator' : def.name.toLowerCase();
      for (let j = 0; j < L.items.length; j++) {
        const q = L.items[j], qd = CATALOG[q.t];
        if (j === k || !qd || qd.block === false) continue;
        if (rectsOverlap(bb, itemAABB(q, qd.rect), 0.02)) return `The ${nm} on ${where(f)} would bump into the ${qd.fixed ? 'elevator' : qd.name.toLowerCase()}; move one of them first`;
      }
      for (const w of L.walls || []) if (wallHitsRect(w, bb)) return `The ${nm} on ${where(f)} would bump into a wall; move it first`;
    }
    let n = 0, first = '';
    for (const it of L.items) {
      const def = CATALOG[it.t]; if (!def) continue;
      if (out(itemAABB(it, def.rect))) { n++; first ||= def.fixed ? 'the elevator' : `the ${def.name.toLowerCase()}`; }
    }
    for (const w of L.walls || []) if (out({ x0: Math.min(w[0], w[2]), x1: Math.max(w[0], w[2]), z0: Math.min(w[1], w[3]), z1: Math.max(w[1], w[3]) })) { n++; first ||= 'a wall'; }
    if (n) return `${n > 1 ? `${first[0].toUpperCase()}${first.slice(1)} and ${n - 1} more thing${n > 2 ? 's' : ''}` : `${first[0].toUpperCase()}${first.slice(1)}`} on ${where(f)} would be outside the new walls; move ${n > 1 ? 'them' : 'it'} first`;
    for (const it of L.items) {
      const def = CATALOG[it.t]; if (!def || def.fixed || def.block === false) continue;
      for (const c of keepClear(nb, f)) if (rectsOverlap(itemAABB(it, def.rect), c, 0)) return `The ${def.name.toLowerCase()} on ${where(f)} would block ${c.why}; move it first`;
    }
    if (full && !levelConnected(nb, f, L)) return `The way through ${where(f)} would be blocked; move some furniture first`;
  }
  return null;
}

// ------------------------------------------------------------------ floor layouts on a resize (2026-10-04)
/** How a floor layout came to be: 'auto' — generated and never changed by hand, so a resize generates it again for the
 *  new size (the building's seed: the same size gives the same floor back); 'empty' — cleared on purpose, it stays
 *  empty; 'custom' — changed by hand (and any layout nobody has shown to be generated). */
export function levelMode(L) { return L?.auto ? 'auto' : L?.mode === 'empty' ? 'empty' : 'custom'; }
/** "floor 2", "floors 2 & 3", "floors 2–9"; "the floor" (or "the park") in a building of one floor. */
export function floorsName(B, floors) {
  if (B.floors <= 1) return B.type === 'park' ? 'the park' : 'the floor';
  const n = [...new Set(floors)].sort((a, b) => a - b).map(f => f + 1);
  if (n.length === 1) return `floor ${n[0]}`;
  const parts = [];   // runs of three or more read as a range: "floors 1 & 4–8"
  for (let i = 0; i < n.length;) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    if (j - i >= 2) parts.push(`${n[i]}–${n[j]}`); else for (let k = i; k <= j; k++) parts.push(String(n[k]));
    i = j + 1;
  }
  return `floors ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} & ${parts.at(-1)}` : parts[0]}`;
}
const MIN_WALL = 0.25;   // m: an inner wall cut shorter than this goes
/** The part of wall w inside rectangle r (Liang–Barsky), or null. */
function clipWall(w, r) {
  const dx = w[2] - w[0], dz = w[3] - w[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, w[0] - r.x0], [dx, r.x1 - w[0]], [-dz, w[1] - r.z0], [dz, r.z1 - w[1]]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  if (t0 === 0 && t1 === 1) return w;
  return [r3e(w[0] + dx * t0), r3e(w[1] + dz * t0), r3e(w[0] + dx * t1), r3e(w[1] + dz * t1), ...w.slice(4)];
}
/** The movable piece nearest the way between floor f's first entry and one it cannot reach (index in L.items), or -1. */
function wayBlocker(b, f, L) {
  const g = buildGrid(b, L), entries = levelEntries(b, f), seeds = entries.map(p => nearestFree(g, p.x, p.z, 3));
  const first = flood(g, [seeds[0]].filter(s => s >= 0));
  const k = entries.findIndex((p, i) => seeds[i] < 0 || !first[seeds[i]]);
  if (k < 0) return -1;
  const p = entries[k], q = entries[0];
  let best = -1, bd = Infinity;
  L.items.forEach((it, i) => {
    const def = CATALOG[it.t]; if (!def || def.fixed || def.block === false) return;
    const d = segDist(it.x, it.z, p.x, p.z, q.x, q.z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
const pieceName = it => (CATALOG[it.t]?.fixed ? 'elevator' : (CATALOG[it.t]?.name || it.t).toLowerCase());
/**
 * What a move or resize of building B to geometry g does to each of its floor layouts (op bld.place, the place tool's
 * preview and its dialog). levelAt(lv): a layout as it is now. Per layout (shared by the floors in `floors`):
 * - 'auto' and the size changes: generated again for the new size (regen: true; the server generates it);
 * - otherwise its furniture and walls follow the sides (followLayout), walls poking out are cut at the new walls
 *   (trim: how many), and `remove` lists the pieces that would not fit: outside the walls, pushed into another piece or a
 *   wall, in front of the entrance or the elevator, or (full) in the way through the floor. `layout` is the floor kept
 *   without them; keepOk is false (keepWhy says why) when the floor would still be blocked by its walls.
 * Returns { why: a reason nothing can fix (the elevator outside the walls) or null, sized, groups, remove: pieces to
 * remove on floors that need a choice, choose: whether the person must choose (keep without them, regenerate, cancel) }.
 */
export function interiorPlan(B, g, levelAt, full = true) {
  const sized = g.w !== B.w || g.d !== B.d, nb = { ...B, ...g, core: followCore(B, g) };
  const plan = { why: null, sized, groups: [], remove: 0, choose: false };
  const byLv = new Map();
  for (let f = 0; f < B.floors; f++) {
    const lv = B.lv[f];
    let G = byLv.get(lv);
    if (!G) { G = { lv, floors: [], mode: levelMode(levelAt(lv)), regen: false, remove: [], trim: 0, keepOk: true, keepWhy: '', layout: null }; byLv.set(lv, G); plan.groups.push(G); }
    G.floors.push(f);
  }
  for (const G of plan.groups) {
    if (G.mode === 'auto' && sized) { G.regen = true; continue; }
    const orig = levelAt(G.lv), L = orig ? followLayout(B, g, orig) : null;
    if (!L || L === orig) continue;
    const r = fitPieces(nb, G.floors.filter((f, n) => n === 0 || f === 0), floorsName(B, G.floors), L, orig.items, orig.walls || [], full);
    if (r.why) plan.why ||= r.why;
    Object.assign(G, { remove: r.remove, trim: r.trim, keepOk: r.keepOk, keepWhy: r.keepWhy, layout: r.layout });
    if (G.remove.length || !G.keepOk) { plan.choose = true; plan.remove += G.remove.length; }
  }
  return plan;
}
/**
 * What of layout L does not fit building nb (already in nb's frame): pieces outside the walls, pushed into each other or
 * into an inner wall, in front of the entrance or the elevator on floors `check`, or (full) in the way through. wasItems /
 * wasWalls: the same pieces before they moved (index for index; null for a piece that is new here), so that what stood
 * that close already does not count. Returns { why (a fixed piece that cannot fit), remove, trim, keepOk, keepWhy,
 * layout: L without the misfits, walls cut at the walls }.
 */
function fitPieces(nb, check, where, L, wasItems, wasWalls, full) {
  const ib = interiorBounds(nb), cut = { x0: ib.x0 - 0.001, x1: ib.x1 + 0.001, z0: ib.z0 - 0.001, z1: ib.z1 + 0.001 };
  const out = bb => bb.x0 < cut.x0 || bb.x1 > cut.x1 || bb.z0 < cut.z0 || bb.z1 > cut.z1;
  const R = { why: null, remove: [], trim: 0, keepOk: true, keepWhy: '', layout: null };
  const items = L.items, gone = new Set();
  const box = k => { const def = CATALOG[items[k].t]; return def ? itemAABB(items[k], def.rect) : null; };
  const wasBox = k => { const o = wasItems[k], def = o && CATALOG[o.t]; return def ? itemAABB(o, def.rect) : null; };
  const blocks = k => { const def = CATALOG[items[k].t]; return !!def && def.block !== false; };
  const fixed = k => !!CATALOG[items[k].t]?.fixed;
  const drop = (k, why) => {
    if (gone.has(k)) return;
    const it = items[k];
    if (fixed(k)) { R.why ||= `The elevator on ${where} would ${why === 'outside' ? 'be outside the new walls' : 'not fit'}`; return; }
    gone.add(k); R.remove.push({ kind: 'item', id: it.id, t: it.t, name: pieceName(it), why, bb: box(k) });
  };
  // 1 outside the walls
  items.forEach((it, k) => { const bb = box(k); if (bb && out(bb)) drop(k, 'outside'); });
  // 2 inner walls: cut at the walls; a wall cut to nothing goes
  const walls = [];
  (L.walls || []).forEach((w, i) => {
    const c = clipWall(w, cut);
    if (!c || Math.hypot(c[2] - c[0], c[3] - c[1]) < MIN_WALL) { R.remove.push({ kind: 'wall', i, name: 'wall', why: 'outside', seg: w.slice(0, 4) }); return; }
    if (c !== w) R.trim++;
    walls.push({ w: c, i });
  });
  // 3 pieces pushed into each other (only what was brought together: not what stood that close already)
  for (let k = 0; k < items.length; k++) {
    if (gone.has(k) || !blocks(k)) continue;
    for (let j = k + 1; j < items.length; j++) {
      if (gone.has(j) || gone.has(k) || !blocks(j)) continue;
      if (!rectsOverlap(box(k), box(j), 0.02)) continue;
      const a = wasBox(k), b = wasBox(j);
      if (a && b && rectsOverlap(a, b, 0.02)) continue;
      const movedK = !wasItems[k] || Math.hypot(items[k].x - wasItems[k].x, items[k].z - wasItems[k].z) > 1e-6;
      drop(fixed(k) ? j : fixed(j) ? k : movedK ? k : j, 'bump');
    }
  }
  // 4 pieces pushed into an inner wall (or a wall onto the elevator: then the wall goes)
  for (let k = 0; k < items.length; k++) {
    if (gone.has(k) || !blocks(k)) continue;
    const bb = box(k), was = wasBox(k);
    for (let n = 0; n < walls.length; n++) {
      const { w, i } = walls[n];
      if (!wallHitsRect(w, bb) || (was && wasWalls[i] && wallHitsRect(wasWalls[i], was))) continue;
      if (fixed(k)) { R.remove.push({ kind: 'wall', i, name: 'wall', why: 'bump', seg: w.slice(0, 4) }); walls.splice(n--, 1); continue; }
      drop(k, 'wall'); break;
    }
  }
  // 5 in front of the entrance or the elevator
  for (const f of check) for (const c of keepClear(nb, f)) items.forEach((it, k) => { if (!gone.has(k) && blocks(k) && !fixed(k) && rectsOverlap(box(k), c, 0)) drop(k, 'clear'); });
  let kept = { ...L, items: items.filter((_, k) => !gone.has(k)), walls: walls.map(x => x.w) };
  // 6 the way through each floor stays open: take away what stands in it (as a new floor's generator does)
  if (full) {
    for (const f of check) {
      for (let pass = 0; pass < 8 && !levelConnected(nb, f, kept); pass++) {
        const k = wayBlocker(nb, f, kept);
        if (k < 0) break;
        const it = kept.items[k];
        R.remove.push({ kind: 'item', id: it.id, t: it.t, name: pieceName(it), why: 'way', bb: itemAABB(it, CATALOG[it.t].rect) });
        kept = { ...kept, items: kept.items.filter((_, n) => n !== k) };
      }
      if (!levelConnected(nb, f, kept)) { R.keepOk = false; R.keepWhy = `The way through ${where} would still be blocked by its walls`; }
    }
  }
  R.layout = kept;
  return R;
}
// ------------------------------------------------------------------ saved floor layouts (the layout library)
/** What kind of floor f of building B is: saved layouts go onto floors of the same kind (2026-10-04: "apply a layout
 *  to other similarly zoned buildings"). An apartment block's street level with a shop is a shop floor. */
export function floorUse(B, f) {
  if (B.type === 'park') return 'park';
  if (B.type === 'office' || B.type === 'hq') return f === 0 ? 'office-lobby' : 'office';
  if (B.type === 'apartment') return f === 0 ? (B.mixed || 'apartment-lobby') : 'apartment';
  return B.type;
}
export const USE_NAME = { office: 'office floor', 'office-lobby': 'office lobby', apartment: 'apartment floor', 'apartment-lobby': 'apartment lobby', cafe: 'café', shop: 'shop', restaurant: 'restaurant', gym: 'gym', park: 'park' };
/** A floor layout as it is saved: local to the floor, without the building's own pieces (the elevator, doors). */
export function layoutToSave(L) {
  const own = it => CATALOG[it.t]?.fixed || it.t === 'door';
  return {
    name: L.name || '', items: L.items.filter(it => !own(it)).map(({ id, ...it }) => { void id; return it; }),
    walls: structuredClone(L.walls || []), zones: structuredClone(L.zones || []),
    ...(L.venue ? { venue: L.venue } : {}), ...(L.units ? { units: structuredClone(L.units) } : {}),
  };
}
/** Rectangle r ({ x0, z0, x1, z1 } in B's frame) in g's frame: an edge near a side that moves goes with it. */
function followBox(B, g, r) {
  const fw = follower(B, g); if (!fw) return r;
  const dx0 = fw.shift(r.x0, r.x0, r.z0, r.z1, FOLLOW_WALL)[0], dx1 = fw.shift(r.x1, r.x1, r.z0, r.z1, FOLLOW_WALL)[0];
  const dz0 = fw.shift(r.x0, r.x1, r.z0, r.z0, FOLLOW_WALL)[1], dz1 = fw.shift(r.x0, r.x1, r.z1, r.z1, FOLLOW_WALL)[1];
  return { x0: r3e(r.x0 + dx0 - fw.c.x), x1: r3e(r.x1 + dx1 - fw.c.x), z0: r3e(r.z0 + dz0 - fw.c.z), z1: r3e(r.z1 + dz1 - fw.c.z) };
}
/**
 * Saved layout rec ({ w, d, layout }, made on a floor of w × d) laid onto floor f of building B, whose layout is now cur:
 * its pieces, walls, floor areas and apartment units follow the sides from the size it was made for to this one (as when
 * a building is resized from its middle), the building's own pieces here (the elevator, doors) stay, and whatever then
 * does not fit is listed (as on a resize). Returns { why, remove, trim, keepOk, keepWhy, layout: the floor to write }.
 */
export function fitSaved(B, f, rec, cur, full = true) {
  const S0 = { type: B.type, x: 0, z: 0, w: rec.w, d: rec.d, rot: 0, floors: B.floors, door: B.door, core: null, lv: [] };
  const g = { x: 0, z: 0, w: B.w, d: B.d, rot: 0 }, src = rec.layout;
  const from = { items: (src.items || []).map((it, k) => ({ ...it, id: k + 1 })), walls: src.walls || [] };
  const F = followLayout(S0, g, from), n = from.items.length;
  const own = (cur?.items || []).filter(it => CATALOG[it.t]?.fixed || it.t === 'door').map((it, k) => ({ ...it, id: n + 1 + k }));
  const L = { items: [...F.items, ...own], walls: F.walls || [] };
  const r = fitPieces({ ...B }, [f], floorsName(B, [f]), L, [...from.items, ...own.map(() => null)], from.walls, full);
  const ib = interiorBounds(B), clip = b => ({ x0: Math.max(ib.x0, b.x0), x1: Math.min(ib.x1, b.x1), z0: Math.max(ib.z0, b.z0), z1: Math.min(ib.z1, b.z1) });
  const ok = b => b.x1 - b.x0 >= 0.2 && b.z1 - b.z0 >= 0.2;
  const zones = (src.zones || []).map(z => { const b = clip(followBox(S0, g, { x0: z[0], z0: z[1], x1: z[2], z1: z[3] })); return ok(b) ? [b.x0, b.z0, b.x1, b.z1, ...z.slice(4)] : null; }).filter(Boolean);
  const units = src.units ? src.units.map(u => { const b = clip(followBox(S0, g, u)); return ok(b) ? { ...u, ...b } : null; }).filter(Boolean) : null;
  r.layout = { name: src.name || '', items: r.layout.items, walls: r.layout.walls, zones, ...(src.venue ? { venue: src.venue } : {}), ...(units && units.length ? { units } : {}) };
  return r;
}
/** The floors of a plan that need a choice: kept without their misfits, or generated again. */
export const conflictGroups = plan => plan.groups.filter(G => !G.regen && (G.remove.length || !G.keepOk));
const plural = n => {
  const m = /^(.*?)(\s*\([^)]*\))$/.exec(n);   // "café table (2)" → "café tables (2)"
  if (m) return plural(m[1]) + m[2];
  return /(s|sh|ch|x|z)$/.test(n) ? `${n}es` : /[^aeiou]y$/.test(n) ? `${n.slice(0, -1)}ies` : /(shelf|leaf)$/.test(n) ? `${n.slice(0, -1)}ves` : `${n}s`;
};
/** "the sofa, 2 vanity sinks and 3 more" for a floor's misfits. */
export function piecesWords(remove, max = 3) {
  const count = new Map();
  for (const r of remove) count.set(r.name, (count.get(r.name) || 0) + 1);
  const names = [...count].map(([n, k]) => (k > 1 ? `${k} ${plural(n)}` : `the ${n}`));
  const head = names.slice(0, max), more = [...count].slice(max).reduce((a, [, k]) => a + k, 0);
  if (more > 0) return `${head.join(', ')} and ${more} more`;
  return head.length > 1 ? `${head.slice(0, -1).join(', ')} and ${head.at(-1)}` : head[0] || '';
}
/** The plan in one line for someone resizing B (the place tool's bar, the server's refusal). */
export function planWords(B, plan) {
  if (plan.why) return plan.why;
  const C = conflictGroups(plan);
  if (C.length) {
    const n = plan.remove, fl = floorsName(B, C.flatMap(G => G.floors));
    const head = `${fl[0].toUpperCase()}${fl.slice(1)} ${C.length > 1 || C[0].floors.length > 1 ? 'were' : 'was'} changed by hand`;
    if (!n) return `${head} and would be blocked by its walls`;
    return `${head}: ${n} piece${n > 1 ? 's' : ''} ${n > 1 ? "don't" : "doesn't"} fit the new size (${piecesWords(C.flatMap(G => G.remove))})`;
  }
  const R = plan.groups.filter(G => G.regen);
  if (R.length) return `${(t => `${t[0].toUpperCase()}${t.slice(1)}`)(floorsName(B, R.flatMap(G => G.floors)))} will be laid out again for the new size`;
  return '';
}

function segHitsRect(s, r) {
  const n = Math.max(2, Math.ceil(Math.hypot(s[2] - s[0], s[3] - s[1]) / 0.25));
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = s[0] + (s[2] - s[0]) * t, z = s[1] + (s[3] - s[1]) * t;
    if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
  }
  return false;
}
/** Straight walkways from each entrance to the sidewalk walking band. */
export function accessSegments(g, b) {
  const blk = b.block !== undefined ? blockIJ(g, b.block) : blockAt(g, b.x, b.z);
  if (!blk) return [];
  const segs = [];
  const add = (out, side) => {
    const o = toWorld(b, out.x, out.z), bp = bandPoint(g, blk.i, blk.j, side, o.x, o.z);
    segs.push([o.x, o.z, bp.x, bp.z]);
  };
  if (b.type === 'park') {
    const r = (b.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    for (const gp of gatePoints(b)) {
      const n = [[0, 1], [1, 0], [0, -1], [-1, 0]][gp.k], nx = n[0] * c + n[1] * s, nz = -n[0] * s + n[1] * c;
      add(gp.outside, Math.abs(nz) > Math.abs(nx) ? (nz > 0 ? 0 : 2) : (nx > 0 ? 1 : 3));
    }
  } else add(doorPoints(b).outside, rotToSide(b.rot || 0));
  return segs;
}
export function normalizeSpec(spec, world = null) {
  const type = BUILD_TYPES.includes(spec.type) ? spec.type : 'office';
  // In the city buildings sit square to its grid; beyond it (world given) they turn to face their road, to 0.1°,
  // placed to the centimetre.
  const g = world ? makeGrid(world.grid) : null, sx = +spec.x || 0, sz = +spec.z || 0;
  const free = !!g && (sx < g.minX || sx > g.maxX || sz < g.minZ || sz > g.maxZ);
  const rot = free ? (((Math.round((+spec.rot || 0) * 10) % 3600) + 3600) % 3600) / 10 : ((Math.round((+spec.rot || 0) / 90) * 90) % 360 + 360) % 360;
  const minW = type === 'park' ? 14 : type === 'apartment' ? 13 : 10;
  const w = Math.max(minW, Math.min(60, Math.round((+spec.w || 16) * 2) / 2));
  const d = Math.max(type === 'apartment' ? 17 : 10, Math.min(50, Math.round((+spec.d || 16) * 2) / 2));
  let floors = Math.round(+spec.floors || 1);
  if (type === 'park') floors = 1;
  floors = Math.max(1, Math.min(type === 'office' || type === 'apartment' ? MAX_FLOORS : 4, floors));
  const style = BUILD_STYLES.includes(spec.style) ? spec.style : 'modern';
  const q = free ? 100 : 2;
  return { type, rot, w, d, floors, style, x: Math.round(sx * q) / q, z: Math.round(sz * q) / q };
}
/** Returns null when a new building (normalized spec) fits, else a reason. */
export function checkBuilding(world, spec, ignoreIdx = -1) {
  const g = makeGrid(world.grid);
  if (![spec.x, spec.z, spec.w, spec.d].every(Number.isFinite)) return 'Bad position';
  const fp = footprint(spec);
  const blk = blockAt(g, spec.x, spec.z);
  if (!blk) return 'Place it on a city block, not on a street';
  const lot = lotRect(g, blk.i, blk.j);
  if (fp.x0 < lot.x0 - 0.01 || fp.x1 > lot.x1 + 0.01 || fp.z0 < lot.z0 - 0.01 || fp.z1 > lot.z1 + 0.01) return 'Keep it off the sidewalk';
  const specB = { ...spec, block: blk.bi };
  const mine = accessSegments(g, specB);
  const myPad = footprint(spec, 0.3);
  for (const o of world.buildings) {
    if (o.gone || o.idx === ignoreIdx) continue;
    if (rectsOverlap(fp, footprint(o, 1.0), 0)) return `Too close to ${o.name}`;
    const ofp = footprint(o, 0.3);
    for (const s of mine) if (segHitsRect(s, ofp)) return `${o.name} blocks the entrance`;
    for (const s of accessSegments(g, o)) if (segHitsRect(s, myPad)) return `Blocks the entrance of ${o.name}`;
  }
  for (const d of world.decorations || []) if (d.x > fp.x0 - 0.3 && d.x < fp.x1 + 0.3 && d.z > fp.z0 - 0.3 && d.z < fp.z1 + 0.3) return `A ${(CATALOG[d.t]?.name || 'decoration').toLowerCase()} is in the way; move it first`;
  return null;
}
