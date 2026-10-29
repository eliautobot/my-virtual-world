// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The rest of the menu in Order Up (2026-10-28, the product owner: "go ahead and make all the ones that are pending, make
// sure the assets for each state looks really good"): every item of the pack (shared/food.js) a place may sell, made
// in the kitchen with the appliances it needs (shared/appliances.js), each a dish of its own. A dish here is one line,
// how it is made; the template's stations, what the fridge and the pantry give, its states, the plate or bowl it goes on,
// its words and its looks (client/js/render/orderup-items.js: drawn from the world's own model of it) follow from it.
//
//   cook(id, at, from)        from the fridge or the pantry (raw), into the machine at, done: onto its plate or bowl
//   chain(id, [a, b], from)   from a store, into machine a, then into machine b (lasagna: the stove, then the oven)
//   prep(id, from)            its makings from a store onto the prep counter, held (F): prepared, onto its plate or bowl
//   ready(id, from)           as it comes from the fridge (a tiramisu), onto its plate
//   pot(id, from)             a pot dish: its saucepan from a store on the stove, simmered, into a bowl
//   onto(id, ware, base, b)   a plate or bowl with base on it (ice cream, rice), b put onto it: the dish
//   combo(id, a, b)           two parts made, put together (an egg fried and its bacon crisp), onto its plate; a part is
//                             [kind, state]: from a store as it is, chopped at the prep counter, cooked in a machine
//                             (PARTS below: the egg on the griddle), or a dish of its own (a burger: the cheeseburger's)
//   onto(id, ware, base, b)   (b cooked: [kind, state] made in its machine, then a plate of rice held to it: teriyaki)
//   scoop(id, at, ware)       a plate or bowl held to a station that serves it (mochi from the freezer)
// and the drinks (D in the cup or glass they are served in: their state there, st):
//   steam(id, base, milk, st) a milk steamed (milk, chocolate milk, matcha milk) poured into a cup: of a shot (a mocha), of
//                             tea (a chai latte), or empty (a hot chocolate held to the steamer)
//   fill(id, at, ware, from, st, load) a cup or glass in state `from` under machine at (loaded first: grounds, a lemon),
//                             filled: a coffee to go, lemonade, bubble tea (a glass with its pearls under the tea urn)
//   blend(id, mix, st, o)     its mix (from a store; a milk with a scoop of ice cream from the freezer; a shaken cocktail)
//                             in the blender, poured into a glass: a frappe, a lassi, a milkshake, a piña colada
//   pour(id, give, ware)      poured at the wine fridge into its cup or glass: sake, sangria
//   asis(id)                  from the fridge as it is, served so: a can of soda, a bottled beer, cold brew made ahead
// o: family (how its raw and burnt look: dough, meat, fish, fry, egg, shell, veg; pot; prep), ware ('plate', 'bowl'),
// times ([cook, perfect, burn]), raw (its words for raw).

const D = [];
const cook = (id, at, from, o = {}) => D.push({ id, how: 'cook', at, from, ...o });
const chain = (id, at, from, o = {}) => D.push({ id, how: 'chain', at, from, ...o });
const prep = (id, from, o = {}) => D.push({ id, how: 'prep', from, family: 'prep', ...o });
const ready = (id, from, o = {}) => D.push({ id, how: 'ready', from, ...o });
const pot = (id, from, o = {}) => D.push({ id, how: 'cook', at: 'ou_stove', from, family: 'pot', ware: 'bowl', ...o });
const onto = (id, ware, base, b, o = {}) => D.push({ id, how: 'onto', ware, base, b, ...o });
const combo = (id, a, b, o = {}) => D.push({ id, how: 'combo', a, b, ...o });
const topped = (id, base, top, at, o = {}) => D.push({ id, how: 'topped', base, top, at, ...o });   // (base [kind, store] onto a chopped top at the prep counter, then into at)
const scoop = (id, at, ware, o = {}) => D.push({ id, how: 'scoop', at, ware, ...o });
const steam = (id, base, milk, st, o = {}) => D.push({ id, how: 'steam', base, milk, st, ware: 'cup', ...o });
const fill = (id, at, ware, from, st, o = {}) => D.push({ id, how: 'fill', at, ware, from, st, ...o });
const blend = (id, mix, st, o = {}) => D.push({ id, how: 'blend', mix, st, ware: 'glass', ...o });
const pour = (id, give, ware, o = {}) => D.push({ id, how: 'pour', give, ware, ...o });
const asis = (id, o = {}) => D.push({ id, how: 'asis', ...o });

// ---- bakery and desserts
const CAKE = [8, 5, 18];   // (a cake bakes a while)
for (const id of ['muffin', 'cinnamon_roll', 'scone', 'danish', 'banana_bread', 'cookie', 'pretzel', 'macarons', 'baklava', 'garlic_bread']) cook(id, 'ou_oven', 'ou_pantry', { family: 'dough' });
cook('brownie', 'ou_oven', 'ou_pantry', { family: 'choc' });   // (its batter dark already)
for (const id of ['cheesecake', 'apple_pie', 'fruit_tart']) cook(id, 'ou_oven', 'ou_pantry', { family: 'dough', times: CAKE });
cook('cupcake', 'ou_oven', 'ou_pantry', { family: 'dough', times: CAKE, models: { raw: 'muffin' } });   // (raw: batter in its paper cup; its frosting after)
for (const id of ['choc_cake', 'lava_cake']) cook(id, 'ou_oven', 'ou_pantry', { family: 'choc', times: CAKE });
cook('creme_brulee', 'ou_oven', 'ou_fridge', { family: 'egg' });
cook('donut', 'ou_fryer', 'ou_pantry', { family: 'fry', rawAll: true });   // (raw: a ring of dough, its glaze after)
cook('bagel', 'ou_toaster', 'ou_pantry', { family: 'dough' });
pot('pudding', 'ou_fridge');
ready('tiramisu', 'ou_fridge');
onto('sundae', 'bowl', 'icecream', ['fudge', 'ready'], { from: 'ou_pantry' });
onto('banana_split', 'bowl', 'icecream', ['banana', 'chopped'], { from: 'ou_fridge', chop: true });

// ---- one machine, two in a row, a pot, the prep counter: the mains, the sides, the starters of every kind of place
const F = 'ou_fridge', PA = 'ou_pantry';
for (const id of ['waffles', 'french_toast', 'crepes', 'quesadilla', 'gyoza']) cook(id, 'ou_griddle', F, { family: 'dough' });
cook('omelette', 'ou_griddle', F, { family: 'egg' });
cook('fajitas', 'ou_griddle', F, { family: 'meat' });
for (const id of ['grilled_cheese', 'reuben', 'tuna_melt', 'croque']) cook(id, 'ou_press', F, { family: 'dough' });
for (const id of ['nuggets', 'onion_rings', 'spring_rolls', 'tempura', 'calamari']) cook(id, 'ou_fryer', F, { family: 'fry' });
for (const id of ['churros', 'samosas', 'falafel']) cook(id, 'ou_fryer', PA, { family: 'fry' });
cook('wings', 'ou_fryer', F, { family: 'meat' });
for (const id of ['ribeye', 'kebab']) cook(id, 'ou_grill', F, { family: 'meat' });
cook('salmon', 'ou_grill', F, { family: 'fish' });
cook('corn', 'ou_grill', F, { family: 'veg' });
for (const id of ['peking_duck', 'roast_chicken']) cook(id, 'ou_oven', F, { family: 'meat', times: CAKE });
cook('quiche', 'ou_oven', F, { family: 'egg', times: CAKE });
cook('lobster', 'ou_stove', F, { family: 'shell' });
cook('shrimp_cocktail', 'ou_stove', F, { family: 'shell' });
cook('paella', 'ou_stove', F, { family: 'dough', times: CAKE });
cook('fried_rice', 'ou_wok', F, { family: 'veg', ware: 'bowl' });
cook('hummus', 'ou_blender', PA, { family: 'blend' });
cook('acai_bowl', 'ou_blender', F, { family: 'blend', ware: 'bowl' });
for (const id of ['lasagna', 'moussaka', 'enchiladas', 'mac_cheese']) chain(id, ['ou_stove', 'ou_oven'], F, { family: 'dough' });
chain('onion_soup', ['ou_stove', 'ou_oven'], PA, { family: 'dough', ware: 'bowl' });
chain('ratatouille', ['ou_stove', 'ou_oven'], F, { family: 'veg' });
for (const id of ['bbq_ribs', 'brisket']) chain(id, ['ou_oven', 'ou_grill'], F, { family: 'meat' });
chain('pulled_pork', ['ou_oven', 'ou_grill'], F, { family: 'meat', models: { raw: 'ribeye', prepared: 'ribeye' } });   // (a joint of pork till it is pulled into its bun)
pot('oatmeal', PA);
pot('miso_soup', PA, { top: '#c99a5e', bits: ['#f4f1e6', '#2f5a2a'] });   // (its broth, its tofu and seaweed: not its lacquered bowl)
for (const id of ['risotto', 'pho', 'ramen', 'edamame', 'coq_au_vin', 'shrimp', 'mash']) pot(id, F);
pot('mussels', F, { top: '#e6d6a6', bits: ['#1c1f2b', '#f0a060'] });   // (in white wine: the black shells, the orange in them)
for (const id of ['club_sandwich', 'blt', 'sub', 'wrap', 'caprese', 'sashimi', 'oysters']) prep(id, F);
for (const id of ['yogurt_parfait', 'greek_salad', 'caesar', 'garden_salad', 'cobb', 'coleslaw']) prep(id, F, { ware: 'bowl' });
topped('calzone', ['dough', PA], 'pepper', 'ou_pizza_oven', { family: 'dough' });
topped('bruschetta', ['baguette', PA], 'tomato', 'ou_oven', { family: 'dough' });
topped('nachos', ['chips', PA], 'tomato', 'ou_oven', { family: 'dough' });

// ---- two parts made, put together: the breakfasts, the platters, the wraps
combo('eggs_bacon', ['egg', 'fried'], ['bacon', 'crisp']);
combo('full_breakfast', ['sausage', 'grilled'], ['egg', 'fried']);
combo('eggs_benedict', ['bread', 'toasted'], ['egg', 'poached']);
combo('breakfast_burrito', ['tortilla', 'cooked'], ['egg', 'fried']);
combo('bagel_lox', ['bagel', 'toasted'], ['fish', 'chopped']);   // (the fish sliced: lox)
combo('burger_fries', ['burger', 'ready'], ['fries', 'fried']);
combo('burrito', ['tortilla', 'cooked'], ['beans', 'cooked']);
combo('chips_guac', ['chips', 'fried'], ['avocado', 'chopped']);
combo('fish_tacos', ['tortilla', 'cooked'], ['fish', 'fried']);
combo('shawarma', ['pita', 'warm'], ['chicken', 'grilled']);
combo('gyro', ['pita', 'warm'], ['lamb', 'grilled']);
combo('steak_frites', ['steak', 'grilled'], ['fries', 'fried']);
combo('fish_chips', ['fish', 'fried'], ['fries', 'fried']);
onto('teriyaki', 'plate', 'rice', ['chicken', 'grilled']);
onto('katsu_curry', 'plate', 'rice', ['chicken', 'fried']);
onto('burrito_bowl', 'bowl', 'rice', ['beans', 'cooked']);
onto('poke', 'bowl', 'rice', ['fish', 'chopped'], { from: F, chop: true });
onto('buddha_bowl', 'bowl', 'rice', ['avocado', 'chopped'], { from: F, chop: true });
scoop('mochi', 'ou_freezer', 'plate');

// ---- the drinks
steam('mocha', 'shot', 'chocmilk', 'mocha', { hot: true });
steam('hot_chocolate', 'empty', 'chocmilk', 'hotchoc', { hot: true });
steam('chai_latte', 'tea', 'milk', 'chai', { hot: true });
steam('matcha_latte', 'empty', 'matchamilk', 'matcha', { hot: true });
fill('coffee_to_go', 'ou_espresso', 'togo', 'empty', 'coffee', { hot: true });   // (a paper cup to go under the espresso machine: not washed, a sleeve of them)
fill('iced_coffee', 'ou_espresso', null, 'cold', 'iced', { k: 'ice' });   // (a glass of ice from the fridge, the shot pulled over it)
fill('lemonade', 'ou_juicer', 'glass', 'empty', 'lemonade', { load: 'lemon' });
fill('apple_juice', 'ou_juicer', 'glass', 'empty', 'applejuice', { load: 'apple' });
fill('bubble_tea', 'ou_kettle', 'glass', 'pearls', 'bubbletea', { with: 'pearls' });   // (the pearls into the glass first, then tea over them)
blend('frappe', 'frappe', 'frappe', { from: F });
blend('mango_lassi', 'lassi', 'lassi', { from: F });
blend('horchata', 'horchata', 'horchata', { from: F });
blend('milkshake', 'milk', 'milkshake', { freezer: true });
blend('choc_shake', 'chocmilk', 'chocshake', { freezer: true });
blend('pina_colada', 'shaker', 'colada', { shaker: true });   // (shaken at the cocktail station, then blended with ice)
pour('sake', 'sake', 'cup');
pour('sangria', 'sangria', 'glass');
for (const id of ['soda_can', 'bottled_beer', 'cold_brew']) asis(id);

// the parts cooked on their own before they are put together: from which store, as what, and what each machine makes of it
export const PARTS = {
  egg: { from: F, fresh: 'raw', cooks: { ou_griddle: 'fried', ou_stove: 'poached' }, say: { raw: 'egg', fried: 'fried egg', poached: 'poached egg', burnt: 'burnt egg' } },
  bacon: { from: F, fresh: 'raw', cooks: { ou_griddle: 'crisp' }, say: { raw: 'bacon', crisp: 'crispy bacon', burnt: 'burnt bacon' } },
  steak: { from: F, fresh: 'raw', name: 'steak', cooks: { ou_grill: 'grilled' }, look: { model: 'ribeye', family: 'meat' }, say: { raw: 'raw steak', grilled: 'steak', burnt: 'burnt steak' } },
  lamb: { from: F, fresh: 'raw', cooks: { ou_grill: 'grilled' }, look: { model: 'kebab', family: 'meat' }, say: { raw: 'lamb', grilled: 'grilled lamb', burnt: 'burnt lamb' } },
  beans: { from: PA, fresh: 'raw', name: 'beans', cooks: { ou_stove: 'cooked' }, say: { raw: 'dried beans', cooked: 'beans', burnt: 'burnt beans' } },
  pita: { from: PA, fresh: 'raw', cooks: { ou_griddle: 'warm' }, say: { raw: 'pita', warm: 'warm pita', burnt: 'burnt pita' } },
  chips: { from: PA, fresh: 'raw', cooks: { ou_fryer: 'fried' } },
  chicken: { cooks: { ou_grill: 'grilled', ou_fryer: 'fried' }, say: { grilled: 'grilled chicken', fried: 'chicken katsu', burnt: 'burnt chicken' } },
  fish: { cooks: { ou_fryer: 'fried' }, say: { fried: 'fried fish', burnt: 'burnt fish' } },
  // the drinks' (2026-10-28)
  chocmilk: { from: F, fresh: 'cold', name: 'chocolate milk', cooks: { ou_steamer: 'steamed' }, say: { cold: 'chocolate milk', steamed: 'steamed chocolate milk', scalded: 'scalded chocolate milk', shake: 'chocolate milk with ice cream', blended: 'chocolate shake, blended', warm: 'warm chocolate shake' } },
  matchamilk: { from: F, fresh: 'cold', name: 'matcha milk', cooks: { ou_steamer: 'steamed' }, say: { cold: 'matcha milk', steamed: 'steamed matcha milk', scalded: 'scalded matcha milk' } },
  lemon: { from: F, fresh: 'whole', cooks: {}, say: { whole: 'lemon' } },
  apple: { from: F, fresh: 'whole', cooks: {}, say: { whole: 'apple' } },
  ice: { from: F, fresh: 'cold', name: 'glass of ice', cooks: {}, say: { cold: 'glass of ice', iced: 'iced coffee', bitter: 'bitter iced coffee' } },
  pearls: { from: PA, fresh: 'ready', name: 'tapioca pearls', cooks: {}, say: { ready: 'tapioca pearls' } },
  frappe: { from: F, fresh: 'whole', name: 'frappé mix', cooks: { ou_blender: 'blended' }, say: { whole: 'frappé mix', blended: 'frappé, blended', warm: 'warm frappé' } },
  lassi: { from: F, fresh: 'whole', name: 'mango and yogurt', cooks: { ou_blender: 'blended' }, say: { whole: 'mango and yogurt', blended: 'lassi, blended', warm: 'warm lassi' } },
  horchata: { from: F, fresh: 'whole', name: 'horchata mix', cooks: { ou_blender: 'blended' }, say: { whole: 'horchata mix', blended: 'horchata, blended', warm: 'warm horchata' } },
};

export const MENU_DISHES = D;
// what the parts of a dish are called (what goes onto a base, an egg and its bacon …)
const PART_WORDS = { 'milk:shake': 'milk with ice cream', 'milk:blended': 'milkshake, blended', 'milk:warm': 'warm milkshake', 'shaker:blended': 'piña colada, blended', 'shaker:warm': 'warm piña colada',
  togo: 'cup to go', 'togo:empty': 'cup to go', 'togo:coffee': 'coffee to go', 'togo:bitter': 'bitter coffee to go', 'glass:pearls': 'glass of pearls', 'glass:stewed': 'stewed bubble tea',
  sake: 'sake', sangria: 'sangria', 'cup:sake': 'sake', 'glass:sangria': 'sangria', fudge: 'hot fudge', 'fudge:ready': 'hot fudge', banana: 'banana', 'banana:whole': 'banana', 'banana:chopped': 'sliced banana', baguette: 'baguette', 'baguette:raw': 'baguette',
  chips: 'tortilla chips', 'chips:raw': 'tortilla chips', 'chips:fried': 'fried tortilla chips' };

// the words for a dish before it is done, by the machine it goes into
const RAWWORD = { ou_oven: 'unbaked', ou_pizza_oven: 'unbaked', ou_tandoor: 'unbaked', ou_toaster: 'untoasted', ou_press: 'unpressed' };
const lower = s => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Template K with the menu's dishes added (a new template object): its dishes, its stations' cooks and gives, its fresh
 * states, ware, onWare, combos, served, words and looks. FOOD: shared/food.js FOOD_BY_ID; NEEDS: an item's appliance keys;
 * PIECE: an appliance key's piece.
 */
export function withMenuDishes(K, { FOOD, needsOf, PIECE }) {
  const T = { ...K, dishes: { ...K.dishes }, stations: Object.fromEntries(Object.entries(K.stations).map(([t, d]) => [t, { ...d, ...(d.gives ? { gives: [...d.gives] } : {}), cooks: [...(d.cooks || [])], chops: [...(d.chops || [])] }])),
    fresh: { ...K.fresh }, onWare: { ...K.onWare }, combos: [...K.combos], served: Object.fromEntries(Object.entries(K.served).map(([w, m]) => [w, { ...m }])), say: { ...K.say }, looks: { ...(K.looks || {}) } };
  T.ware = { ...K.ware, togo: { stack: 'togos', clean: 'empty', n: 24, disposable: true } };   // (paper cups to go: a sleeve of them, not washed)
  const giverOf = k => Object.keys(T.stations).find(t => T.stations[t].gives?.includes(k));
  const give = (store, k, st) => { const g = T.stations[store].gives; if (!g.includes(k)) g.push(k); T.fresh[k] = st; };
  const serve = (ware, on, dish) => { (T.served[ware] || (T.served[ware] = {}))[on] = dish; };
  Object.assign(T.say, PART_WORDS);
  for (const [k, p] of Object.entries(PARTS)) {   // (the parts: given, and cooked by their machines)
    if (p.from) give(p.from, k, p.fresh);
    for (const [t, to] of Object.entries(p.cooks)) T.stations[t].cooks.push({ k, from: T.fresh[k], to, over: T.stations[t].over });
    for (const [st, w] of Object.entries(p.say || {})) T.say[`${k}:${st}`] = w;
    if (p.name || p.say?.raw) T.say[k] = p.name || p.say.raw;
    if (p.look) T.looks[k] = { ...p.look, raw: [p.fresh], over: ['burnt'] };
  }
  /** How part [k, st] is made: { at: its machine } | { chop: true } | { store } | { dish: the dish it is } (or null). */
  const partOf = ([k, st]) => {
    const fresh = T.fresh[k];
    if (fresh === st) return { store: Object.keys(T.stations).find(t => T.stations[t].gives?.includes(k)) };
    for (const [t, S] of Object.entries(T.stations)) {
      if (S.role !== 'cook') continue;
      if ([].concat(S.k ?? []).includes(k) && S.from === fresh && S.to === st) return { at: t };
      if (S.cooks.some(e => [].concat(e.k).includes(k) && (e.from ?? S.from) === fresh && (e.to ?? S.to) === st)) return { at: t };
    }
    if (st === 'chopped') return { chop: true };
    for (const [w, m] of Object.entries(T.served)) if (w === k && m[st]) return { dish: m[st] };
    return null;
  };
  const partNeeds = (p, part) => {   // (the stations a part is made with, the kinds it takes from the stores)
    if (!p) throw new Error(`menu dishes: no way to make ${part.join(' ')}`);
    if (p.dish) { const s = T.dishes[p.dish]; return { needs: s.needs || [], uses: s.uses || [] }; }
    const store = p.store || Object.keys(T.stations).find(t => T.stations[t].gives?.includes(part[0]));
    return { needs: [...(p.at ? [p.at] : []), ...(p.chop ? ['ou_prep'] : []), ...(store ? [store] : [])], uses: [part[0]] };
  };
  for (const d of D) {
    const f = FOOD[d.id]; if (!f) throw new Error(`menu dishes: ${d.id} is not on the pack`);
    if (T.dishes[d.id]) throw new Error(`menu dishes: ${d.id} is a dish already`);
    const name = f.name, ware = d.ware || 'plate', fam = d.family || 'dough';
    const needs = [...new Set([...needsOf(d.id).map(k => PIECE[k]).filter(Boolean), ...(d.how === 'prep' || d.chop ? ['ou_prep'] : []), ...(ware ? ['ou_plating'] : [])])];
    const drinkWare = DRINK.has(d.how) ? d.ware ?? null : ware;   // (a drink's cup or glass; none: served as it comes)
    const dish = { name, icon: f.icon, price: +(f.price / 100).toFixed(2), ...(f.course === 'drink' ? { hot: !!d.hot } : { food: true }), ware: drinkWare, uses: [], needs, recipe: d, sold: true };   // (sold: only where its menu has it)
    const need = (...t) => { for (const x of t) if (x && !dish.needs.includes(x)) dish.needs.push(x); };
    if (DRINK.has(d.how)) drink(d, dish, need, name);
    if (d.how === 'cook' || d.how === 'chain') {
      const at = [].concat(d.at), from = d.from;
      give(from, d.id, 'raw'); dish.uses.push(d.id);
      let st = 'raw';
      at.forEach((t, n) => {
        const S = T.stations[t], last = n === at.length - 1, to = last ? S.to : n === 0 && at.length > 1 ? 'prepared' : S.to;
        S.cooks.push({ k: d.id, from: st, to, over: S.over, ...(d.times ? { cook: d.times[0], perfect: d.times[1], burn: d.times[2] } : {}) });
        if (!last) T.say[`${d.id}:${to}`] = `${lower(name)}, ready for the ${t === 'ou_oven' ? 'oven' : t === 'ou_grill' ? 'grill' : 'next machine'}`;
        st = to;
      });
      const done = st, over = T.stations[at.at(-1)].over;
      T.onWare[d.id] = [done, over]; serve(ware, d.id, d.id);
      T.say[`${d.id}:raw`] = d.raw || `${RAWWORD[at[0]] || 'raw'} ${lower(name)}`; T.say[`${d.id}:${done}`] = lower(name); T.say[`${d.id}:${over}`] = `burnt ${lower(name)}`;
      T.looks[d.id] = { model: d.id, family: fam, raw: ['raw', ...(at.length > 1 ? ['prepared'] : [])].filter(s => s !== done), over: [over], ...(d.rawAll ? { rawAll: true } : {}), ...(d.models ? { models: d.models } : {}), ...(d.top ? { top: d.top, bits: d.bits } : {}),
        ...(at.length > 1 ? { half: ['prepared'], ...(at[0] === 'ou_stove' ? { pot: ['raw'] } : {}) } : {}) };   // (half done between its machines; on the stove first: its saucepan till then)
    } else if (d.how === 'topped') {   // (its base onto its chopped topping, then into its machine)
      const [bk, store] = d.base, S = T.stations[d.at];
      if (!T.fresh[bk]) give(store, bk, 'raw'); else if (!T.stations[store].gives.includes(bk)) T.stations[store].gives.push(bk);
      dish.uses.push(bk, d.top);
      T.combos.push({ a: [bk], b: [d.top, 'chopped'], k: d.id, st: 'raw', q: 'none' });
      S.cooks.push({ k: d.id, from: 'raw', to: S.to, over: S.over });
      T.onWare[d.id] = [S.to, S.over]; serve(ware, d.id, d.id);
      T.say[`${d.id}:raw`] = `${lower(name)}, ready to bake`; T.say[`${d.id}:${S.to}`] = lower(name); T.say[`${d.id}:${S.over}`] = `burnt ${lower(name)}`;
      T.looks[d.id] = { model: d.id, family: fam, raw: ['raw'], over: [S.over] };
    } else if (d.how === 'prep') {
      give(d.from, d.id, 'whole'); dish.uses.push(d.id);
      T.stations.ou_prep.chops.push({ k: d.id, from: 'whole', to: 'ready', s: d.s || 3 });
      T.onWare[d.id] = ['ready']; serve(ware, d.id, d.id);
      T.say[`${d.id}:whole`] = `makings of ${lower(name)}`; T.say[`${d.id}:ready`] = lower(name);
      T.looks[d.id] = { model: d.id, family: 'prep', raw: ['whole'], over: [] };
    } else if (d.how === 'ready') {
      give(d.from, d.id, 'ready'); dish.uses.push(d.id);
      T.onWare[d.id] = ['ready']; serve(ware, d.id, d.id); T.say[`${d.id}:ready`] = lower(name);
      T.looks[d.id] = { model: d.id, family: fam, raw: [], over: [] };
    } else if (d.how === 'onto') {
      const [bk, bst] = d.b;
      if (d.from) {   // (what goes onto it from a store, as it is or chopped)
        give(d.from, bk, d.chop ? 'whole' : bst); dish.uses.push(bk, d.base);
        if (d.chop) { const P = T.stations.ou_prep; if (![P, ...P.chops].some(e => [].concat(e.k ?? []).includes(bk))) P.chops.push({ k: bk, from: 'whole', to: 'chopped' }); }
      } else {   // (a part cooked in its machine: d.cook, the machine)
        const p = partOf(d.b), n = partNeeds(p, d.b); d.cook = p.at;
        dish.uses.push(...n.uses, d.base); dish.needs = [...new Set([...dish.needs, ...n.needs])];
      }
      const pour = Object.keys(T.stations).find(t => T.stations[t].gives?.includes(d.base));
      if (pour && !dish.needs.includes(pour)) dish.needs.push(pour);
      T.combos.push({ onto: [ware, d.base], b: d.b, on: d.id, q: d.from ? 'none' : 'b' });
      serve(ware, d.id, d.id); T.say[d.id] = lower(name);
      T.looks[d.id] = { model: d.id, family: fam, raw: [], over: [] };
    } else if (d.how === 'combo') {
      d.parts = [d.a, d.b].map(x => { const p = partOf(x); if (!p) throw new Error(`menu dishes: ${d.id}: no way to make ${x.join(' ')}`); return { k: x[0], st: x[1], ...p }; });
      for (const [n, x] of [d.a, d.b].entries()) { const u = partNeeds(d.parts[n], x); dish.uses.push(...u.uses); dish.needs = [...new Set([...dish.needs, ...u.needs])]; }
      T.combos.push({ a: d.a, b: d.b, k: d.id, st: 'ready', q: 'both' });
      T.onWare[d.id] = ['ready']; serve(ware, d.id, d.id); T.say[`${d.id}:ready`] = lower(name);
      T.looks[d.id] = { model: d.id, family: fam, raw: [], over: [] };
    } else if (d.how === 'scoop') {   // (a plate or bowl held to the station: served from it, as the ice cream is)
      const S = T.stations[d.at];
      S.gives = [...S.gives, d.id]; S.into = { ...(typeof S.into === 'object' && !Array.isArray(S.into) ? S.into : Object.fromEntries(S.gives.filter(g => g !== d.id).map(g => [g, [].concat(S.into)]))), [d.id]: [ware] };
      dish.uses.push(d.id); serve(ware, d.id, d.id); T.say[d.id] = lower(name);
      if (!dish.needs.includes(d.at)) dish.needs.push(d.at);
      T.looks[d.id] = { model: d.id, family: fam, raw: [], over: [] };
    }
    T.dishes[d.id] = dish;
  }
  return T;

  /** A drink of the menu: its machines' entries, what it is poured into, how it is served, its words and looks. */
  function drink(d, dish, need, name) {
    const st = T.stations, w = d.ware, look = (k, s) => { T.looks[`${k}:${s}`] = { model: d.id }; T.say[`${k}:${s}`] = lower(name); };
    if (w) need('ou_plating');
    if (d.how === 'steam') {   // (a milk steamed, poured into a cup: of a shot, of tea, or held to the steamer empty)
      T.combos.push({ a: ['cup', { shot: 'shot', tea: 'tea', empty: 'empty' }[d.base]], b: [d.milk, ['steamed', 'scalded']], st: d.st, q: d.base === 'empty' ? 'b' : 'both' });
      dish.uses.push(d.milk); need('ou_steamer', 'ou_fridge', ...(d.base === 'shot' ? ['ou_grinder', 'ou_espresso'] : d.base === 'tea' ? ['ou_kettle'] : []));
      serve('cup', d.st, d.id); look('cup', d.st);
    } else if (d.how === 'fill') {   // (under its machine: a cup or glass, or a thing from a store, in state from)
      const A = st[d.at], k = d.k || w;
      if (d.load) { A.loads = { ...(A.loads || {}), [d.load]: d.st }; dish.uses.push(d.load); need('ou_fridge'); }
      else A.cooks.push({ k, from: d.from, to: d.st, over: A.over });
      if (d.at === 'ou_espresso') need('ou_grinder');
      if (d.with) { T.combos.push({ a: [w, 'empty'], b: [d.with, T.fresh[d.with]], st: d.from, q: 'none' }); dish.uses.push(d.with); need(giverOf(d.with)); }
      if (d.k) { dish.uses.push(d.k); need(giverOf(d.k)); }
      need(d.at); (T.served[k] || (T.served[k] = {}))[d.st] = d.id; look(k, d.st);
    } else if (d.how === 'blend') {   // (its mix blended, a glass held to the blender)
      const B = st.ou_blender, from = d.freezer ? 'shake' : d.shaker ? 'shaken' : T.fresh[d.mix];
      if (d.freezer) { st.ou_freezer.mix = { ...(st.ou_freezer.mix || {}), [d.mix]: 'shake' }; need('ou_freezer'); }
      if (d.shaker) need('ou_cocktail');
      if (!B.cooks.some(e => e.k === d.mix && e.from === from) && !(B.k === d.mix && B.from === from)) B.cooks.push({ k: d.mix, from, to: 'blended', over: B.over });
      T.combos.push({ a: ['glass', 'empty'], b: [d.mix, ['blended', B.over]], st: d.st, q: 'b' });
      if (!d.shaker) { dish.uses.push(d.mix); need(giverOf(d.mix)); }
      need('ou_blender'); serve('glass', d.st, d.id); look('glass', d.st);
    } else if (d.how === 'pour') {   // (at the wine fridge, into its cup or glass)
      const W = st.ou_wine, into = typeof W.into === 'object' && !Array.isArray(W.into) ? W.into : Object.fromEntries(W.gives.map(g => [g, [].concat(W.into)]));
      W.gives = [...W.gives, d.give]; W.into = { ...into, [d.give]: [w] };
      dish.uses.push(d.give); need('ou_wine'); serve(w, d.give, d.id); look(w, d.give);
    } else if (d.how === 'asis') {   // (from the fridge, served as it comes)
      give(F, d.id, 'cold'); dish.uses.push(d.id); need('ou_fridge');
      (T.served[d.id] || (T.served[d.id] = {})).cold = d.id; T.say[`${d.id}:cold`] = lower(name);
      T.looks[d.id] = { model: d.id, raw: [], over: [] };
    }
  }
}
const DRINK = new Set(['steam', 'fill', 'blend', 'pour', 'asis']);
