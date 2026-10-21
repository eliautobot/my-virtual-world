// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Quad/triangle geometry builder with automatic winding (from the supplied normal) and custom attributes.
import * as THREE from 'three';

export class QB {
  /** extra: { attrName: itemSize } */
  constructor(extra = {}) {
    this.P = []; this.N = []; this.I = []; this.UV = null;
    this.X = {};
    for (const k in extra) this.X[k] = { n: extra[k], a: [] };
  }
  get count() { return this.P.length / 3; }
  vert(p, n, ex) {
    this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]);
    for (const k in this.X) {
      const v = ex[k], A = this.X[k].a;
      if (typeof v === 'number') A.push(v); else for (let q = 0; q < v.length; q++) A.push(v[q]);
    }
    return this.P.length / 3 - 1;
  }
  /** Quad p0..p3 (in order around the edge) facing n. ex: attributes (same for all 4 verts) or perVert(k) -> ex. */
  quad(pts, n, ex, perVert = null) {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    const base = this.P.length / 3;
    for (let k = 0; k < 4; k++) this.vert(pts[k], n, perVert ? perVert(k) : ex);
    if (flip) this.I.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Axis-aligned box (optionally skip faces: 't','b','n','s','e','w' = +y,-y,+z,-z,+x,-x). ex(face) -> attrs. */
  box(x0, y0, z0, x1, y1, z1, ex, skip = '') {
    const F = typeof ex === 'function' ? ex : () => ex;
    if (!skip.includes('t')) this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], F('t'));
    if (!skip.includes('b')) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], F('b'));
    if (!skip.includes('n')) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], F('n'));
    if (!skip.includes('s')) this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], F('s'));
    if (!skip.includes('e')) this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], F('e'));
    if (!skip.includes('w')) this.quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], F('w'));
  }
  build() {
    if (!this.I.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    for (const k in this.X) g.setAttribute(k, new THREE.Float32BufferAttribute(this.X[k].a, this.X[k].n));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Deterministic hash -> [0, 1). */
export function hsh(a, b = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Text signs packed into one canvas atlas (one texture / one material for every sign in the city). */
export class SignAtlas {
  constructor(size = 2048, cw = 256, ch = 64) {
    this.size = size; this.cw = cw; this.ch = ch; this.cols = size / cw; this.rows = size / ch;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.col = 0; this.row = 0; this.cells = new Map();
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 8;
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.15, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  alloc(span) {
    if (this.col + span > this.cols) { this.col = 0; this.row++; }
    if (this.row >= this.rows) { this.row = 0; this.col = 0; }
    const c = { c: this.col, r: this.row, span };
    this.col += span;
    return c;
  }
  /** Draw text into a cell (reused per key). Returns uv rect [u0, v0, u1, v1] and aspect (w/h). */
  sign(key, text, o = {}) {
    text = String(text || '').slice(0, 30);
    const span = o.span || (text.length > 13 ? 2 : 1);
    let cell = this.cells.get(key);
    if (!cell || cell.span !== span) { cell = this.alloc(span); this.cells.set(key, cell); }
    const x = cell.c * this.cw, y = cell.r * this.ch, w = this.cw * span, h = this.ch, c = this.ctx;
    c.save();
    c.clearRect(x, y, w, h);
    c.fillStyle = o.bg || '#1f2a44'; c.fillRect(x, y, w, h);
    c.strokeStyle = o.border || 'rgba(255,255,255,0.35)'; c.lineWidth = 3; c.strokeRect(x + 3, y + 3, w - 6, h - 6);
    let px = 40;
    const font = s => `${o.weight || 800} ${s}px "DejaVu Sans", "Noto Sans", Arial, sans-serif`;
    c.font = font(px);
    let tw = c.measureText(text).width;
    const maxW = w - (o.logo ? h + 18 : 24);
    if (tw > maxW) { px = Math.max(14, Math.floor(px * maxW / tw)); c.font = font(px); tw = c.measureText(text).width; }
    let tx = x + w / 2;
    if (o.logo) {
      const r = h * 0.34, lx = x + 12 + r;
      c.fillStyle = o.logoBg || '#1fa05a'; c.beginPath(); c.arc(lx, y + h / 2, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#fff'; c.font = font(Math.round(r * 1.3)); c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(o.logo, lx, y + h / 2 + 1);
      c.font = font(px);
      tx = x + (h + 6) + (w - h - 6) / 2;
    }
    c.fillStyle = o.fg || '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, tx, y + h / 2 + 2);
    c.restore();
    this.tex.needsUpdate = true;
    const S = this.size;
    return { uv: [x / S, 1 - (y + h) / S, (x + w) / S, 1 - y / S], aspect: w / h };
  }
}
