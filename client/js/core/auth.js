// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The visitor's account on the client: who is signed in, what they may do (capabilities from the server), and the
// CSRF token that every write sends. The dialogs live in ui/account.js, which sets auth.ui.
// Emits bus 'auth' (me, previous) whenever the answer changes.
import { bus } from './state.js';

export const auth = {
  /** The last GET /api/auth/me answer: { account, role, restricted, caps, csrf, requireSignIn, secure, reauthLeftMs }. */
  me: null,
  /** Dialog hooks set by ui/account.js: signIn(reason), changePassword(forced), confirmPassword(reason) → Promise<boolean>. */
  ui: null,
  can(cap) { return !!(this.me && this.me.caps && this.me.caps[cap]); },
  get csrf() { return (this.me && this.me.csrf) || null; },
  get account() { return (this.me && this.me.account) || null; },
  set(me) {
    const prev = this.me;
    this.me = me;
    bus.emit('auth', me, prev);
    return me;
  },
  async refresh() {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store' });
      if (r.ok) return this.set(await r.json());
    } catch { /* offline: keep the last answer */ }
    return this.me;
  },
  /** POST to an account endpoint; adopts a "me" answer. A request that needs the password again asks for it and is
   *  retried once. Throws an Error with .status and .code. */
  async call(url, body, retried = false) {
    const headers = { 'content-type': 'application/json' };
    if (this.csrf) headers['x-csrf-token'] = this.csrf;
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    let j = null;
    try { j = await r.json(); } catch { /* empty */ }
    if (!r.ok) {
      const code = j && j.code;
      if (!retried && code === 'reauth_required' && this.ui && await this.ui.confirmPassword(j.error)) return this.call(url, body, true);
      if (code === 'licence_required') bus.emit('licence:required', j.error);   // demo mode: ui/licence.js offers the way out
      throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status, code, retryAfter: +r.headers.get('retry-after') || 0 });
    }
    if (j && typeof j === 'object' && 'caps' in j) this.set(j);
    return j;
  },
  signIn(login, password) { return this.call('/api/auth/signin', { login, password }); },
  /** endpoint: this browser's push subscription, which stops with the session. */
  signOut(everywhere = false, endpoint = null) { return this.call('/api/auth/signout', { everywhere, ...(endpoint ? { endpoint } : {}) }); },
  changePassword(current, password) { return this.call('/api/account/password', { current, password }); },
  reauth(password) { return this.call('/api/auth/reauth', { password }); },
  setDisplayName(displayName) { return this.call('/api/account/name', { displayName }); },
  setLogin(login) { return this.call('/api/account/login', { login }); },
  async devices() {
    const r = await fetch('/api/account/devices', { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return (await r.json()).devices;
  },
  revokeDevice(id) { return this.call('/api/account/devices/revoke', { id }); },
};
