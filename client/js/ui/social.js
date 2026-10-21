// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Online players, friends, status and proximity chat (PLAN WP1.10, owner request 2026-09-28, DECISIONS C118).
// - The Online players section of the info dock: your status (Online or Appear offline), who is online (friends first,
//   then by name; click to fly there), friend requests to answer, requests you sent, and your friends who are offline.
// - Friends: add by display name; the other person accepts or declines; either side removes it. A friend coming online
//   is announced (never while they appear offline).
// - Proximity chat: a small box at the bottom of the screen. Enter opens it; what you send reaches players within 20 m
//   in the same space (outside, or the same floor) as a bubble over your head and a line in their chat log.
// Guests see players' characters and tags only (C118): no list, statuses or chat.
import { S, bus } from '../core/state.js';
import { h, esc } from '../core/util.js';
import { auth } from '../core/auth.js';
import { getJSON, post } from '../core/net.js';

let app = null;
const E = {};
const ST = { online: [], friends: { friends: [], incoming: [], outgoing: [] }, status: 'online', log: [], unread: 0 };

export function init(a) {
  app = a;
  app.social = { friendIds: new Set(), state: ST, addFriend: name => addFriend(name), say: text => say(text), setStatus: v => setStatus(v) };
  const slot = a.docks && a.docks.slot('r:players');
  if (slot) buildPanel(slot);
  buildChat(document.getElementById('ui'));
  bus.on('msg:online', m => { ST.online = m.list || []; renderPanel(); });
  bus.on('msg:friends', m => { ST.friends = { friends: m.friends || [], incoming: m.incoming || [], outgoing: m.outgoing || [] }; app.social.friendIds = new Set(ST.friends.friends.map(f => f.id)); renderPanel(); });
  bus.on('msg:you', m => { ST.status = m.status || 'online'; renderPanel(); refreshChat(); });
  bus.on('msg:friend_online', m => app.toast(`⭐ ${m.name} is online`, 'good', 3500));
  bus.on('msg:chat_refused', m => app.toast(m.why || 'That message was not sent', 'bad', 3500));
  bus.on('player:chat', onChat);
  bus.on('auth', () => { renderPanel(); refreshChat(); });
  bus.on('mode', () => refreshChat());
  window.addEventListener('keydown', onKey, true);
  renderPanel(); refreshChat();
}

// ------------------------------------------------------------------ the dock section
function buildPanel(slot) {
  slot.appendChild(h(`<div class="soc">
    <p class="hint soc-guest hidden">Sign in to see who is online, add friends and chat with people near you.</p>
    <div class="soc-in">
      <label class="soc-status">Your status <select class="input status">
        <option value="online">🟢 Online</option><option value="invisible">⚫ Appear offline</option></select></label>
      <p class="hint soc-status-hint"></p>
      <div class="soc-req"></div>
      <h5 class="soc-h">Online now <span class="n"></span></h5>
      <div class="soc-list"></div>
      <h5 class="soc-h">Friends</h5>
      <form class="soc-add row"><input class="input name" maxlength="64" placeholder="Add a friend by display name" aria-label="Add a friend by display name">
        <button class="btn small" type="submit">Add</button></form>
      <div class="soc-friends"></div>
    </div></div>`));
  E.guest = slot.querySelector('.soc-guest'); E.in = slot.querySelector('.soc-in');
  E.status = slot.querySelector('.status'); E.statusHint = slot.querySelector('.soc-status-hint');
  E.req = slot.querySelector('.soc-req'); E.list = slot.querySelector('.soc-list'); E.n = slot.querySelector('.soc-h .n');
  E.friends = slot.querySelector('.soc-friends'); E.add = slot.querySelector('.soc-add');
  E.status.onchange = () => setStatus(E.status.value);
  E.add.onsubmit = e => { e.preventDefault(); const i = E.add.querySelector('.name'); addFriend(i.value).then(ok => { if (ok) i.value = ''; }); };
  slot.addEventListener('click', onPanelClick);
}
const where = w => (!w ? '' : w.outside ? 'outside' : `${w.name}${Number.isInteger(w.f) ? `, floor ${w.f + 1}` : ''}`);
function renderPanel() {
  if (!E.in) return;
  const can = auth.can('players.online');
  E.guest.classList.toggle('hidden', can);
  E.in.classList.toggle('hidden', !can);
  if (!can) return;
  E.status.value = ST.status;
  E.statusHint.textContent = ST.status === 'invisible'
    ? 'You appear offline: you are not in the online list, joining and leaving are not announced, and friends are not told. People near your character in the world still see it.'
    : 'Everyone signed in sees that you are online and where you are.';
  const F = ST.friends, friendOn = new Set(ST.online.filter(p => p.friend).map(p => p.pid));
  E.req.innerHTML = F.incoming.map(f => `<div class="soc-r" data-id="${f.id}"><span>👋 <b>${esc(f.name)}</b> wants to be friends</span>
      <button class="btn small primary acc">Accept</button><button class="btn small dec">Decline</button></div>`).join('')
    + F.outgoing.map(f => `<div class="soc-r out" data-id="${f.id}"><span>⏳ Asked <b>${esc(f.name)}</b></span><button class="btn small cancel">Cancel</button></div>`).join('');
  const others = ST.online.filter(p => !p.you).length;
  E.n.textContent = `· ${ST.online.length}`;
  E.list.innerHTML = ST.online.length ? ST.online.map(p => `<button type="button" class="ditem soc-p${p.you ? ' you' : ''}" data-pid="${p.pid}" title="${p.you ? 'You' : 'Show where they are'}">
      <span class="di">${p.invisible ? '⚫' : p.friend ? '⭐' : '🟢'}</span>
      <span class="dn">${esc(p.name)}${p.you ? ' (you)' : ''}</span>
      <small>${p.invisible && !p.you ? 'appears offline · ' : ''}${p.observing ? 'observing · ' : ''}${esc(where(p.where))}</small>
      ${auth.can('play.use') ? `<span class="soc-prof" data-prof="${p.pid}" title="${p.you ? 'Your profile' : 'Their profile: rank, badges, best results'}">👤</span>` : ''}</button>`).join('')
    : '<p class="hint">Nobody else is here right now.</p>';
  if (!others) E.list.insertAdjacentHTML('beforeend', '<p class="hint">You are the only one online.</p>');
  E.friends.innerHTML = F.friends.length ? F.friends.map(f => `<div class="soc-f" data-id="${f.id}">
      <span>${friendOn.has(f.id) ? '🟢' : '⚪'} ${esc(f.name)}</span><small>${friendOn.has(f.id) ? 'online' : 'offline'}</small>
      ${auth.can('play.use') ? `<button class="btn small prof" title="Their profile">👤</button>` : ''}<button class="btn small rm" title="Remove this friend">Remove</button></div>`).join('')
    : '<p class="hint">No friends yet: add someone by their display name.</p>';
}
async function onPanelClick(e) {
  const pr = e.target.closest('.soc-prof');   // a player's profile (ui/profile.js)
  if (pr) { e.stopPropagation(); app.profile?.open(+pr.dataset.prof); return; }
  if (e.target.closest('.soc-f .prof')) { app.profile?.open(+e.target.closest('[data-id]').dataset.id); return; }
  const p = e.target.closest('.soc-p');
  if (p) { goTo(+p.dataset.pid); return; }
  const r = e.target.closest('[data-id]');
  if (!r) return;
  const id = +r.dataset.id;
  const call = async (url, done) => {
    try { await post(url, { id }); if (done) app.toast(done, 'good', 2500); } catch (err) { if (!err.quiet) app.toast(err.message, 'bad', 4000); }
  };
  if (e.target.closest('.acc')) call('/api/friends/accept', 'You are friends now');
  else if (e.target.closest('.dec')) call('/api/friends/remove', 'Request declined');
  else if (e.target.closest('.cancel')) call('/api/friends/remove', 'Request cancelled');
  else if (e.target.closest('.rm')) {
    const name = r.querySelector('span')?.textContent.replace(/^\S+\s/, '') || 'this friend';
    if (confirm(`Remove ${name} from your friends?`)) call('/api/friends/remove', 'Friend removed');
  }
}
async function addFriend(name) {
  name = String(name || '').trim();
  if (!name) return false;
  try {
    const r = await post('/api/friends/request', { name });
    app.toast(r.state === 'friends' ? `You and ${r.other.name} are friends now` : `Friend request sent to ${r.other.name}`, 'good', 3000);
    return true;
  } catch (err) { if (!err.quiet) app.toast(err.message, 'bad', 4000); return false; }
}
async function setStatus(v) {
  if (v !== 'online' && v !== 'invisible') return;
  try {
    await post('/api/account/settings', { values: { 'social.status': v } });
    ST.status = v;
    app.toast(v === 'invisible' ? '⚫ You now appear offline' : '🟢 You are online', '', 2500);
  } catch (err) { if (!err.quiet) app.toast(err.message, 'bad', 4000); }
  renderPanel();
}
/** Flies to a player: where the stream last put it when it is near, else where the online list says. */
function goTo(pid) {
  const near = app.remote && app.remote.byPid.get(pid), p = ST.online.find(x => x.pid === pid);
  if (!near && !p) return;
  if (S.mode === 'play') return app.toast('Leave Play mode to fly the camera', '', 2200);
  const x = near ? near.extra.x : p.where.x, z = near ? near.extra.z : p.where.z;
  const ctx = near ? near.ctx : p.where.outside ? -1 : p.where.b * 64 + p.where.f;
  if (ctx >= 0 && app.lookInside) { app.lookInside(ctx >> 6, ctx & 63); setTimeout(() => app.cam.flyTo(x, 0, z, 26), 350); }
  else { app.exitFocus?.(); app.cam.flyTo(x, 0, z, 34); }
}

// ------------------------------------------------------------------ proximity chat
function buildChat(root) {
  E.chat = root.appendChild(h(`<div id="pchat" class="panel hidden" aria-label="Chat with people near you">
    <div class="pc-log" role="log" aria-live="polite"></div>
    <form class="pc-form row"><input class="input pc-in" maxlength="280" placeholder="Say something to people near you (Enter)" aria-label="Say something to people near you">
      <button class="btn small" type="submit">Say</button></form></div>`));
  E.log = E.chat.querySelector('.pc-log'); E.input = E.chat.querySelector('.pc-in');
  E.chat.querySelector('.pc-form').onsubmit = e => {
    e.preventDefault(); if (say(E.input.value)) E.input.value = ''; E.input.blur();
    if (S.mode === 'play' && !touch()) app.cam?.lockMouse?.();   // said: the mouse looks around again (Enter is the gesture it needs)
  };
  E.input.addEventListener('keydown', e => { if (e.key === 'Escape') { E.input.blur(); e.stopPropagation(); } });
  // the box closes once you stop typing (after a tap on Say has gone through); a click or tap on the messages answers them
  E.input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== E.input) { chatOpen = false; refreshChat(); } }, 300));
  E.log.addEventListener('click', () => openChat());
  app.openChat = openChat;
}
const touch = () => matchMedia('(pointer: coarse)').matches;
let chatOpen = false;   // the box is open to type in
/** Opens the box to say something to the people near you (E next to a player, Enter, or a click on their message). */
export function openChat() {
  if (!E.chat) return;
  if (!auth.can('players.chat') || !(app.remote && app.remote.me)) { app.toast(auth.account ? 'Your role cannot chat' : 'Sign in to chat with people near you', 'bad', 2400); return; }
  chatOpen = true; refreshChat();
  E.input.focus();
}
/** The chat box stays out of the way (2026-10-06, phones and computers alike): it opens to type when you go to talk to
 *  someone (E next to a player, or Enter) and closes when you are done; what people near you say shows by itself for a
 *  minute, without the typing line. */
function refreshChat() {
  if (!E.chat) return;
  const can = auth.can('players.chat') && !!(app.remote && app.remote.me);
  const recent = ST.log.length && Date.now() - ST.log[ST.log.length - 1].at < 60000;
  const typing = document.activeElement === E.input;
  const show = can && (chatOpen || typing || recent);
  E.chat.classList.toggle('hidden', !show);
  E.chat.classList.toggle('pc-ro', show && !chatOpen && !typing);
}
function say(text) {
  text = String(text || '').trim();
  if (!text) return false;
  if (!app.net.send({ t: 'say', text: text.slice(0, 280) })) { app.toast('Not connected', 'bad'); return false; }
  return true;
}
function onChat(m) {
  ST.log.push({ at: Date.now(), name: m.name, text: m.text, you: !!(app.remote && app.remote.me && m.pid === app.remote.me.pid) });
  if (ST.log.length > 60) ST.log.shift();
  if (E.log) {
    E.log.innerHTML = ST.log.slice(-30).map(l => `<div class="pc-l${l.you ? ' you' : ''}"><b>${esc(l.you ? 'You' : l.name)}</b> ${esc(l.text)}</div>`).join('');
    E.log.scrollTop = E.log.scrollHeight;
  }
  refreshChat();
  clearTimeout(E.hideT);
  E.hideT = setTimeout(refreshChat, 61000);
}
function onKey(e) {
  if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if (t?.closest?.('.psc-view')) return;   // (typing on an agent's own screen: its keys — provider-screen.js)
  if (document.querySelector('.modal-back, .auth-back')) return;
  if (!auth.can('players.chat') || !(app.remote && app.remote.me) || S.mode !== 'play') return;
  e.preventDefault(); e.stopPropagation();
  openChat();
}
