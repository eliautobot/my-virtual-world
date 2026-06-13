/**
 * Agent Life asset acceptance criteria template.
 *
 * Phase 0.5 technical spine for deciding whether a new placeable asset is
 * complete enough to ship. This is a side-effect-free checklist contract: it
 * defines the reusable acceptance gates, evidence requirements, and validation
 * helpers every catalog asset must satisfy before reviewers mark it accepted.
 * Importing this module must not create meshes, mutate world state, persist
 * records, call APIs, or change editor/runtime behavior.
 */

export const ASSET_ACCEPTANCE_CRITERIA_VERSION = 'agent-life-asset-acceptance-criteria/v1';

export const ASSET_ACCEPTANCE_STATUS = Object.freeze(['todo', 'pass', 'fail', 'blocked', 'not-applicable']);
export const ASSET_ACCEPTANCE_EVIDENCE_KINDS = Object.freeze([
  'code-inspection',
  'unit-test',
  'integration-test',
  'browser-screenshot',
  'browser-eval',
  'manual-review',
]);
export const ASSET_ACCEPTANCE_REQUIRED_EVIDENCE = Object.freeze(['test', 'screenshot']);

export const ASSET_ACCEPTANCE_CATEGORIES = Object.freeze([
  'catalog',
  'preview',
  'placement',
  'rotation',
  'save-load',
  'collision',
  'route-to-action',
  'animation',
  'ui',
  'scale',
  'console-clean',
  'screenshot-test-evidence',
]);

export const ASSET_ACCEPTANCE_CRITERIA = Object.freeze([
  Object.freeze({
    id: 'catalog',
    label: 'Catalog definition',
    required: true,
    evidenceRequired: true,
    contract: 'Asset has one canonical catalog id, display name, category/subcategory, tags, footprint, interaction/action spots where applicable, and no stale duplicate aliases.',
  }),
  Object.freeze({
    id: 'preview',
    label: 'Editor preview',
    required: true,
    evidenceRequired: true,
    contract: 'Editor/catalog preview renders the correct asset identity, footprint, invalid/valid placement state, and does not rely on another asset thumbnail or mesh.',
  }),
  Object.freeze({
    id: 'placement',
    label: 'Placement',
    required: true,
    evidenceRequired: true,
    contract: 'Asset can be placed into the intended building/interior area with stable catalogId/type, floor, position, state, and ownership fields.',
  }),
  Object.freeze({
    id: 'rotation',
    label: 'Rotation',
    required: true,
    evidenceRequired: true,
    contract: 'Asset supports every runtime rotation step expected by the editor; rendered mesh, footprint, collision bounds, and action locations rotate together.',
  }),
  Object.freeze({
    id: 'save-load',
    label: 'Save/load',
    required: true,
    evidenceRequired: true,
    contract: 'Placed asset persists through save/reload without losing catalog id, legacy runtime type, position, floor, rotation, state, or owner path.',
  }),
  Object.freeze({
    id: 'collision',
    label: 'Collision',
    required: true,
    evidenceRequired: true,
    contract: 'Collision profile matches the visible footprint, blocks placement/routing only when intended, and does not create phantom blockers.',
  }),
  Object.freeze({
    id: 'route-to-action',
    label: 'Route to action',
    required: true,
    evidenceRequired: true,
    contract: 'At least one usable action/interaction location resolves from the placed asset and remains reachable without clipping through blockers.',
  }),
  Object.freeze({
    id: 'animation',
    label: 'Animation',
    required: true,
    evidenceRequired: true,
    contract: 'Action locations map to expected approach/use/idle animation states, or explicitly document a not-applicable decorative-only reason.',
  }),
  Object.freeze({
    id: 'ui',
    label: 'UI affordances',
    required: true,
    evidenceRequired: true,
    contract: 'Relevant editor/runtime UI surfaces show the asset name, category/filter state, context actions, disabled reasons, and placement/action feedback.',
  }),
  Object.freeze({
    id: 'scale',
    label: 'Scale and visual fit',
    required: true,
    evidenceRequired: true,
    contract: 'Asset scale, floor contact, orientation, and visual footprint fit existing avatars, rooms, doors, and nearby furniture.',
  }),
  Object.freeze({
    id: 'console-clean',
    label: 'Console clean',
    required: true,
    evidenceRequired: true,
    contract: 'Browser review produces no new errors, unhandled promise rejections, noisy warnings, or missing asset/module requests caused by this asset.',
  }),
  Object.freeze({
    id: 'screenshot-test-evidence',
    label: 'Screenshot/test evidence',
    required: true,
    evidenceRequired: true,
    contract: 'Review includes named test command output plus browser screenshot/eval artifact paths that prove catalog, preview/placement, and runtime behavior were checked.',
  }),
]);

export const ASSET_ACCEPTANCE_TEMPLATE_RULES = Object.freeze([
  'Use this checklist for every new or changed placeable asset before marking it accepted.',
  'Do not mark an asset accepted when any required criterion is todo, fail, or blocked.',
  'Decorative-only assets may mark route-to-action and animation not-applicable only with an explicit reviewer note explaining why no action is expected.',
  'Acceptance requires both automated test evidence and browser screenshot/eval evidence; code inspection alone is never enough.',
  'Console-clean evidence must come from the same browser review used for screenshot or runtime verification.',
  'The checklist is side-effect-free metadata; it must not create meshes, mutate world state, persist records, call APIs, or start asset implementation work by import side effect.',
]);

export const ASSET_ACCEPTANCE_TEMPLATE = Object.freeze({
  version: ASSET_ACCEPTANCE_CRITERIA_VERSION,
  asset: Object.freeze({
    catalogId: '<catalog-id>',
    name: '<display name>',
    category: '<category>',
    owner: '<reviewer or task id>',
  }),
  criteria: ASSET_ACCEPTANCE_CRITERIA,
  requiredEvidence: ASSET_ACCEPTANCE_REQUIRED_EVIDENCE,
  rules: ASSET_ACCEPTANCE_TEMPLATE_RULES,
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

function normalizeStatus(value, fallback = 'todo') {
  const raw = asString(value);
  return ASSET_ACCEPTANCE_STATUS.includes(raw) ? raw : fallback;
}

function normalizeEvidence(evidence = []) {
  const list = Array.isArray(evidence) ? evidence : [];
  return freezeDeep(list.map(item => {
    const raw = isRecord(item) ? item : { kind: 'manual-review', label: String(item || '') };
    const kind = ASSET_ACCEPTANCE_EVIDENCE_KINDS.includes(raw.kind) ? raw.kind : 'manual-review';
    return {
      kind,
      label: asString(raw.label || raw.name || raw.path || kind) || kind,
      path: asString(raw.path || raw.file || raw.url),
      command: asString(raw.command),
      note: asString(raw.note || raw.notes),
    };
  }));
}

function evidenceMatchesRequirement(evidence, requirement) {
  if (requirement === 'test') return evidence.some(item => ['unit-test', 'integration-test'].includes(item.kind) || item.command);
  if (requirement === 'screenshot') return evidence.some(item => ['browser-screenshot', 'browser-eval'].includes(item.kind) || /\.(png|jpg|jpeg|webp|txt|json)$/i.test(item.path));
  return false;
}

export function getAssetAcceptanceCriterion(id) {
  const key = asString(id);
  return ASSET_ACCEPTANCE_CRITERIA.find(criterion => criterion.id === key) || null;
}

export function makeAssetAcceptanceChecklist(input = {}) {
  const raw = isRecord(input) ? input : { asset: { catalogId: input } };
  const asset = isRecord(raw.asset) ? raw.asset : raw;
  const suppliedCriteria = new Map((Array.isArray(raw.criteria) ? raw.criteria : []).map(item => [item?.id, item]));
  const criteria = ASSET_ACCEPTANCE_CRITERIA.map(definition => {
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
    version: ASSET_ACCEPTANCE_CRITERIA_VERSION,
    asset: {
      catalogId: asString(asset.catalogId || asset.objectId || asset.id),
      name: asString(asset.name || asset.label),
      category: asString(asset.category || asset.primaryCategory),
      owner: asString(asset.owner || raw.owner),
    },
    criteria,
    requiredEvidence: ASSET_ACCEPTANCE_REQUIRED_EVIDENCE,
    rules: ASSET_ACCEPTANCE_TEMPLATE_RULES,
  });
}

export function summarizeAssetAcceptance(checklist = {}) {
  const normalized = makeAssetAcceptanceChecklist(checklist);
  const required = normalized.criteria.filter(item => item.required && item.status !== 'not-applicable');
  const passed = required.filter(item => item.status === 'pass');
  const failed = normalized.criteria.filter(item => item.status === 'fail');
  const blocked = normalized.criteria.filter(item => item.status === 'blocked');
  const todo = normalized.criteria.filter(item => item.status === 'todo');
  const evidence = normalized.criteria.flatMap(item => item.evidence);
  const missingEvidence = ASSET_ACCEPTANCE_REQUIRED_EVIDENCE.filter(requirement => !evidenceMatchesRequirement(evidence, requirement));
  return freezeDeep({
    version: ASSET_ACCEPTANCE_CRITERIA_VERSION,
    asset: normalized.asset,
    totals: {
      criteria: normalized.criteria.length,
      required: required.length,
      passed: passed.length,
      failed: failed.length,
      blocked: blocked.length,
      todo: todo.length,
    },
    missingEvidence,
    accepted: required.length > 0 && passed.length === required.length && failed.length === 0 && blocked.length === 0 && todo.length === 0 && missingEvidence.length === 0,
  });
}

export function validateAssetAcceptanceChecklist(checklist = {}) {
  const normalized = makeAssetAcceptanceChecklist(checklist);
  const errors = [];
  const warnings = [];
  const ids = new Set();

  if (normalized.version !== ASSET_ACCEPTANCE_CRITERIA_VERSION) errors.push(`version must be ${ASSET_ACCEPTANCE_CRITERIA_VERSION}`);
  if (!normalized.asset.catalogId) errors.push('asset.catalogId is required');
  if (!normalized.asset.name) warnings.push('asset.name should be filled before review');
  if (normalized.criteria.length !== ASSET_ACCEPTANCE_CRITERIA.length) errors.push('criteria must include the full reusable template');

  for (const criterion of normalized.criteria) {
    if (!ASSET_ACCEPTANCE_CATEGORIES.includes(criterion.id)) errors.push(`unknown criterion: ${criterion.id}`);
    if (ids.has(criterion.id)) errors.push(`duplicate criterion: ${criterion.id}`);
    ids.add(criterion.id);
    if (!ASSET_ACCEPTANCE_STATUS.includes(criterion.status)) errors.push(`${criterion.id} has invalid status`);
    if (criterion.evidenceRequired && criterion.status === 'pass' && criterion.evidence.length === 0) {
      errors.push(`${criterion.id} pass requires evidence`);
    }
    if (criterion.status === 'not-applicable' && !criterion.note) {
      errors.push(`${criterion.id} not-applicable requires a note`);
    }
  }

  for (const category of ASSET_ACCEPTANCE_CATEGORIES) {
    if (!ids.has(category)) errors.push(`missing criterion: ${category}`);
  }

  return freezeDeep({
    valid: errors.length === 0,
    errors,
    warnings,
    summary: summarizeAssetAcceptance(normalized),
    checklist: normalized,
  });
}

export function buildAssetAcceptanceTemplate(asset = {}) {
  return makeAssetAcceptanceChecklist({ asset });
}

export default ASSET_ACCEPTANCE_TEMPLATE;
