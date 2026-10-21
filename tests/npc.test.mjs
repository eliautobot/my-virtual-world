// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.12 the resident editor: an administrator gives a resident a home in a chosen building, work in a chosen building
// with its hours, and a daily routine; removes a resident (they move away) and brings them back with undo. Members
// cannot; an agent's resident keeps what its agent gives it; times out of range are refused in clock terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ownerSession, userSession } from '../tools/lib/testserver.mjs';
import { generateWorld } from '../server/world/generate.js';
import { generatePopulation } from '../server/sim/population.js';
import { WorldIndex } from '../server/sim/windex.js';
import { Editor } from '../server/world/edit.js';

test('undo never double-books: a bed or desk taken meanwhile gives way to a free one', () => {
  const world = generateWorld({ seed: 'wp4-npc', population: 0 }), index = new WorldIndex(world);
  const people = generatePopulation(world, index, { population: 300, roster: [] });
  const ed = new Editor({ world, sim: { people, index } });
  const [i, k] = people.map((p, n) => n).filter(n => people[n].home && people[n].job?.id !== undefined);
  const want = { home: structuredClone(people[i].home), job: structuredClone(people[i].job), sched: structuredClone(people[i].sched) };
  // i moved out and changed jobs; k took i's old bed and desk
  people[k].home = structuredClone(want.home); people[k].job = structuredClone(want.job);
  people[i].home = null; people[i].job = { kind: 'free', title: 'Free time' };
  const st = { people: new Set(), replan: new Set() };
  ed.setPersonLife(i, want, st);
  assert.equal(people[i].home, null, 'bed taken: re-homed later');
  assert.equal(people[i].job.lost, 1, 'desk taken: looks for work');
  assert.ok(st.replan.has(i));
  // nobody took them: both come back
  people[k].home = null; people[k].job = { kind: 'free', title: 'Free time' };
  ed.setPersonLife(i, want, st);
  assert.deepEqual(people[i].home, want.home); assert.deepEqual(people[i].job, want.job);
});

test('resident editor over the API: home, work, hours, routine, removal and undo; members cannot', async () => {
  const s = await startServer({ population: 80 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    const w = (await owner.get('/api/world')).json.world;
    let people = (await owner.get('/api/people')).json.people;
    const i = people.findIndex(p => !p.x && !p.v && p.hb >= 0);
    assert.ok(i >= 0, 'a resident with a home');
    const live = w.buildings.filter(b => b && !b.gone);
    const apt = live.find(b => b.type === 'apartment' && b.idx !== people[i].hb) || live.find(b => b.type === 'apartment');
    const office = live.find(b => b.type === 'office' && b.floors >= 2);
    assert.ok(apt && office);
    const info = async () => (await owner.get(`/api/agent/${i}`)).json;

    assert.equal((await alice.post('/api/edit', { ops: [{ op: 'person.set', i, home: { b: apt.idx } }] })).status, 403, 'members cannot move residents');
    assert.equal((await alice.post('/api/edit', { ops: [{ op: 'person.del', i }] })).status, 403, 'members cannot remove residents');

    let r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i, home: { b: apt.idx } }] });
    assert.equal(r.status, 200, r.text);
    assert.equal((await info()).home.b, apt.idx, 'a free bed in the chosen building');

    r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i, job: { b: office.idx }, hours: { start: 8, end: 16 } }] });
    assert.equal(r.status, 200, r.text);
    let a = await info();
    assert.equal(a.job.b, office.idx); assert.equal(a.job.kind, 'office'); assert.equal(a.job.start, 8); assert.equal(a.job.end, 16);
    assert.ok(a.sched.wake <= 7.5, 'up before work');

    r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i, sched: { wake: 6, lunch: 12.5, bed: 23 } }] });
    assert.equal(r.status, 200, r.text);
    a = await info();
    assert.deepEqual([a.sched.wake, a.sched.lunch, a.sched.bed], [6, 12.5, 23]);

    r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i, sched: { wake: 6, lunch: 9, bed: 23 } }] });
    assert.equal(r.status, 400); assert.match(r.json.error, /Lunch must be between 10:30 and 15:30/);
    r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i, hours: { start: 17, end: 9 } }] });
    assert.equal(r.status, 400); assert.match(r.json.error, /ends after it starts/);

    // removed: they move away (kept, never deleted); undo brings them back with their home and work
    r = await owner.post('/api/edit', { ops: [{ op: 'person.del', i }] });
    assert.equal(r.status, 200, r.text);
    people = (await owner.get('/api/people')).json.people;
    assert.equal(people[i].x, 1);
    assert.equal((await info()).retired, true);
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'person.set', i, home: 'auto' }] })).status, 400, 'nobody to re-home');
    assert.equal((await owner.post('/api/undo')).status, 200);
    people = (await owner.get('/api/people')).json.people;
    assert.equal(people[i].x, 0);
    a = await info();
    assert.equal(a.home.b, apt.idx); assert.equal(a.job.b, office.idx);

    // any free home, and looking for work: the city finds them one
    r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i, home: 'auto', job: 'auto' }] });
    assert.equal(r.status, 200, r.text);
    a = await info();
    assert.ok(a.home, 'given a free home');
    r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i, job: 'free' }] });
    assert.equal(r.status, 200, r.text);
    assert.equal((await info()).job.kind, 'free');

    // an agent's resident keeps what its agent gives it
    const vip = (await owner.get('/api/people')).json.people.findIndex(p => p.v);
    if (vip >= 0) {
      r = await owner.post('/api/edit', { ops: [{ op: 'person.set', i: vip, job: 'free' }] });
      assert.equal(r.status, 400); assert.match(r.json.error, /agent/);
      assert.equal((await owner.post('/api/edit', { ops: [{ op: 'person.del', i: vip }] })).status, 400);
    }
  } finally { await s.stop(); }
});
