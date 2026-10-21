// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing game's gear (docs/features/fishing.md §Gear): rods, reels, lines, lures and bait, the boat's upgrades and
// the angler's skills — what each does, what it costs at the dock store (VC) and the level it needs. A player's gear is
// theirs on every boat. The fight (shared/fishing-fight.js) and the bite (shared/fishing-trip.js) read their numbers
// from here through loadout(). Shared by the server (sales, checks) and the browser (the store, the HUD).

// ------------------------------------------------------------------------------------------- lures and bait
// kind: how it is fished — float (under a bobber, at a set depth), bottom (sinks to the bed), cast (retrieved: its depth
// from how it swims), troll (towed behind the moving boat; needs rod holders). depth: [m] it swims at when cast.
// water: where it is sold. pack: how many come in a pack; price per pack (VC). bait: used up when a fish takes it;
// a lure is used again and again, lost only when the line snaps.
export const LURES = Object.freeze([
  { id: 'worm', bait: true, name: 'Nightcrawlers', icon: '🪱', kind: 'float', depth: [0.5, 4], water: 'lake', pack: 10, price: 4, level: 1, colour: '#a0605a', blurb: 'Under a bobber or on the bottom. Everything in a lake eats a worm.' },
  { id: 'dough', bait: true, name: 'Dough Bait', icon: '🍞', kind: 'bottom', depth: [0, 30], water: 'lake', pack: 10, price: 5, level: 2, colour: '#d8c27a', blurb: 'Carp, catfish and tilapia can\'t resist it.' },
  { id: 'minnow', bait: true, name: 'Live Minnows', icon: '🐟', kind: 'float', depth: [0.5, 8], water: 'lake', pack: 8, price: 8, level: 2, colour: '#b8c4c8', blurb: 'Lively bait for crappie, walleye, pike and bass.' },
  { id: 'shrimp', bait: true, name: 'Live Shrimp', icon: '🦐', kind: 'float', depth: [0.5, 6], water: 'sea', pack: 10, price: 5, level: 1, colour: '#e8a080', blurb: 'The inshore favourite: almost everything on the flats and the reef takes it.' },
  { id: 'cutbait', bait: true, name: 'Cut Bait', icon: '🔪', kind: 'bottom', depth: [0, 200], water: 'both', pack: 10, price: 6, level: 2, colour: '#c06060', blurb: 'On the bottom for snapper, grouper, catfish and sharks.' },
  { id: 'livebait', bait: true, name: 'Live Sardines', icon: '🐠', kind: 'float', depth: [1, 20], water: 'sea', pack: 8, price: 14, level: 4, colour: '#9ab8d0', blurb: 'Big predators — snook, tarpon, kingfish, amberjack — come for live bait.' },
  { id: 'squid', bait: true, name: 'Squid Jig & Strip', icon: '🦑', kind: 'bottom', depth: [0, 600], water: 'sea', pack: 6, price: 18, level: 8, colour: '#f0e0e8', blurb: 'Glows in the dark. Squid at night, and swordfish deep down.' },
  { id: 'spinner', name: 'Spinnerbait', icon: '🌀', kind: 'cast', depth: [0.5, 2.5], water: 'both', pack: 1, price: 12, level: 1, colour: '#e8d040', blurb: 'Flash and thump through the shallows.' },
  { id: 'crank', name: 'Crankbait', icon: '🎏', kind: 'cast', depth: [1.5, 5], water: 'both', pack: 1, price: 16, level: 3, colour: '#e86a3a', blurb: 'Dives as you reel; bass, walleye and pike on the edges.' },
  { id: 'soft', name: 'Soft Plastic', icon: '🪝', kind: 'cast', depth: [0.5, 8], water: 'both', pack: 4, price: 10, level: 1, colour: '#7a5ab0', blurb: 'Slow and natural. Bass, redfish, seatrout, snook.' },
  { id: 'topwater', name: 'Topwater Popper', icon: '💥', kind: 'cast', depth: [0, 0.3], water: 'both', pack: 1, price: 18, level: 3, colour: '#f2f2e8', blurb: 'Pops and splashes on the surface — explosive strikes at dawn and dusk.' },
  { id: 'jig', name: 'Bucktail Jig', icon: '🎣', kind: 'bottom', depth: [0, 120], water: 'both', pack: 2, price: 12, level: 2, colour: '#f2f2f2', blurb: 'Drop it to the bottom and bounce it. Reef fish, walleye, amberjack.' },
  { id: 'spoon', name: 'Casting Spoon', icon: '🥄', kind: 'cast', depth: [0.5, 6], water: 'both', pack: 1, price: 14, level: 2, colour: '#d8d8e0', blurb: 'Wobbles and flashes: mackerel, bonito, trout, pike.' },
  { id: 'skirt', name: 'Trolling Skirt', icon: '🪼', kind: 'troll', depth: [0, 2], water: 'sea', pack: 1, price: 40, level: 6, colour: '#3a8ae8', blurb: 'Towed behind the boat for tuna, wahoo, mahi, sailfish and marlin. Needs rod holders.' },
].map(Object.freeze));
export const LURE_BY_ID = Object.freeze(Object.fromEntries(LURES.map(l => [l.id, l])));
export const luresFor = water => LURES.filter(l => l.water === 'both' || l.water === water);

// ------------------------------------------------------------------------------------------- tackle
// rod: reach (m a full cast goes), win (s to set the hook after the strike), power (how fast it tires a fish), maxKg (the
// biggest fish it can lift: beyond that it barely tires it), feel (how clearly a nibble shows). reel: speed (m/s of line
// gained under no load), drag (kgf it gives line at), cap (m of line it holds). line: kgf it breaks at, vis (how much
// fish see it: fewer bites).
export const RODS = Object.freeze([
  { id: 'rod_starter', name: 'Starter Rod', tier: 1, reach: 22, win: 0.55, power: 1.0, maxKg: 8, feel: 0.5, price: 0, level: 1, blurb: 'A light spinning rod. Fine for panfish and inshore fish.' },
  { id: 'rod_glass', name: 'Fibreglass Rod', tier: 2, reach: 28, win: 0.6, power: 1.15, maxKg: 22, feel: 0.6, price: 150, level: 3, blurb: 'Tough and forgiving: bass, snapper, catfish.' },
  { id: 'rod_graphite', name: 'Graphite Pro', tier: 3, reach: 34, win: 0.65, power: 1.35, maxKg: 60, feel: 0.75, price: 600, level: 6, blurb: 'Light, sensitive and strong. Feels every nibble.' },
  { id: 'rod_carbon', name: 'Carbon Elite', tier: 4, reach: 40, win: 0.72, power: 1.6, maxKg: 180, feel: 0.85, price: 2000, level: 10, blurb: 'For tuna, sharks and the biggest catfish.' },
  { id: 'rod_legend', name: 'Legend Rod', tier: 5, reach: 46, win: 0.8, power: 1.9, maxKg: 900, feel: 1.0, price: 6500, level: 16, blurb: 'Built for marlin and legends.' },
].map(Object.freeze));
export const REELS = Object.freeze([
  { id: 'reel_spincast', name: 'Spincast Reel', tier: 1, speed: 0.95, drag: 3, cap: 110, price: 0, level: 1, blurb: 'Push-button simple.' },
  { id: 'reel_spin', name: 'Spinning 3000', tier: 2, speed: 1.15, drag: 6, cap: 180, price: 180, level: 3, blurb: 'A smooth all-rounder.' },
  { id: 'reel_bait', name: 'Baitcaster', tier: 3, speed: 1.35, drag: 11, cap: 240, price: 700, level: 6, blurb: 'Fast, with real stopping power.' },
  { id: 'reel_biggame', name: 'Big Game 50W', tier: 4, speed: 1.55, drag: 26, cap: 650, price: 2400, level: 10, blurb: 'Lever drag and a deep spool for the blue water.' },
  { id: 'reel_trophy', name: 'Trophy 80W', tier: 5, speed: 1.8, drag: 42, cap: 950, price: 7000, level: 16, blurb: 'The reel the legends are landed on.' },
].map(Object.freeze));
export const LINES = Object.freeze([
  { id: 'line_mono8', name: 'Mono 8 lb', tier: 1, kgf: 3.6, vis: 0.5, price: 0, level: 1, blurb: 'Stretchy and forgiving.' },
  { id: 'line_mono15', name: 'Mono 15 lb', tier: 2, kgf: 6.8, vis: 0.55, price: 60, level: 2, blurb: 'For bigger bass and snapper.' },
  { id: 'line_braid30', name: 'Braid 30 lb', tier: 3, kgf: 13.6, vis: 0.7, price: 250, level: 5, blurb: 'Thin and strong, no stretch.' },
  { id: 'line_braid65', name: 'Braid 65 lb', tier: 4, kgf: 29.5, vis: 0.75, price: 900, level: 9, blurb: 'Grouper, amberjack, big catfish.' },
  { id: 'line_biggame', name: 'Big Game 130 lb', tier: 5, kgf: 59, vis: 0.8, price: 2800, level: 14, blurb: 'Marlin line.' },
  { id: 'line_legend', name: 'Legend Braid 200 lb', tier: 6, kgf: 90, vis: 0.8, price: 8000, level: 18, blurb: 'The strongest line there is — for the legends.' },
].map(Object.freeze));
/** A fluorocarbon leader: fish see the line less (more bites). Bought once. */
export const LEADER = Object.freeze({ id: 'leader_fluoro', name: 'Fluorocarbon Leader', vis: -0.3, price: 120, level: 4, blurb: 'Nearly invisible under water: more bites from wary fish.' });

// ------------------------------------------------------------------------------------------- the boat's upgrades
// Each has tiers 0 (what every boat has) to 3; value: the tier's number for the boat (boat-model and the trip read them).
export const BOAT_UPGRADES = Object.freeze([
  { id: 'engine', name: 'Engine tune', icon: '⚙️', unit: '% top speed', tiers: [0, 12, 25, 40], price: [0, 300, 1100, 3200], level: [1, 3, 7, 12], blurb: 'More speed: reach far grounds and get home before dusk.' },
  { id: 'cooler', name: 'Cooler', icon: '🧊', unit: 'slots', tiers: [12, 20, 30, 44], price: [0, 200, 800, 2500], level: [1, 2, 6, 11], blurb: 'Room for the catch. A big fish takes several slots.' },
  { id: 'finder', name: 'Fish finder', icon: '📡', unit: 'm range', tiers: [25, 60, 120, 220], price: [0, 250, 950, 3000], level: [1, 3, 7, 12], blurb: 'Sonar: marks under the boat, hidden grounds at range; the best names the fish.' },
  { id: 'holders', name: 'Rod holders', icon: '🎣', unit: 'trolling rods', tiers: [0, 1, 2, 3], price: [0, 350, 1000, 2600], level: [1, 5, 8, 12], blurb: 'Troll lures behind the boat while you drive — a rod bends when one takes.' },
  { id: 'lights', name: 'Deck lights', icon: '💡', unit: 'min past dusk', tiers: [0, 3, 6, 10], price: [0, 250, 700, 1800], level: [1, 4, 8, 12], blurb: 'Keep fishing after dusk without the catch spoiling.' },
  { id: 'livewell', name: 'Livewell', icon: '🫧', unit: '% slower spoiling', tiers: [0, 30, 60, 90], price: [0, 300, 900, 2400], level: [1, 4, 8, 12], blurb: 'Keeps the catch alive and fresh when you are late home.' },
  { id: 'anchor', name: 'Anchor', icon: '⚓', unit: 'hold', tiers: [1, 1.5, 2.2, 3], price: [0, 120, 400, 1000], level: [1, 2, 5, 9], blurb: 'Holds the boat on the spot in wind and current.' },
].map(Object.freeze));
export const UPGRADE_BY_ID = Object.freeze(Object.fromEntries(BOAT_UPGRADES.map(u => [u.id, u])));

// ------------------------------------------------------------------------------------------- skills
// One point per fishing level; each skill up to 5 ranks; per: what one rank adds.
export const SKILLS = Object.freeze([
  { id: 'casting', name: 'Casting', icon: '🎯', per: 0.06, unit: 'reach', blurb: '+6 % casting reach a rank.' },
  { id: 'hookset', name: 'Hookset', icon: '⚡', per: 0.08, unit: 'hook window', blurb: '+8 % longer to set the hook a rank.' },
  { id: 'fighting', name: 'Fighting', icon: '💪', per: 0.06, unit: 'stamina drain', blurb: 'Fish tire 6 % faster a rank; tension builds a little slower.' },
  { id: 'seaman', name: 'Seamanship', icon: '🧭', per: 0.04, unit: 'boat speed', blurb: '+4 % boat speed and sharper handling a rank.' },
  { id: 'trader', name: 'Trader', icon: '🪙', per: 0.03, unit: 'sale price', blurb: '+3 % at the dock store a rank.' },
  { id: 'luck', name: 'Luck', icon: '🍀', per: 0.07, unit: 'rare bites', blurb: 'Rarer fish and bigger ones bite a little more often.' },
].map(Object.freeze));
export const SKILL_MAX = 5;
export const RESPEC_PRICE = 250;

export const GEAR = Object.freeze(Object.fromEntries([...RODS, ...REELS, ...LINES, LEADER].map(g => [g.id, g])));
/** What every angler starts with. */
export const STARTER = Object.freeze({ rod: 'rod_starter', reel: 'reel_spincast', line: 'line_mono8', leader: false, lures: { worm: 10, shrimp: 10, spinner: 1, soft: 4 }, boat: {}, skills: {} });

/**
 * A player's kit as numbers the game uses: { rod, reel, line, reach, win, power, maxKg, feel, speed, drag, cap, kgf, vis,
 * boat: { engine, cooler, finder, holders, lights, livewell, anchor }, skills, luck, trader }. kit: { rod, reel, line,
 * leader, boat: { id: tier }, skills: { id: rank } } (missing parts: the starter's).
 */
export function loadout(kit = {}) {
  const rod = GEAR[kit.rod] || GEAR[STARTER.rod], reel = GEAR[kit.reel] || GEAR[STARTER.reel], line = GEAR[kit.line] || GEAR[STARTER.line];
  const sk = id => Math.max(0, Math.min(SKILL_MAX, Math.floor(kit.skills?.[id] || 0)));
  const per = id => SKILLS.find(s => s.id === id).per * sk(id);
  const boat = {};
  for (const u of BOAT_UPGRADES) boat[u.id] = u.tiers[Math.max(0, Math.min(3, Math.floor(kit.boat?.[u.id] || 0)))];
  return {
    rod: rod.id, reel: reel.id, line: line.id,
    reach: rod.reach * (1 + per('casting')), win: rod.win * (1 + per('hookset')), power: rod.power * (1 + per('fighting')), maxKg: rod.maxKg, feel: rod.feel,
    speed: reel.speed, drag: Math.min(reel.drag, 0.6 * line.kgf), cap: reel.cap, kgf: line.kgf,
    vis: Math.max(0.15, line.vis + (kit.leader ? LEADER.vis : 0)), calm: 1 - 0.5 * per('fighting'),
    boat, boatSpeed: 1 + boat.engine / 100 + per('seaman'), luck: per('luck'), trader: per('trader'),
  };
}
/** The price of the next tier of a boat upgrade, or null at the top. */
export const upgradePrice = (id, tier) => { const u = UPGRADE_BY_ID[id]; return u && tier < 3 ? u.price[tier + 1] : null; };
