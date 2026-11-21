// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions (docs/features/companions.md; server/companions/): the agents with you or out on an order of yours, in Play
// mode and in sim mode alike.
// - The party bar (left, above the map): each companion's face with what it is doing — with you, waiting, in your car,
//   meeting up, on its way somewhere — and the count against the most that may follow you. A face opens its menu: Follow
//   me, Wait here, Send to…, Go with…, Let go; the bar's head opens the panel: add one, set a meet-up, let everyone go.
// - An agent's own card (the selection): the same orders for an agent of yours, right there.
// - Saying it works too: "follow me", "wait here", "let's go to the café", "you're dismissed" in its chat (the server's
//   reflex) — what happened shows here as it changes (the 'companions' frame), and as a line in the chat.
import { S, bus, select } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { toast } from './ui.js';

const STATE = Object.freeze({
  following: ['🧭', 'With you'], waiting: ['⏳', 'Waiting'], riding: ['🚗', 'In your car'], meetup: ['👥', 'Meeting up'],
  going: ['📍', 'Out'], away: ['💤', 'Stepped away'],
});
/** A companion's icon and word: its state's — or, a follower still on its way to its leader, "On the way". */
const stateOf = c => (c.arcade?.playing ? [c.arcade.icon || '🕹️', 'Playing'] : c.coming && c.kind === 'follow' ? ['🚶', 'On the way'] : c.state === 'riding' && c.boat ? (c.boat === 'fishing' ? ['🎣', 'Fishing'] : ['🚤', 'On your boat']) : STATE[c.state] || STATE.going);   // (a boat: server/play/fishing-crew.js; a game: server/play/arcade-crew.js)
const KINDS = ['café', 'park', 'gym', 'bar', 'club', 'arcade', 'restaurant', 'shop', 'home', 'work'];
let app = null;
const C = { list: [], max: 3, following: 0, enabled: true, open: false, menu: null, busy: false, spot: null };
const E = {};

export function init(a) {
  app = a;
  app.companions = { refresh, command, list: () => C.list.slice(), sendHere };
  E.bar = h('<div id="party" class="party hidden" role="region" aria-label="Companions"></div>');
  // (with the page's other controls, under its windows — the Agent Studio, Settings, a chat full screen — not over them)
  (document.getElementById('ui') || document.body).appendChild(E.bar);
  E.bar.addEventListener('click', onBar);
  bus.on('msg:companions', m => apply(m));
  bus.on('msg:companion_note', m => toast(m.text, m.ok ? 'good' : 'bad', 4200, '🧭'));
  bus.on('auth', () => { C.list = []; refresh(); });
  bus.on('agentlist', () => paint());
  bus.on('mode', () => { closeMenu(); paint(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (C.menu || C.open)) { closeMenu(); C.open = false; paint(); } });
  document.addEventListener('pointerdown', e => { if (C.menu && !e.target.closest('.party-menu') && !e.target.closest('[data-cm]') && !e.target.closest('.cp-card')) closeMenu(); }, true);
  app.inspHooks = app.inspHooks || { building: [], resident: [] };
  app.inspHooks.resident.push(cardRow);
  refresh();
  setInterval(() => { if (auth.account && !document.hidden && C.list.length) refresh(); }, 20000).unref?.();
}

// ------------------------------------------------------------------------------------------------ data
/** This account's own agents (and those it manages) that have a body in the city. */
const mine = () => (S.agentList || []).filter(a => (a.mine || a.level === 'manage') && a.i >= 0);
const recOf = id => (S.agentList || []).find(a => a.id === id) || null;
const compOf = id => C.list.find(c => c.agent === id) || null;
async function refresh() {
  if (!auth.account) { apply({ companions: [], max: 3, following: 0, enabled: true }); return; }
  try { apply(await getJSON('/api/companions')); } catch { /* offline: the next frame or refresh */ }
}
function apply(m) {
  C.list = Array.isArray(m.companions) ? m.companions : [];
  C.max = m.max ?? C.max; C.following = m.following ?? C.following; C.enabled = m.enabled !== false;
  paint();
  if (C.menu) { const c = compOf(C.menu.id); if (C.menu.kind === 'agent') paintMenu(); else if (!c) closeMenu(); else paintMenu(); }
  bus.emit('companions', C.list);
}
/** One order (server/companions/ command): toast what happened; true when it was done. */
async function command(body) {
  if (C.busy) return false;
  C.busy = true;
  try {
    const r = await post('/api/companions', body);
    toast(r.text || 'Done', 'good', 3600, '🧭');
    await refresh();
    return true;
  } catch (e) { toast(e.message || 'That could not be done', 'bad', 4800); return false; } finally { C.busy = false; }
}
const playing = () => !!app.player?.active;

// ------------------------------------------------------------------------------------------------ the party bar
function paint() {
  const own = mine();
  const show = !!auth.account && C.enabled && (C.list.length > 0 || (own.length > 0 && C.open));
  const head = auth.account && C.enabled && own.length > 0;
  E.bar.classList.toggle('hidden', !head);
  if (!head) { E.bar.innerHTML = ''; E.html = ''; return; }
  const faces = C.list.map(c => {
    const [ic, word] = stateOf(c), rec = recOf(c.agent);
    // (sitting with you: on what, or at your meal; using something beside you — the server's words)
    const sub = (c.seat || c.using || c.arcade?.playing) && c.doing ? c.doing : c.coming && c.kind === 'follow' ? `On the way to ${c.leader?.kind === 'agent' ? c.leader.name : 'you'}` : c.via === 'agent' && c.with?.length ? `${c.kind === 'follow' ? 'Going' : 'Out'} with ${c.with.join(', ')}${c.place && c.kind !== 'follow' ? ` · ${c.place}` : ''}` : c.state === 'following' && c.leader?.kind === 'agent' ? `With ${c.leader.name}` : c.state === 'waiting' && c.kind === 'follow' ? (c.leader?.away ? 'Waiting for you to come back' : 'Waiting by your character') : c.place && c.state !== 'following' && c.state !== 'riding' ? `${word} · ${c.place}` : word;
    // (out with you while it should be at work: its shift, in a word — server/workplace/presence.js)
    const wk = c.work && c.work.state !== 'on_duty' ? c.work : null;
    return `<button type="button" class="party-face st-${esc(c.state)}${c.via === 'agent' ? ' own-choice' : ''}${wk ? ' on-shift' : ''}" data-cm="${c.agent}" title="${esc(`${c.name}: ${c.doing || word}${c.via === 'agent' ? ' (its own choice)' : ''}${wk ? `\nIts shift as ${c.work.role} at ${c.work.place}: ${c.work.text}` : ''}`)}">
      <span class="pf-av" data-avatar>${esc(rec?.emoji || c.emoji || '🤖')}</span><span class="pf-ic">${ic}</span>
      <span class="pf-t"><b>${esc(c.name)}</b><small>${esc(sub)}</small>${wk ? `<small class="pf-work">⏰ ${esc(wk.state === 'late' ? 'Late for work' : 'Missing work')}</small>` : ''}</span></button>`;
  }).join('');
  const withMe = C.list.filter(c => c.kind === 'follow' && c.leader?.kind === 'player').length;
  const html = `<button type="button" class="party-head${C.open ? ' on' : ''}" data-a="panel" aria-expanded="${C.open}" title="Companions: take your agents along, send them places, set meet-ups">
      <span>👥</span><b>Companions</b><small>${withMe}/${C.max}</small></button>
    <div class="party-faces">${faces}</div>
    ${C.open && show ? panelHtml(own) : ''}`;
  if (html === E.html) return;   // (nothing changed: the faces stay as they are — a click on one isn't lost)
  // what is being typed or ticked in the panel survives a new list
  const kept = [...E.bar.querySelectorAll('input')].map(x => [x.dataset.place ? `p${x.dataset.place}` : x.dataset.mu ? `m${x.dataset.mu}` : x.dataset.here ? `h${x.dataset.here}` : '', x.type === 'checkbox' ? x.checked : x.value]).filter(k => k[0]);
  const focus = document.activeElement?.closest?.('#party') ? document.activeElement.dataset.place : null;
  E.html = html; E.bar.innerHTML = html;
  for (const [k, v] of kept) {
    const x = E.bar.querySelector(k[0] === 'p' ? `[data-place="${k.slice(1)}"]` : k[0] === 'm' ? `[data-mu="${k.slice(1)}"]` : `[data-here="${k.slice(1)}"]`);
    if (x) { if (x.type === 'checkbox') x.checked = v; else x.value = v; }
  }
  if (focus) E.bar.querySelector(`[data-place="${focus}"]`)?.focus();
}
function panelHtml(own) {
  const active = new Set(C.list.map(c => c.agent));
  const rest = own.filter(a => !active.has(a.id));
  const full = C.list.filter(c => c.kind === 'follow' && c.leader?.kind === 'player').length >= C.max;
  return `<div class="party-panel card">
    <div class="pp-sec"><div class="hint">${playing() ? 'Take one along — or just tell it in its chat: “follow me”, “wait here”, “let’s go to the café”.' : 'In sim mode, send them places or set a meet-up. “Follow me” brings them to your parked character.'}</div>
    ${rest.length ? rest.map(a => `<div class="party-row"><span data-avatar>${esc(a.emoji || '🤖')}</span><b>${esc(a.name)}</b>
      <button type="button" class="btn small" data-a="follow" data-id="${a.id}"${full ? ' disabled title="As many as may follow you already"' : ''}>🧭 Follow me</button>
      <button type="button" class="btn small" data-a="menu" data-id="${a.id}" title="More: wait, send somewhere, go with another agent">…</button></div>`).join('') : '<div class="hint">All your agents are out with you or on an order.</div>'}</div>
    ${own.length > 1 || C.spot ? `<div class="pp-sec"><div class="pp-sh">👥 ${own.length > 1 ? 'Meet up' : 'Send'}</div>
      <div class="party-pick">${own.map(a => `<label><input type="checkbox" data-mu="${a.id}"> <span data-avatar>${esc(a.emoji || '🤖')}</span> ${esc(a.name)}</label>`).join('')}</div>
      ${C.spot ? `<div class="party-row">📍 <b>${esc(C.spot.name)}</b><button type="button" class="btn small" data-a="unspot" title="Name a place instead">✕</button></div>` : placeField('mu')}<button type="button" class="btn small primary" data-a="meetup">${own.length > 1 ? 'Meet up there' : 'Send there'}</button></div>` : ''}
    ${C.list.length ? '<div class="pp-sec"><button type="button" class="btn small" data-a="all">✋ Let everyone go</button></div>' : ''}
  </div>`;
}
/** A place to name: a text field with the city's places to pick from, and the floor being looked at (sim mode). */
function placeField(id) {
  const names = new Set(KINDS);
  for (const B of S.world?.buildings || []) if (B && !B.gone && B.name) names.add(B.name);
  const here = S.focus?.b >= 0 ? S.world?.buildings[S.focus.b] : null;
  return `<div class="party-place"><input class="input" list="cp-places-${id}" data-place="${id}" placeholder="A place: a café, a park, a building's name" maxlength="80">
    <datalist id="cp-places-${id}">${[...names].slice(0, 400).map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    ${here ? `<label class="party-here"><input type="checkbox" data-here="${id}"> Where I'm looking: ${esc(here.name || 'this building')}, floor ${S.focus.f + 1}</label>` : ''}</div>`;
}
/** What a place field says: { spot: { b, f } } (the floor looked at), { place } or null. */
function placeOf(root, id) {
  const here = root.querySelector(`[data-here="${id}"]`);
  if (here?.checked && S.focus?.b >= 0) return { spot: { b: S.focus.b, f: S.focus.f } };
  const v = root.querySelector(`[data-place="${id}"]`)?.value.trim();
  return v ? { place: v } : null;
}
async function onBar(e) {
  const face = e.target.closest('[data-cm]');
  if (face) { openMenu(+face.dataset.cm, face, 'comp'); return; }
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, id = +b.dataset.id;
  if (a === 'panel') { C.open = !C.open; if (!C.open) C.spot = null; closeMenu(); paint(); return; }
  if (a === 'unspot') { C.spot = null; paint(); return; }
  if (a === 'follow') { await command({ agent: id, action: 'follow', target: 'me' }); return; }
  if (a === 'menu') { openMenu(id, b, 'agent'); return; }
  if (a === 'all') { try { const r = await post('/api/companions/dismiss-all', {}); toast(`${r.dismissed.length} went back to their day`, 'good', 3200, '✋'); await refresh(); } catch (err) { toast(err.message, 'bad'); } return; }
  if (a === 'meetup') {
    const ids = [...E.bar.querySelectorAll('[data-mu]:checked')].map(x => +x.dataset.mu);
    if (!ids.length) { toast('Tick who meets up', 'bad'); return; }
    const where = C.spot ? { spot: { x: C.spot.x, z: C.spot.z, ctx: -1 } } : placeOf(E.bar, 'mu');
    if (!where) { toast('Name the place to meet', 'bad'); return; }
    try { const r = await post('/api/companions', { action: 'meetup', agents: ids, ...where }); toast(r.text, 'good', 4200, '👥'); C.spot = null; await refresh(); } catch (err) { toast(err.message, 'bad', 5000); }
  }
}

/** The world map's "Send my agents here" (ui/worldmap.js): the panel opens with that spot as the place to meet. */
function sendHere(spot) {
  if (!auth.account) { toast('Sign in to send your agents somewhere', 'bad'); return; }
  if (!mine().length) { toast('You have no agent in the city yet', 'bad'); return; }
  C.spot = { x: spot.x, z: spot.z, name: spot.name || 'The spot on the map' };
  C.open = true; closeMenu(); paint();
  const first = E.bar.querySelector('[data-mu]');
  if (first && mine().length === 1) first.checked = true;
}

// ------------------------------------------------------------------------------------------------ one agent's menu
function openMenu(id, anchor, kind) {
  if (C.menu?.id === id && C.menu.kind === kind) { closeMenu(); return; }
  closeMenu();
  C.menu = { id, kind, anchor, view: 'main' };
  E.menu = h('<div class="party-menu card" role="menu"></div>');
  document.body.appendChild(E.menu);
  E.menu.addEventListener('click', onMenu);
  paintMenu();
}
function closeMenu() { E.menu?.remove(); E.menu = null; C.menu = null; }
function paintMenu() {
  const m = C.menu; if (!m || !E.menu) return;
  const rec = recOf(m.id), c = compOf(m.id);
  if (!rec) { closeMenu(); return; }
  const withMe = c?.kind === 'follow' && c.leader?.kind === 'player';
  const others = mine().filter(a => a.id !== m.id);
  let body;
  if (m.view === 'send') body = `<button type="button" class="pp-back" data-m="back">← Back</button><div class="pp-sh">📍 Send ${esc(rec.name)} to…</div>${placeField('send')}
      <label class="party-here"><input type="checkbox" data-stay="1"> and wait there for me</label>
      <button type="button" class="btn small primary" data-m="send-go">Go</button>`;
  else if (m.view === 'with') body = `<button type="button" class="pp-back" data-m="back">← Back</button><div class="pp-sh">🤝 ${esc(rec.name)} goes with…</div>
      ${others.length ? others.map(a => `<button type="button" class="pp-item" data-m="with-go" data-id="${a.id}"><span data-avatar>${esc(a.emoji || '🤖')}</span>${esc(a.name)}</button>`).join('') : '<div class="hint">No other agent of yours is in the city.</div>'}`;
  else body = `${withMe ? '' : `<button type="button" class="pp-item" data-m="follow">🧭 ${playing() ? 'Follow me' : 'Come to my character'}</button>`}
      ${withMe && c.state === 'riding' ? '' : `<button type="button" class="pp-item" data-m="stay">⏸ Wait ${c ? 'there' : 'where it is'}</button>`}
      <button type="button" class="pp-item" data-m="send">📍 Send to…</button>
      ${others.length ? '<button type="button" class="pp-item" data-m="with">🤝 Go with…</button>' : ''}
      <button type="button" class="pp-item" data-m="trade">🤝 Trade / give…</button>
      ${rec.i >= 0 ? '<button type="button" class="pp-item" data-m="look">🎥 Show me</button>' : ''}
      ${c ? '<button type="button" class="pp-item" data-m="dismiss">✋ Let go — back to its day</button>' : ''}`;
  const [ic, word] = c ? stateOf(c) : ['', ''];
  E.menu.innerHTML = `<div class="pp-h"><span class="pp-ic" data-avatar>${esc(rec.emoji || '🤖')}</span><div><b>${esc(rec.name)}</b><small>${c ? `${ic} ${esc(c.doing || word)}` : 'Living its own day'}</small></div><button type="button" class="pp-x" data-m="close" aria-label="Close">✕</button></div>${body}`;
  place();
}
function place() {
  const m = C.menu; if (!m || !E.menu) return;
  const r = m.anchor?.isConnected ? m.anchor.getBoundingClientRect() : { left: 80, right: 80, top: 160, bottom: 160 };
  const w = E.menu.offsetWidth || 260, hgt = E.menu.offsetHeight || 220;
  let x = r.right + 8, y = r.top;
  if (x + w > innerWidth - 8) x = Math.max(8, r.left - w - 8);
  if (y + hgt > innerHeight - 8) y = Math.max(8, innerHeight - hgt - 8);
  E.menu.style.left = `${Math.round(x)}px`; E.menu.style.top = `${Math.round(y)}px`;
}
async function onMenu(e) {
  const b = e.target.closest('[data-m]'); if (!b || !C.menu) return;
  const id = C.menu.id, m = b.dataset.m;
  if (m === 'close') return closeMenu();
  if (m === 'back') { C.menu.view = 'main'; return paintMenu(); }
  if (m === 'send' || m === 'with') { C.menu.view = m; paintMenu(); E.menu.querySelector('input.input')?.focus(); return; }
  if (m === 'look') { const r = recOf(id); closeMenu(); if (r?.i >= 0) select(r.i, { fly: true }); return; }
  if (m === 'trade') { const r = recOf(id); closeMenu(); if (r) app.companionTrade?.open({ id: r.id, name: r.name, emoji: r.emoji }); return; }   // (ui/companion-trade.js)
  let ok = false;
  if (m === 'follow') ok = await command({ agent: id, action: 'follow', target: 'me' });
  else if (m === 'stay') ok = await command({ agent: id, action: 'stay' });
  else if (m === 'dismiss') ok = await command({ agent: id, action: 'dismiss' });
  else if (m === 'with-go') ok = await command({ agent: id, action: 'follow', target: +b.dataset.id });
  else if (m === 'send-go') {
    const where = placeOf(E.menu, 'send');
    if (!where) { toast('Name the place', 'bad'); return; }
    ok = await command({ agent: id, action: E.menu.querySelector('[data-stay]')?.checked ? 'stay' : 'go', ...where });
  }
  if (ok) closeMenu();
}

// ------------------------------------------------------------------------------------------------ the agent's card
/** On the card of an agent of this account's: its companion orders, right there. */
function cardRow(body, i) {
  const rec = (S.agentList || []).find(a => a.i === i && (a.mine || a.level === 'manage'));
  if (!rec || !auth.account || !C.enabled) return;
  const c = compOf(rec.id), withMe = c?.kind === 'follow' && c.leader?.kind === 'player';
  const [ic, word] = c ? stateOf(c) : ['', ''];
  const row = h(`<div class="cp-card"><div class="cp-st">${c ? `${ic} <b>${esc(word)}</b>${c.place && !withMe ? ` · ${esc(c.place)}` : ''}` : '🧭 Companion'}</div>
    <div class="row">${withMe ? '' : `<button type="button" class="btn small" data-c="follow">🧭 ${playing() ? 'Follow me' : 'Come to me'}</button>`}
    <button type="button" class="btn small" data-c="stay">⏸ Wait</button><button type="button" class="btn small" data-c="trade" title="Give them something, or trade">🤝 Trade</button><button type="button" class="btn small" data-c="more">📍 More</button>
    ${c ? '<button type="button" class="btn small" data-c="dismiss">✋ Let go</button>' : ''}</div></div>`);
  const tags = body.querySelector('.sel-btns');
  if (tags) tags.after(row); else body.appendChild(row);
  row.addEventListener('click', async e => {
    const b = e.target.closest('[data-c]'); if (!b) return;
    const a = b.dataset.c;
    if (a === 'more') { openMenu(rec.id, b, 'agent'); return; }
    if (a === 'trade') { app.companionTrade?.open({ id: rec.id, name: rec.name, emoji: rec.emoji }); return; }
    await command({ agent: rec.id, action: a === 'follow' ? 'follow' : a, ...(a === 'follow' ? { target: 'me' } : {}) });
  });
  // (kept up to date while the card is open)
  const off = bus.on('companions', () => { if (!row.isConnected) { off?.(); return; } const n = compOf(rec.id); if (JSON.stringify([n?.state, n?.place, n?.coming]) !== JSON.stringify([c?.state, c?.place, c?.coming])) { row.remove(); off?.(); cardRow(body, i); } });
}
