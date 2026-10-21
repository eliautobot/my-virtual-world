// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Interiors: parks (always drawn: finishes, hedges, gates, name arch, instanced objects) and the focused building
// floor (slab, floor finishes, perimeter walls whose openings line up with the facade windows, partitions, elevator
// core, instanced furniture). Walls mode: cut (1.2 m cutaway), up (full height), down (stubs).
import * as THREE from 'three';
import { WALL_T, floorAt } from '/shared/constants.js';
import { toWorld, bRot, footprint, square, itemRect, inItemRect } from '/shared/geom.js';
import { CATALOG, FINISHES } from '/shared/catalog.js';
import { INDOOR_SIGNS, signGeoKey, signFace } from '/shared/signs.js';
import { interiorBounds } from '/shared/edit.js';
import { makeFurnMat, makeFloorMat } from './mats.js';
import { maskMaterial } from './outline.js';
import { FB, lin, furnitureGeometry } from './furniture.js';
import { QB } from './qb.js';
import { STY, FACADE, facadeCols, isStore } from './buildings.js';

export const WALL_H = { up: 3.25, cut: 1.2, down: 0.12, fp: 3.25 };   // fp: first person in Play mode (with a ceiling)
const WALL_COL = { office: '#e6e4df', hq: '#eceae6', apartment: '#efe8dc', cafe: '#eadfcf', restaurant: '#ecdcc8', shop: '#ebe7e0', gym: '#dfe3e6' };
const CAP = '#6f757d';
const _sc = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
const _ray = new THREE.Ray(), _box = new THREE.Box3(), _hit = new THREE.Vector3(), _pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function mk(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.castShadow = cast; m.receiveShadow = true; return m; }

// what people sit at and set things down on (tableTopAt): the top of each, as render/furniture.js draws it (not
// shared/standable.js itemTop — the height walked on, a little off for some: a laptop stood 2 cm above a picnic table
// and its base 2 cm into a bar's counter by it)
const TABLE_TOP = Object.freeze({
  dining_table: 0.76, cafe_table: 0.76, cafe_table4: 0.76, picnic_table: 0.76, bar_counter: 1.1, meeting_table: 0.76,
  desk: 0.755, desk_l: 0.755, desk_exec: 0.77, desk_home: 0.755, coffee_table: 0.42, counter: 0.94,
});
// (and what is set down stays in front of: a bar's bottles along the back of its counter — its own z, toward its front)
const TABLE_KEEP = Object.freeze({ bar_counter: -0.15 });
/** An item's box for picking and its selection outline: its rectangle and heights (a sign's: round its face). */
function dims(e) {
  const d = CATALOG[e.t]; if (!d) return null;
  const rect = e.it ? itemRect(e.it, d.rect) : d.rect, S = INDOOR_SIGNS[e.t];
  if (S && e.it) { const F = signFace(e.it), top = F.y + F.h / 2 + 0.09; return { rect, y0: S.family === 'wall' ? F.y - F.h / 2 - 0.06 : 0, y1: top }; }
  return { rect, y0: 0, y1: Math.max(0.15, d.h || 1) };
}
export class Interiors {
  constructor(world, atlas) {
    this.world = world; this.atlas = atlas;
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false;
    this.furnMat = makeFurnMat({ lit: true, indoor: true });
    this.glassMat = makeFurnMat({ glass: true });
    this.floorMat = makeFloorMat({ lit: true, indoor: true });
    this.parkMat = makeFurnMat({ lit: true });
    this.parkFloorMat = makeFloorMat({ lit: true });
    this.park = { meshes: [], entries: [] };
    this.foc = { meshes: [], entries: [] };
    this.focus = { b: -1, f: 0, mode: 'cut' };
    this.cutY = 1e6;
    this.sel = null;   // the piece picked to edit: outlined (highlight, outlineDraw)
    this.selMask = { mat: maskMaterial(), list: [] };
    this.rebuildParks();
  }
  clear(set) {
    for (const m of set.meshes) { this.group.remove(m); if (m.isInstancedMesh) m.dispose(); else m.geometry.dispose(); }
    set.meshes = []; set.entries = [];
  }
  entry(B, f, lv, it) {
    const y = B.type === 'park' ? floorAt(B, 0) : floorAt(B, f), w = toWorld(B, it.x, it.z);
    return { t: it.t, x: w.x, y, z: w.z, yaw: bRot(B) + (it.r || 0), c: it.c, id: it.id, b: B.idx, f, lv, it };
  }
  addItems(set, list, mat = this.furnMat) {
    const by = new Map();
    for (const e of list) { const k = signGeoKey(e.it) || e.t; let a = by.get(k); if (!a) by.set(k, a = []); a.push(e); }   // a sign in its style
    for (const [gk, arr] of by) {
      const G = furnitureGeometry(gk);
      for (const [geo, m2, cast] of [[G.geo, mat, true], [G.glass, this.glassMat, false]]) {
        if (!geo) continue;
        const im = new THREE.InstancedMesh(geo, m2, arr.length);
        arr.forEach((e, k) => {
          _q.setFromAxisAngle(_up, e.yaw); _p.set(e.x, e.y, e.z);   // (a sign's geometry is made at its size: signGeoKey)
          im.setMatrixAt(k, _m.compose(_p, _q, _sc.set(1, 1, 1)));
          im.setColorAt(k, _c.set(e.c || '#ffffff'));
          (e.ims || (e.ims = [])).push([im, k]);
        });
        im.castShadow = cast; im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im); set.meshes.push(im);
      }
    }
    for (const e of list) set.entries.push(e);
  }
  addMeshes(set, pairs) {
    for (const [geo, mat, cast] of pairs) if (geo) { const m = mk(geo, mat, cast); this.group.add(m); set.meshes.push(m); }
  }
  zones(q, B, L, y0) {
    (L.zones || []).forEach((z, k) => {
      const fin = FINISHES[z[4]] || FINISHES.concrete, col = lin(fin.color), y = y0 + k * 0.003;
      const P = [[z[0], z[1]], [z[2], z[1]], [z[2], z[3]], [z[0], z[3]]];
      const Wp = P.map(([lx, lz]) => { const p = toWorld(B, lx, lz); return [p.x, y, p.z]; });
      q.quad(Wp, [0, 1, 0], null, v => ({ aPat: fin.pattern, aFC: col, aL: P[v] }));
    });
  }

  // ---------------------------------------------------------------- parks
  rebuildParks() {
    this.clear(this.park);
    const W = this.world, fq = new QB({ aPat: 1, aFC: 3, aL: 2 }), fb = new FB(), sq = new QB({ uv: 2 }), items = [];
    for (const B of W.buildings) {
      if (!B || B.gone || B.type !== 'park') continue;
      const lvIdx = B.lv[0], L = W.levels[lvIdx]; if (!L) continue;
      this.zones(fq, B, L, floorAt(B, 0) + 0.004);
      for (const it of L.items) items.push(this.entry(B, 0, lvIdx, it));
      this.parkEdge(fb, sq, B);
    }
    this.addItems(this.park, items, this.parkMat);
    const G = fb.build();
    this.addMeshes(this.park, [[fq.build(), this.parkFloorMat, false], [G.geo, this.parkMat, true], [G.glass, this.glassMat, false], [sq.build(), this.atlas.mat, false]]);
  }
  parkEdge(f, sq, B) {
    const hw = B.w / 2, hd = B.d / 2, e = 0.35, gap = 1.7, th = 0.28, hh = 0.85;
    f.push(B.x, floorAt(B, 0), B.z, bRot(B));
    const hedge = (x0, z0, x1, z1) => {
      if (x1 - x0 < 0.05 || z1 - z0 < 0.05) return;
      f.col('#3d7336'); f.box(x0, 0, z0, x1, hh, z1);
      f.col('#4a8541'); f.box(x0 + 0.05, hh, z0 + 0.05, x1 - 0.05, hh + 0.12, z1 - 0.05);
    };
    for (const s of [1, -1]) { const z = s * (hd - e); hedge(-hw + e - th, z - th, -gap, z + th); hedge(gap, z - th, hw - e + th, z + th); }
    for (const s of [1, -1]) { const x = s * (hw - e); hedge(x - th, -hd + e + th, x + th, -gap); hedge(x - th, gap, x + th, hd - e - th); }
    for (const [x, z] of [[-gap, hd - e], [gap, hd - e], [-gap, -hd + e], [gap, -hd + e], [hw - e, -gap], [hw - e, gap], [-hw + e, -gap], [-hw + e, gap]]) {
      f.col('#bdb5a8'); f.box(x - 0.24, 0, z - 0.24, x + 0.24, 1.25, z + 0.24);
      f.col('#a39b8e'); f.box(x - 0.29, 1.25, z - 0.29, x + 0.29, 1.35, z + 0.29);
    }
    const az = hd - e;
    f.col('#2f3a33');
    f.box(-gap - 0.1, 1.35, az - 0.1, -gap + 0.1, 3.3, az + 0.1); f.box(gap - 0.1, 1.35, az - 0.1, gap + 0.1, 3.3, az + 0.1);
    f.box(-gap - 0.3, 3.3, az - 0.14, gap + 0.3, 3.95, az + 0.14);
    f.col('#ffe2a8', 0, 2); f.box(-gap - 0.25, 3.28, az - 0.1, gap + 0.25, 3.3, az + 0.1);
    f.pop();
    const s = this.atlas.sign('park:' + B.idx, B.name, { bg: '#2f5d3a', fg: '#f4f1e6', border: 'rgba(244,241,230,.45)' });
    const w = Math.min(2 * gap + 0.45, 0.58 * s.aspect), y0 = floorAt(B, 0) + 3.33, h = 0.58, uv = s.uv, r = bRot(B);
    for (const side of [1, -1]) {
      const zz = az + side * 0.146, xs = side > 0 ? [-w / 2, w / 2] : [w / 2, -w / 2];
      const P = [[xs[0], y0], [xs[1], y0], [xs[1], y0 + h], [xs[0], y0 + h]].map(([lx, y]) => { const p = toWorld(B, lx, zz); return [p.x, y, p.z]; });
      sq.quad(P, [Math.sin(r) * side, 0, Math.cos(r) * side], null, k => ({ uv: [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]][k] }));
    }
  }

  // ---------------------------------------------------------------- focused floor
  setFocus(b, f, mode = 'cut') {
    this.focus = { b, f, mode };
    this.clear(this.foc);
    this.sel = null;
    const B = b >= 0 ? this.world.buildings[b] : null;
    if (!B || B.gone || B.type === 'park') return (this.cutY = 1e6);
    const lvIdx = B.lv[f], L = this.world.levels[lvIdx];
    if (!L) return (this.cutY = 1e6);
    const H = WALL_H[mode] ?? WALL_H.cut, y0 = floorAt(B, f);
    const fq = new QB({ aPat: 1, aFC: 3, aL: 2 });
    this.zones(fq, B, L, y0 + 0.006);
    const fb = new FB();
    fb.push(B.x, y0, B.z, bRot(B));
    const ib = interiorBounds(B);
    fb.col('#8d8a84'); fb.box(ib.x0, -0.25, ib.z0, ib.x1, 0.002, ib.z1, 'b');
    this.perimeter(fb, B, f, H);
    if (mode === 'fp') { fb.col('#eceae4'); fb.box(ib.x0, H, ib.z0, ib.x1, H + 0.12, ib.z1, 't'); }   // the ceiling over the eyes
    this.partitions(fb, L, H);
    const items = [];
    for (const it of L.items) {
      const d = CATALOG[it.t];
      if (d && d.fixed) { this.core(fb, it, H); continue; }
      items.push(this.entry(B, f, lvIdx, it));
    }
    fb.pop();
    this.addItems(this.foc, items);
    const G = fb.build();
    this.addMeshes(this.foc, [[fq.build(), this.floorMat, false], [G.geo, this.furnMat, true], [G.glass, this.glassMat, false]]);
    return (this.cutY = y0 + H);
  }
  perimeter(f, B, fl, H) {
    const hw = B.w / 2, hd = B.d / 2, t = WALL_T, sty = STY[B.style] ?? 3, fp = footprint(B);
    const frontK = ((Math.round((B.rot || 0) / 90) % 4) + 4) % 4;
    const WF = [[fp.x0, fp.z1], [fp.x1, fp.z1], [fp.x1, fp.z0], [fp.x0, fp.z0]];
    const LF = [[[-hw, hd], [hw, hd]], [[hw, hd], [hw, -hd]], [[hw, -hd], [-hw, -hd]], [[-hw, -hd], [-hw, hd]]];
    const [, ww, sill, head] = FACADE[sty];
    const wallCol = WALL_COL[B.type] || '#e8e6e1';
    for (let j = 0; j < 4; j++) {
      const k = (j + frontK) % 4, wa = WF[k], [la, lc] = LF[j];
      const len = Math.hypot(lc[0] - la[0], lc[1] - la[1]);
      const aw = toWorld(B, la[0], la[1]);
      const same = !square(B) || Math.abs(aw.x - wa[0]) + Math.abs(aw.z - wa[1]) < 0.01;   // turned shells run local, like this
      const toS = u => (same ? u : len - u);
      const open = [];
      const door = j === 0 && fl === 0 && B.door ? [B.door.x + hw - B.door.w / 2 - 0.1, B.door.x + hw + B.door.w / 2 + 0.1] : null;
      if (door) open.push([door[0], door[1], 0, 2.5, false]);
      if (door && isStore(B)) {
        for (let u0 = 0.5; u0 < len - 0.5; u0 += 3.3) {
          const a = u0 + 0.24, b = Math.min(u0 + 3.3, len - 0.5);
          for (const [s0, s1] of [[a, Math.min(b, door[0])], [Math.max(a, door[1]), b]]) if (s1 - s0 > 0.05) open.push([s0, s1, 0.3, 2.85, true]);
        }
      } else {
        const { n, cw, off } = facadeCols(sty, len);
        for (let i = 0; i < n; i++) {
          const c = off + (i + 0.5) * cw, a = c - ww / 2, b = c + ww / 2;
          if (door && a < door[1] && b > door[0]) continue;
          open.push([a, b, sill, head, true]);
        }
      }
      const segs = open.map(o => { const a = toS(o[0]), b = toS(o[1]); return [Math.min(a, b), Math.max(a, b), o[2], o[3], o[4]]; });
      const lo = j % 2 ? t : 0, hi = j % 2 ? len - t : len;
      const cuts = new Set([lo, hi]);
      for (const s of segs) for (const v of [s[0], s[1]]) if (v > lo && v < hi) cuts.add(v);
      const xs = [...cuts].sort((a, b) => a - b);
      const P = s => [la[0] + (lc[0] - la[0]) * s / len, la[1] + (lc[1] - la[1]) * s / len];
      const piece = (s0, s1, y0, y1, glass) => {
        if (y1 - y0 < 0.004 || s1 - s0 < 0.004) return;
        const a = P(s0), b = P(s1);
        let x0, x1, z0, z1;
        if (j === 0) { x0 = Math.min(a[0], b[0]); x1 = Math.max(a[0], b[0]); z0 = hd - t; z1 = hd - 0.012; }
        else if (j === 2) { x0 = Math.min(a[0], b[0]); x1 = Math.max(a[0], b[0]); z0 = -hd + 0.012; z1 = -hd + t; }
        else if (j === 1) { z0 = Math.min(a[1], b[1]); z1 = Math.max(a[1], b[1]); x0 = hw - t; x1 = hw - 0.012; }
        else { z0 = Math.min(a[1], b[1]); z1 = Math.max(a[1], b[1]); x0 = -hw + 0.012; x1 = -hw + t; }
        if (glass) {
          const mz = (z0 + z1) / 2, mx = (x0 + x1) / 2;
          f.glass('#bcd6e2');
          if (j % 2 === 0) f.box(x0, y0, mz - 0.012, x1, y1, mz + 0.012); else f.box(mx - 0.012, y0, z0, mx + 0.012, y1, z1);
          return;
        }
        f.col(wallCol); f.box(x0, y0, z0, x1, y1, z1);
        if (y1 >= H - 1e-4) { f.col(CAP); f.box(x0, H, z0, x1, H + 0.012, z1); }
        else if (y1 > 0.3) { f.col('#d4d0c8'); f.box(x0 - (j === 3 ? 0 : j === 1 ? 0.05 : 0), y1 - 0.03, z0 - (j === 0 ? 0.05 : 0), x1 + (j === 3 ? 0.05 : 0), y1, z1 + (j === 2 ? 0.05 : 0)); }
      };
      for (let q = 0; q < xs.length - 1; q++) {
        const s0 = xs[q], s1 = xs[q + 1], mid = (s0 + s1) / 2, o = segs.find(s => mid > s[0] && mid < s[1]);
        if (!o) { piece(s0, s1, 0, H, false); continue; }
        piece(s0, s1, 0, Math.min(o[2], H), false);
        if (o[3] < H) piece(s0, s1, o[3], H, false);
        if (o[4] && o[2] < H) piece(s0, s1, o[2], Math.min(o[3], H), true);
      }
    }
  }
  partitions(f, L, H) {
    for (const w of L.walls || []) {
      const [x1, z1, x2, z2, kind] = w, dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz);
      if (len < 0.01) continue;
      const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, yaw = Math.atan2(-dz, dx);
      if (kind === 1) {
        f.col('#3a3f46');
        f.boxC(x1, H / 2, z1, 0.03, H / 2, 0.03, yaw); f.boxC(x2, H / 2, z2, 0.03, H / 2, 0.03, yaw);
        f.boxC(cx, H - 0.02, cz, len / 2, 0.02, 0.03, yaw); f.boxC(cx, 0.04, cz, len / 2, 0.04, 0.03, yaw);
        f.glass('#cfe3ec'); f.boxC(cx, H / 2, cz, len / 2, H / 2 - 0.04, 0.012, yaw);
      } else {
        f.col('#efece6'); f.boxC(cx, H / 2, cz, len / 2 + 0.06, H / 2, 0.06, yaw);
        f.col(CAP); f.boxC(cx, H + 0.006, cz, len / 2 + 0.06, 0.006, 0.06, yaw);
      }
    }
  }
  core(f, it, H) {
    const d = CATALOG[it.t], [x0, z0, x1, z1] = d.rect, hc = Math.max(H, 0.12);
    f.push(it.x, 0, it.z, it.r || 0);
    f.col('#c4c1ba'); f.box(x0, 0, z0, x1, hc, z1);
    f.col('#24272c'); f.box(x0 + 0.2, hc, z0 + 0.2, x1 - 0.2, hc + 0.01, z1 - 0.2);
    for (const [dx, dz] of d.doors || []) {
      const dh = Math.min(2.15, hc);
      f.col('#7d838b'); f.box(dx - 0.68, 0, dz, dx + 0.68, Math.min(2.3, hc), dz + 0.03);
      f.col('#c9ced4'); f.box(dx - 0.55, 0, dz + 0.03, dx - 0.012, dh, dz + 0.05); f.box(dx + 0.012, 0, dz + 0.03, dx + 0.55, dh, dz + 0.05);
      if (hc > 1.25) { f.col('#2b2e33'); f.box(dx + 0.78, 0.98, dz, dx + 0.9, 1.22, dz + 0.04); f.col('#ffd166', 0, 3); f.box(dx + 0.8, 1.08, dz + 0.04, dx + 0.88, 1.14, dz + 0.05); }
      if (hc > 2.45) { f.col('#1b1d21'); f.box(dx - 0.3, 2.32, dz, dx + 0.3, 2.5, dz + 0.04); f.col('#ff5a3c', 0, 3); f.box(dx - 0.12, 2.36, dz + 0.04, dx + 0.12, 2.46, dz + 0.045); }
    }
    f.pop();
  }
  /** Rebuild whatever shows level lv. */
  onLevel(lv) {
    const W = this.world;
    if (W.buildings.some(B => B && !B.gone && B.type === 'park' && B.lv[0] === lv)) this.rebuildParks();
    const { b, f, mode } = this.focus, B = b >= 0 ? W.buildings[b] : null;
    if (B && B.lv[f] === lv) this.setFocus(b, f, mode);
  }

  // ---------------------------------------------------------------- picking + selection
  pickItem(ray, parks = true) {
    let best = null;
    const test = (e) => {
      const D = dims(e); if (!D) return;
      const [x0, z0, x1, z1] = D.rect, c = Math.cos(e.yaw), s = Math.sin(e.yaw);
      const ox = ray.origin.x - e.x, oz = ray.origin.z - e.z, dx = ray.direction.x, dz = ray.direction.z;
      _ray.origin.set(ox * c - oz * s, ray.origin.y - e.y, ox * s + oz * c);
      _ray.direction.set(dx * c - dz * s, ray.direction.y, dx * s + dz * c);
      _box.min.set(x0, D.y0, z0); _box.max.set(x1, D.y1, z1);
      if (!_ray.intersectBox(_box, _hit)) return;
      const dist = _hit.distanceTo(_ray.origin);
      if (!best || dist < best.d) best = { e, d: dist };
    };
    for (const e of this.foc.entries) test(e);
    if (parks) for (const e of this.park.entries) test(e);
    return best;
  }
  findEntry(b, f, id) {
    for (const e of this.foc.entries) if (e.b === b && e.f === f && e.id === id) return e;
    for (const e of this.park.entries) if (e.b === b && e.id === id) return e;
    return null;
  }
  /** The top (m, world) of the table at (x, z) on the floor looked into or in a park — the highest at or below `highest` —
   *  or null (a laptop or a mug set down on it stands there: render/characters.js deskLift). far ({ x, z }: the farthest
   *  point of what is set down, its lid): far.back is set to how far it must come toward its front to stay clear of what
   *  stands at the table's back (TABLE_KEEP). */
  tableTopAt(x, z, highest = Infinity, far = null) {
    let top = null, at = null;
    if (far) far.back = 0;
    for (const set of [this.foc, this.park]) for (const e of set.entries) {
      const t = TABLE_TOP[e.t];
      if (t === undefined || Math.abs(e.x - x) > 2.5 || Math.abs(e.z - z) > 2.5) continue;
      const d = CATALOG[e.t];
      if (!d?.rect || !inItemRect(x, z, e.x, e.z, e.yaw, itemRect(e.it, d.rect))) continue;
      const h = e.y + t;
      if (h <= highest && (top === null || h > top)) { top = h; at = e; }
    }
    const keep = far && at ? TABLE_KEEP[at.t] : undefined;
    if (keep !== undefined) {
      const lz = (far.x - at.x) * Math.sin(at.yaw) + (far.z - at.z) * Math.cos(at.yaw);   // (in its own frame)
      if (lz < keep) far.back = keep - lz;
    }
    return top;
  }
  /** Outlines placed item e (null: none) as the one picked to edit (render/outline.js). */
  highlight(e) { this.sel = e || null; }
  /** The picked piece drawn alone, for its outline: each of its parts' instances, through a mask material. */
  outlineDraw(draw) {
    const e = this.sel;
    if (!e || !e.ims) return;
    const M = this.selMask, box = M.box ??= new THREE.Box3();
    box.min.set(e.x - 2.5, e.y - 0.2, e.z - 2.5); box.max.set(e.x + 2.5, e.y + 3.2, e.z + 2.5);   // (round it: the biggest piece)
    e.ims.forEach(([im, k], n) => {
      if (!im.parent) return;
      let m = M.list[n];
      if (!m) { m = M.list[n] = new THREE.Mesh(im.geometry, M.mat); m.frustumCulled = false; m.matrixAutoUpdate = false; m.matrixWorldAutoUpdate = false; }
      m.geometry = im.geometry;
      im.getMatrixAt(k, _m);
      m.matrixWorld.multiplyMatrices(im.matrixWorld, _m);
      draw(m, true, box);
    });
  }
  floorPoint(ray, y) { _pl.constant = -y; return ray.intersectPlane(_pl, new THREE.Vector3()); }
  /** Temporarily hide / show one placed item (while it is being dragged). */
  setHidden(e, hidden) {
    if (!e || !e.ims) return;
    for (const [im, k] of e.ims) {
      if (hidden) { im.getMatrixAt(k, _m); e._m = e._m || _m.clone(); e._m.copy(_m); im.setMatrixAt(k, _m.makeScale(0, 0, 0)); }
      else if (e._m) im.setMatrixAt(k, e._m);
      im.instanceMatrix.needsUpdate = true;
    }
  }
}
