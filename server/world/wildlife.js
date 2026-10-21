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
const TICK = 0.5;                   // s between wildlife ticks (2 Hz)

function hash(str, n = 0) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
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
      this.step(I, H, now, threats, hour);
    }
    this.stats = { regions: this.regions.size, herds, animals, tickMs: Math.round((performance.now() - t0) * 1000) / 1000 };
  }
  /** A region's herds, from its habitats, the species' densities and the seed (the same every time it wakes). */
  wake(I, i, j, now) {
    const key = `${i},${j}`, R = { key, cx: (i + 0.5) * REGION, cz: (j + 0.5) * REGION, herds: [], seen: now };
    const pts = new Map(), n = REGION / SAMPLE;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      const x = i * REGION + (a + 0.5) * SAMPLE, z = j * REGION + (b + 0.5) * SAMPLE;
      if (I.cityDist(x, z) < I.p.plainMargin || I.inTown(x, z)) continue;
      const h = I.height(x, z); if (h < I.p.seaLevel + 1) continue;
      if (I.roads) { const nr = I.roads.net.nearest(x, z, 20); if (nr && nr.dist < I.roads.half.get(nr.id) + 4) continue; }
      if (I.waterAt(x, z)) continue;
      const hx = I.height(x + 2, z) - h, hz = I.height(x, z + 2) - h, ny = 1 / Math.sqrt((hx / 2) ** 2 + 1 + (hz / 2) ** 2);
      let k = biome(I, x, z, h, ny).kind;
      if (k === 'lawn') k = 'meadow'; else if (k === 'conifer') k = 'forest';
      (pts.get(k) || pts.set(k, []).get(k)).push({ x, z });
    }
    const total = n * n, areaKm2 = (REGION * REGION) / 1e6;
    for (const sp of this.species) {
      const anchors = sp.habitats.flatMap(hb => pts.get(hb) || []);
      if (!anchors.length) continue;
      const exp = sp.perKm2 * areaKm2 * (anchors.length / total), hk = `${this.seed}:${key}:${sp.id}`;
      const count = Math.min(MAX_HERDS, Math.floor(exp) + (hash(hk, 1) < exp % 1 ? 1 : 0));
      for (let h = 0; h < count; h++) {
        const a = anchors[Math.floor(hash(hk, 10 + h) * anchors.length)], hid = `${key}:${sp.id}:${h}`;
        const size = sp.group[0] + Math.floor(hash(hk, 20 + h) * (sp.group[1] - sp.group[0] + 1));
        const members = Array.from({ length: size }, (_, m) => {
          const x = a.x + (hash(hid, 100 + m) - 0.5) * 16, z = a.z + (hash(hid, 200 + m) - 0.5) * 16;
          return { x, z, x1: x, z1: z, t0: now, t1: now + hash(hid, 300 + m) * 8, mode: 'rest', yaw: hash(hid, 400 + m) * 6.283, col: Math.floor(hash(hid, 500 + m) * sp.colors.length) };
        });
        R.herds.push({ id: hid, sp, ax: a.x, az: a.z, habitats: new Set(sp.habitats), members, fled: -1e9, rnd: hash(hid, 7) });
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
        if (I.waterAt(tx, tz) || I.cityDist(tx, tz) < I.p.plainMargin) { tx = H.ax - dz / d * run; tz = H.az + dx / d * run; }
        if (I.waterAt(tx, tz)) break;
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
      let gx = 0, gz = 0, ok = false;
      for (let tries = 0; tries < 4 && !ok; tries++) {
        gx = H.ax + (hash(H.id, now * 13 + k * 31 + tries) - 0.5) * 34; gz = H.az + (hash(H.id, now * 17 + k * 37 + tries) - 0.5) * 34;
        ok = !I.waterAt(gx, gz) && I.cityDist(gx, gz) > I.p.plainMargin && !I.inTown(gx, gz) && !(I.roads && (() => { const nr = I.roads.net.nearest(gx, gz, 20); return nr && nr.dist < I.roads.half.get(nr.id) + 3; })());
      }
      if (!ok) { Object.assign(m, { x: p.x, z: p.z, x1: p.x, z1: p.z, t0: now, t1: now + 8, mode: 'rest' }); continue; }
      const len = Math.hypot(gx - p.x, gz - p.z), spd = sp.speed * (0.8 + 0.4 * r);
      Object.assign(m, { x: p.x, z: p.z, x1: gx, z1: gz, t0: now, t1: now + Math.max(1, len / spd), mode: 'walk', yaw: Math.atan2(-(gz - p.z), gx - p.x) });
    }
    // the herd's place drifts slowly, so herds roam their habitat over the day
    if (awake && hash(H.id, Math.floor(now / 30)) < 0.02 * TICK) {
      const nx = H.ax + (hash(H.id, now) - 0.5) * 40, nz = H.az + (hash(H.id, now + 1) - 0.5) * 40;
      if (!I.waterAt(nx, nz)) { H.ax = nx; H.az = nz; }
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
