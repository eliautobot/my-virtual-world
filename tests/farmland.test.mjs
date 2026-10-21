// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Farmland (the design review 2026-10-03): fields laid out in a gently curving patchwork (shared/farms.js), farmed whole
// (shared/biome.js), with their crops, hedges, fences and walls standing on the ground (client/js/render/countryside-
// build.js) and the ground shader drawing the same fields (client/js/render/ground-detail.js mirrors farms.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateWorld } from '../server/world/generate.js';
import { makeGrid } from '../shared/city.js';
import { defaultIsland, Island } from '../shared/terrain.js';
import { generateIslandRoads } from '../shared/island-roads.js';
import { toFarm, fromFarm, fieldOf, fieldRect, CROPS, ROW_D } from '../shared/farms.js';
import { biome, farmed, farmAt } from '../shared/biome.js';

const HERE = path.dirname(new URL(import.meta.url).pathname), SRC = path.resolve(HERE, '..');
// a client module that imports '/shared/...' (as the browser serves it), loaded from a temporary copy
async function clientModule(rel) {
  const text = fs.readFileSync(path.join(SRC, rel), 'utf8').replaceAll("'/shared/", `'${path.join(SRC, 'shared')}/`);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-farm-')), path.basename(rel).replace(/\.js$/, '.mjs'));
  fs.writeFileSync(f, text);
  return import(f);
}
function island() {
  const w = generateWorld({ seed: 'wp4-farmland', population: 0 }), g = makeGrid(w.grid);
  w.terrain = defaultIsland({ seed: 'wp4-farmland:island', city: { x0: g.minX, z0: g.minZ, x1: g.maxX, z1: g.maxZ }, plainY: 0.1 });
  w.roads = generateIslandRoads(new Island(w.terrain), w.grid);
  return { w, I: new Island(w.terrain, { roads: w.roads, bridgesAsGround: false }) };
}
const { w, I } = island();
// the farmed fields of the island (by their middles)
const fields = [];
for (let row = -40; row < 200 && fields.length < 400; row++) for (let fx = -60; fx < 120; fx++) {
  if (!farmed(I, row, fx)) continue;
  const R = fieldRect(row, fx), [x, z] = fromFarm((R.u0 + R.u1) / 2, (R.v0 + R.v1) / 2);
  fields.push({ row, fx, R, x, z });
}

test('farm space: a gentle curve, exactly undone', () => {
  for (let k = 0; k < 400; k++) {
    const x = -4000 + (k * 97.13) % 8000, z = -6500 + (k * 211.7) % 8000, [u, v] = toFarm(x, z), [x2, z2] = fromFarm(u, v);
    assert.ok(Math.hypot(x2 - x, z2 - z) < 0.01, `round trip at ${x.toFixed(0)},${z.toFixed(0)}`);
    assert.ok(Math.hypot(u - x, v - z) < 78, 'only a gentle offset (at most ~76 m)');
  }
});

test('fields are farmed whole, with every kind of crop on the island', () => {
  assert.ok(fields.length > 60, `farmland near the city (${fields.length} fields)`);
  const crops = new Set();
  for (const F of fields.slice(0, 120)) {
    const f = fieldOf((F.R.u0 + F.R.u1) / 2, (F.R.v0 + F.R.v1) / 2); crops.add(CROPS[f.crop]);
    // points well inside the field are all farmland (unless water, a beach or a steep bank breaks in)
    let farm = 0, n = 0;
    for (const [a, b] of [[0.3, 0.3], [0.7, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.7]]) {
      const [x, z] = fromFarm(F.R.u0 + (F.R.u1 - F.R.u0) * a, F.R.v0 + ROW_D * b), h = I.height(x, z);
      const kd = biome(I, x, z, h, 1).kind; n++;
      if (['crop', 'field', 'hedge'].includes(kd)) farm++;
      else assert.ok(['shore', 'beach', 'water', 'meadow', 'lawn'].includes(kd), kd);
    }
    assert.ok(farm >= n - 1, `field ${F.row}:${F.fx} is farmed whole (${farm}/${n})`);
  }
  assert.ok(crops.size >= 8, `many crops: ${[...crops].join(', ')}`);
  // no farm in the city or far up the mountains
  assert.equal(farmAt(I, 0, 0), null);
  assert.equal(farmAt(I, w.terrain.mountains.x, w.terrain.mountains.z), null);
});

test('grazing animals keep to pasture: crops are not a habitat', () => {
  const kinds = new Set(fields.slice(0, 80).map(F => biome(I, F.x, F.z, I.height(F.x, F.z), 1).kind));
  assert.ok(kinds.has('crop'), 'crop fields');
  assert.ok(!['crop'].some(k => ['forest', 'meadow', 'field', 'beach', 'shore', 'rock', 'lake'].includes(k)));
});

test('the countryside stands on the ground: crops, hedges and fences, never on a road', async () => {
  const { buildCountryside, CK } = await clientModule('client/js/render/countryside-build.js');
  const S = 121.92, kinds = new Set();
  let built = 0, trees = 0;
  for (const F of fields.slice(0, 40)) {
    const x0 = Math.floor(F.x / S) * S, z0 = Math.floor(F.z / S) * S;
    const out = buildCountryside(I, x0, z0, S, (x, z) => I.height(x, z));
    if (!out) continue;
    trees += out.trees.length / 4;
    for (const m of [out.mesh, out.small]) {
      if (!m) continue;
      built++;
      const nv = m.pos.length / 3;
      for (let v = 0; v < nv; v += 7) {
        const x = m.pos[v * 3] + x0, y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2] + z0;
        assert.ok(x > x0 - 4 && x < x0 + S + 4 && z > z0 - 4 && z < z0 + S + 4, 'within its tile');
        const above = y - I.height(x, z);
        assert.ok(above > -0.4 && above < 3.6, `on the ground (${above.toFixed(2)} m)`);
        kinds.add(m.k[v * 3]);
        if (I.roads) { const nr = I.roads.net.nearest(x, z, 12); assert.ok(!nr || nr.dist > I.roads.half.get(nr.id) + 0.5, 'off the road'); }
      }
      assert.equal(m.idx.length % 3, 0);
      for (let i = 0; i < m.idx.length; i++) assert.ok(m.idx[i] < nv);
    }
  }
  assert.ok(built > 10, 'meshes for the farm tiles');
  assert.ok(kinds.has(CK.hedge) && (kinds.has(CK.corn) || kinds.has(CK.wheat)), 'hedges and standing crops');
  assert.ok(trees > 3, 'trees in the hedgerows');
});

test('the ground shader draws the same fields (its GLSL mirrors shared/farms.js)', () => {
  const glsl = fs.readFileSync(path.join(SRC, 'client/js/render/ground-detail.js'), 'utf8'), js = fs.readFileSync(path.join(SRC, 'shared/farms.js'), 'utf8');
  for (const k of ['0x27d4eb2d', '0x165667b1', '0x2545f491', '0x2c1b3c6d', '0x297a2d39', '4244', '4243', '4242', '4250', '4260', '4261', '9000.0', '5000.0', '90.0', '0.0021', '1.3', '0.0013', '4.1', '0.0017', '0.4', '0.0011', '2.2']) {
    assert.ok(glsl.includes(k), `GLSL has ${k}`);
    assert.ok(js.includes(k.replace(/\.0$/, '')), `farms.js has ${k}`);
  }
  for (const t of ['0.15', '0.24', '0.32', '0.5', '0.57', '0.66', '0.76', '0.82', '0.87', '0.91']) assert.ok(glsl.includes(`r < ${t}`) && js.includes(t), `crop share ${t}`);
});
