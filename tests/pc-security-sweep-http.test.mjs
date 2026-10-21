// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC swept for access (docs/features/agent-pc.md §2): every /api/pc route the server answers (its own route
// table, GET /api/routes - a route added later is swept too), called by everyone who is not the PC's account - the
// installation's owner, an administrator, a member, a person the agent is shared with to manage or to use, a guest -
// with the real ids of three PCs (the owner's, an administrator's, a member's: agent, team, team space, task cards,
// event, trash item, files). Nothing of a PC may come back (its words are marked), nothing in it may change (each PC is
// read whole before and after), and no request may break the server. The same requests made by the PC's own account do
// work, so each refusal is the rule's, not a malformed probe's.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

let s, owner, adm, ann, bob, guest, routes;
const V = {};   // the PCs swept: tag → { c: its account's client, agent, ids… }
const T0 = Date.parse('2026-11-02T14:00:00Z');

/** A PC with something of everything on it, each word marked with its tag. */
async function seed(c, agent, tag) {
  const mark = `swmark${tag}`, ok = r => { assert.ok(r.status < 300, `${tag} seed: ${r.status} ${r.text.slice(0, 200)}`); return r.json; };
  ok(await c.post('/api/pc/write', { profile: agent, path: '~/Documents/secret.md', text: `${mark} the secret, first` }));
  ok(await c.post('/api/pc/write', { profile: agent, path: '~/Documents/secret.md', text: `${mark} the secret, second`, force: true }));
  ok(await c.post('/api/pc/write', { profile: agent, path: '~/Public/shared.md', text: `${mark} public words` }));
  ok(await c.post('/api/pc/write', { profile: agent, path: '~/Documents/gone.md', text: `${mark} thrown away` }));
  ok(await c.post('/api/pc/remove', { profile: agent, path: '~/Documents/gone.md' }));
  const trash = ok(await c.get(`/api/pc/trash?profile=${agent}&path=~`)).items;
  const team = ok(await c.post('/api/pc/teams', { name: `Team ${mark} ${Math.random().toString(36).slice(2, 6)}`, brief: `${mark} brief` }));
  ok(await c.post('/api/pc/teams/member', { team: team.id, agent, role: 'lead' }));
  ok(await c.post('/api/pc/write', { space: team.space, path: '/plan.md', text: `${mark} the team's plan` }));
  const card = ok(await c.post('/api/pc/cards', { profile: agent, path: '~', title: `Card ${mark}`, notes: `${mark} notes` }));
  const tcard = ok(await c.post('/api/pc/cards', { space: team.space, title: `Team card ${mark}` }));
  const ev = ok(await c.post('/api/pc/events', { profile: agent, path: '~', title: `Event ${mark}`, start: T0, end: T0 + 1800000 }));
  return { c, agent, tag, mark, team: team.id, space: team.space, card: card.id, tcard: tcard.id, event: ev.id, trash: trash[0].id };
}
/** A PC read whole, as its own account sees it (what may change on its own - times of screens - left out). */
async function snapshot(v) {
  const g = async p => { const r = await v.c.get(p); return [r.status, r.json]; };
  const pa = `profile=${v.agent}`;
  const pc = (await v.c.get('/api/pc')).json;
  return JSON.stringify({
    pc: { agents: pc.agents.map(a => a.id), teams: pc.teams, gone: pc.goneTeams, usage: pc.usage },
    ls: await Promise.all(['~', '~/Documents', '~/Public', '~/Downloads', '~/Skills'].map(p => g(`/api/pc/ls?${pa}&path=${encodeURIComponent(p)}`))),
    team: await g(`/api/pc/ls?space=${v.space}&path=/`),
    secret: await g(`/api/pc/text?${pa}&path=~/Documents/secret.md`),
    versions: await g(`/api/pc/versions?${pa}&path=~/Documents/secret.md`),
    trash: await g(`/api/pc/trash?${pa}&path=~`),
    board: await g(`/api/pc/board?${pa}&path=~`), tboard: await g(`/api/pc/board?space=${v.space}`),
    events: await g(`/api/pc/events?${pa}&from=${T0 - 100 * 86400000}&to=${T0 + 100 * 86400000}`),
    tevents: await g(`/api/pc/events?space=${v.space}&from=${T0 - 100 * 86400000}&to=${T0 + 100 * 86400000}`),
    profile: await g(`/api/pc/profile?agent=${v.agent}`),
    activity: await g(`/api/pc/activity?agent=${v.agent}`), history: await g(`/api/pc/history?agent=${v.agent}`),
  });
}
/** The probes for one PC: its ids in every field a route reads (each id field once with each of its records). */
function bags(v, name = 'HACKED') {
  const base = { profile: v.agent, agent: v.agent, path: '~/Documents/secret.md', to: '~/Public/', text: 'HACKED', run: 'cat ~/Documents/secret.md\nls ~\ntasks\ncal', session: 'sweep',
    version: 1, autoWork: false, title: 'HACKED', name, brief: 'HACKED', notes: 'HACKED', addNote: 'HACKED', col: 'done', role: 'lead', color: '#000000',
    q: 'swmark', op: 'list', content: 'HACKED', start: T0, end: T0 + 60000, assignee: v.agent, force: true, recursive: true };
  return [
    { ...base, id: v.card, card: v.card, team: v.team },
    { ...base, profile: undefined, space: v.space, path: '/plan.md', id: v.team, team: v.team, card: v.tcard },
    { ...base, id: v.event, card: v.tcard },
    { ...base, id: v.trash },
    { ...base, path: '~', id: v.tcard, op: 'docs' },
  ];
}
// (in a query, to is the end of a calendar's range - in a body, where a file moves to)
const qs = b => new URLSearchParams(Object.entries(b).filter(([, x]) => x !== undefined).map(([k, x]) => [k, k === 'to' && typeof x === 'string' ? String(T0 + 86400000) : String(x)])).toString();
/** One probe: a GET with the fields as its query; a POST with them as its JSON body - or, for an upload, as its query
 *  with a body of bytes. */
function probe(c, r, b) {
  if (r.method === 'GET') return c.get(`${r.path}?${qs({ ...b, from: T0 - 86400000 })}`);
  if (/upload$/.test(r.path)) return c.request('POST', `${r.path}?${qs(b)}`, Buffer.from('HACKED bytes'), { 'content-type': 'text/plain' });
  return c.post(r.path, b);
}

before(async () => {
  s = await startServer({ population: 220, agents: 2 });
  owner = await ownerSession(s);
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  bob = await userSession(s, owner, { login: 'bob', displayName: 'Bob', role: 'member' });
  guest = httpClient(s.url);
  routes = (await owner.get('/api/routes')).json.routes.filter(r => r.path.startsWith('/api/pc'));
  // members may add agents of their own here (the owner's choice in the permissions table), so a member has a PC too
  assert.equal((await owner.post('/api/permissions', { cap: 'agents.manage', min: 'member' })).status, 200);
  const A = (await owner.get('/api/agents')).json.agents[0].id;
  const X = (await adm.post('/api/agents', { name: 'Xena', role: 'Admin helper' })).json.id;
  const N = (await ann.post('/api/agents', { name: 'Nell', role: 'Ann helper' })).json.id;
  assert.ok(A && X && N, 'an agent in each of the three PCs');
  V.own = await seed(owner, A, 'own');
  V.adm = await seed(adm, X, 'adm');
  V.ann = await seed(ann, N, 'ann');
  // shares open an agent elsewhere - never its PC: the owner's to Ann to manage, Ann's to Bob to manage, the admin's to Bob to use
  for (const [c, id, who, level] of [[owner, A, ann, 'manage'], [ann, N, bob, 'manage'], [adm, X, bob, 'use']]) {
    assert.equal((await c.post('/api/agents/share', { id, kind: 'account', who: String(who.me.account.id), level })).status, 200);
  }
});
after(async () => { await s?.stop(); });

test('the census: the PC\'s routes, each behind agents.pc', () => {
  assert.ok(routes.length >= 44, `${routes.length} routes`);
  assert.deepEqual(routes.filter(r => r.cap !== 'agents.pc').map(r => r.path), []);
  assert.deepEqual(routes.filter(r => r.method === 'POST' && !r.csrf).map(r => r.path), [], 'every change needs the session\'s CSRF token');
});

test('nobody outside a PC\'s account reaches it: nothing comes back, nothing changes, nothing breaks', async () => {
  const sides = [
    ['own', [['an administrator', adm], ['a member it is shared with to manage', ann], ['a member', bob], ['a guest', guest]]],
    ['adm', [['the installation\'s owner', owner], ['a member', ann], ['a member it is shared with to use', bob], ['a guest', guest]]],
    ['ann', [['the installation\'s owner', owner], ['an administrator', adm], ['a member it is shared with to manage', bob], ['a guest', guest]]],
  ];
  const leaks = [], broke = [], weak = [];
  let n = 0;
  for (const [tag, who] of sides) {
    const v = V[tag], before = await snapshot(v), mark = v.mark;
    for (const [label, c] of who) {
      for (const r of routes) {
        const statuses = [];
        for (const b of bags(v)) {
          const res = await probe(c, r, b);
          n++;
          statuses.push(res.status);
          if (res.status >= 500) broke.push(`${label} ${r.method} ${r.path} → ${res.status} ${res.text.slice(0, 120)}`);
          if (res.text.toLowerCase().includes(mark)) leaks.push(`${label} ${r.method} ${r.path} (${tag}'s PC) → ${res.status} ${res.text.slice(0, 160)}`);
        }
        // (a route that answered only "bad request" never got as far as the rule: the probe proves nothing there)
        if (statuses.every(x => x === 400)) weak.push(`${label} ${r.method} ${r.path}: ${statuses.join(',')}`);
      }
    }
    assert.equal(await snapshot(v), before, `${tag}'s PC is exactly as it was`);
  }
  assert.deepEqual(leaks, [], 'nothing of another account\'s PC comes back');
  assert.deepEqual(broke, [], 'no request breaks the server');
  assert.deepEqual(weak, [], 'every route was refused by its rule, not for a malformed probe');
  assert.ok(n >= 44 * 5 * 12, `${n} probes`);
});

test('the same probes work for the PC\'s own account (the refusals above are the rule\'s)', async () => {
  // a route answers its own account with 2xx for at least one of the probes - each POST on a fresh copy of the PC, as
  // the probes change it; these are the ones that can't: an agent made here has no computer of its own (§4.1), and a
  // work session needs a brain the test server has none of
  // (and its real browser's controls and live picture: no browser is started here - tests/pc-chrome.test.mjs and the lab's
  // pc-browser-check use a real one)
  const CANT = new Set(['/api/pc/own', '/api/pc/own/file', '/api/pc/own/upload', '/api/pc/work', '/api/pc/work/stop', 'POST /api/pc/browser', '/api/pc/browser/frame']);
  const failed = [];
  for (const r of routes) {
    if (CANT.has(r.path) || CANT.has(`${r.method} ${r.path}`)) continue;
    const v = r.method === 'POST' ? await seed(owner, V.own.agent, `ok${Math.random().toString(36).slice(2, 6)}`) : V.own;
    if (r.path === '/api/pc/teams/restore') assert.equal((await owner.post('/api/pc/teams/delete', { id: v.team })).status, 200);
    const got = [];
    for (const b of bags(v, `Probe ${Math.random().toString(36).slice(2, 8)}`)) { const res = await probe(owner, r, b); got.push(res.status); if (res.status < 300) break; }
    if (!got.some(x => x < 300)) failed.push(`${r.method} ${r.path}: ${got.join(',')}`);
  }
  assert.deepEqual(failed, []);
  // … and those it can't: refused for what they are, not for whose they are
  const own = await owner.get(`/api/pc/own?agent=${V.own.agent}&op=list`);
  assert.equal(own.status, 404); assert.equal(own.json.code, 'no_computer');
});
