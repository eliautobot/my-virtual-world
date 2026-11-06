#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The goods: the small things that go on tables, counters and shelves (PLAN-SURFACES.md sections 2-4), made ready for the
// game from two CC BY 4.0 packs as CodePawl converted them:
//   - Google Scanned Objects (https://huggingface.co/datasets/codepawl/scanned-objects-glb, rev fdb214f; scans by Google
//     LLC): all 1,033 scans, as client/assets/gso/{m,d,t}/<short id>.*
//   - the Amazon Berkeley Objects' small things that tools/abo-build.mjs leaves out (cables, hubs, stands, notebooks,
//     pans, bowls, canisters, frames ...): client/assets/abo/{m,t}/<ASIN>.*
// For each model:
//   m/<id>.glb   "lean": the pack's level 2 shape (level 3's when level 2 is over 6k triangles) with level 3's 256 px KTX2
//                maps, no normal map, turned so its front faces +z, standing on y = 0 and centred, positions and normals
//                quantized, meshopt-compressed
//   d/<id>.glb   the dressing copy: level 3's shape simplified to <= 400 triangles, same maps (also made for the Amazon
//                library's small decor that may stand on a surface: client/assets/abo/d/<ASIN>.glb)
//   t/<id>.webp  its picture (160 px, from the pack's thumbs)
// and the list, shared/goods-catalog.js (generated, committed): neutral short ids (tools/goods-ids.json, pinned and
// appended only: a Google source id names brands, so it never leaves this folder), goods tags, sub-group, a neutral name
// (colour + what it is), size from the converted model, flags; and the fixes to the Amazon library's misfiled pieces.
// Sorting: the pack's category, then words of the name (rules below), then size; tools/goods-overrides.json corrects single
// items (never edit the generated list). Resumable: a model already made with the same settings is not made again.
//
//   node tools/goods-build.mjs [--gpack DIR] [--apack DIR] [--jobs N] [--catalog-only] [--report FILE]
// DIR: the packs (default ../../mvw-assets-hf/{scanned-objects-glb,abo-glb} beside this repository's folder).
// Needs @gltf-transform/core, /extensions, /functions, meshoptimizer and sharp: `npm i --no-save` them here, or point
// ABO_TOOLS at a folder whose node_modules has them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { GOODS_TAGS, GOODS_SUBS, SUB_OF_TAG, ABO_ON_OK, smallEnough } from '../shared/goods-tags.js';
import { ABO_KINDS, ABO_KIND_IDS } from '../shared/abo-kinds.js';
import { ABO_ROWS } from '../shared/abo-catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_G = path.join(ROOT, 'client/assets/gso'), OUT_A = path.join(ROOT, 'client/assets/abo');
const IDS_FILE = path.join(ROOT, 'tools/goods-ids.json'), OVR_FILE = path.join(ROOT, 'tools/goods-overrides.json');
const LEAN_CAP = 6000, DRESS_TRIS = 400, RECIPE = 9;   // (RECIPE: bump to remake every model)
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const GPACK = path.resolve(arg('--gpack', path.join(ROOT, '../../mvw-assets-hf/scanned-objects-glb')));
const APACK = path.resolve(arg('--apack', path.join(ROOT, '../../mvw-assets-hf/abo-glb')));
export const GSO_REV = 'fdb214f';

function deps() {
  const req = createRequire(path.join(process.env.ABO_TOOLS ? path.resolve(process.env.ABO_TOOLS) : ROOT, 'noop.js'));
  return { core: req('@gltf-transform/core'), ext: req('@gltf-transform/extensions'), fn: req('@gltf-transform/functions'), mo: req('meshoptimizer'), sharp: req('sharp') };
}

// ------------------------------------------------------------------ sorting: the scans (pack category + words of the name)
// [regex, tags, label, flags]: first match wins. Flags: f also on the floor, y has a front, r round (any turn), x franchise.
const R = (re, tags, label, flags = '') => [re, tags.split(' '), label, flags];
// checked first, in every pack category (the pack files some things oddly: drinks among toys, supplements among cups ...)
const ANY = [
  R(/labelworks|label tape/, 'office-supply', 'Label Tape', 'y'),
  R(/ink cartridge|ink cartrid|remanufactured i|toner cartridge|printing cartridge|pixma|chromalife|ink car\b|\bink\b/, 'office-supply', 'Ink Cartridge', 'y'),
  R(/sparkling water|pepsi|\bcola\b|soda\b|fresca|iced tea|brisk/, 'drink food-pack', 'Drink Pack', 'y'),
  R(/cutlery block/, 'kitchen cookware', 'Knife Block', 'y'),
  R(/kotobuki saucer/, 'tableware', 'Saucer', 'r'),
  R(/poise|kotex|tena pads|\bliners\b|tampons|\bpads\b/, 'pharmacy', 'Hygiene Pack', 'y'),
  R(/file sorter/, 'desk-item office-supply', 'File Sorter', 'y'),
  R(/treat dispenser|pet dophilus|scooper hooper/, 'pet', 'Pet Supply', ''),
  R(/teething|kong\b/, 'pet toy', 'Dog Toy', ''),
  R(/jerky tonic|sausage tonic/, 'food-pack', 'Sauce Bottle', 'y'),
  R(/thinsulate/, 'clothing', 'Gloves', ''),
  R(/card & invitation/, 'office-supply', 'Card Kit', 'y'),
  R(/nintendo 2ds|3ds.?xl/, 'electronics game', 'Handheld Console', 'y'),
  R(/sapphire r7|graphics card/, 'electronics', 'Graphics Card Box', 'y'),
  R(/1800 tablet/, 'electronics', 'Tablet', 'y'),
  R(/eat to live/, 'media', 'Book', 'y'),
  R(/sidewalk chalk/, 'office-supply toy', 'Chalk Pack', 'y'),
  R(/crayons?\b/, 'office-supply toy', 'Crayon Box', 'y'),
  R(/model magic/, 'office-supply toy', 'Modelling Clay', 'y'),
  R(/fingerpaint|paint dabber/, 'office-supply toy', 'Paint Set', 'y'),
  R(/whey protein|protein fuel|creatine|iso-rich soy|organic whey/, 'food-pack pharmacy', 'Protein Tub', 'y'),
  R(/oil of morocco|curl envy|strictly curls/, 'beauty', 'Hair Care Bottle', 'y'),
  R(/perricone.*(supplement|formula|powder)|super berry/, 'pharmacy', 'Supplement Pack', 'y'),
  R(/mascara/, 'beauty', 'Mascara', 'y'),
  R(/lipstick/, 'beauty', 'Lipstick', 'y'),
  R(/bronzer|foundation|concealer/, 'beauty', 'Makeup', 'y'),
  R(/perricone.*(collection|duo|treatments)/, 'beauty', 'Skincare Set', 'y'),
  R(/perricone|chia serum|photo plasma|gentle cleanser/, 'beauty', 'Skincare', 'y'),
  R(/(fem|pet|ultra|allergen-free )?.?dophilus|bifidus|boulardii|probiotic/, 'pharmacy', 'Probiotic Bottle', 'y'),
  R(/laxative|stool softener|caplets|elderberry|milk of magnesia/, 'pharmacy', 'Medicine Bottle', 'y'),
  R(/krill oil|mastic gum|jarrosil|activated silicon|sam-e|sleep optimizer|d3 liquid|xylitol|glucosamine|5 htp|beta glucan|lutein|tocopherol|co-q10|q-absorb|\bdim\b|folic acid|germanium|hyaluronic|inositol|tyrosine|lactoferrin|mk-7|nattomax|phosphomega|prostate|pomegranate|quercetin|theanine|nitric fuel|women's multi/, 'pharmacy', 'Supplement Bottle', 'y'),
];
const BY_CAT = {
  shoe: [
    R(/boat shoe|1-?eye|2-eye|3-eye|canoe moc|deckhand|angelfish|bluefish|billfish|striper|authentic original|boat breeze/, 'shoe', 'Boat Shoe', 'fy'),
    R(/loafer|penny|venetian|kiltie|\bmoc\b|wave driver|r&r moc/, 'shoe', 'Loafer', 'fy'),
    R(/tieks|ballet|kaitlin|reva\b/, 'shoe', 'Ballet Flat', 'fy'),
    R(/thong|flip ?flops?|reefresh flip|sandal|slide\b|zenfun|braided cushion|star cushion/, 'shoe', 'Sandal', 'fy'),
    R(/clog/, 'shoe', 'Clog', 'fy'),
    R(/heel|pmp|65mm/, 'shoe', 'Heeled Shoe', 'fy'),
    R(/terrex|cascadia/, 'shoe sport', 'Hiking Shoe', 'fy'),
    R(/wingtip|oxford|great jones|dress casual|plain toe/, 'shoe', 'Dress Shoe', 'fy'),
    R(/slip ?on|bungee|bahama|largo|slack cruiser|santa cruz mens/, 'shoe', 'Slip-On Shoe', 'fy'),
    R(/boot|chukka|stormbuck|wntr|ugg|nellie|hikerfish|earthkeepers|cambridge|jena\b/, 'shoe', 'Boot', 'fy'),
    R(/trx|predator|predito|f50|\bf10\b|\bf5\b|11pro|leucippus|5-tool/, 'shoe sport', 'Football Boot', 'fy'),
    R(/linksmaster|tour lyte/, 'shoe sport', 'Golf Shoe', 'fy'),
    R(/run|jogger|ghost|glycerin|adrenaline|purecadence|pureconnect|pureflow|ravenna|gel-|boost|\bzx|train|crossfit|dmx|zig|realflex|smoothflex|cushrun|rush|turbo|ultimatic|easytone|dance|studio beat|climacool|aerate|amberlight|dragon|trochilus|samba|pheehan|rocketgirl|alternation|division|allylynn/, 'shoe', 'Running Shoe', 'fy'),
    R(/./, 'shoe', 'Sneaker', 'fy'),
  ],
  'board game': [
    R(/jenga/, 'game', 'Block Tower Game', 'y'),
    R(/card game|skip bo|mad gab|card & invitation/, 'game', 'Card Game', 'y'),
    R(/lego fusion/, 'toy', 'Building Set', 'y'),
    R(/super mario 3d world deluxe/, 'game media', 'Game Bundle', 'y'),
    R(/./, 'game', 'Board Game', 'y'),
  ],
  media: [
    R(/rocksmith|real tone cable/, 'cable game', 'Guitar Cable', 'y'),
    R(/simon swipe/, 'game toy', 'Electronic Game', 'y'),
    R(/acid music|downloadable loops|subscription/, 'media', 'Software Box', 'y'),
    R(/\bdvd\b|discs|season/, 'media', 'DVD Case', 'y'),
    R(/nintendo 64|super nintendo|game boy/, 'media game', 'Game Cartridge', 'y'),
    R(/./, 'media game', 'Video Game', 'y'),
  ],
  'food and drink': [
    R(/cereal/, 'food-pack', 'Cereal Box', 'y'),
    R(/cracker/, 'food-pack', 'Cracker Box', 'y'),
    R(/fruit snack/, 'food-pack', 'Fruit Snacks', 'y'),
    R(/cupcake|cloud cakes|donut|coffeecake/, 'food-pack', 'Snack Cakes', 'y'),
    R(/candy|chocolate|nips|raisinets|butterfinger|clusters|crunch|neuhaus|candy bar/, 'food-pack', 'Candy Box', 'y'),
    R(/k-cup|capsul|nescafe|coffee|latte|mocha|cocoa/, 'food-pack drink', 'Coffee Pack', 'y'),
    R(/orbit|\bgum\b|bubblemint/, 'food-pack', 'Gum Pack', 'y'),
    R(/herring/, 'food-pack', 'Tinned Fish', 'y'),
    R(/fondant|sprinkle|sugar/, 'food-pack kitchen', 'Baking Supplies', 'y'),
    R(/tonic/, 'food-pack', 'Sauce Bottle', 'y'),
    R(/honey dipper/, 'kitchen', 'Honey Dipper', 'r'),
    R(/snack bags/, 'kitchen', 'Snack Bags', 'y'),
    R(/snack catcher/, 'baby', 'Snack Cup', 'r'),
    R(/./, 'food-pack', 'Snack Pack', 'y'),
  ],
  'bottles and cups': [
    R(/spoon rest/, 'kitchen', 'Spoon Rest', ''),
    R(/boat shoe/, 'shoe', 'Boat Shoe', 'fy'),
    R(/./, 'pharmacy', 'Supplement Bottle', 'y'),
  ],
  'health and beauty': [
    R(/toothbrush holder/, 'bath', 'Toothbrush Holder', ''),
    R(/sonicare|tooth ?brush/, 'beauty bath', 'Electric Toothbrush', 'y'),
    R(/hair dryer/, 'beauty', 'Hair Dryer', ''),
    R(/straighten/, 'beauty', 'Hair Straightener', ''),
    R(/towel|bath sheet/, 'bath household', 'Bath Towel', 'y'),
    R(/haircolor|hair co\b|brush-in/, 'beauty', 'Hair Colour Box', 'y'),
    R(/./, 'beauty', 'Beauty Product', 'y'),
  ],
  electronics: [
    R(/motherboard/, 'electronics', 'Motherboard Box', 'y'),
    R(/router/, 'electronics', 'Wi-Fi Router', 'y'),
    R(/hard drive|hdd|backup plus|shared storage|deskstar|archive/, 'electronics', 'Hard Drive', 'y'),
    R(/headset/, 'electronics desk-item', 'Headset', 'y'),
    R(/keyboard/, 'electronics desk-item', 'Keyboard', 'y'),
    R(/goliathus/, 'desk-item', 'Mouse Pad', ''),
    R(/mouse/, 'electronics desk-item', 'Computer Mouse', 'y'),
    R(/speaker|boom/, 'electronics', 'Wireless Speaker', 'y'),
    R(/nikon|camera/, 'electronics', 'Camera', 'y'),
    R(/instax|share sp/, 'electronics', 'Photo Printer', 'y'),
    R(/cable|category 6|rj45/, 'cable', 'Cable', ''),
    R(/cardboard/, 'electronics', 'VR Viewer Box', 'y'),
    R(/tracker|jawbone/, 'electronics', 'Fitness Tracker', 'y'),
    R(/usb|dt4000/, 'electronics desk-item', 'USB Drive', 'y'),
    R(/yoga 2|laptop/, 'electronics', 'Laptop', 'y'),
    R(/wall mount/, 'electronics', 'Wall Mount Box', 'y'),
    R(/armband/, 'sport electronics', 'Phone Armband', 'y'),
    R(/./, 'electronics', 'Gadget', 'y'),
  ],
  household: [
    R(/antislip|surfacing|vinyl tape|\btape\b|shurtape|gaffer/, 'household tool', 'Tape Roll', 'r'),
    R(/diaper pail|wipe warmer/, 'baby', 'Baby Supply', 'y'),
    R(/sponge/, 'household', 'Sponge Pack', 'y'),
    R(/gloves|glove\b/, 'household', 'Work Gloves', ''),
    R(/fabric cube|storage bin|drawer store|caddy, blue|sterilite|organizer/, 'storage-box', 'Storage Box', 'f'),
    R(/waste basket/, 'household', 'Waste Bin', 'rf'),
    R(/dishtowel|kitchen towels|dish towel/, 'household kitchen', 'Dish Towel', 'y'),
    R(/basket/, 'storage-box decor', 'Basket', 'f'),
    R(/washcloth|hand towel/, 'bath household', 'Washcloth', 'y'),
    R(/hammer/, 'tool', 'Hammer', ''),
    R(/screwdriver/, 'tool', 'Screwdriver', ''),
    R(/c clamp/, 'tool', 'Clamp', ''),
    R(/magnifying/, 'tool office-supply', 'Magnifying Glass', ''),
    R(/flashlight/, 'tool', 'Flashlight', ''),
    R(/saucer|surface saver/, 'plant', 'Pot Saucer', 'r'),
    R(/plant container|planter|urn\b|\burn /, 'plant', 'Plant Pot', 'rf'),
    R(/scissors/, 'office-supply', 'Scissors', ''),
    R(/alarm clock/, 'decor desk-item', 'Alarm Clock', 'y'),
    R(/desk caddy|letter holder/, 'desk-item office-supply', 'Desk Organizer', 'y'),
    R(/bookend/, 'decor desk-item', 'Bookend', 'y'),
    R(/string l/, 'household decor', 'String Lights', 'y'),
    R(/light bulbs/, 'household', 'Light Bulb Box', 'y'),
    R(/school bell/, 'decor', 'Hand Bell', 'r'),
    R(/over door/, 'household', 'Door Hook', ''),
    R(/neck rest/, 'bag', 'Travel Pillow', ''),
    R(/notebook|travel mate/, 'electronics', 'Laptop', 'y'),
    R(/seagate|storage$/, 'electronics', 'Hard Drive', 'y'),
    R(/./, 'household', 'Household Item', ''),
  ],
  kitchen: [
    R(/ramekin/, 'tableware cookware', 'Ramekin', 'r'),
    R(/\bmug\b|coffee mug/, 'mug tableware', 'Mug', ''),
    R(/frother/, 'cookware kitchen', 'Milk Frother', ''),
    R(/utensil holder/, 'kitchen', 'Utensil Holder', 'r'),
    R(/coffeemake/, 'cookware kitchen', 'Coffee Maker', 'y'),
    R(/toaster/, 'cookware kitchen', 'Toaster', 'y'),
    R(/blender/, 'cookware kitchen', 'Blender Jar', ''),
    R(/pressure cooker/, 'cookware kitchen', 'Pressure Cooker', 'y'),
    R(/fry ?pan|frypan|skillet/, 'cookware', 'Frying Pan', ''),
    R(/cake pan|bundt/, 'cookware', 'Baking Pan', 'r'),
    R(/casserole/, 'cookware tableware', 'Casserole Dish', ''),
    R(/dixie/, 'tableware', 'Paper Bowls', 'y'),
    R(/dog/, 'pet', 'Pet Bowl', 'rf'),
    R(/orchid pot|flower pot|electric pot|garden pot|plant (bowl|pot|plate|container)|planter|ecoforms (cup|pot|plate)|pot, nova|cabana/, 'plant', 'Plant Pot', 'rf'),
    R(/drying mat/, 'household kitchen', 'Drying Mat', ''),
    R(/squeezer/, 'kitchen', 'Citrus Squeezer', ''),
    R(/dish towel/, 'household kitchen', 'Dish Towel', 'y'),
    R(/dust ?pan/, 'household', 'Dustpan Set', ''),
    R(/spatula/, 'kitchen', 'Spatula', ''),
    R(/can opener/, 'kitchen', 'Can Opener', ''),
    R(/paint maker/, 'toy', 'Toy Paint Maker', 'y'),
    R(/plate/, 'tableware', 'Plate', 'r'),
    R(/drainer/, 'kitchen household', 'Dish Drainer', ''),
    R(/woven basket/, 'storage-box kitchen', 'Basket Tray', ''),
    R(/sushi mat/, 'kitchen', 'Sushi Mat', ''),
    R(/k-cup/, 'food-pack drink', 'Coffee Pack', 'y'),
    R(/soap dish/, 'bath', 'Soap Dish', ''),
    R(/pitcher/, 'tableware', 'Pitcher', ''),
    R(/teapot/, 'tableware', 'Teapot', ''),
    R(/tray/, 'tableware', 'Serving Tray', ''),
    R(/butter dish/, 'tableware', 'Butter Dish', ''),
    R(/parchment/, 'kitchen', 'Parchment Pack', 'y'),
    R(/bowl/, 'tableware', 'Bowl', 'r'),
    R(/./, 'kitchen', 'Kitchen Item', ''),
  ],
  bag: [
    R(/pencil case/, 'bag office-supply', 'Pencil Case', 'y'),
    R(/lunch box/, 'bag kitchen', 'Lunch Box', 'fy'),
    R(/lunch|cooler|munch/, 'bag', 'Lunch Bag', 'fy'),
    R(/brown bag/, 'household', 'Paper Bags', 'y'),
    R(/./, 'bag', 'Backpack', 'fy'),
  ],
  clothing: [R(/hat/, 'clothing', 'Hat', 'r')],
  'baby gear': [R(/bib/, 'baby clothing', 'Bib Pack', 'y'), R(/./, 'baby', 'Booster Seat', 'fy')],
  other: [
    R(/dog bow/, 'pet', 'Pet Bowl', 'rf'),
    R(/scraps|collector/, 'kitchen household', 'Compost Bin', 'y'),
    R(/^dog\b|racoon|squirrel|fruity friends/, 'toy decor', 'Toy Animal', 'y'),
    R(/retail leadership/, 'bag', 'Tote Bag', 'y'),
    R(/./, 'decor', 'Ornament', ''),
  ],
  toy: [
    R(/nestle pure life|nesquik/, 'drink food-pack', 'Drink Pack', 'y'),
    R(/advent calendar/, 'toy', 'Advent Calendar', 'y'),
    R(/creationary|apples to apples|make a match|fishing game|monkey bowling|game\b/, 'game toy', 'Kids Game', 'y'),
    R(/happy brother|grandfather|grandmother|doll family/, 'toy', 'Doll', 'y'),
    R(/dollhouse|furniture set|bedroom|bathroom|dining room|kitchen set|room - |room \(|kid room|parent room|pets & accessories|garden swing/, 'toy', 'Dollhouse Furniture', 'y'),
    R(/lego|blocks|construction|build|nuts & bolts|mosaic/, 'toy', 'Building Set', 'y'),
    R(/\bdoll\b/, 'toy', 'Doll', 'y'),
    R(/plush|teddy|sootheze|cuddly/, 'toy', 'Plush Toy', 'y'),
    R(/schleich/, 'toy', 'Toy Animal', 'y'),
    R(/figure|thor\b|spider-man|superman|turtles|transformers|yoshi|mario|android|celestia|avengers|smash fists|ogre|spongebob|lalaloopsy|rocket raccoon/, 'toy', 'Action Figure', 'y'),
    R(/food|meal|bagel|sandwich|steak|meat|vegetable|juicer|tea set|tableware set|breakfast|baking utensils|pizza|veggie/, 'toy', 'Play Food Set', 'y'),
    R(/xylophone|maraca|whistle|rattle/, 'toy baby', 'Musical Toy', 'y'),
    R(/puzzle|sort|shape|peg|match|memo|domino|alphabet|fraction|twist|gears|clock|see & spell|traffic signs|tower|height|stack|mood|knob|pattern/, 'toy', 'Learning Toy', 'y'),
    R(/car\b|cars|truck|bus|engine|train|boat|helicopter|airplane|excavator|roller|racer|carrier|vehicle|railway|henry|porter|thomas|cart|tricycle|taxi|flyers|wagon/, 'toy', 'Toy Vehicle', 'y'),
    R(/schleich|rhino|eagle|bull|lion|unicorn|dino|allosaurus|spinosaurus|therizinosaurus|triceratops|shark|whale|elephant|bear|crocodile|alligator|puppy|bunny|chicken|owl|sheep|ladybug|animal|orca|weisshai|dragon|barnyard|bee\b|horse|mouse|turtle/, 'toy', 'Toy Animal', 'y'),
    R(/./, 'toy', 'Wooden Toy', 'y'),
  ],
};
// franchise or branded-character art (characters, film/TV/game titles): flagged x, kept out of automatic dressing
const FRANCHISE = /frozen|olaf|mario|luigi|yoshi|pok.?mon|pikachu|star wars|rogue squadron|avengers|marvel|\bthor\b|spider-man|superman|guardians of the galaxy|rocket raccoon|doctor doom|ninja turtles|splinter|shredd|rahzar|spongebob|transformers|bumblebee|grimlock|my little pony|lalaloopsy|thomas & friends|imaginext|nightmare before christmas|firefly|supernatural|animal crossing|kid icarus|persona q|final fantasy|little big planet|beyonc|house of cards|justified|blue jasmine|little house on the prairie|beetle adventure|wii party|android (figure|lego)|nickelodeon|paul frank|lego (star wars|friends|city)|game boy|nintendo 64|\[wii|super nintendo|lego fusion/;
const MEDIA_TITLE = /\[(dvd|nintendo|wii)|\bdvd\b|nintendo 64|super nintendo|game boy/;

/** A scan's tags, label and flags (before overrides). */
export function classifyGoogle(m) {   // (the name, then the source id's words: the pack cuts names short)
  const s = (String(m.name || '') + ' | ' + String(m.id || '').replace(/_/g, ' ')).toLowerCase().replace(/\s+/g, ' ');
  for (const list of [ANY, BY_CAT[m.category] || []]) for (const [re, tags, label, flags] of list) {
    if (!re.test(s)) continue;
    const x = FRANCHISE.test(s) || (tags.includes('media') && MEDIA_TITLE.test(s));
    return { tags: [...tags], label, flags: flags + (x ? 'x' : ''), rule: String(re).slice(1, 30) };
  }
  return { tags: ['decor'], label: 'Ornament', flags: '', rule: 'none' };
}

// ------------------------------------------------------------------ the Amazon small things tools/abo-build.mjs leaves out
const A_TYPES = {
  'multiport hub': ['electronics desk-item', 'USB Hub', 'y'], 'electronic cable': ['cable', 'Cable', ''],
  'electronic adapter': ['cable', 'Adapter Cable', ''], 'wireless accessory': ['cable', 'Charging Cable', ''],
  'accessory or part or supply': ['cable', 'Audio Cable', ''], 'portable electronic device stand': ['desk-item', 'Laptop Stand', 'y'],
  'computer add on': ['desk-item', 'Monitor Stand', 'y'], 'mouse pad': ['desk-item', 'Mouse Pad', ''], 'paper product': ['office-supply', 'Notebook', 'y'],
  'file folder': ['office-supply', 'File Folder', 'y'], battery: ['electronics', 'Battery Charger', 'y'], 'saute fry pan': ['cookware', 'Frying Pan', ''],
  'portable electronic device cover': ['bag electronics', 'Laptop Sleeve', 'y'], handbag: ['bag', 'Laptop Bag', 'fy'], 'carrying case or bag': ['bag electronics', 'Drive Case', 'y'],
  'dishware bowl': ['tableware', 'Bowl', 'r'], 'drink coaster': ['tableware', 'Coaster', ''], vase: ['decor', 'Vase', 'r'], 'pump dispenser': ['bath', 'Soap Pump', ''],
  jar: ['kitchen', 'Canister', 'r'], 'drinking cup': ['tableware drink', 'Wine Glasses', ''], 'cellular phone case': ['decor', 'Photo Frame', 'y'],
};
const A_NAME = [   // (product types that mix things: by words of the name)
  [/laminator/, ['office-supply', 'Laminator', 'y']], [/arm mount|dual monitor/, ['desk-item', 'Monitor Arm', 'y']], [/monitor stand|monitor sta/, ['desk-item', 'Monitor Stand', 'y']],
  [/dvi display cable/, ['cable', 'Display Cable', '']], [/tablet holder/, ['desk-item', 'Tablet Stand', 'y']], [/hard shell carrying case/, ['bag electronics', 'Carrying Case', 'y']],
  [/neoprene dumbbell|barbell/, ['sport', 'Dumbbells', 'f']], [/serving tray|decor tray/, ['tableware decor', 'Serving Tray', '']],
  [/canister/, ['kitchen', 'Canister Set', 'r']], [/marco de fotos|cadre en bois|cadre photo/, ['decor', 'Photo Frame', 'y']],
];
const A_NOT = /shredder|foot rest|dj laptop|projector stand|wall mount|heater|flag display|propeller|throw pillow|decorative pillow|storage organizer tote|over door organizer|batting tee/;
/** An Amazon model's tags, label and flags, or null when it is not a surface item. */
export function classifyAmazon(m) {
  const s = String(m.name || '').toLowerCase();
  if (A_NOT.test(s)) return null;
  for (const [re, v] of A_NAME) if (re.test(s)) return { tags: v[0].split(' '), label: v[1], flags: v[2], rule: 'name' };
  const v = A_TYPES[m.product_type];
  return v ? { tags: v[0].split(' '), label: v[1], flags: v[2], rule: 'type' } : null;
}

// ------------------------------------------------------------------ neutral names: colour + what it is
const COLOURS = [['Black', /black|ebony|onyx|jet|nero|negro|schwarz|espresso/], ['White', /white|ivory|snow|bianco|blanco|alabaster/],
  ['Grey', /gr[ae]y|slate|graphite|pewter|grigio|gris|smoke|charcoal|cement|silver/], ['Cream', /cream|beige|oatmeal|sand|taupe|khaki|ecru|linen|bone/],
  ['Navy', /navy|indigo|midnight/], ['Blue', /blue|azure|denim|teal|aqua|turquoise|cobalt/], ['Green', /green|olive|sage|emerald|moss|mint|jade/],
  ['Red', /red|burgundy|wine|ruby|crimson|brick/], ['Pink', /pink|blush|rose|coral|fuchsia/], ['Yellow', /yellow|mustard|ochre|lemon/],
  ['Orange', /orange|rust|copper|terracotta|amber|tangerine|caramel/], ['Purple', /purple|lavender|plum|violet|lilac/], ['Gold', /gold|brass|bronze/],
  ['Brown', /brown|chocolate|walnut|chestnut|mahogany|tan\b|oak|wood|natural/]];
const pickColour = s => { for (const [w, re] of COLOURS) if (re.test(s)) return w; return ''; };
/** The colour word of a picture's thing (its background and shadow left out): the hue most of it has, or '' when mixed. */
export function colourOf(px, ch) {
  const n = px.length / ch, bg = [0, 0, 0];
  const corner = [];
  const W = Math.round(Math.sqrt(n));
  for (const [cx, cy] of [[0, 0], [W - 6, 0], [0, W - 6], [W - 6, W - 6]]) for (let y = cy; y < cy + 6; y++) for (let x = cx; x < cx + 6; x++) corner.push((y * W + x) * ch);
  for (const i of corner) for (let k = 0; k < 3; k++) bg[k] += px[i + k] / corner.length;
  const votes = {};
  let total = 0;
  for (let i = 0; i < n; i++) {
    const r = px[i * ch], g = px[i * ch + 1], b = px[i * ch + 2];
    const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
    if (d < 34) continue;   // (the background and its soft shadow)
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, v = mx, s = mx ? (mx - mn) / mx : 0;
    let h = 0;
    if (mx > mn) { const R = r / 255, G = g / 255, B = b / 255, c = mx - mn; h = mx === R ? ((G - B) / c) % 6 : mx === G ? (B - R) / c + 2 : (R - G) / c + 4; h = (h * 60 + 360) % 360; }
    let w;
    if (v < 0.2) w = 'Black';
    else if (s < 0.16) w = v > 0.7 ? 'White' : v < 0.33 ? 'Black' : 'Grey';
    else if (s < 0.36 && h >= 18 && h < 60 && v > 0.68) w = 'Cream';
    else if (h < 12 || h >= 345) w = s < 0.5 && v > 0.72 ? 'Pink' : v < 0.45 ? 'Brown' : 'Red';
    else if (h < 40) w = v < 0.6 ? 'Brown' : 'Orange';
    else if (h < 66) w = v < 0.55 ? 'Brown' : s < 0.55 ? 'Gold' : 'Yellow';
    else if (h < 170) w = 'Green';
    else if (h < 255) w = v < 0.42 ? 'Navy' : 'Blue';
    else if (h < 290) w = 'Purple';
    else w = 'Pink';
    votes[w] = (votes[w] || 0) + 1; total++;
  }
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return top && top[1] / total >= 0.36 ? top[0] : '';
}

// ------------------------------------------------------------------ which way a model faces
const BOXY = new Set(['office-supply', 'food-pack', 'drink', 'pharmacy', 'beauty', 'game', 'media', 'electronics', 'household', 'bath', 'cookware']);
/** How much to turn a model (degrees about +y) so its front faces +z: an override, else a shoe's toe (its heel is the end
 *  that reaches higher) to +z, else a box-like thing's wider face to +z. b: its size [w, h, d] as scanned; heel: +1/-1
 *  (the heel's side along its long horizontal axis), long: 'x' | 'z'. */
export function chooseYaw(tags, flags, b, heel, long, o = {}) {
  if (Number.isFinite(o.yaw)) return o.yaw;
  if (tags[0] === 'shoe') {   // toe to +z
    if (long === 'z') return heel > 0 ? 180 : 0;
    return heel > 0 ? 90 : -90;   // (heel at +x: turned +90 puts +x at -z)
  }
  if (flags.includes('y') && BOXY.has(tags[0]) && b[2] > b[0] * 1.15) return 90;   // (a box scanned side-on; figures, animals,
  return 0;                                                                         //  vehicles and appliances face +z as scanned)
}

// ------------------------------------------------------------------ one model (in a worker)
const QUIET = D => new D.core.Logger(D.core.Logger.Verbosity.ERROR);
function eachVertex(D, doc, fn) {
  const v = [0, 0, 0], m = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const W = node.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const a = p.getAttribute('POSITION');
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, v);
        fn(W[0] * v[0] + W[4] * v[1] + W[8] * v[2] + W[12], W[1] * v[0] + W[5] * v[1] + W[9] * v[2] + W[13], W[2] * v[0] + W[6] * v[1] + W[10] * v[2] + W[14]);
      }
    }
  }
}
function boundsOf(D, doc) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  eachVertex(D, doc, (x, y, z) => { mn[0] = Math.min(mn[0], x); mn[1] = Math.min(mn[1], y); mn[2] = Math.min(mn[2], z); mx[0] = Math.max(mx[0], x); mx[1] = Math.max(mx[1], y); mx[2] = Math.max(mx[2], z); });
  return [mn, mx];
}
/** The heel side of a shoe: along its long horizontal axis, the end quarter that reaches higher. */
function heelOf(D, doc, [mn, mx]) {
  const long = (mx[0] - mn[0]) > (mx[2] - mn[2]) ? 0 : 2, a = mn[long], L = mx[long] - a;
  let lo = 0, hi = 0;
  eachVertex(D, doc, (x, y, z) => { const u = ((long ? z : x) - a) / L; if (u < 0.25) lo = Math.max(lo, y); else if (u > 0.75) hi = Math.max(hi, y); });
  return { long: long ? 'z' : 'x', heel: hi >= lo ? 1 : -1 };
}
const tris = doc => { let t = 0; for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; return t; };
/** Bake every node's transform (parents first, so the vertices end in the scene's frame; a mesh used twice copied first). */
function bakeNodes(D, doc) {
  const seen = new Set();
  for (const node of doc.getRoot().listNodes()) { const m = node.getMesh(); if (!m) continue; if (seen.has(m)) node.setMesh(m.clone()); else seen.add(m); }
  const walk = n => { D.fn.clearNodeTransform(n); for (const c of n.listChildren()) walk(c); };
  for (const sc of doc.getRoot().listScenes()) for (const n of sc.listChildren()) walk(n);
}
/** Bake the nodes' transforms, then the turn/scale M, into the vertices. */
function place(D, doc, M) {
  bakeNodes(D, doc);
  for (const mesh of doc.getRoot().listMeshes()) D.fn.transformMesh(mesh, M);
}
function matrixOf(yaw, scale, pitch) {   // column-major: S, then Rx(pitch), then Ry(yaw)
  const a = yaw * Math.PI / 180, p = pitch * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cp = Math.cos(p), sp = Math.sin(p);
  // Ry * Rx
  const m = [c, 0, -s, 0, s * sp, cp, c * sp, 0, s * cp, -sp, c * cp, 0, 0, 0, 0, 1];
  for (let i = 0; i < 12; i++) m[i] *= scale;
  return m;
}
const shift = (M, t) => { const m = [...M]; m[12] += t[0]; m[13] += t[1]; m[14] += t[2]; return m; };

async function convert(D, io, job) {
  const { lod } = job, { dequantize, prune, dedup, quantize, meshopt } = D.fn;
  const read = async n => { const d = await io.read(lod(n)); d.setLogger(QUIET(D)); return d; };
  if (!fs.existsSync(lod(2)) || !fs.existsSync(lod(3))) return { skip: 'not downloaded' };
  let doc = await read(2), useL3 = tris(doc) > job.cap;
  if (useL3) doc = await read(3);
  else {   // level 3's 256 px maps on level 2's shape, by order (many textures have no names)
    const src = (await read(3)).getRoot().listTextures(), dst = doc.getRoot().listTextures();
    if (src.length !== dst.length) return { skip: 'texture count differs' };
    dst.forEach((t, i) => t.setImage(src[i].getImage()).setMimeType(src[i].getMimeType()));
  }
  await doc.transform(dequantize());
  const b0 = boundsOf(D, doc), size0 = [0, 1, 2].map(k => b0[1][k] - b0[0][k]);
  const hl = job.tags[0] === 'shoe' ? heelOf(D, doc, b0) : { long: 'z', heel: 1 };
  const yaw = chooseYaw(job.tags, job.flags, size0, hl.heel, hl.long, job.o);
  let M = matrixOf(yaw, job.o.scale || 1, job.o.pitch || 0);
  place(D, doc, M);
  const [mn, mx] = boundsOf(D, doc), t = [-(mn[0] + mx[0]) / 2, -mn[1], -(mn[2] + mx[2]) / 2];
  for (const mesh of doc.getRoot().listMeshes()) D.fn.transformMesh(mesh, shift([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], t));
  M = shift(M, t);
  const bounds = boundsOf(D, doc);
  const out = { yaw, heel: hl.heel, long: hl.long, size0, bounds: bounds.map(v => v.map(x => Math.round(x * 10000) / 10000)), lod: useL3 ? 3 : 2 };
  for (const m of doc.getRoot().listMaterials()) m.setNormalTexture(null);
  if (tris(doc) > job.cap) {   // (level 3 itself heavy: a furry plush, a wicker basket) simplified keeping its texture seams
    const t0 = tris(doc);
    await doc.transform(D.fn.weld(), D.fn.simplify({ simplifier: D.mo.MeshoptSimplifier, ratio: job.cap / t0 * 0.97, error: 0.02 }));
    if (tris(doc) > job.cap) await doc.transform(D.fn.simplify({ simplifier: D.mo.MeshoptSimplifier, ratio: job.cap / tris(doc) * 0.97, error: 0.05 }));
    if (tris(doc) > job.cap * 2) seamless(D, doc, job.cap * 2, false);   // (still very heavy: across seams, gently, to twice the cap)
  }
  await doc.transform(prune(), dedup(), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }), meshopt({ encoder: D.mo.MeshoptEncoder, level: 'high' }));
  out.tris = tris(doc);
  if (job.m) { const bin = await io.writeBinary(doc); fs.writeFileSync(job.m + '.tmp', bin); fs.renameSync(job.m + '.tmp', job.m); out.bytes = bin.length; }
  if (job.d) Object.assign(out, await dressCopy(D, io, job, M));
  return out;
}
/** Still over `cap` triangles (a scan's many texture seams stop the simplifier): collapse across them, then sloppily. */
function seamless(D, doc, cap, sloppy = true) {
  const total = tris(doc), S = D.mo.MeshoptSimplifier;
  if (total <= cap) return;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const ia = p.getIndices(), pos = p.getAttribute('POSITION').getArray(), idx = Uint32Array.from(ia.getArray());
    const target = Math.max(3, Math.floor(cap * idx.length / 3 / total) * 3);
    let [out] = S.simplify(idx, pos, 3, target, 1, ['Permissive']);
    if (sloppy && out.length > target * 1.05) [out] = S.simplifySloppy(idx, pos, 3, null, target, 1);
    ia.setArray(new Uint32Array(out));
    D.fn.compactPrimitive(p);
  }
}
/** The dressing copy: level 3, simplified to <= DRESS_TRIS (a looser error each try), placed by matrix M. */
async function dressCopy(D, io, job, M) {
  const { dequantize, prune, dedup, quantize, meshopt, weld, simplify } = D.fn;
  let best = null;
  for (const err of [0.01, 0.02, 0.04, 0.08, 0.16, 0.3]) {
    const d = await io.read(job.lod(3)); d.setLogger(QUIET(D));
    await d.transform(dequantize());
    place(D, d, M);
    for (const m of d.getRoot().listMaterials()) m.setNormalTexture(null);
    const t0 = tris(d);
    if (t0 > DRESS_TRIS) await d.transform(weld(), simplify({ simplifier: D.mo.MeshoptSimplifier, ratio: DRESS_TRIS / t0 * 0.97, error: err }));
    best = d;
    if (tris(d) <= DRESS_TRIS) break;
  }
  seamless(D, best, DRESS_TRIS);
  await best.transform(prune(), dedup(), quantize({ pattern: /^(POSITION|NORMAL)$/, quantizePosition: 14, quantizeNormal: 10 }), meshopt({ encoder: D.mo.MeshoptEncoder, level: 'high' }));
  const bin = await io.writeBinary(best); fs.writeFileSync(job.d + '.tmp', bin); fs.renameSync(job.d + '.tmp', job.d);
  return { dtris: tris(best), dbytes: bin.length };
}
/** Only the dressing copy of an Amazon library piece (its lean model already made by tools/abo-build.mjs): in the model's
 *  own frame, as the catalog has it (shared/abo-catalog.js). */
async function dressOnly(D, io, job) {
  if (!fs.existsSync(job.lod(3))) return { skip: 'not downloaded' };
  return dressCopy(D, io, job, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);   // (a scale fix applies when drawn, as for m/)
}

async function workerMain() {
  const D = deps();
  await D.mo.MeshoptDecoder.ready; await D.mo.MeshoptEncoder.ready; await D.mo.MeshoptSimplifier.ready;
  const io = new D.core.NodeIO().setLogger(QUIET(D)).registerExtensions(D.ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': D.mo.MeshoptDecoder, 'meshopt.encoder': D.mo.MeshoptEncoder });
  parentPort.on('message', async job => {
    const r = { key: job.key };
    try {
      const lodDir = job.pack, id = job.src;
      job.lod = n => path.join(lodDir, `lods/${id}/${id}_lod${n}.glb`);
      Object.assign(r, job.dressOnly ? await dressOnly(D, io, job) : await convert(D, io, job));
      if (!r.skip && job.thumbIn && fs.existsSync(job.thumbIn)) {
        const img = D.sharp(job.thumbIn);
        if (job.t) { await img.clone().resize(160, 160, { fit: 'inside' }).webp({ quality: 72 }).toFile(job.t + '.tmp.webp'); fs.renameSync(job.t + '.tmp.webp', job.t); }
      }
    } catch (e) { r.error = String(e?.stack || e).slice(0, 300); }
    parentPort.postMessage(r);
  });
}

// ------------------------------------------------------------------ the list
const readJson = (f, d) => fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d;
const fnv = s => { let h = 0x811c9dc5; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h; };
/** Short neutral id for a Google source id: 6 base-36 characters from its hash, the next free one on a clash. */
function shortId(src, used) {
  let h = fnv(src), id;
  do { id = h.toString(36).padStart(6, '0').slice(-6); h = (Math.imul(h, 2654435761) + 1) >>> 0; } while (used.has(id));
  used.add(id); return id;
}
const mm = v => Math.round(v * 1000);
const sig = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);

function libraryRows() {   // the Amazon library as committed (shared/abo-catalog.js), for its fixes and its small decor
  const rows = [];
  for (const line of ABO_ROWS.split('\n')) { if (!line) continue; const [id, ki, name, x0, z0, x1, z1, h] = line.split('|'); rows.push({ id, k: ABO_KIND_IDS[+ki], name, rect: [x0, z0, x1, z1].map(v => +v / 100), h: +h / 100 }); }
  return rows;
}

async function main() {
  const t0 = Date.now();
  const G = fs.readFileSync(path.join(GPACK, 'metadata.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const A = new Map(fs.readFileSync(path.join(APACK, 'metadata.jsonl'), 'utf8').trim().split('\n').map(l => { const m = JSON.parse(l); return [m.id, m]; }));
  const OVR = readJson(OVR_FILE, { google: {}, amazon: {}, library: {} });
  const { classify: aboClassify } = await import('./abo-build.mjs');
  // ---- sort every scan and the Amazon small things, then the overrides
  const items = [];
  for (const m of G) {
    const c = classifyGoogle(m), o = OVR.google?.[m.id] || {};
    items.push({ src: 'g', sid: m.id, m, ...c, o });
  }
  for (const m of A.values()) {
    if (aboClassify(m) && (m.lods?.[2]?.triangles ?? 0) <= 40000 && !OVR.amazon?.[m.id]?.add) continue;   // (in the furniture library)
    const o = OVR.amazon?.[m.id] || {}, c = classifyAmazon(m);
    if (!c && !o.add) continue;
    items.push({ src: 'a', sid: m.id, m, ...(c || { tags: [], label: '', flags: '', rule: 'override' }), o });
  }
  for (const it of items) {
    const o = it.o;
    if (o.tags) it.tags = o.tags.split ? o.tags.split(' ') : o.tags;
    if (o.label) it.label = o.label;
    if (o.flags) for (const [, sgn, f] of o.flags.matchAll(/([+-])(\w)/g)) it.flags = sgn === '+' ? (it.flags.includes(f) ? it.flags : it.flags + f) : it.flags.replace(f, '');
    it.drop = o.drop || null;
    for (const t of it.tags) if (!GOODS_TAGS.includes(t)) throw new Error(`${it.sid}: unknown tag ${t}`);
    it.sub = o.sub || SUB_OF_TAG[it.tags[0]];
    if (!GOODS_SUBS.includes(it.sub)) throw new Error(`${it.sid}: unknown sub-group ${it.sub}`);
  }
  // ---- pinned ids, appended only
  const pinned = readJson(IDS_FILE, { about: '', ids: [] }), have = new Map(), used = new Set();
  for (const line of pinned.ids) { const [src, sid, short] = line.split(' '); have.set(src + ' ' + sid, short || sid); if (src === 'g') used.add(short); }
  const fresh = items.filter(it => !have.has(it.src + ' ' + it.sid));
  fresh.sort((a, b) => (a.src === b.src ? 0 : a.src === 'g' ? -1 : 1) || GOODS_SUBS.indexOf(a.sub) - GOODS_SUBS.indexOf(b.sub) || a.label.localeCompare(b.label) || a.sid.localeCompare(b.sid));
  for (const it of fresh) {
    const short = it.src === 'g' ? shortId(it.sid, used) : it.sid;
    pinned.ids.push(it.src === 'g' ? `g ${it.sid} ${short}` : `a ${it.sid}`); have.set(it.src + ' ' + it.sid, short);
  }
  pinned.about = 'Pinned goods ids (tools/goods-build.mjs): "g <Google source id> <short id>" or "a <Amazon id>", in catalog order. Appended only: never edit, reorder or remove a line (a dropped model keeps its id, unused).';
  fs.writeFileSync(IDS_FILE, JSON.stringify(pinned, null, 0).replace('"ids":[', '"ids":[\n').replace(/","/g, '",\n"').replace(/"\]\}$/, '"\n]}\n'));
  const order = new Map(pinned.ids.map((l, i) => [l.split(' ').slice(0, 2).join(' '), i]));
  items.sort((a, b) => order.get(a.src + ' ' + a.sid) - order.get(b.src + ' ' + b.sid));
  for (const it of items) it.id = have.get(it.src + ' ' + it.sid);
  // ---- the Amazon library: fixes, and the small decor that also stands on surfaces (their dressing copies)
  const lib = libraryRows(), fixes = [];
  for (const r of lib) {
    const f = OVR.library?.[r.id]; if (!f) continue;
    fixes.push({ ...r, f });
  }
  const fixed = new Map(fixes.map(x => [x.id, x.f]));
  const onOk = lib.filter(r => { const f = fixed.get(r.id), k = f?.k || r.k, s = f?.scale || 1; return !f?.hide && ABO_ON_OK.has(k) && smallEnough(r.rect.map(v => v * s), Math.max(0.01, r.h) * s); });
  // ---- the models
  const cacheFile = path.join(OUT_G, '.build.json'), cache = readJson(cacheFile, {});
  for (const d of ['m', 'd', 't']) { fs.mkdirSync(path.join(OUT_G, d), { recursive: true }); fs.mkdirSync(path.join(OUT_A, d), { recursive: true }); }
  const jobs = [];
  for (const it of items) {
    if (it.drop) continue;
    const base = it.src === 'g' ? OUT_G : OUT_A, pack = it.src === 'g' ? GPACK : APACK;
    const s = sig({ RECIPE, o: { yaw: it.o.yaw, scale: it.o.scale, pitch: it.o.pitch }, shoe: it.tags[0] === 'shoe', y: it.flags.includes('y') });
    const f = { m: path.join(base, 'm', `${it.id}.glb`), d: path.join(base, 'd', `${it.id}.glb`), t: path.join(base, 't', `${it.id}.webp`) };
    const c = cache[it.src + ':' + it.id];
    it.key = it.src + ':' + it.id;
    if (c && c.sig === s && fs.existsSync(f.m) && fs.existsSync(f.d) && fs.existsSync(f.t)) { it.res = c; continue; }
    jobs.push({ key: it.key, src: it.sid, pack, cap: LEAN_CAP, tags: it.tags, flags: it.flags, o: { yaw: it.o.yaw, scale: it.o.scale, pitch: it.o.pitch }, m: f.m, d: f.d, t: fs.existsSync(f.t) && c?.sig === s ? null : f.t,
      thumbIn: path.join(pack, it.src === 'g' ? it.m.thumb : `thumbs/${it.sid}.webp`), sig: s });
  }
  for (const r of onOk) {
    const key = 'l:' + r.id, d = path.join(OUT_A, 'd', `${r.id}.glb`), s = sig({ RECIPE, lib: 1 });
    if (cache[key]?.sig === s && fs.existsSync(d)) continue;
    jobs.push({ key, src: r.id, pack: APACK, cap: 20000, tags: [], flags: '', o: { yaw: 0 }, d, dressOnly: true, sig: s });
  }
  if (+arg('--limit', 0)) jobs.splice(+arg('--limit', 0));   // (a trial: the first few only)
  if (!process.argv.includes('--catalog-only') && jobs.length) {
    const n = Math.max(1, Math.min(+arg('--jobs', 0) || Math.max(1, os.cpus().length - 4), jobs.length));
    console.log(`to make ${jobs.length} with ${n} workers`);
    let next = 0, done = 0, errors = 0;
    const byKey = new Map(jobs.map(j => [j.key, j]));
    await new Promise(resolve => {
      let live = n;
      for (let w = 0; w < n; w++) {
        const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { worker: true }, argv: process.argv.slice(2) });
        const feed = () => { if (next >= jobs.length) { wk.terminate(); if (--live === 0) resolve(); return; } wk.postMessage(jobs[next++]); };
        wk.on('message', r => {
          done++;
          const j = byKey.get(r.key);
          if (r.error || r.skip) { errors++; if (errors < 30) console.log('error', r.key, r.error || r.skip); }
          else cache[r.key] = { ...(cache[r.key] || {}), ...r, sig: j.sig };
          if (done % 200 === 0) { console.log(`${done}/${jobs.length} errors ${errors} ${((Date.now() - t0) / 1000).toFixed(0)} s`); fs.writeFileSync(cacheFile, JSON.stringify(cache)); }
          feed();
        });
        wk.on('error', e => { console.log('worker died', String(e).slice(0, 200)); if (--live === 0) resolve(); });
        feed();
      }
    });
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
    console.log(`made ${done - errors}, errors ${errors}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  for (const it of items) it.res = cache[it.key];
  // the scans' colour words, from their pictures (quick: tuned here without making the models again)
  const sharp = deps().sharp, gs = items.filter(it => it.src === 'g' && !it.drop);
  for (let i = 0; i < gs.length; i += 64) await Promise.all(gs.slice(i, i + 64).map(async it => {
    const { data, info } = await sharp(path.join(GPACK, it.m.thumb)).resize(64, 64, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    it.colour = colourOf(data, info.channels);
  }));
  // ---- names, rows, checks
  const seen = {}, rows = [], report = { missing: [], sanity: [], heavy: [], franchise: 0, dropped: [], bySub: {}, byTag: {}, flags: {} };
  for (const it of items) {
    if (it.drop) { report.dropped.push(`${it.id} ${it.drop}`); continue; }
    const r = it.res;
    if (!r?.bounds) { report.missing.push(it.key); continue; }
    const colour = it.o.colour ?? (it.src === 'a' ? (pickColour(String(it.m.color || '').toLowerCase()) || pickColour(String(it.m.name || '').toLowerCase())) : it.colour || '');
    if (it.label === 'Plant Pot' && !it.o.label && r.bounds[1][1] < 0.05) { it.label = 'Pot Saucer'; it.flags = it.flags.replace('f', ''); }   // (a flat one)
    let name = it.o.name || [colour, it.label].filter(Boolean).join(' ');
    seen[name] = (seen[name] || 0) + 1;
    if (seen[name] > 1) name += ` ${seen[name]}`;
    const [mn, mx] = r.bounds, w = mx[0] - mn[0], h = mx[1] - mn[1], d = mx[2] - mn[2];
    const sane = SANE[it.tags[0]] || [0.01, 0.6];
    if (Math.max(w, h, d) > sane[1] || Math.max(w, h, d) < sane[0]) report.sanity.push(`${it.key} ${it.sid.slice(0, 40)} ${it.tags[0]} ${[w, h, d].map(v => v.toFixed(2)).join('x')}`);
    if ((r.dtris || 0) > DRESS_TRIS) report.heavy.push(`${it.key} d ${r.dtris}`);
    if (it.flags.includes('x')) report.franchise++;
    report.bySub[it.sub] = (report.bySub[it.sub] || 0) + 1;
    for (const t of it.tags) report.byTag[t] = (report.byTag[t] || 0) + 1;
    for (const f of it.flags) report.flags[f] = (report.flags[f] || 0) + 1;
    const flags = [...new Set(it.flags)].sort().join('');
    rows.push([it.id, it.src, it.tags.map(t => GOODS_TAGS.indexOf(t)).join(','), GOODS_SUBS.indexOf(it.sub), name, mm(mn[0]), mm(mn[2]), mm(mx[0]), mm(mx[2]), mm(mx[1]), flags].join('|'));
    it.name = name;
  }
  // a brand word in a name (any pack's brand, or a word of the source name that is not a common word) fails the build
  const brands = new Set();
  for (const m of [...G, ...items.filter(i => i.src === 'a').map(i => i.m)]) for (const w of String(m.brand || '').toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 3) brands.add(w);
  // (ordinary words that also occur in some maker's name: reviewed one by one)
  const GENERIC = new Set(String(process.env.GOODS_GENERIC || '').split(',').concat(GENERIC_WORDS));
  const COMMON = new Set(['the', 'and', 'for', 'black', 'white', 'grey', 'gray', 'blue', 'red', 'green', 'pink', 'gold', 'brown', 'navy', 'cream', 'yellow', 'orange', 'purple', 'home', 'design', 'kids', 'just', 'little', 'tag', 'test', 'office', 'room', 'essentials', 'basics', 'marc', 'nordic', 'focus', 'green', 'earth', 'down', 'smart', 'travel', 'circle', 'full', 'top', 'paw', 'great', 'choice', 'ware', 'products', 'international', 'star', 'one', 'heavy', 'duty', 'grip']);
  const hit = new Map();
  for (const it of items) for (const w of (it.name || '').toLowerCase().split(/[^a-z0-9]+/)) if (brands.has(w) && !COMMON.has(w) && !GENERIC.has(w)) hit.set(w, [...(hit.get(w) || []), it.id]);
  if (hit.size) throw new Error('brand words in names: ' + [...hit].map(([w, ids]) => `${w} (${ids.length}: ${ids.slice(0, 3).join(' ')})`).join(', '));
  // ---- the fixes to the Amazon library (kind, scale, hidden), with their new names
  const libNames = new Set(lib.map(r => r.name)), fixLines = [];
  for (const { id, k, name, f } of fixes) {
    let nm = f.name || name;
    if (f.k && f.k !== k && !f.name) {
      const base = name.replace(/ \d+$/, '').replace(ABO_KINDS[k].label, ABO_KINDS[f.k].label);
      nm = base; let i = 1; while (libNames.has(nm)) nm = `${base} ${++i}`;
      libNames.add(nm);
    }
    fixLines.push([id, ABO_KIND_IDS.indexOf(f.k || k), nm, f.scale || 1, f.hide ? 'h' : '', mm(f.oy || 0)].join('|'));
  }
  const counts = Object.entries(report.bySub).map(([s, n]) => `${s} ${n}`).join(', ');
  const src = `// My Virtual World — generated by tools/goods-build.mjs (do not edit by hand; fix by tools/goods-overrides.json): the goods,
// ${rows.length} small things for tables, counters and shelves. By sub-group: ${counts}.
// Google Scanned Objects by Google LLC (CC BY 4.0, client/assets/gso/ATTRIBUTION.md), as converted by CodePawl
// (huggingface.co/datasets/codepawl/scanned-objects-glb, rev ${GSO_REV}); Amazon Berkeley Objects by Amazon.com (CC BY 4.0,
// client/assets/abo/ATTRIBUTION.md), as converted by CodePawl (huggingface.co/datasets/codepawl/abo-glb, rev c6ac661).
// One line per model: id | src (g Google: client/assets/gso/, a Amazon: client/assets/abo/) | tags (indexes in
// shared/goods-tags.js GOODS_TAGS) | sub-group (index in GOODS_SUBS) | name | x0 | z0 | x1 | z1 | height (mm, its own frame:
// +z its front, standing on y = 0) | flags (GOODS_FLAGS). Models: <src>/m/<id>.glb, dressing copy <src>/d/<id>.glb,
// picture <src>/t/<id>.webp.
export const GOODS_REV = '${sig(rows)}';
export const GOODS_ROWS = \`
${rows.join('\n')}
\`;
// Fixes to the Amazon furniture library (shared/abo-catalog.js, whose lines stay as they are): id | kind (index in
// shared/abo-kinds.js ABO_KIND_IDS) | name | scale (of its model and size) | flags (h: left out of the Furnish panel) |
// raise (mm: its model lifted by this much, for a model made around its middle).
export const GOODS_ABO_FIX = \`
${fixLines.join('\n')}
\`;
// The Amazon library's pieces that may also stand on a surface: their dressing copies are client/assets/abo/d/<id>.glb.
export const GOODS_ABO_DRESS = '${onOk.map(r => r.id).join(' ')}';
`;
  fs.writeFileSync(path.join(ROOT, 'shared/goods-catalog.js'), src);
  report.rows = rows.length; report.fixes = fixLines.length; report.onOk = onOk.length;
  const rep = arg('--report', path.join(OUT_G, 'build-report.json'));
  fs.writeFileSync(rep, JSON.stringify({ ...report, names: items.filter(i => i.name).map(i => `${i.key} ${i.sub} | ${i.tags.join(',')} | ${i.flags} | ${i.name} | ${i.rule} | ${i.sid}`) }, null, 1));
  console.log(`catalog ${rows.length} (dropped ${report.dropped.length}, missing ${report.missing.length}), fixes ${fixLines.length}, onOk ${onOk.length}, franchise ${report.franchise}`);
  console.log('by sub', JSON.stringify(report.bySub)); console.log('by tag', JSON.stringify(report.byTag)); console.log('flags', JSON.stringify(report.flags));
  console.log(`sanity ${report.sanity.length}, heavy dressing ${report.heavy.length}; report ${rep}`);
}
// words of the labels that also occur in some maker's name, each checked to be an ordinary word here
const GENERIC_WORDS = ['coffee', 'ramekin', 'running', 'dollhouse', 'play', 'animal', 'game', 'magnifying'];
// plausible size (longest side, m) by first tag: outside it is reported for an override
const SANE = { shoe: [0.12, 0.5], tableware: [0.03, 0.5], mug: [0.06, 0.25], cookware: [0.05, 0.6], 'food-pack': [0.03, 0.5], drink: [0.05, 0.5], 'desk-item': [0.03, 1.0],
  pharmacy: [0.03, 0.4], beauty: [0.03, 0.45], cable: [0.02, 0.6], electronics: [0.03, 0.6], toy: [0.02, 0.6], game: [0.05, 0.6],
  media: [0.04, 0.4], bag: [0.1, 0.6], plant: [0.05, 0.5], 'office-supply': [0.02, 0.5], decor: [0.03, 0.6], sport: [0.1, 0.6] };

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
else if (workerData?.worker) workerMain();
