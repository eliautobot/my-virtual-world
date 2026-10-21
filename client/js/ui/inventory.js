// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The inventory (docs/features/INVENTORY.md; server/economy/inventory.js): the wallet's Inventory tab (I opens it in Play
// mode — elsewhere I is the right-hand panel's key) —
// what you hold, or one of your agents: by category (with counts), sorted by newest, name, value, quantity, rarity or
// category, searched; one-of-a-kind things (a fish with its own length and weight) grouped, each piece listed; a
// thing's card (what it is, how many, what it's worth) with Give (to a player, an agent or a business: the wallet's
// own search) and Throw away; the latest comings and goings. What the world puts in (a catch, a gift) arrives with a
// note and shows the next time it's open. Trades (server/economy/trades.js): with a player or an agent, each side puts
// in things and/or coin, both accept and it all swaps at once — the Trades view lists them and opens one's window.
import { S, bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { ITEM_CATS, CAT_BY_ID, SORTS, itemOf, itemValue, sortStacks, rarityColor, pieceLabel } from '/shared/items.js';
import { RARITY } from '/shared/fish-species.js';

let app = null;
const st = { data: null, owner: null, cat: '', sort: 'newest', q: '', sel: null, giving: null, history: false, loading: false,
  view: 'things', trades: null, tradeId: null, draft: null, tnew: null };
const where = () => (S.mode === 'play' ? 'Inventory (I)' : 'your wallet › Inventory');
const vc = h => `${(Math.round(h) / 100).toLocaleString('en-US', { minimumFractionDigits: h % 100 ? 2 : 0, maximumFractionDigits: 2 })} VC`;

export function init(a) {
  app = a;
  app.hooks.key.push(e => {
    if (e.code !== 'KeyI' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || S.mode !== 'play') return false;   // (outside Play, I is the right-hand panel: ui/docks.js)
    if (app.custOpen || app.mapOpen || document.querySelector('.modal-back')) return false;
    if (!auth.account) return false;
    app.econ?.openWallet?.('items'); return true;
  });
  bus.on('msg:inv', m => {
    if (m.ev === 'got') app.toast?.(`${m.icon || '📦'} ${m.agent ? `${m.agent} got` : 'You got'} ${m.qty > 1 ? `${m.qty} × ` : ''}${m.name}${m.from ? ` from ${m.from}` : ''} — ${where()}`, 'good', 4200);   // (a toast is text)
    else if (m.ev === 'trade') {
      const said = { opened: 'wants to trade', changed: 'changed their side of a trade', accepted: 'accepted the trade — your turn', declined: 'declined the trade', done: 'and you traded — it all swapped' }[m.what];
      if (said) app.toast?.(`🤝 ${m.from || 'Someone'} ${said}${m.agent ? ` (with ${m.agent})` : ''} — ${where()} › Trades`, m.what === 'declined' ? '' : 'good', 4200);
    } else return;
    st.data = null; st.trades = null;
    // the window is open: show it now (unless something is being typed)
    if (st.host?.isConnected && !st.host.contains(document.activeElement?.matches?.('input, select') ? document.activeElement : null)) load().then(paint);
  });
  app.inventory = { open: () => app.econ?.openWallet?.('items'), refresh: () => { st.data = null; } };
}

/** The Inventory tab's body, inside the wallet (ui/economy.js): host is the element to fill. */
export async function mount(host) {
  st.host = host;
  if (!st.data || st.data.owner !== (st.owner ? `agent:${st.owner}` : `account:${auth.account?.id}`)) await load();
  paint();
}
async function load() {
  st.loading = true; paint();
  try {
    st.data = await getJSON(`/api/inventory${st.owner ? `?agent=${st.owner}` : '?'}${st.history ? '&history=1' : ''}`);
    if (st.data.welcome) app.toast?.(`🎁 Welcome! A starter kit is in your inventory: a rod, reel and line, bait for a first fishing trip, a coffee and a gift to give someone.`, 'good', 6000);
    st.trades = (await getJSON(`/api/inventory/trades${st.owner ? `?agent=${st.owner}` : ''}`)).trades;
  }
  catch (err) { st.data = { error: err.message, stacks: [], agents: [] }; st.trades = []; }
  st.loading = false;
}
/** The stacks shown: one-of-a-kind pieces of the same kind gathered into one group. */
function groups() {
  const out = new Map();
  for (const s of st.data?.stacks || []) {
    const def = itemOf(s.item);
    if (!def) continue;
    if (st.cat && def.cat !== st.cat) continue;
    if (st.q && !def.name.toLowerCase().includes(st.q)) continue;
    const key = def.unique ? `u:${s.item}` : `s:${s.id}`;
    const g = out.get(key) || { key, item: s.item, qty: 0, got: 0, value: 0, pieces: [], attrs: null };
    g.qty += s.qty; g.got = Math.max(g.got, s.got || 0); g.value += itemValue(def, s.attrs) * s.qty; g.pieces.push(s);
    out.set(key, g);
  }
  // (sorting by value uses the group's worth: a stand-in attrs carrying it)
  return sortStacks([...out.values()].map(g => ({ ...g, attrs: { vc: g.value / Math.max(1, g.qty) } })), st.sort);
}
function paint() {
  const host = st.host; if (!host || !host.isConnected) return;
  const D = st.data;
  if (!D || st.loading && !D.stacks) { host.innerHTML = '<p class="hint">Loading…</p>'; return; }
  if (D.error) { host.innerHTML = `<p class="hint bad">${esc(D.error)}</p>`; return; }
  const counts = {}; for (const s of D.stacks) { const c = itemOf(s.item)?.cat; if (c) counts[c] = (counts[c] || 0) + 1; }
  const G = groups(), sel = st.sel && G.find(g => g.key === st.sel);
  const open = (st.trades || []).filter(t => t.status === 'open'), waiting = open.filter(t => t.theirOk && !t.myOk).length;
  const views = `<div class="seg inv-views"><button type="button" class="btn small${st.view === 'things' ? ' on' : ''}" data-i="tview" data-v="things">📦 Things</button><button type="button" class="btn small${st.view === 'trades' ? ' on' : ''}" data-i="tview" data-v="trades">🤝 Trades${open.length ? ` <small>${open.length}</small>` : ''}${waiting ? ' <b class="inv-dot" title="Waiting on you"></b>' : ''}</button></div>`;
  const whoChips = D.agents?.length ? `<div class="seg inv-who"><button type="button" class="btn small${!st.owner ? ' on' : ''}" data-i="who" data-id="">🧑 Mine</button>${D.agents.map(a => `<button type="button" class="btn small${String(st.owner) === String(a.id) ? ' on' : ''}" data-i="who" data-id="${a.id}"><span data-avatar>${esc(a.emoji || '🤖')}</span> ${esc(a.name)} <small>${a.count}</small></button>`).join('')}</div>` : '';
  if (st.view === 'trades') { host.innerHTML = `${whoChips}${views}${tradesView()}<p class="hint bad inv-err" role="alert"></p>`; return; }
  host.innerHTML = `${whoChips}${views}
    <div class="inv-bar"><div class="seg inv-cats"><button type="button" class="btn small${!st.cat ? ' on' : ''}" data-i="cat" data-c="">All <small>${D.stacks.length}</small></button>${ITEM_CATS.filter(c => counts[c.id]).map(c => `<button type="button" class="btn small${st.cat === c.id ? ' on' : ''}" data-i="cat" data-c="${c.id}">${c.icon} ${esc(c.label)} <small>${counts[c.id]}</small></button>`).join('')}</div>
      <div class="inv-tools"><input class="input inv-q" placeholder="Search" value="${esc(st.q)}" aria-label="Search the inventory"><select class="input inv-sort" aria-label="Sort by">${SORTS.map(([k, t]) => `<option value="${k}"${st.sort === k ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <div class="inv-sum dim">${D.used}/${D.max} spaces · worth ${vc(D.value || 0)}</div>
    <div class="inv-main"><div class="inv-grid">${G.length ? G.map(tile).join('') : `<p class="hint">${D.stacks.length ? 'Nothing like that.' : 'Nothing here yet. What you catch, buy and are given lands here — fish from a trip, things from the shops, gifts from friends.'}</p>`}</div>
      ${sel ? card(sel) : ''}</div>
    <div class="inv-hist">${st.history ? history() : '<button type="button" class="btn small" data-i="hist">⏱️ Comings and goings</button>'}</div>`;
}
function tile(g) {
  const def = itemOf(g.item), col = rarityColor(def.rarity);
  return `<button type="button" class="inv-tile${st.sel === g.key ? ' on' : ''}" data-i="sel" data-k="${esc(g.key)}" title="${esc(def.name)}" style="--rc:${col}">
    <span class="inv-ic">${def.icon}</span><b>${esc(def.name)}</b>${g.qty > 1 ? `<span class="inv-n">×${g.qty}</span>` : ''}<small>${vc(g.value)}</small></button>`;
}
function card(g) {
  const def = itemOf(g.item), cat = CAT_BY_ID[def.cat], rar = RARITY[def.rarity];
  const pieces = def.unique ? `<div class="inv-pieces">${g.pieces.map(p => `<label class="inv-piece"><input type="radio" name="inv-piece" value="${p.id}"${(st.giving?.stack ?? g.pieces[0].id) === p.id ? ' checked' : ''}> ${esc(pieceLabel(def, p.attrs).replace(`${def.name} — `, '') || def.name)}${p.attrs?.size ? ` <small>${esc(p.attrs.size)}</small>` : ''} <i>${vc(itemValue(def, p.attrs))}</i></label>`).join('')}</div>` : '';
  const max = def.unique ? 1 : g.qty, G = st.giving;
  const giveForm = G ? `<div class="inv-give">
      <label>To<span class="ec-pick"><input class="input inv-to" placeholder="A player, an agent or a business" autocomplete="off" value="${esc(G.to?.name || '')}"><span class="ec-res panel hidden"></span></span></label>
      ${max > 1 ? `<label>How many<input class="input inv-qty" type="number" min="1" max="${max}" value="${G.qty || 1}"></label>` : ''}
      <label>Note<input class="input inv-memo" maxlength="140" placeholder="Optional" value="${esc(G.memo || '')}"></label>
      <div class="lib-btns"><button type="button" class="btn" data-i="cancel">Cancel</button><button type="button" class="btn primary" data-i="send">🎁 Give</button></div></div>` : '';
  return `<div class="inv-card"><div class="inv-card-top"><span class="inv-big">${def.icon}</span><div><h4>${esc(def.name)}</h4>
      <span class="dim">${cat.icon} ${esc(cat.label)}${rar && def.rarity !== 'common' ? ` · <b style="color:${rar.color}">${esc(rar.label)}</b>` : ''} · ${g.qty} ${g.qty === 1 ? 'piece' : 'pieces'} · ${vc(g.value)}</span></div></div>
    ${def.desc ? `<p class="inv-desc">${esc(def.desc)}</p>` : ''}${pieces}
    ${/^(fish|find):/.test(g.item) ? '<p class="hint">🐟 Any dock store buys it.</p>' : ''}
    ${giveForm || `<div class="lib-btns">${def.trade !== false ? '<button type="button" class="btn primary" data-i="give">🎁 Give</button><button type="button" class="btn" data-i="ttrade" title="Put it in a trade">🤝 Trade</button>' : ''}<button type="button" class="btn" data-i="toss">🗑️ Throw away</button></div>`}
    <p class="hint bad inv-err" role="alert"></p></div>`;
}
function history() {
  const H = st.data.history || [];
  if (!H.length) return '<p class="hint">Nothing has come or gone yet.</p>';
  const word = { catch: 'Caught', give: 'Given', grant: 'Granted', discard: 'Thrown away', sell: 'Sold', buy: 'Bought', trade: 'Traded', use: 'Used' };
  return `<h4>Comings and goings</h4><div class="lib-list">${H.slice(0, 30).map(x => { const def = itemOf(x.item); return `<div class="lib-row"><div class="lib-main"><b>${x.dir === 'in' ? '＋' : '−'} ${x.qty > 1 ? `${x.qty} × ` : ''}${def?.icon || ''} ${esc(def ? pieceLabel(def, x.attrs) : x.item)}</b><span class="dim">${esc(word[x.kind] || x.kind)}${x.with ? ` · ${x.dir === 'in' ? 'from' : 'to'} ${esc(x.with)}` : ''}${x.memo ? ` · ${esc(x.memo)}` : ''} · ${new Date(x.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div></div>`; }).join('')}</div>`;
}

// ------------------------------------------------------------------ trades
const tradeOf = id => (st.trades || []).find(t => t.id === id);
const sideWorth = s => (s.vc || 0) + s.items.reduce((a, l) => a + (l.worth || 0), 0);
const lineTxt = l => `${l.icon || itemOf(l.item)?.icon || '📦'} ${l.qty > 1 ? `${l.qty} × ` : ''}${esc(l.name)}`;
const sideTxt = s => [...s.items.map(lineTxt), s.vc ? `🪙 ${vc(s.vc)}` : ''].filter(Boolean).join(', ') || '<i class="dim">nothing yet</i>';
const draftOf = t => ({ items: t.me.items.filter(l => !l.gone).map(l => ({ stack: l.stack, qty: l.qty })), vc: t.me.vc || 0 });
const dirty = t => st.draft && JSON.stringify(st.draft) !== JSON.stringify(draftOf(t));
function tradesView() {
  const t = st.tradeId && tradeOf(st.tradeId);
  if (t) return tradeWin(t);
  const N = st.tnew;
  const start = N ? `<div class="inv-give inv-tnew">
      <label>Trade with<span class="ec-pick"><input class="input inv-tto" placeholder="A player or an agent" autocomplete="off" value="${esc(N.to?.name || '')}"><span class="ec-res panel hidden"></span></span></label>
      <label>Note<input class="input inv-tmemo" maxlength="140" placeholder="Optional — what you have in mind" value="${esc(N.memo || '')}"></label>
      <div class="lib-btns"><button type="button" class="btn" data-i="tnewx">Cancel</button><button type="button" class="btn primary" data-i="tstart">🤝 Start the trade</button></div></div>`
    : '<div class="lib-btns"><button type="button" class="btn primary" data-i="tnew">➕ New trade</button></div>';
  const T = st.trades || [];
  const row = t => `<button type="button" class="lib-row inv-trow" data-i="topen" data-id="${esc(t.id)}"><div class="lib-main">
      <b>🤝 ${esc(t.them.who.name)}${t.status !== 'open' ? ` <small class="dim">${esc({ done: 'done', declined: 'declined', lapsed: 'ran out' }[t.status] || t.status)}</small>` : t.theirOk && !t.myOk ? ' <small class="inv-wait">waiting on you</small>' : t.myOk ? ' <small class="dim">you accepted</small>' : ''}</b>
      <span class="dim">You give: ${sideTxt(t.me)} · They give: ${sideTxt(t.them)}</span></div></button>`;
  return `<div class="inv-trades">${start}${T.length ? `<div class="lib-list">${T.map(row).join('')}</div>` : '<p class="hint">No trades yet. Start one with a friend or an agent: each of you puts in things and/or coin, you both accept, and it all swaps at once — or nothing does.</p>'}</div>`;
}
function tradeWin(t) {
  const isOpen = t.status === 'open', D = st.draft || draftOf(t);
  const mine = new Map((st.data?.stacks || []).map(s => [s.id, s]));
  const myLines = D.items.map((l, n) => {
    const s = mine.get(l.stack), def = s && itemOf(s.item);
    const name = def ? pieceLabel(def, s.attrs) : (t.me.items.find(x => x.stack === l.stack)?.name || 'Something');
    return `<div class="inv-tline">${def?.icon || '📦'} ${l.qty > 1 ? `${l.qty} × ` : ''}${esc(name)}${!s ? ' <small class="bad">no longer yours</small>' : ''}${isOpen ? `<button type="button" class="btn small" data-i="trm" data-n="${n}" aria-label="Take it out">✕</button>` : ''}</div>`;
  }).join('');
  const inDraft = new Set(D.items.map(l => l.stack));
  const can = (st.data?.stacks || []).filter(s => itemOf(s.item)?.trade !== false && !inDraft.has(s.id) && s.qty - (s.held || 0) > 0);
  const adder = isOpen && can.length && D.items.length < 20 ? `<div class="inv-tadd"><select class="input inv-tstack" aria-label="Something to put in">${sortStacks(can, 'cat').map(s => { const def = itemOf(s.item); return `<option value="${s.id}"${String(st.pick) === String(s.id) ? ' selected' : ''}>${def.icon} ${esc(pieceLabel(def, s.attrs))}${s.qty > 1 ? ` (×${s.qty})` : ''}</option>`; }).join('')}</select>
      <input class="input inv-tqty" type="number" min="1" value="1" aria-label="How many"><button type="button" class="btn small" data-i="tadd">Add</button></div>` : '';
  const theirLines = t.them.items.map(l => `<div class="inv-tline">${lineTxt(l)}${l.gone ? ' <small class="bad">no longer theirs</small>' : l.short ? ' <small class="bad">they have fewer now</small>' : ''}</div>`).join('');
  const ok = on => on ? '<span class="inv-ok">✔ accepted</span>' : '<span class="dim">not yet</span>';
  const ended = { done: '✅ Done — everything swapped.', declined: '✋ This trade was declined.', lapsed: '⌛ This trade ran out (two days without a change).' }[t.status];
  return `<div class="inv-twin"><div class="inv-thead"><button type="button" class="btn small" data-i="tback">← All trades</button><h4>🤝 Trade with ${esc(t.them.who.name)}</h4></div>
    ${t.memo ? `<p class="inv-desc">“${esc(t.memo)}”</p>` : ''}
    <div class="inv-tsides">
      <div class="inv-tside"><h5>You give ${isOpen ? ok(t.myOk) : ''}</h5>${myLines || '<p class="hint">Nothing yet.</p>'}${adder}
        <label class="inv-tvcl">🪙 Coin${isOpen ? `<input class="input inv-tvc" type="number" min="0" step="0.01" value="${(D.vc || 0) / 100 || ''}" placeholder="0">` : ` <b>${vc(D.vc || 0)}</b>`}</label>
        <small class="dim">Worth about ${vc(D.items.reduce((a, l) => { const s = mine.get(l.stack); return a + (s ? itemValue(itemOf(s.item), s.attrs) * l.qty : 0); }, 0) + (D.vc || 0))}</small></div>
      <div class="inv-tside"><h5>${esc(t.them.who.name)} gives ${isOpen ? ok(t.theirOk) : ''}</h5>${theirLines || '<p class="hint">Nothing yet.</p>'}
        ${t.them.vc ? `<div class="inv-tline">🪙 ${vc(t.them.vc)}</div>` : ''}<small class="dim">Worth about ${vc(sideWorth(t.them))}</small></div>
    </div>
    ${ended ? `<p class="hint">${ended}</p>` : `<div class="lib-btns inv-tbtns">${tbtns(t)}</div><p class="hint">When you both accept, it all swaps at once — or nothing does. A change to either side takes back both acceptances.</p>`}</div>`;
}
function tbtns(t) {
  const D = st.draft || draftOf(t), empty = !D.items.length && !D.vc && !t.them.items.length && !t.them.vc;
  return `<button type="button" class="btn" data-i="tno">✋ Decline</button>${dirty(t) ? '<button type="button" class="btn primary" data-i="tsave">💾 Save my side</button>'
    : t.myOk ? '<button type="button" class="btn" disabled>✔ You accepted</button>' : `<button type="button" class="btn primary" data-i="tok"${empty ? ' disabled title="Nothing is on the table yet"' : ''}>✅ Accept</button>`}`;
}
async function tradeClick(k, t) {
  const err = m => { const q = st.host.querySelector('.inv-err'); if (q) q.textContent = m; };
  const as = st.owner ? Number(st.owner) : undefined, T = st.tradeId && tradeOf(st.tradeId);
  const refresh = async () => { st.trades = (await getJSON(`/api/inventory/trades${st.owner ? `?agent=${st.owner}` : ''}`)).trades; };
  try {
    if (k === 'tview') { st.view = t.dataset.v; st.tradeId = null; st.draft = null; if (st.view === 'trades') await refresh(); }
    else if (k === 'tnew') st.tnew = { memo: '' };
    else if (k === 'tnewx') st.tnew = null;
    else if (k === 'ttrade') { st.view = 'trades'; st.tnew = { memo: '' }; st.pick = groups().find(x => x.key === st.sel)?.pieces[0]?.id; st.sel = null; await refresh(); }
    else if (k === 'tstart') {
      const N = st.tnew; if (!N?.to) { err('Choose who to trade with.'); return; }
      N.memo = st.host.querySelector('.inv-tmemo')?.value || '';
      const r = await post('/api/inventory/trade/open', { to: { kind: N.to.kind, id: N.to.id }, as, memo: N.memo });
      st.tnew = null; await refresh(); st.tradeId = r.id; st.draft = draftOf(tradeOf(r.id) || r);
    }
    else if (k === 'topen') { await refresh(); st.tradeId = t.dataset.id; const x = tradeOf(st.tradeId); st.draft = x ? draftOf(x) : null; }
    else if (k === 'tback') { st.tradeId = null; st.draft = null; st.pick = null; await refresh(); }
    else if (k === 'tadd' && T) {
      const stack = Number(st.host.querySelector('.inv-tstack')?.value), s = (st.data.stacks || []).find(x => x.id === stack); if (!s) return;
      const qty = Math.max(1, Math.min(s.qty, Math.floor(Number(st.host.querySelector('.inv-tqty')?.value || 1))));
      (st.draft ||= draftOf(T)).items.push({ stack, qty }); st.pick = null;
    }
    else if (k === 'trm' && T) (st.draft ||= draftOf(T)).items.splice(Number(t.dataset.n), 1);
    else if (k === 'tsave' && T) {
      const D = st.draft || draftOf(T);
      await post('/api/inventory/trade/offer', { trade: T.id, items: D.items, vc: D.vc || 0, as });
      await refresh(); const x = tradeOf(T.id); st.draft = x ? draftOf(x) : null;
      app.toast?.('🤝 Your side is saved — they\'ve been told', 'good', 2000);
    }
    else if (k === 'tok' && T) {
      const r = await post('/api/inventory/trade/accept', { trade: T.id, as });
      if (r.status === 'done') { app.toast?.(`🤝 Traded with ${T.them.who.name} — it all swapped`, 'good', 3200); await load(); }
      else { app.toast?.(`✔ Accepted — waiting on ${T.them.who.name}`, 'good', 2400); await refresh(); }
    }
    else if (k === 'tno' && T) {
      if (!confirm(`Decline the trade with ${T.them.who.name}?`)) return;
      await post('/api/inventory/trade/decline', { trade: T.id, as }); await refresh();
    }
  } catch (x) {
    try { await refresh(); } catch { /* keep what's shown */ }
    paint(); err(x.message); return;
  }
  paint();
}

// ------------------------------------------------------------------ what the buttons do (the wallet's body delegates here)
let searchT = 0;
/** Clicks in the wallet's body (ui/economy.js passes them on while the Inventory tab is open). → true if handled. */
export async function onClick(e) {
  const t = e.target.closest('[data-i]'); if (!t || !st.host?.contains(t)) return false;
  const k = t.dataset.i, err = m => { const q = st.host.querySelector('.inv-err'); if (q) q.textContent = m; };
  if (k === 'cat') { st.cat = t.dataset.c; st.sel = null; st.giving = null; paint(); }
  else if (k === 'who') { st.owner = t.dataset.id || null; st.sel = null; st.giving = null; st.tradeId = null; st.draft = null; st.tnew = null; await load(); paint(); }
  else if (k[0] === 't' && k !== 'toss') await tradeClick(k, t);
  else if (k === 'sel') { st.sel = st.sel === t.dataset.k ? null : t.dataset.k; st.giving = null; paint(); }
  else if (k === 'hist') { st.history = true; await load(); paint(); }
  else if (k === 'give') { st.giving = { qty: 1 }; paint(); st.host.querySelector('.inv-to')?.focus(); }
  else if (k === 'cancel') { st.giving = null; paint(); }
  else if (k === 'toss' || k === 'send') {
    const g = groups().find(x => x.key === st.sel); if (!g) return true;
    const def = itemOf(g.item), piece = def.unique ? Number(st.host.querySelector('input[name="inv-piece"]:checked')?.value || g.pieces[0].id) : g.pieces[0].id;
    const qty = def.unique ? 1 : Math.max(1, Math.min(g.qty, Math.floor(Number(st.host.querySelector('.inv-qty')?.value || 1))));
    if (k === 'toss') {
      if (!confirm(`Throw away ${qty > 1 ? `${qty} × ` : ''}${def.name}? It's gone for good.`)) return true;
      try { await post('/api/inventory/discard', { stack: piece, qty: def.unique ? 1 : g.qty, from: st.owner ? Number(st.owner) : undefined }); } catch (x) { err(x.message); return true; }
      app.toast?.(`🗑️ ${def.name} thrown away`, '', 1800);
    } else {
      const G = st.giving; if (!G?.to) { err('Choose who to give it to.'); return true; }
      G.memo = st.host.querySelector('.inv-memo')?.value || '';
      let r;
      try { r = await post('/api/inventory/give', { stack: piece, qty, to: { kind: G.to.kind, id: G.to.id }, from: st.owner ? Number(st.owner) : undefined, memo: G.memo, idem: `${piece}:${Date.now()}` }); }
      catch (x) { err(x.message); return true; }
      app.toast?.(`🎁 ${qty > 1 ? `${qty} × ` : ''}${def.name} to ${r.to?.name || G.to.name}`, 'good', 2400);
    }
    st.giving = null; st.sel = null; await load(); paint();
  } else return false;
  return true;
}
/** Typing in the wallet's body: the search box, the recipient's name. */
export function onInput(e) {
  if (!st.host?.contains(e.target)) return false;
  if (e.target.classList.contains('inv-q')) { st.q = e.target.value.trim().toLowerCase(); const pos = e.target.selectionStart; paint(); const q = st.host.querySelector('.inv-q'); q?.focus(); q?.setSelectionRange(pos, pos); return true; }
  if (e.target.classList.contains('inv-sort')) { st.sort = e.target.value; paint(); return true; }
  if (e.target.classList.contains('inv-tvc')) {   // the coin in my side: the buttons follow (Save once it differs)
    const T = tradeOf(st.tradeId); if (!T) return true;
    (st.draft ||= draftOf(T)).vc = Math.max(0, Math.round((Number(e.target.value) || 0) * 100));
    const b = st.host.querySelector('.inv-tbtns'); if (b) b.innerHTML = tbtns(T);
    return true;
  }
  const trading = e.target.classList.contains('inv-tto');
  if (e.target.classList.contains('inv-to') || trading) {
    const P = trading ? st.tnew : st.giving;
    if (P) P.to = null;
    clearTimeout(searchT);
    const q = e.target.value.trim(), res = e.target.parentElement.querySelector('.ec-res');
    if (q.length < 2) { res?.classList.add('hidden'); return true; }
    searchT = setTimeout(async () => {
      try {
        const j = await getJSON(`/api/economy/search?q=${encodeURIComponent(q)}`);
        if (trading) j.results = j.results.filter(r => r.kind === 'account' || r.kind === 'agent');   // (a business doesn't trade)
        res.innerHTML = j.results.length ? j.results.map((r, k) => `<button type="button" class="ec-hit" data-k="${k}"><span data-avatar>${esc(r.emoji || (r.kind === 'account' ? '🧑' : '🤖'))}</span> ${esc(r.name)}${r.login ? ` <small>@${esc(r.login)}</small>` : ''}</button>`).join('') : '<p class="hint">Nobody by that name.</p>';
        res.classList.remove('hidden');
        res.onclick = ev => { const b = ev.target.closest('.ec-hit'); if (!b || !P) return; P.to = j.results[+b.dataset.k]; e.target.value = P.to.name; res.classList.add('hidden'); };
      } catch { /* the search is a convenience */ }
    }, 220);
    return true;
  }
  return false;
}
