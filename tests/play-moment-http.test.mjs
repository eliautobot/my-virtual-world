// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Moments over HTTP on a real server (POST /api/play/moment, docs/features/play-modules.md, awareness.md §5): a page says
// where its run stands — checked by its module, only the run's own account, a few at a time; a guest can't; a module
// without moments refuses. And the car radio's WebSocket message (radio_tune) is taken without an error.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, bob;
before(async () => {
  s = await startServer({ population: 60, agents: 0 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob' });
});
after(async () => { await s?.stop(); });

test('a moment: the run\'s own account, checked by its module, a few at a time; another\'s run, a guest and a bad one are refused', async () => {
  const st = await ann.post('/api/play/start', { module: 'arcade', course: 'block-drop' });
  assert.equal(st.status, 200, JSON.stringify(st.json));
  const run = st.json.run;
  const ok = await ann.post('/api/play/moment', { run, live: { score: 1200, lives: 2, detail: { level: 3, lines: 9 } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json, { ok: true });
  assert.equal((await bob.post('/api/play/moment', { run, live: { score: 1 } })).status, 404, 'not Bob\'s run');
  assert.equal((await ann.post('/api/play/moment', { run: 'nope', live: { score: 1 } })).status, 404);
  const bad = await ann.post('/api/play/moment', { run, live: { score: 'lots' } });
  assert.equal(bad.status, 400); assert.equal(bad.json.code, 'bad_moment');
  assert.equal((await ann.post('/api/play/moment', { run, live: { score: 1250 } })).status, 200, 'the third of the burst');
  const fast = await ann.post('/api/play/moment', { run, live: { score: 1300 } });
  assert.equal(fast.status, 429, 'a burst of three, then one every two seconds'); assert.equal(fast.json.code, 'too_fast');
  const guest = await fetch(new URL('/api/play/moment', s.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ run, live: { score: 1 } }) });
  assert.ok([401, 403].includes(guest.status));
  await new Promise(r => setTimeout(r, 2100));
  const big = await ann.post('/api/play/moment', { run, live: { score: 5, junk: 'x'.repeat(20000) } });
  assert.equal(big.status, 200, 'what the module doesn\'t know is dropped');
});

test('the car radio\'s message (radio_tune) is taken on the live stream without an error', async () => {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: ann.cookie } });
  const msgs = [];
  ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('WebSocket error')); });
  try {
    ws.send(JSON.stringify({ t: 'radio_tune', station: 'velvet' }));
    ws.send(JSON.stringify({ t: 'radio_tune', station: null }));
    ws.send(JSON.stringify({ t: 'ping', id: 7 }));
    const t0 = Date.now();
    while (!msgs.some(m => m.t === 'pong' && m.id === 7) && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 30));
    assert.ok(msgs.some(m => m.t === 'pong' && m.id === 7), 'the stream goes on');
    assert.equal(msgs.filter(m => m.t === 'error').length, 0, JSON.stringify(msgs.filter(m => m.t === 'error')));
  } finally { ws.close(); }
});
