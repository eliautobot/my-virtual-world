// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent's own screen, live (docs/features/agent-pc.md §4.2): /api/providers/screen/ws carries a provider's screen
// stream — Hermes' Bot Desktop, raw RFB over WebSocket — between the person's viewer (noVNC, in their PC or chat window)
// and the provider, byte for byte. The person is signed in here and may manage the agent's provider (the chat service's
// screenOf); the provider hands a single-use ticket for its own stream (display.observe) on the connection's own address,
// and nothing else is dialed (a person's own connection: a public address only, resolved and pinned here as its helper
// checks it). The provider's own gate decides whose keys and clicks reach the screen (Hermes: only the viewer holding its
// lease — take over / hand back), so watching never types. Closing the viewer hands control back (a clean close, as
// Hermes' own viewer closes); a dropped link keeps it, so a person mid-login is not cut off. Ends when the person's
// session does, or they may no longer see it.
import { WebSocket, WebSocketServer } from 'ws';
import { resolvePublic } from '../pc/egress-proxy.js';

export const PATH = '/api/providers/screen/ws';
const PER_ACCOUNT = 4, MAX = 32;
const DIAL_MS = 10000;
const HIGH = 4 * 1048576, LOW = 1048576;   // a side that reads slowly: the other is paused above HIGH, resumed below LOW
const CLEAN = new Set([1000, 1001]);
const CLOSED = new Set([1000, 1001, 1005]);   // (a person's viewer closed on purpose: 1005, a browser's close without a code)

/** A connection's own address, resolved: a public one only, unless the connection is an administrator's (pinned). */
function lookupFor(allowPrivate, resolve) {
  if (allowPrivate) return undefined;
  return (hostname, options, cb) => {
    resolve(hostname).then(({ address, family }) => (options && options.all ? cb(null, [{ address, family }]) : cb(null, address, family)), err => cb(err));
  };
}
function refuse(sock, status, text) {
  if (sock.destroyed) return;
  sock.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export class ScreenRelay {
  /**
   * principal(req) → P (the session's person, or a guest); originAllowed(req); ticketFor(P, agentId) → { url, allowPrivate }
   * (refuses with { status } — chat.screenTicket); allowed(P, agentId) → whether they may still see it; refresh(sid) → P or
   * null (the session again, or ended).
   */
  constructor({ principal, originAllowed, ticketFor, allowed = () => true, refresh = null, log = null, perAccount = PER_ACCOUNT, max = MAX, resolve = resolvePublic, WS = WebSocket }) {
    Object.assign(this, { principal, originAllowed, ticketFor, allowed, refresh, log, perAccount, max, resolve, WS });
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false });
    this.open = new Set();   // { client, up, P, agent }
    this.dialing = new Map();   // account id → dials under way
  }
  count(accountId) { let n = this.dialing.get(accountId) || 0; for (const r of this.open) if (r.P.account.id === accountId) n++; return n; }
  /** The upgrade of a request to PATH. */
  async handle(req, sock, head) {
    sock.on('error', () => {});   // (the person's connection dropping while the provider is asked: nothing to do)
    let agent;
    try { agent = Number(new URL(req.url, 'http://x').searchParams.get('agent')); } catch { agent = NaN; }
    if (!this.originAllowed(req)) return refuse(sock, 403, 'Forbidden');
    const P = this.principal(req);
    if (!P || !P.account) return refuse(sock, 401, 'Unauthorized');
    if (!Number.isInteger(agent) || agent <= 0) return refuse(sock, 400, 'Bad Request');
    let total = 0; for (const n of this.dialing.values()) total += n;
    if (this.count(P.account.id) >= this.perAccount || this.open.size + total >= this.max) return refuse(sock, 429, 'Too Many Requests');
    const aid = P.account.id;
    this.dialing.set(aid, (this.dialing.get(aid) || 0) + 1);
    let up = null;
    const early = [], hold = (d, binary) => { early.push([d, binary]); };
    try {
      let t;
      try { t = await this.ticketFor(P, agent); }
      catch (e) { const st = [400, 401, 403, 404, 409, 501].includes(e.status) ? e.status : 502; return refuse(sock, st, st === 403 ? 'Forbidden' : st === 404 ? 'Not Found' : st === 502 ? 'Bad Gateway' : 'Refused'); }
      up = new this.WS(t.url, { perMessageDeflate: false, maxPayload: 4 * 1048576, handshakeTimeout: DIAL_MS, followRedirects: false, lookup: lookupFor(t.allowPrivate, this.resolve) });
      up.binaryType = 'nodebuffer';
      up.on('error', () => {});   // (each error is followed by its close, handled below)
      // (the provider speaks first — RFB's greeting — the moment it opens: kept until the viewer is there)
      up.on('message', hold);
      const ok = await new Promise(resolve => {
        up.once('open', () => resolve(true));
        up.once('error', () => resolve(false));
        up.once('unexpected-response', (rq, res) => { res.resume?.(); resolve(false); });
        up.once('close', () => resolve(false));
      });
      if (!ok || sock.destroyed) { try { up.terminate(); } catch { /* gone */ } return refuse(sock, 502, 'Bad Gateway'); }
    } finally {
      const n = (this.dialing.get(aid) || 1) - 1;
      if (n > 0) this.dialing.set(aid, n); else this.dialing.delete(aid);
    }
    this.wss.handleUpgrade(req, sock, head, client => { up.off('message', hold); this.pipe(client, up, P, agent, early); });
  }
  pipe(client, up, P, agent, early = []) {
    const r = { client, up, P, agent };
    this.open.add(r);
    let ended = false;
    for (const [d, binary] of early) if (binary) client.send(d, { binary: true });
    // (the provider closed while the viewer was being let in)
    if (up.readyState !== 1) { ended = true; this.open.delete(r); client.close(1011, 'the screen closed'); return; }
    const flow = (from, to) => {
      // (the side written to reads slowly: the other waits for it)
      if (to.bufferedAmount > HIGH && !from.isPaused) {
        from.pause();
        const t = setInterval(() => { if (to.readyState !== 1 || to.bufferedAmount < LOW) { clearInterval(t); if (from.readyState === 1) from.resume(); } }, 50);
        t.unref?.();
      }
    };
    up.on('message', (d, binary) => { if (!binary || client.readyState !== 1) return; client.send(d, { binary: true }); flow(up, client); });
    client.on('message', (d, binary) => {
      if (!binary) { this.end(r, 1003, 'RFB is binary'); return; }
      if (up.readyState === 1) { up.send(d, { binary: true }); flow(client, up); }
    });
    // (the provider's word passes on: 4000 control taken by another viewer, 4001 its screen stopped)
    up.on('close', (code, reason) => { if (ended) return; ended = true; this.open.delete(r); const c = code >= 4000 && code < 4500 || CLEAN.has(code) ? code : 1011; try { client.close(c, String(reason || '').slice(0, 100)); } catch { /* gone */ } });
    // (the person closed it: a clean close hands control back; a dropped link keeps it)
    client.on('close', code => { if (ended) return; ended = true; this.open.delete(r); try { if (CLOSED.has(code)) up.close(1000); else up.terminate(); } catch { /* gone */ } });
    client.on('error', () => {});
  }
  end(r, code, reason) {
    this.open.delete(r);
    try { r.client.close(code, reason); } catch { /* gone */ }
    try { r.up.close(1000); } catch { /* gone */ }
  }
  /** Sessions ended, or a person no longer allowed (their role, the provider's managers changed): their screens close. */
  recheck() {
    for (const r of [...this.open]) {
      let P = r.P;
      if (this.refresh && P.session) { P = this.refresh(P.session.id); if (P) r.P = P; }
      let ok = !!P;
      if (ok) { try { ok = this.allowed(P, r.agent); } catch { ok = false; } }
      if (!ok) this.end(r, 4403, 'no longer allowed');
    }
  }
  close() { for (const r of [...this.open]) this.end(r, 1001, 'server stopping'); this.wss.close(); }
}
