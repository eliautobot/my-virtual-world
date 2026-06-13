/**
 * Agent Life ObjectUse seat selection and per-seat reservation helpers.
 *
 * Phase 3C shared helper for seating/multi-seat objects. This module is
 * intentionally side-effect-free except for the explicit reservation-store
 * functions below. It does not route agents or modify dynamic route executors;
 * callers choose/reserve a seat here, then hand the resolved approach spot to
 * the existing AgentIntent/setAgentTarget path.
 */

export const OBJECT_USE_SEAT_HELPER_VERSION = 'agent-life-object-use-seats/v1';

export const OBJECT_USE_SEAT_ACTIVE_RESERVATION_STATES = Object.freeze([
  'held',
  'active',
  'reserved',
  'route_pending',
  'routing',
  'arrived',
  'in_progress',
]);

const SEAT_ROLES = Object.freeze(['seat', 'sit', 'rest', 'wait', 'meeting', 'social', 'eat']);

function finiteNumber(value, fallback = 0) {
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
    z: finiteNumber(source.z ?? source.dz, 0),
  });
}

function normalizeRoles(raw = []) {
  const roles = Array.isArray(raw) ? raw : [raw].filter(Boolean);
  return Object.freeze([...new Set(roles.map(role => String(role)).filter(Boolean))]);
}

function hasSeatRole(location = {}, allowedRoles = SEAT_ROLES) {
  const roles = normalizeRoles(location.roles || location.role);
  const id = stableString(location.id).toLowerCase();
  return roles.some(role => allowedRoles.includes(role)) || id.includes('seat') || id.includes('sit');
}

function isApproachOnly(location = {}) {
  const roles = normalizeRoles(location.roles || location.role);
  const id = stableString(location.id).toLowerCase();
  return roles.includes('approach') && !roles.some(role => SEAT_ROLES.includes(role)) && !id.includes('seat') && !id.includes('sit');
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

export function getObjectUseSeatCapacityKey(objectKey, seatId) {
  const key = stableString(objectKey, 'unknown-object');
  const seat = stableString(seatId, 'object');
  return `${key}:seat:${seat}`;
}

export function listObjectUseSeatCandidates({
  locations = [],
  activationSpots = null,
  objectKey = null,
  objectType = null,
  actionId = null,
  approachSpotId = null,
  seatRoles = SEAT_ROLES,
} = {}) {
  const spots = Array.isArray(activationSpots) ? activationSpots : locations;
  const approachById = new Map((locations || []).map(location => [location.id, location]));
  const candidates = spots
    .filter(location => location && !isApproachOnly(location) && hasSeatRole(location, seatRoles))
    .map((location, index) => {
      const seatId = stableString(location.seatId || location.activationSpotId || location.id, `seat-${index + 1}`);
      const selectedApproachSpotId = stableString(location.approachSpotId || approachSpotId, null);
      const approachSpot = selectedApproachSpotId ? (approachById.get(selectedApproachSpotId) || null) : null;
      const capacity = capacityFor(location);
      return freezeDeep({
        seatId,
        activationSpotId: stableString(location.activationSpotId || location.id, seatId),
        approachSpotId: selectedApproachSpotId,
        approachSpot,
        objectKey: stableString(objectKey, null),
        objectType: stableString(objectType || location.assetId, null),
        actionId: stableString(actionId || location.actionId || location.action, null),
        capacityKey: getObjectUseSeatCapacityKey(objectKey, seatId),
        capacity,
        capacityGroup: location.capacityGroup || null,
        roles: normalizeRoles(location.roles || location.role || ['seat']),
        facingMode: location.facingMode || (location.facing && location.facing !== 'auto' ? 'object-front' : 'any'),
        facing: location.facing || null,
        activationSpot: freezeDeep({ ...location, position: normalizePosition(location) }),
        position: normalizePosition(location),
        sortIndex: index,
      });
    })
    .sort(compareSeatCandidates);
  return freezeDeep(candidates);
}

function isActiveReservation(reservation = {}) {
  const state = reservation.state || reservation.status;
  return OBJECT_USE_SEAT_ACTIVE_RESERVATION_STATES.includes(state);
}

function reservationMatchesSeat(reservation = {}, seat = {}) {
  const reservationSeatId = reservation.seatId || reservation.spotId || reservation.activationSpotId || reservation.interactionSpotId;
  const reservationCapacityKey = reservation.capacityKey || getObjectUseSeatCapacityKey(reservation.objectKey || reservation.objectInstanceId, reservationSeatId);
  return reservationCapacityKey === seat.capacityKey || (
    stableString(reservation.objectKey || reservation.objectInstanceId, null) === seat.objectKey &&
    stableString(reservationSeatId, null) === seat.seatId
  );
}

function normalizeReservationList(reservations = []) {
  if (Array.isArray(reservations)) return reservations;
  if (reservations instanceof Map) return [...reservations.values()];
  if (reservations && typeof reservations === 'object') return Object.values(reservations);
  return [];
}

function normalizeOccupiedSeatIds(occupiedSeatIds = []) {
  if (occupiedSeatIds instanceof Set) return occupiedSeatIds;
  const ids = Array.isArray(occupiedSeatIds) ? occupiedSeatIds : Object.values(occupiedSeatIds || {});
  return new Set(ids.map(value => typeof value === 'object' ? (value.seatId || value.spotId || value.id) : value).filter(Boolean));
}

export function isObjectUseSeatFree(seat, {
  reservations = [],
  occupiedSeatIds = [],
  ignoreReservationId = null,
} = {}) {
  if (!seat) return false;
  const occupied = normalizeOccupiedSeatIds(occupiedSeatIds);
  if (occupied.has(seat.seatId) || occupied.has(seat.activationSpotId) || occupied.has(seat.capacityKey)) return false;
  return !normalizeReservationList(reservations).some(reservation => {
    if (!reservation || reservation.id === ignoreReservationId) return false;
    return isActiveReservation(reservation) && reservationMatchesSeat(reservation, seat);
  });
}

export function filterFreeObjectUseSeats(candidates = [], options = {}) {
  return freezeDeep((candidates || []).filter(seat => isObjectUseSeatFree(seat, options)).sort(compareSeatCandidates));
}

function distanceSq(position = {}, target = {}) {
  const dx = finiteNumber(position.x, 0) - finiteNumber(target.x, 0);
  const dz = finiteNumber(position.z ?? position.y, 0) - finiteNumber(target.z ?? target.y, 0);
  return dx * dx + dz * dz;
}

function compareSeatCandidates(a, b) {
  return String(a?.seatId || '').localeCompare(String(b?.seatId || '')) || (a?.sortIndex || 0) - (b?.sortIndex || 0);
}

export function chooseNearestFreeObjectUseSeat(candidates = [], {
  agentPosition = { x: 0, z: 0 },
  reservations = [],
  occupiedSeatIds = [],
  ignoreReservationId = null,
} = {}) {
  const freeSeats = filterFreeObjectUseSeats(candidates, { reservations, occupiedSeatIds, ignoreReservationId });
  if (!freeSeats.length) return null;
  const [selected] = freeSeats
    .map(seat => Object.freeze({ seat, distanceSq: distanceSq(agentPosition, seat.position) }))
    .sort((a, b) => (a.distanceSq - b.distanceSq) || compareSeatCandidates(a.seat, b.seat));
  return freezeDeep({ ...selected.seat, distanceSq: Number(selected.distanceSq.toFixed(6)) });
}

export function makeObjectUseSeatReservation(seat, {
  agentId,
  actionId = null,
  objectUseId = null,
  reservationId = null,
  nowMs = Date.now(),
  ttlMs = null,
  state = 'held',
} = {}) {
  if (!seat?.seatId) throw new Error('seat.seatId is required to reserve ObjectUse seat');
  const resolvedAgentId = stableString(agentId, null);
  if (!resolvedAgentId) throw new Error('agentId is required to reserve ObjectUse seat');
  const id = reservationId || `res:${seat.capacityKey}:${resolvedAgentId}:${nowMs}`;
  return freezeDeep({
    id,
    objectUseId: objectUseId || null,
    objectKey: seat.objectKey,
    seatId: seat.seatId,
    activationSpotId: seat.activationSpotId,
    approachSpotId: seat.approachSpotId || null,
    capacityKey: seat.capacityKey,
    agentId: resolvedAgentId,
    actionId: actionId || seat.actionId || null,
    state,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    expiresAtMs: ttlMs ? nowMs + ttlMs : null,
  });
}

export function reserveObjectUseSeat(store, seat, options = {}) {
  if (!store || typeof store !== 'object') throw new Error('reservation store object is required');
  if (!Array.isArray(store.reservations)) store.reservations = [];
  if (!isObjectUseSeatFree(seat, { reservations: store.reservations, occupiedSeatIds: options.occupiedSeatIds || [] })) {
    return Object.freeze({ ok: false, reason: 'seat_reserved', seatId: seat?.seatId || null, capacityKey: seat?.capacityKey || null, reservations: store.reservations });
  }
  const reservation = makeObjectUseSeatReservation(seat, options);
  store.reservations.push(reservation);
  return Object.freeze({ ok: true, reservation, seat, reservations: store.reservations });
}

export function activateObjectUseSeatReservation(store, {
  reservationId,
  agentId,
  seatId,
  nowMs = Date.now(),
} = {}) {
  const reservations = Array.isArray(store?.reservations) ? store.reservations : [];
  const index = reservations.findIndex(reservation => reservation.id === reservationId && reservation.agentId === agentId && reservation.seatId === seatId && isActiveReservation(reservation));
  if (index < 0) return Object.freeze({ ok: false, reason: 'reservation_not_found', reservationId, seatId });
  const updated = freezeDeep({ ...reservations[index], state: 'active', updatedAtMs: nowMs });
  reservations[index] = updated;
  return Object.freeze({ ok: true, reservation: updated });
}

export function releaseObjectUseSeatReservation(store, {
  reservationId,
  agentId,
  seatId,
  terminalState = 'released',
  reason = 'object-use-release',
  nowMs = Date.now(),
} = {}) {
  const reservations = Array.isArray(store?.reservations) ? store.reservations : [];
  const index = reservations.findIndex(reservation => reservation.id === reservationId && reservation.agentId === agentId && reservation.seatId === seatId);
  if (index < 0) return Object.freeze({ ok: false, reason: 'reservation_not_found', reservationId, seatId });
  const updated = freezeDeep({ ...reservations[index], state: terminalState, releaseReason: reason, releasedAtMs: nowMs, updatedAtMs: nowMs });
  reservations[index] = updated;
  return Object.freeze({ ok: true, reservation: updated });
}

export function chooseAndReserveObjectUseSeat(store, candidates, options = {}) {
  const seat = chooseNearestFreeObjectUseSeat(candidates, { ...options, reservations: store?.reservations || options.reservations || [] });
  if (!seat) return freezeDeep({ ok: false, reason: 'no_free_seat', seat: null, reservation: null });
  return reserveObjectUseSeat(store, seat, options);
}
