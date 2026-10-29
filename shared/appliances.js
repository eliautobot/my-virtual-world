// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Kitchen appliances and what every menu item needs (PLAN-RESTAURANT-GAME.md 6b, the product owner 2026-10-27: "the more
// important thing is making sure that the menu and the required facility/appliances are recognized ... a place starts as
// a coffee shop, but then wants to try adding fries, then that means they need a fryer ... 'to add fries to the menu,
// you will need a fryer' ... they can either manually add a fryer as a furniture item, or the fryer gets automatically
// added to the layout ... for every appliance based on the required ingredient or cooking").
//
// Every food and drink item of the pack (shared/food.js) needs some appliances to be made: an espresso needs the grinder
// and the espresso machine, fries need a fryer, a margherita a pizza oven. A kitchen (shared/kitchen-module.js) that
// has them can make the item; one that hasn't says what it lacks. The sink, the plating counter and the pass every
// kitchen has, so no item names them. An appliance's piece is the furniture placed in a kitchen (shared/catalog.js);
// one without a piece yet comes with its kitchen kind (the grill with the burger kitchen, the taps with the bar …).
import { FOOD_BY_ID } from './food.js';

/** The appliances: key -> { name, a (its article), icon (one with a drawn icon: client/js/core/icons.js), piece: its furniture (null: not made yet), store: storage (one
 *  serves many cooks: a big kitchen gets few more of it) }. */
export const APPLIANCES = Object.freeze({
  grinder: { name: 'coffee grinder', icon: '⚙️', piece: 'ou_grinder' },
  espresso: { name: 'espresso machine', icon: '☕', piece: 'ou_espresso', a: 'an' },
  steamer: { name: 'milk steamer', icon: '🥛', piece: 'ou_steamer' },
  fridge: { name: 'fridge', icon: '🧊', piece: 'ou_fridge', store: true },
  pantry: { name: 'pantry', icon: '🥖', piece: 'ou_pantry', store: true },
  oven: { name: 'oven', icon: '🔥', piece: 'ou_oven', a: 'an' },
  press: { name: 'sandwich press', icon: '🥪', piece: 'ou_press' },
  blender: { name: 'blender', icon: '🌀', piece: 'ou_blender' },
  prep: { name: 'prep counter', icon: '🔪', piece: 'ou_prep' },
  kettle: { name: 'tea kettle', icon: '💧', piece: 'ou_kettle' },
  toaster: { name: 'toaster', icon: '🍞', piece: 'ou_toaster' },
  griddle: { name: 'griddle', icon: '🍳', piece: 'ou_griddle' },
  grill: { name: 'grill', icon: '🥩', piece: 'ou_grill' },
  fryer: { name: 'fryer', icon: '🫧', piece: 'ou_fryer' },
  stove: { name: 'stove', icon: '🥣', piece: 'ou_stove' },
  wok: { name: 'wok burner', icon: '🍜', piece: 'ou_wok' },
  pizza_oven: { name: 'pizza oven', icon: '🍕', piece: 'ou_pizza_oven' },
  tandoor: { name: 'tandoor', icon: '🍛', piece: 'ou_tandoor' },
  rice_cooker: { name: 'rice cooker', icon: '🍣', piece: 'ou_rice' },
  bamboo_steamer: { name: 'bamboo steamer', icon: '🧺', piece: 'ou_bamboo' },
  freezer: { name: 'ice cream freezer', icon: '🍨', piece: 'ou_freezer', a: 'an' },
  soda: { name: 'soda fountain', icon: '🥤', piece: 'ou_soda' },
  juicer: { name: 'juicer', icon: '🧃', piece: 'ou_juicer' },
  taps: { name: 'beer taps', icon: '🍺', piece: 'ou_taps', plural: true },
  wine: { name: 'wine fridge', icon: '🍷', piece: 'ou_wine' },
  cocktail: { name: 'cocktail station', icon: '🍸', piece: 'ou_cocktail' },
  popcorn: { name: 'popcorn machine', icon: '🍿', piece: 'ou_popcorn' },
});
/** "a fryer", "an oven", "beer taps". */
export const applianceWords = k => { const A = APPLIANCES[k]; return A ? (A.plural ? A.name : `${A.a || 'a'} ${A.name}`) : k; };
/** The appliance a kitchen piece is, or null. */
export const APPLIANCE_OF_PIECE = Object.freeze(Object.fromEntries(Object.entries(APPLIANCES).filter(([, A]) => A.piece).map(([k, A]) => [A.piece, k])));

// What each item needs (the pack's 227, by its category in shared/food.js)
const N = s => s.split(' ');
const NEEDS = {
  // coffee & tea
  coffee: N('grinder espresso'), espresso: N('grinder espresso'), coffee_to_go: N('grinder espresso'),
  latte: N('grinder espresso steamer fridge'), cappuccino: N('grinder espresso steamer fridge'), mocha: N('grinder espresso steamer fridge pantry'),
  flat_white: N('grinder espresso steamer fridge'), macchiato: N('grinder espresso steamer fridge'), iced_coffee: N('grinder espresso fridge'),
  cold_brew: N('fridge'), frappe: N('grinder espresso blender fridge'), hot_chocolate: N('steamer fridge pantry'),
  tea: N('kettle'), green_tea: N('kettle'), chai_latte: N('kettle steamer fridge'), matcha_latte: N('kettle steamer fridge'),
  // breakfast & brunch
  pancakes: N('griddle fridge pantry'), waffles: N('griddle fridge pantry'), french_toast: N('griddle fridge pantry'),
  eggs_bacon: N('griddle fridge'), full_breakfast: N('griddle toaster fridge'), omelette: N('griddle fridge'),
  eggs_benedict: N('stove griddle fridge'), avocado_toast: N('toaster prep fridge pantry'), breakfast_burrito: N('griddle prep fridge pantry'),
  yogurt_parfait: N('prep fridge'), oatmeal: N('stove pantry'), acai_bowl: N('blender prep fridge'), bagel_lox: N('toaster prep fridge'),
  // bakery
  croissant: N('oven pantry'), pain_au_chocolat: N('oven pantry'), muffin: N('oven pantry'), cinnamon_roll: N('oven pantry'),
  donut: N('fryer pantry'), bagel: N('toaster pantry'), scone: N('oven pantry'), danish: N('oven pantry'), banana_bread: N('oven pantry'),
  cookie: N('oven pantry'), brownie: N('oven pantry'), pretzel: N('oven pantry'),
  // sandwiches & deli
  club_sandwich: N('prep fridge pantry'), blt: N('prep fridge pantry'), sub: N('prep fridge pantry'), wrap: N('prep fridge pantry'),
  grilled_cheese: N('press fridge pantry'), panini: N('press prep fridge pantry'), reuben: N('press fridge pantry'), tuna_melt: N('press fridge pantry'),
  // burgers & fries
  cheeseburger: N('grill prep fridge pantry'), bacon_burger: N('grill prep fridge pantry'), double_burger: N('grill prep fridge pantry'),
  chicken_burger: N('grill prep fridge pantry'), veggie_burger: N('grill prep fridge pantry'), burger_fries: N('grill fryer prep fridge pantry'),
  hot_dog: N('grill fridge pantry'), nuggets: N('fryer fridge'), fries: N('fryer fridge'), sweet_potato_fries: N('fryer fridge'),
  onion_rings: N('fryer fridge'), milkshake: N('blender freezer fridge'), choc_shake: N('blender freezer fridge'),
  // pizza
  margherita: N('pizza_oven prep fridge pantry'), pepperoni: N('pizza_oven prep fridge pantry'), hawaiian: N('pizza_oven prep fridge pantry'),
  veggie_pizza: N('pizza_oven prep fridge pantry'), four_cheese: N('pizza_oven prep fridge pantry'), bbq_pizza: N('pizza_oven prep fridge pantry'),
  pizza_slice: N('pizza_oven prep fridge pantry'), calzone: N('pizza_oven prep fridge pantry'), garlic_bread: N('oven pantry'),
  // Italian
  spaghetti: N('stove fridge pantry'), carbonara: N('stove fridge pantry'), pasta_pomodoro: N('stove fridge pantry'), alfredo: N('stove fridge pantry'),
  gnocchi: N('stove fridge pantry'), ravioli: N('stove fridge pantry'), lasagna: N('oven stove fridge pantry'), risotto: N('stove fridge pantry'),
  bruschetta: N('oven prep fridge pantry'), caprese: N('prep fridge'), minestrone: N('stove prep fridge'), tiramisu: N('fridge'), gelato: N('freezer'),
  // Mexican
  tacos: N('griddle prep fridge pantry'), burrito: N('griddle prep fridge pantry'), quesadilla: N('griddle fridge pantry'),
  nachos: N('oven prep fridge pantry'), enchiladas: N('oven stove fridge pantry'), fajitas: N('griddle prep fridge pantry'),
  chips_guac: N('fryer prep fridge'), burrito_bowl: N('rice_cooker griddle prep fridge'), churros: N('fryer pantry'), horchata: N('blender fridge'),
  // Chinese, Thai & Vietnamese
  fried_rice: N('wok rice_cooker fridge'), chow_mein: N('wok prep fridge pantry'), kung_pao: N('wok prep fridge pantry'),
  sweet_sour: N('wok prep fridge pantry'), pad_thai: N('wok prep fridge pantry'), dumplings: N('bamboo_steamer fridge pantry'),
  spring_rolls: N('fryer prep fridge'), green_curry: N('stove rice_cooker fridge'), pho: N('stove prep fridge pantry'),
  bao: N('bamboo_steamer fridge pantry'), peking_duck: N('oven fridge'), bubble_tea: N('kettle fridge pantry'),
  // Japanese
  sushi_platter: N('rice_cooker prep fridge'), nigiri: N('rice_cooker prep fridge'), maki: N('rice_cooker prep fridge'), sashimi: N('prep fridge'),
  ramen: N('stove fridge pantry'), tempura: N('fryer fridge pantry'), teriyaki: N('grill rice_cooker fridge'), katsu_curry: N('fryer stove rice_cooker fridge'),
  miso_soup: N('stove pantry'), edamame: N('stove fridge'), gyoza: N('griddle fridge pantry'), mochi: N('freezer'), sake: N('wine'),
  // Indian
  butter_chicken: N('stove rice_cooker fridge'), tikka_masala: N('stove rice_cooker fridge'), biryani: N('stove rice_cooker fridge pantry'),
  dal: N('stove rice_cooker pantry'), palak_paneer: N('stove rice_cooker fridge'), samosas: N('fryer prep pantry'), naan: N('tandoor pantry'),
  tandoori: N('tandoor fridge'), mango_lassi: N('blender fridge'),
  // Mediterranean
  hummus: N('blender prep pantry'), falafel: N('fryer blender pantry'), shawarma: N('grill prep fridge pantry'), kebab: N('grill fridge'),
  gyro: N('grill prep fridge pantry'), greek_salad: N('prep fridge'), moussaka: N('oven stove fridge'), baklava: N('oven pantry'),
  // French
  steak_frites: N('grill fryer fridge'), croque: N('press fridge pantry'), onion_soup: N('stove oven pantry'), quiche: N('oven fridge pantry'),
  coq_au_vin: N('stove fridge'), ratatouille: N('stove oven prep fridge'), creme_brulee: N('oven fridge'), crepes: N('griddle fridge pantry'),
  macarons: N('oven pantry'),
  // seafood
  fish_chips: N('fryer fridge'), salmon: N('grill fridge'), shrimp: N('stove fridge'), lobster: N('stove fridge'), oysters: N('prep fridge'),
  fish_tacos: N('fryer griddle prep fridge'), chowder: N('stove fridge'), paella: N('stove fridge pantry'), calamari: N('fryer fridge'),
  mussels: N('stove fridge'), shrimp_cocktail: N('stove prep fridge'),
  // grill & BBQ
  ribeye: N('grill fridge'), bbq_ribs: N('oven grill fridge'), pulled_pork: N('oven grill fridge'), brisket: N('oven grill fridge'),
  roast_chicken: N('oven fridge'), wings: N('fryer fridge'), mac_cheese: N('stove oven fridge pantry'), corn: N('grill fridge'), mash: N('stove fridge'),
  coleslaw: N('prep fridge'),
  // healthy
  caesar: N('prep fridge'), garden_salad: N('prep fridge'), cobb: N('prep fridge'), poke: N('rice_cooker prep fridge'),
  buddha_bowl: N('rice_cooker prep fridge'), tomato_soup: N('stove fridge'), chicken_soup: N('stove fridge'),
  smoothie: N('blender fridge'), green_smoothie: N('blender fridge'),
  // desserts
  choc_cake: N('oven fridge pantry'), cheesecake: N('oven fridge pantry'), apple_pie: N('oven pantry'), fruit_tart: N('oven fridge pantry'),
  cupcake: N('oven pantry'), lava_cake: N('oven fridge pantry'), sundae: N('freezer pantry'), ice_cream: N('freezer'),
  banana_split: N('freezer prep fridge'), pudding: N('stove fridge'), popcorn: N('popcorn pantry'),
  // soft drinks
  cola: N('soda'), lemon_soda: N('soda'), iced_tea: N('soda'), lemonade: N('juicer fridge'), orange_juice: N('juicer fridge'),
  apple_juice: N('juicer fridge'), water: N('fridge'), sparkling: N('fridge'), soda_can: N('fridge'),
  // the bar
  beer: N('taps'), stout: N('taps'), bottled_beer: N('fridge'), red_wine: N('wine'), white_wine: N('wine'), rose: N('wine'),
  champagne: N('wine'), sangria: N('wine fridge'), margarita: N('cocktail'), mojito: N('cocktail'), martini: N('cocktail'),
  old_fashioned: N('cocktail'), pina_colada: N('cocktail blender'), whiskey: N('cocktail'), gin_tonic: N('cocktail'),
  cosmopolitan: N('cocktail'), aperol: N('cocktail'),
  // a home's own kitchen (homes: not a kitchen module)
  cereal: N('pantry fridge'), toast_jam: N('toaster pantry'), scrambled_eggs: N('stove fridge'), pbj: N('pantry'), stir_fry: N('stove fridge'),
  chicken_veg: N('stove fridge'), home_pasta: N('stove pantry'), instant_noodles: N('kettle pantry'), rice_beans: N('stove pantry'),
  veg_soup: N('stove fridge'), salmon_rice: N('stove fridge'), tacos_home: N('stove fridge pantry'), lunchbox: N('fridge'), leftovers: N('fridge'),
  glass_milk: N('fridge'), glass_water: [],
};
for (const [id, ks] of Object.entries(NEEDS)) for (const k of ks) if (!APPLIANCES[k]) throw new Error(`appliances: ${id} needs unknown ${k}`);

/** The appliances item id needs (its keys), [] for an unknown item. */
export const needsOf = id => NEEDS[id] || [];
/** Whether every item of the pack says what it needs (tests). */
export const NEEDS_IDS = Object.freeze(Object.keys(NEEDS));
/** The appliances a kitchen has: its pieces' types -> a set of appliance keys. */
export const appliancesIn = types => new Set([...types].map(t => APPLIANCE_OF_PIECE[t]).filter(Boolean));
/** What a menu (item ids) needs that a kitchen with appliances `have` lacks: [{ key, items: [ids] }], the most wanted first. */
export function missingFor(ids, have) {
  const by = new Map();
  for (const id of ids) for (const k of needsOf(id)) if (!have.has(k)) (by.get(k) || by.set(k, []).get(k)).push(id);
  return [...by].map(([key, items]) => ({ key, items })).sort((a, b) => b.items.length - a.items.length);
}
/** The appliances a menu needs, each with how many of its items need it: Map key -> count. */
export function menuNeeds(ids) {
  const m = new Map();
  for (const id of ids) for (const k of needsOf(id)) m.set(k, (m.get(k) || 0) + 1);
  return m;
}
/** "To add Fries to the menu, you will need a fryer" (the menu editor's words). */
export function needWords(id, have) {
  const miss = needsOf(id).filter(k => !have.has(k)), it = FOOD_BY_ID[id];
  if (!miss.length) return '';
  const list = miss.map(applianceWords), words = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
  return `To add ${it?.name || id} to the menu, you will need ${words}`;
}
