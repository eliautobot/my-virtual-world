/**
 * Phase 4 Agent Scripted Mode destination resolver.
 *
 * Converts a high-level BehaviorCategory into a real placed target candidate.
 * This module is deliberately side-effect-free: it does not reserve objects,
 * route agents, mutate AgentIntent/ObjectUse state, or import dynamic routing.
 */
import { resolvePlacedActionLocations } from './agent-life-action-location-registry.mjs';
import { normalizeCapabilityTag } from './agent-life-capability-tags.mjs';
import { normalizeObjectCatalogId } from './agent-life-object-catalog-schema.mjs';
import { SCRIPTED_BEHAVIOR_CATEGORIES } from './agent-life-scripted-mode-decision-table.mjs';
import {
  chooseNearestFreeObjectUseSeat,
  listObjectUseSeatCandidates,
} from './agent-life-object-use-seats.mjs';
import {
  chooseNearestFreeObjectUseStandingSlot,
  listObjectUseStandingCandidates,
} from './agent-life-object-use-standing.mjs';
import {
  chooseNearestFreeObjectUseActiveSlot,
  listObjectUseActiveCandidates,
} from './agent-life-object-use-active.mjs';

export const AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION = 'agent-life-behavior-destination-resolver/v1';

export const BEHAVIOR_DESTINATION_CATEGORIES = Object.freeze([...SCRIPTED_BEHAVIOR_CATEGORIES]);

export const BEHAVIOR_DESTINATION_FALLBACK_RULES = Object.freeze({
  temporaryOccupiedQueueReason: 'temporary-occupied-queue-wait',
  alternateObjectReason: 'alternate-object-after-blocked-target',
  failedTargetThrottleReason: 'recent-failed-target-throttle',
  defaultFailedTargetThrottleMs: 90000,
  defaultQueueSpacingTiles: 0.8,
  queueLocationRoles: Object.freeze(['queue', 'wait', 'wait-turn', 'approach', 'clearance']),
  serviceQueueCategories: Object.freeze(['snack-drink']),
  serviceQueueObjectTypes: Object.freeze([]),
});

export const BEHAVIOR_CATEGORY_TARGET_RULES = Object.freeze({
  rest: Object.freeze({
    lifecycle: 'seat',
    capabilityTags: Object.freeze(['life.rest', 'life.social']),
    objectTypes: Object.freeze(['couch', 'sectionalSofa', 'loveseat', 'armchair', 'loungeSeat', 'hallwayBench', 'parkBench', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'patioTable', 'smallRoundMeetingTable', 'patioChair', 'diningChair', 'chair', 'conferenceChair', 'busStop', 'bed', 'sleepPod', 'clinicBed', 'examChair']),
    locationRoles: Object.freeze(['seat', 'rest', 'sit', 'wait']),
  }),
  socialize: Object.freeze({
    lifecycle: 'social',
    capabilityTags: Object.freeze(['life.social', 'planning.meeting']),
    objectTypes: Object.freeze(['couch', 'sectionalSofa', 'loveseat', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'patioTable', 'meetingTable', 'smallRoundMeetingTable', 'gazeboPavilion', 'fountain', 'outdoorStage']),
    locationRoles: Object.freeze(['social', 'gather', 'seat', 'speak', 'wait']),
  }),
  'snack-drink': Object.freeze({
    lifecycle: 'standing',
    capabilityTags: Object.freeze(['life.food', 'life.hydration', 'life.shopping']),
    objectTypes: Object.freeze(['coffeeMachine', 'countertopCoffeeMachine', 'vending', 'fridge', 'microwave', 'cafeCounter', 'foodTruckCounter', 'coffeePickupShelf', 'counter', 'kitchenIsland', 'pantryShelf', 'waterCooler', 'cooler', 'grill', 'displayCase']),
    locationRoles: Object.freeze(['use', 'standing-use', 'service', 'surface', 'counter', 'machine', 'retrieve', 'order', 'checkout']),
  }),
  play: Object.freeze({
    lifecycle: 'active',
    capabilityTags: Object.freeze(['life.social', 'training.practice']),
    objectTypes: Object.freeze(['pingpong', 'arcadeMachine', 'gamingStation', 'poolTable', 'treadmill', 'trainingMat', 'gymBench', 'dumbbellRack', 'outdoorExerciseStation', 'playgroundSlide', 'playgroundSwing', 'outdoorStage', 'dartboard']),
    locationRoles: Object.freeze(['play', 'exercise', 'active-use', 'use', 'train', 'workout', 'slide', 'swing']),
    partnerRequiredTypes: Object.freeze(['pingpong', 'poolTable']),
  }),
  'browse-read': Object.freeze({
    lifecycle: 'standing',
    capabilityTags: Object.freeze(['planning.notice', 'planning.review', 'appearance.display', 'life.shopping', 'maintenance.restock']),
    objectTypes: Object.freeze(['bookshelf', 'bulletinBoard', 'menuBoard', 'whiteboard', 'outdoorNoticeBoard', 'wallArt', 'shopShelf', 'supplyCabinet', 'medicalSupplyCabinet', 'pantryShelf', 'dresser', 'wardrobe', 'nightstand', 'displayCase', 'displayMannequin', 'clothingRack', 'tvStand', 'mirror', 'storageBoxes', 'serverRack', 'toolCart', 'workbench']),
    locationRoles: Object.freeze(['browse', 'inspect', 'read', 'use', 'standing-use', 'preview']),
  }),
  'work-return': Object.freeze({ lifecycle: 'fallback', anchors: Object.freeze(['work', 'desk']) }),
  wander: Object.freeze({ lifecycle: 'fallback', anchors: Object.freeze(['wander', 'path', 'door']) }),
  'sleep-home': Object.freeze({ lifecycle: 'fallback', anchors: Object.freeze(['home', 'sleep', 'bed']) }),
});

const ACTIVE_STATES = new Set(['held', 'active', 'reserved', 'route_pending', 'routing', 'arrived', 'using', 'in_progress', 'docked']);
export const SERVICE_QUEUE_ACTIVE_STATES = new Set(['active', 'using', 'in_progress', 'dispensing', 'brewing', 'heating', 'serving', 'ordering', 'docked']);
// SERVICE_QUEUE_SPEC.md: the claim phase counts as busy. An object with a live
// held/reserved claim must look occupied to queue-formation checks even though
// the claiming agent is still walking to it.
export const SERVICE_QUEUE_CLAIMED_STATES = new Set([...SERVICE_QUEUE_ACTIVE_STATES, 'held', 'reserved', 'pending', 'route_pending', 'routing', 'arrived', 'approach', 'queued']);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stableString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function normalizeFloor(value, fallback = 1) {
  return Math.max(1, Math.floor(finiteNumber(value, fallback)));
}

function distanceSq(a = {}, b = {}) {
  const dx = finiteNumber(a.x ?? a.apiX, 0) - finiteNumber(b.x ?? b.apiX, 0);
  const dz = finiteNumber(a.z ?? a.y ?? a.apiY, 0) - finiteNumber(b.z ?? b.y ?? b.apiY, 0);
  return dx * dx + dz * dz;
}

function normalizeTags(tags = []) {
  return new Set(toArray(tags).map(tag => normalizeCapabilityTag(tag)).filter(Boolean));
}

function normalizeRoles(raw = []) {
  return Object.freeze([...new Set(toArray(raw).map(role => String(role || '').trim()).filter(Boolean))]);
}

function stableLower(value) {
  return stableString(value, '').toLowerCase();
}

function objectIdFor(item = {}, building = null, index = 0) {
  return stableString(item.id || item.instanceId || item.objectInstanceId || `${building?.id || 'building'}:${index}`, `object:${index}`);
}

function objectTypeFor(item = {}) {
  return normalizeObjectCatalogId(item.catalogId || item.objectCatalogId || item.type || item.assetId) || stableString(item.type || item.assetId || item.catalogId, 'unknown');
}

function isUnavailable(item = {}) {
  const state = item.state || item.status || {};
  const status = typeof state === 'string' ? state : (state.status || item.availability || item.lifecycleStatus);
  return Boolean(
    item.deleted || item._deleted || item.removed || item.disabled || item.enabled === false || item.available === false ||
    state.deleted || state.disabled || state.available === false ||
    ['deleted', 'removed', 'disabled', 'unavailable', 'blocked', 'offline'].includes(String(status || '').toLowerCase())
  );
}

function failedTargetMatches(entry = {}, objectId = null) {
  if (!objectId) return false;
  return String(entry.objectId ?? entry.id ?? entry.key ?? entry.objectKey ?? '') === String(objectId);
}

function isRecentlyFailedTarget(objectId, failedTargets = [], nowMs = Date.now(), throttleMs = BEHAVIOR_DESTINATION_FALLBACK_RULES.defaultFailedTargetThrottleMs) {
  const recent = toArray(failedTargets).find(entry => failedTargetMatches(entry, objectId));
  if (!recent) return false;
  const last = finiteNumber(recent.lastFailedAtMs ?? recent.failedAtMs ?? recent.atMs, NaN);
  if (Number.isFinite(last)) return nowMs - last < throttleMs;
  const age = finiteNumber(recent.ageMs ?? recent.elapsedMs, NaN);
  return Number.isFinite(age) && age < throttleMs;
}

function reservationObjectKey(reservation = {}) {
  return stableString(reservation.objectKey || reservation.objectInstanceId || reservation.objectId || reservation.target?.objectInstanceId, null);
}

function activeReservationsForObject(objectKey, reservations = []) {
  return toArray(reservations).filter(reservation => reservationObjectKey(reservation) === objectKey && ACTIVE_STATES.has(String(reservation.state || reservation.status || '').toLowerCase()));
}

function getAgentPosition(agent = {}, context = {}) {
  return {
    x: finiteNumber(agent.x ?? agent.apiX ?? agent.position?.x ?? context.agentPosition?.x, 0),
    z: finiteNumber(agent.z ?? agent.y ?? agent.apiY ?? agent.position?.z ?? agent.position?.y ?? context.agentPosition?.z ?? context.agentPosition?.y, 0),
  };
}

function normalizeAgentContext(agent = {}, context = {}) {
  return Object.freeze({
    id: stableString(agent.id || agent.agentId || context.agentId, 'agent'),
    buildingId: stableString(agent.buildingId || agent.currentBuildingId || context.currentBuildingId, null),
    floor: normalizeFloor(agent.floor ?? agent.currentFloor ?? context.currentFloor, 1),
    position: getAgentPosition(agent, context),
  });
}

function objectMatchesRule({ item, type, tags, rule }) {
  if (!rule) return false;
  if (rule.objectTypes?.includes(type)) return true;
  const ruleTags = rule.capabilityTags || [];
  return ruleTags.some(tag => tags.has(tag));
}

function resolveObjectLocations({ item, building, index, actionSpots, interactionSpots }) {
  return resolvePlacedActionLocations({
    item,
    building,
    index,
    actionSpots,
    interactionSpots,
    coordinateSpace: 'world',
  }).locations || [];
}

function isExplicitQueueEnabled(value) {
  if (value === true) return true;
  return ['queue', 'service-queue', 'required-queue', 'first-come-first-served'].includes(stableLower(value));
}

function isExplicitQueueDisabled(value) {
  if (value === false) return true;
  return ['optional', 'skip-if-occupied', 'exclusive-skip', 'none', 'off', 'disabled'].includes(stableLower(value));
}

function locationEnablesServiceQueue(location = {}) {
  const queueConfig = location?.queueConfig || null;
  return Boolean(
    location?.serviceQueue === true ||
    location?.queueAddon === true ||
    // An authored queue spot IS the queue capability (SERVICE_QUEUE_SPEC:
    // "Capability, not category"). capacityKind 'queue' or an explicit queue
    // role mark authored intent; no extra flag required.
    stableLower(location?.capacityKind || location?.kind || location?.capacity?.kind) === 'queue' ||
    normalizeRoles(location?.roles || location?.role).map(stableLower).includes('queue') ||
    isExplicitQueueEnabled(location?.queuePolicy) ||
    (Array.isArray(location?.resolvedQueueLocations) && location.resolvedQueueLocations.length > 0) ||
    (Array.isArray(location?.queueLocations) && location.queueLocations.length > 0) ||
    (Array.isArray(location?.queuePositions) && location.queuePositions.length > 0) ||
    (Array.isArray(location?.queuePoints) && location.queuePoints.length > 0) ||
    (Array.isArray(queueConfig?.locations) && queueConfig.locations.length > 0) ||
    (Array.isArray(queueConfig?.positions) && queueConfig.positions.length > 0) ||
    (Array.isArray(queueConfig?.points) && queueConfig.points.length > 0)
  );
}

function isServiceQueueObject({ category = null, type = null, item = null, rule = null, locations = [] } = {}) {
  const explicit = item?.queuePolicy || item?.usePolicy || item?.occupancyPolicy || item?.servicePolicy || item?.queueAddon || null;
  if (isExplicitQueueEnabled(explicit) || item?.queue === true || item?.serviceQueue === true || item?.queueConfig) return true;
  if (isExplicitQueueDisabled(explicit) || item?.queue === false || item?.serviceQueue === false) return false;
  // Implied queue capability (authored queue spots) only applies to service
  // points (standing/active lifecycles). Seats never service-queue: agents
  // skip occupied seating and pick another seat instead of lining up
  // (SERVICE_QUEUE_SPEC "Capability, not category" + seat exemption).
  if (rule?.lifecycle === 'seat') return false;
  if (BEHAVIOR_DESTINATION_FALLBACK_RULES.serviceQueueCategories.includes(category) && BEHAVIOR_DESTINATION_FALLBACK_RULES.serviceQueueObjectTypes.includes(type)) return true;
  return toArray(locations).some(location => isQueueLikeLocation(location) && locationEnablesServiceQueue(location));
}

function makeBaseObjectCandidate({ category, item, building, index, type, tags, locations, agentContext, reservations, queueingAllowed, serviceQueue = false }) {
  const objectId = objectIdFor(item, building, index);
  return {
    category,
    objectId,
    objectKey: objectId,
    type,
    catalogId: item.catalogId || item.objectCatalogId || type,
    buildingId: stableString(item.buildingId || building?.id, null),
    floor: normalizeFloor(item.buildingFloor ?? item.floor ?? building?.activeFloor, 1),
    item,
    index,
    tags: [...tags],
    locations,
    reservations: activeReservationsForObject(objectId, reservations),
    queueingAllowed: Boolean(queueingAllowed && serviceQueue),
    serviceQueue: Boolean(serviceQueue),
    distanceSq: distanceSq(agentContext.position, item.world || { x: item.x ?? building?.x, z: item.z ?? building?.z }),
  };
}

function occupiedIdsFor(base, occupied = []) {
  const values = new Set();
  for (const entry of toArray(occupied)) {
    if (!entry) continue;
    if (typeof entry === 'string') values.add(entry);
    else if (!entry.objectKey || entry.objectKey === base.objectKey || entry.objectId === base.objectKey || entry.objectInstanceId === base.objectKey) {
      for (const key of ['seatId', 'slotId', 'spotId', 'activationSpotId', 'interactionSpotId', 'capacityKey', 'id']) {
        if (entry[key]) values.add(entry[key]);
      }
    }
  }
  return values;
}

function objectReservations(base, allReservations) {
  const reservations = activeReservationsForObject(base.objectKey, allReservations);
  if (!base?.serviceQueue) return reservations;
  // Claimed-or-active both block direct slot selection (SERVICE_QUEUE_SPEC.md).
  return reservations.filter(reservation => SERVICE_QUEUE_CLAIMED_STATES.has(String(reservation.state || reservation.status || '').toLowerCase()));
}

function selectSeat(base, { agentContext, reservations, occupiedSeatIds }) {
  const candidates = listObjectUseSeatCandidates({ locations: base.locations, objectKey: base.objectKey, objectType: base.type });
  return chooseNearestFreeObjectUseSeat(candidates, {
    agentPosition: agentContext.position,
    reservations: objectReservations(base, reservations),
    occupiedSeatIds,
  });
}

function selectStanding(base, { category, agentContext, reservations, occupiedSlotIds, rule }) {
  const baseLocations = base.serviceQueue
    ? toArray(base.locations).filter(location => !isQueueLikeLocation(location))
    : base.locations;
  const candidates = listObjectUseStandingCandidates({
    locations: baseLocations,
    objectKey: base.objectKey,
    objectType: base.type,
    standingUseRoles: rule.locationRoles,
  });
  const preferredCandidates = (category === 'snack-drink' && ['cafeCounter', 'foodTruckCounter', 'counter', 'kitchenIsland', 'checkoutCounter', 'checkoutRegister'].includes(base.type))
    ? candidates.filter(candidate => {
      const id = String(candidate.slotId || candidate.activationSpotId || '').toLowerCase();
      const roles = new Set(candidate.roles || []);
      return id.includes('customer') || id.includes('use') || id.includes('prep') || roles.has('customer') || roles.has('order') || roles.has('checkout') || roles.has('counter') || roles.has('surface');
    })
    : candidates;
  const selected = chooseNearestFreeObjectUseStandingSlot(preferredCandidates.length ? preferredCandidates : candidates, {
    agentPosition: agentContext.position,
    reservations: objectReservations(base, reservations),
    occupiedSlotIds,
  });
  if (!selected?.approachSpot && category === 'browse-read') return null;
  return selected;
}

function selectActive(base, { agentContext, reservations, occupiedSlotIds, rule, availableAgents }) {
  const candidates = listObjectUseActiveCandidates({
    locations: base.locations,
    objectKey: base.objectKey,
    objectType: base.type,
    activeRoles: rule.locationRoles,
  });
  const selected = chooseNearestFreeObjectUseActiveSlot(candidates, {
    agentPosition: agentContext.position,
    reservations: objectReservations(base, reservations),
    occupiedSlotIds,
  });
  if (!selected) return null;
  const partnerRequired = rule.partnerRequiredTypes?.includes(base.type) || base.item.partnerRequired === true || selected.partnerRequired === true;
  if (partnerRequired && !findSocialAgent({ agentContext, agents: availableAgents, buildingId: base.buildingId, floor: base.floor })) return null;
  return { ...selected, partnerRequired };
}

function locationPosition(location = {}) {
  return location.position || location.world || location;
}

function isQueueLikeLocation(location = {}, roles = normalizeRoles(location.roles || location.role)) {
  const queueRoles = new Set(BEHAVIOR_DESTINATION_FALLBACK_RULES.queueLocationRoles);
  const id = stableLower(location.id || location.spotId);
  const capacityKind = stableLower(location.capacityKind || location.kind || location.capacity?.kind);
  return capacityKind === 'queue' || roles.some(role => queueRoles.has(role)) || id.includes('queue') || id.includes('wait');
}

function primaryActionLocationForQueue(base, rule, queueSelection) {
  const ruleRoles = new Set(toArray(rule?.locationRoles).map(stableLower));
  const queuePosition = queueSelection?.position || locationPosition(queueSelection?.location || {});
  const candidates = toArray(base.locations)
    .map(location => {
      const roles = normalizeRoles(location.roles || location.role).map(stableLower);
      if (isQueueLikeLocation(location, roles)) return null;
      const id = stableLower(location.id || location.spotId || location.activationSpotId);
      const position = locationPosition(location);
      const roleScore = roles.reduce((score, role) => score + (ruleRoles.has(role) ? 5 : 0), 0);
      const idScore = ['use', 'customer', 'order', 'retrieve', 'active', 'front'].reduce((score, token) => score + (id.includes(token) ? 2 : 0), 0);
      return {
        location,
        roles,
        position,
        score: roleScore + idScore,
        distanceSq: distanceSq(queuePosition, position),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.distanceSq - b.distanceSq);
  return candidates[0] || null;
}

function serviceQueuePrimaryIsBlocked(base, primary = null, occupiedSpots = []) {
  if (!base?.serviceQueue) return true;
  const primaryLocation = primary?.location || null;
  const primaryIds = new Set(toArray([
    primaryLocation?.id,
    primaryLocation?.spotId,
    primaryLocation?.slotId,
    primaryLocation?.activationSpotId,
    primaryLocation?.standingUseSlotId,
  ]).map(String).filter(Boolean));
  if (!primaryIds.size) return false;
  if (toArray(base.reservations).some(reservation => SERVICE_QUEUE_CLAIMED_STATES.has(String(reservation.state || reservation.status || '').toLowerCase()))) return true;
  return toArray(occupiedSpots).some(entry => {
    if (!entry) return false;
    const key = entry.objectKey || entry.objectId || entry.objectInstanceId || null;
    if (key && String(key) !== String(base.objectKey)) return false;
    if (entry.source === 'service-queue-priority') return true;
    return ['slotId', 'spotId', 'activationSpotId', 'interactionSpotId', 'capacityKey', 'id']
      .some(field => entry[field] && primaryIds.has(String(entry[field])));
  });
}

function normalizeBuildings(buildings = []) {
  return toArray(buildings).map(building => ({ ...building, furniture: building.interior?.furniture || building.furniture || building.objects || [] }));
}

function queueWaitCandidateForBase(base, { rule, agentContext, occupiedSpots = [] }) {
  const locations = toArray(base.locations)
    .map(location => {
      const roles = normalizeRoles(location.roles || location.role);
      if (!isQueueLikeLocation(location, roles)) return null;
      const position = locationPosition(location);
      return { location, roles, position, distanceSq: distanceSq(agentContext.position, position) };
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceSq - b.distanceSq);
  const selected = locations[0] || null;
  if (!selected) return null;
  const primary = primaryActionLocationForQueue(base, rule, selected);
  if (!serviceQueuePrimaryIsBlocked(base, primary, occupiedSpots)) return null;
  const primaryPosition = primary?.position || selected.position || {};
  const queueAnchorPosition = selected.position || primaryPosition;
  const queueSpotId = selected.location.id || selected.location.spotId || 'queue-wait';
  const queueOccupancy = toArray(occupiedSpots).filter(entry => {
    if (!entry) return false;
    const key = entry.objectKey || entry.objectId || entry.objectInstanceId || null;
    if (key && String(key) !== String(base.objectKey)) return false;
    const id = entry.spotId || entry.interactionSpotId || entry.slotId || entry.seatId || entry.capacityKey || null;
    return !id || String(id).startsWith(String(queueSpotId));
  }).length;
  const authoredQueueLocations = Array.isArray(selected.location.resolvedQueueLocations) ? selected.location.resolvedQueueLocations
    : (Array.isArray(selected.location.queueLocations) ? selected.location.queueLocations
      : (Array.isArray(selected.location.queuePositions) ? selected.location.queuePositions
        : (Array.isArray(selected.location.queuePoints) ? selected.location.queuePoints
          : (Array.isArray(selected.location.queueConfig?.locations) ? selected.location.queueConfig.locations
            : (Array.isArray(selected.location.queueConfig?.positions) ? selected.location.queueConfig.positions
              : (Array.isArray(selected.location.queueConfig?.points) ? selected.location.queueConfig.points : []))))));
  const maxQueuePoints = Math.max(1, Math.floor(finiteNumber(selected.location.queueMaxPoints ?? selected.location.maxQueuePoints ?? selected.location.queueCapacity ?? (authoredQueueLocations.length || selected.location.capacity), authoredQueueLocations.length || 3)));
  if (queueOccupancy >= maxQueuePoints) return null;
  const authoredQueueLocation = authoredQueueLocations
    .map((location, fallbackIndex) => ({ ...location, queueIndex: Math.max(0, Math.floor(finiteNumber(location.queueIndex ?? location.index ?? fallbackIndex, fallbackIndex))) }))
    .sort((a, b) => a.queueIndex - b.queueIndex || String(a.id || '').localeCompare(String(b.id || '')))
    .find(location => location.queueIndex === queueOccupancy) || null;
  if (authoredQueueLocation) {
    const authoredPosition = authoredQueueLocation.position || authoredQueueLocation.world || authoredQueueLocation.buildingLocal || authoredQueueLocation;
    const authoredX = finiteNumber(authoredPosition.x ?? authoredQueueLocation.x, finiteNumber(primaryPosition.x, 0));
    const authoredZ = finiteNumber(authoredPosition.z ?? authoredPosition.y ?? authoredQueueLocation.z ?? authoredQueueLocation.y, finiteNumber(primaryPosition.z ?? primaryPosition.y, 0));
    const queueTargetId = authoredQueueLocation.slotId || authoredQueueLocation.spotId || authoredQueueLocation.id || `${queueSpotId}:${queueOccupancy}`;
    return freezeDeep({
      ok: true,
      version: AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION,
      category: base.category,
      lifecycle: 'queue-wait',
      target: Object.freeze({ kind: 'furniture', id: base.objectId, buildingId: base.buildingId, furnitureIndex: base.index, catalogId: base.catalogId, objectType: base.type }),
      spot: Object.freeze({ spotId: queueTargetId, slotId: queueTargetId, interactionSpotId: queueSpotId, queueSpotId, queueIndex: queueOccupancy, x: authoredX, y: authoredZ, floor: base.floor, authoredQueueLocation: true }),
      objectId: base.objectId,
      objectType: base.type,
      buildingId: base.buildingId,
      floor: base.floor,
      distanceSq: distanceSq(agentContext.position, { x: authoredX, z: authoredZ }),
      preferenceScore: -2,
      queueingIntended: true,
      fallbackReason: BEHAVIOR_DESTINATION_FALLBACK_RULES.temporaryOccupiedQueueReason,
      debug: Object.freeze({ selectedSpotRoles: selected.roles, primarySpotId: primary?.location?.id || primary?.location?.spotId || null, queueWaitFallback: true, matchedLifecycle: rule?.lifecycle || null, queueIndex: queueOccupancy, maxQueuePoints, authoredQueueLocation: true }),
    });
  }
  const queueSpacingTiles = finiteNumber(selected.location.queueSpacingTiles ?? selected.location.spacingTiles, BEHAVIOR_DESTINATION_FALLBACK_RULES.defaultQueueSpacingTiles);
  const anchorDx = finiteNumber(queueAnchorPosition.x, 0) - finiteNumber(primaryPosition.x, 0);
  const anchorDz = finiteNumber(queueAnchorPosition.z ?? queueAnchorPosition.y, 0) - finiteNumber(primaryPosition.z ?? primaryPosition.y, 0);
  const queueDx = finiteNumber(selected.location.queueDx ?? selected.location.lineDx, anchorDx);
  const queueDz = finiteNumber(selected.location.queueDz ?? selected.location.lineDz, anchorDz || queueSpacingTiles);
  const lineLength = Math.hypot(queueDx, queueDz) || 1;
  const lineX = queueDx / lineLength;
  const lineZ = queueDz / lineLength;
  const forwardOffset = queueSpacingTiles * (queueOccupancy + 1);
  const queuedX = finiteNumber(primaryPosition.x, 0) + lineX * forwardOffset;
  const queuedZ = finiteNumber(primaryPosition.z ?? primaryPosition.y, 0) + lineZ * forwardOffset;
  return freezeDeep({
    ok: true,
    version: AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION,
    category: base.category,
    lifecycle: 'queue-wait',
    target: Object.freeze({ kind: 'furniture', id: base.objectId, buildingId: base.buildingId, furnitureIndex: base.index, catalogId: base.catalogId, objectType: base.type }),
    spot: Object.freeze({ spotId: `${queueSpotId}:${queueOccupancy}`, slotId: `${queueSpotId}:${queueOccupancy}`, interactionSpotId: queueSpotId, queueSpotId, queueIndex: queueOccupancy, x: queuedX, y: queuedZ, floor: base.floor }),
    objectId: base.objectId,
    objectType: base.type,
    buildingId: base.buildingId,
    floor: base.floor,
    distanceSq: distanceSq(agentContext.position, { x: queuedX, z: queuedZ }),
    preferenceScore: -2,
    queueingIntended: true,
    fallbackReason: BEHAVIOR_DESTINATION_FALLBACK_RULES.temporaryOccupiedQueueReason,
    debug: Object.freeze({ selectedSpotRoles: selected.roles, primarySpotId: primary?.location?.id || primary?.location?.spotId || null, queueWaitFallback: true, matchedLifecycle: rule?.lifecycle || null, queueIndex: queueOccupancy, maxQueuePoints }),
  });
}

function collectObjectCandidates({ category, agentContext, buildings, agents = [], reservations, occupiedSpots, queueing = {}, actionSpots = {}, interactionSpots = {}, blockedObjectIds = [], failedTargets = [], failedTargetThrottleMs = BEHAVIOR_DESTINATION_FALLBACK_RULES.defaultFailedTargetThrottleMs, nowMs = Date.now() }) {
  const rule = BEHAVIOR_CATEGORY_TARGET_RULES[category];
  if (!rule || ['fallback', 'social'].includes(rule.lifecycle)) return [];
  const queueingAllowed = Boolean(queueing[category] || queueing.default);
  const normalizedBuildings = normalizeBuildings(buildings);
  const candidates = [];
  const queueCandidates = [];
  const blockedIds = new Set(toArray(blockedObjectIds).map(String));

  for (const building of normalizedBuildings) {
    for (const [index, item] of toArray(building.furniture).entries()) {
      if (!item || isUnavailable(item)) continue;
      const type = objectTypeFor(item);
      const objectId = objectIdFor(item, building, index);
      if (blockedIds.has(objectId) || isRecentlyFailedTarget(objectId, failedTargets, nowMs, failedTargetThrottleMs)) continue;
      const tags = normalizeTags([...(item.capabilityTags || []), ...(item.capabilities || []), ...(item.tags || [])]);
      if (!objectMatchesRule({ item, type, tags, rule })) continue;
      const locations = resolveObjectLocations({ item, building, index, actionSpots, interactionSpots });
      if (!locations.length && !Array.isArray(item.interactionSpots) && !Array.isArray(item.actionSpots)) continue;
      const serviceQueue = isServiceQueueObject({ category, type, item, rule, locations });
      const base = makeBaseObjectCandidate({ category, item, building, index, type, tags, locations, agentContext, reservations, queueingAllowed, serviceQueue });
      const occupiedIds = occupiedIdsFor(base, occupiedSpots);
      const slot = rule.lifecycle === 'seat'
        ? selectSeat(base, { agentContext, reservations, occupiedSeatIds: occupiedIds })
        : rule.lifecycle === 'standing'
          ? selectStanding(base, { category, agentContext, reservations, occupiedSlotIds: occupiedIds, rule })
          : selectActive(base, { agentContext, reservations, occupiedSlotIds: occupiedIds, rule, availableAgents: agents });
      if (!slot) {
        const queueWait = base.queueingAllowed ? queueWaitCandidateForBase(base, { rule, agentContext, occupiedSpots }) : null;
        if (queueWait) queueCandidates.push(queueWait);
        continue;
      }
      candidates.push(makeResolvedCandidate({ base, slot, lifecycle: rule.lifecycle, fallbackReason: null }));
    }
  }
  const sorted = candidates.sort(compareCandidates);
  if (sorted.length) return sorted;
  return queueCandidates.sort(compareCandidates);
}

function compareCandidates(a, b) {
  const prefDiff = finiteNumber(b.preferenceScore, 0) - finiteNumber(a.preferenceScore, 0);
  return prefDiff || finiteNumber(a.distanceSq, 0) - finiteNumber(b.distanceSq, 0) || String(a.objectId || a.target?.id || '').localeCompare(String(b.objectId || b.target?.id || ''));
}

function makeResolvedCandidate({ base, slot, lifecycle, fallbackReason }) {
  const spotId = slot.seatId || slot.slotId || slot.activationSpotId || slot.id || null;
  const position = slot.approachSpot?.position || slot.position || slot.activationSpot?.position || {};
  return freezeDeep({
    ok: true,
    version: AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION,
    category: base.category,
    lifecycle,
    target: Object.freeze({
      kind: 'furniture',
      id: base.objectId,
      buildingId: base.buildingId,
      furnitureIndex: base.index,
      catalogId: base.catalogId,
      objectType: base.type,
    }),
    spot: Object.freeze({
      spotId,
      slotId: slot.slotId || null,
      seatId: slot.seatId || null,
      interactionSpotId: slot.activationSpotId || spotId,
      x: finiteNumber(position.x, 0),
      y: finiteNumber(position.z ?? position.y, 0),
      floor: base.floor,
    }),
    objectId: base.objectId,
    objectType: base.type,
    buildingId: base.buildingId,
    floor: base.floor,
    distanceSq: finiteNumber(slot.distanceSq ?? base.distanceSq, 0),
    preferenceScore: 0,
    queueingIntended: base.queueingAllowed,
    partnerRequired: Boolean(slot.partnerRequired),
    fallbackReason,
    objectUseSlot: slot,
    objectUse: Object.freeze({ lifecycle, slot }),
    debug: Object.freeze({ selectedSpotRoles: Object.freeze([...(slot.roles || [])]), reservationsConsidered: base.reservations.length }),
  });
}

function collectSocialObjectSpots({ category, agentContext, buildings, actionSpots, interactionSpots }) {
  const rule = BEHAVIOR_CATEGORY_TARGET_RULES[category];
  const normalizedBuildings = normalizeBuildings(buildings);
  const candidates = [];
  for (const building of normalizedBuildings) {
    for (const [index, item] of toArray(building.furniture).entries()) {
      if (!item || isUnavailable(item)) continue;
      const type = objectTypeFor(item);
      const tags = normalizeTags([...(item.capabilityTags || []), ...(item.capabilities || []), ...(item.tags || [])]);
      if (!objectMatchesRule({ item, type, tags, rule })) continue;
      const base = makeBaseObjectCandidate({ category, item, building, index, type, tags, locations: resolveObjectLocations({ item, building, index, actionSpots, interactionSpots }), agentContext, reservations: [], queueingAllowed: false, serviceQueue: false });
      for (const location of base.locations) {
        const roles = normalizeRoles(location.roles || location.role);
        const id = stableString(location.id, '').toLowerCase();
        const social = roles.some(role => ['social', 'talk', 'gather', 'speak', 'approach'].includes(role)) || id.includes('talk') || id.includes('social');
        if (!social) continue;
        const position = location.position || location.world || location;
        candidates.push(freezeDeep({
          ok: true,
          version: AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION,
          category,
          lifecycle: 'social-spot',
          target: Object.freeze({ kind: 'furniture', id: base.objectId, buildingId: base.buildingId, furnitureIndex: base.index, catalogId: base.catalogId, objectType: base.type }),
          spot: Object.freeze({ spotId: location.id || location.spotId || 'social-spot', interactionSpotId: location.id || location.spotId || 'social-spot', x: finiteNumber(position.x, 0), y: finiteNumber(position.z ?? position.y, 0), floor: base.floor }),
          objectId: base.objectId,
          objectType: base.type,
          buildingId: base.buildingId,
          floor: base.floor,
          distanceSq: distanceSq(agentContext.position, position),
          preferenceScore: 3,
          queueingIntended: true,
          fallbackReason: null,
          debug: Object.freeze({ selectedSpotRoles: roles, socialSpot: true }),
        }));
      }
    }
  }
  return candidates.sort(compareCandidates);
}

function findSocialAgent({ agentContext, agents = [], buildingId = agentContext.buildingId, floor = agentContext.floor, maxDistance = 32 }) {
  return toArray(agents)
    .filter(other => other && stableString(other.id || other.agentId, null) !== agentContext.id && !other.deleted && other.available !== false && other.disabled !== true)
    .filter(other => stableString(other.buildingId || other.currentBuildingId, null) === stableString(buildingId, null))
    .filter(other => normalizeFloor(other.floor ?? other.currentFloor, 1) === normalizeFloor(floor, 1))
    .map(other => ({ other, distanceSq: distanceSq(agentContext.position, getAgentPosition(other)) }))
    .filter(entry => entry.distanceSq <= maxDistance * maxDistance)
    .sort((a, b) => a.distanceSq - b.distanceSq)[0]?.other || null;
}

function collectSocialCandidates({ category, agentContext, agents, buildings, reservations, occupiedSpots, actionSpots, interactionSpots, proximity = {} }) {
  const maxDistance = finiteNumber(proximity.socialMaxDistance, 32);
  const other = findSocialAgent({ agentContext, agents, maxDistance });
  const candidates = [];
  if (other) {
    const pos = getAgentPosition(other);
    candidates.push(freezeDeep({
      ok: true,
      version: AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION,
      category,
      lifecycle: 'social-agent',
      target: Object.freeze({ kind: 'agent', id: stableString(other.id || other.agentId, null), buildingId: agentContext.buildingId }),
      spot: Object.freeze({ spotId: 'social-approach-agent', x: pos.x, y: pos.z, floor: agentContext.floor }),
      buildingId: agentContext.buildingId,
      floor: agentContext.floor,
      distanceSq: distanceSq(agentContext.position, pos),
      preferenceScore: 0,
      queueingIntended: false,
      fallbackReason: null,
    }));
  }
  const socialObjectCandidates = collectSocialObjectSpots({ category, agentContext, buildings, actionSpots, interactionSpots })
    .filter(candidate => candidate.buildingId === agentContext.buildingId && candidate.floor === agentContext.floor);
  const objectCandidates = collectObjectCandidates({ category: 'rest', agentContext, buildings, agents, reservations, occupiedSpots, actionSpots, interactionSpots })
    .filter(candidate => candidate.buildingId === agentContext.buildingId && candidate.floor === agentContext.floor)
    .map(candidate => freezeDeep({ ...candidate, category, lifecycle: 'social-spot' }));
  candidates.push(...socialObjectCandidates, ...objectCandidates);
  return candidates.sort(compareCandidates);
}

function makeWorldPointCandidate({ category, point, reason, agentContext }) {
  const pos = point.position || point;
  return freezeDeep({
    ok: true,
    version: AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION,
    category,
    lifecycle: 'fallback',
    target: Object.freeze({ kind: point.kind || 'world-point', id: point.id || reason, buildingId: point.buildingId || agentContext.buildingId || null, nodeId: point.nodeId || null }),
    spot: Object.freeze({ spotId: point.spotId || reason, x: finiteNumber(pos.x ?? pos.apiX, agentContext.position.x), y: finiteNumber(pos.z ?? pos.y ?? pos.apiY, agentContext.position.z), floor: normalizeFloor(point.floor ?? agentContext.floor, agentContext.floor) }),
    buildingId: point.buildingId || agentContext.buildingId || null,
    floor: normalizeFloor(point.floor ?? agentContext.floor, agentContext.floor),
    distanceSq: distanceSq(agentContext.position, pos),
    preferenceScore: 0,
    queueingIntended: false,
    fallbackReason: reason,
  });
}

function resolveFallback({ category, agentContext, anchors = {}, buildings = [] }) {
  const rule = BEHAVIOR_CATEGORY_TARGET_RULES[category] || BEHAVIOR_CATEGORY_TARGET_RULES.wander;
  const anchorNames = rule.anchors || ['wander'];
  for (const name of anchorNames) {
    const value = anchors[name] || anchors[category] || null;
    if (Array.isArray(value) && value.length) return makeWorldPointCandidate({ category, point: value[0], reason: `fallback-${name}`, agentContext });
    if (value) return makeWorldPointCandidate({ category, point: value, reason: `fallback-${name}`, agentContext });
  }
  const currentBuilding = normalizeBuildings(buildings).find(building => building.id === agentContext.buildingId) || normalizeBuildings(buildings)[0] || null;
  if (currentBuilding) {
    return makeWorldPointCandidate({
      category,
      point: { kind: 'building', id: currentBuilding.id, buildingId: currentBuilding.id, x: currentBuilding.x || currentBuilding.worldX || 0, z: currentBuilding.z || currentBuilding.worldZ || 0, floor: currentBuilding.activeFloor || agentContext.floor },
      reason: 'fallback-building-anchor',
      agentContext,
    });
  }
  return makeWorldPointCandidate({ category, point: { x: agentContext.position.x + 4, z: agentContext.position.z, floor: agentContext.floor }, reason: 'fallback-wander-offset', agentContext });
}

function applyPreferences(candidates, preferences = {}, recentObjects = [], nowMs = Date.now()) {
  const preferTypes = new Set(toArray(preferences.preferredObjectTypes || preferences.objectTypes));
  const preferBuildings = new Set(toArray(preferences.preferredBuildingIds || preferences.buildingIds));
  const preferObjects = new Set(toArray(preferences.preferredObjectIds || preferences.objectIds).map(String));
  const avoidObjectIds = new Set(toArray(preferences.avoidObjectIds));
  const recentEntries = toArray(recentObjects);
  return candidates
    .filter(candidate => !avoidObjectIds.has(candidate.objectId))
    .map(candidate => {
      let preferenceScore = 0;
      if (preferTypes.has(candidate.objectType)) preferenceScore += 10;
      if (preferObjects.has(String(candidate.objectId))) preferenceScore += 14;
      if (preferBuildings.has(candidate.buildingId)) preferenceScore += 6;
      const recent = recentEntries.find(entry => (entry.objectId || entry.id || entry.key) === candidate.objectId);
      if (recent) {
        const last = finiteNumber(recent.lastUsedAtMs ?? recent.atMs, NaN);
        if (Number.isFinite(last) && nowMs - last < finiteNumber(preferences.objectCooldownMs, 240000)) preferenceScore -= 12;
      }
      return freezeDeep({ ...candidate, preferenceScore });
    })
    .sort(compareCandidates);
}

export function listBehaviorDestinationCandidates({
  category,
  agent = {},
  context = {},
  buildings = [],
  agents = [],
  reservations = [],
  occupiedSpots = [],
  queueing = {},
  preferences = {},
  recentObjects = [],
  blockedObjectIds = [],
  failedTargets = [],
  failedTargetThrottleMs = BEHAVIOR_DESTINATION_FALLBACK_RULES.defaultFailedTargetThrottleMs,
  scheduleWindow = null,
  anchors = {},
  actionSpots = {},
  interactionSpots = {},
  proximity = {},
  nowMs = Date.now(),
} = {}) {
  const selectedCategory = BEHAVIOR_DESTINATION_CATEGORIES.includes(category) ? category : 'wander';
  const agentContext = normalizeAgentContext(agent, context);
  if (scheduleWindow && scheduleWindow.allowedCategories && !scheduleWindow.allowedCategories.includes(selectedCategory)) return freezeDeep([]);

  let candidates = [];
  if (selectedCategory === 'socialize') {
    candidates = collectSocialCandidates({ category: selectedCategory, agentContext, agents, buildings, reservations, occupiedSpots, actionSpots, interactionSpots, proximity });
  } else if (['work-return', 'wander', 'sleep-home'].includes(selectedCategory)) {
    candidates = [resolveFallback({ category: selectedCategory, agentContext, anchors, buildings })];
  } else {
    candidates = collectObjectCandidates({ category: selectedCategory, agentContext, buildings, agents, reservations, occupiedSpots, queueing, actionSpots, interactionSpots, blockedObjectIds, failedTargets, failedTargetThrottleMs, nowMs });
  }

  if (!candidates.length && ['work-return', 'wander', 'sleep-home'].includes(selectedCategory)) candidates = [resolveFallback({ category: selectedCategory, agentContext, anchors, buildings })];
  const preferred = applyPreferences(candidates, preferences, recentObjects, nowMs);
  const hadBlockedHints = toArray(blockedObjectIds).length || toArray(failedTargets).length;
  return freezeDeep(hadBlockedHints ? preferred.map(candidate => candidate.fallbackReason ? candidate : freezeDeep({ ...candidate, fallbackReason: BEHAVIOR_DESTINATION_FALLBACK_RULES.alternateObjectReason })) : preferred);
}

export function resolveBehaviorDestination(options = {}) {
  const category = BEHAVIOR_DESTINATION_CATEGORIES.includes(options.category) ? options.category : 'wander';
  const candidates = listBehaviorDestinationCandidates({ ...options, category });
  const selected = candidates[0] || null;
  if (selected) return freezeDeep({ ...selected, candidatesConsidered: candidates.length });
  const agentContext = normalizeAgentContext(options.agent || {}, options.context || {});
  return freezeDeep({
    ok: false,
    version: AGENT_BEHAVIOR_DESTINATION_RESOLVER_VERSION,
    category,
    target: Object.freeze({ kind: 'none' }),
    spot: null,
    fallbackReason: 'no-destination-candidates',
    candidatesConsidered: 0,
    agentContext,
  });
}
