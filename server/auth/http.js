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

/** A session cookie: host-only, whole site, invisible to scripts, never sent cross-site. The __Host- one is HTTPS only
 *  (Secure); the plain one (secure false) is for a connection without HTTPS, where browsers drop Secure cookies. */
export function sessionCookie(name, value, maxAgeSec, secure = true) {
  return `${name}=${value}; Path=/;${secure ? ' Secure;' : ''} HttpOnly; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`;
}

/** The session cookie's name over plain HTTP: the __Host- name without its prefix (browsers refuse __Host- cookies
 *  that are not Secure). */
export function plainCookieName(name) {
  return String(name).replace(/^__Host-/, '') || 'mvw-session';
}

export class HttpPolicy {
  /**
   * @param {object} o
   * @param {string} [o.trustedProxies]  comma-separated addresses or subnets whose X-Forwarded-For and
   *                                      X-Forwarded-Proto are believed; default "none" (no proxy)
   * @param {string} [o.publicUrls]      comma-separated public addresses (MVW_PUBLIC_URL); when set, only their origins
   *                                      (and the loopback address) may send state-changing requests
   */
  constructor({ trustedProxies = 'none', publicUrls = '', localPeers = [], requireHttps = false } = {}) {
    // localPeers: peer addresses that count as this machine for plain-HTTP sign-in on localhost, like the loopback
    // address (the Docker image's default gateway, MVW_GATEWAY_IS_LOCAL; DECISIONS C105).
    this.localPeers = new Set(localPeers.map(normIp));
    // requireHttps (MVW_REQUIRE_HTTPS): signing in only over HTTPS or on this machine. Off by default: a self-hosted
    // world on a home network or a tailnet signs in over plain HTTP too, with a plain (not Secure) session cookie.
    this.requireHttps = !!requireHttps;
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
  /** Whether signing in (and the AI-app connector) is allowed on this request: a secure one, or any when HTTPS is not
   *  required. */
  canSignIn(req) {
    return !this.requireHttps || this.isSecure(req);
  }
  /** The session cookie for this request: the __Host- one (Secure) on a secure connection, else the plain one. Each
   *  connection reads only its own, so a cookie set over plain HTTP never counts on an HTTPS page. */
  cookieFor(req, name) {
    return this.isSecure(req) ? { name, secure: true } : { name: plainCookieName(name), secure: false };
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
