// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Signs in the world (2026-10-05): what stands where and which faces it shows. Three families:
// - Ad assets the administrators put up in the Marketing tools: billboards (standard or large, the pole centred or at
//   one end with the board overhanging) and street signs (lit "mupi" panels for sidewalks and parks); with the metro
//   stations' ad panels and the promotional aircraft they carry the paid ads (shared/ads.js). Each may have its own
//   content for the house's turns (a design with a link).
// - Owners' rooftop billboards (building settings, at most 2 per building, sized to the roof): the owner's own content,
//   never paid ads.
// - Signs inside buildings and parks (owners, furniture): standing or wall-hung, resizable, showing the owner's own
//   content (private) or paid ads (on the platform; the owner earns VC for them, and store credit when visitors open a
//   link from them).
// Every sign can be tapped (or reached in player mode) to see its design and open its link.
import { FLOOR_H, GROUND_Y, baseOf, SIGN_RIM } from './constants.js';
import { toWorld, bRot } from './geom.js';
import { normalizeAdCreative } from './ads.js';

const PI = Math.PI, H = PI / 2;

// ------------------------------------------------------------------ ad assets (administrators, Marketing)
/**
 * The kinds (each a decoration type, shared/decor.js): the face (w × h m, its centre y above the ground, x along the
 * board), the pole (x along the board, radius, top), the cabinet's half depth, the space its ads come from, the shape
 * they are painted in, and for overhanging boards the footprint on the ground (the pole's base).
 */
export const AD_ASSETS = Object.freeze({
  billboard: Object.freeze({ label: 'Billboard', size: 'standard', mount: 'centre', space: 'billboard', shape: 'wide', face: { w: 9.6, h: 3.2, y: 7.0 }, pole: { x: 0, r: 0.38, top: 5.25 }, half: 0.25 }),
  billboard_oh: Object.freeze({ label: 'Billboard (overhang)', size: 'standard', mount: 'overhang', space: 'billboard', shape: 'wide', face: { w: 9.6, h: 3.2, y: 7.0 }, pole: { x: 3.0, r: 0.38, top: 5.25 }, half: 0.25, base: [2.3, -0.7, 3.7, 0.7] }),
  billboard_xl: Object.freeze({ label: 'Large billboard', size: 'large', mount: 'centre', space: 'billboard', shape: 'wide', face: { w: 14.4, h: 4.8, y: 9.8 }, pole: { x: 0, r: 0.55, top: 7.25 }, half: 0.3 }),
  billboard_xl_oh: Object.freeze({ label: 'Large billboard (overhang)', size: 'large', mount: 'overhang', space: 'billboard', shape: 'wide', face: { w: 14.4, h: 4.8, y: 9.8 }, pole: { x: 4.6, r: 0.55, top: 7.25 }, half: 0.3, base: [3.7, -0.9, 5.5, 0.9] }),
  street_sign: Object.freeze({ label: 'Street sign', size: 'street', mount: 'post', space: 'street', shape: 'portrait', face: { w: 1.16, h: 1.74, y: 1.62 }, half: 0.16 }),
});
export const AD_ASSET_TYPES = Object.freeze(Object.keys(AD_ASSETS));
export const isAdAsset = t => Object.hasOwn(AD_ASSETS, t || '');
/** A billboard's type from its size ('standard' | 'large') and mount ('centre' | 'overhang'). */
export const billboardType = (size, mount) => `billboard${size === 'large' ? '_xl' : ''}${mount === 'overhang' ? '_oh' : ''}`;
/** An ad asset's two faces in its own frame: [{ x, y, z, w, h, yaw }] (front facing +z, back facing −z). */
export function adAssetFaces(t) {
  const A = AD_ASSETS[t]; if (!A) return [];
  const z = A.half + 0.022, f = A.face;
  return [{ x: 0, y: f.y, z, w: f.w, h: f.h, yaw: 0 }, { x: 0, y: f.y, z: -z, w: f.w, h: f.h, yaw: PI }];
}
/** The slot an ad asset's ads rotate in (shared/ads.js adFor). */
export const assetSlot = d => `${AD_ASSETS[d.t]?.space || 'billboard'}:${d.id}`;

// ------------------------------------------------------------------ the metro stations' ad panels
/** A panel on the outside of a station kiosk's back end (shared/stations.js frame: lx across, lz along). */
export const METRO_PANEL = Object.freeze({ lx: 0, lz: -2.02, y: 1.45, w: 1.1, h: 1.65 });
export const metroSlot = st => `metro:${st.id}`;
export const stationHasAds = st => !!st && st.ads !== false;

// ------------------------------------------------------------------ owners' rooftop billboards
export const ROOF_SIGN_MAX = 2;
export const ROOF_EDGES = Object.freeze(['front', 'back', 'left', 'right']);
export const ROOF_SIZES = Object.freeze({ s: 0.38, m: 0.58, l: 0.82 });
/** A building's rooftop billboards, checked: [{ edge, size, at (−1…1 along the edge), cr (design) }], at most 2. */
export function normalizeRoofSigns(list, { keep = [] } = {}) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list.slice(0, ROOF_SIGN_MAX)) {
    if (!s || typeof s !== 'object') continue;
    const cr = s.cr ? normalizeAdCreative(s.cr, { images: 'any' }) : null;
    const o = { edge: ROOF_EDGES.includes(s.edge) ? s.edge : 'front', size: Object.hasOwn(ROOF_SIZES, s.size) ? s.size : 'm', at: Math.max(-1, Math.min(1, Number(s.at) || 0)), cr: cr instanceof Error ? null : cr };
    const was = keep[out.length];
    if (was?.blocked) o.blocked = was.blocked;   // an administrator's hiding stays until an administrator lifts it
    out.push(o);
  }
  return out;
}
/**
 * A rooftop billboard's place on its building (building-local frame, metres): its centre (lx, lz) on the roof's edge,
 * the way its face looks (yaw: 0 front +z), its face (w × h), the legs' height and the roof's height.
 */
export function roofSignFrame(B, s) {
  const hw = B.w / 2, hd = B.d / 2, along = s.edge === 'front' || s.edge === 'back', L = along ? B.w : B.d;
  const w = Math.max(3, Math.min(24, L * (ROOF_SIZES[s.size] || 0.58))), h = w / 3, room = Math.max(0, L / 2 - w / 2 - 0.6), off = (s.at || 0) * room;
  const inset = 0.3;
  const P = { front: [off, hd - inset, 0], back: [-off, -hd + inset, PI], left: [-hw + inset, off, -H], right: [hw - inset, -off, H] }[s.edge] || [off, hd - inset, 0];
  return { lx: P[0], lz: P[1], yaw: P[2], w, h, legs: Math.min(2.2, 0.9 + h * 0.25), roof: B.floors * FLOOR_H };
}
/** Its face in the world: { x, y, z, yaw, w, h }. */
export function roofSignFace(B, s) {
  const F = roofSignFrame(B, s), p = toWorld(B, F.lx, F.lz);
  return { x: p.x, y: GROUND_Y + baseOf(B) + F.roof + F.legs + F.h / 2, z: p.z, yaw: bRot(B) + F.yaw, w: F.w, h: F.h };
}
export const roofSlot = (B, k) => `roof:${B.id}:${k}`;

/**
 * Where the stair (or lift) house stands on the roof: over its core, but always inside the parapet and clear of the owner's
 * rooftop billboards (2026-10-09: on a small building the core sits near an edge, and the house stood out over the parapet
 * and through a billboard). A billboard's frame, legs and braces reach BOARD_DEPTH in from its edge; the house steps back
 * from it along the edge's normal, then is held inside the roof again (the billboards win where a roof is too small).
 */
const BOARD_DEPTH = 1.5;
export function bulkheadAt(core, rx, rz, hw, hd, boards = []) {
  const keep = (v, lo, hi) => (lo > hi ? 0 : Math.max(lo, Math.min(hi, v)));
  const inside = (x, z) => ({ x: keep(x, -hw + rx + 0.45, hw - rx - 0.45), z: keep(z, -hd + rz + 0.45, hd - rz - 0.45) });
  let { x, z } = inside(core.x, core.z);
  for (const { sg, F } of boards) {
    const across = sg.edge === 'front' || sg.edge === 'back';
    if (across ? Math.abs(x - F.lx) >= rx + F.w / 2 + 0.3 : Math.abs(z - F.lz) >= rz + F.w / 2 + 0.3) continue;   // not behind this one
    if (sg.edge === 'front') z = Math.min(z, F.lz - BOARD_DEPTH - rz);
    else if (sg.edge === 'back') z = Math.max(z, F.lz + BOARD_DEPTH + rz);
    else if (sg.edge === 'left') x = Math.max(x, F.lx + BOARD_DEPTH + rx);
    else if (sg.edge === 'right') x = Math.min(x, F.lx - BOARD_DEPTH - rx);
  }
  return inside(x, z);
}

// ------------------------------------------------------------------ signs inside (owners' furniture)
/**
 * The kinds (furniture types, shared/catalog.js) and the face each starts with (w × h, m; a standing sign's y: its
 * centre above the floor; a wall sign's pivot: its centre's height). The face — the panel the design is on — takes
 * any width and height within `size` (2026-10-05: "the actual sign canvas to any size/aspect ratio, not the
 * entire sign being scaled"): a standing sign's base and post keep their size and its board's bottom its height, the
 * board growing up and to both sides; a wall sign grows round its centre, held between the floor and the ceiling.
 * Standing signs have two faces, wall signs one.
 */
export const INDOOR_SIGNS = Object.freeze({
  sign_stand: Object.freeze({ label: 'Standing sign', family: 'stand', face: { w: 0.6, h: 0.9, y: 1.05 }, two: true }),
  sign_stand_wide: Object.freeze({ label: 'Standing sign (wide)', family: 'stand', face: { w: 0.9, h: 0.6, y: 0.95 }, two: true }),
  sign_wall: Object.freeze({ label: 'Wall sign', family: 'wall', face: { w: 1.2, h: 0.8, y: 0 }, pivot: 1.6, two: false }),
  sign_wall_tall: Object.freeze({ label: 'Wall sign (tall)', family: 'wall', face: { w: 0.8, h: 1.2, y: 0 }, pivot: 1.55, two: false }),
});
/**
 * The sizes a panel may take (m), by family (2026-10-06: "a lot bigger"): inside a building up to nearly floor to
 * ceiling (a storey is FLOOR_H high) and as wide as the room allows (it must fit where it stands); in a park, under
 * the sky (`open`), taller still.
 */
export const SIGN_SIZE = Object.freeze({
  stand: Object.freeze({ w: [0.3, 8], h: [0.3, 2.9], open: Object.freeze({ w: [0.3, 12], h: [0.3, 6] }) }),
  wall: Object.freeze({ w: [0.3, 20], h: [0.3, 2.9], open: Object.freeze({ w: [0.3, 20], h: [0.3, 6] }) }),
});
/** The sizes a sign of type t may take inside a building, or in a park (open): { w: [min, max], h: [min, max] }. */
export const signLimits = (t, open = false) => { const L = SIGN_SIZE[INDOOR_SIGNS[t]?.family]; return L ? (open ? L.open : L) : null; };
const LOW = 0.12, HIGH = FLOOR_H - 0.25;   // m: a panel's bottom stays this far above the floor, its top under a storey's ceiling when it can
/** A face size checked for type t: { w, h } held to its sizes (open: in a park), to the centimetre (null: not a sign). */
export function signSize(t, w, h, open = false) {
  const T = INDOOR_SIGNS[t]; if (!T) return null;
  const L = signLimits(t, open), fit = (v, [a, b], d) => { const n = Number(v); return Math.round(Math.max(a, Math.min(b, Number.isFinite(n) && n > 0 ? n : d)) * 100) / 100; };
  return { w: fit(w, L.w, T.face.w), h: fit(h, L.h, T.face.h) };
}
/**
 * Where a face of height h sits in type t: its centre's height above the floor. A standing sign's panel keeps its
 * bottom on its post and grows upwards, coming down towards the floor once it would reach the ceiling; a wall sign
 * grows round its centre, held between the floor and the ceiling (in a park a taller one rises above them).
 */
export function signFaceY(t, h) {
  const T = INDOOR_SIGNS[t]; if (!T) return 0;
  const bottom = T.face.y - T.face.h / 2;
  const y = T.family === 'stand' ? Math.max(LOW, Math.min(bottom, HIGH - h)) + h / 2
    : Math.max(LOW + h / 2, Math.min(HIGH - h / 2, T.pivot));
  return Math.round(y * 1000) / 1000;
}
/**
 * A sign item's face: { w, h, y } (its size, m, and its centre's height). From its `fw` × `fh`; an item from before
 * faces were sized (a uniform scale `s`) keeps its look; otherwise the type's own face.
 */
export function signFace(it) {
  const T = INDOOR_SIGNS[it?.t]; if (!T) return null;
  const k = it.s > 0 ? it.s : 1;
  const { w, h } = signSize(it.t, it.fw > 0 ? it.fw : T.face.w * k, it.fh > 0 ? it.fh : T.face.h * k, true);   // (sizes are held to their place's when set)
  return { w, h, y: signFaceY(it.t, h) };
}
/** The shape a face is painted in: 'x<width ÷ height>' (shared/ads.js aspectOf). */
export const signShape = it => { const F = signFace(it); return F ? `x${(F.w / F.h).toFixed(2)}` : 'landscape'; };
export const INDOOR_SIGN_TYPES = Object.freeze(Object.keys(INDOOR_SIGNS));
/**
 * The styles a sign comes in (2026-10-05: "different base, modern base, full base ... modern futuristic ... one
 * with accent light on the bottom"); the first of each is the plain one. A style with a light glows in the sign's
 * colour (its tint), brighter at night. Every style keeps the same face, so a sign's design and size carry over.
 */
export const SIGN_STYLES = Object.freeze({
  stand: Object.freeze([
    Object.freeze({ id: 'classic', label: 'Classic', blurb: 'A round weighted base and a slim post' }),
    Object.freeze({ id: 'modern', label: 'Modern', blurb: 'Slim steel legs on a low stone plinth' }),
    Object.freeze({ id: 'pylon', label: 'Pylon', blurb: 'A full base: the sign set into a slim monolith, a light strip down its front', light: true }),
    Object.freeze({ id: 'halo', label: 'Halo', blurb: 'Futuristic: a blade post on a disc with a glowing ring at the bottom', light: true }),
  ]),
  wall: Object.freeze([
    Object.freeze({ id: 'frame', label: 'Frame', blurb: 'A slim dark frame' }),
    Object.freeze({ id: 'lightbox', label: 'Lightbox', blurb: 'A deep box with glowing edges', light: true }),
    Object.freeze({ id: 'floating', label: 'Floating', blurb: 'No frame: held off the wall on chrome pins' }),
    Object.freeze({ id: 'neon', label: 'Neon', blurb: 'A neon tube round its edge', light: true }),
  ]),
});
/** The styles of a sign type, and a style checked against them (undefined for the plain one). */
export const stylesOf = t => SIGN_STYLES[INDOOR_SIGNS[t]?.family] || [];
export const signStyle = (t, v) => { const L = stylesOf(t); return L.slice(1).some(x => x.id === v) ? v : undefined; };
/**
 * The geometry a sign item is drawn with (render/furniture.js): its type in its style at its face's size,
 * 'type@style#w×h'; other items: their type.
 */
export function signGeoKey(it) {
  if (!it || !isIndoorSign(it.t)) return it?.t;
  const F = signFace(it), v = signStyle(it.t, it.v) || stylesOf(it.t)[0].id;
  return `${it.t}@${v}#${F.w.toFixed(2)}x${F.h.toFixed(2)}`;
}
/** The type, style and face size a geometry key names, or null. */
export function parseSignGeoKey(key) {
  const m = /^([a-z_]+)@([a-z]+)(?:#(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?))?$/.exec(String(key || ''));
  if (!m || !isIndoorSign(m[1])) return null;
  const T = INDOOR_SIGNS[m[1]], st = stylesOf(m[1]).find(x => x.id === m[2]); if (!st) return null;
  const { w, h } = m[3] ? signSize(m[1], +m[3], +m[4], true) : T.face;
  return { t: m[1], v: st.id, family: T.family, w, h, y: signFaceY(m[1], h) };
}
/** A sign's colour when it is put up (its light, in styles that have one), and the light colours offered first. */
export const SIGN_ACCENT = '#38bdf8';
export const SIGN_LIGHTS = Object.freeze(['#38bdf8', '#a78bfa', '#f472b6', '#f59e0b', '#34d399', '#ffffff', '#ef4444']);
/** Whether a sign type in style v (undefined: the plain one) has a light. */
export const signLit = (t, v) => { const L = stylesOf(t); return !!(L.find(x => x.id === v) || L[0])?.light; };
export const isIndoorSign = t => Object.hasOwn(INDOOR_SIGNS, t || '');
/** A sign's settings: { mode 'private', cr (the owner's design) }. */
export function normalizeSignSettings(raw, { keep = null } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const cr = r.cr ? normalizeAdCreative(r.cr, { images: 'any' }) : null;
  if (cr instanceof Error) return cr;
  const o = { mode: 'private', cr: cr || null };
  if (keep?.blocked) o.blocked = keep.blocked;
  return o;
}
/** An indoor sign item's faces in its own frame: [{ x, y, z, w, h, yaw }] (just proud of its board: render/furniture.js). */
export function indoorSignFaces(it) {
  const T = INDOOR_SIGNS[it?.t]; if (!T) return [];
  const { w, h, y } = signFace(it);
  if (!T.two) return [{ x: 0, y, z: 0.034, w, h, yaw: 0 }];
  return [{ x: 0, y, z: 0.028, w, h, yaw: 0 }, { x: 0, y, z: -0.028, w, h, yaw: PI }];
}
export { SIGN_RIM };   // its board beyond its face, each side (shared/geom.js itemRect widens a sign by it)
export const indoorSlot = (B, lv, it) => `in:${B.id}:${lv}:${it.id}`;
/** The building, level and item an indoor slot names (world: buildings, levels), or null. */
export function findIndoorSign(world, slot) {
  const m = /^in:([^:]{1,40}):(\d{1,6}):(\d{1,9})$/.exec(String(slot || ''));
  if (!m) return null;
  const B = (world.buildings || []).find(b => b && !b.gone && String(b.id) === m[1]);
  const lv = +m[2], L = world.levels?.[lv];
  if (!B || !L || !(B.lv || []).includes(lv)) return null;
  const it = (L.items || []).find(i => i.id === +m[3] && isIndoorSign(i.t));
  return it ? { B, lv, L, it } : null;
}
