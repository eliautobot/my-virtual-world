// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Awareness over HTTP (docs/features/awareness.md §6). An agent's awareness — its mode, and what it would be told right now
// — and its diary: its owner, or an account it is shared with to manage (agents.mind, as its Mind). Anyone else gets 404.
// The installation's overview (the diary's size, the tick's time): freewill.admin. Its conversations in person
// (./spoken.js): its owner or its managers (agents.profile).
import { SensesError, MODE_INFO, tokensOf } from './senses.js';

/**
 * @param {object} router
 * @param {() => import('./senses.js').Senses} sensesOf
 * @param {{ agents: object, writerName?: (P) => string }} d
 */
export function addSensesRoutes(router, sensesOf, d) {
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try {
      const S = sensesOf();
      if (!S) throw new SensesError(503, 'not_ready', 'Not ready yet');
      return ok(await fn(ctx, S));
    } catch (e) {
      if (e instanceof SensesError) return ok({ error: e.message, code: e.code }, e.status);
      throw e;
    }
  };
  const idOf = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : NaN);
  const mine = (P, id) => {
    const a = Number.isInteger(id) && id > 0 ? d.agents.get(id) : null;
    if (!a || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) throw new SensesError(404, 'not_found', 'No such agent');
    return a;
  };
  /** Its mode and what it would be told now, with the person asking as the one writing to it. */
  const view = (S, a, P) => {
    const me = P.account.id, body = S.bodyOf(a) >= 0;
    const line = body ? S.line(a) : null, full = body ? S.look(a, { account: me })?.text || null : null, pointer = body ? S.pointer() : null;
    const tog = body ? S.together(a, me) : { yes: false, how: null };
    return {
      agent: { id: a.id, name: a.name, emoji: a.emoji }, mode: S.modeOf(a.id), own: S.ownMode(a.id), default: S.defaultMode(), enabled: S.enabled(),
      modes: MODE_INFO,
      now: { body, together: tog.yes ? tog.how : null, line, full, pointer, tokens: { line: tokensOf(line), full: tokensOf(full), pointer: tokensOf(pointer) } },
    };
  };

  router.add({ method: 'GET', path: '/api/awareness', cap: 'agents.mind', handler: run(({ P, url }, S) => view(S, mine(P, idOf(url.searchParams.get('agent'))), P)) });

  router.add({ method: 'POST', path: '/api/awareness', cap: 'agents.mind', handler: run(({ P, body }, S) => {
    const b = body || {};
    const a = mine(P, idOf(b.agent));
    if (b.mode === undefined) throw new SensesError(400, 'nothing', 'Nothing to change');
    S.setMode(a.id, b.mode === '' ? null : b.mode, P.account.id);
    return view(S, a, P);
  }) });

  router.add({ method: 'GET', path: '/api/awareness/diary', cap: 'agents.mind', handler: run(({ P, url }, S) => {
    const a = mine(P, idOf(url.searchParams.get('agent')));
    return { items: S.diary.read(a.id).reverse() };
  }) });

  // its conversations in person (./spoken.js; the Studio's Conversations tab): what it said out loud with someone near and
  // what it heard, grouped, newest first; before: the page's `next`. Its owner may clear them (DELETE).
  router.add({ method: 'GET', path: '/api/agent-spoken', cap: 'agents.profile', handler: run(({ P, url }, S) => {
    const a = mine(P, idOf(url.searchParams.get('agent')));
    if (!S.spoken) throw new SensesError(503, 'not_ready', 'Not ready yet');
    const before = idOf(url.searchParams.get('before'));
    return S.spoken.conversations(a.id, { before: Number.isInteger(before) ? before : null });
  }) });
  router.add({ method: 'POST', path: '/api/agent-spoken/clear', cap: 'agents.profile', handler: run(({ P, body }, S) => {
    const a = mine(P, idOf(body?.agent));
    if (!S.spoken) throw new SensesError(503, 'not_ready', 'Not ready yet');
    return { cleared: S.spoken.forget(a.id) };
  }) });

  router.add({ method: 'GET', path: '/api/awareness/overview', cap: 'freewill.admin', handler: run((_, S) => S.view()) });
}
