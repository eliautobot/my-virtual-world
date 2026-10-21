// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The inventory's routes (server/economy/inventory.js; docs/features/INVENTORY.md): a player's own inventory and their
// agents', giving something to a player, an agent or a business, throwing something away, an administrator's grant; and
// an agent's own (the agent API: what it holds, giving within its owner's limits).
import { LedgerError } from './ledger.js';
import { subj } from './economy.js';
import { itemOf } from '../../shared/items.js';

/** @param router @param econ the economy @param inv the inventory @param d { perms, agentOfSlot, runAgentAction } */
export function addInventoryRoutes(router, econ, inv, d) {
  const ok = (json, status = 200) => ({ status, json });
  const fail = e => { if (e instanceof LedgerError) return ok({ error: e.message, code: e.code, ...(e.detail || {}) }, e.status); throw e; };
  const run = fn => async ctx => { try { return ok(await fn(ctx)); } catch (e) { return fail(e); } };
  const me = P => ({ kind: 'account', id: P.account.id, admin: d.perms.allowed(P, 'economy.admin') });
  const int = v => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isSafeInteger(n) ? n : null; };
  const mine = (P, agent) => { if (agent != null && econ.agentOwner(agent) !== P.account.id && !d.perms.allowed(P, 'economy.admin')) throw new LedgerError('rights', 'That agent isn\'t yours.', 403); return agent != null ? subj('agent', agent) : subj('account', P.account.id); };

  router.add({ method: 'GET', path: '/api/inventory', cap: 'economy.use', handler: run(({ P, url }) => {
    const agent = int(url.searchParams.get('agent')), who = mine(P, agent), welcome = inv.welcome(who);
    const agents = (d.agentsOf?.(P.account.id) || []).map(a => ({ id: a.id, name: a.name, emoji: a.emoji, count: inv.list(subj('agent', a.id)).length }));
    for (const a of agents) inv.welcome(subj('agent', a.id));
    return { ...inv.view(who), agents, welcome, history: url.searchParams.get('history') ? inv.history(who) : undefined };
  }) });
  router.add({ method: 'POST', path: '/api/inventory/give', cap: 'economy.use', handler: run(({ P, body }) => {
    const b = body || {};
    return inv.give(me(P), { stack: int(b.stack), qty: int(b.qty) ?? 1, to: b.to, from: int(b.from), memo: b.memo, idem: b.idem });
  }) });
  router.add({ method: 'POST', path: '/api/inventory/discard', cap: 'economy.use', handler: run(({ P, body }) => {
    const b = body || {}, who = mine(P, int(b.from));
    return inv.take(who, int(b.stack), int(b.qty) ?? 1, { kind: 'discard', actor: `account:${P.account.id}` });
  }) });
  router.add({ method: 'POST', path: '/api/inventory/grant', cap: 'economy.admin', handler: run(({ P, body }) => {
    const b = body || {}, to = inv.recipient(b.to);
    if (!itemOf(b.item)) throw new LedgerError('input', 'No such item.', 400);
    const r = inv.add(to, String(b.item), int(b.qty) ?? 1, b.attrs && typeof b.attrs === 'object' ? b.attrs : null, { kind: 'grant', actor: `admin:${P.account.id}`, memo: String(b.memo || 'A grant').slice(0, 140) });
    inv.tell(to, { kind: 'system', id: 'grants' }, { item: String(b.item), qty: int(b.qty) ?? 1 });
    return r;
  }) });

  // trading (./trades.js): a player's own trades, or one of their agents' (as)
  const T = d.trades;
  router.add({ method: 'GET', path: '/api/inventory/trades', cap: 'economy.use', handler: run(({ P, url }) => ({ trades: T.list(mine(P, int(url.searchParams.get('agent')))) })) });
  router.add({ method: 'POST', path: '/api/inventory/trade/open', cap: 'economy.use', handler: run(({ P, body }) => { const b = body || {}; return T.open(me(P), { to: b.to, as: int(b.as), memo: b.memo }); }) });
  router.add({ method: 'POST', path: '/api/inventory/trade/offer', cap: 'economy.use', handler: run(({ P, body }) => { const b = body || {}; return T.offer(me(P), { trade: String(b.trade || ''), items: b.items, vc: int(b.vc) ?? 0, as: int(b.as) }); }) });
  router.add({ method: 'POST', path: '/api/inventory/trade/accept', cap: 'economy.use', handler: run(({ P, body }) => { const b = body || {}; return T.accept(me(P), { trade: String(b.trade || ''), as: int(b.as) }); }) });
  router.add({ method: 'POST', path: '/api/inventory/trade/decline', cap: 'economy.use', handler: run(({ P, body }) => { const b = body || {}; return T.decline(me(P), { trade: String(b.trade || ''), as: int(b.as) }); }) });

  // an agent's own (the agent API)
  const agentRoute = (method, path, fn) => router.add({ method, path, cap: 'public', principal: 'agent', auth: 'bearer', handler: async ctx => {
    const a = d.agentOfSlot(ctx.A);
    if (!a) return ok({ error: 'This agent has no record in the world yet', code: 'not_found' }, 404);
    try { return ok(await fn(a, ctx)); } catch (e) {
      if (e instanceof LedgerError && e.code === 'approval_required') return ok({ status: 'approval_required', ...e.detail, message: e.message }, 202);
      return fail(e);
    }
  } });
  agentRoute('GET', '/api/agent-api/inventory', a => {
    inv.welcome(subj('agent', a.id));
    const v = inv.view(subj('agent', a.id));
    return { ...v, stacks: v.stacks.map(s => ({ ...s, name: itemOf(s.item)?.name, cat: itemOf(s.item)?.cat })), scale: 100 };
  });
  agentRoute('POST', '/api/agent-api/inventory/give', (a, ctx) => d.runAgentAction('give', ctx.body || {}, a.id, false));
  // its trades: open one with someone (by name), put things (a ref or a name) and coin on its side, accept (its owner's
  // rules: above their line they approve first), decline
  const agentSide = a => ({ kind: 'agent', id: a.id });
  agentRoute('GET', '/api/agent-api/trades', a => ({ trades: T.list(subj('agent', a.id)), scale: 100 }));
  agentRoute('POST', '/api/agent-api/trade/open', (a, ctx) => { const b = ctx.body || {}; return T.open(agentSide(a), { to: b.to, memo: b.memo }); });
  agentRoute('POST', '/api/agent-api/trade/offer', (a, ctx) => {
    const b = ctx.body || {}, me = subj('agent', a.id);
    const items = (Array.isArray(b.items) ? b.items : []).map(l => ({ stack: l?.stack ?? inv.stackOf(me, l?.item ?? l?.ref), qty: l?.qty ?? 1 }));
    return T.offer(agentSide(a), { trade: String(b.trade || ''), items, vc: int(b.vc) ?? 0 });
  });
  agentRoute('POST', '/api/agent-api/trade/accept', (a, ctx) => d.runAgentAction('tradeAccept', { trade: String((ctx.body || {}).trade || '') }, a.id, false));
  agentRoute('POST', '/api/agent-api/trade/decline', (a, ctx) => T.decline(agentSide(a), { trade: String((ctx.body || {}).trade || '') }));
}
