// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// HTTP API and WebSocket of a throwaway server (free port, temporary data folder). Reads run as a guest; writes run
// as the owner (signed in with the first-owner password, which the owner then replaces). Access rules: auth.test.mjs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { decodePlans } from '../shared/proto.js';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner;
before(async () => { s = await startServer({ population: 200 }); owner = await ownerSession(s); });
after(async () => { await s?.stop(); });

async function get(p, init) {
  const r = await fetch(s.url + p, init);
  const text = await r.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, text };
}
const post = async (p, body) => {
  const r = await owner.post(p, body);
  return { status: r.status, body: r.json ?? r.text, text: r.text };
};

test('health, world, people and clock describe the same city', async () => {
  const h = await get('/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.ok, true);
  const w = await get('/api/world');
  assert.equal(w.body.version, h.body.worldVersion);
  assert.ok(w.body.world.buildings.filter(b => b && !b.gone).length > 50);
  const p = await get('/api/people');
  assert.equal(p.body.people.length, h.body.agents);
  const c = await get('/api/clock');
  assert.ok(c.body.hour >= 0 && c.body.hour < 24);
  assert.equal(typeof c.body.weekday, 'string');
});

test('lookups answer 404 for unknown residents, buildings and routes', async () => {
  assert.equal((await get('/api/agent/0')).status, 200);
  assert.equal((await get('/api/agent/999999')).status, 404);
  const w = (await get('/api/world')).body.world;
  const b = w.buildings.findIndex(x => x && !x.gone);
  const r = await get('/api/building?b=' + b);
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.occupancy.total, 'number');
  assert.equal((await get('/api/building?b=99999')).status, 404);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/roster')).status, 200);
});

test('an edit changes the world and bumps its version', async () => {
  const w0 = (await get('/api/world')).body;
  const b = w0.world.buildings.findIndex(x => x && !x.gone && x.type !== 'hq');
  const r = await post('/api/edit', { ops: [{ op: 'bld.set', b, name: 'API Test Tower' }], who: 'api-test' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.version, w0.version + 1);
  const w1 = (await get('/api/world')).body;
  assert.equal(w1.version, w0.version + 1);
  assert.equal(w1.world.buildings[b].name, 'API Test Tower');
});

test('invalid edits are refused with a reason', async () => {
  const w0 = (await get('/api/world')).body;
  const hq = w0.world.buildings.findIndex(x => x && !x.gone && x.type === 'hq');
  for (const [op, why] of [
    [{ op: 'nope' }, 'Unknown edit'],
    [{ op: 'bld.set', b: 99999, name: 'x' }, 'No such building'],
  ]) {
    const r = await post('/api/edit', { ops: [op] });
    assert.equal(r.status, 400, op.op);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, why);
  }
  assert.equal((await get('/api/world')).body.version, w0.version, 'nothing changed');
  const r = await post('/api/edit', { ops: [{ op: 'item.add', b: hq, f: 0, t: 'nope', x: 0, z: 0 }] });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Unknown item type');
});

test('the clock rate is clamped', async () => {
  assert.equal((await post('/api/clock', { rate: 1000 })).body.rate, 60);
  assert.equal((await post('/api/clock', { rate: 1 })).body.rate, 1);
});

test('talking to a resident returns a line', async () => {
  const r = await post('/api/talk', { i: 0, x: 0, z: 0 });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.text, 'string');
  assert.equal((await post('/api/talk', { i: 999999 })).status, 404);
});

test('bad request bodies are refused and the server keeps serving', async () => {
  const r = await post('/api/edit', '{"ops": [');
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Bad JSON');
  const big = await post('/api/edit', JSON.stringify({ ops: [], pad: 'x'.repeat(600 * 1024) }));
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'Body too large');
  assert.equal((await get('/api/health')).status, 200);
});

test('static files are served, and nothing outside the web folders is', async () => {
  const page = await get('/');
  assert.equal(page.status, 200);
  assert.match(page.text, /importmap/);
  assert.equal((await get('/shared/constants.js')).status, 200);
  for (const p of ['/..%2fpackage.json', '/shared/..%2f..%2fpackage.json', '/vendor/three/..%2f..%2f..%2fpackage.json',
    '/%2e%2e/%2e%2e/package.json', '/server/index.mjs', '/data/world.json']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.text, /"dependencies"|createServer/, p);
  }
  assert.equal((await get('/%E0%A4%A')).status, 400, 'malformed percent-encoding');
});

test('the WebSocket greets with the population, sends every plan and answers pings', async () => {
  const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws');
  ws.binaryType = 'arraybuffer';
  let hello = null, pong = null, plans = 0;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: hello ${!!hello}, pong ${!!pong}, plans ${plans}`)), 10000);
    ws.onmessage = ev => {
      if (typeof ev.data === 'string') {
        const m = JSON.parse(ev.data);
        if (m.t === 'hello') { hello = m; ws.send(JSON.stringify({ t: 'ping', id: 42 })); } else if (m.t === 'pong') pong = m;
      } else plans += decodePlans(ev.data, () => {});
      if (hello && pong && plans >= hello.count) { clearTimeout(timer); resolve(); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('WebSocket error')); };
  });
  ws.close();
  assert.equal(pong.id, 42);
  assert.ok(hello.count > 0);
});
