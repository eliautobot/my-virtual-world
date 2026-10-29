// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up's kitchen templates (PLAN-RESTAURANT-GAME.md 6b K4, the product owner 2026-10-27: "different restaurant have
// different dishes, equipment, etc... so i think this is a good first template for the rest"): everything one kind of
// kitchen cooks, as data the rules (shared/orderup/rules.js) play. A place's kitchen follows what it is: a café's or a
// restaurant's cuisine (shared/food.js), a lounge's or a club's bar, an arcade's snack bar.
//
// A template:
//   dishes    id -> { name, icon, price, hot | food, needs: the station kinds it takes, ware: what it is served in (none:
//             as it is, a burger in its wrap), uses: what it takes from the dispensers, items: the menu items it is
//             (shared/food.js; its id when not given: a cappuccino is made as a latte is, a mojito as any cocktail; its
//             ticket says which), sold: only where its place's menu has it (a bottle of water: any kitchen with a fridge
//             could, few sell it) }; a Rush's menu is the dishes whose stations are all in the kitchen and that its
//             place sells (newRush o.menu: the item ids on its menu)
//   stations  station kind (a catalog piece, ou_*) -> what it does:
//               give     a dispenser: `gives` (in turn; press again to swap), each fresh in its `fresh` state; in a
//                        Rush only what its menu uses
//               cook     cooks by itself: what it takes (k, a kind or kinds, in state from), done after `cook` s as `to`,
//                        perfect for `perfect` s more, `over` at `burn` s; `loaded`: needs that loaded into it first
//                        (the espresso machine's grounds), used up by each go; `tend`: cooks only while someone holds
//                        (F) at it (the wok, tossed)
//               make     held (F): `makes` an item in state `st` out of nothing after `s` s (the grinder's grounds)
//               chop     held (F) on what lies on it: k (a kind or kinds) from -> to after `s` s; a counter too
//               pour     E holding a clean `into` (a kind or kinds) here: filled with what is chosen of `gives` (the
//                        wine fridge's red, white and bubbly), at once; `food`: what is given goes onto it instead (the
//                        rice cooker's rice into a bowl or onto a plate, the freezer's ice cream into a bowl)
//               plating  the stacks of `ware` (in a Rush only those its menu is served in); a counter too
//               sink     put dirty ware in (up to `holds`), held: washed one at a time, `s` s each, back on its stack
//               dishes   the dish return: dirty ware comes back here after a dish is served
//               pass     where dishes are served
//               bin      throws away what you hold
//             counter: true: anything may be put down on it
//   fresh     an item kind -> the state a dispenser gives it in
//   ware      plate, cup, glass... -> { stack: its count's name on the plating counter, clean: its clean state, n: how
//             many a Rush starts with, on: true when food is put ON it (a plate) rather than poured in }
//   onWare    a food -> the states it may go onto a plate in (done, or over: then it is burnt); only onto ware it is
//             served on (soup into a bowl, not onto a plate)
//   combos    what two things make put together (either way round), in order: a, b: [kind, state or states, or none:
//             any]; { onto: [ware, food on it], b, on: what it is then }: put onto the food on ware (curry over its rice);
//             any]; the result keeps a, b is used up: its new kind k and state st, its steps' scores q ('both', 'a',
//             'b', 'none'), art: latte art when both steps scored at least that; { onWare: true }: a food onto clean
//             ware (held: the ware stays in hand, the food on it)
//   served    ware or item kind -> its state (or, for ware with food on it, the food) -> the dish it is
//   say       what an item is called where its kind and state don't say it well: 'kind:state' or 'kind' -> words
//   place     how its kitchen is laid out (shared/kitchen-module.js): [station, the rows it likes in order (back: the
//             back wall; side: the outer side wall; front: the front wall on the far side of the hatch; door: the
//             front wall on the door's side of it; island: down the middle of a deep kitchen), and a station it
//             needs there first]; in this order, the ones every dish needs first; the pass in the hatch, the order rail
//             over it and the fire extinguisher by the door always
//   byMenu    stations laid only when its menu needs them (shared/appliances.js), [station, rows it likes]: the tea
//             station, the toaster … a café that sells toast, tea or fries gets them
//   more      then, as long as there is room, more of these, round after round (a bigger kitchen: more cooks at once,
//             agents too; the product owner 2026-10-27: "kitchens can be made bigger with more appliances as needed")

import { withMenuDishes } from './menu-dishes.js';
import { FOOD_BY_ID } from '../food.js';
import { needsOf, APPLIANCES } from '../appliances.js';

const BASE = Object.freeze({
  id: 'coffee', name: 'Coffee bar', icon: '☕',
  dishes: {
    espresso: { name: 'Espresso', icon: '☕', price: 3, hot: true, ware: 'cup', uses: [], items: ['espresso', 'coffee'], needs: ['ou_grinder', 'ou_espresso', 'ou_plating'] },
    latte: { name: 'Latte', icon: '🥛', price: 4.5, hot: true, ware: 'cup', uses: ['milk'], items: ['latte', 'cappuccino', 'flat_white', 'macchiato'], needs: ['ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_fridge', 'ou_plating'] },
    smoothie: { name: 'Berry Smoothie', icon: '🥤', price: 5, hot: false, ware: 'glass', uses: ['berries'], items: ['smoothie', 'green_smoothie'], needs: ['ou_blender', 'ou_fridge', 'ou_plating'] },
    croissant: { name: 'Warm Croissant', icon: '🥐', price: 3.5, food: true, ware: 'plate', uses: ['croissant'], items: ['croissant', 'pain_au_chocolat'], needs: ['ou_oven', 'ou_pantry', 'ou_plating'] },
    toastie: { name: 'Tomato Toastie', icon: '🥪', price: 6, food: true, items: ['panini'], ware: 'plate', uses: ['bread', 'tomato'], needs: ['ou_press', 'ou_prep', 'ou_pantry', 'ou_fridge', 'ou_plating'] },
    // (2026-10-28, the product owner: "to add fries to the menu, you will need a fryer": what the new appliances cook)
    fries: { name: 'Fries', icon: '🍔', price: 3.5, food: true, ware: 'plate', uses: ['fries'], items: ['fries', 'sweet_potato_fries'], needs: ['ou_fryer', 'ou_fridge', 'ou_plating'] },
    cheeseburger: { name: 'Cheeseburger', icon: '🍔', price: 8, food: true, uses: ['patty', 'bun'], items: ['cheeseburger', 'bacon_burger', 'double_burger', 'veggie_burger', 'chicken_burger'], needs: ['ou_grill', 'ou_prep', 'ou_fridge', 'ou_pantry'] },
    pancakes: { name: 'Pancakes', icon: '🍳', price: 6.5, food: true, ware: 'plate', uses: ['batter'], needs: ['ou_griddle', 'ou_fridge', 'ou_pantry', 'ou_plating'] },
    avocado_toast: { name: 'Avocado Toast', icon: '🍞', price: 7, food: true, ware: 'plate', uses: ['bread', 'avocado'], needs: ['ou_toaster', 'ou_prep', 'ou_pantry', 'ou_fridge', 'ou_plating'] },
    cola: { name: 'Cola', icon: '🥤', price: 2.5, hot: false, ware: 'glass', uses: [], items: ['cola', 'lemon_soda', 'iced_tea'], needs: ['ou_soda', 'ou_plating'] },
    tea: { name: 'Tea', icon: '☕', price: 2.5, hot: true, ware: 'cup', uses: [], items: ['tea', 'green_tea'], needs: ['ou_kettle', 'ou_plating'] },
    orange_juice: { name: 'Orange Juice', icon: '🧃', price: 4, hot: false, ware: 'glass', uses: ['orange'], needs: ['ou_juicer', 'ou_fridge', 'ou_plating'] },
    // the bar (2026-10-28: lounges, clubs: "Drinks and maybe drinking appetizers for lounges, bars, clubs")
    beer: { name: 'Beer', icon: '🍺', price: 6, hot: false, ware: 'glass', uses: [], items: ['beer', 'stout'], needs: ['ou_taps', 'ou_plating'] },
    red_wine: { name: 'Red Wine', icon: '🍷', price: 9, hot: false, ware: 'wineglass', uses: ['red'], needs: ['ou_wine', 'ou_plating'] },
    white_wine: { name: 'White Wine', icon: '🍷', price: 9, hot: false, ware: 'wineglass', uses: ['white'], items: ['white_wine', 'rose'], needs: ['ou_wine', 'ou_plating'] },
    champagne: { name: 'Champagne', icon: '🍾', price: 14, hot: false, ware: 'wineglass', uses: ['bubbly'], needs: ['ou_wine', 'ou_plating'] },
    cocktail: { name: 'Cocktail', icon: '🍸', price: 12, hot: false, ware: 'coupe', uses: [], items: ['martini', 'old_fashioned', 'gin_tonic', 'aperol', 'whiskey', 'margarita', 'mojito', 'cosmopolitan'],
      needs: ['ou_cocktail', 'ou_plating'] },
    // the pizza oven, the stove and the wok (2026-10-28: an Italian's, a pizzeria's, an Asian kitchen's, and the stove's
    // pasta and soup on fifteen kinds of menu)
    pizza: { name: 'Pizza', icon: '🍕', price: 12, food: true, ware: 'plate', uses: ['dough', 'tomato'], items: ['margherita', 'pepperoni', 'hawaiian', 'veggie_pizza', 'four_cheese', 'bbq_pizza', 'pizza_slice'],
      needs: ['ou_pizza_oven', 'ou_prep', 'ou_fridge', 'ou_pantry', 'ou_plating'] },
    pasta: { name: 'Pasta', icon: '🍝', price: 11, food: true, ware: 'plate', uses: ['pasta'], items: ['spaghetti', 'carbonara', 'pasta_pomodoro', 'alfredo', 'gnocchi', 'ravioli'],
      needs: ['ou_stove', 'ou_fridge', 'ou_pantry', 'ou_plating'] },
    soup: { name: 'Soup', icon: '🥣', price: 7, food: true, ware: 'bowl', uses: ['stock', 'tomato'], items: ['tomato_soup', 'minestrone', 'chicken_soup', 'chowder'],
      needs: ['ou_stove', 'ou_prep', 'ou_fridge', 'ou_plating'] },
    stir_fry: { name: 'Stir-fry', icon: '🍜', price: 11, food: true, ware: 'bowl', uses: ['noodles', 'pepper'], items: ['chow_mein', 'pad_thai', 'kung_pao', 'sweet_sour'],
      needs: ['ou_wok', 'ou_prep', 'ou_fridge', 'ou_pantry', 'ou_plating'] },
    // the arcade's snack bar (2026-10-28: "junk food on arcades like popcorn, pizza, burgers, tacos, soda, water, juice")
    popcorn: { name: 'Popcorn', icon: '🍿', price: 4, food: true, uses: ['kernels'], needs: ['ou_popcorn', 'ou_pantry'] },
    hot_dog: { name: 'Hot Dog', icon: '🍔', price: 7.5, food: true, uses: ['sausage', 'bun'], needs: ['ou_grill', 'ou_fridge', 'ou_pantry'] },
    tacos: { name: 'Tacos', icon: '🌮', price: 11, food: true, ware: 'plate', uses: ['tortilla', 'tomato'], needs: ['ou_griddle', 'ou_prep', 'ou_fridge', 'ou_pantry', 'ou_plating'] },
    water: { name: 'Water', icon: '💧', price: 2, hot: false, uses: ['water'], items: ['water', 'sparkling'], needs: ['ou_fridge'], sold: true },   // (sold: only where the menu has it)
    // the rice cooker, the tandoor, the bamboo steamer and the ice cream freezer (2026-10-28: an Indian's, a Japanese, a
    // dim sum kitchen's; ice cream on eight kinds of menu)
    curry: { name: 'Curry', icon: '🍛', price: 13, food: true, ware: 'bowl', uses: ['curry', 'rice'], items: ['butter_chicken', 'tikka_masala', 'dal', 'palak_paneer', 'green_curry', 'biryani'],
      needs: ['ou_rice', 'ou_stove', 'ou_fridge', 'ou_pantry', 'ou_plating'] },
    sushi: { name: 'Sushi', icon: '🍣', price: 14, food: true, ware: 'plate', uses: ['fish', 'rice'], items: ['sushi_platter', 'nigiri', 'maki'], needs: ['ou_rice', 'ou_prep', 'ou_fridge', 'ou_plating'] },
    naan: { name: 'Naan', icon: '🍛', price: 3.5, food: true, ware: 'plate', uses: ['dough'], needs: ['ou_tandoor', 'ou_pantry', 'ou_plating'] },
    tandoori: { name: 'Tandoori Chicken', icon: '🍛', price: 14, food: true, ware: 'plate', uses: ['chicken'], needs: ['ou_tandoor', 'ou_fridge', 'ou_plating'] },
    dumplings: { name: 'Dumplings', icon: '🍜', price: 8, food: true, ware: 'plate', uses: ['dumplings'], items: ['dumplings', 'bao'], needs: ['ou_bamboo', 'ou_fridge', 'ou_pantry', 'ou_plating'] },
    ice_cream: { name: 'Ice Cream', icon: '🍨', price: 5, food: true, ware: 'bowl', uses: ['icecream'], items: ['ice_cream', 'gelato'], needs: ['ou_freezer', 'ou_plating'] },
  },
  stations: {
    ou_fridge: { role: 'give', gives: ['milk', 'tomato', 'berries', 'fries', 'patty', 'batter', 'orange', 'avocado', 'stock', 'pepper', 'sausage', 'water', 'curry', 'fish', 'chicken', 'dumplings'] },
    ou_pantry: { role: 'give', gives: ['croissant', 'bread', 'bun', 'dough', 'pasta', 'noodles', 'kernels', 'tortilla'] },
    ou_oven: { role: 'cook', k: 'croissant', from: 'raw', to: 'warm', over: 'burnt', cook: 6, perfect: 4, burn: 14 },
    ou_press: { role: 'cook', k: 'toastie', from: 'raw', to: 'toasted', over: 'burnt', cook: 5, perfect: 3.5, burn: 12 },
    ou_steamer: { role: 'cook', k: 'milk', from: 'cold', to: 'steamed', over: 'scalded', cook: 4, perfect: 3, burn: 10 },
    ou_blender: { role: 'cook', k: 'berries', from: 'whole', to: 'blended', over: 'warm', cook: 3, perfect: 6, burn: 16 },
    ou_espresso: { role: 'cook', k: 'cup', from: 'empty', to: 'shot', over: 'bitter', cook: 3.5, perfect: 3, burn: 11, loaded: 'grounds' },
    ou_fryer: { role: 'cook', k: 'fries', from: 'frozen', to: 'fried', over: 'burnt', cook: 5, perfect: 4, burn: 13 },
    ou_grill: { role: 'cook', k: ['patty', 'sausage'], from: 'raw', to: 'grilled', over: 'burnt', cook: 6, perfect: 4, burn: 15 },
    ou_griddle: { role: 'cook', k: ['batter', 'tortilla'], from: 'raw', to: 'cooked', over: 'burnt', cook: 5, perfect: 4, burn: 13 },
    ou_toaster: { role: 'cook', k: 'bread', from: 'plain', to: 'toasted', over: 'burnt', cook: 4, perfect: 3.5, burn: 12 },
    ou_soda: { role: 'cook', k: 'glass', from: 'empty', to: 'cola', over: 'spilled', cook: 2.5, perfect: 4, burn: 11 },
    ou_kettle: { role: 'cook', k: 'cup', from: 'empty', to: 'tea', over: 'stewed', cook: 4, perfect: 4, burn: 13 },
    ou_juicer: { role: 'cook', k: 'glass', from: 'empty', to: 'juice', over: 'spilled', cook: 3, perfect: 4, burn: 12, loaded: 'orange' },   // (an orange in its hopper)
    ou_popcorn: { role: 'cook', k: 'kernels', from: 'raw', to: 'popped', over: 'burnt', cook: 4, perfect: 5, burn: 15 },   // (the kernels into its kettle: popped)
    ou_tandoor: { role: 'cook', k: ['dough', 'chicken'], from: 'raw', to: 'baked', over: 'burnt', cook: 6, perfect: 4, burn: 15 },   // (naan slapped on its wall, chicken on skewers)
    ou_bamboo: { role: 'cook', k: 'dumplings', from: 'raw', to: 'steamed', over: 'soggy', cook: 5, perfect: 5, burn: 16 },
    ou_rice: { role: 'pour', gives: ['rice'], into: ['bowl', 'plate'], food: true },   // (its rice kept warm: scooped into a bowl, onto a plate)
    ou_freezer: { role: 'pour', gives: ['icecream'], into: 'bowl', food: true },   // (scooped into a bowl)
    ou_pizza_oven: { role: 'cook', k: 'pizza', from: 'raw', to: 'baked', over: 'burnt', cook: 7, perfect: 4, burn: 16 },
    ou_stove: { role: 'cook', k: ['pasta', 'soup', 'curry'], from: 'raw', to: 'cooked', over: 'burnt', cook: 6, perfect: 4, burn: 15 },   // (a pot of water for the pasta, the soup in its pot)
    ou_wok: { role: 'cook', k: 'stirfry', from: 'raw', to: 'tossed', over: 'burnt', cook: 3.5, perfect: 2.5, burn: 8, tend: true },   // (tossed: cooks only while held)
    ou_taps: { role: 'cook', k: 'glass', from: 'empty', to: 'beer', over: 'spilled', cook: 3, perfect: 4, burn: 12 },   // (a glass under the tap: poured with its head)
    ou_wine: { role: 'pour', gives: ['red', 'white', 'bubbly'], into: 'wineglass' },   // (a wine glass held to it: filled with the one chosen)
    ou_cocktail: { role: 'make', s: 2.2, makes: 'shaker', st: 'shaken', counter: true },   // (held: a cocktail shaken; a cocktail glass held to it: poured)
    ou_grinder: { role: 'make', s: 1.8, makes: 'grounds', st: 'fresh' },   // (beans in its hopper)
    ou_prep: { role: 'chop', s: 2.4, k: ['tomato', 'avocado', 'pepper', 'fish'], from: 'whole', to: 'chopped', counter: true },
    ou_plating: { role: 'plating', counter: true },
    ou_sink: { role: 'sink', s: 1.3, holds: 4 },
    ou_dishes: { role: 'dishes' },
    ou_pass: { role: 'pass' },
    ou_bin: { role: 'bin' },
  },
  fresh: { milk: 'cold', tomato: 'whole', berries: 'whole', croissant: 'raw', bread: 'plain', fries: 'frozen', patty: 'raw', batter: 'raw', orange: 'whole', avocado: 'whole', bun: 'plain',
    dough: 'raw', pasta: 'raw', noodles: 'raw', stock: 'raw', pepper: 'whole', kernels: 'raw', sausage: 'raw', tortilla: 'raw', water: 'cold',
    curry: 'raw', fish: 'whole', chicken: 'raw', dumplings: 'raw' },
  // (2026-10-27, "for the smoothies we need glass cups not coffee cups")
  ware: { plate: { stack: 'plates', clean: 'clean', n: 3, on: true }, cup: { stack: 'cups', clean: 'empty', n: 4 }, glass: { stack: 'glasses', clean: 'empty', n: 3 },
    wineglass: { stack: 'wineglasses', clean: 'empty', n: 3 }, coupe: { stack: 'coupes', clean: 'empty', n: 3 }, bowl: { stack: 'bowls', clean: 'clean', n: 3, on: true } },
  onWare: { croissant: ['warm', 'burnt'], toastie: ['toasted', 'burnt'], fries: ['fried', 'burnt'], batter: ['cooked', 'burnt'], avo_toast: ['ready'],
    pizza: ['baked', 'burnt'], pasta: ['cooked', 'burnt'], soup: ['cooked', 'burnt'], stirfry: ['tossed', 'burnt'], tacos: ['ready'],
    dough: ['baked', 'burnt'], chicken: ['baked', 'burnt'], dumplings: ['steamed', 'soggy'] },
  combos: [
    { a: ['cup', 'shot'], b: ['milk', ['steamed', 'scalded']], st: 'latte', q: 'both', art: 95 },
    { a: ['glass', 'empty'], b: ['berries', ['blended', 'warm']], st: 'smoothie', q: 'b' },
    { onWare: true },
    { a: ['bread', 'toasted'], b: ['avocado', 'chopped'], k: 'avo_toast', st: 'ready', q: 'a' },
    { a: ['bread'], b: ['tomato', 'chopped'], k: 'toastie', st: 'raw', q: 'none' },
    { a: ['bun'], b: ['patty', 'grilled'], k: 'burger', st: 'ready', q: 'b' },   // (E at the grill with a bun)
    { a: ['coupe', 'empty'], b: ['shaker', 'shaken'], st: 'cocktail', q: 'none' },   // (poured from the shaker)
    { a: ['dough'], b: ['tomato', 'chopped'], k: 'pizza', st: 'raw', q: 'none' },   // (the base, its topping)
    { a: ['stock'], b: ['tomato', 'chopped'], k: 'soup', st: 'raw', q: 'none' },
    { a: ['noodles'], b: ['pepper', 'chopped'], k: 'stirfry', st: 'raw', q: 'none' },
    { a: ['bun'], b: ['sausage', 'grilled'], k: 'hotdog', st: 'ready', q: 'b' },   // (E at the grill with a bun)
    { a: ['tortilla', 'cooked'], b: ['tomato', 'chopped'], k: 'tacos', st: 'ready', q: 'a' },   // (the warm tortilla onto its filling)
    { onto: ['bowl', 'rice'], b: ['curry', ['cooked', 'burnt']], on: 'curry', q: 'b' },   // (the curry over its rice)
    { onto: ['plate', 'rice'], b: ['fish', 'chopped'], on: 'sushi', q: 'none' },   // (the fish onto its rice)
  ],
  served: { cup: { shot: 'espresso', latte: 'latte', tea: 'tea' }, glass: { smoothie: 'smoothie', cola: 'cola', juice: 'orange_juice', beer: 'beer' },
    wineglass: { red: 'red_wine', white: 'white_wine', bubbly: 'champagne' }, coupe: { cocktail: 'cocktail' },
    plate: { croissant: 'croissant', toastie: 'toastie', fries: 'fries', batter: 'pancakes', avo_toast: 'avocado_toast', pizza: 'pizza', pasta: 'pasta', tacos: 'tacos',
      sushi: 'sushi', dough: 'naan', chicken: 'tandoori', dumplings: 'dumplings' }, burger: { ready: 'cheeseburger' },
    bowl: { soup: 'soup', stirfry: 'stir_fry', curry: 'curry', icecream: 'ice_cream' }, kernels: { popped: 'popcorn' }, hotdog: { ready: 'hot_dog' }, water: { cold: 'water' } },
  say: { 'cup:tea': 'cup of tea', 'cup:stewed': 'stewed tea', 'glass:cola': 'cola', 'glass:juice': 'orange juice', 'glass:spilled': 'spilled drink',
    'fries:fried': 'fries', 'batter:raw': 'pancake batter', 'batter:cooked': 'pancakes', 'batter:burnt': 'burnt pancakes', 'bread:toasted': 'toast',
    'bread:burnt': 'burnt toast', 'patty:raw': 'patty', avo_toast: 'avocado toast', burger: 'cheeseburger',
    wineglass: 'wine glass', coupe: 'cocktail glass', 'glass:beer': 'beer', 'wineglass:red': 'red wine', 'wineglass:white': 'white wine', 'wineglass:bubbly': 'champagne',
    'coupe:cocktail': 'cocktail', 'shaker:shaken': 'shaken cocktail', red: 'red wine', white: 'white wine', bubbly: 'champagne',
    'dough:raw': 'pizza dough', 'pizza:raw': 'pizza, ready to bake', 'pasta:raw': 'dry pasta', 'pasta:cooked': 'pasta', 'stock:raw': 'stock', 'soup:raw': 'soup, ready to simmer',
    'soup:cooked': 'soup', 'noodles:raw': 'noodles', 'stirfry:raw': 'stir-fry, ready for the wok', 'stirfry:tossed': 'stir-fry', stirfry: 'stir-fry',
    'kernels:raw': 'popcorn kernels', 'kernels:popped': 'popcorn', 'kernels:burnt': 'burnt popcorn', 'sausage:raw': 'sausage', hotdog: 'hot dog', 'tortilla:raw': 'tortilla',
    'tortilla:cooked': 'warm tortilla', 'water:cold': 'bottle of water',
    'curry:raw': 'curry, ready to simmer', 'curry:cooked': 'curry', 'dough:baked': 'naan', 'dough:burnt': 'burnt naan', 'chicken:raw': 'raw chicken', 'chicken:baked': 'tandoori chicken',
    'dumplings:raw': 'dumplings', 'dumplings:steamed': 'dumplings', 'dumplings:soggy': 'soggy dumplings', rice: 'rice', icecream: 'ice cream', 'fish:chopped': 'sliced fish' },
  place: [['ou_espresso', 'side back front'], ['ou_grinder', 'side back front door'], ['ou_fridge', 'back side'], ['ou_plating', 'door back front side'],
    ['ou_steamer', 'front back door side'], ['ou_oven', 'back side'], ['ou_pantry', 'back side'], ['ou_sink', 'back front side'],
    ['ou_dishes', 'back front door side', 'ou_sink'],   // (no sink: plates come back clean, no dish return)
    ['ou_prep', 'front island door back side'], ['ou_bin', 'door front back'], ['ou_press', 'island front back door'], ['ou_blender', 'island back front door']],
  byMenu: [['ou_kettle', 'back side front door island'], ['ou_toaster', 'front back side door island'], ['ou_juicer', 'back front side door island'],
    ['ou_griddle', 'back side front'], ['ou_grill', 'back side front'], ['ou_fryer', 'side back front'], ['ou_soda', 'door front back side'],
    ['ou_taps', 'back side front door'], ['ou_wine', 'back side front door'], ['ou_cocktail', 'front door island back side'],
    ['ou_stove', 'back side front'], ['ou_pizza_oven', 'back side'], ['ou_wok', 'back side front'], ['ou_popcorn', 'side back front door'],
    ['ou_rice', 'back side front door island'], ['ou_tandoor', 'back side'], ['ou_bamboo', 'back side front'], ['ou_freezer', 'front door back side']],
  more: [['ou_espresso', 'side back front island'], ['ou_grinder', 'side back front door island'], ['ou_prep', 'island front door back side'], ['ou_oven', 'back side island'],
    ['ou_press', 'island front back door'], ['ou_steamer', 'front back door side island'], ['ou_blender', 'island back front door'], ['ou_plating', 'door front back side island'],
    ['ou_sink', 'back front side'], ['ou_fridge', 'back side'], ['ou_pantry', 'back side island']],
});

// the rest of the menu (shared/orderup/menu-dishes.js: each item of the pack a dish of its own, from the world's model)
const COFFEE = Object.freeze(withMenuDishes(BASE, { FOOD: FOOD_BY_ID, needsOf, PIECE: Object.fromEntries(Object.entries(APPLIANCES).map(([k, A]) => [k, A.piece])) }));

/** The kitchen templates by id. */
export const KITCHENS = Object.freeze({ coffee: COFFEE });
export const DEFAULT_KITCHEN = 'coffee';

/** A template: its id, or a template itself (a test's own, or a later custom one); unknown ids: the default. */
export const kitchenOf = k => (k && typeof k === 'object' ? k : KITCHENS[k] || KITCHENS[DEFAULT_KITCHEN]);

/** The menu items dish d of template K is (shared/food.js ids). */
export const dishItems = (K, d) => K.dishes[d]?.items || [d];
/** The station kinds of template K that do the given role. */
export const stationsDoing = (K, role) => Object.keys(K.stations).filter(t => K.stations[t].role === role);
