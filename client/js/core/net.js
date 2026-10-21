// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Networking: REST helpers, WebSocket (plans + events), server clock synchronisation.
import { decodePlans } from '/shared/proto.js';
import { simAt } from '/shared/constants.js';
import { bus } from './state.js';
import { auth } from './auth.js';

const localReal = () => (performance.timeOrigin + performance.now()) / 1000;

export async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    let j = null;
    try { j = await r.json(); } catch { /* not JSON */ }
    throw Object.assign(new Error((j && j.error) || `${url}: HTTP ${r.status}`), { status: r.status, code: j && j.code });
  }
  return r.json();
}
/** POST with the session's CSRF token. A stale token is refreshed and the request retried once; a request that needs
 *  the password again asks for it (ui/account.js) and is retried once; sign-in and forced password changes open their
 *  dialogs. Errors carry .status and .code. */
export async function post(url, body, retried = false) {
  const headers = { 'content-type': 'application/json' };
  if (auth.csrf) headers['x-csrf-token'] = auth.csrf;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  if (r.ok) return j;
  const code = j && j.code;
  if (!retried) {
    if (code === 'csrf') { await auth.refresh(); return post(url, body, true); }
    if (code === 'reauth_required' && auth.ui && await auth.ui.confirmPassword(j.error)) return post(url, body, true);
  }
  if (code === 'signin_required') { await auth.refresh(); if (auth.ui) auth.ui.signIn(j.error); }
  else if (code === 'password_change_required' && auth.ui) auth.ui.changePassword(true);
  else if (code === 'twofa_setup_required' && auth.ui) auth.ui.twofaSetup(true);
  else if (code === 'licence_required') bus.emit('licence:required', j.error);   // demo mode: ui/licence.js offers the way out
  throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status, code, quiet: code === 'signin_required' || code === 'reauth_required' });
}

export class Net {
  constructor() {
    this.offset = 0; this.samples = []; this.clock = null;
    this.plans = []; this.planVer = new Uint32Array(0);
    this.ws = null; this.connected = false; this.retry = 0; this.pingId = 0; this.pending = new Map();
    this.bytes = 0; this.lastMsg = 0; this.synced = false;
  }
  realNow() { return localReal() + this.offset; }
  simNow() { return this.clock ? simAt(this.clock, this.realNow()) : 0; }
  setClock(c) {
    if (!c) return;
    this.clock = { simBase: c.simBase, realBase: c.realBase, rate: c.rate, dayBase: c.dayBase, dayScale: c.dayScale };
    bus.emit('clock', this.clock);
  }
  ensure(n) {
    if (this.planVer.length >= n) return;
    const v = new Uint32Array(Math.max(n, this.planVer.length * 2, 1024)); v.set(this.planVer); this.planVer = v;
  }
  connect() {
    this.needsSignIn = false;
    const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true; this.retry = 0; this.samples = [];
      bus.emit('net', true);
      for (let k = 0; k < 6; k++) setTimeout(() => this.ping(), 150 + k * 350);
    };
    ws.onclose = (ev) => {
      this.connected = false;
      if (ev.code === 4401) {
        // Watching this world needs sign-in: no reconnect loop. ui/account.js asks for sign-in and reconnects.
        this.needsSignIn = true;
        bus.emit('net', false, 'signin');
        return;
      }
      bus.emit('net', false);
      const wait = Math.min(15000, 800 * Math.pow(1.7, this.retry++));
      setTimeout(() => this.connect(), wait);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* */ } };
    ws.onmessage = (ev) => {
      this.lastMsg = performance.now();
      if (typeof ev.data !== 'string') {
        this.bytes += ev.data.byteLength;
        if (ev.data.byteLength && new DataView(ev.data).getUint8(0) === 3) { this.vehicleFrame = ev.data; bus.emit('vehicles:frame', ev.data); return; }
        if (ev.data.byteLength && new DataView(ev.data).getUint8(0) === 2) { bus.emit('players:frame', ev.data); return; }   // the player stream (WP1.10)
        decodePlans(ev.data, (i, p) => {
          if (i >= this.plans.length) this.plans.length = i + 1;
          this.ensure(i + 1);
          this.plans[i] = p; this.planVer[i]++;
        });
        if (!this.synced) { this.synced = true; bus.emit('synced'); }
        return;
      }
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      this.handle(m);
    };
    // Ping once a second until a good clock estimate exists, then every 10 s.
    clearInterval(this.pingTimer); clearTimeout(this.pingKick);
    const kick = () => { this.ping(); if (this.samples.length < 12) this.pingKick = setTimeout(kick, 1000); };
    this.pingKick = setTimeout(kick, 500);
    this.pingTimer = setInterval(() => this.ping(), 10000);
  }
  /** Opens a fresh connection now, so the server attaches the current session to it (after signing in). */
  reconnect() {
    this.playerYou = null; this.vehicleFrame = null; this.driveState = null;
    const old = this.ws;
    this.ws = null;
    if (old) {
      old.onclose = null; old.onerror = null; old.onmessage = null; old.onopen = null;
      try { old.close(); } catch { /* already closed */ }
    }
    this.connected = false;
    this.connect();
  }
  /** Sends a text message on the live connection; false when it is not open. */
  send(obj) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) return false;
    try { this.ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }
  ping() {
    if (!this.connected) return;
    const id = ++this.pingId;
    this.pending.set(id, localReal());
    try { this.ws.send(JSON.stringify({ t: 'ping', id })); } catch { /* */ }
  }
  handle(m) {
    if (m.t === 'drive_state') this.driveState = m;
    if ((m.t === 'pcorr' || m.t === 'pmoved') && this.playerYou) for (const k of ['x','y','z','ctx','yaw']) if (Number.isFinite(m[k])) this.playerYou[k] = m[k];
    if (m.t === 'you') this.playerYou = m;  // first authenticated attach may precede the optional player modules
    switch (m.t) {
      case 'hello':
        if (m.clock && Number.isFinite(m.clock.serverTime) && !this.samples.length) this.offset = m.clock.serverTime - localReal();
        this.setClock(m.clock);
        bus.emit('hello', m);
        break;
      case 'pong': {
        const t0 = this.pending.get(m.id); this.pending.delete(m.id);
        if (t0 === undefined) break;
        const t1 = localReal(), rtt = t1 - t0;
        this.samples.push({ rtt, off: m.serverTime - (t0 + t1) / 2 });
        if (this.samples.length > 16) this.samples.shift();
        const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 5).map(s => s.off).sort((a, b) => a - b);
        this.offset = best[Math.floor(best.length / 2)];
        this.rtt = rtt;
        if (m.clock) this.setClock(m.clock);
        break;
      }
      case 'clock': this.setClock(m.clock); break;
      case 'session': auth.refresh().then(() => bus.emit('msg:session', m)); break;   // ended or changed
      default: bus.emit('msg:' + m.t, m);
    }
  }
}
