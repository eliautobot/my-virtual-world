// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Promotional aircraft (WP4.11; rebuilt for the design review 2026-10-03: "rebuilt fresh from the ground up ... they get way
// too close to buildings and airplanes shouldn't turn around in the same spot"): the kinds, the administrators'
// configuration (one advertisement per kind: text and/or an uploaded picture, colours, a website), the fleet, and the
// flight plans every browser flies on the shared clock.
//
// Flight plans: each aircraft has its own circuit and its own height band, so none ever meets another.
// - Banner planes fly long racetrack circuits round the city's edges and along the beach, turning in wide, banked arcs
//   (never tighter than MIN_TURN), the banner trailing behind on its tow rope along the same curve.
// - Blimps cruise slowly round wide ovals over the city.
// - Hot-air balloons drift on long, slow loops over the country round the city, rising and sinking a little.
// Every circuit flies at a height that keeps the whole aircraft (and what hangs below it) a clear margin above every
// roof and every hill within a wide berth of its path; the planner checks the lap all the way round.
//
// The configuration's shape is the one worlds already store (world.promo.config), so saved promotions keep working.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * The kinds. speed m/s; minTurn: the tightest turn radius (m); clearance: metres kept between the aircraft's lowest
 * part and the highest roof or ground within `berth` m of its path; drop: how far below its centre it reaches (a
 * balloon's basket and banner) and rise how far above it (its envelope); band: the lowest cruising height above the
 * sea (m) and step: the height between one aircraft and the next of its kind.
 */
export const PROMO_AIRCRAFT_TYPES = Object.freeze([
  Object.freeze({ id: 'bannerPlane', label: 'Banner plane', graphicLabel: 'Banner', blurb: 'A light plane towing your advertisement on a long banner round the city and along the beach.', defaultCount: 2, maxCount: 6, speed: 31, minTurn: 230, clearance: 75, berth: 70, drop: 12, rise: 3, band: 170, step: 24, bank: 0.55 }),
  Object.freeze({ id: 'blimp', label: 'Promotional blimp', graphicLabel: 'Blimp', blurb: 'A slow airship cruising over the city with your advertisement along both sides.', defaultCount: 1, maxCount: 4, speed: 10, minTurn: 300, clearance: 95, berth: 95, drop: 9, rise: 7, band: 240, step: 36, bank: 0.12 }),
  Object.freeze({ id: 'hotAirBalloon', label: 'Promotional hot-air balloon', graphicLabel: 'Banner', blurb: 'Balloons drifting over the country round the city, your advertisement round the envelope and on a banner below the basket.', defaultCount: 2, maxCount: 6, speed: 4.2, minTurn: 220, clearance: 100, berth: 90, drop: 16, rise: 28, band: 230, step: 32, bank: 0 }),
]);
export const PROMO_TYPE = Object.fromEntries(PROMO_AIRCRAFT_TYPES.map(t => [t.id, t]));
export const MIN_TURN = Math.min(...PROMO_AIRCRAFT_TYPES.map(t => t.minTurn));

// ---------------------------------------------------------------- configuration
const FITS = ['cover', 'contain'];
const color = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : d);
/** Only pictures uploaded into the world (served from its data folder) are shown. */
function imageSrc(v) { const s = typeof v === 'string' ? v.trim() : ''; return /^\/(promo|signs|billboards)\/[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp|gif)$/.test(s) ? s : ''; }
/** A website link: a bare domain becomes https; anything not an http(s) address with a real host is dropped. */
export function normalizeWebsite(v) {
  const t = String(v ?? '').trim(); if (!t || t.length > 500) return '';
  try { const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') ? u.toString() : ''; } catch { return ''; }
}
/** One kind's advertisement. */
export function normalizeGraphic(raw, base = {}) {
  const s = raw && typeof raw === 'object' ? raw : {}, has = k => Object.hasOwn(s, k);
  return {
    imageSrc: imageSrc(has('imageSrc') ? s.imageSrc : base.imageSrc),
    imageVersion: Math.max(0, Math.floor(num(s.imageVersion ?? base.imageVersion, 0))),
    text: String(s.text ?? base.text ?? '').slice(0, 120),
    backgroundColor: color(s.backgroundColor ?? base.backgroundColor, '#ffffff'),
    textColor: color(s.textColor ?? base.textColor, '#111827'),
    fit: FITS.includes(has('fit') ? s.fit : base.fit) ? (has('fit') ? s.fit : base.fit) : 'cover',
    scale: clamp(num(s.scale ?? base.scale, 1), 0.4, 3), opacity: clamp(num(s.opacity ?? base.opacity, 1), 0, 1),
    offsetX: clamp(num(s.offsetX ?? base.offsetX, 0), -1, 1), offsetY: clamp(num(s.offsetY ?? base.offsetY, 0), -1, 1),
    websiteUrl: normalizeWebsite(has('websiteUrl') ? s.websiteUrl : base.websiteUrl),
  };
}
/**
 * The whole configuration: unknown kinds dropped, missing ones filled in, counts held to each kind's limit. The fleet
 * (Marketing, 2026-10-05): the aircraft one by one, [{ id, type, g (its own advertisement, optional) }], in the
 * order they were added; a configuration without one (saved before) gets one from its counts. Each kind's count follows
 * its fleet.
 */
export function normalizePromoAircraftConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}, rt = src.types && typeof src.types === 'object' ? src.types : {}, types = {};
  for (const t of PROMO_AIRCRAFT_TYPES) {
    const r = rt[t.id] && typeof rt[t.id] === 'object' ? rt[t.id] : null;
    types[t.id] = { enabled: r?.enabled === undefined ? true : !!r.enabled, count: Math.round(clamp(num(r?.count, t.defaultCount), 0, t.maxCount)), ...normalizeGraphic(r || {}) };
  }
  const fleet = [], ids = new Set(), per = {};
  const add = (type, id, g) => {
    const T = PROMO_TYPE[type]; if (!T) return;
    if ((per[type] = (per[type] || 0) + 1) > T.maxCount) return;
    let k = String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || `${type}-${per[type]}`;
    while (ids.has(k)) k = `${k}x`;
    ids.add(k);
    fleet.push({ id: k, type, ...(g && typeof g === 'object' ? { g: normalizeGraphic(g) } : {}) });
  };
  if (Array.isArray(src.fleet)) for (const e of src.fleet.slice(0, 64)) add(e?.type, e?.id, e?.g);
  else for (const t of PROMO_AIRCRAFT_TYPES) for (let i = 0; i < types[t.id].count; i++) add(t.id, `${t.id}-${i + 1}`, null);
  if (Array.isArray(src.fleet)) for (const t of PROMO_AIRCRAFT_TYPES) types[t.id].count = fleet.filter(e => e.type === t.id).length;
  return { version: 3, enabled: src.enabled === undefined ? true : !!src.enabled, types, fleet };
}
/**
 * The aircraft that fly: [{ id, typeId, index (its place among its kind), count, settings (its advertisement: its own,
 * else its kind's), definition }].
 */
export function resolvePromoAircraftFleet(config) {
  const c = normalizePromoAircraftConfig(config), out = [], seen = {};
  if (!c.enabled) return out;
  for (const e of c.fleet) {
    const s = c.types[e.type]; if (!s?.enabled) continue;
    const index = seen[e.type] = (seen[e.type] ?? -1) + 1;
    out.push({ id: e.id, typeId: e.type, index, count: c.fleet.filter(x => x.type === e.type).length, settings: e.g ? { ...s, ...e.g, own: true } : s, definition: PROMO_TYPE[e.type] });
  }
  return out;
}
/** Whether an advertisement shows anything. */
export const promoAircraftGraphicIsVisible = g => !!g && g.opacity > 0 && (!!g.imageSrc || String(g.text || '').trim().length > 0);

// ---------------------------------------------------------------- flight plans
/** A closed circuit: points [{ x, z }] every ~STEP m, with lengths. */
const STEP = 8;
function circuit(pts) {
  const s = [0];
  for (let i = 1; i <= pts.length; i++) { const a = pts[i - 1], b = pts[i % pts.length]; s.push(s[i - 1] + Math.hypot(b.x - a.x, b.z - a.z)); }
  return { pts, s, len: s[pts.length] };
}
/** A rounded rectangle centred on (cx, cz), half sizes hx, hz, corner radius r, flown clockwise or not, rotated by rot. */
function roundedRect(cx, cz, hx, hz, r, ccw, rot = 0) {
  r = Math.min(r, hx, hz);
  const out = [], c = Math.cos(rot), s = Math.sin(rot), put = (x, z) => out.push({ x: cx + x * c - z * s, z: cz + x * s + z * c });
  const corners = [[hx - r, hz - r, 0], [-(hx - r), hz - r, Math.PI / 2], [-(hx - r), -(hz - r), Math.PI], [hx - r, -(hz - r), Math.PI * 1.5]];
  for (let k = 0; k < 4; k++) {
    const [ox, oz, a0] = corners[k], [nx, nz] = corners[(k + 1) % 4];
    const n = Math.max(6, Math.ceil(r * Math.PI / 2 / STEP));
    for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI / 2; put(ox + Math.cos(a) * r, oz + Math.sin(a) * r); }
    // the straight leg to the next corner
    const ex = ox + Math.cos(a0 + Math.PI / 2) * r, ez = oz + Math.sin(a0 + Math.PI / 2) * r, fx = nx + Math.cos(a0 + Math.PI / 2) * r, fz = nz + Math.sin(a0 + Math.PI / 2) * r;
    const m = Math.max(1, Math.ceil(Math.hypot(fx - ex, fz - ez) / STEP));
    for (let i = 0; i < m; i++) put(ex + (fx - ex) * i / m, ez + (fz - ez) * i / m);
  }
  return ccw ? out : out.reverse();
}
/** Small deterministic random numbers from a seed. */
function rand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * The highest roof or ground within `berth` m of a circuit: buildings [{ x0, z0, x1, z1, top }] (m, tops above the sea's
 * datum the ground uses), ground(x, z) → height.
 */
export function highestUnder(C, buildings, ground, berth) {
  let top = -Infinity;
  for (let i = 0; i < C.pts.length; i++) {
    const p = C.pts[i];
    for (const B of buildings) { const dx = Math.max(B.x0 - p.x, 0, p.x - B.x1), dz = Math.max(B.z0 - p.z, 0, p.z - B.z1); if (dx * dx + dz * dz <= berth * berth && B.top > top) top = B.top; }
    if (ground) for (const [ox, oz] of [[0, 0], [berth, 0], [-berth, 0], [0, berth], [0, -berth]]) top = Math.max(top, ground(p.x + ox, p.z + oz));
  }
  return top;
}

/**
 * The flight plan for aircraft `index` of `count` of a kind over a city whose built area is { x0, z0, x1, z1 } (the
 * city's streets, m): { type, pts, s, len, alt, wobble, phase, ccw }. buildings and ground as for highestUnder;
 * seaLevel the water's height; wind: the prevailing wind's direction (radians) the balloons drift along.
 */
export function planFlight({ typeId, index = 0, count = 1, city, buildings = [], ground = null, seaLevel = 0, wind = 0.6, seed = 1 }) {
  const T = PROMO_TYPE[typeId]; if (!T) throw new Error(`unknown aircraft ${typeId}`);
  const R = rand((seed * 7919 + index * 104729 + typeId.length * 31) >>> 0);
  const cx = (city.x0 + city.x1) / 2, cz = (city.z0 + city.z1) / 2, hx = (city.x1 - city.x0) / 2, hz = (city.z1 - city.z0) / 2;
  let pts;
  if (typeId === 'bannerPlane') {
    // round the city's edges, each plane a little further out; alternate planes fly the other way round
    const m = 140 + index * 95 + R() * 30, r = Math.max(T.minTurn, Math.min(hx, hz) * 0.5 + m * 0.4);
    pts = roundedRect(cx, cz, hx + m, hz + m, r, index % 2 === 0, (R() - 0.5) * 0.12);
  } else if (typeId === 'blimp') {
    // a long oval over the city, its ends wide turns
    const b = Math.max(T.minTurn, hz * 0.55 + index * 90), a = Math.max(b * 1.5, hx * 0.62 + index * 120);
    pts = roundedRect(cx, cz, a, b, b, index % 2 === 1, index * 0.7 + (R() - 0.5) * 0.3);
  } else {
    // balloons: long, slow loops downwind over the country round the city, spread round it
    const ang = wind + (index / Math.max(1, count)) * Math.PI * 2 + (R() - 0.5) * 0.5, d = Math.hypot(hx, hz) + 420 + R() * 260;
    const ox = cx + Math.cos(ang) * d, oz = cz + Math.sin(ang) * d, b = T.minTurn + 10 + R() * 80;
    pts = roundedRect(ox, oz, b + 300 + R() * 200, b, b, index % 2 === 0, wind);
  }
  const C = circuit(pts);
  // high enough everywhere round the lap: the highest roof or hill within the berth, plus the margin and what hangs below
  const under = highestUnder(C, buildings, ground, T.berth + STEP), wobble = typeId === 'hotAirBalloon' ? 14 : typeId === 'blimp' ? 3 : 1.5;
  const alt = Math.max(seaLevel + T.band, under + T.clearance + T.drop + wobble) + index * T.step;
  return { type: typeId, ...C, alt, min: alt, wobble, phase: R(), ccw: index % 2 === 0 };
}
/** The nearest two circuits come to each other across the ground (m). */
function nearest(A, B) {
  let d = Infinity;
  for (let i = 0; i < A.pts.length; i += 4) for (let j = 0; j < B.pts.length; j += 4) { const dx = A.pts[i].x - B.pts[j].x, dz = A.pts[i].z - B.pts[j].z, q = dx * dx + dz * dz; if (q < d) d = q; }
  return Math.sqrt(d) - 4 * STEP;
}
/** SEPARATION: the clear air kept between two aircraft whose circuits pass within NEAR m of each other (m). */
export const SEPARATION = 30, NEAR = 150;
/**
 * The whole fleet's plans at once (entries as resolvePromoAircraftFleet gives them; env as for planFlight): each at
 * the height its own circuit needs, then raised where its circuit passes near another aircraft's until there is
 * SEPARATION of clear air between them - the lowest first, so the fleet stacks no higher than it must.
 */
export function planFleet(entries, env) {
  const plans = entries.map(e => planFlight({ ...env, typeId: e.typeId, index: e.index, count: e.count }));
  const T = p => PROMO_TYPE[p.type], lo = p => p.alt - T(p).drop - p.wobble, hi = p => p.alt + T(p).rise + p.wobble;
  const order = plans.map((p, i) => i).sort((a, b) => plans[a].alt - plans[b].alt || a - b), placed = [], near = new Map();
  for (const i of order) {
    const p = plans[i];
    for (let guard = 0; guard < 64; guard++) {
      const hit = placed.find(j => { const q = plans[j], key = `${Math.min(i, j)}:${Math.max(i, j)}`; if (!near.has(key)) near.set(key, nearest(p, q) < NEAR); return near.get(key) && lo(p) < hi(q) + SEPARATION && hi(p) > lo(q) - SEPARATION; });
      if (hit === undefined) break;
      p.alt = hi(plans[hit]) + SEPARATION + T(p).drop + p.wobble + 0.5;
    }
    placed.push(i);
  }
  return plans;
}

/** Where along a plan at fraction u (0..1): { x, y, z, heading (radians, as three.js's yaw: atan2(dx, dz)), turn (1/m, + left) }. */
export function sampleFlight(P, u) {
  u = ((u % 1) + 1) % 1;
  const d = u * P.len, n = P.pts.length;
  let lo = 0, hi = n;
  while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (P.s[m] <= d) lo = m; else hi = m; }
  const a = P.pts[lo], b = P.pts[(lo + 1) % n], seg = P.s[lo + 1] - P.s[lo] || 1, t = (d - P.s[lo]) / seg;
  const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, dx = (b.x - a.x) / seg, dz = (b.z - a.z) / seg;
  // the turn: how the heading changes over the neighbouring points
  const p0 = P.pts[(lo - 3 + n) % n], p1 = P.pts[(lo + 4) % n], h0 = Math.atan2(a.x - p0.x, a.z - p0.z), h1 = Math.atan2(p1.x - b.x, p1.z - b.z);
  let dh = h1 - h0; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2;
  const span = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
  const y = P.alt + Math.sin((u + P.phase) * Math.PI * 2 * 2) * P.wobble;
  return { x, y, z, heading: Math.atan2(dx, dz), turn: dh / span };
}
/** Where along a plan `back` metres behind fraction u (the banner trailing behind a plane). */
export function sampleBehind(P, u, back) { return sampleFlight(P, u - back / P.len); }
/** The bank (radians, + right wing down) for a turn at speed v: a coordinated turn, held to the kind's limit. */
export function bankFor(T, turn, v = T.speed) { return clamp(-Math.atan(v * v * turn / 9.81), -T.bank, T.bank); }
/** The fraction of its lap an aircraft has flown at time t (s, the shared clock). */
export function lapAt(P, T, t) { return ((t * T.speed / P.len + P.phase) % 1 + 1) % 1; }
/** The tightest turn radius on a plan (m). */
export function tightestTurn(P) { let k = 0; for (let i = 0; i < P.pts.length; i++) k = Math.max(k, Math.abs(sampleFlight(P, P.s[i] / P.len + 0.5 / P.len).turn)); return k ? 1 / k : Infinity; }
