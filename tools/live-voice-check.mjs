#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Live voice in a real browser, a recorded voice for its microphone (docs/features/CHAT.md §9.4; client/js/ui/voice.js
// LiveEar, voice-core.js TurnTaker): someone who talks slowly and stops to think mid-sentence is heard as ONE turn; a pause
// after "and…" waits longer than one after a finished sentence; a turn may last minutes; a second turn after the answer is
// heard; the companions' Live voice (no chat window) does the same. The brain is a fake that keeps what it was asked; the
// voice service that hears is a fake that decodes what it is sent and answers with the words spoken in it (the script, as
// far as the audio goes — so the words of a pause checked mid-turn are real prefixes of the recording) — or, with --stt, a
// real one.
// Usage: node tools/live-voice-check.mjs --tts http://host:8880/v1 [--tts-model kokoro] [--voice am_michael]
//          [--stt http://host:8002/v1 --stt-model M] [--out DIR] [scenario ...]
//   scenarios: slow slow-plain slow-relaxed long two dock (all when none is named)
// --tts: any OpenAI-compatible speech service, to make the recorded voice once (kept in OUT/fixtures).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(opt('--out', path.join(ROOT, 'checks', 'live-voice')));
const TTS = opt('--tts'), TTS_MODEL = opt('--tts-model', 'kokoro'), VOICE = opt('--voice', 'am_michael'), STT = opt('--stt'), STT_MODEL = opt('--stt-model', 'whisper-1');
const named = argv.filter((a, k) => !a.startsWith('--') && !(argv[k - 1] || '').startsWith('--'));
fs.mkdirSync(path.join(OUT, 'fixtures'), { recursive: true });
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails.push(what); return ok; };
const RATE = 48000;

// ------------------------------------------------------------------------------------------------ the recorded voice
const P = {
  a: 'So tomorrow I was thinking we could go down to the harbor and',
  b: 'maybe take the boat out to the old lighthouse',
  c: 'because I have never really seen it from the water.',
  q1: 'What is that tall building over there?',
  q2: 'And who do you think lives in it?',
  m1: 'I went to the market this morning.',
  m2: 'And I found the bread you like so much.',
};
const LONG = ['I want to tell you about my week.', 'On Monday I went to the market early.', 'The bread there was still warm.', 'On Tuesday it rained the whole day.',
  'I stayed in and read a book about ships.', 'On Wednesday I met an old friend for lunch.', 'We talked about the summer we spent by the sea.', 'On Thursday I fixed the bike.',
  'It took me most of the afternoon.', 'On Friday we watched the boats come in.', 'The harbor was full of gulls.', 'And today I just wanted to talk to you.'];
// a script: phrases (keys of P, or text) and pauses (ms); `words` is what the fake hears for each spoken piece, in order.
// (the browser's recorded voice starts as the microphone opens; the page says "Listening" a moment later — on a loaded
//  machine several seconds — and nothing is said before it, as a person would wait for it)
const LEAD = Number(opt('--lead', '14000'));
const SCRIPTS = {
  slow: [LEAD, 'a', 1900, 'b,', 2100, 'c', 7000],
  long: [LEAD, ...LONG.flatMap(t => [t, 900]).slice(0, -1), 7000],
  two: [LEAD, 'q1', 9000, 'q2', 7000],
  more: [LEAD, 'm1', 4200, 'm2', 9000],
};
const text = k => (k.endsWith(',') ? `${P[k.slice(0, -1)] || k.slice(0, -1)},` : P[k] || k);

async function tts(t) {
  const f = path.join(OUT, 'fixtures', crypto.createHash('sha1').update(`${TTS_MODEL}|${VOICE}|${t}|trimmed`).digest('hex').slice(0, 16) + '.wav');
  if (fs.existsSync(f)) return f;
  if (!TTS) throw new Error(`No recorded voice for "${t}": give --tts http://host/v1 (an OpenAI-compatible speech service) once`);
  const r = await fetch(`${TTS.replace(/\/$/, '')}/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: TTS_MODEL, input: t.replace(/,$/, ''), voice: VOICE, speed: 0.85, response_format: 'wav' }) });
  if (!r.ok) throw new Error(`speech service: ${r.status} ${await r.text()}`);
  const raw = f + '.in';
  fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  // (the service's own quiet before and after the words taken off: the script's pauses are the pauses heard)
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse';
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af', trim, '-ac', '1', '-ar', String(RATE), '-sample_fmt', 's16', f]);
  fs.rmSync(raw);
  return f;
}
/** The script as one WAV (a quiet room's hiss under it all): { file, spoken: [[start ms, end ms, text]], ms }. */
async function build(name) {
  const parts = [], spoken = [];
  let t = 0;
  for (const x of SCRIPTS[name]) {
    if (typeof x === 'number') { parts.push(Buffer.alloc(Math.round(x * RATE / 1000) * 2)); t += x; continue; }
    const w = fs.readFileSync(await tts(text(x)));
    const pcm = w.subarray(w.indexOf('data') + 8);
    parts.push(pcm);
    const ms = pcm.length / 2 / RATE * 1000;
    spoken.push([t, t + ms, text(x)]); t += ms;
  }
  const pcm = Buffer.concat(parts);
  // (a quiet room: a little hiss everywhere — a microphone is never silent)
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, pcm.readInt16LE(i) + Math.round((Math.random() - 0.5) * 60))), i);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + pcm.length, 4); head.write('WAVE', 8); head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(pcm.length, 40);
  const file = path.join(OUT, `${name}.wav`);
  fs.writeFileSync(file, Buffer.concat([head, pcm]));
  return { file, spoken, ms: t, mask: voiced(envelope(pcm, RATE)) };
}

// ------------------------------------------------------------------------------------------------ the fakes
/** Loudness every 20 ms of 16-bit mono PCM. */
function envelope(pcm, rate) {
  const frame = Math.round(rate / 50), lv = [];
  for (let i = 0; i + frame * 2 <= pcm.length; i += frame * 2) { let s = 0; for (let k = 0; k < frame; k++) { const v = pcm.readInt16LE(i + k * 2) / 32768; s += v * v; } lv.push(Math.sqrt(s / frame)); }
  return lv;
}
/** Which 20 ms are voice (1) or not (0), against the recording's own quiet. */
function voiced(lv) {
  const floor = [...lv].sort((a, b) => a - b)[Math.floor(lv.length * 0.2)] || 0, thr = Math.max(0.008, floor * 4);
  return lv.map(v => (v > thr ? 1 : 0));
}
/**
 * What a recording the page sent says, as the voice service would hear it: it is decoded, found in the script's recording
 * (where its voice and quiet line up best), and the pieces of the script it covers are its words.
 */
function hearIt(buf) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { input: buf, maxBuffer: 64 << 20 });
  const lv = envelope(r.stdout || Buffer.alloc(0), 16000), R = voiced(lv), F = current.mask;
  let best = -Infinity, at = 0;
  for (let o = 0; o <= F.length; o++) {
    let sc = 0;
    for (let i = 0; i < R.length; i++) { const f = F[o + i] ?? 0; sc += R[i] && f ? 1 : R[i] !== f ? -0.5 : 0; }
    if (sc > best) { best = sc; at = o; }
  }
  const from = at * 20, to = (at + R.length) * 20;
  const text = current.spoken.filter(([a, b]) => Math.min(b, to) - Math.max(a, from) >= (b - a) * 0.6).map(x => x[2]).join(' ');
  return { text, seconds: R.length * 0.02, from, to, error: r.status ? String(r.stderr).slice(0, 200) : '' };
}
const heard = [], asked = [], answered = [];
let words = [], current = { mask: [], spoken: [] }, brainDelay = 0;   // (the scenario's spoken pieces, in order; its recording)
const SILENT = (() => { const n = 4800, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', d => chunks.push(d));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
    if (req.url.endsWith('/audio/speech')) { res.setHeader('content-type', 'audio/wav'); res.end(SILENT); return; }
    if (req.url.endsWith('/audio/transcriptions')) {
      const type = req.headers['content-type'] || '', bd = (/boundary=([^;]+)/.exec(type) || [])[1];
      let file = Buffer.alloc(0);
      if (bd) {
        const sep = Buffer.from(`--${bd}`);
        let i = body.indexOf(sep);
        while (i >= 0) {
          const j = body.indexOf(sep, i + sep.length);
          const part = body.subarray(i + sep.length, j < 0 ? body.length : j);
          const he = part.indexOf('\r\n\r\n');
          if (he > 0 && /name="file"/.test(part.subarray(0, he).toString())) file = part.subarray(he + 4, part.length - 2);
          i = j;
        }
      }
      const p = hearIt(file);
      heard.push({ at: Date.now(), bytes: file.length, ...p });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: p.text, duration: p.seconds }));
      return;
    }
    // the brain: what the person said is at the end of the last thing it was asked
    let j = {};
    try { j = JSON.parse(body.toString() || '{}'); } catch { }
    const last = [...(j.messages || [])].reverse().find(m => m.role === 'user');
    const said = last ? (typeof last.content === 'string' ? last.content : (last.content || []).map(x => x.text || '').join(' ')) : '';
    asked.push({ at: Date.now(), said });
    const content = 'Sounds good.';
    // (an answer that takes a while to think: a person may go on talking meanwhile)
    if (brainDelay) { const t = setTimeout(() => answer(), brainDelay); req.on('close', () => clearTimeout(t)); return; }
    answer();
    function answer() {
    if (res.destroyed) return;
    answered.push({ at: Date.now(), said });
    res.setHeader('content-type', 'application/json');
    if (!j.stream) { res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 3 } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ model: 'fake', choices: [{ delta: { content } }] }) + '\n\n');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } }) + '\n\ndata: [DONE]\n\n');
    }
  });
}).listen(0, '127.0.0.1');
await new Promise(r => fake.on('listening', r));
const base = `http://127.0.0.1:${fake.address().port}/v1`;

// ------------------------------------------------------------------------------------------------ the scenarios
const ALL = {
  slow: { script: 'slow', prefs: {}, turns: 1, why: 'pauses of 1.9 s after "…harbor and" and 2.1 s after "…lighthouse," — one turn' },
  'slow-plain': { script: 'slow', prefs: { smart: false }, cut: true, why: 'the same pauses with the words not checked and a normal patience: the first pause ends the turn (what the check and patience prevent)' },
  'slow-relaxed': { script: 'slow', prefs: { smart: false, patience: 'relaxed' }, turns: 1, why: 'a relaxed patience alone carries the same pauses' },
  long: { script: 'long', prefs: {}, turns: 1, why: 'about 80 seconds of talking in one turn (it used to stop at 60)' },
  two: { script: 'two', prefs: {}, turns: 2, why: 'a question, its answer, then another question: both heard, each answered' },
  dock: { script: 'slow', prefs: {}, turns: 1, dock: true, why: 'the companions\' Live voice, no chat window: one turn' },
  more: { script: 'more', prefs: {}, more: true, brainDelay: 6000, why: 'a finished sentence, a 4.2 s pause, then more while the answer is thought: the answer stops and the rest is heard' },
  'dock-more': { script: 'more', prefs: {}, more: true, brainDelay: 6000, dock: true, why: 'the same in the companions\' Live voice' },
};
const which = named.length ? named : Object.keys(ALL);

const s = await startServer({ population: 120, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
let browser = null;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  const brain = (await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: { apiKey: 'sk-test' } })).json.id;
  const ears = await owner.post('/api/connections', { kind: 'voice', label: 'Test ears', scope: 'installation',
    config: STT ? { provider: 'custom', baseUrl: STT, listenModel: STT_MODEL, does: 'listen' } : { provider: 'custom', baseUrl: base, speakModel: 'tts-1', listenModel: 'fake-asr', voice: 'v1' }, secrets: { apiKey: 'sk-test' } });
  check(ears.status === 200, 'a voice service that hears: ' + (STT ? STT : 'the fake') + (ears.status === 200 ? '' : ' — ' + ears.text));
  const mouth = STT ? (await owner.post('/api/connections', { kind: 'voice', label: 'Test mouth', scope: 'installation', config: { provider: 'custom', baseUrl: base, speakModel: 'tts-1', voice: 'v1', does: 'speak' }, secrets: { apiKey: 'sk-test' } })).json.id : ears.json.id;
  await owner.post('/api/settings', { values: { 'voice.enabled': true, 'voice.listenConnection': String(ears.json.id), 'voice.speakConnection': String(mouth), 'voice.perMinute': '240' } });
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) {
    await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' });
    await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
    await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' });
  }
  for (const name of which) {
    const sc = ALL[name];
    if (!sc) { check(false, 'no scenario ' + name); continue; }
    const fx = await build(sc.script);
    console.log(`— ${name}: ${sc.why} (${Math.round(fx.ms / 1000)} s of recording)`);
    words = fx.spoken.map(x => x[2]); current = fx; brainDelay = sc.brainDelay || 0;
    await owner.post('/api/voice/prefs', { listen: { patience: 'normal', smart: true, learn: false, ...sc.prefs } });
    browser = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fx.file}%noloop`, '--autoplay-policy=no-user-gesture-required']);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); if (process.env.LV_DEBUG && /^\[voice\]/.test(m.text()) && !/\] · /.test(m.text())) console.log('    [page] ' + m.text().slice(0, 300)); });
    await page.goto(s.url + '/?q=low', { waitUntil: 'load' });
    await page.evaluate(async pw => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: pw }) }), owner.password);
    if (process.env.LV_DEBUG) await page.evaluate(() => localStorage.setItem('mvw.voice.debug', '1'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 180000, polling: 500 });
    await sleep(1500);
    const n0 = asked.length, h0 = heard.length, a0 = answered.length;
    if (sc.dock) {
      const fol = await page.evaluate(async id => { const n = await import('/js/core/net.js'); try { return await n.post('/api/companions', { agent: id, action: 'follow', target: 'me' }); } catch (e) { return { error: e.message }; } }, agents[0].id);
      check(fol && fol.ok === true, 'a companion taken along');
      await page.waitForFunction(() => { const d = document.querySelector('#cv-dock'); return d && !d.classList.contains('none') && !d.querySelector('.cv-mic').disabled; }, null, { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => document.querySelector('#cv-dock .cv-way').click());
      await page.evaluate(() => document.querySelector('.cv-menu [data-mode="live"]').click());
    } else {
      await page.evaluate(id => window.__mvw.chat.open(id), agents[0].id);
      await page.waitForFunction(() => document.querySelector('.chatwin .cw-vm:not(.hidden)'), null, { timeout: 20000 });
      await sleep(600);
      await page.evaluate(() => document.querySelector('.chatwin .cw-vm').click());
    }
    const t0 = Date.now();
    // the recording plays out; then a moment for the last answer
    const states = [];
    // (until the recording has played out and the turns wanted have come — a loaded machine is slow — then a moment more for
    //  any turn too many)
    const want = sc.turns || 1, norm0 = t => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
    const got = () => asked.slice(n0).filter(x => words.some(w => norm0(x.said).includes(norm0(w).trim()))).length;
    let until = t0 + fx.ms + 45000, settled = 0;
    while (Date.now() < until) {
      const lastIn = !sc.more || asked.slice(n0).some(x => norm0(x.said).includes(norm0(words.at(-1)).trim()));
      if (!settled && Date.now() > t0 + fx.ms && got() >= want && lastIn) { settled = Date.now(); until = Math.min(until, settled + 6000); }
      states.push(await page.evaluate(() => (document.querySelector('.cw-vm-state')?.dataset.state || document.querySelector('#cv-dock .cv-status')?.textContent || '')).catch(() => '?'));
      await sleep(500);
    }
    // (what was said, matched without case or punctuation: a real voice service writes them its own way)
    const norm = t => String(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const has = (t, w) => norm(t).includes(norm(w));
    const turns = asked.slice(n0).map(x => x.said).filter(t => words.some(w => has(t, w)));
    const checks = heard.slice(h0);
    console.log(`    ${turns.length} turn(s) asked; the voice service heard ${checks.length} time(s): ${checks.map(x => `${(x.from / 1000).toFixed(1)}–${(x.to / 1000).toFixed(1)} s "${x.text.slice(-28)}"`).join(' · ')}`);
    for (const t of turns) console.log('    > ' + t.replace(/\s+/g, ' ').slice(-220));
    if (process.env.LV_DEBUG) {
      const ss = (await owner.get(`/api/chat-sessions?agent=${agents[0].id}`)).json?.sessions || [];
      for (const x of ss.slice(0, 2)) { const h = (await owner.get(`/api/providers/history?agent=${agents[0].id}&session=${x.id}`)).json; console.log('    chat: ' + JSON.stringify((h?.messages || []).slice(-6).map(m => [m.role, m.status || '', String(m.text || '').slice(-60)]))); }
    }
    if (process.env.LV_DEBUG) { console.log('    states: ' + states.join(' ')); console.log('    asked: ' + JSON.stringify(asked.slice(n0).map(x => x.said.slice(-160)))); }
    if (sc.more) {
      // (the first part may reach it alone — its answer stopped — or with the rest when no answer had begun: either way all
      //  of it reaches it, the rest last, and no answer to the first part alone is heard)
      check(turns.length >= 1 && words.every(w => turns.some(t => has(t, w))) && has(turns.at(-1), words.at(-1)), `${name}: all of it reached the agent, the rest last (${turns.length} message(s))`);
      check(answered.slice(a0).length <= 1, `${name}: the answer to the first part alone was stopped (${answered.slice(a0).length} answer(s) given)`);
    } else if (sc.cut) check(turns.length >= 1 && has(turns[0], words[0]) && !has(turns[0], words[1]), `${name}: the first turn ended at the first pause`);
    else check(turns.length === sc.turns, `${name}: ${turns.length} turn(s), want ${sc.turns}`);
    if (sc.turns === 1 && turns[0]) check(words.every(w => has(turns[0], w)), `${name}: the one turn holds everything said`);
    if (sc.turns > 1 && turns.length === sc.turns) check(turns.every((t, k) => has(t, words[k]) && (k === 0 || !has(t, words[k - 1]))), `${name}: each piece in its own turn, in order`);
    check(errors.length === 0, errors.length ? 'page errors: ' + errors.slice(0, 2).join(' | ') : `${name}: no page or console errors`);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await ctx.close(); await browser.close(); browser = null;
  }
} finally {
  try { await browser?.close(); } catch { }
  await s?.stop(); fake.close();
}
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall checks passed');
