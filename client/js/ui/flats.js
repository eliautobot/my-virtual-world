// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A flat's window (2026-10-05; server/world/edit.js flatOp): who holds it and the deal (the owner's, assigned,
// rented, sold), who lives there — characters, AI agents' characters and players —, visitors invited until a time, and
// the lock on its door. What may be changed follows who is looking: the building's owner deals and chooses tenants, the
// buyer chooses tenants and keeps the door, a tenant who is a player keeps the door and invites visitors.
import { post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { S, bus, bld, levelOf } from '../core/state.js';
import { auth } from '../core/auth.js';
import { mayOn } from '../core/rights.js';
import { floorsName } from '/shared/edit.js';
import { flatRef } from '/shared/flat-ref.js';

const KIND = { studio: 'Studio', one: 'One-bedroom', two: 'Two-bedroom' };
let app = null, cur = null;
export function initFlats(a) { app = a; bus.on('flats', () => cur?.render()); bus.on('world', () => cur?.render()); }
const me = () => (auth.account ? String(auth.account.id) : null);
const same = (a, b) => a.kind === b.kind && String(a.id) === String(b.id);
export function flatRecord(b, f, u) { return S.world.flats?.[`${b}:${f}:${u}`] || null; }
/** 'own' | 'keep' | 'live' | null — what the signed-in person may do with flat (b, f, u), as the server decides it. */
export function flatPower(B, rec) {
  if (mayOn(B, 'build')) return 'own';
  if (me() && rec?.owner?.kind === 'account' && String(rec.owner.id) === me()) return 'keep';
  if (me() && rec?.tenants?.some(t => t.kind === 'account' && String(t.id) === me())) return 'live';
  return null;
}
/** Whether person i (or, with i < 0, the signed-in player) may come through flat (b, f, u)'s door. */
export function mayEnter(B, f, u, i = -1) {
  const rec = flatRecord(B.idx, f, u);
  if (!rec?.locked) return true;
  const now = Date.now(), who = i >= 0 ? { kind: 'person', id: i } : me() ? { kind: 'account', id: me() } : null;
  if (i < 0 && mayOn(B, 'build')) return true;
  if (i >= 0) { const p = S.people[i]; if (p && p.hb === B.idx && p.hf === f && p.hu === u) return true; }
  if (!who) return false;
  return (rec.owner && same(rec.owner, who)) || (rec.tenants || []).some(t => same(t, who)) || (rec.visitors || []).some(v => v.until > now && same(v, who));
}
const whoName = w => (w.kind === 'person' ? (S.people[w.id]?.n || 'A resident') + (S.people[w.id]?.v ? ' (agent)' : '') : (w.name || 'A player') + ' (player)');
/** Reads "a resident's name" or "@login" from a text box into a who. */
function readWho(text) {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('@')) return { kind: 'account', login: t.slice(1) };
  const i = S.people.findIndex(p => p && !p.x && p.n && p.n.toLowerCase() === t.toLowerCase());
  return i >= 0 ? { kind: 'person', id: i } : { kind: 'account', login: t };
}

export function openFlat(b, f, u) {
  cur?.close();
  const el = document.body.appendChild(h(`<div class="modal-back lib-back"><div class="panel libdlg flatdlg" role="dialog" aria-modal="true"></div></div>`));
  const box = el.querySelector('.flatdlg');
  const names = `<datalist id="flat-people">${S.people.filter(p => p && !p.x && p.n).slice(0, 4000).map(p => `<option value="${esc(p.n)}">`).join('')}</datalist>`;
  const send = async op => { try { const r = await post('/api/edit', { ops: [{ b, f, u, ...op }], who: 'web' }); if (r && r.ok === false) throw new Error(r.error); } catch (err) { if (!err.quiet) app?.toast(err.message, 'bad', 3200); } };
  const render = () => {
    const B = bld(b), L = levelOf(b, f), U = L?.units?.[u];
    if (!B || !U) { close(); return; }
    const rec = flatRecord(b, f, u), power = flatPower(B, rec), now = Date.now();
    const deal = rec?.deal || 'own';
    const living = S.people.map((p, i) => [p, i]).filter(([p]) => p && !p.x && p.hb === b && p.hf === f && p.hu === u).map(([, i]) => ({ kind: 'person', id: i }));
    const tenants = rec?.tenants?.length ? rec.tenants : living;
    const visitors = (rec?.visitors || []).filter(v => v.until > now);
    const rentText = `${Number(rec?.rent || 0).toLocaleString()} a month`;
    const dealText = deal === 'sold' ? `Sold to ${esc(whoName(rec.owner))}` : deal === 'rented' ? `Rented out · ${rentText}` : deal === 'assigned' ? 'Assigned to its tenants' : "The building owner's";
    const ref = flatRef(B, f, L, u);
    box.innerHTML = `<h3><span>🏠 Flat ${u + 1} · ${esc(KIND[U.kind] || 'Flat')}</span><button type="button" class="btn small" data-a="close" aria-label="Close">✕</button></h3>
      <p class="hint">${esc(B.name)}, ${esc(floorsName(B, [f]))} · ${dealText} · ${rec?.locked ? '🔒 locked: only its people and visitors come in' : '🔓 open to anyone'}</p>
      <div class="flat-sec"><b>Lives here</b>${tenants.length ? `<div class="lib-who">${tenants.map(t => `<span class="chip">${esc(whoName(t))}${power === 'own' || power === 'keep' ? `<button type="button" data-a="untenant" data-k="${t.kind}" data-id="${t.id}" aria-label="Move out">✕</button>` : ''}</span>`).join('')}</div>` : '<span class="dim">Nobody yet.</span>'}
        ${power === 'own' || power === 'keep' ? `<div class="lib-add"><input type="text" list="flat-people" placeholder="A resident's or agent's name, or @player" data-in="tenant"><button type="button" class="btn small" data-a="tenant">Move in</button></div>` : ''}</div>
      <div class="flat-sec"><b>Visitors</b>${visitors.length ? `<div class="lib-who">${visitors.map(v => `<span class="chip">${esc(whoName(v))} · until ${new Date(v.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${power ? `<button type="button" data-a="uninvite" data-k="${v.kind}" data-id="${v.id}" aria-label="Take back the invitation">✕</button>` : ''}</span>`).join('')}</div>` : '<span class="dim">No one invited.</span>'}
        ${power ? `<div class="lib-add"><input type="text" list="flat-people" placeholder="Name or @player" data-in="visitor"><select data-in="hours"><option value="1">1 hour</option><option value="3" selected>3 hours</option><option value="12">12 hours</option><option value="24">a day</option><option value="72">3 days</option></select><button type="button" class="btn small" data-a="invite">Invite</button></div>` : ''}</div>
      ${power ? `<div class="lib-btns"><button type="button" class="btn" data-a="lock">${rec?.locked ? '🔓 Unlock the door' : '🔒 Lock the door'}</button></div>` : ''}
      ${app?.econ?.status()?.enabled ? '<div class="flat-sec flat-econ"></div>' : ''}
      ${power === 'own' ? `<div class="flat-sec"><b>The deal</b><div class="lib-add">
        <select data-in="deal"><option value="own"${deal === 'own' ? ' selected' : ''}>Keep it (the city finds residents)</option><option value="assigned"${deal === 'assigned' ? ' selected' : ''}>Assign it to tenants</option><option value="rented"${deal === 'rented' ? ' selected' : ''}>Rent it out</option><option value="sold"${deal === 'sold' ? ' selected' : ''}>Sell it</option></select>
        <input type="number" min="0" step="50" placeholder="Rent a month" data-in="rent" value="${rec?.rent ?? ''}" class="${deal === 'rented' ? '' : 'hidden'}">
        <input type="text" placeholder="Buyer: @player or a resident" data-in="buyer" list="flat-people" class="${deal === 'sold' ? '' : 'hidden'}">
        <button type="button" class="btn small primary" data-a="deal">Save</button></div></div>
      <div class="flat-sec"><b>The floor's flats</b><div class="lib-btns" style="justify-content:flex-start">
        <button type="button" class="btn small" data-a="split"${U.x1 - U.x0 >= 10 ? '' : ' disabled title="A flat takes 10 m to make two"'}>✂️ Split into two flats</button>
        <button type="button" class="btn small" data-a="remove">🗑 Remove this flat</button></div>
        <span class="dim">The flat beside it takes its room; the other flats stay as they are.</span></div>` : ''}
      ${power ? '' : '<p class="hint">Only the building’s owner, the flat’s buyer or its tenants can change it.</p>'}${names}`;
    const eb = box.querySelector('.flat-econ');
    if (eb) app.econ.flatSection(eb, { ref, b, f, u, power, title: `Flat ${u + 1} on ${floorsName(B, [f])} of ${B.name}`, reload: () => render() });
  };
  box.addEventListener('change', e => { if (e.target.dataset.in === 'deal') { box.querySelector('[data-in="rent"]').classList.toggle('hidden', e.target.value !== 'rented'); box.querySelector('[data-in="buyer"]').classList.toggle('hidden', e.target.value !== 'sold'); } });
  box.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    const B = bld(b), rec = flatRecord(b, f, u), val = k => box.querySelector(`[data-in="${k}"]`)?.value || '';
    const living = S.people.map((p, i) => [p, i]).filter(([p]) => p && !p.x && p.hb === b && p.hf === f && p.hu === u).map(([, i]) => ({ kind: 'person', id: i }));
    const list = (rec?.tenants?.length ? rec.tenants : living).map(t => (t.kind === 'account' ? { kind: 'account', id: t.id } : t));
    if (a === 'close') return close();
    if (a === 'lock') return send({ op: 'flat.set', locked: !rec?.locked });
    if (a === 'tenant') { const w = readWho(val('tenant')); if (w) await send({ op: 'flat.set', tenants: [...list, w] }); return; }
    if (a === 'untenant') { const k = e.target.closest('[data-a]').dataset; return send({ op: 'flat.set', tenants: list.filter(t => !(t.kind === k.k && String(t.id) === k.id)) }); }
    if (a === 'invite') { const w = readWho(val('visitor')); if (w) await send({ op: 'flat.invite', who: w, hours: +val('hours') || 3 }); return; }
    if (a === 'uninvite') { const k = e.target.closest('[data-a]').dataset; return send({ op: 'flat.uninvite', who: { kind: k.k, id: k.k === 'person' ? +k.id : k.id } }); }
    if (a === 'split') { await send({ op: 'flat.add' }); close(); return; }
    if (a === 'remove') {
      const btn = e.target.closest('[data-a]');
      if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to remove it'; btn.classList.add('danger'); setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = '🗑 Remove this flat'; btn.classList.remove('danger'); } }, 3000); return; }
      await send({ op: 'flat.del' }); close(); return;
    }
    if (a === 'deal') { const d = val('deal'), op = { op: 'flat.set', deal: d }; if (d === 'rented') op.rent = +val('rent') || 0; if (d === 'sold') { const w = readWho(val('buyer')); if (!w) { app?.toast('Who buys it?', 'bad'); return; } op.owner = w; } void B; return send(op); }
  });
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); if (cur?.el === el) cur = null; };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  el.addEventListener('click', e => { if (e.target === el) close(); });
  cur = { el, close, render };
  render();
}
