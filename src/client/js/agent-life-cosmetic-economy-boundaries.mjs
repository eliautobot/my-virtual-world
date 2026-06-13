/**
 * Agent Life cosmetic economy boundaries.
 *
 * XP, credits, inventory, titles, badges, emotes, decor, and other progression
 * systems are cosmetic/flavor metadata only. They must never grant real
 * OpenClaw tool access, file authority, API authority, model intelligence,
 * skill deployment, host/admin permissions, or Virtual World permission levels.
 *
 * This module is additive guardrail/config data plus validation helpers. Importing
 * it must not mutate profiles, spend credits, award XP, create objects/actions,
 * change permissions, call APIs, touch files, deploy skills, or open admin paths.
 */
import { APPEARANCE_CATALOG } from './agent-characters.js';
import {
  CAPABILITY_TAGS,
  normalizeCapabilityTag,
} from './agent-life-capability-tags.mjs';
import {
  WORLD_PERMISSION_BOUNDARY,
  PERMISSION_LEVELS,
} from './agent-life-permission-model.mjs';

export const COSMETIC_ECONOMY_BOUNDARY_VERSION = 'agent-life-cosmetic-economy-boundaries/v1';

export const COSMETIC_ECONOMY_BOUNDARY = 'cosmetic-economy-only';

export const ECONOMY_CURRENCIES = Object.freeze(['credits', 'xp']);

export const COSMETIC_ECONOMY_ALLOWED_EFFECTS = Object.freeze([
  'appearance',
  'decor',
  'ritual',
  'emote',
  'title',
  'badge',
  'idle-flair',
  'profile-flavor',
]);

export const COSMETIC_ECONOMY_DENIED_EFFECTS = Object.freeze([
  'tool-access',
  'file-authority',
  'api-authority',
  'host-permission',
  'server-admin',
  'admin-permission',
  'permission-level',
  'model-access',
  'intelligence',
  'skill-deployment',
  'real-capability',
]);

export const ECONOMY_AUTHORITY_GRANT_KEYS = Object.freeze([
  'tools',
  'toolAccess',
  'fileAuthority',
  'files',
  'apiAuthority',
  'apiScopes',
  'hostPermissions',
  'serverAdmin',
  'adminPermissions',
  'permissions',
  'permissionLevel',
  'modelAccess',
  'intelligence',
  'skills',
  'skillDeployment',
  'realAuthority',
]);

export const COSMETIC_ECONOMY_PROFILE_FIELDS = Object.freeze([
  'economy.credits',
  'economy.xp',
  'cosmetics.inventory',
  'cosmetics.selected',
  'profile.titles',
  'profile.badges',
  'profile.emotes',
  'profile.idleFlair',
]);

export const CURRENT_APPEARANCE_CATALOG_GROUPS = Object.freeze(Object.keys(APPEARANCE_CATALOG).sort());

export const COSMETIC_ECONOMY_REUSE_SOURCES = Object.freeze([
  Object.freeze({ source: 'agent-characters.js#APPEARANCE_CATALOG', decision: 'reuse', reason: 'Current avatar appearance choices remain the source for visible cosmetic unlock categories.' }),
  Object.freeze({ source: 'agent-life-capability-tags.mjs#appearance.*', decision: 'reuse', reason: 'Appearance capability tags already describe cosmetic preview/customize/display flows.' }),
  Object.freeze({ source: 'agent-life-permission-model.mjs', decision: 'adapt', reason: 'Economy validation imports the world/cosmetic permission boundary and refuses permission-level unlocks.' }),
  Object.freeze({ source: 'main3d.js current profile/appearance editor', decision: 'skip-runtime-change', reason: 'Task 8 adds guardrails only; it does not rewrite profile persistence or spend/award credits.' }),
]);

export const COSMETIC_ECONOMY_VALIDATION_EXPECTATIONS = Object.freeze([
  'XP and credits may unlock only cosmetic/flavor effects: appearance, decor, rituals, emotes, titles, badges, idle flair, and profile flavor.',
  'XP and credits must never unlock real tool access, file authority, API authority, host/server/admin permissions, model access, intelligence, skills, or skill deployment.',
  'Economy unlocks must not set or raise Virtual World permission levels; permissions remain governed by the Task 7 permission model.',
  'Cosmetic economy fields are profile/inventory metadata only and must not mutate OpenClaw tools, files, API scopes, model settings, admin panels, or server sessions.',
  'Appearance unlocks reuse the existing APPEARANCE_CATALOG and appearance capability tags instead of creating a competing cosmetic system.',
  'Validation helpers return boundary metadata and realAuthorityGranted: false for every result.',
  'Importing this module is side-effect free: no credits are awarded/spent, no permissions change, and no runtime objects/actions are created.',
]);

export const COSMETIC_ECONOMY_BOUNDARY_RULES = Object.freeze({
  version: COSMETIC_ECONOMY_BOUNDARY_VERSION,
  boundary: COSMETIC_ECONOMY_BOUNDARY,
  permissionBoundary: WORLD_PERMISSION_BOUNDARY,
  currencies: ECONOMY_CURRENCIES,
  allowedEffects: COSMETIC_ECONOMY_ALLOWED_EFFECTS,
  deniedEffects: COSMETIC_ECONOMY_DENIED_EFFECTS,
  authorityGrantKeys: ECONOMY_AUTHORITY_GRANT_KEYS,
  profileFields: COSMETIC_ECONOMY_PROFILE_FIELDS,
  appearanceCatalogGroups: CURRENT_APPEARANCE_CATALOG_GROUPS,
});

const APPEARANCE_EFFECT_GROUPS = Object.freeze(['appearance']);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEffect(effect) {
  return normalizeString(effect).toLowerCase();
}

function hasPresentGrantValue(value) {
  if (value === undefined || value === null || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function isCosmeticEconomyEffect(effect) {
  return COSMETIC_ECONOMY_ALLOWED_EFFECTS.includes(normalizeEffect(effect));
}

export function isDeniedEconomyEffect(effect) {
  return COSMETIC_ECONOMY_DENIED_EFFECTS.includes(normalizeEffect(effect));
}

export function listEconomyAuthorityGrantKeys(record = {}) {
  if (!isRecord(record)) return Object.freeze([]);
  return Object.freeze(ECONOMY_AUTHORITY_GRANT_KEYS.filter(key => hasPresentGrantValue(record[key])));
}

export function normalizeEconomyUnlock(unlock = {}) {
  const raw = isRecord(unlock) ? unlock : {};
  const effect = normalizeEffect(raw.effect || raw.effectKind || raw.kind || 'profile-flavor');
  const currency = normalizeString(raw.currency).toLowerCase() || null;
  const capabilityTag = raw.capabilityTag ? normalizeCapabilityTag(raw.capabilityTag) : null;
  return Object.freeze({
    id: normalizeString(raw.id) || null,
    effect,
    currency,
    capabilityTag,
    cosmeticOnly: raw.cosmeticOnly !== false,
    permissionLevel: normalizeString(raw.permissionLevel || raw.permission || ''),
    grants: isRecord(raw.grants) ? Object.freeze({ ...raw.grants }) : Object.freeze({}),
    source: normalizeString(raw.source) || null,
  });
}

export function validateEconomyUnlock(unlock = {}) {
  const errors = [];
  const warnings = [];
  const normalized = normalizeEconomyUnlock(unlock);

  if (!isRecord(unlock)) errors.push('economy unlock must be an object');
  if (!normalized.id) warnings.push('id is recommended for migration-safe cosmetic inventory records');
  if (!isCosmeticEconomyEffect(normalized.effect)) errors.push(`effect must be cosmetic-only: ${COSMETIC_ECONOMY_ALLOWED_EFFECTS.join(', ')}`);
  if (isDeniedEconomyEffect(normalized.effect)) errors.push(`effect ${normalized.effect} is explicitly denied for XP/credits`);
  if (normalized.currency && !ECONOMY_CURRENCIES.includes(normalized.currency)) errors.push(`currency must be one of ${ECONOMY_CURRENCIES.join(', ')}`);
  if (normalized.cosmeticOnly !== true) errors.push('cosmeticOnly must be true or absent');
  if (normalized.permissionLevel) errors.push('permissionLevel/permission must not be set by economy unlocks');
  if (normalized.capabilityTag && !CAPABILITY_TAGS.includes(normalized.capabilityTag)) errors.push(`capabilityTag must be a known Agent Life capability tag: ${normalized.capabilityTag}`);
  if (normalized.capabilityTag && !normalized.capabilityTag.startsWith('appearance.') && APPEARANCE_EFFECT_GROUPS.includes(normalized.effect)) {
    errors.push('appearance economy unlocks must use an appearance.* capability tag when a capabilityTag is present');
  }

  const rootGrantKeys = listEconomyAuthorityGrantKeys(unlock);
  const nestedGrantKeys = listEconomyAuthorityGrantKeys(normalized.grants).map(key => `grants.${key}`);
  const authorityGrantKeys = Object.freeze([...rootGrantKeys, ...nestedGrantKeys]);
  if (authorityGrantKeys.length > 0) errors.push(`economy unlock must not grant authority fields: ${authorityGrantKeys.join(', ')}`);

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    normalized,
    boundary: COSMETIC_ECONOMY_BOUNDARY,
    permissionBoundary: WORLD_PERMISSION_BOUNDARY,
    realAuthorityGranted: false,
  });
}

export function assertEconomyBoundary(unlock = {}) {
  const validation = validateEconomyUnlock(unlock);
  if (!validation.valid) {
    const error = new Error(`Invalid cosmetic economy unlock: ${validation.errors.join('; ')}`);
    error.validation = validation;
    throw error;
  }
  return validation;
}

export function canEconomyAffectPermissionLevel(_permissionLevel) {
  return false;
}

export function isPermissionLevelEconomyMutable(permissionLevel) {
  return PERMISSION_LEVELS.includes(permissionLevel) ? false : false;
}

export const COSMETIC_ECONOMY_EXAMPLES = Object.freeze([
  Object.freeze({
    id: 'unlock-hair-bun',
    effect: 'appearance',
    currency: 'credits',
    capabilityTag: 'appearance.customize',
    cosmeticOnly: true,
    source: 'agent-characters.js#APPEARANCE_CATALOG.hairStyles',
  }),
  Object.freeze({
    id: 'badge-launch-helper',
    effect: 'badge',
    currency: 'xp',
    cosmeticOnly: true,
    source: 'profile.badges',
  }),
  Object.freeze({
    id: 'deny-admin-from-credits',
    effect: 'admin-permission',
    currency: 'credits',
    cosmeticOnly: false,
    permissionLevel: 'admin',
    grants: Object.freeze({ adminPermissions: Object.freeze(['server.restart']) }),
    source: 'negative-guardrail-example',
  }),
]);

for (const example of COSMETIC_ECONOMY_EXAMPLES.filter(example => example.id !== 'deny-admin-from-credits')) {
  const validation = validateEconomyUnlock(example);
  if (!validation.valid) throw new Error(`Invalid cosmetic economy example ${example.id}: ${validation.errors.join('; ')}`);
}

const deniedExample = validateEconomyUnlock(COSMETIC_ECONOMY_EXAMPLES.find(example => example.id === 'deny-admin-from-credits'));
if (deniedExample.valid) throw new Error('Denied cosmetic economy guardrail example unexpectedly validated');
