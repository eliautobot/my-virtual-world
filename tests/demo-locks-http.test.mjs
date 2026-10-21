// Demo mode over HTTP (server/licence.js; the self-hosted release's licence, as release 1's): until a licence key is
// active the world stays the one generated at the first start — building, interiors, signs, layouts, promotional
// aircraft and restoring a world backup are refused on the server — and the installation has at most 3 agents in all,
// built in or connected (a Grok Bot counts like any other; tests/agents-api.test.mjs). Watching, chat and the routes
// that only read stay open.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession } from './helpers/server.mjs';

let s, owner;
before(async () => {
  s = await startServer({ population: 150, agents: 0, demo: true });
  owner = await ownerSession(s);
});
after(async () => { await s?.stop(); });

const locked = (r, what) => {
  assert.equal(r.status, 403, `${what}: ${r.status} ${r.text.slice(0, 120)}`);
  assert.equal(r.json?.code, 'licence_required', what);
  assert.match(r.json.error, /World editing is locked in demo mode/, what);
};

test('demo mode: building, interiors, signs, layouts, promotional aircraft and restoring a world are refused', async () => {
  assert.equal((await owner.get('/api/licence')).json.mode, 'demo');
  locked(await owner.post('/api/edit', { ops: [{ op: 'bld.set', b: 0, name: 'Mine' }] }), 'a world edit');
  locked(await owner.post('/api/layouts/save', { name: 'A layout', b: 0, f: 0 }), 'saving a layout');
  locked(await owner.post('/api/layouts/share', { id: 1 }), 'sharing a layout');
  locked(await owner.request('POST', '/api/signs/image', Buffer.from([0x89, 0x50, 0x4e, 0x47]), { 'content-type': 'image/png' }), 'a sign\'s picture');
  locked(await owner.post('/api/promo-aircraft', { config: {} }), 'the promotional aircraft');
  locked(await owner.request('POST', '/api/world/restore', Buffer.from('{}'), { 'content-type': 'application/json' }), 'restoring a world');
  locked(await owner.post('/api/property/info', { id: 'L00001', name: 'Mine' }), 'a lot\'s name');
});

test('demo mode: watching and reading stay open', async () => {
  for (const p of ['/api/world', '/api/people', '/api/layouts', '/api/promo-aircraft', '/api/property/lots']) assert.equal((await owner.get(p)).status, 200, p);
  const lic = (await owner.get('/api/licence')).json;
  assert.equal(lic.agentLimit, 3);
  assert.deepEqual(lic.locks, ['World editing', 'More than 3 agents (built in or connected)']);
});
