// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Furniture / object catalog shared by the server (placement, nav, activities) and the client (geometry, editing).
// Item-local frame: +z = the item's front (the side a user approaches), yaw 0 faces +z, yaw PI faces -z.
// rect = blocking rectangle [x0, z0, x1, z1] (item-local). block:false => walkable decor (rugs, mats).
// Slots: x,z (+y offset from the standard pose height), yaw (facing, item-local), anim clip, use tag,
// ax/az approach point (defaults to the slot itself), prop held while using, dur [min,max] world minutes.
import { barStools, barStaff } from './bar-shape.js';
import { SINGER, BASSIST } from './stage.js';

const P = Math.PI, H = Math.PI / 2;
function S(x, z, yaw, anim, use, o = {}) { return { x, z, yaw, anim, use, ...o }; }
/** A dance floor's places: rings of dancers round the DJ (on the raised floor: y). */
function danceSlots(radii) {
  return radii.flatMap((r, i) => { const n = Math.floor(2 * P * r / 1.5); return Array.from({ length: n }, (_, k) => { const a = (k + (i % 2) * 0.5) / n * 2 * P; return S(Math.sin(a) * r, Math.cos(a) * r, (k * 2.4) % 6.28, 'dance', 'dance', { y: 0.1, dur: [10, 30] }); }); });
}
/** An island bar's seats: its stools all round (come to from behind), its bartenders in the well (in by the back). */
function barSlots(hx, r) {
  return [...barStools(hx, r).map(t => S(t.x, t.z, t.yaw, 'sit_high', 'eat', { ax: t.x - Math.sin(t.yaw) * 0.7, az: t.z - Math.cos(t.yaw) * 0.7, y: 0.28 })),
    ...barStaff(hx, r).map(t => S(t.x, t.z, t.yaw, 'bartend', 'staff', { ax: 0, az: -(r + 1.05) }))];   // (a bartender shakes and pours)
}

export const CATALOG = {
  // ---------------- Office ----------------
  desk: { name: 'Workstation', cat: 'Office', h: 1.2, rect: [-0.7, -0.37, 0.7, 0.92], tint: true,
    slots: [S(0, 0.58, P, 'sit_type', 'work', { az: 1.28 })] },
  desk_l: { name: 'Corner Desk', cat: 'Office', h: 1.2, rect: [-0.9, -0.45, 0.9, 0.95], tint: true,
    slots: [S(0, 0.6, P, 'sit_type', 'work', { az: 1.3 })] },
  desk_exec: { name: 'Executive Desk', cat: 'Office', h: 1.2, rect: [-1.0, -0.48, 1.0, 1.0], tint: true,
    slots: [S(0, 0.66, P, 'sit_type', 'work', { az: 1.36 })] },
  standing_desk: { name: 'Standing Desk', cat: 'Office', h: 1.3, rect: [-0.7, -0.37, 0.7, 0.37], tint: true,
    slots: [S(0, 0.72, P, 'use', 'work', { az: 1.05 })] },
  meeting_table: { name: 'Meeting Table', cat: 'Office', h: 0.9, rect: [-1.95, -1.15, 1.95, 1.15], tint: true,
    slots: [
      S(-0.9, 1.0, P, 'sit_talk', 'meeting', { az: 1.6 }), S(0, 1.0, P, 'sit_talk', 'meeting', { az: 1.6 }), S(0.9, 1.0, P, 'sit_talk', 'meeting', { az: 1.6 }),
      S(-0.9, -1.0, 0, 'sit_talk', 'meeting', { az: -1.6 }), S(0, -1.0, 0, 'sit_talk', 'meeting', { az: -1.6 }), S(0.9, -1.0, 0, 'sit_talk', 'meeting', { az: -1.6 }),
      S(1.78, 0, -H, 'sit_talk', 'meeting', { ax: 2.35, az: 0 }), S(-1.78, 0, H, 'sit_talk', 'meeting', { ax: -2.35, az: 0 }),
    ] },
  whiteboard: { name: 'Whiteboard', cat: 'Office', h: 2.0, rect: [-0.95, -0.08, 0.95, 0.08], wall: true,
    slots: [S(0.65, 0.62, 0.35, 'present', 'present', { az: 0.9 })] },
  tv_wall: { name: 'Wall Screen', cat: 'Office', h: 1.9, rect: [-0.95, -0.08, 0.95, 0.08], wall: true, slots: [] },
  printer: { name: 'Printer', cat: 'Office', h: 1.1, rect: [-0.45, -0.3, 0.45, 0.3],
    slots: [S(0, 0.62, P, 'use', 'print', { dur: [1, 3] })] },
  bookshelf: { name: 'Bookshelf', cat: 'Office', h: 2.0, rect: [-0.8, -0.2, 0.8, 0.2], tint: true,
    slots: [S(-0.35, 0.62, P, 'browse', 'browse', { prop: 'book' }), S(0.4, 0.62, P, 'browse', 'browse', { prop: 'book' })] },
  filing: { name: 'Filing Cabinet', cat: 'Office', h: 1.3, rect: [-0.25, -0.3, 0.25, 0.3], slots: [S(0, 0.65, P, 'use', 'file', { dur: [1, 3] })] },
  phone_booth: { name: 'Phone Booth', cat: 'Office', h: 2.2, rect: [-0.6, -0.6, 0.6, 0.6],
    slots: [S(0, -0.1, 0, 'sit_phone', 'call', { az: 1.05, prop: 'phone' })] },
  server_rack: { name: 'Server Rack', cat: 'Office', h: 2.0, rect: [-0.32, -0.5, 0.32, 0.5], slots: [] },
  // ---------------- Lounge ----------------
  sofa: { name: 'Sofa', cat: 'Lounge', h: 0.85, rect: [-1.05, -0.45, 1.05, 0.45], tint: true,
    slots: [S(-0.62, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.05 }), S(0, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.05 }), S(0.62, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.05 })] },
  sofa_l: { name: 'Sectional Sofa', cat: 'Lounge', h: 0.85, rect: [-1.4, -0.45, 1.4, 0.45], tint: true,
    slots: [S(-0.9, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.05 }), S(-0.3, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.05 }), S(0.3, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.05 }), S(0.9, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.05 })] },
  armchair: { name: 'Armchair', cat: 'Lounge', h: 0.9, rect: [-0.45, -0.45, 0.45, 0.45], tint: true,
    slots: [S(0, 0.08, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.04 })] },
  beanbag: { name: 'Bean Bag', cat: 'Lounge', h: 0.55, rect: [-0.45, -0.45, 0.45, 0.45], tint: true,
    slots: [S(0, 0.05, 0, 'sit_relax', 'relax', { az: 0.95, y: -0.2 })] },
  coffee_table: { name: 'Coffee Table', cat: 'Lounge', h: 0.42, rect: [-0.6, -0.33, 0.6, 0.33], slots: [] },
  rug: { name: 'Rug', cat: 'Lounge', h: 0.02, rect: [-1.3, -0.9, 1.3, 0.9], block: false, tint: true, slots: [] },
  tv_stand: { name: 'TV', cat: 'Lounge', h: 1.3, rect: [-0.95, -0.25, 0.95, 0.25], slots: [] },
  plant: { name: 'Plant', cat: 'Decor', h: 1.0, rect: [-0.26, -0.26, 0.26, 0.26], slots: [] },
  plant_tall: { name: 'Tall Plant', cat: 'Decor', h: 1.9, rect: [-0.32, -0.32, 0.32, 0.32], slots: [] },
  floor_lamp: { name: 'Floor Lamp', cat: 'Decor', h: 1.7, rect: [-0.2, -0.2, 0.2, 0.2], slots: [] },
  pingpong: { name: 'Ping-Pong Table', cat: 'Fun', h: 0.9, rect: [-0.78, -1.4, 0.78, 1.4],
    slots: [S(0, 1.85, P, 'pingpong', 'pingpong', { prop: 'paddle', dur: [10, 25] }), S(0, -1.85, 0, 'pingpong', 'pingpong', { prop: 'paddle', dur: [10, 25] })] },
  arcade: { name: 'Arcade Cabinet', cat: 'Arcade', h: 1.9, rect: [-0.4, -0.4, 0.4, 0.4], tint: true, arcade: true,
    slots: [S(0, 0.72, P, 'play', 'play', { dur: [8, 20] })] },
  piano: { name: 'Piano', cat: 'Fun', h: 1.3, rect: [-0.8, -0.35, 0.8, 0.85],
    slots: [S(0, 0.62, P, 'sit_play', 'music', { az: 1.2, dur: [10, 30] })] },
  // ---------------- Kitchen / dining ----------------
  kitchen: { name: 'Kitchen Counter', cat: 'Kitchen', h: 2.2, rect: [-1.5, -0.33, 1.5, 0.33], tint: true,
    // (the cook stands close to the hob, stepping in from where the sink's user stands: shared/eating.js STOVE_PAN)
    slots: [S(-0.75, 0.62, P, 'wash', 'wash', { dur: [2, 5] }), S(0.75, 0.5, P, 'cook', 'cook', { az: 0.62, dur: [10, 25] })] },
  counter: { name: 'Counter', cat: 'Kitchen', h: 0.95, rect: [-0.9, -0.33, 0.9, 0.33], tint: true,
    slots: [S(0, 0.5, P, 'use', 'prep', { az: 0.62, dur: [2, 6] })] },   // (close to the board: shared/eating.js PREP_BOARD)
  fridge: { name: 'Fridge', cat: 'Kitchen', h: 1.9, rect: [-0.4, -0.36, 0.4, 0.36],
    slots: [S(0, 0.75, P, 'use', 'fridge', { dur: [1, 2] })] },
  coffee_machine: { name: 'Coffee Station', cat: 'Kitchen', h: 1.5, rect: [-0.45, -0.3, 0.45, 0.3],
    slots: [S(0, 0.62, P, 'use', 'coffee', { dur: [1, 3] })] },
  water_cooler: { name: 'Water Cooler', cat: 'Kitchen', h: 1.25, rect: [-0.22, -0.22, 0.22, 0.22],
    slots: [S(0, 0.55, P, 'drink', 'water', { prop: 'cup', dur: [2, 5] })] },
  vending: { name: 'Vending Machine', cat: 'Kitchen', h: 1.95, rect: [-0.5, -0.4, 0.5, 0.4],
    slots: [S(0, 0.72, P, 'use', 'snack', { dur: [1, 2] })] },
  dining_table: { name: 'Dining Table', cat: 'Kitchen', h: 0.9, rect: [-0.85, -1.0, 0.85, 1.0], tint: true,
    slots: [S(-0.42, 0.78, P, 'sit_eat', 'eat', { az: 1.35 }), S(0.42, 0.78, P, 'sit_eat', 'eat', { az: 1.35 }),
      S(-0.42, -0.78, 0, 'sit_eat', 'eat', { az: -1.35 }), S(0.42, -0.78, 0, 'sit_eat', 'eat', { az: -1.35 })] },
  cafe_table: { name: 'Café Table (2)', cat: 'Kitchen', h: 0.9, rect: [-0.42, -0.85, 0.42, 0.85], tint: true,
    slots: [S(0, 0.62, P, 'sit_eat', 'eat', { az: 1.18 }), S(0, -0.62, 0, 'sit_eat', 'eat', { az: -1.18 })] },
  cafe_table4: { name: 'Café Table (4)', cat: 'Kitchen', h: 0.9, rect: [-0.95, -0.95, 0.95, 0.95], tint: true,
    slots: [S(0, 0.7, P, 'sit_eat', 'eat', { az: 1.28 }), S(0, -0.7, 0, 'sit_eat', 'eat', { az: -1.28 }),
      S(0.7, 0, -H, 'sit_eat', 'eat', { ax: 1.28, az: 0 }), S(-0.7, 0, H, 'sit_eat', 'eat', { ax: -1.28, az: 0 })] },
  bar_counter: { name: 'Bar Counter', cat: 'Kitchen', h: 1.1, rect: [-1.5, -0.3, 1.5, 0.75],
    slots: [-1.1, -0.37, 0.37, 1.1].map(x => S(x, 0.55, P, 'sit_high', 'eat', { az: 1.1, y: 0.28 })) },
  cafe_counter: { name: 'Café Counter', cat: 'Kitchen', h: 1.6, rect: [-1.6, -0.4, 1.6, 0.4], tint: true,
    slots: [S(-0.8, -0.78, 0, 'staff', 'staff', { az: -0.95 }), S(0.8, -0.78, 0, 'staff', 'staff', { az: -0.95 }), S(0, 0.78, P, 'talk', 'order', { az: 1.05, dur: [1, 3] })] },
  // ---------------- Café (Floor Themes' café redone, 2026-10-26: client/js/render/furniture-cafe.js) ----------------
  counter_bistro: { name: 'Bistro Counter', cat: 'Café', h: 1.45, rect: [-2.05, -0.47, 2.05, 0.48], tint: true, slots: [S(-0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0, 0.88, P, 'talk', 'order', { az: 1.1, dur: [1, 3] })] },
  counter_nordic: { name: 'Oak Coffee Counter', cat: 'Café', h: 1.45, rect: [-2.05, -0.47, 2.05, 0.48], tint: true, slots: [S(-0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0, 0.88, P, 'talk', 'order', { az: 1.1, dur: [1, 3] })] },
  counter_loft: { name: 'Steel Coffee Bar', cat: 'Café', h: 1.45, rect: [-2.05, -0.47, 2.05, 0.48], tint: true, slots: [S(-0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0, 0.88, P, 'talk', 'order', { az: 1.1, dur: [1, 3] })] },
  counter_library: { name: 'Library Counter', cat: 'Café', h: 1.45, rect: [-2.05, -0.47, 2.05, 0.48], tint: true, slots: [S(-0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0, 0.88, P, 'talk', 'order', { az: 1.1, dur: [1, 3] })] },
  counter_garden: { name: 'Rattan Counter', cat: 'Café', h: 1.45, rect: [-2.05, -0.47, 2.05, 0.48], tint: true, slots: [S(-0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0.9, -0.88, 0, 'staff', 'staff', { az: -1.0 }), S(0, 0.88, P, 'talk', 'order', { az: 1.1, dur: [1, 3] })] },
  pastry_vitrine: { name: 'Pastry Case', cat: 'Café', h: 1.3, rect: [-0.76, -0.36, 0.76, 0.36], tint: true, slots: [] },
  bistro_set: { name: 'Bistro Table', cat: 'Café', h: 0.95, rect: [-0.98, -0.42, 0.98, 0.42], slots: [S(-0.62, 0, H, 'sit_eat', 'eat', { ax: -1.3, az: 0.3 }), S(0.62, 0, -H, 'sit_eat', 'eat', { ax: 1.3, az: -0.3 })] },
  rattan_set: { name: 'Rattan Table', cat: 'Café', h: 1.2, rect: [-0.98, -0.42, 0.98, 0.42], slots: [S(-0.62, 0, H, 'sit_eat', 'eat', { ax: -1.3, az: 0.3 }), S(0.62, 0, -H, 'sit_eat', 'eat', { ax: 1.3, az: -0.3 })] },
  communal_table: { name: 'Communal Table', cat: 'Café', h: 0.8, rect: [-1.65, -0.9, 1.65, 0.9], tint: true,
    slots: [-1.0, 0, 1.0].flatMap(x => [S(x, 0.72, P, 'sit_eat', 'eat', { az: 1.25 }), S(x, -0.72, 0, 'sit_eat', 'eat', { az: -1.25 })]) },
  window_ledge: { name: 'Window Ledge', cat: 'Café', h: 1.1, rect: [-1.3, -0.45, 1.3, 0.35],
    slots: [-0.95, -0.32, 0.32, 0.95].map(x => S(x, 0.15, P, 'sit_high', 'eat', { az: 0.65, y: 0.28 })) },
  cafe_booth: { name: 'Café Booth', cat: 'Café', h: 1.2, rect: [-1.0, -0.98, 1.0, 0.98], tint: true,
    slots: [S(-0.45, 0.66, P, 'sit_eat', 'eat', { ax: 1.35 }), S(0.45, 0.66, P, 'sit_eat', 'eat', { ax: 1.35 }), S(-0.45, -0.66, 0, 'sit_eat', 'eat', { ax: 1.35 }), S(0.45, -0.66, 0, 'sit_eat', 'eat', { ax: 1.35 })] },   // (sat into from its open end, +x: its other end stands against a wall)
  wingback_set: { name: 'Wingback Chairs', cat: 'Café', h: 1.2, rect: [-1.1, -0.5, 1.1, 0.5],
    slots: [S(-0.62, 0.1, 0.35, 'sit_relax', 'relax', { az: 0.95, y: -0.05 }), S(0.62, 0.1, -0.35, 'sit_relax', 'relax', { az: 0.95, y: -0.05 })] },
  coffee_roaster: { name: 'Coffee Roaster', cat: 'Café', h: 2.15, rect: [-0.85, -0.5, 1.05, 0.8], slots: [] },
  bean_sacks: { name: 'Coffee Sacks', cat: 'Café', h: 0.6, rect: [-0.5, -0.35, 0.5, 0.32], slots: [] },
  library_wall: { name: 'Wall of Books', cat: 'Café', h: 2.6, rect: [-1.5, -0.22, 1.5, 0.45], wall: true, slots: [] },
  hearth: { name: 'Brick Hearth', cat: 'Café', h: 1.6, rect: [-1.15, -0.4, 1.15, 0.32], wall: true, slots: [] },
  fountain_tiered: { name: 'Tiered Fountain', cat: 'Café', h: 1.6, rect: [-0.8, -0.8, 0.8, 0.8], slots: [] },
  cafe_palm: { name: 'Palm Planter', cat: 'Café', h: 2.0, rect: [-0.42, -0.42, 0.42, 0.42], tint: true, slots: [] },
  gilt_mirror: { name: 'Gilt Mirror', cat: 'Café', h: 2.45, rect: [-0.6, -0.05, 0.6, 0.02], wall: true, block: false, slots: [] },
  menu_board: { name: 'Chalkboard Menu', cat: 'Café', h: 2.3, rect: [-0.8, -0.04, 0.8, 0.02], wall: true, block: false, slots: [] },
  edison_pendants: { name: 'Edison Pendants', cat: 'Café', h: 2.97, rect: [-0.5, -0.45, 0.5, 0.45], block: false, slots: [] },
  pipe_shelf: { name: 'Pipe Shelving', cat: 'Café', h: 2.0, rect: [-0.92, -0.18, 0.92, 0.18], wall: true, slots: [] },
  condiment_bar: { name: 'Condiment Bar', cat: 'Café', h: 1.26, rect: [-0.57, -0.3, 0.57, 0.3], tint: true, slots: [] },
  hanging_ivy: { name: 'Hanging Ivy', cat: 'Café', h: 2.95, rect: [-0.3, -0.3, 0.3, 0.3], block: false, slots: [] },
  zinc_bar: { name: 'Zinc Bar', cat: 'Café', h: 1.45, rect: [-2.46, -0.46, 2.46, 1.0], tint: true,
    slots: [S(-1.4, -0.9, 0, 'staff', 'staff', { az: -1.0 }), S(0.9, -0.9, 0, 'staff', 'staff', { az: -1.0 }), S(0, 1.2, P, 'talk', 'order', { az: 1.5, dur: [1, 3] }),
      ...[-1.9, -0.95, 0.95, 1.9].map(x => S(x, 0.75, P, 'sit_high', 'eat', { az: 1.3, y: 0.28 }))] },
  banquette_long: { name: 'Window Banquette', cat: 'Café', h: 1.05, rect: [-2.1, -0.62, 2.1, 1.1], tint: true,
    slots: [-1.4, 0, 1.4].flatMap(x => [S(x, -0.32, 0, 'sit_eat', 'eat', { az: 0.6 }), S(x, 0.85, P, 'sit_eat', 'eat', { az: 1.35 })]) },
  cafe_sconce: { name: 'Brass Sconce', cat: 'Café', h: 2.25, rect: [-0.1, -0.03, 0.1, 0.25], wall: true, block: false, slots: [] },
  poster_frame: { name: 'Framed Poster', cat: 'Café', h: 2.25, rect: [-0.42, -0.03, 0.42, 0.01], wall: true, block: false, slots: [] },
  coat_stand: { name: 'Coat Stand', cat: 'Café', h: 1.85, rect: [-0.22, -0.22, 0.22, 0.22], slots: [] },
  newspaper_rack: { name: 'Newspaper Rack', cat: 'Café', h: 1.2, rect: [-0.33, -0.19, 0.33, 0.0], wall: true, slots: [] },
  bookshelf_divider: { name: 'Bookshelf Divider', cat: 'Café', h: 2.4, rect: [-1.2, -0.2, 1.2, 0.2], slots: [] },
  library_table: { name: 'Library Table', cat: 'Café', h: 1.1, rect: [-1.0, -0.95, 1.0, 0.95],
    slots: [S(-0.45, -0.75, 0, 'sit_eat', 'eat', { az: -1.25 }), S(0.45, -0.75, 0, 'sit_eat', 'eat', { az: -1.25 }), S(-0.45, 0.75, P, 'sit_eat', 'eat', { az: 1.25 }), S(0.45, 0.75, P, 'sit_eat', 'eat', { az: 1.25 })] },
  globe_stand: { name: 'Globe', cat: 'Café', h: 1.25, rect: [-0.3, -0.3, 0.3, 0.3], slots: [] },
  // the roastery's, the coffee lab's and the garden's own pieces (Order Up phase 1b part 3), and a rug for any of them
  paper_pendant: { name: 'Paper Lanterns', cat: 'Café', h: 2.97, rect: [-0.6, -0.6, 0.6, 0.6], block: false, slots: [] },
  plant_wall: { name: 'Living Plant Wall', cat: 'Café', h: 2.7, rect: [-1.25, -0.04, 1.25, 0.22], wall: true, slots: [] },
  slat_wall: { name: 'Oak Slat Wall', cat: 'Café', h: 2.8, rect: [-1.25, -0.03, 1.25, 0.07], wall: true, block: false, slots: [] },
  mesh_partition: { name: 'Mesh Partition', cat: 'Café', h: 2.0, rect: [-1.05, -0.22, 1.05, 0.22], slots: [] },
  neon_coffee: { name: 'Neon COFFEE Sign', cat: 'Café', h: 2.5, rect: [-1.0, -0.03, 1.0, 0.06], wall: true, block: false, slots: [] },
  chalk_wall: { name: 'Chalk Wall', cat: 'Café', h: 2.6, rect: [-1.25, -0.03, 1.25, 0.02], wall: true, block: false, slots: [] },
  cold_brew_tower: { name: 'Cold Brew Tower', cat: 'Café', h: 1.95, rect: [-0.32, -0.32, 0.32, 0.32], slots: [] },
  hedge_planter: { name: 'Boxwood Hedge', cat: 'Café', h: 1.15, rect: [-1.0, -0.3, 1.0, 0.3], tint: true, slots: [] },
  flower_bed: { name: 'Flower Bed', cat: 'Café', h: 0.75, rect: [-0.9, -0.4, 0.9, 0.4], tint: true, slots: [] },
  vine_trellis: { name: 'Vine Trellis with Lights', cat: 'Café', h: 2.97, rect: [-1.5, -1.5, 1.5, 1.5], block: false, slots: [] },
  birdcage: { name: 'Birdcage', cat: 'Café', h: 2.97, rect: [-0.25, -0.25, 0.25, 0.25], block: false, slots: [] },
  stone_urn: { name: 'Stone Urn', cat: 'Café', h: 1.5, rect: [-0.38, -0.38, 0.38, 0.38], tint: true, slots: [] },
  cafe_rug: { name: 'Café Rug', cat: 'Café', h: 0.02, rect: [-1.7, -1.2, 1.7, 1.2], tint: true, block: false, slots: [] },
  // Order Up's kitchen stations (phase 2): a cook's place in front of the ones cooked at (Order Up's cooks from phase 5; in a café
  // nobody is hired for them: a restaurant's are its staff, server/sim/windex.js)
  ou_fridge: { name: 'Ingredient Fridge', cat: 'Kitchen', h: 2.0, rect: [-0.42, -0.36, 0.42, 0.34], slots: [] },
  ou_pantry: { name: 'Pantry Shelves', cat: 'Kitchen', h: 2.0, rect: [-0.6, -0.3, 0.6, 0.28], slots: [] },
  ou_prep: { name: 'Prep Counter', cat: 'Kitchen', h: 1.05, rect: [-0.6, -0.34, 0.6, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [2, 5] })] },
  ou_grinder: { name: 'Grinder Station', cat: 'Kitchen', h: 1.4, rect: [-0.4, -0.34, 0.4, 0.34], slots: [] },
  ou_espresso: { name: 'Espresso Station', cat: 'Kitchen', h: 1.35, rect: [-0.6, -0.34, 0.6, 0.34], slots: [S(-0.1, 0.72, P, 'cook', 'cook', { dur: [2, 5] })] },
  ou_steamer: { name: 'Milk Steamer', cat: 'Kitchen', h: 1.4, rect: [-0.4, -0.34, 0.4, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [2, 5] })] },
  ou_oven: { name: 'Deck Oven', cat: 'Kitchen', h: 1.65, rect: [-0.5, -0.38, 0.5, 0.38], slots: [S(0, 0.8, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_press: { name: 'Sandwich Press', cat: 'Kitchen', h: 1.2, rect: [-0.4, -0.34, 0.4, 0.34], slots: [] },
  ou_blender: { name: 'Blender Station', cat: 'Kitchen', h: 1.35, rect: [-0.4, -0.34, 0.4, 0.34], slots: [] },
  ou_plating: { name: 'Plating Counter', cat: 'Kitchen', h: 1.1, rect: [-0.6, -0.34, 0.6, 0.34], slots: [] },
  ou_pass: { name: 'The Pass', cat: 'Kitchen', h: 1.9, rect: [-0.8, -0.3, 0.8, 0.3], slots: [S(0, -0.65, 0, 'use', 'cook', { dur: [1, 3] })] },
  ou_dishes: { name: 'Dish Return', cat: 'Kitchen', h: 1.45, rect: [-0.45, -0.34, 0.45, 0.34], slots: [] },
  ou_sink: { name: 'Kitchen Sink', cat: 'Kitchen', h: 1.35, rect: [-0.7, -0.34, 0.7, 0.34], slots: [S(-0.24, 0.72, P, 'wash', 'cook', { dur: [2, 6] })] },
  ou_bin: { name: 'Kitchen Bin', cat: 'Kitchen', h: 0.75, rect: [-0.22, -0.22, 0.22, 0.27], slots: [] },
  ou_extinguisher: { name: 'Fire Extinguisher', cat: 'Kitchen', h: 1.25, rect: [-0.12, -0.02, 0.12, 0.18], wall: true, block: false, slots: [] },
  ou_rail: { name: 'Order Rail', cat: 'Kitchen', h: 1.98, rect: [-0.9, -0.02, 0.9, 0.06], wall: true, block: false, slots: [] },
  // the appliances a menu calls for beyond the coffee bar's (shared/appliances.js; the product owner 2026-10-28: "to add
  // fries to the menu, you will need a fryer"): a kitchen gets them when its menu needs them, or its owner adds them
  ou_kettle: { name: 'Tea Station', cat: 'Kitchen', h: 1.45, rect: [-0.4, -0.34, 0.4, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [2, 5] })] },
  ou_toaster: { name: 'Conveyor Toaster', cat: 'Kitchen', h: 1.3, rect: [-0.4, -0.34, 0.4, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [2, 5] })] },
  ou_juicer: { name: 'Juice Station', cat: 'Kitchen', h: 1.35, rect: [-0.4, -0.34, 0.4, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [2, 5] })] },
  ou_griddle: { name: 'Flat-top Griddle', cat: 'Kitchen', h: 1.3, rect: [-0.6, -0.36, 0.6, 0.36], slots: [S(0, 0.74, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_grill: { name: 'Char Grill', cat: 'Kitchen', h: 1.35, rect: [-0.6, -0.36, 0.6, 0.36], slots: [S(0, 0.74, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_fryer: { name: 'Deep Fryer', cat: 'Kitchen', h: 1.25, rect: [-0.4, -0.36, 0.4, 0.36], slots: [S(0, 0.74, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_soda: { name: 'Soda Fountain', cat: 'Kitchen', h: 1.5, rect: [-0.5, -0.34, 0.5, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [1, 3] })] },
  // the pizza oven, the stove and the wok (2026-10-28: an Italian's, a pizzeria's and an Asian kitchen's)
  ou_pizza_oven: { name: 'Pizza Oven', cat: 'Kitchen', h: 1.97, rect: [-0.6, -0.42, 0.6, 0.42], slots: [S(0, 0.8, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_stove: { name: 'Stove', cat: 'Kitchen', h: 1.3, rect: [-0.5, -0.36, 0.5, 0.39], slots: [S(0, 0.76, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_wok: { name: 'Wok Burner', cat: 'Kitchen', h: 1.2, rect: [-0.45, -0.36, 0.45, 0.36], slots: [S(0, 0.74, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_popcorn: { name: 'Popcorn Machine', cat: 'Kitchen', h: 1.7, rect: [-0.4, -0.34, 0.4, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [2, 5] })] },   // (the arcade's)
  // the tandoor, the rice cooker, the bamboo steamer and the ice cream freezer (2026-10-28)
  ou_tandoor: { name: 'Tandoor', cat: 'Kitchen', h: 1.1, rect: [-0.45, -0.36, 0.45, 0.36], slots: [S(0, 0.74, P, 'cook', 'cook', { dur: [2, 6] })] },
  ou_rice: { name: 'Rice Station', cat: 'Kitchen', h: 1.35, rect: [-0.4, -0.34, 0.4, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [1, 3] })] },
  ou_bamboo: { name: 'Bamboo Steamer', cat: 'Kitchen', h: 1.2, rect: [-0.45, -0.36, 0.45, 0.36], slots: [S(0, 0.74, P, 'cook', 'cook', { dur: [2, 5] })] },
  ou_freezer: { name: 'Ice Cream Freezer', cat: 'Kitchen', h: 1.15, rect: [-0.5, -0.34, 0.5, 0.35], slots: [S(0, 0.73, P, 'cook', 'cook', { dur: [1, 3] })] },
  // the bar's (2026-10-28: a lounge's or a club's kitchen pours its drinks)
  ou_taps: { name: 'Beer Taps', cat: 'Kitchen', h: 1.55, rect: [-0.5, -0.34, 0.5, 0.34], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [1, 3] })] },
  ou_wine: { name: 'Wine Fridge', cat: 'Kitchen', h: 1.3, rect: [-0.4, -0.35, 0.4, 0.36], slots: [S(0, 0.72, P, 'cook', 'cook', { dur: [1, 3] })] },
  ou_cocktail: { name: 'Cocktail Station', cat: 'Kitchen', h: 1.25, rect: [-0.6, -0.34, 0.6, 0.42], slots: [S(0, 0.78, P, 'cook', 'cook', { dur: [2, 5] })] },
  // ---------------- Retail ----------------
  shop_shelf: { name: 'Store Shelf', cat: 'Retail', h: 1.8, rect: [-1.0, -0.3, 1.0, 0.3], tint: true,
    slots: [S(-0.5, 0.7, P, 'browse', 'browse'), S(0.5, 0.7, P, 'browse', 'browse'), S(-0.5, -0.7, 0, 'browse', 'browse'), S(0.5, -0.7, 0, 'browse', 'browse')] },
  clothes_rack: { name: 'Clothes Rack', cat: 'Retail', h: 1.6, rect: [-0.8, -0.28, 0.8, 0.28], tint: true,
    slots: [S(0, 0.7, P, 'browse', 'browse'), S(0, -0.7, 0, 'browse', 'browse')] },
  // a fishing dock's store (docs/features/fishing.md): rods standing in their rack, the lure wall, the live bait, and the
  // fish market's counter with its scale (where the catch is sold: client/js/play/fish-store.js)
  rod_rack: { name: 'Rod Rack', cat: 'Retail', h: 2.3, rect: [-0.9, -0.25, 0.9, 0.25],
    slots: [S(-0.4, 0.66, P, 'browse', 'browse'), S(0.4, 0.66, P, 'browse', 'browse')] },
  lure_wall: { name: 'Lure Wall', cat: 'Retail', h: 2.0, rect: [-1.0, -0.12, 1.0, 0.12], wall: true,
    slots: [S(0, 0.72, P, 'browse', 'browse')] },
  bait_fridge: { name: 'Live Bait Fridge', cat: 'Retail', h: 1.9, rect: [-0.5, -0.36, 0.5, 0.36],
    slots: [S(0, 0.78, P, 'browse', 'browse')] },
  fish_counter: { name: 'Fish Market Counter', cat: 'Retail', h: 1.3, rect: [-1.1, -0.4, 1.1, 0.4],
    slots: [S(0.3, -0.8, 0, 'staff', 'staff', { az: -0.95 }), S(0.3, 0.8, P, 'use', 'buy', { dur: [1, 3] })] },
  checkout: { name: 'Checkout', cat: 'Retail', h: 1.2, rect: [-0.9, -0.35, 0.9, 0.35],
    slots: [S(0.2, -0.72, 0, 'staff', 'staff', { az: -0.9 }), S(0.2, 0.72, P, 'use', 'buy', { dur: [1, 3] })] },
  display: { name: 'Display Table', cat: 'Retail', h: 0.9, rect: [-0.75, -0.5, 0.75, 0.5], tint: true,
    slots: [S(0, 0.9, P, 'browse', 'browse'), S(0, -0.9, 0, 'browse', 'browse')] },
  // a shoe store (2026-10-15): a wall of sneakers on lit shelves (its colour: the wall's), and one sneaker on a plinth
  // under glass (its colour: the shoe's) — a standing sign beside it can carry its picture, price and link
  shoe_wall: { name: 'Shoe Wall', cat: 'Retail', h: 2.3, rect: [-1.0, -0.16, 1.0, 0.16], wall: true, tint: true,
    slots: [S(-0.45, 0.62, P, 'browse', 'browse'), S(0.45, 0.62, P, 'browse', 'browse')] },
  shoe_plinth: { name: 'Shoe Plinth', cat: 'Retail', h: 1.45, rect: [-0.32, -0.32, 0.32, 0.32], tint: true,
    slots: [S(0, 0.75, P, 'browse', 'browse'), S(0.75, 0, -H, 'browse', 'browse')] },
  // ---------------- Gym ----------------
  treadmill: { name: 'Treadmill', cat: 'Gym', h: 1.4, rect: [-0.45, -1.0, 0.45, 1.0],
    slots: [S(0, 0.15, P, 'run', 'run', { az: 1.45, y: 0.19, dur: [15, 35] })] },
  weights: { name: 'Dumbbell Rack', cat: 'Gym', h: 0.95, rect: [-0.8, -0.3, 0.8, 0.3],
    slots: [S(-0.45, 0.85, P, 'lift', 'lift', { prop: 'dumbbell', dur: [8, 20] }), S(0.45, 0.85, P, 'lift', 'lift', { prop: 'dumbbell', dur: [8, 20] })] },
  yoga_mat: { name: 'Yoga Mat', cat: 'Gym', h: 0.02, rect: [-0.36, -0.95, 0.36, 0.95], block: false, tint: true,
    slots: [S(0, 0, 0, 'yoga', 'yoga', { dur: [15, 35] })] },
  lockers: { name: 'Lockers', cat: 'Gym', h: 1.95, rect: [-1.0, -0.25, 1.0, 0.25], tint: true,
    slots: [S(-0.5, 0.6, P, 'use', 'locker', { dur: [1, 3] }), S(0.5, 0.6, P, 'use', 'locker', { dur: [1, 3] })] },
  // ---------------- Home ----------------
  bed_double: { name: 'Double Bed', cat: 'Home', h: 1.0, rect: [-0.85, -1.1, 0.85, 1.1], tint: true,
    slots: [S(-0.38, 0.12, 0, 'lie', 'sleep', { ax: -1.25, az: 0.4, y: 0.05 }), S(0.38, 0.12, 0, 'lie', 'sleep', { ax: 1.25, az: 0.4, y: 0.05 })] },
  bed_single: { name: 'Single Bed', cat: 'Home', h: 1.0, rect: [-0.5, -1.05, 0.5, 1.05], tint: true,
    slots: [S(0, 0.12, 0, 'lie', 'sleep', { ax: 0.95, az: 0.4, y: 0.05 })] },
  nightstand: { name: 'Nightstand', cat: 'Home', h: 1.0, rect: [-0.24, -0.22, 0.24, 0.22], slots: [] },
  wardrobe: { name: 'Wardrobe', cat: 'Home', h: 2.05, rect: [-0.65, -0.3, 0.65, 0.3], tint: true,
    slots: [S(0, 0.65, P, 'use', 'dress', { dur: [2, 5] })] },
  shower: { name: 'Shower', cat: 'Home', h: 2.1, rect: [-0.48, -0.48, 0.48, 0.48],
    slots: [S(0, -0.05, P, 'wash', 'shower', { az: 0.95, dur: [5, 12] })] },
  sink: { name: 'Vanity Sink', cat: 'Home', h: 1.9, rect: [-0.35, -0.25, 0.35, 0.25],
    slots: [S(0, 0.55, P, 'wash', 'wash', { dur: [2, 5] })] },
  toilet: { name: 'Toilet', cat: 'Home', h: 0.85, rect: [-0.2, -0.36, 0.2, 0.34], slots: [] },
  bathtub: { name: 'Bathtub', cat: 'Home', h: 2.0, rect: [-0.85, -0.38, 0.85, 0.38],   // a shower over the tub
    slots: [S(0.45, -0.02, P, 'wash', 'shower', { az: 0.75, y: 0.1, dur: [6, 14] })] },
  desk_home: { name: 'Home Desk', cat: 'Home', h: 1.1, rect: [-0.6, -0.32, 0.6, 0.85], tint: true,
    slots: [S(0, 0.55, P, 'sit_type', 'computer', { az: 1.2, dur: [20, 60] })] },
  // ---------------- Outdoor ----------------
  bench: { name: 'Bench', cat: 'Outdoor', h: 0.9, rect: [-0.95, -0.3, 0.95, 0.3],
    slots: [S(-0.5, 0.05, 0, 'sit_relax', 'bench', { az: 0.85, y: -0.03 }), S(0.5, 0.05, 0, 'sit_relax', 'bench', { az: 0.85, y: -0.03 })] },
  picnic_table: { name: 'Picnic Table', cat: 'Outdoor', h: 0.8, rect: [-0.95, -0.85, 0.95, 0.85],
    slots: [S(-0.45, 0.62, P, 'sit_eat', 'eat', { az: 1.2 }), S(0.45, 0.62, P, 'sit_eat', 'eat', { az: 1.2 }),
      S(-0.45, -0.62, 0, 'sit_eat', 'eat', { az: -1.2 }), S(0.45, -0.62, 0, 'sit_eat', 'eat', { az: -1.2 })] },
  tree: { name: 'Tree', cat: 'Outdoor', h: 6.5, rect: [-0.35, -0.35, 0.35, 0.35], tint: true, slots: [] },
  tree_pine: { name: 'Pine', cat: 'Outdoor', h: 7.5, rect: [-0.35, -0.35, 0.35, 0.35], slots: [] },
  bush: { name: 'Bush', cat: 'Outdoor', h: 1.1, rect: [-0.55, -0.55, 0.55, 0.55], tint: true, slots: [] },
  flowers: { name: 'Flower Bed', cat: 'Outdoor', h: 0.5, rect: [-1.0, -0.5, 1.0, 0.5], tint: true, slots: [] },
  fountain: { name: 'Fountain', cat: 'Outdoor', h: 2.4, rect: [-3.0, -3.0, 3.0, 3.0],
    slots: [0, H, P, -H].flatMap(a => [-1.1, 0, 1.1].map(l => {
      const c = Math.cos(a), s = Math.sin(a), rr = Math.sqrt(9.3 - l * l);
      return S(l * c + rr * s, -l * s + rr * c, a, 'sit_relax', 'bench', { ax: l * c + 3.75 * s, az: -l * s + 3.75 * c, y: -0.02 });
    })) },
  // ---------------- Marketing (outdoors only: administrators put them up in the Marketing tools; shared/signs.js) ----
  // double-faced billboards on a monopole, standard or large, the pole centred or at one end with the board overhanging
  // (the footprint is the board's; an overhanging one stands on its pole's base), and lit street signs
  billboard: { name: 'Billboard', cat: 'Marketing', outdoor: true, h: 8.8, rect: [-4.95, -1.0, 4.95, 1.0], slots: [] },
  billboard_oh: { name: 'Billboard (overhang)', cat: 'Marketing', outdoor: true, h: 8.8, rect: [-4.95, -1.0, 4.95, 1.0], slots: [] },
  billboard_xl: { name: 'Large billboard', cat: 'Marketing', outdoor: true, h: 12.4, rect: [-7.4, -1.2, 7.4, 1.2], slots: [] },
  billboard_xl_oh: { name: 'Large billboard (overhang)', cat: 'Marketing', outdoor: true, h: 12.4, rect: [-7.4, -1.2, 7.4, 1.2], slots: [] },
  street_sign: { name: 'Street sign', cat: 'Marketing', outdoor: true, h: 2.75, rect: [-0.72, -0.3, 0.72, 0.3], slots: [] },
  // ---------------- Signs (inside buildings and parks: the owner's own design, or paid ads; resizable; in styles —
  // shared/signs.js SIGN_STYLES — whose lights take the sign's colour) ----------------
  sign_stand: { name: 'Standing sign', cat: 'Signs', h: 1.55, rect: [-0.34, -0.24, 0.34, 0.24], tint: true, slots: [] },
  sign_stand_wide: { name: 'Standing sign (wide)', cat: 'Signs', h: 1.3, rect: [-0.49, -0.24, 0.49, 0.24], tint: true, slots: [] },
  sign_wall: { name: 'Wall sign', cat: 'Signs', h: 2.1, rect: [-0.64, -0.06, 0.64, 0.06], wall: true, block: false, tint: true, slots: [] },
  sign_wall_tall: { name: 'Wall sign (tall)', cat: 'Signs', h: 2.2, rect: [-0.44, -0.06, 0.44, 0.06], wall: true, block: false, tint: true, slots: [] },
  mailboxes: { name: 'Mailboxes', cat: 'Home', h: 1.5, rect: [-0.9, -0.15, 0.9, 0.15], wall: true,
    slots: [S(0, 0.62, P, 'use', 'mail', { dur: [1, 2] })] },
  dance_floor: { name: 'Dance Floor', cat: 'Fun', h: 0.1, rect: [-2.23, -2.23, 2.23, 2.23], block: false,
    slots: [[-1.2, -1.2], [0, -1.3], [1.2, -1.2], [-1.3, 0], [1.3, 0], [-1.2, 1.2], [0, 1.3], [1.2, 1.2], [0, 0]].map(([x, z], i) => S(x, z, (i * 2.4) % 6.28, 'dance', 'dance', { y: 0.09, dur: [10, 30] })) },
  // ---------------- The lounge (Floor Themes' lounge, 2026-10-23: "a fancy sit back and relax area, modern organic,
  // elegant, soft lighting ... sculptures that fit the mood ... relaxing yet social vibes ... the little stage: in the future
  // agents playing music and instruments"). Seats face the room's tables and the stage; the stage's musicians stand and sit
  // on it (y: its height), its use 'music' (residents take the stage now; agents later).
  curve_sofa: { name: 'Curved Sofa', cat: 'Lounge', h: 0.85, rect: [-1.15, -0.8, 1.15, 0.36], tint: true,
    slots: [-0.45, 0, 0.45].map(a => S(Math.sin(a) * 1.38, 1.2 - Math.cos(a) * 1.38, -a, 'sit_relax', 'relax', { ax: a > 0 ? 1.4 : -1.4, az: 0.3 })) },   // (sat on from its ends: a table is in front)
  serp_sofa: { name: 'Serpentine Sofa', cat: 'Lounge', h: 0.85, rect: [-1.95, -0.75, 1.95, 0.75], tint: true,
    slots: [S(-1.2, 0.08, 0, 'sit_talk', 'relax', { az: 0.95 }), S(-0.45, 0.2, 0, 'sit_talk', 'relax', { az: 1.0 }), S(0.45, -0.2, P, 'sit_talk', 'relax', { az: -1.0 }), S(1.2, -0.08, P, 'sit_talk', 'relax', { az: -0.95 })] },
  boucle_chair: { name: 'Bouclé Chair', cat: 'Lounge', h: 0.78, rect: [-0.48, -0.46, 0.48, 0.46], tint: true,
    slots: [S(0, 0.05, 0, 'sit_relax', 'relax', { ax: 0.3, az: -0.8 })] },   // (come to from behind: a table is often in front, a neighbour beside)
  shell_chair: { name: 'Shell Chair', cat: 'Lounge', h: 1.05, rect: [-0.46, -0.44, 0.46, 0.44], tint: true,
    slots: [S(0, 0.06, 0, 'sit_talk', 'relax', { ax: 0.72, az: 0.25 })] },
  pouf: { name: 'Round Pouf', cat: 'Lounge', h: 0.42, rect: [-0.3, -0.3, 0.3, 0.3], tint: true,
    slots: [S(0, 0, 0, 'sit_talk', 'chat', { az: 0.65, y: -0.04 })] },
  stone_table: { name: 'Stone Coffee Table', cat: 'Lounge', h: 0.4, rect: [-0.66, -0.4, 0.66, 0.4], slots: [] },
  side_lamp_table: { name: 'Side Table & Lamp', cat: 'Lounge', h: 0.95, rect: [-0.27, -0.27, 0.27, 0.27], tint: true, slots: [] },
  fire_table: { name: 'Fire Table', cat: 'Lounge', h: 0.6, rect: [-0.8, -0.45, 0.8, 0.45], slots: [] },
  organic_rug: { name: 'Organic Rug', cat: 'Lounge', h: 0.012, rect: [-2.1, -1.55, 2.1, 1.55], block: false, tint: true, slots: [] },
  chaise: { name: 'Chaise Longue', cat: 'Lounge', h: 0.8, rect: [-0.36, -0.95, 0.36, 0.85], tint: true,
    slots: [S(0, -0.2, 0, 'sit_relax', 'relax', { az: 1.15 })] },   // (sat on from its foot)
  floor_lantern: { name: 'Floor Lantern', cat: 'Lounge', h: 0.75, rect: [-0.22, -0.22, 0.22, 0.22], slots: [] },
  planter_box: { name: 'Planter Divider', cat: 'Lounge', h: 1.25, rect: [-1.0, -0.26, 1.0, 0.26], tint: true, slots: [] },
  slat_screen: { name: 'Slatted Screen', cat: 'Lounge', h: 2.1, rect: [-0.85, -0.16, 0.85, 0.16], tint: true, slots: [] },
  arc_lamp: { name: 'Arc Floor Lamp', cat: 'Lounge', h: 2.1, rect: [-0.28, -0.28, 0.28, 0.28], slots: [] },
  twist_sculpture: { name: 'Twisted Sculpture', cat: 'Lounge', h: 2.0, rect: [-0.32, -0.32, 0.32, 0.32], tint: true, slots: [] },
  stone_stack: { name: 'Stone Sculpture', cat: 'Lounge', h: 1.3, rect: [-0.36, -0.36, 0.36, 0.36], slots: [] },
  ring_sculpture: { name: 'Ring Sculpture', cat: 'Lounge', h: 1.85, rect: [-0.55, -0.3, 0.55, 0.3], tint: true, slots: [] },
  vase_set: { name: 'Ceramic Vases', cat: 'Lounge', h: 1.2, rect: [-0.42, -0.3, 0.42, 0.3], slots: [] },
  planter_palm: { name: 'Planter', cat: 'Lounge', h: 2.3, rect: [-0.45, -0.45, 0.45, 0.45], tint: true, slots: [] },
  wall_niche: { name: 'Lit Wall Niche', cat: 'Lounge', h: 2.45, rect: [-0.6, -0.26, 0.6, 0.26], wall: true, slots: [] },
  wall_slats: { name: 'Wood Slat Wall', cat: 'Lounge', h: 3.0, rect: [-1.2, -0.05, 1.2, 0.05], wall: true, block: false, tint: true, slots: [] },
  wall_sconce: { name: 'Wall Sconce', cat: 'Lounge', h: 2.0, rect: [-0.16, -0.09, 0.16, 0.09], wall: true, block: false, slots: [] },
  art_panel: { name: 'Abstract Art', cat: 'Lounge', h: 2.35, rect: [-0.9, -0.04, 0.9, 0.04], wall: true, block: false, tint: true, slots: [] },
  cove_light: { name: 'Warm Light Strip', cat: 'Lounge', h: 0.03, rect: [-1.0, -0.06, 1.0, 0.06], block: false, tint: true, slots: [] },
  lounge_bar: { name: 'Terrazzo Bar', cat: 'Lounge', h: 1.15, rect: [-1.8, -0.35, 1.8, 0.85], tint: true,
    slots: [-1.2, -0.4, 0.4, 1.2].map(x => S(x, 0.62, P, 'sit_high', 'eat', { az: 1.2, y: 0.28 })) },
  back_bar: { name: 'Back Bar', cat: 'Lounge', h: 2.6, rect: [-1.6, -0.24, 1.6, 0.24], wall: true, tint: true, slots: [] },
  lounge_stage: { name: 'Lounge Stage', cat: 'Lounge', h: 3.2, rect: [-2.2, -1.45, 2.2, 1.3], tint: true,
    slots: [S(-0.08, -0.5, -H, 'piano', 'staff', { ax: -0.08, az: 1.65, y: 0.3 }), S(SINGER.x, SINGER.z, SINGER.yaw, 'sing', 'staff', { az: 1.65, y: 0.3 }), S(BASSIST.x, BASSIST.z, BASSIST.yaw, 'bass', 'staff', { ax: 1.32, az: 1.65, y: 0.3 })] },   // (the band: musicians on shift, shared/nightlife.js; the singer at the microphone, the bassist behind the bass: shared/stage.js)
  // the lounge, redone (2026-10-23: "a bigger nicer bar ... central bars ... more variety ... tables (4 seating tables, 2
  // sitting tables), counters that extend around the bars, barstool tables ... make it more friendly, more elegant"):
  // island bars for the middle of the room, tables, high-tops, sofas, booths and banquettes, a fireplace, a bookcase
  island_bar: { name: 'Island Bar', cat: 'Lounge', h: 3.0, rect: [-4.35, -2.55, 4.35, 2.55], tint: true, slots: barSlots(1.8, 1.75) },
  round_bar: { name: 'Round Bar', cat: 'Lounge', h: 3.0, rect: [-2.3, -2.3, 2.3, 2.3], tint: true, slots: barSlots(0, 1.45) },
  table_two: { name: 'Table for Two', cat: 'Lounge', h: 0.9, rect: [-0.98, -0.42, 0.98, 0.42], tint: true,
    slots: [S(-0.62, 0, H, 'sit_eat', 'eat', { ax: -1.3, az: 0.3 }), S(0.62, 0, -H, 'sit_eat', 'eat', { ax: 1.3, az: -0.3 })] },
  table_four: { name: 'Table for Four', cat: 'Lounge', h: 0.9, rect: [-1.12, -1.12, 1.12, 1.12], tint: true,
    slots: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => S(sx * 0.6, sz * 0.6, Math.atan2(-sx, -sz), 'sit_eat', 'eat', { ax: sx * 1.42, az: sz * 1.42 })) },
  highboy: { name: 'High Table', cat: 'Lounge', h: 1.1, rect: [-0.74, -0.74, 0.74, 0.74], tint: true,
    slots: [[0, -0.52, 0], [0.45, 0.26, -2.09], [-0.45, 0.26, 2.09]].map(([x, z, a]) => S(x, z, a, 'sit_high', 'eat', { y: 0.28, ax: x * 2.0, az: z * 2.0 })) },
  loveseat: { name: 'Loveseat', cat: 'Lounge', h: 0.85, rect: [-0.88, -0.46, 0.88, 0.42], tint: true,
    slots: [S(-0.4, 0.04, 0, 'sit_talk', 'relax', { ax: -1.2, az: 0.35 }), S(0.4, 0.04, 0, 'sit_talk', 'relax', { ax: 1.2, az: 0.35 })] },   // (sat on from its ends: a table is often in front)
  sofa_lounge: { name: 'Tufted Sofa', cat: 'Lounge', h: 0.9, rect: [-1.2, -0.48, 1.2, 0.42], tint: true,
    slots: [-0.72, 0, 0.72].map(x => S(x, 0.04, 0, 'sit_relax', 'relax', { ax: x < 0 ? -1.5 : 1.5, az: 0.4 })) },
  club_chair: { name: 'Club Chair', cat: 'Lounge', h: 0.9, rect: [-0.46, -0.46, 0.46, 0.44], tint: true,
    slots: [S(0, 0.05, 0, 'sit_relax', 'relax', { ax: 0.78, az: -0.1 })] },   // (come to from beside: a table is often in front)
  booth_round: { name: 'Round Booth', cat: 'Lounge', h: 1.2, rect: [-1.58, -1.58, 1.58, 0.72], tint: true,
    slots: [-1.25, -0.5, 0.5, 1.25].map(a => S(Math.sin(P + a) * 1.18, Math.cos(P + a) * 1.18, Math.atan2(-Math.sin(P + a), -Math.cos(P + a)), 'sit_eat', 'eat', { ax: Math.abs(a) > 1 ? Math.sign(a) * -1.5 : Math.sign(a) * -0.55, az: 1.12 })) },
  banquette_table: { name: 'Banquette & Tables', cat: 'Lounge', h: 1.05, rect: [-1.3, -0.36, 1.3, 1.6], tint: true,
    slots: [S(-0.62, 0.02, 0, 'sit_eat', 'eat', { ax: -0.25, az: 1.95 }), S(0.62, 0.02, 0, 'sit_eat', 'eat', { ax: 0.25, az: 1.95 }),
      S(-0.62, 1.2, P, 'sit_eat', 'eat', { ax: -0.62, az: 1.95 }), S(0.62, 1.2, P, 'sit_eat', 'eat', { ax: 0.62, az: 1.95 })] },
  drink_ledge: { name: 'Drink Ledge', cat: 'Lounge', h: 1.1, rect: [-1.2, -0.2, 1.2, 0.68], tint: true,
    slots: [-0.78, 0, 0.78].map(x => S(x, 0.4, P, 'sit_high', 'eat', { az: 1.05, y: 0.28 })) },
  fireplace: { name: 'Fireplace', cat: 'Lounge', h: 1.85, rect: [-1.32, -0.3, 1.32, 0.3], wall: true, slots: [] },
  bookcase: { name: 'Bookcase', cat: 'Lounge', h: 2.4, rect: [-1.0, -0.2, 1.0, 0.2], wall: true, tint: true, slots: [] },
  olive_tree: { name: 'Olive Tree', cat: 'Lounge', h: 2.7, rect: [-0.45, -0.45, 0.45, 0.45], tint: true, slots: [] },
  // ---------------- The night club (Floor Themes' club, 2026-10-23: "a big DJ booth in the center, like a center stage,
  // dance floor all around ... like a lounge with tables and booths, larger tables for big parties ... a big bar ...
  // lights, lasers, speakers ... fun and really pretty to look at. Think of high end Miami beach clubs"). The DJ's place is
  // a post (the desk menu puts an agent on the decks); dancers take the floor, the stage and the podiums.
  dj_stage: { name: 'DJ Stage', cat: 'Club', h: 3.6, rect: [-2.35, -2.8, 2.35, 2.35],
    slots: [S(0, -0.14, 0, 'dj', 'staff', { y: 0.55, ax: -2.8, az: -1.5, dur: [20, 60] }), S(-1.45, 0.95, 0.4, 'dance', 'staff', { y: 0.55, ax: -2.8, az: 1.0 }), S(1.45, 0.95, -0.4, 'dance', 'staff', { y: 0.55, ax: 2.8, az: 1.0 })] },   // (come to from its sides: it may stand against a wall)
  dance_ring: { name: 'LED Dance Floor', cat: 'Club', h: 0.12, rect: [-5.9, -5.9, 5.9, 5.9], block: false, slots: danceSlots([3.1, 4.1, 5.1]) },
  dance_ring_s: { name: 'LED Dance Floor (small)', cat: 'Club', h: 0.12, rect: [-4.4, -4.4, 4.4, 4.4], block: false, slots: danceSlots([3.0, 3.8]) },
  club_bar: { name: 'Club Bar', cat: 'Club', h: 2.75, rect: [-3.4, -0.55, 3.4, 1.5], tint: true,
    slots: [...[-2.8, -2.0, -1.2, -0.4, 0.4, 1.2, 2.0, 2.8].map(x => S(x, 1.25, P, 'sit_high', 'eat', { az: 2.0, y: 0.28 })),
      S(-2.1, 0.1, 0, 'bartend', 'staff', { ax: -3.75, az: 0.1 }), S(0, 0.1, 0, 'bartend', 'staff', { ax: -3.75, az: 0.1 }), S(2.1, 0.1, 0, 'bartend', 'staff', { ax: 3.75, az: 0.1 })] },
  vip_booth: { name: 'VIP Booth', cat: 'Club', h: 1.35, rect: [-2.15, -2.15, 2.15, 0.95], tint: true,
    slots: [-1.3, -0.78, -0.26, 0.26, 0.78, 1.3].map(a => { const x = Math.sin(P + a) * 1.52, z = Math.cos(P + a) * 1.52; return S(x, z, Math.atan2(-x, -z), 'sit_eat', 'eat', { ax: Math.sign(x) * Math.min(1.4, Math.abs(x) * 0.7 + 0.3), az: 1.3 }); }) },
  party_table: { name: 'Party Table', cat: 'Club', h: 1.2, rect: [-1.7, -1.2, 1.7, 1.2], tint: true,
    slots: [-1.05, -0.35, 0.35, 1.05].flatMap(x => [S(x, 0.85, P, 'sit_eat', 'eat', { az: 1.55 }), S(x, -0.85, 0, 'sit_eat', 'eat', { az: -1.55 })]) },
  speaker_stack: { name: 'Speaker Stack', cat: 'Club', h: 2.6, rect: [-0.48, -0.42, 0.48, 0.42], slots: [] },
  light_tower: { name: 'Light Tower', cat: 'Club', h: 3.0, rect: [-0.5, -0.35, 0.5, 0.35], slots: [] },
  laser_bar: { name: 'Laser Bar', cat: 'Club', h: 2.7, rect: [-0.6, -0.12, 0.6, 0.12], wall: true, block: false, slots: [] },
  led_wall: { name: 'LED Video Wall', cat: 'Club', h: 3.0, rect: [-2.5, -0.1, 2.5, 0.1], wall: true, block: false, slots: [] },
  go_go_podium: { name: 'Go-Go Podium', cat: 'Club', h: 0.95, rect: [-0.6, -0.6, 0.6, 0.6], slots: [S(0, 0, 0, 'dance', 'staff', { y: 0.9, az: 1.0 })] },   // (a club dancer's place)
  neon_palm: { name: 'Neon Palm (MIAMI)', cat: 'Club', h: 2.9, rect: [-0.9, -0.08, 0.9, 0.08], wall: true, block: false, slots: [] },
  neon_vip: { name: 'Neon VIP', cat: 'Club', h: 2.5, rect: [-0.8, -0.08, 0.8, 0.08], wall: true, block: false, slots: [] },
  royal_palm: { name: 'Royal Palm', cat: 'Club', h: 3.6, rect: [-0.5, -0.5, 0.5, 0.5], slots: [] },
  velvet_rope: { name: 'Velvet Rope', cat: 'Club', h: 1.0, rect: [-0.95, -0.15, 0.95, 0.15], tint: true, slots: [] },
  // ---------------- The radio studio (an interior module: shared/radio-studio.js; 2026-10-27: "where are the mics, the control
  // boards, the big table ... dj area, vinyl records ... a nice real studio for broadcasting music"; render/furniture-studio.js).
  // The hosts' places at the broadcast desk and the DJ's at the booth are posts (the desk menu puts an agent there).
  broadcast_desk: { name: 'Broadcast Desk', cat: 'Studio', h: 1.3, rect: [-1.6, -0.6, 1.6, 1.15], seatPosts: true,   // (seatPosts: each seat its own post, its own ⋯: ui/post-menu.js)
    slots: [-1.05, 0, 1.05].map(x => S(x, 0.85, P, 'sit', 'staff', { y: 0.05, az: 1.45, prop: 'headphones' })) },   // (its hosts wear headphones, as on the air)   // (sat at the mic; talking while their line is on air: render/agents.js)
  studio_dj: { name: 'Studio DJ Booth', cat: 'Studio', h: 1.3, rect: [-1.2, -0.5, 1.2, 0.5], slots: [S(0, 0.78, P, 'dj', 'staff', { az: 1.2 })] },
  guest_table: { name: 'Guest Table', cat: 'Studio', h: 1.25, rect: [-0.65, -1.27, 0.65, 1.27],   // (its two chairs within, their bases' spokes too)
    slots: [S(0, 0.95, P, 'sit_talk', 'chat', { az: 1.3 }), S(0, -0.95, 0, 'sit_talk', 'chat', { az: -1.3 })] },
  gear_rack: { name: 'Gear Rack', cat: 'Studio', h: 1.8, rect: [-0.28, -0.32, 0.28, 0.32], slots: [] },
  vinyl_wall: { name: 'Vinyl Wall', cat: 'Studio', h: 2.45, rect: [-1.22, -0.15, 1.22, 0.15], wall: true, slots: [] },
  acoustic_wall: { name: 'Acoustic Panels', cat: 'Studio', h: 2.62, rect: [-1.2, -0.07, 1.2, 0.08], wall: true, block: false, slots: [] },
  on_air_sign: { name: 'ON AIR Sign', cat: 'Studio', h: 2.6, rect: [-0.5, -0.06, 0.5, 0.04], wall: true, block: false, slots: [] },
  studio_clock: { name: 'Studio Clock', cat: 'Studio', h: 2.2, rect: [-0.28, -0.04, 0.28, 0.03], wall: true, block: false, slots: [] },
  studio_monitors: { name: 'Studio Monitors', cat: 'Studio', h: 1.45, rect: [-0.8, -0.2, 0.8, 0.2], slots: [] },
  record_crate: { name: 'Record Crate', cat: 'Studio', h: 0.35, rect: [-0.33, -0.23, 0.33, 0.23], slots: [] },
  // ---------------- Arcade (Floor Themes' arcade, 2026-10-23: "unique furniture items, more arcade games ... billiards,
  // maybe bowling, maybe riding one of those mechanical bulls ... look and feel fun"). The games are played by residents
  // (use 'play'; the dance machine 'dance'): their own games come later. Neon signs and murals hang on walls above the
  // pieces in front of them (block: false); floor strips glow in their tint.
  pool_table: { name: 'Billiards Table', cat: 'Arcade', h: 2.3, rect: [-0.85, -1.45, 0.85, 1.45], tint: true,
    slots: [S(0, 1.75, P, 'pool', 'play', { dur: [15, 40] }), S(0, -1.75, 0, 'pool', 'play', { dur: [15, 40] }), S(1.15, 0.4, -H, 'pool', 'play', { dur: [10, 30] })] },   // (each machine its own clip: shared/arcade-motion.js; close enough to reach its controls)
  bowling_lane: { name: 'Mini Bowling Lane', cat: 'Arcade', h: 1.7, rect: [-0.75, -3.4, 0.75, 3.4], tint: true,
    slots: [S(0, 3.75, P, 'play', 'play', { dur: [15, 40] })] },
  mech_bull: { name: 'Mechanical Bull', cat: 'Arcade', h: 1.75, rect: [-1.65, -1.65, 1.65, 1.65],
    slots: [S(0, -0.1, 0, 'sit_high', 'play', { az: 2.05, y: 0.55, dur: [4, 10] })] },
  air_hockey: { name: 'Air Hockey', cat: 'Arcade', h: 1.2, rect: [-0.72, -1.25, 0.72, 1.25], tint: true,
    slots: [S(0, 1.5, P, 'hockey', 'play', { dur: [8, 20] }), S(0, -1.5, 0, 'hockey', 'play', { dur: [8, 20] })] },
  claw_machine: { name: 'Claw Machine', cat: 'Arcade', h: 2.05, rect: [-0.48, -0.48, 0.48, 0.48], tint: true,
    slots: [S(0, 0.75, P, 'claw', 'play', { dur: [5, 12] })] },
  skeeball: { name: 'Skee-Ball', cat: 'Arcade', h: 2.05, rect: [-0.42, -1.55, 0.42, 1.55], tint: true,
    slots: [S(0, 1.95, P, 'play', 'play', { dur: [8, 18] })] },
  hoop_shot: { name: 'Basketball Hoops', cat: 'Arcade', h: 2.6, rect: [-0.6, -1.35, 0.6, 1.35], tint: true,
    slots: [S(0, 1.75, P, 'play', 'play', { dur: [8, 18] })] },
  pinball: { name: 'Pinball Machine', cat: 'Arcade', h: 1.95, rect: [-0.38, -0.68, 0.38, 0.68], tint: true,
    slots: [S(0, 0.88, P, 'pinball', 'play', { dur: [8, 20] })] },
  racing_sim: { name: 'Racing Cabinet', cat: 'Arcade', h: 1.85, rect: [-0.55, -0.95, 0.55, 0.95], tint: true,
    slots: [S(0, 0.42, P, 'drive', 'play', { az: 1.3, dur: [8, 20] })] },
  dance_machine: { name: 'Dance Machine', cat: 'Arcade', h: 2.4, rect: [-1.0, -1.0, 1.0, 1.0], tint: true,
    slots: [S(-0.45, 0.4, P, 'dance', 'dance', { az: 1.4, dur: [10, 25] }), S(0.45, 0.4, P, 'dance', 'dance', { az: 1.4, dur: [10, 25] })] },
  whack_mole: { name: 'Whack-a-Mole', cat: 'Arcade', h: 1.65, rect: [-0.5, -0.55, 0.5, 0.55], tint: true,
    slots: [S(0, 0.85, P, 'whack', 'play', { dur: [5, 12] })] },
  boxer: { name: 'Punching Machine', cat: 'Arcade', h: 2.2, rect: [-0.42, -0.42, 0.42, 0.42], tint: true,
    slots: [S(0, 0.8, P, 'punch', 'play', { dur: [3, 8] })] },
  foosball: { name: 'Foosball Table', cat: 'Arcade', h: 1.1, rect: [-0.62, -0.72, 0.62, 0.72], tint: true,
    slots: [S(0.88, 0, -H, 'foos', 'play', { dur: [8, 20] }), S(-0.88, 0, H, 'foos', 'play', { dur: [8, 20] })] },
  photo_booth: { name: 'Photo Booth', cat: 'Arcade', h: 2.3, rect: [-0.65, -0.6, 0.65, 0.6], tint: true,
    slots: [S(0, 0.95, P, 'use', 'play', { dur: [2, 5] })] },
  prize_case: { name: 'Prize Case', cat: 'Arcade', h: 1.1, rect: [-0.75, -0.32, 0.75, 0.32], tint: true,
    slots: [S(0, 0.75, P, 'browse', 'browse', { dur: [2, 6] })] },
  prize_wall: { name: 'Prize Wall', cat: 'Arcade', h: 2.4, rect: [-1.2, -0.22, 1.2, 0.22], tint: true, wall: true,
    slots: [S(0, 0.7, P, 'browse', 'browse', { dur: [2, 6] })] },
  token_machine: { name: 'Token Machine', cat: 'Arcade', h: 1.85, rect: [-0.34, -0.28, 0.34, 0.28], tint: true, wall: true,
    slots: [S(0, 0.7, P, 'use', 'buy', { dur: [1, 2] })] },
  snack_bar: { name: 'Snack Bar', cat: 'Arcade', h: 2.4, rect: [-1.6, -0.6, 1.6, 0.6], tint: true, wall: true,
    slots: [S(-0.7, 1.0, P, 'talk', 'snack', { dur: [1, 3] }), S(0.7, 1.0, P, 'talk', 'snack', { dur: [1, 3] })] },
  neon_booth: { name: 'Neon Booth', cat: 'Arcade', h: 1.2, rect: [-1.15, -0.85, 1.15, 0.85], tint: true,
    slots: [S(0, -0.42, 0, 'sit_eat', 'eat', { az: 1.25 }), S(-0.78, 0.1, H, 'sit_relax', 'relax', { az: 1.25, ax: -0.3 }), S(0.78, 0.1, -H, 'sit_relax', 'relax', { az: 1.25, ax: 0.3 })] },
  hightop_table: { name: 'High-Top Table', cat: 'Arcade', h: 1.1, rect: [-0.72, -0.72, 0.72, 0.72], tint: true,
    slots: [[0, -0.52, 0], [0.45, 0.26, -2.09], [-0.45, 0.26, 2.09]].map(([x, z, a]) => S(x, z, a, 'sit_high', 'eat', { y: 0.28, ax: x * 1.9, az: z * 1.9 })) },
  gaming_chair: { name: 'Gaming Chair', cat: 'Arcade', h: 1.35, rect: [-0.36, -0.36, 0.36, 0.36], tint: true,
    slots: [S(0, 0.04, 0, 'sit_relax', 'relax', { az: 0.75 })] },
  giant_joystick: { name: 'Giant Joystick', cat: 'Arcade', h: 2.4, rect: [-0.75, -0.75, 0.75, 0.75], tint: true, slots: [] },
  led_pillar: { name: 'LED Pillar', cat: 'Arcade', h: 2.8, rect: [-0.24, -0.24, 0.24, 0.24], slots: [] },
  floor_neon: { name: 'Floor Light Strip', cat: 'Arcade', h: 0.02, rect: [-1.0, -0.05, 1.0, 0.05], block: false, tint: true, slots: [] },
  neon_arcade: { name: 'Neon Sign: ARCADE', cat: 'Arcade', h: 2.95, rect: [-1.35, -0.06, 1.35, 0.06], wall: true, block: false, slots: [] },
  neon_gameon: { name: 'Neon Sign: GAME ON', cat: 'Arcade', h: 2.9, rect: [-1.3, -0.06, 1.3, 0.06], wall: true, block: false, slots: [] },
  neon_prizes: { name: 'Neon Sign: PRIZES', cat: 'Arcade', h: 2.85, rect: [-1.1, -0.06, 1.1, 0.06], wall: true, block: false, slots: [] },
  neon_snacks: { name: 'Neon Sign: SNACKS', cat: 'Arcade', h: 2.85, rect: [-1.1, -0.06, 1.1, 0.06], wall: true, block: false, slots: [] },
  neon_joystick: { name: 'Neon Sign: Joystick', cat: 'Arcade', h: 2.95, rect: [-0.55, -0.06, 0.55, 0.06], wall: true, block: false, slots: [] },
  neon_invader: { name: 'Neon Sign: Invader', cat: 'Arcade', h: 2.9, rect: [-0.6, -0.06, 0.6, 0.06], wall: true, block: false, slots: [] },
  pixel_mural: { name: 'Pixel Mural: Space', cat: 'Arcade', h: 2.95, rect: [-1.25, -0.04, 1.25, 0.04], wall: true, block: false, slots: [] },
  pixel_mural_maze: { name: 'Pixel Mural: Maze', cat: 'Arcade', h: 2.95, rect: [-1.25, -0.04, 1.25, 0.04], wall: true, block: false, slots: [] },
  // ---------------- Structure ----------------
  elevator: { name: 'Elevator Core', cat: 'Structure', h: 3.3, rect: [-2.5, -1.45, 2.5, 1.45], fixed: true,
    doors: [[-1.25, 1.45], [1.25, 1.45]], slots: [] },
  elevator_s: { name: 'Elevator', cat: 'Structure', h: 3.3, rect: [-1.3, -1.25, 1.3, 1.25], fixed: true,
    doors: [[0, 1.25]], slots: [] },
  door: { name: 'Door', cat: 'Structure', h: 2.2, rect: [-0.6, -0.06, 0.6, 0.06], block: false, slots: [] },
  // the airport's terminal (server/world/layouts.js terminalFloor): a departures board, a security scanner, a baggage belt
  flight_board: { name: 'Departures Board', cat: 'Decor', h: 2.7, rect: [-1.6, -0.1, 1.6, 0.1], wall: true,
    slots: [S(0, 1.3, P, 'use', 'departures', { dur: [2, 5] })] },
  security_arch: { name: 'Security Scanner', cat: 'Structure', h: 2.25, rect: [-0.62, -0.32, 0.62, 0.32], block: false, slots: [] },
  baggage_belt: { name: 'Baggage Belt', cat: 'Structure', h: 0.62, rect: [-2.6, -1.05, 2.6, 1.05],
    slots: [S(-1.2, 1.55, P, 'use', 'luggage', { dur: [3, 8] }), S(1.2, 1.55, P, 'use', 'luggage', { dur: [3, 8] }), S(0, -1.55, 0, 'use', 'luggage', { dur: [3, 8] })] },
  reception: { name: 'Reception Desk', cat: 'Office', h: 1.15, rect: [-1.5, -0.45, 1.5, 0.45], tint: true,
    slots: [S(0, -0.85, 0, 'sit_type', 'staff', { az: -1.35, y: 0 }), S(-0.8, 0.8, P, 'talk', 'reception', { az: 1.05, dur: [1, 3] })] },
};

// Activities: label + icon shown in the UI, and how needs change per world hour spent (or per use when `once`).
export const USES = {
  work: { label: 'Working', icon: '💻', rate: { fun: -0.04, energy: -0.03 } },
  meeting: { label: 'In a meeting', icon: '🗣️', rate: { social: 0.25, fun: -0.02 } },
  present: { label: 'Presenting', icon: '📊', rate: { social: 0.3 } },
  print: { label: 'Printing', icon: '🖨️', rate: {} },
  file: { label: 'Filing', icon: '🗂️', rate: {} },
  browse: { label: 'Browsing', icon: '🛍️', rate: { fun: 0.35 } },
  call: { label: 'On a call', icon: '📞', rate: { social: 0.3 } },
  relax: { label: 'Relaxing', icon: '🛋️', rate: { fun: 0.3, energy: 0.12 } },
  tv: { label: 'Watching TV', icon: '📺', rate: { fun: 0.45, energy: 0.08 } },
  pingpong: { label: 'Playing ping-pong', icon: '🏓', rate: { fun: 0.9, social: 0.4, energy: -0.1 } },
  play: { label: 'Playing arcade', icon: '🕹️', rate: { fun: 0.9 } },
  music: { label: 'Playing piano', icon: '🎹', rate: { fun: 0.8 } },
  wash: { label: 'Washing up', icon: '🧼', once: { hygiene: 0.35 } },
  cook: { label: 'Cooking', icon: '🍳', rate: { fun: 0.1 } },
  prep: { label: 'Preparing food', icon: '🥪', rate: {} },
  fridge: { label: 'Checking the fridge', icon: '🧊', once: { hunger: 0.08 } },
  coffee: { label: 'Getting coffee', icon: '☕', once: { energy: 0.22 } },
  water: { label: 'Water break', icon: '💧', once: { energy: 0.05 }, rate: { social: 0.4 } },
  snack: { label: 'Grabbing a snack', icon: '🍫', once: { hunger: 0.15 } },
  eat: { label: 'Eating', icon: '🍽️', rate: { hunger: 2.2, social: 0.35 } },
  staff: { label: 'On shift', icon: '🧑‍🍳', rate: { fun: -0.03 } },
  order: { label: 'Ordering', icon: '🧾', rate: {} },
  buy: { label: 'Paying', icon: '💳', rate: { fun: 0.1 } },
  run: { label: 'Running', icon: '🏃', rate: { fun: 0.4, energy: -0.25, hygiene: -0.2 } },
  mail: { label: 'Checking mail', icon: '📬', rate: {} },
  lift: { label: 'Lifting', icon: '🏋️', rate: { fun: 0.35, energy: -0.2, hygiene: -0.2 } },
  yoga: { label: 'Yoga', icon: '🧘', rate: { fun: 0.3, energy: 0.1 } },
  locker: { label: 'At the lockers', icon: '🔒', rate: {} },
  sleep: { label: 'Sleeping', icon: '😴', rate: { energy: 0.16, hunger: 0.03 } },
  nap: { label: 'Napping', icon: '💤', rate: { energy: 0.2 } },
  dress: { label: 'Getting dressed', icon: '👔', rate: {} },
  shower: { label: 'Showering', icon: '🚿', once: { hygiene: 0.9 } },
  computer: { label: 'On the computer', icon: '🖥️', rate: { fun: 0.3 } },
  bench: { label: 'Resting on a bench', icon: '🌳', rate: { fun: 0.2, energy: 0.1 } },
  reception: { label: 'At reception', icon: '🛎️', rate: {} },
  departures: { label: 'Checking the departures', icon: '🛫', rate: { fun: 0.1 } },
  luggage: { label: 'Waiting for luggage', icon: '🧳', rate: {} },
  chat: { label: 'Chatting', icon: '💬', rate: { social: 0.9, fun: 0.2 } },
  walk: { label: 'Walking', icon: '🚶', rate: {} },
  jog: { label: 'Jogging', icon: '🏃', rate: { fun: 0.35, energy: -0.2, hygiene: -0.2 } },
  commute: { label: 'Commuting', icon: '🚇', rate: {} },
  wait: { label: 'Waiting', icon: '⏳', rate: {} },
  wander: { label: 'Strolling', icon: '🚶', rate: { fun: 0.2 } },
  greet: { label: 'Talking with you', icon: '👋', rate: { social: 0.6 } },
  dance: { label: 'Dancing', icon: '💃', rate: { fun: 0.9, social: 0.3 } },
  phone: { label: 'On the phone', icon: '📱', rate: { social: 0.3 } },
  idle: { label: 'Idle', icon: '•', rate: {} },
  cafe: { label: 'Having a coffee', icon: '☕', rate: { social: 0.35, fun: 0.25, energy: 0.1 } },
  read: { label: 'Reading', icon: '📖', rate: { fun: 0.35, energy: 0.05 } },
  bar: { label: 'At the bar', icon: '🍸', rate: { social: 0.6, fun: 0.45, hunger: 0.3 } },
  picnic: { label: 'Having a picnic', icon: '🧺', rate: { social: 0.4, fun: 0.3, hunger: 0.9 } },
  // an AI agent working on something its owner asked (a message, a scheduled job), wherever it is (server/sim/agents.js taskDo)
  task: { label: 'Working on a task', icon: '💻', rate: { fun: -0.03, energy: -0.02 } },
  task_phone: { label: 'On a task, by phone', icon: '📱', rate: { fun: -0.02, energy: -0.01 } },
  // nights out (shared/nightlife.js; appended: a use's number is its place in this list)
  vip: { label: 'In a VIP booth', icon: '🍾', rate: { social: 0.8, fun: 0.6, hunger: 0.2 } },
  bartend: { label: 'Mixing drinks', icon: '🍸', rate: { fun: -0.01 } },
  dj: { label: 'DJing', icon: '🎧', rate: { fun: 0.2 } },
  perform: { label: 'Playing music', icon: '🎹', rate: { fun: 0.2 } },
  gogo: { label: 'Dancing on stage', icon: '💃', rate: { fun: 0.1 } },
};

export const USE_LIST = Object.keys(USES);
export const USE_ID = Object.freeze(Object.fromEntries(USE_LIST.map((k, i) => [k, i])));
export const TYPE_LIST = Object.keys(CATALOG);
export function slotAnim(def, i) { return def.slots[i]?.anim || 'idle'; }
/** A counter, a checkout or a reception desk: a piece with a serving side (a 'staff' slot), where its owner puts an AI agent
 *  on post right from the piece itself (client/js/ui/post-menu.js, server/agent-posts/posts.js here). */
export const isServiceDesk = t => !!CATALOG[t]?.slots?.some(s => s.use === 'staff');
export function itemDims(type) {
  const d = CATALOG[type]; if (!d) return { w: 1, d: 1 };
  return { w: d.rect[2] - d.rect[0], d: d.rect[3] - d.rect[1] };
}
export const CATEGORIES = ['Office', 'Lounge', 'Café', 'Kitchen', 'Retail', 'Gym', 'Home', 'Fun', 'Arcade', 'Club', 'Decor', 'Signs', 'Outdoor', 'Structure'];

/** Floor finish presets used by zones. */
export const FINISHES = {
  carpet: { color: '#7d8796', pattern: 1, name: 'Carpet' },
  carpet_blue: { color: '#566b8c', pattern: 1, name: 'Blue carpet' },
  carpet_warm: { color: '#9a7d6c', pattern: 1, name: 'Warm carpet' },
  wood: { color: '#b8875a', pattern: 2, name: 'Oak planks' },
  wood_dark: { color: '#7a5237', pattern: 2, name: 'Walnut planks' },
  tile: { color: '#d9d6cf', pattern: 3, name: 'Tile' },
  tile_dark: { color: '#5b616b', pattern: 3, name: 'Slate tile' },
  marble: { color: '#e8e4dc', pattern: 4, name: 'Marble' },
  concrete: { color: '#a9a8a3', pattern: 5, name: 'Polished concrete' },
  rubber: { color: '#3d4148', pattern: 5, name: 'Gym rubber' },
  terrazzo: { color: '#d4cbbd', pattern: 4, name: 'Terrazzo' },
  grass: { color: '#6d9a4c', pattern: 6, name: 'Lawn' },
  paving: { color: '#c2b8a6', pattern: 3, name: 'Paving' },
  carpet_arcade: { color: '#191733', pattern: 7, name: 'Arcade carpet' },
  club_marble: { color: '#26252c', pattern: 4, name: 'Black marble' },
  vip_carpet: { color: '#3b1d2c', pattern: 1, name: 'VIP carpet' },
  travertine: { color: '#dccfb9', pattern: 4, name: 'Travertine' },
  pale_oak: { color: '#d6bd98', pattern: 2, name: 'Pale oak' },   // (Floor Themes' café: the Nordic roastery)
  terracotta: { color: '#b8694a', pattern: 3, name: 'Terracotta' },   // (the garden café)
  cream_tile: { color: '#ece4d4', pattern: 3, name: 'Cream tile' },   // (the bistro)   // (warm stone: Floor Themes' lounge)
  smoked_oak: { color: '#7a5c45', pattern: 2, name: 'Smoked oak' },
  warm_concrete: { color: '#968a7d', pattern: 5, name: 'Warm concrete' },   // (dark, with neon rings, dots and stars: Floor Themes' arcade)
};
export const FINISH_IDS = Object.keys(FINISHES);
