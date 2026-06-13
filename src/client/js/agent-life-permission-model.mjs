/**
 * Agent Life permission model.
 *
 * Permission policies separate Virtual World / Agent Life world-cosmetic access
 * from real OpenClaw, file, tool, API, model, admin, XP, credit, or skill
 * authority. This module is metadata/validation/evaluation only: importing it
 * must not create objects, actions, templates, admin panels, routes, colliders,
 * persistence records, server sessions, or external authority.
 */
import {
  BUILDING_TEMPLATE_PERMISSION_LEVELS,
} from './agent-life-building-template-schema.mjs';
import {
  OBJECT_ACTION_PERMISSION_LEVELS,
} from './agent-life-object-catalog-schema.mjs';

export const PERMISSION_MODEL_VERSION = 'agent-life-permission-model/v1';

export const WORLD_PERMISSION_BOUNDARY = 'world-cosmetic-only';

export const PERMISSION_LEVELS = Object.freeze(['public', 'assigned-role', 'manager', 'admin', 'owner-only']);

export const PERMISSION_LEVEL_RANKS = Object.freeze({
  public: 0,
  'assigned-role': 10,
  manager: 20,
  admin: 30,
  'owner-only': 40,
});

export const WORLD_AUTHORITY_ROLES = Object.freeze(['participant', 'assigned', 'manager', 'admin', 'owner']);

export const MANAGEMENT_ROLE_INHERITANCE = Object.freeze({
  participant: Object.freeze(['participant']),
  assigned: Object.freeze(['participant', 'assigned']),
  manager: Object.freeze(['participant', 'assigned', 'manager']),
  admin: Object.freeze(['participant', 'assigned', 'manager', 'admin']),
  owner: Object.freeze(['participant', 'assigned', 'manager', 'admin', 'owner']),
});

export const PERMISSION_ATTACHMENT_SURFACES = Object.freeze(['action', 'object', 'template', 'admin-panel']);

export const PERMISSION_ATTACHMENT_SOURCES = Object.freeze({
  action: Object.freeze([
    'agent-life-world-action-schema.mjs#permission',
    'agent-life-object-catalog-schema.mjs#uiActions.permission',
    'agent-life-object-catalog-schema.mjs#apiActions.permission',
  ]),
  object: Object.freeze([
    'agent-life-object-catalog-schema.mjs#uiActions.permission',
    'agent-life-object-catalog-schema.mjs#apiActions.permission',
    'agent-life-object-instance-schema.mjs#permissions',
  ]),
  template: Object.freeze([
    'agent-life-building-template-schema.mjs#permissions',
  ]),
  'admin-panel': Object.freeze([
    'future-admin-panel-metadata#permissions',
    'main3d.js#editor-ui',
  ]),
});

export const PERMISSION_DENY_REASONS = Object.freeze([
  'invalid-policy',
  'invalid-subject',
  'real-authority-not-grantable',
  'explicit-agent-deny',
  'explicit-role-deny',
  'missing-assigned-role',
  'missing-manager-role',
  'missing-admin-role',
  'missing-owner-role',
]);

export const PERMISSION_SCHEMA_FIELDS = Object.freeze([
  Object.freeze({ key: 'surface', required: true, type: 'string', meaning: 'Attach point for the policy: action, object, template, or admin-panel.' }),
  Object.freeze({ key: 'level', required: true, type: 'string', meaning: 'Minimum world/cosmetic permission level: public, assigned-role, manager, admin, or owner-only.' }),
  Object.freeze({ key: 'source', required: false, type: 'string', meaning: 'Schema/runtime path that owns the attachment, used for migration and review.' }),
  Object.freeze({ key: 'allowedAgentIds', required: false, type: 'string[]', meaning: 'Optional world-agent allow list for assigned-role style checks.' }),
  Object.freeze({ key: 'deniedAgentIds', required: false, type: 'string[]', meaning: 'Optional world-agent deny list; explicit deny wins over any allow.' }),
  Object.freeze({ key: 'allowedRoles', required: false, type: 'string[]', meaning: 'Optional role allow list for assigned-role style checks.' }),
  Object.freeze({ key: 'deniedRoles', required: false, type: 'string[]', meaning: 'Optional role deny list; explicit deny wins over any allow.' }),
  Object.freeze({ key: 'assignedAgentIds', required: false, type: 'string[]', meaning: 'Agents assigned to this action/object/template/admin scope.' }),
  Object.freeze({ key: 'assignedRoles', required: false, type: 'string[]', meaning: 'Roles assigned to this action/object/template/admin scope.' }),
  Object.freeze({ key: 'ownerAgentId', required: false, type: 'string', meaning: 'World owner identity for owner-only checks; still not real host/app authority.' }),
  Object.freeze({ key: 'realAuthority', required: false, type: 'boolean', meaning: 'Must be false/absent. World permissions cannot grant real OpenClaw/tool/file/API/admin authority.' }),
]);

export const PERMISSION_VALIDATION_EXPECTATIONS = Object.freeze([
  'Permission levels are shared across building templates, object catalog actions, object instances, world actions, and future admin panels.',
  'Permission checks are metadata-only world/cosmetic gates and must never grant real OpenClaw, file, tool, API, model, XP, credit, skill, or admin authority.',
  'Policies attach to action, object, template, and admin-panel surfaces using one canonical level vocabulary.',
  'Explicit deniedAgentIds and deniedRoles override any allow list, assignment, manager, admin, or owner match.',
  'assigned-role can be satisfied by assigned agent id, allowed agent id, assigned role, allowed role, or matching context assignments.',
  'manager accepts manager/admin/owner world roles; admin accepts admin/owner; owner-only requires owner identity or role.',
  'Existing Task 3, Task 4, Task 5, and Task 6 schemas remain authoritative for their own records; this module adds shared validation/evaluation helpers without replacing them.',
]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asStringArray(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze([...new Set(value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean))]);
}

function normalizeRole(role) {
  if (typeof role !== 'string') return null;
  const normalized = role.trim().toLowerCase();
  return normalized || null;
}

function normalizeRoles(roles = []) {
  return Object.freeze([...new Set(asStringArray(roles).map(normalizeRole).filter(Boolean))]);
}

function hasIntersection(left = [], right = []) {
  const rightSet = new Set(right);
  return left.some(item => rightSet.has(item));
}

function getSubjectId(subject = {}) {
  if (!isRecord(subject)) return null;
  return subject.agentId || subject.userId || subject.id || null;
}

function getSubjectRoles(subject = {}) {
  if (!isRecord(subject)) return Object.freeze([]);
  const base = normalizeRoles(subject.roles || []);
  const inherited = new Set(base);
  for (const role of base) {
    for (const inheritedRole of MANAGEMENT_ROLE_INHERITANCE[role] || []) inherited.add(inheritedRole);
  }
  if (subject.isOwner || subject.owner === true) {
    for (const role of MANAGEMENT_ROLE_INHERITANCE.owner) inherited.add(role);
  }
  if (subject.isAdmin || subject.admin === true) {
    for (const role of MANAGEMENT_ROLE_INHERITANCE.admin) inherited.add(role);
  }
  if (subject.isManager || subject.manager === true) {
    for (const role of MANAGEMENT_ROLE_INHERITANCE.manager) inherited.add(role);
  }
  return Object.freeze([...inherited]);
}

function contextAssignments(context = {}) {
  if (!isRecord(context)) return Object.freeze({ agentIds: Object.freeze([]), roles: Object.freeze([]) });
  return Object.freeze({
    agentIds: asStringArray(context.assignedAgentIds || context.allowedAgentIds || []),
    roles: normalizeRoles(context.assignedRoles || context.allowedRoles || []),
  });
}

export function isPermissionLevel(level) {
  return PERMISSION_LEVELS.includes(level);
}

export function comparePermissionLevels(left, right) {
  return (PERMISSION_LEVEL_RANKS[left] ?? -1) - (PERMISSION_LEVEL_RANKS[right] ?? -1);
}

export function isPermissionSurface(surface) {
  return PERMISSION_ATTACHMENT_SURFACES.includes(surface);
}

export function canAttachPermissionPolicy(surface, target = {}) {
  if (!isPermissionSurface(surface)) return false;
  if (surface === 'action') return isRecord(target) && (isRecord(target.permission) || typeof target.permission === 'string' || typeof target.actionType === 'string' || typeof target.id === 'string');
  if (surface === 'object') return isRecord(target) && (isRecord(target.permissions) || Array.isArray(target.uiActions) || Array.isArray(target.apiActions) || typeof target.catalogId === 'string' || typeof target.id === 'string');
  if (surface === 'template') return isRecord(target) && (isRecord(target.permissions) || Array.isArray(target.rooms) || typeof target.id === 'string');
  if (surface === 'admin-panel') return isRecord(target) && (typeof target.panelId === 'string' || typeof target.id === 'string' || target.adminPanel === true);
  return false;
}

export function normalizePermissionPolicy(policy = {}, defaults = {}) {
  const raw = isRecord(policy) ? policy : {};
  const fallback = isRecord(defaults) ? defaults : {};
  const surface = raw.surface || fallback.surface || 'action';
  const level = raw.level || raw.permission || fallback.level || 'public';
  return Object.freeze({
    surface,
    level,
    source: raw.source || fallback.source || null,
    allowedAgentIds: asStringArray(raw.allowedAgentIds || raw.agentIds || fallback.allowedAgentIds || []),
    deniedAgentIds: asStringArray(raw.deniedAgentIds || fallback.deniedAgentIds || []),
    allowedRoles: normalizeRoles(raw.allowedRoles || raw.roles || fallback.allowedRoles || []),
    deniedRoles: normalizeRoles(raw.deniedRoles || fallback.deniedRoles || []),
    assignedAgentIds: asStringArray(raw.assignedAgentIds || fallback.assignedAgentIds || []),
    assignedRoles: normalizeRoles(raw.assignedRoles || fallback.assignedRoles || []),
    ownerAgentId: raw.ownerAgentId || fallback.ownerAgentId || null,
    realAuthority: raw.realAuthority === true,
  });
}

export function validatePermissionPolicy(policy) {
  const errors = [];
  const warnings = [];
  const normalized = normalizePermissionPolicy(policy);

  if (!isRecord(policy)) errors.push('permission policy must be an object');
  if (!isPermissionSurface(normalized.surface)) errors.push(`surface must be one of ${PERMISSION_ATTACHMENT_SURFACES.join(', ')}`);
  if (!isPermissionLevel(normalized.level)) errors.push(`level must be one of ${PERMISSION_LEVELS.join(', ')}`);
  if (normalized.source !== null && (typeof normalized.source !== 'string' || !normalized.source.trim())) errors.push('source must be a non-empty string or null when present');
  if (normalized.source && isPermissionSurface(normalized.surface) && !PERMISSION_ATTACHMENT_SOURCES[normalized.surface].includes(normalized.source)) {
    warnings.push(`source ${normalized.source} is not a known ${normalized.surface} permission source yet`);
  }
  if (normalized.ownerAgentId !== null && (typeof normalized.ownerAgentId !== 'string' || !normalized.ownerAgentId.trim())) errors.push('ownerAgentId must be a non-empty string or null when present');
  if (normalized.realAuthority) errors.push('realAuthority must be false or absent; world permissions cannot grant real authority');

  for (const key of ['allowedAgentIds', 'deniedAgentIds', 'allowedRoles', 'deniedRoles', 'assignedAgentIds', 'assignedRoles']) {
    const original = isRecord(policy) ? policy[key] : undefined;
    if (original !== undefined && !Array.isArray(original)) errors.push(`${key} must be an array when present`);
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    normalized,
  });
}

function result(allowed, policy, reason) {
  return Object.freeze({
    allowed,
    level: policy.level,
    surface: policy.surface,
    reason,
    boundary: WORLD_PERMISSION_BOUNDARY,
    realAuthorityGranted: false,
  });
}

export function checkPermission(policy, subject = {}, context = {}) {
  const validation = validatePermissionPolicy(policy);
  const normalized = validation.normalized;
  if (!validation.valid) return result(false, normalized, 'invalid-policy');
  if (normalized.realAuthority) return result(false, normalized, 'real-authority-not-grantable');

  const subjectId = getSubjectId(subject);
  const subjectRoles = getSubjectRoles(subject);
  if (!isRecord(subject)) return result(false, normalized, 'invalid-subject');

  if (subjectId && normalized.deniedAgentIds.includes(subjectId)) return result(false, normalized, 'explicit-agent-deny');
  if (hasIntersection(subjectRoles, normalized.deniedRoles)) return result(false, normalized, 'explicit-role-deny');

  if (normalized.level === 'public') return result(true, normalized, 'public');

  const assignments = contextAssignments(context);
  const assignedAgentIds = Object.freeze([...new Set([...normalized.assignedAgentIds, ...assignments.agentIds])]);
  const assignedRoles = Object.freeze([...new Set([...normalized.assignedRoles, ...assignments.roles])]);

  if (normalized.level === 'assigned-role') {
    if (subjectId && normalized.allowedAgentIds.includes(subjectId)) return result(true, normalized, 'allowed-agent');
    if (subjectId && assignedAgentIds.includes(subjectId)) return result(true, normalized, 'assigned-agent');
    if (hasIntersection(subjectRoles, normalized.allowedRoles)) return result(true, normalized, 'allowed-role');
    if (hasIntersection(subjectRoles, assignedRoles)) return result(true, normalized, 'assigned-role');
    if (subjectRoles.includes('manager') || subjectRoles.includes('admin') || subjectRoles.includes('owner')) return result(true, normalized, 'management-override');
    return result(false, normalized, 'missing-assigned-role');
  }

  if (normalized.level === 'manager') {
    if (subjectRoles.includes('manager')) return result(true, normalized, 'manager-role');
    return result(false, normalized, 'missing-manager-role');
  }

  if (normalized.level === 'admin') {
    if (subjectRoles.includes('admin')) return result(true, normalized, 'admin-role');
    return result(false, normalized, 'missing-admin-role');
  }

  if (normalized.level === 'owner-only') {
    if (subjectRoles.includes('owner')) return result(true, normalized, 'owner-role');
    if (subjectId && normalized.ownerAgentId && subjectId === normalized.ownerAgentId) return result(true, normalized, 'owner-agent');
    return result(false, normalized, 'missing-owner-role');
  }

  return result(false, normalized, 'invalid-policy');
}

export function makePermissionAttachment(surface, level, options = {}) {
  return normalizePermissionPolicy({ ...options, surface, level });
}

export const PERMISSION_MODEL_EXAMPLES = Object.freeze([
  Object.freeze({
    id: 'action-public-style-preview',
    policy: makePermissionAttachment('action', 'public', { source: 'agent-life-world-action-schema.mjs#permission' }),
    allowedSubject: Object.freeze({ agentId: 'agent-customer', roles: Object.freeze(['participant']) }),
  }),
  Object.freeze({
    id: 'object-assigned-clinic-bed',
    policy: makePermissionAttachment('object', 'assigned-role', { source: 'agent-life-object-instance-schema.mjs#permissions', assignedAgentIds: Object.freeze(['agent-patient']), assignedRoles: Object.freeze(['medical-staff']) }),
    allowedSubject: Object.freeze({ agentId: 'agent-patient', roles: Object.freeze(['participant']) }),
  }),
  Object.freeze({
    id: 'template-manager-edit-rooms',
    policy: makePermissionAttachment('template', 'manager', { source: 'agent-life-building-template-schema.mjs#permissions' }),
    allowedSubject: Object.freeze({ agentId: 'agent-manager', roles: Object.freeze(['manager']) }),
  }),
  Object.freeze({
    id: 'admin-panel-admin-tools',
    policy: makePermissionAttachment('admin-panel', 'admin', { source: 'future-admin-panel-metadata#permissions' }),
    allowedSubject: Object.freeze({ agentId: 'agent-admin', roles: Object.freeze(['admin']) }),
  }),
  Object.freeze({
    id: 'admin-panel-owner-economy-boundary',
    policy: makePermissionAttachment('admin-panel', 'owner-only', { source: 'future-admin-panel-metadata#permissions', ownerAgentId: 'owner-agent' }),
    allowedSubject: Object.freeze({ agentId: 'owner-agent', roles: Object.freeze(['participant']) }),
  }),
]);

for (const level of PERMISSION_LEVELS) {
  if (!BUILDING_TEMPLATE_PERMISSION_LEVELS.includes(level)) throw new Error(`Permission level ${level} missing from building template schema`);
  if (!OBJECT_ACTION_PERMISSION_LEVELS.includes(level)) throw new Error(`Permission level ${level} missing from object catalog schema`);
}

for (const example of PERMISSION_MODEL_EXAMPLES) {
  const validation = validatePermissionPolicy(example.policy);
  if (!validation.valid) throw new Error(`Invalid permission example ${example.id}: ${validation.errors.join('; ')}`);
  const check = checkPermission(example.policy, example.allowedSubject);
  if (!check.allowed) throw new Error(`Permission example ${example.id} should allow ${example.allowedSubject.agentId}: ${check.reason}`);
}
