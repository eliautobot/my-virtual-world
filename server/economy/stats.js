// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy's numbers over time (docs/features/ECONOMY.md §10): a row per key per economic day in econ_stats, written
// with each settlement, for the economy window's charts; and today's live counters (sales by the hour, the latest
// purchases for the floating coins over venues).
const DAY_KEYS = ['supply', 'issued', 'destroyed', 'volume', 'sales', 'customers', 'wages', 'owedWages', 'exports', 'remote', 'imports', 'rent', 'rentCity', 'rentOwed',
  'assistance', 'welfare', 'welfareCut', 'support', 'works', 'taxIncome', 'taxSales', 'taxExports', 'taxProfit', 'dividends', 'upkeep', 'ordinances', 'treasury', 'employed', 'unemployed', 'residents', 'tx'];

export class Stats {
  /** @param {import('./economy.js').Economy} econ */
  constructor(econ) {
    this.e = econ; this.db = econ.db; this.w = econ.w;
    this.live = { day: null, hourly: new Array(24).fill(0), tx: 0, recent: [] };
    const db = this.db;
    this.q = {
      put: db.prepare('INSERT INTO econ_stats (world_id, key, day, value) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, key, day) DO UPDATE SET value = excluded.value'),
      series: db.prepare('SELECT day, value FROM econ_stats WHERE world_id = ? AND key = ? AND day >= ? ORDER BY day'),
      day: db.prepare("SELECT key, value FROM econ_stats WHERE world_id = ? AND day = ? AND key LIKE 'm:%'"),
      txOnDay: db.prepare('SELECT COUNT(*) AS n FROM econ_tx WHERE world_id = ? AND day = ?'),
    };
  }
  _today() {
    const d = this.e.econDay();
    if (this.live.day !== d) { this.live.day = d; this.live.hourly = new Array(24).fill(0); this.live.tx = 0; }
    return this.live;
  }
  /** A resident bought something (the households): today's sales by the hour and the latest few for the coins. */
  noteSale(biz, amount, act) {
    const L = this._today(), h = Math.floor(this.e.hourOf(act?.holdStart));
    L.hourly[(h + 24) % 24] += amount;
    L.recent.push({ b: biz.b, f: biz.f, amount, at: Date.now() });
    if (L.recent.length > 200) L.recent.splice(0, L.recent.length - 200);
  }
  /** A transaction was posted (players and agents paying, buying …). */
  noteTx(ev) {
    const L = this._today(); L.tx++;
    if (ev.kind === 'purchase') { const h = Math.floor(this.e.hourOf()); for (const p of ev.postings) if (p.amount > 0) { L.hourly[(h + 24) % 24] += p.amount; break; } }
  }
  /** Purchases since `since` (ms), for the coins floating over venues: [{ b, f, amount }]. */
  recentSince(since) { return this._today().recent.filter(r => r.at > since).map(r => ({ b: r.b, f: r.f, amount: r.amount })); }

  /** A day was settled: its summary, the money supply, the commodities used, the price index, the stabiliser. */
  recordDay(day, plan) {
    const s = plan.summary, sup = this.e.ledger.supply();
    // the supply after this day's settlement (the plan's postings are already in, inside this transaction)
    const rows = { ...s, supply: sup.total, issued: sup.issued, destroyed: sup.destroyed, tx: this.q.txOnDay.get(this.w, day).n };
    for (const k of DAY_KEYS) if (Number.isFinite(rows[k])) this.q.put.run(this.w, `m:${k}`, day, Math.round(rows[k]));
    for (const [br, n] of Object.entries(s.brackets || {})) this.q.put.run(this.w, `m:bracket${br}`, day, n);
    // what venues used of each commodity (the market's demand signal)
    const pol = this.e.policy(), bz = this.e.parts.businesses, use = {};
    for (const [bid, r] of plan.books) {
      const b = bz?.get(bid); if (!b) continue;
      for (const [it, n] of Object.entries(r.detail?.items || {})) { const inputs = bz.inputsOf(b, it); if (inputs) for (const [c, q] of Object.entries(inputs)) use[c] = (use[c] || 0) + n * q; }
    }
    for (const [c, n] of Object.entries(use)) this.q.put.run(this.w, `use:${c}`, day, n);
    const idx = this.e.parts.market?.priceIndex(day, plan.books, (plan.rentNights || []).slice(0, 5000), plan.prices);
    if (idx) s.cpi = idx.level;
    const st = this.e.parts.market?.stabilise(day);
    if (st) s.exportPct = st;
  }
  /** Series for charts: { key: [[day, value] …] } for the last n days. */
  series(keys, n = 30) {
    const from = this.e.econDay() - n, out = {};
    for (const k of keys) out[k] = this.q.series.all(this.w, k.includes(':') ? k : `m:${k}`, from).map(r => [r.day, r.value]);
    return out;
  }
  /** One day's numbers. */
  dayValues(day) { return Object.fromEntries(this.q.day.all(this.w, day).map(r => [r.key.slice(2), r.value])); }
  today() { const L = this._today(); return { day: L.day, hourly: L.hourly, tx: L.tx }; }
}
