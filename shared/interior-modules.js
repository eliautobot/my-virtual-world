// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Interior modules (2026-10-27, the product owner: "the 'modules' system should work the same for all type of inside
// spaces that will have unique playable or unique functions"; first asked for the radio studios: "studio modules ...
// placeable and resizeable"): a room with a purpose laid on a floor as one unit — a radio studio (a station is broadcast
// from it), a restaurant's kitchen (Order Up), later a bar, a snack bar … — placed, moved, resized and removed as one,
// with undo, like world modules outdoors (shared/world-modules.js; docs/features/play-modules.md).
//
// A module is a record on its floor's layout: L.mods = [{ id, kind, name, x0, z0, x1, z1, face, data }] in the
// building's own frame (face: the side its door is on: 0 +z, 1 +x, 2 −z, 3 −x). What it lays — its walls, its floor
// area, its pieces — is tagged with its id (an item's it.mod, a wall's sixth element) so a move, a resize or a removal
// takes exactly its own away and lays them again. The same rules run in the browser's ghost and on the server (the edit
// ops imod.add / imod.set / imod.del: server/world/edit.js).
//
// Each kind registers itself (registerInteriorKind):
//   kind, label, icon, blurb
//   who        'admin' (administrators only) or 'owner' (an owner on their own floors, administrators anywhere)
//   price      Virtual Coin to place one; 0: free (2026-10-27: kitchens free for now; buying comes later)
//   play       the play module it runs (shared/play.js registerPlay id: its ranks, levels and badges), or null for a
//              module with a function of its own and no game (a studio)
//   size       { min: [w, d], max: [w, d], step } for a free size, or { sizes: [{ id, label, w, d }] } to snap to
//   perFloor   at most this many on one floor
//   allowed(B, f, L)        → why it can't go on this floor, or null
//   fill(B, f, L, rec)      → { items: [...], walls?: [...], zones?: [...] } in the building frame, inside the rect
//   wall       whether it is walled off (its own walls on the sides that are not the building's outer walls)
//   joins(t)   a piece of type t placed or moved inside it becomes its own (optional: a kitchen's appliances)
//   prepare(rec, { B, f, L, menuAt })  before it is laid out anew: what it holds from its place (optional: a kitchen's
//              stations from its business's menu, menuAt(b, f) -> item ids)
//   fit(B, f, L, rec, t)  where one more piece of type t goes among its own, or null (optional: imod.piece)
// Arranged by hand (the product owner 2026-10-27, kitchens: "i want the option to move things around as preferred and
// save the applied layout ... if you resize it will reset the current manual adjusted layout"): when its own pieces are
// moved or taken away, or a piece joins it, its record is marked `custom`; moving it then carries its pieces along
// (shiftModule), and a resize or a turn lays it out again only when asked to (o.reset: the tool asks first).
//   locked     its pieces are changed only as the whole module (item.* ops refuse them): a kitchen's fixed stations
//   check(B, f, L, rec)     → its own rule for this record (optional), or null
// A client asks a floor's module records what is playable or what runs there (modsAt), never a marker piece.
import { CATALOG } from './catalog.js';
import { interiorBounds, keepClear, levelConnected } from './edit.js';
import { doorway } from './walls.js';
import { itemAABB, rectsOverlap } from './geom.js';

export const INTERIOR_KINDS = {};
const r2 = v => Math.round(v * 100) / 100;
/** Adds a kind of interior module (see the header). */
export function registerInteriorKind(def) {
  if (!def?.kind || INTERIOR_KINDS[def.kind]) throw new Error(`interior module kind ${def?.kind}: missing or taken`);
  if (!def.fill || !def.allowed || !def.size) throw new Error(`interior module kind ${def.kind}: needs fill, allowed and size`);
  if (!(def.price >= 0)) throw new Error(`interior module kind ${def.kind}: a price of 0 (free) or more`);
  INTERIOR_KINDS[def.kind] = Object.freeze({ who: 'owner', perFloor: 1, wall: true, play: null, icon: '🧩', blurb: '', locked: false, ...def });
  return INTERIOR_KINDS[def.kind];
}
export const modsOf = L => L?.mods || [];
/** The modules on a floor that run a play module or a function: [{ rec, kind }] (what a client looks for). */
export function modsAt(L) { return modsOf(L).filter(m => INTERIOR_KINDS[m.kind]).map(m => ({ rec: m, kind: INTERIOR_KINDS[m.kind] })); }
/** A module's rectangle in the building frame. */
export const rectOf = m => ({ x0: m.x0, z0: m.z0, x1: m.x1, z1: m.z1 });
/** The module on layout L whose rectangle holds point (x, z), or null. */
export const modAt = (L, x, z) => modsOf(L).find(m => x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1) || null;
/** Floor layout L with module prev moved to rec's rectangle (the same size and side): its own pieces, walls and floor
 *  areas carried along as they are, the record replaced (a copy). An arrangement by hand stays as it was made. */
export function shiftModule(L, prev, rec) {
  const dx = rec.x0 - prev.x0, dz = rec.z0 - prev.z0, out = JSON.parse(JSON.stringify(L)), id = prev.id;
  for (const it of out.items || []) if (it.mod === id) { it.x = r2(it.x + dx); it.z = r2(it.z + dz); }
  for (const w of out.walls || []) if (w[5] === id) { w[0] = r2(w[0] + dx); w[1] = r2(w[1] + dz); w[2] = r2(w[2] + dx); w[3] = r2(w[3] + dz); }
  for (const z of out.zones || []) if (z[5] === id) { z[0] = r2(z[0] + dx); z[1] = r2(z[1] + dz); z[2] = r2(z[2] + dx); z[3] = r2(z[3] + dz); }
  out.mods = modsOf(out).map(m => (m.id === id ? rec : m));
  return out;
}

/** A module record from a request: { kind, name, x0, z0, x1, z1, face, data }, its size snapped (or an Error). */
export function normalizeModule(o, prev = null) {
  const K = INTERIOR_KINDS[o?.kind ?? prev?.kind];
  if (!K) return new Error('Unknown kind of interior module');
  const n = k => Number(o?.[k] ?? prev?.[k]);
  let x0 = n('x0'), z0 = n('z0'), x1 = n('x1'), z1 = n('z1');
  // a change that sends no new rect (a rename, a turn) keeps its size as it is, never snapped (a generated module's own size)
  // (or one that sends the size it has: a move; a generated module's size isn't one of the steps)
  if (![x0, z0, x1, z1].every(Number.isFinite)) return new Error('Bad position');
  if (x1 < x0) [x0, x1] = [x1, x0]; if (z1 < z0) [z0, z1] = [z1, z0];
  // its size: one of the kind's sizes (the nearest, centred where it was asked), or free within min..max on the step
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let w = x1 - x0, d = z1 - z0;
  const keep = prev && (!['x0', 'z0', 'x1', 'z1'].some(k => o?.[k] != null) || (Math.abs(w - (prev.x1 - prev.x0)) < 0.01 && Math.abs(d - (prev.z1 - prev.z0)) < 0.01));
  const S = K.size;
  if (keep) { /* as it is */ } else if (S.sizes?.length) {
    const fits = S.sizes.flatMap(s => [{ s, w: s.w, d: s.d }, { s, w: s.d, d: s.w }]);
    const best = fits.reduce((a, b) => (Math.abs(b.w - w) + Math.abs(b.d - d) < Math.abs(a.w - w) + Math.abs(a.d - d) ? b : a));
    w = best.w; d = best.d;
  } else {
    const st = S.step || 0.25, lo = Math.min(...S.min), hi = Math.max(...S.max), q = v => Math.round(v / st) * st;
    w = q(Math.max(lo, Math.min(hi, w))); d = q(Math.max(lo, Math.min(hi, d)));
  }
  const face = [0, 1, 2, 3].includes(Number(o?.face ?? prev?.face)) ? Number(o?.face ?? prev?.face) : 0;
  const name = String(o?.name ?? prev?.name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  const data = o?.data && typeof o.data === 'object' ? JSON.parse(JSON.stringify(o.data)) : (prev?.data || {});
  return { kind: K.kind, name, x0: r2(cx - w / 2), z0: r2(cz - d / 2), x1: r2(cx + w / 2), z1: r2(cz + d / 2), face, data };
}
/** The size limits of a kind, as words (the ghost shows them). */
export function sizeWords(K) {
  if (K.size.sizes?.length) return K.size.sizes.map(s => `${s.label} ${s.w} × ${s.d} m`).join(', ');
  return `${K.size.min[0]} × ${K.size.min[1]} m to ${K.size.max[0]} × ${K.size.max[1]} m`;
}
/** Why module rec can't stand on floor f of building B (layout L), or null. ignoreId: the module being moved or resized. */
export function checkModule(B, f, L, rec, ignoreId = null) {
  const K = INTERIOR_KINDS[rec.kind]; if (!K) return 'Unknown kind of interior module';
  const no = K.allowed(B, f, L); if (no) return no;
  const ck = K.check?.(B, f, L, rec); if (ck) return ck;   // (its kind's own rule for this record: a kitchen's pass not facing a wall …)
  const ib = interiorBounds(B), r = rectOf(rec);
  if (r.x0 < ib.x0 - 0.01 || r.x1 > ib.x1 + 0.01 || r.z0 < ib.z0 - 0.01 || r.z1 > ib.z1 + 0.01) return 'It runs outside the floor';
  const W = r.x1 - r.x0, D = r.z1 - r.z0, S = K.size;
  // (3 cm to spare: a rectangle at the limit comes back from rounding its sides to the centimetre a centimetre smaller)
  if (!S.sizes?.length && (Math.min(W, D) < Math.min(...S.min) - 0.03 || Math.max(W, D) > Math.max(...S.max) + 0.03)) return `A ${K.label.toLowerCase()} is ${sizeWords(K)}`;
  const others = modsOf(L).filter(m => m.id !== ignoreId);
  if (others.filter(m => m.kind === rec.kind).length >= K.perFloor) return K.perFloor === 1 ? `This floor already has a ${K.label.toLowerCase()}` : `At most ${K.perFloor} ${K.label.toLowerCase()}s on a floor`;
  for (const m of others) if (rectsOverlap(r, rectOf(m), -0.01)) return `It overlaps ${m.name || `the ${INTERIOR_KINDS[m.kind]?.label.toLowerCase() || 'module'}`}`;
  for (const c of keepClear(B, f)) if (rectsOverlap(r, c, 0)) return `It blocks ${c.why}`;
  for (const it of L.items || []) {   // furniture not its own is in the way (it is moved first, never swallowed)
    if (it.mod === ignoreId && ignoreId) continue;
    const def = CATALOG[it.t]; if (!def || def.block === false) continue;
    if (rectsOverlap(r, itemAABB(it, def.rect), 0.02)) return def.fixed ? `It runs into the building's ${def.name.toLowerCase()}` : `The ${def.name.toLowerCase()} is in the way; move it first`;
  }
  for (const w of L.walls || []) {   // a wall of the floor's own may run along its edges, not across it
    if (ignoreId && w[5] === ignoreId) continue;
    if (crosses(w, r)) return 'A wall runs through it';
  }
  return null;
}
function crosses(w, r) {
  const pad = 0.12, x0 = r.x0 + pad, x1 = r.x1 - pad, z0 = r.z0 + pad, z1 = r.z1 - pad, L = Math.hypot(w[2] - w[0], w[3] - w[1]), n = Math.max(2, Math.ceil(L / 0.1));
  for (let k = 0; k <= n; k++) { const t = k / n, x = w[0] + (w[2] - w[0]) * t, z = w[1] + (w[3] - w[1]) * t; if (x > x0 && x < x1 && z > z0 && z < z1) return true; }
  return false;
}
/** A floor layout without module id's own walls, pieces and record (a copy). */
export function withoutModule(L, id) {
  const out = JSON.parse(JSON.stringify(L));
  out.items = (out.items || []).filter(it => it.mod !== id);
  out.walls = (out.walls || []).filter(w => w[5] !== id);
  out.zones = (out.zones || []).filter(z => z[5] !== id);
  out.mods = modsOf(out).filter(m => m.id !== id);
  if (!out.mods.length) delete out.mods;
  return out;
}
/** The walls a module gets: the sides of its rectangle that are not along the building's outer walls, a doorway in
 *  the middle of its face side (on a side along the outer wall: the next side round that has a wall). */
export function moduleWalls(B, rec) {
  const ib = interiorBounds(B), { x0, z0, x1, z1 } = rec, near = (a, b) => Math.abs(a - b) < 0.06;
  const sides = [[x0, z1, x1, z1, 0], [x1, z0, x1, z1, 0], [x0, z0, x1, z0, 0], [x0, z0, x0, z1, 0]];   // by face: +z, +x, −z, −x
  const outer = [near(z1, ib.z1), near(x1, ib.x1), near(z0, ib.z0), near(x0, ib.x0)];
  let door = rec.face; for (let k = 0; k < 4 && outer[door]; k++) door = (door + 1) % 4;
  const out = [];
  sides.forEach((s, k) => {
    if (outer[k]) return;
    const w = s.map(r2);
    if (k === door) out.push(...doorway(w, (w[0] + w[2]) / 2, (w[1] + w[3]) / 2, 1.1)); else out.push(w);
  });
  return out.map(w => [...w.slice(0, 5), rec.id]);
}
/** Where a module's door is (moduleWalls' rule): { side (0 +z, 1 +x, 2 −z, 3 −x), x, z (its middle, the building's
 *  frame), nx, nz (out of the module) }; its name sign hangs over it (render/studio-signs.js). */
export function moduleDoor(B, rec) {
  const ib = interiorBounds(B), { x0, z0, x1, z1 } = rec, near = (a, b) => Math.abs(a - b) < 0.06;
  const outer = [near(z1, ib.z1), near(x1, ib.x1), near(z0, ib.z0), near(x0, ib.x0)];
  let side = rec.face; for (let k = 0; k < 4 && outer[side]; k++) side = (side + 1) % 4;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  return [{ side, x: cx, z: z1, nx: 0, nz: 1 }, { side, x: x1, z: cz, nx: 1, nz: 0 }, { side, x: cx, z: z0, nx: 0, nz: -1 }, { side, x: x0, z: cz, nx: -1, nz: 0 }][side];
}
/**
 * Floor layout L with module rec laid on it (a copy): its old walls and pieces taken away (a move or a resize), its
 * walls (when its kind is walled) and its pieces laid again, each tagged with its id; the record kept. → { L } or
 * { why } when it would shut anyone or anything off or a piece doesn't fit.
 */
export function layModule(B, f, L, rec) {
  const K = INTERIOR_KINDS[rec.kind];
  const out = withoutModule(L, rec.id);
  if (K.wall) out.walls = [...(out.walls || []), ...moduleWalls(B, rec)];
  const got = K.fill(B, f, out, rec) || {};
  let nid = Math.max(out.nid || 0, L.nid || 0, ...(out.items || []).map(i => (i.id || 0) + 1), ...(L.items || []).map(i => (i.id || 0) + 1));
  // laid again (a resize, a turn, Lay out again): each new piece takes the id of the module's old piece of its kind, in
  // order, so whatever pointed at it stays (an agent posted at a seat of its desk, a radio station's hosts, a job there)
  const reuse = new Map();
  for (const it of L.items || []) if (it.mod === rec.id) { const q = reuse.get(it.t) || []; q.push(it.id); reuse.set(it.t, q); }
  for (const it of got.items || []) {
    if (!CATALOG[it.t]) return { why: `Unknown piece ${it.t}` };
    const bb = itemAABB({ ...it, r: it.r || 0 }, CATALOG[it.t].rect);
    if (bb.x0 < rec.x0 - 0.05 || bb.x1 > rec.x1 + 0.05 || bb.z0 < rec.z0 - 0.05 || bb.z1 > rec.z1 + 0.05) continue;   // (a piece that doesn't fit this size is left out)
    const old = reuse.get(it.t)?.shift();
    out.items.push({ ...it, x: r2(it.x), z: r2(it.z), r: r2(it.r || 0), id: old ?? nid++, mod: rec.id });
  }
  out.nid = nid;
  for (const w of got.walls || []) out.walls.push([...w.slice(0, 5).map((v, i) => (i < 4 ? r2(v) : v)), rec.id]);
  for (const z of got.zones || []) (out.zones || (out.zones = [])).push([...z.slice(0, 5), rec.id]);
  out.mods = [...modsOf(out), rec];
  if (!levelConnected(B, f, out)) return { why: 'It would shut the way through off' };
  return { L: out };
}
