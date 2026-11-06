// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Amazon furniture library's kinds (Amazon Berkeley Objects, CC BY 4.0: client/assets/abo/ATTRIBUTION.md): for each
// kind of piece, the Furnish panel's category and sub-group, the word its pieces are named with, how it stands (on the
// floor, hung on a wall, hung from the ceiling, flat on the floor) and the places people use it at, shaped like the MVW
// piece of that kind in shared/catalog.js. tools/abo-build.mjs sorts each model into one of these kinds;
// shared/abo-items.js makes catalog entries of them.
function S(x, z, yaw, anim, use, o = {}) { return { x, z, yaw, anim, use, ...o }; }

// how a kind stands: floor (default), wall (on a wall, its back to it), hang (from the ceiling), flat (walked over)
export const ABO_KINDS = {
  sofa: { cat: 'Lounge', sub: 'Sofas', label: 'Sofa', seat: 'sofa' },
  sectional: { cat: 'Lounge', sub: 'Sofas', label: 'Sectional Sofa', seat: 'sofa' },
  loveseat: { cat: 'Lounge', sub: 'Sofas', label: 'Loveseat', seat: 'sofa' },
  armchair: { cat: 'Lounge', sub: 'Armchairs', label: 'Armchair', seat: 'relax' },
  recliner: { cat: 'Lounge', sub: 'Armchairs', label: 'Recliner', seat: 'relax' },
  chaise: { cat: 'Lounge', sub: 'Armchairs', label: 'Chaise Longue', seat: 'relax' },
  beanbag: { cat: 'Lounge', sub: 'Bean bags', label: 'Bean Bag', seat: 'beanbag' },
  ottoman: { cat: 'Lounge', sub: 'Ottomans', label: 'Ottoman', seat: 'pouf' },
  coffee_table: { cat: 'Lounge', sub: 'Coffee tables', label: 'Coffee Table', top: true },
  side_table: { cat: 'Lounge', sub: 'Side tables', label: 'Side Table', top: true },
  console_table: { cat: 'Lounge', sub: 'Side tables', label: 'Console Table', top: true },
  tv_stand: { cat: 'Lounge', sub: 'TV stands', label: 'TV Stand', top: true },
  table: { cat: 'Lounge', sub: 'Tables', label: 'Table', top: true },
  dining_chair: { cat: 'Kitchen', sub: 'Dining chairs', label: 'Dining Chair', seat: 'eat' },
  bar_stool: { cat: 'Kitchen', sub: 'Stools', label: 'Bar Stool', seat: 'high' },
  stool: { cat: 'Kitchen', sub: 'Stools', label: 'Stool', seat: 'pouf' },
  dining_table: { cat: 'Kitchen', sub: 'Dining tables', label: 'Dining Table', top: true },
  bar_table: { cat: 'Kitchen', sub: 'Dining tables', label: 'Bar Table', top: true },
  kitchen_cart: { cat: 'Kitchen', sub: 'Carts', label: 'Kitchen Cart' },
  wine_rack: { cat: 'Kitchen', sub: 'Wine racks', label: 'Wine Rack' },
  desk: { cat: 'Office', sub: 'Desks', label: 'Desk', top: true },
  office_chair: { cat: 'Office', sub: 'Office chairs', label: 'Office Chair' },
  gaming_chair: { cat: 'Office', sub: 'Office chairs', label: 'Gaming Chair' },
  bookcase: { cat: 'Office', sub: 'Bookcases', label: 'Bookcase' },
  filing_cabinet: { cat: 'Office', sub: 'Cabinets', label: 'Filing Cabinet' },
  board: { cat: 'Office', sub: 'Boards', label: 'Message Board', stand: 'wall' },
  bed: { cat: 'Home', sub: 'Beds', label: 'Bed', seat: 'bed' },
  daybed: { cat: 'Home', sub: 'Beds', label: 'Daybed', seat: 'sofa' },
  mattress: { cat: 'Home', sub: 'Beds', label: 'Mattress', seat: 'bed' },
  headboard: { cat: 'Home', sub: 'Headboards', label: 'Headboard' },
  nightstand: { cat: 'Home', sub: 'Nightstands', label: 'Nightstand', top: true },
  dresser: { cat: 'Home', sub: 'Dressers', label: 'Dresser' },
  vanity: { cat: 'Home', sub: 'Dressers', label: 'Vanity' },
  wardrobe: { cat: 'Home', sub: 'Wardrobes', label: 'Wardrobe' },
  cabinet: { cat: 'Home', sub: 'Cabinets', label: 'Cabinet' },
  shelf: { cat: 'Home', sub: 'Shelves', label: 'Shelf' },
  wall_shelf: { cat: 'Home', sub: 'Shelves', label: 'Wall Shelf', stand: 'wall' },
  clothes_rack: { cat: 'Home', sub: 'Clothes racks', label: 'Clothes Rack' },
  storage: { cat: 'Home', sub: 'Storage', label: 'Storage Box' },
  floor_lamp: { cat: 'Decor', sub: 'Floor lamps', label: 'Floor Lamp' },
  table_lamp: { cat: 'Decor', sub: 'Table lamps', label: 'Table Lamp' },
  pendant: { cat: 'Decor', sub: 'Ceiling lights', label: 'Pendant Light', stand: 'hang' },
  chandelier: { cat: 'Decor', sub: 'Ceiling lights', label: 'Chandelier', stand: 'hang' },
  sconce: { cat: 'Decor', sub: 'Wall lights', label: 'Wall Light', stand: 'wall' },
  rug: { cat: 'Decor', sub: 'Rugs', label: 'Rug', stand: 'flat' },
  wall_art: { cat: 'Decor', sub: 'Wall art', label: 'Wall Art', stand: 'wall' },
  frame: { cat: 'Decor', sub: 'Wall art', label: 'Picture Frame', stand: 'wall' },
  mirror: { cat: 'Decor', sub: 'Mirrors', label: 'Mirror', stand: 'wall' },
  floor_mirror: { cat: 'Decor', sub: 'Mirrors', label: 'Floor Mirror' },
  clock: { cat: 'Decor', sub: 'Clocks', label: 'Wall Clock', stand: 'wall' },
  vase: { cat: 'Decor', sub: 'Vases', label: 'Vase' },
  planter: { cat: 'Decor', sub: 'Plants', label: 'Planter' },
  plant: { cat: 'Decor', sub: 'Plants', label: 'Artificial Plant' },
  candle: { cat: 'Decor', sub: 'Accents', label: 'Candle Holder' },
  sculpture: { cat: 'Decor', sub: 'Accents', label: 'Sculpture' },
  pillow: { cat: 'Decor', sub: 'Pillows', label: 'Pillow', walk: true },
  curtain: { cat: 'Decor', sub: 'Curtains', label: 'Curtain', stand: 'wall' },
  bench: { cat: 'Outdoor', sub: 'Benches', label: 'Bench', seat: 'bench' },
  patio: { cat: 'Outdoor', sub: 'Patio', label: 'Patio Set' },
  canopy: { cat: 'Outdoor', sub: 'Canopies', label: 'Canopy', walk: true },
  garden: { cat: 'Outdoor', sub: 'Garden', label: 'Garden Piece' },
  exercise_mat: { cat: 'Gym', sub: 'Mats', label: 'Exercise Mat', stand: 'flat' },
  gym: { cat: 'Gym', sub: 'Equipment', label: 'Fitness Equipment' },
};
export const ABO_KIND_IDS = Object.keys(ABO_KINDS);   // (appended, never reordered: shared/abo-catalog.js stores the index)

/** Where a piece of kind k stands, given its model's height h (m): how far its bottom is lifted off the floor. */
export function aboLift(k, h) {
  const st = ABO_KINDS[k]?.stand;
  if (st === 'wall') return h < 1.6 ? Math.max(0.15, 1.55 - h / 2) : 0.08;   // (its middle at eye height, or standing on the floor)
  if (st === 'hang') return Math.max(0, 2.95 - h);   // (its top at the ceiling)
  return 0;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const R2 = v => Math.round(v * 100) / 100;
/** The places people use a piece of kind k at, in its own frame (rect [x0, z0, x1, z1], its front +z), like MVW's own. */
export function aboSlots(k, rect, h) {
  const [x0, z0, x1, z1] = rect, w = x1 - x0, d = z1 - z0, cx = R2((x0 + x1) / 2), cz = R2((z0 + z1) / 2);
  switch (ABO_KINDS[k]?.seat) {
    case 'sofa': {   // like `sofa`: a seat every ~0.62 m along it, sat on from the front
      const n = clamp(Math.floor(w / 0.62), 1, 4), z = R2(z1 - 0.41 * Math.min(d, 1.0));
      return Array.from({ length: n }, (_, i) => S(R2(x0 + (i + 0.5) * w / n), z, 0, 'sit_relax', 'relax', { az: R2(z1 + 0.5), y: -0.05 }));
    }
    case 'relax': return [S(cx, R2(z1 - 0.41 * Math.min(d, 1.0)), 0, 'sit_relax', 'relax', { az: R2(z1 + 0.5), y: -0.04 })];
    case 'beanbag': return [S(cx, R2(z1 - 0.44 * d), 0, 'sit_relax', 'relax', { az: R2(z1 + 0.5), y: -0.2 })];
    case 'pouf': return h > 0.6 ? [] : [S(cx, cz, 0, 'sit_talk', 'chat', { az: R2(z1 + 0.35), y: R2(clamp(h - 0.46, -0.12, 0.02)) })];
    case 'eat': return [S(cx, R2(z1 - 0.45 * d), 0, 'sit_eat', 'eat', { az: R2(z1 + 0.5) })];
    case 'high': return [S(cx, cz, 0, 'sit_high', 'eat', { az: R2(z1 + 0.45), y: 0.28 })];
    case 'bench': {
      const n = clamp(Math.floor(w / 0.9), 1, 3);
      return Array.from({ length: n }, (_, i) => S(R2(x0 + (i + 0.5) * w / n), R2(cz + 0.05), 0, 'sit_relax', 'bench', { az: R2(z1 + 0.55), y: -0.03 }));
    }
    case 'bed': {   // like bed_double / bed_single: lain on, got into from the side
      const z = R2(cz + 0.055 * d), az = R2(cz + 0.18 * d);
      if (w >= 1.25) return [S(R2(cx - w * 0.22), z, 0, 'lie', 'sleep', { ax: R2(x0 - 0.4), az, y: 0.05 }), S(R2(cx + w * 0.22), z, 0, 'lie', 'sleep', { ax: R2(x1 + 0.4), az, y: 0.05 })];
      return [S(cx, z, 0, 'lie', 'sleep', { ax: R2(x1 + 0.45), az, y: 0.05 })];
    }
    default: return [];
  }
}
