// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's economy window (docs/features/ECONOMY.md §6, §7, §10), after SimCity's panels: an overview (the money
// supply, the treasury, yesterday's activity, the price index, employment, demand bars for homes, shops and jobs, the
// residents' wealth, the top businesses), the budget (income and expenses per line with history; for administrators the
// tax rates by bracket, ordinances, public works and bonds), every business, the Global Market, the price index, and
// the treasury's public ledger. Everyone may read it; administrators change it (server/economy/routes.js).
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { lineChart, hover, paint, barList, demandBars, tile, sparkline, compact } from './econ-charts.js';
import { vc } from './economy.js';

const TABS = [['overview', '🏙️ Overview'], ['budget', '🏛️ Budget'], ['businesses', '🏪 Businesses'], ['jobs', '💼 Jobs'], ['market', '🌐 Market'], ['prices', '🏷️ Prices'], ['ledger', '📜 Treasury']];
const v0 = n => vc(n, false);
let dlg = null;

export function open(app, want = 'overview') {
  dlg?.close();
  let tab = TABS.some(t => t[0] === want) ? want : 'overview', data = {}, sort = 'sales';
  const el = document.body.appendChild(h(`<div class="modal-back lib-back ec-back"><div class="panel libdlg ec-city" role="dialog" aria-modal="true" aria-label="The city's economy"></div></div>`));
  const box = el.querySelector('.ec-city');
  const admin = () => auth.can?.('economy.admin');
  const load = async () => {
    try {
      if (tab === 'overview') data.ov = await getJSON('/api/economy/overview');
      if (tab === 'budget') data.budget = await getJSON('/api/economy/budget');
      if (tab === 'businesses') data.biz = await getJSON('/api/economy/businesses');
      if (tab === 'jobs') { data.jobs = await getJSON('/api/economy/jobs/board'); data.me = auth.account && auth.can?.('economy.use') ? await getJSON('/api/economy/jobs/me').catch(() => null) : null; }
      if (tab === 'market') data.market = await getJSON('/api/economy/market');
      if (tab === 'prices') data.index = await getJSON('/api/economy/index');
      if (tab === 'ledger') data.ledger = await getJSON('/api/economy/treasury');
    } catch (e) { box.querySelector('.ec-body').innerHTML = `<p class="hint bad">${esc(e.message)}</p>`; return; }
    render();
  };
  const render = () => {
    let body = '';
    try { body = { overview, budget, businesses, jobs, market, prices, ledger }[tab](); } catch (e) { body = `<p class="hint bad">${esc(e.message)}</p>`; }
    box.innerHTML = `<h3><span>📊 The city's economy</span><button type="button" class="btn small" data-c="close" aria-label="Close">✕</button></h3>
      <div class="seg ec-tabs" role="tablist">${TABS.map(([k, t]) => `<button type="button" class="btn small${tab === k ? ' on' : ''}" data-tab="${k}" role="tab">${t}</button>`).join('')}</div>
      <div class="ec-body">${body}</div><p class="hint bad ec-err" role="alert"></p>`;
    paint(box); hover(box);
  };

  // ------------------------------------------------------------------ overview
  function overview() {
    const o = data.ov; if (!o) return '<p class="hint">Loading…</p>';
    const y = o.yesterday || {}, S = o.series || {}, last = k => (S[k] || []).map(p => p[1]);
    const ch = k => { const s = last(k); return s.length > 1 && s[s.length - 2] ? Math.round((s[s.length - 1] - s[s.length - 2]) / Math.abs(s[s.length - 2]) * 1000) / 10 : null; };
    const emp = y.employed + y.unemployed ? Math.round(y.unemployed / (y.employed + y.unemployed) * 1000) / 10 : null;
    const w = o.wealth, wt = w.tiers.reduce((a, b) => a + b, 0) || 1;
    return `<div class="ec-tiles">
        ${tile('Money supply', vc(o.supply.total), { delta: ch('supply'), spark: last('supply'), note: 'Every VC in every wallet that isn\'t the system\'s' })}
        ${tile('Treasury', vc(o.treasury), { delta: ch('treasury'), spark: last('treasury'), note: 'The city\'s purse' })}
        ${tile('Yesterday\'s takings', vc(y.sales || 0), { delta: ch('sales'), spark: last('sales'), note: 'Sold by every business, and companies\' work sold abroad' })}
        ${tile('Wages yesterday', vc(y.wages || 0), { delta: ch('wages'), spark: last('wages') })}
        ${tile('Price index', o.priceIndex ? o.priceIndex.level.toFixed(1) : '100', { delta: o.priceIndex?.change ?? null, deltaGood: false, note: 'What a basket costs against the first day: 100' })}
        ${tile('Looking for work', emp === null ? '—' : `${emp}%`, { note: `${y.unemployed || 0} residents without work, ${y.employed || 0} in work` })}
      </div>
      <div class="ec-two">
        <div><div class="tier-head">📈 Demand</div>${demandBars([
          { label: 'Homes', icon: '🏠', value: o.demand.homes, note: `${o.demand.detail.homeless} without a home · ${o.demand.detail.freeBeds} free beds` },
          { label: 'Shops & venues', icon: '🏪', value: o.demand.shops, note: `${o.demand.detail.customersPerVenue} customers per venue yesterday` },
          { label: 'Jobs', icon: '💼', value: o.demand.jobs, note: `${o.demand.detail.seeking} looking · ${o.demand.detail.freeJobs} places free` }])}</div>
        <div><div class="tier-head">👛 Residents' savings</div>
          <div class="ec-stack" role="img" aria-label="Residents by savings">${[['$', 'var(--ec-seq1)'], ['$$', 'var(--ec-seq2)'], ['$$$', 'var(--ec-seq3)']].map(([t, c], k) => `<i style="flex:${w.tiers[k] || 0.0001};background:${c}" title="${t}: ${w.tiers[k]}"></i>`).join('')}</div>
          <div class="ec-legend">${['$ under 2 days\' pay', '$$ up to 15 days', '$$$ more'].map((t, k) => `<span><i style="background:var(--ec-seq${k + 1})"></i>${t}: ${Math.round((w.tiers[k] || 0) / wt * 100)}%</span>`).join('')}</div>
          <p class="hint">On average ${vc(w.average)} each, ${w.residents} residents.</p></div>
      </div>
      <div class="tier-head">💰 Money over the last 30 days</div>
      ${lineChart([{ label: 'Money supply', points: S.supply || [] }, { label: 'Treasury', points: S.treasury || [] }], { fmt: 'vc' })}
      <div class="tier-head">🔄 Yesterday's flows</div>
      ${y.sales !== undefined ? barList([
        { label: 'Takings at venues and companies', icon: '🏪', value: y.sales }, { label: 'Wages', icon: '👷', value: y.wages }, { label: 'Rent', icon: '🏠', value: y.rent },
        { label: 'Sold abroad (exports)', icon: '🚢', value: y.exports }, { label: 'Bought on the market (imports)', icon: '📦', value: y.imports },
        { label: 'Taxes', icon: '🏛️', value: (y.taxIncome || 0) + (y.taxSales || 0) + (y.taxExports || 0) + (y.taxProfit || 0) }, { label: 'Benefits and pensions', icon: '🧓', value: y.welfare }], { fmt: v0 }) : '<p class="hint">The first day hasn\'t been settled yet (each world day settles at 5 AM).</p>'}
      <div class="tier-head">🏆 Busiest businesses yesterday</div>
      <div class="lib-list">${o.top.length ? o.top.map(b => `<button type="button" class="lib-row ec-brow" data-biz="${esc(b.id)}"><span class="lib-main"><b>${esc(b.name)}</b><span class="dim">${esc(b.kind)} · ${b.customers} customers · profit ${vc(b.profit)}</span></span><b>${vc(b.sales)}</b></button>`).join('') : '<p class="hint">None yet.</p>'}</div>
      <p class="hint">Export demand ${o.exportPct}% · Day ${o.day + 1}, ${Math.floor(o.hour)}:${String(Math.floor((o.hour % 1) * 60)).padStart(2, '0')} · Virtual Coin is never exchanged for money ($1 = 1,000 VC is for comparison only).</p>`;
  }

  // ------------------------------------------------------------------ budget
  function budget() {
    const B = data.budget; if (!B) return '<p class="hint">Loading…</p>';
    const inc = B.income.reduce((s, l) => s + l.yesterday, 0), exp = B.expenses.reduce((s, l) => s + l.yesterday, 0);
    const rows = list => list.map(l => ({ label: l.label, icon: l.icon, value: l.yesterday, note: `Last 7 days: ${vc(l.avg)} a day on average` }));
    const top = Math.max(1, ...B.income.map(l => l.yesterday), ...B.expenses.map(l => l.yesterday));
    const T = B.taxes;
    return `<div class="ec-tiles">
        ${tile('Treasury', vc(B.treasury.balance), { note: 'The city\'s purse' })}
        ${tile('Income yesterday', vc(inc))}${tile('Expenses yesterday', vc(exp))}
        ${tile('Net yesterday', `${B.net.yesterday >= 0 ? '+' : ''}${vc(B.net.yesterday)}`, { note: `7-day average ${vc(B.net.avg)} a day` })}
      </div>
      ${B.cuts.welfare || B.cuts.upkeep ? `<p class="hint bad">⚠️ The treasury ran short yesterday: ${B.cuts.welfare ? `benefits cut by ${vc(B.cuts.welfare)}` : ''}${B.cuts.welfare && B.cuts.upkeep ? ' and ' : ''}${B.cuts.upkeep ? `upkeep cut by ${vc(B.cuts.upkeep)}` : ''}. Raise taxes, end ordinances or issue a bond.</p>` : ''}
      <div class="ec-two"><div><div class="tier-head">⬆️ Income</div>${barList(rows(B.income), { fmt: v0, color: 'var(--ec-1)', max: top })}</div>
        <div><div class="tier-head">⬇️ Expenses</div>${barList(rows(B.expenses), { fmt: v0, color: 'var(--ec-2)', max: top })}</div></div>
      <div class="tier-head">📈 The last 30 days</div>
      ${lineChart([{ label: 'Income', points: B.history.map(r => [r.day, r.income]) }, { label: 'Expenses', points: B.history.map(r => [r.day, r.expenses]) }], { fmt: 'vc' })}
      <div class="tier-head">🛠️ What the city runs (a day)</div>
      <div class="lib-list">${B.upkeep.map(u => `<div class="lib-row ec-line"><div class="lib-main"><b>${esc(u.label)}</b></div><b>${vc(u.amount)}</b></div>`).join('')}</div>
      <div class="tier-head">🧾 Taxes</div>
      ${admin() ? `<div class="ec-form ec-taxes">
          ${T.income.map((b, k) => slider(`inc${k}`, `Income tax ${'$'.repeat(k + 1)} — ${b.upTo ? `up to ${vc(b.upTo)} a day` : 'above'}`, b.bp)).join('')}
          ${slider('sales', 'Sales tax (on purchases)', T.sales)}${slider('exports', 'Business tax (companies\' sales abroad)', T.exports)}${slider('venueProfit', 'Profit tax (venues)', T.venueProfit)}
          <div class="lib-btns"><button type="button" class="btn primary" data-c="taxes">Save the tax rates</button></div></div>`
        : `<div class="lib-list">${T.income.map((b, k) => `<div class="lib-row ec-line"><div class="lib-main"><b>Income tax ${'$'.repeat(k + 1)}</b><span class="dim">${b.upTo ? `on a day's income up to ${vc(b.upTo)}` : 'above that'}</span></div><b>${b.bp / 100}%</b></div>`).join('')}
          <div class="lib-row ec-line"><div class="lib-main"><b>Sales tax</b></div><b>${T.sales / 100}%</b></div><div class="lib-row ec-line"><div class="lib-main"><b>Business tax</b></div><b>${T.exports / 100}%</b></div><div class="lib-row ec-line"><div class="lib-main"><b>Profit tax</b></div><b>${T.venueProfit / 100}%</b></div></div>`}
      <div class="tier-head">📜 Ordinances</div>
      <div class="lib-list">${Object.entries(B.ordinances).map(([k, o]) => `<div class="lib-row"><div class="lib-main"><b>${esc(o.icon)} ${esc(o.label)} ${o.on ? '<span class="tag set">On</span>' : '<span class="tag">Off</span>'}</b><span class="dim">${esc(o.desc)}${o.cost ? ` · ${vc(o.cost)} a day` : ''}</span></div>${admin() ? `<div class="lib-acts"><button type="button" class="btn small" data-ord="${esc(k)}" data-on="${o.on ? 0 : 1}">${o.on ? 'Repeal' : 'Enact'}</button></div>` : ''}</div>`).join('')}</div>
      <div class="tier-head">🏦 Bonds</div>
      <div class="lib-list">${B.loans.length ? B.loans.map(l => `<div class="lib-row ec-line"><div class="lib-main"><b>${vc(l.principal)} over ${l.termDays} days</b><span class="dim">${l.status} · ${vc(l.outstanding)} left · ${vc(l.installment)} a day · ${l.rateBp / 100}% a week</span></div></div>`).join('') : '<p class="hint">The city owes nothing.</p>'}</div>
      ${admin() ? `<div class="ec-form"><label>Issue a bond<span class="row"><input class="input ec-bond" inputmode="decimal" placeholder="VC"><input class="input ec-bonddays" inputmode="numeric" placeholder="days" value="${B.loanRules.termDays}"><button type="button" class="btn small" data-c="bond">Borrow</button></span></label>
        <p class="hint">The bank lends the treasury now; it is paid back each day with interest (${B.loanRules.cityRateBp / 100}% a week). The city may owe at most ${vc(B.loanRules.cityMaxDebt)}.</p></div>` : ''}
      <p class="hint">${B.roadKm} km of road. Everyone can read the budget; administrators change it.</p>`;
  }
  const slider = (k, label, bp) => `<label>${esc(label)}<span class="row"><input type="range" min="0" max="${k.startsWith('inc') ? 3000 : 2500}" step="50" value="${bp}" data-tax="${k}"><b class="ec-pct">${bp / 100}%</b></span></label>`;

  // ------------------------------------------------------------------ businesses
  function businesses() {
    const list = data.biz?.businesses; if (!list) return '<p class="hint">Loading…</p>';
    const key = { sales: b => b.yesterday?.sales || 0, profit: b => b.yesterday?.profit || 0, rating: b => b.rating, name: b => b.name };
    const rows = [...list].sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : key[sort](b) - key[sort](a)));
    const venues = list.filter(b => b.kind !== 'office'), losing = venues.filter(b => (b.yesterday?.profit || 0) < 0).length;
    return `<p class="hint">${list.length} businesses: ${venues.length} venues and ${list.length - venues.length} companies. ${losing} venues lost money yesterday.</p>
      <div class="seg">${[['sales', 'Takings'], ['profit', 'Profit'], ['rating', 'Rating'], ['name', 'Name']].map(([k, t]) => `<button type="button" class="btn small${sort === k ? ' on' : ''}" data-sort="${k}">${t}</button>`).join('')}</div>
      <div class="ec-table" role="table"><div class="ec-tr ec-th" role="row"><span>Business</span><span>Owner</span><span>★</span><span>Takings</span><span>Profit</span></div>
      ${rows.map(b => `<button type="button" class="ec-tr" role="row" data-biz="${esc(b.id)}"><span>${esc(b.name)} <small>${esc(b.kind)}</small></span><span>${esc(b.owner.name)}</span><span>${(b.rating / 100).toFixed(1)}</span><span>${b.yesterday ? v0(b.yesterday.sales) : '—'}</span><span class="${(b.yesterday?.profit || 0) < 0 ? 'bad' : ''}">${b.yesterday ? v0(b.yesterday.profit) : '—'}</span></button>`).join('')}</div>`;
  }
  // ------------------------------------------------------------------ jobs: the shift board and my work
  function jobs() {
    const J = data.jobs; if (!J) return '<p class="hint">Loading…</p>';
    const me = data.me, T = me?.trust;
    const mine = me ? `<div class="ec-tiles">${tile('Your trust', T ? (T.events < 5 ? 'New' : `${T.stars.toFixed(1)} ★`) : '—', { note: T ? `${T.word}: paying ${T.dims.pay}, working ${T.dims.work} (of 1000)` : '' })}${(me.xp || []).slice(0, 4).map(x => tile(`${x.icon} ${x.label}`, `Level ${x.level}`, { note: `${x.xp} XP · ${x.units} served` })).join('')}</div>
      ${me.active ? `<p class="hint">You are working: ${esc(me.active.roleLabel)} at ${esc(me.active.business?.name || '')}.</p>` : ''}
      ${me.history?.length ? `<details><summary class="hint">Your last shifts</summary><div class="lib-list">${me.history.slice(0, 8).map(s => `<div class="lib-row ec-line"><div class="lib-main"><b>${esc(s.roleLabel)} at ${esc(s.business?.name || '')}</b><span class="dim">${s.served} ${esc(s.units)}${s.avgStars ? ` · ${s.avgStars} ★` : ''} · ${new Date(s.started).toLocaleString()}</span></div><b>${vc(s.pay)}</b></div>`).join('')}</div></details>` : ''}` : '';
    const rows = J.board.map(v => `<div class="lib-row ec-shift${v.open ? '' : ' closed'}"><div class="lib-main"><b>${esc(v.business.name)}</b><span class="dim">${esc(v.business.kind)} · ★ ${(v.business.rating / 100).toFixed(1)} · ${v.open ? 'open now' : 'closed now'}${v.waiting ? ` · <b>🧾 ${v.waiting} customer${v.waiting === 1 ? '' : 's'} waiting</b>` : ''}${v.residents.length ? ` · on staff: ${esc(v.residents.slice(0, 3).join(', '))}${v.residents.length > 3 ? '…' : ''}` : ''}</span></div>
      <div class="lib-acts">${v.roles.map(r => `<button type="button" class="btn small${r.free && v.open ? '' : ' off'}" data-job="${esc(v.business.id)}" data-role="${esc(r.role)}" ${r.free && v.open && auth.account ? '' : 'disabled'} title="${r.taken.length ? `Working: ${esc(r.taken.map(t => t.name).join(', '))}` : 'Residents work it now'}">${r.icon} ${esc(r.label)} · ${r.free}/${r.slots} free · ${vc(r.wage)}/h</button>`).join('')}</div></div>`).join('');
    return `${mine}<p class="hint">Work a shift in place of a venue's own staff: users first, then agents, then the residents whose job it is. Pay is the wage for the time worked (at the world's usual pace) times your stars; customers who ordered tip good service. Busy venues have customers waiting. You work where you stand: go there first.</p>
      <div class="lib-list">${rows || '<p class="hint">No venues.</p>'}</div>`;
  }
  // ------------------------------------------------------------------ the Global Market
  function market() {
    const M = data.market; if (!M) return '<p class="hint">Loading…</p>';
    return `<p class="hint">What the city's venues pay for their stock today, per unit. Prices move with the city's own demand and the world's; a venue's costs follow them. Export demand is ${M.exportPct}% (the stabiliser keeps the money supply growing with activity, not faster).</p>
      <div class="ec-table ec-mkt" role="table"><div class="ec-tr ec-th" role="row"><span>Commodity</span><span>Today</span><span>Change</span><span>30 days</span><span>Used yesterday</span></div>
      ${M.commodities.map(c => `<div class="ec-tr" role="row"><span>${esc(c.icon)} ${esc(c.label)}</span><span>${vc(c.now)}</span><span class="${c.change > 0 ? 'bad' : c.change < 0 ? 'good' : ''}">${c.change > 0 ? '▲' : c.change < 0 ? '▼' : '•'} ${Math.abs(c.change)}%</span><span>${sparkline(c.history.map(p => p[1]))}</span><span>${compact(c.used)}</span></div>`).join('')}</div>
      ${lineChart(M.commodities.slice(0, 4).map(c => ({ label: c.label, points: c.history })), { fmt: 'vc', zero: false, h: 160 })}
      <p class="hint">Four of them charted; every one is in the table.</p>`;
  }
  // ------------------------------------------------------------------ the price index
  function prices() {
    const I = data.index; if (!I) return '<p class="hint">Loading…</p>';
    return `<div class="ec-tiles">${tile('Price index', I.level.toFixed(1), { delta: I.change, deltaGood: false })}${tile('The basket', vc(I.basket))}</div>
      ${lineChart([{ label: 'Price index', points: I.history }], { fmt: 'idx', zero: false, area: true })}
      <div class="lib-list">${I.items.map(it => `<div class="lib-row ec-line"><div class="lib-main"><b>${esc(it.label)}</b><span class="dim">the median price charged</span></div><span>${sparkline(it.history.map(p => p[1]))}</span><b>${it.median ? vc(it.median) : '—'}</b></div>`).join('')}</div>
      <p class="hint">${esc(I.method)}. Virtual Coin is never exchanged for money.</p>`;
  }
  // ------------------------------------------------------------------ the treasury's ledger
  function ledger() {
    const L = data.ledger; if (!L) return '<p class="hint">Loading…</p>';
    return `<p class="hint">Every coin in and out of the city's purse — public, as the city's books should be. Balance ${vc(L.wallet.balance)}.</p>
      <div class="lib-list ec-stmt">${L.statement.map(l => `<div class="lib-row ec-line"><div class="lib-main"><b>${esc(l.memo || l.kind)}</b><span class="dim">${l.with ? `${esc(l.with)} · ` : ''}${new Date(l.at).toLocaleString()}${l.note ? ` · ${esc(l.note)}` : ''}</span></div><b class="${l.amount > 0 ? 'good' : ''}">${l.amount > 0 ? '+' : ''}${vc(l.amount)}</b></div>`).join('') || '<p class="hint">Nothing yet.</p>'}</div>`;
  }

  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); clearInterval(timer); window.removeEventListener('resize', onResize); if (dlg?.el === el) dlg = null; };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('input', e => { const r = e.target.closest('[data-tax]'); if (r) r.parentElement.querySelector('.ec-pct').textContent = `${r.value / 100}%`; });
  el.addEventListener('click', async e => {
    if (e.target === el) return close();
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); await load(); return; }
    const s = e.target.closest('[data-sort]'); if (s) { sort = s.dataset.sort; render(); return; }
    const bz = e.target.closest('[data-biz]'); if (bz) { app.econ?.openBusiness(bz.dataset.biz); return; }
    const jb = e.target.closest('[data-job]'); if (jb) { const s = await app.work?.start(jb.dataset.job, jb.dataset.role); if (s) close(); return; }
    const err = box.querySelector('.ec-err');
    const act = async (b, fn, done) => { b.disabled = true; try { await fn(); app.toast?.(done, 'good', 2400); await load(); } catch (x) { if (!x.quiet) err.textContent = x.message; b.disabled = false; } };
    const o = e.target.closest('[data-ord]');
    if (o) return act(o, () => post('/api/economy/admin/policy', { policy: { ordinances: { [o.dataset.ord]: { on: o.dataset.on === '1' } } } }), o.dataset.on === '1' ? 'Enacted.' : 'Repealed.');
    const b = e.target.closest('[data-c]'); if (!b) return;
    if (b.dataset.c === 'close') return close();
    if (b.dataset.c === 'taxes') {
      const val = k => +box.querySelector(`[data-tax="${k}"]`).value;
      const income = data.budget.taxes.income.map((br, k) => ({ upTo: br.upTo, bp: val(`inc${k}`) }));
      return act(b, () => post('/api/economy/admin/policy', { policy: { taxes: { income, sales: val('sales'), exports: val('exports'), venueProfit: val('venueProfit') } } }), 'Tax rates saved: they apply from the next settlement.');
    }
    if (b.dataset.c === 'bond') {
      const amount = Math.round(Number(box.querySelector('.ec-bond').value.replace(/[^0-9.]/g, '')) * 100), days = Number(box.querySelector('.ec-bonddays').value);
      if (!(amount > 0)) { err.textContent = 'How much?'; return; }
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = `Tap again to borrow ${vc(amount)}`; return; }
      return act(b, () => post('/api/economy/admin/bond', { amount, days }), 'The bond was issued.');
    }
  });
  const timer = setInterval(() => { if (!document.hidden && tab === 'overview') load(); }, 15000);
  const onResize = () => paint(box);
  window.addEventListener('resize', onResize);
  dlg = { el, close };
  render();
  load();
}
