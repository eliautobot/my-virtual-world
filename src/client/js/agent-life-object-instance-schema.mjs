/**
 * Agent Life placed-object instance schema.
 *
 * Object instances are persisted placement/state records that reference catalog
 * definitions by id. This module is metadata/validation only: importing it must
 * not create furniture, routes, colliders, reservations, actions, or API writes.
 */
import {
  OBJECT_CATALOG_EXAMPLES,
  OBJECT_ACTION_PERMISSION_LEVELS,
  CURRENT_RUNTIME_FURNITURE_IDS,
  validateObjectCatalogDefinition,
} from './agent-life-object-catalog-schema.mjs';

export const OBJECT_INSTANCE_SCHEMA_VERSION = 'agent-life-object-instance/v1';

export const OBJECT_INSTANCE_LOCATION_KINDS = Object.freeze(['building-interior', 'building-exterior', 'world']);
export const OBJECT_INSTANCE_ROTATION_UNITS = Object.freeze(['deg']);
export const OBJECT_INSTANCE_STATE_STATUSES = Object.freeze(['idle', 'reserved', 'routing', 'in_use', 'cooldown', 'disabled', 'blocked']);
export const OBJECT_INSTANCE_RESERVATION_STATUSES = Object.freeze(['none', 'held', 'active', 'released', 'expired', 'cancelled']);
export const OBJECT_INSTANCE_PERMISSION_MODES = Object.freeze(['inherit', 'override', 'locked']);

export const CURRENT_RUNTIME_PLACED_OBJECT_SOURCES = Object.freeze([
  'building.interior.furniture[]',
  'building.interior.walls[]',
  'world-meta.decorations[]',
]);

export const OBJECT_INSTANCE_SCHEMA_FIELDS = Object.freeze([
  Object.freeze({ key: 'id', required: true, type: 'string', meaning: 'Stable placed-object instance id. It identifies this physical object independently from the reusable catalog definition.' }),
  Object.freeze({ key: 'catalogId', required: true, type: 'string', meaning: 'Catalog definition id from Task 4. Existing furniture may map type -> catalogId, but must not embed the whole catalog definition.' }),
  Object.freeze({ key: 'location', required: true, type: 'object', meaning: 'Placement scope and coordinates: building id/floor for interiors, or world position for outdoor objects.' }),
  Object.freeze({ key: 'rotation', required: true, type: 'object', meaning: 'Object-local rotation stored with the instance so placement persists separately from catalog metadata.' }),
  Object.freeze({ key: 'state', required: true, type: 'object', meaning: 'Mutable placed-object state such as idle, reserved, in_use, disabled, current state id, and timestamps.' }),
  Object.freeze({ key: 'reservation', required: true, type: 'object', meaning: 'Current reservation/action linkage: reservation id, action id, agent id, spot id, and lifecycle status.' }),
  Object.freeze({ key: 'permissions', required: true, type: 'object', meaning: 'Instance-level permission mode/level and allow/deny overrides without granting real application authority.' }),
  Object.freeze({ key: 'runtimeAdapters', required: false, type: 'object', meaning: 'Optional migration hints to current furniture/wall/decoration records and server persistence shape.' }),
]);

export const OBJECT_INSTANCE_VALIDATION_EXPECTATIONS = Object.freeze([
  'Object instances are persisted placement/state records that reference catalogId; catalog definitions remain reusable metadata and must not be copied into every instance.',
  'location supports current building.interior.furniture[] records by preserving buildingId, floor, x/z local coordinates, and optional world coordinates for exterior/world placements.',
  'rotation is stored on the instance because current furniture records already carry per-object rotation separate from furniture type.',
  'state and reservation are mutable instance data; they intentionally do not alter Task 4 catalog animation/action definitions.',
  'permissions attach to the instance with public/assigned-role/manager/admin/owner-only levels and inherit/override/locked modes, but do not grant real tool/file/admin authority.',
  'runtimeAdapters document additive migration from existing furniture type/x/z/floor/assignedTo fields and must not replace current building persistence in Phase 0.',
  'Validation accepts current runtime furniture ids as catalogId aliases until Phase 1 registry mapping introduces full catalog entries for every placed furniture type.',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStableId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$/.test(value);
}

function isActionId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9]+(?:[-_.][a-zA-Z0-9]+)*$/.test(value);
}

function assertStringArray(value, path, errors, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  if (!allowEmpty && value.length === 0) errors.push(`${path} must not be empty`);
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !item.trim()) errors.push(`${path}[${index}] must be a non-empty string`);
  });
  return value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
}

function assertFiniteNumber(value, path, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
  }
}

function assertPositiveInteger(value, path, errors) {
  if (!Number.isInteger(value) || value < 1) errors.push(`${path} must be an integer >= 1`);
}

function normalizeRotationDeg(value = 0) {
  const n = Number(value) || 0;
  return ((n % 360) + 360) % 360;
}

function knownCatalogIds() {
  return new Set([
    ...OBJECT_CATALOG_EXAMPLES.map(object => object.id),
    ...CURRENT_RUNTIME_FURNITURE_IDS,
  ]);
}

function validateLocation(location, errors) {
  if (!isRecord(location)) {
    errors.push('location must be an object');
    return;
  }
  if (!OBJECT_INSTANCE_LOCATION_KINDS.includes(location.kind)) {
    errors.push(`location.kind must be one of ${OBJECT_INSTANCE_LOCATION_KINDS.join(', ')}`);
  }
  const isBuildingScoped = ['building-interior', 'building-exterior'].includes(location.kind);
  if (isBuildingScoped && (typeof location.buildingId !== 'string' || !location.buildingId.trim())) {
    errors.push('location.buildingId must be a non-empty string for building-scoped instances');
  }
  if (location.kind === 'building-interior') {
    assertPositiveInteger(location.floor, 'location.floor', errors);
    assertFiniteNumber(location.x, 'location.x', errors);
    assertFiniteNumber(location.z, 'location.z', errors);
  }
  if (location.kind === 'world' || location.kind === 'building-exterior') {
    assertFiniteNumber(location.worldX, 'location.worldX', errors);
    assertFiniteNumber(location.worldZ, 'location.worldZ', errors);
    if (location.floor !== undefined) assertPositiveInteger(location.floor, 'location.floor', errors);
  }
}

function validateRotation(rotation, errors) {
  if (!isRecord(rotation)) {
    errors.push('rotation must be an object');
    return;
  }
  if (!OBJECT_INSTANCE_ROTATION_UNITS.includes(rotation.unit)) errors.push(`rotation.unit must be one of ${OBJECT_INSTANCE_ROTATION_UNITS.join(', ')}`);
  assertFiniteNumber(rotation.value, 'rotation.value', errors);
}

function validateState(state, errors) {
  if (!isRecord(state)) {
    errors.push('state must be an object');
    return;
  }
  if (!OBJECT_INSTANCE_STATE_STATUSES.includes(state.status)) errors.push(`state.status must be one of ${OBJECT_INSTANCE_STATE_STATUSES.join(', ')}`);
  if (state.stateId !== undefined && !isStableId(state.stateId)) errors.push('state.stateId must be a stable id when present');
  if (state.actionId !== undefined && state.actionId !== null && !isActionId(state.actionId)) errors.push('state.actionId must be a stable action id or null when present');
  if (state.updatedAt !== undefined && typeof state.updatedAt !== 'string') errors.push('state.updatedAt must be an ISO timestamp string when present');
  if (state.data !== undefined && !isRecord(state.data)) errors.push('state.data must be an object when present');
}

function validateReservation(reservation, errors) {
  if (!isRecord(reservation)) {
    errors.push('reservation must be an object');
    return;
  }
  if (!OBJECT_INSTANCE_RESERVATION_STATUSES.includes(reservation.status)) errors.push(`reservation.status must be one of ${OBJECT_INSTANCE_RESERVATION_STATUSES.join(', ')}`);
  for (const key of ['id', 'actionId', 'agentId', 'spotId']) {
    if (reservation[key] !== undefined && reservation[key] !== null && (typeof reservation[key] !== 'string' || !reservation[key].trim())) {
      errors.push(`reservation.${key} must be a non-empty string or null when present`);
    }
  }
  if (reservation.actionId !== undefined && reservation.actionId !== null && !isActionId(reservation.actionId)) errors.push('reservation.actionId must be a stable action id or null when present');
  if (reservation.expiresAt !== undefined && reservation.expiresAt !== null && typeof reservation.expiresAt !== 'string') errors.push('reservation.expiresAt must be an ISO timestamp string or null when present');
}

function validatePermissions(permissions, errors) {
  if (!isRecord(permissions)) {
    errors.push('permissions must be an object');
    return;
  }
  if (!OBJECT_INSTANCE_PERMISSION_MODES.includes(permissions.mode)) errors.push(`permissions.mode must be one of ${OBJECT_INSTANCE_PERMISSION_MODES.join(', ')}`);
  if (!OBJECT_ACTION_PERMISSION_LEVELS.includes(permissions.level)) errors.push(`permissions.level must be one of ${OBJECT_ACTION_PERMISSION_LEVELS.join(', ')}`);
  assertStringArray(permissions.allowedAgentIds || [], 'permissions.allowedAgentIds', errors);
  assertStringArray(permissions.deniedAgentIds || [], 'permissions.deniedAgentIds', errors);
  assertStringArray(permissions.roles || [], 'permissions.roles', errors);
}

function validateRuntimeAdapters(runtimeAdapters, errors) {
  if (runtimeAdapters === undefined) return;
  if (!isRecord(runtimeAdapters)) {
    errors.push('runtimeAdapters must be an object when present');
    return;
  }
  if (runtimeAdapters.source !== undefined && !CURRENT_RUNTIME_PLACED_OBJECT_SOURCES.includes(runtimeAdapters.source)) {
    errors.push(`runtimeAdapters.source must be one of ${CURRENT_RUNTIME_PLACED_OBJECT_SOURCES.join(', ')}`);
  }
  if (runtimeAdapters.furnitureType !== undefined && runtimeAdapters.furnitureType !== null && typeof runtimeAdapters.furnitureType !== 'string') errors.push('runtimeAdapters.furnitureType must be a string or null when present');
  if (runtimeAdapters.furnitureIndex !== undefined && (!Number.isInteger(runtimeAdapters.furnitureIndex) || runtimeAdapters.furnitureIndex < 0)) errors.push('runtimeAdapters.furnitureIndex must be an integer >= 0 when present');
  if (runtimeAdapters.assignedTo !== undefined && runtimeAdapters.assignedTo !== null && typeof runtimeAdapters.assignedTo !== 'string') errors.push('runtimeAdapters.assignedTo must be a string or null when present');
  if (runtimeAdapters.persistencePath !== undefined && typeof runtimeAdapters.persistencePath !== 'string') errors.push('runtimeAdapters.persistencePath must be a string when present');
}

export function validateObjectInstance(instance) {
  const errors = [];
  const warnings = [];

  if (!isRecord(instance)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['object instance must be an object']), warnings: Object.freeze([]) });
  }

  if (!isStableId(instance.id)) errors.push('id must be a stable id using letters, numbers, hyphens, or underscores');
  if (!isStableId(instance.catalogId)) errors.push('catalogId must be a stable catalog id');
  else if (!knownCatalogIds().has(instance.catalogId)) warnings.push(`catalogId ${instance.catalogId} is not in Task 4 examples or current runtime furniture ids yet`);

  validateLocation(instance.location, errors);
  validateRotation(instance.rotation, errors);
  validateState(instance.state, errors);
  validateReservation(instance.reservation, errors);
  validatePermissions(instance.permissions, errors);
  validateRuntimeAdapters(instance.runtimeAdapters, errors);

  if (instance.catalogDefinition !== undefined) {
    errors.push('catalogDefinition must not be embedded in placed-object instances; persist catalogId only');
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
  });
}

export function normalizeLegacyFurnitureInstance({ buildingId, furniture, index = 0 } = {}) {
  const item = isRecord(furniture) ? furniture : {};
  const type = typeof item.type === 'string' && item.type.trim() ? item.type.trim() : 'unknown';
  const instanceId = typeof item.instanceId === 'string' && item.instanceId.trim()
    ? item.instanceId.trim()
    : `${buildingId || 'building'}-${type}-${index}`;
  return Object.freeze({
    id: instanceId,
    catalogId: type,
    location: Object.freeze({
      kind: 'building-interior',
      buildingId: String(buildingId || item.buildingId || '').trim(),
      floor: Math.max(1, Number(item.floor || item.buildingFloor || 1) || 1),
      x: Number(item.x || 0),
      z: Number(item.z || 0),
    }),
    rotation: Object.freeze({ unit: 'deg', value: normalizeRotationDeg(item.rotation || 0) }),
    state: Object.freeze({ status: 'idle', stateId: 'idle', actionId: null }),
    reservation: Object.freeze({ status: 'none', id: null, actionId: null, agentId: null, spotId: null, expiresAt: null }),
    permissions: Object.freeze({
      mode: item.assignedTo ? 'override' : 'inherit',
      level: item.assignedTo ? 'assigned-role' : 'public',
      allowedAgentIds: Object.freeze(item.assignedTo ? [String(item.assignedTo)] : []),
      deniedAgentIds: Object.freeze([]),
      roles: Object.freeze([]),
    }),
    runtimeAdapters: Object.freeze({
      source: 'building.interior.furniture[]',
      furnitureType: type,
      furnitureIndex: Math.max(0, Number(index) || 0),
      assignedTo: item.assignedTo ? String(item.assignedTo) : null,
      persistencePath: `buildings/${buildingId || '<building-id>'}.json#interior.furniture[${Math.max(0, Number(index) || 0)}]`,
    }),
  });
}

export function getObjectInstanceExample(id) {
  return OBJECT_INSTANCE_EXAMPLES.find(object => object.id === id) || null;
}

export const OBJECT_INSTANCE_EXAMPLES = Object.freeze([
  Object.freeze({
    id: 'office-1-desk-0',
    catalogId: 'desk',
    location: Object.freeze({ kind: 'building-interior', buildingId: 'office-1', floor: 1, x: 6.5, z: 4.5 }),
    rotation: Object.freeze({ unit: 'deg', value: 0 }),
    state: Object.freeze({ status: 'idle', stateId: 'idle', actionId: null, updatedAt: '2026-04-28T00:00:00Z', data: Object.freeze({}) }),
    reservation: Object.freeze({ status: 'none', id: null, actionId: null, agentId: null, spotId: null, expiresAt: null }),
    permissions: Object.freeze({ mode: 'override', level: 'assigned-role', allowedAgentIds: Object.freeze(['coder']), deniedAgentIds: Object.freeze([]), roles: Object.freeze(['worker']) }),
    runtimeAdapters: Object.freeze({ source: 'building.interior.furniture[]', furnitureType: 'desk', furnitureIndex: 0, assignedTo: 'coder', persistencePath: 'buildings/office-1.json#interior.furniture[0]' }),
  }),
  Object.freeze({
    id: 'salon-1-barber-chair-0',
    catalogId: 'barber-chair',
    location: Object.freeze({ kind: 'building-interior', buildingId: 'salon-1', floor: 1, x: 8, z: 6 }),
    rotation: Object.freeze({ unit: 'deg', value: 90 }),
    state: Object.freeze({ status: 'reserved', stateId: 'idle', actionId: 'appearance.editHair', updatedAt: '2026-04-28T00:00:00Z', data: Object.freeze({ queueLength: 1 }) }),
    reservation: Object.freeze({ status: 'held', id: 'res-salon-1-chair-0', actionId: 'appearance.editHair', agentId: 'agent-stylist', spotId: 'seat', expiresAt: '2026-04-28T00:05:00Z' }),
    permissions: Object.freeze({ mode: 'inherit', level: 'public', allowedAgentIds: Object.freeze([]), deniedAgentIds: Object.freeze([]), roles: Object.freeze([]) }),
    runtimeAdapters: Object.freeze({ source: 'building.interior.furniture[]', furnitureType: null, furnitureIndex: 0, assignedTo: null, persistencePath: 'buildings/salon-1.json#agentLife.objectInstances[0]' }),
  }),
  Object.freeze({
    id: 'clinic-1-bed-0',
    catalogId: 'clinic-bed',
    location: Object.freeze({ kind: 'building-interior', buildingId: 'clinic-1', floor: 2, x: 10.25, z: 7.75 }),
    rotation: Object.freeze({ unit: 'deg', value: 180 }),
    state: Object.freeze({ status: 'in_use', stateId: 'exam-active', actionId: 'life.medicalExam', updatedAt: '2026-04-28T00:00:00Z', data: Object.freeze({ vitalCheck: 'running' }) }),
    reservation: Object.freeze({ status: 'active', id: 'res-clinic-bed-0', actionId: 'life.medicalExam', agentId: 'agent-patient', spotId: 'patient', expiresAt: null }),
    permissions: Object.freeze({ mode: 'locked', level: 'assigned-role', allowedAgentIds: Object.freeze(['agent-patient', 'agent-clinician']), deniedAgentIds: Object.freeze([]), roles: Object.freeze(['medical-staff']) }),
    runtimeAdapters: Object.freeze({ source: 'building.interior.furniture[]', furnitureType: 'clinicBed', furnitureIndex: 1, assignedTo: null, persistencePath: 'buildings/clinic-1.json#interior.furniture[1]' }),
  }),
]);

for (const object of OBJECT_CATALOG_EXAMPLES) {
  const result = validateObjectCatalogDefinition(object);
  if (!result.valid) throw new Error(`Invalid catalog example ${object?.id || '<unknown>'}: ${result.errors.join('; ')}`);
}

for (const instance of OBJECT_INSTANCE_EXAMPLES) {
  const result = validateObjectInstance(instance);
  if (!result.valid) throw new Error(`Invalid object instance example ${instance?.id || '<unknown>'}: ${result.errors.join('; ')}`);
}
