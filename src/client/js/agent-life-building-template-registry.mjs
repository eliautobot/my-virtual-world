/**
 * Agent Life building template registry API.
 *
 * This loader/registry is the additive Phase 1 handoff for building templates.
 * It validates template records against the Phase 0 schema, exposes stable ids,
 * and lists/loads templates without replacing current Virtual World building
 * creation, exterior themes, furniture placement, routing, collision, or
 * persistence flows.
 */
import {
  BUILDING_TEMPLATE_EXAMPLES,
  CURRENT_BUILDING_TYPE_IDS,
  CURRENT_EXTERIOR_STYLE_IDS,
  normalizeBuildingTemplateThemeTags,
  validateBuildingTemplate,
} from './agent-life-building-template-schema.mjs';
import { normalizeObjectCatalogId } from './agent-life-object-catalog-schema.mjs';

export const BUILDING_TEMPLATE_REGISTRY_API_VERSION = 'agent-life-building-template-registry/v1';

export const BUILDING_TEMPLATE_REGISTRY_CONTRACT = Object.freeze([
  Object.freeze({ key: 'id', required: true, meaning: 'Stable canonical kebab-case template id used by UI, saves, migrations, and lookup helpers.' }),
  Object.freeze({ key: 'template', required: true, meaning: 'Frozen building template data that validates against the Phase 0 building template schema.' }),
  Object.freeze({ key: 'themeTags', required: true, meaning: 'Normalized theme/capability tags used for browsing and filtering template suggestions.' }),
  Object.freeze({ key: 'runtimeAdapters', required: true, meaning: 'Read-only compatibility flags for current Virtual World building types and exterior theme adapters.' }),
  Object.freeze({ key: 'validation', required: true, meaning: 'Validation result retained for reviewer/debug visibility; invalid templates are rejected by default.' }),
]);

export const BUILDING_TEMPLATE_REGISTRY_RULES = Object.freeze([
  'The registry is a loader/listing API only; importing it must not create buildings, furniture, colliders, routes, actions, or persistence records.',
  'Templates must validate through validateBuildingTemplate() from the Phase 0 schema; the registry does not define a second template shape.',
  'Stable ids are canonical kebab-case template ids. Duplicate ids fail registry construction so UI lists cannot drift.',
  'Current Virtual World BUILDING_TYPES/OUTSIDE_SPACE_TYPES and BUILDING_THEMES remain runtime authorities; adapter flags only report compatibility.',
  'Template suggestions are optional presets and must not restrict mixed-use object placement unless a later policy/admin task adds that behavior deliberately.',
]);

export const TEMPLATE_SUGGESTION_CONNECTION_RULES = Object.freeze([
  'Connected template suggestions may only reference assets that already resolve through the catalog registry.',
  'Connected suggestions must have editor-visible UI metadata and a runtime mesh builder so the user can place the existing asset from the current furniture UI.',
  'Connected suggestions must have scale and collision/routing profiles from the active registries; template wiring must not add a second footprint table.',
  'Connected suggestions must have at least one action location so the suggestion points at an interactable/routable completed asset.',
  'Connected suggestions remain presets only: skipped suggestions are reported for reviewers, but the catalog stays unrestricted for mixed-use placement.',
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function normalizeTemplateRecord(template) {
  const validation = validateBuildingTemplate(template);
  const themeTags = normalizeBuildingTemplateThemeTags(template?.themeTags || []);
  const buildingType = typeof template?.buildingType === 'string' ? template.buildingType : null;
  const exteriorStyle = typeof template?.exteriorStyle === 'string' ? template.exteriorStyle : null;

  return deepFreeze({
    id: template?.id || null,
    name: template?.name || template?.id || 'Untitled Template',
    template,
    themeTags,
    roomKinds: Object.freeze([...new Set(arrayFrom(template?.rooms).map(room => room?.kind).filter(Boolean))].sort()),
    suggestedObjects: Object.freeze([...new Set(arrayFrom(template?.suggestedObjects).filter(Boolean))]),
    suggestedActions: Object.freeze([...new Set(arrayFrom(template?.suggestedActions).filter(Boolean))]),
    runtimeAdapters: Object.freeze({
      buildingType,
      hasCurrentBuildingTypeAdapter: Boolean(buildingType && CURRENT_BUILDING_TYPE_IDS.includes(buildingType)),
      exteriorStyle,
      hasCurrentExteriorStyleAdapter: Boolean(exteriorStyle && CURRENT_EXTERIOR_STYLE_IDS.includes(exteriorStyle)),
      source: 'agent-life-building-template-schema.mjs',
    }),
    validation,
  });
}

function compareTemplateRecords(a, b) {
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function buildBuildingTemplateRegistry({ templates = BUILDING_TEMPLATE_EXAMPLES, allowInvalid = false } = {}) {
  const records = [];
  const byId = new Map();

  for (const template of templates) {
    const record = normalizeTemplateRecord(template);
    if (!record.id) throw new Error('Building template registry entry is missing an id');
    if (byId.has(record.id)) throw new Error(`Duplicate building template registry id ${record.id}`);
    if (!allowInvalid && !record.validation.valid) {
      throw new Error(`Invalid building template ${record.id}: ${record.validation.errors.join('; ')}`);
    }
    records.push(record);
    byId.set(record.id, record);
  }

  const sortedRecords = Object.freeze(records.sort(compareTemplateRecords));

  return deepFreeze({
    version: BUILDING_TEMPLATE_REGISTRY_API_VERSION,
    entries: sortedRecords,
    ids: Object.freeze(sortedRecords.map(record => record.id)),
    get(id) {
      return byId.get(id) || null;
    },
    load(id) {
      return byId.get(id)?.template || null;
    },
    list({ buildingType = null, exteriorStyle = null, themeTag = null, roomKind = null, suggestedObject = null, suggestedAction = null, validOnly = true } = {}) {
      const normalizedThemeTag = themeTag ? normalizeBuildingTemplateThemeTags([themeTag])[0] : null;
      const normalizedRoomKind = normalizeString(roomKind);
      return sortedRecords.filter(record => {
        if (validOnly && !record.validation.valid) return false;
        if (buildingType && record.runtimeAdapters.buildingType !== buildingType) return false;
        if (exteriorStyle && record.runtimeAdapters.exteriorStyle !== exteriorStyle) return false;
        if (normalizedThemeTag && !record.themeTags.includes(normalizedThemeTag)) return false;
        if (normalizedRoomKind && !record.roomKinds.map(kind => kind.toLowerCase()).includes(normalizedRoomKind)) return false;
        if (suggestedObject && !record.suggestedObjects.includes(suggestedObject)) return false;
        if (suggestedAction && !record.suggestedActions.includes(suggestedAction)) return false;
        return true;
      });
    },
  });
}

export function validateBuildingTemplateRegistry(registry) {
  const errors = [];
  if (!registry || registry.version !== BUILDING_TEMPLATE_REGISTRY_API_VERSION) errors.push('registry.version must match BUILDING_TEMPLATE_REGISTRY_API_VERSION');
  if (!Array.isArray(registry?.entries) || registry.entries.length === 0) errors.push('registry.entries must be a non-empty array');
  const ids = new Set();
  for (const entry of registry?.entries || []) {
    if (!entry.id || ids.has(entry.id)) errors.push(`duplicate or missing id ${entry.id || '<missing>'}`);
    ids.add(entry.id);
    if (!entry.template || entry.template.id !== entry.id) errors.push(`${entry.id || '<missing>'}.template.id must match entry.id`);
    if (!entry.validation?.valid) errors.push(`${entry.id || '<missing>'} must have a valid template validation result`);
    if (!Array.isArray(entry.themeTags)) errors.push(`${entry.id || '<missing>'}.themeTags must be an array`);
    if (!entry.runtimeAdapters || typeof entry.runtimeAdapters.hasCurrentBuildingTypeAdapter !== 'boolean') errors.push(`${entry.id || '<missing>'}.runtimeAdapters must include building type compatibility`);
    if (!entry.runtimeAdapters || typeof entry.runtimeAdapters.hasCurrentExteriorStyleAdapter !== 'boolean') errors.push(`${entry.id || '<missing>'}.runtimeAdapters must include exterior style compatibility`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export const BUILDING_TEMPLATE_REGISTRY = buildBuildingTemplateRegistry();

function collectTemplateSuggestedObjectIds(template) {
  const ids = new Set(arrayFrom(template?.suggestedObjects).filter(Boolean));
  for (const room of arrayFrom(template?.rooms)) {
    for (const objectId of arrayFrom(room?.suggestedObjects)) ids.add(objectId);
  }
  return [...ids];
}

function buildSuggestionSupportProfile(objectId, {
  catalogRegistry = null,
  collisionRegistry = null,
  actionLocationRegistry = null,
  meshBuilders = {},
} = {}) {
  const normalizedId = normalizeObjectCatalogId(objectId) || objectId;
  const catalogEntry = catalogRegistry?.get?.(objectId) || catalogRegistry?.get?.(normalizedId) || null;
  const canonicalId = catalogEntry?.id || normalizedId;
  const collisionProfile = collisionRegistry?.get?.(canonicalId) || collisionRegistry?.get?.(objectId) || null;
  const actionProfile = actionLocationRegistry?.get?.(canonicalId) || actionLocationRegistry?.get?.(objectId) || null;
  const meshBuilder = meshBuilders?.[canonicalId] || meshBuilders?.[objectId] || null;
  const checks = Object.freeze({
    catalog: Boolean(catalogEntry),
    editorVisible: Boolean(catalogEntry?.editor?.visible),
    scale: Number.isFinite(catalogEntry?.scale?.halfW) && Number.isFinite(catalogEntry?.scale?.halfD),
    collision: Boolean(collisionProfile?.bounds?.length),
    routing: Boolean(collisionProfile?.routing?.effect),
    actionLocation: Boolean(actionProfile?.locations?.length),
    ui: Boolean(meshBuilder),
    persistence: Boolean(catalogEntry),
  });
  const missing = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  return deepFreeze({
    requestedId: objectId,
    id: canonicalId,
    label: catalogEntry?.label || objectId,
    category: catalogEntry?.category || null,
    tags: Object.freeze([...(catalogEntry?.tags || [])]),
    roomThemes: Object.freeze([...(catalogEntry?.roomThemes || [])]),
    size: catalogEntry?.size || null,
    interactionMode: catalogEntry?.interactionMode || null,
    checks,
    complete: missing.length === 0,
    missing: Object.freeze(missing),
    runtimeAdapters: Object.freeze({
      catalogEntryId: catalogEntry?.id || null,
      collisionProfileId: collisionProfile?.assetId || null,
      actionLocationProfileId: actionProfile?.assetId || null,
      meshBuilder: Boolean(meshBuilder),
      persistenceOwner: 'building.interior.furniture[] via current placed-object flow',
    }),
  });
}

export function connectTemplateSuggestions({
  templateRegistry = BUILDING_TEMPLATE_REGISTRY,
  catalogRegistry = null,
  collisionRegistry = null,
  actionLocationRegistry = null,
  meshBuilders = {},
} = {}) {
  const templates = arrayFrom(templateRegistry?.entries);
  const connections = templates.map((record) => {
    const supportProfiles = collectTemplateSuggestedObjectIds(record.template)
      .map(objectId => buildSuggestionSupportProfile(objectId, { catalogRegistry, collisionRegistry, actionLocationRegistry, meshBuilders }));
    const suggestions = supportProfiles.filter(profile => profile.complete);
    return deepFreeze({
      templateId: record.id,
      templateName: record.name,
      suggestedAssets: Object.freeze(suggestions),
      suggestedAssetIds: Object.freeze(suggestions.map(profile => profile.id)),
      skippedAssets: Object.freeze(supportProfiles.filter(profile => !profile.complete)),
      isRestrictive: false,
      source: 'BUILDING_TEMPLATE_REGISTRY + runtime catalog/collision/action-location/UI adapters',
    });
  });
  const byTemplateId = new Map(connections.map(connection => [connection.templateId, connection]));
  return deepFreeze({
    version: 'agent-life-template-suggestion-connections/v1',
    rules: TEMPLATE_SUGGESTION_CONNECTION_RULES,
    connections: Object.freeze(connections),
    get(templateId) {
      return byTemplateId.get(templateId) || null;
    },
    list({ withSuggestionsOnly = false } = {}) {
      return connections.filter(connection => !withSuggestionsOnly || connection.suggestedAssets.length > 0);
    },
  });
}

export function validateTemplateSuggestionConnections(connections) {
  const errors = [];
  if (!connections || connections.version !== 'agent-life-template-suggestion-connections/v1') errors.push('connections.version must match agent-life-template-suggestion-connections/v1');
  if (!Array.isArray(connections?.connections)) errors.push('connections.connections must be an array');
  for (const connection of connections?.connections || []) {
    if (!connection.templateId) errors.push('connection.templateId is required');
    if (connection.isRestrictive !== false) errors.push(`${connection.templateId} suggestions must be non-restrictive presets`);
    for (const suggestion of connection.suggestedAssets || []) {
      if (!suggestion.complete) errors.push(`${connection.templateId}.${suggestion.id} must be complete before connecting`);
      for (const [key, passed] of Object.entries(suggestion.checks || {})) {
        if (!passed) errors.push(`${connection.templateId}.${suggestion.id} missing ${key}`);
      }
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
