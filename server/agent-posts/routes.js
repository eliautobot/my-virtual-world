// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents on post around the clock, over HTTP (server/agent-posts/posts.js). Its owner, or an account it is shared with
// to manage (agents.profile; anyone else: 404): where it is posted, where it could be, post it, let it go; and right at a
// counter or a desk: who is at the ones on a floor, post one of its owner's own agents there at once, or give it its work
// there (shifts), or let it choose its work again.
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
  // right at the furniture (posts.js here): its owner's own agents only, never one shared with them (2026-10-23: "they
  // cant and shouldnt be able to access other accounts or other users agents only their own")
  const owned = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !P.account || !d.agents.isOwner(P, a)) throw new PostError(404, 'not_found', 'No such agent');
    return a;
  };
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: run(fn) });
  R('GET', '/api/agent-posts', ({ P, url }) => ({ post: posts.of(managed(P, num(url.searchParams.get('agent')))) }));
  R('GET', '/api/agent-posts/spots', ({ P, url }) => { const a = managed(P, num(url.searchParams.get('agent'))); return { post: posts.of(a), buildings: posts.spots(P, a) }; });
  R('POST', '/api/agent-posts', ({ P, body }) => ({ post: posts.set(P, managed(P, num(body?.agent)), body || {}) }));
  R('POST', '/api/agent-posts/leave', ({ P, body }) => ({ post: posts.leave(managed(P, num(body?.agent))) }));
  R('GET', '/api/agent-posts/floor', ({ P, url }) => posts.floor(P, num(url.searchParams.get('b')), num(url.searchParams.get('f'))));
  R('POST', '/api/agent-posts/here', ({ P, body }) => posts.here(P, owned(P, num(body?.agent)), body || {}));
  R('GET', '/api/agent-posts/work', ({ P, url }) => ({ work: posts.workOf(managed(P, num(url.searchParams.get('agent')))) }));
  R('POST', '/api/agent-posts/work', ({ P, body }) => posts.work(P, owned(P, num(body?.agent)), body || {}));
  R('POST', '/api/agent-posts/work/auto', ({ P, body }) => posts.autoWork(owned(P, num(body?.agent))));
  R('POST', '/api/agent-posts/pay', ({ P, body }) => posts.setPay(P, body || {}));   // (what a position pays an hour: 2026-10-28)
  R('POST', '/api/agent-posts/work/hours', ({ P, body }) => posts.hours(P, owned(P, num(body?.agent)), body || {}));   // (new hours where it works: 2026-10-28)
}
