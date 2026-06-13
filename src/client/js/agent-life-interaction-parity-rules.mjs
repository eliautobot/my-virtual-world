/**
 * Agent Life interior/exterior interaction parity rules.
 *
 * Phase 0.5 technical spine for keeping interior objects and exterior nodes on
 * compatible target/action/collision/routing/menu/animation contracts. This is
 * metadata and validation only: importing it must not place objects, create
 * colliders, route agents, open menus, enqueue actions, mutate state, or persist
 * records.
 */
import {
  ACTION_LOCATION_COORDINATE_SPACES,
  ACTION_LOCATION_REGISTRY_API_VERSION,
  buildActionLocationRegistry,
} from './agent-life-action-location-registry.mjs';
import {
  COLLISION_BOUND_COORDINATE_SPACES,
  COLLISION_REGISTRY_API_VERSION,
  buildCollisionRegistry,
} from './agent-life-collision-registry.mjs';
import {
  CONTEXT_MENU_ACTION_REGISTRY_API_VERSION,
  CONTEXT_MENU_TARGET_KINDS,
  buildContextMenuActionRegistry,
} from './agent-life-context-menu-action-registry.mjs';
import {
  AGENT_ANIMATION_IDS,
  AGENT_ANIMATION_REGISTRY_API_VERSION,
  buildAnimationRegistry,
} from './agent-life-animation-registry.mjs';
import {
  PLACED_OBJECT_AREA_KINDS,
  PLACED_OBJECT_COORDINATE_SPACES,
} from './agent-life-placed-object-instance-contract.mjs';
import {
  WORLD_ACTION_SCHEMA_VERSION,
  WORLD_ACTION_TARGET_KINDS,
} from './agent-life-world-action-schema.mjs';
import {
  CATALOG_REGISTRY_BLUEPRINTS,
  buildCatalogRegistry,
} from './agent-life-catalog-registry.mjs';

export const INTERACTION_PARITY_RULES_VERSION = 'agent-life-interaction-parity-rules/v1';

export const INTERACTION_SURFACE_KINDS = Object.freeze(['interior-object', 'exterior-node']);
export const INTERACTION_PARITY_FORMATS = Object.freeze(['target', 'action', 'collision', 'routing', 'menu', 'animation']);
export const INTERACTION_PARITY_COMPATIBILITY = Object.freeze(['shared', 'adapter-required', 'not-applicable']);

export const INTERACTION_PARITY_CONTRACT = Object.freeze([
  Object.freeze({ key: 'target', required: true, meaning: 'Both interior objects and exterior nodes resolve to a target object with kind, instance id, catalog id, area, floor, coordinate space, local/world position, and optional interactionSpotId.' }),
  Object.freeze({ key: 'action', required: true, meaning: 'Both surfaces hand off actionType/capabilityTag/agentId/source/priority using the world-action schema; action records reference ids rather than embedding catalog or instance definitions.' }),
  Object.freeze({ key: 'collision', required: true, meaning: 'Both surfaces use collision registry profiles with explicit kind, bounds, routing effect, physics effect, and coordinate-space adapter metadata.' }),
  Object.freeze({ key: 'routing', required: true, meaning: 'Both surfaces describe route target position, floor, reach radius, transition needs, blocked/soft/ignored effects, and adapter consumer without running route planning here.' }),
  Object.freeze({ key: 'menu', required: true, meaning: 'Both surfaces use context-menu action entries with target kind, availability/disabled reasons, permission, and world-action payload templates.' }),
  Object.freeze({ key: 'animation', required: true, meaning: 'Both surfaces resolve canonical animationId values from the animation registry and may provide trigger hints from action id, spot roles, asset id, and capability tag.' }),
]);

export const INTERACTION_PARITY_RULES = Object.freeze([
  'Interior and exterior interactions must share ids and references: objectInstanceId/nodeId, catalogId, interactionSpotId, actionType, capabilityTag, routeTarget, and animationId are stable handoff fields.',
  'Coordinate space is the primary adapter boundary. Interior uses building-local/floor-local plus floor/buildingId; exterior uses outdoor-local/world plus outdoorAreaId/world position. Consumers must not infer surface kind from x/z alone.',
  'Collision semantics are shared even when physics differs: solid blocks routing/static physics, soft avoids when supported, non-solid is ignored for blocking but may remain menu/actionable.',
  'Routing data is declarative. Interior routes may need door/elevator/floor handoffs; exterior routes may need sidewalk/park/world handoffs. The parity layer records the need, not the path.',
  'Menu availability and world-action payloads must stay compatible with the context-menu and world-action registries on both surfaces, including explicit disabled reasons.',
  'Animations use canonical semantic ids from the animation registry. Surface-specific pose implementation belongs to the character runtime, not object/exterior-node records.',
  'This module is side-effect-free and validation-only; importing it must not place objects, create colliders, enqueue actions, open menus, move agents, mutate world state, or persist records.',
]);

export const INTERACTION_PARITY_SURFACE_PROFILES = Object.freeze({
  'interior-object': Object.freeze({
    kind: 'interior-object',
    targetKind: 'object-instance',
    areaKind: 'building',
    coordinateSpaces: Object.freeze(['building-local', 'floor-local', 'world']),
    actionLocationCoordinateSpaces: Object.freeze(['asset-local', 'building-local', 'floor-local', 'world']),
    collisionCoordinateSpaces: Object.freeze(['catalog-local', 'building-local', 'world']),
    routingAdapters: Object.freeze(['main3d.js:setAgentTarget', 'dynamic-interior-routing.js', 'building doorway/elevator transition helpers']),
    menuAdapters: Object.freeze(['agent-life-context-menu-action-registry.mjs', 'main3d.js#future functional-object context menu']),
    animationAdapters: Object.freeze(['agent-characters.js', 'agent-life-animation-registry.mjs']),
    requiredTargetFields: Object.freeze(['kind', 'objectInstanceId', 'catalogId', 'area', 'floor', 'position', 'coordinateSpace', 'interactionSpotId']),
    transitionKinds: Object.freeze(['same-floor', 'doorway', 'elevator', 'interior-to-exterior']),
  }),
  'exterior-node': Object.freeze({
    kind: 'exterior-node',
    targetKind: 'object-instance',
    areaKind: 'outdoor-area',
    coordinateSpaces: Object.freeze(['outdoor-local', 'world']),
    actionLocationCoordinateSpaces: Object.freeze(['exterior-local', 'world']),
    collisionCoordinateSpaces: Object.freeze(['outdoor-local', 'world']),
    routingAdapters: Object.freeze(['main3d.js:setAgentTarget', 'dynamic-exterior-routing.js', 'sidewalk/park/world routing helpers']),
    menuAdapters: Object.freeze(['agent-life-context-menu-action-registry.mjs', 'main3d.js#future exterior-node context menu']),
    animationAdapters: Object.freeze(['agent-characters.js', 'agent-life-animation-registry.mjs']),
    requiredTargetFields: Object.freeze(['kind', 'objectInstanceId', 'catalogId', 'area', 'floor', 'position', 'coordinateSpace', 'interactionSpotId']),
    transitionKinds: Object.freeze(['same-area', 'sidewalk', 'park-path', 'exterior-to-interior']),
  }),
});

const FORMAT_REGISTRY_VERSIONS = Object.freeze({
  target: 'agent-life-placed-object-instance-contract/v1',
  action: WORLD_ACTION_SCHEMA_VERSION,
  collision: COLLISION_REGISTRY_API_VERSION,
  routing: 'main3d/dynamic-routing-adapter/v1',
  menu: CONTEXT_MENU_ACTION_REGISTRY_API_VERSION,
  animation: AGENT_ANIMATION_REGISTRY_API_VERSION,
});

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSurfaceKind(value) {
  return INTERACTION_SURFACE_KINDS.includes(value) ? value : 'interior-object';
}

function normalizeCoordinateSpace(surfaceProfile, value) {
  const raw = asString(value);
  if (surfaceProfile.coordinateSpaces.includes(raw)) return raw;
  return surfaceProfile.coordinateSpaces[0];
}

function normalizeArea(surfaceProfile, area = {}) {
  const raw = isRecord(area) ? area : {};
  const kind = PLACED_OBJECT_AREA_KINDS.includes(raw.kind) ? raw.kind : surfaceProfile.areaKind;
  return freezeDeep({
    kind,
    buildingId: raw.buildingId || null,
    outdoorAreaId: raw.outdoorAreaId || null,
    outdoorAreaType: raw.outdoorAreaType || null,
  });
}

function normalizeTarget(surfaceProfile, target = {}) {
  const raw = isRecord(target) ? target : {};
  const position = isRecord(raw.position) ? raw.position : {};
  const coordinateSpace = normalizeCoordinateSpace(surfaceProfile, raw.coordinateSpace || position.coordinateSpace);
  const normalizedKind = CONTEXT_MENU_TARGET_KINDS.includes(raw.kind) || WORLD_ACTION_TARGET_KINDS.includes(raw.kind)
    ? raw.kind
    : surfaceProfile.targetKind;
  return freezeDeep({
    kind: normalizedKind,
    objectInstanceId: raw.objectInstanceId || raw.nodeId || raw.id || null,
    nodeId: raw.nodeId || raw.objectInstanceId || raw.id || null,
    catalogId: raw.catalogId || raw.assetId || raw.type || null,
    interactionSpotId: raw.interactionSpotId || raw.actionLocationId || null,
    area: normalizeArea(surfaceProfile, raw.area),
    floor: Math.max(1, Math.floor(finiteNumber(raw.floor ?? raw.buildingFloor, 1))),
    coordinateSpace,
    position: {
      coordinateSpace,
      x: finiteNumber(position.x ?? raw.x ?? raw.localX ?? raw.worldX, 0),
      z: finiteNumber(position.z ?? raw.z ?? raw.localZ ?? raw.worldZ, 0),
      worldX: position.worldX ?? raw.worldX ?? null,
      worldZ: position.worldZ ?? raw.worldZ ?? null,
    },
  });
}

function normalizeAction(action = {}) {
  const raw = isRecord(action) ? action : {};
  return freezeDeep({
    actionType: raw.actionType || raw.actionId || raw.apiActionId || 'life.interact',
    capabilityTag: raw.capabilityTag || raw.primaryTag || null,
    agentId: raw.agentId || null,
    source: isRecord(raw.source) ? raw.source : { kind: raw.sourceKind || 'system' },
    priority: raw.priority || 'normal',
    reservationId: raw.reservationId || raw.reservation?.id || null,
  });
}

function normalizeCollision(surfaceProfile, collision = {}) {
  const raw = isRecord(collision) ? collision : {};
  const coordinateSpace = surfaceProfile.collisionCoordinateSpaces.includes(raw.coordinateSpace) ? raw.coordinateSpace : surfaceProfile.collisionCoordinateSpaces[0];
  return freezeDeep({
    registryVersion: raw.registryVersion || COLLISION_REGISTRY_API_VERSION,
    kind: raw.kind || raw.profile?.kind || 'solid',
    coordinateSpace,
    routingEffect: raw.routingEffect || raw.routing?.effect || 'block',
    physicsEffect: raw.physicsEffect || raw.physics?.effect || 'static-collider',
    boundsRef: raw.boundsRef || raw.assetId || raw.catalogId || null,
  });
}

function normalizeRouting(surfaceProfile, routing = {}, target) {
  const raw = isRecord(routing) ? routing : {};
  const routeTarget = isRecord(raw.routeTarget) ? raw.routeTarget : target.position;
  return freezeDeep({
    adapter: raw.adapter || surfaceProfile.routingAdapters[0],
    targetKind: raw.targetKind || surfaceProfile.targetKind,
    routeTarget: {
      x: finiteNumber(routeTarget.x ?? target.position.x, 0),
      y: finiteNumber(routeTarget.y ?? routeTarget.z ?? target.position.z, 0),
      floor: Math.max(1, Math.floor(finiteNumber(routeTarget.floor ?? target.floor, target.floor))),
      coordinateSpace: raw.coordinateSpace || target.coordinateSpace,
    },
    reachRadiusApi: Math.max(0, finiteNumber(raw.reachRadiusApi, 5)),
    transitionKinds: Object.freeze(asArray(raw.transitionKinds).length ? asArray(raw.transitionKinds) : [...surfaceProfile.transitionKinds]),
    collisionEffect: raw.collisionEffect || 'block',
  });
}

function normalizeMenu(surfaceProfile, menu = {}) {
  const raw = isRecord(menu) ? menu : {};
  return freezeDeep({
    registryVersion: raw.registryVersion || CONTEXT_MENU_ACTION_REGISTRY_API_VERSION,
    surface: raw.surface || 'context-menu',
    targetKind: raw.targetKind || surfaceProfile.targetKind,
    availabilityState: raw.availabilityState || raw.state || 'available',
    disabledReasons: Object.freeze(asArray(raw.disabledReasons || raw.reasons)),
    adapters: Object.freeze(asArray(raw.adapters).length ? asArray(raw.adapters) : [...surfaceProfile.menuAdapters]),
  });
}

function normalizeAnimation(surfaceProfile, animation = {}) {
  const raw = isRecord(animation) ? animation : {};
  const animationId = AGENT_ANIMATION_IDS.includes(raw.animationId || raw.id) ? (raw.animationId || raw.id) : 'stand-use';
  return freezeDeep({
    registryVersion: raw.registryVersion || AGENT_ANIMATION_REGISTRY_API_VERSION,
    animationId,
    triggerHints: {
      actionId: raw.actionId || null,
      roles: Object.freeze(asArray(raw.roles)),
      assetId: raw.assetId || raw.catalogId || null,
      capabilityTag: raw.capabilityTag || null,
    },
    adapters: Object.freeze(asArray(raw.adapters).length ? asArray(raw.adapters) : [...surfaceProfile.animationAdapters]),
  });
}

function formatRowsForSurface(surfaceKind, surfaceProfile) {
  return INTERACTION_PARITY_FORMATS.map(format => freezeDeep({
    format,
    compatibility: 'shared',
    registryVersion: FORMAT_REGISTRY_VERSIONS[format],
    interiorAdapter: INTERACTION_PARITY_SURFACE_PROFILES['interior-object'][`${format}Adapters`] || null,
    exteriorAdapter: INTERACTION_PARITY_SURFACE_PROFILES['exterior-node'][`${format}Adapters`] || null,
    coordinateSpaces: format === 'target'
      ? surfaceProfile.coordinateSpaces
      : (format === 'collision' ? surfaceProfile.collisionCoordinateSpaces : surfaceProfile.actionLocationCoordinateSpaces),
    surfaceKind,
  }));
}

export function normalizeInteractionSurface(input = {}) {
  const surfaceKind = normalizeSurfaceKind(input.kind || input.surfaceKind);
  const surfaceProfile = INTERACTION_PARITY_SURFACE_PROFILES[surfaceKind];
  const target = normalizeTarget(surfaceProfile, input.target || input);
  return freezeDeep({
    version: INTERACTION_PARITY_RULES_VERSION,
    surfaceKind,
    target,
    action: normalizeAction(input.action),
    collision: normalizeCollision(surfaceProfile, input.collision),
    routing: normalizeRouting(surfaceProfile, input.routing, target),
    menu: normalizeMenu(surfaceProfile, input.menu),
    animation: normalizeAnimation(surfaceProfile, input.animation),
    parityFormats: Object.freeze(formatRowsForSurface(surfaceKind, surfaceProfile)),
  });
}

export function buildInteractionParityRules({
  blueprints = CATALOG_REGISTRY_BLUEPRINTS,
  catalogRegistry = null,
  collisionRegistry = null,
  actionLocationRegistry = null,
  contextMenuRegistry = null,
  animationRegistry = null,
} = {}) {
  const resolvedCatalog = catalogRegistry || buildCatalogRegistry({ blueprints });
  const resolvedCollision = collisionRegistry || buildCollisionRegistry({ blueprints });
  const resolvedActionLocations = actionLocationRegistry || buildActionLocationRegistry({ blueprints });
  const resolvedContextMenu = contextMenuRegistry || buildContextMenuActionRegistry({ catalogRegistry: resolvedCatalog });
  const resolvedAnimation = animationRegistry || buildAnimationRegistry();
  return freezeDeep({
    version: INTERACTION_PARITY_RULES_VERSION,
    contract: INTERACTION_PARITY_CONTRACT,
    rules: INTERACTION_PARITY_RULES,
    formats: INTERACTION_PARITY_FORMATS,
    compatibility: INTERACTION_PARITY_COMPATIBILITY,
    surfaceKinds: INTERACTION_SURFACE_KINDS,
    surfaceProfiles: INTERACTION_PARITY_SURFACE_PROFILES,
    registryVersions: {
      catalog: resolvedCatalog.version || 'agent-life-catalog-registry/v1',
      actionLocation: resolvedActionLocations.version || ACTION_LOCATION_REGISTRY_API_VERSION,
      collision: resolvedCollision.version || COLLISION_REGISTRY_API_VERSION,
      contextMenu: resolvedContextMenu.version || CONTEXT_MENU_ACTION_REGISTRY_API_VERSION,
      animation: resolvedAnimation.version || AGENT_ANIMATION_REGISTRY_API_VERSION,
      worldAction: WORLD_ACTION_SCHEMA_VERSION,
    },
    examples: Object.freeze([
      normalizeInteractionSurface({
        kind: 'interior-object',
        target: { objectInstanceId: 'office-1-desk-0', catalogId: 'desk', interactionSpotId: 'default', area: { kind: 'building', buildingId: 'office-1' }, floor: 1, position: { coordinateSpace: 'building-local', x: 6.5, z: 5.22, worldX: 106.5, worldZ: 205.22 } },
        action: { actionType: 'planning.review', capabilityTag: 'planning', agentId: 'agent-coder' },
        animation: { animationId: 'write-teach', actionId: 'planning.review', roles: ['work'], assetId: 'desk', capabilityTag: 'planning' },
      }),
      normalizeInteractionSurface({
        kind: 'exterior-node',
        target: { objectInstanceId: 'park-1-bench-0', nodeId: 'park-1-bench-0', catalogId: 'chair', interactionSpotId: 'seat', area: { kind: 'outdoor-area', outdoorAreaId: 'park-1', outdoorAreaType: 'park' }, floor: 1, position: { coordinateSpace: 'outdoor-local', x: 12, z: 4, worldX: 320, worldZ: 208 } },
        action: { actionType: 'life.rest', capabilityTag: 'comfort', agentId: 'agent-visitor' },
        collision: { kind: 'soft', routingEffect: 'avoid', physicsEffect: 'none', coordinateSpace: 'outdoor-local' },
        routing: { adapter: 'dynamic-exterior-routing.js', transitionKinds: ['park-path', 'sidewalk'] },
        animation: { animationId: 'sit', actionId: 'life.rest', roles: ['seat'], assetId: 'chair', capabilityTag: 'comfort' },
      }),
    ]),
  });
}

export function validateInteractionParityRules(parity) {
  const errors = [];
  if (!isRecord(parity)) return freezeDeep({ valid: false, errors: ['parity rules must be an object'] });
  if (parity.version !== INTERACTION_PARITY_RULES_VERSION) errors.push('version must match INTERACTION_PARITY_RULES_VERSION');
  for (const format of INTERACTION_PARITY_FORMATS) {
    if (!parity.contract?.some(row => row.key === format)) errors.push(`contract missing ${format}`);
  }
  for (const kind of INTERACTION_SURFACE_KINDS) {
    const profile = parity.surfaceProfiles?.[kind];
    if (!isRecord(profile)) {
      errors.push(`surfaceProfiles.${kind} missing`);
      continue;
    }
    for (const key of ['targetKind', 'areaKind', 'coordinateSpaces', 'routingAdapters', 'menuAdapters', 'animationAdapters', 'requiredTargetFields']) {
      if (Array.isArray(profile[key]) ? profile[key].length === 0 : !profile[key]) errors.push(`${kind}.${key} missing`);
    }
    for (const coordinateSpace of profile.coordinateSpaces || []) {
      if (!PLACED_OBJECT_COORDINATE_SPACES.includes(coordinateSpace) && coordinateSpace !== 'floor-local') errors.push(`${kind}.coordinateSpaces includes unsupported ${coordinateSpace}`);
    }
    for (const coordinateSpace of profile.actionLocationCoordinateSpaces || []) {
      if (!ACTION_LOCATION_COORDINATE_SPACES.includes(coordinateSpace)) errors.push(`${kind}.actionLocationCoordinateSpaces includes unsupported ${coordinateSpace}`);
    }
    for (const coordinateSpace of profile.collisionCoordinateSpaces || []) {
      if (!COLLISION_BOUND_COORDINATE_SPACES.includes(coordinateSpace)) errors.push(`${kind}.collisionCoordinateSpaces includes unsupported ${coordinateSpace}`);
    }
  }
  for (const example of parity.examples || []) {
    const result = validateInteractionSurface(example);
    if (!result.valid) errors.push(...result.errors.map(error => `example ${example.surfaceKind}: ${error}`));
  }
  return freezeDeep({ valid: errors.length === 0, errors });
}

export function validateInteractionSurface(surface) {
  const errors = [];
  if (!isRecord(surface)) return freezeDeep({ valid: false, errors: ['interaction surface must be an object'] });
  if (surface.version !== INTERACTION_PARITY_RULES_VERSION) errors.push('surface.version must match INTERACTION_PARITY_RULES_VERSION');
  if (!INTERACTION_SURFACE_KINDS.includes(surface.surfaceKind)) errors.push('surfaceKind must be interior-object or exterior-node');
  const profile = INTERACTION_PARITY_SURFACE_PROFILES[surface.surfaceKind];
  if (profile) {
    for (const field of profile.requiredTargetFields) {
      if (field === 'position') {
        if (!isRecord(surface.target?.position)) errors.push('target.position is required');
      } else if (field === 'area') {
        if (!isRecord(surface.target?.area)) errors.push('target.area is required');
      } else if (surface.target?.[field] === undefined || surface.target?.[field] === null || surface.target?.[field] === '') {
        errors.push(`target.${field} is required`);
      }
    }
    if (!profile.coordinateSpaces.includes(surface.target?.coordinateSpace)) errors.push(`${surface.surfaceKind} target.coordinateSpace must be one of ${profile.coordinateSpaces.join(', ')}`);
    if (!profile.collisionCoordinateSpaces.includes(surface.collision?.coordinateSpace)) errors.push(`${surface.surfaceKind} collision.coordinateSpace must be one of ${profile.collisionCoordinateSpaces.join(', ')}`);
  }
  if (!asString(surface.action?.actionType)) errors.push('action.actionType is required');
  if (!asString(surface.routing?.adapter)) errors.push('routing.adapter is required');
  if (!asString(surface.menu?.surface)) errors.push('menu.surface is required');
  if (!AGENT_ANIMATION_IDS.includes(surface.animation?.animationId)) errors.push('animation.animationId must be canonical');
  for (const format of INTERACTION_PARITY_FORMATS) {
    if (!surface.parityFormats?.some(row => row.format === format && INTERACTION_PARITY_COMPATIBILITY.includes(row.compatibility))) errors.push(`parityFormats missing ${format}`);
  }
  return freezeDeep({ valid: errors.length === 0, errors });
}

export const INTERACTION_PARITY_RULESET = buildInteractionParityRules();
