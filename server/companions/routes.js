// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions over HTTP (./companions.js): the agents with you or out on an order of yours, and the orders — follow, come,
// stay, go, meet up, ride, sit, eat, stand, dismiss. Only an agent's owner, or an account it is shared with to manage;
// anyone else's agent is answered as if it weren't there (404). An order it could not carry out (no seat free near you)
// is a 409 with its words ({ ok: false, error, code, text, brain }), as a refusal is.
import { CompanionError } from './companions.js';

/** @param {object} router  @param {() => import('./companions.js').Companions|null} companions */
export function addCompanionRoutes(router, companions) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    const c = companions();
    if (!c) return ok({ error: 'Companions are not available here', code: 'unavailable' }, 503);
    try { const r = await fn(c, ctx); return ok(r, r?.ok === false ? 409 : 200); } catch (e) { if (e instanceof CompanionError) return ok({ error: e.message, code: e.code }, e.status); throw e; }
  };
  const R = (method, path, fn) => router.add({ method, path, cap: 'agents.profile', handler: run(fn) });
  R('GET', '/api/companions', (c, { P }) => c.list(P));
  R('POST', '/api/companions', (c, { P, body }) => c.command(P, body || {}, 'ui'));
  R('POST', '/api/companions/dismiss-all', (c, { P }) => c.dismissAll(P));
  // (a line said out loud to the group, nobody called by name: who answers it — the voice row asks before anyone answers)
  R('POST', '/api/companions/turn', (c, { P, body }) => c.whoAnswers(P, body?.agents, body?.text));
}
