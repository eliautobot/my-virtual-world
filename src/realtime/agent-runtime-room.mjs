// File-backed Colyseus room for authoritative live-agent runtime snapshots.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Room } from '@colyseus/core';
import { Encoder, MapSchema, Schema, defineTypes } from '@colyseus/schema';
import {
  configureDynamicInteriorRouting,
  clearDynamicInteriorRoutingForAgent,
  updateDynamicInteriorRouting,
} from '../client/js/dynamic-interior-routing.js';
import {
  configureDynamicExteriorRouting,
  clearDynamicExteriorRoutingForAgent,
  updateDynamicExteriorRouting,
} from '../client/js/dynamic-exterior-routing.js';

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
export const WORLD_RUNTIME_TOPOLOGY_REFRESH_MS = 10000;
export const RUNTIME_STATE_BROADCAST_INTERVAL_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
export const MAX_WORLD_RUNTIME_TRAFFIC_LIGHTS = 500;
export const MAX_WORLD_RUNTIME_TRAFFIC_VEHICLES = 80;
export const MAX_RUNTIME_EVENTS = 500;
export const MAX_VISUAL_STATE_JSON_CHARS = 6000;
export const MAX_WORLD_OBJECT_DATA_JSON_CHARS = 10000;
export const LIVE_ACTION_RUNTIME_OWNER = 'server-live-action-runtime';
export const LIVE_ACTION_RUNTIME_LEASE_OWNER = 'server-runtime';
export const LIVE_ACTION_RUNTIME_POLL_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
export const LIVE_ACTION_RUNTIME_SPEED_UNITS_PER_SEC = 72;
export const LIVE_ACTION_RUNTIME_ARRIVAL_RADIUS = 3;
export const LIVE_ACTION_RUNTIME_DWELL_MS = 5000;
export const LIVE_ACTION_RUNTIME_LEASE_TTL_MS = 10000;
export const LIVE_STATUS_RUNTIME_OWNER = 'server-live-status-runtime';
export const LIVE_STATUS_RUNTIME_LEASE_OWNER = 'server-live-status';
export const LIVE_STATUS_RUNTIME_POLL_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
export const LIVE_STATUS_RUNTIME_SPEED_UNITS_PER_SEC = 96;
export const LIVE_STATUS_RUNTIME_RUN_SPEED_UNITS_PER_SEC = 200;
export const LIVE_STATUS_RUNTIME_ARRIVAL_RADIUS = 6;
export const LIVE_STATUS_RUNTIME_LEASE_TTL_MS = 15000;
export const LIVE_STATUS_RUNTIME_LEASE_REFRESH_MS = 8000;
export const USER_DIRECTED_RUNTIME_LEASE_OWNER = 'user-directed';
export const USER_DIRECTED_RUNTIME_HOLD_MS = 60000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER = 'server-scripted-object-runtime';
export const SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER = 'server-scripted-object';
export const SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_SPEED_UNITS_PER_SEC = 72;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_RUN_SPEED_UNITS_PER_SEC = 200;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS = 5;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS = 15000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_REFRESH_MS = 8000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS = 7000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_COOLDOWN_MS = 12000;
export const SERVER_SCRIPTED_OBJECT_DESK_CONSUME_MS = 16000;
export const SERVER_SCRIPTED_OBJECT_TEMPORARY_ITEM_CARRIED_TTL_MS = 90000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_ACTIVE_ROUTES = 8;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_ROUTE_STEPS_PER_TICK = 4;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_STARTS_PER_TICK = 3;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_IDLE_CHECKS_PER_TICK = 6;
export const SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS = Object.freeze([8000, 20000]);
export const SERVER_SCRIPTED_IDLE_RETRY_DELAY_MS = Object.freeze([3000, 8000]);
export const SERVER_SCRIPTED_IDLE_OBJECT_COOLDOWN_MS = 240000;
export const SERVER_SCRIPTED_IDLE_CATEGORY_COOLDOWN_MS = 180000;
export const SERVER_SCRIPTED_IDLE_FAILED_TARGET_THROTTLE_MS = 90000;
export const LIVE_ACTION_API_TILE = 40;
export const SERVER_WORLD_TOPOLOGY_OWNER = 'server-world-topology-runtime';
export const SERVER_WORLD_TRAFFIC_SPEED = 7;
export const SERVER_WORLD_MAX_TRAFFIC_VEHICLES = 30;

const WORLD_ACTION_SCHEMA_VERSION = 'agent-life-world-action/v1';
const WORLD_ACTION_PERSISTENCE_VERSION = 'agent-life-world-action-persistence/v1';
const WORLD_ACTION_STATE_MACHINE_VERSION = 'agent-life-world-action-lifecycle/v1';
const WORLD_ACTION_ACTIVE_STATUSES = new Set(['requested', 'created', 'reserved', 'route_pending', 'routing', 'arrived', 'in_progress']);
const WORLD_ACTION_TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed', 'expired']);
const WORLD_ACTION_TRANSITIONS = {
  requested: new Set(['created', 'cancelled', 'failed', 'expired']),
  created: new Set(['reserved', 'cancelled', 'failed', 'expired']),
  reserved: new Set(['route_pending', 'cancelled', 'failed', 'expired']),
  route_pending: new Set(['routing', 'cancelled', 'failed', 'expired']),
  routing: new Set(['arrived', 'cancelled', 'failed', 'expired']),
  arrived: new Set(['in_progress', 'cancelled', 'failed', 'expired']),
  in_progress: new Set(['completed', 'cancelled', 'failed', 'expired']),
  completed: new Set(),
  cancelled: new Set(),
  failed: new Set(),
  expired: new Set(),
};

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
const SERVER_WORLD_OBJECT_RUNTIME_OWNERS = new Set([SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER, LIVE_STATUS_RUNTIME_OWNER]);
const SERVER_MANAGED_ROUTE_LEASE_OWNERS = new Set([
  LIVE_ACTION_RUNTIME_LEASE_OWNER,
  LIVE_STATUS_RUNTIME_LEASE_OWNER,
  SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
]);

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

export function worldMetaFilePath(dataDir = process.env.VW_DATA_DIR || '.local-data') {
  return join(dataDir || '.local-data', 'world-meta.json');
}

export function presenceSnapshotFilePath(dataDir = process.env.VW_DATA_DIR || '.local-data') {
  return join(dataDir || '.local-data', 'presence-snapshot.json');
}

function buildingsDirPath(dataDir = process.env.VW_DATA_DIR || '.local-data') {
  return join(dataDir || '.local-data', 'buildings');
}

function buildingFilePath(dataDir, buildingId) {
  return join(buildingsDirPath(dataDir), `${safeFilename(buildingId)}.json`);
}

function chunksDirPath(dataDir = process.env.VW_DATA_DIR || '.local-data') {
  return join(dataDir || '.local-data', 'chunks');
}

function chunkFilePath(dataDir, cx, cz) {
  return join(chunksDirPath(dataDir), `c_${cx}_${cz}.json`);
}

function readJsonFile(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
  return value;
}

function readWorldMetaDocument(dataDir) {
  const meta = readJsonFile(worldMetaFilePath(dataDir), null);
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
}

function readPresenceSnapshotDocument(dataDir) {
  const snapshot = readJsonFile(presenceSnapshotFilePath(dataDir), null);
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
}

function writeWorldMetaDocument(dataDir, meta) {
  return writeJsonFileAtomic(worldMetaFilePath(dataDir), meta && typeof meta === 'object' ? meta : {});
}

function defaultWorldActionsStore() {
  return {
    schemaVersion: WORLD_ACTION_SCHEMA_VERSION,
    persistenceVersion: WORLD_ACTION_PERSISTENCE_VERSION,
    retention: { completedCancelledDays: 7, failedDays: 30, maxHistoryRecords: 1000 },
    active: [],
    history: [],
  };
}

function readWorldActionsStore(dataDir) {
  const meta = readWorldMetaDocument(dataDir);
  const agentLife = meta.agentLife && typeof meta.agentLife === 'object' && !Array.isArray(meta.agentLife)
    ? meta.agentLife
    : {};
  const rawStore = agentLife.worldActions && typeof agentLife.worldActions === 'object' && !Array.isArray(agentLife.worldActions)
    ? agentLife.worldActions
    : {};
  const store = defaultWorldActionsStore();
  if (rawStore.schemaVersion) store.schemaVersion = safeText(rawStore.schemaVersion, store.schemaVersion) || store.schemaVersion;
  if (rawStore.persistenceVersion) store.persistenceVersion = safeText(rawStore.persistenceVersion, store.persistenceVersion) || store.persistenceVersion;
  if (rawStore.retention && typeof rawStore.retention === 'object' && !Array.isArray(rawStore.retention)) {
    store.retention = { ...store.retention, ...rawStore.retention };
  }
  store.active = Array.isArray(rawStore.active) ? rawStore.active.filter(record => record && typeof record === 'object') : [];
  store.history = Array.isArray(rawStore.history) ? rawStore.history.filter(record => record && typeof record === 'object') : [];
  return { meta, store };
}

function writeWorldActionsStore(dataDir, meta, store) {
  const nextMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {};
  const agentLife = nextMeta.agentLife && typeof nextMeta.agentLife === 'object' && !Array.isArray(nextMeta.agentLife)
    ? { ...nextMeta.agentLife }
    : {};
  const previous = agentLife.worldActions && typeof agentLife.worldActions === 'object' && !Array.isArray(agentLife.worldActions)
    ? agentLife.worldActions
    : {};
  agentLife.worldActions = {
    schemaVersion: safeText(store?.schemaVersion || previous.schemaVersion, WORLD_ACTION_SCHEMA_VERSION) || WORLD_ACTION_SCHEMA_VERSION,
    persistenceVersion: safeText(store?.persistenceVersion || previous.persistenceVersion, WORLD_ACTION_PERSISTENCE_VERSION) || WORLD_ACTION_PERSISTENCE_VERSION,
    retention: store?.retention && typeof store.retention === 'object'
      ? store.retention
      : (previous.retention && typeof previous.retention === 'object' ? previous.retention : defaultWorldActionsStore().retention),
    active: Array.isArray(store?.active) ? store.active : [],
    history: Array.isArray(store?.history) ? store.history : [],
    lastSavedAt: new Date().toISOString(),
  };
  nextMeta.agentLife = agentLife;
  return writeWorldMetaDocument(dataDir, nextMeta);
}

function safeFilename(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120) || 'unknown';
}

function cloneJson(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

const SERVER_TERRAIN = Object.freeze({
  GRASS: 0,
  DIRT: 1,
  ROAD: 2,
  SIDEWALK: 3,
  WATER: 4,
  SAND: 5,
  PARKING: 6,
});
const SERVER_CHUNK_SIZE = 32;
const SERVER_STREET_INTERSECTION_ROAD_RADIUS = 4;
const SERVER_STREET_INTERSECTION_SIDEWALK_RADIUS = 6;
const SERVER_VEHICLE_COLORS = Object.freeze([0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0x8e24aa, 0xff6f00, 0x00897b, 0x5c6bc0]);
const SERVER_VEHICLE_TYPES = Object.freeze(['car', 'car', 'car', 'sedan', 'sedan', 'truck', 'van', 'bus']);
const SERVER_VEHICLE_SPEED_MULT = Object.freeze({ car: 1, sedan: 1.05, truck: 0.8, van: 0.85, bus: 0.65 });
const _chunkTerrainCache = new Map();
const _streetSegmentCache = new Map();

function readStreetSegments(dataDir) {
  const file = worldMetaFilePath(dataDir);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return [];
  }
  const cacheKey = `${dataDir || '.local-data'}:${file}`;
  const cached = _streetSegmentCache.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs) return cached.streets;
  const meta = readJsonFile(file, null);
  const streets = Array.isArray(meta?.streets)
    ? meta.streets.filter(segment => segment && typeof segment === 'object')
    : [];
  _streetSegmentCache.set(cacheKey, { mtimeMs, streets });
  return streets;
}

function normalizeStreetSegment(segment = null) {
  if (!segment || typeof segment !== 'object') return null;
  const x1 = Math.round(numberOr(segment.x1, 0));
  const z1 = Math.round(numberOr(segment.z1, 0));
  const x2 = Math.round(numberOr(segment.x2, x1));
  const z2 = Math.round(numberOr(segment.z2, z1));
  return {
    x1,
    z1,
    x2,
    z2,
    type: safeText(segment.type || '', ''),
    rotation: numberOr(segment.rotation, 0),
    openEdges: normalizeOpenEdges(segment.openEdges),
  };
}

function serverStreetTerrainAt(dataDir, wx, wz) {
  const x = Math.round(numberOr(wx, 0));
  const z = Math.round(numberOr(wz, 0));
  let sidewalk = false;
  for (const rawSegment of readStreetSegments(dataDir)) {
    const segment = normalizeStreetSegment(rawSegment);
    if (!segment) continue;
    if (segment.type) {
      const dx = Math.abs(x - segment.x1);
      const dz = Math.abs(z - segment.z1);
      if (dx <= SERVER_STREET_INTERSECTION_ROAD_RADIUS && dz <= SERVER_STREET_INTERSECTION_ROAD_RADIUS) {
        return SERVER_TERRAIN.ROAD;
      }
      if (dx <= SERVER_STREET_INTERSECTION_SIDEWALK_RADIUS && dz <= SERVER_STREET_INTERSECTION_SIDEWALK_RADIUS) {
        sidewalk = true;
      }
      continue;
    }

    const minX = Math.min(segment.x1, segment.x2);
    const maxX = Math.max(segment.x1, segment.x2);
    const minZ = Math.min(segment.z1, segment.z2);
    const maxZ = Math.max(segment.z1, segment.z2);
    const horizontal = Math.abs(segment.x2 - segment.x1) >= Math.abs(segment.z2 - segment.z1);
    if (horizontal) {
      if (x >= minX && x <= maxX) {
        const dz = Math.abs(z - segment.z1);
        if (dz <= 1) return SERVER_TERRAIN.ROAD;
        if (dz <= 3) sidewalk = true;
      }
      if ((Math.abs(x - segment.x1) <= 3 || Math.abs(x - segment.x2) <= 3) && Math.abs(z - segment.z1) <= 3) {
        if (Math.abs(z - segment.z1) <= 1) return SERVER_TERRAIN.ROAD;
        sidewalk = true;
      }
    } else {
      if (z >= minZ && z <= maxZ) {
        const dx = Math.abs(x - segment.x1);
        if (dx <= 1) return SERVER_TERRAIN.ROAD;
        if (dx <= 3) sidewalk = true;
      }
      if ((Math.abs(z - segment.z1) <= 3 || Math.abs(z - segment.z2) <= 3) && Math.abs(x - segment.x1) <= 3) {
        if (Math.abs(x - segment.x1) <= 1) return SERVER_TERRAIN.ROAD;
        sidewalk = true;
      }
    }
  }
  return sidewalk ? SERVER_TERRAIN.SIDEWALK : null;
}

function readChunkTerrain(dataDir, cx, cz) {
  const file = chunkFilePath(dataDir, cx, cz);
  if (!existsSync(file)) return null;
  const cacheKey = `${dataDir}:${cx}:${cz}`;
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const cached = _chunkTerrainCache.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs) return cached.terrain;
  const chunk = readJsonFile(file, null);
  const terrain = Array.isArray(chunk?.terrain) ? chunk.terrain : null;
  _chunkTerrainCache.set(cacheKey, { mtimeMs, terrain });
  return terrain;
}

function getServerWorldTile(dataDir, wx, wz) {
  const x = Math.round(numberOr(wx, 0));
  const z = Math.round(numberOr(wz, 0));
  const streetTile = serverStreetTerrainAt(dataDir, x, z);
  if (streetTile !== null && streetTile !== undefined) return streetTile;
  const cx = Math.floor(x / SERVER_CHUNK_SIZE);
  const cz = Math.floor(z / SERVER_CHUNK_SIZE);
  const terrain = readChunkTerrain(dataDir, cx, cz);
  if (!terrain) return SERVER_TERRAIN.GRASS;
  const lx = ((x % SERVER_CHUNK_SIZE) + SERVER_CHUNK_SIZE) % SERVER_CHUNK_SIZE;
  const lz = ((z % SERVER_CHUNK_SIZE) + SERVER_CHUNK_SIZE) % SERVER_CHUNK_SIZE;
  const tile = terrain[lz * SERVER_CHUNK_SIZE + lx];
  return Number.isFinite(Number(tile)) ? Number(tile) : SERVER_TERRAIN.GRASS;
}

function isServerCrosswalk(dataDir, wx, wz) {
  for (let r = 0; r <= 3; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const cx = wx + dx;
        const cz = wz + dz;
        if (getServerWorldTile(dataDir, cx, cz) !== SERVER_TERRAIN.ROAD) continue;
        const hasNS = getServerWorldTile(dataDir, cx, cz - 1) === SERVER_TERRAIN.ROAD || getServerWorldTile(dataDir, cx, cz + 1) === SERVER_TERRAIN.ROAD;
        const hasEW = getServerWorldTile(dataDir, cx - 1, cz) === SERVER_TERRAIN.ROAD || getServerWorldTile(dataDir, cx + 1, cz) === SERVER_TERRAIN.ROAD;
        if (hasNS && hasEW) return true;
      }
    }
  }
  return false;
}

function findNearestServerSidewalk(dataDir, wx, wz, radius = 12) {
  const x = Math.round(numberOr(wx, 0));
  const z = Math.round(numberOr(wz, 0));
  if (getServerWorldTile(dataDir, x, z) === SERVER_TERRAIN.SIDEWALK) return { x, z };
  if (getServerWorldTile(dataDir, x, z) === SERVER_TERRAIN.ROAD) {
    for (let d = 1; d <= 4; d++) {
      for (const [dx, dz] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
        if (getServerWorldTile(dataDir, x + dx, z + dz) === SERVER_TERRAIN.SIDEWALK) return { x: x + dx, z: z + dz };
      }
    }
  }
  const r = Math.max(1, Math.floor(numberOr(radius, 12)));
  let best = null;
  let bestDist = Infinity;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (getServerWorldTile(dataDir, x + dx, z + dz) !== SERVER_TERRAIN.SIDEWALK) continue;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        best = { x: x + dx, z: z + dz };
        bestDist = dist;
      }
    }
  }
  return best;
}

function pathfindServerSidewalk(dataDir, sx, sz, gx, gz) {
  const startX = Math.round(numberOr(sx, 0));
  const startZ = Math.round(numberOr(sz, 0));
  const goalX = Math.round(numberOr(gx, startX));
  const goalZ = Math.round(numberOr(gz, startZ));
  const maxDist = Math.abs(goalX - startX) + Math.abs(goalZ - startZ);
  if (maxDist > 400) return null;
  if (maxDist < 2) return [{ x: goalX, z: goalZ }];
  const open = new Map();
  const closed = new Set();
  const cameFrom = new Map();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const keyFor = (x, z) => `${x},${z}`;
  const heuristic = (x, z) => Math.abs(x - goalX) + Math.abs(z - goalZ);
  open.set(keyFor(startX, startZ), { x: startX, z: startZ, f: heuristic(startX, startZ), g: 0 });

  let iterations = 0;
  while (open.size > 0 && iterations++ < 10000) {
    let bestKey = null;
    let bestF = Infinity;
    for (const [key, entry] of open) {
      if (entry.f < bestF) {
        bestKey = key;
        bestF = entry.f;
      }
    }
    if (bestKey === keyFor(goalX, goalZ)) {
      const fullPath = [];
      let walkKey = bestKey;
      while (walkKey) {
        const [x, z] = walkKey.split(',').map(Number);
        fullPath.unshift({ x, z });
        walkKey = cameFrom.get(walkKey) || null;
      }
      if (fullPath.length <= 2) return fullPath;
      const simplified = [fullPath[0]];
      for (let i = 1; i < fullPath.length - 1; i++) {
        const prev = fullPath[i - 1];
        const cur = fullPath[i];
        const next = fullPath[i + 1];
        if (cur.x - prev.x !== next.x - cur.x || cur.z - prev.z !== next.z - cur.z) simplified.push(cur);
      }
      simplified.push(fullPath[fullPath.length - 1]);
      return simplified;
    }
    const current = open.get(bestKey);
    open.delete(bestKey);
    closed.add(bestKey);
    for (const [dx, dz] of dirs) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      const nKey = keyFor(nx, nz);
      if (closed.has(nKey)) continue;
      const tile = getServerWorldTile(dataDir, nx, nz);
      if (tile !== SERVER_TERRAIN.SIDEWALK && tile !== SERVER_TERRAIN.ROAD && tile !== SERVER_TERRAIN.PARKING) continue;
      const diag = dx !== 0 && dz !== 0;
      const baseCost = tile === SERVER_TERRAIN.SIDEWALK
        ? 1
        : tile === SERVER_TERRAIN.PARKING
          ? 3
          : (isServerCrosswalk(dataDir, nx, nz) ? 3 : 40);
      const moveCost = diag ? baseCost * Math.SQRT2 : baseCost;
      const g = current.g + moveCost;
      const existing = open.get(nKey);
      if (!existing || g < existing.g) {
        cameFrom.set(nKey, bestKey);
        open.set(nKey, { x: nx, z: nz, g, f: g + heuristic(nx, nz) });
      }
    }
  }
  return null;
}

function lineIntersectsAabb(x1, y1, x2, y2, minX, minY, maxX, maxY) {
  let tMin = 0;
  let tMax = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]]) {
    if (Math.abs(p) < 0.001) {
      if (q < 0) return false;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > tMax) return false;
        if (r > tMin) tMin = r;
      } else {
        if (r < tMin) return false;
        if (r < tMax) tMax = r;
      }
    }
  }
  return true;
}

function getServerSmartWaypoints(dataDir, ax, ay, tx, ty) {
  const pad = LIVE_ACTION_API_TILE * 2.5;
  const obstructions = [];
  for (const building of listBuildingDocuments(dataDir)) {
    if (!building || building.type === 'park') continue;
    const bx1 = Number(building.worldX ?? building.x ?? 0) * LIVE_ACTION_API_TILE;
    const bz1 = Number(building.worldY ?? building.z ?? 0) * LIVE_ACTION_API_TILE;
    const bx2 = bx1 + Number(building.widthTiles || 25) * LIVE_ACTION_API_TILE;
    const bz2 = bz1 + Number(building.heightTiles || 17) * LIVE_ACTION_API_TILE;
    if (ax >= bx1 && ax <= bx2 && ay >= bz1 && ay <= bz2) continue;
    if (tx >= bx1 && tx <= bx2 && ty >= bz1 && ty <= bz2) continue;
    if (!lineIntersectsAabb(ax, ay, tx, ty, bx1 - pad, bz1 - pad, bx2 + pad, bz2 + pad)) continue;
    const bcx = (bx1 + bx2) / 2;
    const bcz = (bz1 + bz2) / 2;
    obstructions.push({ bx1, bz1, bx2, bz2, bcx, bcz, dist: Math.hypot(ax - bcx, ay - bcz) });
  }
  if (!obstructions.length) return [{ x: tx, y: ty }];
  obstructions.sort((a, b) => a.dist - b.dist);
  const waypoints = [];
  let curX = ax;
  let curY = ay;
  for (const obs of obstructions) {
    if (!lineIntersectsAabb(curX, curY, tx, ty, obs.bx1 - pad, obs.bz1 - pad, obs.bx2 + pad, obs.bz2 + pad)) continue;
    const corners = [
      { x: obs.bx1 - pad, y: obs.bz1 - pad },
      { x: obs.bx2 + pad, y: obs.bz1 - pad },
      { x: obs.bx1 - pad, y: obs.bz2 + pad },
      { x: obs.bx2 + pad, y: obs.bz2 + pad },
    ];
    let best = corners[0];
    let bestCost = Infinity;
    for (const corner of corners) {
      const cost = Math.hypot(curX - corner.x, curY - corner.y) + Math.hypot(corner.x - tx, corner.y - ty) + (corner.y > obs.bcz ? -pad * 0.3 : 0);
      if (cost < bestCost) {
        best = corner;
        bestCost = cost;
      }
    }
    waypoints.push(best);
    curX = best.x;
    curY = best.y;
  }
  waypoints.push({ x: tx, y: ty });
  return waypoints;
}

function canonicalWorldActionStatus(status) {
  const value = String(status || '').trim();
  return {
    queued: 'requested',
    arriving: 'arrived',
    in_use: 'in_progress',
    completing: 'in_progress',
    done: 'completed',
    blocked: 'failed',
    timed_out: 'expired',
  }[value] || value;
}

function worldActionAllowedNext(status) {
  return Array.from(WORLD_ACTION_TRANSITIONS[canonicalWorldActionStatus(status)] || []).sort();
}

function worldActionTransitionAllowed(fromStatus, toStatus) {
  const from = canonicalWorldActionStatus(fromStatus);
  const to = canonicalWorldActionStatus(toStatus);
  return Boolean(WORLD_ACTION_TRANSITIONS[from]?.has(to));
}

function worldActionActor(action, fallback = 'agent-runtime-room.mjs#tickLiveActionRuntime') {
  const source = action?.source && typeof action.source === 'object' ? action.source : {};
  return safeText(source.requestedBy || source.kind, fallback) || fallback;
}

function worldActionSourceKind(action, fallback = 'server-runtime') {
  const source = action?.source && typeof action.source === 'object' ? action.source : {};
  return safeText(action?.behaviorSourceKind || source.behaviorSourceKind || source.kind, fallback) || fallback;
}

function appendWorldActionEvent(action, name, now, { fromStatus = null, toStatus = null, reason = '', result = null, source = 'server-runtime', actor = 'agent-runtime-room.mjs#tickLiveActionRuntime' } = {}) {
  const events = Array.isArray(action.events) ? [...action.events] : [];
  const event = {
    schemaVersion: 'agent-life-world-action-event-hooks/v1',
    name,
    type: name,
    id: `evt-${safeText(action.id, 'action')}-${name}-${now.replace(/[^0-9A-Za-z]/g, '')}`,
    at: now,
    timestamp: now,
    actionId: action.id || '',
    actionType: action.actionType || action.actionId || '',
    status: toStatus || action.status || '',
    fromStatus,
    toStatus,
    from: fromStatus,
    to: toStatus,
    agentId: action.agentId || '',
    targetKind: action.target?.kind || '',
    target: action.target || null,
    routeId: action.route?.id || action.route?.routeId || '',
    reservationId: action.reservation?.id || '',
    source,
    behaviorSourceKind: action.behaviorSourceKind || action.source?.behaviorSourceKind || action.source?.kind || '',
    behaviorMode: action.behaviorMode || action.source?.behaviorMode || '',
    behaviorCategory: action.behaviorCategory || action.source?.behaviorCategory || null,
    actor,
    reason,
    result,
    error: null,
  };
  events.push(event);
  action.events = events.slice(-80);
  return action;
}

function releaseWorldActionReservation(action, terminalStatus, now, reason = '') {
  if (!action.reservation || typeof action.reservation !== 'object' || Array.isArray(action.reservation)) return action;
  const releaseState = {
    completed: 'released',
    cancelled: 'cancelled',
    failed: 'failed',
    expired: 'timed_out',
  }[terminalStatus] || 'released';
  action.reservation = {
    ...action.reservation,
    state: releaseState,
    status: 'released',
    availabilityState: 'available',
    releasedAt: action.reservation.releasedAt || now,
    releaseReason: reason || terminalStatus,
  };
  return action;
}

function applyWorldActionSideEffects(action, fromStatus, toStatus, now, reason = '') {
  const route = action.route && typeof action.route === 'object' && !Array.isArray(action.route) ? { ...action.route } : null;
  const effects = Array.isArray(action.effects) ? [...action.effects] : [];
  if (route) {
    route.state = toStatus;
    route.status = toStatus;
    route.routeOwner = LIVE_ACTION_RUNTIME_OWNER;
    route.serverExecutor = 'agent-runtime-room.mjs#tickLiveActionRuntime';
    route.serverRuntimeAuthority = true;
    route.setAgentTarget = false;
    if (toStatus === 'route_pending') route.handoffPendingAt = route.handoffPendingAt || now;
    if (toStatus === 'routing') route.startedAt = route.startedAt || now;
    if (toStatus === 'arrived') route.arrivedAt = route.arrivedAt || now;
    if (WORLD_ACTION_TERMINAL_STATUSES.has(toStatus)) {
      route.stoppedAt = route.stoppedAt || now;
      if (toStatus === 'completed') route.completedAt = route.completedAt || now;
      if (toStatus === 'cancelled') route.cancelledAt = route.cancelledAt || now;
      route.moveIntent = {
        ...(route.moveIntent && typeof route.moveIntent === 'object' ? route.moveIntent : {}),
        state: 'cleared',
        clearedAt: now,
        reason: reason || toStatus,
      };
      effects.push({ type: 'route-intent-cleared', at: now, from: fromStatus, to: toStatus, reason: reason || toStatus });
    }
    action.route = route;
  }
  if (toStatus === 'reserved' && action.reservation && typeof action.reservation === 'object') {
    action.reservation = {
      ...action.reservation,
      state: ['queued', 'reserved'].includes(action.reservation.state) ? action.reservation.state : 'reserved',
      status: action.reservation.status || 'held',
      availabilityState: 'reserved',
      reservedAt: action.reservation.reservedAt || now,
    };
  }
  if (toStatus === 'in_progress' && action.reservation && typeof action.reservation === 'object') {
    action.reservation = {
      ...action.reservation,
      state: 'in_use',
      status: 'active',
      availabilityState: 'in_use',
      inUseAt: action.reservation.inUseAt || now,
    };
  }
  if (WORLD_ACTION_TERMINAL_STATUSES.has(toStatus)) {
    const hadReservation = Boolean(action.reservation && typeof action.reservation === 'object');
    releaseWorldActionReservation(action, toStatus, now, reason);
    if (hadReservation) {
      effects.push({ type: 'reservation-released', at: now, state: action.reservation?.state || '', reason: reason || toStatus });
    }
  }
  if (effects.length > 0) action.effects = effects;
  return action;
}

function transitionWorldActionRecord(action, toStatus, { now = new Date().toISOString(), result = null, failureReason = null, actor = 'agent-runtime-room.mjs#tickLiveActionRuntime', source = 'server-runtime', reason = '' } = {}) {
  const fromStatus = canonicalWorldActionStatus(action?.status);
  const nextStatus = canonicalWorldActionStatus(toStatus);
  if (!WORLD_ACTION_ACTIVE_STATUSES.has(fromStatus) || fromStatus === nextStatus) return { action, changed: false };
  if (!worldActionTransitionAllowed(fromStatus, nextStatus)) return { action, changed: false, blocked: true };
  const next = cloneJson(action, {}) || {};
  next.status = nextStatus;
  next.failureReason = ['failed', 'expired', 'cancelled'].includes(nextStatus) ? (failureReason || reason || nextStatus) : null;
  const nextResult = result && typeof result === 'object' && !Array.isArray(result)
    ? { ...result, status: result.status || nextStatus }
    : { ...(next.result && typeof next.result === 'object' && !Array.isArray(next.result) ? next.result : {}), status: nextStatus };
  if (nextStatus === 'completed') nextResult.applied = nextResult.applied !== false;
  if (reason && !nextResult.reason) nextResult.reason = reason;
  next.result = nextResult;
  const timing = next.timing && typeof next.timing === 'object' && !Array.isArray(next.timing) ? { ...next.timing } : {};
  timing.updatedAt = now;
  if (nextStatus === 'route_pending') timing.routePendingAt = timing.routePendingAt || now;
  if (nextStatus === 'routing') timing.startedAt = timing.startedAt || now;
  if (nextStatus === 'arrived') timing.arrivedAt = timing.arrivedAt || now;
  if (nextStatus === 'in_progress') timing.inProgressAt = timing.inProgressAt || now;
  if (WORLD_ACTION_TERMINAL_STATUSES.has(nextStatus)) {
    timing.terminalAt = timing.terminalAt || now;
    if (nextStatus === 'completed') timing.completedAt = timing.completedAt || now;
  }
  next.timing = timing;
  const lifecycle = next.lifecycle && typeof next.lifecycle === 'object' && !Array.isArray(next.lifecycle) ? { ...next.lifecycle } : {};
  const transitionLog = Array.isArray(lifecycle.transitionLog) ? [...lifecycle.transitionLog] : [];
  transitionLog.push({
    at: now,
    from: fromStatus,
    to: nextStatus,
    actor,
    source,
    reason: reason || failureReason || nextStatus,
  });
  lifecycle.previousStatus = fromStatus;
  lifecycle.allowedNext = worldActionAllowedNext(nextStatus);
  lifecycle.transitionLog = transitionLog;
  if (WORLD_ACTION_TERMINAL_STATUSES.has(nextStatus)) lifecycle.terminalReason = failureReason || reason || nextStatus;
  next.lifecycle = lifecycle;
  next.audit = {
    ...(next.audit && typeof next.audit === 'object' && !Array.isArray(next.audit) ? next.audit : {}),
    schemaVersion: next.audit?.schemaVersion || WORLD_ACTION_SCHEMA_VERSION,
    stateMachineVersion: next.audit?.stateMachineVersion || WORLD_ACTION_STATE_MACHINE_VERSION,
    serverRuntimeExecutor: 'agent-runtime-room.mjs#tickLiveActionRuntime',
  };
  applyWorldActionSideEffects(next, fromStatus, nextStatus, now, reason || failureReason || nextStatus);
  const eventName = WORLD_ACTION_TERMINAL_STATUSES.has(nextStatus)
    ? (nextStatus === 'completed' ? 'completed' : 'failed')
    : nextStatus;
  appendWorldActionEvent(next, eventName, now, {
    fromStatus,
    toStatus: nextStatus,
    reason: reason || failureReason || nextStatus,
    result: next.result,
    source,
    actor,
  });
  if (WORLD_ACTION_TERMINAL_STATUSES.has(nextStatus) && next.reservation) {
    appendWorldActionEvent(next, 'reservation-released', now, {
      fromStatus,
      toStatus: nextStatus,
      reason: reason || failureReason || nextStatus,
      result: next.result,
      source: 'reservation',
      actor,
    });
  }
  return { action: next, changed: true };
}

function apiPointFromBuildingLocal(building, localX, localZ) {
  const bw = Number(building?.widthTiles || 25) || 25;
  const bd = Number(building?.heightTiles || 17) || 17;
  const baseX = Number(building?.worldX ?? building?.x ?? 0) || 0;
  const baseZ = Number(building?.worldY ?? building?.z ?? 0) || 0;
  const rot = positiveModulo(Number(building?._rotation || 0), 360);
  let worldX = Number(localX);
  let worldZ = Number(localZ);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return null;
  if (rot === 90) {
    worldX = baseX + bd - Number(localZ);
    worldZ = baseZ + Number(localX);
  } else if (rot === 180) {
    worldX = baseX + bw - Number(localX);
    worldZ = baseZ + bd - Number(localZ);
  } else if (rot === 270) {
    worldX = baseX + Number(localZ);
    worldZ = baseZ + bw - Number(localX);
  } else {
    worldX = baseX + Number(localX);
    worldZ = baseZ + Number(localZ);
  }
  return { x: worldX * LIVE_ACTION_API_TILE, y: worldZ * LIVE_ACTION_API_TILE };
}

function buildingLocalPointFromApi(building, apiX, apiY) {
  if (!building || !Number.isFinite(Number(apiX)) || !Number.isFinite(Number(apiY))) return null;
  const worldX = Number(apiX) / LIVE_ACTION_API_TILE;
  const worldZ = Number(apiY) / LIVE_ACTION_API_TILE;
  const baseX = Number(building?.worldX ?? building?.x ?? 0) || 0;
  const baseZ = Number(building?.worldY ?? building?.z ?? 0) || 0;
  const bw = Number(building?.widthTiles || 25) || 25;
  const bd = Number(building?.heightTiles || 17) || 17;
  const relX = worldX - baseX;
  const relZ = worldZ - baseZ;
  const rot = positiveModulo(Number(building?._rotation || 0), 360);
  if (rot === 90) return { x: relZ, z: bd - relX };
  if (rot === 180) return { x: bw - relX, z: bd - relZ };
  if (rot === 270) return { x: bw - relZ, z: relX };
  return { x: relX, z: relZ };
}

function buildingContainsApiPoint(building, apiX, apiY) {
  const local = buildingLocalPointFromApi(building, apiX, apiY);
  if (!local) return false;
  const bw = Number(building?.widthTiles || 25) || 25;
  const bd = Number(building?.heightTiles || 17) || 17;
  return local.x >= -0.05 && local.x <= bw + 0.05 && local.z >= -0.05 && local.z <= bd + 0.05;
}

function findInteriorBuildingAtApi(dataDir, apiX, apiY) {
  for (const building of listBuildingDocuments(dataDir)) {
    if (!building || building.type === 'park') continue;
    if (buildingContainsApiPoint(building, apiX, apiY)) return building;
  }
  return null;
}

function findParkAtApi(dataDir, apiX, apiY) {
  for (const building of listBuildingDocuments(dataDir)) {
    if (!building || building.type !== 'park') continue;
    if (buildingContainsApiPoint(building, apiX, apiY)) return building;
  }
  return null;
}

function getBuildingDoorSpec(building) {
  const width = Number(building?.widthTiles || 10) || 10;
  const height = Number(building?.heightTiles || 8) || 8;
  const fallback = {
    localCenterX: Math.max(1, Math.min(width - 1, width / 2)),
    localThresholdZ: height + 0.5,
    localOutsideZ: height + 1.2,
    localInteriorZ: Math.max(0.75, height - 1.2),
    localDoorwayZ: height + 0.05,
    doorwayReachWorld: 0.55,
  };
  const spec = building?.doorSpec && typeof building.doorSpec === 'object' && !Array.isArray(building.doorSpec)
    ? building.doorSpec
    : {};
  return {
    localCenterX: numberOr(spec.localCenterX, fallback.localCenterX),
    localThresholdZ: numberOr(spec.localThresholdZ, fallback.localThresholdZ),
    localOutsideZ: numberOr(spec.localOutsideZ, fallback.localOutsideZ),
    localInteriorZ: numberOr(spec.localInteriorZ, fallback.localInteriorZ),
    localDoorwayZ: numberOr(spec.localDoorwayZ, fallback.localDoorwayZ),
    doorwayReachWorld: Math.max(0.25, numberOr(spec.doorwayReachWorld, fallback.doorwayReachWorld)),
  };
}

function buildingDoorwayPointApi(building) {
  const spec = getBuildingDoorSpec(building);
  return apiPointFromBuildingLocal(building, spec.localCenterX, spec.localDoorwayZ);
}

function buildingInteriorEntryPointApi(building) {
  const spec = getBuildingDoorSpec(building);
  return apiPointFromBuildingLocal(building, spec.localCenterX, spec.localInteriorZ);
}

function buildingOutsideDoorPointApi(building) {
  const spec = getBuildingDoorSpec(building);
  return apiPointFromBuildingLocal(building, spec.localCenterX, spec.localOutsideZ);
}

function buildingDoorwayReachApi(building) {
  const spec = getBuildingDoorSpec(building);
  return Math.max(numberOr(spec.doorwayReachWorld, 0.45) * LIVE_ACTION_API_TILE, LIVE_ACTION_API_TILE * 0.45);
}

function apiPointForBuilding(building) {
  if (!building || typeof building !== 'object') return null;
  const localX = Math.max(1, Number(building.widthTiles || 10) / 2);
  const localZ = Math.max(1, Number(building.heightTiles || 8) + 0.75);
  return apiPointFromBuildingLocal(building, localX, localZ);
}

function readBuildingDocument(dataDir, buildingId) {
  if (!buildingId) return null;
  const building = readJsonFile(buildingFilePath(dataDir, buildingId), null);
  return building && typeof building === 'object' && !Array.isArray(building) ? building : null;
}

function listBuildingDocuments(dataDir) {
  const dir = buildingsDirPath(dataDir);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith('.json'))
      .map(name => readJsonFile(join(dir, name), null))
      .filter(building => building && typeof building === 'object' && !Array.isArray(building));
  } catch {
    return [];
  }
}

function objectIdsForBuildingItem(building, object, index) {
  const catalogId = object?.catalogId || object?.type || '';
  return new Set([
    object?.objectInstanceId,
    object?.instanceId,
    object?.id,
    `${building?.id}:furn:${catalogId}:${index}`,
    `${building?.id}:furniture:${index}`,
    `${building?.id}:${catalogId}:${index}`,
    `${catalogId}-${index}`,
  ].filter(Boolean).map(String));
}

function resolveObjectTargetPoint(dataDir, target = {}) {
  const buildingId = safeText(target.buildingId, '');
  const buildings = buildingId ? [readBuildingDocument(dataDir, buildingId)].filter(Boolean) : listBuildingDocuments(dataDir);
  const wantedId = String(target.objectInstanceId || target.id || '').trim();
  const wantedCatalog = String(target.catalogId || target.objectCatalogId || '').trim().toLowerCase();
  const spotId = String(target.interactionSpotId || target.spotId || '').trim();
  for (const building of buildings) {
    const furniture = Array.isArray(building?.interior?.furniture) ? building.interior.furniture : [];
    for (let index = 0; index < furniture.length; index += 1) {
      const object = furniture[index];
      if (!object || typeof object !== 'object') continue;
      const catalog = String(object.catalogId || object.type || '').trim().toLowerCase();
      const ids = objectIdsForBuildingItem(building, object, index);
      const idMatches = wantedId ? ids.has(wantedId) : Number(target.furnitureIndex) === index;
      const catalogMatches = !wantedCatalog || wantedCatalog === catalog;
      if (!idMatches || !catalogMatches) continue;
      const locations = Array.isArray(object.actionLocations) ? object.actionLocations : [];
      const location = locations.find(entry => {
        if (!entry || typeof entry !== 'object') return false;
        return [entry.id, entry.interactionSpotId, entry.activationSpotId, entry.spotId].filter(Boolean).map(String).includes(spotId);
      }) || locations[0] || null;
      const local = location?.buildingLocal || location?.actionTarget || location?.activationTarget || object;
      const localPoint = apiPointFromBuildingLocal(building, Number(local?.x), Number(local?.z));
      const worldPoint = location?.world && Number.isFinite(Number(location.world.x)) && Number.isFinite(Number(location.world.z))
        ? { x: Number(location.world.x) * LIVE_ACTION_API_TILE, y: Number(location.world.z) * LIVE_ACTION_API_TILE }
        : null;
      const coordinateSpace = String(location?.coordinateSpace || local?.coordinateSpace || '').trim().toLowerCase();
      const preferLocalPoint = Boolean(
        localPoint &&
        (coordinateSpace === 'building-local' || !worldPoint || (worldPoint && !buildingContainsApiPoint(building, worldPoint.x, worldPoint.y)))
      );
      if (preferLocalPoint) {
        return {
          ...localPoint,
          floor: floorOr(local?.floor ?? location?.floor ?? object.floor ?? target.floor, 1),
          buildingId: building.id || '',
          roomId: safeText(target.roomId || object.room, ''),
          objectInstanceId: Array.from(ids)[0] || wantedId,
          interactionSpotId: spotId || location?.id || '',
        };
      }
      if (worldPoint) {
        return {
          ...worldPoint,
          floor: floorOr(location.floor ?? object.floor ?? target.floor, 1),
          buildingId: building.id || '',
          roomId: safeText(target.roomId || object.room, ''),
          objectInstanceId: Array.from(ids)[0] || wantedId,
          interactionSpotId: spotId || location?.id || '',
        };
      }
      if (localPoint) {
        return {
          ...localPoint,
          floor: floorOr(local?.floor ?? object.floor ?? target.floor, 1),
          buildingId: building.id || '',
          roomId: safeText(target.roomId || object.room, ''),
          objectInstanceId: Array.from(ids)[0] || wantedId,
          interactionSpotId: spotId || location?.id || '',
        };
      }
    }
  }
  return null;
}

function resolveActionTargetPoint(dataDir, action, state) {
  const routeTarget = action?.route?.target && typeof action.route.target === 'object' ? action.route.target : null;
  const target = routeTarget || (action?.target && typeof action.target === 'object' ? action.target : null);
  if (!target) return null;
  const x = numberOr(target.x, NaN);
  const y = numberOr(target.y ?? target.z, NaN);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return {
      x,
      y,
      floor: floorOr(target.floor, 1),
      buildingId: safeText(target.buildingId, ''),
      roomId: safeText(target.roomId, ''),
      targetKind: safeText(target.kind || target.targetKind, 'world-point'),
    };
  }
  const kind = String(target.kind || target.targetKind || '').trim();
  if (kind === 'building' || kind === 'room' || kind === 'agent-home-building') {
    const building = readBuildingDocument(dataDir, target.buildingId);
    const point = apiPointForBuilding(building);
    return point ? {
      ...point,
      floor: floorOr(target.floor, 1),
      buildingId: safeText(building?.id || target.buildingId, ''),
      roomId: safeText(target.roomId, ''),
      targetKind: kind || 'building',
    } : null;
  }
  if (kind === 'object-instance' || target.objectInstanceId || target.catalogId) {
    const point = resolveObjectTargetPoint(dataDir, target);
    return point ? { ...point, targetKind: kind || 'object-instance' } : null;
  }
  if (kind === 'agent' || target.targetAgentId) {
    const targetAgentId = safeText(target.targetAgentId, '');
    const agent = targetAgentId ? state?.agents?.get?.(targetAgentId) : null;
    if (!agent) return null;
    const heading = Number(agent.heading || 0) * Math.PI / 180;
    return {
      x: Number(agent.x || 0) - Math.sin(heading) * 24,
      y: Number(agent.y || 0) - Math.cos(heading) * 24,
      floor: floorOr(target.floor ?? agent.floor, 1),
      buildingId: safeText(agent.buildingId, ''),
      roomId: safeText(agent.roomId, ''),
      targetKind: 'agent',
      targetAgentId,
    };
  }
  return null;
}

function makeLiveActionSnapshotTarget(action, point) {
  const target = {
    actionId: safeText(action?.actionType || action?.actionId, ''),
    worldActionId: safeText(action?.id || action?.worldActionId, ''),
    targetKind: safeText(point?.targetKind || action?.target?.kind || 'world-point', 'world-point'),
    x: Number(point.x),
    y: Number(point.y),
    floor: floorOr(point.floor, 1),
  };
  for (const key of ['buildingId', 'roomId', 'objectInstanceId', 'interactionSpotId', 'targetAgentId']) {
    if (point?.[key]) target[key] = safeText(point[key], '');
  }
  return target;
}

function makeLiveActionVisualState(isMoving, status = 'working') {
  return {
    schemaVersion: 'agent-runtime-visual/v1',
    status,
    state: isMoving ? 'moving' : 'idle',
    resolvedAnimationId: isMoving ? 'walk' : 'stand-use',
    movement: { isMoving, isRunning: false },
    activityActive: !isMoving,
    carrying: false,
  };
}

function cloneRuntimePoint(point = null) {
  if (!point || typeof point !== 'object') return null;
  const x = numberOr(point.x, NaN);
  const y = numberOr(point.y ?? point.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const out = { x, y };
  if (Number.isFinite(Number(point.floor))) out.floor = floorOr(point.floor, 1);
  return out;
}

function summarizeServerRuntimeRoute(route = null) {
  if (!route || typeof route !== 'object') return null;
  const routePoints = Array.isArray(route.routePoints)
    ? route.routePoints.map(cloneRuntimePoint).filter(Boolean).slice(0, 32)
    : [];
  const rawPoints = Array.isArray(route.rawPoints)
    ? route.rawPoints.map(cloneRuntimePoint).filter(Boolean).slice(0, 80)
    : [];
  const rawCells = Array.isArray(route.rawCells)
    ? route.rawCells.map(cloneRuntimePoint).filter(Boolean).slice(0, 96)
    : [];
  const nextPoint = cloneRuntimePoint(route.effectiveTarget || route.pursuitTarget || route.route?.[route.routeIndex || 0] || null);
  return {
    schemaVersion: 'agent-runtime-server-route/v1',
    source: safeText(route.source || 'dynamic-interior-routing.js', 'dynamic-interior-routing.js') || 'dynamic-interior-routing.js',
    active: route.active === true,
    reason: safeText(route.reason, ''),
    routeIndex: Math.max(0, Math.floor(numberOr(route.routeIndex, 0))),
    routeLength: Array.isArray(route.route) ? route.route.length : routePoints.length,
    nextPoint,
    finalPoint: cloneRuntimePoint(route.finalPoint || routePoints[routePoints.length - 1] || null),
    targetAdjusted: route.targetAdjusted === true,
    adjustedTarget: cloneRuntimePoint(route.adjustedTarget || null),
    projectedPoint: cloneRuntimePoint(route.projectedPoint || null),
    pursuitTarget: cloneRuntimePoint(route.pursuitTarget || null),
    rerouteFrom: cloneRuntimePoint(route.rerouteFrom || null),
    blockedPoint: cloneRuntimePoint(route.blockedPoint || null),
    waitPoint: cloneRuntimePoint(route.waitPoint || null),
    waitingForTraffic: route.waitingForTraffic === true,
    routePoints,
    rawPoints,
    rawCells,
  };
}

function withRuntimeRouteVisualState(visualState, route = null) {
  const summary = summarizeServerRuntimeRoute(route);
  return summary ? { ...visualState, runtimeRoute: summary } : visualState;
}

function selectCachedServerRuntimeRouteStep(current, currentPoint, finalTarget, arrivalRadius = 5) {
  const runtimeRoute = current?.visualState?.runtimeRoute;
  if (!runtimeRoute || typeof runtimeRoute !== 'object' || runtimeRoute.active !== true) return null;
  const routePoints = Array.isArray(runtimeRoute.routePoints)
    ? runtimeRoute.routePoints.map(cloneRuntimePoint).filter(Boolean)
    : [];
  if (routePoints.length === 0) return null;
  const cachedFinal = cloneRuntimePoint(runtimeRoute.finalPoint || routePoints[routePoints.length - 1]);
  const finalTolerance = Math.max(10, numberOr(arrivalRadius, 5) * 2);
  if (cachedFinal) {
    const finalDist = Math.hypot(Number(cachedFinal.x) - Number(finalTarget.x), Number(cachedFinal.y) - Number(finalTarget.y));
    if (finalDist > finalTolerance) return null;
    if (Number.isFinite(Number(cachedFinal.floor)) && floorOr(cachedFinal.floor, finalTarget.floor) !== finalTarget.floor) return null;
  }
  const startIndex = Math.max(0, Math.min(routePoints.length - 1, Math.floor(numberOr(runtimeRoute.routeIndex, 0))));
  const minStepDist = Math.max(1, numberOr(arrivalRadius, 5) * 0.5);
  const currentFinalDist = Math.hypot(Number(finalTarget.x) - Number(currentPoint.x), Number(finalTarget.y) - Number(currentPoint.y));
  let closestIndex = startIndex;
  let closestDist = Infinity;
  for (let index = startIndex; index < routePoints.length; index += 1) {
    const point = routePoints[index];
    const dist = Math.hypot(Number(point.x) - Number(currentPoint.x), Number(point.y) - Number(currentPoint.y));
    if (dist < closestDist) {
      closestDist = dist;
      closestIndex = index;
    }
  }
  let routeIndex = startIndex;
  let steeringTarget = null;
  for (let index = Math.max(startIndex, closestIndex); index < routePoints.length; index += 1) {
    const point = routePoints[index];
    const dist = Math.hypot(Number(point.x) - Number(currentPoint.x), Number(point.y) - Number(currentPoint.y));
    const pointFinalDist = Math.hypot(Number(finalTarget.x) - Number(point.x), Number(finalTarget.y) - Number(point.y));
    const isForwardProgress = index > closestIndex || pointFinalDist < currentFinalDist + minStepDist;
    if (dist > minStepDist && isForwardProgress) {
      routeIndex = index;
      steeringTarget = { ...finalTarget, x: Number(point.x), y: Number(point.y), floor: floorOr(point.floor ?? finalTarget.floor, finalTarget.floor) };
      break;
    }
  }
  if (!steeringTarget) {
    if (currentFinalDist <= Math.max(1, numberOr(arrivalRadius, 5))) return null;
    routeIndex = Math.max(0, routePoints.length - 1);
    steeringTarget = finalTarget;
  }
  return {
    steeringTarget,
    route: {
      ...runtimeRoute,
      source: safeText(runtimeRoute.source, 'cached-server-route') || 'cached-server-route',
      reason: 'cached-server-route',
      active: true,
      effectiveTarget: steeringTarget,
      routeIndex,
      route: routePoints,
      routePoints,
      finalPoint: finalTarget,
    },
  };
}

function makeServerRuntimeStep(dataDir, agentId, current, target, tickMs, {
  speedUnitsPerSec,
  arrivalRadius,
  routeSource = 'server-runtime',
} = {}) {
  const finalTarget = {
    x: Number(target?.x ?? current?.x ?? 0),
    y: Number(target?.y ?? target?.z ?? current?.y ?? 0),
    floor: floorOr(target?.floor ?? current?.floor, 1),
    buildingId: safeText(target?.buildingId || '', ''),
  };
  const currentPoint = {
    id: agentId,
    x: Number(current?.x || 0),
    y: Number(current?.y || 0),
    floor: floorOr(current?.floor, finalTarget.floor),
  };
  let steeringTarget = finalTarget;
  let route = null;
  let phase = 'direct';
  const arrival = Math.max(1, numberOr(arrivalRadius, 5));
  const cachedRouteStep = selectCachedServerRuntimeRouteStep(current, currentPoint, finalTarget, arrival);
  const makeRoute = (source, reason, effectiveTarget, points = [], active = false, extra = {}) => ({
    active,
    source,
    reason,
    effectiveTarget,
    routeIndex: 0,
    route: points.length ? points : [effectiveTarget],
    routePoints: [cloneRuntimePoint(currentPoint), ...points.map(cloneRuntimePoint), cloneRuntimePoint(finalTarget)].filter(Boolean),
    finalPoint: finalTarget,
    ...extra,
  });

  const steerDoorTransition = (building, direction) => {
    const doorway = buildingDoorwayPointApi(building);
    const outside = buildingOutsideDoorPointApi(building) || doorway;
    const inside = buildingInteriorEntryPointApi(building) || doorway;
    const reach = buildingDoorwayReachApi(building);
    if (direction === 'enter' && outside && inside) {
      const distToOutside = Math.min(
        Math.hypot(currentPoint.x - outside.x, currentPoint.y - outside.y),
        doorway ? Math.hypot(currentPoint.x - doorway.x, currentPoint.y - doorway.y) : Infinity,
      );
      if (distToOutside <= Math.max(reach, arrival * 2)) {
        steeringTarget = { ...finalTarget, ...inside, floor: finalTarget.floor, targetKind: 'building-door-entry' };
        phase = 'door-crossing';
        route = makeRoute('server-door-transition', 'enter-building-through-door', steeringTarget, [outside, doorway, inside].filter(Boolean));
        return true;
      }
      return false;
    }
    if (direction === 'exit' && outside && inside) {
      const distToInside = Math.min(
        Math.hypot(currentPoint.x - inside.x, currentPoint.y - inside.y),
        doorway ? Math.hypot(currentPoint.x - doorway.x, currentPoint.y - doorway.y) : Infinity,
      );
      steeringTarget = distToInside <= Math.max(reach, arrival * 2)
        ? { ...outside, floor: finalTarget.floor, targetKind: 'building-door-exit' }
        : { ...inside, floor: finalTarget.floor, targetKind: 'building-door-inside-approach' };
      phase = distToInside <= Math.max(reach, arrival * 2) ? 'door-exit' : 'door-inside-approach';
      route = makeRoute('server-door-transition', phase === 'door-exit' ? 'exit-building-through-door' : 'inside-to-building-door', steeringTarget, [inside, doorway, outside].filter(Boolean));
      return true;
    }
    return false;
  };

  const useExteriorRoute = () => {
    const dynamicRoute = updateDynamicExteriorRouting(currentPoint, finalTarget, tickMs, { debug: false });
    if (dynamicRoute?.active && dynamicRoute.effectiveTarget) {
      steeringTarget = { ...finalTarget, x: dynamicRoute.effectiveTarget.x, y: dynamicRoute.effectiveTarget.y };
      phase = dynamicRoute.reason === 'door-approach' || dynamicRoute.reason === 'door-handoff'
        ? 'door-approach'
        : 'exterior-route';
      route = {
        ...dynamicRoute,
        source: 'dynamic-exterior-routing.js',
        finalPoint: finalTarget,
      };
      return true;
    }
    route = makeRoute('dynamic-exterior-routing.js', dynamicRoute?.reason || 'exterior-route-unavailable', finalTarget, [finalTarget]);
    return false;
  };

  const continueScriptedRouteWithoutReplan = !cachedRouteStep &&
    routeSource === 'server-scripted-object-runtime' &&
    (current?.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || current?.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER) &&
    safeText(current?.routeId, '');
  if (cachedRouteStep) {
    steeringTarget = cachedRouteStep.steeringTarget;
    route = cachedRouteStep.route;
    phase = String(route.source || '').includes('interior') ? 'interior-route' : 'exterior-route';
  } else if (continueScriptedRouteWithoutReplan) {
    steeringTarget = finalTarget;
    phase = 'scripted-object-route-continuation';
    route = makeRoute('server-scripted-object-route-continuation', 'active-route-replan-skipped', finalTarget, [finalTarget], true);
  } else {
    const targetBuilding = finalTarget.buildingId
      ? readBuildingDocument(dataDir, finalTarget.buildingId)
      : findInteriorBuildingAtApi(dataDir, finalTarget.x, finalTarget.y);
    const currentBuilding = findInteriorBuildingAtApi(dataDir, currentPoint.x, currentPoint.y);
    if (currentBuilding && currentBuilding.type !== 'park' && (!targetBuilding || currentBuilding.id !== targetBuilding.id)) {
      steerDoorTransition(currentBuilding, 'exit');
    } else if (targetBuilding && targetBuilding.type !== 'park') {
      const currentInsideTarget = currentBuilding?.id === targetBuilding.id;
      if (!currentInsideTarget) {
        if (!steerDoorTransition(targetBuilding, 'enter')) useExteriorRoute();
      } else {
        const dynamicRoute = updateDynamicInteriorRouting(currentPoint, finalTarget, tickMs, {
          building: targetBuilding,
          debug: false,
        });
        if (dynamicRoute?.active && dynamicRoute.effectiveTarget) {
          steeringTarget = { ...finalTarget, x: dynamicRoute.effectiveTarget.x, y: dynamicRoute.effectiveTarget.y };
          phase = 'interior-route';
          route = {
            ...dynamicRoute,
            source: 'dynamic-interior-routing.js',
            finalPoint: finalTarget,
          };
        } else {
          route = makeRoute('dynamic-interior-routing.js', dynamicRoute?.reason || 'interior-route-unavailable', finalTarget, [finalTarget]);
        }
      }
    } else if (!currentBuilding) {
      useExteriorRoute();
    }
  }

  const dx = Number(steeringTarget.x) - Number(currentPoint.x || 0);
  const dy = Number(steeringTarget.y) - Number(currentPoint.y || 0);
  const distanceToSteering = Math.hypot(dx, dy);
  const finalDx = Number(finalTarget.x) - Number(currentPoint.x || 0);
  const finalDy = Number(finalTarget.y) - Number(currentPoint.y || 0);
  const distanceToFinal = Math.hypot(finalDx, finalDy);
  const step = Math.max(1, numberOr(speedUnitsPerSec, 72) * (Math.max(1, tickMs) / 1000));
  const arrived = distanceToFinal <= arrival && !String(phase || '').startsWith('door-');
  const ratio = arrived ? 1 : Math.min(1, step / Math.max(distanceToSteering, 0.001));
  const nextX = arrived ? Number(finalTarget.x) : Number(currentPoint.x || 0) + dx * ratio;
  const nextY = arrived ? Number(finalTarget.y) : Number(currentPoint.y || 0) + dy * ratio;
  const heading = distanceToSteering > 0.001
    ? normalizeRuntimeAngleRadians(Math.atan2(dx, dy), 0)
    : normalizeRuntimeAngleRadians(current?.heading, 0);
  return {
    x: nextX,
    y: nextY,
    floor: finalTarget.floor,
    heading,
    arrived,
    distanceToFinal,
    distanceToSteering,
    steeringTarget,
    finalTarget,
    route: route ? { ...route, routeSource, phase } : null,
    phase,
  };
}

const LIVE_STATUS_WORK_STATES = new Set(['working', 'finishing', 'busy', 'running', 'executing']);
const LIVE_STATUS_WORK_OBJECT_TYPES = new Set(['desk', 'standingDesk', 'receptionDesk', 'laptopMonitorProps']);
const LIVE_STATUS_MEETING_STATES = new Set(['meeting']);
const LIVE_STATUS_MEETING_OBJECT_TYPES = new Set(['meetingTable', 'smallRoundMeetingTable', 'conferenceChair']);
const LIVE_STATUS_WORK_SPOT_DEFAULTS = {
  desk: { dx: 0, dz: 0.8, facing: 'north', spotId: 'default' },
  standingDesk: { dx: 0, dz: 0.92, facing: 'north', spotId: 'work-front' },
  receptionDesk: { dx: 0, dz: -0.62, facing: 'south', spotId: 'staff-work' },
  laptopMonitorProps: { dx: 0, dz: 0.66, facing: 'north', spotId: 'work-front' },
};

function normalizePresenceState(record) {
  const state = typeof record === 'string' ? record : record?.state || record?.status || '';
  return String(state || '').trim().toLowerCase();
}

function isLiveStatusWorking(record) {
  return LIVE_STATUS_WORK_STATES.has(normalizePresenceState(record));
}

function isLiveStatusMeeting(record) {
  return LIVE_STATUS_MEETING_STATES.has(normalizePresenceState(record));
}

function meetingParticipants(meeting = null) {
  const raw = Array.isArray(meeting?.participants) ? meeting.participants
    : Array.isArray(meeting?.agents) ? meeting.agents
      : Array.isArray(meeting?.agentIds) ? meeting.agentIds
        : [];
  return raw
    .map(item => typeof item === 'string' ? item : item?.agentId || item?.id || item?.name || '')
    .map(item => safeText(item, ''))
    .filter(Boolean);
}

function meetingForPresenceAgent(presence, agentId) {
  const meetings = Array.isArray(presence?._meetings) ? presence._meetings : [];
  return meetings.find(meeting => meetingParticipants(meeting).includes(agentId)) || null;
}

function liveStatusIdentityMatches(agentId, assignedTo) {
  if (!agentId || assignedTo === null || assignedTo === undefined) return false;
  const wanted = String(agentId || '').trim().toLowerCase();
  return String(assignedTo || '').split(/[,\s]+/).some(part => part.trim().toLowerCase() === wanted);
}

function stableTextHash(value) {
  let hash = 0;
  for (const char of String(value || '')) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash);
}

function rotateRuntimeLocalOffset(dx, dz, rotationDeg = 0) {
  const rad = (Number(rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: Number(dx || 0) * cos + Number(dz || 0) * sin,
    z: -Number(dx || 0) * sin + Number(dz || 0) * cos,
  };
}

function runtimeFacingAngle(building, furniture, localX, localZ, facing = 'north') {
  const key = String(facing || 'north').toLowerCase();
  const localFacing = key === 'south' ? { x: 0, z: -1 }
    : key === 'east' ? { x: 1, z: 0 }
    : key === 'west' ? { x: -1, z: 0 }
    : { x: 0, z: 1 };
  const rotated = rotateRuntimeLocalOffset(localFacing.x, localFacing.z, furniture?.rotation || 0);
  const from = apiPointFromBuildingLocal(building, localX, localZ);
  const to = apiPointFromBuildingLocal(building, Number(localX || 0) + rotated.x, Number(localZ || 0) + rotated.z);
  if (!from || !to) return 0;
  return Math.atan2(to.x - from.x, to.y - from.y);
}

function runtimeFurnitureCenterFaceAngle(building, furniture, localX, localZ, fromPoint = null) {
  const from = fromPoint && Number.isFinite(Number(fromPoint.x)) && Number.isFinite(Number(fromPoint.y))
    ? { x: Number(fromPoint.x), y: Number(fromPoint.y) }
    : apiPointFromBuildingLocal(building, localX, localZ);
  const to = apiPointFromBuildingLocal(building, furniture?.x, furniture?.z);
  if (!from || !to) return null;
  return normalizeRuntimeAngleRadians(Math.atan2(to.x - from.x, to.y - from.y), 0);
}

const RUNTIME_CARDINAL_FACINGS = Object.freeze(['north', 'east', 'south', 'west']);

function normalizeRuntimeFacing(value = 'north', fallback = 'north') {
  const key = String(value || fallback || 'north').trim().toLowerCase();
  return RUNTIME_CARDINAL_FACINGS.includes(key) ? key : fallback;
}

function rotateRuntimeFacing(facing = 'north', rotationDeg = 0) {
  const key = normalizeRuntimeFacing(facing, 'north');
  const turns = positiveModulo(Math.round(Number(rotationDeg || 0) / 90), 4);
  const index = RUNTIME_CARDINAL_FACINGS.indexOf(key);
  return RUNTIME_CARDINAL_FACINGS[positiveModulo(index + turns, RUNTIME_CARDINAL_FACINGS.length)] || key;
}

function actionLocationAppliedFacingRotation(location = null) {
  const transform = location?.transformApplied && typeof location.transformApplied === 'object'
    ? location.transformApplied
    : null;
  if (!transform) return null;
  const totalRotation = Number(transform.totalRotation);
  if (Number.isFinite(totalRotation)) return totalRotation;
  const itemRotation = Number(transform.itemRotation || 0);
  const buildingRotation = Number(transform.buildingRotation || 0);
  if (Number.isFinite(itemRotation) || Number.isFinite(buildingRotation)) {
    return (Number.isFinite(itemRotation) ? itemRotation : 0) + (Number.isFinite(buildingRotation) ? buildingRotation : 0);
  }
  return null;
}

function authoredRuntimeFacing(location = null, explicit = null, fallback = 'north') {
  const facing = normalizeRuntimeFacing(location?.facing || explicit?.facing || fallback, fallback);
  const appliedRotation = actionLocationAppliedFacingRotation(location);
  if (appliedRotation === null) return facing;
  return rotateRuntimeFacing(facing, -appliedRotation);
}

function normalizeRuntimeAngleRadians(value, fallback = 0) {
  let angle = Number(value);
  if (!Number.isFinite(angle)) angle = Number(fallback);
  if (!Number.isFinite(angle)) return 0;
  if (Math.abs(angle) > Math.PI * 2 + 0.0001) {
    angle = (angle * Math.PI) / 180;
  }
  const fullTurn = Math.PI * 2;
  return ((((angle + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

function isExplicitRuntimeNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function explicitRuntimeFaceAngle(...candidates) {
  for (const candidate of candidates) {
    if (isExplicitRuntimeNumber(candidate)) return normalizeRuntimeAngleRadians(candidate, 0);
  }
  return null;
}

function runtimeFurnitureActionFaceAngle(building, furniture, local, fromPoint = null, options = {}) {
  const explicit = explicitRuntimeFaceAngle(local?.faceAngle);
  if (explicit !== null) return explicit;
  if (options?.deskFacesScreen && String(furniture?.type || '').toLowerCase() === 'desk') {
    return runtimeFacingAngle(building, furniture, local?.x, local?.z, 'south');
  }
  return runtimeFurnitureCenterFaceAngle(building, furniture, local?.x, local?.z, fromPoint)
    ?? runtimeFacingAngle(building, furniture, local?.x, local?.z, local?.facing);
}

function authoredRuntimeFaceAngle(location = null, explicit = null) {
  return explicitRuntimeFaceAngle(
    location?.pose?.facingAngleRad,
    location?.pose?.faceAngle,
    location?.activationTarget?.pose?.facingAngleRad,
    location?.activationTarget?.faceAngle,
    location?.activationTarget?.facingAngleRad,
    location?.faceAngle,
    location?.facingAngleRad,
    explicit?.pose?.facingAngleRad,
    explicit?.faceAngle,
    explicit?.facingAngleRad,
    location?.actionTarget?.pose?.facingAngleRad,
    location?.actionTarget?.faceAngle,
    location?.actionTarget?.facingAngleRad,
    location?.buildingLocal?.faceAngle,
    location?.buildingLocal?.facingAngleRad,
    location?.world?.faceAngle,
    location?.world?.facingAngleRad,
  );
}

function targetFaceAngleRadians(target = null, fallback = 0) {
  return normalizeRuntimeAngleRadians(target?.faceAngle, fallback);
}

function bestWorkSpotLocation(furniture) {
  const locations = Array.isArray(furniture?.actionLocations) ? furniture.actionLocations : [];
  return locations.find(location => {
    const id = String(location?.id || location?.spotId || '').toLowerCase();
    const roles = Array.isArray(location?.roles) ? location.roles.map(role => String(role || '').toLowerCase()) : [];
    return id === 'work-front' || id === 'staff-work' || roles.includes('work');
  }) || locations.find(location => {
    const id = String(location?.id || location?.spotId || '').toLowerCase();
    const roles = Array.isArray(location?.roles) ? location.roles.map(role => String(role || '').toLowerCase()) : [];
    return id === 'default' || roles.includes('seat') || roles.includes('use');
  }) || locations[0] || null;
}

function localPointFromWorkSpot(furniture, location) {
  const explicit = location?.actionTarget || location?.buildingLocal || location?.activationTarget || null;
  const x = numberOr(explicit?.x, NaN);
  const z = numberOr(explicit?.z, NaN);
  const faceAngle = authoredRuntimeFaceAngle(location, explicit);
  if (Number.isFinite(x) && Number.isFinite(z)) {
    return {
      x,
      z,
      spotId: safeText(location?.interactionSpotId || location?.spotId || location?.id, 'default') || 'default',
      facing: authoredRuntimeFacing(location, explicit, 'north'),
      faceAngle,
      floor: floorOr(location?.floor ?? explicit?.floor ?? furniture?.floor, 1),
    };
  }

  const fallback = LIVE_STATUS_WORK_SPOT_DEFAULTS[furniture?.type] || LIVE_STATUS_WORK_SPOT_DEFAULTS.desk;
  const rotated = rotateRuntimeLocalOffset(fallback.dx, fallback.dz, furniture?.rotation || 0);
  return {
    x: numberOr(furniture?.x, 0) + rotated.x,
    z: numberOr(furniture?.z, 0) + rotated.z,
    spotId: fallback.spotId,
    facing: fallback.facing,
    faceAngle: null,
    floor: floorOr(furniture?.floor, 1),
  };
}

function workTargetFromFurniture(building, furniture, index) {
  if (!building || !furniture || !LIVE_STATUS_WORK_OBJECT_TYPES.has(String(furniture.type || ''))) return null;
  const location = bestWorkSpotLocation(furniture);
  const local = localPointFromWorkSpot(furniture, location);
  const point = apiPointFromBuildingLocal(building, local.x, local.z);
  if (!point) return null;
  const objectInstanceId = safeText(furniture.objectInstanceId || furniture.instanceId || furniture.id || `${building.id}:furniture:${index}`, '');
  return {
    x: point.x,
    y: point.y,
    floor: local.floor,
    buildingId: safeText(building.id, ''),
    roomId: safeText(furniture.room, ''),
    targetKind: 'work-desk',
    actionId: 'work.desk',
    objectInstanceId,
    furnitureIndex: index,
    objectType: safeText(furniture.type, 'desk') || 'desk',
    interactionSpotId: local.spotId,
    spotId: local.spotId,
    faceAngle: runtimeFurnitureActionFaceAngle(building, furniture, local, point, { deskFacesScreen: true }),
  };
}

function meetingTargetFromFurnitureSpot(building, furniture, index, location = null) {
  if (!building || !furniture || !LIVE_STATUS_MEETING_OBJECT_TYPES.has(String(furniture.type || ''))) return null;
  const roles = scriptedObjectRoles(location);
  const actionId = scriptedObjectActionId(furniture, location);
  if (location && !roles.includes('seat') && !roles.includes('meeting') && actionId !== 'planning.meeting') return null;
  const local = localPointFromScriptedObjectSpot(furniture, location);
  const point = apiPointFromBuildingLocal(building, local.x, local.z);
  if (!point) return null;
  const objectType = safeText(furniture.type, 'meetingTable') || 'meetingTable';
  const objectInstanceId = safeText(furniture.objectInstanceId || furniture.instanceId || furniture.id || `${building.id}:furniture:${index}`, '');
  const spotId = scriptedObjectSpotId(location);
  return {
    x: point.x,
    y: point.y,
    floor: local.floor,
    buildingId: safeText(building.id, ''),
    roomId: safeText(furniture.room, ''),
    targetKind: 'meeting-table',
    statusKind: 'meeting',
    actionId: 'planning.meeting',
    objectInstanceId,
    furnitureIndex: index,
    objectType,
    interactionSpotId: spotId,
    spotId,
    slotId: safeText(location?.slotId || location?.seatId || spotId, spotId) || spotId,
    poseKind: 'seat',
    animationId: 'meeting-sit-talk',
    activityKind: objectType === 'conferenceChair' ? 'conference-chair-sit' : 'meeting-table',
    faceAngle: runtimeFurnitureActionFaceAngle(building, furniture, local, point),
  };
}

function listLiveStatusWorkTargets(dataDir) {
  const targets = [];
  for (const building of listBuildingDocuments(dataDir)) {
    if (!building || building.type === 'park') continue;
    const furniture = Array.isArray(building?.interior?.furniture) ? building.interior.furniture : [];
    for (let index = 0; index < furniture.length; index += 1) {
      const item = furniture[index];
      if (!item || item.deleted || item.removed || item.enabled === false) continue;
      const target = workTargetFromFurniture(building, item, index);
      if (!target) continue;
      targets.push({
        target,
        buildingId: target.buildingId,
        buildingType: safeText(building.type, ''),
        buildingName: safeText(building.name, ''),
        furnitureIndex: index,
        objectType: target.objectType,
        assignedTo: item.assignedTo ?? item.assignedAgentId ?? null,
      });
    }
  }
  return targets.sort((a, b) => `${a.buildingId}:${a.furnitureIndex}`.localeCompare(`${b.buildingId}:${b.furnitureIndex}`));
}

function listLiveStatusMeetingTargets(dataDir) {
  const targets = [];
  for (const building of listBuildingDocuments(dataDir)) {
    if (!building || building.type === 'park') continue;
    const furniture = Array.isArray(building?.interior?.furniture) ? building.interior.furniture : [];
    for (let index = 0; index < furniture.length; index += 1) {
      const item = furniture[index];
      if (!item || item.deleted || item.removed || item.enabled === false) continue;
      if (!LIVE_STATUS_MEETING_OBJECT_TYPES.has(String(item.type || ''))) continue;
      const locations = Array.isArray(item.actionLocations) && item.actionLocations.length > 0 ? item.actionLocations : [null];
      for (const location of locations) {
        const target = meetingTargetFromFurnitureSpot(building, item, index, location);
        if (!target) continue;
        targets.push({
          target,
          buildingId: target.buildingId,
          buildingType: safeText(building.type, ''),
          buildingName: safeText(building.name, ''),
          furnitureIndex: index,
          objectType: target.objectType,
          assignedTo: item.assignedTo ?? item.assignedAgentId ?? null,
        });
      }
    }
  }
  return targets.sort((a, b) => `${a.buildingId}:${a.furnitureIndex}:${a.target.spotId}`.localeCompare(`${b.buildingId}:${b.furnitureIndex}:${b.target.spotId}`));
}

function agentAssignmentFor(meta, agentId) {
  const assignments = meta?.agentAssignments && typeof meta.agentAssignments === 'object' && !Array.isArray(meta.agentAssignments)
    ? meta.agentAssignments
    : {};
  const direct = assignments[agentId];
  return direct && typeof direct === 'object' && !Array.isArray(direct) ? direct : {};
}

function pickLiveStatusWorkTarget(agentId, { meta, targets, workingAgentIds }) {
  if (!agentId || !Array.isArray(targets) || targets.length === 0) return null;
  const assigned = targets.find(entry => liveStatusIdentityMatches(agentId, entry.assignedTo));
  if (assigned) return assigned.target;

  const assignment = agentAssignmentFor(meta, agentId);
  const workBuildingId = safeText(assignment.work || assignment.workBuilding || assignment.workBuildingId, '');
  let candidates = targets.filter(entry => !entry.assignedTo);
  if (workBuildingId) {
    const inAssignedBuilding = candidates.filter(entry => entry.buildingId === workBuildingId);
    if (inAssignedBuilding.length > 0) candidates = inAssignedBuilding;
  } else {
    const officeTargets = candidates.filter(entry =>
      String(entry.buildingType || '').toLowerCase() === 'office' ||
      String(entry.buildingName || '').toLowerCase().includes('office')
    );
    if (officeTargets.length > 0) candidates = officeTargets;
  }
  if (candidates.length === 0) candidates = targets;
  if (candidates.length === 0) return null;
  const sortedWorkers = Array.isArray(workingAgentIds) ? workingAgentIds : [];
  const workerIndex = sortedWorkers.indexOf(agentId);
  const index = workerIndex >= 0 ? workerIndex : stableTextHash(agentId);
  return candidates[index % candidates.length]?.target || null;
}

function pickLiveStatusMeetingTarget(agentId, { presence, targets, meetingAgentIds }) {
  if (!agentId || !Array.isArray(targets) || targets.length === 0) return null;
  const meeting = meetingForPresenceAgent(presence, agentId);
  const participants = meetingParticipants(meeting);
  let candidates = targets;
  const hintedTable = meeting?.table && typeof meeting.table === 'object' ? meeting.table : null;
  if (hintedTable?.buildingId || hintedTable?.furnitureIndex !== undefined) {
    const filtered = candidates.filter(entry => {
      if (hintedTable.buildingId && entry.buildingId !== hintedTable.buildingId) return false;
      if (hintedTable.furnitureIndex !== undefined && hintedTable.furnitureIndex !== null && Number(entry.furnitureIndex) !== Number(hintedTable.furnitureIndex)) return false;
      return true;
    });
    if (filtered.length > 0) candidates = filtered;
  }
  const participantIndex = participants.indexOf(agentId);
  const fallbackIndex = Array.isArray(meetingAgentIds) ? meetingAgentIds.indexOf(agentId) : -1;
  const index = participantIndex >= 0 ? participantIndex : (fallbackIndex >= 0 ? fallbackIndex : stableTextHash(agentId));
  const picked = candidates[index % candidates.length]?.target || null;
  return picked ? {
    ...picked,
    meetingId: safeText(meeting?.id || meeting?.meetingId || 'live-meeting', 'live-meeting') || 'live-meeting',
    meetingTopic: safeText(meeting?.topic || meeting?.title || '', ''),
  } : null;
}

function buildLiveStatusRuntimePlan(dataDir) {
  const presence = readPresenceSnapshotDocument(dataDir);
  const meta = readWorldMetaDocument(dataDir);
  const workTargets = listLiveStatusWorkTargets(dataDir);
  const meetingTargets = listLiveStatusMeetingTargets(dataDir);
  const explicitMeetingAgentIds = new Set();
  for (const meeting of Array.isArray(presence?._meetings) ? presence._meetings : []) {
    for (const agentId of meetingParticipants(meeting)) explicitMeetingAgentIds.add(agentId);
  }
  for (const [agentId, record] of Object.entries(presence)) {
    if (agentId && !agentId.startsWith('_') && isLiveStatusMeeting(record)) explicitMeetingAgentIds.add(safeText(agentId, ''));
  }
  const meetingAgentIds = Array.from(explicitMeetingAgentIds).filter(Boolean).sort();
  const workingAgentIds = Object.entries(presence)
    .filter(([agentId, record]) => agentId && !agentId.startsWith('_') && isLiveStatusWorking(record) && !explicitMeetingAgentIds.has(agentId))
    .map(([agentId]) => safeText(agentId, ''))
    .filter(Boolean)
    .sort();
  const targetsByAgent = {};
  for (const agentId of meetingAgentIds) {
    const target = pickLiveStatusMeetingTarget(agentId, { presence, targets: meetingTargets, meetingAgentIds });
    if (target) targetsByAgent[agentId] = target;
  }
  for (const agentId of workingAgentIds) {
    const target = pickLiveStatusWorkTarget(agentId, { meta, targets: workTargets, workingAgentIds });
    if (target) targetsByAgent[agentId] = target;
  }
  return { presence, meta, targets: workTargets, workTargets, meetingTargets, workingAgentIds, meetingAgentIds, targetsByAgent };
}

function makeLiveStatusVisualState(isMoving, status = 'working', target = null) {
  const isMeeting = status === 'meeting' || target?.statusKind === 'meeting';
  const resolvedStatus = isMeeting ? 'meeting' : status;
  const activityKind = isMeeting ? 'live-status-meeting-table' : 'live-status-work-desk';
  const isRunning = Boolean(isMoving && !isMeeting);
  const resolvedAnimationId = isMoving ? 'walk' : (isMeeting ? 'meeting-sit-talk' : 'typing');
  const faceAngle = numberOr(target?.faceAngle, 0);
  const dockTarget = Number.isFinite(Number(target?.x)) && Number.isFinite(Number(target?.y))
    ? { x: Number(target.x), y: Number(target.y), floor: floorOr(target?.floor, 1), faceAngle }
    : null;
  return {
    schemaVersion: 'agent-runtime-visual/v1',
    status: resolvedStatus,
    state: isMoving ? 'moving' : 'idle',
    resolvedAnimationId,
    movement: { isMoving, isRunning },
    activityActive: Boolean(target),
    activityKind,
    atDesk: Boolean(target && !isMoving && !isMeeting),
    deskFacingAngle: faceAngle,
    activity: {
      kind: activityKind,
      phase: isMoving ? 'routing' : 'active',
      objectType: safeText(target?.objectType, ''),
      actionId: safeText(target?.actionId, ''),
      spotId: safeText(target?.spotId || target?.interactionSpotId, ''),
      meetingId: safeText(target?.meetingId, ''),
      meetingTopic: safeText(target?.meetingTopic, ''),
      animationId: resolvedAnimationId,
      faceAngle,
      dockTarget,
    },
    carrying: false,
  };
}

function liveStatusRuntimeObjectKey(target = null) {
  if (!target?.buildingId || target.furnitureIndex === undefined || target.furnitureIndex === null) return '';
  return normalizeWorldObjectKey(runtimeFurnitureObjectKey(target.buildingId, target.furnitureIndex, target.objectType || (target.statusKind === 'meeting' ? 'meetingTable' : 'desk')));
}

function makeLiveStatusObjectData(agentId, target, state, now, expiresAt) {
  const objectKey = liveStatusRuntimeObjectKey(target);
  const statusKind = target?.statusKind === 'meeting' ? 'meeting' : 'work';
  const actionId = safeText(target?.actionId, statusKind === 'meeting' ? 'planning.meeting' : 'work.desk') || (statusKind === 'meeting' ? 'planning.meeting' : 'work.desk');
  const spotId = safeText(target?.spotId || target?.interactionSpotId, 'default') || 'default';
  return {
    activity: {
      schemaVersion: 'server-live-status-object-activity/v1',
      kind: statusKind === 'meeting' ? 'live-status-meeting-table' : 'live-status-work-desk',
      phase: state,
      objectKey,
      objectType: safeText(target?.objectType, ''),
      actionId,
      spotId,
      meetingId: safeText(target?.meetingId, ''),
      meetingTopic: safeText(target?.meetingTopic, ''),
      runtimeOwner: LIVE_STATUS_RUNTIME_OWNER,
    },
    reservation: {
      id: safeText(`live-status-res:${objectKey}:${agentId}`, '') || `live-status-res:${agentId}`,
      objectKey,
      agentId,
      actionId,
      spotId,
      status: state === 'active' ? 'active' : 'held',
      state: state === 'active' ? 'in_use' : 'reserved',
      availabilityState: state === 'active' ? 'in_use' : 'reserved',
      reservedAt: now,
      expiresAt,
      runtimeWorldObject: true,
      runtimeOwner: LIVE_STATUS_RUNTIME_OWNER,
    },
    activeUse: state === 'active' ? {
      id: safeText(`live-status-active:${objectKey}:${agentId}`, '') || `live-status-active:${agentId}`,
      objectKey,
      agentId,
      actionId,
      interactionSpotId: spotId,
      slotId: safeText(target?.slotId || spotId, spotId) || spotId,
      state: 'active',
      status: 'active',
      activeAt: now,
      runtimeWorldObject: true,
      runtimeOwner: LIVE_STATUS_RUNTIME_OWNER,
    } : null,
    writer: 'agent-runtime-room.mjs#serverLiveStatusRuntime',
  };
}

const SCRIPTED_OBJECT_IDLE_STATES = new Set(['idle', 'available', 'online']);
const SERVER_SCRIPTED_OBJECT_QUEUE_SPACING_TILES = 0.8;
const SERVER_SCRIPTED_OBJECT_QUEUE_DEFAULT_CAPACITY = 3;
const SERVER_SCRIPTED_QUEUE_TERMINAL_STATES = new Set(['released', 'cancelled', 'complete', 'completed', 'failed']);
const SERVER_SCRIPTED_OBJECT_ACTIVITY_CONFIG = Object.freeze({
  chair: Object.freeze({ kind: 'chair-sit', spotId: 'seat', animationId: 'sit', poseKind: 'seat', stayMs: [9000, 15000] }),
  officechair: Object.freeze({ kind: 'office-chair-sit', spotId: 'seat', animationId: 'sit', poseKind: 'seat', stayMs: [9000, 15000] }),
  conferencechair: Object.freeze({ kind: 'conference-chair-sit', spotId: 'seat', animationId: 'meeting-sit-talk', poseKind: 'seat', stayMs: [9000, 15000] }),
  barberchair: Object.freeze({ kind: 'barber-chair-hair', spotId: 'seat', animationId: 'sit', poseKind: 'seat', stayMs: [12000, 18000] }),
  couch: Object.freeze({ kind: 'couch-rest', spotId: 'sit-center', animationId: 'sit', poseKind: 'seat', stayMs: [12000, 20000] }),
  sectionalsofa: Object.freeze({ kind: 'sectional-sofa-lounge', spotId: 'seat-center', animationId: 'sit', poseKind: 'seat', stayMs: [14000, 24000] }),
  loveseat: Object.freeze({ kind: 'loveseat-rest', spotId: 'seat-left', animationId: 'sit', poseKind: 'seat', stayMs: [11000, 19000] }),
  armchair: Object.freeze({ kind: 'armchair-rest', spotId: 'seat', animationId: 'sit', poseKind: 'seat', stayMs: [11000, 18000] }),
  parkbench: Object.freeze({ kind: 'park-bench-rest', spotId: 'approach-front', animationId: 'park-bench-sit-rest-read-talk', poseKind: 'seat', stayMs: [11000, 19000] }),
  hallwaybench: Object.freeze({ kind: 'hallway-bench-wait', spotId: 'approach-front', animationId: 'hallway-bench-wait', poseKind: 'seat', stayMs: [10000, 17000] }),
  barstool: Object.freeze({ kind: 'bar-stool-sit', spotId: 'seat', animationId: 'sit', poseKind: 'seat', stayMs: [9000, 15000] }),
  diningchair: Object.freeze({ kind: 'dining-chair-sit', spotId: 'seat', animationId: 'sit', poseKind: 'seat', stayMs: [9000, 15000] }),
  patiochair: Object.freeze({ kind: 'patio-chair-sit', spotId: 'seat', animationId: 'sit', poseKind: 'seat', stayMs: [10000, 17000] }),
  bed: Object.freeze({ kind: 'bed-rest', spotId: 'lie-sleep', animationId: 'bed-rest', poseKind: 'seat', stayMs: [14000, 24000] }),
  clinicbed: Object.freeze({ kind: 'bed-clinic-service', spotId: 'patient', animationId: 'bed-rest', poseKind: 'seat', stayMs: [10000, 17000] }),
  examchair: Object.freeze({ kind: 'exam-chair-patient', spotId: 'patient-seat', animationId: 'sit', poseKind: 'seat', stayMs: [10000, 16000] }),
  pathnode: Object.freeze({ kind: 'path-node-stroll', spotId: 'stroll-waypoint', animationId: 'path-node-stroll', poseKind: 'stand-use', stayMs: [2500, 5500] }),
  shadetreecluster: Object.freeze({ kind: 'shade-tree-rest', spotId: 'rest-south-shade', animationId: 'shade-tree-relax-read-gather', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  interiordoor: Object.freeze({ kind: 'interior-door-pass-through', spotId: 'approach-front', animationId: 'interior-door-pass-through', poseKind: 'stand-use', stayMs: [2200, 3600] }),
  bookshelf: Object.freeze({ kind: 'bookshelf-browse', spotId: 'browse-front', animationId: 'stand-read-point', poseKind: 'stand-use', stayMs: [8000, 15000] }),
  pantryshelf: Object.freeze({ kind: 'pantry-shelf-browse', spotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  shopshelf: Object.freeze({ kind: 'shop-shelf-browse', spotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  curtains: Object.freeze({ kind: 'curtains-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  whiteboard: Object.freeze({ kind: 'whiteboard-planning', spotId: 'presenter', animationId: 'write-teach', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  bulletinboard: Object.freeze({ kind: 'bulletin-board-read', spotId: 'read-front', animationId: 'stand-read-point', poseKind: 'stand-use', stayMs: [7000, 13000] }),
  outdoornoticeboard: Object.freeze({ kind: 'outdoor-notice-board-read', spotId: 'read-front', animationId: 'stand-read-point', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  parklamp: Object.freeze({ kind: 'park-lamp-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [6000, 10000] }),
  wallart: Object.freeze({ kind: 'wall-art-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [6500, 11000] }),
  menuboard: Object.freeze({ kind: 'menu-board-read', spotId: 'read-front', animationId: 'stand-read-point', poseKind: 'stand-use', stayMs: [7000, 13000] }),
  teachingpodium: Object.freeze({ kind: 'teaching-podium-teach', spotId: 'teach-behind', animationId: 'stand-teach-point', poseKind: 'stand-use', stayMs: [9000, 16000] }),
  dresser: Object.freeze({ kind: 'dresser-change-outfit', spotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  wardrobe: Object.freeze({ kind: 'wardrobe-change-outfit', spotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [10000, 16000] }),
  nightstand: Object.freeze({ kind: 'nightstand-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [6500, 11000] }),
  sidetable: Object.freeze({ kind: 'side-table-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [6000, 10000] }),
  tvstand: Object.freeze({ kind: 'tv-stand-inspect', spotId: 'inspect-front', animationId: 'tv-stand-remote-inspect', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  tv: Object.freeze({ kind: 'tv-watch', spotId: 'watch-front', animationId: 'stand-use', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  mirror: Object.freeze({ kind: 'mirror-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [8000, 13000] }),
  clothingrack: Object.freeze({ kind: 'clothing-rack-outfit', spotId: 'browse', animationId: 'stand-read-point', poseKind: 'stand-use', stayMs: [9000, 16000] }),
  displaymannequin: Object.freeze({ kind: 'display-mannequin-preview', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  accessorydisplaystand: Object.freeze({ kind: 'accessory-display-stand-browse', spotId: 'approach-front', activationSpotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [8500, 14500] }),
  displaycase: Object.freeze({ kind: 'display-case-browse', spotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  salonmirrorstation: Object.freeze({ kind: 'salon-mirror-station-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  receptiondesk: Object.freeze({ kind: 'reception-desk-visitor', spotId: 'visitor-talk', animationId: 'gather-talk', poseKind: 'stand-use', stayMs: [9000, 16000] }),
  cafecounter: Object.freeze({ kind: 'cafe-counter-order', spotId: 'customer', animationId: 'order-food-drink', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  kitchenisland: Object.freeze({ kind: 'kitchen-island-prep', spotId: 'prep-south', animationId: 'kitchen-island-prep', poseKind: 'stand-use', stayMs: [9000, 16000] }),
  counter: Object.freeze({ kind: 'counter-use', spotId: 'use-front', animationId: 'stand-use', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  smallcafetable: Object.freeze({ kind: 'small-cafe-table-eat', spotId: 'seat-south', animationId: 'sit-eat-drink', poseKind: 'seat', stayMs: [10000, 18000] }),
  outdoorcafetable: Object.freeze({ kind: 'outdoor-cafe-table-eat', spotId: 'seat-south', animationId: 'outdoor-cafe-table-sit-eat-drink-talk', poseKind: 'seat', stayMs: [10000, 18000] }),
  picnictable: Object.freeze({ kind: 'picnic-table-eat', spotId: 'seat-south-left', animationId: 'outdoor-cafe-table-sit-eat-drink-talk', poseKind: 'seat', stayMs: [11000, 19000] }),
  patiotable: Object.freeze({ kind: 'patio-table-eat-talk', spotId: 'use-south', animationId: 'stand-use', poseKind: 'stand-use', stayMs: [10000, 18000] }),
  smallroundmeetingtable: Object.freeze({ kind: 'small-round-meeting-table-plan', spotId: 'seat-south', animationId: 'meeting-sit-talk', poseKind: 'seat', stayMs: [12000, 20000] }),
  meetingtable: Object.freeze({ kind: 'meeting-table', spotId: 'seat-s3', animationId: 'meeting-sit-talk', poseKind: 'seat', stayMs: [12000, 20000] }),
  checkoutcounter: Object.freeze({ kind: 'checkout-counter-customer', spotId: 'customer', animationId: 'checkout-counter', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  checkoutregister: Object.freeze({ kind: 'checkout-register-customer', spotId: 'customer', animationId: 'checkout-service', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  trashbin: Object.freeze({ kind: 'trash-bin-dispose', spotId: 'dispose-front', animationId: 'dispose', poseKind: 'stand-use', stayMs: [6000, 10000] }),
  outdoortrashcan: Object.freeze({ kind: 'outdoor-trash-can-dispose', spotId: 'dispose-front', animationId: 'dispose', poseKind: 'stand-use', stayMs: [6000, 10000] }),
  watercooler: Object.freeze({ kind: 'water-cooler-get-water', spotId: 'use-front', animationId: 'order-food-drink', poseKind: 'stand-use', stayMs: [8000, 13000] }),
  coffeemachine: Object.freeze({ kind: 'coffee-machine-get-drink', spotId: 'use-front', animationId: 'order-food-drink', poseKind: 'stand-use', stayMs: [8000, 13000] }),
  countertopcoffeemachine: Object.freeze({ kind: 'coffee-machine-get-drink', spotId: 'use-front', animationId: 'order-food-drink', poseKind: 'stand-use', stayMs: [8000, 13000] }),
  fridge: Object.freeze({ kind: 'fridge-get-snack', spotId: 'use-front', animationId: 'fridge-use', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  sink: Object.freeze({ kind: 'sink-wash', spotId: 'use-front', animationId: 'stand-use', poseKind: 'stand-use', stayMs: [6000, 10000] }),
  stove: Object.freeze({ kind: 'stove-cook', spotId: 'cook-front', animationId: 'stand-use', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  grill: Object.freeze({ kind: 'grill-cook', spotId: 'cook-front', animationId: 'grill-cook', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  outdoorplanter: Object.freeze({ kind: 'outdoor-planter-water', spotId: 'water-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  flowerbed: Object.freeze({ kind: 'flower-bed-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  vending: Object.freeze({ kind: 'vending-machine-buy', spotId: 'use-front', animationId: 'vending-machine-use', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  vendingmachine: Object.freeze({ kind: 'vending-machine-buy', spotId: 'use-front', animationId: 'vending-machine-use', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  microwave: Object.freeze({ kind: 'microwave-heat-food', spotId: 'use-front', animationId: 'microwave-use', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  coffeepickupshelf: Object.freeze({ kind: 'coffee-pickup-shelf-pickup', spotId: 'pickup-front', animationId: 'stand-pickup-setdown', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  arcademachine: Object.freeze({ kind: 'arcade-machine-play', spotId: 'play-front', animationId: 'play-arcade', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  gamingstation: Object.freeze({ kind: 'gaming-station-play', spotId: 'seat-play', animationId: 'play-game', poseKind: 'seat', stayMs: [12000, 22000] }),
  pooltable: Object.freeze({ kind: 'pool-table-play', spotId: 'break-end', animationId: 'pool-table-play', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  pingpong: Object.freeze({ kind: 'pingpong-play', spotId: 'player-left', animationId: 'play-pingpong', poseKind: 'stand-use', stayMs: [18000, 28000] }),
  printer: Object.freeze({ kind: 'printer-scanner-print', spotId: 'use-front', animationId: 'printer-scanner-use', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  printercopier: Object.freeze({ kind: 'printer-scanner-print', spotId: 'use-front', animationId: 'printer-scanner-use', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  toolcart: Object.freeze({ kind: 'tool-cart-select-tool', spotId: 'select-front', animationId: 'tool-cart-select', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  workbench: Object.freeze({ kind: 'workbench-use-tool', spotId: 'work-front', animationId: 'workbench-tool-use', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  storageboxes: Object.freeze({ kind: 'storage-boxes-inspect', spotId: 'inspect-front', animationId: 'storage-boxes-inspect-open', poseKind: 'stand-use', stayMs: [7000, 12000] }),
  serverrack: Object.freeze({ kind: 'server-rack-inspect', spotId: 'inspect-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  diagnosticstation: Object.freeze({ kind: 'diagnostic-station-diagnose', spotId: 'review-front', animationId: 'diagnostic-station-use', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  medicalsupplycabinet: Object.freeze({ kind: 'medical-supply-cabinet-browse', spotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  supplycabinet: Object.freeze({ kind: 'supply-cabinet-browse', spotId: 'browse-front', animationId: 'inspect-browse', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  draftingtable: Object.freeze({ kind: 'drafting-table-create', spotId: 'work-front', animationId: 'drafting-plan', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  treadmill: Object.freeze({ kind: 'treadmill-train', spotId: 'step-off', activationSpotId: 'train-belt', animationId: 'train-practice', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  trainingmat: Object.freeze({ kind: 'training-mat-stretch', spotId: 'approach-front', animationId: 'train-practice', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  dumbbellrack: Object.freeze({ kind: 'dumbbell-rack-select', spotId: 'select-front', animationId: 'select-weights', poseKind: 'stand-use', stayMs: [8000, 14000] }),
  gymbench: Object.freeze({ kind: 'gym-bench-exercise', spotId: 'approach-front', activationSpotId: 'bench-use', animationId: 'gym-bench-exercise', poseKind: 'stand-use', stayMs: [11000, 19000] }),
  outdoorexercisestation: Object.freeze({ kind: 'outdoor-exercise-station-train', spotId: 'train-front', activationSpotId: 'practice-platform', animationId: 'outdoor-exercise-station-training', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  playgroundslide: Object.freeze({ kind: 'playground-slide-play', spotId: 'ladder-approach', animationId: 'playground-slide-play', poseKind: 'stand-use', stayMs: [9000, 15000] }),
  playgroundswing: Object.freeze({ kind: 'playground-swing-swing', spotId: 'seat-use', animationId: 'playground-swing-sit-swing', poseKind: 'seat', stayMs: [10000, 18000] }),
  ponddock: Object.freeze({ kind: 'pond-dock-view', spotId: 'view-left', animationId: 'pond-dock-view-relax', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  outdoorstage: Object.freeze({ kind: 'outdoor-stage-perform', spotId: 'perform-center', animationId: 'outdoor-stage-perform-watch-gather', poseKind: 'stand-use', stayMs: [14000, 26000] }),
});
const SERVER_SCRIPTED_VENDING_ITEM_OPTIONS = Object.freeze([
  Object.freeze({ id: 'chocolate-cookie', label: 'Chocolate Cookie', kind: 'snack', visualKind: 'vending-chocolate-cookie', packageColor: 0x8b5a2b, accentColor: 0x3f2414, needEffects: Object.freeze({ hunger: -22, thirst: 0 }) }),
  Object.freeze({ id: 'granola-bar', label: 'Granola Bar', kind: 'snack', visualKind: 'vending-granola-bar', packageColor: 0xd6a34a, accentColor: 0x7c4a14, needEffects: Object.freeze({ hunger: -20, thirst: 0 }) }),
  Object.freeze({ id: 'soft-drink-can-blue', label: 'Soft Drink Can (Blue)', kind: 'drink', visualKind: 'vending-soft-drink-blue', packageColor: 0x2563eb, accentColor: 0xdbeafe, needEffects: Object.freeze({ hunger: 0, thirst: -22 }) }),
  Object.freeze({ id: 'soft-drink-can-red', label: 'Soft Drink Can (Red)', kind: 'drink', visualKind: 'vending-soft-drink-red', packageColor: 0xdc2626, accentColor: 0xfee2e2, needEffects: Object.freeze({ hunger: 0, thirst: -22 }) }),
  Object.freeze({ id: 'chocolate-bar', label: 'Chocolate Bar', kind: 'snack', visualKind: 'vending-chocolate-bar', packageColor: 0x4a2c18, accentColor: 0xfacc15, needEffects: Object.freeze({ hunger: -24, thirst: 0 }) }),
]);
const SERVER_SCRIPTED_MICROWAVE_FOOD_OPTIONS = Object.freeze([
  Object.freeze({ id: 'popcorn', label: 'Popcorn', visualKind: 'microwave-popcorn', packageColor: 0xe53935, accentColor: 0xfff7d6 }),
  Object.freeze({ id: 'pizza-slice', label: 'Pizza Slice', visualKind: 'microwave-pizza-slice', packageColor: 0xffc107, accentColor: 0xb91c1c }),
  Object.freeze({ id: 'sandwich', label: 'Sandwich', visualKind: 'microwave-sandwich', packageColor: 0xd9a05b, accentColor: 0x65a30d }),
]);
const SERVER_SCRIPTED_DROP_OFFS = Object.freeze(['desk', 'diningTable', 'smallCafeTable', 'outdoorCafeTable', 'picnicTable', 'patioTable', 'counter', 'cafeCounter']);
const SERVER_SCRIPTED_DRINK_DROP_OFFS = Object.freeze(['desk', 'diningTable', 'counter']);

function serverScriptedObjectDispenseSpec(target = null) {
  const objectType = normalizeObjectTypeKey(target?.objectType || target?.catalogKey || target?.sourceObjectType);
  const activityKind = String(target?.activityKind || target?.kind || '').trim().toLowerCase();
  if (objectType === 'watercooler' || activityKind.startsWith('water-cooler-')) {
    return {
      kind: 'water',
      idPrefix: 'water-cup',
      label: 'Water Cup',
      itemKind: 'consumable',
      visualKind: 'water',
      drinkKind: 'water',
      carryItem: 'water',
      persistenceOwner: 'water-cooler-runtime',
      deskActivityKind: 'water-desk-consume',
      deskAnimationId: 'water-desk-sip',
      deskActionId: 'life.drinkWaterAtDesk',
      deskCompletionState: 'done-drinking-water',
      pickupEffect: 'temporary-water-picked-up',
      consumeEffect: 'temporary-water-consumed-at-desk',
      validDropOff: SERVER_SCRIPTED_DRINK_DROP_OFFS,
    };
  }
  if (objectType === 'coffeemachine' || objectType === 'countertopcoffeemachine' || activityKind.startsWith('coffee-machine-')) {
    return {
      kind: 'coffee',
      idPrefix: 'coffee-drink',
      label: 'Coffee Drink',
      itemKind: 'consumable',
      visualKind: 'coffee',
      carryItem: 'coffee',
      persistenceOwner: 'coffee-machine-runtime',
      deskActivityKind: 'coffee-desk-consume',
      deskAnimationId: 'coffee-desk-sip',
      deskActionId: 'life.drinkCoffeeAtDesk',
      deskCompletionState: 'done-drinking-coffee',
      pickupEffect: 'temporary-coffee-picked-up',
      consumeEffect: 'temporary-coffee-consumed-at-desk',
      validDropOff: SERVER_SCRIPTED_DRINK_DROP_OFFS,
    };
  }
  if (objectType === 'vending' || objectType === 'vendingmachine' || activityKind.startsWith('vending-machine-')) {
    return {
      kind: 'vending',
      idPrefix: 'vending',
      label: 'Vending Snack / Drink',
      itemKind: 'snack',
      carryItem: 'snack',
      persistenceOwner: 'vending-machine-runtime',
      deskActivityKind: 'vending-desk-consume',
      deskAnimationId: 'vending-desk-consume',
      deskActionId: 'life.consumeVendingItemAtDesk',
      deskCompletionState: 'done-consuming-vending-item',
      pickupEffect: 'temporary-vending-item-picked-up',
      consumeEffect: 'temporary-vending-item-consumed-at-desk',
      validDropOff: SERVER_SCRIPTED_DROP_OFFS,
    };
  }
  if (objectType === 'microwave' || activityKind.startsWith('microwave-')) {
    return {
      kind: 'microwave',
      idPrefix: 'microwave',
      label: 'Microwave Food',
      itemKind: 'consumable',
      carryItem: 'snack',
      persistenceOwner: 'microwave-runtime',
      deskActivityKind: 'microwave-desk-consume',
      deskAnimationId: 'microwave-desk-consume',
      deskActionId: 'life.eatMicrowaveFoodAtDesk',
      deskCompletionState: 'done-consuming-microwave-food',
      pickupEffect: 'temporary-microwave-food-picked-up',
      consumeEffect: 'temporary-microwave-food-consumed-at-desk',
      validDropOff: SERVER_SCRIPTED_DROP_OFFS,
    };
  }
  return null;
}

function pickServerScriptedVendingItem(agentId, target = null) {
  const forced = String(target?.vendingItemId || target?.itemId || '').trim().toLowerCase();
  const forcedItem = SERVER_SCRIPTED_VENDING_ITEM_OPTIONS.find(item => item.id === forced || item.label.toLowerCase() === forced);
  if (forcedItem) return forcedItem;
  const index = stableTextHash(`${agentId || ''}:${target?.objectKey || ''}:${target?.spotId || ''}`) % SERVER_SCRIPTED_VENDING_ITEM_OPTIONS.length;
  return SERVER_SCRIPTED_VENDING_ITEM_OPTIONS[index] || SERVER_SCRIPTED_VENDING_ITEM_OPTIONS[0];
}

function pickServerScriptedMicrowaveFood(agentId, target = null) {
  const forced = String(target?.microwaveFoodId || target?.foodItemId || target?.foodType || '').trim().toLowerCase();
  const forcedItem = SERVER_SCRIPTED_MICROWAVE_FOOD_OPTIONS.find(item => item.id === forced || item.label.toLowerCase() === forced);
  if (forcedItem) return forcedItem;
  const index = stableTextHash(`${agentId || ''}:${target?.objectKey || ''}:${target?.spotId || ''}`) % SERVER_SCRIPTED_MICROWAVE_FOOD_OPTIONS.length;
  return SERVER_SCRIPTED_MICROWAVE_FOOD_OPTIONS[index] || SERVER_SCRIPTED_MICROWAVE_FOOD_OPTIONS[0];
}

function makeServerScriptedTemporaryItem(agentId, sourceTarget = null, spec = null, nowMs = Date.now()) {
  if (!spec) return null;
  const expiresAt = new Date(nowMs + SERVER_SCRIPTED_OBJECT_TEMPORARY_ITEM_CARRIED_TTL_MS).toISOString();
  let itemPatch = {};
  if (spec.kind === 'vending') {
    const vendingItem = pickServerScriptedVendingItem(agentId, sourceTarget);
    itemPatch = {
      idPart: vendingItem.id,
      label: vendingItem.label,
      kind: vendingItem.kind,
      visualKind: vendingItem.visualKind,
      vendingItemId: vendingItem.id,
      packageColor: vendingItem.packageColor,
      accentColor: vendingItem.accentColor,
      needEffects: vendingItem.needEffects,
      satisfies: vendingItem.kind === 'drink' ? ['thirst'] : ['hunger'],
    };
  } else if (spec.kind === 'microwave') {
    const foodItem = pickServerScriptedMicrowaveFood(agentId, sourceTarget);
    itemPatch = {
      idPart: foodItem.id,
      label: foodItem.label,
      visualKind: foodItem.visualKind,
      microwaveFoodId: foodItem.id,
      packageColor: foodItem.packageColor,
      accentColor: foodItem.accentColor,
      satisfies: ['food', 'heated-food', 'microwave-food'],
    };
  }
  const idPart = safeText(itemPatch.idPart, spec.kind) || spec.kind;
  const sourceFurnitureType = safeText(sourceTarget?.objectType || sourceTarget?.sourceFurnitureType, spec.kind) || spec.kind;
  const item = {
    id: `${spec.idPrefix}-${idPart}-${agentId || 'agent'}-${nowMs}`,
    catalogId: 'temporaryFood',
    label: safeText(itemPatch.label, spec.label) || spec.label,
    kind: safeText(itemPatch.kind, spec.itemKind) || spec.itemKind,
    state: 'carried',
    consumable: true,
    attachPoint: 'right-hand',
    validDropOff: spec.validDropOff || SERVER_SCRIPTED_DROP_OFFS,
    sourceFurnitureType,
    sourceBuildingId: safeText(sourceTarget?.buildingId, '') || null,
    sourceFurnitureIndex: Number.isFinite(Number(sourceTarget?.furnitureIndex)) ? Number(sourceTarget.furnitureIndex) : null,
    temporaryUse: {
      state: 'carried',
      expiresAt,
      persistence: { mode: 'omit-on-save', omitOnSave: true, owner: spec.persistenceOwner },
    },
    temporary: true,
    carryable: true,
    expiresAt,
  };
  const visualKind = safeText(itemPatch.visualKind, spec.visualKind || '');
  const drinkKind = safeText(spec.drinkKind, '');
  const carryItem = safeText(spec.carryItem, '');
  if (visualKind) item.visualKind = visualKind;
  if (drinkKind) item.drinkKind = drinkKind;
  if (carryItem) item.carryItem = carryItem;
  if (itemPatch.vendingItemId) item.vendingItemId = itemPatch.vendingItemId;
  if (itemPatch.microwaveFoodId) item.microwaveFoodId = itemPatch.microwaveFoodId;
  const packageColor = numberOr(itemPatch.packageColor, NaN);
  const accentColor = numberOr(itemPatch.accentColor, NaN);
  if (Number.isFinite(packageColor) && Math.abs(packageColor) <= 10000000) item.packageColor = packageColor;
  if (Number.isFinite(accentColor) && Math.abs(accentColor) <= 10000000) item.accentColor = accentColor;
  if (itemPatch.needEffects) item.needEffects = itemPatch.needEffects;
  if (itemPatch.satisfies) item.satisfies = itemPatch.satisfies;
  return item;
}

function isServerScriptedObjectDeskConsumeTarget(target = null) {
  const phase = String(target?.runtimePhase || '').trim().toLowerCase();
  const kind = String(target?.activityKind || target?.kind || '').trim().toLowerCase();
  return phase === 'desk-routing' || phase === 'desk-consuming' || kind === 'coffee-desk-consume' || kind === 'water-desk-consume' || kind === 'vending-desk-consume' || kind === 'microwave-desk-consume';
}

function serverScriptedObjectRouteShouldRun(target = null, isMoving = false) {
  return Boolean(isMoving && isServerScriptedObjectDeskConsumeTarget(target));
}

function serverScriptedObjectRuntimeSpeedUnitsPerSec(target = null, isMoving = false) {
  return serverScriptedObjectRouteShouldRun(target, isMoving)
    ? SERVER_SCRIPTED_OBJECT_RUNTIME_RUN_SPEED_UNITS_PER_SEC
    : SERVER_SCRIPTED_OBJECT_RUNTIME_SPEED_UNITS_PER_SEC;
}

function hydrateServerScriptedDeskConsumeTargetFromVisual(target = null, visualState = null) {
  if (!isServerScriptedObjectDeskConsumeTarget(target) || target?.temporaryItem) return target;
  const carriedItem = visualState?.carriedItem && typeof visualState.carriedItem === 'object'
    ? visualState.carriedItem
    : (visualState?.activity?.temporaryItem && typeof visualState.activity.temporaryItem === 'object' ? visualState.activity.temporaryItem : null);
  if (!carriedItem) return target;
  return {
    ...target,
    temporaryItem: carriedItem,
    carriedItem,
    carrying: true,
    carryAttachPoint: safeText(target?.carryAttachPoint, 'right-hand') || 'right-hand',
    lifecycle: { stationary: false, carryable: false, temporary: true, consumesTemporary: true },
  };
}

function makeServerScriptedDeskConsumeTarget(dataDir, agentId, sourceTarget = null, nowMs = Date.now()) {
  const spec = serverScriptedObjectDispenseSpec(sourceTarget);
  if (!spec) return null;
  const meta = readWorldMetaDocument(dataDir);
  const workTargets = listLiveStatusWorkTargets(dataDir);
  if (!workTargets.length) return null;
  let deskTarget = pickLiveStatusWorkTarget(agentId, { meta, targets: workTargets, workingAgentIds: [agentId] });
  if (!deskTarget && sourceTarget?.buildingId) {
    deskTarget = workTargets.find(entry => entry.buildingId === sourceTarget.buildingId)?.target || null;
  }
  if (!deskTarget && workTargets[0]) deskTarget = workTargets[0].target;
  if (!deskTarget || !Number.isFinite(Number(deskTarget.x)) || !Number.isFinite(Number(deskTarget.y))) return null;
  const baseObjectKey = liveStatusRuntimeObjectKey(deskTarget) || runtimeFurnitureObjectKey(deskTarget.buildingId, deskTarget.furnitureIndex, deskTarget.objectType || 'desk');
  const objectKey = normalizeWorldObjectKey(`${baseObjectKey}:consume:${safeText(agentId, 'agent') || 'agent'}`);
  const temporaryItem = makeServerScriptedTemporaryItem(agentId, sourceTarget, spec, nowMs);
  const consumeDurationMs = Math.max(1000, Math.floor(numberOr(sourceTarget?.consumeDurationMs ?? sourceTarget?.deskConsumeMs, SERVER_SCRIPTED_OBJECT_DESK_CONSUME_MS)));
  return {
    ...deskTarget,
    targetKind: 'work-desk',
    objectKey,
    baseObjectKey,
    objectType: deskTarget.objectType || 'desk',
    behaviorCategory: 'work-return',
    actionId: spec.deskActionId,
    activityKind: spec.deskActivityKind,
    animationId: spec.deskAnimationId,
    poseKind: 'seat',
    stayMs: consumeDurationMs,
    consumeDurationMs,
    temporaryItem,
    carriedItem: temporaryItem,
    carryAttachPoint: 'right-hand',
    carrying: true,
    sourceObjectKey: safeText(sourceTarget?.objectKey, ''),
    sourceBaseObjectKey: safeText(sourceTarget?.baseObjectKey, ''),
    sourceObjectType: safeText(sourceTarget?.objectType, ''),
    sourceBuildingId: safeText(sourceTarget?.buildingId, ''),
    sourceFurnitureIndex: Number.isFinite(Number(sourceTarget?.furnitureIndex)) ? Number(sourceTarget.furnitureIndex) : null,
    sourceActionId: safeText(sourceTarget?.actionId, ''),
    sourceActivityKind: safeText(sourceTarget?.activityKind, ''),
    runtimePhase: 'desk-routing',
    runtimeSource: safeText(sourceTarget?.runtimeSource, 'idle') || 'idle',
    runtimeStartedAt: new Date(nowMs).toISOString(),
    runtimeActiveAt: '',
    pickupEffect: spec.pickupEffect,
    consumeEffect: spec.consumeEffect,
    completionState: spec.deskCompletionState,
    lifecycle: { stationary: false, carryable: false, temporary: true, consumesTemporary: true },
  };
}

const SCRIPTED_OBJECT_SKIP_ACTIONS = new Set(['sit_work', 'work.desk']);
const SCRIPTED_OBJECT_SKIP_TYPES = new Set(['desk', 'standingdesk', 'laptopmonitorprops']);
const SCRIPTED_OBJECT_ALLOWED_TYPES = new Set(Object.keys(SERVER_SCRIPTED_OBJECT_ACTIVITY_CONFIG));
const SCRIPTED_OBJECT_ALLOWED_ROLES = new Set(['use', 'seat', 'social', 'browse', 'read', 'rest', 'relax', 'drink', 'food', 'play', 'inspect', 'exercise', 'wait', 'meeting', 'queue', 'approach', 'staging']);
const SERVER_SCRIPTED_IDLE_CATEGORY_WEIGHTS = Object.freeze({
  'snack-drink': 30,
  socialize: 26,
  rest: 24,
  'browse-read': 22,
  play: 18,
  wander: 16,
  'work-return': 3,
});
const SERVER_SCRIPTED_IDLE_CATEGORY_OBJECT_TYPES = Object.freeze({
  rest: Object.freeze(['couch', 'sectionalSofa', 'loveseat', 'armchair', 'hallwayBench', 'smallCafeTable', 'patioTable', 'smallRoundMeetingTable', 'chair', 'officeChair']),
  'snack-drink': Object.freeze(['waterCooler', 'countertopCoffeeMachine', 'vending', 'fridge', 'microwave', 'cafeCounter', 'counter', 'kitchenIsland', 'pantryShelf', 'displayCase']),
  'browse-read': Object.freeze(['bookshelf', 'bulletinBoard', 'menuBoard', 'whiteboard', 'wallArt', 'shopShelf', 'supplyCabinet', 'medicalSupplyCabinet', 'pantryShelf', 'displayCase', 'displayMannequin', 'tvStand', 'mirror', 'storageBoxes', 'serverRack', 'toolCart', 'workbench']),
  play: Object.freeze(['pingpong', 'poolTable', 'arcadeMachine', 'gamingStation', 'treadmill', 'trainingMat', 'gymBench', 'dumbbellRack']),
});
const SERVER_SCRIPTED_IDLE_SOCIAL_OBJECT_TYPES = new Set([
  ...SERVER_SCRIPTED_IDLE_CATEGORY_OBJECT_TYPES.rest,
  'meetingTable',
  'conferenceChair',
  'pingpong',
  'poolTable',
  'arcadeMachine',
]);
const SERVER_SCRIPTED_IDLE_SOCIAL_OBJECT_TYPE_KEYS = new Set(
  Array.from(SERVER_SCRIPTED_IDLE_SOCIAL_OBJECT_TYPES).map(value => String(value || '').trim().toLowerCase()),
);

function isAgentLiveModeEnabledForServer(meta, agentId, presenceRecord = null) {
  const profiles = meta?.agentProfiles && typeof meta.agentProfiles === 'object' && !Array.isArray(meta.agentProfiles)
    ? meta.agentProfiles
    : {};
  const profile = profiles[agentId] && typeof profiles[agentId] === 'object' && !Array.isArray(profiles[agentId])
    ? profiles[agentId]
    : {};
  const record = presenceRecord && typeof presenceRecord === 'object' && !Array.isArray(presenceRecord) ? presenceRecord : {};
  return Boolean(
    profile.agentLiveModeEnabled === true ||
    profile.liveModeEnabled === true ||
    profile.liveMode === true ||
    record.agentLiveModeEnabled === true ||
    record.liveModeEnabled === true
  );
}

function isAgentScriptedAmbientEnabledForServer(meta, agentId, presenceRecord = null) {
  const profiles = meta?.agentProfiles && typeof meta.agentProfiles === 'object' && !Array.isArray(meta.agentProfiles)
    ? meta.agentProfiles
    : {};
  const profile = profiles[agentId] && typeof profiles[agentId] === 'object' && !Array.isArray(profiles[agentId])
    ? profiles[agentId]
    : {};
  const record = presenceRecord && typeof presenceRecord === 'object' && !Array.isArray(presenceRecord) ? presenceRecord : {};
  return !(
    profile.scriptedAmbientEnabled === false ||
    profile.scriptedModeEnabled === false ||
    profile.ambientEnabled === false ||
    record.scriptedAmbientEnabled === false ||
    record.scriptedModeEnabled === false ||
    record.ambientEnabled === false
  );
}

function isPresenceIdleForScriptedObjectRuntime(record) {
  return SCRIPTED_OBJECT_IDLE_STATES.has(normalizePresenceState(record));
}

function runtimeFurnitureObjectKey(buildingId, furnitureIndex, furnitureType = 'object') {
  const bid = safeText(buildingId, 'building') || 'building';
  const index = Number.isFinite(Number(furnitureIndex)) ? Number(furnitureIndex) : 'unknown';
  const type = safeText(furnitureType, 'object') || 'object';
  if (type === 'treadmill') return `${bid}:treadmill:${index}`;
  if (type === 'trainingMat') return `${bid}:trainingMat:${index}`;
  if (type === 'gymBench') return `${bid}:gymBench:${index}`;
  if (type === 'outdoorExerciseStation') return `${bid}:outdoorExerciseStation:${index}`;
  if (type === 'playgroundSlide') return `${bid}:playgroundSlide:${index}`;
  if (type === 'arcadeMachine') return `${bid}:arcadeMachine:${index}`;
  return `${bid}:furniture:${index}:${type}`;
}

function scriptedObjectSpotId(location = null) {
  return safeText(location?.interactionSpotId || location?.spotId || location?.activationSpotId || location?.id, 'default') || 'default';
}

function scriptedObjectActionId(furniture = null, location = null) {
  return safeText(
    location?.actionId ||
    location?.action ||
    location?.uiActionId ||
    location?.apiActionId ||
    furniture?.actionId ||
    `object.use.${safeText(furniture?.type, 'object') || 'object'}`,
    'object.use',
  ) || 'object.use';
}

function scriptedObjectRoles(location = null) {
  return Array.isArray(location?.roles)
    ? location.roles.map(role => String(role || '').trim().toLowerCase()).filter(Boolean)
    : [];
}

function scriptedObjectActivityConfig(furniture = null, target = null) {
  const objectType = String(target?.objectType || furniture?.type || '').trim().toLowerCase();
  return SERVER_SCRIPTED_OBJECT_ACTIVITY_CONFIG[objectType] || null;
}

function normalizeObjectTypeKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function scriptedIdleObjectTypeSet(category) {
  if (category === 'socialize') return SERVER_SCRIPTED_IDLE_SOCIAL_OBJECT_TYPE_KEYS;
  const types = SERVER_SCRIPTED_IDLE_CATEGORY_OBJECT_TYPES[category] || [];
  return new Set(types.map(normalizeObjectTypeKey));
}

function scriptedIdleCategoryForObjectType(objectType = '') {
  const key = normalizeObjectTypeKey(objectType);
  for (const [category, types] of Object.entries(SERVER_SCRIPTED_IDLE_CATEGORY_OBJECT_TYPES)) {
    if (types.map(normalizeObjectTypeKey).includes(key)) return category;
  }
  if (SERVER_SCRIPTED_IDLE_SOCIAL_OBJECT_TYPE_KEYS.has(key)) return 'socialize';
  return '';
}

function scriptedObjectPreferredSpotIds(furniture = null) {
  const config = scriptedObjectActivityConfig(furniture);
  return [
    config?.spotId,
    config?.activationSpotId,
    'seat',
    'use-front',
    'approach-front',
    'default',
  ].map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
}

function isScriptedObjectQueueSpot(location = null, furniture = null) {
  const roles = scriptedObjectRoles(location);
  const spotId = String(scriptedObjectSpotId(location) || '').toLowerCase();
  const actionId = String(scriptedObjectActionId(furniture, location) || '').toLowerCase();
  return Boolean(
    roles.includes('queue') ||
    roles.includes('staging') ||
    location?.serviceQueue === true ||
    location?.queueAddon === true ||
    location?.capacityKind === 'queue' ||
    spotId.includes('queue') ||
    actionId === 'planning.schedule'
  );
}

function isLiveServerScriptedServiceQueueReservation(entry = null) {
  return Boolean(entry && !SERVER_SCRIPTED_QUEUE_TERMINAL_STATES.has(String(entry.state || entry.status || '').toLowerCase()));
}

function normalizeServerScriptedServiceQueueReservations(store = null) {
  if (!store || typeof store !== 'object') return [];
  if (!Array.isArray(store.reservations)) store.reservations = [];
  store.reservations = store.reservations
    .filter(isLiveServerScriptedServiceQueueReservation)
    .sort((a, b) =>
      Number(a.queuePriority || 0) - Number(b.queuePriority || 0) ||
      Number(a.queuedAtMs || 0) - Number(b.queuedAtMs || 0) ||
      String(a.agentId || '').localeCompare(String(b.agentId || ''))
    )
    .map((entry, index) => {
      const queueSpotId = safeText(String(entry.queueSpotId || entry.spotId || entry.slotId || 'queue').replace(/:\d+$/, ''), 'queue') || 'queue';
      const queueTargetId = `${queueSpotId}:${index}`;
      return {
        ...entry,
        state: safeText(entry.state, 'queued') || 'queued',
        status: safeText(entry.status, 'queued') || 'queued',
        queueSpotId,
        queueIndex: index,
        slotId: queueTargetId,
        queueTargetId,
        activationSpotId: queueTargetId,
      };
    });
  return store.reservations;
}

function cloneServerScriptedServiceQueueStore(store = null) {
  const next = { reservations: Array.isArray(store?.reservations) ? store.reservations.map(entry => ({ ...entry })) : [] };
  normalizeServerScriptedServiceQueueReservations(next);
  return next;
}

function hasServerScriptedServiceQueueStoreData(data = null) {
  return Boolean(data && typeof data === 'object' && (data._scriptedServiceQueueStore || data.serviceQueueStore || data.scriptedServiceQueueStore));
}

function serverScriptedServiceQueueStoreFromWorldObject(object = null) {
  const plain = object ? worldObjectToPlain(object) : null;
  const data = plain?.data && typeof plain.data === 'object' ? plain.data : {};
  const raw = data._scriptedServiceQueueStore || data.serviceQueueStore || data.scriptedServiceQueueStore || null;
  return cloneServerScriptedServiceQueueStore(raw);
}

function serverScriptedServiceQueueStoreData(store = null, options = {}) {
  const reservations = cloneServerScriptedServiceQueueStore(store).reservations;
  return {
    _scriptedServiceQueueStore: { reservations: reservations.map(entry => ({ ...entry })) },
    serviceQueueStore: { reservations: reservations.map(entry => ({ ...entry })) },
    clearServiceQueue: reservations.length === 0 && options.clearEmpty === true,
  };
}

function serverScriptedQueueBaseObjectKey(target = null) {
  const base = safeText(target?.baseObjectKey, '');
  if (base) return base;
  const objectKey = safeText(target?.objectKey, '');
  const queueIndex = objectKey.indexOf(':queue:');
  return queueIndex >= 0 ? objectKey.slice(0, queueIndex) : objectKey;
}

function serverScriptedQueueSpotId(target = null, fallback = 'queue') {
  return safeText(String(target?.queueSpotId || target?.spotId || target?.interactionSpotId || target?.slotId || fallback || 'queue').replace(/:\d+$/, ''), 'queue') || 'queue';
}

function serverScriptedQueueObjectKey(baseObjectKey, reservation = null) {
  const queueSpotId = safeText(reservation?.queueSpotId, 'queue') || 'queue';
  const queueIndex = Math.max(0, Math.floor(numberOr(reservation?.queueIndex, 0)));
  return normalizeWorldObjectKey(`${baseObjectKey}:queue:${queueSpotId}:${queueIndex}`);
}

function getServerAuthoredObjectQueueLocations(queueDef = {}, furniture = {}) {
  queueDef = queueDef || {};
  furniture = furniture || {};
  const queueConfig = queueDef.queueConfig || furniture.queueConfig || furniture.serviceQueue || null;
  const raw = Array.isArray(queueDef.queueLocations) ? queueDef.queueLocations
    : Array.isArray(queueDef.queuePositions) ? queueDef.queuePositions
      : Array.isArray(queueDef.queuePoints) ? queueDef.queuePoints
        : Array.isArray(queueConfig?.locations) ? queueConfig.locations
          : Array.isArray(queueConfig?.positions) ? queueConfig.positions
            : Array.isArray(queueConfig?.points) ? queueConfig.points
              : Array.isArray(furniture.queueLocations) ? furniture.queueLocations
                : Array.isArray(furniture.queuePositions) ? furniture.queuePositions
                  : Array.isArray(furniture.queuePoints) ? furniture.queuePoints
                    : [];
  return raw.map((spot, index) => ({
    ...spot,
    id: safeText(spot?.id || spot?.spotId || spot?.slotId || `${queueDef.id || queueDef.spotId || 'queue'}:${index}`, `${queueDef.id || queueDef.spotId || 'queue'}:${index}`),
    spotId: safeText(spot?.spotId || spot?.id || spot?.slotId || `${queueDef.id || queueDef.spotId || 'queue'}:${index}`, `${queueDef.id || queueDef.spotId || 'queue'}:${index}`),
    slotId: safeText(spot?.slotId || spot?.spotId || spot?.id || `${queueDef.id || queueDef.spotId || 'queue'}:${index}`, `${queueDef.id || queueDef.spotId || 'queue'}:${index}`),
    queueIndex: Math.max(0, Math.floor(numberOr(spot?.queueIndex ?? spot?.index, index))),
    roles: Array.isArray(spot?.roles) && spot.roles.length ? spot.roles : ['queue'],
    capacityKind: spot?.capacityKind || 'queue',
    serviceQueue: spot?.serviceQueue !== false,
  })).sort((a, b) => a.queueIndex - b.queueIndex || String(a.id || '').localeCompare(String(b.id || '')));
}

function serverScriptedServiceQueueDefinitionsForFurniture(furniture = {}) {
  if (!furniture) return [];
  const authoredLocations = Array.isArray(furniture.actionLocations) ? furniture.actionLocations : [];
  const configured = authoredLocations.filter(location => isScriptedObjectQueueSpot(location, furniture));
  if (configured.length) return configured;
  const explicit = furniture.queuePolicy ?? furniture.usePolicy ?? furniture.occupancyPolicy ?? furniture.servicePolicy ?? furniture.queueAddon;
  const explicitEnabled = explicit === true || ['queue', 'service-queue', 'required-queue', 'first-come-first-served'].includes(String(explicit || '').toLowerCase());
  const queueLocations = getServerAuthoredObjectQueueLocations({ id: 'queue', spotId: 'queue' }, furniture);
  if ((explicitEnabled || furniture.queue === true || furniture.serviceQueue === true || furniture.queueConfig) && queueLocations.length) {
    return [{
      id: 'queue',
      spotId: 'queue',
      actionId: 'planning.schedule',
      action: 'planning.schedule',
      roles: ['queue'],
      capacityKind: 'queue',
      serviceQueue: true,
      queueLocations,
    }];
  }
  return [];
}

function serverScriptedServiceQueueDefinitionForFurniture(furniture = {}, preferredQueueSpotId = '') {
  const preferred = safeText(String(preferredQueueSpotId || '').replace(/:\d+$/, ''), '');
  return serverScriptedServiceQueueDefinitionsForFurniture(furniture).find(location => {
    const spotId = serverScriptedQueueSpotId(location);
    return preferred && spotId === preferred;
  }) || serverScriptedServiceQueueDefinitionsForFurniture(furniture)[0] || null;
}

function findServerScriptedObjectFurniture(dataDir, target = null) {
  const buildingId = safeText(target?.buildingId, '');
  const furnitureIndex = Number(target?.furnitureIndex);
  if (!buildingId || !Number.isFinite(furnitureIndex) || furnitureIndex < 0) return null;
  const building = listBuildingDocuments(dataDir).find(item => item?.id === buildingId) || null;
  const furniture = building?.interior?.furniture?.[Math.floor(furnitureIndex)] || null;
  if (!building || !furniture) return null;
  return { building, furniture, furnitureIndex: Math.floor(furnitureIndex) };
}

function getServerScriptedServiceQueueMaxPoints(dataDir, target = null) {
  const found = findServerScriptedObjectFurniture(dataDir, target);
  const furniture = found?.furniture || null;
  const queueDef = serverScriptedServiceQueueDefinitionForFurniture(furniture, serverScriptedQueueSpotId(target));
  const authoredQueueLocations = getServerAuthoredObjectQueueLocations(queueDef || {}, furniture || {});
  const capacity = typeof queueDef?.capacity === 'number' ? queueDef.capacity : Number(queueDef?.capacity?.maxAgents || 0);
  return Math.max(1, Math.floor(numberOr(
    queueDef?.queueMaxPoints ?? queueDef?.maxQueuePoints ?? queueDef?.queueCapacity ?? capacity ?? target?.queueMaxPoints,
    authoredQueueLocations.length || SERVER_SCRIPTED_OBJECT_QUEUE_DEFAULT_CAPACITY,
  )));
}

function scriptedObjectStayMs(target = null) {
  const config = scriptedObjectActivityConfig(null, target);
  const stay = Array.isArray(config?.stayMs) ? config.stayMs : null;
  if (!stay || stay.length === 0) return SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS;
  const min = Math.max(1000, Math.floor(numberOr(stay[0], SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS)));
  const max = Math.max(min, Math.floor(numberOr(stay[1] ?? stay[0], min)));
  const seed = stableTextHash(`${target?.objectKey || ''}:${target?.agentId || ''}:${target?.spotId || ''}`);
  return min + (seed % Math.max(1, max - min + 1));
}

function isScriptedObjectSpotUsable(furniture = null, location = null) {
  const objectType = String(furniture?.type || '').trim().toLowerCase();
  if (!objectType || SCRIPTED_OBJECT_SKIP_TYPES.has(objectType)) return false;
  const actionId = scriptedObjectActionId(furniture, location);
  if (SCRIPTED_OBJECT_SKIP_ACTIONS.has(actionId)) return false;
  const roles = scriptedObjectRoles(location);
  const spotId = String(scriptedObjectSpotId(location) || '').toLowerCase();
  if (roles.includes('work') && actionId === 'work.desk') return false;
  if (isScriptedObjectQueueSpot(location, furniture)) return true;
  const config = scriptedObjectActivityConfig(furniture);
  const preferredSpotIds = scriptedObjectPreferredSpotIds(furniture);
  if (location && preferredSpotIds.includes(spotId)) return true;
  if (roles.some(role => SCRIPTED_OBJECT_ALLOWED_ROLES.has(role))) return true;
  if (SCRIPTED_OBJECT_ALLOWED_TYPES.has(objectType)) return true;
  return Boolean(config) || /(^|[.-])(use|rest|read|browse|drink|coffee|water|snack|play|inspect|exercise|meeting|queue)($|[.-])/i.test(actionId);
}

function scriptedObjectFallbackOffset(furniture = null) {
  const config = scriptedObjectActivityConfig(furniture);
  if (config?.poseKind === 'seat') {
    return { dx: 0, dz: 0.15, facing: 'north', poseKind: 'seat' };
  }
  return { dx: 0, dz: 0.82, facing: 'north', poseKind: 'stand-use' };
}

function localPointFromScriptedObjectSpot(furniture = null, location = null) {
  const explicit = location?.actionTarget || location?.buildingLocal || location?.activationTarget || null;
  const x = numberOr(explicit?.x, NaN);
  const z = numberOr(explicit?.z, NaN);
  const fallback = scriptedObjectFallbackOffset(furniture);
  const config = scriptedObjectActivityConfig(furniture);
  const isQueue = isScriptedObjectQueueSpot(location, furniture);
  const faceAngle = authoredRuntimeFaceAngle(location, explicit);
  if (Number.isFinite(x) && Number.isFinite(z)) {
    const roles = scriptedObjectRoles(location);
    return {
      x,
      z,
      floor: floorOr(location?.floor ?? explicit?.floor ?? furniture?.floor, 1),
      facing: authoredRuntimeFacing(location, explicit, fallback.facing),
      faceAngle,
      poseKind: isQueue ? 'wait' : (roles.includes('seat') ? 'seat' : (config?.poseKind || fallback.poseKind)),
    };
  }
  const rotated = rotateRuntimeLocalOffset(fallback.dx, fallback.dz, furniture?.rotation || 0);
  return {
    x: numberOr(furniture?.x, 0) + rotated.x,
    z: numberOr(furniture?.z, 0) + rotated.z,
    floor: floorOr(furniture?.floor, 1),
    facing: fallback.facing,
    faceAngle: null,
    poseKind: config?.poseKind || fallback.poseKind,
  };
}

function scriptedObjectTargetFromFurnitureSpot(building = null, furniture = null, index = -1, location = null) {
  if (!building || !furniture || !isScriptedObjectSpotUsable(furniture, location)) return null;
  const config = scriptedObjectActivityConfig(furniture);
  const local = localPointFromScriptedObjectSpot(furniture, location);
  const world = location?.world && typeof location.world === 'object' && !Array.isArray(location.world) ? location.world : null;
  const worldX = numberOr(world?.x, NaN);
  const worldZ = numberOr(world?.z ?? world?.y, NaN);
  const localPoint = apiPointFromBuildingLocal(building, local.x, local.z);
  const worldPoint = Number.isFinite(worldX) && Number.isFinite(worldZ)
    ? { x: worldX * LIVE_ACTION_API_TILE, y: worldZ * LIVE_ACTION_API_TILE }
    : null;
  const coordinateSpace = String(location?.coordinateSpace || location?.actionTarget?.coordinateSpace || location?.activationTarget?.coordinateSpace || '').trim().toLowerCase();
  const preferLocalPoint = Boolean(
    localPoint &&
    (coordinateSpace === 'building-local' || !worldPoint || (worldPoint && !buildingContainsApiPoint(building, worldPoint.x, worldPoint.y)))
  );
  const point = preferLocalPoint ? localPoint : (worldPoint || localPoint);
  if (!point) return null;
  const objectType = safeText(furniture.type, 'object') || 'object';
  const behaviorCategory = scriptedIdleCategoryForObjectType(objectType);
  const baseObjectKey = normalizeWorldObjectKey(runtimeFurnitureObjectKey(building.id || 'building', index, objectType));
  const spotId = scriptedObjectSpotId(location);
  const actionId = scriptedObjectActionId(furniture, location);
  const isQueueUse = isScriptedObjectQueueSpot(location, furniture);
  const objectKey = isQueueUse ? normalizeWorldObjectKey(`${baseObjectKey}:queue:${spotId}`) : baseObjectKey;
  const objectInstanceId = safeText(furniture.objectInstanceId || furniture.instanceId || furniture.id || `${building.id}:furniture:${index}`, '');
  return {
    x: point.x,
    y: point.y,
    floor: local.floor,
    buildingId: safeText(building.id, ''),
    roomId: safeText(furniture.room, ''),
    targetKind: 'scripted-object',
    objectKey,
    baseObjectKey,
    objectInstanceId,
    furnitureIndex: index,
    objectType,
    behaviorCategory,
    actionId,
    interactionSpotId: spotId,
    spotId,
    slotId: safeText(location?.slotId || location?.seatId || spotId, spotId) || spotId,
    poseKind: local.poseKind,
    isQueueUse,
    animationId: isQueueUse ? 'bus-stop-wait' : (safeText(config?.animationId, '') || (local.poseKind === 'seat' ? 'sit' : 'stand-use')),
    activityKind: isQueueUse ? 'service-queue-wait' : (safeText(config?.kind, '') || 'server-scripted-object-use'),
    stayMs: scriptedObjectStayMs({ objectKey: baseObjectKey, objectType, spotId }),
    faceAngle: runtimeFurnitureActionFaceAngle(building, furniture, local, point),
  };
}

function serverScriptedObjectPrimaryTargetForQueue(dataDir, queueTarget = null) {
  const baseObjectKey = serverScriptedQueueBaseObjectKey(queueTarget);
  return listScriptedObjectRuntimeTargets(dataDir).find(target =>
    !target.isQueueUse &&
    (safeText(target.baseObjectKey, '') || target.objectKey) === baseObjectKey
  ) || null;
}

function serverScriptedQueueRuntimeTargetForBase(dataDir, baseTarget = null) {
  const baseObjectKey = serverScriptedQueueBaseObjectKey(baseTarget);
  return listScriptedObjectRuntimeTargets(dataDir).find(target =>
    target.isQueueUse &&
    (safeText(target.baseObjectKey, '') || serverScriptedQueueBaseObjectKey(target)) === baseObjectKey
  ) || null;
}

function serverScriptedServiceQueueSlotTarget(dataDir, queueTarget = null, reservation = null) {
  if (!queueTarget || !reservation) return null;
  const baseObjectKey = serverScriptedQueueBaseObjectKey(queueTarget);
  if (!baseObjectKey) return null;
  const found = findServerScriptedObjectFurniture(dataDir, queueTarget);
  const building = found?.building || null;
  const furniture = found?.furniture || null;
  const furnitureIndex = found?.furnitureIndex ?? queueTarget.furnitureIndex;
  const queueSpotId = safeText(reservation.queueSpotId || serverScriptedQueueSpotId(queueTarget), 'queue') || 'queue';
  const queueIndex = Math.max(0, Math.floor(numberOr(reservation.queueIndex, 0)));
  const slotId = `${queueSpotId}:${queueIndex}`;
  const objectKey = serverScriptedQueueObjectKey(baseObjectKey, { ...reservation, queueSpotId, queueIndex });
  const primaryTarget = serverScriptedObjectPrimaryTargetForQueue(dataDir, queueTarget);
  if (building && furniture) {
    const queueDef = serverScriptedServiceQueueDefinitionForFurniture(furniture, queueSpotId);
    const authoredLocation = getServerAuthoredObjectQueueLocations(queueDef || {}, furniture)
      .find(spot => Number(spot.queueIndex || 0) === queueIndex) || null;
    if (authoredLocation) {
      const authoredTarget = scriptedObjectTargetFromFurnitureSpot(building, furniture, furnitureIndex, {
        ...authoredLocation,
        id: authoredLocation.id || slotId,
        spotId: authoredLocation.spotId || slotId,
        slotId: authoredLocation.slotId || slotId,
        actionId: reservation.actionId || queueDef?.actionId || queueDef?.action || 'planning.schedule',
        roles: Array.isArray(authoredLocation.roles) && authoredLocation.roles.length ? authoredLocation.roles : ['queue'],
        serviceQueue: true,
        capacityKind: 'queue',
      });
      const authoredX = numberOr(authoredTarget?.x, NaN);
      const authoredY = numberOr(authoredTarget?.y, NaN);
      if (authoredTarget && Number.isFinite(authoredX) && Number.isFinite(authoredY)) {
        const authoredFaceAngle = Number.isFinite(Number(authoredTarget.faceAngle))
          ? normalizeRuntimeAngleRadians(authoredTarget.faceAngle, 0)
          : (primaryTarget ? normalizeRuntimeAngleRadians(Math.atan2(Number(primaryTarget.x) - authoredX, Number(primaryTarget.y) - authoredY), queueTarget.faceAngle || 0) : normalizeRuntimeAngleRadians(queueTarget.faceAngle, 0));
        return {
          ...queueTarget,
          ...authoredTarget,
          x: authoredX,
          y: authoredY,
          objectKey,
          baseObjectKey,
          isQueueUse: true,
          poseKind: 'wait',
          animationId: 'bus-stop-wait',
          activityKind: 'service-queue-wait',
          interactionSpotId: slotId,
          spotId: slotId,
          slotId,
          queueSpotId,
          queueIndex,
          queueTargetId: slotId,
          routeSpotRole: 'serviceQueueSlot',
          stayMs: Math.max(SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS, numberOr(queueTarget.stayMs, SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS)),
          faceAngle: authoredFaceAngle,
        };
      }
    }
    const queueDefTarget = queueDef ? scriptedObjectTargetFromFurnitureSpot(building, furniture, furnitureIndex, queueDef) : null;
    const primary = primaryTarget || scriptedObjectTargetFromFurnitureSpot(building, furniture, furnitureIndex, null);
    const queueAnchor = queueDefTarget || queueTarget || primary;
    const primaryX = numberOr(primary?.x, NaN);
    const primaryY = numberOr(primary?.y, NaN);
    const anchorX = numberOr(queueAnchor?.x, NaN);
    const anchorY = numberOr(queueAnchor?.y, NaN);
    if (primary && queueAnchor && Number.isFinite(primaryX) && Number.isFinite(primaryY) && Number.isFinite(anchorX) && Number.isFinite(anchorY)) {
      const dx = anchorX - primaryX;
      const dy = anchorY - primaryY;
      const len = Math.hypot(dx, dy) || 1;
      const spacing = (Number(queueDef?.queueSpacingTiles ?? queueDef?.spacingTiles ?? SERVER_SCRIPTED_OBJECT_QUEUE_SPACING_TILES) || SERVER_SCRIPTED_OBJECT_QUEUE_SPACING_TILES) * LIVE_ACTION_API_TILE;
      const x = primaryX + (dx / len) * spacing * (queueIndex + 1);
      const y = primaryY + (dy / len) * spacing * (queueIndex + 1);
      return {
        ...queueTarget,
        x,
        y,
        floor: floorOr(queueTarget.floor ?? primary.floor, 1),
        objectKey,
        baseObjectKey,
        isQueueUse: true,
        poseKind: 'wait',
        animationId: 'bus-stop-wait',
        activityKind: 'service-queue-wait',
        interactionSpotId: slotId,
        spotId: slotId,
        slotId,
        queueSpotId,
        queueIndex,
        queueTargetId: slotId,
        routeSpotRole: 'serviceQueueSlot',
        actionId: safeText(reservation.actionId || queueDef?.actionId || queueDef?.action || queueTarget.actionId, 'planning.schedule') || 'planning.schedule',
        stayMs: Math.max(SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS, numberOr(queueTarget.stayMs, SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS)),
        faceAngle: normalizeRuntimeAngleRadians(Math.atan2(primaryX - x, primaryY - y), queueTarget.faceAngle || 0),
      };
    }
  }
  return {
    ...queueTarget,
    x: numberOr(queueTarget.x, primaryTarget?.x ?? 0),
    y: numberOr(queueTarget.y, primaryTarget?.y ?? 0),
    faceAngle: normalizeRuntimeAngleRadians(queueTarget.faceAngle, primaryTarget?.faceAngle || 0),
    objectKey,
    baseObjectKey,
    isQueueUse: true,
    poseKind: 'wait',
    animationId: 'bus-stop-wait',
    activityKind: 'service-queue-wait',
    interactionSpotId: slotId,
    spotId: slotId,
    slotId,
    queueSpotId,
    queueIndex,
    queueTargetId: slotId,
    routeSpotRole: 'serviceQueueSlot',
  };
}

function listScriptedObjectRuntimeTargets(dataDir) {
  const targets = [];
  for (const building of listBuildingDocuments(dataDir)) {
    const furniture = Array.isArray(building?.interior?.furniture) ? building.interior.furniture : [];
    for (let index = 0; index < furniture.length; index += 1) {
      const item = furniture[index];
      if (!item || item.deleted || item.removed || item.enabled === false) continue;
      const locations = Array.isArray(item.actionLocations) && item.actionLocations.length > 0 ? item.actionLocations : [];
      const syntheticQueueLocations = serverScriptedServiceQueueDefinitionsForFurniture(item)
        .filter(location => !locations.some(existing => scriptedObjectSpotId(existing) === scriptedObjectSpotId(location)))
        .filter(location => !locations.some(existing => isScriptedObjectQueueSpot(existing, item) && serverScriptedQueueSpotId(existing) === serverScriptedQueueSpotId(location)));
      const preferredSpotIds = scriptedObjectPreferredSpotIds(item);
      const sortedLocations = [...locations, ...syntheticQueueLocations].sort((a, b) => {
        const aSpot = String(scriptedObjectSpotId(a) || '').toLowerCase();
        const bSpot = String(scriptedObjectSpotId(b) || '').toLowerCase();
        const aPreferred = preferredSpotIds.indexOf(aSpot);
        const bPreferred = preferredSpotIds.indexOf(bSpot);
        const aQueue = isScriptedObjectQueueSpot(a, item) ? 1 : 0;
        const bQueue = isScriptedObjectQueueSpot(b, item) ? 1 : 0;
        if (aQueue !== bQueue) return aQueue - bQueue;
        if (aPreferred !== bPreferred) return (aPreferred < 0 ? 999 : aPreferred) - (bPreferred < 0 ? 999 : bPreferred);
        return aSpot.localeCompare(bSpot);
      });
      const targetLocations = sortedLocations.length > 0 ? sortedLocations : [null];
      if (sortedLocations.length > 0 && scriptedObjectActivityConfig(item)) targetLocations.push(null);
      const seen = new Set();
      for (const location of targetLocations) {
        const target = scriptedObjectTargetFromFurnitureSpot(building, item, index, location);
        if (!target || seen.has(target.objectKey)) continue;
        seen.add(target.objectKey);
        targets.push(target);
      }
    }
  }
  return targets.sort((a, b) => `${a.buildingId}:${a.furnitureIndex}:${a.spotId}`.localeCompare(`${b.buildingId}:${b.furnitureIndex}:${b.spotId}`));
}

function isWorldObjectActiveForAnotherAgent(object = null, agentId = '', nowMs = Date.now()) {
  if (!hasActiveWorldObjectState(object, nowMs)) return false;
  return Boolean(object.agentId && agentId && object.agentId !== agentId);
}

function isServerScriptedObjectTargetAvailable(state, target, agentId, nowMs = Date.now()) {
  if (!target?.objectKey) return false;
  const object = state?.objects?.get?.(target.objectKey);
  if (isWorldObjectActiveForAnotherAgent(object, agentId, nowMs)) return false;
  const baseObjectKey = safeText(target.baseObjectKey, '') || target.objectKey;
  const baseObject = baseObjectKey !== target.objectKey ? state?.objects?.get?.(baseObjectKey) : object;
  const baseActiveForAnother = isWorldObjectActiveForAnotherAgent(baseObject, agentId, nowMs);
  const queueStore = serverScriptedServiceQueueStoreFromWorldObject(baseObject);
  const queueLength = normalizeServerScriptedServiceQueueReservations(queueStore).length;
  if (target.isQueueUse) return baseActiveForAnother || queueLength > 0;
  return !baseActiveForAnother && queueLength === 0;
}

function makeServerScriptedMemory() {
  return {
    recentCategories: [],
    recentObjects: [],
    failedTargets: [],
  };
}

function pruneServerScriptedMemory(memory, nowMs = Date.now()) {
  const next = memory || makeServerScriptedMemory();
  next.recentCategories = (next.recentCategories || [])
    .filter(entry => nowMs - Number(entry.lastUsedAtMs || 0) < SERVER_SCRIPTED_IDLE_CATEGORY_COOLDOWN_MS)
    .slice(0, 12);
  next.recentObjects = (next.recentObjects || [])
    .filter(entry => nowMs - Number(entry.lastUsedAtMs || 0) < SERVER_SCRIPTED_IDLE_OBJECT_COOLDOWN_MS)
    .slice(0, 24);
  next.failedTargets = (next.failedTargets || [])
    .filter(entry => nowMs - Number(entry.lastFailedAtMs || 0) < SERVER_SCRIPTED_IDLE_FAILED_TARGET_THROTTLE_MS)
    .slice(0, 24);
  return next;
}

function serverRuntimeObjectId(target = null) {
  return safeText(target?.objectInstanceId || target?.objectKey || target?.baseObjectKey || '', '');
}

function hasRecentServerRuntimeObject(memory, target = null, nowMs = Date.now()) {
  const objectId = serverRuntimeObjectId(target);
  if (!objectId) return false;
  return (memory?.recentObjects || []).some(entry =>
    String(entry.objectId || '') === objectId &&
    nowMs - Number(entry.lastUsedAtMs || 0) < SERVER_SCRIPTED_IDLE_OBJECT_COOLDOWN_MS);
}

function hasRecentServerRuntimeFailure(memory, target = null, nowMs = Date.now()) {
  const objectId = serverRuntimeObjectId(target);
  if (!objectId) return false;
  return (memory?.failedTargets || []).some(entry =>
    String(entry.objectId || '') === objectId &&
    nowMs - Number(entry.lastFailedAtMs || 0) < SERVER_SCRIPTED_IDLE_FAILED_TARGET_THROTTLE_MS);
}

function markServerScriptedRuntimeChoice(memory, target = null, nowMs = Date.now()) {
  const next = pruneServerScriptedMemory(memory, nowMs);
  const category = safeText(target?.runtimeCategory || target?.behaviorCategory || '', '');
  const objectId = serverRuntimeObjectId(target);
  if (category) {
    next.recentCategories = [
      { category, lastUsedAtMs: nowMs },
      ...next.recentCategories.filter(entry => String(entry.category || '') !== category),
    ].slice(0, 12);
  }
  if (objectId) {
    next.recentObjects = [
      { objectId, lastUsedAtMs: nowMs },
      ...next.recentObjects.filter(entry => String(entry.objectId || '') !== objectId),
    ].slice(0, 24);
  }
  return next;
}

function markServerScriptedRuntimeFailure(memory, target = null, reason = 'target-unavailable', nowMs = Date.now()) {
  const next = pruneServerScriptedMemory(memory, nowMs);
  const objectId = serverRuntimeObjectId(target);
  if (objectId) {
    next.failedTargets = [
      { objectId, lastFailedAtMs: nowMs, reason },
      ...next.failedTargets.filter(entry => String(entry.objectId || '') !== objectId),
    ].slice(0, 24);
  }
  return next;
}

function pickWeightedServerIdleCategory(agentId, memory, nowMs = Date.now()) {
  const recent = new Set((memory?.recentCategories || [])
    .filter(entry => nowMs - Number(entry.lastUsedAtMs || 0) < SERVER_SCRIPTED_IDLE_CATEGORY_COOLDOWN_MS)
    .map(entry => String(entry.category || '')));
  const entries = Object.entries(SERVER_SCRIPTED_IDLE_CATEGORY_WEIGHTS)
    .map(([category, weight]) => ({ category, weight: recent.has(category) ? weight * 0.35 : weight }))
    .filter(entry => entry.weight > 0);
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return entries[0]?.category || 'wander';
  let roll = stableTextHash(`${agentId}:idle-category:${Math.floor(nowMs / 1000)}`) % Math.max(1, Math.floor(total * 1000));
  roll /= 1000;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.category;
  }
  return entries[0]?.category || 'wander';
}

function serverIdleCategoryOrder(agentId, memory, nowMs = Date.now()) {
  const first = pickWeightedServerIdleCategory(agentId, memory, nowMs);
  return Array.from(new Set([
    first,
    'snack-drink',
    'socialize',
    'rest',
    'browse-read',
    'play',
    'wander',
    'work-return',
  ]));
}

function serverRuntimeDistanceScore(current = null, target = null) {
  if (!current || !target) return 0;
  const distance = Math.hypot(Number(current.x || 0) - Number(target.x || 0), Number(current.y || 0) - Number(target.y || 0));
  return Math.max(0, 24 - distance / LIVE_ACTION_API_TILE);
}

function pickServerRuntimeCandidate(agentId, candidates, current = null, nowMs = Date.now(), category = '') {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const ranked = candidates
    .map(target => {
      const stable = stableTextHash(`${agentId}:${category}:${target.objectKey || target.baseObjectKey || ''}:${Math.floor(nowMs / 1000)}`) % 1000;
      const preferredCategory = target.behaviorCategory === category || target.runtimeCategory === category ? 30 : 0;
      const distanceScore = serverRuntimeDistanceScore(current, target);
      const queueScore = target.isQueueUse ? (category === 'snack-drink' ? 4 : -8) : 0;
      return { target, score: preferredCategory + distanceScore + (stable / 1000) * 12 + queueScore };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.target || null;
}

function makeServerRuntimeWanderTarget(dataDir, agentId, current = null, nowMs = Date.now()) {
  if (!current) return null;
  const building = findInteriorBuildingAtApi(dataDir, Number(current.x || 0), Number(current.y || 0));
  const floor = floorOr(current.floor, 1);
  const seed = stableTextHash(`${agentId}:wander:${Math.floor(nowMs / 1000)}`);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = (((seed + attempt * 97) % 6283) / 1000);
    const distance = LIVE_ACTION_API_TILE * (1.4 + (((seed >> (attempt % 8)) + attempt * 17) % 420) / 100);
    const x = Number(current.x || 0) + Math.cos(angle) * distance;
    const y = Number(current.y || 0) + Math.sin(angle) * distance;
    if (!building || buildingContainsApiPoint(building, x, y)) {
      return {
        x,
        y,
        floor,
        buildingId: safeText(building?.id || current.buildingId || '', ''),
        roomId: safeText(current.roomId || '', ''),
        targetKind: 'vo-style-idle-wander',
        objectKey: normalizeWorldObjectKey(`runtime-idle-wander:${agentId}`),
        baseObjectKey: normalizeWorldObjectKey(`runtime-idle-wander:${agentId}`),
        objectInstanceId: normalizeWorldObjectKey(`runtime-idle-wander:${agentId}`),
        furnitureIndex: -1,
        objectType: 'idleWander',
        behaviorCategory: 'wander',
        runtimeCategory: 'wander',
        defaultScriptedIdlePulse: true,
        actionId: 'idle.wander',
        interactionSpotId: 'wander',
        spotId: 'wander',
        slotId: 'wander',
        poseKind: 'stand-use',
        isQueueUse: false,
        animationId: 'walk',
        activityKind: 'vo-style-idle-wander',
        stayMs: 3500 + (seed % 7000),
        faceAngle: normalizeRuntimeAngleRadians(angle, 0),
      };
    }
  }
  return null;
}

function pickScriptedObjectRuntimeTarget(agentId, targets, state, nowMs = Date.now(), options = {}) {
  const memory = pruneServerScriptedMemory(options.memory || makeServerScriptedMemory(), nowMs);
  const available = (Array.isArray(targets) ? targets : [])
    .filter(target => isServerScriptedObjectTargetAvailable(state, target, agentId, nowMs))
    .filter(target => !SCRIPTED_OBJECT_SKIP_TYPES.has(String(target.objectType || '').toLowerCase()))
    .filter(target => !hasRecentServerRuntimeObject(memory, target, nowMs))
    .filter(target => !hasRecentServerRuntimeFailure(memory, target, nowMs));
  const fallbackAvailable = (Array.isArray(targets) ? targets : [])
    .filter(target => isServerScriptedObjectTargetAvailable(state, target, agentId, nowMs))
    .filter(target => !SCRIPTED_OBJECT_SKIP_TYPES.has(String(target.objectType || '').toLowerCase()))
    .filter(target => !hasRecentServerRuntimeFailure(memory, target, nowMs));
  const categories = serverIdleCategoryOrder(agentId, memory, nowMs);
  for (const category of categories) {
    if (category === 'wander') {
      const wanderTarget = makeServerRuntimeWanderTarget(options.dataDir, agentId, options.current, nowMs);
      if (wanderTarget) return wanderTarget;
      continue;
    }
    if (category === 'work-return') continue;
    const typeSet = scriptedIdleObjectTypeSet(category);
    const candidates = available.filter(target => {
      const objectKey = normalizeObjectTypeKey(target.objectType);
      return target.behaviorCategory === category || target.runtimeCategory === category || typeSet.has(objectKey);
    });
    const picked = pickServerRuntimeCandidate(agentId, candidates, options.current, nowMs, category);
    if (picked) return { ...picked, runtimeCategory: category, defaultScriptedIdlePulse: true };
  }
  const picked = pickServerRuntimeCandidate(agentId, fallbackAvailable, options.current, nowMs, 'fallback');
  return picked ? { ...picked, runtimeCategory: picked.behaviorCategory || 'fallback', defaultScriptedIdlePulse: true } : null;
}

function buildScriptedObjectRuntimePlan(dataDir) {
  const presence = readPresenceSnapshotDocument(dataDir);
  const meta = readWorldMetaDocument(dataDir);
  const targets = listScriptedObjectRuntimeTargets(dataDir);
  const idleAgentIds = Object.entries(presence)
    .filter(([agentId, record]) => agentId && !agentId.startsWith('_') && isPresenceIdleForScriptedObjectRuntime(record) && isAgentScriptedAmbientEnabledForServer(meta, agentId, record))
    .map(([agentId]) => safeText(agentId, ''))
    .filter(Boolean)
    .sort();
  return { presence, meta, targets, idleAgentIds };
}

function makeServerScriptedObjectVisualState(isMoving, target = null, status = 'idle') {
  const poseKind = String(target?.poseKind || '').toLowerCase();
  const isRunning = serverScriptedObjectRouteShouldRun(target, isMoving);
  const temporaryItem = target?.temporaryItem && typeof target.temporaryItem === 'object' ? target.temporaryItem : null;
  const isDeskConsume = isServerScriptedObjectDeskConsumeTarget(target);
  const faceAngle = numberOr(target?.faceAngle, 0);
  const dockTarget = Number.isFinite(Number(target?.x)) && Number.isFinite(Number(target?.y))
    ? { x: Number(target.x), y: Number(target.y), floor: floorOr(target?.floor, 1), faceAngle }
    : null;
  const animationId = isMoving ? 'walk' : (
    safeText(target?.animationId, '') ||
    (poseKind === 'seat' ? 'sit' : poseKind === 'wait' ? 'bus-stop-wait' : 'stand-use')
  );
  const activityKind = safeText(target?.activityKind, '') || (target?.isQueueUse ? 'service-queue-wait' : 'server-scripted-object-use');
  const activity = {
    kind: activityKind,
    phase: target?.runtimePhase === 'desk-routing'
      ? (isMoving ? 'approach' : 'active')
      : (target?.runtimePhase === 'desk-consuming' ? 'active' : (isMoving ? 'routing' : 'active')),
    objectKey: safeText(target?.objectKey, ''),
    baseObjectKey: safeText(target?.baseObjectKey, ''),
    objectType: safeText(target?.objectType, ''),
    furnitureType: safeText(target?.objectType, ''),
    behaviorCategory: safeText(target?.behaviorCategory || target?.runtimeCategory, ''),
    defaultScriptedIdlePulse: target?.defaultScriptedIdlePulse === true,
    actionId: safeText(target?.actionId, ''),
    spotId: safeText(target?.spotId || target?.interactionSpotId, ''),
    poseKind: safeText(target?.poseKind, ''),
    isQueueUse: target?.isQueueUse === true,
    animationId,
    faceAngle,
    dockTarget,
  };
  if (temporaryItem) {
    const consumeDurationMs = Math.max(1000, Math.floor(numberOr(target?.consumeDurationMs, target?.stayMs || SERVER_SCRIPTED_OBJECT_DESK_CONSUME_MS)));
    activity.temporaryItem = temporaryItem;
    activity.carryAttachPoint = safeText(target?.carryAttachPoint, 'right-hand') || 'right-hand';
    activity.consumeDurationMs = consumeDurationMs;
    activity.stayMs = consumeDurationMs;
    activity.sipDurationMs = consumeDurationMs;
    activity.sipCountTarget = 3;
    activity.sourceObject = {
      objectKey: safeText(target?.sourceObjectKey, ''),
      baseObjectKey: safeText(target?.sourceBaseObjectKey, ''),
      objectType: safeText(target?.sourceObjectType, ''),
      buildingId: safeText(target?.sourceBuildingId, ''),
      furnitureIndex: Number.isFinite(Number(target?.sourceFurnitureIndex)) ? Number(target.sourceFurnitureIndex) : null,
      actionId: safeText(target?.sourceActionId, ''),
      activityKind: safeText(target?.sourceActivityKind, ''),
    };
    activity.lifecycle = { stationary: false, carryable: false, temporary: true, consumesTemporary: true };
  }
  const visualState = {
    schemaVersion: 'agent-runtime-visual/v1',
    status,
    state: isMoving ? 'moving' : 'idle',
    resolvedAnimationId: animationId,
    movement: { isMoving, isRunning },
    activityActive: Boolean(target),
    activityKind,
    atDesk: Boolean(target && !isMoving && isDeskConsume),
    deskFacingAngle: faceAngle,
    activity,
    carrying: Boolean(temporaryItem),
  };
  if (temporaryItem) visualState.carriedItem = temporaryItem;
  return visualState;
}

function makeServerScriptedObjectIdleVisualState() {
  return {
    schemaVersion: 'agent-runtime-visual/v1',
    status: 'idle',
    state: 'idle',
    resolvedAnimationId: 'idle',
    movement: { isMoving: false, isRunning: false },
    activityActive: false,
    carrying: false,
  };
}

function makeServerScriptedObjectData(agentId, target, state, now, expiresAt, source = 'idle') {
  const objectKey = safeText(target?.objectKey, '') || runtimeFurnitureObjectKey(target?.buildingId, target?.furnitureIndex, target?.objectType || 'object');
  const baseObjectKey = safeText(target?.baseObjectKey, '') || objectKey;
  const actionId = safeText(target?.actionId, 'object.use') || 'object.use';
  const spotId = safeText(target?.spotId || target?.interactionSpotId || target?.slotId, 'default') || 'default';
  const reservationId = safeText(`server-res:${objectKey}:${agentId}`, '') || `server-res:${agentId}`;
  const activeUseId = safeText(`server-active:${objectKey}:${agentId}`, '') || `server-active:${agentId}`;
  const active = ['active', 'using', 'occupied', 'queued'].includes(String(state || '').toLowerCase());
  const activityKind = safeText(target?.activityKind, '') || (target?.isQueueUse ? 'service-queue-wait' : 'server-scripted-object-use');
  const temporaryItem = target?.temporaryItem && typeof target.temporaryItem === 'object' ? target.temporaryItem : null;
  const sourceObject = target?.sourceObjectKey ? {
    objectKey: safeText(target?.sourceObjectKey, ''),
    baseObjectKey: safeText(target?.sourceBaseObjectKey, ''),
    objectType: safeText(target?.sourceObjectType, ''),
    buildingId: safeText(target?.sourceBuildingId, ''),
    furnitureIndex: Number.isFinite(Number(target?.sourceFurnitureIndex)) ? Number(target.sourceFurnitureIndex) : null,
    actionId: safeText(target?.sourceActionId, ''),
    activityKind: safeText(target?.sourceActivityKind, ''),
  } : null;
  return {
    activity: {
      schemaVersion: 'server-scripted-object-activity/v1',
      kind: activityKind,
      phase: target?.runtimePhase === 'desk-routing' ? 'approach' : (target?.runtimePhase === 'desk-consuming' ? 'active' : state),
      source,
      objectKey,
      baseObjectKey,
      objectType: safeText(target?.objectType, ''),
      furnitureType: safeText(target?.objectType, ''),
      actionId,
      spotId,
      poseKind: safeText(target?.poseKind, ''),
      isQueueUse: target?.isQueueUse === true,
      queueSpotId: target?.isQueueUse ? (safeText(target?.queueSpotId, '') || spotId.replace(/:\d+$/, '')) : '',
      queueIndex: target?.isQueueUse ? Math.max(0, Math.floor(numberOr(target?.queueIndex, 0))) : null,
      queueTargetId: target?.isQueueUse ? (safeText(target?.queueTargetId || target?.slotId || spotId, spotId) || spotId) : '',
      animationId: safeText(target?.animationId, ''),
      startedAt: safeIso(target?.runtimeStartedAt, now) || now,
      activeAt: safeIso(target?.runtimeActiveAt, ''),
      runtimeOwner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
      runtimePhase: safeText(target?.runtimePhase, ''),
      carryAttachPoint: temporaryItem ? (safeText(target?.carryAttachPoint, 'right-hand') || 'right-hand') : '',
      temporaryItem,
      sourceObject,
      pickupEffect: safeText(target?.pickupEffect, ''),
      consumeEffect: safeText(target?.consumeEffect, ''),
      completionState: safeText(target?.completionState, ''),
      lifecycle: target?.lifecycle && typeof target.lifecycle === 'object' ? target.lifecycle : null,
    },
    reservation: {
      id: reservationId,
      reservationId,
      objectKey,
      baseObjectKey,
      agentId,
      actionId,
      spotId,
      slotId: safeText(target?.slotId || spotId, spotId) || spotId,
      queueSpotId: target?.isQueueUse ? (safeText(target?.queueSpotId, '') || spotId.replace(/:\d+$/, '')) : '',
      queueIndex: target?.isQueueUse ? Math.max(0, Math.floor(numberOr(target?.queueIndex, 0))) : null,
      status: active ? 'active' : 'held',
      state: target?.isQueueUse && active ? 'queued' : (active ? 'in_use' : 'reserved'),
      availabilityState: target?.isQueueUse && active ? 'queued' : (active ? 'in_use' : 'reserved'),
      reservedAt: safeIso(target?.runtimeStartedAt, now) || now,
      expiresAt,
      runtimeWorldObject: true,
      runtimeOwner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
    },
    activeUse: active ? {
      id: activeUseId,
      objectKey,
      baseObjectKey,
      agentId,
      actionId,
      interactionSpotId: spotId,
      slotId: safeText(target?.slotId || spotId, spotId) || spotId,
      queueSpotId: target?.isQueueUse ? (safeText(target?.queueSpotId, '') || spotId.replace(/:\d+$/, '')) : '',
      queueIndex: target?.isQueueUse ? Math.max(0, Math.floor(numberOr(target?.queueIndex, 0))) : null,
      state: target?.isQueueUse ? 'queued' : 'active',
      status: target?.isQueueUse ? 'queued' : 'active',
      activeAt: safeIso(target?.runtimeActiveAt, now) || now,
      runtimeWorldObject: true,
      runtimeOwner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
    } : null,
    anchor: {
      x: numberOr(target?.x, 0),
      y: numberOr(target?.y, 0),
      floor: floorOr(target?.floor, 1),
      heading: targetFaceAngleRadians(target, 0),
    },
    writer: 'agent-runtime-room.mjs#serverScriptedObjectRuntime',
  };
}

function objectUseRequestTargetFromPoint(message = {}) {
  const target = message?.target && typeof message.target === 'object' ? message.target : message;
  const x = numberOr(target?.x, NaN);
  const y = numberOr(target?.y ?? target?.z, NaN);
  const buildingId = safeText(target?.buildingId || message?.buildingId, '');
  const furnitureIndex = target?.furnitureIndex ?? message?.furnitureIndex;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !buildingId || furnitureIndex === undefined || furnitureIndex === null) return null;
  const objectType = safeText(target?.objectType || target?.catalogKey || message?.objectType, 'object') || 'object';
  const objectKey = safeText(target?.objectKey || message?.objectKey, '') || runtimeFurnitureObjectKey(buildingId, furnitureIndex, objectType);
  const spotId = safeText(target?.spotId || target?.interactionSpotId || message?.spotId, 'default') || 'default';
  const config = scriptedObjectActivityConfig(null, { objectType });
  const poseKind = safeText(target?.poseKind, '') || safeText(config?.poseKind, '') || '';
  return {
    x,
    y,
    floor: floorOr(target?.floor ?? message?.floor, 1),
    buildingId,
    roomId: safeText(target?.roomId || message?.roomId, ''),
    targetKind: 'scripted-object',
    objectKey,
    baseObjectKey: safeText(target?.baseObjectKey || message?.baseObjectKey, '') || objectKey,
    objectInstanceId: safeText(target?.objectInstanceId || target?.objectId || message?.objectInstanceId, ''),
    furnitureIndex: Math.max(-1, Math.floor(numberOr(furnitureIndex, -1))),
    objectType,
    behaviorCategory: scriptedIdleCategoryForObjectType(objectType),
    actionId: safeText(target?.actionId || message?.actionId, `object.use.${objectType}`) || `object.use.${objectType}`,
    interactionSpotId: spotId,
    spotId,
    slotId: safeText(target?.slotId || target?.seatId || spotId, spotId) || spotId,
    poseKind,
    animationId: safeText(target?.animationId || config?.animationId, '') || (poseKind === 'seat' ? 'sit' : 'stand-use'),
    activityKind: safeText(target?.activityKind || config?.kind, '') || 'server-scripted-object-use',
    stayMs: Math.max(1000, Math.floor(numberOr(target?.stayMs ?? message?.stayMs, scriptedObjectStayMs({ objectKey, objectType, spotId })))),
    consumeDurationMs: Math.max(1000, Math.floor(numberOr(target?.consumeDurationMs ?? message?.consumeDurationMs, SERVER_SCRIPTED_OBJECT_DESK_CONSUME_MS))),
    vendingItemId: safeText(target?.vendingItemId || message?.vendingItemId, ''),
    microwaveFoodId: safeText(target?.microwaveFoodId || target?.foodItemId || message?.microwaveFoodId || message?.foodItemId, ''),
    faceAngle: normalizeRuntimeAngleRadians(target?.faceAngle, 0),
  };
}

function resolveScriptedObjectRuntimeTargetFromRequest(dataDir, message = {}) {
  const rawTarget = message?.target && typeof message.target === 'object' ? message.target : message;
  const requestedObjectKey = safeText(rawTarget?.objectKey || message?.objectKey, '');
  const requestedBuildingId = safeText(rawTarget?.buildingId || message?.buildingId, '');
  const requestedFurnitureIndex = rawTarget?.furnitureIndex ?? message?.furnitureIndex;
  const requestedSpotId = safeText(rawTarget?.spotId || rawTarget?.interactionSpotId || message?.spotId, '');
  const requestedActionId = safeText(rawTarget?.actionId || message?.actionId, '');
  const targets = listScriptedObjectRuntimeTargets(dataDir);
  const match = targets.find(target => {
    if (requestedObjectKey && target.objectKey === requestedObjectKey) {
      return !requestedSpotId || requestedSpotId === target.spotId || requestedSpotId === target.interactionSpotId;
    }
    if (requestedBuildingId && target.buildingId !== requestedBuildingId) return false;
    if (requestedFurnitureIndex !== undefined && requestedFurnitureIndex !== null && Number(target.furnitureIndex) !== Number(requestedFurnitureIndex)) return false;
    if (requestedSpotId && requestedSpotId !== target.spotId && requestedSpotId !== target.interactionSpotId) return false;
    if (requestedActionId && requestedActionId !== target.actionId) return false;
    return requestedBuildingId && requestedFurnitureIndex !== undefined && requestedFurnitureIndex !== null;
  });
  return match || objectUseRequestTargetFromPoint(message);
}

function refreshScriptedObjectRuntimeTarget(dataDir, target = null) {
  if (!target || typeof target !== 'object' || !target.objectKey) return target;
  if (isServerScriptedObjectDeskConsumeTarget(target)) return target;
  const refreshed = resolveScriptedObjectRuntimeTargetFromRequest(dataDir, { target });
  if (!refreshed?.objectKey || refreshed.objectKey !== target.objectKey) return target;
  return {
    ...target,
    ...refreshed,
    runtimeStartedAt: target.runtimeStartedAt || refreshed.runtimeStartedAt || '',
    runtimeActiveAt: target.runtimeActiveAt || refreshed.runtimeActiveAt || '',
    runtimeSource: target.runtimeSource || refreshed.runtimeSource || 'idle',
  };
}

function serverLiveActionShouldComplete(action, nowMs) {
  const timing = action?.timing && typeof action.timing === 'object' ? action.timing : {};
  const inProgressAt = Date.parse(timing.inProgressAt || timing.arrivedAt || timing.updatedAt || '');
  return Number.isFinite(inProgressAt) && nowMs - inProgressAt >= LIVE_ACTION_RUNTIME_DWELL_MS;
}

function writeServerBuiltHomeIfNeeded(dataDir, action, now) {
  if (String(action?.actionType || action?.actionId || '') !== 'world.buildStructure') return null;
  const site = action?.params?.buildSite || action?.target?.buildSite || action?.route?.target?.buildSite || null;
  if (!site || typeof site !== 'object' || Array.isArray(site)) return null;
  const agentId = safeText(action.agentId, '');
  const buildingId = safeText(site.buildingId || `live-home-${agentId}`, '');
  if (!buildingId) return null;
  const file = buildingFilePath(dataDir, buildingId);
  if (existsSync(file)) {
    return { buildingId, status: 'already-exists' };
  }
  const building = {
    id: buildingId,
    name: safeText(site.buildingName, `${agentId || 'Agent'}'s Home`) || `${agentId || 'Agent'}'s Home`,
    type: safeText(site.type, 'home') || 'home',
    worldX: numberOr(site.worldX, 0),
    worldY: numberOr(site.worldY, 0),
    widthTiles: Math.max(4, numberOr(site.widthTiles, 10)),
    heightTiles: Math.max(4, numberOr(site.heightTiles, 8)),
    exterior: {
      wallColor: safeText(site.exterior?.wallColor, '#c8b89a') || '#c8b89a',
      roofColor: safeText(site.exterior?.roofColor, '#795548') || '#795548',
    },
    ownerAgentId: agentId || safeText(site.ownerAgentId, ''),
    liveModeHomeForAgentId: agentId || safeText(site.liveModeHomeForAgentId, ''),
    createdByAgentId: agentId || safeText(site.ownerAgentId, ''),
    createdFromWorldActionId: safeText(action.id, ''),
    source: 'agent-live-mode',
    constructionState: {
      status: 'complete',
      completedAt: now,
      visibleExecutor: 'agent-runtime-room.mjs#tickLiveActionRuntime',
      serverRuntimeAuthority: true,
    },
    interior: {
      floors: [{ level: 1, name: 'Floor 1' }],
      furniture: [],
      walls: [],
      starterInteriorVersion: 'pending-python-load',
      residentAgentId: agentId || safeText(site.liveModeHomeForAgentId, ''),
    },
  };
  writeJsonFileAtomic(file, building);
  return { buildingId, status: 'created' };
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

function buildServerRoadGraph(streets = []) {
  const nodes = new Map();
  const keyFor = (x, z) => `${x},${z}`;
  const getNode = (x, z) => {
    const key = keyFor(x, z);
    if (!nodes.has(key)) nodes.set(key, { x, z, edges: [] });
    return nodes.get(key);
  };
  const addEdge = (x1, z1, x2, z2) => {
    const keyA = keyFor(x1, z1);
    const keyB = keyFor(x2, z2);
    if (keyA === keyB) return;
    const a = getNode(x1, z1);
    const b = getNode(x2, z2);
    const dist = Math.abs(x2 - x1) + Math.abs(z2 - z1);
    if (!a.edges.some(edge => edge.to === keyB)) a.edges.push({ to: keyB, dist });
    if (!b.edges.some(edge => edge.to === keyA)) b.edges.push({ to: keyA, dist });
  };

  const segments = streets.map(normalizeStreetSegment).filter(Boolean);
  for (const segment of segments) {
    if (segment.type) getNode(segment.x1, segment.z1);
  }
  for (const segment of segments) {
    if (!segment.type) addEdge(segment.x1, segment.z1, segment.x2, segment.z2);
  }
  const gap = SERVER_STREET_INTERSECTION_ROAD_RADIUS + 1;
  for (const intersection of segments.filter(segment => segment.type)) {
    for (const segment of segments.filter(entry => !entry.type)) {
      for (const [x, z] of [[segment.x1, segment.z1], [segment.x2, segment.z2]]) {
        const distance = Math.abs(x - intersection.x1) + Math.abs(z - intersection.z1);
        if (distance > 0 && distance <= gap) addEdge(intersection.x1, intersection.z1, x, z);
      }
    }
  }
  return { nodes };
}

function pathfindServerRoadGraph(graph, sx, sz, gx, gz) {
  if (!graph?.nodes?.size) return null;
  const startKey = `${sx},${sz}`;
  const goalKey = `${gx},${gz}`;
  if (!graph.nodes.has(startKey) || !graph.nodes.has(goalKey)) return null;
  if (startKey === goalKey) return [{ x: gx, z: gz }];
  const open = new Map([[startKey, { f: Math.abs(sx - gx) + Math.abs(sz - gz), g: 0 }]]);
  const closed = new Set();
  const cameFrom = new Map();
  const h = (key) => {
    const node = graph.nodes.get(key);
    return Math.abs((node?.x || 0) - gx) + Math.abs((node?.z || 0) - gz);
  };
  while (open.size > 0) {
    let currentKey = null;
    let lowest = Infinity;
    for (const [key, entry] of open) {
      if (entry.f < lowest) {
        currentKey = key;
        lowest = entry.f;
      }
    }
    if (currentKey === goalKey) {
      const path = [];
      let key = goalKey;
      while (key) {
        const node = graph.nodes.get(key);
        path.unshift({ x: node.x, z: node.z });
        key = cameFrom.get(key) || null;
      }
      return path;
    }
    const current = open.get(currentKey);
    open.delete(currentKey);
    closed.add(currentKey);
    const node = graph.nodes.get(currentKey);
    for (const edge of node?.edges || []) {
      if (closed.has(edge.to)) continue;
      const g = current.g + edge.dist;
      const existing = open.get(edge.to);
      if (!existing || g < existing.g) {
        cameFrom.set(edge.to, currentKey);
        open.set(edge.to, { g, f: g + h(edge.to) });
      }
    }
  }
  return null;
}

function nearestServerRoadNode(graph, tileX, tileZ, dir = null) {
  let best = null;
  let bestScore = Infinity;
  const dirVec = dir === 0 ? [1, 0] : dir === 1 ? [-1, 0] : dir === 2 ? [0, 1] : dir === 3 ? [0, -1] : null;
  for (const node of graph?.nodes?.values?.() || []) {
    const dx = node.x - tileX;
    const dz = node.z - tileZ;
    const aheadPenalty = dirVec && (dx * dirVec[0] + dz * dirVec[1]) < -0.5 ? 1000 : 0;
    const score = Math.abs(dx) + Math.abs(dz) + aheadPenalty;
    if (score < bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

function cleanServerVehiclePath(tilePath = [], startTile = null) {
  const source = Array.isArray(tilePath) ? tilePath.filter(Boolean) : [];
  if (startTile) source.unshift(startTile);
  if (source.length < 2) return [];
  const simplified = [source[0]];
  let previousHorizontal = null;
  for (let i = 1; i < source.length; i++) {
    const prev = simplified[simplified.length - 1];
    const cur = source[i];
    const dx = cur.x - prev.x;
    const dz = cur.z - prev.z;
    if (Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) continue;
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    if (previousHorizontal === null) {
      previousHorizontal = horizontal;
    } else if (horizontal !== previousHorizontal && i - 1 > 0) {
      const turn = source[i - 1];
      const last = simplified[simplified.length - 1];
      if (Math.abs(turn.x - last.x) > 0.5 || Math.abs(turn.z - last.z) > 0.5) simplified.push(turn);
      previousHorizontal = horizontal;
    }
  }
  const last = source[source.length - 1];
  const previous = simplified[simplified.length - 1];
  if (Math.abs(last.x - previous.x) > 0.5 || Math.abs(last.z - previous.z) > 0.5) simplified.push(last);
  if (simplified.length < 2) return [];
  const aligned = [{ x: simplified[0].x, z: simplified[0].z }];
  for (let i = 1; i < simplified.length; i++) {
    const prev = aligned[aligned.length - 1];
    const cur = simplified[i];
    if (Math.abs(cur.x - prev.x) >= Math.abs(cur.z - prev.z)) aligned.push({ x: cur.x, z: prev.z });
    else aligned.push({ x: prev.x, z: cur.z });
  }
  return aligned
    .filter((point, index, arr) => index === 0 || Math.abs(point.x - arr[index - 1].x) + Math.abs(point.z - arr[index - 1].z) >= 1)
    .map(point => ({ x: point.x, z: point.z }));
}

function buildServerWorldTopology(dataDir) {
  const streets = readStreetSegments(dataDir).map(normalizeStreetSegment).filter(Boolean);
  const trafficLights = streets
    .filter(segment => segment.type === 'x-int' || segment.type === 't-int')
    .map(segment => ({
      key: `${segment.x1},${segment.z1}`,
      ix: segment.x1,
      iz: segment.z1,
      type: segment.type,
      openEdges: segment.openEdges || { n: true, s: true, e: true, w: true },
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const graph = buildServerRoadGraph(streets);
  const roadSegments = streets.filter(segment => !segment.type);
  const spawnCandidates = [];
  const spacing = 8;
  for (const segment of roadSegments) {
    const dx = segment.x2 - segment.x1;
    const dz = segment.z2 - segment.z1;
    const length = Math.hypot(dx, dz);
    const count = Math.max(2, Math.floor(length / spacing));
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = segment.x1 + dx * t;
      const z = segment.z1 + dz * t;
      let dir = horizontal ? (dx >= 0 ? 0 : 1) : (dz >= 0 ? 2 : 3);
      if (i % 2 === 1) dir = horizontal ? (dir === 0 ? 1 : 0) : (dir === 2 ? 3 : 2);
      spawnCandidates.push({ x, z, dir });
    }
  }
  const totalRoadLength = roadSegments.reduce((sum, segment) => sum + Math.hypot(segment.x2 - segment.x1, segment.z2 - segment.z1), 0);
  const vehicleCount = Math.min(Math.max(0, Math.floor(totalRoadLength / 15)), SERVER_WORLD_MAX_TRAFFIC_VEHICLES, spawnCandidates.length);
  const trafficVehicles = [];
  for (const candidate of spawnCandidates) {
    if (trafficVehicles.length >= vehicleCount) break;
    const tooClose = trafficVehicles.some(vehicle => Math.hypot(vehicle.x - candidate.x, vehicle.z - candidate.z) < 8);
    if (tooClose) continue;
    const startNode = nearestServerRoadNode(graph, candidate.x, candidate.z, candidate.dir);
    const destinations = Array.from(graph.nodes.values())
      .filter(node => node !== startNode)
      .sort((a, b) => {
        const da = Math.abs(a.x - candidate.x) + Math.abs(a.z - candidate.z);
        const db = Math.abs(b.x - candidate.x) + Math.abs(b.z - candidate.z);
        return db - da;
      });
    const destination = destinations[trafficVehicles.length % Math.max(1, destinations.length)] || null;
    const tilePath = startNode && destination
      ? pathfindServerRoadGraph(graph, startNode.x, startNode.z, destination.x, destination.z)
      : null;
    const cleanPath = cleanServerVehiclePath(tilePath || [], { x: candidate.x, z: candidate.z });
    if (cleanPath.length < 2) continue;
    const type = SERVER_VEHICLE_TYPES[trafficVehicles.length % SERVER_VEHICLE_TYPES.length] || 'car';
    const path = cleanPath.map(point => ({ x: point.x, z: point.z }));
    const firstMove = path[1] || path[0];
    const dir = directionFromDelta(firstMove.x - path[0].x, firstMove.z - path[0].z, candidate.dir);
    trafficVehicles.push({
      vehicleId: `traffic-vehicle:${trafficVehicles.length}`,
      vehicleType: type,
      color: SERVER_VEHICLE_COLORS[trafficVehicles.length % SERVER_VEHICLE_COLORS.length],
      x: path[0].x,
      z: path[0].z,
      dir,
      rotationY: dirToRotationY(dir),
      speed: SERVER_WORLD_TRAFFIC_SPEED,
      speedMult: SERVER_VEHICLE_SPEED_MULT[type] || 1,
      path,
      pathIdx: 1,
      state: 'moving',
    });
  }
  let topologyHash = deterministicTopologyHash(trafficLights);
  if (!topologyHash && streets.length > 0) {
    const normalized = streets
      .map(segment => `${segment.type || 'road'}:${segment.x1},${segment.z1}:${segment.x2},${segment.z2}`)
      .sort()
      .join('|');
    let hash = 2166136261;
    for (const char of normalized) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    topologyHash = `traffic:${streets.length}:${hash.toString(36)}`;
  }
  return {
    owner: SERVER_WORLD_TOPOLOGY_OWNER,
    topologyHash,
    trafficCycleMs: WORLD_RUNTIME_TRAFFIC_CYCLE_MS,
    trafficYellowMs: WORLD_RUNTIME_TRAFFIC_YELLOW_MS,
    trafficAllRedMs: WORLD_RUNTIME_TRAFFIC_ALL_RED_MS,
    trafficLights,
    trafficVehicles,
  };
}

function positiveModulo(value, divisor) {
  const d = Math.max(1, Number(divisor || 1));
  return ((Number(value || 0) % d) + d) % d;
}

function normalizeWorldObjectData(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = sanitizeVisualValue(value, 0, 'data');
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const json = JSON.stringify(normalized);
  if (json.length > MAX_WORLD_OBJECT_DATA_JSON_CHARS) {
    throw apiError('invalid_world_object_data', 'world object data is too large');
  }
  return normalized;
}

function normalizeVisualState(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = sanitizeVisualValue(value, 0, 'visualState');
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  const json = JSON.stringify(normalized);
  if (json.length > MAX_VISUAL_STATE_JSON_CHARS) {
    throw apiError('invalid_visual_state', 'visualState is too large');
  }
  return normalized;
}

function sanitizeVisualValue(value, depth = 0, path = 'visual') {
  if (depth > 5) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    const number = Number(value);
    const key = String(path || '').split('.').pop().toLowerCase();
    const metadataNumber = /(?:ms|index|count|priority|capacity|color|version|floor|ttl|seq|level)$/.test(key) ||
      key.includes('duration') ||
      key.includes('timestamp');
    if (metadataNumber) {
      if (!Number.isFinite(number) || Math.abs(number) > Number.MAX_SAFE_INTEGER) {
        throw apiError('invalid_coordinate', `${path} must be a finite number`);
      }
      return number;
    }
    return coordinateOr(number, 0, path);
  }
  if (typeof value === 'string') return safeText(value, '');
  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item, index) => sanitizeVisualValue(item, depth + 1, `${path}.${index}`)).filter(item => item !== null && item !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value).slice(0, 80)) {
      if (!SAFE_TEXT_RE.test(key) || key.length > 80) continue;
      const normalized = sanitizeVisualValue(item, depth + 1, `${path}.${key}`);
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
  return normalizeRuntimeAngleRadians(value, fallback);
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
    this.autoDispose = false;
    this.patchRate = DEFAULT_WORLD_RUNTIME_TICK_MS;
    this.dataDir = options.dataDir || process.env.VW_DATA_DIR || '.local-data';
    this.events = [];
    this.lastWorldRuntimePersistMs = 0;
    this.lastServerWorldTopologyMs = 0;
    this.lastLiveActionRuntimeStepMs = 0;
    this.lastLiveStatusRuntimeStepMs = 0;
    this.lastScriptedObjectRuntimeStepMs = 0;
    this.deferRuntimeDocumentWrites = false;
    this.runtimeDocumentDirty = false;
    this.runtimeStateBroadcastDirty = false;
    this.lastRuntimeStateBroadcastMs = 0;
    this.lastLiveActionRuntimePollMs = 0;
    this.liveActionRuntimeMeta = null;
    this.liveActionRuntimeStore = null;
    this.lastLiveStatusRuntimePollMs = 0;
    this.liveStatusRuntimePlan = null;
    this.lastScriptedObjectRuntimePollMs = 0;
    this.scriptedObjectRuntimePlan = null;
    this.scriptedObjectRuntimeCooldowns = new Map();
    this.scriptedObjectRuntimeMemory = new Map();
    this.scriptedObjectRuntimeNextPulseAtMs = new Map();
    this.scriptedObjectRuntimeIdleCursor = 0;
    configureDynamicInteriorRouting({
      apiToWorldScale: 1 / LIVE_ACTION_API_TILE,
      getInteriorBuildingAt: (x, y) => findInteriorBuildingAtApi(this.dataDir, x, y),
    });
    configureDynamicExteriorRouting({
      apiToWorldScale: 1 / LIVE_ACTION_API_TILE,
      terrain: SERVER_TERRAIN,
      getWorldTile: (wx, wz) => getServerWorldTile(this.dataDir, wx, wz),
      findNearestSidewalk: (wx, wz, radius) => findNearestServerSidewalk(this.dataDir, wx, wz, radius),
      pathfindSidewalk: (sx, sz, gx, gz) => pathfindServerSidewalk(this.dataDir, sx, sz, gx, gz),
      isCrosswalk: (wx, wz) => isServerCrosswalk(this.dataDir, wx, wz),
      getInteriorBuildingAt: (x, y) => findInteriorBuildingAtApi(this.dataDir, x, y),
      getParkAt: (x, y) => findParkAtApi(this.dataDir, x, y),
      getBuildingDoorSidewalkPos: (building) => buildingOutsideDoorPointApi(building),
      getBuildingDoorPosAPI: (building) => buildingOutsideDoorPointApi(building),
      getBuildingInteriorEntryPosAPI: (building) => buildingInteriorEntryPointApi(building),
      getBuildingDoorwayPosAPI: (building) => buildingDoorwayPointApi(building),
      getBuildingDoorwayReachApi: (building) => buildingDoorwayReachApi(building),
      getVehicles: () => Array.from(this.state?.worldRuntime?.trafficVehicles?.values?.() || []).map(trafficVehicleToPlain),
      getSmartWaypoints: (ax, ay, tx, ty) => getServerSmartWaypoints(this.dataDir, ax, ay, tx, ty),
      probeObstacleAtWorld: () => null,
      getAgentColliderHandle: () => null,
    });
    const doc = readRuntimeDocument(this.dataDir);
    this.events = Array.isArray(doc.events) ? doc.events.slice(-MAX_RUNTIME_EVENTS) : [];
    this.setState(stateFromDocument(doc));
    this.ensureServerWorldTopology(Date.now(), { force: true });

    this.onMessage('runtime:snapshot', (client, message) => this.handleSnapshot(client, message));
    this.onMessage('runtime:worldObject', (client, message) => this.handleWorldObject(client, message));
    this.onMessage('runtime:objectUseRequest', (client, message) => this.handleObjectUseRequest(client, message));
    this.onMessage('runtime:worldTopology', (client, message) => this.handleWorldTopology(client, message));
    this.onMessage('runtime:claimRoute', (client, message) => this.handleClaimRoute(client, message));
    this.onMessage('runtime:heartbeat', (client, message) => this.handleHeartbeat(client, message));
    this.onMessage('runtime:releaseRoute', (client, message) => this.handleReleaseRoute(client, message));
    if (process.env.VW_REALTIME_DISABLE_LEASE_SWEEP !== 'true') {
      this.clock.setInterval(() => this.expireStaleRouteLeases(), STALE_ROUTE_LEASE_SWEEP_MS);
    }
    if (process.env.VW_REALTIME_DISABLE_WORLD_TICK !== 'true') {
      this.clock.setInterval(() => this.tickWorldRuntime(), DEFAULT_WORLD_RUNTIME_TICK_MS);
    }
  }

  onJoin(client) {
    this.expireStaleRouteLeases();
    const welcome = {
      sessionId: client.sessionId,
      room: AGENT_RUNTIME_ROOM_NAME,
      serverTime: new Date().toISOString(),
      snapshot: stateToPlain(this.state, this.events),
    };
    client.send('runtime:welcome', welcome);
    this.clock.setTimeout(() => {
      try {
        client.send('runtime:welcome', {
          ...welcome,
          replay: true,
          serverTime: new Date().toISOString(),
          snapshot: stateToPlain(this.state, this.events),
        });
      } catch {
        // Client left before the delayed initial snapshot replay.
      }
    }, 50);
    this.broadcastRuntimeState('client-joined');
  }

  runtimeDocument() {
    return stateToPlain(this.state, this.events);
  }

  persistRuntimeDocument() {
    if (this.deferRuntimeDocumentWrites) {
      this.runtimeDocumentDirty = true;
      return false;
    }
    this.runtimeDocumentDirty = false;
    writeRuntimeDocument(this.dataDir, this.state, this.events);
    return true;
  }

  broadcastRuntimeState(source = 'runtime-state', { force = false } = {}) {
    if (this.deferRuntimeDocumentWrites) {
      this.runtimeStateBroadcastDirty = true;
      return false;
    }
    const nowMs = Date.now();
    if (!force && this.lastRuntimeStateBroadcastMs && nowMs - this.lastRuntimeStateBroadcastMs < RUNTIME_STATE_BROADCAST_INTERVAL_MS) {
      this.runtimeStateBroadcastDirty = true;
      return false;
    }
    this.runtimeStateBroadcastDirty = false;
    this.lastRuntimeStateBroadcastMs = nowMs;
    this.broadcast('runtime:state', {
      type: 'runtime-state',
      source,
      snapshot: this.runtimeDocument(),
    });
    return true;
  }

  runWithDeferredRuntimeDocumentWrites(callback) {
    const previous = this.deferRuntimeDocumentWrites;
    this.deferRuntimeDocumentWrites = true;
    try {
      return callback();
    } finally {
      this.deferRuntimeDocumentWrites = previous;
    }
  }

  ensureServerWorldTopology(nowMs = Date.now(), { force = false } = {}) {
    if (!force && this.lastServerWorldTopologyMs && nowMs - this.lastServerWorldTopologyMs < WORLD_RUNTIME_TOPOLOGY_REFRESH_MS) return null;
    const topology = buildServerWorldTopology(this.dataDir);
    if (!topology.topologyHash && !topology.trafficLights.length && !topology.trafficVehicles.length) return null;
    this.lastServerWorldTopologyMs = nowMs;
    const runtime = this.state.worldRuntime || new WorldRuntimeState();
    if (!this.state.worldRuntime) this.state.worldRuntime = runtime;
    const alreadyServerOwned = runtime.topologyOwner === SERVER_WORLD_TOPOLOGY_OWNER;
    const sameTopology = runtime.topologyHash === topology.topologyHash;
    const sameLightCount = Number(runtime.trafficLights?.size || 0) === topology.trafficLights.length;
    const hasExpectedVehicles = topology.trafficVehicles.length === 0 || Number(runtime.trafficVehicles?.size || 0) > 0;
    if (!force && alreadyServerOwned && sameTopology && sameLightCount && hasExpectedVehicles) return null;
    return this.upsertWorldTopology({
      ...topology,
      tickMs: runtime.tickMs || DEFAULT_WORLD_RUNTIME_TICK_MS,
    }, { sessionId: SERVER_WORLD_TOPOLOGY_OWNER }, 'server-world-topology-seeded');
  }

  handleSnapshot(client, message = {}) {
    this.withErrors(client, message, 'runtime:snapshot', () => {
      this.expireStaleRouteLeases();
      let raw = message.snapshot && typeof message.snapshot === 'object' ? message.snapshot : message;
      const manualOverride = isManualSnapshotOverride(raw);
      if (manualOverride) {
        raw = {
          ...raw,
          mode: 'manual',
          owner: safeText(raw.owner, USER_DIRECTED_RUNTIME_LEASE_OWNER) || USER_DIRECTED_RUNTIME_LEASE_OWNER,
          state: safeText(raw.state, 'idle') || 'idle',
          routeId: '',
          worldActionId: '',
          target: null,
          leaseOwner: USER_DIRECTED_RUNTIME_LEASE_OWNER,
          leaseExpiresAt: new Date(Date.now() + USER_DIRECTED_RUNTIME_HOLD_MS).toISOString(),
        };
      }
      const agentId = normalizeAgentId(raw.agentId);
      const existing = this.state.agents.get(agentId);
      if (existing && hasActiveLease(existing) && !manualOverride) {
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
      if (manualOverride) this.broadcastRuntimeState('manual-snapshot', { force: true });
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
        const serverOwned = SERVER_WORLD_OBJECT_RUNTIME_OWNERS.has(existingPlain.owner || '');
        if ((serverOwned && !sameOwner) || (nextActive && !sameOwner && !sameAgent)) {
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

  handleObjectUseRequest(client, message = {}) {
    this.withErrors(client, message, 'runtime:objectUseRequest', () => {
      this.expireStaleRouteLeases();
      const agentId = normalizeAgentId(message.agentId);
      let target = resolveScriptedObjectRuntimeTargetFromRequest(this.dataDir, message);
      if (!target?.objectKey) {
        throw apiError('invalid_object_use_target', 'object use request requires a resolvable target object');
      }
      let existingObject = this.state.objects.get(target.objectKey);
      let baseObjectKey = safeText(target.baseObjectKey, '') || target.objectKey;
      let existingBaseObject = baseObjectKey !== target.objectKey ? this.state.objects.get(baseObjectKey) : existingObject;
      let blockingObject = isWorldObjectActiveForAnotherAgent(existingObject, agentId)
        ? existingObject
        : (!target.isQueueUse && isWorldObjectActiveForAnotherAgent(existingBaseObject, agentId) ? existingBaseObject : null);
      if (blockingObject && !target.isQueueUse) {
        const queueTarget = serverScriptedQueueRuntimeTargetForBase(this.dataDir, target);
        if (queueTarget) {
          target = queueTarget;
          existingObject = this.state.objects.get(target.objectKey);
          baseObjectKey = safeText(target.baseObjectKey, '') || target.objectKey;
          existingBaseObject = baseObjectKey !== target.objectKey ? this.state.objects.get(baseObjectKey) : existingObject;
          blockingObject = isWorldObjectActiveForAnotherAgent(existingObject, agentId) ? existingObject : null;
        }
      }
      if (blockingObject) {
        const existingPlain = worldObjectToPlain(blockingObject);
        throw apiError('object_state_conflict', 'world object is active for another agent', {
          objectKey: existingPlain.objectKey || target.objectKey,
          owner: existingPlain.owner || '',
          agentId: existingPlain.agentId || '',
          state: existingPlain.state || '',
          expiresAt: existingPlain.expiresAt || '',
        });
      }
      if (!this.state.agents.get(agentId)) {
        const position = message.agentPosition && typeof message.agentPosition === 'object' ? message.agentPosition : {};
        this.upsertSnapshot({
          agentId,
          mode: 'scripted',
          owner: 'agent-scripted-mode',
          x: numberOr(position.x, numberOr(message.x, target.x)),
          y: numberOr(position.y ?? position.z, numberOr(message.y ?? message.z, target.y)),
          floor: floorOr(position.floor ?? message.floor ?? target.floor, 1),
          buildingId: safeText(position.buildingId || message.buildingId || '', ''),
          roomId: safeText(position.roomId || message.roomId || '', ''),
          heading: headingOr(position.heading ?? message.heading, 0),
          state: 'idle',
          routeId: '',
          worldActionId: '',
          target: null,
          leaseOwner: '',
          leaseExpiresAt: '',
        }, 'server-scripted-object-seeded', { reason: 'object-use-request' });
      }
      const result = this.startServerScriptedObjectRoute(agentId, target, Date.now(), new Date().toISOString(), {
        source: safeText(message.source, 'request') || 'request',
        force: true,
      });
      client.send('runtime:ack', {
        requestId: requestIdFrom(message),
        type: 'runtime:objectUseRequest',
        ok: true,
        agentId,
        objectKey: target.objectKey,
        snapshot: snapshotToPlain(result.agent),
        object: worldObjectToPlain(result.object),
        event: result.snapshotEvent,
      });
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
      clearDynamicInteriorRoutingForAgent(agentId);
      clearDynamicExteriorRoutingForAgent(agentId);
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
      if (SERVER_MANAGED_ROUTE_LEASE_OWNERS.has(safeText(existing.leaseOwner, ''))) continue;
      const before = snapshotToPlain(existing);
      clearDynamicInteriorRoutingForAgent(agentId);
      clearDynamicExteriorRoutingForAgent(agentId);
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

  loadLiveActionRuntimeStore(nowMs = Date.now()) {
    if (this.liveActionRuntimeStore && nowMs - Number(this.lastLiveActionRuntimePollMs || 0) < LIVE_ACTION_RUNTIME_POLL_MS) {
      return { meta: this.liveActionRuntimeMeta, store: this.liveActionRuntimeStore };
    }
    const loaded = readWorldActionsStore(this.dataDir);
    this.liveActionRuntimeMeta = loaded.meta;
    this.liveActionRuntimeStore = loaded.store;
    this.lastLiveActionRuntimePollMs = nowMs;
    return loaded;
  }

  saveLiveActionRuntimeStore(meta, store, nowMs = Date.now()) {
    writeWorldActionsStore(this.dataDir, meta, store);
    this.liveActionRuntimeMeta = meta;
    this.liveActionRuntimeStore = store;
    this.lastLiveActionRuntimePollMs = nowMs;
  }

  loadLiveStatusRuntimePlan(nowMs = Date.now()) {
    if (this.liveStatusRuntimePlan && nowMs - Number(this.lastLiveStatusRuntimePollMs || 0) < LIVE_STATUS_RUNTIME_POLL_MS) {
      return this.liveStatusRuntimePlan;
    }
    try {
      this.liveStatusRuntimePlan = buildLiveStatusRuntimePlan(this.dataDir);
    } catch (error) {
      this.liveStatusRuntimePlan = { presence: {}, meta: {}, targets: [], workingAgentIds: [], targetsByAgent: {}, error: error?.message || String(error) };
    }
    this.lastLiveStatusRuntimePollMs = nowMs;
    return this.liveStatusRuntimePlan;
  }

  loadScriptedObjectRuntimePlan(nowMs = Date.now()) {
    if (this.scriptedObjectRuntimePlan && nowMs - Number(this.lastScriptedObjectRuntimePollMs || 0) < SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS) {
      return this.scriptedObjectRuntimePlan;
    }
    try {
      this.scriptedObjectRuntimePlan = buildScriptedObjectRuntimePlan(this.dataDir);
    } catch (error) {
      this.scriptedObjectRuntimePlan = { presence: {}, meta: {}, targets: [], idleAgentIds: [], error: error?.message || String(error) };
    }
    this.lastScriptedObjectRuntimePollMs = nowMs;
    return this.scriptedObjectRuntimePlan;
  }

  serverScriptedMemoryFor(agentId, nowMs = Date.now()) {
    const key = safeText(agentId, '');
    const memory = pruneServerScriptedMemory(this.scriptedObjectRuntimeMemory.get(key) || makeServerScriptedMemory(), nowMs);
    this.scriptedObjectRuntimeMemory.set(key, memory);
    return memory;
  }

  stableServerScriptedDelay(agentId, range, label, nowMs = Date.now()) {
    const min = Math.max(0, Math.floor(numberOr(range?.[0], 0)));
    const max = Math.max(min, Math.floor(numberOr(range?.[1] ?? range?.[0], min)));
    if (max <= min) return min;
    const span = max - min;
    return min + (stableTextHash(`${agentId}:${label}:${Math.floor(nowMs / 1000)}`) % (span + 1));
  }

  ensureServerScriptedIdlePulseDue(agentId, nowMs = Date.now()) {
    const key = safeText(agentId, '');
    const nextAt = Number(this.scriptedObjectRuntimeNextPulseAtMs.get(key) || 0);
    if (!Number.isFinite(nextAt) || nextAt <= 0) {
      this.scriptedObjectRuntimeNextPulseAtMs.set(key, nowMs + this.stableServerScriptedDelay(key, SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS, 'initial', nowMs));
      return false;
    }
    return nowMs >= nextAt;
  }

  scheduleServerScriptedIdlePulse(agentId, range, label, nowMs = Date.now()) {
    const key = safeText(agentId, '');
    const nextAt = nowMs + this.stableServerScriptedDelay(key, range, label, nowMs);
    this.scriptedObjectRuntimeNextPulseAtMs.set(key, nextAt);
    return nextAt;
  }

  markServerScriptedRuntimeChoice(agentId, target, nowMs = Date.now()) {
    const key = safeText(agentId, '');
    const memory = markServerScriptedRuntimeChoice(this.serverScriptedMemoryFor(key, nowMs), target, nowMs);
    this.scriptedObjectRuntimeMemory.set(key, memory);
    this.scheduleServerScriptedIdlePulse(key, SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS, `success:${target?.runtimeCategory || target?.behaviorCategory || 'idle'}`, nowMs);
    return memory;
  }

  markServerScriptedRuntimeFailure(agentId, target, reason = 'target-unavailable', nowMs = Date.now()) {
    const key = safeText(agentId, '');
    const memory = markServerScriptedRuntimeFailure(this.serverScriptedMemoryFor(key, nowMs), target, reason, nowMs);
    this.scriptedObjectRuntimeMemory.set(key, memory);
    this.scheduleServerScriptedIdlePulse(key, SERVER_SCRIPTED_IDLE_RETRY_DELAY_MS, `retry:${reason}`, nowMs);
    return memory;
  }

  serverRuntimeSeedPosition(agentId, target = null) {
    const targetX = Number.isFinite(Number(target?.x)) ? Number(target.x) : 0;
    const targetY = Number.isFinite(Number(target?.y)) ? Number(target.y) : 0;
    const hash = stableTextHash(agentId || 'agent');
    const angle = ((hash % 360) / 180) * Math.PI;
    const radius = 120 + (hash % 4) * 40;
    return {
      x: targetX + Math.cos(angle) * radius,
      y: targetY + Math.sin(angle) * radius,
      floor: floorOr(target?.floor, 1),
      buildingId: safeText(target?.buildingId, ''),
      roomId: safeText(target?.roomId, ''),
      heading: targetFaceAngleRadians(target, 0),
    };
  }

  ensureServerRuntimeAgentSeed(agentId, target = null, reason = 'missing-runtime-snapshot') {
    const existing = this.state.agents.get(agentId);
    if (existing) return existing;
    const seed = this.serverRuntimeSeedPosition(agentId, target);
    return this.upsertSnapshot({
      agentId,
      mode: 'scripted',
      owner: 'agent-scripted-mode',
      x: seed.x,
      y: seed.y,
      floor: seed.floor,
      buildingId: seed.buildingId,
      roomId: seed.roomId,
      heading: seed.heading,
      state: 'idle',
      routeId: '',
      worldActionId: '',
      target: null,
      leaseOwner: '',
      leaseExpiresAt: '',
      visualState: makeServerScriptedObjectIdleVisualState(),
    }, 'server-runtime-agent-seeded', { reason }).agent;
  }

  serverScriptedServiceQueueStoreFor(baseObjectKey) {
    return serverScriptedServiceQueueStoreFromWorldObject(this.state.objects.get(baseObjectKey));
  }

  serverScriptedObjectDataWithQueueStore(target, data, options = {}) {
    const objectKey = safeText(target?.objectKey, '');
    const baseObjectKey = serverScriptedQueueBaseObjectKey(target);
    if (!objectKey || !baseObjectKey || objectKey !== baseObjectKey) return data;
    const existing = this.state.objects.get(baseObjectKey);
    const existingPlain = existing ? worldObjectToPlain(existing) : null;
    const store = this.serverScriptedServiceQueueStoreFor(baseObjectKey);
    const reservations = normalizeServerScriptedServiceQueueReservations(store);
    const includeEmpty = options.includeEmpty === true || hasServerScriptedServiceQueueStoreData(existingPlain?.data);
    if (!reservations.length && !includeEmpty) return data;
    return {
      ...data,
      ...serverScriptedServiceQueueStoreData(store, { clearEmpty: includeEmpty }),
    };
  }

  upsertServerScriptedServiceQueueBaseObject(baseTarget, store, nowMs, now, reason = 'queue-store-updated') {
    const baseObjectKey = serverScriptedQueueBaseObjectKey(baseTarget);
    if (!baseObjectKey) return null;
    const existing = this.state.objects.get(baseObjectKey);
    const existingPlain = existing ? worldObjectToPlain(existing) : {};
    const expiresAt = existingPlain.expiresAt || new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS).toISOString();
    return this.upsertWorldObject({
      objectKey: baseObjectKey,
      owner: existingPlain.owner || SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
      objectType: existingPlain.objectType || baseTarget?.objectType || '',
      buildingId: existingPlain.buildingId || baseTarget?.buildingId || '',
      furnitureIndex: existingPlain.furnitureIndex ?? baseTarget?.furnitureIndex ?? -1,
      state: existingPlain.state || 'idle',
      agentId: existingPlain.agentId || '',
      actionId: existingPlain.actionId || baseTarget?.actionId || '',
      reservationId: existingPlain.reservationId || '',
      activeUseId: existingPlain.activeUseId || '',
      slotId: existingPlain.slotId || baseTarget?.slotId || baseTarget?.spotId || '',
      expiresAt,
      data: {
        ...(existingPlain.data || {}),
        ...serverScriptedServiceQueueStoreData(store, { clearEmpty: true }),
      },
    }, 'server-scripted-object-queue-store-updated', { objectKey: baseObjectKey, reason });
  }

  reserveServerScriptedServiceQueueTarget(agentId, rawTarget, nowMs, now, options = {}) {
    const baseObjectKey = serverScriptedQueueBaseObjectKey(rawTarget);
    if (!baseObjectKey) return { ok: false, reason: 'missing-base-object-key' };
    const queueSpotId = serverScriptedQueueSpotId(rawTarget);
    const store = this.serverScriptedServiceQueueStoreFor(baseObjectKey);
    const live = normalizeServerScriptedServiceQueueReservations(store);
    const existing = live.find(entry => String(entry.agentId || '') === String(agentId || ''));
    let reservation = existing || null;
    if (!reservation) {
      const maxQueuePoints = getServerScriptedServiceQueueMaxPoints(this.dataDir, rawTarget);
      if (live.length >= maxQueuePoints) return { ok: false, reason: 'queue-full', queueIndex: live.length, maxQueuePoints };
      const queuedAtMs = Math.floor(numberOr(options.queuedAtMs, nowMs));
      reservation = {
        id: safeText(options.reservationId || `queue:scripted:${agentId}:${queueSpotId}:${queuedAtMs}`, '') || `queue:scripted:${agentId}`,
        state: 'queued',
        status: 'queued',
        agentId,
        actionId: safeText(options.actionId || rawTarget?.actionId || 'planning.schedule', 'planning.schedule') || 'planning.schedule',
        slotId: `${queueSpotId}:${live.length}`,
        queueSpotId,
        activationSpotId: `${queueSpotId}:${live.length}`,
        queuedAtMs,
        queuePriority: Number(options.queuePriority || rawTarget?.queuePriority || 0),
        queueIndex: live.length,
        capacityKind: 'queue',
        sourceKind: safeText(options.sourceKind || options.source || rawTarget?.runtimeSource || 'agent-scripted-mode', 'agent-scripted-mode') || 'agent-scripted-mode',
      };
      store.reservations = [...live, reservation];
    }
    normalizeServerScriptedServiceQueueReservations(store);
    reservation = store.reservations.find(entry => String(entry.agentId || '') === String(agentId || '')) || reservation;
    const queueTarget = serverScriptedServiceQueueSlotTarget(this.dataDir, { ...rawTarget, baseObjectKey, queueSpotId }, reservation);
    if (!queueTarget) return { ok: false, reason: 'missing-queue-target' };
    const baseObjectResult = this.upsertServerScriptedServiceQueueBaseObject(queueTarget, store, nowMs, now, 'queue-reserved');
    return { ok: true, target: queueTarget, reservation, store, baseObject: baseObjectResult?.object || null, reused: Boolean(existing) };
  }

  syncServerScriptedServiceQueueLine(baseObjectKeyOrTarget, nowMs, now, reason = 'queue-sync') {
    const baseObjectKey = typeof baseObjectKeyOrTarget === 'string'
      ? safeText(baseObjectKeyOrTarget, '')
      : serverScriptedQueueBaseObjectKey(baseObjectKeyOrTarget);
    if (!baseObjectKey) return { synced: 0, changedSnapshots: 0, changedObjects: 0, reason: 'missing-base-object-key' };
    const store = this.serverScriptedServiceQueueStoreFor(baseObjectKey);
    const reservations = normalizeServerScriptedServiceQueueReservations(store);
    this.upsertServerScriptedServiceQueueBaseObject({ ...(typeof baseObjectKeyOrTarget === 'object' ? baseObjectKeyOrTarget : {}), baseObjectKey, objectKey: baseObjectKey }, store, nowMs, now, reason);
    let synced = 0;
    let changedSnapshots = 0;
    let changedObjects = 0;
    for (const reservation of reservations) {
      const queuedAgentId = normalizeAgentId(reservation.agentId);
      const existing = this.state.agents.get(queuedAgentId);
      if (!existing) continue;
      const current = snapshotToPlain(existing);
      const currentTarget = current.target && typeof current.target === 'object' ? current.target : null;
      if (!currentTarget?.isQueueUse || serverScriptedQueueBaseObjectKey(currentTarget) !== baseObjectKey) continue;
      const nextTarget = serverScriptedServiceQueueSlotTarget(this.dataDir, currentTarget, reservation);
      if (!nextTarget) continue;
      const sameSlot = currentTarget.objectKey === nextTarget.objectKey &&
        Number(currentTarget.x) === Number(nextTarget.x) &&
        Number(currentTarget.y) === Number(nextTarget.y);
      if (sameSlot) continue;
      const routeResult = this.startServerScriptedObjectRoute(queuedAgentId, {
        ...nextTarget,
        runtimeStartedAt: currentTarget.runtimeStartedAt || now,
        runtimeActiveAt: '',
        runtimeSource: reservation.sourceKind || currentTarget.runtimeSource || 'idle',
      }, nowMs, now, { source: reservation.sourceKind || currentTarget.runtimeSource || 'idle', force: true });
      synced++;
      changedSnapshots += routeResult?.agent ? 1 : 0;
      changedObjects += routeResult?.object ? 1 : 0;
      if (currentTarget.objectKey && currentTarget.objectKey !== nextTarget.objectKey) {
        this.releaseServerScriptedObjectWorldObject(queuedAgentId, currentTarget, nowMs, now, `${reason}:queue-slot-shift`);
        changedObjects++;
      }
    }
    return { synced, queueLength: reservations.length, changedSnapshots, changedObjects };
  }

  releaseServerScriptedServiceQueueReservation(agentId, target, nowMs, now, reason = 'queue-released') {
    const baseObjectKey = serverScriptedQueueBaseObjectKey(target);
    if (!baseObjectKey) return { released: false, changedSnapshots: 0, changedObjects: 0, reason: 'missing-base-object-key' };
    const store = this.serverScriptedServiceQueueStoreFor(baseObjectKey);
    const before = normalizeServerScriptedServiceQueueReservations(store).length;
    store.reservations = store.reservations
      .map(entry => String(entry.agentId || '') === String(agentId || '')
        ? { ...entry, state: 'released', status: 'released', releasedAtMs: nowMs, releaseReason: reason }
        : entry)
      .filter(isLiveServerScriptedServiceQueueReservation);
    normalizeServerScriptedServiceQueueReservations(store);
    this.upsertServerScriptedServiceQueueBaseObject({ ...target, baseObjectKey, objectKey: baseObjectKey }, store, nowMs, now, reason);
    const released = normalizeServerScriptedServiceQueueReservations(store).length !== before;
    if (!released) return { released: false, changedSnapshots: 0, changedObjects: 1, reason: 'reservation-not-found' };
    const promoted = this.promoteServerScriptedServiceQueueFrontIfReady(baseObjectKey, nowMs, now, `${reason}:promote-next`);
    if (promoted.promoted) return { released: true, ...promoted };
    const synced = this.syncServerScriptedServiceQueueLine({ ...target, baseObjectKey, objectKey: baseObjectKey }, nowMs, now, reason);
    return {
      released: true,
      changedSnapshots: synced.changedSnapshots || 0,
      changedObjects: 1 + (synced.changedObjects || 0),
      reason,
    };
  }

  promoteServerScriptedServiceQueueFrontIfReady(baseObjectKeyOrTarget, nowMs, now, reason = 'service-use-complete') {
    const baseObjectKey = typeof baseObjectKeyOrTarget === 'string'
      ? safeText(baseObjectKeyOrTarget, '')
      : serverScriptedQueueBaseObjectKey(baseObjectKeyOrTarget);
    if (!baseObjectKey) return { promoted: false, changedSnapshots: 0, changedObjects: 0, reason: 'missing-base-object-key' };
    const baseObject = this.state.objects.get(baseObjectKey);
    if (hasActiveWorldObjectState(baseObject, nowMs)) {
      return { promoted: false, changedSnapshots: 0, changedObjects: 0, reason: 'service-object-busy' };
    }
    const store = this.serverScriptedServiceQueueStoreFor(baseObjectKey);
    const queue = normalizeServerScriptedServiceQueueReservations(store);
    const front = queue[0] || null;
    if (!front) {
      this.upsertServerScriptedServiceQueueBaseObject({ ...(typeof baseObjectKeyOrTarget === 'object' ? baseObjectKeyOrTarget : {}), baseObjectKey, objectKey: baseObjectKey }, store, nowMs, now, reason);
      return { promoted: false, changedSnapshots: 0, changedObjects: 1, reason: 'empty-queue' };
    }
    const queuedAgentId = normalizeAgentId(front.agentId);
    const agent = this.state.agents.get(queuedAgentId);
    if (!agent) {
      store.reservations = queue.slice(1);
      normalizeServerScriptedServiceQueueReservations(store);
      this.upsertServerScriptedServiceQueueBaseObject({ ...(typeof baseObjectKeyOrTarget === 'object' ? baseObjectKeyOrTarget : {}), baseObjectKey, objectKey: baseObjectKey }, store, nowMs, now, `${reason}:missing-front-agent`);
      const synced = this.syncServerScriptedServiceQueueLine({ ...(typeof baseObjectKeyOrTarget === 'object' ? baseObjectKeyOrTarget : {}), baseObjectKey, objectKey: baseObjectKey }, nowMs, now, `${reason}:missing-front-agent`);
      return {
        promoted: false,
        changedSnapshots: synced.changedSnapshots || 0,
        changedObjects: 1 + (synced.changedObjects || 0),
        reason: 'missing-front-agent',
      };
    }
    const current = snapshotToPlain(agent);
    const currentTarget = current.target && typeof current.target === 'object' ? current.target : { ...(typeof baseObjectKeyOrTarget === 'object' ? baseObjectKeyOrTarget : {}), baseObjectKey, objectKey: baseObjectKey };
    const primaryTarget = serverScriptedObjectPrimaryTargetForQueue(this.dataDir, currentTarget);
    if (!primaryTarget) return { promoted: false, changedSnapshots: 0, changedObjects: 0, reason: 'missing-service-use-target' };
    const source = safeText(front.sourceKind || currentTarget.runtimeSource || 'agent-scripted-mode', 'agent-scripted-mode') || 'agent-scripted-mode';
    let routeResult = null;
    try {
      routeResult = this.startServerScriptedObjectRoute(queuedAgentId, {
        ...primaryTarget,
        runtimeStartedAt: now,
        runtimeActiveAt: '',
        runtimeSource: source,
      }, nowMs, now, { source, force: true });
    } catch (error) {
      return {
        promoted: false,
        changedSnapshots: 0,
        changedObjects: 0,
        reason: error?.code || error?.message || 'promotion-route-rejected',
      };
    }
    let changedObjects = routeResult?.object ? 1 : 0;
    if (currentTarget?.isQueueUse && currentTarget.objectKey) {
      this.releaseServerScriptedObjectWorldObject(queuedAgentId, currentTarget, nowMs, now, `${reason}:front-promoted`);
      changedObjects++;
    }
    store.reservations = normalizeServerScriptedServiceQueueReservations(store)
      .filter(entry => String(entry.agentId || '') !== String(queuedAgentId));
    normalizeServerScriptedServiceQueueReservations(store);
    this.upsertServerScriptedServiceQueueBaseObject({ ...primaryTarget, baseObjectKey, objectKey: baseObjectKey }, store, nowMs, now, `${reason}:front-promoted`);
    changedObjects++;
    const synced = this.syncServerScriptedServiceQueueLine({ ...primaryTarget, baseObjectKey, objectKey: baseObjectKey }, nowMs, now, `${reason}:front-promoted`);
    return {
      promoted: true,
      agentId: queuedAgentId,
      changedSnapshots: (routeResult?.agent ? 1 : 0) + (synced.changedSnapshots || 0),
      changedObjects: changedObjects + (synced.changedObjects || 0),
      reason,
    };
  }

  startServerScriptedObjectRoute(agentId, rawTarget, nowMs = Date.now(), now = new Date(nowMs).toISOString(), options = {}) {
    let target = {
      ...rawTarget,
      runtimeStartedAt: rawTarget.runtimeStartedAt || now,
      runtimeActiveAt: options.active === true ? (rawTarget.runtimeActiveAt || now) : (rawTarget.runtimeActiveAt || ''),
      runtimeSource: options.source || rawTarget.runtimeSource || 'idle',
    };
    if (target.isQueueUse) {
      const queued = this.reserveServerScriptedServiceQueueTarget(agentId, target, nowMs, now, {
        sourceKind: options.source || target.runtimeSource || 'agent-scripted-mode',
        actionId: target.actionId,
      });
      if (!queued.ok) throw apiError(queued.reason || 'queue_rejected', `service queue rejected object use: ${queued.reason || 'unknown'}`, queued);
      target = {
        ...target,
        ...queued.target,
        runtimeStartedAt: target.runtimeStartedAt || now,
        runtimeActiveAt: options.active === true ? (target.runtimeActiveAt || now) : (target.runtimeActiveAt || ''),
        runtimeSource: options.source || target.runtimeSource || 'idle',
      };
    }
    const existing = this.ensureServerRuntimeAgentSeed(agentId, target, 'scripted-object-runtime-start');
    const current = snapshotToPlain(existing);
    const objectKey = normalizeWorldObjectKey(target.objectKey || runtimeFurnitureObjectKey(target.buildingId, target.furnitureIndex, target.objectType || 'object'));
    target.objectKey = objectKey;
    target.baseObjectKey = safeText(target.baseObjectKey, '') || objectKey;
    const existingObject = this.state.objects.get(objectKey);
    const existingBaseObject = target.baseObjectKey !== objectKey ? this.state.objects.get(target.baseObjectKey) : existingObject;
    const baseBlocked = target.isQueueUse ? false : isWorldObjectActiveForAnotherAgent(existingBaseObject, agentId, nowMs);
    if (!options.force && (isWorldObjectActiveForAnotherAgent(existingObject, agentId, nowMs) || baseBlocked)) {
      throw apiError('object_state_conflict', 'world object is active for another agent', { objectKey, agentId });
    }
    const routeId = safeText(`scripted-object:${agentId}:${target.buildingId || 'building'}:${target.furnitureIndex ?? 'object'}:${target.spotId || 'spot'}`, `scripted-object:${agentId}`);
    const targetHeading = targetFaceAngleRadians(target, current.heading);
    const movement = makeServerRuntimeStep(this.dataDir, agentId, current, target, DEFAULT_WORLD_RUNTIME_TICK_MS, {
      speedUnitsPerSec: serverScriptedObjectRuntimeSpeedUnitsPerSec(target, true),
      arrivalRadius: SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS,
      routeSource: 'server-scripted-object-runtime',
    });
    const arrived = options.active === true || movement.arrived;
    if (arrived && target.runtimePhase === 'desk-routing') target.runtimePhase = 'desk-consuming';
    if (arrived && !target.runtimeActiveAt) target.runtimeActiveAt = now;
    const snapshotResult = this.upsertSnapshot({
      agentId,
      mode: 'live',
      owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
      x: arrived ? Number(target.x) : movement.x,
      y: arrived ? Number(target.y) : movement.y,
      floor: target.floor,
      buildingId: target.buildingId || '',
      roomId: target.roomId || '',
      heading: arrived ? targetHeading : movement.heading,
      state: arrived ? (target.isQueueUse ? 'waiting' : 'using') : 'routing',
      routeId,
      worldActionId: '',
      target,
      leaseOwner: SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
      leaseExpiresAt: new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS).toISOString(),
      visualState: withRuntimeRouteVisualState(makeServerScriptedObjectVisualState(!arrived, target, 'idle'), movement.route),
    }, arrived ? 'server-scripted-object-active' : 'server-scripted-object-routing', {
      routeId,
      objectKey,
      source: options.source || 'idle',
    });
    const objectExpiresAt = new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS + Math.max(SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS, numberOr(target.stayMs, SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS))).toISOString();
    const objectState = arrived ? (target.isQueueUse ? 'queued' : 'active') : 'routing';
    const objectResult = this.upsertWorldObject({
      objectKey,
      owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
      objectType: target.objectType || '',
      buildingId: target.buildingId || '',
      furnitureIndex: target.furnitureIndex ?? -1,
      state: objectState,
      agentId,
      actionId: target.actionId || '',
      reservationId: safeText(`server-res:${objectKey}:${agentId}`, '') || `server-res:${agentId}`,
      activeUseId: arrived && !target.isQueueUse ? (safeText(`server-active:${objectKey}:${agentId}`, '') || `server-active:${agentId}`) : '',
      slotId: target.slotId || target.spotId || '',
      expiresAt: objectExpiresAt,
      data: this.serverScriptedObjectDataWithQueueStore(
        target,
        makeServerScriptedObjectData(agentId, target, objectState, now, objectExpiresAt, options.source || 'idle'),
      ),
    }, arrived ? 'server-scripted-object-world-active' : 'server-scripted-object-world-routing', {
      routeId,
      source: options.source || 'idle',
    });
    return {
      agent: snapshotResult.agent,
      object: objectResult.object,
      snapshotEvent: snapshotResult.event,
      objectEvent: objectResult.event,
    };
  }

  transitionServerLiveAction(action, toStatus, options = {}) {
    const transitioned = transitionWorldActionRecord(action, toStatus, {
      actor: options.actor || 'agent-runtime-room.mjs#tickLiveActionRuntime',
      source: options.source || 'server-runtime',
      now: options.now || new Date().toISOString(),
      reason: options.reason || `server-authoritative-${toStatus}`,
      result: options.result,
      failureReason: options.failureReason,
    });
    return transitioned;
  }

  tickLiveActionRuntime(tickMs, nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
    if (nowMs - Number(this.lastLiveActionRuntimeStepMs || 0) < LIVE_ACTION_RUNTIME_POLL_MS) {
      return { changedActions: false, changedSnapshots: 0 };
    }
    this.lastLiveActionRuntimeStepMs = nowMs;
    const { meta, store } = this.loadLiveActionRuntimeStore(nowMs);
    const active = Array.isArray(store.active) ? store.active : [];
    if (active.length === 0) return { changedActions: false, changedSnapshots: 0 };

    let changedActions = false;
    let changedSnapshots = 0;
    const nextActive = [];
    const nextHistory = Array.isArray(store.history) ? [...store.history] : [];

    for (const originalAction of active) {
      let action = cloneJson(originalAction, originalAction) || originalAction;
      const actionId = safeText(action?.id || action?.worldActionId, '');
      const agentId = safeText(action?.agentId, '');
      let status = canonicalWorldActionStatus(action?.status);
      if (!actionId || !agentId || !WORLD_ACTION_ACTIVE_STATUSES.has(status)) {
        nextActive.push(action);
        continue;
      }

      const targetPoint = resolveActionTargetPoint(this.dataDir, action, this.state);
      const existing = this.state.agents.get(agentId);
      if (!targetPoint || !existing) {
        nextActive.push(action);
        continue;
      }

      const actor = 'agent-runtime-room.mjs#tickLiveActionRuntime';
      const source = worldActionSourceKind(action, 'server-runtime');
      for (const nextStatus of ['created', 'reserved', 'route_pending', 'routing']) {
        status = canonicalWorldActionStatus(action.status);
        if (!worldActionTransitionAllowed(status, nextStatus)) continue;
        const transitioned = this.transitionServerLiveAction(action, nextStatus, {
          now,
          actor,
          source,
          reason: nextStatus === 'routing' ? 'server-runtime-route-started' : `server-runtime-${nextStatus}`,
        });
        if (transitioned.changed) {
          action = transitioned.action;
          changedActions = true;
        }
      }

      status = canonicalWorldActionStatus(action.status);
      const current = snapshotToPlain(existing);
      const movement = makeServerRuntimeStep(this.dataDir, agentId, current, targetPoint, tickMs, {
        speedUnitsPerSec: LIVE_ACTION_RUNTIME_SPEED_UNITS_PER_SEC,
        arrivalRadius: LIVE_ACTION_RUNTIME_ARRIVAL_RADIUS,
        routeSource: 'server-live-action-runtime',
      });
      const arrived = movement.arrived;
      const nextX = movement.x;
      const nextY = movement.y;
      const heading = movement.heading;
      const snapshotTarget = makeLiveActionSnapshotTarget(action, targetPoint);
      const routeId = safeText(action?.route?.id || action?.route?.routeId, `route-${actionId}`) || `route-${actionId}`;

      if (status === 'routing' || status === 'route_pending') {
        this.upsertSnapshot({
          agentId,
          mode: 'live',
          owner: LIVE_ACTION_RUNTIME_OWNER,
          x: nextX,
          y: nextY,
          floor: targetPoint.floor,
          buildingId: targetPoint.buildingId || '',
          roomId: targetPoint.roomId || '',
          heading,
          state: arrived ? 'arrived' : 'routing',
          routeId,
          worldActionId: actionId,
          target: snapshotTarget,
          leaseOwner: LIVE_ACTION_RUNTIME_LEASE_OWNER,
          leaseExpiresAt: new Date(nowMs + LIVE_ACTION_RUNTIME_LEASE_TTL_MS).toISOString(),
          visualState: withRuntimeRouteVisualState(makeLiveActionVisualState(!arrived), movement.route),
        }, arrived ? 'server-live-action-arrived' : 'server-live-action-routing', { actionId, routeId });
        changedSnapshots++;
        if (arrived && status === 'routing') {
          const transitioned = this.transitionServerLiveAction(action, 'arrived', {
            now,
            actor,
            source,
            reason: 'server-runtime-arrived-at-target',
          });
          if (transitioned.changed) {
            action = transitioned.action;
            changedActions = true;
          }
        }
      }

      status = canonicalWorldActionStatus(action.status);
      if (status === 'arrived') {
        const transitioned = this.transitionServerLiveAction(action, 'in_progress', {
          now,
          actor,
          source,
          reason: 'server-runtime-activity-started',
        });
        if (transitioned.changed) {
          action = transitioned.action;
          changedActions = true;
        }
      }

      status = canonicalWorldActionStatus(action.status);
      if (status === 'in_progress') {
        this.upsertSnapshot({
          agentId,
          mode: 'live',
          owner: LIVE_ACTION_RUNTIME_OWNER,
          x: Number(targetPoint.x),
          y: Number(targetPoint.y),
          floor: targetPoint.floor,
          buildingId: targetPoint.buildingId || '',
          roomId: targetPoint.roomId || '',
          heading,
          state: 'in_progress',
          routeId,
          worldActionId: actionId,
          target: snapshotTarget,
          leaseOwner: LIVE_ACTION_RUNTIME_LEASE_OWNER,
          leaseExpiresAt: new Date(nowMs + LIVE_ACTION_RUNTIME_LEASE_TTL_MS).toISOString(),
          visualState: makeLiveActionVisualState(false),
        }, 'server-live-action-in-progress', { actionId, routeId });
        changedSnapshots++;
        if (serverLiveActionShouldComplete(action, nowMs)) {
          const sideEffect = writeServerBuiltHomeIfNeeded(this.dataDir, action, now);
          const result = {
            status: 'completed',
            applied: true,
            reason: 'server_authoritative_live_action_completed',
            runtime: LIVE_ACTION_RUNTIME_OWNER,
            ...(sideEffect ? { objectEffect: sideEffect.status === 'created' ? 'visible-home-built' : 'visible-home-already-built', buildingId: sideEffect.buildingId } : {}),
          };
          const transitioned = this.transitionServerLiveAction(action, 'completed', {
            now,
            actor,
            source,
            reason: 'server-authoritative-live-action-completed',
            result,
          });
          if (transitioned.changed) {
            action = transitioned.action;
            changedActions = true;
          }
          clearDynamicInteriorRoutingForAgent(agentId);
          clearDynamicExteriorRoutingForAgent(agentId);
          this.upsertSnapshot({
            agentId,
            mode: 'scripted',
            owner: 'agent-scripted-mode',
            x: Number(targetPoint.x),
            y: Number(targetPoint.y),
            floor: targetPoint.floor,
            buildingId: targetPoint.buildingId || '',
            roomId: targetPoint.roomId || '',
            heading,
            state: 'idle',
            routeId: '',
            worldActionId: '',
            target: null,
            leaseOwner: '',
            leaseExpiresAt: '',
            visualState: makeLiveActionVisualState(false, 'working'),
          }, 'server-live-action-completed', { actionId, routeId });
          changedSnapshots++;
        }
      }

      status = canonicalWorldActionStatus(action.status);
      if (WORLD_ACTION_TERMINAL_STATUSES.has(status)) {
        nextHistory.unshift(action);
      } else {
        nextActive.push(action);
      }
    }

    if (changedActions) {
      this.saveLiveActionRuntimeStore(meta, {
        ...store,
        active: nextActive,
        history: nextHistory.slice(0, 1000),
      }, nowMs);
    }
    return { changedActions, changedSnapshots };
  }

  tickLiveStatusRuntime(tickMs, nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
    if (nowMs - Number(this.lastLiveStatusRuntimeStepMs || 0) < LIVE_STATUS_RUNTIME_POLL_MS) {
      return { changedSnapshots: 0 };
    }
    this.lastLiveStatusRuntimeStepMs = nowMs;
    const plan = this.loadLiveStatusRuntimePlan(nowMs);
    const targetsByAgent = plan?.targetsByAgent && typeof plan.targetsByAgent === 'object' ? plan.targetsByAgent : {};
    let changedSnapshots = 0;

    for (const [agentId, target] of Object.entries(targetsByAgent)) {
      if (!this.state.agents.has(agentId)) {
        this.ensureServerRuntimeAgentSeed(agentId, target, 'live-status-runtime-start');
        changedSnapshots++;
      }
    }

    for (const [agentId, existing] of this.state.agents.entries()) {
      const current = snapshotToPlain(existing);
      const target = targetsByAgent[agentId] || null;
      const ownedByStatusRuntime = current.owner === LIVE_STATUS_RUNTIME_OWNER || current.leaseOwner === LIVE_STATUS_RUNTIME_LEASE_OWNER;
      const activeOtherLease = Boolean(
        hasActiveLease(existing, nowMs) &&
        current.leaseOwner &&
        current.leaseOwner !== LIVE_STATUS_RUNTIME_LEASE_OWNER
      );

      if (!target) {
        if (ownedByStatusRuntime) {
          clearDynamicInteriorRoutingForAgent(agentId);
          clearDynamicExteriorRoutingForAgent(agentId);
          const previousTarget = current.target && typeof current.target === 'object' ? current.target : null;
          const objectKey = liveStatusRuntimeObjectKey(previousTarget);
          this.upsertSnapshot({
            agentId,
            mode: 'scripted',
            owner: 'agent-scripted-mode',
            x: current.x,
            y: current.y,
            floor: current.floor,
            buildingId: current.buildingId || '',
            roomId: current.roomId || '',
            heading: current.heading,
            state: 'idle',
            routeId: '',
            worldActionId: '',
            target: null,
            leaseOwner: '',
            leaseExpiresAt: '',
            visualState: makeLiveStatusVisualState(false, 'idle'),
          }, 'server-live-status-released', { reason: 'presence-not-working' });
          if (objectKey) {
            const objectExpiresAt = new Date(nowMs + LIVE_STATUS_RUNTIME_LEASE_TTL_MS).toISOString();
            this.upsertWorldObject({
              objectKey,
              owner: LIVE_STATUS_RUNTIME_OWNER,
              objectType: previousTarget?.objectType || '',
              buildingId: previousTarget?.buildingId || '',
              furnitureIndex: previousTarget?.furnitureIndex ?? -1,
              state: 'idle',
              agentId,
              actionId: previousTarget?.actionId || '',
              reservationId: '',
              activeUseId: '',
              slotId: previousTarget?.slotId || previousTarget?.spotId || '',
              expiresAt: objectExpiresAt,
              data: {
                ...makeLiveStatusObjectData(agentId, previousTarget, 'idle', now, objectExpiresAt),
                clearReservation: true,
              },
            }, 'server-live-status-world-released', { reason: 'presence-not-working' });
          }
          changedSnapshots++;
        }
        continue;
      }

      if (activeOtherLease) continue;

      const statusKind = target.statusKind === 'meeting' ? 'meeting' : 'work';
      const movement = makeServerRuntimeStep(this.dataDir, agentId, current, target, tickMs, {
        speedUnitsPerSec: statusKind === 'meeting' ? LIVE_STATUS_RUNTIME_SPEED_UNITS_PER_SEC : LIVE_STATUS_RUNTIME_RUN_SPEED_UNITS_PER_SEC,
        arrivalRadius: LIVE_STATUS_RUNTIME_ARRIVAL_RADIUS,
        routeSource: 'server-live-status-runtime',
      });
      const arrived = movement.arrived;
      const nextX = movement.x;
      const nextY = movement.y;
      const targetHeading = targetFaceAngleRadians(target, current.heading);
      const heading = arrived ? targetHeading : movement.heading;
      const routeId = safeText(`live-status-${statusKind}:${agentId}:${target.buildingId || 'building'}:${target.furnitureIndex ?? 'object'}:${target.spotId || 'spot'}`, `live-status-${statusKind}:${agentId}`);
      const leaseExpiresAtMs = Date.parse(current.leaseExpiresAt || '');
      const needsLeaseRefresh = !Number.isFinite(leaseExpiresAtMs) || leaseExpiresAtMs - nowMs <= LIVE_STATUS_RUNTIME_LEASE_REFRESH_MS;
      const targetChanged = current.routeId !== routeId || current.target?.buildingId !== target.buildingId || current.target?.furnitureIndex !== target.furnitureIndex || current.target?.spotId !== target.spotId;
      const state = arrived ? (statusKind === 'meeting' ? 'meeting' : 'working') : 'routing';
      const shouldWrite = !ownedByStatusRuntime || !arrived || needsLeaseRefresh || targetChanged || current.state !== state;
      if (!shouldWrite) continue;
      const objectKey = liveStatusRuntimeObjectKey(target);
      const objectState = arrived ? 'active' : 'routing';
      const objectExpiresAt = new Date(nowMs + LIVE_STATUS_RUNTIME_LEASE_TTL_MS).toISOString();

      this.upsertSnapshot({
        agentId,
        mode: 'live',
        owner: LIVE_STATUS_RUNTIME_OWNER,
        x: nextX,
        y: nextY,
        floor: target.floor,
        buildingId: target.buildingId || '',
        roomId: target.roomId || '',
        heading,
        state,
        routeId,
        worldActionId: '',
        target,
        leaseOwner: LIVE_STATUS_RUNTIME_LEASE_OWNER,
        leaseExpiresAt: new Date(nowMs + LIVE_STATUS_RUNTIME_LEASE_TTL_MS).toISOString(),
        visualState: withRuntimeRouteVisualState(makeLiveStatusVisualState(!arrived, statusKind === 'meeting' ? 'meeting' : 'working', target), movement.route),
      }, arrived ? (statusKind === 'meeting' ? 'server-live-status-meeting-table' : 'server-live-status-work-desk') : 'server-live-status-routing', {
        routeId,
        buildingId: target.buildingId || '',
        furnitureIndex: target.furnitureIndex ?? null,
      });
      if (objectKey) {
        this.upsertWorldObject({
          objectKey,
          owner: LIVE_STATUS_RUNTIME_OWNER,
          objectType: target.objectType || '',
          buildingId: target.buildingId || '',
          furnitureIndex: target.furnitureIndex ?? -1,
          state: objectState,
          agentId,
          actionId: target.actionId || '',
          reservationId: safeText(`live-status-res:${objectKey}:${agentId}`, '') || `live-status-res:${agentId}`,
          activeUseId: arrived ? (safeText(`live-status-active:${objectKey}:${agentId}`, '') || `live-status-active:${agentId}`) : '',
          slotId: target.slotId || target.spotId || '',
          expiresAt: objectExpiresAt,
          data: makeLiveStatusObjectData(agentId, target, objectState, now, objectExpiresAt),
        }, arrived ? 'server-live-status-world-active' : 'server-live-status-world-routing', { routeId });
      }
      changedSnapshots++;
    }

    return { changedSnapshots };
  }

  releaseServerScriptedObjectWorldObject(agentId, target, nowMs, now, reason = 'completed') {
    const objectKey = safeText(target?.objectKey, '');
    if (!objectKey) return null;
    const expiresAt = new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_COOLDOWN_MS).toISOString();
    return this.upsertWorldObject({
      objectKey,
      owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
      objectType: target?.objectType || '',
      buildingId: target?.buildingId || '',
      furnitureIndex: target?.furnitureIndex ?? -1,
      state: 'idle',
      agentId,
      actionId: target?.actionId || '',
      reservationId: '',
      activeUseId: '',
      slotId: target?.slotId || target?.spotId || '',
      expiresAt,
      data: this.serverScriptedObjectDataWithQueueStore(target, {
        ...makeServerScriptedObjectData(agentId, target, 'idle', now, expiresAt, target?.runtimeSource || 'idle'),
        clearReservation: true,
        releaseReason: reason,
      }, { includeEmpty: true }),
    }, 'server-scripted-object-world-released', { reason });
  }

  releaseServerScriptedObjectRoute(agentId, current, target, nowMs, now, reason = 'completed') {
    clearDynamicInteriorRoutingForAgent(agentId);
    clearDynamicExteriorRoutingForAgent(agentId);
    const objectKey = safeText(target?.objectKey, '');
    const x = Number.isFinite(Number(target?.x)) ? Number(target.x) : Number(current?.x || 0);
    const y = Number.isFinite(Number(target?.y)) ? Number(target.y) : Number(current?.y || 0);
    const heading = targetFaceAngleRadians(target, current?.heading);
    const snapshotResult = this.upsertSnapshot({
      agentId,
      mode: 'scripted',
      owner: 'agent-scripted-mode',
      x,
      y,
      floor: floorOr(target?.floor ?? current?.floor, 1),
      buildingId: target?.buildingId || current?.buildingId || '',
      roomId: target?.roomId || current?.roomId || '',
      heading,
      state: 'idle',
      routeId: '',
      worldActionId: '',
      target: null,
      leaseOwner: '',
      leaseExpiresAt: '',
      visualState: makeServerScriptedObjectIdleVisualState(),
    }, 'server-scripted-object-released', {
      objectKey,
      reason,
    });
    const objectResult = objectKey ? this.releaseServerScriptedObjectWorldObject(agentId, target, nowMs, now, reason) : null;
    if (target?.isQueueUse) {
      this.releaseServerScriptedServiceQueueReservation(agentId, target, nowMs, now, reason);
    }
    return { agent: snapshotResult.agent, object: objectResult?.object || null };
  }

  tickScriptedObjectRuntime(tickMs, nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
    if (nowMs - Number(this.lastScriptedObjectRuntimeStepMs || 0) < SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS) {
      return { changedSnapshots: 0, changedObjects: 0 };
    }
    this.lastScriptedObjectRuntimeStepMs = nowMs;
    const plan = this.loadScriptedObjectRuntimePlan(nowMs);
    const idleAgentIds = new Set(Array.isArray(plan?.idleAgentIds) ? plan.idleAgentIds : []);
    const targets = Array.isArray(plan?.targets) ? plan.targets : [];
    let changedSnapshots = 0;
    let changedObjects = 0;
    let activeScriptedRoutes = 0;
    const activeRouteLimit = Math.max(
      SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_ACTIVE_ROUTES,
      Math.ceil(Math.max(0, idleAgentIds.size) * 0.45),
    );
    const startLimit = Math.max(
      SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_STARTS_PER_TICK,
      Math.min(6, Math.ceil(Math.max(1, idleAgentIds.size) * 0.18)),
    );
    const idleCheckLimit = Math.max(
      SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_IDLE_CHECKS_PER_TICK,
      Math.min(18, Math.ceil(Math.max(1, idleAgentIds.size) * 0.5)),
    );
    let activeRouteSteps = 0;

    for (const [agentId, existing] of this.state.agents.entries()) {
      const current = snapshotToPlain(existing);
      const ownedByScriptedObjectRuntime = current.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || current.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER;
      if (!ownedByScriptedObjectRuntime) continue;
      activeScriptedRoutes++;
      if (activeScriptedRoutes > activeRouteLimit) {
        let target = current.target && typeof current.target === 'object' ? current.target : null;
        target = refreshScriptedObjectRuntimeTarget(this.dataDir, target);
        target = hydrateServerScriptedDeskConsumeTargetFromVisual(target, current.visualState);
        this.releaseServerScriptedObjectRoute(agentId, current, target || {}, nowMs, now, 'active-route-cap');
        changedSnapshots++;
        changedObjects += target?.objectKey ? 1 : 0;
        continue;
      }
      let target = current.target && typeof current.target === 'object' ? current.target : null;
      target = refreshScriptedObjectRuntimeTarget(this.dataDir, target);
      target = hydrateServerScriptedDeskConsumeTargetFromVisual(target, current.visualState);
      const source = safeText(target?.runtimeSource, 'idle') || 'idle';
      if (!target?.objectKey || (source === 'idle' && !idleAgentIds.has(agentId))) {
        this.releaseServerScriptedObjectRoute(agentId, current, target || {}, nowMs, now, target?.objectKey ? 'presence-not-idle' : 'missing-target');
        changedSnapshots++;
        changedObjects += target?.objectKey ? 1 : 0;
        continue;
      }

      const alreadyActive = ['using', 'active', 'occupied', 'queued', 'waiting'].includes(String(current.state || '').toLowerCase());
      if (!alreadyActive && activeRouteSteps >= SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_ROUTE_STEPS_PER_TICK) {
        continue;
      }
      if (!alreadyActive) activeRouteSteps++;
      const movement = makeServerRuntimeStep(this.dataDir, agentId, current, target, tickMs, {
        speedUnitsPerSec: serverScriptedObjectRuntimeSpeedUnitsPerSec(target, true),
        arrivalRadius: SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS,
        routeSource: 'server-scripted-object-runtime',
      });
      const arrived = alreadyActive || movement.arrived;
      const nextX = arrived ? Number(target.x) : movement.x;
      const nextY = arrived ? Number(target.y) : movement.y;
      const targetHeading = targetFaceAngleRadians(target, current.heading);
      const heading = arrived ? targetHeading : movement.heading;
      const routeId = current.routeId || safeText(`scripted-object:${agentId}:${target.buildingId || 'building'}:${target.furnitureIndex ?? 'object'}:${target.spotId || 'spot'}`, `scripted-object:${agentId}`);
      const leaseExpiresAtMs = Date.parse(current.leaseExpiresAt || '');
      const needsLeaseRefresh = !Number.isFinite(leaseExpiresAtMs) || leaseExpiresAtMs - nowMs <= SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_REFRESH_MS;

      if (!arrived) {
        const objectExpiresAt = new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS + Math.max(SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS, numberOr(target.stayMs, SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS))).toISOString();
        this.upsertSnapshot({
          agentId,
          mode: 'live',
          owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
          x: nextX,
          y: nextY,
          floor: target.floor,
          buildingId: target.buildingId || '',
          roomId: target.roomId || '',
          heading,
          state: 'routing',
          routeId,
          worldActionId: '',
          target,
          leaseOwner: SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
          leaseExpiresAt: new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS).toISOString(),
          visualState: withRuntimeRouteVisualState(makeServerScriptedObjectVisualState(true, target, 'idle'), movement.route),
        }, 'server-scripted-object-routing', { routeId, objectKey: target.objectKey });
        changedSnapshots++;
        this.upsertWorldObject({
          objectKey: target.objectKey,
          owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
          objectType: target.objectType || '',
          buildingId: target.buildingId || '',
          furnitureIndex: target.furnitureIndex ?? -1,
          state: 'routing',
          agentId,
          actionId: target.actionId || '',
          reservationId: safeText(`server-res:${target.objectKey}:${agentId}`, '') || `server-res:${agentId}`,
          activeUseId: '',
          slotId: target.slotId || target.spotId || '',
          expiresAt: objectExpiresAt,
          data: this.serverScriptedObjectDataWithQueueStore(
            target,
            makeServerScriptedObjectData(agentId, target, 'routing', now, objectExpiresAt, source),
          ),
        }, 'server-scripted-object-world-routing', { routeId });
        changedObjects++;
        continue;
      }

      const runtimeActiveAt = safeIso(target.runtimeActiveAt, '') || now;
      const activeAtMs = Date.parse(runtimeActiveAt);
      const activeTarget = {
        ...target,
        runtimeActiveAt,
        runtimePhase: target.runtimePhase === 'desk-routing' ? 'desk-consuming' : target.runtimePhase,
      };
      if (activeTarget.isQueueUse) {
        const promoted = this.promoteServerScriptedServiceQueueFrontIfReady(activeTarget, nowMs, now, 'queue-front-wait');
        if (promoted.promoted) {
          changedSnapshots += promoted.changedSnapshots || 0;
          changedObjects += promoted.changedObjects || 0;
          continue;
        }
      }
      const dwellMs = Math.max(1000, Math.floor(numberOr(target.stayMs, scriptedObjectStayMs(target))));
      if (!activeTarget.isQueueUse && Number.isFinite(activeAtMs) && nowMs - activeAtMs >= dwellMs) {
        if (isServerScriptedObjectDeskConsumeTarget(activeTarget)) {
          this.releaseServerScriptedObjectRoute(agentId, current, activeTarget, nowMs, now, activeTarget.consumeEffect || 'temporary-item-consumed-at-desk');
          changedSnapshots++;
          changedObjects++;
          continue;
        }
        const deskTarget = makeServerScriptedDeskConsumeTarget(this.dataDir, agentId, activeTarget, nowMs);
        if (deskTarget) {
          const releaseResult = this.releaseServerScriptedObjectWorldObject(agentId, activeTarget, nowMs, now, deskTarget.pickupEffect || 'temporary-item-picked-up');
          const promoted = this.promoteServerScriptedServiceQueueFrontIfReady(activeTarget, nowMs, now, deskTarget.pickupEffect || 'temporary-item-picked-up');
          const routeResult = this.startServerScriptedObjectRoute(agentId, deskTarget, nowMs, now, { source, force: true });
          changedSnapshots += routeResult?.agent ? 1 : 0;
          changedObjects += releaseResult?.object ? 1 : 0;
          changedSnapshots += promoted.changedSnapshots || 0;
          changedObjects += promoted.changedObjects || 0;
          changedObjects += routeResult?.object ? 1 : 0;
          continue;
        }
        this.releaseServerScriptedObjectRoute(agentId, current, activeTarget, nowMs, now, 'dwell-complete');
        const promoted = this.promoteServerScriptedServiceQueueFrontIfReady(activeTarget, nowMs, now, 'dwell-complete');
        changedSnapshots++;
        changedObjects++;
        changedSnapshots += promoted.changedSnapshots || 0;
        changedObjects += promoted.changedObjects || 0;
        continue;
      }

      const activeSnapshotState = target.isQueueUse ? 'waiting' : 'using';
      const activeObjectState = target.isQueueUse ? 'queued' : 'active';
      const shouldWrite = needsLeaseRefresh || current.state !== activeSnapshotState || current.x !== Number(target.x) || current.y !== Number(target.y);
      if (!shouldWrite) continue;
      const objectExpiresAt = new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS + Math.max(SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS, numberOr(activeTarget.stayMs, SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS))).toISOString();
      this.upsertSnapshot({
        agentId,
        mode: 'live',
        owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
        x: Number(target.x),
        y: Number(target.y),
        floor: target.floor,
        buildingId: target.buildingId || '',
        roomId: target.roomId || '',
        heading,
        state: activeSnapshotState,
        routeId,
        worldActionId: '',
        target: activeTarget,
        leaseOwner: SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
        leaseExpiresAt: new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS).toISOString(),
        visualState: makeServerScriptedObjectVisualState(false, activeTarget, 'idle'),
      }, target.isQueueUse ? 'server-scripted-object-queued' : 'server-scripted-object-active', { routeId, objectKey: target.objectKey });
      changedSnapshots++;
      this.upsertWorldObject({
        objectKey: target.objectKey,
        owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
        objectType: target.objectType || '',
        buildingId: target.buildingId || '',
        furnitureIndex: target.furnitureIndex ?? -1,
        state: activeObjectState,
        agentId,
        actionId: target.actionId || '',
        reservationId: safeText(`server-res:${target.objectKey}:${agentId}`, '') || `server-res:${agentId}`,
        activeUseId: target.isQueueUse ? '' : (safeText(`server-active:${target.objectKey}:${agentId}`, '') || `server-active:${agentId}`),
        slotId: target.slotId || target.spotId || '',
        expiresAt: objectExpiresAt,
        data: this.serverScriptedObjectDataWithQueueStore(
          activeTarget,
          makeServerScriptedObjectData(agentId, activeTarget, activeObjectState, now, objectExpiresAt, source),
        ),
      }, target.isQueueUse ? 'server-scripted-object-world-queued' : 'server-scripted-object-world-active', { routeId });
      changedObjects++;
    }

    const idleAgentList = Array.from(idleAgentIds);
    let idleChecks = 0;
    let idleStarts = 0;
    while (
      idleAgentList.length > 0 &&
      idleChecks < idleCheckLimit &&
      activeScriptedRoutes + idleStarts < activeRouteLimit &&
      idleStarts < startLimit
    ) {
      const index = positiveModulo(this.scriptedObjectRuntimeIdleCursor, idleAgentList.length);
      const agentId = idleAgentList[index];
      this.scriptedObjectRuntimeIdleCursor = positiveModulo(index + 1, idleAgentList.length);
      idleChecks++;
      const existing = this.state.agents.get(agentId);
      if (existing) {
        const current = snapshotToPlain(existing);
        if (current.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || current.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER) continue;
        if (hasActiveLease(existing, nowMs)) continue;
        if (!['idle', 'scripted'].includes(String(current.state || '').toLowerCase()) && String(current.state || '').toLowerCase() !== 'idle') continue;
      }
      const cooldownUntil = Number(this.scriptedObjectRuntimeCooldowns.get(agentId) || 0);
      if (cooldownUntil > nowMs) continue;
      if (!this.ensureServerScriptedIdlePulseDue(agentId, nowMs)) continue;
      const memory = this.serverScriptedMemoryFor(agentId, nowMs);
      let current = existing ? snapshotToPlain(existing) : null;
      if (!current) current = snapshotToPlain(this.ensureServerRuntimeAgentSeed(agentId, null, 'scripted-object-idle-pulse'));
      const target = pickScriptedObjectRuntimeTarget(agentId, targets, this.state, nowMs, {
        current,
        dataDir: this.dataDir,
        memory,
        plan,
      });
      if (!target) {
        this.scheduleServerScriptedIdlePulse(agentId, SERVER_SCRIPTED_IDLE_RETRY_DELAY_MS, 'no-target', nowMs);
        continue;
      }
      try {
        this.startServerScriptedObjectRoute(agentId, target, nowMs, now, { source: 'idle' });
        this.markServerScriptedRuntimeChoice(agentId, target, nowMs);
      } catch (error) {
        this.markServerScriptedRuntimeFailure(agentId, target, error?.code || error?.message || 'start-failed', nowMs);
        continue;
      }
      idleStarts++;
      changedSnapshots++;
      changedObjects++;
    }

    for (const [agentId, untilMs] of Array.from(this.scriptedObjectRuntimeCooldowns.entries())) {
      if (Number(untilMs || 0) <= nowMs) this.scriptedObjectRuntimeCooldowns.delete(agentId);
    }

    return { changedSnapshots, changedObjects };
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
    this.persistRuntimeDocument();
    this.broadcastRuntimeState(eventType);
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
    this.persistRuntimeDocument();
    this.broadcastRuntimeState(eventType);
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
    if (runtime.topologyOwner === SERVER_WORLD_TOPOLOGY_OWNER && owner !== SERVER_WORLD_TOPOLOGY_OWNER) {
      const event = this.recordEvent('world-topology-skipped-server-authoritative', 'worldRuntime', worldRuntimeToPlain(runtime), {
        topologyHash: runtime.topologyHash,
        topologyOwner: runtime.topologyOwner,
        skippedOwner: owner,
      });
      return { worldRuntime: runtime, event };
    }
    if (runtime.topologyOwner &&
      runtime.topologyOwner !== owner &&
      runtime.topologyHash === nextTopologyHash &&
      topologyOwnerFresh &&
      owner !== SERVER_WORLD_TOPOLOGY_OWNER) {
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
    this.persistRuntimeDocument();
    this.broadcastRuntimeState(eventType, { force: true });
    return { worldRuntime: runtime, event };
  }

  tickWorldRuntime(nowMs = Date.now()) {
    this.ensureServerWorldTopology(nowMs);
    const runtime = this.state.worldRuntime;
    if (!runtime) return null;
    const persistedTickMs = clampInteger(runtime.tickMs, DEFAULT_WORLD_RUNTIME_TICK_MS, 100, 5000);
    const tickMs = Math.max(DEFAULT_WORLD_RUNTIME_TICK_MS, persistedTickMs);
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
    let changedVehicles = 0;
    let changedLiveActions = { changedActions: false, changedSnapshots: 0 };
    let changedLiveStatus = { changedSnapshots: 0 };
    let changedScriptedObjects = { changedSnapshots: 0, changedObjects: 0 };
    this.runWithDeferredRuntimeDocumentWrites(() => {
      changedVehicles = process.env.VW_REALTIME_DISABLE_TRAFFIC_TICK === 'true'
        ? 0
        : this.tickTrafficVehicles(runtime, tickMs, now);
      changedLiveActions = process.env.VW_REALTIME_DISABLE_LIVE_ACTION_TICK === 'true'
        ? { changedActions: false, changedSnapshots: 0 }
        : this.tickLiveActionRuntime(tickMs, nowMs, now);
      changedLiveStatus = process.env.VW_REALTIME_DISABLE_LIVE_STATUS_TICK === 'true'
        ? { changedSnapshots: 0 }
        : this.tickLiveStatusRuntime(tickMs, nowMs, now);
      changedScriptedObjects = process.env.VW_REALTIME_DISABLE_SCRIPTED_OBJECT_TICK === 'true'
        ? { changedSnapshots: 0, changedObjects: 0 }
        : this.tickScriptedObjectRuntime(tickMs, nowMs, now);
    });
    if (this.runtimeStateBroadcastDirty) this.broadcastRuntimeState('world-runtime-state');

    if (changedLights > 0 || changedVehicles > 0) {
      this.broadcast('runtime:worldRuntime', {
        type: 'world-runtime-tick',
        worldRuntime: worldRuntimeToPlain(runtime),
        changedLights,
        changedVehicles,
        changedLiveActions: changedLiveActions.changedActions ? 1 : 0,
        changedLiveActionSnapshots: changedLiveActions.changedSnapshots,
        changedLiveStatusSnapshots: changedLiveStatus.changedSnapshots,
        changedScriptedObjectSnapshots: changedScriptedObjects.changedSnapshots,
        changedScriptedObjects: changedScriptedObjects.changedObjects,
      });
    }

    if (changedLights > 0 || changedVehicles > 0 || changedLiveActions.changedActions || changedLiveStatus.changedSnapshots > 0 || changedScriptedObjects.changedSnapshots > 0 || changedScriptedObjects.changedObjects > 0 || nowMs - Number(this.lastWorldRuntimePersistMs || 0) >= WORLD_RUNTIME_PERSIST_INTERVAL_MS) {
      this.lastWorldRuntimePersistMs = nowMs;
      this.persistRuntimeDocument();
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
