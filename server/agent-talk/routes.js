// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Talking with others' agents in the city, over HTTP (docs/features/CHAT.md §14). Talking: any signed-in account that may
// chat (chat.use) — the server decides who may talk with which agent and counts every message (talk.js). Its owner's
// review and blocking: the agent's owner or someone it is shared with to manage (agents.profile; anyone else: 404).
import { TalkError } from './talk.js';

/**
 * @param {object} router
 * @param {import('./talk.js').Talk} talk
 * @param {{ agents: object }} d
 */
export function addTalkRoutes(router, talk, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) {
      if (e instanceof TalkError) return ok({ error: e.message, code: e.code, ...(e.resetAt ? { resetAt: e.resetAt } : {}), ...(e.maxChars ? { maxChars: e.maxChars } : {}) }, e.status);
      throw e;
    }
  };
  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN);
  const q = (url, k) => url.searchParams.get(k);
  const managed = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !P.account || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new TalkError(404, 'not_found', 'No such agent');
    return a;
  };
  const at = b => (Number.isFinite(b?.x) && Number.isFinite(b?.z) ? { x: b.x, z: b.z } : null);

  router.add({ method: 'GET', path: '/api/agent-talk', cap: 'chat.use', handler: run(({ P, url }) => talk.state(P, num(q(url, 'agent')))) });
  router.add({ method: 'POST', path: '/api/agent-talk/say', cap: 'chat.use', handler: run(({ P, body }) => talk.say(P, num(body?.agent), body?.text, at(body))) });
  // (its owner in person: their agent stops and turns to them)
  router.add({ method: 'POST', path: '/api/agent-talk/face', cap: 'chat.use', handler: run(({ P, body }) => talk.face(P, num(body?.agent), at(body))) });

  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: run(fn) });
  // (with what others get from it and the admin's limits, for the Studio's Visitors tab)
  R('GET', '/api/agent-talk/conversations', ({ P, url }) => {
    const a = managed(P, num(q(url, 'agent')));
    return { conversations: talk.conversations(a), publicMode: talk.publicMode(a), limits: talk.limits(), why: talk.whyNot({ account: { id: 0 } }, a)?.code || null };
  });
  R('GET', '/api/agent-talk/conversation', ({ P, url }) => talk.conversation(managed(P, num(q(url, 'agent'))), num(q(url, 'session'))));
  // blocks: the agent's owner's, for all of their agents (named through any one of them)
  R('GET', '/api/agent-talk/blocks', ({ P, url }) => ({ blocks: talk.blocks(talk.ownerOf(managed(P, num(q(url, 'agent'))))) }));
  R('POST', '/api/agent-talk/block', ({ P, body }) => {
    const a = managed(P, num(body?.agent));
    return { blocks: talk.setBlock(talk.ownerOf(a), { account: body?.account, agent: body?.other, on: body?.on !== false }) };
  });
}
