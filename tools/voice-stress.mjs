#!/usr/bin/env node
// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice under load, end to end (docs/features/CHAT.md §9): a throwaway server with a city of `population` residents and
// `accounts` signed-in people, the installation's voice service a fake OpenAI-compatible server in a process of its own
// (it answers after `speak-ms` / `hear-ms`, as a real one does, and sends MP3 sized to the text: ≈ 15 characters a second
// at 128 kbit/s). For `seconds` every account keeps asking at once: read aloud (200–900 characters of Markdown, never the
// same twice), dictation (a 2–12 s WAV recording, now and then a 60 s one), now and then a replay of what it just heard
// (the cache, while it still holds it) - over HTTP, through the routes, the Voice service, the provider helper and its IPC (audio as base64 both
// ways). Measured on the server: the main loop's tick and how late each tick started (/api/health loop.late), the
// server's and the helper's CPU, memory, the health round trip; at the people: each answer's time; at the service: calls
// at once. Checked: every answer is right (the audio is MP3 and lasts what the service made, the text is what it heard),
// never more than 32 calls at the service at once (the rest wait their turn, none refused), the day's meter counts every
// second, nothing left in flight, no error.
// Usage: node tools/voice-stress.mjs [--population 2000] [--accounts 40] [--seconds 60] [--baseline 30] [--speak-ms 350]
//        [--hear-ms 250] [--json <out.json>]
import { parseArgs } from 'node:util';
import { fork, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import { startServer, ownerSession, userSession, httpClient } from './lib/testserver.mjs';
import { sniff, seconds as audioSeconds, wavFromPcm } from '../server/voice/audio.js';

const { values: o } = parseArgs({ options: {
  population: { type: 'string', default: '2000' }, accounts: { type: 'string', default: '40' }, seconds: { type: 'string', default: '60' },
  baseline: { type: 'string', default: '30' }, 'speak-ms': { type: 'string', default: '350' }, 'hear-ms': { type: 'string', default: '250' },
  json: { type: 'string' }, 'fake-voice': { type: 'boolean', default: false },
} });
const POP = +o.population, ACCOUNTS = +o.accounts, SECS = +o.seconds, BASE = +o.baseline, SPEAK_MS = +o['speak-ms'], HEAR_MS = +o['hear-ms'];
const SLOTS = 32;   // server/voice/voice.js MAX_AT_ONCE
const FRAME = (() => { const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x64; return f; })();
const framesFor = chars => Math.max(1, Math.round(chars / 15 * 44100 / 1152));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------------ the fake voice service (its own process)
if (o['fake-voice']) {
  let open = 0, maxOpen = 0, spoke = 0, heard = 0;
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', () => {
      open++; maxOpen = Math.max(maxOpen, open);
      const done = () => { open--; };
      if (req.url.endsWith('/audio/speech')) {
        const j = JSON.parse(Buffer.concat(chunks).toString());
        setTimeout(() => { spoke++; res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(Buffer.concat(Array.from({ length: framesFor(j.input.length) }, () => FRAME))); done(); }, SPEAK_MS);
        return;
      }
      // a recording: say how many bytes of audio came (the multipart's file), so the answer can be checked
      const raw = Buffer.concat(chunks), at = raw.indexOf('RIFF');
      setTimeout(() => { heard++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: `heard ${at >= 0 ? raw.readUInt32LE(at + 40) : -1}` })); done(); }, HEAR_MS);
    });
  }).listen(0, '127.0.0.1', () => process.send({ t: 'ready', port: srv.address().port }));
  process.on('message', m => { if (m === 'stats') process.send({ t: 'stats', maxOpen, open, spoke, heard }); });
} else main().catch(e => { console.error(e); process.exit(1); });

async function main() {
  const stats = arr => { const s = [...arr].sort((a, b) => a - b), q = p => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0); return { n: s.length, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), p99: Math.round(q(0.99)), max: Math.round(s.at(-1) || 0) }; };
  const cpuOf = pid => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return (Number(f[11]) + Number(f[12])) / 100; } catch { return null; } };
  const svc = fork(fileURLToPath(import.meta.url), ['--fake-voice', '--speak-ms', String(SPEAK_MS), '--hear-ms', String(HEAR_MS)], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  let svcStats = null;
  const port = await new Promise(resolve => svc.on('message', m => { if (m.t === 'ready') resolve(m.port); else if (m.t === 'stats') svcStats = m; }));
  const svcNow = async () => { svcStats = null; svc.send('stats'); while (!svcStats) await sleep(10); return svcStats; };

  log(`starting a throwaway server: ${POP} residents, ${ACCOUNTS} accounts`);
  const s = await startServer({ population: POP, agents: 3, timeoutMs: 180000, env: { MVW_PROVIDER_TEST: '1' } });
  let exit = 1;
  try {
    const owner = await ownerSession(s), anon = httpClient(s.url);
    const c = await owner.post('/api/connections', { kind: 'voice', label: 'Fake voice', scope: 'installation',
      config: { provider: 'custom', baseUrl: `http://127.0.0.1:${port}/v1`, speakModel: 'tts-1', voice: 'v1', speakPricePerMChars: 15, listenPricePerMinute: 0.006 }, secrets: { apiKey: 'sk-voice-stress' } });
    if (c.status !== 200) throw new Error(`the voice connection: ${c.status} ${c.text}`);
    const set = await owner.post('/api/settings', { values: { 'voice.speakConnection': String(c.json.id), 'voice.listenConnection': String(c.json.id), 'voice.perMinute': '240', 'voice.dailyUsd': '500' } });
    if (set.status !== 200) throw new Error(`settings: ${set.status} ${set.text}`);
    const people = [owner];
    for (let k = 1; k < ACCOUNTS; k++) people.push(await userSession(s, owner, { login: `v${k}`, displayName: `Voice ${k}`, role: 'member' }));
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
    log(`baseline: ${BASE} s with no voice`);
    const base = await measure(BASE);
    log('  ', JSON.stringify(base));

    const res = { speak: [], hear: [], replay: [], respoken: 0, wrong: [], refused: [], seconds: 0 };
    let n = 0;
    const words = ['city', 'market', 'river', '**bold**', '[link](https://x.org)', 'coffee', 'rent', 'plan', 'tomorrow', 'quietly', '`code`', 'garden'];
    async function speakOnce(c, text) {
      const t0 = Date.now();
      const r = await fetch(new URL('/api/voice/speak', s.url), { method: 'POST', headers: { cookie: c.cookie, 'x-csrf-token': c.csrf, 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      const buf = Buffer.from(await r.arrayBuffer());
      return { ms: Date.now() - t0, status: r.status, buf, headers: r.headers };
    }
    async function loop(c, k, until) {
      let lastText = null;
      while (Date.now() < until) {
        const pick = Math.random();
        if (pick < 0.5) {
          const len = 30 + Math.floor(Math.random() * 120);
          const text = `Answer ${k}-${++n}: ` + Array.from({ length: len }, (_, i) => words[(i * 7 + n) % words.length]).join(' ') + '.';
          const r = await speakOnce(c, text);
          if (r.status !== 200) { res.refused.push(`speak ${r.status} ${r.buf.toString().slice(0, 120)}`); await sleep(500); continue; }
          const secs = Number(r.headers.get('x-voice-seconds')), kind = sniff(r.buf), real = audioSeconds(r.buf);
          const spokenChars = Math.round(Number(secs) * 15);   // (what the service made: 15 characters a second)
          if (!kind || kind.format !== 'mp3' || Math.abs(real - secs) > 0.02 || Math.abs(spokenChars - (text.replace(/[*`[\]]|\(https:\/\/x\.org\)/g, '').length)) > 40) res.wrong.push(`speak ${text.length} → ${secs} s`);
          res.speak.push(r.ms); res.seconds += secs; lastText = text;
        } else if (pick < 0.9) {
          const secs = Math.random() < 0.05 ? 60 : 2 + Math.random() * 10, pcm = Math.round(secs * 16000) * 2;
          const t0 = Date.now();
          const r = await c.request('POST', '/api/voice/transcribe?language=en', wavFromPcm(Buffer.alloc(pcm), { rate: 16000 }), { 'content-type': 'audio/wav' });
          if (r.status !== 200) { res.refused.push(`hear ${r.status} ${r.json?.code}`); await sleep(500); continue; }
          if (r.json.text !== `heard ${pcm}` || Math.abs(r.json.seconds - pcm / 32000) > 0.01) res.wrong.push(`hear ${pcm} → ${r.json.text} ${r.json.seconds}`);
          res.hear.push(Date.now() - t0); res.seconds += r.json.seconds;
        } else if (lastText) {
          // a replay: from the cache when it is still there (others' newer answers push the oldest out), else spoken again
          const r = await speakOnce(c, lastText);
          if (r.status !== 200 || !sniff(r.buf)) { res.wrong.push(`replay ${r.status}`); continue; }
          if (r.headers.get('x-voice-cached') === '1') res.replay.push(r.ms);
          else { res.respoken++; res.seconds += Number(r.headers.get('x-voice-seconds')); }
        }
        await sleep(Math.random() * 200);
      }
    }
    log(`load: ${ACCOUNTS} people reading aloud and dictating at once for ${SECS} s (${SLOTS} calls at the service at once, the rest wait their turn)`);
    const day0 = (await owner.get('/api/voice/overview')).json;
    const load = await measure(SECS, until => Promise.all(people.map((c, k) => sleep(k * 25).then(() => loop(c, k, until)))));
    log('  ', JSON.stringify(load));
    await sleep(300);
    const day = (await owner.get('/api/voice/overview')).json, svcEnd = await svcNow();
    const report = {
      config: { population: POP, accounts: ACCOUNTS, seconds: SECS, speakMs: SPEAK_MS, hearMs: HEAR_MS },
      baseline: base, load,
      answers: { speak: stats(res.speak), hear: stats(res.hear), replay: stats(res.replay), replayRespoken: res.respoken, wrong: res.wrong.length, refused: res.refused.length, perSecond: +((res.speak.length + res.hear.length + res.replay.length) / load.seconds).toFixed(1) },
      service: { maxAtOnce: svcEnd.maxOpen, spoke: svcEnd.spoke, heard: svcEnd.heard, openAtEnd: svcEnd.open },
      server: { calls: day.calls - day0.calls, cached: day.cached - day0.cached, failed: day.failed, inFlight: day.inFlight, waiting: day.waiting, meteredSeconds: Math.round(day.seconds - day0.seconds), heardAndSpoken: Math.round(res.seconds) },
    };
    const checks = {
      'every answer right': res.wrong.length === 0,
      'none refused': res.refused.length === 0,
      [`at most ${SLOTS} at the service at once`]: svcEnd.maxOpen <= SLOTS,
      'nothing left in flight': day.inFlight === 0 && day.waiting === 0 && svcEnd.open === 0,
      'every second metered': Math.abs(report.server.meteredSeconds - report.server.heardAndSpoken) <= 2,
      'no server errors': (load.errors?.total ?? load.errors ?? 0) === (base.errors?.total ?? base.errors ?? 0),
      'the main loop unharmed (tick p95 within 5 ms of the baseline)': load.tickMs.p95 <= base.tickMs.p95 + 5,
      'the event loop unharmed (late p95 within 15 ms of the baseline)': load.lateMs.p95 <= base.lateMs.p95 + 15,
      'health answers within 100 ms (p95)': load.healthRttMs.p95 <= 100,
    };
    report.checks = checks;
    const pass = Object.values(checks).every(Boolean);
    log(JSON.stringify(report.answers)); log(JSON.stringify(report.service)); log(JSON.stringify(report.server));
    for (const [k, v] of Object.entries(checks)) log(`${v ? 'ok  ' : 'FAIL'} ${k}`);
    if (res.wrong.length) log('wrong:', res.wrong.slice(0, 5).join(' | '));
    if (res.refused.length) log('refused:', res.refused.slice(0, 5).join(' | '));
    log(pass ? 'PASS' : 'FAIL');
    if (o.json) fs.writeFileSync(o.json, JSON.stringify({ ...report, pass }, null, 2));
    exit = pass ? 0 : 1;
  } finally { await s.stop(); svc.kill(); }
  process.exit(exit);
}
