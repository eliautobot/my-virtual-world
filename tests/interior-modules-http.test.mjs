// Interior modules over the edit route (shared/interior-modules.js, server/world/edit.js imod.*) on a real server with an
// island: a Radio Station placed, a Radio Studio laid in its studio building (its walls with a doorway and its pieces,
// tagged with its id), resized and moved as one (its old pieces gone, new ones laid), refused where it can't go
// (another building, outside the floor, over another studio, a member), removed, and undone.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, userSession, tempDir, ROOT } from './helpers/server.mjs';
import { Island } from '../shared/terrain.js';
import { RoadNetwork } from '../shared/roads.js';
import { checkWorldModule, accessRoadPath, accessRoadsOf } from '../shared/world-modules.js';
import { interiorBounds } from '../shared/edit.js';

let s, owner, alice, B = null;
const edit = (c, ops, o = {}) => c.post('/api/edit', { ops, ...o });
const world = async () => (await owner.get('/api/world')).json.world;
before(async () => {
  const dir = tempDir('mvw-imod-');
  const first = await startServer({ data: dir, population: 60, agents: 3 }); await first.stop();   // (agents seed a city: before the island goes on)
  for (const tool of ['add-island', 'add-roads']) { const r = spawnSync(process.execPath, [`tools/wp4/${tool}.mjs`, '--data', dir, '--server-stopped'], { cwd: ROOT, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
  s = await startServer({ data: dir, population: 60 });
  owner = await ownerSession(s); alice = await userSession(s, owner, { login: 'alice', displayName: 'Alice' });
  const w = await world(), T = w.terrain, island = new Island(T, { roads: w.roads }), net = RoadNetwork.fromJSON(w.roads);
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: net };
  for (let k = 0; k < 4000 && !B; k++) {
    const a = k * 2.399, rr = T.radius * (0.15 + (k % 11) * 0.06), c = { kind: 'radio', name: 'MVW Radio', x: T.center.x + Math.cos(a) * rr, z: T.center.z + Math.sin(a) * rr, rot: (k % 8) * Math.PI / 4 };
    if (checkWorldModule(w, c, env)) continue;
    const pts = accessRoadPath(c, net), um = v => Math.round(v * 1e6);
    const r = await edit(owner, [{ op: 'wmod.add', module: c }, ...(pts ? [{ op: 'road.set', road: { profile: 'country', name: 'Radio Road', pts: pts.map(p => (p.r ? { x: um(p.x), z: um(p.z), r: um(p.r) } : { x: um(p.x), z: um(p.z) })) } }] : [])], { atomic: true });
    if (r.status === 200) { const W = await world(), m = W.worldModules.find(x => x.id === r.json.results[0].id); B = W.buildings[m.terminal]; }
  }
});
after(async () => { await s?.stop(); });
const floor = async (b, f = 0) => { const W = await world(); return W.levels[W.buildings[b].lv[f]]; };

test('a radio studio: laid, resized, moved, refused where it cannot go, removed, undone', async t => {
  if (!B) return t.skip('no spot for a radio station on this island');
  const ib = interiorBounds(B), x0 = ib.x0 + 0.5, z0 = ib.z0 + 0.5;
  const studio = { kind: 'studio', x0, z0, x1: x0 + 5, z1: z0 + 4, face: 0 };
  assert.equal((await edit(alice, [{ op: 'imod.add', b: B.idx, f: 0, mod: studio }])).status, 403, 'a member may not');
  const add = await edit(owner, [{ op: 'imod.add', b: B.idx, f: 0, mod: studio }]);
  assert.equal(add.status, 200, JSON.stringify(add.json));
  const id = add.json.results[0].id;
  let L = await floor(B.idx);
  const rec = L.mods.find(m => m.id === id);
  assert.equal(rec.kind, 'studio'); assert.match(rec.name, /Radio Studio 1/);
  const items = L.items.filter(i => i.mod === id), walls = L.walls.filter(w => w[5] === id);
  assert.ok(['broadcast_desk', 'acoustic_wall', 'studio_monitors', 'gear_rack', 'on_air_sign', 'studio_clock'].every(t => items.some(i => i.t === t)), `its pieces: ${items.map(i => i.t).join(', ')}`);
  assert.ok(walls.length >= 2, `its walls with a doorway: ${walls.length}`);
  // the studio is a station (server/radio/radio.js syncStudios)
  let st = null; for (let k = 0; k < 40 && !st; k++) { await new Promise(r => setTimeout(r, 250)); st = (await owner.get('/api/radio/state')).json.stations.find(x => x.studio?.room === id && x.studio.b === B.idx); }
  assert.ok(st, 'the studio went on the air as a station'); assert.equal(st.name, rec.name); assert.equal(st.band, 'FM');
  // its hosts: the agents posted at its broadcast desk's seats (the desk's ⋯ menu: /api/agent-posts/here)
  assert.equal(st.hostsFrom, 'desk'); assert.equal(st.hostNames.length, 0);
  const desk = items.find(i => i.t === 'broadcast_desk'), agent = (await owner.get('/api/radio/admin')).json.agents[0];
  const lots = (await owner.get('/api/property/lots')).json.lots?.length || 0;
  const fl = await owner.get(`/api/agent-posts/floor?b=${B.idx}&f=0`);
  assert.ok(fl.json.items?.some(x => x.id === desk.id), `the desk's ⋯ is there for the world's owner (a world module's building; ${lots} lots in this world): ${JSON.stringify(fl.json).slice(0, 200)}`);
  const posted = await owner.post('/api/agent-posts/here', { agent: agent.id, b: B.idx, f: 0, item: desk.id, slot: 1 });
  assert.equal(posted.status, 200, JSON.stringify(posted.json));
  let hosts = []; for (let k = 0; k < 20 && !hosts.length; k++) { hosts = (await owner.get('/api/radio/state')).json.stations.find(x => x.id === st.id)?.hostNames || []; if (!hosts.length) await new Promise(r => setTimeout(r, 250)); }
  assert.deepEqual(hosts.map(h => h.id), [agent.id], 'the agent posted at its desk hosts it');
  // each seat its own post (seatPosts: a ⋯ over each chair): three agents, each at the seat asked for, all three hosts
  const fl2 = (await owner.get(`/api/agent-posts/floor?b=${B.idx}&f=0`)).json.items.find(x => x.id === desk.id);
  assert.equal(fl2.seats, true); assert.equal(fl2.slots.length, 3);
  const others = (await owner.get('/api/radio/admin')).json.agents.filter(a => a.id !== agent.id).slice(0, 2);
  assert.equal(others.length, 2, 'three agents to seat');
  for (const [a, seat] of [[others[0], 0], [others[1], 2]]) { const r = await owner.post('/api/agent-posts/here', { agent: a.id, b: B.idx, f: 0, item: desk.id, slot: seat }); assert.equal(r.status, 200, JSON.stringify(r.json)); }
  const seats = (await owner.get(`/api/agent-posts/floor?b=${B.idx}&f=0`)).json.items.find(x => x.id === desk.id).slots.map(s => s.holder?.agent?.id ?? null);
  assert.deepEqual(seats, [others[0].id, agent.id, others[1].id], 'each in the seat asked for');
  for (let k = 0; k < 20 && hosts.length < 3; k++) { hosts = (await owner.get('/api/radio/state')).json.stations.find(x => x.id === st.id)?.hostNames || []; if (hosts.length < 3) await new Promise(r => setTimeout(r, 250)); }
  assert.deepEqual(hosts.map(h => h.id), [others[0].id, agent.id, others[1].id], 'three hosts, seat by seat');
  assert.equal((await owner.post('/api/agent-posts/here', { agent: others[0].id, b: B.idx, f: 0, item: desk.id, slot: 7 })).status, 400, 'no such seat');
  // laid out again (a resize, or ↺ Lay out again): the desk keeps its id, so its three hosts keep their seats
  const cur = (await floor(B.idx)).mods.find(m => m.id === id);
  const relay = await edit(owner, [{ op: 'imod.set', b: B.idx, f: 0, id, mod: { x0: cur.x0, z0: cur.z0, x1: cur.x1 + 0.5, z1: cur.z1 }, reset: true }]);
  assert.equal(relay.status, 200, JSON.stringify(relay.json));
  const desk2 = (await floor(B.idx)).items.find(i => i.mod === id && i.t === 'broadcast_desk');
  assert.equal(desk2.id, desk.id, 'the desk keeps its id when laid again');
  let after = []; for (let k = 0; k < 20 && after.length < 3; k++) { after = (await owner.get('/api/radio/state')).json.stations.find(x => x.id === st.id)?.hostNames || []; if (after.length < 3) await new Promise(r => setTimeout(r, 250)); }
  assert.deepEqual(after.map(h => h.id), [others[0].id, agent.id, others[1].id], 'and its three hosts their seats');
  // resized and moved as one
  const set = await edit(owner, [{ op: 'imod.set', b: B.idx, f: 0, id, mod: { x0: x0 + 1, z0, x1: x0 + 1 + 3.6, z1: z0 + 3.2 } }]);
  assert.equal(set.status, 200, JSON.stringify(set.json));
  L = await floor(B.idx);
  const r2 = L.mods.find(m => m.id === id);
  assert.deepEqual([r2.x1 - r2.x0, r2.z1 - r2.z0].map(v => Math.round(v * 100) / 100), [3.5, 3.25], 'snapped to the kind\'s quarter-metre step');
  const items2 = L.items.filter(i => i.mod === id);
  assert.ok(items2.some(i => i.t === 'broadcast_desk') && !items2.some(i => i.t === 'gear_rack'), 'a small studio: the desk, no racks');
  assert.ok(items2.every(i => i.x >= r2.x0 - 0.05 && i.x <= r2.x1 + 0.05), 'its pieces moved with it');
  // renamed: its rect as it is (a change with no new rect never snaps it)
  assert.equal((await edit(owner, [{ op: 'imod.set', b: B.idx, f: 0, id, mod: { name: 'Studio A' } }])).status, 200);
  const r3 = (await floor(B.idx)).mods.find(m => m.id === id);
  assert.deepEqual([r3.name, r3.x0, r3.z0, r3.x1, r3.z1], ['Studio A', r2.x0, r2.z0, r2.x1, r2.z1], 'renamed, same rect');
  // refused
  const two = await edit(owner, [{ op: 'imod.add', b: B.idx, f: 0, mod: { ...studio, x0: r2.x0, x1: r2.x0 + 4 } }]);
  assert.equal(two.status, 400); assert.match(two.json.error, /overlaps|in the way|wall/i);
  const out = await edit(owner, [{ op: 'imod.add', b: B.idx, f: 0, mod: { ...studio, x0: ib.x1 - 2, x1: ib.x1 + 3 } }]);
  assert.equal(out.status, 400); assert.match(out.json.error, /outside the floor/);
  const W = await world(), other = W.buildings.findIndex(b => b && !b.gone && b.type === 'office' && !b.radio);
  if (other >= 0) { const o = await edit(owner, [{ op: 'imod.add', b: other, f: 1 % W.buildings[other].floors, mod: { ...studio, x0: -2, z0: -2, x1: 2, z1: 2 } }]); assert.equal(o.status, 400); assert.match(o.json.error, /Radio Station/); }
  // removed, then undone
  assert.equal((await edit(owner, [{ op: 'imod.del', b: B.idx, f: 0, id }])).status, 200);
  L = await floor(B.idx);
  assert.ok(!L.mods?.some(m => m.id === id) && !L.items.some(i => i.mod === id) && !L.walls.some(w => w[5] === id), 'gone with its walls and pieces');
  let off = false; for (let k = 0; k < 40 && !off; k++) { await new Promise(r => setTimeout(r, 250)); off = !(await owner.get('/api/radio/state')).json.stations.some(x => x.studio?.room === id && x.studio.b === B.idx); }
  assert.ok(off, 'and its station off the air');
  assert.equal((await owner.post('/api/undo')).status, 200);
  L = await floor(B.idx);
  assert.ok(L.mods?.some(m => m.id === id) && L.items.some(i => i.mod === id), 'undo brings it back whole');
  // ... and its station as it was (its settings kept off the air meanwhile: same id, same name)
  let again = null; for (let k = 0; k < 40 && !again; k++) { await new Promise(r => setTimeout(r, 250)); again = (await owner.get('/api/radio/state')).json.stations.find(x => x.studio?.room === id && x.studio.b === B.idx); }
  assert.equal(again?.id, st.id, 'its station back, the same one'); assert.equal(again.name, st.name);
});

test('the Radio Station moved: its building goes with it, the studio, its station and its hosts inside (2026-10-28)', async t => {
  if (!B) return t.skip('no spot for a radio station on this island');
  let W = await world();
  const m = W.worldModules.find(x => x.terminal === B.idx), st = (await owner.get('/api/radio/state')).json.stations.find(x => x.studio?.b === B.idx);
  assert.ok(m && st, 'a station broadcast from its studio');
  const desk = (await floor(B.idx)).items.find(i => i.t === 'broadcast_desk'), ag = (await owner.get('/api/radio/admin')).json.agents[0];
  assert.equal((await owner.post('/api/agent-posts/here', { agent: ag.id, b: B.idx, f: 0, item: desk.id, slot: 1 })).status, 200);
  let seated = []; for (let k = 0; k < 20 && !seated.length; k++) { seated = (await owner.get('/api/radio/state')).json.stations.find(x => x.id === st.id)?.hostNames || []; if (!seated.length) await new Promise(r => setTimeout(r, 250)); }
  st.hostNames = seated; assert.equal(seated.length, 1, 'a host seated');
  const hostsBefore = st.hostNames.map(h => h.id), floorBefore = JSON.stringify((await floor(B.idx)).mods);
  const T = W.terrain, island = new Island(T, { roads: W.roads }), net = RoadNetwork.fromJSON(W.roads);
  const env = { heightAt: (x, z) => island.height(x, z), isWater: (x, z) => !!island.waterAt(x, z), roads: net };
  let moved = null;
  for (let k = 0; k < 600 && !moved; k++) {   // somewhere it may stand (its old access road taken up, as the World modules tool does)
    const a = k * 2.399, d = 60 + (k % 9) * 25, c = { kind: 'radio', name: m.name, x: m.x + Math.cos(a) * d, z: m.z + Math.sin(a) * d, rot: m.rot };
    if (checkWorldModule({ ...W, roads: W.roads.filter ? W.roads.filter(r => !accessRoadsOf(W, m).some(o => o.id === r.id)) : W.roads, worldModules: W.worldModules.filter(x => x.id !== m.id) }, c, env)) continue;
    const r = await edit(owner, [...accessRoadsOf(W, m).map(o => ({ op: 'road.del', id: o.id })), { op: 'wmod.set', id: m.id, x: c.x, z: c.z, rot: c.rot }], { atomic: true });
    if (r.status === 200) moved = c;
  }
  assert.ok(moved, 'moved');
  W = await world();
  const m2 = W.worldModules.find(x => x.id === m.id), B2 = W.buildings[m2.terminal];
  assert.equal(m2.terminal, B.idx, 'the same building'); assert.ok(Math.hypot(B2.x - B.x, B2.z - B.z) > 30, 'carried to where the module now has it');
  assert.equal(JSON.stringify((await floor(B.idx)).mods), floorBefore, 'its studio inside as it was');
  let st2 = null; for (let k = 0; k < 20 && !st2; k++) { st2 = (await owner.get('/api/radio/state')).json.stations.find(x => x.id === st.id); if (!st2) await new Promise(r => setTimeout(r, 250)); }
  assert.ok(st2, 'its station still on the air'); assert.deepEqual(st2.hostNames.map(h => h.id), hostsBefore, 'with its hosts');
});
