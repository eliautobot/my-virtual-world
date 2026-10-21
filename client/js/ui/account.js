// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Accounts in the UI: the account chip in the top bar, the sign-in dialog, the forced password change after a
// temporary password, the confirm-password prompt for sensitive actions, and Account settings (display name,
// password, devices, sign out everywhere). It also marks what the visitor may do on <body> (cap-* classes), so tools
// a visitor cannot use are hidden (app.css). The server checks every request anyway; this only keeps the UI honest.
import { S, bus } from '../core/state.js';
import { auth } from '../core/auth.js';
import { canEdit } from '../core/rights.js';
import { getJSON } from '../core/net.js';
import { pushSubscription } from './notify.js';
import { h, esc } from '../core/util.js';

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };
const CAPS_ON_BODY = ['world.edit', 'world.clock', 'world.interact', 'users.manage', 'agents.manage', 'agents.connect'];
let app = { toast() {} }, chip = null, menu = null, open = null, confirmOpen = null, expectingEnd = false;
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;

const hooks = () => ({ signIn: showSignIn, changePassword: showChangePassword, confirmPassword, twofaSetup: showTwofaSetup });
// Invite links carry the token after # (#invite=…), which browsers never send to any server (C83).
const inviteToken = () => new URLSearchParams(location.hash.slice(1)).get('invite');
function dropInviteParam() {
  const h = new URLSearchParams(location.hash.slice(1));
  h.delete('invite');
  const rest = h.toString();
  history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
}
// Links from the website: …/#register opens account creation, …/#signin the sign-in dialog. Read once, then dropped
// from the address so a reload or a shared link does not open it again.
function takeEntryLink() {
  const h = new URLSearchParams(location.hash.slice(1));
  const want = h.has('register') ? 'register' : h.has('signin') ? 'signin' : null;
  if (!want) return null;
  for (const k of ['register', 'signin']) h.delete(k);
  const rest = h.toString();
  history.replaceState(null, '', location.pathname + location.search + (rest ? `#${rest}` : ''));
  return want;
}
const CLOSED_REGISTRATION = 'New accounts are by invitation for now. Sign in if you have one.';
// Back to where signing in was asked from (?return=…): today only the AI apps' consent page (server/connector/), which
// sends someone not signed in here and wants them back once they are (the address is kept for this tab).
const RETURN_KEY = 'mvw.return', RETURN_RE = /^\/connect\.html\?request=[A-Za-z0-9_-]{16,64}$/;
function takeReturn() {
  const q = new URLSearchParams(location.search), to = q.get('return');
  if (!to) return;
  if (RETURN_RE.test(to)) { try { sessionStorage.setItem(RETURN_KEY, JSON.stringify({ to, at: Date.now() })); } catch { /* private mode */ } }
  q.delete('return');
  history.replaceState(null, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
}
/** Signed in and a page is waiting for it: go back there. → whether it went. */
function goReturn() {
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem(RETURN_KEY) || 'null'); } catch { r = null; }
  if (!r || !auth.account) return false;
  sessionStorage.removeItem(RETURN_KEY);
  if (!RETURN_RE.test(String(r.to)) || Date.now() - r.at > 15 * 60000) return false;
  location.assign(r.to);
  return true;
}
// messages from dialogs opened before the app is up: shown once init() has the app
let ready = false;
const early = [];
const say = (...a) => (ready ? app.toast(...a) : early.push(a));
/** A website link on a normal page load: a visitor already signed in just sees the world. */
function openEntryLink(want) {
  if (!want || auth.account) return;
  if (want === 'register' && auth.me && auth.me.registrationOpen) showRegister();
  else showSignIn(want === 'register' ? CLOSED_REGISTRATION : '');
}

/** Boot path for a website link (#register / #signin): its dialog opens over the loading screen at once, while the city
 *  loads behind it (a new visitor from the website waited for the whole city before the form, up to 45 s on a slow
 *  machine: found in the website click-through, 2026-10-08). */
export function openEntryEarly() {
  auth.ui = auth.ui || hooks();
  takeReturn();
  if (goReturn()) return;   // (already signed in: straight back)
  openEntryLink(takeEntryLink());
}
let reconnectWhenReady = false;   // signed in through an early dialog before the live stream existed

export function init(a) {
  app = a;
  ready = true;
  for (const m of early.splice(0)) app.toast(...m);
  if (reconnectWhenReady) { reconnectWhenReady = false; if (app.net) app.net.reconnect(); }
  auth.ui = hooks();
  buildChip();
  bus.on('auth', onAuth);
  bus.on('msg:session', m => {
    if (m.state !== 'ended') return;
    forgetTasks();
    if (expectingEnd) { expectingEnd = false; return; }
    app.toast('You were signed out. You can keep watching as a guest.', 'bad', 6000);
  });
  bus.on('msg:auth', m => { if (m.state === 'signin_required') showSignIn('Sign in to watch this world'); });
  bus.on('net', (ok, why) => { if (!ok && why === 'signin') showSignIn('Sign in to watch this world'); });
  onAuth(auth.me);
  takeReturn();
  if (goReturn()) return;
  const entry = takeEntryLink();
  if (auth.me && auth.me.setup) showSetup();   // a new installation: the administrator account first
  else if (inviteToken()) showInvite(inviteToken());
  else if (auth.me && auth.me.restricted) (auth.me.restrictedWhy === 'twofa' ? showTwofaSetup(true) : showChangePassword(true));
  else openEntryLink(entry);
}

/** Boot path when watching needs sign-in: sign in (and replace a temporary password), then reload. */
export async function signInToWatch() {
  auth.ui = auth.ui || hooks();
  if (auth.me && auth.me.setup) { await showSetup({ reload: true }); return; }
  if (inviteToken() && await showInvite(inviteToken(), { reload: true })) return;
  const entry = takeEntryLink();
  if (entry === 'register' && auth.me && auth.me.registrationOpen && await showRegister({ reload: true })) return;
  for (;;) {
    if (await showSignIn(entry === 'register' && !(auth.me && auth.me.registrationOpen) ? CLOSED_REGISTRATION : 'Sign in to watch this world', { closable: false, reload: true })) break;
  }
}

// ------------------------------------------------------------------ state on the page
function onAuth(me) {
  const b = document.body;
  for (const c of CAPS_ON_BODY) b.classList.toggle(`cap-${c.replace('.', '-')}`, auth.can(c));
  b.classList.toggle('signed-in', !!auth.account);
  renderChip();
  if (!canEdit() && (S.mode === 'furnish' || S.mode === 'build') && app.setMode) app.setMode('explore');
  if (me && !me.caps['agents.view_tasks']) forgetTasks();
}
/** Drops task text this page may still hold from an earlier sign-in. */
function forgetTasks() {
  let n = 0;
  for (const k in S.presence) if (S.presence[k] && 'task' in S.presence[k]) { delete S.presence[k].task; n++; }
  if (n) bus.emit('people');
}
/** After signing in or replacing a password: reconnect the live stream (so the server attaches the session to it and
 *  sends what the new role may see), and fetch presence with task text when this account may see it. */
async function afterSignIn(reload) {
  if (goReturn()) return;
  if (reload) { location.reload(); return; }
  if (!app.net) { reconnectWhenReady = true; return; }   // the city is still loading: init() reconnects it
  if (app.net) app.net.reconnect();
  if (auth.can('agents.view_tasks')) {
    try { const pj = await getJSON('/api/people'); S.presence = pj.presence || {}; bus.emit('people'); } catch { /* next change brings it */ }
  }
}

// ------------------------------------------------------------------ top-bar chip and menu
const initials = n => String(n || '?').trim().split(/\s+/).map(w => [...w][0] || '').join('').slice(0, 2).toUpperCase();
function buildChip() {
  const bar = document.getElementById('topbar');
  if (!bar) return;
  chip = h('<div id="acct"></div>');
  bar.insertBefore(chip, bar.querySelector('#net'));
  chip.addEventListener('click', e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.classList.contains('signin')) showSignIn();
    else if (t.classList.contains('me')) toggleMenu();
  });
}
function renderChip() {
  if (!chip) return;
  const a = auth.account;
  chip.innerHTML = a
    ? `<button class="btn me" title="Account"><span class="av">${esc(initials(a.displayName))}</span><span class="nm">${esc(a.displayName)}</span><span class="rl">${esc(ROLE[a.role] || a.role)}</span></button>`
    : '<button class="btn primary signin" title="Sign in">Sign in</button>';
  if (menu) closeMenu();
}
function toggleMenu() {
  if (menu) return closeMenu();
  const a = auth.account;
  if (!a) return showSignIn();
  menu = document.getElementById('ui').appendChild(h(`<div id="acctmenu" class="panel" role="menu">
    <div class="who"><b>${esc(a.displayName)}</b><span>${esc(a.login)} · ${esc(ROLE[a.role] || a.role)}</span></div>
    ${auth.can('play.use') ? '<button class="btn myprofile" role="menuitem">🏅 My profile</button>' : ''}
    <button class="btn settings" role="menuitem">⚙️ Account settings</button>
    ${['users.manage', 'invites.manage', 'audit.read', 'settings.view', 'settings.world'].some(c => auth.can(c)) ? '<button class="btn adminbtn" role="menuitem">🛡️ Admin</button>' : ''}
    <button class="btn out" role="menuitem">↩ Sign out</button>
  </div>`));
  menu.querySelector('.settings').onclick = () => { closeMenu(); showAccount(); };
  const mp = menu.querySelector('.myprofile');
  if (mp) mp.onclick = () => { closeMenu(); app.profile?.open(); };   // ui/profile.js
  const ab = menu.querySelector('.adminbtn');
  if (ab) ab.onclick = () => { closeMenu(); import('./settings.js').then(m => m.open(app, 'users')); };
  menu.querySelector('.out').onclick = () => { closeMenu(); signOut(false); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}
function outside(e) { if (menu && !menu.contains(e.target) && !(chip && chip.contains(e.target))) closeMenu(); }
function closeMenu() {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener('pointerdown', outside, true);
}
async function signOut(everywhere) {
  expectingEnd = true;
  try {
    // this browser stops being told the account's notifications (a shared computer or phone)
    const sub = await pushSubscription();
    await auth.signOut(everywhere, sub?.endpoint || null);
    sub?.unsubscribe().catch(() => {});
    forgetTasks();
    app.toast(everywhere ? 'Signed out on every device' : 'Signed out', 'good');
  } catch (e) {
    expectingEnd = false;
    app.toast(e.message, 'bad');
  }
}

// ------------------------------------------------------------------ dialogs
/** One small dialog at a time, above everything (also the loading screen); the confirm-password prompt opens on top
 *  of it. close(result) resolves d.done. */
/** The dialog helper for other account screens (ui/admin.js). */
export const authDialog = (kind, title, body, opts) => dialog(kind, title, body, opts);
/** Downloads a file from a GET route, asking for the password first when the route needs it. */
export async function downloadFile(url, name, retried = false) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    if (!retried && j && j.code === 'reauth_required' && await confirmPassword(j.error)) return downloadFile(url, name, true);
    throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { code: j && j.code });
  }
  const m = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = m ? m[1] : name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/** Focuses a dialog's first field a moment after it opens - unless the person is already in one of its fields. A fast
 *  typist on a slow first load could otherwise click into the password box, start typing, and have the delayed focus
 *  pull the rest into the username (found by the WP1.10 rehearsal: the name got the password, the password box
 *  stayed empty, and the browser's required check silently blocked the submit). */
function focusLater(root, sel, ms = 30) {
  setTimeout(() => {
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    root.querySelector(sel)?.focus();
  }, ms);
}
function dialog(kind, title, body, { closable = true, wide = false, settings = false } = {}) {
  const stacked = kind === 'confirm';
  if (stacked ? confirmOpen : open) (stacked ? confirmOpen : open).close(false);
  const el = document.body.appendChild(h(`<div class="modal-back auth-back"><div class="modal panel auth${wide ? ' wide' : ''}${settings ? ' settings' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h3>${esc(title)}</h3>${body}</div></div>`));
  const key = e => { if (e.key === 'Escape' && closable && (confirmOpen || open) === d) { e.preventDefault(); e.stopPropagation(); d.close(false); } };
  let resolve;
  const d = {
    kind, el, done: new Promise(r => { resolve = r; }),
    q: s => el.querySelector(s),
    close(result) {
      if ((stacked ? confirmOpen : open) !== d) return;
      if (stacked) confirmOpen = null; else open = null;
      el.remove();
      document.removeEventListener('keydown', key, true);
      resolve(result);
    },
    error(err) {
      const e = el.querySelector('.err');
      if (!e) return;
      e.textContent = err.code === 'https_required' ? 'Signing in needs a secure connection. Open this site over HTTPS.' : err.message;
      e.classList.remove('hidden');
    },
    busy(on) { for (const b of el.querySelectorAll('button')) b.disabled = on; },
  };
  document.addEventListener('keydown', key, true);            // Escape closes the dialog before the app sees it
  el.addEventListener('keydown', e => e.stopPropagation());   // typing never reaches the app's shortcuts
  if (closable) el.addEventListener('pointerdown', e => { if (e.target === el) d.close(false); });
  for (const b of el.querySelectorAll('.cancel')) b.onclick = () => d.close(false);
  if (stacked) confirmOpen = d; else open = d;
  focusLater(el, 'input:not([hidden])');
  return d;
}

function showSignIn(reason = '', { closable = true, reload = false } = {}) {
  if (open && open.kind === 'signin') return open.done;
  const insecure = auth.me && auth.me.secure === false;
  const d = dialog('signin', 'Sign in', `
    ${reason ? `<p class="why">${esc(reason)}</p>` : ''}
    <form class="aform" autocomplete="on">
      <label>Username<input class="input login" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label>Password<input class="input pw" type="password" name="password" autocomplete="current-password" required></label>
      ${insecure ? '<p class="warn">This connection is not secure (no HTTPS), so signing in is turned off here.</p>' : ''}
      <div class="err hidden" role="alert"></div>
      <p class="hint">Forgot your password? Ask the world's owner or an administrator to reset it.</p>
      <div class="row end">${auth.me && auth.me.registrationOpen ? '<button type="button" class="btn link register">Create an account</button><span class="spacer"></span>' : ''}${closable ? '<button type="button" class="btn cancel">Cancel</button>' : ''}<button type="submit" class="btn primary go">Sign in</button></div>
    </form>`, { closable });
  const reg = d.q('.register');
  if (reg) reg.onclick = () => { d.close(false); showRegister({ reload }); };
  d.q('form').onsubmit = async e => {
    e.preventDefault();
    d.busy(true);
    const password = d.q('.pw').value;
    try {
      const r = await auth.signIn(d.q('.login').value, password);
      if (r && r.twofa === 'required') { d.busy(false); codeStep(d, r.ticket, { reload }); return; }
      d.close(true);
      await finishSignIn(r, { reload, password });
    } catch (err) {
      d.error(err);
      d.busy(false);
      d.q('.pw').select();
    }
  };
  return d.done;
}
/** After a successful sign-in: the forced password change or two-factor setup first, when the session needs it. */
async function finishSignIn(me, { reload = false, password = '' } = {}) {
  if (me.restricted && me.restrictedWhy === 'password') { await showChangePassword(true, { reload, current: password }); return; }
  if (me.restricted && me.restrictedWhy === 'twofa') { await showTwofaSetup(true, { reload }); return; }
  app.toast(`Signed in as ${me.account.displayName}`, 'good');
  await afterSignIn(reload);
}
/** The second sign-in step for accounts with two-factor sign-in (the password was right). */
function codeStep(d, ticket, { reload }) {
  const form = d.q('form');
  form.innerHTML = `<p class="why">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
    <label>Code<input class="input code" inputmode="numeric" autocomplete="one-time-code" autocapitalize="none" spellcheck="false" maxlength="12" required></label>
    <div class="err hidden" role="alert"></div>
    <div class="row end"><button type="button" class="btn cancel">Cancel</button><button type="submit" class="btn primary go">Sign in</button></div>`;
  form.querySelector('.cancel').onclick = () => d.close(false);
  focusLater(form, '.code');
  form.onsubmit = async e => {
    e.preventDefault();
    d.busy(true);
    try {
      const me = await auth.call('/api/auth/signin/2fa', { ticket, code: form.querySelector('.code').value });
      d.close(true);
      await finishSignIn(me, { reload });
    } catch (err) {
      d.error(err);
      d.busy(false);
      if (err.code === 'ticket_expired' || /Sign in again/.test(err.message)) { d.close(false); showSignIn(err.message, { reload }); return; }
      form.querySelector('.code').select();
    }
  };
}

const LOGIN_HINT = '2 to 32 letters, digits, dots, dashes or underscores';
const newAccountFields = (login = '') => `
  <label>Username<input class="input login" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" value="${esc(login)}" required></label>
  <label>Display name (others see it)<input class="input dn" maxlength="32" required></label>
  <label>Password<input class="input npw" type="password" autocomplete="new-password" required></label>
  <label>Password again<input class="input npw2" type="password" autocomplete="new-password" required></label>
  <p class="hint">Username: ${LOGIN_HINT}. Password: at least 12 characters; common passwords are refused.</p>`;
function readNewAccount(d) {
  const login = d.q('.login').value.trim(), displayName = d.q('.dn').value.trim(), password = d.q('.npw').value;
  if (!LOGIN_RE.test(login)) return d.error({ message: `Use ${LOGIN_HINT} for the username` }), null;
  if (password !== d.q('.npw2').value) return d.error({ message: 'The two passwords are not the same' }), null;
  if ([...password.normalize('NFKC')].length < 12) return d.error({ message: 'Use at least 12 characters for the password' }), null;
  return { login, displayName, password };
}
/** A new installation: whoever installed it creates the administrator account, proving it with the one-time setup code
 *  the server printed when it started (also in setup-code.txt in its data folder). */
function showSetup({ reload = true } = {}) {
  if (open && open.kind === 'setup') return open.done;
  const insecure = auth.me && auth.me.secure === false;
  const d = dialog('setup', 'Welcome to My Virtual World', `<form class="aform">
    <p class="why">Create the administrator account for this world: you will manage it, its people and its agents.</p>
    <label>Setup code<input class="input scode" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16" placeholder="XXXX-XXXX" required></label>
    <p class="hint">The server printed it when it started, and it is in <code>setup-code.txt</code> in its data folder. With Docker: <code>docker compose logs app | grep "Setup code"</code></p>
    ${newAccountFields()}
    ${insecure ? '<p class="warn">This connection is not secure (no HTTPS), so accounts can\'t be made here. Open this site over HTTPS or on this computer (localhost).</p>' : ''}
    <div class="err hidden" role="alert"></div>
    <div class="row end"><button type="submit" class="btn primary go">Create the administrator</button></div></form>`, { closable: false });
  focusLater(d.el, '.scode');
  d.q('form').onsubmit = async e => {
    e.preventDefault();
    const code = d.q('.scode').value.trim();
    if (!code) return d.error({ message: 'Enter the setup code' });
    const v = readNewAccount(d);
    if (!v) return;
    d.busy(true);
    try {
      const me = await auth.call('/api/auth/setup', { code, ...v });
      d.close(true);
      app?.toast?.(`Welcome, ${me.account.displayName}: you are this world's administrator`, 'good', 5000);
      await afterSignIn(reload);
    } catch (err) { d.error(err); d.busy(false); if (err.code === 'owner_exists') setTimeout(() => location.reload(), 1500); }
  };
  return d.done;
}
/** Open self-registration, when the admins switched it on. */
function showRegister({ reload = false } = {}) {
  const d = dialog('register', 'Create an account', `<form class="aform">${newAccountFields()}
    <div class="err hidden" role="alert"></div>
    <div class="row end"><button type="button" class="btn cancel">Cancel</button><button type="submit" class="btn primary go">Create account</button></div></form>`);
  d.q('form').onsubmit = async e => {
    e.preventDefault();
    const v = readNewAccount(d);
    if (!v) return;
    d.busy(true);
    try {
      const me = await auth.call('/api/auth/register', v);
      d.close(true);
      app.toast(`Welcome, ${me.account.displayName}`, 'good', 3400);
      await afterSignIn(reload);
    } catch (err) { d.error(err); d.busy(false); }
  };
  return d.done;
}
/** An invite link (#invite=…): create the account it grants. Resolves true when an account was created. */
async function showInvite(token, { reload = false } = {}) {
  let info;
  try { info = await (await fetch(`/api/invites/check?token=${encodeURIComponent(token)}`, { cache: 'no-store' })).json(); } catch { info = { valid: false }; }
  if (!info.valid) {
    dropInviteParam();
    app.toast('This invite link is no longer valid. Ask for a new one.', 'bad', 6000);
    return false;
  }
  const d = dialog('invite', 'You are invited', `<form class="aform">
    <p class="why">Create your account (${esc(ROLE[info.role] || info.role)}). The invite works once, until ${esc(new Date(info.expires).toLocaleString())}.</p>
    ${newAccountFields()}
    <div class="err hidden" role="alert"></div>
    <div class="row end"><button type="button" class="btn cancel">Not now</button><button type="submit" class="btn primary go">Create account</button></div></form>`);
  d.q('form').onsubmit = async e => {
    e.preventDefault();
    const v = readNewAccount(d);
    if (!v) return;
    d.busy(true);
    try {
      const me = await auth.call('/api/invites/accept', { token, ...v });
      dropInviteParam();
      d.close(true);
      app.toast(`Welcome, ${me.account.displayName}`, 'good');
      await afterSignIn(reload);
    } catch (err) {
      d.error(err);
      d.busy(false);
      if (err.code === 'invite_invalid') dropInviteParam();
    }
  };
  return d.done;
}

/** Two-factor setup: QR code and key, one code to confirm, then the recovery codes (shown once). forced: the session
 *  may do nothing else until it is set up ("require two-factor for admins"). */
async function showTwofaSetup(forced = false, { reload = false } = {}) {
  if (open && open.kind === 'twofa') return open.done;
  const d = dialog('twofa', 'Set up two-factor sign-in', `<div class="aform twofa">
    ${forced ? '<p class="why">Two-factor sign-in is required for admins here. Set it up to continue.</p>' : ''}
    <div class="setup"><div class="hint">Preparing…</div></div>
    <div class="err hidden" role="alert"></div>
    <div class="row end">${forced ? '<button type="button" class="btn out">Sign out</button>' : '<button type="button" class="btn cancel">Cancel</button>'}</div></div>`, { closable: !forced });
  const out = d.q('.out');
  if (out) out.onclick = async () => { d.close(false); await signOut(false); if (reload) location.reload(); };
  const box = d.q('.setup');
  let s;
  try { s = await auth.call('/api/account/2fa/setup'); } catch (err) { d.error(err); return d.done; }
  box.innerHTML = `<p>1. Scan this code with an authenticator app (for example Aegis, Google Authenticator, 1Password or Bitwarden).</p>
    <div class="qr" aria-label="QR code for the authenticator app">${s.svg}</div>
    <p class="hint">No camera? Enter this key: <code class="key">${esc(s.secret)}</code></p>
    <form class="confirm row"><label>2. Enter the 6-digit code it shows<input class="input code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
    <button type="submit" class="btn primary go">Turn on</button></form>`;
  focusLater(box, '.code');
  box.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    d.busy(true);
    try {
      const r = await auth.call('/api/account/2fa/enable', { code: box.querySelector('.code').value });
      box.innerHTML = recoveryHtml(r.codes, 'Two-factor sign-in is on.');
      wireRecovery(box, r.codes);
      d.q('.row.end').innerHTML = '<button type="button" class="btn primary done">I saved my recovery codes</button>';
      d.q('.done').onclick = async () => { d.close(true); if (forced) await afterSignIn(reload); };
    } catch (err) { d.error(err); d.busy(false); box.querySelector('.code')?.select(); }
  };
  return d.done;
}
const recoveryHtml = (codes, lead) => `<p>${esc(lead)} Keep these recovery codes somewhere safe: each one signs you in once if you lose your phone. They are shown only now.</p>
  <div class="codes">${codes.map(c => `<code>${esc(c)}</code>`).join('')}</div>
  <div class="row"><button type="button" class="btn small copycodes">Copy</button><button type="button" class="btn small savecodes">Download</button></div>`;
function wireRecovery(root, codes) {
  const text = `${location.host} recovery codes (${new Date().toLocaleDateString()})\n${codes.join('\n')}\n`;
  root.querySelector('.copycodes').onclick = async e => { try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { e.target.textContent = 'Select and copy'; } };
  root.querySelector('.savecodes').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

/** current: the password just used to sign in; it fills the first field, which then stays out of sight. */
function showChangePassword(forced = false, { reload = false, current = '' } = {}) {
  if (open && open.kind === 'password') return open.done;
  const a = auth.account;
  if (!a) return showSignIn();
  const d = dialog('password', forced ? 'Choose your password' : 'Change password', `
    ${forced ? '<p class="why">You signed in with a temporary password. Choose your own password to continue.</p>' : ''}
    <form class="aform">
      <input name="username" autocomplete="username" value="${esc(a.login)}" hidden>
      <label>${forced ? 'Temporary password' : 'Current password'}<input class="input cur" type="password" autocomplete="current-password" required></label>
      <label>New password<input class="input npw" type="password" autocomplete="new-password" required></label>
      <label>New password again<input class="input npw2" type="password" autocomplete="new-password" required></label>
      <p class="hint">At least 12 characters; a few random words work well. Common passwords are refused. Your other devices will be signed out.</p>
      ${forced && a.role === 'owner' && a.login === 'owner' ? `<label>Username (you may keep "owner")<input class="input newlogin" autocapitalize="none" spellcheck="false" maxlength="32" value="owner"></label>` : ''}
      <div class="err hidden" role="alert"></div>
      <div class="row end">${forced ? '<button type="button" class="btn out">Sign out</button>' : '<button type="button" class="btn cancel">Cancel</button>'}<button type="submit" class="btn primary go">Save password</button></div>
    </form>`, { closable: !forced });
  if (current) {
    d.q('.cur').value = current;
    d.q('.cur').closest('label').hidden = true;
    focusLater(d.el, '.npw', 40);
  }
  const out = d.q('.out');
  if (out) out.onclick = async () => { d.close(false); await signOut(false); if (reload) location.reload(); };
  d.q('form').onsubmit = async e => {
    e.preventDefault();
    const npw = d.q('.npw').value, newLogin = (d.q('.newlogin')?.value || '').trim();
    if (npw !== d.q('.npw2').value) return d.error({ message: 'The two new passwords are not the same' });
    if ([...npw.normalize('NFKC')].length < 12) return d.error({ message: 'Use at least 12 characters' });
    if (newLogin && !LOGIN_RE.test(newLogin)) return d.error({ message: 'Use 2 to 32 letters, digits, dots, dashes or underscores for the username' });
    d.busy(true);
    try {
      await auth.changePassword(d.q('.cur').value, npw);
      d.close(true);
      app.toast('Password saved', 'good');
      if (newLogin && newLogin.toLowerCase() !== a.login) {
        try {
          const me = await auth.setLogin(newLogin);
          app.toast(`You now sign in as ${me.account.login}`, 'good');
        } catch (err) { app.toast(`${err.message}. You can change the username in Account settings.`, 'bad', 6000); }
      }
      await afterSignIn(reload);
    } catch (err) {
      d.error(err);
      d.busy(false);
    }
  };
  return d.done;
}

function confirmPassword(reason = '') {
  const a = auth.account;
  if (!a) return Promise.resolve(false);
  const d = dialog('confirm', 'Confirm your password', `
    <p class="why">${esc(reason || 'This action needs your password again.')}</p>
    <form class="aform">
      <input name="username" autocomplete="username" value="${esc(a.login)}" hidden>
      <label>Password<input class="input pw" type="password" autocomplete="current-password" required></label>
      <div class="err hidden" role="alert"></div>
      <div class="row end"><button type="button" class="btn cancel">Cancel</button><button type="submit" class="btn primary go">Confirm</button></div>
    </form>`);
  d.q('form').onsubmit = async e => {
    e.preventDefault();
    d.busy(true);
    try {
      await auth.reauth(d.q('.pw').value);
      d.close(true);
    } catch (err) {
      d.error(err);
      d.busy(false);
      d.q('.pw').select();
    }
  };
  return d.done;
}

function describeDevice(ua) {
  ua = String(ua || '');
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}
function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  if (s < 129600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function showAccount() {
  const a = auth.account;
  if (!a) return showSignIn();
  const d = dialog('account', 'Account settings', '<div class="aform acctbody"></div>');
  accountPanel(d, d.q('.acctbody'));
  return d.done;
}

/** The account panel: also the Account tab of the Settings dialog (ui/settings.js). It renders into `root`, and
 *  `d` is the surrounding dialog, for errors, the busy state and closing it. */
export function accountPanel(d, root) {
  const a = auth.account;
  if (!a) { root.innerHTML = '<p class="hint">Sign in to see your account.</p>'; return; }
  root.innerHTML = `
      <label>Display name<span class="row"><input class="input dn" maxlength="32" value="${esc(a.displayName)}"><button type="button" class="btn savename">Save</button></span></label>
      <p class="hint">Others see this name, for example on your edits. Role: ${esc(ROLE[a.role] || a.role)}</p>
      <label>Username<span class="row"><input class="input ln" maxlength="32" autocapitalize="none" spellcheck="false" value="${esc(a.login)}"><button type="button" class="btn savelogin">Save</button></span></label>
      <p class="hint">What you type to sign in; nobody else sees it. Changing it asks for your password.</p>
      <div class="sep"></div>
      <div class="sub">Signing in</div>
      <div class="row wrap ways"><span class="hint">🔑 Password: set</span><span class="spacer"></span><button type="button" class="btn small pwbtn">Change password</button></div>
      <div class="sep"></div>
      <div class="sub">Two-factor sign-in</div>
      <div class="tfa"><div class="hint">Loading…</div></div>
      <div class="sep"></div>
      <div class="sub">Signed-in devices</div>
      <div class="devices"><div class="hint">Loading…</div></div>
      <div class="sep"></div>
      <div class="sub">Your data</div>
      <div class="row wrap"><button type="button" class="btn export">⬇ Download my data</button><button type="button" class="btn danger delacct">Delete my account…</button></div>
      <div class="delrow"></div>
      <div class="err hidden" role="alert"></div>
      <div class="row end"><button type="button" class="btn danger outall">Sign out everywhere</button><button type="button" class="btn cancel">Close</button></div>`;
  const q = s => root.querySelector(s);
  const tfa = q('.tfa');
  const renderTfa = async () => {
    try {
      const st = await (await fetch('/api/account/2fa', { cache: 'no-store' })).json();
      tfa.innerHTML = st.on
        ? `<p class="hint">On since ${esc(new Date(st.since).toLocaleDateString())}${st.recoveryLeft ? `; ${st.recoveryLeft} recovery codes left.` : '.'}</p>${st.recoveryLeft ? '' : '<p class="warn">No recovery codes left: create new ones, or you cannot sign in if you lose your phone.</p>'}
           <div class="row wrap"><button type="button" class="btn small newcodes">New recovery codes</button><button type="button" class="btn small danger tfaoff">Turn off</button></div><div class="newcodebox"></div>`
        : '<p class="hint">Off. With it on, signing in also needs a code from an app on your phone.</p><div><button type="button" class="btn small tfaon">Set up</button></div>';
      const on = tfa.querySelector('.tfaon'), off = tfa.querySelector('.tfaoff'), nc = tfa.querySelector('.newcodes');
      if (on) on.onclick = () => { d.close(true); showTwofaSetup(false); };
      if (off) off.onclick = async () => { try { await auth.call('/api/account/2fa/disable'); app.toast('Two-factor sign-in is off', 'good'); renderTfa(); } catch (err) { if (err.code !== 'reauth_required') d.error(err); } };
      if (nc) nc.onclick = async () => {
        try { const r = await auth.call('/api/account/2fa/recovery'); const box = tfa.querySelector('.newcodebox'); box.innerHTML = recoveryHtml(r.codes, 'New recovery codes; the old ones no longer work.'); wireRecovery(box, r.codes); } catch (err) { if (err.code !== 'reauth_required') d.error(err); }
      };
    } catch (err) { tfa.innerHTML = ''; d.error(err); }
  };
  renderTfa();
  q('.export').onclick = () => downloadFile('/api/account/export', 'my-data.json').then(() => app.toast('Your data was downloaded', 'good'), err => { if (err.code !== 'reauth_required') d.error(err); });
  q('.delacct').onclick = () => {
    const row = q('.delrow');
    row.innerHTML = a.role === 'owner'
      ? '<p class="warn">The owner cannot delete the account. Make an admin the owner first (Settings → Users).</p>'
      : `<div class="confirm-row"><b>Delete your account for good?</b> Enter your password:
        <input class="input small delpw" type="password" autocomplete="current-password"> <button type="button" class="btn small danger godel">Delete</button></div>`;
    const go = row.querySelector('.godel');
    if (go) go.onclick = async () => {
      try {
        expectingEnd = true;
        await auth.call('/api/account/delete', { password: row.querySelector('.delpw')?.value ?? '' });
        d.close(true);
        forgetTasks();
        app.toast('Your account was deleted', 'good', 6000);
      } catch (err) { expectingEnd = false; if (err.code !== 'reauth_required') d.error(err); }
    };
  };
  const list = q('.devices');
  const render = devices => {
    list.innerHTML = devices.map(v => `<div class="dev"><span>${esc(describeDevice(v.userAgent))}${v.current ? ' <b>· this device</b>' : ''}
      <small>${esc(v.ip || 'unknown address')} · ${esc(ago(v.lastSeen))}</small></span>
      ${v.current ? '' : `<button type="button" class="btn small revoke" data-id="${v.id}">Sign out</button>`}</div>`).join('') || '<div class="hint">No devices</div>';
  };
  auth.devices().then(render, err => d.error(err));
  list.onclick = async e => {
    const b = e.target.closest('.revoke');
    if (!b) return;
    b.disabled = true;
    try { render((await auth.revokeDevice(+b.dataset.id)).devices); } catch (err) { d.error(err); b.disabled = false; }
  };
  q('.savename').onclick = async () => {
    d.busy(true);
    try {
      const me = await auth.setDisplayName(q('.dn').value);
      app.toast(`Your display name is now ${me.account.displayName}`, 'good');
    } catch (err) { d.error(err); }
    d.busy(false);
  };
  q('.dn').addEventListener('keydown', e => { if (e.key === 'Enter') q('.savename').click(); });
  q('.savelogin').onclick = async () => {
    const v = q('.ln').value.trim();
    if (!LOGIN_RE.test(v)) return d.error({ message: 'Use 2 to 32 letters, digits, dots, dashes or underscores for the username' });
    d.busy(true);
    try {
      const me = await auth.setLogin(v);
      q('.ln').value = me.account.login;
      app.toast(`You now sign in as ${me.account.login}`, 'good');
    } catch (err) { if (err.code !== 'reauth_required') d.error(err); }
    d.busy(false);
  };
  q('.ln').addEventListener('keydown', e => { if (e.key === 'Enter') q('.savelogin').click(); });
  q('.pwbtn').onclick = () => { d.close(true); showChangePassword(false); };
  const cancel = q('.cancel');
  if (cancel) cancel.onclick = () => d.close(false);
  q('.outall').onclick = () => { d.close(true); signOut(true); };
}
