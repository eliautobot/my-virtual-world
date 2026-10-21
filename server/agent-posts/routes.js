// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents on post around the clock, over HTTP (server/agent-posts/posts.js). Its owner, or an account it is shared with
// to manage (agents.profile; anyone else: 404): where it is posted, where it could be, post it, let it go.
import { PostError } from './posts.js';

/**
 * @param {object} router
 * @param {import('./posts.js').Posts} posts
 * @param {{ agents: object }} d
 */
export function addPostRoutes(router, posts, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) { if (e instanceof PostError) return ok({ error: e.message, code: e.code }, e.status); throw e; }
  };
  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN);
  const managed = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !P.account || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new PostError(404, 'not_found', 'No such agent');
    return a;
  };
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: run(fn) });
  R('GET', '/api/agent-posts', ({ P, url }) => ({ post: posts.of(managed(P, num(url.searchParams.get('agent')))) }));
  R('GET', '/api/agent-posts/spots', ({ P, url }) => { const a = managed(P, num(url.searchParams.get('agent'))); return { post: posts.of(a), buildings: posts.spots(P, a) }; });
  R('POST', '/api/agent-posts', ({ P, body }) => ({ post: posts.set(P, managed(P, num(body?.agent)), body || {}) }));
  R('POST', '/api/agent-posts/leave', ({ P, body }) => ({ post: posts.leave(managed(P, num(body?.agent))) }));
}
