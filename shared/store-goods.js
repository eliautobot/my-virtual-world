// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a shop floor sells (PLAN-SURFACES.md 4.5): the level's `goods` (set by its owner with the edit op lvl.goods; absent:
// the default the dressing derives from the building, its tackle or clothes, or its shop name). The goods rules per kind
// come with the dressing (shared/dress-rules.js).
export const STORE_KINDS = {
  general: 'General store', grocery: 'Grocery', convenience: 'Convenience store', shoes: 'Shoes', clothing: 'Clothing',
  books: 'Books', music: 'Music', electronics: 'Electronics', games: 'Games', toys: 'Toys', homeware: 'Homeware',
  florist: 'Florist', stationery: 'Stationery', beauty: 'Beauty', pharmacy: 'Pharmacy', outdoor: 'Outdoor', pet: 'Pets',
  tackle: 'Tackle and bait',
};
export const STORE_KIND_IDS = Object.keys(STORE_KINDS);
export const storeKindOk = k => typeof k === 'string' && Object.hasOwn(STORE_KINDS, k);
