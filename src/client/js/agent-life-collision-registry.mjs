/**
 * Agent Life collision registry API.
 *
 * Phase 0.5 technical spine for physical bounds. It defines how catalog assets
 * and placed object instances describe solid, soft, or non-solid bounds, then
 * gives current physics and routing code a single adapter surface for those
 * bounds. The module is side-effect free: it creates no Rapier colliders,
 * mutates no buildings, and runs no pathfinding by itself.
 */
import {
  CATALOG_REGISTRY_BLUEPRINTS,
  buildCatalogRegistry,
} from './agent-life-catalog-registry.mjs';
import { normalizeObjectCatalogId } from './agent-life-object-catalog-schema.mjs';

export const COLLISION_REGISTRY_API_VERSION = 'agent-life-collision-registry/v1';

export const COLLISION_BOUND_KINDS = Object.freeze(['solid', 'soft', 'non-solid']);
export const COLLISION_BOUND_SHAPES = Object.freeze(['rect', 'circle', 'capsule', 'line', 'none']);
export const COLLISION_BOUND_COORDINATE_SPACES = Object.freeze(['catalog-local', 'building-local', 'outdoor-local', 'world']);
export const COLLISION_ROUTING_EFFECTS = Object.freeze(['block', 'avoid', 'ignore']);
export const COLLISION_PHYSICS_EFFECTS = Object.freeze(['static-collider', 'sensor-only', 'none']);

export const COLLISION_REGISTRY_CONTRACT = Object.freeze([
  Object.freeze({ key: 'assetId', required: true, meaning: 'Canonical catalog/registry id after alias normalization; legacy runtime type can still be preserved by placed objects.' }),
  Object.freeze({ key: 'kind', required: true, meaning: 'solid blocks routing and physics, soft is an avoid/cost hint, non-solid is ignored by movement.' }),
  Object.freeze({ key: 'bounds', required: true, meaning: 'One or more local bounds records with shape, units, half extents/radius, offset, and rotation ownership.' }),
  Object.freeze({ key: 'routing', required: true, meaning: 'Current route/pathfinding handoff: block for solid bounds, avoid for soft bounds, ignore for non-solid bounds.' }),
  Object.freeze({ key: 'physics', required: true, meaning: 'Current Rapier handoff: static collider for solid bounds, no hard collider for soft/non-solid in Phase 0.5.' }),
  Object.freeze({ key: 'runtimeAdapters', required: true, meaning: 'References the active runtime tables/functions that supplied dimensions and the current call sites that consume the profile.' }),
]);

export const COLLISION_REGISTRY_RULES = Object.freeze([
  'Catalog scale remains the preferred source for half extents; runtime half-size adapters may supply active dimensions but must not create a second independent catalog.',
  'solid bounds feed current Rapier addBoxCollider() calls and dynamic-interior-routing.js blocked grid cells.',
  'soft bounds are route-avoid metadata today; they must not create blocking Rapier colliders until a routing cost layer exists.',
  'non-solid bounds are visible/actionable metadata only and must be ignored by current routing/pathfinding and physics collider creation.',
  'Placed object instances own position, floor, rotation, and area; collision registry profiles own shape/kind semantics.',
  'This registry is adapter-only: it must not place furniture, persist state, route agents, or create colliders by import side effect.',
]);

export const COLLISION_PROFILE_OVERRIDES = Object.freeze({
  plant: Object.freeze({ kind: 'soft', routingEffect: 'avoid', physicsEffect: 'none', reason: 'decor foliage should be avoidable preference metadata, not a hard blocker' }),
  tv: Object.freeze({ kind: 'non-solid', routingEffect: 'ignore', physicsEffect: 'none', reason: 'thin wall/media asset; interaction target but no floor obstacle' }),
  dartboard: Object.freeze({ kind: 'non-solid', routingEffect: 'ignore', physicsEffect: 'none', reason: 'wall-mounted target; no floor obstacle' }),
  branchSign: Object.freeze({ kind: 'non-solid', routingEffect: 'ignore', physicsEffect: 'none', reason: 'label/signage only' }),
  crosswalkNode: Object.freeze({ kind: 'non-solid', routingEffect: 'ignore', physicsEffect: 'none', reason: 'crosswalk/crossing node is a visible routing marker only and must never block roads or sidewalks' }),
  pathNode: Object.freeze({ kind: 'non-solid', routingEffect: 'ignore', physicsEffect: 'none', reason: 'walking path node is a subtle stroll waypoint marker only and must never block movement, sidewalks, doors, floors, or building transitions' }),
  countertopCoffeeMachine: Object.freeze({ kind: 'non-solid', routingEffect: 'ignore', physicsEffect: 'none', reason: 'countertop appliance sits on the counter surface; the counter owns floor collision while the appliance owns action spots' }),
  microwave: Object.freeze({ kind: 'non-solid', routingEffect: 'ignore', physicsEffect: 'none', reason: 'countertop appliance sits on the counter surface; the counter owns floor collision while the appliance owns action spots' }),
  floorLamp: Object.freeze({ kind: 'soft', routingEffect: 'avoid', physicsEffect: 'none', reason: 'small decor obstacle; avoid when a cost layer exists, do not block current routing' }),
});

const FALLBACK_HALF_EXTENTS = Object.freeze({ halfW: 0.35, halfD: 0.35 });

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

function normalizeRotationDeg(value = 0) {
  const n = finiteNumber(value, 0);
  return ((n % 360) + 360) % 360;
}

function normalizeKind(value = 'solid') {
  return COLLISION_BOUND_KINDS.includes(value) ? value : 'solid';
}

function effectsForKind(kind, override = {}) {
  const normalized = normalizeKind(kind);
  if (override.routingEffect || override.physicsEffect) {
    return {
      routingEffect: COLLISION_ROUTING_EFFECTS.includes(override.routingEffect) ? override.routingEffect : (normalized === 'solid' ? 'block' : normalized === 'soft' ? 'avoid' : 'ignore'),
      physicsEffect: COLLISION_PHYSICS_EFFECTS.includes(override.physicsEffect) ? override.physicsEffect : (normalized === 'solid' ? 'static-collider' : 'none'),
    };
  }
  if (normalized === 'solid') return { routingEffect: 'block', physicsEffect: 'static-collider' };
  if (normalized === 'soft') return { routingEffect: 'avoid', physicsEffect: 'none' };
  return { routingEffect: 'ignore', physicsEffect: 'none' };
}

function halfExtentsFor(assetId, entry, halfSizes = {}) {
  const explicit = halfSizes?.[assetId];
  const halfW = explicit?.halfW ?? explicit?.[0] ?? entry?.scale?.halfW ?? FALLBACK_HALF_EXTENTS.halfW;
  const halfD = explicit?.halfD ?? explicit?.[1] ?? entry?.scale?.halfD ?? FALLBACK_HALF_EXTENTS.halfD;
  return {
    halfW: Math.max(0, finiteNumber(halfW, FALLBACK_HALF_EXTENTS.halfW)),
    halfD: Math.max(0, finiteNumber(halfD, FALLBACK_HALF_EXTENTS.halfD)),
    source: explicit ? `runtime halfSizes.${assetId}` : (entry?.scale?.source || 'fallback half extents'),
  };
}

function makeBoundsRecord({ shape = 'rect', units = 'tile', halfW = 0, halfD = 0, radius = null, offsetX = 0, offsetZ = 0, rotationDeg = 0, coordinateSpace = 'catalog-local', source = 'collision registry' } = {}) {
  const normalizedShape = COLLISION_BOUND_SHAPES.includes(shape) ? shape : 'rect';
  return freezeDeep({
    shape: normalizedShape,
    units,
    coordinateSpace: COLLISION_BOUND_COORDINATE_SPACES.includes(coordinateSpace) ? coordinateSpace : 'catalog-local',
    halfW: normalizedShape === 'none' ? 0 : Math.max(0, finiteNumber(halfW, 0)),
    halfD: normalizedShape === 'none' ? 0 : Math.max(0, finiteNumber(halfD, 0)),
    radius: radius == null ? null : Math.max(0, finiteNumber(radius, 0)),
    offset: Object.freeze({ x: finiteNumber(offsetX, 0), z: finiteNumber(offsetZ, 0) }),
    rotationDeg: normalizeRotationDeg(rotationDeg),
    source,
  });
}

export function buildCollisionRegistry({ blueprints = CATALOG_REGISTRY_BLUEPRINTS, halfSizes = {}, overrides = COLLISION_PROFILE_OVERRIDES } = {}) {
  const catalogRegistry = buildCatalogRegistry({ blueprints, halfSizes });
  const catalogIds = new Set(catalogRegistry.entries.map(entry => entry.id));
  const halfSizeOnlyEntries = Object.keys(halfSizes || {})
    .map(id => normalizeObjectCatalogId(id) || id)
    .filter(id => id && !catalogIds.has(id))
    .sort()
    .map(id => ({
      id,
      objectCatalogId: null,
      label: id,
      scale: { solid: true, source: `runtime halfSizes.${id}` },
    }));
  const profiles = [...catalogRegistry.entries, ...halfSizeOnlyEntries].map((entry) => {
    const override = overrides?.[entry.id] || {};
    const baseKind = override.kind || (entry.scale?.solid ? 'solid' : 'non-solid');
    const kind = normalizeKind(baseKind);
    const effects = effectsForKind(kind, override);
    const extents = kind === 'non-solid'
      ? { halfW: 0, halfD: 0, source: override.reason || 'non-solid override' }
      : halfExtentsFor(entry.id, entry, halfSizes);
    return freezeDeep({
      assetId: entry.id,
      objectCatalogId: entry.objectCatalogId || null,
      label: entry.label,
      kind,
      bounds: Object.freeze([
        makeBoundsRecord({
          shape: kind === 'non-solid' ? 'none' : 'rect',
          halfW: extents.halfW,
          halfD: extents.halfD,
          source: extents.source,
        }),
      ]),
      routing: Object.freeze({ effect: effects.routingEffect, blocksPathfinding: effects.routingEffect === 'block', costHint: effects.routingEffect === 'avoid' ? 'future-soft-avoidance' : null }),
      physics: Object.freeze({ effect: effects.physicsEffect, createStaticCollider: effects.physicsEffect === 'static-collider' }),
      runtimeAdapters: Object.freeze({
        catalogScaleSource: entry.scale?.source || null,
        activeHalfSizeSource: extents.source,
        routingConsumers: Object.freeze(['dynamic-interior-routing.js:collectInteriorObstacles/buildGrid']),
        physicsConsumers: Object.freeze(['main3d.js:syncManualFurnitureColliders/addBoxCollider']),
      }),
      reason: override.reason || null,
    });
  });
  const byId = new Map(profiles.map(profile => [profile.assetId, profile]));
  return freezeDeep({
    version: COLLISION_REGISTRY_API_VERSION,
    profiles: Object.freeze(profiles),
    get(id) {
      const normalized = normalizeObjectCatalogId(id) || id;
      return byId.get(normalized) || byId.get(id) || null;
    },
    list({ kind = null, routingEffect = null, physicsEffect = null } = {}) {
      return profiles.filter(profile => {
        if (kind && profile.kind !== kind) return false;
        if (routingEffect && profile.routing.effect !== routingEffect) return false;
        if (physicsEffect && profile.physics.effect !== physicsEffect) return false;
        return true;
      });
    },
  });
}

export function resolveCollisionProfile(assetId, { registry = null, halfSizes = {}, overrides = COLLISION_PROFILE_OVERRIDES } = {}) {
  const resolvedRegistry = registry || buildCollisionRegistry({ halfSizes, overrides });
  const normalized = normalizeObjectCatalogId(assetId) || assetId;
  return resolvedRegistry.get(normalized) || null;
}

export function getCollisionBoundsForAsset(assetId, { halfSizes = {}, registry = null } = {}) {
  const profile = resolveCollisionProfile(assetId, { halfSizes, registry });
  return profile ? profile.bounds : Object.freeze([]);
}

export function shouldCreatePhysicsCollider(assetId, options = {}) {
  const profile = resolveCollisionProfile(assetId, options);
  return Boolean(profile?.physics?.createStaticCollider);
}

export function shouldBlockRouting(assetId, options = {}) {
  const profile = resolveCollisionProfile(assetId, options);
  return Boolean(profile?.routing?.blocksPathfinding);
}

export function resolvePlacedCollisionBounds({ item = {}, building = null, index = 0, halfSizes = {}, registry = null, coordinateSpace = 'building-local', includeBuildingRotation = true } = {}) {
  const assetId = normalizeObjectCatalogId(item?.catalogId || item?.objectCatalogId || item?.type) || item?.type || 'unknown';
  const profile = resolveCollisionProfile(assetId, { halfSizes, registry });
  if (!profile) return freezeDeep({ assetId, profile: null, bounds: [], index });
  const buildingRotation = includeBuildingRotation ? (building?._rotation || 0) : 0;
  const instanceRotation = normalizeRotationDeg(buildingRotation + (item?.rotation || item?.rotationDeg || 0));
  const x = finiteNumber(item?.x ?? item?.localX ?? item?.worldX, 0);
  const z = finiteNumber(item?.z ?? item?.localZ ?? item?.worldZ, 0);
  const bounds = profile.bounds.map(bound => makeBoundsRecord({
    ...bound,
    coordinateSpace,
    halfW: bound.halfW,
    halfD: bound.halfD,
    offsetX: x + (bound.offset?.x || 0),
    offsetZ: z + (bound.offset?.z || 0),
    rotationDeg: normalizeRotationDeg(instanceRotation + (bound.rotationDeg || 0)),
    source: `${bound.source}; placed ${assetId}[${index}]`,
  }));
  return freezeDeep({
    assetId,
    kind: profile.kind,
    routing: profile.routing,
    physics: profile.physics,
    profile,
    bounds: Object.freeze(bounds),
    index,
  });
}

export function validateCollisionRegistry(registry) {
  const errors = [];
  if (!registry || registry.version !== COLLISION_REGISTRY_API_VERSION) errors.push('registry.version must match COLLISION_REGISTRY_API_VERSION');
  if (!Array.isArray(registry?.profiles) || registry.profiles.length === 0) errors.push('registry.profiles must be a non-empty array');
  const ids = new Set();
  for (const profile of registry?.profiles || []) {
    if (!profile.assetId || ids.has(profile.assetId)) errors.push(`duplicate or missing assetId ${profile.assetId || '<missing>'}`);
    ids.add(profile.assetId);
    if (!COLLISION_BOUND_KINDS.includes(profile.kind)) errors.push(`${profile.assetId}.kind must be a valid collision kind`);
    if (!Array.isArray(profile.bounds) || profile.bounds.length === 0) errors.push(`${profile.assetId}.bounds must be a non-empty array`);
    if (!COLLISION_ROUTING_EFFECTS.includes(profile.routing?.effect)) errors.push(`${profile.assetId}.routing.effect must be valid`);
    if (!COLLISION_PHYSICS_EFFECTS.includes(profile.physics?.effect)) errors.push(`${profile.assetId}.physics.effect must be valid`);
    for (const bound of profile.bounds || []) {
      if (!COLLISION_BOUND_SHAPES.includes(bound.shape)) errors.push(`${profile.assetId}.bounds[].shape must be valid`);
      if (!COLLISION_BOUND_COORDINATE_SPACES.includes(bound.coordinateSpace)) errors.push(`${profile.assetId}.bounds[].coordinateSpace must be valid`);
      if (bound.shape !== 'none' && (typeof bound.halfW !== 'number' || typeof bound.halfD !== 'number')) errors.push(`${profile.assetId}.bounds[] half extents must be numeric`);
    }
  }
  return freezeDeep({ valid: errors.length === 0, errors });
}

export const COLLISION_REGISTRY = buildCollisionRegistry();
