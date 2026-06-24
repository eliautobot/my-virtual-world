// File-backed Colyseus room for authoritative live-agent runtime snapshots.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Room } from '@colyseus/core';
import { MapSchema, Schema, defineTypes } from '@colyseus/schema';

export const AGENT_RUNTIME_SCHEMA_VERSION = 'agent-runtime/v1';
export const AGENT_RUNTIME_ROOM_NAME = 'agent_runtime';
export const DEFAULT_ROUTE_LEASE_TTL_MS = 15000;
export const MAX_ROUTE_LEASE_TTL_MS = 60000;
export const STALE_ROUTE_LEASE_SWEEP_MS = 1000;
export const MAX_RUNTIME_EVENTS = 500;
export const MAX_VISUAL_STATE_JSON_CHARS = 6000;
export const MAX_WORLD_OBJECT_DATA_JSON_CHARS = 10000;

const AGENT_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const SAFE_TEXT_RE = /^[A-Za-z0-9_.:/@# -]{0,160}$/;
const WORLD_OBJECT_KEY_RE = /^[A-Za-z0-9_.:/@# -]{1,160}$/;
const ACTIVE_WORLD_OBJECT_STATES = new Set(['reserved', 'routing', 'active', 'using', 'occupied', 'queued', 'cooldown']);

export class AgentRuntimeSnapshot extends Schema {
  constructor(seed = {}) {
    super();
    this.agentId = '';
    this.mode = 'scripted';
    this.owner = 'agent-scripted-mode';
    this.x = 0;
    this.y = 0;
    this.floor = 1;
    this.buildingId = '';
    this.roomId = '';
    this.heading = 0;
    this.state = 'idle';
    this.targetJson = '';
    this.visualStateJson = '';
    this.routeId = '';
    this.worldActionId = '';
    this.leaseOwner = '';
    this.leaseExpiresAt = '';
    this.updatedAt = '';
    this.version = 0;
    Object.assign(this, seed);
  }
}

defineTypes(AgentRuntimeSnapshot, {
  agentId: 'string',
  mode: 'string',
  owner: 'string',
  x: 'number',
  y: 'number',
  floor: 'number',
  buildingId: 'string',
  roomId: 'string',
  heading: 'number',
  state: 'string',
  targetJson: 'string',
  visualStateJson: 'string',
  routeId: 'string',
  worldActionId: 'string',
  leaseOwner: 'string',
  leaseExpiresAt: 'string',
  updatedAt: 'string',
  version: 'number',
});

export class WorldRuntimeObjectState extends Schema {
  constructor(seed = {}) {
    super();
    this.objectKey = '';
    this.owner = '';
    this.objectType = '';
    this.buildingId = '';
    this.furnitureIndex = -1;
    this.state = 'idle';
    this.agentId = '';
    this.actionId = '';
    this.reservationId = '';
    this.activeUseId = '';
    this.slotId = '';
    this.dataJson = '';
    this.expiresAt = '';
    this.updatedAt = '';
    this.version = 0;
    Object.assign(this, seed);
  }
}

defineTypes(WorldRuntimeObjectState, {
  objectKey: 'string',
  owner: 'string',
  objectType: 'string',
  buildingId: 'string',
  furnitureIndex: 'number',
  state: 'string',
  agentId: 'string',
  actionId: 'string',
  reservationId: 'string',
  activeUseId: 'string',
  slotId: 'string',
  dataJson: 'string',
  expiresAt: 'string',
  updatedAt: 'string',
  version: 'number',
});

export class AgentRuntimeState extends Schema {
  constructor(seed = {}) {
    super();
    this.schemaVersion = AGENT_RUNTIME_SCHEMA_VERSION;
    this.worldId = 'default';
    this.updatedAt = new Date(0).toISOString();
    this.eventSeq = 0;
    this.agents = new MapSchema();
    this.objects = new MapSchema();
    Object.assign(this, seed);
  }
}

defineTypes(AgentRuntimeState, {
  schemaVersion: 'string',
  worldId: 'string',
  updatedAt: 'string',
  eventSeq: 'number',
  agents: { map: AgentRuntimeSnapshot },
  objects: { map: WorldRuntimeObjectState },
});

export function runtimeFilePath(dataDir = process.env.VW_DATA_DIR || '.local-data') {
  return join(dataDir || '.local-data', 'agent-runtime.json');
}

export function stateToPlain(state, events = []) {
  const agents = {};
  for (const [agentId, agent] of state.agents.entries()) {
    agents[agentId] = snapshotToPlain(agent);
  }
  const objects = {};
  for (const [objectKey, object] of state.objects.entries()) {
    objects[objectKey] = worldObjectToPlain(object);
  }
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    worldId: state.worldId || 'default',
    updatedAt: state.updatedAt || new Date().toISOString(),
    eventSeq: Number(state.eventSeq || 0),
    agents,
    objects,
    events: events.slice(-MAX_RUNTIME_EVENTS),
  };
}

export function snapshotToPlain(agent) {
  const plain = {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    agentId: agent.agentId,
    mode: agent.mode || 'scripted',
    owner: agent.owner || 'agent-scripted-mode',
    x: Number(agent.x || 0),
    y: Number(agent.y || 0),
    floor: Number(agent.floor || 1),
    buildingId: agent.buildingId || '',
    roomId: agent.roomId || '',
    heading: Number(agent.heading || 0),
    state: agent.state || 'idle',
    routeId: agent.routeId || '',
    worldActionId: agent.worldActionId || '',
    leaseOwner: agent.leaseOwner || '',
    leaseExpiresAt: agent.leaseExpiresAt || '',
    updatedAt: agent.updatedAt || '',
    version: Number(agent.version || 0),
  };
  if (agent.targetJson) {
    try {
      plain.target = JSON.parse(agent.targetJson);
    } catch {
      plain.target = null;
    }
  } else {
    plain.target = null;
  }
  if (agent.visualStateJson) {
    try {
      plain.visualState = JSON.parse(agent.visualStateJson);
    } catch {
      plain.visualState = null;
    }
  } else {
    plain.visualState = null;
  }
  return plain;
}

export function worldObjectToPlain(object) {
  const plain = {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    objectKey: object.objectKey,
    owner: object.owner || '',
    objectType: object.objectType || '',
    buildingId: object.buildingId || '',
    furnitureIndex: Number(object.furnitureIndex ?? -1),
    state: object.state || 'idle',
    agentId: object.agentId || '',
    actionId: object.actionId || '',
    reservationId: object.reservationId || '',
    activeUseId: object.activeUseId || '',
    slotId: object.slotId || '',
    expiresAt: object.expiresAt || '',
    updatedAt: object.updatedAt || '',
    version: Number(object.version || 0),
  };
  if (object.dataJson) {
    try {
      plain.data = JSON.parse(object.dataJson);
    } catch {
      plain.data = null;
    }
  } else {
    plain.data = null;
  }
  return plain;
}

export function readRuntimeDocument(dataDir = process.env.VW_DATA_DIR || '.local-data') {
  const file = runtimeFilePath(dataDir);
  if (!existsSync(file)) {
    return emptyRuntimeDocument();
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return normalizeRuntimeDocument(parsed);
  } catch (error) {
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      renameSync(file, `${file}.corrupt-${suffix}`);
    } catch {
      // Best effort only. The sidecar can still recover with an empty state.
    }
    return { ...emptyRuntimeDocument(), recoveredFromCorruptFile: true, recoveryError: String(error?.message || error) };
  }
}

export function writeRuntimeDocument(dataDir, state, events = []) {
  const file = runtimeFilePath(dataDir);
  const doc = stateToPlain(state, events);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, file);
  return doc;
}

function emptyRuntimeDocument() {
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    worldId: 'default',
    updatedAt: new Date(0).toISOString(),
    eventSeq: 0,
    agents: {},
    objects: {},
    events: [],
  };
}

function normalizeRuntimeDocument(raw) {
  const doc = emptyRuntimeDocument();
  if (!raw || typeof raw !== 'object') return doc;
  doc.worldId = safeText(raw.worldId, 'default');
  doc.updatedAt = safeIso(raw.updatedAt, doc.updatedAt);
  doc.eventSeq = Math.max(0, Math.floor(numberOr(raw.eventSeq, 0)));
  const rawAgents = raw.agents && typeof raw.agents === 'object' ? raw.agents : {};
  for (const [agentId, record] of Object.entries(rawAgents)) {
    try {
      const normalized = normalizeSnapshot({ ...record, agentId });
      doc.agents[normalized.agentId] = normalized;
    } catch {
      // Drop malformed agent records while preserving the rest of the runtime file.
    }
  }
  const rawObjects = raw.objects && typeof raw.objects === 'object' ? raw.objects : {};
  for (const [objectKey, record] of Object.entries(rawObjects)) {
    try {
      const normalized = normalizeWorldObjectState({ ...record, objectKey });
      doc.objects[normalized.objectKey] = normalized;
    } catch {
      // Drop malformed object records while preserving the rest of the runtime file.
    }
  }
  if (Array.isArray(raw.events)) {
    doc.events = raw.events.slice(-MAX_RUNTIME_EVENTS).filter((event) => event && typeof event === 'object');
  }
  return doc;
}

function stateFromDocument(doc) {
  const state = new AgentRuntimeState({
    worldId: safeText(doc.worldId, 'default'),
    updatedAt: safeIso(doc.updatedAt, new Date(0).toISOString()),
    eventSeq: Math.max(0, Math.floor(numberOr(doc.eventSeq, 0))),
  });
  for (const snapshot of Object.values(doc.agents || {})) {
    state.agents.set(snapshot.agentId, schemaSnapshotFromPlain(snapshot));
  }
  for (const object of Object.values(doc.objects || {})) {
    state.objects.set(object.objectKey, schemaWorldObjectFromPlain(object));
  }
  return state;
}

function schemaSnapshotFromPlain(plain) {
  return new AgentRuntimeSnapshot({
    agentId: plain.agentId,
    mode: plain.mode,
    owner: plain.owner,
    x: plain.x,
    y: plain.y,
    floor: plain.floor,
    buildingId: plain.buildingId,
    roomId: plain.roomId,
    heading: plain.heading,
    state: plain.state,
    targetJson: plain.target ? JSON.stringify(plain.target) : '',
    visualStateJson: plain.visualState ? JSON.stringify(plain.visualState) : '',
    routeId: plain.routeId,
    worldActionId: plain.worldActionId,
    leaseOwner: plain.leaseOwner,
    leaseExpiresAt: plain.leaseExpiresAt,
    updatedAt: plain.updatedAt,
    version: plain.version,
  });
}

function schemaWorldObjectFromPlain(plain) {
  return new WorldRuntimeObjectState({
    objectKey: plain.objectKey,
    owner: plain.owner,
    objectType: plain.objectType,
    buildingId: plain.buildingId,
    furnitureIndex: plain.furnitureIndex,
    state: plain.state,
    agentId: plain.agentId,
    actionId: plain.actionId,
    reservationId: plain.reservationId,
    activeUseId: plain.activeUseId,
    slotId: plain.slotId,
    dataJson: plain.data ? JSON.stringify(plain.data) : '',
    expiresAt: plain.expiresAt,
    updatedAt: plain.updatedAt,
    version: plain.version,
  });
}

function normalizeSnapshot(raw, existing = null) {
  if (!raw || typeof raw !== 'object') {
    throw apiError('invalid_payload', 'runtime snapshot payload must be an object');
  }
  const existingPlain = existing ? snapshotToPlain(existing) : {};
  const agentId = normalizeAgentId(raw.agentId || existingPlain.agentId);
  const now = new Date().toISOString();
  const target = Object.hasOwn(raw, 'target') ? normalizeTarget(raw.target) : (existingPlain.target || null);
  const visualState = Object.hasOwn(raw, 'visualState') ? normalizeVisualState(raw.visualState) : (existingPlain.visualState || null);
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    agentId,
    mode: safeText(raw.mode, existingPlain.mode || 'scripted'),
    owner: safeText(raw.owner, existingPlain.owner || 'agent-scripted-mode'),
    x: coordinateOr(raw.x, existingPlain.x || 0, 'x'),
    y: coordinateOr(raw.y, existingPlain.y || 0, 'y'),
    floor: floorOr(raw.floor, existingPlain.floor || 1),
    buildingId: safeText(raw.buildingId, existingPlain.buildingId || ''),
    roomId: safeText(raw.roomId, existingPlain.roomId || ''),
    heading: headingOr(raw.heading, existingPlain.heading || 0),
    state: safeText(raw.state, existingPlain.state || 'idle'),
    target,
    visualState,
    routeId: safeText(raw.routeId, existingPlain.routeId || ''),
    worldActionId: safeText(raw.worldActionId, existingPlain.worldActionId || ''),
    leaseOwner: safeText(raw.leaseOwner, existingPlain.leaseOwner || ''),
    leaseExpiresAt: raw.leaseExpiresAt === '' ? '' : safeIso(raw.leaseExpiresAt, existingPlain.leaseExpiresAt || ''),
    updatedAt: safeIso(raw.updatedAt, now),
    version: Math.max(0, Math.floor(numberOr(raw.version, existingPlain.version || 0))),
  };
}

function normalizeWorldObjectState(raw, existing = null) {
  if (!raw || typeof raw !== 'object') {
    throw apiError('invalid_payload', 'world object payload must be an object');
  }
  const existingPlain = existing ? worldObjectToPlain(existing) : {};
  const objectKey = normalizeWorldObjectKey(raw.objectKey || existingPlain.objectKey);
  const now = new Date().toISOString();
  const data = Object.hasOwn(raw, 'data') ? normalizeWorldObjectData(raw.data) : (existingPlain.data || null);
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    objectKey,
    owner: safeText(raw.owner, existingPlain.owner || ''),
    objectType: safeText(raw.objectType, existingPlain.objectType || ''),
    buildingId: safeText(raw.buildingId, existingPlain.buildingId || ''),
    furnitureIndex: raw.furnitureIndex === '' || raw.furnitureIndex === null || raw.furnitureIndex === undefined
      ? -1
      : Math.max(-1, Math.floor(numberOr(raw.furnitureIndex, existingPlain.furnitureIndex ?? -1))),
    state: safeText(raw.state, existingPlain.state || 'idle'),
    agentId: safeText(raw.agentId, existingPlain.agentId || ''),
    actionId: safeText(raw.actionId, existingPlain.actionId || ''),
    reservationId: safeText(raw.reservationId, existingPlain.reservationId || ''),
    activeUseId: safeText(raw.activeUseId, existingPlain.activeUseId || ''),
    slotId: safeText(raw.slotId, existingPlain.slotId || ''),
    data,
    expiresAt: raw.expiresAt === '' ? '' : safeIso(raw.expiresAt, existingPlain.expiresAt || ''),
    updatedAt: safeIso(raw.updatedAt, now),
    version: Math.max(0, Math.floor(numberOr(raw.version, existingPlain.version || 0))),
  };
}

function normalizeWorldObjectData(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = sanitizeVisualValue(value, 0);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const json = JSON.stringify(normalized);
  if (json.length > MAX_WORLD_OBJECT_DATA_JSON_CHARS) {
    throw apiError('invalid_world_object_data', 'world object data is too large');
  }
  return normalized;
}

function normalizeVisualState(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = sanitizeVisualValue(value, 0);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const json = JSON.stringify(normalized);
  if (json.length > MAX_VISUAL_STATE_JSON_CHARS) {
    throw apiError('invalid_visual_state', 'visualState is too large');
  }
  return normalized;
}

function sanitizeVisualValue(value, depth = 0) {
  if (depth > 5) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return coordinateOr(value, 0, 'visual');
  if (typeof value === 'string') return safeText(value, '');
  if (Array.isArray(value)) {
    return value.slice(0, 24).map(item => sanitizeVisualValue(item, depth + 1)).filter(item => item !== null && item !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (!SAFE_TEXT_RE.test(key) || key.length > 80) continue;
      const normalized = sanitizeVisualValue(item, depth + 1);
      if (normalized !== null && normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  return null;
}

function normalizeTarget(target) {
  if (target === null || target === undefined || target === '') return null;
  if (typeof target !== 'object' || Array.isArray(target)) {
    throw apiError('invalid_target', 'route target must be an object');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(target)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      normalized[key] = coordinateOr(value, 0, key);
    } else if (typeof value === 'boolean') {
      normalized[key] = value;
    } else if (typeof value === 'string') {
      normalized[key] = safeText(value, '');
    }
  }
  return normalized;
}

function normalizeAgentId(agentId) {
  const value = String(agentId || '').trim();
  if (!AGENT_ID_RE.test(value)) {
    throw apiError('invalid_agent_id', 'agentId must be 1-80 letters, numbers, dots, colons, underscores, or hyphens');
  }
  return value;
}

function normalizeWorldObjectKey(objectKey) {
  const value = String(objectKey || '').trim();
  if (!WORLD_OBJECT_KEY_RE.test(value)) {
    throw apiError('invalid_object_key', 'objectKey must be 1-160 safe characters');
  }
  return value;
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function coordinateOr(value, fallback, field) {
  const number = numberOr(value, fallback);
  if (!Number.isFinite(number) || Math.abs(number) > 10000000) {
    throw apiError('invalid_coordinate', `${field} must be a finite coordinate`);
  }
  return number;
}

function floorOr(value, fallback) {
  const floor = Math.floor(numberOr(value, fallback));
  if (!Number.isFinite(floor) || floor < -100 || floor > 1000) {
    throw apiError('invalid_floor', 'floor must be a reasonable integer');
  }
  return floor;
}

function headingOr(value, fallback) {
  const heading = numberOr(value, fallback);
  if (!Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

function safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim().slice(0, 160);
  return SAFE_TEXT_RE.test(text) ? text : fallback;
}

function safeIso(value, fallback = '') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function apiError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function hasActiveLease(agent, nowMs = Date.now()) {
  if (!agent?.leaseOwner || !agent?.leaseExpiresAt) return false;
  const expires = Date.parse(agent.leaseExpiresAt);
  return Number.isFinite(expires) && expires > nowMs;
}

function hasExpiredLease(agent, nowMs = Date.now()) {
  if (!agent?.leaseOwner || !agent?.leaseExpiresAt) return false;
  const expires = Date.parse(agent.leaseExpiresAt);
  return !Number.isFinite(expires) || expires <= nowMs;
}

function hasActiveWorldObjectState(object, nowMs = Date.now()) {
  if (!object || !ACTIVE_WORLD_OBJECT_STATES.has(String(object.state || '').toLowerCase())) return false;
  if (!object.expiresAt) return true;
  const expires = Date.parse(object.expiresAt);
  return Number.isFinite(expires) && expires > nowMs;
}

function leaseTtlMs(value) {
  const ttl = Math.floor(numberOr(value, DEFAULT_ROUTE_LEASE_TTL_MS));
  return Math.min(MAX_ROUTE_LEASE_TTL_MS, Math.max(1000, ttl));
}

function requestIdFrom(message) {
  return safeText(message?.requestId, '');
}

export class AgentRuntimeRoom extends Room {
  onCreate(options = {}) {
    this.dataDir = options.dataDir || process.env.VW_DATA_DIR || '.local-data';
    this.events = [];
    const doc = readRuntimeDocument(this.dataDir);
    this.events = Array.isArray(doc.events) ? doc.events.slice(-MAX_RUNTIME_EVENTS) : [];
    this.setState(stateFromDocument(doc));

    this.onMessage('runtime:snapshot', (client, message) => this.handleSnapshot(client, message));
    this.onMessage('runtime:worldObject', (client, message) => this.handleWorldObject(client, message));
    this.onMessage('runtime:claimRoute', (client, message) => this.handleClaimRoute(client, message));
    this.onMessage('runtime:heartbeat', (client, message) => this.handleHeartbeat(client, message));
    this.onMessage('runtime:releaseRoute', (client, message) => this.handleReleaseRoute(client, message));
    this.clock.setInterval(() => this.expireStaleRouteLeases(), STALE_ROUTE_LEASE_SWEEP_MS);
  }

  onJoin(client) {
    this.expireStaleRouteLeases();
    client.send('runtime:welcome', {
      sessionId: client.sessionId,
      room: AGENT_RUNTIME_ROOM_NAME,
      serverTime: new Date().toISOString(),
      snapshot: stateToPlain(this.state, this.events),
    });
  }

  runtimeDocument() {
    return stateToPlain(this.state, this.events);
  }

  handleSnapshot(client, message = {}) {
    this.withErrors(client, message, 'runtime:snapshot', () => {
      this.expireStaleRouteLeases();
      const raw = message.snapshot && typeof message.snapshot === 'object' ? message.snapshot : message;
      const agentId = normalizeAgentId(raw.agentId);
      const existing = this.state.agents.get(agentId);
      if (existing && hasActiveLease(existing)) {
        const leaseOwner = safeText(raw.leaseOwner || message.leaseOwner, '');
        if (leaseOwner !== existing.leaseOwner) {
          throw apiError('lease_conflict', 'snapshot cannot overwrite an active route lease', {
            agentId,
            leaseOwner: existing.leaseOwner,
            leaseExpiresAt: existing.leaseExpiresAt,
          });
        }
      }
      const agent = this.upsertSnapshot(raw, 'snapshot');
      this.ack(client, message, 'runtime:snapshot', agent);
    });
  }

  handleWorldObject(client, message = {}) {
    this.withErrors(client, message, 'runtime:worldObject', () => {
      const raw = message.object && typeof message.object === 'object' ? message.object : message;
      const objectKey = normalizeWorldObjectKey(raw.objectKey);
      const existing = this.state.objects.get(objectKey);
      const nextOwner = safeText(raw.owner, client.sessionId || '');
      const nextAgentId = safeText(raw.agentId, '');
      if (existing && hasActiveWorldObjectState(existing)) {
        const existingPlain = worldObjectToPlain(existing);
        const sameOwner = nextOwner && existingPlain.owner && nextOwner === existingPlain.owner;
        const sameAgent = nextAgentId && existingPlain.agentId && nextAgentId === existingPlain.agentId;
        const nextState = safeText(raw.state, existingPlain.state || '');
        const nextActive = ACTIVE_WORLD_OBJECT_STATES.has(String(nextState || '').toLowerCase());
        if (nextActive && !sameOwner && !sameAgent) {
          throw apiError('object_state_conflict', 'world object is active in another runtime owner', {
            objectKey,
            owner: existingPlain.owner || '',
            agentId: existingPlain.agentId || '',
            state: existingPlain.state || '',
            expiresAt: existingPlain.expiresAt || '',
          });
        }
      }
      const object = this.upsertWorldObject(raw, 'world-object-updated');
      this.ackWorldObject(client, message, 'runtime:worldObject', object);
    });
  }

  handleClaimRoute(client, message = {}) {
    this.withErrors(client, message, 'runtime:claimRoute', () => {
      this.expireStaleRouteLeases();
      const agentId = normalizeAgentId(message.agentId);
      const leaseOwner = safeText(message.leaseOwner, client.sessionId || '');
      if (!leaseOwner) throw apiError('invalid_lease_owner', 'leaseOwner is required');
      const existing = this.state.agents.get(agentId);
      if (existing && hasActiveLease(existing) && existing.leaseOwner !== leaseOwner) {
        throw apiError('lease_conflict', 'agent already has an active route lease', {
          agentId,
          leaseOwner: existing.leaseOwner,
          leaseExpiresAt: existing.leaseExpiresAt,
        });
      }
      const leaseExpiresAt = new Date(Date.now() + leaseTtlMs(message.ttlMs)).toISOString();
      const agent = this.upsertSnapshot({
        agentId,
        mode: message.mode,
        owner: message.owner,
        state: message.state || 'routing',
        routeId: message.routeId,
        worldActionId: message.worldActionId,
        target: message.target,
        leaseOwner,
        leaseExpiresAt,
      }, 'route-claimed');
      this.ack(client, message, 'runtime:claimRoute', agent);
    });
  }

  handleHeartbeat(client, message = {}) {
    this.withErrors(client, message, 'runtime:heartbeat', () => {
      this.expireStaleRouteLeases();
      const agentId = normalizeAgentId(message.agentId);
      const leaseOwner = safeText(message.leaseOwner, client.sessionId || '');
      const existing = this.state.agents.get(agentId);
      if (!existing || !hasActiveLease(existing)) {
        throw apiError('lease_required', 'heartbeat requires an active route lease');
      }
      if (existing.leaseOwner !== leaseOwner) {
        throw apiError('lease_conflict', 'heartbeat leaseOwner does not match the active lease', {
          agentId,
          leaseOwner: existing.leaseOwner,
          leaseExpiresAt: existing.leaseExpiresAt,
        });
      }
      const agent = this.upsertSnapshot({
        ...message,
        agentId,
        leaseOwner,
        leaseExpiresAt: new Date(Date.now() + leaseTtlMs(message.ttlMs)).toISOString(),
        state: message.state || 'routing',
      }, 'heartbeat');
      this.ack(client, message, 'runtime:heartbeat', agent);
    });
  }

  handleReleaseRoute(client, message = {}) {
    this.withErrors(client, message, 'runtime:releaseRoute', () => {
      this.expireStaleRouteLeases();
      const agentId = normalizeAgentId(message.agentId);
      const leaseOwner = safeText(message.leaseOwner, client.sessionId || '');
      const existing = this.state.agents.get(agentId);
      if (existing && hasActiveLease(existing) && existing.leaseOwner !== leaseOwner) {
        throw apiError('lease_conflict', 'release leaseOwner does not match the active lease', {
          agentId,
          leaseOwner: existing.leaseOwner,
          leaseExpiresAt: existing.leaseExpiresAt,
        });
      }
      const releaseSnapshot = {
        agentId,
        state: message.state || 'idle',
        routeId: '',
        worldActionId: '',
        target: null,
        leaseOwner: '',
        leaseExpiresAt: '',
      };
      if (Object.hasOwn(message, 'visualState')) releaseSnapshot.visualState = message.visualState;
      const agent = this.upsertSnapshot(releaseSnapshot, 'route-released', {
        reason: safeText(message.reason, ''),
      });
      this.ack(client, message, 'runtime:releaseRoute', agent);
    });
  }

  expireStaleRouteLeases(nowMs = Date.now()) {
    let expired = 0;
    for (const [agentId, existing] of this.state.agents.entries()) {
      if (!hasExpiredLease(existing, nowMs)) continue;
      const before = snapshotToPlain(existing);
      this.upsertSnapshot({
        agentId,
        state: 'idle',
        routeId: '',
        worldActionId: '',
        target: null,
        leaseOwner: '',
        leaseExpiresAt: '',
      }, 'route-lease-expired', {
        expiredLeaseOwner: before.leaseOwner || '',
        expiredLeaseExpiresAt: before.leaseExpiresAt || '',
      });
      expired++;
    }
    return expired;
  }

  upsertSnapshot(raw, eventType, extra = {}) {
    const existing = this.state.agents.get(raw.agentId);
    const normalized = normalizeSnapshot(raw, existing || null);
    normalized.version = Number(existing?.version || 0) + 1;
    normalized.updatedAt = new Date().toISOString();
    const agent = schemaSnapshotFromPlain(normalized);
    this.state.agents.set(agent.agentId, agent);
    this.state.updatedAt = normalized.updatedAt;
    const event = this.recordEvent(eventType, agent.agentId, snapshotToPlain(agent), extra);
    writeRuntimeDocument(this.dataDir, this.state, this.events);
    return { agent, event };
  }

  upsertWorldObject(raw, eventType, extra = {}) {
    const existing = this.state.objects.get(raw.objectKey);
    const normalized = normalizeWorldObjectState(raw, existing || null);
    normalized.version = Number(existing?.version || 0) + 1;
    normalized.updatedAt = new Date().toISOString();
    const object = schemaWorldObjectFromPlain(normalized);
    this.state.objects.set(object.objectKey, object);
    this.state.updatedAt = normalized.updatedAt;
    const event = this.recordEvent(eventType, object.objectKey, worldObjectToPlain(object), extra);
    writeRuntimeDocument(this.dataDir, this.state, this.events);
    return { object, event };
  }

  recordEvent(type, agentId, snapshot, extra = {}) {
    this.state.eventSeq = Number(this.state.eventSeq || 0) + 1;
    const event = {
      seq: this.state.eventSeq,
      type,
      agentId,
      at: new Date().toISOString(),
      snapshotVersion: snapshot.version,
      ...extra,
    };
    this.events.push(event);
    this.events = this.events.slice(-MAX_RUNTIME_EVENTS);
    this.broadcast('runtime:event', event);
    return event;
  }

  ack(client, message, type, result) {
    client.send('runtime:ack', {
      requestId: requestIdFrom(message),
      type,
      ok: true,
      agentId: result.agent.agentId,
      snapshot: snapshotToPlain(result.agent),
      event: result.event,
    });
  }

  ackWorldObject(client, message, type, result) {
    client.send('runtime:ack', {
      requestId: requestIdFrom(message),
      type,
      ok: true,
      objectKey: result.object.objectKey,
      object: worldObjectToPlain(result.object),
      event: result.event,
    });
  }

  withErrors(client, message, type, fn) {
    try {
      fn();
    } catch (error) {
      client.send('runtime:error', {
        requestId: requestIdFrom(message),
        type,
        ok: false,
        code: error?.code || 'runtime_error',
        message: error?.message || String(error),
        details: error?.details || {},
      });
    }
  }
}
