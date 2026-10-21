// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Furniture / object catalog shared by the server (placement, nav, activities) and the client (geometry, editing).
// Item-local frame: +z = the item's front (the side a user approaches), yaw 0 faces +z, yaw PI faces -z.
// rect = blocking rectangle [x0, z0, x1, z1] (item-local). block:false => walkable decor (rugs, mats).
// Slots: x,z (+y offset from the standard pose height), yaw (facing, item-local), anim clip, use tag,
// ax/az approach point (defaults to the slot itself), prop held while using, dur [min,max] world minutes.
const P = Math.PI, H = Math.PI / 2;
function S(x, z, yaw, anim, use, o = {}) { return { x, z, yaw, anim, use, ...o }; }

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
  arcade: { name: 'Arcade Cabinet', cat: 'Fun', h: 1.8, rect: [-0.4, -0.4, 0.4, 0.4], tint: true,
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
  dance_floor: { name: 'Dance Floor', cat: 'Fun', h: 0.03, rect: [-2.2, -2.2, 2.2, 2.2], block: false,
    slots: [[-1.2, -1.2], [0, -1.3], [1.2, -1.2], [-1.3, 0], [1.3, 0], [-1.2, 1.2], [0, 1.3], [1.2, 1.2], [0, 0]].map(([x, z], i) => S(x, z, (i * 2.4) % 6.28, 'dance', 'dance', { dur: [10, 30] })) },
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
};

export const USE_LIST = Object.keys(USES);
export const USE_ID = Object.freeze(Object.fromEntries(USE_LIST.map((k, i) => [k, i])));
export const TYPE_LIST = Object.keys(CATALOG);
export function slotAnim(def, i) { return def.slots[i]?.anim || 'idle'; }
export function itemDims(type) {
  const d = CATALOG[type]; if (!d) return { w: 1, d: 1 };
  return { w: d.rect[2] - d.rect[0], d: d.rect[3] - d.rect[1] };
}
export const CATEGORIES = ['Office', 'Lounge', 'Kitchen', 'Retail', 'Gym', 'Home', 'Fun', 'Decor', 'Signs', 'Outdoor', 'Structure'];

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
};
export const FINISH_IDS = Object.keys(FINISHES);
