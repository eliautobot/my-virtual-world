// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents' voices and agents going together on a real server (docs/features/companions.md §6–§7): an agent's line out
// loud comes with its audio, made once in its own voice and served to any page (GET /api/voice/line); two agents that
// meet up ask each other along by their own brains — one asks, the other says yes out loud — and then go together (the
// one who asked leads; nobody ordered it; each owner sees it); a companion says a word when it joins its owner. The brain,
// the moderation and the voice are one fake OpenAI-compatible server on this machine — what each brain answers is its
// own (the fake only answers the shape asked for), the world decides what follows.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, httpClient } from './helpers/server.mjs';
import { mp3 } from './helpers/audio.mjs';
import { parseCommand } from '../server/companions/intent.js';
import { modelModerate } from '../server/providers/models.js';
import { readActions } from '../server/mind/actions.js';
import { speechText, WALK } from '../server/mind/speech.js';

let s, owner, fake, agents, ws;
const says = [], seen = [], voices = [];
const F = { accept: true };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, what, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`waited for ${what}`); await wait(150); } };
void parseCommand;

before(async () => {
  fake = http.createServer((req, res) => {
    const chunks = []; req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks), j = raw.length ? JSON.parse(raw.toString()) : {};
      if (req.url.endsWith('/audio/speech')) { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(mp3(40)); return; }
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
      if (req.url.endsWith('/moderations')) { res.end(JSON.stringify({ results: [{ flagged: false, categories: {} }] })); return; }
      const user = (j.messages || []).filter(m => m.role === 'user')[0]?.content || '';
      seen.push(user);
      let ans = {};
      if (/"invite":"<one of PLACES/.test(user)) ans = { say: 'Hey! Fancy a stroll with me?', invite: WALK };
      else if (/"accept":true or false/.test(user)) ans = { say: F.accept ? 'Sure, let\'s go!' : 'Not now, thanks.', accept: F.accept };
      else if (/JSON: \{"say"/.test(user)) ans = { say: 'Coming!' };
      res.end(JSON.stringify({ model: 'fake', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(ans) } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 220, agents: 4, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  const base = `http://127.0.0.1:${fake.address().port}/v1`;
  const brain = (await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: { apiKey: 'k' } })).json.id;
  const mod = (await owner.post('/api/connections', { kind: 'models', label: 'Moderation', scope: 'installation', config: { provider: 'custom', baseUrl: base, model: 'fake' }, secrets: { apiKey: 'k' } })).json.id;
  const v = await owner.post('/api/connections', { kind: 'voice', label: 'Voice', scope: 'installation', config: { provider: 'custom', baseUrl: base, speakModel: 'tts-1', voice: 'v1' }, secrets: { apiKey: 'k' } });
  assert.equal(v.status, 200, v.text);
  const st = await owner.post('/api/settings', { values: { 'mind.moderationConnection': String(mod), 'voice.speakConnection': String(v.json.id), 'mind.speechGapSeconds': 5, 'mind.speechPerDay': '32' } });
  assert.equal(st.status, 200, st.text);
  agents = (await owner.get('/api/agents')).json.agents;
  for (const a of agents) { await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' }); await owner.post('/api/mind/agent', { agent: a.id, cadence: 'daily' }); }
  await owner.post('/api/clock', { skip: 11 });   // (late morning: everyone up)
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  ws.onmessage = ev => { if (typeof ev.data === 'string') { const m = JSON.parse(ev.data); if (m.t === 'say') says.push(m); if (m.t === 'say_voice') voices.push(m); } };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.send(JSON.stringify({ t: 'pobserve', on: false }));
});
after(async () => { ws?.close(); await s?.stop(); fake?.close(); });

test('the pieces: a model as moderator; an invitation names one of its places or a walk; the prompts ask for what they will act on', async () => {
  const ok = await modelModerate({ input: 'Lovely day for a walk!' }, async () => ({ text: '{"flagged": false, "categories": []}' }));
  assert.deepEqual(ok, { flagged: false, categories: [], by: 'model' });
  const bad = await modelModerate({ input: 'x' }, async () => ({ text: 'Sure {"flagged": true, "categories": ["hate", "made-up"]}' }));
  assert.deepEqual(bad.categories, ['hate'], 'only known categories');
  await assert.rejects(modelModerate({ input: 'x' }, async () => ({ text: 'I think it is fine' })), e => e.code === 'provider_error', 'anything else: not checked (nothing is said)');
  const places = [{ name: 'Bean There' }, { name: 'Oak Park' }];
  assert.deepEqual(readActions('speech', { say: 'Hi', invite: 'Oak Park' }, { places }).invite, { place: 'Oak Park' });
  assert.deepEqual(readActions('speech', { say: 'Hi', invite: 'a walk' }, { places }).invite, { place: WALK });
  assert.equal(readActions('speech', { say: 'Hi', invite: 'The Moon' }, { places }).invite, null, 'not a place it was offered');
  assert.equal(readActions('speech', { say: 'Ok', accept: true }, { places }).accept, true);
  const c = { name: 'Riley', now: { weekday: 'Mon', clock: '11:00 AM' }, where: 'at Oak Park', places };
  assert.match(speechText(c, { kind: 'meet', to: { name: 'Max', how: 'a friend' }, invite: true }), /PLACES: «Bean There», «Oak Park»/);
  assert.match(speechText(c, { kind: 'reply', to: { name: 'Max', how: 'a friend' }, heard: 'Walk?', invited: { place: WALK } }), /asking me to go for a walk with them now[\s\S]*"accept":true or false/);
  assert.doesNotMatch(speechText(c, { kind: 'meet', to: { name: 'Max', how: 'a friend' } }), /PLACES|invite/, 'no invitation offered when they aren\'t free');
});

test('a line out loud comes with its voice: made once, served to anyone in the world', async () => {
  const a = agents[3];
  const p = (await owner.get(`/api/agent/${a.i}`)).json;
  const n0 = says.length;
  assert.equal((await owner.post('/api/talk', { i: a.i, x: p.pos.x + 1, z: p.pos.z })).status, 200);
  const line = await until(() => says.slice(n0).find(m => m.i === a.i && m.audio), 'its line with its voice');
  assert.equal(line.text, 'Coming!');
  assert.ok(line.secs > 0);
  const guest = httpClient(s.url);
  const r = await fetch(new URL(`/api/voice/line?id=${encodeURIComponent(line.audio)}`, s.url), { headers: guest.cookie ? { cookie: guest.cookie } : {} });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^audio\//);
  assert.ok((await r.arrayBuffer()).byteLength > 100);
  assert.equal((await fetch(new URL('/api/voice/line?id=nope', s.url))).status, 404);
});

test('two agents meeting up ask each other along by themselves: one asks, the other says yes out loud, they go together', async () => {
  const [A, B] = agents;
  const pa = (await owner.get(`/api/agent/${A.i}`)).json.pos;
  const m = await owner.post('/api/companions', { action: 'meetup', agents: [A.id, B.id], spot: { x: pa.x, z: pa.z, ctx: pa.ctx < -1 ? -1 : pa.ctx } });
  assert.equal(m.status, 200, m.text);
  await owner.post('/api/clock', { rate: 20 });
  const n0 = says.length;
  // they meet, talk (both lines spoken), and go together
  const asked = await until(() => says.slice(n0).find(x => x.text === 'Hey! Fancy a stroll with me?'), 'the invitation, out loud', 90000);
  let yes;
  try { yes = await until(() => says.slice(n0).find(x => x.text === 'Sure, let\'s go!'), 'the yes, out loud', 30000); }
  catch (e) { for (const x of [A, B]) console.log('DEBUG', x.name, JSON.stringify((await owner.get(`/api/mind/thoughts?agent=${x.id}`)).json.thoughts.filter(t => t.kind === 'speech').map(t => [t.status, t.error, t.did]))); console.log('DEBUG says', JSON.stringify(says.slice(n0).map(x => [x.i, x.text]))); throw e; }
  assert.ok(asked.audio && yes.audio, 'both in their voices');
  assert.notEqual(asked.i, yes.i);
  const l = await until(async () => { const c = (await owner.get('/api/companions')).json.companions; return c.some(x => x.via === 'agent' && x.kind === 'follow' && x.leader?.kind === 'agent') ? c : null; }, 'going together');
  const follower = l.find(x => x.via === 'agent' && x.kind === 'follow'), leader = l.find(x => x.via === 'agent' && x.kind !== 'follow');
  assert.ok(follower && leader, JSON.stringify(l));
  assert.equal(follower.leader.agent, leader.agent, 'the one who asked leads');
  assert.equal(follower.i, yes.i, 'the one who said yes goes with it');
  assert.deepEqual(follower.with, [leader.name]);
  await owner.post('/api/clock', { rate: 1 });
  await owner.post('/api/companions/dismiss-all', {});
});

test('a companion says a word as it joins its owner (a button, not a chat)', async () => {
  const C = agents[2];
  const n0 = says.length;
  const r = await owner.post('/api/companions', { agent: C.id, action: 'follow', target: 'me' });
  assert.equal(r.status, 200, r.text);
  const w = await until(() => says.slice(n0).find(x => x.i === C.i), 'its word', 20000);
  assert.ok(w.audio);
  assert.ok(seen.some(u => /just asked me to come along with them/.test(u)), 'it was told what happened, and said its own words');
  await owner.post('/api/companions', { agent: C.id, action: 'dismiss' });
});

test('who hears its voice: its owner may keep it to themselves — the bubble for everyone, the voice for its owner alone', async () => {
  const a = agents[3];
  const set = await owner.post('/api/voice/agent', { agent: a.id, audience: 'owner' });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.json.voice.audience, 'owner');
  assert.equal((await owner.post('/api/voice/agent', { agent: a.id, audience: 'everyone' })).status, 400);
  const guest = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws'), gsays = [];
  guest.onmessage = ev => { if (typeof ev.data === 'string') { const m = JSON.parse(ev.data); if (m.t === 'say' || m.t === 'say_voice') gsays.push(m); } };
  await new Promise((r, j) => { guest.onopen = r; guest.onerror = j; });
  await wait(6000);   // (its last line's gap)
  const p = (await owner.get(`/api/agent/${a.i}`)).json, n0 = says.length, v0 = voices.length;
  assert.equal((await owner.post('/api/talk', { i: a.i, x: p.pos.x + 1, z: p.pos.z })).status, 200);
  const bubble = await until(() => says.slice(n0).find(m => m.i === a.i && m.text === 'Coming!'), 'its bubble');
  assert.equal(bubble.audio, undefined, 'no voice with the bubble everyone sees');
  const mine = await until(() => voices.slice(v0).find(m => m.i === a.i), 'its voice, to its owner');
  await wait(500);
  assert.ok(gsays.some(m => m.t === 'say' && m.i === a.i), 'a guest sees the bubble');
  assert.ok(!gsays.some(m => m.i === a.i && (m.t === 'say_voice' || m.audio)), 'and gets no voice of its');   // (others nearby may speak meanwhile: co-workers at work, server/workplace/)
  const url = new URL(`/api/voice/line?id=${encodeURIComponent(mine.audio)}`, s.url);
  assert.equal((await fetch(url)).status, 404, 'its audio is refused to anyone else');
  assert.equal((await fetch(url, { headers: { cookie: owner.cookie } })).status, 200, 'and served to its owner');
  guest.close();
  await owner.post('/api/voice/agent', { agent: a.id, audience: '' });
});
