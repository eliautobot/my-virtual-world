/**
 * Agent Life ObjectUse active-use selection and reservation helpers.
 *
 * Phase 3D shared helper for non-seating active-use objects such as
 * treadmills, training mats, gym benches, playground equipment, and outdoor
 * exercise stations. It mirrors the Phase 3C seating lifecycle without adding
 * routing: callers reserve an active-use slot here, route to the reachable
 * approach spot through the existing AgentIntent/setAgentTarget path, then call
 * the activation/completion helpers after route arrival.
 */

export const OBJECT_USE_ACTIVE_HELPER_VERSION = 'agent-life-object-use-active/v1';

export const OBJECT_USE_ACTIVE_RESERVATION_STATES = Object.freeze([
  'held',
  'active',
  'reserved',
  'route_pending',
  'routing',
  'arrived',
  'docked',
  'using',
  'in_progress',
  'completing',
  'completed',
  'cancelled',
  'failed',
  'expired',
]);

const ACTIVE_USE_ROLES = Object.freeze(['exercise', 'active-use', 'use', 'train', 'workout', 'play', 'slide', 'swing']);
const APPROACH_ROLES = Object.freeze(['approach', 'queue', 'step-off', 'staging']);

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value, fallback) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
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

function hasAnyRole(location = {}, allowedRoles = ACTIVE_USE_ROLES) {
  const roles = normalizeRoles(location.roles || location.role);
  const id = stableString(location.id).toLowerCase();
  return roles.some(role => allowedRoles.includes(role)) || allowedRoles.some(role => id.includes(role));
}

function isApproachOnly(location = {}) {
  const roles = normalizeRoles(location.roles || location.role);
  const id = stableString(location.id).toLowerCase();
  return roles.some(role => APPROACH_ROLES.includes(role)) && !hasAnyRole(location) && !id.includes('belt') && !id.includes('mat') && !id.includes('station');
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
    activationRadius: positiveNumber(location.activationRadius ?? defaults.activationRadius, 10),
    snapRadius: positiveNumber(location.snapRadius ?? defaults.snapRadius, 8),
    dockMode: location.dockMode || defaults.dockMode || 'snap-to-activation',
    requiresLineOfSight: Boolean(location.requiresLineOfSight ?? defaults.requiresLineOfSight ?? false),
    requiresSameFloor: location.requiresSameFloor !== false && defaults.requiresSameFloor !== false,
    requiresSameBuilding: location.requiresSameBuilding !== false && defaults.requiresSameBuilding !== false,
  });
}

function normalizePose(location = {}, defaults = {}) {
  const dockMode = location.dockMode || defaults.dockMode || 'snap-to-activation';
  return freezeDeep({
    animationId: stableString(location.animationId || location.poseAnimationId || defaults.animationId, null),
    poseId: stableString(location.poseId || defaults.poseId, null),
    facingMode: location.facingMode || defaults.facingMode || (location.facing && location.facing !== 'auto' ? 'object-front' : 'any'),
    facingAngleRad: Number.isFinite(Number(location.facingAngleRad ?? defaults.facingAngleRad)) ? Number(location.facingAngleRad ?? defaults.facingAngleRad) : null,
    facing: location.facing || defaults.facing || null,
    snapToActivation: Boolean(location.snapToActivation ?? defaults.snapToActivation ?? (dockMode === 'snap-to-activation' || dockMode === 'snap-with-offset')),
    dockOffset: location.dockOffset || defaults.dockOffset || null,
    seated: Boolean(location.seated ?? defaults.seated ?? false),
    standing: Boolean(location.standing ?? defaults.standing ?? false),
    exercise: location.exercise !== false && defaults.exercise !== false,
  });
}

function compareActiveCandidates(a, b) {
  return String(a?.slotId || '').localeCompare(String(b?.slotId || '')) || (a?.sortIndex || 0) - (b?.sortIndex || 0);
}

function normalizeReservationList(reservations = []) {
  if (Array.isArray(reservations)) return reservations;
  if (reservations instanceof Map) return [...reservations.values()];
  if (reservations && typeof reservations === 'object') return Object.values(reservations);
  return [];
}

function isActiveReservation(reservation = {}) {
  return OBJECT_USE_ACTIVE_RESERVATION_STATES.includes(reservation.state || reservation.status);
}

function reservationMatchesSlot(reservation = {}, slot = {}) {
  const reservationSlotId = reservation.slotId || reservation.spotId || reservation.activationSpotId || reservation.interactionSpotId;
  const reservationCapacityKey = reservation.capacityKey || getObjectUseActiveCapacityKey(reservation.objectKey || reservation.objectInstanceId, reservationSlotId);
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

export function getObjectUseActiveCapacityKey(objectKey, slotId) {
  const key = stableString(objectKey, 'unknown-object');
  const slot = stableString(slotId, 'object');
  return `${key}:active:${slot}`;
}

export function listObjectUseActiveCandidates({
  locations = [],
  activationSpots = null,
  objectKey = null,
  objectType = null,
  actionId = null,
  approachSpotId = null,
  activeRoles = ACTIVE_USE_ROLES,
  activationDefaults = {},
  poseDefaults = {},
} = {}) {
  const spots = Array.isArray(activationSpots) ? activationSpots : locations;
  const approachById = new Map((locations || []).map(location => [location.id, location]));
  const candidates = spots
    .filter(location => location && !isApproachOnly(location) && hasAnyRole(location, activeRoles))
    .map((location, index) => {
      const slotId = stableString(location.slotId || location.activeUseSlotId || location.activationSpotId || location.id, `active-${index + 1}`);
      const selectedApproachSpotId = stableString(location.approachSpotId || approachSpotId, null);
      const approachSpot = selectedApproachSpotId ? (approachById.get(selectedApproachSpotId) || null) : null;
      const capacity = capacityFor(location);
      const resolvedObjectKey = stableString(objectKey, null);
      const activation = normalizeActivation(location, activationDefaults);
      const pose = normalizePose(location, { ...poseDefaults, dockMode: activation.dockMode });
      return freezeDeep({
        slotId,
        activeUseSlotId: slotId,
        activationSpotId: stableString(location.activationSpotId || location.id, slotId),
        approachSpotId: selectedApproachSpotId,
        approachSpot,
        objectKey: resolvedObjectKey,
        objectType: stableString(objectType || location.assetId, null),
        actionId: stableString(actionId || location.actionId || location.action, null),
        capacityKey: getObjectUseActiveCapacityKey(resolvedObjectKey, slotId),
        capacity,
        capacityGroup: location.capacityGroup || null,
        roles: normalizeRoles(location.roles || location.role || ['active-use']),
        activation,
        pose,
        activationSpot: freezeDeep({ ...location, position: normalizePosition(location) }),
        position: normalizePosition(location),
        sortIndex: index,
      });
    })
    .sort(compareActiveCandidates);
  return freezeDeep(candidates);
}

export function isObjectUseActiveSlotFree(slot, {
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

export function filterFreeObjectUseActiveSlots(candidates = [], options = {}) {
  return freezeDeep((candidates || []).filter(slot => isObjectUseActiveSlotFree(slot, options)).sort(compareActiveCandidates));
}

export function chooseNearestFreeObjectUseActiveSlot(candidates = [], {
  agentPosition = { x: 0, z: 0 },
  reservations = [],
  occupiedSlotIds = [],
  ignoreReservationId = null,
} = {}) {
  const freeSlots = filterFreeObjectUseActiveSlots(candidates, { reservations, occupiedSlotIds, ignoreReservationId });
  if (!freeSlots.length) return null;
  const [selected] = freeSlots
    .map(slot => Object.freeze({ slot, distanceSq: distanceSq(agentPosition, slot.position) }))
    .sort((a, b) => (a.distanceSq - b.distanceSq) || compareActiveCandidates(a.slot, b.slot));
  return freezeDeep({ ...selected.slot, distanceSq: Number(selected.distanceSq.toFixed(6)) });
}

export function makeObjectUseActiveReservation(slot, {
  agentId,
  actionId = null,
  objectUseId = null,
  reservationId = null,
  nowMs = Date.now(),
  ttlMs = null,
  state = 'held',
} = {}) {
  if (!slot?.slotId) throw new Error('slot.slotId is required to reserve ObjectUse active-use slot');
  const resolvedAgentId = stableString(agentId, null);
  if (!resolvedAgentId) throw new Error('agentId is required to reserve ObjectUse active-use slot');
  const id = reservationId || `res:${slot.capacityKey}:${resolvedAgentId}:${nowMs}`;
  return freezeDeep({
    id,
    objectUseId: objectUseId || null,
    objectKey: slot.objectKey,
    slotId: slot.slotId,
    activeUseSlotId: slot.activeUseSlotId || slot.slotId,
    activationSpotId: slot.activationSpotId,
    approachSpotId: slot.approachSpotId || null,
    capacityKey: slot.capacityKey,
    agentId: resolvedAgentId,
    actionId: actionId || slot.actionId || null,
    activation: slot.activation,
    pose: slot.pose,
    state,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: ttlMs ? nowMs + ttlMs : null,
  });
}

export function reserveObjectUseActiveSlot(store, slot, options = {}) {
  if (!store || typeof store !== 'object') throw new Error('reservation store object is required');
  if (!Array.isArray(store.reservations)) store.reservations = [];
  if (!isObjectUseActiveSlotFree(slot, { reservations: store.reservations, occupiedSlotIds: options.occupiedSlotIds || [] })) {
    return Object.freeze({ ok: false, reason: 'slot_reserved', slotId: slot?.slotId || null, capacityKey: slot?.capacityKey || null, reservations: store.reservations });
  }
  const reservation = makeObjectUseActiveReservation(slot, options);
  store.reservations.push(reservation);
  return Object.freeze({ ok: true, reservation, slot, reservations: store.reservations });
}

export function chooseAndReserveObjectUseActiveSlot(store, candidates, options = {}) {
  const slot = chooseNearestFreeObjectUseActiveSlot(candidates, { ...options, reservations: store?.reservations || options.reservations || [] });
  if (!slot) return freezeDeep({ ok: false, reason: 'no_free_slot', slot: null, reservation: null });
  return reserveObjectUseActiveSlot(store, slot, options);
}

export function activateObjectUseActiveReservation(store, {
  reservationId,
  agentId,
  slotId,
  candidate = null,
  agentPosition = null,
  approachPosition = null,
  activationPosition = null,
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
  const approachTarget = normalizePosition(approachPosition || candidate?.approachSpot || {});
  const activationTarget = normalizePosition(activationPosition || candidate?.activationSpot || candidate?.position || {});
  const agentTarget = normalizePosition(agentPosition || approachTarget);
  const approachDistance = distance(agentTarget, approachTarget);
  const activationDistance = distance(approachTarget, activationTarget);
  const sameBuilding = !activation.requiresSameBuilding || !objectBuildingId || !agentBuildingId || objectBuildingId === agentBuildingId;
  const sameFloor = !activation.requiresSameFloor || objectFloor === undefined || objectFloor === null || agentFloor === undefined || agentFloor === null || Number(objectFloor) === Number(agentFloor);

  if (!sameBuilding) return Object.freeze({ ok: false, reason: 'building_mismatch', reservationId, slotId, sameBuilding, sameFloor });
  if (!sameFloor) return Object.freeze({ ok: false, reason: 'floor_mismatch', reservationId, slotId, sameBuilding, sameFloor });
  if (approachDistance > activation.approachRadius) return Object.freeze({ ok: false, reason: 'outside_approach_radius', reservationId, slotId, approachDistance: Number(approachDistance.toFixed(6)), approachRadius: activation.approachRadius });
  if (activationDistance > activation.activationRadius) return Object.freeze({ ok: false, reason: 'outside_activation_radius', reservationId, slotId, activationDistance: Number(activationDistance.toFixed(6)), activationRadius: activation.activationRadius });

  const shouldDock = pose.snapToActivation || ['snap-to-activation', 'snap-with-offset', 'animation-root'].includes(activation.dockMode);
  const dockDistance = distance(agentTarget, activationTarget);
  if (shouldDock && dockDistance > activation.snapRadius) return Object.freeze({ ok: false, reason: 'outside_snap_radius', reservationId, slotId, dockDistance: Number(dockDistance.toFixed(6)), snapRadius: activation.snapRadius });

  const dockTarget = shouldDock ? freezeDeep({ ...activationTarget, ...(pose.dockOffset ? { dockOffset: pose.dockOffset } : {}) }) : null;
  const updated = freezeDeep({
    ...reservation,
    state: shouldDock ? 'docked' : 'active',
    activeUse: {
      state: shouldDock ? 'docked' : 'active',
      dockMode: activation.dockMode,
      docked: shouldDock,
      dockTarget,
      animationId: pose.animationId || null,
      poseId: pose.poseId || null,
      facingMode: pose.facingMode,
      facingAngleRad: pose.facingAngleRad ?? null,
    },
    debug: {
      approachDistance: Number(approachDistance.toFixed(6)),
      activationDistance: Number(activationDistance.toFixed(6)),
      dockDistance: Number(dockDistance.toFixed(6)),
      sameBuilding,
      sameFloor,
      docked: shouldDock,
    },
    updatedAtMs: nowMs,
  });
  reservations[index] = updated;
  return Object.freeze({ ok: true, reservation: updated, activeUse: updated.activeUse, dockTarget, debug: updated.debug });
}

export function completeObjectUseActiveReservation(store, {
  reservationId,
  agentId,
  slotId,
  terminalState = 'completed',
  reason = 'object-use-active-complete',
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

export function releaseObjectUseActiveReservation(store, {
  reservationId,
  agentId,
  slotId,
  terminalState = 'released',
  reason = 'object-use-active-release',
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
