export const STOVE_OVEN_COOKING_METHODS = Object.freeze({
  STOVETOP: 'stovetop',
  OVEN: 'oven',
});

const food = (entry) => Object.freeze({
  ...entry,
  packageColor: entry.cookedColor,
  accentColor: entry.accentColor,
  needEffects: Object.freeze({ hunger: -32, energy: -5 }),
});

export const STOVETOP_FOOD_ITEMS = Object.freeze([
  food({ id: 'veggie-stir-fry', label: 'Veggie Stir-Fry', method: 'stovetop', visualKind: 'stovetop-veggie-stir-fry', rawColor: 0x84cc16, cookingColor: 0xf59e0b, cookedColor: 0x65a30d, accentColor: 0xef4444 }),
  food({ id: 'pancake-stack', label: 'Pancake Stack', method: 'stovetop', visualKind: 'stovetop-pancake-stack', rawColor: 0xfff7ed, cookingColor: 0xfbbf24, cookedColor: 0xd97706, accentColor: 0xfef3c7 }),
  food({ id: 'tomato-pasta', label: 'Tomato Pasta', method: 'stovetop', visualKind: 'stovetop-tomato-pasta', rawColor: 0xfde68a, cookingColor: 0xfb923c, cookedColor: 0xdc2626, accentColor: 0xfacc15 }),
  food({ id: 'grilled-cheese', label: 'Grilled Cheese', method: 'stovetop', visualKind: 'stovetop-grilled-cheese', rawColor: 0xfffbeb, cookingColor: 0xfbbf24, cookedColor: 0xb45309, accentColor: 0xfde047 }),
  food({ id: 'breakfast-skillet', label: 'Breakfast Skillet', method: 'stovetop', visualKind: 'stovetop-breakfast-skillet', rawColor: 0xf8fafc, cookingColor: 0xf59e0b, cookedColor: 0x92400e, accentColor: 0xfef08a }),
]);

export const OVEN_FOOD_ITEMS = Object.freeze([
  food({ id: 'baked-lasagna', label: 'Baked Lasagna', method: 'oven', visualKind: 'oven-baked-lasagna', rawColor: 0xfca5a5, cookingColor: 0xf97316, cookedColor: 0xb91c1c, accentColor: 0xfde68a }),
  food({ id: 'roast-chicken', label: 'Roast Chicken', method: 'oven', visualKind: 'oven-roast-chicken', rawColor: 0xfed7aa, cookingColor: 0xd97706, cookedColor: 0x92400e, accentColor: 0x84cc16 }),
  food({ id: 'chocolate-chip-cookies', label: 'Chocolate Chip Cookies', method: 'oven', visualKind: 'oven-chocolate-chip-cookies', rawColor: 0xfef3c7, cookingColor: 0xd97706, cookedColor: 0x92400e, accentColor: 0x3f2414 }),
  food({ id: 'vegetable-pizza', label: 'Vegetable Pizza', method: 'oven', visualKind: 'oven-vegetable-pizza', rawColor: 0xfff7ed, cookingColor: 0xfbbf24, cookedColor: 0xdc2626, accentColor: 0x22c55e }),
  food({ id: 'baked-salmon', label: 'Baked Salmon', method: 'oven', visualKind: 'oven-baked-salmon', rawColor: 0xfda4af, cookingColor: 0xfb7185, cookedColor: 0xe11d48, accentColor: 0x4ade80 }),
]);

export const STOVE_OVEN_FOOD_ITEMS = Object.freeze([...STOVETOP_FOOD_ITEMS, ...OVEN_FOOD_ITEMS]);
export const STOVE_OVEN_FOOD_ITEM_LABELS = Object.freeze(STOVE_OVEN_FOOD_ITEMS.map(item => item.label));
export const STOVE_OVEN_FOOD_VISUAL_KINDS = Object.freeze(STOVE_OVEN_FOOD_ITEMS.map(item => item.visualKind));
export const STOVE_OVEN_VALID_DROP_OFFS = Object.freeze(['desk', 'diningTable', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'patioTable', 'counter', 'cafeCounter']);

export function normalizeStoveOvenCookingMethod(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'oven' || normalized.includes('bake') ? 'oven' : 'stovetop';
}

export function listStoveOvenFoodsForMethod(method = 'stovetop') {
  return normalizeStoveOvenCookingMethod(method) === 'oven' ? OVEN_FOOD_ITEMS : STOVETOP_FOOD_ITEMS;
}

export function findStoveOvenFoodItem(value = '', method = null) {
  const normalized = String(value || '').trim().toLowerCase();
  const pool = method ? listStoveOvenFoodsForMethod(method) : STOVE_OVEN_FOOD_ITEMS;
  return pool.find(item => item.id === normalized || item.label.toLowerCase() === normalized || item.visualKind === normalized) || null;
}
