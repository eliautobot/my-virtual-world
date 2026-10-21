// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy over HTTP (docs/features/ECONOMY.md). Everyone may read the city's economy (transparency: the budget,
// prices, businesses, the treasury's ledger); members use their wallet (economy.use); administrators run it
// (economy.admin). Connected agents use /api/agent-api/economy/* with their bearer token, within their owner's limits.
// Every route goes through the server's pipeline (session, capability, Origin, CSRF, JSON); amounts are hundredths
// of a VC.
import { LedgerError } from './ledger.js';
import { subj } from './economy.js';

/**
 * @param {object} router
 * @param {import('./economy.js').Economy} econ
 * @param {object} d  { perms, players (where players stand), agentOfSlot (a connected agent's record from its slot), reauthMs }
 */
export function addEconomyRoutes(router, econ, d) {
  const ok = (json, status = 200) => ({ status, json });
  const fail = e => {
    if (e instanceof LedgerError) return ok({ error: e.message, code: e.code, ...(e.detail || {}) }, e.status);
    throw e;
  };
  const run = fn => async ctx => { try { return ok(await fn(ctx)); } catch (e) { return fail(e); } };
  const body = ctx => ctx.body || {};
  const me = P => ({ kind: 'account', id: P.account.id, login: P.account.login, admin: d.perms.allowed(P, 'economy.admin') });
  const admin = P => ({ id: P.account.id, login: P.account.login });
  const reauthOk = P => !!P.session && Date.now() - P.session.authAt <= d.reauthMs;
  const int = v => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : NaN);
  const need = () => { if (!econ.enabled()) throw new LedgerError('off', 'The economy is switched off here.', 409); };
  const parts = econ.parts;

  // ------------------------------------------------------------------------------------------- everyone
  router.add({ method: 'GET', path: '/api/economy/status', cap: 'world.view', handler: async ({ P }) => {
    const s = econ.status();
    if (P.account && econ.enabled() && d.perms.allowed(P, 'economy.use')) { const w = econ.walletFor(subj('account', P.account.id)); s.balance = w.balance; s.available = w.balance - w.held; s.walletId = w.id; s.frozen = w.status === 'frozen'; }
    return ok(s);
  } });
  router.add({ method: 'GET', path: '/api/economy/overview', cap: 'world.view', handler: run(() => { need(); return parts.views.overview(); }) });
  router.add({ method: 'GET', path: '/api/economy/budget', cap: 'world.view', handler: run(() => { need(); return parts.city.budget(30); }) });
  router.add({ method: 'GET', path: '/api/economy/businesses', cap: 'world.view', handler: run(() => { need(); return { version: parts.businesses.version, businesses: parts.businesses.table(econ.econDay() - 1) }; }) });
  router.add({ method: 'GET', prefix: '/api/economy/business/', cap: 'world.view', handler: run(({ P, param }) => {
    need();
    const b = parts.businesses.get(decodeURIComponent(param || '').slice(0, 40));
    if (!b) throw new LedgerError('not_found', 'No such business.', 404);
    const owner = !!P.account && parts.businesses.mayManage(me(P), b);
    return { business: parts.businesses.view(b, { owner }), mayManage: owner, ...parts.realty.venueInfo(b, P.account ? me(P) : null) };
  }) });
  router.add({ method: 'GET', path: '/api/economy/place', cap: 'world.view', handler: run(({ url, P }) => {
    need();
    const b = int(url.searchParams.get('b')), f = int(url.searchParams.get('f'));
    const biz = Number.isSafeInteger(f) ? parts.businesses.at(b, f) : null, company = parts.businesses.companyOf(b);
    return { business: biz ? parts.businesses.view(biz) : null, company: company ? parts.businesses.view(company) : null, ...(biz ? parts.realty.venueInfo(biz, P?.account ? me(P) : null) : {}) };
  }) });
  router.add({ method: 'GET', path: '/api/economy/market', cap: 'world.view', handler: run(() => { need(); return { commodities: parts.market.board(30), exportPct: parts.market.exportPct(econ.econDay()) }; }) });
  router.add({ method: 'GET', path: '/api/economy/index', cap: 'world.view', handler: run(() => { need(); return parts.market.index(60); }) });
  router.add({ method: 'GET', path: '/api/economy/series', cap: 'world.view', handler: run(({ url }) => {
    need();
    const keys = String(url.searchParams.get('keys') || '').split(',').filter(k => /^[a-z][A-Za-z0-9:]{1,30}$/.test(k)).slice(0, 12), n = Math.max(1, Math.min(365, int(url.searchParams.get('days')) || 30));
    return { series: parts.stats.series(keys, n) };
  }) });
  router.add({ method: 'GET', path: '/api/economy/lens', cap: 'world.view', handler: run(({ url }) => {
    need();
    const v = parts.views.lens(String(url.searchParams.get('kind') || ''));
    if (!v) throw new LedgerError('input', 'Lenses: revenue, profit, rent, wealth, jobs, land.', 400);
    return v;
  }) });
  router.add({ method: 'GET', path: '/api/economy/coins', cap: 'world.view', handler: run(({ url }) => { need(); return { coins: parts.stats.recentSince(int(url.searchParams.get('since')) || Date.now() - 5000), now: Date.now() }; }) });
  // A resident's money at a glance (savings, rent, landlord). An agent's wallet is its owner's: anyone else gets its rent
  // (what its flat costs is public) but not its wallet.
  router.add({ method: 'GET', path: '/api/economy/resident', cap: 'world.view', handler: run(({ P, url }) => {
    need();
    const i = int(url.searchParams.get('i')), r = parts.views.resident(i), p = r ? (econ.d.people() || [])[i] : null, s = p ? econ.personSubject(p) : null;
    if (r && s.kind === 'agent' && !(P.account && econ.agentOwner(s.id) === P.account.id)) r.wallet = null;
    return { resident: r };
  }) });
  // A person's money lately (the selection card's money feed). A resident's is public, like the city's books: their
  // savings, rent, what they bought and their daily settlements. An agent's money is its owner's (ECONOMY.md §8): its
  // owner sees its wallet and statement; anyone else learns only that it is private - and a body that passes for a
  // resident (a hidden connected agent) shows what anyone could see it buy, never its wallet.
  router.add({ method: 'GET', path: '/api/economy/person', cap: 'world.view', handler: run(({ P, url }) => {
    need();
    const i = int(url.searchParams.get('i')), p = (econ.d.people() || [])[i];
    if (!p || p.retired) throw new LedgerError('not_found', 'No such person.', 404);
    const s = econ.personSubject(p), shown = !!p.vip && (econ.d.sim()?.agentShown?.(p.agentId) ?? true);
    const head = parts.views.resident(i);
    if (s.kind === 'agent') {
      const mine = !!P.account && econ.agentOwner(s.id) === P.account.id;
      if (mine) return { ...head, lines: parts.views.personFeed(i, { ledger: true, limit: 15 }) };
      // anyone else: not its wallet (its balance is its owner's too), not its rent
      if (shown) return { name: head.name, private: true, wallet: null, rent: 0, landlord: null, lines: [] };
      return { name: head.name, wallet: null, rent: 0, landlord: null, lines: parts.views.personFeed(i, { ledger: false }) };
    }
    return { ...head, lines: parts.views.personFeed(i, { ledger: true, limit: 6 }) };
  }) });
  // the treasury's ledger is public: every coin in and out of the city's purse
  router.add({ method: 'GET', path: '/api/economy/treasury', cap: 'world.view', handler: run(({ url }) => {
    need();
    const T = econ.treasury();
    return { wallet: econ.walletView(T), statement: econ.statement(T.id, { before: int(url.searchParams.get('before')) || undefined, limit: 50 }) };
  }) });

  // ------------------------------------------------------------------------------------------- members
  router.add({ method: 'GET', path: '/api/economy/me', cap: 'economy.use', handler: run(({ P }) => econ.mine(P.account.id)) });
  router.add({ method: 'GET', path: '/api/economy/statement', cap: 'economy.use', handler: run(({ P, url }) => {
    need();
    const wid = String(url.searchParams.get('wallet') || ''), actor = me(P);
    const w = wid ? econ.ledger.wallet(wid) : econ.walletFor(subj('account', P.account.id));
    if (!w || !(econ.mayDebit(actor, w) || (actor.admin && (w.owner_kind === 'city' || w.owner_kind === 'business')))) throw new LedgerError('rights', 'That wallet isn\'t yours.', 403);
    const kind = url.searchParams.get('kind');
    return { wallet: econ.walletView(w), statement: econ.statement(w.id, { before: int(url.searchParams.get('before')) || undefined, limit: int(url.searchParams.get('limit')) || 50, kind: kind && /^[a-z_]{2,24}$/.test(kind) ? kind : null }) };
  }) });
  router.add({ method: 'GET', path: '/api/economy/search', cap: 'economy.use', handler: run(({ P, url }) => {
    need();
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 40);
    if (q.length < 2) return { results: [] };
    const out = [];
    for (const r of econ.db.prepare("SELECT id, login, display_name FROM accounts WHERE world_id = ? AND status = 'active' AND (login LIKE ? OR display_key LIKE ?) LIMIT 8").all(econ.w, `%${q}%`, `%${q}%`)) if (r.id !== P.account.id) out.push({ kind: 'account', id: r.id, login: r.login, name: r.display_name });
    for (const a of econ.d.agents?.enabled?.() || []) if (a.name.toLowerCase().includes(q) && (econ.d.agentVisible?.(a, me(P)) ?? true)) out.push({ kind: 'agent', id: a.id, name: a.name, emoji: a.emoji });
    for (const b of parts.businesses.open()) if (b.name.toLowerCase().includes(q) && out.length < 24) out.push({ kind: 'business', id: b.id, name: b.name, emoji: b.kind === 'office' ? '🏢' : '🏪' });
    return { results: out.slice(0, 24) };
  }) });
  router.add({ method: 'POST', path: '/api/economy/pay', cap: 'economy.use', handler: run(ctx => {
    const b = body(ctx);
    return econ.pay({ actor: me(ctx.P), reauthOk: reauthOk(ctx.P) }, { to: b.to, amount: int(b.amount), memo: b.memo, idem: b.idem, from: b.from || null });
  }) });
  router.add({ method: 'POST', path: '/api/economy/request', cap: 'economy.use', handler: run(ctx => { const b = body(ctx); return econ.request({ actor: me(ctx.P) }, { from: b.from, amount: int(b.amount), memo: b.memo }); }) });
  router.add({ method: 'POST', path: '/api/economy/request/answer', cap: 'economy.use', handler: run(ctx => {
    const b = body(ctx);
    return econ.answerRequest({ actor: me(ctx.P), reauthOk: reauthOk(ctx.P) }, String(b.id || ''), String(b.answer || ''));
  }) });
  // buying at a venue: a player must be there (inside the building or at its door)
  router.add({ method: 'POST', path: '/api/economy/buy', cap: 'economy.use', handler: run(ctx => {
    const b = body(ctx), biz = parts.businesses.get(String(b.business || ''));
    if (!biz) throw new LedgerError('not_found', 'That place doesn\'t sell anything.', 404);
    const where = d.whereIs?.(ctx.P.account.id);
    if (!where || !d.isAt(where, biz)) throw new LedgerError('not_here', `Go to ${biz.name} to buy there.`, 409, { b: biz.b, f: biz.f });
    return econ.buy({ actor: me(ctx.P) }, { business: biz.id, items: b.items, idem: b.idem });
  }) });
  router.add({ method: 'POST', path: '/api/economy/business/configure', cap: 'economy.use', handler: run(ctx => { const b = body(ctx); return { business: parts.businesses.configure(me(ctx.P), String(b.id || ''), b) }; }) });
  router.add({ method: 'POST', path: '/api/economy/business/move', cap: 'economy.use', handler: run(ctx => {
    const b = body(ctx), amount = int(b.amount);
    if (b.dir === 'draw' && amount > econ.policy().limits.reauthAbove && !reauthOk(ctx.P)) throw new LedgerError('reauth_required', 'Confirm your password to take this much out', 403);
    return parts.businesses.move(me(ctx.P), String(b.id || ''), String(b.dir || ''), amount);
  }) });
  // funding an agent's wallet and taking money back from it
  router.add({ method: 'POST', path: '/api/economy/agent/move', cap: 'economy.use', handler: run(ctx => {
    econ.live();
    const b = body(ctx), a = econ.d.agents?.byId?.(int(b.agent)), amount = int(b.amount);
    if (!a || econ.agentOwner(a.id) !== ctx.P.account.id) throw new LedgerError('rights', 'Only the agent\'s owner moves its money.', 403);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('input', 'Bad amount.', 400);
    const mine = econ.walletFor(subj('account', ctx.P.account.id)), its = econ.walletFor(subj('agent', a.id));
    const [from, to] = b.dir === 'fund' ? [mine, its] : b.dir === 'take' ? [its, mine] : [null, null];
    if (!from) throw new LedgerError('input', 'Fund or take.', 400);
    const t = econ.ledger.transfer(from.id, to.id, amount, { kind: b.dir === 'fund' ? 'fund' : 'draw', actor: `account:${ctx.P.account.id}`, memo: b.dir === 'fund' ? `Pocket money for ${a.name}` : `Back from ${a.name}` });
    return econ.txView(t, mine.id);
  }) });
  router.add({ method: 'POST', path: '/api/economy/agent/limits', cap: 'economy.use', handler: run(ctx => { const b = body(ctx); return { limits: parts.agents.setLimits(me(ctx.P), int(b.agent), b) }; }) });
  // where approvals of this owner stand, by id (a chat's Approve/Decline cards, a notification)
  router.add({ method: 'GET', path: '/api/economy/approvals', cap: 'economy.use', handler: run(ctx => ({ approvals: parts.agents.ofOwner(me(ctx.P).id, String(ctx.url.searchParams.get('ids') || '').split(',').filter(Boolean)) })) });
  router.add({ method: 'POST', path: '/api/economy/approval/answer', cap: 'economy.use', handler: run(ctx => {
    const b = body(ctx);
    return { approval: parts.agents.decide(me(ctx.P), String(b.id || ''), b.approve === true, (action, payload, agentId) => d.runAgentAction(action, payload, agentId, true)) };
  }) });

  // ------------------------------------------------------------------------------------------- property for Virtual Coin
  router.add({ method: 'GET', path: '/api/economy/realty', cap: 'world.view', handler: run(() => { need(); return { kinds: parts.realty.kinds(), version: parts.realty.version, listings: parts.realty.listings() }; }) });
  router.add({ method: 'GET', path: '/api/economy/realty/on', cap: 'world.view', handler: run(({ url }) => { need(); const t = String(url.searchParams.get('target') || '').slice(0, 120); return { kinds: parts.realty.kinds(), listings: parts.realty.listingsOn(t), lease: parts.realty.leaseOn(t) }; }) });
  router.add({ method: 'POST', path: '/api/economy/realty/list', cap: 'economy.use', handler: run(ctx => { const b = body(ctx); return { listing: parts.realty.list(me(ctx.P), { kind: String(b.kind || ''), target: b.target, price: int(b.price), note: b.note }) }; }) });
  router.add({ method: 'POST', path: '/api/economy/realty/unlist', cap: 'economy.use', handler: run(ctx => ({ listing: parts.realty.unlist(me(ctx.P), String(body(ctx).id || '')) })) });
  router.add({ method: 'POST', path: '/api/economy/realty/take', cap: 'economy.use', handler: run(ctx => {
    const b = body(ctx), l = parts.realty.q.get.get(econ.w, String(b.id || ''));
    if (l && !l.kind.endsWith('_rent') && l.price > econ.policy().limits.reauthAbove && !reauthOk(ctx.P)) throw new LedgerError('reauth_required', 'Confirm your password to buy this', 403);
    return parts.realty.take(me(ctx.P), String(b.id || ''), { idem: b.idem });
  }) });
  router.add({ method: 'POST', path: '/api/economy/realty/end', cap: 'economy.use', handler: run(ctx => ({ lease: parts.realty.endLease(me(ctx.P), String(body(ctx).lease || '')) })) });

  // ------------------------------------------------------------------------------------------- jobs
  router.add({ method: 'GET', path: '/api/economy/jobs/board', cap: 'world.view', handler: run(() => { need(); return { board: parts.jobs.board(), hour: econ.hourOf() }; }) });
  router.add({ method: 'GET', path: '/api/economy/reviews', cap: 'world.view', handler: run(({ url }) => { need(); return { reviews: parts.jobs.reviews(String(url.searchParams.get('business') || '').slice(0, 40), 30) }; }) });
  router.add({ method: 'GET', path: '/api/economy/jobs/me', cap: 'economy.use', handler: run(({ P }) => { need(); return parts.jobs.of({ kind: 'account', id: P.account.id }); }) });
  router.add({ method: 'POST', path: '/api/economy/work/start', cap: 'economy.use', handler: run(ctx => { const b = body(ctx); return { session: parts.jobs.start({ kind: 'account', id: ctx.P.account.id }, { business: b.business, role: String(b.role || ''), mode: 'play' }) }; }) });
  router.add({ method: 'POST', path: '/api/economy/work/act', cap: 'economy.use', handler: run(ctx => { const b = body(ctx); return parts.jobs.act({ kind: 'account', id: ctx.P.account.id }, { session: b.session, n: b.n, reports: b.reports }); }) });
  router.add({ method: 'POST', path: '/api/economy/work/end', cap: 'economy.use', handler: run(ctx => parts.jobs.end({ kind: 'account', id: ctx.P.account.id }, { session: body(ctx).session })) });

  // ------------------------------------------------------------------------------------------- administrators
  router.add({ method: 'GET', path: '/api/economy/admin', cap: 'economy.admin', handler: async () => ok({ ...econ.status(), policy: econ.policy(), defaults: econ.defaults(), genesis: econ.setting('economy.genesisDone') === '1', supply: econ.enabled() ? econ.ledger.supply() : null, transactions: econ.ledger.count().n }) });
  router.add({ method: 'POST', path: '/api/economy/admin/switch', cap: 'economy.admin', reauth: true, handler: run(ctx => {
    const b = body(ctx);
    if (b.name === 'enabled' && ctx.P.role !== 'owner') throw new LedgerError('rights', 'Only the owner switches the economy on or off.', 403);
    return econ.setSwitch(String(b.name || ''), b.on === true, admin(ctx.P));
  }) });
  router.add({ method: 'POST', path: '/api/economy/admin/policy', cap: 'economy.admin', handler: run(ctx => ({ policy: econ.setPolicy(body(ctx).policy, admin(ctx.P)) })) });
  router.add({ method: 'POST', path: '/api/economy/admin/policy/reset', cap: 'economy.admin', reauth: true, handler: run(ctx => ({ policy: econ.resetPolicy(admin(ctx.P)) })) });
  router.add({ method: 'POST', path: '/api/economy/admin/grant', cap: 'economy.admin', reauth: true, handler: run(ctx => { const b = body(ctx); return econ.grant(admin(ctx.P), { to: b.to, amount: int(b.amount), memo: b.memo }); }) });
  router.add({ method: 'POST', path: '/api/economy/admin/correct', cap: 'economy.admin', reauth: true, handler: run(ctx => { const b = body(ctx); return econ.correct(admin(ctx.P), { tx: b.tx, memo: b.memo }); }) });
  router.add({ method: 'POST', path: '/api/economy/admin/freeze', cap: 'economy.admin', handler: run(ctx => { const b = body(ctx); return { wallet: econ.freeze(admin(ctx.P), { wallet: b.wallet, frozen: b.frozen === true, memo: b.memo }) }; }) });
  router.add({ method: 'GET', path: '/api/economy/admin/health', cap: 'economy.admin', handler: run(() => econ.health()) });
  router.add({ method: 'GET', path: '/api/economy/admin/wallet', cap: 'economy.admin', handler: run(({ url }) => {
    const kind = String(url.searchParams.get('kind') || ''), id = String(url.searchParams.get('id') || '').slice(0, 80);
    let w;
    if (kind === 'wallet') w = econ.ledger.wallet(id);
    else if (kind === 'login') { const a = econ.q.byLogin.get(econ.w, id.toLowerCase()); w = a ? econ.walletFor(subj('account', a.id)) : null; }
    else if (['account', 'agent', 'resident', 'business'].includes(kind)) w = econ.ledger.walletOf(kind, id, kind === 'business' ? 'business' : 'main');
    else if (kind === 'city') w = econ.treasury();
    if (!w) throw new LedgerError('not_found', 'No such wallet.', 404);
    return { wallet: econ.walletView(w), statement: econ.statement(w.id, { limit: 100 }), holds: econ.ledger.holdsOf(w.id) };
  }) });
  router.add({ method: 'POST', path: '/api/economy/admin/bond', cap: 'economy.admin', reauth: true, handler: run(ctx => { const b = body(ctx); return parts.city.issueBond(admin(ctx.P), { amount: int(b.amount), days: int(b.days) || undefined }); }) });
  router.add({ method: 'POST', path: '/api/economy/admin/settle', cap: 'economy.admin', handler: run(() => { need(); return { settled: parts.households.catchUp() }; }) });

  // ------------------------------------------------------------------------------------------- connected agents
  const agentRoute = (method, path, fn) => router.add({ method, path, cap: 'public', principal: 'agent', auth: 'bearer', handler: async ctx => {
    const a = d.agentOfSlot(ctx.A);
    if (!a) return ok({ error: 'This agent has no record in the world yet', code: 'not_found' }, 404);
    try { return ok(await fn(a, ctx)); } catch (e) {
      if (e instanceof LedgerError && e.code === 'approval_required') return ok({ status: 'approval_required', ...e.detail, message: e.message }, 202);
      return fail(e);
    }
  } });
  agentRoute('GET', '/api/agent-api/economy/wallet', a => {
    need();
    const w = econ.walletFor(subj('agent', a.id));
    return { wallet: econ.walletView(w), limits: parts.agents.limitsOf(a.id), statement: econ.statement(w.id, { limit: 30 }), approvals: parts.agents.ofAgent(a.id).slice(0, 10), scale: 100 };
  });
  agentRoute('GET', '/api/agent-api/economy/businesses', () => { need(); return { businesses: parts.businesses.open().filter(b => b.f !== -1).map(b => parts.businesses.view(b)) }; });
  agentRoute('POST', '/api/agent-api/economy/pay', (a, ctx) => d.runAgentAction('pay', ctx.body || {}, a.id, false));
  agentRoute('GET', '/api/agent-api/economy/realty', () => { need(); return { kinds: parts.realty.kinds(), listings: parts.realty.listings() }; });
  agentRoute('POST', '/api/agent-api/economy/realty/take', (a, ctx) => d.runAgentAction('realty', ctx.body || {}, a.id, false));
  agentRoute('POST', '/api/agent-api/economy/realty/end', (a, ctx) => ({ lease: parts.realty.endLease({ kind: 'agent', id: a.id }, String((ctx.body || {}).lease || '')) }));
  // jobs: the board, a shift (played through the same orders as a player, or "auto"), its orders and its end
  agentRoute('GET', '/api/agent-api/economy/jobs', a => { need(); return { board: parts.jobs.board(), me: parts.jobs.of({ kind: 'agent', id: a.id }) }; });
  agentRoute('POST', '/api/agent-api/economy/work/start', (a, ctx) => { parts.agents.check(a.id, 'work', 0, { approved: true }); const b = ctx.body || {}; return { session: parts.jobs.start({ kind: 'agent', id: a.id }, { business: b.business, role: String(b.role || ''), mode: b.mode === 'auto' ? 'auto' : 'play' }) }; });
  agentRoute('POST', '/api/agent-api/economy/work/act', (a, ctx) => { const b = ctx.body || {}; return parts.jobs.act({ kind: 'agent', id: a.id }, { session: b.session, n: b.n, reports: b.reports }); });
  agentRoute('POST', '/api/agent-api/economy/work/end', (a, ctx) => parts.jobs.end({ kind: 'agent', id: a.id }, { session: (ctx.body || {}).session }));
  agentRoute('POST', '/api/agent-api/economy/buy', (a, ctx) => d.runAgentAction('buy', ctx.body || {}, a.id, false));
  agentRoute('POST', '/api/agent-api/economy/request', (a, ctx) => { const b = ctx.body || {}; parts.agents.check(a.id, 'pay', 0, { approved: true }); return econ.request({ actor: { kind: 'agent', id: a.id } }, { from: b.from, amount: int(b.amount), memo: b.memo }); });
  agentRoute('POST', '/api/agent-api/economy/request/answer', (a, ctx) => {
    const b = ctx.body || {}, r = econ.q.request.get(econ.w, String(b.id || ''));
    if (b.answer === 'pay' && r) return d.runAgentAction('payRequest', { id: r.id }, a.id, false);
    return econ.answerRequest({ actor: { kind: 'agent', id: a.id } }, String(b.id || ''), String(b.answer || ''));
  });
}
