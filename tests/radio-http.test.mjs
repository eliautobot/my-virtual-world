// MVW Radio over HTTP (server/radio/routes.js) on a real server: everyone sees the stations' hosts, an administrator
// gives a station a host and chooses the voice, a player may not; bad values refused; a break's audio only by its name;
// a show for anyone, an agent's shows only for whoever manages it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ownerSession, userSession } from '../tools/lib/testserver.mjs';

test('hosts: the administrator assigns, everyone sees, players may not', async () => {
  const s = await startServer({ population: 40, agents: 2, env: { MVW_RADIO: 'off' } });
  try {
    const o = await ownerSession(s);
    const st = await o.get('/api/radio/state');
    assert.equal(st.status, 200); assert.equal(st.json.stations.length, 4); assert.ok(st.json.stations.every(x => x.hostNames.length === 0));
    const adm = await o.get('/api/radio/admin');
    assert.equal(adm.json.config.voice, 'host');   // (each host's own voice by default) assert.ok(adm.json.agents.length >= 2);
    const id = adm.json.agents[0].id;
    const set = await o.post('/api/radio/admin', { hosts: { grapevine: id } });
    assert.equal(set.status, 200); assert.deepEqual(set.json.stations.find(x => x.id === 'grapevine').hosts, [id]);
    const lim = await o.post('/api/radio/admin', { station: { ...set.json.stations.find(x => x.id === 'grapevine'), talkEvery: 1, talkMax: 20 } });
    assert.equal(lim.status, 200); assert.deepEqual(['talkEvery', 'talkMax'].map(k => lim.json.stations.find(x => x.id === 'grapevine')[k]), [1, 20]);
    const add = await o.post('/api/radio/admin', { station: { name: 'Night Owl', freq: '105.1', band: 'FM', genres: ['jazz'] } });
    assert.equal(add.status, 200); assert.ok(add.json.stations.some(x => x.name === 'Night Owl'));
    assert.ok((await o.get('/api/radio/state')).json.stations.some(x => x.name === 'Night Owl'), 'every listener gets the new station');
    assert.equal((await o.get('/api/radio/state')).json.stations.find(x => x.id === 'grapevine').hostNames[0].id, id);
    assert.equal((await o.post('/api/radio/admin', { voice: 'nope' })).status, 400);
    assert.equal((await o.post('/api/radio/admin', { hosts: { velvet: 999999 } })).status, 400);
    assert.equal((await o.get('/api/radio/audio/..%2Fconfig.json')).status, 404);
    const p = await userSession(s, o, { login: 'listener', displayName: 'Listener' });
    assert.ok([401, 403].includes((await p.post('/api/radio/admin', { hosts: { velvet: id } })).status), 'a member may not');
    assert.equal((await p.get('/api/radio/state')).status, 200, 'but listens');
    // the shows (2026-10-28): one as it went out, for anyone listening; an agent's shows, only for whoever manages it
    assert.equal((await p.get('/api/radio/show?id=2026-10-28-0123456789')).status, 404);
    assert.deepEqual((await o.get(`/api/radio/shows?agent=${id}`)).json, { shows: [] });
    assert.equal((await p.get(`/api/radio/shows?agent=${id}`)).status, 404, 'not someone else\'s agent\'s');
  } finally { await s.stop(); }
});
