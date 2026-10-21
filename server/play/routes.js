// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The play modules' HTTP routes (docs/features/play-modules.md): the modules and their badges, a player's profile and
// progress, leaderboards, and starting, playing (a module's own moves: act) and finishing a run. Every module uses the
// same routes.
import { PlayError } from './play.js';
import { FishError } from './fish-market.js';

const wrap = fn => async ctx => {
  try { return { status: 200, json: await fn(ctx) }; }
  catch (e) {
    if (e instanceof PlayError || e instanceof FishError) return { status: e.status, json: { error: e.message, code: e.code } };
    if (e?.name === 'LedgerError' || e?.code === 'paused' || e?.code === 'limit') return { status: e.status || 409, json: { error: e.message, code: e.code } };
    throw e;
  }
};
const str = (v, max = 64) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = v => { const n = Number(v); return Number.isSafeInteger(n) ? n : null; };

/** @param router @param d { play: PlayCore, onFinish?(account, result), fishMarket?: FishMarket, angler?: Angler } */
export function addPlayRoutes(router, d) {
  const P = d.play;
  router.add({ method: 'GET', path: '/api/play', cap: 'world.view', handler: wrap(() => ({ modules: P.modules(), badges: P.catalog() })) });
  router.add({ method: 'GET', path: '/api/play/leaderboard', cap: 'world.view', handler: wrap(({ url, P: who }) =>
    P.leaderboard(str(url.searchParams.get('module')), str(url.searchParams.get('course')), { limit: int(url.searchParams.get('limit')) || 20, viewer: who.account?.id ?? null })) });
  router.add({ method: 'GET', path: '/api/play/winnings', cap: 'play.use', handler: wrap(({ P: who }) => P.winnings(who.account.id)) });
  router.add({ method: 'GET', path: '/api/play/top', cap: 'world.view', handler: wrap(({ url }) => ({ rows: P.topPlayers(int(url.searchParams.get('limit')) || 20) })) });
  router.add({ method: 'GET', path: '/api/play/profile', cap: 'play.use', handler: wrap(({ url, P: who }) => {
    const q = url.searchParams.get('id'), id = q ? int(q) : who.account.id;
    return P.profile(id, who.account.id);
  }) });
  router.add({ method: 'POST', path: '/api/play/profile', cap: 'account.self', handler: wrap(({ body, P: who }) =>
    P.setProfile(who.account.id, { bio: body.bio === undefined ? undefined : String(body.bio ?? ''), showcase: body.showcase })) });
  router.add({ method: 'POST', path: '/api/play/start', cap: 'play.use', handler: wrap(({ body, P: who }) =>
    P.start(who.account, str(body.module), str(body.course), body.where ?? null)) });
  router.add({ method: 'POST', path: '/api/play/finish', cap: 'play.use', handler: wrap(({ body, P: who }) => {
    const r = P.finish(who.account, str(body.run), body.report);
    if (r.ok) { const x = d.onFinish?.(who.account, r); if (x && typeof x === 'object') Object.assign(r, x); }   // (a module's own after-math: the fishing trip's catch into the inventory)
    return r;
  }) });
  router.add({ method: 'POST', path: '/api/play/act', cap: 'play.use', handler: wrap(({ body, P: who }) => P.act(who.account, str(body.run), str(body.act, 24), body.body)) });
  router.add({ method: 'POST', path: '/api/play/abandon', cap: 'play.use', handler: wrap(({ body, P: who }) => P.abandon(who.account, str(body.run))) });
  // the fish market at a dock's store (server/play/fish-market.js): what of your inventory it buys, and selling it
  const F = d.fishMarket;
  if (F) {
    router.add({ method: 'GET', path: '/api/fishing/market', cap: 'play.use', handler: wrap(({ P: who }) => F.view(who.account)) });
    router.add({ method: 'POST', path: '/api/fishing/sell', cap: 'play.use', handler: wrap(({ body, P: who }) =>
      F.sell(who.account, Array.isArray(body.stacks) ? body.stacks.map(int).filter(v => v != null).slice(0, 200) : null)) });
  }
  // the angler (server/play/angler.js): the counter's tackle, bait and boat upgrades, what you fish with, your skills
  const A = d.angler;
  if (A) {
    router.add({ method: 'GET', path: '/api/fishing/angler', cap: 'play.use', handler: wrap(({ P: who }) => A.view(who.account)) });
    router.add({ method: 'POST', path: '/api/fishing/buy', cap: 'play.use', handler: wrap(({ body, P: who }) => A.buy(who.account, { kind: str(body.kind, 8), id: str(body.id, 32), packs: int(body.packs) ?? 1 })) });
    router.add({ method: 'POST', path: '/api/fishing/use', cap: 'play.use', handler: wrap(({ body, P: who }) => A.use(who.account, { rod: body.rod, reel: body.reel, line: body.line, leader: body.leader })) });
    router.add({ method: 'POST', path: '/api/fishing/skill', cap: 'play.use', handler: wrap(({ body, P: who }) => A.skill(who.account, { id: str(body.id, 16) })) });
    router.add({ method: 'POST', path: '/api/fishing/respec', cap: 'play.use', handler: wrap(({ P: who }) => A.respec(who.account)) });
    router.add({ method: 'GET', path: '/api/fishing/dex', cap: 'play.use', handler: wrap(({ P: who }) => A.dex(who.account)) });
  }
}
