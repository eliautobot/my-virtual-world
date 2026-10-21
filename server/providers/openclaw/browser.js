// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An OpenClaw gateway's own browser - the one its agents browse with - in the chat window's side panel
// (docs/features/agent-providers.md §4), as OpenClaw's Control UI shows it beside a chat: its tabs, the page live, and the
// person's clicks, typing and scrolling on it. Everything goes through the gateway's browser.request (operator.admin), with
// the routes and actions the Control UI uses; nothing here runs a script of the page's or the person's choosing (scrolling
// and history are fixed functions with numbers in them). The live picture: the gateway's screencast - a WebSocket on its
// HTTP address, opened with a short-lived token minted on this connection, carrying a JSON header (url, cssWidth,
// cssHeight) and a JPEG for each change of the page. One per tab, shared by everyone watching it, held while someone asks
// for frames (a lease) and closed after.
import WebSocket from 'ws';

const VIEW_MAX = { maxWidth: 1280, maxHeight: 900 };   // the frames' size at most (the gateway scales the page down to it)
const LEASE_MS = 15000;     // a screencast nobody asked a frame of for this long is closed
const WAIT_MAX_MS = 4000;   // a request for the next frame waits at most this long (it answers "no change" then)
const URL_MAX = 2048;
const TEXT_MAX = 2000;
/** The keys a person may press on the page, by name (anything else is typed as text). OpenClaw's Control UI's set. */
export const KEYS = new Set(['Enter', 'Backspace', 'Delete', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const TARGET = /^[\w-]{1,128}$/;

/** A tab as the panel shows it. */
function tabOf(t) {
  if (!t || typeof t.targetId !== 'string' || !TARGET.test(t.targetId)) return null;
  return { id: t.targetId, title: String(t.title || '').slice(0, 300), url: String(t.url || '').slice(0, URL_MAX),
    ...(t.urlUnavailableReason === 'navigation_blocked' || t.urlUnavailableReason === 'navigation_check_failed' ? { blocked: t.urlUnavailableReason } : {}) };
}
function target(id) { if (typeof id !== 'string' || !TARGET.test(id)) throw fail('bad_request', 'Which tab?'); return id; }
function webUrl(u, blank = false) {
  const s = String(u || '').trim();
  if (blank && (!s || s === 'about:blank')) return 'about:blank';   // (a new, empty tab)
  if (!s || s.length > URL_MAX) throw fail('bad_request', 'Enter an address');
  const full = /^[a-z][a-z\d+.-]*:/i.test(s) ? s : `https://${s}`;
  let x; try { x = new URL(full); } catch { throw fail('bad_request', 'That is not a web address'); }
  if (x.protocol !== 'http:' && x.protocol !== 'https:') throw fail('bad_request', 'Only web addresses (http and https) open here');
  return x.href;
}
const num = (v, lo, hi) => { const n = Number(v); if (!Number.isFinite(n)) throw fail('bad_request', 'Not a number'); return Math.min(hi, Math.max(lo, n)); };

export class LinkBrowser {
  /** @param {import('./link.js').GatewayLink} link  @param {{ origin: () => string|null, socket?: (url: string) => WebSocket }} o */
  constructor(link, { origin, socket = url => new WebSocket(url, { perMessageDeflate: false }) }) {
    Object.assign(this, { link, origin, socket });
    this.casts = new Map();   // tab id → { ws, frame: { seq, head, jpeg }, waiters, until, closed }
    this.seq = 0;
    this.sweeper = null;
  }
  /** Whether this connection may use the gateway's browser: the gateway offers it, and grants this device operator.admin. */
  available() {
    if (!this.link.offers('browser.request')) return { available: false, reason: 'This gateway has no browser.' };
    if (!this.link.grants('operator.admin')) return { available: false, reason: 'This connection is set up for chat only: the agents\' browser needs Full access (Agent Providers → its settings).' };
    return { available: true };
  }
  need() { const a = this.available(); if (!a.available) throw fail('forbidden', a.reason); }
  /** A browser.request; the gateway refusing the request itself (a closed tab, an address its rules block) is said as
   *  such - not as the gateway failing. */
  async req(method, path, body) {
    this.need();
    try { return await this.link.request('browser.request', { method, path, ...(body ? { body } : {}) }, { timeoutMs: 30000 }); }
    catch (e) {
      if (e.code !== 'INVALID_REQUEST') throw e;
      if (/tab not found/i.test(e.message)) throw fail('not_found', 'This tab is no longer open');
      if (e.details && e.details.reason === 'navigation_blocked' || /navigation blocked/i.test(e.message)) throw fail('bad_request', 'The browser\'s navigation rules block this address');
      throw fail('bad_request', e.message);
    }
  }

  /** The browser's tabs: { available, running, tabs, view? } - view: the last frame's address and size of a watched tab. */
  async state({ tab = null } = {}) {
    const a = this.available();
    if (!a.available) return { ...a, running: false, tabs: [] };
    const r = await this.req('GET', '/tabs');
    const c = tab && this.casts.get(tab), f = c && c.frame;
    return { available: true, running: !!(r && r.running), tabs: (r && Array.isArray(r.tabs) ? r.tabs : []).map(tabOf).filter(Boolean).slice(0, 50),
      ...(f ? { view: { url: f.head.url, cssWidth: f.head.cssWidth, cssHeight: f.head.cssHeight, seq: f.seq } } : {}) };
  }
  /** One of the panel's actions, checked field by field. */
  async act(p) {
    const a = String(p.action || '');
    if (a === 'start') { await this.req('POST', '/start', {}); return { ok: true }; }
    if (a === 'open') { const t = tabOf(await this.req('POST', '/tabs/open', { url: webUrl(p.url, true) })); return { ok: true, ...(t ? { tab: t } : {}) }; }
    const id = target(p.tab);
    if (a === 'focus') { await this.req('POST', '/tabs/focus', { targetId: id }); return { ok: true }; }
    if (a === 'close') { await this.req('DELETE', `/tabs/${encodeURIComponent(id)}`); this.drop(id); return { ok: true }; }
    if (a === 'navigate') { const r = await this.req('POST', '/navigate', { targetId: id, url: webUrl(p.url) }); return { ok: true, url: String((r && r.url) || '') }; }
    if (a === 'reload') { const c = this.casts.get(id), url = (c && c.frame && c.frame.head.url) || p.url; await this.req('POST', '/navigate', { targetId: id, url: webUrl(url) }); return { ok: true }; }
    if (a === 'back' || a === 'forward') {
      // (going back leaves the page the function ran in: the browser reports it gone - the navigation it asked for)
      try { await this.evaluate(id, `() => { history.go(${a === 'back' ? -1 : 1}); return true; }`); }
      catch (e) { if (!/Execution context was destroyed|because of a navigation/i.test(e.message)) throw e; }
      return { ok: true };
    }
    if (a === 'scroll') { await this.evaluate(id, `() => { window.scrollBy(${Math.round(num(p.dx || 0, -5000, 5000))}, ${Math.round(num(p.dy || 0, -5000, 5000))}); return true; }`); return { ok: true }; }
    if (a === 'click') {
      // (where on the picture, as fractions of it: the page's own size from its latest frame)
      const c = this.casts.get(id), head = c && c.frame && c.frame.head;
      if (!head) throw fail('bad_request', 'The page is not showing yet');
      const x = Math.round(num(p.fx, 0, 1) * head.cssWidth), y = Math.round(num(p.fy, 0, 1) * head.cssHeight);
      await this.req('POST', '/act', { kind: 'clickCoords', targetId: id, x, y, ...(p.double === true ? { doubleClick: true } : {}) });
      return { ok: true };
    }
    if (a === 'key') { if (!KEYS.has(p.key)) throw fail('bad_request', 'Not a key the page takes'); await this.req('POST', '/act', { kind: 'press', targetId: id, key: p.key }); return { ok: true }; }
    if (a === 'text') {
      const text = String(p.text || '');
      if (!text || text.length > TEXT_MAX) throw fail('bad_request', `Type 1 to ${TEXT_MAX} characters at a time`);
      await this.req('POST', '/act', { kind: 'insertText', targetId: id, text }); return { ok: true };
    }
    throw fail('bad_request', 'Not something the browser does');
  }
  async evaluate(id, fn) {
    try { await this.req('POST', '/act', { kind: 'evaluate', targetId: id, fn }); }
    catch (e) { if (/evaluateEnabled=false|ACT_EVALUATE_DISABLED/.test(`${e.message} ${JSON.stringify(e.details || {})}`)) throw fail('forbidden', 'The gateway\'s browser settings do not allow this (browser.evaluateEnabled is off)'); throw e; }
  }

  // ---------------------------------------------------------------- the live picture
  /**
   * The tab's next picture after `after` (a sequence number; 0: the latest there is): { seq, head, jpeg (base64) }, or
   * { seq } when nothing changed within the wait. Asking keeps the screencast open (a lease); the first ask opens it.
   */
  async frame({ tab, after = 0, waitMs = WAIT_MAX_MS }) {
    this.need();
    const id = target(tab), c = await this.cast(id);
    c.until = Date.now() + LEASE_MS;
    const out = f => (f && f.seq > after ? { seq: f.seq, head: f.head, jpeg: f.jpeg.toString('base64') } : { seq: f ? f.seq : 0 });
    if (c.frame && c.frame.seq > after) return out(c.frame);
    return new Promise(resolve => {
      const w = { resolve: f => { clearTimeout(w.timer); resolve(out(f)); } };
      w.timer = setTimeout(() => { c.waiters.delete(w); resolve(out(c.frame)); }, Math.min(WAIT_MAX_MS, Math.max(0, Number(waitMs) || 0)));
      c.waiters.add(w);
    });
  }
  /** The tab's screencast, opened if need be. */
  async cast(id) {
    let c = this.casts.get(id);
    if (c && !c.closed) return c.ready;
    c = { frame: c && c.frame, waiters: c ? c.waiters : new Set(), until: Date.now() + LEASE_MS, closed: false, ws: null };
    this.casts.set(id, c);
    c.ready = (async () => {
      const r = await this.req('POST', '/screencast', { targetId: id, ...VIEW_MAX });
      const base = this.origin();
      if (!r || typeof r.wsPath !== 'string' || !r.wsPath.startsWith('/') || !base) throw fail('unavailable', 'The gateway sent no live picture');
      const url = new URL(r.wsPath.replace(/^\/+/, ''), base.endsWith('/') ? base : `${base}/`);   // (under the gateway's own path, behind a proxy too)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = c.ws = this.socket(url.href);
      ws.on('message', (d, binary) => {
        if (!binary || !Buffer.isBuffer(d) || d.length < 8) return;   // (ready, meta, error: the tabs' state says the same)
        const n = d.readUInt32BE(0);
        if (n <= 0 || n > 4096 || d.length < 4 + n + 3) return;
        let head; try { head = JSON.parse(d.subarray(4, 4 + n).toString('utf8')); } catch { return; }
        if (!Number.isFinite(head.cssWidth) || !Number.isFinite(head.cssHeight) || head.cssWidth <= 0 || head.cssHeight <= 0) return;
        c.frame = { seq: ++this.seq, head: { url: String(head.url || '').slice(0, URL_MAX), cssWidth: head.cssWidth, cssHeight: head.cssHeight }, jpeg: d.subarray(4 + n) };
        for (const w of c.waiters) w.resolve(c.frame);
        c.waiters.clear();
      });
      ws.on('close', () => { c.closed = true; for (const w of c.waiters) w.resolve(c.frame); c.waiters.clear(); });
      ws.on('error', () => { /* closed next */ });
      await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); ws.once('close', () => reject(fail('unavailable', 'The live picture closed'))); });
      this.sweep();
      return c;
    })();
    c.ready.catch(() => { c.closed = true; if (this.casts.get(id) === c) this.casts.delete(id); });
    return c.ready;
  }
  /** Closes the screencasts nobody watches any more (checked every few seconds while any is open). */
  sweep() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [id, c] of this.casts) if (c.closed || c.until < now) this.drop(id);
      if (!this.casts.size) { clearInterval(this.sweeper); this.sweeper = null; }
    }, 3000);
    this.sweeper.unref?.();
  }
  drop(id) {
    const c = this.casts.get(id);
    if (!c) return;
    this.casts.delete(id);
    c.closed = true;
    for (const w of c.waiters) w.resolve(c.frame);
    try { c.ws?.close(); } catch { /* gone */ }
  }
  onDown() { for (const id of [...this.casts.keys()]) this.drop(id); }
}
