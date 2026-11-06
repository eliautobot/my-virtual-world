// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The light map of the floor looked into (the street lamps' trick, render/city.js bakeLightMap):
// painted once when the floor is shown (and again after an edit: render/interiors.js setFocus) into a small texture in
// the building's own frame, read by its floor, walls, furniture, Amazon models, goods and people (render/light.js roomLight).
//   r: the light of its lamps, pendants and sconces after dark (warm pools; partitions stop a lamp's light); its ceiling's
//      light is a level for the floor (GU.uRoom: brighter in a shop, in pools in an office or a shop, dim at home)
//   g: what darkens things down low: under the furniture, along the walls' feet (only what is within ~0.5 m of the floor)
//   b: the daylight from its windows (more near the outer walls, less in the middle)
import * as THREE from 'three';
import { CATALOG } from '/shared/catalog.js';
import { GU } from './scene.js';
import { furnitureGeometry } from './furniture.js';
import { isStore } from './buildings.js';
import { interiorBounds } from '/shared/edit.js';

const PER_M = 4, MAX_PX = 256;   // texels a metre, at most this many a side (a 56 m floor: 224)
// Amazon lamps (shared/abo-kinds.js) by kind: [height of the light (share of the model's), radius m, strength]
const ABO_LAMP = { floor_lamp: [0.85, 3.6, 0.68], table_lamp: [0.8, 2.3, 0.5], pendant: [0.5, 3.6, 0.6], chandelier: [0.5, 4.4, 0.8], sconce: [0.6, 2.6, 0.45] };
const spots = new Map();   // MVW piece type -> its lamps: [{ x, y, z, R, k }] in its own frame (from its lamp-lit parts)

/** Where an MVW piece's lamps are and how much they light: the faces it draws lit as a lamp after dark (render/mats.js
 *  emit 2), in up to four groups along its longer side (a strip, a row of pendants), each by its lit area (a floor lamp's
 *  shade ~0.6 m²: a wide pool; a desk lamp's ~0.07: a small one; a candle's: none). A light on a wall (a mirror's over a
 *  sink) is drawn a little into its piece, so the wall behind it keeps its pool on the piece's side. */
function lampSpots(t) {
  let s = spots.get(t);
  if (s) return s;
  s = [];
  const g = furnitureGeometry(t)?.geo, P = g?.attributes.position, C = g?.attributes.aC, I = g?.index;
  if (P && C) {
    const tris = [];   // [x, y, z, area] of each lit face
    const n3 = I ? I.count : P.count;
    for (let k = 0; k < n3; k += 3) {
      const a = I ? I.getX(k) : k, b = I ? I.getX(k + 1) : k + 1, c = I ? I.getX(k + 2) : k + 2;
      if (Math.floor(C.getW(a) * 0.5 + 0.01) !== 2) continue;
      const ux = P.getX(b) - P.getX(a), uy = P.getY(b) - P.getY(a), uz = P.getZ(b) - P.getZ(a), vx = P.getX(c) - P.getX(a), vy = P.getY(c) - P.getY(a), vz = P.getZ(c) - P.getZ(a);
      const ar = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      tris.push([(P.getX(a) + P.getX(b) + P.getX(c)) / 3, (P.getY(a) + P.getY(b) + P.getY(c)) / 3, (P.getZ(a) + P.getZ(b) + P.getZ(c)) / 3, ar]);
    }
    if (tris.length) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, , z] of tris) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const along = x1 - x0 >= z1 - z0, len = Math.max(x1 - x0, z1 - z0), n = Math.min(4, Math.max(1, Math.round(len / 0.7)));
      const groups = Array.from({ length: n }, () => [0, 0, 0, 0]);
      for (const [x, y, z, ar] of tris) {
        const u = len > 1e-3 ? ((along ? x - x0 : z - z0) / len) : 0, G = groups[Math.min(n - 1, Math.floor(u * n))];
        G[0] += x * ar; G[1] += y * ar; G[2] += z * ar; G[3] += ar;
      }
      const [rx0, rz0, rx1, rz1] = CATALOG[t]?.rect || [-0.3, -0.3, 0.3, 0.3], cx = (rx0 + rx1) / 2, cz = (rz0 + rz1) / 2;
      for (const [gx, gy, gz, ar] of groups) {
        if (ar < 0.015) continue;   // (a candle, a pilot light)
        let x = gx / ar, z = gz / ar; const dx = cx - x, dz = cz - z, dl = Math.hypot(dx, dz);
        if (dl > 1e-3) { const m = Math.min(0.3, dl) / dl; x += dx * m; z += dz * m; }
        const f = Math.min(1.3, Math.max(0.35, Math.sqrt(ar / 0.5))), y = gy / ar;
        s.push({ x, y, z, R: Math.min(4.6, (1.4 + 1.3 * y) * (0.75 + 0.25 * f)), k: Math.min(0.85, 0.62 * f) });
      }
    }
  }
  spots.set(t, s);
  return s;
}

let canvas = null, tex = null;
const neutral = (() => { const t = new THREE.DataTexture(new Uint8Array([0, 0, 120, 255]), 1, 1); t.needsUpdate = true; return t; })();
/** No floor looked into: the map reads the same everywhere (an office's ceiling, some daylight). */
export function clearRoomMap() {
  GU.uRoom.value.set(-1e6, 0.5, 0, 0);
  GU.uRoomMap.value = neutral;
  GU.uRoomXf.value.set(0, 0, 1, 0); GU.uRoomBox.value.set(-1, -1, 0.5, 0.5);
}
clearRoomMap();

/** Paints the light map of floor f of building B (L its level, y0 its floor's height). Returns the milliseconds it took. */
export function buildRoomMap(B, f, L, y0) {
  const t0 = performance.now();
  const w = B.w, d = B.d, s = Math.min(PER_M, MAX_PX / Math.max(w, d));
  const W = Math.max(4, Math.ceil(w * s)), H = Math.max(4, Math.ceil(d * s));
  if (!canvas) canvas = document.createElement('canvas');
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; if (tex) { tex.dispose(); tex = null; } }
  const c = canvas.getContext('2d');
  const X = x => (x + w / 2) * s, Z = z => (z + d / 2) * s;   // building-local metres -> texels
  c.globalCompositeOperation = 'source-over';
  // after dark, the ceiling's light everywhere (render/light.js roomLight): a shop's brightest, an office's in soft pools,
  // a home's dim (its lamps make the pools), a club's dimmer still
  // (by the floor's own use: a shop on the ground floor of a block of flats is a shop)
  const venue = L.venue, dim = venue === 'club' || venue === 'lounge_bar' || venue === 'arcade';
  const store = ['shop', 'cafe', 'restaurant', 'gym'].includes(venue) || (!venue && isStore(B)), home = !venue && B.type === 'apartment';
  GU.uRoom.value.set(y0, dim ? 0.2 : home ? 0.3 : store ? (venue === 'cafe' || venue === 'restaurant' ? 0.5 : 0.6) : 0.5, home || dim ? 0 : 0.35, 0);
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'lighter';
  // the lamps: each its pool, cut where a partition stands between it and the floor
  const walls = (L.walls || []).filter(wl => wl[4] !== 1).map(([x1, z1, x2, z2]) => [X(x1), Z(z1), X(x2), Z(z2)]);
  for (const it of L.items || []) {
    const D = CATALOG[it.t]; if (!D || D.goods) continue;
    const r = it.r || 0, cs = Math.cos(r), sn = Math.sin(r);
    const lamp = (lx, ly, lz, R, k) => {
      const px = X(it.x + lx * cs + lz * sn), pz = Z(it.z - lx * sn + lz * cs);
      lampPool(c, px, pz, R * s, k, walls);
    };
    const A = D.abo && ABO_LAMP[D.kind];
    if (A) { const h = (D.h || 1) * A[0]; lamp(0, h, D.wall ? 0.15 : 0, A[1], A[2]); continue; }
    for (const p of lampSpots(it.t)) lamp(p.x, p.y, p.z, p.R, p.k);
  }
  // the shade down low: under each standing piece (not a rug, a pendant, a thing on a wall) and along the walls' feet, soft
  c.save();
  c.filter = `blur(${Math.max(1, 0.2 * s).toFixed(1)}px)`;
  c.fillStyle = 'rgba(0,255,0,0.5)';
  for (const it of L.items || []) {
    const D = CATALOG[it.t]; if (!D || D.goods || D.wall || D.block === false || (D.h ?? 1) < 0.25 || !D.rect) continue;
    const [x0, z0, x1, z1] = D.rect;
    c.setTransform(1, 0, 0, 1, X(it.x), Z(it.z)); c.rotate(-(it.r || 0));
    c.fillRect((x0 - 0.05) * s, (z0 - 0.05) * s, (x1 - x0 + 0.1) * s, (z1 - z0 + 0.1) * s);
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.strokeStyle = 'rgba(0,255,0,0.42)'; c.lineWidth = 0.45 * s; c.lineCap = 'square';
  c.beginPath();
  for (const [x1, z1, x2, z2] of walls) { c.moveTo(x1, z1); c.lineTo(x2, z2); }
  const ib = interiorBounds(B);
  c.rect(X(ib.x0), Z(ib.z0), (ib.x1 - ib.x0) * s, (ib.z1 - ib.z0) * s);
  c.stroke();
  c.restore();
  // the windows' daylight: from every outer wall, fading in over ~4 m
  const day = (x0, z0, x1, z1) => { const g = c.createLinearGradient(X(x0), Z(z0), X(x1), Z(z1)); g.addColorStop(0, 'rgba(0,0,255,0.95)'); g.addColorStop(0.35, 'rgba(0,0,255,0.35)'); g.addColorStop(1, 'rgba(0,0,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H); };
  const k = Math.min(4, w / 2, d / 2);
  day(-w / 2, 0, -w / 2 + k, 0); day(w / 2, 0, w / 2 - k, 0); day(0, -d / 2, 0, -d / 2 + k); day(0, d / 2, 0, d / 2 - k);
  if (!tex) { tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; }
  tex.needsUpdate = true;
  const rot = (B.rot || 0) * Math.PI / 180;
  GU.uRoomMap.value = tex;
  GU.uRoomXf.value.set(B.x, B.z, Math.cos(rot), Math.sin(rot));
  GU.uRoomBox.value.set(-w / 2, -d / 2, 1 / w, 1 / d);
  return performance.now() - t0;
}
function pool(c, x, z, R, a) {
  const g = c.createRadialGradient(x, z, 0, x, z, R);
  g.addColorStop(0, `rgba(255,0,0,${a})`); g.addColorStop(0.35, `rgba(255,0,0,${a * 0.75})`); g.addColorStop(0.7, `rgba(255,0,0,${a * 0.3})`); g.addColorStop(1, 'rgba(255,0,0,0)');
  c.fillStyle = g; c.fillRect(x - R, z - R, 2 * R, 2 * R);
}
let scratch = null;
/** A lamp's pool (texels), with the shadows of the partitions near it cut out of it. */
function lampPool(c, x, z, R, a, walls) {
  const near = walls.filter(([x1, z1, x2, z2]) => segDist(x, z, x1, z1, x2, z2) < R);
  if (!near.length) { pool(c, x, z, R, a); return; }
  const n = Math.ceil(2 * R) + 2;
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width < n || scratch.height < n) { scratch.width = scratch.height = Math.max(n, 64); }
  const q = scratch.getContext('2d'), ox = x - n / 2, oz = z - n / 2;
  q.globalCompositeOperation = 'source-over'; q.clearRect(0, 0, n, n);
  pool(q, n / 2, n / 2, R, a);
  q.globalCompositeOperation = 'destination-out'; q.fillStyle = '#000';
  for (const [x1, z1, x2, z2] of near) {   // the wall's shadow from the lamp: the wall pushed out away from it
    const far = (px, pz) => { const dx = px - x, dz = pz - z, l = Math.hypot(dx, dz) || 1; return [px + dx / l * 3 * R - ox, pz + dz / l * 3 * R - oz]; };
    const [ax, az] = far(x1, z1), [bx, bz] = far(x2, z2);
    q.beginPath(); q.moveTo(x1 - ox, z1 - oz); q.lineTo(x2 - ox, z2 - oz); q.lineTo(bx, bz); q.lineTo(ax, az); q.closePath(); q.fill();
  }
  c.drawImage(scratch, 0, 0, n, n, ox, oz, n, n);
}
function segDist(px, pz, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / L2)) : 0;
  return Math.hypot(px - x1 - t * dx, pz - z1 - t * dz);
}
