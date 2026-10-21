// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's money as its Mind sees and uses it (docs/features/FREE-WILL.md §11.11). The Mind (server/mind/) never touches
// the ledger itself: it reads through here and every payment, purchase or lease goes through runAgentAction - the same
// path as a connected agent's API calls - so the owner's spending rules (scopes, the daily limit, "ask me above", pause)
// decide, and above the threshold an approval waits for the owner, exactly as before.
// Also what goes wrong with an agent's money, for the problems watcher (server/mind/problems.js): rent it owes, and a
// flat it rents for VC whose rent is overdue (its days of grace counting down) or that is ending.
import { LedgerError } from './ledger.js';
import { subj, subjKey } from './economy.js';

/**
 * @param {import('./economy.js').Economy} econ
 * @param {(action, payload, agentId, approved) => object} runAgentAction  ./index.js
 */
export function createMindMoney(econ, runAgentAction) {
  const p = econ.parts, db = econ.db, w = econ.w;
  const q = {
    owed: db.prepare(`SELECT wl.owner_id AS agent, COALESCE(SUM(d.amount), 0) AS owed FROM econ_debts d JOIN econ_wallets wl ON wl.id = d.debtor
      WHERE d.world_id = ? AND d.status = 'open' AND d.kind = 'rent' AND wl.owner_kind = 'agent' GROUP BY wl.owner_id`),
    owedOne: db.prepare("SELECT COALESCE(SUM(amount), 0) AS owed FROM econ_debts WHERE world_id = ? AND debtor = ? AND status = 'open' AND kind = 'rent'"),
    leases: db.prepare("SELECT * FROM econ_leases WHERE world_id = ? AND tenant_kind = 'agent' AND status IN ('due', 'ending')"),
    leaseOf: db.prepare("SELECT * FROM econ_leases WHERE world_id = ? AND tenant_kind = 'agent' AND tenant_id = ? AND status IN ('active', 'due', 'ending') ORDER BY created DESC LIMIT 1"),
    askOpen: db.prepare("SELECT COUNT(*) AS n FROM econ_requests WHERE world_id = ? AND payee = ? AND payer = ? AND status = 'open'"),
    flats: db.prepare("SELECT * FROM econ_listings WHERE world_id = ? AND kind = 'flat_rent' AND status = 'active' ORDER BY price LIMIT 200"),
  };
  const leaseLine = L => {
    if (!L) return null;
    const grace = econ.policy().leases?.graceDays ?? 3, since = L.due_since;
    return { title: L.title, perDay: L.rent, status: L.status, graceLeft: L.status === 'due' && since !== null ? Math.max(0, grace - (econ.econDay() - since)) : null };
  };
  const on = () => econ.enabled();

  return {
    on,
    /** For the problems watcher: agent id → { owed, lease } for every agent whose rent is behind (one pass of two queries). */
    troubles() {
      const out = new Map();
      if (!on()) return out;
      for (const r of q.owed.all(w)) if (r.owed > 0) out.set(Number(r.agent), { owed: r.owed, lease: null });
      for (const L of q.leases.all(w)) { const id = Number(L.tenant_id), x = out.get(id) || { owed: 0, lease: null }; x.lease = leaseLine(L); out.set(id, x); }
      return out;
    },
    /** What the agent has and may do: its wallet, rent, what it owes, its lease, its owner's rules, approvals waiting. */
    wallet(agentId, person = null) {
      const wl = econ.walletFor(subj('agent', agentId)), L = p.agents.limitsOf(agentId), h = p.households;
      const available = person && h ? h.available(person) : wl.balance - wl.held;
      return {
        balance: wl.balance, available, rentPerDay: person && h ? h.rentOf(person) : 0,
        owed: q.owedOne.get(w, wl.id).owed, lease: leaseLine(q.leaseOf.get(w, String(agentId))),
        rules: { scopes: L.scopes, dailyCap: L.dailyCap, approveAbove: L.approveAbove, paused: L.paused, spent24h: L.spent24h, leftToday: Math.max(0, L.dailyCap - L.spent24h) },
        waiting: p.agents.ofAgent(agentId).filter(a => a.status === 'pending').length,
        askOpen: this.askOpen(agentId),
        // what it holds (server/economy/inventory.js; its welcome kit the first time): the most valuable first
        holds: p.inventory ? (p.inventory.welcome(subj('agent', agentId)), p.inventory.summary(subj('agent', agentId), 8)) : null,
      };
    },
    /** Whether its question to its owner for money is still waiting (one at a time). */
    askOpen(agentId) {
      const owner = econ.agentOwner(agentId);
      return owner != null && q.askOpen.get(w, subjKey(subj('agent', agentId)), subjKey(subj('account', owner))).n > 0;
    },
    /** Flats offered for rent in VC that the agent could take (cheapest first; not one it lets itself). */
    flats(agentId) {
      const out = [];
      if (!p.realty) return out;
      for (const l of q.flats.all(w)) {
        if (l.seller_kind === 'agent' && l.seller_id === String(agentId)) continue;
        let h = null;
        try { h = p.realty.holderOf('flat_rent', l.target); } catch { h = null; }   // (a flat changed since it was listed)
        if (!h || !h.flat) continue;
        out.push({ id: l.id, title: h.title, b: h.flat.b, perMonth: l.price, perDay: Math.max(1, Math.floor(l.price / 30)), landlord: econ.nameOf(l.seller_kind === 'municipality' ? subj('city', 'city') : subj(l.seller_kind, l.seller_id)) });
      }
      return out;
    },
    /** What a place sells and at what price (a café, a restaurant, a shop, a gym), or null. */
    menu(b, f) {
      const biz = p.businesses.at(b, f);
      if (!biz || biz.status !== 'open' || biz.f === -1) return null;
      return { business: { id: biz.id, name: biz.name, kind: biz.kind }, items: p.businesses.menu(biz).filter(it => Number.isSafeInteger(it.price) && it.price > 0).map(it => ({ id: it.id, label: it.label, price: it.price })) };
    },
    business(id) { const b = p.businesses.get(String(id)); return b && b.status === 'open' ? { id: b.id, name: b.name, kind: b.kind, b: b.b, f: b.f } : null; },
    /** The world's answers to a Mind's money actions: { status: 'done' | 'approval_required', … } or a LedgerError. */
    rentFlat(agentId, listingId, idem) { return runAgentAction('realty', { id: listingId, idem }, agentId, false); },
    buy(agentId, businessId, items, idem) { return runAgentAction('buy', { business: businessId, items, idem }, agentId, false); },
    pay(agentId, to, amount, memo, idem) { return runAgentAction('pay', { to, amount, memo, idem }, agentId, false); },
    /** Gives something from its inventory (a stack ref or a thing's name), worth as much as a payment of its value. */
    give(agentId, to, item, qty, memo, idem) { return runAgentAction('give', { item, qty, to, memo, idem }, agentId, false); },
    /** Asks its owner for money (a payment request the owner answers in their wallet) - allowed when it may pay at all. */
    askOwner(agentId, amount, memo) {
      const owner = econ.agentOwner(agentId);
      if (owner == null) throw new LedgerError('rights', 'This agent has no owner to ask.', 403);
      if (this.askOpen(agentId)) throw new LedgerError('limit', 'Your owner hasn\'t answered your last request yet.', 429);
      p.agents.check(agentId, 'pay', 0, { approved: true });
      return econ.request({ actor: { kind: 'agent', id: agentId } }, { from: { kind: 'account', id: owner }, amount, memo });
    },
    ownerOf: agentId => econ.agentOwner(agentId),
  };
}
