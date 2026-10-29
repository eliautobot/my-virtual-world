// A kitchen survives its building being moved, turned or resized (the product owner 2026-10-28: "i moved the radio
// station building and it deleted the radio station module inside it ... not sure if kitchen modules have it fixed,
// please check"): over HTTP, a café's building with its kitchen (a record, its pieces and its walls), one arranged by
// hand too, moved a little, turned half round on its footprint and made a metre wider: the kitchen is there after each,
// all its pieces inside it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, tempDir } from './helpers/server.mjs';

let s, owner;
const edit = ops => owner.post('/api/edit', { ops });
const world = async () => (await owner.get('/api/world')).json.world;
before(async () => { s = await startServer({ data: tempDir('mvw-kbld-'), population: 80 }); owner = await ownerSession(s); });
after(() => s?.stop());

const kitchenOf = (W, b, f) => {
  const L = W.levels[W.buildings[b].lv[f]], m = (L.mods || []).find(x => x.kind === 'kitchen');
  return m ? { m, items: L.items.filter(i => i.mod === m.id), walls: (L.walls || []).filter(w => w[5] === m.id) } : null;
};
const whole = (k, n, what) => {
  assert.ok(k, `${what}: the kitchen is still there`);
  assert.equal(k.items.length, n, `${what}: all its pieces (${k.items.map(i => i.t).join(' ')})`);
  for (const it of k.items) assert.ok(it.x > k.m.x0 - 0.5 && it.x < k.m.x1 + 0.5 && it.z > k.m.z0 - 0.5 && it.z < k.m.z1 + 0.5, `${what}: ${it.t} inside it`);
  assert.ok(k.walls.length >= 1, `${what}: its walls`);
};

test('a café\'s kitchen survives its building moved, turned and made bigger; arranged by hand too', async () => {
  let W = await world();
  const B0 = W.buildings.filter(b => b && !b.gone && b.type === 'cafe' && kitchenOf(W, b.idx, 0)).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  assert.ok(B0, 'a café with a kitchen');
  const b = B0.idx, f = 0;
  let k = kitchenOf(W, b, f);
  // arranged by hand first: one of its stations moved
  for (const it of k.items.filter(i => !['ou_pass', 'ou_rail', 'ou_extinguisher'].includes(i.t))) {
    let ok = false;
    for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) if ((await edit([{ op: 'item.move', b, f, id: it.id, x: it.x + dx, z: it.z + dz, r: it.r }])).status === 200) { ok = true; break; }
    if (ok) break;
  }
  W = await world(); k = kitchenOf(W, b, f);
  assert.ok(k.m.custom, 'arranged by hand');
  const n = k.items.length;

  // moved a little (wherever there is room)
  let r = null, B = W.buildings[b];
  for (const [dx, dz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    r = await edit([{ op: 'bld.place', b, x: B.x + dx, z: B.z + dz }]);
    if (r.status === 200) break;
  }
  assert.equal(r.status, 200, `the building moved (${JSON.stringify(r.json?.error)})`);
  W = await world(); whole(kitchenOf(W, b, f), n, 'moved');
  assert.ok(kitchenOf(W, b, f).m.custom, 'moved: still arranged by hand');

  // turned half round on its own footprint
  B = W.buildings[b];
  r = await edit([{ op: 'bld.place', b, rot: (B.rot || 0) + Math.PI }]);
  console.log('# turned', r.status, r.json?.error || '');
  if (r.status === 200) { W = await world(); whole(kitchenOf(W, b, f), n, 'turned'); }
  else assert.doesNotMatch(String(r.json?.error), /kitchen/i, `turning refused for its own reasons: ${r.json?.error}`);

  // a metre bigger, wider or deeper, either side (wherever its neighbours leave room; its layout kept)
  B = W.buildings[b];
  const ax = Math.cos(B.rot || 0), az = -Math.sin(B.rot || 0), bx = Math.sin(B.rot || 0), bz = Math.cos(B.rot || 0);
  let grown = '';
  for (const [what, o] of [['wider', s => ({ x: B.x + s * ax * 0.5, z: B.z + s * az * 0.5, w: B.w + 1 })], ['deeper', s => ({ x: B.x + s * bx * 0.5, z: B.z + s * bz * 0.5, d: B.d + 1 })]]) {
    for (const side of [1, -1]) for (const fit of [undefined, 'keep']) {
      if (grown) break;
      r = await edit([{ op: 'bld.place', b, ...o(side), ...(fit ? { fit } : {}) }]);
      if (r.status === 200) grown = `${what} (${side > 0 ? 'one' : 'the other'} side${fit ? ', layout kept' : ''})`;
    }
  }
  console.log('# grown', grown || r.json?.error);
  if (grown) { W = await world(); whole(kitchenOf(W, b, f), n, grown); }
  else assert.doesNotMatch(String(r.json?.error), /kitchen/i, `growing refused for its own reasons: ${r.json?.error}`);
});
