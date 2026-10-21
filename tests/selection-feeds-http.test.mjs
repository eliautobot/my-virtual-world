// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The selection card's feeds (client/js/ui/sel-feeds.js): what a person did lately (server/recent.js) and their money
// lately (server/economy/views.js personFeed). A resident's are public; an agent's day and money are its owner's — an
// account it is shared with to manage reads its day, only its owner its money; anyone else is told "private", never shown.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

let s, owner, ann, agents, resident;
const wait = ms => new Promise(r => setTimeout(r, ms));
before(async () => {
  s = await startServer({ population: 240, agents: 2 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  agents = (await owner.get('/api/agents')).json.agents;
  assert.equal((await owner.post('/api/economy/admin/switch', { name: 'enabled', on: true })).status, 200);
  const taken = new Set(agents.map(a => a.i));
  resident = [...Array(200).keys()].find(i => !taken.has(i));
  await owner.post('/api/clock', { skip: 3 });   // a few hours of the city's life
  await wait(1500);
});
after(async () => { await s?.stop(); });

test('a resident\'s recent activity is public, oldest first, in the activity log\'s words; nonsense and unknown people are 404', async () => {
  let r = null;
  for (let k = 0; k < 20; k++) { r = await ann.get(`/api/people/recent?i=${resident}`); if (r.json?.activity?.length) break; await wait(500); }
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.activity.length > 0, 'something lived already');
  assert.ok(r.json.activity.length <= 12);
  for (const x of r.json.activity) {
    assert.equal(typeof x.label, 'string'); assert.ok(x.label.length > 2);
    assert.match(x.when, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d\d (AM|PM)$/);
    assert.ok(Number.isInteger(x.minutes) && x.minutes >= 0);
  }
  assert.ok(r.json.activity.filter(x => x.now).length <= 1, 'at most the last line is going on now');
  if (r.json.activity.some(x => x.now)) assert.equal(r.json.activity[r.json.activity.length - 1].now, true);
  for (const bad of ['abc', '-1', '99999999', '']) assert.equal((await ann.get(`/api/people/recent?i=${bad}`)).status, 404, bad);
});

test('an agent\'s day is private: its owner and a manage share read it, a use share and strangers do not', async () => {
  const a = agents[0];
  const mine = await owner.get(`/api/people/recent?i=${a.i}`);
  assert.equal(mine.status, 200); assert.equal(mine.json.private, undefined); assert.ok(Array.isArray(mine.json.activity));
  const theirs = await ann.get(`/api/people/recent?i=${a.i}`);
  assert.equal(theirs.status, 200); assert.equal(theirs.json.private, true); assert.deepEqual(theirs.json.activity, []);
  assert.equal((await owner.post('/api/agents/share', { id: a.id, kind: 'account', who: String(ann.id), level: 'use' })).status, 200);
  assert.equal((await ann.get(`/api/people/recent?i=${a.i}`)).json.private, true, 'using an agent is not reading its life');
  assert.equal((await owner.post('/api/agents/share', { id: a.id, kind: 'account', who: String(ann.id), level: 'manage' })).status, 200);
  const managed = await ann.get(`/api/people/recent?i=${a.i}`);
  assert.equal(managed.json.private, undefined);
  assert.deepEqual(managed.json.activity, mine.json.activity.length ? (await owner.get(`/api/people/recent?i=${a.i}`)).json.activity : managed.json.activity);
});

test('money lately: a resident\'s purchases and settlements are public; an agent\'s statement is its owner\'s alone', async () => {
  const r = await ann.get(`/api/economy/person?i=${resident}`);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.wallet && Number.isSafeInteger(r.json.wallet.balance));
  assert.ok(Array.isArray(r.json.lines));
  for (const l of r.json.lines) { assert.ok(Number.isSafeInteger(l.amount)); assert.equal(typeof l.label, 'string'); assert.ok(l.at > 0); }
  for (let k = 1; k < r.json.lines.length; k++) assert.ok(r.json.lines[k].at >= r.json.lines[k - 1].at, 'oldest first');
  // an agent's money: give it some, its owner sees the line; a manager who is not its owner and a stranger see "private"
  const a = agents[1];
  assert.equal((await owner.post('/api/economy/agent/move', { agent: a.id, dir: 'fund', amount: 1234 })).status, 200);
  const own = await owner.get(`/api/economy/person?i=${a.i}`);
  assert.equal(own.status, 200);
  assert.ok(own.json.lines.some(l => l.amount === 1234 && l.kind === 'fund'), JSON.stringify(own.json.lines.slice(-3)));
  const stranger = await ann.get(`/api/economy/person?i=${a.i}`);
  assert.equal(stranger.json.private, true); assert.deepEqual(stranger.json.lines, []);
  assert.equal((await owner.post('/api/agents/share', { id: a.id, kind: 'account', who: String(ann.id), level: 'manage' })).status, 200);
  assert.equal((await ann.get(`/api/economy/person?i=${a.i}`)).json.private, true, 'its money stays its owner\'s');
  assert.ok(!JSON.stringify(stranger.json).includes('1234'));
  assert.equal(stranger.json.wallet, null, 'nor its balance');
  // the money-at-a-glance route keeps it the same way
  assert.ok((await owner.get(`/api/economy/resident?i=${a.i}`)).json.resident.wallet, 'its owner sees its wallet');
  assert.equal((await ann.get(`/api/economy/resident?i=${a.i}`)).json.resident.wallet, null);
  assert.ok((await ann.get(`/api/economy/resident?i=${resident}`)).json.resident.wallet, 'a resident\'s savings stay public');
  assert.equal((await ann.get('/api/economy/person?i=99999999')).status, 404);
});
