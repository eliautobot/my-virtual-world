// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The activity log in the info dock, and the account's own undo and redo (PLAN WP1.8, DECISIONS C35, C116).
// - Undo and redo: the top bar's ↶ ↷ (on a phone, the edit drawer's), Ctrl+Z, and Ctrl+Y or Ctrl+Shift+Z. Each account
//   undoes only its own edits; the server refuses, with the reason, an undo whose target someone changed later. After
//   an undo or redo a short message names the change and the camera stays.
// - The log: world edits (kept on the server) and live lines (residents arriving, agents starting and stopping work,
//   players joining and leaving, undos and redos), newest first. A line with a place flies there; admins revert any
//   edit with its Revert button, and undo that revert like any of their own edits.
import { S, bus, select, selectBuilding, bld } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { canEdit } from '../core/rights.js';
import { h, esc } from '../core/util.js';

const ICON = { edit: '✏️', revert: '↩️', undo: '↶', redo: '↷', residents: '🧳', agent: '🤖', player: '🌐' };
const KEEP = 200;
let app = null, sig = null;
const E = { undo: [], redo: [] };
const A = { items: [], more: false, seq: 0, loading: false };
const H = { undo: null, redo: null, undoCount: 0, redoCount: 0, busy: false };

export function init(a) {
  app = a;
  const slot = a.docks && a.docks.slot('r:activity');
  if (slot) buildLog(slot);
  buildButtons();
  window.addEventListener('keydown', onKey);
  bus.on('msg:activity', onLive);
  bus.on('msg:history', setHistory);
  bus.on('auth', onAuth);
  // A reconnect (the server restarted, the network dropped) may have missed lines: read the log again.
  bus.on('hello', () => { auth.refresh().then(() => load(true), () => {}); });
  a.activity = { reload: () => load(true), items: () => A.items.slice(), history: () => ({ ...H }) };
  a.undo = () => step('undo');
  a.redo = () => step('redo');
  onAuth();
}

// ------------------------------------------------------------------ undo and redo
function buildButtons() {
  E.undo.push(...document.querySelectorAll('#topbar .undo'));
  E.redo.push(...document.querySelectorAll('#topbar .redo'));
  // On a phone the top bar has no room for them: the edit drawer's head carries a pair (I3.6).
  const head = document.querySelector('#dockL .dock-head');
  if (head) {
    const w = head.appendChild(h(`<div class="dock-undo">
      <button type="button" class="btn icon undo" aria-label="Undo">↶</button><button type="button" class="btn icon redo" aria-label="Redo">↷</button></div>`));
    E.undo.push(w.querySelector('.undo'));
    E.redo.push(w.querySelector('.redo'));
  }
  for (const b of E.undo) b.onclick = () => step('undo');
  for (const b of E.redo) b.onclick = () => step('redo');
  paint();
}
function paint() {
  const can = canEdit();
  const text = (verb, key, e) => (!can ? `${verb} your own changes (${key}): sign in to build on your own land`
    : e ? `${verb}: ${e.summary} (${key})` : `Nothing to ${verb.toLowerCase()} (${key})`);
  for (const [list, verb, key, e] of [[E.undo, 'Undo', 'Ctrl+Z', H.undo], [E.redo, 'Redo', 'Ctrl+Y', H.redo]]) {
    const t = text(verb, key, e);
    for (const b of list) {
      b.disabled = !can || !e || H.busy;
      if (b.title !== t) { b.title = t; b.setAttribute('aria-label', t); }
    }
  }
}
/** The account's next undo and redo, from the server (pushed live over the socket, and in every answer). */
function setHistory(m) {
  if (!m || typeof m !== 'object') return;
  H.undo = m.undo || null; H.redo = m.redo || null;
  H.undoCount = m.undoCount | 0; H.redoCount = m.redoCount | 0;
  paint();
}
function onKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.repeat) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;   // the field's own undo
  if (document.querySelector('.modal-back, .auth-back') || S.mode === 'play') return;
  const k = String(e.key).toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); step('undo'); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); step('redo'); }
}
async function step(dir) {
  if (H.busy) return;
  if (!canEdit()) { app.toast('Sign in to undo your own changes', 'bad'); return; }
  const e = H[dir];
  if (!e) { app.toast(dir === 'undo' ? 'Nothing to undo' : 'Nothing to redo', '', 1800); return; }
  H.busy = true; paint();
  try {
    const r = await post(`/api/${dir}`, {});
    if (r && r.history) setHistory(r.history);
    const done = r && r[dir === 'undo' ? 'undone' : 'redone'];
    app.toast(`${dir === 'undo' ? 'Undone' : 'Redone'}: ${done ? done.summary : e.summary}`, 'good', 2600);
  } catch (err) {
    if (!err.quiet) app.toast(err.message || String(err), 'bad', 6500);
  } finally {
    H.busy = false; paint();
  }
}

// ------------------------------------------------------------------ the activity log
// A timeline (2026-10-06: "too cramped and not intuitive — make it a true activity log"): filters by kind, the days as
// headings, and for each line its time, a dot coloured by kind on a line joining them, what happened, who, and its actions.
const KIND = {
  edit: ['Change', 'edits'], revert: ['Revert', 'edits'], undo: ['Undo', 'edits'], redo: ['Redo', 'edits'],
  residents: ['Residents', 'residents'], agent: ['Agent', 'agents'], player: ['Player', 'players'],
};
const FILTERS = [['all', 'All'], ['edits', 'Changes'], ['residents', 'Residents'], ['agents', 'Agents'], ['players', 'Players']];
let filter = 'all';
function buildLog(slot) {
  const el = slot.appendChild(h(`<div class="alog">
    <p class="hint act-guest hidden">Sign in to see who changed what.</p>
    <div class="al-filters seg" role="tablist" aria-label="Show">${FILTERS.map(([k, t]) => `<button type="button" class="btn small${k === filter ? ' on' : ''}" data-f="${k}" role="tab">${t}</button>`).join('')}</div>
    <div class="al-list act-list" aria-label="Activity log"></div>
    <div class="ld-sr al-live" role="status" aria-live="polite"></div>
    <button type="button" class="btn small wide act-more hidden">Show older</button></div>`));
  E.guest = el.querySelector('.act-guest'); E.list = el.querySelector('.al-list'); E.more = el.querySelector('.act-more');
  E.filters = el.querySelector('.al-filters'); E.live = el.querySelector('.al-live');
  E.more.onclick = () => load(false);
  E.list.addEventListener('click', onClick);
  E.filters.onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    filter = b.dataset.f;
    for (const x of E.filters.children) x.classList.toggle('on', x === b);
    render();
  };
}
function onAuth() {
  const me = auth.me || {}, caps = me.caps || {};
  const s = [me.account ? me.account.id : '-', me.role, caps['activity.read'] ? 1 : 0, caps['world.revert'] ? 1 : 0, caps['world.edit'] ? 1 : 0].join('|');
  if (s === sig) return;
  sig = s;
  H.undo = H.redo = null; H.undoCount = H.redoCount = 0;
  paint();
  if (canEdit()) getJSON('/api/history').then(setHistory, () => {});
  load(true);
}
async function load(reset) {
  if (!E.list) return;
  const can = auth.can('activity.read');
  E.guest.classList.toggle('hidden', can);
  E.list.classList.toggle('hidden', !can); E.filters.classList.toggle('hidden', !can);
  const seq = ++A.seq;
  if (reset) { A.items = []; A.more = false; }
  if (!can) { render(); return; }
  if (reset) render();
  A.loading = true; E.more.disabled = true;
  try {
    const before = !reset && A.items.length ? A.items[A.items.length - 1].at : null;
    const j = await getJSON(`/api/activity?limit=50${before ? `&before=${before}` : ''}`);
    if (seq !== A.seq) return;   // a newer load started meanwhile
    const byId = new Map(A.items.map(x => [x.id, x]));   // live lines that arrived during the request stay
    for (const it of j.items || []) if (!byId.has(it.id)) byId.set(it.id, it);
    A.items = [...byId.values()].sort((x, y) => y.at - x.at || (y.n || 0) - (x.n || 0)).slice(0, KEEP);
    A.more = !!j.more;
    render();
  } catch { /* the log keeps what it has */ } finally {
    if (seq === A.seq) { A.loading = false; E.more.disabled = false; }
  }
}
/** A live line: the list is drawn again with it on top (or updated in place); the status line reads just that line out. */
function onLive(m) {
  if (!E.list || !auth.can('activity.read')) return;
  if (m.item) {
    if (A.items.some(x => x.id === m.item.id)) return;
    A.items.unshift(m.item);
    if (A.items.length > KEEP) { A.items.length = KEEP; A.more = true; }
    if (E.live) E.live.textContent = m.item.text || '';
    render();
  } else if (m.update) {
    const k = A.items.findIndex(x => x.id === m.update.id);
    if (k < 0) return;
    A.items[k] = m.update;
    render();
  }
}
const dayKey = t => new Date(t).toDateString();
function dayName(t) {
  const d = new Date(t), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
const clock = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function ago(t) {
  const s = (Date.now() - t) / 1000;
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 6 * 3600 ? `${Math.floor(s / 3600)} h ago` : '';
}
function row(it) {
  const [label] = KIND[it.kind] || ['Note'];
  const off = it.status === 'undone' || it.status === 'reverted';
  const state = it.status === 'undone' ? '<span class="al-pill">undone</span>'
    : it.status === 'reverted' ? `<span class="al-pill">reverted${it.revertedBy ? ` by ${esc(it.revertedBy)}` : ''}</span>` : '';
  const canRevert = String(it.id)[0] === 'e' && it.status === 'done' && it.undoable && auth.can('world.revert');
  const who = it.actor && it.actor.name ? `<b>${esc(it.actor.name)}</b><span class="al-sep">·</span>` : '';
  const rel = ago(it.at);
  const acts = (it.place ? '<button type="button" class="btn small al-go" title="Show where it happened">📍 Show</button>' : '')
    + (canRevert ? '<button type="button" class="btn small act-revert" title="Revert this change: put back what it replaced">↩️ Revert</button>' : '');
  return `<div class="al-item k-${esc(it.kind || 'note')}${off ? ' off' : ''}${it.place ? ' has-place' : ''}" data-id="${esc(it.id)}">
    <div class="al-time" title="${esc(new Date(it.at).toLocaleString())}">${clock(it.at)}</div>
    <div class="al-dot" aria-hidden="true">${ICON[it.kind] || '•'}</div>
    <div class="al-card">
      <div class="al-text">${esc(it.text)}</div>
      <div class="al-meta">${who}<span>${label}</span>${rel ? `<span class="al-sep">·</span><span>${rel}</span>` : ''}${state}</div>
      ${it.task ? `<div class="al-task">${esc(it.task)}</div>` : ''}
      ${acts ? `<div class="al-acts">${acts}</div>` : ''}
    </div></div>`;
}
function render() {
  if (!E.list) return;
  const shown = A.items.filter(it => filter === 'all' || (KIND[it.kind] || [])[1] === filter);
  let html = '', day = '';
  for (const it of shown) {
    const k = dayKey(it.at);
    if (k !== day) { day = k; html += `<div class="al-day">${dayName(it.at)}</div>`; }
    html += row(it);
  }
  E.list.innerHTML = html || `<div class="al-empty"><span>📋</span><p>${A.items.length ? 'Nothing of this kind yet.' : 'Nothing yet: changes to the world, residents arriving, agents at work and players joining show up here.'}</p></div>`;
  E.more.classList.toggle('hidden', !A.more || !auth.can('activity.read'));
}
async function onClick(e) {
  const r = e.target.closest('.al-item');
  if (!r) return;
  const it = A.items.find(x => x.id === r.dataset.id);
  if (!it) return;
  const rv = e.target.closest('.act-revert');
  if (rv) { revert(it, rv); return; }
  if (it.place && (e.target.closest('.al-go') || !e.target.closest('button'))) goTo(it.place);   // the Show button, or the line itself
}
async function revert(it, btn) {
  btn.disabled = true;
  try {
    const r = await post('/api/revert', { id: it.n });
    app.toast(`Reverted: ${r.reverted ? r.reverted.summary : it.text}`, 'good', 2600);
  } catch (err) {
    btn.disabled = false;
    if (!err.quiet) app.toast(err.message || String(err), 'bad', 6500);
  }
}
/** Flies to a line's place: a resident, a building, a floor of one, or a spot on the map (a station, a change to the
 *  land beyond the city). */
function goTo(pl) {
  if (S.mode === 'play' && app.setMode) app.setMode('explore');
  if (Number.isFinite(pl.x) && Number.isFinite(pl.z) && !Number.isInteger(pl.b)) {
    const y = app.terrain ? app.terrain.heightAt(pl.x, pl.z) : 0;
    app.cam.flyTo(pl.x, y, pl.z, 120);
    return;
  }
  if (Number.isInteger(pl.i)) {
    if (!S.people[pl.i]) return app.toast('That resident is not in the city any more', 'bad');
    select(pl.i, { fly: true, force: true });
    return;
  }
  const B = Number.isInteger(pl.b) ? bld(pl.b) : null;
  if (!B) return app.toast('That building is gone', 'bad');
  if (Number.isInteger(pl.f) && pl.f < B.floors && app.lookInside) { app.lookInside(pl.b, pl.f); return; }
  if (S.focus.b >= 0 && S.focus.b !== pl.b && app.exitFocus) app.exitFocus();
  selectBuilding(pl.b);
  app.cam.flyTo(B.x, 0, B.z + Math.max(B.d, 8) * 0.6, Math.max(B.w, B.d) * 2.1 + 45);
}
