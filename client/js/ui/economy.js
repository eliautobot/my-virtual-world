// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy in the browser (docs/features/ECONOMY.md §10; server/economy/): the Virtual Coin balance in the top bar
// (a figure floats up when money moves), the wallet (activity, send, ask to be paid, requests, your businesses, your
// agents' wallets and limits, approvals), a venue's menu and buying there, a business's card and its owner's settings,
// and the economy lines in the selection panel (a building's business; a person's money is ui/sel-feeds.js). The city's economy window
// is ui/econ-city.js; Settings → Economy is ui/econ-admin.js.
import { S, bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { lineChart, hover, paint } from './econ-charts.js';
import { openMenuEditor, thumb, byCourse, cuisineLabel } from './food-menu.js';
import { mount as mountInventory, onClick as inventoryClick, onInput as inventoryInput } from './inventory.js';

let app = null;
const st = { status: null, me: null, wallet: null, dlg: null };
const E = {};
/** The Virtual Coin's symbol (its logo), as an image beside text: size 'sm' (text height) or 'lg'. */
export const coin = (size = 'sm') => `<img class="vc-ico ${size}" src="/img/vc-${size === 'lg' ? 128 : 64}.png" alt="" aria-hidden="true" draggable="false">`;
/** Hundredths of a VC for people: 1250 → "12.50 VC", 1200 → "12 VC". */
export function vc(n, unit = true) {
  if (!Number.isFinite(n)) return '-';
  const neg = n < 0, a = Math.abs(Math.trunc(n)), w = Math.floor(a / 100), c = a % 100;
  return `${neg ? '−' : ''}${w.toLocaleString('en-US')}${c ? `.${String(c).padStart(2, '0')}` : ''}${unit ? ' VC' : ''}`;
}
const toCents = v => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : NaN; };
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const key = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const KIND = { transfer: 'Payment', purchase: 'Purchase', wage: 'Wages', rent: 'Rent', settlement: 'Daily settlement', grant: 'Grant', reversal: 'Correction', fund: 'Funding', draw: 'Drawn', loan: 'Bond', loan_payment: 'Bond repayment', refund: 'Refund', property: 'Property', fee: 'Fee', tax: 'Tax', ad_income: 'Ads on your signs', prize: 'Game prize' };
const enabled = () => !!st.status?.enabled;
const member = () => !!auth.account && auth.can?.('economy.use');
function armed(b, text) {
  if (b.dataset.armed) return true;
  b.dataset.armed = '1'; const was = b.textContent; b.textContent = text;
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = was; } }, 3500);
  return false;
}

export async function init(a) {
  app = a;
  app.econ = { vc, coin, openWallet, openMenu, openBusiness, openCity, status: () => st.status, refresh, buyAt, lotListing, lotSection, flatSection };
  addTopbar();
  await refresh();
  bus.on('auth', refresh);
  bus.on('msg:economy', () => refresh());
  bus.on('msg:wallet', onWallet);
  bus.on('msg:econ', onNote);
  bus.on('msg:vlistings', () => loadRealty());
  app.inspHooks = app.inspHooks || { building: [], resident: [] };
  app.inspHooks.building.push(buildingCard);
  app.hooks?.key.push(e => {
    if (e.ctrlKey || e.metaKey || e.altKey || !enabled()) return false;
    if (e.code === 'KeyK' && !e.repeat) { openCity(); return true; }
    return false;
  });
}
async function refresh() {
  try { st.status = await getJSON('/api/economy/status'); } catch { st.status = null; }
  paintTopbar();
  if (enabled()) loadRealty();
}

// ------------------------------------------------------------------ property for Virtual Coin (server/economy/realty.js)
let realty = { kinds: [], listings: [], byTarget: new Map() };
async function loadRealty() {
  try {
    const r = await getJSON('/api/economy/realty');
    realty = { kinds: r.kinds, listings: r.listings, byTarget: new Map() };
    for (const l of r.listings) { if (!realty.byTarget.has(l.target)) realty.byTarget.set(l.target, []); realty.byTarget.get(l.target).push(l); }
    bus.emit('econ:listings');
  } catch { /* off */ }
}
/** A lot's listing for VC, shaped like the shop's for the property map: { price, currency: 'vc' } or null. */
function lotListing(id) { const l = realty.byTarget.get(id)?.find(x => x.kind === 'lot'); return l ? { ...l, currency: 'vc' } : null; }
const takeIt = async (b, l, done) => {
  b.disabled = true;
  try {
    const r = await post('/api/economy/realty/take', { id: l.id, idem: key() });
    app.toast?.(l.kind === 'flat_rent' ? `🔑 It's yours to live in: ${vc(l.perDay)} a day, paid each morning.` : l.kind === 'venue_rent' ? `🔑 It's yours to run: ${vc(l.perDay)} a day, paid each morning. Put money in its till for wages and stock.` : `🎉 Bought for ${vc(l.price)}.`, 'good', 5200);
    refresh(); await loadRealty(); done?.(r);
  } catch (x) { if (!x.quiet) app.toast?.(x.message, 'bad', 4200); b.disabled = false; }
};
/** The lot card's part (self-hosted): its listing to buy, or the holder's form to list it. */
function lotSection(box, { lot, mine, city, admin, reload }) {
  const l = lotListing(lot.id), mayList = (mine || (city && admin)) && realty.kinds.includes('lot');
  box.innerHTML = `${l ? `<div class="lc-sale"><b>🏷️ For sale: ${vc(l.price)}</b><span class="dim">by ${esc(l.seller.name)} · the world fee (${vc(l.fee)}) comes out of the price</span>
      ${mine || (city && admin) ? '<button type="button" class="btn small" data-x="unlist">Take it off sale</button>' : member() ? `<button type="button" class="btn small primary" data-x="buy">${coin()} Buy for ${vc(l.price)}</button>` : ''}</div>`
    : mayList ? `<div class="row"><input class="input lc-vcprice" inputmode="decimal" placeholder="Price in VC" size="10"><button type="button" class="btn small" data-x="list">🏷️ Sell for Virtual Coin</button></div>` : ''}`;
  box.onclick = async e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    if (b.dataset.x === 'buy') { if (!armed(b, `Tap again to pay ${vc(l.price)}`)) return; await takeIt(b, l, () => reload?.()); }
    if (b.dataset.x === 'unlist') { try { await post('/api/economy/realty/unlist', { id: l.id }); await loadRealty(); reload?.(); } catch (x) { if (!x.quiet) app.toast?.(x.message, 'bad'); } }
    if (b.dataset.x === 'list') {
      const price = toCents(box.querySelector('.lc-vcprice').value);
      if (!Number.isSafeInteger(price)) { app.toast?.('What price?', 'bad'); return; }
      try { await post('/api/economy/realty/list', { kind: 'lot', target: lot.id, price }); app.toast?.(`Listed for ${vc(price)}.`, 'good'); await loadRealty(); reload?.(); } catch (x) { if (!x.quiet) app.toast?.(x.message, 'bad'); }
    }
  };
}
/** The flat window's part: for rent or for sale in VC, the lease, and the holder's form to let or sell it. */
async function flatSection(box, { ref, power, reload }) {
  if (!ref) return;
  let j;
  try { j = await getJSON(`/api/economy/realty/on?target=${encodeURIComponent(ref)}`); } catch { return; }
  if (!box.isConnected) return;
  const rent = j.listings.find(x => x.kind === 'flat_rent'), sale = j.listings.find(x => x.kind === 'flat_sale'), L = j.lease;
  const meTenant = L && L.tenant.kind === 'account' && String(L.tenant.id) === String(auth.account?.id);
  const mayList = power === 'own' || power === 'keep';
  box.innerHTML = `<b>${coin()} Virtual Coin</b>
    ${L ? `<p>Let to <b>${esc(L.tenant.name)}</b> for ${vc(L.rent)} a day (${vc(L.monthly)} a month)${L.status === 'due' ? ' · <b class="bad">rent overdue</b>' : ''}.</p>${meTenant || mayList ? `<div class="row"><button type="button" class="btn small" data-x="end" data-id="${esc(L.id)}">${meTenant ? 'Move out' : 'End the lease'}</button></div>` : ''}` : ''}
    ${rent ? `<p>For rent: <b>${vc(rent.price)} a month</b> (${vc(rent.perDay)} a day, paid each morning) by ${esc(rent.seller.name)}.</p><div class="row">${mayList ? '<button type="button" class="btn small" data-x="unlist" data-id="' + esc(rent.id) + '">Take it off</button>' : member() ? `<button type="button" class="btn small primary" data-x="take" data-id="${esc(rent.id)}">🔑 Rent it</button>` : ''}</div>` : ''}
    ${sale ? `<p>For sale: <b>${vc(sale.price)}</b> by ${esc(sale.seller.name)}.</p><div class="row">${mayList ? '<button type="button" class="btn small" data-x="unlist" data-id="' + esc(sale.id) + '">Take it off</button>' : member() ? `<button type="button" class="btn small primary" data-x="take" data-id="${esc(sale.id)}">${coin()} Buy it</button>` : ''}</div>` : ''}
    ${mayList && !L && !rent && !sale ? `<div class="row"><input class="input fl-vcprice" inputmode="decimal" placeholder="VC" size="8"><button type="button" class="btn small" data-x="listrent">Let it (a month)</button>${j.kinds.includes('flat_sale') ? '<button type="button" class="btn small" data-x="listsale">Sell it</button>' : ''}</div><span class="dim">Tenants pay by the day from their wallet; residents living there move out.</span>` : ''}
    ${!L && !rent && !sale && !mayList ? '<span class="dim">Not on offer for Virtual Coin.</span>' : ''}`;
  box.onclick = async e => {
    const b = e.target.closest('[data-x]'); if (!b) return;
    const all = [rent, sale].filter(Boolean), l = all.find(x => x.id === b.dataset.id);
    try {
      if (b.dataset.x === 'take') { if (!armed(b, l.kind === 'flat_rent' ? `Tap again: ${vc(l.perDay)} now, then daily` : `Tap again to pay ${vc(l.price)}`)) return; await takeIt(b, l, () => reload?.()); return; }
      if (b.dataset.x === 'unlist') await post('/api/economy/realty/unlist', { id: b.dataset.id });
      if (b.dataset.x === 'end') { if (!armed(b, 'Tap again to end it')) return; await post('/api/economy/realty/end', { lease: b.dataset.id }); app.toast?.('The lease ended.', 'good'); }
      if (b.dataset.x === 'listrent' || b.dataset.x === 'listsale') {
        const price = toCents(box.querySelector('.fl-vcprice').value);
        if (!Number.isSafeInteger(price)) { app.toast?.('What price?', 'bad'); return; }
        await post('/api/economy/realty/list', { kind: b.dataset.x === 'listrent' ? 'flat_rent' : 'flat_sale', target: ref, price });
        app.toast?.('On offer.', 'good');
      }
      await loadRealty(); reload?.();
    } catch (x) { if (!x.quiet) app.toast?.(x.message, 'bad'); }
  };
}

// ------------------------------------------------------------------ the top bar
function addTopbar() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  const before = bar.querySelector('.helpb');
  // The city's economy opens from the wallet (its "City economy" button, for every member) and with K: no button of its own
  E.chip = h(`<button type="button" class="btn ec-chip hidden" title="Your wallet" aria-label="Your wallet"><span class="ec-coin">${coin()}</span><b> - </b></button>`);
  bar.insertBefore(E.chip, before);
  E.chip.onclick = () => openWallet();
}
function paintTopbar() {
  if (!E.chip) return;
  const on = enabled();
  E.chip.classList.toggle('hidden', !on || !member());
  if (on && member() && Number.isFinite(st.status.balance)) {
    E.chip.querySelector('b').textContent = vc(st.status.balance, false);
    E.chip.title = `Your wallet: ${vc(st.status.balance)}${st.status.available !== st.status.balance ? ` (${vc(st.status.available)} available)` : ''}`;
  }
}
/** Money moved in one of my wallets: the balance follows, and a figure floats up from the chip. */
function onWallet(m) {
  for (const c of m.changes || []) {
    if (c.wallet !== st.status?.walletId) continue;
    const held = (st.status.balance ?? c.balance) - (st.status.available ?? c.balance);
    st.status.balance = c.balance; st.status.available = c.balance - held;
    floatUp(c.amount);
  }
  paintTopbar();
  if (st.dlg) st.dlg.reload();
}
function floatUp(amount) {
  if (!E.chip || E.chip.classList.contains('hidden') || !amount) return;
  const r = E.chip.getBoundingClientRect();
  const el = document.body.appendChild(h(`<div class="ec-float ${amount > 0 ? 'up' : 'down'}">${amount > 0 ? '+' : '−'}${esc(vc(Math.abs(amount)))}</div>`));
  el.style.left = `${r.left + r.width / 2}px`; el.style.top = `${r.bottom + 4}px`;
  setTimeout(() => el.remove(), 1700);
}
function onNote(m) {
  const say = (t, k = '') => app.toast?.(t, k, 5200);
  if (m.ev === 'paid') app.toast?.(`${m.from} paid you ${vc(m.amount)}${m.memo ? ` - “${m.memo}”` : ''}`, 'good', 5200, '/img/vc-64.png');
  else if (m.ev === 'request') say(`🧾 ${m.from} asks you to pay ${vc(m.amount)}${m.memo ? ` for “${m.memo}”` : ''}. Open your wallet to answer.`);
  else if (m.ev === 'approval') say(`🤖 ${m.agent} wants to spend ${vc(m.amount)} (${m.summary}). Open your wallet to approve.`);
  else if (m.ev === 'frozen') say(`🧊 Your wallet was frozen by an administrator${m.memo ? `: ${m.memo}` : ''}.`, 'bad');
  else if (m.ev === 'unfrozen') say('Your wallet is open again.', 'good');
}

// ------------------------------------------------------------------ the wallet
async function openWallet(tab = 'activity') {
  if (!auth.account) { auth.ui?.signIn('Sign in to see your wallet'); return; }
  if (!enabled()) { app.toast?.('The economy is switched off here.'); return; }
  st.dlg?.close();
  const el = document.body.appendChild(h('<div class="modal-back lib-back ec-back"><div class="panel libdlg ecdlg" role="dialog" aria-modal="true" aria-label="Wallet"></div></div>'));
  const box = el.querySelector('.ecdlg');
  let stmt = [], more = true, filter = '', sendTo = null;
  const TABS = [['activity', 'Activity'], ['items', 'Inventory'], ['send', 'Send'], ['requests', 'Requests'], ['property', 'Home & property'], ['businesses', 'Businesses'], ['agents', 'Agents']];
  const render = () => {
    const me = st.me;
    if (!me) { box.innerHTML = '<p class="hint">Loading…</p>'; return; }
    const w = me.wallet, reqs = me.requestsToPay.length, appr = me.approvals.length;
    let body = '';
    if (tab === 'activity') {
      body = `<div class="seg ec-filter">${[['', 'All'], ['settlement', 'Daily'], ['purchase', 'Purchases'], ['transfer', 'Payments'], ['wage', 'Wages'], ['ad_income', 'Ads'], ['prize', 'Prizes'], ['grant', 'Grants']].map(([k, t]) => `<button type="button" class="btn small${filter === k ? ' on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
        <div class="lib-list ec-stmt">${stmt.length ? stmt.map(line).join('') : '<p class="hint">Nothing yet. Money you earn, spend, send and receive shows here.</p>'}</div>
        ${more && stmt.length >= 40 ? '<button type="button" class="btn small" data-w="more">Older</button>' : ''}`;
    } else if (tab === 'items') {
      body = '<div class="inv-host"></div>';   // (ui/inventory.js fills it)
    } else if (tab === 'send') {
      body = `<div class="ec-form">
        <label>To<span class="ec-pick"><input class="input ec-to" placeholder="A player, an agent or a business" autocomplete="off" value="${esc(sendTo?.name || '')}"><span class="ec-res panel hidden"></span></span></label>
        <label>Amount (VC)<input class="input ec-amt" inputmode="decimal" placeholder="0.00"></label>
        <label>What for<input class="input ec-memo" maxlength="140" placeholder="Optional: lunch, rent, a commission…"></label>
        <div class="lib-btns"><button type="button" class="btn" data-w="ask">🧾 Ask them to pay</button><button type="button" class="btn primary" data-w="send">${coin()} Send</button></div>
        <p class="hint">Payments are instant and final. More than ${vc(me.limits.reauthAbove)} asks for your password again. An administrator can reverse a payment made by mistake.</p></div>`;
    } else if (tab === 'requests') {
      body = `<h4>Asked of you</h4><div class="lib-list">${me.requestsToPay.length ? me.requestsToPay.map(r => `<div class="lib-row"><div class="lib-main"><b>${vc(r.amount)} to ${esc(r.payee.name)}</b><span class="dim">${r.memo ? `“${esc(r.memo)}” · ` : ''}asked ${when(r.created)} · until ${when(r.expires)}</span></div><div class="lib-acts"><button type="button" class="btn small primary" data-w="payreq" data-id="${esc(r.id)}">Pay ${vc(r.amount)}</button><button type="button" class="btn small" data-w="declinereq" data-id="${esc(r.id)}">Decline</button></div></div>`).join('') : '<p class="hint">Nobody is asking you for money.</p>'}</div>
        <h4>You asked</h4><div class="lib-list">${me.requestsSent.length ? me.requestsSent.slice(0, 30).map(r => `<div class="lib-row"><div class="lib-main"><b>${vc(r.amount)} from ${esc(r.payer.name)}</b><span class="dim">${r.memo ? `“${esc(r.memo)}” · ` : ''}${{ open: 'waiting', paid: '✅ paid', declined: 'declined', cancelled: 'cancelled', expired: 'expired' }[r.status] || esc(r.status)} · ${when(r.created)}</span></div>${r.status === 'open' ? '<div class="lib-acts"><button type="button" class="btn small" data-w="cancelreq" data-id="' + esc(r.id) + '">Cancel</button></div>' : ''}</div>`).join('') : '<p class="hint">None.</p>'}</div>`;
    } else if (tab === 'property') {
      const R = me.leases || { rent: [], let: [] }, mine = realty.listings.filter(l => l.seller.kind === 'account' && String(l.seller.id) === String(auth.account?.id));
      const leaseRow = (L, who) => `<div class="lib-row${L.status === 'due' ? ' due' : ''}"><div class="lib-main"><b>${esc(L.title)}</b><span class="dim">${who} · ${vc(L.rent)} a day · ${L.status === 'ended' ? `ended${L.why ? `: ${esc(L.why)}` : ''}` : L.status === 'due' ? '<b class="bad">rent overdue: add money or you\'ll have to move out</b>' : 'paid each morning'}</span></div>${L.status !== 'ended' ? `<div class="lib-acts"><button type="button" class="btn small" data-w="endlease" data-id="${esc(L.id)}">${who.startsWith('from') ? 'Move out' : 'End the lease'}</button></div>` : ''}</div>`;
      body = `<h4>Where you rent</h4><div class="lib-list">${R.rent.length ? R.rent.map(L => leaseRow(L, `from ${esc(L.landlord.name)}`)).join('') : '<p class="hint">You rent nothing for Virtual Coin. A flat\'s window (a building\'s floor → Flats) shows what is for rent.</p>'}</div>
        <h4>What you let</h4><div class="lib-list">${R.let.length ? R.let.map(L => leaseRow(L, `to ${esc(L.tenant.name)}`)).join('') : '<p class="hint">None.</p>'}</div>
        <h4>On offer</h4><div class="lib-list">${mine.length ? mine.map(l => `<div class="lib-row"><div class="lib-main"><b>${l.kind === 'lot' ? `Lot ${esc(l.target)}` : l.kind === 'venue_rent' ? `${bizIcon(l.business?.kind)} ${esc(l.business?.name || 'A business')}` : `Flat ${esc(l.target)}`}</b><span class="dim">${l.kind.endsWith('_rent') ? `for rent, ${vc(l.price)} a month` : `for sale, ${vc(l.price)}`}</span></div><div class="lib-acts"><button type="button" class="btn small" data-w="unlistvc" data-id="${esc(l.id)}">Take it off</button></div></div>`).join('') : '<p class="hint">Nothing listed for Virtual Coin.</p>'}</div>`;
    } else if (tab === 'businesses') {
      body = me.businesses.length ? `<div class="lib-list">${me.businesses.map(b => `<div class="lib-row"><div class="lib-main"><b>${bizIcon(b.kind)} ${esc(b.name)}</b><span class="dim">${vc(b.wallet.balance)} in the till · today ${vc(b.today?.sales || 0)} from ${b.today?.customers || 0} customers · ★ ${(b.rating / 100).toFixed(1)}</span></div><div class="lib-acts"><button type="button" class="btn small primary" data-w="biz" data-id="${esc(b.id)}">Run it</button></div></div>`).join('')}</div>`
        : `<p class="hint">You don't run a business yet. A café, restaurant, shop, gym or office building on a lot you hold is yours to run - or rent one: ${realty.listings.filter(l => l.kind === 'venue_rent').length ? `${realty.listings.filter(l => l.kind === 'venue_rent').length} for rent now (📊 City economy → Businesses, or a venue's 📒 card)` : 'a venue\'s 📒 card shows when its landlord lets it'}. Its takings come here.</p>`;
    } else {
      body = `${me.approvals.length ? `<h4>Waiting for your approval</h4><div class="lib-list">${me.approvals.map(p => `<div class="lib-row due"><div class="lib-main"><b>🤖 ${esc(p.agent.name)}: ${esc(p.action === 'buy' ? 'buy' : 'pay')} ${vc(p.amount)}</b><span class="dim">${p.action === 'pay' && p.payload.memo ? `“${esc(p.payload.memo)}” · ` : ''}asked ${when(p.created)}</span></div><div class="lib-acts"><button type="button" class="btn small primary" data-w="approve" data-id="${esc(p.id)}">Approve</button><button type="button" class="btn small" data-w="refuse" data-id="${esc(p.id)}">Decline</button></div></div>`).join('')}</div>` : ''}
        ${me.agents.length ? me.agents.map(agentBlock).join('') : '<p class="hint">Agents you own have their own wallets; they show here with the limits you set for them.</p>'}`;
    }
    box.innerHTML = `<h3><span>${coin('lg')} Wallet</span><button type="button" class="btn small" data-w="close" aria-label="Close">✕</button></h3>
      <div class="ec-bal"><div><span>Virtual Coin</span><b>${vc(w.balance)}</b>${w.held ? `<small>${vc(w.available)} available · ${vc(w.held)} set aside</small>` : ''}${w.status === 'frozen' ? `<small class="bad">🧊 Frozen${w.frozenWhy ? `: ${esc(w.frozenWhy)}` : ''}</small>` : ''}</div>
        <div class="ec-bal-acts"><button type="button" class="btn small" data-w="city">📊 City economy</button></div></div>
      <div class="seg wl-tabs" role="tablist">${TABS.map(([k, t]) => `<button type="button" class="btn small${tab === k ? ' on' : ''}" data-tab="${k}">${t}${k === 'requests' && reqs ? ` <span class="badge">${reqs}</span>` : ''}${k === 'agents' && appr ? ` <span class="badge">${appr}</span>` : ''}</button>`).join('')}</div>
      <div class="wl-body">${body}</div><p class="hint bad ec-err" role="alert"></p>`;
    if (tab === 'items') mountInventory(box.querySelector('.inv-host'));
  };
  const line = l => `<div class="lib-row ec-line"><div class="lib-main"><b>${esc(l.memo || KIND[l.kind] || l.kind)}</b><span class="dim">${esc(KIND[l.kind] || l.kind)}${l.with ? ` · ${esc(l.with)}` : ''} · ${when(l.at)}${l.note ? ` · ${esc(l.note)}` : ''}</span></div><b class="${l.amount > 0 ? 'good' : ''}">${l.amount > 0 ? '+' : ''}${vc(l.amount)}</b></div>`;
  const agentBlock = a => `<div class="lib-row ec-agent" data-agent="${a.id}"><div class="lib-main"><b><span data-avatar>${esc(a.emoji || '🤖')}</span> ${esc(a.name)} · ${vc(a.wallet.balance)}</b>
      <span class="dim">spent ${vc(a.limits.spent24h)} in the last 24 h · ${a.limits.paused ? '⏸ paused' : `may ${a.limits.scopes.length ? a.limits.scopes.join(', ') : 'do nothing with money'}`}</span></div>
    <div class="ec-lim">
      <label>Daily limit<input class="input" data-l="dailyCap" inputmode="decimal" value="${(a.limits.dailyCap / 100).toFixed(0)}"></label>
      <label>Ask me above<input class="input" data-l="approveAbove" inputmode="decimal" value="${(a.limits.approveAbove / 100).toFixed(0)}"></label>
      <div class="ec-scopes">${['work', 'buy', 'pay', 'rent', 'business'].map(s => `<label class="check"><input type="checkbox" data-scope="${s}"${a.limits.scopes.includes(s) ? ' checked' : ''}> ${s}</label>`).join('')}</div>
      <label class="check"><input type="checkbox" data-l="paused"${a.limits.paused ? ' checked' : ''}> Pause its spending</label></div>
    <div class="lib-acts"><button type="button" class="btn small" data-w="studio" data-id="${a.id}" title="Agent Studio: everything about it">${icon('agent')} Studio</button><button type="button" class="btn small primary" data-w="limits" data-id="${a.id}">Save limits</button><input class="input ec-mv" placeholder="VC" inputmode="decimal"><button type="button" class="btn small" data-w="fund" data-id="${a.id}">Give</button><button type="button" class="btn small" data-w="take" data-id="${a.id}">Take back</button></div></div>`;
  const loadStmt = async (reset = true) => {
    const before = !reset && stmt.length ? stmt[stmt.length - 1].seq : '';
    const j = await getJSON(`/api/economy/statement?limit=40${before ? `&before=${before}` : ''}${filter ? `&kind=${filter}` : ''}`);
    stmt = reset ? j.statement : stmt.concat(j.statement); more = j.statement.length >= 40;
  };
  const reload = async () => {
    try { st.me = await getJSON('/api/economy/me'); if (tab === 'activity') await loadStmt(); } catch (e) { box.innerHTML = `<p class="hint bad">${esc(e.message)}</p>`; return; }
    if (st.me.wallet) { st.status.balance = st.me.wallet.balance; st.status.available = st.me.wallet.available; paintTopbar(); }
    render();
  };
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); if (st.dlg?.el === el) st.dlg = null; };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  // the payee search
  let searchT = null;
  box.addEventListener('input', e => {
    if (tab === 'items' && inventoryInput(e)) return;
    if (!e.target.classList.contains('ec-to')) return;
    sendTo = null;
    clearTimeout(searchT);
    const q = e.target.value.trim(), res = box.querySelector('.ec-res');
    if (q.length < 2) { res.classList.add('hidden'); return; }
    searchT = setTimeout(async () => {
      try {
        const j = await getJSON(`/api/economy/search?q=${encodeURIComponent(q)}`);
        res.innerHTML = j.results.length ? j.results.map((r, k) => `<button type="button" class="ec-hit" data-k="${k}"><span data-avatar>${esc(r.emoji || (r.kind === 'account' ? '🧑' : '🤖'))}</span> ${esc(r.name)}${r.login ? ` <small>@${esc(r.login)}</small>` : ''}</button>`).join('') : '<span class="hint">Nobody by that name.</span>';
        res.classList.remove('hidden');
        res.onclick = ev => { const b = ev.target.closest('.ec-hit'); if (!b) return; sendTo = j.results[+b.dataset.k]; box.querySelector('.ec-to').value = sendTo.name; res.classList.add('hidden'); };
      } catch { /* the search is a convenience */ }
    }, 200);
  });
  el.addEventListener('click', async e => {
    if (e.target === el) return close();
    if (tab === 'items' && await inventoryClick(e)) return;
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; if (tab === 'activity') await loadStmt().catch(() => {}); render(); return; }
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; await loadStmt().catch(() => {}); render(); return; }
    const b = e.target.closest('[data-w]'); if (!b) return;
    const err = box.querySelector('.ec-err'), a = b.dataset.w;
    const act = async (fn, done) => { b.disabled = true; try { await fn(); if (done) app.toast?.(done, 'good', 2600); await reload(); } catch (x) { if (err && !x.quiet) err.textContent = x.message; b.disabled = false; } };
    const target = () => (sendTo ? { kind: sendTo.kind, id: sendTo.id } : null);
    switch (a) {
      case 'close': close(); break;
      case 'city': close(); openCity(); break;
      case 'more': await loadStmt(false).catch(() => {}); render(); break;
      case 'send': {
        const amount = toCents(box.querySelector('.ec-amt').value), memo = box.querySelector('.ec-memo').value;
        if (!target()) { err.textContent = 'Choose who gets it from the list.'; return; }
        if (!Number.isSafeInteger(amount)) { err.textContent = 'How much?'; return; }
        if (!armed(b, `Tap again to send ${vc(amount)}`)) return;
        await act(() => post('/api/economy/pay', { to: target(), amount, memo, idem: key() }), `Sent ${vc(amount)} to ${sendTo.name}.`);
        break;
      }
      case 'ask': {
        const amount = toCents(box.querySelector('.ec-amt').value), memo = box.querySelector('.ec-memo').value;
        if (!target() || target().kind === 'business') { err.textContent = 'Choose a player or an agent from the list.'; return; }
        if (!Number.isSafeInteger(amount)) { err.textContent = 'How much?'; return; }
        await act(() => post('/api/economy/request', { from: target(), amount, memo }), `Asked ${sendTo.name} for ${vc(amount)}.`);
        break;
      }
      case 'payreq': if (!armed(b, 'Tap again to pay')) return; await act(() => post('/api/economy/request/answer', { id: b.dataset.id, answer: 'pay' }), 'Paid.'); break;
      case 'declinereq': await act(() => post('/api/economy/request/answer', { id: b.dataset.id, answer: 'decline' }), 'Declined.'); break;
      case 'cancelreq': await act(() => post('/api/economy/request/answer', { id: b.dataset.id, answer: 'cancel' }), 'Cancelled.'); break;
      case 'biz': close(); openBusiness(b.dataset.id); break;
      case 'endlease': if (!armed(b, 'Tap again to end it')) return; await act(() => post('/api/economy/realty/end', { lease: b.dataset.id }), 'The lease ended.'); break;
      case 'unlistvc': await act(async () => { await post('/api/economy/realty/unlist', { id: b.dataset.id }); await loadRealty(); }, 'Taken off.'); break;
      case 'approve': if (!armed(b, 'Tap again to approve')) return; await act(async () => { const r = await post('/api/economy/approval/answer', { id: b.dataset.id, approve: true }); if (r.approval.status === 'failed') throw new Error(`It didn't go through: ${r.approval.result?.error || 'refused'}`); }, 'Approved: done.'); break;
      case 'refuse': await act(() => post('/api/economy/approval/answer', { id: b.dataset.id, approve: false }), 'Declined.'); break;
      case 'studio': st.dlg?.close(); bus.emit('openstudio', +b.dataset.id, 'money'); break;
      case 'limits': {
        const row = b.closest('.ec-agent'), v = k => row.querySelector(`[data-l="${k}"]`);
        const body = { agent: +b.dataset.id, dailyCap: toCents(v('dailyCap').value) || 0, approveAbove: toCents(v('approveAbove').value) || 0, paused: v('paused').checked,
          scopes: [...row.querySelectorAll('[data-scope]')].filter(x => x.checked).map(x => x.dataset.scope) };
        await act(() => post('/api/economy/agent/limits', body), 'Limits saved.');
        break;
      }
      case 'fund': case 'take': {
        const amount = toCents(b.closest('.ec-agent').querySelector('.ec-mv').value);
        if (!Number.isSafeInteger(amount)) { err.textContent = 'How much?'; return; }
        await act(() => post('/api/economy/agent/move', { agent: +b.dataset.id, amount, dir: a }), a === 'fund' ? `Gave ${vc(amount)}.` : `Took back ${vc(amount)}.`);
        break;
      }
      default: break;
    }
  });
  st.dlg = { el, close, reload };
  render();
  await reload();
}
const bizIcon = k => ({ cafe: '☕', restaurant: '🍽️', shop: '🛍️', gym: '🏋️', office: '🏢' }[k] || '🏪');

// ------------------------------------------------------------------ a venue: the menu, buying
/** Buys from a business (the player must be there; the server checks). */
async function buyAt(biz, items) {
  try {
    const r = await post('/api/economy/buy', { business: biz.id, items, idem: key() });
    app.toast?.(`🧾 ${r.items.map(i => `${i.n > 1 ? `${i.n} × ` : ''}${i.label}`).join(', ')} - ${vc(r.total)}`, 'good', 3200);
    refresh();
    return r;
  } catch (x) {
    if (x.code === 'not_here') {
      const B = S.world?.buildings?.[biz.b];
      app.toast?.(x.message, '', 4200);
      if (B && app.worldmap?.setWaypoint) app.worldmap.setWaypoint(B.x, B.z, biz.name);
    } else if (!x.quiet) app.toast?.(x.message, 'bad', 4200);
    return null;
  }
}
async function openMenu(bizOrId) {
  let biz = bizOrId;
  if (typeof biz === 'string') { try { biz = (await getJSON(`/api/economy/business/${encodeURIComponent(biz)}`)).business; } catch (e) { app.toast?.(e.message, 'bad'); return; } }
  if (!biz?.menu?.length) return;
  const counts = Object.fromEntries(biz.menu.map(m => [m.id, 0]));
  const el = document.body.appendChild(h('<div class="modal-back lib-back ec-back"><div class="panel libdlg ecdlg ec-menu" role="dialog" aria-modal="true" aria-label="Menu"></div></div>'));
  const box = el.querySelector('.ec-menu');
  const render = () => {
    const total = biz.menu.reduce((s, m) => s + m.price * counts[m.id], 0);
    const row = m => `<div class="lib-row ec-item">${m.n ? thumb(m.n, 48) : ''}<div class="lib-main"><b>${m.n ? '' : `${esc(m.icon)} `}${esc(m.label)}</b><span class="dim">${vc(m.price)}</span></div><div class="ec-qty"><button type="button" class="btn small" data-m="dec" data-id="${m.id}" aria-label="One less">−</button><b>${counts[m.id]}</b><button type="button" class="btn small" data-m="inc" data-id="${m.id}" aria-label="One more">+</button></div></div>`;
    box.classList.toggle('fm-order', !!biz.cuisine);
    box.innerHTML = `<h3><span>${bizIcon(biz.kind)} ${esc(biz.name)}</span><button type="button" class="btn small" data-m="close" aria-label="Close">✕</button></h3>
      <p class="hint">${biz.cuisine ? `<span class="fm-kindline">${esc(cuisineLabel(biz.cuisine))}</span> · ` : ''}★ ${(biz.rating / 100).toFixed(1)} · run by ${esc(biz.owner.name)}${biz.priceLevel && biz.priceLevel !== 100 ? ` · prices ${biz.priceLevel > 100 ? 'above' : 'below'} the city's usual` : ''}</p>
      <div class="lib-list">${biz.cuisine ? byCourse(biz.menu).map(g => `<div class="fm-course">${esc(g.label)}</div>${g.lines.map(row).join('')}`).join('') : biz.menu.map(row).join('')}</div>
      <div class="lib-btns"><span class="ec-total">${total ? vc(total) : ''}</span><button type="button" class="btn primary" data-m="buy"${total ? '' : ' disabled'}>${coin()} Buy</button></div>
      <p class="hint">You pay at the counter: be there (in the building or at its door). Sales tax is included.</p>`;
  };
  render();
  const close = () => el.remove();
  el.addEventListener('click', async e => {
    if (e.target === el) return close();
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'close') return close();
    if (b.dataset.m === 'inc') { counts[b.dataset.id] = Math.min(9, counts[b.dataset.id] + 1); render(); }
    if (b.dataset.m === 'dec') { counts[b.dataset.id] = Math.max(0, counts[b.dataset.id] - 1); render(); }
    if (b.dataset.m === 'buy') { const items = Object.entries(counts).filter(([, n]) => n).map(([id, n]) => ({ id, n })); b.disabled = true; if (await buyAt(biz, items)) close(); else b.disabled = false; }
  });
}

// ------------------------------------------------------------------ a business's card (and its owner's settings)
async function openBusiness(id) {
  const el = document.body.appendChild(h('<div class="modal-back lib-back ec-back"><div class="panel libdlg ecdlg ec-biz" role="dialog" aria-modal="true" aria-label="Business"></div></div>'));
  const box = el.querySelector('.ec-biz');
  let B = null, may = false, V = {};
  const load = async () => { try { const j = await getJSON(`/api/economy/business/${encodeURIComponent(id)}`); B = j.business; may = j.mayManage; V = j; render(); } catch (e) { box.innerHTML = `<p class="hint bad">${esc(e.message)}</p>`; } };
  /** Letting the venue (the landlord) or renting it (anyone else): ./realty.js venue leases. */
  const letting = () => {
    if (!V.place) return '';
    const L = V.lease, R = V.rentListing;
    if (L) return `<div class="tier-head">🔑 ${V.tenant ? 'Your lease' : 'Let'}</div><p class="hint">${V.tenant ? 'You run it' : `Run by <b>${esc(L.tenant.name)}</b>`} under a lease from ${esc(L.landlord.name)}: ${vc(L.rent)} a day (${vc(L.monthly)} a month), paid each morning${L.status === 'due' ? ' · <b class="bad">rent overdue</b>' : ''}.</p>${V.tenant || V.landlord ? `<div class="lib-btns"><button type="button" class="btn small" data-b="endlease" data-id="${esc(L.id)}">${V.tenant ? 'Stop renting it' : 'End the lease'}</button></div>` : ''}`;
    if (R) return `<div class="tier-head">🔑 For rent</div><p class="hint">${esc(R.seller.name)} lets this business: <b>${vc(R.price)} a month</b> (${vc(R.perDay)} a day, paid each morning). You run it: you set its prices, keep its takings and pay its staff and stock from its till.</p>
      <div class="lib-btns">${V.landlord ? `<button type="button" class="btn small" data-b="unlist" data-id="${esc(R.id)}">Take it off</button>` : member() ? `<button type="button" class="btn small primary" data-b="rent" data-id="${esc(R.id)}">🔑 Rent this business</button>` : ''}</div>`;
    if (V.landlord && member()) return `<div class="tier-head">🔑 Let it to someone</div><div class="ec-form"><label>Rent a month (VC)<span class="row"><input class="input ec-letprice" inputmode="decimal" placeholder="e.g. 900"><button type="button" class="btn small" data-b="let">Let this business</button></span></label><p class="hint">The tenant runs it and keeps its takings; you collect the rent each morning. You keep the building; its floor can't be re-laid while the lease runs.</p></div>`;
    return '';
  };
  const render = () => {
    const books = B.books || [], last = books[0];
    const series = books.length ? [{ label: 'Takings', points: books.map(d => [d.day, d.sales]) }, { label: 'Profit', points: books.map(d => [d.day, d.profit]) }] : [];
    box.innerHTML = `<h3><span>${bizIcon(B.kind)} ${esc(B.name)}</span><button type="button" class="btn small" data-b="close" aria-label="Close">✕</button></h3>
      <p class="hint">${B.kind === 'office' ? 'A company: its staff\'s work is sold abroad' : B.kind} · run by ${esc(B.owner.name)} · ★ ${(B.rating / 100).toFixed(1)} · today ${vc(B.today?.sales || 0)} from ${B.today?.customers || 0} customers</p>
      ${B.cuisine ? `<div class="tier-head">${esc(cuisineLabel(B.cuisine))} <span class="dim">· ${B.menu.length} on the menu${B.ownMenu ? ', its own' : ''}</span></div>
        <div class="fm-chips">${B.menu.slice(0, 12).map(m => `<span class="fm-chip">${thumb(m.n, 30)}${esc(m.label)} <b>${vc(m.price, false)}</b></span>`).join('')}${B.menu.length > 12 ? `<span class="fm-chip">+ ${B.menu.length - 12} more</span>` : ''}</div>
        ${may ? '<div class="lib-btns"><button type="button" class="btn primary" data-b="editmenu">🍽️ Change the menu or the kind of place</button></div>' : ''}`
      : B.menu.length ? `<div class="lib-list">${B.menu.map(m => `<div class="lib-row ec-item"><div class="lib-main"><b>${esc(m.icon)} ${esc(m.label)}</b><span class="dim">${vc(m.price)}${m.price !== m.base ? ` (the city's usual ${vc(m.base)})` : ''}</span></div>${may ? `<input class="input ec-price" data-item="${m.id}" inputmode="decimal" value="${(m.price / 100).toFixed(2)}" aria-label="Price of ${esc(m.label)}">` : ''}</div>`).join('')}</div>` : ''}
      ${!may && B.menu.length ? '<div class="lib-btns"><button type="button" class="btn primary" data-b="menu">🧾 Order here</button></div>' : ''}
      ${may ? `<div class="tier-head">📒 The books</div>
        ${series.length ? lineChart(series, { fmt: 'vc', h: 150, zero: false }) : '<p class="hint">The books fill in after the first world day.</p>'}
        ${last ? `<p class="hint">Yesterday: takings ${vc(last.sales)} · stock ${vc(last.cogs)} · wages ${vc(last.wages)} · tax ${vc(last.tax)} · profit <b>${vc(last.profit)}</b>${last.owed ? ` · <b class="bad">owes staff ${vc(last.owed)}</b>` : ''}</p>` : ''}
        <div class="ec-form">
          <label class="check"><input type="checkbox" class="ec-auto"${B.settings.auto ? ' checked' : ''}> Set prices automatically from demand and costs${B.settings.auto ? ` (now ${B.settings.level}% of the city's usual)` : ''}</label>
          <label class="check"><input type="checkbox" class="ec-autodraw"${B.settings.autoDraw ? ' checked' : ''}> Each day, move the profit above a few days of wages into my wallet</label>
          <div class="lib-btns"><button type="button" class="btn primary" data-b="save">${B.cuisine ? 'Save settings' : 'Save prices and settings'}</button></div>
          ${B.owner.kind !== 'municipality' ? `<label>Move money<span class="row"><input class="input ec-mvamt" inputmode="decimal" placeholder="VC"><button type="button" class="btn small" data-b="fund">Put in</button><button type="button" class="btn small" data-b="draw">Take out</button></span></label>` : ''}
        </div>` : ''}
      ${letting()}
      <p class="hint bad ec-err" role="alert"></p>`;
    paint(box); hover(box);
  };
  const close = () => el.remove();
  el.addEventListener('click', async e => {
    if (e.target === el) return close();
    const b = e.target.closest('[data-b]'); if (!b) return;
    const err = box.querySelector('.ec-err');
    const act = async (fn, done) => { b.disabled = true; try { await fn(); app.toast?.(done, 'good', 2400); await load(); refresh(); } catch (x) { if (!x.quiet) err.textContent = x.message; b.disabled = false; } };
    if (b.dataset.b === 'close') return close();
    if (b.dataset.b === 'menu') { close(); openMenu(B); return; }
    if (b.dataset.b === 'editmenu') { openMenuEditor(B, { vc, toast: app.toast, save: body => post('/api/economy/business/configure', body), done: async () => { await load(); refresh(); } }); return; }
    if (b.dataset.b === 'save') {
      const prices = {};
      for (const i of box.querySelectorAll('.ec-price')) { const v = toCents(i.value), m = B.menu.find(x => x.id === i.dataset.item); if (Number.isSafeInteger(v) && v !== m.price) prices[i.dataset.item] = v; }
      await act(() => post('/api/economy/business/configure', { id: B.id, prices, auto: box.querySelector('.ec-auto').checked, autoDraw: box.querySelector('.ec-autodraw').checked }), 'Saved.');
    }
    if (b.dataset.b === 'rent') { const l = V.rentListing; if (!armed(b, `Tap again: ${vc(l.perDay)} now, then daily`)) return; await takeIt(b, l, () => load()); return; }
    if (b.dataset.b === 'unlist') { await act(async () => { await post('/api/economy/realty/unlist', { id: b.dataset.id }); await loadRealty(); }, 'Taken off.'); return; }
    if (b.dataset.b === 'endlease') { if (!armed(b, 'Tap again to end it')) return; await act(() => post('/api/economy/realty/end', { lease: b.dataset.id }), 'The lease ended.'); return; }
    if (b.dataset.b === 'let') {
      const price = toCents(box.querySelector('.ec-letprice').value);
      if (!Number.isSafeInteger(price)) { err.textContent = 'What rent a month?'; return; }
      await act(async () => { await post('/api/economy/realty/list', { kind: 'venue_rent', target: V.place, price }); await loadRealty(); }, `For rent at ${vc(price)} a month.`);
      return;
    }
    if (b.dataset.b === 'fund' || b.dataset.b === 'draw') {
      const amount = toCents(box.querySelector('.ec-mvamt').value);
      if (!Number.isSafeInteger(amount)) { err.textContent = 'How much?'; return; }
      await act(() => post('/api/economy/business/move', { id: B.id, dir: b.dataset.b, amount }), b.dataset.b === 'fund' ? `Put ${vc(amount)} in.` : `Took ${vc(amount)} out.`);
    }
  });
  box.innerHTML = '<p class="hint">Loading…</p>';
  await load();
}
function openCity(tab) { import('./econ-city.js').then(m => m.open(app, tab)).catch(e => app.toast?.(e.message, 'bad')); }

// ------------------------------------------------------------------ the selection panel
/** A building's card: the business on the floor being looked at (or its company), with its menu and takings. */
async function buildingCard(body, b) {
  if (!enabled()) return;
  const B = S.world?.buildings?.[b];
  if (!B || B.type === 'park' || B.type === 'apartment') return;
  const slot = (body.querySelector('.sel-slot') || body).appendChild(h('<div class="ec-card"></div>'));
  const f = S.focus?.b === b ? S.focus.f : B.type === 'office' || B.type === 'hq' ? -1 : 0;
  let j;
  try { j = await getJSON(`/api/economy/place?b=${b}&f=${f}`); } catch { slot.remove(); return; }
  const biz = j.business || j.company;
  if (!biz || !slot.isConnected) { slot.remove(); return; }
  slot.innerHTML = `<div class="sep"></div><div class="ec-cardh">${bizIcon(biz.kind)} <b>${esc(biz.name)}</b><span class="dim"> · ★ ${(biz.rating / 100).toFixed(1)}</span></div>
    <div class="hint">Run by ${esc(biz.owner.name)} · today ${vc(biz.today?.sales || 0)} from ${biz.today?.customers || 0} customers</div>
    ${biz.cuisine ? `<div class="hint fm-kindline">${esc(cuisineLabel(biz.cuisine))}</div><div class="fm-chips">${biz.menu.slice(0, 4).map(m => `<span class="fm-chip">${thumb(m.n, 26)}${esc(m.label)} ${vc(m.price, false)}</span>`).join('')}${biz.menu.length > 4 ? `<span class="fm-chip">+${biz.menu.length - 4}</span>` : ''}</div>`
      : biz.menu.length ? `<div class="chips">${biz.menu.slice(0, 4).map(m => `<span class="chip">${esc(m.icon)} ${esc(m.label)} ${vc(m.price, false)}</span>`).join('')}</div>` : ''}
    ${j.rentListing && !j.landlord ? `<div class="hint">🔑 For rent to run: ${vc(j.rentListing.price)} a month</div>` : ''}
    <div class="row">${biz.menu.length && member() ? '<button type="button" class="btn small primary ec-order">🧾 Order</button>' : ''}${member() ? (biz.roles || []).map(r => `<button type="button" class="btn small ec-work" data-role="${esc(r.role)}">${esc(r.icon)} Work as ${esc(r.label.toLowerCase())}</button>`).join('') : ''}<button type="button" class="btn small ec-more">📒 Business</button></div>`;
  slot.querySelector('.ec-order')?.addEventListener('click', () => openMenu(biz));
  for (const w of slot.querySelectorAll('.ec-work')) w.onclick = () => app.work?.start(biz.id, w.dataset.role);
  slot.querySelector('.ec-more').onclick = () => openBusiness(biz.id);
}
