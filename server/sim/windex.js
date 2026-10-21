// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// World index: per-level slot tables (building-local coords), public venue lists, apartment unit contents.
import { CATALOG, USE_ID } from '../../shared/catalog.js';
import { itemToLocal } from '../../shared/geom.js';
import { animId, SEATED, PROP } from '../../shared/anims.js';

const PUBLIC_TYPES = new Set(['cafe', 'restaurant', 'shop', 'gym', 'park']);

export class WorldIndex {
  constructor(world) {
    this.world = world;
    this.cache = new Map();
    this.units = new Map();
    this.usesCache = new Map();
    this.rebuild();
  }
  /** Map itemId -> { it, slots: [{ k, lx, lz, ax, az, yaw, anim, use, uid, y, prop, dur, seated, moveIn }] } */
  slots(lv) {
    let m = this.cache.get(lv);
    if (m) return m;
    m = new Map();
    const L = this.world.levels[lv];
    const restaurant = L.venue === 'restaurant';
    for (const it of L.items) {
      const def = CATALOG[it.t];
      if (!def || !def.slots.length) continue;
      const slots = def.slots.map((s, k) => {
        const p = itemToLocal(it, s.x, s.z), q = itemToLocal(it, s.ax ?? s.x, s.az ?? s.z);
        const anim = animId(s.anim);
        let use = s.use;
        if (restaurant && use === 'cook') use = 'staff';
        return {
          k, lx: p.x, lz: p.z, ax: q.x, az: q.z, yaw: s.yaw + (it.r || 0), anim, use, uid: USE_ID[use] ?? 0,
          y: s.y || 0, prop: PROP[s.prop || 'none'] || 0, dur: s.dur || null, seated: SEATED.has(anim),
          moveIn: Math.hypot(p.x - q.x, p.z - q.z) > 0.05,
        };
      });
      m.set(it.id, { it, slots });
    }
    this.cache.set(lv, m);
    return m;
  }
  entry(b, f, id) {
    const B = this.world.buildings[b];
    if (!B || B.gone || f < 0 || f >= B.floors) return null;
    return this.slots(B.lv[f]).get(id) || null;
  }
  isPublicFloor(b, f) {
    const B = this.world.buildings[b];
    if (!B || B.gone) return false;
    if (PUBLIC_TYPES.has(B.type)) return true;
    if (f === 0) { const v = this.world.levels[B.lv[0]].venue; if (v && v !== 'lounge') return true; }
    return false;
  }
  rebuild() {
    this.pub = new Map();
    this.venues = { cafe: [], restaurant: [], shop: [], gym: [], park: [], lounge: [] };
    for (const B of this.world.buildings) {
      if (B.gone) continue;
      for (let f = 0; f < B.floors; f++) {
        const v = this.world.levels[B.lv[f]].venue;
        if (v === 'lounge') this.venues.lounge.push({ b: B.idx, f, x: B.x, z: B.z });
        if (!this.isPublicFloor(B.idx, f)) continue;
        if (v && this.venues[v] && v !== 'lounge') this.venues[v].push({ b: B.idx, f, x: B.x, z: B.z });
        const uses = new Set();
        for (const e of this.slots(B.lv[f]).values()) for (const s of e.slots) if (s.use !== 'staff') uses.add(s.use);
        for (const u of uses) {
          if (!this.pub.has(u)) this.pub.set(u, []);
          this.pub.get(u).push({ b: B.idx, f, x: B.x, z: B.z });
        }
      }
    }
  }
  /** Set of item types inside apartment unit u of level lv (incl. decor without slots). */
  unitTypes(lv, u) {
    const key = 't' + lv + ':' + u;
    let r = this.units.get(key);
    if (!r) {
      const U = this.world.levels[lv].units?.[u];
      r = new Set();
      if (U) for (const it of this.world.levels[lv].items) if (it.x >= U.x0 && it.x <= U.x1 && it.z >= U.z0 && it.z <= U.z1) r.add(it.t);
      this.units.set(key, r);
    }
    return r;
  }
  /** Cached [itemId, slotK, slot] list for a use (string) or set/array of uses. */
  findUsesCached(lv, uses) {
    const uk = typeof uses === 'string' ? uses : [...uses].sort().join(',');
    const key = lv + '|' + uk;
    let r = this.usesCache.get(key);
    if (!r) { r = this.findUses(lv, typeof uses === 'string' ? uses : new Set(uses)); this.usesCache.set(key, r); }
    return r;
  }
  invalidate(lv) {
    this.cache.delete(lv);
    for (const k of [...this.usesCache.keys()]) if (k.startsWith(lv + '|')) this.usesCache.delete(k);
    for (const k of [...this.units.keys()]) if (k.startsWith('t' + lv + ':')) this.units.delete(k);
    for (const k of [...this.units.keys()]) if (k.startsWith(lv + ':')) this.units.delete(k);
  }
  /** Item ids (with slots) inside apartment unit u of level lv. */
  unitItems(lv, u) {
    const key = lv + ':' + u;
    let r = this.units.get(key);
    if (!r) {
      const U = this.world.levels[lv].units?.[u];
      r = [];
      if (U) for (const [id, e] of this.slots(lv)) if (e.it.x >= U.x0 && e.it.x <= U.x1 && e.it.z >= U.z0 && e.it.z <= U.z1) r.push(id);
      this.units.set(key, r);
    }
    return r;
  }
  /** All [itemId, slotK] on a level whose slot use is in `uses`. */
  findUses(lv, uses, filterIds = null) {
    const out = [];
    const m = this.slots(lv);
    const ids = filterIds || m.keys();
    for (const id of ids) {
      const e = m.get(id); if (!e) continue;
      for (const s of e.slots) if (uses.has ? uses.has(s.use) : uses === s.use) out.push([id, s.k, s]);
    }
    return out;
  }
}
