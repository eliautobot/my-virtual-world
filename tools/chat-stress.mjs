#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window under load (docs/features/CHAT.md): `chats` owners' chats at once, each streamed by a brain that
// starts after `latency` ms (± half) and then writes `pieces` pieces `gap` ms apart, on the real chat contract
// (server/chat/chat.js), the real transcript store and database (schema 27, FTS) and the real Mind (assistantRun:
// StreamSplit, buildTurns, its own slots MAX_CHATS, pieces sent every DELTA_MS), with a 100 ms timer standing in for
// the main loop. `stop` of the chats are stopped once they are writing. Every chat has a history of `history`
// messages first (the conversation sent is built from it).
//   1. the timer alone          2. the rush: every chat at once          3. the same again (a warm database)
// Reports the timer's lateness and the event loop's delay with and without, how long chats waited for a slot and took,
// the most at once, pieces sent and their rate, Stop's delay, rows written, and that nothing leaked (slots, runs).
// Usage: node tools/chat-stress.mjs [--chats 300] [--latency 600] [--pieces 60] [--gap 25] [--stop 0.25] [--history 60]
import { parseArgs } from 'node:util';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { Sessions } from '../server/chat/sessions.js';
import { Transcripts } from '../server/chat/transcript.js';
import { Chat } from '../server/chat/chat.js';
import { EventBus } from '../server/providers/bus.js';
import { Mind, MAX_IN_FLIGHT } from '../server/mind/mind.js';

const { values: o } = parseArgs({ options: {
  chats: { type: 'string', default: '300' }, latency: { type: 'string', default: '600' }, pieces: { type: 'string', default: '60' },
  gap: { type: 'string', default: '25' }, stop: { type: 'string', default: '0.25' }, history: { type: 'string', default: '60' }, baseline: { type: 'string', default: '5' },
} });
const CHATS = +o.chats, LAT = +o.latency, PIECES = +o.pieces, GAP = +o.gap, STOP = +o.stop, HIST = +o.history, BASE = +o.baseline;
const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), max: +(s.at(-1) || 0).toFixed(1) }; };
const wait = ms => new Promise(r => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-chat-stress-'));
const dbs = openDb(dir);
const bus = new EventBus();
const OWNER = 1, AGENTS = Math.max(1, Math.ceil(CHATS / 5));
const agents = new Map(Array.from({ length: AGENTS }, (_, k) => [k + 1, { id: k + 1, key: `a${k + 1}`, name: `Agent ${k + 1}`, enabled: true, ownerId: OWNER, connectionId: 9, nativeId: 'mind' }]));
const conn = { id: 9, kind: 'models', enabled: true, scope: 'installation', config: { model: 'fake', priceInPerMTok: 1, priceOutPerMTok: 2 } };
const P = { account: { id: OWNER, login: 'owner', displayName: 'Owner' } };
const frames = { delta: 0, other: 0 };
const streams = new Map();     // streamId → abort
let atOnce = 0, mostAtOnce = 0;

/** The brain: answers after LAT ± half, then PIECES pieces GAP ms apart; abort() ends it with what was written. */
function complete(c, req, onDelta) {
  return new Promise(resolve => {
    let text = '', n = 0, timer = null, done = false;
    atOnce++; mostAtOnce = Math.max(mostAtOnce, atOnce);
    const finish = status => { if (done) return; done = true; clearTimeout(timer); atOnce--; streams.delete(req.streamId); resolve({ text, finish: status, model: 'fake', ms: 0, usage: { in: 2000, out: n * 4 }, costUsd: null }); };
    const step = () => {
      if (n >= PIECES) { const tail = n === PIECES ? '\n[[mvw-actions]]\n{"title":"Load test"}' : ''; text += tail; onDelta?.({ text: tail }); return finish('stop'); }
      const p = `word${n} and some more text `; text += p; n++; onDelta?.({ text: p });
      timer = setTimeout(step, GAP);
    };
    streams.set(req.streamId, () => finish('stopped'));
    timer = setTimeout(step, LAT * (0.5 + Math.random()));
  });
}
const mind = new Mind({ dbs, agents: { get: id => agents.get(id), enabled: () => [...agents.values()] }, connections: { get: () => conn, canUse: () => true }, registry: { implemented: () => true },
  complete, sim: () => ({}), life: { byAgent: new Map() }, principalFor: () => P, bus,
  abort: async (c, id) => { streams.get(id)?.(); },
  config: () => ({ enabled: true, reflectConnection: '', agentDailyJobs: 80, agentMonthlyUsd: 1000, dailyUsd: 100000, keepDays: 30, chatModels: '', chatPerDay: 100000 }) });
const sessions = new Sessions(dbs), transcripts = new Transcripts(dbs);
const chat = new Chat({ agents: { get: id => agents.get(id), canUse: () => true, isOwner: () => true }, connections: { get: () => conn }, registry: { implemented: () => true },
  host: null, bus, sessions, transcripts, attachments: { pathOf: () => null }, references: null, agentOk: () => true,
  send: (acc, f) => { if (f.delta) frames.delta++; else frames.other++; }, inproc: { models: mind.chatAdapter() } });

// the chats, each with a history first (what the conversation sent is built from)
const S = [];
for (let k = 0; k < CHATS; k++) {
  const agentId = (k % AGENTS) + 1, s = sessions.create(OWNER, agentId, null, 'New session');
  for (let h = 0; h < HIST; h++) transcripts.append(OWNER, agentId, s.id, { role: h % 2 ? 'assistant' : 'user', text: `${h % 2 ? 'An answer' : 'A question'} ${h}: ${'lorem ipsum '.repeat(120)}` });
  S.push({ agentId, session: s.id });
}

/** A phase: the 100 ms timer's lateness and the event loop's delay while `work` runs. */
async function phase(work) {
  const late = [], eld = monitorEventLoopDelay({ resolution: 10 });
  eld.enable();
  let next = performance.now() + 100, on = true;
  const tick = () => { const t = performance.now(); late.push(Math.max(0, t - next)); next += 100; if (on) setTimeout(tick, Math.max(0, next - performance.now())); };
  setTimeout(tick, 100);
  const t0 = Date.now(), out = await work();
  on = false; eld.disable();
  return { seconds: +((Date.now() - t0) / 1000).toFixed(1), timerLateMs: stats(late), loopDelayMs: { p50: +(eld.percentile(50) / 1e6).toFixed(1), p99: +(eld.percentile(99) / 1e6).toFixed(1), max: +(eld.max / 1e6).toFixed(1) }, ...out };
}

async function rush(label) {
  const took = [], stopDelay = [], ends = { ok: 0, stopped: 0, error: 0 }, errors = new Set();
  const runs = new Map();
  const off = bus.on(e => {
    const r = runs.get(e.runId); if (!r) return;
    if (e.type === 'run.delta' && r.stopAt === null && r.stop && !r.asked) { r.asked = true; r.stopAt = performance.now(); chat.stop(P, e.runId).catch(() => {}); }
    if (e.type === 'run.end') { ends[e.status === 'ok' ? 'ok' : e.status === 'stopped' ? 'stopped' : 'error']++; if (e.status === 'error') errors.add(e.error); took.push(performance.now() - r.t0); if (r.stopAt !== null) stopDelay.push(performance.now() - r.stopAt); r.done(); }
  });
  const rows0 = dbs.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n;
  const out = await phase(async () => {
    await Promise.all(S.map((s, k) => new Promise(resolve => {
      chat.startRun(P, { agent: s.agentId, session: s.session, input: `Question ${k} of ${label}: what do you think?` })
        .then(({ runId }) => { runs.set(runId, { t0: performance.now(), stop: Math.random() < STOP, stopAt: null, asked: false, done: resolve }); })
        .catch(e => { errors.add(e.message); ends.error++; resolve(); });
    })));
    return {};
  });
  off();
  await wait(100);
  const rows = dbs.db.prepare('SELECT COUNT(*) AS n FROM chat_messages').get().n - rows0;
  return { ...out, chats: CHATS, ends, errors: [...errors], tookMs: stats(took), stopDelayMs: stats(stopDelay), rowsWritten: rows };
}

const base = await phase(async () => { await wait(BASE * 1000); return {}; });
console.log('alone:', JSON.stringify(base));
frames.delta = 0;
const a = await rush('the rush');
console.log('rush:', JSON.stringify({ ...a, pieces: frames.delta, piecesPerSecond: Math.round(frames.delta / a.seconds), mostAtOnce }));
const fd = frames.delta; mostAtOnce = 0;
const b = await rush('again');
console.log('again:', JSON.stringify({ ...b, pieces: frames.delta - fd, mostAtOnce }));
await wait(200);
const leaks = { slots: mind.chatInFlight, queued: mind.chatQueue.length, runsOpen: [...chat.runs.values()].filter(r => !r.done).length, streams: streams.size };
const search = (() => { const t0 = performance.now(); const r = transcripts.search(OWNER, 'question rush', 30); return { hits: r.length, ms: +(performance.now() - t0).toFixed(1) }; })();
const report = { chats: CHATS, maxChats: 48, worldThinkingSlots: MAX_IN_FLIGHT, leaks, search,
  overheadTimerP95Ms: +(Math.max(a.timerLateMs.p95, b.timerLateMs.p95) - base.timerLateMs.p95).toFixed(1),
  loopDelayP99Ms: Math.max(a.loopDelayMs.p99, b.loopDelayMs.p99), memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  dbMb: +(fs.statSync(path.join(dir, 'next.db')).size / 1048576).toFixed(1) };
const ok = a.ends.error === 0 && b.ends.error === 0 && a.ends.ok + a.ends.stopped === CHATS && b.ends.ok + b.ends.stopped === CHATS
  && leaks.slots === 0 && leaks.queued === 0 && leaks.runsOpen === 0 && leaks.streams === 0 && mostAtOnce <= 48 && report.overheadTimerP95Ms < 20 && a.stopDelayMs.p95 < 300;
console.log(JSON.stringify(report));
console.log(ok ? 'PASS' : 'FAIL');
mind.stop(); dbs.close?.(); fs.rmSync(dir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
