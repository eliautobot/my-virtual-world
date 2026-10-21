// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What the person does about AI apps (./auth.js), in the route table with the browser's own rules (session, CSRF):
//   GET  /api/connector/request?id=   the consent page: which app asks, what for, and the person's agents to choose from
//                                     (the id is the request's secret; a guest sees the app and is asked to sign in)
//   POST /api/connector/consent       { request, agent, allow } → { redirect } back to the app (a code, or access_denied)
//   GET  /api/connector/grants        the apps acting for this account
//   POST /api/connector/grants/revoke { id } disconnects one
import { ConnectorError } from './auth.js';

/** @param {object} d { auth, enabled(), issuerOf(req) } */
export function addConnectorRoutes(router, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try {
      if (!d.enabled()) return ok({ error: 'AI apps can\'t connect to this world', code: 'connector_off' }, 404);
      return ok(await fn(ctx));
    } catch (e) {
      if (e instanceof ConnectorError) return ok({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  };
  router.add({ method: 'GET', path: '/api/connector/request', cap: 'public', handler: run(({ P, url }) => d.auth.pending(String(url.searchParams.get('id') || ''), P)) });
  router.add({ method: 'POST', path: '/api/connector/consent', cap: 'agents.connect', handler: run(({ req, P, ip, body }) => {
    const b = body || {};
    const r = d.auth.consent(P, { request: String(b.request || ''), agent: b.agent, allow: b.allow === true }, { issuer: d.issuerOf(req), ip });
    return { redirect: r.redirect };
  }) });
  router.add({ method: 'GET', path: '/api/connector/grants', cap: 'agents.connect', handler: run(({ P }) => ({ grants: d.auth.grantsOf(P.account.id) })) });
  router.add({ method: 'POST', path: '/api/connector/grants/revoke', cap: 'agents.connect', handler: run(({ P, ip, body }) => d.auth.revokeGrant(P, body?.id, { ip })) });
}
