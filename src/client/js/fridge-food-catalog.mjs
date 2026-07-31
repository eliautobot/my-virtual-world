export const FRIDGE_FOOD_CATALOG_VERSION = 'fridge-food/v1';

export const FRIDGE_FOOD_ITEMS = Object.freeze([
  Object.freeze({
    id: 'greek-yogurt-cup',
    label: 'Greek Yogurt Cup',
    visualKind: 'fridge-greek-yogurt-cup',
    packageColor: 0xf8fafc,
    accentColor: 0x2563eb,
    needEffects: Object.freeze({ hunger: -26, thirst: -2 }),
  }),
  Object.freeze({
    id: 'red-apple',
    label: 'Red Apple',
    visualKind: 'fridge-red-apple',
    packageColor: 0xdc2626,
    accentColor: 0x65a30d,
    needEffects: Object.freeze({ hunger: -20, thirst: -3 }),
  }),
  Object.freeze({
    id: 'fresh-orange',
    label: 'Fresh Orange',
    visualKind: 'fridge-fresh-orange',
    packageColor: 0xf97316,
    accentColor: 0x15803d,
    needEffects: Object.freeze({ hunger: -18, thirst: -5 }),
  }),
  Object.freeze({
    id: 'green-grape-bunch',
    label: 'Green Grape Bunch',
    visualKind: 'fridge-green-grape-bunch',
    packageColor: 0x84cc16,
    accentColor: 0x166534,
    needEffects: Object.freeze({ hunger: -18, thirst: -4 }),
  }),
  Object.freeze({
    id: 'garden-salad-bowl',
    label: 'Garden Salad Bowl',
    visualKind: 'fridge-garden-salad-bowl',
    packageColor: 0x22c55e,
    accentColor: 0xef4444,
    needEffects: Object.freeze({ hunger: -34, thirst: -2 }),
  }),
  Object.freeze({
    id: 'sushi-box',
    label: 'Sushi Box',
    visualKind: 'fridge-sushi-box',
    packageColor: 0x111827,
    accentColor: 0xf97316,
    needEffects: Object.freeze({ hunger: -38, thirst: 0 }),
  }),
  Object.freeze({
    id: 'cheese-wedges',
    label: 'Cheese Wedges',
    visualKind: 'fridge-cheese-wedges',
    packageColor: 0xfacc15,
    accentColor: 0xf59e0b,
    needEffects: Object.freeze({ hunger: -28, thirst: 1 }),
  }),
  Object.freeze({
    id: 'berry-parfait',
    label: 'Berry Parfait',
    visualKind: 'fridge-berry-parfait',
    packageColor: 0xf8fafc,
    accentColor: 0xdb2777,
    needEffects: Object.freeze({ hunger: -30, thirst: -2 }),
  }),
  Object.freeze({
    id: 'carrot-snack-pack',
    label: 'Carrot Snack Pack',
    visualKind: 'fridge-carrot-snack-pack',
    packageColor: 0xf97316,
    accentColor: 0x16a34a,
    needEffects: Object.freeze({ hunger: -22, thirst: -2 }),
  }),
  Object.freeze({
    id: 'turkey-avocado-wrap',
    label: 'Turkey Avocado Wrap',
    visualKind: 'fridge-turkey-avocado-wrap',
    packageColor: 0xd6a34a,
    accentColor: 0x65a30d,
    needEffects: Object.freeze({ hunger: -42, thirst: 0 }),
  }),
]);

export const FRIDGE_FOOD_ITEM_IDS = Object.freeze(FRIDGE_FOOD_ITEMS.map(item => item.id));
export const FRIDGE_FOOD_ITEM_LABELS = Object.freeze(FRIDGE_FOOD_ITEMS.map(item => item.label));
export const FRIDGE_FOOD_VISUAL_KINDS = Object.freeze(FRIDGE_FOOD_ITEMS.map(item => item.visualKind));

export function findFridgeFoodItem(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return FRIDGE_FOOD_ITEMS.find(item =>
    item.id === normalized ||
    item.label.toLowerCase() === normalized ||
    item.visualKind === normalized
  ) || null;
}
