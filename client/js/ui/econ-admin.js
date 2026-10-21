// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Settings → Economy (administrators; server/economy/routes.js /api/economy/admin*): switching the economy on (the
// owner) and pausing it (the kill switch), its health (the books balance and the signed chain holds), the policy
// (every wage, price, rent, tax, benefit, upkeep and limit), grants and corrections with a reason, freezing a wallet,
// and looking a wallet up. Taxes, ordinances and bonds are also in the city's economy window (📊 → Budget).
import { esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { vc } from './economy.js';

let app = null;
export function useEconAdmin(a) { app = a; }
const v2 = n => (n / 100).toFixed(2).replace(/\.00$/, '');
const cents = v => { const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
// policy fields: [path, label, kind ('vc' amount, 'pct' basis points shown as %, 'n' a plain number)]
const GROUPS = [
  ['🧾 Taxes and fees', [['taxes.sales', 'Sales tax (on purchases)', 'pct'], ['taxes.exports', 'Business tax (companies\' sales abroad)', 'pct'], ['taxes.venueProfit', 'Profit tax (venues\' daily profit)', 'pct'], ['fees.worldFeeBp', 'World fee on property sold between players (destroyed)', 'pct']]],
  ['🎁 Starting money', [['endowment.account', 'A new player', 'vc'], ['endowment.agent', 'A new agent', 'vc'], ['endowment.memberAgents', 'A member\'s agents that get it (the first …)', 'n'], ['endowment.resident', 'A new resident', 'vc'], ['endowment.business', 'A new city venue', 'vc'], ['endowment.company', 'A new city company', 'vc'], ['endowment.treasury', 'The city\'s treasury when the economy starts', 'vc']]],
  ['👷 Wages (an hour)', [['minWage', 'Minimum wage', 'vc'], ['wages.office', 'Office worker', 'vc'], ['wages.vip', 'AI agent at the headquarters', 'vc'], ['wages.barista', 'Barista', 'vc'], ['wages.chef', 'Chef', 'vc'], ['wages.server', 'Server', 'vc'], ['wages.cashier', 'Cashier', 'vc'], ['wages.trainer', 'Trainer', 'vc'], ['wages.receptionist', 'Receptionist', 'vc']]],
  ['🏠 Rent (a night)', [['rent.studio', 'Studio', 'vc'], ['rent.one', 'One bedroom', 'vc'], ['rent.two', 'Two bedrooms', 'vc'], ['rent.larger', 'Larger', 'vc'], ['rent.landMinPct', 'Land factor: lowest (%)', 'n'], ['rent.landMaxPct', 'Land factor: highest (%)', 'n'], ['leases.graceDays', 'Days of grace when a tenant can\'t pay', 'n']]],
  ['🧓 Benefits (a day)', [['welfare.pension', 'Pension', 'vc'], ['welfare.student', 'Student grant', 'vc'], ['welfare.unemployed', 'Unemployment benefit', 'vc'], ['welfare.allowance', 'Basic allowance', 'vc']]],
  ['🛠️ Upkeep (a day)', [['upkeep.roadPerKm', 'Roads, per km', 'vc'], ['upkeep.park', 'Each park', 'vc'], ['upkeep.station', 'Each metro station', 'vc'], ['upkeep.buildingFloor', 'Each building floor', 'vc'], ['upkeep.perResident', 'City services per resident', 'vc'], ['publicWorks.reserveDays', 'Treasury reserve (days of costs)', 'n'], ['publicWorks.pct', 'Public works: % of the excess a day', 'n']]],
  ['🚢 Trade', [['exports.officePerHour', 'Companies\' work sold abroad, an hour', 'vc'], ['exports.remotePerHour', 'Remote work sold abroad, an hour', 'vc'], ['stabilizer.targetBp', 'Money supply growth target a week', 'pct'], ['stabilizer.minPct', 'Export demand: lowest (%)', 'n'], ['stabilizer.maxPct', 'Export demand: highest (%)', 'n']]],
  ['💼 Jobs and shifts', [['jobs.tipMax', 'Largest tip for one order', 'vc'], ['jobs.tipsOfWagesPct', 'Tips at most (% of the wages)', 'n'], ['jobs.autoPayPct', 'Automatic shifts (agents): % of the wage', 'n'], ['jobs.autoDailyCap', 'Automatic shifts: most a day', 'vc'], ['jobs.autoNeedsPlayed', 'Automatic shifts: orders played there first', 'n']]],
  ['🎮 Game prizes (play modules)', [['play.base', 'A run pays this × difficulty × stars (0 = no prizes)', 'vc'], ['play.repeatPct', 'A repeat without a new best pays (%)', 'n'], ['play.firstStarPct', 'Each star won on a course for the first time: bonus (% of one unit)', 'n'], ['play.recordPct', 'A new first place: bonus (% of one unit)', 'n'], ['play.dailyCap', 'One player wins at most a day', 'vc']]],
  ['🏦 City bonds', [['loans.cityRateBp', 'Interest a week', 'pct'], ['loans.cityMaxDebt', 'The city may owe at most', 'vc'], ['loans.termDays', 'Usual term (days)', 'n']]],
  ['📜 Ordinances (their cost)', [['ordinances.freeMetro.cost', 'Free metro, a day', 'vc'], ['ordinances.tourism.cost', 'Tourism promotion, a day', 'vc'], ['ordinances.tourism.exportBoostBp', 'Tourism: extra export demand', 'pct'], ['ordinances.housingAssist.costPct', 'Housing assistance: share of the rent paid (%)', 'n'], ['ordinances.smallBusiness.capPerBiz', 'Small-business grants: most per business a day', 'vc']]],
  ['📈 The price index', [['index.minSamples', 'Price index: sales an item needs a day', 'n'], ['index.venueCapPct', 'Price index: one venue at most (% of a sample)', 'n']]],
  ['🛒 Households and prices', [['households.savingsTargetDays', 'Savings target (days of income)', 'n'], ['households.excessSpendPct', 'Spent of savings above it, a day (%)', 'n'], ['households.thriftyDays', 'Nights of rent kept back before treats', 'n'], ['food.pricePct', 'Food and drink: usual prices (% of the pack\'s)', 'n'], ['priceBounds.minPct', 'Owners price at least (% of usual)', 'n'], ['priceBounds.maxPct', 'Owners price at most (% of usual)', 'n'], ['pricing.stepPct', 'Automatic pricing step (%)', 'n']]],
  ['🔒 Limits', [['limits.reauthAbove', 'Ask for the password above', 'vc'], ['limits.transferMax', 'Largest payment', 'vc'], ['limits.transfersPerMin', 'Payments a minute', 'n'], ['agents.dailyCap', 'Agents: daily spending (default)', 'vc'], ['agents.approveAbove', 'Agents: owner approves above (default)', 'vc'], ['limits.newAccountDays', 'New accounts: days their payments are limited', 'n'], ['limits.newAccountSendPerDay', 'New accounts: pay other players at most a day', 'vc'], ['limits.openRequests', 'Open payment requests a player may have', 'n'], ['limits.requestDays', 'A payment request lasts (days)', 'n']]],
  ['🕔 Settlement', [['settleHour', 'Settlement hour (world time, 0–23)', 'n'], ['settlement.maxDaysPerTick', 'Missed days settled a second, at most', 'n']]],
];
const get = (o, p) => p.split('.').reduce((x, k) => x?.[k], o);
const set = (o, p, v) => { const ks = p.split('.'); let x = o; for (const k of ks.slice(0, -1)) x = x[k] ??= {}; x[ks[ks.length - 1]] = v; };

export async function econAdminTab(d, body) {
  let A = null, health = null, look = null;
  const load = async () => { try { A = await getJSON('/api/economy/admin'); render(); } catch (e) { d.error(e); } };
  const say = (m, k = 'good') => app?.toast?.(m, k, 3200);
  function render() {
    const p = A.policy, owner = auth.me?.role === 'owner';
    const field = ([path, label, kind]) => {
      const v = get(p, path), shown = kind === 'vc' ? v2(v) : kind === 'pct' ? (v / 100).toString() : String(v);
      return `<label>${esc(label)}${kind === 'pct' ? ' (%)' : kind === 'vc' ? ' (VC)' : ''}<span class="row"><input class="input ea-f" data-p="${path}" data-k="${kind}" inputmode="decimal" value="${esc(shown)}"></span></label>`;
    };
    body.innerHTML = `<div class="aform econadm">
      <div class="tier-head"><img class="vc-ico" src="/img/vc-64.png" alt="" aria-hidden="true"> Virtual Coin</div>
      <p><span class="tag${A.enabled ? ' set' : ''}">${A.enabled ? 'On' : 'Off'}</span> <span class="tag${A.paused ? '' : ' set'}">${A.paused ? '⏸ Paused' : 'Running'}</span>
        ${A.enabled ? `<span class="tag">${vc(A.supply?.total || 0)} in ${A.supply?.wallets || 0} wallets</span><span class="tag">${A.transactions} transactions</span>` : ''}</p>
      <p class="hint">${A.enabled ? 'Every player, agent, resident, business and the city has a wallet. Residents earn and spend every world day; the day settles at 5 AM.' : 'Switching it on gives every player, agent, resident, business and the city a wallet with its starting money, and the residents start earning and spending.'}</p>
      <div class="row wrap">${owner ? `<button type="button" class="btn small${A.enabled ? '' : ' primary'}" data-a="switch" data-on="${A.enabled ? 0 : 1}">${A.enabled ? 'Switch the economy off' : '<img class="vc-ico" src="/img/vc-64.png" alt="" aria-hidden="true"> Switch the economy on'}</button>` : '<span class="hint">Only the owner switches it on or off.</span>'}
        ${A.enabled ? `<button type="button" class="btn small" data-a="pause" data-on="${A.paused ? 0 : 1}">${A.paused ? '▶ Resume' : '⏸ Pause all money (kill switch)'}</button><button type="button" class="btn small" data-a="city">📊 The city's economy</button>` : ''}</div>
      ${A.enabled ? `<div class="sep"></div><div class="tier-head">🩺 Health</div>
        <div class="row wrap"><button type="button" class="btn small" data-a="health">Check the books</button><button type="button" class="btn small" data-a="settle">Settle any finished day now</button></div>
        ${health ? `<div class="keyinfo${health.ok ? '' : ' bad'}">${health.ok ? `✅ The books balance: every wallet matches its postings, every transaction sums to zero, the signed chain holds (${health.chain.checked} transactions checked).` : `⚠️ ${health.problems.length} problem${health.problems.length > 1 ? 's' : ''}: ${esc(health.problems.slice(0, 5).map(x => `${x.kind}${x.wallet ? ` ${x.wallet}` : ''}${x.tx ? ` tx ${x.tx}` : ''}${x.at ? ` at ${x.at}` : ''}`).join('; '))}`}<br>Issued ${vc(health.supply.issued)} · destroyed ${vc(health.supply.destroyed)} · in wallets ${vc(health.supply.total)}</div>` : ''}
        <div class="sep"></div><div class="tier-head">🎁 Grants and corrections</div>
        <div class="sh-grid"><label>Player's username<span class="row"><input class="input ea-login"></span></label><label>Amount (VC)<span class="row"><input class="input ea-amt" inputmode="decimal"></span></label></div>
        <label>Reason (kept in the ledger)<span class="row"><input class="input ea-why" maxlength="200"></span></label>
        <div class="row wrap"><button type="button" class="btn small" data-a="grant">Grant</button></div>
        <label>Reverse a transaction (its number or id)<span class="row"><input class="input ea-tx"><button type="button" class="btn small" data-a="correct">Reverse it</button></span></label>
        <p class="hint">Grants come from the grants faucet and are new money; a reversal posts the opposite of a transaction, naming it. Both need your password and a reason, and both are in the audit log.</p>
        <div class="sep"></div><div class="tier-head">🔎 Look a wallet up</div>
        <label>Username, or kind:id (resident:c12, business:biz_…, agent:3, city)<span class="row"><input class="input ea-look"><button type="button" class="btn small" data-a="look">Look up</button></span></label>
        ${look ? `<div class="keyinfo">${esc(look.wallet.owner.name)} · ${vc(look.wallet.balance)}${look.wallet.held ? ` (${vc(look.wallet.held)} held)` : ''} · ${look.wallet.status}${look.wallet.frozenWhy ? `: ${esc(look.wallet.frozenWhy)}` : ''}
          <div class="row wrap">${look.wallet.owner.kind !== 'city' ? `<button type="button" class="btn small" data-a="freeze" data-id="${esc(look.wallet.id)}" data-on="${look.wallet.status === 'frozen' ? 0 : 1}">${look.wallet.status === 'frozen' ? 'Unfreeze' : '🧊 Freeze (reason above)'}</button>` : ''}</div>
          <div class="ea-stmt">${look.statement.slice(0, 25).map(l => `<div><b class="${l.amount > 0 ? 'good' : ''}">${l.amount > 0 ? '+' : ''}${vc(l.amount)}</b> ${esc(l.memo || l.kind)} <span class="dim">#${l.seq} · ${new Date(l.at).toLocaleString()}${l.with ? ` · ${esc(l.with)}` : ''}</span></div>`).join('')}</div></div>` : ''}` : ''}
      <div class="sep"></div><div class="tier-head">📐 Policy</div>
      <p class="hint">Every number of the economy. Changes apply from the next world hour (wages, prices and taxes at the next settlement). Income tax by bracket, ordinances on and off and bonds are in the city's economy (📊 → Budget); the ads' prices and the owners' VC per 100 views in Settings → Shop. Menus and the Global Market's base prices are below.</p>
      ${GROUPS.map(([title, fields]) => `<details><summary>${esc(title)}</summary><div class="sh-grid">${fields.map(field).join('')}</div></details>`).join('')}
      <details><summary>🍽️ Shops' and gyms' usual prices (cafés and restaurants: each place's own menu from the food pack)</summary>${Object.entries(p.menus).map(([kind, items]) => `<div class="sh-grid">${items.map(it => `<label>${esc(it.icon)} ${esc(it.label)} (${esc(kind)}, VC)<span class="row"><input class="input ea-menu" data-kind="${esc(kind)}" data-id="${esc(it.id)}" inputmode="decimal" value="${v2(it.price)}"></span></label>`).join('')}</div>`).join('')}</details>
      <details><summary>🌐 Global Market base prices (a unit)</summary><div class="sh-grid">${Object.entries(p.commodities).map(([c, x]) => `<label>${esc(x.icon)} ${esc(x.label)} (VC)<span class="row"><input class="input ea-com" data-c="${esc(c)}" inputmode="decimal" value="${v2(x.base)}"></span></label>`).join('')}</div></details>
      <div class="row wrap"><button type="button" class="btn small primary" data-a="save">Save the policy</button><button type="button" class="btn small" data-a="reset">Back to the defaults</button></div>
    </div>`;
  }
  body.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, q = s => body.querySelector(s);
    const act = async (fn, done) => { b.disabled = true; try { const r = await fn(); if (done) say(done); await load(); app?.econ?.refresh?.(); return r; } catch (x) { if (x.code !== 'reauth_required') d.error(x); b.disabled = false; return null; } };
    if (a === 'switch') { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = b.dataset.on === '1' ? 'Tap again: switch it on' : 'Tap again: switch it off'; return; } await act(() => post('/api/economy/admin/switch', { name: 'enabled', on: b.dataset.on === '1' }), b.dataset.on === '1' ? 'The economy is on: every wallet has its starting money.' : 'The economy is off.'); }
    if (a === 'pause') await act(() => post('/api/economy/admin/switch', { name: 'paused', on: b.dataset.on === '1' }), b.dataset.on === '1' ? 'Paused: no money moves until you resume.' : 'Running again.');
    if (a === 'city') app?.econ?.openCity?.();
    if (a === 'health') { b.disabled = true; try { health = await getJSON('/api/economy/admin/health'); render(); } catch (x) { d.error(x); b.disabled = false; } }
    if (a === 'settle') { const r = await act(() => post('/api/economy/admin/settle', {})); if (r) say(r.settled.length ? `Settled ${r.settled.length} day(s).` : 'Nothing to settle: the current day is still running.'); }
    if (a === 'grant') { const amount = cents(q('.ea-amt').value); await act(() => post('/api/economy/admin/grant', { to: { kind: 'account', login: q('.ea-login').value.trim() }, amount, memo: q('.ea-why').value }), `Granted ${vc(amount)}.`); }
    if (a === 'correct') await act(() => post('/api/economy/admin/correct', { tx: q('.ea-tx').value.trim(), memo: q('.ea-why').value }), 'Reversed.');
    if (a === 'look') {
      const v = q('.ea-look').value.trim(), m = /^(resident|business|agent|account|wallet):(.+)$/.exec(v);
      const qs = v === 'city' ? 'kind=city' : m ? `kind=${m[1]}&id=${encodeURIComponent(m[2])}` : `kind=login&id=${encodeURIComponent(v)}`;
      try { look = await getJSON(`/api/economy/admin/wallet?${qs}`); render(); } catch (x) { d.error(x); }
    }
    if (a === 'freeze') await act(async () => { const r = await post('/api/economy/admin/freeze', { wallet: b.dataset.id, frozen: b.dataset.on === '1', memo: q('.ea-why')?.value || '' }); look.wallet = r.wallet; }, b.dataset.on === '1' ? 'Frozen.' : 'Unfrozen.');
    if (a === 'reset') { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again: every number back to the default'; return; } await act(() => post('/api/economy/admin/policy/reset', {}), 'The policy is back to the defaults.'); }
    if (a === 'save') {
      const patch = {};
      for (const i of body.querySelectorAll('.ea-f')) {
        const k = i.dataset.k, raw = i.value.trim(), num = Number(raw.replace(/[^0-9.-]/g, ''));
        if (!Number.isFinite(num)) continue;
        const v = k === 'vc' ? Math.round(num * 100) : k === 'pct' ? Math.round(num * 100) : Math.round(num);
        if (v !== get(A.policy, i.dataset.p)) set(patch, i.dataset.p, v);
      }
      const menus = {};
      for (const i of body.querySelectorAll('.ea-menu')) {
        const v = cents(i.value), items = menus[i.dataset.kind] || (menus[i.dataset.kind] = structuredClone(A.policy.menus[i.dataset.kind]));
        const it = items.find(x => x.id === i.dataset.id); if (it && Number.isSafeInteger(v) && v > 0) it.price = v;
      }
      for (const [k, items] of Object.entries(menus)) if (JSON.stringify(items) !== JSON.stringify(A.policy.menus[k])) (patch.menus ||= {})[k] = items;
      for (const i of body.querySelectorAll('.ea-com')) { const v = cents(i.value); if (Number.isSafeInteger(v) && v > 0 && v !== A.policy.commodities[i.dataset.c].base) set(patch, `commodities.${i.dataset.c}.base`, v); }
      if (!Object.keys(patch).length) { say('Nothing changed.', ''); return; }
      await act(() => post('/api/economy/admin/policy', { policy: patch }), 'The policy was saved.');
    }
  });
  body.innerHTML = '<p class="hint">Loading…</p>';
  await load();
}
