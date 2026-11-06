// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// MVW's own pieces drawn with their Amazon counterparts (the Amazon Berkeley Objects library, shared/abo-items.js). A
// placed piece keeps its type (its rectangle, places, uses: what people do with it stays the same) and may carry a model
// choice `m: 'a:<id>'` (server/world/edit.js checks it is this type's own), drawn by client/js/render/abo-models.js:
// the Amazon model fitted into the box the MVW piece's own shape fills (SPEC fit, below; a table's top at the height
// people eat and work at), a chair of the set's own at each place sat at (`seats`), and MVW's own things on it that are
// not furniture (a monitor, a laptop, a mug, a TV: render/furniture.js propsGeometry) where the piece needs them.
// Pieces of other kinds (arcade machines, kitchens, Order Up's stations, neon, studio gear, club rigs, doors, lifts,
// signs, billboards, trees) have no counterpart and stay MVW's own; so do the bookshelves (the library's are empty, and
// people browse MVW's books), and the park bench (the library's benches are indoor ones).
import { CATALOG } from './catalog.js';
import { aboId, ABO_PREFIX } from './abo-items.js';

// type: k the kinds the model is chosen from, fit [x0, z0, x1, z1, h, y0] the box it fills (default: the type's rect
// and h), top (its top at h: a table), seat (sat in: its real proportions kept), wall (hung: fills width and height,
// its back to z0), seats the kind of the chairs at the places sat at, props MVW's own things on it
export const SPEC = {
  // Office
  desk: { k: ['desk'], fit: [-0.7, -0.37, 0.7, 0.37, 0.755], top: true, seats: 'office_chair', props: true },
  desk_exec: { k: ['desk'], fit: [-1.0, -0.48, 1.0, 0.42, 0.77], top: true, seats: 'office_chair', props: true },
  meeting_table: { k: ['dining_table'], fit: [-1.8, -0.6, 1.8, 0.6, 0.76], top: true, seats: 'office_chair', props: true },
  filing: { k: ['filing_cabinet'] },
  // Lounge
  sofa: { k: ['sofa'], seat: true },
  sofa_l: { k: ['sofa', 'sectional'], seat: true },
  sofa_lounge: { k: ['sofa'], seat: true },
  loveseat: { k: ['loveseat'], seat: true },
  armchair: { k: ['armchair'], seat: true },
  club_chair: { k: ['armchair'], seat: true },
  boucle_chair: { k: ['armchair'], seat: true },
  shell_chair: { k: ['armchair'], seat: true },
  beanbag: { k: ['beanbag'], seat: true },
  pouf: { k: ['ottoman'], seat: true },
  chaise: { k: ['chaise'], seat: true },
  coffee_table: { k: ['coffee_table'], fit: [-0.6, -0.33, 0.6, 0.33, 0.42], top: true, props: true },
  stone_table: { k: ['coffee_table'], top: true },
  tv_stand: { k: ['tv_stand'], fit: [-0.95, -0.25, 0.95, 0.25, 0.5], top: true, props: true },
  rug: { k: ['rug'] },
  organic_rug: { k: ['rug'] },
  arc_lamp: { k: ['floor_lamp'] },
  art_panel: { k: ['wall_art'], fit: [-0.9, -0.04, 0.9, 0.0, 1.25, 1.05], wall: true },
  wall_sconce: { k: ['sconce'], fit: [-0.12, -0.09, 0.12, 0.1, 0.5, 1.48], wall: true },
  table_two: { k: ['dining_table', 'table', 'side_table'], fit: [-0.38, -0.38, 0.38, 0.38, 0.76], top: true, seats: 'dining_chair' },
  table_four: { k: ['dining_table', 'table'], fit: [-0.55, -0.55, 0.55, 0.55, 0.76], top: true, seats: 'dining_chair' },
  highboy: { k: ['bar_table'], fit: [-0.36, -0.36, 0.36, 0.36, 1.05], top: true, seats: 'bar_stool' },
  // Decor
  floor_lamp: { k: ['floor_lamp'] },
  // Kitchen
  dining_table: { k: ['dining_table'], fit: [-0.8, -0.45, 0.8, 0.45, 0.76], top: true, seats: 'dining_chair' },
  cafe_table: { k: ['dining_table', 'table', 'side_table'], fit: [-0.36, -0.36, 0.36, 0.36, 0.76], top: true, seats: 'dining_chair' },
  cafe_table4: { k: ['dining_table', 'table'], fit: [-0.48, -0.48, 0.48, 0.48, 0.76], top: true, seats: 'dining_chair' },
  // Café
  bistro_set: { k: ['dining_table', 'table', 'side_table'], fit: [-0.36, -0.36, 0.36, 0.36, 0.75], top: true, seats: 'dining_chair' },
  rattan_set: { k: ['dining_table', 'table', 'side_table'], fit: [-0.4, -0.4, 0.4, 0.4, 0.71], top: true, seats: 'dining_chair' },
  communal_table: { k: ['dining_table'], fit: [-1.65, -0.48, 1.65, 0.48, 0.78], top: true, seats: 'dining_chair' },
  library_table: { k: ['dining_table'], fit: [-1.0, -0.48, 1.0, 0.48, 0.78], top: true, seats: 'dining_chair' },
  wingback_set: { seats: 'armchair' },
  gilt_mirror: { k: ['mirror'], fit: [-0.6, -0.05, 0.6, 0.0, 1.85, 0.6], wall: true },
  poster_frame: { k: ['frame', 'wall_art'], fit: [-0.42, -0.03, 0.42, 0.0, 1.0, 1.25], wall: true },
  cafe_sconce: { k: ['sconce'], fit: [-0.12, -0.03, 0.12, 0.25, 0.4, 1.82], wall: true },
  cafe_rug: { k: ['rug'] },
  // Home
  bed_double: { k: ['bed'], seat: true },
  bed_single: { k: ['bed'], seat: true },
  nightstand: { k: ['nightstand'], fit: [-0.24, -0.22, 0.24, 0.22, 0.55], top: true, props: true },
  wardrobe: { k: ['wardrobe'] },
  desk_home: { k: ['desk'], fit: [-0.6, -0.32, 0.6, 0.3, 0.755], top: true, seats: 'dining_chair', props: true },
  // Gym
  yoga_mat: { k: ['exercise_mat'] },
};

// The models chosen (tools/abo-pick.mjs: kind, then the size closest to the MVW piece's, a plain look; reviewed on its
// contact sheet): type: [model, chair]
export const PICK = {
  desk: ['B082YNV6F7', 'B07QC85YBY'],   // Brown Wood Desk 31 + Brown Fabric Office Chair
  desk_exec: ['B084S6HMNC', 'B00IIFW2L4'],   // White Wood Desk 49 + Black Plastic Office Chair
  meeting_table: ['B07HSJXP8D', 'B081H3Y5NW'],   // Grey Acacia Dining Table + Black Office Chair 6
  filing: ['B07QFB1L2P'],   // White Pine Filing Cabinet
  sofa: ['B07VNLBJDY'],   // Grey Sofa 51
  sofa_l: ['B07JW75VPC'],   // Grey Fabric Sofa 20
  sofa_lounge: ['B07JW75VPK'],   // Grey Fabric Sofa 21
  loveseat: ['B07B4CZRYR'],   // Grey Linen Loveseat 2
  armchair: ['B07J59DFXX'],   // Grey Armchair 44
  club_chair: ['B07P5LN3XK'],   // Brown Leather Armchair 40
  boucle_chair: ['B07J2R9TVF'],   // Grey Armchair 42
  shell_chair: ['B075X4PTS8'],   // Green Velvet Armchair 5
  beanbag: ['B07TN1X4D2'],   // Black Fabric Bean Bag
  pouf: ['B07DB8XJZH'],   // Grey Wood Ottoman 15
  chaise: ['B07PXDFW6L'],   // Black Wood Chaise Longue
  coffee_table: ['B07H93GTNC'],   // Brown Coffee Table 2
  stone_table: ['B07B7G4VYF'],   // Brown Wood Coffee Table 9
  tv_stand: ['B075Z1NM5W'],   // Brown Oak TV Stand 4
  rug: ['B071777YNX'],   // White Jute Rug
  organic_rug: ['B075ZBJL11'],   // Grey Wool Rug 36
  arc_lamp: ['B0742F7GT8'],   // White Wood Floor Lamp
  art_panel: ['B075HX2J97'],   // White Wall Art 6
  wall_sconce: ['B0737756WD'],   // Black Metal Wall Light
  table_two: ['B07M6PKC6B', 'B07GNF6Q9L'],   // Grey Pine Dining Table + White Metal Dining Chair
  table_four: ['B07B78LZQC', 'B075YN3HPQ'],   // Brown Wood Dining Table 5 + Grey Fabric Dining Chair 2
  highboy: ['B07S6XJYRJ', 'B075YNTYVL'],   // White Wood Bar Table 2 + Cream Fabric Bar Stool
  floor_lamp: ['B07HKF59YX'],   // Black Metal Floor Lamp 10
  dining_table: ['B07H8SZNZF', 'B07QBQCG6J'],   // Brown Wood Dining Table 21 + Grey Fabric Dining Chair 4
  cafe_table: ['B07DMJQM3H', 'B07DYJ8J4Z'],   // Brown Wood Dining Table 20 + Brown Metal Dining Chair
  cafe_table4: ['B0853Q3Z93', 'B07FYHGL58'],   // White Wood Dining Table 2 + White Wood Dining Chair
  bistro_set: ['B07ML7P94G', 'B07H319HYP'],   // Black Wood Dining Table 4 + Black Wood Dining Chair 3
  rattan_set: ['B07B82PXCW', 'B084RZVHD2'],   // Brown Wood Dining Table 14 + Cream Leather Dining Chair
  communal_table: ['B075Z9QB8P', 'B07H376LF5'],   // Black Wood Dining Table 3 + Blue Wood Dining Chair
  library_table: ['B07K7TRF5F', 'B075YV7V1P'],   // Brown Wood Dining Table 25 + Brown Leather Dining Chair
  wingback_set: ['', 'B07B4MMPSW'],   // Grey Armchair 26
  gilt_mirror: ['B073WGN8PP'],   // Black Wood Mirror
  poster_frame: ['B073P5V3BJ'],   // Blue Wall Art 5
  cafe_sconce: ['B0828DTSRD'],   // White Linen Wall Light
  cafe_rug: ['B075Z9KY9D'],   // Blue Rug 10
  bed_double: ['B075QL8KBL'],   // Black Metal Bed 7
  bed_single: ['B071H75K71'],   // Grey Wood Bed
  nightstand: ['B07DBB7831'],   // Grey Pine Nightstand
  wardrobe: ['B07JGPKSCB'],   // Brown Wardrobe
  desk_home: ['B08C2NYN5Y', 'B07GZXLYNL'],   // White Metal Desk 2 + Blue Plastic Dining Chair
  yoga_mat: ['B01LP0U5X0'],   // Black Exercise Mat
};

/** The model choice a placed piece of type t gets in the world ('a:<id>'), or null when it has no counterpart. */
export function aboDefault(t) { const p = PICK[t]; return p ? ABO_PREFIX + (p[0] || p[1]) : null; }
/** Whether m is a model choice piece type t may carry. */
export function aboChoiceOk(t, m) { return typeof m === 'string' && !!PICK[t] && m === aboDefault(t); }

const SEAT_MAX = { dining_chair: 0.62, office_chair: 0.72, bar_stool: 0.56, armchair: 0.95 };   // (a set's chair at most this wide or deep, m)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** How Amazon model id (its catalog rect and height: its real size) is fitted into box fit [x0, z0, x1, z1, h, y0]:
 *  { s: [sx, sy, sz], p: [x, y, z] } — scaled, then its origin put at p (in the piece's own frame). */
export function aboFit(id, fit, o = {}) {
  const d = CATALOG[ABO_PREFIX + id]; if (!d) return null;
  const [bx0, bz0, bx1, bz1] = d.rect, bh = d.h - (d.lift || 0), bw = bx1 - bx0, bd = bz1 - bz0;
  const [x0, z0, x1, z1, h, y0 = 0] = fit, W = x1 - x0, D = z1 - z0;
  const fx = W / bw, fz = D / bd, fy = h / bh;
  let sx, sy, sz;
  if (o.wall) { const s = Math.min(fx, fy); sx = Math.min(fx, s * 1.15); sy = Math.min(fy, s * 1.15); sz = s; }
  else if (o.top) { sy = fy; sx = clamp(fx, sy * 0.85, sy * 1.15); sz = clamp(fz, sy * 0.85, sy * 1.15); }
  else if (o.seat) { const s = Math.min(fx, fz); sx = sy = sz = s; }
  else if (h < 0.05) { sx = fx; sz = fz; sy = 1; }   // (a rug: its whole rectangle)
  else { const s = Math.min(fx, fz); sx = Math.min(fx, s * 1.15); sz = Math.min(fz, s * 1.15); sy = clamp(fy, s * 0.85, s * 1.15); }
  const cx = (x0 + x1) / 2 - (bx0 + bx1) / 2 * sx, cz = o.wall ? z0 - bz0 * sz : (z0 + z1) / 2 - (bz0 + bz1) / 2 * sz, k = d.scale || 1;
  return { s: [sx * k, sy * k, sz * k], p: [cx, y0 + (d.oy || 0) * sy, cz] };   // (a fixed model's own scale and raise kept)
}
/** The Amazon parts a piece of type t is drawn with for model choice m: { parts: [{ id, s, p, yaw }], props } in the
 *  piece's own frame (each part: scaled by s, turned by yaw, then moved by p), props: MVW's own things on it drawn too. */
export function aboParts(t, m) {
  const id = aboId(m); if (!id) return null;
  if (t.startsWith(ABO_PREFIX)) { const d = CATALOG[t], k = d?.scale || 1; return d ? { parts: [{ id, s: [k, k, k], p: [0, (d.lift || 0) + (d.oy || 0), 0], yaw: 0 }], props: false } : null; }
  const S = SPEC[t], def = CATALOG[t], pick = PICK[t]; if (!S || !def || !pick) return null;
  const parts = [];
  if (pick[0]) {
    const f = aboFit(pick[0], S.fit || [...def.rect, def.h], S);
    if (f) parts.push({ id: pick[0], ...f, yaw: 0 });
  }
  if (S.seats && pick[1] && CATALOG[ABO_PREFIX + pick[1]]) {
    const c = CATALOG[ABO_PREFIX + pick[1]], [cx0, cz0, cx1, cz1] = c.rect, s = Math.min(1, (SEAT_MAX[S.seats] || 0.62) / Math.max(cx1 - cx0, cz1 - cz0));
    for (const sl of def.slots) {
      if (!/^sit_/.test(sl.anim)) continue;
      // the chair's middle at the place sat at, facing as the sitter does (its front, +z, turned by the place's yaw)
      const mx = (cx0 + cx1) / 2 * s, mz = (cz0 + cz1) / 2 * s, cs = Math.cos(sl.yaw), sn = Math.sin(sl.yaw);
      parts.push({ id: pick[1], s: [s, s, s], p: [sl.x - (mx * cs + mz * sn), 0, sl.z - (-mx * sn + mz * cs)], yaw: sl.yaw, seat: true });
    }
  }
  return { parts, props: !!S.props };
}
