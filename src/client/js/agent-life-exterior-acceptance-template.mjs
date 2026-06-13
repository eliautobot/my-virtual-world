/**
 * Agent Life Phase 1B exterior acceptance template.
 *
 * This adapts the Phase 0.5 asset acceptance/parity contracts to exterior
 * outdoor-area nodes. It is metadata/validation only: importing it must not
 * create assets, create colliders, persist records, call APIs, or route agents.
 */

export const EXTERIOR_ACCEPTANCE_TEMPLATE_VERSION = 'agent-life-exterior-acceptance-template/v1';

export const EXTERIOR_ACCEPTANCE_STATUS = Object.freeze(['todo', 'pass', 'fail', 'blocked', 'not-applicable']);
export const EXTERIOR_ACCEPTANCE_EVIDENCE_KINDS = Object.freeze([
  'reuse-adapt-skip-note',
  'code-inspection',
  'unit-test',
  'integration-test',
  'browser-screenshot',
  'browser-eval',
  'runtime-smoke',
  'manual-review',
]);
export const EXTERIOR_ACCEPTANCE_REQUIRED_EVIDENCE = Object.freeze([
  'reuse-adapt-skip-note',
  'catalog',
  'collision',
  'action-location',
  'routing',
  'persistence',
  'verification',
]);

export const EXTERIOR_ACCEPTANCE_CRITERIA_IDS = Object.freeze([
  'reuse-adapt-skip',
  'outdoor-area-node',
  'catalog-evidence',
  'collision-soft-zone-evidence',
  'action-location-evidence',
  'routing-waypoint-handoff',
  'context-action',
  'animation',
  'persistence',
  'world-object-integration',
  'route-compatibility-smoke',
  'verification-evidence',
]);

export const EXTERIOR_ACCEPTANCE_ROUTING_OWNER = Object.freeze({
  moveIntentOwner: 'main3d.js#setAgentTarget(agent, target, building, floor)',
  exteriorPlanner: 'dynamic-exterior-routing.js',
  interiorPlanner: 'dynamic-interior-routing.js',
  targetMetadata: Object.freeze(['targetKind', 'nodeId', 'actionId', 'roles', 'routing', 'floor']),
  forbidden: Object.freeze([
    'second exterior router',
    'setOutdoorAgentTarget()',
    '/api/outdoor-areas',
    '/api/outdoor-nodes',
    'parallel outdoor object store',
    'bypassing collision, doorway, floor, sidewalk, or building-transition logic',
  ]),
});

export const EXTERIOR_ACCEPTANCE_CRITERIA = Object.freeze([
  Object.freeze({
    id: 'reuse-adapt-skip',
    label: 'Reuse/adapt/skip decision',
    required: true,
    evidenceRequired: true,
    contract: 'Before implementation, document reuse/adapt/skip notes for catalog, outdoorArea.nodes, collision, routing, context action, animation, persistence, UI, and verification surfaces. Do not start exterior asset work from a title-only checklist.',
  }),
  Object.freeze({
    id: 'outdoor-area-node',
    label: 'Outdoor area node',
    required: true,
    evidenceRequired: true,
    contract: 'Exterior interaction data lives under existing building.outdoorArea.nodes[] and normalizes to the placed-object instance contract with outdoor-area ownership and outdoor-local/world coordinates. Missing outdoorArea data must be safe.',
  }),
  Object.freeze({
    id: 'catalog-evidence',
    label: 'Catalog evidence',
    required: true,
    evidenceRequired: true,
    contract: 'Asset ids, aliases, category/exterior-area metadata, footprint scale, editor visibility, and mesh-builder identity reuse the existing object catalog/registry without duplicate asset ids or a second picker.',
  }),
  Object.freeze({
    id: 'collision-soft-zone-evidence',
    label: 'Collision and soft-zone evidence',
    required: true,
    evidenceRequired: true,
    contract: 'Solid exterior assets resolve through the shared collision registry/collider helpers; soft activity zones stay target-only and do not create phantom blockers.',
  }),
  Object.freeze({
    id: 'action-location-evidence',
    label: 'Action-location evidence',
    required: true,
    evidenceRequired: true,
    contract: 'At least one exterior action location/interaction spot resolves with actionId, roles, facing, and coordinate-space metadata suitable for context menus, reservations, routing, and animation.',
  }),
  Object.freeze({
    id: 'routing-waypoint-handoff',
    label: 'Routing waypoint handoff',
    required: true,
    evidenceRequired: true,
    contract: 'New outdoor targets pass target metadata into setAgentTarget() or the existing move-intent handoff; they do not fork pathfinding or bypass dynamic exterior/interior routing.',
  }),
  Object.freeze({
    id: 'context-action',
    label: 'Context action',
    required: true,
    evidenceRequired: true,
    contract: 'Context menu/world action payloads resolve against the placed exterior node or asset and preserve disabled reasons, subject, actionId, and target metadata.',
  }),
  Object.freeze({
    id: 'animation',
    label: 'Animation',
    required: true,
    evidenceRequired: true,
    contract: 'Exterior action roles map to shared approach/use/idle animation states, or decorative-only assets document not-applicable with an explicit note.',
  }),
  Object.freeze({
    id: 'persistence',
    label: 'Persistence',
    required: true,
    evidenceRequired: true,
    contract: 'Save/reload preserves outdoorArea.nodes records, catalog/type, local/world coordinates, rotation/facing, node/action metadata, collider/action/context survival, and backward compatibility for existing worlds.',
  }),
  Object.freeze({
    id: 'world-object-integration',
    label: 'World-object integration',
    required: true,
    evidenceRequired: true,
    contract: 'Durable outdoor nodes register through the existing _worldObjects/autonomy discovery path without a parallel outdoor object store.',
  }),
  Object.freeze({
    id: 'route-compatibility-smoke',
    label: 'Route compatibility smoke',
    required: true,
    evidenceRequired: true,
    contract: 'Verification proves one indoor route and one outdoor route still pass through setAgentTarget and respect collisions, doors, floors, sidewalks, and building transitions.',
  }),
  Object.freeze({
    id: 'verification-evidence',
    label: 'Verification evidence',
    required: true,
    evidenceRequired: true,
    contract: 'Review includes named schema/static verifier output and browser/runtime smoke evidence when placement, routing, animation, or visuals change. Code inspection alone is not enough.',
  }),
]);

export const EXTERIOR_ACCEPTANCE_TEMPLATE_RULES = Object.freeze([
  'Apply this exterior template before every Phase 1B exterior asset implementation; do not create assets in the acceptance-template task itself.',
  'Every exterior asset/task must include concrete reuse/adapt/skip notes before implementation, not just a copied title or generic checklist.',
  'Catalog, collision/soft-zone, action-location, routing handoff, context action, animation, persistence, and verification evidence are required for acceptance.',
  'Route targets must go through setAgentTarget() or the existing move-intent handoff with target metadata; do not add a second router or bypass dynamic exterior/interior routing.',
  'Outdoor nodes must live under existing building.outdoorArea.nodes[] and integrate with the existing world-object/autonomy registry; do not add /api/outdoor-areas, /api/outdoor-nodes, or a parallel outdoor store.',
  'Verify one indoor route and one outdoor route when placement/routing/action behavior changes.',
  'The template is side-effect-free metadata and validation; importing it must not create assets, meshes, colliders, API writes, persisted records, or routes.',
]);

export const EXTERIOR_ACCEPTANCE_TEMPLATE = Object.freeze({
  version: EXTERIOR_ACCEPTANCE_TEMPLATE_VERSION,
  task: Object.freeze({
    phase: 'Phase 1B',
    title: '<exterior asset or node task>',
    assetId: '<catalog-id-or-node-type>',
    owner: '<reviewer or task id>',
  }),
  routingOwner: EXTERIOR_ACCEPTANCE_ROUTING_OWNER,
  criteria: EXTERIOR_ACCEPTANCE_CRITERIA,
  requiredEvidence: EXTERIOR_ACCEPTANCE_REQUIRED_EVIDENCE,
  rules: EXTERIOR_ACCEPTANCE_TEMPLATE_RULES,
});

const GENERIC_NOTE_RE = /^(todo|tbd|n\/a|na|none|same|generic|check|done|pass|ok|title only|title-only|copy|copied)?$/i;

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

function normalizeStatus(value, fallback = 'todo') {
  const raw = asString(value);
  return EXTERIOR_ACCEPTANCE_STATUS.includes(raw) ? raw : fallback;
}

function normalizeEvidence(evidence = []) {
  const list = Array.isArray(evidence) ? evidence : [];
  return freezeDeep(list.map(item => {
    const raw = isRecord(item) ? item : { kind: 'manual-review', label: String(item || '') };
    const kind = EXTERIOR_ACCEPTANCE_EVIDENCE_KINDS.includes(raw.kind) ? raw.kind : 'manual-review';
    return {
      kind,
      label: asString(raw.label || raw.name || raw.path || kind) || kind,
      path: asString(raw.path || raw.file || raw.url),
      command: asString(raw.command),
      note: asString(raw.note || raw.notes),
      surface: asString(raw.surface || raw.area),
    };
  }));
}

function evidenceText(evidence) {
  return evidence.map(item => `${item.kind} ${item.label} ${item.path} ${item.command} ${item.note} ${item.surface}`).join('\n').toLowerCase();
}

function evidenceMatchesRequirement(evidence, requirement) {
  const text = evidenceText(evidence);
  if (requirement === 'reuse-adapt-skip-note') return evidence.some(item => item.kind === 'reuse-adapt-skip-note') || /\b(reuse|adapt|skip)\b/.test(text);
  if (requirement === 'catalog') return /catalog|registry|asset id|alias|category|footprint|mesh-builder|mesh builder/.test(text);
  if (requirement === 'collision') return /collision|collider|soft-zone|soft zone|resolveplacedcollisionbounds|static collider/.test(text);
  if (requirement === 'action-location') return /action-location|action location|action spot|interaction spot|roles|actionid/.test(text);
  if (requirement === 'routing') return /setagenttarget|move-intent|dynamic-exterior-routing|dynamic interior|route|sidewalk|door|floor|transition/.test(text);
  if (requirement === 'persistence') return /save|reload|persist|outdoorarea\.nodes|building\/|world-object|_worldobjects/.test(text);
  if (requirement === 'verification') return evidence.some(item => ['unit-test', 'integration-test', 'browser-screenshot', 'browser-eval', 'runtime-smoke'].includes(item.kind) || item.command || /\.png$|\.json$|\.txt$/.test(item.path));
  return false;
}

export function getExteriorAcceptanceCriterion(id) {
  const key = asString(id);
  return EXTERIOR_ACCEPTANCE_CRITERIA.find(criterion => criterion.id === key) || null;
}

export function makeExteriorAcceptanceChecklist(input = {}) {
  const raw = isRecord(input) ? input : { task: { title: input } };
  const task = isRecord(raw.task) ? raw.task : raw;
  const suppliedCriteria = new Map((Array.isArray(raw.criteria) ? raw.criteria : []).map(item => [item?.id, item]));
  const criteria = EXTERIOR_ACCEPTANCE_CRITERIA.map(definition => {
    const supplied = suppliedCriteria.get(definition.id) || {};
    const status = normalizeStatus(supplied.status, 'todo');
    const evidence = normalizeEvidence(supplied.evidence || []);
    return freezeDeep({
      ...definition,
      status,
      note: asString(supplied.note || supplied.notes),
      evidence,
      accepted: status === 'pass' || status === 'not-applicable',
    });
  });

  return freezeDeep({
    version: EXTERIOR_ACCEPTANCE_TEMPLATE_VERSION,
    task: {
      phase: asString(task.phase) || 'Phase 1B',
      title: asString(task.title || task.name),
      assetId: asString(task.assetId || task.catalogId || task.nodeType),
      owner: asString(task.owner || raw.owner),
    },
    routingOwner: EXTERIOR_ACCEPTANCE_ROUTING_OWNER,
    criteria,
    requiredEvidence: EXTERIOR_ACCEPTANCE_REQUIRED_EVIDENCE,
    rules: EXTERIOR_ACCEPTANCE_TEMPLATE_RULES,
  });
}

export function summarizeExteriorAcceptance(checklist = {}) {
  const normalized = makeExteriorAcceptanceChecklist(checklist);
  const required = normalized.criteria.filter(item => item.required && item.status !== 'not-applicable');
  const passed = required.filter(item => item.status === 'pass');
  const failed = normalized.criteria.filter(item => item.status === 'fail');
  const blocked = normalized.criteria.filter(item => item.status === 'blocked');
  const todo = normalized.criteria.filter(item => item.status === 'todo');
  const evidence = normalized.criteria.flatMap(item => item.evidence);
  const missingEvidence = EXTERIOR_ACCEPTANCE_REQUIRED_EVIDENCE.filter(requirement => !evidenceMatchesRequirement(evidence, requirement));
  const genericNotes = normalized.criteria.filter(item => item.status === 'pass' && GENERIC_NOTE_RE.test(item.note) && item.evidence.length === 0).map(item => item.id);
  return freezeDeep({
    version: EXTERIOR_ACCEPTANCE_TEMPLATE_VERSION,
    task: normalized.task,
    totals: {
      criteria: normalized.criteria.length,
      required: required.length,
      passed: passed.length,
      failed: failed.length,
      blocked: blocked.length,
      todo: todo.length,
    },
    missingEvidence,
    genericNotes,
    accepted: required.length > 0 && passed.length === required.length && failed.length === 0 && blocked.length === 0 && todo.length === 0 && missingEvidence.length === 0 && genericNotes.length === 0,
  });
}

export function validateExteriorAcceptanceChecklist(checklist = {}) {
  const normalized = makeExteriorAcceptanceChecklist(checklist);
  const errors = [];
  const warnings = [];
  const ids = new Set();

  if (normalized.version !== EXTERIOR_ACCEPTANCE_TEMPLATE_VERSION) errors.push(`version must be ${EXTERIOR_ACCEPTANCE_TEMPLATE_VERSION}`);
  if (!normalized.task.title) errors.push('task.title is required');
  if (!normalized.task.assetId) warnings.push('task.assetId should be filled before implementation');
  if (normalized.criteria.length !== EXTERIOR_ACCEPTANCE_CRITERIA.length) errors.push('criteria must include the full exterior acceptance template');

  for (const criterion of normalized.criteria) {
    if (ids.has(criterion.id)) errors.push(`duplicate criterion id: ${criterion.id}`);
    ids.add(criterion.id);
    if (!EXTERIOR_ACCEPTANCE_CRITERIA_IDS.includes(criterion.id)) errors.push(`unknown criterion id: ${criterion.id}`);
    if (!EXTERIOR_ACCEPTANCE_STATUS.includes(criterion.status)) errors.push(`${criterion.id}: invalid status ${criterion.status}`);
    if (criterion.status === 'pass' && criterion.evidenceRequired && criterion.evidence.length === 0) errors.push(`${criterion.id}: pass requires evidence`);
    if (criterion.status === 'pass' && GENERIC_NOTE_RE.test(criterion.note) && criterion.evidence.length === 0) errors.push(`${criterion.id}: generic/title-only pass notes are not accepted`);
    if (criterion.status === 'not-applicable' && criterion.required && !criterion.note) errors.push(`${criterion.id}: not-applicable requires an explicit note`);
  }

  const evidence = normalized.criteria.flatMap(item => item.evidence);
  for (const requirement of EXTERIOR_ACCEPTANCE_REQUIRED_EVIDENCE) {
    if (!evidenceMatchesRequirement(evidence, requirement)) errors.push(`missing required exterior evidence: ${requirement}`);
  }

  const reuse = normalized.criteria.find(item => item.id === 'reuse-adapt-skip');
  if (reuse?.status === 'pass') {
    const text = `${reuse.note}\n${evidenceText(reuse.evidence)}`.toLowerCase();
    for (const required of ['reuse', 'adapt', 'skip']) {
      if (!text.includes(required)) errors.push(`reuse-adapt-skip: missing ${required} decision`);
    }
  }

  return freezeDeep({
    valid: errors.length === 0,
    errors,
    warnings,
    checklist: normalized,
    summary: summarizeExteriorAcceptance(normalized),
  });
}

export function buildExteriorAcceptanceTemplate(task = {}) {
  return makeExteriorAcceptanceChecklist({ task });
}
