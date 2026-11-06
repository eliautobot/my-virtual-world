// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What every placeable thing is, for the rules that put things on tables and shelves (PLAN-SURFACES.md section 2):
//   size   floor (stands on the floor, the default) | surface (only on a table, a counter or a shelf) | wall | hang (from
//          the ceiling) | flat (walked over);  onOk: a floor piece that may also stand on a surface (a table lamp, a vase)
//   tags   goods tags (GOODS_TAGS), what it is: 1-3 for goods and small decor, none for plain furniture
//   sub    its sub-group in the Furnish panel's category
// The goods (shared/goods-items.js) carry theirs in the generated list (shared/goods-catalog.js); MVW's own pieces get
// theirs from the tables below, the Amazon library's from its kinds (shared/abo-kinds.js). shared/catalog.js applies them.

/** Goods tags. Index-coded in shared/goods-catalog.js: appended, never reordered. ('book' is MVW's drawn books only.) */
export const GOODS_TAGS = ['desk-item', 'cable', 'office-supply', 'electronics', 'mug', 'tableware', 'cookware', 'kitchen',
  'food-pack', 'drink', 'beauty', 'pharmacy', 'household', 'bath', 'tool', 'shoe', 'bag', 'clothing', 'toy', 'game', 'media',
  'book', 'decor', 'plant', 'lamp', 'candle', 'storage-box', 'pet', 'baby', 'sport'];
/** The Goods category's sub-groups (chips). Index-coded in shared/goods-catalog.js: appended, never reordered. */
export const GOODS_SUBS = ['Desk & office', 'Electronics', 'Kitchen & tableware', 'Food & drink', 'Health & beauty', 'Shoes',
  'Bags & clothing', 'Toys', 'Games & media', 'Home', 'Pets & baby', 'Sport'];
/** The sub-group a goods item of first tag t is listed in. */
export const SUB_OF_TAG = {
  'desk-item': 'Desk & office', cable: 'Desk & office', 'office-supply': 'Desk & office', electronics: 'Electronics',
  mug: 'Kitchen & tableware', tableware: 'Kitchen & tableware', cookware: 'Kitchen & tableware', kitchen: 'Kitchen & tableware',
  'food-pack': 'Food & drink', drink: 'Food & drink', beauty: 'Health & beauty', pharmacy: 'Health & beauty', household: 'Home',
  bath: 'Home', tool: 'Home', shoe: 'Shoes', bag: 'Bags & clothing', clothing: 'Bags & clothing', toy: 'Toys', game: 'Games & media',
  media: 'Games & media', book: 'Games & media', decor: 'Home', plant: 'Home', lamp: 'Home', candle: 'Home', 'storage-box': 'Home',
  pet: 'Pets & baby', baby: 'Pets & baby', sport: 'Sport',
};
/** Goods flags (the last field of a row): f also stands on the floor; y has a front (rows face +z: a box's printed face, a
 *  shoe's toe); r no front (round: any turn looks right); x franchise or branded-character art (kept out of the rules that
 *  dress rooms by themselves; placed by hand only). */
export const GOODS_FLAGS = { f: 'floor', y: 'front', r: 'round', x: 'franchise' };

export const SIZES = ['floor', 'surface', 'wall', 'hang', 'flat'];

// ------------------------------------------------------------------ MVW's own pieces
/** Sub-groups of MVW's own pieces, by category: every type listed once (tests/goods-catalog.test.mjs). */
export const NATIVE_SUB = {
  Office: { Desks: 'desk desk_l desk_exec standing_desk reception', Meeting: 'meeting_table', Storage: 'bookshelf filing server_rack',
    Tech: 'printer tv_wall whiteboard', Booths: 'phone_booth' },
  Lounge: { Sofas: 'sofa sofa_l curve_sofa serp_sofa loveseat sofa_lounge chaise banquette_table booth_round',
    Armchairs: 'armchair boucle_chair shell_chair club_chair beanbag pouf', Tables: 'coffee_table stone_table side_lamp_table fire_table table_two table_four highboy',
    Rugs: 'rug organic_rug', Lighting: 'floor_lantern arc_lamp wall_sconce cove_light',
    Decor: 'twist_sculpture stone_stack ring_sculpture vase_set art_panel slat_screen wall_niche wall_slats fireplace bookcase',
    Plants: 'planter_box planter_palm olive_tree', Bars: 'lounge_bar back_bar island_bar round_bar drink_ledge', Stage: 'lounge_stage', TV: 'tv_stand' },
  Decor: { Plants: 'plant plant_tall', Lighting: 'floor_lamp', Screens: 'flight_board' },
  Fun: { Games: 'pingpong', Music: 'piano', Dance: 'dance_floor' },
  Arcade: { Machines: 'arcade claw_machine skeeball hoop_shot pinball racing_sim dance_machine whack_mole boxer photo_booth mech_bull giant_joystick',
    Tables: 'pool_table air_hockey foosball hightop_table', Lanes: 'bowling_lane', Prizes: 'prize_case prize_wall token_machine snack_bar',
    Seating: 'gaming_chair neon_booth', Neon: 'led_pillar floor_neon neon_arcade neon_gameon neon_prizes neon_snacks neon_joystick neon_invader pixel_mural pixel_mural_maze' },
  Kitchen: { Kitchens: 'kitchen counter', Appliances: 'fridge coffee_machine water_cooler vending', Tables: 'dining_table cafe_table cafe_table4',
    Counters: 'bar_counter cafe_counter',
    Stations: 'ou_fridge ou_pantry ou_prep ou_grinder ou_espresso ou_steamer ou_oven ou_press ou_blender ou_plating ou_pass ou_dishes ou_sink ou_bin ou_extinguisher ou_rail ou_kettle ou_toaster ou_juicer ou_griddle ou_grill ou_fryer ou_soda ou_pizza_oven ou_stove ou_wok ou_popcorn ou_tandoor ou_rice ou_bamboo ou_freezer ou_taps ou_wine ou_cocktail' },
  Café: { Counters: 'counter_bistro counter_nordic counter_loft counter_library counter_garden pastry_vitrine condiment_bar zinc_bar cold_brew_tower coffee_roaster',
    Tables: 'bistro_set rattan_set communal_table window_ledge library_table', Seating: 'cafe_booth wingback_set banquette_long',
    Shelves: 'library_wall pipe_shelf bookshelf_divider newspaper_rack bean_sacks',
    Decor: 'hearth fountain_tiered gilt_mirror menu_board coat_stand globe_stand poster_frame slat_wall mesh_partition neon_coffee chalk_wall birdcage stone_urn cafe_rug',
    Lighting: 'edison_pendants cafe_sconce paper_pendant', Plants: 'cafe_palm hanging_ivy plant_wall hedge_planter flower_bed vine_trellis' },
  Retail: { Shelves: 'shop_shelf display shoe_wall shoe_plinth', Clothes: 'clothes_rack', Tackle: 'rod_rack lure_wall bait_fridge fish_counter', Checkout: 'checkout' },
  Gym: { Equipment: 'treadmill weights yoga_mat', Lockers: 'lockers' },
  Home: { Beds: 'bed_double bed_single', Bedroom: 'nightstand wardrobe', Bathroom: 'shower sink toilet bathtub', Desks: 'desk_home', Hall: 'mailboxes' },
  Outdoor: { Seating: 'bench picnic_table', Trees: 'tree tree_pine bush', Garden: 'flowers fountain' },
  Marketing: { Billboards: 'billboard billboard_oh billboard_xl billboard_xl_oh', Signs: 'street_sign' },
  Signs: { Stands: 'sign_stand sign_stand_wide', Wall: 'sign_wall sign_wall_tall' },
  Club: { Stage: 'dj_stage go_go_podium speaker_stack light_tower', Dance: 'dance_ring dance_ring_s', Bars: 'club_bar party_table', VIP: 'vip_booth velvet_rope',
    Neon: 'laser_bar led_wall neon_palm neon_vip', Plants: 'royal_palm' },
  Studio: { Desks: 'broadcast_desk studio_dj guest_table', Gear: 'gear_rack studio_monitors record_crate', Walls: 'vinyl_wall acoustic_wall on_air_sign studio_clock' },
  Structure: { Lifts: 'elevator elevator_s', Doors: 'door', Airport: 'security_arch baggage_belt' },
};
/** Goods tags of MVW's own pieces that are (or carry) such things: what a floor already has, for the dressing rules. */
export const NATIVE_TAGS = {
  plant: 'plant plant_tall planter_box planter_palm olive_tree cafe_palm hanging_ivy plant_wall hedge_planter flower_bed vine_trellis royal_palm tree tree_pine bush flowers stone_urn',
  lamp: 'floor_lamp arc_lamp floor_lantern side_lamp_table wall_sconce cafe_sconce edison_pendants paper_pendant',
  decor: 'twist_sculpture stone_stack ring_sculpture vase_set art_panel poster_frame gilt_mirror globe_stand birdcage fountain_tiered wall_niche',
  book: 'bookshelf bookcase library_wall bookshelf_divider newspaper_rack', electronics: 'tv_wall printer server_rack studio_monitors tv_stand',
  sport: 'weights treadmill yoga_mat', media: 'vinyl_wall record_crate', 'food-pack': 'bean_sacks', drink: 'cold_brew_tower back_bar',
  clothing: 'clothes_rack', shoe: 'shoe_wall shoe_plinth', candle: 'fire_table',
};
/** MVW's own pieces hung from the ceiling (the rest stand on the floor, or hang on a wall when `wall`). */
export const NATIVE_HANG = new Set('edison_pendants paper_pendant hanging_ivy birdcage'.split(' '));

// ------------------------------------------------------------------ the Amazon library's kinds
/** Goods tags of the Amazon library's kinds (decor and small things). */
export const ABO_KIND_TAGS = {
  table_lamp: ['lamp', 'decor'], floor_lamp: ['lamp'], pendant: ['lamp'], chandelier: ['lamp'], sconce: ['lamp'], vase: ['decor'],
  planter: ['plant'], plant: ['plant'], candle: ['candle', 'decor'], sculpture: ['decor'], storage: ['storage-box'], gym: ['sport'],
  exercise_mat: ['sport'], clock: ['decor'], frame: ['decor'], wall_art: ['decor'], mirror: ['decor'], floor_mirror: ['decor'],
  pillow: ['decor'], rug: ['decor'], board: ['office-supply'], wine_rack: ['drink'],
};
/** Amazon kinds whose small pieces (footprint <= 0.6 m, height <= 0.8 m) may also stand on a table or a shelf. */
export const ABO_ON_OK = new Set(['table_lamp', 'planter', 'vase', 'gym', 'storage', 'sculpture', 'candle', 'plant']);
/** Small enough for a table or a shelf: footprint side <= 0.6 m, height 0.03-0.8 m (rect [x0, z0, x1, z1], h in m). */
export const smallEnough = (rect, h) => Math.max(rect[2] - rect[0], rect[3] - rect[1]) <= 0.6 && h <= 0.8 && h >= 0.03;

const words = s => s.split(' ').filter(Boolean);
const NSUB = {}, NTAG = {};
for (const [cat, subs] of Object.entries(NATIVE_SUB)) for (const [sub, ts] of Object.entries(subs)) for (const t of words(ts)) NSUB[t] = { cat, sub };
for (const [tag, ts] of Object.entries(NATIVE_TAGS)) for (const t of words(ts)) (NTAG[t] || (NTAG[t] = [])).push(tag);

/** Size class, tags, sub-group (and onOk) of every catalog entry that has none yet: MVW's own pieces and the Amazon library
 *  (the goods come with theirs). Called once by shared/catalog.js after the merges. */
export function applyKinds(CATALOG, ABO_KINDS) {
  for (const [t, d] of Object.entries(CATALOG)) {
    if (d.goods) continue;
    if (d.abo) {
      const K = ABO_KINDS[d.kind] || {}, st = K.stand;
      d.size = st === 'wall' ? 'wall' : st === 'hang' ? 'hang' : st === 'flat' ? 'flat' : 'floor';
      d.tags = ABO_KIND_TAGS[d.kind] || [];
      if (ABO_ON_OK.has(d.kind) && !d.lift && !d.hide && smallEnough(d.rect, d.h)) d.onOk = true;
      continue;
    }
    d.sub = d.sub || NSUB[t]?.sub || d.cat;
    d.size = NATIVE_HANG.has(t) ? 'hang' : d.wall ? 'wall' : (d.h <= 0.13 && d.block === false) ? 'flat' : 'floor';
    d.tags = NTAG[t] || [];
  }
}
