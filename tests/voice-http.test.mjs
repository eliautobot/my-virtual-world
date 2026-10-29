// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Voice over HTTP on a real server (docs/features/CHAT.md §9): the installation's voice service (a fake OpenAI-compatible
// one on this machine) speaks and listens for everyone without their own, within the installation's daily limit; with
// none, "use the browser's voice" with the text to read; an agent's own voice (set by whoever manages it), its
// owner's default, the installation's, the browser's; an answer of a chat read aloud — pronounceable, in parts; a member
// brings their own service (and it may not reach inside the network); limits: requests a minute, a recording's size,
// length and format, the installation's daily spend; a service's failure in our words with the browser as the way on.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { mp3, wav, webm } from './helpers/audio.mjs';
import { seconds } from '../server/voice/audio.js';

const SECRET = 'sk-VOICE-SECRET-42';
let s, fake, owner, ann, bob, A, B, inst, ownerId, annId;
const spoken = [], heard = [];
let failSpeak = 0, longAnswer = false;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(30); } };

before(async () => {
  // one fake for the brain (chat completions) and the voice (speech, transcriptions, voices)
  fake = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (req.url.endsWith('/audio/speech')) {
        const j = JSON.parse(raw.toString());
        spoken.push({ ...j, auth: req.headers.authorization });
        if (failSpeak > 0) { failSpeak--; res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: `Incorrect API key ${SECRET}` } })); return; }
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'audio/mpeg' });
          res.end(mp3(Math.max(1, Math.round(j.input.length / 15 * 44100 / 1152))));   // ≈ 15 characters a second
        }, /slowly/.test(j.input) ? 400 : 0);
        return;
      }
      if (req.url.endsWith('/audio/transcriptions')) {
        heard.push({ bytes: raw.length, type: req.headers['content-type'] });
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ text: ` I said ${heard.length} things. ` }));
        return;
      }
      if (req.url.endsWith('/audio/voices')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ voices: ['v1', 'v2'] })); return; }
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      const j = JSON.parse(raw.toString() || '{}');
      const text = longAnswer ? Array.from({ length: 140 }, (_, i) => `This is sentence number ${i + 1} of a long answer.`).join(' ')
        : '## Your **plan**\n\nSee [the menu](https://example.com/menu).\n\n```js\nconst x = 1;\n```\n\n- Buy bread\n- Call Mia 📞';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { content: j.stream ? text : text } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 200, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob', role: 'member' });
  ownerId = (await owner.get('/api/auth/me')).json.account.id; annId = (await ann.get('/api/auth/me')).json.account.id;
  const agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' });
  [A, B] = [agents[0].id, agents[1].id];
  const base = `http://127.0.0.1:${fake.address().port}/v1`;
  const brain = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: { apiKey: 'b' } });
  assert.equal((await owner.post('/api/agents/update', { id: A, connectionId: brain.json.id, nativeId: 'mind' })).status, 200);
  for (const id of [A, B]) assert.equal((await owner.post('/api/agents/share', { id, kind: 'account', who: String(annId), level: 'use' })).status, 200);
  const v = await owner.post('/api/connections', { kind: 'voice', label: 'Platform voice', scope: 'installation',
    config: { provider: 'custom', baseUrl: base, speakModel: 'tts-1', voice: 'v1', speakPricePerMChars: 20, listenPricePerMinute: 0.006 }, secrets: { apiKey: SECRET } });
  assert.equal(v.status, 200, v.text);
  inst = v.json.id;
});
after(async () => { await s?.stop(); fake?.close(); });

/** POST /api/voice/speak; the answer as bytes (audio) or JSON. */
async function speak(c, body) {
  const r = await fetch(new URL('/api/voice/speak', s.url), { method: 'POST', headers: { cookie: c.cookie, 'x-csrf-token': c.csrf, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; if (/json/.test(r.headers.get('content-type') || '')) json = JSON.parse(buf.toString());
  return { status: r.status, headers: r.headers, audio: json ? null : buf, json };
}
const hear = (c, buf, q = '', type = 'audio/wav') => c.request('POST', `/api/voice/transcribe${q}`, buf, { 'content-type': type });
const setVoice = values => owner.post('/api/settings', { values });

test('nothing set up: the browser\'s own voice, with the text to read made pronounceable', async () => {
  const o = (await ann.get(`/api/voice/options?agent=${A}`)).json;
  assert.deepEqual([o.listen.source, o.listen.reason, o.speak.source, o.speak.reason], ['browser', 'none', 'browser', 'none']);
  assert.deepEqual(o.limits, { maxChars: 4000, maxSeconds: 300, maxBytes: 25 * 1048576, perMinute: 60 });
  const r = await speak(ann, { agent: A, text: 'Hello **there** — see [the docs](https://x.org/d).' });
  assert.equal(r.status, 409); assert.equal(r.json.code, 'use_browser'); assert.equal(r.json.fallback, 'browser'); assert.equal(r.json.reason, 'none');
  assert.equal(r.json.text, 'Hello there — see the docs.');
  const h = await hear(ann, wav(1));
  assert.equal(h.status, 409); assert.equal(h.json.code, 'use_browser');
  assert.equal(spoken.length + heard.length, 0);
});

test('the installation\'s voice speaks and listens for everyone without their own; a replay comes from the cache', async () => {
  assert.equal((await setVoice({ 'voice.speakConnection': String(inst), 'voice.listenConnection': String(inst) })).status, 200);
  const r = await speak(owner, { text: 'Good morning. The weather is fine.' });
  assert.equal(r.status, 200, r.json && JSON.stringify(r.json));
  assert.equal(r.headers.get('content-type'), 'audio/mpeg'); assert.equal(r.headers.get('x-voice-source'), 'installation');
  assert.ok(Math.abs(Number(r.headers.get('x-voice-seconds')) - seconds(r.audio)) < 0.02, 'the length is the audio\'s own');
  assert.deepEqual([spoken.at(-1).model, spoken.at(-1).voice, spoken.at(-1).input, spoken.at(-1).auth], ['tts-1', 'v1', 'Good morning. The weather is fine.', `Bearer ${SECRET}`]);
  const again = await speak(owner, { text: 'Good morning. The weather is fine.' });
  assert.equal(again.headers.get('x-voice-cached'), '1', 'a replay comes from the cache'); assert.equal(spoken.length, 1, 'and is not paid twice');
  // the same audio asked for three times at once (a double tap): made once, the others wait for it
  const three = await Promise.all([1, 2, 3].map(() => speak(owner, { text: 'Said slowly, once.' })));
  assert.deepEqual(three.map(x => x.status), [200, 200, 200]);
  assert.equal(spoken.length, 2, 'one call to the service');
  assert.deepEqual(three.map(x => x.headers.get('x-voice-cached') || '0').sort(), ['0', '1', '1']);
  assert.ok(three.every(x => x.audio.equals(three[0].audio)), 'the same audio for each');
  const ov = (await owner.get('/api/voice/overview')).json;
  assert.deepEqual([ov.inFlight, ov.waiting], [0, 0]);
  const h = await hear(owner, wav(2), '?language=en');
  assert.equal(h.status, 200, h.text); assert.deepEqual([h.json.text, h.json.seconds, h.json.source], ['I said 1 things.', 2, 'installation']);
  assert.equal(heard[0].type.startsWith('multipart/form-data'), true);
  // a member: the installation's voice too (no plans here: the installation's daily limit is the only one)
  const o = (await ann.get('/api/voice/options')).json;
  assert.deepEqual([o.speak.source, o.listen.source], ['installation', 'installation']);
  assert.equal('allowance' in o, false, 'no voice minutes to count');
  const rr = await speak(ann, { agent: B, text: 'One two three four five six seven eight nine ten. Eleven twelve thirteen fourteen fifteen.' });
  assert.equal(rr.status, 200, rr.json && JSON.stringify(rr.json));
  assert.equal(rr.headers.get('x-voice-source'), 'installation');
  const hh = await hear(ann, wav(3));
  assert.equal(hh.json.seconds, 3, 'measured from the recording itself');
});

test('an agent\'s own voice — set by whoever manages it — then its owner\'s, the installation\'s or the browser\'s', async () => {
  // the owner gives B a voice on the installation's service: v2, a little faster, with a manner
  const set = await owner.post('/api/voice/agent', { agent: B, connection: inst, voice: 'v2', speed: 1.2, instructions: 'Warm and calm.' });
  assert.equal(set.status, 200, set.text); assert.deepEqual([set.json.voice.voice, set.json.voice.speed, set.json.speaks.source], ['v2', 1.2, 'agent']);
  const r = await speak(ann, { agent: B, text: 'Hello from B.' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-voice-source'), 'agent');
  assert.deepEqual([spoken.at(-1).voice, spoken.at(-1).speed], ['v2', 1.2], 'the agent\'s voice speaks for whoever listens');
  // Ann may use B, not manage it
  assert.equal((await ann.post('/api/voice/agent', { agent: B, voice: 'v1' })).status, 404);
  assert.equal((await ann.get(`/api/voice/agent?agent=${B}`)).status, 404);
  assert.equal((await bob.get(`/api/voice/options?agent=${B}`)).status, 404, 'Bob may not even see it');
  // the browser's voice chosen for B: the page reads it in the voice named
  await owner.post('/api/voice/agent', { agent: B, connection: 'browser', browserVoice: 'Samantha' });
  const b = await speak(ann, { agent: B, text: 'Hi.' });
  assert.deepEqual([b.status, b.json.reason, b.json.browserVoice], [409, 'choice', 'Samantha']);
  // automatic again: its owner's default (none) → the installation's, with the service's own voice
  await owner.post('/api/voice/agent', { agent: B, connection: null });
  const o = (await ann.get(`/api/voice/options?agent=${B}`)).json;
  assert.equal(o.speak.source, 'installation'); assert.equal(o.agent.manage, false);
  assert.ok(o.services.some(x => x.id === inst && x.installation && x.speak && x.listen), 'the installation\'s service is listed for everyone');
  assert.deepEqual((await ann.get(`/api/voice/voices?connection=${inst}`)).json.voices.map(v => v.id), ['v1', 'v2']);
  // a bad choice is refused
  for (const bad of [{ speed: 7 }, { voice: '../x' }, { connection: 999999 }, { connection: 'nonsense' }]) assert.ok([400, 404].includes((await owner.post('/api/voice/agent', { agent: B, ...bad })).status), JSON.stringify(bad));
});

test('every agent its own voice on the service that speaks for it: picked for it and kept, or chosen in its Studio; its owner may have them all speak alike', async () => {
  await owner.post('/api/voice/agent', { agent: B, connection: null });   // (automatic: the installation's service)
  let n = 0;
  const voiceOf = async id => { const r = await speak(owner, { agent: id, text: `Hello number ${++n}.` }); assert.equal(r.status, 200, JSON.stringify(r.json)); return spoken.at(-1).voice; };
  const a1 = await voiceOf(A), b1 = await voiceOf(B);
  assert.ok(['v1', 'v2'].includes(a1) && ['v1', 'v2'].includes(b1) && a1 !== b1, `two agents, two voices (${a1}, ${b1})`);
  assert.equal(await voiceOf(A), a1, 'kept');
  const o = (await owner.get(`/api/voice/options?agent=${A}`)).json;
  assert.deepEqual([o.speak.voice, o.speak.auto, o.agent.voice.voices[inst]], [a1, true, a1], 'its Studio shows the voice picked for it');
  // chosen in its Studio for the service that speaks for it (the installation's, not a service of its own)
  const ch = await owner.post('/api/voice/agent', { agent: A, for: inst, voice: b1 });
  assert.equal(ch.status, 200, ch.text);
  assert.deepEqual([ch.json.speaks.voice, ch.json.speaks.chosen, ch.json.voice.connection], [b1, true, null], 'chosen, still on the automatic service');
  assert.equal(await voiceOf(A), b1);
  // cleared: one is picked for it again
  assert.equal((await owner.post('/api/voice/agent', { agent: A, for: inst, voice: '' })).status, 200);
  assert.ok(['v1', 'v2'].includes(await voiceOf(A)));
  // not someone else's to choose; not a service it can't use
  assert.equal((await ann.post('/api/voice/agent', { agent: A, for: inst, voice: 'v1' })).status, 404);
  assert.equal((await owner.post('/api/voice/agent', { agent: A, for: 999999, voice: 'v1' })).status, 404);
  // its owner has them all speak alike: the service's own voice for both
  assert.equal((await owner.post('/api/voice/prefs', { speak: { unique: false } })).status, 200);
  assert.deepEqual([await voiceOf(A), await voiceOf(B)], ['v1', 'v1']);
  assert.equal((await owner.post('/api/voice/prefs', { speak: { unique: true } })).status, 200);
});

test('a chat\'s answer read aloud: one of the account\'s own, pronounceable, a long one in parts', async () => {
  const sess = (await owner.post('/api/chat-sessions/create', { agent: A })).json.session;
  const run = (await owner.post('/api/providers/runs', { agent: A, session: sess.id, input: 'plan my day' })).json.runId;
  assert.ok(await waitFor(async () => (await owner.get(`/api/providers/runs/events?run=${run}`)).json.done));
  const msg = (await owner.get(`/api/providers/history?agent=${A}&session=${sess.id}`)).json.messages.find(m => m.role === 'assistant');
  const r = await speak(owner, { session: sess.id, message: msg.id });
  assert.equal(r.status, 200, r.json && JSON.stringify(r.json));
  assert.equal(spoken.at(-1).input, 'Your plan. See the menu. (There is a js code block here.) Buy bread. Call Mia.');
  assert.equal(r.headers.get('x-voice-parts'), '1');
  // someone else's message is no message at all
  assert.equal((await speak(ann, { session: sess.id, message: msg.id })).status, 404);
  assert.equal((await speak(owner, { session: sess.id, message: msg.id + 999 })).status, 404);
  // a long answer: parts of at most 4,000 characters, cut at sentences
  longAnswer = true;
  const run2 = (await owner.post('/api/providers/runs', { agent: A, session: sess.id, input: 'tell me everything' })).json.runId;
  assert.ok(await waitFor(async () => (await owner.get(`/api/providers/runs/events?run=${run2}`)).json.done));
  longAnswer = false;
  const long = (await owner.get(`/api/providers/history?agent=${A}&session=${sess.id}`)).json.messages.filter(m => m.role === 'assistant').at(-1);
  const p0 = await speak(owner, { session: sess.id, message: long.id, part: 0 }), p1 = await speak(owner, { session: sess.id, message: long.id, part: 1 });
  assert.equal(p0.headers.get('x-voice-parts'), '2'); assert.equal(p1.headers.get('x-voice-part'), '1');
  const [a0, a1] = spoken.slice(-2).map(x => x.input);
  assert.ok(a0.length <= 4000 && a0.endsWith('.') && a1.startsWith('This is sentence'), 'cut at a sentence');
  assert.equal(`${a0} ${a1}`, long.text, 'nothing lost between the parts');
  // text sent directly: at most 4,000 characters a call
  assert.equal((await speak(owner, { text: 'x'.repeat(4001) })).json.code, 'too_long');
  // a provider's answer (OpenClaw, Hermes: no copy kept here, its chat window sends its words, long: true): in its
  // agent's voice and in parts like one kept here (2026-10-27: 🔊 on an OpenClaw agent's answer did nothing)
  const q0 = await speak(owner, { agent: A, text: long.text, long: true, part: 0 }), q1 = await speak(owner, { agent: A, text: long.text, long: true, part: 1 });
  assert.equal(q0.status, 200, q0.json && JSON.stringify(q0.json));
  assert.equal(q0.headers.get('x-voice-parts'), '2'); assert.equal(q1.headers.get('x-voice-part'), '1');
  assert.equal((await speak(bob, { agent: A, text: 'Hello', long: true })).status, 404, 'only for someone who may use the agent');
});

test('a member brings their own voice service (and it may not reach inside the network); others can\'t use it', async () => {
  const mine = await ann.post('/api/connections', { kind: 'voice', label: 'My voice', scope: 'account', config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1` }, secrets: { apiKey: 'mine' } });
  assert.equal(mine.status, 200, `a voice service is the member's own to bring: ${mine.text}`);
  assert.notEqual((await ann.post('/api/connections', { kind: 'models', label: 'x', scope: 'account', config: { provider: 'openai' }, secrets: { apiKey: 'x' } })).json.code, 'not_offered', 'a member may bring their own brain too');
  const p = await ann.post('/api/voice/prefs', { speak: { connection: mine.json.id, voice: 'v2' }, listen: { connection: mine.json.id, language: 'en' } });
  assert.equal(p.status, 200, p.text); assert.equal(p.json.listen.language, 'en');
  const n = spoken.length;
  const r = await speak(ann, { text: 'From my own service.' });
  assert.equal(r.status, 403); assert.deepEqual([r.json.code, r.json.fallback], ['blocked', 'browser'], 'an account\'s service must be public https: the loopback is refused');
  assert.equal(spoken.length, n, 'nothing reached it');
  assert.equal((await bob.post('/api/voice/prefs', { speak: { connection: mine.json.id } })).status, 404, 'Bob can\'t use Ann\'s service');
  assert.equal((await ann.post('/api/voice/prefs', { listen: { language: 'english please' } })).status, 400);
  // back to automatic
  assert.equal((await ann.post('/api/voice/prefs', { speak: { connection: null }, listen: { connection: 'auto' } })).json.speak.connection, null);
  assert.equal((await ann.get('/api/voice/options')).json.speak.source, 'installation');
});

test('an administrator\'s own voice service and brain may be on this network (http, a local address) and need no key; a member\'s may not', async () => {
  const base = `http://127.0.0.1:${fake.address().port}/v1`;
  const mine = await owner.post('/api/connections', { kind: 'voice', label: 'My Kokoro', scope: 'account', config: { provider: 'custom', baseUrl: base, voice: 'v2', does: 'speak' }, secrets: {} });
  assert.equal(mine.status, 200, `no key needed for a server of one's own: ${mine.text}`);
  const n = heard.length;
  const t = await owner.post('/api/connections/test', { id: mine.json.id });
  assert.equal(t.json.ok, true, t.text); assert.match(t.json.detail, /spoke/);
  assert.equal(heard.length, n, 'a server that only speaks isn\'t asked to listen');
  assert.equal(spoken.at(-1).auth, undefined, 'no key, no Authorization header');
  assert.equal((await owner.post('/api/voice/prefs', { listen: { connection: mine.json.id } })).json.code, 'cannot', 'it only speaks');
  assert.equal((await owner.post('/api/voice/prefs', { speak: { connection: mine.json.id, voice: 'v2' } })).status, 200);
  const r = await speak(owner, { text: 'From my own server on this network.' });
  assert.equal(r.status, 200, r.json && JSON.stringify(r.json));
  assert.equal(spoken.at(-1).input, 'From my own server on this network.');
  const svc = (await owner.get('/api/voice/options')).json.services.find(x => x.id === mine.json.id);
  assert.deepEqual([svc.speak, svc.listen], [true, false], 'offered to speak, not to listen');
  assert.equal((await owner.post('/api/voice/prefs', { speak: { connection: null } })).status, 200);
  // a brain the same way (Ollama, LM Studio on this network): the administrator's works, a member's is refused
  const brain = await owner.post('/api/connections', { kind: 'models', label: 'My Ollama', scope: 'account', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: {} });
  assert.equal(brain.status, 200, brain.text);
  const bt = await owner.post('/api/connections/test', { id: brain.json.id });
  assert.equal(bt.json.ok, true, bt.text);
  const hers = await ann.post('/api/connections', { kind: 'models', label: 'Her Ollama', scope: 'account', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: {} });
  assert.equal(hers.status, 200, hers.text);
  const ht = await ann.post('/api/connections/test', { id: hers.json.id });
  assert.deepEqual([ht.json.ok, ht.json.code], [false, 'blocked'], 'a member\'s own may not reach inside the network');
  // a vendor's service still needs its key
  assert.equal((await ann.post('/api/connections', { kind: 'voice', label: 'x', scope: 'account', config: { provider: 'openai' }, secrets: {} })).status, 400);
  for (const [c, id] of [[owner, mine.json.id], [owner, brain.json.id], [ann, hers.json.id]]) assert.equal((await c.post('/api/connections/remove', { id })).status, 200);
});

test('the installation\'s service for listening and the one for speaking are each named by their own id, even when both can do both', async () => {
  const base = `http://127.0.0.1:${fake.address().port}/v1`;
  const ears = await owner.post('/api/connections', { kind: 'voice', label: 'Platform ears', scope: 'installation', config: { provider: 'custom', baseUrl: base }, secrets: { apiKey: 'e' } });
  assert.equal(ears.status, 200, ears.text);
  assert.equal((await setVoice({ 'voice.listenConnection': String(ears.json.id), 'voice.speakConnection': String(inst) })).status, 200);
  const o = (await owner.get('/api/voice/options')).json;
  assert.deepEqual([o.installation.listenId, o.installation.speakId], [ears.json.id, inst]);
  assert.deepEqual([o.listen.service.label, o.speak.service.label], ['Platform ears', 'Platform voice']);
  assert.equal(o.listen.voice, undefined, 'who listens has no voice');
  assert.equal(o.speak.voice, 'v1');
  assert.equal((await setVoice({ 'voice.listenConnection': String(inst) })).status, 200);
});

test('limits: a recording\'s format, size and length; requests a minute; a failing service in our words; switched off; the day\'s spend', async () => {
  const bad = await hear(owner, Buffer.from('this is not a recording at all, just words pretending to be one, long enough to be looked at'), '', 'audio/webm');
  assert.deepEqual([bad.status, bad.json.code], [415, 'unsupported']);
  const long = await hear(owner, wav(303, 8000));   // (a second over is let through: a recorder stops a little late)
  assert.deepEqual([long.status, long.json.code], [413, 'too_long']);
  const big = await hear(owner, Buffer.concat([wav(1), Buffer.alloc(25 * 1048576)]));
  assert.deepEqual([big.status, big.json.code], [413, 'too_large']);
  // a recording whose header says less than it holds (to pay less): never metered, nor let through, as shorter than its
  // size allows at the highest rate a recording of its kind has
  const forged = wav(4, 16000); forged.writeUInt32LE(64000000, 28);   // its byte rate a thousand times too high: "4 ms"
  const fh = await hear(owner, forged);
  assert.equal(fh.status, 200, fh.text);
  assert.ok(Math.abs(fh.json.seconds - forged.length / 384000) < 0.01, `metered ${fh.json.seconds} s, not 0.004`);
  const quiet = Buffer.concat([webm(1040), Buffer.alloc(20 * 1048576)]);   // 20 MB whose blocks say a second
  const qh = await hear(owner, quiet, '', 'audio/webm');
  assert.deepEqual([qh.status, qh.json.code], [413, 'too_long'], '20 MB is more than 5 minutes of any browser\'s recording');
  // a failing service: our words, never its own (which repeat the key), and the browser as the way on
  failSpeak = 1;
  const f = await speak(owner, { text: 'This one fails.' });
  assert.deepEqual([f.status, f.json.code, f.json.fallback], [502, 'auth', 'browser']);
  assert.ok(!JSON.stringify(f.json).includes(SECRET) && !/Incorrect/.test(f.json.error));
  // requests a minute
  assert.equal((await setVoice({ 'voice.perMinute': '20' })).status, 200);
  let limited = null;
  for (let k = 0; k < 25 && !limited; k++) { const r = await speak(owner, { text: `Count ${k} for the limit.` }); if (r.status === 429) limited = r; }
  assert.ok(limited, 'the 21st request this minute waits'); assert.equal(limited.json.code, 'rate_limited'); assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal((await setVoice({ 'voice.perMinute': '240' })).status, 200);
  // switched off: the browser for everyone
  assert.equal((await setVoice({ 'voice.enabled': false })).status, 200);
  assert.equal((await speak(owner, { text: 'Off.' })).json.reason, 'none');
  assert.equal((await setVoice({ 'voice.enabled': true })).status, 200);
  // the installation's daily limit: $1 at a price of $10,000 per million characters is 100 characters
  assert.equal((await owner.post('/api/connections/update', { id: inst, config: { speakPricePerMChars: 10000 } })).status, 200);
  assert.equal((await setVoice({ 'voice.dailyUsd': '1' })).status, 200);
  assert.equal((await speak(owner, { text: 'A long enough sentence to pass the day\'s whole limit in one go, and then some more words to be sure of it.' })).status, 200);
  const day = await speak(owner, { text: 'And now?' });
  assert.deepEqual([day.status, day.json.reason], [409, 'voice_daily'], 'everyone hears the browser\'s voice until midnight UTC');
  const ov = (await owner.get('/api/voice/overview')).json;
  assert.ok(ov.micro >= 1e6 && ov.calls > 5 && ov.cached >= 1 && ov.failed >= 1 && ov.browser >= 1, JSON.stringify(ov));
  assert.equal((await ann.get('/api/voice/overview')).status, 403, 'administrators only');
});
