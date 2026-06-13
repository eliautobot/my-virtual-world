/**
 * Agent Life MVP vertical slice contract.
 *
 * Task 14 marks the first playable slice by connecting the Phase 0.5 metadata
 * spine into one explicit readiness contract: catalog/taxonomy, action-location
 * registry, five starter functional assets, world-action API payloads,
 * right-click assignment, and simple autonomy routing handoff.
 *
 * This module is side-effect free. It validates contracts and builds adapter
 * plans only; main3d.js owns actual placement, menus, routing, and persistence.
 */
import {
  buildCatalogRegistry,
} from './agent-life-catalog-registry.mjs';
import {
  buildActionLocationRegistry,
} from './agent-life-action-location-registry.mjs';
import {
  buildContextMenuActionRegistry,
} from './agent-life-context-menu-action-registry.mjs';
import {
  validateWorldAction,
} from './agent-life-world-action-schema.mjs';
import {
  getObjectCatalogExample,
  normalizeObjectCatalogId,
} from './agent-life-object-catalog-schema.mjs';

export const MVP_VERTICAL_SLICE_VERSION = 'agent-life-mvp-vertical-slice/v1';

export const MVP_VERTICAL_SLICE_ASSETS = Object.freeze([
  Object.freeze({
    id: 'barberChair',
    objectCatalogId: 'barber-chair',
    requiredActionIds: Object.freeze(['appearance.editHair', 'queue.reserveBarberChair']),
    requiredSpotIds: Object.freeze(['seat', 'stylist']),
    playableIntent: 'Customer routes to chair, reserves a seat, and opens appearance edit flow.',
  }),
  Object.freeze({
    id: 'whiteboard',
    objectCatalogId: 'whiteboard',
    requiredActionIds: Object.freeze(['planning.brainstorm', 'planning.reviewBoard']),
    requiredSpotIds: Object.freeze(['presenter', 'viewer-left', 'viewer-right']),
    playableIntent: 'Agent routes to board presenter/viewer spots for planning or review.',
  }),
  Object.freeze({
    id: 'clinicBed',
    objectCatalogId: 'clinic-bed',
    requiredActionIds: Object.freeze(['life.medicalExam', 'life.recoverAtClinicBed']),
    requiredSpotIds: Object.freeze(['patient', 'service', 'foot-service']),
    playableIntent: 'Patient/staff agents reserve patient or service spots for recovery/repair actions.',
  }),
  Object.freeze({
    id: 'parkBench',
    objectCatalogId: 'park-bench',
    requiredActionIds: Object.freeze(['life.sitAtBench', 'life.restAtBench', 'life.readAtBench', 'life.socialAtBench']),
    requiredSpotIds: Object.freeze(['approach-front', 'seat-left', 'seat-center', 'seat-right']),
    playableIntent: 'Autonomy can route idle agents to public sit/rest/read/social seating through a front approach and explicit seat occupancy.',
  }),
  Object.freeze({
    id: 'foodTruckCounter',
    objectCatalogId: 'food-truck-counter',
    requiredActionIds: Object.freeze(['life.orderFood', 'maintenance.serveFoodTruck']),
    requiredSpotIds: Object.freeze(['customer', 'server', 'queue']),
    playableIntent: 'Hungry/assigned agents route to customer/server counter spots through world actions.',
  }),
]);

export const MVP_VERTICAL_SLICE_CONTRACT = Object.freeze([
  Object.freeze({ key: 'catalogTaxonomy', required: true, meaning: 'Each MVP asset resolves through catalog registry, object definition, taxonomy, tags, and editor visibility.' }),
  Object.freeze({ key: 'actionLocationRegistry', required: true, meaning: 'Each MVP asset exposes stable interaction spot ids used by routing, reservations, menus, and world-action payloads.' }),
  Object.freeze({ key: 'worldActionsApi', required: true, meaning: 'Each MVP action can produce a queued world-action payload with target objectInstanceId/catalogId/interactionSpotId references.' }),
  Object.freeze({ key: 'rightClickAssignAgent', required: true, meaning: 'Object context menus can assign a selected/available agent to an action target without embedding object definitions.' }),
  Object.freeze({ key: 'simpleAutonomyRouting', required: true, meaning: 'Autonomy maps agent needs/capabilities to an MVP object action, action-location spot, and route handoff target.' }),
]);

export const MVP_VERTICAL_SLICE_RULES = Object.freeze([
  'The MVP slice is playable only when the same asset ids resolve across catalog, action-location, context-menu, and world-action payload contracts.',
  'Right-click assignment creates/queues a world-action payload; it must not bypass permission or reservation metadata.',
  'Simple autonomy may choose the first suitable available MVP target, but it must still route through action-location ids instead of hard-coded offsets.',
  'Assets may be used indoors or outdoors; placed object instances own building/floor/world coordinates while catalog objects remain reusable metadata.',
  'The contract stays side-effect free. Runtime code may expose helpers from this contract, but importing it must not place objects, move agents, or persist data.',
]);

export const MVP_VERTICAL_SLICE_INTERACTION_SPOTS = Object.freeze({
  barberChair: Object.freeze([
    Object.freeze({ id: 'seat', dx: 0, dz: 0.18, facing: 'north', action: 'appearance.editHair', roles: Object.freeze(['seat']), capacity: 1 }),
    Object.freeze({ id: 'stylist', dx: 0, dz: 0.95, facing: 'south', action: 'appearance.styleHair', roles: Object.freeze(['service']), capacity: 1 }),
  ]),
  whiteboard: Object.freeze([
    Object.freeze({ id: 'presenter', dx: 0, dz: 0.65, facing: 'north', action: 'planning.brainstorm', roles: Object.freeze(['use', 'work']), capacity: 1 }),
    Object.freeze({ id: 'viewer-left', dx: -0.75, dz: 1.25, facing: 'north', action: 'planning.reviewBoard', roles: Object.freeze(['watch']), capacity: 1 }),
    Object.freeze({ id: 'viewer-right', dx: 0.75, dz: 1.25, facing: 'north', action: 'planning.reviewBoard', roles: Object.freeze(['watch']), capacity: 1 }),
  ]),
  clinicBed: Object.freeze([
    Object.freeze({ id: 'patient', dx: 0, dz: 0.05, facing: 'north', action: 'life.medicalExam', roles: Object.freeze(['patient']), capacity: 1 }),
    Object.freeze({ id: 'service', dx: 1.12, dz: -0.08, facing: 'west', action: 'maintenance.repair', roles: Object.freeze(['service']), capacity: 1 }),
    Object.freeze({ id: 'foot-service', dx: 0, dz: 1.62, facing: 'north', action: 'maintenance.diagnostics', roles: Object.freeze(['service']), capacity: 1 }),
  ]),
  parkBench: Object.freeze([
    Object.freeze({ id: 'approach-front', dx: 0, dz: 0.82, facing: 'north', action: 'life.approachParkBench', roles: Object.freeze(['approach', 'queue']), capacityKind: 'queue', capacity: 2 }),
    Object.freeze({ id: 'seat-left', dx: -0.44, dz: 0.08, facing: 'north', action: 'life.restAtBench', roles: Object.freeze(['seat', 'rest']), capacity: 1 }),
    Object.freeze({ id: 'seat-center', dx: 0, dz: 0.08, facing: 'north', action: 'life.readAtBench', roles: Object.freeze(['seat', 'read', 'rest']), capacity: 1 }),
    Object.freeze({ id: 'seat-right', dx: 0.44, dz: 0.08, facing: 'north', action: 'life.socialAtBench', roles: Object.freeze(['seat', 'social', 'talk']), capacity: 1 }),
  ]),
  foodTruckCounter: Object.freeze([
    Object.freeze({ id: 'customer', dx: 0, dz: 0.82, facing: 'north', action: 'life.orderFood', roles: Object.freeze(['use']), capacity: 1 }),
    Object.freeze({ id: 'server', dx: 0, dz: -0.58, facing: 'south', action: 'maintenance.serveFoodTruck', roles: Object.freeze(['service']), capacity: 1 }),
    Object.freeze({ id: 'queue', dx: 0, dz: 1.55, facing: 'north', action: 'planning.schedule', roles: Object.freeze(['approach']), capacityKind: 'queue', capacity: 3 }),
  ]),
});

const NEED_TO_ACTION = Object.freeze({
  appearance: 'appearance.editHair',
  planning: 'planning.brainstorm',
  medical: 'life.medicalExam',
  rest: 'life.restAtBench',
  social: 'life.socialAtBench',
  food: 'life.orderFood',
  staffFood: 'maintenance.serveFoodTruck',
});

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function actionMatchesNeed(asset, definition, need) {
  const desiredAction = NEED_TO_ACTION[need] || need;
  return asset.requiredActionIds.includes(desiredAction)
    || asArray(definition?.apiActions).some(action => action.id === desiredAction || action.primaryTag === desiredAction)
    || asArray(definition?.tags).includes(desiredAction);
}

function firstRequiredActionForNeed(asset, definition, need) {
  const desiredAction = NEED_TO_ACTION[need] || need;
  const byId = asArray(definition?.apiActions).find(action => action.id === desiredAction || action.primaryTag === desiredAction);
  return byId?.id || asset.requiredActionIds.find(id => id === desiredAction) || asset.requiredActionIds[0];
}

function findLocationForAction(profile, actionId, requiredSpotIds) {
  return asArray(profile?.locations).find(location => location.actionId === actionId)
    || asArray(profile?.locations).find(location => requiredSpotIds.includes(location.id))
    || asArray(profile?.locations)[0]
    || null;
}

export function buildMvpVerticalSlice({ catalogRegistry = null, actionLocationRegistry = null, contextMenuRegistry = null } = {}) {
  const resolvedCatalog = catalogRegistry || buildCatalogRegistry();
  const resolvedActionLocations = actionLocationRegistry || buildActionLocationRegistry({ interactionSpots: MVP_VERTICAL_SLICE_INTERACTION_SPOTS });
  const resolvedContextMenu = contextMenuRegistry || buildContextMenuActionRegistry({ catalogRegistry: resolvedCatalog });

  const assets = MVP_VERTICAL_SLICE_ASSETS.map(asset => {
    const catalogEntry = resolvedCatalog.get(asset.id) || resolvedCatalog.get(asset.objectCatalogId);
    const definition = getObjectCatalogExample(asset.objectCatalogId);
    const profile = resolvedActionLocations.get(asset.id) || resolvedActionLocations.get(asset.objectCatalogId);
    const menuActions = resolvedContextMenu.list({ catalogId: asset.id });
    const actionIds = asArray(definition?.apiActions).map(action => action.id);
    const spotIds = asArray(profile?.locations).map(location => location.id);
    return freezeDeep({
      ...asset,
      label: catalogEntry?.label || definition?.name || asset.id,
      category: catalogEntry?.category || definition?.category || null,
      tags: Object.freeze([...(catalogEntry?.tags || definition?.tags || [])]),
      checks: Object.freeze({
        catalogTaxonomy: Boolean(catalogEntry && definition),
        actionLocationRegistry: asset.requiredSpotIds.every(id => spotIds.includes(id)),
        worldActionsApi: asset.requiredActionIds.some(id => actionIds.includes(id)),
        rightClickAssignAgent: menuActions.length > 0,
        simpleAutonomyRouting: Boolean(profile?.locations?.length),
      }),
      actionIds: Object.freeze(actionIds),
      spotIds: Object.freeze(spotIds),
      contextActionIds: Object.freeze(menuActions.map(action => action.id)),
    });
  });

  const routesByNeed = Object.freeze(Object.fromEntries(Object.keys(NEED_TO_ACTION).map(need => {
    const asset = assets.find(candidate => actionMatchesNeed(candidate, getObjectCatalogExample(candidate.objectCatalogId), need));
    if (!asset) return [need, null];
    const profile = resolvedActionLocations.get(asset.id);
    const actionId = firstRequiredActionForNeed(asset, getObjectCatalogExample(asset.objectCatalogId), need);
    const location = findLocationForAction(profile, actionId, asset.requiredSpotIds);
    return [need, freezeDeep({ assetId: asset.id, objectCatalogId: asset.objectCatalogId, actionId, actionLocationId: location?.id || asset.requiredSpotIds[0] })];
  })));

  return freezeDeep({
    version: MVP_VERTICAL_SLICE_VERSION,
    contract: MVP_VERTICAL_SLICE_CONTRACT,
    rules: MVP_VERTICAL_SLICE_RULES,
    assets: Object.freeze(assets),
    routesByNeed,
    api: Object.freeze({
      worldActionEndpoint: 'POST /api/world-actions (future server adapter); current client queues validated world-action payloads',
      rightClickSurface: 'main3d.js context menu -> __VWAgentLifeMvpVerticalSlice.planRightClickAssignment()',
      autonomySurface: 'main3d.js simple autonomy -> __VWAgentLifeMvpVerticalSlice.planAutonomyRoute()',
    }),
    getAsset(id) {
      const normalized = normalizeObjectCatalogId(id) || id;
      return assets.find(asset => asset.id === normalized || asset.objectCatalogId === normalized || asset.objectCatalogId === id) || null;
    },
    planAutonomyRoute({ agentId = 'agent-unassigned', need = 'rest', targetInstanceId = null } = {}) {
      const route = routesByNeed[need] || null;
      if (!route) return null;
      return freezeDeep({
        agentId,
        source: 'agent-autonomy',
        ...route,
        objectInstanceId: targetInstanceId || `${route.assetId}-candidate`,
        routeHandoff: 'resolvePlacedActionLocations() -> main3d.setAgentTarget()',
      });
    },
    planRightClickAssignment({ agentId = 'agent-unassigned', assetId = 'parkBench', objectInstanceId = null, actionId = null, now = null } = {}) {
      const asset = this.getAsset(assetId);
      if (!asset) return null;
      const definition = getObjectCatalogExample(asset.objectCatalogId);
      const selectedActionId = actionId || asset.requiredActionIds[0];
      const profile = resolvedActionLocations.get(asset.id);
      const location = findLocationForAction(profile, selectedActionId, asset.requiredSpotIds);
      const timestamp = now || new Date(0).toISOString();
      const payload = freezeDeep({
        id: `mvp-${asset.id}-${agentId}-${location?.id || 'spot'}`.replace(/[^a-zA-Z0-9_-]+/g, '-'),
        actionType: selectedActionId,
        agentId,
        source: { kind: 'user', requestedBy: agentId, requestId: 'right-click-assign-agent' },
        status: 'requested',
        target: { kind: 'object-instance', objectInstanceId: objectInstanceId || `${asset.id}-candidate`, catalogId: asset.objectCatalogId, interactionSpotId: location?.id || asset.requiredSpotIds[0] },
        capabilityTag: asArray(definition?.apiActions).find(action => action.id === selectedActionId)?.primaryTag || asArray(definition?.tags)[0] || 'life.rest',
        priority: 'normal',
        permission: { level: 'public', checked: false, deniedReason: null },
        timing: { createdAt: timestamp, updatedAt: timestamp, requestedAt: timestamp, timeoutMs: 120000 },
        lifecycle: { previousStatus: null, allowedNext: Object.freeze(['created', 'cancelled', 'failed', 'expired']), transitionLog: Object.freeze([{ from: null, to: 'requested', at: timestamp, by: 'right-click', reason: 'assign-agent' }]), terminalReason: null },
        reservation: { status: 'held', actionId: selectedActionId, agentId, objectInstanceId: objectInstanceId || `${asset.id}-candidate`, spotId: location?.id || asset.requiredSpotIds[0] },
        route: { state: 'requested', target: { actionLocationId: location?.id || asset.requiredSpotIds[0] }, waypoints: Object.freeze([]) },
        params: { sourceSurface: 'context-menu', mvpSlice: MVP_VERTICAL_SLICE_VERSION },
        runtimeAdapters: { sources: Object.freeze(['main3d.ACTION_SPOTS', 'main3d.getFurnitureActionSpot()', 'main3d.setAgentTarget()']), routeHandoff: 'main3d.setAgentTarget()' },
      });
      const validation = validateWorldAction(payload);
      return freezeDeep({ payload, validation, enabled: validation.valid });
    },
  });
}

export function validateMvpVerticalSlice(slice) {
  const errors = [];
  if (!slice || slice.version !== MVP_VERTICAL_SLICE_VERSION) errors.push('slice.version must match MVP_VERTICAL_SLICE_VERSION');
  if (!Array.isArray(slice?.assets) || slice.assets.length !== MVP_VERTICAL_SLICE_ASSETS.length) errors.push('slice.assets must include every MVP asset');
  for (const asset of slice?.assets || []) {
    for (const [key, passed] of Object.entries(asset.checks || {})) {
      if (!passed) errors.push(`${asset.id}.${key} is not wired`);
    }
  }
  for (const need of Object.keys(NEED_TO_ACTION)) {
    const route = slice?.routesByNeed?.[need];
    if (!route?.assetId || !route?.actionId || !route?.actionLocationId) errors.push(`routesByNeed.${need} must include assetId, actionId, and actionLocationId`);
  }
  const rightClickPlan = slice?.planRightClickAssignment?.({ agentId: 'agent-reviewer', assetId: 'parkBench', objectInstanceId: 'review-park-bench-1' });
  if (!rightClickPlan?.enabled) errors.push(`right-click assignment payload must validate: ${rightClickPlan?.validation?.errors?.join('; ') || 'missing payload'}`);
  const autonomyPlan = slice?.planAutonomyRoute?.({ agentId: 'agent-reviewer', need: 'food', targetInstanceId: 'review-food-truck-1' });
  if (!autonomyPlan?.actionLocationId) errors.push('simple autonomy food route must resolve an action location');
  return freezeDeep({ ok: errors.length === 0, errors });
}

export const DEFAULT_MVP_VERTICAL_SLICE = buildMvpVerticalSlice();

const defaultValidation = validateMvpVerticalSlice(DEFAULT_MVP_VERTICAL_SLICE);
if (!defaultValidation.ok) {
  throw new Error(`Invalid MVP vertical slice: ${defaultValidation.errors.join('; ')}`);
}
