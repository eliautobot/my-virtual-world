// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Mind over HTTP (docs/features/FREE-WILL.md §9). Every route goes through the server's pipeline (session,
// capability, Origin, CSRF, JSON).
// - An agent's Mind — whether it plans and reflects each day, with which brain, what its thoughts did and cost, and
//   "think now": the agent's owner, or an account it is shared with to manage (agents.mind). Anyone else gets 404.
// - An agent's problems (rent, money, home, job: server/mind/problems.js) — open and lately solved, with what its Mind
//   did about them: the same people (agents.mind).
// - The installation's overview (today's thoughts and cost, latency, paused brains, problems open): freewill.admin. The installation's
//   switch, reflection brain and limits are settings (mind.*), changed through /api/settings.
import { MindError } from './mind.js';

/**
 * @param {object} router
 * @param {import('./mind.js').Mind} mind
 * @param {{ agents: object, problems?: object }} d
 */
export function addMindRoutes(router, mind, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) {
      if (e instanceof MindError) return ok({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  };
  const agentId = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : NaN);
  /** The agent, when this principal may manage it (its owner, or a manage share); otherwise 404. */
  const mine = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new MindError(404, 'not_found', 'No such agent');
    return a;
  };
  const view = a => ({ agent: { id: a.id, name: a.name, emoji: a.emoji }, settings: mind.settingsOf(a.id), status: mind.statusOf(a), usage: mind.usage(a.id) });

  router.add({ method: 'GET', path: '/api/mind/agent', cap: 'agents.mind', handler: run(({ P, url }) => {
    const a = mine(P, agentId(url.searchParams.get('agent')));
    return { ...view(a), thoughts: mind.jobs(a.id, { limit: 10 }) };
  }) });

  router.add({ method: 'POST', path: '/api/mind/agent', cap: 'agents.mind', handler: run(({ P, body }) => {
    const b = body || {};
    const a = mine(P, agentId(b.agent));
    if (b.cadence === undefined) throw new MindError(400, 'nothing', 'Nothing to change');
    mind.setSettings(a, { cadence: b.cadence }, P.account.id);
    return view(a);
  }) });

  router.add({ method: 'POST', path: '/api/mind/think', cap: 'agents.mind', handler: run(async ({ P, body }) => {
    const b = body || {};
    const a = mine(P, agentId(b.agent));
    const r = await mind.thinkNow(a, b.kind);
    return { ok: true, did: r.done, cost: r.cost, ms: r.ms, ...view(a) };
  }) });

  router.add({ method: 'GET', path: '/api/mind/thoughts', cap: 'agents.mind', handler: run(({ P, url }) => {
    const a = mine(P, agentId(url.searchParams.get('agent')));
    const before = url.searchParams.get('before'), limit = url.searchParams.get('limit');
    return { thoughts: mind.jobs(a.id, { before: before && /^\d{1,12}$/.test(before) ? Number(before) : null, limit: limit && /^\d{1,3}$/.test(limit) ? Number(limit) : 30 }) };
  }) });

  router.add({ method: 'GET', path: '/api/mind/problems', cap: 'agents.mind', handler: run(({ P, url }) => {
    const a = mine(P, agentId(url.searchParams.get('agent')));
    return { problems: d.problems ? d.problems.list(a.id, 20) : [] };
  }) });

  router.add({ method: 'GET', path: '/api/mind/overview', cap: 'freewill.admin', handler: run(() => ({ ...mind.overview(), problems: d.problems ? d.problems.overview() : null })) });
}
