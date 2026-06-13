/**
 * Agent Life context-menu / UI action registry.
 *
 * Phase 0.5 technical spine for object-scoped menu actions. It adapts
 * functional object catalog uiActions/apiActions into one contract for labels,
 * permissions, world-action payload templates, and disabled/unavailable states.
 * Importing this module must not open menus, enqueue actions, reserve objects,
 * mutate world state, or call external APIs.
 */
import {
  CAPABILITY_TAG_DEFINITIONS,
  CAPABILITY_TAG_GROUPS,
  normalizeCapabilityTag,
} from './agent-life-capability-tags.mjs';
import {
  getObjectCatalogExample,
  normalizeObjectCatalogId,
  OBJECT_ACTION_PERMISSION_LEVELS,
} from './agent-life-object-catalog-schema.mjs';
import {
  buildCatalogRegistry,
} from './agent-life-catalog-registry.mjs';
import {
  checkPermission,
  normalizePermissionPolicy,
  validatePermissionPolicy,
} from './agent-life-permission-model.mjs';
import {
  getWorldActionAllowedNextStates,
  validateWorldAction,
} from './agent-life-world-action-schema.mjs';

export const CONTEXT_MENU_ACTION_REGISTRY_API_VERSION = 'agent-life-context-menu-action-registry/v1';

export const CONTEXT_MENU_TARGET_KINDS = Object.freeze(['object-instance', 'building', 'agent', 'world-point']);
export const CONTEXT_MENU_ACTION_SURFACES = Object.freeze(['context-menu', 'object-card', 'radial-menu', 'keyboard-shortcut']);
export const CONTEXT_MENU_ACTION_STATES = Object.freeze(['available', 'disabled', 'hidden', 'unavailable']);
export const CONTEXT_MENU_DISABLED_REASONS = Object.freeze([
  'permission_denied',
  'target_missing',
  'target_disabled',
  'object_reserved',
  'missing_world_action',
  'missing_interaction_spot',
  'agent_unavailable',
  'unavailable_in_context',
]);

export const CONTEXT_MENU_ACTION_REGISTRY_CONTRACT = Object.freeze([
  Object.freeze({ key: 'id', required: true, meaning: 'Stable UI action id scoped by catalog entry; used by context menus, object cards, hotkeys, and logs without embedding catalog definitions.' }),
  Object.freeze({ key: 'label', required: true, meaning: 'Human-readable menu label copied from object catalog uiActions and safe for context menu display.' }),
  Object.freeze({ key: 'surface', required: true, meaning: 'UI surface that can expose the action; context-menu is the canonical Phase 0.5 surface.' }),
  Object.freeze({ key: 'target', required: true, meaning: 'Target metadata: target kind, runtime catalog id, object catalog id, and optional interaction spot id.' }),
  Object.freeze({ key: 'permission', required: true, meaning: 'Normalized world/cosmetic permission policy evaluated before the menu marks an action available.' }),
  Object.freeze({ key: 'worldAction', required: true, meaning: 'World-action payload template containing actionType, capabilityTag, priority, target kind, and params for queue construction.' }),
  Object.freeze({ key: 'availability', required: true, meaning: 'Declarative disabled/unavailable rules: target required, reservation requirement, permission requirement, and missing adapter behavior.' }),
  Object.freeze({ key: 'runtimeAdapters', required: true, meaning: 'Current source paths that produced the action, including catalog uiActions/apiActions and future main3d context menu adapters.' }),
]);

export const CONTEXT_MENU_ACTION_REGISTRY_RULES = Object.freeze([
  'Context-menu actions are metadata only: importing the registry must not open menus, enqueue world actions, reserve objects, move agents, mutate placed furniture, or persist state.',
  'Functional object actions adapt existing object catalog uiActions and apiActions instead of creating a second action catalog.',
  'Every available menu action resolves to a world-action payload template with actionType, target references, capabilityTag, permission, and params; it does not embed object definitions.',
  'Disabled and unavailable states are explicit. Permission denial, disabled targets, reservations, missing world-action adapters, missing interaction spots, and unavailable agents each have stable reason codes.',
  'Permissions are world/cosmetic checks only and must never grant real OpenClaw/tool/file/API/admin/XP/credit authority.',
  'Current main3d context-menu code may keep its building/agent menu actions; object action rows should be derived from this registry and capability tags rather than hard-coded template names.',
]);

export const CONTEXT_MENU_ACTION_EXAMPLES = Object.freeze([
  Object.freeze({ catalogId: 'bed', objectInstanceId: 'object-instance-bed-1', uiActionId: 'sleep', subject: Object.freeze({ agentId: 'agent-1', roles: Object.freeze(['participant']) }) }),
  Object.freeze({ catalogId: 'barberChair', objectInstanceId: 'object-instance-barber-chair-1', uiActionIds: Object.freeze(['open-hair-editor', 'open-appearance-editor']), capabilityTags: Object.freeze(['appearance.customize']) }),
  Object.freeze({ catalogId: 'whiteboard', objectInstanceId: 'object-instance-whiteboard-1', uiActionIds: Object.freeze(['planning-session', 'teaching-session']), capabilityTags: Object.freeze(['planning.brainstorm', 'training.classroom']) }),
  Object.freeze({ catalogId: 'clinicBed', objectInstanceId: 'object-instance-clinic-bed-1', uiActionIds: Object.freeze(['review-agent-docs', 'repair-restore-agent-state']), subject: Object.freeze({ agentId: 'agent-medic', roles: Object.freeze(['medical-staff']) }), assignedRoles: Object.freeze(['medical-staff']), capabilityTags: Object.freeze(['life.medical', 'maintenance.repair']) }),
  Object.freeze({ catalogId: 'coffeeMachine', objectInstanceId: 'object-instance-coffee-machine-1', uiActionId: 'get-drink-coffee', subject: Object.freeze({ agentId: 'agent-barista', roles: Object.freeze(['participant']) }) }),
]);

const FALLBACK_CAPABILITY_PRESENTATION = Object.freeze({ groupId: 'unknown', groupLabel: 'Action', groupIcon: '✨', label: 'Use object', icon: '✨' });
const CAPABILITY_PRESENTATION_OVERRIDES = Object.freeze({
  'appearance.customize': Object.freeze({ label: 'Appearance', icon: '✨' }),
  'appearance.preview': Object.freeze({ label: 'Preview', icon: '🪞' }),
  'appearance.display': Object.freeze({ label: 'Browse Display', icon: '🛍️' }),
  'appearance.salon': Object.freeze({ label: 'Salon Service', icon: '💈' }),
  'planning.brainstorm': Object.freeze({ label: 'Planning', icon: '🧠' }),
  'planning.review': Object.freeze({ label: 'Review', icon: '📋' }),
  'planning.notice': Object.freeze({ label: 'Notice', icon: '📌' }),
  'training.classroom': Object.freeze({ label: 'Teaching', icon: '🎓' }),
  'training.coach': Object.freeze({ label: 'Coaching', icon: '🧑‍🏫' }),
  'life.medical': Object.freeze({ label: 'Agent Docs', icon: '🩺' }),
  'life.rest': Object.freeze({ label: 'Rest / Recover', icon: '💚' }),
  'maintenance.repair': Object.freeze({ label: 'Maintenance Review', icon: '🛠️' }),
  'maintenance.diagnostics': Object.freeze({ label: 'Diagnostics', icon: '🧪' }),
  'maintenance.restock': Object.freeze({ label: 'Restock', icon: '📦' }),
});

function titleFromCapabilityTag(tag) {
  return asString(tag).split('.').filter(Boolean).map(part => `${part.charAt(0).toUpperCase()}${part.slice(1).replace(/([A-Z])/g, ' $1')}`).join(' / ') || FALLBACK_CAPABILITY_PRESENTATION.label;
}

export function getContextMenuCapabilityPresentation(tag) {
  const capabilityTag = normalizeCapabilityTag(tag);
  if (!capabilityTag) return FALLBACK_CAPABILITY_PRESENTATION;
  const definition = CAPABILITY_TAG_DEFINITIONS[capabilityTag] || null;
  const group = CAPABILITY_TAG_GROUPS.find(item => item.id === definition?.group) || null;
  const override = CAPABILITY_PRESENTATION_OVERRIDES[capabilityTag] || {};
  return freezeDeep({
    capabilityTag,
    groupId: group?.id || definition?.group || 'unknown',
    groupLabel: group?.label || FALLBACK_CAPABILITY_PRESENTATION.groupLabel,
    groupIcon: group?.icon || FALLBACK_CAPABILITY_PRESENTATION.groupIcon,
    label: override.label || titleFromCapabilityTag(capabilityTag),
    icon: override.icon || group?.icon || FALLBACK_CAPABILITY_PRESENTATION.icon,
  });
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.map(item => asString(item)).filter(Boolean))]);
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stableId(value, fallback = 'action') {
  return asString(value).replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function catalogDefinitionForEntry(entry) {
  return getObjectCatalogExample(entry?.objectCatalogId) || getObjectCatalogExample(entry?.id) || null;
}

function findApiAction(uiAction, apiActions = []) {
  const uiId = asString(uiAction?.id).toLowerCase();
  const genericParts = new Set(['agent', 'docs', 'state', 'object', 'action']);
  const uiIdParts = uiId.split(/[-_.]+/).filter(part => part && !genericParts.has(part));
  const byExactMeaning = apiActions.find(action => {
    const apiId = asString(action.id).toLowerCase().replace(/[^a-z0-9]+/g, '');
    return uiIdParts.some(part => part.length >= 4 && apiId.endsWith(part.toLowerCase()));
  });
  if (byExactMeaning) return byExactMeaning;
  const byId = apiActions.find(action => {
    const apiId = asString(action.id).toLowerCase();
    if (!uiId || !apiId) return false;
    if (apiId.includes(uiId) || uiId.includes(apiId)) return true;
    return uiIdParts.some(part => part.length >= 4 && apiId.includes(part));
  });
  if (byId) return byId;
  const primaryTag = normalizeCapabilityTag(uiAction?.primaryTag);
  const byTag = apiActions.find(action => primaryTag && normalizeCapabilityTag(action.primaryTag) === primaryTag);
  return byTag || apiActions[0] || null;
}

function firstSpotForAction(definition, apiAction, uiAction) {
  const actionId = apiAction?.id || uiAction?.id;
  const primaryTag = normalizeCapabilityTag(apiAction?.primaryTag || uiAction?.primaryTag);
  return (definition?.interactionSpots || []).find(spot => spot.action === actionId)
    || (definition?.interactionSpots || []).find(spot => primaryTag && normalizeCapabilityTag(spot.action) === primaryTag)
    || (definition?.interactionSpots || [])[0]
    || null;
}

function normalizeActionEntry({ catalogEntry, definition, uiAction, apiAction, index }) {
  if (!catalogEntry || !definition || !uiAction || !apiAction) return null;
  const capabilityTag = normalizeCapabilityTag(apiAction.primaryTag || uiAction.primaryTag || definition.tags?.[0]);
  const permissionLevel = uiAction.permission || apiAction.permission || 'public';
  const spot = firstSpotForAction(definition, apiAction, uiAction);
  const permission = normalizePermissionPolicy({
    surface: 'action',
    level: OBJECT_ACTION_PERMISSION_LEVELS.includes(permissionLevel) ? permissionLevel : 'public',
    source: 'agent-life-object-catalog-schema.mjs#uiActions.permission',
  });
  const presentation = getContextMenuCapabilityPresentation(capabilityTag);
  const id = `${catalogEntry.id}:${stableId(uiAction.id, `action-${index}`)}`;
  return freezeDeep({
    id,
    uiActionId: uiAction.id,
    apiActionId: apiAction.id,
    label: uiAction.label || presentation.label,
    description: apiAction.label,
    icon: presentation.icon,
    group: {
      id: presentation.groupId,
      label: presentation.groupLabel,
      icon: presentation.groupIcon,
    },
    capabilityLabel: presentation.label,
    surface: 'context-menu',
    order: index + 1,
    target: {
      kind: 'object-instance',
      catalogId: catalogEntry.id,
      objectCatalogId: definition.id,
      interactionSpotId: spot?.id || null,
    },
    permission,
    worldAction: {
      actionType: apiAction.id,
      capabilityTag,
      priority: 'normal',
      targetKind: 'object-instance',
      params: {
        uiActionId: uiAction.id,
        apiActionId: apiAction.id,
        sourceSurface: 'context-menu',
      },
    },
    availability: {
      requiresTarget: true,
      requiresPermission: true,
      requiresWorldAction: true,
      requiresInteractionSpot: Boolean(spot?.requiresReservation),
      requiresReservation: Boolean(spot?.requiresReservation),
      missingAdapterState: 'unavailable',
    },
    runtimeAdapters: {
      uiActionSource: 'agent-life-object-catalog-schema.mjs#uiActions',
      apiActionSource: 'agent-life-object-catalog-schema.mjs#apiActions',
      contextMenuConsumer: 'main3d.js#future functional-object context menu',
      worldActionConsumer: 'agent-life-world-action-schema.mjs',
    },
  });
}

function normalizeTarget(target = {}) {
  const raw = isRecord(target) ? target : {};
  const catalogId = normalizeObjectCatalogId(raw.catalogId || raw.objectCatalogId || raw.type || raw.furnitureType || raw.assetId) || raw.catalogId || raw.type || null;
  return freezeDeep({
    kind: raw.kind || 'object-instance',
    id: raw.id || raw.objectInstanceId || raw.instanceId || null,
    objectInstanceId: raw.objectInstanceId || raw.id || raw.instanceId || null,
    catalogId,
    objectCatalogId: raw.objectCatalogId || null,
    state: raw.state || null,
    status: raw.status || raw.state?.status || null,
    reservation: raw.reservation || null,
    reservations: Array.isArray(raw.reservations) ? raw.reservations : [],
    disabled: raw.disabled === true,
    assignedAgentIds: asStringArray(raw.assignedAgentIds || raw.permissions?.assignedAgentIds || []),
    assignedRoles: asStringArray(raw.assignedRoles || raw.permissions?.assignedRoles || []),
    ownerAgentId: raw.ownerAgentId || raw.permissions?.ownerAgentId || null,
  });
}

function reservationConflicts(action, target, subject = {}) {
  if (!action.availability.requiresReservation) return false;
  const subjectId = subject.agentId || subject.userId || subject.id || null;
  const reservations = [target.reservation, ...target.reservations].filter(Boolean);
  return reservations.some(reservation => {
    const status = reservation.status || reservation.state;
    if (!['held', 'active', 'queued'].includes(status)) return false;
    if (subjectId && reservation.agentId === subjectId) return false;
    if (reservation.actionId && reservation.actionId !== action.worldAction.actionType && reservation.actionId !== action.apiActionId) return true;
    return Boolean(reservation.agentId && reservation.agentId !== subjectId);
  });
}

function targetDisabled(target) {
  const status = asString(target.status).toLowerCase();
  return target.disabled || ['disabled', 'broken', 'offline', 'inactive', 'blocked'].includes(status);
}

function evaluateActionAvailability(action, { target = {}, subject = {}, context = {} } = {}) {
  const normalizedTarget = normalizeTarget(target);
  if (!normalizedTarget.objectInstanceId && action.availability.requiresTarget) {
    return freezeDeep({ state: 'unavailable', reason: 'target_missing', permission: null, enabled: false });
  }
  if (!action.worldAction?.actionType) {
    return freezeDeep({ state: 'unavailable', reason: 'missing_world_action', permission: null, enabled: false });
  }
  if (action.availability.requiresInteractionSpot && !action.target.interactionSpotId) {
    return freezeDeep({ state: 'unavailable', reason: 'missing_interaction_spot', permission: null, enabled: false });
  }
  if (context.agentUnavailable === true || context.agentAvailable === false) {
    return freezeDeep({ state: 'disabled', reason: 'agent_unavailable', permission: null, enabled: false });
  }
  if (targetDisabled(normalizedTarget)) {
    return freezeDeep({ state: 'disabled', reason: 'target_disabled', permission: null, enabled: false });
  }
  const permission = checkPermission(action.permission, subject, {
    assignedAgentIds: normalizedTarget.assignedAgentIds,
    assignedRoles: normalizedTarget.assignedRoles,
    ownerAgentId: normalizedTarget.ownerAgentId,
    ...(isRecord(context.permissionContext) ? context.permissionContext : {}),
  });
  if (!permission.allowed) {
    return freezeDeep({ state: 'disabled', reason: 'permission_denied', permission, enabled: false });
  }
  if (reservationConflicts(action, normalizedTarget, subject)) {
    return freezeDeep({ state: 'disabled', reason: 'object_reserved', permission, enabled: false });
  }
  return freezeDeep({ state: 'available', reason: null, permission, enabled: true });
}

export function makeContextMenuWorldActionPayload(action, { target = {}, subject = {}, source = {}, id = null, agentId = null, now = null, params = {} } = {}) {
  const normalizedTarget = normalizeTarget(target);
  const timestamp = now || new Date(0).toISOString();
  const sourceKind = source.kind || 'user';
  const requestedBy = source.requestedBy || subject.agentId || subject.userId || subject.id || null;
  return freezeDeep({
    id: id || `${stableId(action.id)}-${stableId(normalizedTarget.objectInstanceId || 'target')}`,
    actionType: action.worldAction.actionType,
    agentId: agentId || subject.agentId || subject.id || 'agent-unassigned',
    source: {
      kind: sourceKind,
      requestedBy,
      requestId: source.requestId || null,
    },
    status: 'requested',
    target: {
      kind: action.target.kind,
      objectInstanceId: normalizedTarget.objectInstanceId || 'object-instance-pending',
      catalogId: action.target.objectCatalogId || normalizedTarget.objectCatalogId || normalizedTarget.catalogId || action.target.catalogId,
      interactionSpotId: action.target.interactionSpotId || 'default',
    },
    capabilityTag: action.worldAction.capabilityTag,
    priority: action.worldAction.priority,
    permission: {
      level: action.permission.level,
      checked: false,
      checkReason: null,
      boundary: 'world-cosmetic-only',
    },
    timing: {
      createdAt: timestamp,
      updatedAt: timestamp,
      timeoutMs: 120000,
    },
    lifecycle: {
      previousStatus: null,
      allowedNext: getWorldActionAllowedNextStates('requested'),
      transitionLog: [],
      terminalReason: null,
      adapterNotes: ['created from context-menu action registry payload template'],
    },
    reservation: action.availability.requiresReservation ? {
      status: 'held',
      actionId: action.worldAction.actionType,
      agentId: agentId || subject.agentId || subject.id || 'agent-unassigned',
      spotId: action.target.interactionSpotId || 'default',
    } : undefined,
    params: {
      ...action.worldAction.params,
      ...params,
    },
    runtimeAdapters: {
      sourceRegistry: CONTEXT_MENU_ACTION_REGISTRY_API_VERSION,
      uiActionId: action.uiActionId,
      apiActionId: action.apiActionId,
      contextMenuConsumer: action.runtimeAdapters.contextMenuConsumer,
    },
  });
}

export function buildContextMenuActionRegistry({ catalogRegistry = null } = {}) {
  const resolvedCatalogRegistry = catalogRegistry || buildCatalogRegistry();
  const entries = [];
  for (const catalogEntry of resolvedCatalogRegistry.entries || []) {
    const definition = catalogDefinitionForEntry(catalogEntry);
    if (!definition) continue;
    const uiActions = Array.isArray(definition.uiActions) ? definition.uiActions : [];
    const apiActions = Array.isArray(definition.apiActions) ? definition.apiActions : [];
    uiActions.forEach((uiAction, index) => {
      const apiAction = findApiAction(uiAction, apiActions);
      const entry = normalizeActionEntry({ catalogEntry, definition, uiAction, apiAction, index });
      if (entry) entries.push(entry);
    });
  }

  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const byCatalogId = new Map();
  for (const entry of entries) {
    if (!byCatalogId.has(entry.target.catalogId)) byCatalogId.set(entry.target.catalogId, []);
    byCatalogId.get(entry.target.catalogId).push(entry);
  }

  return freezeDeep({
    version: CONTEXT_MENU_ACTION_REGISTRY_API_VERSION,
    entries: entries.sort((a, b) => a.target.catalogId.localeCompare(b.target.catalogId) || a.order - b.order || a.id.localeCompare(b.id)),
    get(id) {
      return byId.get(id) || null;
    },
    list({ catalogId = null, surface = null, permissionLevel = null } = {}) {
      const normalizedCatalogId = catalogId ? (normalizeObjectCatalogId(catalogId) || catalogId) : null;
      return entries.filter(entry => {
        if (normalizedCatalogId && entry.target.catalogId !== normalizedCatalogId && entry.target.objectCatalogId !== normalizedCatalogId) return false;
        if (surface && entry.surface !== surface) return false;
        if (permissionLevel && entry.permission.level !== permissionLevel) return false;
        return true;
      });
    },
    resolve({ target = {}, subject = {}, context = {} } = {}) {
      const normalizedTarget = normalizeTarget(target);
      const actions = byCatalogId.get(normalizedTarget.catalogId) || [];
      return freezeDeep(actions.map(action => {
        const availability = evaluateActionAvailability(action, { target: normalizedTarget, subject, context });
        return {
          ...action,
          availabilityState: availability,
          disabled: !availability.enabled,
          disabledReason: availability.reason,
          worldActionPayload: availability.enabled
            ? makeContextMenuWorldActionPayload(action, { target: normalizedTarget, subject, source: context.source || {}, agentId: context.agentId, now: context.now, params: context.params || {} })
            : null,
        };
      }));
    },
  });
}

export function resolveContextMenuActions(options = {}) {
  const registry = options.registry || buildContextMenuActionRegistry();
  return registry.resolve(options);
}

export function validateContextMenuActionRegistry(registry) {
  const errors = [];
  const warnings = [];
  if (!registry || registry.version !== CONTEXT_MENU_ACTION_REGISTRY_API_VERSION) errors.push('registry.version must match CONTEXT_MENU_ACTION_REGISTRY_API_VERSION');
  if (!Array.isArray(registry?.entries) || registry.entries.length === 0) errors.push('registry.entries must be a non-empty array');
  const ids = new Set();
  for (const entry of registry?.entries || []) {
    if (!entry.id || ids.has(entry.id)) errors.push(`duplicate or missing action id ${entry.id || '<missing>'}`);
    ids.add(entry.id);
    if (!entry.label) errors.push(`${entry.id} missing label`);
    if (!entry.icon || !entry.group?.label || !entry.capabilityLabel) errors.push(`${entry.id} missing capability presentation metadata`);
    if (!CONTEXT_MENU_ACTION_SURFACES.includes(entry.surface)) errors.push(`${entry.id} has invalid surface ${entry.surface}`);
    if (!CONTEXT_MENU_TARGET_KINDS.includes(entry.target?.kind)) errors.push(`${entry.id} has invalid target kind`);
    if (!entry.target?.catalogId || !entry.target?.objectCatalogId) errors.push(`${entry.id} missing target catalog metadata`);
    const permissionValidation = validatePermissionPolicy(entry.permission);
    if (!permissionValidation.valid) errors.push(`${entry.id} invalid permission: ${permissionValidation.errors.join('; ')}`);
    if (!entry.worldAction?.actionType) errors.push(`${entry.id} missing worldAction.actionType`);
    if (!normalizeCapabilityTag(entry.worldAction?.capabilityTag)) errors.push(`${entry.id} has unknown worldAction.capabilityTag ${entry.worldAction?.capabilityTag}`);
    if (!entry.availability?.requiresWorldAction) errors.push(`${entry.id} must require a world action adapter`);
    if (!entry.runtimeAdapters?.uiActionSource || !entry.runtimeAdapters?.apiActionSource) errors.push(`${entry.id} missing runtime adapter sources`);
    if (entry.target.interactionSpotId === null) warnings.push(`${entry.id} has no interaction spot; resolver may mark it unavailable when required`);
  }
  for (const state of CONTEXT_MENU_ACTION_STATES) {
    if (!['available', 'disabled', 'hidden', 'unavailable'].includes(state)) errors.push(`unexpected state ${state}`);
  }
  for (const reason of CONTEXT_MENU_DISABLED_REASONS) {
    if (!reason.includes('_')) errors.push(`disabled reason ${reason} must be snake_case`);
  }
  return freezeDeep({ ok: errors.length === 0, errors, warnings });
}

export const DEFAULT_CONTEXT_MENU_ACTION_REGISTRY = buildContextMenuActionRegistry();

for (const action of DEFAULT_CONTEXT_MENU_ACTION_REGISTRY.entries) {
  const validation = validatePermissionPolicy(action.permission);
  if (!validation.valid) throw new Error(`Invalid context-menu permission for ${action.id}: ${validation.errors.join('; ')}`);
}

const bedActions = resolveContextMenuActions({
  registry: DEFAULT_CONTEXT_MENU_ACTION_REGISTRY,
  target: { objectInstanceId: 'object-instance-bed-1', catalogId: 'bed' },
  subject: { agentId: 'agent-1', roles: ['participant'] },
});
const sleepAction = bedActions.find(action => action.uiActionId === 'sleep');
if (!sleepAction?.worldActionPayload || !validateWorldAction(sleepAction.worldActionPayload).valid) {
  throw new Error('Default context-menu registry must produce a valid sleep world-action payload');
}
