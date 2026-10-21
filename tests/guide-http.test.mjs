// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Getting started (2026-10-09): GET /api/guide tells the in-world guide (client/js/ui/guide.js) whether this ACCOUNT has
// been through the welcome tour and which of the first things it has done, from what it really holds - land bought, an
// agent made, a home view set - never from the browser. The tour's state is the account's own (display.guide): one
// account finishing it says nothing about another; a guest has no guide.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { parseGuide } from '../server/guide.js';

const done = g => Object.fromEntries(g.tasks.map(t => [t.id, t.done]));

test('parseGuide keeps only what it knows', () => {
  assert.deepEqual(parseGuide(''), { tour: null, list: null });
  assert.deepEqual(parseGuide('{"tour":"done","list":"hidden","x":1}'), { tour: 'done', list: 'hidden' });
  assert.deepEqual(parseGuide('{"tour":"maybe"}'), { tour: null, list: null });
  assert.deepEqual(parseGuide('not json'), { tour: null, list: null });
});

test('the guide: per account, from what it holds; the tour once per account, not per browser', { timeout: 240000 }, async () => {
  const dir = tempDir('mvw-guide-');
  await (await startServer({ data: dir, population: 120 })).stop({ keepData: true });
  const rb = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '3', '--nz', '2'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rb.status, 0, rb.stderr);
  const s = await startServer({ data: dir, population: 120 });
  try {
    const owner = await ownerSession(s);
    // here members make their own agents (the owner's choice) and land is sold for Virtual Coin (the economy is on)
    assert.equal((await owner.post('/api/permissions', { cap: 'agents.manage', min: 'member' })).status, 200);
    assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
    const ann = await userSession(s, owner, { login: 'ann' }), bob = await userSession(s, owner, { login: 'bob' });

    // a guest has no guide
    assert.equal((await fetch(s.url + '/api/guide')).status, 401);

    // a new member: nothing done, the tour not seen; every first step a member can take here is offered
    let g = (await ann.get('/api/guide')).json;
    assert.deepEqual(g.guide, { tour: null, list: null });
    assert.deepEqual(g.tasks.map(t => t.id), ['land', 'build', 'agent', 'talk', 'home']);
    assert.ok(g.tasks.every(t => !t.done));

    // finishing the tour is kept with Ann's account; Bob (say, on the same browser) still gets his own
    assert.equal((await ann.post('/api/account/settings', { values: { 'display.guide': JSON.stringify({ tour: 'done', list: null }) } })).status, 200);
    assert.equal((await ann.get('/api/guide')).json.guide.tour, 'done');
    assert.equal((await bob.get('/api/guide')).json.guide.tour, null, 'another account\'s tour is its own');

    // a home view, an agent and land tick themselves off
    assert.equal((await ann.post('/api/account/settings', { values: { 'display.home': '{"v":1,"x":0,"z":0,"d":80}' } })).status, 200);
    const ag = await ann.post('/api/agents', { name: 'Nova', emoji: '🚀', role: 'Scout' });
    assert.equal(ag.status, 200, ag.text);
    const L = (await owner.get('/api/property/lots')).json.lots.find(l => l.holder.kind === 'municipality' && l.origins === 1);
    const tr = await owner.post('/api/property/transfer', { id: L.id, login: 'ann', reason: 'A test of the guide' });
    assert.equal(tr.status, 200, tr.text);
    g = (await ann.get('/api/guide')).json;
    // (the city's lot came with its building: a building on her land is Build on it done)
    assert.deepEqual(done(g), { land: true, build: true, agent: true, talk: false, home: true }, JSON.stringify(g.tasks));
    assert.ok(Object.values(done((await bob.get('/api/guide')).json)).every(v => !v), 'Bob has done none of it');

    // a bad stored value never breaks the guide
    assert.equal((await bob.post('/api/account/settings', { values: { 'display.guide': '{oops' } })).status, 200);
    assert.deepEqual((await bob.get('/api/guide')).json.guide, { tour: null, list: null });
  } finally { await s.stop(); }
});
