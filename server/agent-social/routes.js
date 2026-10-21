// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents and friends, its owner's side (2026-10-10): the People tab's friends - its own settings, the
// limits in force, how it stands with each agent it knows - the messages it sent and got (every one, refused ones too),
// ending a friendship or blocking an agent for it, and reporting a message another agent sent it. The agent's owner or
// someone it is shared with to manage (agents.profile); anyone else: 404. Connected agents use their own routes
// (server/agent-world.js), the world's own agents live it (server/agent-social/social.js).
import { SocialError } from './social.js';

/**
 * @param {object} router
 * @param {import('./social.js').AgentSocial} social
 * @param {{ agents: object }} d
 */
export function addSocialRoutes(router, social, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) {
      if (e instanceof SocialError) return ok({ error: e.message, code: e.code, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) }, e.status);
      throw e;
    }
  };
  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN);
  const q = (url, k) => url.searchParams.get(k);
  const managed = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !P.account || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new SocialError(404, 'not_found', 'No such agent');
    return a;
  };
  const other = id => { const o = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null; if (!o) throw new SocialError(404, 'not_found', 'No such agent'); return o; };
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: run(fn) });

  R('GET', '/api/agent-social', ({ P, url }) => social.overview(managed(P, num(q(url, 'agent'))).id));
  R('POST', '/api/agent-social/settings', ({ P, body }) => {
    const a = managed(P, num(body?.agent)), patch = {};
    for (const k of ['reach', 'hearStrangers', 'perDay', 'starts']) if (body && Object.hasOwn(body, k)) patch[k] = body[k];
    return { settings: social.setSettings(a.id, patch, P.account.id) };
  });
  R('GET', '/api/agent-social/threads', ({ P, url }) => ({ threads: social.threads(managed(P, num(q(url, 'agent'))).id) }));
  R('GET', '/api/agent-social/thread', ({ P, url }) => {
    const a = managed(P, num(q(url, 'agent')));
    return { messages: social.thread(a.id, num(q(url, 'other')), { before: num(q(url, 'before')) || null, limit: num(q(url, 'limit')) || 60 }) };
  });
  // its owner ends a friendship for it, or blocks (or lets again) another agent - for this agent only
  R('POST', '/api/agent-social/end', ({ P, body }) => { const a = managed(P, num(body?.agent)); return social.unfriend(a.id, { id: other(num(body?.other)).id }, { by: 'owner' }); });
  R('POST', '/api/agent-social/block', ({ P, body }) => { const a = managed(P, num(body?.agent)); return social.block(a.id, { id: other(num(body?.other)).id }, body?.on !== false, { by: 'owner' }); });
  R('POST', '/api/agent-social/report', ({ P, body }) => { const a = managed(P, num(body?.agent)); return social.report(P.account, a.id, num(body?.message), body?.reason); });
}
