// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Where a body is, exactly, in words (docs/features/awareness.md §2): the place, its floor and whether it is home; the
// street corner outside; the car and the seat it sits in (who drives, how fast, which way, along which street); its own
// car on the way somewhere; the ferry, the subway, a lift. Read from the same plan and seats the pages draw it from, so
// what an agent is told is what its owner sees.
import { evalPlan } from '../sim/plan.js';
import { F_HIDDEN, VEH_CAR, VEH_BOAT, CTX_UNDER } from '../../shared/proto.js';
import { VEHICLE_KINDS } from '../../shared/vehicle-specs.js';
import { AIRCRAFT, SEATS } from '../../shared/aircraft-specs.js';
import { BOATS } from '../../shared/boat-model.js';
import { toLocal, inFootprint } from '../../shared/geom.js';
import { makeGrid, blockAt, blockRect } from '../../shared/city.js';
import { SIDEWALK } from '../../shared/constants.js';
import { biome } from '../../shared/biome.js';
import { sectionOf } from '../../shared/road-kit.js';

export const ctxB = ctx => ctx >> 6, ctxF = ctx => ctx & 63;
export const clean = (s, n = 80) => String(s ?? '').replace(/[\u0000-\u001f«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export const q = (s, n = 80) => `«${clean(s, n)}»`;

/**
 * The space a point is in, for who sees and hears whom: outside (or underground) its ctx; on a floor with flats, the flat
 * it is in ("ctx:k") or the hall between them — walls between flats keep neighbours apart; elsewhere the floor.
 */
export function spaceOf(W, x, z, ctx) {
  if (!(ctx >= 0)) return String(ctx);
  const B = W?.buildings?.[ctxB(ctx)], L = B ? W.levels?.[B.lv?.[ctxF(ctx)]] : null, U = L?.units;
  if (!U || !U.length) return String(ctx);
  const l = toLocal(B, x, z);
  for (let k = 0; k < U.length; k++) { const u = U[k]; if (l.x >= u.x0 - 0.15 && l.x <= u.x1 + 0.15 && l.z >= u.z0 - 0.15 && l.z <= u.z1 + 0.15) return `${ctx}:${k}`; }
  return `${ctx}:hall`;
}
/** The compass way of a movement (−z is north on the maps). */
export function compass(dx, dz) {
  if (Math.hypot(dx, dz) < 1e-6) return '';
  const a = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;   // 0 north, 90 east
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(a / 45) % 8];
}
/**
 * Which way (dx, dz) is from someone facing `yaw` (a body's yaw: it faces (sin yaw, cos yaw)): 'ahead', 'ahead on your
 * left', 'on your left', 'behind you on your left', 'behind you', … — a positive turn from its facing is its left.
 */
export function sideOf(yaw, dx, dz) {
  if (Math.hypot(dx, dz) < 0.3) return 'right here';
  let a = Math.atan2(dx, dz) - (Number.isFinite(yaw) ? yaw : 0);
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  const d = a * 180 / Math.PI, s = d > 0 ? 'left' : 'right', m = Math.abs(d);
  return m < 25 ? 'ahead of you' : m < 70 ? `ahead on your ${s}` : m < 115 ? `on your ${s}` : m < 155 ? `behind you on your ${s}` : 'behind you';
}
/** A distance said as a person would. */
export const metres = d => (d < 1.5 ? 'right next to you' : d < 10 ? `${Math.round(d)} m away` : `about ${Math.round(d / 5) * 5} m away`);
/** A car's place (render/vehicle-seats.js order: 0 the driver's, 1 the front passenger's, then row by row). */
export const seatWords = (seat, kind) => (seat === 0 ? 'the driver\'s seat' : kind === 'bus' ? 'a seat on the bus' : seat === 1 ? 'the front passenger seat' : 'the back seat');
const kmh = v => Math.round(Math.abs(Number(v) || 0) * 3.6);

// ------------------------------------------------------------------------------------------- the ground underfoot
// What the ground is where a body stands outdoors, from the same city grid and island biomes the pages draw it with
// (shared/city.js, shared/biome.js): the road, the sidewalk, a park in the city; beyond it the beach, the water's edge, the
// water itself, a riverbank, a meadow, a field, the woods, rocks, snow. Kept per 2 m cell of each island (called for every
// AI agent's body every tick): a body standing still costs one map lookup.
const GROUND_CELL = 2, GROUND_MAX = 20000;
const grids = new WeakMap(), groundMemo = new WeakMap(), parkMemo = new WeakMap();
const gridOf = W => { if (!W?.grid) return null; let g = grids.get(W.grid); if (!g) grids.set(W.grid, g = makeGrid(W.grid)); return g; };
const GROUND_WORDS = {
  beach: 'on the beach', meadow: 'in a meadow', lawn: 'on the grass', field: 'in a field', crop: 'in a farm field', hedge: 'by a hedgerow',
  forest: 'in the woods', conifer: 'in a pine forest', rock: 'on rocky ground', snow: 'in the snow',
};
const WATER_WORDS = { sea: 'the sea', lake: 'the lake', river: 'the river' };
/** The city's parks by block (a park's lot is walked outside too). */
function parksIn(W, bi) {
  let m = parkMemo.get(W.buildings);
  if (!m || m.n !== W.buildings.length) {
    parkMemo.set(W.buildings, m = { n: W.buildings.length, by: new Map() });
    for (const B of W.buildings) if (B && !B.gone && B.type === 'park' && Number.isInteger(B.block)) (m.by.get(B.block) || m.by.set(B.block, []).get(B.block)).push(B);
  }
  return m.by.get(bi) || null;
}
/** The island of a ground query (players' GroundQuery: its island and cached heights) or an Island itself. */
const islandOf = G => (G?.island && typeof G.island.waterAt === 'function' ? G.island : typeof G?.waterAt === 'function' ? G : null);

/**
 * What the ground is at outdoor point (x, z) of world W: { kind, words } — kind 'street' | 'sidewalk' | 'park' | 'road' |
 * 'roadside' | 'water' | 'edge' | 'riverbank' | 'lakeshore' | a biome's kind; words as said after "outside" ("on the beach",
 * "swimming in the sea", "in the park «Elm Park»") — or null (unknown: no island beyond the city, a lot in the city).
 * G: the island's ground (a GroundQuery or an Island), or null.
 */
export function groundAt(W, G, x, z) {
  const g = gridOf(W);
  if (g && x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) {
    const bk = blockAt(g, x, z);
    if (!bk) return { kind: 'street', words: 'in the street' };
    const r = blockRect(g, bk.i, bk.j);
    if (Math.min(x - r.x0, r.x1 - x, z - r.z0, r.z1 - z) < SIDEWALK) return { kind: 'sidewalk', words: 'on the sidewalk' };
    const park = parksIn(W, bk.bi)?.find(B => inFootprint(B, x, z));
    return park ? { kind: 'park', words: parkWords(park.name) } : null;
  }
  const I = islandOf(G);
  if (!I) return null;
  let memo = groundMemo.get(I);
  if (!memo) groundMemo.set(I, memo = new Map());
  const key = Math.round(x / GROUND_CELL) * 65536 + Math.round(z / GROUND_CELL);
  let v = memo.get(key);
  if (v !== undefined) return v;
  v = groundOn(I, G, x, z);
  if (memo.size >= GROUND_MAX) memo.clear();
  memo.set(key, v);
  return v;
}
const parkWords = name => { const n = clean(name, 60); return n ? (/\bpark\b/i.test(n) ? `in ${q(n, 60)}` : `in the park ${q(n, 60)}`) : 'in a park'; };
function groundOn(I, G, x, z) {
  const R = I.roads;
  if (R?.net?.size) {
    const nr = R.net.nearest(x, z, 24), half = nr ? R.half.get(nr.id) : 0;
    if (nr && nr.dist <= half + 3) {
      if (nr.dist > half) return { kind: 'roadside', words: 'beside the road' };
      let sec = null; try { sec = sectionOf(R.profiles[R.net.get(nr.id).profile]); } catch { sec = null; }
      return !sec || nr.dist <= sec.carriage ? { kind: 'road', words: 'on the road' } : sec.sidewalk ? { kind: 'sidewalk', words: 'on the sidewalk' } : { kind: 'roadside', words: 'on the roadside' };
    }
  }
  const ht = (a, b) => I.height(a, b);   // (exact, a few points: a GroundQuery would build whole chunks of heights for them)
  const h = ht(x, z), wet = I.waterAt(x, z, h);
  if (wet) return { kind: 'water', words: `${wet.level - h > 1.3 ? 'swimming' : 'wading'} in ${WATER_WORDS[wet.kind] || 'the water'}` };
  // (by the water: a river's bank, a lake's edge, the sea's)
  const rv = I.riverAt(x, z);
  if (rv && rv.d < rv.width / 2 + 6) return { kind: 'riverbank', words: 'on the riverbank' };
  const hx = ht(x + 2, z) - h, hz = ht(x, z + 2) - h, ny = 1 / Math.sqrt((hx / 2) ** 2 + 1 + (hz / 2) ** 2);
  const kind = biome(I, x, z, h, ny).kind;
  if (kind === 'shore') return { kind: 'lakeshore', words: 'at the lake\'s edge' };
  if (kind === 'beach' || h < I.p.seaLevel + 1.5) {
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = x + Math.cos(a) * 4, pz = z + Math.sin(a) * 4;
      if (I.waterAt(px, pz, ht(px, pz))) return { kind: 'edge', words: kind === 'beach' ? 'on the beach at the water\'s edge' : 'at the water\'s edge' };
    }
  }
  return GROUND_WORDS[kind] ? { kind, words: GROUND_WORDS[kind] } : null;
}

/**
 * Where body i is now. env: { sim, vehicles (server/world/vehicles.js), players, ground (the island's GroundQuery, or null) }.
 * Returns { text, short, x, z, ctx, yaw, b, f, home, outside, address, place, car, moving, ground } — text one phrase
 * ("in the front passenger seat of Kim's sedan, Kim driving, along «5th Ave» heading north at about 40 km/h"), short a
 * few words ("in Kim's car"); null when it has no body.
 */
export function whereOf(env, i, t = env.sim.now()) {
  const sim = env.sim, a = sim.agents[i], p = sim.people[i];
  if (!a?.plan || !p) return null;
  const e = evalPlan(a.plan, t), s = e.s, act = a.act || null, B = sim.brain;
  const out = { x: e.x, z: e.z, ctx: e.ctx, yaw: e.yaw, b: -1, f: -1, home: false, outside: e.ctx < 0, address: '', place: '', car: null, moving: !!(s && !s.h) };
  const addr = (x, z) => { try { return sim.nav?.addressAt?.(x, z) || ''; } catch { return ''; } };
  // riding in someone's car (a companion): its place in it, who drives, the car's speed and way
  const seats = env.vehicles?.seats, carId = seats ? seats.where({ kind: 'resident', id: i }) : null;
  const car = carId != null ? env.vehicles?.all?.get(carId) : null;
  if (car) {
    const kind = VEHICLE_KINDS[car.k]?.n || 'car', mine = seats.of(carId).find(r => r.kind === 'resident' && r.id === i);
    const driver = car.driver ? env.players?.byId?.get(car.driver) : null, dn = driver ? clean(driver.name, 40) : '';
    const vx = Number(car.vx) || 0, vz = Number(car.vz) || 0, speed = kmh(Math.hypot(vx, vz) || car.v), way = speed >= 3 ? compass(vx, vz) : '';
    const street = addr(car.x, car.z);
    out.car = { id: car.id, kind, seat: mine ? mine.seat : 1, seatWords: seatWords(mine ? mine.seat : 1, kind), driver: dn || null, driverId: car.driver || null, speed, way, street, riding: true };
    out.x = car.x; out.z = car.z; out.ctx = -1; out.outside = true; out.address = street;
    // (on a bus: "in a seat on Kim's bus"; in a car: "in the back seat of Kim's sedan")
    const whose = `${dn ? `${dn}'s` : 'a'} ${kind}`;
    out.text = `${kind === 'bus' && out.car.seat !== 0 ? `in a seat on ${whose}` : `in ${out.car.seatWords} of ${whose}`}${dn ? `, ${dn} driving` : ', parked'}${speed >= 3 ? `, ${street ? `along ${q(street)} ` : ''}heading ${way} at about ${speed} km/h` : street ? `, stopped at ${q(street)}` : ''}`;
    out.short = `in ${dn ? `${dn}'s` : 'a'} ${kind}`;
    return out;
  }
  // in an aircraft (server/play/flight-crew.js): a passenger seat of its owner's (the fleet's seats), or at the controls
  // itself — where it is, how high, how fast
  const F = env.fleet, aid = a.ride?.aircraft, A = aid != null ? F?.all?.get(aid) : null;
  if (A && A.pose) {
    const P = A.pose, craft = String(AIRCRAFT[A.type]?.label || 'aircraft').toLowerCase(), v = kmh(P.v);
    let ground = 0; try { ground = Number(F.groundAt?.(P.x, P.z)) || 0; } catch { ground = 0; }
    const h = Math.max(0, Math.round(P.y - (AIRCRAFT[A.type]?.gearH || 0) - ground)), how = P.g ? (v >= 10 ? `rolling along the ground at about ${v} km/h` : 'on the ground') : `about ${h} m above the ground at ${v} km/h, heading ${compass(Math.sin(yawOf(P.q)), Math.cos(yawOf(P.q)))}`;
    const pilot = A.pilot != null ? clean(A.pilotName, 40) : '', seat = a.ride.pilot ? 0 : F.seats?.of?.(A.id).find(r => r.kind === 'resident' && r.id === i)?.seat ?? 1;
    out.air = { id: A.id, type: A.type, craft, seat, seatWords: SEATS[A.type]?.[seat]?.words || 'a seat', pilot: a.ride.pilot ? clean(p.name, 40) : pilot, own: !!a.ride.pilot, ground: !!P.g, h, speed: v };
    out.x = P.x; out.z = P.z; out.ctx = -1; out.outside = true; out.address = addr(P.x, P.z);
    out.text = a.ride.pilot ? `at the controls of the ${craft} yourself, ${how}` : `in ${out.air.seatWords} of ${pilot ? `${pilot}'s` : 'the'} ${craft}${pilot ? `, ${pilot} flying` : ''}, ${how}`;
    out.short = a.ride.pilot ? `flying the ${craft}` : `in ${pilot ? `${pilot}'s` : 'the'} ${craft}`;
    return out;
  }
  // aboard someone's boat (server/play/fishing-crew.js: a companion at its spot on deck — a.ride.label says which, and
  // whether it fishes): whose, tied up or out, under way or still. Never "in the water" (2026-11-20: Lara, aboard Kim's
  // boat, "I'm in the water, Kim — that's the whole problem")
  const H = env.harbour, bid = a.ride?.boat, BT = bid != null ? H?.all?.get?.(bid) : null;
  if (BT && !a.ride.leaving && !(a.ride.until && t < a.ride.until)) {
    const P = H.place(BT), craft = BOATS[BT.type]?.label || 'boat', sk = BT.skipper != null ? clean(BT.skipperName || env.players?.byId?.get(BT.skipper)?.name || '', 40) : '';
    const v = kmh(P.v), home = BT.home ? Math.hypot(P.x - BT.home.x, P.z - BT.home.z) : Infinity;
    const how = home < 30 && v < 3 ? 'tied up at the dock' : v >= 3 ? `under way at about ${v} km/h, heading ${compass(Math.sin(P.h), Math.cos(P.h))}` : P.an ? 'at anchor out on the water' : 'stopped out on the water';
    const doing = String(a.ride.label || '').replace(/^[A-Z]/, c => c.toLowerCase());
    out.boat = { id: BT.id, type: BT.type, craft, skipper: sk || null, speed: v, atDock: home < 30, fishing: a.ride.use === 'fish' };
    out.x = P.x; out.z = P.z; out.ctx = -1; out.outside = true; out.address = addr(P.x, P.z); out.moving = v >= 3;
    out.text = `${doing && /^(fishing|on )/.test(doing) ? `${doing} (the ${craft})` : `aboard ${sk ? `${sk}'s` : 'the'} ${craft}`}, ${how} — on the deck, dry`;
    out.short = `aboard ${sk ? `${sk}'s` : 'the'} boat`;
    return out;
  }
  // its own car, the ferry, the subway or a lift (a hidden traveller: shared/proto.js veh)
  if (s && (s.flags & F_HIDDEN)) {
    const to = act?.place ? q(act.place === 'Home' ? 'home' : act.place, 60) : '';
    const street = addr(e.x, e.z);
    if (s.veh === VEH_CAR) {
      const dx = s.x - e.x, dz = s.z - e.z;
      out.car = { id: null, kind: 'car', seat: 0, seatWords: 'the driver\'s seat', driver: clean(p.name, 40), own: true, way: compass(dx, dz), street, riding: false };
      out.address = street;
      out.text = `driving your own car${street ? ` along ${q(street)}` : ''}${to ? ` to ${to === '«home»' ? 'home' : to}` : ''}`;
      out.short = 'driving your car';
      return out;
    }
    out.transit = true;   // (on the way between places: the place it was in stays its place until it is in another)
    if (s.veh === VEH_BOAT) { out.text = `on the ferry${to ? ` to ${to}` : ''}`; out.short = 'on the ferry'; return out; }
    if (e.ctx === CTX_UNDER) { out.text = `on the subway${to ? ` to ${to}` : ''}`; out.short = 'on the subway'; return out; }
    if (e.ctx >= 0) { out.text = `in the lift at ${q(B.W.buildings[ctxB(e.ctx)]?.name || 'a building', 60)}`; out.short = 'in a lift'; out.b = ctxB(e.ctx); return out; }
  }
  if (e.ctx >= 0) {
    const b = ctxB(e.ctx), f = ctxF(e.ctx), Bd = B.W.buildings[b];
    out.b = b; out.f = f; out.place = clean(B.placeName(b, f), 80);
    out.home = !!(p.home && p.home.b === b);
    // (a park is out in the open: its lawns and paths)
    if (Bd?.type === 'park') {
      out.outside = true; out.ground = { kind: 'park', words: parkWords(Bd.name) };
      out.placeWords = q(out.place, 80); out.text = `outside ${out.ground.words}`; out.short = out.text;
      return moving(out, act, t);
    }
    // (a building's lobby is named by its building: "the lobby of «Lumen Lofts»", not «Lobby»)
    const generic = /^(lobby|hall|ground floor)$/i.test(out.place) && Bd?.name;
    out.placeWords = out.home ? 'home' : generic ? `the ${out.place.toLowerCase()} of ${q(Bd.name, 60)}` : q(out.place, 80);
    out.text = out.home ? `at home${p.home.f === f ? '' : ` (floor ${f + 1} of your building, ${q(Bd?.name || '', 60)})`}` : `in ${out.placeWords}`;
    out.short = out.home ? 'at home' : `in ${out.placeWords}`;
  } else {
    out.address = addr(e.x, e.z);
    out.placeWords = '';
    let gr = null; try { gr = groundAt(sim.world, env.ground, e.x, e.z); } catch { gr = null; }
    out.ground = gr;
    // (the street corner in the city, the road it is by beyond it; "Out in the country" is no place to be by)
    const named = out.address && !/^(out in the country|beside the road)$/i.test(out.address);
    const city = gr && (gr.kind === 'street' || gr.kind === 'sidewalk' || gr.kind === 'park');
    out.text = `outside${gr ? ` ${gr.words}` : ''}${named ? `${!gr || city ? ' at ' : gr.kind === 'road' ? ' ' : ', near '}${q(out.address)}` : ''}`;
    out.short = out.text;
  }
  return moving(out, act, t);
}
/** On its way somewhere: where to (whereOf's last words). */
function moving(out, act, t) {
  if (out.moving) {
    const to = act?.place && Number.isFinite(act.travelEnd) && act.travelEnd > t ? (act.place === 'Home' ? 'home' : q(act.place, 60)) : '';
    // (on its way somewhere else: where to; moving about where it already is — home, the café it is in — is just that)
    if (to && !(to === 'home' && out.home) && to !== out.placeWords) { out.text += `, walking ${to === 'home' ? 'home' : `to ${to}`}`; out.short += ', on the way'; }
    else if (!out.home && (out.ctx < 0 || out.ground?.kind === 'park')) out.text += out.ground?.kind === 'water' ? '' : ', walking';
  }
  return out;
}
/** The heading of an orientation [x, y, z, w] (the nose along (sin h, cos h)). */
function yawOf(q) { const [x, y, z, w] = Array.isArray(q) ? q : [0, 0, 0, 1]; return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y)); }
