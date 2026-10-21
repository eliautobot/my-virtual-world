// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Getting started (2026-10-09: "new users don't know how to use the interface and how to get things done … a guided UI
// on where things are … a random hint on the load screen"): the in-world guide.
// - The welcome tour: a few steps, each pointing at the real control (the Info panel, the data map, Edit world, chats,
//   help), at a signed-in account's first visit. Once per ACCOUNT, not per browser: it starts only when the server says
//   this account has not been through it (GET /api/guide), never on an unknown (no account, a refused or failed read),
//   and Done or Skip is kept with the account (display.guide) - so it follows the account to every device and a second
//   account on the same browser gets its own. ❓ → Replay the tour shows it again any time.
// - Getting started: the first things to do - get land, build on it, make an agent, talk to it, set a home view - ticked
//   off by what the account really holds (server/guide.js), each with how to do it and a Show me button that opens the
//   right panel and points at the control. 🎯 n/5 in the top bar until they are done (or hidden).
// - ❓ Help: Getting started, How do I… (searchable short answers, with Show me) and the Controls. The loading screen's
//   tips are in js/loading.js.
import { bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { getJSON } from '../core/net.js';

let app = null, G = null, startedFor = null, poll = 0, tour = null, spotEl = null, spotTimer = 0, spotFollow = 0, ready = false;
const E = {};
const phone = () => window.matchMedia('(max-width: 760px)').matches;
const touch = () => window.matchMedia('(pointer: coarse)').matches;
/** Land is bought and sold for Virtual Coin while the world's economy is on (ui/economy.js). */
const landMarket = () => !!app?.econ?.status?.()?.enabled;
const $ = s => document.querySelector(s);
/** An element that is on screen (a hidden or zero-size one is not). */
const shown = el => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? el : null; };

// ------------------------------------------------------------------ Show me: open the panel, point at the control
const SHOW = {
  datamap: () => { app.property?.show(true); return spot('#propbar', 'The data map: tap a lot marked For sale (or one of yours) to open its card'); },
  land: () => { app.property?.show(true); return spot('#propbar', 'Tap a lot marked For sale, then buy it from its card'); },
  build: () => { app.docks?.show('l:buildings'); return spot('#dockL [data-sec="buildings"]', 'Pick a building here, then place it on your lot - or tap your lot on the data map and choose Build here'); },
  furnish: () => { app.docks?.show('l:buildings'); return spot('#dockL [data-sec="buildings"] .dtab[data-tab="furnish"]', 'Furniture: look inside your building first (double-click it)'); },
  agent: () => { app.docks?.show('l:agents'); return spot('#dockL .newagent', 'Make your own AI agent here'); },
  talk: () => spot('#floatbtns .fb-chat .chat', 'Your chats with your agents'),
  team: () => { app.docks?.show('r:team'); return spot('#dockR [data-sec="team"]', 'Your agents: click one to select it, then Chat or Customize'); },
  home: () => { app.docks?.show('r:home'); return spot('#dockR .home .set', 'Move the camera where you like, then press this'); },
  property: () => { app.docks?.show('r:property'); return spot('#dockR [data-sec="property"]', 'Your land and what stands on it'); },
  activity: () => { app.docks?.show('r:activity'); return spot('#dockR [data-sec="activity"]', 'Who changed what, arrivals, agents at work'); },
  play: () => spot('#floatbtns .player', 'Play as yourself: walk, talk, sit and drive'),
  search: () => spot('#topbar .searchb', 'Search people and places (or press /)', '#search input'),
  settings: () => spot('#topbar .setb', 'Settings: theme, name tags, sound, quality'),
  account: () => spot('#acct', 'Your account: settings, sign out'),
  map: () => spot('#floatbtns .wmapbtn, #floatbtns [aria-label="Map"]', 'The map (M): search, legend, GPS'),
};
function showMe(k) {
  closeHelp();
  const f = SHOW[k];
  if (f && !f()) app.toast?.('That control isn\'t on screen right now', 'bad');
}
/** Points at a control: a pulsing ring with a note, gone at the next tap or after a few seconds. The ring follows the
 *  control while it moves (a dock sliding in, a list scrolling it into view). */
function spot(sel, note, alt = null) {
  clearSpot();
  const find = () => [sel, alt].filter(Boolean).map(s => shown($(s))).find(Boolean) || null;
  if (!find()) {   // a panel that is opening may not show it yet: one more look once it has
    setTimeout(() => { if (!find()) app.toast?.(note); else spot(sel, note, alt); }, 380);
    return true;
  }
  find().scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  spotEl = document.getElementById('ui').appendChild(h('<div class="gd-spot" aria-hidden="true"><div class="gd-ring"></div><div class="gd-note"></div></div>'));
  const ring = spotEl.firstChild, n = spotEl.lastChild, pad = 6;
  n.textContent = note;
  let last = '';
  const follow = () => {
    const el = find();
    if (!el || !spotEl) return;
    const r = el.getBoundingClientRect(), k = `${r.left|0},${r.top|0},${r.width|0},${r.height|0}`;
    if (k === last) return;
    last = k;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    place(n, r);
  };
  follow();
  spotFollow = setInterval(follow, 90);
  const end = () => clearSpot();
  setTimeout(() => document.addEventListener('pointerdown', end, { once: true, capture: true }), 50);
  spotTimer = setTimeout(end, 9000);
  return true;
}
function clearSpot() { clearTimeout(spotTimer); clearInterval(spotFollow); if (spotEl) { spotEl.remove(); spotEl = null; } }
/** Places a note or card beside a target rectangle, inside the window: below, else above, else beside. */
function place(n, r) {
  const W = innerWidth, H = innerHeight, m = 10, b = n.getBoundingClientRect(), w = b.width, hh = b.height;
  let x = r.left + r.width / 2 - w / 2, y = r.bottom + 12;
  if (y + hh > H - m) y = r.top - hh - 12;
  if (y < m) { y = Math.min(H - hh - m, Math.max(m, r.top + r.height / 2 - hh / 2)); x = r.left - w - 14 > m ? r.left - w - 14 : r.right + 14; }
  n.style.left = `${Math.round(Math.max(m, Math.min(W - w - m, x)))}px`;
  n.style.top = `${Math.round(Math.max(m, Math.min(H - hh - m, y)))}px`;
}

// ------------------------------------------------------------------ the first things to do
const TASKS = {
  land: { icon: '🏡', title: 'Get a piece of land', how: () => `Open the data map (the layers button at the bottom right, or press <kbd>O</kbd>). Tap a lot marked <b>For sale</b> to open its card, then buy it with Virtual Coin.`, show: 'land' },
  build: { icon: '🏗️', title: 'Build on it', how: () => 'Tap your lot (on the data map, or Info → Property) and choose <b>🏗️ Build here</b>. Or open 🛠️ Edit world → Buildings and place one on your lot. The first floors come with it.', show: 'build' },
  agent: { icon: '🤖', title: 'Create your AI agent', how: () => '🛠️ Edit world → Agents → <b>➕ New agent</b>. It moves into the city and its Studio opens: its name, look, brain and job.', show: 'agent' },
  talk: { icon: '💬', title: 'Talk with your agent', how: () => 'Open 💬 at the bottom right, or select your agent and press <b>🤖 Chat</b>. It answers, remembers and can work for you.', show: 'talk' },
  home: { icon: '🏠', title: 'Set your home view', how: () => 'Move the camera to the view you like, then Info → Home view → <b>📌 Set home to current view</b>. You start there on every device, and ⌂ brings you back.', show: 'home' },
};

// ------------------------------------------------------------------ How do I…
const HOWTO = [
  { q: 'Move around the city', a: () => (touch() ? 'One finger pans, pinch zooms, two fingers twist to turn and tilt. Tap to select; double-tap a building to look inside.' : 'Drag to move, right-drag (or Ctrl + drag) to turn and tilt, the wheel zooms. Click to select; double-click a building to look inside. The Controls tab has every key.') },
  { q: 'Buy land', a: () => TASKS.land.how(), show: 'land', ok: () => auth.can('property.hold') && landMarket() },
  { q: 'Build on my land', a: () => TASKS.build.how(), show: 'build', ok: () => auth.can('property.hold') },
  { q: 'Make my building taller', a: () => 'Select your building and raise its floors in 🛠️ Edit world → Buildings.', show: 'build', ok: () => auth.can('property.hold') },
  { q: 'Furnish inside a building', a: () => 'Double-click your building to look inside, then 🛠️ Edit world → Buildings → <b>🪑 Furniture</b>: pick a piece and place it; <kbd>R</kbd> rotates, drag moves, <kbd>Del</kbd> removes.', show: 'furnish', ok: () => auth.can('property.hold') },
  { q: 'Create an AI agent', a: () => TASKS.agent.how(), show: 'agent', ok: () => auth.can('agents.manage') },
  { q: 'Talk with my agent', a: () => TASKS.talk.how(), show: 'talk' },
  { q: 'Change my agent\'s look, brain or job', a: () => 'Select your agent (Info → Team) and press <b>🎨 Customize</b>: its Studio has tabs for its look, its brain and voice, its work (your business, notes and files it should know) and its life.', show: 'team' },
  { q: 'Let other players talk with my agent', a: () => 'In its Studio, the <b>🛎️ Visitors</b> tab: choose whether visitors may talk with it. Agents anyone may talk with show in Info → Team → Public.', show: 'team' },
  { q: 'Set my home view', a: () => TASKS.home.how(), show: 'home', ok: () => !!auth.account },
  { q: 'Walk around as myself', a: () => (touch() ? 'Tap 🎮 at the bottom right. The stick walks (all the way: run), a finger on the world looks around, E talks, sits or drives.' : 'Press 🎮 at the bottom right (or <kbd>4</kbd>). <kbd>W A S D</kbd> walk, <kbd>Shift</kbd> runs, <kbd>E</kbd> talks, sits, takes the elevator or drives; <kbd>Esc</kbd> leaves.'), show: 'play' },
  { q: 'Chat with other players', a: () => 'In 🎮 Play, walk up to them and press <kbd>E</kbd> (or <kbd>Enter</kbd>); what they say shows above them. Info → Online players lists who is here.', show: 'play' },
  { q: 'Find a person or place', a: () => 'The search at the top (or <kbd>/</kbd>): type a name; pick a result to fly there.', show: 'search' },
  { q: 'Sell my land', a: () => 'Open your lot\'s card (tap it on the data map) and list it for sale: a buyer pays you its price in Virtual Coin.', show: 'datamap', ok: () => auth.can('property.hold') && landMarket() },
  { q: 'See what is happening', a: () => 'Info → <b>📋 Activity log</b>: who changed what, residents arriving, agents at work. Click a line to go there.', show: 'activity' },
  { q: 'Change the look and settings', a: () => '⚙️ Settings at the top: the theme, how see-through panels are, name tags, sound, graphics quality, and your account.', show: 'settings' },
];

// ------------------------------------------------------------------ the welcome tour
const STEPS = [
  { title: '👋 Welcome to My Virtual World', text: () => 'A living city where you can own land, build, and run AI agents of your own. This quick tour shows where things are - about a minute.' },
  { title: '🧭 Getting around', text: () => (touch() ? 'One finger pans, pinch zooms, two fingers twist and tilt. Tap a person or building to select it; double-tap a building to look inside.' : 'Drag to move the camera, right-drag to turn, the wheel zooms. Click a person or building to select it; double-click a building to look inside.') },
  { title: 'ℹ️ The Info panel', target: () => shown($('#dockR:not(.closed) .dock-body')) || shown($('#dockR .dock-toggle')), text: () => `Your agents (Team), your property, your home view and what is happening in the city.${touch() ? '' : ' Press <kbd>I</kbd> to open or close it.'}` },
  { title: '🗺️ The data map', target: () => shown($('#floatbtns .pmapbtn')), text: () => (auth.can('property.hold') && landMarket() ? 'Find land for sale: open the data map, tap a lot marked For sale and buy it from its card. Your own lots show here too.' : 'Every lot\'s status, owner, value and zoning, on the world itself.') },
  { title: '🛠️ Edit world', target: () => shown($('#dockL .dock-toggle')), need: () => shown($('#dockL')), text: () => `Build on your land, furnish inside, and create your own AI agents.${touch() ? '' : ' Press <kbd>B</kbd> to open it.'}` },
  { title: '💬 Your chats', target: () => shown($('#floatbtns .fb-chat .chat')), text: () => 'Talk with your agents here. To chat with other players, walk up to them in 🎮 Play (the button below).' },
  { title: '🎯 Your first steps', target: () => shown($('#topbar .guideb')) || shown($('#topbar .helpb')), text: () => '❓ Help answers “How do I…?” any time, with a Show me button. Your Getting started checklist is here too: it ticks itself off as you go.', last: true },
];
function startTour() {
  if (tour) return;
  closeHelp(); clearSpot();
  const steps = STEPS.filter(s => !s.need || s.need());
  tour = { steps, i: 0 };
  E.tour = document.getElementById('ui').appendChild(h(`<div class="gd-tour" role="dialog" aria-modal="true" aria-label="Welcome tour">
    <div class="gd-dim"></div><div class="gd-hole hidden"></div>
    <div class="gd-card panel"><div class="gd-step"></div><h4></h4><p></p>
      <div class="gd-btns"><button type="button" class="btn small skip">Skip</button><span class="sp"></span>
        <button type="button" class="btn small back">Back</button><button type="button" class="btn small primary next">Next</button></div></div></div>`));
  E.tour.querySelector('.skip').onclick = () => endTour('skipped');
  E.tour.querySelector('.back').onclick = () => stepTo(tour.i - 1);
  E.tour.querySelector('.next').onclick = () => (tour.i >= tour.steps.length - 1 ? endTour('done') : stepTo(tour.i + 1));
  addEventListener('resize', layoutTour);
  stepTo(0);
}
function stepTo(i) {
  if (!tour) return;
  tour.i = Math.max(0, Math.min(tour.steps.length - 1, i));
  const s = tour.steps[tour.i], c = E.tour.querySelector('.gd-card');
  c.querySelector('.gd-step').textContent = tour.i ? `${tour.i} of ${tour.steps.length - 1}` : '';
  c.querySelector('h4').textContent = s.title;
  c.querySelector('p').innerHTML = s.text();
  c.querySelector('.back').classList.toggle('hidden', tour.i === 0);
  c.querySelector('.next').textContent = tour.i === 0 ? 'Show me around' : s.last ? 'Let\'s go' : 'Next';
  c.querySelector('.skip').textContent = tour.i === 0 ? 'Not now' : 'Skip';
  layoutTour();
  c.querySelector('.next').focus({ preventScroll: true });
}
function layoutTour() {
  if (!tour) return;
  const s = tour.steps[tour.i], el = s.target ? s.target() : null, hole = E.tour.querySelector('.gd-hole'), card = E.tour.querySelector('.gd-card');
  E.tour.classList.toggle('aimed', !!el);
  hole.classList.toggle('hidden', !el);
  card.style.left = ''; card.style.top = '';
  if (!el) { card.classList.add('mid'); return; }
  card.classList.remove('mid');
  const r = el.getBoundingClientRect(), pad = 6;
  Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
  place(card, r);
}
function endTour(how) {
  if (!tour) return;
  tour = null;
  removeEventListener('resize', layoutTour);
  E.tour?.remove(); E.tour = null;
  if (G && auth.account) { G.guide.tour = how; save(); }
  if (how === 'done') openHelp('start');
}

// ------------------------------------------------------------------ the account's guide (server/guide.js)
function save() {
  auth.call('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: G.guide.tour, list: G.guide.list }) } })
    .catch(e => console.warn('[guide] not saved:', e.message));   // the next visit simply asks again
}
async function refresh() {
  const id = auth.account?.id ?? null;
  if (id === null) { G = null; render(); return; }
  let r;
  try { r = await getJSON('/api/guide'); } catch { return; }   // unknown: show nothing new, start nothing
  if (auth.account?.id !== id) return;
  const before = G && G.id === id ? new Set(G.tasks.filter(t => t.done).map(t => t.id)) : null;
  G = { id, guide: r.guide || { tour: null, list: null }, tasks: Array.isArray(r.tasks) ? r.tasks : [] };
  if (before) {
    const now = G.tasks.filter(t => t.done && !before.has(t.id));
    for (const t of now) app.toast?.(`✅ ${TASKS[t.id]?.title || t.id} - ${G.tasks.filter(x => x.done).length} of ${G.tasks.length} done`, 'good');
    if (now.length && G.tasks.every(t => t.done)) setTimeout(() => app.toast?.('🎉 You have the basics. ❓ Help has more any time.', 'good'), 1600);
  }
  render();
  // the tour: only on a positive "not seen yet" for this account, once per page, never over the loading screen, and
  // never over another dialog: it waits until that is closed
  if (ready && G.guide.tour === null && startedFor !== id && !tour) {
    startedFor = id;
    setTimeout(() => tourWhenFree(id), 2600);
  }
}
function tourWhenFree(id, tries = 0) {
  if (auth.account?.id !== id || G?.guide.tour !== null || tour) return;
  if ((document.querySelector('.modal-back') || document.visibilityState === 'hidden') && tries < 900) { setTimeout(() => tourWhenFree(id, tries + 1), 1000); return; }
  startTour();
}
const left = () => (G ? G.tasks.filter(t => !t.done).length : 0);
function render() {
  if (E.pill) {
    const on = !!G && G.tasks.length > 0 && left() > 0 && G.guide.list !== 'hidden';
    E.pill.classList.toggle('hidden', !on);
    if (on) { const n = G.tasks.length - left(); E.pill.innerHTML = `🎯 <b>${n}/${G.tasks.length}</b>`; E.pill.title = `Getting started: ${n} of ${G.tasks.length} done`; }
  }
  if (E.panes) renderStart();
  clearTimeout(poll);
  // while something is left to do, look again now and then (a purchase or a new agent ticks itself off)
  if (G && left() > 0) poll = setTimeout(() => { if (document.visibilityState !== 'hidden') refresh(); else render(); }, 30000);
}

// ------------------------------------------------------------------ ❓ Help
function mountHelp() {
  const help = document.getElementById('help');
  if (!help || help.querySelector('.gd-tabs')) return;
  const h3 = help.querySelector('h3');
  if (h3 && h3.firstChild && h3.firstChild.nodeType === 3) h3.firstChild.textContent = 'Help ';
  const controls = h('<div class="gd-pane" data-pane="keys"></div>');
  for (const el of [...help.children]) if (el !== h3) controls.appendChild(el);
  help.appendChild(h(`<div class="gd-tabs seg" role="tablist">
    <button type="button" class="btn small" role="tab" data-tab="start">🎯 Getting started</button>
    <button type="button" class="btn small" role="tab" data-tab="howto">❓ How do I…</button>
    <button type="button" class="btn small" role="tab" data-tab="keys">🕹️ Controls</button></div>`));
  E.panes = {
    start: help.appendChild(h('<div class="gd-pane" data-pane="start"></div>')),
    howto: help.appendChild(h(`<div class="gd-pane" data-pane="howto"><input class="input gd-q" type="search" placeholder="What do you want to do?" spellcheck="false" autocomplete="off"><div class="gd-list"></div></div>`)),
    keys: help.appendChild(controls),
  };
  help.appendChild(h('<div class="gd-foot"><button type="button" class="btn small replay">▶ Replay the welcome tour</button></div>'));
  help.querySelector('.gd-tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); };
  help.querySelector('.replay').onclick = () => startTour();
  E.panes.howto.querySelector('.gd-q').oninput = renderHowto;
  help.addEventListener('click', e => {
    const s = e.target.closest('[data-show]'); if (s) return showMe(s.dataset.show);
    if (e.target.closest('.gd-hide')) { if (G) { G.guide.list = 'hidden'; save(); render(); } app.toast?.('The checklist is hidden; it stays here in Help.'); }
    if (e.target.closest('.gd-unhide')) { if (G) { G.guide.list = null; save(); render(); } }
    if (e.target.closest('.gd-signin')) { closeHelp(); auth.ui?.signIn?.(); }
  });
  const hb = $('#topbar .helpb');
  if (hb) { hb.title = 'Help (H)'; hb.setAttribute('aria-label', 'Help'); }
  renderHowto();
  selectTab(auth.account ? 'start' : 'howto');
}
function selectTab(k) {
  if (!E.panes) return;
  for (const [n, p] of Object.entries(E.panes)) p.classList.toggle('hidden', n !== k);
  for (const b of document.querySelectorAll('#help .gd-tabs [data-tab]')) { const on = b.dataset.tab === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
  if (k === 'start') { renderStart(); if (auth.account) refresh(); }
}
function renderStart() {
  const p = E.panes?.start;
  if (!p) return;
  if (!auth.account) {
    p.innerHTML = `<p class="hint">Sign in or create an account to get land of your own, build on it and make your own AI agents.</p>
      <div class="row"><button type="button" class="btn primary gd-signin">Sign in</button></div>
      <ol class="gd-tasks">${Object.values(TASKS).map(t => `<li><span class="gd-ic">${t.icon}</span><div><b>${esc(t.title)}</b><p class="hint">${t.how()}</p></div></li>`).join('')}</ol>`;
    return;
  }
  if (!G) { p.innerHTML = '<p class="hint">Loading…</p>'; return; }
  const n = G.tasks.length - left();
  p.innerHTML = `<div class="gd-prog"><b>${n} of ${G.tasks.length} done</b><div class="gd-bar"><i style="width:${G.tasks.length ? Math.round(100 * n / G.tasks.length) : 0}%"></i></div></div>
    <ol class="gd-tasks">${G.tasks.map(t => { const d = TASKS[t.id]; if (!d) return ''; return `<li class="${t.done ? 'done' : ''}">
      <span class="gd-ic">${t.done ? '✅' : d.icon}</span><div><b>${esc(d.title)}</b>${t.done ? '' : `<p class="hint">${d.how()}</p>`}</div>
      ${t.done ? '' : `<button type="button" class="btn small" data-show="${d.show}">Show me</button>`}</li>`; }).join('')}</ol>
    ${left() === 0 ? '<p class="hint">🎉 You have the basics. How do I… has more.</p>' : G.guide.list === 'hidden' ? '<button type="button" class="btn small gd-unhide">Show 🎯 in the top bar again</button>' : '<button type="button" class="btn small gd-hide">Hide 🎯 from the top bar</button>'}`;
}
function renderHowto() {
  const p = E.panes?.howto;
  if (!p) return;
  const q = p.querySelector('.gd-q').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 1);
  const items = HOWTO.filter(x => !x.ok || x.ok()).filter(x => { const t = `${x.q} ${x.a()}`.toLowerCase(); return words.every(w => t.includes(w)); });
  p.querySelector('.gd-list').innerHTML = items.length ? items.map((x, i) => `<details class="gd-how"${q && i === 0 ? ' open' : ''}><summary>${esc(x.q)}</summary>
    <p>${x.a()}</p>${x.show ? `<button type="button" class="btn small" data-show="${x.show}">Show me</button>` : ''}</details>`).join('')
    : '<p class="hint">Nothing matches. Try other words, or look in Controls.</p>';
}
function openHelp(tab) {
  const help = document.getElementById('help');
  if (!help) return;
  mountHelp();
  if (tab) selectTab(tab);
  help.classList.remove('hidden');
}
function closeHelp() { document.getElementById('help')?.classList.add('hidden'); }

export function init(a) {
  app = a;
  mountHelp();
  const hb = $('#topbar .helpb');
  if (hb) {
    E.pill = hb.parentNode.insertBefore(h('<button type="button" class="btn guideb hidden" aria-label="Getting started"></button>'), hb);
    E.pill.onclick = () => { const help = document.getElementById('help'); if (help && !help.classList.contains('hidden') && E.panes?.start && !E.panes.start.classList.contains('hidden')) closeHelp(); else openHelp('start'); };
  }
  bus.on('auth', () => { renderHowto(); refresh(); });
  addEventListener('keydown', e => {
    if (!tour) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour('skipped'); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); E.tour.querySelector('.next').click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); stepTo(tour.i - 1); }
    else e.stopPropagation();   // the world's keys wait while the tour is open
  }, true);
  app.guide = { tour: startTour, help: openHelp, show: showMe, refresh, get state() { return G; } };
  bus.on('ready', () => { ready = true; refresh(); });
  if (app.ready) { ready = true; refresh(); }
}
