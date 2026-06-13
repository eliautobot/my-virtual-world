/**
 * Agent Life carry/drop-off foundation.
 *
 * Phase 0.5 technical spine for pickup objects. It defines the shared contract
 * for right-hand attachment, carried-item state, one-item limits, valid drop-off
 * surfaces, placement records, consume/use cleanup, and despawn/reload cleanup.
 * Importing this module must not create meshes, move agents, reserve/drop items,
 * mutate runtime agent state, despawn objects, persist buildings, or call APIs.
 */
import { normalizeObjectCatalogId } from './agent-life-object-catalog-schema.mjs';
import { ACTION_LOCATION_REGISTRY, buildActionLocationRegistry } from './agent-life-action-location-registry.mjs';

export const CARRY_DROPOFF_FOUNDATION_VERSION = 'agent-life-carry-dropoff-foundation/v1';

export const CARRY_ATTACH_POINTS = Object.freeze(['right-hand']);
export const CARRY_ITEM_STATES = Object.freeze(['available', 'carried', 'placed', 'consuming', 'consumed', 'despawned']);
export const CARRY_CLEANUP_REASONS = Object.freeze(['consume', 'use-complete', 'drop-off', 'agent-despawn', 'object-despawn', 'world-reload', 'cancelled']);
export const CARRY_DROPOFF_SURFACE_KINDS = Object.freeze(['desk', 'table', 'counter']);
export const CARRY_PLACEMENT_COORDINATE_SPACES = Object.freeze(['agent-local', 'object-local', 'building-local', 'world']);
export const CARRY_DEFAULT_ATTACH_POINT = 'right-hand';
export const CARRY_ONE_ITEM_LIMIT = 1;

export const CARRY_DROPOFF_SURFACE_CATALOG_IDS = Object.freeze({
  desk: Object.freeze(['desk', 'receptionDesk']),
  table: Object.freeze(['diningTable', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'patioTable', 'meetingTable', 'sideTable']),
  counter: Object.freeze(['counter', 'kitchenIsland', 'cafeCounter', 'coffeePickupShelf', 'kitchenCounter']),
});

export const CARRY_DROPOFF_FOUNDATION_CONTRACT = Object.freeze([
  Object.freeze({ key: 'pickupObject.id', required: true, meaning: 'Stable carried/pickup item id. Runtime may map legacy VO carryItem strings such as coffee/water/snack/food into this shape.' }),
  Object.freeze({ key: 'pickupObject.attachPoint', required: true, meaning: 'Attachment socket. Phase 0.5 only supports right-hand so animations/renderers have one canonical hand target.' }),
  Object.freeze({ key: 'agentCarryState.carriedItem', required: true, meaning: 'Nullable carried-item record on the agent. Non-null means the agent is at the one-item limit.' }),
  Object.freeze({ key: 'agentCarryState.maxItems', required: true, meaning: 'Hard one-item limit for this foundation. Pickup attempts while carrying are blocked with already_carrying.' }),
  Object.freeze({ key: 'dropOffTarget.surfaceKind', required: true, meaning: 'Placement surface kind normalized to desk/table/counter from catalog id, furniture type, explicit surface, or drop-off action-location role.' }),
  Object.freeze({ key: 'placement.position', required: true, meaning: 'Resolved target position for desk/table/counter placement. Uses drop-off action location when present, otherwise safe top/center surface fallback metadata.' }),
  Object.freeze({ key: 'cleanup.reason', required: true, meaning: 'Consume/use/despawn/reload cleanup reason that clears carried state and marks temporary items consumed/despawned without leaking ghost state.' }),
  Object.freeze({ key: 'runtimeAdapters', required: true, meaning: 'Current/future consumers: vo-engine carryItem strings, main3d agent flags, action-location drop-off spots, and future object-instance persistence.' }),
]);

export const CARRY_DROPOFF_FOUNDATION_RULES = Object.freeze([
  'Carry/drop-off is metadata-first and side-effect-free: importing this module must not attach meshes, mutate agents, place objects, reserve spots, despawn items, persist buildings, or call APIs.',
  'Only one carried item is allowed per agent in Phase 0.5; callers must block pickup when agentCarryState.carriedItem is non-null.',
  'The canonical attachment point is right-hand. Renderers may adapt it to current hand bones/offsets, but action/state contracts should not invent left-hand or backpack slots yet.',
  'Valid drop-off surfaces are desk, table, and counter. A target can qualify by explicit surfaceKind, normalized catalog id/type, or a resolved action-location with the drop-off role.',
  'Desk/table/counter placement should prefer a drop-off action-location when one exists; otherwise use a stable surface-center fallback so later runtime code has deterministic placement metadata.',
  'Consume/use cleanup clears carried-item state and marks temporary consumables consumed. Drop-off cleanup clears agent carry state and returns a placed-item record for later persistence/rendering.',
  'Despawn/reload cleanup is explicit: temporary carried/placed pickup objects must clear agent flags, right-hand attachment state, and transient placement records before reload completes.',
]);

export const CARRY_PICKUP_OBJECT_EXAMPLES = Object.freeze([
  Object.freeze({ id: 'pickup-coffee-1', catalogId: 'temporaryFood', label: 'Coffee', kind: 'drink', attachPoint: 'right-hand', state: 'available', consumable: true, quantity: 1 }),
  Object.freeze({ id: 'pickup-water-1', catalogId: 'temporaryFood', label: 'Water', kind: 'drink', attachPoint: 'right-hand', state: 'available', consumable: true, quantity: 1 }),
  Object.freeze({ id: 'pickup-snack-1', catalogId: 'temporaryFood', label: 'Snack', kind: 'food', attachPoint: 'right-hand', state: 'available', consumable: true, quantity: 1 }),
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

function stableId(value, fallback = 'pickup-item') {
  return asString(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowIso(value) {
  return asString(value) || new Date(0).toISOString();
}

function allSurfaceCatalogIds() {
  return new Map(Object.entries(CARRY_DROPOFF_SURFACE_CATALOG_IDS).flatMap(([surfaceKind, ids]) => ids.map(id => [id, surfaceKind])));
}

function normalizeSurfaceKind(value) {
  const raw = asString(value);
  if (CARRY_DROPOFF_SURFACE_KINDS.includes(raw)) return raw;
  const normalized = normalizeObjectCatalogId(raw) || raw;
  return allSurfaceCatalogIds().get(normalized) || null;
}

function normalizePickupObject(input = {}, { now = null } = {}) {
  const raw = isRecord(input) ? input : { id: input, label: input };
  const legacyKind = asString(raw.kind || raw.itemKind || raw.carryItem || raw.type || raw.catalogId || 'item');
  const id = stableId(raw.id || raw.instanceId || raw.objectInstanceId || `pickup-${legacyKind}`);
  const catalogId = normalizeObjectCatalogId(raw.catalogId || raw.objectCatalogId || raw.type) || raw.catalogId || 'temporaryFood';
  const attachPoint = CARRY_ATTACH_POINTS.includes(raw.attachPoint) ? raw.attachPoint : CARRY_DEFAULT_ATTACH_POINT;
  const state = CARRY_ITEM_STATES.includes(raw.state) ? raw.state : 'available';
  return freezeDeep({
    id,
    objectInstanceId: raw.objectInstanceId || raw.instanceId || id,
    catalogId,
    label: asString(raw.label || raw.name || legacyKind) || 'Pickup item',
    kind: legacyKind,
    attachPoint,
    state,
    consumable: raw.consumable !== false,
    quantity: Math.max(1, Math.floor(finiteNumber(raw.quantity, 1))),
    pickedUpAt: raw.pickedUpAt || null,
    placedAt: raw.placedAt || null,
    cleanup: Object.freeze({ reasons: CARRY_CLEANUP_REASONS, temporary: raw.temporary !== false, createdAt: nowIso(raw.createdAt || now) }),
    runtimeAdapters: Object.freeze({ legacyCarryItem: raw.carryItem || null, currentFlags: Object.freeze(['agent._carrying', 'agent.carriedItem']), renderSocket: 'right-hand' }),
  });
}

export function normalizeAgentCarryState(agent = {}) {
  const raw = isRecord(agent) ? agent : {};
  const carriedSource = raw.carriedItem || raw.carry?.carriedItem || raw.carryState?.carriedItem || raw._carriedItem || null;
  const legacyCarryItem = !carriedSource && asString(raw.carryItem) ? { id: `legacy-${raw.carryItem}`, label: raw.carryItem, kind: raw.carryItem, carryItem: raw.carryItem } : null;
  const carriedItem = carriedSource || legacyCarryItem ? normalizePickupObject(carriedSource || legacyCarryItem) : null;
  return freezeDeep({
    agentId: raw.agentId || raw.id || raw.name || 'agent-unassigned',
    attachPoint: CARRY_DEFAULT_ATTACH_POINT,
    maxItems: CARRY_ONE_ITEM_LIMIT,
    carriedItem,
    isCarrying: Boolean(carriedItem || raw._carrying || raw.isCarrying),
    runtimeAdapters: Object.freeze({ legacyCarryItem: raw.carryItem || null, currentFlags: Object.freeze(['agent._carrying', 'agent.carriedItem']) }),
  });
}

export function canPickupObject(agent = {}, pickupObject = {}) {
  const carryState = normalizeAgentCarryState(agent);
  const item = normalizePickupObject(pickupObject);
  if (carryState.carriedItem) return freezeDeep({ ok: false, reason: 'already_carrying', carryState, item });
  if (item.attachPoint !== CARRY_DEFAULT_ATTACH_POINT) return freezeDeep({ ok: false, reason: 'unsupported_attach_point', carryState, item });
  if (!['available', 'placed'].includes(item.state)) return freezeDeep({ ok: false, reason: 'item_not_available', carryState, item });
  return freezeDeep({ ok: true, reason: null, carryState, item });
}

export function makeCarriedItemState(agent = {}, pickupObject = {}, { now = null } = {}) {
  const decision = canPickupObject(agent, pickupObject);
  if (!decision.ok) return freezeDeep({ ok: false, reason: decision.reason, carryState: decision.carryState, agentPatch: null });
  const carriedItem = freezeDeep({ ...decision.item, state: 'carried', pickedUpAt: nowIso(now), placedAt: null });
  return freezeDeep({
    ok: true,
    reason: null,
    carryState: { ...decision.carryState, carriedItem, isCarrying: true },
    agentPatch: Object.freeze({ carriedItem, _carrying: true, _droppingOff: false, carryItem: carriedItem.kind }),
  });
}

export function resolveDropOffSurface(target = {}, { registry = ACTION_LOCATION_REGISTRY } = {}) {
  const raw = isRecord(target) ? target : {};
  const catalogId = normalizeObjectCatalogId(raw.catalogId || raw.objectCatalogId || raw.type || raw.furnitureType || raw.assetId) || raw.catalogId || raw.type || null;
  const explicitSurface = normalizeSurfaceKind(raw.surfaceKind || raw.surface || raw.placementSurface);
  const catalogSurface = normalizeSurfaceKind(catalogId);
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const dropLocation = raw.actionLocation?.roles?.includes?.('drop-off') ? raw.actionLocation : locations.find(location => location?.roles?.includes?.('drop-off'));
  const registryProfile = catalogId && registry?.get ? registry.get(catalogId) : null;
  const registryDropLocation = registryProfile?.locations?.find(location => location.roles.includes('drop-off')) || null;
  const surfaceKind = explicitSurface || catalogSurface || (dropLocation || registryDropLocation ? 'counter' : null);
  return freezeDeep({
    ok: Boolean(surfaceKind),
    surfaceKind,
    catalogId,
    actionLocation: dropLocation || registryDropLocation || null,
    reason: surfaceKind ? null : 'unsupported_dropoff_surface',
  });
}

export function isValidDropOffTarget(target = {}, options = {}) {
  return resolveDropOffSurface(target, options).ok;
}

export function resolveDropOffPlacement({ target = {}, carriedItem = null, registry = ACTION_LOCATION_REGISTRY, now = null } = {}) {
  const surface = resolveDropOffSurface(target, { registry });
  if (!surface.ok) return freezeDeep({ ok: false, reason: surface.reason, surface, placement: null });
  const raw = isRecord(target) ? target : {};
  const item = carriedItem ? normalizePickupObject(carriedItem) : null;
  const actionLocation = surface.actionLocation;
  const targetBase = raw.position || raw.buildingLocal || Object.freeze({ x: finiteNumber(raw.x, 0), z: finiteNumber(raw.z, 0), y: finiteNumber(raw.y, 0) });
  const offset = actionLocation?.offset || null;
  const actionLocationPosition = actionLocation?.position || actionLocation?.buildingLocal || (offset ? Object.freeze({
    x: Number((finiteNumber(targetBase.x, 0) + finiteNumber(offset.x, 0)).toFixed(6)),
    z: Number((finiteNumber(targetBase.z, 0) + finiteNumber(offset.z, 0)).toFixed(6)),
    y: finiteNumber(targetBase.y, 0),
  }) : null);
  const position = actionLocationPosition || targetBase;
  const coordinateSpace = CARRY_PLACEMENT_COORDINATE_SPACES.includes(actionLocation?.coordinateSpace) ? actionLocation.coordinateSpace : (raw.coordinateSpace || 'building-local');
  return freezeDeep({
    ok: true,
    reason: null,
    surface,
    placement: Object.freeze({
      id: stableId(`${item?.id || 'item'}-${raw.id || raw.objectInstanceId || surface.catalogId || surface.surfaceKind}-placement`),
      itemId: item?.id || null,
      objectInstanceId: item?.objectInstanceId || null,
      targetId: raw.id || raw.objectInstanceId || raw.instanceId || null,
      targetCatalogId: surface.catalogId,
      surfaceKind: surface.surfaceKind,
      actionLocationId: actionLocation?.id || null,
      attachPoint: CARRY_DEFAULT_ATTACH_POINT,
      coordinateSpace,
      position: Object.freeze({ x: finiteNumber(position.x, 0), z: finiteNumber(position.z, 0), y: finiteNumber(position.y, 0) }),
      floor: Math.max(1, Math.floor(finiteNumber(actionLocation?.floor ?? raw.floor ?? raw.buildingFloor, 1))),
      state: 'placed',
      placedAt: nowIso(now),
      cleanup: Object.freeze({ onConsume: true, onUseComplete: true, onDespawn: true, onReload: true }),
    }),
  });
}

export function makeDropOffResult(agent = {}, target = {}, { registry = ACTION_LOCATION_REGISTRY, now = null } = {}) {
  const carryState = normalizeAgentCarryState(agent);
  if (!carryState.carriedItem) return freezeDeep({ ok: false, reason: 'not_carrying', carryState, placement: null, agentPatch: null });
  const placement = resolveDropOffPlacement({ target, carriedItem: carryState.carriedItem, registry, now });
  if (!placement.ok) return freezeDeep({ ok: false, reason: placement.reason, carryState, placement: null, agentPatch: null });
  const placedItem = freezeDeep({ ...carryState.carriedItem, state: 'placed', placedAt: placement.placement.placedAt });
  return freezeDeep({
    ok: true,
    reason: null,
    carryState: { ...carryState, carriedItem: null, isCarrying: false },
    placement: { ...placement.placement, item: placedItem },
    agentPatch: Object.freeze({ carriedItem: null, _carrying: false, _droppingOff: false, carryItem: null }),
  });
}

export function makeCarryCleanupResult(agent = {}, { reason = 'use-complete', now = null } = {}) {
  const normalizedReason = CARRY_CLEANUP_REASONS.includes(reason) ? reason : 'cancelled';
  const carryState = normalizeAgentCarryState(agent);
  const cleanedItem = carryState.carriedItem ? freezeDeep({ ...carryState.carriedItem, state: normalizedReason === 'consume' || normalizedReason === 'use-complete' ? 'consumed' : 'despawned', cleanedAt: nowIso(now), cleanupReason: normalizedReason }) : null;
  return freezeDeep({
    ok: true,
    reason: normalizedReason,
    cleanedItem,
    carryState: { ...carryState, carriedItem: null, isCarrying: false },
    agentPatch: Object.freeze({ carriedItem: null, _carrying: false, _droppingOff: false, carryItem: null, carryItemTimer: 0 }),
  });
}

export function cleanupCarryStateForDespawnOrReload(agent = {}, { reason = 'world-reload', now = null } = {}) {
  const cleanupReason = reason === 'agent-despawn' || reason === 'object-despawn' ? reason : 'world-reload';
  return makeCarryCleanupResult(agent, { reason: cleanupReason, now });
}

export function buildCarryDropoffFoundation({ actionSpots = {}, interactionSpots = {}, registry = null } = {}) {
  const resolvedRegistry = registry || buildActionLocationRegistry({ actionSpots, interactionSpots });
  return freezeDeep({
    version: CARRY_DROPOFF_FOUNDATION_VERSION,
    attachPoints: CARRY_ATTACH_POINTS,
    states: CARRY_ITEM_STATES,
    oneItemLimit: CARRY_ONE_ITEM_LIMIT,
    surfaceCatalogIds: CARRY_DROPOFF_SURFACE_CATALOG_IDS,
    rules: CARRY_DROPOFF_FOUNDATION_RULES,
    registry: resolvedRegistry,
    canPickupObject,
    normalizeAgentCarryState,
    resolveDropOffSurface(target) { return resolveDropOffSurface(target, { registry: resolvedRegistry }); },
    isValidDropOffTarget(target) { return isValidDropOffTarget(target, { registry: resolvedRegistry }); },
    resolveDropOffPlacement(args = {}) { return resolveDropOffPlacement({ ...args, registry: resolvedRegistry }); },
    makeDropOffResult(agent, target, options = {}) { return makeDropOffResult(agent, target, { ...options, registry: resolvedRegistry }); },
    makeCarryCleanupResult,
    cleanupCarryStateForDespawnOrReload,
  });
}

export function validateCarryDropoffFoundation(foundation) {
  const errors = [];
  if (!foundation || foundation.version !== CARRY_DROPOFF_FOUNDATION_VERSION) errors.push('foundation.version must match CARRY_DROPOFF_FOUNDATION_VERSION');
  if (foundation?.oneItemLimit !== CARRY_ONE_ITEM_LIMIT) errors.push('foundation.oneItemLimit must be 1');
  if (!foundation?.attachPoints?.includes(CARRY_DEFAULT_ATTACH_POINT)) errors.push('foundation.attachPoints must include right-hand');
  for (const surface of CARRY_DROPOFF_SURFACE_KINDS) {
    if (!Array.isArray(foundation?.surfaceCatalogIds?.[surface]) || foundation.surfaceCatalogIds[surface].length === 0) errors.push(`surfaceCatalogIds.${surface} must be non-empty`);
  }
  if (typeof foundation?.canPickupObject !== 'function') errors.push('foundation.canPickupObject must be a function');
  if (typeof foundation?.resolveDropOffPlacement !== 'function') errors.push('foundation.resolveDropOffPlacement must be a function');
  return freezeDeep({ valid: errors.length === 0, errors });
}

export const CARRY_DROPOFF_FOUNDATION = buildCarryDropoffFoundation();
