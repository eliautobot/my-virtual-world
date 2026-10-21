// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The built-in browser's way out (docs/features/agent-pc.md §5; ./chrome.js): every connection the agents' Chrome makes
// goes through this proxy on this machine's loopback — Chrome is started with it and nothing bypasses it, its own
// loopback included — and reaches the public internet only. A name is resolved HERE and the connection goes to the very
// address that was checked (a name that turns into a private address between check and connection can't), the same rule
// as the reader's (./browser.js blockedIp, publicLookup). HTTPS and WebSockets are tunnelled (CONNECT), plain HTTP is
// forwarded; anything to a private, local or cloud-metadata address is refused with 403. A cap on open connections; idle
// ones are closed.
import http from 'node:http';
import net from 'node:net';
import { blockedIp, publicLookup } from './browser.js';

const MAX_SOCKETS = 512, IDLE_MS = 120000;
const HOP = new Set(['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

/** The public address a host name (or literal) connects to — or an error (code 'blocked') when it isn't public. */
export function resolvePublic(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  if (!h || /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(h)) return Promise.reject(Object.assign(new Error('not public'), { code: 'blocked' }));
  if (net.isIP(h)) return blockedIp(h) ? Promise.reject(Object.assign(new Error('not public'), { code: 'blocked' })) : Promise.resolve({ address: h, family: net.isIP(h) });
  return new Promise((resolve, reject) => publicLookup(h, {}, (err, address, family) => (err ? reject(err) : resolve({ address, family }))));
}

export class EgressProxy {
  /** log: the server's; resolve: the address check (tests give their own). */
  constructor({ log = null, resolve = resolvePublic } = {}) {
    this.log = log; this.resolve = resolve;
    this.open = new Set();
    this.refused = 0;
    this.server = http.createServer((req, res) => this.forward(req, res));
    this.server.on('connect', (req, sock, head) => this.tunnel(req, sock, head));
    this.server.on('upgrade', (req, sock, head) => this.upgrade(req, sock, head));
    this.server.on('clientError', (e, sock) => { try { sock.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* gone */ } });
  }
  /** Listens on the loopback, on a free port: its address for Chrome's --proxy-server. */
  listen() {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.port = this.server.address().port; resolve(`http://127.0.0.1:${this.port}`); });
    });
  }
  close() { for (const s of this.open) s.destroy(); this.open.clear(); return new Promise(r => this.server.close(() => r())); }
  track(s) {
    if (this.open.size >= MAX_SOCKETS) { s.destroy(); return false; }
    this.open.add(s); s.setTimeout?.(IDLE_MS, () => s.destroy());
    s.on('close', () => this.open.delete(s));
    s.on('error', () => s.destroy());
    return true;
  }
  refuse(sock, why) {
    this.refused++;
    try { sock.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\n${why}`); } catch { /* gone */ }
  }
  /** HTTPS, secure WebSockets — anything tunnelled: CONNECT host:port. */
  async tunnel(req, sock, head) {
    if (!this.track(sock)) return;
    const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(String(req.url || ''));
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) return this.refuse(sock, 'bad address');
    let at;
    try { at = await this.resolve(m[1]); } catch { return this.refuse(sock, 'That address is not on the public internet'); }
    const up = net.connect({ host: at.address, port: Number(m[2]) });
    if (!this.track(up)) { sock.destroy(); return; }
    up.once('connect', () => {
      sock.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head?.length) up.write(head);
      up.pipe(sock); sock.pipe(up);
    });
    up.once('error', () => { try { sock.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch { /* gone */ } });
    sock.once('close', () => up.destroy());
  }
  /** Plain HTTP: the request (an absolute address) forwarded to the address checked, its answer streamed back. */
  async forward(req, res) {
    if (!this.track(req.socket)) return;
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    if (u.protocol !== 'http:') { res.writeHead(400).end(); return; }
    let at;
    try { at = await this.resolve(u.hostname); } catch { this.refused++; res.writeHead(403, { 'content-type': 'text/plain' }).end('That address is not on the public internet'); return; }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
    const up = http.request({ host: at.address, family: at.family, port: u.port || 80, method: req.method, path: `${u.pathname}${u.search}`, headers, setHost: false }, r => {
      const out = {};
      for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k)) out[k] = v;
      res.writeHead(r.statusCode || 502, out);
      r.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502).end(); else res.destroy(); });
    req.pipe(up);
  }
  /** A WebSocket over plain HTTP (ws://): the same check, then the bytes both ways. */
  async upgrade(req, sock, head) {
    if (!this.track(sock)) return;
    let u;
    try { u = new URL(req.url); } catch { return this.refuse(sock, 'bad address'); }
    let at;
    try { at = await this.resolve(u.hostname); } catch { return this.refuse(sock, 'That address is not on the public internet'); }
    const up = net.connect({ host: at.address, port: Number(u.port) || 80 });
    if (!this.track(up)) { sock.destroy(); return; }
    up.once('connect', () => {
      const lines = [`${req.method} ${u.pathname}${u.search} HTTP/1.1`];
      for (let k = 0; k < req.rawHeaders.length; k += 2) if (!/^proxy-/i.test(req.rawHeaders[k])) lines.push(`${req.rawHeaders[k]}: ${req.rawHeaders[k + 1]}`);
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(sock); sock.pipe(up);
    });
    up.once('error', () => sock.destroy());
  }
}
