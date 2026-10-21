// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Items (docs/features/INVENTORY.md): the kinds of thing a player, an agent or a business can hold in its inventory —
// one list the server and the browser share, every part of the world adding its own: the fishing game its fish, finds,
// lures and tackle; the cafés and restaurants their food and drink; the shops their goods. An item is { id, name, icon,
// cat (a category below), value (hundredths of a Virtual Coin: what it's worth — a one-of-a-kind piece may carry its
// own in its attrs.vc), rarity, stack (the most a plain stack holds), unique (each piece is one of a kind: a fish with
// its own length and weight, kept apart and shown grouped), trade (may be given or traded; default yes), desc }.
import { SPECIES, FINDS, RARITY } from './fish-species.js';
import { LURES, RODS, REELS, LINES, LEADER } from './fishing-gear.js';
import { FOOD } from './food.js';

/** The categories, in the order the inventory shows them. */
export const ITEM_CATS = Object.freeze([
  { id: 'fish', label: 'Fish', icon: '🐟' },
  { id: 'bait', label: 'Bait & lures', icon: '🪱' },
  { id: 'tackle', label: 'Tackle', icon: '🎣' },
  { id: 'food', label: 'Food & drink', icon: '🍔' },
  { id: 'goods', label: 'Goods', icon: '🛍️' },
  { id: 'treasure', label: 'Treasures', icon: '💎' },
  { id: 'junk', label: 'Junk', icon: '🗑️' },
]);
export const CAT_BY_ID = Object.freeze(Object.fromEntries(ITEM_CATS.map(c => [c.id, c])));
/** Rarity's order (for sorting) and colour: the fish's own scale, used by every item. */
export const RARITY_ORDER = Object.freeze({ common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 });
export const rarityColor = r => RARITY[r]?.color || RARITY.common.color;

const ITEMS = new Map();
/** Adds kinds of item (a module's own): each { id, name, icon, cat, value, rarity?, stack?, unique?, trade?, desc? }. */
export function registerItems(list) {
  for (const it of list) {
    if (!it?.id || !it.name || !CAT_BY_ID[it.cat]) throw new Error(`Bad item: ${JSON.stringify(it).slice(0, 120)}`);
    ITEMS.set(it.id, Object.freeze({ rarity: 'common', stack: 999, unique: false, trade: true, desc: '', icon: '📦', value: 0, ...it }));
  }
}
export const itemOf = id => ITEMS.get(String(id)) || null;
export const allItems = () => [...ITEMS.values()];
/** What a piece is worth (hundredths): its own (attrs.vc) for a one-of-a-kind, else its kind's. */
export const itemValue = (def, attrs) => (attrs && Number.isFinite(attrs.vc) ? Math.round(attrs.vc) : def?.value || 0);
/** A stack's (or a group's) name with what sets a piece apart: "Red Snapper — 52 cm, 2.1 kg". */
export function pieceLabel(def, attrs) {
  if (!def) return 'Something';
  if (!attrs) return def.name;
  const bits = [attrs.cm ? `${attrs.cm} cm` : '', attrs.kg ? `${attrs.kg < 10 ? (+attrs.kg).toFixed(2) : (+attrs.kg).toFixed(1)} kg` : ''].filter(Boolean);
  return bits.length ? `${def.name} — ${bits.join(', ')}` : def.name;
}

// ------------------------------------------------------------------ sorting (the server's lists and the browser's)
export const SORTS = Object.freeze([['newest', 'Newest'], ['name', 'Name'], ['value', 'Value'], ['qty', 'Quantity'], ['rarity', 'Rarity'], ['cat', 'Category']]);
/** Sorts stacks [{ item, qty, attrs, got }] by `by`: the most first (value, quantity, rarity, newest), else A–Z. */
export function sortStacks(stacks, by = 'newest') {
  const def = s => itemOf(s.item), name = s => def(s)?.name || s.item, catIx = s => ITEM_CATS.findIndex(c => c.id === def(s)?.cat);
  const val = s => itemValue(def(s), s.attrs) * (s.qty || 1), rar = s => RARITY_ORDER[def(s)?.rarity] ?? 0;
  const tie = (a, b) => name(a).localeCompare(name(b)) || (b.got || 0) - (a.got || 0);
  const cmp = {
    newest: (a, b) => (b.got || 0) - (a.got || 0) || tie(a, b),
    name: tie,
    value: (a, b) => val(b) - val(a) || tie(a, b),
    qty: (a, b) => (b.qty || 0) - (a.qty || 0) || tie(a, b),
    rarity: (a, b) => rar(b) - rar(a) || val(b) - val(a) || tie(a, b),
    cat: (a, b) => catIx(a) - catIx(b) || tie(a, b),
  }[by] || ((a, b) => (b.got || 0) - (a.got || 0));
  return [...stacks].sort(cmp);
}

// ------------------------------------------------------------------ the welcome kit
/**
 * What everyone finds in their inventory the first time it's opened (the product owner, 2026-10-14: "a welcome kit
 * would be nice") — a player: a starter rod, reel and line with bait for a first fishing trip, a coffee and a gift to
 * give someone; an agent: a small gift set to give or trade. [[item, qty], …]
 */
export const WELCOME_KIT = Object.freeze({
  account: [['gear:rod_starter', 1], ['gear:reel_spincast', 1], ['gear:line_mono8', 1], ['lure:shrimp', 10], ['lure:worm', 10], ['lure:soft', 4], ['lure:spinner', 1], ['food:coffee', 1], ['goods:gift', 1]],
  agent: [['goods:gift', 1], ['goods:flowers', 1], ['food:coffee', 2]],
});

// ------------------------------------------------------------------ what there is
const vcOf = v => Math.round(v * 100);
const fishIcon = s => (s.body?.shape === 'shark' ? '🦈' : s.body?.shape === 'squid' ? '🦑' : s.body?.shape === 'sunfish' || s.body?.shape === 'perch' ? '🐠' : '🐟');
registerItems([
  // the fishing game: every species (each fish one of a kind: its length, weight, size and worth), the finds, the lures
  // (sold by the pack), the tackle
  ...SPECIES.map(s => ({ id: `fish:${s.id}`, name: s.name, icon: fishIcon(s), cat: 'fish', value: vcOf(s.val), rarity: s.rarity, unique: true, stack: 1, desc: `${s.water === 'sea' ? 'A sea fish' : 'A lake fish'}${s.legend ? ' — a legend' : ''}.` })),
  ...FINDS.map(f => ({ id: `find:${f.id}`, name: f.name, icon: f.icon, cat: f.kind === 'junk' ? 'junk' : 'treasure', value: vcOf(f.val), rarity: f.kind === 'junk' ? 'common' : f.kind === 'coins' ? 'rare' : 'uncommon', stack: f.kind === 'junk' ? 99 : 20, desc: f.kind === 'junk' ? 'Up from the bottom. The dock store takes it off your hands.' : 'Up from the bottom.' })),
  ...LURES.map(l => ({ id: `lure:${l.id}`, name: l.name, icon: l.icon, cat: 'bait', value: Math.round(l.price * 100 / l.pack), stack: 999, desc: l.blurb })),
  ...[...RODS, ...REELS, ...LINES, LEADER].map(g => ({ id: `gear:${g.id}`, name: g.name, icon: g.id.startsWith('reel') ? '⚙️' : '🎣', cat: 'tackle', value: vcOf(g.price || 0), rarity: g.tier >= 5 ? 'legendary' : g.tier >= 4 ? 'epic' : g.tier >= 3 ? 'rare' : g.tier >= 2 ? 'uncommon' : 'common', stack: 9, desc: g.blurb })),
  // food and drink: the cafés' and restaurants' menu items (to take away)
  ...FOOD.map(f => ({ id: `food:${f.id}`, name: f.name, icon: f.icon || '🍽️', cat: 'food', value: f.price || 0, stack: 99, desc: f.course === 'drink' ? 'A drink.' : 'Something to eat.' })),
  // the shops' goods
  { id: 'goods:groceries', name: 'Groceries', icon: '🛒', cat: 'goods', value: 500, stack: 99, desc: 'A bag of groceries.' },
  { id: 'goods:bag', name: 'Shopping bag', icon: '🛍️', cat: 'goods', value: 1200, stack: 99, desc: 'Something from the shops.' },
  { id: 'goods:flowers', name: 'Bunch of flowers', icon: '🎁', cat: 'goods', value: 800, stack: 20, desc: 'A gift for someone.' },
  { id: 'goods:gift', name: 'Gift box', icon: '🎁', cat: 'goods', value: 1500, stack: 20, desc: 'Wrapped, with a bow.' },
]);
