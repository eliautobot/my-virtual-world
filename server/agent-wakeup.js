// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A connected agent's wake-up link (2026-10-11). An outside AI thinks only while its own platform runs it: when its owner
// talks to it there, or on a timer. Many platforms can also start it when a web address is called (Grok Bot's webhook
// routines, n8n, Zapier, Make, a script of one's own). Its owner pastes that address here - with the key and header the
// platform gave, if any - and the world calls it when something is waiting for the agent and it isn't already at work:
// its owner's messages, others' (friends, visitors, other agents), a problem of its own (rent, money, a home, a job), as its
// owner chooses. The call carries nothing private: { type, reason, waiting, at }. The words themselves wait in its inbox
// behind its signed door, so a leaked link can only wake it for nothing.
// Limits: one call per gap (the first ones gathered for a few seconds), at most N an hour (its owner's choice, never
// above the admin's), only https on the public internet (checked again on every connection), no redirects followed, a
// 10-second answer; five failures in a row pause the link and its owner is told. Setting, changing or removing the
// link asks for the password again (routes.js) and its owner is told. The address, key and header are sealed at rest
// (server/secret-holders.js) and are never shown again: only the host.
// The agent may also set it itself (2026-10-12), when its platform shows IT the address (its own webhook, a program of its
// own): through its door (MCP wake_up, POST /api/agent-api/wakeup, the kit's `wakeup set`). The world calls the address
// once first and keeps it only if it answers - a made-up address is never saved - at most a few times a day; its owner
// is told each time and removes it in its Studio. (Grok Bot can't: only its owner sees a routine's address and key.)
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { guardedLookup, privateAddress } from './providers/models.js';
import { aadWakeup } from './secret-holders.js';
import { AgentApiError } from './agent-api.js';

export const WAKEUP_LIMITS = Object.freeze({
  gatherMs: 3000,        // the first wake-ups of a burst are gathered into one call
  gapMs: 60000,          // at most one call a minute: it is starting
  failsToPause: 5,       // failures in a row before the link is paused
  timeoutMs: 10000,
  urlMax: 1000,
  keyMax: 1000,
  perHourMax: 60,
  perHourDefault: 6,
  giveUpMs: 6 * 3600000,  // a wake-up waiting this long (the hour's calls used again and again) is let go
  agentSetsPerDay: 5,     // the agent setting or removing its own link: at most this many times a day
});
/** What may wake it: its owner's messages, others' (friends, visitors, other agents), a problem of its own. */
export const WAKEUP_EVENTS = ['owner', 'others', 'problems'];
// headers a caller may not set: they would change how the request itself is carried
const BAD_HEADERS = new Set(['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'cookie',
  'expect', 'keep-alive', 'proxy-authorization', 'proxy-connection', 'user-agent']);
const bad = (status, code, message) => new AgentApiError(status, code, message);
const HOUR = 3600000;

export class WakeUps {
  /**
   * store: { db, worldId }; box: the SecretBox; agentApi: the slots (ownership, whether it is at work); setting(path);
   * notify(slot, text): its owner hears of it; allowLocal: tests only (a receiver on this machine over http);
   * request(url, { headers, body, local }) → { status }: replaces the HTTP call in unit tests; waiting(slot id) → how many
   * messages wait unread for it (its chat and its friends'; default: its chat only).
   */
  constructor({ store, box, agentApi, setting = () => undefined, notify = null, log = null, now = () => Date.now(), allowLocal = false, request = null, waiting = null }) {
    Object.assign(this, { store, box, agentApi, setting, notifyFn: notify, logFn: log, now, allowLocal, request: request || post, waitingFn: waiting });
    const db = store.db; this.w = store.worldId;
    this.q = {
      get: db.prepare('SELECT * FROM agent_wakeups WHERE world_id = ? AND slot_id = ?'),
      put: db.prepare(`INSERT INTO agent_wakeups (world_id, slot_id, sealed, host, events, per_hour, fails, paused, updated) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
        ON CONFLICT (world_id, slot_id) DO UPDATE SET sealed = excluded.sealed, host = excluded.host, events = excluded.events, per_hour = excluded.per_hour, fails = 0, paused = 0, updated = excluded.updated`),
      prefs: db.prepare('UPDATE agent_wakeups SET events = ?, per_hour = ?, fails = 0, paused = 0, updated = ? WHERE world_id = ? AND slot_id = ?'),
      del: db.prepare('DELETE FROM agent_wakeups WHERE world_id = ? AND slot_id = ?'),
      result: db.prepare('UPDATE agent_wakeups SET sent = ?, last_at = ?, last_ok = ?, last_status = ?, fails = ?, paused = ? WHERE world_id = ? AND slot_id = ?'),
    };
    this.pending = new Map();   // slot id → { timer, n, reasons }
    this.agentSets = new Map(); // slot id → when the agent set or removed its own link (the last day)
  }

  // ------------------------------------------------------------------------------------------------ what its owner sees
  /** The admin's ceiling on calls an hour for each agent. */
  cap() { const n = Number(this.setting('connected.wakePerHour')); return Number.isInteger(n) && n > 0 ? Math.min(n, WAKEUP_LIMITS.perHourMax) : 12; }
  /** Whether wake-up links work at all here (the admin's switches). */
  enabled() { return this.setting('connected.wakeEnabled') !== false && this.setting('connected.enabled') !== false; }
  /** A slot's wake-up link as its owner sees it: never the address, key or header, only the host. */
  view(slotId) {
    const r = this.q.get.get(this.w, slotId), cap = this.cap();
    if (!r) return { set: false, cap, enabled: this.enabled() };
    return { set: true, host: r.host, events: this.events(r), perHour: r.per_hour, cap, enabled: this.enabled(), paused: !!r.paused,
      sentLastHour: this.sent(r).length, last: r.last_at ? { at: r.last_at, ok: !!r.last_ok, status: r.last_status || null } : null };
  }
  events(r) { let e = {}; try { e = JSON.parse(r.events || '{}'); } catch { e = {}; } return Object.fromEntries(WAKEUP_EVENTS.map(k => [k, e[k] !== false])); }
  sent(r) { let l = []; try { l = JSON.parse(r.sent || '[]'); } catch { l = []; } const from = this.now() - HOUR; return l.filter(t => Number(t) > from); }

  /** The address, key and header its owner pasted, checked: { url, key, header, host, local }. */
  check({ url, key = '', header = '' }) {
    const u0 = String(url ?? '').trim();
    if (!u0) throw bad(400, 'bad_wakeup', 'Paste the address its platform gave you');
    if (u0.length > WAKEUP_LIMITS.urlMax) throw bad(400, 'bad_wakeup', 'That address is too long');
    let u; try { u = new URL(u0); } catch { throw bad(400, 'bad_wakeup', 'That is not a web address'); }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const local = this.allowLocal && (host === '127.0.0.1' || host === 'localhost');
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw bad(400, 'bad_wakeup', 'The address must start with https://');
    if (u.username || u.password) throw bad(400, 'bad_wakeup', 'The address can\'t carry a user name or password: put the key in the key field');
    if (!local && (host === 'localhost' || (net.isIP(host) && privateAddress(host)))) throw bad(400, 'bad_wakeup', 'The address is not on the public internet');
    let k = String(key ?? '').trim(), h = String(header ?? '').trim();
    // the header as its platform shows it, a whole line ("Authorization: Bearer …"): that line is what is sent
    const line = /^([A-Za-z0-9][A-Za-z0-9-]{0,63})\s*:\s*(\S.*)$/.exec(h);
    if (line) { h = line[1]; k = line[2].trim(); }
    else if (!h && k) { h = 'Authorization'; if (!/\s/.test(k)) k = `Bearer ${k}`; }   // a key alone: the usual "Authorization: Bearer <key>"
    if (k.length > WAKEUP_LIMITS.keyMax) throw bad(400, 'bad_wakeup', 'That key is too long');
    if (/[\u0000-\u001f\u007f]/.test(k)) throw bad(400, 'bad_wakeup', 'The key holds characters a header can\'t carry');
    if (h && (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(h) || BAD_HEADERS.has(h.toLowerCase()))) throw bad(400, 'bad_wakeup', 'That header name can\'t be used');
    if (h && !k) throw bad(400, 'bad_wakeup', 'A header needs its key');
    return { url: u.href, key: k, header: h, host: u.host, local };
  }
  prefsOf(body, r) {
    const was = r ? this.events(r) : Object.fromEntries(WAKEUP_EVENTS.map(k => [k, true]));
    const e = body.events && typeof body.events === 'object' ? body.events : {};
    const events = Object.fromEntries(WAKEUP_EVENTS.map(k => [k, typeof e[k] === 'boolean' ? e[k] : was[k]]));
    let per = body.perHour === undefined ? (r ? r.per_hour : WAKEUP_LIMITS.perHourDefault) : Number(body.perHour);
    if (!Number.isInteger(per) || per < 1 || per > WAKEUP_LIMITS.perHourMax) throw bad(400, 'bad_wakeup', `Calls an hour: a whole number from 1 to ${WAKEUP_LIMITS.perHourMax}`);
    return { events, per };
  }

  /** Its owner sets, changes or removes the link (url '' removes it), or only what wakes it and how often (no url). */
  set(account, slotId, body = {}, { ip = null } = {}) {
    const slot = this.agentApi.ownSlot(account, slotId), r = this.q.get.get(this.w, slot.id), now = this.now();
    if (body.url === '' || body.remove === true) {
      if (!r) throw bad(409, 'no_wakeup', 'It has no wake-up link');
      this.q.del.run(this.w, slot.id); this.cancel(slot.id);
      this.audit('agent.wakeup_removed', account, slot, ip, { host: r.host });
      this.tell(slot, `The wake-up link of ${slot.name} was removed: the world no longer starts its AI.`);
      return this.view(slot.id);
    }
    const p = this.prefsOf(body, r);
    if (body.url !== undefined) {
      const c = this.check(body);
      this.box.remember?.(c.url); this.box.remember?.(c.key);   // (never written to a log)
      const sealed = this.box.seal(JSON.stringify({ url: c.url, key: c.key, header: c.header }), aadWakeup(this.w, slot.id));
      this.q.put.run(this.w, slot.id, sealed, c.host, JSON.stringify(p.events), p.per, now);
      this.audit('agent.wakeup_set', account, slot, ip, { host: c.host, changed: !!r });
      this.tell(slot, `${slot.name} has ${r ? 'a new' : 'a'} wake-up link (${c.host}): the world calls it when something is waiting for its AI. If you didn't set this, remove it in its Agent Studio (Brain tab).`);
    } else {
      if (!r) throw bad(409, 'no_wakeup', 'Paste the address its platform gave you first');
      this.q.prefs.run(JSON.stringify(p.events), p.per, now, this.w, slot.id);
      this.audit('agent.wakeup_prefs', account, slot, ip, { events: p.events, perHour: p.per });
    }
    return this.view(slot.id);
  }
  /** Its owner tries the link once: { ok, status, error }. Counts against the hour like any call. */
  async test(account, slotId) {
    const slot = this.agentApi.ownSlot(account, slotId), r = this.q.get.get(this.w, slot.id);
    if (!r) throw bad(409, 'no_wakeup', 'It has no wake-up link');
    if (this.sent(r).length >= Math.min(r.per_hour, this.cap())) throw bad(429, 'wakeup_limit', 'It was woken as often as it may be this hour: try again later');
    const out = await this.send(slot, 'test', 0, { test: true });
    return { ...out, wakeUp: this.view(slot.id) };
  }

  // ------------------------------------------------------------------------------------------------ the agent itself
  /** The agent sets its own link (its platform showed it the address) or removes it: { url, key, header } | { remove }.
   *  slot: the agent's own (its door checked it). The address is called once first and saved only if it answers 2xx;
   *  what wakes it and how often stay its owner's choice. → { wakeUp, test? } */
  async setByAgent(slot, body = {}, { ip = null } = {}) {
    if (!this.enabled()) throw bad(403, 'wakeup_off', 'Wake-up links are turned off on this world');
    const now = this.now(), day = (this.agentSets.get(slot.id) || []).filter(t => t > now - 24 * HOUR);
    if (day.length >= WAKEUP_LIMITS.agentSetsPerDay) throw bad(429, 'too_soon', 'You changed your wake-up link as often as you may today: try again tomorrow, or ask your owner');
    const r = this.q.get.get(this.w, slot.id), actor = { id: slot.account_id, login: null };
    if (body.remove === true || body.url === '') {
      if (!r) throw bad(409, 'no_wakeup', 'You have no wake-up link');
      this.agentSets.set(slot.id, [...day, now]);
      this.q.del.run(this.w, slot.id); this.cancel(slot.id);
      this.audit('agent.wakeup_removed', actor, slot, ip, { host: r.host, by: 'agent' });
      this.tell(slot, `${slot.name} removed its own wake-up link: the world no longer starts its AI.`);
      return { wakeUp: this.view(slot.id) };
    }
    const c = this.check(body);
    if (r && this.sent(r).length >= Math.min(r.per_hour, this.cap())) throw bad(429, 'wakeup_limit', 'Your wake-up link was called as often as it may be this hour: try again later');
    this.agentSets.set(slot.id, [...day, now]);
    // the trial call: an address that doesn't answer (a guess, a typo, a wrong key) is not kept
    const tried = await this.ring(c, { type: 'mvw.wakeup', reason: 'test', waiting: 0, at: new Date(now).toISOString(), test: true });
    this.note(`[wakeup] slot ${slot.id} set by the agent: ${tried.ok ? `ok ${tried.status}` : tried.error}`);
    if (!tried.ok) throw bad(400, 'wakeup_failed', `The address didn't answer the trial call (${tried.error}), so it was not saved. Give only an address your platform showed you, with its key`);
    const p = this.prefsOf({}, r);
    this.box.remember?.(c.url); this.box.remember?.(c.key);
    this.q.put.run(this.w, slot.id, this.box.seal(JSON.stringify({ url: c.url, key: c.key, header: c.header }), aadWakeup(this.w, slot.id)), c.host, JSON.stringify(p.events), p.per, now);
    const sent = r ? [...this.sent(r), now] : [now];
    this.q.result.run(JSON.stringify(sent), now, 1, String(tried.status), 0, 0, this.w, slot.id);
    this.audit('agent.wakeup_set', actor, slot, ip, { host: c.host, changed: !!r, by: 'agent' });
    this.tell(slot, `${slot.name} set its own wake-up link (${c.host}) and the trial call worked: the world calls it when something is waiting for its AI. If you didn't expect this, remove it in its Agent Studio (Brain tab).`);
    return { wakeUp: this.view(slot.id), test: { ok: true, status: tried.status } };
  }

  // ------------------------------------------------------------------------------------------------ waking it
  /** Something is waiting for it (agent-api.js wake with a reason). A wake-up is never dropped for timing: while it is at
   *  work, within a minute of the last call or when the hour's calls are used, it waits, then looks again - and calls only
   *  if something is still unread (it may have read it while it was at work). */
  trigger(slotId, reason) {
    if (!WAKEUP_EVENTS.includes(reason) || !this.enabled()) return false;
    const r = this.q.get.get(this.w, slotId);
    if (!r || r.paused || !this.events(r)[reason]) return false;
    const slot = this.agentApi.q.slot.get(this.w, slotId);
    if (!slot || slot.status !== 'active' || !slot.approved_at) return false;
    const p = this.pending.get(slotId);
    if (p) { p.n++; p.reasons.add(reason); return true; }
    const wait = Math.max(WAKEUP_LIMITS.gatherMs, (r.last_at || 0) + WAKEUP_LIMITS.gapMs - this.now(), this.agentApi.busyFor(slotId) + 1000);
    this.schedule(slotId, { n: 1, reasons: new Set([reason]), since: this.now() }, wait);
    return true;
  }
  schedule(slotId, entry, wait) {
    entry.timer = setTimeout(() => { this.fire(slotId).catch(e => this.note(`[wakeup] slot ${slotId}: ${e.message}`)); }, Math.max(0, wait));
    entry.timer.unref?.();
    this.pending.set(slotId, entry);
  }
  async fire(slotId) {
    const p = this.pending.get(slotId); this.pending.delete(slotId);
    if (!p || !this.enabled()) return null;
    const r = this.q.get.get(this.w, slotId), slot = this.agentApi.q.slot.get(this.w, slotId), now = this.now();
    if (!r || r.paused || !slot || slot.status !== 'active' || !slot.approved_at) return null;
    if (now - p.since > WAKEUP_LIMITS.giveUpMs) { this.note(`[wakeup] slot ${slotId}: gave up after waiting ${Math.round((now - p.since) / 60000)} min`); return null; }
    // still at work: look again when it has gone quiet
    const busy = this.agentApi.busyFor(slotId);
    if (busy > 0) { this.schedule(slotId, p, busy + 1000); return null; }
    // it read everything while it was at work (a problem of its own stays until it is dealt with: that always wakes it)
    const waiting = this.waitingFn ? this.waitingFn(slotId) : this.agentApi.waitingMessages(slotId);
    if (!p.reasons.has('problems') && waiting === 0) return null;
    // within a minute of the last call, or the hour's calls are used: wait for the next free one
    const gapLeft = (r.last_at || 0) + WAKEUP_LIMITS.gapMs - now;
    if (gapLeft > 0) { this.schedule(slotId, p, gapLeft); return null; }
    const sent = this.sent(r);
    if (sent.length >= Math.min(r.per_hour, this.cap())) {
      if (r.last_status !== 'limit') this.q.result.run(r.sent, r.last_at, r.last_ok, 'limit', r.fails, r.paused, this.w, slotId);
      this.schedule(slotId, p, Math.min(...sent) + HOUR - now + 1000);
      return null;
    }
    const reason = WAKEUP_EVENTS.find(k => p.reasons.has(k));
    return this.send(slot, reason, waiting || p.n);
  }
  /** One call: POST { type, reason, waiting, at } with its key in its header; the outcome is kept, five failures pause it. */
  async send(slot, reason, waiting, { test = false } = {}) {
    const r = this.q.get.get(this.w, slot.id), now = this.now();
    let link;
    try { link = JSON.parse(this.box.open(r.sealed, aadWakeup(this.w, slot.id))); } catch { link = null; }
    const sent = [...this.sent(r), now];
    if (!link) { this.q.result.run(JSON.stringify(sent), now, 0, 'unreadable', r.fails + 1, 1, this.w, slot.id); return { ok: false, status: null, error: 'The link can\'t be read: paste it again' }; }
    let status = null, error = null, said = '';
    try {
      const c = this.check(link);   // (the rules of today, not of the day it was saved)
      ({ status, error, said = '' } = await this.ring(c, { type: 'mvw.wakeup', reason, waiting, at: new Date(now).toISOString(), ...(test ? { test: true } : {}) }, { raw: true }));
    } catch (e) { error = e.message; }
    const ok = !error && status >= 200 && status < 300;
    const fails = ok ? 0 : r.fails + 1, pause = !ok && !test && fails >= WAKEUP_LIMITS.failsToPause;
    this.q.result.run(JSON.stringify(sent), now, ok ? 1 : 0, ok ? String(status) : (error ? 'error' : String(status)), fails, pause ? 1 : r.paused, this.w, slot.id);
    this.note(`[wakeup] slot ${slot.id} ${reason}: ${ok ? `ok ${status}` : error || `answered ${status}${said ? ` (${said})` : ''}`}`);
    if (pause) {
      this.audit('agent.wakeup_paused', { id: slot.account_id, login: null }, slot, null, { host: r.host, fails });
      this.tell(slot, `The wake-up link of ${slot.name} failed ${fails} times in a row (${error || `it answered ${status}${said ? `: ${said}` : ''}`}), so it is paused. Check it in its Agent Studio (Brain tab).`);
    }
    return { ok, status, ...(said ? { said } : {}), ...(error ? { error } : !ok ? { error: `It answered ${status}${said ? `: ${said}` : ''}` } : {}) };
  }
  /** One POST of payload to a checked link (check()): { ok, status, error } (raw: error only when it wasn't answered). */
  async ring(c, payload, { raw = false } = {}) {
    let status = null, error = null, text = '';
    try { ({ status, text = '' } = await this.request(c.url, { headers: { ...(c.header ? { [c.header]: c.key } : {}) }, body: JSON.stringify(payload), local: c.local })); }
    catch (e) { error = e.code === 'blocked' ? 'The address is not on the public internet' : e.code === 'timeout' ? 'It did not answer within 10 seconds' : e.message || 'It could not be reached'; }
    const ok = !error && status >= 200 && status < 300;
    const said = ok || error ? '' : reasonOf(text, c);
    return { ok, status, ...(said ? { said } : {}), error: error || (raw || ok ? null : `it answered ${status}${said ? `: ${said}` : ''}`) };
  }
  cancel(slotId) { const p = this.pending.get(slotId); if (p) { clearTimeout(p.timer); this.pending.delete(slotId); } }
  close() { for (const id of [...this.pending.keys()]) this.cancel(id); }

  tell(slot, text) { try { this.notifyFn?.(slot, text); } catch { /* Settings → Third-party agents shows it */ } }
  note(line) { try { this.logFn?.(line); } catch { /* logging never blocks */ } }
  audit(action, actor, slot, ip, detail) { try { this.agentApi.log(action, { actor, slot, ip, detail }); } catch { /* the outcome stands */ } }
}

/**
 * Why an app refused a wake-up call, from its answer: a JSON error's message (error, message, error_description, detail)
 * or the start of its text - one line, at most 200 letters, and never the link's own key or anything shaped like a key.
 */
export function reasonOf(text, c = {}) {
  let t = String(text || '').trim();
  try { const j = JSON.parse(t); const e = j && (j.error?.message || j.error_description || j.message || j.detail || j.error); if (typeof e === 'string') t = e; } catch { /* plain text */ }
  if (c.key) t = t.split(c.key).join('…');
  t = t.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '…').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
}

/** POST body to url; no redirects are followed; a name is looked up and checked again on every connection. */
function post(url, { headers = {}, body = '', local = false, timeoutMs = WAKEUP_LIMITS.timeoutMs } = {}) {
  const u = new URL(url), lib = u.protocol === 'http:' ? http : https, data = Buffer.from(body);
  return new Promise((resolve, reject) => {
    const req = lib.request(u, {
      method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'User-Agent': 'MyVirtualWorld-WakeUp/1', ...headers },
      ...(local ? {} : { lookup: guardedLookup, autoSelectFamily: false }),
    }, res => {
      // (its first few hundred bytes are kept: an app that refuses says why - 2026-10-13, Grok Bot answered 400 with its own
      // rate limit, and "It answered 400" alone sent its owner looking at what they pasted)
      const chunks = []; let n = 0;
      res.on('data', c => { if (n < 600) { chunks.push(c); n += c.length; } });
      const done = () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8').slice(0, 600) });
      res.on('end', done); res.on('error', done);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('It did not answer'), { code: 'timeout' })));
    req.on('error', e => reject(e.code ? e : Object.assign(e, { code: 'network' })));
    req.end(data);
  });
}
