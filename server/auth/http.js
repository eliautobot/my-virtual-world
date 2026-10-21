// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// HTTP-level protection for accounts: cookies, client addresses behind trusted proxies, secure-request and Origin
// checks, and CSRF tokens. (Sign-in limits live in accounts.js, in the database.)
import crypto from 'node:crypto';
import net from 'node:net';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const normIp = ip => {
  const s = String(ip || '').trim();
  return s.startsWith('::ffff:') && net.isIPv4(s.slice(7)) ? s.slice(7) : s;
};
const isLoopbackIp = ip => /^127\./.test(ip) || ip === '::1';
function hostName(h) {
  h = String(h || '').toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const k = h.lastIndexOf(':');
  return k >= 0 ? h.slice(0, k) : h;
}
const lastValue = v => String(v || '').split(',').pop().trim().toLowerCase();

export function parseCookies(header) {
  const out = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const k = part.indexOf('=');
    if (k < 1) continue;
    const name = part.slice(0, k).trim();
    if (!(name in out)) out[name] = part.slice(k + 1).trim();
  }
  return out;
}

/** A __Host- session cookie: host-only, whole site, HTTPS only, invisible to scripts, never sent cross-site. */
export function sessionCookie(name, value, maxAgeSec) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`;
}

export class HttpPolicy {
  /**
   * @param {object} o
   * @param {string} [o.trustedProxies]  comma-separated addresses or subnets whose X-Forwarded-For and
   *                                      X-Forwarded-Proto are believed; default "none" (no proxy)
   * @param {string} [o.publicUrls]      comma-separated public addresses (MVW_PUBLIC_URL); when set, only their origins
   *                                      (and the loopback address) may send state-changing requests
   */
  constructor({ trustedProxies = 'none', publicUrls = '', localPeers = [] } = {}) {
    // localPeers: peer addresses that count as this machine for plain-HTTP sign-in on localhost, like the loopback
    // address (the Docker image's default gateway, MVW_GATEWAY_IS_LOCAL; DECISIONS C105).
    this.localPeers = new Set(localPeers.map(normIp));
    this.trusted = new net.BlockList();
    for (const t of String(trustedProxies).split(',').map(s => s.trim()).filter(s => s && s !== 'none')) {
      const [addr, bits] = t.split('/');
      const type = net.isIPv6(addr) ? 'ipv6' : net.isIPv4(addr) ? 'ipv4' : null;
      if (!type || (bits !== undefined && !/^\d{1,3}$/.test(bits))) throw new Error(`MVW_TRUSTED_PROXIES: not an address or subnet: ${t}`);
      if (bits !== undefined) this.trusted.addSubnet(addr, +bits, type); else this.trusted.addAddress(addr, type);
    }
    this.publicOrigins = new Set();
    for (const u of String(publicUrls).split(',').map(s => s.trim()).filter(Boolean)) {
      let o;
      try { o = new URL(u).origin; } catch { throw new Error(`MVW_PUBLIC_URL: not a URL: ${u}`); }
      if (o === 'null') throw new Error(`MVW_PUBLIC_URL: not an http(s) URL: ${u}`);
      this.publicOrigins.add(o);
    }
  }
  isTrusted(ip) {
    const t = net.isIP(ip);
    return t ? this.trusted.check(ip, t === 6 ? 'ipv6' : 'ipv4') : false;
  }
  peer(req) { return normIp(req.socket && req.socket.remoteAddress); }
  /** The client's address: the peer, or through trusted proxies the right-most untrusted X-Forwarded-For entry. */
  clientIp(req) {
    const peer = this.peer(req);
    if (!this.isTrusted(peer)) return peer;
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map(normIp).filter(s => net.isIP(s));
    for (let k = chain.length - 1; k >= 0; k--) if (!this.isTrusted(chain[k])) return chain[k];
    return chain[0] || peer;
  }
  /** http or https as the browser sees it (X-Forwarded-Proto only from a trusted proxy). */
  scheme(req) {
    if (req.socket && req.socket.encrypted) return 'https';
    if (this.isTrusted(this.peer(req))) {
      const p = lastValue(req.headers['x-forwarded-proto']);
      if (p === 'https' || p === 'http') return p;
    }
    return 'http';
  }
  /** Whether a browser keeps Secure cookies from this request: HTTPS, or http://localhost / 127.0.0.1 / [::1]. */
  isSecure(req) {
    if (this.scheme(req) === 'https') return true;
    const peer = this.peer(req);
    return (isLoopbackIp(peer) || this.localPeers.has(peer)) && LOOPBACK_HOSTS.has(hostName(req.headers.host)) && !req.headers['x-forwarded-for'];
  }
  /** Same-origin check for state-changing requests and WebSocket upgrades. Requests without an Origin header (tools)
   *  pass; for them the session's CSRF token is the protection. */
  originAllowed(req) {
    if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    let o;
    try { o = new URL(origin).origin; } catch { return false; }
    if (o === 'null') return false;
    if (this.publicOrigins.has(o)) return true;
    const host = String(req.headers.host || '').toLowerCase();
    if (!host || o !== new URL(`${this.scheme(req)}://${host}`).origin) return false;
    return !this.publicOrigins.size || LOOPBACK_HOSTS.has(hostName(host));
  }
}

/** Whether the request carries the session's CSRF token in X-CSRF-Token. */
export function csrfOk(req, expected) {
  const got = Buffer.from(String(req.headers['x-csrf-token'] || '')), want = Buffer.from(String(expected || ''));
  return want.length > 0 && got.length === want.length && crypto.timingSafeEqual(got, want);
}
