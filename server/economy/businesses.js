// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Businesses (docs/features/ECONOMY.md §4): every venue floor (café, restaurant, shop, gym) and every office building
// (a company) is a business with an owner, a wallet, a price list, wage rates, a rating and daily books. The registry
// follows the world: a new venue opens a business, a floor that stops being one closes it, and the owner follows the
// holder of the building's lot — or, while the venue is let (./realty.js), its tenant, who runs it. Owners set prices (within the policy's bounds) and wages (at least the minimum wage),
// fund the business from their wallet and draw its profit.
import crypto from 'node:crypto';
import { LedgerError } from './ledger.js';
import { subj } from './economy.js';
import { ROLES } from '../../shared/work.js';
import { FOOD_BY_ID, CUISINE_OF, LEGACY_ITEMS, MENU_MAX, guessCuisine, menuIds } from '../../shared/food.js';
import { FOOD_VENUES, foodBase } from './policy.js';

// the items of the menus before shared/food.js (books and stats of those days still name them)
const LEGACY_INPUTS = { pastry: { baked: 1 }, cafe_lunch: { food: 1, coffee: 1 }, meal: { food: 3 }, drink: { drinks: 1 }, dessert: { baked: 1, food: 1 } };

const VENUES = new Set(['cafe', 'restaurant', 'shop', 'gym', 'arcade', 'lounge_bar', 'club']);
const rid = () => `biz_${crypto.randomBytes(9).toString('base64url')}`;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

export class Businesses {
  /** @param {import('./economy.js').Economy} econ  @param {object} d { property } */
  constructor(econ, d = {}) {
    this.e = econ; this.d = d; this.db = econ.db; this.w = econ.w;
    this.byId = new Map(); this.byPlace = new Map();   // "b:f" → id (open ones)
    this.version = 1;
    const db = this.db;
    this.q = {
      all: db.prepare("SELECT * FROM econ_businesses WHERE world_id = ? AND status <> 'dissolved'"),
      add: db.prepare(`INSERT INTO econ_businesses (id, world_id, kind, name, b, f, owner_kind, owner_id, status, settings_json, created, updated)
        VALUES ($id, $w, $kind, $name, $b, $f, $ok, $oid, 'open', '{}', $at, $at)`),
      set: db.prepare('UPDATE econ_businesses SET name = $name, owner_kind = $ok, owner_id = $oid, status = $status, updated = $at WHERE world_id = $w AND id = $id'),
      settings: db.prepare('UPDATE econ_businesses SET settings_json = $s, updated = $at WHERE world_id = $w AND id = $id'),
      rating: db.prepare('UPDATE econ_businesses SET rating = $r, reviews = $n, updated = $at WHERE world_id = $w AND id = $id'),
      days: db.prepare('SELECT * FROM econ_biz_days WHERE world_id = ? AND biz = ? ORDER BY day DESC LIMIT ?'),
      dayAll: db.prepare('SELECT * FROM econ_biz_days WHERE world_id = ? AND day = ?'),
      debts: db.prepare("SELECT * FROM econ_debts WHERE world_id = ? AND debtor = ? AND status = 'open' ORDER BY created"),
      payDebt: db.prepare('UPDATE econ_debts SET amount = $amount, status = $status, updated = $at WHERE world_id = $w AND id = $id'),
    };
    this.load();
    econ.dbs.onRollback(() => this.load());
  }
  load() {
    this.byId.clear(); this.byPlace.clear();
    for (const r of this.q.all.all(this.w)) this._keep(r);
  }
  _keep(r) {
    let s = {}; try { s = JSON.parse(r.settings_json || '{}') || {}; } catch { s = {}; }
    const b = { ...r, settings: s };
    this.byId.set(b.id, b);
    if (b.status === 'open') this.byPlace.set(`${b.b}:${b.f}`, b.id); else if (this.byPlace.get(`${b.b}:${b.f}`) === b.id) this.byPlace.delete(`${b.b}:${b.f}`);
    return b;
  }
  get(id) { return this.byId.get(String(id)) || null; }
  all() { return [...this.byId.values()].filter(b => b.status !== 'dissolved'); }
  open() { return this.all().filter(b => b.status === 'open'); }
  at(b, f) { const id = this.byPlace.get(`${b}:${f}`); return id ? this.byId.get(id) : null; }
  /** The company of a building (its offices, its lobby). */
  companyOf(b) { return this.at(b, -1); }
  ownedBy(s) { return this.all().filter(b => b.owner_kind === s.kind && String(b.owner_id) === String(s.id)); }

  /** The owner of whatever stands on building B's lot: its lot's holder (a business holding land: its own owner). */
  ownerOfBuilding(B) {
    let h = B?.lot ? this.d.property?.get(B.lot)?.holder : null;
    for (let k = 0; k < 3 && h?.kind === 'business'; k++) { const x = this.get(h.id); h = x ? { kind: x.owner_kind, id: x.owner_id } : null; }
    return h && ['account', 'agent', 'municipality'].includes(h.kind) ? { kind: h.kind, id: String(h.id) } : { kind: 'municipality', id: 'city' };
  }
  /** Who runs the business on floor f of building B: the tenant of a live venue lease, else the lot's holder. */
  operatorOf(B, f) { return (f >= 0 && this.e.parts.realty?.venueTenant(B, f)) || this.ownerOfBuilding(B); }
  /** The wallet that receives an owner's money: a player's or agent's own, the city's treasury. */
  ownerWallet(b) {
    if (b.owner_kind === 'municipality') return this.e.treasury();
    return this.e.walletFor(subj(b.owner_kind, b.owner_id));
  }
  wallet(b) { return this.e.walletFor(subj('business', b.id), 'business'); }

  /**
   * Brings the registry in line with the world: venues and companies that exist get a business (new ones start with
   * money: see Economy._endow), ones that are gone close, names and owners follow. When the owner changes, the cash in
   * the business goes to the previous owner first (it was theirs). Returns { opened, closed, owners }.
   */
  sync() {
    const W = this.e.d.world(); if (!W) return { opened: 0, closed: 0, owners: 0 };
    const want = new Map();
    for (const B of W.buildings || []) {
      if (!B || B.gone) continue;
      if (B.type === 'office' || B.type === 'hq') want.set(`${B.idx}:-1`, { kind: 'office', name: B.name, b: B.idx, f: -1, B });
      for (let f = 0; f < (B.floors || 0); f++) {
        const L = W.levels[B.lv?.[f]];
        if (L && VENUES.has(L.venue)) want.set(`${B.idx}:${f}`, { kind: L.venue, name: clean(L.name || B.name, 60), b: B.idx, f, B });
      }
    }
    let opened = 0, closed = 0, owners = 0;
    const at = this.e.now(), live = this.e.enabled();
    this.e.dbs.tx(() => {
      for (const b of this.open()) {
        const k = `${b.b}:${b.f}`, x = want.get(k);
        if (!x || x.kind !== b.kind) {
          this.q.set.run({ name: b.name, ok: b.owner_kind, oid: b.owner_id, status: 'closed', at, w: this.w, id: b.id });
          this._keep({ ...b, status: 'closed', settings_json: JSON.stringify(b.settings) });
          if (live) this._payOut(b, 'closed');
          closed++;
          continue;
        }
        const o = this.operatorOf(x.B, x.f);
        if (o.kind !== b.owner_kind || o.id !== String(b.owner_id) || x.name !== b.name) {
          if (live && (o.kind !== b.owner_kind || o.id !== String(b.owner_id))) { this._payOut(b, 'owner'); owners++; }
          this.q.set.run({ name: x.name, ok: o.kind, oid: o.id, status: 'open', at, w: this.w, id: b.id });
          this._keep({ ...b, name: x.name, owner_kind: o.kind, owner_id: o.id, settings_json: JSON.stringify(b.settings) });
          this.e.walletOwners.clear();
        }
        want.delete(k);
      }
      for (const x of want.values()) {
        const o = this.operatorOf(x.B, x.f), id = rid();
        this.q.add.run({ id, w: this.w, kind: x.kind, name: x.name, b: x.b, f: x.f, ok: o.kind, oid: o.id, at });
        this._keep({ id, world_id: this.w, kind: x.kind, name: x.name, b: x.b, f: x.f, owner_kind: o.kind, owner_id: o.id, status: 'open', settings_json: '{}', rating: 350, reviews: 0, created: at, updated: at });
        if (live) this.wallet(this.get(id));
        opened++;
      }
    });
    if (opened || closed || owners) this.version++;
    return { opened, closed, owners };
  }
  /**
   * A closing business, or one changing hands, pays what it holds: first what it owes (wages, oldest first), then the
   * rest to its owner — in one transaction. Debts it can't pay stay open against its wallet.
   */
  _payOut(b, why) {
    const w = this.e.ledger.walletOf('business', b.id, 'business');
    if (!w || w.balance - w.held <= 0) return;
    let left = w.balance - w.held;
    const to = this.ownerWallet(b), postings = [], paid = [], byCreditor = new Map(), at = this.e.now();
    for (const d of this.q.debts.all(this.w, w.id)) {
      if (left <= 0) break;
      if (!this.e.ledger.wallet(d.creditor) || d.creditor === w.id) continue;
      const pay = Math.min(d.amount, left);
      byCreditor.set(d.creditor, (byCreditor.get(d.creditor) || 0) + pay);
      paid.push({ id: d.id, left: d.amount - pay });
      left -= pay;
    }
    if (left > 0) byCreditor.set(to.id, (byCreditor.get(to.id) || 0) + left);
    for (const [wid, amount] of byCreditor) postings.push({ wallet: wid, amount });
    if (!postings.length) return;
    postings.push({ wallet: w.id, amount: -(w.balance - w.held) });
    this.e.dbs.tx(() => {
      this.e.ledger.post({ kind: 'draw', actor: 'system:businesses', memo: why === 'closed' ? `${b.name} closed: its debts, then its cash to its owner` : `${b.name} changed hands: its debts, then its cash to the previous owner`,
        ref: `biz:${b.id}`, system: true, force: true, postings });
      for (const x of paid) this.q.payDebt.run({ amount: x.left, status: x.left > 0 ? 'open' : 'paid', at, w: this.w, id: x.id });
    });
  }

  // ------------------------------------------------------------------------------------------- menus, prices and wages
  /** A café's or restaurant's cuisine (shared/food.js CUISINES): its owner's choice, else what its name suggests. */
  cuisineOf(b) {
    const own = b.settings?.cuisine;
    return CUISINE_OF[own] ? own : guessCuisine(b.name, b.kind, b.b);
  }
  /** The ids of what a café or restaurant sells (its owner's list, else its cuisine's), cached per settings. */
  menuIdsOf(b) {
    if (!FOOD_VENUES.has(b.kind)) return (this.e.policy().menus[b.kind] || []).map(m => m.id);
    // (each change of settings or name makes a new record object with new settings: ./_keep)
    if (b._menuOf !== b.settings || b._menuName !== b.name) { b._menuOf = b.settings; b._menuName = b.name; b._menu = menuIds(this.cuisineOf(b), b.settings?.menu); }
    return b._menu;
  }
  /** One item a business sells: { id, label, icon, price (the city's usual), inputs, course?, cat?, n? } or null. */
  itemOf(b, itemId) {
    if (!FOOD_VENUES.has(b.kind)) return (this.e.policy().menus[b.kind] || []).find(m => m.id === itemId) || null;
    if (!this.menuIdsOf(b).includes(itemId)) return null;
    return this.foodLine(itemId);
  }
  /** A food item as a menu line at the city's usual price (whether or not a place sells it). */
  foodLine(itemId) {
    const it = FOOD_BY_ID[itemId];
    if (!it) return LEGACY_INPUTS[itemId] ? { id: itemId, label: LEGACY_ITEMS[itemId].name, icon: '🍽️', price: 0, inputs: LEGACY_INPUTS[itemId] } : null;
    return { id: it.id, label: it.name, icon: it.icon, price: foodBase(this.e.policy(), it), inputs: it.inputs, course: it.course, cat: it.cat, n: it.n };
  }
  /** What one unit of an item used from the market (also for items a place no longer sells: yesterday's books). */
  inputsOf(b, itemId) { return (this.itemOf(b, itemId) || (FOOD_VENUES.has(b.kind) ? this.foodLine(itemId) : null))?.inputs || null; }
  /** The business's menu: its items at its own prices. */
  menu(b) {
    if (!FOOD_VENUES.has(b.kind)) return (this.e.policy().menus[b.kind] || []).map(it => ({ id: it.id, label: it.label, icon: it.icon, price: this.priceOf(b, it.id), base: it.price, inputs: it.inputs }));
    return this.menuIdsOf(b).map(id => { const it = this.foodLine(id); return { ...it, base: it.price, price: this.priceOf(b, id) }; });
  }
  priceOf(b, itemId) {
    const p = this.e.policy(), it = this.itemOf(b, itemId);
    if (!it) return LEGACY_ITEMS[itemId] && FOOD_VENUES.has(b.kind) ? this.typicalPrice(b, LEGACY_ITEMS[itemId].course) : null;
    const own = b.settings?.prices?.[itemId];
    const lo = Math.ceil(it.price * p.priceBounds.minPct / 100), hi = Math.floor(it.price * p.priceBounds.maxPct / 100);
    if (Number.isSafeInteger(own)) return Math.max(lo, Math.min(hi, own));
    // prices float (spec 10 §2): a business that prices automatically follows its demand and its costs (its level, percent)
    const level = this.autoPricing(b) && Number.isSafeInteger(b.settings?.level) ? b.settings.level : 100;
    return Math.max(lo, Math.min(hi, Math.round(it.price * level / 100 / 5) * 5));
  }
  /** What a course usually costs at a place (the middle price of its items of that course; a drink, a main …), or null. */
  typicalPrice(b, course) {
    const ps = this.menuIdsOf(b).filter(id => FOOD_BY_ID[id]?.course === course).map(id => this.priceOf(b, id)).sort((x, y) => x - y);
    return ps.length ? ps[ps.length >> 1] : null;
  }
  /** Whether a business sets its own prices from demand and cost: the city's by policy, a player's when they choose. */
  autoPricing(b) { return b.owner_kind === 'municipality' ? this.e.policy().pricing.auto : !!b.settings?.auto; }
  /**
   * After a day: each business that prices automatically moves its price level a step — up when it served more customers
   * than others of its kind or its stock cost too much of its takings, down when it served fewer or its margin is wide.
   */
  autoPrice(day, books) {
    const pol = this.e.policy().pricing, kinds = new Map();
    for (const b of this.open()) { if (b.f === -1) continue; const r = books.get(b.id); if (!r) continue; const k = kinds.get(b.kind) || { n: 0, c: 0 }; k.n++; k.c += r.customers; kinds.set(b.kind, k); }
    let changed = 0;
    this.e.dbs.tx(() => {
      for (const b of this.open()) {
        if (b.f === -1 || !this.autoPricing(b)) continue;
        const r = books.get(b.id), k = kinds.get(b.kind);
        if (!r || !k?.n) continue;
        const avg = k.c / k.n, cost = r.sales > 0 ? r.cogs / r.sales : 0;
        let step = 0;
        if (r.customers > avg * 1.2 || cost > 0.5) step = pol.stepPct;
        else if ((r.customers < avg * 0.8 && avg > 2) || (cost > 0 && cost < 0.22)) step = -pol.stepPct;
        if (!step) continue;
        const cur = Number.isSafeInteger(b.settings?.level) ? b.settings.level : 100, next = Math.max(pol.minPct, Math.min(pol.maxPct, cur + step));
        if (next === cur) continue;
        const st = { ...(b.settings || {}), level: next };
        this.q.settings.run({ s: JSON.stringify(st), at: this.e.now(), w: this.w, id: b.id });
        this._keep({ ...b, settings_json: JSON.stringify(st) });
        changed++;
      }
    });
    if (changed) this.version++;
    void day;
    return changed;
  }
  /** The business's price level against the policy's defaults (1 = default), for demand. */
  priceLevel(b) {
    const m = this.menu(b);
    if (!m.length) return 1;
    return m.reduce((s, it) => s + it.price / it.base, 0) / m.length;
  }
  wageOf(b, role) {
    const p = this.e.policy(), base = p.wages[role] ?? p.minWage;
    const own = b?.settings?.wages?.[role];
    return Number.isSafeInteger(own) ? Math.max(p.minWage, Math.min(own, base * 10)) : base;
  }
  /** The owner (or an administrator for the city's) changes prices, wages or staffing. */
  configure(actor, id, patch) {
    const b = this.get(id);
    if (!b || b.status !== 'open') throw new LedgerError('not_found', 'No such business.', 404);
    if (!this.mayManage(actor, b)) throw new LedgerError('rights', 'Only the owner runs this business.', 403);
    const p = this.e.policy(), s = structuredClone(b.settings || {});
    if (patch.cuisine !== undefined || patch.menu !== undefined) {
      if (!FOOD_VENUES.has(b.kind)) throw new LedgerError('input', 'Only cafés and restaurants have a menu to change.', 400);
      if (patch.cuisine !== undefined) {
        if (!CUISINE_OF[patch.cuisine]) throw new LedgerError('input', 'Unknown kind of place.', 400);
        s.cuisine = patch.cuisine;
        if (patch.menu === undefined) delete s.menu;   // a new kind: its usual menu
      }
      if (patch.menu === null) delete s.menu;
      else if (patch.menu !== undefined) {
        const list = patch.menu;
        if (!Array.isArray(list) || !list.length || list.length > MENU_MAX) throw new LedgerError('input', `A menu has from 1 to ${MENU_MAX} items.`, 400);
        const seen = new Set();
        for (const id of list) {
          if (typeof id !== 'string' || !FOOD_BY_ID[id]) throw new LedgerError('input', `Unknown item ${clean(id, 30)}.`, 400);
          if (seen.has(id)) throw new LedgerError('input', `${FOOD_BY_ID[id].name} is on the menu twice.`, 400);
          seen.add(id);
        }
        // the cuisine's own list exactly: nothing of the owner's to keep
        const usual = CUISINE_OF[s.cuisine || this.cuisineOf(b)].menu;
        if (list.length === usual.length && list.every((id, k) => id === usual[k])) delete s.menu; else s.menu = [...list];
      }
      if (s.prices) for (const id of Object.keys(s.prices)) if (!menuIds(s.cuisine || this.cuisineOf(b), s.menu).includes(id)) delete s.prices[id];
    }
    if (patch.prices !== undefined) {
      s.prices = { ...(s.prices || {}) };
      for (const [item, v] of Object.entries(patch.prices || {})) {
        const it = this.itemOf(b, item) || (FOOD_VENUES.has(b.kind) && Array.isArray(patch.menu) && patch.menu.includes(item) ? this.foodLine(item) : null);
        if (!it) throw new LedgerError('input', `This business doesn't sell ${clean(item, 30)}.`, 400);
        if (v === null) { delete s.prices[item]; continue; }
        const lo = Math.ceil(it.price * p.priceBounds.minPct / 100), hi = Math.floor(it.price * p.priceBounds.maxPct / 100);
        if (!Number.isSafeInteger(v) || v < lo || v > hi) throw new LedgerError('input', `${it.label} can be priced from ${lo / 100} to ${hi / 100} VC.`, 400);
        s.prices[item] = v;
      }
    }
    if (patch.wages !== undefined) {
      s.wages = { ...(s.wages || {}) };
      for (const [role, v] of Object.entries(patch.wages || {})) {
        if (!(role in p.wages)) throw new LedgerError('input', `Unknown role ${clean(role, 30)}.`, 400);
        if (v === null) { delete s.wages[role]; continue; }
        if (!Number.isSafeInteger(v) || v < p.minWage || v > p.wages[role] * 10) throw new LedgerError('input', `Wages are at least the minimum wage (${p.minWage / 100} VC an hour).`, 400);
        s.wages[role] = v;
      }
    }
    if (patch.staffing !== undefined) {
      const st = patch.staffing || {};
      s.staffing = { players: st.players !== false, agents: st.agents !== false };
    }
    if (patch.autoDraw !== undefined) s.autoDraw = !!patch.autoDraw;
    if (patch.auto !== undefined) s.auto = !!patch.auto;
    this.e.dbs.tx(() => this.q.settings.run({ s: JSON.stringify(s), at: this.e.now(), w: this.w, id: b.id }));
    this._keep({ ...b, settings_json: JSON.stringify(s) });
    this.version++;
    this.e.d.audit?.log('economy.business', { actor: actor.kind === 'account' ? { id: actor.id, login: actor.login } : null, detail: { business: b.id, patch } });
    this.e.bump();
    return this.view(this.get(b.id), { owner: true });
  }
  mayManage(actor, b) {
    if (actor.kind === 'account') {
      if (b.owner_kind === 'account') return String(b.owner_id) === String(actor.id);
      if (b.owner_kind === 'municipality') return !!actor.admin;
      if (b.owner_kind === 'agent') return this.e.agentOwner(b.owner_id) === Number(actor.id);
    }
    if (actor.kind === 'agent') return b.owner_kind === 'agent' && String(b.owner_id) === String(actor.id);
    return false;
  }
  /** Money between the owner's wallet and the business: 'fund' puts it in, 'draw' takes profit out. */
  move(actor, id, dir, amount) {
    this.e.live();
    const b = this.get(id);
    if (!b) throw new LedgerError('not_found', 'No such business.', 404);
    if (!this.mayManage(actor, b) || b.owner_kind === 'municipality') throw new LedgerError('rights', 'Only the owner moves this business\'s money.', 403);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('input', 'Bad amount.', 400);
    const bw = this.wallet(b), ow = this.ownerWallet(b);
    const [from, to] = dir === 'fund' ? [ow, bw] : dir === 'draw' ? [bw, ow] : [null, null];
    if (!from) throw new LedgerError('input', 'Fund or draw.', 400);
    const t = this.e.ledger.transfer(from.id, to.id, amount, { kind: dir, actor: this.e.actorRef(actor), memo: dir === 'fund' ? `Money into ${b.name}` : `Profit from ${b.name}` });
    return this.e.txView(t, from.id);
  }

  // ------------------------------------------------------------------------------------------- views
  ownerView(b) {
    const k = b.owner_kind === 'municipality' ? 'city' : b.owner_kind;
    return { kind: b.owner_kind, ...(b.owner_kind !== 'municipality' ? { id: b.owner_id } : {}), name: this.e.nameOf(subj(k, b.owner_id)) };
  }
  view(b, { owner = false } = {}) {
    if (!b) return null;
    const today = this.e.parts.households?.todayOf?.(b.id) || null;
    const out = { id: b.id, kind: b.kind, name: b.name, b: b.b, f: b.f, status: b.status, owner: this.ownerView(b),
      rating: b.rating, reviews: b.reviews, menu: b.f === -1 ? [] : this.menu(b), today, priceLevel: Math.round(this.priceLevel(b) * 100),
      ...(FOOD_VENUES.has(b.kind) ? { cuisine: this.cuisineOf(b), ownMenu: Array.isArray(b.settings?.menu) } : {}),
      roles: (this.e.parts.jobs?.rolesAt(b.kind) || []).map(r => ({ role: r, label: ROLES[r]?.label || r, icon: ROLES[r]?.icon || '💼' })) };
    if (owner) {
      out.settings = { prices: b.settings?.prices || {}, wages: b.settings?.wages || {}, staffing: b.settings?.staffing || { players: true, agents: true }, autoDraw: !!b.settings?.autoDraw, auto: this.autoPricing(b), level: b.settings?.level ?? 100 };
      if (FOOD_VENUES.has(b.kind)) { const f = this.e.policy().food; out.foodPricing = { pct: f.pricePct, prices: f.prices }; }   // (the menu editor's usual prices)
      out.books = this.q.days.all(this.w, b.id, 30).map(d => ({ day: d.day, sales: d.sales, customers: d.customers, cogs: d.cogs, wages: d.wages, rent: d.rent, tax: d.tax, upkeep: d.upkeep, other: d.other, profit: d.profit, owed: d.owed }));
    }
    return out;
  }
  /** Every business for the city's economy window: today and yesterday's books. */
  table(day) {
    const rows = new Map(this.q.dayAll.all(this.w, day).map(r => [r.biz, r]));
    return this.open().map(b => { const r = rows.get(b.id); return { ...this.view(b), yesterday: r ? { sales: r.sales, customers: r.customers, profit: r.profit, wages: r.wages, owed: r.owed } : null }; });
  }
  setRating(id, rating, reviews) {
    const b = this.get(id); if (!b) return;
    this.q.rating.run({ r: rating, n: reviews, at: this.e.now(), w: this.w, id: b.id });
    this._keep({ ...b, rating, reviews, settings_json: JSON.stringify(b.settings) });
  }
  policyChanged() { this.version++; }
}
