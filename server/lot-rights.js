// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who may change what in the world, by lot (WP4.6/4.13, wp4-world-spec.md §5.0, DECISIONS E25 (8)): on a world with lots,
// holders (and the people they share rights with) change the buildings, interiors and furniture on their own lots;
// administrators (world.edit) do so on the city's land; residents stay with administrators. A new building must stand
// inside one lot the person may build on, within that lot's envelope (setbacks from every lot line, the zoning's height).
// Worlds without lots keep the earlier rule: administrators edit everything.
import { corners } from '../shared/geom.js';
import { decorBase, DECOR_ADMIN_ONLY } from '../shared/decor.js';
import { mToUm } from '../shared/units.js';
import { contains, normalize, classifyPoint, DEFAULT_ENVELOPES, ENVELOPE_FALLBACK as ENV_FALLBACK } from '../shared/lots.js';
export { DEFAULT_ENVELOPES };


/** A building's footprint (grown by pad m) as a lot-geometry polygon in µm; turned buildings stay turned. */
const footPoly = (b, pad = 0) => corners(b, pad).map(p => ({ x: mToUm(p.x), z: mToUm(p.z) }));
const NEED = { 'item.add': 'furnish', 'item.move': 'furnish', 'item.del': 'furnish', 'item.tint': 'furnish', 'item.sign': 'furnish', 'bld.set': 'build', 'bld.signs': 'build', 'bld.floors': 'build', 'bld.del': 'build', 'bld.place': 'build', 'wall.add': 'build', 'wall.del': 'build', 'wall.door': 'build', 'wall.edit': 'build', 'lvl.clear': 'build', 'lvl.regen': 'build', 'lvl.reset': 'build', 'lvl.apply': 'build' };

export class LotRights {
  /** @param {import('./property.js').Property} property @param {() => object} world */
  constructor(property, world, { envelopes = DEFAULT_ENVELOPES } = {}) { this.property = property; this.world = world; this.envelopes = envelopes; }
  /** Whether this world uses lots (its buildings carry lot ids, or lots exist). */
  get active() { return this.property.count() > 0; }
  envelope(zoning) { return this.envelopes[zoning] || ENV_FALLBACK; }
  /**
   * Why `actor` may not apply op `o`, or null. actor: { admin (world.edit), subject: {kind,id}|null, name, agentBody?(i) }.
   * `spec` is the normalised building spec for bld.add.
   */
  check(o, actor, spec = null) {
    // an agent's owner (or an account it is shared with to manage) dresses its body - its look and nothing else (the
    // Agent Studio; actor.agentBody is the edit route's check of who manages which agent)
    if (o.op === 'person.set' && !actor.admin && Object.keys(o).every(k => k === 'op' || k === 'i' || k === 'app')) return actor.agentBody?.(o.i | 0) ? null : 'Only administrators manage residents';
    if (!this.active) return actor.admin ? null : 'Only administrators can edit this world';
    if (o.op === 'person.set' || o.op === 'person.add' || o.op === 'person.del') return actor.admin ? null : 'Only administrators manage residents';
    if (o.op === 'road.set' || o.op === 'road.del') return actor.admin ? null : 'Only administrators change roads';
    if (o.op === 'terrain.add' || o.op === 'terrain.del') return actor.admin ? null : 'Only administrators change the land';
    if (o.op === 'deco.add' || o.op === 'deco.move' || o.op === 'deco.del') return null;   // checked where it stands (decorWhy)
    if (o.op === 'sign.hide') return actor.admin ? null : 'Only administrators hide signs';   // moderation, on any lot
    if (o.op.startsWith('station.')) return actor.admin ? null : 'Only administrators place subway stations';
    if (o.op.startsWith('ferry.')) return actor.admin ? null : 'Only administrators run ferries';
    if (o.op.startsWith('coast.') || o.op.startsWith('island.')) return actor.admin ? null : 'Only administrators shape the coasts and the island chain';
    if (o.op === 'bld.add') return this.checkPlacement(spec, actor);
    const need = NEED[o.op];
    // an op with no rights of its own named here is the administrators' (fail closed: one added later never opens to
    // holders by omission - step 8, 2026-10-08); flats and doors are checked by the editor itself (edit.js op)
    if (!need) return actor.admin ? null : 'Only administrators can do this';
    const B = this.world().buildings[o.b | 0];
    if (!B || B.gone) return null;   // the editor answers "No such building"
    const lot = B.lot ? this.property.get(B.lot) : null;
    if (!lot) return actor.admin ? null : `${B.name || 'This building'} isn't on a lot you hold`;
    if (!this.property.can({ admin: actor.admin, subject: actor.subject }, lot, need)) return `You don't hold ${need === 'furnish' ? 'furnishing' : 'build'} rights on lot ${lot.id}`;
    if (o.op === 'bld.floors') {
      const env = this.envelope(lot.zoning), n = o.floors | 0;
      if (n > env.maxFloors) return `${lot.zoning} zoning allows at most ${env.maxFloors} floors on lot ${lot.id}`;
    }
    if (o.op === 'bld.place' && spec) return this.checkPlacement(spec, actor);   // where it goes: a lot I may build on
    return null;
  }
  /** A new building: inside exactly one lot the actor may build on, within the envelope. */
  checkPlacement(spec, actor) {
    if (!spec) return 'Bad building';
    const poly = normalize(footPoly(spec));
    const under = this.property.under(poly);
    if (!under.length) return 'A building must stand on a lot';
    if (under.length > 1 || !under[0].inside) return `The building crosses a lot line (lot ${under.map(u => u.lot.id).join(', ')}); keep it inside one lot`;
    const lot = under[0].lot;
    if (!this.property.can({ admin: actor.admin, subject: actor.subject }, lot, 'build')) return `You don't hold build rights on lot ${lot.id}`;
    const env = this.envelope(lot.zoning);
    if (env.setback > 0 && !contains(lot.poly, normalize(footPoly(spec, env.setback)))) return `Keep the building at least ${Math.round(env.setback / 0.3048)} ft from the lot lines`;
    if ((spec.floors | 0) > env.maxFloors) return `${lot.zoning} zoning allows at most ${env.maxFloors} floors here`;
    if (spec.type === 'park' && lot.zoning !== 'park') return 'Parks go on park-zoned land';
    return null;
  }
  /** A decoration at d: inside one lot the actor may decorate, or for administrators public land (spec §9, WP4.7). */
  decorWhy(d, actor, { removing = false } = {}) {
    if (DECOR_ADMIN_ONLY.includes(d.t)) {
      // the Marketing tools' billboards and street signs carry the ads: administrators put them up, on public land or
      // the city's lots; one left
      // on a lot that changed hands some other way may still be taken down by whoever may decorate it
      if (!actor.admin && !removing) return 'Only administrators put up billboards and street signs (Marketing)';
      const under = this.active ? this.property.under(normalize(decorBase(d).map(p => ({ x: mToUm(p.x), z: mToUm(p.z) })))) : [];
      if (removing && !actor.admin) return under.length === 1 && this.property.can({ admin: false, subject: actor.subject }, under[0].lot, 'decorate') ? null : 'Only administrators take down billboards and street signs';
      if (under.length > 1 || (under.length && !under[0].inside)) return `It crosses a lot line (lot ${under.map(u => u.lot.id).join(', ')}); keep its base inside one lot or off the lots`;
      if (under.length && under[0].lot.holder?.kind !== 'municipality') return `Lot ${under[0].lot.id} is held by a player: billboards and street signs stand on public land or the city's lots`;
      if (under.length && !['municipal', 'unreleased'].includes(under[0].lot.lifecycle)) return `Lot ${under[0].lot.id} is ${under[0].lot.lifecycle === 'available' ? 'for sale' : under[0].lot.lifecycle}: put billboards on city land that isn't`;
      return null;
    }
    if (!this.active) return actor.admin ? null : 'Only administrators can edit this world';
    const under = this.property.under(normalize(decorBase(d).map(p => ({ x: mToUm(p.x), z: mToUm(p.z) }))));
    if (!under.length) return actor.admin ? null : 'Place it on a lot you hold';
    if (under.length > 1 || !under[0].inside) return `It crosses a lot line (lot ${under.map(u => u.lot.id).join(', ')}); keep it inside one lot`;
    const lot = under[0].lot;
    return this.property.can({ admin: actor.admin, subject: actor.subject }, lot, 'decorate') ? null : `You can't decorate lot ${lot.id}`;
  }
  /** The lot a decoration stands on, or null. */
  decorLot(d) { const u = this.property.under(normalize(decorBase(d).map(p => ({ x: mToUm(p.x), z: mToUm(p.z) })))); return u.length === 1 ? u[0].lot.id : null; }
  /** The Marketing tools' billboards and street signs standing on lot `id` (it can't be sold or handed over meanwhile). */
  adAssetsOn(id) { return (this.world().decorations || []).filter(d => DECOR_ADMIN_ONLY.includes(d.t) && d.lot === id); }
  /** The id of the lot (in use) whose inside holds world point (x, z) m, or null (public land, or right on a lot line). */
  lotAt(x, z) {
    const X = mToUm(x), Z = mToUm(z);
    for (const l of this.property.inBox({ x0: X, z0: Z, x1: X, z1: Z })) if (classifyPoint(BigInt(X), BigInt(Z), 1n, l.poly) === 'inside') return l.id;
    return null;
  }
  /** After a building is placed: its lot (stored on the building). */
  lotFor(spec) { const u = this.property.under(normalize(footPoly(spec))); return u.length === 1 ? u[0].lot.id : null; }
  /**
   * Undo/redo of an earlier edit: the actor must still hold the rights over every building the edit touched (spec §5.5:
   * rights are checked on undo and redo too). keys: the journal entry's state keys ('bp:b', 'bx:b', 'lv:n', 'p:i').
   */
  checkKeys(keys, actor, levelOwner, target = {}) {
    // an agent's look, undone or redone by an account that manages the agent (check() above)
    if (!actor.admin && keys.length && keys.every(k => k.startsWith('p:') && actor.agentBody?.(Number(k.slice(2))))) return null;
    if (!this.active) return actor.admin ? null : 'Only administrators can edit this world';
    for (const k of keys) {
      const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if (kind === 'p' || kind === 'pa' || kind === 'pl') { if (!actor.admin) return 'Only administrators manage residents'; continue; }
      if (kind === 'fl') { const B = this.world().buildings[+id.split(':')[0]], lot = B?.lot ? this.property.get(B.lot) : null; if (!actor.admin && !(lot && this.property.can({ admin: actor.admin, subject: actor.subject }, lot, 'build'))) return "Only the building's owner can undo changes to its flats"; continue; }
      if (kind === 'r') { if (!actor.admin) return 'Only administrators change roads'; continue; }
      if (kind === 'te') { if (!actor.admin) return 'Only administrators change the land'; continue; }
      if (kind === 'sn') { if (!actor.admin) return 'Only administrators place subway stations'; continue; }
      if (kind === 'fy') { if (!actor.admin) return 'Only administrators run ferries'; continue; }
      if (kind === 'co' || kind === 'is') { if (!actor.admin) return 'Only administrators shape the coasts and the island chain'; continue; }
      if (kind === 'dc') {   // a decoration: where it stands now and where it would stand
        const cur = (this.world().decorations || []).find(d => d.id === id), want = typeof target[k] === 'string' ? JSON.parse(target[k]) : target[k];
        for (const [d, removing] of [[cur, !want], [want, false]]) { if (!d) continue; const why = this.decorWhy(d, actor, { removing }); if (why) return why; }
        continue;
      }
      if (kind === 'bg') {   // a building moving back: the rights where it stands now and on the lot it goes back to
        const want = typeof target[k] === 'string' ? JSON.parse(target[k]) : target[k], B = this.world().buildings[+id];
        for (const lotId of [B?.lot, want?.lot]) {
          if (!lotId) { if (!actor.admin) return 'That change touched a building that isn\'t on a lot you hold'; continue; }
          const lot = this.property.get(lotId);
          if (!lot || !this.property.can({ admin: actor.admin, subject: actor.subject }, lot, 'build')) return `You no longer hold the rights on lot ${lotId}`;
        }
        continue;
      }
      // a floor layout (lv:n), its furniture (i:n:id), walls (lw:n) or mode (lm:n) belong to the building that uses it
      const onLevel = kind === 'lv' || kind === 'lw' || kind === 'lm' || kind === 'i';
      const b = onLevel ? levelOwner(+id.split(':')[0]) : +id;
      const B = this.world().buildings[b];
      if (!B || !B.lot) { if (!actor.admin) return 'That change touched a building that isn\'t on a lot you hold'; continue; }
      const lot = this.property.get(B.lot);
      if (!lot || !this.property.can({ admin: actor.admin, subject: actor.subject }, lot, kind === 'lv' || kind === 'i' || kind === 'lm' ? 'furnish' : 'build')) return `You no longer hold the rights on lot ${B.lot}`;
    }
    return null;
  }
}
