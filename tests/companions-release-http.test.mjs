// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Companions let go when there is nobody to be a companion of (2026-11-20, found on the live site by a first-day test: a
// new member was told "You already have 3 companions with you" — agents removed while following a player, whose
// account was deleted, kept following that player's number, and the next account given the same number found them):
// an agent removed while it follows its owner is nobody's companion from that moment (not listed, not counted); an
// account deleted lets go of the companions following its player at once; orders left on bodies that are nobody's
// companions are swept.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner;
const wait = ms => new Promise(r => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(150); } };

/** A live connection as `client` (its player in the world). */
async function play(client) {
  const w = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: client.cookie } });
  const msgs = [];
  w.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
  await new Promise((res, rej) => { w.onopen = res; w.onerror = () => rej(new Error('ws error')); });
  await waitFor(() => msgs.find(m => m.t === 'you'));
  w.send(JSON.stringify({ t: 'pobserve', on: false }));
  await wait(400);
  return w;
}

before(async () => {
  s = await startServer({ population: 220, agents: 5 });
  owner = await ownerSession(s);
});
after(async () => { await s?.stop(); });

test('an agent removed while it follows its owner is nobody\'s companion: not listed, not counted', async () => {
  const w = await play(owner);
  try {
    const made = [];
    for (const name of ['Ava', 'Bo', 'Cy']) { const r = await owner.post('/api/agents', { name, emoji: '🙂', role: 'Friend' }); assert.equal(r.status, 200, r.text); made.push(r.json); }
    for (const a of made) { const r = await owner.post('/api/companions', { agent: a.id, action: 'follow', target: 'me' }); assert.equal(r.status, 200, r.text); }
    assert.equal((await owner.get('/api/companions')).json.companions.length, 3);
    for (const a of made) assert.equal((await owner.post('/api/agents/remove', { id: a.id })).status, 200);
    assert.deepEqual((await owner.get('/api/companions')).json.companions, [], 'none listed');
    // the companions' limit (3) counts no removed agent: a 4th agent may come along
    const d = (await owner.post('/api/agents', { name: 'Dee', emoji: '🙂', role: 'Friend' })).json;
    const r = await owner.post('/api/companions', { agent: d.id, action: 'follow', target: 'me' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await owner.get('/api/companions')).json.companions.length, 1);
    await owner.post('/api/agents/remove', { id: d.id });
  } finally { w.close(); }
});

test('an account deleted lets go of the companions following its player at once', async () => {
  const ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const meId = (await ann.get('/api/auth/me')).json.account.id;
  // the owner's agent, shared with Ann to manage, goes along with Ann
  const a = (await owner.post('/api/agents', { name: 'Eve', emoji: '🙂', role: 'Friend' })).json;
  assert.equal((await owner.post('/api/agents/share', { id: a.id, kind: 'account', who: meId, level: 'manage' })).status, 200);
  const w = await play(ann);
  try {
    const r = await ann.post('/api/companions', { agent: a.id, action: 'follow', target: 'me' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await ann.get('/api/companions')).json.companions.length, 1);
  } finally { w.close(); }
  // Ann deletes her account: Eve is let go at once — no order left following that player's number
  assert.equal((await ann.post('/api/auth/reauth', { password: ann.password })).status, 200);
  assert.equal((await ann.post('/api/account/delete', { password: ann.password })).status, 200);
  const info = (await owner.get(`/api/agent/${a.i ?? (await owner.get('/api/agents')).json.agents.find(x => x.id === a.id)?.i}`)).json;
  const lead = info?.order?.lead || info?.companion?.leader || null;
  assert.ok(!lead || lead.id !== meId, `nobody follows the deleted account's player (${JSON.stringify(lead)})`);
  const audit = await waitFor(() => /let go: their leader's account was deleted/.test(s.log()), 5000);
  assert.ok(audit, 'the server says so');
});
