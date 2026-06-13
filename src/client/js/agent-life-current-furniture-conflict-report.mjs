/**
 * Agent Life current furniture conflict report.
 *
 * Additive Phase 1 guardrail for comparing catalog/registry assets against the
 * current Virtual World furniture implementation. This module is side-effect
 * free: it does not place meshes, create colliders, route agents, mutate
 * building interiors, open UI, or persist data.
 */
import {
  CATALOG_REGISTRY_BLUEPRINTS,
  buildCatalogRegistry,
  buildEditorFurnitureCatalog,
} from './agent-life-catalog-registry.mjs';
import {
  normalizeObjectCatalogId,
} from './agent-life-object-catalog-schema.mjs';
import {
  buildCollisionRegistry,
  resolvePlacedCollisionBounds,
} from './agent-life-collision-registry.mjs';
import {
  buildActionLocationRegistry,
  resolvePlacedActionLocations,
} from './agent-life-action-location-registry.mjs';
import {
  buildContextMenuActionRegistry,
} from './agent-life-context-menu-action-registry.mjs';

export const CURRENT_FURNITURE_CONFLICT_REPORT_VERSION = 'agent-life-current-furniture-conflict-report/v1';

export const CURRENT_FURNITURE_CONFLICT_CHECK_IDS = Object.freeze([
  'names-and-aliases',
  'collision-footprints',
  'action-locations-and-routing',
  'ui-menu-catalog',
  'persistence-contract',
]);

export const CURRENT_FURNITURE_CONFLICT_RULES = Object.freeze([
  'Current Virtual World furniture ids remain the runtime source of truth; Agent Life aliases must resolve to those ids instead of creating duplicate rows.',
  'Collision checks compare catalog registry profiles to the active FURNITURE_HALF_SIZES adapter; the report must not introduce a second collision table.',
  'Action-location and routing checks use the same ACTION_SPOTS/FURNITURE_INTERACTION_SPOTS adapters that main3d.js uses for agent targets.',
  'UI checks verify generated editor catalog/context-menu metadata only; they do not open menus or synthesize new assets.',
  'Persistence checks prove placed furniture can keep the canonical type/lifecycle fields that building.interior.furniture[] already saves.',
]);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeId(value) {
  return normalizeObjectCatalogId(value) || (typeof value === 'string' ? value.trim() : '');
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n);
}

function makeCheck({ id, passed = true, messages = [], assets = [] }) {
  return freezeDeep({
    id,
    passed: Boolean(passed),
    messages: Object.freeze(messages.filter(Boolean)),
    assets: Object.freeze([...new Set(assets.filter(Boolean))].sort()),
  });
}

function getVisibleEntries(catalogRegistry) {
  return catalogRegistry.list({ visibleOnly: true });
}

function checkNamesAndAliases({ blueprints, catalogRegistry, currentIds }) {
  const messages = [];
  const assets = [];
  const ownerByLookup = new Map();

  for (const blueprint of asArray(blueprints)) {
    const id = normalizeId(blueprint?.id);
    if (!id) continue;
    for (const rawLookup of [id, ...asArray(blueprint.aliases)]) {
      const lookup = normalizeId(rawLookup);
      if (!lookup) continue;
      const previous = ownerByLookup.get(lookup);
      if (previous && previous !== id) {
        messages.push(`lookup ${lookup} resolves to both ${previous} and ${id}`);
        assets.push(previous, id);
      }
      ownerByLookup.set(lookup, id);
    }
  }

  for (const [alias, owner] of Object.entries(catalogRegistry.aliases || {})) {
    const normalizedAlias = normalizeId(alias);
    const currentOwner = currentIds.has(normalizedAlias) ? normalizedAlias : null;
    if (currentOwner && currentOwner !== owner) {
      messages.push(`alias ${alias} for ${owner} conflicts with current furniture id ${currentOwner}`);
      assets.push(owner, currentOwner);
    }
  }

  const duplicateRows = new Map();
  for (const entry of catalogRegistry.entries) {
    const labelKey = String(entry.name || entry.label || '').replace(/^[^A-Za-z0-9]+/, '').trim().toLowerCase();
    if (!labelKey) continue;
    const previous = duplicateRows.get(labelKey);
    if (previous && previous !== entry.id) {
      messages.push(`catalog label/name ${labelKey} appears for both ${previous} and ${entry.id}`);
      assets.push(previous, entry.id);
    }
    duplicateRows.set(labelKey, entry.id);
  }

  return makeCheck({ id: 'names-and-aliases', passed: messages.length === 0, messages, assets });
}

function checkCollisionFootprints({ visibleEntries, collisionRegistry, halfSizes }) {
  const messages = [];
  const assets = [];
  for (const entry of visibleEntries) {
    const halfSize = halfSizes?.[entry.id];
    const profile = collisionRegistry.get(entry.id);
    if (!halfSize) {
      messages.push(`${entry.id} has no active FURNITURE_HALF_SIZES footprint`);
      assets.push(entry.id);
      continue;
    }
    if (!profile) {
      messages.push(`${entry.id} has no collision registry profile`);
      assets.push(entry.id);
      continue;
    }
    const bound = profile.bounds?.[0];
    if (profile.kind === 'solid') {
      const [halfW, halfD] = halfSize;
      if (!bound || Math.abs(bound.halfW - halfW) > 0.0001 || Math.abs(bound.halfD - halfD) > 0.0001) {
        messages.push(`${entry.id} collision bounds ${bound?.halfW}x${bound?.halfD} do not match current half size ${halfW}x${halfD}`);
        assets.push(entry.id);
      }
      if (!profile.routing?.blocksPathfinding || !profile.physics?.createStaticCollider) {
        messages.push(`${entry.id} solid collision must block routing and create a static collider`);
        assets.push(entry.id);
      }
    } else if (!['soft', 'non-solid'].includes(profile.kind)) {
      messages.push(`${entry.id} has unsupported collision kind ${profile.kind}`);
      assets.push(entry.id);
    }
  }
  return makeCheck({ id: 'collision-footprints', passed: messages.length === 0, messages, assets });
}

function checkActionLocationsAndRouting({ visibleEntries, actionLocationRegistry, collisionRegistry, actionSpots, interactionSpots, halfSizes }) {
  const messages = [];
  const assets = [];
  const sampleBuilding = { id: 'qa-building', worldX: 12, worldZ: 34, _rotation: 90, activeFloor: 2 };
  for (const entry of visibleEntries) {
    const sourceSpots = asArray(interactionSpots?.[entry.id]);
    const fallbackSpot = actionSpots?.[entry.id];
    const profile = actionLocationRegistry.get(entry.id);
    if (sourceSpots.length && profile?.locations?.length !== sourceSpots.length) {
      messages.push(`${entry.id} action-location registry count ${profile?.locations?.length || 0} does not match FURNITURE_INTERACTION_SPOTS count ${sourceSpots.length}`);
      assets.push(entry.id);
    }
    if (!sourceSpots.length && fallbackSpot && profile?.locations?.length !== 1) {
      messages.push(`${entry.id} action-location registry should adapt ACTION_SPOTS fallback`);
      assets.push(entry.id);
    }
    const ids = new Set();
    for (const location of profile?.locations || []) {
      if (ids.has(location.id)) {
        messages.push(`${entry.id} has duplicate action-location id ${location.id}`);
        assets.push(entry.id);
      }
      ids.add(location.id);
    }
    const sampleItem = { type: entry.id, x: 3.25, z: 4.5, rotation: 270, floor: 2 };
    const routed = resolvePlacedActionLocations({
      item: sampleItem,
      building: sampleBuilding,
      registry: actionLocationRegistry,
      actionSpots,
      interactionSpots,
      coordinateSpace: 'world',
    });
    for (const location of routed.locations || []) {
      if (!finiteNumber(location.world?.x) || !finiteNumber(location.world?.z) || !finiteNumber(location.buildingLocal?.x) || !finiteNumber(location.buildingLocal?.z)) {
        messages.push(`${entry.id}.${location.id} resolves to non-finite route coordinates`);
        assets.push(entry.id);
      }
      if (location.floor !== 2) {
        messages.push(`${entry.id}.${location.id} lost placed floor during route transform`);
        assets.push(entry.id);
      }
    }
    const collision = resolvePlacedCollisionBounds({
      item: sampleItem,
      building: sampleBuilding,
      halfSizes,
      registry: collisionRegistry,
      coordinateSpace: 'building-local',
    });
    for (const bound of collision.bounds || []) {
      if (!finiteNumber(bound.offset?.x) || !finiteNumber(bound.offset?.z) || !finiteNumber(bound.rotationDeg)) {
        messages.push(`${entry.id} collision route transform resolves to non-finite data`);
        assets.push(entry.id);
      }
    }
  }
  return makeCheck({ id: 'action-locations-and-routing', passed: messages.length === 0, messages, assets });
}

function checkUiMenuCatalog({ visibleEntries, catalogRegistry, contextMenuRegistry, editorCatalog }) {
  const messages = [];
  const assets = [];
  const uiRows = new Map();
  for (const [category, rows] of Object.entries(editorCatalog || {})) {
    for (const row of rows || []) {
      if (uiRows.has(row.type)) {
        messages.push(`${row.type} appears in multiple editor UI catalog groups (${uiRows.get(row.type)} and ${category})`);
        assets.push(row.type);
      }
      uiRows.set(row.type, category);
    }
  }
  for (const entry of visibleEntries) {
    if (!uiRows.has(entry.id)) {
      messages.push(`${entry.id} is editor-visible in registry but missing from generated FURNITURE_CATALOG`);
      assets.push(entry.id);
    }
    if (!catalogRegistry.get(entry.id)) {
      messages.push(`${entry.id} cannot be resolved by catalog registry lookup`);
      assets.push(entry.id);
    }
    const contextActions = contextMenuRegistry.list({ catalogId: entry.id });
    if (contextActions.some(action => action.target?.catalogId !== entry.id)) {
      messages.push(`${entry.id} has context-menu actions targeting a different catalog id`);
      assets.push(entry.id);
    }
  }
  return makeCheck({ id: 'ui-menu-catalog', passed: messages.length === 0, messages, assets });
}

function checkPersistenceContract({ visibleEntries, halfSizes, persistenceSource = '' }) {
  const messages = [];
  const assets = [];
  const source = String(persistenceSource || '');
  const hasGenericPlacedType = source.includes('const placedFurniture = { type: _furniturePlacementType');
  const hasLifecycle = source.includes('placedFurniture.lifecycle = { stationary: true, carryable: false, temporary: false, persistsUntilDeleted: true }');
  const hasAssetClass = source.includes('assetClassByFurnitureType[_furniturePlacementType]') || source.includes('stationary-persistent-furniture');
  if (!hasGenericPlacedType) messages.push('main3d.js placement contract must preserve placedFurniture.type from _furniturePlacementType');
  if (!hasLifecycle) messages.push('main3d.js placement contract must stamp stationary persistent lifecycle metadata');
  if (!hasAssetClass) messages.push('main3d.js placement contract must retain assetClass metadata for placed furniture');
  for (const entry of visibleEntries) {
    if (!halfSizes?.[entry.id]) {
      messages.push(`${entry.id} cannot be persisted safely because it has no active half-size placement footprint`);
      assets.push(entry.id);
    }
  }
  return makeCheck({ id: 'persistence-contract', passed: messages.length === 0, messages, assets });
}

export function buildCurrentFurnitureConflictReport({
  blueprints = CATALOG_REGISTRY_BLUEPRINTS,
  halfSizes = {},
  actionSpots = {},
  interactionSpots = {},
  meshBuilders = {},
  persistenceSource = '',
} = {}) {
  const catalogRegistry = buildCatalogRegistry({ blueprints, halfSizes, actionSpots, interactionSpots });
  const collisionRegistry = buildCollisionRegistry({ blueprints, halfSizes });
  const actionLocationRegistry = buildActionLocationRegistry({ blueprints, actionSpots, interactionSpots });
  const contextMenuRegistry = buildContextMenuActionRegistry({ catalogRegistry });
  const editorCatalog = buildEditorFurnitureCatalog(blueprints);
  const visibleEntries = getVisibleEntries(catalogRegistry);
  const currentIds = new Set(Object.keys({ ...halfSizes, ...actionSpots, ...interactionSpots, ...meshBuilders }).map(normalizeId).filter(Boolean));
  const checks = Object.freeze([
    checkNamesAndAliases({ blueprints, catalogRegistry, currentIds }),
    checkCollisionFootprints({ visibleEntries, collisionRegistry, halfSizes }),
    checkActionLocationsAndRouting({ visibleEntries, actionLocationRegistry, collisionRegistry, actionSpots, interactionSpots, halfSizes }),
    checkUiMenuCatalog({ visibleEntries, catalogRegistry, contextMenuRegistry, editorCatalog }),
    checkPersistenceContract({ visibleEntries, halfSizes, persistenceSource }),
  ]);
  const failedChecks = checks.filter(check => !check.passed).map(check => check.id);
  return freezeDeep({
    version: CURRENT_FURNITURE_CONFLICT_REPORT_VERSION,
    rules: CURRENT_FURNITURE_CONFLICT_RULES,
    currentFurnitureCounts: Object.freeze({
      halfSizes: Object.keys(halfSizes || {}).length,
      actionSpots: Object.keys(actionSpots || {}).length,
      interactionSpots: Object.keys(interactionSpots || {}).length,
      meshBuilders: Object.keys(meshBuilders || {}).length,
      visibleCatalogEntries: visibleEntries.length,
    }),
    checks,
    valid: failedChecks.length === 0,
    failedChecks: Object.freeze(failedChecks),
  });
}

export function validateCurrentFurnitureConflictReport(report) {
  const errors = [];
  if (!report || report.version !== CURRENT_FURNITURE_CONFLICT_REPORT_VERSION) errors.push('report.version must match CURRENT_FURNITURE_CONFLICT_REPORT_VERSION');
  const ids = new Set((report?.checks || []).map(check => check.id));
  for (const id of CURRENT_FURNITURE_CONFLICT_CHECK_IDS) {
    if (!ids.has(id)) errors.push(`missing check ${id}`);
  }
  for (const check of report?.checks || []) {
    if (typeof check.passed !== 'boolean') errors.push(`${check.id}.passed must be boolean`);
    if (!Array.isArray(check.messages)) errors.push(`${check.id}.messages must be an array`);
    if (!Array.isArray(check.assets)) errors.push(`${check.id}.assets must be an array`);
  }
  return freezeDeep({ valid: errors.length === 0, errors });
}
