// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One live connection to a Hermes backend (docs/features/agent-providers.md §9), inside the provider helper process: the
// `hermes serve` / `hermes dashboard` process its Desktop app connects to as a Remote gateway.
// - Its gateway JSON-RPC over WebSocket (/api/ws): newline-delimited JSON-RPC 2.0 both ways, `gateway.ready` first; events
//   are { method: 'event', params: { type, session_id, payload, seq } }; Hermes' own requests to the client (approvals,
//   questions, masked prompts) carry an id and are answered with a response of that id (onRequest). Once per connection
//   the client says it answers them (client.capabilities), as Hermes requires; a heartbeat (gateway.ping every 15 s, any
//   frame counting) when gateway.ready offers one; reconnects with jittered backoff, as Hermes' own clients do.
// - Its REST beside it (/api/…): with the same credential.
// - Signing in (what Hermes accepts): the backend's session token (a backend bound to its own machine), or a username and
//   password (a backend whose sign-in is engaged): Hermes' native-app flow (RFC 8252 — /auth/native/authorize with a PKCE
//   challenge, the password form, /auth/native/token), its access and refresh tokens kept sealed by the server (persist),
//   the password then forgotten; the access token renewed with /auth/native/refresh.
// configure(config, secrets) is called with every call's credentials: the socket is rebuilt only when what it is built from
// changes (the address, how it signs in, the credential).
import crypto from 'node:crypto';
import WebSocket from 'ws';

export const KIND = 'hermes';
const WAIT_MS = 10000;               // a request made while the backend is (re)connecting waits this long for it
const CALL_MS = 30000;               // a request's own answer
const HEARTBEAT_MS = 15000, HEARTBEAT_DEADLINE_MS = 45000;   // Hermes' clients' own (apps/shared json-rpc-channel)
const BACKOFF_BASE_MS = 300, BACKOFF_CAP_MS = 15000, STABLE_OPEN_MS = 5000;
const REFRESH_EARLY_S = 60;          // an access token is renewed this long before it expires
const NATIVE_REDIRECT = 'http://127.0.0.1:9/my-virtual-world/signed-in';   // never served: the code is read from the answer
const MAX_FRAME = 64 * 1024 * 1024;

const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The backend's web address (its path kept: a backend behind a proxy prefix) and its socket's. */
export function bases(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw fail('bad_url', 'The address starts with http:// or https://');
  const path = u.pathname.replace(/\/+$/, '');
  return { http: `${u.origin}${path}`, ws: `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}${path}/api/ws` };
}
/** The cookies an answer sets, as one Cookie header (only their names and values). */
function cookiesOf(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  return list.map(c => String(c).split(';')[0].trim()).filter(c => /^[^=\s]+=/.test(c)).join('; ');
}
/** Hermes' answer to a refused request, in words (its detail, else the status). */
async function detailOf(res) {
  try { const j = await res.json(); return String((j && (j.detail || j.error || j.message)) || '').slice(0, 300); } catch { return ''; }
}

export class HermesLink {
  /**
   * @param {{ connectionId: string, emit: (e: object) => void, persist: (field: string, value: string|null) => void,
   *   onEvent?: (evt: object) => void, onRequest?: (req: object) => (object|Promise<object>|null), onReady?: () => void,
   *   onDown?: () => void, fetchImpl?: typeof fetch, WS?: typeof WebSocket }} o
   */
  constructor({ connectionId, emit, persist, onEvent = null, onRequest = null, onReady = null, onDown = null, fetchImpl = fetch, WS = WebSocket }) {
    Object.assign(this, { connectionId, emit, persist, onEvent, onRequest, onReady, onDown, fetchImpl, WS });
    this.status = { state: 'offline' }; this.key = null; this.ws = null; this.ready = false; this.gen = 0;
    // (lossless reconnects, as Hermes' own client does: the last event number seen per live session; while a session's
    // missed events are fetched again, its live ones wait here)
    this.seen = new Map(); this.hold = new Map();
    this.pending = new Map(); this.nextId = 1; this.waiters = []; this.attempt = 0; this.timer = null; this.beat = null;
    this.info = null;          // the backend's /api/status: its version, whether it asks for sign-in, its profiles
    this.serverRequests = [];  // what Hermes says it may ask this client (client.capabilities)
  }
  get connected() { return this.status.state === 'connected' && this.ready; }

  // ---------------------------------------------------------------- settings and credentials
  /** Builds (or keeps) the connection for these settings and credentials. */
  configure(config = {}, secrets = {}) {
    const auth = config.auth === 'password' ? 'password' : 'token';
    let tokens = null;
    // (tokens issued to another username, after the username changed: not these)
    if (secrets.tokens) { try { const t = JSON.parse(secrets.tokens); if (t && t.access && (t.user || '') === String(config.username || '')) tokens = t; } catch { /* unreadable: sign in again */ } }
    const cred = auth === 'token' ? `t:${secrets.token || ''}` : `p:${config.username || ''}:${secrets.password ? sha(secrets.password) : ''}:${tokens ? 'tokens' : ''}`;
    const key = sha(JSON.stringify([config.url, auth, cred]));
    // (tokens Hermes renewed since the server last sealed them: the newer ones stay)
    if (auth === 'password' && tokens && this.tokens && this.tokens.refresh !== tokens.refresh && (this.tokens.expiresAt || 0) >= (tokens.expiresAt || 0)) tokens = this.tokens;
    if (key === this.key && this.active) return false;
    this.stopSocket();
    this.key = key; this.url = config.url; this.auth = auth; this.username = String(config.username || '');
    this.token = auth === 'token' ? String(secrets.token || '') : ''; this.password = auth === 'password' ? String(secrets.password || '') : '';
    this.tokens = auth === 'password' ? tokens : null; this.attempt = 0; this.active = true;
    try { this.base = bases(config.url || ''); } catch (e) { this.setStatus({ state: 'error', code: 'not_configured', detail: e.message || 'The Hermes address is not set.', fix: 'Enter the address of your Hermes backend (Edit).' }); return true; }
    const missing = auth === 'token' ? !this.token : !this.tokens && !(this.username && this.password);
    if (missing) {
      this.setStatus({ state: 'error', code: 'not_configured', detail: auth === 'token' ? 'The session token is not set.' : 'The username and password are not set.',
        fix: auth === 'token' ? 'Start Hermes with a session token of your own (HERMES_DASHBOARD_SESSION_TOKEN) and enter it here (Edit).' : 'Enter the username and password of Hermes\' sign-in (Edit).' });
      return true;
    }
    this.setStatus({ state: 'connecting', detail: 'Connecting to Hermes…' });
    this.open();
    return true;
  }

  // ---------------------------------------------------------------- state
  setStatus(s) {
    const next = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
    const same = ['state', 'code', 'detail', 'version'].every(k => next[k] === this.status[k]);
    this.status = next;
    if (next.state === 'error') this.failWaiters();
    if (!same) { try { this.emit({ type: 'provider.status', kind: KIND, connectionId: this.connectionId, ...next }); } catch { /* the bus refused it */ } }
  }
  failWaiters() {
    const s = this.status;
    for (const w of this.waiters.splice(0)) w.reject(fail('not_connected', s.detail || 'Hermes is not connected', { fix: s.fix }));
  }
  /** Resolves when the backend is connected; rejects at once if a person must act first, or after ms. */
  whenConnected(ms = WAIT_MS) {
    if (this.connected) return Promise.resolve();
    if (this.status.state === 'error' || !this.key) return Promise.reject(fail('not_connected', this.status.detail || 'Hermes is not connected', { fix: this.status.fix }));
    return new Promise((resolve, reject) => {
      const w = { resolve: () => { clearTimeout(t); resolve(); }, reject: e => { clearTimeout(t); reject(e); } };
      const t = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); reject(fail('timeout', 'Hermes did not answer in time', { fix: this.status.fix })); }, ms);
      t.unref?.();
      this.waiters.push(w);
    });
  }
  /** Waits until the state settles (connected or what is wrong) or ms pass: what a Test shows. */
  async settle(ms = WAIT_MS) {
    try { await this.whenConnected(ms); } catch { /* the status says why */ }
    return { ...this.status };
  }
  snapshot() {
    const i = this.info;
    return { ...this.status, hermes: i ? { version: i.version, release: i.release_date, signIn: !!i.auth_required, profiles: Array.isArray(i.profiles) ? i.profiles.length : undefined } : null };
  }

  // ---------------------------------------------------------------- signing in
  /** The credential for this connection now: the session token, or a current access token (signed in, or renewed). */
  async credential() {
    if (this.auth === 'token') return this.token;
    const now = Date.now() / 1000;
    if (this.tokens && this.tokens.access && (!this.tokens.expiresAt || this.tokens.expiresAt - REFRESH_EARLY_S > now)) return this.tokens.access;
    if (this.tokens && this.tokens.refresh) {
      const r = await this.renew();
      if (r) return r;
    }
    if (this.username && this.password) return this.signIn();
    throw fail('signin_needed', 'Hermes asks to sign in again', { fix: 'Enter the password of Hermes\' sign-in again (Edit).' });
  }
  keepTokens(j) {
    this.tokens = { access: String(j.access_token), refresh: j.refresh_token ? String(j.refresh_token) : '', expiresAt: Number(j.expires_at) || 0, provider: String(j.provider || ''), user: this.username };
    this.persist('tokens', JSON.stringify(this.tokens));
  }
  /** Renews the access token with the refresh token; null when Hermes refuses it (then: sign in again). */
  async renew() {
    let res;
    try {
      res = await this.fetchImpl(`${this.base.http}/auth/native/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.tokens.refresh, provider: this.tokens.provider || '' }), redirect: 'manual', signal: AbortSignal.timeout(15000) });
    } catch { throw fail('unreachable', 'Hermes is not answering'); }
    if (res.status === 503) throw fail('unreachable', 'Hermes\' sign-in service is not answering');
    if (!res.ok) { this.tokens = null; this.persist('tokens', null); return null; }
    const j = await res.json().catch(() => null);
    if (!j || !j.access_token) { this.tokens = null; this.persist('tokens', null); return null; }
    this.keepTokens(j);
    return this.tokens.access;
  }
  /**
   * Hermes' sign-in for a native app (its guide, RFC 8252): a PKCE challenge, the password form within that flow, and
   * the code it hands back exchanged for tokens. The password is then forgotten (the server's copy too: persist).
   */
  async signIn() {
    const H = this.base.http, F = this.fetchImpl;
    const providers = await this.passwordProviders();
    if (!providers.length) throw fail('no_password_signin', 'This Hermes has no username-and-password sign-in', { fix: 'Set HERMES_DASHBOARD_BASIC_AUTH_USERNAME and _PASSWORD for Hermes (its username/password provider), or use a session token.' });
    const verifier = b64url(crypto.randomBytes(32)), challenge = b64url(crypto.createHash('sha256').update(verifier).digest()), state = b64url(crypto.randomBytes(12));
    const q = new URLSearchParams({ provider: providers[0], code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: NATIVE_REDIRECT, state });
    const t = () => AbortSignal.timeout(15000);
    let res;
    try { res = await F(`${H}/auth/native/authorize?${q}`, { redirect: 'manual', signal: t() }); } catch { throw fail('unreachable', 'Hermes is not answering'); }
    const cookie = cookiesOf(res);
    if (res.status >= 400 || !cookie) throw fail('signin_refused', `Hermes did not start a sign-in (${(await detailOf(res)) || res.status})`);
    res = await F(`${H}/auth/password-login`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, redirect: 'manual', signal: t(),
      body: JSON.stringify({ provider: providers[0], username: this.username, password: this.password }) }).catch(() => null);
    if (!res) throw fail('unreachable', 'Hermes is not answering');
    if (res.status === 401) throw fail('bad_credentials', 'Hermes refused the username or password', { fix: 'Check the username and password of Hermes\' sign-in (Edit).' });
    if (res.status === 429) throw fail('rate_limited', 'Too many sign-in attempts', { fix: 'Wait a minute; Hermes limits sign-ins.' });
    if (!res.ok) throw fail('signin_refused', `Hermes refused the sign-in (${(await detailOf(res)) || res.status})`);
    const login = await res.json().catch(() => ({}));
    let next;
    try { next = new URL(String(login.next || '')); } catch { next = null; }
    const code = next && next.searchParams.get('code');
    if (!code || next.searchParams.get('state') !== state) throw fail('signin_refused', 'Hermes did not hand back a sign-in code');
    res = await F(`${H}/auth/native/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: verifier }), signal: t() }).catch(() => null);
    const j = res && res.ok ? await res.json().catch(() => null) : null;
    if (!j || !j.access_token) throw fail('signin_refused', 'Hermes did not issue a sign-in token');
    this.keepTokens(j);
    // (signed in: the password is handed off — the server forgets it, and this link counts as built from the tokens)
    this.persist('password', null); this.password = '';
    this.key = sha(JSON.stringify([this.url, this.auth, `p:${this.username}::tokens`]));
    return this.tokens.access;
  }
  /** Hermes' sign-in providers that take a password (its public provider list). */
  async passwordProviders() {
    try {
      const r = await this.fetchImpl(`${this.base.http}/api/auth/providers`, { signal: AbortSignal.timeout(8000) });
      const j = r.ok ? await r.json() : null;
      const list = Array.isArray(j) ? j : Array.isArray(j && j.providers) ? j.providers : [];
      const names = list.filter(p => p && (p.supports_password || p.password || p.kind === 'password' || p.type === 'password')).map(p => String(p.name || p.id));
      if (names.length) return names;
    } catch { /* the status page says it too */ }
    const st = this.info || {};
    return (Array.isArray(st.auth_providers) ? st.auth_providers : []).filter(n => n === 'basic');
  }
  /** The headers that carry this connection's credential on REST. */
  async authHeaders() {
    const c = await this.credential();
    return this.auth === 'token' ? { 'x-hermes-session-token': c } : { authorization: `Bearer ${c}` };
  }

  // ---------------------------------------------------------------- the socket
  async open() {
    const gen = ++this.gen;
    clearTimeout(this.timer); this.timer = null;
    let cred;
    try {
      this.info = await this.statusPage();
      if (gen !== this.gen) return;
      cred = await this.credential();
    } catch (e) {
      if (gen !== this.gen) return;
      if (e.code === 'unreachable' || e.code === 'timeout') { this.setStatus({ state: 'offline', code: 'unreachable', detail: 'Hermes is not answering.', fix: 'Check that `hermes serve` (or `hermes dashboard`) is running at this address; it keeps trying by itself.' }); this.later(); return; }
      this.setStatus({ state: 'error', code: e.code || 'signin_refused', detail: e.message, fix: e.fix });
      return;
    }
    if (gen !== this.gen) return;
    let ws;
    try { ws = new this.WS(`${this.base.ws}?token=${encodeURIComponent(cred)}`, { handshakeTimeout: 10000, maxPayload: MAX_FRAME, perMessageDeflate: false }); }
    catch (e) { this.setStatus({ state: 'error', code: 'bad_url', detail: `Can't open ${this.base.ws}: ${e.message}` }); return; }
    this.ws = ws; this.ready = false; this.openedAt = null; this.buf = '';
    ws.on('unexpected-response', (req, res) => {
      if (gen !== this.gen) return;
      const code = res.statusCode;
      if (code === 401 || code === 403) {
        // (a refused access token: renewed once by the next attempt; a refused session token: a person must fix it)
        if (this.auth === 'password' && this.tokens) { this.tokens = { ...this.tokens, expiresAt: 1 }; this.later(); return; }
        this.setStatus({ state: 'error', code: 'auth_rejected', detail: 'Hermes refused the session token.', fix: 'Hermes makes a new session token every time it starts unless it is started with HERMES_DASHBOARD_SESSION_TOKEN; start it with yours and enter the same here (Edit).' });
      } else this.later();
      try { req.destroy(); } catch { /* gone */ }
    });
    ws.on('open', () => { if (gen === this.gen) this.openedAt = Date.now(); });
    ws.on('message', d => { if (gen === this.gen) this.onData(d); });
    ws.on('close', (code, reason) => { if (gen === this.gen) this.onClose(code, String(reason || '')); });
    ws.on('error', () => { /* close follows */ });
  }
  /** Hermes' public status page: its version, whether its sign-in is engaged and which providers it has, its profiles. */
  async statusPage() {
    let r;
    try { r = await this.fetchImpl(`${this.base.http}/api/status`, { signal: AbortSignal.timeout(8000), redirect: 'manual' }); }
    catch (e) { throw fail(e.name === 'TimeoutError' ? 'timeout' : 'unreachable', 'Hermes is not answering'); }
    if (r.status === 400 || r.status === 421) throw fail('host_refused', 'Hermes refused this address as its host', { fix: 'Hermes only answers to the host it listens on (its DNS-rebinding guard): use that address, or declare this one as its dashboard.public_url.' });
    if (!r.ok) throw fail('not_hermes', `No Hermes backend answered here (${r.status})`, { fix: 'The address is the one `hermes serve` or `hermes dashboard` prints when it starts.' });
    const j = await r.json().catch(() => null);
    if (!j || typeof j.version !== 'string') throw fail('not_hermes', 'No Hermes backend answered here', { fix: 'The address is the one `hermes serve` or `hermes dashboard` prints.' });
    if (this.auth === 'token' && j.auth_required) throw fail('signin_engaged', 'This Hermes asks to sign in with a username and password', { fix: 'Choose "Username and password" (Edit): Hermes engages its sign-in when it listens beyond its own machine.' });
    return j;
  }
  onData(d) {
    this.lastIn = Date.now();
    const text = this.buf + String(d);
    const lines = text.split('\n');
    this.buf = lines.pop();
    if (this.buf.length > MAX_FRAME) this.buf = '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let f;
      try { f = JSON.parse(line); } catch { continue; }
      this.onFrame(f);
    }
    if (this.buf.trim()) { try { const f = JSON.parse(this.buf); this.buf = ''; this.onFrame(f); } catch { /* a frame split across messages */ } }
  }
  onFrame(f) {
    if (!f || typeof f !== 'object') return;
    if (f.method === 'event' && f.params && typeof f.params.type === 'string') {
      if (f.params.type === 'gateway.ready') { this.onGatewayReady(f.params.payload || {}); return; }
      const sid = String(f.params.session_id || ''), seq = f.params.seq;
      if (sid && Number.isInteger(seq)) {
        if (this.hold.has(sid)) { this.hold.get(sid).push(f.params); return; }
        if (seq <= (this.seen.get(sid) ?? 0)) return;   // (one already had: never twice)
        this.note(sid, seq);
      }
      this.deliver(f.params);
      return;
    }
    if (f.method && f.id !== undefined && f.id !== null) { this.onServerRequest(f); return; }
    if (f.id !== undefined && this.pending.has(String(f.id))) {
      const p = this.pending.get(String(f.id));
      this.pending.delete(String(f.id)); clearTimeout(p.timer);
      if (f.error) p.reject(fail(`hermes_${f.error.code ?? 'error'}`, String(f.error.message || 'Hermes refused it').slice(0, 400), { rpcCode: f.error.code, data: f.error.data }));
      else p.resolve(f.result);
    }
  }
  deliver(evt) { try { this.onEvent?.(evt); } catch { /* one bad event never stops the rest */ } }
  note(sid, seq) {
    this.seen.delete(sid); this.seen.set(sid, seq);
    if (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value);
  }
  /** Whether a live session's missed events can be fetched again (its numbers are from this Hermes process). */
  canReplay(sid) { return !!sid && this.seen.has(String(sid)); }
  /** Live events of the session wait from now until replay() (or release()) — set before the session is attached again. */
  holdFor(sid) { if (!this.hold.has(String(sid))) this.hold.set(String(sid), []); }
  release(sid) {
    const list = this.hold.get(String(sid)) || [];
    this.hold.delete(String(sid));
    for (const e of list) { if (Number.isInteger(e.seq) && e.seq <= (this.seen.get(String(sid)) ?? 0)) continue; if (Number.isInteger(e.seq)) this.note(String(sid), e.seq); this.deliver(e); }
  }
  /**
   * The events of a live session this connection missed while its socket was down (Hermes' session.events.since:
   * everything after the last one seen), delivered in order — then the live ones that waited, each once. Hermes
   * restarted meanwhile (another replay epoch): its numbers start again, nothing can be fetched — { reset: true }.
   * Resolves { count, truncated, open } (open: Hermes' requests still waiting for an answer).
   */
  async replay(sid) {
    sid = String(sid);
    const last = this.seen.get(sid) ?? 0;
    try {
      const r = await this.rpc('session.events.since', { session_id: sid, last_seen: last }, { timeoutMs: 20000 });
      if (r && r.epoch && this.epoch && r.epoch !== this.epoch) { this.epoch = r.epoch; this.seen.clear(); this.release(sid); return { reset: true }; }
      let count = 0;
      for (const e of (r && Array.isArray(r.events) ? r.events : [])) {
        if (!e || !Number.isInteger(e.seq) || e.seq <= (this.seen.get(sid) ?? 0)) continue;
        this.note(sid, e.seq); this.deliver({ ...e, session_id: e.session_id || sid }); count++;
      }
      this.release(sid);
      return { count, truncated: !!(r && r.truncated), open: r && Array.isArray(r.open_requests) ? r.open_requests : [] };
    } catch (e) { this.release(sid); return { error: e.message }; }
  }
  /** A live session this connection no longer follows (closed, deleted). */
  forget(sid) { this.seen.delete(String(sid)); this.hold.delete(String(sid)); }
  async onGatewayReady(p) {
    const gen = this.gen;
    // (Hermes restarted: its event numbers start again — none seen before can be fetched again)
    if (this.epoch && p.replay_epoch && p.replay_epoch !== this.epoch) this.seen.clear();
    this.epoch = p.replay_epoch || null;
    try {
      // (Hermes fails every request it would send a client that never says it answers them)
      const r = await this.rpc('client.capabilities', { server_requests: true }, { timeoutMs: 10000 });
      this.serverRequests = Array.isArray(r && r.server_requests) ? r.server_requests : [];
    } catch { this.serverRequests = []; }
    if (gen !== this.gen) return;
    this.ready = true;
    if (p.heartbeat === true) this.startHeartbeat();
    const v = this.info && this.info.version;
    this.setStatus({ state: 'connected', version: v ? String(v) : undefined, detail: `Connected${v ? ` to Hermes ${v}` : ''}.` });
    for (const w of this.waiters.splice(0)) w.resolve();
    try { this.onReady?.(); } catch { /* the adapter's own */ }
  }
  /** A request from Hermes to this client: answered by the adapter (a result), or refused as not implemented, so the
   *  agent never waits for an answer nobody will give. */
  async onServerRequest(f) {
    let result = null;
    try { result = await this.onRequest?.({ id: f.id, method: f.method, params: f.params || {} }); } catch { result = null; }
    if (result === undefined) return;   // (answered later: respond())
    if (result === null) this.send({ jsonrpc: '2.0', id: f.id, error: { code: -32601, message: `${f.method} is not answered by My Virtual World` } });
    else this.send({ jsonrpc: '2.0', id: f.id, result });
  }
  /** Answers a request from Hermes the adapter kept open (a person's answer, later). False when the socket that brought
   *  it is gone (then Hermes' own request.answer / approval.respond take the answer). */
  respond(id, result, viaGen = null) {
    if (viaGen !== null && viaGen !== this.gen) return false;
    return this.send({ jsonrpc: '2.0', id, result });
  }
  send(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
  }
  startHeartbeat() {
    clearInterval(this.beat);
    const gen = this.gen;
    this.lastIn = Date.now();
    this.beat = setInterval(() => {
      if (gen !== this.gen) { clearInterval(this.beat); return; }
      if (Date.now() - this.lastIn >= HEARTBEAT_DEADLINE_MS) { try { this.ws?.terminate(); } catch { /* gone */ } return; }
      this.send({ jsonrpc: '2.0', id: `hb-${this.nextId++}`, method: 'gateway.ping', params: {} });
    }, HEARTBEAT_MS);
    this.beat.unref?.();
  }
  onClose(code, reason) {
    const was = this.connected;
    this.ws = null; this.ready = false; clearInterval(this.beat); this.beat = null;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(fail('not_connected', 'The connection to Hermes was lost')); }
    this.pending.clear();
    if (was) { try { this.onDown?.(); } catch { /* the adapter's own */ } }
    if (this.status.state === 'error') return;
    // (Hermes' own close codes: 4401 the credential, 4403 its request guard — the host, the peer or the origin)
    if (code === 4401) {
      if (this.auth === 'password' && this.tokens) { this.tokens = { ...this.tokens, expiresAt: 1 }; this.later(); return; }
      this.setStatus({ state: 'error', code: 'auth_rejected', detail: 'Hermes refused the session token.', fix: 'Start Hermes with HERMES_DASHBOARD_SESSION_TOKEN and enter the same token here (Edit).' });
      return;
    }
    if (code === 4403) {
      this.setStatus({ state: 'error', code: 'request_refused', detail: 'Hermes refused this connection (its request guard).',
        fix: 'A Hermes backend bound to its own machine answers only callers on that machine. From elsewhere — another computer, a container — start it on an address they can reach, which engages its sign-in (username and password).' });
      return;
    }
    this.setStatus({ state: 'offline', code: 'closed', detail: was ? 'The connection to Hermes was lost; reconnecting…' : 'Hermes is not answering; trying again…' });
    this.later();
  }
  /** Tries again after a jittered, growing delay (a socket that opened and died within seconds counts as failed). */
  later() {
    clearTimeout(this.timer);
    if (this.openedAt && Date.now() - this.openedAt >= STABLE_OPEN_MS) this.attempt = 0;
    const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** this.attempt++);
    const gen = this.gen;
    this.timer = setTimeout(() => { if (gen === this.gen && this.key) this.open(); }, Math.max(250, Math.random() * ceiling));
    this.timer.unref?.();
    if (this.status.state === 'connecting') this.setStatus({ state: 'offline', code: 'unreachable', detail: 'Hermes is not answering; trying again…', fix: 'Check that `hermes serve` (or `hermes dashboard`) is running at this address.' });
  }

  // ---------------------------------------------------------------- calls
  rpc(method, params = {}, { timeoutMs = CALL_MS } = {}) {
    const id = `m${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(fail('timeout', `Hermes did not answer ${method} in time`)); }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      if (!this.send({ jsonrpc: '2.0', id, method, params })) { this.pending.delete(id); clearTimeout(timer); reject(fail('not_connected', 'Hermes is not connected')); }
    });
  }
  /** A JSON-RPC request to Hermes, once it is connected. */
  async request(method, params = {}, opts = {}) {
    await this.whenConnected(opts.waitMs);
    return this.rpc(method, params, opts);
  }
  /** A REST call beside the socket: { status, json } (or the raw answer with raw: true). A refused access token is renewed once. */
  async rest(method, path, { query = null, body = undefined, timeoutMs = CALL_MS, raw = false } = {}) {
    if (!this.base) throw fail('not_connected', 'Hermes is not configured');
    const url = `${this.base.http}${path}${query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))}` : ''}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = { ...(await this.authHeaders()), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
      let res;
      try { res = await this.fetchImpl(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) }); }
      catch (e) { throw fail(e.name === 'TimeoutError' ? 'timeout' : 'unreachable', e.name === 'TimeoutError' ? 'Hermes took too long' : 'Hermes is not answering'); }
      if (res.status === 401 && this.auth === 'password' && attempt === 0 && this.tokens) { this.tokens = { ...this.tokens, expiresAt: 1 }; continue; }
      if (raw) return res;
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const d = json && (json.detail || json.error || json.message);
        throw fail(res.status === 404 ? 'not_found' : res.status === 401 ? 'auth_rejected' : res.status === 503 ? 'unavailable' : 'provider_error', String(typeof d === 'string' ? d : `Hermes answered ${res.status}`).slice(0, 300), { httpStatus: res.status });
      }
      return json;
    }
    throw fail('auth_rejected', 'Hermes refused the sign-in');
  }

  stopSocket() {
    this.gen++;
    clearTimeout(this.timer); this.timer = null; clearInterval(this.beat); this.beat = null;
    const ws = this.ws;
    this.ws = null; this.ready = false;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(fail('not_connected', 'The connection to Hermes was closed')); }
    this.pending.clear();
    this.failWaiters();
    if (ws) { try { ws.close(1000); } catch { /* gone */ } setTimeout(() => { try { ws.terminate(); } catch { /* gone */ } }, 1500).unref?.(); }
  }
  async stop() { this.key = null; this.active = false; this.stopSocket(); this.status = { state: 'offline' }; }
}

/** Whether a Hermes backend answers at an http(s):// address (its public status page; nothing is signed in). */
export async function probe(url, timeoutMs = 2500, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(`${bases(url).http}/api/status`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j && typeof j.version === 'string' && 'auth_required' in j);
  } catch { return false; }
}
