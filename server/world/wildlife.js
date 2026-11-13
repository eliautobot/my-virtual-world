// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Shared wildlife (WP4.17 tier 2, wp4-world-spec.md §6.3): the larger animals — deer, horses, cows, sheep and any
// catalogue species with tier 'shared' — are simulated by the server so everyone sees the same herd in the same place,
// running from the same walker or car. The island is cut into regions; a region wakes when someone is near (a player
// or a browser's camera) and sleeps again when nobody has been near for a while, so empty land costs nothing. A waking
// region gets its herds from its habitats (shared/biome.js), the species' densities and the seed — the same herds
// every time — and the clock (outside a species' hours the herd is bedded down). Each animal follows a small plan: a
// segment from where it is to where it goes (or a rest), re-planned only when the segment ends or the herd takes
// fright. Browsers receive the plans of the herds near them (area of interest) and move the animals smoothly between
// updates; heights come from the shared ground on each side.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpecies, activeAt } from '../../shared/species.js';
import { biome } from '../../shared/biome.js';
import { gridPads } from '../../shared/island-build.js';
import { Island } from '../../shared/terrain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REGION = 400;          // m: region size
const WAKE = 650;                   // m from a viewer to a region's centre that keeps it awake
const SLEEP_AFTER = 90;             // s without viewers before a region sleeps
const SEND_R = 800;                 // m: herds sent to a browser around its camera
const SAMPLE = 25;                  // m: habitat sampling grid in a region
const MAX_HERDS = 6;                // per species per region
const HAUNT_SLOPE = 0.866;          // (a herd at a haunt keeps to ground no steeper than 30°: a fall's gorge walls are not for standing on)
const HAUNT_CELL = 100;             // m: the grid the haunts' river points are kept in
const TICK = 0.5;                   // s between wildlife ticks (2 Hz)

function hash(str, n = 0) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/** Ground an animal can stand on: no water there, and not under the level of the river beside it (2026-11-12: a bear
 *  by a fall's lip stood in the river — the bank there dips under the water's drawn edge, just outside its width). */
export function dry(I, x, z) {
  const h = I.height(x, z); if (I.waterAt(x, z, h)) return false;
  const rv = I.riverAt(x, z);
  return !(rv && h < rv.level + 0.4);
}
/** The species catalogue entries of the shared tier (validated). */
export function sharedSpecies(dir = path.join(ROOT, 'shared/world-config/species')) {
  const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')), out = [];
  for (const id of idx.species) {
    const sp = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
    if (validateSpecies(sp).length || sp.tier !== 'shared') continue;
    out.push(sp);
  }
  return out;
}

export class Wildlife {
  /** @param world the live world (terrain, roads) @param {{ species?: object[], seed?: string, clock: () => object }} o */
  constructor(world, { species = sharedSpecies(), seed = 'world', clock }) {
    this.world = world; this.species = species; this.seed = seed; this.clock = clock;
    this.regions = new Map();   // key → { key, cx, cz, herds, seen }
    this.t = 0; this.acc = 0; this.version = 0;
    this.stats = { regions: 0, herds: 0, animals: 0, tickMs: 0 };
  }
  island() {
    const T = this.world.terrain; if (!T) return null;
    if (this._island?.of !== T || this._island.roads !== this.world.roads) {
      const I = new Island(T, { roads: this.world.roads || null }), grids = gridPads(this.world);
      // a grid's land is town, as the city is (2026-10-14: sheep grazed on a grid's paved lots)
      I.inTown = (x, z) => grids.some(P => { const dx = x - P.x, dz = z - P.z; return Math.abs(dx * Math.cos(P.rot) - dz * Math.sin(P.rot)) <= P.hw && Math.abs(dx * Math.sin(P.rot) + dz * Math.cos(P.rot)) <= P.hd; });
      // a grid laid out or taken away: the herds wake again from the seed (2026-10-14: horses that had settled there before
      // the grid stayed on its lots) — off the new town's land, back on the land it gave up
      const gk = JSON.stringify(grids.map(P => [P.x, P.z, P.hw, P.hd, P.rot]));
      if (this._island && this._island.gk !== gk) { this.regions.clear(); this.version++; }
      this._island = { of: T, roads: this.world.roads, I, gk };
    }
    return this._island.I;
  }
  /** The places animals keep near (species haunts), found from the island's own waterfalls, rivers and lakes, so they
   *  follow the land when it changes (a river traced anew, a pond dug): falls (each drop's lip and the pool at its foot:
   *  where the bears fish), river (its course), lake (lakes, tarns and ponds), water (any of them). near(kind, x, z, r):
   *  the nearest one whose edge is within r m of (x, z) — { x, z, r (its own radius), d (m from its edge) } — or null. */
  haunts(I) {
    if (this._haunts?.of === I) return this._haunts;
    const grid = new Map(), round = { falls: [], lake: [] }, cell = (x, z) => `${Math.floor(x / HAUNT_CELL)},${Math.floor(z / HAUNT_CELL)}`;
    for (const R of I.rivers || []) {
      for (const q of R.pts) { const k = cell(q.x, q.z); (grid.get(k) || grid.set(k, []).get(k)).push({ x: q.x, z: q.z, r: q.w / 2 }); }
      for (const d of R.drops || []) round.falls.push({ x: d.x, z: d.z, r: d.w / 2 });
    }
    for (const L of I.lakes || []) (L.pool ? round.falls : round.lake).push({ x: L.x, z: L.z, r: L.r });
    const best = (list, x, z, r, b) => { for (const f of list) { const d = Math.hypot(f.x - x, f.z - z) - f.r; if (d <= r && (!b || d < b.d)) b = { x: f.x, z: f.z, r: f.r, d }; } return b; };
    const river = (x, z, r) => {
      let b = null; const n = Math.ceil((r + 12) / HAUNT_CELL), ci = Math.floor(x / HAUNT_CELL), cj = Math.floor(z / HAUNT_CELL);
      for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) { const L = grid.get(`${i},${j}`); if (L) b = best(L, x, z, r, b); }
      return b;
    };
    const near = (kind, x, z, r) => kind === 'river' ? river(x, z, r) : kind === 'falls' || kind === 'lake' ? best(round[kind], x, z, r, null)
      : [river(x, z, r), best(round.falls, x, z, r, null), best(round.lake, x, z, r, null)].reduce((b, f) => f && (!b || f.d < b.d) ? f : b, null);
    return (this._haunts = { of: I, near, count: { falls: round.falls.length, lake: round.lake.length, river: [...grid.values()].reduce((s, L) => s + L.length, 0) } });
  }
  /** Advance by dt seconds. viewers: [{ x, z }] (players and browsers' cameras); threats: [{ x, z, r }] (people on foot,
   *  moving cars) that startle herds within their species' flee distance (+ r). */
  tick(dt, viewers, threats, hour) {
    const I = this.island(); if (!I || !this.species.length) return;
    this.t += dt; this.acc += dt;
    if (this.acc < TICK) return;
    this.acc = 0;
    const t0 = performance.now(), now = this.t;
    // wake the regions near someone, put to sleep the ones nobody has been near for a while
    for (const v of viewers) {
      const r = Math.ceil(WAKE / REGION);
      const ci = Math.floor(v.x / REGION), cj = Math.floor(v.z / REGION);
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        const cx = (i + 0.5) * REGION, cz = (j + 0.5) * REGION;
        if (Math.hypot(cx - v.x, cz - v.z) > WAKE) continue;
        const key = `${i},${j}`;
        let R = this.regions.get(key);
        if (!R) { R = this.wake(I, i, j, now); this.regions.set(key, R); this.version++; }
        R.seen = now;
      }
    }
    for (const [k, R] of this.regions) if (now - R.seen > SLEEP_AFTER) { this.regions.delete(k); this.version++; }
    let herds = 0, animals = 0;
    for (const R of this.regions.values()) for (const H of R.herds) {
      herds++; animals += H.members.length;
      // (one that goes with another's group keeps to its place: the rooster stays by his hens when they move on or run)
      if (H.with) { const O = R.herds.find(h => h.id === H.with); if (O) { H.ax = O.ax; H.az = O.az; } }
      this.step(I, H, now, threats, hour);
    }
    this.stats = { regions: this.regions.size, herds, animals, tickMs: Math.round((performance.now() - t0) * 1000) / 1000 };
  }
  /** A region's herds, from its habitats, the species' densities and the seed (the same every time it wakes). */
  wake(I, i, j, now) {
    const key = `${i},${j}`, R = { key, cx: (i + 0.5) * REGION, cz: (j + 0.5) * REGION, herds: [], seen: now };
    const pts = new Map(), n = REGION / SAMPLE, HN = this.haunts(I);
    R.land = {};   // (sample points of each kind of ground: the census, checks/live-census.mjs)
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const x = i * REGION + (a + 0.5) * SAMPLE, z = j * REGION + (b + 0.5) * SAMPLE;
      if (I.cityDist(x, z) < I.p.plainMargin || I.inTown(x, z)) continue;
      const h = I.height(x, z); if (h < I.p.seaLevel + 1) continue;
      if (I.roads) { const nr = I.roads.net.nearest(x, z, 20); if (nr && nr.dist < I.roads.half.get(nr.id) + 4) continue; }
      if (!dry(I, x, z)) { R.land.water = (R.land.water || 0) + 1; continue; }
      const hx = I.height(x + 2, z) - h, hz = I.height(x, z + 2) - h, ny = 1 / Math.sqrt((hx / 2) ** 2 + 1 + (hz / 2) ** 2);
      let k = biome(I, x, z, h, ny).kind;
      if (k === 'lawn') k = 'meadow'; else if (k === 'conifer') k = 'forest';
      (pts.get(k) || pts.set(k, []).get(k)).push({ x, z, h, ny });
      R.land[k] = (R.land[k] || 0) + 1;
    }
    const cellKm2 = (SAMPLE * SAMPLE) / 1e6;
    for (const sp of this.species) {
      if (sp.joins && !(sp.perKm2 > 0)) continue;   // (it only goes with another species' groups: below)
      // Each sample point of ground gets the species' density there (groups per km²): its perKm2 on its habitats, times
      // its liking for that kind of ground (habitatWeight: sheep keep to the farms' pastures, few out on the open
      // meadows), plus the density of each of its haunts that point is near (bears where the rivers fall, fishing). The
      // region's groups are as many as those densities add up to, each at a point drawn by its density.
      const hw = sp.habitatWeight || {}, haunts = sp.haunts || [], cand = [];
      let sum = 0;
      for (const [k, list] of pts) {
        const home = sp.habitats.includes(k), hs = haunts.filter(hn => home || hn.on?.includes(k));
        if (!home && !hs.length) continue;
        for (const p of list) {
          // (a species with an altitude keeps to the parts of its habitats that high: white tigers near the snowy peaks)
          if (sp.altitude && (p.h < sp.altitude[0] || p.h > sp.altitude[1])) continue;
          // (a species near water keeps to ground within that distance of a lake or river: moose)
          if (sp.nearWater && !HN.near('water', p.x, p.z, sp.nearWater)) continue;
          let d = home ? sp.perKm2 * (hw[k] ?? 1) : 0, at = null;
          if (p.ny >= HAUNT_SLOPE) for (const hn of hs) { const f = HN.near(hn.near, p.x, p.z, hn.within); if (f) { d += hn.perKm2; at ||= { kind: hn.near, f }; } }   // (the first of its haunts it is at, in the order given, is the one it keeps to)
          if (d > 0) { sum += d; cand.push({ p, c: sum, at }); }
        }
      }
      if (!cand.length) continue;
      const exp = sum * cellKm2, hk = `${this.seed}:${key}:${sp.id}`;
      const count = Math.min(MAX_HERDS, Math.floor(exp) + (hash(hk, 1) < exp % 1 ? 1 : 0));
      for (let h = 0; h < count; h++) {
        const u = hash(hk, 10 + h) * sum; let lo = 0, hi = cand.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cand[mid].c > u) hi = mid; else lo = mid + 1; }
        const { p: a, at } = cand[lo], hid = `${key}:${sp.id}:${h}`;
        const size = sp.group[0] + Math.floor(hash(hk, 20 + h) * (sp.group[1] - sp.group[0] + 1));
        const members = Array.from({ length: size }, (_, m) => {
          let x = a.x + (hash(hid, 100 + m) - 0.5) * 16, z = a.z + (hash(hid, 200 + m) - 0.5) * 16;
          if (!dry(I, x, z)) { x = a.x; z = a.z; }   // (not standing in the pool it came to)
          return { x, z, x1: x, z1: z, t0: now, t1: now + hash(hid, 300 + m) * 8, mode: 'rest', yaw: hash(hid, 400 + m) * 6.283, col: Math.floor(hash(hid, 500 + m) * sp.colors.length) };
        });
        // (at a haunt: the place it keeps to — its walks lead to the water's edge there, and its wanderings stay by it)
        const spot = at ? { kind: at.kind, x: at.f.x, z: at.f.z, r: at.f.r, within: haunts.find(hn => hn.near === at.kind).within } : null;
        R.herds.push({ id: hid, sp, ax: a.x, az: a.z, habitats: new Set(sp.habitats), members, fled: -1e9, rnd: hash(hid, 7), spot });
      }
    }
    // a species that goes along with another's groups (a rooster with the hens, an elder stag leading a herd of deer):
    // one of it beside a joinChance of them (those within its altitude, if it has one)
    for (const sp of this.species) {
      if (!sp.joins) continue;
      for (const H of R.herds.filter(h => h.sp.id === sp.joins && !h.with)) {
        const hid = `${H.id}:${sp.id}`; if (hash(hid, 1) >= sp.joinChance) continue;
        if (sp.altitude) { const h = I.height(H.ax, H.az); if (h < sp.altitude[0] || h > sp.altitude[1]) continue; }
        const size = sp.group[0] + Math.floor(hash(hid, 20) * (sp.group[1] - sp.group[0] + 1));
        const members = Array.from({ length: size }, (_, m) => {
          const x = H.ax + (hash(hid, 100 + m) - 0.5) * 10, z = H.az + (hash(hid, 200 + m) - 0.5) * 10;
          return { x, z, x1: x, z1: z, t0: now, t1: now + hash(hid, 300 + m) * 8, mode: 'rest', yaw: hash(hid, 400 + m) * 6.283, col: Math.floor(hash(hid, 500 + m) * sp.colors.length) };
        });
        R.herds.push({ id: hid, sp, ax: H.ax, az: H.az, habitats: new Set(sp.habitats), members, fled: -1e9, rnd: hash(hid, 7), with: H.id });
      }
    }
    return R;
  }
  /** Where a member is now (on its segment). */
  at(m, now) { const u = m.t1 > m.t0 ? Math.min(1, Math.max(0, (now - m.t0) / (m.t1 - m.t0))) : 1; return { x: m.x + (m.x1 - m.x) * u, z: m.z + (m.z1 - m.z) * u }; }
  /** Plans for a herd: take fright, or give members whose segment ended their next rest or walk. */
  step(I, H, now, threats, hour) {
    const sp = H.sp, awake = activeAt(sp, hour);
    if (sp.flee > 0 && now - H.fled > 12) {
      for (const T of threats) {
        let near = null;
        for (const m of H.members) { const p = this.at(m, now); if (Math.hypot(p.x - T.x, p.z - T.z) < sp.flee + (T.r || 0)) { near = p; break; } }
        if (!near) continue;
        // run together away from the threat, to a spot on dry land
        const dx = near.x - T.x, dz = near.z - T.z, d = Math.hypot(dx, dz) || 1, run = sp.flee * 2.5 + 15;
        let tx = H.ax + dx / d * run, tz = H.az + dz / d * run;
        if (!dry(I, tx, tz) || I.cityDist(tx, tz) < I.p.plainMargin) { tx = H.ax - dz / d * run; tz = H.az + dx / d * run; }
        if (!dry(I, tx, tz)) break;
        H.ax = tx; H.az = tz; H.fled = now;
        H.members.forEach((m, k) => {
          const p = this.at(m, now), gx = tx + (hash(H.id, now * 7 + k) - 0.5) * 14, gz = tz + (hash(H.id, now * 11 + k) - 0.5) * 14;
          const len = Math.hypot(gx - p.x, gz - p.z), spd = sp.run * (0.9 + 0.2 * hash(H.id, k + 50));
          Object.assign(m, { x: p.x, z: p.z, x1: gx, z1: gz, t0: now, t1: now + len / spd, mode: 'run', yaw: Math.atan2(-(gz - p.z), gx - p.x) });
        });
        this.version++;
        return;
      }
    }
    for (const [k, m] of H.members.entries()) {
      if (now < m.t1) continue;
      const p = { x: m.x1, z: m.z1 }, r = hash(H.id, Math.floor(now * 10) + k * 977);
      if (!awake || m.mode !== 'rest' || r < 0.45) {   // rest (bedded down outside its hours)
        Object.assign(m, { x: p.x, z: p.z, x1: p.x, z1: p.z, t0: now, t1: now + (awake ? 6 + r * 16 : 60 + r * 60), mode: 'rest' });
        continue;
      }
      // a short walk to a nearby spot of its habitat around the herd's place
      // (at a haunt, now and then down to the water's edge there, so it stands facing the water: a bear at the falls; a walk
      // never wades through the water on its way)
      let gx = 0, gz = 0, ok = false;
      const S = H.spot, edge = S && hash(H.id, now * 19 + k * 41) < 0.5;
      for (let tries = 0; tries < 4 && !ok; tries++) {
        if (edge && tries < 2) {
          const ex = S.x - p.x, ez = S.z - p.z, ed = Math.hypot(ex, ez) || 1, go = Math.min(40, Math.max(2, ed - S.r - 2 - tries * 3)), side = (hash(H.id, now * 23 + k * 43 + tries) - 0.5) * 8;
          gx = p.x + ex / ed * go - ez / ed * side; gz = p.z + ez / ed * go + ex / ed * side;
        } else { gx = H.ax + (hash(H.id, now * 13 + k * 31 + tries) - 0.5) * 34; gz = H.az + (hash(H.id, now * 17 + k * 37 + tries) - 0.5) * 34; }
        ok = dry(I, gx, gz) && dry(I, p.x + (gx - p.x) / 3, p.z + (gz - p.z) / 3) && dry(I, p.x + (gx - p.x) * 2 / 3, p.z + (gz - p.z) * 2 / 3) && I.cityDist(gx, gz) > I.p.plainMargin && !I.inTown(gx, gz) && !(I.roads && (() => { const nr = I.roads.net.nearest(gx, gz, 20); return nr && nr.dist < I.roads.half.get(nr.id) + 3; })());
      }
      if (!ok) { Object.assign(m, { x: p.x, z: p.z, x1: p.x, z1: p.z, t0: now, t1: now + 8, mode: 'rest' }); continue; }
      const len = Math.hypot(gx - p.x, gz - p.z), spd = sp.speed * (0.8 + 0.4 * r);
      Object.assign(m, { x: p.x, z: p.z, x1: gx, z1: gz, t0: now, t1: now + Math.max(1, len / spd), mode: 'walk', yaw: Math.atan2(-(gz - p.z), gx - p.x) });
    }
    // the herd's place drifts slowly, so herds roam their habitat over the day
    if (awake && hash(H.id, Math.floor(now / 30)) < 0.02 * TICK) {
      const nx = H.ax + (hash(H.id, now) - 0.5) * 40, nz = H.az + (hash(H.id, now + 1) - 0.5) * 40;
      // (a herd at a haunt wanders only round it)
      const S = H.spot, by = !S || Math.hypot(nx - S.x, nz - S.z) - S.r <= S.within;
      if (by && dry(I, nx, nz)) { H.ax = nx; H.az = nz; }
    }
  }
  /** The herds within SEND_R of (x, z), for one browser: { wt (s, wildlife clock), herds: [{ id, s (species), m: [[x, z, x1, z1, t0, t1, mode, yaw, col], …] }] }. */
  view(x, z) {
    const herds = [], r = Math.ceil(SEND_R / REGION), ci = Math.floor(x / REGION), cj = Math.floor(z / REGION), r2 = v => Math.round(v * 100) / 100;
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const R = this.regions.get(`${i},${j}`); if (!R) continue;
      for (const H of R.herds) {
        if (Math.hypot(H.ax - x, H.az - z) > SEND_R) continue;
        herds.push({ id: H.id, s: H.sp.id, m: H.members.map(m => [r2(m.x), r2(m.z), r2(m.x1), r2(m.z1), r2(m.t0), r2(m.t1), m.mode === 'walk' ? 1 : m.mode === 'run' ? 2 : 0, r2(m.yaw), m.col]) });
      }
    }
    return { wt: Math.round(this.t * 100) / 100, herds };
  }
}
