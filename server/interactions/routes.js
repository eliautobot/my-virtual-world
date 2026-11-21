// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an agent can do in the world, over HTTP (./registry.js, docs/features/interactions.md): its owner — or an account
// it is shared with to manage — sees what it can do right where its body is, and tells it to do one (as its owner's own
// command: the same registry Free Will and its chat brain use, with its honest answer). Anyone else's agent is answered as
// if it weren't there (404); something it could not do is a 409 with its words ({ ok: false, text, brain }).

/** @param {object} router  @param {() => import('./registry.js').Interactions|null} interactions
 *  @param {{ agents, mayCommand: (P, rec) => boolean }} o */
export function addInteractionRoutes(router, interactions, { agents, mayCommand }) {
  const ok = (json, status = 200) => ({ status, json });
  const recOf = (P, id) => { const a = agents.get(Number(id)); return a && a.enabled !== false && mayCommand(P, a) ? a : null; };
  const run = fn => async ctx => {
    const I = interactions();
    if (!I) return ok({ error: 'Not available here', code: 'unavailable' }, 503);
    const id = ctx.method === 'GET' || !ctx.body ? ctx.url?.searchParams?.get('agent') : ctx.body.agent;
    const rec = /^\d{1,12}$/.test(String(id ?? '')) ? recOf(ctx.P, id) : null;
    if (!rec) return ok({ error: 'No such agent', code: 'not_found' }, 404);
    const r = await fn(I, rec, ctx);
    return ok(r, r?.ok === false ? 409 : 200);
  };
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: ctx => run(fn)({ ...ctx, method }) });
  // what it can do now (?agent=): [{ id, source, kind, label, cost (hundredths of a VC), effects, withLeader }]
  R('GET', '/api/interactions', (I, rec) => ({ things: I.nearFor(rec, { limit: 20 }).map(x => ({ id: x.id, source: x.source, kind: x.kind, label: x.label, cost: x.cost ?? null, effects: x.effects?.words || null, withLeader: !!x.withLeader })) }));
  // do one now ({ agent, id, minutes? }) → { ok, text, brain }
  R('POST', '/api/interactions', async (I, rec, { body }) => {
    const id = String(body?.id || '').slice(0, 200);
    if (!id) return { ok: false, text: 'Say which (id)', brain: '' };
    let r = I.doFor(rec, id, { via: 'ui', ...(Number(body?.minutes) > 0 ? { minutes: Number(body.minutes) } : {}) });
    if (r && typeof r.then === 'function') r = await r;
    return { ok: !!r?.ok, kind: r?.kind || null, text: r?.text || '', brain: r?.brain || '' };
  });
}
