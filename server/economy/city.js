// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city (docs/features/ECONOMY.md §6), SimCity's budget: the treasury's income and expenses per line, per day and
// over time; the daily costs of running the city (roads by the kilometre, parks, metro stations, city buildings,
// ordinances, bond repayments); the upkeep owners pay for their own buildings; bonds (loans to the treasury).
import crypto from 'node:crypto';
import { makeGrid } from '../../shared/city.js';
import { LedgerError, vc } from './ledger.js';

const rid = () => `bond_${crypto.randomBytes(9).toString('base64url')}`;
/** The treasury's lines as the budget shows them (the settlement's summary keys). */
export const INCOME = Object.freeze([
  ['taxIncome', 'Income tax', '👛'], ['taxSales', 'Sales tax', '🧾'], ['taxExports', 'Business tax', '🏢'], ['taxProfit', 'Profit tax', '🏪'],
  ['rentCity', 'Rent from city flats', '🏠'], ['dividends', 'City businesses', '💼'],
]);
export const EXPENSES = Object.freeze([
  ['welfare', 'Benefits and pensions', '🧓'], ['assistance', 'Housing assistance', '🏘️'], ['upkeep', 'Upkeep and city services', '🛠️'],
  ['ordinances', 'Ordinances', '📜'], ['support', 'Help for city businesses', '🤝'], ['works', 'Public works', '🏗️'], ['bonds', 'Bond repayments', '🏦'],
]);

export class City {
  /** @param {import('./economy.js').Economy} econ */
  constructor(econ, d = {}) {
    this.e = econ; this.d = d; this.db = econ.db; this.w = econ.w;
    this._roads = { version: -1, km: 0 };
    const db = this.db;
    this.q = {
      days: db.prepare("SELECT day, summary_json FROM econ_days WHERE world_id = ? AND status = 'done' AND day >= ? ORDER BY day"),
      loans: db.prepare("SELECT * FROM econ_loans WHERE world_id = ? AND borrower = ? ORDER BY created DESC LIMIT 50"),
      activeLoans: db.prepare("SELECT * FROM econ_loans WHERE world_id = ? AND borrower = ? AND status = 'active'"),
      addLoan: db.prepare(`INSERT INTO econ_loans (id, world_id, borrower, lender, principal, rate_bp, term_days, outstanding, installment, status, started_day, next_day, created, updated)
        VALUES ($id, $w, $borrower, $lender, $p, $rate, $term, $p, $inst, 'active', $day, $next, $at, $at)`),
      setLoan: db.prepare('UPDATE econ_loans SET outstanding = $out, status = $status, next_day = $next, updated = $at WHERE world_id = $w AND id = $id'),
    };
  }

  // ------------------------------------------------------------------------------------------- what the city runs
  /** Kilometres of road: the island's drawn roads and the city's street grid (cached per world version). */
  roadKm() {
    const W = this.e.d.world();
    if (!W) return 0;
    if (this._roads.version === W.version) return this._roads.km;
    let m = 0;
    for (const r of W.roads || []) {
      const pts = r?.pts || [];
      for (let i = 1; i < pts.length; i++) m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z) / 1e6;
      if (r?.closed && pts.length > 2) m += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) / 1e6;
    }
    if (W.grid && !makeGrid(W.grid).empty) {
      const g = makeGrid(W.grid);
      m += ((W.grid.nx || 0) + 1) * (g.maxZ - g.minZ) + ((W.grid.nz || 0) + 1) * (g.maxX - g.minX);
    }
    this._roads = { version: W.version, km: m / 1000 };
    return this._roads.km;
  }
  /** Buildings and floors on the city's land, and on each owner's. */
  holdings() {
    const W = this.e.d.world(), bz = this.e.parts.businesses, city = { buildings: 0, floors: 0, parks: 0 }, owners = new Map();
    for (const B of W?.buildings || []) {
      if (!B || B.gone) continue;
      if (B.type === 'park') { city.parks++; continue; }
      const o = bz.ownerOfBuilding(B);
      if (o.kind === 'municipality') { city.buildings++; city.floors += B.floors || 0; continue; }
      const k = `${o.kind}:${o.id}`, x = owners.get(k) || { owner: { kind: o.kind, id: o.id }, floors: 0, buildings: 0 };
      x.floors += B.floors || 0; x.buildings++; owners.set(k, x);
    }
    return { city, owners: [...owners.values()] };
  }
  /** The treasury's costs for a day: [{ key, label, amount, sink }]. The settlement scales them to what it has. */
  dailyCosts(day) {
    const pol = this.e.policy(), W = this.e.d.world(), h = this.holdings(), u = pol.upkeep, lines = [];
    const km = this.roadKm();
    if (km > 0 && u.roadPerKm) lines.push({ key: 'roads', label: `Roads (${km.toFixed(1)} km)`, amount: Math.round(km * u.roadPerKm), sink: 'upkeep' });
    if (h.city.parks && u.park) lines.push({ key: 'parks', label: `Parks (${h.city.parks})`, amount: h.city.parks * u.park, sink: 'upkeep' });
    const st = (W?.stations || []).length;
    if (st && u.station) lines.push({ key: 'stations', label: `Metro stations (${st})`, amount: st * u.station, sink: 'upkeep' });
    if (h.city.floors && u.buildingFloor) lines.push({ key: 'buildings', label: `City buildings (${h.city.buildings})`, amount: h.city.floors * u.buildingFloor, sink: 'upkeep' });
    const residents = (this.e.d.people() || []).filter(p => p && !p.retired).length;
    if (residents && u.perResident) lines.push({ key: 'services', label: `City services (${residents} residents)`, amount: residents * u.perResident, sink: 'upkeep' });
    for (const [k, o] of Object.entries(pol.ordinances)) if (o.on && o.cost > 0) lines.push({ key: `ord:${k}`, label: o.label, amount: o.cost, sink: 'ordinances' });
    void day;
    return { lines };
  }
  /** What owners of buildings on their own lots owe for upkeep each day: [{ owner, amount }]. */
  ownerUpkeep() {
    const u = this.e.policy().upkeep.buildingFloor;
    if (!u) return [];
    return this.holdings().owners.filter(x => x.owner.kind === 'account' || x.owner.kind === 'agent').map(x => ({ owner: x.owner, amount: x.floors * u }));
  }

  // ------------------------------------------------------------------------------------------- bonds
  /** Issues a bond: the bank lends the treasury `amount`, repaid with interest in daily instalments. Administrators. */
  issueBond(admin, { amount, days }) {
    this.e.live();
    const pol = this.e.policy(), T = this.e.treasury();
    const term = Number.isSafeInteger(days) ? days : pol.loans.termDays;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('input', 'Bad amount.', 400);
    if (term < 1 || term > 3650) throw new LedgerError('input', 'A bond runs from 1 to 3,650 days.', 400);
    const owed = this.q.activeLoans.all(this.w, T.id).reduce((s, l) => s + l.outstanding, 0);
    if (owed + amount > pol.loans.cityMaxDebt) throw new LedgerError('limit', `The city may owe at most ${vc(pol.loans.cityMaxDebt)}.`, 409);
    // interest per world week, simple, spread over the term: total = principal × (1 + rate × weeks)
    const total = Math.round(amount * (1 + pol.loans.cityRateBp / 10000 * term / 7));
    const inst = Math.ceil(total / term), id = rid(), day = this.e.econDay();
    return this.e.dbs.tx(() => {
      this.q.addLoan.run({ id, w: this.w, borrower: T.id, lender: this.e.faucet('loans').id, p: amount, rate: pol.loans.cityRateBp, term, inst, day, next: day + 1, at: this.e.now() });
      // the bond's whole cost is outstanding: principal and interest
      this.db.prepare('UPDATE econ_loans SET outstanding = ? WHERE world_id = ? AND id = ?').run(total, this.w, id);
      const t = this.e.ledger.transfer(this.e.faucet('loans').id, T.id, amount, { kind: 'loan', actor: `admin:${admin.id}`, memo: `Bond: ${vc(amount)} for ${term} days`, ref: id });
      this.e.d.audit?.log('economy.bond', { actor: admin, detail: { id, amount, term, total } });
      this.e.bump();
      return { id, amount, term, total, installment: inst, tx: t.id };
    });
  }
  /** Bond instalments due today: each instalment is part principal (back to the bank: destroyed) and part interest. */
  bondLines(day) {
    const T = this.e.treasury(), out = [];
    for (const l of this.q.activeLoans.all(this.w, T.id)) {
      if (l.next_day > day) continue;
      const total = Math.round(l.principal * (1 + l.rate_bp / 10000 * l.term_days / 7)), pay = Math.min(l.installment, l.outstanding);
      const interest = total > 0 ? Math.round(pay * (total - l.principal) / total) : 0;
      out.push({ loan: l, pay, principal: pay - interest, interest });
    }
    return out;
  }
  /** After a day settles: bond instalments (scaled to what the treasury holds), each its own transaction. */
  afterDay(day) {
    const T = this.e.treasury();
    let paid = 0;
    for (const x of this.bondLines(day)) {
      const can = Math.max(0, this.e.ledger.available(T.id)), pay = Math.min(x.pay, can);
      if (pay <= 0) { this.q.setLoan.run({ out: x.loan.outstanding, status: 'active', next: day + 1, at: this.e.now(), w: this.w, id: x.loan.id }); continue; }
      const interest = Math.min(pay, x.interest), principal = pay - interest, postings = [{ wallet: T.id, amount: -pay }];
      if (principal > 0) postings.push({ wallet: x.loan.lender, amount: principal });
      if (interest > 0) postings.push({ wallet: this.e.sink('interest').id, amount: interest });
      this.e.dbs.tx(() => {
        this.e.ledger.post({ kind: 'loan_payment', actor: 'system:bonds', memo: `Bond repayment (${x.loan.id})`, ref: x.loan.id, idem: `bond:${x.loan.id}:${day}`, day, postings });
        const out = x.loan.outstanding - pay;
        this.q.setLoan.run({ out, status: out <= 0 ? 'repaid' : 'active', next: day + 1, at: this.e.now(), w: this.w, id: x.loan.id });
      });
      paid += pay;
    }
    if (paid) {   // the day's budget shows what went to the bank
      const r = this.db.prepare('SELECT summary_json FROM econ_days WHERE world_id = ? AND day = ?').get(this.w, day);
      let sum = {}; try { sum = JSON.parse(r?.summary_json || '{}'); } catch { sum = {}; }
      sum.bonds = (sum.bonds || 0) + paid;
      this.db.prepare('UPDATE econ_days SET summary_json = ? WHERE world_id = ? AND day = ?').run(JSON.stringify(sum), this.w, day);
      this.db.prepare('INSERT INTO econ_stats (world_id, key, day, value) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, key, day) DO UPDATE SET value = excluded.value').run(this.w, 'm:bonds', day, sum.bonds);
    }
  }

  // ------------------------------------------------------------------------------------------- the budget
  /**
   * The budget for the economy window: the treasury, each income and expense line yesterday and on average over the
   * last week, history, tax rates, ordinances and bonds. Everyone may read it (transparency).
   */
  budget(days = 30) {
    const pol = this.e.policy(), today = this.e.econDay(), T = this.e.treasury();
    const rows = this.q.days.all(this.w, today - days).map(r => { let s = {}; try { s = JSON.parse(r.summary_json || '{}'); } catch { s = {}; } return { day: r.day, s }; }).filter(r => !r.s.genesis);
    const last = rows[rows.length - 1]?.s || {}, week = rows.slice(-7);
    const avg = k => (week.length ? Math.round(week.reduce((t, r) => t + (r.s[k] || 0), 0) / week.length) : 0);
    const line = ([key, label, icon]) => ({ key, label, icon, yesterday: last[key] || 0, avg: avg(key) });
    const income = INCOME.map(line), expenses = EXPENSES.map(line);
    const supportOf = s => s.support || 0;
    expenses.find(l => l.key === 'support').yesterday = supportOf(last);
    const costs = this.dailyCosts(today).lines;
    const loans = this.q.loans.all(this.w, T.id).map(l => ({ id: l.id, principal: l.principal, outstanding: l.outstanding, installment: l.installment, rateBp: l.rate_bp, termDays: l.term_days, status: l.status, startedDay: l.started_day }));
    return {
      treasury: { balance: T.balance, available: T.balance - T.held, wallet: T.id },
      income, expenses, net: { yesterday: income.reduce((t, l) => t + l.yesterday, 0) - expenses.reduce((t, l) => t + l.yesterday, 0), avg: income.reduce((t, l) => t + l.avg, 0) - expenses.reduce((t, l) => t + l.avg, 0) },
      upkeep: costs, roadKm: Math.round(this.roadKm() * 10) / 10,
      taxes: pol.taxes, ordinances: pol.ordinances, loans, loanRules: pol.loans,
      history: rows.map(r => ({ day: r.day, income: INCOME.reduce((t, [k]) => t + (r.s[k] || 0), 0), expenses: EXPENSES.reduce((t, [k]) => t + (r.s[k] || 0), 0), treasury: r.s.treasury ?? null })),
      cuts: { welfare: last.welfareCut || 0, upkeep: last.upkeepCut || 0 },
    };
  }
}
