// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An Agent Providers' agent's own computer in its owner's PC (docs/features/agent-pc.md §4.1), on a real server against
// the stand-in OpenClaw gateway and Hermes backend (tests/helpers/fake-openclaw.mjs, fake-hermes.mjs): the PC says which
// agents have one; OpenClaw's agent's workspace (read-only, through agents.workspace.list / .get, its own agent id) and its
// documents (agents.files.*, a change sent with the hash it was read at, one made meanwhile refused); Hermes' managed
// files (list, read, a file as itself, upload, a new folder, delete; a sensitive file refused as Hermes refuses it); only
// the listed calls, reads and changes each by their own door; Chat only access changes nothing; a change is audited
// without its contents; nobody but the PC's owner reaches any of it; an agent made here has none.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';
import { startFakeOpenClaw, MEDIA_PNG } from './helpers/fake-openclaw.mjs';
import { startFakeHermes, FILE_PNG } from './helpers/fake-hermes.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
// the stand-in gateway's workspace and documents, per agent (as OpenClaw answers: paths inside the workspace only)
const WS = { main: { dirs: { '': ['notes', 'chart.png', 'README.md'], notes: ['todo.md'] }, files: { 'README.md': '# Main\nHello', 'notes/todo.md': '- one' } } };
const DOCS = { main: new Map([['AGENTS.md', '# Agents\nBe kind.'], ['SOUL.md', 'I am Main.']]) };
const seenIds = [];
const methods = {
  'agents.workspace.list': p => {
    seenIds.push(p.agentId);
    const w = WS[p.agentId], here = w && w.dirs[p.path || ''];
    if (!here) throw { code: 'INVALID_REQUEST', message: 'workspace directory not found', details: { type: 'workspace_path_not_found' } };
    return { agentId: p.agentId, path: p.path || '', ...(p.path ? { parentPath: '' } : {}), totalEntries: here.length, offset: 0,
      entries: here.map(n => { const full = p.path ? `${p.path}/${n}` : n, dir = !!w.dirs[full]; return { path: full, name: n, kind: dir ? 'directory' : 'file', ...(dir ? {} : { size: n.endsWith('.png') ? MEDIA_PNG.length : (w.files[full] || '').length }), updatedAtMs: 1760000000000 }; }) };
  },
  'agents.workspace.get': p => {
    const w = WS[p.agentId];
    if (p.path === 'chart.png') return { agentId: p.agentId, file: { path: 'chart.png', name: 'chart.png', size: MEDIA_PNG.length, updatedAtMs: 1, mimeType: 'image/png', encoding: 'base64', content: MEDIA_PNG.toString('base64') } };
    const t = w && w.files[p.path];
    if (t == null) throw { code: 'INVALID_REQUEST', message: 'workspace file not found' };
    return { agentId: p.agentId, file: { path: p.path, name: p.path.split('/').pop(), size: t.length, updatedAtMs: 1, mimeType: 'text/markdown', encoding: 'utf8', content: t } };
  },
  'agents.files.list': p => ({ agentId: p.agentId, workspace: '/somewhere/real', files: [...DOCS[p.agentId]].map(([name, t]) => ({ name, path: `/somewhere/real/${name}`, missing: false, size: t.length, updatedAtMs: 1 })).concat([{ name: 'MEMORY.md', path: '/x', missing: true }]) }),
  'agents.files.get': p => { const t = DOCS[p.agentId].get(p.name); return { agentId: p.agentId, file: { name: p.name, missing: t == null, size: (t || '').length, hash: t == null ? null : hash(t), content: t || '' } }; },
  'agents.files.set': p => {
    const cur = DOCS[p.agentId].get(p.name);
    if (p.expectedHash && cur != null && hash(cur) !== p.expectedHash) throw { code: 'INVALID_REQUEST', message: `agent file "${p.name}" changed since it was read`, details: { type: 'agent_file_conflict', name: p.name } };
    DOCS[p.agentId].set(p.name, p.content);
    return { ok: true, agentId: p.agentId, file: { name: p.name, hash: hash(p.content) } };
  },
};

let s, owner, ann, gw, hm, oc, ocChat, mainAgent, hmAgent, chatAgent;
async function until(c, id, state, agents = 1) {
  const end = Date.now() + 20000;
  let p = null;
  while (Date.now() < end) {
    p = (await c.get('/api/agent-providers')).json.providers.find(x => x.id === id);
    if (p && p.status && p.status.state === state && p.agents.length >= agents) return p;
    await sleep(120);
  }
  assert.fail(`provider ${id} never reached ${state} (last: ${JSON.stringify(p && p.status)})`);
}
before(async () => {
  gw = await startFakeOpenClaw({ token: 'gw-token-1', agents: [{ id: 'main', name: 'Main' }], methods });
  hm = await startFakeHermes({ token: 'hermes-token-1' });
  s = await startServer({ population: 150 });
  owner = await ownerSession(s);
  ann = await userSession(s, owner, { login: 'ann', displayName: 'Ann', role: 'member' });
  oc = (await owner.post('/api/connections', { kind: 'openclaw', label: 'OpenClaw', scope: 'installation', config: { url: gw.url }, secrets: { token: gw.token } })).json.id;
  mainAgent = (await until(owner, oc, 'connected')).agents.find(a => a.nativeId === 'main').id;
  const h = (await owner.post('/api/connections', { kind: 'hermes', label: 'Hermes', scope: 'installation', config: { url: hm.url, auth: 'token' }, secrets: { token: hm.token } })).json.id;
  hmAgent = (await until(owner, h, 'connected', 2)).agents.find(a => a.nativeId === 'default').id;
});
after(async () => { await s?.stop(); await gw?.stop(); await hm?.stop(); });

const get = (c, q) => c.get(`/api/pc/own?${new URLSearchParams(q)}`);

test('the PC says which agents have a computer of their own, and what of it', async () => {
  const pc = (await owner.get('/api/pc')).json;
  const m = pc.agents.find(a => a.id === mainAgent), h = pc.agents.find(a => a.id === hmAgent);
  assert.deepEqual(m.own, { kind: 'openclaw', label: 'OpenClaw', connection: oc, where: 'workspace', docs: true, write: true, browser: true });
  assert.equal(h.own.where, 'machine'); assert.equal(h.own.docs, false); assert.equal(h.own.write, true); assert.equal(h.own.browser, false);
  const mine = await owner.post('/api/agents', { name: 'Plain', role: 'Helper' });
  assert.equal(mine.status, 200, mine.text);
  const plain = (await owner.get('/api/pc')).json.agents.find(a => a.id === mine.json.id);
  assert.equal(plain.own, null, 'an agent made here lives on this PC');
  const r = await get(owner, { agent: plain.id, op: 'list' });
  assert.equal(r.status, 404); assert.equal(r.json.code, 'no_computer');
});

test('OpenClaw: its workspace, read through the gateway with its own agent id; a picture as itself, sandboxed', async () => {
  const top = await get(owner, { agent: mainAgent, op: 'list', path: '' });
  assert.equal(top.status, 200, top.text);
  assert.deepEqual(top.json.entries.map(e => [e.name, e.dir]), [['notes', true], ['chart.png', false], ['README.md', false]]);
  assert.equal(top.json.parent, null);
  assert.equal(seenIds.at(-1), 'main', 'the provider\'s own id for the agent');
  const sub = await get(owner, { agent: mainAgent, op: 'list', path: 'notes' });
  assert.deepEqual(sub.json.entries.map(e => e.path), ['notes/todo.md']); assert.equal(sub.json.parent, '');
  const rd = await get(owner, { agent: mainAgent, op: 'read', path: 'README.md' });
  assert.equal(rd.json.content, '# Main\nHello'); assert.equal(rd.json.encoding, 'utf8');
  const pic = await fetch(new URL(`/api/pc/own/file?agent=${mainAgent}&path=chart.png`, s.url), { headers: { cookie: owner.cookie } });
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('content-type'), 'image/png');
  assert.match(pic.headers.get('content-security-policy'), /sandbox/);
  assert.ok(Buffer.from(await pic.arrayBuffer()).equals(MEDIA_PNG));
  const md = await fetch(new URL(`/api/pc/own/file?agent=${mainAgent}&path=README.md`, s.url), { headers: { cookie: owner.cookie } });
  assert.equal(md.headers.get('content-type'), 'application/octet-stream', 'anything that could run is a download');
  assert.match(md.headers.get('content-disposition'), /^attachment/);
  const gone = await get(owner, { agent: mainAgent, op: 'read', path: 'nope.md' });
  assert.equal(gone.status, 400); assert.match(gone.json.error, /not found/);
});

test('OpenClaw: its documents, changed with the hash they were read at; one changed meanwhile is refused; audited', async () => {
  const list = await get(owner, { agent: mainAgent, op: 'docs' });
  assert.deepEqual(list.json.files.map(f => [f.name, f.missing]), [['AGENTS.md', false], ['SOUL.md', false], ['MEMORY.md', true]]);
  assert.equal(JSON.stringify(list.json).includes('/somewhere/real'), false, 'no real path of its machine comes back');
  const doc = (await get(owner, { agent: mainAgent, op: 'doc', name: 'SOUL.md' })).json;
  assert.equal(doc.content, 'I am Main.'); assert.ok(doc.hash);
  const set = await owner.post('/api/pc/own', { agent: mainAgent, op: 'docSet', name: 'SOUL.md', content: 'I am Main, kinder.', expectedHash: doc.hash });
  assert.equal(set.status, 200, set.text); assert.equal(set.json.hash, hash('I am Main, kinder.'));
  assert.equal(DOCS.main.get('SOUL.md'), 'I am Main, kinder.');
  // a save from the old copy: refused (someone changed it since)
  const stale = await owner.post('/api/pc/own', { agent: mainAgent, op: 'docSet', name: 'SOUL.md', content: 'Old copy', expectedHash: doc.hash });
  assert.equal(stale.status, 409); assert.equal(stale.json.code, 'conflict');
  assert.equal(DOCS.main.get('SOUL.md'), 'I am Main, kinder.');
  // reads and changes each by their own door; nothing beyond the listed calls
  assert.equal((await get(owner, { agent: mainAgent, op: 'docSet', name: 'SOUL.md' })).status, 400);
  assert.equal((await owner.post('/api/pc/own', { agent: mainAgent, op: 'list' })).status, 400);
  assert.equal((await owner.post('/api/pc/own', { agent: mainAgent, op: 'write', path: 'x.md', content: 'x' })).status, 400, 'OpenClaw\'s workspace is read-only here');
  assert.equal((await owner.post('/api/pc/own', { agent: mainAgent, op: 'agents.delete' })).status, 400);
  const audit = (await owner.get('/api/audit?group=providers')).json;
  const row = audit.events.find(e => e.action === 'provider.computer');
  assert.ok(row, 'the change is in the audit log');
  assert.equal(JSON.stringify(row).includes('kinder'), false, 'never what it carried');
});

test('Hermes: its managed files - list, read, as itself, upload, a folder, delete; a sensitive file refused', async () => {
  hm.files.set('/tmp/notes.txt', { mime: 'text/plain', bytes: Buffer.from('hello hermes') });
  hm.files.set('/tmp/.env', { mime: 'text/plain', bytes: Buffer.from('KEY=secret') });
  const top = await get(owner, { agent: hmAgent, op: 'list' });
  assert.equal(top.status, 200, top.text);
  assert.equal(top.json.root, '/tmp');
  assert.deepEqual(top.json.entries.map(e => e.name).sort(), ['chart.png', 'notes.txt'], 'its sensitive files are not listed');
  const rd = await get(owner, { agent: hmAgent, op: 'read', path: '/tmp/notes.txt' });
  assert.equal(Buffer.from(rd.json.content, 'base64').toString(), 'hello hermes');
  const env = await get(owner, { agent: hmAgent, op: 'read', path: '/tmp/.env' });
  assert.equal(env.status, 403); assert.match(env.json.error, /sensitive/);
  const pic = await fetch(new URL(`/api/pc/own/file?agent=${hmAgent}&path=${encodeURIComponent('/tmp/chart.png')}`, s.url), { headers: { cookie: owner.cookie } });
  assert.equal(pic.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await pic.arrayBuffer()).equals(FILE_PNG));
  // changes: a text saved, a folder, a file uploaded as it is, one there already not replaced unless asked, a deletion
  const w = await owner.post('/api/pc/own', { agent: hmAgent, op: 'write', path: '/tmp/notes.txt', content: 'changed', encoding: 'utf8', mime: 'text/plain', overwrite: true });
  assert.equal(w.status, 200, w.text); assert.equal(hm.files.get('/tmp/notes.txt').bytes.toString(), 'changed');
  assert.equal((await owner.post('/api/pc/own', { agent: hmAgent, op: 'mkdir', path: '/tmp/reports' })).status, 200);
  const up = await owner.request('POST', `/api/pc/own/upload?agent=${hmAgent}&path=${encodeURIComponent('/tmp/reports/a.bin')}`, Buffer.from([1, 2, 3, 250]), { 'content-type': 'application/octet-stream' });
  assert.equal(up.status, 200, up.text);
  assert.deepEqual([...hm.files.get('/tmp/reports/a.bin').bytes], [1, 2, 3, 250]);
  const again = await owner.request('POST', `/api/pc/own/upload?agent=${hmAgent}&path=${encodeURIComponent('/tmp/reports/a.bin')}`, Buffer.from([9]), { 'content-type': 'application/octet-stream' });
  assert.equal(again.status, 409); assert.equal(again.json.code, 'conflict');
  assert.equal((await owner.request('POST', `/api/pc/own/upload?agent=${hmAgent}&path=${encodeURIComponent('/tmp/reports/a.bin')}&replace=1`, Buffer.from([9]), { 'content-type': 'application/octet-stream' })).status, 200);
  const notEmpty = await owner.post('/api/pc/own', { agent: hmAgent, op: 'remove', path: '/tmp/reports' });
  assert.equal(notEmpty.status, 409);
  assert.equal((await owner.post('/api/pc/own', { agent: hmAgent, op: 'remove', path: '/tmp/reports', recursive: true })).status, 200);
  assert.equal(hm.files.has('/tmp/reports/a.bin'), false);
  const out = await get(owner, { agent: hmAgent, op: 'list', path: '/etc' });
  assert.equal(out.status, 403, 'outside Hermes\' own root: refused by Hermes');
});

test('Chat only access: its computer is read, never changed', async () => {
  const c2 = await owner.post('/api/connections', { kind: 'hermes', label: 'Hermes chat', scope: 'installation', config: { url: hm.url, auth: 'token', access: 'chat' }, secrets: { token: hm.token } });
  const p = await until(owner, c2.json.id, 'connected', 2);
  chatAgent = p.agents.find(a => a.nativeId === 'default').id;
  const own = (await owner.get('/api/pc')).json.agents.find(a => a.id === chatAgent).own;
  assert.equal(own.write, false);
  assert.equal((await get(owner, { agent: chatAgent, op: 'list' })).status, 200);
  const w = await owner.post('/api/pc/own', { agent: chatAgent, op: 'mkdir', path: '/tmp/nope' });
  assert.equal(w.status, 403); assert.match(w.json.error, /Chat only/);
  assert.equal(hm.dirs.has('/tmp/nope'), false);
});

test('nobody but the PC\'s owner reaches it: another account sees no such agent', async () => {
  for (const q of [{ agent: mainAgent, op: 'list' }, { agent: hmAgent, op: 'read', path: '/tmp/chart.png' }, { agent: mainAgent, op: 'docs' }]) {
    const r = await get(ann, q);
    assert.equal(r.status, 404, JSON.stringify(q)); assert.equal(r.json.code, 'not_found');
  }
  assert.equal((await ann.post('/api/pc/own', { agent: mainAgent, op: 'docSet', name: 'SOUL.md', content: 'hijack' })).status, 404);
  assert.equal((await ann.request('POST', `/api/pc/own/upload?agent=${hmAgent}&path=%2Ftmp%2Fx`, Buffer.from('x'), { 'content-type': 'text/plain' })).status, 404);
  const pic = await fetch(new URL(`/api/pc/own/file?agent=${hmAgent}&path=${encodeURIComponent('/tmp/chart.png')}`, s.url), { headers: { cookie: ann.cookie } });
  assert.equal(pic.status, 404);
  assert.equal((await ann.get('/api/pc')).json.agents.some(a => a.own), false);
  assert.equal(DOCS.main.get('SOUL.md'), 'I am Main, kinder.');
});
