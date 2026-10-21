// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The agents' PC on a real server (docs/features/agent-pc.md): its owner's alone - another account (an administrator, a
// person the agent is shared with to manage, a guest) never reaches it, not by agent, team, space, task or event id;
// files upload and download as they are, shown only when they can't run anything on the site; teams, boards and
// calendars through the routes; live frames only to the owning account.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { startServer, ownerSession, userSession, httpClient } from './helpers/server.mjs';

let s, owner, adm, ann, A, B, X;
before(async () => {
  s = await startServer({ population: 200, agents: 2 });
  owner = await ownerSession(s);
  adm = await userSession(s, owner, { login: 'adm', displayName: 'Adm', role: 'admin' });
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  const list = (await owner.get('/api/agents')).json.agents;
  [A, B] = [list[0].id, list[1].id];
  const x = await adm.post('/api/agents', { name: 'Xena', role: 'Admin helper' });
  assert.equal(x.status, 200, x.text);
  X = x.json.id;
});
after(async () => { await s?.stop(); });

test('the PC is its owner\'s: their agents, nobody else\'s - not an admin\'s, not a manager\'s, not a guest\'s', async () => {
  const o = (await owner.get('/api/pc')).json;
  assert.deepEqual(o.agents.map(a => a.id).sort(), [A, B].sort());
  assert.equal(o.usage.limit, 2 * 200 * 1048576);
  assert.deepEqual((await adm.get('/api/pc')).json.agents.map(a => a.id), [X]);
  assert.deepEqual((await ann.get('/api/pc')).json.agents, []);
  const w = await owner.post('/api/pc/write', { profile: A, path: '~/Documents/secret.md', text: 'the owner\'s secret' });
  assert.equal(w.status, 200, w.text);
  assert.equal(w.json.info.path, '~/Documents/secret.md');
  for (const c of [adm, ann]) {
    assert.equal((await c.get(`/api/pc/ls?profile=${A}&path=~`)).status, 404);
    assert.equal((await c.get(`/api/pc/text?profile=${A}&path=~/Documents/secret.md`)).status, 404);
    assert.equal((await c.get(`/api/pc/file?profile=${A}&path=~/Documents/secret.md`)).status, 404);
    assert.equal((await c.post('/api/pc/write', { profile: A, path: '~/x.md', text: 'x' })).status, 404);
    assert.equal((await c.get('/api/pc/find?q=secret')).json.results.length, 0);
    assert.equal((await c.get(`/api/pc/activity?agent=${A}`)).status, 404);
  }
  // a manage share opens the agent to Ann elsewhere - never its PC
  assert.equal((await owner.post('/api/agents/share', { id: A, kind: 'account', who: String(ann.me.account.id), level: 'manage' })).status, 200);
  assert.equal((await ann.get(`/api/pc/text?profile=${A}&path=~/Documents/secret.md`)).status, 404);
  await owner.post('/api/agents/unshare', { id: A, kind: 'account', who: String(ann.me.account.id) });
  const g = httpClient(s.url);
  assert.equal((await g.get('/api/pc')).status, 401);
  assert.equal((await g.get(`/api/pc/ls?profile=${A}&path=~`)).status, 401);
  // the owner doesn't reach the admin's agent either
  assert.equal((await owner.get(`/api/pc/ls?profile=${X}&path=~`)).status, 404);
});

test('files over HTTP: ls, text, versions, move, trash, restore, upload and download', async () => {
  const p = `profile=${A}`;
  assert.equal((await owner.post('/api/pc/write', { profile: A, path: '~/Documents/plan.md', text: 'v1' })).status, 200);
  const v2 = await owner.post('/api/pc/write', { profile: A, path: '~/Documents/plan.md', text: 'v2', expect: 1 });
  assert.equal(v2.json.info.version, 2);
  const stale = await owner.post('/api/pc/write', { profile: A, path: '~/Documents/plan.md', text: 'v3', expect: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.json.code, 'changed'); assert.equal(stale.json.version, 2);
  const ls = (await owner.get(`/api/pc/ls?${p}&path=${encodeURIComponent('~/Documents')}`)).json;
  assert.ok(ls.entries.some(e => e.name === 'plan.md' && e.byName === 'Owner' || e.name === 'plan.md'));
  assert.equal((await owner.get(`/api/pc/text?${p}&path=${encodeURIComponent('~/Documents/plan.md')}`)).json.text, 'v2');
  assert.deepEqual((await owner.get(`/api/pc/versions?${p}&path=${encodeURIComponent('~/Documents/plan.md')}`)).json.older.map(v => v.version), [1]);
  // a picture: uploaded as it is, shown sandboxed
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(5000, 9)]);
  const up = await owner.request('POST', `/api/pc/upload?${p}&path=${encodeURIComponent('~/Downloads/pic.png')}`, png, { 'content-type': 'image/png' });
  assert.equal(up.status, 200, up.text);
  const got = await fetch(new URL(`/api/pc/file?${p}&path=${encodeURIComponent('~/Downloads/pic.png')}`, s.url), { headers: { cookie: owner.cookie } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.match(got.headers.get('content-security-policy'), /sandbox/);
  assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await got.arrayBuffer()).equals(png));
  // a web page or an SVG never runs on the site: it is a download
  await owner.post('/api/pc/write', { profile: A, path: '~/Downloads/page.html', text: '<script>alert(1)</script>' });
  await owner.post('/api/pc/write', { profile: A, path: '~/Downloads/x.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' });
  for (const f of ['page.html', 'x.svg']) {
    const r = await fetch(new URL(`/api/pc/file?${p}&path=${encodeURIComponent(`~/Downloads/${f}`)}`, s.url), { headers: { cookie: owner.cookie } });
    assert.equal(r.headers.get('content-type'), 'application/octet-stream', f);
    assert.match(r.headers.get('content-disposition'), /^attachment/, f);
  }
  // too big for a file
  const big = await owner.request('POST', `/api/pc/upload?${p}&path=${encodeURIComponent('~/big.bin')}`, Buffer.alloc(26 * 1048576), { 'content-type': 'application/octet-stream' });
  assert.equal(big.status, 413);
  // without the CSRF token a write is refused
  const noCsrf = await fetch(new URL('/api/pc/write', s.url), { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ profile: A, path: '~/x.md', text: 'x' }) });
  assert.equal(noCsrf.status, 403);
  // move, trash, restore
  assert.equal((await owner.post('/api/pc/move', { profile: A, path: '~/Documents/plan.md', to: '~/Public/' })).status, 200);
  assert.equal((await owner.post('/api/pc/remove', { profile: A, path: '~/Public/plan.md' })).status, 200);
  const trash = (await owner.get(`/api/pc/trash?${p}&path=~`)).json.items;
  assert.equal(trash[0].path, '~/Public/plan.md');
  assert.equal((await adm.post('/api/pc/restore', { id: trash[0].id })).status, 404, 'another account can\'t restore it');
  assert.equal((await owner.post('/api/pc/restore', { id: trash[0].id })).json.info.path, '~/Public/plan.md');
  assert.equal((await owner.post('/api/pc/remove', { profile: A, path: '~/Public' })).status, 403, 'the PC\'s own folders stay');
});

test('teams, boards and calendars over HTTP; ids from another account are never found', async () => {
  const t = await owner.post('/api/pc/teams', { name: 'Front Office', brief: 'Answer every customer the same day.' });
  assert.equal(t.status, 200, t.text);
  assert.equal((await owner.post('/api/pc/teams/member', { team: t.json.id, agent: A, role: 'lead' })).status, 200);
  assert.equal((await owner.post('/api/pc/teams/member', { team: t.json.id, agent: B, role: 'member' })).status, 200);
  assert.equal((await owner.post('/api/pc/teams/member', { team: t.json.id, agent: X, role: 'member' })).status, 404, 'an agent of another account never joins');
  assert.equal((await adm.post('/api/pc/teams/member', { team: t.json.id, agent: X, role: 'member' })).status, 404);
  assert.equal((await adm.get(`/api/pc/ls?space=${t.json.space}&path=/`)).status, 404);
  const card = await owner.post('/api/pc/cards', { space: t.json.space, title: 'Call back Mrs Lee', assignee: B });
  assert.equal(card.status, 200, card.text);
  assert.equal((await owner.get(`/api/pc/board?space=${t.json.space}`)).json.cards.length, 1);
  assert.equal((await owner.get(`/api/pc/board?profile=${B}&path=/teams/front-office`)).json.cards[0].title, 'Call back Mrs Lee');
  assert.equal((await adm.post('/api/pc/cards/update', { id: card.json.id, col: 'done' })).status, 404);
  assert.equal((await owner.post('/api/pc/cards/update', { id: card.json.id, col: 'doing' })).json.col, 'doing');
  const day = Date.parse('2026-11-02T14:00:00Z');
  const ev = await owner.post('/api/pc/events', { space: t.json.space, title: 'Weekly sync', start: day, end: day + 1800000 });
  assert.equal(ev.status, 200, ev.text);
  assert.equal((await owner.get(`/api/pc/events?space=${t.json.space}&from=${day - 3600000}&to=${day + 3600000}`)).json.events.length, 1);
  assert.equal((await owner.get(`/api/pc/events?profile=${B}&from=${day - 3600000}&to=${day + 3600000}`)).json.events.length, 1, 'a member sees the team\'s calendar');
  assert.equal((await adm.post('/api/pc/events/remove', { id: ev.json.id })).status, 404);
  assert.equal((await owner.post('/api/pc/teams/delete', { id: t.json.id })).status, 200);
  assert.equal((await owner.get('/api/pc/teams')).json.gone.length, 1);
  assert.equal((await owner.post('/api/pc/teams/restore', { id: t.json.id })).status, 200);
});

test('live PC frames reach the owning account only', async () => {
  const listen = c => new Promise((resolve, reject) => {
    const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: c.cookie, origin: s.url } });
    const frames = [];
    ws.on('message', m => { try { const f = JSON.parse(String(m)); if (f.t === 'pc') frames.push(f); } catch { /* not JSON */ } });
    ws.on('open', () => resolve({ ws, frames }));
    ws.on('error', reject);
  });
  const mine = await listen(owner), theirs = await listen(adm);
  await new Promise(r => setTimeout(r, 300));
  await owner.post('/api/pc/write', { profile: A, path: '~/live.md', text: 'live' });
  await new Promise(r => setTimeout(r, 400));
  mine.ws.close(); theirs.ws.close();
  assert.ok(mine.frames.some(f => f.kind === 'files'), 'the owner hears of it');
  assert.equal(theirs.frames.length, 0, 'another account hears nothing');
});
