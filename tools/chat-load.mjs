#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window under load, end to end (docs/features/CHAT.md; tools/chat-stress.mjs is the same in one process, on
// the chat contract and the Mind): a throwaway server with a city of `population` residents, `agents` of them AI agents
// on one brain, and `chats` owners' chats kept going at once for `seconds` over HTTP and the socket — every chat its own
// session, a message sent as soon as the last answer ended (after a pause of up to `think` ms), so the conversations
// grow. The brain is a fake OpenAI-compatible server in a process of its own: `first-ms` before the first piece, then
// `pieces` pieces of 4–5 characters every `piece-ms` (~80 tokens a second, as a fast model writes); a new chat's first
// answer ends with the hidden marker and a title, split across pieces. A share `stop` of the answers is stopped part-way
// (after 5–40 pieces have arrived). Measured on the server: the main loop's tick (its work) and how late each tick
// started (the event loop held up by the chats: /api/health loop.late), CPU of the server and of its provider helper,
// memory; at the browser: the time to the first piece, pieces a second; Stop to the end of the answer; at the brain:
// answers at once (never more than the window's 48 slots), and Stop to the provider being let go. Checked: every answer
// arrives whole and exact (what streamed = what ended = what the brain wrote, minus the hidden part), every stop ends at
// once with what was written kept, the transcripts hold every answer, no error.
// Usage: node tools/chat-load.mjs [--population 4000] [--agents 24] [--chats 96] [--seconds 90] [--baseline 60]
//        [--pieces 600] [--piece-ms 12] [--first-ms 400] [--stop 0.25] [--think 300] [--json <out.json>]
import { parseArgs } from 'node:util';
import { fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import { startServer, ownerSession, httpClient } from './lib/testserver.mjs';

const { values: o } = parseArgs({ options: {
  population: { type: 'string', default: '4000' }, agents: { type: 'string', default: '24' }, chats: { type: 'string', default: '96' },
  seconds: { type: 'string', default: '90' }, baseline: { type: 'string', default: '60' }, pieces: { type: 'string', default: '600' },
  'piece-ms': { type: 'string', default: '12' }, 'first-ms': { type: 'string', default: '400' }, stop: { type: 'string', default: '0.25' },
  think: { type: 'string', default: '300' }, json: { type: 'string' }, 'fake-brain': { type: 'boolean', default: false },
} });
const POP = +o.population, AGENTS = +o.agents, CHATS = +o.chats, SECS = +o.seconds, BASE = +o.baseline, PIECES = +o.pieces;
const PIECE_MS = +o['piece-ms'], FIRST_MS = +o['first-ms'], STOP = +o.stop, THINK = +o.think;
const SLOTS = 48;   // server/mind/mind.js MAX_CHATS
const MARK = '[[mvw-actions]]';

/** What the brain writes for a job (the same in both processes): the visible answer, and on a new chat the hidden part. */
function answerOf(job, first) {
  const words = Array.from({ length: PIECES }, (_, i) => `w${(i * 7919 + job * 31) % 997}`);
  const visible = `Answer ${job}: ${words.join(' ')}`;
  return { visible, full: first ? `${visible}\n${MARK}\n{"title":"Load ${job}"}` : visible };
}
/** The pieces it is written in: words, and the hidden part three characters at a time (the marker split across pieces). */
function piecesOf(full) {
  const i = full.indexOf(`\n${MARK}`), head = i >= 0 ? full.slice(0, i) : full, tail = i >= 0 ? full.slice(i) : '';
  return [...head.split(/(?<= )/), ...(tail.match(/[\s\S]{1,3}/g) || [])];
}

// ------------------------------------------------------------------ the fake brain (its own process)
if (o['fake-brain']) {
  let open = 0, maxOpen = 0, served = 0;
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake-fast' }] })); return; }
      const j = b ? JSON.parse(b) : {};
      const sys = (j.messages || []).find(m => m.role === 'system')?.content || '';
      const last = (j.messages || []).filter(m => m.role === 'user').at(-1)?.content;
      const text = typeof last === 'string' ? last : Array.isArray(last) ? last.filter(p => p.type === 'text').map(p => p.text).join('\n') : '';
      const job = Number(/job-(\d+)/.exec(text)?.[1] || 0);
      const usage = { prompt_tokens: Math.round(b.length / 4), completion_tokens: PIECES };
      if (!j.stream || !/In this chat you talk with/.test(sys)) {   // anything else (a resident's short answer): JSON at once
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: j.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: 'Hi.' }) } }], usage }));
        return;
      }
      const pieces = piecesOf(answerOf(job, /This is a new chat/.test(sys)).full);
      open++; served++; maxOpen = Math.max(maxOpen, open);
      process.send({ t: 'open', job, at: Date.now(), open });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0, timer = null, ended = false;
      const done = early => { if (ended) return; ended = true; clearTimeout(timer); open--; process.send({ t: early ? 'cut' : 'done', job, at: Date.now(), written: i }); };
      res.on('close', () => done(!res.writableEnded));
      const next = () => {
        if (res.destroyed) return;
        if (i >= pieces.length) {
          res.end(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`);
          return done(false);
        }
        res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: pieces[i++] } }] })}\n\n`);
        timer = setTimeout(next, PIECE_MS);
      };
      timer = setTimeout(next, FIRST_MS);
    });
  });
  srv.listen(0, '127.0.0.1', () => process.send({ t: 'ready', port: srv.address().port }));
  process.on('message', m => { if (m === 'stats') process.send({ t: 'stats', open, maxOpen, served }); if (m === 'quit') { srv.close(); process.exit(0); } });
} else {
  await main();
}

// ------------------------------------------------------------------ the run
async function main() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), p99: Math.round(q(0.99)), max: Math.round(s.at(-1) || 0) }; };
  const cpuOf = pid => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; } catch { return null; } };

  // the brain
  const brainProc = fork(fileURLToPath(import.meta.url), ['--fake-brain', '--pieces', String(PIECES), '--piece-ms', String(PIECE_MS), '--first-ms', String(FIRST_MS)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const atBrain = new Map();   // job → { open, cut, done, written }
  let brainStats = null;
  const port = await new Promise(resolve => brainProc.on('message', m => {
    if (m.t === 'ready') resolve(m.port);
    else if (m.t === 'open') atBrain.set(m.job, { open: m.at });
    else if (m.t === 'cut' || m.t === 'done') Object.assign(atBrain.get(m.job) || {}, { [m.t]: m.at, written: m.written });
    else if (m.t === 'stats') brainStats = m;
  }));
  const brainNow = async () => { brainStats = null; brainProc.send('stats'); while (!brainStats) await sleep(10); return brainStats; };

  log(`starting a throwaway server: ${POP} residents, ${AGENTS} AI agents`);
  const s = await startServer({ population: POP, agents: AGENTS, timeoutMs: 180000, env: { MVW_PROVIDER_TEST: '1', MVW_WS_PER_ADDRESS: '1000', MVW_WS_MAX: '5000' } });
  const ws = [];
  let exit = 1;
  try {
    const owner = await ownerSession(s), anon = httpClient(s.url);
    const agents = (await owner.get('/api/agents')).json.agents.slice(0, AGENTS);
    for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
    const c = await owner.post('/api/connections', { kind: 'models', label: 'Fake fast brain', scope: 'installation',
      config: { provider: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, model: 'fake-fast', priceInPerMTok: 0.1, priceOutPerMTok: 0.4 }, secrets: { apiKey: 'sk-chat-load' } });
    if (c.status !== 200) throw new Error(`the brain connection: ${c.status} ${c.text}`);
    for (const a of agents) {
      const r = await owner.post('/api/agents/update', { id: a.id, connectionId: c.json.id, nativeId: 'mind' });
      if (r.status !== 200) throw new Error(`agent ${a.id}: ${r.status} ${r.text}`);
    }
    await owner.post('/api/settings', { values: { 'mind.chatPerDay': '5000', 'mind.dailyUsd': '100' } });
    const sessions = [];
    for (let k = 0; k < CHATS; k++) {
      const a = agents[k % agents.length];
      const r = await owner.post('/api/chat-sessions/create', { agent: a.id, label: `Load ${k}` });
      if (r.status !== 200) throw new Error(`session ${k}: ${r.status} ${r.text}`);
      sessions.push({ agent: a.id, id: r.json.session.id, ends: [] });
    }
    // what the browser sees: one socket for the account (every chat's pieces and events come to each of its sockets)
    const runs = new Map();   // runId → { job, first, stopAt, deltas, text, firstAt, end, endAt }
    const runOf = id => { let r = runs.get(id); if (!r) runs.set(id, r = { deltas: 0, text: '' }); return r; };
    const sock = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
    ws.push(sock);
    let frames = 0, bytes = 0;
    sock.onmessage = e => {
      if (typeof e.data !== 'string') { bytes += e.data.size ?? e.data.byteLength ?? 0; return; }
      bytes += e.data.length;
      if (!e.data.startsWith('{"t":"chat"')) return;
      const m = JSON.parse(e.data), r = runOf(m.run);
      frames++;
      if (m.delta?.text) { r.deltas++; r.text += m.delta.text; r.firstAt ??= Date.now(); r.onDelta?.(); }
      if (m.event?.type === 'run.end') { r.end = m.event; r.endAt = Date.now(); r.onEnd?.(); }
    };
    await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = () => reject(new Error('WebSocket error')); });

    // the server's loop, CPU and health round trip over a stretch of time
    const hpid = (() => { try { return Number(execFileSync('pgrep', ['-P', String(s.pid)], { encoding: 'utf8' }).trim().split('\n')[0]) || null; } catch { return null; } })();
    async function measure(seconds, during) {
      const h0 = (await anon.get('/api/health')).json, c0 = cpuOf(hpid), t0 = Date.now(), rtt = [];
      let stop = false;
      const poll = (async () => { while (!stop) { const a = Date.now(); await anon.get('/api/health'); rtt.push(Date.now() - a); await sleep(250); } })();
      await (during ? during(t0 + seconds * 1000) : sleep(seconds * 1000));
      stop = true; await poll;
      const h1 = (await anon.get('/api/health')).json, wall = (Date.now() - t0) / 1000, c1 = cpuOf(hpid);
      const cpu = ((h1.loop.cpuUs.user + h1.loop.cpuUs.system) - (h0.loop.cpuUs.user + h0.loop.cpuUs.system)) / 1e6;
      const l = h1.loop;
      return { seconds: +wall.toFixed(1), tickMs: { mean: l.meanMs, p95: l.p95Ms, max: l.maxMs }, simMs: { mean: l.sim.meanMs, p95: l.sim.p95Ms }, lateMs: { mean: l.late.meanMs, p95: l.late.p95Ms, max: l.late.maxMs },
        healthRttMs: stats(rtt), serverCpuPct: +(cpu / wall * 100).toFixed(1), helperCpuPct: c0 !== null && c1 !== null ? +((c1 - c0) / wall * 100).toFixed(1) : null, rssMb: l.rssMb, errors: h1.errors };
    }
    log(`baseline: ${BASE} s with no chats (the loop's figures cover its last 60 s)`);
    const base = await measure(BASE);
    log('  ', JSON.stringify(base));

    // the chats: each session sends, waits for its answer (or stops it), pauses, sends again, until the time is up
    let job = 0, sent = 0, refused = 0;
    const refusals = [];
    async function chatLoop(sess, until) {
      while (Date.now() < until) {
        const n = ++job, first = !sess.ends.length, stopAfter = Math.random() < STOP ? 5 + Math.floor(Math.random() * 36) : 0;
        const t0 = Date.now();
        const p = await owner.post('/api/providers/runs', { agent: sess.agent, session: sess.id, input: `Please answer job-${n}, with all the detail you have.` });
        sent++;
        if (p.status !== 200) { refused++; refusals.push(`${p.status} ${p.json?.code}`); await sleep(1000); continue; }
        const r = runOf(p.json.runId);
        Object.assign(r, { job: n, first, sentAt: t0, stopAfter });
        await new Promise(resolve => {
          r.onEnd = resolve;
          if (r.end) return resolve();
          if (stopAfter) {
            const check = () => { if (!r.stopAt && r.deltas >= stopAfter) { r.stopAt = Date.now(); owner.post('/api/providers/interrupt', { run: p.json.runId }); } };
            r.onDelta = check; check();
          }
          setTimeout(resolve, 120000);   // never more than two minutes (counted as lost)
        });
        r.onDelta = r.onEnd = null;
        sess.ends.push(r);
        await sleep(Math.random() * THINK);
      }
    }
    log(`load: ${CHATS} chats at once for ${SECS} s (${SLOTS} answered at once, the rest wait their turn); ${Math.round(STOP * 100)} % stopped part-way`);
    const load = await measure(SECS, async until => {
      await Promise.all(sessions.map((sess, k) => sleep(k * 20).then(() => chatLoop(sess, until))));
    });
    log('  ', JSON.stringify(load));
    const brain = await brainNow();

    // what arrived, and what the transcripts hold
    const all = [...runs.values()].filter(r => r.job), ended = all.filter(r => r.end);
    const ok = ended.filter(r => r.end.status === 'ok'), stopped = ended.filter(r => r.end.status === 'stopped'), other = ended.filter(r => !['ok', 'stopped'].includes(r.end.status));
    const wrong = [];
    for (const r of ok) {
      const want = answerOf(r.job, r.first).visible;
      if (r.end.text !== want) wrong.push(`job ${r.job}: ended text differs (${r.end.text.length} vs ${want.length} chars)`);
      else if (r.text.trimEnd() !== want) wrong.push(`job ${r.job}: streamed text differs (${r.text.length} vs ${want.length} chars)`);
      if (r.first && r.text.includes('mvw-actions')) wrong.push(`job ${r.job}: the hidden part was shown`);
    }
    const stopWrong = [], stopMs = [], cutMs = [];
    for (const r of stopped) {
      const want = answerOf(r.job, r.first).visible;
      if (!want.startsWith(r.end.text)) stopWrong.push(`job ${r.job}: what was kept is not the start of the answer`);
      if (r.text.trimEnd() !== r.end.text) stopWrong.push(`job ${r.job}: streamed and kept differ (${r.text.length} vs ${r.end.text.length})`);
      if (r.stopAt) stopMs.push(r.endAt - r.stopAt);
      const b = atBrain.get(r.job);
      if (b?.cut && r.stopAt) cutMs.push(b.cut - r.stopAt);
    }
    const askedStop = all.filter(r => r.stopAt), notCut = askedStop.filter(r => !atBrain.get(r.job)?.cut && !atBrain.get(r.job)?.done);
    const finishedFirst = askedStop.filter(r => r.end && r.end.status === 'ok');   // finished before the Stop arrived (fine, counted)
    const lost = all.filter(r => !r.end);
    // the transcripts: every answer that ended with text is kept, in order
    let transcriptWrong = 0;
    for (const sess of sessions) {
      const h = (await owner.get(`/api/providers/history?agent=${sess.agent}&session=${sess.id}`)).json.messages;
      const kept = h.filter(m => m.role === 'assistant').map(m => m.text), want = sess.ends.filter(r => r.end && r.end.text).map(r => r.end.text);
      if (kept.length !== want.length || kept.some((t, i) => t !== want[i])) transcriptWrong++;
    }
    const firstMs = ok.concat(stopped).filter(r => r.firstAt).map(r => r.firstAt - r.sentAt);
    const wholeMs = ok.map(r => r.endAt - r.sentAt);
    const logLines = (s.log().match(/^.*(error|warn|could not).*$/gim) || []).filter(l => !/licen[cs]e|presence|deprecated parameters/i.test(l));
    const report = {
      city: { population: POP, agents: AGENTS }, chatsAtOnce: CHATS, seconds: SECS,
      answers: { sent, refused, refusals: [...new Set(refusals)], ended: ended.length, ok: ok.length, stopped: stopped.length, other: other.map(r => `${r.end.status}: ${r.end.error}`).slice(0, 5), lost: lost.length,
        perSecond: +(ended.length / load.seconds).toFixed(1), piecesPerSecond: Math.round(all.reduce((n, r) => n + r.deltas, 0) / load.seconds), framesPerSecond: Math.round(frames / load.seconds),
        socketMbPerSecond: +(bytes / 1048576 / load.seconds).toFixed(2), firstPieceMs: stats(firstMs), wholeAnswerMs: stats(wholeMs) },
      exact: { okChecked: ok.length, wrong: wrong.slice(0, 5), wrongCount: wrong.length, transcriptsWrong: transcriptWrong },
      stop: { asked: askedStop.length, endedStopped: stopped.length, finishedFirst: finishedFirst.length, stopToEndMs: stats(stopMs), stopToBrainLetGoMs: stats(cutMs), brainNotLetGo: notCut.length, wrong: stopWrong.slice(0, 5), wrongCount: stopWrong.length },
      brain: { answersServed: brain.served, mostAtOnce: brain.maxOpen, slots: SLOTS, stillOpen: brain.open },
      server: { baseline: base, load, tickP95OverheadMs: +(load.tickMs.p95 - base.tickMs.p95).toFixed(2), lateP95OverheadMs: +(load.lateMs.p95 - base.lateMs.p95).toFixed(2), logLines: logLines.slice(0, 8) },
    };
    console.log(JSON.stringify(report, null, 2));
    if (o.json) fs.writeFileSync(o.json, JSON.stringify(report, null, 2));
    const checks = {
      'every answer ended (none lost, none refused, no errors)': lost.length === 0 && refused === 0 && other.length === 0,
      'every answer exact, the hidden part never shown': wrong.length === 0 && ok.length > 0,
      'every transcript holds every answer': transcriptWrong === 0,
      'Stop ends the answer within 1 s (p99), keeps what was written': stopped.length > 0 && stats(stopMs).p99 < 1000 && stopWrong.length === 0,
      'Stop lets the brain go within 1 s (p99), every time': notCut.length === 0 && stats(cutMs).p99 < 1000,
      [`never more than ${SLOTS} answers at the brain at once`]: brain.maxOpen <= SLOTS && brain.open === 0,
      'the main loop: tick p95 within 5 ms of no chats': report.server.tickP95OverheadMs < 5,
      'the main loop: starts late by under 25 ms at p95, 250 ms at most': load.lateMs.p95 < 25 && load.lateMs.max < 250,
      'the server answers within 100 ms (p95)': load.healthRttMs.p95 < 100,
    };
    for (const [k, v] of Object.entries(checks)) console.log(`${v ? 'ok  ' : 'FAIL'} ${k}`);
    exit = Object.values(checks).every(Boolean) ? 0 : 1;
    console.log(exit ? 'FAIL' : 'PASS');
  } finally {
    for (const w of ws) try { w.close(); } catch { /* closed */ }
    await s.stop();
    brainProc.send('quit');
  }
  process.exit(exit);
}
