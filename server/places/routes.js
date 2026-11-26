// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Places over HTTP (./places.js, docs/features/places.md): the ratings over the billboards and a place's reviews for anyone
// who can watch the world; reviewing, writing to an owner and reading one's own messages for members (places.review); an
// administrator taking a review down (world.edit). Every change to a place's rating is announced ({ t: 'place_rating' }).
import { Places, PlaceError } from './places.js';

/** @param router @param d { dbs, world(), property, perms, notifications, send, broadcast, audit, log } @returns {Places} */
export function addPlaceRoutes(router, d) {
  const places = new Places(d);
  const ok = (json, status = 200) => ({ status, json });
  const run = fn => async ctx => {
    try { return ok(await fn(ctx)); } catch (e) { if (e instanceof PlaceError) return ok({ error: e.message, code: e.code }, e.status); throw e; }
  };
  const num = v => (v !== null && v !== undefined && /^\d{1,9}$/.test(String(v)) ? Number(v) : null);
  router.add({ method: 'GET', path: '/api/places/ratings', cap: 'world.view', handler: run(() => ({ ratings: places.ratings() })) });
  router.add({ method: 'GET', prefix: '/api/places/place/', cap: 'world.view', handler: run(({ P, param, url }) => {
    const b = num(param);
    if (b === null) throw new PlaceError(404, 'not_found', 'No such place');
    return places.place(P, b, { sort: url.searchParams.get('sort') || 'new', offset: num(url.searchParams.get('offset')) || 0 });
  }) });
  router.add({ method: 'POST', path: '/api/places/review', cap: 'places.review', handler: run(({ P, body }) => places.review(P, body || {})) });
  router.add({ method: 'POST', path: '/api/places/review/delete', cap: 'places.review', handler: run(({ P, body }) => places.unreview(P, body || {})) });
  router.add({ method: 'POST', path: '/api/places/review/hide', cap: 'world.edit', handler: run(({ P, body }) => places.hide(P, body || {})) });
  router.add({ method: 'POST', path: '/api/places/message', cap: 'places.review', handler: run(({ P, body }) => places.message(P, body || {})) });
  router.add({ method: 'GET', path: '/api/places/messages', cap: 'places.review', handler: run(({ P, url }) => places.messages(P, { b: url.searchParams.get('b') })) });
  router.add({ method: 'POST', path: '/api/places/messages/read', cap: 'places.review', handler: run(({ P, body }) => places.read(P, body || {})) });
  router.add({ method: 'POST', path: '/api/places/messages/delete', cap: 'places.review', handler: run(({ P, body }) => places.deleteMessage(P, body || {})) });
  return places;
}
