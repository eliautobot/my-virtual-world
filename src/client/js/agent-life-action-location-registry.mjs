/**
 * Agent Life action-location registry API.
 *
 * Phase 0.5 technical spine for object/building interaction spots. It defines
 * one shared, side-effect-free shape for seat/use/drop-off locations, their
 * capacity/facing metadata, and the rotation/floor/exterior transforms needed
 * by later routing, reservations, world actions, and editor inspection.
 */
import {
  CATALOG_REGISTRY_BLUEPRINTS,
  buildCatalogRegistry,
} from './agent-life-catalog-registry.mjs';
import { normalizeObjectCatalogId } from './agent-life-object-catalog-schema.mjs';

export const ACTION_LOCATION_REGISTRY_API_VERSION = 'agent-life-action-location-registry/v1';

export const ACTION_LOCATION_ROLES = Object.freeze(['approach', 'seat', 'use', 'inspect', 'preview', 'drop-off', 'service', 'patient', 'customer', 'staff', 'standing-use', 'touch', 'stand', 'exit', 'dismount', 'queue', 'staging', 'work', 'watch', 'wait', 'pass-through', 'waypoint', 'stroll', 'pause', 'look-around', 'perform', 'audience', 'gather', 'social', 'speak']);
export const ACTION_LOCATION_FACINGS = Object.freeze(['north', 'east', 'south', 'west', 'auto', 'none']);
export const ACTION_LOCATION_COORDINATE_SPACES = Object.freeze(['asset-local', 'building-local', 'floor-local', 'exterior-local', 'world']);
export const ACTION_LOCATION_TRANSFORM_KINDS = Object.freeze(['rotation', 'floor', 'exterior']);
export const ACTION_LOCATION_CAPACITY_KINDS = Object.freeze(['exclusive', 'shared', 'queue']);

export const ACTION_LOCATION_REGISTRY_CONTRACT = Object.freeze([
  Object.freeze({ key: 'assetId', required: true, meaning: 'Canonical catalog/registry id after alias normalization; legacy furniture type remains an adapter input only.' }),
  Object.freeze({ key: 'locations', required: true, meaning: 'One or more action-location records with stable id, action id, roles, capacity, facing, offset, and transform metadata.' }),
  Object.freeze({ key: 'location.id', required: true, meaning: 'Stable per-asset spot id referenced by world actions, reservations, routing, and UI without embedding the full definition.' }),
  Object.freeze({ key: 'location.roles', required: true, meaning: 'Normalized semantic roles such as seat, use, service, patient, work, watch, approach, or drop-off.' }),
  Object.freeze({ key: 'location.capacity', required: true, meaning: 'Occupancy semantics for the spot: exclusive/shared/queue plus maxAgents for reservation checks.' }),
  Object.freeze({ key: 'location.facing', required: true, meaning: 'Direction an agent should face at the spot after item/building rotation transforms are applied.' }),
  Object.freeze({ key: 'location.offset', required: true, meaning: 'Asset-local offset in tile units before item rotation and building/world transforms.' }),
  Object.freeze({ key: 'location.transforms', required: true, meaning: 'Declared rotation, floor, and exterior transform ownership so route code knows what must be applied at handoff.' }),
  Object.freeze({ key: 'runtimeAdapters', required: true, meaning: 'References active runtime tables/functions that supplied current spots and expected consumers.' }),
]);

export const ACTION_LOCATION_REGISTRY_RULES = Object.freeze([
  'Action locations are metadata/adapters only: importing the registry must not move agents, reserve spots, persist state, or place furniture.',
  'Catalog assets define asset-local offsets and roles; placed object instances own x/z, floor, building, rotation, and persistence state.',
  'World actions and reservations reference actionLocationId/interactionSpotId rather than embedding location definitions.',
  'Rotation transforms apply item rotation first, then building rotation when resolving world/exterior positions.',
  'Floor transforms preserve the placed instance floor/buildingFloor so multi-floor routing does not infer floor from the catalog asset.',
  'Exterior/world transforms adapt building-local offsets through the current building origin/rotation; the registry does not create exterior routes itself.',
]);

const FALLBACK_ACTION_BY_ID = Object.freeze({
  desk: 'planning.review',
  receptionDesk: 'planning.schedule',
  printerCopier: 'maintenance.printCopy',
  serverRack: 'maintenance.inspectServerRack',
  chair: 'life.rest',
  officeChair: 'planning.review',
  conferenceChair: 'planning.meeting',
  couch: 'life.social',
  sectionalSofa: 'life.social',
  loveseat: 'life.social',
  bed: 'life.rest',
  clinicBed: 'life.medicalExam',
  clothingRack: 'appearance.editOutfit',
  bookshelf: 'planning.review',
  curtains: 'planning.inspectCurtains',
  plant: 'life.rest',
  counter: 'life.food',
  cafeCounter: 'life.orderFood',
  checkoutCounter: 'life.checkoutPurchase',
  checkoutRegister: 'life.checkoutPurchase',
  diningTable: 'life.food',
  smallCafeTable: 'life.eatDrinkAtSmallCafeTable',
  outdoorCafeTable: 'life.eatAtOutdoorCafeTable',
  sink: 'maintenance.clean',
  stove: 'life.food',
  grill: 'life.cookAtGrill',
  busStop: 'life.waitAtBusStop',
  outdoorNoticeBoard: 'planning.readOutdoorNoticeBoard',
  parkLamp: 'planning.inspectParkLamp',
  outdoorPlanter: 'maintenance.waterOutdoorPlanter',
  outdoorTrashCan: 'maintenance.disposeWaste',
  flowerBed: 'planning.inspectFlowerBed',
  vending: 'life.food',
  waterCooler: 'life.getWater',
  coffeeMachine: 'life.getWater',
  microwave: 'life.heatFood',
  tv: 'life.social',
  tvStand: 'life.inspectTvStand',
  pingpong: 'life.entertainment',
  arcadeMachine: 'life.playArcade',
  treadmill: 'training.practice',
  trainingMat: 'training.practice',
  dumbbellRack: 'training.selectWeights',
  gymBench: 'training.useGymBench',
  outdoorExerciseStation: 'training.trainAtOutdoorExerciseStation',
  playgroundSlide: 'life.playOnPlaygroundSlide',
  playgroundSwing: 'life.swingOnPlaygroundSwing',
  outdoorStage: 'life.performAtOutdoorStage',
  meetingTable: 'planning.meeting',
  smallRoundMeetingTable: 'planning.meeting',
  interiorDoor: 'world.passThroughInteriorDoor',
});

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

function normalizeFacing(value = 'auto') {
  return ACTION_LOCATION_FACINGS.includes(value) ? value : 'auto';
}

function rotateFacing(facing, rotationDeg = 0) {
  const normalized = normalizeFacing(facing);
  if (normalized === 'auto' || normalized === 'none') return normalized;
  const order = ['north', 'east', 'south', 'west'];
  const quarterTurns = Math.round(normalizeRotationDeg(rotationDeg) / 90) % 4;
  const index = order.indexOf(normalized);
  return order[(index + quarterTurns) % 4];
}

function rotateOffset(offset, rotationDeg = 0) {
  const radians = normalizeRotationDeg(rotationDeg) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = finiteNumber(offset?.x, 0);
  const z = finiteNumber(offset?.z, 0);
  return Object.freeze({
    x: Number((x * cos + z * sin).toFixed(6)),
    z: Number((-x * sin + z * cos).toFixed(6)),
  });
}

function rolesForSpot(assetId, spot = {}) {
  const raw = Array.isArray(spot.roles) ? spot.roles : [];
  const roles = new Set(raw.filter(role => ACTION_LOCATION_ROLES.includes(role)));
  const id = String(spot.id || '').toLowerCase();
  const action = String(spot.action || '').toLowerCase();
  if (id.includes('approach')) roles.add('approach');
  if (id.includes('patient')) roles.add('patient');
  if (id.includes('service') || action.includes('repair') || action.includes('diagnostic')) roles.add('service');
  if (id.includes('drop') || action.includes('drop')) roles.add('drop-off');
  if (id.includes('seat') || id.includes('lie') || action.includes('sit') || action.includes('sleep') || (['chair', 'officeChair', 'conferenceChair', 'couch', 'sectionalSofa'].includes(assetId) && !id.includes('approach'))) roles.add('seat');
  if (id.includes('wait') || action.includes('wait')) roles.add('wait');
  if (action.includes('watch')) roles.add('watch');
  if (id.includes('pass') || action.includes('passthrough') || action.includes('pass-through') || action.includes('passthroughinteriordoor') || action.includes('passthrough')) roles.add('pass-through');
  if (action.includes('work') || assetId === 'desk' || (assetId === 'officeChair' && !id.includes('approach'))) roles.add('work');
  if (roles.size === 0) roles.add('use');
  return Object.freeze([...roles]);
}

function normalizeCapacity(spot = {}) {
  const kind = ACTION_LOCATION_CAPACITY_KINDS.includes(spot.capacityKind) ? spot.capacityKind : 'exclusive';
  const maxAgents = Math.max(1, Math.floor(finiteNumber(spot.capacity ?? spot.maxAgents, 1)));
  return Object.freeze({ kind, maxAgents, reservable: spot.reservable !== false });
}

function normalizeSpot(assetId, spot, index, source) {
  if (!spot) return null;
  const id = String(spot.id || (index === 0 ? 'default' : `spot-${index + 1}`));
  const actionId = spot.actionId || spot.action || FALLBACK_ACTION_BY_ID[assetId] || null;
  const queueMetadata = {};
  for (const key of ['queueMaxPoints', 'maxQueuePoints', 'queueCapacity', 'queueSpacingTiles', 'spacingTiles', 'queueDx', 'lineDx', 'queueDz', 'lineDz']) {
    if (spot[key] !== undefined && spot[key] !== null) queueMetadata[key] = finiteNumber(spot[key], 0);
  }
  for (const key of ['queueLocations', 'queuePositions', 'queuePoints']) {
    if (Array.isArray(spot[key])) queueMetadata[key] = spot[key].map((queueSpot, queueIndex) => ({ ...queueSpot, queueIndex }));
  }
  const queueConfig = spot.queueConfig || null;
  if (!queueMetadata.queueLocations && Array.isArray(queueConfig?.locations)) queueMetadata.queueLocations = queueConfig.locations.map((queueSpot, queueIndex) => ({ ...queueSpot, queueIndex }));
  if (!queueMetadata.queuePositions && Array.isArray(queueConfig?.positions)) queueMetadata.queuePositions = queueConfig.positions.map((queueSpot, queueIndex) => ({ ...queueSpot, queueIndex }));
  if (!queueMetadata.queuePoints && Array.isArray(queueConfig?.points)) queueMetadata.queuePoints = queueConfig.points.map((queueSpot, queueIndex) => ({ ...queueSpot, queueIndex }));
  for (const key of ['serviceQueue', 'queuePolicy', 'queueAddon']) {
    if (spot[key] !== undefined && spot[key] !== null) queueMetadata[key] = spot[key];
  }
  if (queueConfig) queueMetadata.queueConfig = queueConfig;
  return freezeDeep({
    id,
    actionId,
    roles: rolesForSpot(assetId, spot),
    capacity: normalizeCapacity(spot),
    facing: normalizeFacing(spot.facing),
    animationId: spot.animationId || spot.poseAnimationId || null,
    poseId: spot.poseId || null,
    facingMode: spot.facingMode || null,
    useDurationMs: spot.useDurationMs || spot.durationMs || spot.completionDurationMs || null,
    approachSpotId: spot.approachSpotId || null,
    activationSpotId: spot.activationSpotId || spot.id || id,
    offset: Object.freeze({ x: finiteNumber(spot.dx ?? spot.x, 0), z: finiteNumber(spot.dz ?? spot.z, 0), units: spot.units || 'tile' }),
    ...queueMetadata,
    coordinateSpace: 'asset-local',
    transforms: Object.freeze({
      rotation: Object.freeze({ kind: 'rotation', applies: true, order: Object.freeze(['item.rotation', 'building._rotation']), outputFacing: true }),
      floor: Object.freeze({ kind: 'floor', applies: true, source: 'placedObject.buildingFloor || placedObject.floor || building.activeFloor || 1' }),
      exterior: Object.freeze({ kind: 'exterior', applies: true, source: 'building-local + building origin/rotation when resolving world coordinates' }),
    }),
    source,
  });
}

function normalizeSpotList(assetId, actionSpots = {}, interactionSpots = {}, blueprint = null) {
  const explicitList = Array.isArray(interactionSpots?.[assetId]) ? interactionSpots[assetId] : null;
  const blueprintList = Array.isArray(blueprint?.interactionSpots) ? blueprint.interactionSpots : null;
  const fallback = actionSpots?.[assetId] ? [actionSpots[assetId]] : [];
  const source = explicitList ? 'FURNITURE_INTERACTION_SPOTS' : (blueprintList ? 'CATALOG_REGISTRY_BLUEPRINTS.interactionSpots' : 'ACTION_SPOTS');
  return (explicitList || blueprintList || fallback)
    .map((spot, index) => normalizeSpot(assetId, spot, index, source))
    .filter(Boolean);
}

export function buildActionLocationRegistry({ blueprints = CATALOG_REGISTRY_BLUEPRINTS, actionSpots = {}, interactionSpots = {}, includeSpotOnlyAssets = true } = {}) {
  const catalogRegistry = buildCatalogRegistry({ blueprints, actionSpots, interactionSpots });
  const blueprintById = new Map((blueprints || []).map(blueprint => [blueprint.id, blueprint]));
  const ids = new Set(catalogRegistry.entries.map(entry => entry.id));
  if (includeSpotOnlyAssets) {
    for (const id of [...Object.keys(actionSpots || {}), ...Object.keys(interactionSpots || {})]) ids.add(normalizeObjectCatalogId(id) || id);
  }
  const profiles = [...ids].sort().map((assetId) => {
    const entry = catalogRegistry.get(assetId);
    const locations = normalizeSpotList(assetId, actionSpots, interactionSpots, blueprintById.get(assetId));
    return freezeDeep({
      assetId,
      objectCatalogId: entry?.objectCatalogId || null,
      label: entry?.label || assetId,
      locations: Object.freeze(locations),
      runtimeAdapters: Object.freeze({
        actionSpotSource: actionSpots?.[assetId] ? 'main3d.ACTION_SPOTS' : null,
        interactionSpotSource: interactionSpots?.[assetId] ? 'main3d.FURNITURE_INTERACTION_SPOTS' : null,
        routeConsumers: Object.freeze(['main3d.js:getFurnitureActionSpot/setAgentTarget', 'future world-actions route planner']),
        reservationConsumers: Object.freeze(['agent-life-world-action-schema.mjs#reservation', 'future object reservation API']),
      }),
    });
  });
  const byId = new Map(profiles.map(profile => [profile.assetId, profile]));
  return freezeDeep({
    version: ACTION_LOCATION_REGISTRY_API_VERSION,
    profiles: Object.freeze(profiles),
    get(assetId) {
      const normalized = normalizeObjectCatalogId(assetId) || assetId;
      return byId.get(normalized) || byId.get(assetId) || null;
    },
    getLocation(assetId, locationId = 'default') {
      const profile = this.get(assetId);
      return profile?.locations.find(location => location.id === locationId) || null;
    },
    list({ role = null, actionId = null, hasLocations = false } = {}) {
      return profiles.filter(profile => {
        if (hasLocations && profile.locations.length === 0) return false;
        if (role && !profile.locations.some(location => location.roles.includes(role))) return false;
        if (actionId && !profile.locations.some(location => location.actionId === actionId)) return false;
        return true;
      });
    },
  });
}

export function resolveActionLocationProfile(assetId, { registry = null, actionSpots = {}, interactionSpots = {} } = {}) {
  const resolvedRegistry = registry || buildActionLocationRegistry({ actionSpots, interactionSpots });
  const normalized = normalizeObjectCatalogId(assetId) || assetId;
  return resolvedRegistry.get(normalized) || null;
}

export function getActionLocationsForAsset(assetId, options = {}) {
  return resolveActionLocationProfile(assetId, options)?.locations || Object.freeze([]);
}

export function resolvePlacedActionLocations({ item = {}, building = null, index = 0, registry = null, actionSpots = {}, interactionSpots = {}, coordinateSpace = 'building-local', includeBuildingRotation = true } = {}) {
  const assetId = normalizeObjectCatalogId(item?.catalogId || item?.objectCatalogId || item?.type) || item?.type || 'unknown';
  const profile = resolveActionLocationProfile(assetId, { registry, actionSpots, interactionSpots });
  const itemRotation = normalizeRotationDeg(item?.rotationDeg ?? item?.rotation ?? 0);
  const buildingRotation = includeBuildingRotation ? normalizeRotationDeg(building?._rotation ?? building?.rotation ?? 0) : 0;
  const totalRotation = normalizeRotationDeg(itemRotation + buildingRotation);
  const itemX = finiteNumber(item?.x ?? item?.localX ?? 0, 0);
  const itemZ = finiteNumber(item?.z ?? item?.localZ ?? 0, 0);
  const originX = finiteNumber(building?.worldX ?? building?.x ?? 0, 0);
  const originZ = finiteNumber(building?.worldZ ?? building?.z ?? 0, 0);
  const floor = Math.max(1, Math.floor(finiteNumber(item?.buildingFloor ?? item?.floor ?? building?.activeFloor ?? 1, 1)));
  const outputSpace = ACTION_LOCATION_COORDINATE_SPACES.includes(coordinateSpace) ? coordinateSpace : 'building-local';
  const resolved = (profile?.locations || []).map((location) => {
    const localOffset = rotateOffset(location.offset, itemRotation);
    const buildingLocal = Object.freeze({ x: Number((itemX + localOffset.x).toFixed(6)), z: Number((itemZ + localOffset.z).toFixed(6)) });
    const worldOffset = includeBuildingRotation ? rotateOffset(buildingLocal, buildingRotation) : buildingLocal;
    const world = Object.freeze({ x: Number((originX + worldOffset.x).toFixed(6)), z: Number((originZ + worldOffset.z).toFixed(6)) });
    const authoredQueueLocations = Array.isArray(location.queueLocations) ? location.queueLocations
      : (Array.isArray(location.queuePositions) ? location.queuePositions
        : (Array.isArray(location.queuePoints) ? location.queuePoints : []));
    const resolvedQueueLocations = authoredQueueLocations.map((queueSpot, queueIndex) => {
      const queueOffset = Object.freeze({
        x: finiteNumber(queueSpot.dx ?? queueSpot.offset?.x ?? queueSpot.x, location.offset.x),
        z: finiteNumber(queueSpot.dz ?? queueSpot.offset?.z ?? queueSpot.z ?? queueSpot.y, location.offset.z),
      });
      const queueLocalOffset = rotateOffset(queueOffset, itemRotation);
      const queueBuildingLocal = Object.freeze({ x: Number((itemX + queueLocalOffset.x).toFixed(6)), z: Number((itemZ + queueLocalOffset.z).toFixed(6)) });
      const queueWorldOffset = includeBuildingRotation ? rotateOffset(queueBuildingLocal, buildingRotation) : queueBuildingLocal;
      const queueWorld = Object.freeze({ x: Number((originX + queueWorldOffset.x).toFixed(6)), z: Number((originZ + queueWorldOffset.z).toFixed(6)) });
      return freezeDeep({
        ...queueSpot,
        id: String(queueSpot.id || queueSpot.spotId || `${location.id}:${queueIndex}`),
        spotId: String(queueSpot.spotId || queueSpot.id || `${location.id}:${queueIndex}`),
        slotId: String(queueSpot.slotId || queueSpot.spotId || queueSpot.id || `${location.id}:${queueIndex}`),
        queueSpotId: location.id,
        queueIndex: Math.max(0, Math.floor(finiteNumber(queueSpot.queueIndex ?? queueSpot.index ?? queueIndex, queueIndex))),
        position: outputSpace === 'world' || outputSpace === 'exterior-local' ? queueWorld : queueBuildingLocal,
        buildingLocal: queueBuildingLocal,
        world: queueWorld,
      });
    }).sort((a, b) => a.queueIndex - b.queueIndex || String(a.id).localeCompare(String(b.id)));
    return freezeDeep({
      ...location,
      assetId,
      objectInstanceId: item?.id || item?.instanceId || null,
      index,
      floor,
      coordinateSpace: outputSpace,
      facing: rotateFacing(location.facing, totalRotation),
      rotationDeg: totalRotation,
      position: outputSpace === 'world' || outputSpace === 'exterior-local' ? world : buildingLocal,
      buildingLocal,
      world,
      resolvedQueueLocations: Object.freeze(resolvedQueueLocations),
      transformApplied: Object.freeze({ itemRotation, buildingRotation, totalRotation, floor, exterior: outputSpace === 'world' || outputSpace === 'exterior-local' }),
    });
  });
  return freezeDeep({ assetId, profile: profile || null, locations: Object.freeze(resolved), index, floor });
}

export function validateActionLocationRegistry(registry) {
  const errors = [];
  if (!registry || registry.version !== ACTION_LOCATION_REGISTRY_API_VERSION) errors.push('registry.version must match ACTION_LOCATION_REGISTRY_API_VERSION');
  if (!Array.isArray(registry?.profiles) || registry.profiles.length === 0) errors.push('registry.profiles must be a non-empty array');
  const ids = new Set();
  for (const profile of registry?.profiles || []) {
    if (!profile.assetId || ids.has(profile.assetId)) errors.push(`duplicate or missing assetId ${profile.assetId || '<missing>'}`);
    ids.add(profile.assetId);
    if (!Array.isArray(profile.locations)) errors.push(`${profile.assetId}.locations must be an array`);
    for (const location of profile.locations || []) {
      if (!location.id) errors.push(`${profile.assetId}.locations[] missing id`);
      if (!Array.isArray(location.roles) || location.roles.some(role => !ACTION_LOCATION_ROLES.includes(role))) errors.push(`${profile.assetId}.${location.id}.roles must be valid roles`);
      if (!ACTION_LOCATION_FACINGS.includes(location.facing)) errors.push(`${profile.assetId}.${location.id}.facing must be valid`);
      if (!ACTION_LOCATION_CAPACITY_KINDS.includes(location.capacity?.kind) || typeof location.capacity?.maxAgents !== 'number') errors.push(`${profile.assetId}.${location.id}.capacity must be valid`);
      if (typeof location.offset?.x !== 'number' || typeof location.offset?.z !== 'number') errors.push(`${profile.assetId}.${location.id}.offset must be numeric`);
      for (const kind of ACTION_LOCATION_TRANSFORM_KINDS) {
        if (location.transforms?.[kind]?.kind !== kind) errors.push(`${profile.assetId}.${location.id}.transforms.${kind} missing`);
      }
    }
  }
  return freezeDeep({ valid: errors.length === 0, errors });
}

export const ACTION_LOCATION_REGISTRY = buildActionLocationRegistry();
