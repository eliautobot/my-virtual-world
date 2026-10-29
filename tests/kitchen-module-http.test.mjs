// A kitchen arranged by hand (shared/interior-modules.js custom; the product owner 2026-10-27: "i want the option to move
// things around as preferred and save the applied layout ... if you resize it will reset the current manual adjusted
// layout"), over the edit route: its stations move and stay inside it, an appliance placed in it joins it, a move of the
// whole kitchen carries the arrangement along, a rename leaves it be, and a resize asks first (code 'custom') and then
// lays it out again.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer, ownerSession, tempDir } from './helpers/server.mjs';
import { interiorBounds } from '../shared/edit.js';
import { normalizeModule, checkModule } from '../shared/interior-kinds.js';

let s, owner, B = null, f = 0;
const edit = ops => owner.post('/api/edit', { ops });
const level = async () => { const w = (await owner.get('/api/world')).json.world; return w.levels[w.buildings[B.idx].lv[f]]; };
before(async () => {
  s = await startServer({ data: tempDir('mvw-kitchen-'), population: 60 });
  owner = await ownerSession(s);
  const w = (await owner.get('/api/world')).json.world;
  B = w.buildings.filter(b => b && !b.gone && b.type === 'restaurant' && b.w >= 14 && b.d >= 12).sort((a, b) => b.w * b.d - a.w * a.d)[0];
  assert.ok(B, 'a restaurant');
  f = B.floors > 1 ? 1 : 0;
  assert.equal((await edit([{ op: 'lvl.clear', b: B.idx, f }])).status, 200);
});
after(() => s?.stop());

test('a kitchen arranged by hand: moved as it is, renamed as it is, resized only when asked', async () => {
  const ib = interiorBounds(B);
  let L = await level(), mod = null;
  for (let k = 0; k < 40 && !mod; k++) {   // (against the back wall, clear of the elevator)
    const cx = (ib.x0 + ib.x1) / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
    const r = normalizeModule({ kind: 'kitchen', x0: cx - 3.25, z0: ib.z0, x1: cx + 3.25, z1: ib.z0 + 4, face: 0 });
    if (!checkModule(B, f, L, r)) mod = r;
  }
  assert.ok(mod, 'a clear place');
  let r = await edit([{ op: 'imod.add', b: B.idx, f, mod }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.results[0].id;
  L = await level();
  const rec = () => L.mods.find(m => m.id === id), mine = () => L.items.filter(i => i.mod === id);
  assert.ok(!rec().custom, 'laid out as it comes');
  const n0 = mine().length;

  // one of its stations moved a little (wherever there is room): it is arranged by hand now
  let oven = null;
  for (const it of mine().filter(i => !['ou_pass', 'ou_rail', 'ou_extinguisher'].includes(i.t))) {
    for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      r = await edit([{ op: 'item.move', b: B.idx, f, id: it.id, x: it.x + dx, z: it.z + dz, r: it.r }]);
      if (r.status === 200) { oven = it; break; }
    }
    if (oven) break;
  }
  assert.ok(oven, `a station moved (${JSON.stringify(r.json)})`);
  L = await level();
  assert.equal(rec().custom, true, 'marked as arranged by hand');
  const where = Object.fromEntries(mine().map(i => [i.id, [i.x, i.z]]));

  // not out of the kitchen
  r = await edit([{ op: 'item.move', b: B.idx, f, id: oven.id, x: (ib.x0 + ib.x1) / 2, z: ib.z1 - 2, r: 0 }]);
  assert.equal(r.status, 400); assert.match(r.json.error, /Keep it inside/);

  // a rename: nothing of it moves
  r = await edit([{ op: 'imod.set', b: B.idx, f, id, mod: { name: 'The Line' } }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  L = await level();
  assert.equal(rec().name, 'The Line'); assert.equal(rec().custom, true);
  assert.deepEqual(Object.fromEntries(mine().map(i => [i.id, [i.x, i.z]])), where, 'its arrangement as it was');

  // moved along the wall: its arrangement goes with it
  const m0 = rec();
  let dx = 0;
  for (const d of [1, -1, 2, -2]) {
    r = await edit([{ op: 'imod.set', b: B.idx, f, id, mod: { x0: m0.x0 + d, z0: m0.z0, x1: m0.x1 + d, z1: m0.z1 } }]);
    if (r.status === 200) { dx = d; break; }
  }
  assert.ok(dx, `moved a metre either way (${JSON.stringify(r.json)})`);
  L = await level();
  assert.equal(rec().custom, true);
  for (const [k, [x, z]] of Object.entries(where)) {
    const it = L.items.find(i => i.id === +k);
    assert.ok(it && Math.abs(it.x - (x + dx)) < 0.02 && Math.abs(it.z - z) < 0.02, `piece ${k} carried along`);
  }

  // an appliance placed inside joins it
  const m1 = rec(), at = { x: (m1.x0 + m1.x1) / 2, z: m1.z0 + 2.2 };
  r = await edit([{ op: 'item.add', b: B.idx, f, t: 'ou_prep', x: at.x, z: at.z, r: 0 }]);
  if (r.status === 200) { L = await level(); assert.equal(L.items.find(i => i.id === r.json.results[0].id)?.mod, id, 'it joins the kitchen'); }

  // a resize asks first
  r = await edit([{ op: 'imod.set', b: B.idx, f, id, mod: { x0: m1.x0, z0: m1.z0, x1: m1.x1 + 2, z1: m1.z1 } }]);
  assert.equal(r.status, 400); assert.equal(r.json.code, 'custom'); assert.match(r.json.error, /arranged by hand: resizing/);
  L = await level();
  assert.equal(rec().x1, m1.x1, 'left as it was');
  // and, asked to, lays it out again
  r = await edit([{ op: 'imod.set', b: B.idx, f, id, reset: true, mod: { x0: m1.x0, z0: m1.z0, x1: m1.x1 + 2, z1: m1.z1 } }]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  L = await level();
  assert.ok(!rec().custom, 'laid out as it comes again');
  assert.ok(Math.abs((rec().x1 - rec().x0) - (m1.x1 - m1.x0 + 2)) < 0.01);
  assert.ok(mine().length >= n0, `a bigger kitchen: as many pieces or more (${mine().length} from ${n0})`);
});
