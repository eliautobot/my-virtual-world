// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The property map's drawing (WP4.14, wp4-world-spec.md §5.6; 2026-10-04: "a lot specific view to see lots for
// sale, available, sold, realty value map that is colour coded and directly viewed in the world ... similar to the
// latest SimCity games"). While the map is on: every lot's ground is filled with its colour for the chosen lens and
// outlined, and every building standing on a lot wears a cap of the same colour on its roof, so the colours read from
// above, at an angle, at night, and over a city whose buildings hide the ground. The rest of the world turns pale
// (render/scene.js GU.uMap), as in SimCity's data views. One draw call for the fills, one for the outlines, one for the
// caps, one each for the selection and the picked lots.
import * as THREE from 'three';
import { GROUND_Y, FLOOR_H } from '/shared/constants.js';
import { S } from '../core/state.js';

const UM = 1e-6;
/** The status lens: what a lot is to the person looking. */
export const STATUS = {
  forSale: { color: '#2ee08a', label: 'For sale' },
  mine: { color: '#ffc83d', label: 'Yours' },
  shared: { color: '#ff9a3d', label: 'Shared with you' },
  owned: { color: '#a77bff', label: 'Owned' },
  city: { color: '#7d8fa8', label: 'City land' },
  held: { color: '#ff5c5c', label: 'On hold' },
  unreleased: { color: '#4a5160', label: 'Not released yet' },
};
export const ZONES = {
  residential: { color: '#5cc46a', label: 'Residential' }, commercial: { color: '#4f8ff7', label: 'Commercial' },
  mixed: { color: '#b46ef0', label: 'Mixed use' }, industrial: { color: '#e8b23a', label: 'Industrial' },
  civic: { color: '#2fc3c9', label: 'Civic' }, park: { color: '#9be15d', label: 'Park' }, agricultural: { color: '#a07a4f', label: 'Farmland' },
};
/** The value lens: low (blue) to high (red), in the tiers of shared/world-config/land-value.json. */
export const VALUE_STOPS = [[0, '#2b4c9b'], [35, '#2fa3b8'], [50, '#58c26b'], [65, '#e8d14a'], [80, '#f28c38'], [100, '#e8473b']];
const _ca = new THREE.Color(), _cb = new THREE.Color();
export function valueColor(score) {
  for (let k = 1; k < VALUE_STOPS.length; k++) {
    const [s1, c1] = VALUE_STOPS[k], [s0, c0] = VALUE_STOPS[k - 1];
    if (score <= s1) return '#' + _ca.set(c0).lerp(_cb.set(c1), (score - s0) / (s1 - s0)).getHexString();
  }
  return VALUE_STOPS.at(-1)[1];
}
/** Kept for the editors' older callers: 'mine' | 'held' | 'leased' | 'available' | 'cityBuilt' | 'cityVacant' | 'other'. */
export function lotState(l, me) {
  if (l.lifecycle === 'custodial') return 'held';
  if (l.holder?.kind === 'account' && me && String(l.holder.id) === String(me)) return 'mine';
  if (l.lifecycle === 'leased' || l.lifecycle === 'permit') return 'leased';
  if (l.lifecycle === 'available') return 'available';
  if (l.holder?.kind === 'municipality') return l.buildings.length ? 'cityBuilt' : 'cityVacant';
  return 'other';
}
/** The status lens's key for lot l as account `me` (and the lots shared with me) sees it. */
export function statusOf(l, me, shared) {
  if (l.lifecycle === 'custodial') return 'held';
  if (l.holder?.kind === 'account' && me && String(l.holder.id) === String(me)) return 'mine';
  if (shared && shared.has(l.id)) return 'shared';
  if (l.lifecycle === 'available') return 'forSale';
  if (l.lifecycle === 'unreleased') return 'unreleased';
  if (l.holder?.kind === 'municipality') return 'city';
  return 'owned';
}

const DRAPE = 6;   // m: the size of the pieces lots beyond the city are drawn in, following the ground
export class LotLayer {
  constructor(app) {
    this.app = app; this.lots = []; this.byId = new Map(); this.visible = false; this.me = null;
    this.colorOf = () => '#7d8fa8'; this.dim = () => false;
    this.group = new THREE.Group(); this.group.name = 'lots'; this.group.visible = false;
    const basic = o => new THREE.MeshBasicMaterial({ fog: false, ...o });
    this.fillMat = basic({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.hiMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, fog: false });
    this.pickMat = new THREE.LineBasicMaterial({ color: 0xffc83d, depthTest: false, transparent: true, fog: false });
    this.capMat = basic({ transparent: true, opacity: 0.92 });
    this.fill = null; this.lines = null; this.hi = null; this.picks = null; this.caps = null;
  }
  y(x, z) { const t = this.app.terrain; const g = this.app.city?.g; if (t && g && (x < g.minX || x > g.maxX || z < g.minZ || z > g.maxZ)) return t.heightAt(x, z) + 0.06; return GROUND_Y + 0.03; }
  /** Triangle a-b-c on the ground: split into pieces about DRAPE m across where the ground isn't flat. */
  drapeTri(a, b, c, pos, each) {
    const n = this.flat(a) && this.flat(b) && this.flat(c) ? 1 : Math.max(1, Math.ceil(Math.max(Math.hypot(b.x - a.x, b.z - a.z), Math.hypot(c.x - b.x, c.z - b.z), Math.hypot(a.x - c.x, a.z - c.z)) / DRAPE));
    const P = (i, j) => { const x = a.x + (b.x - a.x) * i / n + (c.x - a.x) * j / n, z = a.z + (b.z - a.z) * i / n + (c.z - a.z) * j / n; return [x, this.y(x, z), z]; };
    const put = (...vs) => { for (const v of vs) { pos.push(v[0], v[1], v[2]); each(); } };
    for (let i = 0; i < n; i++) for (let j = 0; i + j < n; j++) {
      put(P(i, j), P(i + 1, j), P(i, j + 1));
      if (i + j + 1 < n) put(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1));
    }
  }
  /** Edge a-b as line pieces following the ground, lifted by up m. */
  drapeEdge(a, b, up, lin) {
    const n = this.flat(a) && this.flat(b) ? 1 : Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / DRAPE));
    let px = a.x, pz = a.z, py = this.y(px, pz) + up;
    for (let k = 1; k <= n; k++) { const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n, y = this.y(x, z) + up; lin.push(px, py, pz, x, y, z); px = x; py = y; pz = z; }
  }
  flat(p) { const g = this.app.city?.g; return !g || !this.app.terrain || (p.x >= g.minX && p.x <= g.maxX && p.z >= g.minZ && p.z <= g.maxZ); }
  setLots(lots, me) {
    this.lots = lots; this.me = me; this.byId = new Map(lots.map(l => [l.id, l]));
    for (const l of lots) {
      l.m = l.poly.map(p => ({ x: p.x * UM, z: p.z * UM }));
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const p of l.m) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z); }
      l.box = { x0, z0, x1, z1 };
      l.c = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
    }
    if (this.visible) this.build(); else this.stale = true;
  }
  /** colorOf(lot) → '#rrggbb'; dim(lot) → true to grey a lot out (a legend filter). */
  paint(colorOf, dim = () => false) { this.colorOf = colorOf; this.dim = dim; if (this.visible) this.build(); else this.stale = true; }
  build() {
    this.stale = false;
    for (const o of [this.fill, this.lines]) if (o) { this.group.remove(o); o.geometry.dispose(); }
    const pos = [], col = [], lin = [], c = new THREE.Color(), grey = new THREE.Color('#3b4250');
    const tint = l => { c.set(this.colorOf(l)); if (this.dim(l)) c.lerp(grey, 0.82); return c; };
    for (const l of this.lots) {
      tint(l);
      const pts = l.m.map(p => new THREE.Vector2(p.x, p.z)), tris = THREE.ShapeUtils.triangulateShape(pts, []);
      // In the city the ground is flat; beyond it lots lie over hills, so their faces and edges are cut small and
      // follow the ground.
      for (const t of tris) this.drapeTri(l.m[t[0]], l.m[t[1]], l.m[t[2]], pos, () => col.push(c.r, c.g, c.b));
      for (let i = 0; i < l.m.length; i++) this.drapeEdge(l.m[i], l.m[(i + 1) % l.m.length], 0.01, lin);
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.fill = new THREE.Mesh(fg, this.fillMat); this.fill.renderOrder = 2;
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lin, 3));
    this.lines = new THREE.LineSegments(lg, this.lineMat); this.lines.renderOrder = 3;
    this.group.add(this.fill, this.lines);
    this.buildCaps(tint);
  }
  /** A cap of its lot's colour on the roof of every building that stands on a lot. */
  buildCaps(tint = l => new THREE.Color(this.colorOf(l))) {
    if (this.caps) { this.group.remove(this.caps); this.caps.dispose(); this.caps = null; }
    const list = (S.world?.buildings || []).filter(B => B && !B.gone && B.lot && this.byId.has(B.lot));
    if (!list.length) return;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(box, this.capMat, list.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    list.forEach((B, k) => {
      const top = GROUND_Y + (B.base || 0) + (B.type === 'park' ? 0.7 : B.floors * FLOOR_H + 1.1);
      p.set(B.x, top + 0.25, B.z); q.setFromEuler(e.set(0, (B.rot || 0) * Math.PI / 180, 0)); s.set(B.w + 0.5, 0.5, B.d + 0.5);
      im.setMatrixAt(k, m.compose(p, q, s)); im.setColorAt(k, tint(this.byId.get(B.lot)));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.renderOrder = 2; im.frustumCulled = false;
    this.caps = im; this.group.add(im);
  }
  outline(ids, mat, prev) {
    if (prev) { this.group.remove(prev); prev.geometry.dispose(); }
    const lin = [];
    for (const id of ids) { const l = this.byId.get(id); if (!l) continue; for (let i = 0; i < l.m.length; i++) this.drapeEdge(l.m[i], l.m[(i + 1) % l.m.length], 0.05, lin); }
    if (!lin.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lin, 3));
    const o = new THREE.LineSegments(g, mat); o.renderOrder = 4; this.group.add(o); return o;
  }
  select(id) { this.hi = this.outline(id ? [id] : [], this.hiMat, this.hi); }
  picked(ids) { this.picks = this.outline(ids, this.pickMat, this.picks); }
  show(on) { this.visible = on; this.group.visible = on; if (on && this.stale) this.build(); }
  /** The lot at ground point (x, z) (metres), or null. */
  at(x, z) {
    for (const l of this.lots) {
      const b = l.box; if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      let inside = false; const P = l.m;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i].z > z) !== (P[j].z > z) && x < (P[j].x - P[i].x) * (z - P[i].z) / (P[j].z - P[i].z) + P[i].x) inside = !inside;
      if (inside) return l;
    }
    return null;
  }
  /** The lots that share a side with lot l (a point just outside the middle of each side lies in them). */
  neighbours(l) {
    const out = new Set(), P = l.m;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len;
      for (const s of [1, -1]) { const o = this.at(mx + nx * 0.4 * s, mz + nz * 0.4 * s); if (o && o !== l) out.add(o); }
    }
    return [...out];
  }
}
