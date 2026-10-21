// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Agent Studio (2026-10-07: "the full agent suite … everything regarding that agent in one place, fun to use
// and interactive"). One window per agent for its owner (or an account it is shared with to manage): the agent itself
// on a stage - its own 3D character, turning, whose head, heart, hands and feet open its Brain, Personality, Money and
// Free Will - beside every part of it as a tab of its own colour: Overview, Brain, Voice, Work, Visitors, Phone, Free Will,
// Personality, Plans, Memories, People, Places, Money, Activity and Settings. The tabs live in studio-mind.js, studio-life.js,
// studio-world.js, studio-work.js, studio-visitors.js, studio-phone.js and voice-settings.js; this file holds the window, the stage and the Overview. The server decides who may see and change
// what (every part answers 404 to anyone else); this only asks and shows what it answers.
import { S, bus, select } from '../core/state.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';
import { h, esc, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { isExt, stateOf } from '../core/agent-view.js';
import { sanitizeAppearance, arrToApp } from '/shared/appearance.js';
import { formatClock } from '/shared/constants.js';
import { CharPreview } from '../render/char-preview.js';
import { FlatMarker } from '../render/flat-marker.js';
import { vc, coin } from './economy.js';
import { brainTab, freeWillTab, brainSummary, freeWillSummary } from './studio-mind.js';
import { problemsHtml } from './mind.js';
import { characterTab, plansTab, memoriesTab, peopleTab, activityTab, radarSvg, standout } from './studio-life.js';
import { placeTab, moneyTab, settingsTab, homeOf, floorPlanSvg } from './studio-world.js';
import { lookTab, leaveLook } from './studio-look.js';
import { agentVoiceSection, previewLevel } from './voice-settings.js';
import { workTab, loadWork } from './studio-work.js';
import { visitorsTab, loadTalks, loadBlocks, PUBLIC_WORDS } from './studio-visitors.js';
import { phoneTab, leavePhone } from './studio-phone.js';
import { pcTab, leavePc } from './studio-pc.js';

let app = null, cur = null, marker = null;

/** The tabs: id, label, icon, colour, the part of the body that opens it, and how the agent stands while it is open
 *  (a clip and what it holds: render/char-preview.js). */
export const TABS = [
  { id: 'overview', label: 'Overview', icon: icon('agent'), color: '#38bdf8', pose: ['idle'], run: overviewTab },
  { id: 'brain', label: 'Brain', icon: '🧠', color: '#a78bfa', zone: 'head', pose: ['idle_hold', 'book'], run: brainTab },
  { id: 'voice', label: 'Voice', icon: '🔊', color: '#a3e635', zone: 'throat', pose: ['talk'], run: voiceTab, need: 'chat.use' },
  { id: 'work', label: 'Work', icon: '💼', color: '#818cf8', pose: ['idle', 'briefcase'], run: workTab, need: 'agents.profile' },
  { id: 'visitors', label: 'Visitors', icon: '🛎️', color: '#f59e0b', pose: ['talk'], run: visitorsTab, need: 'agents.profile' },
  { id: 'phone', label: 'Phone', icon: '📱', color: '#34d399', pose: ['phone_look', 'phone'], run: phoneTab, leave: leavePhone, need: 'agents.phone' },
  { id: 'pc', label: 'PC', icon: '💻', color: '#60a5fa', pose: ['idle'], run: pcTab, leave: leavePc, need: 'agents.pc' },
  { id: 'freewill', label: 'Free Will', icon: '⚡', color: '#2dd4bf', zone: 'feet', pose: ['walk'], run: freeWillTab, need: 'agents.freewill', body: true },
  { id: 'character', label: 'Personality', icon: '🙂', color: '#f472b6', zone: 'heart', pose: ['wave'], run: characterTab, need: 'agents.profile' },
  { id: 'look', label: 'Customize', icon: '🎨', color: '#22d3ee', pose: ['idle'], run: lookTab, leave: leaveLook, body: true },
  { id: 'plans', label: 'Plans', icon: '📋', color: '#fb923c', pose: ['phone_look', 'phone'], run: plansTab, need: 'agents.profile' },
  { id: 'memories', label: 'Memories', icon: '📖', color: '#e0a96d', pose: ['idle_hold', 'cup'], run: memoriesTab, need: 'agents.profile' },
  { id: 'people', label: 'People', icon: '👥', color: '#facc15', pose: ['talk'], run: peopleTab, need: 'agents.profile' },
  { id: 'place', label: 'Places', icon: '🏠', color: '#f87171', pose: ['walk'], run: placeTab, body: true },
  { id: 'money', label: 'Money', icon: '👛', color: '#4ade80', zone: 'hands', pose: ['idle', 'bag'], run: moneyTab },
  { id: 'activity', label: 'Activity', icon: '📜', color: '#60a5fa', pose: ['walk_phone', 'phone'], run: activityTab, need: 'agents.profile' },
  { id: 'settings', label: 'Settings', icon: '⚙', color: '#94a3b8', pose: ['idle'], run: settingsTab },
];
/** The parts of the body (heights in metres for a body of height 1; the pin's side: 1 right, -1 left). */
const ZONES = [
  { id: 'head', tab: 'brain', lo: 1.45, hi: 2.1, pin: 1.63, side: 1, r: 0.2, label: 'Brain' },
  { id: 'throat', tab: 'voice', lo: 1.35, hi: 1.45, pin: 1.39, side: 1, r: 0.1, label: 'Voice' },   // (2026-10-08: its voice at its throat, under the Brain)
  { id: 'heart', tab: 'character', lo: 1.05, hi: 1.35, pin: 1.24, side: -1, r: 0.27, label: 'Personality' },
  { id: 'hands', tab: 'money', lo: 0.62, hi: 1.05, pin: 0.86, side: 1, r: 0.36, label: 'Money' },
  { id: 'feet', tab: 'freewill', lo: -0.05, hi: 0.62, pin: 0.12, side: -1, r: 0.24, label: 'Free Will' },
];
const tabOf = id => TABS.find(t => t.id === id);
const NEEDS = [['hunger', '🍔', 'Food'], ['energy', '⚡', 'Energy'], ['social', '💬', 'Social'], ['fun', '🎈', 'Fun'], ['hygiene', '🧼', 'Hygiene']];

export function init(a) {
  app = a;
  app.studio = { open, close, isOpen: () => !!cur };
  marker = app.flatMarker = new FlatMarker(app);
  bus.on('openstudio', (id, tab) => open(id, tab));
  bus.on('agentlist', () => { if (cur) { if (!cur.rec()) close(); else cur.head(); } });
  bus.on('auth', () => { if (cur && !auth.account) close(); });
  // its owner was told about a problem (ui/mind.js): the Overview and the Brain tab show it at once
  bus.on('mind:problems', id => { if (cur && cur.id === id) { cur.drop('problems', 'mind', 'econ'); if (cur.tab === 'overview' || cur.tab === 'brain') cur.repaint(); } });
  app.inspHooks = app.inspHooks || { building: [], resident: [] };
  app.inspHooks.resident.push(studioEntry);
  app.inspHooks.building.push(homesHere);
  app.hooks?.key.unshift(e => {
    if (!cur || cur.peeking) return false;
    if (above(cur.el)) return false;   // a window opened over it (the Customizer, a flat) answers its own keys
    if (e.key === 'Escape') { if (cur.picker) cur.closePicker(); else close(); return true; }
    return true;   // the world's shortcuts wait while the Studio is open
  });
  // its look changed (the Customizer): the stage follows
  bus.on('people', () => { if (cur?.pv && cur.i >= 0) { const a = JSON.stringify(S.people[cur.i]?.a); if (a !== cur.look) { cur.look = a; cur.pv.setLook(sanitizeAppearance(arrToApp(S.people[cur.i].a))); } } });
  window.addEventListener('resize', () => cur?.resize());
}

/** Whether another window was opened over the Studio's (the Customizer, a flat's window: later in the page). */
function above(el) { const all = document.querySelectorAll('.modal-back'); return all.length > 0 && all[all.length - 1] !== el; }
/** The agents this account may open in the Studio: its own, and those shared with it to manage. */
export const studioAgent = (id) => (S.agentList || []).find(a => a.id === id && (a.mine || a.level === 'manage')) || null;

/** On a selected agent's card: the way into its Studio (replaces the long Free Will / Mind / profile sections). */
function studioEntry(body, i) {
  const rec = (S.agentList || []).find(a => a.i === i && (a.mine || a.level === 'manage'));
  if (!rec) return;
  const brain = rec.connection ? (rec.connection.kind === 'models' ? `🧠 ${rec.connection.label}` : `🔌 ${rec.connection.label}`) : isExt(rec) ? '🔌 Third-party agent' : '🧠 No brain yet';
  // beside the name (the selection widget; under it where the card stacks): compact - what it holds is its tooltip
  // (2026-10-08), its brain the line under its name
  const row = h(`<div class="st-entry"><button type="button" class="st-entry-btn" title="${esc(`Brain, personality, home, money, plans - everything about ${rec.name}`)}"><span class="st-entry-ic">${icon('agent')}</span><span><b>Agent Studio</b><small>${esc(brain)}</small></span><span class="st-entry-go">›</span></button></div>`);
  const title = body.querySelector('.title');
  if (title) title.after(row); else body.appendChild(row);
  row.querySelector('.st-entry-btn').onclick = () => open(rec.id);
}

/** On an apartment building's card: which of this account's agents live here, and where (floor and flat). */
function homesHere(body, b) {
  const mine = (S.agentList || []).filter(a => (a.mine || a.level === 'manage') && a.i >= 0 && S.people[a.i]?.hb === b);
  if (!mine.length) return;
  const row = (body.querySelector('.sel-slot') || body).appendChild(h(`<div class="st-homes"><div class="hint">Your agents who live here</div>${mine.map(a => {
    const p = S.people[a.i];
    return `<button type="button" class="st-home-pill" data-id="${a.id}"><span data-avatar>${esc(a.emoji || '🤖')}</span><b>${esc(a.name)}</b><small>floor ${p.hf + 1} · flat ${p.hu + 1}</small></button>`;
  }).join('')}</div>`));
  row.onclick = e => {
    const btn = e.target.closest('[data-id]'); if (!btn) return;
    const a = studioAgent(+btn.dataset.id), p = a && S.people[a.i];
    if (p) showFlat(a, p.hb, p.hf, p.hu);
  };
}
/** Looks inside the agent's floor and marks its flat. */
export function showFlat(rec, b, f, u) {
  app.lookInside?.(b, f);
  marker.show(b, f, u, `🏠 ${rec.name}'s flat · floor ${f + 1}, flat ${u + 1}`);
}

// ------------------------------------------------------------------------------------------------ the window
/** Opens agent id's Studio at tab `want`. swap: another agent from the picker - the window stays, without its entrance. */
export async function open(id, want = 'overview', { swap = false } = {}) {
  const rec0 = studioAgent(id);
  if (!rec0) { app?.toast?.('Only its owner, or someone it is shared with to manage it, can open its Studio.', 'bad'); return; }
  if (cur?.id === id) { if (cur.peeking) cur.unpeek(); cur.go(want); return; }
  close();
  const el = (document.getElementById('ui') || document.body).appendChild(h(`<div class="modal-back studio-back${swap ? ' swap' : ''}"><div class="studio panel" role="dialog" aria-modal="true" aria-label="Agent Studio">
    <header class="st-head"></header>
    <div class="st-main">
      <aside class="st-stage"><div class="st-canvas"><div class="st-pins" aria-hidden="true"></div></div><div class="st-hint">Tap the head, throat, heart, hands or feet</div><div class="st-now"></div></aside>
      <nav class="st-nav" role="tablist" aria-label="Parts of the agent"></nav>
      <section class="st-body" role="tabpanel"><div class="st-content"></div><p class="st-say" role="status" aria-live="polite"></p></section>
    </div></div></div>`));
  const box = el.querySelector('.studio'), content = el.querySelector('.st-content');
  const C = cur = {
    id, el, tab: null, st: {}, cache: new Map(), timers: [], peeking: false, busy: false, token: 0,
    rec: () => studioAgent(id),
    get i() { const r = C.rec(); return r && r.i >= 0 && S.people[r.i] && !S.people[r.i].x ? r.i : -1; },
    get name() { return C.rec()?.name || 'the agent'; },
    get manage() { return C.rec()?.level === 'manage'; },
    get owner() { return !!C.rec()?.mine; },
    app, content,
  };
  // ---- data: each part read once and kept until something changes it (C.drop)
  const LOAD = {
    life: () => getJSON(`/api/agent-life/profile?agent=${id}`),
    fw: () => getJSON(`/api/free-will/agent?agent=${id}`),
    mind: () => getJSON(`/api/mind/agent?agent=${id}`),
    problems: () => getJSON(`/api/mind/problems?agent=${id}`),
    info: () => (C.i >= 0 ? getJSON(`/api/agent/${C.i}`) : Promise.resolve(null)),
    econ: () => (app.econ?.status?.()?.enabled && auth.can('economy.use') ? getJSON('/api/economy/me') : Promise.resolve(null)),
    conns: () => (auth.can('connections.use') ? getJSON('/api/connections') : Promise.resolve({ connections: [] })),
    people: () => getJSON(`/api/agent-life/people?agent=${id}&limit=100`),
    social: () => getJSON(`/api/agent-social?agent=${id}`),
    threads: () => getJSON(`/api/agent-social/threads?agent=${id}`),
    resident: () => (C.i >= 0 && app.econ?.status?.()?.enabled ? getJSON(`/api/economy/resident?i=${C.i}`) : Promise.resolve(null)),
    friends: () => (auth.can('players.friends') ? getJSON('/api/friends') : Promise.resolve({ friends: [] })),
    recent: () => (C.i >= 0 ? getJSON(`/api/people/recent?i=${C.i}`) : Promise.resolve(null)),
    work: () => loadWork(id),
    talks: () => loadTalks(id),
    post: () => getJSON(`/api/agent-posts/spots?agent=${id}`),
    blocks: () => loadBlocks(id),
    // a third-party agent's connection (its slot; Brain → Its connection): only its owner reads it
    slot: () => (isExt(C.rec()) && auth.can('agents.connect') ? getJSON('/api/agent-slots').then(r => r.agents.find(a => `ext-${a.id}` === C.rec()?.key) || null) : Promise.resolve(null)),
    mems: () => getJSON(`/api/agent-life/memories?agent=${id}&term=long&limit=1`).then(r => (r.memories?.length ? r : getJSON(`/api/agent-life/memories?agent=${id}&term=short&limit=1`))),
  };
  /** A part's data: the answer, or { error } (a part this account may not see answers 404 - shown as such, not thrown). */
  C.get = (k, force = false) => {
    if (force) C.cache.delete(k);
    if (!C.cache.has(k)) C.cache.set(k, LOAD[k]().then(r => r ?? null, e => ({ error: e.message || 'Could not read it', status: e.status })));
    return C.cache.get(k);
  };
  C.drop = (...keys) => { for (const k of keys) C.cache.delete(k); };
  C.say = (m, bad) => { const s = el.querySelector('.st-say'); s.textContent = m || ''; s.classList.toggle('bad', !!bad); };
  C.toast = (m, kind = 'good', ms = 2400) => app.toast?.(m, kind, ms);
  /** POST; on failure the message shows under the tab and null comes back. */
  C.call = async (url, body, okMsg) => {
    if (C.busy) return null;
    C.busy = true; C.say('');
    try { const r = await post(url, body); if (okMsg) C.toast(okMsg); return r || {}; }
    catch (e) { if (!e.quiet) C.say(e.message, true); return null; }
    finally { C.busy = false; }
  };
  /** A second tap within 3.5 s confirms (spending, removing). */
  C.armed = (b, text) => {
    if (b.dataset.armed) return true;
    b.dataset.armed = '1'; const was = b.innerHTML; b.textContent = text; b.classList.add('armed');
    setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.innerHTML = was; b.classList.remove('armed'); } }, 3500);
    return false;
  };
  C.go = tab => paintTab(tab);
  C.repaint = () => paintTab(C.tab, true);
  C.pose = (clip, prop) => C.pv?.setClip(clip, prop);
  C.every = (ms, fn) => { const t = setInterval(() => { if (!document.hidden && !C.peeking) fn(); }, ms); C.timers.push(t); return t; };
  /** Hide the Studio to show something in the world, with a pill to come back. */
  C.peek = fn => {
    C.peeking = true; el.classList.add('peek');
    const pill = C.pill = (document.getElementById('ui') || document.body).appendChild(h(`<div class="st-peek panel"><span data-avatar>${esc(C.rec()?.emoji || '🤖')}</span><button type="button" class="btn small primary st-back">↩ Back to ${esc(C.name)}'s Studio</button><button type="button" class="btn small icon st-x" aria-label="Close the Studio">✕</button></div>`));
    pill.querySelector('.st-back').onclick = () => C.unpeek();
    pill.querySelector('.st-x').onclick = () => close();
    C.pv?.stop();
    fn?.();
  };
  C.unpeek = () => { C.peeking = false; el.classList.remove('peek'); C.pill?.remove(); C.pill = null; C.pv?.start(); C.resize(); };
  C.showFlat = (b, f, u) => C.peek(() => showFlat(C.rec(), b, f, u));
  C.follow = () => { const i = C.i; if (i < 0) return; C.peek(() => { app.setMode?.('explore'); select(i, { force: true, follow: true }); }); };
  C.resize = () => { C.pv?.resize(); };

  // ---- the header
  C.head = () => {
    const r = C.rec(); if (!r) return;
    const st = stateOf(r, S.presence[r.key]);
    const chips = C.chips || [];
    el.querySelector('.st-head').innerHTML = `<div class="st-av" data-avatar>${esc(r.emoji || '🤖')}</div>
      <div class="st-id"><small class="st-kicker">Agent Studio</small><button type="button" class="st-pick" data-a="pick" aria-haspopup="listbox" aria-expanded="${!!C.picker}" title="Another agent"><h2>${esc(r.name)}</h2><span class="st-pick-c" aria-hidden="true">▾</span></button><div class="st-role">${esc(r.role || (isExt(r) ? 'Third-party agent' : 'AI agent'))}${st.working ? ' · <b class="st-live">● working now</b>' : ''}</div></div>
      <div class="st-chips">${chips.map(c => `<button type="button" class="st-chip" style="--sc:${c.color}" data-go="${c.tab}">${c.html}</button>`).join('')}</div>
      <div class="st-acts">${C.i >= 0 ? '<button type="button" class="btn small" data-a="follow" title="Show it in the world">🎥 Find</button>' : ''}<button type="button" class="btn small" data-a="chat" title="Chat with it">💬 Chat</button><button type="button" class="btn small icon" data-a="close" title="Close (Esc)" aria-label="Close">✕</button></div>`;
  };
  el.querySelector('.st-head').onclick = e => {
    const g = e.target.closest('[data-go]'); if (g) return C.go(g.dataset.go);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'pick') { if (C.picker) C.closePicker(); else C.openPicker(); }
    if (a === 'follow') C.follow();
    // its chat window over the Studio; closing it brings the Studio back
    if (a === 'chat') { C.peek(); if (app.chat) app.chat.open(id, { onClose: () => { if (cur === C && C.peeking) C.unpeek(); } }); else bus.emit('openagent', id); }
  };
  /** The header's chips (brain, Free Will, money): filled from what the Overview reads. */
  C.setChips = list => { C.chips = list; C.head(); };
  /** The picker on the name: every agent this account may open, to switch to without closing (the same tab stays). */
  C.openPicker = () => {
    const list = (S.agentList || []).filter(a => a.mine || a.level === 'manage');
    const pk = C.picker = el.querySelector('.studio').appendChild(h(`<div class="st-picker panel" role="listbox" aria-label="Agents">
      ${list.length > 7 ? '<input class="input st-pick-q" placeholder="Find an agent" aria-label="Find an agent">' : ''}
      <div class="st-pick-list">${list.map(a => { const w = stateOf(a, S.presence[a.key]); return `<button type="button" class="st-pick-row${a.id === id ? ' on' : ''}" role="option" aria-selected="${a.id === id}" data-id="${a.id}"><span class="st-pick-av" data-avatar>${esc(a.emoji || '🤖')}</span><span class="st-pick-t"><b>${esc(a.name)}</b><small>${esc(a.role || (isExt(a) ? 'Connected agent' : 'AI agent'))}</small></span>${w.working ? '<i class="st-pick-live" title="Working now"></i>' : ''}</button>`; }).join('')}</div></div>`));
    C.head();
    const rows = () => [...pk.querySelectorAll('.st-pick-row:not(.hidden)')];
    pk.onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; const to = +b.dataset.id; C.closePicker(); if (to !== id) open(to, C.tab, { swap: true }); };
    pk.onkeydown = e => {
      const r = rows(), k = r.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); r[(k + (e.key === 'ArrowDown' ? 1 : r.length - 1)) % r.length]?.focus(); }
    };
    const q = pk.querySelector('.st-pick-q');
    if (q) { q.oninput = () => { const t = q.value.trim().toLowerCase(); for (const b of pk.querySelectorAll('.st-pick-row')) b.classList.toggle('hidden', !!t && !b.textContent.toLowerCase().includes(t)); }; q.focus(); }
    else (pk.querySelector('.st-pick-row.on') || pk.querySelector('.st-pick-row'))?.focus();
    setTimeout(() => document.addEventListener('pointerdown', C.pickAway = e => { if (!e.target.closest('.st-picker, .st-pick')) C.closePicker(); }, true));
  };
  C.closePicker = () => { C.picker?.remove(); C.picker = null; document.removeEventListener('pointerdown', C.pickAway, true); C.head(); };

  // ---- the navigation
  const tabsShown = () => TABS.filter(t => (!t.need || auth.can(t.need)) && (!t.body || C.i >= 0));
  const nav = el.querySelector('.st-nav');
  nav.innerHTML = tabsShown().map(t => `<button type="button" class="st-tab" role="tab" data-tab="${t.id}" style="--sc:${t.color}"><span class="st-ti">${t.icon}</span><span class="st-tl">${t.label}</span></button>`).join('');
  nav.onclick = e => { const b = e.target.closest('[data-tab]'); if (b) C.go(b.dataset.tab); };
  nav.onkeydown = e => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const list = [...nav.querySelectorAll('[data-tab]')], k = list.findIndex(b => b.dataset.tab === C.tab);
    const n = list[(k + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    e.preventDefault(); n.focus(); C.go(n.dataset.tab);
  };

  async function paintTab(want, again = false) {
    const t = tabsShown().find(x => x.id === want) || tabsShown()[0];
    const changed = C.tab !== t.id;
    if (changed && C.tab) tabOf(C.tab)?.leave?.(C);   // (the Customize tab puts the saved look back on the stage)
    C.tab = t.id;
    box.style.setProperty('--sc', t.color);
    for (const b of nav.querySelectorAll('[data-tab]')) { const on = b.dataset.tab === t.id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    if (changed) { C.say(''); C.pose(...t.pose); stage.mark(t.zone || null); content.scrollTop = 0; }
    const tok = ++C.token;
    if (!again) content.innerHTML = '<div class="st-loading"><span></span><span></span><span></span></div>';
    try { await t.run(C, content, () => tok === C.token && cur === C); }
    catch (e) { if (tok === C.token) content.innerHTML = `<p class="hint bad">${esc(e.message || String(e))}</p>`; console.error('[studio]', t.id, e); }
  }

  // ---- the stage: the agent's own character, its body's parts opening their tabs
  const stage = makeStage(C, el.querySelector('.st-stage'));
  C.look = C.i >= 0 ? JSON.stringify(S.people[C.i].a) : null;
  C.head();
  el.addEventListener('pointerdown', e => { if (e.target === el) C.downOut = true; });
  el.addEventListener('pointerup', e => { if (e.target === el && C.downOut) close(); C.downOut = false; });
  C.timers.push(setInterval(() => { if (!C.peeking && !document.hidden) stage.now(); }, 3000));
  await paintTab(want);
  stage.now();
}

export function close() {
  if (!cur) return;
  const C = cur; cur = null;
  C.token++;
  if (C.picker) document.removeEventListener('pointerdown', C.pickAway, true);
  for (const t of C.timers) clearInterval(t);
  C.phone?.destroy();   // (its phone stops following its frames)
  C.pv?.detach();   // (kept for the next Studio: makeStage)
  C.pill?.remove();
  C.el.remove();
}

// ------------------------------------------------------------------------------------------------ the stage
let stagePreview = null;
function makeStage(C, root) {
  const p = C.i >= 0 ? S.people[C.i] : null, look = p ? sanitizeAppearance(arrToApp(p.a)) : null;
  const pins = root.querySelector('.st-pins'), nowEl = root.querySelector('.st-now');
  let hot = null, marked = null;
  const hk = look ? clamp(+look.height || 1, 0.8, 1.15) : 1;
  if (look) {
    // (one preview for every Studio opened: its GPU context and the characters it loaded stay ready between opens)
    const pv = C.pv = stagePreview || (stagePreview = new CharPreview({ warmAll: false, fov: 26, eye: [0, 1.0, 5.0], look: [0, 0.92, 0] }));
    pv.mount(root.querySelector('.st-canvas'));
    pv.setLook(look);
    pv.setClip('wave');
    setTimeout(() => { if (C.tab) C.pose(...tabOf(C.tab).pose); }, 2600);
    pv.start();
    pins.innerHTML = ZONES.filter(z => tabOf(z.tab) && (!tabOf(z.tab).need || auth.can(tabOf(z.tab).need))).map(z => {
      const t = tabOf(z.tab);
      return `<button type="button" class="st-pin ${z.side > 0 ? 'r' : 'l'}" data-zone="${z.id}" style="--sc:${t.color}" tabindex="-1" title="${z.label}"><i></i><span>${t.icon}<b> ${z.label}</b></span></button>`;
    }).join('');
    pins.onclick = e => { const b = e.target.closest('[data-zone]'); if (b) C.go(ZONES.find(z => z.id === b.dataset.zone).tab); };
    pins.onpointerover = e => { const b = e.target.closest('[data-zone]'); light(b ? b.dataset.zone : null); };
    pins.onpointerout = () => light(null);
    const zoneAt = e => {
      const r = pv.canvas.getBoundingClientRect(), at = pv.heightAt(e.clientX - r.left, e.clientY - r.top);
      if (!at || at.off > 0.55) return null;
      return ZONES.find(z => at.y >= z.lo * hk && at.y < z.hi * hk && pins.querySelector(`[data-zone="${z.id}"]`)) || null;
    };
    // (handlers, not listeners: the preview is the next Studio's too, and each Studio sets its own)
    pv.canvas.onpointermove = e => { const z = zoneAt(e); light(z ? z.id : null); pv.canvas.style.cursor = z ? 'pointer' : 'grab'; };
    pv.canvas.onpointerleave = () => light(null);
    pv.canvas.onclick = e => { if (pv.dragged) return; const z = zoneAt(e); if (z) C.go(z.tab); };
    const throat = ZONES.find(z => z.id === 'throat');
    let speaking = false;
    pv.onFrame = () => {
      for (const b of pins.children) {
        const z = ZONES.find(x => x.id === b.dataset.zone), s = pv.toScreen(0, z.pin * hk, 0);
        b.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
      }
      // its voice, seen at its throat while it speaks (the Voice tab's ▶ Hear): the pin and a ring there follow how loud
      // it is, frame by frame; when it stops, the stage is as it was
      const lv = previewLevel(), vp = pins.querySelector('[data-zone="throat"]');
      if (lv > 0 && vp) {
        speaking = true;
        const k = Math.min(1, lv * 3.2);
        vp.classList.add('speaking'); vp.style.setProperty('--lv', k.toFixed(3));
        pv.ring(throat.pin * hk, tabOf('voice').color, throat.r + 0.04 + k * 0.14);
      } else if (speaking) {
        speaking = false;
        vp?.classList.remove('speaking'); vp?.style.removeProperty('--lv');
        light(hot);
      }
    };
  } else {
    const r = C.rec();
    root.querySelector('.st-canvas').innerHTML = `<div class="st-noface"><span data-avatar>${esc(r?.emoji || '🤖')}</span><small>${isExt(r) ? 'A connected agent: it lives on its own computer and has no body in the city.' : 'It has no body in the city right now.'}</small></div>`;
    root.querySelector('.st-hint').remove();
  }
  function light(id) {
    hot = id;
    for (const b of pins.children) b.classList.toggle('hot', b.dataset.zone === id || b.dataset.zone === marked);
    const z = ZONES.find(x => x.id === (id || marked));
    C.pv?.ring(z ? ((z.lo + Math.min(z.hi, 1.85)) / 2) * hk : null, z ? tabOf(z.tab).color : '#fff', z ? z.r : 0.3);
  }
  return {
    mark(zone) { marked = zone; light(hot); },
    /** What it is doing right now (the strip under the stage). */
    async now() {
      if (C.i < 0) { nowEl.innerHTML = ''; return; }
      const j = await C.get('info', true);
      if (!j || j.error || !nowEl.isConnected) return;
      const act = j.act || {};
      nowEl.innerHTML = `<div class="st-act"><span class="st-act-ic">${esc(act.icon || '🧍')}</span><div><b>${esc(act.label || 'Taking a moment')}</b><small>${esc(act.place || '')}</small></div></div>
        <div class="st-needs">${NEEDS.map(([k, ic, lb]) => { const v = clamp(+(j.needs?.[k]) || 0, 0, 1); return `<span title="${lb} ${Math.round(v * 100)}%">${ic}<i><b style="width:${Math.round(v * 100)}%;--nv:${v > 0.6 ? 'var(--good)' : v > 0.3 ? 'var(--gold)' : 'var(--bad)'}"></b></i></span>`; }).join('')}</div>`;
    },
  };
}

// ------------------------------------------------------------------------------------------------ Voice
/** Its voice (2026-10-08: a tab of its own, its pin at the throat - not under the Brain): which voice it speaks with
 *  in read aloud and voice mode, the service, its speed, a preview (seen at its throat on the stage while it plays). */
async function voiceTab(C, body) {
  body.innerHTML = `<div class="sb"><div class="st-sec sv-voice"><div class="st-sec-h"><h4>🔊 Its voice</h4></div><p class="hint">Loading…</p></div>
    <div class="st-sec"><div class="st-sec-h"><h4>Where you hear it</h4></div>
      <p class="hint">🔊 Read aloud under its answers and 🎧 voice mode in its chat. Each of your agents speaks with a voice of its own: one is picked for it to suit its character (none the same while there are enough) until you choose one above - Settings → Voice turns that off.</p></div></div>`;
  const sv = body.querySelector('.sv-voice');
  if (C.manage) await agentVoiceSection(C, sv);
  else sv.querySelector('.hint').textContent = 'Only its owner, or someone it is shared with to manage it, chooses its voice.';
}

// ------------------------------------------------------------------------------------------------ Overview
const card = (tab, color, title, body, extra = '') => `<button type="button" class="st-card" data-go="${tab}" style="--sc:${color}"><div class="st-card-h">${title}<span class="st-card-go">›</span></div>${body}${extra}</button>`;

async function overviewTab(C, body, live) {
  const want = { fw: C.i >= 0 && auth.can('agents.freewill'), mind: auth.can('agents.mind'), problems: auth.can('agents.mind'), life: auth.can('agents.profile'), people: auth.can('agents.profile'), mems: auth.can('agents.profile'), recent: C.i >= 0, info: true, econ: true,
    work: auth.can('agents.profile') && !isExt(C.rec()) };
  const keys = Object.keys(want), got = await Promise.all(keys.map(k => (want[k] ? C.get(k) : Promise.resolve(null))));
  if (!live()) return;
  const D = Object.fromEntries(keys.map((k, n) => [k, got[n] && !got[n].error ? got[n] : null]));
  const { life, fw, mind, info, econ, people, mems, recent, problems, work } = D;
  const troubles = (problems?.problems || []).filter(p => p.status === 'open');
  const r = C.rec(), T = id => tabOf(id), cards = [];
  // the first row: what it thinks with, whether it decides, its money
  if (mind) cards.push(card('brain', T('brain').color, '🧠 Brain', brainSummary(C, mind)));
  if (fw) cards.push(card('freewill', T('freewill').color, '⚡ Free Will', freeWillSummary(fw)));
  const mine = econ ? econ.agents.find(a => a.id === C.id) : null;
  if (mine) {
    const L = mine.limits || {}, used = L.dailyCap ? clamp(L.spent24h / L.dailyCap, 0, 1) : 0;
    cards.push(card('money', T('money').color, `${coin()} Money`, `<div class="st-big">${vc(mine.wallet.balance)}</div><div class="st-meter"><i style="width:${Math.round(used * 100)}%"></i></div><div class="st-sub">${L.paused ? '⏸ Spending paused' : `${vc(L.spent24h || 0)} of ${vc(L.dailyCap || 0)} spent in 24 h`}</div>`));
  }
  // the second: who it is, what it means to do, who it knows
  if (life) {
    const P = life.profile;
    cards.push(card('character', T('character').color, '🙂 Personality', `<div class="st-pers"><div class="st-radar-mini">${radarSvg(P, { mini: true })}</div><div class="st-sub">${esc(standout(P) || 'Balanced in every way')}</div></div>`));
    const open = (life.plans || []).filter(x => x.status === 'open').sort((a, b) => (a.kind === 'must' ? 0 : 1) - (b.kind === 'must' ? 0 : 1)).slice(0, 3);
    cards.push(card('plans', T('plans').color, '📋 Plans', open.length ? `<ul class="st-list">${open.map(x => `<li><span class="st-tag ${x.kind}">${x.kind === 'must' ? 'Must' : 'Want'}</span>${esc(x.text)}</li>`).join('')}</ul>` : '<div class="st-sub">No plans yet</div>'));
  }
  if (people) {
    const top = [...people.people].sort((a, b) => b.affinity - a.affinity).slice(0, 4);
    cards.push(card('people', T('people').color, '👥 People', top.length ? `<div class="st-faces">${top.map(x => `<span class="st-face" title="${esc(x.name)}"><b data-avatar>${esc(faceOf(x))}</b><small>${esc(x.name.split(' ')[0])}</small><i style="width:${Math.round(Math.max(0, x.affinity) * 100)}%"></i></span>`).join('')}</div>` : '<div class="st-sub">Hasn\'t met anyone yet</div>'));
  }
  // the third: where it lives and works, what it did, what it remembers
  if (C.i >= 0 && info) {
    const home = homeOf(info), j = info.job || {};
    cards.push(card('place', T('place').color, '🏠 Places', `<div class="st-hw"><div class="st-hw-t"><div class="st-line">🏠 ${home ? `<b>${esc(home.building)}</b> · floor ${home.f + 1}${home.u >= 0 ? `, flat ${home.u + 1}` : ''}` : 'Looking for a place'}</div>
      <div class="st-line">💼 ${j.b >= 0 ? `<b>${esc(j.title || 'Works')}</b>${j.start != null ? ` · ${formatClock(j.start)}–${formatClock(j.end)}` : ''}` : 'Between jobs'}</div></div>${home ? floorPlanSvg(home, { mini: true }) : ''}</div>`));
  }
  if (recent && !recent.private) {
    const last = (recent.activity || []).slice(-3).reverse();
    cards.push(card('activity', T('activity').color, '📜 Activity', last.length ? `<ul class="st-list acts">${last.map(x => `<li class="${x.now ? 'now' : ''}"><small>${esc((x.when || '').split(' ').slice(1).join(' '))}</small>${esc(x.label)}</li>`).join('')}</ul>` : '<div class="st-sub">Its day shows here as it lives it</div>'));
  }
  if (mems) {
    const m = (mems.memories || [])[0];
    cards.push(card('memories', T('memories').color, '📖 Memories', m ? `<div class="st-mini-quote">${esc(m.text)}</div><div class="st-sub">${'★'.repeat(m.importance)}${m.when ? ` · ${esc(m.when)}` : ''}</div>` : '<div class="st-sub">Memories write themselves as it lives</div>'));
  }
  // header chips
  const chips = [];
  // (a connected agent thinks with its own AI, wherever it runs: not "no brain")
  if (isExt(r)) chips.push({ tab: 'brain', color: T('brain').color, html: '🔌 Its own AI' });
  else if (mind) chips.push({ tab: 'brain', color: T('brain').color, html: `🧠 ${mind.status.thinks ? esc(mind.status.brain?.own ? (mind.status.brain.model.split('/').pop() || mind.status.brain.label) : 'Nightly reflection') : mind.settings.cadence === 'off' ? 'Mind off' : 'No brain'}` });
  if (fw) chips.push({ tab: 'freewill', color: T('freewill').color, html: `⚡ ${fw.settings.enabled ? (fw.status.active ? 'Free Will on' : 'Free Will paused') : 'Routine'}` });
  if (mine) chips.push({ tab: 'money', color: T('money').color, html: `${coin()} ${vc(mine.wallet.balance)}` });
  // its job at a glance (CHAT.md §13): its title and who it works for, else that it has no brief yet
  if (work) {
    const b = work.brief, briefed = b.instructions || b.knowledge || b.company || work.files.length;
    const job = [r.role, b.company && `at ${b.company}`].filter(Boolean).join(' ') || 'Has a job brief';
    chips.push({ tab: 'work', color: T('work').color, html: `💼 ${briefed ? esc(job.length > 42 ? `${job.slice(0, 41).trimEnd()}…` : job) : 'No job brief'}` });
    // and what others who talk with it get (CHAT.md §14.3)
    if (r.connection && (r.connection.kind === 'models' || r.connection.kind === 'agentapi')) chips.push({ tab: 'visitors', color: T('visitors').color, html: `🛎️ Visitors: ${r.connection.kind === 'agentapi' && b.publicMode !== 'greet' ? 'Talks' : PUBLIC_WORDS[b.publicMode] || 'Life'}` });
  }
  if (troubles.length) chips.push({ tab: 'brain', color: '#f87171', html: `⚠️ ${troubles.length === 1 ? '1 problem' : `${troubles.length} problems`}` });
  C.setChips(chips);
  const thought = mind?.thoughts?.[0]?.did?.thought;
  body.innerHTML = `<div class="st-ov">
    <div class="st-ov-top">${info ? dayRing(info) : ''}<div class="st-ov-intro">
      ${life?.profile.bio ? `<p class="st-bio">${esc(life.profile.bio)}</p>` : `<p class="hint">${C.manage || C.owner ? 'Tell its story in Personality - who it is, what it loves - and it lives by it.' : ''}</p>`}
      ${life?.profile.purpose ? `<p class="st-purpose">🎯 ${esc(life.profile.purpose)}</p>` : ''}
      ${troubles.length ? `<button type="button" class="st-probs" data-go="brain" title="What its Mind did about it: the Brain tab">${problemsHtml(troubles.slice(0, 2), { solved: 0 })}</button>` : thought ? `<blockquote class="st-quote">“${esc(thought)}”</blockquote>` : ''}</div></div>
    <div class="st-grid">${cards.join('')}</div></div>`;
  body.querySelector('.st-ov').onclick = e => { const g = e.target.closest('[data-go]'); if (g) C.go(g.dataset.go); };
}
function faceOf(x) {
  if (x.kind === 'agent') { const a = (S.agentList || []).find(q => String(q.id) === String(x.id)); if (a?.emoji) return a.emoji; }
  return (x.name || '?').trim().charAt(0).toUpperCase();
}
/** A 24-hour dial: asleep, at work, lunch, and the hand at the world's hour now. */
function dayRing(info) {
  const sc = info.sched || {}, j = info.job || {}, R = 46, cx = 60, cy = 60;
  const pt = (hr, r = R) => { const a = (hr / 24) * Math.PI * 2 - Math.PI / 2; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const arc = (h0, h1, cls) => {
    if (h0 === null || h1 === null || h0 === undefined || h1 === undefined) return '';
    let d = ((h1 - h0) % 24 + 24) % 24; if (d === 0) return '';
    const [x0, y0] = pt(h0), [x1, y1] = pt(h0 + d);
    return `<path class="${cls}" d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 ${d > 12 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}"/>`;
  };
  const hour = ((S.hour ?? 12) % 24 + 24) % 24, [hx, hy] = pt(hour, R - 6);
  const lunch = sc.lunch != null ? pt(sc.lunch) : null;
  const ticks = [0, 6, 12, 18].map(t => { const [x, y] = pt(t, R + 9); return `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}">${t === 0 ? '0' : t}</text>`; }).join('');
  return `<figure class="st-day" title="Its day: asleep ${sc.bed != null ? formatClock(sc.bed) : '?'}–${sc.wake != null ? formatClock(sc.wake) : '?'}${j.start != null ? `, work ${formatClock(j.start)}–${formatClock(j.end)}` : ''}">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="d-base" cx="${cx}" cy="${cy}" r="${R}"/>${arc(sc.bed % 24, sc.wake, 'd-sleep')}${j.b >= 0 ? arc(j.start, j.end, 'd-work') : ''}
      ${lunch ? `<circle class="d-lunch" cx="${lunch[0].toFixed(1)}" cy="${lunch[1].toFixed(1)}" r="4"/>` : ''}${ticks}
      <line class="d-hand" x1="${cx}" y1="${cy}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}"/><circle class="d-pin" cx="${cx}" cy="${cy}" r="3"/></svg>
    <figcaption><span class="k-sleep">Asleep</span><span class="k-work">Work</span><span class="k-lunch">Lunch</span></figcaption></figure>`;
}
