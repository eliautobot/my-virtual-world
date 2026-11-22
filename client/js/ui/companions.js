// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions (docs/features/companions.md; server/companions/): the agents with you or out on an order of yours, in Play
// mode and in sim mode alike.
// - The Companions card (a computer: standing on the map, one panel with it; a phone: a sheet from the bottom, opened
//   by its 👥 button among the round buttons — layout()): one panel in the interface's own look — its
//   head (who is with you against the most that may follow you, ＋ to take one along, a chevron to fold it down to their
//   faces), a row for each companion with what it is doing — with you, waiting, in your car, meeting up, on its way —
//   and, at its foot, the voice row to talk to them (ui/companion-voice.js puts itself there). A row opens its menu:
//   Follow me, Wait here, Send to…, Go with…, Trade, Show me, Let go.
// - ＋ (or the head) opens the Companions window beside the card: take another along, set a meet-up or send them
//   somewhere, let everyone go.
// - An agent's own card (the selection): the same orders for an agent of yours, right there.
// - Saying it works too: "follow me", "wait here", "let's go to the café", "you're dismissed" in its chat (the server's
//   reflex) — what happened shows here as it changes (the 'companions' frame), and as a line in the chat.
// (2026-11-20, the product owner: the companion menu didn't match the rest of the interface and took too much room — its
//  panel and menus had no surface of their own; it is now one card with popovers, the voice row folded into it.)
import { S, bus, select } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc } from '../core/util.js';
import { toast } from './ui.js';
import { miniMic } from './companion-voice.js';

const STATE = Object.freeze({
  following: ['🧭', 'With you'], waiting: ['⏳', 'Waiting'], riding: ['🚗', 'In your car'], meetup: ['👥', 'Meeting up'],
  going: ['📍', 'Out'], away: ['💤', 'Stepped away'],
});
/** A companion's icon and word: its state's — or, a follower still on its way to its leader, "On the way". */
const stateOf = c => (c.arcade?.playing ? [c.arcade.icon || '🕹️', 'Playing'] : c.coming && c.kind === 'follow' ? ['🚶', 'On the way'] : c.state === 'riding' && c.boat ? (c.boat === 'fishing' ? ['🎣', 'Fishing'] : ['🚤', 'On your boat']) : STATE[c.state] || STATE.going);   // (a boat: server/play/fishing-crew.js; a game: server/play/arcade-crew.js)
const KINDS = ['café', 'park', 'gym', 'bar', 'club', 'arcade', 'restaurant', 'shop', 'home', 'work'];
const FOLD = 'mvw.party.folded';
let app = null;
const C = { list: [], max: 3, following: 0, enabled: true, open: false, menu: null, busy: false, spot: null, folded: false, sheet: false };
const PHONE = matchMedia('(pointer: coarse)');
const E = {};

export function init(a) {
  app = a;
  app.companions = { refresh, command, list: () => C.list.slice(), sendHere };
  try { C.folded = localStorage.getItem(FOLD) === '1'; } catch { /* private mode */ }
  // one card: its head, the companions' rows, and a place for the voice row (ui/companion-voice.js moves into it)
  E.bar = h(`<div id="party" class="party panel hidden" role="region" aria-label="Companions">
    <div class="party-top"></div><div class="party-faces"></div><div class="party-voice"></div></div>`);
  E.top = E.bar.querySelector('.party-top'); E.faces = E.bar.querySelector('.party-faces'); E.voice = E.bar.querySelector('.party-voice');
  // (with the page's other controls, under its windows — the Agent Studio, Settings, a chat full screen — not over them)
  (document.getElementById('ui') || document.body).appendChild(E.bar);
  E.bar.addEventListener('click', onBar);
  // a phone: the card is a sheet, brought up by this button among the round buttons (layout())
  E.fab = h(`<button type="button" class="btn party-fab" aria-label="Companions" aria-haspopup="dialog" aria-expanded="false" title="Companions"><span class="pfab-ic" aria-hidden="true">👥</span><span class="pfab-n" aria-hidden="true"></span></button>`);
  E.fab.addEventListener('click', e => { e.preventDefault(); setSheet(!C.sheet); });
  // …with the small mic on its side: a shortcut to talk to them without opening the card (ui/companion-voice.js)
  E.fabWrap = h('<div class="party-fabwrap hidden"></div>');
  E.fabWrap.append(E.fab, miniMic());
  PHONE.addEventListener?.('change', () => { setSheet(false); layout(); });
  bus.on('msg:companions', m => apply(m));
  bus.on('msg:companion_note', m => toast(m.text, m.ok ? 'good' : 'bad', 4200, '🧭'));
  bus.on('auth', () => { C.list = []; refresh(); });
  bus.on('agentlist', () => paint());
  bus.on('mode', () => { closeMenu(); setSheet(false); paint(); requestAnimationFrame(layout); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && (C.menu || C.open || C.sheet)) { closeMenu(); closePanel(); setSheet(false); } });
  document.addEventListener('pointerdown', e => {
    if (C.menu && !e.target.closest('.party-menu') && !e.target.closest('[data-cm]') && !e.target.closest('.cp-card') && !e.target.closest('.party-pop')) closeMenu();
    if (C.open && !e.target.closest('.party-pop') && !e.target.closest('#party') && !e.target.closest('.party-menu') && !e.target.closest('.worldmap, .wm, #worldmap')) closePanel();
    if (C.sheet && !e.target.closest('#party, .party-fabwrap, .party-pop, .party-menu, .cv-menu, .worldmap, .wm, #worldmap')) setSheet(false);
  }, true);
  addEventListener('resize', () => { placePop(); placeMenu(); layout(); });
  setTimeout(layout, 1500);   // (the maps and the round buttons are built by other modules)
  if (window.ResizeObserver) new ResizeObserver(() => placePop()).observe(E.bar);
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
const withMeCount = () => C.list.filter(c => c.kind === 'follow' && c.leader?.kind === 'player').length;
const av = (a, cls = '') => `<span class="cp-av${cls ? ` ${cls}` : ''}" data-avatar>${esc(a?.emoji || '🤖')}</span>`;
/** What a companion is doing, in a few words (the server's words where it has them). */
function subOf(c) {
  const [, word] = stateOf(c);
  // (sitting with you: on what, or at your meal; using something beside you — the server's words)
  return (c.seat || c.using || c.arcade?.playing) && c.doing ? c.doing
    : c.coming && c.kind === 'follow' ? `On the way to ${c.leader?.kind === 'agent' ? c.leader.name : 'you'}`
    : c.via === 'agent' && c.with?.length ? `${c.kind === 'follow' ? 'Going' : 'Out'} with ${c.with.join(', ')}${c.place && c.kind !== 'follow' ? ` · ${c.place}` : ''}`
    : c.state === 'following' && c.leader?.kind === 'agent' ? `With ${c.leader.name}`
    : c.state === 'waiting' && c.kind === 'follow' ? (c.leader?.away ? 'Waiting for you to come back' : 'Waiting by your character')
    : c.place && c.state !== 'following' && c.state !== 'riding' ? `${word} · ${c.place}` : word;
}

// ------------------------------------------------------------------------------------------------ the card
function paint() {
  const own = mine();
  const head = auth.account && C.enabled && own.length > 0;
  E.bar.classList.toggle('hidden', !head);
  E.fabWrap.classList.toggle('hidden', !head);
  E.fab.querySelector('.pfab-n').textContent = head && C.list.length ? String(C.list.length) : '';
  E.fab.setAttribute('aria-label', `Companions${head ? `: ${withMeCount()} of ${C.max} with you` : ''}`);
  if (!head) setSheet(false);
  layout();
  if (!head) { E.top.innerHTML = ''; E.faces.innerHTML = ''; E.html = ''; closePanel(); return; }
  const n = withMeCount(), folded = C.folded && C.list.length > 0;
  E.bar.classList.toggle('folded', folded);
  E.bar.classList.toggle('empty', !C.list.length);
  const stack = folded ? `<span class="party-stack" aria-hidden="true">${C.list.slice(0, 4).map(c => av(recOf(c.agent) || c, `st-${esc(c.state)}`)).join('')}</span>` : '';
  const top = `<button type="button" class="party-head${C.open ? ' on' : ''}" data-a="panel" aria-expanded="${C.open}" aria-haspopup="dialog" title="Companions: take your agents along, send them places, set meet-ups">
      <span class="party-ic" aria-hidden="true">👥</span><b>Companions</b>${stack}<small class="party-count" title="${n} of ${C.max} with you">${n}/${C.max}</small></button>
    <button type="button" class="party-tool" data-a="panel" aria-label="Take an agent along" title="Take one along, meet up, send them somewhere">＋</button>
    ${C.list.length ? `<button type="button" class="party-tool party-fold" data-a="fold" aria-label="${folded ? 'Show' : 'Hide'} your companions" aria-expanded="${!folded}" title="${folded ? 'Show' : 'Fold away'} the list">${folded ? '▾' : '▴'}</button>` : ''}`;
  const faces = folded ? '' : C.list.map(c => {
    const [ic, word] = stateOf(c), rec = recOf(c.agent), sub = subOf(c);
    // (out with you while it should be at work: its shift, in a word — server/workplace/presence.js)
    const wk = c.work && c.work.state !== 'on_duty' ? c.work : null;
    return `<button type="button" class="party-face st-${esc(c.state)}${c.via === 'agent' ? ' own-choice' : ''}${wk ? ' on-shift' : ''}${C.menu?.id === c.agent ? ' on' : ''}" data-cm="${c.agent}" aria-haspopup="menu" title="${esc(`${c.name}: ${c.doing || word}${c.via === 'agent' ? ' (its own choice)' : ''}${wk ? `\nIts shift as ${c.work.role} at ${c.work.place}: ${c.work.text}` : ''}`)}">
      <span class="pf-who">${av(rec || c)}<span class="pf-ic" aria-hidden="true">${ic}</span></span>
      <span class="pf-t"><b>${esc(c.name)}</b><small>${esc(sub)}</small>${wk ? `<small class="pf-work">⏰ ${esc(wk.state === 'late' ? 'Late for work' : 'Missing work')}</small>` : ''}</span>
      <span class="pf-more" aria-hidden="true">⋯</span></button>`;
  }).join('');
  const html = top + faces;
  if (html !== E.html) {   // (nothing changed: the rows stay as they are — a click on one isn't lost)
    E.html = html; E.top.innerHTML = top; E.faces.innerHTML = faces;
  }
  if (C.open) paintPanel(own);
}
/** Where the card goes. A phone: a sheet (hidden until its button brings it up), the button with Play's round buttons
 *  or under the chat button in the city. A computer: on the map (the city's minimap, or the radar while playing), as
 *  wide as it, one panel with it — or where it was when no map is shown. */
function layout() {
  const phone = PHONE.matches;
  E.bar.classList.toggle('as-sheet', phone);
  if (phone) {
    const host = playing() ? document.getElementById('pbtns') : document.querySelector('#floatbtns .fb-chat');
    if (host && E.fabWrap.parentElement !== host) host.prepend(E.fabWrap);   // (first: its small mic sits on its top edge, with nothing over it)
  } else if (E.fabWrap.isConnected) { E.fabWrap.remove(); setSheet(false); }
  const map = phone ? null : document.getElementById(playing() ? 'radar' : 'minimap');
  const on = !!map && !E.bar.classList.contains('hidden') && getComputedStyle(map).display !== 'none' && map.offsetHeight > 0;
  E.bar.classList.toggle('on-map', on);
  document.body.classList.toggle('party-on-map', on);
  if (on) { E.bar.style.setProperty('--map-h', `${map.offsetHeight}px`); E.bar.style.setProperty('--map-w', `${map.offsetWidth}px`); }
  // (the map changes size — the city's or the island's picture, shown or put away: the card follows)
  if (window.ResizeObserver) for (const id of ['minimap', 'radar']) {
    const el = document.getElementById(id);
    if (el && !el.dataset.partyWatch) { el.dataset.partyWatch = '1'; (E.mapRo ||= new ResizeObserver(() => layout())).observe(el); }
  }
}
/** A phone's sheet: up or away. */
function setSheet(on) {
  on = !!on && PHONE.matches && !E.bar.classList.contains('hidden');
  if (C.sheet === on) return;
  C.sheet = on;
  E.bar.classList.toggle('open', on);
  E.fab.classList.toggle('on', on);
  E.fab.setAttribute('aria-expanded', String(on));
  if (!on) { closeMenu(); closePanel(); }
}
async function onBar(e) {
  const face = e.target.closest('[data-cm]');
  if (face) { openMenu(+face.dataset.cm, face, 'comp'); return; }
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a;
  if (a === 'panel') { if (C.open) closePanel(); else openPanel(); return; }
  if (a === 'fold') { C.folded = !C.folded; try { localStorage.setItem(FOLD, C.folded ? '1' : '0'); } catch { /* private mode */ } closeMenu(); paint(); }
}

// ------------------------------------------------------------------------------------------------ the Companions window
function openPanel() {
  closeMenu();
  C.open = true;
  if (!E.pop) {
    E.pop = h('<div class="party-pop party-panel panel" role="dialog" aria-label="Companions"></div>');
    (document.getElementById('ui') || document.body).appendChild(E.pop);
    E.pop.addEventListener('click', onPanel);
  }
  E.popHtml = '';
  paint();
}
function closePanel() {
  if (!C.open && !E.pop) return;
  C.open = false; C.spot = null;
  E.pop?.remove(); E.pop = null; E.popHtml = '';
  E.top.querySelector('.party-head')?.classList.remove('on');
  E.top.querySelector('.party-head')?.setAttribute('aria-expanded', 'false');
}
function paintPanel(own) {
  if (!E.pop) return;
  const active = new Set(C.list.map(c => c.agent));
  const rest = own.filter(a => !active.has(a.id));
  const n = withMeCount(), full = n >= C.max;
  const html = `<div class="pp-h"><span class="party-ic" aria-hidden="true">👥</span><div><b>Companions</b><small>${n} of ${C.max} with you${C.list.length > n ? ` · ${C.list.length - n} out on an order` : ''}</small></div><button type="button" class="pp-x" data-a="close" aria-label="Close">✕</button></div>
    <div class="pp-sec"><div class="pp-sh">Take along</div>
      ${rest.length ? rest.map(a => `<div class="party-row">${av(a)}<b>${esc(a.name)}</b>
        <button type="button" class="btn small" data-a="follow" data-id="${a.id}"${full ? ' disabled title="As many as may follow you already"' : ''}>🧭 ${playing() ? 'Follow me' : 'Come to me'}</button>
        <button type="button" class="btn small icon pp-more" data-a="menu" data-id="${a.id}" aria-label="More orders for ${esc(a.name)}" title="Wait, send somewhere, go with another agent">⋯</button></div>`).join('')
        : '<div class="pp-empty">All your agents are out with you or on an order.</div>'}
      <div class="pp-tip">${playing() ? 'Or just say it in their chat: “follow me”, “wait here”, “let’s go to the café”.' : 'In sim mode, “come to me” brings them to your parked character.'}</div></div>
    ${own.length > 1 || C.spot ? `<div class="pp-sec"><div class="pp-sh">${own.length > 1 ? 'Meet up' : 'Send'}</div>
      <div class="party-pick">${own.map(a => `<label class="pp-chip"><input type="checkbox" data-mu="${a.id}"><span>${av(a)}${esc(a.name)}</span></label>`).join('')}</div>
      ${C.spot ? `<div class="party-spot"><span>📍</span><b>${esc(C.spot.name)}</b><button type="button" class="btn small icon" data-a="unspot" aria-label="Name a place instead" title="Name a place instead">✕</button></div>` : placeField('mu')}
      <button type="button" class="btn primary pp-go" data-a="meetup">${own.length > 1 ? 'Meet up there' : 'Send there'}</button></div>` : ''}
    ${C.list.length ? '<div class="pp-sec pp-foot"><button type="button" class="btn small pp-letgo" data-a="all">✋ Let everyone go</button></div>' : ''}`;
  if (html !== E.popHtml) {
    // what is being typed or ticked survives a new list
    const kept = [...E.pop.querySelectorAll('input')].map(x => [x.dataset.place ? `p${x.dataset.place}` : x.dataset.mu ? `m${x.dataset.mu}` : x.dataset.here ? `h${x.dataset.here}` : '', x.type === 'checkbox' ? x.checked : x.value]).filter(k => k[0]);
    const focus = document.activeElement?.closest?.('.party-pop') ? document.activeElement.dataset.place : null;
    E.popHtml = html; E.pop.innerHTML = html;
    for (const [k, v] of kept) {
      const x = E.pop.querySelector(k[0] === 'p' ? `[data-place="${k.slice(1)}"]` : k[0] === 'm' ? `[data-mu="${k.slice(1)}"]` : `[data-here="${k.slice(1)}"]`);
      if (x) { if (x.type === 'checkbox') x.checked = v; else x.value = v; }
    }
    if (focus) E.pop.querySelector(`[data-place="${focus}"]`)?.focus();
  }
  E.top.querySelector('.party-head')?.classList.add('on');
  E.top.querySelector('.party-head')?.setAttribute('aria-expanded', 'true');
  placePop();
}
/** Beside the card (to its right, its foot level with the card's); on a narrow screen, under it or over it. */
function placePop() {
  const p = E.pop; if (!p || !C.open) return;
  const r = E.bar.getBoundingClientRect(), w = p.offsetWidth || 320, hh = p.offsetHeight || 300, M = 8;
  if (innerWidth - r.right - M * 2 >= w) {
    p.style.left = `${Math.round(r.right + M)}px`;
    p.style.top = `${Math.round(Math.max(M + 56, Math.min(r.bottom - hh, innerHeight - hh - M)))}px`;
  } else {
    p.style.left = `${Math.round(Math.max(M, Math.min(r.left, innerWidth - w - M)))}px`;
    p.style.top = `${Math.round(r.top > innerHeight / 2 ? Math.max(M, r.top - hh - M) : Math.min(innerHeight - hh - M, r.bottom + M))}px`;
  }
}
async function onPanel(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, id = +b.dataset.id;
  if (a === 'close') { closePanel(); return; }
  if (a === 'unspot') { C.spot = null; paint(); return; }
  if (a === 'follow') { await command({ agent: id, action: 'follow', target: 'me' }); return; }
  if (a === 'menu') { openMenu(id, b, 'agent'); return; }
  if (a === 'all') { try { const r = await post('/api/companions/dismiss-all', {}); toast(`${r.dismissed.length} went back to their day`, 'good', 3200, '✋'); await refresh(); } catch (err) { toast(err.message, 'bad'); } return; }
  if (a === 'meetup') {
    const ids = [...E.pop.querySelectorAll('[data-mu]:checked')].map(x => +x.dataset.mu);
    if (!ids.length) { toast('Tick who meets up', 'bad'); return; }
    const where = C.spot ? { spot: { x: C.spot.x, z: C.spot.z, ctx: -1 } } : placeOf(E.pop, 'mu');
    if (!where) { toast('Name the place to meet', 'bad'); return; }
    try { const r = await post('/api/companions', { action: 'meetup', agents: ids, ...where }); toast(r.text, 'good', 4200, '👥'); C.spot = null; await refresh(); } catch (err) { toast(err.message, 'bad', 5000); }
  }
}
/** A place to name: a text field with the city's places to pick from, and the floor being looked at (sim mode). */
function placeField(id) {
  const names = new Set(KINDS);
  for (const B of S.world?.buildings || []) if (B && !B.gone && B.name) names.add(B.name);
  const here = S.focus?.b >= 0 ? S.world?.buildings[S.focus.b] : null;
  return `<div class="party-place"><input class="input" list="cp-places-${id}" data-place="${id}" placeholder="A café, a park, a building’s name…" maxlength="80" aria-label="Where">
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

/** The world map's "Send my agents here" (ui/worldmap.js): the window opens with that spot as the place to meet. */
function sendHere(spot) {
  if (!auth.account) { toast('Sign in to send your agents somewhere', 'bad'); return; }
  if (!mine().length) { toast('You have no agent in the city yet', 'bad'); return; }
  C.spot = { x: spot.x, z: spot.z, name: spot.name || 'The spot on the map' };
  openPanel();
  const first = E.pop?.querySelector('[data-mu]');
  if (first && mine().length === 1) first.checked = true;
}

// ------------------------------------------------------------------------------------------------ one agent's menu
function openMenu(id, anchor, kind) {
  if (C.menu?.id === id && C.menu.kind === kind) { closeMenu(); return; }
  closeMenu();
  C.menu = { id, kind, anchor, view: 'main' };
  E.menu = h('<div class="party-menu panel" role="menu"></div>');
  (document.getElementById('ui') || document.body).appendChild(E.menu);
  E.menu.addEventListener('click', onMenu);
  anchor?.classList?.add('on');
  paintMenu();
}
function closeMenu() { C.menu?.anchor?.classList?.remove('on'); E.menu?.remove(); E.menu = null; C.menu = null; }
function paintMenu() {
  const m = C.menu; if (!m || !E.menu) return;
  const rec = recOf(m.id), c = compOf(m.id);
  if (!rec) { closeMenu(); return; }
  const withMe = c?.kind === 'follow' && c.leader?.kind === 'player';
  const others = mine().filter(a => a.id !== m.id);
  const item = (k, icon, label, extra = '') => `<button type="button" class="pp-item${extra}" role="menuitem" data-m="${k}"><span class="pp-ii" aria-hidden="true">${icon}</span><span>${label}</span></button>`;
  let body;
  if (m.view === 'send') body = `<div class="pp-body"><button type="button" class="pp-back" data-m="back">‹ Back</button><div class="pp-sh">Send ${esc(rec.name)} to…</div>${placeField('send')}
      <label class="party-here"><input type="checkbox" data-stay="1"> and wait there for me</label>
      <button type="button" class="btn primary pp-go" data-m="send-go">Go</button></div>`;
  else if (m.view === 'with') body = `<div class="pp-body"><button type="button" class="pp-back" data-m="back">‹ Back</button><div class="pp-sh">${esc(rec.name)} goes with…</div>
      ${others.length ? others.map(a => `<button type="button" class="pp-item" role="menuitem" data-m="with-go" data-id="${a.id}">${av(a, 'sm')}<span>${esc(a.name)}</span></button>`).join('') : '<div class="pp-empty">No other agent of yours is in the city.</div>'}</div>`;
  else body = `<div class="pp-group">${withMe ? '' : item('follow', '🧭', playing() ? 'Follow me' : 'Come to my character')}
      ${withMe && c.state === 'riding' ? '' : item('stay', '⏸', `Wait ${c ? 'there' : 'where it is'}`)}
      ${item('send', '📍', 'Send to…', ' sub')}
      ${others.length ? item('with', '🤝', 'Go with…', ' sub') : ''}</div>
      <div class="pp-group">${item('trade', '🎁', 'Trade or give…')}${rec.i >= 0 ? item('look', '🎥', 'Show me') : ''}</div>
      ${c ? `<div class="pp-group">${item('dismiss', '✋', 'Let go — back to its day', ' danger')}</div>` : ''}`;
  const [ic, word] = c ? stateOf(c) : ['', ''];
  E.menu.innerHTML = `<div class="pp-h">${av(rec)}<div><b>${esc(rec.name)}</b><small>${c ? `${ic} ${esc(c.doing || word)}` : 'Living its own day'}</small></div><button type="button" class="pp-x" data-m="close" aria-label="Close">✕</button></div>${body}`;
  placeMenu();
}
function placeMenu() {
  const m = C.menu; if (!m || !E.menu) return;
  const r = m.anchor?.isConnected ? m.anchor.getBoundingClientRect() : { left: 80, right: 80, top: 160, bottom: 160 };
  const w = E.menu.offsetWidth || 260, hgt = E.menu.offsetHeight || 220;
  let x = r.right + 8, y = r.top;
  if (C.sheet) {   // a phone's sheet: the menu stands on it, its left edge with the sheet's (over it when there is no room)
    const sr = E.bar.getBoundingClientRect();
    E.menu.style.left = `${Math.round(Math.max(8, Math.min(sr.left, innerWidth - w - 8)))}px`;
    E.menu.style.top = `${Math.round(Math.max(8, sr.top - hgt - 8))}px`;
    return;
  }
  if (x + w > innerWidth - 8) x = Math.max(8, r.left - w - 8);
  if (x < 8 || (x + w > innerWidth - 8)) x = Math.max(8, innerWidth - w - 8);
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
  const row = h(`<div class="cp-card"><div class="cp-st"><span class="cp-lbl">Companion</span>${c ? `<span class="cp-state">${ic} ${esc(word)}${c.place && !withMe ? ` · ${esc(c.place)}` : ''}</span>` : '<span class="cp-state dim">Living its own day</span>'}</div>
    <div class="cp-btns">${withMe ? '' : `<button type="button" class="btn small" data-c="follow">🧭 ${playing() ? 'Follow me' : 'Come to me'}</button>`}
    <button type="button" class="btn small" data-c="stay">⏸ Wait</button><button type="button" class="btn small" data-c="trade" title="Give them something, or trade">🎁 Trade</button><button type="button" class="btn small" data-c="more" title="Send somewhere, go with another agent">⋯ More</button>
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
