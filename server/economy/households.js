// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The living economy of the residents (docs/features/ECONOMY.md §5): what they buy at the city's venues (reported by
// the simulation as it plans their day), the hours they work, the groceries for meals at home; and the daily settlement
// that pays wages, collects rent and taxes, pays benefits, credits businesses and the city, and sums it all up.
//
// - Purchases and hours are added up in memory per economic day and written to econ_pending every few seconds (and when
//   the server stops), so a crash loses at most those seconds of residents' activity — never money: nothing is paid
//   until the day settles. A resident can only buy what their wallet holds after everything not settled yet.
// - The settlement of a day is ONE database transaction: the plan (pure arithmetic on the day's totals and the wallets'
//   balances) nets every wallet to one posting with a note that itemises it ("wages +104 · rent −22 · spent −31.50 ·
//   tax −4.16"), posted in chunks that balance through the clearing wallet, which ends the day at zero. Either the whole
//   day settles or none of it does, with what follows from it (bond repayments, the venues' reviews and prices); a day
//   settles once (econ_days), and missed days settle in order on the next start, a few per second. A day on which the
//   world did not run (the server was off: no activity at all) is recorded as skipped, not settled as if it was lived.
// - Being short is soft: a business pays wages pro rata and owes the rest; a resident pays what rent they can, the city's
//   housing assistance covers part, the rest is owed; the city scales benefits and upkeep to what it has.
import { landValue } from '../../shared/land-value.js';
import { makeGrid } from '../../shared/city.js';
import { hashStr } from '../../shared/rng.js';
import { isServiceDesk } from '../../shared/catalog.js';
import { LedgerError, vc } from './ledger.js';
import { subj, subjKey } from './economy.js';
import { bp, incomeTax, bracketOf } from './policy.js';
import landCfg from '../../shared/world-config/land-value.json' with { type: 'json' };

const VENUES = new Set(['cafe', 'restaurant', 'shop', 'gym', 'arcade', 'lounge_bar', 'club']);
/** What a visit used to cost at most (the menus before shared/food.js): who can afford to go. */
const VISIT_COST = { cafe: 900, restaurant: 1600, arcade: 900, lounge_bar: 1600, club: 2800 };
const CHUNK = 4000;
const RECEIPTS = 8;   // purchases remembered per resident (memory only: what the day's settlement then charges)
const fmt = n => vc(n).replace(' VC', '');
const r01 = (pid, t, salt) => (hashStr(`${pid}:${Math.round(t * 10)}:${salt}`) % 10000) / 10000;

export class Households {
  /** @param {import('./economy.js').Economy} econ */
  constructor(econ) {
    this.e = econ; this.db = econ.db; this.w = econ.w;
    this.days = new Map();          // econ day → { res: Map(pid → R), biz: Map(bizId → B) }
    this.dirty = new Set();         // "day|key"
    this.pending = new Map();       // pid → VC promised but not settled (all open days)
    this.lastBuy = new Map();       // pid → { biz, t } (one purchase per visit)
    this.receipts = new Map();      // pid → the last purchases [{ t, at, biz, kind, total, items }] (the selection card's money feed; memory only)
    this.agentVenue = new Map();    // agent id → what it bought at venues in the last 24 hours [{ at, amount }] (its owner's daily cap; memory only)
    this.landCache = new Map();     // building idx → land factor (percent)
    this.shopNear = new Map();      // building idx → the nearest shop business (groceries for home meals)
    this.settling = false;
    this.lastSettled = null;
    const db = this.db;
    this.q = {
      pending: db.prepare('SELECT day, key, json FROM econ_pending WHERE world_id = ?'),
      putPending: db.prepare('INSERT INTO econ_pending (world_id, day, key, json) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, day, key) DO UPDATE SET json = excluded.json'),
      dropPending: db.prepare('DELETE FROM econ_pending WHERE world_id = ? AND day = ?'),
      dayRow: db.prepare('SELECT * FROM econ_days WHERE world_id = ? AND day = ?'),
      lastDone: db.prepare("SELECT MAX(day) AS d FROM econ_days WHERE world_id = ? AND status IN ('done', 'skipped')"),
      putDay: db.prepare(`INSERT INTO econ_days (world_id, day, status, started, finished, summary_json) VALUES ($w, $day, $status, $at, $fin, $sum)
        ON CONFLICT (world_id, day) DO UPDATE SET status = excluded.status, finished = excluded.finished, summary_json = excluded.summary_json`),
      bizDay: db.prepare(`INSERT INTO econ_biz_days (world_id, biz, day, sales, customers, units, cogs, wages, rent, tax, upkeep, other, profit, owed, detail_json)
        VALUES ($w, $biz, $day, $sales, $customers, $units, $cogs, $wages, $rent, $tax, $upkeep, $other, $profit, $owed, $detail)
        ON CONFLICT (world_id, biz, day) DO UPDATE SET sales = excluded.sales, customers = excluded.customers, units = excluded.units, cogs = excluded.cogs, wages = excluded.wages,
        rent = excluded.rent, tax = excluded.tax, upkeep = excluded.upkeep, other = excluded.other, profit = excluded.profit, owed = excluded.owed, detail_json = excluded.detail_json`),
      addDebt: db.prepare(`INSERT INTO econ_debts (id, world_id, debtor, creditor, kind, amount, original, ref, status, created, updated)
        VALUES ($id, $w, $debtor, $creditor, $kind, $amount, $amount, $ref, 'open', $at, $at)`),
      openDebts: db.prepare("SELECT * FROM econ_debts WHERE world_id = ? AND debtor = ? AND status = 'open' ORDER BY created LIMIT 50"),
      payDebt: db.prepare("UPDATE econ_debts SET amount = $amount, status = $status, updated = $at WHERE world_id = $w AND id = $id"),
      debtsBy: db.prepare("SELECT debtor, SUM(amount) AS s FROM econ_debts WHERE world_id = ? AND status = 'open' GROUP BY debtor"),
    };
    this.load();
    econ.dbs.onRollback(() => { /* the in-memory totals are only written by flush(); nothing to undo */ });
  }

  // ------------------------------------------------------------------------------------------- the day's totals
  load() {
    this.days.clear(); this.pending.clear();
    for (const r of this.q.pending.all(this.w)) {
      let j; try { j = JSON.parse(r.json); } catch { continue; }
      const D = this._day(r.day), [kind, id] = [r.key[0], r.key.slice(2)];
      if (kind === 'r') { D.res.set(id, j); this.pending.set(id, (this.pending.get(id) || 0) + spentOf(j)); } else if (kind === 'b') D.biz.set(id, j); else if (kind === 'a') D.alive = true;
    }
    this.lastSettled = this.q.lastDone.get(this.w)?.d ?? null;
  }
  _day(day) { let D = this.days.get(day); if (!D) this.days.set(day, D = { res: new Map(), biz: new Map(), alive: false }); return D; }
  /** The economy ran during day (called by the clock every second): a day it ran is settled, one it didn't is skipped. */
  touch(day) { const D = this._day(day); if (!D.alive) { D.alive = true; this.dirty.add(`${day}|a:run`); } }
  _res(day, pid) { const D = this._day(day); let R = D.res.get(pid); if (!R) D.res.set(pid, R = { s: {}, i: {}, h: 0, rh: 0, hm: 0 }); this.dirty.add(`${day}|r:${pid}`); return R; }
  _biz(day, id) { const D = this._day(day); let B = D.biz.get(id); if (!B) D.biz.set(id, B = { sales: 0, customers: 0, units: {}, psales: 0, pcustomers: 0, punits: {}, px: {} }); if (!B.punits) B.punits = {}; if (!B.px) B.px = {}; this.dirty.add(`${day}|b:${id}`); return B; }
  /** The price actually charged for n of an item (the price index's samples, spec 12: real sales, not price lists). */
  _px(B, item, price, n) { if (!(price > 0)) return; const m = B.px[item] || (B.px[item] = {}); m[price] = (m[price] || 0) + n; }
  /** Writes what changed since the last time (one transaction). */
  flush() {
    if (!this.dirty.size) return 0;
    const list = [...this.dirty];
    this.e.dbs.tx(() => {
      for (const k of list) {
        const [d, key] = [Number(k.slice(0, k.indexOf('|'))), k.slice(k.indexOf('|') + 1)], D = this.days.get(d);
        if (!D) continue;
        const v = key[0] === 'r' ? D.res.get(key.slice(2)) : key[0] === 'a' ? { alive: 1 } : D.biz.get(key.slice(2));
        if (v) this.q.putPending.run(this.w, d, key, JSON.stringify(v));
      }
    });
    for (const k of list) this.dirty.delete(k);   // only once written: a failed write is tried again next time
    return list.length;
  }
  /**
   * The economic day activity at sim time t counts in: its own, unless that day is settled already (the clock went back a
   * little after a crash, to its last save) — then the next open day, so nothing lands on a closed day.
   */
  dayFor(t) { const d = this.e.econDay(t); return this.lastSettled != null && d <= this.lastSettled ? this.lastSettled + 1 : d; }
  /** What a business sold today so far (residents and players), for its card. */
  todayOf(bizId) {
    const B = this.days.get(this.e.econDay())?.biz.get(bizId);
    return B ? { sales: B.sales + B.psales, customers: B.customers + B.pcustomers } : { sales: 0, customers: 0 };
  }
  /** A player's or agent's purchase, already paid: counted in the business's day. */
  notePlayerSale(bizId, amount, itemId, n = 1, price = 0) {
    const B = this._biz(this.dayFor(), bizId);
    B.psales += amount; B.pcustomers++; B.punits[itemId] = (B.punits[itemId] || 0) + n;
    this._px(B, itemId, price, n);
  }

  // ------------------------------------------------------------------------------------------- what residents can afford
  /**
   * An agent buys at a venue within its owner's limits (./agents.js), whoever sent it there — its own routine, Free Will or
   * an outside AI told to go back again and again: not while paused, not without the 'buy' scope, and not past its daily cap
   * with what it spent in the last 24 hours (payments and venue purchases together). Records the purchase it allows.
   */
  agentMayBuy(p, total) {
    const s = this.e.personSubject(p), A = this.e.parts.agents;
    if (!s || s.kind !== 'agent' || !A) return true;
    const L = A.limitsOf(s.id), now = this.e.now();
    if (L.paused || !L.scopes.includes('buy')) return false;
    const list = (this.agentVenue.get(s.id) || []).filter(x => x.at > now - 86400000);
    if (L.spent24h + list.reduce((n, x) => n + x.amount, 0) + total > L.dailyCap) { this.agentVenue.set(s.id, list); return false; }
    list.push({ at: now, amount: total }); this.agentVenue.set(s.id, list);
    if (this.agentVenue.size > 20000) this.agentVenue.delete(this.agentVenue.keys().next().value);
    return true;
  }
  available(p) {
    const s = this.e.personSubject(p); if (!s) return 0;
    const w = this.e.ledger.walletOf(s.kind, s.id, 'main');
    if (!w) return 0;
    return w.balance - w.held - (this.pending.get(p.id) || 0);
  }
  rentOf(p) {
    const h = p.home; if (!h) return 0;
    return this.flatRent(h.b, h.f, h.u).share;
  }
  /**
   * Whether resident a can go and buy at a venue of this kind. Essentials (a meal when hungry) need the price; anything
   * else also keeps a few nights' rent in hand. Free places (parks) always.
   */
  canSpend(a, kind, essential = false) {
    if (!VENUES.has(kind)) return true;
    const p = a.p, pol = this.e.policy(), menu = pol.menus[kind];
    // a café's or restaurant's visit: what one used to cost (a sandwich and coffee; a main course), at the city's food prices
    const top = VISIT_COST[kind] ? Math.round(VISIT_COST[kind] * (pol.food?.pricePct ?? 100) / 100) : menu?.length ? Math.max(...menu.map(m => m.price)) : 0;
    if (!top) return true;
    const price = top * 1.3;
    const keep = essential ? 0 : this.rentOf(p) * Math.max(1, pol.households.thriftyDays);
    return this.available(p) >= price + keep;
  }
  /** Demand v1 (spec 02 §7): a venue's weight against distance — dearer and worse-rated venues seem farther away. */
  venueFactor(b, f) {
    const biz = this.e.parts.businesses?.at(b, f);
    if (!biz) return 1;
    const price = this.e.parts.businesses.priceLevel(biz), rating = Math.max(100, biz.rating || 350) / 350;
    return Math.max(0.35, Math.min(3, Math.pow(price, 1.2) / Math.pow(rating, 0.8)));
  }

  // ------------------------------------------------------------------------------------------- the simulation's reports
  /**
   * The simulation planned an activity for resident a (server/sim/agents.js act()). Work adds hours; a meal, a coffee,
   * a gym session or a shopping trip at a venue is a purchase; a meal at home uses groceries.
   */
  onAct(a, act) {
    const p = a.p;
    if (!p || p.retired) return;
    const sim = this.e.d.sim(); if (!sim) return;
    const t = act.holdStart, day = this.dayFor(t);
    if (act.kind === 'work' || act.kind === 'post') {
      const hrs = Math.max(0, act.holdEnd - act.holdStart) * sim.clock.dayScale / 3600;
      if (!(hrs > 0)) return;
      const R = this._res(day, p.id);
      // on post (an AI agent its owner posted at a desk or counter around the clock — server/agent-posts/): it works
      // there instead of at its job, and is paid for it (2026-10-14, the product owner: "they don't get paid") — below
      if (act.kind === 'post') { if (p.job?.kind === 'remote') R.rh = round2(R.rh + hrs); else R.ph = round2((R.ph || 0) + hrs); return; }
      if (p.job?.kind === 'remote') R.rh = round2(R.rh + hrs);
      else if (p.job && act.b === p.job.b) R.h = round2(R.h + hrs);
      if (act.use !== 'work' || act.b < 0) return;   // remote work at a café: a coffee as well (below)
    }
    if (act.b < 0) return;
    const W = this.e.d.world(), B = W.buildings[act.b], L = B && W.levels[B.lv?.[act.f]];
    if (p.home && act.kind === 'meal' && act.b === p.home.b && act.f === p.home.f) { this._res(day, p.id).hm++; return; }
    const venue = L?.venue;
    if (!VENUES.has(venue)) return;
    const items = this.basket(p.id, t, venue, act);
    if (!items.length) return;
    const biz = this.e.parts.businesses?.at(act.b, act.f);
    if (!biz) return;
    // one purchase per visit: the order and the meal of one visit are one bill
    const last = this.lastBuy.get(p.id), gap = 45 * 60 / sim.clock.dayScale;
    if (last && last.biz === biz.id && Math.abs(t - last.t) < gap) return;
    const bz = this.e.parts.businesses;
    let total = 0;
    const lines = [];
    for (const id of items) { const price = bz.priceOf(biz, id); if (price) { total += price; lines.push(id); } }
    if (!total || this.available(p) < total) return;   // they can't afford it: no sale (soft)
    if (!this.agentMayBuy(p, total)) return;            // an agent past its owner's limits: no sale (soft)
    this.lastBuy.set(p.id, { biz: biz.id, t });
    const R = this._res(day, p.id), Bx = this._biz(day, biz.id);
    R.s[biz.id] = (R.s[biz.id] || 0) + total;
    for (const id of lines) { R.i[id] = (R.i[id] || 0) + 1; Bx.units[id] = (Bx.units[id] || 0) + 1; this._px(Bx, id, bz.priceOf(biz, id), 1); }
    Bx.sales += total; Bx.customers++;
    this.pending.set(p.id, (this.pending.get(p.id) || 0) + total);
    let rc = this.receipts.get(p.id);
    if (!rc) this.receipts.set(p.id, rc = []);
    rc.push({ t, at: this.e.now(), biz: biz.name, kind: biz.kind, total, items: lines });
    if (rc.length > RECEIPTS) rc.shift();
    this.e.parts.stats?.noteSale?.(biz, total, act);
    // a real customer: their order waits for whoever works there (./jobs.js)
    this.e.parts.jobs?.ticket?.(biz, { kind: 'resident', id: p.id, name: p.name }, lines, `visit:${p.id}:${Math.round(t)}`);
  }
  /** The ids a café or restaurant at (b, f) sells (the simulation orders from it: server/sim/agents.js order()), or null. */
  menuAt(b, f) {
    const bz = this.e.parts.businesses, biz = bz?.at(b, f);
    return biz && (biz.kind === 'cafe' || biz.kind === 'restaurant') ? bz.menuIdsOf(biz) : null;
  }
  /** What a resident buys on this visit (deterministic per resident and time, so replays agree): what the simulation had
   *  them order (act.order: shown on their table), else the old fixed baskets (shops, gyms). */
  basket(pid, t, venue, act) {
    // a night out (arcades, lounges, clubs): tokens to play; the drinks they had; at a club the cover, and now and then a
    // table's bottle service in a VIP booth
    if (venue === 'arcade') return ['game_tokens', ...(r01(pid, t, 'n') < 0.3 ? ['game_tokens'] : []), ...(Array.isArray(act.order) ? act.order : [])];
    if (venue === 'lounge_bar') return Array.isArray(act.order) && act.order.length ? act.order : ['red_wine'];
    if (venue === 'club') return ['cover', ...(Array.isArray(act.order) && act.order.length ? act.order : ['beer']), ...(act.vip && r01(pid, t, 'v') < 0.25 ? ['bottle_service'] : [])];
    if (Array.isArray(act.order)) return act.order;
    const u = act.use;
    if (venue === 'cafe') {
      if (act.kind === 'meal') return r01(pid, t, 'c') < 0.6 ? ['cafe_lunch'] : ['coffee', 'pastry'];
      if (u === 'cafe' || u === 'coffee' || u === 'work') return r01(pid, t, 'p') < 0.35 ? ['coffee', 'pastry'] : ['coffee'];
      return [];
    }
    if (venue === 'restaurant') {
      if (act.kind === 'bar' || u === 'bar') return r01(pid, t, 'b') < 0.4 ? ['drink', 'drink'] : ['drink'];
      if (act.kind !== 'meal') return [];
      const out = ['meal'];
      if (r01(pid, t, 'd') < 0.5) out.push('drink');
      if (r01(pid, t, 's') < 0.2) out.push('dessert');
      return out;
    }
    if (venue === 'shop') return u === 'buy' ? [r01(pid, t, 'g') < 0.45 ? 'groceries' : 'goods'] : [];
    if (venue === 'gym') return act.kind === 'gym' ? ['session'] : [];
    return [];
  }

  // ------------------------------------------------------------------------------------------- rent and land
  landFactor(bIdx) {
    if (this.landCache.has(bIdx)) return this.landCache.get(bIdx);
    const W = this.e.d.world(), B = W.buildings[bIdx], pol = this.e.policy();
    let pct = 100;
    if (B && W.grid) {
      const g = makeGrid(W.grid);
      const env = { centre: g.empty ? null : { x: (g.minX + g.maxX) / 2, z: (g.minZ + g.maxZ) / 2 },   // (no city: no downtown)
        parks: W.buildings.filter(x => x && !x.gone && x.type === 'park').map(x => ({ x: x.x, z: x.z })),
        stations: (W.stations || []).filter(s => Number.isFinite(s.x)).map(s => ({ x: s.x, z: s.z })) };
      const v = landValue(B.x, B.z, env, landCfg).score;   // 0..100 (no water/view on the server: an estimate)
      pct = Math.round(pol.rent.landMinPct + (pol.rent.landMaxPct - pol.rent.landMinPct) * Math.min(1, v / 75));
    }
    this.landCache.set(bIdx, pct);
    return pct;
  }
  /**
   * A flat's rent a night and who receives it. A flat its owner rents out in VC charges its rent (a month, whole VC) / 30;
   * otherwise the policy's rent for its size × the land factor. The landlord: a flat sold to a player is theirs, else
   * the building's lot holder (the city's treasury for city land). Shared between whoever lives there.
   */
  flatRent(b, f, u) {
    const W = this.e.d.world(), B = W.buildings[b], pol = this.e.policy();
    const rec = W.flats?.[`${b}:${f}:${u}`] || null;
    let rent;
    if (rec?.deal === 'rented' && Number(rec.rent) > 0) rent = Math.floor(Number(rec.rent) * 100 / 30);
    else {
      const kind = W.levels[B?.lv?.[f]]?.units?.[u]?.kind;
      rent = Math.floor((pol.rent[kind] ?? pol.rent.larger) * this.landFactor(b) / 100);
    }
    let landlord;
    if (rec?.deal === 'sold' && rec.owner?.kind === 'account') landlord = subj('account', rec.owner.id);
    else { const o = this.e.parts.businesses.ownerOfBuilding(B); landlord = o.kind === 'municipality' ? subj('city', 'city') : subj(o.kind, o.id); }
    return { rent, share: rent, landlord, rec };
  }

  /** The economy was just switched on: the first day settled is the current one (nothing before it is owed). */
  genesisDone() {
    const today = this.e.econDay();
    this.touch(today);
    if (this.lastSettled === null) {
      this.q.putDay.run({ w: this.w, day: today - 1, status: 'done', at: this.e.now(), fin: this.e.now(), sum: JSON.stringify({ genesis: true }) });
      this.lastSettled = today - 1;
    }
  }

  // ------------------------------------------------------------------------------------------- the daily settlement
  /**
   * Settles the economic days that have ended and aren't settled, in order, at most policy settlement.maxDaysPerTick
   * per call (the clock calls again next second). A run of days without any activity (the server was off) is recorded
   * as one skipped stretch. Returns the days settled or skipped.
   */
  catchUp() {
    if (!this.e.enabled() || this.e.paused() || this.settling) return [];
    const today = this.e.econDay(), max = this.e.policy().settlement.maxDaysPerTick;
    const out = [];
    let from = this.lastSettled === null ? today - 1 : this.lastSettled + 1;
    // days with pending purchases that ended before the last settled one (a clock moved back) are settled too
    for (const d of this.days.keys()) if (d < today && d < from && !this.q.dayRow.get(this.w, d)) from = d;
    const active = [...this.days.keys()].filter(d => d >= from && d < today && this._lived(d)).sort((a, b) => a - b);
    let d = from;
    while (d < today && out.length < max) {
      const st = this.q.dayRow.get(this.w, d)?.status;
      if (st === 'done' || st === 'skipped') { d++; continue; }
      if (this._lived(d)) { out.push(this.settle(d)); d++; continue; }
      // nothing happened from d up to the next lived day (or yesterday): one skipped stretch
      const next = active.find(x => x > d), to = (next ?? today) - 1;
      this.q.putDay.run({ w: this.w, day: to, status: 'skipped', at: this.e.now(), fin: this.e.now(), sum: JSON.stringify({ skipped: true, from: d, to, why: 'the world was not running' }) });
      if (to - d > 0) this.e.log(`[economy] days ${d}–${to} skipped: the world was not running`);
      this.lastSettled = Math.max(this.lastSettled ?? to, to);
      out.push({ day: to, skipped: { from: d, to } });
      d = to + 1;
    }
    return out;
  }
  /** Whether anything happened on day d (residents acted, someone bought): a day the world ran. */
  _lived(d) { const D = this.days.get(d); return !!D && (D.alive || D.res.size > 0 || D.biz.size > 0); }
  /** Settles economic day `day` (one database transaction). Returns its summary. */
  /**
   * AI agents' pay for a settled day (2026-10-23, the product owner: wages "from the business's own wallet, that way users
   * are kinda forced or atleast encouraged to make profitable businesses"; "unpaid for days" the agent quits): an agent its
   * employer paid less than half of what it earned has an unpaid day (p.unpaid, by employer); a day paid resets it.
   * After policy agents.quitAfterDays in a row it quits — its owner told, and it keeps away from that employer for
   * agents.avoidDays (the server: d.agentQuit, server/sim/placement.js) — but only work it chose itself: on a post or at
   * work its owner gave it, it stays and tells its owner it isn't being paid, then again every agents.quitAfterDays
   * days while it lasts (d.agentUnpaid; 2026-10-23: "if an agent is on an assigned post they cannot quit ... if the agent
   * gets assigned by the owner to a job ... the agent can send the message about them not having money").
   */
  /**
   * A position's pay (2026-10-28, the product owner: "every post should have a Pay"; "for world modules (admin controlled)
   * the city pays. now for private/account businesses then the buisness or owner pays"): for seat k of piece id on floor f
   * of building b → { payer: 'business' | 'city' | 'owner', name, rate (cents an hour now), usual (its role's wage there),
   * set (its owner chose the rate), min, max }; null when the economy is off or there is no such piece. The settlement
   * (plan below: payFor) pays the same: whoever works there, an agent or a resident.
   */
  payInfo(b, f, id, k) {
    const e = this.e;
    if (!e.enabled?.()) return null;
    const W = e.d.world(), B = W?.buildings?.[b], L = B ? W.levels[B.lv?.[f]] : null, it = L?.items.find(x => x.id === id);
    if (!it) return null;
    // (by the seat's own use, as its worker's job is: a venue's staff — at a counter, a coffee machine, a stage — its
    // business; a reception or a desk, the building's company)
    const pol = e.policy(), bz = e.parts.businesses, use = e.d.sim?.()?.index?.entry(b, f, id)?.slots?.[k]?.use;
    const staff = use ? use === 'staff' || use === 'cook' : isServiceDesk(it.t);   // (a kitchen's cook: its venue's staff, 2026-10-28)
    const own = W.postPay?.[`${b}:${f}:${id}:${k}`], set = Number.isSafeInteger(own) && own >= 0;
    const max = Math.max(...Object.values(pol.wages)) * 10;
    let biz = null, role = staff ? 'receptionist' : 'office';
    if (staff && L.venue && L.venue !== 'lobby' && VENUES.has(L.venue)) { biz = bz.at(b, f); role = pol.staffRole[L.venue] || 'cashier'; }
    if (!biz) biz = bz.companyOf(b);
    if (biz) { const usual = bz.wageOf(biz, role); return { payer: 'business', name: biz.name, rate: set ? own : usual, usual, set, min: pol.minWage, max }; }
    const usual = pol.wages[role] ?? pol.minWage;
    if (B.module) return { payer: 'city', name: 'the city', rate: set ? own : usual, usual, set, min: pol.minWage, max };
    return { payer: 'owner', name: 'the owner', rate: set ? own : 0, usual, set, min: pol.minWage, max, free: true };   // (free: unpaid allowed, the place's own owner paying)
  }
  agentPay(list) {
    const pol = this.e.policy(), after = pol.agents?.quitAfterDays ?? 3, avoid = pol.agents?.avoidDays ?? 7;
    const touched = [], quits = [], notes = [];
    for (const x of list) {
      const p = x.p, short = x.paid * 2 < x.gross;
      if (!short) { if (p.unpaid) { delete p.unpaid; touched.push(p); } continue; }
      const u = p.unpaid?.biz === x.biz.id ? p.unpaid : { biz: x.biz.id, b: x.biz.b, name: x.biz.name, days: 0 };
      u.days++; p.unpaid = u; touched.push(p);
      if (u.days < after) continue;
      if (p.post || p.job?.pin) { if ((u.days - after) % after === 0) notes.push({ p, biz: x.biz, days: u.days, post: !!p.post }); }   // (its owner's choice: it stays)
      else quits.push({ p, biz: x.biz, days: u.days, avoid });
    }
    try {
      if (touched.length) this.e.d.peopleChanged?.(touched);
      for (const q of quits) { delete q.p.unpaid; this.e.d.agentQuit?.(q); }
      for (const n of notes) this.e.d.agentUnpaid?.(n);
    } catch (e) { this.e.log.warn?.('[economy] agents\' pay:', e.message); }
    return quits.length;
  }
  settle(day) {
    if (this.q.dayRow.get(this.w, day)?.status === 'done') return { day, already: true };
    this.settling = true;
    const t0 = performance.now();
    try {
      this.flush();
      const plan = this.plan(day);
      this.e.dbs.tx(() => {
        this.post(day, plan);
        this.e.parts.realty?.applyLeases(plan.leases || []);
        for (const [id, r] of plan.books) this.q.bizDay.run({ w: this.w, biz: id, day, ...r, detail: r.detail ? JSON.stringify(r.detail) : null });
        for (const dbt of plan.debts) this.q.addDebt.run({ id: dbt.id, w: this.w, debtor: dbt.debtor, creditor: dbt.creditor, kind: dbt.kind, amount: dbt.amount, ref: dbt.ref, at: this.e.now() });
        for (const pay of plan.debtPays) this.q.payDebt.run({ w: this.w, id: pay.id, amount: pay.left, status: pay.left > 0 ? 'open' : 'paid', at: this.e.now() });
        this.e.parts.stats?.recordDay?.(day, plan);
        this.q.putDay.run({ w: this.w, day, status: 'done', at: this.e.now(), fin: this.e.now(), sum: JSON.stringify(plan.summary) });
        this.q.dropPending.run(this.w, day);
        // what follows from the day commits with it, so a crash can never leave it half done
        this.e.parts.city?.afterDay?.(day, plan);
        this.e.parts.businesses?.autoPrice?.(day, plan.books);
        this.e.parts.jobs?.afterDay?.(day, plan);
      });
      // what was promised for that day is now in the wallets
      const D = this.days.get(day);
      if (D) for (const [pid, R] of D.res) { const left = (this.pending.get(pid) || 0) - spentOf(R); if (left > 0) this.pending.set(pid, left); else this.pending.delete(pid); }
      this.days.delete(day);
      for (const k of [...this.dirty]) if (k.startsWith(`${day}|`)) this.dirty.delete(k);
      this.lastSettled = Math.max(this.lastSettled ?? day, day);
      const ms = Math.round(performance.now() - t0);
      this.e.log(`[economy] day ${day} settled: ${plan.wallets.size} wallets, ${fmt(plan.summary.volume)} VC moved (${ms} ms)`);
      this.e.parts.realty?.endLeasesDue();   // tenants past their grace move out (the world's edit, after the commit)
      this.agentPay(plan.agentPay || []);
      this.e.bump();
      return { day, ms, summary: plan.summary };
    } finally { this.settling = false; }
  }

  /**
   * The plan for a day: every wallet's net change with its itemised note, the businesses' books, debts and the
   * summary. Pure arithmetic on the day's totals and the wallets' current balances; nothing is written here.
   */
  plan(day) {
    const e = this.e, pol = e.policy(), W = e.d.world(), people = e.d.people() || [], bz = e.parts.businesses, L = e.ledger;
    const market = e.parts.market, prices = market ? market.pricesFor(day) : Object.fromEntries(Object.entries(pol.commodities).map(([k, c]) => [k, c.base]));
    const exportPct = market ? market.exportPct(day) : 100;
    const D = this.days.get(day) || { res: new Map(), biz: new Map() };
    const wallets = new Map();   // wallet id → { amount, parts: [[label, amount]] }
    const avail = id => { const w = L.wallet(id); return w.overdraft ? Infinity : w.status !== 'active' ? 0 : w.balance - w.held; };
    const add = (id, label, amount) => {
      if (!amount) return;
      let x = wallets.get(id); if (!x) wallets.set(id, x = { amount: 0, parts: new Map() });
      x.amount += amount; x.parts.set(label, (x.parts.get(label) || 0) + amount);
    };
    const room = id => avail(id) + (wallets.get(id)?.amount || 0);   // what a wallet could still pay out
    const T = e.treasury().id, sinkImports = e.sink('imports').id, sinkUpkeep = e.sink('upkeep').id, sinkOrd = e.sink('ordinances').id, fExports = e.faucet('exports').id;
    const sum = { day, sales: 0, customers: 0, wages: 0, owedWages: 0, exports: 0, remote: 0, imports: 0, rent: 0, rentCity: 0, rentOwed: 0, assistance: 0, welfare: 0, welfareCut: 0,
      taxIncome: 0, taxSales: 0, taxExports: 0, taxProfit: 0, dividends: 0, upkeep: 0, ordinances: 0, support: 0, works: 0, employed: 0, unemployed: 0, residents: 0, brackets: {}, volume: 0, perKind: {} };
    const books = new Map(), debts = [], debtPays = [];
    const book = id => { let r = books.get(id); if (!r) books.set(id, r = { sales: 0, customers: 0, units: 0, cogs: 0, wages: 0, rent: 0, tax: 0, upkeep: 0, other: 0, profit: 0, owed: 0, detail: { items: {} } }); return r; };
    const rid = () => `debt_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    // 1. what residents spent at businesses, and the groceries for meals at home (the day's totals are copied: planning
    // changes nothing)
    const units = new Map([...D.biz].map(([id, Bx]) => [id, { ...Bx.units }]));
    const spentBy = new Map(), shopFor = this._shopFinder(W);
    const customersOf = new Map();   // business → some residents who really bought there (their reviews, ./jobs.js)
    for (const p of people) {
      if (!p || p.retired) continue;
      const R = D.res.get(p.id);
      const items = { ...(R?.i || {}) }, spend = { ...(R?.s || {}) };
      if (R?.hm && pol.households.mealsPerBag > 0 && p.home) {
        const shop = shopFor(p.home.b);
        if (shop) {
          const price = bz.priceOf(shop, 'groceries') || 0, n = Math.min(2, Math.ceil(R.hm / pol.households.mealsPerBag));
          if (price && n) { spend[shop.id] = (spend[shop.id] || 0) + price * n; items.groceries = (items.groceries || 0) + n; const u = units.get(shop.id) || {}; u.groceries = (u.groceries || 0) + n; units.set(shop.id, u); book(shop.id).customers++; }
        }
      }
      const s = e.personSubject(p); if (!s) continue;
      const w = e.walletFor(s, 'main');
      let total = Object.values(spend).reduce((a, b) => a + b, 0);
      if (!total) continue;
      // a resident never pays more than their wallet holds (an administrator may have moved money meanwhile)
      const can = Math.max(0, avail(w.id) + (wallets.get(w.id)?.amount || 0)), k = total > can ? can / total : 1;
      for (const [bid, amt] of Object.entries(spend)) {
        const biz = bz.get(bid); if (!biz) continue;
        const paid = Math.floor(amt * k); if (!paid) continue;
        add(w.id, 'spent', -paid);
        add(bz.wallet(biz).id, 'sales', paid);
        book(biz.id).sales += paid;
        const cs = customersOf.get(biz.id) || []; if (cs.length < 20) { cs.push(p.id); customersOf.set(biz.id, cs); }
        spentBy.set(w.id, (spentBy.get(w.id) || 0) + paid);
        total -= amt;
      }
    }
    // 1b. residents with savings above their target spend part of the excess: household goods from the nearest shop,
    // the rest abroad (trips, online orders: a sink). This is what keeps savings from piling up forever.
    const hh = pol.households, dailyIncome = p => {
      const j = p.job || {};
      if (j.kind === 'free') return pol.welfare[pol.welfareOf[j.title] || 'allowance'] || 0;
      const role = j.kind === 'office' ? 'office' : j.kind === 'vip' ? 'vip' : j.kind === 'remote' ? null : j.role || pol.staffRole[j.venue] || 'cashier';
      return Math.floor((role ? pol.wages[role] || pol.minWage : pol.exports.remotePerHour) * Math.max(0, Math.min(12, (j.end || 0) - (j.start || 0))));
    };
    if (hh.excessSpendPct > 0) for (const p of people) {
      if (!p || p.retired || p.vip || !p.home) continue;
      const s = e.personSubject(p), w = s && e.ledger.walletOf(s.kind, s.id, 'main');
      if (!w) continue;
      const excess = room(w.id) - hh.savingsTargetDays * Math.max(2000, dailyIncome(p));
      if (excess <= 0) continue;
      const amt = Math.min(hh.excessSpendCap, Math.floor(excess * hh.excessSpendPct / 100));
      if (amt < 100) continue;
      const abroad = Math.floor(amt * hh.abroadPct / 100), local = amt - abroad, shop = shopFor(p.home.b);
      if (abroad > 0 || !shop) { const a2 = shop ? abroad : amt; add(w.id, 'trips and online shopping', -a2); add(sinkImports, 'spent abroad', a2); sum.abroad = (sum.abroad || 0) + a2; }
      if (shop && local > 0) {
        add(w.id, 'household goods', -local); add(bz.wallet(shop).id, 'sales', local); book(shop.id).sales += local; book(shop.id).customers++;
        const price = bz.priceOf(shop, 'goods') || 1200, u = units.get(shop.id) || {}; u.goods = (u.goods || 0) + Math.max(1, Math.round(local / price)); units.set(shop.id, u);
      }
    }
    for (const [bid, Bx] of D.biz) { const r = book(bid); r.customers += Bx.customers + (Bx.pcustomers || 0); r.sales += Bx.psales || 0; for (const [it, n] of Object.entries(Bx.punits || {})) { r.units += n; r.detail.items[it] = (r.detail.items[it] || 0) + n; } }
    for (const [bid, u] of units) { const r = book(bid); for (const [it, n] of Object.entries(u)) { r.units += n; r.detail.items[it] = (r.detail.items[it] || 0) + n; } }

    // 2. businesses: what they bought on the market for what residents ate and used, sales tax; companies' export revenue
    const hoursAt = new Map();   // company id → worker hours
    const jobOf = p => {
      const j = p.job; if (!j) return null;
      if (j.kind === 'office' || j.kind === 'vip') { const c = bz.companyOf(j.b); return c ? { biz: c, role: j.kind === 'vip' ? 'vip' : 'office' } : null; }
      if (j.kind === 'staff') {
        if (j.venue === 'lobby') { const c = bz.companyOf(j.b); return c ? { biz: c, role: 'receptionist' } : null; }
        const v = bz.at(j.b, j.f); return v ? { biz: v, role: j.role || pol.staffRole[j.venue] || 'cashier' } : null;
      }
      return null;
    };
    const shiftHours = p => { const j = p.job; if (!j || !(j.end > j.start)) return 0; return Math.min(16, j.end - j.start) + 0.5; };
    // an agent on post without a job of its own: the business where it serves employs it — a venue's staff, a company's
    // reception or office — for a full day's shift
    const POST_SHIFT = 8.5;
    const postJobOf = p => {
      const r = p.post; if (!r) return null;
      const W = e.d.world(), B = W.buildings[r.b], venue = B && W.levels[B.lv?.[r.f]]?.venue, it = B && W.levels[B.lv[r.f]]?.items.find(x => x.id === r.id);
      const v = bz.at(r.b, r.f);
      if (v && VENUES.has(venue)) return { biz: v, role: pol.staffRole[venue] || 'cashier' };
      const c = bz.companyOf(r.b);
      return c ? { biz: c, role: /reception|lobby/.test(it?.t || '') || venue === 'lobby' ? 'receptionist' : 'office' } : null;
    };
    // the position worked (2026-10-28, the product owner: "every post should have a Pay ... the user picks a payment amount
    // for that post/position"): its own rate when its owner set one (world.postPay "b:f:id:k" → cents an hour, set from the
    // piece's ⋯ menu: server/agent-posts/ setPay), else the usual wage; and who pays it: the business there; with none, a
    // world module's (run by the administrators) the city, else whoever owns the place (the lot's holder, a flat's owner),
    // and that only at a rate they set (else no one: unpaid, as before)
    const Wd = e.d.world(), PAY = Wd?.postPay || {};
    const seatOf = p => { const j = p.job; return j && j.b !== undefined && j.id !== undefined && (j.kind === 'office' || j.kind === 'vip' || j.kind === 'staff') ? j : p.post || null; };
    const keyOf = r => `${r.b}:${r.f}:${r.id}:${r.k}`;
    const payers = new Map();   // payer key → { key, wallet, name, biz? }
    const payerOf = (k, make) => { let x = payers.get(k); if (!x) payers.set(k, x = make()); return x; };
    const placeOwner = (b, f, id) => {
      const B = Wd?.buildings?.[b]; if (!B) return null;
      const L = Wd.levels[B.lv?.[f]], it = L?.items.find(x => x.id === id);
      const u = it ? (L.units || []).findIndex(U => U && it.x >= U.x0 && it.x <= U.x1 && it.z >= U.z0 && it.z <= U.z1) : -1;
      const rec = u >= 0 ? Wd.flats?.[`${b}:${f}:${u}`] : null;
      if (rec?.owner?.kind === 'account') return subj('account', rec.owner.id);
      const o = bz.ownerOfBuilding(B); return o.kind === 'municipality' ? null : subj(o.kind, o.id);
    };
    /** { payer, rate (cents an hour) } for person p working at seat r for business jb (or none). */
    const payFor = (p, r, jb) => {
      const own = r ? PAY[keyOf(r)] : undefined, set = Number.isSafeInteger(own) && own >= 0;
      if (jb) return { payer: payerOf(`biz:${jb.biz.id}`, () => ({ key: `biz:${jb.biz.id}`, wallet: bz.wallet(jb.biz).id, name: jb.biz.name, biz: jb.biz })), rate: set ? own : bz.wageOf(jb.biz, jb.role) };
      if (!r) return null;
      const B = Wd?.buildings?.[r.b], it = B ? Wd.levels[B.lv?.[r.f]]?.items.find(x => x.id === r.id) : null;
      const use = e.d.sim?.()?.index?.entry(r.b, r.f, r.id)?.slots?.[r.k]?.use, role = (use ? use === 'staff' : it && isServiceDesk(it.t)) ? 'receptionist' : 'office';
      if (B?.module) return { payer: payerOf('city', () => ({ key: 'city', wallet: T, name: 'the city', city: true })), rate: set ? own : pol.wages[role] ?? pol.minWage };
      if (!set || own <= 0) return null;
      const o = placeOwner(r.b, r.f, r.id); if (!o) return null;
      const k = `own:${subjKey(o)}`;
      return { payer: payerOf(k, () => ({ key: k, wallet: e.walletFor(o, 'main').id, name: e.nameOf(o) })), rate: own };
    };
    const work = [];   // { p, w, payer, rate, role, hours, b }
    // the hours players and agents worked at a venue in its residents' place: those residents aren't paid for them
    const covered = e.parts.jobs?.covered(day) || new Map();
    for (const p of people) {
      if (!p || p.retired) continue;
      const R = D.res.get(p.id), own = jobOf(p), jb = own || (R?.ph ? postJobOf(p) : null), seat = seatOf(p);
      // hours on post count as its job's (its employer pays them, up to its shift); without a job, the post's place pays,
      // for the hours it was on duty (on post around the clock: up to all of them)
      const worked = (own ? R?.h || 0 : 0) + (R?.ph || 0);
      if (!(worked > 0)) continue;
      const pay = payFor(p, own ? seat : p.post || seat, jb);
      if (!pay || !(pay.rate > 0)) continue;
      let hours = Math.min(worked, own ? shiftHours(p) : p.post ? 24 : POST_SHIFT);
      const c = jb && jb.biz.f !== -1 ? covered.get(jb.biz.id) || 0 : 0;
      if (c > 0) { const cut = Math.min(c, hours); hours -= cut; covered.set(jb.biz.id, c - cut); sum.covered = (sum.covered || 0) + cut; }
      if (!(hours > 0)) continue;
      const s = e.personSubject(p); if (!s) continue;
      const r = own ? seat : p.post || seat;
      work.push({ p, w: e.walletFor(s, 'main'), payer: pay.payer, rate: pay.rate, role: jb?.role || null, hours, b: r?.b ?? -1 });
      if (jb && jb.biz.f === -1) hoursAt.set(jb.biz.id, (hoursAt.get(jb.biz.id) || 0) + hours);
    }
    for (const biz of bz.open()) {
      const bw = bz.wallet(biz).id, r = book(biz.id);
      // the stock for what residents bought (players' purchases bought theirs when they paid)
      let cogs = 0;
      for (const [it, n] of Object.entries(units.get(biz.id) || {})) {
        const inputs = bz.inputsOf(biz, it); if (!inputs) continue;
        for (const [c, q] of Object.entries(inputs)) cogs += n * q * (prices[c] ?? pol.commodities[c]?.base ?? 0);
      }
      cogs = Math.floor(cogs);
      const residentSales = (wallets.get(bw)?.parts.get('sales')) || 0;
      if (cogs > 0) { const c = Math.min(cogs, Math.max(0, room(bw))); add(bw, 'stock', -c); add(sinkImports, 'imports', c); r.cogs += c; sum.imports += c; }
      const st = bp(residentSales, pol.taxes.sales);
      if (st > 0) { const c = Math.min(st, Math.max(0, room(bw))); add(bw, 'sales tax', -c); add(T, 'sales tax', c); r.tax += c; sum.taxSales += c; }
      if (biz.f === -1) {
        const h = hoursAt.get(biz.id) || 0, rev = Math.floor(h * pol.exports.officePerHour * exportPct / 100);
        if (rev > 0) { add(fExports, 'exports', -rev); add(bw, 'export revenue', rev); r.sales += rev; sum.exports += rev; const tx = bp(rev, pol.taxes.exports); add(bw, 'business tax', -tx); add(T, 'business tax', tx); r.tax += tx; sum.taxExports += tx; }
      }
    }

    // 3. wages, paid pro rata by a business short of money (the rest is owed); income tax withheld
    const bill = new Map();
    for (const x of work) { x.gross = Math.floor(x.hours * x.rate); bill.set(x.payer.key, (bill.get(x.payer.key) || 0) + x.gross); }
    const ratio = new Map();
    for (const [pk, total] of bill) {
      const P = payers.get(pk), bw = P.wallet, biz = P.biz;
      let can = Math.max(0, room(bw));
      // the city stands behind the businesses it owns
      if (biz && can < total && biz.owner_kind === 'municipality') { const help = Math.min(total - can, Math.max(0, room(T))); if (help > 0) { add(T, 'business support', -help); add(bw, 'city support', help); can += help; sum.support += help; } }
      ratio.set(pk, total > 0 ? Math.min(1, can / total) : 1);
    }
    const income = new Map();   // wallet → taxable income today
    const agentPay = [];        // an AI agent's pay today: whether its employer could pay it (agentPay below)
    for (const x of work) {
      const P = x.payer, bw = P.wallet, paid = Math.floor(x.gross * ratio.get(P.key)), owed = x.gross - paid;
      // (who it is owed by, for its owner's notes: the business, the city, the owner of the place)
      if (x.p.vip && x.p.agentId && x.gross > 0) agentPay.push({ p: x.p, biz: P.biz || { id: P.key, b: x.b, name: P.name }, gross: x.gross, paid });
      if (paid > 0) { add(bw, 'wages', -paid); add(x.w.id, 'wages', paid); if (P.biz) book(P.biz.id).wages += paid; sum.wages += paid; income.set(x.w.id, (income.get(x.w.id) || 0) + paid); }
      if (owed > 0) { debts.push({ id: rid(), debtor: bw, creditor: x.w.id, kind: 'wages', amount: owed, ref: `day:${day}` }); if (P.biz) book(P.biz.id).owed += owed; sum.owedWages += owed; }
    }
    // 4. remote work sold abroad, benefits for those without work
    let welfareWant = 0;
    const welfare = [];
    for (const p of people) {
      if (!p || p.retired) continue;
      const s = e.personSubject(p); if (!s) continue;
      sum.residents++;
      const w = e.walletFor(s, 'main'), R = D.res.get(p.id), j = p.job || { kind: 'free' };
      if (j.kind === 'remote' && R?.rh) {
        const amt = Math.floor(Math.min(R.rh, shiftHours(p)) * pol.exports.remotePerHour * exportPct / 100);
        if (amt > 0) { add(fExports, 'exports', -amt); add(w.id, 'remote work', amt); income.set(w.id, (income.get(w.id) || 0) + amt); sum.remote += amt; sum.exports += amt; }
      }
      if (j.kind === 'free' && !p.vip) {
        const k = pol.welfareOf[j.title] || 'allowance', amt = pol.welfare[k] || 0;
        if (amt > 0) { welfare.push({ w, amt, k }); welfareWant += amt; }
        sum.unemployed += k === 'unemployed' ? 1 : 0;
      } else if (j.kind !== 'free') sum.employed++;
    }
    // income tax on the day's wages and remote income, by bracket
    for (const [wid, inc] of income) {
      const tax = incomeTax(pol, inc);
      if (tax > 0) { add(wid, 'income tax', -tax); add(T, 'income tax', tax); sum.taxIncome += tax; }
      const br = bracketOf(pol, inc); sum.brackets[br] = (sum.brackets[br] || 0) + 1;
    }

    // 5. rent: every resident pays their share of their flat's rent to its landlord; short, the housing assistance
    // ordinance covers part and the rest is owed. Players and agents who rent flats in VC pay too (./leases.js).
    const occupants = new Map();   // flat key → residents living there
    for (const p of people) { if (!p || p.retired || !p.home) continue; const k = `${p.home.b}:${p.home.f}:${p.home.u}`; occupants.set(k, (occupants.get(k) || 0) + 1); }
    const assist = pol.ordinances.housingAssist, rentNights = [], seenFlat = new Set();
    for (const p of people) {
      if (!p || p.retired || !p.home) continue;
      const s = e.personSubject(p); if (!s) continue;
      const fr = this.flatRent(p.home.b, p.home.f, p.home.u);
      if (!fr.landlord || !fr.rent) continue;
      const fk = `${p.home.b}:${p.home.f}:${p.home.u}`;
      if (!seenFlat.has(fk)) { seenFlat.add(fk); rentNights.push(fr.rent); }
      const due = Math.floor(fr.rent / (occupants.get(`${p.home.b}:${p.home.f}:${p.home.u}`) || 1));
      if (!due) continue;
      const w = e.walletFor(s, 'main');
      const lw = fr.landlord.kind === 'city' ? T : e.walletFor(fr.landlord, 'main').id;
      if (lw === w.id) continue;   // a landlord living in their own flat
      const paid = Math.max(0, Math.min(due, room(w.id)));
      if (paid > 0) { add(w.id, 'rent', -paid); add(lw, 'rent', paid); sum.rent += paid; if (lw === T) sum.rentCity += paid; }
      let short = due - paid;
      if (short > 0 && assist.on) {
        const help = Math.min(Math.floor(due * assist.costPct / 100), short, Math.max(0, room(T)));
        if (help > 0) { add(T, 'housing assistance', -help); add(lw, 'rent', help); sum.assistance += help; short -= help; if (lw === T) { /* the city pays itself: nothing moves */ } }
      }
      if (short > 0) { debts.push({ id: rid(), debtor: w.id, creditor: lw, kind: 'rent', amount: short, ref: `day:${day}` }); sum.rentOwed += short; }
    }

    // 5b. players and agents who rent flats for Virtual Coin (./realty.js): their rent by the day
    const leases = e.parts.realty ? e.parts.realty.planLeases(day, { add, room, debts, rid }) : [];

    // 6. benefits from the treasury, scaled to what it has
    const tAvail = Math.max(0, room(T)), k = welfareWant > tAvail ? tAvail / welfareWant : 1;
    for (const x of welfare) { const amt = Math.floor(x.amt * k); if (amt > 0) { add(T, `benefits`, -amt); add(x.w.id, x.k === 'pension' ? 'pension' : x.k === 'student' ? 'student grant' : x.k === 'unemployed' ? 'unemployment benefit' : 'allowance', amt); sum.welfare += amt; } }
    sum.welfareCut = welfareWant - sum.welfare;

    // 7. debts owed to residents and landlords are paid first from what comes in (oldest first)
    for (const r of this.q.debtsBy.all(this.w)) {
      const id = r.debtor; let can = Math.max(0, room(id) - 0);
      if (can <= 0) continue;
      for (const d of this.q.openDebts.all(this.w, id)) {
        if (can <= 0) break;
        const pay = Math.min(d.amount, can);
        if (!L.wallet(d.creditor) || pay <= 0) continue;
        add(id, d.kind === 'wages' ? 'back wages' : 'back rent', -pay); add(d.creditor, d.kind === 'wages' ? 'back wages' : 'back rent', pay);
        debtPays.push({ id: d.id, left: d.amount - pay }); can -= pay;
      }
    }

    // 8. businesses: profit tax on venues, the city's dividends from the businesses it owns (above working capital)
    for (const biz of bz.open()) {
      const bw = bz.wallet(biz).id, r = book(biz.id), net = wallets.get(bw)?.amount || 0;
      const profit = net;   // sales and export revenue less stock, taxes and wages paid today
      if (biz.f !== -1 && profit > 0) { const tx = Math.min(bp(profit, pol.taxes.venueProfit), Math.max(0, room(bw))); if (tx > 0) { add(bw, 'profit tax', -tx); add(T, 'profit tax', tx); r.tax += tx; sum.taxProfit += tx; } }
      r.profit = wallets.get(bw)?.amount || 0;
      if (biz.owner_kind === 'municipality' && pol.business.cityDividend) {
        const keep = Math.max(biz.f === -1 ? pol.endowment.company : pol.endowment.business, (bill.get(`biz:${biz.id}`) || 0) * pol.business.workingCapitalDays), extra = room(bw) - keep;
        if (extra > 0) { add(bw, 'dividend to the city', -extra); add(T, 'dividends', extra); sum.dividends += extra; r.other -= extra; }
      } else if (biz.settings?.autoDraw && biz.owner_kind !== 'municipality') {
        const keep = Math.max(0, (bill.get(`biz:${biz.id}`) || 0) * pol.business.workingCapitalDays), extra = room(bw) - keep;
        if (extra > 0) { add(bw, 'drawn by the owner', -extra); add(bz.ownerWallet(biz).id, `profit from ${biz.name}`.slice(0, 40), extra); r.other -= extra; }
      }
    }

    // 9. the city's upkeep and ordinances (./city.js works out what is owed), scaled to what the treasury has
    const city = e.parts.city?.dailyCosts?.(day) || { lines: [] };
    let want = city.lines.reduce((s, l) => s + l.amount, 0);
    const kk = want > Math.max(0, room(T)) ? Math.max(0, room(T)) / want : 1;
    for (const l of city.lines) {
      const amt = Math.floor(l.amount * kk); if (amt <= 0) continue;
      add(T, l.label, -amt); add(l.sink === 'ordinances' ? sinkOrd : sinkUpkeep, l.label, amt);
      if (l.sink === 'ordinances') sum.ordinances += amt; else sum.upkeep += amt;
    }
    sum.upkeepCut = want - sum.upkeep - sum.ordinances;
    // public works: what the treasury holds beyond its reserve (so many days of its costs) is partly spent on the city
    const pw = pol.publicWorks, costsToday = sum.welfare + sum.assistance + sum.upkeep + sum.ordinances + sum.support;
    const excess = Math.max(0, room(T)) - pw.reserveDays * costsToday;
    if (pw.pct > 0 && excess > 0) { const works = Math.floor(excess * pw.pct / 100); if (works > 0) { add(T, 'public works', -works); add(e.sink('works').id, 'public works', works); sum.works = works; } }
    // owners of buildings on their own lots pay their buildings' upkeep (soft: what they can)
    for (const ob of e.parts.city?.ownerUpkeep?.() || []) {
      const ow = e.walletFor(ob.owner, 'main').id, amt = Math.min(ob.amount, Math.max(0, room(ow)));
      if (amt > 0) { add(ow, 'building upkeep', -amt); add(sinkUpkeep, 'building upkeep', amt); sum.upkeep += amt; }
    }

    // totals
    for (const [, r] of books) sum.sales += r.sales, sum.customers += r.customers;
    for (const [, x] of wallets) if (x.amount > 0) sum.volume += x.amount;
    for (const [id, x] of wallets) { const ww = L.wallet(id); if (ww?.owner_kind === 'system') continue; if (!ww) continue; sum.perKind[ww.owner_kind] = (sum.perKind[ww.owner_kind] || 0) + x.amount; }
    sum.treasury = (L.wallet(T).balance) + (wallets.get(T)?.amount || 0);
    const paid = new Map([...D.biz].filter(([, Bx]) => Bx.px && Object.keys(Bx.px).length).map(([id, Bx]) => [id, Bx.px]));
    return { day, wallets, books, debts, debtPays, summary: sum, cityLines: city.lines, rentNights, leases, customersOf, prices: paid, agentPay };
  }
  /** The nearest shop business to a building (groceries for meals at home), cached per building. */
  _shopFinder(W) {
    const bz = this.e.parts.businesses, shops = bz.open().filter(b => b.kind === 'shop').map(b => ({ b, B: W.buildings[b.b] })).filter(x => x.B && !x.B.gone);
    if (this._shopsVersion !== bz.version) { this.shopNear.clear(); this._shopsVersion = bz.version; }
    return bIdx => {
      if (this.shopNear.has(bIdx)) return bz.get(this.shopNear.get(bIdx));
      const B = W.buildings[bIdx]; let best = null, bd = Infinity;
      if (B) for (const x of shops) { const d = Math.hypot(x.B.x - B.x, x.B.z - B.z); if (d < bd) { bd = d; best = x.b; } }
      this.shopNear.set(bIdx, best ? best.id : null);
      return best;
    };
  }
  /** Posts a plan: each wallet's net once, in balanced chunks through the clearing wallet (which ends at zero). */
  post(day, plan) {
    const e = this.e, L = e.ledger, clearing = e.clearing().id;
    const list = [...plan.wallets].filter(([, x]) => x.amount !== 0);
    // the wallets that pay come first in their chunk, so a chunk never relies on money a later chunk brings
    list.sort((a, b) => b[1].amount - a[1].amount);
    let total = 0, k = 0;
    for (let i = 0; i < list.length; i += CHUNK) {
      const part = list.slice(i, i + CHUNK);
      const postings = part.map(([id, x]) => ({ wallet: id, amount: x.amount, note: noteOf(x.parts) }));
      const s = postings.reduce((a, p) => a + p.amount, 0);
      if (s !== 0) postings.push({ wallet: clearing, amount: -s });
      total += s;
      L.post({ kind: 'settlement', actor: 'system:settlement', memo: `Day ${day + 1}: wages, rent, sales, taxes and benefits${list.length > CHUNK ? ` (part ${++k})` : ''}`,
        ref: `day:${day}`, idem: `settle:${day}:${i / CHUNK}`, day, postings });
    }
    if (total !== 0) throw new LedgerError('conflict', `The settlement of day ${day} does not balance (${total}).`, 500);
    if (L.wallet(clearing).balance !== 0) throw new LedgerError('conflict', 'The clearing wallet did not end at zero.', 500);
  }
}

const round2 = v => Math.round(v * 100) / 100;
function spentOf(R) { let s = 0; for (const v of Object.values(R?.s || {})) s += v; return s; }
function noteOf(parts) {
  return [...parts].filter(([, v]) => v).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6).map(([k, v]) => `${k} ${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`).join(' · ');
}
export { subjKey };
