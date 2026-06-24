// File-backed Colyseus room for authoritative live-agent runtime snapshots.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Room } from '@colyseus/core';
import { Encoder, MapSchema, Schema, defineTypes } from '@colyseus/schema';

export const AGENT_RUNTIME_SCHEMA_VERSION = 'agent-runtime/v1';
export const WORLD_RUNTIME_SCHEMA_VERSION = 'world-runtime/v1';
export const AGENT_RUNTIME_ROOM_NAME = 'agent_runtime';
export const DEFAULT_AGENT_RUNTIME_SCHEMA_BUFFER_SIZE_BYTES = 256 * 1024;
export const DEFAULT_ROUTE_LEASE_TTL_MS = 15000;
export const MAX_ROUTE_LEASE_TTL_MS = 60000;
export const STALE_ROUTE_LEASE_SWEEP_MS = 1000;
export const DEFAULT_WORLD_RUNTIME_TICK_MS = 500;
export const WORLD_RUNTIME_PERSIST_INTERVAL_MS = 5000;
export const WORLD_RUNTIME_TRAFFIC_CYCLE_MS = 40000;
export const WORLD_RUNTIME_TRAFFIC_YELLOW_MS = 3000;
export const WORLD_RUNTIME_TRAFFIC_ALL_RED_MS = 2000;
export const WORLD_RUNTIME_TOPOLOGY_OWNER_TTL_MS = 30000;
export const MAX_WORLD_RUNTIME_TRAFFIC_LIGHTS = 500;
export const MAX_WORLD_RUNTIME_TRAFFIC_VEHICLES = 80;
export const MAX_RUNTIME_EVENTS = 500;
export const MAX_VISUAL_STATE_JSON_CHARS = 6000;
export const MAX_WORLD_OBJECT_DATA_JSON_CHARS = 10000;

const configuredSchemaBufferSize = Number(process.env.VW_REALTIME_SCHEMA_BUFFER_SIZE_BYTES || DEFAULT_AGENT_RUNTIME_SCHEMA_BUFFER_SIZE_BYTES);
Encoder.BUFFER_SIZE = Math.max(
  Number(Encoder.BUFFER_SIZE || 0),
  Number.isFinite(configuredSchemaBufferSize) && configuredSchemaBufferSize > 0
    ? configuredSchemaBufferSize
    : DEFAULT_AGENT_RUNTIME_SCHEMA_BUFFER_SIZE_BYTES,
);

const AGENT_ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
const SAFE_TEXT_RE = /^[A-Za-z0-9_.:/@# -]{0,160}$/;
const WORLD_OBJECT_KEY_RE = /^[A-Za-z0-9_.:/@#, -]{1,160}$/;
const ACTIVE_WORLD_OBJECT_STATES = new Set(['reserved', 'routing', 'active', 'using', 'occupied', 'queued', 'cooldown']);

export class WorldRuntimeTrafficLightState extends Schema {
  constructor(seed = {}) {
    super();
    this.key = '';
    this.ix = 0;
    this.iz = 0;
    this.type = '';
    this.openEdgesJson = '';
    this.phaseMs = 0;
    this.ns = 'green';
    this.ew = 'red';
    this.updatedAt = '';
    this.version = 0;
    Object.assign(this, seed);
  }
}

defineTypes(WorldRuntimeTrafficLightState, {
  key: 'string',
  ix: 'number',
  iz: 'number',
  type: 'string',
  openEdgesJson: 'string',
  phaseMs: 'number',
  ns: 'string',
  ew: 'string',
  updatedAt: 'string',
  version: 'number',
});

export class WorldRuntimeTrafficVehicleState extends Schema {
  constructor(seed = {}) {
    super();
    this.vehicleId = '';
    this.vehicleType = 'car';
    this.color = 0;
    this.x = 0;
    this.z = 0;
    this.dir = 0;
    this.rotationY = 0;
    this.speed = 0;
    this.speedMult = 1;
    this.pathJson = '';
    this.pathIdx = 0;
    this.state = 'moving';
    this.updatedAt = '';
    this.version = 0;
    Object.assign(this, seed);
  }
}

defineTypes(WorldRuntimeTrafficVehicleState, {
  vehicleId: 'string',
  vehicleType: 'string',
  color: 'number',
  x: 'number',
  z: 'number',
  dir: 'number',
  rotationY: 'number',
  speed: 'number',
  speedMult: 'number',
  pathJson: 'string',
  pathIdx: 'number',
  state: 'string',
  updatedAt: 'string',
  version: 'number',
});

export class WorldRuntimeState extends Schema {
  constructor(seed = {}) {
    super();
    this.schemaVersion = WORLD_RUNTIME_SCHEMA_VERSION;
    this.mode = 'server-authoritative';
    this.tickMs = DEFAULT_WORLD_RUNTIME_TICK_MS;
    this.tickSeq = 0;
    this.simTimeMs = 0;
    this.startedAt = new Date().toISOString();
    this.updatedAt = new Date(0).toISOString();
    this.topologyHash = '';
    this.topologyOwner = '';
    this.topologyUpdatedAt = '';
    this.trafficCycleMs = WORLD_RUNTIME_TRAFFIC_CYCLE_MS;
    this.trafficYellowMs = WORLD_RUNTIME_TRAFFIC_YELLOW_MS;
    this.trafficAllRedMs = WORLD_RUNTIME_TRAFFIC_ALL_RED_MS;
    this.trafficLights = new MapSchema();
    this.trafficVehicles = new MapSchema();
    Object.assign(this, seed);
  }
}

defineTypes(WorldRuntimeState, {
  schemaVersion: 'string',
  mode: 'string',
  tickMs: 'number',
  tickSeq: 'number',
  simTimeMs: 'number',
  startedAt: 'string',
  updatedAt: 'string',
  topologyHash: 'string',
  topologyOwner: 'string',
  topologyUpdatedAt: 'string',
  trafficCycleMs: 'number',
  trafficYellowMs: 'number',
  trafficAllRedMs: 'number',
  trafficLights: { map: WorldRuntimeTrafficLightState },
  trafficVehicles: { map: WorldRuntimeTrafficVehicleState },
});

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
    this.worldRuntime = new WorldRuntimeState();
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
  worldRuntime: WorldRuntimeState,
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
    worldRuntime: worldRuntimeToPlain(state.worldRuntime),
    agents,
    objects,
    events: events.slice(-MAX_RUNTIME_EVENTS),
  };
}

export function worldRuntimeToPlain(worldRuntime) {
  const trafficLights = {};
  for (const [key, light] of (worldRuntime?.trafficLights?.entries?.() || [])) {
    trafficLights[key] = trafficLightToPlain(light);
  }
  const trafficVehicles = {};
  for (const [vehicleId, vehicle] of (worldRuntime?.trafficVehicles?.entries?.() || [])) {
    trafficVehicles[vehicleId] = trafficVehicleToPlain(vehicle);
  }
  return {
    schemaVersion: WORLD_RUNTIME_SCHEMA_VERSION,
    mode: worldRuntime?.mode || 'server-authoritative',
    tickMs: Number(worldRuntime?.tickMs || DEFAULT_WORLD_RUNTIME_TICK_MS),
    tickSeq: Number(worldRuntime?.tickSeq || 0),
    simTimeMs: Number(worldRuntime?.simTimeMs || 0),
    startedAt: worldRuntime?.startedAt || '',
    updatedAt: worldRuntime?.updatedAt || '',
    topologyHash: worldRuntime?.topologyHash || '',
    topologyOwner: worldRuntime?.topologyOwner || '',
    topologyUpdatedAt: worldRuntime?.topologyUpdatedAt || '',
    trafficCycleMs: Number(worldRuntime?.trafficCycleMs || WORLD_RUNTIME_TRAFFIC_CYCLE_MS),
    trafficYellowMs: Number(worldRuntime?.trafficYellowMs || WORLD_RUNTIME_TRAFFIC_YELLOW_MS),
    trafficAllRedMs: Number(worldRuntime?.trafficAllRedMs || WORLD_RUNTIME_TRAFFIC_ALL_RED_MS),
    trafficLights,
    trafficVehicles,
  };
}

export function trafficLightToPlain(light) {
  const plain = {
    key: light.key,
    ix: Number(light.ix || 0),
    iz: Number(light.iz || 0),
    type: light.type || '',
    phaseMs: Number(light.phaseMs || 0),
    ns: light.ns || 'green',
    ew: light.ew || 'red',
    updatedAt: light.updatedAt || '',
    version: Number(light.version || 0),
  };
  if (light.openEdgesJson) {
    try {
      plain.openEdges = JSON.parse(light.openEdgesJson);
    } catch {
      plain.openEdges = null;
    }
  } else {
    plain.openEdges = null;
  }
  return plain;
}

export function trafficVehicleToPlain(vehicle) {
  const plain = {
    vehicleId: vehicle.vehicleId,
    vehicleType: vehicle.vehicleType || 'car',
    color: Number(vehicle.color || 0),
    x: Number(vehicle.x || 0),
    z: Number(vehicle.z || 0),
    dir: Number(vehicle.dir || 0),
    rotationY: Number(vehicle.rotationY || 0),
    speed: Number(vehicle.speed || 0),
    speedMult: Number(vehicle.speedMult || 1),
    pathIdx: Number(vehicle.pathIdx || 0),
    state: vehicle.state || 'moving',
    updatedAt: vehicle.updatedAt || '',
    version: Number(vehicle.version || 0),
  };
  if (vehicle.pathJson) {
    try {
      plain.path = JSON.parse(vehicle.pathJson);
    } catch {
      plain.path = [];
    }
  } else {
    plain.path = [];
  }
  return plain;
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
    worldRuntime: worldRuntimeToPlain(new WorldRuntimeState()),
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
  doc.worldRuntime = normalizeWorldRuntime(raw.worldRuntime || {});
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
    worldRuntime: schemaWorldRuntimeFromPlain(doc.worldRuntime || {}),
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

function schemaWorldRuntimeFromPlain(plain) {
  const normalized = normalizeWorldRuntime(plain || {});
  const worldRuntime = new WorldRuntimeState({
    schemaVersion: WORLD_RUNTIME_SCHEMA_VERSION,
    mode: normalized.mode,
    tickMs: normalized.tickMs,
    tickSeq: normalized.tickSeq,
    simTimeMs: normalized.simTimeMs,
    startedAt: normalized.startedAt,
    updatedAt: normalized.updatedAt,
    topologyHash: normalized.topologyHash,
    topologyOwner: normalized.topologyOwner,
    topologyUpdatedAt: normalized.topologyUpdatedAt,
    trafficCycleMs: normalized.trafficCycleMs,
    trafficYellowMs: normalized.trafficYellowMs,
    trafficAllRedMs: normalized.trafficAllRedMs,
  });
  for (const light of Object.values(normalized.trafficLights || {})) {
    worldRuntime.trafficLights.set(light.key, schemaTrafficLightFromPlain(light));
  }
  for (const vehicle of Object.values(normalized.trafficVehicles || {})) {
    worldRuntime.trafficVehicles.set(vehicle.vehicleId, schemaTrafficVehicleFromPlain(vehicle));
  }
  return worldRuntime;
}

function schemaTrafficLightFromPlain(plain) {
  return new WorldRuntimeTrafficLightState({
    key: plain.key,
    ix: plain.ix,
    iz: plain.iz,
    type: plain.type,
    openEdgesJson: plain.openEdges ? JSON.stringify(plain.openEdges) : '',
    phaseMs: plain.phaseMs,
    ns: plain.ns,
    ew: plain.ew,
    updatedAt: plain.updatedAt,
    version: plain.version,
  });
}

function schemaTrafficVehicleFromPlain(plain) {
  return new WorldRuntimeTrafficVehicleState({
    vehicleId: plain.vehicleId,
    vehicleType: plain.vehicleType,
    color: plain.color,
    x: plain.x,
    z: plain.z,
    dir: plain.dir,
    rotationY: plain.rotationY,
    speed: plain.speed,
    speedMult: plain.speedMult,
    pathJson: Array.isArray(plain.path) ? JSON.stringify(plain.path) : '',
    pathIdx: plain.pathIdx,
    state: plain.state,
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

function normalizeWorldRuntime(raw = {}) {
  const now = new Date().toISOString();
  const trafficCycleMs = clampInteger(raw.trafficCycleMs, WORLD_RUNTIME_TRAFFIC_CYCLE_MS, 10000, 180000);
  const trafficYellowMs = clampInteger(raw.trafficYellowMs, WORLD_RUNTIME_TRAFFIC_YELLOW_MS, 1000, 20000);
  const trafficAllRedMs = clampInteger(raw.trafficAllRedMs, WORLD_RUNTIME_TRAFFIC_ALL_RED_MS, 500, 20000);
  const rawLights = raw.trafficLights && typeof raw.trafficLights === 'object' ? raw.trafficLights : {};
  const trafficLights = {};
  for (const [fallbackKey, light] of Object.entries(rawLights).slice(0, MAX_WORLD_RUNTIME_TRAFFIC_LIGHTS)) {
    try {
      const normalized = normalizeTrafficLightState({
        ...light,
        key: light?.key || fallbackKey,
      }, { trafficCycleMs, trafficYellowMs, trafficAllRedMs });
      trafficLights[normalized.key] = normalized;
    } catch {
      // Ignore malformed topology/light records while preserving the rest.
    }
  }
  const rawVehicles = raw.trafficVehicles && typeof raw.trafficVehicles === 'object' ? raw.trafficVehicles : {};
  const trafficVehicles = {};
  for (const [fallbackId, vehicle] of Object.entries(rawVehicles).slice(0, MAX_WORLD_RUNTIME_TRAFFIC_VEHICLES)) {
    try {
      const normalized = normalizeTrafficVehicleState({
        ...vehicle,
        vehicleId: vehicle?.vehicleId || fallbackId,
      });
      trafficVehicles[normalized.vehicleId] = normalized;
    } catch {
      // Ignore malformed vehicle records while preserving other runtime state.
    }
  }
  return {
    schemaVersion: WORLD_RUNTIME_SCHEMA_VERSION,
    mode: safeText(raw.mode, 'server-authoritative'),
    tickMs: clampInteger(raw.tickMs, DEFAULT_WORLD_RUNTIME_TICK_MS, 100, 5000),
    tickSeq: Math.max(0, Math.floor(numberOr(raw.tickSeq, 0))),
    simTimeMs: Math.max(0, Math.floor(numberOr(raw.simTimeMs, 0))),
    startedAt: safeIso(raw.startedAt, now),
    updatedAt: safeIso(raw.updatedAt, new Date(0).toISOString()),
    topologyHash: safeText(raw.topologyHash, ''),
    topologyOwner: safeText(raw.topologyOwner, ''),
    topologyUpdatedAt: safeIso(raw.topologyUpdatedAt, ''),
    trafficCycleMs,
    trafficYellowMs,
    trafficAllRedMs,
    trafficLights,
    trafficVehicles,
  };
}

function normalizeTrafficLightState(raw = {}, runtime = {}) {
  const key = normalizeWorldObjectKey(raw.key);
  const cycleMs = clampInteger(runtime.trafficCycleMs ?? raw.trafficCycleMs, WORLD_RUNTIME_TRAFFIC_CYCLE_MS, 10000, 180000);
  const phaseMs = positiveModulo(Math.floor(numberOr(raw.phaseMs, deterministicPhaseMs(key, cycleMs))), cycleMs);
  const signal = computeTrafficSignal(phaseMs, {
    trafficCycleMs: cycleMs,
    trafficYellowMs: clampInteger(runtime.trafficYellowMs ?? raw.trafficYellowMs, WORLD_RUNTIME_TRAFFIC_YELLOW_MS, 1000, 20000),
    trafficAllRedMs: clampInteger(runtime.trafficAllRedMs ?? raw.trafficAllRedMs, WORLD_RUNTIME_TRAFFIC_ALL_RED_MS, 500, 20000),
  });
  return {
    key,
    ix: Math.floor(numberOr(raw.ix, 0)),
    iz: Math.floor(numberOr(raw.iz, 0)),
    type: safeText(raw.type, ''),
    openEdges: normalizeOpenEdges(raw.openEdges),
    phaseMs,
    ns: signal.ns,
    ew: signal.ew,
    updatedAt: safeIso(raw.updatedAt, ''),
    version: Math.max(0, Math.floor(numberOr(raw.version, 0))),
  };
}

function normalizeTrafficVehicleState(raw = {}) {
  const vehicleId = normalizeWorldObjectKey(raw.vehicleId);
  const path = normalizeVehiclePath(raw.path);
  const pathIdx = clampInteger(raw.pathIdx, path.length > 1 ? 1 : 0, 0, Math.max(0, path.length - 1));
  const dir = clampInteger(raw.dir, 0, 0, 3);
  return {
    vehicleId,
    vehicleType: safeText(raw.vehicleType, 'car') || 'car',
    color: Math.max(0, Math.floor(numberOr(raw.color, 0))),
    x: coordinateOr(raw.x, path[0]?.x || 0, 'vehicle.x'),
    z: coordinateOr(raw.z, path[0]?.z || 0, 'vehicle.z'),
    dir,
    rotationY: coordinateOr(raw.rotationY, dirToRotationY(dir), 'vehicle.rotationY'),
    speed: Math.max(0, Math.min(100, numberOr(raw.speed, 7))),
    speedMult: Math.max(0.1, Math.min(4, numberOr(raw.speedMult, 1))),
    path,
    pathIdx,
    state: safeText(raw.state, 'moving') || 'moving',
    updatedAt: safeIso(raw.updatedAt, ''),
    version: Math.max(0, Math.floor(numberOr(raw.version, 0))),
  };
}

function normalizeVehiclePath(value = []) {
  if (!Array.isArray(value)) return [];
  const path = [];
  for (const point of value.slice(0, 80)) {
    if (!point || typeof point !== 'object') continue;
    const x = numberOr(point.x, NaN);
    const z = numberOr(point.z, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 10000000 || Math.abs(z) > 10000000) continue;
    path.push({ x, z });
  }
  return path;
}

function normalizeOpenEdges(value = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    n: value.n !== false,
    s: value.s !== false,
    e: value.e !== false,
    w: value.w !== false,
  };
}

function computeTrafficSignal(phaseMs, runtime = {}) {
  const cycleMs = clampInteger(runtime.trafficCycleMs, WORLD_RUNTIME_TRAFFIC_CYCLE_MS, 10000, 180000);
  const yellowMs = clampInteger(runtime.trafficYellowMs, WORLD_RUNTIME_TRAFFIC_YELLOW_MS, 1000, 20000);
  const allRedMs = clampInteger(runtime.trafficAllRedMs, WORLD_RUNTIME_TRAFFIC_ALL_RED_MS, 500, 20000);
  const halfCycle = cycleMs / 2;
  const greenMs = Math.max(1000, halfCycle - yellowMs - allRedMs);
  const phase = positiveModulo(phaseMs, cycleMs);
  if (phase < greenMs) return { ns: 'green', ew: 'red' };
  if (phase < greenMs + yellowMs) return { ns: 'yellow', ew: 'red' };
  if (phase < halfCycle) return { ns: 'red', ew: 'red' };
  if (phase < halfCycle + greenMs) return { ns: 'red', ew: 'green' };
  if (phase < halfCycle + greenMs + yellowMs) return { ns: 'red', ew: 'yellow' };
  return { ns: 'red', ew: 'red' };
}

function deterministicPhaseMs(key, cycleMs = WORLD_RUNTIME_TRAFFIC_CYCLE_MS) {
  let hash = 2166136261;
  for (const char of String(key || 'traffic-light')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % Math.max(1, cycleMs);
}

function deterministicTopologyHash(trafficLights = []) {
  const normalized = trafficLights
    .map(light => String(light?.key || `${light?.ix || 0},${light?.iz || 0}`).trim())
    .filter(Boolean)
    .sort()
    .join('|');
  if (!normalized) return '';
  let hash = 2166136261;
  for (const char of normalized) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `traffic:${trafficLights.length}:${hash.toString(36)}`;
}

function dirToRotationY(dir) {
  return [0, Math.PI, -Math.PI / 2, Math.PI / 2][Math.max(0, Math.min(3, Math.floor(numberOr(dir, 0))))] || 0;
}

function directionFromDelta(dx, dz, fallback = 0) {
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return fallback;
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 0 : 1;
  return dz >= 0 ? 2 : 3;
}

function positiveModulo(value, divisor) {
  const d = Math.max(1, Number(divisor || 1));
  return ((Number(value || 0) % d) + d) % d;
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

function clampInteger(value, fallback, min, max) {
  const integer = Math.floor(numberOr(value, fallback));
  if (!Number.isFinite(integer)) return fallback;
  return Math.min(max, Math.max(min, integer));
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

function isManualSnapshotOverride(raw = {}) {
  const mode = safeText(raw.mode, '').toLowerCase();
  const owner = safeText(raw.owner, '').toLowerCase();
  return mode === 'manual' || owner === 'user-directed' || owner.startsWith('user-directed:');
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
    this.lastWorldRuntimePersistMs = 0;
    const doc = readRuntimeDocument(this.dataDir);
    this.events = Array.isArray(doc.events) ? doc.events.slice(-MAX_RUNTIME_EVENTS) : [];
    this.setState(stateFromDocument(doc));

    this.onMessage('runtime:snapshot', (client, message) => this.handleSnapshot(client, message));
    this.onMessage('runtime:worldObject', (client, message) => this.handleWorldObject(client, message));
    this.onMessage('runtime:worldTopology', (client, message) => this.handleWorldTopology(client, message));
    this.onMessage('runtime:claimRoute', (client, message) => this.handleClaimRoute(client, message));
    this.onMessage('runtime:heartbeat', (client, message) => this.handleHeartbeat(client, message));
    this.onMessage('runtime:releaseRoute', (client, message) => this.handleReleaseRoute(client, message));
    this.clock.setInterval(() => this.expireStaleRouteLeases(), STALE_ROUTE_LEASE_SWEEP_MS);
    this.clock.setInterval(() => this.tickWorldRuntime(), DEFAULT_WORLD_RUNTIME_TICK_MS);
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
      if (existing && hasActiveLease(existing) && !isManualSnapshotOverride(raw)) {
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

  handleWorldTopology(client, message = {}) {
    this.withErrors(client, message, 'runtime:worldTopology', () => {
      const raw = message.topology && typeof message.topology === 'object' ? message.topology : message;
      const worldRuntime = this.upsertWorldTopology(raw, client, 'world-topology-updated');
      this.ackWorldRuntime(client, message, 'runtime:worldTopology', worldRuntime);
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
        mode: 'scripted',
        owner: 'agent-scripted-mode',
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
        mode: 'scripted',
        owner: 'agent-scripted-mode',
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

  upsertWorldTopology(raw, client, eventType) {
    const runtime = this.state.worldRuntime || new WorldRuntimeState();
    if (!this.state.worldRuntime) this.state.worldRuntime = runtime;
    const now = new Date().toISOString();
    const owner = safeText(raw.owner, client?.sessionId || '') || safeText(client?.sessionId, 'world-runtime');
    const trafficLights = Array.isArray(raw.trafficLights) ? raw.trafficLights : [];
    const trafficVehicles = Array.isArray(raw.trafficVehicles) ? raw.trafficVehicles : [];
    if (trafficLights.length > MAX_WORLD_RUNTIME_TRAFFIC_LIGHTS) {
      throw apiError('world_topology_too_large', `world topology can include at most ${MAX_WORLD_RUNTIME_TRAFFIC_LIGHTS} traffic lights`);
    }
    if (trafficVehicles.length > MAX_WORLD_RUNTIME_TRAFFIC_VEHICLES) {
      throw apiError('world_topology_too_large', `world topology can include at most ${MAX_WORLD_RUNTIME_TRAFFIC_VEHICLES} traffic vehicles`);
    }
    const previousTopologyHash = runtime.topologyHash || '';
    const nextTopologyHash = safeText(raw.topologyHash, '') || deterministicTopologyHash(trafficLights);
    const topologyOwnerUpdatedAtMs = Date.parse(runtime.topologyUpdatedAt || runtime.updatedAt || '');
    const topologyOwnerFresh = Number.isFinite(topologyOwnerUpdatedAtMs) && Date.now() - topologyOwnerUpdatedAtMs < WORLD_RUNTIME_TOPOLOGY_OWNER_TTL_MS;
    if (runtime.topologyOwner &&
      runtime.topologyOwner !== owner &&
      runtime.topologyHash === nextTopologyHash &&
      topologyOwnerFresh) {
      const event = this.recordEvent('world-topology-skipped-owner-fresh', 'worldRuntime', worldRuntimeToPlain(runtime), {
        topologyHash: runtime.topologyHash,
        topologyOwner: runtime.topologyOwner,
        skippedOwner: owner,
      });
      return { worldRuntime: runtime, event };
    }
    runtime.mode = 'server-authoritative';
    runtime.tickMs = clampInteger(raw.tickMs, runtime.tickMs || DEFAULT_WORLD_RUNTIME_TICK_MS, 100, 5000);
    runtime.trafficCycleMs = clampInteger(raw.trafficCycleMs, runtime.trafficCycleMs || WORLD_RUNTIME_TRAFFIC_CYCLE_MS, 10000, 180000);
    runtime.trafficYellowMs = clampInteger(raw.trafficYellowMs, runtime.trafficYellowMs || WORLD_RUNTIME_TRAFFIC_YELLOW_MS, 1000, 20000);
    runtime.trafficAllRedMs = clampInteger(raw.trafficAllRedMs, runtime.trafficAllRedMs || WORLD_RUNTIME_TRAFFIC_ALL_RED_MS, 500, 20000);
    runtime.topologyHash = nextTopologyHash;
    runtime.topologyOwner = owner;
    runtime.topologyUpdatedAt = now;
    runtime.updatedAt = now;

    const seen = new Set();
    for (const rawLight of trafficLights) {
      const light = normalizeTrafficLightState(rawLight, runtime);
      const existing = runtime.trafficLights.get(light.key);
      seen.add(light.key);
      const schemaLight = schemaTrafficLightFromPlain({
        ...light,
        phaseMs: existing ? Number(existing.phaseMs || 0) : light.phaseMs,
        ns: existing?.ns || light.ns,
        ew: existing?.ew || light.ew,
        updatedAt: now,
        version: Number(existing?.version || 0) + 1,
      });
      runtime.trafficLights.set(light.key, schemaLight);
    }
    for (const key of Array.from(runtime.trafficLights.keys())) {
      if (!seen.has(key)) runtime.trafficLights.delete(key);
    }
    const shouldSeedVehicles = trafficVehicles.length > 0 && (runtime.trafficVehicles.size === 0 || previousTopologyHash !== runtime.topologyHash);
    if (shouldSeedVehicles) {
      runtime.trafficVehicles.clear();
      for (const rawVehicle of trafficVehicles) {
        const vehicle = normalizeTrafficVehicleState(rawVehicle);
        runtime.trafficVehicles.set(vehicle.vehicleId, schemaTrafficVehicleFromPlain({
          ...vehicle,
          updatedAt: now,
          version: 1,
        }));
      }
    }

    this.state.updatedAt = now;
    const event = this.recordEvent(eventType, 'worldRuntime', worldRuntimeToPlain(runtime), {
      topologyHash: runtime.topologyHash,
      trafficLightCount: runtime.trafficLights.size,
      trafficVehicleCount: runtime.trafficVehicles.size,
    });
    writeRuntimeDocument(this.dataDir, this.state, this.events);
    return { worldRuntime: runtime, event };
  }

  tickWorldRuntime(nowMs = Date.now()) {
    const runtime = this.state.worldRuntime;
    if (!runtime) return null;
    const tickMs = clampInteger(runtime.tickMs, DEFAULT_WORLD_RUNTIME_TICK_MS, 100, 5000);
    const now = new Date(nowMs).toISOString();
    runtime.tickMs = tickMs;
    runtime.tickSeq = Number(runtime.tickSeq || 0) + 1;
    runtime.simTimeMs = Math.max(0, Number(runtime.simTimeMs || 0) + tickMs);
    runtime.updatedAt = now;
    this.state.updatedAt = now;

    let changedLights = 0;
    for (const [, light] of runtime.trafficLights.entries()) {
      const nextPhase = positiveModulo(Number(light.phaseMs || 0) + tickMs, runtime.trafficCycleMs || WORLD_RUNTIME_TRAFFIC_CYCLE_MS);
      const signal = computeTrafficSignal(nextPhase, runtime);
      const changed = light.ns !== signal.ns || light.ew !== signal.ew;
      light.phaseMs = nextPhase;
      if (changed) {
        light.ns = signal.ns;
        light.ew = signal.ew;
        light.updatedAt = now;
        light.version = Number(light.version || 0) + 1;
        changedLights++;
      }
    }
    const changedVehicles = this.tickTrafficVehicles(runtime, tickMs, now);

    if (changedLights > 0 || changedVehicles > 0) {
      this.broadcast('runtime:worldRuntime', {
        type: 'world-runtime-tick',
        worldRuntime: worldRuntimeToPlain(runtime),
        changedLights,
        changedVehicles,
      });
    }

    if (changedLights > 0 || changedVehicles > 0 || nowMs - Number(this.lastWorldRuntimePersistMs || 0) >= WORLD_RUNTIME_PERSIST_INTERVAL_MS) {
      this.lastWorldRuntimePersistMs = nowMs;
      writeRuntimeDocument(this.dataDir, this.state, this.events);
    }
    return runtime;
  }

  tickTrafficVehicles(runtime, tickMs, updatedAt) {
    if (!runtime?.trafficVehicles?.size) return 0;
    let changed = 0;
    for (const [, vehicle] of runtime.trafficVehicles.entries()) {
      let path = [];
      if (vehicle.pathJson) {
        try {
          path = normalizeVehiclePath(JSON.parse(vehicle.pathJson));
        } catch {
          path = [];
        }
      }
      if (path.length < 2 || Number(vehicle.speed || 0) <= 0) {
        vehicle.state = 'idle';
        continue;
      }
      let pathIdx = clampInteger(vehicle.pathIdx, 1, 0, path.length - 1);
      if (pathIdx <= 0) pathIdx = 1;
      if (pathIdx >= path.length) pathIdx = path.length - 1;
      const target = path[pathIdx];
      const dx = target.x - Number(vehicle.x || 0);
      const dz = target.z - Number(vehicle.z || 0);
      const dist = Math.hypot(dx, dz);
      const move = Math.max(0, Number(vehicle.speed || 0) * Number(vehicle.speedMult || 1) * (tickMs / 1000));
      let moved = false;
      if (dist <= Math.max(0.001, move)) {
        vehicle.x = target.x;
        vehicle.z = target.z;
        pathIdx += 1;
        if (pathIdx >= path.length) {
          path = path.slice().reverse();
          vehicle.pathJson = JSON.stringify(path);
          pathIdx = Math.min(1, path.length - 1);
        }
        moved = true;
      } else {
        vehicle.x = Number(vehicle.x || 0) + (dx / dist) * move;
        vehicle.z = Number(vehicle.z || 0) + (dz / dist) * move;
        moved = move > 0;
      }
      const nextTarget = path[Math.max(0, Math.min(pathIdx, path.length - 1))] || target;
      const nextDx = nextTarget.x - Number(vehicle.x || 0);
      const nextDz = nextTarget.z - Number(vehicle.z || 0);
      vehicle.pathIdx = pathIdx;
      vehicle.dir = directionFromDelta(moved ? dx : nextDx, moved ? dz : nextDz, vehicle.dir);
      vehicle.rotationY = dirToRotationY(vehicle.dir);
      vehicle.state = moved ? 'moving' : 'idle';
      vehicle.updatedAt = updatedAt;
      vehicle.version = Number(vehicle.version || 0) + 1;
      changed++;
    }
    return changed;
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

  ackWorldRuntime(client, message, type, result) {
    client.send('runtime:ack', {
      requestId: requestIdFrom(message),
      type,
      ok: true,
      worldRuntime: worldRuntimeToPlain(result.worldRuntime),
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
