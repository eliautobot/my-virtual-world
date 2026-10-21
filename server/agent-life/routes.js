// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's life over HTTP (docs/features/FREE-WILL.md §5, §9): its profile, plans, memories, the people it knows and
// what it did. Only the agent's owner, or an account it is shared with to manage, may read or change any of it
// (agents.profile); everyone else gets 404 - memories and the activity log are private. Every route goes through the
// server's pipeline (session, capability, Origin, CSRF, JSON).
import { LifeError } from './life.js';

/**
 * @param {object} router
 * @param {import('./life.js').AgentLife} life
 * @param {{ agents: object }} d
 */
export function addLifeRoutes(router, life, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) {
      if (e instanceof LifeError) return ok({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  };
  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN);
  const mine = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new LifeError(404, 'not_found', 'No such agent');
    return a;
  };
  const q = (url, k) => url.searchParams.get(k);
  const actor = P => ({ id: P.account.id, login: P.account.login });
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: run(fn) });

  R('GET', '/api/agent-life/profile', ({ P, url }) => {
    const a = mine(P, num(q(url, 'agent')));
    return { profile: life.profile(a.id), plans: life.intentions(a.id) };
  });
  R('POST', '/api/agent-life/profile', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    const patch = {};
    for (const k of ['traits', 'flags', 'bio', 'values', 'likes', 'dislikes', 'purpose', 'aspirations', 'outlook', 'locked']) if (b[k] !== undefined) patch[k] = b[k];
    if (!Object.keys(patch).length) throw new LifeError(400, 'nothing', 'Nothing to change');
    return { profile: life.setProfile(a.id, patch, actor(P)) };
  });

  R('POST', '/api/agent-life/plans', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    if (b.add) return { plans: life.addIntention(a.id, { kind: b.add.kind, text: b.add.text, today: b.add.today === true }) };
    const id = num(b.id);
    if (!Number.isInteger(id)) throw new LifeError(400, 'bad_id', 'Name the plan (id) or send add');
    if (b.remove === true) return { plans: life.removeIntention(a.id, id) };
    return { plans: life.setIntention(a.id, id, b.status) };
  });

  R('GET', '/api/agent-life/memories', ({ P, url }) => {
    const a = mine(P, num(q(url, 'agent')));
    return { memories: life.memories(a.id, { term: q(url, 'term') || 'short', before: q(url, 'before'), limit: q(url, 'limit') }) };
  });
  R('POST', '/api/agent-life/memories', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    if (b.add) return life.addMemory(a.id, { term: b.add.term ?? 'long', kind: b.add.kind ?? 'note', text: b.add.text, importance: b.add.importance ?? 3 });
    const id = num(b.id);
    if (!Number.isInteger(id)) throw new LifeError(400, 'bad_id', 'Name the memory (id) or send add');
    if (b.remove === true) return life.removeMemory(a.id, id);
    if (b.promote === true) return life.promoteMemory(a.id, id);
    throw new LifeError(400, 'nothing', 'Send add, remove or promote');
  });

  R('GET', '/api/agent-life/people', ({ P, url }) => {
    const a = mine(P, num(q(url, 'agent')));
    return { people: life.relations(a.id, q(url, 'limit')) };
  });
  R('POST', '/api/agent-life/people', ({ P, body }) => {
    const b = body || {}, a = mine(P, num(b.agent));
    if (typeof b.note !== 'string') throw new LifeError(400, 'bad_note', 'note is text');
    return { people: life.noteRelation(a.id, b.kind, b.id, b.note) };
  });

  R('GET', '/api/agent-life/activity', ({ P, url }) => {
    const a = mine(P, num(q(url, 'agent')));
    return { activity: life.activity(a.id, { before: q(url, 'before'), limit: q(url, 'limit') }) };
  });
}
