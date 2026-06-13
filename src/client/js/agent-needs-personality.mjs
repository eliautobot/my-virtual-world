// Agent needs + personality system (v2).
//
// Five invisible need meters per agent (0..100) drift up over time; idle
// activity selection picks the category serving the highest need, weighted by
// the agent's personality TRAITS. Completing an activity satisfies the need(s)
// the used OBJECT declares (per-object `satisfies` parameter, with a
// type-default table), so a just-satisfied need cannot immediately re-trigger.
//
// v2 changes vs v1:
//  - hunger split out of thirst (food objects vs drink objects)
//  - per-object `satisfies` contract replaces activity-name matching
//  - personality is now 3 real traits (outgoing/curious/easygoing) that feed a
//    trait→need matrix for both drift rates and selection weights, instead of
//    raw per-need multipliers
//
// Pure functions only — no DOM, no globals — verifiable in Node
// (scripts/verify-agent-needs-personality.mjs) and reusable by main3d.js.

export const AGENT_NEEDS_VERSION = 'agent-needs-personality/v2';

export const NEED_KEYS = Object.freeze(['thirst', 'hunger', 'energy', 'social', 'boredom']);

// Per real-time minute of idle simulation (before trait drift multipliers).
export const NEED_DRIFT_PER_MINUTE = Object.freeze({
  thirst: 8,
  hunger: 6,        // slower than thirst, like real life
  energy: 5,        // +energyMovingBonus while walking
  social: 7,
  boredom: 10,
});
export const ENERGY_MOVING_BONUS_PER_MINUTE = 10;
export const SOCIAL_NEAR_AGENTS_RELIEF_PER_MINUTE = 9;

// Where a need lands after a satisfying activity completes.
export const NEED_SATISFY_RESET = Object.freeze({
  thirst: 5,
  hunger: 5,
  energy: 10,
  social: 10,
  boredom: 15,
});

// ── Per-object `satisfies` contract ─────────────────────────────────────────
// Which need(s) using an object satisfies. Placed objects may override with an
// explicit `satisfies: ['hunger']` array; otherwise the type default applies.
// New object types should either ship a type default here or declare
// `satisfies` on the catalog/placed item — never rely on name matching.
export const OBJECT_TYPE_SATISFIES = Object.freeze({
  // Drinks → thirst
  waterCooler: Object.freeze(['thirst']),
  coffeeMachine: Object.freeze(['thirst']),
  countertopCoffeeMachine: Object.freeze(['thirst']),
  coffeePickupShelf: Object.freeze(['thirst']),
  cooler: Object.freeze(['thirst']),
  // Food → hunger (vending serves both)
  vending: Object.freeze(['hunger', 'thirst']),
  fridge: Object.freeze(['hunger']),
  microwave: Object.freeze(['hunger']),
  cafeCounter: Object.freeze(['hunger']),
  foodTruckCounter: Object.freeze(['hunger']),
  pantryShelf: Object.freeze(['hunger']),
  grill: Object.freeze(['hunger']),
  kitchenIsland: Object.freeze(['hunger']),
  counter: Object.freeze(['hunger']),
  displayCase: Object.freeze(['hunger']),
  // Rest seating → energy
  couch: Object.freeze(['energy']),
  sectionalSofa: Object.freeze(['energy']),
  loveseat: Object.freeze(['energy']),
  armchair: Object.freeze(['energy']),
  loungeSeat: Object.freeze(['energy']),
  hallwayBench: Object.freeze(['energy']),
  parkBench: Object.freeze(['energy']),
  patioChair: Object.freeze(['energy']),
  diningChair: Object.freeze(['energy']),
  bed: Object.freeze(['energy']),
  sleepPod: Object.freeze(['energy']),
  busStop: Object.freeze(['energy']),
  smallCafeTable: Object.freeze(['energy', 'social']),
  outdoorCafeTable: Object.freeze(['energy', 'social']),
  picnicTable: Object.freeze(['energy', 'social']),
  patioTable: Object.freeze(['energy', 'social']),
  // Social objects → social
  meetingTable: Object.freeze(['social']),
  smallRoundMeetingTable: Object.freeze(['social']),
  gazeboPavilion: Object.freeze(['social']),
  fountain: Object.freeze(['social']),
  outdoorStage: Object.freeze(['social', 'boredom']),
  // Play/exercise → boredom
  pingpong: Object.freeze(['boredom', 'social']),
  poolTable: Object.freeze(['boredom', 'social']),
  arcadeMachine: Object.freeze(['boredom']),
  gamingStation: Object.freeze(['boredom']),
  dartboard: Object.freeze(['boredom']),
  treadmill: Object.freeze(['boredom']),
  trainingMat: Object.freeze(['boredom']),
  gymBench: Object.freeze(['boredom']),
  dumbbellRack: Object.freeze(['boredom']),
  outdoorExerciseStation: Object.freeze(['boredom']),
  playgroundSlide: Object.freeze(['boredom']),
  playgroundSwing: Object.freeze(['boredom']),
  // Browse/read → boredom
  bookshelf: Object.freeze(['boredom']),
  bulletinBoard: Object.freeze(['boredom']),
  menuBoard: Object.freeze(['boredom']),
  whiteboard: Object.freeze(['boredom']),
  outdoorNoticeBoard: Object.freeze(['boredom']),
  wallArt: Object.freeze(['boredom']),
  shopShelf: Object.freeze(['boredom']),
  supplyCabinet: Object.freeze(['boredom']),
  medicalSupplyCabinet: Object.freeze(['boredom']),
  dresser: Object.freeze(['boredom']),
  wardrobe: Object.freeze(['boredom']),
  nightstand: Object.freeze(['boredom']),
  displayMannequin: Object.freeze(['boredom']),
  clothingRack: Object.freeze(['boredom']),
  tvStand: Object.freeze(['boredom']),
  mirror: Object.freeze(['boredom']),
  storageBoxes: Object.freeze(['boredom']),
  serverRack: Object.freeze(['boredom']),
  toolCart: Object.freeze(['boredom']),
  workbench: Object.freeze(['boredom']),
  printerCopier: Object.freeze(['boredom']),
});

// Resolve which needs using an object satisfies. Per-object `satisfies`
// parameter wins; type default second; null if unknown (caller falls back to
// the behavior category).
export function resolveObjectSatisfies(objectType = null, item = null) {
  const explicit = Array.isArray(item?.satisfies) ? item.satisfies : (Array.isArray(item?.lifecycle?.satisfies) ? item.lifecycle.satisfies : null);
  if (explicit?.length) {
    const cleaned = explicit.map(value => String(value || '').toLowerCase()).filter(value => NEED_KEYS.includes(value));
    if (cleaned.length) return cleaned;
  }
  const byType = OBJECT_TYPE_SATISFIES[String(objectType || '')];
  return byType ? [...byType] : null;
}

// Category fallback (used when no object info is available, e.g. wander).
export const CATEGORY_NEED_MAP = Object.freeze({
  'snack-drink': Object.freeze({ needs: Object.freeze(['thirst', 'hunger']), scale: 1.0 }),
  rest: Object.freeze({ needs: Object.freeze(['energy']), scale: 1.0 }),
  socialize: Object.freeze({ needs: Object.freeze(['social']), scale: 1.0 }),
  play: Object.freeze({ needs: Object.freeze(['boredom']), scale: 0.9 }),
  'browse-read': Object.freeze({ needs: Object.freeze(['boredom']), scale: 0.8 }),
  wander: Object.freeze({ needs: Object.freeze(['boredom']), scale: 0.5 }),
});
export const WORK_RETURN_BASE_WEIGHT = 3;
export const MIN_CATEGORY_WEIGHT = 2;
export const RECENT_CATEGORY_PENALTY = 0.35;

// ── Personality traits ───────────────────────────────────────────────────────
// Three real traits, each 0.5 (low) .. 2.0 (high), 1.0 = average.
//  outgoing  — seeks people: faster social need, picks socialize/play more
//  curious   — explores: faster boredom, picks browse/play/wander more
//  easygoing — relaxed: rests/snacks more, slightly higher hunger/thirst pull
export const TRAIT_KEYS = Object.freeze(['outgoing', 'curious', 'easygoing']);
export const PERSONALITY_KEYS = TRAIT_KEYS; // back-compat alias
export const PERSONALITY_MIN = 0.5;
export const PERSONALITY_MAX = 2.0;

// How strongly each trait bends each need's DRIFT rate.
// multiplier = 1 + weight * (trait - 1), clamped to 0.4..2.2.
export const TRAIT_NEED_DRIFT_MATRIX = Object.freeze({
  thirst: Object.freeze({ easygoing: 0.3 }),
  hunger: Object.freeze({ easygoing: 0.5 }),
  energy: Object.freeze({ easygoing: 0.4 }),
  social: Object.freeze({ outgoing: 1.0 }),
  boredom: Object.freeze({ curious: 1.0 }),
});

// How strongly each trait bends each CATEGORY's selection weight.
export const TRAIT_CATEGORY_WEIGHT_MATRIX = Object.freeze({
  'snack-drink': Object.freeze({ easygoing: 0.4 }),
  rest: Object.freeze({ easygoing: 1.0 }),
  socialize: Object.freeze({ outgoing: 1.0 }),
  play: Object.freeze({ curious: 0.6, outgoing: 0.3 }),
  'browse-read': Object.freeze({ curious: 1.0 }),
  wander: Object.freeze({ curious: 0.4 }),
});

export const PERSONALITY_PRESETS = Object.freeze({
  balanced: Object.freeze({ label: 'Balanced', outgoing: 1.0, curious: 1.0, easygoing: 1.0 }),
  'social-hub': Object.freeze({ label: 'Social Hub', outgoing: 1.8, curious: 1.0, easygoing: 0.9 }),
  explorer: Object.freeze({ label: 'Explorer', outgoing: 0.7, curious: 1.8, easygoing: 0.9 }),
  'chill-lounger': Object.freeze({ label: 'Chill Lounger', outgoing: 0.8, curious: 0.8, easygoing: 1.8 }),
  'go-getter': Object.freeze({ label: 'Go-Getter', outgoing: 1.4, curious: 1.4, easygoing: 0.6 }),
  loner: Object.freeze({ label: 'Quiet Loner', outgoing: 0.5, curious: 1.2, easygoing: 1.2 }),
});

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampNeedValue(value) {
  return clampNumber(value, 0, 100, 0);
}

// Legacy v1 personalities were per-need multipliers {thirst,energy,social,boredom}.
// Map them onto the closest trait expression so saved customizations survive.
export function isLegacyPersonality(raw = {}) {
  if (!raw || typeof raw !== 'object') return false;
  const hasTrait = TRAIT_KEYS.some(key => raw[key] != null);
  const hasLegacy = ['thirst', 'energy', 'social', 'boredom'].some(key => raw[key] != null);
  return hasLegacy && !hasTrait;
}

export function migrateLegacyPersonality(raw = {}) {
  const social = clampNumber(raw?.social, PERSONALITY_MIN, PERSONALITY_MAX, 1.0);
  const boredom = clampNumber(raw?.boredom, PERSONALITY_MIN, PERSONALITY_MAX, 1.0);
  const energy = clampNumber(raw?.energy, PERSONALITY_MIN, PERSONALITY_MAX, 1.0);
  const thirst = clampNumber(raw?.thirst, PERSONALITY_MIN, PERSONALITY_MAX, 1.0);
  const out = {};
  out.outgoing = social;
  out.curious = boredom;
  out.easygoing = clampNumber((energy + thirst) / 2, PERSONALITY_MIN, PERSONALITY_MAX, 1.0);
  return out;
}

export function clampPersonality(raw = {}) {
  if (isLegacyPersonality(raw)) return migrateLegacyPersonality(raw);
  const out = {};
  for (const key of TRAIT_KEYS) {
    out[key] = clampNumber(raw?.[key], PERSONALITY_MIN, PERSONALITY_MAX, 1.0);
  }
  return out;
}

export function personalityPresetIdFor(personality = {}) {
  const clamped = clampPersonality(personality);
  for (const [id, preset] of Object.entries(PERSONALITY_PRESETS)) {
    if (TRAIT_KEYS.every(key => Math.abs(Number(preset[key]) - clamped[key]) < 0.001)) return id;
  }
  return 'custom';
}

// Seeded variation so default agents are not clones even before the user
// customizes anything. Deterministic per agent id.
export function seededDefaultPersonality(agentId = '') {
  const seedBase = String(agentId || 'agent').split('').reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const out = {};
  TRAIT_KEYS.forEach((key, index) => {
    const h = ((seedBase ^ (index + 1) * 2654435761) >>> 0) % 1000;
    out[key] = clampNumber(0.8 + (h / 1000) * 0.4, PERSONALITY_MIN, PERSONALITY_MAX, 1.0); // 0.8..1.2
  });
  return out;
}

// trait→multiplier helper: 1 + Σ weight*(trait-1), clamped.
function traitMultiplier(matrixRow = {}, traits = {}, min = 0.4, max = 2.2) {
  let multiplier = 1;
  for (const [trait, weight] of Object.entries(matrixRow)) {
    multiplier += Number(weight) * ((Number(traits[trait]) || 1) - 1);
  }
  return clampNumber(multiplier, min, max, 1);
}

export function needDriftMultipliers(personality = {}) {
  const traits = clampPersonality(personality);
  const out = {};
  for (const need of NEED_KEYS) {
    out[need] = traitMultiplier(TRAIT_NEED_DRIFT_MATRIX[need] || {}, traits);
  }
  return out;
}

export function categoryWeightMultipliers(personality = {}) {
  const traits = clampPersonality(personality);
  const out = {};
  for (const category of Object.keys(CATEGORY_NEED_MAP)) {
    out[category] = traitMultiplier(TRAIT_CATEGORY_WEIGHT_MATRIX[category] || {}, traits);
  }
  return out;
}

export function createNeedsState(nowMs = Date.now(), seedAgentId = '') {
  const seedBase = String(seedAgentId || 'agent').split('').reduce((sum, ch) => (sum * 33 + ch.charCodeAt(0)) >>> 0, 11);
  const needs = {};
  NEED_KEYS.forEach((key, index) => {
    const h = ((seedBase ^ (index + 3) * 40503) >>> 0) % 1000;
    needs[key] = clampNeedValue(15 + (h / 1000) * 45); // 15..60 staggered start
  });
  return { version: AGENT_NEEDS_VERSION, values: needs, lastUpdatedMs: nowMs, lastSatisfied: {} };
}

// Upgrade a v1 needs state (no hunger meter) in place.
export function migrateNeedsState(state, nowMs = Date.now()) {
  if (!state || !state.values) return state;
  if (state.values.hunger == null) state.values.hunger = clampNeedValue((state.values.thirst || 30) * 0.8);
  state.version = AGENT_NEEDS_VERSION;
  if (!state.lastSatisfied || typeof state.lastSatisfied !== 'object') state.lastSatisfied = {};
  state.lastUpdatedMs = state.lastUpdatedMs || nowMs;
  return state;
}

export function updateNeedsDrift(state, dtMs, context = {}) {
  if (!state || !state.values || !Number.isFinite(dtMs) || dtMs <= 0) return state;
  migrateNeedsState(state);
  const minutes = dtMs / 60000;
  const values = state.values;
  const driftMult = needDriftMultipliers(context.personality || {});
  values.thirst = clampNeedValue(values.thirst + NEED_DRIFT_PER_MINUTE.thirst * driftMult.thirst * minutes);
  values.hunger = clampNeedValue(values.hunger + NEED_DRIFT_PER_MINUTE.hunger * driftMult.hunger * minutes);
  const energyRate = (NEED_DRIFT_PER_MINUTE.energy + (context.moving ? ENERGY_MOVING_BONUS_PER_MINUTE : 0)) * driftMult.energy;
  values.energy = clampNeedValue(values.energy + energyRate * minutes);
  const socialRate = NEED_DRIFT_PER_MINUTE.social * driftMult.social - (context.nearAgents ? SOCIAL_NEAR_AGENTS_RELIEF_PER_MINUTE : 0);
  values.social = clampNeedValue(values.social + socialRate * minutes);
  values.boredom = clampNeedValue(values.boredom + NEED_DRIFT_PER_MINUTE.boredom * driftMult.boredom * minutes);
  state.lastUpdatedMs = (state.lastUpdatedMs || 0) + dtMs;
  return state;
}

export function needsForCategory(category) {
  return CATEGORY_NEED_MAP[String(category || '')]?.needs || null;
}

// Back-compat single-need lookup (primary need of a category).
export function needForCategory(category) {
  const needs = needsForCategory(category);
  return needs ? needs[0] : null;
}

export function satisfyNeeds(state, needs = [], { category = null, objectType = null, nowMs = Date.now() } = {}) {
  if (!state?.values || !needs?.length) return state;
  migrateNeedsState(state, nowMs);
  if (!state.lastSatisfied || typeof state.lastSatisfied !== 'object') state.lastSatisfied = {};
  for (const need of needs) {
    if (!NEED_KEYS.includes(need)) continue;
    state.values[need] = clampNeedValue(NEED_SATISFY_RESET[need]);
    state.lastSatisfied[need] = { category: category ? String(category) : null, objectType: objectType ? String(objectType) : null, atMs: nowMs };
  }
  return state;
}

// Satisfy by completed activity: per-object `satisfies` wins; category fallback.
export function satisfyNeedsForActivity(state, { category = null, objectType = null, item = null, nowMs = Date.now() } = {}) {
  const fromObject = resolveObjectSatisfies(objectType, item);
  const needs = fromObject || needsForCategory(category) || [];
  return satisfyNeeds(state, needs, { category, objectType, nowMs });
}

// Back-compat wrapper (category-only).
export function satisfyNeedForCategory(state, category, nowMs = Date.now()) {
  return satisfyNeedsForActivity(state, { category, nowMs });
}

// Weight table for the idle pulse roll:
// max(need levels served) × category scale × trait multiplier, with a floor.
export function needCategoryWeights(state, personality = {}, options = {}) {
  migrateNeedsState(state || {});
  const values = state?.values || {};
  const catMult = categoryWeightMultipliers(personality);
  const recent = options.recentCategories instanceof Set ? options.recentCategories : new Set(options.recentCategories || []);
  const weights = {};
  for (const [category, mapping] of Object.entries(CATEGORY_NEED_MAP)) {
    const level = Math.max(...mapping.needs.map(need => clampNeedValue(values[need])));
    let weight = Math.max(MIN_CATEGORY_WEIGHT, level * mapping.scale * (catMult[category] || 1));
    if (recent.has(category)) weight *= RECENT_CATEGORY_PENALTY;
    weights[category] = weight;
  }
  let workReturn = WORK_RETURN_BASE_WEIGHT;
  if (recent.has('work-return')) workReturn *= RECENT_CATEGORY_PENALTY;
  weights['work-return'] = workReturn;
  return weights;
}

export function chooseNeedDrivenCategory(state, personality = {}, options = {}) {
  const weights = needCategoryWeights(state, personality, options);
  const rand = typeof options.rand === 'function' ? options.rand : Math.random;
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!(total > 0)) return 'wander';
  let roll = rand() * total;
  for (const [category, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return category;
  }
  return entries[entries.length - 1][0];
}

// UI helpers ------------------------------------------------------------

export const NEED_LABELS = Object.freeze({
  thirst: Object.freeze({ label: 'Thirst', emoji: '💧', color: '#4fc3f7' }),
  hunger: Object.freeze({ label: 'Hunger', emoji: '🍕', color: '#ff8a65' }),
  energy: Object.freeze({ label: 'Energy', emoji: '⚡', color: '#ffb74d' }),
  social: Object.freeze({ label: 'Social', emoji: '💬', color: '#ba68c8' }),
  boredom: Object.freeze({ label: 'Boredom', emoji: '🎲', color: '#81c784' }),
});

export const TRAIT_LABELS = Object.freeze({
  outgoing: Object.freeze({ label: 'Outgoing', emoji: '💬', low: 'Reserved', high: 'Outgoing', hint: 'Seeks people — chats, gathers, joins games more; social need rises faster.' }),
  curious: Object.freeze({ label: 'Curious', emoji: '🔍', low: 'Routine-bound', high: 'Curious', hint: 'Explores — reads, browses, plays, wanders more; gets bored faster.' }),
  easygoing: Object.freeze({ label: 'Easygoing', emoji: '🛋️', low: 'Driven', high: 'Easygoing', hint: 'Relaxed — lounges and snacks more, takes life slower.' }),
});

export function dominantNeed(state) {
  migrateNeedsState(state || {});
  const values = state?.values || {};
  let best = null;
  for (const key of NEED_KEYS) {
    const level = clampNeedValue(values[key]);
    if (!best || level > best.level) best = { need: key, level };
  }
  return best;
}