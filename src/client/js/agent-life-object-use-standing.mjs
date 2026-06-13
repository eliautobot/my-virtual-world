/**
 * Agent Life ObjectUse standing-use selection, facing, reservation, and timed completion helpers.
 *
 * Phase 3E shared helper for non-seated standing-use objects such as machines,
 * counters, shelves, boards, mirrors, printers, tools, and service surfaces. It
 * does not route agents or add pathfinding: callers reserve a reachable use-front
 * spot here, route through the existing AgentIntent/setAgentTarget handoff, then
 * activate/complete/release through this lifecycle after route arrival.
 */

export const OBJECT_USE_STANDING_HELPER_VERSION = 'agent-life-object-use-standing/v1';

export const OBJECT_USE_STANDING_RESERVATION_STATES = Object.freeze([
  'held',
  'active',
  'reserved',
  'route_pending',
  'routing',
  'arrived',
  'using',
  'in_progress',
  'completing',
  'completed',
  'cancelled',
  'failed',
  'expired',
]);

export const OBJECT_USE_STANDING_FACING_MODES = Object.freeze([
  'face-center',
  'object-front',
  'custom',
  'any',
]);

const STANDING_USE_ROLES = Object.freeze([
  'use',
  'standing-use',
  'service',
  'surface',
  'counter',
  'machine',
  'retrieve',
  'browse',
  'inspect',
  'read',
  'print',
  'scan',
  'repair',
  'tool',
  'order',
  'checkout',
]);
const APPROACH_ONLY_ROLES = Object.freeze(['approach', 'queue', 'staging', 'clearance', 'wait-turn']);

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function optionalFiniteNumber(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stableString(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function normalizePosition(raw = {}) {
  const source = raw.position || raw.world || raw.buildingLocal || raw.offset || raw;
  return Object.freeze({
    x: finiteNumber(source.x ?? source.dx, 0),
    z: finiteNumber(source.z ?? source.y ?? source.dz ?? source.dy, 0),
  });
}

function normalizeRoles(raw = []) {
  const roles = Array.isArray(raw) ? raw : [raw].filter(Boolean);
  return Object.freeze([...new Set(roles.map(role => String(role).trim()).filter(Boolean))]);
}

function hasAnyRole(location = {}, allowedRoles = STANDING_USE_ROLES) {
  const roles = normalizeRoles(location.roles || location.role);
  const id = stableString(location.id).toLowerCase();
  return roles.some(role => allowedRoles.includes(role)) || allowedRoles.some(role => id.includes(role));
}

function isApproachOnly(location = {}) {
  const roles = normalizeRoles(location.roles || location.role);
  const id = stableString(location.id).toLowerCase();
  return roles.some(role => APPROACH_ONLY_ROLES.includes(role)) && !hasAnyRole(location) && !id.includes('use-front') && !id.includes('customer');
}

function capacityFor(location = {}) {
  const raw = location.capacity;
  if (raw && typeof raw === 'object') {
    return Object.freeze({
      kind: raw.kind || raw.capacityKind || 'exclusive',
      maxAgents: Math.max(1, Math.floor(finiteNumber(raw.maxAgents ?? raw.capacity, 1))),
      reservable: raw.reservable !== false,
    });
  }
  return Object.freeze({
    kind: location.capacityKind || 'exclusive',
    maxAgents: Math.max(1, Math.floor(finiteNumber(raw ?? location.maxAgents, 1))),
    reservable: location.reservable !== false && location.requiresReservation !== false,
  });
}

function distanceSq(position = {}, target = {}) {
  const dx = finiteNumber(position.x, 0) - finiteNumber(target.x, 0);
  const dz = finiteNumber(position.z ?? position.y, 0) - finiteNumber(target.z ?? target.y, 0);
  return dx * dx + dz * dz;
}

function distance(position = {}, target = {}) {
  return Math.sqrt(distanceSq(position, target));
}

function normalizeActivation(location = {}, defaults = {}) {
  return freezeDeep({
    approachRadius: positiveNumber(location.approachRadius ?? defaults.approachRadius, 3),
    activationRadius: positiveNumber(location.activationRadius ?? defaults.activationRadius, 8),
    snapRadius: positiveNumber(location.snapRadius ?? defaults.snapRadius, 3),
    dockMode: location.dockMode || defaults.dockMode || 'none',
    requiresLineOfSight: Boolean(location.requiresLineOfSight ?? defaults.requiresLineOfSight ?? false),
    requiresSameFloor: location.requiresSameFloor !== false && defaults.requiresSameFloor !== false,
    requiresSameBuilding: location.requiresSameBuilding !== false && defaults.requiresSameBuilding !== false,
  });
}

function normalizeFacingMode(value, fallback = 'object-front') {
  const mode = stableString(value, fallback);
  return OBJECT_USE_STANDING_FACING_MODES.includes(mode) ? mode : fallback;
}

function normalizePose(location = {}, defaults = {}) {
  return freezeDeep({
    animationId: stableString(location.animationId || location.poseAnimationId || defaults.animationId, null),
    poseId: stableString(location.poseId || defaults.poseId, null),
    facingMode: normalizeFacingMode(location.facingMode || defaults.facingMode || (location.facing ? 'object-front' : 'face-center')),
    facingAngleRad: optionalFiniteNumber(location.facingAngleRad ?? defaults.facingAngleRad, null),
    customFacingAngleRad: optionalFiniteNumber(location.customFacingAngleRad ?? defaults.customFacingAngleRad, null),
    customFacingVector: location.customFacingVector || defaults.customFacingVector || null,
    facing: location.facing || defaults.facing || null,
    snapToActivation: false,
    dockOffset: null,
    seated: false,
    standing: true,
  });
}

function normalizeCompletion(location = {}, defaults = {}) {
  const durationMs = positiveNumber(location.durationMs ?? location.useDurationMs ?? location.completionDurationMs ?? defaults.durationMs ?? defaults.useDurationMs, 0);
  return freezeDeep({
    mode: location.completionMode || defaults.completionMode || (durationMs > 0 ? 'timer' : 'manual'),
    durationMs,
    terminalState: location.terminalState || defaults.terminalState || 'completed',
  });
}

function cardinalFacingAngleRad(facing = 'north', rotationRad = 0) {
  const key = stableString(facing, 'north').toLowerCase();
  const base = key === 'south' ? Math.PI
    : key === 'east' ? Math.PI / 2
    : key === 'west' ? -Math.PI / 2
    : 0;
  return base + finiteNumber(rotationRad, 0);
}

function vectorAngleRad(vector = {}) {
  const x = finiteNumber(vector.x ?? vector.dx, 0);
  const z = finiteNumber(vector.z ?? vector.y ?? vector.dz ?? vector.dy, 0);
  if (Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9) return null;
  return Math.atan2(x, z);
}

function compareStandingCandidates(a, b) {
  return String(a?.slotId || '').localeCompare(String(b?.slotId || '')) || (a?.sortIndex || 0) - (b?.sortIndex || 0);
}

function normalizeReservationList(reservations = []) {
  if (Array.isArray(reservations)) return reservations;
  if (reservations instanceof Map) return [...reservations.values()];
  if (reservations && typeof reservations === 'object') return Object.values(reservations);
  return [];
}

function isActiveReservation(reservation = {}) {
  return OBJECT_USE_STANDING_RESERVATION_STATES.includes(reservation.state || reservation.status);
}

function reservationMatchesSlot(reservation = {}, slot = {}) {
  const reservationSlotId = reservation.slotId || reservation.spotId || reservation.activationSpotId || reservation.interactionSpotId || reservation.standingUseSlotId;
  const reservationCapacityKey = reservation.capacityKey || getObjectUseStandingCapacityKey(reservation.objectKey || reservation.objectInstanceId, reservationSlotId);
  return reservationCapacityKey === slot.capacityKey || (
    stableString(reservation.objectKey || reservation.objectInstanceId, null) === slot.objectKey &&
    stableString(reservationSlotId, null) === slot.slotId
  );
}

function normalizeOccupiedSlotIds(occupiedSlotIds = []) {
  if (occupiedSlotIds instanceof Set) return occupiedSlotIds;
  const ids = Array.isArray(occupiedSlotIds) ? occupiedSlotIds : Object.values(occupiedSlotIds || {});
  return new Set(ids.map(value => typeof value === 'object' ? (value.slotId || value.spotId || value.id) : value).filter(Boolean));
}

export function getObjectUseStandingCapacityKey(objectKey, slotId) {
  const key = stableString(objectKey, 'unknown-object');
  const slot = stableString(slotId, 'standing-use');
  return `${key}:standing:${slot}`;
}

export function listObjectUseStandingCandidates({
  locations = [],
  useSpots = null,
  objectKey = null,
  objectType = null,
  actionId = null,
  approachSpotId = null,
  standingUseRoles = STANDING_USE_ROLES,
  activationDefaults = {},
  poseDefaults = {},
  completionDefaults = {},
  objectCenter = null,
  objectRotationRad = 0,
} = {}) {
  const spots = Array.isArray(useSpots) ? useSpots : locations;
  const approachById = new Map((locations || []).map(location => [location.id, location]));
  const candidates = spots
    .filter(location => location && !isApproachOnly(location) && hasAnyRole(location, standingUseRoles))
    .map((location, index) => {
      const slotId = stableString(location.slotId || location.standingUseSlotId || location.activationSpotId || location.id, `standing-${index + 1}`);
      const selectedApproachSpotId = stableString(location.approachSpotId || approachSpotId || location.id, null);
      const approachSpot = selectedApproachSpotId ? (approachById.get(selectedApproachSpotId) || location) : location;
      const resolvedObjectKey = stableString(objectKey, null);
      const activation = normalizeActivation(location, activationDefaults);
      const pose = normalizePose(location, poseDefaults);
      const completion = normalizeCompletion(location, completionDefaults);
      const activationSpot = freezeDeep({ ...location, position: normalizePosition(location) });
      const position = normalizePosition(location);
      return freezeDeep({
        slotId,
        standingUseSlotId: slotId,
        activationSpotId: stableString(location.activationSpotId || location.id, slotId),
        approachSpotId: stableString(selectedApproachSpotId, slotId),
        approachSpot: freezeDeep({ ...approachSpot, position: normalizePosition(approachSpot) }),
        reachableUseFrontSpot: true,
        objectKey: resolvedObjectKey,
        objectType: stableString(objectType || location.assetId, null),
        actionId: stableString(actionId || location.actionId || location.action, null),
        capacityKey: getObjectUseStandingCapacityKey(resolvedObjectKey, slotId),
        capacity: capacityFor(location),
        capacityGroup: location.capacityGroup || null,
        roles: normalizeRoles(location.roles || location.role || ['standing-use']),
        activation,
        pose,
        completion,
        activationSpot,
        position,
        objectCenter: objectCenter ? normalizePosition(objectCenter) : null,
        objectRotationRad: finiteNumber(location.objectRotationRad ?? objectRotationRad, 0),
        sortIndex: index,
      });
    })
    .sort(compareStandingCandidates);
  return freezeDeep(candidates);
}

export function resolveObjectUseStandingFacing({
  candidate = null,
  position = null,
  objectCenter = null,
  facingMode = null,
  facing = null,
  facingAngleRad = null,
  customFacingAngleRad = null,
  customFacingVector = null,
  objectRotationRad = null,
} = {}) {
  const pose = candidate?.pose || {};
  const mode = normalizeFacingMode(facingMode || pose.facingMode, 'object-front');
  const usePosition = normalizePosition(position || candidate?.position || candidate?.activationSpot || {});
  const center = objectCenter ? normalizePosition(objectCenter) : (candidate?.objectCenter || normalizePosition({ x: 0, z: 0 }));
  const rotation = finiteNumber(objectRotationRad ?? candidate?.objectRotationRad, 0);
  let angle = optionalFiniteNumber(facingAngleRad ?? pose.facingAngleRad, null);

  if (mode === 'custom') {
    angle = optionalFiniteNumber(customFacingAngleRad ?? pose.customFacingAngleRad, null) ?? vectorAngleRad(customFacingVector || pose.customFacingVector);
  } else if (mode === 'face-center') {
    angle = Math.atan2(center.x - usePosition.x, center.z - usePosition.z);
  } else if (mode === 'object-front') {
    angle = angle ?? cardinalFacingAngleRad(facing || pose.facing || candidate?.activationSpot?.facing || 'north', rotation);
  }

  return freezeDeep({
    mode,
    facingMode: mode,
    facingAngleRad: angle,
    position: usePosition,
    objectCenter: center,
    objectRotationRad: rotation,
  });
}

export function isObjectUseStandingSlotFree(slot, {
  reservations = [],
  occupiedSlotIds = [],
  ignoreReservationId = null,
} = {}) {
  if (!slot) return false;
  const occupied = normalizeOccupiedSlotIds(occupiedSlotIds);
  if (occupied.has(slot.slotId) || occupied.has(slot.activationSpotId) || occupied.has(slot.capacityKey)) return false;
  return !normalizeReservationList(reservations).some(reservation => {
    if (!reservation || reservation.id === ignoreReservationId) return false;
    return isActiveReservation(reservation) && reservationMatchesSlot(reservation, slot);
  });
}

export function filterFreeObjectUseStandingSlots(candidates = [], options = {}) {
  return freezeDeep((candidates || []).filter(slot => isObjectUseStandingSlotFree(slot, options)).sort(compareStandingCandidates));
}

export function chooseNearestFreeObjectUseStandingSlot(candidates = [], {
  agentPosition = { x: 0, z: 0 },
  reservations = [],
  occupiedSlotIds = [],
  ignoreReservationId = null,
} = {}) {
  const freeSlots = filterFreeObjectUseStandingSlots(candidates, { reservations, occupiedSlotIds, ignoreReservationId });
  if (!freeSlots.length) return null;
  const [selected] = freeSlots
    .map(slot => Object.freeze({ slot, distanceSq: distanceSq(agentPosition, slot.position) }))
    .sort((a, b) => (a.distanceSq - b.distanceSq) || compareStandingCandidates(a.slot, b.slot));
  return freezeDeep({ ...selected.slot, distanceSq: Number(selected.distanceSq.toFixed(6)) });
}

export function makeObjectUseStandingReservation(slot, {
  agentId,
  actionId = null,
  objectUseId = null,
  reservationId = null,
  nowMs = Date.now(),
  ttlMs = null,
  state = 'held',
} = {}) {
  if (!slot?.slotId) throw new Error('slot.slotId is required to reserve ObjectUse standing-use slot');
  const resolvedAgentId = stableString(agentId, null);
  if (!resolvedAgentId) throw new Error('agentId is required to reserve ObjectUse standing-use slot');
  const id = reservationId || `res:${slot.capacityKey}:${resolvedAgentId}:${nowMs}`;
  return freezeDeep({
    id,
    objectUseId: objectUseId || null,
    objectKey: slot.objectKey,
    slotId: slot.slotId,
    standingUseSlotId: slot.standingUseSlotId || slot.slotId,
    activationSpotId: slot.activationSpotId,
    approachSpotId: slot.approachSpotId || null,
    capacityKey: slot.capacityKey,
    agentId: resolvedAgentId,
    actionId: actionId || slot.actionId || null,
    activation: slot.activation,
    pose: slot.pose,
    completion: slot.completion,
    state,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: ttlMs ? nowMs + ttlMs : null,
  });
}

export function reserveObjectUseStandingSlot(store, slot, options = {}) {
  if (!store || typeof store !== 'object') throw new Error('reservation store object is required');
  if (!Array.isArray(store.reservations)) store.reservations = [];
  if (!isObjectUseStandingSlotFree(slot, { reservations: store.reservations, occupiedSlotIds: options.occupiedSlotIds || [] })) {
    return Object.freeze({ ok: false, reason: 'slot_reserved', slotId: slot?.slotId || null, capacityKey: slot?.capacityKey || null, reservations: store.reservations });
  }
  const reservation = makeObjectUseStandingReservation(slot, options);
  store.reservations.push(reservation);
  return Object.freeze({ ok: true, reservation, slot, reservations: store.reservations });
}

export function chooseAndReserveObjectUseStandingSlot(store, candidates, options = {}) {
  const slot = chooseNearestFreeObjectUseStandingSlot(candidates, { ...options, reservations: store?.reservations || options.reservations || [] });
  if (!slot) return freezeDeep({ ok: false, reason: 'no_free_slot', slot: null, reservation: null });
  return reserveObjectUseStandingSlot(store, slot, options);
}

export function activateObjectUseStandingReservation(store, {
  reservationId,
  agentId,
  slotId,
  candidate = null,
  agentPosition = null,
  approachPosition = null,
  activationPosition = null,
  objectCenter = null,
  agentBuildingId = null,
  objectBuildingId = null,
  agentFloor = null,
  objectFloor = null,
  nowMs = Date.now(),
} = {}) {
  const reservations = Array.isArray(store?.reservations) ? store.reservations : [];
  const index = reservations.findIndex(reservation => reservation.id === reservationId && reservation.agentId === agentId && reservation.slotId === slotId && isActiveReservation(reservation));
  if (index < 0) return Object.freeze({ ok: false, reason: 'reservation_not_found', reservationId, slotId });

  const reservation = reservations[index];
  const activation = candidate?.activation || reservation.activation || normalizeActivation();
  const pose = candidate?.pose || reservation.pose || normalizePose();
  const completion = candidate?.completion || reservation.completion || normalizeCompletion();
  const approachTarget = normalizePosition(approachPosition || candidate?.approachSpot || candidate?.position || {});
  const activationTarget = normalizePosition(activationPosition || candidate?.activationSpot || candidate?.position || approachTarget);
  const agentTarget = normalizePosition(agentPosition || approachTarget);
  const approachDistance = distance(agentTarget, approachTarget);
  const activationDistance = distance(approachTarget, activationTarget);
  const sameBuilding = !activation.requiresSameBuilding || !objectBuildingId || !agentBuildingId || objectBuildingId === agentBuildingId;
  const sameFloor = !activation.requiresSameFloor || objectFloor === undefined || objectFloor === null || agentFloor === undefined || agentFloor === null || Number(objectFloor) === Number(agentFloor);

  if (!sameBuilding) return Object.freeze({ ok: false, reason: 'building_mismatch', reservationId, slotId, sameBuilding, sameFloor });
  if (!sameFloor) return Object.freeze({ ok: false, reason: 'floor_mismatch', reservationId, slotId, sameBuilding, sameFloor });
  if (approachDistance > activation.approachRadius) return Object.freeze({ ok: false, reason: 'outside_approach_radius', reservationId, slotId, approachDistance: Number(approachDistance.toFixed(6)), approachRadius: activation.approachRadius });
  if (activationDistance > activation.activationRadius) return Object.freeze({ ok: false, reason: 'outside_activation_radius', reservationId, slotId, activationDistance: Number(activationDistance.toFixed(6)), activationRadius: activation.activationRadius });

  const facing = resolveObjectUseStandingFacing({ candidate, position: activationTarget, objectCenter, facingMode: pose.facingMode });
  const completesAtMs = completion.mode === 'timer' && completion.durationMs > 0 ? nowMs + completion.durationMs : null;
  const updated = freezeDeep({
    ...reservation,
    state: 'active',
    activeUse: {
      state: 'active',
      dockMode: activation.dockMode,
      docked: false,
      dockTarget: null,
      animationId: pose.animationId || null,
      poseId: pose.poseId || null,
      standing: true,
      facingMode: facing.facingMode,
      facingAngleRad: facing.facingAngleRad,
      startedAtMs: nowMs,
      completesAtMs,
    },
    completion: { ...completion, startedAtMs: nowMs, completesAtMs },
    debug: {
      reachableUseFrontSpot: Boolean(candidate?.reachableUseFrontSpot),
      approachDistance: Number(approachDistance.toFixed(6)),
      activationDistance: Number(activationDistance.toFixed(6)),
      sameBuilding,
      sameFloor,
      docked: false,
      facingMode: facing.facingMode,
      facingAngleRad: facing.facingAngleRad,
      timedCompletion: completion.mode === 'timer' && completion.durationMs > 0,
    },
    updatedAtMs: nowMs,
  });
  reservations[index] = updated;
  return Object.freeze({ ok: true, reservation: updated, activeUse: updated.activeUse, facing, debug: updated.debug });
}

export function completeObjectUseStandingReservation(store, {
  reservationId,
  agentId,
  slotId,
  terminalState = 'completed',
  reason = 'object-use-standing-complete',
  nowMs = Date.now(),
} = {}) {
  const reservations = Array.isArray(store?.reservations) ? store.reservations : [];
  const index = reservations.findIndex(reservation => reservation.id === reservationId && reservation.agentId === agentId && reservation.slotId === slotId);
  if (index < 0) return Object.freeze({ ok: false, reason: 'reservation_not_found', reservationId, slotId });
  const updated = freezeDeep({
    ...reservations[index],
    state: terminalState,
    activeUse: { ...(reservations[index].activeUse || {}), state: terminalState, completedBy: reason },
    terminalReason: reason,
    completedAtMs: nowMs,
    updatedAtMs: nowMs,
  });
  reservations[index] = updated;
  return Object.freeze({ ok: true, reservation: updated });
}

export function advanceTimedObjectUseStandingCompletion(store, {
  reservationId,
  agentId,
  slotId,
  nowMs = Date.now(),
  reason = 'object-use-standing-timer-complete',
} = {}) {
  const reservations = Array.isArray(store?.reservations) ? store.reservations : [];
  const reservation = reservations.find(item => item.id === reservationId && item.agentId === agentId && item.slotId === slotId);
  if (!reservation) return Object.freeze({ ok: false, reason: 'reservation_not_found', reservationId, slotId });
  const completesAtMs = reservation.activeUse?.completesAtMs ?? reservation.completion?.completesAtMs;
  if (!Number.isFinite(Number(completesAtMs))) return Object.freeze({ ok: false, reason: 'not_timed', reservation });
  if (nowMs < Number(completesAtMs)) return Object.freeze({ ok: true, completed: false, remainingMs: Number(completesAtMs) - nowMs, reservation });
  const completed = completeObjectUseStandingReservation(store, { reservationId, agentId, slotId, terminalState: reservation.completion?.terminalState || 'completed', reason, nowMs });
  return Object.freeze({ ...completed, completed: completed.ok });
}

export function releaseObjectUseStandingReservation(store, {
  reservationId,
  agentId,
  slotId,
  terminalState = 'released',
  reason = 'object-use-standing-release',
  nowMs = Date.now(),
} = {}) {
  const reservations = Array.isArray(store?.reservations) ? store.reservations : [];
  const index = reservations.findIndex(reservation => reservation.id === reservationId && reservation.agentId === agentId && reservation.slotId === slotId);
  if (index < 0) return Object.freeze({ ok: false, reason: 'reservation_not_found', reservationId, slotId });
  const updated = freezeDeep({
    ...reservations[index],
    state: terminalState,
    activeUse: { ...(reservations[index].activeUse || {}), state: terminalState, releasedBy: reason },
    releaseReason: reason,
    releasedAtMs: nowMs,
    updatedAtMs: nowMs,
  });
  reservations[index] = updated;
  return Object.freeze({ ok: true, reservation: updated });
}
