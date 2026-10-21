#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The chat window and voice under load TOGETHER, end to end (docs/features/CHAT.md §10; tools/chat-load.mjs and
// tools/voice-stress.mjs are each half alone). A throwaway server with a city of `population` residents; the brain and
// the voice service are fakes in a process of their own (the brain an OpenAI-compatible server writing ~80 tokens a
// second, the voice service one that answers after `speak-ms` / `hear-ms` with MP3 sized to the text - 15 characters a
// second - and hears a WAV as its size). For `seconds`, all at once, over HTTP and the socket:
// - the owner's `chats` text chats with `agents` agents (each sends again as soon as its answer ended; a share `stop`
//   stopped part-way), as chat-load;
// - `voice-chats` accounts in voice mode, each with an agent of its own: talks 1–4 s (a recording, heard by the service),
//   sends what was heard, and has the answer spoken WHILE it is written - the answer so far cut at words into pieces of
//   up to 400 characters, the first alone, two requests at once, as the window does - then now and then 🔊 reads the
//   whole answer again from the transcript (its parts); a share `stop` interrupt (a tap): the speech and the answer stop;
// - `accounts` other accounts reading aloud (200–900 characters of Markdown) and dictating (2–12 s, now and then 60 s),
//   now and then a replay (the cache), as voice-stress.
// Checked: every chat answer exact (streamed = ended = written, the hidden part never shown), every transcript whole,
// Stop within 1 s and the brain let go; in voice mode every word of the answer spoken once and in order (a stopped one: a
// start of what was kept), every heard text what the service heard; every audio right (MP3 lasting what the text takes),
// none refused, never more than 48 chats at the brain nor 32 calls at the voice service, every second heard or spoken
// metered, nothing left in flight; the main loop's tick and the event loop's lateness close to idle; no server error.
// Usage: node tools/chat-voice-stress.mjs [--population 3000] [--agents 24] [--chats 48] [--voice-chats 32]
//        [--accounts 40] [--seconds 90] [--baseline 45] [--pieces 300] [--piece-ms 12] [--first-ms 400] [--stop 0.2]
//        [--speak-ms 350] [--hear-ms 250] [--json <out.json>]
import { parseArgs } from 'node:util';
import { fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import { startServer, ownerSession, userSession, httpClient } from './lib/testserver.mjs';
import { sniff, seconds as audioSeconds, wavFromPcm } from '../server/voice/audio.js';
import { speakable } from '../server/voice/text.js';

const { values: o } = parseArgs({ options: {
  population: { type: 'string', default: '3000' }, agents: { type: 'string', default: '24' }, chats: { type: 'string', default: '48' },
  'voice-chats': { type: 'string', default: '32' }, accounts: { type: 'string', default: '40' }, seconds: { type: 'string', default: '90' },
  baseline: { type: 'string', default: '45' }, pieces: { type: 'string', default: '300' }, 'piece-ms': { type: 'string', default: '12' },
  'first-ms': { type: 'string', default: '400' }, stop: { type: 'string', default: '0.2' }, 'speak-ms': { type: 'string', default: '350' },
  'hear-ms': { type: 'string', default: '250' }, json: { type: 'string' }, fake: { type: 'boolean', default: false },
} });
const POP = +o.population, AGENTS = +o.agents, CHATS = +o.chats, VCHATS = +o['voice-chats'], ACCOUNTS = +o.accounts, SECS = +o.seconds, BASE = +o.baseline;
const PIECES = +o.pieces, PIECE_MS = +o['piece-ms'], FIRST_MS = +o['first-ms'], STOP = +o.stop, SPEAK_MS = +o['speak-ms'], HEAR_MS = +o['hear-ms'];
const CHAT_SLOTS = 48, VOICE_SLOTS = 32;   // server/mind/mind.js MAX_CHATS, server/voice/voice.js MAX_AT_ONCE
const MARK = '[[mvw-actions]]', CPS = 15, SEG = 400;
const FRAME = (() => { const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64; return f; })();
const framesFor = chars => Math.max(1, Math.round(chars / CPS * 44100 / 1152));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** What the brain writes for a job: the visible answer, and on a new chat the hidden part. */
function answerOf(job, first) {
  const words = Array.from({ length: PIECES }, (_, i) => `w${(i * 7919 + job * 31) % 997}`);
  const visible = `Answer ${job}: ${words.join(' ')}`;
  return { visible, full: first ? `${visible}\n${MARK}\n{"title":"Load ${job}"}` : visible };
}
function piecesOf(full) {
  const i = full.indexOf(`\n${MARK}`), head = i >= 0 ? full.slice(0, i) : full, tail = i >= 0 ? full.slice(i) : '';
  return [...head.split(/(?<= )/), ...(tail.match(/[\s\S]{1,3}/g) || [])];
}

// ------------------------------------------------------------------ the fake brain and voice service (their own process)
if (o.fake) {
  const st = { brainOpen: 0, brainMax: 0, served: 0, voiceOpen: 0, voiceMax: 0, spoke: 0, heard: 0 };
  const brain = http.createServer((req, res) => {
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
      if (!j.stream || !/In this chat you talk with/.test(sys)) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: j.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ reply: 'Hi.' }) } }], usage }));
        return;
      }
      const pieces = piecesOf(answerOf(job, /This is a new chat/.test(sys)).full);
      st.brainOpen++; st.served++; st.brainMax = Math.max(st.brainMax, st.brainOpen);
      process.send({ t: 'open', job, at: Date.now() });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      let i = 0, timer = null, ended = false;
      const done = early => { if (ended) return; ended = true; clearTimeout(timer); st.brainOpen--; process.send({ t: early ? 'cut' : 'done', job, at: Date.now(), written: i }); };
      res.on('close', () => done(!res.writableEnded));
      const next = () => {
        if (res.destroyed) return;
        if (i >= pieces.length) { res.end(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`); return done(false); }
        res.write(`data: ${JSON.stringify({ model: j.model, choices: [{ delta: { content: pieces[i++] } }] })}\n\n`);
        timer = setTimeout(next, PIECE_MS);
      };
      timer = setTimeout(next, FIRST_MS);
    });
  });
  const voice = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', () => {
      st.voiceOpen++; st.voiceMax = Math.max(st.voiceMax, st.voiceOpen);
      let closed = false;
      const done = () => { if (!closed) { closed = true; st.voiceOpen--; } };
      res.on('close', done);
      if (req.url.endsWith('/audio/speech')) {
        const j = JSON.parse(Buffer.concat(chunks).toString());
        setTimeout(() => { st.spoke++; res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(Buffer.concat(Array.from({ length: framesFor(j.input.length) }, () => FRAME))); done(); }, SPEAK_MS);
        return;
      }
      const raw = Buffer.concat(chunks), at = raw.indexOf('RIFF');
      setTimeout(() => { st.heard++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: `heard ${at >= 0 ? raw.readUInt32LE(at + 40) : -1}` })); done(); }, HEAR_MS);
    });
  });
  let ready = 0;
  const up = () => { if (++ready === 2) process.send({ t: 'ready', brain: brain.address().port, voice: voice.address().port }); };
  brain.listen(0, '127.0.0.1', up); voice.listen(0, '127.0.0.1', up);
  process.on('message', m => { if (m === 'stats') process.send({ t: 'stats', ...st }); if (m === 'quit') { brain.close(); voice.close(); process.exit(0); } });
} else main().catch(e => { console.error(e); process.exit(1); });

async function main() {
  const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), p99: Math.round(q(0.99)), max: Math.round(s.at(-1) || 0) }; };
  const cpuOf = pid => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; } catch { return null; } };
  const svc = fork(fileURLToPath(import.meta.url), ['--fake', '--pieces', String(PIECES), '--piece-ms', String(PIECE_MS), '--first-ms', String(FIRST_MS), '--speak-ms', String(SPEAK_MS), '--hear-ms', String(HEAR_MS)],
    { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const atBrain = new Map();
  let svcStats = null;
  const ports = await new Promise(resolve => svc.on('message', m => {
    if (m.t === 'ready') resolve(m);
    else if (m.t === 'open') atBrain.set(m.job, { open: m.at });
    else if (m.t === 'cut' || m.t === 'done') Object.assign(atBrain.get(m.job) || {}, { [m.t]: m.at, written: m.written });
    else if (m.t === 'stats') svcStats = m;
  }));
  const svcNow = async () => { svcStats = null; svc.send('stats'); while (!svcStats) await sleep(10); return svcStats; };

  log(`starting a throwaway server: ${POP} residents, ${AGENTS} AI agents, ${VCHATS} voice-mode accounts, ${ACCOUNTS} voice accounts`);
  const s = await startServer({ population: POP, agents: AGENTS, timeoutMs: 240000, env: { MVW_PROVIDER_TEST: '1', MVW_WS_PER_ADDRESS: '1000', MVW_WS_MAX: '5000' } });
  const sockets = [];
  let exit = 1;
  try {
    const owner = await ownerSession(s), anon = httpClient(s.url);
    const brainC = await owner.post('/api/connections', { kind: 'models', label: 'Fake fast brain', scope: 'installation',
      config: { provider: 'custom', baseUrl: `http://127.0.0.1:${ports.brain}/v1`, model: 'fake-fast', priceInPerMTok: 0.1, priceOutPerMTok: 0.4 }, secrets: { apiKey: 'sk-chat-voice' } });
    if (brainC.status !== 200) throw new Error(`the brain connection: ${brainC.status} ${brainC.text}`);
    const voiceC = await owner.post('/api/connections', { kind: 'voice', label: 'Fake voice', scope: 'installation',
      config: { provider: 'custom', baseUrl: `http://127.0.0.1:${ports.voice}/v1`, speakModel: 'tts-1', voice: 'v1', speakPricePerMChars: 15, listenPricePerMinute: 0.006 }, secrets: { apiKey: 'sk-chat-voice' } });
    if (voiceC.status !== 200) throw new Error(`the voice connection: ${voiceC.status} ${voiceC.text}`);
    // (requests a minute per account: 240 here, as voice-stress - a voice-mode turn in this test is far shorter than a real one)
    const set = await owner.post('/api/settings', { values: { 'mind.chatPerDay': '5000', 'mind.dailyUsd': '100', 'voice.speakConnection': String(voiceC.json.id),
      'voice.listenConnection': String(voiceC.json.id), 'voice.perMinute': '240', 'voice.dailyUsd': '500' } });
    if (set.status !== 200) throw new Error(`settings: ${set.status} ${set.text}`);
    const link = async (c, id) => {
      const m = await c.post('/api/mind/agent', { agent: id, cadence: 'off' });
      if (m.status !== 200) throw new Error(`mind for agent ${id}: ${m.status} ${m.text}`);
      const r = await c.post('/api/agents/update', { id, connectionId: brainC.json.id, nativeId: 'mind' });
      if (r.status !== 200) throw new Error(`agent ${id}: ${r.status} ${r.text}`);
    };
    const agents = (await owner.get('/api/agents')).json.agents.slice(0, AGENTS);
    for (const a of agents) await link(owner, a.id);

    // what a browser sees: one socket per account (its chats' pieces and events)
    const runs = new Map();
    const runOf = id => { let r = runs.get(id); if (!r) runs.set(id, r = { deltas: 0, text: '' }); return r; };
    let frames = 0;
    async function socketFor(c) {
      const sock = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: c.cookie } });
      sockets.push(sock);
      sock.onmessage = e => {
        if (typeof e.data !== 'string' || !e.data.startsWith('{"t":"chat"')) return;
        const m = JSON.parse(e.data), r = runOf(m.run);
        frames++;
        if (m.delta?.text) { r.deltas++; r.text += m.delta.text; r.firstAt ??= Date.now(); r.onDelta?.(); }
        if (m.event?.type === 'run.end') { r.end = m.event; r.endAt = Date.now(); r.onEnd?.(); }
      };
      await new Promise((resolve, reject) => { sock.onopen = resolve; sock.onerror = () => reject(new Error('WebSocket error')); });
    }
    await socketFor(owner);
    const textChats = [];
    for (let k = 0; k < CHATS; k++) {
      const a = agents[k % agents.length];
      const r = await owner.post('/api/chat-sessions/create', { agent: a.id, label: `Load ${k}` });
      if (r.status !== 200) throw new Error(`session ${k}: ${r.status} ${r.text}`);
      textChats.push({ c: owner, agent: a.id, id: r.json.session.id, ends: [] });
    }
    // the voice-mode accounts: each an administrator with an agent of its own on the brain (its owner's chat)
    const voiceChats = [];
    for (let k = 0; k < VCHATS; k++) {
      const c = await userSession(s, owner, { login: `vm${k}`, displayName: `Voice mode ${k}`, role: 'admin' });
      const a = await c.post('/api/agents', { name: `Talker ${k}`, role: 'Assistant' });
      if (a.status !== 200) throw new Error(`agent of vm${k}: ${a.status} ${a.text}`);
      await link(c, a.json.id);
      const r = await c.post('/api/chat-sessions/create', { agent: a.json.id, label: 'New chat' });
      if (r.status !== 200) throw new Error(`session of vm${k}: ${r.status} ${r.text}`);
      await socketFor(c);
      voiceChats.push({ c, agent: a.json.id, id: r.json.session.id, ends: [] });
    }
    const people = [];
    for (let k = 0; k < ACCOUNTS; k++) people.push(await userSession(s, owner, { login: `va${k}`, displayName: `Voice ${k}`, role: 'member' }));
    log(`ready: ${CHATS} text chats, ${voiceChats.length} voice-mode chats, ${people.length} voice accounts`);

    const hpid = (() => { try { return Number(execFileSync('pgrep', ['-P', String(s.pid)], { encoding: 'utf8' }).trim().split('\n')[0]) || null; } catch { return null; } })();
    async function measure(seconds, during) {
      const h0 = (await anon.get('/api/health')).json, c0 = cpuOf(hpid), t0 = Date.now(), rtt = [];
      let stop = false;
      const poll = (async () => { while (!stop) { const a = Date.now(); await anon.get('/api/health'); rtt.push(Date.now() - a); await sleep(250); } })();
      await (during ? during(t0 + seconds * 1000) : sleep(seconds * 1000));
      stop = true; await poll;
      const h1 = (await anon.get('/api/health')).json, wall = (Date.now() - t0) / 1000, c1 = cpuOf(hpid);
      const cpu = ((h1.loop.cpuUs.user + h1.loop.cpuUs.system) - (h0.loop.cpuUs.user + h0.loop.cpuUs.system)) / 1e6, l = h1.loop;
      return { seconds: +wall.toFixed(1), tickMs: { mean: l.meanMs, p95: l.p95Ms, max: l.maxMs }, lateMs: { mean: l.late.meanMs, p95: l.late.p95Ms, max: l.late.maxMs },
        healthRttMs: stats(rtt), serverCpuPct: +(cpu / wall * 100).toFixed(1), helperCpuPct: c0 !== null && c1 !== null ? +((c1 - c0) / wall * 100).toFixed(1) : null, rssMb: l.rssMb, errors: h1.errors };
    }
    log(`baseline: ${BASE} s with nothing going on`);
    const base = await measure(BASE);
    log('  ', JSON.stringify(base));

    // ---------------------------------------------------------------- voice calls (shared by every flow)
    const v = { speak: [], hear: [], replay: [], respoken: 0, wrong: [], refused: [], seconds: 0 };
    async function speak(c, body) {
      const t0 = Date.now();
      const r = await fetch(new URL('/api/voice/speak', s.url), { method: 'POST', headers: { cookie: c.cookie, 'x-csrf-token': c.csrf, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const buf = Buffer.from(await r.arrayBuffer());
      const out = { ms: Date.now() - t0, status: r.status, buf, secs: Number(r.headers.get('x-voice-seconds')), cached: r.headers.get('x-voice-cached') === '1', parts: Number(r.headers.get('x-voice-parts')) || 1 };
      if (r.status !== 200) { v.refused.push(`speak ${r.status} ${buf.toString().slice(0, 100)}`); return out; }
      const kind = sniff(buf), real = audioSeconds(buf);
      if (!kind || kind.format !== 'mp3' || Math.abs(real - out.secs) > 0.02) v.wrong.push(`speak: ${kind?.format} ${real} vs ${out.secs} s`);
      if (out.cached) v.replay.push(out.ms); else { v.speak.push(out.ms); v.seconds += out.secs; }
      return out;
    }
    /** Checks that audio lasts what `text` takes to say (15 characters a second; the service sizes it so). */
    const lastsFor = (out, text, slack = 2) => { if (out.status === 200 && Math.abs(out.secs * CPS - text.length) > slack) v.wrong.push(`speak ${text.length} chars → ${out.secs} s`); };
    async function hear(c, secs) {
      const pcm = Math.round(secs * 16000) * 2, t0 = Date.now();
      const r = await c.request('POST', '/api/voice/transcribe?language=en', wavFromPcm(Buffer.alloc(pcm), { rate: 16000 }), { 'content-type': 'audio/wav' });
      if (r.status !== 200) { v.refused.push(`hear ${r.status} ${r.json?.code}`); return null; }
      if (r.json.text !== `heard ${pcm}` || Math.abs(r.json.seconds - pcm / 32000) > 0.01) v.wrong.push(`hear ${pcm} → ${r.json.text} ${r.json.seconds}`);
      v.hear.push(Date.now() - t0); v.seconds += r.json.seconds;
      return r.json.text;
    }

    // ---------------------------------------------------------------- a chat turn (text or voice mode)
    let job = 0, sent = 0;
    const refusals = [];
    const vm = { turns: 0, firstAudioAfterFirstPieceMs: [], firstAudioAfterSendMs: [], wrong: [], readAloud: 0, interrupted: 0 };
    async function turn(sess, { voiceMode = false } = {}) {
      const n = ++job, first = !sess.ends.length, stopAfter = Math.random() < STOP ? 5 + Math.floor(Math.random() * 36) : 0;
      let input = `Please answer job-${n}, with all the detail you have.`;
      if (voiceMode) {
        const talk = 1 + Math.random() * 3;
        await sleep(talk * 1000);   // (the person talking, recorded)
        const heard = await hear(sess.c, talk);
        if (heard === null) { await sleep(1000); return; }
        input = `Please answer job-${n}. (${heard})`;
      }
      const t0 = Date.now();
      const p = await sess.c.post('/api/providers/runs', { agent: sess.agent, session: sess.id, input });
      sent++;
      if (p.status !== 200) { refusals.push(`${p.status} ${p.json?.code}`); await sleep(1000); return; }
      const r = runOf(p.json.runId);
      Object.assign(r, { job: n, first, sentAt: t0, stopAfter, voiceMode });
      // voice mode: the answer so far cut at words into pieces (the first alone, up to SEG characters), two at once
      const said = [], queue = [];
      let cut = 0, speaking = 0, halted = false, firstAudio = null, drained = null;
      const pump = () => {
        while (!halted && speaking < 2 && queue.length) {
          const seg = queue.shift();
          speaking++;
          speak(sess.c, { agent: sess.agent, text: seg }).then(out => {
            if (out.status === 200) { lastsFor(out, speakable(seg)); firstAudio ??= Date.now(); }
          }).finally(() => { speaking--; pump(); if (!speaking && !queue.length) drained?.(); });
        }
      };
      const take = final => {
        const rest = r.text.slice(cut);
        let k = final ? rest.length : rest.lastIndexOf(' ', said.length ? SEG : 60);
        if (!final && rest.length < (said.length ? SEG : 60)) return;
        if (k <= 0) k = final ? rest.length : 0;
        const seg = rest.slice(0, k).trim();
        if (!seg) return;
        cut += k; said.push(seg); queue.push(seg); pump();
      };
      await new Promise(resolve => {
        r.onEnd = resolve;
        if (r.end) return resolve();
        r.onDelta = () => {
          if (stopAfter && !r.stopAt && r.deltas >= stopAfter) { r.stopAt = Date.now(); halted = true; queue.length = 0; sess.c.post('/api/providers/interrupt', { run: p.json.runId }); }
          if (voiceMode && !halted) take(false);
        };
        r.onDelta();
        setTimeout(resolve, 120000);
      });
      r.onDelta = r.onEnd = null;
      sess.ends.push(r);
      if (voiceMode) {
        vm.turns++;
        if (r.stopAt) vm.interrupted++;
        if (!halted && r.end?.status === 'ok') take(true);
        if (speaking || queue.length) await new Promise(res => { drained = res; });
        if (firstAudio && r.firstAt) { vm.firstAudioAfterFirstPieceMs.push(firstAudio - r.firstAt); vm.firstAudioAfterSendMs.push(firstAudio - t0); }
        const spoken = said.join(' ');
        if (r.end?.status === 'ok' && spoken !== r.end.text.replace(/\s+/g, ' ').trim()) vm.wrong.push(`job ${n}: spoken ${spoken.length} vs answer ${r.end.text.length} chars`);
        if (r.end?.status === 'stopped' && !r.end.text.replace(/\s+/g, ' ').startsWith(spoken)) vm.wrong.push(`job ${n}: spoken is not the start of what was kept`);
        // now and then 🔊 the whole answer again, from the transcript, part after part
        if (r.end?.status === 'ok' && Math.random() < 0.3) {
          const h = (await sess.c.get(`/api/providers/history?agent=${sess.agent}&session=${sess.id}`)).json?.messages || [];
          const m = h.filter(x => x.role === 'assistant').at(-1);
          if (!m || m.text !== r.end.text) vm.wrong.push(`job ${n}: the transcript's last answer is not this one`);
          else {
            let parts = 1, secs = 0;
            for (let k = 0; k < parts; k++) {
              const out = await speak(sess.c, { session: sess.id, message: m.id, part: k });
              if (out.status !== 200) break;
              parts = out.parts; secs += out.secs;
            }
            const want = speakable(m.text, Infinity).replace(/\s+/g, ' ').trim().length;
            if (Math.abs(secs * CPS - want) > parts + 2) vm.wrong.push(`job ${n}: read aloud ${Math.round(secs * CPS)} of ${want} chars`);
            vm.readAloud++;
          }
        }
        await sleep(500 + Math.random() * 2500);   // (listening to the end of it)
      } else await sleep(Math.random() * 300);
    }
    async function chatLoop(sess, until, opts) { while (Date.now() < until) await turn(sess, opts); }

    // ---------------------------------------------------------------- voice-only accounts (as voice-stress)
    let vn = 0;
    const words = ['city', 'market', 'river', '**bold**', '[link](https://x.org)', 'coffee', 'rent', 'plan', 'tomorrow', 'quietly', '`code`', 'garden'];
    async function voiceLoop(c, k, until) {
      let lastText = null;
      while (Date.now() < until) {
        const pick = Math.random();
        if (pick < 0.5) {
          const len = 30 + Math.floor(Math.random() * 120);
          const text = `Answer ${k}-${++vn}: ` + Array.from({ length: len }, (_, i) => words[(i * 7 + vn) % words.length]).join(' ') + '.';
          const out = await speak(c, { text });
          if (out.status !== 200) { await sleep(500); continue; }
          lastsFor(out, speakable(text));
          lastText = text;
        } else if (pick < 0.9) {
          if (await hear(c, Math.random() < 0.05 ? 60 : 2 + Math.random() * 10) === null) await sleep(500);
        } else if (lastText) {
          const out = await speak(c, { text: lastText });
          if (out.status === 200 && !out.cached) v.respoken++;
        }
        await sleep(Math.random() * 200);
      }
    }

    log(`load: ${CHATS} text chats + ${VCHATS} voice-mode chats (${CHAT_SLOTS} answered at once) + ${ACCOUNTS} accounts reading aloud and dictating (${VOICE_SLOTS} calls at the voice service at once), ${SECS} s`);
    const day0 = (await owner.get('/api/voice/overview')).json;
    const load = await measure(SECS, until => Promise.all([
      ...textChats.map((sess, k) => sleep(k * 20).then(() => chatLoop(sess, until))),
      ...voiceChats.map((sess, k) => sleep(k * 30).then(() => chatLoop(sess, until, { voiceMode: true }))),
      ...people.map((c, k) => sleep(k * 25).then(() => voiceLoop(c, k, until))),
    ]));
    log('  ', JSON.stringify(load));
    await sleep(500);
    const day = (await owner.get('/api/voice/overview')).json, fake = await svcNow();

    // ---------------------------------------------------------------- what arrived, and what the transcripts hold
    const all = [...runs.values()].filter(r => r.job), ended = all.filter(r => r.end);
    const ok = ended.filter(r => r.end.status === 'ok'), stopped = ended.filter(r => r.end.status === 'stopped'), other = ended.filter(r => !['ok', 'stopped'].includes(r.end.status));
    const wrong = [];
    for (const r of ok) {
      const want = answerOf(r.job, r.first).visible;
      if (r.end.text !== want) wrong.push(`job ${r.job}: ended text differs (${r.end.text.length} vs ${want.length})`);
      else if (r.text.trimEnd() !== want) wrong.push(`job ${r.job}: streamed text differs (${r.text.length} vs ${want.length})`);
      if (r.first && r.text.includes('mvw-actions')) wrong.push(`job ${r.job}: the hidden part was shown`);
    }
    const stopWrong = [], stopMs = [], cutMs = [];
    for (const r of stopped) {
      if (!answerOf(r.job, r.first).visible.startsWith(r.end.text)) stopWrong.push(`job ${r.job}: what was kept is not the start of the answer`);
      if (r.text.trimEnd() !== r.end.text) stopWrong.push(`job ${r.job}: streamed and kept differ`);
      if (r.stopAt) stopMs.push(r.endAt - r.stopAt);
      const b = atBrain.get(r.job);
      if (b?.cut && r.stopAt) cutMs.push(b.cut - r.stopAt);
    }
    const askedStop = all.filter(r => r.stopAt), notLetGo = askedStop.filter(r => !atBrain.get(r.job)?.cut && !atBrain.get(r.job)?.done);
    const lost = all.filter(r => !r.end);
    let transcriptsWrong = 0;
    for (const sess of [...textChats, ...voiceChats]) {
      const h = (await sess.c.get(`/api/providers/history?agent=${sess.agent}&session=${sess.id}`)).json.messages;
      const kept = h.filter(m => m.role === 'assistant').map(m => m.text), want = sess.ends.filter(r => r.end && r.end.text).map(r => r.end.text);
      if (kept.length !== want.length || kept.some((t, i) => t !== want[i])) transcriptsWrong++;
    }
    const logLines = (s.log().match(/^.*(error|warn|could not).*$/gim) || []).filter(l => !/licen[cs]e|presence|deprecated parameters/i.test(l));
    const report = {
      config: { population: POP, agents: AGENTS, textChats: CHATS, voiceChats: VCHATS, voiceAccounts: ACCOUNTS, seconds: SECS, pieces: PIECES, speakMs: SPEAK_MS, hearMs: HEAR_MS },
      chats: { sent, refused: refusals.length, refusals: [...new Set(refusals)], ended: ended.length, ok: ok.length, stopped: stopped.length, other: other.map(r => `${r.end.status}: ${r.end.error}`).slice(0, 5), lost: lost.length,
        perSecond: +(ended.length / load.seconds).toFixed(1), piecesPerSecond: Math.round(all.reduce((n, r) => n + r.deltas, 0) / load.seconds), framesPerSecond: Math.round(frames / load.seconds),
        firstPieceMs: stats(ok.concat(stopped).filter(r => r.firstAt).map(r => r.firstAt - r.sentAt)), wholeAnswerMs: stats(ok.map(r => r.endAt - r.sentAt)),
        wrong: wrong.slice(0, 5), wrongCount: wrong.length, transcriptsWrong },
      stop: { asked: askedStop.length, endedStopped: stopped.length, stopToEndMs: stats(stopMs), stopToBrainLetGoMs: stats(cutMs), brainNotLetGo: notLetGo.length, wrong: stopWrong.slice(0, 5) },
      voiceMode: { turns: vm.turns, interrupted: vm.interrupted, readAloudAgain: vm.readAloud, firstAudioAfterFirstPieceMs: stats(vm.firstAudioAfterFirstPieceMs), firstAudioAfterSendMs: stats(vm.firstAudioAfterSendMs), wrong: vm.wrong.slice(0, 5), wrongCount: vm.wrong.length },
      voice: { speak: stats(v.speak), hear: stats(v.hear), replay: stats(v.replay), respoken: v.respoken, wrong: v.wrong.slice(0, 5), wrongCount: v.wrong.length, refused: v.refused.slice(0, 5), refusedCount: v.refused.length,
        perSecond: +((v.speak.length + v.hear.length + v.replay.length) / load.seconds).toFixed(1) },
      services: { brain: { served: fake.served, mostAtOnce: fake.brainMax, openAtEnd: fake.brainOpen }, voice: { spoke: fake.spoke, heard: fake.heard, mostAtOnce: fake.voiceMax, openAtEnd: fake.voiceOpen } },
      server: { baseline: base, load, tickP95OverheadMs: +(load.tickMs.p95 - base.tickMs.p95).toFixed(2), lateP95OverheadMs: +(load.lateMs.p95 - base.lateMs.p95).toFixed(2),
        voiceCalls: day.calls - day0.calls, voiceCached: day.cached - day0.cached, voiceFailed: day.failed - day0.failed, inFlight: day.inFlight, waiting: day.waiting,
        meteredSeconds: Math.round(day.seconds - day0.seconds), heardAndSpoken: Math.round(v.seconds), logLines: logLines.slice(0, 8) },
    };
    const errs = h => h?.total ?? h ?? 0;
    const checks = {
      'every chat answer ended (none lost, none refused, no errors)': lost.length === 0 && refusals.length === 0 && other.length === 0,
      'every chat answer exact, the hidden part never shown': wrong.length === 0 && ok.length > 0,
      'every transcript holds every answer': transcriptsWrong === 0,
      'Stop ends the answer within 1 s (p99), keeps what was written': stopped.length > 0 && stats(stopMs).p99 < 1000 && stopWrong.length === 0,
      'Stop lets the brain go within 1 s (p99), every time': notLetGo.length === 0 && stats(cutMs).p99 < 1000,
      'voice mode: every word spoken once and in order, read aloud whole': vm.wrong.length === 0 && vm.turns > 0 && vm.readAloud > 0,
      'every audio and every heard text right': v.wrong.length === 0 && v.speak.length > 0 && v.hear.length > 0,
      'no voice request refused': v.refused.length === 0,
      [`never more than ${CHAT_SLOTS} chats at the brain, ${VOICE_SLOTS} calls at the voice service`]: fake.brainMax <= CHAT_SLOTS && fake.voiceMax <= VOICE_SLOTS,
      'nothing left in flight': fake.brainOpen === 0 && fake.voiceOpen === 0 && day.inFlight === 0 && day.waiting === 0,
      'every second heard or spoken metered': Math.abs(report.server.meteredSeconds - report.server.heardAndSpoken) <= Math.max(2, v.seconds * 0.0005),
      'no server errors': errs(load.errors) === errs(base.errors) && logLines.length === 0,
      'the main loop: tick p95 within 5 ms of idle': report.server.tickP95OverheadMs < 5,
      'the event loop: late p95 within 15 ms of idle, 250 ms at most': report.server.lateP95OverheadMs < 15 && load.lateMs.max < 250,
      'the server answers within 100 ms (p95)': load.healthRttMs.p95 < 100,
    };
    report.checks = checks;
    console.log(JSON.stringify(report, null, 2));
    for (const [k, ok2] of Object.entries(checks)) log(`${ok2 ? 'ok  ' : 'FAIL'} ${k}`);
    exit = Object.values(checks).every(Boolean) ? 0 : 1;
    log(exit ? 'FAIL' : 'PASS');
    if (o.json) fs.writeFileSync(o.json, JSON.stringify({ ...report, pass: !exit }, null, 2));
  } finally {
    for (const w of sockets) try { w.close(); } catch { /* closed */ }
    await s.stop();
    svc.send('quit');
  }
  process.exit(exit);
}
