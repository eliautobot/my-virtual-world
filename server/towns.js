// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Towns and home bases (shared/towns.js; 2026-10-23: "have the option for the users to set a property as their own
// HQ/Homebase and all their agents start from there"). A town is the lots given its name (a lot's region); a building is
// in its lot's town, one on no lot in the world's own. An account's home base is one of the lots it holds: the one it
// chose (the account setting property.homeBase, kept only while it holds that lot), else the first it came to hold;
// with none, a flat it owns; with neither, no home base — its home town is then the world's own. Its agents live and
// work in its home town (server/sim/population.js).
import { MAIN_TOWN, townName } from '../shared/towns.js';

export class Towns {
  /** @param {{ property: object, world: () => object, settings: object }} d */
  constructor({ property, world, settings }) { Object.assign(this, { property, worldOf: world, settings }); }

  /** The world's name (its own town's). */
  worldName() { return this.worldOf()?.name || ''; }
  name(id) { return townName(id, this.worldName()); }
  /** The town of lot `id` (MAIN_TOWN for none). */
  ofLot(id) { const l = id ? this.property.get(id) : null; return l && l.lifecycle !== 'retired' ? l.region || MAIN_TOWN : MAIN_TOWN; }
  /** The town of building b. */
  ofBuilding(b) { const B = this.worldOf()?.buildings?.[b]; return B && !B.gone ? this.ofLot(B.lot) : MAIN_TOWN; }
  /** Lot id → town, for every lot in use (one read for many look-ups). */
  lotTowns() { const m = new Map(); for (const l of this.property.all()) m.set(l.id, l.region || MAIN_TOWN); return m; }
  /** Building index → town, for every building standing. */
  buildingTowns() {
    const lots = this.lotTowns(), out = new Map();
    for (const B of this.worldOf()?.buildings || []) if (B && !B.gone) out.set(B.idx, (B.lot && lots.get(B.lot)) || MAIN_TOWN);
    return out;
  }
  /** Every town: [{ id, name, lots, buildings }], the world's own first, then by name. */
  list() {
    const by = new Map(this.property.regionCounts().map(t => [t.id, { id: t.id, name: this.name(t.id), lots: t.lots, buildings: 0 }]));
    if (!by.has(MAIN_TOWN)) by.set(MAIN_TOWN, { id: MAIN_TOWN, name: this.name(MAIN_TOWN), lots: 0, buildings: 0 });
    for (const t of this.buildingTowns().values()) { const r = by.get(t); if (r) r.buildings++; }
    return [...by.values()].sort((a, b) => (a.id === MAIN_TOWN ? -1 : b.id === MAIN_TOWN ? 1 : a.name.localeCompare(b.name)));
  }

  // ------------------------------------------------------------------------------------------- home bases
  /** The lots account `id` holds, the first it came to hold first. */
  held(id) {
    return this.property.heldBy({ kind: 'account', id: String(id) }).sort((a, b) => (a.holderSince ?? 0) - (b.holderSince ?? 0) || a.id.localeCompare(b.id));
  }
  /** The flats account `id` owns: [{ b, f, u }]. */
  flats(id) {
    const out = [];
    for (const [key, rec] of Object.entries(this.worldOf()?.flats || {})) {
      if (rec?.owner?.kind !== 'account' || String(rec.owner.id) !== String(id)) continue;
      const [b, f, u] = key.split(':').map(Number);
      if (this.worldOf()?.buildings?.[b] && !this.worldOf().buildings[b].gone) out.push({ b, f, u });
    }
    return out;
  }
  /**
   * Account `id`'s home base: { lot (or null), b (a building there, or -1), town, chosen (it picked it), name }.
   * Its choice while it still holds that lot; else the first lot it came to hold; else a flat it owns; else none (the
   * world's own town).
   */
  homeBase(id) {
    const held = this.held(id), want = String(this.settings?.accountValue(id, 'property.homeBase') || '');
    const lot = held.find(l => l.id === want) || held[0] || null;
    if (lot) {
      const B = (this.worldOf()?.buildings || []).find(x => x && !x.gone && x.lot === lot.id);
      return { lot: lot.id, b: B ? B.idx : -1, town: lot.region || MAIN_TOWN, chosen: lot.id === want, name: lot.name || B?.name || `Lot ${lot.id}` };
    }
    const fl = this.flats(id)[0];
    if (fl) { const B = this.worldOf().buildings[fl.b]; return { lot: null, b: fl.b, town: this.ofBuilding(fl.b), chosen: false, name: `${B.name || 'A building'}, flat ${fl.u + 1}` }; }
    return { lot: null, b: -1, town: MAIN_TOWN, chosen: false, name: '' };
  }
  /** Account `id`'s home town. */
  homeTown(id) { return id == null ? MAIN_TOWN : this.homeBase(id).town; }

  /**
   * What placing agents reads (server/sim/placement.js), read once for a pass: townOf(b), holderOf(b) ('city', or
   * 'account:<id>' for a lot a player holds), flat(b, f, u) (its record or null), base(owner) → { town, x, z } (the home
   * base's middle; with none, the world's own town round the headquarters).
   */
  places() {
    const W = this.worldOf(), lots = new Map(this.property.all().map(l => [l.id, l]));
    const town = new Map(), holder = new Map();
    for (const B of W?.buildings || []) {
      if (!B || B.gone) continue;
      const L = B.lot ? lots.get(B.lot) : null, h = L?.holder;
      town.set(B.idx, L?.region || MAIN_TOWN);
      holder.set(B.idx, !h || h.kind === 'municipality' ? 'city' : `${h.kind}:${h.id}`);
    }
    const hq = (W?.buildings || []).find(B => B && !B.gone && B.type === 'hq'), bases = new Map();
    const lotMiddle = L => ({ x: (L.bbox.x0 + L.bbox.x1) / 2e6, z: (L.bbox.z0 + L.bbox.z1) / 2e6 });
    return {
      townOf: b => town.get(b) || MAIN_TOWN,
      holderOf: b => holder.get(b) || 'city',
      flat: (b, f, u) => W?.flats?.[`${b}:${f}:${u}`] || null,
      base: owner => {
        if (bases.has(owner)) return bases.get(owner);
        const hb = owner == null ? null : this.homeBase(owner);
        let at = { x: hq?.x ?? 0, z: hq?.z ?? 0 };
        if (hb?.b >= 0 && W.buildings[hb.b]) at = { x: W.buildings[hb.b].x, z: W.buildings[hb.b].z };
        else if (hb?.lot && lots.get(hb.lot)) at = lotMiddle(lots.get(hb.lot));
        const r = { town: hb?.town || MAIN_TOWN, ...at };
        bases.set(owner, r);
        return r;
      },
    };
  }
}
