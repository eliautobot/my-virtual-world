// File-backed Colyseus room for authoritative live-agent runtime snapshots.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Room } from '@colyseus/core';
import { Encoder, MapSchema, Schema, defineTypes } from '@colyseus/schema';
import {
  configureDynamicInteriorRouting,
  clearDynamicInteriorRoutingForAgent,
  isDynamicInteriorRouteSegmentClear,
  updateDynamicInteriorRouting,
} from '../client/js/dynamic-interior-routing.js';
import {
  configureDynamicExteriorRouting,
  clearDynamicExteriorRoutingForAgent,
  isDynamicExteriorRouteSegmentClear,
  updateDynamicExteriorRouting,
} from '../client/js/dynamic-exterior-routing.js';

export const AGENT_RUNTIME_SCHEMA_VERSION = 'agent-runtime/v1';
export const WORLD_RUNTIME_SCHEMA_VERSION = 'world-runtime/v1';
export const AGENT_RUNTIME_ROOM_NAME = 'agent_runtime';
export const DEFAULT_AGENT_RUNTIME_SCHEMA_BUFFER_SIZE_BYTES = 1024 * 1024;
export const DEFAULT_ROUTE_LEASE_TTL_MS = 15000;
export const MAX_ROUTE_LEASE_TTL_MS = 60000;
export const STALE_ROUTE_LEASE_SWEEP_MS = 1000;
export const DEFAULT_WORLD_RUNTIME_TICK_MS = 100;
export const WORLD_RUNTIME_STEP_MAX_MS = 250;
export const WORLD_RUNTIME_PLAN_POLL_MS = 250;
export const WORLD_RUNTIME_PERSIST_INTERVAL_MS = 5000;
export const WORLD_RUNTIME_TRAFFIC_CYCLE_MS = 40000;
export const WORLD_RUNTIME_TRAFFIC_YELLOW_MS = 3000;
export const WORLD_RUNTIME_TRAFFIC_ALL_RED_MS = 2000;
export const WORLD_RUNTIME_TOPOLOGY_OWNER_TTL_MS = 30000;
export const WORLD_RUNTIME_TOPOLOGY_REFRESH_MS = 10000;
export const RUNTIME_STATE_BROADCAST_INTERVAL_MS = 1000;
export const RUNTIME_HEALTH_BROADCAST_INTERVAL_MS = 2000;
export const MAX_WORLD_RUNTIME_TRAFFIC_LIGHTS = 500;
export const MAX_WORLD_RUNTIME_TRAFFIC_VEHICLES = 80;
export const MAX_RUNTIME_EVENTS = 500;
export const MAX_VISUAL_STATE_JSON_CHARS = 6000;
export const RUNTIME_WIRE_EVENTS_LIMIT = 0;
export const RUNTIME_SCHEMA_PATCH_RATE_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
const SERVER_RUNTIME_ROUTE_POINTS_SUMMARY_LIMIT = 18;
const SERVER_RUNTIME_RAW_POINTS_SUMMARY_LIMIT = 18;
const SERVER_RUNTIME_RAW_CELLS_SUMMARY_LIMIT = 18;
export const MAX_WORLD_OBJECT_DATA_JSON_CHARS = 10000;
export const LIVE_ACTION_RUNTIME_OWNER = 'server-live-action-runtime';
export const LIVE_ACTION_RUNTIME_LEASE_OWNER = 'server-runtime';
export const LIVE_ACTION_RUNTIME_POLL_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
export const LIVE_ACTION_RUNTIME_PLAN_POLL_MS = WORLD_RUNTIME_PLAN_POLL_MS;
export const LIVE_ACTION_RUNTIME_SPEED_UNITS_PER_SEC = 72;
export const LIVE_ACTION_RUNTIME_ARRIVAL_RADIUS = 3;
// A moving resident is an interaction target, not a furniture docking point.
// Two tiles is close enough for an embodied conversation while still requiring
// the agents to share a floor/place and have an unobstructed segment.
export const LIVE_ACTION_RUNTIME_AGENT_INTERACTION_RADIUS = 2 * 40;
export const LIVE_ACTION_RUNTIME_DWELL_MS = 20000;
export const LIVE_ACTION_RUNTIME_COMPLETION_VISIBLE_MS = 12000;
export const LIVE_ACTION_RUNTIME_LEASE_TTL_MS = 10000;
export const LIVE_STATUS_RUNTIME_OWNER = 'server-live-status-runtime';
export const LIVE_STATUS_RUNTIME_LEASE_OWNER = 'server-live-status';
export const LIVE_STATUS_RUNTIME_POLL_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
export const LIVE_STATUS_RUNTIME_PLAN_POLL_MS = WORLD_RUNTIME_PLAN_POLL_MS;
export const LIVE_STATUS_RUNTIME_SPEED_UNITS_PER_SEC = 70;
export const LIVE_STATUS_RUNTIME_RUN_SPEED_UNITS_PER_SEC = 200;
export const LIVE_STATUS_RUNTIME_ARRIVAL_RADIUS = 6;
export const LIVE_STATUS_RUNTIME_LEASE_TTL_MS = 15000;
export const LIVE_STATUS_RUNTIME_LEASE_REFRESH_MS = 8000;
export const USER_DIRECTED_RUNTIME_LEASE_OWNER = 'user-directed';
export const USER_DIRECTED_RUNTIME_HOLD_MS = 60000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER = 'server-scripted-object-runtime';
export const SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER = 'server-scripted-object';
export const SERVER_SCRIPTED_OBJECT_RUNTIME_POLL_MS = DEFAULT_WORLD_RUNTIME_TICK_MS;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_PLAN_POLL_MS = WORLD_RUNTIME_PLAN_POLL_MS;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_SPEED_UNITS_PER_SEC = 72;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_RUN_SPEED_UNITS_PER_SEC = 200;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS = 5;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS = 15000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_REFRESH_MS = 8000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS = 7000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_COOLDOWN_MS = 12000;
// Mirrors the browser-owned route stale timeout: abort routings stuck longer than this.
export const SERVER_RUNTIME_ROUTE_STALE_AFTER_MS = 45000;
export const SERVER_RUNTIME_ROUTE_PROGRESS_EPSILON = 1;
export const SERVER_SCRIPTED_OBJECT_DESK_CONSUME_MS = 16000;
export const SERVER_SCRIPTED_OBJECT_TEMPORARY_ITEM_CARRIED_TTL_MS = 90000;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_ACTIVE_ROUTES = 8;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_ROUTE_STEPS_PER_TICK = 12;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_STARTS_PER_TICK = 3;
export const SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_IDLE_CHECKS_PER_TICK = 6;
export const SERVER_PINGPONG_RUNTIME_OWNER = 'server-pingpong-runtime';
export const SERVER_PINGPONG_RUNTIME_LEASE_OWNER = 'server-pingpong-match';
export const SERVER_PINGPONG_RUNTIME_SPEED_UNITS_PER_SEC = 72;
export const SERVER_PINGPONG_RUNTIME_ARRIVAL_RADIUS = 5;
export const SERVER_PINGPONG_RUNTIME_LEASE_TTL_MS = 15000;
export const SERVER_PINGPONG_RUNTIME_LEASE_REFRESH_MS = 8000;
export const SERVER_PINGPONG_RUNTIME_MATCH_MS = 24000;
export const SERVER_PINGPONG_RUNTIME_RESULT_MS = 150;
export const SERVER_PINGPONG_RUNTIME_COOLDOWN_MS = 45000;
export const SERVER_PINGPONG_RUNTIME_TABLE_COOLDOWN_MS = 15000;
export const SERVER_PINGPONG_RUNTIME_TARGET_SCORE = 5;
export const SERVER_PINGPONG_RUNTIME_MAX_ACTIVE_MATCHES = 2;
export const SERVER_PINGPONG_RUNTIME_TABLE_POLL_MS = 5000;
export const SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS = Object.freeze([8000, 20000]);
// M3.1 proximity conversations (8590 SCRIPTED_PROXIMITY_BEHAVIOR_RULES parity)
export const SERVER_SOCIAL_RUNTIME_OWNER = 'server-social-runtime';
export const SERVER_SOCIAL_RUNTIME_LEASE_OWNER = 'server-social';
export const SERVER_SOCIAL_CONVERSATION_RADIUS_API = 5 * 40; // 5 tiles
export const SERVER_SOCIAL_CONVERSATION_CHANCE = 0.22;
export const SERVER_SOCIAL_CONVERSATION_COOLDOWN_MS = 45000;
export const SERVER_SOCIAL_CONVERSATION_DURATION_MS = Object.freeze([7000, 14000]);
export const SERVER_SOCIAL_ROLE_SWITCH_MS = Object.freeze([3000, 5000]);
export const SERVER_SOCIAL_POST_COOLDOWN_MS = Object.freeze([20000, 40000]);
export const SERVER_SOCIAL_MAX_PARTICIPANTS = 4;
export const SERVER_SOCIAL_MAX_EVALS_PER_TICK = 6;
export const SERVER_SOCIAL_LEASE_TTL_MS = 20000;
export const SERVER_SCRIPTED_IDLE_RETRY_DELAY_MS = Object.freeze([3000, 8000]);
export const SERVER_SCRIPTED_IDLE_OBJECT_COOLDOWN_MS = 240000;
export const SERVER_SCRIPTED_IDLE_CATEGORY_COOLDOWN_MS = 180000;
export const SERVER_SCRIPTED_IDLE_FAILED_TARGET_THROTTLE_MS = 90000;
export const LIVE_ACTION_API_TILE = 40;
const SERVER_RUNTIME_ELEVATOR_SIZE_TILES = 2.8;
const SERVER_RUNTIME_ELEVATOR_QUEUE_SPACING_TILES = 0.72;
const SERVER_RUNTIME_ELEVATOR_SLOT_OFFSETS = Object.freeze([
  Object.freeze({ x: -0.42, z: 0 }),
  Object.freeze({ x: 0.42, z: 0 }),
]);
export const SERVER_RUNTIME_AGENT_AVOID_RADIUS = LIVE_ACTION_API_TILE * 1.5;
export const SERVER_RUNTIME_AGENT_SEPARATION_RADIUS = LIVE_ACTION_API_TILE * 0.75;
export const SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS = LIVE_ACTION_API_TILE * 0.615;
export const SERVER_RUNTIME_AGENT_AVOID_FORCE_MULTIPLIER = 0.6;
export const SERVER_RUNTIME_AGENT_AVOID_PUSH_PER_TICK = 6;
export const SERVER_RUNTIME_AGENT_SEPARATION_PUSH_PER_TICK = 6;
export const SERVER_RUNTIME_BLOCKER_YIELD_COOLDOWN_MS = 1500;
export const SERVER_RUNTIME_BLOCKER_YIELD_DISTANCE = LIVE_ACTION_API_TILE * 0.9;
export const SERVER_RUNTIME_DYNAMIC_AVOID_MAX_ZONES = 8;
export const SERVER_RUNTIME_DYNAMIC_AVOID_RADIUS_WORLD = 0.7875;
export const SERVER_RUNTIME_DYNAMIC_AVOID_HARD_RADIUS_WORLD = 0.39;
export const SERVER_RUNTIME_DYNAMIC_AVOID_COST = 9;
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
const SERVER_WORLD_OBJECT_RUNTIME_OWNERS = new Set([SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER, LIVE_STATUS_RUNTIME_OWNER, SERVER_PINGPONG_RUNTIME_OWNER]);
const SERVER_MANAGED_ROUTE_LEASE_OWNERS = new Set([
  LIVE_ACTION_RUNTIME_LEASE_OWNER,
  LIVE_STATUS_RUNTIME_LEASE_OWNER,
  SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER,
  SERVER_PINGPONG_RUNTIME_LEASE_OWNER,
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
    this.tickSeq = 0;
    this.simTimeMs = 0;
    this.tickMs = DEFAULT_WORLD_RUNTIME_TICK_MS;
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
  tickSeq: 'number',
  simTimeMs: 'number',
  tickMs: 'number',
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

// Hot-path document caches: revalidated by file mtime with a short time-based
// window (same pattern as _buildingDocsCache; keeps the event loop off sync
// disk I/O during per-tick planning).
const _hotDocumentCache = new Map();
const HOT_DOCUMENT_CACHE_REVALIDATE_MS = 250;

function readCachedJsonDocument(path, fallbackFactory) {
  const now = Date.now();
  const cached = _hotDocumentCache.get(path);
  if (cached && now - cached.checkedAt < HOT_DOCUMENT_CACHE_REVALIDATE_MS) return cached.value;
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    mtimeMs = -1;
  }
  if (cached && cached.mtimeMs === mtimeMs) {
    cached.checkedAt = now;
    return cached.value;
  }
  const raw = mtimeMs >= 0 ? readJsonFile(path, null) : null;
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : fallbackFactory();
  _hotDocumentCache.set(path, { mtimeMs, checkedAt: now, value });
  return value;
}

function invalidateCachedJsonDocument(path) {
  _hotDocumentCache.delete(path);
}

function readWorldMetaDocument(dataDir, { fresh = false } = {}) {
  if (fresh) {
    const path = worldMetaFilePath(dataDir);
    invalidateCachedJsonDocument(path);
    const raw = readJsonFile(path, null);
    const value = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    let mtimeMs = -1;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      mtimeMs = -1;
    }
    _hotDocumentCache.set(path, { mtimeMs, checkedAt: Date.now(), value });
    return value;
  }
  return readCachedJsonDocument(worldMetaFilePath(dataDir), () => ({}));
}

function readPresenceSnapshotDocument(dataDir) {
  return readCachedJsonDocument(presenceSnapshotFilePath(dataDir), () => ({}));
}

function writeWorldMetaDocument(dataDir, meta) {
  invalidateCachedJsonDocument(worldMetaFilePath(dataDir));
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

function readWorldActionsStore(dataDir, { fresh = false } = {}) {
  const meta = readWorldMetaDocument(dataDir, { fresh });
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
  if (reason && (!nextResult.reason || WORLD_ACTION_TERMINAL_STATUSES.has(nextStatus))) nextResult.reason = reason;
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

export function observeServerRuntimeRouteProgress(watchdog, actionId, {
  routeId = '',
  nowMs = Date.now(),
  x = 0,
  y = 0,
  distanceToFinal = Number.POSITIVE_INFINITY,
  arrived = false,
  staleAfterMs = SERVER_RUNTIME_ROUTE_STALE_AFTER_MS,
  progressEpsilon = SERVER_RUNTIME_ROUTE_PROGRESS_EPSILON,
} = {}) {
  if (!(watchdog instanceof Map) || !actionId) return { stale: false, progressed: false, initialized: false };
  if (arrived) {
    watchdog.delete(actionId);
    return { stale: false, progressed: true, initialized: false };
  }

  const observedAtMs = Number(nowMs);
  const observedX = Number(x);
  const observedY = Number(y);
  const observedDistance = Number(distanceToFinal);
  const previous = watchdog.get(actionId);
  if (!previous || previous.routeId !== routeId || !Number.isFinite(Number(previous.lastProgressAtMs))) {
    const initialized = {
      routeId,
      lastProgressAtMs: observedAtMs,
      progressX: observedX,
      progressY: observedY,
      bestDistance: observedDistance,
    };
    watchdog.set(actionId, initialized);
    return { stale: false, progressed: false, initialized: true, watch: initialized };
  }

  const displacement = Math.hypot(
    observedX - Number(previous.progressX),
    observedY - Number(previous.progressY),
  );
  const distanceImprovement = Number(previous.bestDistance) - observedDistance;
  const progressed = displacement >= progressEpsilon || distanceImprovement >= progressEpsilon;
  const next = {
    ...previous,
    routeId,
    bestDistance: Number.isFinite(observedDistance)
      ? Math.min(Number(previous.bestDistance), observedDistance)
      : Number(previous.bestDistance),
  };
  if (progressed) {
    next.lastProgressAtMs = observedAtMs;
    next.progressX = observedX;
    next.progressY = observedY;
  }
  watchdog.set(actionId, next);
  return {
    stale: !progressed && observedAtMs - Number(next.lastProgressAtMs) >= staleAfterMs,
    progressed,
    initialized: false,
    displacement,
    distanceImprovement,
    watch: next,
  };
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

export function buildingContainsApiPoint(building, apiX, apiY) {
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

function serverRuntimeBuildingFloorCount(building = null) {
  if (!building || building.type === 'park') return 1;
  return Math.max(1, Math.floor(numberOr(
    building.floorCount ?? building.floors?.length ?? building.interior?.floors,
    1,
  )));
}

function clampServerRuntimeFloorForBuilding(building = null, floor = 1) {
  return Math.max(1, Math.min(serverRuntimeBuildingFloorCount(building), floorOr(floor, 1)));
}

function serverRuntimeItemFloor(item = null) {
  return Math.max(1, floorOr(item?.floor ?? item?.buildingFloor, 1));
}

function serverRuntimeNormalizeElevator(building = null) {
  if (!building || building.type === 'park' || serverRuntimeBuildingFloorCount(building) <= 1) return null;
  const width = Math.max(1, numberOr(building.widthTiles, 25));
  const depth = Math.max(1, numberOr(building.heightTiles, 17));
  const raw = building.elevator && typeof building.elevator === 'object' && !Array.isArray(building.elevator)
    ? building.elevator
    : {};
  const elevatorWidth = Math.max(1.2, numberOr(raw.width, SERVER_RUNTIME_ELEVATOR_SIZE_TILES));
  const elevatorDepth = Math.max(1.2, numberOr(raw.depth, SERVER_RUNTIME_ELEVATOR_SIZE_TILES));
  const minX = elevatorWidth / 2 + 0.25;
  const maxX = Math.max(minX, width - elevatorWidth / 2 - 0.25);
  const minZ = elevatorDepth / 2 + 0.25;
  const maxZ = Math.max(minZ, depth - elevatorDepth / 2 - 0.25);
  return {
    x: Math.max(minX, Math.min(maxX, numberOr(raw.x, width * 0.18))),
    z: Math.max(minZ, Math.min(maxZ, numberOr(raw.z, depth * 0.35))),
    width: elevatorWidth,
    depth: elevatorDepth,
  };
}

function serverRuntimeFloorScopedBuilding(building = null, floor = 1) {
  if (!building || building.type === 'park') return building;
  const routingFloor = clampServerRuntimeFloorForBuilding(building, floor);
  const interior = building.interior && typeof building.interior === 'object' && !Array.isArray(building.interior)
    ? building.interior
    : {};
  return {
    ...building,
    _routingFloor: routingFloor,
    elevator: serverRuntimeNormalizeElevator(building),
    interior: {
      ...interior,
      walls: Array.isArray(interior.walls)
        ? interior.walls.filter(wall => serverRuntimeItemFloor(wall) === routingFloor)
        : [],
      furniture: Array.isArray(interior.furniture)
        ? interior.furniture.filter(item => serverRuntimeItemFloor(item) === routingFloor)
        : [],
    },
  };
}

function serverRuntimeElevatorApiPoint(building = null, slotIndex = null) {
  const elevator = serverRuntimeNormalizeElevator(building);
  if (!elevator) return null;
  const index = Number.isInteger(slotIndex)
    ? Math.max(0, Math.min(SERVER_RUNTIME_ELEVATOR_SLOT_OFFSETS.length - 1, slotIndex))
    : null;
  const slot = index == null ? null : SERVER_RUNTIME_ELEVATOR_SLOT_OFFSETS[index];
  const point = apiPointFromBuildingLocal(building, elevator.x + numberOr(slot?.x, 0), elevator.z + numberOr(slot?.z, 0));
  return point ? { ...point, elevatorSlotIndex: index } : null;
}

function serverRuntimeElevatorQueueApiPoint(building = null, queueIndex = 0) {
  const elevator = serverRuntimeNormalizeElevator(building);
  if (!elevator) return null;
  const width = Math.max(1, numberOr(building.widthTiles, 25));
  const depth = Math.max(1, numberOr(building.heightTiles, 17));
  const index = Math.max(0, Math.floor(numberOr(queueIndex, 0)));
  const localX = Math.max(0.55, Math.min(width - 0.55, elevator.x));
  const localZ = Math.max(
    0.55,
    Math.min(depth - 0.55, elevator.z + elevator.depth / 2 + 0.95 + index * SERVER_RUNTIME_ELEVATOR_QUEUE_SPACING_TILES),
  );
  const point = apiPointFromBuildingLocal(building, localX, localZ);
  return point ? { ...point, elevatorQueueIndex: index } : null;
}

function serverRuntimeElevatorExitApiPoint(building = null) {
  const elevator = serverRuntimeNormalizeElevator(building);
  if (!elevator) return null;
  const width = Math.max(1, numberOr(building.widthTiles, 25));
  const depth = Math.max(1, numberOr(building.heightTiles, 17));
  const localX = Math.max(0.55, Math.min(width - 0.55, elevator.x));
  const localZ = Math.max(0.55, Math.min(depth - 0.55, elevator.z + elevator.depth / 2 + 0.75));
  return apiPointFromBuildingLocal(building, localX, localZ);
}

function serverRuntimePointBuilding(dataDir, point = null) {
  const building = findInteriorBuildingAtApi(dataDir, point?.x, point?.y);
  if (!building || building.type === 'park') return null;
  return readBuildingDocument(dataDir, building.id) || building;
}

function serverRuntimeLocationAtPoint(dataDir, x, y, target = null, {
  arrived = false,
  fallbackFloor = 1,
} = {}) {
  const targetBuildingId = safeText(target?.buildingId, '');
  if (arrived && targetBuildingId) {
    const targetBuilding = readBuildingDocument(dataDir, targetBuildingId);
    if (!targetBuilding || targetBuilding.type !== 'park') {
      return {
        floor: floorOr(target?.floor, fallbackFloor),
        buildingId: targetBuildingId,
        roomId: safeText(target?.roomId, ''),
      };
    }
  }
  const building = serverRuntimePointBuilding(dataDir, { x, y, floor: fallbackFloor });
  if (building) {
    return {
      floor: clampServerRuntimeFloorForBuilding(building, fallbackFloor),
      buildingId: safeText(building.id, ''),
      roomId: targetBuildingId && targetBuildingId === building.id ? safeText(target?.roomId, '') : '',
    };
  }
  return { floor: 1, buildingId: '', roomId: '' };
}

function summarizeServerRuntimeElevatorTrip(trip = null) {
  if (!trip || typeof trip !== 'object' || trip.active === false) return null;
  const buildingId = safeText(trip.buildingId, '');
  if (!buildingId) return null;
  const out = {
    active: true,
    buildingId,
    fromFloor: Math.max(1, floorOr(trip.fromFloor, 1)),
    toFloor: Math.max(1, floorOr(trip.toFloor, 1)),
    state: safeText(trip.state, 'boarding') || 'boarding',
    finalTarget: cloneRuntimePoint(trip.finalTarget || null),
  };
  if (Number.isInteger(trip.slotIndex)) out.slotIndex = Math.max(0, trip.slotIndex);
  if (Number.isInteger(trip.queueIndex)) out.queueIndex = Math.max(0, trip.queueIndex);
  if (Number.isFinite(Number(trip.queuedAtMs))) out.queuedAtMs = Math.max(0, Math.floor(Number(trip.queuedAtMs)));
  if (Number.isFinite(Number(trip.startedAtMs))) out.startedAtMs = Math.max(0, Math.floor(Number(trip.startedAtMs)));
  return out;
}

function isServerRuntimeAtElevatorBoardingPoint(currentPoint = null, building = null, boardingTarget = null) {
  if (!currentPoint || !serverRuntimeNormalizeElevator(building)) return false;
  const targets = [];
  if (boardingTarget) targets.push(boardingTarget);
  const center = serverRuntimeElevatorApiPoint(building);
  if (center) targets.push(center);
  for (let index = 0; index < SERVER_RUNTIME_ELEVATOR_SLOT_OFFSETS.length; index += 1) {
    const slot = serverRuntimeElevatorApiPoint(building, index);
    if (slot) targets.push(slot);
  }
  const reach = LIVE_ACTION_API_TILE * 0.95;
  return targets.some(target => Math.hypot(
    numberOr(currentPoint.x, 0) - numberOr(target.x, 0),
    numberOr(currentPoint.y, 0) - numberOr(target.y, 0),
  ) <= reach);
}

function serverRuntimeElevatorAccessPlan(agentId, building, fromFloor, toFloor, finalTarget = null, crowdAgents = [], previousTrip = null) {
  const elevator = serverRuntimeNormalizeElevator(building);
  const buildingId = safeText(building?.id, '');
  if (!buildingId || !elevator) {
    return { mode: 'none', target: serverRuntimeElevatorApiPoint(building), slotIndex: null, queueIndex: null };
  }
  const currentTrip = previousTrip?.buildingId === buildingId &&
    floorOr(previousTrip.fromFloor, fromFloor) === fromFloor &&
    floorOr(previousTrip.toFloor, toFloor) === toFloor &&
    previousTrip.state !== 'arrived'
      ? previousTrip
      : null;
  const occupiedSlots = new Set();
  const queue = [];
  const matchesTrip = (trip = null) => trip &&
    trip.active !== false &&
    trip.buildingId === buildingId &&
    floorOr(trip.fromFloor, fromFloor) === fromFloor &&
    floorOr(trip.toFloor, toFloor) === toFloor;
  for (const other of crowdAgents || []) {
    if (!other || String(other.agentId || '') === String(agentId || '')) continue;
    const trip = summarizeServerRuntimeElevatorTrip(other.elevatorTrip || null);
    if (!matchesTrip(trip)) continue;
    if (trip.state === 'arrived') continue;
    if (Number.isInteger(trip.slotIndex)) occupiedSlots.add(trip.slotIndex);
    else queue.push({
      agentId: safeText(other.agentId, '') || String(other.agentId || ''),
      queuedAtMs: Number(trip.queuedAtMs || trip.startedAtMs || 0) || 0,
    });
  }
  if (currentTrip && Number.isInteger(currentTrip.slotIndex) && !occupiedSlots.has(currentTrip.slotIndex)) {
    return { mode: 'board', target: serverRuntimeElevatorApiPoint(building, currentTrip.slotIndex), slotIndex: currentTrip.slotIndex, queueIndex: null };
  }
  const openSlots = SERVER_RUNTIME_ELEVATOR_SLOT_OFFSETS
    .map((_, index) => index)
    .filter(index => !occupiedSlots.has(index));
  const queuedAtMs = Number(currentTrip?.queuedAtMs || Date.now()) || Date.now();
  if (currentTrip && !Number.isInteger(currentTrip.slotIndex)) {
    queue.push({ agentId: safeText(agentId, '') || String(agentId || ''), queuedAtMs });
  }
  queue.sort((a, b) => a.queuedAtMs - b.queuedAtMs || String(a.agentId).localeCompare(String(b.agentId)));
  let queueRank = queue.findIndex(entry => String(entry.agentId) === String(agentId || ''));
  if (openSlots.length && (!currentTrip || queueRank < 0 || queueRank < openSlots.length)) {
    const slotIndex = openSlots[Math.max(0, queueRank < 0 ? 0 : queueRank)];
    return {
      mode: 'board',
      target: serverRuntimeElevatorApiPoint(building, slotIndex),
      slotIndex,
      queueIndex: null,
      queuedAtMs,
    };
  }
  if (queueRank < 0) {
    queue.push({ agentId: safeText(agentId, '') || String(agentId || ''), queuedAtMs });
    queue.sort((a, b) => a.queuedAtMs - b.queuedAtMs || String(a.agentId).localeCompare(String(b.agentId)));
    queueRank = queue.findIndex(entry => String(entry.agentId) === String(agentId || ''));
  }
  const queueIndex = Math.max(0, queueRank - openSlots.length);
  return {
    mode: 'queue',
    target: serverRuntimeElevatorQueueApiPoint(building, queueIndex),
    slotIndex: null,
    queueIndex,
    queuedAtMs,
  };
}

function getBuildingDoorSpec(building) {
  const width = Number(building?.widthTiles || 10) || 10;
  const height = Number(building?.heightTiles || 8) || 8;
  const wallThickness = 0.25;
  const openingWidth = 2.4;
  const fallback = {
    localCenterX: Math.max(1, Math.min(width - 1, width / 2)),
    localThresholdZ: height + wallThickness / 2 + 0.01,
    localOutsideZ: height + 0.2,
    localInteriorZ: Math.max(0.45, height - 1.2),
    localDoorwayZ: Math.max(0.45, height - Math.max(0.45, wallThickness * 1.2)),
    doorwayReachWorld: Math.min(0.65, Math.max(0.4, openingWidth * 0.22)),
  };
  const spec = building?.doorSpec && typeof building.doorSpec === 'object' && !Array.isArray(building.doorSpec)
    ? building.doorSpec
    : {};
  const clampNum = (value, min, max, fb) => Number.isFinite(Number(value))
    ? Math.min(max, Math.max(min, Number(value)))
    : fb;
  const normalized = {
    localCenterX: clampNum(spec.localCenterX, 0, width, fallback.localCenterX),
    localThresholdZ: clampNum(spec.localThresholdZ, height, height + 1.5, fallback.localThresholdZ),
    localOutsideZ: clampNum(spec.localOutsideZ, height - 0.2, height + 1.5, fallback.localOutsideZ),
    localInteriorZ: clampNum(spec.localInteriorZ, 0.2, height - 0.2, fallback.localInteriorZ),
    localDoorwayZ: clampNum(spec.localDoorwayZ, 0.25, height - 0.05, fallback.localDoorwayZ),
    doorwayReachWorld: clampNum(spec.doorwayReachWorld, 0.25, 0.9, fallback.doorwayReachWorld),
  };
  const doorDepth = normalized.localOutsideZ - normalized.localInteriorZ;
  const doorwayDepth = normalized.localOutsideZ - normalized.localDoorwayZ;
  if (
    normalized.localOutsideZ >= height - 0.25 &&
    (doorDepth > 3 || doorwayDepth > 2.5 || normalized.localInteriorZ > normalized.localDoorwayZ)
  ) {
    normalized.localCenterX = fallback.localCenterX;
    normalized.localThresholdZ = fallback.localThresholdZ;
    normalized.localOutsideZ = fallback.localOutsideZ;
    normalized.localInteriorZ = fallback.localInteriorZ;
    normalized.localDoorwayZ = fallback.localDoorwayZ;
    normalized.doorwayReachWorld = fallback.doorwayReachWorld;
  }
  return normalized;
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
  return buildingInteriorEntryPointApi(building) || buildingDoorwayPointApi(building) || buildingOutsideDoorPointApi(building);
}

function readBuildingDocument(dataDir, buildingId) {
  if (!buildingId) return null;
  const building = readCachedJsonDocument(buildingFilePath(dataDir, buildingId), () => null);
  return building && typeof building === 'object' && !Array.isArray(building) ? building : null;
}

const _buildingDocsCache = new Map();
const BUILDING_DOCS_CACHE_REVALIDATE_MS = 250;

function listBuildingDocuments(dataDir) {
  const dir = buildingsDirPath(dataDir);
  if (!existsSync(dir)) return [];
  const now = Date.now();
  const cached = _buildingDocsCache.get(dir);
  if (cached && now - cached.checkedAt < BUILDING_DOCS_CACHE_REVALIDATE_MS) return cached.docs;
  let dirMtimeMs = 0;
  let latestFileMtimeMs = 0;
  let fileNames = [];
  try {
    dirMtimeMs = statSync(dir).mtimeMs;
    fileNames = readdirSync(dir).filter(name => name.endsWith('.json'));
    for (const name of fileNames) {
      try {
        const mtimeMs = statSync(join(dir, name)).mtimeMs;
        if (mtimeMs > latestFileMtimeMs) latestFileMtimeMs = mtimeMs;
      } catch {
        // Ignore transient stat failures (e.g. atomic rename races); content check below still applies.
      }
    }
  } catch {
    return [];
  }
  if (
    cached &&
    cached.dirMtimeMs === dirMtimeMs &&
    cached.latestFileMtimeMs === latestFileMtimeMs &&
    cached.fileCount === fileNames.length
  ) {
    cached.checkedAt = now;
    return cached.docs;
  }
  const docs = fileNames
    .map(name => readJsonFile(join(dir, name), null))
    .filter(building => building && typeof building === 'object' && !Array.isArray(building));
  _buildingDocsCache.set(dir, {
    dirMtimeMs,
    latestFileMtimeMs,
    fileCount: fileNames.length,
    checkedAt: now,
    docs,
  });
  return docs;
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

function resolvedObjectTargetPoseKind(target = {}, location = null, local = null) {
  const explicit = safeText(location?.poseKind || location?.pose?.poseKind || local?.poseKind || target?.poseKind, '');
  if (explicit) return explicit;
  const roles = Array.isArray(location?.roles) ? location.roles.map(role => String(role || '').trim().toLowerCase()) : [];
  const spotId = String(target?.interactionSpotId || target?.spotId || location?.id || location?.spotId || '').trim().toLowerCase();
  const actionId = String(target?.actionId || target?.actionType || location?.actionId || location?.action || '').trim().toLowerCase();
  if (roles.includes('seat') || /(^|[-_.])sit(?:at|$|[-_.])/.test(actionId) || /(^|[-_.])(seat|sit)($|[-_.])/.test(spotId)) return 'seat';
  return '';
}

export function resolveObjectTargetPoint(dataDir, target = {}) {
  const buildingId = safeText(target.buildingId, '');
  const buildings = buildingId ? [readBuildingDocument(dataDir, buildingId)].filter(Boolean) : listBuildingDocuments(dataDir);
  const wantedId = String(target.objectInstanceId || target.id || '').trim();
  const wantedCatalog = String(target.catalogId || target.objectCatalogId || '').trim().toLowerCase();
  const spotId = String(target.interactionSpotId || target.spotId || '').trim();
  for (const building of buildings) {
    const furniture = Array.isArray(building?.interior?.furniture) ? building.interior.furniture : [];
    const outdoorNodes = Array.isArray(building?.outdoorArea?.nodes) ? building.outdoorArea.nodes : [];
    // Interior furniture and outdoor-area nodes are both valid object-instance
    // targets (e.g. gazebo pavilions, park benches live in outdoorArea.nodes).
    const objects = [...furniture, ...outdoorNodes];
    for (let index = 0; index < objects.length; index += 1) {
      const object = objects[index];
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
          objectType: catalog || wantedCatalog,
          catalogId: object.catalogId || object.type || target.catalogId || '',
          interactionSpotId: spotId || location?.id || '',
          actionId: safeText(target.actionId || location?.actionId, ''),
          poseKind: resolvedObjectTargetPoseKind(target, location, local),
          animationId: safeText(location?.animationId || location?.poseAnimationId || location?.pose?.animationId, ''),
          activityKind: safeText(location?.activityKind || location?.kind, ''),
          faceAngle: runtimeFurnitureActionFaceAngle(building, object, local),
        };
      }
      if (worldPoint) {
        return {
          ...worldPoint,
          floor: floorOr(location.floor ?? object.floor ?? target.floor, 1),
          buildingId: building.id || '',
          roomId: safeText(target.roomId || object.room, ''),
          objectInstanceId: Array.from(ids)[0] || wantedId,
          objectType: catalog || wantedCatalog,
          catalogId: object.catalogId || object.type || target.catalogId || '',
          interactionSpotId: spotId || location?.id || '',
          actionId: safeText(target.actionId || location?.actionId, ''),
          poseKind: resolvedObjectTargetPoseKind(target, location, local),
          animationId: safeText(location?.animationId || location?.poseAnimationId || location?.pose?.animationId, ''),
          activityKind: safeText(location?.activityKind || location?.kind, ''),
          faceAngle: runtimeFurnitureActionFaceAngle(building, object, local),
        };
      }
      if (localPoint) {
        return {
          ...localPoint,
          floor: floorOr(local?.floor ?? object.floor ?? target.floor, 1),
          buildingId: building.id || '',
          roomId: safeText(target.roomId || object.room, ''),
          objectInstanceId: Array.from(ids)[0] || wantedId,
          objectType: catalog || wantedCatalog,
          catalogId: object.catalogId || object.type || target.catalogId || '',
          interactionSpotId: spotId || location?.id || '',
          actionId: safeText(target.actionId || location?.actionId, ''),
          poseKind: resolvedObjectTargetPoseKind(target, location, local),
          animationId: safeText(location?.animationId || location?.poseAnimationId || location?.pose?.animationId, ''),
          activityKind: safeText(location?.activityKind || location?.kind, ''),
          faceAngle: runtimeFurnitureActionFaceAngle(building, object, local),
        };
      }
    }
  }
  return null;
}

function resolveConstructionSiteRoutePoint(dataDir, action, target = {}, fallbackPoint = null) {
  if (String(action?.actionType || action?.actionId || '') !== 'world.buildStructure') return null;
  const site = action?.params?.buildSite || target?.buildSite || action?.route?.target?.buildSite || null;
  if (!site || typeof site !== 'object' || Array.isArray(site)) return null;
  const kind = String(target?.kind || target?.targetKind || '').trim();
  if (kind && kind !== 'world-point') return null;

  const streetApproach = site.streetApproach && typeof site.streetApproach === 'object'
    ? site.streetApproach
    : (target?.streetApproach && typeof target.streetApproach === 'object' ? target.streetApproach : null);
  const approachTile = streetApproach?.approachTile && typeof streetApproach.approachTile === 'object'
    ? streetApproach.approachTile
    : null;
  const tileX = Number(approachTile?.x);
  const tileY = Number(approachTile?.y ?? approachTile?.z);
  if (Number.isFinite(tileX) && Number.isFinite(tileY)) {
    return {
      ...(fallbackPoint || {}),
      x: tileX * LIVE_ACTION_API_TILE,
      y: tileY * LIVE_ACTION_API_TILE,
      floor: floorOr(target?.floor ?? fallbackPoint?.floor, 1),
      buildingId: '',
      roomId: '',
      targetKind: 'world-point',
      routeKind: 'construction-site-build',
      constructionApproachSource: safeText(streetApproach?.source, 'street-approach') || 'street-approach',
      constructionSiteId: safeText(site.buildingId, ''),
      buildSite: cloneJson(site, site),
      constructionFinalTarget: fallbackPoint ? cloneRuntimePoint(fallbackPoint) : null,
    };
  }

  const rawX = Number(fallbackPoint?.x ?? target?.x);
  const rawY = Number(fallbackPoint?.y ?? target?.y ?? target?.z);
  const fallbackTileX = Number.isFinite(rawX)
    ? Math.round(rawX / LIVE_ACTION_API_TILE)
    : Math.round(numberOr(site.worldX, 0) + Math.max(1, numberOr(site.widthTiles, 10)) / 2);
  const fallbackTileY = Number.isFinite(rawY)
    ? Math.round(rawY / LIVE_ACTION_API_TILE)
    : Math.round(numberOr(site.worldY, 0) + Math.max(1, numberOr(site.heightTiles, 8)) + 2);
  const sidewalk = findNearestServerSidewalk(dataDir, fallbackTileX, fallbackTileY, 96);
  if (!sidewalk) return null;
  return {
    ...(fallbackPoint || {}),
    x: sidewalk.x * LIVE_ACTION_API_TILE,
    y: sidewalk.z * LIVE_ACTION_API_TILE,
    floor: floorOr(target?.floor ?? fallbackPoint?.floor, 1),
    buildingId: '',
    roomId: '',
    targetKind: 'world-point',
    routeKind: 'construction-site-build',
    constructionApproachSource: 'nearest-sidewalk-construction-route',
    constructionSiteId: safeText(site.buildingId, ''),
    buildSite: cloneJson(site, site),
    constructionFinalTarget: fallbackPoint ? cloneRuntimePoint(fallbackPoint) : null,
  };
}

export function resolveActionTargetPoint(dataDir, action, state) {
  const routeTarget = action?.route?.target && typeof action.route.target === 'object' ? action.route.target : null;
  const target = routeTarget || (action?.target && typeof action.target === 'object' ? action.target : null);
  if (!target) return null;
  const x = numberOr(target.x, NaN);
  const y = numberOr(target.y ?? target.z, NaN);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    const basePoint = {
      x,
      y,
      floor: floorOr(target.floor, 1),
      buildingId: safeText(target.buildingId, ''),
      roomId: safeText(target.roomId, ''),
      targetKind: safeText(target.kind || target.targetKind, 'world-point'),
    };
    return resolveConstructionSiteRoutePoint(dataDir, action, target, basePoint) || basePoint;
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
      floor: floorOr(agent.floor ?? target.floor, 1),
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
  for (const key of ['objectType', 'catalogId', 'poseKind', 'animationId', 'activityKind']) {
    if (point?.[key]) target[key] = safeText(point[key], '');
  }
  if (Number.isFinite(Number(point?.faceAngle))) target.faceAngle = normalizeRuntimeAngleRadians(point.faceAngle, 0);
  return target;
}

function isInsideResolvedBuildingTarget(dataDir, current, targetPoint) {
  const kind = String(targetPoint?.targetKind || '').toLowerCase();
  if (!['building', 'room', 'agent-home-building'].includes(kind)) return false;
  const buildingId = safeText(targetPoint?.buildingId, '');
  if (!buildingId) return false;
  if (floorOr(current?.floor, 1) !== floorOr(targetPoint?.floor, 1)) return false;
  if (targetPoint?.roomId && safeText(current?.roomId, '') !== safeText(targetPoint.roomId, '')) return false;
  const building = readBuildingDocument(dataDir, buildingId);
  if (!building || building.type === 'park') return false;
  return buildingContainsApiPoint(building, Number(current?.x), Number(current?.y));
}

export function isLiveActionAgentTargetWithinInteractionRange(current, targetPoint, radius = LIVE_ACTION_RUNTIME_AGENT_INTERACTION_RADIUS) {
  if (safeText(targetPoint?.targetKind, '').toLowerCase() !== 'agent') return false;
  if (!safeText(targetPoint?.targetAgentId, '')) return false;
  if (![current?.x, current?.y, targetPoint?.x, targetPoint?.y].every(Number.isFinite)) return false;
  if (floorOr(current?.floor, 1) !== floorOr(targetPoint?.floor, 1)) return false;
  if (safeText(current?.buildingId, '') !== safeText(targetPoint?.buildingId, '')) return false;
  const currentRoomId = safeText(current?.roomId, '');
  const targetRoomId = safeText(targetPoint?.roomId, '');
  if (currentRoomId && targetRoomId && currentRoomId !== targetRoomId) return false;
  return Math.hypot(Number(targetPoint.x) - Number(current.x), Number(targetPoint.y) - Number(current.y))
    <= Math.max(1, numberOr(radius, LIVE_ACTION_RUNTIME_AGENT_INTERACTION_RADIUS));
}

export function makeLiveActionRuntimeMovement(dataDir, agentId, current, targetPoint, tickMs, { crowdAgents = [] } = {}) {
  const alreadyInsideTargetBuilding = isInsideResolvedBuildingTarget(dataDir, current, targetPoint);
  if (alreadyInsideTargetBuilding) {
    return {
      x: Number(current.x),
      y: Number(current.y),
      floor: targetPoint.floor,
      buildingId: targetPoint.buildingId || '',
      roomId: targetPoint.roomId || '',
      heading: normalizeRuntimeAngleRadians(current.heading, 0),
      arrived: true,
      distanceToFinal: 0,
      distanceToSteering: 0,
      steeringTarget: targetPoint,
      finalTarget: targetPoint,
      route: {
        active: false,
        source: 'server-live-action-runtime',
        reason: 'already-inside-target-building',
        finalPoint: targetPoint,
        routeSource: 'server-live-action-runtime',
        phase: 'building-presence-arrival',
      },
      phase: 'building-presence-arrival',
    };
  }

  const agentTargetInRange = isLiveActionAgentTargetWithinInteractionRange(current, targetPoint)
    && validateServerRuntimeStaticSegment(dataDir, current, targetPoint, {
      phase: 'agent-interaction-arrival',
      route: null,
    }).clear;
  if (agentTargetInRange) {
    const distanceToFinal = Math.hypot(Number(targetPoint.x) - Number(current.x), Number(targetPoint.y) - Number(current.y));
    return {
      x: Number(current.x),
      y: Number(current.y),
      floor: floorOr(current.floor, targetPoint.floor),
      buildingId: safeText(current.buildingId, ''),
      roomId: safeText(current.roomId, ''),
      heading: Math.atan2(Number(targetPoint.x) - Number(current.x), Number(targetPoint.y) - Number(current.y)),
      arrived: true,
      distanceToFinal,
      distanceToSteering: distanceToFinal,
      steeringTarget: targetPoint,
      finalTarget: targetPoint,
      route: {
        active: false,
        source: 'server-live-action-runtime',
        reason: 'agent-within-interaction-range',
        finalPoint: targetPoint,
        routeSource: 'server-live-action-runtime',
        phase: 'agent-interaction-arrival',
        interactionRadius: LIVE_ACTION_RUNTIME_AGENT_INTERACTION_RADIUS,
      },
      phase: 'agent-interaction-arrival',
    };
  }

  return makeServerRuntimeStep(dataDir, agentId, current, targetPoint, tickMs, {
    speedUnitsPerSec: LIVE_ACTION_RUNTIME_SPEED_UNITS_PER_SEC,
    arrivalRadius: LIVE_ACTION_RUNTIME_ARRIVAL_RADIUS,
    routeSource: 'server-live-action-runtime',
    crowdAgents,
  });
}

function liveActionObjectUseSpec(action, point, status = 'active') {
  const objectType = normalizeObjectTypeKey(point?.objectType || point?.catalogId || action?.target?.catalogId || '');
  const config = objectType ? SERVER_SCRIPTED_OBJECT_ACTIVITY_CONFIG[objectType] : null;
  const poseKind = safeText(point?.poseKind || config?.poseKind, '') || 'stand-use';
  const animationId = safeText(point?.animationId || config?.animationId, '') || (poseKind === 'seat' ? 'sit' : 'stand-use');
  const activityKind = safeText(point?.activityKind || config?.kind, '') || (poseKind === 'seat' ? 'object-seat-use' : 'object-use');
  const useState = status === 'completed' ? 'completed' : (status === 'arrived' ? 'arrived' : 'active');
  const seated = poseKind === 'seat';
  return {
    useState,
    poseKind,
    posture: seated ? 'seated' : 'standing-use',
    seated,
    animationId,
    activityKind,
    objectType: point?.objectType || point?.catalogId || action?.target?.catalogId || '',
    objectInstanceId: safeText(point?.objectInstanceId || action?.target?.objectInstanceId, ''),
    interactionSpotId: safeText(point?.interactionSpotId || action?.target?.interactionSpotId, ''),
    faceAngle: normalizeRuntimeAngleRadians(point?.faceAngle, 0),
    dockTarget: {
      x: Number(point.x),
      y: Number(point.y),
      floor: floorOr(point.floor, 1),
    },
  };
}

export function makeLiveActionEmbodiedState(action, point, status = 'active') {
  const kind = safeText(point?.targetKind || action?.target?.kind || '', '');
  if (!point || !['object-instance', 'interior-object', 'outdoor-area-node', 'seating-object'].includes(kind)) return null;
  const spec = liveActionObjectUseSpec(action, point, status);
  const carriedItem = action?.params?.carriedItem && typeof action.params.carriedItem === 'object'
    ? { ...action.params.carriedItem }
    : null;
  return {
    schemaVersion: 'agent-live-action-embodied-state/v1',
    useState: spec.useState,
    poseKind: spec.poseKind,
    posture: spec.posture,
    seated: spec.seated,
    animationId: spec.animationId,
    activityKind: spec.activityKind,
    objectType: spec.objectType,
    objectInstanceId: spec.objectInstanceId,
    interactionSpotId: spec.interactionSpotId,
    docked: true,
    activeUseState: status === 'completed' ? 'completed' : 'active',
    carrying: Boolean(carriedItem && !(status === 'completed' && spec.seated)),
    ...(carriedItem ? { carriedItem } : {}),
    finalPlacement: {
      x: spec.dockTarget.x,
      y: spec.dockTarget.y,
      floor: spec.dockTarget.floor,
      buildingId: safeText(point?.buildingId, ''),
      roomId: safeText(point?.roomId, ''),
      facingAngleRad: spec.faceAngle,
    },
  };
}

function makeLiveActionVisualState(isMoving, status = 'working', action = null, point = null) {
  const embodied = !isMoving && point ? makeLiveActionEmbodiedState(action, point, status) : null;
  const carriedItem = action?.params?.carriedItem && typeof action.params.carriedItem === 'object'
    ? { ...action.params.carriedItem }
    : null;
  const carrying = Boolean(carriedItem && !(status === 'completed' && embodied?.seated));
  const animationId = embodied?.animationId || (isMoving ? 'walk' : 'stand-use');
  const activity = embodied ? {
    kind: embodied.activityKind,
    phase: 'active',
    actionId: safeText(action?.actionType || action?.actionId, ''),
    worldActionId: safeText(action?.id || action?.worldActionId, ''),
    objectType: embodied.objectType,
    objectInstanceId: embodied.objectInstanceId,
    spotId: embodied.interactionSpotId,
    interactionSpotId: embodied.interactionSpotId,
    animationId,
    poseKind: embodied.poseKind,
    posture: embodied.posture,
    seated: embodied.seated,
    docked: embodied.docked,
    dockTarget: embodied.finalPlacement,
    faceAngle: embodied.finalPlacement?.facingAngleRad,
  } : null;
  return {
    schemaVersion: 'agent-runtime-visual/v1',
    status,
    state: isMoving ? 'moving' : (embodied ? embodied.useState : 'idle'),
    resolvedAnimationId: animationId,
    movement: { isMoving, isRunning: false },
    activityActive: Boolean(activity),
    ...(activity ? { activityKind: activity.kind, activity } : {}),
    carrying,
    ...(carriedItem ? { carriedItem } : {}),
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
    ? route.routePoints.map(cloneRuntimePoint).filter(Boolean).slice(0, SERVER_RUNTIME_ROUTE_POINTS_SUMMARY_LIMIT)
    : [];
  const rawPoints = Array.isArray(route.rawPoints)
    ? route.rawPoints.map(cloneRuntimePoint).filter(Boolean).slice(0, SERVER_RUNTIME_RAW_POINTS_SUMMARY_LIMIT)
    : [];
  const rawCells = Array.isArray(route.rawCells)
    ? route.rawCells.map(cloneRuntimePoint).filter(Boolean).slice(0, SERVER_RUNTIME_RAW_CELLS_SUMMARY_LIMIT)
    : [];
  const nextPoint = cloneRuntimePoint(route.effectiveTarget || route.pursuitTarget || route.route?.[route.routeIndex || 0] || null);
  return {
    schemaVersion: 'agent-runtime-server-route/v1',
    source: safeText(route.source || 'dynamic-interior-routing.js', 'dynamic-interior-routing.js') || 'dynamic-interior-routing.js',
    active: route.active === true,
    reason: safeText(route.reason, ''),
    phase: safeText(route.phase, ''),
    routeSource: safeText(route.routeSource, ''),
    doorBuildingId: safeText(route.doorBuildingId, ''),
    doorFinalTarget: cloneRuntimePoint(route.doorFinalTarget || null),
    routeIndex: Math.max(0, Math.floor(numberOr(route.routeIndex, 0))),
    routeLength: Array.isArray(route.route) ? route.route.length : routePoints.length,
    nextPoint,
    finalPoint: cloneRuntimePoint(route.finalPoint || routePoints[routePoints.length - 1] || null),
    targetAdjusted: route.targetAdjusted === true,
    adjustedTarget: cloneRuntimePoint(route.adjustedTarget || null),
    projectedPoint: cloneRuntimePoint(route.projectedPoint || null),
    pursuitTarget: cloneRuntimePoint(route.pursuitTarget || null),
    rerouteFrom: cloneRuntimePoint(route.rerouteFrom || null),
    elevatorTrip: summarizeServerRuntimeElevatorTrip(route.elevatorTrip || null),
    blockedPoint: cloneRuntimePoint(route.blockedPoint || null),
    blockedReason: safeText(route.blockedReason, ''),
    recoveryAvoidPoint: cloneRuntimePoint(route.recoveryAvoidPoint || null),
    recoveryAvoidRadiusWorld: Number.isFinite(Number(route.recoveryAvoidRadiusWorld))
      ? Number(route.recoveryAvoidRadiusWorld)
      : 0,
    crowdAvoidedAgents: Array.isArray(route.crowdAvoidedAgents)
      ? route.crowdAvoidedAgents.slice(0, 8).map(entry => ({
          agentId: safeText(entry?.agentId, ''),
          distance: Number.isFinite(Number(entry?.distance)) ? Number(entry.distance) : 0,
          mode: safeText(entry?.mode, ''),
        })).filter(entry => entry.agentId)
      : [],
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

function normalizeServerRuntimePoint(point = null, fallbackFloor = 1) {
  const x = numberOr(point?.x, NaN);
  const y = numberOr(point?.y ?? point?.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    floor: floorOr(point?.floor, fallbackFloor),
    buildingId: safeText(point?.buildingId || '', ''),
  };
}

function serverRuntimeCrowdAgents(state, agentId) {
  const crowd = [];
  for (const [otherId, record] of state?.agents?.entries?.() || []) {
    if (String(otherId) === String(agentId)) continue;
    const plain = snapshotToPlain(record);
    const point = normalizeServerRuntimePoint(plain, 1);
    if (!point) continue;
    const target = plain.target && typeof plain.target === 'object' ? plain.target : null;
    const runtimeRoute = plain.visualState && typeof plain.visualState === 'object'
      ? plain.visualState.runtimeRoute
      : null;
    const targetObjectKey = String(target?.objectKey || (
      target?.buildingId && target?.furnitureIndex != null
        ? runtimeFurnitureObjectKey(target.buildingId, target.furnitureIndex, target.objectType || 'object')
        : ''
    )).slice(0, 180);
    const targetBaseObjectKey = String(target?.baseObjectKey || targetObjectKey || '').slice(0, 180);
    crowd.push({
      agentId: safeText(plain.agentId || otherId, '') || String(otherId),
      x: point.x,
      y: point.y,
      floor: point.floor,
      buildingId: point.buildingId,
      state: safeText(plain.state, ''),
      targetObjectKey,
      targetBaseObjectKey,
      targetIsQueueUse: target?.isQueueUse === true,
      elevatorTrip: summarizeServerRuntimeElevatorTrip(runtimeRoute?.elevatorTrip || null),
    });
  }
  return crowd;
}

function shouldIgnoreServerRuntimeCrowdAgent(other, routeTarget = null) {
  if (!other || !routeTarget || typeof routeTarget !== 'object') return false;
  const baseObjectKey = String(routeTarget.baseObjectKey || routeTarget.objectKey || '');
  if (!baseObjectKey || String(other.targetBaseObjectKey || '') !== baseObjectKey) return false;
  const otherWaiting = ['waiting', 'queued'].includes(String(other.state || '').toLowerCase());
  return other.targetIsQueueUse === true && otherWaiting;
}

function shouldIgnoreServerRuntimeDockOccupant(other, routeTarget = null, finalTarget = null, candidatePoint = null, arrivalRadius = 5) {
  if (!other || !routeTarget || typeof routeTarget !== 'object' || !finalTarget || !candidatePoint) return false;
  const baseObjectKey = String(routeTarget.baseObjectKey || routeTarget.objectKey || '');
  const state = String(other.state || '').toLowerCase();
  const otherDistToFinal = Math.hypot(numberOr(other.x, finalTarget.x) - finalTarget.x, numberOr(other.y, finalTarget.y) - finalTarget.y);
  const candidateDistToFinal = Math.hypot(numberOr(candidatePoint.x, finalTarget.x) - finalTarget.x, numberOr(candidatePoint.y ?? candidatePoint.z, finalTarget.y) - finalTarget.y);
  const dockRadius = Math.max(SERVER_RUNTIME_AGENT_SEPARATION_RADIUS, numberOr(arrivalRadius, 5) * 2);
  if (otherDistToFinal > dockRadius || candidateDistToFinal > dockRadius) return false;
  if (baseObjectKey && String(other.targetBaseObjectKey || '') === baseObjectKey) {
    return ['working', 'using', 'active', 'waiting', 'queued', 'meeting'].includes(state);
  }
  const committedObjectDock = Boolean(
    routeTarget.sourceObjectKey ||
    routeTarget.objectKey ||
    routeTarget.baseObjectKey ||
    routeTarget.furnitureIndex != null ||
    routeTarget.objectInstanceId
  );
  return committedObjectDock && state === 'idle' && otherDistToFinal <= dockRadius * 0.8;
}

function pointToSegmentDistanceApi(point, segA, segB) {
  if (!point || !segA || !segB) return Infinity;
  const vx = Number(segB.x || 0) - Number(segA.x || 0);
  const vy = Number(segB.y || 0) - Number(segA.y || 0);
  const wx = Number(point.x || 0) - Number(segA.x || 0);
  const wy = Number(point.y || 0) - Number(segA.y || 0);
  const len2 = vx * vx + vy * vy;
  if (len2 <= 0.000001) return Math.hypot(wx, wy);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(Number(segA.x || 0) + vx * t - Number(point.x || 0), Number(segA.y || 0) + vy * t - Number(point.y || 0));
}

function projectPointOntoServerRuntimeRoute(currentPoint, routePoints = []) {
  if (!currentPoint || !Array.isArray(routePoints) || routePoints.length === 0) return null;
  if (routePoints.length === 1) {
    const point = routePoints[0];
    return {
      segmentIndex: 0,
      t: 1,
      distance: Math.hypot(Number(point.x) - Number(currentPoint.x), Number(point.y) - Number(currentPoint.y)),
      projectedPoint: cloneRuntimePoint(point),
    };
  }
  let best = null;
  for (let index = 0; index < routePoints.length - 1; index += 1) {
    const a = routePoints[index];
    const b = routePoints[index + 1];
    if (!a || !b) continue;
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const wx = Number(currentPoint.x) - ax;
    const wy = Number(currentPoint.y) - ay;
    const t = len2 > 0.000001 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
    const px = ax + vx * t;
    const py = ay + vy * t;
    const distance = Math.hypot(px - Number(currentPoint.x), py - Number(currentPoint.y));
    const score = distance + index * 0.0001;
    if (!best || score < best.score) {
      best = {
        segmentIndex: index,
        t,
        distance,
        score,
        projectedPoint: { x: px, y: py, floor: floorOr(a.floor ?? b.floor ?? currentPoint.floor, currentPoint.floor) },
      };
    }
  }
  return best;
}

function findServerRuntimeCrowdConflict(agentId, currentPoint, candidatePoint, crowdAgents = [], {
  routeTarget = null,
  finalTarget = null,
  arrivalRadius = 5,
  hardRadius = SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS,
} = {}) {
  const current = normalizeServerRuntimePoint(currentPoint, candidatePoint?.floor || 1);
  const candidate = normalizeServerRuntimePoint(candidatePoint, current?.floor || 1);
  if (!current || !candidate) return null;
  const destination = normalizeServerRuntimePoint(finalTarget, candidate.floor);
  let best = null;
  for (const other of crowdAgents || []) {
    if (!other || String(other.agentId || '') === String(agentId || '')) continue;
    if (floorOr(other.floor, current.floor) !== current.floor) continue;
    if (shouldIgnoreServerRuntimeCrowdAgent(other, routeTarget)) continue;
    const otherPoint = { x: numberOr(other.x, candidate.x), y: numberOr(other.y, candidate.y) };
    if (shouldIgnoreServerRuntimeDockOccupant(other, routeTarget, destination, candidate, arrivalRadius)) continue;
    const currentDist = Math.hypot(current.x - otherPoint.x, current.y - otherPoint.y);
    const candidateDist = Math.hypot(candidate.x - otherPoint.x, candidate.y - otherPoint.y);
    const segmentDist = pointToSegmentDistanceApi(otherPoint, current, candidate);
    const startsOverlapped = currentDist < hardRadius;
    const blocked = startsOverlapped
      ? candidateDist <= currentDist + 0.35
      : (candidateDist < hardRadius || segmentDist < hardRadius);
    if (!blocked) continue;
    const distance = Math.min(candidateDist, segmentDist);
    if (!best || distance < best.distance) {
      best = {
        agentId: safeText(other.agentId, '') || String(other.agentId || ''),
        x: otherPoint.x,
        y: otherPoint.y,
        distance,
        candidateDistance: candidateDist,
        segmentDistance: segmentDist,
        currentDistance: currentDist,
        mode: startsOverlapped ? 'separate-block' : 'path-block',
      };
    }
  }
  return best;
}

function tryServerRuntimeCrowdSlide(dataDir, agentId, current, proposed, crowdConflict, {
  phase = '',
  route = null,
  crowdAgents = [],
  finalTarget = null,
  arrivalRadius = 5,
  routeTarget = null,
} = {}) {
  if (!crowdConflict) return null;
  const dx = proposed.x - current.x;
  const dy = proposed.y - current.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0.001) return null;
  const normalX = -dy / len;
  const normalY = dx / len;
  const offsets = [
    LIVE_ACTION_API_TILE * 0.35,
    LIVE_ACTION_API_TILE * 0.6,
    LIVE_ACTION_API_TILE * 0.9,
  ];
  const scales = [1, 0.82, 0.62, 0.42, 0.24];
  for (const scale of scales) {
    const baseX = current.x + dx * scale;
    const baseY = current.y + dy * scale;
    for (const offset of offsets) {
      for (const side of [1, -1]) {
        const candidate = {
          ...proposed,
          x: baseX + normalX * offset * side,
          y: baseY + normalY * offset * side,
        };
        const forwardProgress = ((candidate.x - current.x) * dx + (candidate.y - current.y) * dy) / len;
        if (forwardProgress <= 0.2) continue;
        const staticResult = validateServerRuntimeStaticSegment(dataDir, current, candidate, { phase, route });
        if (!staticResult.clear) continue;
        const nextCrowdConflict = findServerRuntimeCrowdConflict(agentId, current, candidate, crowdAgents, {
          routeTarget,
          finalTarget,
          arrivalRadius,
        });
        if (nextCrowdConflict) continue;
        return {
          point: candidate,
          adjusted: true,
          routePatch: {
            blockedReason: `server-crowd-slide-${crowdConflict.mode || 'blocked'}`,
            blockedPoint: { x: numberOr(crowdConflict.x, proposed.x), y: numberOr(crowdConflict.y, proposed.y), floor: proposed.floor },
            crowdAvoidedAgents: [crowdConflict],
          },
        };
      }
    }
  }
  return null;
}

function makeServerRuntimeDynamicAvoidZones(agentId, currentPoint, finalTarget, crowdAgents = [], routeTarget = null) {
  const current = normalizeServerRuntimePoint(currentPoint, finalTarget?.floor || 1);
  const final = normalizeServerRuntimePoint(finalTarget, current?.floor || 1);
  if (!current || !final || !Array.isArray(crowdAgents) || crowdAgents.length === 0) return [];
  const routeLength = Math.max(1, Math.hypot(final.x - current.x, final.y - current.y));
  const relevanceRadiusApi = Math.max(LIVE_ACTION_API_TILE * 3.25, routeLength * 0.18);
  const zones = [];
  for (const other of crowdAgents) {
    if (!other || String(other.agentId || '') === String(agentId || '')) continue;
    if (floorOr(other.floor, current.floor) !== current.floor) continue;
    if (shouldIgnoreServerRuntimeDockOccupant(other, routeTarget, final, final, 5)) continue;
    const point = { x: numberOr(other.x, NaN), y: numberOr(other.y, NaN) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const distToCurrent = Math.hypot(point.x - current.x, point.y - current.y);
    const distToRoute = pointToSegmentDistanceApi(point, current, final);
    const distToFinal = Math.hypot(point.x - final.x, point.y - final.y);
    if (Math.min(distToCurrent, distToRoute, distToFinal) > relevanceRadiusApi) continue;
    const state = String(other.state || '').toLowerCase();
    const stationaryBoost = ['idle', 'waiting', 'queued', 'working', 'using', 'active', 'meeting'].includes(state) ? 1.25 : 1;
    zones.push({
      x: point.x,
      y: point.y,
      radiusWorld: SERVER_RUNTIME_DYNAMIC_AVOID_RADIUS_WORLD,
      hardRadiusWorld: SERVER_RUNTIME_DYNAMIC_AVOID_HARD_RADIUS_WORLD,
      weight: SERVER_RUNTIME_DYNAMIC_AVOID_COST * stationaryBoost,
      score: Math.min(distToCurrent, distToRoute + LIVE_ACTION_API_TILE * 0.35, distToFinal + LIVE_ACTION_API_TILE * 0.65),
      agentId: safeText(other.agentId, '') || String(other.agentId || ''),
    });
  }
  zones.sort((a, b) => a.score - b.score);
  return zones.slice(0, SERVER_RUNTIME_DYNAMIC_AVOID_MAX_ZONES).map(({ score, ...zone }) => zone);
}

function isServerRuntimeDoorPhase(phase, route = null) {
  const text = `${phase || ''}:${route?.source || ''}:${route?.reason || ''}`.toLowerCase();
  return text.includes('door');
}

function isServerRuntimeUnvalidatedManualRoute(route = null) {
  const text = `${route?.source || ''}:${route?.reason || ''}`.toLowerCase();
  return text.includes('unknown-building');
}

function isServerRuntimePathfinderRoute(route = null) {
  const source = String(route?.source || '').toLowerCase();
  if (!source.includes('dynamic-interior-routing.js') && !source.includes('dynamic-exterior-routing.js')) return false;
  if (route?.active === false) return false;
  const routePointCount = Array.isArray(route?.routePoints)
    ? route.routePoints.length
    : (Array.isArray(route?.route) ? route.route.length : 0);
  return routePointCount > 1;
}

function isServerRuntimeAdjustedArrivalTarget(target = null) {
  if (!target || typeof target !== 'object') return false;
  const kind = String(target.targetKind || target.kind || '').toLowerCase();
  return Boolean(
    target.objectKey ||
    target.baseObjectKey ||
    target.objectId ||
    target.objectInstanceId ||
    target.furnitureIndex != null ||
    target.objectType ||
    target.actionId ||
    ['placed-object', 'interior-object', 'interior-action-spot', 'agent-desk', 'desk', 'work-desk'].includes(kind)
  );
}

function isServerRuntimeDoorwaySegment(building, aPoint, bPoint) {
  if (!building || building.type === 'park' || !aPoint || !bPoint) return false;
  const a = buildingLocalPointFromApi(building, aPoint.x, aPoint.y ?? aPoint.z);
  const b = buildingLocalPointFromApi(building, bPoint.x, bPoint.y ?? bPoint.z);
  if (!a || !b) return false;
  const spec = getBuildingDoorSpec(building);
  const centerX = numberOr(spec.localCenterX, Number(building.widthTiles || 10) / 2);
  const height = Number(building.heightTiles || 8) || 8;
  const halfWidth = Math.max(1.55, numberOr(spec.doorwayReachWorld, 0.55) * 2.2);
  const minZ = Math.max(0, Math.min(spec.localInteriorZ, spec.localDoorwayZ) - 0.65);
  const maxZ = Math.max(height + 0.35, Math.max(spec.localOutsideZ, spec.localThresholdZ) + 0.65);
  const inDoorX = (point) => Math.abs(Number(point.x) - centerX) <= halfWidth;
  const inDoorZ = (point) => Number(point.z) >= minZ && Number(point.z) <= maxZ;
  return inDoorX(a) && inDoorX(b) && inDoorZ(a) && inDoorZ(b);
}

function clearServerRuntimePathfinderStateForRoute(agentId, route = null) {
  const source = String(route?.source || '').toLowerCase();
  if (source.includes('dynamic-interior-routing.js')) clearDynamicInteriorRoutingForAgent(agentId);
  if (source.includes('dynamic-exterior-routing.js')) clearDynamicExteriorRoutingForAgent(agentId);
}

function validateServerRuntimeStaticSegment(dataDir, currentPoint, proposedPoint, { phase = '', route = null } = {}) {
  const current = normalizeServerRuntimePoint(currentPoint, proposedPoint?.floor || 1);
  const proposed = normalizeServerRuntimePoint(proposedPoint, current?.floor || 1);
  if (!current || !proposed) return { clear: true, reason: 'missing-segment-context' };
  if (isServerRuntimeUnvalidatedManualRoute(route)) return { clear: true, reason: 'unknown-building-route' };

  const currentCoordinateBuilding = findInteriorBuildingAtApi(dataDir, current.x, current.y);
  const proposedCoordinateBuilding = findInteriorBuildingAtApi(dataDir, proposed.x, proposed.y);
  const currentBuilding = currentCoordinateBuilding?.id
    ? (readBuildingDocument(dataDir, currentCoordinateBuilding.id) || currentCoordinateBuilding)
    : null;
  const proposedBuilding = proposedCoordinateBuilding?.id
    ? (readBuildingDocument(dataDir, proposedCoordinateBuilding.id) || proposedCoordinateBuilding)
    : null;

  if (currentBuilding && proposedBuilding && currentBuilding.id === proposedBuilding.id && currentBuilding.type !== 'park') {
    if (isServerRuntimeDoorPhase(phase, route) && isServerRuntimeDoorwaySegment(currentBuilding, current, proposed)) {
      return {
        clear: true,
        reason: 'door-transition',
        buildingId: currentBuilding.id,
      };
    }
    const segmentFloor = clampServerRuntimeFloorForBuilding(
      currentBuilding,
      current.floor ?? proposed.floor ?? 1,
    );
    const result = isDynamicInteriorRouteSegmentClear(
      serverRuntimeFloorScopedBuilding(currentBuilding, segmentFloor),
      { ...current, floor: segmentFloor },
      { ...proposed, floor: segmentFloor },
    );
    return result.clear ? { ...result, buildingId: currentBuilding.id } : { ...result, buildingId: currentBuilding.id };
  }

  if (!currentBuilding && !proposedBuilding) {
    const result = isDynamicExteriorRouteSegmentClear(current, proposed, { allowSoftFallback: true });
    return result.clear ? result : { ...result, blockedReason: `exterior-${result.reason || 'blocked'}` };
  }

  const handoffBuilding = currentBuilding || proposedBuilding;
  if (handoffBuilding && handoffBuilding.type !== 'park') {
    if (isServerRuntimeDoorwaySegment(handoffBuilding, current, proposed)) {
      return {
        clear: true,
        reason: isServerRuntimeDoorPhase(phase, route) ? 'door-transition' : 'doorway-handoff',
        buildingId: handoffBuilding.id,
      };
    }
    return {
      clear: false,
      reason: 'building-wall-handoff',
      blockedPoint: proposed,
      buildingId: handoffBuilding.id,
    };
  }

  return { clear: true, reason: 'building-handoff' };
}

function applyServerRuntimeAgentAvoidance(agentId, currentPoint, proposedPoint, crowdAgents = [], {
  tickMs = DEFAULT_WORLD_RUNTIME_TICK_MS,
  speedUnitsPerSec = LIVE_ACTION_RUNTIME_SPEED_UNITS_PER_SEC,
  finalTarget = null,
  arrivalRadius = 5,
  routeTarget = null,
} = {}) {
  const current = normalizeServerRuntimePoint(currentPoint, proposedPoint?.floor || 1);
  const proposed = normalizeServerRuntimePoint(proposedPoint, current?.floor || 1);
  if (!current || !proposed) return { point: proposedPoint, adjusted: false, blockers: [] };
  const destination = normalizeServerRuntimePoint(finalTarget, proposed.floor);
  let moveX = proposed.x - current.x;
  let moveY = proposed.y - current.y;
  if (Math.hypot(moveX, moveY) <= 0.001) return { point: proposed, adjusted: false, blockers: [] };

  const step = Math.max(1, numberOr(speedUnitsPerSec, LIVE_ACTION_RUNTIME_SPEED_UNITS_PER_SEC) * (Math.max(1, tickMs) / 1000));
  const blockers = [];
  for (const other of crowdAgents || []) {
    if (!other || String(other.agentId || '') === String(agentId || '')) continue;
    if (floorOr(other.floor, current.floor) !== current.floor) continue;
    if (shouldIgnoreServerRuntimeCrowdAgent(other, routeTarget)) continue;
    if (shouldIgnoreServerRuntimeDockOccupant(other, routeTarget, destination, proposed, arrivalRadius)) continue;
    const ox = current.x - numberOr(other.x, current.x);
    const oy = current.y - numberOr(other.y, current.y);
    const dist = Math.hypot(ox, oy);
    if (dist < SERVER_RUNTIME_AGENT_AVOID_RADIUS && dist > 0.5) {
      const force = Math.min(
        SERVER_RUNTIME_AGENT_AVOID_PUSH_PER_TICK,
        step * SERVER_RUNTIME_AGENT_AVOID_FORCE_MULTIPLIER * (1 - dist / SERVER_RUNTIME_AGENT_AVOID_RADIUS),
      );
      moveX += (ox / dist) * force;
      moveY += (oy / dist) * force;
      blockers.push({ agentId: other.agentId || '', distance: dist, mode: 'steer' });
    }
  }

  const next = { ...proposed, x: current.x + moveX, y: current.y + moveY };
  for (const other of crowdAgents || []) {
    if (!other || String(other.agentId || '') === String(agentId || '')) continue;
    if (floorOr(other.floor, current.floor) !== current.floor) continue;
    if (shouldIgnoreServerRuntimeCrowdAgent(other, routeTarget)) continue;
    if (shouldIgnoreServerRuntimeDockOccupant(other, routeTarget, destination, next, arrivalRadius)) continue;
    const ox = next.x - numberOr(other.x, next.x);
    const oy = next.y - numberOr(other.y, next.y);
    const dist = Math.hypot(ox, oy);
    if (dist < SERVER_RUNTIME_AGENT_SEPARATION_RADIUS && dist > 0.1) {
      const push = Math.min(
        SERVER_RUNTIME_AGENT_SEPARATION_PUSH_PER_TICK,
        step * 0.35,
      ) * (1 - dist / SERVER_RUNTIME_AGENT_SEPARATION_RADIUS);
      next.x += (ox / dist) * push;
      next.y += (oy / dist) * push;
      blockers.push({ agentId: other.agentId || '', distance: dist, mode: 'separate' });
    }
  }

  return { point: next, adjusted: blockers.length > 0, blockers };
}

function tryServerRuntimePathfinderStaticSlide(dataDir, current, proposed, staticResult, {
  phase = '',
  route = null,
} = {}) {
  if (!isServerRuntimePathfinderRoute(route)) return null;
  const dx = proposed.x - current.x;
  const dy = proposed.y - current.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0.001) return null;
  const normalX = -dy / len;
  const normalY = dx / len;
  const offsets = [
    LIVE_ACTION_API_TILE * 0.15,
    LIVE_ACTION_API_TILE * 0.3,
    LIVE_ACTION_API_TILE * 0.5,
  ];
  const scales = [1, 0.75, 0.5, 0.25];
  for (const scale of scales) {
    const baseX = current.x + dx * scale;
    const baseY = current.y + dy * scale;
    for (const offset of offsets) {
      for (const side of [1, -1]) {
        const candidate = {
          ...proposed,
          x: baseX + normalX * offset * side,
          y: baseY + normalY * offset * side,
        };
        const forwardProgress = ((candidate.x - current.x) * dx + (candidate.y - current.y) * dy) / len;
        if (forwardProgress <= 0.25) continue;
        const result = validateServerRuntimeStaticSegment(dataDir, current, candidate, { phase, route });
        if (result.clear) {
          return {
            point: candidate,
            adjusted: true,
            routePatch: {
              blockedPoint: staticResult.blockedPoint || proposed,
              blockedReason: `server-static-slide-${staticResult.reason || staticResult.blockedReason || 'blocked'}`,
            },
          };
        }
      }
    }
  }
  return null;
}

function applyServerRuntimeCollisionGuards(dataDir, agentId, currentPoint, proposedPoint, {
  phase = '',
  route = null,
  crowdAgents = [],
  tickMs = DEFAULT_WORLD_RUNTIME_TICK_MS,
  speedUnitsPerSec = LIVE_ACTION_RUNTIME_SPEED_UNITS_PER_SEC,
  finalTarget = null,
  arrivalRadius = 5,
  routeTarget = null,
} = {}) {
  const current = normalizeServerRuntimePoint(currentPoint, proposedPoint?.floor || 1);
  const proposed = normalizeServerRuntimePoint(proposedPoint, current?.floor || 1);
  if (!current || !proposed) return { point: proposedPoint, adjusted: false, routePatch: null };

  const staticResult = validateServerRuntimeStaticSegment(dataDir, current, proposed, { phase, route });
  if (!staticResult.clear) {
    const dx = proposed.x - current.x;
    const dy = proposed.y - current.y;
    for (const scale of [0.5, 0.25, 0.125]) {
      const partial = {
        ...proposed,
        x: current.x + dx * scale,
        y: current.y + dy * scale,
      };
      if (Math.hypot(partial.x - current.x, partial.y - current.y) <= 0.5) continue;
      const partialResult = validateServerRuntimeStaticSegment(dataDir, current, partial, { phase, route });
      if (partialResult.clear) {
        return {
          point: partial,
          adjusted: true,
          routePatch: {
            blockedPoint: staticResult.blockedPoint || proposed,
            blockedReason: `server-static-step-reduced-${staticResult.reason || staticResult.blockedReason || 'blocked'}`,
          },
        };
      }
    }
    const slideResult = tryServerRuntimePathfinderStaticSlide(dataDir, current, proposed, staticResult, { phase, route });
    if (slideResult) return slideResult;
    clearServerRuntimePathfinderStateForRoute(agentId, route);
    return {
      point: current,
      adjusted: true,
      blocked: true,
      routePatch: {
        active: false,
        blockedPoint: staticResult.blockedPoint || proposed,
        blockedReason: `server-static-step-${staticResult.reason || staticResult.blockedReason || 'blocked'}`,
      },
    };
  }

  const hardCrowdConflict = findServerRuntimeCrowdConflict(agentId, current, proposed, crowdAgents, {
    routeTarget,
    finalTarget,
    arrivalRadius,
  });
  if (hardCrowdConflict) {
    const crowdSlide = tryServerRuntimeCrowdSlide(dataDir, agentId, current, proposed, hardCrowdConflict, {
      phase,
      route,
      crowdAgents,
      finalTarget,
      arrivalRadius,
      routeTarget,
    });
    if (crowdSlide) return crowdSlide;
    return {
      point: current,
      adjusted: true,
      blocked: true,
      routePatch: {
        active: route?.active === true,
        blockedPoint: proposed,
        blockedReason: `server-crowd-wait-${hardCrowdConflict.mode || 'blocked'}`,
        crowdAvoidedAgents: [hardCrowdConflict],
      },
    };
  }

  const crowdResult = applyServerRuntimeAgentAvoidance(agentId, current, proposed, crowdAgents, { tickMs, speedUnitsPerSec, finalTarget, arrivalRadius, routeTarget });
  if (!crowdResult.adjusted) return { point: proposed, adjusted: false, routePatch: null };
  const destination = normalizeServerRuntimePoint(finalTarget, proposed.floor);
  if (destination) {
    const proposedProgress = Math.hypot(destination.x - current.x, destination.y - current.y) - Math.hypot(destination.x - proposed.x, destination.y - proposed.y);
    const crowdProgress = Math.hypot(destination.x - current.x, destination.y - current.y) - Math.hypot(destination.x - crowdResult.point.x, destination.y - crowdResult.point.y);
    const proposedStep = Math.hypot(proposed.x - current.x, proposed.y - current.y);
    const crowdStep = Math.hypot(crowdResult.point.x - current.x, crowdResult.point.y - current.y);
    const noForwardProgress = proposedProgress > 0.05 && (
      crowdProgress < Math.max(0.05, proposedProgress * 0.25) ||
      crowdStep < Math.min(1, proposedStep * 0.2)
    );
    if (noForwardProgress) {
      return {
        point: current,
        adjusted: true,
        routePatch: {
          blockedPoint: proposed,
          blockedReason: 'server-crowd-wait-no-forward-progress',
          crowdAvoidedAgents: crowdResult.blockers,
        },
      };
    }
  }
  const crowdStatic = validateServerRuntimeStaticSegment(dataDir, current, crowdResult.point, { phase, route });
  if (!crowdStatic.clear) {
    return {
      point: proposed,
      adjusted: false,
      routePatch: {
        blockedPoint: crowdStatic.blockedPoint || crowdResult.point,
        blockedReason: `server-crowd-adjustment-${crowdStatic.reason || crowdStatic.blockedReason || 'blocked'}`,
        crowdAvoidedAgents: crowdResult.blockers,
      },
    };
  }

  return {
    point: crowdResult.point,
    adjusted: true,
    routePatch: { crowdAvoidedAgents: crowdResult.blockers },
  };
}

function selectCachedServerRuntimeRouteStep(current, currentPoint, finalTarget, arrivalRadius = 5) {
  const runtimeRoute = current?.visualState?.runtimeRoute;
  if (!runtimeRoute || typeof runtimeRoute !== 'object' || runtimeRoute.active !== true) return null;
  if (String(runtimeRoute.blockedReason || '').startsWith('server-static-')) return null;
  if (String(runtimeRoute.blockedReason || '').startsWith('server-crowd-wait-')) return null;
  if (String(runtimeRoute.blockedReason || '').startsWith('server-crowd-slide-')) return null;
  if (String(runtimeRoute.blockedReason || '').startsWith('server-crowd-adjustment-')) return null;
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
  const routeEndpoint = routePoints[routePoints.length - 1];
  const acceptedEndpoint = runtimeRoute.targetAdjusted === true
    ? (cloneRuntimePoint(runtimeRoute.adjustedTarget || cachedFinal || finalTarget) || finalTarget)
    : finalTarget;
  if (routeEndpoint && acceptedEndpoint) {
    const endpointDist = Math.hypot(Number(routeEndpoint.x) - Number(acceptedEndpoint.x), Number(routeEndpoint.y) - Number(acceptedEndpoint.y));
    if (endpointDist > finalTolerance) return null;
    if (Number.isFinite(Number(routeEndpoint.floor)) && floorOr(routeEndpoint.floor, acceptedEndpoint.floor ?? finalTarget.floor) !== floorOr(acceptedEndpoint.floor ?? finalTarget.floor, finalTarget.floor)) return null;
  }
  const firstSteeringIndex = routePoints.length > 1 ? 1 : 0;
  const projection = projectPointOntoServerRuntimeRoute(currentPoint, routePoints);
  const corridorTolerance = Math.max(LIVE_ACTION_API_TILE * 1.35, finalTolerance, numberOr(arrivalRadius, 5) * 6);
  if (projection && projection.distance > corridorTolerance) return null;
  const projectedIndex = projection
    ? Math.max(firstSteeringIndex, Math.min(routePoints.length - 1, projection.segmentIndex + (projection.t > 0.72 ? 2 : 1)))
    : firstSteeringIndex;
  const storedIndex = Math.max(firstSteeringIndex, Math.min(routePoints.length - 1, Math.floor(numberOr(runtimeRoute.routeIndex, firstSteeringIndex))));
  const startIndex = storedIndex > projectedIndex + 1
    ? projectedIndex
    : Math.max(projectedIndex, storedIndex);
  const minStepDist = Math.max(1, numberOr(arrivalRadius, 5) * 0.5);
  const currentFinalDist = Math.hypot(Number(finalTarget.x) - Number(currentPoint.x), Number(finalTarget.y) - Number(currentPoint.y));
  let routeIndex = startIndex;
  let steeringTarget = null;
  for (let index = startIndex; index < routePoints.length; index += 1) {
    const point = routePoints[index];
    const dist = Math.hypot(Number(point.x) - Number(currentPoint.x), Number(point.y) - Number(currentPoint.y));
    if (dist > minStepDist) {
      routeIndex = index;
      steeringTarget = { ...finalTarget, x: Number(point.x), y: Number(point.y), floor: floorOr(point.floor ?? finalTarget.floor, finalTarget.floor) };
      break;
    }
    routeIndex = index;
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
      projectedPoint: projection?.projectedPoint || null,
      blockedPoint: null,
      blockedReason: '',
      crowdAvoidedAgents: [],
    },
  };
}

export function makeServerRuntimeStep(dataDir, agentId, current, target, tickMs, {
  speedUnitsPerSec,
  arrivalRadius,
  routeSource = 'server-runtime',
  crowdAgents = [],
} = {}) {
  const finalTarget = {
    x: Number(target?.x ?? current?.x ?? 0),
    y: Number(target?.y ?? target?.z ?? current?.y ?? 0),
    floor: floorOr(target?.floor ?? current?.floor, 1),
    buildingId: safeText(target?.buildingId || '', ''),
    roomId: safeText(target?.roomId || '', ''),
  };
  const rawCurrentPoint = {
    id: agentId,
    x: Number(current?.x || 0),
    y: Number(current?.y || 0),
    floor: floorOr(current?.floor, 1),
    buildingId: safeText(current?.buildingId || '', ''),
    roomId: safeText(current?.roomId || '', ''),
  };
  const currentCoordinateBuilding = serverRuntimePointBuilding(dataDir, rawCurrentPoint);
  const currentFloor = currentCoordinateBuilding
    ? clampServerRuntimeFloorForBuilding(currentCoordinateBuilding, rawCurrentPoint.floor)
    : 1;
  const currentPoint = {
    id: agentId,
    x: rawCurrentPoint.x,
    y: rawCurrentPoint.y,
    floor: currentFloor,
    buildingId: currentCoordinateBuilding ? safeText(currentCoordinateBuilding.id, '') : '',
    roomId: currentCoordinateBuilding && currentCoordinateBuilding.id === finalTarget.buildingId ? finalTarget.roomId : '',
  };
  let steeringTarget = finalTarget;
  let route = null;
  let phase = 'direct';
  const arrival = Math.max(1, numberOr(arrivalRadius, 5));
  const routeApproachSource = target?.routeApproachTarget && typeof target.routeApproachTarget === 'object'
    ? target.routeApproachTarget
    : null;
  const routeApproachTarget = routeApproachSource &&
    Number.isFinite(Number(routeApproachSource.x)) &&
    Number.isFinite(Number(routeApproachSource.y ?? routeApproachSource.z))
    ? {
        ...finalTarget,
        x: Number(routeApproachSource.x),
        y: Number(routeApproachSource.y ?? routeApproachSource.z),
        floor: floorOr(routeApproachSource.floor ?? finalTarget.floor, finalTarget.floor),
        buildingId: safeText(routeApproachSource.buildingId || finalTarget.buildingId, ''),
        targetKind: 'scripted-object-route-approach',
        spotId: safeText(routeApproachSource.spotId || target?.approachSpotId || 'approach-front', 'approach-front') || 'approach-front',
      }
    : null;
  const routeApproachSnapRadius = routeApproachTarget
    ? Math.max(arrival, numberOr(target?.dockSnapRadius ?? target?.activationRadius ?? target?.snapRadius, arrival))
    : arrival;
  const distanceToRouteApproach = routeApproachTarget
    ? Math.hypot(routeApproachTarget.x - currentPoint.x, routeApproachTarget.y - currentPoint.y)
    : Infinity;
  const routeViaApproach = Boolean(routeApproachTarget && distanceToRouteApproach > routeApproachSnapRadius);
  const movementTarget = routeViaApproach ? routeApproachTarget : finalTarget;
  const previousRuntimeRoute = current?.visualState?.runtimeRoute;
  const previousElevatorTrip = summarizeServerRuntimeElevatorTrip(previousRuntimeRoute?.elevatorTrip || null);
  const previousBlockedReason = String(previousRuntimeRoute?.blockedReason || '');
  const previousStaticBlock = previousBlockedReason.startsWith('server-static-');
  const previousCrowdBlock = previousBlockedReason.startsWith('server-crowd-wait-') ||
    previousBlockedReason.startsWith('server-crowd-slide-') ||
    previousBlockedReason.startsWith('server-crowd-adjustment-');
  const previousReplanBlock = previousStaticBlock || previousCrowdBlock;
  if (previousReplanBlock) clearServerRuntimePathfinderStateForRoute(agentId, previousRuntimeRoute);
  const recoveryAvoidPoint = previousReplanBlock
    ? cloneRuntimePoint(previousRuntimeRoute?.blockedPoint || previousRuntimeRoute?.recoveryAvoidPoint || null)
    : null;
  const dynamicAvoidZones = makeServerRuntimeDynamicAvoidZones(agentId, currentPoint, movementTarget, crowdAgents, target);
  const dynamicAvoidRoutePatch = dynamicAvoidZones.length
    ? {
        dynamicAvoidZoneCount: dynamicAvoidZones.length,
        dynamicAvoidZones: dynamicAvoidZones.slice(0, 4).map(zone => ({
          x: numberOr(zone.x, 0),
          y: numberOr(zone.y, 0),
          radiusWorld: numberOr(zone.radiusWorld, 0),
          hardRadiusWorld: numberOr(zone.hardRadiusWorld, 0),
          agentId: safeText(zone.agentId, ''),
        })),
      }
    : null;
  const recoveryRouteOptions = recoveryAvoidPoint
    ? {
        forceRecoveryReplan: true,
        recoveryAvoidPoint,
        recoveryReason: safeText(previousRuntimeRoute?.blockedReason, previousStaticBlock ? 'server-static-recovery' : 'server-crowd-recovery') || (previousStaticBlock ? 'server-static-recovery' : 'server-crowd-recovery'),
        ...(dynamicAvoidZones.length ? { dynamicAvoidZones } : {}),
      }
    : (dynamicAvoidZones.length ? { dynamicAvoidZones } : {});
  const coordinateTargetBuilding = findInteriorBuildingAtApi(dataDir, movementTarget.x, movementTarget.y);
  const targetBuildingById = movementTarget.buildingId ? readBuildingDocument(dataDir, movementTarget.buildingId) : null;
  const targetBuilding = targetBuildingById || (!movementTarget.buildingId ? coordinateTargetBuilding : null);
  const unknownTargetBuilding = Boolean(movementTarget.buildingId && !targetBuildingById);
  const currentBuilding = currentCoordinateBuilding;
  const cachedRouteStep = previousReplanBlock
    ? null
    : selectCachedServerRuntimeRouteStep(current, currentPoint, movementTarget, arrival);
  const makeRoute = (source, reason, effectiveTarget, points = [], active = false, extra = {}) => ({
    active,
    source,
    reason,
    effectiveTarget,
    routeIndex: 0,
    route: points.length ? points : [effectiveTarget],
    routePoints: [cloneRuntimePoint(currentPoint), ...points.map(cloneRuntimePoint), cloneRuntimePoint(movementTarget)].filter(Boolean),
    finalPoint: movementTarget,
    ...extra,
  });

  const makeDoorTransitionRoute = (reason, effectiveTarget, points = [], extra = {}) => {
    const routePoints = [cloneRuntimePoint(currentPoint), ...points.map(cloneRuntimePoint)].filter(Boolean);
    return makeRoute('server-door-transition', reason, effectiveTarget, points, true, {
      routeIndex: Math.min(1, Math.max(0, routePoints.length - 1)),
      route: routePoints.slice(1),
      routePoints,
      finalPoint: cloneRuntimePoint(effectiveTarget) || finalTarget,
      ...extra,
    });
  };

  const useDoorApproachRoute = (building, approachTarget, source, reason, routePhase, options = {}) => {
    const routeFloor = clampServerRuntimeFloorForBuilding(
      building,
      approachTarget?.floor ?? currentPoint.floor,
    );
    const routeTarget = { ...approachTarget, floor: routeFloor, targetKind: options.targetKind || 'building-door-approach' };
    steeringTarget = routeTarget;
    phase = routePhase;
    const dynamicRoute = source === 'interior'
      ? updateDynamicInteriorRouting(currentPoint, routeTarget, tickMs, {
          building: serverRuntimeFloorScopedBuilding(building, routeFloor),
          debug: false,
          ...recoveryRouteOptions,
        })
      : updateDynamicExteriorRouting(currentPoint, routeTarget, tickMs, {
          debug: false,
          ...recoveryRouteOptions,
        });
    if (dynamicRoute?.active && dynamicRoute.effectiveTarget) {
      steeringTarget = { ...routeTarget, x: dynamicRoute.effectiveTarget.x, y: dynamicRoute.effectiveTarget.y };
      route = {
        ...dynamicRoute,
        source: source === 'interior' ? 'dynamic-interior-routing.js' : 'dynamic-exterior-routing.js',
        reason,
        effectiveTarget: steeringTarget,
        finalPoint: routeTarget,
        doorFinalTarget: finalTarget,
        doorBuildingId: safeText(building?.id, ''),
      };
      return true;
    }
    route = makeRoute(
      source === 'interior' ? 'dynamic-interior-routing.js' : 'dynamic-exterior-routing.js',
      dynamicRoute?.reason || `${reason}-unavailable`,
      routeTarget,
      [routeTarget],
      false,
      {
        route: [cloneRuntimePoint(routeTarget)].filter(Boolean),
        routePoints: [cloneRuntimePoint(currentPoint), cloneRuntimePoint(routeTarget)].filter(Boolean),
        finalPoint: routeTarget,
        doorFinalTarget: finalTarget,
        doorBuildingId: safeText(building?.id, ''),
      },
    );
    return false;
  };

  const steerDoorTransition = (building, direction) => {
    const doorway = buildingDoorwayPointApi(building);
    const outside = buildingOutsideDoorPointApi(building) || doorway;
    const inside = buildingInteriorEntryPointApi(building) || doorway;
    const reach = buildingDoorwayReachApi(building);
    const doorFloor = clampServerRuntimeFloorForBuilding(building, currentPoint.floor);
    if (direction === 'enter' && outside && inside) {
      const distToOutside = Math.min(
        Math.hypot(currentPoint.x - outside.x, currentPoint.y - outside.y),
        doorway ? Math.hypot(currentPoint.x - doorway.x, currentPoint.y - doorway.y) : Infinity,
      );
      if (distToOutside <= Math.max(reach, arrival * 2)) {
        steeringTarget = { ...inside, floor: 1, buildingId: safeText(building?.id, ''), targetKind: 'building-door-entry' };
        phase = 'door-crossing';
        route = makeDoorTransitionRoute('enter-building-through-door', steeringTarget, [outside, doorway, inside].filter(Boolean).map(point => ({ ...point, floor: 1 })), {
          doorFinalTarget: finalTarget,
          doorBuildingId: safeText(building?.id, ''),
        });
        return true;
      }
      useDoorApproachRoute(building, outside, 'exterior', 'door-enter-approach', 'door-enter-approach', { targetKind: 'building-door-outside-approach' });
      return true;
    }
    if (direction === 'exit' && outside && inside) {
      const distToDoorway = doorway
        ? Math.hypot(currentPoint.x - doorway.x, currentPoint.y - doorway.y)
        : Math.hypot(currentPoint.x - inside.x, currentPoint.y - inside.y);
      if (distToDoorway <= Math.max(reach, arrival * 2)) {
        steeringTarget = { ...outside, floor: doorFloor, targetKind: 'building-door-exit' };
        phase = 'door-exit';
        route = makeDoorTransitionRoute('exit-building-through-door', steeringTarget, [doorway, outside].filter(Boolean).map(point => ({ ...point, floor: doorFloor })), {
          doorFinalTarget: finalTarget,
          doorBuildingId: safeText(building?.id, ''),
        });
        return true;
      }
      useDoorApproachRoute(building, { ...doorway, floor: doorFloor, targetKind: 'building-door-threshold' }, 'interior', 'inside-to-building-door', 'door-inside-approach', { targetKind: 'building-door-threshold' });
      return true;
    }
    return false;
  };

  const useExteriorRoute = () => {
    const dynamicRoute = updateDynamicExteriorRouting(currentPoint, movementTarget, tickMs, { debug: false, ...recoveryRouteOptions });
    if (dynamicRoute?.active && dynamicRoute.effectiveTarget) {
      steeringTarget = { ...movementTarget, x: dynamicRoute.effectiveTarget.x, y: dynamicRoute.effectiveTarget.y };
      phase = dynamicRoute.reason === 'door-approach' || dynamicRoute.reason === 'door-handoff'
        ? 'door-approach'
        : 'exterior-route';
      route = {
        ...dynamicRoute,
        source: 'dynamic-exterior-routing.js',
        finalPoint: movementTarget,
      };
      return true;
    }
    route = makeRoute('dynamic-exterior-routing.js', dynamicRoute?.reason || 'exterior-route-unavailable', movementTarget, [movementTarget]);
    return false;
  };

  const steerElevatorTransition = (building, toFloor, reason = 'floor-change') => {
    const fromFloor = clampServerRuntimeFloorForBuilding(building, currentPoint.floor);
    const destinationFloor = clampServerRuntimeFloorForBuilding(building, toFloor);
    const elevatorPoint = serverRuntimeElevatorApiPoint(building);
    if (!elevatorPoint || fromFloor === destinationFloor) return null;
    const accessPlan = serverRuntimeElevatorAccessPlan(
      agentId,
      building,
      fromFloor,
      destinationFloor,
      finalTarget,
      crowdAgents,
      previousElevatorTrip,
    );
    const accessTarget = {
      ...(accessPlan.target || elevatorPoint),
      floor: fromFloor,
      buildingId: safeText(building?.id, ''),
      targetKind: accessPlan.mode === 'queue' ? 'elevator-queue' : 'elevator-pad',
      ...(Number.isInteger(accessPlan.slotIndex) ? { elevatorSlotIndex: accessPlan.slotIndex } : {}),
      ...(Number.isInteger(accessPlan.queueIndex) ? { elevatorQueueIndex: accessPlan.queueIndex } : {}),
    };
    const startedAtMs = previousElevatorTrip?.startedAtMs || Date.now();
    const queuedAtMs = previousElevatorTrip?.queuedAtMs || accessPlan.queuedAtMs || startedAtMs;
    const trip = {
      active: true,
      buildingId: safeText(building?.id, ''),
      fromFloor,
      toFloor: destinationFloor,
      state: accessPlan.mode === 'queue' ? 'queue' : 'boarding',
      finalTarget,
      queuedAtMs,
      startedAtMs,
      ...(Number.isInteger(accessPlan.slotIndex) ? { slotIndex: accessPlan.slotIndex } : {}),
      ...(Number.isInteger(accessPlan.queueIndex) ? { queueIndex: accessPlan.queueIndex } : {}),
    };
    const atBoardingPoint = accessPlan.mode !== 'queue' && isServerRuntimeAtElevatorBoardingPoint(currentPoint, building, accessTarget);
    if (atBoardingPoint) {
      const exitPoint = serverRuntimeElevatorExitApiPoint(building) || elevatorPoint;
      const exitTarget = {
        ...exitPoint,
        floor: destinationFloor,
        buildingId: safeText(building?.id, ''),
        roomId: movementTarget.buildingId === building.id ? safeText(movementTarget.roomId, '') : '',
        targetKind: 'elevator-exit',
      };
      const heading = normalizeRuntimeAngleRadians(current?.heading, 0);
      const elevatorRoute = makeRoute('server-elevator-runtime', `elevator-${reason}-arrived`, exitTarget, [exitTarget], true, {
        routeIndex: 1,
        route: [cloneRuntimePoint(exitTarget)].filter(Boolean),
        routePoints: [cloneRuntimePoint(currentPoint), cloneRuntimePoint(exitTarget)].filter(Boolean),
        finalPoint: exitTarget,
        elevatorTrip: { ...trip, state: 'arrived' },
        elevatorFinalTarget: cloneRuntimePoint(finalTarget),
        routeSource,
        phase: 'elevator-arrive',
      });
      const distanceToFinal = Math.hypot(finalTarget.x - exitTarget.x, finalTarget.y - exitTarget.y);
      return {
        x: exitTarget.x,
        y: exitTarget.y,
        floor: destinationFloor,
        buildingId: safeText(building?.id, ''),
        roomId: exitTarget.roomId || '',
        heading,
        arrived: false,
        distanceToFinal,
        distanceToSteering: 0,
        steeringTarget: exitTarget,
        finalTarget,
        route: elevatorRoute,
        phase: 'elevator-arrive',
      };
    }

    steeringTarget = accessTarget;
    phase = accessPlan.mode === 'queue' ? 'elevator-queue' : 'elevator-boarding';
    const floorScopedBuilding = serverRuntimeFloorScopedBuilding(building, fromFloor);
    const dynamicRoute = updateDynamicInteriorRouting(currentPoint, accessTarget, tickMs, {
      building: floorScopedBuilding,
      debug: false,
      ...recoveryRouteOptions,
    });
    if (dynamicRoute?.active && dynamicRoute.effectiveTarget) {
      steeringTarget = { ...accessTarget, x: dynamicRoute.effectiveTarget.x, y: dynamicRoute.effectiveTarget.y };
      route = {
        ...dynamicRoute,
        source: 'dynamic-interior-routing.js',
        reason: `elevator-${accessPlan.mode}-${reason}`,
        effectiveTarget: steeringTarget,
        finalPoint: accessTarget,
        elevatorTrip: trip,
      };
      return true;
    }
    route = makeRoute('dynamic-interior-routing.js', dynamicRoute?.reason || `elevator-${accessPlan.mode}-${reason}-unavailable`, accessTarget, [accessTarget], false, {
      route: [cloneRuntimePoint(accessTarget)].filter(Boolean),
      routePoints: [cloneRuntimePoint(currentPoint), cloneRuntimePoint(accessTarget)].filter(Boolean),
      finalPoint: accessTarget,
      elevatorTrip: trip,
    });
    return true;
  };

  const currentInsideBuilding = Boolean(currentBuilding && currentBuilding.type !== 'park');
  const targetInsideCurrentBuilding = Boolean(
    currentInsideBuilding &&
    targetBuilding &&
    targetBuilding.type !== 'park' &&
    targetBuilding.id === currentBuilding.id
  );
  const elevatorTargetFloor = targetInsideCurrentBuilding
    ? clampServerRuntimeFloorForBuilding(currentBuilding, movementTarget.floor ?? finalTarget.floor)
    : 1;
  const elevatorHandled = currentInsideBuilding &&
    serverRuntimeBuildingFloorCount(currentBuilding) > 1 &&
    serverRuntimeNormalizeElevator(currentBuilding) &&
    elevatorTargetFloor !== currentPoint.floor
      ? steerElevatorTransition(currentBuilding, elevatorTargetFloor, targetInsideCurrentBuilding ? 'same-building-floor' : 'exit-to-ground-floor')
      : null;
  if (elevatorHandled && typeof elevatorHandled === 'object') return elevatorHandled;

  if (!elevatorHandled && cachedRouteStep) {
    steeringTarget = cachedRouteStep.steeringTarget;
    route = cachedRouteStep.route;
    phase = String(route.source || '').includes('interior') ? 'interior-route' : 'exterior-route';
  } else if (!elevatorHandled) {
    if (unknownTargetBuilding) {
      steeringTarget = movementTarget;
      phase = 'unknown-building-route';
      route = makeRoute('server-scripted-object-unknown-building-route', 'unknown-building-direct-route', movementTarget, [movementTarget], true);
    } else if (currentBuilding && currentBuilding.type !== 'park' && (!targetBuilding || currentBuilding.id !== targetBuilding.id)) {
      steerDoorTransition(currentBuilding, 'exit');
    } else if (targetBuilding && targetBuilding.type !== 'park') {
      const currentInsideTarget = currentBuilding?.id === targetBuilding.id;
      if (!currentInsideTarget) {
        if (!steerDoorTransition(targetBuilding, 'enter')) useExteriorRoute();
      } else {
        const routeFloor = clampServerRuntimeFloorForBuilding(targetBuilding, currentPoint.floor);
        const dynamicRoute = updateDynamicInteriorRouting(currentPoint, movementTarget, tickMs, {
          building: serverRuntimeFloorScopedBuilding(targetBuilding, routeFloor),
          debug: false,
          ...recoveryRouteOptions,
        });
        if (dynamicRoute?.active && dynamicRoute.effectiveTarget) {
          steeringTarget = { ...movementTarget, x: dynamicRoute.effectiveTarget.x, y: dynamicRoute.effectiveTarget.y };
          phase = 'interior-route';
          route = {
            ...dynamicRoute,
            source: 'dynamic-interior-routing.js',
            finalPoint: movementTarget,
          };
        } else {
          route = makeRoute('dynamic-interior-routing.js', dynamicRoute?.reason || 'interior-route-unavailable', movementTarget, [movementTarget]);
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
  const adjustedArrivalPoint = route?.targetAdjusted === true
    ? cloneRuntimePoint(route.adjustedTarget || null)
    : null;
  const distanceToAdjustedArrival = adjustedArrivalPoint
    ? Math.hypot(Number(adjustedArrivalPoint.x) - Number(currentPoint.x || 0), Number(adjustedArrivalPoint.y) - Number(currentPoint.y || 0))
    : Infinity;
  const arrivedAtAdjustedDock = Boolean(
    adjustedArrivalPoint &&
    isServerRuntimeAdjustedArrivalTarget(target) &&
    distanceToAdjustedArrival <= Math.max(arrival, 8)
  );
  const arrivedAtRouteApproachDock = Boolean(
    routeApproachTarget &&
    !routeViaApproach &&
    distanceToRouteApproach <= routeApproachSnapRadius &&
    isServerRuntimeAdjustedArrivalTarget(target)
  );
  const arrived = (distanceToFinal <= arrival || arrivedAtAdjustedDock || arrivedAtRouteApproachDock) && !String(phase || '').startsWith('door-');
  let arrivalPublishTarget = finalTarget;
  let arrivalRoutePatch = arrivedAtRouteApproachDock
    ? {
        routeApproachTarget,
        dockTarget: finalTarget,
        dockSnapReason: 'seat-route-approach-complete',
      }
    : null;
  if (arrivedAtAdjustedDock && adjustedArrivalPoint) {
    const arrivalSnapCheck = validateServerRuntimeStaticSegment(dataDir, currentPoint, finalTarget, { phase, route });
    if (!arrivalSnapCheck.clear) {
      arrivalPublishTarget = {
        ...finalTarget,
        x: Number(adjustedArrivalPoint.x),
        y: Number(adjustedArrivalPoint.y),
        floor: floorOr(adjustedArrivalPoint.floor ?? finalTarget.floor, finalTarget.floor),
      };
      arrivalRoutePatch = {
        blockedPoint: arrivalSnapCheck.blockedPoint || finalTarget,
        blockedReason: `server-static-arrival-snap-${arrivalSnapCheck.reason || arrivalSnapCheck.blockedReason || 'blocked'}`,
        adjustedTarget: adjustedArrivalPoint,
        arrivalSnapSuppressed: true,
      };
    }
  }

  // M1.5a — continuous waypoint advance: consume the full per-tick step distance
  // across successive route waypoints instead of stopping at each corner.
  // Intermediate waypoints never trigger arrival/dwell; only finalTarget uses arrivalRadius.
  const tickWaypoints = [];
  const tickCollisionPath = [];
  if (!arrived) {
    tickWaypoints.push({
      x: Number(steeringTarget.x),
      y: Number(steeringTarget.y),
      floor: floorOr(steeringTarget.floor ?? currentPoint.floor, currentPoint.floor),
      final: false,
    });
    const routePoints = Array.isArray(route?.routePoints) && route.routePoints.length > 1
      ? route.routePoints
      : (Array.isArray(route?.route) ? route.route : []);
    const canChainWaypoints = route?.active === true && routePoints.length > 1 && isServerRuntimePathfinderRoute(route);
    let steeringIndex = -1;
    if (canChainWaypoints) {
      for (let index = 0; index < routePoints.length; index += 1) {
        const point = routePoints[index];
        if (!point) continue;
        if (Math.hypot(Number(point.x) - Number(steeringTarget.x), Number(point.y) - Number(steeringTarget.y)) <= 0.5) {
          steeringIndex = index;
          break;
        }
      }
      if (steeringIndex >= 0) {
        for (let index = steeringIndex + 1; index < routePoints.length; index += 1) {
          const point = routePoints[index];
          if (!point) continue;
          tickWaypoints.push({
            x: Number(point.x),
            y: Number(point.y),
            floor: floorOr(point.floor ?? steeringTarget.floor ?? currentPoint.floor, currentPoint.floor),
            final: false,
          });
        }
      }
    }
    const lastWaypoint = tickWaypoints[tickWaypoints.length - 1];
    if (lastWaypoint && Math.hypot(lastWaypoint.x - movementTarget.x, lastWaypoint.y - movementTarget.y) <= 0.001) {
      lastWaypoint.final = true;
    } else if (canChainWaypoints && steeringIndex >= 0 && route?.targetAdjusted !== true) {
      // Pathfinder routes may end short of the exact final target; finish the chain there.
      tickWaypoints.push({
        x: Number(movementTarget.x),
        y: Number(movementTarget.y),
        floor: floorOr(movementTarget.floor ?? steeringTarget.floor ?? currentPoint.floor, currentPoint.floor),
        final: true,
      });
    }

    // Consume the tick step measured as EUCLIDEAN distance from the tick-start
    // position so consecutive snapshots keep constant displacement magnitude
    // through corners (matches 8590's frame-based mover as sampled per tick).
    // A path-distance budget caps hairpin traversal so agents cannot teleport
    // along doubled-back polylines.
    const startX = Number(currentPoint.x || 0);
    const startY = Number(currentPoint.y || 0);
    const maxPathBudget = step * 2;
    let pathConsumed = 0;
    let cursorX = startX;
    let cursorY = startY;
    let cursorFloor = currentPoint.floor;
    let waypointsConsumed = 0;
    const pushTickCollisionPoint = (floor = cursorFloor) => {
      const last = tickCollisionPath[tickCollisionPath.length - 1] || { x: startX, y: startY };
      if (Math.hypot(cursorX - last.x, cursorY - last.y) > 0.001) {
        tickCollisionPath.push({ x: cursorX, y: cursorY, floor: floorOr(floor, currentPoint.floor) });
      }
    };
    for (const waypoint of tickWaypoints) {
      const segDx = waypoint.x - cursorX;
      const segDy = waypoint.y - cursorY;
      const segDist = Math.hypot(segDx, segDy);
      if (segDist <= 0.001) {
        if (!waypoint.final) waypointsConsumed += 1;
        continue;
      }
      const endEuclid = Math.hypot(waypoint.x - startX, waypoint.y - startY);
      const pathBudgetLeft = maxPathBudget - pathConsumed;
      if (endEuclid <= step + 0.0001 && segDist <= pathBudgetLeft) {
        cursorX = waypoint.x;
        cursorY = waypoint.y;
        cursorFloor = floorOr(waypoint.floor ?? cursorFloor, cursorFloor);
        pushTickCollisionPoint(cursorFloor);
        pathConsumed += segDist;
        if (waypoint.final) break;
        waypointsConsumed += 1;
        continue;
      }
      // Find t in [0,1] along the segment where euclidean distance from the
      // tick-start position reaches the step radius (larger quadratic root =
      // forward crossing), clamped by the remaining path budget.
      let t = 1;
      if (endEuclid > step) {
        const fx = cursorX - startX;
        const fy = cursorY - startY;
        const a = segDx * segDx + segDy * segDy;
        const b = 2 * (fx * segDx + fy * segDy);
        const c = fx * fx + fy * fy - step * step;
        const disc = b * b - 4 * a * c;
        t = disc >= 0 && a > 0 ? Math.max(0, Math.min(1, (-b + Math.sqrt(disc)) / (2 * a))) : 1;
      }
      if (pathBudgetLeft < segDist * t) t = Math.max(0, pathBudgetLeft / segDist);
      cursorX += segDx * t;
      cursorY += segDy * t;
      cursorFloor = floorOr(waypoint.floor ?? cursorFloor, cursorFloor);
      pushTickCollisionPoint(cursorFloor);
      break;
    }
    if (steeringIndex >= 0 && waypointsConsumed > 0 && route && Array.isArray(route.routePoints)) {
      route.routeIndex = Math.min(route.routePoints.length - 1, steeringIndex + waypointsConsumed);
      if (route.routePoints[route.routeIndex]) {
        const advanced = route.routePoints[route.routeIndex];
        route.effectiveTarget = { ...movementTarget, x: Number(advanced.x), y: Number(advanced.y), floor: floorOr(advanced.floor ?? movementTarget.floor, movementTarget.floor) };
      }
    }
    tickWaypoints.length = 0;
    tickWaypoints.push({ x: cursorX, y: cursorY, floor: cursorFloor });
  }

  // M1.5b — smooth heading through turns: derive heading from the actual
  // per-tick displacement vector and clamp the per-tick heading change to a
  // max turn rate (~PI/2 per 250ms tick), except when starting from rest.
  const previousHeading = normalizeRuntimeAngleRadians(current?.heading, 0);
  const wasMoving = String(current?.state || '').toLowerCase() === 'routing';
  const maxTurnPerTick = (Math.PI / 2) * (Math.max(1, tickMs) / 250);
  const applyTurnRateLimit = (desiredHeading) => {
    const desired = normalizeRuntimeAngleRadians(desiredHeading, previousHeading);
    if (!wasMoving) return desired;
    let delta = desired - previousHeading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) <= maxTurnPerTick) return desired;
    return normalizeRuntimeAngleRadians(previousHeading + Math.sign(delta) * maxTurnPerTick, desired);
  };
  let nextX = arrived ? Number(arrivalPublishTarget.x) : tickWaypoints[0].x;
  let nextY = arrived ? Number(arrivalPublishTarget.y) : tickWaypoints[0].y;
  let nextFloorFallback = arrived
    ? floorOr(arrivalPublishTarget.floor ?? finalTarget.floor, finalTarget.floor)
    : floorOr(tickWaypoints[0]?.floor ?? steeringTarget.floor ?? currentPoint.floor, currentPoint.floor);
  let heading = distanceToSteering > 0.001
    ? applyTurnRateLimit(Math.atan2(dx, dy))
    : previousHeading;
  if (!arrived) {
    const tickDx = nextX - Number(currentPoint.x || 0);
    const tickDy = nextY - Number(currentPoint.y || 0);
    if (Math.hypot(tickDx, tickDy) > 0.001) {
      heading = applyTurnRateLimit(Math.atan2(tickDx, tickDy));
    }
  }
  let routePatch = arrivalRoutePatch || dynamicAvoidRoutePatch;
  const mergeRoutePatch = (patch) => {
    if (!patch) return;
    const existingCrowd = Array.isArray(routePatch?.crowdAvoidedAgents) ? routePatch.crowdAvoidedAgents : [];
    const nextCrowd = Array.isArray(patch.crowdAvoidedAgents) ? patch.crowdAvoidedAgents : [];
    routePatch = {
      ...(routePatch || {}),
      ...patch,
      ...(existingCrowd.length || nextCrowd.length ? { crowdAvoidedAgents: [...existingCrowd, ...nextCrowd].slice(0, 8) } : {}),
    };
  };
  if (!arrived) {
    const guardTargets = tickCollisionPath.length ? tickCollisionPath : [{ x: nextX, y: nextY }];
    let guardCurrent = { ...currentPoint };
    for (const guardTarget of guardTargets) {
      const segmentTarget = {
        x: Number(guardTarget.x),
        y: Number(guardTarget.y),
        floor: floorOr(guardTarget.floor ?? steeringTarget.floor ?? currentPoint.floor, currentPoint.floor),
        buildingId: movementTarget.buildingId || currentPoint.buildingId || '',
      };
      if (Math.hypot(segmentTarget.x - Number(guardCurrent.x || 0), segmentTarget.y - Number(guardCurrent.y || 0)) <= 0.001) {
        guardCurrent = { ...guardCurrent, ...segmentTarget };
        continue;
      }
      const guarded = applyServerRuntimeCollisionGuards(dataDir, agentId, guardCurrent, segmentTarget, {
        phase,
        route,
        crowdAgents,
        tickMs,
        speedUnitsPerSec,
        finalTarget: movementTarget,
        arrivalRadius: arrival,
        routeTarget: target,
      });
      if (!guarded?.point) break;
      nextX = Number(guarded.point.x);
      nextY = Number(guarded.point.y ?? guarded.point.z);
      nextFloorFallback = floorOr(guarded.point.floor ?? segmentTarget.floor, segmentTarget.floor);
      mergeRoutePatch(guarded.routePatch || null);
      const reachedSegmentTarget = Math.hypot(nextX - segmentTarget.x, nextY - segmentTarget.y) <= 0.001;
      guardCurrent = {
        ...guardCurrent,
        x: nextX,
        y: nextY,
        floor: segmentTarget.floor,
        buildingId: segmentTarget.buildingId,
      };
      if (guarded.blocked || guarded.adjusted || !reachedSegmentTarget) {
        break;
      }
    }
    const guardedDx = nextX - Number(currentPoint.x || 0);
    const guardedDy = nextY - Number(currentPoint.y || 0);
    if (Math.hypot(guardedDx, guardedDy) > 0.001) {
      heading = applyTurnRateLimit(Math.atan2(guardedDx, guardedDy));
    }
  }
  const nextLocation = serverRuntimeLocationAtPoint(dataDir, nextX, nextY, arrived ? finalTarget : movementTarget, {
    arrived,
    fallbackFloor: nextFloorFallback,
  });
  return {
    x: nextX,
    y: nextY,
    floor: nextLocation.floor,
    buildingId: nextLocation.buildingId,
    roomId: nextLocation.roomId,
    heading,
    arrived,
    distanceToFinal,
    distanceToSteering,
    steeringTarget,
    finalTarget,
    route: route ? {
      ...route,
      ...(routeApproachTarget ? { routeApproachTarget, dockFinalTarget: finalTarget } : {}),
      ...(routePatch || {}),
      routeSource,
      phase,
    } : null,
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

function stableUnitFloat(seed = '') {
  return (stableTextHash(String(seed || '')) % 1_000_000) / 1_000_000;
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
  if (String(local?.poseKind || '').toLowerCase() === 'seat') {
    return runtimeFacingAngle(building, furniture, local?.x, local?.z, local?.facing || 'north');
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

export function pickLiveStatusWorkTarget(agentId, { meta, targets, workingAgentIds, claimedTargetIndexes = null }) {
  if (!agentId || !Array.isArray(targets) || targets.length === 0) return null;
  const assigned = targets.find(entry => liveStatusIdentityMatches(agentId, entry.assignedTo));
  if (assigned) {
    claimedTargetIndexes?.add(targets.indexOf(assigned));
    return assigned.target;
  }

  const assignment = agentAssignmentFor(meta, agentId);
  const workBuildingId = safeText(assignment.work || assignment.workBuilding || assignment.workBuildingId, '');
  let candidates = targets.filter(entry => !entry.assignedTo);
  if (claimedTargetIndexes) {
    candidates = candidates.filter(entry => !claimedTargetIndexes.has(targets.indexOf(entry)));
  }
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
  if (candidates.length === 0) {
    // With distinct claiming, no free desk means deskless fallback (8590
    // parity: work-presence agents without a desk keep waiting/wandering
    // near work instead of doubling up on an occupied desk).
    if (claimedTargetIndexes) return null;
    candidates = targets;
  }
  if (candidates.length === 0) return null;
  const sortedWorkers = Array.isArray(workingAgentIds) ? workingAgentIds : [];
  const workerIndex = sortedWorkers.indexOf(agentId);
  const index = workerIndex >= 0 ? workerIndex : stableTextHash(agentId);
  const picked = candidates[index % candidates.length];
  if (picked && claimedTargetIndexes) claimedTargetIndexes.add(targets.indexOf(picked));
  return picked?.target || null;
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

export function buildLiveStatusRuntimePlan(dataDir) {
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
  const meetingAgentIds = Array.from(explicitMeetingAgentIds)
    .filter(Boolean)
    // Live-mode agents also skip scripted meeting-table seating; visible
    // meetings for them must come from Live Mode world actions instead.
    .filter(agentId => !isAgentLiveModeEnabledForServer(meta, agentId, presence?.[agentId] || null))
    .sort();
  const workingAgentIds = Object.entries(presence)
    .filter(([agentId, record]) => agentId && !agentId.startsWith('_') && isLiveStatusWorking(record) && !explicitMeetingAgentIds.has(agentId)
      // Layer separation: live-mode agents are never desk-routed by the
      // scripted live-status layer, even while their presence says "working"
      // (e.g. during model inference). Live Mode owns their bodies.
      && !isAgentLiveModeEnabledForServer(meta, agentId, record))
    .map(([agentId]) => safeText(agentId, ''))
    .filter(Boolean)
    .sort();
  const targetsByAgent = {};
  for (const agentId of meetingAgentIds) {
    const target = pickLiveStatusMeetingTarget(agentId, { presence, targets: meetingTargets, meetingAgentIds });
    if (target) targetsByAgent[agentId] = target;
  }
  const claimedTargetIndexes = new Set();
  for (const agentId of workingAgentIds) {
    const target = pickLiveStatusWorkTarget(agentId, { meta, targets: workTargets, workingAgentIds, claimedTargetIndexes });
    if (target) targetsByAgent[agentId] = target;
  }
  const desklessWorkingAgentIds = workingAgentIds.filter(agentId => !targetsByAgent[agentId]);
  return { presence, meta, targets: workTargets, workTargets, meetingTargets, workingAgentIds, meetingAgentIds, targetsByAgent, desklessWorkingAgentIds };
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
const SERVER_SCRIPTED_RUNTIME_OCCUPIED_STATES = new Set(['routing', 'working', 'using', 'active', 'arrived', 'in_progress', 'waiting', 'queued', 'meeting']);
const SERVER_SCRIPTED_SEAT_OBJECT_TYPES = new Set([
  'chair',
  'officechair',
  'conferencechair',
  'barberchair',
  'couch',
  'sectionalsofa',
  'loveseat',
  'armchair',
  'parkbench',
  'hallwaybench',
  'barstool',
  'diningchair',
  'patiochair',
  'bed',
  'clinicbed',
  'examchair',
  'smallcafetable',
  'outdoorcafetable',
  'picnictable',
  'smallroundmeetingtable',
  'meetingtable',
  'gamingstation',
  'playgroundswing',
  'busstop',
]);
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
  pingpong: Object.freeze({ kind: 'pingpong-play', spotId: 'player-left', animationId: 'play-pingpong', poseKind: 'stand-use', stayMs: [24000, 24000] }),
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
  fountain: Object.freeze({ kind: 'fountain-watch', spotId: 'watch-south', animationId: 'fountain-watch', poseKind: 'stand-use', stayMs: [10000, 18000] }),
  gazebopavilion: Object.freeze({ kind: 'gazebo-pavilion-rest', spotId: 'rest-west', animationId: 'gazebo-pavilion-rest', poseKind: 'stand-use', stayMs: [12000, 22000] }),
  busstop: Object.freeze({ kind: 'bus-stop-wait', spotId: 'seat-left', animationId: 'bus-stop-wait', poseKind: 'seat', stayMs: [10000, 18000] }),
  foodtruckcounter: Object.freeze({ kind: 'food-truck-counter-order', spotId: 'customer', animationId: 'food-truck-counter-serve', poseKind: 'stand-use', stayMs: [9000, 15000] }),
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

function claimedLiveStatusWorkTargetIndexesFromRuntime(state = null, workTargets = [], agentId = '') {
  const claimed = new Set();
  if (!state?.agents?.entries || !Array.isArray(workTargets) || workTargets.length === 0) return claimed;
  for (const [otherId, record] of state.agents.entries()) {
    if (String(otherId || '') === String(agentId || '')) continue;
    const plain = snapshotToPlain(record);
    const target = plain.target && typeof plain.target === 'object' ? plain.target : null;
    if (!target) continue;
    const stateKey = String(plain.state || '').toLowerCase();
    if (!['routing', 'working', 'using', 'active', 'arrived', 'in_progress', 'waiting', 'queued', 'meeting'].includes(stateKey)) continue;
    const isTemporaryConsumeClaim = isServerScriptedObjectDeskConsumeTarget(target) ||
      Boolean(target.sourceObjectKey || String(target.objectKey || '').includes(':consume:'));
    if (!isTemporaryConsumeClaim) continue;
    const claimedKey = safeText(target.baseObjectKey, '') || liveStatusRuntimeObjectKey(target);
    if (!claimedKey) continue;
    const index = workTargets.findIndex(entry => liveStatusRuntimeObjectKey(entry?.target) === claimedKey);
    if (index >= 0) claimed.add(index);
  }
  return claimed;
}

export function makeServerScriptedDeskConsumeTarget(dataDir, agentId, sourceTarget = null, nowMs = Date.now(), runtimeState = null) {
  const spec = serverScriptedObjectDispenseSpec(sourceTarget);
  if (!spec) return null;
  const meta = readWorldMetaDocument(dataDir);
  const workTargets = listLiveStatusWorkTargets(dataDir);
  if (!workTargets.length) return null;
  const claimedTargetIndexes = claimedLiveStatusWorkTargetIndexesFromRuntime(runtimeState, workTargets, agentId);
  const claimedByOtherAgentIndexes = new Set(claimedTargetIndexes);
  const hasRuntimeClaimContext = Boolean(runtimeState?.agents?.entries);
  const runtimeAgentIds = runtimeState?.agents?.keys
    ? Array.from(runtimeState.agents.keys()).map(id => safeText(id, '')).filter(Boolean).sort()
    : [agentId];
  let deskTarget = pickLiveStatusWorkTarget(agentId, {
    meta,
    targets: workTargets,
    workingAgentIds: runtimeAgentIds.length ? runtimeAgentIds : [agentId],
    claimedTargetIndexes,
  });
  if (deskTarget) {
    const pickedIndex = workTargets.findIndex(entry => liveStatusRuntimeObjectKey(entry?.target) === liveStatusRuntimeObjectKey(deskTarget));
    if (pickedIndex >= 0 && claimedByOtherAgentIndexes.has(pickedIndex)) deskTarget = null;
  }
  const isClaimed = (entry) => claimedTargetIndexes.has(workTargets.indexOf(entry));
  if (!deskTarget && sourceTarget?.buildingId) {
    deskTarget = workTargets.find(entry => entry.buildingId === sourceTarget.buildingId && !isClaimed(entry))?.target || null;
  }
  if (!deskTarget) deskTarget = workTargets.find(entry => !isClaimed(entry))?.target || null;
  if (!deskTarget && !hasRuntimeClaimContext && workTargets[0]) {
    const fallbackIndex = stableTextHash(`${agentId}:desk-consume`) % workTargets.length;
    deskTarget = workTargets[fallbackIndex]?.target || workTargets[0].target;
  }
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

const SERVER_SCRIPTED_FREE_CONSUME_SEAT_TYPES = new Set([
  'chair',
  'couch',
  'sectionalsofa',
  'loveseat',
  'armchair',
  'parkbench',
]);

// Live Agent Mode: agents are free to consume dispensed items (coffee, water,
// snacks, microwaved food) at any available seat they like — a couch, armchair,
// park bench, or chair — instead of being scripted back to a work desk. Queue
// order at the dispenser is still enforced upstream; only the consume location
// becomes a free choice. Scripted (non-live) agents keep the desk routine.
export function makeServerScriptedFreeConsumeTarget(dataDir, agentId, sourceTarget = null, nowMs = Date.now(), runtimeState = null) {
  const spec = serverScriptedObjectDispenseSpec(sourceTarget);
  if (!spec) return null;
  const meta = readWorldMetaDocument(dataDir);
  if (!isAgentLiveModeEnabledForServer(meta, agentId)) return null;
  let seats = [];
  try {
    seats = listScriptedObjectRuntimeTargets(dataDir).filter(target =>
      String(target?.poseKind || '').toLowerCase() === 'seat' &&
      !target?.isQueueUse &&
      SERVER_SCRIPTED_FREE_CONSUME_SEAT_TYPES.has(String(target?.objectType || '').trim().toLowerCase()) &&
      isServerScriptedObjectTargetAvailable(runtimeState, target, agentId, nowMs, dataDir));
  } catch {
    seats = [];
  }
  if (!seats.length) return null;
  const current = runtimeState?.agents?.get?.(agentId);
  const cx = numberOr(current?.x, numberOr(sourceTarget?.x, 0));
  const cy = numberOr(current?.y, numberOr(sourceTarget?.y, 0));
  const ranked = seats
    .map(seat => ({ seat, dist: Math.hypot(numberOr(seat.x, 0) - cx, numberOr(seat.y, 0) - cy) }))
    .sort((a, b) => a.dist - b.dist);
  const pool = ranked.slice(0, Math.min(5, ranked.length));
  const pick = pool[stableTextHash(`${agentId}:free-consume:${Math.floor(nowMs / 8192)}`) % pool.length]?.seat;
  if (!pick || !Number.isFinite(Number(pick.x)) || !Number.isFinite(Number(pick.y))) return null;
  const temporaryItem = makeServerScriptedTemporaryItem(agentId, sourceTarget, spec, nowMs);
  const consumeDurationMs = Math.max(1000, Math.floor(numberOr(sourceTarget?.consumeDurationMs ?? sourceTarget?.deskConsumeMs, SERVER_SCRIPTED_OBJECT_DESK_CONSUME_MS)));
  const baseObjectKey = safeText(pick.baseObjectKey, '') || pick.objectKey;
  return {
    ...pick,
    targetKind: 'free-consume-seat',
    objectKey: normalizeWorldObjectKey(`${baseObjectKey}:consume:${safeText(agentId, 'agent') || 'agent'}`),
    baseObjectKey,
    behaviorCategory: 'live-free-consume',
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
    freeConsumeSeat: true,
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
  play: Object.freeze(['poolTable', 'arcadeMachine', 'gamingStation', 'treadmill', 'trainingMat', 'gymBench', 'dumbbellRack']),
});
const SERVER_SCRIPTED_IDLE_SOCIAL_OBJECT_TYPES = new Set([
  ...SERVER_SCRIPTED_IDLE_CATEGORY_OBJECT_TYPES.rest,
  'meetingTable',
  'conferenceChair',
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

function idleRuntimeOwnershipForAgent(meta, agentId) {
  return isAgentLiveModeEnabledForServer(meta, agentId)
    ? { mode: 'live', owner: 'agent-live-mode' }
    : { mode: 'scripted', owner: 'agent-scripted-mode' };
}

// Behavior layer contract (bottom to top):
//   Layer 1: scripted/idle/ambient presence theater (live-status desk runtime,
//            scripted object runtime, deskless wander).
//   Layer 2: Agent Live Mode — the agent's own loop/model owns the body.
//   Layer 3: direct user-agent interaction (handled upstream via preemption).
// Layer 1 must NEVER claim an agent that is enabled for Layer 2 in THIS world.
// A live-mode agent whose gateway presence flips to "working" (e.g. while its
// model runs inference) must not be desk-routed by the scripted layer; Live
// Mode decides where the body goes. A configured Ambient preference is kept
// for Default Mode, but it is never an opt-in to concurrent scripted body
// control while Live Mode is active.
function isAgentScriptedLayerAllowedForServer(meta, agentId, presenceRecord = null) {
  return !isAgentLiveModeEnabledForServer(meta, agentId, presenceRecord);
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

function isPingPongObjectType(objectType = '') {
  const key = normalizeObjectTypeKey(objectType);
  return key === 'pingpong' || key === 'pingpongtable';
}

function isServerScriptedMultiSlotPlayObjectType(objectType = '') {
  return normalizeObjectTypeKey(objectType) === 'pingpong';
}

function isServerScriptedMultiSlotPlaySpot(objectType = '', spotId = '', actionId = '') {
  if (!isServerScriptedMultiSlotPlayObjectType(objectType)) return false;
  const spot = String(spotId || '').trim().toLowerCase();
  const action = String(actionId || '').trim().toLowerCase();
  return action === 'life.playpingpong' && (spot === 'player-left' || spot === 'player-right');
}

function isServerScriptedMultiSlotPlayTarget(target = null) {
  if (!target || target.isQueueUse) return false;
  return isServerScriptedMultiSlotPlaySpot(
    target.objectType || target.catalogKey || target.sourceObjectType || '',
    target.slotId || target.spotId || target.interactionSpotId || '',
    target.actionId || '',
  );
}

function serverScriptedMultiSlotObjectKey(baseObjectKey = '', slotId = '') {
  const base = safeText(baseObjectKey, '');
  const slot = safeText(slotId, '');
  return base && slot ? normalizeWorldObjectKey(`${base}:slot:${slot}`) : base;
}

function serverScriptedPingPongSide(target = null) {
  if (!isServerScriptedMultiSlotPlayTarget(target)) return '';
  const explicit = String(target?.pingPongSide || target?.side || '').trim().toLowerCase();
  if (explicit === 'left' || explicit === 'right') return explicit;
  const slot = String(target?.slotId || target?.spotId || target?.interactionSpotId || '').trim().toLowerCase();
  if (slot.includes('right')) return 'right';
  if (slot.includes('left')) return 'left';
  return '';
}

function serverScriptedPingPongOppositeSide(side = '') {
  return side === 'left' ? 'right' : (side === 'right' ? 'left' : '');
}

function findServerScriptedPingPongPartnerTarget(targets = [], target = null) {
  if (!isServerScriptedMultiSlotPlayTarget(target)) return null;
  const baseObjectKey = safeText(target?.baseObjectKey || target?.objectKey, '');
  const oppositeSide = serverScriptedPingPongOppositeSide(serverScriptedPingPongSide(target));
  if (!baseObjectKey || !oppositeSide) return null;
  return (Array.isArray(targets) ? targets : []).find(candidate =>
    candidate !== target &&
    isServerScriptedMultiSlotPlayTarget(candidate) &&
    safeText(candidate.baseObjectKey || candidate.objectKey, '') === baseObjectKey &&
    serverScriptedPingPongSide(candidate) === oppositeSide
  ) || null;
}

function serverScriptedPingPongPaddleColor(side = '') {
  return side === 'right' ? 0x2196f3 : 0xf44336;
}

function makeServerScriptedPingPongRacketItem(target = null, side = '') {
  const objectKey = safeText(target?.objectKey, 'pingpong') || 'pingpong';
  const color = numberOr(target?.paddleColor, serverScriptedPingPongPaddleColor(side));
  return {
    id: `pingpong-racket-${side || 'player'}-${stableTextHash(objectKey)}`,
    catalogId: 'temporaryGameEquipment',
    label: 'Ping Pong Racket',
    kind: 'pingpong-racket',
    attachPoint: 'right-hand',
    state: 'carried',
    color,
    sourceFurnitureType: 'pingpong',
    temporaryUse: {
      state: 'carried',
      persistence: { mode: 'omit-on-save', omitOnSave: true, owner: 'pingpong-runtime' },
    },
    temporary: true,
    carryable: true,
  };
}

function serverPingPongObjectKey(buildingId, furnitureIndex) {
  return normalizeWorldObjectKey(runtimeFurnitureObjectKey(buildingId, furnitureIndex, 'pingpong'));
}

function serverPingPongPointFromTable(tableTarget, side = 'left', trackZ = 0) {
  const building = tableTarget?.building || null;
  const furniture = tableTarget?.furniture || null;
  if (!building || !furniture) return null;
  const sideKey = side === 'right' ? 'right' : 'left';
  const dx = sideKey === 'right' ? 1.82 : -1.82;
  const dz = Math.max(-0.42, Math.min(0.42, numberOr(trackZ, 0)));
  const offset = rotateRuntimeLocalOffset(dx, dz, furniture.rotation || 0);
  const localX = numberOr(furniture.x, 0) + offset.x;
  const localZ = numberOr(furniture.z, 0) + offset.z;
  const point = apiPointFromBuildingLocal(building, localX, localZ);
  if (!point) return null;
  return {
    x: point.x,
    y: point.y,
    floor: floorOr(furniture.floor ?? tableTarget.floor, 1),
    buildingId: safeText(building.id, ''),
    roomId: safeText(furniture.room, ''),
    furnitureIndex: tableTarget.furnitureIndex,
    objectKey: tableTarget.objectKey,
    objectType: 'pingpong',
    actionId: 'life.playPingPong',
    side: sideKey,
    slotId: sideKey === 'right' ? 'player-right' : 'player-left',
    spotId: sideKey === 'right' ? 'player-right' : 'player-left',
    faceAngle: runtimeFacingAngle(building, furniture, localX, localZ, sideKey === 'right' ? 'west' : 'east'),
  };
}

function serverPingPongReleasePointFromTable(tableTarget, side = 'left', seed = '') {
  const building = tableTarget?.building || null;
  const furniture = tableTarget?.furniture || null;
  if (!building || !furniture) return serverPingPongPointFromTable(tableTarget, side, 0);
  const sideKey = side === 'right' ? 'right' : 'left';
  const lateral = stableTextHash(`${seed}:${sideKey}:release`) % 2 === 0 ? 0.72 : -0.72;
  const dx = sideKey === 'right' ? 2.55 : -2.55;
  const offset = rotateRuntimeLocalOffset(dx, lateral, furniture.rotation || 0);
  const localX = numberOr(furniture.x, 0) + offset.x;
  const localZ = numberOr(furniture.z, 0) + offset.z;
  const point = apiPointFromBuildingLocal(building, localX, localZ);
  if (!point) return serverPingPongPointFromTable(tableTarget, side, 0);
  return {
    x: point.x,
    y: point.y,
    floor: floorOr(furniture.floor ?? tableTarget.floor, 1),
    buildingId: safeText(building.id, ''),
    roomId: safeText(furniture.room, ''),
    heading: runtimeFacingAngle(building, furniture, localX, localZ, lateral >= 0 ? 'north' : 'south'),
  };
}

function listServerPingPongTableTargets(dataDir) {
  const tables = [];
  for (const building of listBuildingDocuments(dataDir)) {
    const furniture = Array.isArray(building?.interior?.furniture) ? building.interior.furniture : [];
    for (let index = 0; index < furniture.length; index += 1) {
      const item = furniture[index];
      if (!item || item.deleted || item.removed || item.enabled === false || !isPingPongObjectType(item.type)) continue;
      const objectKey = serverPingPongObjectKey(building.id || 'building', index);
      const tableTarget = {
        building,
        furniture: item,
        buildingId: safeText(building.id, ''),
        roomId: safeText(item.room, ''),
        furnitureIndex: index,
        objectKey,
        baseObjectKey: objectKey,
        objectType: 'pingpong',
        floor: floorOr(item.floor, 1),
      };
      const left = serverPingPongPointFromTable(tableTarget, 'left', 0);
      const right = serverPingPongPointFromTable(tableTarget, 'right', 0);
      if (left && right) tables.push({ ...tableTarget, left, right });
    }
  }
  return tables;
}

function resetServerPingPongBallForServe(match) {
  if (!match) return;
  const server = match.nextServe === 'p2' ? 'p2' : 'p1';
  match.ballX = server === 'p1' ? -0.72 : 0.72;
  match.ballZ = (Math.random() - 0.5) * 0.12;
  match.ballVX = (server === 'p1' ? 1 : -1) * (0.52 + Math.random() * 0.08);
  match.ballVZ = (Math.random() - 0.5) * 0.18;
  match.rallyHits = 0;
  match.pointTimerMs = 0;
  match.lastHit = '';
  match.servePauseMs = 900;
  match.servingPlayer = server;
}

function makeServerPingPongMatch(tableTarget, p1Id, p2Id, nowMs = Date.now(), source = 'idle') {
  const objectKey = tableTarget.objectKey;
  const matchId = safeText(`server-pingpong:${objectKey}:${nowMs}`, `server-pingpong:${nowMs}`) || `server-pingpong:${nowMs}`;
  const match = {
    matchId,
    objectKey,
    buildingId: tableTarget.buildingId,
    roomId: tableTarget.roomId,
    furnitureIndex: tableTarget.furnitureIndex,
    p1Id,
    p2Id,
    p1Score: 0,
    p2Score: 0,
    p1TrackZ: 0,
    p2TrackZ: 0,
    p1Skill: 0.58 + stableUnitFloat(`${matchId}:${p1Id}:skill`) * 0.30,
    p2Skill: 0.58 + stableUnitFloat(`${matchId}:${p2Id}:skill`) * 0.30,
    p1SwingPulseId: 0,
    p2SwingPulseId: 0,
    phase: 'approach',
    startedAtMs: nowMs,
    phaseStartedAtMs: nowMs,
    activeAtMs: 0,
    pointTimerMs: 0,
    targetScore: SERVER_PINGPONG_RUNTIME_TARGET_SCORE,
    nextServe: stableTextHash(matchId) % 2 === 0 ? 'p1' : 'p2',
    servePauseMs: 900,
    servingPlayer: null,
    source,
    lastPoint: null,
    lastHit: '',
  };
  resetServerPingPongBallForServe(match);
  return match;
}

function serverPingPongGameForClient(match = null) {
  if (!match) return null;
  const rawLastPoint = match.lastPoint && typeof match.lastPoint === 'object' ? match.lastPoint : null;
  const lastPointAtMs = Number(rawLastPoint?.atMs || 0);
  const lastPoint = rawLastPoint ? {
    winner: rawLastPoint.winner === 'p2' ? 'p2' : 'p1',
    loser: rawLastPoint.loser === 'p1' ? 'p1' : 'p2',
    reason: safeText(rawLastPoint.reason, ''),
    at: Number.isFinite(lastPointAtMs) && lastPointAtMs > 0 ? new Date(lastPointAtMs).toISOString() : '',
  } : null;
  return {
    phase: match.phase,
    timer: Math.max(0, (Date.now() - Number(match.phaseStartedAtMs || match.startedAtMs || Date.now())) / 1000),
    pointTimer: Math.max(0, Number(match.pointTimerMs || 0) / 1000),
    targetScore: SERVER_PINGPONG_RUNTIME_TARGET_SCORE,
    p1Id: safeText(match.p1Id, ''),
    p2Id: safeText(match.p2Id, ''),
    p1Score: Math.max(0, Math.floor(numberOr(match.p1Score, 0))),
    p2Score: Math.max(0, Math.floor(numberOr(match.p2Score, 0))),
    rallyHits: Math.max(0, Math.floor(numberOr(match.rallyHits, 0))),
    ballX: numberOr(match.ballX, 0),
    ballZ: numberOr(match.ballZ, 0),
    ballVX: numberOr(match.ballVX, 0),
    ballVZ: numberOr(match.ballVZ, 0),
    p1TrackZ: numberOr(match.p1TrackZ, 0),
    p2TrackZ: numberOr(match.p2TrackZ, 0),
    nextServe: match.nextServe === 'p2' ? 'p2' : 'p1',
    servePauseMs: Math.max(0, numberOr(match.servePauseMs, 0)),
    servingPlayer: safeText(match.servingPlayer, ''),
    lastHit: safeText(match.lastHit, ''),
    lastPoint,
    source: SERVER_PINGPONG_RUNTIME_OWNER,
  };
}

function makeServerPingPongTarget(tableTarget, side, agentId, partnerAgentId, match, point = null, now = new Date().toISOString()) {
  const sideKey = side === 'right' ? 'right' : 'left';
  const targetPoint = point || serverPingPongPointFromTable(tableTarget, sideKey, 0);
  if (!targetPoint) return null;
  return {
    x: targetPoint.x,
    y: targetPoint.y,
    floor: targetPoint.floor,
    buildingId: tableTarget.buildingId,
    roomId: tableTarget.roomId,
    targetKind: 'server-pingpong-player',
    objectKey: tableTarget.objectKey,
    baseObjectKey: tableTarget.objectKey,
    objectInstanceId: tableTarget.objectKey,
    furnitureIndex: tableTarget.furnitureIndex,
    objectType: 'pingpong',
    behaviorCategory: 'play',
    runtimeCategory: 'play',
    actionId: 'life.playPingPong',
    interactionSpotId: targetPoint.spotId,
    spotId: targetPoint.spotId,
    slotId: targetPoint.slotId,
    activeUseSlotId: targetPoint.slotId,
    poseKind: 'stand-use',
    animationId: 'play-pingpong',
    activityKind: `pingpong-${sideKey}`,
    stayMs: SERVER_PINGPONG_RUNTIME_MATCH_MS,
    faceAngle: normalizeRuntimeAngleRadians(targetPoint.faceAngle, 0),
    matchId: match.matchId,
    side: sideKey,
    agentId,
    partnerAgentId,
    runtimeSource: match.source || 'idle',
    runtimeStartedAt: now,
    runtimeActiveAt: match.activeAtMs ? new Date(match.activeAtMs).toISOString() : '',
  };
}

function makeServerPingPongVisualState(isMoving, target, match = null, nowMs = Date.now()) {
  const side = target?.side === 'right' ? 'right' : 'left';
  const playerKey = side === 'right' ? 'p2' : 'p1';
  const trackZ = playerKey === 'p1' ? numberOr(match?.p1TrackZ, 0) : numberOr(match?.p2TrackZ, 0);
  const phase = String(match?.phase || '');
  const playing = !isMoving && !!match && phase === 'playing';
  const resultHold = !isMoving && !!match && phase === 'result';
  const animationId = isMoving ? 'walk' : (playing ? 'play-pingpong' : 'idle');
  return {
    schemaVersion: 'agent-runtime-visual/v1',
    status: 'idle',
    state: isMoving ? 'moving' : 'idle',
    resolvedAnimationId: animationId,
    movement: { isMoving, isRunning: false, suppressLocomotion: playing || resultHold },
    activityActive: Boolean(target) && !resultHold,
    activityKind: target?.activityKind || `pingpong-${side}`,
    activity: {
      kind: target?.activityKind || `pingpong-${side}`,
      phase: isMoving ? 'routing' : (playing ? 'active' : (resultHold ? 'complete' : 'ready')),
      source: SERVER_PINGPONG_RUNTIME_OWNER,
      objectKey: target?.objectKey || '',
      baseObjectKey: target?.baseObjectKey || target?.objectKey || '',
      objectType: 'pingpong',
      behaviorCategory: 'play',
      actionId: 'life.playPingPong',
      spotId: target?.spotId || target?.interactionSpotId || '',
      slotId: target?.slotId || target?.activeUseSlotId || '',
      activeUseSlotId: target?.activeUseSlotId || target?.slotId || '',
      poseKind: 'stand-use',
      animationId,
      faceAngle: numberOr(target?.faceAngle, 0),
      matchId: match?.matchId || target?.matchId || '',
      partnerAgentId: target?.partnerAgentId || '',
      runtimeOwner: SERVER_PINGPONG_RUNTIME_OWNER,
    },
    carrying: playing,
    carriedItem: playing ? {
      kind: 'pingpong-racket',
      label: 'Ping Pong Racket',
      temporary: true,
      runtimeVisualOnly: true,
    } : null,
    pingPong: playing ? {
      matchId: match.matchId,
      side,
      trackZ,
      ballZ: numberOr(match.ballZ, 0),
      ballX: numberOr(match.ballX, 0),
      lastHit: safeText(match.lastHit, ''),
      swingPulseId: playerKey === 'p1' ? Math.max(0, Math.floor(numberOr(match.p1SwingPulseId, 0))) : Math.max(0, Math.floor(numberOr(match.p2SwingPulseId, 0))),
    } : null,
  };
}

function makeServerPingPongObjectData(match, tableTarget, state, now, expiresAt) {
  const game = serverPingPongGameForClient(match);
  const p1Id = safeText(match?.p1Id, '');
  const p2Id = safeText(match?.p2Id, '');
  const reservationId = safeText(`server-pingpong-res:${match?.objectKey || tableTarget?.objectKey || 'table'}`, '') || `server-pingpong-res:${Date.now()}`;
  const activeUseId = safeText(`server-pingpong-active:${match?.objectKey || tableTarget?.objectKey || 'table'}`, '') || `server-pingpong-active:${Date.now()}`;
  const activeSlots = {
    'player-left': { agentId: p1Id, reservationId, activeUseId, actionId: 'life.playPingPong', interactionSpotId: 'player-left', spotId: 'player-left', side: 'left' },
    'player-right': { agentId: p2Id, reservationId, activeUseId, actionId: 'life.playPingPong', interactionSpotId: 'player-right', spotId: 'player-right', side: 'right' },
  };
  if (state === 'idle' || state === 'cooldown') {
    return {
      clearReservation: true,
      activeUse: {
        state,
        mode: 'match-complete',
        lastScore: game ? `${game.p1Score || 0}-${game.p2Score || 0}` : null,
        runtimeWorldObject: true,
        runtimeOwner: SERVER_PINGPONG_RUNTIME_OWNER,
      },
      pingPongGame: null,
      writer: 'agent-runtime-room.mjs#serverPingPongRuntime',
    };
  }
  return {
    reservation: {
      id: reservationId,
      reservationId,
      objectKey: match.objectKey,
      agentIds: [p1Id, p2Id].filter(Boolean),
      actionId: 'life.playPingPong',
      spotIds: ['player-left', 'player-right'],
      slotIds: ['player-left', 'player-right'],
      status: state === 'routing' ? 'held' : 'active',
      state,
      reservedAt: new Date(match.startedAtMs || Date.now()).toISOString(),
      expiresAt,
      runtimeWorldObject: true,
      runtimeOwner: SERVER_PINGPONG_RUNTIME_OWNER,
    },
    activeUse: {
      id: activeUseId,
      activeUseId,
      objectKey: match.objectKey,
      state: state === 'routing' ? 'approach' : (match.phase === 'result' ? 'result' : 'playing'),
      mode: 'match',
      actionId: 'life.playPingPong',
      agentIds: [p1Id, p2Id].filter(Boolean),
      activeSlots,
      source: SERVER_PINGPONG_RUNTIME_OWNER,
      startedAt: new Date(match.startedAtMs || Date.now()).toISOString(),
      activeAt: match.activeAtMs ? new Date(match.activeAtMs).toISOString() : '',
      lastScore: game ? `${game.p1Score || 0}-${game.p2Score || 0}` : '0-0',
      lastPoint: game?.lastPoint?.reason || '',
      runtimeWorldObject: true,
      runtimeOwner: SERVER_PINGPONG_RUNTIME_OWNER,
    },
    pingPongGame: game,
    writer: 'agent-runtime-room.mjs#serverPingPongRuntime',
  };
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
    String(location?.capacity?.kind || '').toLowerCase() === 'queue' ||
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

function isScriptedObjectArmchairRouteOnlySpot(furniture = null, location = null) {
  if (String(furniture?.type || '').trim().toLowerCase() !== 'armchair' || !location) return false;
  const roles = scriptedObjectRoles(location);
  if (roles.some(role => ['seat', 'use', 'rest', 'social', 'service', 'work'].includes(role))) return false;
  const spotId = String(scriptedObjectSpotId(location) || '').toLowerCase();
  return (
    ['approach-front', 'stand-front'].includes(spotId) ||
    roles.some(role => ['approach', 'staging', 'dismount', 'exit', 'stand'].includes(role))
  );
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
  const rawCapacity = typeof queueDef?.capacity === 'number' ? queueDef.capacity : Number(queueDef?.capacity?.maxAgents || 0);
  const capacity = Number.isFinite(rawCapacity) && rawCapacity > 0 ? rawCapacity : undefined;
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
  if (isScriptedObjectArmchairRouteOnlySpot(furniture, location)) return false;
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
  const roles = scriptedObjectRoles(location);
  const fallback = scriptedObjectFallbackOffset(furniture);
  const config = scriptedObjectActivityConfig(furniture);
  const isQueue = isScriptedObjectQueueSpot(location, furniture);
  const spotId = String(scriptedObjectSpotId(location) || '').toLowerCase();
  const activationTarget = location?.activationTarget && typeof location.activationTarget === 'object' ? location.activationTarget : null;
  const useActivationTarget = Boolean(
    activationTarget &&
    !isQueue &&
    (
      roles.includes('seat') ||
      config?.poseKind === 'seat' ||
      spotId.includes('seat') ||
      String(location?.dockMode || '').toLowerCase() === 'snap-to-activation'
    )
  );
  const explicit = (useActivationTarget ? activationTarget : null) || location?.actionTarget || location?.buildingLocal || activationTarget || null;
  const x = numberOr(explicit?.x, NaN);
  const z = numberOr(explicit?.z, NaN);
  const faceAngle = authoredRuntimeFaceAngle(location, explicit);
  if (Number.isFinite(x) && Number.isFinite(z)) {
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

function localPointFromScriptedObjectRouteApproachSpot(furniture = null, location = null, finalLocal = null) {
  if (!location || finalLocal?.poseKind !== 'seat') return null;
  const actionTarget = location?.actionTarget && typeof location.actionTarget === 'object' ? location.actionTarget : null;
  const activationTarget = location?.activationTarget && typeof location.activationTarget === 'object' ? location.activationTarget : null;
  if (!actionTarget || !activationTarget) return null;
  const approachSpotId = safeText(
    actionTarget.spotId ||
    actionTarget.interactionSpotId ||
    location.approachSpotId ||
    '',
    '',
  );
  const activationSpotId = safeText(
    activationTarget.spotId ||
    activationTarget.interactionSpotId ||
    location.activationSpotId ||
    location.id ||
    '',
    '',
  );
  if (!approachSpotId || approachSpotId === activationSpotId || approachSpotId === scriptedObjectSpotId(location)) return null;
  const x = numberOr(actionTarget.x, NaN);
  const z = numberOr(actionTarget.z, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.hypot(x - numberOr(finalLocal.x, x), z - numberOr(finalLocal.z, z)) <= 0.01) return null;
  return {
    x,
    z,
    floor: floorOr(actionTarget.floor ?? location.floor ?? furniture?.floor, finalLocal.floor || 1),
    spotId: approachSpotId,
    activationSpotId,
    facing: authoredRuntimeFacing(location, actionTarget, finalLocal.facing || 'north'),
    faceAngle: authoredRuntimeFaceAngle(location, actionTarget),
  };
}

export function listScriptedObjectRuntimeTargets(dataDir) {
  const targets = [];
  for (const building of listBuildingDocuments(dataDir)) {
    const furniture = Array.isArray(building?.interior?.furniture) ? building.interior.furniture : [];
    for (let index = 0; index < furniture.length; index += 1) {
      const item = furniture[index];
      if (!item || item.deleted || item.removed || item.enabled === false) continue;
      if (isPingPongObjectType(item.type)) continue;
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
      if (sortedLocations.length > 0 && scriptedObjectActivityConfig(item) && !isServerScriptedMultiSlotPlayObjectType(item.type)) targetLocations.push(null);
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

function scriptedObjectTargetFromFurnitureSpot(building = null, furniture = null, index = -1, location = null) {
  if (!building || !furniture || !isScriptedObjectSpotUsable(furniture, location)) return null;
  const config = scriptedObjectActivityConfig(furniture);
  const local = localPointFromScriptedObjectSpot(furniture, location);
  const routeApproachLocal = localPointFromScriptedObjectRouteApproachSpot(furniture, location, local);
  const world = location?.world && typeof location.world === 'object' && !Array.isArray(location.world) ? location.world : null;
  const worldX = numberOr(world?.x, NaN);
  const worldZ = numberOr(world?.z ?? world?.y, NaN);
  const localPoint = apiPointFromBuildingLocal(building, local.x, local.z);
  const routeApproachPoint = routeApproachLocal
    ? apiPointFromBuildingLocal(building, routeApproachLocal.x, routeApproachLocal.z)
    : null;
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
  const slotId = safeText(location?.slotId || location?.seatId || spotId, spotId) || spotId;
  const exitSpotId = safeText(location?.exitSpotId, '');
  const dismountSpotId = safeText(location?.dismountSpotId, '');
  const standSpotId = safeText(location?.standSpotId, '');
  const isQueueUse = isScriptedObjectQueueSpot(location, furniture);
  const objectKey = isQueueUse
    ? normalizeWorldObjectKey(`${baseObjectKey}:queue:${spotId}`)
    : (isServerScriptedMultiSlotPlaySpot(objectType, slotId || spotId, actionId) ? serverScriptedMultiSlotObjectKey(baseObjectKey, slotId || spotId) : baseObjectKey);
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
    slotId,
    poseKind: local.poseKind,
    isQueueUse,
    animationId: isQueueUse ? 'bus-stop-wait' : (safeText(config?.animationId, '') || (local.poseKind === 'seat' ? 'sit' : 'stand-use')),
    activityKind: isQueueUse ? 'service-queue-wait' : (safeText(config?.kind, '') || 'server-scripted-object-use'),
    stayMs: scriptedObjectStayMs({ objectKey: baseObjectKey, objectType, spotId }),
    faceAngle: runtimeFurnitureActionFaceAngle(building, furniture, local, point),
    ...(exitSpotId ? { exitSpotId } : {}),
    ...(dismountSpotId ? { dismountSpotId } : {}),
    ...(standSpotId ? { standSpotId } : {}),
    ...(routeApproachPoint ? {
      routeApproachTarget: {
        x: routeApproachPoint.x,
        y: routeApproachPoint.y,
        floor: routeApproachLocal.floor,
        spotId: routeApproachLocal.spotId,
      },
      approachSpotId: routeApproachLocal.spotId,
      activationSpotId: routeApproachLocal.activationSpotId,
      dockSnapRadius: Math.max(1, numberOr(location?.snapRadius ?? location?.activationRadius, 7)),
      routeSpotRole: 'seat-approach',
    } : {}),
  };
}

function isServerRuntimeSeatedOrWorkReleaseTarget(target = null) {
  if (!target || typeof target !== 'object') return false;
  const kind = String(target.targetKind || target.kind || '').toLowerCase();
  const poseKind = String(target.poseKind || '').toLowerCase();
  const animationId = String(target.animationId || target.activityKind || '').toLowerCase();
  return Boolean(
    isServerScriptedMultiSlotPlayTarget(target) ||
    poseKind === 'seat' ||
    kind === 'work-desk' ||
    kind === 'meeting-table' ||
    animationId.includes('sit') ||
    animationId.includes('seat') ||
    animationId.includes('bed-rest')
  );
}

function serverRuntimeReleasePointFromRouteTarget(point = null, target = null, current = null) {
  if (!point || typeof point !== 'object') return null;
  const x = Number(point.x);
  const y = Number(point.y ?? point.z);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    floor: floorOr(point.floor ?? target?.floor ?? current?.floor, 1),
    buildingId: safeText(point.buildingId || target?.buildingId || current?.buildingId || '', ''),
    roomId: safeText(point.roomId || target?.roomId || current?.roomId || '', ''),
    heading: Number.isFinite(Number(point.faceAngle ?? point.heading))
      ? normalizeRuntimeAngleRadians(point.faceAngle ?? point.heading, targetFaceAngleRadians(target, current?.heading))
      : targetFaceAngleRadians(target, current?.heading),
  };
}

function serverRuntimeReleaseSpotIds(target = null) {
  const blockedFrontSpots = new Set([
    'approach-front',
    'stand-front',
    safeText(target?.approachSpotId, '').toLowerCase(),
    safeText(target?.routeApproachTarget?.spotId, '').toLowerCase(),
  ].filter(Boolean));
  return Array.from(new Set([
    target?.dismountSpotId,
    'dismount',
    'dismount-side',
    'dismount-left',
    'dismount-right',
    target?.exitSpotId,
    target?.standSpotId,
    'stand-side',
    'exit-side',
    'wake-stand',
  ].map(item => safeText(item, '')).filter(Boolean))).filter(spotId => !blockedFrontSpots.has(spotId.toLowerCase()));
}

function serverRuntimeAuthoredReleasePoint(dataDir, target = null, current = null) {
  const found = findServerScriptedObjectFurniture(dataDir, target);
  const building = found?.building || null;
  const furniture = found?.furniture || null;
  if (!building || !furniture) return null;
  const locations = Array.isArray(furniture.actionLocations) ? furniture.actionLocations : [];
  const wanted = serverRuntimeReleaseSpotIds(target);
  for (const spotId of wanted) {
    const location = locations.find(item => String(scriptedObjectSpotId(item) || '').toLowerCase() === spotId.toLowerCase()) || null;
    if (!location) continue;
    const local = localPointFromScriptedObjectSpot(furniture, location);
    const point = apiPointFromBuildingLocal(building, local.x, local.z);
    if (!point) continue;
    return {
      x: point.x,
      y: point.y,
      floor: local.floor,
      buildingId: safeText(building.id, ''),
      roomId: safeText(furniture.room || target?.roomId || current?.roomId || '', ''),
      heading: runtimeFacingAngle(building, furniture, local.x, local.z, local.facing || 'north'),
      spotId,
    };
  }
  return null;
}

function serverRuntimeReleasePointCrowdConflict(agentId, candidate = null, crowdAgents = [], target = null) {
  if (!candidate || !Array.isArray(crowdAgents) || crowdAgents.length === 0) return null;
  return findServerRuntimeCrowdConflict(agentId, candidate, candidate, crowdAgents, {
    finalTarget: candidate,
    routeTarget: target,
    arrivalRadius: SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS,
    hardRadius: SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS,
  });
}

function serverRuntimeReleaseCandidateClear(dataDir, building, candidate = null, options = {}) {
  if (!building || !candidate) return true;
  const local = buildingLocalPointFromApi(building, candidate.x, candidate.y);
  if (!local) return false;
  const width = Number(building?.widthTiles || 25) || 25;
  const depth = Number(building?.heightTiles || 17) || 17;
  const margin = 0.35;
  if (local.x < margin || local.x > width - margin || local.z < margin || local.z > depth - margin) return false;
  const staticResult = validateServerRuntimeStaticSegment(dataDir, candidate, candidate, { phase: 'server-runtime-dismount' });
  if (staticResult.clear === false) return false;
  return !serverRuntimeReleasePointCrowdConflict(options.agentId, candidate, options.crowdAgents, options.routeTarget);
}

function serverRuntimeSyntheticDismountPoint(dataDir, target = null, current = null, options = {}) {
  const found = findServerScriptedObjectFurniture(dataDir, target);
  const building = found?.building || null;
  const furniture = found?.furniture || null;
  if (!building || !furniture) return null;
  const x = Number(target?.x ?? current?.x);
  const y = Number(target?.y ?? target?.z ?? current?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const heading = targetFaceAngleRadians(target, current?.heading);
  const sideAngles = [
    normalizeRuntimeAngleRadians(heading + Math.PI / 2, heading),
    normalizeRuntimeAngleRadians(heading - Math.PI / 2, heading),
  ];
  const distances = [
    LIVE_ACTION_API_TILE * 1.05,
    LIVE_ACTION_API_TILE * 1.25,
    LIVE_ACTION_API_TILE * 1.5,
  ];
  for (const distance of distances) {
    for (const angle of sideAngles) {
      const candidate = {
        x: x + Math.sin(angle) * distance,
        y: y + Math.cos(angle) * distance,
        floor: floorOr(target?.floor ?? current?.floor, 1),
        buildingId: safeText(building.id, ''),
        roomId: safeText(furniture.room || target?.roomId || current?.roomId || '', ''),
        heading,
        spotId: 'dismount',
      };
      if (serverRuntimeReleaseCandidateClear(dataDir, building, candidate, options)) return candidate;
    }
  }
  return null;
}

function serverRuntimeFallbackReleasePoint(target = null, current = null) {
  const x = Number(target?.x ?? current?.x);
  const y = Number(target?.y ?? target?.z ?? current?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const heading = targetFaceAngleRadians(target, current?.heading);
  const dismountAngle = normalizeRuntimeAngleRadians(heading + Math.PI / 2, heading);
  const distance = LIVE_ACTION_API_TILE * 1.05;
  return {
    x: x + Math.sin(dismountAngle) * distance,
    y: y + Math.cos(dismountAngle) * distance,
    floor: floorOr(target?.floor ?? current?.floor, 1),
    buildingId: safeText(target?.buildingId || current?.buildingId || '', ''),
    roomId: safeText(target?.roomId || current?.roomId || '', ''),
    heading,
  };
}

function serverRuntimeDismountClearanceTarget(dataDir, agentId, releasePoint = null, target = null, current = null, state = null, nowMs = Date.now()) {
  const start = normalizeServerRuntimePoint(releasePoint, target?.floor ?? current?.floor ?? 1);
  if (!start) return null;
  const seatX = Number(target?.x ?? current?.x ?? start.x);
  const seatY = Number(target?.y ?? target?.z ?? current?.y ?? start.y);
  const awayDx = start.x - seatX;
  const awayDy = start.y - seatY;
  const awayLen = Math.hypot(awayDx, awayDy);
  const heading = targetFaceAngleRadians(target, current?.heading);
  const primary = awayLen > 0.001
    ? { x: awayDx / awayLen, y: awayDy / awayLen }
    : { x: Math.sin(heading + Math.PI / 2), y: Math.cos(heading + Math.PI / 2) };
  const candidates = [
    primary,
    { x: Math.sin(heading + Math.PI / 2), y: Math.cos(heading + Math.PI / 2) },
    { x: Math.sin(heading - Math.PI / 2), y: Math.cos(heading - Math.PI / 2) },
    { x: Math.sin(heading), y: Math.cos(heading) },
    { x: -Math.sin(heading), y: -Math.cos(heading) },
  ];
  const crowdAgents = state ? serverRuntimeCrowdAgents(state, agentId) : [];
  const distances = [
    LIVE_ACTION_API_TILE * 1.15,
    LIVE_ACTION_API_TILE * 1.45,
    LIVE_ACTION_API_TILE * 1.8,
  ];
  let picked = null;
  for (const distance of distances) {
    for (const direction of candidates) {
      const len = Math.hypot(direction.x, direction.y);
      if (len <= 0.001) continue;
      const candidate = {
        x: start.x + (direction.x / len) * distance,
        y: start.y + (direction.y / len) * distance,
        floor: start.floor,
        buildingId: safeText(releasePoint?.buildingId || target?.buildingId || current?.buildingId || '', ''),
        roomId: safeText(releasePoint?.roomId || target?.roomId || current?.roomId || '', ''),
      };
      const staticResult = validateServerRuntimeStaticSegment(dataDir, start, candidate, { phase: 'server-runtime-dismount-clearance' });
      if (!staticResult.clear) continue;
      const crowdConflict = findServerRuntimeCrowdConflict(agentId, start, candidate, crowdAgents, {
        finalTarget: candidate,
        routeTarget: null,
        arrivalRadius: SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS,
        hardRadius: SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS,
      });
      if (crowdConflict) continue;
      picked = candidate;
      break;
    }
    if (picked) break;
  }
  if (!picked) return null;
  const objectKey = normalizeWorldObjectKey(`runtime-dismount-clearance:${agentId}`);
  const faceAngle = normalizeRuntimeAngleRadians(Math.atan2(picked.x - start.x, picked.y - start.y), heading);
  return {
    x: picked.x,
    y: picked.y,
    floor: picked.floor,
    buildingId: picked.buildingId,
    roomId: picked.roomId,
    targetKind: 'server-runtime-dismount-clearance',
    objectKey,
    baseObjectKey: objectKey,
    objectInstanceId: objectKey,
    furnitureIndex: -1,
    objectType: 'dismountClearance',
    behaviorCategory: 'wander',
    runtimeCategory: 'dismount-clearance',
    runtimeSource: 'dismount-clearance',
    runtimeStartedAt: new Date(nowMs).toISOString(),
    actionId: 'idle.dismountClearance',
    interactionSpotId: 'dismount-clearance',
    spotId: 'dismount-clearance',
    slotId: 'dismount-clearance',
    poseKind: 'stand-use',
    isQueueUse: false,
    animationId: 'walk',
    activityKind: 'dismount-clearance',
    stayMs: 150,
    faceAngle,
    releasePoint: {
      x: start.x,
      y: start.y,
      floor: start.floor,
      buildingId: start.buildingId,
    },
  };
}

function serverRuntimeReleasePointForTarget(dataDir, target = null, current = null, options = {}) {
  if (!isServerRuntimeSeatedOrWorkReleaseTarget(target)) return null;
  const crowdAgents = options?.state ? serverRuntimeCrowdAgents(options.state, options.agentId) : [];
  const occupancyOptions = {
    agentId: options?.agentId,
    crowdAgents,
    routeTarget: target,
  };
  const authored = serverRuntimeAuthoredReleasePoint(dataDir, target, current);
  if (authored && !serverRuntimeReleasePointCrowdConflict(options?.agentId, authored, crowdAgents, target)) return authored;
  const synthetic = serverRuntimeSyntheticDismountPoint(dataDir, target, current, occupancyOptions);
  if (synthetic) return synthetic;
  const fallback = serverRuntimeFallbackReleasePoint(target, current);
  if (fallback && !serverRuntimeReleasePointCrowdConflict(options?.agentId, fallback, crowdAgents, target)) return fallback;
  return authored || fallback;
}

// Mirrors the browser furniture-spot resolver: authored queue spots are
// furniture-relative offsets (dx/dz, with x/z aliases), rotated with the furniture, clamped into the
// building's local bounds, then transformed building-local -> world -> API units (same transform as the
// desk path via apiPointFromBuildingLocal).
export function resolveServerFurnitureSpotApiPoint(building, furniture, spot = {}) {
  if (!building || !furniture || !spot) return null;
  const offset = rotateRuntimeLocalOffset(
    numberOr(spot.dx ?? spot.x ?? spot.offset?.x, 0),
    numberOr(spot.dz ?? spot.z ?? spot.y ?? spot.offset?.z, 0),
    numberOr(furniture.rotation, 0),
  );
  const rawLocalX = numberOr(furniture.x, 0) + offset.x;
  const rawLocalZ = numberOr(furniture.z, 0) + offset.z;
  const margin = 0.35;
  const bw = Number(building.widthTiles || 25) || 25;
  const bd = Number(building.heightTiles || 17) || 17;
  const localX = Math.max(margin, Math.min(bw - margin, rawLocalX));
  const localZ = Math.max(margin, Math.min(bd - margin, rawLocalZ));
  const point = apiPointFromBuildingLocal(building, localX, localZ);
  if (!point) return null;
  return { localX, localZ, apiX: point.x, apiZ: point.y, floor: floorOr(spot.floor ?? furniture.floor, 1) };
}

// Clamp an API-space point into the building's world bbox (+margin) using the same
// building-local <-> world transform as the desk/meeting target derivation.
export function clampApiPointToBuildingBounds(building, apiX, apiY, marginTiles = 0.35) {
  const local = buildingLocalPointFromApi(building, apiX, apiY);
  if (!local) return null;
  const bw = Number(building?.widthTiles || 25) || 25;
  const bd = Number(building?.heightTiles || 17) || 17;
  const localX = Math.max(marginTiles, Math.min(bw - marginTiles, local.x));
  const localZ = Math.max(marginTiles, Math.min(bd - marginTiles, local.z));
  return apiPointFromBuildingLocal(building, localX, localZ);
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

export function serverScriptedServiceQueueSlotTarget(dataDir, queueTarget = null, reservation = null) {
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
      let authoredX = numberOr(authoredTarget?.x, NaN);
      let authoredY = numberOr(authoredTarget?.y, NaN);
      // Coordinate-frame fix: authored queue
      // locations are furniture-relative offsets (dx/dz) that must go through the same
      // building-local -> world transform the desk path uses. Prefer that resolution when the spot is
      // offset-style, or when the generic spot resolution produced a point outside the building's
      // world bbox (interior-local/scaled coords leaking into world space).
      const hasExplicitLocalPoint = Boolean(authoredLocation.actionTarget || authoredLocation.buildingLocal || authoredLocation.activationTarget);
      const isOffsetStyleSpot = !hasExplicitLocalPoint && (
        Number.isFinite(numberOr(authoredLocation.dx, NaN)) ||
        Number.isFinite(numberOr(authoredLocation.dz, NaN)) ||
        Number.isFinite(numberOr(authoredLocation.offset?.x, NaN)) ||
        Number.isFinite(numberOr(authoredLocation.offset?.z, NaN)) ||
        Number.isFinite(numberOr(authoredLocation.x, NaN)) ||
        Number.isFinite(numberOr(authoredLocation.z ?? authoredLocation.y, NaN))
      );
      if (isOffsetStyleSpot || !Number.isFinite(authoredX) || !Number.isFinite(authoredY) || !buildingContainsApiPoint(building, authoredX, authoredY)) {
        const resolvedSpot = resolveServerFurnitureSpotApiPoint(building, furniture, authoredLocation);
        if (resolvedSpot) {
          authoredX = resolvedSpot.apiX;
          authoredY = resolvedSpot.apiZ;
        }
      }
      if (Number.isFinite(authoredX) && Number.isFinite(authoredY) && !buildingContainsApiPoint(building, authoredX, authoredY)) {
        const clamped = clampApiPointToBuildingBounds(building, authoredX, authoredY);
        if (clamped) {
          authoredX = clamped.x;
          authoredY = clamped.y;
        }
      }
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
      let x = primaryX + (dx / len) * spacing * (queueIndex + 1);
      let y = primaryY + (dy / len) * spacing * (queueIndex + 1);
      // Keep derived queue-line slots inside the building's world bbox (same frame as the desk path).
      if (!buildingContainsApiPoint(building, x, y)) {
        const clamped = clampApiPointToBuildingBounds(building, x, y);
        if (clamped) {
          x = clamped.x;
          y = clamped.y;
        }
      }
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

function isWorldObjectActiveForAnotherAgent(object = null, agentId = '', nowMs = Date.now()) {
  if (!hasActiveWorldObjectState(object, nowMs)) return false;
  return Boolean(object.agentId && agentId && object.agentId !== agentId);
}

function isServerScriptedSeatLikeTarget(target = null) {
  if (!target || typeof target !== 'object') return false;
  if (isServerScriptedObjectDeskConsumeTarget(target)) return false;
  if (String(target.objectKey || '').includes(':consume:')) return false;
  const poseKind = String(target.poseKind || '').trim().toLowerCase();
  if (poseKind === 'seat') return true;
  const objectType = normalizeObjectTypeKey(target.objectType || target.catalogKey || target.sourceObjectType);
  if (SERVER_SCRIPTED_SEAT_OBJECT_TYPES.has(objectType)) return true;
  const animationId = String(target.animationId || target.activityKind || target.kind || '').trim().toLowerCase();
  return animationId.includes('sit') || animationId.includes('seat') || animationId.includes('bed-rest');
}

function runtimeAgentEntries(state = null) {
  const agents = state?.agents;
  if (!agents) return [];
  if (typeof agents.entries === 'function') return Array.from(agents.entries());
  if (Array.isArray(agents)) return agents.map((record, index) => [record?.agentId || String(index), record]);
  if (typeof agents === 'object') return Object.entries(agents);
  return [];
}

function parseRuntimeAgentTarget(plain = null) {
  if (plain?.target && typeof plain.target === 'object') return plain.target;
  const activity = plain?.visualState?.activity;
  if (activity && typeof activity === 'object') return activity;
  return null;
}

function runtimeAgentSnapshotIsCurrent(plain = null, nowMs = Date.now()) {
  const stateKey = String(plain?.state || '').trim().toLowerCase();
  if (!SERVER_SCRIPTED_RUNTIME_OCCUPIED_STATES.has(stateKey)) return false;
  const expiresAt = Date.parse(String(plain?.leaseExpiresAt || ''));
  if (Number.isFinite(expiresAt) && expiresAt + 2500 < nowMs) return false;
  return true;
}

function serverScriptedTargetSpotKey(target = null) {
  return safeText(target?.slotId || target?.spotId || target?.interactionSpotId || target?.activationSpotId || '', '');
}

function serverScriptedTargetBaseKey(target = null) {
  return safeText(target?.baseObjectKey, '') ||
    safeText(target?.objectKey, '') ||
    (target?.buildingId && target?.furnitureIndex !== undefined
      ? runtimeFurnitureObjectKey(target.buildingId, target.furnitureIndex, target.objectType || 'object')
      : '');
}

function serverScriptedSeatTargetsMatch(target = null, otherTarget = null) {
  if (!target || !otherTarget) return false;
  const objectKey = safeText(target.objectKey, '');
  const otherObjectKey = safeText(otherTarget.objectKey, '');
  if (objectKey && otherObjectKey && objectKey === otherObjectKey) return true;
  const baseKey = serverScriptedTargetBaseKey(target);
  const otherBaseKey = serverScriptedTargetBaseKey(otherTarget);
  if (!baseKey || !otherBaseKey || baseKey !== otherBaseKey) return false;
  const spotKey = serverScriptedTargetSpotKey(target);
  const otherSpotKey = serverScriptedTargetSpotKey(otherTarget);
  if (spotKey && otherSpotKey) return spotKey === otherSpotKey;
  return isServerScriptedSeatLikeTarget(target) || isServerScriptedSeatLikeTarget(otherTarget);
}

function isServerScriptedSeatTargetClaimedByRuntimeAgent(state = null, target = null, agentId = '', nowMs = Date.now()) {
  if (!isServerScriptedSeatLikeTarget(target)) return false;
  const targetX = Number(target.x);
  const targetY = Number(target.y ?? target.z);
  const positionRadius = Math.max(LIVE_ACTION_API_TILE * 0.6, SERVER_RUNTIME_AGENT_HARD_SEPARATION_RADIUS * 0.85);
  for (const [otherId, record] of runtimeAgentEntries(state)) {
    const plain = snapshotToPlain(record);
    const otherAgentId = safeText(otherId || plain.agentId, '');
    if (String(otherAgentId || '') === String(agentId || '')) continue;
    if (!runtimeAgentSnapshotIsCurrent(plain, nowMs)) continue;
    const otherTarget = parseRuntimeAgentTarget(plain);
    if (serverScriptedSeatTargetsMatch(target, otherTarget)) return true;
    if (!otherTarget || !isServerScriptedSeatLikeTarget(otherTarget)) continue;
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) continue;
    const otherX = Number(plain.x);
    const otherY = Number(plain.y);
    if (!Number.isFinite(otherX) || !Number.isFinite(otherY)) continue;
    if (target.buildingId && plain.buildingId && String(target.buildingId) !== String(plain.buildingId)) continue;
    if (Math.hypot(otherX - targetX, otherY - targetY) <= positionRadius) return true;
  }
  return false;
}

export function isServerScriptedObjectTargetAvailable(state, target, agentId, nowMs = Date.now(), dataDir = '') {
  if (!target?.objectKey) return false;
  const object = state?.objects?.get?.(target.objectKey);
  if (isWorldObjectActiveForAnotherAgent(object, agentId, nowMs)) return false;
  const baseObjectKey = safeText(target.baseObjectKey, '') || target.objectKey;
  const baseObject = baseObjectKey !== target.objectKey ? state?.objects?.get?.(baseObjectKey) : object;
  const allowSharedBase = isServerScriptedMultiSlotPlayTarget(target);
  const baseActiveForAnother = !allowSharedBase && isWorldObjectActiveForAnotherAgent(baseObject, agentId, nowMs);
  const queueStore = serverScriptedServiceQueueStoreFromWorldObject(baseObject);
  const reservations = normalizeServerScriptedServiceQueueReservations(queueStore);
  const queueLength = reservations.length;
  if (target.isQueueUse) {
    if (!baseActiveForAnother && queueLength <= 0) return false;
    const existingReservation = reservations.some(entry => String(entry.agentId || '') === String(agentId || ''));
    if (existingReservation) return true;
    const maxQueuePoints = getServerScriptedServiceQueueMaxPoints(dataDir, target);
    return queueLength < maxQueuePoints;
  }
  if (isServerScriptedSeatTargetClaimedByRuntimeAgent(state, target, agentId, nowMs)) return false;
  if (allowSharedBase) return true;
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
    .filter(target => isServerScriptedObjectTargetAvailable(state, target, agentId, nowMs, options.dataDir))
    .filter(target => !SCRIPTED_OBJECT_SKIP_TYPES.has(String(target.objectType || '').toLowerCase()))
    .filter(target => !hasRecentServerRuntimeObject(memory, target, nowMs))
    .filter(target => !hasRecentServerRuntimeFailure(memory, target, nowMs));
  const fallbackAvailable = (Array.isArray(targets) ? targets : [])
    .filter(target => isServerScriptedObjectTargetAvailable(state, target, agentId, nowMs, options.dataDir))
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

export function buildScriptedObjectRuntimePlan(dataDir) {
  const presence = readPresenceSnapshotDocument(dataDir);
  const meta = readWorldMetaDocument(dataDir);
  const targets = listScriptedObjectRuntimeTargets(dataDir);
  const idleAgentIds = Object.entries(presence)
    .filter(([agentId, record]) => agentId && !agentId.startsWith('_') && isPresenceIdleForScriptedObjectRuntime(record) && isAgentScriptedAmbientEnabledForServer(meta, agentId, record)
      // Layer separation: Live ownership always suppresses Default scripted
      // idle behavior. The Ambient preference becomes effective again only
      // after Live Mode is explicitly disabled.
      && isAgentScriptedLayerAllowedForServer(meta, agentId, record))
    .map(([agentId]) => safeText(agentId, ''))
    .filter(Boolean)
    .sort();
  return { presence, meta, targets, idleAgentIds };
}

function makeServerScriptedObjectVisualState(isMoving, target = null, status = 'idle') {
  const poseKind = String(target?.poseKind || '').toLowerCase();
  const isRunning = serverScriptedObjectRouteShouldRun(target, isMoving);
  const pingPongSide = serverScriptedPingPongSide(target);
  const pingPongPaddleColor = pingPongSide ? numberOr(target?.paddleColor, serverScriptedPingPongPaddleColor(pingPongSide)) : null;
  const pingPongRacket = pingPongSide ? makeServerScriptedPingPongRacketItem(target, pingPongSide) : null;
  const temporaryItem = target?.temporaryItem && typeof target.temporaryItem === 'object' ? target.temporaryItem : null;
  const carriedItem = pingPongRacket || temporaryItem;
  const isDeskConsume = isServerScriptedObjectDeskConsumeTarget(target);
  const faceAngle = numberOr(target?.faceAngle, 0);
  const dockTarget = Number.isFinite(Number(target?.x)) && Number.isFinite(Number(target?.y))
    ? { x: Number(target.x), y: Number(target.y), floor: floorOr(target?.floor, 1), faceAngle }
    : null;
  const animationId = isMoving ? 'walk' : (
    safeText(target?.animationId, '') ||
    (pingPongSide ? 'play-pingpong' : '') ||
    (poseKind === 'seat' ? 'sit' : poseKind === 'wait' ? 'bus-stop-wait' : 'stand-use')
  );
  const activityKind = pingPongSide
    ? `pingpong-${pingPongSide}`
    : (safeText(target?.activityKind, '') || (target?.isQueueUse ? 'service-queue-wait' : 'server-scripted-object-use'));
  const activity = {
    kind: activityKind,
    phase: pingPongSide
      ? (isMoving ? 'approach' : 'ready')
      : (target?.runtimePhase === 'desk-routing'
      ? (isMoving ? 'approach' : 'active')
      : (target?.runtimePhase === 'desk-consuming' ? 'active' : (isMoving ? 'routing' : 'active'))),
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
  const slotId = safeText(target?.slotId || target?.spotId || target?.interactionSpotId, '');
  if (slotId) {
    activity.slotId = slotId;
    activity.activeUseSlotId = slotId;
  }
  if (Number.isFinite(Number(target?.stayMs))) activity.stayMs = Math.max(1000, Math.floor(Number(target.stayMs)));
  if (pingPongSide) {
    activity.source = 'pingpong-runtime-table';
    activity.mode = 'match';
    activity.pingPongSide = pingPongSide;
    activity.paddleColor = pingPongPaddleColor;
    activity.lifecycle = { stationary: true, carryable: false, temporary: false, spawnsTemporary: true };
    activity.spawnedItem = {
      label: 'Ping Pong Racket',
      catalogId: 'temporaryGameEquipment',
      temporary: true,
      carryable: true,
      attachPoint: 'right-hand',
      color: pingPongPaddleColor,
    };
  }
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
  if (pingPongRacket) activity.temporaryItem = pingPongRacket;
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
    carrying: Boolean(carriedItem),
  };
  if (carriedItem) visualState.carriedItem = carriedItem;
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

function randomInRangeMs(range, rand = Math.random) {
  const [min, max] = Array.isArray(range) && range.length >= 2 ? range : [0, 0];
  return Math.round(Number(min) + rand() * Math.max(0, Number(max) - Number(min)));
}

function makeServerSocialVisualState(role, faceAngle) {
  return {
    schemaVersion: 'agent-runtime-visual/v1',
    status: 'idle',
    state: 'social',
    resolvedAnimationId: 'gather-talk',
    movement: { isMoving: false, isRunning: false },
    activityActive: true,
    activityKind: 'social-conversation',
    deskFacingAngle: faceAngle,
    activity: {
      kind: 'gather-talk',
      phase: 'active',
      role,
      animationId: 'gather-talk',
      faceAngle,
    },
    carrying: false,
  };
}

function makeLiveStatusDesklessVisualState(isMoving) {
  return {
    schemaVersion: 'agent-runtime-visual/v1',
    status: 'working',
    state: isMoving ? 'moving' : 'idle',
    resolvedAnimationId: isMoving ? 'walk' : 'idle',
    movement: { isMoving: Boolean(isMoving), isRunning: false },
    activityActive: false,
    activityKind: 'live-status-deskless-wait',
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
  const pingPongSide = serverScriptedPingPongSide(target);
  const pingPongPaddleColor = pingPongSide ? numberOr(target?.paddleColor, serverScriptedPingPongPaddleColor(pingPongSide)) : null;
  const activityKind = pingPongSide
    ? `pingpong-${pingPongSide}`
    : (safeText(target?.activityKind, '') || (target?.isQueueUse ? 'service-queue-wait' : 'server-scripted-object-use'));
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
      activeUseSlotId: safeText(target?.slotId || spotId, spotId) || spotId,
      pingPongSide,
      paddleColor: pingPongPaddleColor,
      stayMs: Number.isFinite(Number(target?.stayMs)) ? Math.max(1000, Math.floor(Number(target.stayMs))) : null,
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
  const out = {
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
    activeUseSlotId: safeText(target?.activeUseSlotId || target?.slotId || target?.seatId || spotId, spotId) || spotId,
    poseKind,
    animationId: safeText(target?.animationId || config?.animationId, '') || (poseKind === 'seat' ? 'sit' : 'stand-use'),
    activityKind: safeText(target?.activityKind || config?.kind, '') || 'server-scripted-object-use',
    stayMs: Math.max(1000, Math.floor(numberOr(target?.stayMs ?? message?.stayMs, scriptedObjectStayMs({ objectKey, objectType, spotId })))),
    consumeDurationMs: Math.max(1000, Math.floor(numberOr(target?.consumeDurationMs ?? message?.consumeDurationMs, SERVER_SCRIPTED_OBJECT_DESK_CONSUME_MS))),
    vendingItemId: safeText(target?.vendingItemId || message?.vendingItemId, ''),
    microwaveFoodId: safeText(target?.microwaveFoodId || target?.foodItemId || message?.microwaveFoodId || message?.foodItemId, ''),
    pingPongSide: safeText(target?.pingPongSide || message?.pingPongSide, ''),
    faceAngle: normalizeRuntimeAngleRadians(target?.faceAngle, 0),
  };
  const paddleColor = numberOr(target?.paddleColor ?? message?.paddleColor, NaN);
  if (Number.isFinite(paddleColor)) out.paddleColor = paddleColor;
  return out;
}

function mergeScriptedObjectRequestRuntimeOverrides(match = null, message = {}) {
  if (!match) return match;
  const rawTarget = message?.target && typeof message.target === 'object' ? message.target : message;
  const overrides = {};
  for (const key of ['activityKind', 'animationId', 'pingPongSide', 'activeUseSlotId']) {
    const value = safeText(rawTarget?.[key] ?? message?.[key], '');
    if (value) overrides[key] = value;
  }
  const stayMs = numberOr(rawTarget?.stayMs ?? message?.stayMs, NaN);
  if (Number.isFinite(stayMs)) overrides.stayMs = Math.max(1000, Math.floor(stayMs));
  const paddleColor = numberOr(rawTarget?.paddleColor ?? message?.paddleColor, NaN);
  if (Number.isFinite(paddleColor)) overrides.paddleColor = paddleColor;
  return Object.keys(overrides).length ? { ...match, ...overrides } : match;
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
  return mergeScriptedObjectRequestRuntimeOverrides(match, message) || objectUseRequestTargetFromPoint(message);
}

function refreshScriptedObjectRuntimeTarget(dataDir, target = null) {
  if (!target || typeof target !== 'object' || !target.objectKey) return target;
  if (isPingPongObjectType(target.objectType)) return null;
  if (isServerScriptedObjectDeskConsumeTarget(target)) return target;
  const refreshed = resolveScriptedObjectRuntimeTargetFromRequest(dataDir, { target });
  if (!refreshed?.objectKey || refreshed.objectKey !== target.objectKey) return target;
  return {
    ...target,
    ...refreshed,
    routeStartedAt: target.routeStartedAt || refreshed.routeStartedAt || '',
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
	    const existing = readJsonFile(file, null);
	    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
	      return { buildingId, status: 'already-exists' };
	    }
	    let changed = false;
	    const setIfDifferent = (key, value) => {
	      if (value === undefined || value === null) return;
	      if (JSON.stringify(existing[key]) === JSON.stringify(value)) return;
	      existing[key] = value;
	      changed = true;
	    };
	    setIfDifferent('worldX', numberOr(site.worldX, existing.worldX ?? 0));
	    setIfDifferent('worldY', numberOr(site.worldY, existing.worldY ?? 0));
	    setIfDifferent('widthTiles', Math.max(4, numberOr(site.widthTiles, existing.widthTiles ?? 10)));
	    setIfDifferent('heightTiles', Math.max(4, numberOr(site.heightTiles, existing.heightTiles ?? 8)));
	    setIfDifferent('_rotation', numberOr(site._rotation ?? site.rotation, existing._rotation ?? 0));
	    if (site.streetApproach && typeof site.streetApproach === 'object') {
	      const streetApproach = JSON.parse(JSON.stringify(site.streetApproach));
	      setIfDifferent('streetApproach', streetApproach);
	      const constructionState = existing.constructionState && typeof existing.constructionState === 'object' && !Array.isArray(existing.constructionState)
	        ? { ...existing.constructionState }
	        : {};
	      if (JSON.stringify(constructionState.streetApproach) !== JSON.stringify(streetApproach)) {
	        constructionState.streetApproach = streetApproach;
	        existing.constructionState = constructionState;
	        changed = true;
	      }
	    }
	    if (changed) {
	      writeJsonFileAtomic(file, existing);
	      return { buildingId, status: 'updated-existing' };
	    }
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
    _rotation: numberOr(site._rotation ?? site.rotation, 0),
    streetApproach: site.streetApproach && typeof site.streetApproach === 'object' ? JSON.parse(JSON.stringify(site.streetApproach)) : null,
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
      streetApproach: site.streetApproach && typeof site.streetApproach === 'object' ? JSON.parse(JSON.stringify(site.streetApproach)) : null,
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

function selectRealtimeWorldObjectData(data) {
  if (!data || typeof data !== 'object') return null;
  const selected = {};
  if (data.reservation && typeof data.reservation === 'object') selected.reservation = data.reservation;
  if (data.activeUse && typeof data.activeUse === 'object') selected.activeUse = data.activeUse;
  if (Object.hasOwn(data, 'pingPongGame')) selected.pingPongGame = data.pingPongGame;
  const queueStore = data._scriptedServiceQueueStore || data.serviceQueueStore || data.scriptedServiceQueueStore || null;
  if (queueStore && typeof queueStore === 'object') selected._scriptedServiceQueueStore = queueStore;
  if (data.clearReservation === true) selected.clearReservation = true;
  if (data.clearServiceQueue === true) selected.clearServiceQueue = true;
  return Object.keys(selected).length ? selected : null;
}

export function worldObjectToRealtimePlain(object) {
  const plain = worldObjectToPlain(object);
  const data = selectRealtimeWorldObjectData(plain.data);
  if (data) {
    plain.data = data;
  } else {
    delete plain.data;
  }
  return plain;
}

export function stateToRealtimePlain(state, events = []) {
  const agents = {};
  for (const [agentId, agent] of state.agents.entries()) {
    agents[agentId] = snapshotToPlain(agent);
  }
  const objects = {};
  for (const [objectKey, object] of state.objects.entries()) {
    objects[objectKey] = worldObjectToRealtimePlain(object);
  }
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    worldId: state.worldId || 'default',
    updatedAt: state.updatedAt || new Date().toISOString(),
    eventSeq: Number(state.eventSeq || 0),
    worldRuntime: worldRuntimeToPlain(state.worldRuntime),
    agents,
    objects,
    events: RUNTIME_WIRE_EVENTS_LIMIT > 0 ? events.slice(-RUNTIME_WIRE_EVENTS_LIMIT) : [],
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
    tickSeq: Number(agent.tickSeq || 0),
    simTimeMs: Number(agent.simTimeMs || 0),
    tickMs: Number(agent.tickMs || DEFAULT_WORLD_RUNTIME_TICK_MS),
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
    tickSeq: plain.tickSeq,
    simTimeMs: plain.simTimeMs,
    tickMs: plain.tickMs,
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
    tickSeq: Math.max(0, Math.floor(numberOr(raw.tickSeq, existingPlain.tickSeq || 0))),
    simTimeMs: Math.max(0, Math.floor(numberOr(raw.simTimeMs, existingPlain.simTimeMs || 0))),
    tickMs: Math.max(1, Math.floor(numberOr(raw.tickMs, existingPlain.tickMs || DEFAULT_WORLD_RUNTIME_TICK_MS))),
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
  let normalized = sanitizeVisualValue(value, 0, 'visualState');
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  let json = JSON.stringify(normalized);
  if (json.length > MAX_VISUAL_STATE_JSON_CHARS && normalized.runtimeRoute && typeof normalized.runtimeRoute === 'object') {
    normalized = {
      ...normalized,
      runtimeRoute: {
        ...normalized.runtimeRoute,
        routePoints: Array.isArray(normalized.runtimeRoute.routePoints) ? normalized.runtimeRoute.routePoints.slice(0, 12) : [],
        rawPoints: Array.isArray(normalized.runtimeRoute.rawPoints) ? normalized.runtimeRoute.rawPoints.slice(0, 8) : [],
        rawCells: Array.isArray(normalized.runtimeRoute.rawCells) ? normalized.runtimeRoute.rawCells.slice(0, 8) : [],
      },
    };
    json = JSON.stringify(normalized);
  }
  if (json.length > MAX_VISUAL_STATE_JSON_CHARS && normalized.runtimeRoute && typeof normalized.runtimeRoute === 'object') {
    const { rawPoints, rawCells, routePoints, ...routeMeta } = normalized.runtimeRoute;
    normalized = { ...normalized, runtimeRoute: routeMeta };
    json = JSON.stringify(normalized);
  }
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
    this.patchRate = RUNTIME_SCHEMA_PATCH_RATE_MS;
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
    this.worldRuntimeTickContext = null;
    this.lastWorldRuntimeTickNowMs = 0;
    this.lastRuntimeStateBroadcastMs = 0;
    this.lastLiveActionRuntimePollMs = 0;
    this.liveActionRuntimeMeta = null;
    this.liveActionRuntimeStore = null;
    this.liveActionRouteWatchdog = new Map();
    this.lastLiveStatusRuntimePollMs = 0;
    this.liveStatusRuntimePlan = null;
    this.lastScriptedObjectRuntimePollMs = 0;
    this.scriptedObjectRuntimePlan = null;
    this.scriptedObjectRuntimeCooldowns = new Map();
    this.scriptedObjectRouteWatchdog = new Map();
    this.liveStatusRouteWatchdog = new Map();
    this.liveStatusRouteCooldowns = new Map();
    this.liveStatusDesklessWander = new Map();
    this.socialConversations = new Map();
    this.socialCooldowns = new Map();
    this.socialEvalCursor = 0;
    this.scriptedObjectRuntimeMemory = new Map();
    this.scriptedObjectRuntimeNextPulseAtMs = new Map();
    this.scriptedObjectRuntimeIdleCursor = 0;
    this.serverPingPongMatches = new Map();
    this.serverPingPongCooldowns = new Map();
    this.serverPingPongTableCooldowns = new Map();
    this.serverPingPongTableTargets = [];
    this.lastServerPingPongTablePollMs = 0;
    this.serverRuntimeBlockerYieldCooldowns = new Map();
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
    this.reconcileIdleBehaviorOwnership('runtime-hydration');
    this.ensureServerWorldTopology(Date.now(), { force: true });

    this.onMessage('runtime:snapshot', (client, message) => this.handleSnapshot(client, message));
    this.onMessage('runtime:worldObject', (client, message) => this.handleWorldObject(client, message));
    this.onMessage('runtime:objectUseRequest', (client, message) => this.handleObjectUseRequest(client, message));
    this.onMessage('runtime:pingPongMatchRequest', (client, message) => this.handlePingPongMatchRequest(client, message));
    this.onMessage('runtime:objectUseRelease', (client, message) => this.handleObjectUseRelease(client, message));
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
    this.clock.setInterval(() => {
      this.broadcast('runtime:health', {
        type: 'runtime-health',
        serverTime: new Date().toISOString(),
        revision: Number(this.state?.revision || 0),
      });
    }, RUNTIME_HEALTH_BROADCAST_INTERVAL_MS);
  }

  reconcileIdleBehaviorOwnership(reason = 'runtime-reconcile') {
    const meta = readWorldMetaDocument(this.dataDir, { fresh: true });
    let changed = 0;
    for (const [agentId, existing] of this.state.agents.entries()) {
      if (hasActiveLease(existing)) continue;
      const current = snapshotToPlain(existing);
      if (current.routeId || current.worldActionId) continue;
      if (current.mode === 'manual' || String(current.owner || '').startsWith('user-directed')) continue;
      const idleOwnership = idleRuntimeOwnershipForAgent(meta, agentId);
      if (current.mode === idleOwnership.mode && current.owner === idleOwnership.owner) continue;
      this.upsertSnapshot({
        ...current,
        ...idleOwnership,
      }, 'idle-behavior-ownership-reconciled', { reason });
      changed++;
    }
    return changed;
  }

  onJoin(client) {
    this.expireStaleRouteLeases();
    const welcome = {
      sessionId: client.sessionId,
      room: AGENT_RUNTIME_ROOM_NAME,
      serverTime: new Date().toISOString(),
      snapshot: this.runtimeWireDocument(),
    };
    client.send('runtime:welcome', welcome);
    this.clock.setTimeout(() => {
      try {
        client.send('runtime:welcome', {
          ...welcome,
          replay: true,
          serverTime: new Date().toISOString(),
          snapshot: this.runtimeWireDocument(),
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

  runtimeWireDocument() {
    return stateToRealtimePlain(this.state, this.events);
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
      snapshot: this.runtimeWireDocument(),
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
      let allowSharedBase = isServerScriptedMultiSlotPlayTarget(target);
      let blockingObject = isWorldObjectActiveForAnotherAgent(existingObject, agentId)
        ? existingObject
        : (!target.isQueueUse && !allowSharedBase && isWorldObjectActiveForAnotherAgent(existingBaseObject, agentId) ? existingBaseObject : null);
      let baseQueueLength = normalizeServerScriptedServiceQueueReservations(serverScriptedServiceQueueStoreFromWorldObject(existingBaseObject)).length;
      if ((blockingObject || baseQueueLength > 0) && !target.isQueueUse && !allowSharedBase) {
        const queueTarget = serverScriptedQueueRuntimeTargetForBase(this.dataDir, target);
        if (queueTarget) {
          target = queueTarget;
          existingObject = this.state.objects.get(target.objectKey);
          baseObjectKey = safeText(target.baseObjectKey, '') || target.objectKey;
          existingBaseObject = baseObjectKey !== target.objectKey ? this.state.objects.get(baseObjectKey) : existingObject;
          allowSharedBase = isServerScriptedMultiSlotPlayTarget(target);
          baseQueueLength = normalizeServerScriptedServiceQueueReservations(serverScriptedServiceQueueStoreFromWorldObject(existingBaseObject)).length;
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
      const source = safeText(message.source, 'request') || 'request';
      const manualDropSnapToUse = message.manualDropSnapToUse === true || message.target?.manualDropSnapToUse === true;
      const insertQueueAtFront = message.insertQueueAtFront === true || message.target?.insertQueueAtFront === true;
      const queuePriority = numberOr(message.queuePriority ?? message.target?.queuePriority, NaN);
      const result = this.startServerScriptedObjectRoute(agentId, target, Date.now(), new Date().toISOString(), {
        source,
        force: true,
        active: manualDropSnapToUse,
        insertQueueAtFront,
        queuePriority: Number.isFinite(queuePriority) ? queuePriority : undefined,
      });
      client.send('runtime:ack', {
        requestId: requestIdFrom(message),
        type: 'runtime:objectUseRequest',
        ok: true,
        agentId,
        objectKey: target.objectKey,
        snapshot: snapshotToPlain(result.agent),
        object: worldObjectToRealtimePlain(result.object),
        event: result.snapshotEvent,
      });
    });
  }

  handleObjectUseRelease(client, message = {}) {
    this.withErrors(client, message, 'runtime:objectUseRelease', () => {
      this.expireStaleRouteLeases();
      const agentId = normalizeAgentId(message.agentId);
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const requestedTarget = resolveScriptedObjectRuntimeTargetFromRequest(this.dataDir, message) || {};
      const requestedObjectKey = safeText(message.objectKey || message.target?.objectKey || requestedTarget.objectKey, '');
      const requestedBaseObjectKey = safeText(message.baseObjectKey || message.target?.baseObjectKey || requestedTarget.baseObjectKey, '');
      const requestedSlotId = safeText(message.slotId || message.target?.slotId || requestedTarget.slotId || requestedTarget.spotId, '');
      const reason = safeText(message.reason, 'object-use-released') || 'object-use-released';
      const existing = this.state.agents.get(agentId);
      const current = existing ? snapshotToPlain(existing) : null;
      const currentTarget = current?.target && typeof current.target === 'object' ? current.target : null;
      const currentObjectKeys = [
        currentTarget?.objectKey,
        currentTarget?.baseObjectKey,
        currentTarget?.sourceObjectKey,
        currentTarget?.sourceBaseObjectKey,
      ].map(value => safeText(value, '')).filter(Boolean);
      const currentSlotIds = [
        currentTarget?.slotId,
        currentTarget?.spotId,
        currentTarget?.interactionSpotId,
        currentTarget?.activeUseSlotId,
      ].map(value => safeText(value, '')).filter(Boolean);
      const objectMatches = Boolean(
        !requestedObjectKey ||
        currentObjectKeys.includes(requestedObjectKey) ||
        (requestedBaseObjectKey && currentObjectKeys.includes(requestedBaseObjectKey))
      );
      const slotMatches = Boolean(!requestedSlotId || currentSlotIds.includes(requestedSlotId));
      const ownedByScriptedObjectRuntime = current && (
        current.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER ||
        current.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER
      );
      if (current && currentTarget && ownedByScriptedObjectRuntime && objectMatches && slotMatches) {
        const releaseTarget = mergeScriptedObjectRequestRuntimeOverrides(currentTarget, message);
        const result = this.releaseServerScriptedObjectRoute(agentId, current, releaseTarget, nowMs, now, reason);
        client.send('runtime:ack', {
          requestId: requestIdFrom(message),
          type: 'runtime:objectUseRelease',
          ok: true,
          agentId,
          objectKey: releaseTarget.objectKey || requestedObjectKey,
          snapshot: snapshotToPlain(result.agent),
          object: result.object ? worldObjectToRealtimePlain(result.object) : null,
          event: { reason },
        });
        return;
      }

      const object = requestedObjectKey ? this.state.objects.get(requestedObjectKey) : null;
      const plainObject = object ? worldObjectToPlain(object) : null;
      if (plainObject && plainObject.agentId === agentId && plainObject.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER) {
        const releaseTarget = {
          ...requestedTarget,
          objectKey: requestedObjectKey,
          baseObjectKey: requestedBaseObjectKey || requestedTarget.baseObjectKey || requestedObjectKey,
          objectType: requestedTarget.objectType || plainObject.objectType || '',
          buildingId: requestedTarget.buildingId || plainObject.buildingId || '',
          furnitureIndex: requestedTarget.furnitureIndex ?? plainObject.furnitureIndex,
          slotId: requestedSlotId || requestedTarget.slotId || plainObject.slotId || '',
          spotId: requestedTarget.spotId || requestedSlotId || plainObject.slotId || '',
          actionId: requestedTarget.actionId || plainObject.actionId || '',
        };
        const objectResult = this.releaseServerScriptedObjectWorldObject(agentId, releaseTarget, nowMs, now, reason);
        client.send('runtime:ack', {
          requestId: requestIdFrom(message),
          type: 'runtime:objectUseRelease',
          ok: true,
          agentId,
          objectKey: requestedObjectKey,
          snapshot: current,
          object: objectResult?.object ? worldObjectToRealtimePlain(objectResult.object) : null,
          event: { reason, objectOnly: true },
        });
        return;
      }

      client.send('runtime:ack', {
        requestId: requestIdFrom(message),
        type: 'runtime:objectUseRelease',
        ok: true,
        agentId,
        objectKey: requestedObjectKey,
        snapshot: current,
        object: plainObject,
        event: { reason, noop: true },
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
      const manualClaim = isManualSnapshotOverride(message);
      const replacesManualHold = Boolean(
        manualClaim &&
        existing &&
        hasActiveLease(existing) &&
        existing.leaseOwner === USER_DIRECTED_RUNTIME_LEASE_OWNER
      );
      if (existing && hasActiveLease(existing) && existing.leaseOwner !== leaseOwner && !replacesManualHold) {
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
      const idleOwnership = idleRuntimeOwnershipForAgent(
        readWorldMetaDocument(this.dataDir, { fresh: true }),
        agentId,
      );
      const releaseSnapshot = {
        agentId,
        ...idleOwnership,
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
    const meta = readWorldMetaDocument(this.dataDir, { fresh: true });
    for (const [agentId, existing] of this.state.agents.entries()) {
      if (!hasExpiredLease(existing, nowMs)) continue;
      const before = snapshotToPlain(existing);
      const expiredServerManaged = SERVER_MANAGED_ROUTE_LEASE_OWNERS.has(safeText(before.leaseOwner, ''));
      const idleOwnership = idleRuntimeOwnershipForAgent(meta, agentId);
      clearDynamicInteriorRoutingForAgent(agentId);
      clearDynamicExteriorRoutingForAgent(agentId);
      this.upsertSnapshot({
        agentId,
        ...idleOwnership,
        state: 'idle',
        routeId: '',
        worldActionId: '',
        target: null,
        leaseOwner: '',
        leaseExpiresAt: '',
      }, 'route-lease-expired', {
        expiredLeaseOwner: before.leaseOwner || '',
        expiredLeaseExpiresAt: before.leaseExpiresAt || '',
        expiredServerManaged,
      });
      expired++;
    }
    return expired;
  }

  loadLiveActionRuntimeStore(nowMs = Date.now()) {
    if (this.liveActionRuntimeStore && nowMs - Number(this.lastLiveActionRuntimePollMs || 0) < LIVE_ACTION_RUNTIME_PLAN_POLL_MS) {
      return { meta: this.liveActionRuntimeMeta, store: this.liveActionRuntimeStore };
    }
    const loaded = readWorldActionsStore(this.dataDir);
    this.liveActionRuntimeMeta = loaded.meta;
    this.liveActionRuntimeStore = loaded.store;
    this.lastLiveActionRuntimePollMs = nowMs;
    return loaded;
  }

  saveLiveActionRuntimeStore(meta, store, nowMs = Date.now()) {
    // The web server can cancel/redirect a Live action while this process is
    // between runtime ticks. Merge against the latest shared store so a stale
    // in-memory tick can never resurrect or complete an action that is already
    // terminal (especially cancelled) in authoritative history.
    let nextMeta = meta;
    let nextStore = store;
    try {
      // A Python request can create/reserve an action between runtime polls.
      // This merge is a write barrier, so bypass the 250 ms hot-read cache;
      // otherwise an old cached store can erase that newly accepted action.
      const latest = readWorldActionsStore(this.dataDir, { fresh: true });
      const recordId = record => safeText(record?.id || record?.worldActionId, '');
      const latestHistory = Array.isArray(latest?.store?.history) ? latest.store.history : [];
      const latestActive = Array.isArray(latest?.store?.active) ? latest.store.active : [];
      const latestTerminalById = new Map(
        latestHistory
          .filter(record => recordId(record) && WORLD_ACTION_TERMINAL_STATUSES.has(canonicalWorldActionStatus(record?.status)))
          .map(record => [recordId(record), record]),
      );
      const proposedHistory = Array.isArray(store?.history) ? store.history : [];
      const mergedHistory = [];
      const historyIds = new Set();
      for (const proposed of proposedHistory) {
        const id = recordId(proposed);
        const chosen = id && latestTerminalById.has(id) ? latestTerminalById.get(id) : proposed;
        const chosenId = recordId(chosen);
        if (!chosenId || historyIds.has(chosenId)) continue;
        historyIds.add(chosenId);
        mergedHistory.push(chosen);
      }
      for (const current of latestHistory) {
        const id = recordId(current);
        if (!id || historyIds.has(id)) continue;
        historyIds.add(id);
        mergedHistory.push(current);
      }
      const proposedActive = (Array.isArray(store?.active) ? store.active : [])
        .filter(record => {
          const id = recordId(record);
          return id && !latestTerminalById.has(id) && !historyIds.has(id);
        });
      const activeIds = new Set(proposedActive.map(recordId));
      for (const current of latestActive) {
        const id = recordId(current);
        if (!id || activeIds.has(id) || historyIds.has(id) || latestTerminalById.has(id)) continue;
        activeIds.add(id);
        proposedActive.push(current);
      }
      nextMeta = latest?.meta || meta;
      nextStore = {
        ...(store || {}),
        active: proposedActive,
        history: mergedHistory.slice(0, 1000),
      };
    } catch (error) {
      console.warn('Live action runtime store merge failed; using current tick snapshot:', error?.message || error);
    }
    writeWorldActionsStore(this.dataDir, nextMeta, nextStore);
    this.liveActionRuntimeMeta = nextMeta;
    this.liveActionRuntimeStore = nextStore;
    this.lastLiveActionRuntimePollMs = nowMs;
  }

  loadLiveStatusRuntimePlan(nowMs = Date.now()) {
    if (this.liveStatusRuntimePlan && nowMs - Number(this.lastLiveStatusRuntimePollMs || 0) < LIVE_STATUS_RUNTIME_PLAN_POLL_MS) {
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
    if (this.scriptedObjectRuntimePlan && nowMs - Number(this.lastScriptedObjectRuntimePollMs || 0) < SERVER_SCRIPTED_OBJECT_RUNTIME_PLAN_POLL_MS) {
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
    const floor = floorOr(target?.floor, 1);
    const heading = targetFaceAngleRadians(target, 0);
    const candidates = [];
    for (const candidateRadius of [radius, radius + 40, Math.max(80, radius - 40), radius + 80]) {
      for (const angleOffset of [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI]) {
        candidates.push({
          x: targetX + Math.cos(angle + angleOffset) * candidateRadius,
          y: targetY + Math.sin(angle + angleOffset) * candidateRadius,
          floor,
        });
      }
    }
    candidates.push({ x: targetX, y: targetY, floor });

    for (const candidate of candidates) {
      const validation = validateServerRuntimeStaticSegment(this.dataDir, candidate, candidate, {
        phase: 'server-runtime-seed',
        route: { source: 'dynamic-interior-routing.js' },
      });
      if (!validation.clear) continue;
      const building = findInteriorBuildingAtApi(this.dataDir, candidate.x, candidate.y);
      const buildingId = safeText(building?.id, '');
      return {
        ...candidate,
        buildingId,
        roomId: buildingId && buildingId === safeText(target?.buildingId, '') ? safeText(target?.roomId, '') : '',
        heading,
      };
    }

    return {
      x: targetX,
      y: targetY,
      floor,
      buildingId: safeText(target?.buildingId, ''),
      roomId: safeText(target?.roomId, ''),
      heading,
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

  serverScriptedAgentCanStartObject(agentId, idleAgentIds, nowMs = Date.now()) {
    const key = normalizeAgentId(agentId);
    if (!key || !idleAgentIds?.has?.(key)) return false;
    const existing = this.state.agents.get(key);
    if (!existing) return true;
    const current = snapshotToPlain(existing);
    if (current.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || current.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER) return false;
    if (hasActiveLease(existing, nowMs)) return false;
    const state = String(current.state || '').toLowerCase();
    return !state || state === 'idle' || state === 'scripted';
  }

  serverScriptedPingPongPartnerCandidates(agentId, target, idleAgentIds, targets, nowMs = Date.now()) {
    const partnerTarget = findServerScriptedPingPongPartnerTarget(targets, target);
    if (!partnerTarget) return [];
    return Array.from(idleAgentIds || [])
      .map(candidateId => normalizeAgentId(candidateId))
      .filter(candidateId => candidateId && candidateId !== normalizeAgentId(agentId))
      .filter(candidateId => this.serverScriptedAgentCanStartObject(candidateId, idleAgentIds, nowMs))
      .filter(candidateId => isServerScriptedObjectTargetAvailable(this.state, partnerTarget, candidateId, nowMs, this.dataDir))
      .map(candidateId => {
        const existing = this.state.agents.get(candidateId);
        const current = existing ? snapshotToPlain(existing) : null;
        const stable = stableTextHash(`${candidateId}:pingpong-partner:${partnerTarget.objectKey || ''}:${Math.floor(nowMs / 1000)}`) % 1000;
        return {
          agentId: candidateId,
          target: partnerTarget,
          score: serverRuntimeDistanceScore(current, partnerTarget) + (stable / 1000) * 4,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  tryStartServerScriptedPingPongPartner(agentId, target, idleAgentIds, targets, nowMs = Date.now(), now = new Date(nowMs).toISOString(), options = {}) {
    if (!isServerScriptedMultiSlotPlayTarget(target)) return { started: false, reason: 'not-pingpong' };
    const source = safeText(options.source || target?.runtimeSource, 'idle') || 'idle';
    const candidates = this.serverScriptedPingPongPartnerCandidates(agentId, target, idleAgentIds, targets, nowMs);
    if (candidates.length <= 0) return { started: false, reason: 'no-partner-candidate' };
    for (const candidate of candidates) {
      const partnerTarget = {
        ...candidate.target,
        runtimeStartedAt: now,
        runtimeActiveAt: '',
        runtimeSource: source,
      };
      try {
        const routeResult = this.startServerScriptedObjectRoute(candidate.agentId, partnerTarget, nowMs, now, {
          source,
          force: false,
          pingPongPartner: true,
        });
        this.markServerScriptedRuntimeChoice(candidate.agentId, partnerTarget, nowMs);
        return {
          started: true,
          agentId: candidate.agentId,
          target: partnerTarget,
          changedSnapshots: routeResult?.agent ? 1 : 0,
          changedObjects: routeResult?.object ? 1 : 0,
        };
      } catch (error) {
        this.markServerScriptedRuntimeFailure(candidate.agentId, partnerTarget, error?.code || error?.message || 'pingpong-partner-start-failed', nowMs);
      }
    }
    return { started: false, reason: 'partner-start-failed' };
  }

  serverScriptedPingPongPartnerClaimed(agentId, target, targets, nowMs = Date.now()) {
    const partnerTarget = findServerScriptedPingPongPartnerTarget(targets, target);
    if (!partnerTarget?.objectKey) return false;
    const partnerObject = this.state.objects.get(partnerTarget.objectKey);
    if (isWorldObjectActiveForAnotherAgent(partnerObject, agentId, nowMs)) return true;
    for (const [otherAgentId, record] of this.state.agents.entries()) {
      const otherId = normalizeAgentId(otherAgentId);
      if (!otherId || otherId === normalizeAgentId(agentId)) continue;
      const current = snapshotToPlain(record);
      const otherTarget = current.target && typeof current.target === 'object' ? current.target : null;
      if (otherTarget?.objectKey !== partnerTarget.objectKey) continue;
      if (current.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || current.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER) return true;
    }
    return false;
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
      const insertAtFront = options.insertQueueAtFront === true || rawTarget?.insertQueueAtFront === true;
      const minQueuedAtMs = live.reduce((min, entry) => Math.min(min, Number(entry.queuedAtMs || nowMs)), nowMs);
      const queuedAtMs = insertAtFront ? minQueuedAtMs - 1 : Math.floor(numberOr(options.queuedAtMs, nowMs));
      const queuePriority = insertAtFront
        ? Math.min(-1, numberOr(options.queuePriority ?? rawTarget?.queuePriority, -1))
        : Number((options.queuePriority ?? rawTarget?.queuePriority) || 0);
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
        queuePriority,
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
      }, nowMs, now, { source, force: true, queuePromotion: true });
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

  promoteFreeServerScriptedServiceQueues(nowMs, now, reason = 'free-service-queue-promote-front') {
    let changedSnapshots = 0;
    let changedObjects = 0;
    let promotedCount = 0;
    for (const [objectKey, object] of this.state.objects.entries()) {
      if (String(objectKey || '').includes(':queue:')) continue;
      const store = serverScriptedServiceQueueStoreFromWorldObject(object);
      if (normalizeServerScriptedServiceQueueReservations(store).length <= 0) continue;
      if (hasActiveWorldObjectState(object, nowMs)) continue;
      const promoted = this.promoteServerScriptedServiceQueueFrontIfReady(objectKey, nowMs, now, reason);
      changedSnapshots += promoted.changedSnapshots || 0;
      changedObjects += promoted.changedObjects || 0;
      if (promoted.promoted) promotedCount++;
    }
    return { changedSnapshots, changedObjects, promotedCount };
  }

  startServerScriptedObjectRoute(agentId, rawTarget, nowMs = Date.now(), now = new Date(nowMs).toISOString(), options = {}) {
    let target = {
      ...rawTarget,
      runtimeStartedAt: rawTarget.runtimeStartedAt || now,
      routeStartedAt: rawTarget.routeStartedAt || now,
      runtimeActiveAt: options.active === true ? (rawTarget.runtimeActiveAt || now) : (rawTarget.runtimeActiveAt || ''),
      runtimeSource: options.source || rawTarget.runtimeSource || 'idle',
    };
    if (isPingPongObjectType(target.objectType)) {
      throw apiError('pingpong_server_runtime_required', 'ping-pong is owned by the dedicated server ping-pong runtime', { objectKey: target.objectKey || '' });
    }
    if (target.isQueueUse) {
      const queued = this.reserveServerScriptedServiceQueueTarget(agentId, target, nowMs, now, {
        sourceKind: options.source || target.runtimeSource || 'agent-scripted-mode',
        actionId: target.actionId,
        insertQueueAtFront: options.insertQueueAtFront === true || target.insertQueueAtFront === true,
        queuePriority: options.queuePriority ?? target.queuePriority,
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
    const allowSharedBase = isServerScriptedMultiSlotPlayTarget(target);
    if (allowSharedBase && isWorldObjectActiveForAnotherAgent(existingObject, agentId, nowMs)) {
      throw apiError('object_state_conflict', 'scripted object slot is already active for another agent', { objectKey, agentId });
    }
    if (!target.isQueueUse && isServerScriptedSeatTargetClaimedByRuntimeAgent(this.state, target, agentId, nowMs)) {
      throw apiError('object_state_conflict', 'seated object is already claimed by another agent', { objectKey, agentId });
    }
    const seatObjectBlocked = !target.isQueueUse && isServerScriptedSeatLikeTarget(target) && (
      isWorldObjectActiveForAnotherAgent(existingObject, agentId, nowMs) ||
      (!allowSharedBase && isWorldObjectActiveForAnotherAgent(existingBaseObject, agentId, nowMs))
    );
    if (seatObjectBlocked) {
      throw apiError('object_state_conflict', 'seated object is already active for another agent', { objectKey, agentId });
    }
    const baseBlocked = target.isQueueUse || allowSharedBase ? false : isWorldObjectActiveForAnotherAgent(existingBaseObject, agentId, nowMs);
    const baseQueueLength = normalizeServerScriptedServiceQueueReservations(serverScriptedServiceQueueStoreFromWorldObject(existingBaseObject)).length;
    const pendingQueueBlocksDirectUse = !target.isQueueUse && !allowSharedBase && baseQueueLength > 0 && options.queuePromotion !== true;
    if (pendingQueueBlocksDirectUse) {
      throw apiError('service_queue_pending', 'service object has a pending queue; direct use must wait for queue promotion', { objectKey: target.baseObjectKey || objectKey, agentId, queueLength: baseQueueLength });
    }
    if (!options.force && (isWorldObjectActiveForAnotherAgent(existingObject, agentId, nowMs) || baseBlocked)) {
      throw apiError('object_state_conflict', 'world object is active for another agent', { objectKey, agentId });
    }
    const routeId = safeText(`scripted-object:${agentId}:${target.buildingId || 'building'}:${target.furnitureIndex ?? 'object'}:${target.spotId || 'spot'}`, `scripted-object:${agentId}`);
    const targetHeading = targetFaceAngleRadians(target, current.heading);
    const movement = makeServerRuntimeStep(this.dataDir, agentId, current, target, DEFAULT_WORLD_RUNTIME_TICK_MS, {
      speedUnitsPerSec: serverScriptedObjectRuntimeSpeedUnitsPerSec(target, true),
      arrivalRadius: SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS,
      routeSource: 'server-scripted-object-runtime',
      crowdAgents: serverRuntimeCrowdAgents(this.state, agentId),
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
      floor: arrived ? floorOr(target.floor, 1) : movement.floor,
      buildingId: arrived ? (target.buildingId || '') : movement.buildingId,
      roomId: arrived ? (target.roomId || '') : movement.roomId,
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
    this.lastLiveActionRuntimeStepMs = nowMs;
    const { meta, store } = this.loadLiveActionRuntimeStore(nowMs);
    const active = Array.isArray(store.active) ? store.active : [];
    if (active.length === 0) {
      this.liveActionRouteWatchdog?.clear?.();
      return { changedActions: false, changedSnapshots: 0 };
    }
    if (!(this.liveActionRouteWatchdog instanceof Map)) this.liveActionRouteWatchdog = new Map();
    const activeActionIds = new Set(active.map(item => safeText(item?.id || item?.worldActionId, '')).filter(Boolean));
    for (const trackedActionId of this.liveActionRouteWatchdog.keys()) {
      if (!activeActionIds.has(trackedActionId)) this.liveActionRouteWatchdog.delete(trackedActionId);
    }

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
      let existing = this.state.agents.get(agentId);
      if (targetPoint && !existing) {
        existing = this.ensureServerRuntimeAgentSeed(agentId, targetPoint, 'live-action-runtime-start');
        changedSnapshots++;
      }
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
	      const movement = makeLiveActionRuntimeMovement(this.dataDir, agentId, current, targetPoint, tickMs, {
	        crowdAgents: serverRuntimeCrowdAgents(this.state, agentId),
	      });
      const arrived = movement.arrived;
      const nextX = movement.x;
      const nextY = movement.y;
      const heading = movement.heading;
      const snapshotTarget = makeLiveActionSnapshotTarget(action, targetPoint);
      const routeId = safeText(action?.route?.id || action?.route?.routeId, `route-${actionId}`) || `route-${actionId}`;

      const routeProgress = observeServerRuntimeRouteProgress(this.liveActionRouteWatchdog, actionId, {
        routeId,
        nowMs,
        x: nextX,
        y: nextY,
        distanceToFinal: movement.distanceToFinal,
        arrived,
      });
      if (!arrived && (status === 'routing' || status === 'route_pending')) {
        if (routeProgress.stale) {
          const transitioned = this.transitionServerLiveAction(action, 'failed', {
            now,
            actor,
            source,
            reason: 'route-stale',
            failureReason: 'route_unreachable',
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
            visualState: makeLiveActionVisualState(false, 'working', action, targetPoint),
          }, 'server-live-action-route-stale', { actionId, routeId, reason: 'route-stale' });
          changedSnapshots++;
          nextHistory.unshift(action);
          this.liveActionRouteWatchdog.delete(actionId);
          continue;
        }
      }

      if (status === 'routing' || status === 'route_pending') {
        this.upsertSnapshot({
          agentId,
          mode: 'live',
          owner: LIVE_ACTION_RUNTIME_OWNER,
          x: nextX,
          y: nextY,
          floor: movement.floor,
          buildingId: movement.buildingId || '',
          roomId: movement.roomId || '',
          heading,
          state: arrived ? 'arrived' : 'routing',
          routeId,
          worldActionId: actionId,
          target: snapshotTarget,
          leaseOwner: LIVE_ACTION_RUNTIME_LEASE_OWNER,
          leaseExpiresAt: new Date(nowMs + LIVE_ACTION_RUNTIME_LEASE_TTL_MS).toISOString(),
          visualState: withRuntimeRouteVisualState(makeLiveActionVisualState(!arrived, 'working', action, targetPoint), movement.route),
        }, arrived ? 'server-live-action-arrived' : 'server-live-action-routing', { actionId, routeId });
        changedSnapshots++;
        if (!arrived) {
          const yieldResult = this.tryNudgeServerRuntimeCrowdBlocker(agentId, current, targetPoint, movement.route, nowMs, now);
          if (yieldResult.nudged) changedSnapshots++;
        }
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
        const arrivedAtMs = Date.parse(action?.timing?.arrivedAt || action?.timing?.updatedAt || '');
        const arrivalDwellMs = Math.max(1000, Math.floor(numberOr(action?.params?.microstepArrivalDwellMs, 5000)));
        if (Number.isFinite(arrivedAtMs) && nowMs - arrivedAtMs >= arrivalDwellMs) {
          const transitioned = this.transitionServerLiveAction(action, 'in_progress', {
            now,
            actor,
            source,
            reason: 'server-runtime-arrival-revalidated-activity-started',
          });
          if (transitioned.changed) {
            action = transitioned.action;
            changedActions = true;
          }
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
          visualState: makeLiveActionVisualState(false, 'working', action, targetPoint),
        }, 'server-live-action-in-progress', { actionId, routeId });
        changedSnapshots++;
        if (serverLiveActionShouldComplete(action, nowMs)) {
          const sideEffect = writeServerBuiltHomeIfNeeded(this.dataDir, action, now);
          const embodiedState = makeLiveActionEmbodiedState(action, targetPoint, 'completed');
          const result = {
            status: 'completed',
            applied: true,
            reason: 'server_authoritative_live_action_completed',
            runtime: LIVE_ACTION_RUNTIME_OWNER,
            ...(embodiedState ? { embodiedState } : {}),
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
            mode: 'live',
            owner: LIVE_ACTION_RUNTIME_OWNER,
            x: Number(targetPoint.x),
            y: Number(targetPoint.y),
            floor: targetPoint.floor,
            buildingId: targetPoint.buildingId || '',
            roomId: targetPoint.roomId || '',
            heading,
            state: 'completed',
            routeId,
            worldActionId: actionId,
            target: snapshotTarget,
            leaseOwner: LIVE_ACTION_RUNTIME_LEASE_OWNER,
            leaseExpiresAt: new Date(nowMs + LIVE_ACTION_RUNTIME_COMPLETION_VISIBLE_MS).toISOString(),
            visualState: makeLiveActionVisualState(false, 'completed', action, targetPoint),
          }, 'server-live-action-completed', { actionId, routeId });
          changedSnapshots++;
        }
      }

      status = canonicalWorldActionStatus(action.status);
      if (WORLD_ACTION_TERMINAL_STATUSES.has(status)) {
        this.liveActionRouteWatchdog.delete(actionId);
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

  // M3.1 proximity conversations (8590 parity): idle agents near each other
  // sometimes stop, face each other, and talk with speaker/listener role
  // swaps. Server-owned so all clients render the same conversation.
  socialAgentEligible(agentId, idleAgentIds, nowMs) {
    if (!idleAgentIds.has(agentId)) return null;
    if (Number(this.socialCooldowns.get(agentId) || 0) > nowMs) return null;
    for (const convo of this.socialConversations.values()) {
      if (convo.participants.includes(agentId)) return null;
    }
    const existing = this.state.agents.get(agentId);
    if (!existing) return null;
    const current = snapshotToPlain(existing);
    if (hasActiveLease(existing, nowMs) && current.leaseOwner && current.leaseOwner !== SERVER_SOCIAL_RUNTIME_LEASE_OWNER) return null;
    if (current.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || current.owner === LIVE_STATUS_RUNTIME_OWNER || current.owner === LIVE_ACTION_RUNTIME_OWNER) return null;
    if (!['idle', 'scripted', ''].includes(String(current.state || '').toLowerCase())) return null;
    return current;
  }

  applySocialConversationPose(convo, nowMs, now) {
    const speakers = new Set([convo.participants[convo.speakerIndex % convo.participants.length]]);
    for (const agentId of convo.participants) {
      const existing = this.state.agents.get(agentId);
      if (!existing) continue;
      const current = snapshotToPlain(existing);
      const partnerId = convo.participants.find(id => id !== agentId) || agentId;
      const partner = this.state.agents.get(partnerId);
      const partnerPlain = partner ? snapshotToPlain(partner) : current;
      const faceAngle = Math.atan2(
        numberOr(partnerPlain.y, 0) - numberOr(current.y, 0),
        numberOr(partnerPlain.x, 0) - numberOr(current.x, 0)
      );
      const role = speakers.has(agentId) ? 'talking' : 'listening';
      this.upsertSnapshot({
        agentId,
        mode: 'live',
        owner: SERVER_SOCIAL_RUNTIME_OWNER,
        x: current.x,
        y: current.y,
        floor: current.floor,
        buildingId: current.buildingId || '',
        roomId: current.roomId || '',
        heading: faceAngle,
        state: 'social',
        routeId: `social:${convo.id}`,
        worldActionId: '',
        target: null,
        leaseOwner: SERVER_SOCIAL_RUNTIME_LEASE_OWNER,
        leaseExpiresAt: new Date(nowMs + SERVER_SOCIAL_LEASE_TTL_MS).toISOString(),
        visualState: makeServerSocialVisualState(role, faceAngle),
      }, 'server-social-conversation', { conversationId: convo.id, role });
    }
  }

  endSocialConversation(convo, nowMs, now, reason = 'conversation-complete') {
    this.socialConversations.delete(convo.id);
    for (const agentId of convo.participants) {
      this.socialCooldowns.set(agentId, nowMs + randomInRangeMs(SERVER_SOCIAL_POST_COOLDOWN_MS, this.socialRandom));
      const existing = this.state.agents.get(agentId);
      if (!existing) continue;
      const current = snapshotToPlain(existing);
      if (current.owner !== SERVER_SOCIAL_RUNTIME_OWNER && current.leaseOwner !== SERVER_SOCIAL_RUNTIME_LEASE_OWNER) continue;
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
        visualState: makeServerScriptedObjectIdleVisualState(),
      }, 'server-social-conversation-ended', { conversationId: convo.id, reason });
    }
  }

  tickSocialConversations(idleAgentIds, tickMs, nowMs, now) {
    let changed = 0;
    if (!this.socialConversations) this.socialConversations = new Map();
    if (!this.socialCooldowns) this.socialCooldowns = new Map();
    if (!Number.isFinite(Number(this.socialEvalCursor))) this.socialEvalCursor = 0;
    const rand = this.socialRandom || Math.random;

    // Advance/end active conversations.
    for (const convo of Array.from(this.socialConversations.values())) {
      if (nowMs >= convo.endsAtMs) {
        this.endSocialConversation(convo, nowMs, now);
        changed += convo.participants.length;
        continue;
      }
      // Participant stolen by another runtime (user drag, live action) ends it.
      const lost = convo.participants.some(agentId => {
        const existing = this.state.agents.get(agentId);
        if (!existing) return true;
        const current = snapshotToPlain(existing);
        return current.owner !== SERVER_SOCIAL_RUNTIME_OWNER && current.leaseOwner !== SERVER_SOCIAL_RUNTIME_LEASE_OWNER;
      });
      if (lost) {
        this.endSocialConversation(convo, nowMs, now, 'participant-lost');
        changed += convo.participants.length;
        continue;
      }
      if (nowMs >= convo.nextRoleSwitchAtMs) {
        convo.speakerIndex = (convo.speakerIndex + 1) % convo.participants.length;
        convo.nextRoleSwitchAtMs = nowMs + randomInRangeMs(SERVER_SOCIAL_ROLE_SWITCH_MS, rand);
        this.applySocialConversationPose(convo, nowMs, now);
        changed += convo.participants.length;
      }
    }

    // Coarse spatial buckets (O(n)) over idle-eligible agents.
    const bucketSize = SERVER_SOCIAL_CONVERSATION_RADIUS_API;
    const buckets = new Map();
    const idleList = Array.from(idleAgentIds);
    for (const agentId of idleList) {
      const existing = this.state.agents.get(agentId);
      if (!existing) continue;
      const plain = snapshotToPlain(existing);
      const key = `${Math.floor(numberOr(plain.x, 0) / bucketSize)}:${Math.floor(numberOr(plain.y, 0) / bucketSize)}:${floorOr(plain.floor, 1)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ agentId, x: numberOr(plain.x, 0), y: numberOr(plain.y, 0), floor: floorOr(plain.floor, 1), buildingId: safeText(plain.buildingId, '') });
    }

    // Bounded round-robin evaluation.
    let evals = 0;
    for (let i = 0; i < idleList.length && evals < SERVER_SOCIAL_MAX_EVALS_PER_TICK; i++) {
      const index = positiveModulo(this.socialEvalCursor + i, idleList.length);
      const agentId = idleList[index];
      const me = this.socialAgentEligible(agentId, idleAgentIds, nowMs);
      if (!me) continue;
      evals++;
      const bx = Math.floor(numberOr(me.x, 0) / bucketSize);
      const by = Math.floor(numberOr(me.y, 0) / bucketSize);
      const myFloor = floorOr(me.floor, 1);
      let partnerId = null;
      for (let dx = -1; dx <= 1 && !partnerId; dx++) {
        for (let dy = -1; dy <= 1 && !partnerId; dy++) {
          for (const other of buckets.get(`${bx + dx}:${by + dy}:${myFloor}`) || []) {
            if (other.agentId === agentId) continue;
            if (safeText(me.buildingId, '') !== other.buildingId) continue;
            if (Math.hypot(other.x - numberOr(me.x, 0), other.y - numberOr(me.y, 0)) > SERVER_SOCIAL_CONVERSATION_RADIUS_API) continue;
            if (!this.socialAgentEligible(other.agentId, idleAgentIds, nowMs)) continue;
            partnerId = other.agentId;
            break;
          }
        }
      }
      if (!partnerId) continue;
      if (rand() > SERVER_SOCIAL_CONVERSATION_CHANCE) {
        // Failed roll still cools this agent briefly so pairs don't re-roll every tick.
        this.socialCooldowns.set(agentId, nowMs + 5000);
        continue;
      }
      const convoId = `convo-${nowMs}-${agentId}`;
      const convo = {
        id: convoId,
        participants: [agentId, partnerId],
        speakerIndex: 0,
        endsAtMs: nowMs + randomInRangeMs(SERVER_SOCIAL_CONVERSATION_DURATION_MS, rand),
        nextRoleSwitchAtMs: nowMs + randomInRangeMs(SERVER_SOCIAL_ROLE_SWITCH_MS, rand),
      };
      this.socialConversations.set(convoId, convo);
      this.socialCooldowns.set(agentId, nowMs + SERVER_SOCIAL_CONVERSATION_COOLDOWN_MS);
      this.socialCooldowns.set(partnerId, nowMs + SERVER_SOCIAL_CONVERSATION_COOLDOWN_MS);
      this.applySocialConversationPose(convo, nowMs, now);
      changed += convo.participants.length;
    }
    this.socialEvalCursor = positiveModulo(this.socialEvalCursor + Math.max(1, evals), Math.max(1, idleList.length));

    for (const [agentId, untilMs] of Array.from(this.socialCooldowns.entries())) {
      if (Number(untilMs || 0) <= nowMs) this.socialCooldowns.delete(agentId);
    }
    return changed;
  }

  // M1.4 deskless working-agent fallback (8590 parity): work-presence agents
  // with no free desk wander/wait near their current position instead of
  // freezing; the plan rebuild (every LIVE_STATUS_RUNTIME_POLL_MS) re-checks
  // desk availability so they claim a desk as soon as one frees.
  tickLiveStatusDesklessWander(desklessWorkingIds, tickMs, nowMs, now) {
    let changed = 0;
    for (const agentId of Array.from(this.liveStatusDesklessWander.keys())) {
      if (!desklessWorkingIds.has(agentId)) this.liveStatusDesklessWander.delete(agentId);
    }
    for (const agentId of desklessWorkingIds) {
      const existing = this.state.agents.get(agentId);
      if (!existing) continue;
      const current = snapshotToPlain(existing);
      const ownedByStatusRuntime = current.owner === LIVE_STATUS_RUNTIME_OWNER || current.leaseOwner === LIVE_STATUS_RUNTIME_LEASE_OWNER;
      const hasOtherLease = Boolean(
        hasActiveLease(existing, nowMs) &&
        current.leaseOwner &&
        current.leaseOwner !== LIVE_STATUS_RUNTIME_LEASE_OWNER
      );
      if (hasOtherLease) {
        this.liveStatusDesklessWander.delete(agentId);
        continue;
      }
      let wander = this.liveStatusDesklessWander.get(agentId);
      if (!wander || nowMs >= Number(wander.nextMoveAtMs || 0)) {
        const anchor = wander?.anchor || { x: numberOr(current.x, 0), y: numberOr(current.y, 0) };
        const angle = Math.random() * Math.PI * 2;
        const radius = 8 + Math.random() * 24;
        wander = {
          anchor,
          target: { x: anchor.x + Math.cos(angle) * radius, y: anchor.y + Math.sin(angle) * radius },
          nextMoveAtMs: nowMs + 5000 + Math.random() * 5000,
        };
        this.liveStatusDesklessWander.set(agentId, wander);
      }
      const dx = wander.target.x - numberOr(current.x, 0);
      const dy = wander.target.y - numberOr(current.y, 0);
      const dist = Math.hypot(dx, dy);
      const stepLen = LIVE_STATUS_RUNTIME_SPEED_UNITS_PER_SEC * (Math.max(1, tickMs) / 1000);
      const arrived = dist <= Math.max(2, stepLen);
      const nextX = arrived ? wander.target.x : numberOr(current.x, 0) + (dx / dist) * stepLen;
      const nextY = arrived ? wander.target.y : numberOr(current.y, 0) + (dy / dist) * stepLen;
      const heading = dist > 0.001 ? Math.atan2(dy, dx) : numberOr(current.heading, 0);
      const isMoving = !arrived;
      const stateText = isMoving ? 'moving' : 'working';
      const shouldWrite = !ownedByStatusRuntime || isMoving || current.state !== stateText;
      if (!shouldWrite) continue;
      this.upsertSnapshot({
        agentId,
        mode: 'live',
        owner: LIVE_STATUS_RUNTIME_OWNER,
        x: nextX,
        y: nextY,
        floor: current.floor,
        buildingId: current.buildingId || '',
        roomId: current.roomId || '',
        heading,
        state: stateText,
        routeId: `live-status-deskless:${agentId}`,
        worldActionId: '',
        target: null,
        leaseOwner: LIVE_STATUS_RUNTIME_LEASE_OWNER,
        leaseExpiresAt: new Date(nowMs + LIVE_STATUS_RUNTIME_LEASE_TTL_MS).toISOString(),
        visualState: makeLiveStatusDesklessVisualState(isMoving),
      }, 'server-live-status-deskless-wait', { reason: 'no-free-desk' });
      changed++;
    }
    return changed;
  }

  loadServerPingPongTableTargets(nowMs = Date.now(), { force = false } = {}) {
    if (!force && Array.isArray(this.serverPingPongTableTargets) && nowMs - Number(this.lastServerPingPongTablePollMs || 0) < SERVER_PINGPONG_RUNTIME_TABLE_POLL_MS) {
      return this.serverPingPongTableTargets;
    }
    try {
      this.serverPingPongTableTargets = listServerPingPongTableTargets(this.dataDir);
    } catch {
      this.serverPingPongTableTargets = [];
    }
    this.lastServerPingPongTablePollMs = nowMs;
    return this.serverPingPongTableTargets;
  }

  serverPingPongTableTargetForObjectKey(objectKey, nowMs = Date.now()) {
    const key = safeText(objectKey, '');
    return this.loadServerPingPongTableTargets(nowMs).find(table => table.objectKey === key) || null;
  }

  isAgentAvailableForServerPingPong(agentId, plan, nowMs = Date.now(), { requirePulse = true, requireSnapshot = false } = {}) {
    const id = safeText(agentId, '');
    if (!id || !plan?.idleAgentIds?.includes?.(id)) return false;
    if (Number(this.serverPingPongCooldowns.get(id) || 0) > nowMs) return false;
    if (requirePulse && !this.ensureServerScriptedIdlePulseDue(id, nowMs)) return false;
    for (const match of this.serverPingPongMatches.values()) {
      if (match.p1Id === id || match.p2Id === id) return false;
    }
    const existing = this.state.agents.get(id);
    if (!existing && requireSnapshot) return false;
    if (!existing) return true;
    const current = snapshotToPlain(existing);
    if (current.owner === SERVER_PINGPONG_RUNTIME_OWNER || current.leaseOwner === SERVER_PINGPONG_RUNTIME_LEASE_OWNER) return false;
    if (hasActiveLease(existing, nowMs)) return false;
    const state = String(current.state || '').toLowerCase();
    if (state && !['idle', 'scripted'].includes(state)) return false;
    return true;
  }

  isServerPingPongTableAvailable(tableTarget, nowMs = Date.now()) {
    if (!tableTarget?.objectKey) return false;
    if (this.serverPingPongMatches.has(tableTarget.objectKey)) return false;
    if (Number(this.serverPingPongTableCooldowns.get(tableTarget.objectKey) || 0) > nowMs) return false;
    const object = this.state.objects.get(tableTarget.objectKey);
    if (!object) return true;
    const plain = worldObjectToPlain(object);
    if (plain.owner === SERVER_PINGPONG_RUNTIME_OWNER && hasActiveWorldObjectState(object, nowMs)) return false;
    return !hasActiveWorldObjectState(object, nowMs);
  }

  pickServerPingPongPair(tableTarget, plan, nowMs = Date.now(), { requirePulse = true, requireSnapshot = false } = {}) {
    const idleAgentIds = Array.isArray(plan?.idleAgentIds) ? plan.idleAgentIds : [];
    const centerX = (numberOr(tableTarget?.left?.x, 0) + numberOr(tableTarget?.right?.x, 0)) / 2;
    const centerY = (numberOr(tableTarget?.left?.y, 0) + numberOr(tableTarget?.right?.y, 0)) / 2;
    const candidates = idleAgentIds
      .filter(agentId => this.isAgentAvailableForServerPingPong(agentId, plan, nowMs, { requirePulse, requireSnapshot }))
      .map(agentId => {
        const existing = this.state.agents.get(agentId);
        const current = existing ? snapshotToPlain(existing) : {};
        const distance = Number.isFinite(Number(current.x)) && Number.isFinite(Number(current.y))
          ? Math.hypot(Number(current.x) - centerX, Number(current.y) - centerY)
          : LIVE_ACTION_API_TILE * 30;
        const stable = stableTextHash(`${tableTarget.objectKey}:${agentId}:${Math.floor(nowMs / 10000)}`) % 1000;
        return { agentId, score: distance + stable / 1000 };
      })
      .sort((a, b) => a.score - b.score);
    if (candidates.length < 2) return null;
    return [candidates[0].agentId, candidates[1].agentId];
  }

  upsertServerPingPongAgent(match, tableTarget, agentId, side, point, nowMs, now, { isMoving = false, movement = null, state = 'using' } = {}) {
    const partnerAgentId = side === 'right' ? match.p1Id : match.p2Id;
    const target = makeServerPingPongTarget(tableTarget, side, agentId, partnerAgentId, match, point, now);
    if (!target) return null;
    const routeId = safeText(`server-pingpong:${match.matchId}:${agentId}`, `server-pingpong:${agentId}`) || `server-pingpong:${agentId}`;
    return this.upsertSnapshot({
      agentId,
      mode: 'live',
      owner: SERVER_PINGPONG_RUNTIME_OWNER,
      x: isMoving ? numberOr(movement?.x, point.x) : point.x,
      y: isMoving ? numberOr(movement?.y, point.y) : point.y,
      floor: isMoving ? floorOr(movement?.floor, point.floor) : point.floor,
      buildingId: isMoving ? safeText(movement?.buildingId || '', '') : (tableTarget.buildingId || ''),
      roomId: isMoving ? safeText(movement?.roomId || '', '') : (tableTarget.roomId || ''),
      heading: isMoving ? numberOr(movement?.heading, point.faceAngle) : point.faceAngle,
      state,
      routeId,
      worldActionId: '',
      target,
      leaseOwner: SERVER_PINGPONG_RUNTIME_LEASE_OWNER,
      leaseExpiresAt: new Date(nowMs + SERVER_PINGPONG_RUNTIME_LEASE_TTL_MS).toISOString(),
      visualState: isMoving
        ? withRuntimeRouteVisualState(makeServerPingPongVisualState(true, target, match, nowMs), movement?.route || null)
        : makeServerPingPongVisualState(false, target, match, nowMs),
    }, `server-pingpong-${state}`, {
      routeId,
      objectKey: match.objectKey,
      matchId: match.matchId,
      side,
    });
  }

  upsertServerPingPongWorldObject(match, tableTarget, state, nowMs, now) {
    const expiresAt = new Date(nowMs + SERVER_PINGPONG_RUNTIME_LEASE_TTL_MS + SERVER_PINGPONG_RUNTIME_MATCH_MS).toISOString();
    return this.upsertWorldObject({
      objectKey: match.objectKey,
      owner: SERVER_PINGPONG_RUNTIME_OWNER,
      objectType: 'pingpong',
      buildingId: tableTarget.buildingId || '',
      furnitureIndex: tableTarget.furnitureIndex ?? -1,
      state,
      agentId: match.p1Id || '',
      actionId: 'life.playPingPong',
      reservationId: safeText(`server-pingpong-res:${match.objectKey}`, '') || `server-pingpong-res:${match.matchId}`,
      activeUseId: state === 'routing' ? '' : (safeText(`server-pingpong-active:${match.objectKey}`, '') || `server-pingpong-active:${match.matchId}`),
      slotId: 'player-left,player-right',
      expiresAt,
      data: makeServerPingPongObjectData(match, tableTarget, state, now, expiresAt),
    }, `server-pingpong-world-${state}`, {
      objectKey: match.objectKey,
      matchId: match.matchId,
    });
  }

  releaseServerPingPongAgent(agentId, tableTarget, side = 'left', matchId = '', objectKey = '', nowMs = Date.now(), now = new Date(nowMs).toISOString(), reason = 'complete') {
    const id = safeText(agentId, '');
    if (!id) return 0;
    const sideKey = side === 'right' ? 'right' : 'left';
    const existing = this.state.agents.get(id);
    const current = existing ? snapshotToPlain(existing) : {};
    const releasePoint = tableTarget ? serverPingPongReleasePointFromTable(tableTarget, sideKey, `${matchId || objectKey}:${id}`) : null;
    this.upsertSnapshot({
      agentId: id,
      mode: 'scripted',
      owner: 'agent-scripted-mode',
      x: numberOr(releasePoint?.x, current.x || 0),
      y: numberOr(releasePoint?.y, current.y || 0),
      floor: floorOr(releasePoint?.floor ?? current.floor, 1),
      buildingId: safeText(releasePoint?.buildingId || current.buildingId || '', ''),
      roomId: safeText(releasePoint?.roomId || current.roomId || '', ''),
      heading: headingOr(releasePoint?.heading ?? current.heading, current.heading || 0),
      state: 'idle',
      routeId: '',
      worldActionId: '',
      target: null,
      leaseOwner: '',
      leaseExpiresAt: '',
      visualState: makeServerScriptedObjectIdleVisualState(),
    }, 'server-pingpong-released', {
      objectKey,
      matchId,
      reason,
      side: sideKey,
    });
    this.serverPingPongCooldowns.set(id, nowMs + SERVER_PINGPONG_RUNTIME_COOLDOWN_MS);
    this.scheduleServerScriptedIdlePulse(id, [2500, 7000], 'pingpong-complete', nowMs);
    return 1;
  }

  startServerPingPongMatch(tableTarget, p1Id, p2Id, nowMs = Date.now(), now = new Date(nowMs).toISOString(), options = {}) {
    const match = makeServerPingPongMatch(tableTarget, p1Id, p2Id, nowMs, options.source || 'idle');
    this.serverPingPongMatches.set(match.objectKey, match);
    this.scheduleServerScriptedIdlePulse(p1Id, SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS, 'success:server-pingpong', nowMs);
    this.scheduleServerScriptedIdlePulse(p2Id, SERVER_SCRIPTED_IDLE_INITIAL_DELAY_MS, 'success:server-pingpong', nowMs);
    const players = [
      { agentId: p1Id, side: 'left', point: tableTarget.left },
      { agentId: p2Id, side: 'right', point: tableTarget.right },
    ];
    for (const player of players) {
      const existing = this.ensureServerRuntimeAgentSeed(player.agentId, player.point, 'server-pingpong-start');
      const current = snapshotToPlain(existing);
      const movement = makeServerRuntimeStep(this.dataDir, player.agentId, current, player.point, DEFAULT_WORLD_RUNTIME_TICK_MS, {
        speedUnitsPerSec: SERVER_PINGPONG_RUNTIME_SPEED_UNITS_PER_SEC,
        arrivalRadius: SERVER_PINGPONG_RUNTIME_ARRIVAL_RADIUS,
        routeSource: SERVER_PINGPONG_RUNTIME_OWNER,
      });
      const arrived = movement.arrived;
      this.upsertServerPingPongAgent(match, tableTarget, player.agentId, player.side, player.point, nowMs, now, {
        isMoving: !arrived,
        movement,
        state: arrived ? 'waiting' : 'routing',
      });
    }
    this.upsertServerPingPongWorldObject(match, tableTarget, 'routing', nowMs, now);
    return { changedSnapshots: 2, changedObjects: 1, match };
  }

  releaseServerPingPongMatch(match, tableTarget, nowMs = Date.now(), now = new Date(nowMs).toISOString(), reason = 'complete') {
    if (!match) return { changedSnapshots: 0, changedObjects: 0 };
    const table = tableTarget || this.serverPingPongTableTargetForObjectKey(match.objectKey, nowMs);
    const players = [
      { agentId: match.p1Id, side: 'left' },
      { agentId: match.p2Id, side: 'right' },
    ];
    let changedSnapshots = 0;
    for (const player of players) {
      if (!player.agentId) continue;
      changedSnapshots += this.releaseServerPingPongAgent(player.agentId, table, player.side, match.matchId, match.objectKey, nowMs, now, reason);
    }
    this.serverPingPongMatches.delete(match.objectKey);
    this.serverPingPongTableCooldowns.set(match.objectKey, nowMs + SERVER_PINGPONG_RUNTIME_TABLE_COOLDOWN_MS);
    let changedObjects = 0;
    if (table) {
      const expiresAt = new Date(nowMs + 1000).toISOString();
      this.upsertWorldObject({
        objectKey: match.objectKey,
        owner: SERVER_PINGPONG_RUNTIME_OWNER,
        objectType: 'pingpong',
        buildingId: table.buildingId || '',
        furnitureIndex: table.furnitureIndex ?? -1,
        state: 'idle',
        agentId: '',
        actionId: 'life.playPingPong',
        reservationId: '',
        activeUseId: '',
        slotId: '',
        expiresAt,
        data: makeServerPingPongObjectData(match, table, 'idle', now, expiresAt),
      }, 'server-pingpong-world-idle', {
        objectKey: match.objectKey,
        matchId: match.matchId,
        reason,
      });
      changedObjects = 1;
    }
    return { changedSnapshots, changedObjects };
  }

  sweepServerPingPongRuntime(tables = [], nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
    const tableByKey = new Map((Array.isArray(tables) ? tables : []).map(table => [table.objectKey, table]));
    let changedSnapshots = 0;
    let changedObjects = 0;

    for (const [agentId, existing] of Array.from(this.state.agents.entries())) {
      const current = snapshotToPlain(existing);
      const target = current.target && typeof current.target === 'object' ? current.target : null;
      const objectKey = safeText(target?.objectKey || target?.baseObjectKey, '');
      const ownedByPingPong = current.owner === SERVER_PINGPONG_RUNTIME_OWNER || current.leaseOwner === SERVER_PINGPONG_RUNTIME_LEASE_OWNER || isPingPongObjectType(target?.objectType);
      if (!ownedByPingPong) continue;
      const match = objectKey ? this.serverPingPongMatches.get(objectKey) : null;
      if (match && (match.p1Id === agentId || match.p2Id === agentId)) continue;
      const table = objectKey ? (tableByKey.get(objectKey) || this.serverPingPongTableTargetForObjectKey(objectKey, nowMs)) : null;
      changedSnapshots += this.releaseServerPingPongAgent(agentId, table, target?.side === 'right' ? 'right' : 'left', match?.matchId || '', objectKey, nowMs, now, match ? 'stray-player-released' : 'orphan-player-released');
    }

    for (const [objectKey, existing] of Array.from(this.state.objects.entries())) {
      const plain = worldObjectToPlain(existing);
      if (plain.owner !== SERVER_PINGPONG_RUNTIME_OWNER || !isPingPongObjectType(plain.objectType)) continue;
      if (this.serverPingPongMatches.has(objectKey)) continue;
      const hasRuntimeState = hasActiveWorldObjectState(existing, nowMs) || Boolean(plain.reservationId || plain.activeUseId || plain.data?.pingPongGame);
      if (!hasRuntimeState && String(plain.state || '').toLowerCase() === 'idle') continue;
      const table = tableByKey.get(objectKey) || this.serverPingPongTableTargetForObjectKey(objectKey, nowMs);
      const game = plain.data?.pingPongGame && typeof plain.data.pingPongGame === 'object' ? plain.data.pingPongGame : {};
      const playerIds = new Set([
        plain.agentId,
        game.p1Id,
        game.p2Id,
        ...(Array.isArray(plain.data?.reservation?.agentIds) ? plain.data.reservation.agentIds : []),
        ...(Array.isArray(plain.data?.activeUse?.agentIds) ? plain.data.activeUse.agentIds : []),
      ].map(id => safeText(id, '')).filter(Boolean));
      for (const playerId of playerIds) {
        const current = this.state.agents.get(playerId);
        if (!current) continue;
        const snapshot = snapshotToPlain(current);
        const target = snapshot.target && typeof snapshot.target === 'object' ? snapshot.target : null;
        if (snapshot.owner !== SERVER_PINGPONG_RUNTIME_OWNER && snapshot.leaseOwner !== SERVER_PINGPONG_RUNTIME_LEASE_OWNER && target?.objectKey !== objectKey) continue;
        changedSnapshots += this.releaseServerPingPongAgent(playerId, table, target?.side === 'right' ? 'right' : 'left', safeText(game.matchId, ''), objectKey, nowMs, now, 'orphan-object-released');
      }
      const expiresAt = new Date(nowMs + 1000).toISOString();
      this.upsertWorldObject({
        objectKey,
        owner: SERVER_PINGPONG_RUNTIME_OWNER,
        objectType: 'pingpong',
        buildingId: plain.buildingId || table?.buildingId || '',
        furnitureIndex: plain.furnitureIndex ?? table?.furnitureIndex ?? -1,
        state: 'idle',
        agentId: '',
        actionId: 'life.playPingPong',
        reservationId: '',
        activeUseId: '',
        slotId: '',
        expiresAt,
        data: {
          clearReservation: true,
          activeUse: {
            state: 'idle',
            mode: 'orphan-cleared',
            runtimeWorldObject: true,
            runtimeOwner: SERVER_PINGPONG_RUNTIME_OWNER,
          },
          pingPongGame: null,
          writer: 'agent-runtime-room.mjs#serverPingPongRuntime',
        },
      }, 'server-pingpong-world-orphan-cleared', {
        objectKey,
        reason: 'orphaned-server-pingpong-object',
      });
      this.serverPingPongTableCooldowns.set(objectKey, nowMs + SERVER_PINGPONG_RUNTIME_TABLE_COOLDOWN_MS);
      changedObjects++;
    }

    return { changedSnapshots, changedObjects };
  }

  advanceServerPingPongMatch(match, tableTarget, tickMs, nowMs, now) {
    if (!match || !tableTarget) return this.releaseServerPingPongMatch(match, tableTarget, nowMs, now, 'missing-table');
    const p1Existing = this.state.agents.get(match.p1Id);
    const p2Existing = this.state.agents.get(match.p2Id);
    if (!p1Existing || !p2Existing) return this.releaseServerPingPongMatch(match, tableTarget, nowMs, now, 'missing-player');
    const p1 = snapshotToPlain(p1Existing);
    const p2 = snapshotToPlain(p2Existing);
    let changedSnapshots = 0;
    let changedObjects = 0;
    if (match.phase === 'approach') {
      const players = [
        { current: p1, agentId: match.p1Id, side: 'left', point: tableTarget.left },
        { current: p2, agentId: match.p2Id, side: 'right', point: tableTarget.right },
      ];
      let allArrived = true;
      for (const player of players) {
        const distance = Math.hypot(numberOr(player.current.x, 0) - player.point.x, numberOr(player.current.y, 0) - player.point.y);
        const alreadyArrived = ['waiting', 'using'].includes(String(player.current.state || '').toLowerCase()) && distance <= SERVER_PINGPONG_RUNTIME_ARRIVAL_RADIUS;
        const movement = alreadyArrived ? { arrived: true, x: player.point.x, y: player.point.y, heading: player.point.faceAngle, route: null } : makeServerRuntimeStep(this.dataDir, player.agentId, player.current, player.point, tickMs, {
          speedUnitsPerSec: SERVER_PINGPONG_RUNTIME_SPEED_UNITS_PER_SEC,
          arrivalRadius: SERVER_PINGPONG_RUNTIME_ARRIVAL_RADIUS,
          routeSource: SERVER_PINGPONG_RUNTIME_OWNER,
        });
        const arrived = alreadyArrived || movement.arrived;
        allArrived = allArrived && arrived;
        this.upsertServerPingPongAgent(match, tableTarget, player.agentId, player.side, player.point, nowMs, now, {
          isMoving: !arrived,
          movement,
          state: arrived ? 'waiting' : 'routing',
        });
        changedSnapshots++;
      }
      this.upsertServerPingPongWorldObject(match, tableTarget, 'routing', nowMs, now);
      changedObjects++;
      if (allArrived) {
        match.phase = 'playing';
        match.phaseStartedAtMs = nowMs;
        match.activeAtMs = nowMs;
        resetServerPingPongBallForServe(match);
      } else if (nowMs - Number(match.startedAtMs || nowMs) > 60000) {
        return this.releaseServerPingPongMatch(match, tableTarget, nowMs, now, 'approach-timeout');
      }
      return { changedSnapshots, changedObjects };
    }

    if (match.phase === 'playing') {
      const dt = tickMs / 1000;
      const tableHalfX = 1.12;
      const tableHalfZ = 0.48;
      const hitPlaneX = 1.04;
      const paddleReachZ = 0.24;
      match.pointTimerMs = Math.max(0, numberOr(match.pointTimerMs, 0) + tickMs);
      match.servePauseMs = Math.max(0, numberOr(match.servePauseMs, 0) - tickMs);
      const serving = match.servePauseMs > 0;
      if (!serving) {
        match.ballX += numberOr(match.ballVX, 0) * dt * 3.05;
        match.ballZ += numberOr(match.ballVZ, 0) * dt * 3.05;
        if (Math.abs(match.ballZ) > tableHalfZ) {
          match.ballZ = Math.sign(match.ballZ || 1) * tableHalfZ;
          match.ballVZ = -numberOr(match.ballVZ, 0) * 0.92;
        }
      }
      const elapsedSec = Math.max(0, (nowMs - Number(match.phaseStartedAtMs || nowMs)) / 1000);
      const p1Skill = Math.max(0.35, Math.min(0.95, numberOr(match.p1Skill, 0.7)));
      const p2Skill = Math.max(0.35, Math.min(0.95, numberOr(match.p2Skill, 0.7)));
      const p1AimError = (1 - p1Skill) * Math.sin(elapsedSec * 2.3 + 0.4) * 0.42;
      const p2AimError = (1 - p2Skill) * Math.sin(elapsedSec * 2.1 + 1.7) * 0.42;
      match.p1TrackZ += (((match.ballVX || 0) < 0 ? match.ballZ + p1AimError : match.ballZ * 0.28) - (match.p1TrackZ || 0)) * (0.12 + p1Skill * 0.10);
      match.p2TrackZ += (((match.ballVX || 0) > 0 ? match.ballZ + p2AimError : match.ballZ * 0.28) - (match.p2TrackZ || 0)) * (0.12 + p2Skill * 0.10);
      match.p1TrackZ = Math.max(-0.42, Math.min(0.42, match.p1TrackZ || 0));
      match.p2TrackZ = Math.max(-0.42, Math.min(0.42, match.p2TrackZ || 0));
      const scorePoint = (winner, loser, reason) => {
        if (winner === 'p1') match.p1Score = Math.min(SERVER_PINGPONG_RUNTIME_TARGET_SCORE, (match.p1Score || 0) + 1);
        else match.p2Score = Math.min(SERVER_PINGPONG_RUNTIME_TARGET_SCORE, (match.p2Score || 0) + 1);
        match.lastPoint = { winner, loser, reason, atMs: nowMs };
        match.nextServe = loser;
        resetServerPingPongBallForServe(match);
        if (winner === 'p1') match.p1SwingPulseId = Number(match.p1SwingPulseId || 0) + 1;
        else match.p2SwingPulseId = Number(match.p2SwingPulseId || 0) + 1;
        if ((match.p1Score || 0) >= SERVER_PINGPONG_RUNTIME_TARGET_SCORE || (match.p2Score || 0) >= SERVER_PINGPONG_RUNTIME_TARGET_SCORE) {
          match.phase = 'result';
          match.phaseStartedAtMs = nowMs;
        }
      };
      const p1Incoming = !serving && match.ballX <= -hitPlaneX && (match.ballVX || 0) < 0;
      const p2Incoming = !serving && match.ballX >= hitPlaneX && (match.ballVX || 0) > 0;
      if (p1Incoming || p2Incoming) {
        const isP1 = !!p1Incoming;
        const paddleZ = isP1 ? match.p1TrackZ : match.p2TrackZ;
        const skill = isP1 ? p1Skill : p2Skill;
        const missDistance = Math.abs((match.ballZ || 0) - (paddleZ || 0));
        const pressure = Math.min(0.22, Math.max(0, (Math.abs(match.ballVZ || 0) - 0.22) * 0.18 + (match.rallyHits || 0) * 0.008));
        const randomMiss = Math.random() > Math.max(0.08, skill - pressure);
        if (missDistance > paddleReachZ || randomMiss) {
          scorePoint(isP1 ? 'p2' : 'p1', isP1 ? 'p1' : 'p2', missDistance > paddleReachZ ? 'missed wide' : 'forced error');
        } else {
          match.ballX = isP1 ? -hitPlaneX : hitPlaneX;
          match.ballVX = Math.abs(match.ballVX || 0.62) * (isP1 ? 1 : -1) * (1.00 + Math.random() * 0.06);
          match.ballVZ = ((match.ballZ || 0) - paddleZ) * 1.25 + (Math.random() - 0.5) * (0.18 + (1 - skill) * 0.16);
          match.lastHit = isP1 ? 'p1' : 'p2';
          match.rallyHits = (match.rallyHits || 0) + 1;
          if (isP1) match.p1SwingPulseId = Number(match.p1SwingPulseId || 0) + 1;
          else match.p2SwingPulseId = Number(match.p2SwingPulseId || 0) + 1;
        }
      }
      if (match.phase === 'playing' && !serving && Math.abs(match.ballX) > tableHalfX) {
        scorePoint(match.ballX > 0 ? 'p1' : 'p2', match.ballX > 0 ? 'p2' : 'p1', 'missed return');
      }
      match.ballVX = Math.max(-1.05, Math.min(1.05, match.ballVX || 0.62));
      match.ballVZ = Math.max(-0.62, Math.min(0.62, match.ballVZ || 0));
      const activeAtMs = Number(match.activeAtMs || match.phaseStartedAtMs || nowMs);
      if (match.phase === 'playing' && nowMs - activeAtMs > SERVER_PINGPONG_RUNTIME_MATCH_MS) {
        match.phase = 'result';
        match.phaseStartedAtMs = nowMs;
        match.lastPoint = match.lastPoint || { winner: (match.p1Score || 0) >= (match.p2Score || 0) ? 'p1' : 'p2', loser: (match.p1Score || 0) >= (match.p2Score || 0) ? 'p2' : 'p1', reason: 'time', atMs: nowMs };
      }
    }

    const leftPoint = serverPingPongPointFromTable(tableTarget, 'left', match.p1TrackZ || 0) || tableTarget.left;
    const rightPoint = serverPingPongPointFromTable(tableTarget, 'right', match.p2TrackZ || 0) || tableTarget.right;
    this.upsertServerPingPongAgent(match, tableTarget, match.p1Id, 'left', leftPoint, nowMs, now, { isMoving: false, state: match.phase === 'result' ? 'waiting' : 'using' });
    this.upsertServerPingPongAgent(match, tableTarget, match.p2Id, 'right', rightPoint, nowMs, now, { isMoving: false, state: match.phase === 'result' ? 'waiting' : 'using' });
    changedSnapshots += 2;
    this.upsertServerPingPongWorldObject(match, tableTarget, match.phase === 'result' ? 'active' : 'active', nowMs, now);
    changedObjects++;
    if (match.phase === 'result' && nowMs - Number(match.phaseStartedAtMs || nowMs) > SERVER_PINGPONG_RUNTIME_RESULT_MS) {
      const released = this.releaseServerPingPongMatch(match, tableTarget, nowMs, now, 'complete');
      changedSnapshots += released.changedSnapshots;
      changedObjects += released.changedObjects;
    }
    return { changedSnapshots, changedObjects };
  }

  tickServerPingPongRuntime(tickMs, nowMs = Date.now(), now = new Date(nowMs).toISOString(), plan = null) {
    const runtimePlan = plan || this.loadScriptedObjectRuntimePlan(nowMs);
    const tables = this.loadServerPingPongTableTargets(nowMs);
    let changedSnapshots = 0;
    let changedObjects = 0;

    for (const [objectKey, match] of Array.from(this.serverPingPongMatches.entries())) {
      const tableTarget = tables.find(table => table.objectKey === objectKey) || this.serverPingPongTableTargetForObjectKey(objectKey);
      const changed = this.advanceServerPingPongMatch(match, tableTarget, tickMs, nowMs, now);
      changedSnapshots += changed.changedSnapshots;
      changedObjects += changed.changedObjects;
    }

    const swept = this.sweepServerPingPongRuntime(tables, nowMs, now);
    changedSnapshots += swept.changedSnapshots;
    changedObjects += swept.changedObjects;

    for (const [agentId, untilMs] of Array.from(this.serverPingPongCooldowns.entries())) {
      if (Number(untilMs || 0) <= nowMs) this.serverPingPongCooldowns.delete(agentId);
    }
    for (const [objectKey, untilMs] of Array.from(this.serverPingPongTableCooldowns.entries())) {
      if (Number(untilMs || 0) <= nowMs) this.serverPingPongTableCooldowns.delete(objectKey);
    }

    if (this.serverPingPongMatches.size >= SERVER_PINGPONG_RUNTIME_MAX_ACTIVE_MATCHES) {
      return { changedSnapshots, changedObjects };
    }

    for (const tableTarget of tables) {
      if (this.serverPingPongMatches.size >= SERVER_PINGPONG_RUNTIME_MAX_ACTIVE_MATCHES) break;
      if (!this.isServerPingPongTableAvailable(tableTarget, nowMs)) continue;
      const pair = this.pickServerPingPongPair(tableTarget, runtimePlan, nowMs, { requirePulse: true, requireSnapshot: true });
      if (!pair) continue;
      const started = this.startServerPingPongMatch(tableTarget, pair[0], pair[1], nowMs, now, { source: 'idle' });
      changedSnapshots += started.changedSnapshots;
      changedObjects += started.changedObjects;
    }

    return { changedSnapshots, changedObjects };
  }

  handlePingPongMatchRequest(client, message = {}) {
    this.withErrors(client, message, 'runtime:pingPongMatchRequest', () => {
      this.expireStaleRouteLeases();
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const buildingId = safeText(message.buildingId || message?.target?.buildingId, '');
      const furnitureIndex = Math.floor(numberOr(message.furnitureIndex ?? message?.target?.furnitureIndex, -1));
      const objectKey = safeText(message.objectKey || message?.target?.objectKey, '') || (buildingId && furnitureIndex >= 0 ? serverPingPongObjectKey(buildingId, furnitureIndex) : '');
      const tableTarget = this.serverPingPongTableTargetForObjectKey(objectKey);
      if (!tableTarget) throw apiError('invalid_pingpong_table', 'ping-pong match request requires a resolvable ping-pong table');
      if (!this.isServerPingPongTableAvailable(tableTarget, nowMs)) {
        throw apiError('object_state_conflict', 'ping-pong table already has an active match', { objectKey });
      }
      const plan = this.loadScriptedObjectRuntimePlan(nowMs);
      const requestedAgents = Array.isArray(message.agentIds) ? message.agentIds.map(id => safeText(id, '')).filter(Boolean) : [];
      const pair = requestedAgents.length >= 2 &&
        requestedAgents.slice(0, 2).every(agentId => this.isAgentAvailableForServerPingPong(agentId, plan, nowMs, { requirePulse: false }))
        ? requestedAgents.slice(0, 2)
        : this.pickServerPingPongPair(tableTarget, plan, nowMs, { requirePulse: false });
      if (!pair) throw apiError('no_pingpong_pair', 'ping-pong needs two idle agents');
      const result = this.startServerPingPongMatch(tableTarget, pair[0], pair[1], nowMs, now, { source: safeText(message.source, 'request') || 'request' });
      client.send('runtime:ack', {
        requestId: requestIdFrom(message),
        type: 'runtime:pingPongMatchRequest',
        ok: true,
        objectKey,
        matchId: result.match.matchId,
        agentIds: pair,
      });
    });
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
    if (active.length === 0) {
      this.liveActionRouteWatchdog?.clear?.();
      return { changedActions: false, changedSnapshots: 0 };
    }
    if (!(this.liveActionRouteWatchdog instanceof Map)) this.liveActionRouteWatchdog = new Map();
    const activeActionIds = new Set(active.map(item => safeText(item?.id || item?.worldActionId, '')).filter(Boolean));
    for (const trackedActionId of this.liveActionRouteWatchdog.keys()) {
      if (!activeActionIds.has(trackedActionId)) this.liveActionRouteWatchdog.delete(trackedActionId);
    }

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
      let existing = this.state.agents.get(agentId);
      if (targetPoint && !existing) {
        existing = this.ensureServerRuntimeAgentSeed(agentId, targetPoint, 'live-action-runtime-start');
        changedSnapshots++;
      }
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
	      const movement = makeLiveActionRuntimeMovement(this.dataDir, agentId, current, targetPoint, tickMs, {
	        crowdAgents: serverRuntimeCrowdAgents(this.state, agentId),
	      });
      const arrived = movement.arrived;
      const nextX = movement.x;
      const nextY = movement.y;
      const heading = movement.heading;
      const snapshotTarget = makeLiveActionSnapshotTarget(action, targetPoint);
      const routeId = safeText(action?.route?.id || action?.route?.routeId, `route-${actionId}`) || `route-${actionId}`;

      const routeProgress = observeServerRuntimeRouteProgress(this.liveActionRouteWatchdog, actionId, {
        routeId,
        nowMs,
        x: nextX,
        y: nextY,
        distanceToFinal: movement.distanceToFinal,
        arrived,
      });
      if (!arrived && (status === 'routing' || status === 'route_pending')) {
        if (routeProgress.stale) {
          const transitioned = this.transitionServerLiveAction(action, 'failed', {
            now,
            actor,
            source,
            reason: 'route-stale',
            failureReason: 'route_unreachable',
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
            visualState: makeLiveActionVisualState(false, 'working', action, targetPoint),
          }, 'server-live-action-route-stale', { actionId, routeId, reason: 'route-stale' });
          changedSnapshots++;
          nextHistory.unshift(action);
          this.liveActionRouteWatchdog.delete(actionId);
          continue;
        }
      }

      if (status === 'routing' || status === 'route_pending') {
        this.upsertSnapshot({
          agentId,
          mode: 'live',
          owner: LIVE_ACTION_RUNTIME_OWNER,
          x: nextX,
          y: nextY,
          floor: movement.floor,
          buildingId: movement.buildingId || '',
          roomId: movement.roomId || '',
          heading,
          state: arrived ? 'arrived' : 'routing',
          routeId,
          worldActionId: actionId,
          target: snapshotTarget,
          leaseOwner: LIVE_ACTION_RUNTIME_LEASE_OWNER,
          leaseExpiresAt: new Date(nowMs + LIVE_ACTION_RUNTIME_LEASE_TTL_MS).toISOString(),
          visualState: withRuntimeRouteVisualState(makeLiveActionVisualState(!arrived, 'working', action, targetPoint), movement.route),
        }, arrived ? 'server-live-action-arrived' : 'server-live-action-routing', { actionId, routeId });
        changedSnapshots++;
        if (!arrived) {
          const yieldResult = this.tryNudgeServerRuntimeCrowdBlocker(agentId, current, targetPoint, movement.route, nowMs, now);
          if (yieldResult.nudged) changedSnapshots++;
        }
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
        const arrivedAtMs = Date.parse(action?.timing?.arrivedAt || action?.timing?.updatedAt || '');
        const arrivalDwellMs = Math.max(1000, Math.floor(numberOr(action?.params?.microstepArrivalDwellMs, 5000)));
        if (Number.isFinite(arrivedAtMs) && nowMs - arrivedAtMs >= arrivalDwellMs) {
          const transitioned = this.transitionServerLiveAction(action, 'in_progress', {
            now,
            actor,
            source,
            reason: 'server-runtime-arrival-revalidated-activity-started',
          });
          if (transitioned.changed) {
            action = transitioned.action;
            changedActions = true;
          }
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
          visualState: makeLiveActionVisualState(false, 'working', action, targetPoint),
        }, 'server-live-action-in-progress', { actionId, routeId });
        changedSnapshots++;
        if (serverLiveActionShouldComplete(action, nowMs)) {
          const sideEffect = writeServerBuiltHomeIfNeeded(this.dataDir, action, now);
          const embodiedState = makeLiveActionEmbodiedState(action, targetPoint, 'completed');
          const result = {
            status: 'completed',
            applied: true,
            reason: 'server_authoritative_live_action_completed',
            runtime: LIVE_ACTION_RUNTIME_OWNER,
            ...(embodiedState ? { embodiedState } : {}),
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
            mode: 'live',
            owner: LIVE_ACTION_RUNTIME_OWNER,
            x: Number(targetPoint.x),
            y: Number(targetPoint.y),
            floor: targetPoint.floor,
            buildingId: targetPoint.buildingId || '',
            roomId: targetPoint.roomId || '',
            heading,
            state: 'completed',
            routeId,
            worldActionId: actionId,
            target: snapshotTarget,
            leaseOwner: LIVE_ACTION_RUNTIME_LEASE_OWNER,
            leaseExpiresAt: new Date(nowMs + LIVE_ACTION_RUNTIME_COMPLETION_VISIBLE_MS).toISOString(),
            visualState: makeLiveActionVisualState(false, 'completed', action, targetPoint),
          }, 'server-live-action-completed', { actionId, routeId });
          changedSnapshots++;
        }
      }

      status = canonicalWorldActionStatus(action.status);
      if (WORLD_ACTION_TERMINAL_STATUSES.has(status)) {
        this.liveActionRouteWatchdog.delete(actionId);
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
    this.lastLiveStatusRuntimeStepMs = nowMs;
    const plan = this.loadLiveStatusRuntimePlan(nowMs);
    const targetsByAgent = plan?.targetsByAgent && typeof plan.targetsByAgent === 'object' ? plan.targetsByAgent : {};
    const desklessWorkingIds = new Set(Array.isArray(plan?.desklessWorkingAgentIds) ? plan.desklessWorkingAgentIds : []);
    let changedSnapshots = 0;

    for (const [agentId, target] of Object.entries(targetsByAgent)) {
      if (!this.state.agents.has(agentId)) {
        this.ensureServerRuntimeAgentSeed(agentId, target, 'live-status-runtime-start');
        changedSnapshots++;
      }
    }

    for (const agentId of desklessWorkingIds) {
      if (this.state.agents.has(agentId)) continue;
      this.ensureServerRuntimeAgentSeed(agentId, null, 'live-status-deskless-seed');
      changedSnapshots++;
    }

    changedSnapshots += this.tickLiveStatusDesklessWander(desklessWorkingIds, tickMs, nowMs, now);

    for (const [agentId, existing] of this.state.agents.entries()) {
      const current = snapshotToPlain(existing);
      const target = targetsByAgent[agentId] || null;
      const ownedByStatusRuntime = current.owner === LIVE_STATUS_RUNTIME_OWNER || current.leaseOwner === LIVE_STATUS_RUNTIME_LEASE_OWNER;
      const activeOtherLease = Boolean(
        hasActiveLease(existing, nowMs) &&
        current.leaseOwner &&
        current.leaseOwner !== LIVE_STATUS_RUNTIME_LEASE_OWNER
      );

      if (!target && desklessWorkingIds.has(agentId)) continue; // deskless fallback owns this agent

      if (!target) {
        if (ownedByStatusRuntime) {
          clearDynamicInteriorRoutingForAgent(agentId);
          clearDynamicExteriorRoutingForAgent(agentId);
          const previousTarget = current.target && typeof current.target === 'object' ? current.target : null;
          const releasePoint = serverRuntimeReleasePointForTarget(this.dataDir, previousTarget, current, {
            agentId,
            state: this.state,
          });
          const objectKey = liveStatusRuntimeObjectKey(previousTarget);
          this.upsertSnapshot({
            agentId,
            mode: 'scripted',
            owner: 'agent-scripted-mode',
            x: releasePoint?.x ?? current.x,
            y: releasePoint?.y ?? current.y,
            floor: releasePoint?.floor ?? current.floor,
            buildingId: releasePoint?.buildingId || current.buildingId || '',
            roomId: releasePoint?.roomId || current.roomId || '',
            heading: releasePoint?.heading ?? current.heading,
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

      const routeCooldownUntil = Number(this.liveStatusRouteCooldowns.get(agentId) || 0);
      if (routeCooldownUntil > nowMs) continue;

      const statusKind = target.statusKind === 'meeting' ? 'meeting' : 'work';
      const movement = makeServerRuntimeStep(this.dataDir, agentId, current, target, tickMs, {
        speedUnitsPerSec: statusKind === 'meeting' ? LIVE_STATUS_RUNTIME_SPEED_UNITS_PER_SEC : LIVE_STATUS_RUNTIME_RUN_SPEED_UNITS_PER_SEC,
        arrivalRadius: LIVE_STATUS_RUNTIME_ARRIVAL_RADIUS,
        routeSource: 'server-live-status-runtime',
        crowdAgents: serverRuntimeCrowdAgents(this.state, agentId),
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

      const routeProgress = observeServerRuntimeRouteProgress(this.liveStatusRouteWatchdog, agentId, {
        routeId,
        nowMs,
        x: nextX,
        y: nextY,
        distanceToFinal: movement.distanceToFinal,
        arrived,
      });
      if (!arrived && routeProgress.stale) {
          this.liveStatusRouteWatchdog.delete(agentId);
          this.liveStatusRouteCooldowns.set(agentId, nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_COOLDOWN_MS);
          clearDynamicInteriorRoutingForAgent(agentId);
          clearDynamicExteriorRoutingForAgent(agentId);
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
          }, 'server-live-status-route-stale', { routeId, reason: 'route-stale' });
          changedSnapshots++;
          continue;
      }

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
        floor: arrived ? floorOr(target.floor, 1) : movement.floor,
        buildingId: arrived ? (target.buildingId || '') : movement.buildingId,
        roomId: arrived ? (target.roomId || '') : movement.roomId,
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
      if (!arrived) {
        const yieldResult = this.tryNudgeServerRuntimeCrowdBlocker(agentId, current, target, movement.route, nowMs, now);
        if (yieldResult.nudged) changedSnapshots++;
      }
    }

    for (const [agentId, untilMs] of Array.from(this.liveStatusRouteCooldowns.entries())) {
      if (Number(untilMs || 0) <= nowMs) this.liveStatusRouteCooldowns.delete(agentId);
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
    this.scriptedObjectRouteWatchdog?.delete?.(agentId);
    clearDynamicInteriorRoutingForAgent(agentId);
    clearDynamicExteriorRoutingForAgent(agentId);
    const objectKey = safeText(target?.objectKey, '');
    const releasePoint = serverRuntimeReleasePointForTarget(this.dataDir, target, current, {
      agentId,
      state: this.state,
    });
    const x = releasePoint?.x ?? (Number.isFinite(Number(target?.x)) ? Number(target.x) : Number(current?.x || 0));
    const y = releasePoint?.y ?? (Number.isFinite(Number(target?.y)) ? Number(target.y) : Number(current?.y || 0));
    const floor = releasePoint?.floor ?? floorOr(target?.floor ?? current?.floor, 1);
    const buildingId = releasePoint?.buildingId || target?.buildingId || current?.buildingId || '';
    const roomId = releasePoint?.roomId || target?.roomId || current?.roomId || '';
    const heading = releasePoint?.heading ?? targetFaceAngleRadians(target, current?.heading);
    const clearanceTarget = releasePoint
      ? serverRuntimeDismountClearanceTarget(this.dataDir, agentId, { ...releasePoint, x, y, floor, buildingId, roomId }, target, current, this.state, nowMs)
      : null;
    const clearanceRoute = clearanceTarget ? {
      active: true,
      source: 'server-dismount-clearance',
      reason: 'dismount-clearance',
      effectiveTarget: clearanceTarget,
      finalPoint: clearanceTarget,
      routeIndex: 1,
      route: [cloneRuntimePoint(clearanceTarget)].filter(Boolean),
      routePoints: [
        { x, y, floor, buildingId },
        cloneRuntimePoint(clearanceTarget),
      ].filter(Boolean),
    } : null;
    const snapshotResult = this.upsertSnapshot({
      agentId,
      mode: clearanceTarget ? 'live' : 'scripted',
      owner: clearanceTarget ? SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER : 'agent-scripted-mode',
      x,
      y,
      floor,
      buildingId,
      roomId,
      heading,
      state: clearanceTarget ? 'routing' : 'idle',
      routeId: clearanceTarget ? safeText(`dismount-clearance:${agentId}`, `dismount-clearance:${agentId}`) : '',
      worldActionId: '',
      target: clearanceTarget || null,
      leaseOwner: clearanceTarget ? SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER : '',
      leaseExpiresAt: clearanceTarget ? new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS).toISOString() : '',
      visualState: clearanceTarget
        ? withRuntimeRouteVisualState(makeServerScriptedObjectVisualState(true, clearanceTarget, 'idle'), clearanceRoute)
        : makeServerScriptedObjectIdleVisualState(),
    }, 'server-scripted-object-released', {
      objectKey,
      reason,
      clearanceTarget: clearanceTarget ? true : false,
    });
    const objectResult = objectKey ? this.releaseServerScriptedObjectWorldObject(agentId, target, nowMs, now, reason) : null;
    if (target?.isQueueUse) {
      this.releaseServerScriptedServiceQueueReservation(agentId, target, nowMs, now, reason);
    }
    return { agent: snapshotResult.agent, object: objectResult?.object || null };
  }

  tryNudgeServerRuntimeCrowdBlocker(movingAgentId, movingCurrent, movingTarget, route = null, nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
    if (!(this.serverRuntimeBlockerYieldCooldowns instanceof Map)) this.serverRuntimeBlockerYieldCooldowns = new Map();
    const blockedReason = String(route?.blockedReason || '');
    if (!blockedReason.startsWith('server-crowd-wait-')) return { nudged: false, reason: 'not-crowd-wait' };
    const blockers = Array.isArray(route?.crowdAvoidedAgents) ? route.crowdAvoidedAgents : [];
    for (const blocker of blockers) {
      const blockerAgentId = normalizeAgentId(blocker?.agentId);
      if (!blockerAgentId || blockerAgentId === movingAgentId) continue;
      const cooldownUntil = Number(this.serverRuntimeBlockerYieldCooldowns.get(blockerAgentId) || 0);
      if (cooldownUntil > nowMs) continue;
      const record = this.state.agents.get(blockerAgentId);
      if (!record || hasActiveLease(record, nowMs)) continue;
      const plain = snapshotToPlain(record);
      const state = String(plain.state || '').toLowerCase();
      if (!['idle', 'scripted'].includes(state)) continue;
      if (plain.target && typeof plain.target === 'object' && Object.keys(plain.target).length > 0) continue;
      const blockerPoint = normalizeServerRuntimePoint(plain, floorOr(plain.floor, movingCurrent?.floor ?? movingTarget?.floor ?? 1));
      if (!blockerPoint) continue;
      const start = normalizeServerRuntimePoint(movingCurrent, blockerPoint.floor);
      const end = normalizeServerRuntimePoint(movingTarget, blockerPoint.floor);
      const pathDx = Number(end?.x ?? blockerPoint.x) - Number(start?.x ?? blockerPoint.x);
      const pathDy = Number(end?.y ?? blockerPoint.y) - Number(start?.y ?? blockerPoint.y);
      const pathLen = Math.hypot(pathDx, pathDy);
      const awayDx = blockerPoint.x - Number(start?.x ?? blockerPoint.x);
      const awayDy = blockerPoint.y - Number(start?.y ?? blockerPoint.y);
      const awayLen = Math.hypot(awayDx, awayDy);
      const normalX = pathLen > 0.001 ? -pathDy / pathLen : 1;
      const normalY = pathLen > 0.001 ? pathDx / pathLen : 0;
      const awayX = awayLen > 0.001 ? awayDx / awayLen : normalX;
      const awayY = awayLen > 0.001 ? awayDy / awayLen : normalY;
      const directions = [
        { x: normalX, y: normalY },
        { x: -normalX, y: -normalY },
        { x: awayX, y: awayY },
        { x: -awayY, y: awayX },
        { x: awayY, y: -awayX },
      ];
      for (const distance of [SERVER_RUNTIME_BLOCKER_YIELD_DISTANCE, SERVER_RUNTIME_BLOCKER_YIELD_DISTANCE * 1.35]) {
        for (const direction of directions) {
          const candidate = {
            ...blockerPoint,
            x: blockerPoint.x + direction.x * distance,
            y: blockerPoint.y + direction.y * distance,
          };
          const staticResult = validateServerRuntimeStaticSegment(this.dataDir, blockerPoint, candidate, { phase: 'server-blocker-yield' });
          if (!staticResult.clear) continue;
          const crowdConflict = findServerRuntimeCrowdConflict(blockerAgentId, blockerPoint, candidate, serverRuntimeCrowdAgents(this.state, blockerAgentId), {
            finalTarget: candidate,
            arrivalRadius: SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS,
            routeTarget: plain.target,
          });
          if (crowdConflict) continue;
          const heading = normalizeRuntimeAngleRadians(Math.atan2(candidate.x - blockerPoint.x, candidate.y - blockerPoint.y), plain.heading || 0);
          const routePatch = {
            active: false,
            source: 'server-blocker-yield',
            reason: 'crowd-blocker-yield',
            effectiveTarget: candidate,
            finalPoint: candidate,
            routeIndex: 1,
            route: [blockerPoint, candidate],
            routePoints: [blockerPoint, candidate],
            crowdAvoidedAgents: [{ agentId: movingAgentId, distance: numberOr(blocker?.distance, 0), mode: 'yield-to-routing-agent' }],
          };
          this.upsertSnapshot({
            ...plain,
            x: candidate.x,
            y: candidate.y,
            floor: candidate.floor,
            heading,
            state: plain.state || 'idle',
            routeId: '',
            worldActionId: '',
            target: null,
            leaseOwner: '',
            leaseExpiresAt: '',
            visualState: withRuntimeRouteVisualState(makeServerScriptedObjectIdleVisualState(), routePatch),
          }, 'server-runtime-blocker-yield', {
            movingAgentId,
            blockerAgentId,
            blockedReason,
          });
          this.serverRuntimeBlockerYieldCooldowns.set(blockerAgentId, nowMs + SERVER_RUNTIME_BLOCKER_YIELD_COOLDOWN_MS);
          return { nudged: true, blockerAgentId };
        }
      }
    }
    return { nudged: false, reason: 'no-clearance-point' };
  }

  sweepLegacyServerScriptedPingPongObjects(nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
    let changedSnapshots = 0;
    let changedObjects = 0;
    const maybeAgentId = (value) => {
      const text = safeText(value, '');
      return text && AGENT_ID_RE.test(text) ? normalizeAgentId(text) : '';
    };
    for (const [rawObjectKey, existing] of Array.from(this.state.objects.entries())) {
      const plain = worldObjectToPlain(existing);
      const objectKey = safeText(plain.objectKey || rawObjectKey, '') || String(rawObjectKey || '');
      if (plain.owner !== SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || !isPingPongObjectType(plain.objectType)) continue;
      if (String(plain.state || '').toLowerCase() === 'idle' && plain.data?.releaseReason === 'legacy-scripted-pingpong-cleared') continue;
      const data = plain.data && typeof plain.data === 'object' ? plain.data : {};
      const activity = data.activity && typeof data.activity === 'object' ? data.activity : {};
      const reservation = data.reservation && typeof data.reservation === 'object' ? data.reservation : {};
      const activeUse = data.activeUse && typeof data.activeUse === 'object' ? data.activeUse : {};
      const anchor = data.anchor && typeof data.anchor === 'object' ? data.anchor : {};
      const target = {
        objectKey,
        baseObjectKey: safeText(activity.baseObjectKey || reservation.baseObjectKey || activeUse.baseObjectKey || objectKey.replace(/:(slot|queue):.*$/, ''), ''),
        objectType: 'pingpong',
        buildingId: plain.buildingId || activity.buildingId || reservation.buildingId || activeUse.buildingId || '',
        furnitureIndex: plain.furnitureIndex ?? activity.furnitureIndex ?? reservation.furnitureIndex ?? activeUse.furnitureIndex ?? -1,
        actionId: activity.actionId || plain.actionId || 'life.playPingPong',
        slotId: plain.slotId || activity.slotId || reservation.slotId || activeUse.slotId || activity.spotId || '',
        spotId: activity.spotId || reservation.spotId || activeUse.spotId || plain.slotId || '',
        x: Number.isFinite(Number(anchor.x)) ? Number(anchor.x) : NaN,
        y: Number.isFinite(Number(anchor.y)) ? Number(anchor.y) : NaN,
        floor: floorOr(anchor.floor ?? activity.floor, 1),
        runtimeSource: 'legacy-scripted-pingpong-cleanup',
      };
      const releaseIds = new Set([
        plain.agentId,
        reservation.agentId,
        activeUse.agentId,
        ...(Array.isArray(reservation.agentIds) ? reservation.agentIds : []),
        ...(Array.isArray(activeUse.agentIds) ? activeUse.agentIds : []),
      ].map(maybeAgentId).filter(Boolean));
      for (const [agentId, record] of this.state.agents.entries()) {
        const current = snapshotToPlain(record);
        if (current.owner !== SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER && current.leaseOwner !== SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER) continue;
        const agentTarget = current.target && typeof current.target === 'object' ? current.target : null;
        if (!isPingPongObjectType(agentTarget?.objectType)) continue;
        const agentObjectKey = safeText(agentTarget.objectKey, '');
        const agentBaseObjectKey = safeText(agentTarget.baseObjectKey, '');
        if (agentObjectKey === objectKey || (target.baseObjectKey && agentBaseObjectKey === target.baseObjectKey)) {
          const normalizedAgentId = maybeAgentId(agentId);
          if (normalizedAgentId) releaseIds.add(normalizedAgentId);
        }
      }
      for (const agentId of releaseIds) {
        const record = this.state.agents.get(agentId);
        if (!record) continue;
        const current = snapshotToPlain(record);
        if (current.owner !== SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER && current.leaseOwner !== SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER) continue;
        const agentTarget = current.target && typeof current.target === 'object' ? current.target : target;
        this.releaseServerScriptedObjectRoute(agentId, current, agentTarget || target, nowMs, now, 'legacy-scripted-pingpong-cleared');
        changedSnapshots++;
        changedObjects++;
      }
      const expiresAt = new Date(nowMs + 1000).toISOString();
      this.upsertWorldObject({
        objectKey,
        owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
        objectType: 'pingpong',
        buildingId: target.buildingId,
        furnitureIndex: target.furnitureIndex,
        state: 'idle',
        agentId: '',
        actionId: target.actionId,
        reservationId: '',
        activeUseId: '',
        slotId: target.slotId,
        expiresAt,
        data: {
          clearReservation: true,
          releaseReason: 'legacy-scripted-pingpong-cleared',
          writer: 'agent-runtime-room.mjs#legacyPingPongCleanup',
        },
      }, 'legacy-scripted-pingpong-cleared', { objectKey });
      changedObjects++;
    }
    return { changedSnapshots, changedObjects };
  }

  tickScriptedObjectRuntime(tickMs, nowMs = Date.now(), now = new Date(nowMs).toISOString()) {
    this.lastScriptedObjectRuntimeStepMs = nowMs;
    const plan = this.loadScriptedObjectRuntimePlan(nowMs);
    const idleAgentIds = new Set(Array.isArray(plan?.idleAgentIds) ? plan.idleAgentIds : []);
    const targets = Array.isArray(plan?.targets) ? plan.targets : [];
    let changedSnapshots = 0;
    let changedObjects = 0;
    changedSnapshots += this.tickSocialConversations(idleAgentIds, tickMs, nowMs, now);
    const freeQueuePromotions = this.promoteFreeServerScriptedServiceQueues(nowMs, now, 'runtime-free-service-queue-promote-front');
    changedSnapshots += freeQueuePromotions.changedSnapshots || 0;
    changedObjects += freeQueuePromotions.changedObjects || 0;
    const legacyPingPongSweep = this.sweepLegacyServerScriptedPingPongObjects(nowMs, now);
    changedSnapshots += legacyPingPongSweep.changedSnapshots || 0;
    changedObjects += legacyPingPongSweep.changedObjects || 0;
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
    const activeRouteStepLimit = Math.max(SERVER_SCRIPTED_OBJECT_RUNTIME_MAX_ROUTE_STEPS_PER_TICK, activeRouteLimit);

    for (const [agentId, existing] of this.state.agents.entries()) {
      const current = snapshotToPlain(existing);
      const ownedByScriptedObjectRuntime = current.owner === SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER || current.leaseOwner === SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_OWNER;
      if (!ownedByScriptedObjectRuntime) continue;
      activeScriptedRoutes++;
      if (activeScriptedRoutes > activeRouteLimit) {
        const originalTarget = current.target && typeof current.target === 'object' ? current.target : null;
        let target = originalTarget;
        target = refreshScriptedObjectRuntimeTarget(this.dataDir, target);
        target = hydrateServerScriptedDeskConsumeTargetFromVisual(target, current.visualState);
        const releaseTarget = target || originalTarget || {};
        this.releaseServerScriptedObjectRoute(agentId, current, releaseTarget, nowMs, now, 'active-route-cap');
        changedSnapshots++;
        changedObjects += releaseTarget?.objectKey ? 1 : 0;
        continue;
      }
      const originalTarget = current.target && typeof current.target === 'object' ? current.target : null;
      let target = originalTarget;
      target = refreshScriptedObjectRuntimeTarget(this.dataDir, target);
      target = hydrateServerScriptedDeskConsumeTargetFromVisual(target, current.visualState);
      const source = safeText(target?.runtimeSource, 'idle') || 'idle';
      if (!target?.objectKey || (source === 'idle' && !idleAgentIds.has(agentId))) {
        const releaseTarget = target || originalTarget || {};
        this.releaseServerScriptedObjectRoute(agentId, current, releaseTarget, nowMs, now, target?.objectKey ? 'presence-not-idle' : 'missing-target');
        changedSnapshots++;
        changedObjects += releaseTarget?.objectKey ? 1 : 0;
        continue;
      }
      const pingPongPartnerStart = this.tryStartServerScriptedPingPongPartner(agentId, target, idleAgentIds, targets, nowMs, now, { source });
      if (pingPongPartnerStart.started) {
        idleAgentIds.delete(pingPongPartnerStart.agentId);
        changedSnapshots += pingPongPartnerStart.changedSnapshots || 0;
        changedObjects += pingPongPartnerStart.changedObjects || 0;
      }
      if (
        isServerScriptedMultiSlotPlayTarget(target) &&
        !pingPongPartnerStart.started &&
        !this.serverScriptedPingPongPartnerClaimed(agentId, target, targets, nowMs)
      ) {
        this.releaseServerScriptedObjectRoute(agentId, current, target, nowMs, now, 'pingpong-no-partner');
        this.markServerScriptedRuntimeFailure(agentId, target, 'pingpong-no-partner', nowMs);
        this.scriptedObjectRuntimeCooldowns.set(agentId, nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_COOLDOWN_MS);
        changedSnapshots++;
        changedObjects++;
        continue;
      }

      const alreadyActive = ['using', 'active', 'occupied', 'queued', 'waiting'].includes(String(current.state || '').toLowerCase());
      if (!alreadyActive && activeRouteSteps >= activeRouteStepLimit) {
        continue;
      }
      if (!alreadyActive) activeRouteSteps++;
      const movement = makeServerRuntimeStep(this.dataDir, agentId, current, target, tickMs, {
        speedUnitsPerSec: serverScriptedObjectRuntimeSpeedUnitsPerSec(target, true),
        arrivalRadius: SERVER_SCRIPTED_OBJECT_RUNTIME_ARRIVAL_RADIUS,
        routeSource: 'server-scripted-object-runtime',
        crowdAgents: serverRuntimeCrowdAgents(this.state, agentId),
      });
      const arrived = alreadyActive || movement.arrived;
      const nextX = arrived ? Number(target.x) : movement.x;
      const nextY = arrived ? Number(target.y) : movement.y;
      const targetHeading = targetFaceAngleRadians(target, current.heading);
      const heading = arrived ? targetHeading : movement.heading;
      const routeId = current.routeId || safeText(`scripted-object:${agentId}:${target.buildingId || 'building'}:${target.furnitureIndex ?? 'object'}:${target.spotId || 'spot'}`, `scripted-object:${agentId}`);
      const leaseExpiresAtMs = Date.parse(current.leaseExpiresAt || '');
      const needsLeaseRefresh = !Number.isFinite(leaseExpiresAtMs) || leaseExpiresAtMs - nowMs <= SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_REFRESH_MS;

      if (!(this.scriptedObjectRouteWatchdog instanceof Map)) this.scriptedObjectRouteWatchdog = new Map();
      const routeProgress = observeServerRuntimeRouteProgress(this.scriptedObjectRouteWatchdog, agentId, {
        routeId,
        nowMs,
        x: nextX,
        y: nextY,
        distanceToFinal: movement.distanceToFinal,
        arrived,
      });
      if (!arrived && routeProgress.stale) {
        this.releaseServerScriptedObjectRoute(agentId, current, {
          ...target,
          x: current.x,
          y: current.y,
          floor: current.floor,
          buildingId: current.buildingId || '',
          roomId: current.roomId || '',
        }, nowMs, now, 'route-stale');
        this.markServerScriptedRuntimeFailure(agentId, target, 'route-stale', nowMs);
        this.scriptedObjectRuntimeCooldowns.set(agentId, nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_COOLDOWN_MS);
        changedSnapshots++;
        changedObjects++;
        continue;
      }

      if (!arrived) {
        const objectExpiresAt = new Date(nowMs + SERVER_SCRIPTED_OBJECT_RUNTIME_LEASE_TTL_MS + Math.max(SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS, numberOr(target.stayMs, SERVER_SCRIPTED_OBJECT_RUNTIME_DWELL_MS))).toISOString();
        this.upsertSnapshot({
          agentId,
          mode: 'live',
          owner: SERVER_SCRIPTED_OBJECT_RUNTIME_OWNER,
          x: nextX,
          y: nextY,
          floor: movement.floor,
          buildingId: movement.buildingId,
          roomId: movement.roomId,
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
        const yieldResult = this.tryNudgeServerRuntimeCrowdBlocker(agentId, current, target, movement.route, nowMs, now);
        if (yieldResult.nudged) changedSnapshots++;
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
        const deskTarget = makeServerScriptedFreeConsumeTarget(this.dataDir, agentId, activeTarget, nowMs, this.state)
          || makeServerScriptedDeskConsumeTarget(this.dataDir, agentId, activeTarget, nowMs, this.state);
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
      if (isServerScriptedMultiSlotPlayTarget(target) && this.serverScriptedPingPongPartnerCandidates(agentId, target, idleAgentIds, targets, nowMs).length <= 0) {
        this.markServerScriptedRuntimeFailure(agentId, target, 'pingpong-no-partner', nowMs);
        continue;
      }
      try {
        this.startServerScriptedObjectRoute(agentId, target, nowMs, now, { source: 'idle' });
        this.markServerScriptedRuntimeChoice(agentId, target, nowMs);
        const pingPongPartnerStart = this.tryStartServerScriptedPingPongPartner(agentId, target, idleAgentIds, targets, nowMs, now, { source: 'idle' });
        if (pingPongPartnerStart.started) {
          idleAgentIds.delete(pingPongPartnerStart.agentId);
          idleStarts++;
          changedSnapshots += pingPongPartnerStart.changedSnapshots || 0;
          changedObjects += pingPongPartnerStart.changedObjects || 0;
        }
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
    if (!(this.serverRuntimeBlockerYieldCooldowns instanceof Map)) this.serverRuntimeBlockerYieldCooldowns = new Map();
    for (const [agentId, untilMs] of Array.from(this.serverRuntimeBlockerYieldCooldowns.entries())) {
      if (Number(untilMs || 0) <= nowMs) this.serverRuntimeBlockerYieldCooldowns.delete(agentId);
    }

    return { changedSnapshots, changedObjects };
  }

  upsertSnapshot(raw, eventType, extra = {}) {
    const existing = this.state.agents.get(raw.agentId);
    const normalized = normalizeSnapshot(raw, existing || null);
    const tickContext = this.worldRuntimeTickContext || null;
    normalized.version = Number(existing?.version || 0) + 1;
    normalized.updatedAt = tickContext?.updatedAt || new Date().toISOString();
    if (tickContext) {
      normalized.tickSeq = tickContext.tickSeq;
      normalized.simTimeMs = tickContext.simTimeMs;
      normalized.tickMs = tickContext.tickMs;
    }
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
    const elapsedMs = this.lastWorldRuntimeTickNowMs > 0
      ? nowMs - Number(this.lastWorldRuntimeTickNowMs || 0)
      : DEFAULT_WORLD_RUNTIME_TICK_MS;
    this.lastWorldRuntimeTickNowMs = nowMs;
    const tickMs = Math.max(
      DEFAULT_WORLD_RUNTIME_TICK_MS,
      Math.min(WORLD_RUNTIME_STEP_MAX_MS, Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : DEFAULT_WORLD_RUNTIME_TICK_MS),
    );
    const now = new Date(nowMs).toISOString();
    runtime.tickMs = DEFAULT_WORLD_RUNTIME_TICK_MS;
    runtime.tickSeq = Number(runtime.tickSeq || 0) + 1;
    runtime.simTimeMs = Math.max(0, Number(runtime.simTimeMs || 0) + tickMs);
    runtime.updatedAt = now;
    this.state.updatedAt = now;
    this.worldRuntimeTickContext = Object.freeze({
      tickSeq: Number(runtime.tickSeq || 0),
      simTimeMs: Number(runtime.simTimeMs || 0),
      tickMs,
      updatedAt: now,
    });

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
    let changedPingPong = { changedSnapshots: 0, changedObjects: 0 };
    let changedScriptedObjects = { changedSnapshots: 0, changedObjects: 0 };
    try {
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
        const scriptedPlan = this.loadScriptedObjectRuntimePlan(nowMs);
        changedPingPong = process.env.VW_REALTIME_DISABLE_PINGPONG_TICK === 'true'
          ? { changedSnapshots: 0, changedObjects: 0 }
          : this.tickServerPingPongRuntime(tickMs, nowMs, now, scriptedPlan);
        changedScriptedObjects = process.env.VW_REALTIME_DISABLE_SCRIPTED_OBJECT_TICK === 'true'
          ? { changedSnapshots: 0, changedObjects: 0 }
          : this.tickScriptedObjectRuntime(tickMs, nowMs, now, scriptedPlan);
      });
    } finally {
      this.worldRuntimeTickContext = null;
    }
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
        changedPingPongSnapshots: changedPingPong.changedSnapshots,
        changedPingPongObjects: changedPingPong.changedObjects,
        changedScriptedObjectSnapshots: changedScriptedObjects.changedSnapshots,
        changedScriptedObjects: changedScriptedObjects.changedObjects,
      });
    }

    if (changedLights > 0 || changedVehicles > 0 || changedLiveActions.changedActions || changedLiveStatus.changedSnapshots > 0 || changedPingPong.changedSnapshots > 0 || changedPingPong.changedObjects > 0 || changedScriptedObjects.changedSnapshots > 0 || changedScriptedObjects.changedObjects > 0 || nowMs - Number(this.lastWorldRuntimePersistMs || 0) >= WORLD_RUNTIME_PERSIST_INTERVAL_MS) {
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
      object: worldObjectToRealtimePlain(result.object),
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
