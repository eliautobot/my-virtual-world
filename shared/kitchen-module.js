// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Kitchen, an interior module (shared/interior-modules.js; PLAN-RESTAURANT-GAME.md 6b K2, the product owner
// 2026-10-27: "should we make it like a placeable kitchen module? ... depending on the restaurants needs maybe it needs to
// be bigger or smaller", then "lets do free kitchens for now"): where Order Up is played. It goes only where food or
// drink is served (shared/edit.js kitchenFloor: cafés, restaurants, lounges, night clubs, arcades), one to a floor, in
// three sizes, free; an owner places it on their own floors, administrators anywhere. Café floors get one laid with them
// (server/world/layouts.js cafeKitchen), a record like any other, so it moves, resizes and goes the same way.
//
// Laid out in its own frame: u along its back wall, v from the back wall to its front, the side its door is on (the
// record's face). The front wall has the door at the inner end and the hatch the pass stands in; the pass reaches out
// into the dining room, so the module's rectangle takes a strip in front of the wall (PASS_BAND) as well. Its stations
// are its template's (shared/orderup/kitchens.js: rec.data.kitchen, the café's coffee kitchen for now), each in the
// first row of its liking with room: the back wall from the inner end, the outer side wall, the front wall either side
// of the hatch, an island down the middle of a deep kitchen. The outer end (rec.data.side, +1: +u) is the one against
// the building's wall when one is.
import { registerInteriorKind } from './interior-modules.js';
import { CATALOG } from './catalog.js';
import { itemAABB } from './geom.js';
import { interiorBounds, kitchenFloor, KITCHEN_WHY, KITCHEN_PIECE } from './edit.js';
import { kitchenOf, DEFAULT_KITCHEN } from './orderup/kitchens.js';
import { APPLIANCES, menuNeeds } from './appliances.js';
import { CUISINE_OF, guessCuisine, FOOD_VENUES } from './food.js';
import { DRINKS } from './nightlife.js';
import { themeOf } from './floor-themes.js';

const IW = 0.06, H = Math.PI / 2, P = Math.PI;   // (an interior wall's half thickness, as server/world/layouts.js)
/** The strip in front of the kitchen's front wall that is the module's own: the pass reaches out over it. */
export const PASS_BAND = 0.4;
/** The kitchen's named sizes, its rectangle (the room and the strip in front of it). */
/** What a kitchen's menu needs (shared/appliances.js): appliance key -> how many of its items need it (rec.data.needs). */
export const kitchenNeeds = ids => Object.fromEntries(menuNeeds(ids || []));
/** The menu a floor's place sells as it comes (no business yet: a new floor, a test): its cuisine's usual menu, a night
 *  out's drinks; null when it serves none. */
export function placeMenu(L) {
  const venue = themeOf(L?.theme)?.venue || L?.venue;
  if (FOOD_VENUES.has(venue)) return CUISINE_OF[guessCuisine(L?.name || '', venue)]?.menu || null;
  return DRINKS[venue] ? [...DRINKS[venue]] : null;
}
// (every kitchen has somewhere to plate, wash, bin and set things down, whatever its menu)
const ALWAYS = new Set(['ou_plating', 'ou_sink', 'ou_dishes', 'ou_bin', 'ou_prep']);
// (a deep kitchen's back of house, on its walls; its other stations: near the pass, in this order of rows)
const BACK = new Set(['ou_fridge', 'ou_pantry', 'ou_sink', 'ou_dishes', 'ou_pizza_oven', 'ou_wine', 'ou_bin']), NEAR = 'island front door side back';
export const KITCHEN_SIZES = Object.freeze([   // (named sizes: any size between them goes too, on half-metre steps)
  { id: 'small', label: 'Small', w: 4.5, d: 4 },
  { id: 'medium', label: 'Medium', w: 6.5, d: 4 },
  { id: 'large', label: 'Large', w: 8.5, d: 5 },
  { id: 'xl', label: 'Extra large', w: 12, d: 8 },
]);

/**
 * Kitchen rec ({ x0, z0, x1, z1, face, data: { side, kitchen, needs } } in B's frame) laid out: { items, walls, zones } in
 * the building frame (items without ids; walls [x1, z1, x2, z2, kind]; zones [x0, z0, x1, z1, floor]). Its stations are
 * what its menu needs (data.needs: the product owner 2026-10-28, "to add fries to the menu, you will need a fryer"; none
 * given: all of its template's), then more of the most needed while there is room. opts.only: just a place for one more
 * piece of type `only` among the pieces already there (opts.taken, the building frame): "Add to the kitchen".
 */
export function kitchenLayout(B, rec, opts = {}) {
  // (its template's order first, which keeps every station within reach; a kitchen too small for all its menu needs is
  // laid out again with the menu's own and the plating counter first, the sink, the dish return and the bin after)
  if (rec.data?.needs && !opts.only && opts.prio == null) {
    const plain = kitchenLayout(B, rec, { ...opts, prio: false });
    const got = new Set(plain.items.map(i => i.t)), K0 = kitchenOf(rec.data?.kitchen || DEFAULT_KITCHEN), can = new Set([...(K0.place || []), ...(K0.byMenu || [])].map(p => p[0]));
    const short = Object.keys(rec.data.needs).map(k => APPLIANCES[k]?.piece).filter(t => t && can.has(t) && !got.has(t));
    return short.length ? kitchenLayout(B, rec, { ...opts, prio: true }) : plain;
  }
  const { x0, z0, x1, z1 } = rec, face = rec.face || 0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const n = [[0, 1], [1, 0], [0, -1], [-1, 0]][face], uA = [n[1], -n[0]];
  const W = face % 2 ? z1 - z0 : x1 - x0, D = face % 2 ? x1 - x0 : z1 - z0, Dr = D - PASS_BAND;   // (Dr: the room's depth)
  const at = (u, v) => ({ x: cx + uA[0] * u + n[0] * (v - D / 2), z: cz + uA[1] * u + n[1] * (v - D / 2) });
  const toDoor = Math.atan2(n[0], n[1]);
  // the sides along the building's outer walls (no wall of its own there)
  const ib = interiorBounds(B), near = (a, b) => Math.abs(a - b) < 0.06;
  const onOuter = (u, v) => { const p = at(u, v); return near(p.x, ib.x0) || near(p.x, ib.x1) || near(p.z, ib.z0) || near(p.z, ib.z1); };
  const atPlus = onOuter(W / 2, Dr / 2), atMinus = onOuter(-W / 2, Dr / 2), atBack = onOuter(0, 0);
  const side = rec.data?.side === 1 || rec.data?.side === -1 ? rec.data.side : atMinus && !atPlus ? -1 : 1;
  const inner = -side * W / 2, outer = side * W / 2, mid = inner + side * (W >= 7 ? 3.6 : 2.9);   // (the hatch a set way from the inner wall, past the door)
  const K = kitchenOf(rec.data?.kitchen || DEFAULT_KITCHEN);

  // its walls, in its frame
  const lw = [], wall = (a, b, c, d) => { if (Math.hypot(c - a, d - b) >= 0.25) lw.push([a, b, c, d]); };
  const gaps = [[mid - 0.95, mid + 0.95], [Math.min(inner + side * 0.35, inner + side * 1.45), Math.max(inner + side * 0.35, inner + side * 1.45)]].sort((a, b) => a[0] - b[0]);
  let u = -W / 2;
  for (const [g0, g1] of gaps) { if (g0 - u > 0.25) wall(u, Dr, g0, Dr); u = g1; }
  if (W / 2 - u > 0.25) wall(u, Dr, W / 2, Dr);
  if (!(side > 0 ? atMinus : atPlus)) wall(inner, 0, inner, Dr);
  if (!(side > 0 ? atPlus : atMinus)) wall(outer, 0, outer, Dr);
  if (!atBack) wall(-W / 2, 0, W / 2, 0);

  // its pieces, in its frame (r: 0 faces the front), clear of each other and of its walls, inside its rectangle
  const pieces = [], boxes = [], bands = lw.map(([a, b, c, d]) => ({ x0: Math.min(a, c) - IW, z0: Math.min(b, d) - IW, x1: Math.max(a, c) + IW, z1: Math.max(b, d) + IW }));
  for (const it of opts.taken || []) {   // (pieces already there, into its frame)
    const def = CATALOG[it.t]; if (!def || def.block === false) continue;
    const dx = it.x - cx, dz = it.z - cz;
    boxes.push(itemAABB({ x: dx * uA[0] + dz * uA[1], z: dx * n[0] + dz * n[1] + D / 2, r: (it.r || 0) - toDoor }, def.rect));
  }
  const free = (bb, pad) => boxes.every(r => !(bb.x0 < r.x1 + pad && bb.x1 > r.x0 - pad && bb.z0 < r.z1 + pad && bb.z1 > r.z0 - pad))
    && bands.every(r => !(bb.x0 < r.x1 - 0.004 && bb.x1 > r.x0 + 0.004 && bb.z0 < r.z1 - 0.004 && bb.z1 > r.z0 + 0.004));
  const add = (t, pu, pv, r = 0, pad = 0.05) => {
    const def = CATALOG[t]; if (!def) return null;
    const it = { t, x: pu, z: pv, r }, bb = itemAABB(it, def.rect);
    if (bb.x0 < -W / 2 - 1e-6 || bb.x1 > W / 2 + 1e-6 || bb.z0 < -1e-6 || bb.z1 > D + 1e-6) return null;
    if (def.block !== false && !free(bb, pad)) return null;
    pieces.push(it); if (def.block !== false) boxes.push(bb);
    return it;
  };
  // (a piece with its back to a wall: axis 'v', a wall along u at v = line; 'u', a wall along v at u = line)
  const against = (t, axis, line, inward, pos, gap = 0.03) => {
    const def = CATALOG[t]; if (!def) return null;
    const off = inward * (gap - def.rect[1]);
    return axis === 'v' ? add(t, pos, line + off, inward > 0 ? 0 : P) : add(t, line + off, pos, inward > 0 ? H : -H);
  };
  const wOf = t => CATALOG[t].rect[2] - CATALOG[t].rect[0];
  // a deep kitchen (2026-10-28: an arcade's 12 x 7 m had every machine along its walls, its middle empty, its cook walking
  // 37 m a dish): its work stations near the pass, on the island nearest it first, then the front wall, the side wall from
  // its front end; its storage, its sink and dish return, the pizza oven and the bin keep to their walls at the back
  const deep = Dr >= 5;
  // four rows, each laid from a fixed end (the inner wall, the hatch, the back corner: they keep their places when the
  // kitchen is a metre wider); each station takes the first row of its liking with room
  const line = (from, to, dir, fit) => ({ at: from, try(t) {
    const w = wOf(t);
    // (adding one among pieces already there: the first gap along the row it fits in)
    for (let a = this.at; ; a += dir * 0.1) {
      const c = a + dir * (w / 2 + 0.07);
      if ((c + dir * w / 2 - to) * dir > 1e-6) return null;
      const it = fit(t, c); if (it) { this.at = c + dir * (w / 2 + 0.07); return it; }
      if (!opts.only) return null;
    }
  } });
  const rows = {
    back: line(inner + side * 0.1, outer - side * 1.0, side, (t, x) => against(t, 'v', 0, 1, x, atBack ? 0.03 : 0.1)),   // (off a wall of its own: clear of it)   // (short of the corner: the outer wall's stations start there)
    // (a deep kitchen's from its front end: clear of the front wall's stations and the room to stand at them)
    side: deep ? line(Dr - 1.7, 0.75, -1, (t, z) => against(t, 'u', outer, -side, z, 0.16)) : line(0.75, Dr - 0.06, 1, (t, z) => against(t, 'u', outer, -side, z, 0.16)),
    front: line(mid + side * 0.95, outer - side * (opts.prio ? 1.9 : 1.5), side, (t, x) => against(t, 'v', Dr, -1, x, 0.16)),   // (room left to stand at the outer wall's; more when the menu's stations come first: they fill it)
    door: line(mid - side * 0.95, inner + side * 1.5, -side, (t, x) => against(t, 'v', Dr, -1, x, 0.16)),
    // a deep kitchen's island: down the middle, facing the pass, clear of the door's way and of the outer wall's stations
    // islands: one down the middle of a deep kitchen, more in a deeper one (1.9 m apart: a walkway between them)
    island: (() => {
      const lines = [];
      for (let v = 2.1; v <= Dr - 2.25 + 1e-6; v += 1.9) lines.push(line(inner + side * 1.7, outer - side * 1.75, side, (t, x) => add(t, x, v, 0)));
      if (deep) lines.reverse();   // (the one nearest the pass first)
      return { try: t => { for (const l of lines) { const it = l.try(t); if (it) return it; } return null; } };
    })(),
  };
  // which stations: its menu's (and every kitchen's own), else all of its template's; then more of them as there is room:
  // the menu's most needed first, one more for every three of its items that need it (storage: every eight)
  const needs = rec.data?.needs && typeof rec.data.needs === 'object' ? rec.data.needs : null;
  let place = K.place || [], more = (K.more || []).map(([t, l]) => [t, l, Infinity]);
  if (needs) {
    const want = new Set(Object.keys(needs).map(k => APPLIANCES[k]?.piece).filter(Boolean));
    const extra = (K.byMenu || []).filter(([t]) => want.has(t));   // (the tea station, the fryer …: only for a menu that needs them)
    if (opts.prio) { const mine = ([t]) => want.has(t) || t === 'ou_plating'; place = [...place.filter(mine), ...extra, ...place.filter(p => !mine(p) && ALWAYS.has(p[0]))]; }
    else place = [...place.filter(([t]) => ALWAYS.has(t) || want.has(t)), ...extra];
    more = Object.entries(needs).map(([k, c]) => [APPLIANCES[k]?.piece, c, APPLIANCES[k]?.store ? 8 : 3]).filter(([t]) => t && place.some(p => p[0] === t)).sort((a, b) => b[1] / b[2] - a[1] / a[2])
      .map(([t, c, per]) => [t, `${place.find(p => p[0] === t)[1]} island`, Math.floor(c / per)]);
  }
  if (opts.only) { const p = [...(K.place || []), ...(K.byMenu || [])].find(([t]) => t === opts.only); place = [[opts.only, `${p ? p[1] : 'back side front door'} island`]]; more = []; }
  const got = new Set(), extra = new Map(), likesOf = (t, likes) => (deep && !opts.only && !BACK.has(t) ? NEAR : likes).split(' ');
  for (const [t, likes, after] of place) {
    if (after && !got.has(after) && !opts.only) continue;
    for (const r of likesOf(t, likes)) if (rows[r]?.try(t)) { got.add(t); break; }
  }
  // a bigger kitchen: more of its appliances, round after round while there is room (more cooks at once)
  for (let round = 0, again = true; again && round < 8; round++) {
    again = false;
    for (const [t, likes, cap] of more) {
      if ((extra.get(t) || 0) >= cap) continue;
      for (const r of likesOf(t, likes)) if (rows[r]?.try(t)) { extra.set(t, (extra.get(t) || 0) + 1); again = true; break; }
    }
  }
  if (!opts.only) {
    if (add('ou_pass', mid, Dr, 0, 0)) add('ou_rail', mid, Dr - 0.32, P);
    against('ou_extinguisher', 'u', inner, side, Dr - 0.75, 0.12);
  }

  // to the building's frame
  const items = pieces.map(it => ({ t: it.t, ...at(it.x, it.z), r: it.r + toDoor }));
  const walls = lw.map(([a, b, c, d]) => { const p = at(a, b), q = at(c, d); return [p.x, p.z, q.x, q.z, 0]; });
  const q = [at(-W / 2, 0), at(W / 2, Dr)];
  const zones = [[Math.min(q[0].x, q[1].x), Math.min(q[0].z, q[1].z), Math.max(q[0].x, q[1].x), Math.max(q[0].z, q[1].z), 'tile']];
  return { items, walls, zones, side };
}

/** The pieces kitchen rec's menu wants (and every kitchen's own) that it has no room for, laid out as it is. */
export function kitchenShort(B, rec) {
  const needs = rec.data?.needs; if (!needs) return [];
  const K = kitchenOf(rec.data?.kitchen || DEFAULT_KITCHEN), can = new Set([...(K.place || []), ...(K.byMenu || [])].map(p => p[0]));
  const want = [...ALWAYS, ...Object.keys(needs).map(k => APPLIANCES[k]?.piece).filter(Boolean)].filter(t => can.has(t));
  const got = new Set(kitchenLayout(B, rec).items.map(i => i.t));
  return [...new Set(want)].filter(t => !got.has(t));
}
/** Why kitchen rec can't face the way it does: its front (the door and the pass) against the building's wall, or too
 *  close to it to stand at the pass; else null. */
export function kitchenFacing(B, rec) {
  const ib = interiorBounds(B), gap = [ib.z1 - rec.z1, ib.x1 - rec.x1, rec.z0 - ib.z0, rec.x0 - ib.x0][rec.face || 0];
  return gap < 0.8 ? 'Its door and pass face the building\'s wall: turn it (R) or move it out from the wall' : null;
}

export const KITCHEN = registerInteriorKind({
  kind: 'kitchen', label: 'Kitchen', icon: '🍳', who: 'owner', price: 0, play: null, perFloor: 1,
  wall: false,   // (its own walls: the front has a door and the hatch for the pass, kitchenLayout)
  // (its stations move as you like and new appliances placed inside join it: the product owner 2026-10-27, "i want the
  // option to move things around as preferred"; then it is arranged by hand: a resize or a turn asks first)
  joins: t => KITCHEN_PIECE(t),
  check: (B, f, L, rec) => kitchenFacing(B, rec),
  blurb: 'Order Up\'s kitchen: cook and serve together in a Rush. Its stations and menu are its kind of place\'s (a café\'s coffee kitchen for now). From 4.4 × 4 m up to 16 × 12 m: a bigger one fits more appliances, for more cooks at once. Move its stations as you like.',
  // any size from a small coffee bar to a big kitchen on a step (the product owner 2026-10-27: "kitchens can be made
  // bigger with more appliances as needed"); it starts as a Medium one
  size: { min: [4.4, 4.0], max: [16, 12], step: 0.5, start: [KITCHEN_SIZES[1].w, KITCHEN_SIZES[1].d] },
  allowed: (B, f, L) => (kitchenFloor(B, f, L) ? null : KITCHEN_WHY),
  fill(B, f, L, rec) { const { items, walls, zones } = kitchenLayout(B, rec); return { items, walls, zones }; },
  // its stations from its place's menu (the business's, else what the place sells as it comes), laid out with them
  prepare(rec, { B, f, L, menuAt }) { const ids = menuAt?.(B.idx, f) || placeMenu(L); if (ids) rec.data = { ...(rec.data || {}), needs: kitchenNeeds(ids), menu: [...ids] }; },   // (menu: what its Rushes order)
  // one more appliance where there is room among its pieces ("Add to the kitchen")
  fit(B, f, L, rec, t) { return kitchenLayout(B, rec, { only: t, taken: (L.items || []).filter(it => it.mod === rec.id) }).items[0] || null; },
});
