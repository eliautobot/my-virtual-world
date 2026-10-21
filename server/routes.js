// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// HTTP routes and WebSocket messages. Each one names the capability it needs (server/auth/permissions.js); the request
// pipeline in server/index.mjs (handleApi) checks the session, that capability, Origin, the CSRF token and
// re-authentication before a handler runs, so a handler never sees a request it may not serve.
// tests/permissions.test.mjs fails when a route or message lacks a known capability (CHECKLIST X10).
import crypto from 'node:crypto';
import fs from 'node:fs';
import { CAPS, ROLES } from './auth/permissions.js';
import { AuthError, GUEST, LIMITS } from './auth/accounts.js';
import { AUDIT_GROUPS } from './auth/audit.js';
import { LOCKS, LicenceError, DEMO_AGENTS } from './licence.js';
import { AgentError, isExtKey } from './agents.js';
import { AgentApiError } from './agent-api.js';
import { ConnectionError } from './connections.js';
import { ProviderError, isProviderKey } from './agent-providers.js';
import { HostError } from './providers/host.js';
import { ChatError } from './chat/chat.js';
import { INLINE as INLINE_MEDIA } from './chat/provider-media.js';
import { AttachmentError } from './chat/attachments.js';
import { sessionCookie } from './auth/http.js';

export class Router {
  constructor() { this.routes = []; }
  /**
   * @param {object} r
   * @param {'GET'|'POST'} r.method
   * @param {string} [r.path]    exact path
   * @param {string} [r.prefix]  path prefix; the rest of the path reaches the handler as ctx.param
   * @param {string} r.cap       the capability a caller needs
   * @param {boolean} [r.csrf]   POSTs need the session's CSRF token (default true for POST)
   * @param {boolean} [r.reauth] the caller must have entered the password within the last 10 minutes
   * @param {'agent'} [r.principal] a route for connected agents (WP2.14): no cookies, no browser session; auth 'bearer' needs a session
   *   token (ctx.A is the agent's slot), auth 'signature' routes check a signature themselves
   * @param {function} r.handler async ctx => ({ status, json | pre, headers }); ctx = { req, url, P, ip, body, param }
   */
  add(r) {
    const where = `${r.method} ${r.path || `${r.prefix}*`}`;
    if (!['GET', 'POST'].includes(r.method)) throw new Error(`route ${where}: the method must be GET or POST`);
    if (!r.path === !r.prefix) throw new Error(`route ${where}: give a path or a prefix`);
    if (!r.cap || !CAPS[r.cap]) throw new Error(`route ${where}: unknown capability "${r.cap}"`);
    if (r.lock !== undefined && !Object.hasOwn(LOCKS, r.lock)) throw new Error(`route ${where}: unknown demo-mode lock "${r.lock}"`);
    if (typeof r.handler !== 'function') throw new Error(`route ${where}: no handler`);
    if (this.routes.some(o => o.method === r.method && o.path === r.path && o.prefix === r.prefix)) throw new Error(`route ${where}: defined twice`);
    if (r.principal !== undefined && r.principal !== 'agent') throw new Error(`route ${where}: unknown principal "${r.principal}"`);
    if (r.principal === 'agent' && (r.cap !== 'public' || !['bearer', 'signature'].includes(r.auth) || r.csrf || r.reauth)) throw new Error(`route ${where}: an agent route uses cap public, auth bearer or signature, and no CSRF or re-authentication`);
    this.routes.push({ csrf: r.method === 'POST' && r.principal !== 'agent', reauth: false, ...r });
    return this;
  }
  /** { route, param } for a request; { wrongMethod: true } when the path exists for other methods only; else null. */
  match(method, pathname) {
    let other = false;
    for (const r of this.routes) {
      if (r.path ? r.path !== pathname : !pathname.startsWith(r.prefix)) continue;
      if (r.method === method || (method === 'HEAD' && r.method === 'GET')) return { route: r, param: r.prefix ? pathname.slice(r.prefix.length) : null };
      other = true;
    }
    return other ? { wrongMethod: true } : null;
  }
  list() {
    return this.routes.map(r => ({ method: r.method, path: r.path || `${r.prefix}*`, cap: r.cap, csrf: r.csrf, reauth: r.reauth, lock: r.lock, principal: r.principal || 'account', auth: r.auth }));
  }
}

/** Agent presence without the task text: whether an agent works, not on what. */
export function stripTask(s) {
  if (!s) return s;
  return { working: !!s.working, state: s.working ? 'working' : s.state === 'offline' ? 'offline' : 'idle' };
}

function num(v, what) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new AuthError(400, 'bad_request', `${what} must be a number`);
  return n;
}
const text = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : '');

/**
 * Builds the route table and the WebSocket message table.
 * @param {object} d  from index.mjs: VERSION, RELEASE, accounts, perms, policy, cookieName, world(),
 *                    people(), sim(), presence, editor, worldPayload(), peoplePayload(withTasks), saveMeta(), clients(),
 *                    onAccessChange(), send(ws, obj), realNow()
 */
/** Demo mode's refusal of a fourth agent (built in or connected). */
const DEMO_FULL = 'Demo mode allows 3 agents in all, built in or connected (a Grok Bot counts too). A licence key unlocks more than 3 agents.';
export function createApi(d) {
  const { accounts, perms, policy, cookieName, audit, settings } = d;
  /** The address people open (MVW_PUBLIC_URL, else this request's own), for invite links. */
  const siteBase = req => [...policy.publicOrigins][0] || `${policy.scheme(req)}://${String(req.headers.host || 'localhost')}`;
  const requireSecure = req => {
    if (!policy.isSecure(req)) throw new AuthError(400, 'https_required', 'Signing in needs a secure connection: open this site over HTTPS');
  };
  const router = new Router();
  const ok = (json, status = 200, headers = null) => ({ status, json, headers });
  const notFound = what => ok({ error: `No such ${what}`, code: 'not_found' }, 404);
  const tasks = P => perms.allowed(P, 'agents.view_tasks');
  const setCookie = (value, maxAgeSec) => ({ 'set-cookie': sessionCookie(cookieName, value, maxAgeSec) });

  /** What the page needs to know about its visitor. The CSRF token is only readable by same-origin scripts. */
  function me(req, P) {
    return {
      account: P.account ? { ...P.account } : null,
      role: P.role,
      restricted: !!P.restricted,
      restrictedWhy: P.restrictedWhy || null,
      registrationOpen: perms.flag('registration.open'),
      setup: accounts.needsSetup(),   // a new installation: the administrator account is still to be made (POST /api/auth/setup)
      caps: perms.capsFor(P),
      csrf: P.session ? P.session.csrf : null,
      reauthLeftMs: P.session ? Math.max(0, P.session.authAt + LIMITS.reauthMs - Date.now()) : 0,
      requireSignIn: perms.requireSignIn(),
      secure: policy.isSecure(req),
      licence: d.licence ? d.licence.status() : null,   // demo mode or licensed (WP1.11)
    };
  }
  /** Public health for monitors and the smoke test; diagnostics only for callers with server.diagnostics. */
  function health(P) {
    const w = d.world(), h = d.sim().health();
    const out = {
      ok: true, version: d.VERSION, release: d.RELEASE, worldVersion: w.version,
      libs: d.libs ? d.libs() : [],   // the libraries this release ships (Settings → About)
      licence: d.licence ? { active: d.licence.active, mode: d.licence.platform ? 'platform' : d.licence.active ? 'licensed' : 'demo' } : null,
      loop: d.loopStats ? { ...d.loopStats(), rssMb: Math.round(process.memoryUsage().rss / 1048576), cpuUs: process.cpuUsage() } : null,
      players: d.players ? { online: d.players.byId.size, tickMs: Math.round(d.players.stats.tickMs * 1000) / 1000,
        tickMaxMs: Math.round(d.players.stats.tickMaxMs * 100) / 100, moves: d.players.stats.moves, corrections: d.players.stats.corrections,
        bytes: d.players.stats.bytes, frames: d.players.stats.frames, chats: d.players.stats.chats } : null,
      buildings: w.buildings.filter(b => b && !b.gone).length, agents: h.agents,
      out: h.out, inside: h.inside, under: h.under, moving: h.moving, errors: h.errors, clock: h.clock,
      wildlife: d.wildlifeStats ? d.wildlifeStats() : null,   // the shared tier (WP4.17): regions awake, herds, animals, tick ms
      presence: { ok: h.presence.ok, working: h.presence.working },
    };
    if (perms.allowed(P, 'server.diagnostics')) {
      Object.assign(out, { clients: d.clients(), store: d.storeStats ? d.storeStats() : null, stats: h.stats, heap: h.heap, lastErrors: h.lastErrors, mem: h.mem, presence: { ...h.presence, ...(d.presenceStatus ? d.presenceStatus() : {}) }, accounts: accounts.status() });
    }
    return out;
  }

  // ---------------------------------------------------------------- server and world
  router.add({ method: 'GET', path: '/api/health', cap: 'public', handler: ({ P }) => ok(health(P)) });
  // Readiness for health checks (the Docker image's HEALTHCHECK; DECISIONS C105): 503 while the server shuts down or
  // when its simulation is stuck. /api/health answers whenever the process serves HTTP.
  router.add({ method: 'GET', path: '/api/ready', cap: 'public', whileStopping: true, handler: () => { const r = d.readiness(); return ok(r, r.ready ? 200 : 503); } });
  // every route and who may use it: its capability and that capability's lowest role now (administrators: diagnostics, and
  // the sweep that proves no one below gets through - tests/authz-sweep-http.test.mjs, step 8)
  router.add({ method: 'GET', path: '/api/routes', cap: 'server.diagnostics', handler: () => ok({ routes: router.list().map(r => ({ ...r, min: perms.minRole(r.cap) })) }) });
  router.add({ method: 'GET', path: '/api/world', cap: 'world.view', handler: () => ({ status: 200, pre: d.worldPayload() }) });
  router.add({ method: 'GET', path: '/api/people', cap: 'world.view', handler: ({ P }) => ({ status: 200, pre: d.peoplePayload(tasks(P)) }) });
  router.add({ method: 'GET', path: '/api/clock', cap: 'world.view', handler: () => ok(d.sim().clockInfo()) });
  // how many live in the city and how many its homes call for (server/sim/housing.js; Settings → Residents)
  router.add({ method: 'GET', path: '/api/population', cap: 'world.edit', handler: () => ok(d.housing.status()) });
  router.add({
    method: 'GET', prefix: '/api/agent/', cap: 'world.view', handler: ({ P, param }) => {
      const idx = /^\d{1,7}$/.test(param) ? +param : -1;
      const info = idx >= 0 ? d.sim().agentInfo(idx) : null;
      // a retired resident (its agent was removed) is still in the list: say so plainly instead of pretending it never existed
      if (!info && idx >= 0 && d.people()[idx] && d.people()[idx].retired) return ok({ i: idx, retired: true });
      if (!info) return notFound('agent');
      if (info.presence && !tasks(P)) info.presence = stripTask(info.presence);
      return ok(info);
    },
  });
  // What a person did lately (the selection card's feed, server/recent.js). An agent shown as one keeps its life private
  // (docs/features/FREE-WILL.md, decision 5): only its owner and accounts it is shared with to manage read it - its
  // stored activity log; anyone else learns only that it is private. A resident (or a body that passes for one) is public:
  // what anyone could see by watching.
  router.add({
    method: 'GET', path: '/api/people/recent', cap: 'world.view', handler: ({ P, url }) => {
      const raw = url.searchParams.get('i') || '', i = /^\d{1,7}$/.test(raw) ? +raw : -1, p = d.people()[i];
      if (!p || p.retired || !d.recent) return notFound('person');
      if (p.vip && p.agentId && d.sim().agentShown(p.agentId)) {
        const a = d.agents.byKey(p.agentId), life = d.life?.();
        if (!a || !(d.agents.isOwner(P, a) || d.agents.canManage(P, a)) || !life) return ok({ i, private: true, activity: [] });
        const rows = life.activity(a.id, { limit: 12 }).reverse();
        return ok({ i, activity: rows.map(r => ({ kind: r.kind, label: r.label, place: r.place, icon: '', when: r.when, minutes: r.minutes, now: !!r.now })) });
      }
      return ok({ i, activity: d.recent.of(i) });
    },
  });
  router.add({
    method: 'GET', path: '/api/roster', cap: 'world.view', handler: ({ P }) => {
      const sim = d.sim(), see = tasks(P), roster = [];
      d.people().forEach((p, i) => {
        if (!p.vip || (d.agentShown ? !d.agentShown(p.agentId) : d.agentOk && !d.agentOk(p.agentId))) return;   // demo mode: 3 agents (WP1.11); a hidden connected agent is not on the public roster
        const pr = d.presence.info(p.agentId), act = sim.agents[i] && sim.agents[i].act;
        roster.push({
          i, name: p.name, emoji: p.emoji, role: p.role, agentId: p.agentId, presence: see ? pr : stripTask(pr),
          act: act ? { label: act.label, icon: act.icon, place: act.place } : null,
        });
      });
      return ok({ roster, presence: { ok: !!d.presence.ok } });
    },
  });
  router.add({
    method: 'GET', path: '/api/building', cap: 'world.view', handler: ({ url }) => {
      const raw = url.searchParams.get('b') || '', b = /^\d{1,6}$/.test(raw) ? +raw : -1, B = d.world().buildings[b];
      if (!B || B.gone) return notFound('building');
      return ok({ b, occupancy: d.sim().buildingOccupancy(b) });
    },
  });
  router.add({
    // Members edit on lots they hold, administrators on the city's land (WP4.6, server/lot-rights.js checks every op).
    method: 'POST', path: '/api/edit', cap: 'property.hold', lock: 'edit', handler: ({ P, body }) => {
      const ops = body.ops || body;
      // Destructive edits (demolishing, removing floors) need a password entry within 10 minutes (DECISIONS C65).
      const why = d.editor.destructive(ops);
      if (why && !(P.session && Date.now() - P.session.authAt <= LIMITS.reauthMs)) {
        throw new AuthError(403, 'reauth_required', `${why} needs your password: confirm it to continue`);
      }
      // agentBody(i): whether resident i is the body of an agent this account manages (its owner dresses it: lot-rights.js)
      const agentBody = i => !!d.managesBody?.(P, i);
      const r = d.editor.apply(ops, { id: P.account.id, name: P.account.displayName, admin: perms.allowed(P, 'world.edit'), subject: { kind: 'account', id: String(P.account.id) }, agentBody }, { atomic: body.atomic === true });   // journaled for this account (WP1.8)
      if (d.journal) r.history = d.journal.tops(P.account.id);
      return ok(r, r.ok ? 200 : r.code === 'forbidden' ? 403 : 400);
    },
  });
  router.add({
    method: 'POST', path: '/api/talk', cap: 'world.interact', handler: ({ P, body }) => {
      const r = d.sim().talk(body.i | 0, +body.x || 0, +body.z || 0);
      if (r && r.ok) d.onTalk?.(P, body.i | 0);
      return r ? ok(r) : notFound('agent');
    },
  });
  router.add({ method: 'POST', path: '/api/command', cap: 'world.edit', lock: 'edit', handler: ({ body }) => ok({ ok: d.sim().command(body.i | 0, text(body.cmd, 32)) }) });
  // ---------------------------------------------------------------- the edit journal and the activity log (WP1.8, C116)
  // An account's own undo and redo never ask for the password again; a refusal answers 409 with the reason and the
  // account's history. Reverting anyone's edit needs world.revert, and a recent password when it removes a building
  // or floors (C65).
  router.add({ method: 'POST', path: '/api/undo', cap: 'property.hold', lock: 'edit', handler: ({ P }) => { const r = d.journal.undo(P); return ok(r, r.ok ? 200 : r.code === 'forbidden' ? 403 : 409); } });
  router.add({ method: 'POST', path: '/api/redo', cap: 'property.hold', lock: 'edit', handler: ({ P }) => { const r = d.journal.redo(P); return ok(r, r.ok ? 200 : r.code === 'forbidden' ? 403 : 409); } });
  router.add({ method: 'GET', path: '/api/history', cap: 'property.hold', handler: ({ P }) => ok(d.journal.tops(P.account.id)) });
  router.add({
    method: 'POST', path: '/api/revert', cap: 'world.revert', lock: 'edit', handler: ({ P, body }) => {
      const id = Number(body.id);
      if (!Number.isInteger(id) || id <= 0) throw new AuthError(400, 'bad_request', 'Which change?');
      const why = d.journal.revertRemoves(id);
      if (why && !(P.session && Date.now() - P.session.authAt <= LIMITS.reauthMs)) {
        throw new AuthError(403, 'reauth_required', `${why} needs your password: confirm it to continue`);
      }
      const r = d.journal.revert(P, id);
      return ok(r, r.ok ? 200 : r.code === 'not_found' ? 404 : 409);
    },
  });
  router.add({
    method: 'GET', path: '/api/activity', cap: 'activity.read', handler: ({ P, url }) => {
      const sp = url.searchParams, int = (k, max) => (/^\d{1,15}$/.test(sp.get(k) || '') ? Math.min(max, Number(sp.get(k))) : null);
      return ok(d.activity.list(P, { before: int('before', Number.MAX_SAFE_INTEGER), limit: int('limit', 200) || 50 }));
    },
  });
  router.add({
    method: 'POST', path: '/api/clock', cap: 'world.clock', handler: ({ body }) => {
      const sim = d.sim();
      if (body.rate !== undefined) sim.setRate(num(body.rate, 'rate'));
      if (body.skip !== undefined) sim.skipTo(num(body.skip, 'skip'));
      d.saveMeta();
      return ok(sim.clockInfo());
    },
  });

  // ---------------------------------------------------------------- sign-in and the own account
  router.add({ method: 'GET', path: '/api/auth/me', cap: 'public', handler: ({ req, P }) => ok(me(req, P)) });
  router.add({
    method: 'POST', path: '/api/auth/signin', cap: 'auth.signin', csrf: false, handler: async ({ req, P, ip, body }) => {
      requireSecure(req);
      // Limits per client address, per account and address, and per account live in Accounts (DECISIONS C71).
      const r = await accounts.signIn({ login: body.login, password: body.password, ip, userAgent: text(req.headers['user-agent'], 200) });
      if (r.twofa) return ok({ twofa: 'required', ticket: r.ticket });   // the code comes in /api/auth/signin/2fa
      if (P.session) accounts.signOut(P, {}, ip);   // the session this browser had before
      return ok(me(req, r.principal), 200, setCookie(r.token, LIMITS.sessionMaxMs / 1000));
    },
  });
  router.add({
    method: 'POST', path: '/api/auth/signin/2fa', cap: 'auth.signin', csrf: false, handler: async ({ req, P, ip, body }) => {
      requireSecure(req);
      const r = await accounts.signInTwofa({ ticket: body.ticket, code: body.code, ip, userAgent: text(req.headers['user-agent'], 200) });
      if (P.session) accounts.signOut(P, {}, ip);
      return ok(me(req, r.principal), 200, setCookie(r.token, LIMITS.sessionMaxMs / 1000));
    },
  });
  // the first start: whoever holds the setup code creates the administrator account and is signed in (server/auth/accounts.js)
  router.add({
    method: 'POST', path: '/api/auth/setup', cap: 'auth.signin', csrf: false, handler: async ({ req, P, ip, body }) => {
      requireSecure(req);
      const r = await accounts.setupOwner({ code: body.code, login: body.login, displayName: body.displayName, password: body.password, ip, userAgent: text(req.headers['user-agent'], 200) });
      if (P.session) accounts.signOut(P, {}, ip);
      return ok(me(req, r.principal), 201, setCookie(r.token, LIMITS.sessionMaxMs / 1000));
    },
  });
  router.add({
    method: 'POST', path: '/api/auth/register', cap: 'auth.register', csrf: false, handler: async ({ req, ip, body }) => {
      requireSecure(req);
      if (!perms.flag('registration.open')) throw new AuthError(403, 'registration_closed', 'New accounts need an invite here');
      const r = await accounts.register({ login: body.login, displayName: body.displayName, password: body.password, ip, userAgent: text(req.headers['user-agent'], 200) });
      return ok(me(req, r.principal), 201, setCookie(r.token, LIMITS.sessionMaxMs / 1000));
    },
  });
  router.add({
    method: 'GET', path: '/api/invites/check', cap: 'auth.register',
    handler: ({ url }) => ok(accounts.checkInvite(url.searchParams.get('token') || '')),
  });
  router.add({
    method: 'POST', path: '/api/invites/accept', cap: 'auth.register', csrf: false, handler: async ({ req, ip, body }) => {
      requireSecure(req);
      const r = await accounts.acceptInvite({ token: body.token, login: body.login, displayName: body.displayName, password: body.password, ip, userAgent: text(req.headers['user-agent'], 200) });
      return ok(me(req, r.principal), 201, setCookie(r.token, LIMITS.sessionMaxMs / 1000));
    },
  });
  router.add({
    method: 'POST', path: '/api/auth/signout', cap: 'account.session', handler: ({ req, P, ip, body }) => {
      // the account's notifications stop with the session: this browser's push subscription (it sends its address), or
      // every device's when signing out everywhere (docs/features/CHAT.md §8)
      if (P.account && d.notifications) {
        if (body.everywhere === true) d.notifications.forgetDevices(P.account.id);
        else if (typeof body.endpoint === 'string' && body.endpoint) d.notifications.unsubscribe(P.account.id, body.endpoint.slice(0, 1000));
      }
      accounts.signOut(P, { everywhere: body.everywhere === true }, ip);
      return ok(me(req, GUEST), 200, setCookie('', 0));
    },
  });
  router.add({
    method: 'POST', path: '/api/auth/reauth', cap: 'account.session',
    handler: async ({ req, P, ip, body }) => ok(me(req, (await accounts.reauth(P, body.password, ip)) || GUEST)),
  });
  router.add({
    method: 'POST', path: '/api/account/password', cap: 'account.password',
    handler: async ({ req, P, ip, body }) => ok(me(req, (await accounts.changePassword(P, { current: body.current, password: body.password }, ip)) || GUEST)),
  });
  router.add({
    method: 'POST', path: '/api/account/name', cap: 'account.self', handler: ({ req, P, ip, body }) => {
      accounts.setDisplayName(P, body.displayName, ip);
      return ok(me(req, accounts.refresh(P.session.id) || GUEST));
    },
  });
  router.add({
    method: 'POST', path: '/api/account/login', cap: 'account.self', reauth: true, handler: ({ req, P, ip, body }) => {
      accounts.setLogin(P, body.login, ip);
      return ok(me(req, accounts.refresh(P.session.id) || GUEST));
    },
  });
  router.add({ method: 'GET', path: '/api/account/devices', cap: 'account.self', handler: ({ P }) => ok({ devices: accounts.devices(P) }) });
  router.add({
    method: 'POST', path: '/api/account/devices/revoke', cap: 'account.self', handler: ({ req, P, ip, body }) => {
      const id = Number(body.id);
      if (!Number.isInteger(id)) throw new AuthError(400, 'bad_request', 'Which device?');
      if (id === P.session.id) {
        accounts.signOut(P, {}, ip);
        return ok({ ...me(req, GUEST), devices: [], signedOut: true }, 200, setCookie('', 0));
      }
      accounts.revokeDevice(P, id, ip);
      return ok({ devices: accounts.devices(P) });
    },
  });

  // ---------------------------------------------------------------- accounts, permissions, world settings
  router.add({ method: 'GET', path: '/api/users', cap: 'users.manage', handler: () => ok({ users: accounts.listUsers() }) });
  router.add({
    method: 'POST', path: '/api/users', cap: 'users.manage', reauth: true,
    handler: async ({ P, ip, body }) => ok(await accounts.createUser(P, { login: body.login, displayName: body.displayName, role: body.role || 'member' }, ip), 201),
  });
  router.add({
    method: 'POST', path: '/api/users/delete', cap: 'users.manage', reauth: true, handler: ({ P, ip, body }) => {
      const id = Number(body.id);
      if (!Number.isInteger(id)) throw new AuthError(400, 'bad_request', 'Which account?');
      accounts.deleteUser(P, id, { data: body.data || 'delete', to: body.to ?? null }, ip);
      return ok({ users: accounts.listUsers() });
    },
  });
  router.add({
    method: 'POST', path: '/api/owner/transfer', cap: 'owner.transfer', reauth: true, handler: ({ req, P, ip, body }) => {
      const id = Number(body.id);
      if (!Number.isInteger(id)) throw new AuthError(400, 'bad_request', 'Which admin?');
      accounts.transferOwner(P, id, ip);
      return ok({ ...me(req, accounts.refresh(P.session.id) || GUEST), users: accounts.listUsers() });
    },
  });
  router.add({ method: 'GET', path: '/api/invites', cap: 'invites.manage', handler: () => ok({ invites: accounts.listInvites() }) });
  router.add({
    method: 'POST', path: '/api/invites', cap: 'invites.manage', reauth: true, handler: ({ req, P, ip, body }) => {
      const r = accounts.createInvite(P, { role: body.role || 'member', days: body.days ?? 7, note: text(body.note, 200) }, ip);
      // The token goes after #: browsers never send that part to the server or in Referer headers (C83).
      return ok({ invite: r.invite, link: `${siteBase(req)}/#invite=${encodeURIComponent(r.token)}` }, 201);
    },
  });
  router.add({
    method: 'POST', path: '/api/invites/revoke', cap: 'invites.manage', handler: ({ P, ip, body }) => {
      const id = Number(body.id);
      if (!Number.isInteger(id)) throw new AuthError(400, 'bad_request', 'Which invite?');
      accounts.revokeInvite(P, id, ip);
      return ok({ invites: accounts.listInvites() });
    },
  });
  router.add({
    method: 'POST', path: '/api/users/update', cap: 'users.manage', reauth: true, handler: async ({ P, ip, body }) => {
      const id = Number(body.id);
      if (!Number.isInteger(id)) throw new AuthError(400, 'bad_request', 'Which account?');
      if (body.role !== undefined && !perms.allowed(P, 'roles.assign')) throw new AuthError(403, 'forbidden', 'Your role does not allow changing roles');
      return ok(await accounts.updateUser(P, id, { role: body.role, status: body.status, resetPassword: body.resetPassword === true, resetTwofa: body.resetTwofa === true }, ip));
    },
  });
  const permissionsView = () => ok({ roles: ROLES, caps: perms.describe(), requireSignIn: perms.requireSignIn() });
  router.add({ method: 'GET', path: '/api/permissions', cap: 'permissions.manage', handler: permissionsView });
  router.add({
    method: 'POST', path: '/api/permissions', cap: 'permissions.manage', reauth: true, handler: ({ P, ip, body }) => {
      const cap = text(body.cap, 64), before = perms.ov.get(cap) || null;
      const why = perms.setOverride(cap, body.min ?? null, P.account.id);
      if (why) throw new AuthError(400, 'bad_request', why);
      audit?.log('permissions.set', { actor: { id: P.account.id, login: P.account.login }, ip, detail: { cap, from: before, to: perms.ov.get(cap) || null } });
      d.onAccessChange();
      return permissionsView();
    },
  });
  const worldSettings = () => ({ requireSignIn: perms.requireSignIn(), registrationOpen: perms.flag('registration.open') });
  router.add({ method: 'GET', path: '/api/settings/world', cap: 'settings.world', handler: () => ok(settings.redacted(worldSettings())) });
  // Installation settings live in one registry and service (server/settings.js; DECISIONS C85, C90); these two endpoints
  // stay as thin wrappers over it (C90).
  router.add({
    method: 'POST', path: '/api/settings/world', cap: 'settings.world', reauth: true, handler: ({ P, ip, body }) => {
      const values = {};
      if (body.requireSignIn !== undefined) values['world.requireSignIn'] = body.requireSignIn;
      if (body.registrationOpen !== undefined) values['registration.open'] = body.registrationOpen;
      settings.changeInstall(P, values, { ip });
      return ok(settings.redacted(worldSettings()));
    },
  });
  const securitySettings = P => {
    const days = Number(perms.setting('audit.retentionDays', 0)) || null;
    return { require2fa: perms.flag('security.require2fa'), retentionDays: days, canSetRetention: perms.allowed(P, 'audit.retention') };
  };
  router.add({ method: 'GET', path: '/api/settings/security', cap: 'settings.security', handler: ({ P }) => ok(settings.redacted(securitySettings(P))) });
  router.add({
    method: 'POST', path: '/api/settings/security', cap: 'settings.security', reauth: true, handler: ({ P, ip, body }) => {
      const values = {};
      if (body.require2fa !== undefined) values['security.require2fa'] = body.require2fa;
      if (body.retentionDays !== undefined) values['audit.retentionDays'] = body.retentionDays;
      settings.changeInstall(P, values, { ip });
      return ok(settings.redacted(securitySettings(P)));
    },
  });
  // Every installation setting with its tier and who may change it; secrets only as set / not set (C90). Each setting
  // checks its own capability, and tier 1 and 2 changes need a password entry within 10 minutes (server/settings.js).
  router.add({ method: 'GET', path: '/api/settings', cap: 'settings.view', handler: ({ P }) => ok(settings.installView(P)) });
  router.add({
    method: 'POST', path: '/api/settings', cap: 'settings.view', handler: ({ P, ip, body }) => {
      settings.changeInstall(P, body.values, { ip });
      return ok(settings.installView(P));
    },
  });
  // The own account's settings: display preferences today (C91), later the own secrets (only as set / not set).
  router.add({ method: 'GET', path: '/api/account/settings', cap: 'account.self', handler: ({ P }) => ok(settings.accountView(P)) });
  router.add({
    method: 'POST', path: '/api/account/settings', cap: 'account.self', handler: ({ P, ip, body }) => {
      settings.changeAccount(P, body.values, { ip });
      return ok(settings.accountView(P));
    },
  });
  router.add({
    method: 'GET', path: '/api/audit', cap: 'audit.read', handler: ({ P, ip, url }) => {
      const sp = url.searchParams, int = k => (sp.has(k) && /^\d{1,15}$/.test(sp.get(k)) ? Number(sp.get(k)) : null);
      const time = k => { const v = sp.get(k); if (!v) return null; const t = /^\d+$/.test(v) ? Number(v) : Date.parse(v); return Number.isFinite(t) ? t : null; };
      const filters = { group: sp.get('group') || null, action: sp.get('action') || null, account: int('account'), from: time('from'), to: time('to'), before: int('before'), limit: int('limit') || 200 };
      const format = sp.get('format');
      if (format === 'csv' || format === 'jsonl') {
        audit.log('audit.export', { actor: { id: P.account.id, login: P.account.login }, ip, detail: { format, filters } });
        const stamp = new Date().toISOString().slice(0, 10);
        return {
          status: 200, pre: { body: audit.export(format, filters) },
          headers: { 'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8', 'content-disposition': `attachment; filename="audit-${stamp}.${format}"` },
        };
      }
      return ok({ events: audit.list(filters), groups: Object.keys(AUDIT_GROUPS) });
    },
  });

  // ---------------------------------------------------------------- two-factor sign-in and the own data
  router.add({ method: 'GET', path: '/api/account/2fa', cap: 'account.twofa', handler: ({ P }) => ok(accounts.twofaStatus(P)) });
  router.add({ method: 'POST', path: '/api/account/2fa/setup', cap: 'account.twofa', reauth: true, handler: ({ P }) => ok(accounts.twofaSetup(P)) });
  router.add({
    method: 'POST', path: '/api/account/2fa/enable', cap: 'account.twofa', reauth: true,
    handler: ({ req, P, ip, body }) => { const r = accounts.twofaEnable(P, body.code, ip); return ok({ ...r, ...me(req, accounts.refresh(P.session.id) || GUEST) }); },
  });
  router.add({
    method: 'POST', path: '/api/account/2fa/disable', cap: 'account.twofa', reauth: true,
    handler: ({ req, P, ip }) => { accounts.twofaDisable(P, ip); return ok(me(req, accounts.refresh(P.session.id) || GUEST)); },
  });
  router.add({ method: 'POST', path: '/api/account/2fa/recovery', cap: 'account.twofa', reauth: true, handler: ({ P, ip }) => ok(accounts.twofaRecovery(P, ip)) });
  router.add({
    method: 'GET', path: '/api/account/export', cap: 'account.data', reauth: true, handler: ({ P, ip }) => ({
      status: 200, pre: { body: JSON.stringify({ ...accounts.exportData(P, ip), settings: settings.accountView(P).settings }, null, 2) },
      headers: { 'content-disposition': `attachment; filename="my-data-${P.account.login}.json"` },
    }),
  });
  router.add({
    method: 'POST', path: '/api/account/delete', cap: 'account.data', reauth: true, handler: async ({ req, P, ip, body }) => {
      await accounts.deleteSelf(P, body.password, ip);
      return ok({ ...me(req, GUEST), deleted: true }, 200, setCookie('', 0));
    },
  });

  // ---------------------------------------------------------------- licence (WP1.11, C108, C109, E17, E19)
  const licenceCall = async fn => {
    try { return ok(await fn()); } catch (e) {
      if (e instanceof LicenceError) throw new AuthError(e.status, e.code, e.message);
      throw e;
    }
  };
  const actorOf = P => (P.account ? { id: P.account.id, login: P.account.login } : null);
  router.add({ method: 'GET', path: '/api/licence', cap: 'world.view', handler: ({ P }) => ok(perms.allowed(P, 'licence.manage') ? d.licence.ownerStatus() : d.licence.status()) });
  router.add({ method: 'POST', path: '/api/licence/activate', cap: 'licence.manage', reauth: true, handler: ({ P, body }) => licenceCall(() => d.licence.activate(body.key, actorOf(P))) });
  router.add({ method: 'POST', path: '/api/licence/deactivate', cap: 'licence.manage', reauth: true, handler: ({ P, body }) => licenceCall(() => d.licence.deactivate(actorOf(P), { force: body.force === true })) });
  // a release 1 receipt (its license.json) uploaded by the owner: validated with Lemon Squeezy, no new activation (C109)
  router.add({ method: 'POST', path: '/api/licence/import', cap: 'licence.manage', reauth: true, handler: ({ P, body }) => licenceCall(() => d.licence.importReceipt(body.receipt, actorOf(P), 'an uploaded license.json')) });

  // ---------------------------------------------------------------- agents (WP2.1, DECISIONS A6, A17, C60, E20)
  const agentCall = fn => {
    try { return ok(fn()); } catch (e) {
      if (e instanceof AgentError) throw new AuthError(e.status, e.code, e.message);
      throw e;
    }
  };
  const agentId = body => { const n = Number(body && body.id); if (!Number.isInteger(n) || n < 1) throw new AuthError(400, 'bad_request', 'Which agent?'); return n; };
  /** What anyone may see of an agent: its body and whether it is working, never its chats or task text (I8.12). */
  const publicAgent = (P, a) => {
    const i = d.agents.resolver.resolveBody(a.bodyRef), pr = d.presence.info(a.key);
    const level = d.agents.level(P, a);
    const o = { id: a.id, key: a.key, name: a.name, emoji: a.emoji, role: a.role, i, presence: tasks(P) ? pr : stripTask(pr), level, mine: !!(P.account && d.agents.isOwner(P, a)),
      public: !!(d.agentPublic && d.agentPublic(a)) };   // (public: anyone may talk with it - the info dock's Public agents)
    // an agent of an agent provider's own (OpenClaw): which provider it works through - its kind and the connection's name
    if (isProviderKey(a.key)) { const c = d.connections.get(a.connectionId), m = c && d.registry.manifest(c.kind); if (c && m) o.provider = { kind: c.kind, label: m.label, connection: c.label }; }
    if (level === 'manage') {
      o.enabled = a.enabled; o.ownerId = a.ownerId; o.shares = d.agents.shares(a.id);
      // what it is linked to (its brain, when that is a model provider): the Agent Studio's Brain tab. Only the label and
      // kind - the connection's settings and secrets stay behind /api/connections and its own rights.
      const c = a.connectionId ? d.connections.get(a.connectionId) : null;
      o.connection = c ? { id: c.id, label: c.label, kind: c.kind, enabled: c.enabled } : null;
    }
    return o;
  };
  // Presence of the agents (WP2.3, PLAN I8.6): the coordinator's state per agent. Task text and the last error only for callers who
  // may see tasks (agents.view_tasks); everyone else learns whether an agent works, not on what.
  const presenceView = (P, a) => {
    const st = d.presenceState(a.key);
    if (tasks(P)) return { id: a.id, key: a.key, working: st.working, state: st.state, task: st.task, meeting: !!st.meeting, since: st.since, lastRunError: st.lastRunError, source: st.source };
    return { id: a.id, key: a.key, working: st.working, state: st.working ? 'working' : st.state === 'offline' ? 'offline' : 'idle', meeting: !!st.meeting };
  };
  // a connected agent is listed only for those its owner lets see it (hidden, friends, public; I8.15), never confirmed to anyone else
  // (a connected agent: whom its slot shows it to - and always to whoever manages it: its owner, a person it is shared with)
  const seen = (P, a) => d.agentApi.agentKeyVisible(a.key, P.account ? P.account.id : null) || (!!P.account && d.agents.canManage(P, a));
  router.add({ method: 'GET', path: '/api/presence', cap: 'world.view', handler: ({ P }) => ok({ agents: d.agents.enabled().filter(a => d.agentOk(a.key) && seen(P, a)).map(a => presenceView(P, a)) }) });
  router.add({
    method: 'GET', prefix: '/api/presence/', cap: 'world.view', handler: ({ P, param }) => {
      const a = /^\d{1,9}$/.test(param) ? d.agents.get(+param) : null;
      if (!a || !a.enabled || !d.agentOk(a.key) || !seen(P, a)) return notFound('agent');
      return ok(presenceView(P, a));
    },
  });
  router.add({ method: 'GET', path: '/api/agents', cap: 'world.view', handler: ({ P }) => ok({ agents: d.agents.enabled().filter(a => d.agentOk(a.key) && seen(P, a)).map(a => publicAgent(P, a)), limit: d.licence.active ? null : DEMO_AGENTS }) });
  // the agents this account may use: the chat picker (WP2.11 serves the classic release's /agents-list over the same rule)
  router.add({ method: 'GET', path: '/api/agents/usable', cap: 'chat.use', handler: ({ P }) => ok({ agents: d.agents.usable(P).filter(a => d.agentOk(a.key) && seen(P, a)).map(a => publicAgent(P, a)) }) });
  router.add({ method: 'POST', path: '/api/agents', cap: 'agents.manage', handler: ({ P, body }) => agentCall(() => {
    // demo mode: at most 3 agents in all, built in or connected (server/index.mjs demoAgentRoom)
    if (d.demoAgentRoom && !d.demoAgentRoom()) throw new AuthError(403, 'licence_required', DEMO_FULL);
    const key = `agent-${crypto.randomBytes(5).toString('hex')}`;
    const a = d.agents.create({ key, name: body.name, emoji: body.emoji, role: body.role, ownerId: P.account.id }, actorOf(P));
    const bodyRef = d.spawnAgentBody(a);
    d.agents.setBodyRef(a.id, bodyRef);
    return publicAgent(P, d.agents.get(a.id));
  }) });
  const mine = (P, body, need) => {
    const a = d.agents.get(agentId(body));
    if (!a || !d.agents.canUse(P, a)) throw new AuthError(404, 'not_found', 'No such agent');   // never confirm what it cannot see
    // (a connected agent: its owner, or a person it is shared with to manage - its name, connection and removal stay with its slot)
    if ((need === 'manage' || need === 'own') && !d.agents.canManage(P, a)) throw new AuthError(403, 'forbidden', 'Only its owner, or an account it is shared with to manage, may do this');
    // removing it and choosing who else has it are its owner's alone: an account it is shared with to manage changes
    // everything else (step 8, 2026-10-08)
    if (need === 'own' && !d.agents.isOwner(P, a)) throw new AuthError(403, 'forbidden', 'Only its owner removes it or shares it');
    return a;
  };
  router.add({ method: 'POST', path: '/api/agents/update', cap: 'chat.use', handler: ({ P, body }) => agentCall(() => {
    const a = mine(P, body, 'manage');
    // a connected agent's name, whether it is on and what it thinks with are its slot's (Settings → Third-party agents)
    if (isExtKey(a.key) && ['name', 'enabled', 'connectionId', 'nativeId'].some(k => body[k] !== undefined)) throw new AuthError(400, 'connected_agent', 'A connected agent\'s name, connection and on/off are set in Settings → Third-party agents');
    // (an agent of an agent provider's own - OpenClaw's - is named, and listed or not, by its provider)
    if (isProviderKey(a.key) && ['name', 'enabled', 'connectionId', 'nativeId'].some(k => body[k] !== undefined)) throw new AuthError(400, 'provider_agent', 'This agent\'s name and whether it is listed come from its agent provider (Agent Providers)');
    const patch = {};
    for (const k of ['name', 'emoji', 'role', 'enabled']) if (body[k] !== undefined) patch[k] = body[k];
    // linking an agent to a connection needs the right to use that connection (WP2.2); unlinking is free
    if (body.connectionId !== undefined) {
      if (body.connectionId !== null) {
        const c = d.connections.get(body.connectionId);
        if (!c || !d.connections.canUse(P, c)) throw new AuthError(404, 'not_found', 'No such connection');
        // a decision service (Free Will) only picks from options: it cannot be an agent's chat brain
        if (!d.connections.registry.manifest(c.kind)?.capabilities?.chat) throw new AuthError(400, 'not_a_chat_provider', `${c.label} cannot chat; link an agent provider instead`);
        patch.connectionId = c.id;
      }
      else patch.connectionId = null;
    }
    if (body.nativeId !== undefined) patch.nativeId = body.nativeId;
    const out = d.agents.update(a.id, patch, actorOf(P));
    if ((patch.name !== undefined || patch.emoji !== undefined || patch.role !== undefined) && d.renameAgentBody) d.renameAgentBody(out);   // its body in the city follows
    return publicAgent(P, out);
  }) });
  router.add({ method: 'POST', path: '/api/agents/remove', cap: 'chat.use', handler: ({ P, body }) => agentCall(() => {
    const a = mine(P, body, 'own');
    if (isExtKey(a.key)) throw new AuthError(400, 'connected_agent', 'A connected agent is disconnected in Settings → Third-party agents');
    if (isProviderKey(a.key)) {
      const c = d.connections.get(a.connectionId), m = c && d.registry.manifest(c.kind), label = m ? m.label : 'its provider';
      throw new AuthError(400, 'provider_agent', `This agent belongs to its agent provider (${label}): to delete it, use Agent Providers → ${label} → Agents`);
    }
    d.agents.remove(a.id, actorOf(P));
    d.retireAgentBody(a);
    return { removed: a.id };
  }) });
  router.add({ method: 'POST', path: '/api/agents/share', cap: 'chat.use', handler: ({ P, body }) => agentCall(() => ({ shares: d.agents.share(mine(P, body, 'own').id, body.kind, body.who, body.level, actorOf(P)) })) });
  router.add({ method: 'POST', path: '/api/agents/unshare', cap: 'chat.use', handler: ({ P, body }) => agentCall(() => ({ shares: d.agents.unshare(mine(P, body, 'own').id, body.kind, body.who, actorOf(P)) })) });

  // ---------------------------------------------------------------- connected agents (WP2.14; DECISIONS E22, E23, C122 to C130)
  const slotCall = fn => {
    try { return ok(fn()); } catch (e) {
      if (e instanceof AgentApiError) throw new AuthError(e.status, e.code, e.message, e.retryAfter ? { retryAfter: e.retryAfter } : {});
      throw e;
    }
  };
  const slotId = body => { const n = Number(body && body.id); return Number.isInteger(n) && n > 0 ? n : 0; };
  // The agent's side: it signs, we never see its private key. Neither door accepts the other's credentials.
  router.add({ method: 'POST', path: '/api/agent-api/enroll', cap: 'public', principal: 'agent', auth: 'signature', handler: ({ body, ip }) => slotCall(() => d.agentApi.enrol({ code: body.code, publicKey: body.publicKey, signature: body.signature }, { ip })) });
  router.add({ method: 'POST', path: '/api/agent-api/session', cap: 'public', principal: 'agent', auth: 'signature', handler: ({ body, ip }) => slotCall(() => d.agentApi.openSession({ slot: body.slot, timestamp: body.timestamp, nonce: body.nonce, signature: body.signature }, { ip })) });
  // The mailbox (C125): what people wrote to the agent, held up to 24 hours; the agent's reports on its runs. The agent fetches with
  // a long-poll (wait up to 25 seconds); it can only report on runs given to it, and never approves or resolves anything itself (C129).
  router.add({ method: 'GET', path: '/api/agent-api/inbox', cap: 'public', principal: 'agent', auth: 'bearer', handler: async ({ req, url, A }) => {
    try { return ok(await d.agentApi.inbox(A, { waitSec: Number(url.searchParams.get('wait')) || 0, gone: () => !!(req.destroyed || (req.socket && req.socket.destroyed)), kit: String(req.headers['x-mvw-kit'] || '').slice(0, 20) || null })); }
    catch (e) { if (e instanceof AgentApiError) throw new AuthError(e.status, e.code, e.message, e.retryAfter ? { retryAfter: e.retryAfter } : {}); throw e; }
  } });
  router.add({ method: 'POST', path: '/api/agent-api/events', cap: 'public', principal: 'agent', auth: 'bearer', handler: ({ A, body }) => slotCall(() => d.agentApi.reportEvent(A, body)) });
  router.add({ method: 'GET', path: '/api/agent-api/me', cap: 'public', principal: 'agent', auth: 'bearer', handler: ({ A }) => ok({ agent: d.agentApi.view(A), edition: 'self-hosted', serverTime: Date.now() }) });
  // its own wake-up link, when its platform shows IT the address (server/agent-wakeup.js setByAgent: tried once, kept only
  // if it answers; its owner is told)
  router.add({ method: 'GET', path: '/api/agent-api/wakeup', cap: 'public', principal: 'agent', auth: 'bearer', handler: ({ A }) => ok({ wakeUp: d.wakeUps.view(A.id) }) });
  router.add({ method: 'POST', path: '/api/agent-api/wakeup', cap: 'public', principal: 'agent', auth: 'bearer', handler: async ({ A, body, ip }) => {
    try { return ok(await d.wakeUps.setByAgent(A, body || {}, { ip })); } catch (e) {
      if (e instanceof AgentApiError) throw new AuthError(e.status, e.code, e.message, e.retryAfter ? { retryAfter: e.retryAfter } : {});
      throw e;
    }
  } });
  // The owner's side, with a browser session (an agent token never reaches these): a code is shown once, revoke and a new code
  // need the password again.
  router.add({ method: 'GET', path: '/api/agent-slots', cap: 'agents.connect', handler: ({ P }) => ok({ agents: d.agentApi.list(P.account), apps: d.agentApi.appChoices(P.role) }) });
  router.add({ method: 'POST', path: '/api/agent-slots', cap: 'agents.connect', handler: ({ P, body, ip }) => slotCall(() => {
    // demo mode: a connected agent (a Grok Bot, say) counts toward the 3 agents like a built-in one
    if (d.demoAgentRoom && !d.demoAgentRoom()) throw new AuthError(403, 'licence_required', DEMO_FULL);
    return d.agentApi.createSlot(P.account, { name: body.name, app: body.app ?? null }, { ip, role: P.role });
  }) });
  router.add({ method: 'POST', path: '/api/agent-slots/remove', cap: 'agents.connect', handler: ({ P, body, ip }) => slotCall(() => d.agentApi.removeSlot(P.account, slotId(body), { ip })) });
  router.add({ method: 'POST', path: '/api/agent-slots/delete', cap: 'agents.connect', reauth: true, handler: ({ P, body, ip }) => slotCall(() => d.agentApi.deleteSlot(P.account, slotId(body), { ip })) });
  router.add({ method: 'POST', path: '/api/agent-slots/update', cap: 'agents.connect', handler: ({ P, body, ip }) => slotCall(() => ({ agent: d.agentApi.update(P.account, slotId(body), body, { ip }) })) });
  router.add({ method: 'POST', path: '/api/agent-slots/revoke', cap: 'agents.connect', reauth: true, handler: ({ P, body, ip }) => slotCall(() => ({ agent: d.agentApi.revoke(P.account, slotId(body), { ip }) })) });
  router.add({ method: 'POST', path: '/api/agent-slots/block', cap: 'agents.connect', handler: ({ P, body, ip }) => slotCall(() => ({ blocked: d.agentApi.block(P.account, slotId(body), Number(body.account), { ip }) })) });
  router.add({ method: 'POST', path: '/api/agent-slots/unblock', cap: 'agents.connect', handler: ({ P, body, ip }) => slotCall(() => ({ blocked: d.agentApi.unblock(P.account, slotId(body), Number(body.account), { ip }) })) });
  router.add({ method: 'GET', path: '/api/agent-slots/reports', cap: 'agents.connect', handler: ({ P, url }) => slotCall(() => d.agentApi.reports(P.account, Number(url.searchParams.get('id')))) });
  // a visitor reports an agent or one of its answers to its owner (C128); only someone who may see the agent can
  router.add({ method: 'POST', path: '/api/agent-reports', cap: 'chat.use', handler: ({ P, body, ip }) => slotCall(() => {
    const a = d.agents.get(Number(body.agent)), slot = a ? d.agentApi.slotOfAgentKey(a.key) : null;
    return d.agentApi.report(P.account, slot, { runId: body.run, reason: body.reason }, { ip });
  }) });
  // its owner's OK for a key that joined with the code, or not (2026-10-11): with a fresh password, like a new code
  // its wake-up link (server/agent-wakeup.js): setting, changing or removing it asks for the password again; trying it does not
  router.add({ method: 'POST', path: '/api/agent-slots/wakeup', cap: 'agents.connect', reauth: true, handler: ({ P, body, ip }) => slotCall(() => ({ wakeUp: d.wakeUps.set(P.account, slotId(body), body, { ip }) })) });
  router.add({ method: 'POST', path: '/api/agent-slots/wakeup/test', cap: 'agents.connect', handler: async ({ P, body }) => {
    try { return ok(await d.wakeUps.test(P.account, slotId(body))); } catch (e) {
      if (e instanceof AgentApiError) throw new AuthError(e.status, e.code, e.message, e.retryAfter ? { retryAfter: e.retryAfter } : {});
      throw e;
    }
  } });
  router.add({ method: 'POST', path: '/api/agent-slots/approve', cap: 'agents.connect', reauth: true, handler: ({ P, body, ip }) => slotCall(() => ({ agent: d.agentApi.approve(P.account, slotId(body), { ip }) })) });
  router.add({ method: 'POST', path: '/api/agent-slots/decline', cap: 'agents.connect', reauth: true, handler: ({ P, body, ip }) => slotCall(() => ({ agent: d.agentApi.decline(P.account, slotId(body), { ip }) })) });
  router.add({ method: 'POST', path: '/api/agent-slots/code', cap: 'agents.connect', reauth: true, handler: ({ P, body, ip }) => slotCall(() => {
    // demo mode: a revoked slot brought back counts again toward the 3 agents
    if (d.demoAgentRoom && d.agentApi.ownSlot(P.account, slotId(body)).status === 'revoked' && !d.demoAgentRoom()) throw new AuthError(403, 'licence_required', DEMO_FULL);
    return d.agentApi.newEnrolmentCode(P.account, slotId(body), { ip });
  }) });

  // ---------------------------------------------------------------- providers and connections (WP2.2; DECISIONS C60, A8, A9)
  const connCall = async fn => {
    try { return ok(await fn()); } catch (e) {
      if (e instanceof ConnectionError) throw new AuthError(e.status, e.code, e.message);
      throw e;
    }
  };
  const connId = body => { const n = Number(body && body.id); if (!Number.isInteger(n) || n < 1) throw new AuthError(400, 'bad_request', 'Which connection?'); return n; };
  // Every kind that works (nothing announces adapters still to come), whether this account may add one
  // (d.connections.addable: the same rule create() keeps), and the helper's state.
  // (a credential the server keeps for a connection itself - system: a device key - is never a field of a form)
  const pageKind = (P, k) => ({ ...k, fields: k.fields.filter(f => !f.system), addable: d.connections.addable(P, k) });
  router.add({ method: 'GET', path: '/api/providers', cap: 'connections.use', handler: ({ P }) => ok({
    kinds: d.registry.list().filter(k => k.implemented).map(k => pageKind(P, k)), host: d.host.status() }) });
  router.add({ method: 'GET', path: '/api/connections', cap: 'connections.use', handler: ({ P }) => ok({ connections: d.connections.visible(P).map(c => d.connections.view(P, c)) }) });
  router.add({ method: 'POST', path: '/api/connections', cap: 'connections.use', handler: ({ P, body }) => connCall(() => d.connections.view(P, d.connections.create(P, body || {}, actorOf(P)))) });
  router.add({ method: 'POST', path: '/api/connections/update', cap: 'connections.use', handler: ({ P, body }) => connCall(() => d.connections.view(P, d.connections.update(P, connId(body), body, actorOf(P)))) });
  router.add({ method: 'POST', path: '/api/connections/remove', cap: 'connections.use', handler: ({ P, body }) => connCall(() => ({ removed: d.connections.remove(P, connId(body), actorOf(P)).id })) });
  router.add({ method: 'POST', path: '/api/connections/share', cap: 'connections.use', handler: ({ P, body }) => connCall(() => ({ shares: d.connections.share(P, connId(body), body.kind, body.who, actorOf(P)) })) });
  router.add({ method: 'POST', path: '/api/connections/unshare', cap: 'connections.use', handler: ({ P, body }) => connCall(() => ({ shares: d.connections.unshare(P, connId(body), body.kind, body.who, actorOf(P)) })) });
  for (const action of ['test', 'refresh', 'discover']) {
    router.add({ method: 'POST', path: `/api/connections/${action}`, cap: 'connections.use', handler: ({ P, body }) => connCall(() => d.connections.probe(P, connId(body), action, actorOf(P))) });
  }

  // ---------------------------------------------------------------- Agent Providers (docs/features/agent-providers.md)
  // The live provider connections (OpenClaw): their state, their agents; finding one on this machine (administrators: it
  // looks at this machine and the local network); connecting one again now; listing its agents again.
  const provCall = async fn => {
    try { return ok(await fn()); } catch (e) {
      if (e instanceof ProviderError || e instanceof ConnectionError) throw new AuthError(e.status, e.code, e.message);
      // (what the provider refused, in its own words: a request it found wrong - a stale base hash, a bad value - is the
      // person's to fix; anything else is the provider's or the link's)
      // (conflict: changed elsewhere meanwhile - read again; not_found: gone on the provider; unavailable: busy, retry shortly)
      if (e instanceof HostError) throw new AuthError(['INVALID_REQUEST', 'unsupported', 'bad_request', 'conflict'].includes(e.code) ? 400 : e.code === 'not_found' ? 404 : ['UNAVAILABLE', 'unavailable'].includes(e.code) ? 503 : 502, e.code || 'provider_error', e.message || 'The provider failed');
      throw e;
    }
  };
  router.add({ method: 'GET', path: '/api/agent-providers', cap: 'connections.use', handler: ({ P }) => ok({
    providers: d.agentProviders.list(P), kinds: d.registry.list().filter(k => k.implemented && k.live).map(k => pageKind(P, k)), host: d.host.status() }) });
  router.add({ method: 'POST', path: '/api/agent-providers/detect', cap: 'connections.manage', handler: ({ body }) => provCall(() => d.agentProviders.detect(String((body && body.kind) || ''))) });
  router.add({ method: 'POST', path: '/api/agent-providers/reconnect', cap: 'connections.use', handler: ({ P, body }) => provCall(() => d.agentProviders.reconnect(P, connId(body))) });
  router.add({ method: 'POST', path: '/api/agent-providers/remove', cap: 'connections.use', handler: ({ P, body }) => provCall(() => d.agentProviders.remove(P, connId(body), actorOf(P))) });
  // a call of a provider's sub-menu (its managers only; its listed calls only; changes are audited)
  // (a change - the provider's settings, its approval rules, its agents - needs the password entered within the last 10
  // minutes, like the world's own destructive edits: a stolen session alone never reconfigures the agent platform)
  router.add({ method: 'POST', path: '/api/agent-providers/call', cap: 'connections.use', handler: ({ P, body }) => provCall(() => {
    const id = connId(body), method = body && body.method;
    if (d.agentProviders.isChange(P, id, method) && !(P.session && Date.now() - P.session.authAt <= LIMITS.reauthMs)) {
      throw new AuthError(403, 'reauth_required', 'Changing the agent platform needs your password: confirm it to continue');
    }
    return d.agentProviders.menu(P, id, method, body && body.params, actorOf(P));
  }) });
  router.add({ method: 'POST', path: '/api/agent-providers/sync', cap: 'connections.use', handler: ({ P, body }) => provCall(async () => {
    const c = d.connections.need(P, connId(body), 'manage');
    await d.agentProviders.syncAgents(c.id);
    return d.agentProviders.view(P, d.connections.get(c.id));
  }) });

  // ---------------------------------------------------------------- chat over the providers (WP2.2; DECISIONS C11, C14, C53, C119, C120, A8, A9)
  const chatCall = async fn => {
    try { return ok(await fn()); } catch (e) {
      if (e instanceof ChatError || e instanceof AttachmentError) throw new AuthError(e.status, e.code, e.message);
      throw e;
    }
  };
  const qnum = (url, k) => { const v = url.searchParams.get(k); return v !== null && /^\d{1,15}$/.test(v) ? Number(v) : null; };
  const need = (v, what) => { if (v === null || v === undefined) throw new AuthError(400, 'bad_request', `${what} is required`); return v; };
  router.add({ method: 'GET', path: '/api/chat-sessions', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.listSessions(P, need(qnum(url, 'agent'), 'agent'))) });
  router.add({ method: 'POST', path: '/api/chat-sessions/create', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => ({ session: d.chat.createSession(P, body.agent, body.label) })) });
  router.add({ method: 'POST', path: '/api/chat-sessions/switch', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.switchSession(P, body.agent, body.session)) });
  router.add({ method: 'POST', path: '/api/chat-sessions/rename', cap: 'chat.use', handler: ({ P, body }) => chatCall(async () => ({ session: await d.chat.renameSession(P, body.agent, body.session, body.label) })) });
  router.add({ method: 'POST', path: '/api/chat-sessions/delete', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.deleteSession(P, body.agent, body.session)) });
  router.add({ method: 'POST', path: '/api/providers/runs', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.startRun(P, body)) });
  router.add({ method: 'GET', path: '/api/providers/runs/events', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.events(P, url.searchParams.get('run') || '', qnum(url, 'since') || 0)) });
  router.add({ method: 'POST', path: '/api/providers/interrupt', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.stop(P, body.run)) });
  router.add({ method: 'POST', path: '/api/providers/approvals', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.approve(P, body.run, body.approval, body.approved, body.decision ?? null)) });
  // live activity in an open provider session (Agent Providers): watched while the chat is open
  // the media of a provider's answers (Agent Providers: an agent's images, video, audio): only at an address this server
  // signed for that agent and session, for whoever may read that session; streamed from the cache, byte ranges for video
  router.add({ method: 'GET', path: '/api/providers/media', cap: 'chat.use', handler: async ({ P, url }) => {
    let f;
    try { f = await d.chat.mediaFile(P, need(qnum(url, 'agent'), 'agent'), need(qnum(url, 'session'), 'session'), url.searchParams.get('r'), url.searchParams.get('s')); }
    catch (e) {
      if (e instanceof ChatError && e.status === 404) throw new AuthError(404, 'not_found', 'No such attachment');
      // (what the provider said: the file is not one this session may show, too large, gone)
      throw new AuthError(e instanceof ChatError && e.code === 'too_large' ? 413 : 502, (e && e.code) || 'unavailable', (e && e.message) || 'The provider did not send it');
    }
    const inline = INLINE_MEDIA.test(f.mime);
    return { file: { path: f.file, size: f.size }, headers: { 'content-type': inline ? f.mime : 'application/octet-stream', 'cache-control': 'private, max-age=3600',
      'content-disposition': inline ? 'inline' : 'attachment', 'content-security-policy': "sandbox; default-src 'none'" } };
  } });
  // the progress card brought up to date by the agent (OpenClaw's Refresh task progress)
  router.add({ method: 'POST', path: '/api/providers/progress/refresh', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.refreshCard(P, need(body && body.agent, 'agent'), need(body && body.session, 'session'), body.key ?? null)) });
  // (scope=agent: all of the agent's tasks, wherever they started - then no chat need be named)
  const taskScope = v => (v === 'agent' ? 'agent' : 'chat');
  router.add({ method: 'GET', path: '/api/providers/tasks', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.tasks(P, need(qnum(url, 'agent'), 'agent'), qnum(url, 'session'), taskScope(url.searchParams.get('scope')))) });
  router.add({ method: 'GET', path: '/api/providers/tasks/one', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.task(P, need(qnum(url, 'agent'), 'agent'), qnum(url, 'session'), need(url.searchParams.get('task'), 'task'), taskScope(url.searchParams.get('scope')))) });
  router.add({ method: 'GET', path: '/api/providers/tasks/history', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.taskHistory(P, need(qnum(url, 'agent'), 'agent'), qnum(url, 'session'), need(url.searchParams.get('task'), 'task'), url.searchParams.get('cursor'), taskScope(url.searchParams.get('scope')))) });
  // the provider's own calls for its chat view (Hermes: slash commands as its Desktop runs them, / and @ suggestions, side
  // questions): one of that provider's, on the chat's session, for whoever manages the provider
  router.add({ method: 'POST', path: '/api/providers/native', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.native(P, need(body && body.agent, 'agent'), body.session ?? null, need(body.method, 'method'), body.params || {}, typeof body.preview === 'string' ? body.preview : null)) });
  router.add({ method: 'POST', path: '/api/providers/archive', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.archiveSession(P, need(body && body.agent, 'agent'), need(body.session, 'session'))) });
  router.add({ method: 'POST', path: '/api/providers/branch', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.branchSession(P, need(body && body.agent, 'agent'), need(body.session, 'session'), body.upto)) });
  router.add({ method: 'POST', path: '/api/providers/tasks/steer', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.steerTask(P, need(body && body.agent, 'agent'), body.session ?? null, need(body.task, 'task'), body.text, taskScope(body.scope))) });
  router.add({ method: 'POST', path: '/api/providers/tasks/cancel', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.cancelTask(P, need(body && body.agent, 'agent'), body.session ?? null, need(body.task, 'task'), taskScope(body.scope))) });
  router.add({ method: 'GET', path: '/api/providers/browser', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.browser(P, need(qnum(url, 'agent'), 'agent'), url.searchParams.get('tab'))) });
  router.add({ method: 'POST', path: '/api/providers/browser', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.browserAct(P, need(body && body.agent, 'agent'), body)) });
  // the live picture: the tab's next frame after `after` (a JPEG, with the page's address and size), or 204 - none yet
  router.add({ method: 'GET', path: '/api/providers/browser/frame', cap: 'chat.use', handler: async ({ P, url }) => {
    let f;
    try { f = await d.chat.browserFrame(P, need(qnum(url, 'agent'), 'agent'), need(url.searchParams.get('tab'), 'tab'), qnum(url, 'after') || 0); }
    catch (e) { if (e instanceof ChatError) throw new AuthError(e.status, e.code, e.message); throw e; }
    const h = { 'cache-control': 'no-store', 'x-frame-seq': String(f.seq || 0) };
    if (!f.jpeg) return { status: 204, body: Buffer.alloc(0), headers: h };
    return { body: Buffer.from(f.jpeg, 'base64'), headers: { ...h, 'content-type': 'image/jpeg', 'x-page-width': String(f.head.cssWidth), 'x-page-height': String(f.head.cssHeight),
      'x-page-url': encodeURIComponent(f.head.url || '') } };
  } });
  // the agent's own screen (Hermes' Bot Desktop): its state and controls, and one picture of it now (a JPEG, or 204 - not
  // running, or a person has control); the live screen itself is a WebSocket, /api/providers/screen/ws (server/providers/screen-relay.js)
  router.add({ method: 'GET', path: '/api/providers/screen', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.screen(P, need(qnum(url, 'agent'), 'agent'))) });
  router.add({ method: 'POST', path: '/api/providers/screen', cap: 'chat.use', handler: ({ P, body }) => {
    // (its browser put on its screen or taken off: the provider's own settings changed - a recent password, as its sub-menu's changes)
    if (body && body.action === 'browser' && !(P.session && Date.now() - P.session.authAt <= LIMITS.reauthMs)) throw new AuthError(403, 'reauth_required', 'Changing the agent platform needs your password: confirm it to continue');
    return chatCall(() => d.chat.screenAct(P, need(body && body.agent, 'agent'), body));
  } });
  router.add({ method: 'GET', path: '/api/providers/screen/thumb', cap: 'chat.use', handler: async ({ P, url }) => {
    let f;
    try { f = await d.chat.screenThumb(P, need(qnum(url, 'agent'), 'agent')); }
    catch (e) { if (e instanceof ChatError) throw new AuthError(e.status, e.code, e.message); throw e; }
    if (!f || !f.jpeg) return { status: 204, body: Buffer.alloc(0), headers: { 'cache-control': 'no-store' } };
    return { body: Buffer.from(f.jpeg, 'base64'), headers: { 'cache-control': 'no-store', 'content-type': 'image/jpeg' } };
  } });
  router.add({ method: 'POST', path: '/api/providers/progress/dismiss', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.dismissCard(P, need(body && body.agent, 'agent'), need(body && body.session, 'session'), body.revision)) });
  router.add({ method: 'POST', path: '/api/providers/watch', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.watch(P, body.agent, body.session, body.on !== false)) });
  // what the agent asks the person (Agent Providers: its questions), and the slash commands it takes
  router.add({ method: 'POST', path: '/api/providers/questions', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.answer(P, body.run, body.question, { answers: body.answers ?? null, cancel: body.cancel === true })) });
  router.add({ method: 'GET', path: '/api/providers/commands', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.commands(P, need(qnum(url, 'agent'), 'agent'), qnum(url, 'session'))) });
  // approvals waiting on visitors' runs of the agents this account owns (C129)
  router.add({ method: 'GET', path: '/api/providers/approvals', cap: 'chat.use', handler: ({ P }) => chatCall(() => d.chat.pendingApprovals(P)) });
  router.add({ method: 'GET', path: '/api/providers/history', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.history(P, need(qnum(url, 'agent'), 'agent'), need(qnum(url, 'session'), 'session'))) });
  router.add({ method: 'GET', path: '/api/providers/models', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.models(P, need(qnum(url, 'agent'), 'agent'))) });
  router.add({ method: 'GET', path: '/api/providers/task', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.taskProgress(P, need(qnum(url, 'agent'), 'agent'), qnum(url, 'session'))) });
  // references: shared by everyone who may use the agent; whoever manages the agent changes them (C53)
  router.add({ method: 'GET', path: '/api/chat-references', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => { const a = d.chat.agentFor(P, need(qnum(url, 'agent'), 'agent')); return { references: d.references.list(a.id), canManage: d.agents.canManage(P, a) }; }) });
  router.add({ method: 'POST', path: '/api/chat-references/add', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => {
    const a = d.chat.agentFor(P, body.agent);
    if (!d.agents.canManage(P, a)) throw new ChatError(403, 'forbidden', 'Only whoever manages this agent may change its references');
    const r = d.references.add(a.id, body, P.account.id);
    if (r.error) throw new ChatError(400, r.error, r.message);
    return r;
  }) });
  router.add({ method: 'POST', path: '/api/chat-references/remove', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => {
    const a = d.chat.agentFor(P, body.agent);
    if (!d.agents.canManage(P, a)) throw new ChatError(403, 'forbidden', 'Only whoever manages this agent may change its references');
    return { removed: d.references.remove(a.id, body.id) };
  }) });
  // attachments: a raw upload (the file is the body; its name is ?name=), private to the account (C121)
  router.add({ method: 'POST', path: '/api/chat/attachments', cap: 'chat.use', raw: true, handler: ({ P, req, url }) => chatCall(async () => {
    const len = /^\d{1,15}$/.test(String(req.headers['content-length'] || '')) ? Number(req.headers['content-length']) : null;
    try { return { attachment: await d.attachments.store(P.account.id, url.searchParams.get('name') || '', req, len) }; }
    catch (e) { req.resume(); throw e; }   // a refused upload is read and dropped, so the client still receives the answer
  }) });
  router.add({ method: 'GET', path: '/api/chat/attachments', cap: 'chat.use', handler: ({ P }) => ok({ attachments: d.attachments.list(P.account.id), used: d.attachments.used(P.account.id), ...d.attachments.limits() }) });
  router.add({ method: 'POST', path: '/api/chat/attachments/delete', cap: 'chat.use', handler: ({ P, body }) => {
    const f = d.attachments.remove(P.account.id, need(body.id, 'id'));
    if (!f) throw new AuthError(404, 'not_found', 'No such attachment');   // someone else's, or gone: not confirmed
    return ok({ deleted: f.id, used: d.attachments.used(P.account.id) });
  } });
  // one of the account's own attachments, to show it again in a chat (an image, a PDF, a video or recording opens; anything
  // else downloads) - from the disk in byte ranges: a video plays and seeks
  router.add({ method: 'GET', path: '/api/chat/attachments/file', cap: 'chat.use', handler: ({ P, url }) => {
    const f = d.attachments.pathOf(P.account.id, url.searchParams.get('id') || '');
    let size = null;
    try { size = f ? fs.statSync(f.path).size : null; } catch { size = null; }
    if (size === null) throw new AuthError(404, 'not_found', 'No such attachment');   // someone else's, or gone: not confirmed
    const inline = /^image\/(png|jpeg|gif|webp)$/.test(f.mime) || f.mime === 'application/pdf' || /^(video|audio)\//.test(f.mime);
    const name = String(f.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 100);
    return { file: { path: f.path, size }, headers: { 'content-type': f.mime, 'cache-control': 'private, max-age=86400', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"` } };
  } });
  router.add({ method: 'GET', path: '/api/providers/limits', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.limits(P, need(qnum(url, 'agent'), 'agent'))) });
  // the chat window: every chat of the account (any agent), search through them, and a chat's own model and effort
  router.add({ method: 'GET', path: '/api/chat/recent', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.recent(P, qnum(url, 'agent'), qnum(url, 'project'))) });
  // projects: an account's folders of chats with one agent, with their own instructions (CHAT.md §12)
  router.add({ method: 'GET', path: '/api/chat/projects', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.listProjects(P, need(qnum(url, 'agent'), 'agent'))) });
  router.add({ method: 'POST', path: '/api/chat/projects/create', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.createProject(P, body.agent, body)) });
  router.add({ method: 'POST', path: '/api/chat/projects/update', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.updateProject(P, body.agent, body.project, body)) });
  router.add({ method: 'POST', path: '/api/chat/projects/delete', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.deleteProject(P, body.agent, body.project)) });
  router.add({ method: 'POST', path: '/api/chat-sessions/move', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.moveSession(P, body.agent, body.session, body.project ?? null)) });
  router.add({ method: 'GET', path: '/api/chat/can', cap: 'chat.use', handler: ({ P, url }) => ok(d.chat.canChat(P, qnum(url, 'agent'))) });
  router.add({ method: 'GET', path: '/api/chat/search', cap: 'chat.use', handler: ({ P, url }) => chatCall(() => d.chat.search(P, url.searchParams.get('q') || '', qnum(url, 'agent'))) });
  router.add({ method: 'POST', path: '/api/chat-sessions/prefs', cap: 'chat.use', handler: ({ P, body }) => chatCall(() => d.chat.setPrefs(P, body.agent, body.session, body)) });
  // ---------------------------------------------------------------- notifications (docs/features/CHAT.md §8): the bell and push
  const noteCall = fn => { try { return ok(fn()); } catch (e) { if (e && e.status && e.code) throw new AuthError(e.status, e.code, e.message); throw e; } };
  const signedIn = P => { if (!P.account) throw new AuthError(401, 'signin_required', 'Sign in first'); return P.account.id; };
  router.add({ method: 'GET', path: '/api/notifications', cap: 'account.self', handler: ({ P, url }) => noteCall(() => d.notifications.list(signedIn(P), { before: qnum(url, 'before'), limit: qnum(url, 'limit'), agent: qnum(url, 'agent') })) });
  router.add({ method: 'POST', path: '/api/notifications/read', cap: 'account.self', handler: ({ P, body }) => noteCall(() => d.notifications.read(signedIn(P), { id: body.id, all: body.all === true, approval: typeof body.approval === 'string' ? body.approval.slice(0, 64) : null, agent: body.agent, session: body.session })) });
  router.add({ method: 'GET', path: '/api/notifications/push/key', cap: 'account.self', handler: ({ P }) => noteCall(() => { signedIn(P); return { publicKey: d.notifications.publicKey() }; }) });
  router.add({ method: 'POST', path: '/api/notifications/push/subscribe', cap: 'account.self', handler: ({ P, body }) => noteCall(() => d.notifications.subscribe(signedIn(P), body.subscription, typeof body.device === 'string' ? body.device : '')) });
  router.add({ method: 'POST', path: '/api/notifications/push/unsubscribe', cap: 'account.self', handler: ({ P, body }) => noteCall(() => d.notifications.unsubscribe(signedIn(P), body.endpoint)) });
  router.add({ method: 'POST', path: '/api/notifications/push/test', cap: 'account.self', handler: async ({ P }) => {
    const id = signedIn(P);
    const r = await d.notifications.pushTo(id, { title: 'My Virtual World', body: 'Notifications work on this device.', url: '/', tag: 'test' });
    return ok(r);
  } });

  // ---------------------------------------------------------------- players, friends, status (WP1.10, C118)
  const friendCall = fn => {
    try { return ok(fn()); } catch (e) {
      if (e && e.code && e.status) throw new AuthError(e.status, e.code, e.message);
      throw e;
    }
  };
  const who = body => (Number.isInteger(body.id) ? { id: body.id } : { name: text(body.name, 64) });
  router.add({ method: 'GET', path: '/api/players/online', cap: 'players.online', handler: ({ P }) => ok({ list: d.players.onlineFor(P) }) });
  router.add({ method: 'GET', path: '/api/friends', cap: 'players.friends', handler: ({ P }) => ok(d.friends.list(P.account.id)) });
  router.add({ method: 'POST', path: '/api/friends/request', cap: 'players.friends', handler: ({ P, body }) => friendCall(() => d.friends.request(P.account.id, who(body))) });
  router.add({ method: 'POST', path: '/api/friends/accept', cap: 'players.friends', handler: ({ P, body }) => friendCall(() => d.friends.accept(P.account.id, who(body))) });
  router.add({ method: 'POST', path: '/api/friends/remove', cap: 'players.friends', handler: ({ P, body }) => friendCall(() => d.friends.remove(P.account.id, who(body))) });

  // ---------------------------------------------------------------- WebSocket messages (text frames)
  const ws = Object.freeze({
    ping: { cap: 'world.view', handle: (conn, m) => d.send(conn, { t: 'pong', id: typeof m.id === 'number' ? m.id : null, serverTime: d.realNow(), clock: d.sim().clock }) },
    resync: { cap: 'world.view', handle: conn => { conn.needSnap = true; } },
    // the player stream (WP1.10): where this page is looking, and its player's moves, look, camera and mode
    pview: { cap: 'world.view', handle: (conn, m) => d.players.view(conn, m) },
    pmove: { cap: 'players.move', handle: (conn, m) => d.players.move(conn, m) },
    pobserve: { cap: 'players.move', handle: (conn, m) => d.players.observe(conn, !!m.on) },
    plook: { cap: 'players.move', handle: (conn, m) => d.players.setLook(conn, m) },
    pcam: { cap: 'players.move', handle: (conn, m) => d.players.setCam(conn, m) },
    phome: { cap: 'players.move', handle: conn => d.players.goHome(conn) },
    phomeat: { cap: 'players.move', handle: conn => d.players.homeAt(conn) },
    ptravel: { cap: 'players.move', handle: (conn, m) => d.players.travel(conn, m) },
    pwarp: { cap: 'players.warp', handle: (conn, m) => d.players.warp(conn, m) },
    vcommand: { cap: 'players.move', handle: (conn, m) => d.vehicles?.command(conn, m) },
    vinput: { cap: 'players.move', handle: (conn, m) => d.vehicles?.controls(conn, m) },
    vpose: { cap: 'players.move', handle: (conn, m) => d.vehicles?.pose(conn, m) },
    vphysics: { cap: 'players.move', handle: (conn, m) => d.vehicles?.physicsMode(conn, m) },
    vresync: { cap: 'world.view', handle: (conn, m) => d.vehicles?.resync(conn, m) },
    // the airport's aircraft (server/world/aircraft.js): board one, its poses as it flies, get out, crashed
    fboard: { cap: 'play.use', handle: (conn, m) => d.fleet?.board(conn, m) },
    fpose: { cap: 'play.use', handle: (conn, m) => d.fleet?.pose(conn, m) },
    fexit: { cap: 'play.use', handle: conn => d.fleet?.exit(conn) },
    fcrash: { cap: 'play.use', handle: (conn, m) => d.fleet?.crash(conn, m) },
    fleave: { cap: 'play.use', handle: conn => d.fleet?.leave(conn) },
    bboard: { cap: 'play.use', handle: (conn, m) => d.harbour?.board(conn, m) },
    bpose: { cap: 'play.use', handle: (conn, m) => d.harbour?.pose(conn, m) },
    bexit: { cap: 'play.use', handle: conn => d.harbour?.exit(conn) },
    bleave: { cap: 'play.use', handle: conn => d.harbour?.leave(conn) },
    say: { cap: 'players.chat', handle: (conn, m) => d.players.say(conn, m) },
  });
  for (const [t, m] of Object.entries(ws)) if (!CAPS[m.cap]) throw new Error(`WebSocket message ${t}: unknown capability "${m.cap}"`);
  return { router, ws, me, health };
}
