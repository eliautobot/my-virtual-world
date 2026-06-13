/**
 * Agent Life Phase 0 verification fixtures.
 *
 * This module collects one minimal reusable fixture set spanning a building
 * template, catalog object, placed object instance, public world action, and
 * permission-gated world action. It is additive test data only: importing it
 * must not place furniture, enqueue actions, change permissions, mutate runtime state,
 * or replace current Virtual World systems.
 */
import {
  getBuildingTemplateExample,
  validateBuildingTemplate,
} from './agent-life-building-template-schema.mjs';
import {
  getObjectCatalogExample,
  validateObjectCatalogDefinition,
} from './agent-life-object-catalog-schema.mjs';
import {
  getObjectInstanceExample,
  validateObjectInstance,
} from './agent-life-object-instance-schema.mjs';
import {
  getWorldActionAllowedNextStates,
  validateWorldAction,
} from './agent-life-world-action-schema.mjs';
import {
  WORLD_PERMISSION_BOUNDARY,
  checkPermission,
  makePermissionAttachment,
  validatePermissionPolicy,
} from './agent-life-permission-model.mjs';

export const AGENT_LIFE_VERIFICATION_FIXTURES_VERSION = 'agent-life-verification-fixtures/v1';

export const VERIFICATION_FIXTURE_REUSE_DECISIONS = Object.freeze([
  Object.freeze({
    area: 'building template',
    decision: 'reuse',
    source: 'agent-life-building-template-schema.mjs#BUILDING_TEMPLATE_EXAMPLES.clinic',
    reason: 'Task 3 already defines a valid Clinic template with life.medical/life.rest tags and suggested clinic-bed actions; duplicating a parallel template would create drift.',
  }),
  Object.freeze({
    area: 'catalog object',
    decision: 'reuse',
    source: 'agent-life-object-catalog-schema.mjs#OBJECT_CATALOG_EXAMPLES.clinic-bed',
    reason: 'Task 4 already validates Clinic Bed against the catalog schema and keeps runtime migration hints separate from current furniture placement.',
  }),
  Object.freeze({
    area: 'object instance',
    decision: 'reuse',
    source: 'agent-life-object-instance-schema.mjs#OBJECT_INSTANCE_EXAMPLES.clinic-1-bed-0',
    reason: 'Task 5 already provides a placed Clinic Bed instance with building/floor/position, mutable state, reservation, permissions, and runtime adapter metadata.',
  }),
  Object.freeze({
    area: 'public action',
    decision: 'adapt',
    source: 'agent-life-world-action-schema.mjs state machine + clinic-bed apiActions.life.recoverAtClinicBed',
    reason: 'A small queued recovery action gives tests a public permission fixture without adding runtime behavior or touching main3d routing.',
  }),
  Object.freeze({
    area: 'permission-gated action',
    decision: 'reuse plus policy attachment',
    source: 'agent-life-world-action-schema.mjs#WORLD_ACTION_EXAMPLES.action-clinic-1-medical-exam-in-use + permission-model helpers',
    reason: 'Task 6 already includes an assigned-role medical exam action; Task 7 helpers can evaluate the gate without granting real authority.',
  }),
  Object.freeze({
    area: 'runtime behavior/data',
    decision: 'skip runtime mutation',
    source: 'main3d.js ACTION_SPOTS/getFurnitureActionSpot/setAgentTarget and existing building.interior.furniture[] remain authoritative',
    reason: 'Task 9 only needs reusable validation fixtures. Wiring objects/actions into live routing, persistence, or UI belongs to later phases.',
  }),
]);

const CLINIC_TEMPLATE = getBuildingTemplateExample('clinic');
const CLINIC_BED_OBJECT = getObjectCatalogExample('clinic-bed');
const CLINIC_BED_INSTANCE = getObjectInstanceExample('clinic-1-bed-0');

export const PUBLIC_RECOVERY_ACTION_FIXTURE = Object.freeze({
  id: 'action-clinic-1-rest-public-queued',
  actionType: 'life.recoverAtClinicBed',
  agentId: 'agent-visitor',
  source: Object.freeze({ kind: 'user', requestedBy: 'agent-visitor', requestId: 'fixture-public-recovery' }),
  status: 'requested',
  target: Object.freeze({ kind: 'object-instance', objectInstanceId: 'clinic-1-bed-0', catalogId: 'clinic-bed', interactionSpotId: 'patient', buildingId: 'clinic-1', floor: 2 }),
  capabilityTag: 'life.rest',
  priority: 'normal',
  permission: Object.freeze({ level: 'public', checked: true, deniedReason: null }),
  timing: Object.freeze({ createdAt: '2026-04-28T00:10:00Z', updatedAt: '2026-04-28T00:10:00Z', requestedAt: '2026-04-28T00:10:00Z', timeoutMs: 300000, estimatedUseMs: 120000 }),
  lifecycle: Object.freeze({
    previousStatus: null,
    allowedNext: getWorldActionAllowedNextStates('requested'),
    transitionLog: Object.freeze([{ from: null, to: 'requested', at: '2026-04-28T00:10:00Z', by: 'fixture', reason: 'created-for-validation' }]),
    terminalReason: null,
  }),
  reservation: Object.freeze({ status: 'held', id: 'res-fixture-public-recovery', actionId: 'life.recoverAtClinicBed', agentId: 'agent-visitor', objectInstanceId: 'clinic-1-bed-0', spotId: 'patient' }),
  route: Object.freeze({ state: 'requested', target: Object.freeze({ apiX: 410, apiY: 310, floor: 2 }), waypoints: Object.freeze([]) }),
  params: Object.freeze({ recoveryKind: 'short-rest' }),
  runtimeAdapters: Object.freeze({ sources: Object.freeze(['main3d.ACTION_SPOTS', 'main3d.getFurnitureActionSpot()', 'server.py:world-meta.json']), persistencePath: 'world-meta.json#agentLife.verificationFixtures.publicAction', routeHandoff: 'fixture only; future Phase 2 endpoint may hand off to main3d.setAgentTarget()' }),
});

export const PERMISSION_GATED_ACTION_FIXTURE = Object.freeze({
  id: 'action-clinic-1-medical-exam-in-use',
  actionType: 'life.medicalExam',
  agentId: 'agent-patient',
  source: Object.freeze({ kind: 'agent-autonomy', requestedBy: 'agent-patient', requestId: 'needs-recovery-check' }),
  status: 'in_progress',
  target: Object.freeze({ kind: 'object-instance', objectInstanceId: 'clinic-1-bed-0', catalogId: 'clinic-bed', interactionSpotId: 'patient', buildingId: 'clinic-1', floor: 2 }),
  capabilityTag: 'life.medical',
  priority: 'high',
  permission: Object.freeze({ level: 'assigned-role', checked: true, deniedReason: null }),
  timing: Object.freeze({ createdAt: '2026-04-28T00:00:00Z', updatedAt: '2026-04-28T00:02:00Z', requestedAt: '2026-04-28T00:00:00Z', startedAt: '2026-04-28T00:00:30Z', arrivedAt: '2026-04-28T00:01:30Z', timeoutMs: 600000, estimatedUseMs: 180000 }),
  lifecycle: Object.freeze({
    previousStatus: 'arrived',
    allowedNext: getWorldActionAllowedNextStates('in_progress'),
    transitionLog: Object.freeze([
      Object.freeze({ from: null, to: 'requested', at: '2026-04-28T00:00:00Z', by: 'system', reason: 'created' }),
      Object.freeze({ from: 'requested', to: 'created', at: '2026-04-28T00:00:05Z', by: 'api', reason: 'validated' }),
      Object.freeze({ from: 'created', to: 'reserved', at: '2026-04-28T00:00:20Z', by: 'reservation', reason: 'spot-held' }),
      Object.freeze({ from: 'reserved', to: 'route_pending', at: '2026-04-28T00:00:25Z', by: 'routing', reason: 'handoff-pending' }),
      Object.freeze({ from: 'route_pending', to: 'routing', at: '2026-04-28T00:00:30Z', by: 'routing', reason: 'route-started' }),
      Object.freeze({ from: 'routing', to: 'arrived', at: '2026-04-28T00:01:25Z', by: 'routing', reason: 'near-target' }),
      Object.freeze({ from: 'arrived', to: 'in_progress', at: '2026-04-28T00:01:30Z', by: 'object-reservation', reason: 'spot-occupied' }),
    ]),
    terminalReason: null,
  }),
  reservation: Object.freeze({ status: 'active', id: 'res-clinic-bed-0', actionId: 'life.medicalExam', agentId: 'agent-patient', objectInstanceId: 'clinic-1-bed-0', spotId: 'patient' }),
  route: Object.freeze({ state: 'in_progress', target: Object.freeze({ apiX: 410, apiY: 310, floor: 2 }), waypoints: Object.freeze([Object.freeze({ apiX: 390, apiY: 300, floor: 2 })]) }),
  params: Object.freeze({ examKind: 'recovery' }),
  runtimeAdapters: Object.freeze({ sources: Object.freeze(['main3d.setAgentTarget()', 'dynamic-interior-routing.js', 'server.py:world-meta.json']), persistencePath: 'world-meta.json#agentLife.verificationFixtures.permissionGatedAction', routeHandoff: 'fixture only; current setAgentTarget remains runtime authority' }),
});

export const PERMISSION_GATED_ACTION_POLICY_FIXTURE = makePermissionAttachment('action', 'assigned-role', {
  source: 'agent-life-world-action-schema.mjs#permission',
  assignedAgentIds: Object.freeze(['agent-patient']),
  assignedRoles: Object.freeze(['medical-staff']),
});

export const AGENT_LIFE_VERIFICATION_FIXTURES = Object.freeze({
  version: AGENT_LIFE_VERIFICATION_FIXTURES_VERSION,
  template: CLINIC_TEMPLATE,
  object: CLINIC_BED_OBJECT,
  objectInstance: CLINIC_BED_INSTANCE,
  action: PUBLIC_RECOVERY_ACTION_FIXTURE,
  permissionGatedAction: PERMISSION_GATED_ACTION_FIXTURE,
  permissionGatedActionPolicy: PERMISSION_GATED_ACTION_POLICY_FIXTURE,
  allowedSubject: Object.freeze({ agentId: 'agent-patient', roles: Object.freeze(['participant']) }),
  deniedSubject: Object.freeze({ agentId: 'agent-visitor', roles: Object.freeze(['participant']) }),
  reuseDecisions: VERIFICATION_FIXTURE_REUSE_DECISIONS,
});

function collectValidation(name, result) {
  return Object.freeze({
    name,
    valid: Boolean(result?.valid),
    errors: Object.freeze([...(result?.errors || [])]),
    warnings: Object.freeze([...(result?.warnings || [])]),
  });
}

export function validateAgentLifeVerificationFixtures(fixtures = AGENT_LIFE_VERIFICATION_FIXTURES) {
  const checks = [
    collectValidation('template', validateBuildingTemplate(fixtures.template)),
    collectValidation('object', validateObjectCatalogDefinition(fixtures.object)),
    collectValidation('objectInstance', validateObjectInstance(fixtures.objectInstance)),
    collectValidation('action', validateWorldAction(fixtures.action)),
    collectValidation('permissionGatedAction', validateWorldAction(fixtures.permissionGatedAction)),
    collectValidation('permissionGatedActionPolicy', validatePermissionPolicy(fixtures.permissionGatedActionPolicy)),
  ];

  const consistencyErrors = [];
  if (fixtures.template?.id !== 'clinic') consistencyErrors.push('template fixture should reuse the Clinic template');
  if (!fixtures.template?.suggestedObjects?.includes(fixtures.object?.id)) consistencyErrors.push('template.suggestedObjects must include object.id');
  if (fixtures.objectInstance?.catalogId !== fixtures.object?.id) consistencyErrors.push('objectInstance.catalogId must match object.id');
  if (fixtures.action?.target?.objectInstanceId !== fixtures.objectInstance?.id) consistencyErrors.push('action target must reference objectInstance.id');
  if (fixtures.action?.target?.catalogId !== fixtures.object?.id) consistencyErrors.push('action target must reference object.id');
  if (fixtures.permissionGatedAction?.permission?.level === 'public') consistencyErrors.push('permissionGatedAction must require a non-public permission level');
  if (fixtures.permissionGatedAction?.target?.objectInstanceId !== fixtures.objectInstance?.id) consistencyErrors.push('permissionGatedAction target must reference objectInstance.id');
  if (fixtures.permissionGatedAction?.target?.catalogId !== fixtures.object?.id) consistencyErrors.push('permissionGatedAction target must reference object.id');

  const allowedCheck = checkPermission(fixtures.permissionGatedActionPolicy, fixtures.allowedSubject, {
    assignedAgentIds: Object.freeze(['agent-patient']),
    assignedRoles: Object.freeze(['medical-staff']),
  });
  const deniedCheck = checkPermission(fixtures.permissionGatedActionPolicy, fixtures.deniedSubject, {
    assignedAgentIds: Object.freeze(['agent-patient']),
    assignedRoles: Object.freeze(['medical-staff']),
  });
  if (!allowedCheck.allowed) consistencyErrors.push(`permission policy should allow assigned subject, got ${allowedCheck.reason}`);
  if (deniedCheck.allowed) consistencyErrors.push(`permission policy should deny unassigned subject, got ${deniedCheck.reason}`);
  if (allowedCheck.realAuthorityGranted || deniedCheck.realAuthorityGranted || allowedCheck.boundary !== WORLD_PERMISSION_BOUNDARY) {
    consistencyErrors.push('permission checks must remain world-cosmetic-only and grant no real authority');
  }

  checks.push(Object.freeze({
    name: 'fixtureConsistency',
    valid: consistencyErrors.length === 0,
    errors: Object.freeze(consistencyErrors),
    warnings: Object.freeze([]),
  }));

  return Object.freeze({
    valid: checks.every(check => check.valid),
    checks: Object.freeze(checks),
    allowedPermissionCheck: allowedCheck,
    deniedPermissionCheck: deniedCheck,
  });
}

const validation = validateAgentLifeVerificationFixtures();
if (!validation.valid) {
  const errors = validation.checks.flatMap(check => check.errors.map(error => `${check.name}: ${error}`));
  throw new Error(`Invalid Agent Life verification fixtures: ${errors.join('; ')}`);
}
