// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat windows (docs/features/CHAT.md §6–§7, §12; chat-and-voice.md - several chats at once): the world's own, ChatGPT/Claude-like - up to four open at
// once, each a whole chat window of its own (ui/chat-window.js): its agent and chat, Sidebar, side panel, composer,
// voice, and the provider's own way of drawing the turns (Hermes as Hermes Desktop, OpenClaw's steps and cards), so one
// can work with several agents side by side. This is their manager:
// - opening: every way of talking to someone (the selection card's Talk, the right-click menu, the Agent Studio's Chat,
//   the 💬 button, notifications, the team list - bus 'openagent') comes here. A chat already open in a window brings
//   that window forward; an agent already open shows there unless that window is busy (an answer coming, something
//   typed); else a new window - the fifth reuses the one used longest ago that has nothing going on, or says to close one.
//   One chat is never in two windows. The agent picker's ⧉ (Ctrl/⌘ or the middle button on a row) and a chat's menu
//   open one beside the others;
// - the windows float on their own - moved by the header, sized from any edge or corner, never snapped or rearranged by
//   themselves; a new one opens in the first free spot along the bottom; whatever is touched comes to the top; Side by
//   side (the header's windows menu) lays them across the screen when the person asks; full screen is per window;
// - put away ( - ): to its button above the 💬 one - its agent, a blue ring while it works, orange while it waits for the
//   person, the answers that came meanwhile; it goes on working. The 💬 button puts them all away or brings them back;
// - one window listens or speaks at a time (voice);
// - they come back with the page: which windows were open, on which chats, where, how big, full screen or put away, the
//   Sidebar and the side panel as they were, what was typed - per account, on this device;
// - the socket's chat frames go to every window (each keeps its own chat's); a side answer (Hermes' /btw) once.
import { S, bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { h, esc } from '../core/util.js';
import { create, tiles, sideAnswer } from './chat-window.js';

const MAX = 4;                         // windows open at once
const KEY = 'mvw.chat.windows';        // the windows that come back with the page: KEY.<account id>
const phone = () => innerWidth < 700;
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };

let app, layer = null, seq = 0;
const wins = [];                       // the open windows, back to front (the last is on top)
const used = new Map();                // window → when it was last brought forward (the one used longest ago is reused first)
let restoredFor = null, restoring = false, saveT = null, saved = null, paintQ = false;

export function init(a) {
  app = a;
  app.chat = { open, openPerson, openPhone, close: closeAll, isOpen: () => wins.some(w => !w.min), windows: () => wins.length };
  bus.on('openagent', id => open(id));
  bus.on('msg:chat', m => {
    if (m.side) { const w = wins.find(x => x.agentId === m.agent && x.sessionId() === m.session); sideAnswer(m, w ? w.ctx() : null); return; }
    for (const w of [...wins]) w.frame(m);
  });
  bus.on('agentlist', () => { for (const w of wins) w.agents(); restore(); });
  bus.on('presence', () => { for (const w of wins) w.presence(); });
  // (signed out, or another account: its windows close - and come back when it signs in again)
  bus.on('auth', () => {
    const id = auth.account?.id ?? null;
    if (!auth.can('chat.use') || (restoredFor !== null && restoredFor !== id)) { closeAll({ keep: true }); restoredFor = null; }
    restore();
  });
  // an approval answered elsewhere (the bell): its card follows in whichever window shows it
  bus.on('approval:answered', () => { for (const w of wins) w.approvals(); });
  // (the Sidebar's Notifications are each window's agent's: they follow every change of the account's - CHAT.md §12)
  bus.on('notify:unread', () => { for (const w of wins) w.notes(); });
  // (the page's key hooks see no typing and no Ctrl/⌘ keys: a window's own shortcuts are its own listener's)
  app.hooks?.key.unshift(e => {
    if (!wins.length) return false;
    const inWin = wins.find(w => w.el && w.el.contains(document.activeElement)), top = front();
    // floating, the world goes on around them: its shortcuts work unless a chat has the focus
    if (!inWin && !top?.max) return false;
    if (e.key === 'Escape') { (inWin || top).escape(); return true; }
    return true;   // the world's shortcuts wait while a window is full screen
  });
  // the floating 💬 button: the most recent chat; with windows open, all of them put away or back
  const fb = document.querySelector('#floatbtns .fb-chat .chat');
  if (fb) { fb.disabled = false; fb.classList.remove('soon'); fb.onclick = () => toggleAll(); }
  addEventListener('pagehide', () => { if (saveT) saveNow(); });
  addEventListener('resize', () => { for (const w of wins) w.fit(); });
  window.visualViewport?.addEventListener('resize', () => { for (const w of wins) w.fit(); });
  // the room they float in changes: a side panel opens or closes, the selection widget comes or goes (they move, then size)
  bus.on('docks', () => { for (const w of wins) w.room(); });
  bus.on('selcard', () => { for (const w of wins) w.room(); });
  paintHeads();
  restore();
}

// ------------------------------------------------------------------------------------------------ opening
/** Talking to a person in the world (Talk, the right-click menu): their agent's chat, or one line saying why not. */
export async function openPerson(i) {
  const p = S.people[i];
  if (!p) return;
  if (!p.v) return app.toast?.(`${p.n} lives in the city but isn't an AI agent, so there's no chat with them.`, '', 4200, '💬');
  const rec = (S.agentList || []).find(a => a.i === i || (p.ag && a.key === p.ag));
  if (!rec) return app.toast?.(`${p.n}'s owner hasn't shared chat with you.`, '', 4200, '💬');
  return open(rec.id);
}
/** An agent's phone (docs/features/phone.md) in the side panel - a phone notification's: its chat window, then the
 *  panel's Phone tab on the conversation (peer) or the calls. */
export async function openPhone(id, o = {}) {
  const w = await open(id);
  if (w && w.agentId === id && !w.openPhone(o)) app.studio?.open?.(id, 'phone');
}
/**
 * A chat with agent `id` (its latest; `session`: that chat), or - no agent named - the most recent chat. Resolves the
 * window that shows it (null: none could open). newWindow: in a window of its own, beside the others (the person asked).
 */
export async function open(id = null, { session = null, onClose = null, newWindow = false } = {}) {
  if (!auth.can('chat.use')) { app.toast?.('Sign in to chat with agents.', 'bad'); auth.ui?.signIn?.(); return null; }
  let w = id !== null && session ? holder(id, session) : null;
  if (w) { if (onClose) w.setOnClose(onClose); reveal(w); return w; }
  if (id !== null && !newWindow) {
    // (the agent's window: brought forward; another of its chats shows there when nothing in it would be lost)
    w = showing(id);
    if (w && !session) { if (onClose) w.setOnClose(onClose); reveal(w); return w; }
    if (w && !w.idle()) w = null;
    if (w) { reveal(w); await w.show(id, { session, onClose }); return w; }
  }
  w = make();
  if (!w && !newWindow) {
    // (four open: the one used longest ago with nothing going on shows it instead)
    w = [...wins].filter(x => x.idle()).sort((p, q) => (used.get(p) || 0) - (used.get(q) || 0))[0] || null;
    if (w) reveal(w);
  }
  if (!w) { app.toast?.(`${MAX} chat windows are open: close one to open another.`, '', 4200, '💬'); return null; }
  await w.show(id, { session, onClose });
  return w;
}
/** A new window (null: four are open). o: how it comes back with the page. */
function make(o = {}) {
  if (wins.length >= MAX) return null;
  // (each its own: the manager's hooks are what it may ask of the others)
  const w = create(app, hooks, { ...o, id: ++seq });
  wins.push(w);
  used.set(w, Date.now());
  return w;
}
/** The window that shows chat `sessionId` of agent `agentId` (or is opening it), other than `except`. */
function holder(agentId, sessionId, except = null) {
  if (sessionId === null || sessionId === undefined) return null;
  return wins.find(w => w !== except && w.agentId === agentId && w.sessionId() === sessionId) || null;
}
/** The window showing agent `agentId` that was used last, other than `except`. */
function showing(agentId, except = null) {
  return wins.filter(w => w !== except && w.agentId === agentId).sort((p, q) => (used.get(q) || 0) - (used.get(p) || 0))[0] || null;
}
/** The window on top (put away ones aside). */
function front() { for (let k = wins.length - 1; k >= 0; k--) if (!wins[k].min) return wins[k]; return null; }
/** Brought back if put away, to the top, the keys in it. */
function reveal(w) { bringForward(w, { reveal: true }); w.focus(); }

// ------------------------------------------------------------------------------------------------ the windows together
/** `w` on top of the others (reveal: brought back if it was put away; on a phone, where each is the whole screen, the
 *  others are put away). */
function bringForward(w, { reveal: back = false } = {}) {
  if (!wins.includes(w)) return;
  if (back && w.min) { w.setMin(false); return; }   // (it comes forward from there)
  used.set(w, Date.now());
  // (touched while on top already: nothing moves - this runs on every press in a window)
  if (wins[wins.length - 1] === w && w.el?.classList.contains('front') && !(phone() && wins.some(x => x !== w && !x.min))) return;
  if (wins[wins.length - 1] !== w) { wins.splice(wins.indexOf(w), 1); wins.push(w); }
  if (phone() && !w.min) for (const x of wins) if (x !== w && !x.min) x.setMin(true);
  order();
  changed();
}
/** Each window's place in the stack (its z-index in the chat layer); the top one marked when several show. (From the
 *  chat level up, Z_BASE: even out of the layer - a page whose stylesheet is older than its script - a window stays over
 *  the world's own controls, its side panels, their edge buttons and the floating buttons.) */
const Z_BASE = 7;
function order() {
  const top = front(), shown = wins.filter(w => !w.min).length;
  wins.forEach((w, k) => { if (!w.el) return; w.el.style.zIndex = String(Z_BASE + k); w.el.classList.toggle('front', w === top); });
  layer?.classList.toggle('multi', shown > 1);
}
/** The 💬 button: no window yet - the most recent chat; some showing - all put away; all put away - all back. */
function toggleAll() {
  if (!wins.length) { open(); return; }
  if (wins.some(w => !w.min)) { for (const w of [...wins]) w.setMin(true); return; }
  if (phone()) { reveal(wins[wins.length - 1]); return; }
  for (const w of [...wins]) w.setMin(false);   // (each comes to the top in turn: the stack stays as it was)
  front()?.focus();
}
/** Side by side (asked for): the windows across the screen, left to right in the order they stand now. */
function tile() {
  if (phone()) return;
  const list = [...wins].sort((p, q) => edge(q) - edge(p)), g = tiles(list.length);
  list.forEach((w, k) => w.arrange(g[k]));
  order(); changed();
}
const edge = w => { const s = w.shown(); return s ? s.r + s.w : -1; };   // (its left edge, from the room's right: larger is further left)
/** Every window but `w` put away, or closed. */
function putOthers(w) { for (const x of [...wins]) if (x !== w) x.setMin(true); }
function closeOthers(w) { for (const x of [...wins]) if (x !== w) x.close(); }
/** keep: the windows stay saved (the account signed out; they come back with it). */
function closeAll({ keep = false } = {}) { for (const w of [...wins]) w.close({ keep }); }

/** What a window may ask of the manager (ui/chat-window.js). */
const hooks = {
  layer() {
    if (!layer || !layer.isConnected) layer = (document.getElementById('ui') || document.body).appendChild(h('<div class="chat-layer"></div>'));
    return layer;
  },
  count: () => wins.length,
  canOpen: () => wins.length < MAX,
  front: (w, o) => bringForward(w, o),
  isFront: w => front() === w,
  put: w => { if (wins.includes(w)) { order(); changed(); } },
  changed: () => changed(),
  closed(w, { keep = false } = {}) {
    const k = wins.indexOf(w);
    if (k < 0) return;
    wins.splice(k, 1); used.delete(w);
    order();
    paintSoon();
    if (!keep) save();
  },
  holder: (agentId, sessionId, except) => holder(agentId, sessionId, except),
  showing: (agentId, except) => showing(agentId, except),
  open: (id, o) => open(id, o),
  rects: except => wins.filter(w => w !== except).map(w => w.shown()).filter(Boolean),
  claimVoice: w => { for (const x of wins) if (x !== w) x.voiceOff(); },
  list: () => [...wins].sort((p, q) => p.id - q.id).map(win => ({ win, st: win.status() })).filter(x => x.st),
  tile: () => tile(),
  putOthers: w => putOthers(w),
  closeOthers: w => closeOthers(w),
};

// ------------------------------------------------------------------------------------------------ the buttons by 💬
/** Something about a window changed (its chat, working, put away, its place…): its button follows, the windows are kept. */
function changed() { paintSoon(); save(); }
function paintSoon() { if (paintQ) return; paintQ = true; requestAnimationFrame(() => { paintQ = false; paintHeads(); }); }
/** A button per open window above the 💬 one (in the order they were opened): its agent's face, a ring while it works
 *  (orange: waiting for the person), how many answers came while it was put away; open (lit) or put away. A press: put
 *  away ↔ back, or to the top when another covers it. */
function paintHeads() {
  const box = document.querySelector('#floatbtns .fb-chat');
  if (!box) return;
  let row = box.querySelector('.fb-wins');
  if (!row) {
    row = box.insertBefore(h('<div class="fb-wins" role="group" aria-label="Your chat windows"></div>'), box.firstChild);
    row.onclick = e => {
      const b = e.target.closest('[data-win]'), w = b && wins.find(x => x.id === Number(b.dataset.win));
      if (!w) return;
      if (w.min) reveal(w);
      else if (front() === w) w.setMin(true);
      else reveal(w);
    };
  }
  const top = front(), list = [...wins].sort((p, q) => p.id - q.id);
  const html = list.map(w => {
    const st = w.status();
    if (!st) return '';
    const what = `${st.name}${st.title ? ` - ${st.title}` : ''}`, state = st.waiting ? 'waiting for you' : st.working ? 'working' : '';
    const tip = `${what}${state ? ` (${state})` : ''}${st.unread ? ` · ${st.unread} new` : ''} - ${st.min ? 'show it' : w === top ? 'put it away' : 'bring it forward'}`;
    return `<button type="button" class="btn fb-win${st.min ? '' : ' on'}${w === top ? ' front' : ''}${st.working ? ' working' : ''}${st.waiting ? ' waiting' : ''}" data-win="${w.id}" title="${esc(tip)}" aria-label="${esc(tip)}" aria-pressed="${!st.min}">
      <span class="fb-win-av" data-avatar>${esc(st.emoji)}</span>${st.unread ? `<b class="fb-win-n">${st.unread > 9 ? '9+' : st.unread}</b>` : ''}</button>`;
  }).join('');
  if (row._h !== html) { row._h = html; row.innerHTML = html; }
  row.classList.toggle('hidden', !list.length);
  for (const w of wins) w.paintWins(wins.length);
  const fb = box.querySelector('.chat');
  if (fb) {
    const t = !wins.length ? 'Chats with your agents' : wins.some(w => !w.min) ? 'Put your chats away (they keep working)' : 'Show your chats';
    if (fb.title !== t) { fb.title = t; fb.setAttribute('aria-label', t); }
  }
}

// ------------------------------------------------------------------------------------------------ back with the page
const keyFor = id => `${KEY}.${id}`;
/** The open windows as they are now - saved a moment after a change, and at once when the page goes (a reload right
 *  after closing one); never before this account's came back (they'd be lost). */
function save() { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); }
function saveNow() {
  clearTimeout(saveT); saveT = null;
  const id = auth.account?.id;
  if (restoring || id === undefined || id === null || restoredFor !== id) return;
  const list = wins.map(w => w.snapshot()).filter(Boolean), json = JSON.stringify(list);
  if (json === saved) return;
  saved = json;
  store.set(keyFor(id), { v: 1, wins: list });
}
/** The account's windows as they were (once it is signed in and its agents are known): each on its chat, where it was. */
function restore() {
  const id = auth.account?.id;
  if (id === undefined || id === null || restoredFor === id || !auth.can('chat.use') || !(S.agentList || []).length) return;
  restoredFor = id;
  const was = store.get(keyFor(id), null), list = Array.isArray(was?.wins) ? was.wins.slice(-MAX) : [];
  saved = JSON.stringify(list);
  restoring = true;
  try {
    for (const s of list) {
      const agent = Number(s?.a), sess = Number.isInteger(s?.s) ? s.s : null;
      // (an agent it can no longer chat with, a chat a window already shows - opened from a notification first: skipped)
      if (!(S.agentList || []).some(a => a.id === agent && a.level) || (sess !== null && holder(agent, sess))) continue;
      const w = make({ geo: s.g && typeof s.g === 'object' ? s.g : null, mode: s.m, min: !!s.min, side: !!s.side, dock: typeof s.dock === 'string' ? s.dock : null, draft: typeof s.d === 'string' ? s.d : '' });
      if (!w) break;
      w.show(agent, { session: sess, latest: false, project: Number.isInteger(s.p) ? s.p : null, quiet: true });
    }
  } finally { restoring = false; }
  order();
  changed();
}
