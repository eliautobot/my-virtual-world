// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Property for Virtual Coin (docs/features/ECONOMY.md §7, §12): lots and flats for sale, and flats and venues for rent,
// all for VC (no real money exists here). Renting a VENUE (a café's, restaurant's, shop's or gym's floor)
// makes the tenant its business's operator for as long as the lease runs: they set its prices, keep its takings and pay
// its staff; the landlord keeps the building and collects the rent. When the lease ends the business goes back to the
// landlord, and its till to the tenant. A holder lists at a price; a buyer pays it and the title (a lot) or the flat's
// record passes in the same database transaction; the world fee (policy fees.worldFeeBp, 10%) is destroyed. A tenant
// rents a flat by the month, paid by the day at the settlement (the first day at once); short of money they have the
// policy's days of grace, then the lease ends and they move out (soft: what they owe stays a debt, never property).
// Flats sold or let for VC can't be destroyed by later edits (the guard below), as the shop's can't.
import crypto from 'node:crypto';
import { LedgerError, vc } from './ledger.js';
import { subj } from './economy.js';
import { flatRef, findFlat, parseFlatRef } from '../../shared/flat-ref.js';
import { PropertyError, MUNICIPALITY } from '../property.js';

const rid = p => `${p}_${crypto.randomBytes(9).toString('base64url')}`;
const same = (a, b) => !!a && !!b && a.kind === b.kind && String(a.id) === String(b.id);
/** A venue floor's reference for listings and leases: "venue:<building id>:<floor>" (stable while the building stands). */
export const venueRef = (B, f) => `venue:${B.id}:${f}`;
export function parseVenueRef(ref) { const m = /^venue:([A-Za-z0-9_.-]{1,60}):(\d{1,3})$/.exec(String(ref || '')); return m ? { id: m[1], f: Number(m[2]) } : null; }
const isRent = kind => kind === 'flat_rent' || kind === 'venue_rent';

export class Realty {
  /**
   * @param {import('./economy.js').Economy} econ
   * @param {object} d { property, editor: () => editor, agentBody: agentId → resident index, lotsChanged: ids → void }
   */
  constructor(econ, d = {}) {
    this.e = econ; this.d = d; this.db = econ.db; this.w = econ.w;
    this.version = 1;
    const db = this.db;
    this.q = {
      add: db.prepare(`INSERT INTO econ_listings (id, world_id, kind, target, seller_kind, seller_id, price, note, status, created, updated)
        VALUES ($id, $w, $kind, $target, $sk, $sid, $price, $note, 'active', $at, $at)`),
      get: db.prepare('SELECT * FROM econ_listings WHERE world_id = ? AND id = ?'),
      open: db.prepare("SELECT * FROM econ_listings WHERE world_id = ? AND kind = ? AND target = ? AND status = 'active'"),
      openOn: db.prepare("SELECT * FROM econ_listings WHERE world_id = ? AND target = ? AND status = 'active'"),
      all: db.prepare("SELECT * FROM econ_listings WHERE world_id = ? AND status = 'active' ORDER BY created"),
      reprice: db.prepare("UPDATE econ_listings SET price = $price, note = $note, updated = $at WHERE world_id = $w AND id = $id AND status = 'active'"),
      close: db.prepare("UPDATE econ_listings SET status = $status, buyer = $buyer, tx = $tx, updated = $at WHERE world_id = $w AND id = $id AND status = 'active'"),
      addLease: db.prepare(`INSERT INTO econ_leases (id, world_id, target, title, landlord_kind, landlord_id, tenant_kind, tenant_id, rent, status, started_day, paid_through, created)
        VALUES ($id, $w, $target, $title, $lk, $lid, $tk, $tid, $rent, 'active', $day, $day, $at)`),
      lease: db.prepare('SELECT * FROM econ_leases WHERE world_id = ? AND id = ?'),
      liveOn: db.prepare("SELECT * FROM econ_leases WHERE world_id = ? AND target = ? AND status IN ('active', 'due')"),
      live: db.prepare("SELECT * FROM econ_leases WHERE world_id = ? AND status IN ('active', 'due')"),
      ofTenant: db.prepare('SELECT * FROM econ_leases WHERE world_id = ? AND tenant_kind = ? AND tenant_id = ? ORDER BY created DESC LIMIT 30'),
      ofLandlord: db.prepare('SELECT * FROM econ_leases WHERE world_id = ? AND landlord_kind = ? AND landlord_id = ? ORDER BY created DESC LIMIT 30'),
      setLease: db.prepare('UPDATE econ_leases SET status = $status, paid_through = $paid, due_since = $due, ended = $ended, end_reason = $why WHERE world_id = $w AND id = $id'),
      ending: db.prepare("SELECT * FROM econ_leases WHERE world_id = ? AND status = 'ending'"),
    };
  }
  kinds() { return ['lot', 'flat_sale', 'flat_rent', 'venue_rent']; }
  /** The venue floor a reference names: { B, f, biz } (its business open), or null. */
  findVenue(ref) {
    const r = parseVenueRef(ref), W = this.e.d.world();
    if (!r || !W) return null;
    const B = (W.buildings || []).find(x => x && !x.gone && x.id === r.id);
    const biz = B ? this.e.parts.businesses?.at(B.idx, r.f) : null;
    return B && biz && biz.f >= 0 ? { B, f: r.f, biz } : null;
  }
  /** Who runs the venue on floor f of building B under a live lease (its tenant), or null. */
  venueTenant(B, f) {
    if (!B?.id) return null;
    const L = this.q.liveOn.get(this.w, venueRef(B, f));
    return L ? { kind: L.tenant_kind, id: String(L.tenant_id) } : null;
  }

  // ------------------------------------------------------------------------------------------- what is whose
  /** The holder of a lot or a flat (who may list it), and a title for people. */
  holderOf(kind, target) {
    const W = this.e.d.world();
    if (kind === 'lot') {
      const lot = this.d.property?.get(target);
      if (!lot || lot.lifecycle === 'retired') throw new LedgerError('not_found', 'No such lot.', 404);
      return { holder: lot.holder, lot, title: lot.name ? `${lot.name} (lot ${lot.id})` : `Lot ${lot.id}` };
    }
    if (kind === 'venue_rent') {
      const V = this.findVenue(target);
      if (!V) throw new LedgerError('not_found', 'No such business floor (it may have been changed).', 404);
      // the venue's landlord: the holder of the building's lot (whoever runs it under a lease is its tenant)
      const lot = V.B.lot ? this.d.property?.get(V.B.lot) : null;
      return { holder: lot?.holder || MUNICIPALITY, venue: V, title: `${V.biz.name} (${V.biz.kind}) in ${V.B.name}` };
    }
    const F = findFlat(W, target);
    if (!F) throw new LedgerError('not_found', 'No such flat (it may have been changed).', 404);
    const rec = W.flats?.[`${F.b}:${F.f}:${F.u}`] || null;
    let holder;
    if (rec?.deal === 'sold' && rec.owner?.kind === 'account') holder = subj('account', rec.owner.id);
    else { const lot = F.B.lot ? this.d.property?.get(F.B.lot) : null; holder = lot?.holder || MUNICIPALITY; }
    return { holder, flat: F, rec, title: `Flat ${F.u + 1} on ${F.f === 0 ? 'the street floor' : `floor ${F.f + 1}`} of ${F.B.name}` };
  }
  mine(actor, holder) {
    if (holder?.kind === 'municipality') return !!actor.admin;
    return actor.kind === 'account' ? same(holder, subj('account', actor.id)) : actor.kind === 'agent' && same(holder, subj('agent', actor.id));
  }
  walletOfHolder(h) { return h.kind === 'municipality' ? this.e.treasury() : this.e.walletFor(subj(h.kind, h.id)); }

  // ------------------------------------------------------------------------------------------- listing
  list(actor, { kind, target, price, note = '' }) {
    this.e.live();
    this.e.brake(this.e.actorRef(actor));
    if (!this.kinds().includes(kind)) throw new LedgerError('input', 'List a lot, or a flat for sale or for rent.', 400);
    if (!Number.isSafeInteger(price) || price < 100 || price > 1e12) throw new LedgerError('input', 'The price is a whole number of hundredths of a VC, at least 1 VC.', 400);
    target = String(target || '');
    if (kind === 'venue_rent' ? !parseVenueRef(target) : kind !== 'lot' && !parseFlatRef(target)) throw new LedgerError('input', kind === 'venue_rent' ? 'Which business?' : 'Which flat?', 400);
    const at = this.e.now();
    const out = this.e.dbs.tx(() => {
      const h = this.holderOf(kind, target);
      if (!this.mine(actor, h.holder)) throw new LedgerError('rights', kind === 'lot' ? 'Only the lot\'s holder can sell it.' : kind === 'venue_rent' ? 'Only the building\'s holder can let its businesses.' : 'Only the flat\'s holder can sell or let it.', 403);
      if (kind === 'venue_rent') {
        if (this.q.liveOn.get(this.w, target)) throw new LedgerError('state', 'This business is let; list it when the lease ends.', 409);
      } else if (kind === 'lot') {
        const city = h.holder.kind === 'municipality';
        if (city ? !['municipal', 'available', 'unreleased'].includes(h.lot.lifecycle) : h.lot.lifecycle !== 'owned') throw new LedgerError('state', `This lot is ${h.lot.lifecycle} and can't be listed.`, 409);
        if (city && h.lot.lifecycle !== 'available') this.d.property.offer(h.lot.id, true, { actor: { admin: true, account: actor.kind === 'account' ? { id: actor.id } : null } });
      } else {
        if (this.q.liveOn.get(this.w, target)) throw new LedgerError('state', 'This flat is let; list it when the lease ends.', 409);
        if ((h.rec?.tenants || []).some(t => t.kind === 'account')) throw new LedgerError('state', 'A player lives here; end their stay first.', 409);
        const other = this.q.open.get(this.w, kind === 'flat_sale' ? 'flat_rent' : 'flat_sale', target);
        if (other) this.q.close.run({ status: 'withdrawn', buyer: null, tx: null, at, w: this.w, id: other.id });
      }
      const was = this.q.open.get(this.w, kind, target);
      if (was) { this.q.reprice.run({ price, note: String(note || '').slice(0, 200) || null, at, w: this.w, id: was.id }); return was.id; }
      const id = rid('vlst'), s = h.holder.kind === 'municipality' ? { kind: 'municipality', id: 'city' } : h.holder;
      this.q.add.run({ id, w: this.w, kind, target, sk: s.kind, sid: String(s.id), price, note: String(note || '').slice(0, 200) || null, at });
      return id;
    });
    this.changed(kind === 'lot' ? [target] : []);
    return this.view(this.q.get.get(this.w, out));
  }
  unlist(actor, id) {
    const l = this.q.get.get(this.w, String(id || ''));
    if (!l || l.status !== 'active') throw new LedgerError('not_found', 'That listing has ended.', 404);
    if (!this.mine(actor, { kind: l.seller_kind, id: l.seller_id })) throw new LedgerError('rights', 'Only the seller can take it off.', 403);
    this.e.dbs.tx(() => {
      this.q.close.run({ status: 'withdrawn', buyer: null, tx: null, at: this.e.now(), w: this.w, id: l.id });
      if (l.kind === 'lot' && l.seller_kind === 'municipality') { const lot = this.d.property.get(l.target); if (lot?.lifecycle === 'available') this.d.property.offer(lot.id, false, { actor: { admin: true } }); }
    });
    this.changed(l.kind === 'lot' ? [l.target] : []);
    return this.view(this.q.get.get(this.w, l.id));
  }

  // ------------------------------------------------------------------------------------------- buying and renting
  /**
   * Buys a lot or a flat at its listed price, or rents a flat. One database transaction: the payment (the world fee
   * destroyed), the title or the flat's record, the listing; the flat's record (the world) is written last.
   */
  take(actor, id, { idem = null } = {}) {
    this.e.live();
    this.e.brake(this.e.actorRef(actor), 2);
    const l = this.q.get.get(this.w, String(id || ''));
    if (!l || l.status !== 'active') throw new LedgerError('not_found', 'That isn\'t on offer any more.', 404);
    // what is sold for VC is checked again when buying: a listing of a kind no longer sold is withdrawn, never sold
    if (!this.kinds().includes(l.kind)) {
      this.q.close.run({ status: 'withdrawn', buyer: null, tx: null, at: this.e.now(), w: this.w, id: l.id });
      this.changed([]);
      throw new LedgerError('state', 'Here, land and flats are bought with money in the shop; that listing has ended.', 409);
    }
    const me = subj(actor.kind, actor.id), seller = l.seller_kind === 'municipality' ? MUNICIPALITY : subj(l.seller_kind, l.seller_id);
    if (same(me, seller)) throw new LedgerError('input', 'This is yours already.', 400);
    const pol = this.e.policy(), buyerW = this.e.walletFor(me), sellerW = this.walletOfHolder(seller);
    if (l.kind === 'flat_rent') return this._rent(actor, l, me, seller, buyerW, sellerW);
    if (l.kind === 'venue_rent') return this._rentVenue(actor, l, me, seller, buyerW, sellerW);
    const fee = Math.floor(l.price * pol.fees.worldFeeBp / 10000), at = this.e.now();
    let ledgerTx = null;
    const r = this.e.dbs.tx(() => {
      const h = this.holderOf(l.kind, l.target);
      if (!same(h.holder, seller)) { this.q.close.run({ status: 'withdrawn', buyer: null, tx: null, at, w: this.w, id: l.id }); throw new LedgerError('state', 'It changed hands; that listing has ended.', 409); }
      const postings = [{ wallet: buyerW.id, amount: -l.price }, { wallet: sellerW.id, amount: l.price - fee }];
      if (fee) postings.push({ wallet: this.e.sink('fees').id, amount: fee });
      const t = this.e.ledger.post({ kind: 'property', actor: this.e.actorRef(actor), memo: `Bought ${h.title}`, ref: l.id, idem: idem ? `realty:${this.e.actorRef(actor)}:${String(idem).slice(0, 80)}` : `realty:${l.id}`, day: this.e.econDay(), postings });
      ledgerTx = t;
      if (l.kind === 'lot') {
        try {
          const was = this.d.property.reserve(l.target, { seller, buyer: me, ref: l.id });
          this.d.property.sell(l.target, { seller, buyer: me, order: t.id, reason: 'Bought for Virtual Coin' });
          void was;
        } catch (e) { if (e instanceof PropertyError) throw new LedgerError('state', e.message, 409); throw e; }
      }
      this.q.close.run({ status: 'closed', buyer: `${me.kind}:${me.id}`, tx: t.seq, at, w: this.w, id: l.id });
      if (l.kind === 'flat_sale') {
        const F = h.flat, res = this.d.editor().apply([{ op: 'flat.lease', b: F.b, f: F.f, u: F.u, deal: 'sold', owner: me.kind === 'account' ? { kind: 'account', id: me.id } : { kind: 'person', id: this.d.agentBody?.(me.id) } }], { system: 'economy', name: 'Economy' }, { journal: false });
        if (!res.ok) throw new LedgerError('state', res.error || 'The flat couldn\'t change hands.', 409);
      }
      return { title: h.title };
    });
    this.changed(l.kind === 'lot' ? [l.target] : []);
    if (l.kind === 'lot') this.e.parts.businesses?.sync();   // its businesses follow their new owner
    const acc = seller.kind === 'account' ? Number(seller.id) : seller.kind === 'agent' ? this.e.agentOwner(seller.id) : null;
    if (acc != null) this.e.d.notify?.(acc, { t: 'econ', ev: 'sold', amount: l.price - fee, memo: r.title });
    this.e.d.audit?.log('economy.property', { actor: actor.kind === 'account' ? { id: actor.id } : null, detail: { listing: l.id, kind: l.kind, target: l.target, price: l.price, fee } });
    return { bought: r.title, price: l.price, fee, tx: this.e.txView(ledgerTx, buyerW.id) };
  }
  _rent(actor, l, me, landlord, tenantW, landlordW) {
    const perDay = Math.max(1, Math.floor(l.price / 30)), at = this.e.now(), day = this.e.econDay();
    if (this.q.ofTenant.all(this.w, me.kind, me.id).some(x => x.status === 'active' || x.status === 'due')) throw new LedgerError('state', 'You already rent a flat; end that lease first.', 409);
    let leaseId = null, title = '';
    this.e.dbs.tx(() => {
      const h = this.holderOf('flat_rent', l.target);
      if (!same(h.holder, landlord)) { this.q.close.run({ status: 'withdrawn', buyer: null, tx: null, at, w: this.w, id: l.id }); throw new LedgerError('state', 'It changed hands; that listing has ended.', 409); }
      title = h.title;
      const t = this.e.ledger.post({ kind: 'rent', actor: this.e.actorRef(actor), memo: `First day's rent: ${h.title}`, ref: l.id, idem: `lease:${l.id}`, day,
        postings: [{ wallet: tenantW.id, amount: -perDay }, { wallet: landlordW.id, amount: perDay }] });
      leaseId = rid('lease');
      this.q.addLease.run({ id: leaseId, w: this.w, target: l.target, title: h.title, lk: landlord.kind, lid: String(landlord.id), tk: me.kind, tid: String(me.id), rent: perDay, day, at });
      this.q.close.run({ status: 'closed', buyer: `${me.kind}:${me.id}`, tx: t.seq, at, w: this.w, id: l.id });
      const F = h.flat, tenant = me.kind === 'account' ? { kind: 'account', id: me.id } : { kind: 'person', id: this.d.agentBody?.(me.id) };
      if (tenant.kind === 'person' && !(tenant.id >= 0)) throw new LedgerError('state', 'This agent has no character to move in.', 409);
      const res = this.d.editor().apply([{ op: 'flat.lease', b: F.b, f: F.f, u: F.u, deal: 'rented', rent: Math.max(1, Math.round(l.price / 100)), tenant }], { system: 'economy', name: 'Economy' }, { journal: false });
      if (!res.ok) throw new LedgerError('state', res.error || 'The flat couldn\'t be let.', 409);
    });
    this.changed([]);
    const acc = landlord.kind === 'account' ? Number(landlord.id) : landlord.kind === 'agent' ? this.e.agentOwner(landlord.id) : null;
    if (acc != null) this.e.d.notify?.(acc, { t: 'econ', ev: 'let', amount: perDay, memo: title });
    return { lease: this.leaseView(this.q.lease.get(this.w, leaseId)) };
  }
  /**
   * Rents a venue: the first day's rent at once, the lease, and the business passes to the tenant to run (its till goes
   * to the landlord first: it was theirs). One tenant may run several venues (a chain).
   */
  _rentVenue(actor, l, me, landlord, tenantW, landlordW) {
    const perDay = Math.max(1, Math.floor(l.price / 30)), at = this.e.now(), day = this.e.econDay();
    let leaseId = null, title = '';
    this.e.dbs.tx(() => {
      const h = this.holderOf('venue_rent', l.target);
      if (!same(h.holder, landlord)) { this.q.close.run({ status: 'withdrawn', buyer: null, tx: null, at, w: this.w, id: l.id }); throw new LedgerError('state', 'It changed hands; that listing has ended.', 409); }
      if (this.q.liveOn.get(this.w, l.target)) throw new LedgerError('state', 'This business is already let.', 409);
      title = h.title;
      const t = this.e.ledger.post({ kind: 'rent', actor: this.e.actorRef(actor), memo: `First day's rent: ${h.title}`, ref: l.id, idem: `lease:${l.id}`, day,
        postings: [{ wallet: tenantW.id, amount: -perDay }, { wallet: landlordW.id, amount: perDay }] });
      leaseId = rid('lease');
      this.q.addLease.run({ id: leaseId, w: this.w, target: l.target, title: h.title, lk: landlord.kind, lid: String(landlord.id), tk: me.kind, tid: String(me.id), rent: perDay, day, at });
      this.q.close.run({ status: 'closed', buyer: `${me.kind}:${me.id}`, tx: t.seq, at, w: this.w, id: l.id });
      this.e.parts.businesses?.sync();   // the tenant runs it from now on
    });
    this.changed([]);
    const acc = landlord.kind === 'account' ? Number(landlord.id) : landlord.kind === 'agent' ? this.e.agentOwner(landlord.id) : null;
    if (acc != null) this.e.d.notify?.(acc, { t: 'econ', ev: 'let', amount: perDay, memo: title });
    this.e.d.audit?.log('economy.venue_lease', { actor: actor.kind === 'account' ? { id: actor.id } : null, detail: { listing: l.id, target: l.target, lease: leaseId, perDay } });
    return { lease: this.leaseView(this.q.lease.get(this.w, leaseId)) };
  }
  /** Ends a lease: the tenant moves out at once (the landlord may end it too). Paid by the day, nothing is refunded. */
  endLease(actor, id, why = 'ended') {
    const L = this.q.lease.get(this.w, String(id || ''));
    if (!L || !['active', 'due'].includes(L.status)) throw new LedgerError('not_found', 'That lease has ended.', 404);
    const tenant = subj(L.tenant_kind, L.tenant_id), landlord = L.landlord_kind === 'municipality' ? MUNICIPALITY : subj(L.landlord_kind, L.landlord_id);
    if (actor && !(this.mine(actor, tenant) || this.mine(actor, landlord))) throw new LedgerError('rights', 'Only its tenant or landlord ends a lease.', 403);
    this._end(L, actor ? (this.mine(actor, tenant) ? 'the tenant ended it' : 'the landlord ended it') : why);
    return this.leaseView(this.q.lease.get(this.w, L.id));
  }
  _end(L, why) {
    this.e.dbs.tx(() => {
      this.q.setLease.run({ status: 'ended', paid: L.paid_through, due: L.due_since, ended: this.e.now(), why, w: this.w, id: L.id });
      if (parseVenueRef(L.target)) { this.e.parts.businesses?.sync(); return; }   // the business goes back to its landlord, its till to the tenant
      const F = findFlat(this.e.d.world(), L.target);
      if (F) {
        const vacate = L.tenant_kind === 'account' ? { kind: 'account', id: L.tenant_id } : { kind: 'person', id: this.d.agentBody?.(L.tenant_id) };
        this.d.editor().apply([{ op: 'flat.lease', b: F.b, f: F.f, u: F.u, deal: 'own', vacate }], { system: 'economy', name: 'Economy' }, { journal: false });
      }
    });
    this.changed([]);
  }

  // ------------------------------------------------------------------------------------------- the daily rent
  /**
   * For the settlement plan (./households.js): each live lease's rent for days not paid yet, from the tenant to the
   * landlord, as far as the tenant's money goes. Returns what to write once the plan is posted: paid-through days,
   * leases falling due, leases to end after the grace days.
   */
  planLeases(day, { add, room, debts, rid: debtId }) {
    const pol = this.e.policy(), grace = pol.leases?.graceDays ?? 3, out = [];
    // rent is paid in advance: the day that ends pays for the day that begins (moving in paid the first one)
    const next = day + 1;
    for (const L of this.q.live.all(this.w)) {
      if (L.paid_through >= next) continue;
      const tenant = this.e.walletFor(subj(L.tenant_kind, L.tenant_id)), landlord = L.landlord_kind === 'municipality' ? this.e.treasury() : this.e.walletFor(subj(L.landlord_kind, L.landlord_id));
      const days = Math.min(30, next - L.paid_through), due = L.rent * days;
      if (room(tenant.id) >= due) {
        add(tenant.id, `rent (${L.title})`.slice(0, 50), -due); add(landlord.id, 'rent from tenants', due);
        out.push({ id: L.id, status: 'active', paid: next, due: null });
        this.e.parts.trust?.note(subj(L.tenant_kind, L.tenant_id), 'pay', 2, 'rent paid', `${L.id}:${next}`);
      } else {
        const since = L.due_since ?? next;
        if (next - since + 1 > grace) { debts.push({ id: debtId(), debtor: tenant.id, creditor: landlord.id, kind: 'rent', amount: L.rent * Math.min(30, next - since + 1), ref: `lease:${L.id}` }); out.push({ id: L.id, end: true, paid: L.paid_through, due: since }); }
        else out.push({ id: L.id, status: 'due', paid: L.paid_through, due: since });
        this.e.parts.trust?.note(subj(L.tenant_kind, L.tenant_id), 'pay', -15, 'rent missed', `${L.id}:${next}`);
      }
    }
    return out;
  }
  /**
   * Writes the plan's lease outcomes inside the settlement's transaction. A lease past its grace becomes 'ending' there
   * (its debt is recorded once, with the day), and endLeasesDue() moves the tenant out after the commit — or at the
   * next sweep, should the server stop in between.
   */
  applyLeases(list) {
    for (const x of list) {
      const L = this.q.lease.get(this.w, x.id); if (!L) continue;
      if (x.end) this.q.setLease.run({ status: 'ending', paid: x.paid, due: x.due, ended: null, why: null, w: this.w, id: L.id });
      else this.q.setLease.run({ status: x.status, paid: x.paid, due: x.due, ended: null, why: null, w: this.w, id: L.id });
    }
  }
  /** Ends the leases marked 'ending' (the tenant moves out). Safe to call any time; each ends once. */
  endLeasesDue() {
    for (const L of this.q.ending.all(this.w)) {
      try {
        this._end(L, 'the rent went unpaid past the days of grace');
        const acc = L.tenant_kind === 'account' ? Number(L.tenant_id) : this.e.agentOwner(L.tenant_id);
        if (acc != null) this.e.d.notify?.(acc, { t: 'econ', ev: 'evicted', memo: L.title });
      } catch (e) { this.e.log.warn('[economy] ending a lease failed:', e.message); }
    }
  }

  // ------------------------------------------------------------------------------------------- guarding what was sold or let
  /** Flats sold or let for VC (flat ref → why), so edits can't destroy them (as the shop's). */
  claims() {
    const W = this.e.d.world(), out = new Map();
    for (const L of this.q.live.all(this.w)) out.set(L.target, 'let for Virtual Coin');
    for (const [k, rec] of Object.entries(W.flats || {})) {
      if (!rec?.vc || rec.deal !== 'sold') continue;
      const [b, f, u] = k.split(':').map(Number), B = W.buildings[b], L2 = B && W.levels[B.lv?.[f]];
      const ref = B && L2 ? flatRef(B, f, L2, u) : null;
      if (ref) out.set(ref, 'sold for Virtual Coin');
    }
    return out;
  }
  /** The editor's guard: refuses ops that would destroy a flat sold or let for VC (or rewrite its record). */
  /** The venue floors of building B let under a live lease: Map floor → title. */
  venueLeases(B) {
    const out = new Map();
    if (!B?.id) return out;
    for (const L of this.q.live.all(this.w)) { const r = parseVenueRef(L.target); if (r && r.id === B.id) out.set(r.f, L.title); }
    return out;
  }
  guardOp(o, ed) {
    const W = this.e.d.world(), B = W?.buildings?.[o.b | 0];
    if (!B || B.gone) return null;
    const vl = B.type === 'apartment' ? null : this.venueLeases(B);
    if (vl?.size) {
      switch (o.op) {
        case 'lvl.clear': case 'lvl.regen': case 'lvl.reset': case 'lvl.apply': return vl.has(o.f | 0) ? `${vl.get(o.f | 0)} is let for Virtual Coin: its floor can't be re-laid while the lease runs` : null;
        case 'bld.del': case 'bld.floors': case 'bld.place': return `${[...vl.values()][0]} is let for Virtual Coin: end the lease first`;
        default: return null;
      }
    }
    if (B.type !== 'apartment') return null;
    const claims = this.claims();
    if (!claims.size) return null;
    const mineHere = [...claims].filter(([ref]) => ref.startsWith(`${B.id}/`));
    if (!mineHere.length) return null;
    const onFlat = (f, u) => { for (const [ref, why] of mineHere) { const F = findFlat(W, ref); if (F && F.f === f && F.u === u) return why; } return null; };
    switch (o.op) {
      case 'flat.set': { const why = onFlat(o.f | 0, o.u | 0); return why && (o.deal !== undefined || o.tenants !== undefined || o.owner !== undefined || o.rent !== undefined) ? `This flat is ${why}: its deal changes through the economy` : null; }
      case 'flat.add': case 'flat.del': { const why = onFlat(o.f | 0, o.u | 0); return why ? `This flat is ${why}` : null; }
      case 'lvl.clear': case 'lvl.regen': case 'lvl.reset': case 'lvl.apply': { for (const [ref, why] of mineHere) if (ref.startsWith(`${B.id}/${o.f | 0}/`)) return `A flat on this floor is ${why}`; return null; }
      case 'bld.del': case 'bld.floors': case 'bld.place': return `A flat in this building is ${mineHere[0][1]}`;
      default: void ed; return null;
    }
  }

  /** The journal's guard (undo, redo, reverts): an edit may not be undone over a flat sold or let for VC since. */
  guardKeys(keys) {
    const W = this.e.d.world(), claims = this.claims();
    for (const k of keys) {   // an edit undone over a business let since
      const i = k.indexOf(':'), kind = k.slice(0, i), rest = k.slice(i + 1);
      if (kind === 'fp' || kind === 'bf' || kind === 'bx' || kind === 'bg') { const B = W.buildings?.[Number(rest)], vl = B ? this.venueLeases(B) : null; if (vl?.size) return `That change touched a building with a business let for Virtual Coin (${[...vl.values()][0]})`; }
      if (kind === 'lv' || kind === 'lm') {
        const lv = Number(rest);
        for (const B of W.buildings || []) { if (!B || B.gone || !B.lv?.includes(lv)) continue; const vl = this.venueLeases(B); for (const [f, t] of vl) if (B.lv[f] === lv) return `That change touched the floor of ${t}, let for Virtual Coin`; }
      }
    }
    if (!claims.size) return null;
    const inB = B => [...claims].filter(([ref]) => ref.startsWith(`${B.id}/`));
    for (const k of keys) {
      const i = k.indexOf(':'), kind = k.slice(0, i), rest = k.slice(i + 1);
      if (kind === 'fl') {
        const [b, f, u] = rest.split(':').map(Number), B = W.buildings?.[b];
        if (!B) continue;
        for (const [ref, why] of inB(B)) { const F = findFlat(W, ref); if (F && F.f === f && F.u === u) return `That change touched a flat now ${why}`; }
      } else if (kind === 'fp' || kind === 'bf' || kind === 'bx' || kind === 'bg') {
        const B = W.buildings?.[Number(rest)], c = B ? inB(B) : [];
        if (c.length) return `That change touched a building with a flat ${c[0][1]}`;
      } else if (kind === 'lv' || kind === 'lm') {
        const lv = Number(rest);
        for (const B of W.buildings || []) {
          if (!B || B.gone || B.type !== 'apartment' || !B.lv?.includes(lv)) continue;
          for (const [ref, why] of inB(B)) { const r = parseFlatRef(ref); if (r && B.lv[r.f] === lv) return `That change touched a floor with a flat ${why}`; }
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------------------------------- views
  view(l) {
    if (!l) return null;
    const s = l.seller_kind === 'municipality' ? subj('city', 'city') : subj(l.seller_kind, l.seller_id);
    const V = l.kind === 'venue_rent' ? this.findVenue(l.target) : null;
    return { id: l.id, kind: l.kind, target: l.target, price: l.price, perDay: isRent(l.kind) ? Math.max(1, Math.floor(l.price / 30)) : null, note: l.note || '', status: l.status,
      ...(V ? { business: { id: V.biz.id, name: V.biz.name, kind: V.biz.kind, b: V.B.idx, f: V.f } } : {}),
      seller: { kind: l.seller_kind, ...(l.seller_kind !== 'municipality' ? { id: l.seller_id } : {}), name: this.e.nameOf(s) }, fee: isRent(l.kind) ? 0 : Math.floor(l.price * this.e.policy().fees.worldFeeBp / 10000) };
  }
  listings() { return this.q.all.all(this.w).map(l => this.view(l)); }
  listingsOn(target) { return this.q.openOn.all(this.w, String(target)).map(l => this.view(l)); }
  leaseView(L) {
    if (!L) return null;
    const t = subj(L.tenant_kind, L.tenant_id), ll = L.landlord_kind === 'municipality' ? subj('city', 'city') : subj(L.landlord_kind, L.landlord_id);
    return { id: L.id, target: L.target, title: L.title, rent: L.rent, monthly: L.rent * 30, status: L.status, paidThrough: L.paid_through, dueSince: L.due_since, ended: L.ended, why: L.end_reason,
      tenant: { ...t, name: this.e.nameOf(t) }, landlord: { ...ll, name: this.e.nameOf(ll) } };
  }
  leaseOn(target) { const L = this.q.liveOn.get(this.w, String(target)); return L ? this.leaseView(L) : null; }
  /**
   * A venue's letting for its card: its place (the reference to list it by), the live lease, the listing for rent, and
   * whether the viewer is its landlord (may let it or end the lease) or its tenant.
   */
  venueInfo(biz, actor) {
    const W = this.e.d.world(), B = W?.buildings?.[biz.b];
    if (!B || biz.f < 0) return {};
    const place = venueRef(B, biz.f), lease = this.leaseOn(place), listing = this.q.open.get(this.w, 'venue_rent', place);
    const lot = B.lot ? this.d.property?.get(B.lot) : null, holder = lot?.holder || MUNICIPALITY;
    return { place, lease, rentListing: listing ? this.view(listing) : null, landlord: !!actor && this.mine(actor, holder), tenant: !!actor && !!lease && this.mine(actor, lease.tenant) };
  }
  of(s) {
    return { rent: this.q.ofTenant.all(this.w, s.kind, String(s.id)).map(L => this.leaseView(L)), let: this.q.ofLandlord.all(this.w, s.kind, String(s.id)).map(L => this.leaseView(L)) };
  }
  changed(lots) { this.version++; if (lots?.length) this.d.lotsChanged?.(lots); this.e.d.broadcast?.({ t: 'vlistings', v: this.version }); }
}
export { vc };
