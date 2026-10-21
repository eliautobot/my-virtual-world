// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The weather's routes (WP4.18): what it is now and its timeline seed for anyone watching; administrators set it for
// a number of world hours, or back to its natural course ('auto').
/** @param {object} router @param {() => import('./world/weather.js').Weather} weather */
export function addWeatherRoutes(router, weather) {
  router.add({ method: 'GET', path: '/api/weather', cap: 'world.view', handler: () => ({ status: 200, json: { now: weather().now(), ...weather().info() } }) });
  router.add({
    method: 'POST', path: '/api/weather', cap: 'world.edit', handler: ({ P, body }) => {
      try { return { status: 200, json: weather().set(String(body.kind || ''), body.hours, { id: P.account.id, login: P.account.login }) }; }
      catch (e) { return { status: e.status || 400, json: { error: e.message, code: 'bad_request' } }; }
    },
  });
}
