// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// GPS routes (shared/route.js; 2026-10-05 "a map like GTA's"): along the roads and streets, connected end to end,
// with turn-by-turn steps; the map's "travel here" and "where is home" on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { Router, alongRoute } from '../shared/route.js';
import { startServer, ownerSession, userSession } from './helpers/server.mjs';

const world = generateWorld({ seed: 'route', population: 50 }), g = makeGrid(world.grid);
world.terrain = defaultIsland({ seed: 'route:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
world.roads = generateIslandRoads(new Island(world.terrain), world.grid);

test('a route across the city follows its streets, turns at its corners and arrives', () => {
  const R = new Router(world), a = { x: g.X[0] + 5, z: g.Z[1] }, b = { x: g.X.at(-1) - 5, z: g.Z.at(-2) };
  const r = R.route(a, b);
  assert.ok(r, 'a route');
  assert.equal(r.steps[0].turn, 'start'); assert.equal(r.steps.at(-1).turn, 'arrive');
  const straight = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(r.length >= straight - 1 && r.length < straight * 1.6, `${r.length.toFixed(0)} m against ${straight.toFixed(0)} m straight`);
  for (let i = 1; i < r.pts.length; i++) assert.ok(Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]) < 40, 'no jumps in the line');
  assert.ok(r.steps.slice(1, -1).every(s => ['left', 'right', 'slight left', 'slight right', 'straight', 'u-turn'].includes(s.turn) && s.road));
  assert.ok(alongRoute(r.pts, b.x, b.z).off < 1);
});

test('from the city out along an island road', () => {
  const R = new Router(world), road = world.roads.find(x => !x.id.startsWith('grid-'));
  const p = road.pts[Math.floor(road.pts.length / 2)], b = { x: p.x / 1e6, z: p.z / 1e6 };
  const r = R.route({ x: 0, z: 0 }, b);
  assert.ok(r && r.length > 100, 'a route out of the city');
  assert.ok(r.steps.some(s => s.road === road.name), `it takes ${road.name}`);
});

test('the map on the server: where home is; travel here once every 10 s, to dry ground', async () => {
  const s = await startServer({ population: 60 });
  try {
    const owner = await ownerSession(s), u = await userSession(s, owner, { login: 'map', displayName: 'Map', role: 'member' });
    const ws = new WebSocket(s.url.replace(/^http/, 'ws') + '/ws', { headers: { cookie: u.cookie } }), msgs = [];
    ws.onmessage = e => { if (typeof e.data === 'string') msgs.push(JSON.parse(e.data)); };
    await new Promise(r => { ws.onopen = r; });
    const wait = async (pred, ms = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const m = msgs.find(pred); if (m) return m; await new Promise(r => setTimeout(r, 30)); } return null; };
    await wait(m => m.t === 'you');
    ws.send(JSON.stringify({ t: 'phomeat' }));
    const h = await wait(m => m.t === 'phomeat');
    assert.ok(h && Number.isFinite(h.x) && h.where === null, 'no home: the starting point, and where is null');
    ws.send(JSON.stringify({ t: 'pobserve', on: false }));
    const W = (await owner.get('/api/world')).json.world, G = makeGrid(W.grid);
    ws.send(JSON.stringify({ t: 'ptravel', x: G.X[2], z: G.Z[2] }));
    const m1 = await wait(m => m.t === 'pmoved' && m.travel && m.home);
    assert.ok(m1 && Math.hypot(m1.x - G.X[2], m1.z - G.Z[2]) < 30 && m1.ctx === -1, 'there, outdoors');
    msgs.length = 0;
    ws.send(JSON.stringify({ t: 'ptravel', x: G.X[1], z: G.Z[1] }));
    const m2 = await wait(m => m.t === 'pmoved' && m.travel);
    assert.ok(m2 && !m2.home && /again in/.test(m2.text), 'too soon: refused with the wait');
    ws.close();
  } finally { await s.stop(); }
});
