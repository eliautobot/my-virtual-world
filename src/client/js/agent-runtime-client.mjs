const DEFAULT_ROOM = 'agent_runtime';
const DEFAULT_CONFIG = Object.freeze({ enabled: false, url: '', room: DEFAULT_ROOM });
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export function getRuntimeIdentityKeys(agent = {}) {
  const keys = new Set();
  [agent.agentId, agent.id, agent.statusKey, agent.name].forEach(value => {
    if (value != null && String(value).trim()) keys.add(String(value).trim());
  });
  return keys;
}

export function normalizeRuntimeSnapshot(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const agentId = String(raw.agentId || '').trim();
  if (!agentId) return null;
  const x = Number(raw.x);
  const y = Number(raw.y);
  const floor = Math.floor(Number(raw.floor ?? 1));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(floor)) return null;
  return Object.freeze({
    schemaVersion: String(raw.schemaVersion || 'agent-runtime/v1'),
    agentId,
    mode: String(raw.mode || 'scripted'),
    owner: String(raw.owner || ''),
    x,
    y,
    floor,
    buildingId: String(raw.buildingId || ''),
    roomId: String(raw.roomId || ''),
    heading: Number.isFinite(Number(raw.heading)) ? Number(raw.heading) : 0,
    state: String(raw.state || 'idle'),
    target: raw.target && typeof raw.target === 'object' ? Object.freeze({ ...raw.target }) : null,
    visualState: raw.visualState && typeof raw.visualState === 'object' ? Object.freeze({ ...raw.visualState }) : null,
    routeId: String(raw.routeId || ''),
    worldActionId: String(raw.worldActionId || ''),
    leaseOwner: String(raw.leaseOwner || ''),
    leaseExpiresAt: String(raw.leaseExpiresAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
  });
}

export function normalizeWorldObjectState(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const objectKey = String(raw.objectKey || '').trim();
  if (!objectKey) return null;
  return Object.freeze({
    schemaVersion: String(raw.schemaVersion || 'agent-runtime/v1'),
    objectKey,
    owner: String(raw.owner || ''),
    objectType: String(raw.objectType || ''),
    buildingId: String(raw.buildingId || ''),
    furnitureIndex: Number.isFinite(Number(raw.furnitureIndex)) ? Number(raw.furnitureIndex) : -1,
    state: String(raw.state || 'idle'),
    agentId: String(raw.agentId || ''),
    actionId: String(raw.actionId || ''),
    reservationId: String(raw.reservationId || ''),
    activeUseId: String(raw.activeUseId || ''),
    slotId: String(raw.slotId || ''),
    data: raw.data && typeof raw.data === 'object' ? Object.freeze({ ...raw.data }) : null,
    expiresAt: String(raw.expiresAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
  });
}

export function normalizeWorldRuntimeState(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const rawLights = raw.trafficLights && typeof raw.trafficLights === 'object' ? raw.trafficLights : {};
  const trafficLights = new Map();
  const entries = typeof rawLights.entries === 'function' ? rawLights.entries() : Object.entries(rawLights);
  for (const [fallbackKey, rawLight] of entries) {
    const light = normalizeTrafficLightState({ ...rawLight, key: rawLight?.key || fallbackKey });
    if (light) trafficLights.set(light.key, light);
  }
  const rawVehicles = raw.trafficVehicles && typeof raw.trafficVehicles === 'object' ? raw.trafficVehicles : {};
  const trafficVehicles = new Map();
  const vehicleEntries = typeof rawVehicles.entries === 'function' ? rawVehicles.entries() : Object.entries(rawVehicles);
  for (const [fallbackId, rawVehicle] of vehicleEntries) {
    const vehicle = normalizeTrafficVehicleState({ ...rawVehicle, vehicleId: rawVehicle?.vehicleId || fallbackId });
    if (vehicle) trafficVehicles.set(vehicle.vehicleId, vehicle);
  }
  return Object.freeze({
    schemaVersion: String(raw.schemaVersion || 'world-runtime/v1'),
    mode: String(raw.mode || 'server-authoritative'),
    tickMs: Number.isFinite(Number(raw.tickMs)) ? Number(raw.tickMs) : 500,
    tickSeq: Number.isFinite(Number(raw.tickSeq)) ? Number(raw.tickSeq) : 0,
    simTimeMs: Number.isFinite(Number(raw.simTimeMs)) ? Number(raw.simTimeMs) : 0,
    startedAt: String(raw.startedAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    topologyHash: String(raw.topologyHash || ''),
    topologyOwner: String(raw.topologyOwner || ''),
    topologyUpdatedAt: String(raw.topologyUpdatedAt || ''),
    trafficCycleMs: Number.isFinite(Number(raw.trafficCycleMs)) ? Number(raw.trafficCycleMs) : 40000,
    trafficYellowMs: Number.isFinite(Number(raw.trafficYellowMs)) ? Number(raw.trafficYellowMs) : 3000,
    trafficAllRedMs: Number.isFinite(Number(raw.trafficAllRedMs)) ? Number(raw.trafficAllRedMs) : 2000,
    trafficLights,
    trafficVehicles,
  });
}

export function normalizeTrafficLightState(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const key = String(raw.key || '').trim();
  if (!key) return null;
  return Object.freeze({
    key,
    ix: Number.isFinite(Number(raw.ix)) ? Number(raw.ix) : 0,
    iz: Number.isFinite(Number(raw.iz)) ? Number(raw.iz) : 0,
    type: String(raw.type || ''),
    openEdges: raw.openEdges && typeof raw.openEdges === 'object' ? Object.freeze({ ...raw.openEdges }) : null,
    phaseMs: Number.isFinite(Number(raw.phaseMs)) ? Number(raw.phaseMs) : 0,
    ns: String(raw.ns || 'green'),
    ew: String(raw.ew || 'red'),
    updatedAt: String(raw.updatedAt || ''),
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
  });
}

export function normalizeTrafficVehicleState(raw = null) {
  if (!raw || typeof raw !== 'object') return null;
  const vehicleId = String(raw.vehicleId || '').trim();
  if (!vehicleId) return null;
  const path = Array.isArray(raw.path)
    ? raw.path
      .map(point => ({ x: Number(point?.x), z: Number(point?.z) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.z))
    : [];
  return Object.freeze({
    vehicleId,
    vehicleType: String(raw.vehicleType || 'car'),
    color: Number.isFinite(Number(raw.color)) ? Number(raw.color) : 0,
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
    z: Number.isFinite(Number(raw.z)) ? Number(raw.z) : 0,
    dir: Number.isFinite(Number(raw.dir)) ? Number(raw.dir) : 0,
    rotationY: Number.isFinite(Number(raw.rotationY)) ? Number(raw.rotationY) : 0,
    speed: Number.isFinite(Number(raw.speed)) ? Number(raw.speed) : 0,
    speedMult: Number.isFinite(Number(raw.speedMult)) ? Number(raw.speedMult) : 1,
    path,
    pathIdx: Number.isFinite(Number(raw.pathIdx)) ? Number(raw.pathIdx) : 0,
    state: String(raw.state || 'moving'),
    updatedAt: String(raw.updatedAt || ''),
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 0,
  });
}

export function snapshotsFromRuntimeDocument(doc = null) {
  const snapshots = new Map();
  const rawAgents = doc?.agents && typeof doc.agents === 'object' ? doc.agents : {};
  for (const [fallbackId, raw] of Object.entries(rawAgents)) {
    const snapshot = normalizeRuntimeSnapshot({ ...raw, agentId: raw?.agentId || fallbackId });
    if (snapshot) snapshots.set(snapshot.agentId, snapshot);
  }
  return snapshots;
}

export function worldObjectsFromRuntimeDocument(doc = null) {
  const objects = new Map();
  const rawObjects = doc?.objects && typeof doc.objects === 'object' ? doc.objects : {};
  for (const [fallbackKey, raw] of Object.entries(rawObjects)) {
    const object = normalizeWorldObjectState({ ...raw, objectKey: raw?.objectKey || fallbackKey });
    if (object) objects.set(object.objectKey, object);
  }
  return objects;
}

export function worldRuntimeFromRuntimeDocument(doc = null) {
  return normalizeWorldRuntimeState(doc?.worldRuntime || null);
}

export function snapshotForIdentityKeys(snapshots, keys) {
  if (!snapshots || !keys) return null;
  for (const key of keys) {
    if (snapshots.has(key)) return snapshots.get(key);
  }
  return null;
}

function normalizeConfig(config = null) {
  const realtime = config?.realtime && typeof config.realtime === 'object'
    ? config.realtime
    : DEFAULT_CONFIG;
  return Object.freeze({
    enabled: realtime.enabled === true,
    url: String(realtime.url || '').trim(),
    room: String(realtime.room || DEFAULT_ROOM).trim() || DEFAULT_ROOM,
  });
}

function isLoopbackHost(hostname = '') {
  return ['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(String(hostname || '').toLowerCase());
}

function resolveRuntimeUrlForPage(rawUrl = '', windowRef = globalThis.window || globalThis) {
  const text = String(rawUrl || '').trim();
  if (!text) return '';
  const pageLocation = windowRef?.location || null;
  try {
    const parsed = new URL(text, pageLocation?.href || 'http://127.0.0.1/');
    const pageHost = String(pageLocation?.hostname || '').trim();
    if (pageHost && isLoopbackHost(parsed.hostname) && !isLoopbackHost(pageHost)) {
      parsed.hostname = pageHost;
    }
    if (pageLocation?.protocol === 'https:' && parsed.protocol === 'ws:') {
      parsed.protocol = 'wss:';
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return text;
  }
}

function snapshotsFromRoomState(room) {
  const snapshots = new Map();
  const agents = room?.state?.agents;
  if (!agents || typeof agents.entries !== 'function') return snapshots;
  for (const [agentId, raw] of agents.entries()) {
    let target = null;
    if (raw.targetJson) {
      try {
        target = JSON.parse(raw.targetJson);
      } catch {
        target = null;
      }
    }
    let visualState = null;
    if (raw.visualStateJson) {
      try {
        visualState = JSON.parse(raw.visualStateJson);
      } catch {
        visualState = null;
      }
    }
    const snapshot = normalizeRuntimeSnapshot({
      agentId: raw.agentId || agentId,
      mode: raw.mode,
      owner: raw.owner,
      x: raw.x,
      y: raw.y,
      floor: raw.floor,
      buildingId: raw.buildingId,
      roomId: raw.roomId,
      heading: raw.heading,
      state: raw.state,
      target,
      visualState,
      routeId: raw.routeId,
      worldActionId: raw.worldActionId,
      leaseOwner: raw.leaseOwner,
      leaseExpiresAt: raw.leaseExpiresAt,
      updatedAt: raw.updatedAt,
      version: raw.version,
    });
    if (snapshot) snapshots.set(snapshot.agentId, snapshot);
  }
  return snapshots;
}

function worldObjectsFromRoomState(room) {
  const objects = new Map();
  const rawObjects = room?.state?.objects;
  if (!rawObjects || typeof rawObjects.entries !== 'function') return objects;
  for (const [objectKey, raw] of rawObjects.entries()) {
    let data = null;
    if (raw.dataJson) {
      try {
        data = JSON.parse(raw.dataJson);
      } catch {
        data = null;
      }
    }
    const object = normalizeWorldObjectState({
      objectKey: raw.objectKey || objectKey,
      owner: raw.owner,
      objectType: raw.objectType,
      buildingId: raw.buildingId,
      furnitureIndex: raw.furnitureIndex,
      state: raw.state,
      agentId: raw.agentId,
      actionId: raw.actionId,
      reservationId: raw.reservationId,
      activeUseId: raw.activeUseId,
      slotId: raw.slotId,
      data,
      expiresAt: raw.expiresAt,
      updatedAt: raw.updatedAt,
      version: raw.version,
    });
    if (object) objects.set(object.objectKey, object);
  }
  return objects;
}

function worldRuntimeFromRoomState(room) {
  const raw = room?.state?.worldRuntime;
  if (!raw) return null;
  const trafficLights = {};
  const rawLights = raw.trafficLights;
  if (rawLights && typeof rawLights.entries === 'function') {
    for (const [key, light] of rawLights.entries()) {
      let openEdges = null;
      if (light.openEdgesJson) {
        try {
          openEdges = JSON.parse(light.openEdgesJson);
        } catch {
          openEdges = null;
        }
      }
      trafficLights[key] = {
        key: light.key || key,
        ix: light.ix,
        iz: light.iz,
        type: light.type,
        openEdges,
        phaseMs: light.phaseMs,
        ns: light.ns,
        ew: light.ew,
        updatedAt: light.updatedAt,
        version: light.version,
      };
    }
  }
  const trafficVehicles = {};
  const rawVehicles = raw.trafficVehicles;
  if (rawVehicles && typeof rawVehicles.entries === 'function') {
    for (const [vehicleId, vehicle] of rawVehicles.entries()) {
      let path = [];
      if (vehicle.pathJson) {
        try {
          path = JSON.parse(vehicle.pathJson);
        } catch {
          path = [];
        }
      }
      trafficVehicles[vehicleId] = {
        vehicleId: vehicle.vehicleId || vehicleId,
        vehicleType: vehicle.vehicleType,
        color: vehicle.color,
        x: vehicle.x,
        z: vehicle.z,
        dir: vehicle.dir,
        rotationY: vehicle.rotationY,
        speed: vehicle.speed,
        speedMult: vehicle.speedMult,
        path,
        pathIdx: vehicle.pathIdx,
        state: vehicle.state,
        updatedAt: vehicle.updatedAt,
        version: vehicle.version,
      };
    }
  }
  return normalizeWorldRuntimeState({
    schemaVersion: raw.schemaVersion,
    mode: raw.mode,
    tickMs: raw.tickMs,
    tickSeq: raw.tickSeq,
    simTimeMs: raw.simTimeMs,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    topologyHash: raw.topologyHash,
    topologyOwner: raw.topologyOwner,
    topologyUpdatedAt: raw.topologyUpdatedAt,
    trafficCycleMs: raw.trafficCycleMs,
    trafficYellowMs: raw.trafficYellowMs,
    trafficAllRedMs: raw.trafficAllRedMs,
    trafficLights,
    trafficVehicles,
  });
}

function waitForMessage(room, type, timeoutMs = 1500) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    let cleanup = () => clearTimeout(timer);
    const unsubscribe = room.onMessage(type, message => {
      cleanup();
      resolve(message);
    });
    cleanup = () => {
      clearTimeout(timer);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  });
}

export async function createAgentRuntimeClient({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  windowRef = globalThis.window || globalThis,
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return agentRuntimeUnavailable('fetch unavailable');
  }

  let config = DEFAULT_CONFIG;
  try {
    const response = await fetchImpl('/vw-config');
    const rawConfig = normalizeConfig(await response.json());
    config = Object.freeze({
      ...rawConfig,
      url: resolveRuntimeUrlForPage(rawConfig.url, windowRef),
    });
  } catch (error) {
    logger?.warn?.('Agent runtime config unavailable', error);
    return agentRuntimeUnavailable('config unavailable');
  }

  if (!config.enabled || !config.url) {
    return agentRuntimeUnavailable('disabled', config);
  }

  const Client = windowRef?.Colyseus?.Client;
  if (typeof Client !== 'function') {
    logger?.warn?.('Agent runtime enabled but Colyseus SDK is not loaded.');
    return agentRuntimeUnavailable('sdk unavailable', config);
  }

  const listeners = new Set();
  let snapshots = new Map();
  let worldObjects = new Map();
  let worldRuntime = null;
  let room = null;
  let client = null;
  let unsubscribeState = null;
  let requestSeq = 0;
  const pendingRequestIds = new Set();

  const notify = source => {
    const frozen = new Map(snapshots);
    listeners.forEach(listener => {
      try {
        listener(frozen, { source, config, room });
      } catch (error) {
        logger?.warn?.('Agent runtime listener failed', error);
      }
    });
  };

  try {
    client = new Client(config.url);
    room = await client.joinOrCreate(config.room, { client: 'main3d-runtime-hydration' });
    unsubscribeState = room.onStateChange(() => {
      snapshots = snapshotsFromRoomState(room);
      worldObjects = worldObjectsFromRoomState(room);
      worldRuntime = worldRuntimeFromRoomState(room);
      notify('state');
    });
    room.onMessage('runtime:event', () => {
      snapshots = snapshotsFromRoomState(room);
      worldObjects = worldObjectsFromRoomState(room);
      worldRuntime = worldRuntimeFromRoomState(room);
      notify('runtime:event');
    });
    room.onMessage('runtime:ack', () => {
      snapshots = snapshotsFromRoomState(room);
      worldObjects = worldObjectsFromRoomState(room);
      worldRuntime = worldRuntimeFromRoomState(room);
      notify('runtime:ack');
    });
    room.onMessage('runtime:worldRuntime', message => {
      snapshots = snapshotsFromRoomState(room);
      worldObjects = worldObjectsFromRoomState(room);
      worldRuntime = message?.worldRuntime
        ? normalizeWorldRuntimeState(message.worldRuntime)
        : worldRuntimeFromRoomState(room);
      notify('runtime:worldRuntime');
    });
    room.onMessage('runtime:error', message => {
      if (!pendingRequestIds.has(message?.requestId)) {
        logger?.warn?.('Agent runtime sidecar error', message);
      }
    });
    const welcome = await waitForMessage(room, 'runtime:welcome');
    snapshots = welcome?.snapshot
      ? snapshotsFromRuntimeDocument(welcome.snapshot)
      : snapshotsFromRoomState(room);
    worldObjects = welcome?.snapshot
      ? worldObjectsFromRuntimeDocument(welcome.snapshot)
      : worldObjectsFromRoomState(room);
    worldRuntime = welcome?.snapshot
      ? worldRuntimeFromRuntimeDocument(welcome.snapshot)
      : worldRuntimeFromRoomState(room);
  } catch (error) {
    logger?.warn?.('Agent runtime connection failed', error);
    return agentRuntimeUnavailable('connection failed', config);
  }

  const leaseOwner = `main3d:${room.sessionId}`;

  const sendRequest = (type, payload = {}, { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) => {
    if (!room) return Promise.reject(new Error('runtime room unavailable'));
    const requestId = `${type}:${Date.now()}:${++requestSeq}`;
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        pendingRequestIds.delete(requestId);
        clearTimeout(timer);
        if (typeof unsubscribeAck === 'function') unsubscribeAck();
        if (typeof unsubscribeError === 'function') unsubscribeError();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${type} timed out`));
      }, timeoutMs);
      const unsubscribeAck = room.onMessage('runtime:ack', message => {
        if (message?.requestId !== requestId) return;
        cleanup();
        resolve(message);
      });
      const unsubscribeError = room.onMessage('runtime:error', message => {
        if (message?.requestId !== requestId) return;
        cleanup();
        const error = new Error(message?.message || `${type} failed`);
        error.code = message?.code || 'runtime_error';
        error.details = message?.details || {};
        error.response = message;
        reject(error);
      });
      pendingRequestIds.add(requestId);
      room.send(type, { ...(payload || {}), requestId });
    });
  };

  return Object.freeze({
    enabled: true,
    connected: true,
    reason: '',
    config,
    room,
    client,
    leaseOwner,
    get snapshots() {
      return new Map(snapshots);
    },
    get worldObjects() {
      return new Map(worldObjects);
    },
    get worldRuntime() {
      return worldRuntime;
    },
    getSnapshotForAgent(agent) {
      return snapshotForIdentityKeys(snapshots, getRuntimeIdentityKeys(agent));
    },
    getSnapshotForKeys(keys) {
      return snapshotForIdentityKeys(snapshots, keys);
    },
    getWorldObjectState(objectKey) {
      const key = String(objectKey || '').trim();
      return key ? worldObjects.get(key) || null : null;
    },
    onSnapshots(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sendRequest,
    writeSnapshot(payload, options) {
      return sendRequest('runtime:snapshot', payload, options);
    },
    writeWorldObjectState(payload, options) {
      return sendRequest('runtime:worldObject', payload, options);
    },
    writeWorldTopology(payload, options) {
      return sendRequest('runtime:worldTopology', payload, options);
    },
    claimRoute(payload, options) {
      return sendRequest('runtime:claimRoute', { leaseOwner, ...(payload || {}) }, options);
    },
    heartbeat(payload, options) {
      return sendRequest('runtime:heartbeat', { leaseOwner, ...(payload || {}) }, options);
    },
    releaseRoute(payload, options) {
      return sendRequest('runtime:releaseRoute', { leaseOwner, ...(payload || {}) }, options);
    },
    dispose() {
      listeners.clear();
      if (typeof unsubscribeState === 'function') unsubscribeState();
      room?.leave?.(true);
    },
  });
}

function agentRuntimeUnavailable(reason, config = DEFAULT_CONFIG) {
  return Object.freeze({
    enabled: false,
    connected: false,
    reason,
    config,
    leaseOwner: '',
    snapshots: new Map(),
    worldObjects: new Map(),
    worldRuntime: null,
    getSnapshotForAgent() { return null; },
    getSnapshotForKeys() { return null; },
    getWorldObjectState() { return null; },
    onSnapshots() { return () => {}; },
    sendRequest() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    writeSnapshot() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    writeWorldObjectState() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    writeWorldTopology() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    claimRoute() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    heartbeat() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    releaseRoute() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    dispose() {},
  });
}
