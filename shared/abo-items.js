// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Amazon furniture library as catalog pieces (shared/catalog.js takes them in after its own): type 'a:<id>' for each
// model of shared/abo-catalog.js, in the Furnish panel's category of its kind with a sub-group (shared/abo-kinds.js), its
// rectangle and height its model's real size, and the places people use it at. Drawn by client/js/render/abo-models.js.
import { ABO_ROWS } from './abo-catalog.js';
import { ABO_KINDS, ABO_KIND_IDS, aboLift, aboSlots } from './abo-kinds.js';
import { GOODS_ABO_FIX } from './goods-catalog.js';

export const ABO_PREFIX = 'a:';
/** The Amazon model id of a type or a model choice ('a:<id>'), or null. */
export const aboId = t => (typeof t === 'string' && t.startsWith(ABO_PREFIX) ? t.slice(ABO_PREFIX.length) : null);
/** The library in order: { t, id, name, cat, sub, k } per model (the Furnish panel's Amazon part). */
export const ABO_LIB = [];
/** Catalog entries by type. */
export const ABO_ITEMS = {};
/** The sub-groups of each category, in the kinds' order: { [cat]: [sub, ...] }. */
export const ABO_SUBS = {};

// the fixes to misfiled pieces (tools/goods-overrides.json via shared/goods-catalog.js): another kind and name, a scale
// (a model made in centimetres), a raise (a model made around its middle), or left out of the panel; ids and order unchanged
const FIX = new Map();
for (const line of GOODS_ABO_FIX.split('\n')) {
  if (!line) continue;
  const [id, ki, name, s, flags = '', oy = '0'] = line.split('|');
  if (ABO_KIND_IDS[+ki]) FIX.set(id, { k: ABO_KIND_IDS[+ki], name, s: +s || 1, hide: flags.includes('h'), oy: +oy / 1000 || 0 });
}
const m = v => +v / 100;
for (const line of ABO_ROWS.split('\n')) {
  if (!line) continue;
  const [id, ki, name0, x0, z0, x1, z1, h] = line.split('|'), F = FIX.get(id), k = F?.k || ABO_KIND_IDS[+ki], K = ABO_KINDS[k], name = F?.name || name0, s = F?.s || 1;
  if (!K) continue;
  let rect = [m(x0) * s, m(z0) * s, m(x1) * s, m(z1) * s];
  if (rect[3] - rect[1] < 0.04) rect = [rect[0], rect[1] - 0.02, rect[2], rect[3] + 0.02];   // (a picture's thickness: still pickable)
  const H = Math.max(0.01, m(h) * s + (F?.oy || 0)), lift = aboLift(k, H), t = ABO_PREFIX + id;
  const it = { name, cat: K.cat, sub: K.sub, h: Math.round((lift + H) * 100) / 100, rect, abo: id, kind: k, slots: aboSlots(k, rect, H) };
  if (lift) it.lift = Math.round(lift * 100) / 100;
  if (s !== 1) it.scale = s;   // (its model drawn scaled: shared/abo-replace.js aboParts)
  if (F?.oy) it.oy = F.oy;   // (its model drawn raised by this much)
  if (K.stand === 'wall') it.wall = true;
  if (K.stand === 'flat' || K.stand === 'hang' || K.walk || (K.stand === 'wall' && lift > 0.1)) it.block = false;
  ABO_ITEMS[t] = it;
  if (F?.hide) { it.hide = true; continue; }   // (kept for pieces already placed; not offered)
  ABO_LIB.push({ t, id, name, cat: K.cat, sub: K.sub, k });
  const subs = ABO_SUBS[K.cat] || (ABO_SUBS[K.cat] = []);
  if (!subs.includes(K.sub)) subs.push(K.sub);
}
