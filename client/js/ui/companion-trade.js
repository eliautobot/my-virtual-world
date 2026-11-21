// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Trading with one of your agents in one window (2026-11-20, the product owner: "trade with companions … give them any
// inventory item … and they should be able to give me an inventory item as well … intuitive, easy, and also safe"): your
// things on the left, theirs on the right — tick what you give and what you'd like (how many of each), coin either way,
// a word if you like — then 🎁 Give (a gift) or 🤝 Propose. They decide for themselves a moment later (server/companions/
// agent-trades.js: their own decision service, else their habit) and the window says their answer, with why; nothing
// moves until they say yes, and then everything both ways at once (server/economy/trades.js propose).
// Opened from a companion's menu (ui/companions.js) and their card: app.companionTrade.open({ id, name, emoji }).
import { bus } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { itemOf, itemValue, pieceLabel } from '/shared/items.js';

let app = null, E = null, st = null;
const vc = c => `${(Math.round(c) / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })} VC`;

export function init(a) {
  app = a;
  app.companionTrade = { open, close, review };
  bus.on('msg:inv', m => {
    if (m.ev !== 'trade' || !m.trade) return;
    // (kept a moment: its answer can come before this page has heard back from its own proposal)
    const was = heard.get(m.trade) || []; was.push(m); heard.set(m.trade, was.slice(-6));
    if (heard.size > 40) heard.delete(heard.keys().next().value);
    if (st && m.trade === st.trade) apply(m);
  });
}
const heard = new Map();   // trade id → its latest events
function apply(m) {
  if (!st) return;
  if (m.what === 'said' && m.text) { st.said = m.text; paintStatus(); }
  if (m.what === 'done' && st.state !== 'done') { st.state = 'done'; paintStatus(); reload(); }
  if (m.what === 'declined') { st.state = 'declined'; paintStatus(); }
}
/** Its answer, should the page have missed its word (asked again every couple of seconds while it thinks). */
async function watch(id) {
  for (let k = 0; k < 20 && st && st.trade === id && st.state === 'waiting'; k++) {
    await new Promise(r => setTimeout(r, 2000));
    if (!st || st.trade !== id || st.state !== 'waiting') return;
    try {
      const t = (await getJSON('/api/inventory/trades')).trades.find(x => x.id === id);
      if (t && t.status === 'done') apply({ what: 'done' }); else if (t && t.status === 'declined') apply({ what: 'declined' });
    } catch { /* the next look */ }
  }
}

/**
 * A trade one of your agents proposed to you (2026-11-20, "companions should trade themselves too"): what they give and
 * what they ask of you, their word — ✅ Accept (it all changes hands at once) or ✕ Decline.
 */
async function review(id) {
  close();
  let t = null;
  try { t = (await getJSON('/api/inventory/trades')).trades.find(x => x.id === id); } catch { t = null; }
  if (!t) { app.toast?.('That trade is over', '', 2500); return; }
  st = { review: t };
  const who = t.them.who, line = l => `<div class="ct-row"><span class="ct-ic">${l.icon || '📦'}</span><span class="ct-nm">${l.qty > 1 ? `${l.qty} × ` : ''}${esc(l.name)}<small>${l.gone ? 'no longer there' : vc(l.worth || 0)}</small></span></div>`;
  const side = (s0, empty) => `${s0.items.map(line).join('')}${s0.vc ? `<div class="ct-row"><span class="ct-ic">🪙</span><span class="ct-nm">${vc(s0.vc)}</span></div>` : ''}` || `<p class="hint">${empty}</p>`;
  const worth = s0 => (s0.vc || 0) + s0.items.reduce((a, l) => a + (l.worth || 0), 0);
  E = h(`<div class="modal-back ct-back"><div class="panel ct-win" role="dialog" aria-label="A trade from ${esc(who.name)}">
    <div class="ct-head"><span data-avatar>🤝</span><b>${esc(who.name)} proposes a trade</b><button type="button" class="btn small ct-x" aria-label="Close">✕</button></div>
    ${t.memo ? `<p class="ct-word">“${esc(t.memo)}”</p>` : ''}
    <div class="ct-cols"><section><h4>${esc(who.name)} gives you</h4><div class="ct-list">${side(t.them, 'Nothing')}</div></section>
      <section><h4>You give</h4><div class="ct-list">${side(t.me, 'Nothing')}</div></section></div>
    <div class="ct-sum">You get <b>${vc(worth(t.them))}</b> · you give <b>${vc(worth(t.me))}</b></div>
    <div class="ct-status" role="status">${t.status !== 'open' ? `This trade is ${esc(t.status)}.` : ''}</div>
    <div class="rr-acts"><button type="button" class="btn" data-r="decline"${t.status !== 'open' ? ' disabled' : ''}>✕ Decline</button><button type="button" class="btn primary" data-r="accept"${t.status !== 'open' ? ' disabled' : ''}>✅ Accept</button></div></div></div>`);
  document.body.appendChild(E);
  E.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  E.addEventListener('click', async e => {
    if (e.target === E || e.target.closest('.ct-x')) { close(); return; }
    const b = e.target.closest('[data-r]'); if (!b || b.disabled) return;
    for (const x of E.querySelectorAll('[data-r]')) x.disabled = true;
    const out = E.querySelector('.ct-status');
    try {
      const r = await post(`/api/inventory/trade/${b.dataset.r}`, { trade: id });
      out.className = `ct-status ${r.status === 'done' ? 'done' : 'declined'}`;
      out.textContent = r.status === 'done' ? '✅ Done — it all changed hands.' : b.dataset.r === 'decline' ? `Declined — ${who.name} is told.` : 'Accepted — waiting for them.';
      app.inventory?.refresh?.();
    } catch (err) { out.className = 'ct-status declined'; out.textContent = err.message; }
  });
}
/** Opens the window for agent a ({ id, name, emoji }). */
async function open(a) {
  close();
  st = { agent: a, mine: [], theirs: [], give: new Map(), want: new Map(), vc: 0, wantVc: 0, memo: '', trade: null, state: 'edit', said: '', myVc: null, err: '' };
  E = h(`<div class="modal-back ct-back"><div class="panel ct-win" role="dialog" aria-label="Trade with ${esc(a.name)}">
    <div class="ct-head"><span data-avatar>${esc(a.emoji || '🤖')}</span><b>Trade with ${esc(a.name)}</b><button type="button" class="btn small ct-x" aria-label="Close">✕</button></div>
    <div class="ct-body"><p class="hint">Loading…</p></div></div></div>`);
  document.body.appendChild(E);
  E.addEventListener('click', onClick);
  E.addEventListener('input', onInput);
  E.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  await reload();
}
function close() { E?.remove(); E = null; st = null; }
async function reload() {
  if (!st) return;
  try {
    const [m, t, me] = await Promise.all([getJSON('/api/inventory'), getJSON(`/api/inventory?agent=${st.agent.id}`), getJSON('/api/economy/me').catch(() => null)]);
    if (!st) return;
    st.mine = m.stacks || []; st.theirs = t.stacks || []; st.myVc = me?.wallet?.available ?? me?.wallet?.balance ?? null;
    st.give.clear(); st.want.clear(); st.vc = 0; st.wantVc = 0;
    if (st.state === 'done') st.state = 'edit-after';
  } catch (err) { st.err = err.message; }
  paint();
}

// ------------------------------------------------------------------ the window
const nameOf = s => { const d = itemOf(s.item); return d ? pieceLabel(d, s.attrs) : s.item; };
const worthOf = s => itemValue(itemOf(s.item), s.attrs);
function list(stacks, pick, side) {
  if (!stacks.length) return '<p class="hint">Nothing here.</p>';
  return `<div class="ct-list">${stacks.map(s => {
    const d = itemOf(s.item), n = pick.get(s.id) || 0, free = s.qty - (s.held || 0), no = d?.trade === false || free < 1;
    return `<div class="ct-row${n ? ' on' : ''}${no ? ' off' : ''}" data-side="${side}" data-stack="${s.id}">
      <span class="ct-ic">${d?.icon || '📦'}</span><span class="ct-nm">${esc(nameOf(s))}<small>${free} · ${vc(worthOf(s))}${free > 1 ? ' each' : ''}</small></span>
      ${no ? '<small class="dim">can\'t be traded</small>' : free > 1
    ? `<span class="ct-qty"><button type="button" class="btn small" data-q="-1" aria-label="One less">−</button><b>${n}</b><button type="button" class="btn small" data-q="1" aria-label="One more">+</button></span>`
    : `<button type="button" class="btn small ct-tick" data-q="${n ? -1 : 1}">${n ? '✓' : '+'}</button>`}</div>`;
  }).join('')}</div>`;
}
const sum = (stacks, pick) => [...pick].reduce((a, [id, n]) => { const s = stacks.find(x => x.id === id); return a + (s ? worthOf(s) * n : 0); }, 0);
function paint() {
  if (!E || !st) return;
  const a = st.agent, body = E.querySelector('.ct-body');
  if (st.err && !st.mine.length) { body.innerHTML = `<p class="err">${esc(st.err)}</p>`; return; }
  const g = sum(st.mine, st.give) + st.vc, w = sum(st.theirs, st.want) + st.wantVc, busy = st.state === 'waiting';
  body.innerHTML = `<div class="ct-cols">
      <section><h4>🧑 You give</h4>${list(st.mine, st.give, 'give')}<label class="ct-coin">🪙 Coin <input class="input" data-f="vc" type="number" min="0" step="0.5" value="${st.vc / 100 || ''}" placeholder="0"> VC${st.myVc != null ? ` <small class="dim">(you have ${vc(st.myVc)})</small>` : ''}</label></section>
      <section><h4>${esc(a.emoji || '🤖')} ${esc(a.name)} gives</h4>${list(st.theirs, st.want, 'want')}<label class="ct-coin">🪙 Coin <input class="input" data-f="wantVc" type="number" min="0" step="0.5" value="${st.wantVc / 100 || ''}" placeholder="0"> VC</label></section>
    </div>
    <div class="ct-sum">You give <b>${vc(g)}</b> · you get <b>${vc(w)}</b>${g || w ? (w > g ? ` <small class="dim">— you ask ${vc(w - g)} more than you give</small>` : g > w ? ` <small class="dim">— generous by ${vc(g - w)}</small>` : '') : ''}</div>
    <label class="ct-memo">A word <input class="input" data-f="memo" maxlength="140" placeholder="Optional — e.g. “For the bait you bought”" value="${esc(st.memo)}"></label>
    <div class="ct-status" role="status"></div>
    <div class="rr-acts"><button type="button" class="btn" data-a="cancel">Close</button>
      <button type="button" class="btn" data-a="propose" data-gift="1"${busy || !g || w ? ' disabled' : ''} title="Give what you ticked — nothing asked back">🎁 Give</button>
      <button type="button" class="btn primary" data-a="propose"${busy || (!g && !w) ? ' disabled' : ''}>🤝 Propose</button></div>`;
  paintStatus();
}
function paintStatus() {
  const el = E?.querySelector('.ct-status'); if (!el || !st) return;
  const n = esc(st.agent.name);
  el.className = `ct-status ${st.state}`;
  el.innerHTML = st.state === 'waiting' ? `⏳ ${n} is thinking it over…${st.said ? `<br>${esc(st.said)}` : ''}`
    : st.state === 'done' || st.state === 'edit-after' ? `✅ Done — it all changed hands.${st.said ? ` <small>${esc(st.said)}</small>` : ''}`
      : st.state === 'declined' ? `❌ ${st.said ? esc(st.said) : `${n} said no`} — nothing changed hands.`
        : st.err ? `<span class="err">${esc(st.err)}</span>` : '';
}
function onInput(e) {
  const f = e.target.dataset.f; if (!f || !st) return;
  if (f === 'memo') { st.memo = e.target.value; return; }
  st[f] = Math.max(0, Math.round((Number(e.target.value) || 0) * 100));
  const pos = e.target.selectionStart; paint();
  const i = E.querySelector(`[data-f="${f}"]`); i?.focus(); try { i?.setSelectionRange(pos, pos); } catch { /* a number field */ }
}
async function onClick(e) {
  if (!st) return;
  if (e.target === E || e.target.closest('.ct-x') || e.target.closest('[data-a="cancel"]')) { close(); return; }
  const q = e.target.closest('[data-q]');
  if (q) {
    const row = q.closest('.ct-row'), side = row.dataset.side, id = Number(row.dataset.stack), pick = side === 'give' ? st.give : st.want, stacks = side === 'give' ? st.mine : st.theirs;
    const s = stacks.find(x => x.id === id), free = s ? s.qty - (s.held || 0) : 0, n = Math.max(0, Math.min(free, (pick.get(id) || 0) + Number(q.dataset.q)));
    if (n) pick.set(id, n); else pick.delete(id);
    if (st.state !== 'waiting') { st.state = 'edit'; st.said = ''; }
    paint(); return;
  }
  const b = e.target.closest('[data-a="propose"]');
  if (b && !b.disabled) {
    const gift = !!b.dataset.gift;
    st.state = 'waiting'; st.said = ''; st.err = ''; paint();
    try {
      const r = await post('/api/inventory/trade/propose', { to: { kind: 'agent', id: st.agent.id }, give: [...st.give].map(([stack, qty]) => ({ stack, qty })), vc: st.vc,
        want: gift ? [] : [...st.want].map(([stack, qty]) => ({ stack, qty })), wantVc: gift ? 0 : st.wantVc, memo: st.memo });
      st.trade = r.id;
      for (const m of heard.get(r.id) || []) apply(m);
      if (r.status === 'done') apply({ what: 'done' });
      else watch(r.id);
    } catch (err) { st.state = 'edit'; st.err = err.message; paint(); }
  }
}
