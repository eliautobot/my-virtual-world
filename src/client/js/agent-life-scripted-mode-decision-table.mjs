/**
 * Phase 4 Agent Scripted Mode weighted decision table.
 *
 * This module is intentionally data-first and side-effect-free. It chooses a
 * high-level BehaviorCategory only; later Phase 4 tasks resolve that category
 * to objects/spots and route through AgentIntent/ObjectUse. Do not add movement,
 * pathfinding, reservation, or dynamic routing logic here.
 */

export const AGENT_SCRIPTED_MODE_DECISION_TABLE_VERSION = 'agent-life-scripted-mode-decision-table/v1';

export const SCRIPTED_BEHAVIOR_CATEGORIES = Object.freeze([
  'rest',
  'socialize',
  'snack-drink',
  'play',
  'browse-read',
  'work-return',
  'wander',
  'sleep-home',
]);

export const DEFAULT_SCRIPTED_CATEGORY_WEIGHTS = Object.freeze({
  rest: Object.freeze({ weight: 24, minWeight: 0, maxWeight: 44, label: 'Rest / soft seating' }),
  socialize: Object.freeze({ weight: 18, minWeight: 0, maxWeight: 38, label: 'Socialize / talk / gather' }),
  'snack-drink': Object.freeze({ weight: 12, minWeight: 0, maxWeight: 34, label: 'Snack or drink' }),
  play: Object.freeze({ weight: 8, minWeight: 0, maxWeight: 28, label: 'Play / exercise / game' }),
  'browse-read': Object.freeze({ weight: 10, minWeight: 0, maxWeight: 30, label: 'Browse / read / inspect' }),
  // Capped so Scripted Mode can return to a desk/work anchor without desk loops dominating.
  'work-return': Object.freeze({ weight: 6, minWeight: 0, maxWeight: 9, label: 'Return to assigned desk or work anchor', capped: true }),
  wander: Object.freeze({ weight: 14, minWeight: 0, maxWeight: 36, label: 'Wander / stroll / safe point' }),
  'sleep-home': Object.freeze({ weight: 4, minWeight: 0, maxWeight: 60, label: 'Sleep or go home' }),
});

export const DEFAULT_SCRIPTED_TIMER_CONFIG = Object.freeze({
  rest: Object.freeze({ minDurationMs: 45000, maxDurationMs: 180000, cooldownMs: 90000 }),
  socialize: Object.freeze({ minDurationMs: 30000, maxDurationMs: 150000, cooldownMs: 60000 }),
  'snack-drink': Object.freeze({ minDurationMs: 25000, maxDurationMs: 90000, cooldownMs: 120000 }),
  play: Object.freeze({ minDurationMs: 60000, maxDurationMs: 240000, cooldownMs: 180000 }),
  'browse-read': Object.freeze({ minDurationMs: 35000, maxDurationMs: 150000, cooldownMs: 90000 }),
  'work-return': Object.freeze({ minDurationMs: 120000, maxDurationMs: 420000, cooldownMs: 60000 }),
  wander: Object.freeze({ minDurationMs: 20000, maxDurationMs: 90000, cooldownMs: 45000 }),
  'sleep-home': Object.freeze({ minDurationMs: 300000, maxDurationMs: 900000, cooldownMs: 240000 }),
});

export const DEFAULT_SCRIPTED_TIME_OF_DAY_MODIFIERS = Object.freeze([
  Object.freeze({
    id: 'work-window-day',
    window: 'work',
    startMinute: 9 * 60,
    endMinute: 17 * 60,
    modifiers: Object.freeze({ 'work-return': Object.freeze({ multiplier: 1.45, cap: 9 }), rest: Object.freeze({ multiplier: 1.12 }), socialize: Object.freeze({ multiplier: 1.08 }), wander: Object.freeze({ multiplier: 0.75 }), play: Object.freeze({ multiplier: 0.55 }) }),
  }),
  Object.freeze({
    id: 'social-window-evening',
    window: 'social',
    startMinute: 17 * 60,
    endMinute: 21 * 60,
    modifiers: Object.freeze({ rest: Object.freeze({ multiplier: 1.25 }), socialize: Object.freeze({ multiplier: 1.85 }), play: Object.freeze({ multiplier: 1.35 }), 'snack-drink': Object.freeze({ multiplier: 1.2 }), 'work-return': Object.freeze({ multiplier: 0.45, cap: 5 }) }),
  }),
  Object.freeze({
    id: 'sleep-window-night',
    window: 'sleep',
    startMinute: 22 * 60,
    endMinute: 6 * 60,
    modifiers: Object.freeze({ 'sleep-home': Object.freeze({ multiplier: 7.5 }), rest: Object.freeze({ multiplier: 1.5 }), socialize: Object.freeze({ multiplier: 0.25 }), 'snack-drink': Object.freeze({ multiplier: 0.35 }), play: Object.freeze({ multiplier: 0.2 }), 'work-return': Object.freeze({ multiplier: 0.2, cap: 4 }), wander: Object.freeze({ multiplier: 0.35 }) }),
  }),
]);

export const DEFAULT_SCRIPTED_RECENCY_COOLDOWN_MODIFIERS = Object.freeze({
  category: Object.freeze({
    withinMs: 180000,
    multiplier: 0.22,
    minimumWeight: 0,
    reason: 'recently-used-category',
  }),
  object: Object.freeze({
    withinMs: 240000,
    multiplier: 0.35,
    reason: 'recently-used-object',
  }),
});

export const DEFAULT_SCRIPTED_PREFERENCE_MODIFIERS = Object.freeze({
  categoryBonus: 5,
  categoryAvoidPenalty: 8,
  reason: 'agent-category-preference',
});

export const DEFAULT_AGENT_SCRIPTED_MODE_DECISION_CONFIG = Object.freeze({
  behaviorSourceKind: 'agent-scripted-mode',
  behaviorMode: 'agent-scripted',
  behaviorAuthority: 300,
  categories: SCRIPTED_BEHAVIOR_CATEGORIES,
  categoryWeights: DEFAULT_SCRIPTED_CATEGORY_WEIGHTS,
  timers: DEFAULT_SCRIPTED_TIMER_CONFIG,
  timeOfDayModifiers: DEFAULT_SCRIPTED_TIME_OF_DAY_MODIFIERS,
  recencyCooldownModifiers: DEFAULT_SCRIPTED_RECENCY_COOLDOWN_MODIFIERS,
  preferenceModifiers: DEFAULT_SCRIPTED_PREFERENCE_MODIFIERS,
});

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  const n = finiteNumber(value, min);
  return Math.max(min, Math.min(max, n));
}

function normalizeMinuteOfDay(value = null, fallbackDate = null) {
  if (value !== null && value !== undefined) {
    const raw = finiteNumber(value, 0);
    return ((Math.floor(raw) % 1440) + 1440) % 1440;
  }
  const date = fallbackDate instanceof Date ? fallbackDate : new Date();
  return date.getHours() * 60 + date.getMinutes();
}

function minuteInWindow(minute, startMinute, endMinute) {
  const start = normalizeMinuteOfDay(startMinute, null);
  const end = normalizeMinuteOfDay(endMinute, null);
  const value = normalizeMinuteOfDay(minute, null);
  if (start === end) return true;
  return start < end ? value >= start && value < end : value >= start || value < end;
}

function stableRecentList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.entries()].map(([key, lastUsedAtMs]) => ({ key, lastUsedAtMs }));
  if (typeof value === 'object') return Object.entries(value).map(([key, lastUsedAtMs]) => ({ key, lastUsedAtMs }));
  return [];
}

function recentAgeMs(entry, nowMs) {
  const lastUsedAtMs = finiteNumber(entry.lastUsedAtMs ?? entry.atMs ?? entry.timeMs ?? entry[1], NaN);
  if (Number.isFinite(lastUsedAtMs)) return Math.max(0, nowMs - lastUsedAtMs);
  const ageMs = finiteNumber(entry.ageMs ?? entry.elapsedMs, NaN);
  return Number.isFinite(ageMs) ? Math.max(0, ageMs) : Infinity;
}

function categoryEntryMatches(entry, category) {
  return String(entry.category ?? entry.key ?? entry[0] ?? '') === category;
}

function objectEntryMatches(entry, objectId) {
  if (!objectId) return false;
  return String(entry.objectId ?? entry.id ?? entry.key ?? entry[0] ?? '') === String(objectId);
}

function categoryPreferenceSet(value) {
  if (!value) return new Set();
  const list = Array.isArray(value) ? value : stableRecentList(value);
  return new Set(list.map(entry => {
    if (typeof entry === 'string') return entry;
    return String(entry.category ?? entry.key ?? entry[0] ?? entry ?? '');
  }).filter(Boolean));
}

export function getActiveScriptedTimeOfDayModifiers({ minuteOfDay = null, now = null, config = DEFAULT_AGENT_SCRIPTED_MODE_DECISION_CONFIG } = {}) {
  const minute = normalizeMinuteOfDay(minuteOfDay, now instanceof Date ? now : null);
  return (config.timeOfDayModifiers || [])
    .filter(modifier => minuteInWindow(minute, modifier.startMinute, modifier.endMinute))
    .map(modifier => ({ ...modifier, minuteOfDay: minute }));
}

export function buildScriptedBehaviorWeightedTable({
  config = DEFAULT_AGENT_SCRIPTED_MODE_DECISION_CONFIG,
  minuteOfDay = null,
  now = null,
  nowMs = Date.now(),
  availableCategories = null,
  recentCategories = null,
  recentObjects = null,
  candidateObjectByCategory = null,
  preferences = null,
} = {}) {
  const allowed = new Set(availableCategories || config.categories || SCRIPTED_BEHAVIOR_CATEGORIES);
  const activeTimeModifiers = getActiveScriptedTimeOfDayModifiers({ minuteOfDay, now, config });
  const categoryCooldown = config.recencyCooldownModifiers?.category || {};
  const objectCooldown = config.recencyCooldownModifiers?.object || {};
  const recentCategoryEntries = stableRecentList(recentCategories);
  const recentObjectEntries = stableRecentList(recentObjects);
  const preferredCategories = categoryPreferenceSet(preferences?.preferredCategories || preferences?.categories);
  const avoidedCategories = categoryPreferenceSet(preferences?.avoidCategories || preferences?.avoidedCategories);
  const preferenceConfig = config.preferenceModifiers || DEFAULT_SCRIPTED_PREFERENCE_MODIFIERS;

  let totalWeight = 0;
  const entries = (config.categories || SCRIPTED_BEHAVIOR_CATEGORIES)
    .filter(category => allowed.has(category))
    .map(category => {
      const base = config.categoryWeights?.[category] || { weight: 0 };
      let weight = finiteNumber(base.weight, 0);
      const appliedModifiers = [];
      const categoryCap = finiteNumber(base.maxWeight, Infinity);
      const minWeight = finiteNumber(base.minWeight, 0);

      for (const modifier of activeTimeModifiers) {
        const categoryModifier = modifier.modifiers?.[category];
        if (!categoryModifier) continue;
        const before = weight;
        if (categoryModifier.multiplier !== undefined) weight *= finiteNumber(categoryModifier.multiplier, 1);
        if (categoryModifier.add !== undefined) weight += finiteNumber(categoryModifier.add, 0);
        const modifierCap = categoryModifier.cap !== undefined ? finiteNumber(categoryModifier.cap, categoryCap) : categoryCap;
        weight = Math.min(weight, modifierCap);
        appliedModifiers.push({ type: 'time-of-day', id: modifier.id, window: modifier.window, before, after: weight });
      }

      if (preferredCategories.has(category)) {
        const before = weight;
        weight += finiteNumber(preferenceConfig.categoryBonus, 0);
        appliedModifiers.push({ type: 'preference-category', reason: preferenceConfig.reason || 'agent-category-preference', before, after: weight });
      }

      if (avoidedCategories.has(category)) {
        const before = weight;
        weight -= finiteNumber(preferenceConfig.categoryAvoidPenalty, 0);
        appliedModifiers.push({ type: 'preference-category-avoid', reason: 'agent-category-avoidance', before, after: weight });
      }

      const recentCategory = recentCategoryEntries.find(entry => categoryEntryMatches(entry, category) && recentAgeMs(entry, nowMs) <= finiteNumber(categoryCooldown.withinMs, 0));
      if (recentCategory) {
        const before = weight;
        weight *= finiteNumber(categoryCooldown.multiplier, 1);
        weight = Math.max(finiteNumber(categoryCooldown.minimumWeight, 0), weight);
        appliedModifiers.push({ type: 'recency-category', reason: categoryCooldown.reason || 'recently-used-category', ageMs: recentAgeMs(recentCategory, nowMs), before, after: weight });
      }

      const candidateObject = candidateObjectByCategory?.[category] || null;
      const objectId = candidateObject?.objectId || candidateObject?.id || null;
      const recentObject = recentObjectEntries.find(entry => objectEntryMatches(entry, objectId) && recentAgeMs(entry, nowMs) <= finiteNumber(objectCooldown.withinMs, 0));
      if (recentObject) {
        const before = weight;
        weight *= finiteNumber(objectCooldown.multiplier, 1);
        appliedModifiers.push({ type: 'recency-object', reason: objectCooldown.reason || 'recently-used-object', objectId, ageMs: recentAgeMs(recentObject, nowMs), before, after: weight });
      }

      weight = clamp(weight, minWeight, categoryCap);
      const normalized = { category, baseWeight: finiteNumber(base.weight, 0), weight, minWeight, maxWeight: Number.isFinite(categoryCap) ? categoryCap : null, capped: Boolean(base.capped), label: base.label || category, appliedModifiers };
      totalWeight += weight;
      return normalized;
    });

  return Object.freeze({
    entries: Object.freeze(entries.map(entry => Object.freeze({ ...entry, appliedModifiers: Object.freeze(entry.appliedModifiers.map(item => Object.freeze(item))) }))),
    totalWeight,
    activeTimeModifiers: Object.freeze(activeTimeModifiers.map(modifier => Object.freeze({ id: modifier.id, window: modifier.window, minuteOfDay: modifier.minuteOfDay }))),
  });
}

export function selectScriptedBehaviorCategory({
  config = DEFAULT_AGENT_SCRIPTED_MODE_DECISION_CONFIG,
  roll = null,
  durationRoll = null,
  random = Math.random,
  now = null,
  minuteOfDay = null,
  nowMs = Date.now(),
  availableCategories = null,
  recentCategories = null,
  recentObjects = null,
  candidateObjectByCategory = null,
  preferences = null,
} = {}) {
  const weightedTable = buildScriptedBehaviorWeightedTable({ config, minuteOfDay, now, nowMs, availableCategories, recentCategories, recentObjects, candidateObjectByCategory, preferences });
  const probabilityRoll = clamp(roll ?? random(), 0, 0.999999999);
  const totalWeight = weightedTable.totalWeight;
  const weightedRoll = totalWeight > 0 ? probabilityRoll * totalWeight : 0;
  let cursor = 0;
  let selected = null;

  for (const entry of weightedTable.entries) {
    cursor += entry.weight;
    if (!selected && weightedRoll < cursor && entry.weight > 0) selected = entry;
  }
  if (!selected) selected = weightedTable.entries.find(entry => entry.weight > 0) || weightedTable.entries[0] || null;

  const category = selected?.category || null;
  const timer = category ? config.timers?.[category] : null;
  const minDurationMs = finiteNumber(timer?.minDurationMs, 0);
  const maxDurationMs = Math.max(minDurationMs, finiteNumber(timer?.maxDurationMs, minDurationMs));
  const durationProbabilityRoll = clamp(durationRoll ?? random(), 0, 0.999999999);
  const selectedDurationMs = Math.round(minDurationMs + (maxDurationMs - minDurationMs) * durationProbabilityRoll);

  return Object.freeze({
    selectedCategory: category,
    category,
    durationMs: selectedDurationMs,
    timer: timer ? Object.freeze({ ...timer }) : null,
    behaviorSourceKind: config.behaviorSourceKind,
    behaviorMode: config.behaviorMode,
    behaviorAuthority: config.behaviorAuthority,
    behaviorProbabilityRoll: Object.freeze({
      roll: probabilityRoll,
      weightedRoll,
      totalWeight,
      durationRoll: durationProbabilityRoll,
      tableVersion: AGENT_SCRIPTED_MODE_DECISION_TABLE_VERSION,
    }),
    debug: Object.freeze({
      selectedCategory: category,
      selectedEntry: selected ? Object.freeze({ ...selected, appliedModifiers: Object.freeze([...(selected.appliedModifiers || [])]) }) : null,
      weightedEntries: weightedTable.entries,
      activeTimeModifiers: weightedTable.activeTimeModifiers,
      fallbackReason: totalWeight > 0 ? null : 'no-positive-scripted-category-weight',
      deterministic: roll !== null || durationRoll !== null,
    }),
  });
}
