// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The airport's buildings that are drawn as part of its mesh (render/airport.js), on their own so they can be looked at
// alone (tools-bin/model-studio.mjs). Built into a furniture builder (render/furniture.js) in the airport's frame: s
// across (FB's x), f along (FB's z), y up.
import { FB } from './furniture.js';

const TAU = Math.PI * 2;
/** A ring round the vertical axis at (x, z): a tube of radius r (its section) at distance R, height y — a rail. */
function ring(f, x, z, R, y, r, seg = 40) { const p = []; for (let k = 0; k <= 8; k++) { const a = k / 8 * TAU; p.push([R + Math.cos(a) * r, y + Math.sin(a) * r]); } f.lathe(x, z, p, seg); }

/**
 * The control tower (2026-10-14, the product owner: "the tower needs to be better detailed — unfinished pipes meant to be a rail, and
 * the base looks too plain, just a cube"), standing at (x, z) on the ground at y, h tall to the cab's roof. The base: two
 * storeys, 12 m square — concrete corner piers, glass between them in a frame of mullions and a floor band, a parapet
 * round its roof, the entrance (its doors and a canopy) facing +s, plant on the roof and the stair's penthouse. The
 * shaft: a collar where it leaves the roof, tapering, banded every few metres, window slits on two sides. The cab: the
 * balcony floor on its fascia, a rail all round (posts, a top rail and a middle one — it had posts and one bar straight
 * across), sloped glass between mullions on a dark sill, the roof, antennas, the radar, the beacon.
 */
export function controlTower(f, x, z, y, h) {
  const R = 6, bh = 6.8, cabY = y + h - 5.2, concrete = '#dcd8cf', glass = '#3d5871', frame = '#2f3b47';
  // ---- the base
  f.col('#7d8187'); f.box(x - R - 0.15, y - 0.05, z - R - 0.15, x + R + 0.15, y + 0.4, z + R + 0.15);   // the plinth
  f.col(glass); f.box(x - R + 0.12, y + 0.4, z - R + 0.12, x + R - 0.12, y + bh - 0.55, z + R - 0.12);   // glass all round
  f.col(concrete);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(x + sx * R - (sx > 0 ? 1.0 : 0), y + 0.4, z + sz * R - (sz > 0 ? 1.0 : 0), x + sx * R + (sx < 0 ? 1.0 : 0), y + bh, z + sz * R + (sz < 0 ? 1.0 : 0));   // corner piers
  const band = (y0, y1, o) => { f.box(x - R - o, y0, z - R - o, x + R + o, y1, z - R + 0.3); f.box(x - R - o, y0, z + R - 0.3, x + R + o, y1, z + R + o); f.box(x - R - o, y0, z - R, x - R + 0.3, y1, z + R); f.box(x + R - 0.3, y0, z - R, x + R + o, y1, z + R); };
  band(y + 3.25, y + 3.75, 0.08);                                                  // the floor band between the storeys
  band(y + bh - 0.55, y + bh + 0.55, 0.12);                                        // the parapet round the roof
  f.box(x - R + 0.3, y + bh - 0.5, z - R + 0.3, x + R - 0.3, y + bh - 0.3, z + R - 0.3);   // the roof
  f.col(frame);                                                                    // mullions and transoms
  for (let k = -3; k <= 3; k++) {
    const c = k * 1.45;
    if (Math.abs(c) > R - 1.2) continue;
    for (const sz of [-1, 1]) f.box(x + c - 0.05, y + 0.4, z + sz * (R - 0.08), x + c + 0.05, y + bh - 0.55, z + sz * (R - 0.16));
    for (const sx of [-1, 1]) if (!(sx > 0 && Math.abs(c) < 1.2)) f.box(x + sx * (R - 0.08), y + 0.4, z + c - 0.05, x + sx * (R - 0.16), y + bh - 0.55, z + c + 0.05);
  }
  for (const yy of [y + 1.9, y + 5.2]) { for (const sz of [-1, 1]) f.box(x - R + 1, yy - 0.04, z + sz * (R - 0.08), x + R - 1, yy + 0.04, z + sz * (R - 0.16)); f.box(x - R - 0.0 + 0.08, yy - 0.04, z - R + 1, x - R + 0.16, yy + 0.04, z + R - 1); }
  // the entrance on the +s side: a frame, two glass doors, a canopy over them on two slim posts
  f.col(concrete); f.box(x + R - 0.2, y + 0.4, z - 1.4, x + R + 0.12, y + 2.9, z + 1.4);
  f.col('#1d2731'); f.box(x + R + 0.12, y + 0.4, z - 1.15, x + R + 0.16, y + 2.65, z - 0.04); f.box(x + R + 0.12, y + 0.4, z + 0.04, x + R + 0.16, y + 2.65, z + 1.15);
  f.col('#9aa0a7'); f.box(x + R + 0.16, y + 1.3, z - 0.3, x + R + 0.2, y + 1.4, z - 0.12); f.box(x + R + 0.16, y + 1.3, z + 0.12, x + R + 0.2, y + 1.4, z + 0.3);   // handles
  f.col('#eceae4'); f.box(x + R - 0.1, y + 3.0, z - 2.0, x + R + 1.8, y + 3.22, z + 2.0);
  f.col('#8a9097'); for (const sz of [-1, 1]) f.cyl(x + R + 1.62, z + sz * 1.82, 0.07, y + 0.4, y + 3.0, 6);
  f.col('#fff6da', 0, 2); f.box(x + R + 0.6, y + 2.96, z - 0.5, x + R + 1.2, y + 3.0, z + 0.5);   // its light
  // on the roof: two plant units with grilles, the stair's penthouse beside the shaft
  for (const [px, pz] of [[-3.6, -3.4], [-3.6, 3.2]]) {
    f.col('#b4b8bd'); f.box(x + px - 1.1, y + bh - 0.3, z + pz - 0.8, x + px + 1.1, y + bh + 0.9, z + pz + 0.8);
    f.col('#4a4f55'); f.cyl(x + px, z + pz, 0.55, y + bh + 0.9, y + bh + 0.95, 12);
  }
  f.col(concrete); f.box(x + 2.4, y + bh - 0.3, z - 4.9, x + 4.9, y + bh + 2.4, z - 2.6);
  f.col('#3a4048'); f.box(x + 4.9, y + bh - 0.3, z - 4.3, x + 4.95, y + bh + 1.8, z - 3.4);
  // ---- the shaft: a collar where it leaves the roof, tapering up, banded, window slits on two sides
  const s0 = y + bh, s1 = cabY - 1.6, rAt = yy => 2.9 - 0.4 * (yy - s0) / (s1 - s0);
  f.col('#c9c5bc'); f.cyl(x, z, 3.35, s0 - 0.3, s0 + 0.55, 24);
  f.col('#d4d1ca'); f.lathe(x, z, [[2.9, s0 + 0.5], [2.5, s1], [3.2, s1 + 0.4]], 24);
  f.col('#c2beb5'); for (let yy = s0 + 3.5; yy < s1 - 1; yy += 4.2) f.cyl(x, z, rAt(yy) + 0.06, yy, yy + 0.22, 24);
  f.col('#3e5468');
  for (const d of [1, -1]) for (let k = 0; k < 6; k++) { const yy = s0 + 1.6 + k * 2.6; if (yy + 1.2 > s1 - 0.4) break; const r = rAt(yy + 0.6); f.box(x + d * (r - 0.08) - 0.22, yy, z - 0.28, x + d * (r - 0.08) + 0.22, yy + 1.2, z + 0.28); }
  // ---- the cab: the balcony on its fascia, the rail all round, sloped glass on a sill, the roof and its instruments
  f.col('#3a4048'); f.cyl(x, z, 5.25, cabY - 1.5, cabY - 1.2, 32);
  f.col('#e9e7e1'); f.cyl(x, z, 5.2, cabY - 1.2, cabY - 0.7, 32);
  f.col('#9aa0a7');
  for (let k = 0; k < 32; k++) { const a = k / 32 * TAU; f.cyl(x + Math.cos(a) * 5.05, z + Math.sin(a) * 5.05, 0.035, cabY - 0.7, cabY + 0.38, 5); }
  ring(f, x, z, 5.05, cabY + 0.38, 0.045); ring(f, x, z, 5.05, cabY - 0.18, 0.03);
  f.col('#2b3a4a'); f.cyl(x, z, 4.12, cabY - 0.7, cabY - 0.35, 32);
  f.col('#466985'); f.lathe(x, z, [[4.0, cabY - 0.35], [4.6, cabY + 3.0]], 24);
  f.col('#2b3a4a'); for (let k = 0; k < 12; k++) { const a = (k + 0.5) * TAU / 12; f.rod([x + Math.cos(a) * 4.02, cabY - 0.4, z + Math.sin(a) * 4.02], [x + Math.cos(a) * 4.62, cabY + 3.0, z + Math.sin(a) * 4.62], 0.06, 4); }
  f.col('#f2f1ed'); f.lathe(x, z, [[5.2, cabY + 3.0], [5.0, cabY + 3.6], [0.1, cabY + 3.9]], 24);
  f.col('#8a9097'); f.cyl(x + 1.5, z, 0.08, cabY + 3.6, cabY + 8, 5); f.cyl(x - 1.5, z + 1, 0.06, cabY + 3.5, cabY + 6.5, 5);   // antennas
  f.box(x - 0.3, cabY + 3.7, z - 1.6, x + 0.3, cabY + 4.6, z - 1.0);                                                  // the radar's mount and its bar
  f.box(x - 1.8, cabY + 4.6, z - 1.45, x + 1.8, cabY + 5.1, z - 1.15);
  f.col('#ff3b30', 0, 2); f.sph(x + 1.5, cabY + 8.1, z, 0.22, 0.22, 0.22, 8, 6);
  f.col('#45d6ff', 0, 2); f.cyl(x, z, 0.35, cabY + 3.85, cabY + 4.3, 8);                                         // the beacon
  return f;
}
/** The tower alone, on the ground at the origin (for looking at it: tools-bin/model-studio.mjs). */
export function controlTowerGeometry(h = 30) { return controlTower(new FB(), 0, 0, 0, h).build().geo; }
