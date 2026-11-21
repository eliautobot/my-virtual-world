// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who is at work, for the screens (./presence.js): a workplace's staff and each one's status (a seat's ⋯, a person's
// card), and a person's work. What anyone in the city could see by walking in: who works there, who is there, who isn't
// and why (the product owner, 2026-11-16: the reason may be said) — the same for every visitor (world.view).

/** GET /api/work/place?b=&f=&room= and GET /api/work/person?i= (presenceOf: () → WorkPresence | null). */
export function addWorkplaceRoutes(router, presenceOf) {
  const int = v => (/^\d{1,7}$/.test(String(v ?? '')) ? Number(v) : null);
  router.add({
    method: 'GET', path: '/api/work/place', cap: 'world.view', handler: ({ url }) => {
      const P = presenceOf(), b = int(url.searchParams.get('b')), f = int(url.searchParams.get('f')), room = int(url.searchParams.get('room') ?? '0') ?? 0;
      if (!P || b === null || f === null) return { status: 404, json: { error: 'No such workplace', code: 'not_found' } };
      const v = P.view(`${b}:${f}:${room}`);
      return v ? { status: 200, json: v } : { status: 404, json: { error: 'Nobody works there', code: 'not_found' } };
    },
  });
  router.add({
    method: 'GET', path: '/api/work/person', cap: 'world.view', handler: ({ url }) => {
      const P = presenceOf(), i = int(url.searchParams.get('i'));
      if (!P || i === null) return { status: 404, json: { error: 'No such person', code: 'not_found' } };
      const w = P.workOf(i, { teamMax: 30 }), pos = P.positionOf(i);
      return { status: 200, json: { i, work: w, place: pos ? { key: pos.key, b: pos.b, f: pos.f } : null } };
    },
  });
}
