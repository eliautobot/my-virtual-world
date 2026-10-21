// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The dock store's counter (docs/features/fishing.md §The loop 6–7): walk into a marina's Dock Store or a lake dock's
// Bait Shack in Play mode and E opens it —
//   · Sell: the fish and finds in your inventory, what each fetches (its price from when it was landed:
//     server/play/fish-market.js), paid in Virtual Coin from the economy's Fish market;
//   · Tackle: rods, reels, lines and the leader — bought into your inventory, the one you fish with chosen here;
//   · Bait: bait and lures by the pack (bait is used up when a fish takes it; a lure is lost only to a snapped line);
//   · Boat: your boat's upgrades (yours on every boat);
//   · Skills: a point a fishing level, and a fresh start for a price (server/play/angler.js).
// Away from a store it opens too (the trips panel's 🎣 Gear & skills): choosing your tackle and spending skill points work
// anywhere; buying waits for a store.
import { S } from '../core/state.js';
import { auth } from '../core/auth.js';
import { h, esc } from '../core/util.js';
import { getJSON, post } from '../core/net.js';
import { fmtVc } from '/shared/play.js';
import { itemOf, pieceLabel } from '/shared/items.js';
import { GEAR } from '/shared/fishing-gear.js';

let app = null, E = {}, view = null, ang = null, askedAt = 0, asking = false, storeAt = -1, tab = 'sell', busy = false;
const TABS = [['sell', '💰 Sell'], ['tackle', '🎣 Tackle'], ['bait', '🪱 Bait'], ['boat', '🚤 Boat'], ['skills', '⭐ Skills']];
const vc = n => fmtVc(Math.round(n * 100));   // (the gear's prices are in whole VC)

export function initStore(a) {
  app = a;
  E.panel = document.getElementById('ui').appendChild(h('<div id="fishmarket" class="panel hidden" role="dialog" aria-label="Dock store"><div class="rp-head"><h3>🎣 Dock store</h3><button type="button" class="btn small" data-dex="1">📖 Fishdex</button><button type="button" class="btn small rp-x">✕</button></div><div class="fm-top"></div><div class="seg fm-tabs"></div><div class="fm-body"></div></div>'));
  E.panel.querySelector('.rp-x').onclick = close;
  E.panel.addEventListener('click', onClick);
  (app.playerTargets ||= []).push(target);
  app.fishStore = { open, close, refresh: () => ask(true), boatKit: () => ang?.boatKit || {} };
  // what the boat takes when you board (its engine and anchor: server/play/angler.js boatKit)
  setTimeout(() => { if (auth.account) loadAngler().catch(() => {}); }, 4000);
}
/** The dock store the player is inside, or null. */
function storeOf(P) {
  if (!P || P.ctx < 0) return null;
  const B = S.world?.buildings?.[P.ctx >> 6];
  return B && B.tackle && !B.gone ? B : null;
}
async function loadAngler() { ang = await getJSON('/api/fishing/angler'); return ang; }
async function ask(force = false) {
  if (asking || (!force && performance.now() - askedAt < 8000)) return;
  asking = true; askedAt = performance.now();
  try { [view, ang] = await Promise.all([getJSON('/api/fishing/market'), getJSON('/api/fishing/angler')]); } catch { view = view || null; }
  asking = false;
  if (!E.panel.classList.contains('hidden')) render();
}
function target(P) {
  const B = storeOf(P);
  if (!B) { storeAt = -1; return null; }
  if (storeAt !== P.ctx >> 6) { storeAt = P.ctx >> 6; ask(true); } else ask();
  const n = view?.items?.length || 0, total = (view?.items || []).reduce((a, it) => a + it.price * it.qty, 0);
  return { d: 1.2, html: n ? `Dock store <span class="dim">· sell your catch, ${fmtVc(total)}</span>` : 'Dock store <span class="dim">· tackle, bait, upgrades</span>', act: () => open(n ? 'sell' : 'tackle') };
}
function open(t) { if (t) tab = t; E.panel.classList.remove('hidden'); render(); ask(true); }
function close() { E.panel.classList.add('hidden'); }

// ------------------------------------------------------------------ what it shows
function render() {
  const A = ang;
  E.panel.querySelector('.fm-tabs').innerHTML = TABS.map(([k, t]) => `<button type="button" class="btn small${tab === k ? ' on' : ''}" data-tab="${k}">${t}${k === 'skills' && A?.points?.free ? ` <b class="fm-dot">${A.points.free}</b>` : ''}</button>`).join('');
  E.panel.querySelector('.fm-top').innerHTML = A ? `<span>🎣 Fishing level <b>${A.level}</b></span>${A.vc != null ? `<span>🪙 <b>${fmtVc(A.vc)}</b></span>` : ''}${A.atStore ? `<span class="dim">at ${esc(A.atStore.name)}</span>` : '<span class="fm-away">Away from a store: buying waits for one</span>'}` : '';
  const body = E.panel.querySelector('.fm-body');
  if (!view && !A) { body.innerHTML = '<p class="hint">Loading…</p>'; return; }
  if (A && !A.open && tab !== 'sell') { body.innerHTML = '<p class="hint">The dock store is closed (the economy is off): everyone fishes with the starter kit.</p>'; return; }
  body.innerHTML = tab === 'tackle' ? tackle(A) : tab === 'bait' ? bait(A) : tab === 'boat' ? boat(A) : tab === 'skills' ? skills(A) : sellView();
}
function sellView() {
  if (!view) return '<p class="hint">Loading…</p>';
  const T = view.terms || {}, items = view.items || [];
  if (!T.on) return '<p class="hint">The fish market is closed (the economy is off).</p>';
  if (!items.length) return '<p class="hint">Nothing to sell. Take a boat out on a fishing trip (🎣 Trips): what you keep goes into your inventory, and the store buys it here.</p>';
  const total = items.reduce((a, it) => a + it.price * it.qty, 0), pay = Math.min(T.left, total);
  return `<div class="fm-items">${items.map(it => { const d = itemOf(it.item); return `<span>${d?.icon || '🐟'} ${esc(d ? pieceLabel(d, it.attrs) : it.item)}${it.qty > 1 ? ` ×${it.qty}` : ''} <i>${fmtVc(it.price * it.qty)}</i></span>`; }).join('')}</div>
    <div class="fm-sum">${items.length} ${items.length === 1 ? 'thing' : 'things'} · ${fmtVc(total)}</div>
    <p class="hint">${T.pct !== 100 ? `The market pays ${T.pct} % today. ` : ''}${pay < total ? `Today's limit leaves room for ${fmtVc(T.left)} more. ` : ''}Each fish fetches its price from when it was landed (fresh, or late home). Keep any you'd rather give or trade: they stay in your inventory.</p>
    ${view.atStore ? `<div class="rr-acts"><button type="button" class="btn primary" data-sell="1">💰 Sell it all · ${fmtVc(pay)}</button></div>` : '<p class="hint">Walk into a dock store to sell.</p>'}`;
}
const tierStars = (t, of = 5) => `<span class="fm-tier" data-noicon>${'★'.repeat(t)}<i>${'★'.repeat(Math.max(0, of - t))}</i></span>`;
/** A piece of tackle: what it does, and Use / Buy / its level. */
function gearRow(g, what, A, top = 5) {
  const act = g.using ? '<span class="fm-on">✔ Fishing with it</span>'
    : g.have ? `<button type="button" class="btn small" data-use="${g.id}">Use it</button>`
    : g.locked ? `<span class="dim">🔒 Fishing level ${g.level}</span>`
    : `<button type="button" class="btn small primary" data-buy="gear" data-id="${g.id}"${A.atStore ? '' : ' disabled'}>Buy · ${vc(g.price)}</button>`;
  return `<div class="fm-row${g.locked && !g.have ? ' off' : ''}"><div class="fm-l"><b>${esc(g.name)} ${g.tier ? tierStars(g.tier, top) : ''}</b><small>${esc(what(GEAR[g.id] || g))}</small><small class="dim">${esc(g.blurb || '')}</small></div><div class="fm-r">${act}</div></div>`;
}
function tackle(A) {
  if (!A) return '<p class="hint">Loading…</p>';
  const lb = kg => Math.round(kg * 2.2046);
  const leader = A.leader;
  return `<p class="hint">What you buy goes into your inventory (rods, reels and lines can be given or traded). The tackle you fish with is your choice — a trip takes it from your inventory.</p>
    <h4>Rods</h4>${A.rods.map(g => gearRow(g, x => `${x.reach} m cast · lifts up to ${x.maxKg} kg · ${Math.round(x.win * 1000) / 1000} s to set the hook`, A)).join('')}
    <h4>Reels</h4>${A.reels.map(g => gearRow(g, x => `${x.speed} m/s · ${x.drag} kg drag · ${x.cap} m of line`, A)).join('')}
    <h4>Lines</h4>${A.lines.map(g => gearRow(g, x => `breaks at ${lb(x.kgf)} lb (${x.kgf} kg)`, A, 6)).join('')}
    <h4>Leader</h4>${leader.have ? `<div class="fm-row"><div class="fm-l"><b>${esc(leader.name)}</b><small class="dim">${esc(leader.blurb)}</small></div><div class="fm-r"><button type="button" class="btn small${leader.using ? ' on' : ''}" data-leader="${leader.using ? 0 : 1}">${leader.using ? '✔ On' : 'Off'}</button></div></div>` : gearRow(leader, () => 'Fish see the line less: more bites', A)}`;
}
function bait(A) {
  if (!A) return '<p class="hint">Loading…</p>';
  const water = { sea: '🌊 Sea', lake: '🛶 Lake', both: '🌊🛶' };
  return `<p class="hint">Bait (🪱 worms, shrimp, minnows…) is used up when a fish takes it. A lure is used again and again — lost only when the line snaps.</p>
    ${A.lures.map(l => `<div class="fm-row${l.locked ? ' off' : ''}"><div class="fm-l"><b>${l.icon} ${esc(l.name)} <small class="dim">${water[l.water] || ''}</small></b><small>${l.have ? `You have <b>${l.have}</b>` : '<span class="dim">None yet</span>'} · ${l.pack > 1 ? `a pack of ${l.pack} for` : 'one for'} ${vc(l.price)}</small><small class="dim">${esc(l.blurb)}</small></div>
      <div class="fm-r">${l.locked ? `<span class="dim">🔒 Fishing level ${l.level}</span>` : `<button type="button" class="btn small primary" data-buy="lure" data-id="${l.id}" data-packs="1"${A.atStore ? '' : ' disabled'}>Buy · ${vc(l.price)}</button><button type="button" class="btn small" data-buy="lure" data-id="${l.id}" data-packs="5"${A.atStore ? '' : ' disabled'} title="Five packs">×5</button>`}</div></div>`).join('')}`;
}
function boat(A) {
  if (!A) return '<p class="hint">Loading…</p>';
  return `<p class="hint">Your boat's upgrades are yours on every boat you take out, at any dock.</p>
    ${A.boat.map(u => `<div class="fm-row"><div class="fm-l"><b>${u.icon} ${esc(u.name)} ${tierStars(u.tier, 3)}</b><small>Now: ${u.value} ${esc(u.unit)}${u.next ? ` → <b>${u.next.value} ${esc(u.unit)}</b>` : ''}</small><small class="dim">${esc(u.blurb)}</small></div>
      <div class="fm-r">${!u.next ? '<span class="fm-on">✔ The best</span>' : u.next.locked ? `<span class="dim">🔒 Fishing level ${u.next.level}</span>` : `<button type="button" class="btn small primary" data-buy="boat" data-id="${u.id}"${A.atStore ? '' : ' disabled'}>Upgrade · ${vc(u.next.price)}</button>`}</div></div>`).join('')}`;
}
function skills(A) {
  if (!A) return '<p class="hint">Loading…</p>';
  const P = A.points;
  return `<p class="hint">One skill point a fishing level. <b>${P.free}</b> to spend (${P.spent} of ${P.total} spent).</p>
    ${A.skills.map(s => `<div class="fm-row"><div class="fm-l"><b>${s.icon} ${esc(s.name)} <span class="fm-pips">${Array.from({ length: A.skillMax }, (_, k) => `<i class="${k < s.rank ? 'on' : ''}"></i>`).join('')}</span></b><small class="dim">${esc(s.blurb)}</small></div>
      <div class="fm-r">${s.rank >= A.skillMax ? '<span class="fm-on">✔ Top rank</span>' : `<button type="button" class="btn small${P.free ? ' primary' : ''}" data-skill="${s.id}"${P.free ? '' : ' disabled'}>+1</button>`}</div></div>`).join('')}
    ${P.spent ? `<div class="rr-acts"><button type="button" class="btn small" data-respec="1"${A.atStore ? '' : ' disabled'}>↺ Fresh start · ${vc(A.respec)}</button></div><p class="hint">A fresh start gives every point back to spend again (at a dock store).</p>` : ''}`;
}

// ------------------------------------------------------------------ what the buttons do
async function onClick(e) {
  const t = e.target.closest('button'); if (!t || busy || t.disabled) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  if (t.dataset.dex) { close(); app.fishdex?.open(); return; }
  if (t.dataset.sell) { sell(); return; }
  const call = async (path, body, said) => {
    busy = true;
    try { const r = await post(path, body); ang = r.view || (r.points ? r : ang); if (said) app.toast(said(r), 'good', 2600); app.inventory?.refresh?.(); app.economy?.refresh?.(); }
    catch (err) { app.toast(err.message, 'bad', 3500); }
    busy = false; render();
  };
  if (t.dataset.buy) await call('/api/fishing/buy', { kind: t.dataset.buy, id: t.dataset.id, packs: Number(t.dataset.packs || 1) }, r => `🛒 ${r.bought} — in your inventory`);
  else if (t.dataset.use) await call('/api/fishing/use', { [GEAR[t.dataset.use]?.id?.split('_')[0] || 'rod']: t.dataset.use }, () => `🎣 Fishing with the ${GEAR[t.dataset.use]?.name || 'new tackle'} now`);
  else if (t.dataset.leader) await call('/api/fishing/use', { leader: t.dataset.leader === '1' });
  else if (t.dataset.skill) await call('/api/fishing/skill', { id: t.dataset.skill });
  else if (t.dataset.respec) { if (confirm(`A fresh start for your skills costs ${vc(ang?.respec || 0)}. Every point comes back to spend again.`)) await call('/api/fishing/respec', {}, () => '↺ Your skill points are back to spend'); }
}
async function sell() {
  let r;
  try { r = await post('/api/fishing/sell', {}); }
  catch (err) { app.toast(err.message, 'bad', 3500); return; }
  app.toast(`💰 +${fmtVc(r.paid)} from the fish market${r.capped ? ' (today\'s limit reached)' : ''}`, 'good', 3500);
  app.economy?.refresh?.(); app.profile?.refresh?.();
  await ask(true);
  app.inventory?.refresh?.();
}
