// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Food and drink (2026-10-07, "when an agent gets a dessert it's an actual dessert"): every item a café, a restaurant
// or a home kitchen makes — its name, category, course, price, what it uses from the Global Market and, for drinks, the
// glass it comes in — and the kinds of place that serve them (a burger joint serves burgers, a seafood restaurant seafood).
// Each place has a kind (its cuisine) whose usual menu it starts with; its owner may change the kind and add or remove
// any item (server/economy/businesses.js). The 3D model of every item: client/js/render/food-models.js.
//
// Shared by the server (menus, what residents order: pickOrder, the courses of a visit: courses) and the client (menus,
// what a resident has on the table: item ids travel in a visible plan segment's last byte, shared/proto.js).
//
// ITEM NUMBERS (n, 1..255) are what the wire carries: never renumber or reuse one; new items take the next free number.

/** The categories the pack is organised by (menus and the editor group by them). icon: a drawn icon (client/js/core/icons.js). */
export const FOOD_CATS = [
  { id: 'coffee', label: 'Coffee & tea', icon: '☕' },
  { id: 'breakfast', label: 'Breakfast & brunch', icon: '🍳' },
  { id: 'bakery', label: 'Bakery & pastries', icon: '🥐' },
  { id: 'deli', label: 'Sandwiches & deli', icon: '🥪' },
  { id: 'burgers', label: 'Burgers & fries', icon: '🍔' },
  { id: 'pizza', label: 'Pizza', icon: '🍕' },
  { id: 'italian', label: 'Italian', icon: '🍝' },
  { id: 'mexican', label: 'Mexican', icon: '🌮' },
  { id: 'asian', label: 'Chinese, Thai & Vietnamese', icon: '🍜' },
  { id: 'japanese', label: 'Japanese & sushi', icon: '🍣' },
  { id: 'indian', label: 'Indian', icon: '🍛' },
  { id: 'mediterranean', label: 'Mediterranean', icon: '🥙' },
  { id: 'french', label: 'French bistro', icon: '🧀' },
  { id: 'seafood', label: 'Seafood', icon: '🐟' },
  { id: 'grill', label: 'Steak & BBQ', icon: '🥩' },
  { id: 'healthy', label: 'Salads & bowls', icon: '🥗' },
  { id: 'desserts', label: 'Desserts & ice cream', icon: '🍨' },
  { id: 'soft', label: 'Soft drinks & juices', icon: '🥤' },
  { id: 'bar', label: 'Beer, wine & cocktails', icon: '🍺' },
  { id: 'home', label: 'Home cooking', icon: '🥣' },
];
export const CAT_OF = Object.freeze(Object.fromEntries(FOOD_CATS.map(c => [c.id, c])));

/** Courses: how an item is eaten (what residents order with what) and the commodities one serving uses by default. */
export const COURSES = Object.freeze({
  main: { label: 'Mains', inputs: { food: 3 } },
  starter: { label: 'Starters & sides', inputs: { food: 1 } },
  snack: { label: 'Snacks & pastries', inputs: { baked: 1 } },
  dessert: { label: 'Desserts', inputs: { baked: 1, food: 1 } },
  drink: { label: 'Drinks', inputs: { drinks: 1 } },
});
export const COURSE_ORDER = ['main', 'starter', 'snack', 'dessert', 'drink'];

// Drinks: v = the glass (client/js/render/food-models.js VESSELS: also what is held in the hand), liq = what is in it,
// t = 'hot' | 'cold' | 'alc'. Food: bf = a breakfast item (what a morning order looks for).
const D = (v, liq, t) => ({ v, liq, t });
const ITEMS = [
  // ---------------------------------------------------------------- coffee & tea
  [1, 'coffee', 'Americano', 'coffee', 'drink', 350, D('mug', '#3b2414', 'hot')],
  [2, 'espresso', 'Espresso', 'coffee', 'drink', 300, D('espresso', '#2a170c', 'hot')],
  [3, 'latte', 'Latte', 'coffee', 'drink', 450, D('latte', '#c9a07a', 'hot')],
  [4, 'cappuccino', 'Cappuccino', 'coffee', 'drink', 450, D('cup', '#e8d6bf', 'hot')],
  [5, 'mocha', 'Mocha', 'coffee', 'drink', 500, D('mug', '#5a3420', 'hot')],
  [6, 'flat_white', 'Flat white', 'coffee', 'drink', 450, D('cup', '#c8a27c', 'hot')],
  [7, 'macchiato', 'Macchiato', 'coffee', 'drink', 380, D('espresso', '#d9c2a5', 'hot')],
  [8, 'iced_coffee', 'Iced coffee', 'coffee', 'drink', 450, D('tall', '#8a5a3a', 'cold')],
  [9, 'cold_brew', 'Cold brew', 'coffee', 'drink', 480, D('tall', '#3a2416', 'cold')],
  [10, 'frappe', 'Caramel frappé', 'coffee', 'drink', 550, D('frappe', '#c99a6b', 'cold')],
  [11, 'hot_chocolate', 'Hot chocolate', 'coffee', 'drink', 420, D('mug', '#5b3322', 'hot')],
  [12, 'tea', 'Black tea', 'coffee', 'drink', 300, D('teacup', '#8a3f17', 'hot')],
  [13, 'green_tea', 'Green tea', 'coffee', 'drink', 300, D('teacup', '#9fae4a', 'hot')],
  [14, 'chai_latte', 'Chai latte', 'coffee', 'drink', 450, D('latte', '#c79a68', 'hot')],
  [15, 'matcha_latte', 'Matcha latte', 'coffee', 'drink', 500, D('latte', '#9cc068', 'hot')],
  [16, 'coffee_to_go', 'Coffee to go', 'coffee', 'drink', 380, D('takeaway', '#3b2414', 'hot')],
  // ---------------------------------------------------------------- breakfast & brunch
  [20, 'pancakes', 'Pancake stack', 'breakfast', 'main', 950, { bf: 1 }],
  [21, 'waffles', 'Belgian waffles', 'breakfast', 'main', 950, { bf: 1 }],
  [22, 'french_toast', 'French toast', 'breakfast', 'main', 900, { bf: 1 }],
  [23, 'eggs_bacon', 'Eggs & bacon', 'breakfast', 'main', 1050, { bf: 1 }],
  [24, 'full_breakfast', 'Full breakfast', 'breakfast', 'main', 1400, { bf: 1 }],
  [25, 'omelette', 'Cheese omelette', 'breakfast', 'main', 950, { bf: 1 }],
  [26, 'eggs_benedict', 'Eggs Benedict', 'breakfast', 'main', 1200, { bf: 1 }],
  [27, 'avocado_toast', 'Avocado toast', 'breakfast', 'main', 1000, { bf: 1 }],
  [28, 'breakfast_burrito', 'Breakfast burrito', 'breakfast', 'main', 1000, { bf: 1 }],
  [29, 'yogurt_parfait', 'Yogurt parfait', 'breakfast', 'snack', 650, { bf: 1, inputs: { food: 1 } }],
  [30, 'oatmeal', 'Oatmeal with berries', 'breakfast', 'main', 650, { bf: 1, inputs: { food: 1 } }],
  [31, 'acai_bowl', 'Açaí bowl', 'breakfast', 'main', 950, { bf: 1, inputs: { food: 2 } }],
  [32, 'bagel_lox', 'Bagel & lox', 'breakfast', 'main', 1050, { bf: 1 }],
  // ---------------------------------------------------------------- bakery & pastries
  [40, 'croissant', 'Croissant', 'bakery', 'snack', 350, { bf: 1 }],
  [41, 'pain_au_chocolat', 'Pain au chocolat', 'bakery', 'snack', 380, { bf: 1 }],
  [42, 'muffin', 'Blueberry muffin', 'bakery', 'snack', 350, { bf: 1 }],
  [43, 'cinnamon_roll', 'Cinnamon roll', 'bakery', 'snack', 420, { bf: 1 }],
  [44, 'donut', 'Glazed donut', 'bakery', 'snack', 300, { bf: 1 }],
  [45, 'bagel', 'Bagel & cream cheese', 'bakery', 'snack', 450, { bf: 1 }],
  [46, 'scone', 'Scone with jam', 'bakery', 'snack', 380, { bf: 1 }],
  [47, 'danish', 'Fruit danish', 'bakery', 'snack', 400, { bf: 1 }],
  [48, 'banana_bread', 'Banana bread', 'bakery', 'snack', 380, {}],
  [49, 'cookie', 'Chocolate chip cookies', 'bakery', 'snack', 280, {}],
  [50, 'brownie', 'Brownie', 'bakery', 'snack', 380, {}],
  [51, 'pretzel', 'Soft pretzel', 'bakery', 'snack', 350, {}],
  // ---------------------------------------------------------------- sandwiches & deli
  [60, 'club_sandwich', 'Club sandwich', 'deli', 'main', 950, {}],
  [61, 'blt', 'BLT', 'deli', 'main', 850, {}],
  [62, 'grilled_cheese', 'Grilled cheese', 'deli', 'main', 700, {}],
  [63, 'panini', 'Caprese panini', 'deli', 'main', 900, {}],
  [64, 'sub', 'Italian sub', 'deli', 'main', 950, {}],
  [65, 'wrap', 'Chicken wrap', 'deli', 'main', 850, {}],
  [66, 'reuben', 'Reuben', 'deli', 'main', 1100, {}],
  [67, 'tuna_melt', 'Tuna melt', 'deli', 'main', 900, {}],
  // ---------------------------------------------------------------- burgers & fries
  [70, 'cheeseburger', 'Cheeseburger', 'burgers', 'main', 1200, {}],
  [71, 'bacon_burger', 'Bacon burger', 'burgers', 'main', 1400, {}],
  [72, 'double_burger', 'Double smash burger', 'burgers', 'main', 1600, {}],
  [73, 'chicken_burger', 'Crispy chicken burger', 'burgers', 'main', 1250, {}],
  [74, 'veggie_burger', 'Veggie burger', 'burgers', 'main', 1200, {}],
  [75, 'burger_fries', 'Burger & fries', 'burgers', 'main', 1500, {}],
  [76, 'hot_dog', 'Hot dog', 'burgers', 'main', 750, {}],
  [77, 'nuggets', 'Chicken nuggets', 'burgers', 'main', 800, {}],
  [78, 'fries', 'Fries', 'burgers', 'starter', 450, {}],
  [79, 'sweet_potato_fries', 'Sweet potato fries', 'burgers', 'starter', 500, {}],
  [80, 'onion_rings', 'Onion rings', 'burgers', 'starter', 500, {}],
  [81, 'milkshake', 'Milkshake', 'burgers', 'drink', 600, D('shake', '#f0d4dc', 'cold')],
  [82, 'choc_shake', 'Chocolate shake', 'burgers', 'drink', 600, D('shake', '#7a4a33', 'cold')],
  // ---------------------------------------------------------------- pizza
  [90, 'margherita', 'Margherita pizza', 'pizza', 'main', 1300, {}],
  [91, 'pepperoni', 'Pepperoni pizza', 'pizza', 'main', 1450, {}],
  [92, 'hawaiian', 'Hawaiian pizza', 'pizza', 'main', 1450, {}],
  [93, 'veggie_pizza', 'Garden veggie pizza', 'pizza', 'main', 1400, {}],
  [94, 'four_cheese', 'Four-cheese pizza', 'pizza', 'main', 1500, {}],
  [95, 'bbq_pizza', 'BBQ chicken pizza', 'pizza', 'main', 1550, {}],
  [96, 'pizza_slice', 'Pizza slice', 'pizza', 'main', 450, {}],
  [97, 'calzone', 'Calzone', 'pizza', 'main', 1300, {}],
  [98, 'garlic_bread', 'Garlic bread', 'pizza', 'starter', 550, {}],
  // ---------------------------------------------------------------- italian
  [110, 'spaghetti', 'Spaghetti bolognese', 'italian', 'main', 1500, {}],
  [111, 'carbonara', 'Carbonara', 'italian', 'main', 1500, {}],
  [112, 'pasta_pomodoro', 'Penne pomodoro', 'italian', 'main', 1300, {}],
  [113, 'lasagna', 'Lasagna', 'italian', 'main', 1550, {}],
  [114, 'alfredo', 'Fettuccine Alfredo', 'italian', 'main', 1450, {}],
  [115, 'risotto', 'Mushroom risotto', 'italian', 'main', 1500, {}],
  [116, 'gnocchi', 'Gnocchi al pesto', 'italian', 'main', 1400, {}],
  [117, 'ravioli', 'Ravioli', 'italian', 'main', 1450, {}],
  [118, 'bruschetta', 'Bruschetta', 'italian', 'starter', 750, {}],
  [119, 'caprese', 'Caprese salad', 'italian', 'starter', 850, {}],
  [120, 'minestrone', 'Minestrone', 'italian', 'starter', 750, {}],
  [121, 'tiramisu', 'Tiramisu', 'italian', 'dessert', 700, {}],
  [122, 'gelato', 'Gelato', 'italian', 'dessert', 550, {}],
  // ---------------------------------------------------------------- mexican
  [130, 'tacos', 'Street tacos', 'mexican', 'main', 1100, {}],
  [131, 'burrito', 'Burrito', 'mexican', 'main', 1200, {}],
  [132, 'quesadilla', 'Quesadilla', 'mexican', 'main', 1000, {}],
  [133, 'nachos', 'Loaded nachos', 'mexican', 'starter', 900, {}],
  [134, 'enchiladas', 'Enchiladas', 'mexican', 'main', 1300, {}],
  [135, 'fajitas', 'Sizzling fajitas', 'mexican', 'main', 1550, {}],
  [136, 'chips_guac', 'Chips & guacamole', 'mexican', 'starter', 700, {}],
  [137, 'burrito_bowl', 'Burrito bowl', 'mexican', 'main', 1150, {}],
  [138, 'churros', 'Churros', 'mexican', 'dessert', 600, {}],
  [139, 'horchata', 'Horchata', 'mexican', 'drink', 400, D('tall', '#efe6d4', 'cold')],
  // ---------------------------------------------------------------- chinese, thai & vietnamese
  [150, 'fried_rice', 'Egg fried rice', 'asian', 'main', 1050, {}],
  [151, 'chow_mein', 'Chow mein', 'asian', 'main', 1150, {}],
  [152, 'kung_pao', 'Kung pao chicken', 'asian', 'main', 1350, {}],
  [153, 'sweet_sour', 'Sweet & sour chicken', 'asian', 'main', 1300, {}],
  [154, 'dumplings', 'Steamed dumplings', 'asian', 'starter', 900, {}],
  [155, 'spring_rolls', 'Spring rolls', 'asian', 'starter', 700, {}],
  [156, 'pad_thai', 'Pad thai', 'asian', 'main', 1300, {}],
  [157, 'green_curry', 'Thai green curry', 'asian', 'main', 1350, {}],
  [158, 'pho', 'Beef pho', 'asian', 'main', 1300, {}],
  [159, 'bao', 'Pork bao buns', 'asian', 'starter', 950, {}],
  [160, 'peking_duck', 'Peking duck', 'asian', 'main', 2200, {}],
  [161, 'bubble_tea', 'Bubble tea', 'asian', 'drink', 550, D('boba', '#d9b48c', 'cold')],
  // ---------------------------------------------------------------- japanese & sushi
  [170, 'sushi_platter', 'Sushi platter', 'japanese', 'main', 1900, {}],
  [171, 'nigiri', 'Salmon nigiri', 'japanese', 'main', 1300, {}],
  [172, 'maki', 'Maki rolls', 'japanese', 'main', 1200, {}],
  [173, 'sashimi', 'Sashimi', 'japanese', 'main', 2000, {}],
  [174, 'ramen', 'Tonkotsu ramen', 'japanese', 'main', 1400, {}],
  [175, 'tempura', 'Tempura', 'japanese', 'main', 1300, {}],
  [176, 'teriyaki', 'Chicken teriyaki', 'japanese', 'main', 1350, {}],
  [177, 'katsu_curry', 'Katsu curry', 'japanese', 'main', 1400, {}],
  [178, 'miso_soup', 'Miso soup', 'japanese', 'starter', 450, {}],
  [179, 'edamame', 'Edamame', 'japanese', 'starter', 450, {}],
  [180, 'gyoza', 'Gyoza', 'japanese', 'starter', 800, {}],
  [181, 'mochi', 'Mochi', 'japanese', 'dessert', 550, {}],
  [182, 'sake', 'Sake', 'japanese', 'drink', 800, D('sake', '#f2f0e4', 'alc')],
  // ---------------------------------------------------------------- indian
  [190, 'butter_chicken', 'Butter chicken', 'indian', 'main', 1450, {}],
  [191, 'tikka_masala', 'Chicken tikka masala', 'indian', 'main', 1450, {}],
  [192, 'biryani', 'Lamb biryani', 'indian', 'main', 1450, {}],
  [193, 'dal', 'Dal tadka', 'indian', 'main', 1000, {}],
  [194, 'palak_paneer', 'Palak paneer', 'indian', 'main', 1300, {}],
  [195, 'samosas', 'Samosas', 'indian', 'starter', 700, {}],
  [196, 'naan', 'Garlic naan', 'indian', 'starter', 350, {}],
  [197, 'tandoori', 'Tandoori chicken', 'indian', 'main', 1500, {}],
  [198, 'mango_lassi', 'Mango lassi', 'indian', 'drink', 500, D('tall', '#f2b440', 'cold')],
  // ---------------------------------------------------------------- mediterranean
  [205, 'hummus', 'Hummus & pita', 'mediterranean', 'starter', 750, {}],
  [206, 'falafel', 'Falafel plate', 'mediterranean', 'main', 1100, {}],
  [207, 'shawarma', 'Chicken shawarma', 'mediterranean', 'main', 1200, {}],
  [208, 'kebab', 'Lamb kebab', 'mediterranean', 'main', 1500, {}],
  [209, 'gyro', 'Gyro', 'mediterranean', 'main', 1050, {}],
  [210, 'greek_salad', 'Greek salad', 'mediterranean', 'starter', 950, {}],
  [211, 'moussaka', 'Moussaka', 'mediterranean', 'main', 1450, {}],
  [212, 'baklava', 'Baklava', 'mediterranean', 'dessert', 550, {}],
  // ---------------------------------------------------------------- french bistro
  [220, 'steak_frites', 'Steak frites', 'french', 'main', 2400, {}],
  [221, 'croque', 'Croque monsieur', 'french', 'main', 950, {}],
  [222, 'onion_soup', 'French onion soup', 'french', 'starter', 850, {}],
  [223, 'quiche', 'Quiche Lorraine', 'french', 'main', 1000, {}],
  [224, 'coq_au_vin', 'Coq au vin', 'french', 'main', 1900, {}],
  [225, 'ratatouille', 'Ratatouille', 'french', 'main', 1300, {}],
  [226, 'creme_brulee', 'Crème brûlée', 'french', 'dessert', 750, {}],
  [227, 'crepes', 'Crêpes', 'french', 'dessert', 700, { bf: 1 }],
  [228, 'macarons', 'Macarons', 'french', 'dessert', 600, {}],
  // ---------------------------------------------------------------- seafood
  [235, 'fish_chips', 'Fish & chips', 'seafood', 'main', 1500, {}],
  [236, 'salmon', 'Grilled salmon', 'seafood', 'main', 1900, {}],
  [237, 'shrimp', 'Garlic shrimp', 'seafood', 'main', 1700, {}],
  [238, 'lobster', 'Lobster', 'seafood', 'main', 3500, {}],
  [239, 'oysters', 'Oysters', 'seafood', 'starter', 2200, {}],
  [240, 'fish_tacos', 'Fish tacos', 'seafood', 'main', 1300, {}],
  [241, 'chowder', 'Clam chowder', 'seafood', 'starter', 900, {}],
  [242, 'paella', 'Seafood paella', 'seafood', 'main', 2200, {}],
  [243, 'calamari', 'Fried calamari', 'seafood', 'starter', 1000, {}],
  [244, 'mussels', 'Mussels', 'seafood', 'main', 1800, {}],
  [245, 'shrimp_cocktail', 'Shrimp cocktail', 'seafood', 'starter', 1100, {}],
  // ---------------------------------------------------------------- steak & bbq
  [250, 'ribeye', 'Ribeye steak', 'grill', 'main', 3200, {}],
  [251, 'bbq_ribs', 'BBQ ribs', 'grill', 'main', 2400, {}],
  [252, 'pulled_pork', 'Pulled pork', 'grill', 'main', 1600, {}],
  [253, 'roast_chicken', 'Half roast chicken', 'grill', 'main', 1700, {}],
  [254, 'wings', 'Buffalo wings', 'grill', 'starter', 1100, {}],
  [255, 'brisket', 'Smoked brisket', 'grill', 'main', 2000, {}],
  [100, 'mac_cheese', 'Mac & cheese', 'grill', 'starter', 700, {}],
  [101, 'corn', 'Corn on the cob', 'grill', 'starter', 400, {}],
  [102, 'mash', 'Mashed potatoes', 'grill', 'starter', 450, {}],
  [103, 'coleslaw', 'Coleslaw', 'grill', 'starter', 400, {}],
  // ---------------------------------------------------------------- salads & bowls
  [105, 'caesar', 'Caesar salad', 'healthy', 'main', 1100, {}],
  [106, 'garden_salad', 'Garden salad', 'healthy', 'starter', 750, {}],
  [107, 'cobb', 'Cobb salad', 'healthy', 'main', 1250, {}],
  [108, 'poke', 'Poke bowl', 'healthy', 'main', 1500, {}],
  [109, 'buddha_bowl', 'Buddha bowl', 'healthy', 'main', 1300, {}],
  [17, 'tomato_soup', 'Tomato soup', 'healthy', 'starter', 700, {}],
  [18, 'chicken_soup', 'Chicken noodle soup', 'healthy', 'starter', 800, {}],
  [19, 'smoothie', 'Berry smoothie', 'healthy', 'drink', 600, D('smoothie', '#b23a5e', 'cold')],
  [33, 'green_smoothie', 'Green smoothie', 'healthy', 'drink', 600, D('smoothie', '#7fae3c', 'cold')],
  // ---------------------------------------------------------------- desserts & ice cream
  [34, 'choc_cake', 'Chocolate cake', 'desserts', 'dessert', 650, {}],
  [35, 'cheesecake', 'Cheesecake', 'desserts', 'dessert', 650, {}],
  [36, 'apple_pie', 'Apple pie', 'desserts', 'dessert', 600, {}],
  [37, 'sundae', 'Ice cream sundae', 'desserts', 'dessert', 700, {}],
  [38, 'ice_cream', 'Ice cream cone', 'desserts', 'dessert', 450, {}],
  [39, 'fruit_tart', 'Fruit tart', 'desserts', 'dessert', 650, {}],
  [52, 'cupcake', 'Cupcake', 'desserts', 'dessert', 400, {}],
  [53, 'lava_cake', 'Molten lava cake', 'desserts', 'dessert', 750, {}],
  [54, 'banana_split', 'Banana split', 'desserts', 'dessert', 750, {}],
  [55, 'pudding', 'Chocolate pudding', 'desserts', 'dessert', 500, {}],
  // ---------------------------------------------------------------- soft drinks & juices
  [56, 'cola', 'Cola', 'soft', 'drink', 300, D('soda', '#3a1a10', 'cold')],
  [57, 'lemon_soda', 'Lemon-lime soda', 'soft', 'drink', 300, D('soda', '#e6f0b8', 'cold')],
  [58, 'lemonade', 'Lemonade', 'soft', 'drink', 350, D('tall', '#f4e48a', 'cold')],
  [59, 'iced_tea', 'Iced tea', 'soft', 'drink', 350, D('tall', '#a5521f', 'cold')],
  [68, 'orange_juice', 'Orange juice', 'soft', 'drink', 400, D('juice', '#f39a1e', 'cold')],
  [69, 'apple_juice', 'Apple juice', 'soft', 'drink', 400, D('juice', '#e7b84a', 'cold')],
  [83, 'water', 'Still water', 'soft', 'drink', 200, D('bottle_water', '#dceef8', 'cold')],
  [84, 'sparkling', 'Sparkling water', 'soft', 'drink', 250, D('tumbler', '#e6f4fb', 'cold')],
  [85, 'soda_can', 'Soda can', 'soft', 'drink', 250, D('can', '#c8202a', 'cold')],
  // ---------------------------------------------------------------- beer, wine & cocktails
  [86, 'beer', 'Pint of lager', 'bar', 'drink', 600, D('pint', '#e7a92b', 'alc')],
  [87, 'stout', 'Stout', 'bar', 'drink', 650, D('pint', '#1c120c', 'alc')],
  [88, 'bottled_beer', 'Bottled beer', 'bar', 'drink', 550, D('beer_bottle', '#6b4a1a', 'alc')],
  [89, 'red_wine', 'Red wine', 'bar', 'drink', 750, D('wine', '#6b0f22', 'alc')],
  [99, 'white_wine', 'White wine', 'bar', 'drink', 750, D('wine', '#ead98a', 'alc')],
  [104, 'rose', 'Rosé', 'bar', 'drink', 750, D('wine', '#f0a3a0', 'alc')],
  [123, 'champagne', 'Champagne', 'bar', 'drink', 1100, D('flute', '#f1e2a0', 'alc')],
  [124, 'margarita', 'Margarita', 'bar', 'drink', 900, D('coupe', '#d7e89a', 'alc')],
  [125, 'mojito', 'Mojito', 'bar', 'drink', 900, D('highball', '#dff2c8', 'alc')],
  [126, 'martini', 'Martini', 'bar', 'drink', 1000, D('martini', '#eef0e0', 'alc')],
  [127, 'old_fashioned', 'Old fashioned', 'bar', 'drink', 1000, D('rocks', '#b5651d', 'alc')],
  [128, 'pina_colada', 'Piña colada', 'bar', 'drink', 950, D('hurricane', '#f6efd6', 'alc')],
  [129, 'whiskey', 'Whiskey', 'bar', 'drink', 900, D('rocks', '#c47a2c', 'alc')],
  [140, 'gin_tonic', 'Gin & tonic', 'bar', 'drink', 850, D('highball', '#e9f3f6', 'alc')],
  [141, 'cosmopolitan', 'Cosmopolitan', 'bar', 'drink', 950, D('martini', '#e0566e', 'alc')],
  [142, 'aperol', 'Aperol spritz', 'bar', 'drink', 900, D('wine_big', '#f26a1b', 'alc')],
  [143, 'sangria', 'Sangria', 'bar', 'drink', 850, D('wine_big', '#8e1b2c', 'alc')],
  // ---------------------------------------------------------------- home cooking (what people make in their own kitchens)
  [144, 'cereal', 'Bowl of cereal', 'home', 'main', 300, { bf: 1, inputs: { groceries: 1 } }],
  [145, 'toast_jam', 'Toast & jam', 'home', 'snack', 250, { bf: 1, inputs: { groceries: 1 } }],
  [146, 'scrambled_eggs', 'Scrambled eggs on toast', 'home', 'main', 500, { bf: 1, inputs: { groceries: 1 } }],
  [147, 'pbj', 'PB&J sandwich', 'home', 'main', 350, { inputs: { groceries: 1 } }],
  [148, 'stir_fry', 'Veggie stir-fry', 'home', 'main', 700, { inputs: { groceries: 1 } }],
  [149, 'chicken_veg', 'Chicken & roast veg', 'home', 'main', 900, { inputs: { groceries: 1 } }],
  [162, 'home_pasta', 'Spaghetti with tomato sauce', 'home', 'main', 600, { inputs: { groceries: 1 } }],
  [163, 'instant_noodles', 'Instant noodles', 'home', 'main', 250, { inputs: { groceries: 1 } }],
  [164, 'rice_beans', 'Rice & beans', 'home', 'main', 450, { inputs: { groceries: 1 } }],
  [165, 'veg_soup', 'Vegetable soup', 'home', 'main', 450, { inputs: { groceries: 1 } }],
  [166, 'salmon_rice', 'Salmon, rice & greens', 'home', 'main', 1000, { inputs: { groceries: 1 } }],
  [167, 'tacos_home', 'Taco night', 'home', 'main', 700, { inputs: { groceries: 1 } }],
  [168, 'lunchbox', 'Packed lunch', 'home', 'main', 500, { inputs: { groceries: 1 } }],
  [169, 'leftovers', 'Leftovers', 'home', 'main', 300, { inputs: { groceries: 1 } }],
  [183, 'glass_milk', 'Glass of milk', 'home', 'drink', 150, D('juice', '#f7f5ee', 'cold')],
  [184, 'glass_water', 'Glass of water', 'home', 'drink', 50, D('tumbler', '#dceef8', 'cold')],
];

/**
 * How a dish is eaten (2026-10-07, "proper eating animations depending on the meal" — the clip and what is in the
 * hands: client/js/render/char-props.js): 'hands' held in both (a burger, a sandwich, a wrap), 'hand' in one (a slice,
 * fries, a pastry), 'knife' (knife and fork), 'fork', 'spoon', 'sticks' (chopsticks). Drinks are sipped (no way). The
 * category's way unless the dish has its own.
 */
export const EAT_WAYS = ['hands', 'hand', 'knife', 'fork', 'spoon', 'sticks'];
const EAT_CAT = { breakfast: 'knife', bakery: 'hand', deli: 'hands', burgers: 'hands', pizza: 'hand', italian: 'fork', mexican: 'hands',
  asian: 'sticks', japanese: 'sticks', indian: 'spoon', mediterranean: 'fork', french: 'knife', seafood: 'knife', grill: 'knife',
  healthy: 'fork', desserts: 'fork', home: 'fork' };
const EAT_ITEM = {
  avocado_toast: 'hand', breakfast_burrito: 'hands', yogurt_parfait: 'spoon', oatmeal: 'spoon', acai_bowl: 'spoon', bagel_lox: 'hand',
  nuggets: 'hand', fries: 'hand', sweet_potato_fries: 'hand', onion_rings: 'hand',
  calzone: 'knife',
  bruschetta: 'hand', minestrone: 'spoon', gelato: 'spoon',
  quesadilla: 'hand', nachos: 'hand', enchiladas: 'knife', chips_guac: 'hand', burrito_bowl: 'fork', churros: 'hand',
  green_curry: 'spoon', bao: 'hand', peking_duck: 'hand',
  miso_soup: 'spoon', edamame: 'hand', mochi: 'hand', katsu_curry: 'spoon',
  samosas: 'hand', naan: 'hand', tandoori: 'hand',
  hummus: 'hand', shawarma: 'hands', kebab: 'knife', gyro: 'hands', baklava: 'hand',
  onion_soup: 'spoon', quiche: 'fork', ratatouille: 'fork', creme_brulee: 'spoon', crepes: 'fork', macarons: 'hand',
  shrimp: 'fork', oysters: 'hand', fish_tacos: 'hands', chowder: 'spoon', paella: 'fork', calamari: 'hand', mussels: 'fork', shrimp_cocktail: 'hand',
  bbq_ribs: 'hands', pulled_pork: 'hands', wings: 'hand', mac_cheese: 'fork', corn: 'hands', mash: 'fork', coleslaw: 'fork',
  tomato_soup: 'spoon', chicken_soup: 'spoon', poke: 'sticks',
  sundae: 'spoon', ice_cream: 'spoon', cupcake: 'hand', banana_split: 'spoon', pudding: 'spoon', lava_cake: 'spoon',
  cereal: 'spoon', toast_jam: 'hand', pbj: 'hands', chicken_veg: 'knife', instant_noodles: 'sticks', veg_soup: 'spoon',
  tacos_home: 'hands', lunchbox: 'hand',
};

/** Every item: { n, id, name, cat, course, price, inputs, bf?, v?, liq?, t?, eat? } (prices in hundredths of a VC). */
export const FOOD = [];
export const FOOD_BY_ID = Object.create(null);
/** n (the wire's item number) → item. */
export const FOOD_BY_N = new Array(256).fill(null);
for (const [n, id, name, cat, course, price, o] of ITEMS) {
  if (!(n >= 1 && n <= 255) || FOOD_BY_N[n] || FOOD_BY_ID[id] || !CAT_OF[cat] || !COURSES[course]) throw new Error(`food: bad item ${n} ${id}`);
  const eat = o.v ? null : EAT_ITEM[id] || EAT_CAT[cat];
  if (!o.v && !EAT_WAYS.includes(eat)) throw new Error(`food: no way to eat ${id}`);
  const it = Object.freeze({ n, id, name, cat, course, price, icon: o.v ? DRINK_ICON(o) : CAT_OF[cat].icon,
    inputs: Object.freeze({ ...(o.inputs || (o.t === 'hot' && cat === 'coffee' ? { coffee: 1 } : COURSES[course].inputs)) }),
    ...(o.bf ? { bf: true } : {}), ...(o.v ? { v: o.v, liq: o.liq, t: o.t } : { eat }) });
  FOOD.push(it); FOOD_BY_ID[id] = it; FOOD_BY_N[n] = it;
}
Object.freeze(FOOD);
for (const id of Object.keys(EAT_ITEM)) if (!FOOD_BY_ID[id] || FOOD_BY_ID[id].v) throw new Error(`food: a way to eat ${id}, no such dish`);
function DRINK_ICON(o) {
  if (o.t === 'hot') return '☕';
  if (o.t === 'alc') return o.v === 'pint' || o.v === 'beer_bottle' ? '🍺' : o.v === 'wine' || o.v === 'wine_big' || o.v === 'flute' ? '🍷' : '🍸';
  return o.v === 'juice' ? '🧃' : '🥤';
}
export const isDrink = it => !!it && it.course === 'drink';
export const foodItem = id => (typeof id === 'number' ? FOOD_BY_N[id] : FOOD_BY_ID[id]) || null;

// ---------------------------------------------------------------------------------------------------------- cuisines
/** The kinds of place (a place's cuisine): label, icon, the venue it suits best and the menu it starts with. */
export const CUISINES = [
  { id: 'cafe', label: 'Café', icon: '☕', venue: 'cafe', desc: 'Coffee, tea, pastries and a light lunch',
    menu: ['coffee', 'espresso', 'latte', 'cappuccino', 'flat_white', 'mocha', 'tea', 'iced_coffee', 'hot_chocolate', 'croissant', 'muffin', 'cinnamon_roll', 'club_sandwich', 'panini', 'avocado_toast', 'tomato_soup', 'orange_juice', 'cheesecake'] },
  { id: 'coffee_house', label: 'Coffee house', icon: '☕', venue: 'cafe', desc: 'Speciality coffee, tea and something sweet',
    menu: ['coffee', 'espresso', 'macchiato', 'latte', 'cappuccino', 'flat_white', 'cold_brew', 'frappe', 'chai_latte', 'matcha_latte', 'green_tea', 'croissant', 'pain_au_chocolat', 'banana_bread', 'cookie', 'brownie'] },
  { id: 'bakery', label: 'Bakery', icon: '🥐', venue: 'cafe', desc: 'Fresh bread, pastries and cakes',
    menu: ['croissant', 'pain_au_chocolat', 'danish', 'scone', 'muffin', 'cinnamon_roll', 'donut', 'bagel', 'pretzel', 'banana_bread', 'cookie', 'choc_cake', 'fruit_tart', 'cupcake', 'coffee', 'latte', 'tea', 'orange_juice'] },
  { id: 'brunch', label: 'Breakfast & brunch', icon: '🍳', venue: 'cafe', desc: 'Eggs, pancakes and bottomless coffee',
    menu: ['pancakes', 'waffles', 'french_toast', 'eggs_bacon', 'full_breakfast', 'omelette', 'eggs_benedict', 'avocado_toast', 'breakfast_burrito', 'acai_bowl', 'yogurt_parfait', 'bagel_lox', 'coffee', 'latte', 'cappuccino', 'orange_juice', 'smoothie', 'tea'] },
  { id: 'diner', label: 'Diner', icon: '🍔', venue: 'restaurant', desc: 'All-day breakfast, burgers and shakes',
    menu: ['pancakes', 'eggs_bacon', 'omelette', 'cheeseburger', 'bacon_burger', 'club_sandwich', 'grilled_cheese', 'hot_dog', 'fries', 'onion_rings', 'mac_cheese', 'apple_pie', 'sundae', 'milkshake', 'choc_shake', 'coffee', 'cola', 'lemonade'] },
  { id: 'burger', label: 'Burger joint', icon: '🍔', venue: 'restaurant', desc: 'Burgers, fries and shakes',
    menu: ['cheeseburger', 'bacon_burger', 'double_burger', 'chicken_burger', 'veggie_burger', 'burger_fries', 'nuggets', 'hot_dog', 'fries', 'sweet_potato_fries', 'onion_rings', 'milkshake', 'choc_shake', 'cola', 'lemon_soda', 'beer', 'sundae'] },
  { id: 'pizza', label: 'Pizzeria', icon: '🍕', venue: 'restaurant', desc: 'Stone-baked pizza by the pie or the slice',
    menu: ['margherita', 'pepperoni', 'hawaiian', 'veggie_pizza', 'four_cheese', 'bbq_pizza', 'pizza_slice', 'calzone', 'garlic_bread', 'garden_salad', 'tiramisu', 'gelato', 'cola', 'lemonade', 'beer', 'red_wine'] },
  { id: 'italian', label: 'Italian', icon: '🍝', venue: 'restaurant', desc: 'Pasta, risotto and wood-fired classics',
    menu: ['bruschetta', 'caprese', 'minestrone', 'spaghetti', 'carbonara', 'pasta_pomodoro', 'lasagna', 'alfredo', 'risotto', 'gnocchi', 'ravioli', 'margherita', 'tiramisu', 'gelato', 'red_wine', 'white_wine', 'espresso', 'sparkling'] },
  { id: 'mexican', label: 'Mexican', icon: '🌮', venue: 'restaurant', desc: 'Tacos, burritos and margaritas',
    menu: ['chips_guac', 'nachos', 'tacos', 'burrito', 'burrito_bowl', 'quesadilla', 'enchiladas', 'fajitas', 'fish_tacos', 'churros', 'horchata', 'margarita', 'bottled_beer', 'lemonade', 'cola'] },
  { id: 'asian', label: 'Chinese & Thai', icon: '🍜', venue: 'restaurant', desc: 'Wok dishes, dumplings and curries',
    menu: ['spring_rolls', 'dumplings', 'bao', 'fried_rice', 'chow_mein', 'kung_pao', 'sweet_sour', 'peking_duck', 'pad_thai', 'green_curry', 'pho', 'mochi', 'bubble_tea', 'green_tea', 'beer', 'cola'] },
  { id: 'noodle', label: 'Noodle bar', icon: '🍜', venue: 'restaurant', desc: 'Ramen, pho and noodles',
    menu: ['ramen', 'pho', 'pad_thai', 'chow_mein', 'gyoza', 'dumplings', 'spring_rolls', 'edamame', 'bao', 'katsu_curry', 'mochi', 'bubble_tea', 'green_tea', 'beer', 'sake'] },
  { id: 'japanese', label: 'Sushi & Japanese', icon: '🍣', venue: 'restaurant', desc: 'Sushi, sashimi, ramen and tempura',
    menu: ['miso_soup', 'edamame', 'gyoza', 'sushi_platter', 'nigiri', 'maki', 'sashimi', 'ramen', 'tempura', 'teriyaki', 'katsu_curry', 'mochi', 'green_tea', 'sake', 'beer'] },
  { id: 'indian', label: 'Indian', icon: '🍛', venue: 'restaurant', desc: 'Curries, tandoori and naan',
    menu: ['samosas', 'naan', 'butter_chicken', 'tikka_masala', 'biryani', 'dal', 'palak_paneer', 'tandoori', 'mango_lassi', 'chai_latte', 'beer', 'sparkling'] },
  { id: 'mediterranean', label: 'Mediterranean', icon: '🥙', venue: 'restaurant', desc: 'Mezze, grills and fresh salads',
    menu: ['hummus', 'greek_salad', 'falafel', 'shawarma', 'kebab', 'gyro', 'moussaka', 'salmon', 'baklava', 'white_wine', 'red_wine', 'lemonade', 'sparkling'] },
  { id: 'bistro', label: 'French bistro', icon: '🧀', venue: 'restaurant', desc: 'Bistro classics and good wine',
    menu: ['onion_soup', 'quiche', 'croque', 'steak_frites', 'coq_au_vin', 'ratatouille', 'salmon', 'mussels', 'creme_brulee', 'crepes', 'macarons', 'red_wine', 'white_wine', 'champagne', 'espresso'] },
  { id: 'seafood', label: 'Seafood', icon: '🐟', venue: 'restaurant', desc: 'Fresh fish, shellfish and chowder',
    menu: ['oysters', 'shrimp_cocktail', 'calamari', 'chowder', 'fish_chips', 'salmon', 'shrimp', 'lobster', 'fish_tacos', 'paella', 'mussels', 'apple_pie', 'white_wine', 'beer', 'lemonade'] },
  { id: 'grill', label: 'Steakhouse & BBQ', icon: '🥩', venue: 'restaurant', desc: 'Steaks, ribs and smoked meats',
    menu: ['wings', 'ribeye', 'steak_frites', 'bbq_ribs', 'brisket', 'pulled_pork', 'roast_chicken', 'mac_cheese', 'corn', 'mash', 'coleslaw', 'fries', 'apple_pie', 'red_wine', 'beer', 'old_fashioned', 'cola'] },
  { id: 'healthy', label: 'Salads & bowls', icon: '🥗', venue: 'restaurant', desc: 'Fresh salads, bowls and smoothies',
    menu: ['caesar', 'garden_salad', 'cobb', 'greek_salad', 'poke', 'buddha_bowl', 'burrito_bowl', 'acai_bowl', 'tomato_soup', 'chicken_soup', 'wrap', 'smoothie', 'green_smoothie', 'iced_tea', 'sparkling', 'yogurt_parfait'] },
  { id: 'desserts', label: 'Desserts & ice cream', icon: '🍨', venue: 'cafe', desc: 'Cakes, sundaes and sweet treats',
    menu: ['ice_cream', 'sundae', 'banana_split', 'gelato', 'choc_cake', 'cheesecake', 'lava_cake', 'apple_pie', 'fruit_tart', 'cupcake', 'macarons', 'crepes', 'milkshake', 'choc_shake', 'hot_chocolate', 'coffee'] },
  { id: 'bar', label: 'Bar & pub', icon: '🍺', venue: 'restaurant', desc: 'Drinks, cocktails and bar food',
    menu: ['beer', 'stout', 'bottled_beer', 'red_wine', 'white_wine', 'champagne', 'margarita', 'mojito', 'martini', 'old_fashioned', 'gin_tonic', 'whiskey', 'aperol', 'wings', 'fries', 'nachos', 'burger_fries', 'cola'] },
  { id: 'restaurant', label: 'Restaurant', icon: '🍽️', venue: 'restaurant', desc: 'A bit of everything',
    menu: ['tomato_soup', 'caesar', 'bruschetta', 'spaghetti', 'salmon', 'steak_frites', 'roast_chicken', 'cheeseburger', 'risotto', 'choc_cake', 'cheesecake', 'red_wine', 'white_wine', 'beer', 'cola', 'sparkling', 'espresso'] },
];
export const CUISINE_OF = Object.freeze(Object.fromEntries(CUISINES.map(c => [c.id, c])));
for (const c of CUISINES) for (const id of c.menu) if (!FOOD_BY_ID[id]) throw new Error(`food: cuisine ${c.id} lists unknown item ${id}`);

/** What a place's name says it serves (the world's own names: shared/names.js), first match wins. */
const NAME_HINTS = [
  [/bak|crumb|bread|oven|flour|patisser/i, 'bakery'],
  [/burger|patty/i, 'burger'], [/pizz/i, 'pizza'], [/sushi|sakura|tokyo|ramen|izakaya/i, 'japanese'], [/noodle|pho\b|pho |ramen/i, 'noodle'],
  [/dim sum|wok|dragon|panda|jade|thai|bangkok|lotus/i, 'asian'], [/taco|cantina|burrito|loco|mexic/i, 'mexican'],
  [/trattoria|roma|osteria|pasta|italia|bella/i, 'italian'], [/spice|curry|tandoor|masala|bombay|delhi|india/i, 'indian'],
  [/mezze|olive|thyme|aegean|greek|falafel|kebab/i, 'mediterranean'], [/bistro|brasserie|petit|paris|\b(le|la) /i, 'bistro'],
  [/fish|harbo|oyster|crab|lobster|seafood|marin|catch/i, 'seafood'], [/grill|bbq|smoke|steak|chop|ranch/i, 'grill'],
  [/green|bowl|salad|leaf|fresh|garden/i, 'healthy'], [/diner/i, 'diner'], [/pub|tavern|tap|brew house|saloon|\bbar\b|lounge/i, 'bar'],
  [/brunch|morning|sunny|egg|pancake/i, 'brunch'],
  [/ice cream|gelat|sweet|sugar|cake|scoop|dessert/i, 'desserts'], [/roast|espresso|brew|bean|drip|pour|latte|grounds|coffee/i, 'coffee_house'],
];
// a name that says nothing: the restaurants spread over these, the cafés stay cafés
const SPREAD = ['restaurant', 'italian', 'burger', 'pizza', 'asian', 'mexican', 'seafood', 'japanese', 'grill', 'indian', 'diner', 'healthy', 'bistro', 'mediterranean'];
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** The cuisine a place starts as: from its name, else by venue (cafés: Café; restaurants spread by the seed). */
export function guessCuisine(name, venue, seed = 0) {
  const s = String(name || '').replace(/\s+(dining room|upstairs|downstairs|terrace)$/i, '');   // a place's other floors are the same kind
  for (const [re, id] of NAME_HINTS) if (re.test(s)) return id;
  if (venue === 'cafe') return 'cafe';
  return SPREAD[hash(`${s}:${seed}`) % SPREAD.length];
}
export const MENU_MAX = 40;
/** A menu as ids: the place's own list (known items only), or its cuisine's. */
export function menuIds(cuisine, own) {
  if (Array.isArray(own)) { const out = own.filter(id => FOOD_BY_ID[id]); if (out.length) return out; }
  return (CUISINE_OF[cuisine] || CUISINE_OF.restaurant).menu;
}

// ---------------------------------------------------------------------------------------------------------- ordering
/**
 * What someone orders on a visit (deterministic: r(tag) is a number 0..1 fixed by who, when and the tag, so every replay
 * agrees and no simulation random number is drawn). menu: item ids; occasion: 'meal' | 'breakfast' | 'cafe' | 'coffee' |
 * 'bar'; hour 0..24. Returns item ids, the main thing first (an empty list only for an empty menu).
 */
export function pickOrder(menu, occasion, hour, r) {
  const items = menu.map(foodItem).filter(Boolean);
  if (!items.length) return [];
  const of = f => items.filter(f), one = (list, tag) => (list.length ? list[Math.floor(r(tag) * list.length) % list.length] : null);
  const hot = of(i => i.t === 'hot'), cold = of(i => i.t === 'cold'), alc = of(i => i.t === 'alc');
  const mains = of(i => i.course === 'main' && !i.bf), bfast = of(i => i.bf && i.course !== 'drink'), starters = of(i => i.course === 'starter');
  const snacks = of(i => i.course === 'snack' || (i.course === 'dessert' && i.cat !== 'italian')), desserts = of(i => i.course === 'dessert');
  const food = of(i => i.course !== 'drink'), drinks = of(i => i.course === 'drink');
  const out = [], add = x => { if (x && !out.includes(x.id)) out.push(x.id); };
  const morning = hour >= 5 && hour < 11, evening = hour >= 17 || hour < 4;
  const drinkFor = (tag, alcOk) => {
    const w = r(tag + 'w'), soft = occasion !== 'meal' && occasion !== 'bar';
    if (alcOk && alc.length && w < (occasion === 'bar' ? 0.85 : 0.45)) return one(alc, tag);
    if (hot.length && w < (morning ? 0.85 : soft ? 0.7 : 0.12)) return one(hot, tag);
    if (cold.length && w < 0.92) return one(cold, tag);
    return one(hot.length && (morning || occasion !== 'meal') ? hot : drinks.filter(i => i.t !== 'alc').length ? drinks.filter(i => i.t !== 'alc') : drinks, tag);
  };
  switch (occasion) {
    case 'bar':
      add(drinkFor('d1', true));
      if (r('d2') < 0.4) add(drinkFor('d2', true));
      if (r('sn') < 0.25) add(one(starters.length ? starters : food, 'sn'));
      break;
    case 'coffee':
      add(drinkFor('d', false));
      if (r('sn') < 0.2) add(one(snacks, 'sn'));
      break;
    case 'cafe':
      add(drinkFor('d', false));
      if (r('sn') < 0.35) add(one(morning && bfast.length ? bfast : snacks.length ? snacks : food, 'sn'));
      break;
    case 'breakfast':
      add(one(bfast.length ? bfast : snacks.length ? snacks : food, 'm'));
      if (r('dr') < 0.85) add(drinkFor('dr', false));
      break;
    default: {   // a meal
      add(one(morning && bfast.length ? bfast : mains.length ? mains : food, 'm'));
      if (starters.length && r('st') < 0.3) add(one(starters, 'st'));
      if (r('dr') < 0.6) add(drinkFor('dr', evening));
      if (desserts.length && r('ds') < 0.22) add(one(desserts, 'ds'));
    }
  }
  if (!out.length) add(one(items, 'any'));
  return out;
}

/**
 * How a visit's order is served, as courses over the time at the table: [{ f: share of the time, item, sip }] — the
 * drink alone first (sipped), then the starter, the main, the dessert (each on the table, the drink beside it); a lone
 * drink is sipped throughout; two drinks one after the other. sip: the drink is in the hand.
 */
export function courses(lines) {
  const its = lines.map(foodItem).filter(Boolean);
  const drinks = its.filter(isDrink), foods = its.filter(i => !isDrink(i));
  const rank = { starter: 0, snack: 1, main: 1, dessert: 2 };
  foods.sort((a, b) => rank[a.course] - rank[b.course]);
  const out = [];
  if (!foods.length) {
    drinks.forEach(d => out.push({ f: 1 / drinks.length, item: d.n, sip: true }));
    return out;
  }
  const lead = drinks.length ? 0.14 : 0, rest = 1 - lead - (drinks.length > 1 ? 0.18 : 0);
  if (lead) out.push({ f: lead, item: drinks[0].n, sip: true });
  const wt = foods.map(i => (i.course === 'main' ? 3 : i.course === 'dessert' ? 1.3 : 1.2)), W = wt.reduce((s, x) => s + x, 0);
  foods.forEach((it, k) => out.push({ f: rest * wt[k] / W, item: it.n, sip: false }));
  if (drinks.length > 1) out.push({ f: 0.18, item: drinks[1].n, sip: true });
  return out;
}

// ---------------------------------------------------------------------------------------------------------- at home
/** What people cook at home, by the time of day (a home's kitchen: no menu, groceries). */
const HOME = {
  breakfast: ['cereal', 'toast_jam', 'scrambled_eggs', 'oatmeal', 'pancakes', 'yogurt_parfait', 'eggs_bacon', 'avocado_toast', 'omelette', 'french_toast'],
  lunch: ['pbj', 'grilled_cheese', 'home_pasta', 'instant_noodles', 'leftovers', 'tomato_soup', 'garden_salad', 'tuna_melt', 'wrap', 'quesadilla'],
  dinner: ['home_pasta', 'stir_fry', 'chicken_veg', 'rice_beans', 'veg_soup', 'salmon_rice', 'tacos_home', 'spaghetti', 'fried_rice', 'leftovers', 'mac_cheese', 'roast_chicken', 'dal', 'green_curry', 'omelette'],
  drink: ['glass_water', 'glass_water', 'orange_juice', 'glass_milk', 'tea', 'coffee', 'cola', 'red_wine', 'lemonade'],
};
/**
 * What a home's kitchen and seats allow (2026-10-08: "food type and seating type need to go hand in hand"): a dish
 * cooked on a stove only with a stove (ON_STOVE — a home without one makes something cold at the counter); without a
 * table only a dish eaten in the hands (shared/food.js eat 'hands' | 'hand', on the sofa or standing). The meal's own
 * list first, then the cold and the hand-held ones.
 */
const ON_STOVE = new Set(['scrambled_eggs', 'oatmeal', 'pancakes', 'eggs_bacon', 'omelette', 'french_toast', 'grilled_cheese', 'home_pasta',
  'tomato_soup', 'tuna_melt', 'quesadilla', 'stir_fry', 'chicken_veg', 'rice_beans', 'veg_soup', 'salmon_rice', 'tacos_home', 'spaghetti',
  'fried_rice', 'mac_cheese', 'roast_chicken', 'dal', 'green_curry']);
const COLD = { breakfast: ['cereal', 'toast_jam', 'yogurt_parfait', 'avocado_toast'], lunch: ['pbj', 'leftovers', 'garden_salad', 'wrap', 'instant_noodles'],
  dinner: ['leftovers', 'instant_noodles', 'wrap', 'garden_salad', 'pbj'] };
const IN_HAND = { breakfast: ['toast_jam', 'avocado_toast'], lunch: ['pbj', 'wrap', 'grilled_cheese', 'tuna_melt', 'quesadilla'], dinner: ['tacos_home', 'pbj', 'wrap'] };
for (const L of [...Object.values(HOME), ...Object.values(COLD), ...Object.values(IN_HAND), [...ON_STOVE]]) for (const id of L) if (!FOOD_BY_ID[id]) throw new Error(`food: home dish ${id}?`);
/** Is home dish id cooked on a stove? */
export const onStove = id => ON_STOVE.has(id);
/** Is dish id eaten in the hands (no table needed)? */
export const byHand = id => { const it = FOOD_BY_ID[id]; return !!it && (it.eat === 'hands' || it.eat === 'hand'); };
/**
 * A home meal: [dish, drink?] ids. hour 0..24; r(tag) as in pickOrder; home: { stove, table } (false: the home has none —
 * by default it has both).
 */
export function homeMeal(hour, r, home = {}) {
  const slot = hour >= 4 && hour < 11 ? 'breakfast' : hour < 16 ? 'lunch' : 'dinner';
  const stove = home.stove !== false, table = home.table !== false;
  let L = HOME[slot];
  if (!stove || !table) {
    L = [...new Set([...L, ...COLD[slot], ...IN_HAND[slot]])].filter(id => (stove || !ON_STOVE.has(id)) && (table || byHand(id)));
    if (!L.length) L = ['pbj'];   // (cold, and in the hand)
  }
  const dish = L[Math.floor(r('dish') * L.length) % L.length];
  if (r('drink') >= 0.75) return [dish];
  const D2 = slot === 'breakfast' ? ['coffee', 'tea', 'orange_juice', 'glass_milk'] : slot === 'lunch' ? HOME.drink.slice(0, 7) : HOME.drink;
  return [dish, D2[Math.floor(r('dk') * D2.length) % D2.length]];
}
/** Lunch at work (brought from home or picked up): a packed lunch, a sandwich, leftovers. */
const DESK_LUNCH = ['lunchbox', 'club_sandwich', 'wrap', 'leftovers', 'caesar', 'poke', 'burrito_bowl', 'sub', 'pbj', 'instant_noodles'];
export function deskLunch(r) { return [DESK_LUNCH[Math.floor(r('lunch') * DESK_LUNCH.length) % DESK_LUNCH.length], ...(r('dr') < 0.5 ? [r('dk') < 0.5 ? 'soda_can' : 'water'] : [])]; }
/** A picnic in the park. */
const PICNIC = ['club_sandwich', 'pbj', 'wrap', 'garden_salad', 'fruit_tart', 'cookie', 'lunchbox', 'pizza_slice'];
export function picnic(r) { return [PICNIC[Math.floor(r('p') * PICNIC.length) % PICNIC.length], r('d') < 0.5 ? 'lemonade' : 'water']; }

/** The old menus' items (before 2026-10-07): their names, for books and receipts written then; and the course a visit
 *  price stood for (server/free-will/options.js and the Mind asked for 'coffee', 'drink', 'meal' …). */
export const LEGACY_ITEMS = Object.freeze({
  pastry: { name: 'Pastry', course: 'snack' }, cafe_lunch: { name: 'Sandwich and coffee', course: 'main' },
  meal: { name: 'Main course', course: 'main' }, drink: { name: 'Drink', course: 'drink' }, dessert: { name: 'Dessert', course: 'dessert' },
});
/** A display name for an item id, old ones included. */
export const foodName = id => FOOD_BY_ID[id]?.name || LEGACY_ITEMS[id]?.name || String(id);
