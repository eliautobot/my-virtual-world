// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Markets (docs/features/ECONOMY.md §7): the Global Market's commodity prices (what venues pay for their stock), the
// export demand index that keeps the money supply growing with activity and no faster, and the VC price index (spec
// 12): a basket at the median prices actually charged.
//
// Prices are deterministic: each day's price follows from the previous day's, a seeded shock (the world's id, the
// commodity, the day), a pull back towards the policy's base price and the city's own demand for it. A day's prices are
// written once (econ_stats 'px:<commodity>') so they never change after the fact.
import { hashStr } from '../../shared/rng.js';

const gauss = (seed) => {   // a standard normal from two seeded uniforms
  const u = (hashStr(seed + ':u') % 1000000 + 0.5) / 1000000, v = (hashStr(seed + ':v') % 1000000 + 0.5) / 1000000;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
export const BASKET = Object.freeze([
  { id: 'coffee', label: 'A coffee', kind: 'cafe' },
  { id: 'meal', label: 'A meal', kind: 'restaurant' },
  { id: 'groceries', label: 'Groceries', kind: 'shop' },
  { id: 'session', label: 'A gym session', kind: 'gym' },
  { id: 'rent', label: 'A night\'s rent', kind: null },
]);

export class Market {
  /** @param {import('./economy.js').Economy} econ */
  constructor(econ) {
    this.e = econ; this.db = econ.db; this.w = econ.w;
    this.cache = new Map();   // day → prices
    const db = this.db;
    this.q = {
      stat: db.prepare('SELECT value FROM econ_stats WHERE world_id = ? AND key = ? AND day = ?'),
      before: db.prepare('SELECT day, value FROM econ_stats WHERE world_id = ? AND key = ? AND day < ? ORDER BY day DESC LIMIT 1'),
      put: db.prepare('INSERT INTO econ_stats (world_id, key, day, value) VALUES (?, ?, ?, ?) ON CONFLICT (world_id, key, day) DO NOTHING'),
      series: db.prepare('SELECT day, value FROM econ_stats WHERE world_id = ? AND key = ? AND day >= ? ORDER BY day'),
    };
  }
  /** The commodities' prices for an economic day (hundredths of a VC a unit), made once and kept. */
  pricesFor(day) {
    if (this.cache.has(day)) return this.cache.get(day);
    const pol = this.e.policy(), out = {};
    for (const [c, def] of Object.entries(pol.commodities)) {
      const have = this.q.stat.get(this.w, `px:${c}`, day);
      if (have) { out[c] = have.value; continue; }
      const prev = this.q.before.get(this.w, `px:${c}`, day);
      let p = prev ? prev.value : def.base;
      // up to 30 missed days are walked one by one, so a gap doesn't jump
      for (let d = prev ? prev.day + 1 : day; d <= day && d >= day - 30; d++) p = this.step(c, def, p, d);
      p = Math.max(1, Math.round(p));
      this.q.put.run(this.w, `px:${c}`, day, p);
      out[c] = p;
    }
    if (this.cache.size > 20) this.cache.clear();
    this.cache.set(day, out);
    return out;
  }
  /** One day's move: a seeded shock, a pull towards the base price, the city's demand yesterday against its average. */
  step(c, def, p, day) {
    const shock = gauss(`${this.w}:${c}:${day}`) * def.vol / 10000 * 4.9;   // vol is per world hour; a day is ~√24 of it
    const pull = 0.08 * (def.base - p) / def.base;
    const used = this.q.stat.get(this.w, `use:${c}`, day - 1)?.value, avg = this._avg(`use:${c}`, day - 1, 7);
    const demand = used && avg ? Math.max(-0.03, Math.min(0.03, 0.05 * (used / avg - 1))) : 0;
    return Math.max(def.base * 0.4, Math.min(def.base * 2.5, p * (1 + shock + pull + demand)));
  }
  _avg(key, day, n) {
    const rows = this.q.series.all(this.w, key, day - n + 1).filter(r => r.day <= day);
    return rows.length ? rows.reduce((s, r) => s + r.value, 0) / rows.length : 0;
  }
  /** Today's price of each commodity within the day (a gentle seeded wiggle per world hour, for the charts). */
  intraday(day, hour) {
    const base = this.pricesFor(day), pol = this.e.policy(), out = {};
    for (const [c, p] of Object.entries(base)) out[c] = Math.max(1, Math.round(p * (1 + gauss(`${this.w}:${c}:${day}:${Math.floor(hour)}`) * (pol.commodities[c]?.vol || 0) / 10000 * 0.5)));
    return out;
  }

  // ------------------------------------------------------------------------------------------- exports
  /** The export demand index for a day, in percent (100: the policy's export prices as they are). */
  exportPct(day) {
    const have = this.q.stat.get(this.w, 'm:exportPct', day);
    if (have) return have.value;
    const prev = this.q.before.get(this.w, 'm:exportPct', day);
    const v = prev ? prev.value : 100;
    this.q.put.run(this.w, 'm:exportPct', day, v);
    return v;
  }
  /**
   * The stabiliser, after a day settles: compare how fast the money supply grew this past week with the target; ease
   * export prices when VC piles up faster, firm them when it grows slower. The tourism ordinance adds demand.
   */
  stabilise(day) {
    const pol = this.e.policy(), s = pol.stabilizer;
    const cur = this.exportPct(day);
    let next = cur, why = 'steady';
    if (s.enabled) {
      const now = this.q.stat.get(this.w, 'm:supply', day)?.value, then = this.q.before.get(this.w, 'm:supply', day - 6);
      if (now && then?.value) {
        const growthBp = Math.round((now - then.value) / then.value * 10000);
        if (growthBp > s.targetBp + 50) { next = cur - Math.ceil(s.stepBp / 100); why = `the money supply grew ${growthBp / 100}% this week (target ${s.targetBp / 100}%)`; }
        else if (growthBp < s.targetBp - 50) { next = cur + Math.ceil(s.stepBp / 100); why = `the money supply grew ${growthBp / 100}% this week (target ${s.targetBp / 100}%)`; }
      }
      next = Math.max(s.minPct, Math.min(s.maxPct, next));
    }
    const boost = pol.ordinances.tourism?.on ? Math.round(pol.ordinances.tourism.exportBoostBp / 100) : 0;
    this.q.put.run(this.w, 'm:exportPct', day + 1, next + boost);
    return { from: cur, to: next + boost, why };
  }

  // ------------------------------------------------------------------------------------------- the price index
  /**
   * The price index for a day (spec 12, method v2): for each basket item, the median of the prices actually charged
   * that day (every sale's own price, residents', players' and agents'; buying at your own business is refused, so there
   * is no self-dealing to remove), no venue counting for more than the policy's venueCapPct of an item's sample; the
   * rent of each flat paid that night. An item with fewer than the policy's minSamples sales carries its last published
   * price forward, marked thin. The level is the mean of each item against its first published price (100). The sample
   * sizes are published with it.
   */
  priceIndex(day, books, rentNights, prices = new Map()) {
    const bz = this.e.parts.businesses, pol = this.e.policy().index, items = {};
    for (const it of BASKET) {
      let samples;
      if (it.id === 'rent') samples = [rentNights.map(p => [p, 1])];   // the rent of each flat paid that night (one sample each)
      else {
        samples = [];
        for (const [bid, px] of prices) { const b = bz.get(bid); if (b && b.kind === it.kind && px[it.id]) samples.push(Object.entries(px[it.id]).map(([p, n]) => [Number(p), n])); }
        // books of a day settled before prices were kept: the business's list price, counted by its sales (marked)
        if (!samples.length) for (const [bid, r] of books) { const b = bz.get(bid), n = r.detail?.items?.[it.id]; if (b && n && b.kind === it.kind) { const p = bz.priceOf(b, it.id); if (p) samples.push([[p, n]]); } }
      }
      const sizes = samples.map(v => v.reduce((a, [, n]) => a + n, 0)), total = sizes.reduce((a, b) => a + b, 0);
      const weights = it.id === 'rent' ? sizes.map(() => 1) : venueWeights(sizes, pol.venueCapPct);
      const pts = [];
      samples.forEach((venue, k) => { for (const [p, n] of venue) pts.push([p, n * weights[k]]); });
      const thin = total < pol.minSamples;
      items[it.id] = { median: thin ? null : wmedian(pts), samples: total, venues: samples.length, thin };
    }
    for (const [k, v] of Object.entries(items)) { if (v.median) this.q.put.run(this.w, `cpi:${k}`, day, v.median); this.q.put.run(this.w, `cpin:${k}`, day, v.samples); }
    let n = 0, s = 0;
    for (const it of BASKET) {
      const base = this.q.series.all(this.w, `cpi:${it.id}`, -1e9)[0]?.value;
      const cur = items[it.id].median || this.q.before.get(this.w, `cpi:${it.id}`, day + 1)?.value;
      if (base && cur) { s += cur / base; n++; }
    }
    const level = n ? Math.round(s / n * 10000) : 10000;   // hundredths of an index point: 10000 = 100.00
    this.q.put.run(this.w, 'm:cpi', day, level);
    return { level, items };
  }
  /** The published index: level, change, the basket's medians with their sample sizes, the pin's reference value. */
  index(days = 30) {
    const today = this.e.econDay(), from = today - days, pol = this.e.policy();
    const series = this.q.series.all(this.w, 'm:cpi', from);
    const last = series[series.length - 1], prev = series[series.length - 2];
    const items = BASKET.map(it => {
      const s = this.q.series.all(this.w, `cpi:${it.id}`, from), ns = this.q.series.all(this.w, `cpin:${it.id}`, from);
      const lastN = ns.length ? ns[ns.length - 1] : null, published = s.length ? s[s.length - 1] : null;
      return { id: it.id, label: it.label, median: published ? published.value : null, samples: lastN ? lastN.value : 0,
        thin: !!lastN && (lastN.value < pol.index.minSamples || published?.day !== lastN.day), history: s.map(r => [r.day, r.value]) };
    });
    const basket = items.reduce((t, it) => t + (it.median || 0), 0);
    return { method: `v2: the median price actually paid for each item (no venue more than ${pol.index.venueCapPct}% of a sample; under ${pol.index.minSamples} sales an item carries its last price, marked thin), equal weights, against the first day published = 100`,
      level: last ? last.value / 100 : 100, change: last && prev ? Math.round((last.value - prev.value) / prev.value * 10000) / 100 : 0, day: last?.day ?? null, items, basket,
      history: series.map(r => [r.day, r.value / 100]) };
  }
  /** The Global Market for the economy window: each commodity's price, change and recent history. */
  board(days = 30) {
    const pol = this.e.policy(), today = this.e.econDay(), px = this.pricesFor(today), h = this.e.hourOf();
    const now = this.intraday(today, h);
    return Object.entries(pol.commodities).map(([c, def]) => {
      const s = this.q.series.all(this.w, `px:${c}`, today - days);
      const prev = s.length > 1 ? s[s.length - 2].value : def.base;
      return { id: c, label: def.label, icon: def.icon, base: def.base, price: px[c], now: now[c], change: Math.round((px[c] - prev) / prev * 10000) / 100, history: s.map(r => [r.day, r.value]),
        used: this.q.stat.get(this.w, `use:${c}`, today - 1)?.value || 0 };
    });
  }
}
/**
 * How much each venue's sales count (a factor per sale) so that no venue is more than pct% of the sample used: every
 * venue's sales count in full up to a cap c, the largest c with c ≤ pct% of Σ min(sales, c). With too few venues for
 * any such cap (fewer than 100/pct), each venue counts the same, whatever it sold.
 */
function venueWeights(sizes, pct) {
  const used = c => sizes.reduce((t, n) => t + Math.min(n, c), 0), ok = c => c * 100 <= pct * used(c);
  if (!sizes.length) return [];
  if (!ok(1)) return sizes.map(n => (n > 0 ? 1 / n : 0));
  let lo = 1, hi = Math.max(...sizes);
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (ok(mid)) lo = mid; else hi = mid - 1; }
  return sizes.map(n => (n > lo ? lo / n : 1));
}
/** The median of weighted points [[value, weight] …] (the lower middle when the weight is even). */
function wmedian(pts) {
  if (!pts.length) return null;
  const a = [...pts].sort((x, y) => x[0] - y[0]), total = a.reduce((t, [, w]) => t + w, 0);
  let acc = 0;
  for (const [v, w] of a) { acc += w; if (acc * 2 >= total) return v; }
  return a[a.length - 1][0];
}
