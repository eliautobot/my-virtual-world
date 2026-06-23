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
    routeId: String(raw.routeId || ''),
    worldActionId: String(raw.worldActionId || ''),
    leaseOwner: String(raw.leaseOwner || ''),
    leaseExpiresAt: String(raw.leaseExpiresAt || ''),
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
    config = normalizeConfig(await response.json());
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
  let room = null;
  let client = null;
  let unsubscribeState = null;
  let requestSeq = 0;

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
      notify('state');
    });
    room.onMessage('runtime:event', () => {
      snapshots = snapshotsFromRoomState(room);
      notify('runtime:event');
    });
    room.onMessage('runtime:ack', () => {
      snapshots = snapshotsFromRoomState(room);
      notify('runtime:ack');
    });
    room.onMessage('runtime:error', message => {
      logger?.warn?.('Agent runtime sidecar error', message);
    });
    const welcome = await waitForMessage(room, 'runtime:welcome');
    snapshots = welcome?.snapshot
      ? snapshotsFromRuntimeDocument(welcome.snapshot)
      : snapshotsFromRoomState(room);
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
    getSnapshotForAgent(agent) {
      return snapshotForIdentityKeys(snapshots, getRuntimeIdentityKeys(agent));
    },
    getSnapshotForKeys(keys) {
      return snapshotForIdentityKeys(snapshots, keys);
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
    getSnapshotForAgent() { return null; },
    getSnapshotForKeys() { return null; },
    onSnapshots() { return () => {}; },
    sendRequest() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    writeSnapshot() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    claimRoute() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    heartbeat() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    releaseRoute() { return Promise.reject(new Error(`agent runtime unavailable: ${reason}`)); },
    dispose() {},
  });
}
