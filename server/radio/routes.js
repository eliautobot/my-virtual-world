// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// MVW Radio's routes (server/radio/radio.js): the hosts and the breaks coming up (everyone in the world), a break's
// audio, the shows as they went out (30 days), and the administrators' Settings → Radio (who hosts each station, which
// voice speaks, breaks a day).
import fs from 'node:fs';

/** @param router @param d { radio, agents, audit? } */
export function addRadioRoutes(router, d) {
  const R = d.radio;
  const wrap = fn => async ctx => { try { return await fn(ctx); } catch (e) { if (e.status && e.code) return { status: e.status, json: { error: e.message, code: e.code } }; throw e; } };
  router.add({ method: 'GET', path: '/api/radio/state', cap: 'world.view', handler: wrap(async () => ({ json: R.state() })) });
  router.add({ method: 'GET', prefix: '/api/radio/audio/', cap: 'world.view', handler: wrap(async ({ param }) => {
    const f = R.audioFile(String(param || ''));
    if (!f) return { status: 404, json: { error: 'No such break', code: 'not_found' } };
    const ext = f.split('.').pop(), type = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' }[ext] || 'audio/mpeg';
    return { file: { path: f, size: fs.statSync(f).size }, headers: { 'content-type': type, 'cache-control': 'private, max-age=3600' } };   // (the router sends { path, size }: a bare path went out as 0 bytes)
  }) });
  // a show as it went out (anyone listening may read it: it was on the air); an agent's shows, for its owner (or whoever
  // it is shared with to manage: agents.profile; anyone else: 404) in its Agent Studio
  router.add({ method: 'GET', path: '/api/radio/show', cap: 'world.view', handler: wrap(async ({ url }) => {
    const x = R.show(url.searchParams.get('id'));
    return x ? { json: { show: x } } : { status: 404, json: { error: 'No such show', code: 'not_found' } };
  }) });
  router.add({ method: 'GET', path: '/api/radio/shows', cap: 'agents.profile', handler: wrap(async ({ P, url }) => {
    const id = Number(url.searchParams.get('agent')), a = Number.isInteger(id) && id > 0 ? d.agents?.get(id) : null;
    if (!a || !P.account || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a))) return { status: 404, json: { error: 'No such agent', code: 'not_found' } };
    return { json: { shows: R.showsOf(a.id) } };
  }) });
  router.add({ method: 'GET', path: '/api/radio/admin', cap: 'freewill.admin', handler: wrap(async () => ({ json: R.adminView() })) });
  router.add({ method: 'POST', path: '/api/radio/admin', cap: 'freewill.admin', handler: wrap(async ({ P, body }) => {
    const out = R.setConfig(body || {});
    d.audit?.log('radio.config', { actor: { id: P.account?.id ?? null, login: P.account?.login ?? null }, detail: out.config });
    return { json: out };
  }) });
}
