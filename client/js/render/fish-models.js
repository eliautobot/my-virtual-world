// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fish of the fishing game as models (docs/features/fishing.md §Fish), built from each species' body (shared/fish-
// species.js body: its shape's archetype, how deep it is for its length, its tail, its fins, its marks - a bill, a
// hammer head, whiskers, a snout - and its colours and pattern): a lofted body, the tail and fins as flat blades, its
// own small painted skin (back to belly, the stripes, bars, spots or blotches, the eye). The squid and the ray are built
// their own way; the junk and treasure that come up too. One length unit (1 m nose to tail, along +z, the head
// forward; the caller scales it to the fish's length), made when first wanted and kept - only a few are ever drawn.
import * as THREE from 'three';
import { speciesOf } from '/shared/fish-species.js';

// archetypes: g (width / height), peak (where it is deepest, of the body's length), ped (the tail's root, of its depth),
// nose (0.5 round … 1.4 a long snout), hump (the back's arch), flatBelly
const SHAPES = {
  perch: { g: 0.42, peak: 0.36, ped: 0.3, nose: 0.6, hump: 0.6 }, mullet: { g: 0.8, peak: 0.4, ped: 0.35, nose: 0.5, hump: 0.2 },
  trout: { g: 0.6, peak: 0.42, ped: 0.32, nose: 0.65, hump: 0.3 }, flat: { g: 0.2, peak: 0.42, ped: 0.22, nose: 0.55, hump: 0.1 },
  jack: { g: 0.38, peak: 0.36, ped: 0.13, nose: 0.55, hump: 0.7 }, tarpon: { g: 0.5, peak: 0.4, ped: 0.24, nose: 0.6, hump: 0.4 },
  snook: { g: 0.55, peak: 0.42, ped: 0.3, nose: 0.95, hump: 0.3 }, drum: { g: 0.6, peak: 0.36, ped: 0.34, nose: 0.55, hump: 0.6 },
  bonefish: { g: 0.62, peak: 0.42, ped: 0.26, nose: 0.9, hump: 0.4 }, bass: { g: 0.55, peak: 0.38, ped: 0.32, nose: 0.6, hump: 0.5 },
  trigger: { g: 0.42, peak: 0.45, ped: 0.3, nose: 0.8, hump: 0.8 }, snapper: { g: 0.48, peak: 0.36, ped: 0.28, nose: 0.65, hump: 0.7 },
  lion: { g: 0.5, peak: 0.36, ped: 0.3, nose: 0.6, hump: 0.5 }, hog: { g: 0.45, peak: 0.38, ped: 0.3, nose: 1.0, hump: 0.9 },
  grouper: { g: 0.66, peak: 0.4, ped: 0.38, nose: 0.55, hump: 0.4 }, mackerel: { g: 0.62, peak: 0.42, ped: 0.12, nose: 0.75, hump: 0.2 },
  tuna: { g: 0.75, peak: 0.45, ped: 0.11, nose: 0.6, hump: 0.4 }, pike: { g: 0.6, peak: 0.55, ped: 0.3, nose: 1.2, hump: 0.1 },
  cobia: { g: 0.75, peak: 0.4, ped: 0.28, nose: 0.7, hump: 0.1, flatBelly: 0.2 }, mahi: { g: 0.32, peak: 0.18, ped: 0.18, nose: 0.4, hump: 0.4 },
  billfish: { g: 0.45, peak: 0.36, ped: 0.13, nose: 0.7, hump: 0.3 }, shark: { g: 0.72, peak: 0.38, ped: 0.24, nose: 0.75, hump: 0.4 },
  sunfish: { g: 0.34, peak: 0.45, ped: 0.32, nose: 0.6, hump: 0.4 }, catfish: { g: 1.1, peak: 0.3, ped: 0.3, nose: 0.45, hump: 0.2, flatBelly: 0.35 },
  bowfin: { g: 0.62, peak: 0.42, ped: 0.38, nose: 0.6, hump: 0.2 }, gar: { g: 0.75, peak: 0.55, ped: 0.4, nose: 1.4, hump: 0.1 },
  carp: { g: 0.55, peak: 0.4, ped: 0.34, nose: 0.6, hump: 0.7 }, sturgeon: { g: 0.95, peak: 0.36, ped: 0.24, nose: 1.1, hump: 0.3, flatBelly: 0.3 },
};
const BODY = 0.78, TW = 128, TH = 64, FIN_U = 0.94;   // the body runs from the nose (z 0.5) back 0.78; the skin's fin colour beyond u 0.9

class Geo {
  constructor() { this.p = []; this.uv = []; this.ix = []; }
  v(x, y, z, u, w) { this.p.push(x, y, z); this.uv.push(u, w); return this.p.length / 3 - 1; }
  tri(a, b, c) { this.ix.push(a, b, c); }
  /** A flat blade: a polygon [[x, y, z]…] fanned from its first point, its colour the skin's fins'. */
  blade(pts) { const b = pts.map(q => this.v(q[0], q[1], q[2], FIN_U, 0.5)); for (let i = 1; i + 1 < b.length; i++) this.tri(b[0], b[i], b[i + 1]); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.ix); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
}
const sstep = x => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** A fish's body: its depth (fraction of its greatest) at t (0 the nose … 1 the tail's root). */
function prof(A, t) {
  if (t < A.peak) { const x = t / A.peak; return Math.pow(Math.max(0, 1 - (1 - x) * (1 - x)), A.nose); }
  return 1 - (1 - A.ped) * sstep((t - A.peak) / (1 - A.peak));
}
function bodyOf(G, A, h) {
  const N = 18, M = 14, top = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, z = 0.5 - t * BODY, s = Math.max(0.02, prof(A, t)), hh = h / 2 * s, ww = hh * A.g, yc = h * 0.06 * A.hump * Math.sin(Math.PI * t);
    for (let j = 0; j <= M; j++) {
      const a = j / M * Math.PI * 2, sy = -Math.cos(a), flat = sy < 0 ? 1 - (A.flatBelly || 0) : 1;
      G.v(Math.sin(a) * ww, yc + sy * hh * flat, z, t * 0.86, j / M);
    }
    top.push({ t, z, y: yc + hh, yb: yc - hh * (1 - (A.flatBelly || 0)), w: ww });
  }
  for (let k = 0; k < N; k++) for (let j = 0; j < M; j++) { const a = k * (M + 1) + j, b = a + M + 1; G.tri(a, b, a + 1); G.tri(a + 1, b, b + 1); }
  return top;
}
const at = (top, t) => top[Math.max(0, Math.min(top.length - 1, Math.round(t * (top.length - 1))))];

function tailOf(G, kind, top, h) {
  const r = top[top.length - 1], z0 = r.z, bh = Math.max(0.01, r.y - r.yb) / 2, yc = (r.y + r.yb) / 2;
  const L = { lunate: 0.24, fork: 0.2, heterocercal: 0.26 }[kind] || 0.17, T = h * ({ lunate: 0.95, fork: 0.72, heterocercal: 0.7 }[kind] || 0.55);
  const P = (dz, dy) => [0, yc + dy, z0 - dz];
  if (kind === 'fork') G.blade([P(0, 0), P(0, bh), P(L, T), P(L * 0.55, 0), P(L, -T), P(0, -bh)]);
  else if (kind === 'lunate') G.blade([P(0, 0), P(0, bh), P(L * 0.75, T), P(L, T * 0.95), P(L * 0.35, 0), P(L, -T * 0.95), P(L * 0.75, -T), P(0, -bh)]);
  else if (kind === 'square') G.blade([P(0, 0), P(0, bh), P(L, T * 0.9), P(L * 1.02, 0), P(L, -T * 0.9), P(0, -bh)]);
  else if (kind === 'round') G.blade([P(0, 0), P(0, bh), P(L * 0.6, T * 0.75), P(L, T * 0.35), P(L * 1.08, 0), P(L, -T * 0.35), P(L * 0.6, -T * 0.75), P(0, -bh)]);
  else if (kind === 'pointed') G.blade([P(0, 0), P(0, bh), P(L * 1.25, 0), P(0, -bh)]);
  else G.blade([P(0, 0), P(0, bh), P(L * 0.6, T * 0.8), P(L * 1.3, T * 1.25), P(L * 0.55, 0.2 * T), P(L * 0.45, -T * 0.4), P(0, -bh)]);   // heterocercal: the upper lobe long
}
function finsOf(G, kind, top, h, A) {
  const dorsal = (t0, t1, H, spikes = 0) => {
    const n = Math.max(2, spikes * 2 || 6), base = [], edge = [];
    for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n, q = at(top, t); base.push([0, q.y - 0.004, q.z]); const k = Math.sin(Math.PI * i / n), sp = spikes && i % 2 === 0 ? 1.25 : spikes ? 0.7 : 1; edge.push([0, q.y + H * (0.25 + 0.75 * k) * sp, q.z - 0.02]); }
    for (let i = 0; i < n; i++) { G.blade([base[i], edge[i], edge[i + 1], base[i + 1]]); }
  };
  if (kind === 'spiny') { dorsal(0.28, 0.5, h * 0.42, 5); dorsal(0.5, 0.74, h * 0.3); }
  else if (kind === 'small') dorsal(0.36, 0.56, h * 0.32);
  else if (kind === 'long') dorsal(0.22, 0.96, h * 0.2);
  else if (kind === 'sail') dorsal(0.14, 0.72, h * 1.25);
  // the anal fin below toward the tail; the pectorals behind the gills, out to each side
  if (kind !== 'none') { const a = at(top, 0.7), b = at(top, 0.86); G.blade([[0, a.yb + 0.004, a.z], [0, a.yb - h * 0.22, a.z - 0.05], [0, b.yb - h * 0.12, b.z], [0, b.yb + 0.004, b.z]]); }
  const p = at(top, 0.27), pl = h * 0.42 * (A.peak < 0.3 ? 1.2 : 1);
  for (const sd of [1, -1]) G.blade([[sd * p.w * 0.95, p.yb + (p.y - p.yb) * 0.4, p.z], [sd * (p.w + pl * 0.5), p.yb + (p.y - p.yb) * 0.25, p.z - pl * 0.9], [sd * p.w * 0.9, p.yb + (p.y - p.yb) * 0.32, p.z - pl * 0.35]]);
}
function marksOf(G, mark, top, h) {
  const n = top[0];
  if (mark === 'bill') { const b = [G.v(0, n.y - h * 0.02, 0.5 + 0.24, FIN_U, 0.5)]; for (let a = 0; a < 6; a++) b.push(G.v(Math.cos(a / 6 * Math.PI * 2) * 0.012, n.y - h * 0.02 + Math.sin(a / 6 * Math.PI * 2) * 0.012, 0.49, FIN_U, 0.5)); for (let a = 1; a <= 6; a++) G.tri(b[0], b[a], b[a % 6 + 1]); }
  if (mark === 'hammer') { const q = at(top, 0.05), w = h * 1.7, y = q.y - h * 0.05; G.blade([[-w, y, q.z + 0.02], [w, y, q.z + 0.02], [w, y, q.z - 0.04], [-w, y, q.z - 0.04]]); G.blade([[-w, y, q.z - 0.04], [w, y, q.z - 0.04], [w, y, q.z + 0.02], [-w, y, q.z + 0.02]]); }
  if (mark === 'whiskers') for (const [sx, sy, l] of [[1, 0, 0.2], [-1, 0, 0.2], [1, -1, 0.1], [-1, -1, 0.1], [0.4, 1, 0.08], [-0.4, 1, 0.08]]) { const y = n.yb + h * 0.18 + sy * h * 0.05, z = 0.47; G.blade([[sx * 0.02, y, z], [sx * (0.03 + l * 0.6), y - l * 0.35, z - l * 0.4], [sx * 0.025, y - 0.006, z - 0.01]]); }
  if (mark === 'snout' || mark === 'jet') { /* (the long nose is the body's own: nose) */ }
}

function squid(G) {
  const N = 12, M = 10;
  for (let k = 0; k <= N; k++) { const t = k / N, z = 0.5 - t * 0.6, r = 0.06 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85)), 0.7) * (t < 0.1 ? t / 0.1 : 1) + 0.004; for (let j = 0; j <= M; j++) { const a = j / M * Math.PI * 2; G.v(Math.sin(a) * r, -Math.cos(a) * r, z, t * 0.86, j / M); } }
  for (let k = 0; k < N; k++) for (let j = 0; j < M; j++) { const a = k * (M + 1) + j, b = a + M + 1; G.tri(a, b, a + 1); G.tri(a + 1, b, b + 1); }
  for (const sd of [1, -1]) G.blade([[0, 0, 0.5], [sd * 0.12, 0, 0.36], [0, 0, 0.3]]);   // its fins, at the mantle's point
  for (let a = 0; a < 8; a++) { const c = Math.cos(a / 8 * Math.PI * 2) * 0.04, s = Math.sin(a / 8 * Math.PI * 2) * 0.04, L = a % 4 === 0 ? 0.42 : 0.3; G.blade([[c, s, -0.1], [c * 1.6, s * 1.6, -0.1 - L], [c * 0.6, s * 0.6, -0.1]]); }
}
function ray(G) {
  const pts = [[0, 0.03, 0.5], [0.5, 0, 0.05], [0, 0.02, -0.25], [-0.5, 0, 0.05]], c = G.v(0, 0.05, 0.08, 0.3, 0.5);
  const ring = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4];
    for (let k = 0; k < 4; k++) {
      const u = k / 4, x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, z = a[2] + (b[2] - a[2]) * u;
      ring.push(G.v(x, y, z, 0.1 + 0.6 * (1 - (z + 0.25) / 0.75), 0.15 + 0.7 * (x + 0.5)));
    }
  }
  for (let i = 0; i < ring.length; i++) { G.tri(c, ring[i], ring[(i + 1) % ring.length]); G.tri(c, ring[(i + 1) % ring.length], ring[i]); }
  G.blade([[0.01, 0.01, -0.24], [0, 0.01, -0.95], [-0.01, 0.01, -0.24]]);   // the whip of a tail
}

// ------------------------------------------------------------------ the skin
function rngFor(id) { let s = 2166136261; for (const ch of id) s = Math.imul(s ^ ch.charCodeAt(0), 16777619); return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }
function skin(sp) {
  const B = sp.body, [back, side, belly, fin] = B.cols, cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  const c = cv.getContext('2d'), rnd = rngFor(sp.id);
  // back to belly, round the body (v: 0 the belly, 0.5 the back, 1 the belly)
  const gr = c.createLinearGradient(0, 0, 0, TH);
  for (const [v, col] of [[0, belly], [0.2, belly], [0.33, side], [0.5, back], [0.67, side], [0.8, belly], [1, belly]]) gr.addColorStop(v, col);
  c.fillStyle = gr; c.fillRect(0, 0, TW, TH);
  const bodyW = TW * 0.86, sideRows = f => [TH * (0.5 - f * 0.25), TH * (0.5 + f * 0.25)];   // f: 0 the back's middle … 1 the flank's middle
  c.fillStyle = c.strokeStyle = B.patc; c.globalAlpha = 0.85;
  if (B.pat === 'stripes') { c.lineWidth = 2; for (const f of [0.35, 0.6, 0.85]) for (const y of sideRows(f)) { c.beginPath(); c.moveTo(bodyW * 0.12, y); c.lineTo(bodyW * 0.98, y); c.stroke(); } }
  else if (B.pat === 'lateral') { c.lineWidth = 1.6; for (const y of sideRows(0.95)) { c.beginPath(); c.moveTo(bodyW * 0.14, y); c.quadraticCurveTo(bodyW * 0.5, y + (y < TH / 2 ? -3 : 3), bodyW, y); c.stroke(); } }
  else if (B.pat === 'bars') { for (let x = 0.24; x < 0.9; x += 0.11) c.fillRect(bodyW * x, TH * 0.24, bodyW * 0.045, TH * 0.52); }
  else if (B.pat === 'spots') { for (let i = 0; i < 70; i++) { const x = bodyW * (0.12 + rnd() * 0.86), y = TH * (0.2 + rnd() * 0.6); c.beginPath(); c.arc(x, y, 0.8 + rnd() * 1.3, 0, Math.PI * 2); c.fill(); } }
  else if (B.pat === 'blotch') { for (let i = 0; i < 9; i++) { const x = bodyW * (0.18 + rnd() * 0.75), y = TH * (0.25 + rnd() * 0.5); c.beginPath(); c.ellipse(x, y, 3 + rnd() * 4, 2 + rnd() * 3, rnd() * 3, 0, Math.PI * 2); c.fill(); } }
  else if (B.pat === 'wavy') { c.lineWidth = 1.4; for (let r = 0; r < 4; r++) { c.beginPath(); for (let x = bodyW * 0.15; x < bodyW; x += 2) { const y = TH * (0.36 + r * 0.09) + Math.sin(x * 0.35 + r) * 2.2; x === bodyW * 0.15 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke(); } }
  c.globalAlpha = 1;
  // the eye on each side, behind the nose; the gill's line
  for (const y of [TH * 0.31, TH * 0.69]) { c.fillStyle = '#f2ead2'; c.beginPath(); c.arc(bodyW * 0.065, y, 3, 0, Math.PI * 2); c.fill(); c.fillStyle = '#0b0b0d'; c.beginPath(); c.arc(bodyW * 0.065, y, 2, 0, Math.PI * 2); c.fill(); }
  c.strokeStyle = 'rgba(0,0,0,.25)'; c.lineWidth = 1; for (const y0 of [TH * 0.18, TH * 0.82]) { c.beginPath(); c.moveTo(bodyW * 0.2, y0); c.quadraticCurveTo(bodyW * 0.16, TH / 2, bodyW * 0.2, TH - y0); c.stroke(); }
  // the fins' colour
  c.fillStyle = fin; c.fillRect(TW * 0.9, 0, TW * 0.1, TH);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  return t;
}

// ------------------------------------------------------------------ the junk and treasure
function find(id) {
  const g = new THREE.Group(), m = (geo, col, rough = 0.8, metal = 0) => { const o = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal })); g.add(o); return o; };
  if (id === 'boot') { m(new THREE.BoxGeometry(0.11, 0.24, 0.12), '#4a3524').position.set(0, 0.06, -0.04); m(new THREE.BoxGeometry(0.11, 0.08, 0.28), '#3b2a1c').position.set(0, -0.08, 0.02); }
  else if (id === 'tyre') { m(new THREE.TorusGeometry(0.28, 0.1, 10, 20), '#1d1e20', 0.95).rotation.y = Math.PI / 2; }
  else if (id === 'can') m(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12), '#8a4b2a', 0.7, 0.4).rotation.x = Math.PI / 2;
  else if (id === 'bottle') { m(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 12), '#3e7a4a', 0.15, 0.1).rotation.x = Math.PI / 2; m(new THREE.CylinderGeometry(0.035, 0.03, 0.15, 10), '#efe4c2').rotation.x = Math.PI / 2; }
  else if (id === 'pouch') { m(new THREE.SphereGeometry(0.08, 12, 8), '#6a4a2a', 0.9).scale.set(1, 0.8, 1); m(new THREE.TorusGeometry(0.03, 0.008, 6, 12), '#d8b040', 0.3, 0.9).position.set(0, 0.07, 0); }
  else { const o = new THREE.Mesh(fishGeometry('goldfish-lure'), new THREE.MeshStandardMaterial({ color: '#e8b830', roughness: 0.25, metalness: 0.9 })); o.scale.setScalar(0.12); g.add(o); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
const FIND_SIZE = { boot: 1, tyre: 1, can: 1, bottle: 1, pouch: 1, goldenlure: 1 };

// ------------------------------------------------------------------ what the caller asks for
const geoCache = new Map(), matCache = new Map();
/** The shape of a species (one unit long, nose to tail along +z). */
export function fishGeometry(id) {
  if (geoCache.has(id)) return geoCache.get(id);
  const sp = speciesOf(id), G = new Geo();
  if (!sp) { const A = SHAPES.perch, top = bodyOf(G, A, 0.36); tailOf(G, 'fork', top, 0.36); finsOf(G, 'small', top, 0.36, A); }
  else if (sp.body.shape === 'squid') squid(G);
  else if (sp.body.shape === 'ray' || sp.body.mark === 'ray') ray(G);
  else {
    const A = SHAPES[sp.body.shape] || SHAPES.perch, h = sp.body.h, top = bodyOf(G, A, h);
    tailOf(G, sp.body.tail, top, h); finsOf(G, sp.body.fins, top, h, A); marksOf(G, sp.body.mark, top, h);
  }
  const g = G.build(); geoCache.set(id, g);
  return g;
}
/** Its look: its own painted skin, a little sheen. */
export function fishMaterial(id) {
  if (matCache.has(id)) return matCache.get(id);
  const sp = speciesOf(id), mat = new THREE.MeshStandardMaterial({ map: sp ? skin(sp) : null, color: sp ? 0xffffff : 0x8a9aa6, roughness: 0.38, metalness: 0.12, side: THREE.DoubleSide });
  matCache.set(id, mat);
  return mat;
}
/**
 * A model of what came up: a fish of species `id` (a mesh one unit long: scale it to the fish's length), or a find
 * ({ find: id }: a group at its own size). shadow: cast shadows.
 */
export function catchModel(what, shadow = true) {
  if (what?.find) { const g = find(what.find); g.userData.size = FIND_SIZE[what.find] || 1; return g; }
  const o = new THREE.Mesh(fishGeometry(what.species), fishMaterial(what.species));
  o.castShadow = shadow; o.name = `fish-${what.species}`;
  return o;
}
