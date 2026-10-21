// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Who may do what, swept on real servers (step 8, 2026-10-08: "make sure all admin settings/controls are properly
// applied to admin accounts and all member accounts have user controls … a user can't hack or make themselves admin, nor
// have controls over the world or agents that they shouldn't"). The route table comes from the server itself (GET
// /api/routes, administrators only), so a route added later is swept too.
// - A member is refused every route of an administrator or the owner; a member can't raise their own role, run the
//   world, or act on agents, connections or private records that aren't theirs or shared with them to manage - and what
//   is shared to use stays use.
// - An administrator is refused the owner's own controls and can't raise
//   anyone - themselves included - to their own role or above.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { CAPS } from '../server/auth/permissions.js';

// a route's path for a probe: a prefix route gets a made-up id after it
const probePath = r => (r.path.endsWith('*') ? `${r.path.slice(0, -1)}1` : r.path);
const call = (c, r) => (r.method === 'GET' ? c.get(probePath(r)) : c.post(probePath(r), {}));

let P, owner, ann, bob, routesP, X, M, U, inst;
before(async () => {
  P = await startServer({ population: 260, agents: 3 });
  owner = await ownerSession(P);
  routesP = (await owner.get('/api/routes')).json.routes;
  ann = await userSession(P, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bob = await userSession(P, owner, { login: 'bob', displayName: 'Bob', role: 'member' });
  [X, M, U] = (await owner.get('/api/agents')).json.agents;   // X: the owner's alone; M: shared with Ann to manage; U: to use
  assert.equal((await owner.post('/api/agents/share', { id: M.id, kind: 'account', who: ann.id, level: 'manage' })).status, 200);
  assert.equal((await owner.post('/api/agents/share', { id: U.id, kind: 'account', who: ann.id, level: 'use' })).status, 200);
  const c = await owner.post('/api/connections', { kind: 'models', label: 'House brain', scope: 'installation', config: { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'x' }, secrets: { apiKey: 'k' } });
  assert.equal(c.status, 200, c.text);
  inst = c.json.id;
});
after(async () => { await P?.stop(); });

test('the census: every route the server answers names a capability, and there are administrator and owner routes to sweep', () => {
  assert.ok(routesP.length > 200, `${routesP.length} routes`);
  assert.ok(routesP.every(r => CAPS[r.cap]), 'a known capability each');
  const high = routesP.filter(r => r.principal === 'account' && ['admin', 'owner'].includes(r.min || CAPS[r.cap].min)).length;
  assert.ok(high >= 40, `${high} administrator and owner routes`);
});

test('a member is refused every route of an administrator or the owner', async () => {
  const high = routesP.filter(r => r.principal === 'account' && ['admin', 'owner'].includes(r.min || CAPS[r.cap].min));
  const let_through = [];
  for (const r of high) {
    const res = await call(ann, r);
    if (res.status !== 403) let_through.push(`${r.method} ${r.path} [${r.cap}] → ${res.status} ${res.text.slice(0, 80)}`);
  }
  assert.deepEqual(let_through, [], 'every one refused with 403');
});

test('a member can\'t raise their own role, by any door', async () => {
  const me0 = (await ann.get('/api/auth/me')).json;
  assert.equal(me0.account.role, 'member');
  await ann.post('/api/account/settings', { values: { role: 'admin', 'account.role': 'admin' } });
  await ann.post('/api/account/name', { name: 'Ann', role: 'owner' });
  assert.equal((await ann.post('/api/users/update', { id: ann.id, role: 'admin' })).status, 403, 'users.manage');
  assert.equal((await ann.post('/api/permissions', { cap: 'world.edit', min: 'member' })).status, 403, 'the permissions table');
  assert.equal((await ann.post('/api/settings', { values: { 'talk.maxMessages': 100 } })).status, 403, 'installation settings');
  assert.equal((await ann.post('/api/owner/transfer', { id: ann.id })).status, 403);
  const me1 = (await ann.get('/api/auth/me')).json;
  assert.equal(me1.account.role, 'member', 'still a member');
  assert.equal(me1.caps?.includes?.('world.edit') ?? false, false);
});

test('a member doesn\'t run the world: no clock, no commands, no edits off their lots, no residents, roads or land', async () => {
  assert.equal((await ann.post('/api/clock', { rate: 50 })).status, 403);
  assert.equal((await ann.post('/api/command', { i: 1, cmd: 'home' })).status, 403);
  const w = (await ann.get('/api/world')).json.world;
  const city = w.buildings.find(b => b && !b.gone && b.floors > 1);
  const L = w.levels[city.lv[0]], it = L.items.find(x => x.id);
  const ops = [
    { op: 'bld.set', b: city.idx, name: 'Ann Tower' },
    { op: 'item.add', b: city.idx, f: 0, t: 'desk', x: 1, z: 1 },
    ...(it ? [{ op: 'item.del', b: city.idx, f: 0, id: it.id }] : []),
    { op: 'person.set', i: 5, name: 'Renamed' },
    { op: 'person.add', name: 'New Person' },
    { op: 'road.del', id: 0 },
    { op: 'terrain.add', kind: 'hill', x: 0, z: 0 },
    { op: 'sign.hide', b: city.idx, on: true },
    { op: 'station.add', x: 0, z: 0 },
  ];
  for (const o of ops) {
    const r = await ann.post('/api/edit', { ops: [o] });
    if (process.env.SHOW) console.log('   edit', o.op, r.status, r.text.slice(0, 160));
    assert.ok(r.status === 403 || (r.json && r.json.ok === false), `${o.op} refused (${r.status} ${r.text.slice(0, 120)})`);
  }
  const after = (await ann.get('/api/world')).json.world;
  assert.equal(after.buildings[city.idx].name, city.name, 'the building is as it was');
});

test('a member acts only on agents that are theirs or shared with them to manage - never on others, never beyond "use"', async () => {
  // the owner's agent, not shared: as if it didn't exist
  for (const [m, p, b] of [['post', '/api/agents/update', { id: X.id, name: 'Mine now' }], ['post', '/api/agents/remove', { id: X.id }], ['post', '/api/agents/share', { id: X.id, kind: 'account', who: bob.id, level: 'manage' }],
    ['post', '/api/mind/agent', { agent: X.id, cadence: 'daily' }], ['post', '/api/free-will/agent', { agent: X.id, enabled: true }], ['post', '/api/agent-work', { agent: X.id, publicMode: 'greet' }],
    ['post', '/api/agent-posts/leave', { agent: X.id }], ['post', '/api/agent-life/plans', { agent: X.id, add: { kind: 'want', text: 'x' } }], ['post', '/api/agent-talk/block', { agent: X.id, account: bob.id }],
    ['get', `/api/mind/thoughts?agent=${X.id}`], ['get', `/api/agent-life/profile?agent=${X.id}`], ['get', `/api/agent-talk/conversations?agent=${X.id}`], ['get', `/api/agent-posts/spots?agent=${X.id}`]]) {
    const r = m === 'get' ? await ann.get(p) : await ann.post(p, b);
    assert.ok([403, 404].includes(r.status), `${p} on someone else's agent: ${r.status} ${r.text.slice(0, 100)}`);
  }
  // shared to use: she chats with it, she doesn't manage it
  assert.equal((await ann.post('/api/agents/update', { id: U.id, name: 'Renamed' })).status, 403);
  assert.equal((await ann.post('/api/agents/remove', { id: U.id })).status, 403);
  // shared to manage: she changes what a manager may - never whose it is
  const up = await ann.post('/api/agents/update', { id: M.id, name: 'Managed', ownerId: ann.id });
  assert.equal(up.status, 200, up.text);
  const m = (await owner.get('/api/agents')).json.agents.find(a => a.id === M.id);
  assert.equal(m.mine, true, 'still the owner\'s');
  assert.equal((await ann.get('/api/agents')).json.agents.find(a => a.id === M.id)?.mine, false, 'not hers');
});

test('a member can\'t take, change or share the installation\'s connections, nor make one for everyone', async () => {
  assert.notEqual((await ann.post('/api/connections', { kind: 'models', label: 'Mine for all', scope: 'installation', config: { provider: 'custom', baseUrl: 'https://example.com/v1', model: 'x' }, secrets: { apiKey: 'k' } })).status, 200, 'no installation-wide connection');
  for (const [p, b] of [['/api/connections/update', { id: inst, label: 'Hacked' }], ['/api/connections/remove', { id: inst }], ['/api/connections/share', { id: inst, kind: 'account', who: bob.id, level: 'use' }]]) {
    const r = await ann.post(p, b);
    assert.ok([403, 404].includes(r.status), `${p}: ${r.status} ${r.text.slice(0, 100)}`);
  }
  const list = (await ann.get('/api/connections')).json.connections || [];
  assert.ok(!JSON.stringify(list).includes('"apiKey"') && !JSON.stringify(list).includes('"k"'), 'no secrets in what she reads');
});

test('reading the world shows no one\'s private things: no task text, no others\' chats, money or audit', async () => {
  const pub = (await bob.get(`/api/agent/${X.i}`)).json;
  assert.ok(!('task' in (pub.presence || {})), 'what an agent works on stays its owner\'s');
  for (const p of ['/api/audit', '/api/users', '/api/economy/admin', '/api/settings', '/api/mind/overview']) assert.equal((await ann.get(p)).status, 403, p);
  assert.deepEqual((await ann.get('/api/chat/recent')).json.sessions || [], [], 'none of anyone else\'s chats');
});

// ---------------------------------------------------------------------------------------- self-hosted: admin vs owner
test('self-hosted: an administrator is refused the owner\'s own controls, and can\'t raise anyone to their own role or above', async () => {
  const S = await startServer({ population: 120, agents: 1 });
  try {
    const own = await ownerSession(S);
    const routes = (await own.get('/api/routes')).json.routes;
    const cara = await userSession(S, own, { login: 'cara', displayName: 'Cara', role: 'admin' });
    const dan = await userSession(S, own, { login: 'dan', displayName: 'Dan', role: 'member' });
    const ownerOnly = routes.filter(r => r.principal === 'account' && CAPS[r.cap].min === 'owner');
    assert.ok(ownerOnly.length >= 5, `${ownerOnly.length} owner-only routes`);
    const let_through = [];
    for (const r of ownerOnly) { const res = await call(cara, r); if (res.status !== 403) let_through.push(`${r.method} ${r.path} → ${res.status}`); }
    assert.deepEqual(let_through, [], 'every owner-only route refused to an administrator');
    const ownerId = (await own.get('/api/auth/me')).json.account.id;
    const up = async (id, role) => { const r = await cara.post('/api/users/update', { id, role }); if (process.env.SHOW) console.log('   role', id, role, r.status, r.text.slice(0, 120)); return r; };
    // (role changes need a fresh password entry: Cara just signed in)
    assert.equal((await up(dan.id, 'admin')).status, 403, 'not to her own role');
    assert.equal((await up(cara.id, 'owner')).status, 403, 'not herself');
    assert.equal((await up(ownerId, 'member')).status, 403, 'not the owner');
    assert.equal((await cara.get('/api/auth/me')).json.account.role, 'admin');
    assert.equal((await dan.get('/api/auth/me')).json.account.role, 'member');
  } finally { await S.stop(); }
});

test('chats, lots and per-agent controls: a member reaches only her own (the families Jev ranked next)', async () => {
  // the owner's chat with its own agent X, and a project
  const ses = await owner.post('/api/chat-sessions/create', { agent: X.id, label: 'Private plans' });
  assert.equal(ses.status, 200, ses.text);
  const sid = ses.json.session?.id ?? ses.json.session?.key ?? ses.json.session;
  const proj = await owner.post('/api/chat/projects/create', { agent: X.id, name: 'Secret project' });
  const pid = proj.json.project?.id;
  const tries = [
    ['/api/chat-sessions/rename', { agent: X.id, session: sid, label: 'Mine' }],
    ['/api/chat-sessions/delete', { agent: X.id, session: sid }],
    ['/api/providers/runs', { agent: X.id, input: 'hello' }],
    ['/api/providers/approvals', { run: 'r1', approval: 'a1', approved: true }],
    ...(pid ? [['/api/chat/projects/update', { agent: X.id, project: pid, name: 'Taken' }], ['/api/chat/projects/delete', { agent: X.id, project: pid }]] : []),
    ['/api/voice/agent', { agent: X.id, voice: 'alloy' }],
    ['/api/agent-work/notes', { agent: X.id, add: { text: 'x' } }],
    ['/api/agent-life/memories', { agent: X.id, add: { text: 'x' } }],
    ['/api/economy/agent/limits', { agent: X.id, dailyCap: 999999 }],
  ];
  for (const [p, b] of tries) {
    const r = await ann.post(p, b);
    if (process.env.SHOW) console.log('   try', p, r.status, r.text.slice(0, 110));
    assert.ok(r.status >= 400 && r.status !== 401, `${p}: ${r.status} ${r.text.slice(0, 120)}`);
  }
  assert.ok([403, 404].includes((await ann.get(`/api/voice/agent?agent=${X.id}`)).status));
  // an agent she may use (U): still only her own chats with it, never the owner's
  const su = await owner.post('/api/chat-sessions/create', { agent: U.id, label: 'Owner only' });
  assert.equal(su.status, 200, su.text);
  const usid = su.json.session?.id ?? su.json.session?.key ?? su.json.session;
  for (const [p, b] of [['/api/chat-sessions/rename', { agent: U.id, session: usid, label: 'Mine' }], ['/api/chat-sessions/delete', { agent: U.id, session: usid }], ['/api/chat-sessions/switch', { agent: U.id, session: usid }]]) {
    const r = await ann.post(p, b);
    if (process.env.SHOW) console.log('   own-chat', p, r.status, r.text.slice(0, 110));
    assert.ok([403, 404].includes(r.status), `${p} on the owner's chat: ${r.status} ${r.text.slice(0, 120)}`);
  }
  const still = (await owner.get(`/api/chat-sessions?agent=${U.id}`)).json;
  assert.ok(JSON.stringify(still).includes('Owner only'), 'the owner\'s chat is untouched');
  const search = (await ann.get('/api/chat/search?q=Private')).json.results || [];
  assert.equal(search.length, 0, 'none of the owner\'s chats in her search');
  // the city's lots: no merging, access, names or rights for her
  const lots = (await ann.get('/api/property/lots')).json.lots || [];
  const city = lots.filter(l => l.holder?.kind !== 'account').slice(0, 2);
  if (city.length === 2) {
    for (const [p, b] of [['/api/property/merge', { ids: city.map(l => l.id) }], ['/api/property/access', { id: city[0].id, access: 'private' }],
      ['/api/property/info', { id: city[0].id, name: 'Ann\'s lot' }], ['/api/property/delegate', { id: city[0].id, login: 'ann', rights: ['furnish', 'build'] }]]) {
      const r = await ann.post(p, b);
      if (process.env.SHOW) console.log('   lot', p, r.status, r.text.slice(0, 110));
      assert.ok(r.status >= 400 && r.status !== 401, `${p}: ${r.status} ${r.text.slice(0, 120)}`);
    }
  }
});

test('an agent\'s owner alone removes it and chooses who else has it: a manager can\'t; everyone of a role may only use it', async () => {
  const del = await ann.post('/api/agents/remove', { id: M.id });
  assert.deepEqual([del.status, del.json.code], [403, 'forbidden'], 'a manager doesn\'t remove it');
  const onward = await ann.post('/api/agents/share', { id: M.id, kind: 'account', who: bob.id, level: 'manage' });
  assert.equal(onward.status, 403, 'nor shares it onward');
  assert.equal((await ann.post('/api/agents/unshare', { id: M.id, kind: 'account', who: ann.id })).status, 403, 'nor changes who has it');
  assert.ok((await owner.get('/api/agents')).json.agents.some(a => a.id === M.id), 'still there');
  const everyone = await owner.post('/api/agents/share', { id: X.id, kind: 'role', who: 'member', level: 'manage' });
  assert.deepEqual([everyone.status, everyone.json.code], [400, 'bad_level'], 'not "every member may manage it"');
  assert.equal((await owner.post('/api/agents/share', { id: X.id, kind: 'role', who: 'member', level: 'use' })).status, 200, 'every member may use it');
  assert.equal((await owner.post('/api/agents/unshare', { id: X.id, kind: 'role', who: 'member' })).status, 200);
});
