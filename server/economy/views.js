// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What the economy window and the map show (docs/features/ECONOMY.md §10): the overview (money supply, treasury,
// activity, employment, prices, SimCity-style demand bars, wealth), data lenses per building for the property map, and
// the residents' wealth tiers. Read-only; cached for a few seconds because thousands of wallets are summed.
import { SCALE } from './ledger.js';
import { subj } from './economy.js';
import { WEEKDAYS, formatClock, mod } from '../../shared/constants.js';

export class Views {
  /** @param {import('./economy.js').Economy} econ */
  constructor(econ) {
    this.e = econ; this.db = econ.db; this.w = econ.w;
    this.cache = new Map();
    this.q = {
      residentWallets: this.db.prepare("SELECT owner_id, balance FROM econ_wallets WHERE world_id = ? AND owner_kind = 'resident'"),
      bizDays: this.db.prepare('SELECT biz, sales, profit, customers FROM econ_biz_days WHERE world_id = ? AND day = ?'),
      dayRow: this.db.prepare('SELECT summary_json FROM econ_days WHERE world_id = ? AND day = ?'),
    };
  }
  _cached(key, ms, fn) {
    const c = this.cache.get(key), now = Date.now();
    if (c && now - c.at < ms) return c.v;
    const v = fn(); this.cache.set(key, { at: now, v }); return v;
  }
  yesterday() {
    const d = this.e.econDay() - 1, r = this.q.dayRow.get(this.w, d);
    let s = null; try { s = r ? JSON.parse(r.summary_json) : null; } catch { s = null; }
    return s && !s.genesis ? s : null;
  }
  /** The economy at a glance. */
  overview() {
    return this._cached('overview', 3000, () => {
      const e = this.e, sup = e.ledger.supply(), T = e.treasury(), y = this.yesterday(), st = e.parts.stats, mk = e.parts.market;
      const idx = mk ? mk.index(30) : null;
      return {
        day: e.econDay(), hour: Math.round(e.hourOf() * 100) / 100,
        supply: { total: sup.total, issued: sup.issued, destroyed: sup.destroyed, wallets: sup.wallets, faucets: sup.faucets, sinks: sup.sinks },
        treasury: T.balance, yesterday: y,
        today: st ? st.today() : null,
        priceIndex: idx ? { level: idx.level, change: idx.change, basket: idx.basket } : null,
        exportPct: mk ? mk.exportPct(e.econDay()) : 100,
        demand: this.demand(), wealth: this.wealth(),
        top: this.topBusinesses(),
        series: st ? st.series(['supply', 'volume', 'sales', 'wages', 'treasury', 'cpi', 'employed', 'unemployed', 'exports', 'imports'], 30) : {},
      };
    });
  }
  /**
   * SimCity's demand bars (−100 … 100): homes (people without one against free beds), shops (customers per venue
   * against what a venue can serve), jobs (residents looking for work against free desks and counters).
   */
  demand() {
    return this._cached('demand', 15000, () => {
      const sim = this.e.d.sim(), people = this.e.d.people() || [], W = this.e.d.world();
      let homeless = 0, seeking = 0, residents = 0;
      for (const p of people) { if (!p || p.retired) continue; residents++; if (!p.home) homeless++; if (p.job?.kind === 'free' && (p.job.seek || p.job.lost || /between jobs|newcomer/i.test(p.job.title || ''))) seeking++; }
      let beds = 0, desks = 0, counters = 0;
      const idx = sim?.index;
      if (idx && W) {
        for (const B of W.buildings) {
          if (!B || B.gone) continue;
          for (let f = 0; f < B.floors; f++) {
            const lv = B.lv[f];
            if (B.type === 'apartment' && f > 0) beds += idx.findUsesCached(lv, 'sleep').length;
            if ((B.type === 'office' || B.type === 'hq') && f > 0) desks += idx.findUsesCached(lv, 'work').length;
            counters += idx.findUsesCached(lv, 'staff').length;
          }
        }
      }
      const housed = residents - homeless, jobs = people.filter(p => p && !p.retired && p.job && p.job.b !== undefined).length;
      const freeBeds = Math.max(0, beds - housed), freeJobs = Math.max(0, desks + counters * 2 - jobs);
      const y = this.yesterday(), venues = this.e.parts.businesses?.open().filter(b => b.f !== -1).length || 1;
      const perVenue = y ? y.customers / venues : 0;
      const clamp = v => Math.max(-100, Math.min(100, Math.round(v)));
      return {
        homes: clamp(homeless ? 100 * homeless / Math.max(1, homeless + freeBeds) : -100 * freeBeds / Math.max(1, beds)),
        shops: clamp((perVenue - 40) * 2),
        jobs: clamp(seeking ? 100 * seeking / Math.max(1, seeking + freeJobs) : -100 * freeJobs / Math.max(1, desks + counters)),
        detail: { residents, homeless, beds, freeBeds, jobs, freeJobs, seeking, customersPerVenue: Math.round(perVenue) },
      };
    });
  }
  /** Residents by savings: under 2 days of a typical wage ($), up to 15 days ($$), more ($$$). */
  wealth() {
    return this._cached('wealth', 15000, () => {
      const pol = this.e.policy(), day = pol.wages.office * 8, tiers = [0, 0, 0];
      let total = 0, n = 0;
      for (const r of this.q.residentWallets.all(this.w)) { const d = r.balance / day; tiers[d < 2 ? 0 : d < 15 ? 1 : 2]++; total += r.balance; n++; }
      return { tiers, average: n ? Math.round(total / n) : 0, residents: n };
    });
  }
  topBusinesses(n = 8) {
    const d = this.e.econDay() - 1, bz = this.e.parts.businesses;
    return this.q.bizDays.all(this.w, d).sort((a, b) => b.sales - a.sales).slice(0, n).map(r => { const b = bz.get(r.biz); return b ? { id: b.id, name: b.name, kind: b.kind, sales: r.sales, profit: r.profit, customers: r.customers } : null; }).filter(Boolean);
  }
  /**
   * A data lens: a value per building for the property map. kinds: revenue (yesterday's sales), profit, rent (a
   * night, apartments), wealth (residents' average savings by home), jobs (people employed there), land (the land factor).
   */
  lens(kind) {
    return this._cached(`lens:${kind}`, 10000, () => {
      const W = this.e.d.world(), people = this.e.d.people() || [], out = new Map(), bz = this.e.parts.businesses, hh = this.e.parts.households;
      const addTo = (b, v) => out.set(b, (out.get(b) || 0) + v);
      if (kind === 'revenue' || kind === 'profit') {
        for (const r of this.q.bizDays.all(this.w, this.e.econDay() - 1)) { const b = bz.get(r.biz); if (b) addTo(b.b, kind === 'revenue' ? r.sales : r.profit); }
        for (const b of bz.open()) { const t = hh?.todayOf(b.id); if (t && kind === 'revenue') addTo(b.b, 0); }
      } else if (kind === 'rent') {
        for (const B of W.buildings) {
          if (!B || B.gone || B.type !== 'apartment') continue;
          let s = 0, n = 0;
          for (let f = 1; f < B.floors; f++) (W.levels[B.lv[f]]?.units || []).forEach((u, k) => { const r = hh.flatRent(B.idx, f, k); if (r.rent) { s += r.rent; n++; } });
          if (n) out.set(B.idx, Math.round(s / n));
        }
      } else if (kind === 'wealth') {
        const bal = new Map(this.q.residentWallets.all(this.w).map(r => [r.owner_id, r.balance])), cnt = new Map();
        for (const p of people) { if (!p || p.retired || !p.home || p.vip) continue; const v = bal.get(p.id); if (v === undefined) continue; addTo(p.home.b, v); cnt.set(p.home.b, (cnt.get(p.home.b) || 0) + 1); }
        for (const [b, n] of cnt) out.set(b, Math.round(out.get(b) / n));
      } else if (kind === 'jobs') {
        for (const p of people) if (p && !p.retired && p.job && p.job.b !== undefined) addTo(p.job.b, 1);
      } else if (kind === 'land') {
        for (const B of W.buildings) if (B && !B.gone && B.type !== 'park') out.set(B.idx, hh.landFactor(B.idx));
      } else return null;
      const list = [...out].filter(([, v]) => v !== 0);
      const vals = list.map(([, v]) => v).sort((a, b) => a - b);
      return { kind, unit: kind === 'jobs' ? 'people' : kind === 'land' ? '%' : 'vc', min: vals[0] ?? 0, max: vals[vals.length - 1] ?? 0, p90: vals[Math.floor(vals.length * 0.9)] ?? 0, buildings: list };
    });
  }
  /** A resident's money (the selection card): their wallet, job and home rent. */
  resident(i) {
    const p = (this.e.d.people() || [])[i];
    if (!p || p.retired) return null;
    const s = this.e.personSubject(p), w = this.e.ledger.walletOf(s.kind, s.id, 'main');
    const rent = p.home ? this.e.parts.households.flatRent(p.home.b, p.home.f, p.home.u) : null;
    return { name: p.name, wallet: w ? { balance: w.balance, pending: this.e.parts.households.pending.get(p.id) || 0 } : null, job: p.job?.title || null,
      rent: rent?.rent || 0, landlord: rent?.landlord ? this.e.nameOf(rent.landlord.kind === 'city' ? subj('city', 'city') : rent.landlord) : null, scale: SCALE };
  }
  /**
   * A person's money lately (the selection card's money feed), oldest first: what they bought at the city's venues (paid
   * when the day settles) and, with `ledger`, their wallet's last lines — a resident's daily settlements, or an agent's
   * statement for its owner. [{ at, when, kind, label, note, amount }] (amount in hundredths of a VC, + in, − out).
   */
  personFeed(i, { ledger = false, limit = 10 } = {}) {
    const p = (this.e.d.people() || [])[i];
    if (!p || p.retired) return null;
    const sim = this.e.d.sim(), B = sim?.brain, menus = this.e.policy().menus || {}, bz = this.e.parts.businesses;
    const clock = t => (B ? `${WEEKDAYS[mod(B.day(t), 7)]} ${formatClock(B.hour(t))}` : null);
    const label = (kind, id) => (menus[kind] || []).find(m => m.id === id)?.label || (bz?.foodLine(id)?.label) || id.replace(/_/g, ' ');
    const out = (this.e.parts.households.receipts.get(p.id) || []).map(r => {
      const n = new Map(); for (const id of r.items) n.set(id, (n.get(id) || 0) + 1);
      const what = [...n].map(([id, k], j) => `${k > 1 ? `${k} × ` : ''}${j ? label(r.kind, id).toLowerCase() : label(r.kind, id)}`).join(' and ');
      return { at: r.at, when: clock(r.t), kind: 'buy', label: `${what} at ${r.biz}`, note: 'paid when the day settles', amount: -r.total };
    });
    if (ledger) {
      const s = this.e.personSubject(p), w = this.e.ledger.walletOf(s.kind, s.id, 'main');
      if (w) for (const l of this.e.statement(w.id, { limit })) {
        out.push({ at: l.at, when: null, kind: l.kind, label: l.kind === 'settlement' ? `Day ${(l.day ?? 0) + 1} settled` : l.memo || l.kind, note: l.kind === 'settlement' ? l.note : l.with, amount: l.amount });
      }
    }
    return out.sort((a, b) => a.at - b.at).slice(-limit - RECEIPT_ROOM);
  }
}
const RECEIPT_ROOM = 8;   // (the purchases remembered: server/economy/households.js RECEIPTS)
