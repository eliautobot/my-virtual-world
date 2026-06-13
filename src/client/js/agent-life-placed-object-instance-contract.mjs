/**
 * Agent Life placed object instance contract.
 *
 * Phase 0.5 integration spine for the active runtime placement record. This is
 * intentionally adapter-only: it defines the persisted shape and legacy alias
 * mapping for objects that are currently stored as building furniture or outdoor
 * world records, but it does not place objects, mutate buildings, route agents,
 * create colliders, or write APIs.
 */
import { normalizeObjectCatalogId } from './agent-life-object-catalog-schema.mjs';
import { CATALOG_REGISTRY_BLUEPRINTS } from './agent-life-catalog-registry.mjs';
import {
  OBJECT_INSTANCE_STATE_STATUSES,
  validateObjectInstance,
  normalizeLegacyFurnitureInstance,
} from './agent-life-object-instance-schema.mjs';

export const PLACED_OBJECT_INSTANCE_CONTRACT_VERSION = 'agent-life-placed-object-instance-contract/v1';

export const PLACED_OBJECT_AREA_KINDS = Object.freeze(['building', 'outdoor-area', 'world']);
export const PLACED_OBJECT_COORDINATE_SPACES = Object.freeze(['building-local', 'outdoor-local', 'world']);
export const PLACED_OBJECT_PERSISTENCE_OWNERS = Object.freeze(['building-json', 'world-meta', 'future-object-instance-api']);

export const PLACED_OBJECT_INSTANCE_FIELDS = Object.freeze([
  Object.freeze({ key: 'id', required: true, meaning: 'Stable placed object id for this physical instance; never reuse catalog ids as instance ids when multiple objects can exist.' }),
  Object.freeze({ key: 'catalogId', required: true, meaning: 'Canonical catalog/registry id after alias normalization; this is the forward-compatible object identity.' }),
  Object.freeze({ key: 'type', required: true, meaning: 'Runtime-compatible legacy type kept as a migration alias for existing furniture/decor code paths.' }),
  Object.freeze({ key: 'area', required: true, meaning: 'Placement owner: building interior/exterior, outdoor area, or world-level record, including building/outdoor ids when present.' }),
  Object.freeze({ key: 'floor', required: true, meaning: '1-based floor number for interiors; outdoor/world placements still store floor 1 unless a future outdoor layer explicitly overrides it.' }),
  Object.freeze({ key: 'position', required: true, meaning: 'Local x/z coordinates plus optional resolved worldX/worldZ so routing, persistence, and browser review share one coordinate contract.' }),
  Object.freeze({ key: 'rotation', required: true, meaning: 'Instance rotation in degrees; catalog definitions may suggest defaults but persisted placement owns the actual value.' }),
  Object.freeze({ key: 'state', required: true, meaning: 'Mutable instance state copied forward from the Task 5 schema: idle/reserved/routing/in_use/cooldown/disabled/blocked plus freeform data.' }),
  Object.freeze({ key: 'persistence', required: true, meaning: 'Current storage owner/path and migration target, documenting whether the source is building JSON, world-meta, or future object-instance API.' }),
  Object.freeze({ key: 'migrationAliases', required: true, meaning: 'Explicit alias map for existing fields such as type, buildingId, floor/buildingFloor, x/z, worldX/worldZ, rotation, and assignedTo.' }),
]);

export const PLACED_OBJECT_MIGRATION_ALIASES = Object.freeze({
  id: Object.freeze(['instanceId', 'id', '<derived buildingId-type-index>']),
  catalogId: Object.freeze(['catalogId', 'objectCatalogId', 'type']),
  type: Object.freeze(['type', 'furnitureType', 'decorationType']),
  buildingId: Object.freeze(['buildingId', 'building.id']),
  outdoorAreaId: Object.freeze(['outdoorAreaId', 'areaId', 'buildingId when building.type is outdoor/park']),
  floor: Object.freeze(['floor', 'buildingFloor']),
  x: Object.freeze(['x', 'localX']),
  z: Object.freeze(['z', 'localZ']),
  worldX: Object.freeze(['worldX', 'position.x', 'api.x']),
  worldZ: Object.freeze(['worldZ', 'position.y', 'api.y']),
  rotation: Object.freeze(['rotation', 'rotationDeg']),
  state: Object.freeze(['state', 'status', 'reservation']),
  assignedTo: Object.freeze(['assignedTo', 'permissions.allowedAgentIds[0]']),
});

export const PLACED_OBJECT_CONTRACT_RULES = Object.freeze([
  'building.interior.furniture[] remains the active building-scoped storage until a migration task moves data elsewhere.',
  'catalogId is canonical, but type must remain available for current render/collision/editor code until every call site accepts catalogId.',
  'Outdoor placements must identify either an outdoor-area building or world-meta owner; do not create a parallel outdoor object store.',
  'Persist local x/z and optional resolved worldX/worldZ together; never infer persistence ownership from only world coordinates.',
  'State is instance-local and must not mutate catalog registry records or Task 4 catalog definitions.',
  'migrationAliases must be explicit so server/client migrations can be tolerant of old floor/buildingFloor and type/catalogId records.',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

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

function positiveFloor(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function normalizeRotation(value = 0) {
  const n = finiteNumber(value, 0);
  return ((n % 360) + 360) % 360;
}

function currentRegistryIds() {
  return new Set(CATALOG_REGISTRY_BLUEPRINTS.map(entry => entry.id));
}

export function resolvePlacedObjectCatalogId(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : 'unknown';
  return normalizeObjectCatalogId(raw) || raw;
}

export function makePlacedObjectMigrationAliases(overrides = {}) {
  const aliases = {};
  for (const [key, value] of Object.entries(PLACED_OBJECT_MIGRATION_ALIASES)) aliases[key] = [...value];
  for (const [key, value] of Object.entries(overrides || {})) aliases[key] = Array.isArray(value) ? [...value] : [String(value)];
  return freezeDeep(aliases);
}

export function normalizePlacedObjectInstance({ source = 'building-furniture', building = null, outdoorArea = null, item = {}, index = 0 } = {}) {
  const record = isRecord(item) ? item : {};
  const areaBuilding = isRecord(building) ? building : null;
  const areaOutdoor = isRecord(outdoorArea) ? outdoorArea : null;
  const type = typeof record.type === 'string' && record.type.trim()
    ? record.type.trim()
    : (typeof record.catalogId === 'string' && record.catalogId.trim() ? record.catalogId.trim() : 'unknown');
  const catalogId = resolvePlacedObjectCatalogId(record.catalogId || record.objectCatalogId || type);
  const buildingId = String(record.buildingId || areaBuilding?.id || '').trim();
  const areaKind = source === 'world-meta-decoration'
    ? 'world'
    : (areaOutdoor || areaBuilding?.type === 'park' || areaBuilding?.type === 'outdoor' || areaBuilding?.type === 'outside' ? 'outdoor-area' : 'building');
  const floor = positiveFloor(record.floor ?? record.buildingFloor ?? 1);
  const safeIndex = Math.max(0, Number(index) || 0);
  const id = String(record.instanceId || record.id || `${buildingId || areaOutdoor?.id || 'world'}-${catalogId}-${safeIndex}`).trim();
  const localX = finiteNumber(record.x ?? record.localX ?? record.worldX, 0);
  const localZ = finiteNumber(record.z ?? record.localZ ?? record.worldZ, 0);
  const worldX = record.worldX ?? record.position?.x ?? record.api?.x;
  const worldZ = record.worldZ ?? record.position?.z ?? record.position?.y ?? record.api?.y;
  const persistenceOwner = source === 'world-meta-decoration' ? 'world-meta' : 'building-json';
  const persistencePath = persistenceOwner === 'world-meta'
    ? `world-meta.json#decorations[${safeIndex}]`
    : `buildings/${buildingId || '<building-id>'}.json#${areaKind === 'building' ? 'interior.furniture' : 'outdoorArea.nodes'}[${safeIndex}]`;

  return freezeDeep({
    id,
    catalogId,
    type,
    area: {
      kind: areaKind,
      buildingId: areaKind === 'building' || areaKind === 'outdoor-area' ? buildingId || null : null,
      outdoorAreaId: areaKind === 'outdoor-area' ? String(record.outdoorAreaId || areaOutdoor?.id || buildingId || '').trim() || null : null,
      outdoorAreaType: areaKind === 'outdoor-area' ? (record.outdoorAreaType || areaOutdoor?.outdoorAreaType || areaBuilding?.outdoorAreaType || areaBuilding?.type || null) : null,
    },
    floor,
    position: {
      coordinateSpace: areaKind === 'world' ? 'world' : (areaKind === 'outdoor-area' ? 'outdoor-local' : 'building-local'),
      x: localX,
      z: localZ,
      worldX: worldX === undefined || worldX === null ? null : finiteNumber(worldX, null),
      worldZ: worldZ === undefined || worldZ === null ? null : finiteNumber(worldZ, null),
    },
    rotation: { unit: 'deg', value: normalizeRotation(record.rotation ?? record.rotationDeg ?? 0) },
    state: isRecord(record.state) ? record.state : { status: record.status || 'idle', stateId: record.status || 'idle', actionId: null, data: {} },
    persistence: {
      owner: persistenceOwner,
      path: persistencePath,
      source,
      sourceIndex: safeIndex,
      target: 'agentLife.objectInstances[]',
      dirty: false,
    },
    migrationAliases: makePlacedObjectMigrationAliases(source === 'building-furniture' ? { source: ['building.interior.furniture[]'] } : { source: [source] }),
  });
}

export function validatePlacedObjectInstanceContract(instance) {
  const errors = [];
  const warnings = [];
  if (!isRecord(instance)) return freezeDeep({ valid: false, errors: ['placed object instance must be an object'], warnings: [] });

  if (typeof instance.id !== 'string' || !instance.id.trim()) errors.push('id must be a non-empty string');
  if (typeof instance.catalogId !== 'string' || !instance.catalogId.trim()) errors.push('catalogId must be a non-empty string');
  if (typeof instance.type !== 'string' || !instance.type.trim()) errors.push('type must be a non-empty runtime alias string');
  if (!isRecord(instance.area)) errors.push('area must be an object');
  else {
    if (!PLACED_OBJECT_AREA_KINDS.includes(instance.area.kind)) errors.push(`area.kind must be one of ${PLACED_OBJECT_AREA_KINDS.join(', ')}`);
    if (instance.area.kind === 'building' && !instance.area.buildingId) errors.push('area.buildingId is required for building placements');
    if (instance.area.kind === 'outdoor-area' && !instance.area.outdoorAreaId) errors.push('area.outdoorAreaId is required for outdoor-area placements');
  }
  if (!Number.isInteger(instance.floor) || instance.floor < 1) errors.push('floor must be an integer >= 1');
  if (!isRecord(instance.position)) errors.push('position must be an object');
  else {
    if (!PLACED_OBJECT_COORDINATE_SPACES.includes(instance.position.coordinateSpace)) errors.push(`position.coordinateSpace must be one of ${PLACED_OBJECT_COORDINATE_SPACES.join(', ')}`);
    if (typeof instance.position.x !== 'number' || !Number.isFinite(instance.position.x)) errors.push('position.x must be a finite number');
    if (typeof instance.position.z !== 'number' || !Number.isFinite(instance.position.z)) errors.push('position.z must be a finite number');
    for (const key of ['worldX', 'worldZ']) {
      if (instance.position[key] !== null && instance.position[key] !== undefined && (typeof instance.position[key] !== 'number' || !Number.isFinite(instance.position[key]))) errors.push(`position.${key} must be a finite number or null`);
    }
  }
  if (!isRecord(instance.rotation) || instance.rotation.unit !== 'deg' || typeof instance.rotation.value !== 'number') errors.push('rotation must be { unit: "deg", value: number }');
  if (!isRecord(instance.state) || !OBJECT_INSTANCE_STATE_STATUSES.includes(instance.state.status)) errors.push(`state.status must be one of ${OBJECT_INSTANCE_STATE_STATUSES.join(', ')}`);
  if (!isRecord(instance.persistence)) errors.push('persistence must be an object');
  else {
    if (!PLACED_OBJECT_PERSISTENCE_OWNERS.includes(instance.persistence.owner)) errors.push(`persistence.owner must be one of ${PLACED_OBJECT_PERSISTENCE_OWNERS.join(', ')}`);
    if (typeof instance.persistence.path !== 'string' || !instance.persistence.path.trim()) errors.push('persistence.path must be a non-empty string');
  }
  if (!isRecord(instance.migrationAliases)) errors.push('migrationAliases must be an object');
  else for (const key of Object.keys(PLACED_OBJECT_MIGRATION_ALIASES)) {
    if (!Array.isArray(instance.migrationAliases[key]) || instance.migrationAliases[key].length === 0) errors.push(`migrationAliases.${key} must list legacy field names`);
  }

  if (instance.catalogId && !currentRegistryIds().has(instance.catalogId)) warnings.push(`catalogId ${instance.catalogId} is not in current registry blueprints yet`);

  return freezeDeep({ valid: errors.length === 0, errors, warnings });
}

export const PLACED_OBJECT_INSTANCE_EXAMPLES = Object.freeze([
  normalizePlacedObjectInstance({
    source: 'building-furniture',
    building: { id: 'office-1', type: 'office' },
    item: { type: 'desk', x: 6.5, z: 4.5, rotation: 0, floor: 1, assignedTo: 'coder' },
    index: 0,
  }),
  normalizePlacedObjectInstance({
    source: 'building-furniture',
    building: { id: 'clinic-1', type: 'clinic' },
    item: { type: 'clinicBed', catalogId: 'clinicBed', x: 10.25, z: 7.75, worldX: 182.25, worldZ: 96.75, rotation: 180, buildingFloor: 2, state: { status: 'in_use', stateId: 'exam-active', actionId: 'life.medicalExam', data: { vitalCheck: 'running' } } },
    index: 1,
  }),
  normalizePlacedObjectInstance({
    source: 'outdoor-area-node',
    building: { id: 'park-1', type: 'park', outdoorAreaType: 'park' },
    outdoorArea: { id: 'park-1', outdoorAreaType: 'park' },
    item: { type: 'bench', catalogId: 'chair', outdoorAreaId: 'park-1', x: 12, z: 4, worldX: 320, worldZ: 208, rotationDeg: 90 },
    index: 2,
  }),
]);

for (const example of PLACED_OBJECT_INSTANCE_EXAMPLES) {
  const result = validatePlacedObjectInstanceContract(example);
  if (!result.valid) throw new Error(`Invalid placed object contract example ${example?.id || '<unknown>'}: ${result.errors.join('; ')}`);
}

const legacyDesk = normalizeLegacyFurnitureInstance({ buildingId: 'office-1', furniture: { type: 'desk', x: 6.5, z: 4.5, rotation: 0, floor: 1 }, index: 0 });
const legacyResult = validateObjectInstance(legacyDesk);
if (!legacyResult.valid) throw new Error(`Placed object contract legacy adapter drifted from Task 5 schema: ${legacyResult.errors.join('; ')}`);
