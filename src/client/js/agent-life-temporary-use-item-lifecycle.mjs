/**
 * Agent Life temporary-use item lifecycle.
 *
 * Phase 0.5 technical spine for short-lived consumables and task props. This
 * module identifies temporary items, defines timeout/consume/drop-off cleanup
 * contracts, and produces side-effect-free cleanup plans so transient cups,
 * snacks, tickets, and carried props do not become stale persisted clutter.
 * Importing this module must not create meshes, mutate agents, delete objects,
 * persist buildings, or call APIs.
 */
import { normalizeObjectCatalogId } from './agent-life-object-catalog-schema.mjs';
import { CARRY_CLEANUP_REASONS, CARRY_DEFAULT_ATTACH_POINT } from './agent-life-carry-dropoff-foundation.mjs';

export const TEMPORARY_USE_ITEM_LIFECYCLE_VERSION = 'agent-life-temporary-use-item-lifecycle/v1';

export const TEMPORARY_USE_ITEM_KINDS = Object.freeze(['consumable', 'task-prop', 'ticket-token', 'single-use']);
export const TEMPORARY_USE_ITEM_STATES = Object.freeze([
  'available',
  'carried',
  'in_use',
  'placed',
  'dropped_off',
  'consumed',
  'expired',
  'cleanup_pending',
  'cleaned_up',
  'despawned',
]);
export const TEMPORARY_USE_ITEM_TERMINAL_STATES = Object.freeze(['consumed', 'cleaned_up', 'despawned']);
export const TEMPORARY_USE_ITEM_CLEANUP_REASONS = Object.freeze([
  'consume',
  'use-complete',
  'drop-off',
  'disposed',
  'ttl-expired',
  'agent-despawn',
  'object-despawn',
  'world-reload',
  'world-save',
  'cancelled',
]);
export const TEMPORARY_USE_ITEM_TIMEOUT_BUCKETS = Object.freeze(['availableTtlMs', 'carriedTtlMs', 'placedTtlMs', 'cleanupGraceMs']);
export const TEMPORARY_USE_ITEM_PERSISTENCE_MODES = Object.freeze(['transient-only', 'omit-on-save', 'persistable-if-promoted']);

export const TEMPORARY_USE_ITEM_DEFAULT_TIMEOUTS = Object.freeze({
  availableTtlMs: 5 * 60 * 1000,
  carriedTtlMs: 15 * 60 * 1000,
  placedTtlMs: 2 * 60 * 1000,
  cleanupGraceMs: 30 * 1000,
});

export const TEMPORARY_USE_ITEM_CONTRACT = Object.freeze([
  Object.freeze({ key: 'temporaryUse.temporary', required: true, meaning: 'True for items governed by this lifecycle. Temporary items default to transient-only persistence.' }),
  Object.freeze({ key: 'temporaryUse.state', required: true, meaning: 'Lifecycle state used to decide whether an item can be picked up, consumed, dropped off, timed out, or cleaned.' }),
  Object.freeze({ key: 'temporaryUse.expiresAt', required: true, meaning: 'ISO timeout timestamp derived from the state-specific TTL bucket; null only for terminal states.' }),
  Object.freeze({ key: 'temporaryUse.cleanup.reason', required: true, meaning: 'Explicit cleanup reason such as consume, drop-off, ttl-expired, despawn, reload, or world-save.' }),
  Object.freeze({ key: 'temporaryUse.persistence.mode', required: true, meaning: 'Temporary-use items are transient-only/omit-on-save unless a future promotion task intentionally marks them persistable.' }),
  Object.freeze({ key: 'temporaryUse.runtimeAdapters', required: true, meaning: 'Adapter notes for carry/drop-off state, object-instance persistence filters, world reload, and later renderer cleanup.' }),
]);

export const TEMPORARY_USE_ITEM_RULES = Object.freeze([
  'Temporary-use lifecycle is side-effect-free: importing this module must not create meshes, mutate agents, delete records, persist buildings, or call APIs.',
  'Temporary items are identified by temporaryUse.temporary, lifecycle.temporary, consumable flags, temporary-consumable catalog/category metadata, or known carry/drop-off temporary pickup records.',
  'Every non-terminal temporary item must have an expiresAt timestamp derived from the state-specific TTL bucket so abandoned carried or placed props can be cleaned deterministically.',
  'Consume/use-complete transitions end as consumed and request carry-state cleanup; drop-off transitions may create a short placed window but must remain omit-on-save transient clutter.',
  'World-save and world-reload must filter transient-only/omit-on-save items instead of serializing them into building furniture, world-meta decorations, or object-instance persistence.',
  'Cleanup plans are declarative. Runtime code may use them to clear carried flags, remove transient placements/meshes, and skip persistence, but this foundation does not perform those effects.',
]);

export const TEMPORARY_USE_ITEM_EXAMPLES = Object.freeze([
  Object.freeze({ id: 'temp-coffee-1', catalogId: 'temporaryFood', kind: 'consumable', label: 'Coffee', state: 'carried', temporaryUse: Object.freeze({ temporary: true, state: 'carried', expiresAt: '2026-04-28T00:15:00.000Z' }) }),
  Object.freeze({ id: 'temp-ticket-1', catalogId: 'temporaryFood', kind: 'ticket-token', label: 'Queue Ticket', state: 'available', temporaryUse: Object.freeze({ temporary: true, state: 'available', expiresAt: '2026-04-28T00:05:00.000Z' }) }),
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function stableId(value, fallback = 'temporary-use-item') {
  return asString(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function finiteNonNegative(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function dateMs(value, fallback = 0) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

function nowMs(value = null) {
  if (value === null || value === undefined) return 0;
  return dateMs(value, 0);
}

function normalizeState(value, fallback = 'available') {
  const raw = asString(value);
  return TEMPORARY_USE_ITEM_STATES.includes(raw) ? raw : fallback;
}

function normalizeReason(value, fallback = 'cancelled') {
  const raw = asString(value);
  return TEMPORARY_USE_ITEM_CLEANUP_REASONS.includes(raw) ? raw : fallback;
}

function normalizeKind(value, fallback = 'consumable') {
  const raw = asString(value);
  return TEMPORARY_USE_ITEM_KINDS.includes(raw) ? raw : fallback;
}

function normalizeTimeouts(timeouts = {}) {
  const raw = isRecord(timeouts) ? timeouts : {};
  return freezeDeep(Object.fromEntries(Object.entries(TEMPORARY_USE_ITEM_DEFAULT_TIMEOUTS).map(([key, fallback]) => [key, finiteNonNegative(raw[key], fallback)])));
}

function timeoutBucketForState(state) {
  if (state === 'carried' || state === 'in_use') return 'carriedTtlMs';
  if (state === 'placed' || state === 'dropped_off' || state === 'cleanup_pending') return 'placedTtlMs';
  if (TEMPORARY_USE_ITEM_TERMINAL_STATES.includes(state) || state === 'expired') return null;
  return 'availableTtlMs';
}

export function isTemporaryUseItem(item = {}) {
  const raw = isRecord(item) ? item : {};
  const catalogId = normalizeObjectCatalogId(raw.catalogId || raw.objectCatalogId || raw.type) || raw.catalogId || raw.type || null;
  const category = asString(raw.primaryCategory || raw.category || raw.temporaryUse?.category || raw.lifecycle?.category);
  const classifications = Array.isArray(raw.classifications) ? raw.classifications : [];
  return Boolean(
    raw.temporaryUse?.temporary === true
    || raw.lifecycle?.temporary === true
    || raw.temporary === true
    || raw.consumable === true
    || raw.cleanup?.temporary === true
    || catalogId === 'temporaryFood'
    || category === 'temporary-consumable'
    || classifications.includes('consumable')
  );
}

export function makeTemporaryUseItem(input = {}, { now = null, timeouts = {} } = {}) {
  const raw = isRecord(input) ? input : { id: input, label: input };
  const createdMs = dateMs(raw.createdAt || raw.temporaryUse?.createdAt || now, nowMs(now));
  const state = normalizeState(raw.state || raw.temporaryUse?.state || (raw.carriedItem ? 'carried' : 'available'));
  const normalizedTimeouts = normalizeTimeouts(timeouts || raw.temporaryUse?.timeouts);
  const bucket = timeoutBucketForState(state);
  const expiresAt = TEMPORARY_USE_ITEM_TERMINAL_STATES.includes(state)
    ? null
    : (raw.temporaryUse?.expiresAt || raw.expiresAt || (bucket ? isoFromMs(createdMs + normalizedTimeouts[bucket]) : null));
  const catalogId = normalizeObjectCatalogId(raw.catalogId || raw.objectCatalogId || raw.type) || raw.catalogId || 'temporaryFood';
  const kind = normalizeKind(raw.kind || raw.temporaryUse?.kind || (raw.consumable === false ? 'task-prop' : 'consumable'));

  return freezeDeep({
    id: stableId(raw.id || raw.instanceId || raw.objectInstanceId || `temp-${kind}`),
    objectInstanceId: raw.objectInstanceId || raw.instanceId || raw.id || null,
    catalogId,
    label: asString(raw.label || raw.name || kind) || 'Temporary item',
    kind,
    state,
    consumable: raw.consumable !== false,
    attachPoint: raw.attachPoint || CARRY_DEFAULT_ATTACH_POINT,
    temporaryUse: {
      temporary: true,
      kind,
      state,
      createdAt: isoFromMs(createdMs),
      updatedAt: raw.temporaryUse?.updatedAt || raw.updatedAt || isoFromMs(createdMs),
      expiresAt,
      timeouts: normalizedTimeouts,
      persistence: {
        mode: raw.temporaryUse?.persistence?.mode || raw.persistence?.mode || 'transient-only',
        persistable: raw.temporaryUse?.persistence?.persistable === true || raw.persistence?.persistable === true,
        omitOnSave: raw.temporaryUse?.persistence?.omitOnSave !== false,
        owner: raw.temporaryUse?.persistence?.owner || raw.persistence?.owner || 'runtime-transient',
      },
      cleanup: {
        required: ['consumed', 'expired', 'cleanup_pending', 'dropped_off'].includes(state),
        reason: raw.temporaryUse?.cleanup?.reason || raw.cleanupReason || null,
        terminalState: TEMPORARY_USE_ITEM_TERMINAL_STATES.includes(state),
      },
      runtimeAdapters: {
        carryCleanupReasons: CARRY_CLEANUP_REASONS,
        clearAgentFlags: Object.freeze(['carriedItem', '_carrying', '_droppingOff', 'carryItem', 'carryItemTimer']),
        removeTransientPlacement: true,
        persistenceFilter: 'omit temporaryUse.temporary records unless explicitly promoted',
      },
    },
  });
}

export function resolveTemporaryUseTimeout(item = {}, { now = null, timeouts = {} } = {}) {
  const normalized = makeTemporaryUseItem(item, { now, timeouts });
  const state = normalized.temporaryUse.state;
  const bucket = timeoutBucketForState(state);
  const currentMs = nowMs(now);
  const expiresMs = normalized.temporaryUse.expiresAt ? dateMs(normalized.temporaryUse.expiresAt, Infinity) : Infinity;
  return freezeDeep({
    item: normalized,
    state,
    bucket,
    expiresAt: normalized.temporaryUse.expiresAt,
    expired: Number.isFinite(expiresMs) && currentMs >= expiresMs,
    remainingMs: Number.isFinite(expiresMs) ? Math.max(0, expiresMs - currentMs) : null,
  });
}

export function shouldPersistTemporaryUseItem(item = {}) {
  const normalized = makeTemporaryUseItem(item);
  const persistence = normalized.temporaryUse.persistence;
  if (!isTemporaryUseItem(normalized)) return true;
  if (persistence.mode === 'persistable-if-promoted' && persistence.persistable === true) return true;
  return false;
}

export function makeTemporaryUseCleanupPlan(item = {}, { reason = 'use-complete', now = null } = {}) {
  const normalizedReason = normalizeReason(reason, 'cancelled');
  const normalized = makeTemporaryUseItem(item, { now });
  const finalState = normalizedReason === 'consume' || normalizedReason === 'use-complete'
    ? 'consumed'
    : (normalizedReason === 'ttl-expired' ? 'expired' : 'despawned');
  const cleanedAt = isoFromMs(nowMs(now));
  return freezeDeep({
    ok: true,
    reason: normalizedReason,
    item: normalized,
    finalItem: {
      ...normalized,
      state: finalState,
      temporaryUse: {
        ...normalized.temporaryUse,
        state: finalState,
        updatedAt: cleanedAt,
        expiresAt: null,
        cleanup: { required: true, reason: normalizedReason, terminalState: TEMPORARY_USE_ITEM_TERMINAL_STATES.includes(finalState) },
      },
    },
    effects: {
      clearCarryState: ['consume', 'use-complete', 'disposed', 'agent-despawn', 'object-despawn', 'world-reload', 'cancelled', 'ttl-expired'].includes(normalizedReason),
      removeTransientPlacement: true,
      removeTransientMesh: true,
      skipPersistence: !shouldPersistTemporaryUseItem(normalized),
      persistenceAction: shouldPersistTemporaryUseItem(normalized) ? 'allow-promoted-save' : 'omit-on-save',
    },
  });
}

export function planTemporaryUseTransition(item = {}, { event = 'use-complete', now = null } = {}) {
  const normalized = makeTemporaryUseItem(item, { now });
  const timeout = resolveTemporaryUseTimeout(normalized, { now });
  const eventReason = normalizeReason(event, null);
  const reason = timeout.expired ? 'ttl-expired' : (eventReason || (event === 'world-save' ? 'world-save' : 'cancelled'));
  if (reason === 'drop-off') {
    const dropped = makeTemporaryUseItem({ ...normalized, state: 'dropped_off' }, { now });
    return freezeDeep({ ok: true, action: 'drop-off', item: normalized, nextItem: dropped, cleanupPlan: makeTemporaryUseCleanupPlan(dropped, { reason: 'drop-off', now }) });
  }
  if (reason === 'world-save') {
    return freezeDeep({ ok: true, action: 'filter-from-persistence', item: normalized, nextItem: normalized, cleanupPlan: makeTemporaryUseCleanupPlan(normalized, { reason: 'world-save', now }) });
  }
  return freezeDeep({ ok: true, action: 'cleanup', item: normalized, nextItem: null, cleanupPlan: makeTemporaryUseCleanupPlan(normalized, { reason, now }) });
}

export function buildTemporaryUseItemLifecycle({ timeouts = {} } = {}) {
  const normalizedTimeouts = normalizeTimeouts(timeouts);
  return freezeDeep({
    version: TEMPORARY_USE_ITEM_LIFECYCLE_VERSION,
    kinds: TEMPORARY_USE_ITEM_KINDS,
    states: TEMPORARY_USE_ITEM_STATES,
    terminalStates: TEMPORARY_USE_ITEM_TERMINAL_STATES,
    cleanupReasons: TEMPORARY_USE_ITEM_CLEANUP_REASONS,
    timeoutBuckets: TEMPORARY_USE_ITEM_TIMEOUT_BUCKETS,
    defaultTimeouts: normalizedTimeouts,
    persistenceModes: TEMPORARY_USE_ITEM_PERSISTENCE_MODES,
    rules: TEMPORARY_USE_ITEM_RULES,
    isTemporaryUseItem,
    makeTemporaryUseItem(input, options = {}) { return makeTemporaryUseItem(input, { ...options, timeouts: options.timeouts || normalizedTimeouts }); },
    resolveTemporaryUseTimeout(input, options = {}) { return resolveTemporaryUseTimeout(input, { ...options, timeouts: options.timeouts || normalizedTimeouts }); },
    shouldPersistTemporaryUseItem,
    makeTemporaryUseCleanupPlan,
    planTemporaryUseTransition,
  });
}

export function validateTemporaryUseItemLifecycle(lifecycle) {
  const errors = [];
  if (!lifecycle || lifecycle.version !== TEMPORARY_USE_ITEM_LIFECYCLE_VERSION) errors.push('lifecycle.version must match TEMPORARY_USE_ITEM_LIFECYCLE_VERSION');
  for (const state of ['available', 'carried', 'placed', 'consumed', 'expired', 'despawned']) {
    if (!lifecycle?.states?.includes(state)) errors.push(`lifecycle.states must include ${state}`);
  }
  for (const reason of ['consume', 'drop-off', 'ttl-expired', 'world-save', 'world-reload']) {
    if (!lifecycle?.cleanupReasons?.includes(reason)) errors.push(`lifecycle.cleanupReasons must include ${reason}`);
  }
  if (typeof lifecycle?.isTemporaryUseItem !== 'function') errors.push('lifecycle.isTemporaryUseItem must be a function');
  if (typeof lifecycle?.makeTemporaryUseCleanupPlan !== 'function') errors.push('lifecycle.makeTemporaryUseCleanupPlan must be a function');
  if (typeof lifecycle?.planTemporaryUseTransition !== 'function') errors.push('lifecycle.planTemporaryUseTransition must be a function');
  return freezeDeep({ valid: errors.length === 0, errors });
}

export const TEMPORARY_USE_ITEM_LIFECYCLE = buildTemporaryUseItemLifecycle();
