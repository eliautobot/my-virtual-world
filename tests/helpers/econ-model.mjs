// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A fast-forward model of the living economy for tests and tuning (docs/features/ECONOMY.md §3): a generated city, its
// residents and the real economy (ledger, businesses, households, market, city) on a throwaway database, with each world
// day's activity reported the way the simulation reports it (work hours, meals, coffees, shopping, gym) - drawn from
// the same rules the residents follow (they go out only when they can afford it) - then settled. Runs a few thousand
// residents through months in seconds.
//
//   node tests/helpers/econ-model.mjs [days] [population]      prints a line per day
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../server/db.js';
import { SecretBox } from '../../server/secrets.js';
import { Economy } from '../../server/economy/economy.js';
import { Businesses } from '../../server/economy/businesses.js';
import { Households } from '../../server/economy/households.js';
import { Market } from '../../server/economy/market.js';
import { City } from '../../server/economy/city.js';
import { Stats } from '../../server/economy/stats.js';
import { AgentMoney } from '../../server/economy/agents.js';
import { Views } from '../../server/economy/views.js';
import { Jobs } from '../../server/economy/jobs.js';
import { Trust } from '../../server/economy/trust.js';
import { testCity } from './world.mjs';
import { WorldIndex } from '../../server/sim/windex.js';
import { RNG } from '../../shared/rng.js';

export function economyModel({ population = 1200, seed = 'econ-model', policy = null, now = () => Date.now(), jobs = false, agents = null, edition = 'self-hosted', city = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-econ-model-'));
  const dbs = openDb(dir), box = new SecretBox();
  box.setKeys([crypto.randomBytes(32)]);
  const settings = new Map();
  const perms = { setting: (k, f = null) => (settings.has(k) ? settings.get(k) : f), setSetting: (k, v) => settings.set(k, String(v)), reload() {} };
  // city: a real world and its residents ({ world, people }) instead of a generated one
  const { world, people, index } = city ? { world: city.world, people: city.people, index: new WorldIndex(city.world) } : testCity({ seed, population });
  let day = 0;
  const sim = { clock: { dayScale: 16, rate: 1, simBase: 0, realBase: 0, dayBase: 0 }, now: () => day + 0.5, index };
  const econ = new Economy({ dbs, box, perms, edition, agents, world: () => world, people: () => people, sim: () => sim, now, log: Object.assign(() => {}, { warn() {}, error() {} }) });
  // the model's clock: an economic day is a whole number of sim time
  econ.econDay = t => (t === undefined ? day : Math.floor(t));
  econ.hourOf = () => 12;
  const p = econ.parts;
  p.businesses = new Businesses(econ, {}); p.households = new Households(econ); p.market = new Market(econ); p.city = new City(econ);
  p.stats = new Stats(econ); p.agents = new AgentMoney(econ); p.views = new Views(econ); p.trust = new Trust(econ);
  if (jobs) p.jobs = new Jobs(econ, { isThere: () => true });
  if (policy) settings.set('economy.policy', JSON.stringify(policy));
  settings.set('economy.enabled', '1');
  econ.genesis();
  const venues = index.venues, rng = new RNG(`${seed}:acts`);
  const H = p.households;
  /** One world day of activity, the way the simulation reports it. */
  function live() {
    const t = day + 0.3;
    const pick = kind => { const l = venues[kind] || []; return l.length ? l[Math.floor(rng.next() * l.length)] : null; };
    for (const [i, pp] of people.entries()) {
      if (!pp || pp.retired) continue;
      const a = { i, p: pp };
      const work = pp.job && pp.job.kind !== 'free' && pp.job.end > pp.job.start && ((pp.job.days ?? 31) & (1 << (day % 7)));
      if (work && rng.next() < 0.93) {
        const hrs = (pp.job.end - pp.job.start) * (0.85 + rng.next() * 0.15);
        H.onAct(a, { kind: 'work', use: pp.job.kind === 'staff' ? 'staff' : 'work', b: pp.job.kind === 'remote' ? -1 : pp.job.b, f: pp.job.f ?? -1, holdStart: t, holdEnd: t + hrs * 3600 / 16 });
      }
      const go = (kind, act, essential) => {
        if (!H.canSpend(a, kind, essential)) return false;
        const v = pick(kind); if (!v) return false;
        H.lastBuy.delete(pp.id);
        H.onAct(a, { ...act, b: v.b, f: v.f, holdStart: t + rng.next() * 0.4 });
        return true;
      };
      // lunch and dinner: out sometimes (when affordable), else at home
      for (const [pOut, kind] of [[work ? 0.45 : 0.25, rng.next() < 0.5 ? 'restaurant' : 'cafe'], [0.3, 'restaurant']]) {
        if (rng.next() < pOut && go(kind, { kind: 'meal', use: 'eat' }, true)) continue;
        if (pp.home) H.onAct(a, { kind: 'meal', use: 'eat', b: pp.home.b, f: pp.home.f, holdStart: t });
      }
      if (rng.next() < 0.35) go('cafe', { kind: 'visit', use: 'cafe' }, false);
      if (rng.next() < 0.22) go('shop', { kind: 'shop', use: 'buy' }, false);
      if (rng.next() < 0.12 * (pp.tr?.act ?? 0.5) * 2) go('gym', { kind: 'gym', use: 'run' }, false);
      if (rng.next() < 0.08) go('restaurant', { kind: 'bar', use: 'bar' }, false);
    }
  }
  function step() {
    live();
    day++;                                   // the day ended: settle it
    const t0 = performance.now();
    const r = H.settle(day - 1);
    return { day: day - 1, ms: performance.now() - t0, s: r.summary };
  }
  const residentBalances = () => people.filter(x => x && !x.retired && !x.vip).map(x => econ.ledger.walletOf('resident', x.id, 'main')?.balance ?? 0);
  /** An account row (the economy reads its role and age). */
  const account = (id, role = 'member', created = 0) => dbs.db.prepare(`INSERT INTO accounts (id, world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
    VALUES (?, ?, ?, ?, ?, ?, 'x', 0, ?, 0)`).run(id, dbs.worldId, `user${id}`, `User ${id}`, `user${id}`, role, created);
  return { econ, dbs, world, people, step, live, residentBalances, account, setDay: d => { day = d; }, get day() { return day; }, close() { dbs.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const days = Number(process.argv[2]) || 30, pop = Number(process.argv[3]) || 1200;
  const m = economyModel({ population: pop });
  const v = n => (n / 100).toFixed(0);
  const cols = ['day', 'ms', 'supply', 'treasury', 'venues', 'wages', 'exports', 'imports', 'rent', 'welfare', 'tax', 'upkeep', 'works', 'owedW', 'rentOwed', 'cpi', 'exp%', 'median', 'broke%'];
  console.log(cols.map(c => c.padStart(9)).join(''));
  for (let k = 0; k < days; k++) {
    const r = m.step(), s = r.s, sup = m.econ.ledger.supply(), bal = m.residentBalances().sort((a, b) => a - b);
    const tax = s.taxIncome + s.taxSales + s.taxExports + s.taxProfit, broke = bal.filter(b => b < 3000).length / bal.length;
    console.log([r.day, Math.round(r.ms), v(sup.total), v(s.treasury), v(s.sales - s.exports + s.remote), v(s.wages), v(s.exports), v(s.imports), v(s.rent), v(s.welfare), v(tax), v(s.upkeep), v(s.works || 0), v(s.owedWages), v(s.rentOwed),
      ((s.cpi || 10000) / 100).toFixed(1), s.exportPct?.to ?? '', v(bal[bal.length >> 1]), (broke * 100).toFixed(1)].map(x => String(x).padStart(9)).join(''));
  }
  const h = m.econ.health();
  console.log('health', h.ok ? 'ok' : JSON.stringify(h.problems.slice(0, 5)), 'chain', h.chain.ok, 'tx', h.transactions);
  m.close();
}
