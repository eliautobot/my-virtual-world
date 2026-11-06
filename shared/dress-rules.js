// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The dressing's rules (PLAN-SURFACES.md 4.4, 5): which small things a piece of furniture holds by itself, by where it
// stands (the floor's context: an office, a home, a café, a shop by what it sells ...), what it is (its host class,
// shared/surfaces.js hostClass: a desk, a kitchen counter, a store shelf ...) and which of its surfaces (a top, a shelf, a
// high top, a ledge). A rule: the goods tags it draws from (weights), how many (n per piece, per metre of a top, or the
// share of a shelf's length filled in rows) and how they stand (layout and place). The first rule that matches wins; a
// piece no rule matches holds nothing of its own. shared/dress.js lays them out.
//   layout  scatter: anywhere on the top that is free (place 'back': the back half and the sides, leaving the front where
//           someone works or is served); row: side by side along a shelf, facing the aisle, facings of the same model;
//           centre: one piece in the middle (a vase, a candle), then `n` more scattered
//   n       [min, max] things per piece (scatter, centre's extras); per: per metre of the surface's length instead
//   fill    share of a shelf's length filled (row); facings [min, max] of one model side by side
//   maxH    tallest thing (m) on an open top (a desk keeps its monitor in sight)
//   seat    keep where people sit and work clear (their laptop, their plate: the seats of the piece's slots)
//   chance  share of such pieces dressed at all (café tables: some have a candle)
//   half    on a shelf drawn full of MVW's books (fill 'books'), only this share of it, at one end (the rest keeps its books)
//   maxW    a thing's largest side (m) on that top (no big packs on a desk; 0.35 for any scattered top, a share of its area too:
//           shared/dress.js SCATTER_AREA); tagW the same for one tag (a desk's plant a small pot)
//   caps    things of one family a piece holds at most (shared/dress.js family: drink = a mug, a cup or a drink; pack = a
//           boxed pack); scattered and centred tops: one drink and one pack unless said, and never the same model twice
//   avoid   names of things that do not belong there (a desk has its own monitor, keyboard and mouse: no second one)
//   prefer  names of the things a floor's pools take first for this piece (small desk things: pen holders, notebooks ...)
//   pool    the rule's weight in its floor's share of models (the pieces a floor has most of: an office's desks); under 1:
//           pieces few floors have (a studio desk, a cabinet's high top) get models only when the floor has some to spare

/** Goods per kind of shop (shared/store-goods.js): tags (weights), the share of a shelf filled, facings. Franchise items
 *  (shared/goods-items.js franchise) only in the shops that sell such things (games, toys, music, books). */
export const STORE_GOODS = {
  general: { tags: { 'food-pack': 2, household: 2, kitchen: 1, toy: 1, electronics: 1, 'office-supply': 1, beauty: 1, tableware: 1 }, fill: 0.8, facings: [1, 3] },
  grocery: { tags: { 'food-pack': 6, drink: 3, kitchen: 1, household: 1 }, fill: 0.9, facings: [2, 4], avoid: /compost|drainer|knife block/i },
  convenience: { tags: { 'food-pack': 4, drink: 3, beauty: 1, pharmacy: 1, household: 1, 'office-supply': 1 }, fill: 0.85, facings: [1, 3] },
  shoes: { tags: { shoe: 1 }, fill: 0.85, facings: [1, 2] },
  clothing: { tags: { shoe: 2, bag: 2, clothing: 2 }, fill: 0.6, facings: [1, 2], avoid: /lunch|laptop|camera|cooler|helmet|pencil/i },
  books: { tags: { media: 2, game: 1, 'office-supply': 1, decor: 1 }, fill: 0.4, facings: [1, 2], franchise: true },
  music: { tags: { media: 5, electronics: 2 }, fill: 0.8, facings: [1, 3], franchise: true },
  electronics: { tags: { electronics: 5, cable: 3, media: 1 }, fill: 0.8, facings: [1, 2] },   // (no board games)
  games: { tags: { game: 4, media: 3, toy: 2, electronics: 1 }, fill: 0.85, facings: [1, 3], franchise: true, avoid: /router|motherboard|drive|usb|hub|printer|mount|viewer|charger|card box/i },
  toys: { tags: { toy: 5, game: 3 }, fill: 0.85, facings: [1, 2], franchise: true },
  homeware: { tags: { tableware: 3, cookware: 3, decor: 3, kitchen: 2, 'storage-box': 2, candle: 1, plant: 1 }, fill: 0.75, facings: [1, 2] },
  florist: { tags: { plant: 6, decor: 2 }, fill: 0.8, facings: [1, 2] },
  stationery: { tags: { 'office-supply': 6, 'desk-item': 2, bag: 1 }, fill: 0.85, facings: [1, 3] },
  beauty: { tags: { beauty: 6, pharmacy: 2 }, fill: 0.85, facings: [1, 3] },
  pharmacy: { tags: { pharmacy: 5, beauty: 3, household: 1, baby: 1 }, fill: 0.85, facings: [1, 3] },
  outdoor: { tags: { bag: 3, shoe: 3, sport: 2, clothing: 1 }, fill: 0.75, facings: [1, 2] },
  pet: { tags: { pet: 5, 'food-pack': 1 }, fill: 0.8, facings: [1, 3] },
  tackle: null,   // (MVW's own dock store: its rods, lures and bait are drawn with its pieces)
};

/** What a desk holds: never a second monitor, keyboard, mouse or laptop (it has its own), no big boxes or children's crafts;
 *  small things first (pen holders, stands, notebooks, scissors, cables, a drive, a headset, a small plant). */
/** What a TV stand holds: games, films, a console or a speaker; no computer parts. */
const TV_AVOID = /motherboard|router|keyboard|printer|graphics|card box|hub|drive|mount|viewer|mouse/i;
const DESK_AVOID = /monitor|mouse|keyboard|laptop|motherboard|router|laminator|crayon|chalk|clay|paint|card kit|printer|viewer|mount|console|drink pack|file folder/i, DESK_PREFER = /organi[sz]er|stand\b|holder|notebook|scissors|label|tape|cable|charg|usb|drive|headset|speaker|tablet|pot\b|mug/i;

// [contexts ('*' any; 'shop' any shop), host classes, surface kinds, rule]
const R = (ctx, cls, kinds, rule) => ({ ctx: ctx.split(' '), cls: cls.split(' '), kinds: kinds.split(' '), ...rule });
export const RULES = [
  // nothing of their own: the arcade's prizes, the club's bottles and the dock store's tackle are drawn with their pieces
  R('arcade club shop:tackle', '*', '*', { none: true }),
  // studios (a radio studio's desks, anywhere)
  R('*', 'studio_desk', 'top', { tags: { electronics: 2, mug: 2, 'office-supply': 1, drink: 1 }, n: [1, 3], layout: 'scatter', place: 'back', maxH: 0.3, seat: true, maxW: 0.25, avoid: DESK_AVOID, pool: 0.2 }),   // (few floors have one)

  // offices
  R('office', 'desk', 'top', { tags: { 'desk-item': 3, cable: 3, mug: 2, 'office-supply': 3, plant: 1, electronics: 2, drink: 0.5 }, n: [3, 5], layout: 'scatter', place: 'back', maxH: 0.3, seat: true, maxW: 0.24, tagW: { plant: 0.16 }, caps: { drink: 1, pack: 1, plant: 1 }, avoid: DESK_AVOID, prefer: DESK_PREFER, pool: 4 }),
  R('office', 'meeting', 'top', { tags: { mug: 3, drink: 2, 'office-supply': 2, electronics: 1 }, n: [2, 5], layout: 'scatter', maxH: 0.25, seat: true, maxW: 0.25, caps: { drink: 4, pack: 1 }, avoid: DESK_AVOID }),
  R('office terminal', 'service', 'top ledge', { tags: { 'office-supply': 2, plant: 1, electronics: 1, mug: 1 }, n: [1, 3], layout: 'scatter', place: 'back', maxH: 0.35, seat: true, maxW: 0.3, avoid: DESK_AVOID }),
  R('office', 'books open_shelf wall_shelf', 'shelf top', { tags: { 'storage-box': 3, 'office-supply': 3, decor: 2, plant: 1 }, fill: 0.3, facings: [1, 2], layout: 'row', half: 0.4 }),
  R('office', 'kitchen_counter', 'top', { tags: { mug: 3, tableware: 2, drink: 2, 'food-pack': 1, kitchen: 1 }, per: [1, 2], layout: 'scatter', place: 'back', maxH: 0.4, seat: true, caps: { drink: 2, pack: 1 } }),
  R('office', 'coffee side', 'top', { tags: { plant: 1, decor: 1, 'office-supply': 1, mug: 1 }, n: [0, 2], layout: 'scatter', maxH: 0.4, maxW: 0.3 }),
  R('office', 'dining cafe_table', 'top', { tags: { plant: 1, mug: 1, decor: 1 }, n: [0, 1], layout: 'centre', chance: 0.6, maxH: 0.35, seat: true, maxW: 0.3 }),

  // homes
  R('home', 'kitchen_counter', 'top', { tags: { cookware: 3, tableware: 3, kitchen: 2, 'food-pack': 2, drink: 1, plant: 1 }, per: [1.7, 3.3], layout: 'scatter', place: 'back', maxH: 0.4, seat: true, maxW: 0.45, caps: { drink: 2, pack: 2 }, pool: 2 }),
  R('home', 'dining', 'top', { tags: { candle: 2, plant: 1, decor: 2 }, extra: { tableware: 2, 'food-pack': 1, drink: 1 }, n: [0, 2], layout: 'centre', maxH: 0.45, seat: true, maxW: 0.3 }),
  R('home', 'coffee', 'top', { tags: { decor: 2, media: 2, mug: 2, game: 1, plant: 1, candle: 1 }, n: [1, 3], layout: 'scatter', maxH: 0.35, maxW: 0.3, pool: 1.5 }),
  R('home', 'coffee', 'shelf', { tags: { media: 2, game: 1, 'storage-box': 1, decor: 1 }, n: [0, 2], layout: 'scatter', maxW: 0.45 }),
  R('home', 'nightstand', 'top', { tags: { decor: 2, cable: 1, mug: 1, beauty: 1, media: 1 }, n: [1, 2], layout: 'scatter', maxH: 0.3, maxW: 0.2, avoid: /hair|toothbrush|dryer|straightener/i }),
  R('home', 'nightstand', 'shelf', { tags: { media: 1, 'storage-box': 1, decor: 1 }, n: [0, 1], layout: 'scatter' }),
  R('home', 'dresser', 'top', { tags: { beauty: 3, decor: 2, 'storage-box': 1, candle: 1, lamp: 1 }, n: [2, 4], layout: 'scatter', maxH: 0.55, avoid: /toothbrush/i }),
  R('home', 'tv', 'top', { tags: { game: 2, media: 3, electronics: 2, decor: 1, plant: 1 }, n: [2, 4], layout: 'scatter', maxH: 0.3, maxW: 0.3, avoid: TV_AVOID, prefer: /console|controller|speaker|headset|remote|tablet|camera|card game|software|book/i, pool: 1.5 }),
  R('home', 'tv', 'shelf', { tags: { game: 3, media: 1, electronics: 1, 'storage-box': 1, decor: 1 }, n: [0, 2], layout: 'scatter', maxW: 0.45, avoid: TV_AVOID }),
  R('home', 'books open_shelf wall_shelf', 'shelf top', { tags: { decor: 2, 'storage-box': 2, media: 2, plant: 1, game: 1, toy: 0.5 }, fill: 0.4, facings: [1, 2], layout: 'row', half: 0.4 }),
  R('home', 'desk', 'top', { tags: { 'desk-item': 3, cable: 2, mug: 2, 'office-supply': 2, electronics: 1, plant: 1 }, n: [2, 4], layout: 'scatter', place: 'back', maxH: 0.3, seat: true, maxW: 0.24, tagW: { plant: 0.16 }, caps: { drink: 1, pack: 1, plant: 1 }, avoid: DESK_AVOID, prefer: DESK_PREFER }),
  R('home', 'side', 'top', { tags: { lamp: 2, decor: 2, plant: 1, candle: 1, media: 1 }, n: [0, 2], layout: 'scatter', maxH: 0.55, maxW: 0.3 }),
  R('home', 'cafe_table', 'top', { tags: { plant: 1, candle: 1, decor: 1 }, n: [0, 0], layout: 'centre', chance: 0.5, maxH: 0.35, seat: true }),

  // cafés
  R('cafe', 'cafe_counter', 'top', { tags: { tableware: 3, mug: 2, drink: 2, 'food-pack': 1, plant: 0.5 }, n: [2, 5], layout: 'scatter', place: 'back', maxH: 0.35, seat: true, maxW: 0.25, caps: { drink: 3, pack: 1 }, avoid: /drink pack|tray/i, pool: 2 }),
  R('cafe', 'bar', 'top', { tags: { tableware: 2, mug: 2, drink: 1 }, n: [1, 3], layout: 'scatter', place: 'back', maxH: 0.35, seat: true, maxW: 0.25, caps: { drink: 2, pack: 1 }, avoid: /drink pack/i }),
  R('cafe', 'cafe_table dining', 'top', { tags: { plant: 1, candle: 1, decor: 1 }, n: [0, 0], layout: 'centre', chance: 0.3, maxH: 0.3, seat: true }),
  R('cafe', 'books open_shelf wall_shelf', 'shelf top', { tags: { tableware: 2, 'food-pack': 2, plant: 2, decor: 1, media: 1, drink: 1 }, fill: 0.5, facings: [1, 3], layout: 'row', half: 0.45 }),
  R('cafe', 'ledge', 'top', { tags: { plant: 1, mug: 1, media: 0.5 }, n: [0, 2], layout: 'scatter', maxH: 0.3, maxW: 0.2 }),

  // restaurants
  R('restaurant', 'dining cafe_table', 'top', { tags: { candle: 2, plant: 1, decor: 1 }, n: [0, 0], layout: 'centre', chance: 0.7, maxH: 0.35, seat: true }),
  R('restaurant bar', 'bar', 'top', { tags: { drink: 2, tableware: 2 }, n: [1, 3], layout: 'scatter', place: 'back', maxH: 0.35, seat: true, maxW: 0.3, caps: { drink: 2, pack: 1 }, avoid: /drink pack/i }),
  R('restaurant', 'books open_shelf wall_shelf', 'shelf top', { tags: { drink: 2, tableware: 2, plant: 1, decor: 1 }, fill: 0.4, facings: [1, 2], layout: 'row', half: 0.4 }),
  R('restaurant', 'cafe_counter service', 'top', { tags: { tableware: 2, 'food-pack': 1, plant: 1 }, n: [1, 3], layout: 'scatter', place: 'back', maxH: 0.35, seat: true, maxW: 0.3 }),

  // lounges and bars (not the club)
  R('bar', 'cafe_table coffee dining', 'top', { tags: { candle: 2, decor: 1, plant: 1 }, n: [0, 0], layout: 'centre', chance: 0.5, maxH: 0.3, seat: true }),

  // shops: the store's own goods on its shelves and tables, a few small things at the checkout
  R('shop', 'store_shelf', 'shelf top', { store: true, layout: 'row' }),
  R('shop', 'store_table', 'top', { store: true, layout: 'row', fill: 0.6 }),
  R('shop', 'books open_shelf wall_shelf cabinet storage', 'shelf top', { store: true, layout: 'row', fill: 0.6 }),
  R('shop:grocery shop:convenience shop:general', 'service', 'top', { tags: { 'food-pack': 2, drink: 1 }, n: [1, 3], layout: 'scatter', maxH: 0.25, maxW: 0.25, caps: { drink: 1, pack: 2 } }),
  R('shop', 'service', 'top', { store: true, n: [0, 2], layout: 'scatter', maxH: 0.25, maxW: 0.25 }),

  // kitchens behind a café, a restaurant or a bar; their receptions; a lounge's low tables
  R('cafe restaurant', 'kitchen_counter', 'top', { tags: { cookware: 2, tableware: 2, kitchen: 2, 'food-pack': 1 }, per: [1, 2], layout: 'scatter', place: 'back', maxH: 0.4, seat: true }),
  R('bar', 'kitchen_counter', 'top', { tags: { drink: 2, tableware: 2, kitchen: 1 }, per: [0.5, 1.5], layout: 'scatter', place: 'back', maxH: 0.4, seat: true }),
  R('cafe restaurant bar', 'service', 'top ledge', { tags: { plant: 1, 'office-supply': 1, mug: 1 }, n: [1, 2], layout: 'scatter', place: 'back', maxH: 0.35, seat: true, maxW: 0.3, avoid: DESK_AVOID }),
  R('gym', 'service', 'top ledge', { tags: { drink: 2, sport: 1, plant: 1, 'office-supply': 1 }, n: [1, 3], layout: 'scatter', place: 'back', maxH: 0.35, seat: true, maxW: 0.3, avoid: DESK_AVOID }),
  R('cafe bar', 'coffee side', 'top', { tags: { plant: 1, candle: 1, media: 1, decor: 1 }, n: [0, 2], layout: 'scatter', maxH: 0.35, maxW: 0.3 }),

  // parks: a picnic now and then
  R('park', 'picnic', 'top', { tags: { 'food-pack': 1, drink: 1, tableware: 1, bag: 0.5 }, n: [0, 2], layout: 'scatter', chance: 0.4, maxH: 0.3, seat: true, maxW: 0.3 }),
  R('gym', 'cabinet', 'high', { tags: { sport: 1, drink: 1, bag: 1 }, n: [0, 1], layout: 'scatter', maxW: 0.4 }),

  // anywhere else: a box or a plant on a high top, now and then
  R('office home cafe restaurant bar shop', 'cabinet storage books open_shelf', 'high', { tags: { 'storage-box': 3, plant: 1, decor: 1 }, n: [0, 2], layout: 'scatter', chance: 0.6, maxW: 0.4, pool: 0.5 }),
  R('office', 'cabinet storage', 'top', { tags: { 'storage-box': 2, plant: 2, 'office-supply': 1 }, n: [0, 2], layout: 'scatter', maxH: 0.45, pool: 0.5 }),
  R('home', 'cabinet storage', 'top', { tags: { 'storage-box': 2, decor: 2, plant: 1, lamp: 1 }, n: [0, 2], layout: 'scatter', maxH: 0.5 }),
];

/** The rule for a piece of class cls's surface of kind kind on a floor of context ctx (shop floors: 'shop:<kind>'), or null. */
export function ruleFor(ctx, cls, kind) {
  if (!ctx || !cls) return null;
  const shop = ctx.startsWith('shop:');
  for (const r of RULES) {
    if (!r.ctx.some(c => c === '*' || c === ctx || (shop && c === 'shop'))) continue;
    if (!r.cls.includes('*') && !r.cls.includes(cls)) continue;
    if (!r.kinds.includes('*') && !r.kinds.includes(kind)) continue;
    if (r.none) return null;
    if (!r.store) return r;
    const G = STORE_GOODS[ctx.slice(5)];
    if (!G) return null;
    return { ...r, tags: G.tags, fill: r.fill ?? G.fill, facings: G.facings, franchise: !!G.franchise, avoid: G.avoid };
  }
  return null;
}
