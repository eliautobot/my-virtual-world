// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fish of the fishing game (docs/features/fishing.md §Fish): every species in the sea and the lakes, the legends
// and the junk and treasure that come up on a hook. Each species says where it lives (its water, the kinds of ground it
// holds on, how deep, when it feeds), what it takes (lure kinds: shared/fishing-gear.js LURES), how big it grows (length
// range, cm, and its condition K: weight (g) = K · L³ / 100, Fulton's), how rare it is, what a fish of middling size
// sells for (val, VC), how it fights (shared/fishing-fight.js) and how it looks (the browser's fish models).
// Shared by the server (it rolls what bites, and values the catch) and the browser (the Fishdex, the models).

/** Rarity: how often it bites against the others (weight), and its colour on the cards. */
export const RARITY = Object.freeze({
  common: { w: 100, label: 'Common', color: '#b9c2cc' },
  uncommon: { w: 38, label: 'Uncommon', color: '#5fcf7a' },
  rare: { w: 12, label: 'Rare', color: '#4fa3ff' },
  epic: { w: 3.2, label: 'Epic', color: '#b46cff' },
  legendary: { w: 1, label: 'Legendary', color: '#ffb02e' },
});
/** Size classes by a fish's place in its species' range (u, 0..1): their stars and their price. */
export const SIZES = Object.freeze([
  { id: 'small', label: 'Small', stars: 1, from: 0, mult: 1 },
  { id: 'medium', label: 'Medium', stars: 2, from: 0.35, mult: 1.15 },
  { id: 'large', label: 'Large', stars: 3, from: 0.75, mult: 1.35 },
  { id: 'trophy', label: 'Trophy', stars: 3, crown: true, from: 0.95, mult: 1.8 },
]);
export const sizeOf = u => [...SIZES].reverse().find(s => u >= s.from) || SIZES[0];

/** Temperaments (how a fish fights: shared/fishing-fight.js MODES weights). */
export const TEMPERS = Object.freeze(['steady', 'runner', 'jumper', 'diver', 'thrasher', 'bulldog']);

// Rows: id, name, water, hab (grounds it holds on), depth [m], act [dawn, day, dusk, night] (0..1), lures, len [cm],
// K (condition), rarity, val (VC at the middle of its range), fight [power, stamina, speed, temper, jump], body.
// body: shape (the model's archetype), h (height/length), tail (fork lunate round square heterocercal pointed), fins
// (spiny sail long small none), mark (bill hammer whiskers flat ray jet snout), colours [back, side, belly, fin], pattern
// (none bars stripes spots blotch lateral wavy), its colour.
const R = (id, name, water, hab, depth, act, lures, len, K, rarity, val, fight, body) => ({ id, name, water, hab, depth, act, lures, len, K, rarity, val, fight, body });
const B = (shape, h, tail, fins, cols, pat = 'none', patc = '#000000', mark = null) => ({ shape, h, tail, fins, cols, pat, patc, mark });
const F = (power, stamina, speed, temper, jump = 0) => ({ power, stamina, speed, temper, jump });

const SEA = [
  // ---- inshore: the shore, docks and pilings, the flats
  R('pinfish', 'Pinfish', 'sea', ['shore', 'flats'], [0.5, 6], [1, 0.9, 1, 0.3], ['shrimp', 'cutbait', 'soft'], [10, 25], 1.7, 'common', 0.6,
    F(0.9, 0.6, 1.0, 'steady'), B('perch', 0.38, 'fork', 'spiny', ['#7f8f86', '#c9d2c6', '#eef0e6', '#e4cf6a'], 'stripes', '#e8c95a')),
  R('mullet', 'Striped Mullet', 'sea', ['shore', 'flats', 'surface'], [0, 3], [1, 0.8, 1, 0.4], ['dough', 'shrimp'], [25, 65], 1.15, 'common', 1.6,
    F(1.0, 0.9, 1.1, 'steady', 0.35), B('mullet', 0.24, 'fork', 'small', ['#4f6070', '#a9b6bf', '#eef1f2', '#7d8a94'], 'lateral', '#3e4a55')),
  R('sheepshead', 'Sheepshead', 'sea', ['shore', 'rocks'], [1, 8], [0.8, 1, 0.8, 0.3], ['shrimp', 'cutbait'], [30, 70], 2.0, 'common', 3.4,
    F(1.2, 1.0, 0.8, 'bulldog'), B('perch', 0.45, 'fork', 'spiny', ['#5b5f5c', '#d8d9d0', '#ecece4', '#4a4c4a'], 'bars', '#1d1f1e')),
  R('seatrout', 'Spotted Seatrout', 'sea', ['flats', 'shore'], [0.5, 4], [1, 0.6, 1, 0.7], ['shrimp', 'soft', 'topwater', 'spinner'], [30, 80], 0.95, 'common', 2.8,
    F(1.0, 0.9, 1.0, 'thrasher', 0.15), B('trout', 0.22, 'square', 'small', ['#53687a', '#a8b5bb', '#eef0ee', '#b6a77a'], 'spots', '#1d2630')),
  R('flounder', 'Southern Flounder', 'sea', ['flats', 'sand'], [1, 10], [0.9, 0.7, 0.9, 0.6], ['shrimp', 'soft', 'cutbait'], [30, 80], 1.25, 'common', 3.6,
    F(1.0, 0.9, 0.7, 'bulldog'), B('flat', 0.5, 'round', 'long', ['#6d5a42', '#8a7556', '#f1ede4', '#6d5a42'], 'spots', '#3a2d1f', 'flat')),
  R('pompano', 'Florida Pompano', 'sea', ['flats', 'shore'], [0.5, 4], [1, 0.9, 0.8, 0.2], ['shrimp', 'jig'], [25, 55], 1.9, 'uncommon', 4.5,
    F(1.3, 1.1, 1.3, 'runner'), B('jack', 0.42, 'lunate', 'small', ['#7a8d98', '#d8e0e4', '#f3e8a6', '#e8c54a'])),
  R('ladyfish', 'Ladyfish', 'sea', ['shore', 'flats', 'surface'], [0, 3], [1, 0.8, 1, 0.5], ['shrimp', 'spinner', 'topwater', 'spoon'], [30, 80], 0.7, 'common', 1.4,
    F(1.0, 0.8, 1.4, 'jumper', 0.55), B('tarpon', 0.18, 'fork', 'small', ['#5f7e94', '#cfd8dd', '#f2f4f5', '#8aa1ae'])),
  R('snook', 'Common Snook', 'sea', ['shore', 'flats'], [0.5, 5], [1, 0.4, 1, 0.9], ['livebait', 'shrimp', 'soft', 'topwater', 'crank'], [50, 120], 0.95, 'uncommon', 9,
    F(1.4, 1.2, 1.3, 'jumper', 0.4), B('snook', 0.22, 'fork', 'spiny', ['#6d6b4f', '#c8c6a6', '#efeee4', '#d9c76a'], 'lateral', '#1a1a14', 'snout')),
  R('redfish', 'Red Drum', 'sea', ['flats', 'shore', 'sand'], [0.5, 6], [1, 0.8, 1, 0.5], ['shrimp', 'cutbait', 'soft', 'spinner'], [40, 120], 1.1, 'uncommon', 8,
    F(1.4, 1.3, 1.0, 'bulldog'), B('drum', 0.27, 'square', 'spiny', ['#9c6a3f', '#d39a62', '#f1e6d6', '#a67950'], 'spots', '#1b120c')),
  R('bonefish', 'Bonefish', 'sea', ['flats'], [0.3, 2], [1, 0.9, 0.8, 0.1], ['shrimp', 'jig'], [40, 80], 1.2, 'uncommon', 10,
    F(1.3, 1.4, 1.8, 'runner'), B('bonefish', 0.22, 'fork', 'small', ['#8aa3ad', '#dfe7ea', '#f4f6f6', '#b8c7cc'], 'lateral', '#9fb1b8', 'snout')),
  R('permit', 'Permit', 'sea', ['flats', 'sand'], [0.5, 8], [1, 0.8, 0.9, 0.2], ['shrimp', 'jig'], [50, 110], 2.4, 'rare', 22,
    F(1.6, 1.6, 1.4, 'runner'), B('jack', 0.55, 'lunate', 'sail', ['#5d6e78', '#c8d2d7', '#f0f2f2', '#2b3238'])),
  R('tarpon', 'Tarpon', 'sea', ['shore', 'flats', 'open'], [1, 10], [1, 0.5, 1, 0.8], ['livebait', 'topwater', 'soft', 'cutbait'], [90, 200], 1.1, 'rare', 30,
    F(1.5, 1.4, 1.4, 'jumper', 0.75), B('tarpon', 0.24, 'fork', 'small', ['#4f6a78', '#d6dde0', '#f4f6f6', '#7d8f99'])),
  R('stingray', 'Southern Stingray', 'sea', ['sand', 'flats'], [1, 15], [0.7, 0.8, 0.8, 0.8], ['cutbait', 'shrimp'], [60, 170], 1.4, 'common', 5,
    F(1.4, 1.3, 0.6, 'bulldog'), B('ray', 0.95, 'pointed', 'none', ['#6b6152', '#7d7262', '#ece6dc', '#6b6152'], 'none', '#000000', 'ray')),
  // ---- the reefs, rocks and wrecks
  R('grunt', 'White Grunt', 'sea', ['reef', 'rocks'], [3, 25], [1, 1, 1, 0.4], ['shrimp', 'cutbait', 'jig'], [15, 45], 1.6, 'common', 1.2,
    F(1.0, 0.8, 0.9, 'steady'), B('perch', 0.36, 'fork', 'spiny', ['#8a8d78', '#cfd0bf', '#efeee4', '#c9b97f'], 'stripes', '#2a5a8a')),
  R('blackseabass', 'Black Sea Bass', 'sea', ['reef', 'rocks', 'wreck'], [5, 40], [0.9, 1, 0.9, 0.3], ['cutbait', 'shrimp', 'jig'], [20, 60], 1.6, 'common', 2.4,
    F(1.1, 0.9, 0.9, 'bulldog'), B('bass', 0.33, 'round', 'spiny', ['#232a33', '#3b4652', '#6d7a86', '#1c232b'], 'spots', '#8fa2b5')),
  R('triggerfish', 'Gray Triggerfish', 'sea', ['reef', 'wreck'], [10, 50], [0.7, 1, 0.7, 0.1], ['cutbait', 'shrimp', 'jig'], [30, 70], 2.2, 'common', 3.5,
    F(1.2, 1.0, 0.8, 'bulldog'), B('trigger', 0.55, 'lunate', 'spiny', ['#6f7570', '#9aa09a', '#c9ccc4', '#5b6058'], 'blotch', '#4c524c')),
  R('mangrove', 'Mangrove Snapper', 'sea', ['reef', 'rocks', 'shore'], [1, 30], [1, 0.6, 1, 0.9], ['shrimp', 'cutbait', 'livebait'], [25, 70], 1.6, 'common', 3.2,
    F(1.2, 1.0, 1.0, 'bulldog'), B('snapper', 0.36, 'square', 'spiny', ['#5b4b45', '#a97e6c', '#e8d7cc', '#b4644b'])),
  R('yellowtail', 'Yellowtail Snapper', 'sea', ['reef'], [5, 30], [1, 0.8, 1, 0.6], ['shrimp', 'cutbait', 'jig'], [25, 75], 1.3, 'common', 3.6,
    F(1.1, 1.0, 1.2, 'runner'), B('snapper', 0.32, 'fork', 'spiny', ['#4c5f8f', '#a8b6d8', '#f1f3f7', '#f2cf2e'], 'lateral', '#f2cf2e')),
  R('lionfish', 'Lionfish', 'sea', ['reef', 'wreck'], [3, 45], [0.6, 1, 0.6, 0.4], ['jig', 'shrimp'], [15, 45], 1.6, 'uncommon', 4,
    F(0.8, 0.6, 0.6, 'steady'), B('lion', 0.42, 'round', 'sail', ['#7a2f22', '#e8d6c6', '#f6efe7', '#b44a34'], 'bars', '#7a2f22')),
  R('redsnapper', 'Red Snapper', 'sea', ['reef', 'wreck', 'drop'], [10, 60], [1, 0.9, 1, 0.4], ['cutbait', 'livebait', 'jig'], [30, 100], 1.6, 'uncommon', 7,
    F(1.3, 1.1, 1.0, 'diver'), B('snapper', 0.36, 'fork', 'spiny', ['#c4423a', '#e2786a', '#f6d9d0', '#c4423a'])),
  R('mutton', 'Mutton Snapper', 'sea', ['reef', 'flats'], [3, 40], [1, 0.7, 1, 0.7], ['cutbait', 'livebait', 'shrimp'], [40, 95], 1.5, 'uncommon', 8,
    F(1.4, 1.2, 1.1, 'runner'), B('snapper', 0.35, 'fork', 'spiny', ['#7c6b4a', '#c99a7a', '#f2e2d4', '#d06a4e'], 'spots', '#141010')),
  R('hogfish', 'Hogfish', 'sea', ['reef', 'rocks'], [3, 30], [0.8, 1, 0.7, 0.1], ['shrimp', 'jig'], [30, 90], 1.9, 'uncommon', 9,
    F(1.2, 1.0, 0.9, 'bulldog'), B('hog', 0.4, 'square', 'spiny', ['#c98a6a', '#e7c2a8', '#f7ebe1', '#c25b3c'], 'blotch', '#5a2a1a', 'snout')),
  R('redgrouper', 'Red Grouper', 'sea', ['reef', 'rocks'], [10, 60], [0.9, 1, 0.9, 0.3], ['cutbait', 'livebait', 'jig'], [40, 110], 1.5, 'uncommon', 9,
    F(1.5, 1.2, 0.8, 'bulldog'), B('grouper', 0.33, 'square', 'spiny', ['#7a3f30', '#a8604a', '#d8b0a0', '#6c3328'], 'blotch', '#e8d8cc')),
  R('gag', 'Gag Grouper', 'sea', ['reef', 'wreck', 'drop'], [10, 70], [0.9, 0.9, 1, 0.4], ['livebait', 'cutbait', 'jig'], [50, 140], 1.4, 'rare', 16,
    F(1.6, 1.3, 0.9, 'bulldog'), B('grouper', 0.31, 'square', 'spiny', ['#5a5850', '#8b887c', '#cfccc0', '#3e3c36'], 'wavy', '#3a3833')),
  R('amberjack', 'Greater Amberjack', 'sea', ['wreck', 'drop', 'reef'], [15, 80], [1, 0.9, 1, 0.3], ['livebait', 'jig'], [70, 180], 1.2, 'uncommon', 18,
    F(1.7, 1.5, 1.3, 'diver'), B('jack', 0.3, 'fork', 'small', ['#5b6b72', '#c8c4a0', '#f1efe6', '#b7a65e'], 'lateral', '#c49a3a')),
  R('goliath', 'Goliath Grouper', 'sea', ['wreck'], [8, 50], [0.8, 0.8, 1, 0.6], ['livebait', 'cutbait'], [120, 230], 1.9, 'epic', 70,
    F(1.9, 1.7, 0.7, 'bulldog'), B('grouper', 0.36, 'round', 'spiny', ['#6b6448', '#8f8763', '#c8c0a0', '#4f4934'], 'blotch', '#3e3a2a')),
  // ---- the open water: schools under the birds, the edges and the blue
  R('spanishmack', 'Spanish Mackerel', 'sea', ['surface', 'open', 'shore'], [0, 8], [1, 0.9, 1, 0.2], ['spoon', 'spinner', 'livebait', 'jig'], [30, 80], 0.75, 'common', 2.5,
    F(1.1, 0.9, 1.6, 'runner', 0.25), B('mackerel', 0.2, 'fork', 'small', ['#3d6fa0', '#c8d7e2', '#f4f6f8', '#7e9db8'], 'spots', '#e8c33a')),
  R('bluefish', 'Bluefish', 'sea', ['surface', 'open', 'shore'], [0, 10], [1, 0.8, 1, 0.4], ['spoon', 'topwater', 'cutbait', 'livebait'], [30, 100], 1.0, 'common', 3,
    F(1.3, 1.0, 1.4, 'thrasher', 0.2), B('jack', 0.24, 'fork', 'small', ['#3b6f8a', '#a6c3d0', '#eef3f5', '#5b8aa0'])),
  R('jack', 'Jack Crevalle', 'sea', ['surface', 'open', 'shore'], [0, 15], [1, 0.9, 1, 0.3], ['topwater', 'livebait', 'jig', 'spoon'], [40, 110], 1.6, 'common', 4,
    F(1.7, 1.4, 1.3, 'bulldog'), B('jack', 0.36, 'lunate', 'spiny', ['#4f6670', '#b6c0a6', '#efe8b8', '#e0c040'], 'none', '#000000')),
  R('littletunny', 'Little Tunny', 'sea', ['surface', 'open'], [0, 15], [1, 0.9, 1, 0.1], ['spoon', 'jig', 'livebait'], [50, 100], 1.5, 'common', 4.5,
    F(1.6, 1.3, 1.7, 'runner'), B('tuna', 0.26, 'lunate', 'small', ['#1f3f6a', '#8ea8be', '#eef2f5', '#45678c'], 'wavy', '#13253f')),
  R('bonito', 'Atlantic Bonito', 'sea', ['surface', 'open'], [0, 20], [1, 0.8, 1, 0.1], ['spoon', 'jig', 'livebait', 'skirt'], [40, 90], 1.4, 'common', 4,
    F(1.5, 1.2, 1.7, 'runner'), B('tuna', 0.25, 'lunate', 'small', ['#264b75', '#9fb4c7', '#f0f3f6', '#45678c'], 'stripes', '#1d3554')),
  R('barracuda', 'Great Barracuda', 'sea', ['reef', 'open', 'flats'], [1, 30], [1, 1, 1, 0.3], ['spoon', 'livebait', 'topwater'], [60, 170], 0.6, 'uncommon', 9,
    F(1.4, 1.1, 1.9, 'runner', 0.3), B('pike', 0.15, 'fork', 'small', ['#5c6e78', '#c0ccd2', '#f2f5f6', '#7b8b93'], 'bars', '#2a3238', 'snout')),
  R('kingmack', 'King Mackerel', 'sea', ['open', 'drop', 'surface'], [2, 40], [1, 0.8, 1, 0.2], ['livebait', 'spoon', 'skirt'], [70, 170], 0.6, 'uncommon', 13,
    F(1.6, 1.3, 2.0, 'runner', 0.2), B('mackerel', 0.17, 'fork', 'small', ['#3b5674', '#b9c6d2', '#f2f5f7', '#6c849b'])),
  R('cobia', 'Cobia', 'sea', ['open', 'wreck', 'shore'], [1, 40], [1, 0.9, 0.9, 0.2], ['livebait', 'jig', 'cutbait'], [70, 180], 0.9, 'rare', 22,
    F(1.7, 1.6, 1.2, 'runner'), B('cobia', 0.2, 'fork', 'small', ['#3b3530', '#6e655c', '#e6e0d6', '#2f2a26'], 'lateral', '#e6e0d6')),
  R('skipjack', 'Skipjack Tuna', 'sea', ['surface', 'blue'], [0, 30], [1, 0.9, 1, 0.1], ['skirt', 'spoon', 'jig', 'livebait'], [40, 100], 1.6, 'common', 6,
    F(1.6, 1.4, 1.8, 'runner'), B('tuna', 0.27, 'lunate', 'small', ['#23395c', '#9ab0c6', '#eef2f6', '#3a5578'], 'stripes', '#2d4766')),
  R('blackfin', 'Blackfin Tuna', 'sea', ['open', 'drop', 'blue'], [5, 60], [1, 0.8, 1, 0.3], ['jig', 'livebait', 'skirt'], [50, 105], 1.6, 'uncommon', 12,
    F(1.7, 1.5, 1.7, 'diver'), B('tuna', 0.27, 'lunate', 'small', ['#14233a', '#7b8ea5', '#eef1f4', '#26364d'], 'none')),
  R('mahi', 'Mahi-mahi', 'sea', ['surface', 'blue', 'open'], [0, 10], [1, 1, 0.9, 0.1], ['skirt', 'topwater', 'livebait', 'cutbait'], [60, 200], 0.7, 'uncommon', 16,
    F(1.6, 1.4, 1.8, 'jumper', 0.7), B('mahi', 0.26, 'fork', 'long', ['#2e8a6a', '#7fc8a0', '#f2e26a', '#3a8fd0'], 'spots', '#2a6fb5')),
  R('yellowfin', 'Yellowfin Tuna', 'sea', ['blue', 'drop'], [5, 100], [1, 0.8, 1, 0.3], ['skirt', 'livebait', 'jig'], [80, 200], 1.6, 'rare', 45,
    F(1.9, 1.8, 1.8, 'diver'), B('tuna', 0.27, 'lunate', 'long', ['#1b2c47', '#8fa3b8', '#eef1f4', '#f2c62e'], 'lateral', '#f2c62e')),
  R('wahoo', 'Wahoo', 'sea', ['blue', 'drop'], [0, 30], [1, 0.9, 1, 0.2], ['skirt', 'livebait'], [100, 230], 0.45, 'rare', 38,
    F(1.7, 1.4, 2.4, 'runner'), B('mackerel', 0.14, 'lunate', 'small', ['#1f3e66', '#9fb5c9', '#f0f3f6', '#2f5580'], 'bars', '#2b4f7e', 'snout')),
  R('sailfish', 'Sailfish', 'sea', ['blue', 'surface'], [0, 30], [1, 0.9, 0.9, 0.1], ['skirt', 'livebait'], [150, 320], 0.35, 'rare', 55,
    F(1.6, 1.6, 2.2, 'jumper', 0.85), B('billfish', 0.16, 'lunate', 'sail', ['#1c3a66', '#8fa4bd', '#eef2f5', '#3a5f9a'], 'bars', '#7fb0e8', 'bill')),
  R('bluefin', 'Bluefin Tuna', 'sea', ['blue'], [10, 200], [1, 0.7, 1, 0.3], ['skirt', 'livebait', 'jig'], [150, 300], 1.7, 'epic', 160,
    F(1.85, 1.8, 1.9, 'diver'), B('tuna', 0.28, 'lunate', 'long', ['#0f1c33', '#7e93ab', '#eef1f4', '#c9a43a'], 'none')),
  R('bluemarlin', 'Blue Marlin', 'sea', ['blue'], [0, 120], [1, 0.9, 1, 0.2], ['skirt', 'livebait'], [200, 420], 0.6, 'epic', 190,
    F(1.8, 1.8, 2.3, 'jumper', 0.8), B('billfish', 0.2, 'lunate', 'long', ['#11274d', '#7f97b6', '#eef2f5', '#2a4c86'], 'bars', '#8fb8ef', 'bill')),
  R('swordfish', 'Swordfish', 'sea', ['blue', 'deep'], [50, 500], [0.6, 0.2, 0.9, 1], ['squid', 'cutbait'], [150, 400], 0.75, 'epic', 170,
    F(1.85, 1.8, 1.8, 'diver', 0.3), B('billfish', 0.2, 'lunate', 'small', ['#3a3440', '#6f6876', '#d9d4dc', '#2e2933'], 'none', '#000000', 'bill')),
  R('squidreef', 'Caribbean Reef Squid', 'sea', ['reef', 'shore', 'open'], [1, 30], [0.4, 0.2, 0.8, 1], ['squid', 'shrimp', 'jig'], [15, 40], 1.0, 'common', 2.4,
    F(0.8, 0.7, 1.4, 'steady'), B('squid', 0.2, 'pointed', 'none', ['#c79a7a', '#e8c8b0', '#f5e8dc', '#b07a5a'], 'spots', '#7a4a3a', 'jet')),
  // ---- sharks
  R('blacktip', 'Blacktip Shark', 'sea', ['shore', 'open', 'flats'], [1, 30], [1, 0.8, 1, 0.7], ['cutbait', 'livebait'], [100, 250], 0.9, 'uncommon', 18,
    F(1.8, 1.6, 1.7, 'runner', 0.35), B('shark', 0.18, 'heterocercal', 'small', ['#6d7a84', '#9aa6ae', '#eef1f2', '#1a1d20'])),
  R('bullshark', 'Bull Shark', 'sea', ['shore', 'open', 'drop'], [1, 40], [0.9, 0.6, 1, 1], ['cutbait', 'livebait'], [150, 300], 0.95, 'rare', 40,
    F(1.9, 1.8, 1.4, 'bulldog'), B('shark', 0.22, 'heterocercal', 'small', ['#6f7376', '#8d9194', '#ecedee', '#5f6366'])),
  R('hammerhead', 'Great Hammerhead', 'sea', ['open', 'blue', 'drop'], [1, 80], [1, 0.7, 1, 0.6], ['cutbait', 'livebait'], [250, 420], 0.55, 'epic', 150,
    F(1.85, 1.8, 1.6, 'runner'), B('shark', 0.16, 'heterocercal', 'long', ['#5d6870', '#8a959c', '#eceeef', '#4f5a62'], 'none', '#000000', 'hammer')),
];

const LAKE = [
  // ---- panfish: the pads, the weed and the shore
  R('bluegill', 'Bluegill', 'lake', ['pads', 'weed', 'shore'], [0.3, 5], [1, 0.9, 1, 0.3], ['worm', 'minnow', 'spinner', 'dough'], [10, 30], 2.2, 'common', 0.4,
    F(0.9, 0.6, 0.9, 'steady'), B('sunfish', 0.55, 'square', 'spiny', ['#3b5a54', '#8a9a6a', '#e8a04a', '#2c3d48'], 'bars', '#2f4740')),
  R('pumpkinseed', 'Pumpkinseed', 'lake', ['pads', 'weed'], [0.3, 4], [1, 0.9, 1, 0.2], ['worm', 'dough'], [10, 25], 2.3, 'common', 0.4,
    F(0.9, 0.6, 0.9, 'steady'), B('sunfish', 0.55, 'square', 'spiny', ['#5a6a3a', '#c8a050', '#f0b040', '#4a6a7a'], 'spots', '#d0703a')),
  R('greensunfish', 'Green Sunfish', 'lake', ['shore', 'rocks', 'weed'], [0.3, 4], [1, 0.9, 1, 0.3], ['worm', 'spinner'], [10, 25], 2.0, 'common', 0.3,
    F(0.9, 0.6, 0.9, 'steady'), B('sunfish', 0.48, 'square', 'spiny', ['#3e5a48', '#7a9a6a', '#e8d27a', '#3e5a48'], 'wavy', '#5ab0c0')),
  R('redear', 'Redear Sunfish', 'lake', ['weed', 'bottom'], [1, 6], [1, 0.9, 1, 0.3], ['worm', 'dough'], [15, 35], 2.0, 'common', 0.6,
    F(0.9, 0.7, 0.9, 'steady'), B('sunfish', 0.5, 'square', 'spiny', ['#4a5a3a', '#a8a070', '#f2dc8a', '#4a5a3a'], 'spots', '#7a6a3a')),
  R('tilapia', 'Blue Tilapia', 'lake', ['shore', 'weed', 'pads'], [0.3, 4], [0.8, 1, 0.8, 0.2], ['dough', 'worm'], [20, 50], 2.0, 'common', 0.9,
    F(1.0, 0.8, 0.9, 'steady'), B('sunfish', 0.42, 'square', 'spiny', ['#4c5c70', '#a9b6c4', '#e9edf2', '#7a5a6a'], 'bars', '#6a7a8c')),
  R('blackcrappie', 'Black Crappie', 'lake', ['weed', 'drop', 'pads'], [1, 8], [1, 0.6, 1, 0.8], ['minnow', 'jig', 'spinner'], [15, 45], 1.6, 'common', 0.8,
    F(0.9, 0.7, 0.9, 'steady'), B('sunfish', 0.45, 'square', 'spiny', ['#3a4038', '#a6ab9a', '#eceee6', '#3a4038'], 'blotch', '#252a24')),
  R('whitecrappie', 'White Crappie', 'lake', ['open', 'drop'], [1, 8], [1, 0.6, 1, 0.8], ['minnow', 'jig'], [15, 45], 1.4, 'common', 0.8,
    F(0.9, 0.7, 0.9, 'steady'), B('sunfish', 0.42, 'square', 'spiny', ['#7a8a80', '#c9d0c6', '#f0f2ec', '#7a8a80'], 'bars', '#53625a')),
  R('perch', 'Yellow Perch', 'lake', ['weed', 'open', 'bottom'], [1, 10], [1, 1, 0.9, 0.2], ['worm', 'minnow', 'jig', 'spinner'], [15, 40], 1.3, 'common', 0.8,
    F(0.9, 0.7, 1.0, 'steady'), B('perch', 0.3, 'fork', 'spiny', ['#5a6a30', '#d8c060', '#f2eccc', '#e07a3a'], 'bars', '#3a4420')),
  R('rockbass', 'Rock Bass', 'lake', ['rocks', 'shore'], [1, 6], [1, 0.8, 1, 0.5], ['worm', 'minnow', 'crank'], [15, 35], 1.9, 'common', 0.6,
    F(1.0, 0.7, 0.9, 'bulldog'), B('sunfish', 0.45, 'square', 'spiny', ['#5a4a32', '#9a8460', '#e2d6b8', '#5a4a32'], 'spots', '#2a2016')),
  R('bullhead', 'Brown Bullhead', 'lake', ['bottom', 'hole', 'weed'], [1, 8], [0.7, 0.4, 0.9, 1], ['worm', 'dough', 'cutbait'], [20, 45], 1.4, 'common', 0.8,
    F(1.0, 0.8, 0.7, 'bulldog'), B('catfish', 0.2, 'square', 'small', ['#4a3a2a', '#7a6248', '#e6dcc8', '#3a2c20'], 'blotch', '#2e241a', 'whiskers')),
  // ---- the bass and their kin
  R('largemouth', 'Largemouth Bass', 'lake', ['pads', 'weed', 'shore'], [0.5, 6], [1, 0.6, 1, 0.5], ['topwater', 'soft', 'crank', 'spinner', 'minnow'], [25, 75], 1.35, 'common', 2.6,
    F(1.3, 1.1, 1.1, 'jumper', 0.45), B('bass', 0.28, 'square', 'spiny', ['#3e5a2e', '#8ea86a', '#eef0d8', '#4a6a3a'], 'blotch', '#26381c')),
  R('smallmouth', 'Smallmouth Bass', 'lake', ['rocks', 'drop'], [1, 8], [1, 0.8, 1, 0.3], ['crank', 'jig', 'soft', 'minnow'], [25, 65], 1.35, 'uncommon', 3.4,
    F(1.4, 1.2, 1.2, 'jumper', 0.55), B('bass', 0.27, 'square', 'spiny', ['#6a5a32', '#b09a60', '#ece6cc', '#7a6a3a'], 'bars', '#4a3c1c')),
  R('spottedbass', 'Spotted Bass', 'lake', ['rocks', 'drop', 'open'], [1, 10], [1, 0.8, 1, 0.3], ['jig', 'soft', 'crank'], [25, 60], 1.3, 'common', 2.2,
    F(1.3, 1.1, 1.1, 'jumper', 0.4), B('bass', 0.27, 'square', 'spiny', ['#4a5a30', '#a2ae78', '#eeeedc', '#4a5a30'], 'spots', '#2a3418')),
  R('peacock', 'Peacock Bass', 'lake', ['pads', 'shore', 'weed'], [0.5, 5], [0.8, 1, 0.7, 0.1], ['topwater', 'minnow', 'crank'], [30, 75], 1.4, 'uncommon', 5.2,
    F(1.5, 1.2, 1.3, 'jumper', 0.5), B('bass', 0.3, 'round', 'spiny', ['#4a6a2a', '#c8c040', '#f0d070', '#d06030'], 'bars', '#22301a')),
  R('whitebass', 'White Bass', 'lake', ['surface', 'open'], [0, 8], [1, 0.8, 1, 0.3], ['spoon', 'spinner', 'jig', 'minnow'], [25, 45], 1.3, 'common', 1.2,
    F(1.1, 0.9, 1.3, 'runner'), B('perch', 0.33, 'fork', 'spiny', ['#5a6a7a', '#c8d0d6', '#f2f4f5', '#6a7a8a'], 'stripes', '#3e4a56')),
  R('stripedbass', 'Striped Bass', 'lake', ['open', 'drop', 'surface'], [1, 20], [1, 0.6, 1, 0.7], ['minnow', 'spoon', 'topwater', 'cutbait'], [50, 130], 1.0, 'uncommon', 10.5,
    F(1.6, 1.4, 1.4, 'runner'), B('perch', 0.24, 'fork', 'spiny', ['#4a5a6a', '#c0c8ce', '#f2f4f5', '#5a6a7a'], 'stripes', '#2a333c')),
  // ---- trout and walleye: the cold and the deep
  R('rainbow', 'Rainbow Trout', 'lake', ['open', 'shore', 'drop'], [0.5, 12], [1, 0.7, 1, 0.2], ['spinner', 'spoon', 'worm', 'minnow'], [25, 80], 1.1, 'common', 3,
    F(1.3, 1.1, 1.4, 'jumper', 0.55), B('trout', 0.22, 'square', 'small', ['#4a6a5a', '#c8c8b0', '#f2eef0', '#7a8a7a'], 'spots', '#2a2a22', 'stripe')),
  R('brook', 'Brook Trout', 'lake', ['shore', 'weed'], [0.5, 6], [1, 0.6, 1, 0.2], ['spinner', 'worm', 'minnow'], [20, 50], 1.1, 'uncommon', 3.8,
    F(1.2, 1.0, 1.3, 'thrasher', 0.2), B('trout', 0.22, 'square', 'small', ['#2e4a3a', '#6a8a6a', '#e8804a', '#e05a3a'], 'wavy', '#b8c87a')),
  R('brown', 'Brown Trout', 'lake', ['drop', 'rocks', 'open'], [1, 15], [1, 0.4, 1, 0.8], ['minnow', 'crank', 'spinner', 'spoon'], [30, 90], 1.1, 'uncommon', 5.2,
    F(1.4, 1.2, 1.3, 'thrasher', 0.25), B('trout', 0.23, 'square', 'small', ['#5a4a2a', '#b8a060', '#f2e6c0', '#8a6a3a'], 'spots', '#7a2a1a')),
  R('laketrout', 'Lake Trout', 'lake', ['hole', 'drop', 'deep'], [8, 40], [1, 0.8, 1, 0.3], ['spoon', 'jig', 'minnow'], [45, 120], 1.0, 'rare', 12,
    F(1.5, 1.5, 1.2, 'diver'), B('trout', 0.22, 'fork', 'small', ['#3a4a4a', '#7a8a80', '#ece8e0', '#4a5a56'], 'spots', '#d8dccc')),
  R('walleye', 'Walleye', 'lake', ['drop', 'rocks', 'hole'], [2, 15], [1, 0.3, 1, 1], ['jig', 'minnow', 'crank', 'worm'], [30, 80], 0.95, 'uncommon', 4.5,
    F(1.2, 1.1, 1.0, 'steady'), B('perch', 0.22, 'fork', 'spiny', ['#5a5a30', '#b0a868', '#ece8d0', '#6a6a3a'], 'blotch', '#3a3a1e')),
  R('sauger', 'Sauger', 'lake', ['hole', 'drop', 'deep'], [4, 18], [1, 0.3, 1, 0.9], ['jig', 'minnow'], [25, 55], 0.85, 'uncommon', 3,
    F(1.1, 0.9, 1.0, 'steady'), B('perch', 0.2, 'fork', 'spiny', ['#5a5040', '#a89a78', '#e8e2d2', '#5a5040'], 'blotch', '#2e2a20')),
  // ---- the toothy ones
  R('pickerel', 'Chain Pickerel', 'lake', ['weed', 'pads'], [0.5, 4], [1, 0.9, 1, 0.2], ['spinner', 'topwater', 'spoon', 'minnow'], [30, 75], 0.65, 'common', 1.9,
    F(1.1, 0.9, 1.5, 'thrasher', 0.25), B('pike', 0.15, 'fork', 'small', ['#4a5a2a', '#a0a860', '#eef0d6', '#5a6a3a'], 'wavy', '#2a3418', 'snout')),
  R('pike', 'Northern Pike', 'lake', ['weed', 'drop', 'pads'], [0.5, 8], [1, 0.8, 1, 0.2], ['spoon', 'spinner', 'crank', 'minnow', 'topwater'], [50, 130], 0.65, 'uncommon', 6.8,
    F(1.5, 1.2, 1.7, 'thrasher', 0.3), B('pike', 0.15, 'fork', 'small', ['#3a5a2a', '#7a9a52', '#eef0d6', '#6a7a3a'], 'spots', '#d8e0a8', 'snout')),
  R('musky', 'Muskellunge', 'lake', ['weed', 'drop'], [1, 10], [1, 0.7, 1, 0.2], ['topwater', 'crank', 'spinner', 'minnow'], [80, 150], 0.7, 'rare', 22.5,
    F(1.8, 1.5, 1.7, 'thrasher', 0.4), B('pike', 0.16, 'fork', 'small', ['#5a6a3a', '#b0b07a', '#eeeed8', '#8a6a3a'], 'bars', '#3a4224', 'snout')),
  R('bowfin', 'Bowfin', 'lake', ['weed', 'pads', 'shore'], [0.5, 4], [1, 0.7, 1, 0.6], ['minnow', 'cutbait', 'spinner', 'topwater'], [40, 100], 1.0, 'uncommon', 3.8,
    F(1.5, 1.3, 1.2, 'thrasher', 0.2), B('bowfin', 0.2, 'round', 'long', ['#4a4a2a', '#7a7a4a', '#d8d0a8', '#3e5a2a'], 'wavy', '#2e2e1a')),
  R('longgar', 'Longnose Gar', 'lake', ['surface', 'weed', 'shore'], [0, 4], [1, 1, 1, 0.3], ['minnow', 'cutbait', 'spinner'], [60, 180], 0.22, 'uncommon', 4.5,
    F(1.3, 1.1, 1.4, 'thrasher', 0.45), B('gar', 0.1, 'round', 'small', ['#5a6040', '#9aa070', '#e6e2c8', '#5a6040'], 'spots', '#2a2c1a', 'snout')),
  // ---- the bottom: catfish, carp, the old ones
  R('channelcat', 'Channel Catfish', 'lake', ['hole', 'bottom', 'drop'], [1, 15], [0.8, 0.4, 1, 1], ['worm', 'cutbait', 'dough', 'minnow'], [35, 100], 1.1, 'common', 3,
    F(1.4, 1.2, 1.0, 'bulldog'), B('catfish', 0.2, 'fork', 'small', ['#5a6470', '#a8b0b8', '#eef0f2', '#5a6470'], 'spots', '#2a2e34', 'whiskers')),
  R('flathead', 'Flathead Catfish', 'lake', ['hole', 'rocks'], [2, 15], [0.6, 0.2, 0.9, 1], ['minnow', 'cutbait'], [50, 150], 1.3, 'rare', 13.5,
    F(1.8, 1.6, 0.9, 'bulldog'), B('catfish', 0.2, 'square', 'small', ['#6a5a3a', '#9a8458', '#e8dcc0', '#5a4a30'], 'blotch', '#3a2e1a', 'whiskers')),
  R('bluecat', 'Blue Catfish', 'lake', ['hole', 'deep', 'drop'], [3, 25], [0.7, 0.3, 1, 1], ['cutbait', 'dough', 'minnow'], [50, 160], 1.2, 'rare', 15,
    F(1.9, 1.7, 1.0, 'bulldog'), B('catfish', 0.21, 'fork', 'small', ['#4a5a70', '#90a0b6', '#eef0f4', '#4a5a70'], 'none', '#000000', 'whiskers')),
  R('carp', 'Common Carp', 'lake', ['bottom', 'weed', 'shore'], [0.5, 8], [1, 0.9, 1, 0.5], ['dough', 'worm'], [40, 110], 1.6, 'uncommon', 4.5,
    F(1.6, 1.5, 1.1, 'bulldog'), B('carp', 0.3, 'fork', 'long', ['#6a5a2a', '#b89a4a', '#ece0b0', '#8a6a3a'], 'none', '#000000', 'whiskers')),
  R('grasscarp', 'Grass Carp', 'lake', ['weed', 'pads'], [0.5, 5], [1, 1, 0.8, 0.2], ['dough', 'worm'], [60, 140], 1.3, 'rare', 10.5,
    F(1.8, 1.6, 1.4, 'runner'), B('carp', 0.24, 'fork', 'small', ['#5a6040', '#a8a878', '#ece8d0', '#6a6a4a'])),
  R('alligatorgar', 'Alligator Gar', 'lake', ['hole', 'surface', 'weed'], [0, 8], [1, 0.7, 1, 0.8], ['cutbait', 'minnow'], [120, 260], 0.42, 'epic', 63.8,
    F(2.0, 1.8, 1.2, 'thrasher', 0.35), B('gar', 0.13, 'round', 'small', ['#4a5040', '#7a8064', '#d8d4bc', '#4a5040'], 'spots', '#2a2c22', 'snout')),
  R('sturgeon', 'Lake Sturgeon', 'lake', ['hole', 'deep', 'bottom'], [5, 30], [0.8, 0.6, 1, 0.8], ['worm', 'cutbait'], [90, 220], 0.75, 'epic', 52.5,
    F(1.9, 2.0, 1.0, 'jumper', 0.35), B('sturgeon', 0.15, 'heterocercal', 'small', ['#4a4a44', '#7a7a70', '#dcd8cc', '#3e3e38'], 'spots', '#d8d4c4', 'whiskers')),
];

// ---- the legends: one of a kind, at their own kind of ground, on hard trips, at their hour
const LEGENDS = [
  R('oldgoliath', 'Old Goliath', 'sea', ['wreck'], [15, 60], [0.4, 0.3, 1, 1], ['livebait', 'cutbait'], [250, 270], 2.0, 'legendary', 650,
    F(1.95, 2.2, 0.9, 'bulldog'), B('grouper', 0.37, 'round', 'spiny', ['#4e4a34', '#7a7354', '#bdb594', '#3a3726'], 'blotch', '#2a2818')),
  R('ghostmarlin', 'The Ghost Marlin', 'sea', ['blue'], [0, 80], [0.6, 0.2, 1, 0.6], ['skirt', 'livebait'], [380, 420], 0.6, 'legendary', 800,
    F(1.9, 2.1, 2.6, 'jumper', 0.9), B('billfish', 0.2, 'lunate', 'long', ['#d8e4ee', '#eef4f8', '#ffffff', '#a8c8e8'], 'bars', '#b8d8ff', 'bill')),
  R('abyssalsquid', 'The Abyssal Squid', 'sea', ['deep', 'blue'], [100, 600], [0, 0, 0.4, 1], ['squid'], [600, 800], 0.12, 'legendary', 900,
    F(1.9, 2.1, 1.6, 'diver'), B('squid', 0.16, 'pointed', 'none', ['#6a1a2a', '#9a3040', '#e8b0b8', '#4a1020'], 'spots', '#ffd0e0', 'jet')),
  R('oldwhiskers', 'Old Whiskers', 'lake', ['hole'], [8, 30], [0.2, 0, 0.6, 1], ['cutbait', 'dough'], [180, 200], 1.25, 'legendary', 480,
    F(2.0, 2.2, 1.0, 'bulldog'), B('catfish', 0.22, 'fork', 'small', ['#38404c', '#6a7480', '#d8dce0', '#2e343c'], 'none', '#000000', 'whiskers')),
  R('lakequeen', 'The Lake Queen', 'lake', ['weed', 'drop'], [2, 10], [0.8, 0.2, 1, 0.3], ['topwater', 'crank', 'minnow'], [160, 175], 0.75, 'legendary', 520,
    F(2.0, 2.1, 1.9, 'thrasher', 0.5), B('pike', 0.16, 'fork', 'small', ['#6a7040', '#c8c890', '#f2f0dc', '#a0703a'], 'bars', '#4a4e2a', 'snout')),
  R('goldenbass', 'The Golden Bass', 'lake', ['pads'], [0.5, 4], [1, 0.1, 1, 0.2], ['topwater', 'soft'], [78, 85], 1.5, 'legendary', 400,
    F(1.8, 2.0, 1.4, 'jumper', 0.7), B('bass', 0.29, 'square', 'spiny', ['#c89a1a', '#f2d050', '#fff2b0', '#e8b030'], 'blotch', '#a87810')),
];

export const SPECIES = Object.freeze([...SEA, ...LAKE, ...LEGENDS].map(s => Object.freeze({ ...s, legend: s.rarity === 'legendary' })));
export const SPECIES_BY_ID = Object.freeze(Object.fromEntries(SPECIES.map(s => [s.id, s])));
export const speciesOf = id => SPECIES_BY_ID[id] || null;
export const speciesIn = water => SPECIES.filter(s => s.water === water && !s.legend);
export const legendsIn = water => SPECIES.filter(s => s.water === water && s.legend);

/**
 * Junk and treasure: what else comes up on a bottom ground (kind: junk sells for a token; a bottle marks a hidden ground;
 * a pouch holds coins; the golden lure is a lure). They don't fight: a dead weight.
 */
export const FINDS = Object.freeze([
  { id: 'boot', name: 'Old Boot', icon: '🥾', kind: 'junk', w: 30, val: 0.2, kg: 0.9 },
  { id: 'tyre', name: 'Bald Tyre', icon: '🛞', kind: 'junk', w: 14, val: 0.3, kg: 7.5 },
  { id: 'can', name: 'Rusty Can', icon: '🥫', kind: 'junk', w: 30, val: 0.1, kg: 0.3 },
  { id: 'bottle', name: 'Message in a Bottle', icon: '🍾', kind: 'map', w: 8, val: 1, kg: 0.6 },
  { id: 'pouch', name: 'Coin Pouch', icon: '💰', kind: 'coins', w: 4, val: 12, kg: 0.8 },
  { id: 'goldenlure', name: 'Golden Lure', icon: '✨', kind: 'lure', w: 0.6, val: 0, kg: 0.05 },
].map(Object.freeze));
export const findOf = id => FINDS.find(f => f.id === id) || null;

// ------------------------------------------------------------------------------------------- sizes, weights, value
/** A fish's weight (kg) at length L (cm): Fulton's condition K (weight g = K · L³ / 100). */
export const weightAt = (s, L) => Math.max(0.01, s.K * L * L * L / 100 / 1000);
/** The length at place u (0..1) in the species' range: more small ones than big (u^1.25 along the range). */
export const lengthAt = (s, u) => s.len[0] + (s.len[1] - s.len[0]) * Math.pow(Math.max(0, Math.min(1, u)), 1.25);
/** The middle of the range (what val is quoted at). */
export const medianKg = s => weightAt(s, lengthAt(s, 0.5));
/** Cooler slots a fish takes, by weight (a small one 1 … a giant 6). */
export const slotsFor = kg => (kg <= 2 ? 1 : kg <= 10 ? 2 : kg <= 40 ? 3 : kg <= 150 ? 4 : 6);
/**
 * What a fish sells for (VC, to the cent): the species' val at its median weight, more than in proportion for a big
 * one ((kg / median)^0.75), times its size class, times its freshness (0..1). Never under half a coin.
 */
export function valueOf(s, kg, u, fresh = 1) {
  const v = s.val * Math.pow(kg / medianKg(s), 0.75) * sizeOf(u).mult * Math.max(0, Math.min(1, fresh));
  return Math.round(Math.max(0.5, v) * 100) / 100;
}
/** A fish from a species and its place u in the range: { species, u, cm, kg, size, slots }. */
export function fishOf(s, u) {
  const cm = Math.round(lengthAt(s, u) * 10) / 10, kg = Math.round(weightAt(s, cm) * 1000) / 1000;
  return { species: s.id, u: Math.round(u * 1e4) / 1e4, cm, kg, size: sizeOf(u).id, slots: slotsFor(kg) };
}
/** Pounds and inches, for those who like them. */
export const toLb = kg => kg * 2.20462;
export const toIn = cm => cm / 2.54;
