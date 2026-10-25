// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Agents on post only on their owner's own property, in a city of lots (server/agent-posts/posts.js, 2026-10-23: "only
// the account owner can have the access to the furniture item button, for their building/property, for their agents,
// for their account...even admins. that way none one can accidently assign an agent to someone elses property"): a
// player sees the ⋯ of the counters and desks on their own lot and puts their own agent there; the world's owner, an
// administrator, sees none there and posts none there, nor on the city's buildings; nor does the player on the city's.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { giveBuilding } from './helpers/own-lot.mjs';
import { isServiceDesk } from '../shared/catalog.js';

let s, owner, ann, A, nova, hers, city;
/** The first floor of building B (in world w) with a counter, a checkout or a reception desk: { b, f, item }. */
const deskIn = (w, B) => {
  for (let f = 0; f < B.floors; f++) { const it = w.levels[B.lv[f]]?.items.find(x => isServiceDesk(x.t)); if (it) return { b: B.idx, f, item: it.id }; }
  return null;
};
const floorOf = async (who, d) => (await who.get(`/api/agent-posts/floor?b=${d.b}&f=${d.f}`)).json.items || [];

before(async () => {
  const dir = tempDir('mvw-posts-lots-');
  await (await startServer({ data: dir, population: 120 })).stop({ keepData: true });
  const rb = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '3', '--nz', '2'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(rb.status, 0, rb.stderr);
  s = await startServer({ data: dir, population: 120 });   // (no agents: option, which would seed a new city)
  owner = await ownerSession(s);
  assert.equal((await owner.post('/api/permissions', { cap: 'agents.manage', min: 'member' })).status, 200);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const ace = await owner.post('/api/agents', { name: 'Ace', emoji: '🛎️', role: 'Concierge' });
  assert.equal(ace.status, 200, ace.text);
  A = ace.json.agent || ace.json;
  const made = await ann.post('/api/agents', { name: 'Nova', emoji: '🚀', role: 'Shopkeeper' });
  assert.equal(made.status, 200, made.text);
  nova = made.json.agent || made.json;
  // Ann's lot: a building of the city with a counter or a desk, now hers; and another still the city's
  const g = await giveBuilding(owner, 'ann', (B, w) => !!deskIn(w, B));
  const w = (await owner.get('/api/world')).json.world, lots = new Map((await owner.get('/api/property/lots')).json.lots.map(l => [l.id, l]));
  hers = deskIn(w, w.buildings[g.b]);
  const other = w.buildings.find(B => B && !B.gone && B.idx !== g.b && B.lot && lots.get(B.lot)?.holder?.kind === 'municipality' && deskIn(w, B));
  city = other && deskIn(w, other);
  assert.ok(hers && city, 'a counter or a desk on Ann\'s lot, and one in a building of the city');
});
after(async () => { await s?.stop(); });

test('the ⋯: Ann sees the counters and desks on her own lot; the owner (an administrator) none there, nor on the city\'s', async () => {
  const mine = await floorOf(ann, hers);
  assert.ok(mine.some(x => x.id === hers.item), `Ann sees hers (${JSON.stringify(mine.map(x => x.name))})`);
  assert.deepEqual(await floorOf(owner, hers), [], 'not the administrator: it is Ann\'s property');
  assert.deepEqual(await floorOf(owner, city), [], 'nor on the city\'s land');
  assert.deepEqual(await floorOf(ann, city), [], 'nor Ann on the city\'s');
});

test('posting: Ann her own agent on her own lot, there at once; the owner never there, nor on the city\'s; nor Ann on the city\'s', async () => {
  const r = await ann.post('/api/agent-posts/here', { agent: nova.id, ...hers });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.post.item, hers.item);
  for (const [who, agent, at, what] of [[owner, A.id, hers, 'the administrator on Ann\'s lot'], [owner, A.id, city, 'the administrator on the city\'s land'], [ann, nova.id, city, 'Ann on the city\'s land']]) {
    const x = await who.post('/api/agent-posts/here', { agent, ...at });
    assert.deepEqual([x.status, x.json.code], [403, 'not_yours'], `${what}: ${x.text}`);
    const y = await who.post('/api/agent-posts', { agent, ...at, slot: 0 });
    assert.ok(y.status === 403 || y.json.code === 'not_a_post', `${what}, from the Studio too: ${y.text}`);
  }
  assert.deepEqual((await owner.get(`/api/agent-posts/spots?agent=${A.id}`)).json.buildings, [], 'the owner holds no lot: no spots');
  const sp = (await ann.get(`/api/agent-posts/spots?agent=${nova.id}`)).json.buildings;
  assert.ok(sp.length && sp.every(x => x.b === hers.b), 'Ann\'s spots: her own building only');
});
