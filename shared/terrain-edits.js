// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Terrain edits (WP4.7, wp4-world-spec.md §9): administrators reshape the land beyond the city with brush strokes over
// the generated island: raise or lower ground, flatten it to a level, dig a pond, clear woodland or plant it. Strokes
// are kept in order in world.terrain.edits and applied by the one height function every browser and the server share
// (shared/terrain.js), so everyone sees the same ground; an edit never touches the city, a road, a building or a lot
// someone holds (shared/terrain-rules.js). A stroke: { id, kind, x, z, r (m), soft (0..1: how much of the radius
// fades), amount (m: raise/lower) | level (m: flatten) | depth (m: pond) }.
export const EDIT_KINDS = Object.freeze({
  raise: { label: 'Raise', icon: '⛰️', amount: true },
  lower: { label: 'Lower', icon: '🕳️', amount: true },
  flatten: { label: 'Flatten', icon: '➖', level: true },
  pond: { label: 'Pond', icon: '💧', depth: true },
  clear: { label: 'Clear trees', icon: '🪓' },
  plant: { label: 'Plant woodland', icon: '🌲' },
  reclaim: { label: 'Reclaim land', icon: '🏗️', level: true },   // new land out from a growth coast (WP4.15)
});
export const EDIT_LIMITS = Object.freeze({ minR: 4, maxR: 150, maxAmount: 25, minLevel: -30, maxLevel: 900, minDepth: 0.5, maxDepth: 8, maxEdits: 4000, maxPonds: 60 });
const CELL = 128;
const cm = v => Math.round(v * 100) / 100;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A checked stroke record, or an Error saying what is wrong. */
export function normalizeEdit(o) {
  if (!o || typeof o !== 'object') return new Error('Bad terrain edit');
  const K = EDIT_KINDS[o.kind];
  if (!K) return new Error(`Unknown terrain tool ${o.kind}`);
  const L = EDIT_LIMITS, x = +o.x, z = +o.z, r = +o.r;
  if (![x, z, r].every(Number.isFinite)) return new Error('Bad position');
  if (r < L.minR || r > L.maxR) return new Error(`The brush must be ${Math.round(L.minR / 0.3048)}–${Math.round(L.maxR / 0.3048)} ft across`);
  const rec = { id: typeof o.id === 'string' && /^[a-z0-9-]{1,40}$/.test(o.id) ? o.id : null, kind: o.kind, x: cm(x), z: cm(z), r: cm(r), soft: cm(Math.max(0, Math.min(1, o.soft ?? 0.5))) };
  if (K.amount) { const a = +o.amount; if (!(a > 0 && a <= L.maxAmount)) return new Error(`Raise or lower by up to ${Math.round(L.maxAmount / 0.3048)} ft at a time`); rec.amount = cm(a); }
  if (K.level) { const v = +o.level; if (!(Number.isFinite(v) && v >= L.minLevel && v <= L.maxLevel)) return new Error('Bad level'); rec.level = cm(v); }
  if (K.depth) {
    const d = +(o.depth ?? 2.5); if (!(d >= L.minDepth && d <= L.maxDepth)) return new Error(`A pond is ${Math.round(L.minDepth / 0.3048)}–${Math.round(L.maxDepth / 0.3048)} ft deep`); rec.depth = cm(d);
    if (o.level !== undefined) { const v = +o.level; if (!Number.isFinite(v)) return new Error('Bad level'); rec.level = cm(v); }
  }
  return rec;
}
/** How strongly stroke e acts at (x, z): 1 inside its firm middle, fading to 0 at its rim. */
export function editWeight(e, x, z) {
  const d = Math.hypot(x - e.x, z - e.z);
  if (d >= e.r) return 0;
  const inner = e.r * (1 - e.soft);
  return d <= inner ? 1 : 1 - sstep(inner, e.r, d);
}
/** The strokes of an island, indexed for fast lookups (shared/terrain.js Island keeps one). */
export class TerrainEdits {
  constructor(list) {
    this.list = list || [];
    this.cells = new Map();
    this.list.forEach((e, i) => {
      if (e.kind === 'pond') return;   // ponds are lakes (Island.lakes)
      for (let a = Math.floor((e.x - e.r) / CELL); a <= Math.floor((e.x + e.r) / CELL); a++) for (let b = Math.floor((e.z - e.r) / CELL); b <= Math.floor((e.z + e.r) / CELL); b++) {
        const k = `${a},${b}`; (this.cells.get(k) || this.cells.set(k, []).get(k)).push(i);
      }
    });
  }
  at(x, z) { return this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`); }
  /** The ground at (x, z) after the shaping strokes, in the order they were made. */
  shape(x, z, h) {
    const L = this.at(x, z); if (!L) return h;
    for (const i of L) {
      const e = this.list[i];
      if (e.kind !== 'raise' && e.kind !== 'lower' && e.kind !== 'flatten' && e.kind !== 'reclaim') continue;
      const w = editWeight(e, x, z); if (!w) continue;
      if (e.kind === 'raise') h += e.amount * w; else if (e.kind === 'lower') h -= e.amount * w;
      else if (e.kind === 'reclaim') h = Math.max(h, h + (e.level - h) * w);   // only ever builds up
      else h += (e.level - h) * w;
    }
    return h;
  }
  /** Woodland at (x, z) by the latest clear/plant stroke covering it: 'clear', 'plant' or null (as generated). */
  cover(x, z) {
    const L = this.at(x, z); if (!L) return null;
    let out = null;
    for (const i of L) { const e = this.list[i]; if ((e.kind === 'clear' || e.kind === 'plant') && editWeight(e, x, z) > 0.35) out = e.kind; }
    return out;
  }
  /** The ponds, as lakes ({ id, x, z, r, level, depth }). */
  ponds() { return this.list.filter(e => e.kind === 'pond' && Number.isFinite(e.level)).map(e => ({ id: `pond:${e.id}`, x: e.x, z: e.z, r: e.r, level: e.level, depth: e.depth, pond: true })); }
}
