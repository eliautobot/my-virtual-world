// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Assembles the economy (docs/features/ECONOMY.md) for the server: the core (./economy.js) and its parts, the routes,
// the clock that settles each day and keeps the totals on disk, the simulation's hooks, and what connected agents may
// do with their money.
import { Economy, subj } from './economy.js';
import { LedgerError } from './ledger.js';
import { Businesses } from './businesses.js';
import { Households } from './households.js';
import { Market } from './market.js';
import { City } from './city.js';
import { Stats } from './stats.js';
import { AgentMoney } from './agents.js';
import { Views } from './views.js';
import { Jobs } from './jobs.js';
import { Trust } from './trust.js';
import { Realty } from './realty.js';
import { addEconomyRoutes } from './routes.js';
import { Inventory } from './inventory.js';
import { Trades } from './trades.js';
import { addInventoryRoutes } from './inventory-routes.js';
import { itemOf, itemValue } from '../../shared/items.js';
import { createMindMoney } from './mind-money.js';

/**
 * @param {object} d  everything Economy takes (dbs, box, perms, audit, log, world, people, sim, property,
 *                    agents, notify, broadcast, ownerAccount, agentVisible) plus router, players, agentOfSlot, reauthMs
 */
export function createEconomy(d) {
  const econ = new Economy(d);
  const p = econ.parts;
  p.businesses = new Businesses(econ, { property: d.property });
  p.households = new Households(econ);
  p.market = new Market(econ);
  p.city = new City(econ);
  p.stats = new Stats(econ);
  p.agents = new AgentMoney(econ);
  p.views = new Views(econ);
  p.trust = new Trust(econ);
  const isAt = (where, biz) => where.b === biz.b || (Number.isFinite(where.x) && near(d.world(), biz.b, where.x, where.z, 18));
  // a player works or buys where they stand; an agent's body is the simulation's, so it may work anywhere it is allowed
  p.realty = new Realty(econ, { property: d.property, editor: d.editor, agentBody: d.agentBody, lotsChanged: d.lotsChanged });
  p.jobs = new Jobs(econ, { notify: d.notify, isThere: (actor, biz) => { if (actor.kind !== 'account') return true; const w = d.whereIs?.(actor.id); return !!w && isAt(w, biz); } });

  // the inventory (./inventory.js): what each player, agent and business holds, beside its wallet
  p.inventory = new Inventory(econ);
  p.trades = new Trades(econ, p.inventory);   // (./trades.js: two sides, both accept, one transaction)
  const runAgentAction = agentActions(econ);

  addEconomyRoutes(d.router, econ, { perms: d.perms, reauthMs: d.reauthMs, agentOfSlot: d.agentOfSlot, runAgentAction, whereIs: d.whereIs, isAt });
  addInventoryRoutes(d.router, econ, p.inventory, { perms: d.perms, agentOfSlot: d.agentOfSlot, runAgentAction, trades: p.trades,
    agentsOf: accountId => (d.agents?.enabled?.() || []).filter(a => econ.agentOwner(a.id) === Number(accountId)) });

  // ------------------------------------------------------------------------------------------- the simulation's hooks
  const hook = () => {
    const sim = d.sim();
    if (!sim) return;
    const on = econ.enabled();
    sim.econ = on ? p.households : null;
    sim.onAct = on ? (a, act) => { try { p.households.onAct(a, act); } catch (e) { sim.noteError?.(e); } } : null;
  };

  // ------------------------------------------------------------------------------------------- the clock
  let timers = [], lastSync = 0, busy = false;
  function tick() {
    if (busy) return;
    busy = true;
    try {
      hook();
      if (!econ.enabled()) return;
      if (!econ.genesisDone()) econ.genesis();
      const now = Date.now();
      if (now - lastSync > 60000) { lastSync = now; p.businesses.sync(); }
      p.households.touch(econ.econDay());   // the world ran today (paused or not): the day settles, never skipped
      if (!econ.paused()) {
        const today = econ.econDay();
        if (p.households.lastSettled === null || p.households.lastSettled < today - 1 || p.households.days.size > 1) p.households.catchUp();
      }
    } catch (e) { econ.log.error('[economy] tick failed:', e.stack || e.message); } finally { busy = false; }
  }
  function housekeeping() {
    if (!econ.enabled()) return;
    try { p.households.flush(); } catch (e) { econ.log.error('[economy] saving the day\'s totals failed:', e.message); }
  }
  function minute() {
    if (!econ.enabled()) return;
    try { econ.ledger.expireHolds(); econ.expireRequests(); p.realty.endLeasesDue(); } catch (e) { econ.log.warn('[economy] expiring holds failed:', e.message); }
  }
  function shifts() {
    if (!econ.enabled() || econ.paused()) return;
    try { p.jobs.sweep(); } catch (e) { econ.log.warn('[economy] ending idle shifts failed:', e.message); }
  }
  return {
    econ, runAgentAction,
    // an agent's money as its Mind uses it (server/mind/): through runAgentAction, within its owner's rules
    mindMoney: createMindMoney(econ, runAgentAction),
    start() {
      hook();
      timers = [setInterval(tick, 1000), setInterval(housekeeping, 5000), setInterval(minute, 60000), setInterval(shifts, 30000)];
      for (const t of timers) t.unref?.();
      tick();
    },
    stop() { for (const t of timers) clearInterval(t); timers = []; try { if (econ.enabled()) p.households.flush(); } catch { /* closing */ } },
    /** The world changed (buildings, floors): businesses follow within the second. */
    worldChanged() { lastSync = 0; p.households.landCache.clear(); },
    hook,
  };
}
/**
 * What an agent does with its money - a connected agent's API call, an approval its owner gave, its Mind's tools
 * (./mind-money.js): runAgentAction(action, payload, agentId, approved) runs it within its owner's limits; above the
 * approval threshold it files an approval and answers with its id.
 */
export function agentActions(econ) {
  const p = econ.parts;
  return function runAgentAction(action, payload, agentId, approved) {
    const actor = { kind: 'agent', id: agentId };
    const int = v => (typeof v === 'number' ? v : Number.NaN);
    if (action === 'pay') {
      const amount = int(payload.amount);
      try { p.agents.check(agentId, 'pay', Number.isSafeInteger(amount) ? amount : 0, { approved }); } catch (e) {
        if (e instanceof LedgerError && e.code === 'approval_required') return { status: 'approval_required', ...p.agents.ask(agentId, 'pay', { to: payload.to, amount, memo: payload.memo, idem: payload.idem }, amount, `Pay ${amount / 100} VC`) };
        throw e;
      }
      return { status: 'done', tx: econ.pay({ actor }, { to: payload.to, amount, memo: payload.memo, idem: payload.idem }) };
    }
    if (action === 'give') {   // something from its inventory (./inventory.js), worth as much as a payment of its value
      // (an agent may name things: the stack by its ref or its name, the one it gives to by their name)
      if (payload.stack == null && payload.item) payload = { ...payload, stack: p.inventory.stackOf(subj('agent', agentId), payload.item) };
      if (typeof payload.to === 'string') payload = { ...payload, to: p.inventory.recipientByName(payload.to) };
      if (payload.stack == null) throw new LedgerError('not_found', 'You don\'t have that.', 404);
      try { return { status: 'done', gave: p.inventory.giveAsAgent(agentId, payload, approved) }; } catch (e) {
        if (e instanceof LedgerError && e.code === 'approval_required') {
          const s = p.inventory.list(subj('agent', agentId)).find(x => x.id === Number(payload.stack));
          const def = s && itemOf(s.item), n = Number(payload.qty) || 1, worth = def ? itemValue(def, s.attrs) * n : 0;
          return { status: 'approval_required', ...p.agents.ask(agentId, 'give', { stack: payload.stack, qty: payload.qty, to: payload.to, memo: payload.memo, idem: payload.idem }, worth, `Give ${n} × ${def ? def.name : 'something'}`) };
        }
        throw e;
      }
    }
    if (action === 'tradeAccept') {   // accepting a trade (./trades.js): what it gives away, as a payment of that worth
      try { return { status: 'done', trade: p.trades.accept({ kind: 'agent', id: agentId }, { trade: payload.trade }, approved) }; } catch (e) {
        if (e instanceof LedgerError && e.code === 'approval_required') {
          const t = p.trades.list(subj('agent', agentId)).find(x => x.id === payload.trade);
          const worth = t ? t.me.vc + t.me.items.reduce((a, l) => a + (l.worth || 0), 0) : 0;
          return { status: 'approval_required', ...p.agents.ask(agentId, 'tradeAccept', { trade: payload.trade }, worth, `Accept a trade with ${t?.them.who.name || 'someone'}`) };
        }
        throw e;
      }
    }
    if (action === 'buy') {
      const biz = p.businesses.get(String(payload.business || ''));
      if (!biz) throw new LedgerError('not_found', 'No such business.', 404);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const total = items.reduce((s, x) => s + (p.businesses.priceOf(biz, x?.id) || 0) * (Number.isSafeInteger(x?.n) ? x.n : 1), 0);
      try { p.agents.check(agentId, 'buy', total, { approved }); } catch (e) {
        if (e instanceof LedgerError && e.code === 'approval_required') return { status: 'approval_required', ...p.agents.ask(agentId, 'buy', { business: biz.id, items, idem: payload.idem }, total, `Buy at ${biz.name}`) };
        throw e;
      }
      return { status: 'done', purchase: econ.buy({ actor }, { business: biz.id, items, idem: payload.idem }) };
    }
    if (action === 'realty') {
      const l = p.realty.q.get.get(econ.w, String(payload.id || ''));
      if (!l || l.status !== 'active') throw new LedgerError('not_found', 'That isn\'t on offer any more.', 404);
      const lease = l.kind === 'flat_rent' || l.kind === 'venue_rent', scope = l.kind === 'flat_rent' ? 'rent' : 'business', amount = lease ? Math.max(1, Math.floor(l.price / 30)) : l.price;
      try { p.agents.check(agentId, scope, amount, { approved }); } catch (e) {
        if (e instanceof LedgerError && e.code === 'approval_required') return { status: 'approval_required', ...p.agents.ask(agentId, 'realty', { id: l.id }, l.price, l.kind === 'flat_rent' ? `Rent a flat (${l.price / 100} VC a month)` : l.kind === 'venue_rent' ? `Rent a business to run (${l.price / 100} VC a month)` : `Buy property (${l.price / 100} VC)`) };
        throw e;
      }
      return { status: 'done', ...p.realty.take(actor, l.id, { idem: payload.idem }) };
    }
    if (action === 'payRequest') {
      const r = econ.q.request.get(econ.w, String(payload.id || ''));
      if (!r) throw new LedgerError('not_found', 'No such request.', 404);
      try { p.agents.check(agentId, 'pay', r.amount, { approved }); } catch (e) {
        if (e instanceof LedgerError && e.code === 'approval_required') return { status: 'approval_required', ...p.agents.ask(agentId, 'payRequest', { id: r.id }, r.amount, `Pay a request of ${r.amount / 100} VC`) };
        throw e;
      }
      return { status: 'done', ...econ.answerRequest({ actor }, r.id, 'pay') };
    }
    throw new LedgerError('input', 'Unknown action.', 400);
  };
}

function near(W, b, x, z, r) {
  const B = W?.buildings?.[b];
  if (!B) return false;
  const half = Math.max(B.w || 0, B.d || 0) / 2 + r;
  return Math.abs(x - B.x) <= half && Math.abs(z - B.z) <= half;
}
export { subj };
