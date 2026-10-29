// Order Up's kitchens for the tests: whether every station in a kitchen can be walked up to from the middle of the
// kitchen (the same geometry as client/js/play/order-up.js: the kitchen's frame from the pass, the stations' boxes, the
// cook's radius). Used by tests/orderup-kitchen.test.mjs and tests/kitchen-module.test.mjs.
import { CATALOG } from '../../shared/catalog.js';

const PLAYS = new Set(['ou_fridge', 'ou_pantry', 'ou_prep', 'ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_oven', 'ou_press', 'ou_blender', 'ou_plating', 'ou_pass', 'ou_dishes', 'ou_sink', 'ou_bin', 'ou_kettle', 'ou_toaster', 'ou_juicer', 'ou_griddle', 'ou_grill', 'ou_fryer', 'ou_soda']);
const R = 0.28, CELL = 0.1;
export function kitchenReach(items) {
  const pass = items.find(i => i.t === 'ou_pass'); if (!pass) return null;
  const c = Math.cos(pass.r || 0), s = Math.sin(pass.r || 0);
  const local = (x, z) => { const dx = x - pass.x, dz = z - pass.z; return { u: dx * c - dz * s, v: dx * s + dz * c }; };
  const box = it => { const r = CATALOG[it.t].rect, p = local(it.x, it.z), a = (it.r || 0) - (pass.r || 0), ca = Math.cos(a), sa = Math.sin(a), us = [], vs = [];
    for (const [lx, lz] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) { us.push(p.u + lx * ca + lz * sa); vs.push(p.v - lx * sa + lz * ca); }
    return { t: it.t, u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs), block: CATALOG[it.t].block !== false }; };
  const all = items.filter(i => i.t.startsWith('ou_')).map(box), st = items.filter(i => PLAYS.has(i.t)).map(box);
  const room = { u0: Math.min(...all.map(b => b.u0)), u1: Math.max(...all.map(b => b.u1)), v0: Math.min(...all.map(b => b.v0)), v1: box(pass).v0 };
  const free = (u, v) => u > room.u0 + R && u < room.u1 - R && v > room.v0 + R && v < room.v1 - R && !st.some(b => b.block && u > b.u0 - R && u < b.u1 + R && v > b.v0 - R && v < b.v1 + R);
  const nu = Math.ceil((room.u1 - room.u0) / CELL), nv = Math.ceil((room.v1 - room.v0) / CELL), seen = new Uint8Array(nu * nv);
  const at = (i, j) => [room.u0 + (i + 0.5) * CELL, room.v0 + (j + 0.5) * CELL];
  let start = -1; for (let k = 0; k < nu * nv && start < 0; k++) { const i = (k + (nu * nv >> 1)) % (nu * nv); const [u, v] = at(i % nu, (i / nu) | 0); if (free(u, v)) start = i; }
  const q = [start]; seen[start] = 1;
  for (let h = 0; h < q.length; h++) { const i = q[h] % nu, j = (q[h] / nu) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj, n = b * nu + a; if (a < 0 || b < 0 || a >= nu || b >= nv || seen[n]) continue; const [u, v] = at(a, b); if (!free(u, v)) continue; seen[n] = 1; q.push(n); } }
  const walk = (u, v) => { const i = Math.floor((u - room.u0) / CELL), j = Math.floor((v - room.v0) / CELL); return i >= 0 && j >= 0 && i < nu && j < nv && seen[j * nu + i] && free(u, v); };
  const d = R + 0.17;
  return st.map(b => { const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2;
    return { t: b.t, ok: [[cu, b.v1 + d], [cu, b.v0 - d], [b.u1 + d, cv], [b.u0 - d, cv]].some(([u, v]) => walk(u, v)) }; });
}
