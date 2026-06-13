/**
 * Polling helper for Phase 2 world-action event hooks.
 *
 * This intentionally follows the existing frontend polling style instead of
 * introducing websockets/SSE. UI panels can subscribe to normalized lifecycle
 * hook events without reading worldActions.active/history internals.
 */
export const WORLD_ACTION_EVENT_ENDPOINT = '/api/world-action-events';

export const WORLD_ACTION_EVENT_NAMES = Object.freeze([
  'action-created',
  'object-reserved',
  'route-started',
  'arrived',
  'in-progress',
  'completed',
  'cancelled',
  'failed',
  'reservation-released',
]);

export function isWorldActionEventName(name) {
  return WORLD_ACTION_EVENT_NAMES.includes(name);
}

export function normalizeWorldActionEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const name = event.name || event.type;
  if (!isWorldActionEventName(name)) return null;
  return Object.freeze({
    ...event,
    name,
    type: name,
    sequence: Number(event.sequence || event.cursor || 0),
    cursor: Number(event.cursor || event.sequence || 0),
    timestamp: event.timestamp || event.at,
    actionId: event.actionId || null,
    status: event.status || event.toStatus || null,
    agentId: event.agentId || null,
    targetId: event.targetId || null,
    result: event.result && typeof event.result === 'object' ? event.result : null,
    error: event.error && typeof event.error === 'object' ? event.error : null,
  });
}

export async function pollWorldActionEvents({ since = 0, limit = 100, agentId, actionId, targetId, name, signal } = {}) {
  const params = new URLSearchParams();
  if (since) params.set('since', String(since));
  if (limit) params.set('limit', String(limit));
  if (agentId) params.set('agentId', agentId);
  if (actionId) params.set('actionId', actionId);
  if (targetId) params.set('targetId', targetId);
  if (name) params.set('name', name);
  const response = await fetch(`${WORLD_ACTION_EVENT_ENDPOINT}?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`world-action event poll failed: ${response.status}`);
  const payload = await response.json();
  const events = Array.isArray(payload?.events) ? payload.events.map(normalizeWorldActionEvent).filter(Boolean) : [];
  return Object.freeze({
    ok: Boolean(payload?.ok),
    schemaVersion: payload?.schemaVersion,
    subscription: payload?.subscription,
    events: Object.freeze(events),
    nextCursor: Number(payload?.nextCursor || events.at(-1)?.sequence || since || 0),
  });
}

export function createWorldActionEventSubscription({ intervalMs = 1000, onEvent, onError, ...filters } = {}) {
  let cursor = Number(filters.since || 0);
  let stopped = false;
  let timer = null;
  const controller = new AbortController();
  const emitter = new EventTarget();

  const emit = event => {
    emitter.dispatchEvent(new CustomEvent(event.name, { detail: event }));
    emitter.dispatchEvent(new CustomEvent('world-action-event', { detail: event }));
    if (typeof onEvent === 'function') onEvent(event);
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const payload = await pollWorldActionEvents({ ...filters, since: cursor, signal: controller.signal });
      for (const event of payload.events) {
        cursor = Math.max(cursor, event.sequence || 0);
        emit(event);
      }
      if (payload.nextCursor) cursor = Math.max(cursor, payload.nextCursor);
    } catch (error) {
      if (!stopped && typeof onError === 'function') onError(error);
    } finally {
      if (!stopped) timer = setTimeout(poll, Math.max(250, intervalMs));
    }
  };

  timer = setTimeout(poll, 0);
  return Object.freeze({
    addEventListener: (...args) => emitter.addEventListener(...args),
    removeEventListener: (...args) => emitter.removeEventListener(...args),
    get cursor() { return cursor; },
    stop() {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    },
  });
}
