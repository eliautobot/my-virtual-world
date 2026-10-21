// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.8 interior walls: drawing, doorways and removal follow the rules (inside the building, not through furniture or the
// core, not doubling a wall, never shutting off an entrance or furniture); over the API with undo/redo and lot rights.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { checkWall, checkLayout, editWalls, roomWalls, snapAngle, doorway, normalizeWall, snapPoint, shutOff } from '../shared/walls.js';
import { interiorBounds } from '../shared/edit.js';
import { startServer, ownerSession, userSession } from '../tools/lib/testserver.mjs';

function office(w) { return w.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 3); }

test('wall rules: inside, clear of furniture and the core, never shutting anything off; doorways', () => {
  const w = generateWorld({ seed: 'wp4-walls', population: 0 }), B = office(w), f = 1, L = w.levels[B.lv[f]], ib = interiorBounds(B);
  assert.match(checkWall(B, f, L, [ib.x0 - 3, 0, ib.x0 - 1, 0, 0]) || '', /inside/);
  assert.match(checkWall(B, f, L, [0, 0, 0.2, 0, 0]) || '', /short/);
  const core = L.items.find(i => i.t === 'elevator' || i.t === 'stairs');
  if (core) assert.match(checkWall(B, f, L, [core.x - 3, core.z, core.x + 3, core.z, 0]) || '', /cut through|in the way/);
  // a wall straight across the whole floor between the entrances and the far side shuts things off
  const across = [ib.x0, (ib.z0 + ib.z1) / 2, ib.x1, (ib.z0 + ib.z1) / 2, 0];
  const why = checkWall(B, f, L, across);
  assert.ok(why, 'a wall right across the floor is refused (it would cut through or shut off something)');
  // a short free-standing wall in open space is fine somewhere on the floor
  let ok = null;
  for (let x = ib.x0 + 1; x < ib.x1 - 1 && !ok; x += 0.5) for (let z = ib.z0 + 1; z < ib.z1 - 1 && !ok; z += 0.5) { const t = [x, z, x + 1, z, 0]; if (!checkWall(B, f, L, t)) ok = t; }
  assert.ok(ok, 'a short wall fits somewhere');
  const parts = doorway([0, 0, 4, 0, 0], 2, 0.3);
  assert.equal(parts.length, 2); assert.equal(parts[0][2], 1.5); assert.equal(parts[1][0], 2.5);
  assert.equal(doorway([0, 0, 1, 0, 0], 0.5, 0).length, 0, 'a short wall becomes a doorway entirely');
  const s = snapPoint(B, L, ib.x0 + 0.1, 0.37); assert.equal(s.x, Math.round(ib.x0 * 100) / 100); assert.equal(s.z, 0.25);
  assert.deepEqual(normalizeWall([1.234, 2, 3, 4, 1]), [1.23, 2, 3, 4, 1]);
  assert.equal(shutOff(B, f, L, L.walls).entrance, false);
});

test('walls over the API: build, doorway, remove, undo; members cannot', async () => {
  const s = await startServer({ population: 60 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    let w = (await owner.get('/api/world')).json.world;
    const B = office(w), f = 1, L = w.levels[B.lv[f]], ib = interiorBounds(B);
    let wall = null;
    for (let x = ib.x0 + 1; x < ib.x1 - 2 && !wall; x += 0.5) for (let z = ib.z0 + 1; z < ib.z1 - 1 && !wall; z += 0.5) { const t = [x, z, x + 2, z, 0]; if (!checkWall(B, f, L, t)) wall = t; }
    assert.ok(wall);
    assert.equal((await alice.post('/api/edit', { ops: [{ op: 'wall.add', b: B.idx, f, wall }] })).status, 403);
    const n0 = (L.walls || []).length;
    const r = await owner.post('/api/edit', { ops: [{ op: 'wall.add', b: B.idx, f, wall }] });
    assert.equal(r.status, 200, r.text);
    w = (await owner.get('/api/world')).json.world;
    const L1 = w.levels[w.buildings[B.idx].lv[f]];
    assert.equal(L1.walls.length, n0 + 1);
    const i = L1.walls.length - 1;
    assert.equal((await owner.post('/api/edit', { ops: [{ op: 'wall.door', b: B.idx, f, i, x: wall[0] + 1, z: wall[1] }] })).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.levels[w.buildings[B.idx].lv[f]].walls.length, n0 + 2, 'the doorway splits it in two');
    assert.equal((await owner.post('/api/undo')).status, 200);
    assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.levels[w.buildings[B.idx].lv[f]].walls.length, n0, 'undone twice: as it was');
    assert.equal((await owner.post('/api/redo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.levels[w.buildings[B.idx].lv[f]].walls.length, n0 + 1);
    assert.equal((await owner.get('/api/health')).json.errors, 0);
  } finally { await s.stop(); }
});

// a free spot on the floor for a w × d area (nothing in the way of walls round it), or null
function freeArea(B, f, L, ib, w, d) {
  for (let x = ib.x0 + 1; x < ib.x1 - w - 1; x += 0.5) for (let z = ib.z0 + 1; z < ib.z1 - d - 1; z += 0.5) {
    // its sides, diagonals and middle lines all clear (nothing standing inside it)
    const sides = [[x, z, x + w, z, 0], [x + w, z, x + w, z + d, 0], [x + w, z + d, x, z + d, 0], [x, z + d, x, z, 0], [x, z, x + w, z + d, 0], [x + w, z, x, z + d, 0], [x, z + d / 2, x + w, z + d / 2, 0], [x + w / 2, z, x + w / 2, z + d, 0]];
    if (sides.every(s => !checkWall(B, f, L, s))) return { x, z };
  }
  return null;
}

test('the design tools: snapping onto walls and to angles, corners that move together, rooms with a way in', () => {
  const w = generateWorld({ seed: 'wp4-walls-tools', population: 0 }), B = office(w), f = 1, L = w.levels[B.lv[f]], ib = interiorBounds(B);
  // an L of two walls meeting at a corner
  const a = freeArea(B, f, L, ib, 3, 3); assert.ok(a, 'room to work');
  const Lw = { ...L, walls: [...(L.walls || []), [a.x, a.z, a.x + 3, a.z, 0], [a.x + 3, a.z, a.x + 3, a.z + 3, 0]] }, i0 = Lw.walls.length - 2;
  // snapping: a wall's end, then onto a wall's length (a T-joint at a quarter-metre), then the grid
  assert.equal(snapPoint(B, Lw, a.x + 3.1, a.z + 0.1).to, 'end');
  const t = snapPoint(B, Lw, a.x + 1.37, a.z + 0.12); assert.equal(t.to, 'wall'); assert.equal(t.z, Math.round(a.z * 100) / 100); const along = (t.x - a.x) / 0.25; assert.ok(Math.abs(along - Math.round(along)) * 0.25 < 0.02, 'a quarter-metre along the wall');
  assert.equal(snapPoint(B, Lw, a.x + 3.1, a.z + 0.1, [[a.x + 3, a.z]]).to !== 'end', true, 'the corner being moved does not snap to itself');
  const g = snapAngle({ x: 0, z: 0 }, { x: 2.95, z: 0.2 }); assert.equal(g.z, 0, '15° steps: nearly level becomes level'); assert.equal(g.x, 3);
  // moving the corner: both walls follow (one edit), checked as a whole
  const e = editWalls(Lw, { set: [[i0, [a.x, a.z, a.x + 2.5, a.z, 0]], [i0 + 1, [a.x + 2.5, a.z, a.x + 3, a.z + 3, 0]]] });
  assert.ok(!(e instanceof Error)); assert.deepEqual(e.changed, [i0, i0 + 1]);
  assert.equal(checkLayout(B, f, Lw, e.walls, e.changed), null, 'the corner moves');
  // a move that doubles another wall is refused
  const bad = editWalls(Lw, { set: [[i0 + 1, [a.x, a.z, a.x + 3, a.z, 0]]] });
  assert.match(checkLayout(B, f, Lw, bad.walls, bad.changed) || '', /already/);
  // removing several at once, adding several
  const del = editWalls(Lw, { del: [i0, i0 + 1] }); assert.equal(del.walls.length, (L.walls || []).length);
  assert.ok(editWalls(Lw, { del: [999] }) instanceof Error);
  // a room: four sides, or fewer along walls already there; shut, it gets a doorway on the side towards the way in
  const room = roomWalls(B, f, L, { x: a.x, z: a.z }, { x: a.x + 3, z: a.z + 3 });
  assert.ok(room.length >= 4, `the sides (${room.length})`);
  const after = [...(L.walls || []), ...room];
  assert.equal(checkLayout(B, f, L, after, room.map((_, k) => (L.walls || []).length + k)), null, 'the room stands, with a way in when it needs one');
  const besides = roomWalls(B, f, Lw, { x: a.x, z: a.z }, { x: a.x + 3, z: a.z + 3 });
  assert.ok(besides.every(r => !(Math.abs(r[1] - a.z) < 0.01 && Math.abs(r[3] - a.z) < 0.01)), 'no second wall along the one already there');
  // a room right up to the outer walls leaves those sides out
  const corner = roomWalls(B, f, L, { x: ib.x0, z: ib.z0 }, { x: ib.x0 + 2, z: ib.z0 + 2 });
  assert.ok(corner.length <= 3, 'sides on the outer walls are left out');
});

test('wall.edit over the API: a corner moved, a room built, walls taken down together — each one undo', async () => {
  const s = await startServer({ population: 60 });
  try {
    const owner = await ownerSession(s), alice = await userSession(s, owner, { login: 'alice' });
    let w = (await owner.get('/api/world')).json.world;
    const B = office(w), f = 1, L = w.levels[B.lv[f]], ib = interiorBounds(B), n0 = (L.walls || []).length;
    const a = freeArea(B, f, L, ib, 3, 3); assert.ok(a);
    const room = roomWalls(B, f, L, { x: a.x, z: a.z }, { x: a.x + 3, z: a.z + 3 });
    assert.equal((await alice.post('/api/edit', { ops: [{ op: 'wall.edit', b: B.idx, f, add: room }] })).status, 403, 'members cannot');
    let r = await owner.post('/api/edit', { ops: [{ op: 'wall.edit', b: B.idx, f, add: room }] });
    assert.equal(r.status, 200, r.text);
    w = (await owner.get('/api/world')).json.world;
    let W = w.levels[w.buildings[B.idx].lv[f]].walls;
    assert.equal(W.length, n0 + room.length, 'the room in one go');
    // drag the room's first corner inwards: the two walls meeting there follow
    const c = [a.x, a.z], set = [];
    W.forEach((q, i) => { let n = null; if (Math.abs(q[0] - c[0]) < 0.02 && Math.abs(q[1] - c[1]) < 0.02) (n ||= q.slice()).splice(0, 2, a.x + 0.5, a.z + 0.5); if (Math.abs(q[2] - c[0]) < 0.02 && Math.abs(q[3] - c[1]) < 0.02) (n ||= q.slice()).splice(2, 2, a.x + 0.5, a.z + 0.5); if (n) set.push([i, n]); });
    assert.ok(set.length >= 1);
    r = await owner.post('/api/edit', { ops: [{ op: 'wall.edit', b: B.idx, f, set }] });
    assert.equal(r.status, 200, r.text);
    w = (await owner.get('/api/world')).json.world; W = w.levels[w.buildings[B.idx].lv[f]].walls;
    assert.ok(set.every(([i]) => W[i].includes(Math.round((a.x + 0.5) * 100) / 100)), 'the corner moved');
    // refused: a wall moved onto another
    const j = set[0][0];
    r = await owner.post('/api/edit', { ops: [{ op: 'wall.edit', b: B.idx, f, set: [[j, W[(j + 1) % W.length].slice()]] }] });
    assert.equal(r.status, 400);
    // take the room down together, then undo that and the move and the room: as it was
    r = await owner.post('/api/edit', { ops: [{ op: 'wall.edit', b: B.idx, f, del: W.map((_, i) => i).slice(n0) }] });
    assert.equal(r.status, 200, r.text);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.levels[w.buildings[B.idx].lv[f]].walls.length, n0);
    for (let k = 0; k < 3; k++) assert.equal((await owner.post('/api/undo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.levels[w.buildings[B.idx].lv[f]].walls.length, n0, 'three undos: as it was');
    assert.equal((await owner.post('/api/redo')).status, 200);
    w = (await owner.get('/api/world')).json.world;
    assert.equal(w.levels[w.buildings[B.idx].lv[f]].walls.length, n0 + room.length, 'redo: the room again');
    assert.equal((await owner.get('/api/health')).json.errors, 0);
  } finally { await s.stop(); }
});
