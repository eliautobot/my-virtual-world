// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions through a chat (server/companions/, docs/features/companions.md §3), with a built-in brain (a fake model
// server): "follow me" in its owner's chat is carried out at once — a line in the chat, the brain told what its body just
// did — and a message that is no plain command leaves the body alone; the brain may also choose its own companion tool
// ("come along") when its owner asks in its own words; a slash command is never a command for the body.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner, agents, fake, ws, brain;
const seen = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(100); } };

before(async () => {
  fake = http.createServer((req, res) => {
    let b = '';
    req.on('data', d => { b += d; });
    req.on('end', () => {
      const j = b ? JSON.parse(b) : null;
      seen.push(j);
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'fake-small' }] })); return; }
      // (the person's words: its senses' note goes before them — server/senses/)
      const msgs = j.messages || [], last = String(msgs[msgs.length - 1]?.content || '').replace(/^\[My Virtual World — [\s\S]*?\]\n\n/, '');
      // its owner asks in its own words to be taken along: the brain uses its tool, then answers
      let content = 'Sure thing!';
      if (/take you along to see the city/.test(last)) content = '{"use":[{"tool":"come_along"}]}';
      // told to wait (the message itself already did it): words, then the same order again with a place it made up
      else if (/^Wait here for a bit/.test(last)) content = 'Okay, I will wait right here. {"use":[{"tool":"wait","place":"Some Restaurant"}]}';
      else if (/^RESULTS:/.test(last)) content = 'On my way to you!';
      if (j.stream) {
        res.setHeader('content-type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ model: 'fake-small', choices: [{ delta: { content } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\ndata: [DONE]\n\n`);
        res.end(); return;
      }
      res.end(JSON.stringify({ model: 'fake-small', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise(r => fake.on('listening', r));
  s = await startServer({ population: 200, agents: 2, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  agents = (await owner.get('/api/agents')).json.agents;
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Test brain', scope: 'installation',
    config: { provider: 'custom', baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, model: 'fake-small' }, secrets: { apiKey: 'sk-test' } });
  assert.equal(c.status, 200, c.text);
  brain = c.json.id;
  for (const a of agents) {
    assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: brain, nativeId: 'mind' })).status, 200);
    assert.equal((await owner.post('/api/mind/agent', { agent: a.id, cadence: 'off' })).status, 200);
    assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'life' })).status, 200);
  }
  // the owner's player (its page's live connection)
  ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: owner.cookie } });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  await wait(500);
});
after(async () => { try { ws?.close(); } catch { /* closed */ } await s?.stop(); fake?.close(); });

async function chat(a, session, input) {
  const run = await owner.post('/api/providers/runs', { agent: a.id, session, input });
  assert.equal(run.status, 200, run.text);
  for (let k = 0; k < 80; k++) {
    await wait(150);
    const ev = (await owner.get(`/api/providers/runs/events?run=${run.json.runId}`)).json;
    if (ev.done) return { run: run.json, events: ev.events.map(e => e.event) };
  }
  throw new Error('no answer');
}
const companion = async id => (await owner.get('/api/companions')).json.companions.find(c => c.agent === id) || null;

test('"follow me" in its chat: carried out at once, a line in the chat, and its brain is told what its body just did', async () => {
  const a = agents[0];
  const sess = (await owner.post('/api/chat-sessions/create', { agent: a.id, label: 'Walk' })).json.session;
  const r = await chat(a, sess.id, 'Riley, follow me!');
  assert.equal(r.run.companion?.ok, true, JSON.stringify(r.run.companion));
  assert.match(r.run.companion.text, /with you/);
  assert.ok(await waitFor(() => companion(a.id)), 'it is a companion now');
  const req = [...seen].reverse().find(j => j.messages?.some(m => /follow me/.test(m.content)));
  const sys = req?.messages[0].content || '', note = req?.messages.at(-1).content || '';
  assert.match(note, /^\[My Virtual World — [\s\S]*Because of this message, already done .*companion: you are walking over to/, 'its brain knows, plainly (with the message: its senses)');
  assert.match(note, /don't ask where/);
  assert.match(sys, /come_along/, 'and has its companion tools');
  const hist = (await owner.get(`/api/providers/history?agent=${a.id}&session=${sess.id}`)).json;
  assert.ok((hist.messages || []).some(m => m.role === 'system' && /with you/.test(m.text)), 'a line in the chat');
  // not a command: nothing happens to the body; a slash command neither
  const before = await companion(a.id);
  const r2 = await chat(a, sess.id, 'can you follow up on the email from Dana?');
  assert.equal(r2.run.companion, undefined);
  const r3 = await chat(a, sess.id, '/stop');
  assert.equal(r3.run.companion, undefined);
  assert.equal((await companion(a.id))?.state, before.state);
  // "wait here": waiting where it is; its brain calling wait again (with a place it made up) changes nothing
  const r5 = await chat(a, sess.id, 'Wait here for a bit.');
  assert.equal(r5.run.companion?.ok, true, JSON.stringify(r5.run.companion));
  const tEnd = r5.events.find(e => e.type === 'tool.end' && /already done|not done|done:/.test(e.text || ''));
  assert.ok(r5.events.some(e => e.type === 'tool.start' && e.name === 'wait'), 'its brain did call wait');
  assert.match(JSON.stringify(tEnd || {}), /already done/, 'not done twice: ' + JSON.stringify(r5.events.filter(e => /tool/.test(e.type))));
  const w = await companion(a.id);
  assert.equal(w?.kind, 'hold', JSON.stringify(w));
  assert.equal(w.state, 'waiting');
  assert.doesNotMatch(String(w.place || ''), /Some Restaurant/, 'still waiting where it was told');
  // let go, said so
  const r4 = await chat(a, sess.id, "thanks, that's all");
  assert.match(r4.run.companion?.text || '', /back to their day/);
  assert.equal(await waitFor(async () => !(await companion(a.id))), true);
});

test('its brain decides itself: asked in its own words, it uses its "come along" tool', async () => {
  const a = agents[1];
  const sess = (await owner.post('/api/chat-sessions/create', { agent: a.id, label: 'Brain' })).json.session;
  const r = await chat(a, sess.id, 'I would love to take you along to see the city tonight, what do you say?');
  assert.equal(r.run.companion, undefined, 'no plain command: the reflex left it to the brain');
  const tool = r.events.find(e => e.type === 'tool.end' && e.name === undefined ? false : e.type === 'tool.end');
  assert.ok(r.events.some(e => e.type === 'tool.start' && e.name === 'come_along'), 'it used its tool');
  assert.ok(tool?.ok !== false);
  const end = r.events.find(e => e.type === 'run.end');
  assert.equal(end.text, 'On my way to you!');
  const c = await waitFor(() => companion(a.id));
  assert.ok(c, 'a companion now');
  assert.equal(c.via, 'brain');
  assert.equal(c.leader.kind, 'player');
});




test('out with its owner, a companion answers as the one out there even when its job is its default mode', async () => {
  const a = agents[1];
  assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'work', company: 'Acme Dental', instructions: 'Answer the phone.' })).status, 200);
  const sess = (await owner.post('/api/chat-sessions/create', { agent: a.id })).json.session;
  await chat(a, sess.id, 'follow me');
  await wait(1500);
  assert.ok(await companion(a.id), "it is its owner's companion");
  // (its owner stands still where it is; it comes over — waiting beside them)
  const me = (await owner.get(`/api/agent/${(await companion(a.id)).i}`)).json;
  ws.send(JSON.stringify({ t: 'pwarp', x: me.pos.x + 1.2, z: me.pos.z, ctx: me.pos.ctx }));
  const aw = await waitFor(async () => { const v = (await owner.get(`/api/awareness?agent=${a.id}`)).json; return v.now?.together ? v : null; }, 20000);
  assert.ok(aw, 'they ended up together: ' + JSON.stringify((await owner.get(`/api/awareness?agent=${a.id}`)).json.now));
  const n = seen.length;
  await chat(a, sess.id, 'Where are we now?');
  const call = seen.slice(n).find(j => j.stream);
  const sys = String(call.messages.find(m => m.role === 'system')?.content || '');
  const last = String(call.messages.filter(m => m.role === 'user').at(-1)?.content || '');
  assert.match(sys, /In this chat you talk with/, 'the one out there, not the one at its desk');
  assert.doesNotMatch(sys, /This chat is WORK/, "its job's default does not speak for it while it is out with its owner");
  assert.match(last, /are together right now/, 'the full picture, not one line');
  assert.doesNotMatch(last, /Your body in the city:/, "not the work chat's short line");
  // (a run with its senses off — its phone, a visitor's chat — is never told it is together with anyone)
  const off = await owner.post('/api/providers/runs', { agent: a.id, session: sess.id, input: 'on the phone', aware: false });
  assert.equal(off.status, 200, off.text);
  const ended = await waitFor(async () => { const e = (await owner.get('/api/providers/runs/events?run=' + off.json.runId)).json; return e.done ? e : null; }, 20000);
  assert.ok(ended, 'it answered');
  const c2 = [...seen].reverse().find(j => j?.stream && j.messages?.some(m => /on the phone/.test(String(m.content))));
  const sys2 = String(c2.messages.find(m => m.role === 'system')?.content || '');
  const last2 = String(c2.messages.filter(m => m.role === 'user').at(-1)?.content || '');
  assert.match(sys2, /This chat is WORK/, 'no senses: its job default again');
  assert.doesNotMatch(last2, /are together right now|Around you:/, 'nothing of the city with its senses off');
});

test('a work chat apart from its owner is about the job: one line of where its body is, never the full picture — and nothing kept as sent', async () => {
  const a = agents[1];
  assert.equal((await owner.post('/api/agent-work', { agent: a.id, defaultMode: 'work', company: 'Acme Dental', instructions: 'Answer the phone.' })).status, 200);
  // (no longer a companion; its owner far off; its awareness "always": a Life chat would get the full picture now)
  await owner.post('/api/companions/dismiss-all', {});
  const me = (await owner.get(`/api/agent/${a.i}`)).json;
  ws.send(JSON.stringify({ t: 'pwarp', x: me.pos.x + 400, z: me.pos.z, ctx: -1 }));
  assert.equal((await owner.post('/api/awareness', { agent: a.id, mode: 'always' })).status, 200);
  assert.ok(await waitFor(async () => !(await owner.get(`/api/awareness?agent=${a.id}`)).json.now?.together, 20000), 'apart');
  const sess = (await owner.post('/api/chat-sessions/create', { agent: a.id })).json.session;
  const packs = (await owner.get('/api/awareness/overview')).json.packs;
  const n = seen.length;
  const r = await chat(a, sess.id, 'Any calls this morning?');
  const call = seen.slice(n).find(j => j.stream);
  const sys = String(call.messages.find(m => m.role === 'system')?.content || '');
  const last = String(call.messages.filter(m => m.role === 'user').at(-1)?.content || '');
  assert.match(sys, /This chat is WORK/, 'its job, apart from its owner');
  assert.match(last, /Your body in the city: /, 'one line of where its body is');
  assert.doesNotMatch(last, /Around you:|apart right now|Unchanged since/, 'not the city\'s full picture');
  assert.equal((await owner.get('/api/awareness/overview')).json.packs, packs, 'its senses were not packed for a note nobody sent (nothing remembered as told)');
  assert.equal(r.events.find(e => e.type === 'run.end')?.aware, undefined, 'and it knew nothing of the city beyond that line');
  // (the same chat in Life: the full picture, as its owner chose)
  assert.equal((await owner.post('/api/chat-sessions/prefs', { agent: a.id, session: sess.id, mode: 'life' })).status, 200);
  const k = seen.length;
  await chat(a, sess.id, 'And where are you now?');
  const life = String(seen.slice(k).find(j => j.stream).messages.filter(m => m.role === 'user').at(-1)?.content || '');
  assert.match(life, /apart right now/);
  assert.ok((await owner.get('/api/awareness/overview')).json.packs > packs, 'packed for the note it got');
  await owner.post('/api/awareness', { agent: a.id, mode: null });
});
