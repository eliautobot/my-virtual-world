/**
 * Agent Life world action schema and state machine.
 *
 * World actions describe a requested agent/object interaction from queueing
 * through routing, use, completion, and terminal failure/cancel states. This is
 * metadata/validation only for Phase 0: importing it must not enqueue actions,
 * move agents, reserve objects, mutate placed instances, or call APIs.
 */
import {
  normalizeCapabilityTag,
} from './agent-life-capability-tags.mjs';
import {
  OBJECT_ACTION_PERMISSION_LEVELS,
  OBJECT_CATALOG_EXAMPLES,
} from './agent-life-object-catalog-schema.mjs';
import {
  OBJECT_INSTANCE_EXAMPLES,
  OBJECT_INSTANCE_STATE_STATUSES,
  OBJECT_INSTANCE_RESERVATION_STATUSES,
} from './agent-life-object-instance-schema.mjs';

export const WORLD_ACTION_SCHEMA_VERSION = 'agent-life-world-action/v1';
export const WORLD_ACTION_EVENT_HOOKS_VERSION = 'agent-life-world-action-event-hooks/v1';

export const WORLD_ACTION_EVENT_NAMES = Object.freeze([
  'action-created',
  'object-reserved',
  'route-started',
  'arrived',
  'in-progress',
  'completed',
  'cancelled',
  'failed',
  'reservation-released',
]);

export const WORLD_ACTION_STATES = Object.freeze([
  'requested',
  'created',
  'reserved',
  'route_pending',
  'routing',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'failed',
  'expired',
]);

export const WORLD_ACTION_STATE_ALIASES = Object.freeze({
  queued: 'requested',
  arriving: 'arrived',
  in_use: 'in_progress',
  completing: 'in_progress',
  done: 'completed',
  blocked: 'failed',
  timed_out: 'expired',
});

export const WORLD_ACTION_ACTIVE_STATES = Object.freeze(['requested', 'created', 'reserved', 'route_pending', 'routing', 'arrived', 'in_progress']);
export const WORLD_ACTION_SUCCESS_STATES = Object.freeze(['completed']);
export const WORLD_ACTION_FAILURE_STATES = Object.freeze(['cancelled', 'failed', 'expired']);
export const WORLD_ACTION_TERMINAL_STATES = Object.freeze([...WORLD_ACTION_SUCCESS_STATES, ...WORLD_ACTION_FAILURE_STATES]);

export const WORLD_ACTION_TRANSITIONS = Object.freeze({
  requested: Object.freeze(['created', 'cancelled', 'failed', 'expired']),
  created: Object.freeze(['reserved', 'cancelled', 'failed', 'expired']),
  reserved: Object.freeze(['route_pending', 'cancelled', 'failed', 'expired']),
  route_pending: Object.freeze(['routing', 'cancelled', 'failed', 'expired']),
  routing: Object.freeze(['arrived', 'cancelled', 'failed', 'expired']),
  arrived: Object.freeze(['in_progress', 'cancelled', 'failed', 'expired']),
  in_progress: Object.freeze(['completed', 'cancelled', 'failed', 'expired']),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
  failed: Object.freeze([]),
  expired: Object.freeze([]),
});

export const WORLD_ACTION_TARGET_KINDS = Object.freeze(['object-instance', 'building', 'room', 'world-point', 'agent']);
export const WORLD_ACTION_SOURCE_KINDS = Object.freeze(['user', 'agent-autonomy', 'schedule', 'system', 'api']);
export const WORLD_ACTION_REQUEST_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);
export const WORLD_ACTION_FAILURE_REASONS = Object.freeze([
  'no_matching_capability',
  'target_missing',
  'target_disabled',
  'target_blocked',
  'permission_denied',
  'object_reserved',
  'route_unreachable',
  'agent_unavailable',
  'timed_out',
  'cancelled_by_user',
  'cancelled_by_system',
  'runtime_error',
]);

export const CURRENT_RUNTIME_ACTION_SOURCES = Object.freeze([
  'main3d.ACTION_SPOTS',
  'main3d.getFurnitureActionSpot()',
  'main3d.setAgentTarget()',
  'dynamic-interior-routing.js',
  'dynamic-exterior-routing.js',
  'server.py:/api/assignments',
  'server.py:world-meta.json',
]);

export const WORLD_ACTION_SCHEMA_FIELDS = Object.freeze([
  Object.freeze({ key: 'id', required: true, type: 'string', meaning: 'Stable world-action id used by UI, routing, persistence, lifecycle logs, and reservation links.' }),
  Object.freeze({ key: 'actionType', required: true, type: 'string', meaning: 'Canonical API/UI action id such as appearance.editHair or life.medicalExam; matches catalog apiActions/interaction spots when object-scoped.' }),
  Object.freeze({ key: 'agentId', required: true, type: 'string', meaning: 'Agent that should perform or receive the action. This does not alter current live status polling by import side effect.' }),
  Object.freeze({ key: 'source', required: true, type: 'object', meaning: 'Who/what requested the action: user, agent autonomy, schedule, system, or API, plus an optional request id.' }),
  Object.freeze({ key: 'status', required: true, type: 'string', meaning: 'Single authoritative lifecycle state from requested/created/reserved/route_pending/routing/arrived/in_progress/completed or terminal failure states.' }),
  Object.freeze({ key: 'target', required: true, type: 'object', meaning: 'Object instance, building, room, world point, or agent target. Object targets reference catalogId, objectInstanceId, and interactionSpotId without embedding definitions.' }),
  Object.freeze({ key: 'capabilityTag', required: true, type: 'string', meaning: 'Canonical Agent Life capability tag that lets later planners match actions to objects/buildings without free-form behavior labels.' }),
  Object.freeze({ key: 'priority', required: true, type: 'string', meaning: 'Queue priority metadata only; Phase 0 does not implement scheduling or preemption.' }),
  Object.freeze({ key: 'permission', required: true, type: 'object', meaning: 'World permission metadata using Task 4 levels. It does not grant real file/tool/admin/OpenClaw authority.' }),
  Object.freeze({ key: 'timing', required: true, type: 'object', meaning: 'Created/updated timestamps plus optional timeout, started, arrived, completed, and terminal timestamps for persistence/API audit.' }),
  Object.freeze({ key: 'lifecycle', required: true, type: 'object', meaning: 'State machine bookkeeping: previousStatus, allowedNext, transitionLog, terminalReason, and adapter notes.' }),
  Object.freeze({ key: 'reservation', required: false, type: 'object', meaning: 'Optional object reservation link compatible with Task 5 reservation status/actionId/agentId/spotId fields; persisted records keep reservation.id for cleanup/release correlation.' }),
  Object.freeze({ key: 'route', required: false, type: 'object', meaning: 'Optional movement handoff details for later routing endpoints; persisted records keep route.id/routeId while current main3d routing remains authoritative until wired.' }),
  Object.freeze({ key: 'params', required: false, type: 'object', meaning: 'Action-specific payload for UI/API work. Validators only require that it stays an object when present.' }),
  Object.freeze({ key: 'result', required: false, type: 'object', meaning: 'Terminal or partial execution result summary kept with history records without embedding object/status copies.' }),
  Object.freeze({ key: 'events', required: false, type: 'array', meaning: 'Additive UI/polling hooks such as action-created, object-reserved, route-started, arrived, in-progress, completed, cancelled, failed, and reservation-released.' }),
  Object.freeze({ key: 'failureReason', required: false, type: 'string', meaning: 'Canonical terminal failure reason for cancelled/failed/expired records, separate from human-facing result text.' }),
  Object.freeze({ key: 'audit', required: false, type: 'object', meaning: 'Persistence/audit metadata such as createdBy, updatedBy, write source, schema version, and migration notes.' }),
  Object.freeze({ key: 'runtimeAdapters', required: false, type: 'object', meaning: 'Optional additive migration hints to ACTION_SPOTS, setAgentTarget, dynamic routing, and future server persistence.' }),
]);

export const WORLD_ACTION_VALIDATION_EXPECTATIONS = Object.freeze([
  'World actions use one canonical state machine: requested -> created -> reserved -> route_pending -> routing -> arrived -> in_progress -> completed, with cancelled/failed/expired terminal exits.',
  'Terminal states are immutable in the transition map. Later API/UI/routing code should call isWorldActionTransitionAllowed() before changing status.',
  'Object-scoped actions reference objectInstanceId/catalogId/interactionSpotId and optional reservation ids; they must not embed catalog or instance definitions.',
  'Capability tags normalize through the Phase 0 Task 2 vocabulary so action planning does not rely on free-form labels.',
  'Permission metadata reuses Task 4 levels and remains world/cosmetic authority only; it does not grant real tool, file, API, admin, XP, or credit authority.',
  'Route metadata documents handoff targets for main3d setAgentTarget and dynamic routing, but this schema does not replace current movement/routing systems.',
  'runtimeAdapters document current sources such as ACTION_SPOTS, getFurnitureActionSpot, setAgentTarget, dynamic routing, and world-meta persistence without mutating them.',
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

function assertString(value, path, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${path} must be a non-empty string`);
}

function assertOptionalString(value, path, errors) {
  if (value !== undefined && value !== null && (typeof value !== 'string' || !value.trim())) errors.push(`${path} must be a non-empty string or null when present`);
}

function assertIsoString(value, path, errors, { optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return;
  if (typeof value !== 'string' || !value.trim()) errors.push(`${path} must be an ISO timestamp string`);
}

function assertNonNegativeNumber(value, path, errors, { optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) errors.push(`${path} must be a finite number >= 0`);
}

function assertArray(value, path, errors, { optional = false } = {}) {
  if ((value === undefined || value === null) && optional) return [];
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value;
}

function knownCatalogIds() {
  return new Set(OBJECT_CATALOG_EXAMPLES.map(object => object.id));
}

function knownObjectInstanceIds() {
  return new Set(OBJECT_INSTANCE_EXAMPLES.map(instance => instance.id));
}

export function isWorldActionTerminalState(status) {
  return WORLD_ACTION_TERMINAL_STATES.includes(status);
}

export function getWorldActionAllowedNextStates(status) {
  return Object.freeze([...(WORLD_ACTION_TRANSITIONS[status] || [])]);
}

export function isWorldActionTransitionAllowed(fromStatus, toStatus) {
  return Boolean(WORLD_ACTION_TRANSITIONS[fromStatus]?.includes(toStatus));
}

export function getWorldActionExample(id) {
  return WORLD_ACTION_EXAMPLES.find(action => action.id === id) || null;
}

export function validateWorldAction(action) {
  const errors = [];
  const warnings = [];

  if (!isRecord(action)) {
    return Object.freeze({ valid: false, errors: Object.freeze(['world action must be an object']), warnings: Object.freeze([]) });
  }

  if (!isStableId(action.id)) errors.push('id must be a stable id using letters, numbers, hyphens, or underscores');
  if (!isActionId(action.actionType)) errors.push('actionType must be a stable action id');
  assertString(action.agentId, 'agentId', errors);
  if (!WORLD_ACTION_STATES.includes(action.status)) errors.push(`status must be one of ${WORLD_ACTION_STATES.join(', ')}`);
  if (!WORLD_ACTION_REQUEST_PRIORITIES.includes(action.priority)) errors.push(`priority must be one of ${WORLD_ACTION_REQUEST_PRIORITIES.join(', ')}`);

  const normalizedTag = normalizeCapabilityTag(action.capabilityTag);
  if (!normalizedTag) errors.push(`capabilityTag ${action.capabilityTag} must be a known Agent Life capability tag`);

  validateSource(action.source, errors);
  validateTarget(action.target, errors, warnings);
  validatePermission(action.permission, errors);
  validateTiming(action.timing, errors);
  validateLifecycle(action.lifecycle, action.status, errors);
  validateReservation(action.reservation, action, errors);
  validateRoute(action.route, errors);
  validateResultAndAudit(action, errors);
  validateWorldActionEvents(action.events, action, errors);
  validateRuntimeAdapters(action.runtimeAdapters, errors);
  if (action.params !== undefined && !isRecord(action.params)) errors.push('params must be an object when present');

  if (action.catalogDefinition !== undefined || action.objectInstance !== undefined) {
    errors.push('world actions must reference catalog/object instance ids only; do not embed definitions');
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    normalizedCapabilityTag: normalizedTag || null,
  });
}

function validateSource(source, errors) {
  if (!isRecord(source)) {
    errors.push('source must be an object');
    return;
  }
  if (!WORLD_ACTION_SOURCE_KINDS.includes(source.kind)) errors.push(`source.kind must be one of ${WORLD_ACTION_SOURCE_KINDS.join(', ')}`);
  assertOptionalString(source.requestedBy, 'source.requestedBy', errors);
  assertOptionalString(source.requestId, 'source.requestId', errors);
}

function validateTarget(target, errors, warnings) {
  if (!isRecord(target)) {
    errors.push('target must be an object');
    return;
  }
  if (!WORLD_ACTION_TARGET_KINDS.includes(target.kind)) errors.push(`target.kind must be one of ${WORLD_ACTION_TARGET_KINDS.join(', ')}`);
  if (target.kind === 'object-instance') {
    assertString(target.objectInstanceId, 'target.objectInstanceId', errors);
    assertString(target.catalogId, 'target.catalogId', errors);
    assertString(target.interactionSpotId, 'target.interactionSpotId', errors);
    if (isStableId(target.catalogId) && !knownCatalogIds().has(target.catalogId)) warnings.push(`target.catalogId ${target.catalogId} is not in Task 4 examples yet`);
    if (isStableId(target.objectInstanceId) && !knownObjectInstanceIds().has(target.objectInstanceId)) warnings.push(`target.objectInstanceId ${target.objectInstanceId} is not in Task 5 examples yet`);
  }
  if (target.kind === 'building' || target.kind === 'room') assertString(target.buildingId, 'target.buildingId', errors);
  if (target.kind === 'room') assertString(target.roomId, 'target.roomId', errors);
  if (target.roomId !== undefined && target.kind !== 'room') assertOptionalString(target.roomId, 'target.roomId', errors);
  if (target.kind === 'agent') assertString(target.targetAgentId, 'target.targetAgentId', errors);
  if (target.kind === 'world-point') {
    assertNonNegativeNumber(Math.abs(target.x ?? NaN), 'target.x', errors);
    assertNonNegativeNumber(Math.abs(target.z ?? NaN), 'target.z', errors);
  }
  if (target.floor !== undefined && (!Number.isInteger(target.floor) || target.floor < 1)) errors.push('target.floor must be an integer >= 1 when present');
}

function validatePermission(permission, errors) {
  if (!isRecord(permission)) {
    errors.push('permission must be an object');
    return;
  }
  if (!OBJECT_ACTION_PERMISSION_LEVELS.includes(permission.level)) errors.push(`permission.level must be one of ${OBJECT_ACTION_PERMISSION_LEVELS.join(', ')}`);
  if (typeof permission.checked !== 'boolean') errors.push('permission.checked must be a boolean');
  if (permission.deniedReason !== undefined && permission.deniedReason !== null && !WORLD_ACTION_FAILURE_REASONS.includes(permission.deniedReason)) {
    errors.push(`permission.deniedReason must be one of ${WORLD_ACTION_FAILURE_REASONS.join(', ')} or null when present`);
  }
}

function validateTiming(timing, errors) {
  if (!isRecord(timing)) {
    errors.push('timing must be an object');
    return;
  }
  assertIsoString(timing.createdAt, 'timing.createdAt', errors);
  assertIsoString(timing.updatedAt, 'timing.updatedAt', errors);
  assertIsoString(timing.queuedAt, 'timing.queuedAt', errors, { optional: true });
  assertIsoString(timing.startedAt, 'timing.startedAt', errors, { optional: true });
  assertIsoString(timing.arrivedAt, 'timing.arrivedAt', errors, { optional: true });
  assertIsoString(timing.completedAt, 'timing.completedAt', errors, { optional: true });
  assertIsoString(timing.terminalAt, 'timing.terminalAt', errors, { optional: true });
  assertNonNegativeNumber(timing.timeoutMs, 'timing.timeoutMs', errors, { optional: true });
  assertNonNegativeNumber(timing.estimatedUseMs, 'timing.estimatedUseMs', errors, { optional: true });
}

function validateLifecycle(lifecycle, status, errors) {
  if (!isRecord(lifecycle)) {
    errors.push('lifecycle must be an object');
    return;
  }
  if (lifecycle.previousStatus !== null && lifecycle.previousStatus !== undefined && !WORLD_ACTION_STATES.includes(lifecycle.previousStatus)) errors.push(`lifecycle.previousStatus must be one of ${WORLD_ACTION_STATES.join(', ')} or null`);
  const allowedNext = assertArray(lifecycle.allowedNext, 'lifecycle.allowedNext', errors);
  allowedNext.forEach((next, index) => {
    if (!WORLD_ACTION_STATES.includes(next)) errors.push(`lifecycle.allowedNext[${index}] must be a world action state`);
    if (status && !isWorldActionTransitionAllowed(status, next)) errors.push(`lifecycle.allowedNext[${index}] ${next} is not allowed from ${status}`);
  });
  const canonicalNext = getWorldActionAllowedNextStates(status || '');
  if (status && WORLD_ACTION_STATES.includes(status) && allowedNext.join('|') !== canonicalNext.join('|')) {
    errors.push(`lifecycle.allowedNext must match canonical transitions for ${status}: ${canonicalNext.join(', ') || '<none>'}`);
  }
  const log = assertArray(lifecycle.transitionLog, 'lifecycle.transitionLog', errors);
  log.forEach((entry, index) => validateTransitionLogEntry(entry, `lifecycle.transitionLog[${index}]`, errors));
  if (isWorldActionTerminalState(status) && !lifecycle.terminalReason) errors.push('terminal world actions require lifecycle.terminalReason');
  if (lifecycle.terminalReason !== undefined && lifecycle.terminalReason !== null && !WORLD_ACTION_FAILURE_REASONS.includes(lifecycle.terminalReason) && status !== 'completed') {
    errors.push(`lifecycle.terminalReason must be one of ${WORLD_ACTION_FAILURE_REASONS.join(', ')} or null`);
  }
}

function validateTransitionLogEntry(entry, path, errors) {
  if (!isRecord(entry)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (entry.from !== null && entry.from !== undefined && !WORLD_ACTION_STATES.includes(entry.from)) errors.push(`${path}.from must be a world action state or null`);
  if (!WORLD_ACTION_STATES.includes(entry.to)) errors.push(`${path}.to must be a world action state`);
  if (entry.from && entry.to && !isWorldActionTransitionAllowed(entry.from, entry.to)) errors.push(`${path} transition ${entry.from} -> ${entry.to} is not allowed`);
  assertIsoString(entry.at, `${path}.at`, errors);
  assertOptionalString(entry.by, `${path}.by`, errors);
  assertOptionalString(entry.actor, `${path}.actor`, errors);
  assertOptionalString(entry.source, `${path}.source`, errors);
  if (!entry.by && !entry.actor) errors.push(`${path}.actor or ${path}.by must record who/source made the transition`);
  assertOptionalString(entry.reason, `${path}.reason`, errors);
}

function validateReservation(reservation, action, errors) {
  if (reservation === undefined || reservation === null) return;
  if (!isRecord(reservation)) {
    errors.push('reservation must be an object when present');
    return;
  }
  if (!OBJECT_INSTANCE_RESERVATION_STATUSES.includes(reservation.status)) errors.push(`reservation.status must be one of ${OBJECT_INSTANCE_RESERVATION_STATUSES.join(', ')}`);
  assertOptionalString(reservation.id, 'reservation.id', errors);
  assertOptionalString(reservation.objectInstanceId, 'reservation.objectInstanceId', errors);
  assertOptionalString(reservation.spotId, 'reservation.spotId', errors);
  if (reservation.actionId !== undefined && reservation.actionId !== null && reservation.actionId !== action.actionType) errors.push('reservation.actionId must match actionType when present');
  if (reservation.agentId !== undefined && reservation.agentId !== null && reservation.agentId !== action.agentId) errors.push('reservation.agentId must match agentId when present');
}

function validateRoute(route, errors) {
  if (route === undefined || route === null) return;
  if (!isRecord(route)) {
    errors.push('route must be an object when present');
    return;
  }
  assertOptionalString(route.id, 'route.id', errors);
  assertOptionalString(route.routeId, 'route.routeId', errors);
  if (route.state !== undefined && !OBJECT_INSTANCE_STATE_STATUSES.includes(route.state) && !WORLD_ACTION_STATES.includes(route.state)) errors.push('route.state must be an object-instance or world-action state when present');
  if (route.target !== undefined && !isRecord(route.target)) errors.push('route.target must be an object when present');
  if (route.waypoints !== undefined) assertArray(route.waypoints, 'route.waypoints', errors, { optional: true });
}

function validateWorldActionEvents(events, action, errors) {
  if (events === undefined || events === null) return;
  const list = assertArray(events, 'events', errors, { optional: true });
  const seen = new Set();
  list.forEach((event, index) => {
    const path = `events[${index}]`;
    if (!isRecord(event)) {
      errors.push(`${path} must be an object`);
      return;
    }
    if (!WORLD_ACTION_EVENT_NAMES.includes(event.name)) errors.push(`${path}.name must be one of ${WORLD_ACTION_EVENT_NAMES.join(', ')}`);
    assertIsoString(event.at || event.timestamp, `${path}.at`, errors);
    assertOptionalString(event.id, `${path}.id`, errors);
    assertOptionalString(event.actionId, `${path}.actionId`, errors);
    assertOptionalString(event.agentId, `${path}.agentId`, errors);
    assertOptionalString(event.targetId, `${path}.targetId`, errors);
    if (event.actionId !== undefined && event.actionId !== null && event.actionId !== action.id) errors.push(`${path}.actionId must match action id`);
    if (event.agentId !== undefined && event.agentId !== null && event.agentId !== action.agentId) errors.push(`${path}.agentId must match action agentId`);
    if (event.status !== undefined && event.status !== null && !WORLD_ACTION_STATES.includes(event.status)) errors.push(`${path}.status must be a world action state`);
    if (event.result !== undefined && event.result !== null && !isRecord(event.result)) errors.push(`${path}.result must be an object or null`);
    if (event.error !== undefined && event.error !== null && !isRecord(event.error)) errors.push(`${path}.error must be an object or null`);
    const key = `${event.actionId || action.id}|${event.name}|${event.fromStatus || ''}|${event.toStatus || event.status || ''}`;
    if (seen.has(key)) errors.push(`${path} duplicates an event hook lifecycle key`);
    seen.add(key);
  });
}

function validateResultAndAudit(action, errors) {
  if (action.result !== undefined && !isRecord(action.result)) errors.push('result must be an object when present');
  if (action.audit !== undefined && !isRecord(action.audit)) errors.push('audit must be an object when present');
  if (action.failureReason !== undefined && action.failureReason !== null && !WORLD_ACTION_FAILURE_REASONS.includes(action.failureReason)) {
    errors.push(`failureReason must be one of ${WORLD_ACTION_FAILURE_REASONS.join(', ')} or null when present`);
  }
  if (['failed', 'expired'].includes(action.status) && !action.failureReason) {
    errors.push('failed and expired actions require failureReason');
  }
}

function validateRuntimeAdapters(runtimeAdapters, errors) {
  if (runtimeAdapters === undefined) return;
  if (!isRecord(runtimeAdapters)) {
    errors.push('runtimeAdapters must be an object when present');
    return;
  }
  const sources = assertArray(runtimeAdapters.sources || [], 'runtimeAdapters.sources', errors);
  sources.forEach((source, index) => {
    if (!CURRENT_RUNTIME_ACTION_SOURCES.includes(source)) errors.push(`runtimeAdapters.sources[${index}] must be one of ${CURRENT_RUNTIME_ACTION_SOURCES.join(', ')}`);
  });
  assertOptionalString(runtimeAdapters.persistencePath, 'runtimeAdapters.persistencePath', errors);
  assertOptionalString(runtimeAdapters.routeHandoff, 'runtimeAdapters.routeHandoff', errors);
}

function makeLifecycle(status, previousStatus = null, transitionLog = Object.freeze([]), terminalReason = null) {
  return Object.freeze({
    previousStatus,
    allowedNext: getWorldActionAllowedNextStates(status),
    transitionLog,
    terminalReason,
  });
}

export const WORLD_ACTION_EXAMPLES = Object.freeze([
  Object.freeze({
    id: 'action-salon-1-edit-hair-reserved',
    actionType: 'appearance.editHair',
    agentId: 'agent-customer',
    source: Object.freeze({ kind: 'user', requestedBy: 'owner', requestId: 'ui-action-open-hair-editor' }),
    status: 'reserved',
    target: Object.freeze({ kind: 'object-instance', objectInstanceId: 'salon-1-barber-chair-0', catalogId: 'barber-chair', interactionSpotId: 'seat', buildingId: 'salon-1', floor: 1 }),
    capabilityTag: 'appearance.customize',
    priority: 'normal',
    permission: Object.freeze({ level: 'public', checked: true, deniedReason: null }),
    timing: Object.freeze({ createdAt: '2026-04-28T00:00:00Z', updatedAt: '2026-04-28T00:00:00Z', requestedAt: '2026-04-28T00:00:00Z', reservedAt: '2026-04-28T00:00:00Z', timeoutMs: 300000, estimatedUseMs: 90000 }),
    lifecycle: makeLifecycle('reserved', 'created', Object.freeze([
      { from: null, to: 'requested', at: '2026-04-28T00:00:00Z', actor: 'api', source: 'user', reason: 'requested' },
      { from: 'requested', to: 'created', at: '2026-04-28T00:00:00Z', actor: 'server.py#create_world_action', source: 'api', reason: 'validated' },
      { from: 'created', to: 'reserved', at: '2026-04-28T00:00:00Z', actor: 'server.py#create_world_action', source: 'reservation', reason: 'object-reserved' },
    ]), null),
    reservation: Object.freeze({ status: 'held', id: 'res-salon-1-chair-0', actionId: 'appearance.editHair', agentId: 'agent-customer', objectInstanceId: 'salon-1-barber-chair-0', spotId: 'seat' }),
    route: Object.freeze({ id: 'route-salon-1-edit-hair', state: 'route_pending', target: Object.freeze({ apiX: 320, apiY: 240, floor: 1 }), waypoints: Object.freeze([]), setAgentTarget: true }),
    params: Object.freeze({ editor: 'hair' }),
    result: Object.freeze({ status: 'pending' }),
    audit: Object.freeze({ schemaVersion: WORLD_ACTION_SCHEMA_VERSION, stateMachineVersion: 'agent-life-world-action-lifecycle/v1', persistedBy: 'server.py:world-meta.json', createdBy: 'api' }),
    runtimeAdapters: Object.freeze({ sources: Object.freeze(['main3d.ACTION_SPOTS', 'main3d.getFurnitureActionSpot()', 'server.py:world-meta.json']), persistencePath: 'world-meta.json#agentLife.worldActions.active[0]', routeHandoff: 'POST /api/world-actions/{id}/transition route_pending -> routing -> main3d.setAgentTarget()' }),
  }),
  Object.freeze({
    id: 'action-clinic-1-medical-exam-in-progress',
    actionType: 'life.medicalExam',
    agentId: 'agent-patient',
    source: Object.freeze({ kind: 'agent-autonomy', requestedBy: 'agent-patient', requestId: 'needs-recovery-check' }),
    status: 'in_progress',
    target: Object.freeze({ kind: 'object-instance', objectInstanceId: 'clinic-1-bed-0', catalogId: 'clinic-bed', interactionSpotId: 'patient', buildingId: 'clinic-1', floor: 2 }),
    capabilityTag: 'life.medical',
    priority: 'high',
    permission: Object.freeze({ level: 'assigned-role', checked: true, deniedReason: null }),
    timing: Object.freeze({ createdAt: '2026-04-28T00:00:00Z', updatedAt: '2026-04-28T00:02:00Z', requestedAt: '2026-04-28T00:00:00Z', startedAt: '2026-04-28T00:00:30Z', arrivedAt: '2026-04-28T00:01:30Z', timeoutMs: 600000, estimatedUseMs: 180000 }),
    lifecycle: makeLifecycle('in_progress', 'arrived', Object.freeze([
      { from: null, to: 'requested', at: '2026-04-28T00:00:00Z', actor: 'system', source: 'agent-autonomy', reason: 'requested' },
      { from: 'requested', to: 'created', at: '2026-04-28T00:00:05Z', actor: 'server.py#create_world_action', source: 'api', reason: 'validated' },
      { from: 'created', to: 'reserved', at: '2026-04-28T00:00:10Z', actor: 'reservation', source: 'api', reason: 'object-reserved' },
      { from: 'reserved', to: 'route_pending', at: '2026-04-28T00:00:20Z', actor: 'routing', source: 'api', reason: 'handoff-pending' },
      { from: 'route_pending', to: 'routing', at: '2026-04-28T00:00:30Z', actor: 'routing', source: 'main3d.setAgentTarget', reason: 'route-started' },
      { from: 'routing', to: 'arrived', at: '2026-04-28T00:01:25Z', actor: 'routing', source: 'dynamic-interior-routing.js', reason: 'near-target' },
      { from: 'arrived', to: 'in_progress', at: '2026-04-28T00:01:30Z', actor: 'object-reservation', source: 'api', reason: 'spot-occupied' },
    ]), null),
    reservation: Object.freeze({ status: 'active', id: 'res-clinic-bed-0', actionId: 'life.medicalExam', agentId: 'agent-patient', objectInstanceId: 'clinic-1-bed-0', spotId: 'patient' }),
    route: Object.freeze({ id: 'route-clinic-1-medical-exam', state: 'in_progress', target: Object.freeze({ apiX: 410, apiY: 310, floor: 2 }), waypoints: Object.freeze([{ apiX: 390, apiY: 300, floor: 2 }]), setAgentTarget: true }),
    params: Object.freeze({ examKind: 'recovery' }),
    result: Object.freeze({ status: 'in_progress', arrived: true }),
    audit: Object.freeze({ schemaVersion: WORLD_ACTION_SCHEMA_VERSION, stateMachineVersion: 'agent-life-world-action-lifecycle/v1', persistedBy: 'server.py:world-meta.json', createdBy: 'agent-autonomy' }),
    runtimeAdapters: Object.freeze({ sources: Object.freeze(['main3d.setAgentTarget()', 'dynamic-interior-routing.js', 'server.py:world-meta.json']), persistencePath: 'world-meta.json#agentLife.worldActions.active[1]', routeHandoff: 'main3d.setAgentTarget() after Phase 2 move endpoint validation' }),
  }),
  Object.freeze({
    id: 'action-whiteboard-1-review-failed',
    actionType: 'planning.review',
    agentId: 'agent-planner',
    source: Object.freeze({ kind: 'api', requestedBy: 'planning-service', requestId: 'review-42' }),
    status: 'failed',
    target: Object.freeze({ kind: 'object-instance', objectInstanceId: 'planning-room-whiteboard-0', catalogId: 'whiteboard', interactionSpotId: 'presenter', buildingId: 'planning-room', floor: 1 }),
    capabilityTag: 'planning.review',
    priority: 'normal',
    permission: Object.freeze({ level: 'manager', checked: true, deniedReason: null }),
    timing: Object.freeze({ createdAt: '2026-04-28T00:00:00Z', updatedAt: '2026-04-28T00:00:05Z', requestedAt: '2026-04-28T00:00:00Z', terminalAt: '2026-04-28T00:00:05Z', timeoutMs: 300000 }),
    lifecycle: makeLifecycle('failed', 'created', Object.freeze([
      { from: null, to: 'requested', at: '2026-04-28T00:00:00Z', actor: 'api', source: 'api', reason: 'requested' },
      { from: 'requested', to: 'created', at: '2026-04-28T00:00:03Z', actor: 'server.py#create_world_action', source: 'api', reason: 'validated' },
      { from: 'created', to: 'failed', at: '2026-04-28T00:00:05Z', actor: 'reservation', source: 'api', reason: 'object_reserved' },
    ]), 'object_reserved'),
    reservation: Object.freeze({ status: 'released', id: 'res-whiteboard-0', actionId: 'planning.review', agentId: 'agent-planner', objectInstanceId: 'planning-room-whiteboard-0', spotId: 'presenter' }),
    route: Object.freeze({ id: 'route-whiteboard-1-review', state: 'failed', target: Object.freeze({ apiX: 500, apiY: 220, floor: 1 }), waypoints: Object.freeze([]) }),
    params: Object.freeze({ reviewId: 'review-42' }),
    result: Object.freeze({ status: 'failed', message: 'Object already reserved before routing.' }),
    failureReason: 'object_reserved',
    audit: Object.freeze({ schemaVersion: WORLD_ACTION_SCHEMA_VERSION, stateMachineVersion: 'agent-life-world-action-lifecycle/v1', persistedBy: 'server.py:world-meta.json', createdBy: 'api' }),
    runtimeAdapters: Object.freeze({ sources: Object.freeze(['main3d.ACTION_SPOTS', 'server.py:world-meta.json']), persistencePath: 'world-meta.json#agentLife.worldActions.history[0]', routeHandoff: 'none; failed before route start' }),
  }),
]);

for (const action of WORLD_ACTION_EXAMPLES) {
  const result = validateWorldAction(action);
  if (!result.valid) throw new Error(`Invalid world action example ${action?.id || '<unknown>'}: ${result.errors.join('; ')}`);
}
