// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Free Will over HTTP (docs/features/FREE-WILL.md §9). Every route goes through the server's pipeline (session,
// capability, Origin, CSRF, JSON).
// - An agent's own switch, its decision service and spontaneity, today's numbers and the why-log: the agent's owner, or an
//   account it is shared with to manage (agents.freewill). Anyone else gets 404: nothing is confirmed.
// - The installation's overview (requests, costs, latency, why the routine chose, paused services): freewill.admin. The
//   installation's switch, decision service and limits are settings (freeWill.*), changed through /api/settings.
import { FreeWillError } from './free-will.js';
import { isDecisionKind } from '../providers/manifest.js';

/**
 * @param {object} router
 * @param {import('./free-will.js').FreeWill} fw
 * @param {{ agents: object, connections: object, registry: object }} d
 */
export function addFreeWillRoutes(router, fw, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) {
      if (e instanceof FreeWillError) return ok({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  };
  const agentId = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : NaN);
  /** The agent, when this principal may manage its Free Will (its owner, or a manage share); otherwise 404. */
  const mine = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new FreeWillError(404, 'not_found', 'No such agent');
    return a;
  };
  const view = a => {
    const settings = fw.settingsOf(a.id);
    const st = fw.status.get(a.id);
    const owner = fw.principalFor(a.ownerId);
    return {
      agent: { id: a.id, name: a.name, emoji: a.emoji },
      settings,
      status: st || { active: false, reason: settings.enabled ? 'starting' : 'switched_off' },
      services: owner ? fw.choicesFor(owner) : [],
      today: fw.agentToday(a.id),
    };
  };

  router.add({ method: 'GET', path: '/api/free-will/agent', cap: 'agents.freewill', handler: run(({ P, url }) => {
    const a = mine(P, agentId(url.searchParams.get('agent')));
    return { ...view(a), decisions: fw.decisions(a.id, { limit: 20 }) };
  }) });

  router.add({ method: 'POST', path: '/api/free-will/agent', cap: 'agents.freewill', handler: run(({ P, body }) => {
    const b = body || {};
    const a = mine(P, agentId(b.agent));
    const patch = {};
    if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') throw new FreeWillError(400, 'bad_enabled', 'enabled is true or false'); patch.enabled = b.enabled; }
    if (b.spontaneity !== undefined) patch.spontaneity = b.spontaneity;
    if (b.connectionId !== undefined) {
      if (b.connectionId !== null && !(Number.isInteger(b.connectionId) && b.connectionId > 0)) throw new FreeWillError(400, 'bad_connection', 'connectionId is a connection id, or null for the installation\'s');
      patch.connectionId = b.connectionId;
    }
    if (!Object.keys(patch).length) throw new FreeWillError(400, 'nothing', 'Nothing to change');
    fw.setSettings(a, patch, P.account.id);
    return view(a);
  }) });

  router.add({ method: 'GET', path: '/api/free-will/decisions', cap: 'agents.freewill', handler: run(({ P, url }) => {
    const a = mine(P, agentId(url.searchParams.get('agent')));
    return { decisions: fw.decisions(a.id, { before: url.searchParams.get('before'), limit: url.searchParams.get('limit') }) };
  }) });

  router.add({ method: 'GET', path: '/api/free-will/overview', cap: 'freewill.admin', handler: run(() => ({
    ...fw.overview(),
    services: d.connections.list().filter(c => isDecisionKind(d.registry.manifest(c.kind)))
      .map(c => ({ id: c.id, label: c.label, kind: c.kind, enabled: c.enabled, scope: c.scope, implemented: d.registry.implemented(c.kind), status: c.status })),
    defaultConnection: Number(fw.config().defaultConnection) || null,
  })) });
}
