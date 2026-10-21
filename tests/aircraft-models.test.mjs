// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's aircraft models hold together (2026-10-14, the product owner with screenshots: "there are shapes that are not
// connected / floating" — a tail wheel's leg and a tow hook under the tail, windows standing off the cabin, the jet's
// pylons between its body and engines, the helicopter's steps). Each model is built here with the real builders and
// cut into its pieces (triangles sharing corners); a piece is attached to another where one of its corners lies on the
// other's surface (within 2 cm) or one of its edges passes through the other — and every model must be one piece. Also:
// finite positions and normals, the rotors' blades round their hubs, triangle budgets.
import './helpers/client-paths.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

const { MODELS, flyingParts } = await import('../client/js/render/aircraft-models.js');
const { bannerPlane, PROP_ROTOR } = await import('../client/js/render/promo-models.js');

/** The pieces of a geometry that touch nothing else: [{ tris, centre, size }], the biggest group (the body) left out. */
export function floatingPieces(geo, eps = 0.02) {
  const P = geo.attributes.position.array, I = geo.index ? geo.index.array : null, nv = P.length / 3, nt = (I ? I.length : nv) / 3;
  const tv = k => (I ? I[k] : k);
  const par = new Int32Array(nv).map((_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; }, join = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  for (let t = 0; t < nt; t++) { join(tv(3 * t), tv(3 * t + 1)); join(tv(3 * t), tv(3 * t + 2)); }
  { const seen = new Map(); for (let i = 0; i < nv; i++) { const key = `${Math.round(P[3 * i] * 1e4)},${Math.round(P[3 * i + 1] * 1e4)},${Math.round(P[3 * i + 2] * 1e4)}`; const j = seen.get(key); if (j === undefined) seen.set(key, i); else join(i, j); } }
  // the triangles in a grid of cells, to find those near a point or an edge
  const C = 0.3, grid = new Map(), cell = (x, y, z) => `${Math.floor(x / C)},${Math.floor(y / C)},${Math.floor(z / C)}`;
  const V = i => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  const tri = t => [V(tv(3 * t)), V(tv(3 * t + 1)), V(tv(3 * t + 2))];
  for (let t = 0; t < nt; t++) {
    const [a, b, c] = tri(t), lo = [0, 1, 2].map(k => Math.floor((Math.min(a[k], b[k], c[k]) - eps) / C)), hi = [0, 1, 2].map(k => Math.floor((Math.max(a[k], b[k], c[k]) + eps) / C));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) { const k = `${x},${y},${z}`; let L = grid.get(k); if (!L) grid.set(k, L = []); L.push(t); }
  }
  const pieceOfTri = t => find(tv(3 * t));
  // a point's distance to a triangle (the closest point on it)
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2], cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  function dist(p, [a, b, c]) {
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
    const at = q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), lerp = (u, v, s) => [u[0] + (v[0] - u[0]) * s, u[1] + (v[1] - u[1]) * s, u[2] + (v[2] - u[2]) * s];
    if (d1 <= 0 && d2 <= 0) return at(a);
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return at(b);
    const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(lerp(a, b, d1 / (d1 - d3)));
    const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return at(c);
    const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(lerp(a, c, d2 / (d2 - d6)));
    const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(lerp(b, c, (d4 - d3) / ((d4 - d3) + (d5 - d6))));
    const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
    return at([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
  }
  // whether a segment passes through a triangle (Möller–Trumbore)
  function crosses(p, q, [a, b, c]) {
    const d = sub(q, p), e1 = sub(b, a), e2 = sub(c, a), h = cross(d, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-12) return false;
    const f = 1 / det, s = sub(p, a), u = f * dot(s, h); if (u < 0 || u > 1) return false;
    const qq = cross(s, e1), v = f * dot(d, qq); if (v < 0 || u + v > 1) return false;
    const t = f * dot(e2, qq); return t >= 0 && t <= 1;
  }
  const near = (x0, y0, z0, x1, y1, z1) => { const out = new Set(); for (let x = Math.floor(x0 / C); x <= Math.floor(x1 / C); x++) for (let y = Math.floor(y0 / C); y <= Math.floor(y1 / C); y++) for (let z = Math.floor(z0 / C); z <= Math.floor(z1 / C); z++) for (const t of grid.get(`${x},${y},${z}`) || []) out.add(t); return out; };
  // join pieces that touch: a corner on another's surface, an edge through another
  for (let i = 0; i < nv; i++) {
    const p = V(i), me = find(i);
    for (const t of near(p[0] - eps, p[1] - eps, p[2] - eps, p[0] + eps, p[1] + eps, p[2] + eps)) { const o = pieceOfTri(t); if (o !== find(i) && dist(p, tri(t)) <= eps) join(me, o); }
  }
  for (let t = 0; t < nt; t++) for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
    const p = V(tv(3 * t + i)), q = V(tv(3 * t + j)), me = pieceOfTri(t);
    for (const u of near(Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2]))) { const o = pieceOfTri(u); if (o !== find(me) && crosses(p, q, tri(u))) join(me, o); }
  }
  const groups = new Map();
  for (let t = 0; t < nt; t++) { const g = pieceOfTri(t); let G = groups.get(g); if (!G) groups.set(g, G = { tris: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }); G.tris++; for (const p of tri(t)) for (let k = 0; k < 3; k++) { G.lo[k] = Math.min(G.lo[k], p[k]); G.hi[k] = Math.max(G.hi[k], p[k]); } }
  const list = [...groups.values()].sort((a, b) => b.tris - a.tris);
  return list.slice(1).map(G => ({ tris: G.tris, centre: G.lo.map((v, k) => +((v + G.hi[k]) / 2).toFixed(2)), size: G.lo.map((v, k) => +(G.hi[k] - v).toFixed(2)) }));
}
/** A flying aircraft whole: its body and each rotor's blades on their hub. */
function assembled(type) {
  const P = flyingParts(type), geos = [P.body, ...P.rotors.map(r => r.geo.clone().translate(r.at[0], r.at[1], r.at[2]))];
  return merge(geos);
}
function merge(geos) {
  const pos = [], idx = []; let base = 0;
  for (const g of geos) {
    const p = g.attributes.position.array; for (let i = 0; i < p.length; i++) pos.push(p[i]);
    const I = g.index ? g.index.array : [...Array(p.length / 3).keys()]; for (const i of I) idx.push(i + base);
    base += p.length / 3;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
const finite = g => [...g.attributes.position.array, ...g.attributes.normal.array].every(Number.isFinite);
const tris = g => (g.index ? g.index.count : g.attributes.position.count) / 3;

test('every aircraft is one piece: nothing floats (standing, and flying with its rotors on their hubs)', () => {
  const cases = { 'propeller plane (standing)': MODELS.prop(), 'jet (standing)': MODELS.jet(), 'helicopter (standing)': MODELS.heli(), 'banner plane': bannerPlane(),
    'propeller plane (flying)': assembled('prop'), 'jet (flying)': assembled('jet'), 'helicopter (flying)': assembled('heli') };
  const bad = [];
  for (const [name, g] of Object.entries(cases)) { const f = floatingPieces(g); if (f.length) bad.push(`${name}: ${f.length} floating — ${f.map(p => `${p.tris} tris at ${p.centre.join(',')} (${p.size.join('×')} m)`).join('; ')}`); }
  assert.deepEqual(bad, [], `\n${bad.join('\n')}`);
});

test('the models are sound and within their budgets; the rotors turn round their hubs', () => {
  for (const [type, make] of Object.entries(MODELS)) {
    const g = make(); assert.ok(finite(g), `${type}: finite positions and normals`);
    assert.ok(tris(g) < 16000, `${type}: ${tris(g)} triangles`);
    const P = flyingParts(type); assert.ok(finite(P.body));
    for (const r of P.rotors) {
      r.geo.computeBoundingBox(); const b = r.geo.boundingBox, c = b.getCenter(new THREE.Vector3());
      assert.ok(c.length() < 0.05 * r.R, `${type} ${r.axis}-rotor: centred on its hub (${c.toArray().map(v => v.toFixed(3))})`);
      const ext = b.getSize(new THREE.Vector3()), along = { x: ext.x, y: ext.y, z: ext.z }[r.axis];
      assert.ok(along < 0.25 * r.R + 0.2, `${type} ${r.axis}-rotor: flat across its axis (${along.toFixed(2)} m along it)`);
    }
  }
  assert.ok(Math.abs(PROP_ROTOR.R - 1) < 0.2);
});
