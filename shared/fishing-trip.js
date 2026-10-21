// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A fishing trip (docs/features/fishing.md §Trips): the kinds of trip (the module's courses), the fishing grounds each
// trip generates round its dock from the run's seed — where the water's depth suits them: flats in the shallows, reefs
// at 4–25 m, drop-offs where the bed falls away, wrecks and the blue water far out; pads, weed, holes on a lake — what
// lives on each (its population), the bounties, the legend's sighting; what bites (rollBite, on the server, with its own
// secret dice: the browser never decides what it caught), how often (biteEvery, the browser's pacing), and a trip's
// score. Shared by the server and the browser: the same seed and the same land give the same grounds on both.
import { RNG } from './rng.js';
import { SPECIES, RARITY, FINDS, speciesIn, legendsIn, fishOf, valueOf, sizeOf, speciesOf } from './fish-species.js';
import { LURE_BY_ID } from './fishing-gear.js';

// ------------------------------------------------------------------------------------------- the trips (courses)
// water; difficulty; reach (m from the dock the grounds go out to; a lake: the whole lake); minutes until dusk;
// grounds [min, max]; kinds it draws from; size (bias toward bigger fish); legend (chance of a legend sighting);
// stars: the trip's value (VC) for 1★ 2★ 3★ (set from simulated trips: a flawless angler with the gear for it averages
// between 2★ and 3★ — tools: tests/fishing.test.mjs).
const SEA = 'sea', LAKE = 'lake';
export const TRIPS = Object.freeze([
  { id: 'harbour-morning', label: 'Harbour Morning', water: SEA, difficulty: 1, reach: 700, minutes: 12, grounds: [6, 8], kinds: ['flats', 'shore', 'boil', 'reef'], size: 0, legend: 0, stars: [11, 22, 36], blurb: 'Calm water close to the dock. Shrimp under a float and you\'re fishing.' },
  { id: 'reef-run', label: 'Reef Run', water: SEA, difficulty: 3, reach: 1200, minutes: 14, grounds: [7, 10], kinds: ['reef', 'flats', 'shore', 'boil', 'birds'], size: 0.15, legend: 0, stars: [24, 48, 80], blurb: 'The reefs and rocks: snapper, grouper, hogfish — and what hunts them.' },
  { id: 'wreck-ledge', label: 'Wreck & Ledge', water: SEA, difficulty: 5, reach: 2000, minutes: 16, grounds: [8, 11], kinds: ['reef', 'drop', 'wreck', 'birds', 'boil'], size: 0.3, legend: 0.15, stars: [50, 100, 165], blurb: 'Deeper water and the old wrecks. Bigger fish, heavier gear.' },
  { id: 'offshore-edge', label: 'Offshore Edge', water: SEA, difficulty: 6, reach: 3000, minutes: 18, grounds: [8, 12], kinds: ['drop', 'birds', 'boil', 'wreck', 'blue'], size: 0.4, legend: 0.2, stars: [62, 125, 205], blurb: 'Follow the birds along the edge: mackerel, bonito, tuna, mahi.' },
  { id: 'blue-water', label: 'Blue Water', water: SEA, difficulty: 8, reach: 4500, minutes: 20, grounds: [9, 13], kinds: ['blue', 'birds', 'drop', 'wreck', 'deep'], size: 0.55, legend: 0.3, stars: [105, 210, 340], blurb: 'Far out where the water turns cobalt. Tuna, wahoo, sailfish, marlin.' },
  { id: 'storm-run', label: 'Storm Run', water: SEA, difficulty: 10, reach: 4500, minutes: 22, grounds: [10, 14], kinds: ['blue', 'deep', 'wreck', 'drop', 'birds'], size: 0.7, legend: 0.6, stars: [230, 460, 750], storm: true, blurb: 'A rough sea and the biggest fish. The legends come up in weather like this.' },
  { id: 'lily-pads', label: 'Lily Pads', water: LAKE, difficulty: 1, reach: 0, minutes: 12, grounds: [5, 6], kinds: ['pads', 'weed', 'rocks', 'boil'], size: 0, legend: 0, stars: [8, 17, 28], blurb: 'Bluegill and small bass round the pads. A worm and a bobber.' },
  { id: 'weed-line', label: 'Weed Line', water: LAKE, difficulty: 3, reach: 0, minutes: 14, grounds: [5, 7], kinds: ['weed', 'pads', 'rocks', 'drop', 'boil'], size: 0.15, legend: 0, stars: [20, 40, 65], blurb: 'Bass, pike and perch along the edge of the weed.' },
  { id: 'deep-basin', label: 'Deep Basin', water: LAKE, difficulty: 5, reach: 0, minutes: 16, grounds: [6, 8], kinds: ['hole', 'drop', 'rocks', 'weed'], size: 0.3, legend: 0.15, stars: [36, 73, 118], blurb: 'Down deep: trout, walleye and catfish.' },
  { id: 'dusk-bite', label: 'Dusk Bite', water: LAKE, difficulty: 7, reach: 0, minutes: 18, grounds: [6, 9], kinds: ['weed', 'drop', 'hole', 'pads', 'boil'], size: 0.45, legend: 0.25, dusk: true, stars: [66, 132, 215], blurb: 'The big ones come up as the light goes.' },
  { id: 'old-monster', label: 'Old Monster', water: LAKE, difficulty: 9, reach: 0, minutes: 20, grounds: [7, 9], kinds: ['hole', 'weed', 'drop', 'pads'], size: 0.65, legend: 0.6, stars: [107, 214, 350], blurb: 'Trophies, and the lake\'s own legend.' },
].map((t, k, all) => Object.freeze({ ...t, after: all.slice(0, k).reverse().find(o => o.water === t.water)?.id })));
export const TRIP_BY_ID = Object.freeze(Object.fromEntries(TRIPS.map(t => [t.id, t])));

// ------------------------------------------------------------------------------------------- kinds of ground
// hab: the species habitats it holds; depth [m] (a lake's: of its own deepest, 0..1); shore: within this many m of land
// (null: anywhere); steep: the bed falling at least this (m per m); far: at least this far from the dock (of reach);
// hidden: only the fish finder shows it; shows: what gives it away on the water; r: its radius [sea, lake] (m).
export const GROUNDS = Object.freeze({
  flats: { label: 'Flats', icon: '🏝️', water: SEA, hab: ['flats', 'sand', 'shore'], depth: [0.6, 3.5], shows: 'sand', r: [40, 0] },
  shore: { label: 'Rocky shore', icon: '🪨', water: SEA, hab: ['shore', 'rocks', 'flats'], depth: [1, 7], shore: 90, shows: 'rocks', r: [35, 0] },
  reef: { label: 'Reef', icon: '🪸', water: SEA, hab: ['reef', 'rocks'], depth: [4, 26], shows: 'dark', hiddenP: 0.35, r: [45, 0] },
  drop: { label: 'Drop-off', icon: '📉', water: 'both', hab: ['drop', 'open', 'reef', 'rocks'], depth: [6, 70], lake: [0.45, 1], steep: 0.06, hiddenP: 0.5, shows: 'line', r: [50, 18] },
  wreck: { label: 'Wreck', icon: '⚓', water: SEA, hab: ['wreck', 'reef', 'deep'], depth: [14, 80], far: 0.35, hidden: true, r: [30, 0] },
  birds: { label: 'Bird flock', icon: '🐦', water: SEA, hab: ['surface', 'open'], depth: [6, 600], far: 0.2, shows: 'birds', moves: true, r: [45, 0] },
  boil: { label: 'Surface boil', icon: '🫧', water: 'both', hab: ['surface', 'open', 'shore'], depth: [2, 600], lake: [0.2, 1], shows: 'boil', moves: true, r: [30, 14] },
  blue: { label: 'Blue water', icon: '🌊', water: SEA, hab: ['blue', 'surface', 'open'], depth: [35, 5000], far: 0.45, shows: 'blue', r: [70, 0] },
  deep: { label: 'The deep', icon: '🌑', water: SEA, hab: ['deep', 'blue'], depth: [80, 5000], far: 0.6, hidden: true, r: [60, 0] },
  pads: { label: 'Lily pads', icon: '🪷', water: LAKE, hab: ['pads', 'weed', 'shore'], lake: [0.04, 0.3], shore: 45, shows: 'pads', r: [0, 16] },
  weed: { label: 'Weed bed', icon: '🌿', water: LAKE, hab: ['weed', 'pads', 'open'], lake: [0.15, 0.5], shows: 'weed', r: [0, 20] },
  rocks: { label: 'Rocky point', icon: '🪨', water: LAKE, hab: ['rocks', 'shore', 'drop'], lake: [0.1, 0.6], shore: 35, shows: 'rocks', r: [0, 15] },
  hole: { label: 'Deep hole', icon: '🕳️', water: LAKE, hab: ['hole', 'bottom', 'deep'], lake: [0.72, 1], hidden: true, r: [0, 18] },
});
/** Casting anywhere else: a thin mix of what swims in open water. */
export const OPEN = Object.freeze({ sea: ['open', 'sand', 'surface', 'shore'], lake: ['open', 'bottom', 'surface', 'shore'] });

// ------------------------------------------------------------------------------------------- the grounds of a trip
/**
 * The places a trip may put its grounds, round a dock (cheap to keep: they depend on the land, not the seed). env: {
 * water: 'sea' | 'lake', depthAt(x, z) → m of this water there (0: land or other water), dock: { x, z }, reach (m),
 * area?: { x0, z0, x1, z1 } (a lake's) }. → [{ x, z, d (depth), steep, shore (m to land, ≤ 120), dist (m from the dock) }].
 */
export function groundSites(env) {
  const out = [], { dock } = env;
  const area = env.area || { x0: dock.x - env.reach, z0: dock.z - env.reach, x1: dock.x + env.reach, z1: dock.z + env.reach };
  const span = Math.max(area.x1 - area.x0, area.z1 - area.z0), step = Math.max(8, span / (env.water === LAKE ? 34 : 40));
  for (let x = area.x0 + step / 2; x < area.x1; x += step) for (let z = area.z0 + step / 2; z < area.z1; z += step) {
    const dist = Math.hypot(x - dock.x, z - dock.z);
    if (env.reach && dist > env.reach) continue;
    const d = env.depthAt(x, z); if (!(d > 0.4)) continue;
    const e = step * 0.35, gx = env.depthAt(x + e, z) - env.depthAt(x - e, z), gz = env.depthAt(x, z + e) - env.depthAt(x, z - e);
    let shore = 999;
    for (const r of [15, 35, 70, 120]) { if (shore < 999) break; for (let a = 0; a < 8; a++) { const t = a * Math.PI / 4; if (!(env.depthAt(x + Math.cos(t) * r, z + Math.sin(t) * r) > 0)) { shore = r; break; } } }
    out.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, d: Math.round(d * 10) / 10, steep: Math.round(Math.hypot(gx, gz) / (2 * e) * 1000) / 1000, shore, dist: Math.round(dist) });
  }
  return out;
}

/** Does a site suit a kind of ground (on this water, of a lake this deep at most, a trip reaching this far)? */
function suits(G, s, water, maxD, reach) {
  const far = s.dist / reach;
  if (far > 1) return false;
  if (G.water !== 'both' && G.water !== water) return false;
  if (water === LAKE) { const q = s.d / Math.max(1, maxD); if (G.lake && (q < G.lake[0] || q > G.lake[1])) return false; }
  else if (G.depth && (s.d < G.depth[0] || s.d > G.depth[1])) return false;
  if (G.shore && s.shore > G.shore) return false;
  if (G.steep && s.steep < (water === LAKE ? G.steep * 0.6 : G.steep)) return false;
  if (G.far && far < G.far) return false;
  return far > 0.06 || water === LAKE;
}

/**
 * The species of a water that hold on a kind of ground, with their weights on a trip of this difficulty: [[id, w]].
 * Rare fish turn up more on harder trips; epics only from difficulty 5; legends never here (they come by sighting).
 */
export function population(hab, water, difficulty, depth = null) {
  const out = [];
  for (const s of speciesIn(water)) {
    const k = s.hab.filter(h => hab.includes(h)).length; if (!k) continue;
    const r = s.rarity, d = difficulty;
    let w = RARITY[r].w * (r === 'uncommon' ? 1 + 0.1 * d : r === 'rare' ? 0.3 + 0.25 * d : r === 'epic' ? (d >= 5 ? (d - 4) * 0.45 : 0) : Math.max(0.35, 1.15 - 0.08 * d));
    w *= 0.6 + 0.4 * k;                                   // more of its habitats here
    if (depth !== null && water === SEA && (depth < s.depth[0] * 0.6 || depth > s.depth[1] * 1.6)) w *= 0.12;
    if (w > 0) out.push([s.id, Math.round(w * 100) / 100]);
  }
  return out;
}

/**
 * The trip: its grounds, bounties and the legend's sighting, from the seed (the run's) and the sites round the dock.
 * → { trip, seed, water, grounds: [{ id, kind, x, z, r, d, hidden, shows, fish (how many it holds), pop, legend? }],
 *     bounties: [...], legend: { species, ground, from, to (minutes into the trip) } | null, minutes, maxD }
 */
export function generateTrip(trip, seed, sites, { water = trip.water } = {}) {
  const rng = new RNG(`fish:${trip.id}:${seed}`), maxD = sites.reduce((m, s) => Math.max(m, s.d), 0), reach = trip.reach || Math.max(1, ...sites.map(s => s.dist));
  const want = rng.int(trip.grounds[0], trip.grounds[1]), sep = water === LAKE ? Math.max(25, Math.sqrt(sites.length) * 3) : 140;
  const grounds = [], taken = [];
  const kinds = [...trip.kinds];
  for (let k = 0, tries = 0; grounds.length < want && tries < want * 6; tries++, k++) {
    const kind = kinds[k % kinds.length], G = GROUNDS[kind];
    const ok = sites.filter(s => suits(G, s, water, maxD, reach) && taken.every(t => Math.hypot(t.x - s.x, t.z - s.z) > sep));
    if (!ok.length) continue;
    const s = rng.pick(ok); taken.push(s);
    const hidden = !!G.hidden || (G.hiddenP ? rng.chance(G.hiddenP) : false);
    const r = (water === LAKE ? G.r[1] : G.r[0]) * rng.float(0.85, 1.2);
    grounds.push({ id: `g${grounds.length + 1}`, kind, x: s.x, z: s.z, r: Math.round(r), d: s.d, hidden, shows: G.shows || null, fish: rng.int(5, 9) + Math.round(trip.difficulty / 2), pop: population(G.hab, water, trip.difficulty, s.d) });
  }
  // the legend: on a ground of its kind, for a few minutes some time into the trip
  let legend = null;
  if (rng.chance(trip.legend)) {
    const cands = legendsIn(water).flatMap(L => grounds.filter(g => GROUNDS[g.kind].hab.some(h => L.hab.includes(h))).map(g => [L, g]));
    if (cands.length) {
      const [L, g] = rng.pick(cands), from = Math.round(rng.float(0.25, 0.65) * trip.minutes * 10) / 10;
      legend = { species: L.id, ground: g.id, from, to: Math.round((from + Math.max(3, trip.minutes * 0.22)) * 10) / 10 };
      g.legend = L.id;
    }
  }
  return { trip: trip.id, seed, water, grounds, bounties: makeBounties(trip, grounds, rng), legend, minutes: trip.minutes, maxD };
}

// ------------------------------------------------------------------------------------------- bounties
/** Two or three goals for the trip, each worth a part of a 2★ trip's value. */
function makeBounties(trip, grounds, rng) {
  const par = trip.stars[1], seen = new Map();
  for (const g of grounds) for (const [id, w] of g.pop) { const s = speciesOf(id); if (s.rarity === 'common' || s.rarity === 'uncommon') seen.set(id, (seen.get(id) || 0) + w); }
  const common = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
  const make = {
    species: () => { const id = rng.pick(common); return id && { kind: 'species', species: id, n: 1, label: `Land a ${speciesOf(id).name}`, reward: 0.15 }; },
    size: () => { const id = rng.pick(common); if (!id) return null; const s = speciesOf(id), cm = Math.round(s.len[0] + (s.len[1] - s.len[0]) * rng.float(0.45, 0.6)); return { kind: 'size', species: id, cm, label: `A ${s.name} of ${cm} cm or more`, reward: 0.25 }; },
    count: () => { const n = 4 + Math.round(trip.difficulty / 3) + rng.int(0, 2); return { kind: 'count', n, label: `Keep ${n} fish`, reward: 0.15 }; },
    ground: () => ({ kind: 'ground', n: 3, label: 'Three fish from one ground', reward: 0.15 }),
    kinds: () => { const n = 3 + Math.round(trip.difficulty / 4); return { kind: 'kinds', n, label: `${n} different species`, reward: 0.2 }; },
    trophy: () => ({ kind: 'trophy', n: 1, label: 'A trophy-size fish', reward: 0.3 }),
    lure: () => ({ kind: 'lure', lure: 'topwater', n: 1, label: 'A fish on a topwater popper', reward: 0.2 }),
  };
  const pool = rng.shuffle(['species', 'size', 'count', 'ground', 'kinds', 'trophy', ...(trip.difficulty >= 3 ? ['lure'] : [])]);
  const n = trip.difficulty >= 5 ? 3 : 2, out = [];
  for (const k of pool) { if (out.length >= n) break; const b = make[k](); if (b) out.push({ id: `b${out.length + 1}`, ...b, reward: Math.round(par * b.reward) }); }
  return out;
}
/**
 * Where a ground is `minute` minutes into the trip: the bird flocks and the boils wander (a slow loop round where they
 * began, the same on the server and in the browser); the rest stay put.
 */
export function groundPos(g, minute = 0, water = 'sea') {
  if (!GROUNDS[g.kind]?.moves) return { x: g.x, z: g.z };
  let h = 0; for (const ch of g.id + g.kind) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const R = water === LAKE ? 12 : 70, w = 0.22 + (h % 7) * 0.02, ph = (h % 628) / 100;
  return { x: g.x + R * Math.sin(minute * w + ph), z: g.z + R * Math.cos(minute * w * 0.8 + ph) };
}
/** The ground the lure is on at (x, z), minute minutes in: the nearest whose circle holds it, or null (open water). */
export function groundAt(plan, x, z, minute = 0) {
  let best = null, bd = Infinity;
  for (const g of plan.grounds) { const p = groundPos(g, minute, plan.water), d = Math.hypot(p.x - x, p.z - z); if (d <= g.r && d < bd) { bd = d; best = g; } }
  return best;
}
/** Which bounties a catch meets: catch [{ species, cm, size, ground, lure, kept }] → bounty ids. */
export function bountiesMet(bounties, caught) {
  const kept = caught.filter(c => c.kept !== false && c.species && speciesOf(c.species));
  const byGround = new Map(); for (const c of kept) if (c.ground) byGround.set(c.ground, (byGround.get(c.ground) || 0) + 1);
  return bounties.filter(b => {
    switch (b.kind) {
      case 'species': return kept.some(c => c.species === b.species);
      case 'size': return kept.some(c => c.species === b.species && c.cm >= b.cm);
      case 'count': return kept.length >= b.n;
      case 'ground': return [...byGround.values()].some(n => n >= b.n);
      case 'kinds': return new Set(kept.map(c => c.species)).size >= b.n;
      case 'trophy': return kept.some(c => c.size === 'trophy');
      case 'lure': return kept.some(c => c.lure === b.lure);
      default: return false;
    }
  }).map(b => b.id);
}

// ------------------------------------------------------------------------------------------- the bite
/** How active a species is at an hour of the day (0..24): its dawn, day, dusk and night, blended. */
export function activity(s, hour) {
  const [dawn, day, dusk, night] = s.act, h = ((hour % 24) + 24) % 24;
  const near = (c, w) => Math.max(0, 1 - Math.abs(((h - c + 36) % 24) - 12) / w);   // 1 at hour c, 0 w hours away
  const kDawn = near(6.2, 2.2), kDusk = near(19, 2.2), isDay = h > 8 && h < 17.5 ? 1 : 0, isNight = h < 4.5 || h > 21 ? 1 : 0;
  const rest = Math.max(0, 1 - kDawn - kDusk);
  return kDawn * dawn + kDusk * dusk + rest * (isDay ? day : isNight ? night : (day + night) / 2);
}
/** How well a lure suits a species (1 takes it; a lure it doesn't take still gets the odd bite). */
export const lureMatch = (s, lure) => (s.lures.includes(lure) ? 1 : 0.06);

/**
 * What bites: the server's roll (its own RNG: the browser can't know or pick). ground: one of the trip's (or null:
 * open water); ctx: { lure, hour, difficulty, luck (0..), minute (into the trip), legend (the trip's), water, size
 * (the trip's size bias), trolling }. → { kind: 'fish', species, u, cm, kg, size, slots } | { kind: 'find', id } |
 * null (nothing that takes this lure here).
 */
export function rollBite(rng, ground, ctx) {
  const water = ctx.water, lure = LURE_BY_ID[ctx.lure];
  if (!lure) return null;
  // a legend, when it is about, on its ground, to a lure it takes
  if (ground?.legend && ctx.legend && ctx.legend.ground === ground.id && ctx.minute >= ctx.legend.from && ctx.minute <= ctx.legend.to) {
    const L = speciesOf(ground.legend);
    if (L && L.lures.includes(ctx.lure) && rng.chance(0.16 + 0.5 * (ctx.luck || 0))) return { kind: 'fish', ...fishOf(L, rng.float(0.2, 1)) };
  }
  // junk and treasure from the bottom
  if ((lure.kind === 'bottom' || ground?.kind === 'wreck') && rng.chance(ground?.kind === 'wreck' ? 0.07 : 0.035)) return { kind: 'find', id: rng.weighted(FINDS.map(f => [f.id, f.w])) };
  const pop = ground ? ground.pop : population(OPEN[water], water, ctx.difficulty);
  const entries = [];
  for (const [id, w0] of pop) {
    const s = speciesOf(id);
    let w = w0 * lureMatch(s, ctx.lure) * (0.15 + activity(s, ctx.hour));
    if (lure.kind === 'troll' && !s.lures.includes('skirt')) w *= 0.2;
    if (s.rarity !== 'common') w *= 1 + (ctx.luck || 0) * (s.rarity === 'uncommon' ? 0.5 : 1.2);
    if (w > 0.001) entries.push([s, w]);
  }
  if (!entries.length) return null;
  const s = rng.weighted(entries);
  // its size: bigger ones on harder trips and with luck (u nearer 1)
  const bias = 1 + (ctx.size || 0) * 1.4 + (ctx.luck || 0) * 1.5;
  let u = Math.pow(rng.next(), 1 / bias), f = fishOf(s, u);
  // one too heavy for the angler's rod (ctx.maxKg) is usually a smaller one (2026-10-15, polish: a beginner lost one
  // fish in eight to "too heavy"); now and then the big one still comes — the one that got away, and a reason to upgrade
  if (ctx.maxKg && f.kg > ctx.maxKg && rng.chance(0.6)) {
    for (let k = 0; k < 24 && f.kg > ctx.maxKg * 0.6; k++) { u *= 0.85; f = fishOf(s, u); }
  }
  return { kind: 'fish', ...f };
}

/**
 * The browser's pacing: about how many seconds a lure waits for a bite (on a ground, a suited lure, at its hour; the
 * open water much slower; a fished-out ground slower). Not trusted: the server only keeps hooks a few seconds apart.
 */
export function biteEvery(ground, lure, hour, water, vis = 0.5) {
  if (!LURE_BY_ID[lure]) return 999;
  const pop = ground ? ground.pop : population(OPEN[water], water, 3);
  let tot = 0, suit = 0;
  for (const [id, w] of pop) { const s = speciesOf(id); tot += w; suit += w * lureMatch(s, lure) * (0.15 + activity(s, hour)); }
  if (!tot) return 999;
  const k = suit / tot, base = ground ? 7 : 26, left = ground ? Math.max(0.25, Math.min(1, ground.fish / 6)) : 1;
  return Math.min(120, base / Math.max(0.05, k) / left * (0.75 + 0.5 * vis));
}

// ------------------------------------------------------------------------------------------- the catch and the score
/** How fresh the catch is: 1 back by dusk, then 3 % a minute late (lights add minutes, the livewell slows it). */
export function freshness(lateMin, boat = {}) {
  const late = Math.max(0, lateMin - (boat.lights || 0));
  return Math.max(0.3, 1 - 0.03 * late * (1 - (boat.livewell || 0) / 100));
}
/**
 * The trip's sale and score: kept fish at their value now (freshness; the trader's skill on the sale only), finds at
 * theirs, plus the bounties met. caught: [{ species | find, u, kg, cm, size, ground, lure, kept }]. → { score (VC of the
 * catch and bounties: the course's points), sale (VC paid at the store), fish, finds, bounties: [ids], items: [{…, vc}] }.
 */
export function tripValue(trip, plan, caught, { lateMin = 0, boat = {}, trader = 0 } = {}) {
  const fresh = freshness(lateMin, boat), items = [];
  let value = 0;
  for (const c of caught) {
    if (c.kept === false) continue;
    if (c.find) { const f = FINDS.find(x => x.id === c.find); const vc = f ? f.val : 0; value += vc; items.push({ ...c, vc }); continue; }
    const s = speciesOf(c.species); if (!s) continue;
    const vc = valueOf(s, c.kg, c.u, fresh); value += vc; items.push({ ...c, vc });
  }
  const met = bountiesMet(plan.bounties || [], caught), bonus = (plan.bounties || []).filter(b => met.includes(b.id)).reduce((a, b) => a + b.reward, 0);
  const r2 = v => Math.round(v * 100) / 100;
  return { score: r2(value + bonus), sale: r2((value + bonus) * (1 + trader)), value: r2(value), bonus, fresh, bounties: met, items,
    fish: items.filter(i => i.species).length, finds: items.filter(i => i.find).length };
}

export { SPECIES, sizeOf };
