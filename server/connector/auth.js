// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI apps connecting to the world (2026-10-10; the product owner: people should "directly connect their ai agent into the
// world" — Grok first, then ChatGPT, Gemini, Meta's Muse, Claude…). Each of those AI apps is an MCP client; the world is
// the MCP server (./mcp.js) AND its OAuth 2.1 authorization server, following the MCP authorization specification
// (revision 2026-07-28):
// - discovery: protected resource metadata (RFC 9728) names this server as the authorization server; its metadata
//   (RFC 8414) lists the endpoints, PKCE S256 only, client ID metadata documents and dynamic registration supported, and
//   the iss parameter in authorization responses (RFC 9207). (served by ./http.js)
// - which app is asking: a client ID metadata document (the client_id is an https URL whose JSON names the app and its
//   redirect URIs; fetched through the public-internet guard, never a private address, small and quick, cached an hour),
//   or a registration (RFC 7591, kept for older apps; rate-limited per address).
// - the person decides: an authorization request is checked (the app, the exact redirect URI — a loopback one with any
//   port —, response type code, PKCE S256, the resource being this world's MCP endpoint, the scope) and parked for ten
//   minutes; the consent page shows who asks and lets the person pick which of THEIR agents the app acts as, or say no.
//   Saying yes makes a grant (account, agent, app) and a single-use code (one minute).
// - tokens: the code with the PKCE verifier (and the app's secret if it registered one) gives a short access token (an
//   hour) bound to this world's MCP endpoint and a refresh token (30 days) that is replaced at every use; a refresh token
//   used twice, or a code used twice, ends the whole grant (one of them was stolen). Only hashes are stored.
// - the person sees every app that acts for them and disconnects it (/api/connector/grants); an app's grant also ends
//   with the agent, or when the account can no longer act.
import crypto from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import { guardedLookup, privateAddress } from '../providers/models.js';

const MIN = 60e3, DAY = 86400e3;
export const CONNECTOR_LIMITS = Object.freeze({
  requestMs: 10 * MIN, codeMs: MIN, accessMs: 60 * MIN, refreshMs: 30 * DAY,
  registrationsPerHour: 20, docBytes: 16 * 1024, docTimeoutMs: 5000, docCacheMs: 60 * MIN, maxRedirectUris: 10, touchMs: MIN,
});
export const SCOPE = 'agent';
export const SCOPES = Object.freeze({ agent: 'Act as one of your agents in the world: see what it sees and knows, talk, work and post for it' });

/** An OAuth error: code is the OAuth error code (invalid_request, invalid_client, invalid_grant…). */
export class ConnectorError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (code, message, status = 400) => new ConnectorError(status, code, message);
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rnd = (n = 32) => crypto.randomBytes(n).toString('base64url');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

/**
 * A redirect URI an app may use: https anywhere; http only to this computer (a desktop app's loopback listener); or a
 * private-use scheme named after a domain (com.example.app:/callback, RFC 8252). Never a fragment.
 */
export function redirectOk(uri) {
  let u;
  try { u = new URL(String(uri)); } catch { return false; }
  if (String(uri).length > 500 || u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname);
  return /^[a-z][a-z0-9+-]*(\.[a-z0-9+-]+)+:$/.test(u.protocol);
}
/** Whether a redirect URI given at authorization is one the app registered (a loopback one: any port, RFC 8252 §7.3). */
export function redirectMatches(registered, given) {
  if (registered.includes(given)) return true;
  let g;
  try { g = new URL(given); } catch { return false; }
  if (g.protocol !== 'http:' || !LOOPBACK.has(g.hostname)) return false;
  return registered.some(r => { try { const u = new URL(r); return u.protocol === 'http:' && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search; } catch { return false; } });
}

/** Fetches a client ID metadata document: https only, public addresses only (checked at connect), no redirects, small. */
export function fetchClientDocument(url, { timeoutMs = CONNECTOR_LIMITS.docTimeoutMs, maxBytes = CONNECTOR_LIMITS.docBytes } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { reject(bad('invalid_client', 'The client_id is not a URL')); return; }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (u.protocol !== 'https:' || (net.isIP(host) && privateAddress(host))) { reject(bad('invalid_client', 'The client_id must be an https address on the public internet')); return; }
    const req = https.request(u, { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'MyVirtualWorld-OAuth/1' }, lookup: guardedLookup, autoSelectFamily: false, timeout: timeoutMs }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(bad('invalid_client', `The app's client document answered ${res.statusCode}`)); return; }
      const chunks = []; let size = 0;
      res.on('data', c => { size += c.length; if (size > maxBytes) { req.destroy(bad('invalid_client', 'The app\'s client document is too large')); return; } chunks.push(c); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('invalid_client', 'The app\'s client document is not JSON')); } });
      res.on('error', e => reject(e));
    });
    req.on('timeout', () => req.destroy(bad('invalid_client', 'The app\'s client document did not arrive in time')));
    req.on('error', e => reject(e instanceof ConnectorError ? e : bad('invalid_client', e.code === 'blocked' ? 'The app\'s client document is not on the public internet' : 'The app\'s client document could not be fetched')));
    req.end();
  });
}

/** An address compared without case in scheme and host and without a trailing slash; null when it isn't one. */
const normResource = s => { try { const u = new URL(s); return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return null; } };

export class ConnectorAuth {
  /**
   * @param {object} store   openDb() result
   * @param {object} o
   * @param {object} o.accounts  Accounts (an account's principal for the app: connectorPrincipal)
   * @param {object} o.agents    Agents (which agents a person may hand to an app)
   * @param {object} [o.audit] [o.log] [o.now]
   * @param {(url: string) => Promise<object>} [o.fetchDocument]  client ID metadata documents (tests use a fake)
   */
  constructor(store, { accounts, agents, audit = null, log = () => {}, now = () => Date.now(), fetchDocument = fetchClientDocument, slots = null }) {
    // slots: the person's connected agents (server/agent-api.js) — { notConnected(accountId), connect(account, slotId, { ip, app }) → agent id,
    // ownsLiving(account, agent) }: an app may live as one, connecting it through this consent
    Object.assign(this, { store, accounts, agents, audit, log, now, fetchDocument, slots });
    this.w = store.worldId;
    this.registrations = new Map();   // address → [times] (registrations in the last hour)
    const db = store.db;
    this.q = {
      client: db.prepare('SELECT * FROM mcp_clients WHERE world_id = ? AND id = ?'),
      putClient: db.prepare(`INSERT INTO mcp_clients (id, world_id, kind, name, uri, logo, redirect_uris, auth_method, secret_hash, created, fetched, ip)
        VALUES ($id, $w, $kind, $name, $uri, $logo, $redirects, $auth, $secret, $now, $fetched, $ip)
        ON CONFLICT (world_id, id) DO UPDATE SET name = excluded.name, uri = excluded.uri, logo = excluded.logo, redirect_uris = excluded.redirect_uris, fetched = excluded.fetched`),
      reqAdd: db.prepare(`INSERT INTO mcp_requests (id_hash, world_id, client_id, redirect_uri, state, challenge, scope, resource, created, expires)
        VALUES ($hash, $w, $client, $redirect, $state, $challenge, $scope, $resource, $now, $exp)`),
      reqGet: db.prepare('SELECT * FROM mcp_requests WHERE world_id = ? AND id_hash = ?'),
      reqTake: db.prepare('DELETE FROM mcp_requests WHERE world_id = ? AND id_hash = ? RETURNING *'),
      reqPurge: db.prepare('DELETE FROM mcp_requests WHERE world_id = ? AND expires < ?'),
      grantFind: db.prepare('SELECT * FROM mcp_grants WHERE world_id = ? AND account_id = ? AND agent_id = ? AND client_id = ? AND revoked IS NULL'),
      grantAdd: db.prepare(`INSERT INTO mcp_grants (world_id, account_id, agent_id, client_id, client_name, scope, resource, created)
        VALUES ($w, $acc, $agent, $client, $name, $scope, $resource, $now)`),
      grant: db.prepare('SELECT * FROM mcp_grants WHERE world_id = ? AND id = ?'),
      grantsOf: db.prepare('SELECT * FROM mcp_grants WHERE world_id = ? AND account_id = ? AND revoked IS NULL ORDER BY created DESC'),
      grantTouch: db.prepare('UPDATE mcp_grants SET last_used = ? WHERE world_id = ? AND id = ?'),
      grantRevoke: db.prepare('UPDATE mcp_grants SET revoked = ? WHERE world_id = ? AND id = ? AND revoked IS NULL'),
      grantsRevokeAccount: db.prepare('UPDATE mcp_grants SET revoked = ? WHERE world_id = ? AND account_id = ? AND revoked IS NULL'),
      codeAdd: db.prepare(`INSERT INTO mcp_codes (code_hash, world_id, grant_id, client_id, redirect_uri, challenge, resource, created, expires)
        VALUES ($hash, $w, $grant, $client, $redirect, $challenge, $resource, $now, $exp)`),
      code: db.prepare('SELECT * FROM mcp_codes WHERE world_id = ? AND code_hash = ?'),
      codeUse: db.prepare('UPDATE mcp_codes SET used = ? WHERE world_id = ? AND code_hash = ? AND used IS NULL'),
      codesPurge: db.prepare('DELETE FROM mcp_codes WHERE world_id = ? AND expires < ?'),
      tokenAdd: db.prepare('INSERT INTO mcp_tokens (token_hash, world_id, grant_id, kind, resource, created, expires) VALUES ($hash, $w, $grant, $kind, $resource, $now, $exp)'),
      token: db.prepare('SELECT * FROM mcp_tokens WHERE world_id = ? AND token_hash = ?'),
      tokenUse: db.prepare('UPDATE mcp_tokens SET used = ? WHERE world_id = ? AND token_hash = ? AND used IS NULL'),
      tokenDel: db.prepare('DELETE FROM mcp_tokens WHERE world_id = ? AND token_hash = ?'),
      tokensDropGrant: db.prepare('DELETE FROM mcp_tokens WHERE world_id = ? AND grant_id = ?'),
      tokensPurge: db.prepare('DELETE FROM mcp_tokens WHERE world_id = ? AND expires < ?'),
    };
  }

  // ------------------------------------------------------------------------------------------- apps
  /** RFC 7591: an app registers itself (no person involved yet). → the registration response. */
  register(body, { ip = null } = {}) {
    const b = body && typeof body === 'object' ? body : {};
    // (a refusal is logged with what the app asked for — no secrets are in a registration — so an app that can't register
    // can be understood from the server's log)
    const no = (code, msg, status) => {
      const asked = JSON.stringify({ client_name: b.client_name, redirect_uris: b.redirect_uris, token_endpoint_auth_method: b.token_endpoint_auth_method, grant_types: b.grant_types, response_types: b.response_types });
      this.log(`[connector] registration refused (${code}): ${msg} · ${asked.slice(0, 500)}`);
      return bad(code, msg, status);
    };
    const now = this.now(), key = ip || '-', recent = (this.registrations.get(key) || []).filter(t => now - t < 3600e3);
    if (recent.length >= CONNECTOR_LIMITS.registrationsPerHour) throw no('slow_down', 'Too many registrations from this address; try again later', 429);
    const redirects = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
    if (!redirects.length || redirects.length > CONNECTOR_LIMITS.maxRedirectUris) throw no('invalid_redirect_uri', `Give 1 to ${CONNECTOR_LIMITS.maxRedirectUris} redirect_uris`);
    const wrong = redirects.find(u => !redirectOk(u));
    if (wrong) throw no('invalid_redirect_uri', `Not an allowed redirect URI (https, http to localhost, or an app scheme): ${wrong.slice(0, 120)}`);
    const auth = b.token_endpoint_auth_method === undefined ? 'none' : String(b.token_endpoint_auth_method);
    if (!['none', 'client_secret_post', 'client_secret_basic'].includes(auth)) throw no('invalid_client_metadata', 'token_endpoint_auth_method: none, client_secret_post or client_secret_basic');
    for (const [k, allowed] of [['grant_types', ['authorization_code', 'refresh_token']], ['response_types', ['code']]]) {
      if (b[k] !== undefined && (!Array.isArray(b[k]) || b[k].some(x => !allowed.includes(x)))) throw no('invalid_client_metadata', `${k}: only ${allowed.join(', ')}`);
    }
    const name = clean(b.client_name, 80) || 'An AI app';
    const id = `mvwc_${rnd(18)}`, secret = auth === 'none' ? null : `mvws_${rnd(32)}`;
    const uri = this.httpsOrNull(b.client_uri), logo = this.httpsOrNull(b.logo_uri);
    this.q.putClient.run({ id, w: this.w, kind: 'registered', name, uri, logo, redirects: JSON.stringify(redirects), auth, secret: secret ? sha256(secret) : null, now, fetched: null, ip });
    recent.push(now); this.registrations.set(key, recent);
    if (this.registrations.size > 5000) for (const [k, v] of this.registrations) if (!v.some(t => now - t < 3600e3)) this.registrations.delete(k);
    this.audit?.log('connector.register', { ip, detail: { client: id, name } });
    return { client_id: id, client_id_issued_at: Math.floor(now / 1000), ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name, redirect_uris: redirects, token_endpoint_auth_method: auth, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      ...(uri ? { client_uri: uri } : {}), ...(logo ? { logo_uri: logo } : {}) };
  }
  httpsOrNull(v) { try { const u = new URL(String(v)); return u.protocol === 'https:' && String(v).length <= 300 ? u.href : null; } catch { return null; } }
  /**
   * An app by its client_id: a registration, or (an https URL) its client ID metadata document, fetched and checked
   * (its client_id must be the URL exactly; a name and redirect URIs) and kept for an hour. → the app, or null.
   */
  async client(clientId) {
    const id = String(clientId || '');
    if (!id || id.length > 300) return null;
    const row = this.q.client.get(this.w, id), now = this.now();
    const view = r => ({ id: r.id, kind: r.kind, name: r.name, uri: r.uri, logo: r.logo, redirectUris: JSON.parse(r.redirect_uris), authMethod: r.auth_method, secretHash: r.secret_hash });
    if (!/^https:\/\//.test(id)) return row && row.kind === 'registered' ? view(row) : null;
    if (row && row.kind === 'document' && now - row.fetched < CONNECTOR_LIMITS.docCacheMs) return view(row);
    let doc;
    try { const u = new URL(id); if (u.pathname === '/' || u.hash) throw bad('invalid_client', 'A client_id URL needs a path and no fragment'); doc = await this.fetchDocument(id); } catch (e) {
      this.log(`[connector] client document ${id.slice(0, 120)}: ${e.message}`);
      return row && row.kind === 'document' ? view(row) : null;   // (an app whose document is down for a moment keeps working)
    }
    const redirects = Array.isArray(doc?.redirect_uris) ? doc.redirect_uris.map(String).slice(0, CONNECTOR_LIMITS.maxRedirectUris) : [];
    if (!doc || doc.client_id !== id || !clean(doc.client_name, 80) || !redirects.length || redirects.some(u => !redirectOk(u))) {
      this.log(`[connector] client document ${id.slice(0, 120)} refused: client_id, client_name or redirect_uris`);
      return null;
    }
    // how the app proves itself at the token endpoint: a document app here is a public app (PKCE is its proof). One whose
    // document names another method but lists 'none' among those it supports is one too (ChatGPT, 2026-10-13: it names
    // private_key_jwt and supports none; this world advertises none, so that is what it uses)
    const declared = doc.token_endpoint_auth_method === undefined ? 'none' : String(doc.token_endpoint_auth_method);
    const supported = Array.isArray(doc.token_endpoint_auth_methods_supported) ? doc.token_endpoint_auth_methods_supported.map(String) : [];
    const auth = declared === 'none' || supported.includes('none') ? 'none' : null;
    if (!auth) { this.log(`[connector] client document ${id.slice(0, 120)} refused: only public clients (token_endpoint_auth_method none)`); return null; }
    this.q.putClient.run({ id, w: this.w, kind: 'document', name: clean(doc.client_name, 80), uri: this.httpsOrNull(doc.client_uri), logo: this.httpsOrNull(doc.logo_uri),
      redirects: JSON.stringify(redirects), auth, secret: null, now, fetched: now, ip: null });
    return view(this.q.client.get(this.w, id));
  }

  // ------------------------------------------------------------------------------------------- authorization
  /**
   * The authorization request (GET /oauth/authorize). → { request } (the consent page's id) when it may go to the person;
   * { redirect } with an OAuth error for the app; throws ConnectorError when the app or its redirect URI can't be trusted
   * (then nothing is sent to that address: the person sees the error).
   * @param {URLSearchParams} q
   * @param {{ issuer: string, resource: string }} where  this world's issuer and MCP endpoint (its canonical address)
   */
  async authorize(q, { issuer, resource }) {
    const app = await this.client(q.get('client_id'));
    if (!app) throw bad('invalid_client', 'This app isn\'t known here (its client_id was not registered, or its client document couldn\'t be read)');
    const given = q.get('redirect_uri');
    const redirect = given ?? (app.redirectUris.length === 1 ? app.redirectUris[0] : null);
    if (!redirect || !redirectMatches(app.redirectUris, redirect)) throw bad('invalid_request', 'The redirect_uri is not one this app registered');
    const back = (error, description) => ({ redirect: this.withParams(redirect, { error, error_description: description, state: q.get('state'), iss: issuer }) });
    if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code');
    const challenge = q.get('code_challenge') || '';
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge)) return back('invalid_request', 'PKCE with S256 is required');
    const want = q.get('resource');
    const target = want === null ? resource : this.resolveResource(want, { issuer, resource });
    if (!target) return back('invalid_target', `The resource is ${resource}, or one agent's own address`);
    const scopes = String(q.get('scope') || SCOPE).split(/\s+/).filter(Boolean);
    if (scopes.some(s => !Object.hasOwn(SCOPES, s))) return back('invalid_scope', `Scopes offered here: ${Object.keys(SCOPES).join(' ')}`);
    const state = q.get('state');
    if (state !== null && state.length > 500) return back('invalid_request', 'The state is too long');
    const id = rnd(), now = this.now();
    this.q.reqPurge.run(this.w, now);
    this.q.reqAdd.run({ hash: sha256(id), w: this.w, client: app.id, redirect, state, challenge, scope: [...new Set(scopes)].join(' '), resource: target, now, exp: now + CONNECTOR_LIMITS.requestMs });
    return { request: id };
  }
  /** The resource an app named: this world's MCP endpoint (or the world itself), compared without case in scheme and host. */
  sameResource(want, resource, issuer) {
    const w = normResource(want);
    return !!w && (w === normResource(resource) || w === normResource(issuer));
  }
  /**
   * The resource an app named, as this world writes it: its MCP endpoint (the world itself counts as it), or one agent's own
   * MCP address <world>/mcp/a/<handle> (schema 46) when that agent exists. Null: not one of ours.
   */
  resolveResource(want, { issuer, resource }) {
    if (this.sameResource(want, resource, issuer)) return resource;
    const w = normResource(want), base = normResource(issuer);
    const m = w && base ? /^(.*)\/mcp\/a\/([0-9a-f]{16})$/.exec(w) : null;
    return m && m[1] === base && this.slots?.byHandle?.(m[2]) ? `${issuer}/mcp/a/${m[2]}` : null;
  }
  /** The agent an agent's own MCP address is for (its slot: { id, accountId, name, status, agentId }), or null. */
  addressedSlot(resource) {
    const m = /\/mcp\/a\/([0-9a-f]{16})$/.exec(String(resource || ''));
    return m && this.slots?.byHandle ? this.slots.byHandle(m[1]) : null;
  }
  withParams(uri, params) {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, v);
    return u.toString();
  }
  /** What the consent page shows for a waiting request: the app (its name, site, where it sends you back), what it asks. */
  async pending(id, P) {
    const r = this.requestRow(id), app = await this.client(r.client_id);
    if (!app) throw bad('invalid_client', 'This app is no longer known here', 410);
    let host = '';
    try { host = new URL(r.redirect_uri).host || new URL(r.redirect_uri).protocol; } catch { host = ''; }
    let agents = P?.account ? this.agentsFor(P) : [];
    // (its own address — <world>/mcp/a/<handle> — is for one agent: only it is offered, and only to its owner)
    const only = this.addressedSlot(r.resource);
    if (only) agents = agents.filter(a => a.id === `slot:${only.id}` || (only.agentId !== null && a.id === only.agentId));
    return {
      app: { name: app.name, site: app.uri, logo: app.logo, returnsTo: host, local: /^http:/.test(r.redirect_uri), registered: app.kind === 'registered' },
      scopes: r.scope.split(' ').map(s => ({ scope: s, what: SCOPES[s] })),
      agents, expires: r.expires,
      ...(only ? { only: { name: only.name, theirs: !!P?.account && only.accountId === P.account.id } } : {}),
    };
  }
  requestRow(id) {
    const r = typeof id === 'string' && id.length <= 64 ? this.q.reqGet.get(this.w, sha256(id)) : null;
    if (!r || r.expires < this.now()) throw bad('expired', 'This request has expired: start connecting again from the app', 410);
    return r;
  }
  /** The agents a person may hand to an app: their own, and those shared with them to manage. */
  agentsFor(P) {
    // (a connected agent of its own: the app lives as it — its body's own tools, server/connector/body-tools.js; one not
    // connected right now is offered too: choosing it connects it)
    // (the ones waiting for an app come first, newest first: the agent just made for this app in New agent is preselected)
    const waiting = (this.slots ? this.slots.notConnected(P.account.id) : [])
      .map(s => ({ id: `slot:${s.id}`, name: s.name, emoji: '🔌', role: 'Not connected yet', lives: true, ...(s.app ? { app: s.app } : {}) }));
    const agents = this.agents.enabled().filter(a => this.agents.isOwner(P, a) || this.agents.canManage(P, a))
      .map(a => ({ id: a.id, name: a.name, emoji: a.emoji || '', role: a.role || '', ...(this.slots?.ownsLiving(P.account, a) ? { lives: true } : {}) }));
    return [...waiting, ...agents];
  }
  /**
   * The person's answer on the consent page: allow (as which agent) or deny. → { redirect } back to the app: a code, or
   * access_denied. The request is used up either way.
   */
  consent(P, { request, agent, allow }, { issuer, ip = null }) {
    if (!P?.account || !P.session) throw bad('login_required', 'Sign in first', 401);
    const r = this.requestRow(request);
    this.q.reqTake.run(this.w, sha256(request));
    const params = { state: r.state, iss: issuer };
    if (allow !== true) {
      this.audit?.log('connector.deny', { actor: { id: P.account.id, login: P.account.login }, ip, detail: { client: r.client_id } });
      return { redirect: this.withParams(r.redirect_uri, { error: 'access_denied', error_description: 'The person said no', ...params }) };
    }
    const app = this.q.client.get(this.w, r.client_id), now = this.now();
    if (!app) throw bad('invalid_client', 'This app is no longer known here', 410);
    // one of its connected agents not connected right now: choosing it here is its owner's OK — it connects (no key)
    let agentId = Number(agent);
    const slotPick = /^slot:(\d{1,9})$/.exec(String(agent ?? ''));
    // (an agent's own address is for it alone: checked before anything is connected)
    const only = this.addressedSlot(r.resource);
    if (only && (only.accountId !== P.account.id || (slotPick ? Number(slotPick[1]) !== only.id : agentId !== only.agentId))) {
      throw bad('invalid_request', `This address is for ${only.name}${only.accountId === P.account.id ? '' : ', an agent of another account'}: choose ${only.name}`, 400);
    }
    if (slotPick) {
      if (!this.slots) throw bad('invalid_request', 'Choose one of your agents', 400);
      try { agentId = this.slots.connect(P.account, Number(slotPick[1]), { ip, app: app.name }); } catch (e) { throw bad('invalid_request', e.status === 404 ? 'Choose one of your agents' : e.message, 400); }
    }
    const a = this.agents.get(agentId);
    if (!a || !a.enabled || !(this.agents.isOwner(P, a) || this.agents.canManage(P, a))) throw bad('invalid_request', 'Choose one of your agents', 400);

    const code = rnd();
    const grantId = this.store.tx(() => {
      const old = this.q.grantFind.get(this.w, P.account.id, a.id, r.client_id);
      const id = old ? old.id : Number(this.q.grantAdd.run({ w: this.w, acc: P.account.id, agent: a.id, client: r.client_id, name: app.name, scope: r.scope, resource: r.resource, now }).lastInsertRowid);
      if (old && old.resource !== r.resource) this.store.db.prepare('UPDATE mcp_grants SET resource = ? WHERE world_id = ? AND id = ?').run(r.resource, this.w, id);
      this.q.codesPurge.run(this.w, now);
      this.q.codeAdd.run({ hash: sha256(code), w: this.w, grant: id, client: r.client_id, redirect: r.redirect_uri, challenge: r.challenge, resource: r.resource, now, exp: now + CONNECTOR_LIMITS.codeMs });
      return id;
    });
    this.audit?.log('connector.grant', { actor: { id: P.account.id, login: P.account.login }, ip, detail: { grant: grantId, client: r.client_id, app: app.name, agent: a.id } });
    return { redirect: this.withParams(r.redirect_uri, { code, ...params }), grant: grantId };
  }

  // ------------------------------------------------------------------------------------------- tokens
  /** The app's own credentials at the token endpoint (RFC 6749 §2.3): → the app, or invalid_client. */
  async clientAuth(form, authHeader) {
    let id = form.get('client_id'), secret = form.get('client_secret'), method = secret !== null ? 'client_secret_post' : 'none';
    const m = /^Basic ([A-Za-z0-9+/=]+)$/.exec(String(authHeader || ''));
    if (m) {
      const [u, ...p] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
      const dec = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
      if (id !== null && id !== dec(u)) throw bad('invalid_client', 'Two different client IDs', 401);
      id = dec(u); secret = dec(p.join(':')); method = 'client_secret_basic';
    }
    const app = await this.client(id);
    if (!app) throw bad('invalid_client', 'Unknown client', 401);
    if (app.authMethod === 'none') return app;   // a public app: PKCE is its proof
    if (method !== app.authMethod || !secret) throw bad('invalid_client', `This app authenticates with ${app.authMethod}`, 401);
    const a = Buffer.from(sha256(secret)), b = Buffer.from(app.secretHash || '');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw bad('invalid_client', 'Wrong client secret', 401);
    return app;
  }
  /** POST /oauth/token. → the token response (RFC 6749 §5.1). */
  async token(form, { authHeader = null, issuer, resource }) {
    const app = await this.clientAuth(form, authHeader), type = form.get('grant_type'), now = this.now();
    const want = form.get('resource');
    const target = want === null ? null : this.resolveResource(want, { issuer, resource });
    if (want !== null && !target) throw bad('invalid_target', `The resource is ${resource}, or one agent's own address`);
    if (type === 'authorization_code') {
      const c = this.q.code.get(this.w, sha256(form.get('code') || ''));
      if (!c || c.client_id !== app.id) throw bad('invalid_grant', 'Unknown code');
      if (c.used) { this.endGrant(c.grant_id, 'code used twice'); throw bad('invalid_grant', 'This code was already used'); }
      if (c.expires < now) throw bad('invalid_grant', 'The code has expired');
      if (form.get('redirect_uri') !== null && form.get('redirect_uri') !== c.redirect_uri) throw bad('invalid_grant', 'The redirect_uri differs from the authorization request');
      const verifier = form.get('code_verifier') || '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || crypto.createHash('sha256').update(verifier).digest('base64url') !== c.challenge) throw bad('invalid_grant', 'The PKCE code_verifier does not match');
      if (!this.q.codeUse.run(now, this.w, c.code_hash).changes) { this.endGrant(c.grant_id, 'code used twice'); throw bad('invalid_grant', 'This code was already used'); }
      const g = this.liveGrant(c.grant_id);
      if (!g) throw bad('invalid_grant', 'This connection has ended');
      if (target && target !== c.resource) throw bad('invalid_target', 'The resource differs from the authorization request');
      return this.issue(g, now, c.resource);
    }
    if (type === 'refresh_token') {
      const t = this.q.token.get(this.w, sha256(form.get('refresh_token') || ''));
      if (!t || t.kind !== 'refresh') throw bad('invalid_grant', 'Unknown refresh token');
      const g0 = this.q.grant.get(this.w, t.grant_id);
      if (!g0 || g0.client_id !== app.id) throw bad('invalid_grant', 'Unknown refresh token');
      if (t.used) { this.endGrant(t.grant_id, 'refresh token used twice'); throw bad('invalid_grant', 'This refresh token was already used'); }
      if (t.expires < now) throw bad('invalid_grant', 'The refresh token has expired');
      if (!this.q.tokenUse.run(now, this.w, t.token_hash).changes) { this.endGrant(t.grant_id, 'refresh token used twice'); throw bad('invalid_grant', 'This refresh token was already used'); }
      const g = this.liveGrant(t.grant_id);
      if (!g) throw bad('invalid_grant', 'This connection has ended');
      if (target && target !== t.resource) throw bad('invalid_target', 'The resource differs from the one this connection is for');
      return this.issue(g, now, t.resource);
    }
    throw bad('unsupported_grant_type', 'authorization_code or refresh_token');
  }
  issue(g, now, resource = g.resource) {
    const access = `mvwa_${rnd()}`, refresh = `mvwr_${rnd()}`;
    this.store.tx(() => {
      this.q.tokensPurge.run(this.w, now);
      this.q.tokenAdd.run({ hash: sha256(access), w: this.w, grant: g.id, kind: 'access', resource, now, exp: now + CONNECTOR_LIMITS.accessMs });
      this.q.tokenAdd.run({ hash: sha256(refresh), w: this.w, grant: g.id, kind: 'refresh', resource, now, exp: now + CONNECTOR_LIMITS.refreshMs });
    });
    return { access_token: access, token_type: 'Bearer', expires_in: Math.floor(CONNECTOR_LIMITS.accessMs / 1000), refresh_token: refresh, scope: g.scope };
  }
  /** POST /oauth/revoke (RFC 7009): a token the app no longer wants; a refresh token ends its grant. Always succeeds. */
  async revoke(form, { authHeader = null } = {}) {
    const app = await this.clientAuth(form, authHeader);
    const t = this.q.token.get(this.w, sha256(form.get('token') || ''));
    if (!t) return;
    const g = this.q.grant.get(this.w, t.grant_id);
    if (!g || g.client_id !== app.id) return;
    if (t.kind === 'refresh') this.endGrant(g.id, 'the app revoked it');
    else this.q.tokenDel.run(this.w, t.token_hash);
  }
  /** A grant that is still in force: not revoked, its account able to act, its agent still the account's. */
  liveGrant(id) {
    const g = this.q.grant.get(this.w, id);
    if (!g || g.revoked) return null;
    const P = this.accounts.connectorPrincipal(g.account_id), a = this.agents.get(g.agent_id);
    if (!P || !a || !a.enabled || !(this.agents.isOwner(P, a) || this.agents.canManage(P, a))) { this.endGrant(g.id, 'its account or agent changed'); return null; }
    return g;
  }
  endGrant(id, why) {
    const g = this.q.grant.get(this.w, id);
    this.store.tx(() => { this.q.grantRevoke.run(this.now(), this.w, id); this.q.tokensDropGrant.run(this.w, id); });
    if (g && !g.revoked) this.audit?.log('connector.end', { actor: null, detail: { grant: id, client: g.client_id, account: g.account_id, why } });
  }

  // ------------------------------------------------------------------------------------------- the MCP endpoint's side
  /**
   * A bearer token at the MCP endpoint → { grant, P (the account, acting through the app), agent } or null. The token must
   * have been issued for this resource (audience), be unexpired, and its grant still be in force.
   */
  authenticate(bearer, resource) {
    if (typeof bearer !== 'string' || !bearer.startsWith('mvwa_') || bearer.length > 100) return null;
    const t = this.q.token.get(this.w, sha256(bearer)), now = this.now();
    if (!t || t.kind !== 'access' || t.expires < now || t.resource !== resource) return null;
    const g = this.liveGrant(t.grant_id);
    if (!g) return null;
    if (!g.last_used || now - g.last_used > CONNECTOR_LIMITS.touchMs) this.q.grantTouch.run(now, this.w, g.id);
    return { grant: g, P: { ...this.accounts.connectorPrincipal(g.account_id), via: 'connector', grant: g.id, app: g.client_name }, agent: this.agents.get(g.agent_id) };
  }

  // ------------------------------------------------------------------------------------------- the person's list
  /** The apps that act for an account: which app, as which agent, since when, last used. */
  grantsOf(accountId) {
    return this.q.grantsOf.all(this.w, Number(accountId)).map(g => {
      const a = this.agents.get(g.agent_id);
      return { id: g.id, app: g.client_name, client: /^https:/.test(g.client_id) ? g.client_id : null, agent: a ? { id: a.id, name: a.name, emoji: a.emoji || '' } : null, scope: g.scope, created: g.created, lastUsed: g.last_used };
    });
  }
  /** The person disconnects an app (their own grant only). */
  revokeGrant(P, id, { ip = null } = {}) {
    const g = this.q.grant.get(this.w, Number(id));
    if (!g || g.account_id !== P.account.id || g.revoked) throw bad('not_found', 'No such connection', 404);
    this.endGrant(g.id, 'the person disconnected it');
    this.audit?.log('connector.revoke', { actor: { id: P.account.id, login: P.account.login }, ip, detail: { grant: g.id, client: g.client_id } });
    return { grants: this.grantsOf(P.account.id) };
  }
  /** A connected agent was disconnected by its owner: every app living as it, or acting for it, stops. */
  endAgentGrants(agentId, why = 'its agent was disconnected') {
    for (const g of this.store.db.prepare('SELECT id FROM mcp_grants WHERE world_id = ? AND agent_id = ? AND revoked IS NULL').all(this.w, Number(agentId))) this.endGrant(g.id, why);
  }
  /** An account goes (or is disabled): every app acting for it stops. */
  forgetAccount(id) {
    const now = this.now();
    for (const g of this.q.grantsOf.all(this.w, Number(id))) this.q.tokensDropGrant.run(this.w, g.id);
    this.q.grantsRevokeAccount.run(now, this.w, Number(id));
  }
}
