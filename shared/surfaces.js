// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Surfaces: where small things (the goods, shared/goods-items.js, and the small Amazon decor marked onOk) stand on a piece
// of furniture: a table's or a desk's top, each open shelf of a bookcase, a shop shelf or a cabinet (PLAN-SURFACES.md 4.2,
// 6). A placed piece (the host) keeps its things with it: `on: [{ t, s, x, z, r }]` in the HOST's own frame (s the
// surface's index, x z r like a piece's own on its floor), so moving or turning the host carries them; absent = its
// dressing is generated (later), [] = emptied by its owner. They never block walking (shared/navgrid.js reads only the
// floor's pieces). Used by the server (server/world/edit.js item.on), the client (drawing, editor) and the tests.
//   - MVW's own pieces: NATIVE below, read from their code-built shapes (client/js/render/furniture*.js), with keep-outs
//     where their own things stand (a monitor, a lamp, a sink: drawn on every copy).
//   - the Amazon library's pieces: found from their drawn models offline (tools/surf-build.mjs -> shared/abo-surfaces.js).
//   - MVW's pieces drawn with their Amazon counterpart (m, shared/abo-replace.js): the counterpart's surfaces as it is
//     fitted, with MVW's keep-outs where MVW's things are drawn on it too (SPEC props).
import { CATALOG } from './catalog.js';
import { ABO_PREFIX } from './abo-items.js';
import { SPEC, PICK, aboFit, aboChoiceOk } from './abo-replace.js';
import { ABO_SURF_ROWS } from './abo-surfaces.js';

/** The Amazon library's kinds that are hosts (tools/surf-build.mjs finds their surfaces). */
export const ABO_HOST_KINDS = new Set(['desk', 'coffee_table', 'side_table', 'console_table', 'table', 'dining_table', 'bar_table', 'tv_stand', 'nightstand', 'dresser', 'vanity', 'cabinet', 'shelf', 'wall_shelf', 'bookcase', 'filing_cabinet', 'wardrobe', 'kitchen_cart', 'wine_rack', 'storage']);
/** A host's class (for the dressing's rules), by the Amazon kind. */
const ABO_CLASS = { desk: 'desk', coffee_table: 'coffee', side_table: 'side', console_table: 'side', table: 'dining', dining_table: 'dining', bar_table: 'cafe_table', tv_stand: 'tv', nightstand: 'nightstand', dresser: 'dresser', vanity: 'dresser', cabinet: 'cabinet', shelf: 'open_shelf', wall_shelf: 'wall_shelf', bookcase: 'books', filing_cabinet: 'cabinet', wardrobe: 'cabinet', kitchen_cart: 'kitchen_counter', wine_rack: 'open_shelf', storage: 'storage' };

export const ON_MAX = 96;            // things on one piece (a store shelf: 8 shelves of 2 m)
export const ON_LEVEL_MAX = 3000;    // things put by hand on one floor's pieces (~120 KB of the level at most)
const EDGE = 0.01, GAP = 0.005, TALL = 0.01;   // m: kept in from a surface's edges; overlap forgiven; height forgiven
const KIND = { t: 'top', s: 'shelf', h: 'high', l: 'ledge' };

// MVW's own pieces (read from client/js/render/furniture*.js, 2026-11-05): class, then surfaces [y, x0, z0, x1, z1,
// clear (0: open above), kind, side ('f' front, 'b' back, 'fb' both), keep-outs, fill] in metres in the piece's own frame
// (+z its front; the board's extent, kept 2 cm in when read). Keep-outs [x0, z0, x1, z1, what, mvwOnly]: the piece's own
// things standing there (mvwOnly: not drawn on its Amazon look, render/furniture.js PROPS). fill: the shelf is drawn
// full of MVW's own books, goods, shoes or jars (furniture.js books(), products() ...): the piece is drawn bare there
// when it holds things (later, with the editor), so those are not keep-outs.
const K = (x0, z0, x1, z1, what, mvwOnly = 0) => [x0, z0, x1, z1, what, mvwOnly];
const top = (y, x0, z0, x1, z1, keep = [], kind = 'top', clear = 0, side = 'f', fill = '') => [y, x0, z0, x1, z1, clear, kind, side, keep, fill];
const shelves = (ys, x0, z0, x1, z1, clear, side = 'f', fill = '', keep = []) => ys.map(y => [y, x0, z0, x1, z1, clear, 'shelf', side, keep, fill]);
const CANDLE = [K(-0.045, -0.045, 0.045, 0.045, 'candle')];
const MONITOR = (z0, z1) => K(-0.321, z0, 0.321, z1, 'monitor');
const COUNTER_BODY = [K(-1.32, -0.39, -0.58, 0.15, 'espresso machine'), K(-0.44, -0.32, -0.26, -0.13, 'grinder'), K(0.4, -0.05, 1.75, 0.36, 'pastry case'), K(-1.8, 0.2, -1.57, 0.35, 'cups'), K(-0.11, 0.16, 0.01, 0.28, 'tip jar'), K(-1.73, 0.02, -1.47, 0.28, 'cake dome'), K(1.47, 0.02, 1.73, 0.28, 'cake dome')];
const CAFE_COUNTER = (...extra) => ['cafe_counter', [top(1.08, -2.04, -0.46, 2.04, 0.45, [...COUNTER_BODY, ...extra])]];
const NATIVE = {
  // Office
  desk: ['desk', [top(0.755, -0.7, -0.37, 0.7, 0.37, [MONITOR(-0.33, -0.148), K(-0.22, 0.07, 0.16, 0.2, 'keyboard'), K(0.24, 0.1, 0.3, 0.19, 'mouse'), K(-0.59, 0.08, -0.51, 0.16, 'mug'), K(0.42, -0.02, 0.63, 0.27, 'notebook', 1)])]],
  desk_l: ['desk', [top(0.755, -0.9, -0.45, 0.9, 0.2, [MONITOR(-0.43, -0.248), K(-0.2, -0.04, 0.18, 0.09, 'keyboard'), K(0.26, -0.02, 0.32, 0.07, 'mouse'), K(0.5, -0.35, 0.79, -0.05, 'lamp')]),
    top(0.755, 0.4, 0.2, 0.9, 0.95, [K(0.5, 0.4, 0.8, 0.7, 'papers')])]],
  desk_exec: ['desk', [top(0.77, -1.0, -0.48, 1.0, 0.42, [K(-0.17, -0.19, 0.17, 0.12, 'laptop'), K(-0.8, -0.33, -0.5, -0.07, 'lamp'), K(0.4, -0.2, 0.65, 0.1, 'papers')])]],
  standing_desk: ['desk', [top(1.05, -0.7, -0.37, 0.7, 0.37, [MONITOR(-0.33, -0.148), K(-0.22, 0.02, 0.22, 0.15, 'keyboard'), K(0.41, 0.06, 0.49, 0.14, 'mug')])]],
  meeting_table: ['meeting', [top(0.76, -1.2, -0.6, 1.2, 0.6, [K(-0.1, -0.1, 0.1, 0.1, 'conference phone', 1), K(-1.07, 0.18, -0.73, 0.49, 'laptop'), K(0.73, -0.49, 1.07, -0.18, 'laptop'), K(0.11, 0.31, 0.19, 0.39, 'mug'), K(-0.34, -0.42, -0.26, -0.34, 'mug'), K(0.3, -0.45, 0.52, -0.15, 'papers')])]],
  reception: ['service', [top(0.76, -1.35, -0.45, 1.35, 0.2, [K(-0.321, -0.088, 0.321, 0.09, 'monitor'), K(-0.19, -0.43, 0.19, -0.3, 'keyboard')]), top(1.19, -1.55, 0.2, 1.55, 0.45, [], 'ledge')]],
  filing: ['cabinet', [top(1.3, -0.25, -0.3, 0.25, 0.3)]],
  bookshelf: ['books', [...shelves([0.085, 0.485, 0.885, 1.285], -0.77, -0.18, 0.77, 0.2, 0.375, 'f', 'books'), ...shelves([1.685], -0.77, -0.18, 0.77, 0.2, 0.285, 'f', 'books'), top(2.0, -0.8, -0.2, 0.8, 0.2, [], 'high')]],
  // Lounge
  coffee_table: ['coffee', [top(0.42, -0.6, -0.33, 0.6, 0.33, [K(-0.35, -0.1, -0.1, 0.15, 'books'), K(0.21, 0.01, 0.29, 0.09, 'mug')]), top(0.14, -0.5, -0.24, 0.5, 0.24, [], 'shelf', 0.24, 'fb')]],
  stone_table: ['coffee', [top(0.39, -0.41, -0.25, 0.41, 0.25, [K(0.2, -0.2, 0.44, 0.04, 'bowl'), K(-0.42, 0.02, -0.12, 0.22, 'books')])]],
  side_lamp_table: ['side', [top(0.56, -0.19, -0.19, 0.19, 0.19, [K(-0.11, -0.2, 0.21, 0.12, 'lamp')])]],
  tv_stand: ['tv', [top(0.5, -0.95, -0.25, 0.95, 0.25, [K(-0.78, -0.15, 0.78, 0.0, 'TV')])]],
  table_two: ['cafe_table', [top(0.75, -0.26, -0.26, 0.26, 0.26, CANDLE)]],
  table_four: ['cafe_table', [top(0.75, -0.38, -0.38, 0.38, 0.38, CANDLE)]],
  highboy: ['cafe_table', [top(1.05, -0.246, -0.246, 0.246, 0.246, CANDLE)]],
  lounge_bar: ['bar', [top(1.1, -2.06, -0.35, 2.06, 0.34)]],
  drink_ledge: ['bar', [top(1.09, -1.2, -0.2, 1.2, 0.12)]],
  back_bar: ['bar', [top(0.96, -1.52, -0.22, 1.52, 0.24, [], 'shelf', 0.215), top(2.6, -1.6, -0.24, 1.6, 0.12, [], 'high')]],   // (its bottle shelves stay its own)
  bookcase: ['books', [...shelves([0.1], -0.95, -0.17, 0.95, 0.18, 0.42), ...shelves([0.56, 1.0, 1.44], -0.95, -0.17, 0.95, 0.18, 0.4, 'f', 'books'), ...shelves([1.88], -0.95, -0.17, 0.95, 0.18, 0.46, 'f', 'books'), top(2.4, -1.0, -0.2, 1.0, 0.18, [], 'high')]],
  // Kitchen
  counter: ['kitchen_counter', [top(0.94, -0.9, -0.33, 0.9, 0.33, [K(-0.3, -0.15, 0.15, 0.15, 'chopping board'), K(0.35, -0.05, 0.45, 0.05, 'tomato')])]],
  kitchen: ['kitchen_counter', [top(0.92, -1.5, -0.31, 1.5, 0.33, [K(-1.05, -0.27, -0.45, 0.2, 'sink'), K(0.4, -0.26, 1.1, 0.26, 'hob')], 'top', 0.53), top(2.2, -1.5, -0.33, 1.5, 0.0, [], 'high')]],
  dining_table: ['dining', [top(0.76, -0.8, -0.45, 0.8, 0.45)]],
  cafe_table: ['cafe_table', [top(0.76, -0.255, -0.255, 0.255, 0.255)]],
  cafe_table4: ['cafe_table', [top(0.76, -0.339, -0.339, 0.339, 0.339)]],
  bar_counter: ['bar', [top(1.1, -1.55, -0.3, 1.55, 0.38, [K(-1.39, -0.24, 1.38, -0.16, 'bottles')])]],
  cafe_counter: ['cafe_counter', [top(1.05, -1.6, -0.4, 1.6, 0.4, [K(-1.3, -0.3, -0.7, 0.12, 'espresso machine'), K(-0.25, -0.1, 0.1, 0.2, 'till'), K(0.3, -0.05, 1.5, 0.3, 'pastry case')])]],
  fridge: ['cabinet', [top(1.9, -0.4, -0.36, 0.4, 0.33, [], 'high')]],
  // Café
  bistro_set: ['cafe_table', [top(0.75, -0.255, -0.255, 0.255, 0.255, [K(0.0, -0.11, 0.1, -0.05, 'vase')])]],
  rattan_set: ['cafe_table', [top(0.71, -0.283, -0.283, 0.283, 0.283)]],
  communal_table: ['dining', [top(0.78, -1.65, -0.48, 1.65, 0.48, [K(-1.045, -0.245, -0.955, -0.155, 'cup'), K(-0.795, 0.155, -0.705, 0.245, 'cup'), K(-0.045, -0.245, 0.045, -0.155, 'cup'), K(0.205, 0.155, 0.295, 0.245, 'cup'), K(0.955, -0.245, 1.045, -0.155, 'cup'), K(1.205, 0.155, 1.295, 0.245, 'cup'), K(0.375, -0.125, 0.625, 0.125, 'plant')])]],
  library_table: ['dining', [top(0.78, -1.0, -0.48, 1.0, 0.48, [K(-0.57, -0.12, -0.33, 0.12, 'lamp'), K(0.33, -0.12, 0.57, 0.12, 'lamp'), K(0.1, 0.1, 0.24, 0.3, 'books')])]],
  zinc_bar: ['bar', [top(1.12, -2.46, -0.46, 2.46, 0.44, [K(-1.57, -0.41, -0.83, 0.13, 'espresso machine'), K(-0.64, -0.35, -0.46, -0.16, 'grinder'), K(0.46, -0.29, 0.74, -0.01, 'cake dome'), K(1.26, -0.29, 1.54, -0.01, 'pastry stand')])]],
  counter_bistro: CAFE_COUNTER(),
  counter_nordic: CAFE_COUNTER(K(1.65, -0.46, 2.04, -0.1, 'plant')),
  counter_loft: CAFE_COUNTER(),
  counter_library: CAFE_COUNTER(K(1.73, -0.32, 1.97, -0.05, 'lamp'), K(-1.95, 0.12, -1.62, 0.34, 'books')),
  counter_garden: CAFE_COUNTER(K(1.58, -0.46, 2.03, -0.06, 'plant'), K(-1.9, 0.1, -1.6, 0.4, 'plant')),
  condiment_bar: ['cafe_counter', [top(0.96, -0.57, -0.3, 0.57, 0.3, [K(-0.43, -0.08, -0.27, 0.08, 'carafe'), K(-0.195, 0.105, 0.195, 0.195, 'cups'), K(0.12, -0.2, 0.45, -0.05, 'napkins')])]],
  library_wall: ['books', [...shelves([0.1, 0.52, 0.94, 1.36, 1.78], -1.48, -0.18, 1.46, 0.2, 0.39, 'f', 'books', [K(-0.52, -0.18, -0.48, 0.2, 'upright'), K(0.48, -0.18, 0.52, 0.2, 'upright')]), top(2.2, -1.48, -0.18, 1.46, 0.2, [], 'high', 0, 'f', 'books')]],   // (its top row of books stands on that top)
  bookshelf_divider: ['books', [...shelves([0.08, 0.5, 0.92, 1.34], -1.16, 0.0, 1.16, 0.2, 0.39, 'f', 'books'), ...shelves([1.76], -1.16, 0.0, 1.16, 0.2, 0.4, 'f', 'books'),
    ...shelves([0.08, 0.5, 0.92, 1.34], -1.16, -0.2, 1.16, 0.0, 0.39, 'b', 'books'), ...shelves([1.76], -1.16, -0.2, 1.16, 0.0, 0.4, 'b', 'books'), top(2.2, -1.2, -0.2, 1.2, 0.2, [K(0.475, -0.125, 0.725, 0.125, 'plant')], 'high', 0, 'fb')]],
  pipe_shelf: ['open_shelf', [...shelves([0.49, 0.99, 1.49], -0.82, -0.18, 0.82, 0.18, 0.46, 'f', 'jars'), top(1.99, -0.82, -0.18, 0.82, 0.18, [], 'high', 0, 'f', 'jars')]],
  window_ledge: ['ledge', [top(1.07, -1.3, -0.45, 1.3, -0.12, [K(-0.645, -0.345, -0.555, -0.255, 'cup'), K(0.575, -0.325, 0.665, -0.235, 'cup')])]],
  // Home
  nightstand: ['nightstand', [top(0.55, -0.24, -0.22, 0.24, 0.22, [K(-0.11, -0.21, 0.21, 0.11, 'lamp'), K(-0.18, 0.0, -0.02, 0.18, 'book')])]],
  wardrobe: ['cabinet', [top(2.05, -0.65, -0.3, 0.65, 0.28, [], 'high')]],
  desk_home: ['desk', [top(0.755, -0.6, -0.32, 0.6, 0.3, [K(-0.22, -0.24, 0.12, 0.07, 'laptop'), K(0.31, 0.01, 0.39, 0.09, 'mug'), K(-0.51, -0.26, -0.3, 0.01, 'lamp', 1)])]],
  // Retail
  checkout: ['service', [top(0.9, -0.9, -0.35, 0.9, 0.35, [K(-0.85, -0.1, 0.4, 0.3, 'belt'), K(0.5, -0.25, 0.8, 0.05, 'till')])]],
  fish_counter: ['service', [top(0.95, -1.0, -0.3, 0.14, 0.3), top(0.9, 0.2, -0.4, 1.1, 0.4, [K(0.35, -0.2, 0.85, 0.2, 'scales')])]],
  display: ['store_table', [top(0.76, -0.75, -0.5, 0.75, 0.5, [], 'top', 0, 'fb', 'goods')]],
  shop_shelf: ['store_shelf', [...shelves([0.145, 0.565, 0.985], -1.0, 0.05, 1.0, 0.3, 0.395, 'f', 'goods'), top(1.405, -1.0, 0.05, 1.0, 0.3, [], 'top', 0, 'f', 'goods'),
    ...shelves([0.145, 0.565, 0.985], -1.0, -0.3, 1.0, -0.05, 0.395, 'b', 'goods'), top(1.405, -1.0, -0.3, 1.0, -0.05, [], 'top', 0, 'b', 'goods')]],
  shoe_wall: ['store_shelf', [...shelves([0.42, 0.86, 1.3], -0.94, -0.1, 0.94, 0.12, 0.42, 'f', 'shoes'), top(1.74, -0.94, -0.1, 0.94, 0.12, [], 'high')]],
  shoe_plinth: ['store_shelf', [top(1.44, -0.28, -0.28, 0.28, 0.28, [], 'top', 0, 'fb')]],
  // Gym
  lockers: ['cabinet', [top(1.95, -1.0, -0.25, 1.0, 0.22, [], 'high')]],
  // Fun, Arcade, Club, Studio, Outdoor
  hightop_table: ['cafe_table', [top(1.06, -0.255, -0.255, 0.255, 0.255, [K(-0.03, -0.03, 0.03, 0.03, 'light')])]],
  party_table: ['cafe_table', [top(0.77, -1.5, -0.48, 1.5, 0.48, [K(-0.15, -0.15, 0.15, 0.15, 'champagne bucket'), K(-0.95, -0.05, -0.85, 0.05, 'candle'), K(0.85, -0.05, 0.95, 0.05, 'candle')])]],
  club_bar: ['bar', [top(1.07, -3.3, 0.3, 3.3, 0.98, [K(-1.03, 0.49, -0.77, 0.75, 'ice bucket'), K(-2.235, 0.565, -2.165, 0.635, 'glass'), K(0.265, 0.565, 0.335, 0.635, 'glass'), K(2.465, 0.565, 2.535, 0.635, 'glass')]),
    top(0.99, -3.3, -0.41, 3.3, -0.1, [], 'shelf', 0.29), top(2.14, -3.1, -0.41, 3.1, -0.2, [], 'high')]],   // (its bottle shelves stay its own)
  guest_table: ['studio_desk', [top(0.76, -0.438, -0.438, 0.438, 0.438, [K(-0.06, 0.24, 0.06, 0.36, 'microphone'), K(-0.06, -0.36, 0.06, -0.24, 'microphone'), K(0.105, 0.32, 0.375, 0.465, 'headphones'), K(0.105, -0.465, 0.375, -0.32, 'headphones'), K(0.01, -0.24, 0.09, -0.16, 'glass')], 'top', 0, 'fb')]],
  broadcast_desk: ['studio_desk', [top(0.76, -1.6, -0.55, 1.6, 0.45, [K(-0.57, -0.56, 0.57, -0.1, 'console'), K(-1.22, -0.54, -0.68, -0.37, 'screen'), K(0.68, -0.54, 1.22, -0.37, 'screen'), K(-0.83, -0.38, -0.77, -0.32, 'microphone'), K(0.42, -0.38, 0.48, -0.32, 'microphone'), K(0.77, -0.38, 0.83, -0.32, 'microphone'),
    K(-1.09, 0.1, -0.81, 0.3, 'headphones'), K(1.11, 0.1, 1.39, 0.3, 'headphones'), K(0.11, 0.12, 0.39, 0.32, 'headphones'), K(-0.3, 0.1, 0.02, 0.32, 'papers'), K(0.6, 0.12, 0.85, 0.36, 'papers'), K(-1.46, 0.21, -1.38, 0.29, 'mug')])]],
  picnic_table: ['picnic', [top(0.76, -0.9, -0.38, 0.9, 0.37)]],
};

const freeze = a => Object.freeze(a.map(s => Object.freeze({ ...s, keep: Object.freeze(s.keep.map(k => Object.freeze(k))) })));
const NONE = Object.freeze([]);
const native = new Map();
const IN = 0.02;   // (m: a native board's edge)
for (const [t, [cls, list]] of Object.entries(NATIVE)) {
  const R = CATALOG[t]?.rect || [-9, -9, 9, 9];   // (inside the piece's own rectangle: a bar's top overhangs its ends)
  native.set(t, { cls, s: freeze(list.map(([y, x0, z0, x1, z1, clear, kind, side, keep, fill]) => ({ y, x0: Math.max(x0 + IN, R[0]), z0: Math.max(z0 + IN, R[1]), x1: Math.min(x1 - IN, R[2]), z1: Math.min(z1 - IN, R[3]), clear: clear || Infinity, kind, side, keep, fill }))) });
}
let rows = null;
/** The Amazon model's surfaces (model frame, metres), or [] when it has none. */
export function aboSurfaces(id) {
  if (!rows) {
    rows = new Map();
    for (const line of ABO_SURF_ROWS.split('\n')) {
      if (!line) continue;
      const [mid, list] = line.split('|');
      rows.set(mid, list.split(';').map(s => {
        const v = s.split(','), m = i => +v[i] / 1000, ks = v[6] || 'tf';
        return { y: m(0), x0: m(1), z0: m(2), x1: m(3), z1: m(4), clear: +v[5] ? m(5) : Infinity, kind: KIND[ks[0]] || 'top', side: ks.slice(1) || 'f', keep: [], fill: '' };
      }));
    }
  }
  return rows.get(id) || NONE;
}

const cache = new Map();
/**
 * The surfaces of a placed piece `it` ({ t, m? }) in its own frame: [{ y, x0, z0, x1, z1, clear, kind, side, keep }],
 * the index in this list being an entry's `s`. [] when nothing can be put on it.
 */
export function surfacesOf(it) {
  const t = it?.t, d = t && CATALOG[t];
  if (!d) return NONE;
  const m = typeof it.m === 'string' && it.m ? it.m : '', key = m ? `${t}~${m}` : t;
  let out = cache.get(key);
  if (out) return out;
  out = NONE;
  if (t.startsWith(ABO_PREFIX) && d.abo && ABO_HOST_KINDS.has(d.kind)) {   // a library piece: as drawn (scaled, lifted)
    const k = d.scale || 1, dy = (d.lift || 0) + (d.oy || 0);
    out = freeze(aboSurfaces(d.abo).map(s => ({ ...s, y: s.y * k + dy, x0: s.x0 * k, z0: s.z0 * k, x1: s.x1 * k, z1: s.z1 * k, clear: s.clear * k })));
  } else if (m && aboChoiceOk(t, m) && PICK[t]?.[0] && SPEC[t]) {   // MVW's piece drawn as its Amazon counterpart, fitted
    const S = SPEC[t], f = aboFit(PICK[t][0], S.fit || [...d.rect, d.h], S), nat = native.get(t)?.s || NONE;
    if (f) {
      const [sx, sy, sz] = f.s, [px, py, pz] = f.p;
      out = freeze(aboSurfaces(PICK[t][0]).map(s => {
        const r = { ...s, y: s.y * sy + py, x0: s.x0 * sx + px, z0: s.z0 * sz + pz, x1: s.x1 * sx + px, z1: s.z1 * sz + pz, clear: s.clear * sy, keep: [] };
        // MVW's own things drawn on it (a monitor, a lamp, a TV: render/furniture.js propsGeometry) at MVW's top's height
        if (S.props) for (const n of nat) if (Math.abs(n.y - r.y) < 0.03) r.keep.push(...n.keep.filter(k => !k[5]));
        return r;
      }));
    }
  } else if (native.has(t)) out = native.get(t).s;
  cache.set(key, out);
  return out;
}
/** Whether things can be put on piece it. */
export const isHost = it => surfacesOf(it).length > 0;
/** The host's class for the dressing's rules ('desk', 'books', 'store_shelf' ...), or null. */
export function hostClass(it) {
  const d = CATALOG[it?.t]; if (!d) return null;
  if (d.abo && it.t.startsWith(ABO_PREFIX)) return ABO_HOST_KINDS.has(d.kind) ? ABO_CLASS[d.kind] : null;
  return native.get(it.t)?.cls || (isHost(it) ? 'other' : null);
}
/** Whether type t may be put on a surface (a goods item, or small decor marked onOk). */
export const onType = t => { const d = CATALOG[t]; return !!d && (d.size === 'surface' || !!d.onOk); };

/** The corners (host frame) of entry e's footprint: its type's rect turned by r and moved to (x, z). */
export function onCorners(e) {
  const [x0, z0, x1, z1] = CATALOG[e.t].rect, c = Math.cos(e.r || 0), s = Math.sin(e.r || 0);
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => [e.x + x * c + z * s, e.z - x * s + z * c]);
}
/** Whether two convex quads ([[x, z] x 4]) overlap by more than gap (separating axes). */
export function quadsOverlap(A, B, gap) {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4], nx = bz - az, nz = ax - bx, L = Math.hypot(nx, nz);
    if (!L) continue;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of A) { const v = (x * nx + z * nz) / L; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
    for (const [x, z] of B) { const v = (x * nx + z * nz) / L; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    if (a1 <= b0 + gap || b1 <= a0 + gap) return false;
  }
  return true;
}
const rectQuad = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const nameOf = t => (CATALOG[t]?.name || 'piece').toLowerCase();

/** Why entry e ({ t, s, x, z, r }) cannot stand on surfaces surfs, or null (alone: not against the others). */
export function onWhy(surfs, e) {
  if (!e || typeof e !== 'object') return 'Bad entry';
  const d = CATALOG[e.t];
  if (!d) return 'Unknown item type';
  if (!onType(e.t)) return `The ${nameOf(e.t)} stands on the floor`;
  if (!Number.isInteger(e.s) || e.s < 0 || e.s >= surfs.length) return 'No such surface on that piece';
  if (![e.x, e.z, e.r].every(Number.isFinite)) return 'Bad position';
  const S = surfs[e.s], h = d.h - (d.lift || 0);
  if (h > S.clear + TALL) return `The ${nameOf(e.t)} is too tall for that shelf`;
  const Q = onCorners(e);
  if (Q.some(([x, z]) => x < S.x0 + EDGE - 1e-6 || x > S.x1 - EDGE + 1e-6 || z < S.z0 + EDGE - 1e-6 || z > S.z1 - EDGE + 1e-6)) return `The ${nameOf(e.t)} does not fit there`;
  for (const k of S.keep) if (quadsOverlap(Q, rectQuad(k), GAP)) return `The ${nameOf(e.t)} is in the way of the ${k[4] || 'things there'}`;
  return null;
}
/** Why list cannot be the things on host (a placed piece), or null: each entry alone (onWhy), no two overlapping on one
 *  surface, at most ON_MAX. */
export function checkOn(host, list) {
  if (!Array.isArray(list)) return 'Bad list';
  if (list.length > ON_MAX) return `At most ${ON_MAX} things on one piece`;
  const surfs = surfacesOf(host);
  if (!surfs.length) return list.length ? `Nothing can be put on the ${nameOf(host?.t)}` : null;
  const placed = [];
  for (const e of list) {
    const why = onWhy(surfs, e); if (why) return why;
    const Q = onCorners(e);
    for (const p of placed) if (p.s === e.s && quadsOverlap(p.Q, Q, GAP)) return `The ${nameOf(e.t)} overlaps the ${nameOf(p.t)}`;
    placed.push({ s: e.s, t: e.t, Q });
  }
  return null;
}
const r3 = v => Math.round(v * 1000) / 1000;

/** The surface a ray meets first, the ray in the host's own frame (origin o, direction d: [x, y, z]): its index s, the
 *  point (x, z) and the distance t along the ray; or null. A surface is met from above only, within margin m of its
 *  rectangle (the point is then moved in: nudgeIn). The editor's ghost follows it (ui/editors.js). */
export function surfaceHit(surfs, o, d, m = 0.04) {
  if (!(d[1] < -1e-6)) return null;
  let best = null;
  surfs.forEach((S, s) => {
    const t = (S.y - o[1]) / d[1];
    if (t <= 0 || (best && t >= best.t)) return;
    const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
    if (x < S.x0 - m || x > S.x1 + m || z < S.z0 - m || z > S.z1 + m) return;
    best = { s, x, z, t };
  });
  return best;
}
/** Entry e ({ t, s, x, z, r }) moved in from the edges of surface S when it hangs over them (it may still not fit). */
export function nudgeIn(S, e) {
  const Q = onCorners(e), xs = Q.map(q => q[0]), zs = Q.map(q => q[1]);
  const lo = (v, a) => Math.max(0, a - Math.min(...v)), hi = (v, a) => Math.max(0, Math.max(...v) - a);
  const dx = lo(xs, S.x0 + EDGE) - hi(xs, S.x1 - EDGE), dz = lo(zs, S.z0 + EDGE) - hi(zs, S.z1 - EDGE);
  return dx || dz ? { ...e, x: r3(e.x + dx), z: r3(e.z + dz) } : e;
}
/** Where MVW's own fill (books, goods, shoes, jars drawn on a shelf: NATIVE's fill) makes way for the things put on host
 *  it: [y, top, x0, z0, x1, z1] per thing on such a shelf (its footprint with a margin, host frame), [] when none. The
 *  piece is drawn with the fill there taken out (render/furniture.js fillGeometry), the rest of the shelf as before. */
export function fillCuts(it, pad = 0.015) {
  const list = it?.on;
  if (!Array.isArray(list) || !list.length || (typeof it.m === 'string' && it.m)) return NONE;
  const surfs = surfacesOf(it), out = [];
  for (const e of list) {
    const S = surfs[e.s]; if (!S || !S.fill || !CATALOG[e.t]) continue;
    const Q = onCorners(e), xs = Q.map(q => q[0]), zs = Q.map(q => q[1]);
    out.push([S.y, S.y + Math.min(S.clear, 0.6) + 0.03, Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad]);
  }
  return out;
}
/** The entries of a list as stored ({ t, s, x, z, r } only, rounded to the millimetre / milliradian), or an Error. */
export function cleanOn(list) {
  if (!Array.isArray(list)) return new Error('Bad list');
  if (list.length > ON_MAX) return new Error(`At most ${ON_MAX} things on one piece`);
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || typeof e.t !== 'string') return new Error('Bad entry');
    const x = +e.x, z = +e.z, r = +(e.r || 0), s = +e.s;
    if (![x, z, r].every(Number.isFinite) || !Number.isInteger(s)) return new Error('Bad position');
    out.push({ t: e.t, s, x: r3(x), z: r3(z), r: r3(r) });
  }
  return out;
}

/**
 * The things of a piece whose surfaces change (its look switched, MVW's <-> its Amazon counterpart's): each kept on the
 * surface at the same index when its height is within 5 cm, else the nearest in height; moved in if it now hangs over
 * an edge; dropped when it no longer fits. -> { on, dropped }
 */
export function refitOn(from, to, list) {
  const A = surfacesOf(from), B = surfacesOf(to), on = [];
  let dropped = 0;
  if (!Array.isArray(list)) return { on: list, dropped: 0 };
  for (const e of list) {
    const was = A[e.s];
    let s = -1;
    if (was && B[e.s] && Math.abs(B[e.s].y - was.y) <= 0.05) s = e.s;
    else if (was) { let best = Infinity; B.forEach((S, i) => { const dy = Math.abs(S.y - was.y); if (dy < best) { best = dy; s = i; } }); }
    if (s < 0) { dropped++; continue; }
    let n = { ...e, s };
    const S = B[s], Q = onCorners(n);
    const lo = (k, a) => Math.min(...Q.map(q => q[k])) - a, hi = (k, a) => Math.max(...Q.map(q => q[k])) - a;
    const dx = Math.max(0, (S.x0 + EDGE) - (lo(0, 0))) - Math.max(0, hi(0, S.x1 - EDGE)), dz = Math.max(0, (S.z0 + EDGE) - lo(1, 0)) - Math.max(0, hi(1, S.z1 - EDGE));
    if (dx || dz) n = { ...n, x: r3(n.x + dx), z: r3(n.z + dz) };
    const Qn = onCorners(n);
    if (onWhy(B, n) || on.some(o => o.s === s && quadsOverlap(onCorners(o), Qn, GAP))) { dropped++; continue; }
    on.push(n);
  }
  return { on, dropped };
}
/** The entries of list that may stay on host (each fits, none overlapping an earlier one): a saved layout laid on a floor,
 *  a world loaded after the surfaces or the goods changed. -> { on, dropped } */
export function keepOn(host, list) {
  if (!Array.isArray(list)) return { on: [], dropped: 0 };
  const surfs = surfacesOf(host), on = [];
  for (const e of list) {
    if (on.length >= ON_MAX || onWhy(surfs, e)) continue;
    const Q = onCorners(e);
    if (on.some(o => o.s === e.s && quadsOverlap(onCorners(o), Q, GAP))) continue;
    on.push(e);
  }
  return { on, dropped: list.length - on.length };
}
