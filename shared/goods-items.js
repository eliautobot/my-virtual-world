// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The goods as catalog pieces (shared/catalog.js takes them in after the Amazon furniture library): the small things that go
// on tables, counters and shelves (PLAN-SURFACES.md), from the generated list shared/goods-catalog.js. Type 'g:<id>' for a
// Google scan (models in /assets/gso/), 'a:<id>' for an Amazon one (models in /assets/abo/, beside the furniture);
// category 'Goods' with a sub-group, size class 'surface', goods tags, their real size; they never block the way.
// Not listed in the Furnish panel yet (shared/edit.js EDIT_TYPES leaves them out; placing one comes with surfaces).
import { GOODS_ROWS, GOODS_ABO_DRESS } from './goods-catalog.js';
import { GOODS_TAGS, GOODS_SUBS } from './goods-tags.js';

export const GOODS_PREFIX = 'g:';
export const GOODS_CAT = 'Goods';
/** The goods in order: { t, id, src, name, sub, tags, flags } per model (the Furnish panel's Goods part, later). */
export const GOODS_LIB = [];
/** Catalog entries by type. */
export const GOODS_ITEMS = {};
/** The Amazon furniture library's pieces that may also stand on a surface and have a dressing copy (/assets/abo/d/). */
export const ABO_DRESS = new Set(GOODS_ABO_DRESS.split(' ').filter(Boolean));

const m = v => +v / 1000;
for (const line of GOODS_ROWS.split('\n')) {
  if (!line) continue;
  const [id, src, ti, si, name, x0, z0, x1, z1, h, flags = ''] = line.split('|');
  const tags = ti.split(',').map(i => GOODS_TAGS[+i]), sub = GOODS_SUBS[+si];
  if (!sub || tags.some(x => !x)) continue;
  const t = (src === 'g' ? GOODS_PREFIX : 'a:') + id;
  const it = { name, cat: GOODS_CAT, sub, h: Math.max(0.002, m(h)), rect: [m(x0), m(z0), m(x1), m(z1)], size: 'surface', tags, goods: id, src, block: false, slots: [] };
  if (flags.includes('f')) it.floorOk = true;   // (also stands on the floor: a backpack, a pet bowl, a plant pot)
  if (flags.includes('y')) it.front = true;
  if (flags.includes('r')) it.round = true;
  if (flags.includes('x')) it.franchise = true;   // (placed by hand only, never by the dressing rules)
  GOODS_ITEMS[t] = it;
  GOODS_LIB.push({ t, id, src, name, sub, tags, flags });
}

/** A goods type's files: its model, its dressing copy (<= 400 triangles) and its picture. */
export function goodsFiles(t) {
  const d = GOODS_ITEMS[t]; if (!d) return null;
  const base = d.src === 'g' ? '/assets/gso/' : '/assets/abo/';
  return { m: `${base}m/${d.goods}.glb`, d: `${base}d/${d.goods}.glb`, t: `${base}t/${d.goods}.webp` };
}
