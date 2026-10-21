// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A stand-in Hermes backend for the tests (Agent Providers, docs/features/agent-providers.md §9): what `hermes serve`
// answers, with the frames recorded from Hermes 0.21.5 (tests/fixtures/hermes/run-*.json).
// - Its public /api/status; signing in as Hermes does: the session token (X-Hermes-Session-Token, ?token= on the socket)
//   when bound to its own machine, or - mode 'password' - its native-app sign-in (/auth/native/authorize with PKCE, the
//   password form, /auth/native/token, /auth/native/refresh) and the access token as a Bearer credential / ?token=.
// - Its gateway JSON-RPC on /api/ws: gateway.ready, client.capabilities, profiles.list, session.create / resume /
//   interrupt / close, prompt.submit - it replays a recorded turn with this session's id ([[tool: a command run;
//   rm -rf: the one that asks for approval, continued once answered; [[tool:clarify: the questions; [[think]]: the
//   reasoning one; [[slow]] waits between frames so Stop can cut it; anything else: a plain answer), and takes a message
//   sent while a turn runs as Hermes' busy_input_mode says (steer by default here; queued: true waits) - model.options,
//   commands.catalog, config.set, image.attach_bytes, file.attach, approval.respond, request.answer.
// - Its REST: sessions (list, one, messages, patch, delete), config and its schema, skills and toolsets, cron jobs, files
//   (its managed files: list, read, upload, mkdir, delete - and a download).
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { WebSocketServer } from 'ws';

const RUN = n => JSON.parse(fs.readFileSync(new URL(`../fixtures/hermes/run-${n}.json`, import.meta.url), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const FILE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export async function startFakeHermes({ token = 'hermes-session-token', mode = 'token', username = 'casey', password = 'pw-correct', version = '0.21.5', busy = 'steer',
  profiles = [{ name: 'default', is_default: true, model: 'stub-1', provider: 'custom' }, { name: 'research', display_name: 'Researcher', model: 'stub-2', provider: 'custom' }] } = {}) {
  const f = {
    url: null, token, sockets: new Set(), sessions: new Map(), live: new Map(), calls: [], answers: [], tokens: new Map(), codes: new Map(), pkce: new Map(),
    files: new Map([['/tmp/chart.png', { mime: 'image/png', bytes: FILE_PNG }]]), dirs: new Set(), skills: [{ name: 'web-research', description: 'Search well', category: 'research', enabled: true, provenance: 'bundled' }],
    toolsets: [{ name: 'web', label: 'Web Search', description: 'web_search', enabled: true, available: true, configured: true, tools: ['web_search'] }],
    config: { model: 'stub-1', display: { busy_input_mode: busy }, gateway: { api_server: { key: 'super-secret-key' } } }, jobs: [{ job_id: 'j1', name: 'Morning brief', schedule: '0 8 * * *', enabled: true, state: 'scheduled', prompt_preview: 'Brief me' }],
    seq: 0, rqSeq: 0, accessTtl: 3600, stopped: false,
    // its Bot Desktop (one for the test, whatever the profile): as Hermes' tools/bot_desktop + tui_gateway/methods_display -
    // its lease (who may type), single-use 30 s tickets for /api/display/ws, the streams open on it and what they sent
    display: { installed: true, running: false, lease: { holder: 'agent', viewer_id: null, epoch: 0, reason: '' }, tickets: new Map(), streams: new Set(), input: [], closes: [], calls: [] },
  };
  const authOk = req => {
    if (mode === 'token') return req.headers['x-hermes-session-token'] === token || req.headers.authorization === `Bearer ${token}`;
    const b = (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1];
    const t = b && f.tokens.get(b);
    return !!(t && t.kind === 'access' && t.exp > Date.now() / 1000);
  };
  const json = (res, code, body, headers = {}) => { const s = Buffer.from(JSON.stringify(body)); res.writeHead(code, { 'content-type': 'application/json', 'content-length': s.length, ...headers }); res.end(s); };
  const bodyOf = req => new Promise(r => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => { try { r(raw ? JSON.parse(raw) : {}); } catch { r({}); } }); });
  const mint = (kind, ttl) => { const t = b64url(crypto.randomBytes(18)); f.tokens.set(t, { kind, exp: Date.now() / 1000 + ttl }); return t; };
  const pair = () => { const access = mint('access', f.accessTtl), refresh = mint('refresh', 86400); return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_at: Date.now() / 1000 + f.accessTtl, provider: 'basic', user_id: username }; };
  const row = s => ({ id: s.id, title: s.title, source: s.source, model: s.model || 'stub-1', started_at: s.started, last_activity_at: s.last, ended_at: null, message_count: s.messages.length, parent_session_id: null, profile: s.profile });

  const web = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    f.calls.push(`${req.method} ${p}`);
    if (p === '/api/status') return json(res, 200, { version, release_date: '2026.9.24', auth_required: mode === 'password', auth_providers: mode === 'password' ? ['basic'] : [], profiles: profiles.map(x => x.name), gateway_running: false, overall: 'ok', components: {}, memory: {}, disk: {} });
    if (p === '/api/auth/providers') return json(res, 200, mode === 'password' ? [{ name: 'basic', supports_password: true }] : []);
    if (mode === 'password' && p === '/auth/native/authorize') {
      const state = b64url(crypto.randomBytes(8));
      f.pkce.set(state, { challenge: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri'), state: u.searchParams.get('state') });
      res.writeHead(302, { location: '/login', 'set-cookie': `hermes_pkce=${state}; Path=/; HttpOnly` }); res.end(); return;
    }
    if (mode === 'password' && p === '/auth/password-login' && req.method === 'POST') {
      const b = await bodyOf(req), c = /hermes_pkce=([^;]+)/.exec(req.headers.cookie || ''), pend = c && f.pkce.get(c[1]);
      if (b.username !== username || b.password !== password) return json(res, 401, { detail: 'Invalid credentials' });
      if (!pend) return json(res, 400, { detail: 'no flow' });
      const code = b64url(crypto.randomBytes(12));
      f.codes.set(code, pend);
      return json(res, 200, { ok: true, next: `${pend.redirect}?code=${code}&state=${pend.state}` });
    }
    if (mode === 'password' && p === '/auth/native/token' && req.method === 'POST') {
      const b = await bodyOf(req), pend = f.codes.get(b.code);
      f.codes.delete(b.code);
      if (!pend || b64url(crypto.createHash('sha256').update(String(b.code_verifier || '')).digest()) !== pend.challenge) return json(res, 400, { detail: 'Invalid or expired authorization code.' });
      return json(res, 200, pair());
    }
    if (mode === 'password' && p === '/auth/native/refresh' && req.method === 'POST') {
      const b = await bodyOf(req), t = f.tokens.get(b.refresh_token);
      if (!t || t.kind !== 'refresh') return json(res, 401, { error: 'session_expired' });
      f.tokens.delete(b.refresh_token);
      f.refreshed = (f.refreshed || 0) + 1;
      return json(res, 200, pair());
    }
    if (!p.startsWith('/api/')) return json(res, 404, { detail: 'Not found' });
    if (!authOk(req)) return json(res, 401, { detail: 'Unauthorized' });
    let m;
    if (p === '/api/sessions' && req.method === 'GET') {
      const prof = u.searchParams.get('profile') || 'default';
      if (!profiles.some(x => x.name === prof)) return json(res, 404, { detail: `Profile '${prof}' does not exist.` });
      return json(res, 200, { sessions: [...f.sessions.values()].filter(s => s.profile === prof && s.messages.length).sort((a, b) => b.last - a.last).map(row), total: f.sessions.size });
    }
    if ((m = /^\/api\/sessions\/([^/]+)\/messages$/.exec(p))) { const s = f.sessions.get(decodeURIComponent(m[1])); return s ? json(res, 200, { session_id: s.id, messages: s.messages }) : json(res, 404, { detail: 'Session not found' }); }
    if ((m = /^\/api\/sessions\/([^/]+)$/.exec(p))) {
      const s = f.sessions.get(decodeURIComponent(m[1]));
      if (!s) return json(res, 404, { detail: 'Session not found' });
      if (req.method === 'GET') return json(res, 200, row(s));
      if (req.method === 'PATCH') { const b = await bodyOf(req); if (typeof b.title === 'string') s.title = b.title; return json(res, 200, row(s)); }
      if (req.method === 'DELETE') { if ([...f.live.values()].some(l => l.key === s.id)) return json(res, 409, { detail: 'Session is live' }); f.sessions.delete(s.id); return json(res, 200, { deleted: s.id }); }
    }
    if (p === '/api/config' && req.method === 'GET') return json(res, 200, f.config);
    if (p === '/api/config' && req.method === 'PUT') { const b = await bodyOf(req); const merge = (a, x) => { for (const [k, v] of Object.entries(x)) a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v; return a; }; merge(f.config, b.config || {}); return json(res, 200, { ok: true }); }
    if (p === '/api/config/schema') return json(res, 200, { fields: { model: { type: 'string', description: 'Default model', category: 'general' }, 'display.busy_input_mode': { type: 'select', options: ['interrupt', 'queue', 'steer'], description: 'Busy input', category: 'display' }, 'gateway.api_server.key': { type: 'string', description: 'API key', category: 'general' } }, category_order: ['general', 'display'] });
    if (p === '/api/skills' && req.method === 'GET') return json(res, 200, f.skills);
    if (p === '/api/skills/toggle' && req.method === 'PUT') { const b = await bodyOf(req); const s = f.skills.find(x => x.name === b.name); if (s) s.enabled = !!b.enabled; return json(res, 200, { ok: true, name: b.name, enabled: !!b.enabled }); }
    if (p === '/api/tools/toolsets') return json(res, 200, f.toolsets);
    if (p === '/api/cron/jobs') return json(res, 200, f.jobs);
    if ((m = /^\/api\/cron\/jobs\/([^/]+)\/(pause|resume|trigger)$/.exec(p))) { const j = f.jobs.find(x => x.job_id === m[1]); if (!j) return json(res, 404, { detail: 'no job' }); if (m[2] !== 'trigger') j.enabled = m[2] === 'resume'; return json(res, 200, { ok: true }); }
    // its managed files (hermes_cli/web_routers/files.py), kept in f.files (path → { mime, bytes }) and f.dirs, under
    // /tmp (its locked root here): a folder's entries, a file as a data URL, an upload, a new folder, a deletion; a
    // sensitive file (.env) is refused as Hermes refuses it
    const FROOT = '/tmp';
    const fpath = v => { const t = String(v || '').trim(); if (!t || t === '/' || t === '.') return FROOT; if (t.split('/').includes('..')) return null; return t.startsWith('/') ? t.replace(/\/+$/, '') : `${FROOT}/${t}`; };
    const under = x => x === FROOT || x.startsWith(`${FROOT}/`);
    const fentry = (x, dir) => ({ name: x.split('/').pop(), path: x, is_directory: dir, size: dir ? null : f.files.get(x).bytes.length, mtime: 1760000000, mime_type: dir ? null : f.files.get(x).mime });
    if (p === '/api/files' && req.method === 'GET') {
      const x = fpath(u.searchParams.get('path'));
      if (!x) return json(res, 400, { detail: "Path cannot contain '..'" });
      if (!under(x)) return json(res, 403, { detail: 'Path outside managed files root' });
      if (!(f.dirs.has(x) || x === FROOT)) return json(res, f.files.has(x) ? 400 : 404, { detail: f.files.has(x) ? 'Path is not a directory' : 'Path not found' });
      const kids = [...f.dirs].filter(d => d !== x && d.slice(0, d.lastIndexOf('/')) === x).map(d => fentry(d, true))
        .concat([...f.files.keys()].filter(k => k.slice(0, k.lastIndexOf('/')) === x && !/\/\.env$/.test(k)).map(k => fentry(k, false)));
      return json(res, 200, { path: x, parent: x === FROOT ? null : x.slice(0, x.lastIndexOf('/')), entries: kids, root: FROOT, locked_root: FROOT, can_change_path: false });
    }
    if (p === '/api/files/read' && req.method === 'GET') {
      const x = fpath(u.searchParams.get('path')), file = x && f.files.get(x);
      if (x && /\/\.env$/.test(x)) return json(res, 403, { detail: 'Access to sensitive files is not allowed' });
      if (!file) return json(res, 404, { detail: 'File not found' });
      return json(res, 200, { name: x.split('/').pop(), path: x, size: file.bytes.length, mime_type: file.mime, data_url: `data:${file.mime};base64,${file.bytes.toString('base64')}`, root: FROOT, locked_root: FROOT, can_change_path: false });
    }
    if (p === '/api/files/upload' && req.method === 'POST') {
      const b = await bodyOf(req), x = fpath(b.path), mm = /^data:([^;,]*);base64,(.*)$/s.exec(String(b.data_url || ''));
      if (!x || !under(x)) return json(res, 403, { detail: 'Path outside managed files root' });
      if (!mm) return json(res, 400, { detail: 'Invalid data URL' });
      if (f.files.has(x) && b.overwrite === false) return json(res, 409, { detail: 'File already exists' });
      f.files.set(x, { mime: mm[1] || 'application/octet-stream', bytes: Buffer.from(mm[2], 'base64') });
      return json(res, 200, { ok: true, path: x, name: x.split('/').pop(), root: FROOT, locked_root: FROOT, can_change_path: false });
    }
    if (p === '/api/files/mkdir' && req.method === 'POST') {
      const b = await bodyOf(req), x = fpath(b.path);
      if (!x || !under(x)) return json(res, 403, { detail: 'Path outside managed files root' });
      if (f.files.has(x)) return json(res, 409, { detail: 'A file already exists at that path' });
      f.dirs.add(x);
      return json(res, 200, { ok: true, path: x, root: FROOT, locked_root: FROOT, can_change_path: false });
    }
    if (p === '/api/files' && req.method === 'DELETE') {
      const b = await bodyOf(req), x = fpath(b.path);
      if (!x || !under(x)) return json(res, 403, { detail: 'Path outside managed files root' });
      if (x === FROOT) return json(res, 400, { detail: 'Cannot delete the managed files root' });
      if (f.files.delete(x)) return json(res, 200, { ok: true, path: x });
      if (!f.dirs.has(x)) return json(res, 404, { detail: 'Path not found' });
      const inside = k => k.startsWith(`${x}/`);
      if (!b.recursive && ([...f.files.keys()].some(inside) || [...f.dirs].some(inside))) return json(res, 409, { detail: 'Could not delete path: directory not empty' });
      for (const k of [...f.files.keys()]) if (inside(k)) f.files.delete(k);
      for (const k of [...f.dirs]) if (inside(k) || k === x) f.dirs.delete(k);
      return json(res, 200, { ok: true, path: x });
    }
    if (p === '/api/files/download') { const file = f.files.get(u.searchParams.get('path') || ''); if (!file) return json(res, 404, { detail: 'File not found' }); res.writeHead(200, { 'content-type': file.mime, 'content-length': file.bytes.length }); res.end(file.bytes); return; }
    if (p === '/api/analytics/usage') return json(res, 200, { totals: { sessions: f.sessions.size, input_tokens: 10, output_tokens: 5 } });
    json(res, 404, { detail: 'Not found' });
  });
  const wss = new WebSocketServer({ noServer: true });
  web.on('upgrade', (req, socket, head) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/display/ws') { wss.handleUpgrade(req, socket, head, ws => displayStream(ws, u.searchParams.get('display_ticket') || '')); return; }
    const t = u.searchParams.get('token') || '';
    const ok = u.pathname === '/api/ws' && (mode === 'token' ? t === token : (f.tokens.get(t) || {}).kind === 'access' && f.tokens.get(t).exp > Date.now() / 1000);
    if (!ok) { socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    f.sockets.add(ws);
    const conn = { ws, caps: false, open: new Map() };
    ws.on('close', () => { f.sockets.delete(ws); for (const [sid, l] of f.live) if (l.conn === conn && !l.running) f.live.delete(sid); });
    const send = o => { if (ws.readyState === 1) ws.send(`${JSON.stringify(o)}\n`); };
    conn.send = send;
    send({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: { skin: { name: 'default' }, change_events: true, replay_epoch: 'e1', heartbeat: true } } });
    ws.on('message', async d => {
      for (const line of String(d).split('\n')) {
        if (!line.trim()) continue;
        let fr; try { fr = JSON.parse(line); } catch { continue; }
        if (!fr.method && fr.id && conn.open.has(String(fr.id))) { const done = conn.open.get(String(fr.id)); conn.open.delete(String(fr.id)); f.answers.push({ id: fr.id, result: fr.result, error: fr.error }); done(fr.result || {}); continue; }
        if (!fr.method) continue;
        const ok = result => send({ jsonrpc: '2.0', id: fr.id, result });
        const no = (code, message) => send({ jsonrpc: '2.0', id: fr.id, error: { code, message } });
        try { ok(await call(conn, fr.method, fr.params || {})); } catch (e) { no(e.code || 4000, e.message); }
      }
    });
  });
  // (as Hermes: every session event numbered and kept in a ring, sent to the client attached - a client whose socket
  // dropped fetches what it missed with session.events.since)
  const ev = (l, type, payload = {}) => {
    const params = { type, session_id: l.sid, payload, seq: ++f.seq };
    (l.ring = l.ring || []).push(params); if (l.ring.length > 2000) l.ring.shift();
    l.conn.send({ jsonrpc: '2.0', method: 'event', params });
  };
  const ask = (l, method, params) => new Promise(resolve => {
    const id = `srq-${++f.rqSeq}`;
    l.conn.open.set(id, resolve); l.pendingAsk = { id, method, params, resolve };
    l.conn.send({ jsonrpc: '2.0', id, method, params: { session_id: l.sid, ...params } });
  });
  const err = (code, message) => Object.assign(new Error(message), { code });
  // ---- its Bot Desktop
  const D = f.display;
  const hash12 = id => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 12);
  const snapshot = profile => ({ profile: profile || 'default', supported: true, installed: D.installed, missing: D.installed ? [] : ['Xvnc'], running: D.running, pid: D.running ? 4242 : null,
    display: D.running ? ':20' : null, socket: D.running ? '/h/bot-desktop/rfb.sock' : null, geometry: '1440x900', install_command: D.installed ? null : 'sudo apt-get install -y tigervnc-standalone-server',
    browser: '/usr/bin/chromium', blocker: null, placement: 'gateway', image_switch: null,
    lease: { holder: D.lease.holder, viewer_id: null, viewer_hash: D.lease.viewer_id ? hash12(D.lease.viewer_id) : null, epoch: D.lease.epoch, reason: D.lease.reason }, profile_key: '/h' });
  const setLease = (holder, viewer = null, reason = '') => {
    const was = D.lease.holder === 'human' ? D.lease.viewer_id : null;
    D.lease = { holder, viewer_id: viewer, epoch: D.lease.epoch + 1, reason };
    // (the viewer that held control and lost it to another person: its stream closes, 4000 control-taken)
    if (was && holder === 'human' && viewer !== was) for (const x of D.streams) if (x.viewer === was) x.ws.close(4000, 'control-taken');
  };
  function displayStream(ws, ticket) {
    const t = D.tickets.get(ticket);
    D.tickets.delete(ticket);
    if (!t || t.exp < Date.now()) { ws.close(4401, 'display ticket missing, expired or used'); return; }
    if (!D.running) { ws.close(4001, 'Bot Desktop is not running'); return; }
    const x = { ws, viewer: t.viewer };
    D.streams.add(x);
    ws.send(Buffer.from('RFB 003.008\n'));
    ws.on('message', (d, binary) => {
      if (!binary) { ws.close(1003, 'RFB is binary'); return; }
      // (Hermes' RfbClientFilter: what a viewer types reaches the screen only while it holds the lease)
      D.input.push({ viewer: x.viewer, bytes: Buffer.from(d).toString(), passed: D.lease.holder === 'human' && D.lease.viewer_id === x.viewer });
      if (String(d) === 'ping') ws.send(Buffer.from('pong'));
      if (String(d) === 'big') ws.send(Buffer.alloc(2 * 1048576, 7));
    });
    ws.on('close', code => {
      D.streams.delete(x); D.closes.push({ viewer: x.viewer, code });
      // (the viewer closed its window: control goes back to the agent; a dropped link keeps it)
      if ((code === 1000 || code === 1001) && D.lease.holder === 'human' && D.lease.viewer_id === x.viewer) setLease('agent');
    });
  }
  function display(conn, method, p) {
    D.calls.push({ method, profile: p.profile });
    conn.viewers ||= new Set();
    if (method === 'display.status') return snapshot(p.profile);
    if (method === 'display.start') { if (!D.installed) throw err(5300, 'Bot Desktop needs Xvnc on the gateway host'); D.running = true; return snapshot(p.profile); }
    if (method === 'display.stop') {
      if (D.lease.holder === 'human' && !p.force) throw err(5300, 'a human holds this screen; pass force: true to stop it anyway');
      setLease('agent'); D.running = false;
      for (const x of D.streams) x.ws.close(4001, 'Bot Desktop is not running');
      return { ...snapshot(p.profile), stopped: true };
    }
    if (method === 'display.thumbnail') {
      if (D.lease.holder === 'human') return { data_url: null, suppressed: 'human_has_control' };
      return { data_url: D.running ? `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}` : null };
    }
    if (method === 'display.observe') {
      if (!D.running) throw err(5300, 'this profile\'s Bot Desktop is not running; call display.start first');
      const viewer = conn.viewers.has(String(p.viewer_id || '')) ? String(p.viewer_id) : b64url(crypto.randomBytes(12));
      conn.viewers.add(viewer);
      const ticket = b64url(crypto.randomBytes(24));
      D.tickets.set(ticket, { viewer, exp: Date.now() + 30000 });
      return { ticket, path: '/api/display/ws', viewer_id: viewer, ...snapshot(p.profile) };
    }
    if (method === 'display.lease.acquire') {
      if (!conn.viewers.has(String(p.viewer_id || ''))) throw err(5300, 'viewer_id was not minted for this connection; call display.observe first');
      setLease('human', String(p.viewer_id), String(p.reason || ''));
      return { lease: snapshot().lease };
    }
    if (method === 'display.lease.release') {
      if (p.viewer_id && !conn.viewers.has(String(p.viewer_id)) && !p.force) throw err(5300, 'viewer_id was not minted for this connection; call display.observe first');
      if (D.lease.holder === 'human' && !p.force && D.lease.viewer_id !== p.viewer_id) throw err(5300, 'viewer_id required to release another viewer\'s lease (or pass force: true)');
      setLease('agent');
      return { lease: snapshot().lease };
    }
    throw err(-32601, `unknown method ${method}`);
  }
  async function call(conn, method, p) {
    if (method.startsWith('display.')) { if (f.noDisplay) throw err(-32601, `unknown method ${method}`); return display(conn, method, p); }
    if (method === 'client.capabilities') { conn.caps = !!p.server_requests; return { server_requests: ['approval', 'clarify', 'secret', 'sudo'], declines_not_shown: true }; }
    if (method === 'gateway.ping') return { pong: true };
    if (method === 'gateway.capabilities') return { per_session_exclusive_submit: true };
    if (method === 'profiles.list') return { profiles: profiles.map(x => ({ path: `/h/${x.name}`, skill_count: 1, ...x })) };
    if (method === 'session.create') {
      const id = `20261017_${String(f.sessions.size + 1).padStart(6, '0')}`, sid = b64url(crypto.randomBytes(4));
      f.sessions.set(id, { id, profile: p.profile || 'default', source: p.source || 'tui', title: '', messages: [], started: Date.now() / 1000, last: Date.now() / 1000, model: p.model || null, effort: p.reasoning_effort || null });
      f.live.set(sid, { sid, key: id, conn, running: false, queue: [] });
      return { session_id: sid, stored_session_id: id, message_count: 0, messages: [], info: { model: 'stub-1', lazy: true } };
    }
    if (method === 'session.resume') {
      const s = f.sessions.get(p.session_id);
      if (!s) throw err(4001, 'session not found');
      let l = [...f.live.values()].find(x => x.key === s.id);
      if (l) l.conn = conn; else { l = { sid: b64url(crypto.randomBytes(4)), key: s.id, conn, running: false, queue: [] }; f.live.set(l.sid, l); }
      return { session_id: l.sid, resumed: s.id, message_count: s.messages.length, messages: [], info: {}, running: l.running, open_requests: l.pendingAsk ? [{ id: l.pendingAsk.id, method: l.pendingAsk.method, params: { session_id: l.sid, ...l.pendingAsk.params } }] : [] };
    }
    const l = p.session_id ? f.live.get(p.session_id) : null;
    // (as Hermes: a session's goal, loop and heartbeat, every change sent as an event)
    const control = x => (x.control = x.control || { goal: null, loop: null, heartbeat: null, revision: '', updated_at: 0 });
    const changed = x => { const c = control(x); c.revision = crypto.randomBytes(8).toString('hex'); c.updated_at = Date.now() / 1000; ev(x, 'session.control.update', { control: { ...c, secret: 'x' } }); return c; };
    if (method === 'prompt.submit') {
      if (!l) throw err(4001, 'session not found');
      const s = f.sessions.get(l.key);
      // (as Hermes: a rewind drops that message of the person's and everything after it; dropping everything needs saying)
      if (p.confirm_truncate && Number.isInteger(p.truncate_before_row_id)) {
        const k = s.messages.findIndex(m => m.id === p.truncate_before_row_id);
        if (k < 0) throw err(4027, 'no such row');
        if (k === 0 && !p.confirm_empty_truncate) throw err(4028, 'truncation would erase the entire session transcript; resubmit with confirm_empty_truncate=true if this is intended');
        s.messages = s.messages.slice(0, k);
        f.rewinds = (f.rewinds || 0) + 1;
      }
      s.messages.push({ id: s.messages.length + 1, role: 'user', content: String(p.text || ''), timestamp: Date.now() / 1000, active: 1 });
      if (l.running) {
        // (as Hermes: text-only messages queued behind one already waiting share its slot - one turn answers them all)
        if (p.queued || f.config.display.busy_input_mode === 'queue') { if (l.queue.length) l.queue[l.queue.length - 1] += `\n\n${String(p.text || '')}`; else l.queue.push(String(p.text || '')); return { status: 'queued' }; }
        l.steered = (l.steered || []).concat(String(p.text || ''));
        return { status: 'steered' };
      }
      play(l, String(p.text || ''));
      return { status: 'streaming', user_row_id: s.messages.length };
    }
    if (method === 'session.archive') {
      const x = f.sessions.get(p.session_key);
      if (!x) throw err(4001, 'session not found');
      x.archived = p.archived !== false;
      return { archived: x.archived, session_key: x.id };
    }
    if (method === 'session.branch_whole') return call(conn, 'session.branch', { ...p, count: null });
    if (method === 'session.branch') {
      if (!l) throw err(4001, 'session not found');
      const src = f.sessions.get(l.key), id = `20261017_${String(f.sessions.size + 1).padStart(6, '0')}`, sid = b64url(crypto.randomBytes(4));
      const msgs = src.messages.slice(0, Number.isInteger(p.count) && p.count > 0 ? p.count : undefined).map((m, i) => ({ ...m, id: i + 1 }));
      f.sessions.set(id, { ...src, id, title: `${src.title || 'Chat'} (branch)`, messages: msgs });
      f.live.set(sid, { sid, key: id, conn, running: false, queue: [] });
      return { session_id: sid, stored_session_id: id, title: `${src.title || 'Chat'} (branch)`, parent: src.id, message_count: msgs.length };
    }
    if (method === 'session.events.since') {
      const x = f.live.get(p.session_id), last = Number(p.last_seen) || 0, events = x ? (x.ring || []).filter(e => e.seq > last) : [];
      f.replays = (f.replays || 0) + 1;
      return { events, latest_seq: f.seq, truncated: false, count: events.length, epoch: 'e1', open_requests: x && x.pendingAsk ? [{ id: x.pendingAsk.id, method: x.pendingAsk.method, params: { session_id: x.sid, ...x.pendingAsk.params } }] : [] };
    }
    if (method === 'session.redirect') {
      if (!l) throw err(4001, 'session not found');
      if (!l.running) return { status: 'rejected', text: p.text };
      // (as Hermes: the turn goes on with the correction - here, noted in the answer like a steer)
      f.redirects = (f.redirects || []).concat([String(p.text || '')]);
      l.steered = (l.steered || []).concat(String(p.text || ''));
      return { status: 'redirected', text: p.text };
    }
    if (method === 'session.interrupt') { if (!l) throw err(4001, 'session not found'); if (l.running) { l.stop = true; return { status: 'interrupted', interrupted: true }; } return { status: 'not_interrupted' }; }
    if (method === 'session.close') { if (l) f.live.delete(p.session_id); return { closed: true }; }
    if (method === 'approval.respond' || method === 'request.answer') {
      f.answers.push({ via: method, ...p });
      for (const x of f.live.values()) if (x.pendingAsk && (method === 'request.answer' ? x.pendingAsk.id === p.id : x.sid === p.session_id)) { const a = x.pendingAsk; x.pendingAsk = null; x.conn.open.delete(a.id); a.resolve(method === 'request.answer' ? p.result : { choice: p.choice }); return method === 'request.answer' ? { status: 'ok' } : { resolved: 1 }; }
      return method === 'request.answer' ? { status: 'expired' } : { resolved: 0 };
    }
    if (method === 'model.options') return { model: 'stub-1', provider: 'custom', providers: [{ slug: 'custom', name: 'Custom', is_current: true, models: ['stub-1', 'stub-2'], capabilities: { 'stub-1': { reasoning: false }, 'stub-2': { reasoning: true, can_disable_reasoning: true } } }] };
    if (method === 'commands.catalog') {
      f.catalogs = (f.catalogs || 0) + 1;
      return { categories: [{ name: 'Session', pairs: [['/new', 'Start a new session'], ['/model', 'Switch model (usage: /model <provider:model>)'], ['/status', 'Show current session status'], ['/title', 'Rename the current session (usage: /title [name])'], ['/config', 'Show config'], ['/usage', 'Show token usage']] }],
        pairs: [['/new', 'Start a new session'], ['/airtable', 'Airtable skill'], ['/web-research', 'Search well']],
        commands: { '/new': { desktop: null }, '/model': { desktop: 'hidden' }, '/status': { desktop: null }, '/title': { desktop: null, argument_mode: 'text' }, '/config': { desktop: 'terminal' }, '/usage': { desktop: null } },
        canon: { '/reset': '/new' }, skills: { '/airtable': { origin: 'bundled', usage: 0 }, '/web-research': { origin: 'local', usage: 3 } }, skill_count: 2, token: 'never-leaves' };
    }
    // (Hermes Desktop's composer calls: its slash commands and their own RPCs, its completions, its side questions)
    if (method === 'complete.slash') {
      f.slashQueries = (f.slashQueries || []).concat([p.text]);
      const t = String(p.text || '');
      if (/^\/reasoning /.test(t)) return { items: [{ text: 'high', display: 'high', meta: '', kind: 'command' }, { text: 'low', display: 'low', meta: '', kind: 'command' }], replace_from: 11 };
      const all = [['new', 'Start a new session', 'command'], ['reset', 'alias for /new', 'command'], ['status', 'Show current session status', 'command'], ['config', 'Show config', 'command'], ['usage', 'Show token usage', 'command'], ['airtable', 'Airtable skill', 'skill']];
      return { items: all.filter(([n]) => n.includes(t.slice(1))).map(([n, m, k]) => ({ text: n, display: `/${n}`, meta: m, kind: k })), extra: 'dropped' };
    }
    if (method === 'complete.path') {
      f.pathQueries = (f.pathQueries || []).concat([{ word: p.word, session: p.session_id || null }]);
      if (p.word === '@file:') return { items: [{ text: '@file:notes.md', display: 'notes.md', meta: '' }, { text: '@file:pic.png', display: 'pic.png', meta: '' }] };
      if (p.word === '@') return { items: [{ text: '@diff', display: '@diff', meta: 'git diff' }, { text: '@file:', display: '@file:', meta: 'attach file' }] };
      return { items: [] };
    }
    if (method === 'slash.exec') {
      if (!l) throw err(4001, 'session not found');
      f.execs = (f.execs || []).concat([p.command]);
      const name = String(p.command).split(/\s/)[0];
      if (name === 'airtable') throw err(4018, 'skill commands go through command.dispatch');
      if (name === 'usage') return { output: 'Session Token Usage\nTotal tokens: 0' };
      if (name === 'goal') {
        const title = String(p.command).replace(/^goal\s*/, '');
        control(l).goal = { title, status: 'active', turns_used: 0, max_turns: 20, contract: { outcome: '', verification: '', constraints: '', boundaries: '', stop_when: '' }, subgoals: [], gates: [], created_at: Date.now() / 1000 };
        changed(l);
        return { type: 'send', notice: `⊙ Goal set (20-turn budget): ${title}`, message: title };
      }
      if (name === 'loop') { control(l).loop = { prompt: 'check the news', status: 'active', mode: 'interval', interval_seconds: 1800, current_delay: 1800, times: 3, until: '', max_ticks: 100, ticks_fired: 0, created_at: Date.now() / 1000, last_fired_at: 0, next_due_at: Date.now() / 1000 + 1800, awaiting_response: false, deferred_by_goal: !!control(l).goal }; changed(l); return { output: '↻ Loop set (every 30m): check the news' }; }
      if (name === 'title') return { output: `Title: ${f.sessions.get(l.key).title || '(none)'}` };
      return { output: `Unknown command /${name} - nothing was sent.` };
    }
    if (method === 'command.dispatch') {
      if (!l) throw err(4001, 'session not found');
      if (p.name === 'airtable') return { type: 'skill', name: 'airtable', display: `/airtable${p.arg ? ` ${p.arg}` : ''}`,
        message: `[IMPORTANT: The user has invoked the "airtable" skill, indicating they want you to follow its instructions. The full skill content is loaded below.]\n\nUse Airtable well.\n\nThe user has provided the following instruction alongside the skill invocation: ${p.arg}\n\n[Runtime note: none]` };
      throw err(4018, `not a quick/plugin/bundle/skill command: ${p.name}`);
    }
    // (as Hermes: a session's goal, loop and heartbeat - read, changed by its actions, every change sent as an event)
    if (method === 'session.control.read') { if (!l) throw err(4001, 'session not found'); return { control: control(l) }; }
    if (method === 'session.control') {
      if (!l) throw err(4001, 'session not found');
      const c = control(l), a = p.action, args = p.args || {};
      f.controlActions = (f.controlActions || []).concat([{ action: a, args }]);
      let dispatch = { type: 'exec', output: `${a} done`, notice: null, message: null, display: null };
      if (a === 'goal.pause' && c.goal) { c.goal.status = 'paused'; c.goal.paused_reason = 'user-paused'; }
      else if (a === 'goal.resume' && c.goal) { c.goal.status = 'active'; delete c.goal.paused_reason; dispatch = { type: 'send', output: null, notice: '▶ Goal resumed', message: `[Continuing toward your standing goal]\nGoal: ${c.goal.title}`, display: null }; }
      else if (a === 'goal.clear') c.goal = null;
      else if (a === 'subgoal.add' && c.goal) c.goal.subgoals.push(String(args.text || ''));
      else if (a === 'subgoal.remove' && c.goal) { const i = Number(args.index); if (!(i >= 1 && i <= c.goal.subgoals.length)) throw err(4002, `no criterion ${i}`); c.goal.subgoals.splice(i - 1, 1); }
      else if (a === 'loop.stop') c.loop = null;
      else if (a === 'loop.pause' && c.loop) c.loop.status = 'paused';
      else if (a === 'heartbeat.clear') c.heartbeat = null;
      else throw err(4002, `cannot ${a} now`);
      return { control: changed(l), dispatch };
    }
    if (method === 'session.status') { if (!l) throw err(4001, 'session not found'); return { output: `Hermes TUI Status\n\nSession ID: ${l.key}\nAgent Running: ${l.running ? 'Yes' : 'No'}` }; }
    if (method === 'session.save') { if (!l) throw err(4001, 'session not found'); return { file: `/h/sessions/saved/${l.key}.json`, secret: 'x' }; }
    if (method === 'session.title') { if (!l) throw err(4001, 'session not found'); f.sessions.get(l.key).title = String(p.title || ''); return { title: String(p.title || ''), pending: false }; }
    if (method === 'session.compress') {
      if (!l) throw err(4001, 'session not found');
      const s = f.sessions.get(l.key), before = s.messages.length;
      if (before > 2) s.messages = [{ id: 1, role: 'user', content: '[summary of the earlier conversation]', timestamp: Date.now() / 1000, active: 1 }, ...s.messages.slice(-1).map(m => ({ ...m, id: 2 }))];
      return { status: 'compressed', removed: Math.max(0, before - s.messages.length), messages: s.messages, summary: { noop: before <= 2, aborted: false, headline: before > 2 ? `Compressed: ${before} → ${s.messages.length} messages` : `No changes from compression: ${before} messages`, token_line: 'Approx request size: ~100 tokens', note: null },
        usage: { context_used: 900, context_max: 256000 }, info: { title: s.title } };
    }
    if (method === 'config.get') { if (!l) throw err(4001, 'session not found'); return { value: l.reasoning || 'medium', display: 'show' }; }
    if (method === 'process.stop') return { killed: 0 };
    if (method === 'prompt.btw' || method === 'prompt.background') {
      if (!l) throw err(4001, 'session not found');
      if (!p.text) throw err(4012, 'text required');
      const btw = method === 'prompt.btw', id = `${btw ? 'btw' : 'bg'}_${crypto.randomBytes(3).toString('hex')}`;
      f.sides = (f.sides || []).concat([{ id, text: p.text }]);
      setTimeout(() => ev(l, btw ? 'btw.complete' : 'background.complete', { task_id: id, ...(btw ? { question: p.text } : {}), text: `Side answer to: ${p.text}` }), 150);
      return { task_id: id };
    }
    if (method === 'config.set') {
      f.configSets = (f.configSets || []).concat([{ ...p }]);
      if (p.key === 'reasoning' && !['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(p.value)) throw err(4002, `unknown reasoning level ${p.value}`);
      if (p.key === 'reasoning' && l) l.reasoning = p.value;
      // (as Hermes: a word that is not on/off toggles this session's YOLO)
      if (p.key === 'yolo' && l) { l.yolo = ['1', 'on', 'true'].includes(p.value) ? true : ['0', 'off', 'false'].includes(p.value) ? false : !l.yolo; return { key: 'yolo', value: l.yolo ? '1' : '0', scope: 'session' }; }
      return { key: p.key, value: String(p.value).split(' ')[0], scope: p.scope || 'session' };
    }
    if (method === 'image.attach_bytes') { f.attached = (f.attached || []).concat([{ kind: 'image', filename: p.filename, bytes: Buffer.from(p.content_base64 || '', 'base64').length }]); return { attached: true, name: p.filename, count: 1 }; }
    if (method === 'file.attach') { const b = Buffer.from(String(p.data_url || '').split(',')[1] || '', 'base64'); f.attached = (f.attached || []).concat([{ kind: 'file', name: p.name, bytes: b.length }]); return { attached: true, name: p.name, path: `/ws/${p.name}`, ref_path: `/ws/${p.name}`, ref_text: `@file:/ws/${p.name}`, uploaded: true }; }
    if (method === 'session.active_list') return { sessions: [...f.live.values()].filter(x => x.running && f.sessions.get(x.key).profile === (p.profile || 'default')).map(x => ({ id: x.sid, session_key: x.key, status: 'working', title: f.sessions.get(x.key).title, current: false, last_active: 0, message_count: 0, model: '', preview: '', started_at: 0 })) };
    if (method === 'subagent.list') return { subagents: [] };
    throw err(-32601, `unknown method ${method}`);
  }
  /** Plays a recorded turn for a message into a live session; what it asks waits for the answer. */
  async function play(l, text) {
    const s = f.sessions.get(l.key);
    l.running = true; l.stop = false;
    // (Hermes' masked prompts, shaped as its gateway sends them: a sudo password for a command, a secret for a variable)
    const masked = /\[\[sudo\]\]/.test(text) ? ['sudo', { command: 'apt-get update', description: '' }] : /\[\[secret\]\]/.test(text) ? ['secret', { env_var: 'GITHUB_TOKEN', prompt: 'Hermes needs your GitHub token to open the pull request.' }] : null;
    if (masked) {
      ev(l, 'message.start', {});
      const r = await ask(l, masked[0], masked[1]);
      f.lastAnswer = r; f.masked = (f.masked || []).concat([{ method: masked[0], value: r && r.value }]);
      const reply = r && r.value ? `Got it (${masked[0]} given).` : `No ${masked[0]} given.`;
      ev(l, 'message.delta', { text: reply });
      s.messages.push({ id: s.messages.length + 1, role: 'assistant', content: reply, timestamp: Date.now() / 1000, active: 1 });
      ev(l, 'message.complete', { text: reply, status: 'complete', usage: { model: 'stub-1', input: 10, output: 5 } });
      l.running = false;
      return;
    }
    const name = /rm -rf/.test(text) ? 'approval' : /\[\[tool:clarify/.test(text) ? 'clarify' : /\[\[tool:/.test(text) ? 'tool' : 'think';
    const rec = RUN(name), slow = /\[\[slow/.test(text);
    let answer = '';
    for (const fr of rec.frames) {
      if (f.stopped) return;
      if (l.stop) break;
      if (fr.request) {
        const r = await ask(l, fr.request.method, Object.fromEntries(Object.entries(fr.request.params).filter(([k]) => k !== 'session_id')));
        f.lastAnswer = r;
        continue;
      }
      if (fr.type === 'sessions.changed' || fr.type === 'session.title') continue;
      if (fr.type === 'message.complete') break;
      if (fr.type === 'message.delta') answer += fr.payload.text || '';
      // (the recording's own stored session id is this session's here)
      ev(l, fr.type, fr.type === 'session.info' && fr.payload.stored_session_id ? { ...fr.payload, stored_session_id: l.key } : fr.payload);
      if (slow) await sleep(60);
    }
    if (name === 'think' && !/\[\[think/.test(text)) answer = `Stub answer to: ${text.replace(/\[\[[^\]]*\]\]/g, '').trim()}`;
    const steered = l.steered || [];
    l.steered = null;
    if (steered.length && !l.stop) { const extra = `\n\n(and about "${steered.join('", "')}": noted)`; ev(l, 'message.delta', { text: extra }); answer += extra; }
    const stopped = l.stop;
    if (/MEDIA:/.test(text)) { const m = /MEDIA:(\S+)/.exec(text)[1]; ev(l, 'message.delta', { text: `\nMEDIA:${m}` }); answer += `\nMEDIA:${m}`; }
    s.messages.push({ id: s.messages.length + 1, role: 'assistant', content: answer, timestamp: Date.now() / 1000, active: 1, ...(name === 'think' && /\[\[think/.test(text) ? { reasoning_content: 'Let me think about this step by step.' } : {}) });
    s.last = Date.now() / 1000; if (!s.title) s.title = text.slice(0, 40);
    ev(l, 'message.complete', { text: stopped ? '' : answer, status: stopped ? 'interrupted' : 'complete', usage: { model: 'stub-1', input: 100, output: 20, context_used: 1200, context_max: 256000 } });
    l.running = false;
    // (as Hermes: its self-improvement review, after the turn, saying what it saved)
    if (/\[\[review\]\]/.test(text)) setTimeout(() => ev(l, 'review.summary', { text: '💾 Self-improvement review: Memory updated · prefers short answers' }), 100);
    const next = l.queue.shift();
    if (next !== undefined) setTimeout(() => play(l, next), 20);
  }
  await new Promise(r => web.listen(0, '127.0.0.1', r));
  f.url = `http://127.0.0.1:${web.address().port}`;
  f.stop = async () => { f.stopped = true; for (const ws of f.sockets) ws.terminate(); await new Promise(r => wss.close(r)); await new Promise(r => web.close(r)); };
  f.dropSockets = () => { for (const ws of f.sockets) ws.terminate(); };
  return f;
}
