// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A stand-in OpenClaw gateway for the tests (Agent Providers, docs/features/agent-providers.md): the protocol v4
// handshake as a real gateway runs it - connect.challenge first, then the client's signed connect - with the frames and
// error details recorded from OpenClaw 2026.9.6 (tests/fixtures/openclaw/). It checks the device signature for real
// (the device auth payload v3 of OpenClaw's own client, Ed25519), the shared token, and pairing: 'auto' approves a new
// device at once (OpenClaw's silent local pairing); 'approval' answers PAIRING_REQUIRED with a request id until
// approve(id), as a gateway with autoApproveLocal off does. Requests are answered from `methods` (name → (params, conn) =>
// payload, or throw { code, message, details }).
// The chat (scripted from the recorded runs, tests/fixtures/openclaw/run-*.json): sessions.create, chat.send - it replays a
// recorded run's frames with this run's id and session (a message naming [[tool: replays the command run that waits for
// approval until approval.resolve; [[think]] the reasoning one; [[slow]] waits between frames so Stop can cut it), to the
// connections that follow the session (session-scoped events) - chat.abort, approval.resolve, chat.history (the run's
// recorded history), models.list, sessions.list (with one session made elsewhere), sessions.patch (thinking levels checked
// against the model's, as a gateway does).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { buildDeviceAuthPayloadV3 } from '@openclaw/gateway-client';

// (the start of a JPEG and a few bytes: what the pages are given is passed on, not decoded)
const FAKE_JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const HELLO = JSON.parse(fs.readFileSync(new URL('../fixtures/openclaw/hello-ok.json', import.meta.url), 'utf8'));
const RUN = n => JSON.parse(fs.readFileSync(new URL(`../fixtures/openclaw/run-${n}.json`, import.meta.url), 'utf8'));
const MODELS = [
  { id: 'stub-1', name: 'Stub One', provider: 'stub', contextWindow: 128000, reasoning: false, tags: ['default', 'configured'], thinkingLevels: [{ id: 'off', label: 'off' }], thinkingDefault: 'off', available: true },
  { id: 'stub-2', name: 'Stub Two', provider: 'stub', contextWindow: 32000, reasoning: true, tags: ['configured'], thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'].map(id => ({ id, label: id })), thinkingDefault: 'medium', available: true },
];
const deep = (o, from, to) => JSON.parse(JSON.stringify(o).split(from).join(to));
const rawKey = b64 => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64 }, format: 'jwk' });

/** A 1×1 PNG: the stand-in's kept image (an agent's MEDIA line, kept by OpenClaw as a managed attachment). */
export const MEDIA_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
export const MEDIA_CLIP = Buffer.from('FAKE-MP4-'.repeat(200));

export async function startFakeOpenClaw({ token = 'gw-token', pairing = 'auto', version = '2026.9.6', methods = {}, agents = [{ id: 'main', name: 'Main', emoji: '🦞' }] } = {}) {
  // its web routes beside the WebSocket, as OpenClaw serves them on one port: a kept attachment at its ticketed link
  // (artifacts.download hands out the ticket), and assistant-media for a path an agent wrote - signed in with a paired
  // device's token (Bearer), and only the files that session may show (f.files)
  const web = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, mime, body) => { res.writeHead(code, { 'content-type': mime, 'content-length': body.length }); res.end(body); };
    f.webHits.push(`${req.method} ${u.pathname}`);
    const m = /^\/api\/chat\/media\/outgoing\/[^/]+\/([^/]+)\/full$/.exec(u.pathname);
    if (m) {
      const t = f.tickets.get(u.searchParams.get('mediaTicket') || '');
      if (!t || t.id !== decodeURIComponent(m[1])) return send(401, 'application/json', Buffer.from('{"error":"Unauthorized"}'));
      return send(200, f.media.get(t.artifactId).mime, f.media.get(t.artifactId).bytes);
    }
    if (u.pathname === '/__openclaw__/assistant-media') {
      const bearer = (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1];
      if (!bearer || ![...f.paired.values()].some(d => d.deviceToken === bearer)) return send(401, 'application/json', Buffer.from('{"error":"Unauthorized"}'));
      const file = f.files.get(u.searchParams.get('source') || '');
      return file ? send(200, file.mime, file.bytes) : send(404, 'application/json', Buffer.from('{"error":"not found"}'));
    }
    send(404, 'text/plain', Buffer.from('Not found'));
  });
  const wss = new WebSocketServer({ server: web });
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  const f = {
    url: `ws://127.0.0.1:${web.address().port}`, token, pairing, agents,
    // media (an answer with [[media]]): its kept image (artifact id → { mime, bytes, fileName }) and the files a session may show by path
    media: new Map([['artifact_managed_image_m1', { mime: 'image/png', bytes: MEDIA_PNG, fileName: 'chart.png' }]]),
    files: new Map([['/work/clip.mp4', { mime: 'video/mp4', bytes: MEDIA_CLIP }]]),
    tickets: new Map(), webHits: [], steered: [], refreshes: [],
    // OpenClaw's task ledger (a subagent, a job): id → TaskSummary with its prompt, result and transcript
    taskLedger: new Map(), cancels: [],
    // its browser (the browser plugin's browser.request routes) and its screencast sockets
    browser: { running: false, tabs: new Map(), acts: [], casts: new Set(), tokens: new Map() },
    /** The page in a tab changed: a new frame to whoever watches its screencast. */
    browserFrame(targetId, head = {}) {
      for (const c of f.browser.casts) if (c.targetId === targetId) sendFrame(c.ws, { url: f.browser.tabs.get(targetId)?.url || '', cssWidth: 1000, cssHeight: 600, scrollX: 0, scrollY: 0, ts: Date.now() / 1000, ...head });
    },
    /** A task started (or changed) from a session, announced as OpenClaw does: a `task` event to every operator. */
    task(sessionKey, fields) {
      const id = fields.id || `task-${crypto.randomBytes(4).toString('hex')}`, was = f.taskLedger.get(id) || {};
      const agentId = (/^agent:([^:]+):/.exec(sessionKey) || [])[1];
      const t = { ...was, id, status: 'running', runtime: 'subagent', title: 'Background task', agentId, sessionKey, ownerKey: sessionKey,
        childSessionKey: `agent:${agentId}:subagent:${id}`, hasTranscript: true, createdAt: Date.now(), startedAt: Date.now(), updatedAt: Date.now(), ...fields };
      f.taskLedger.set(id, t);
      const { prompt, result, transcript, ...summary } = t;
      f.toAll('task', { action: 'upserted', task: summary });
      return id;
    },
    sessionFeed: new Set(),   // sockets that called sessions.subscribe: told of every session's turns starting and ending
    /** A session's turn starting or ending, as OpenClaw's session feed tells it (sessions.changed). */
    activity(key, active, runId) {
      const agentId = f.sessions.get(key)?.agentId || (/^agent:([^:]+):/.exec(key) || [])[1];
      const row = { key, agentId, hasActiveRun: active, activeRunIds: active ? [runId] : [] };
      for (const ws of f.sessionFeed) send(ws, { type: 'event', event: 'sessions.changed', payload: { reason: active ? 'agent.run.started' : 'agent.input.settled', sessionKey: key, hasActiveRun: active, activeRunIds: row.activeRunIds, session: row } });
    },
    paired: new Map(),       // deviceId → { scopes, deviceToken, publicKey }
    pending: new Map(),      // requestId → { deviceId, scopes, publicKey }
    connects: [], requests: [], sockets: new Set(), badSignatures: 0,
    sessions: new Map(),     // key → { agentId, model, thinkingLevel, history: [], label }
    runs: new Map(),         // runId → { key, frames, at, timer, waiting, aborted }
    subs: new Map(),         // socket → Set(session key)
    patches: [], sends: [], aborts: [], resolutions: [],
    // its settings (the sub-menu): a config with secrets in it, its description, and the base-hash guard on changes
    config: { gateway: { port: 18789, auth: { mode: 'token', token: 'GW-CONFIG-SECRET' } }, models: { providers: { stub: { baseUrl: 'http://x', apiKey: 'sk-PROVIDER-SECRET' } } }, agents: { defaults: { model: { primary: 'stub/stub-1' } } } },
    configRev: 1, changes: [],
    approve(requestId) {
      const p = f.pending.get(requestId);
      if (!p) return false;
      f.pending.delete(requestId);
      f.paired.set(p.deviceId, { scopes: p.scopes, deviceToken: `dt-${crypto.randomBytes(12).toString('hex')}`, publicKey: p.publicKey });
      return true;
    },
    /** A session event to the connections that follow the session (session-scoped events). */
    toSession(key, event, payload) { for (const [ws, keys] of f.subs) if (keys.has(key)) send(ws, { type: 'event', event, payload }); },
    toAll(event, payload) { for (const ws of f.sockets) send(ws, { type: 'event', event, payload }); },
    /** Replays a run's recorded frames, one at a time; an approval waits for approval.resolve. */
    play(runId) {
      const r = f.runs.get(runId);
      if (!r || r.aborted) return;
      if (!r.announced) { r.announced = true; f.activity(r.key, true, runId); }
      while (r.at < r.frames.length) {
        const fr = r.frames[r.at++];
        if (fr.event === 'exec.approval.requested') { r.waiting = fr.payload.id; f.toAll(fr.event, fr.payload); return; }
        if (fr.event === 'question.requested') { r.waiting = fr.payload.id; f.toSession(r.key, fr.event, fr.payload); return; }
        if (fr.event === 'question.resolved') continue;   // (sent by question.resolve)
        if (fr.event === 'agent' && fr.payload.stream === 'plan') { const x = f.sessions.get(r.key); x.card = { sessionKey: r.key, revision: 1, updatedAt: Date.now(), markdown: 'Reviewing the docs', steps: fr.payload.data.steps }; }
        if (fr.event === 'exec.approval.resolved') continue;   // (sent by approval.resolve)
        f.toSession(r.key, fr.event, fr.payload);
        if (fr.event === 'chat' && fr.payload.state === 'final') {
          const x = f.sessions.get(r.key); if (x) { x.history.push(...r.history); x.updatedAt = Date.now(); } r.finished = true;
          f.activity(r.key, false, runId);
          if (r.next) setTimeout(r.next, 5);   // (a message queued behind it: its turn now)
        }
        if (r.slow > 2 && fr.event === 'chat' && fr.payload.state === 'delta') { r.timer = setTimeout(() => f.play(runId), r.slow); return; }
      }
    },
    /** A run started on another channel (nothing this installation sent): a recorded one, replayed to the session's followers. */
    external(sessionKey, fixture = 'thinking', message = 'Hello from another channel', slow = 30) {
      const fx = RUN(fixture), runId = `ext-${crypto.randomUUID()}`;
      const from = fx.frames.find(fr => fr.payload.sessionKey)?.payload.sessionKey || '\u0000';
      const swap = o => deep(deep(o, fx.runId, runId), from, sessionKey);
      const history = swap(fx.history);
      if (history[0] && history[0].role === 'user') history[0] = { ...history[0], content: message };
      f.runs.set(runId, { key: sessionKey, frames: swap(fx.frames), at: 0, timer: null, waiting: null, aborted: false, slow, history });
      setTimeout(() => f.play(runId), 5);
      return runId;
    },
    /** Every live connection is dropped (a gateway restart, a network blip). */
    dropAll() { for (const ws of f.sockets) ws.terminate(); },
    async stop() { for (const ws of f.sockets) ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => web.close(r)); },
    methods: {
      // as OpenClaw does: agents.list carries the name and emoji its settings give (none for an agent defined only by its
      // workspace); agent.identity.get adds its IDENTITY.md (`file`) - agents: [{ id, name?, emoji?, file?: { name, emoji } }]
      'agents.list': () => ({ defaultId: f.agents[0] ? f.agents[0].id : null, mainKey: 'main', scope: 'per-sender',
        agents: f.agents.map(a => ({ id: a.id, ...(a.name ? { name: a.name, identity: { name: a.name, ...(a.emoji ? { emoji: a.emoji } : {}) } } : {}) })) }),
      'agent.identity.get': ({ agentId }) => {
        const a = f.agents.find(x => x.id === agentId), file = (a && a.file) || {};
        if (!a) throw Object.assign(new Error(`unknown agent ${agentId}`), { code: 'INVALID_REQUEST' });
        const emoji = a.emoji || file.emoji;
        return { agentId, name: a.name || file.name || 'Assistant', nameSource: a.name ? 'config' : file.name ? 'workspace' : 'default', ...(emoji ? { emoji } : {}) };
      },
      'device.pair.remove': ({ deviceId }) => { const had = f.paired.delete(deviceId); return { ok: had, deviceId }; },
      'sessions.create': ({ agentId }) => { const key = `agent:${agentId}:dashboard:${crypto.randomUUID()}`; f.sessions.set(key, { agentId, model: 'stub/stub-1', thinkingLevel: null, history: [], label: null, updatedAt: Date.now() }); return { ok: true, key, sessionId: crypto.randomUUID() }; },
      'sessions.messages.subscribe': ({ key }, conn, ws) => { if (!f.subs.has(ws)) f.subs.set(ws, new Set()); f.subs.get(ws).add(key); return { subscribed: true, key }; },
      'sessions.messages.unsubscribe': ({ key }, conn, ws) => { f.subs.get(ws)?.delete(key); return { ok: true }; },
      'sessions.list': ({ agentId }) => ({ sessions: [...f.sessions].filter(([, x]) => x.agentId === agentId).map(([key, x]) => ({ key, label: x.label, derivedTitle: x.history[0] ? 'A chat' : null,
        updatedAt: x.updatedAt, model: x.model.split('/')[1], modelProvider: 'stub', totalTokens: 15000, contextTokens: x.model === 'stub/stub-2' ? 32000 : 128000 })) }),
      'sessions.patch': ({ key, model, thinkingLevel, label }) => {
        const x = f.sessions.get(key); if (!x) throw Object.assign(new Error('unknown session'), { code: 'INVALID_REQUEST' });
        f.patches.push({ key, model, thinkingLevel, label });
        if (model !== undefined && model !== null) x.model = model;
        if (thinkingLevel) {
          const m = MODELS.find(y => `stub/${y.id}` === x.model);
          if (!m.thinkingLevels.some(l => l.id === thinkingLevel)) throw Object.assign(new Error(`invalid thinkingLevel (use ${m.thinkingLevels.map(l => l.id).join('|')})`), { code: 'INVALID_REQUEST' });
          x.thinkingLevel = thinkingLevel;
        }
        if (label !== undefined) x.label = label;
        return { ok: true, key };
      },
      'sessions.delete': ({ key }) => ({ ok: f.sessions.delete(key) }),
      'models.list': () => ({ models: MODELS }),
      'chat.history': ({ sessionKey }) => { const x = f.sessions.get(sessionKey); return { sessionKey, messages: x ? x.history : [],
        sessionInfo: x ? { key: sessionKey, model: x.model.split('/')[1], modelProvider: 'stub', thinkingLevel: x.thinkingLevel, totalTokens: 15000, contextTokens: x.model === 'stub/stub-2' ? 32000 : 128000 } : null } },
      'chat.send': ({ sessionKey, message, idempotencyKey, attachments, queueMode }) => {
        const x = f.sessions.get(sessionKey); if (!x) throw Object.assign(new Error('unknown session'), { code: 'INVALID_REQUEST' });
        f.sends.push({ sessionKey, message, idempotencyKey, attachments, queueMode });
        // a message while a turn runs, as OpenClaw takes it: steered into that turn by default (its answer comes there;
        // its own run ends empty), or with queueMode followup run after it
        const active = [...f.runs.values()].find(r => r.key === sessionKey && !r.finished && !r.aborted);
        if (active && queueMode !== 'followup') {
          f.steered.push(idempotencyKey);
          active.history.push({ role: 'user', content: message, timestamp: Date.now() },
            { role: 'assistant', content: [{ type: 'text', text: `Steered in: ${message}` }], timestamp: Date.now(), __openclaw: { runId: active.runId } });
          setTimeout(() => f.toSession(sessionKey, 'chat', { runId: idempotencyKey, sessionKey, seq: 1, state: 'final', message: { role: 'assistant', content: [] } }), 20);
          return { runId: idempotencyKey, status: 'started' };
        }
        const fx = RUN(/\[\[ask/.test(message) ? 'question' : /\[\[plan/.test(message) ? 'plan' : /\[\[tool/.test(message) ? 'approval' : 'thinking');
        const swap = o => deep(deep(o, fx.runId, idempotencyKey), fx.frames.find(fr => fr.payload.sessionKey)?.payload.sessionKey || '\u0000', sessionKey);
        const run = { key: sessionKey, frames: swap(fx.frames), at: 0, timer: null, waiting: null, aborted: false, slow: /\[\[slow/.test(message) ? Number((/\[\[slow:(\d+)\]\]/.exec(message) || [])[1] || 120) : 2, history: swap(fx.history) };
        if (/\[\[media\]\]/.test(message)) {
          // (as OpenClaw keeps such an answer: a MEDIA line it kept becomes a media block; one with an outside path stays a line)
          const last = [...run.history].reverse().find(x => x.role === 'assistant');
          const content = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content || '') }];
          last.content = [...content, { type: 'text', text: 'Here is the clip.\nMEDIA:/work/clip.mp4' },
            { type: 'image', artifactId: 'artifact_managed_image_m1', url: `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/m1/full`, alt: 'chart.png', mimeType: 'image/png', width: 1, height: 1, sizeBytes: MEDIA_PNG.length }];
          last.__openclaw = { ...(last.__openclaw || {}), runId: idempotencyKey };
        }
        run.runId = idempotencyKey;
        f.runs.set(idempotencyKey, run);
        if (active) active.next = () => f.play(idempotencyKey); else setTimeout(() => f.play(idempotencyKey), 5);
        return { runId: idempotencyKey, status: 'started' };
      },
      'chat.abort': ({ sessionKey, runId }) => {
        f.aborts.push({ sessionKey, runId });
        const r = f.runs.get(runId); if (!r || r.aborted) return { ok: true, aborted: false };
        r.aborted = true; clearTimeout(r.timer);
        f.toSession(r.key, 'chat', { runId, sessionKey: r.key, seq: 999, state: 'aborted', stopReason: 'user' });
        if (r.announced) f.activity(r.key, false, runId);
        return { ok: true, aborted: true, runIds: [runId] };
      },
      'question.resolve': ({ id, answers, cancel }) => {
        f.resolutions.push({ id, answers, cancel });
        for (const [runId, r] of f.runs) if (r.waiting === id) {
          r.waiting = null;
          f.toSession(r.key, 'question.resolved', { id, status: cancel ? 'cancelled' : 'answered', ...(answers ? { answers } : {}) });
          setTimeout(() => f.play(runId), 5);
        }
        return { status: cancel ? 'cancelled' : 'answered', ...(answers ? { answers } : {}) };
      },
      'progressCard.get': ({ sessionKey }) => ({ card: f.sessions.get(sessionKey)?.card || null }),
      // (as OpenClaw 2026.9.6: no card, refused; otherwise the agent is asked - a hidden turn steered into the session -
      // and accepted at once; the card it writes is announced with progressCard.changed { sessionKey, revision })
      'progressCard.refresh': ({ sessionKey, agentId, idempotencyKey }) => {
        const x = f.sessions.get(sessionKey);
        if (!x || !x.card) throw Object.assign(new Error('There is no progress card to refresh.'), { code: 'INVALID_REQUEST' });
        f.refreshes.push({ sessionKey, agentId, idempotencyKey });
        const card = x.card;
        setTimeout(() => {
          x.card = { ...card, revision: card.revision + 1, updatedAt: Date.now(), markdown: 'Checked again', steps: card.steps.map(st => ({ ...st, status: 'completed' })) };
          f.toAll('progressCard.changed', { sessionKey, revision: x.card.revision });
        }, 30);
        return { runId: `progress-card-refresh:${crypto.createHash('sha256').update(JSON.stringify([agentId, sessionKey, idempotencyKey])).digest('hex')}`, status: 'accepted', revision: card.revision };
      },
      // (clearing with expectedRevision - the Control UI's Dismiss: only the version the person saw; a newer one stays)
      'progressCard.put': ({ sessionKey, markdown, plan, expectedRevision }) => {
        const x = f.sessions.get(sessionKey); if (!x) throw Object.assign(new Error('unknown session'), { code: 'INVALID_REQUEST' });
        if (markdown || (plan && plan.length)) throw Object.assign(new Error('the stand-in only clears'), { code: 'INVALID_REQUEST' });
        if (x.card && expectedRevision !== undefined && x.card.revision !== expectedRevision) return { card: x.card };
        x.card = null;
        f.toAll('progressCard.changed', { sessionKey, revision: null });
        return { card: null };
      },
      'commands.list': () => ({ commands: [{ name: 'help', textAliases: ['/help'], description: 'Show available commands.', scope: 'both' },
        { name: 'status', textAliases: ['/status'], description: 'Show the session status.', scope: 'both' }, { name: 'native-only', scope: 'native' }] }),
      'approval.resolve': ({ id, kind, decision }) => {
        f.resolutions.push({ id, kind, decision });
        for (const [runId, r] of f.runs) if (r.waiting === id) { r.waiting = null; f.toAll('exec.approval.resolved', { id, decision, request: { runId, sessionKey: r.key } }); setTimeout(() => f.play(runId), 5); }
        return { ok: true };
      },
      'system.info': () => ({ machineName: 'fake-host', platform: 'linux', uptimeMs: 60000, nodeVersion: 'v24' }),
      'config.get': () => ({ config: JSON.parse(JSON.stringify(f.config)), hash: `h${f.configRev}`, valid: true, issues: [] }),
      'config.schema': () => ({ schema: { type: 'object', properties: { gateway: {}, models: {}, agents: {} } },
        uiHints: { gateway: { label: 'Gateway', group: 'Gateway', order: 30 }, models: { label: 'Models', group: 'Models', order: 70 }, agents: { label: 'Agents', group: 'Agents', order: 40 },
          'gateway.auth.token': { label: 'Gateway Token', sensitive: true }, 'models.providers.*.apiKey': { label: 'API Key', sensitive: true } } }),
      'config.schema.lookup': ({ path }) => ({ path, schema: { type: 'object' }, hint: { label: path }, children: [] }),
      'config.patch': ({ raw, baseHash }) => {
        if (baseHash !== `h${f.configRev}`) throw Object.assign(new Error('config changed since last load; re-run config.get and retry'), { code: 'INVALID_REQUEST' });
        const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return a; };
        merge(f.config, JSON.parse(raw)); f.configRev += 1; f.changes.push(JSON.parse(raw));
        return { ok: true, hash: `h${f.configRev}` };
      },
      'agents.create': ({ name }) => { const id = name.toLowerCase().replace(/\W+/g, '-'); f.agents.push({ id, name }); return { ok: true, agentId: id }; },
      // a plugin's consent, OpenClaw's way: inspect gives what it declares and a review token; switching on needs that token
      'plugins.inspect': ({ pluginId }) => ({ ok: true, plugin: { id: pluginId, name: 'Workboard', installed: true, enabled: false, state: 'disabled' },
        declared: { tools: ['workboard_list', 'workboard_create'], providers: [], channels: [], hooks: [], mcpServers: [], contracts: [], dangerousConfigFlags: [] },
        grants: { hooks: {} }, components: { commands: ['workboard'] }, overview: { readme: 'README '.repeat(5000) },
        credentials: [{ path: ['plugins', 'entries', pluginId, 'config', 'apiKey', 'value'], label: 'Workboard key', envVars: ['WORKBOARD_KEY'], status: 'missing', requiresCredential: true }],
        reviewToken: `review-${pluginId}-${f.configRev}`, decisions: [] }),
      'plugins.setEnabled': ({ pluginId, enabled, acknowledgeCapabilities }) => {
        if (enabled && (!acknowledgeCapabilities || acknowledgeCapabilities.reviewToken !== `review-${pluginId}-${f.configRev}`)) throw Object.assign(new Error('capability review required'), { code: 'INVALID_REQUEST' });
        f.changes.push({ plugin: pluginId, enabled });
        return { ok: true, plugin: { id: pluginId, name: 'Workboard', installed: true, enabled, state: enabled ? 'enabled' : 'disabled' }, restartRequired: false };
      },
      'artifacts.download': ({ sessionKey, artifactId }) => {
        const a = f.media.get(artifactId);
        if (!a) throw Object.assign(new Error('artifact not found'), { code: 'INVALID_REQUEST' });
        const t = `ticket-${crypto.randomBytes(8).toString('hex')}`;
        f.tickets.set(t, { id: artifactId.replace(/^artifact_managed_image_/, ''), artifactId });
        return { artifact: { id: artifactId, type: 'image', title: a.fileName, mimeType: a.mime, sizeBytes: a.bytes.length, sessionKey, download: { mode: 'url' } },
          url: `/api/chat/media/outgoing/${encodeURIComponent(sessionKey)}/${artifactId.replace(/^artifact_managed_image_/, '')}/full?mediaTicket=${t}` };
      },
      'sessions.subscribe': (params, conn, ws) => {
        f.sessionFeed.add(ws); ws.once('close', () => f.sessionFeed.delete(ws));
        const active = [...f.runs.entries()].filter(([, r]) => r.announced && !r.finished && !r.aborted).map(([id, r]) => ({ key: r.key, agentId: f.sessions.get(r.key)?.agentId || (/^agent:([^:]+):/.exec(r.key) || [])[1], hasActiveRun: true, activeRunIds: [id] }));
        return Object.keys(params || {}).length ? { subscribed: true, list: { sessions: active } } : { subscribed: true };
      },
      'tasks.list': ({ status, agentId, sessionKey, limit = 100, sortBy }) => {
        const want = status ? (Array.isArray(status) ? status : [status]) : null;
        let list = [...f.taskLedger.values()].filter(t => (!want || want.includes(t.status)) && (!sessionKey || t.sessionKey === sessionKey) && (!agentId || t.agentId === agentId));
        list = list.sort((a, b) => (sortBy === 'endedAt' ? (b.endedAt || 0) - (a.endedAt || 0) : (b.updatedAt || 0) - (a.updatedAt || 0))).slice(0, limit);
        return { tasks: list.map(({ prompt, result, transcript, ...t }) => t) };
      },
      'tasks.get': ({ taskId }) => {
        const t = f.taskLedger.get(taskId); if (!t) throw Object.assign(new Error('task not found'), { code: 'INVALID_REQUEST' });
        const { transcript, ...rest } = t; return { task: rest };
      },
      'tasks.history': ({ taskId, limit = 100 }) => {
        const t = f.taskLedger.get(taskId); if (!t) throw Object.assign(new Error('task not found'), { code: 'INVALID_REQUEST' });
        return { messages: (t.transcript || []).slice(0, limit) };
      },
      'tasks.cancel': ({ taskId, reason }) => {
        const t = f.taskLedger.get(taskId); if (!t) return { found: false, cancelled: false };
        f.cancels.push({ taskId, reason });
        if (!['queued', 'running'].includes(t.status)) return { found: true, cancelled: false, reason: 'Task is not running' };
        f.task(t.sessionKey, { id: taskId, status: 'cancelled', endedAt: Date.now(), updatedAt: Date.now(), error: 'Cancelled by operator' });
        const { prompt, result, transcript, ...summary } = f.taskLedger.get(taskId);
        return { found: true, cancelled: true, task: summary };
      },
      // (as the browser plugin of OpenClaw 2026.9.6: its routes, and its navigation policy refusing local addresses)
      'browser.request': ({ method, path, body = {} }) => {
        const B = f.browser, blocked = u => /^https?:\/\/(127\.|localhost|10\.|192\.168\.)/i.test(String(u || ''));
        const refuse = () => { throw Object.assign(new Error('browser navigation blocked by policy'), { code: 'INVALID_REQUEST', details: { reason: 'navigation_blocked' } }); };
        const tab = id => { const t = B.tabs.get(id); if (!t) throw Object.assign(new Error('tab not found'), { code: 'INVALID_REQUEST' }); return t; };
        if (method === 'GET' && path === '/tabs') return { running: B.running, tabs: [...B.tabs.values()].map((t, i) => ({ ...t, type: 'page', tabId: `t${i + 1}` })) };
        if (method === 'POST' && path === '/start') { B.running = true; return { ok: true, profile: 'openclaw' }; }
        if (!B.running) throw Object.assign(new Error('browser is not running'), { code: 'UNAVAILABLE' });
        if (method === 'POST' && path === '/tabs/open') { if (blocked(body.url)) refuse(); const id = crypto.randomBytes(16).toString('hex').toUpperCase(); B.tabs.set(id, { targetId: id, title: 'Example Domain', url: body.url }); return { targetId: id, title: 'Example Domain', url: body.url }; }
        if (method === 'POST' && path === '/tabs/focus') { tab(body.targetId); return { ok: true }; }
        if (method === 'DELETE' && path.startsWith('/tabs/')) { const id = decodeURIComponent(path.slice(6)); tab(id); B.tabs.delete(id); return { ok: true }; }
        if (method === 'POST' && path === '/navigate') { if (blocked(body.url)) refuse(); const t = tab(body.targetId); t.url = body.url; t.title = 'Navigated'; setTimeout(() => f.browserFrame(t.targetId), 10); return { ok: true, targetId: t.targetId, url: body.url }; }
        if (method === 'POST' && path === '/act') { tab(body.targetId); B.acts.push(body); return { ok: true, targetId: body.targetId }; }
        if (method === 'POST' && path === '/screencast') {
          const t = tab(body.targetId), token = crypto.randomBytes(24).toString('hex');
          B.tokens.set(token, { targetId: t.targetId, maxWidth: body.maxWidth, expires: Date.now() + 60000 });
          return { token, wsPath: `/browser/screencast?token=${token}`, expiresAtMs: Date.now() + 60000, targetId: t.targetId, url: t.url };
        }
        throw Object.assign(new Error(`no route ${method} ${path}`), { code: 'INVALID_REQUEST' });
      },
      'update.run': () => { throw new Error('never callable from the sub-menu'); },
      ...methods,
    },
  };
  const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  // a screencast frame as the gateway sends it: the header's length (4 bytes), the header (JSON), then the JPEG
  const sendFrame = (ws, head) => { if (ws.readyState !== 1) return; const h = Buffer.from(JSON.stringify(head)), n = Buffer.alloc(4); n.writeUInt32BE(h.length); ws.send(Buffer.concat([n, h, FAKE_JPEG])); };
  const fail = (ws, id, error, close = true) => {
    send(ws, { type: 'res', id, ok: false, error });
    if (close) setTimeout(() => ws.close(1008, String(error.message).slice(0, 120)), 5);
  };
  wss.on('connection', (ws, req) => {
    // (a screencast socket: a token minted by /screencast, used once; "ready", then a frame for each change of the page)
    if (String(req.url || '').startsWith('/browser/screencast')) {
      const token = new URL(req.url, 'http://x').searchParams.get('token'), t = f.browser.tokens.get(token);
      f.browser.tokens.delete(token);
      if (!t || t.expires < Date.now()) { ws.close(4003, 'expired'); return; }
      const c = { ws, targetId: t.targetId };
      f.browser.casts.add(c); ws.on('close', () => f.browser.casts.delete(c));
      ws.send(JSON.stringify({ type: 'ready', targetId: t.targetId, url: f.browser.tabs.get(t.targetId)?.url || '', title: 'Example Domain' }));
      f.browserFrame(t.targetId);
      return;
    }
    f.sockets.add(ws);
    ws.on('close', () => { f.sockets.delete(ws); f.subs.delete(ws); });
    const nonce = crypto.randomUUID(), ts = Date.now();
    let conn = null;
    send(ws, { type: 'event', event: 'connect.challenge', payload: { nonce, ts, capabilities: ['model-catalog-snapshot'] } });
    ws.on('message', async raw => {
      let m; try { m = JSON.parse(String(raw)); } catch { return; }
      if (!m || m.type !== 'req') return;
      if (!conn) {
        if (m.method !== 'connect') return fail(ws, m.id, { code: 'INVALID_REQUEST', message: 'connect first' });
        const p = m.params || {};
        f.connects.push(p);
        const d = p.device;
        // the device's proof: OpenClaw's v3 payload, signed with the key whose fingerprint is the device id
        if (d) {
          const payload = buildDeviceAuthPayloadV3({ deviceId: d.id, clientId: p.client.id, clientMode: p.client.mode, role: p.role, scopes: p.scopes || [], signedAtMs: d.signedAt,
            token: p.auth && (p.auth.token || p.auth.deviceToken || p.auth.bootstrapToken) || null, nonce: d.nonce, platform: p.client.platform, deviceFamily: p.client.deviceFamily });
          const idOk = crypto.createHash('sha256').update(Buffer.from(d.publicKey, 'base64url')).digest('hex') === d.id;
          let sigOk = false;
          try { sigOk = crypto.verify(null, Buffer.from(payload, 'utf8'), rawKey(d.publicKey), Buffer.from(d.signature, 'base64url')); } catch { sigOk = false; }
          if (!idOk || !sigOk || d.nonce !== nonce) { f.badSignatures++; return fail(ws, m.id, { code: 'INVALID_REQUEST', message: 'device signature invalid', details: { code: 'DEVICE_AUTH_SIGNATURE_INVALID' } }); }
        }
        const auth = p.auth || {};
        const known = d && f.paired.get(d.id);
        const byDeviceToken = auth.deviceToken && known && known.deviceToken === auth.deviceToken;
        if (auth.deviceToken && !byDeviceToken && auth.token !== f.token) {
          return fail(ws, m.id, { code: 'INVALID_REQUEST', message: 'unauthorized: device token mismatch', details: { code: 'AUTH_DEVICE_TOKEN_MISMATCH', recommendedNextStep: 'update_auth_credentials' } });
        }
        if (!byDeviceToken && auth.token !== f.token) {
          return fail(ws, m.id, { code: 'INVALID_REQUEST', message: 'unauthorized: gateway token mismatch (provide gateway auth token)',
            details: { code: 'AUTH_TOKEN_MISMATCH', authReason: 'token_mismatch', canRetryWithDeviceToken: true, recommendedNextStep: 'retry_with_device_token' } });
        }
        if (d && !known) {
          if (f.pairing === 'auto') f.paired.set(d.id, { scopes: p.scopes || [], deviceToken: `dt-${crypto.randomBytes(12).toString('hex')}`, publicKey: d.publicKey });
          else {
            let requestId = [...f.pending].find(([, x]) => x.deviceId === d.id)?.[0];
            if (!requestId) { requestId = crypto.randomUUID(); f.pending.set(requestId, { deviceId: d.id, scopes: p.scopes || [], publicKey: d.publicKey }); }
            return fail(ws, m.id, { code: 'NOT_PAIRED', message: `device pairing required (requestId: ${requestId})`,
              details: { code: 'PAIRING_REQUIRED', reason: 'not-paired', requestId, remediationHint: 'Approve this device from the pending pairing requests.', deviceId: d.id, requestedRole: 'operator', requestedScopes: p.scopes || [] } });
          }
        }
        const dev = d ? f.paired.get(d.id) : null;
        conn = { deviceId: d ? d.id : null, scopes: dev ? dev.scopes : [], client: p.client };
        send(ws, { type: 'res', id: m.id, ok: true, payload: { ...HELLO, server: { ...HELLO.server, version, connId: crypto.randomUUID() },
          auth: { method: byDeviceToken ? 'device-token' : 'token', role: 'operator', scopes: conn.scopes, ...(dev ? { deviceToken: dev.deviceToken, issuedAtMs: Date.now() } : {}) } } });
        return;
      }
      f.requests.push({ method: m.method, params: m.params, deviceId: conn.deviceId });
      const fn = f.methods[m.method];
      if (!fn) return fail(ws, m.id, { code: 'INVALID_REQUEST', message: `unknown method: ${m.method}` }, false);
      try { send(ws, { type: 'res', id: m.id, ok: true, payload: await fn(m.params || {}, conn, ws) }); }
      catch (e) { fail(ws, m.id, { code: e.code || 'UNAVAILABLE', message: e.message || 'failed', ...(e.details ? { details: e.details } : {}) }, false); }
    });
  });
  return f;
}
