// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A flat's lasting address (the commerce package: flats sold and rented through the shop). Flats are numbered by their
// place on the floor, and that number changes when the owner splits or removes flats, so a sale or a lease names the
// flat by what doesn't change: its building's permanent id, the floor, and the flat's own dice (its seed `s`; floors
// laid out before flats had seeds name them by side and order, exactly as server/world/edit.js flatPlanOp does).
// "b17/3/0:2" = building b17, floor 3 (0 = street floor), the flat with seed "0:2".

const sideOf = U => (U.z0 + U.z1 > 0 ? 0 : 1);
/** The seed of flat u on floor layout L, or null when there is no such flat. */
export function flatSeed(L, u) {
  const U = L?.units?.[u];
  if (!U) return null;
  if (U.s) return String(U.s);
  const side = sideOf(U);
  return `${side}:${L.units.slice(0, u).filter(x => sideOf(x) === side).length}`;
}
/** The address of flat u on floor f of building B (B.id is its permanent id), or null. */
export function flatRef(B, f, L, u) {
  const s = flatSeed(L, u);
  return B?.id && s !== null ? `${B.id}/${f}/${s}` : null;
}
const REF_RE = /^([A-Za-z0-9_-]{1,40})\/(\d{1,3})\/([A-Za-z0-9:+_-]{1,80})$/;
export function parseFlatRef(ref) {
  const m = REF_RE.exec(String(ref ?? ''));
  return m ? { bid: m[1], f: Number(m[2]), s: m[3] } : null;
}
/** Where an address is today: { B, b, f, u, L, U } in world W, or null when the flat no longer exists. */
export function findFlat(W, ref) {
  const r = parseFlatRef(ref);
  if (!r || !W?.buildings) return null;
  const B = W.buildings.find(x => x && !x.gone && x.id === r.bid);
  if (!B || B.type !== 'apartment' || r.f < 0 || r.f >= B.floors) return null;
  const L = W.levels?.[B.lv?.[r.f]];
  if (!L?.units) return null;
  for (let u = 0; u < L.units.length; u++) if (flatSeed(L, u) === r.s) return { B, b: B.idx, f: r.f, u, L, U: L.units[u] };
  return null;
}
/** The addresses of the flats on floor f of B, by flat number. */
export function floorRefs(B, f, L) { return (L?.units || []).map((_, u) => flatRef(B, f, L, u)); }
