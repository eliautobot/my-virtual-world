// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The bell (docs/features/CHAT.md §8): what this account is told - an agent asking for its OK (Approve and Decline
// right in the list), a note from an agent, an answer that came while it was away - with the number not yet read in the
// top bar. A notification that comes while the page is hidden shows as a browser notification too. "Notifications on
// this device" subscribes this browser to Web Push (the service worker /sw.js shows what is pushed when no page is
// open; an iPhone needs the site added to its Home Screen first). Links from a notification (?chat=…, ?approval=…)
// open where they belong when the page loads.
import { S, bus } from '../core/state.js';
import { getJSON, post } from '../core/net.js';
import { auth } from '../core/auth.js';
import { h, esc } from '../core/util.js';

let app, btn, badge, panel = null, list = [], unread = 0, loaded = false, statuses = new Map(), swReg = null;
const ICON = { approval: '✋', note: '💬', chat: '💬', problem: '🧭', system: '🔔', phone: '📱' };
const vc = c => `${(c / 100).toFixed(c % 100 ? 2 : 0)} VC`;
const ago = ms => { const s = Math.max(0, (Date.now() - ms) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(ms).toLocaleDateString(); };
const pushable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
const ios = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export function init(a) {
  app = a;
  app.notify = { open: openPanel, close: closePanel, refresh: load, unread: () => unread };
  const bar = document.getElementById('topbar'), help = bar?.querySelector('.helpb');
  if (!bar || !help) return;
  btn = h('<button type="button" class="btn icon bellb hidden" title="Notifications" aria-label="Notifications" aria-haspopup="dialog">🔔<span class="bell-n hidden" aria-hidden="true"></span></button>');
  bar.insertBefore(btn, help);
  badge = btn.querySelector('.bell-n');
  btn.onclick = () => (panel ? closePanel() : openPanel());
  bus.on('auth', () => { btn.classList.toggle('hidden', !auth.account); if (auth.account) load(); else { list = []; setUnread(0); closePanel(); } });
  bus.on('msg:notify', onFrame);
  bus.on('hello', () => auth.account && load());   // (the socket came back: what was missed)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration('/').then(r => { swReg = r || null; }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => { if (e.data?.t === 'open') follow(new URL(e.data.url, location.origin)); });
  }
  if (auth.account) { btn.classList.remove('hidden'); load(); }
  // a link from a notification: open it once the world is ready
  bus.on('ready', () => follow(new URL(location.href), true));
  if (app.ready) follow(new URL(location.href), true);
}

function setUnread(n) {
  unread = Math.max(0, n | 0);
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', !unread);
  btn.title = unread ? `Notifications (${unread} new)` : 'Notifications';
  bus.emit('notify:unread', unread);   // (the chat's Sidebar shows it too)
}
async function load() {
  if (!auth.account) return;
  try { const r = await getJSON('/api/notifications?limit=50'); list = r.notifications || []; loaded = true; setUnread(r.unread); app.notifyDevices = r.devices; await statusOf(list); if (panel) paint(); } catch { /* the bell stays as it was */ }
}
/** Where the approvals in these notifications stand (an approval is answered, declined or expired elsewhere too). */
async function statusOf(items) {
  const ids = items.filter(n => n.kind === 'approval' && n.link?.approval).map(n => n.link.approval).filter(id => !statuses.has(id) || statuses.get(id) === 'pending');
  if (!ids.length) return;
  try { for (const a of (await getJSON(`/api/economy/approvals?ids=${encodeURIComponent(ids.join(','))}`)).approvals || []) statuses.set(a.id, a.status); } catch { /* unknown: shown as asked */ }
}
function onFrame(m) {
  if (typeof m.unread === 'number') setUnread(m.unread);
  if (!m.n) { if (panel && m.read) load(); return; }
  list.unshift(m.n); list = list.slice(0, 100);
  if (panel) { statusOf([m.n]).then(paint); }
  // a hidden page: a browser notification too (the service worker's, so a tap brings this page forward)
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const url = urlOf(m.n.link);
    const show = { body: m.n.body, tag: `${m.n.kind}:${m.n.id}`, icon: '/img/brand/app-192.png', data: { url } };
    if (swReg) swReg.showNotification(m.n.title, show).catch(() => {});
    else try { const n = new Notification(m.n.title, show); n.onclick = () => { window.focus(); follow(new URL(url, location.origin)); n.close(); }; } catch { /* not allowed here */ }
  }
}
function urlOf(link) {
  if (!link) return '/';
  if (link.approval) return `/?approval=${encodeURIComponent(link.approval)}${link.agent ? `&agent=${link.agent}` : ''}`;
  if (link.agent && link.phone) return `/?phone=${link.agent}${link.phone.peer ? `&peer=${encodeURIComponent(link.phone.peer)}` : ''}${link.phone.call ? '&calls=1' : ''}`;
  if (link.agent) return `/?chat=${link.agent}${link.session ? `:${link.session}` : ''}`;
  return '/';
}
/** Opens what a notification is about: a chat, or the bell on an approval. */
function follow(u, fromLoad = false) {
  const chat = u.searchParams.get('chat'), appr = u.searchParams.get('approval'), phone = Number(u.searchParams.get('phone'));
  if (!chat && !appr && !(phone > 0)) return;
  if (fromLoad) history.replaceState(null, '', location.pathname);   // (a reload doesn't open it again)
  if (!auth.account) return;
  if (phone > 0) { app.chat?.openPhone?.(phone, { peer: u.searchParams.get('peer') || null, calls: u.searchParams.get('calls') === '1' }); return; }
  if (chat) { const [agent, session] = chat.split(':').map(Number); if (agent > 0) app.chat?.open(agent, session > 0 ? { session } : {}); return; }
  openPanel();
}

// ------------------------------------------------------------------------------------------------ the list
function openPanel() {
  if (!auth.account) return;
  if (panel) return;
  panel = (document.getElementById('ui') || document.body).appendChild(h(`<div class="bell-panel panel" role="dialog" aria-label="Notifications">
    <div class="bell-head"><b>Notifications</b><span class="grow"></span><button type="button" class="btn small bell-all">Mark all read</button>
      <button type="button" class="btn icon small bell-x" aria-label="Close">✕</button></div>
    <div class="bell-list" role="list"></div><div class="bell-foot"></div></div>`));
  panel.querySelector('.bell-x').onclick = closePanel;
  panel.querySelector('.bell-all').onclick = () => post('/api/notifications/read', { all: true }).then(r => { setUnread(r.unread); list.forEach(n => { n.read = true; }); paint(); }).catch(e => app.toast?.(e.message, 'bad'));
  panel.addEventListener('click', onPanelClick);
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  paint();
  load();
}
function closePanel() { if (!panel) return; panel.remove(); panel = null; document.removeEventListener('pointerdown', away, true); }
function away(e) { if (panel && !panel.contains(e.target) && !btn.contains(e.target)) closePanel(); }

function paint() {
  if (!panel) return;
  const L = panel.querySelector('.bell-list');
  if (!loaded) L.innerHTML = '<div class="bell-empty">Loading…</div>';
  else if (!list.length) L.innerHTML = '<div class="bell-empty">Nothing yet. When an agent needs your OK, has something to tell you, or answers while you\'re away, it shows here.</div>';
  else L.innerHTML = itemsHtml(list);
  paintFoot();
}
/** Notifications as the items of a list - the bell's, and one agent's in the chat window's Sidebar (`inChat`: its own
 *  chat is already open, so an approval offers no "Open chat"). */
export function itemsHtml(items, { inChat = false } = {}) {
  return items.map(n => {
    const st = n.kind === 'approval' ? statuses.get(n.link?.approval) || 'pending' : null;
    const acts = st === 'pending' ? `<div class="bell-acts"><button type="button" class="btn small primary" data-appr="${esc(n.link.approval)}" data-yes="1">Approve</button><button type="button" class="btn small" data-appr="${esc(n.link.approval)}" data-yes="0">Decline</button>${n.link.agent && !inChat ? `<button type="button" class="btn small" data-chat="${n.link.agent}">Open chat</button>` : ''}</div>`
      : st ? `<div class="bell-st ${st}">${{ approved: 'Approved', declined: 'Declined', expired: 'Expired', failed: 'Approved, but it failed' }[st] || st}</div>` : '';
    return `<div class="bell-item${n.read ? '' : ' unread'}" role="listitem" data-id="${n.id}"${n.link?.agent && n.link.phone ? ` data-phone="${n.link.agent}" data-peer="${esc(n.link.phone.peer || '')}" data-calls="${n.link.phone.call ? '1' : ''}"` : n.link?.agent && n.kind !== 'approval' ? ` data-chat="${n.link.agent}" data-session="${n.link.session || ''}"` : ''}${n.link?.homestead ? ' data-fl="open"' : ''}>
      <span class="bell-ic" aria-hidden="true">${ICON[n.kind] || '🔔'}</span><div class="bell-txt"><div class="bell-t" data-noicon>${esc(n.title)}</div>${n.body ? `<div class="bell-b" data-noicon>${esc(n.body)}</div>` : ''}${acts}<div class="bell-when">${ago(n.created)}</div></div></div>`;
  }).join('');
}
/** Where the approvals among these stand, asked once (for a list other than the bell's). */
export const approvalStatuses = items => statusOf(items);
async function paintFoot() {
  const f = panel?.querySelector('.bell-foot');
  if (!f) return;
  if (!pushable()) { f.innerHTML = `<div class="bell-hint">${ios() && !standalone() ? 'To be notified on this iPhone or iPad when the app isn\'t open, add it to your Home Screen (Share → Add to Home Screen), then open it from there.' : 'This browser can\'t show notifications when the page is closed.'}</div>`; return; }
  const sub = await currentSub();
  const on = !!sub && Notification.permission === 'granted';
  const denied = Notification.permission === 'denied';
  f.innerHTML = `<label class="bell-push"><input type="checkbox" class="bell-sw"${on ? ' checked' : ''}${denied ? ' disabled' : ''}> <span>Notifications on this device</span></label>
    ${on ? '<button type="button" class="btn small bell-test">Send a test</button>' : ''}
    <div class="bell-hint">${denied ? 'Notifications are blocked for this site in the browser\'s settings.' : on ? 'You\'ll be told here and on this device when the page isn\'t open.' : 'Get told on this device even when the page isn\'t open.'}</div>`;
  f.querySelector('.bell-sw')?.addEventListener('change', e => togglePush(e.target.checked));
  f.querySelector('.bell-test')?.addEventListener('click', async () => { try { const r = await post('/api/notifications/push/test', {}); app.toast?.(r.sent ? 'Sent - it shows on your devices in a moment.' : 'No device took it; turn notifications off and on again.', r.sent ? 'good' : 'bad'); } catch (err) { app.toast?.(err.message, 'bad'); } });
}
async function onPanelClick(e) {
  const did = await clickItem(e, { beforeOpen: closePanel });
  if (did === 'approval') paint();
}
/**
 * A click in a list of notifications (the bell's, or one agent's in the chat window): Approve or Decline, opening the
 * chat it is about (beforeOpen first: the bell closes), or marking it read. Returns what it did: 'approval', 'chat',
 * 'read' or null. Each one read or answered updates the unread count, which every list follows (bus 'notify:unread').
 */
export async function clickItem(e, { beforeOpen = null } = {}) {
  const a = e.target.closest('[data-appr]');
  if (a) {
    a.disabled = true;
    const id = a.dataset.appr, yes = a.dataset.yes === '1';
    try {
      const r = await post('/api/economy/approval/answer', { id, approve: yes });
      statuses.set(id, r.approval?.status || (yes ? 'approved' : 'declined'));
      const rr = await post('/api/notifications/read', { approval: id }); setUnread(rr.unread);
      list.forEach(n => { if (n.link?.approval === id) n.read = true; });
      app.toast?.(yes ? (r.approval?.status === 'failed' ? `Approved, but it failed: ${r.approval?.result?.error || 'unknown'}` : 'Approved - done.') : 'Declined.', r.approval?.status === 'failed' ? 'bad' : 'good');
    } catch (err) { statuses.set(id, /no longer waiting/i.test(err.message) ? 'expired' : 'pending'); app.toast?.(err.message, 'bad'); }
    bus.emit('approval:answered', id);
    return 'approval';
  }
  const ph = e.target.closest('[data-phone]');
  if (ph) {
    if (ph.classList.contains('unread')) post('/api/notifications/read', { id: Number(ph.dataset.id) }).then(r => setUnread(r.unread)).catch(() => {});
    beforeOpen?.();
    app.chat?.openPhone?.(Number(ph.dataset.phone), { peer: ph.dataset.peer || null, calls: ph.dataset.calls === '1' });
    return 'phone';
  }
  const c = e.target.closest('[data-chat]');
  if (c) {
    const item = c.closest('.bell-item');
    if (item && !item.classList.contains('unread')) { /* already read */ }
    else if (item) post('/api/notifications/read', { id: Number(item.dataset.id) }).then(r => setUnread(r.unread)).catch(() => {});
    beforeOpen?.();
    const session = Number(c.dataset.session) || null;
    app.chat?.open(Number(c.dataset.chat), session ? { session } : {});
    return 'chat';
  }
  const it = e.target.closest('.bell-item.unread');
  if (it) { it.classList.remove('unread'); post('/api/notifications/read', { id: Number(it.dataset.id) }).then(r => setUnread(r.unread)).catch(() => {}); return 'read'; }
  return null;
}

// ------------------------------------------------------------------------------------------------ push on this device
async function currentSub() {
  try { const r = swReg || await navigator.serviceWorker.getRegistration('/'); return r ? await r.pushManager.getSubscription() : null; } catch { return null; }
}
/** This browser's push subscription, if it has one (signing out ends it). */
export const pushSubscription = currentSub;
const keyBytes = b64 => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); };
async function togglePush(on) {
  try {
    if (on) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { app.toast?.('Notifications weren\'t allowed for this site.', 'bad'); return paintFoot(); }
      swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const { publicKey } = await getJSON('/api/notifications/push/key');
      let sub = await swReg.pushManager.getSubscription();
      if (sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') !== publicKey) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      await post('/api/notifications/push/subscribe', { subscription: sub.toJSON(), device: deviceName() });
      app.toast?.('Notifications are on for this device.', 'good');
    } else {
      const sub = await currentSub();
      if (sub) { await post('/api/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      app.toast?.('Notifications are off for this device.');
    }
  } catch (e) { app.toast?.(`Couldn't change notifications: ${e.message}`, 'bad'); }
  paintFoot();
}
function deviceName() {
  const u = navigator.userAgent;
  const os = /Android/.test(u) ? 'Android' : ios() ? 'iPhone/iPad' : /Mac OS/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'Device';
  const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
