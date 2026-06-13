/**
 * Agent Life asset registry QA checks.
 *
 * Phase 0.5 technical spine for auditing the placeable asset registry before an
 * asset is accepted. The contract is intentionally side-effect-free: importing
 * this module must not create meshes, mutate world state, place furniture,
 * create colliders, enqueue actions, persist records, or perform cleanup.
 */
import {
  buildCatalogRegistry,
  CATALOG_REGISTRY_BLUEPRINTS,
  CATALOG_REGISTRY_VISIBILITY,
} from './agent-life-catalog-registry.mjs';
import {
  buildCollisionRegistry,
} from './agent-life-collision-registry.mjs';
import {
  buildActionLocationRegistry,
} from './agent-life-action-location-registry.mjs';
import {
  buildContextMenuActionRegistry,
} from './agent-life-context-menu-action-registry.mjs';
import {
  buildTemporaryUseItemLifecycle,
} from './agent-life-temporary-use-item-lifecycle.mjs';
import {
  OBJECT_CATEGORY_EDITOR_ORDER,
  OBJECT_CATEGORY_CLASSIFICATIONS,
  getObjectCatalogExample,
  getPhase1ObjectTaxonomy,
  normalizeObjectCatalogId,
  normalizeObjectCategory,
} from './agent-life-object-catalog-schema.mjs';

export const ASSET_REGISTRY_QA_CHECKS_VERSION = 'agent-life-asset-registry-qa-checks/v1';

export const ASSET_REGISTRY_QA_SEVERITIES = Object.freeze(['error', 'warning', 'manual']);
export const ASSET_REGISTRY_QA_AUTOMATION_KINDS = Object.freeze(['automated', 'manual']);

export const ASSET_REGISTRY_QA_CHECK_IDS = Object.freeze([
  'duplicate-catalog-ids',
  'mesh-builder-coverage',
  'collision-profile-coverage',
  'action-location-coverage',
  'category-validity',
  'functional-ui-coverage',
  'temporary-cleanup-coverage',
]);

export const ASSET_REGISTRY_QA_CONTRACT = Object.freeze([
  Object.freeze({ key: 'duplicate-catalog-ids', automation: 'automated', severity: 'error', meaning: 'Every canonical catalog id and alias must normalize to one owner only; no duplicate ids or alias collisions are allowed.' }),
  Object.freeze({ key: 'mesh-builder-coverage', automation: 'automated', severity: 'error', meaning: 'Every editor-visible asset must resolve to a runtime mesh-builder adapter so catalog rows cannot place invisible objects.' }),
  Object.freeze({ key: 'collision-profile-coverage', automation: 'automated', severity: 'error', meaning: 'Every placeable asset must have a collision profile with explicit solid/non-solid semantics and bounds.' }),
  Object.freeze({ key: 'action-location-coverage', automation: 'automated', severity: 'error', meaning: 'Functional, seating, appliance, storage, consumable, or tagged assets must expose at least one action/interaction location unless explicitly decorative/structural.' }),
  Object.freeze({ key: 'category-validity', automation: 'automated', severity: 'error', meaning: 'Categories and secondary categories must normalize through OBJECT_CATEGORY_EDITOR_ORDER and cannot create duplicate editor sections.' }),
  Object.freeze({ key: 'functional-ui-coverage', automation: 'automated', severity: 'error', meaning: 'Assets backed by functional object definitions must expose UI/context-menu actions; runtime-only functional assets are listed for manual UI review until object definitions exist.' }),
  Object.freeze({ key: 'temporary-cleanup-coverage', automation: 'automated', severity: 'error', meaning: 'Temporary/consumable assets must have lifecycle cleanup metadata proving consume/despawn/reload paths cannot leak ghost items.' }),
]);

export const ASSET_REGISTRY_QA_RULES = Object.freeze([
  'Run these checks whenever a catalog asset is added, renamed, promoted to editor-visible, or given functional behavior.',
  'Automated errors block acceptance. Automated warnings must be resolved or copied into the manual review notes with an owner.',
  'Manual checks are required review steps for visual/runtime behavior that static metadata cannot prove, including screenshot/browser evidence.',
  'Mesh, collision, action-location, context-menu, and temporary-lifecycle adapters are references only; this QA module must stay side-effect-free.',
  'Temporary items must declare cleanup for consume/use, explicit despawn, and reload/session recovery before they are accepted.',
]);

export const ASSET_REGISTRY_QA_MANUAL_CHECKS = Object.freeze([
  Object.freeze({ id: 'mesh-visual-match', covers: Object.freeze(['mesh-builder-coverage']), evidence: 'browser-screenshot', prompt: 'Place each changed asset and confirm the rendered mesh matches the catalog label, footprint, orientation, and floor contact.' }),
  Object.freeze({ id: 'collision-visual-match', covers: Object.freeze(['collision-profile-coverage']), evidence: 'browser-eval-or-screenshot', prompt: 'Confirm placement/routing collision matches the visible object and does not create phantom blockers or allow clipping.' }),
  Object.freeze({ id: 'route-to-action-reachable', covers: Object.freeze(['action-location-coverage']), evidence: 'browser-eval-or-screenshot', prompt: 'Route an agent to each functional/action spot and confirm the target remains reachable after rotation.' }),
  Object.freeze({ id: 'functional-ui-affordance', covers: Object.freeze(['functional-ui-coverage']), evidence: 'browser-screenshot', prompt: 'Open editor/runtime UI and confirm functional objects show appropriate labels, context actions, disabled reasons, and feedback.' }),
  Object.freeze({ id: 'temporary-cleanup-observed', covers: Object.freeze(['temporary-cleanup-coverage']), evidence: 'unit-test-or-browser-eval', prompt: 'Create/use/despawn/reload a temporary item and confirm carried state, placement records, and ghost meshes are cleared.' }),
]);

const FUNCTIONAL_CLASSIFICATIONS = Object.freeze(['functional', 'seating', 'storage', 'appliance', 'consumable']);
const NON_INTERACTIVE_CATEGORIES = Object.freeze(['decor', 'building-structure']);

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeInputId(value) {
  return normalizeObjectCatalogId(value) || asString(value);
}

function getCatalogEntries(registry) {
  return Array.isArray(registry?.entries) ? registry.entries : [];
}

function getDefinitionForEntry(entry) {
  return getObjectCatalogExample(entry?.objectCatalogId) || getObjectCatalogExample(entry?.id) || null;
}

function getTaxonomyForEntry(entry) {
  return getPhase1ObjectTaxonomy(entry?.id) || null;
}

function classificationsForEntry(entry) {
  const definition = getDefinitionForEntry(entry);
  const taxonomy = getTaxonomyForEntry(entry);
  return Object.freeze([...new Set([
    ...asArray(definition?.classifications),
    ...asArray(taxonomy?.classifications),
    ...asArray(entry?.classifications),
  ].map(asString).filter(Boolean))]);
}

function isFunctionalEntry(entry) {
  const classifications = classificationsForEntry(entry);
  if (classifications.some(item => FUNCTIONAL_CLASSIFICATIONS.includes(item))) return true;
  if (asArray(entry?.tags).length > 0 && !NON_INTERACTIVE_CATEGORIES.includes(entry.category)) return true;
  return false;
}

function requiresActionLocation(entry) {
  if (!entry) return false;
  const classifications = classificationsForEntry(entry);
  if (classifications.includes('decorative') && entry.category === 'decor') return false;
  if (classifications.includes('structural') && entry.category === 'building-structure') return false;
  return isFunctionalEntry(entry);
}

function definitionRequiresUi(entry) {
  const definition = getDefinitionForEntry(entry);
  if (!definition) return false;
  const classifications = asArray(definition.classifications);
  return classifications.some(item => FUNCTIONAL_CLASSIFICATIONS.includes(item)) || asArray(definition.uiActions).length > 0 || asArray(definition.apiActions).length > 0;
}

function isTemporaryEntry(entry) {
  const definition = getDefinitionForEntry(entry);
  const taxonomy = getTaxonomyForEntry(entry);
  return entry?.category === 'temporary-consumable'
    || definition?.category === 'temporary-consumable'
    || taxonomy?.primaryCategory === 'temporary-consumable'
    || definition?.lifecycle?.temporary === true
    || asArray(definition?.classifications).includes('consumable')
    || asArray(taxonomy?.classifications).includes('consumable');
}

function hasMeshBuilder(meshBuilders, id) {
  const value = meshBuilders?.[id];
  return Boolean(value && (typeof value === 'function' || typeof value === 'string' || value.available === true));
}

function checkResult({ id, title, automation = 'automated', severity = 'error', passed = true, messages = [], assets = [], manualPrompt = '' }) {
  return freezeDeep({
    id,
    title,
    automation,
    severity,
    passed: Boolean(passed),
    messages: Object.freeze(messages.map(asString).filter(Boolean)),
    assets: Object.freeze([...new Set(assets.map(asString).filter(Boolean))].sort()),
    manualPrompt,
  });
}

function scanDuplicateCatalogIds(blueprints) {
  const messages = [];
  const assets = [];
  const owners = new Map();
  const aliases = new Map();

  for (const blueprint of asArray(blueprints)) {
    const rawId = asString(blueprint?.id);
    const id = normalizeInputId(rawId);
    if (!id) {
      messages.push('blueprint missing id');
      continue;
    }
    if (owners.has(id)) {
      messages.push(`duplicate catalog id ${id}`);
      assets.push(id);
    }
    owners.set(id, rawId || id);
    for (const aliasValue of asArray(blueprint?.aliases)) {
      const alias = normalizeInputId(aliasValue);
      if (!alias) continue;
      if (alias === id) continue;
      const previous = aliases.get(alias);
      if (previous && previous !== id) {
        messages.push(`alias ${alias} points to both ${previous} and ${id}`);
        assets.push(previous, id);
      }
      aliases.set(alias, id);
    }
  }

  for (const [alias, owner] of aliases.entries()) {
    if (owners.has(alias) && owner !== alias) {
      messages.push(`alias ${alias} collides with canonical catalog id ${alias}`);
      assets.push(alias, owner);
    }
  }

  return checkResult({
    id: 'duplicate-catalog-ids',
    title: 'Duplicate IDs and alias collisions',
    passed: messages.length === 0,
    messages,
    assets,
  });
}

export function buildAssetRegistryQaReport({
  blueprints = CATALOG_REGISTRY_BLUEPRINTS,
  catalogRegistry = null,
  collisionRegistry = null,
  actionLocationRegistry = null,
  contextMenuRegistry = null,
  temporaryLifecycle = null,
  meshBuilders = {},
  includeManualChecks = true,
} = {}) {
  const resolvedCatalog = catalogRegistry || buildCatalogRegistry({ blueprints });
  const resolvedCollision = collisionRegistry || buildCollisionRegistry();
  const resolvedActionLocations = actionLocationRegistry || buildActionLocationRegistry();
  const resolvedContextMenu = contextMenuRegistry || buildContextMenuActionRegistry({ catalogRegistry: resolvedCatalog });
  const resolvedTemporaryLifecycle = temporaryLifecycle || buildTemporaryUseItemLifecycle();
  const entries = getCatalogEntries(resolvedCatalog);
  const checkResults = [];

  checkResults.push(scanDuplicateCatalogIds(blueprints));

  const missingMesh = entries
    .filter(entry => entry.editor?.visibility === 'editor' || entry.editor?.visible)
    .filter(entry => !hasMeshBuilder(meshBuilders, entry.id))
    .map(entry => entry.id);
  checkResults.push(checkResult({
    id: 'mesh-builder-coverage',
    title: 'Mesh builder coverage',
    passed: missingMesh.length === 0,
    messages: missingMesh.map(id => `${id} is editor-visible but has no mesh builder adapter`),
    assets: missingMesh,
  }));

  const missingCollision = entries.filter(entry => {
    const profile = resolvedCollision?.get?.(entry.id) || null;
    return !profile || !Array.isArray(profile.bounds) || profile.bounds.length === 0 || !profile.kind || !profile.routing || !profile.physics;
  }).map(entry => entry.id);
  checkResults.push(checkResult({
    id: 'collision-profile-coverage',
    title: 'Collision profile coverage',
    passed: missingCollision.length === 0,
    messages: missingCollision.map(id => `${id} has no complete collision profile`),
    assets: missingCollision,
  }));

  const missingActionLocations = entries.filter(entry => {
    if (!requiresActionLocation(entry)) return false;
    const profile = resolvedActionLocations?.get?.(entry.id) || null;
    return !profile || !Array.isArray(profile.locations) || profile.locations.length === 0;
  }).map(entry => entry.id);
  checkResults.push(checkResult({
    id: 'action-location-coverage',
    title: 'Action-location coverage',
    passed: missingActionLocations.length === 0,
    messages: missingActionLocations.map(id => `${id} is functional/interactive but has no action locations`),
    assets: missingActionLocations,
  }));

  const invalidCategories = [];
  const categoryMessages = [];
  for (const entry of entries) {
    if (!normalizeObjectCategory(entry.category)) {
      invalidCategories.push(entry.id);
      categoryMessages.push(`${entry.id} has invalid category ${entry.category}`);
    }
    for (const category of asArray(entry.secondaryCategories)) {
      if (!normalizeObjectCategory(category)) {
        invalidCategories.push(entry.id);
        categoryMessages.push(`${entry.id} has invalid secondary category ${category}`);
      }
    }
    if (!CATALOG_REGISTRY_VISIBILITY.includes(entry.editor?.visibility)) {
      invalidCategories.push(entry.id);
      categoryMessages.push(`${entry.id} has invalid editor visibility ${entry.editor?.visibility}`);
    }
  }
  for (const category of asArray(resolvedCatalog?.categories)) {
    if (!OBJECT_CATEGORY_EDITOR_ORDER.includes(category.id)) {
      categoryMessages.push(`registry category ${category.id} is not in editor order`);
    }
  }
  checkResults.push(checkResult({
    id: 'category-validity',
    title: 'Category and visibility validity',
    passed: categoryMessages.length === 0,
    messages: categoryMessages,
    assets: invalidCategories,
  }));

  const missingUi = [];
  const manualUi = [];
  for (const entry of entries) {
    if (definitionRequiresUi(entry)) {
      const actions = resolvedContextMenu?.list?.({ catalogId: entry.id }) || [];
      if (actions.length === 0) missingUi.push(entry.id);
    } else if (isFunctionalEntry(entry) && !getDefinitionForEntry(entry)) {
      manualUi.push(entry.id);
    }
  }
  checkResults.push(checkResult({
    id: 'functional-ui-coverage',
    title: 'Functional object UI coverage',
    passed: missingUi.length === 0,
    messages: [
      ...missingUi.map(id => `${id} has a functional object definition but no context-menu/UI action adapter`),
      ...manualUi.map(id => `${id} is runtime-functional without an object definition; manually confirm UI affordances until promoted`),
    ],
    assets: [...missingUi, ...manualUi],
    severity: missingUi.length ? 'error' : (manualUi.length ? 'warning' : 'error'),
  }));

  const temporaryMessages = [];
  const temporaryAssets = [];
  const cleanupReasons = new Set(asArray(resolvedTemporaryLifecycle?.cleanupReasons || resolvedTemporaryLifecycle?.cleanup?.reasons));
  const examples = asArray(resolvedTemporaryLifecycle?.examples || resolvedTemporaryLifecycle?.temporaryItems || resolvedTemporaryLifecycle?.items);
  const hasConsumeCleanup = cleanupReasons.has('consume') || cleanupReasons.has('use-complete');
  const hasDespawnCleanup = cleanupReasons.has('object-despawn') || cleanupReasons.has('agent-despawn') || cleanupReasons.has('despawn');
  const hasReloadCleanup = cleanupReasons.has('world-reload') || cleanupReasons.has('reload');
  const hasLifecycleCleanup = hasConsumeCleanup && hasDespawnCleanup && hasReloadCleanup;
  for (const entry of entries) {
    if (!isTemporaryEntry(entry)) continue;
    const definition = getDefinitionForEntry(entry);
    const cleanup = definition?.lifecycle?.cleanup || definition?.cleanup || null;
    const entryHasCleanup = hasLifecycleCleanup || (isRecord(cleanup) && cleanup.consume && cleanup.despawn && cleanup.reload);
    if (!entryHasCleanup) {
      temporaryAssets.push(entry.id);
      temporaryMessages.push(`${entry.id} is temporary/consumable but does not prove consume/use, despawn, and reload cleanup`);
    }
  }
  if (examples.some(item => item?.temporary === true || item?.persistenceMode === 'transient') && !hasLifecycleCleanup) {
    temporaryMessages.push('temporary lifecycle examples exist but cleanup reasons do not include consume/use, despawn, and reload coverage');
  }
  checkResults.push(checkResult({
    id: 'temporary-cleanup-coverage',
    title: 'Temporary item cleanup coverage',
    passed: temporaryMessages.length === 0,
    messages: temporaryMessages,
    assets: temporaryAssets,
  }));

  const automated = checkResults.filter(check => check.automation === 'automated');
  const errors = automated.filter(check => !check.passed && check.severity === 'error');
  const warnings = automated.filter(check => check.severity === 'warning' && check.messages.length > 0);
  const manualChecks = includeManualChecks ? ASSET_REGISTRY_QA_MANUAL_CHECKS : Object.freeze([]);

  return freezeDeep({
    version: ASSET_REGISTRY_QA_CHECKS_VERSION,
    valid: errors.length === 0,
    acceptedForAutomatedQa: errors.length === 0,
    summary: {
      totalChecks: checkResults.length,
      passed: checkResults.filter(check => check.passed).length,
      errors: errors.length,
      warnings: warnings.length,
      manualChecks: manualChecks.length,
      affectedAssets: Object.freeze([...new Set(checkResults.flatMap(check => check.assets))].sort()),
    },
    checks: Object.freeze(checkResults),
    manualChecks,
    rules: ASSET_REGISTRY_QA_RULES,
  });
}

export function validateAssetRegistryQaReport(report = {}) {
  const errors = [];
  const warnings = [];
  if (report.version !== ASSET_REGISTRY_QA_CHECKS_VERSION) errors.push(`version must be ${ASSET_REGISTRY_QA_CHECKS_VERSION}`);
  if (!Array.isArray(report.checks)) errors.push('checks must be an array');
  const ids = new Set();
  for (const check of asArray(report.checks)) {
    if (!ASSET_REGISTRY_QA_CHECK_IDS.includes(check.id)) errors.push(`unknown check id ${check.id}`);
    if (ids.has(check.id)) errors.push(`duplicate check id ${check.id}`);
    ids.add(check.id);
    if (!ASSET_REGISTRY_QA_AUTOMATION_KINDS.includes(check.automation)) errors.push(`${check.id} has invalid automation kind`);
    if (!ASSET_REGISTRY_QA_SEVERITIES.includes(check.severity)) errors.push(`${check.id} has invalid severity`);
    if (typeof check.passed !== 'boolean') errors.push(`${check.id}.passed must be boolean`);
    if (!Array.isArray(check.messages)) errors.push(`${check.id}.messages must be an array`);
  }
  for (const id of ASSET_REGISTRY_QA_CHECK_IDS) {
    if (!ids.has(id)) errors.push(`missing check ${id}`);
  }
  for (const manual of asArray(report.manualChecks)) {
    if (!manual.id || !manual.prompt) errors.push('manual check must include id and prompt');
    if (!Array.isArray(manual.covers) || manual.covers.some(id => !ASSET_REGISTRY_QA_CHECK_IDS.includes(id))) {
      errors.push(`${manual.id || '<manual>'} covers unknown automated check`);
    }
  }
  if (report.valid === false && !asArray(report.checks).some(check => !check.passed && check.severity === 'error')) {
    errors.push('invalid report must include at least one failing error check');
  }
  if (report.summary?.warnings > 0 && !asArray(report.checks).some(check => check.severity === 'warning')) {
    warnings.push('summary reports warnings but no warning-severity check was found');
  }
  return freezeDeep({ valid: errors.length === 0, errors, warnings });
}

export function summarizeAssetRegistryQa(report = {}) {
  const checks = asArray(report.checks);
  return freezeDeep({
    version: report.version || ASSET_REGISTRY_QA_CHECKS_VERSION,
    valid: report.valid === true,
    failedChecks: checks.filter(check => !check.passed && check.severity === 'error').map(check => check.id),
    warningChecks: checks.filter(check => check.severity === 'warning' && check.messages.length > 0).map(check => check.id),
    manualChecks: asArray(report.manualChecks).map(check => check.id),
    affectedAssets: Object.freeze([...new Set(checks.flatMap(check => check.assets || []))].sort()),
  });
}

export const DEFAULT_ASSET_REGISTRY_QA_REPORT = buildAssetRegistryQaReport({ includeManualChecks: true });

for (const classification of FUNCTIONAL_CLASSIFICATIONS) {
  if (!OBJECT_CATEGORY_CLASSIFICATIONS.includes(classification)) {
    throw new Error(`Asset registry QA functional classification ${classification} is not in object category classifications`);
  }
}

export default DEFAULT_ASSET_REGISTRY_QA_REPORT;
