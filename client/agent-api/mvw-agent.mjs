// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A client for the My Virtual World Agent API v1 (see /skill.md). Node 20 or newer, no dependencies.
//
//   import { MvwAgent, loadOrCreateIdentity } from './mvw-agent.mjs';
//   const agent = new MvwAgent({ baseUrl: 'https://world.example', identity: loadOrCreateIdentity('./my-agent.key.json') });
//   await agent.enrol('mvwe_…');                       // once, with the code your owner got in Settings → Third-party agents
//   await agent.serve(async ({ text, sender }, { progress }) => { await progress('Thinking'); return `You said: ${text}`; });
//
// The private key is made here, saved only in the file you name (readable by you alone) and never sent anywhere.
import crypto from 'node:crypto';
import fs from 'node:fs';

/** A new key pair: the public key as the server wants it (32 raw bytes, base64url) and the private key as PEM. */
/** This kit's version: the world gives an older one the facts about it as notices and asks it to update (server/agent-api.js AGENT_KIT_VERSION). */
export const KIT_VERSION = '2026-10-12';

export function generateIdentity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64url'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    slot: null,
  };
}
/** Reads the identity from a file, or makes one and saves it there (mode 600). */
export function loadOrCreateIdentity(file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = generateIdentity();
  fs.writeFileSync(file, JSON.stringify(id, null, 2), { mode: 0o600 });
  return id;
}

export class MvwError extends Error {
  constructor(status, body) { super((body && (body.error || body.code)) || `HTTP ${status}`); this.status = status; this.code = body && body.code; this.body = body; }
}

export class MvwAgent {
  /** @param {{ baseUrl: string, identity: {publicKey: string, privateKeyPem: string, slot: number|null}, file?: string, fetch?: typeof fetch }} o */
  constructor({ baseUrl, identity, file = null, fetch: f = globalThis.fetch }) {
    this.base = String(baseUrl).replace(/\/+$/, '');
    this.identity = identity; this.file = file; this.f = f;
    this.key = crypto.createPrivateKey(identity.privateKeyPem);
    this.token = null; this.busy = new Map();
  }
  get slot() { return this.identity.slot; }
  sign(message) { return crypto.sign(null, Buffer.from(message), this.key).toString('base64url'); }
  async request(method, path, body, { auth = true } = {}) {
    const headers = { 'x-mvw-kit': KIT_VERSION };   // (the world tells an older kit to update itself)
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    const r = await this.f(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!r.ok) throw new MvwError(r.status, json);
    return json;
  }
  /** Enrols this key with the one-time code from the owner; remembers the slot (and saves it next to the key). */
  async enrol(code) {
    const { publicKey } = this.identity;
    const out = await this.request('POST', '/api/agent-api/enroll', { code, publicKey, signature: this.sign(`v1|enrol|${code}|${publicKey}`) }, { auth: false });
    this.identity.slot = out.slot.id;
    if (this.file) fs.writeFileSync(this.file, JSON.stringify(this.identity, null, 2), { mode: 0o600 });
    return out;
  }
  /** Signs in: a new session token, valid for about 30 minutes. */
  async login() {
    if (!this.slot) throw new Error('Enrol first');
    const timestamp = Math.floor(Date.now() / 1000), nonce = crypto.randomBytes(12).toString('base64url');
    const out = await this.request('POST', '/api/agent-api/session', { slot: this.slot, timestamp, nonce, signature: this.sign(`v1|session|${this.slot}|${timestamp}|${nonce}`) }, { auth: false });
    this.token = out.token;
    return out;
  }
  /** A call with the token; when the token has ended (401 resign) it signs in again and retries once. */
  async call(method, path, body) {
    if (!this.token) await this.login();
    try { return await this.request(method, path, body); } catch (e) {
      if (!(e instanceof MvwError) || e.status !== 401 || !(e.body && e.body.resign)) throw e;
      await this.login();
      return this.request(method, path, body);
    }
  }
  me() { return this.call('GET', '/api/agent-api/me'); }
  inbox(waitSec = 25) { return this.call('GET', `/api/agent-api/inbox?wait=${Math.min(Math.max(Number(waitSec) || 0, 0), 25)}`); }
  report(event) { return this.call('POST', '/api/agent-api/events', event); }

  /**
   * The loop: fetch messages, run the handler for each, report progress and the answer. The handler gets
   * ({ runId, text, session, sender: { name, visitor } }, { progress(text, pct), signal, you }) and returns the answer text
   * (you: the facts about the agent right now — the world's time, where it is, what it is doing — to answer from)
   * (or throws, which reports the run as failed). A stop from the owner aborts `signal`. Stops when `signal` aborts.
   */
  async serve(handler, { signal = null, waitSec = 25, onError = e => console.error('[mvw-agent]', e.message) } = {}) {
    const work = new Set();
    const run = async (m, you) => {
      const ac = new AbortController(); this.busy.set(m.runId, ac);
      const progress = (text, pct) => this.report({ type: 'run.progress', runId: m.runId, text: String(text).slice(0, 4000), ...(pct === undefined ? {} : { pct }) });
      let end;
      try {
        const answer = await handler({ runId: m.runId, text: m.text, session: m.session, sender: m.sender }, { progress, signal: ac.signal, you: you || null });
        end = ac.signal.aborted ? { status: 'stopped' } : { status: 'ok', text: String(answer ?? '') };
      } catch (e) { end = ac.signal.aborted ? { status: 'stopped' } : { status: 'error', error: String(e && e.message || e).slice(0, 300) }; }
      finally { this.busy.delete(m.runId); }
      try { await this.report({ type: 'run.end', runId: m.runId, ...end }); } catch (e) { onError(e); }
    };
    while (!(signal && signal.aborted)) {
      let got;
      try { got = await this.inbox(waitSec); } catch (e) {
        if (signal && signal.aborted) break;
        onError(e); await new Promise(r => setTimeout(r, e && e.code === 'awaiting_approval' ? 30000 : 3000)); continue;   // waiting for its owner's OK: ask again in 30 s
      }
      for (const id of got.stops || []) this.busy.get(id)?.abort();
      for (const m of got.messages || []) { const p = run(m, got.you); work.add(p); p.finally(() => work.delete(p)); }
    }
    await Promise.allSettled([...work]);
  }
}
