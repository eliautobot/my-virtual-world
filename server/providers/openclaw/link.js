// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One live connection to an OpenClaw gateway (docs/features/agent-providers.md §2), inside the provider helper process.
// It is built on OpenClaw's published client (@openclaw/gateway-client): the challenge-signed handshake, protocol
// negotiation, reconnects with backoff and pausing on what needs a person are the client's; this keeps the device
// identity and the device token (sealed by the server; new ones handed back through persist), reports the connection's
// state as provider.status events, and answers requests once the gateway is there.
// - configure(config, secrets) is called with every call's credentials: the client is rebuilt only when what it is built
//   from changes (the address, how it signs in, the token or password, the access asked for, the device key).
// - Following OpenClaw's guide for clients (docs.openclaw.ai/gateway/clients): the scopes asked for are the ones used,
//   only the client capabilities implemented are advertised, and the limits come from hello-ok, never assumed.
import crypto from 'node:crypto';
import { GatewayClient } from '@openclaw/gateway-client';
import { GATEWAY_CLIENT_CAPS, GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from '@openclaw/gateway-protocol/client-info';
import { classifyGatewayConnectFailure, readConnectErrorDetailCode, readPairingConnectErrorDetails } from '@openclaw/gateway-protocol/connect-error-details';
import { identityFrom, newDeviceKey, rawPublicKey, signPayload } from './identity.js';

export const KIND = 'openclaw';
/** operator.read: history, sessions, models; write: chat and session changes; approvals and questions: answering them
 *  in the chat; admin (access 'full' only): the provider's settings, from its sub-menu. */
export const SCOPES = Object.freeze(['operator.read', 'operator.write', 'operator.approvals', 'operator.questions']);
export const ADMIN_SCOPE = 'operator.admin';
/** The client capabilities this adapter implements (OpenClaw: "advertise only capabilities the client actually implements"). */
// (session-scoped-events: the gateway sends a session's events only to the connections that follow it — ./chat.js
// subscribes to the sessions it has runs in)
export const CLIENT_CAPS = Object.freeze([GATEWAY_CLIENT_CAPS.TOOL_EVENTS, GATEWAY_CLIENT_CAPS.APPROVALS, GATEWAY_CLIENT_CAPS.EXEC_APPROVALS, GATEWAY_CLIENT_CAPS.PLUGIN_APPROVALS,
  GATEWAY_CLIENT_CAPS.SESSION_SCOPED_EVENTS]);
const WAIT_MS = 10000;   // a request made while the gateway is (re)connecting waits this long for it
// while the device waits for approval the client is paused (OpenClaw: a pairing refusal stops its retries); it is asked
// again after these delays (then every last one), so the connection goes on by itself once the owner approves it
export const PAIRING_RETRY_MS = Object.freeze([3000, 5000, 10000, 20000, 30000]);

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra });
/** The words for a state a person has to act on (OpenClaw's own classification of the failure, in our words). */
function explain(err) {
  const details = err && err.details;
  const code = readConnectErrorDetailCode(details);
  const c = classifyGatewayConnectFailure({ details, message: err && err.message });
  if (c.kind === 'pairing-required') {
    const p = readPairingConnectErrorDetails(details) || {};
    const what = p.reason === 'scope-upgrade' ? 'asks for more access than it was approved for' : p.reason === 'role-upgrade' ? 'asks for a higher role than it was approved for'
      : p.reason === 'metadata-upgrade' ? 'changed and must be approved again' : 'is waiting to be approved as a device of this gateway';
    return { state: 'pairing', code, requestId: p.requestId || undefined, detail: `My Virtual World ${what}.`,
      fix: `Approve it in OpenClaw: the Control UI → Devices, or on the gateway's machine run: openclaw devices approve${p.requestId ? ` ${p.requestId}` : ''}. It connects by itself once approved.` };
  }
  const FIX = {
    'auth-rejected': 'Check the gateway token or password in this provider\'s settings (OpenClaw: openclaw config get gateway.auth.token).',
    'scope-mismatch': 'The device\'s approval no longer covers what it asks for: approve the new request in OpenClaw (Control UI → Devices).',
    'rate-limited': 'Too many failed sign-ins: wait a minute, then check the token or password.',
    'device-identity-required': 'This gateway needs a device identity; reconnect from Agent Providers.',
    'identity-proxy': c.remediation,
    'gateway-rejected': c.remediation || 'Check the gateway address and that the gateway is up to date.',
  };
  if (c.kind === 'unreachable') return { state: 'offline', code: code || 'unreachable', detail: 'The gateway is not answering.', fix: 'Check that OpenClaw\'s gateway is running and the address is right; it keeps trying by itself.' };
  return { state: 'error', code: code || c.kind, detail: String(c.userMessage || 'The gateway refused the connection').slice(0, 300), fix: FIX[c.kind] || c.remediation || undefined };
}

export class GatewayLink {
  /**
   * @param {{ connectionId: string, emit: (e: object) => void, persist: (field: string, value: string|null) => void,
   *   onEvent?: (evt: object) => void, onHello?: (hello: object) => void, onDown?: () => void, clientVersion?: string, Client?: typeof GatewayClient }} o
   */
  constructor({ connectionId, emit, persist, onEvent = null, onHello = null, onDown = null, clientVersion = '0.0.0', Client = GatewayClient, retryMs = PAIRING_RETRY_MS }) {
    Object.assign(this, { connectionId, emit, persist, onEvent, onHello, onDown, clientVersion, Client, retryMs });
    this.retryTimer = null; this.retries = 0;
    this.client = null; this.key = null; this.hello = null; this.status = { state: 'offline' }; this.waiters = [];
    this.stored = null;   // the device token: { token, scopes, role, deviceId }
  }
  keyOf(url, auth, cred, scopes, deviceKey) { return sha(JSON.stringify([url, auth, cred, scopes, deviceKey])); }
  get connected() { return this.status.state === 'connected' && !!this.hello; }
  /** Whether the connected gateway offers a method (hello-ok's features: what it offers is discovered, never assumed). */
  /** This connection's credential for the gateway's web routes: its device token (OpenClaw takes an operator device's
   *  token as a Bearer credential there), or the gateway's own token or password while it still has them. */
  bearer() { return (this.stored && this.stored.token) || this.shared || null; }
  offers(method) { return !!(this.hello && this.hello.features && Array.isArray(this.hello.features.methods) && this.hello.features.methods.includes(method)); }
  /** Whether the gateway granted this device a scope (its hello says which). */
  grants(scope) { return !!(this.hello && this.hello.auth && Array.isArray(this.hello.auth.scopes) && this.hello.auth.scopes.includes(scope)); }
  sends(event) { return !!(this.hello && this.hello.features && Array.isArray(this.hello.features.events) && this.hello.features.events.includes(event)); }

  /** Builds (or keeps) the client for these settings and credentials. */
  configure(config = {}, secrets = {}) {
    let deviceKey = this.deviceKey && this.deviceKey === secrets.deviceKey ? this.deviceKey : secrets.deviceKey || this.deviceKey;
    if (!deviceKey) { deviceKey = newDeviceKey(); this.persist('deviceKey', deviceKey); }
    let identity;
    try { identity = identityFrom(deviceKey); } catch {
      // a key that cannot be read is replaced: the gateway sees a new device, to approve again
      deviceKey = newDeviceKey(); this.persist('deviceKey', deviceKey); this.persist('deviceToken', null); identity = identityFrom(deviceKey);
    }
    const auth = config.auth === 'password' ? 'password' : 'token';
    const scopes = config.access === 'chat' ? [...SCOPES] : [...SCOPES, ADMIN_SCOPE];
    // how it signs in: the gateway's own token (or password) while it pairs; afterwards the device token the gateway issued
    // it (the server then forgets the gateway's — OpenClaw's guide: use the token pairing minted)
    let stored = null;
    if (secrets.deviceToken) { try { const t = JSON.parse(secrets.deviceToken); if (t && t.deviceId === identity.deviceId && t.token) stored = t; } catch { /* not ours: none */ } }
    const shared = (auth === 'token' ? secrets.token : secrets.password) || '';
    const key = this.keyOf(config.url, auth, shared ? `shared:${shared}` : stored ? 'device' : '', scopes, deviceKey);
    if (key === this.key && this.client) return false;
    this.stopClient();
    this.last = { config, secrets };
    if (key !== this.key) this.retries = 0;
    this.key = key; this.deviceKey = deviceKey; this.identity = identity; this.scopes = scopes; this.url = config.url; this.auth = auth;
    this.stored = stored; this.shared = shared;
    if (!config.url || (!shared && !stored)) {
      this.setStatus({ state: 'error', code: 'not_configured', detail: !config.url ? 'The gateway address is not set.' : `The gateway ${auth} is not set.`,
        fix: 'Add it in this provider\'s settings (Edit): it is used once, to pair this installation with the gateway.' });
      return true;
    }
    if (!this.retrying) this.setStatus({ state: 'connecting', detail: 'Connecting to the gateway…' });   // (asking again while waiting for approval: still waiting)
    const gen = this.gen = (this.gen || 0) + 1;
    const live = fn => (...a) => { if (gen === this.gen) return fn(...a); return undefined; };   // (a callback of a replaced client is ignored)
    this.client = new this.Client({
      url: config.url, ...(shared ? (auth === 'token' ? { token: shared } : { password: shared }) : {}),
      clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT, mode: GATEWAY_CLIENT_MODES.UI, clientDisplayName: 'My Virtual World', clientVersion: this.clientVersion,
      platform: process.platform, role: 'operator', scopes, caps: [...CLIENT_CAPS], deviceIdentity: identity,
      hostDeps: {
        signDevicePayload: signPayload,
        publicKeyRawBase64UrlFromPem: rawPublicKey,
        loadDeviceAuthToken: ({ deviceId, role }) => (this.stored && this.stored.deviceId === deviceId && this.stored.role === role ? { token: this.stored.token, scopes: this.stored.scopes } : null),
        storeDeviceAuthToken: live(({ deviceId, role, token, scopes }) => {
          this.stored = { deviceId, role, token, scopes: Array.isArray(scopes) ? scopes : [] };
          this.persist('deviceToken', JSON.stringify(this.stored));
          // paired: the gateway's own token is handed off — the server forgets it, and this link counts as built from the
          // device token (the next call's credentials are those; nothing is rebuilt for it)
          if (this.shared) { this.persist(this.auth, null); this.shared = ''; this.key = this.keyOf(this.url, this.auth, 'device', this.scopes, this.deviceKey); }
        }),
        clearDeviceAuthToken: live(() => { this.stored = null; this.persist('deviceToken', null); }),
      },
      onHelloOk: live(hello => {
        this.hello = hello; this.retries = 0;
        const v = hello && hello.server && hello.server.version;
        this.setStatus({ state: 'connected', version: v ? String(v) : undefined, detail: `Connected${v ? ` to OpenClaw ${v}` : ''}.` });
        for (const w of this.waiters.splice(0)) w.resolve();
        try { this.onHello?.(hello); } catch { /* the adapter's own */ }
      }),
      onConnectError: live(err => {
        const s = explain(err);
        // its own token refused and no gateway token left to pair with: the device was removed in OpenClaw, or its token expired
        if (s.state === 'error' && !this.shared && (!this.stored || /DEVICE_TOKEN|AUTH_TOKEN_MISSING|AUTH_REQUIRED|AUTH_UNAUTHORIZED/.test(String(s.code)))) {
          this.setStatus({ state: 'error', code: 'repair_needed', detail: 'The gateway no longer accepts this installation\'s device (it was removed in OpenClaw, or its token expired).',
            fix: 'Enter the gateway token again (Edit) to pair it again.' });
          return;
        }
        this.setStatus(s);
      }),
      onReconnectPaused: live(() => {
        // the client stopped retrying. Waiting for approval: ask again later, by itself. The gateway's token (still in this
        // client from before pairing) refused, with the device's own at hand: go on with that. Anything else: a person must
        // act (the reason came with onConnectError).
        if (this.status.state === 'pairing') { this.retryLater(); return; }
        if (this.stored && this.status.code === 'AUTH_TOKEN_MISMATCH' && this.last) { this.key = null; this.configure(this.last.config, { ...this.last.secrets, token: undefined, password: undefined, deviceToken: JSON.stringify(this.stored) }); return; }
        if (this.status.state === 'connecting' || this.status.state === 'offline') this.setStatus({ state: 'error', code: 'paused', detail: 'The gateway refused the connection.', fix: 'Check this provider\'s settings, then reconnect.' });
        this.failWaiters();
      }),
      onClose: live(() => {
        const was = this.connected;
        this.hello = null;
        if (was) { this.setStatus({ state: 'offline', code: 'closed', detail: 'The connection to the gateway was lost; reconnecting…' }); try { this.onDown?.(); } catch { /* the adapter's own */ } }
      }),
      onEvent: live(evt => { try { this.onEvent?.(evt); } catch { /* one bad event never stops the rest */ } }),
    });
    this.client.start();
    return true;
  }
  setStatus(s) {
    const next = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
    const same = ['state', 'code', 'detail', 'requestId', 'version'].every(k => next[k] === this.status[k]);
    this.status = next;
    if (next.state !== 'connecting' && next.state !== 'connected' && next.state !== 'offline') this.failWaiters();
    if (!same) { try { this.emit({ type: 'provider.status', kind: KIND, connectionId: this.connectionId, ...next }); } catch { /* the bus refused it */ } }
  }
  failWaiters() {
    const s = this.status;
    for (const w of this.waiters.splice(0)) w.reject(fail(s.state === 'pairing' ? 'pairing' : 'not_connected', s.detail || 'The gateway is not connected', { fix: s.fix }));
  }
  /** Resolves when the gateway is connected; rejects at once if a person must act first, or after ms. */
  whenConnected(ms = WAIT_MS) {
    if (this.connected) return Promise.resolve();
    if (!this.client || this.status.state === 'error' || this.status.state === 'pairing') {
      return Promise.reject(fail(this.status.state === 'pairing' ? 'pairing' : 'not_connected', this.status.detail || 'The gateway is not connected', { fix: this.status.fix }));
    }
    return new Promise((resolve, reject) => {
      const w = { resolve: () => { clearTimeout(t); resolve(); }, reject: e => { clearTimeout(t); reject(e); } };
      const t = setTimeout(() => { this.waiters = this.waiters.filter(x => x !== w); reject(fail('timeout', 'The gateway did not answer in time', { fix: this.status.fix })); }, ms);
      t.unref?.();
      this.waiters.push(w);
    });
  }
  /** Waits until the state settles (connected, pairing or error) or ms pass: what a Test shows. */
  async settle(ms = WAIT_MS) {
    try { await this.whenConnected(ms); } catch { /* the status says why */ }
    return { ...this.status };
  }
  /** A request to the gateway, once it is connected; a method the gateway doesn't offer is refused here. */
  async request(method, params = {}, opts = {}) {
    await this.whenConnected(opts.waitMs);
    if (!this.offers(method)) throw fail('unsupported', `This OpenClaw gateway does not offer ${method}`);
    try { return await this.client.request(method, params, opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : undefined); }
    catch (e) { throw fail(e.gatewayCode || e.code || 'provider_error', String(e.message || e).slice(0, 400), { details: e.details }); }
  }
  /** What the pages may know of this connection: its state and what the gateway said about itself (never a credential). */
  snapshot() {
    const h = this.hello;
    return { ...this.status, deviceId: this.identity ? this.identity.deviceId : undefined,
      gateway: h ? { version: h.server && h.server.version, protocol: h.protocol, methods: (h.features && h.features.methods || []).length,
        scopes: h.auth && Array.isArray(h.auth.scopes) ? h.auth.scopes : [], attachments: h.policy && h.policy.attachments ? { ...h.policy.attachments } : null,
        maxPayload: h.policy && h.policy.maxPayload } : null };
  }
  /** Asks the gateway again after the next pairing delay (a new client: the paused one never retries). */
  retryLater() {
    clearTimeout(this.retryTimer);
    const ms = this.retryMs[Math.min(this.retries, this.retryMs.length - 1)];
    this.retries += 1;
    const gen = this.gen;
    this.retryTimer = setTimeout(() => {
      if (gen !== this.gen || !this.last || this.status.state !== 'pairing') return;
      this.key = null;
      const keep = this.retries;
      this.retrying = true;
      try { this.configure(this.last.config, this.last.secrets); } finally { this.retrying = false; }
      this.retries = keep;
    }, ms);
    this.retryTimer.unref?.();
  }
  stopClient() {
    clearTimeout(this.retryTimer); this.retryTimer = null;
    const c = this.client;
    this.client = null; this.hello = null; this.gen = (this.gen || 0) + 1;
    this.failWaiters();
    if (c) return c.stopAndWait({ timeoutMs: 1500 }).catch(() => {});
    return Promise.resolve();
  }
  async stop() { this.key = null; await this.stopClient(); this.status = { state: 'offline' }; }
}
