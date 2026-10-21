// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a member sees, 2026-10-09 (found testing with a paid member account): the Connections list names no adapters still
// to come and offers only what this account may add; each agent says whether it is public (anyone may talk with it) for
// the team list's My agents / Public switch; the home view keeps its true distance and an account without one starts over
// the whole city; a roof's stair house stays on the roof and clear of the owner's billboards.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { bulkheadAt, roofSignFrame } from '../shared/signs.js';
import { frameFromCamera, readEnvelope, writeEnvelope, overviewEnvelope, worldEnvelope, worldValue, homeEnvelope } from '../client/js/core/home-frame.js';

// ------------------------------------------------------------------ the roof's stair house
test('the stair house stays inside the parapet, and steps back from a billboard on its side of the roof', () => {
  const B = { w: 12, d: 10, floors: 6 }, hw = 6, hd = 5, rx = 1.45, rz = 1.45;
  const at = (sg, core = { x: 0, z: 4.6 }) => bulkheadAt(core, rx, rz, hw, hd, sg.map(s => ({ sg: s, F: roofSignFrame(B, s) })));
  const inRoof = p => Math.abs(p.x) + rx <= hw - 0.4 && Math.abs(p.z) + rz <= hd - 0.4;
  assert.ok(inRoof(at([])), 'a core at the edge: the house is held inside the roof');
  for (const edge of ['front', 'back', 'left', 'right']) {
    const s = { edge, size: 'l', at: 0 }, F = roofSignFrame(B, s);
    const p = at([s], { x: edge === 'left' ? -5 : edge === 'right' ? 5 : 0, z: edge === 'front' ? 4.6 : edge === 'back' ? -4.6 : 0 });
    assert.ok(inRoof(p), `${edge}: inside the roof`);
    const gap = edge === 'front' ? F.lz - (p.z + rz) : edge === 'back' ? (p.z - rz) - F.lz : edge === 'left' ? (p.x - rx) - F.lx : F.lx - (p.x + rx);
    assert.ok(gap >= 1.49, `${edge}: clear of the billboard's frame and legs (${gap.toFixed(2)} m)`);
  }
  // a billboard elsewhere on the roof leaves the house where its core is
  const far = at([{ edge: 'front', size: 's', at: 1 }], { x: -3, z: 0 });
  assert.deepEqual([far.x, far.z], [-3, 0]);
});

// ------------------------------------------------------------------ the home view
const cam = (x, z, dist, yaw = 0.7, pitch = 0.9) => ({ goal: { x, y: 0, z }, goalDist: dist, goalYaw: yaw, goalPitch: pitch, maxDist: 950 });
test('a home view keeps its true distance, and without one the camera starts over the whole city', () => {
  const env = frameFromCamera(cam(40, -20, 420));
  assert.equal(env.dist, 420, 'the module holds a frame to 120 m; the envelope keeps the real distance');
  assert.equal(readEnvelope(writeEnvelope(env)).dist, 420);
  const grid = { minX: -300, maxX: 300, minZ: -250, maxZ: 250 };
  const o = overviewEnvelope(grid, { maxDist: 950 });
  assert.deepEqual([o.frame.x, o.frame.z], [0, 0], 'over the middle of the city');
  assert.ok(o.dist >= 250 && o.dist <= 950, `far enough to see the city (${o.dist} m)`);
  // the account's own, then the city's default, then the overview
  assert.equal(homeEnvelope({ own: env, world: null, grid }).dist, 420);
  const w = worldValue(frameFromCamera(cam(5, 6, 300)));
  assert.equal(worldEnvelope(JSON.parse(JSON.stringify(w))).dist, 300, 'the city\'s default keeps its distance too');
  assert.equal(homeEnvelope({ own: null, world: w, grid }).frame.x, 5);
  assert.equal(homeEnvelope({ own: null, world: null, grid }).dist, o.dist);
  assert.equal(worldEnvelope(null), null);
});

// ------------------------------------------------------------------ on a platform server
let s, owner, ann;
before(async () => {
  s = await startServer({ population: 200, agents: 3, env: { MVW_PROVIDER_TEST: '1' } });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
});
after(async () => { await s?.stop(); });

test('Connections: only kinds that work are listed, and it says which this account may add', async () => {
  const kinds = (await ann.get('/api/providers')).json.kinds;
  assert.ok(kinds.length, 'some kinds');
  assert.ok(kinds.every(k => k.implemented), `no adapter still to come is listed: ${kinds.filter(k => !k.implemented).map(k => k.id)}`);
  assert.ok(!JSON.stringify(kinds).includes('WP2.'), 'no work package named anywhere');
  const mine = kinds.filter(k => k.addable).map(k => k.id);
  for (const k of kinds.filter(x => !x.addable && !x.system)) {
    const r = await ann.post('/api/connections', { kind: k.id, label: 'x', config: {}, secrets: { apiKey: 'k', token: 't' } });
    assert.equal(r.status, 403, `${k.id}: what the list says is not addable, the server refuses (${r.status})`);
  }
  const own = (await owner.get('/api/providers')).json.kinds;
  assert.ok(own.filter(k => k.addable).length >= mine.length, 'the owner may add at least as much');
});

test('agents say whether they are public: a brain that takes a visitor, and an owner who lets anyone talk', async () => {
  const agents = (await owner.get('/api/agents')).json.agents;
  assert.ok(agents.every(a => a.public === false), 'no brain yet: nobody can talk with them');
  const c = await owner.post('/api/connections', { kind: 'models', label: 'Brain', scope: 'installation', config: { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'fake' }, secrets: { apiKey: 'k' } });
  assert.equal(c.status, 200, c.text);
  const [A, B] = agents;
  for (const a of [A, B]) assert.equal((await owner.post('/api/agents/update', { id: a.id, connectionId: c.json.id, nativeId: 'mind' })).status, 200);
  const seen = async who => Object.fromEntries((await who.get('/api/agents')).json.agents.map(a => [a.id, a]));
  let v = await seen(ann);
  assert.equal(v[A.id].public, true, 'a brain and visitors get its life: public');
  assert.equal(v[A.id].mine, false, 'not Ann\'s');
  assert.equal(v[agents[2].id].public, false, 'no brain: only greets, not public');
  assert.equal((await owner.post('/api/agent-work', { agent: B.id, publicMode: 'greet' })).status, 200);
  v = await seen(ann);
  assert.equal(v[B.id].public, false, 'its owner lets visitors have only a greeting: not public');
  assert.equal((await owner.get('/api/agents')).json.agents.find(a => a.id === A.id).mine, true, 'the owner\'s own (the installation\'s agents are the owner\'s)');
});

test('the team list\'s choice is an account preference', async () => {
  assert.equal((await ann.post('/api/account/settings', { values: { 'display.teamView': 'public' } })).status, 200);
  const row = (await ann.get('/api/account/settings')).json.settings.find(x => x.path === 'display.teamView');
  assert.equal(row.value, 'public');
  assert.equal((await ann.post('/api/account/settings', { values: { 'display.teamView': 'everyone' } })).status, 400, 'mine or public only');
});
