// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The mock provider (PLAN WP2.2): a deterministic, scriptable adapter for tests. It is a test manifest, so the registry only
// takes it when tests allow it; it never appears in a real installation. The run text is the script:
//   "crash"  → the helper dies mid-run      "slow:300" → the run takes 300 ms      "fail" → the run ends with an error
//   "slow:300:<words>" → the same, its progress (the agent's task) saying <words>
//   "tool"   → the run uses a tool          "approve"  → the run asks for approval, then ends when it is answered
//   "hang"   → the run request is never answered (for uncertainty tests)
const manifest = {
  id: 'mock', label: 'Mock provider', test: true, transport: 'network', connectionKind: 'remote',
  official: 'None: this is the test double the suite uses',
  fields: [{ key: 'url', label: 'URL', type: 'url', default: 'http://mock.invalid' }, { key: 'token', label: 'Token', type: 'secret' }],
  capabilities: { chat: true, sessions: true, models: true, effort: true, attachments: true, approvals: true, stop: true, taskProgress: true, presence: true },
};

let seq = 0;
const sessions = new Map();     // `${agentKey}` → [{ key, label }]
const waiting = new Map();      // approvalId → resolve
const stopped = new Set();
const submitted = [];           // every run request the helper accepted, for retry checks
const wait = ms => new Promise(r => setTimeout(r, ms));

const base = (params) => ({ kind: 'mock', connectionId: params.connectionId || 'c0', agentKey: params.agentKey, sessionKey: params.sessionKey });

export default {
  manifest,
  async connect(p, ctx) {
    if (p.secrets && p.secrets.token === 'wrong') throw Object.assign(new Error('The token was refused'), { code: 'auth' });
    ctx.emit({ type: 'provider.connected', kind: 'mock', connectionId: p.connectionId || 'c0' });
    return { ok: true };
  },
  async test(p) {
    if (p.secrets && p.secrets.token === 'wrong') return { ok: false, error: 'The token was refused', fix: 'Check the token in the connection settings.' };
    return { ok: true, detail: 'Mock reachable' };
  },
  async discover() { return { agents: [{ nativeId: 'mock-a', name: 'Mock A' }, { nativeId: 'mock-b', name: 'Mock B' }] }; },
  async models() { return { models: [{ id: 'mock-small', label: 'Mock small' }, { id: 'mock-large', label: 'Mock large' }], effort: ['low', 'medium', 'high'] }; },
  async listSessions(p) { return { sessions: sessions.get(p.agentKey) || [] }; },
  async createSession(p) {
    const s = { key: `s${++seq}`, label: p.label || 'New session' };
    sessions.set(p.agentKey, [...(sessions.get(p.agentKey) || []), s]);
    return s;
  },
  async renameSession(p) { const l = sessions.get(p.agentKey) || []; const s = l.find(x => x.key === p.sessionKey); if (s) s.label = p.label; return { ok: !!s }; },
  async deleteSession(p) { sessions.set(p.agentKey, (sessions.get(p.agentKey) || []).filter(x => x.key !== p.sessionKey)); return { ok: true }; },
  async history(p) { return { messages: [{ role: 'assistant', text: `history for ${p.sessionKey}` }] }; },
  async taskProgress(p) { return { steps: [{ text: 'Working', done: false }], agentKey: p.agentKey }; },
  async env() { return { keys: Object.keys(process.env), pid: process.pid }; },
  async submitted() { return { runs: submitted.slice() }; },
  async stop(p, ctx) { stopped.add(p.runId); return { ok: true }; },
  async approve(p) { const r = waiting.get(p.approvalId); if (r) { waiting.delete(p.approvalId); r(p.approved === true); } return { ok: !!r }; },
  async run(p, ctx) {
    const text = String(p.input || '');
    submitted.push({ runId: p.runId, input: text });
    if (text === 'hang') return new Promise(() => {});
    const runId = p.runId || `r${++seq}`;
    const b = base(p);
    ctx.emit({ type: 'run.start', ...b, runId });
    (async () => {
      try {
        if (text === 'crash') { await wait(30); process.exit(1); }
        const m = /^slow:(\d+)(?::(.+))?$/.exec(text);
        ctx.emit({ type: 'run.progress', ...b, runId, text: m?.[2] || 'Thinking', pct: 10 });
        if (m) { const end = Date.now() + Number(m[1]); while (Date.now() < end && !stopped.has(runId)) await wait(10); }
        if (text === 'tool') {
          ctx.emit({ type: 'tool.start', ...b, runId, toolId: 't1', name: 'search', input: 'q' });
          ctx.emit({ type: 'tool.update', ...b, runId, toolId: 't1', text: 'working' });
          ctx.emit({ type: 'tool.end', ...b, runId, toolId: 't1', ok: true, text: 'done' });
        }
        if (text === 'approve') {
          const approvalId = `a${++seq}`;
          ctx.emit({ type: 'approval.requested', ...b, runId, approvalId, tool: 'shell', summary: 'run a command' });
          const ok = await new Promise(r => waiting.set(approvalId, r));
          ctx.emit({ type: 'approval.resolved', ...b, runId, approvalId, approved: ok });
          if (!ok) { ctx.emit({ type: 'run.end', ...b, runId, status: 'stopped' }); return; }
        }
        if (stopped.has(runId)) { stopped.delete(runId); ctx.emit({ type: 'run.end', ...b, runId, status: 'stopped' }); return; }
        if (text === 'fail') { ctx.emit({ type: 'run.end', ...b, runId, status: 'error', error: 'The mock failed on purpose' }); return; }
        ctx.emit({ type: 'run.end', ...b, runId, status: 'ok', text: `Mock reply to: ${text.slice(0, 200)}` });
      } catch (e) { ctx.emit({ type: 'run.end', ...b, runId, status: 'error', error: e.message }); }
    })();
    return { runId };
  },
};
