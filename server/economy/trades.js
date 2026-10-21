// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Trading (docs/features/INVENTORY.md §Trading): two sides - players, agents, a player for their own agent - each put
// in things from their inventory and/or Virtual Coin; either may change their side (which takes back both sides'
// acceptance: nobody accepts what they didn't see), and when both have accepted the trade settles in one transaction -
// every thing and the coin both ways, or nothing (a thing gone since, coin spent, a frozen wallet: it stays open and
// says why). The same rules as giving and paying: a new account's daily cap (by what it gives: things and coin), an
// agent within its owner's limits (above its line its owner approves its acceptance first). An open trade lapses after
// two days; each side has at most 10 open.
import crypto from 'node:crypto';
import { LedgerError } from './ledger.js';
import { subj } from './economy.js';
import { ownerKey } from './inventory.js';
import { itemOf, itemValue, pieceLabel } from '../../shared/items.js';

const DAY = 86400e3, LAPSE = 2 * DAY, MAX_OPEN = 10, MAX_LINES = 20;
const bad = (msg, code = 'input', status = 400, detail) => new LedgerError(code, msg, status, detail);
const parse = k => { const i = String(k).indexOf(':'); return { kind: k.slice(0, i), id: k.slice(i + 1) }; };
const emptyOffer = () => ({ items: [], vc: 0 });

export class Trades {
  constructor(econ, inv) {
    this.e = econ; this.inv = inv; this.db = econ.db; this.w = econ.w;
    const db = this.db;
    this.q = {
      add: db.prepare('INSERT INTO inv_trades (world_id, id, a, b, a_offer, b_offer, a_ok, b_ok, status, memo, created, updated, expires) VALUES ($w, $id, $a, $b, $ao, $bo, 0, 0, \'open\', $memo, $t, $t, $exp)'),
      get: db.prepare('SELECT * FROM inv_trades WHERE world_id = ? AND id = ?'),
      mine: db.prepare("SELECT * FROM inv_trades WHERE world_id = ? AND (a = ? OR b = ?) AND (status = 'open' OR updated > ?) ORDER BY status = 'open' DESC, updated DESC LIMIT 30"),
      openOf: db.prepare("SELECT COUNT(*) AS n FROM inv_trades WHERE world_id = ? AND (a = ? OR b = ?) AND status = 'open'"),
      pair: db.prepare("SELECT * FROM inv_trades WHERE world_id = ? AND status = 'open' AND ((a = ? AND b = ?) OR (a = ? AND b = ?))"),
      offer: db.prepare('UPDATE inv_trades SET a_offer = $ao, b_offer = $bo, a_ok = 0, b_ok = 0, updated = $t, expires = $exp WHERE world_id = $w AND id = $id'),
      ok: db.prepare('UPDATE inv_trades SET a_ok = $ao, b_ok = $bo, updated = $t WHERE world_id = $w AND id = $id'),
      status: db.prepare('UPDATE inv_trades SET status = $s, updated = $t WHERE world_id = $w AND id = $id'),
      lapse: db.prepare("UPDATE inv_trades SET status = 'lapsed', updated = $t WHERE world_id = $w AND status = 'open' AND expires < $t"),
    };
  }
  // ---------------------------------------------------------------- who acts for a side
  /**
   * The side an actor trades as: themselves (a player), or one of their agents (as: its id - a player for their own
   * agent), or an agent itself (actor.kind 'agent', its API). → the subject.
   */
  sideOf(actor, as = null) {
    if (actor.kind === 'agent') return subj('agent', actor.id);
    if (as != null) {
      if (this.e.agentOwner(as) !== Number(actor.id) && !actor.admin) throw bad('That agent isn\'t yours.', 'rights', 403);
      return subj('agent', as);
    }
    return subj('account', actor.id);
  }
  // ---------------------------------------------------------------- reading
  /** An owner's trades: the open ones and those that ended in the last two days, each side spelt out. */
  list(owner) {
    this.q.lapse.run({ w: this.w, t: this.e.now() });
    const k = ownerKey(owner);
    return this.q.mine.all(this.w, k, k, this.e.now() - LAPSE).map(t => this.view(t, k));
  }
  view(t, me) {
    const side = (key, offer) => ({ who: { ...parse(key), name: this.e.nameOf(parse(key)) }, vc: offer.vc || 0, items: offer.items.map(l => this.line(key, l)) });
    const ao = JSON.parse(t.a_offer), bo = JSON.parse(t.b_offer), mineA = me === t.a;
    const A = side(t.a, ao), B = side(t.b, bo);
    return { id: t.id, status: t.status, memo: t.memo || '', created: t.created, updated: t.updated, expires: t.expires,
      me: mineA ? A : B, them: mineA ? B : A, myOk: !!(mineA ? t.a_ok : t.b_ok), theirOk: !!(mineA ? t.b_ok : t.a_ok), started: mineA };
  }
  /** One line of an offer as it stands now (gone: no longer there). */
  line(owner, l) {
    const r = this.inv.q.get.get(this.w, Number(l.stack));
    if (!r || r.owner !== owner) return { stack: l.stack, qty: l.qty, item: l.item, name: itemOf(l.item)?.name || l.item, gone: true };
    const def = itemOf(r.item), attrs = r.attrs ? JSON.parse(r.attrs) : null;
    return { stack: r.id, qty: l.qty, item: r.item, name: pieceLabel(def, attrs), icon: def?.icon, worth: itemValue(def, attrs) * l.qty, short: l.qty > r.qty };
  }
  // ---------------------------------------------------------------- changing
  /** Opens a trade with someone ({ kind, id } or a name), or returns the open one between the two. */
  open(actor, { to, as = null, memo = '' } = {}) {
    const me = this.sideOf(actor, as), them = typeof to === 'string' ? this.inv.recipientByName(to) : this.inv.recipient(to);
    if (ownerKey(me) === ownerKey(them)) throw bad('That\'s you.');
    const k1 = ownerKey(me), k2 = ownerKey(them), was = this.q.pair.get(this.w, k1, k2, k2, k1);
    if (was) return this.view(was, k1);
    for (const k of [k1, k2]) if (this.q.openOf.get(this.w, k, k).n >= MAX_OPEN) throw bad(k === k1 ? 'You have 10 trades open already - finish or decline some first.' : 'They have too many trades open right now.', 'limit', 429);
    const id = `trd_${crypto.randomBytes(8).toString('hex')}`, t = this.e.now();
    this.q.add.run({ w: this.w, id, a: k1, b: k2, ao: JSON.stringify(emptyOffer()), bo: JSON.stringify(emptyOffer()), memo: String(memo || '').slice(0, 140), t, exp: t + LAPSE });
    this.tell(them, me, id, 'opened');
    return this.view(this.q.get.get(this.w, id), k1);
  }
  /** Sets the actor's side: items [{ stack, qty }] (from its inventory) and vc (hundredths). Both acceptances reset. */
  offer(actor, { trade, items = [], vc = 0, as = null } = {}) {
    const t = this.openTrade(trade), me = this.sideOf(actor, as), k = ownerKey(me), mineA = k === t.a;
    if (!mineA && k !== t.b) throw bad('That isn\'t your trade.', 'rights', 403);
    if (!Array.isArray(items) || items.length > MAX_LINES) throw bad(`At most ${MAX_LINES} kinds of thing in an offer.`);
    const lines = [], seen = new Set();
    for (const l of items) {
      const stack = Number(l?.stack), qty = Math.floor(Number(l?.qty ?? 1));
      if (seen.has(stack)) continue; seen.add(stack);
      const r = this.inv.q.get.get(this.w, stack);
      if (!r || r.owner !== k) throw bad('That isn\'t in your inventory.', 'not_found', 404);
      const def = itemOf(r.item);
      if (def?.trade === false) throw bad(`${def.name} can't be traded.`, 'rights', 403);
      if (!(qty >= 1 && qty <= r.qty - r.held)) throw bad(`You have ${r.qty - r.held} of ${def?.name || 'that'} to offer.`, 'funds', 409);
      lines.push({ stack, qty, item: r.item });
    }
    const coin = Math.max(0, Math.floor(Number(vc) || 0));
    if (coin > 0) { const w = this.e.walletView(this.e.walletFor(me)); if (w.available != null && coin > w.available) throw bad(`You have ${(w.available / 100).toFixed(2)} VC to offer.`, 'funds', 409); }
    const ao = mineA ? { items: lines, vc: coin } : JSON.parse(t.a_offer), bo = mineA ? JSON.parse(t.b_offer) : { items: lines, vc: coin }, now = this.e.now();
    this.q.offer.run({ w: this.w, id: t.id, ao: JSON.stringify(ao), bo: JSON.stringify(bo), t: now, exp: now + LAPSE });
    this.tell(parse(mineA ? t.b : t.a), me, t.id, 'changed');
    return this.view(this.q.get.get(this.w, t.id), k);
  }
  /**
   * The actor accepts the trade as it stands; when the other side has too, it settles. approved: an agent's owner has
   * approved (its acceptance above its line). → the trade's view (status 'done' once settled).
   */
  accept(actor, { trade, as = null } = {}, approved = false) {
    const t = this.openTrade(trade), me = this.sideOf(actor, as), k = ownerKey(me), mineA = k === t.a;
    if (!mineA && k !== t.b) throw bad('That isn\'t your trade.', 'rights', 403);
    const mine = JSON.parse(mineA ? t.a_offer : t.b_offer), theirs = JSON.parse(mineA ? t.b_offer : t.a_offer);
    if (!mine.items.length && !mine.vc && !theirs.items.length && !theirs.vc) throw bad('Nothing is on the table yet.');
    // an agent's side: what it gives away, as a payment of the same worth (its owner's rules)
    if (me.kind === 'agent' && actor.kind === 'agent') this.e.parts.agents.check(me.id, 'pay', this.worth(k, mine), { approved });
    const ao = mineA ? 1 : t.a_ok, bo = mineA ? t.b_ok : 1;
    this.q.ok.run({ w: this.w, id: t.id, ao, bo, t: this.e.now() });
    if (ao && bo) this.settle(this.q.get.get(this.w, t.id));
    else this.tell(parse(mineA ? t.b : t.a), me, t.id, 'accepted');
    return this.view(this.q.get.get(this.w, t.id), k);
  }
  /** Either side calls it off. */
  decline(actor, { trade, as = null } = {}) {
    const t = this.openTrade(trade), me = this.sideOf(actor, as), k = ownerKey(me);
    if (k !== t.a && k !== t.b) throw bad('That isn\'t your trade.', 'rights', 403);
    this.q.status.run({ w: this.w, id: t.id, s: 'declined', t: this.e.now() });
    this.tell(parse(k === t.a ? t.b : t.a), me, t.id, 'declined');
    return this.view(this.q.get.get(this.w, t.id), k);
  }
  // ---------------------------------------------------------------- settling
  worth(owner, offer) { return offer.vc + offer.items.reduce((a, l) => { const r = this.inv.q.get.get(this.w, Number(l.stack)); return a + (r ? itemValue(itemOf(r.item), r.attrs ? JSON.parse(r.attrs) : null) * l.qty : 0); }, 0); }
  /** Both sides accepted: everything both ways in one transaction, or nothing (the trade stays open, acceptances taken back). */
  settle(t) {
    const A = parse(t.a), B = parse(t.b), ao = JSON.parse(t.a_offer), bo = JSON.parse(t.b_offer);
    try {
      this.e.dbs.tx(() => {
        for (const [S, o] of [[A, ao], [B, bo]]) if (S.kind === 'account') this.inv.newAccountCap(S.id, this.worth(ownerKey(S), o));
        const E = this.e;
        for (const [S, D, o, side] of [[A, B, ao, 'a'], [B, A, bo, 'b']]) {
          o.items.forEach((l, n) => this.inv.move(S, D, Number(l.stack), l.qty, { kind: 'trade', actor: ownerKey(S), memo: 'A trade', ref: t.id, idem: `trade:${t.id}:${side}:${n}` }));
          if (o.vc > 0) {
            const from = E.walletFor(S), to = E.walletFor(D);
            if (from.status === 'frozen' || to.status === 'frozen') throw bad('A wallet in this trade is frozen.', 'frozen', 409);
            E.ledger.transfer(from.id, to.id, o.vc, { kind: 'trade', actor: ownerKey(S), memo: `A trade with ${E.nameOf(D)}`, idem: `trade:${t.id}:${side}:vc`, ref: `trade:${t.id}` });
          }
        }
        this.q.status.run({ w: this.w, id: t.id, s: 'done', t: this.e.now() });
      });
    } catch (e) {
      // something moved or ran out since: nobody's acceptance stands; both are told why
      this.q.ok.run({ w: this.w, id: t.id, ao: 0, bo: 0, t: this.e.now() });
      if (e instanceof LedgerError) throw bad(`The trade couldn't go through: ${e.message}`, e.code, e.status || 409);
      throw e;
    }
    this.tell(A, B, t.id, 'done'); this.tell(B, A, t.id, 'done');
  }
  openTrade(id) {
    this.q.lapse.run({ w: this.w, t: this.e.now() });
    const t = this.q.get.get(this.w, String(id || ''));
    if (!t) throw bad('No such trade.', 'not_found', 404);
    if (t.status !== 'open') throw bad(`That trade is ${t.status === 'done' ? 'done' : t.status}.`, 'conflict', 409);
    return t;
  }
  /** The other side hears of it (a player at once; an agent's owner too). */
  tell(to, from, id, ev) {
    const msg = { t: 'inv', ev: 'trade', what: ev, trade: id, from: this.e.nameOf(from) };
    if (to.kind === 'account') this.e.d.notify?.(Number(to.id), msg);
    else if (to.kind === 'agent') { const o = this.e.agentOwner(to.id); if (o != null) this.e.d.notify?.(o, { ...msg, agent: this.e.nameOf(to) }); }
  }
}
