// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Boats in the city's style (the design review 2026-10-03: "animals need to be more detailed ... also for other assets like
// boats/ferries"): hulls lofted from cross-sections - fine at the bow, flared, a transom at the stern, painted in bands
// (antifouling, boot top, topsides, sheer stripe) - with their fittings: a sailing dinghy (open cockpit, mast, boom,
// mainsail and jib in curved cloth), a motor launch (cabin with a raked windscreen, rails, an outboard) and the island
// ferry (two passenger decks with window bands that light at night, a wheelhouse, funnel, mast with radar, lifeboats,
// railings and lifebuoys). Bow along +z, the waterline at y = 0. Geometry from FB (render/furniture.js), so the
// furniture material draws it (aC; windows marked to glow at night).
import { FB } from './furniture.js';

const TAU = Math.PI * 2;
/**
 * A hull: L long (z from −L/2 to L/2), B wide, its sheer (deck edge) `free` above the water rising `rise` to the bow,
 * `draft` deep, V-shaped (vee 0 round-bilged … 1 deep V), the transom `transom` of the full beam. bands: the paint from
 * the keel up, [[top y, colour], ...], the last reaching the deck edge.
 * Returns the deck edge points per station [{ z, b, s }] for fittings.
 */
export function hull(f, { L, B, free, rise = 0.3, draft, vee = 0.4, transom = 0.8, stations = 14, bands, open = false, wall = 0.06 }) {
  const st = [];
  for (let i = 0; i <= stations; i++) {
    const t = i / stations, z = -L / 2 + L * t;
    // the beam: full amidships, a fine entry to the stem, the transom cut square
    const fwd = t > 0.55 ? Math.pow(Math.max(0, 1 - (t - 0.55) / 0.45), 0.75) : 1, aft = transom + (1 - transom) * Math.min(1, t / 0.3);
    const b = B / 2 * Math.min(fwd, aft), s = free + rise * t * t, k = draft * (t > 0.85 ? 1 - (t - 0.85) / 0.15 * 0.8 : 1) * (t < 0.08 ? 0.8 + 2.5 * t : 1);
    st.push({ z, b: Math.max(b, 0.02), s, k });
  }
  // the section, gunwale to keel: flared topsides, a turn of the bilge (round or V), the keel
  const sec = (S, inset = 0) => {
    const b = Math.max(0.01, S.b - inset), k = S.k, s = S.s - inset * 0.5;
    return [[b, s], [b * 0.99, s * 0.45], [b * 0.93, 0], [b * (0.78 - 0.15 * vee), -k * (0.35 + 0.25 * vee)], [b * (0.42 - 0.2 * vee), -k * (0.8 + 0.1 * vee)], [0, -k]].map(([x, y]) => [x, Math.max(y, -k)]);
  };
  // the sides, band by band (crisp lines between the paints): each band a strip from its lower edge to its upper one,
  // the section's half-width read off its outline at those heights
  const xAt = (P, y) => { for (let j = 0; j + 1 < P.length; j++) { const [x0, y0] = P[j], [x1, y1] = P[j + 1]; if (y <= y0 && y >= y1) return y0 === y1 ? x0 : x0 + (x1 - x0) * (y - y0) / (y1 - y0); } return 0; };
  const slope = (P, y) => { const e = 0.05, a = xAt(P, y + e), b = xAt(P, y - e); return [1, -(a - b) / (2 * e)]; };   // outward normal (x, y), unnormalised
  for (let bI = 0; bI < bands.length; bI++) {
    const lo = bI ? bands[bI - 1][0] : -1e3, hi = bands[bI][0], col = bands[bI][1];
    const strip = st.map(S => { const P = sec(S), y0 = Math.max(-S.k, Math.min(S.s, lo)), y1 = Math.max(-S.k, Math.min(S.s, hi)); return { S, P, ys: [y0, (y0 + y1) / 2, y1] }; });
    f.col(col);
    for (const side of [1, -1]) {
      const rows = strip.map(({ S, P, ys }) => ys.map(y => { const [nx, ny] = slope(P, y); return f.vert(side * xAt(P, y), y, S.z, side * nx, ny, 0); }));
      for (let i = 0; i + 1 < rows.length; i++) for (let j = 0; j < 2; j++) { f.tri(rows[i][j], rows[i + 1][j], rows[i + 1][j + 1]); f.tri(rows[i][j], rows[i + 1][j + 1], rows[i][j + 1]); }
    }
  }
  // the transom: the stern's section closed off
  const T = st[0], TP = sec(T), tr = [];
  const bandAt = y => (bands.find(b => y <= b[0] + 1e-6) || bands.at(-1))[1];
  for (const side of [1, -1]) for (let j = 0; j < TP.length; j++) { const [x, y] = side > 0 ? TP[j] : TP[TP.length - 1 - j]; f.col(bandAt(y)); tr.push(f.vert(side * x, y, T.z, 0, 0, -1)); }
  f.col(bandAt(0.5)); const tc = f.vert(0, (T.s - T.k) / 2, T.z, 0, 0, -1);
  for (let j = 0; j + 1 < tr.length; j++) f.tri(tc, tr[j + 1], tr[j]);
  f.tri(tc, tr[0], tr[tr.length - 1]);   // (and its top, between the gunwales: left out, it was a V-shaped hole in the stern, 2026-10-15)
  if (open) {
    // an open boat: the inside of the hull and a floor
    for (let i = 0; i + 1 < st.length; i++) {
      const A = sec(st[i], wall), Bq = sec(st[i + 1], wall);
      for (const side of [1, -1]) {
        f.col('#e9e4d8');
        const a0 = f.vert(side * A[0][0], A[0][1], st[i].z, -side, 0, 0), a1 = f.vert(side * A[2][0], 0.12, st[i].z, -side, 0.4, 0);
        const b0 = f.vert(side * Bq[0][0], Bq[0][1], st[i + 1].z, -side, 0, 0), b1 = f.vert(side * Bq[2][0], 0.12, st[i + 1].z, -side, 0.4, 0);
        f.tri(a0, b0, b1); f.tri(a0, b1, a1);
        // the gunwale's top edge
        f.col('#9a7650');
        const g0 = f.vert(side * st[i].b, st[i].s, st[i].z, 0, 1, 0), g1 = f.vert(side * st[i + 1].b, st[i + 1].s, st[i + 1].z, 0, 1, 0);
        f.tri(a0, g0, g1); f.tri(a0, g1, b0);
      }
      f.col('#c9b28c');
      const fl = [[-A[2][0], st[i].z], [A[2][0], st[i].z], [Bq[2][0], st[i + 1].z], [-Bq[2][0], st[i + 1].z]].map(([x, z]) => f.vert(x, 0.12, z, 0, 1, 0));
      f.tri(fl[0], fl[1], fl[2]); f.tri(fl[0], fl[2], fl[3]);
    }
  } else {
    // a deck over it, with a slight camber
    f.col('#d9d2c4');
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i], b = st[i + 1];
      const v = [f.vert(-a.b, a.s, a.z, 0, 1, 0), f.vert(0, a.s + a.b * 0.04, a.z, 0, 1, 0), f.vert(a.b, a.s, a.z, 0, 1, 0), f.vert(-b.b, b.s, b.z, 0, 1, 0), f.vert(0, b.s + b.b * 0.04, b.z, 0, 1, 0), f.vert(b.b, b.s, b.z, 0, 1, 0)];
      f.tri(v[0], v[1], v[4]); f.tri(v[0], v[4], v[3]); f.tri(v[1], v[2], v[5]); f.tri(v[1], v[5], v[4]);
    }
  }
  return st;
}
/** A rail along deck-edge points: posts and a top rail (thin rods). */
export function rail(f, pts, h, col = '#d7dbe0', every = 1.4) {
  f.col(col);
  let acc = every;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    f.rod([ax, ay + h, az], [bx, by + h, bz], 0.025, 4);
    for (acc += L; acc >= every; acc -= every) { const t = 1 - (acc - every) / L; f.rod([ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t], [ax + (bx - ax) * t, ay + (by - ay) * t + h, az + (bz - az) * t], 0.02, 4); }
  }
}
/** Curved sail cloth over a triangle (tack, head, clew), bellied `camber` to one side; both faces; seams across it. */
function sail(f, tack, head, clew, camber, col = '#fbfaf6', seam = '#e2dfd6') {
  const N = 6, M = 4, grid = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, row = [];
    for (let j = 0; j <= M; j++) {
      const v = j / M * (1 - u);
      const p = [0, 1, 2].map(k => tack[k] + (head[k] - tack[k]) * u + (clew[k] - tack[k]) * v);
      const belly = Math.sin(Math.PI * Math.min(1, v / Math.max(1e-3, 1 - u))) * (1 - u * 0.7) * camber;
      p[0] += belly;
      row.push(p);
    }
    grid.push(row);
  }
  for (const side of [1, -1]) for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const q = [grid[i][j], grid[i + 1][j], grid[i + 1][Math.min(j + 1, M)], grid[i][j + 1]];
    f.col(i % 2 ? seam : col);
    const v = q.map(p => f.vert(p[0] + side * 0.005, p[1], p[2], side, 0, 0));
    f.tri(v[0], v[1], v[2]); f.tri(v[0], v[2], v[3]);
  }
}

/** A sailing dinghy, 4.2 m. */
export function dinghy() {
  const f = new FB();
  hull(f, { L: 4.2, B: 1.62, free: 0.55, rise: 0.12, draft: 0.22, vee: 0.15, transom: 0.72, open: true, bands: [[0.02, '#1d4e89'], [0.42, '#f4f1ea'], [9, '#1d4e89']] });
  f.col('#a07a52'); f.box(-0.7, 0.32, -0.15, 0.7, 0.36, 0.1);                         // thwart
  f.col('#8a6a48'); f.box(-0.05, 0.12, 0.2, 0.05, 0.42, 0.9);                          // centreboard case
  f.col('#c8c3b8'); f.lathe(0, 0.95, [[0.055, 0.12], [0.045, 3.0], [0.03, 6.0]], 8);   // mast
  f.rod([0, 1.15, 0.95], [0, 1.0, -1.8], 0.035, 6);                                     // boom
  sail(f, [0.02, 1.2, 0.9], [0.02, 5.9, 0.9], [0.02, 1.05, -1.75], 0.28);              // mainsail
  sail(f, [0.02, 0.6, 2.0], [0.02, 4.6, 0.98], [0.02, 0.75, 0.75], 0.18);              // jib
  f.col('#8a6a48'); f.box(-0.03, -0.45, -2.2, 0.03, 0.5, -2.05); f.rod([0, 0.5, -2.1], [0, 0.55, -1.3], 0.025, 5);   // rudder, tiller
  return f.build().geo;
}

/** A motor launch, 7.5 m. */
export function launch() {
  const f = new FB();
  const st = hull(f, { L: 7.5, B: 2.6, free: 1.0, rise: 0.35, draft: 0.5, vee: 0.75, transom: 0.92, bands: [[-0.05, '#8a2a24'], [0.12, '#c0392b'], [0.85, '#ffffff'], [9, '#1d4e89']] });
  // cabin: walls, a raked windscreen of glass, a roof overhanging it
  f.col('#efece6'); f.box(-0.95, 1.0, -1.6, 0.95, 1.9, 0.9);
  f.col('#4d6a82');
  const w = [[-0.95, 1.9, 0.9], [0.95, 1.9, 0.9], [0.9, 1.45, 1.55], [-0.9, 1.45, 1.55]].map(p => f.vert(p[0], p[1], p[2], 0, 0.6, 0.8));
  f.tri(w[0], w[1], w[2]); f.tri(w[0], w[2], w[3]);
  f.col('#efece6'); f.box(-0.9, 1.0, 0.9, 0.9, 1.45, 1.55);
  f.col('#24384d'); f.box(-0.97, 1.45, -1.4, 0.97, 1.75, 0.7);                         // side windows
  f.col('#f6f4f0'); f.box(-1.05, 1.9, -1.8, 1.05, 2.0, 1.0);                           // roof
  // rails round the foredeck and the stern
  const fwd = st.filter(S => S.z > 1.2).map(S => [S.b - 0.08, S.s, S.z]);
  rail(f, fwd, 0.55); rail(f, fwd.map(([x, y, z]) => [-x, y, z]), 0.55);
  // the outboard: a cowled engine on the transom, its leg into the water
  f.col('#2b2e33'); f.box(-0.28, 0.75, -4.15, 0.28, 1.35, -3.65); f.col('#3a3e45'); f.box(-0.08, -0.35, -4.0, 0.08, 0.8, -3.85);
  f.col('#ffd166', 0, 2); f.cyl(0, 1.0, 0.05, 2.0, 2.12, 6);                           // navigation light
  return f.build().geo;
}

/** The island ferry, 22 m. */
export function ferry() {
  const f = new FB();
  const st = hull(f, { L: 22, B: 7.2, free: 2.3, rise: 0.6, draft: 1.2, vee: 0.35, transom: 0.86, stations: 18, bands: [[-0.1, '#8a2a24'], [0.35, '#1d3557'], [1.95, '#f3f1ec'], [9, '#c0392b']] });
  // main deck saloon and the upper deck, window bands (lit at night)
  const deck = (x0, y0, z0, x1, y1, z1) => {
    f.col('#f1efe9'); f.box(x0, y0, z0, x1, y1, z1);
    f.col('#2d4256', 0, 2); for (const sx of [x0 - 0.02, x1 + 0.02]) f.box(sx - 0.01, y0 + (y1 - y0) * 0.38, z0 + 0.4, sx + 0.01, y0 + (y1 - y0) * 0.78, z1 - 0.4);
    f.col('#2d4256', 0, 2); f.box(x0 + 0.4, y0 + (y1 - y0) * 0.38, z1 + 0.01, x1 - 0.4, y0 + (y1 - y0) * 0.78, z1 + 0.03);
    f.col('#e4e1da'); f.box(x0 - 0.15, y1, z0 - 0.15, x1 + 0.15, y1 + 0.18, z1 + 0.15);   // roof edge
    // mullions between the windows
    f.col('#f1efe9'); for (let z = z0 + 1.6; z < z1 - 0.6; z += 1.6) for (const sx of [x0 - 0.04, x1 + 0.04]) f.box(sx - 0.02, y0 + (y1 - y0) * 0.35, z - 0.06, sx + 0.02, y0 + (y1 - y0) * 0.8, z + 0.06);
  };
  deck(-3.0, 2.3, -8.5, 3.0, 4.7, 5.5);
  deck(-2.4, 4.88, -6.0, 2.4, 6.9, 2.0);
  // the wheelhouse at the front of the upper deck, glass all round
  f.col('#ffffff'); f.box(-1.6, 6.9, 0.4, 1.6, 8.5, 2.6);
  f.col('#2d4256', 0, 2); f.box(-1.65, 7.6, 0.6, 1.65, 8.25, 2.65);
  f.col('#e4e1da'); f.box(-1.8, 8.5, 0.2, 1.8, 8.65, 2.85);
  // funnel: an oval stack with a black cap, the company's band
  f.col('#c0392b'); f.lathe(0, -4.2, [[0.9, 6.9], [0.85, 8.6], [0.8, 9.4]], 14);
  f.col('#f3f1ec'); f.lathe(0, -4.2, [[0.87, 8.0], [0.86, 8.4]], 14);
  f.col('#1f2226'); f.lathe(0, -4.2, [[0.82, 9.35], [0.84, 9.8], [0, 9.82]], 14);
  // mast with a radar bar and lights
  f.col('#d7dbe0'); f.rod([0, 8.65, 1.6], [0, 11.6, 1.6], 0.07, 6); f.rod([-0.9, 10.6, 1.6], [0.9, 10.6, 1.6], 0.05, 5);
  f.col('#ffffff', 0, 2); f.cyl(0, 1.6, 0.09, 11.6, 11.8, 8);
  // lifeboats on the upper deck's sides, orange, on their davits
  for (const s of [-1, 1]) {
    f.push(s * 2.9, 5.3, -3.2);
    f.col('#e8742d'); f.lathe(0, 0, [[0, -0.35], [0.45, -0.25], [0.55, 0.05], [0.5, 0.3], [0, 0.35]], 10);
    f.pop();
    f.col('#d7dbe0'); f.rod([s * 2.4, 4.9, -4.2], [s * 2.9, 5.9, -4.2], 0.05, 5); f.rod([s * 2.4, 4.9, -2.2], [s * 2.9, 5.9, -2.2], 0.05, 5);
  }
  // railings: round the foredeck, the open stern and the upper deck
  const edge = st.filter(S => S.z > 5.6 || S.z < -8.6).map(S => [S.b - 0.12, S.s, S.z]);
  const fore = edge.filter(p => p[2] > 0), aft = edge.filter(p => p[2] < 0);
  for (const L of [fore, aft]) { rail(f, L, 1.0); rail(f, L.map(([x, y, z]) => [-x, y, z]), 1.0); }
  rail(f, [[-2.4, 6.9, 2.0], [2.4, 6.9, 2.0]], 1.0); rail(f, [[2.4, 6.9, 2.0], [2.4, 6.9, -6.0]], 1.0); rail(f, [[-2.4, 6.9, 2.0], [-2.4, 6.9, -6.0]], 1.0); rail(f, [[-2.4, 6.9, -6.0], [2.4, 6.9, -6.0]], 1.0);
  // lifebuoys on the saloon's sides
  for (const s of [-1, 1]) for (const z of [-5, 1.5]) { f.push(s * 3.05, 3.2, z, s * Math.PI / 2); f.col('#e8742d'); f.lathe(0, 0, [[0.18, -0.06], [0.3, -0.06], [0.3, 0.06], [0.18, 0.06], [0.18, -0.06]], 12); f.pop(); }
  // anchor and bollards on the foredeck
  f.col('#2b2e33'); for (const s of [-1, 1]) { f.cyl(s * 1.6, 8.5, 0.12, st.at(-4).s, st.at(-4).s + 0.4, 8); f.cyl(s * 1.6, -9.6, 0.12, st[2].s, st[2].s + 0.4, 8); }
  void TAU;
  return f.build().geo;
}
