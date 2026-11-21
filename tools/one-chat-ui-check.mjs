#!/usr/bin/env node
// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One conversation with an agent, in a real browser (client/js/ui/chat.js current; server/chat/sessions.js current;
// server/companions/outings.js): the companions' voice row, E face to face (ui/talk-bar.js to — what the E key calls) and
// the chat window all land in the same chat — the one last written in, or the one the window shows (a New chat there too)
// — and none starts one by itself; an outing's dividers show in the window, the end one as it happens; an answer through
// the voice row shows in a speech bubble over the agent's head (once, with the window showing it too); a name heard by
// sound ("Lera" for Lara, "Simon" for Sam) reaches the right companion; a line said to the group is marked so.
// The brain and the voice service (hearing and speaking) are fakes: what the microphone heard is set before each press.
// The headless browser here is slow (software rendering): every step waits for its state.
// Usage: node tools/one-chat-ui-check.mjs [--out DIR]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2), oi = argv.indexOf('--out');
const OUT = oi >= 0 ? path.resolve(argv[oi + 1]) : path.join(ROOT, 'checks', 'one-chat');
fs.mkdirSync(OUT, { recursive: true });
const { startServer, ownerSession } = await import(path.join(ROOT, 'tools/lib/testserver.mjs'));
const { launch } = createRequire(import.meta.url)(path.join(ROOT, 'tools/lib/browser.cjs'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = [], check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails.push(what); return ok; };

// ------------------------------------------------------------------------------------------------ the fakes
const SILENT = (() => { const n = 4800, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); return b; })();
let heardNext = '';           // what the microphone "said" on the next press
const asked = [];             // what the brain was asked (the person's last words)
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', d => chunks.push(d));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (req.url.endsWith('/models')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
    if (req.url.endsWith('/audio/speech')) { res.setHeader('content-type', 'audio/wav'); res.end(SILENT); return; }
    if (req.url.endsWith('/audio/transcriptions')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: heardNext, duration: 1.5 })); return; }
    let j = {};
    try { j = JSON.parse(body.toString() || '{}'); } catch { }
    const last = [...(j.messages || [])].reverse().find(m => m.role === 'user');
    const said = last ? (typeof last.content === 'string' ? last.content : (last.content || []).map(x => x.text || '').join(' ')) : '';
    asked.push({ said, all: JSON.stringify(j.messages || []) });
    // (each answer says what it answers: the person's words, without the note about its body before them)
    const content = 'Sure: ' + said.replace(/^\[My Virtual World — [\s\S]*?\]\n\n/, '').replace(/\s+/g, ' ').trim().slice(-48);
    res.setHeader('content-type', 'application/json');
    if (!j.stream) { res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ model: 'fake', choices: [{ delta: { content } }] }) + '\n\n');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + '\n\ndata: [DONE]\n\n');
  });
}).listen(0, '127.0.0.1');
await new Promise(r => fake.on('listening', r));
const base = `http://127.0.0.1:${fake.address().port}/v1`;

const s = await startServer({ population: 120, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
let browser = null;
try {
  const owner = await ownerSession(s);
  await owner.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: 'hidden' }) } });
  const brain = (await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: { apiKey: 'sk-test' } })).json.id;
  const ears = await owner.post('/api/connections', { kind: 'voice', label: 'Test voice', scope: 'installation', config: { provider: 'custom', baseUrl: base, speakModel: 'tts-1', listenModel: 'fake-asr', voice: 'v1' }, secrets: { apiKey: 'sk-test' } });
  check(ears.status === 200, 'a voice service (a fake)' + (ears.status === 200 ? '' : ' — ' + ears.text));
  await owner.post('/api/settings', { values: { 'voice.enabled': true, 'voice.listenConnection': String(ears.json.id), 'voice.speakConnection': String(ears.json.id), 'voice.perMinute': '240' } });
  const agents = (await owner.get('/api/agents')).json.agents;
  const [LARA, SAM] = agents;
  for (const [a, name] of [[LARA, 'Lara'], [SAM, 'Sam']]) {
    const u = await owner.post('/api/agents/update', { id: a.id, name, connectionId: brain, nativeId: 'mind' });
    check(u.status === 200, `${name} (${u.status})`);
    a.name = name;
    await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
    await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' });
  }
  // (Lara has two chats: an older one, pinned, and today's — the one last written in; Sam has none)
  const run = async (a, session, input) => {
    const r = await owner.post('/api/providers/runs', { agent: a.id, session, input });
    for (let k = 0; k < 100 && r.json?.runId; k++) { await sleep(150); if ((await owner.get('/api/providers/runs/events?run=' + r.json.runId)).json.done) break; }
    return r;
  };
  const older = (await owner.post('/api/chat-sessions/create', { agent: LARA.id, label: 'Older' })).json.session;
  await run(LARA, older.id, 'Good morning');
  const today = (await owner.post('/api/chat-sessions/create', { agent: LARA.id, label: 'Today' })).json.session;
  await run(LARA, today.id, 'What a day');
  await owner.post('/api/chat-sessions/prefs', { agent: LARA.id, session: older.id, pinned: true });
  const chatsOf = async a => (await owner.get('/api/chat/recent?agent=' + a.id)).json.sessions || [];
  const historyOf = async (a, sid) => (await owner.get(`/api/providers/history?agent=${a.id}&session=${sid}`)).json.messages || [];

  browser = await launch(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon|WebSocket/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(s.url + '/?q=low', { waitUntil: 'load' });
  await page.evaluate(async pw => fetch('/api/auth/signin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'owner', password: pw }) }), owner.password);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__mvw && window.__mvw.ready, null, { timeout: 180000, polling: 500 });
  await sleep(1500);
  const api = (url, body) => page.evaluate(async ([u, b]) => { const n = await import('/js/core/net.js'); try { return await n.post(u, b); } catch (e) { return { error: e.message }; } }, [url, body]);
  const waitFor = async (fn, arg, ms = 30000) => (await page.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true).catch(() => false));
  // (an agent's body, and its bubble: from the page's own state module)
  const bodyIndex = a => page.evaluate(async id => { const { S } = await import('/js/core/state.js'); return (S.agentList || []).find(x => x.id === id)?.i ?? -1; }, a.id);

  // ---------------------------------------------------------------- out with Lara and Sam: the divider in Lara's chat
  console.log('— an outing begins');
  for (const a of [LARA, SAM]) { const f = await api('/api/companions', { agent: a.id, action: 'follow', target: 'me' }); check(f && f.ok === true, `${a.name} taken along (${(f && (f.text || f.error)) || ''})`); }
  check(await waitFor(() => { const d = document.querySelector('#cv-dock'); return d && !d.classList.contains('none') && !d.querySelector('.cv-mic').disabled; }), 'the voice row is there');
  let start = null;
  for (let k = 0; k < 40 && !start; k++) { start = (await historyOf(LARA, today.id)).find(m => m.status === 'outing' && m.meta?.outing === 'start'); if (!start) await sleep(250); }
  check(!!start, 'Lara\'s current chat (today\'s, not the pinned one) has the divider: ' + (start?.text || 'none'));
  check(!(await historyOf(LARA, older.id)).some(m => m.status === 'outing'), 'and the pinned older one has none');

  // ---------------------------------------------------------------- E near Lara: the chat window on that chat
  console.log('— E face to face');
  const li = await bodyIndex(LARA), si = await bodyIndex(SAM);
  check(li >= 0 && si >= 0, `their bodies (${li}, ${si})`);
  await page.evaluate(i => window.__mvw.talk.to(i), li);
  check(await waitFor(() => document.querySelector('.chatwin .cw-thread .cw-msg')), 'E opened the chat window');
  check(await waitFor(t => [...document.querySelectorAll('.chatwin .cw-bubble')].some(b => b.textContent === t), 'What a day'), 'on today\'s chat (the one last written in)');
  const divider = await page.waitForSelector('.chatwin .cw-modeline.outing.out', { timeout: 15000 }).then(e => e.textContent()).catch(() => '');
  check(/Out with .+ · \d{1,2}:\d{2}/.test(divider.trim()), 'the divider in the window, with the time: ' + divider.trim());
  await page.screenshot({ path: path.join(OUT, 'window-divider.png') });

  // ---------------------------------------------------------------- the voice row: "Lera, …" reaches Lara, in the same chat
  console.log('— the voice row (hold to talk)');
  // (held: once the microphone records — the first time it is asked for takes a while here —, then let go; true once the
  // brain was asked with these words)
  const hold = async (text, ms = 1500) => {
    heardNext = text;
    await waitFor(() => { const st = document.querySelector('#cv-dock .cv-status')?.textContent || ''; return !/thinking|answering|speaking|got it/.test(st); }, null, 60000);
    await page.locator('#cv-dock .cv-mic').dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true });
    const rec = await waitFor(() => document.querySelector('#cv-dock .cv-mic')?.getAttribute('aria-pressed') === 'true', null, 30000);
    if (!rec) console.log('    (the microphone did not start: ' + await page.evaluate(() => document.querySelector('#cv-dock .cv-status')?.textContent) + ')');
    await sleep(ms);
    await page.locator('#cv-dock .cv-mic').dispatchEvent('pointerup', { pointerId: 1, isPrimary: true });
    for (let k = 0; k < 160 && !asked.some(x => x.said.includes(text)); k++) await sleep(250);
    return asked.some(x => x.said.includes(text));
  };
  // (its owner's answers come in its voice from where it stands — audio/voices.js own —: the voice row says this one itself)
  await page.evaluate(() => { const v = window.__mvw.voices; if (v && !v.counted) { const own = v.own; v.counted = []; v.own = (rec, i, t) => { v.counted.push(t); return own(rec, i, t); }; } });
  check(await hold('Lera, what is that building?'), 'the brain was asked');
  check(asked.some(x => /Lera, what is that building\?/.test(x.said)), 'the words as heard');
  let line = null;
  for (let k = 0; k < 60 && !line; k++) { line = (await historyOf(LARA, today.id)).find(m => m.role === 'user' && /Lera, what is that building/.test(m.text)); if (!line) await sleep(250); }
  check(!!line, '"Lera" went to Lara, in today\'s chat — the one the window shows');
  check((await chatsOf(LARA)).length === 2, 'no new chat for it: ' + (await chatsOf(LARA)).length);
  check(await waitFor(t => [...document.querySelectorAll('.chatwin .cw-bubble')].some(b => b.textContent.includes(t)), 'Lera, what is that building?'), 'the window shows the line');
  check(await waitFor(() => [...document.querySelectorAll('.chatwin .cw-msg.assistant .cw-md')].some(b => b.textContent.includes('Sure: Lera, what is that building?'))), 'and the answer');
  check(await waitFor(async i => { const { S } = await import('/js/core/state.js'); return (S.says.get(i)?.text || '').includes('Sure: Lera, what is that building?'); }, li), 'a speech bubble over Lara\'s head, with that answer');
  check(!asked.some(x => /Out with |Back to its own day/.test(x.all)), 'its brain never told of the divider');
  await sleep(1500);
  const twice = await page.evaluate(() => (window.__mvw.voices?.counted || []).filter(t => t.includes('Lera, what is that building')).length);
  check(twice === 0, 'the window showing the same answer does not say it again (' + twice + ')');
  check(!(await page.evaluate(() => [...document.querySelectorAll('.chatwin .cw-msg.user')].find(m => m.textContent.includes('Lera, what is that building'))?.querySelector('.cw-to'))), 'said to Lara alone: no group mark');
  await page.screenshot({ path: path.join(OUT, 'voice-row-answer.png') });

  // ---------------------------------------------------------------- Sam has no chat: "Simon, …" — its first chat; E lands there
  console.log('— a companion with no chat');
  await page.evaluate(() => window.__mvw.chat.close());
  await sleep(500);
  check(await hold('Simon, where are we going?'), 'the brain was asked');
  let samChats = [];
  for (let k = 0; k < 60 && !samChats.length; k++) { samChats = await chatsOf(SAM); if (!samChats.length) await sleep(250); }
  check(samChats.length === 1, '"Simon" went to Sam: its one chat (' + samChats.length + ')');
  const samFirst = samChats[0]?.id;
  check(await waitFor(async i => { const { S } = await import('/js/core/state.js'); return (S.says.get(i)?.text || '').includes('Sure: Simon, where are we going?'); }, si), 'a speech bubble over Sam\'s head with its answer, no chat window open');
  check((await historyOf(SAM, samFirst)).some(m => m.status === 'outing'), 'the outing\'s divider is in it too');
  await page.evaluate(i => window.__mvw.talk.to(i), si);
  check(await waitFor(() => [...document.querySelectorAll('.chatwin .cw-bubble')].some(b => b.textContent.includes('Simon, where are we going?'))), 'E opened Sam\'s window on that same chat');

  // ---------------------------------------------------------------- a New chat in the window: the voice row speaks there
  console.log('— the person\'s New chat');
  const newBtn = await page.evaluate(() => { const b = document.querySelector('.chatwin .cw-new'); if (b) { b.click(); return true; } return false; });
  check(newBtn, 'New chat pressed');
  check(await waitFor(() => document.querySelector('.chatwin .cw-hello')), 'the window shows a new, empty chat');
  check(await hold('Sammy, and now?'), 'the brain was asked');
  check(await waitFor(() => [...document.querySelectorAll('.chatwin .cw-bubble')].some(b => b.textContent.includes('Sammy, and now?')), null, 40000), 'the voice row spoke in the window\'s new chat');
  const samNow = await chatsOf(SAM);
  check(samNow.length === 2, 'two chats: the person\'s New chat, nothing more (' + samNow.length + ')');
  check(!(await historyOf(SAM, samFirst)).some(m => /Sammy, and now/.test(m.text || '')), 'not in the earlier one');

  // ---------------------------------------------------------------- the group, and the outing's end as it happens
  console.log('— the group, then back to their day');
  check(await hold('everyone, look at that'), 'the brain was asked');
  for (let k = 0; k < 80 && asked.filter(x => /look at that/.test(x.said)).length < 2; k++) await sleep(250);
  check(asked.filter(x => /look at that/.test(x.said)).length >= 2, 'both answered');
  const to = await page.waitForSelector('.chatwin .cw-msg.user .cw-to', { timeout: 30000 }).then(e => e.textContent()).catch(() => '');
  check(/^to (Lara and Sam|Sam and Lara)$/.test(to), 'the line said to everyone marked so: ' + to);
  check(await page.evaluate(() => [...document.querySelectorAll('.chatwin .cw-msg.user')].filter(m => m.querySelector('.cw-to')).length === 1), 'only that one ("Sammy, …" was said to Sam alone)');
  check(!asked.some(x => /"to":/.test(x.all)), 'the mark is not the brain\'s');
  await api('/api/companions/dismiss-all', {});
  const back = await page.waitForSelector('.chatwin .cw-modeline.outing.back', { timeout: 30000 }).then(e => e.textContent()).catch(() => '');
  check(/Back to its own day · \d{1,2}:\d{2}/.test(back.trim()), 'the end divider shows in the window as it happens: ' + back.trim());
  await page.screenshot({ path: path.join(OUT, 'window-group-back.png') });
  check(errors.length === 0, errors.length ? 'page errors: ' + errors.slice(0, 3).join(' | ') : 'no page or console errors');
} finally {
  try { await browser?.close(); } catch { }
  await s?.stop(); fake.close();
}
if (fails.length) { console.log('\n' + fails.length + ' failed'); process.exit(1); }
console.log('\nall checks passed');
