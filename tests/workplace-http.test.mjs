// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who is at work over HTTP (server/workplace/routes.js, docs/features/work-presence.md): a person's work (its role, its
// place, its status now and its co-workers on shift) on its card (/api/agent/:i) and at /api/work/person; a workplace's
// staff at /api/work/place; anyone signed in may look (what anyone walking in sees); the settings are there.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner;
const STATES = ['on_duty', 'coming', 'late', 'away', 'break', 'off'];
before(async () => {
  s = await startServer({ population: 300, agents: 2 });
  owner = await ownerSession(s);
});
after(async () => { await s?.stop(); });

test('a worker\'s work on its card and at /api/work/person; its workplace\'s staff at /api/work/place', async () => {
  const people = (await owner.get('/api/people')).json;
  const list = Array.isArray(people) ? people : people.people || [];
  assert.ok(list.length > 50, 'the city');
  // the first few people with a workplace
  let found = null;
  for (let i = 0; i < Math.min(list.length, 300) && !found; i++) {
    const w = (await owner.get(`/api/work/person?i=${i}`)).json;
    if (w.work) found = { i, w };
  }
  assert.ok(found, 'someone works somewhere');
  const { i, w } = found;
  assert.ok(w.work.role && w.work.place && w.work.hours, JSON.stringify(w.work));
  assert.ok(STATES.includes(w.work.state), w.work.state);
  assert.ok(w.place && Number.isInteger(w.place.b));
  // its card says the same
  const card = (await owner.get(`/api/agent/${i}`)).json;
  assert.equal(card.work?.role, w.work.role);
  assert.equal(card.work?.place, w.work.place);
  // its workplace: everyone there, each with a status, it among them
  const [b, f, room] = w.place.key.split(':').map(Number);
  const place = (await owner.get(`/api/work/place?b=${b}&f=${f}&room=${room}`));
  assert.equal(place.status, 200, place.text);
  assert.equal(place.json.name, w.work.place);
  assert.ok(place.json.staff.some(x => x.i === i), 'it works there');
  for (const x of place.json.staff) { assert.ok(STATES.includes(x.state)); assert.ok(x.name && x.role && x.text); }
  // nobody there, or nonsense: 404
  assert.equal((await owner.get('/api/work/place?b=99999&f=0')).status, 404);
  assert.equal((await owner.get('/api/work/place?b=x&f=0')).status, 404);
  assert.equal((await owner.get('/api/work/person?i=abc')).status, 404);
});

test('the settings: the late mark (5 minutes) and the remarks (on)', async () => {
  const r = await owner.get('/api/settings');
  assert.equal(r.status, 200, r.text);
  const flat = JSON.stringify(r.json);
  assert.match(flat, /work\.lateMinutes/);
  assert.match(flat, /work\.remarks/);
});
