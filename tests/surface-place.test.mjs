// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Things put on pieces by hand (PLAN-SURFACES.md 7, phase P3): the surface a pointer's ray meets (the editor's ghost follows
// it), a thing moved in from a surface's edges, where MVW's own fill (books, goods, shoes, jars) makes way for the things on
// a shelf; goods that may also stand on the floor are placed there, the others refused with the reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../shared/catalog.js';
import { GOODS_LIB } from '../shared/goods-items.js';
import { surfacesOf, surfaceHit, nudgeIn, fillCuts, onWhy, checkOn } from '../shared/surfaces.js';
import { startServer, ownerSession, tempDir } from '../tools/lib/testserver.mjs';

const small = GOODS_LIB.map(g => g.t).find(t => { const d = CATALOG[t], [x0, z0, x1, z1] = d.rect; return x1 - x0 < 0.1 && z1 - z0 < 0.1 && d.h > 0.05 && d.h < 0.15; });
const down = (o, to) => { const d = to.map((v, i) => v - o[i]), L = Math.hypot(...d); return d.map(v => v / L); };

test('the surface a ray meets: from above, nearest first, a shelf through its opening', () => {
  const desk = surfacesOf({ t: 'desk' });
  let h = surfaceHit(desk, [0.2, 2, 1.5], down([0.2, 2, 1.5], [0.2, desk[0].y, 0.1]));
  assert.equal(h?.s, 0); assert.ok(Math.abs(h.x - 0.2) < 1e-6 && Math.abs(h.z - 0.1) < 1e-6, JSON.stringify(h));
  assert.equal(surfaceHit(desk, [0, 0.2, 2], down([0, 0.2, 2], [0, desk[0].y, 0])), null, 'from below: not met');
  assert.equal(surfaceHit(desk, [0, 2, 3], down([0, 2, 3], [0, desk[0].y, 1.5])), null, 'beside it: not met');
  // a bookshelf's second shelf, looked into from the front: met there, not on the shelf above or the top
  const bs = surfacesOf({ t: 'bookshelf' }), S1 = bs[1], o = [0.1, S1.y + 0.9, 2.2];
  h = surfaceHit(bs, o, down(o, [0.1, S1.y, (S1.z0 + S1.z1) / 2 + 0.05]));
  assert.equal(h?.s, 1, JSON.stringify(h));
  // straight down on the bookshelf: its top first
  h = surfaceHit(bs, [0, 4, 0], [0, -1, 0]);
  assert.equal(bs[h.s].kind, 'high');
});

test('a thing moved in from the edges of its surface; MVW\'s fill cut where things stand', () => {
  const desk = surfacesOf({ t: 'desk' }), S = desk[0];
  const over = { t: small, s: 0, x: S.x1 + 0.02, z: -0.25, r: 0 };
  assert.ok(onWhy(desk, over), 'hanging over: refused');
  const n = nudgeIn(S, over);
  assert.ok(n.x < S.x1 && !onWhy(desk, n), `moved in: ${n.x}`);
  const mid = { t: small, s: 0, x: 0.45, z: -0.25, r: 0 };
  assert.equal(nudgeIn(S, mid), mid, 'inside: unchanged');
  // a bookshelf with a thing on its second shelf: one cut there, round the thing, under the next shelf
  const bs = surfacesOf({ t: 'bookshelf' }), e = { t: small, s: 1, x: 0.3, z: 0.05, r: 0 };
  assert.equal(checkOn({ t: 'bookshelf' }, [e]), null);
  const cuts = fillCuts({ t: 'bookshelf', on: [e] });
  assert.equal(cuts.length, 1);
  const [y, top, x0, z0, x1, z1] = cuts[0], d = CATALOG[small];
  assert.equal(y, bs[1].y); assert.ok(top > y + 0.3 && top <= bs[2].y + 0.04, `top ${top}`);
  assert.ok(x0 < 0.3 + d.rect[0] && x1 > 0.3 + d.rect[2] && z0 < 0.05 + d.rect[1] && z1 > 0.05 + d.rect[3]);
  assert.deepEqual(fillCuts({ t: 'bookshelf', on: [] }), []);
  assert.deepEqual(fillCuts({ t: 'desk', on: [{ ...e, s: 0, x: 0.45, z: -0.25 }] }), [], 'a desk has no fill');
  for (const t of ['shop_shelf', 'shoe_wall', 'library_wall', 'bookcase', 'pipe_shelf', 'display']) assert.ok(surfacesOf({ t }).some(s => s.fill), `${t} has fill`);
  assert.equal(surfacesOf({ t: 'library_wall' }).at(-1).fill, 'books', 'library wall: its top row of books');
});

test('goods on the floor: those that may stand there are placed (never in the way), the others refused', async () => {
  const floorOk = GOODS_LIB.find(g => CATALOG[g.t].floorOk)?.t, only = GOODS_LIB.find(g => !CATALOG[g.t].floorOk)?.t;
  assert.ok(floorOk && only);
  const s = await startServer({ data: tempDir('mvw-place-'), population: 20, agents: 0 });
  try {
    const owner = await ownerSession(s);
    const W = (await owner.get('/api/world')).json.world;
    const B = W.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 2);
    let r = await owner.post('/api/edit', { ops: [{ op: 'item.add', b: B.idx, f: 1, t: only, x: 0, z: 0, r: 0 }] });
    assert.notEqual(r.status, 200); assert.match(r.text, /goes on a table or a shelf/);
    let id = null;
    for (let k = 0; k < 40 && id === null; k++) {
      r = await owner.post('/api/edit', { ops: [{ op: 'item.add', b: B.idx, f: 1, t: floorOk, x: -B.w / 2 + 2 + (k % 8), z: -B.d / 2 + 2 + Math.floor(k / 8), r: 0 }] });
      if (r.status === 200) id = r.json.results[0].id;
    }
    assert.ok(id !== null, 'placed on the floor');
    const W2 = (await owner.get('/api/world')).json.world, it = W2.levels[W2.buildings[B.idx].lv[1]].items.find(i => i.id === id);
    assert.equal(it.t, floorOk);
    assert.equal(CATALOG[floorOk].block, false, 'never in the way');
  } finally { await s.stop(); }
});
