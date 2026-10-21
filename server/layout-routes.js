// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Saved floor layouts over HTTP (floor layouts, 2026-10-04; server/world/floor-library.js): the caller's own layouts
// and the ones shared with them, saving the floor being furnished (furnishing rights on it), renaming, deleting, and
// sharing with a player by username. Laying a saved layout onto a floor is an edit (op lvl.apply through
// /api/edit): checked against the lot's build rights and journaled like any other.
import { FloorLibrary, LibraryError } from './world/floor-library.js';
import { floorUse, layoutToSave } from '../shared/edit.js';

/**
 * @param {object} router  the API router (server/routes.js)
 * @param {object} d       { dbs, perms, world: () => world, rights: () => LotRights|null }
 * @returns {FloorLibrary}
 */
export function addLayoutRoutes(router, d) {
  const lib = new FloorLibrary(d.dbs), db = d.dbs.db, w = d.dbs.worldId;
  const loginQ = db.prepare('SELECT id, display_name FROM accounts WHERE world_id = ? AND login = ?');
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => { try { return ok(fn()); } catch (e) { if (e instanceof LibraryError) return ok({ error: e.message, code: e.code }, e.status); throw e; } };
  const me = P => Number(P.account.id);
  const body = ctx => ctx.body || {};

  router.add({ method: 'GET', path: '/api/layouts', cap: 'property.hold', handler: ({ P }) => ok(lib.list(me(P))) });
  router.add({ method: 'GET', prefix: '/api/layouts/', cap: 'property.hold', handler: ({ P, param }) => {
    const r = /^\d{1,12}$/.test(param || '') ? lib.usable(+param, me(P)) : null;
    return r ? ok(r) : ok({ error: 'No such saved layout', code: 'not_found' }, 404);
  } });
  router.add({ method: 'POST', path: '/api/layouts/save', cap: 'property.hold', lock: 'edit', handler: ctx => {
    const b = body(ctx), W = d.world(), B = W.buildings[b.b | 0], f = b.f | 0;
    if (!B || B.gone || f < 0 || f >= B.floors) return ok({ error: 'No such floor', code: 'not_found' }, 404);
    const actor = { admin: d.perms.allowed(ctx.P, 'world.edit'), subject: { kind: 'account', id: String(ctx.P.account.id) } };
    const why = d.rights()?.check({ op: 'item.tint', b: B.idx }, actor);   // furnishing rights on the building
    if (why) return ok({ error: why, code: 'forbidden' }, 403);
    const L = W.levels[B.lv[f]];
    if (!L) return ok({ error: 'No such floor', code: 'not_found' }, 404);
    return run(() => lib.save(me(ctx.P), { name: b.name, use: floorUse(B, f), w: B.w, d: B.d, layout: layoutToSave(L) }));
  } });
  router.add({ method: 'POST', path: '/api/layouts/rename', cap: 'property.hold', lock: 'edit', handler: ctx => run(() => lib.rename(body(ctx).id, me(ctx.P), body(ctx).name)) });
  router.add({ method: 'POST', path: '/api/layouts/delete', cap: 'property.hold', lock: 'edit', handler: ctx => run(() => lib.remove(body(ctx).id, me(ctx.P))) });
  router.add({ method: 'POST', path: '/api/layouts/share', cap: 'property.hold', lock: 'edit', handler: ctx => {
    const b = body(ctx), to = loginQ.get(w, String(b.login || '').trim().toLowerCase());
    if (!to) return ok({ error: 'No player with that username', code: 'not_found' }, 404);
    return run(() => ({ ...lib.share(b.id, me(ctx.P), to.id), name: to.display_name }));
  } });
  router.add({ method: 'POST', path: '/api/layouts/unshare', cap: 'property.hold', lock: 'edit', handler: ctx => {
    const b = body(ctx);
    return run(() => lib.unshare(b.id, me(ctx.P), b.account === undefined ? me(ctx.P) : Number(b.account)));
  } });
  return lib;
}
