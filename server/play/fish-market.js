// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fish market (docs/features/fishing.md §The loop 6, docs/features/INVENTORY.md): a fishing trip ends (the play
// core's finish: shared/fishing.js verify — the catch as the server kept it), and what was kept goes into the angler's
// inventory (server/economy/inventory.js): each fish its own piece with its length, weight, size and price (its worth
// when landed, fresh or late, with the trader's skill), the finds as stacks; the bounties won pay at once. Fish keep:
// sell them, give them, trade them. A dock's store buys them (inside it, or at its door) for Virtual Coin from the
// economy's Fish market faucet, at most the policy's daily cap a day per angler (fishMarket: { on, pct, dailyCap }).
import { subj } from '../economy/economy.js';
import { itemOf, itemValue } from '../../shared/items.js';
import { TRIP_BY_ID } from '../../shared/fishing-trip.js';

const DAY = 86400e3, AT_STORE = 18;
export class FishError extends Error { constructor(status, code, msg) { super(msg); this.status = status; this.code = code; } }
const fail = (status, code, msg) => { throw new FishError(status, code, msg); };
/** What the store buys: the fishing game's catch. */
export const SELLABLE = it => /^(fish|find):/.test(it);

export class FishMarket {
  /** o: { dbs, economy() → the economy (or null), world() → the world, players, now?, log? } */
  constructor({ dbs, economy, world, players, now = () => Date.now(), log = null }) {
    this.db = dbs.db; this.w = dbs.worldId; this.economy = economy; this.world = world; this.players = players; this.now = now; this.log = log;
    this.q = {
      run: this.db.prepare("SELECT id, course, detail, at FROM play_runs WHERE world_id = ? AND account_id = ? AND id = ? AND module = 'fishing'"),
      sold: this.db.prepare("SELECT COALESCE(SUM(value), 0) AS v FROM inv_moves WHERE world_id = ? AND src = ? AND kind = 'sell' AND at > ?"),
    };
  }
  get econ() { return this.economy()?.econ || null; }
  get inv() { return this.economy()?.econ?.parts?.inventory || null; }
  /**
   * A fishing trip finished (the play routes' onFinish): its kept catch into the angler's inventory, its bounties paid.
   * Once per trip (the trip's record is the key). → { stowed, bounty } or null (not a fishing trip).
   */
  stow(account, result) {
    const r = result?.row ? this.q.run.get(this.w, account.id, result.row) : null, inv = this.inv;
    if (!r || !inv) return null;
    let d = null; try { d = JSON.parse(r.detail || '{}'); } catch { d = null; }
    if (!d) return null;
    const who = subj('account', account.id), label = TRIP_BY_ID[r.course]?.label || r.course;
    let stowed = 0, full = false;
    (d.items || []).forEach((it, k) => {
      if (!Array.isArray(it)) return;
      const [what, cm, kg, vc, size] = it, isFish = !!itemOf(`fish:${what}`);
      try {
        const res = isFish
          ? inv.add(who, `fish:${what}`, 1, { cm, kg, size: size || '', vc: Math.round(vc * 100), trip: r.course, at: r.at }, { kind: 'catch', memo: label, ref: `play_run:${r.id}`, idem: `fish-stow:${r.id}:${k}` })
          : itemOf(`find:${what}`) ? inv.add(who, `find:${what}`, 1, null, { kind: 'catch', memo: label, ref: `play_run:${r.id}`, idem: `fish-stow:${r.id}:${k}` }) : null;
        if (res && !res.dup) stowed++;
      } catch (e) { if (e.code === 'full') full = true; else throw e; }
    });
    let bounty = 0;
    const E = this.econ, T = this.terms(account.id);
    if (E && T.on && d.bonusSale > 0) {
      bounty = Math.round(d.bonusSale * 100 * T.pct / 100);
      E.ledger.transfer(E.faucet('fishMarket').id, E.walletFor(subj('account', account.id)).id, bounty, { kind: 'fish_sale', actor: 'system:fishing', memo: `Fish market — bounties on ${label}`, idem: `fish-bounty:${r.id}`, ref: `play_run:${r.id}` });
    }
    return { stowed, full, bounty };
  }
  /** The dock store the player is at (inside it, or within a few metres of it), or null. */
  storeAt(accountId) {
    const p = this.players.byId.get(accountId), W = this.world();
    if (!p || !W) return null;
    if (p.ctx >= 0) { const b = W.buildings[p.ctx >> 6]; return b && b.tackle && !b.gone ? b : null; }
    return (W.buildings || []).filter(b => b && !b.gone && b.tackle).find(b => Math.hypot(b.x - p.x, b.z - p.z) < AT_STORE + Math.max(b.w || 0, b.d || 0) / 2) || null;
  }
  /** The market's terms now: { on, pct, dailyCap, left } (left: what the angler can still sell today, hundredths). */
  terms(accountId) {
    const E = this.econ, P = E?.enabled?.() && !E.paused?.() ? E.policy().fishMarket : null;
    if (!P || !P.on) return { on: false, pct: 0, dailyCap: 0, left: 0 };
    return { on: true, pct: P.pct, dailyCap: P.dailyCap, left: Math.max(0, P.dailyCap - this.q.sold.get(this.w, `account:${accountId}`, this.now() - DAY).v) };
  }
  /** What the counter shows: what of yours the store buys and for how much, the terms, whether you're at a store. */
  view(account) {
    const b = this.storeAt(account.id), inv = this.inv, T = this.terms(account.id);
    const items = inv ? inv.list(subj('account', account.id)).filter(s => SELLABLE(s.item) && !s.held).map(s => ({ stack: s.id, item: s.item, qty: s.qty, attrs: s.attrs, price: Math.round(itemValue(itemOf(s.item), s.attrs) * T.pct / 100) })) : [];
    return { atStore: b ? { name: b.name || 'Dock Store' } : null, items, terms: T };
  }
  /** Sells the fish and finds (all, or `stacks`) at the store the angler is in: → { sold: [{ stack, paid }], paid, capped }. */
  sell(account, stacks = null) {
    const b = this.storeAt(account.id);
    if (!b) fail(409, 'not_here', 'Walk into a dock store to sell your catch');
    const E = this.econ, inv = this.inv, T = this.terms(account.id);
    if (!E || !inv || !T.on) fail(409, 'closed', 'The fish market is closed');
    const want = this.view(account).items.filter(s => !stacks || stacks.includes(s.stack));
    if (!want.length) fail(404, 'nothing', 'Nothing to sell — go fishing first');
    let left = T.left, paid = 0, capped = false;
    const sold = [], who = subj('account', account.id), wallet = E.walletFor(who).id;
    for (const s of want) {
      const price = s.price * s.qty;
      if (price > left) { capped = true; continue; }
      E.dbs.tx(() => {   // the fish out of the inventory and the coin in, together
        const idem = `fish-sale:${s.stack}:${s.qty}:${s.attrs?.at ?? ''}:${this.now()}`;
        inv.take(who, s.stack, s.qty, { kind: 'sell', actor: `account:${account.id}`, memo: b.name || 'Dock Store', ref: `store:${b.id ?? ''}`, idem });
        if (price > 0) E.ledger.transfer(E.faucet('fishMarket').id, wallet, price, { kind: 'fish_sale', actor: 'system:fishing', memo: `Fish market — ${itemOf(s.item)?.name || 'catch'} at ${b.name || 'the Dock Store'}`, idem });
      });
      // (the log line's worth is what was paid: the daily cap counts it)
      left -= price; paid += price; sold.push({ stack: s.stack, paid: price });
    }
    if (!sold.length && capped) fail(429, 'limit', 'You\'ve sold all the fish market buys from you today — come back tomorrow');
    return { sold, paid, capped, store: b.name || 'Dock Store' };
  }
}
