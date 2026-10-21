// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Solid boxes with tops (docs/features/play-modules.md): every building as a box from its base to its roof, and the world
// modules' structures (an airport's terminal, tower and hangar). A helicopter lands on any of these roofs, aircraft hit
// their walls, and the airport's ring courses stay clear of them. Built when the world changes (never per frame) into a
// coarse grid, so a lookup only tests the boxes near it.
import { GROUND_Y, FLOOR_H, baseOf } from './constants.js';
import { moduleBoxes } from './world-modules.js';

const CELL = 64;
/** Every solid box: [{ x, z, hw, hd, rot (radians), y0, y1, label }]. */
export function solidBoxes(world) {
  const out = [];
  for (const B of world?.buildings || []) {
    if (!B || B.gone || !(B.floors > 0) || B.type === 'park') continue;
    const y0 = GROUND_Y + baseOf(B);
    out.push({ x: B.x, z: B.z, hw: B.w / 2, hd: B.d / 2, rot: ((B.rot || 0) * Math.PI) / 180, y0, y1: y0 + B.floors * FLOOR_H, label: B.name || 'a building', b: B.idx });
  }
  for (const m of moduleBoxes(world)) out.push(m);
  return out;
}
/** The boxes indexed by the grid cells they touch. */
export class Solids {
  constructor(world) { this.set(world); }
  set(world) {
    this.boxes = solidBoxes(world);
    this.cells = new Map();
    for (const b of this.boxes) {
      const r = Math.hypot(b.hw, b.hd);
      for (let i = Math.floor((b.x - r) / CELL); i <= Math.floor((b.x + r) / CELL); i++) for (let j = Math.floor((b.z - r) / CELL); j <= Math.floor((b.z + r) / CELL); j++) {
        const k = `${i},${j}`; let L = this.cells.get(k); if (!L) this.cells.set(k, L = []); L.push(b);
      }
    }
    return this;
  }
  /** The boxes whose footprint holds (x, z) (grown by g metres). */
  at(x, z, g = 0) {
    const L = this.cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`), out = [];
    if (L) for (const b of L) if (inBox(b, x, z, g)) out.push(b);
    return out;
  }
  /** The highest roof at (x, z) (grown by g), or −Infinity. */
  roofAt(x, z, g = 0) { let y = -Infinity; for (const b of this.at(x, z, g)) y = Math.max(y, b.y1); return y; }
  /** The box a point inside a solid is in (x, y, z), or null: aircraft hit walls. */
  hit(x, y, z, g = 0) { for (const b of this.at(x, z, g)) if (y > b.y0 - 0.1 && y < b.y1 - 0.05) return b; return null; }
}
export function inBox(b, x, z, g = 0) {
  const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), n = Math.sin(b.rot);
  return Math.abs(dx * c - dz * n) <= b.hw + g && Math.abs(dx * n + dz * c) <= b.hd + g;
}
