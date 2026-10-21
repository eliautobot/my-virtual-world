// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Indoor reachability: every home and job of a generated city can be walked to from its floor's entrances without
// crossing a wall, including slots whose approach point lies in a pocket (Nav.approach), and a path into a pocket
// squeezes in over a short stretch instead of cutting straight through walls (Nav.detour).
import assert from 'node:assert/strict';
import test from 'node:test';
import { Nav } from '../../server/sim/nav.js';
import { levelEntries } from '../../shared/building.js';
import { testCity } from '../helpers/world.mjs';

function slotsOf(world, index, people) {
  const out = [];
  const add = (who, b, f, id, k) => {
    const B = world.buildings[b], lv = B.lv[f];
    out.push({ who, B, lv, L: world.levels[lv], f, s: index.entry(b, f, id).slots[k] });
  };
  for (const p of people) {
    if (p.home) add(`${p.name} (home)`, p.home.b, p.home.f, p.home.bed[0], p.home.bed[1]);
    const j = p.job;
    if (j && j.b !== undefined && j.id !== undefined) add(`${p.name} (job)`, j.b, j.f, j.id, j.k);
  }
  return out;
}

test('every home and job is walked to by a real path, and no wall stands between the resident and the slot', () => {
  const { world, people, index } = testCity();
  const nav = new Nav(world);
  const bad = [];
  let paths = 0, moved = 0, squeezes = 0, longest = 0;
  for (const t of slotsOf(world, index, people)) {
    const { s, lv, L, B } = t, ap = nav.approach(lv, s), stand = ap.via || ap;
    if (ap.x !== s.ax || ap.z !== s.az) moved++;
    if (!nav.isReachable(lv, ap.x, ap.z)) { bad.push(`${t.who}: the route end is not reachable`); continue; }
    if (nav.crossesWall(lv, s.lx, s.lz, stand.x, stand.z)) bad.push(`${t.who}: a wall between the slot and where the resident stands`);
    if (ap.via) {
      squeezes++;
      const len = Math.hypot(ap.x - ap.via.x, ap.z - ap.via.z);
      longest = Math.max(longest, len);
      if (nav.crossesWall(lv, ap.x, ap.z, ap.via.x, ap.via.z)) bad.push(`${t.who}: squeezes through a wall`);
      if (len > 3) bad.push(`${t.who}: squeezes ${len.toFixed(2)} m`);
    }
    for (const e of levelEntries(B, L.ground ? 0 : 1)) {
      const pts = nav.path(lv, e.x, e.z, ap.x, ap.z);
      paths++;
      if (pts.straight || pts.detour !== undefined) bad.push(`${t.who}: ${pts.straight ? 'straight line' : 'detour'} from an entrance`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} problems`);
  assert.ok(paths > 300, `${paths} paths`);
  assert.ok(moved > 0 && squeezes > 0, `this city has slots in pockets (${moved} moved, ${squeezes} squeezes, longest ${longest.toFixed(2)} m), so the pocket handling was exercised`);
});

test('a path into a pocket squeezes in over a short stretch instead of cutting through walls', () => {
  const { world, people, index } = testCity();
  const nav = new Nav(world);
  let tried = 0;
  for (const t of slotsOf(world, index, people)) {
    const { s, lv, L, B } = t, ap = nav.approach(lv, s);
    if (!ap.via) continue;                            // only pockets on the slot's side of every wall
    const e = levelEntries(B, L.ground ? 0 : 1)[0];
    const pts = nav.path(lv, e.x, e.z, s.ax, s.az);   // straight to the approach point inside the pocket
    tried++;
    assert.equal(pts.straight, undefined, `${t.who}: straight line through walls`);
    assert.ok(pts.detour !== undefined && pts.detour < 3, `${t.who}: squeezes ${pts.detour} m`);
    for (let k = 1; k < pts.length; k++) {
      assert.equal(nav.crossesWall(lv, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]), false, `${t.who}: leg ${k} crosses a wall`);
    }
  }
  assert.ok(tried > 0);
});

test('crossesWall and reachablePoint', () => {
  const { world } = testCity();
  const nav = new Nav(world);
  const lv = world.levels.findIndex(L => (L.walls || []).length > 4);
  const L = world.levels[lv], w = L.walls[0];
  const mx = (w[0] + w[2]) / 2, mz = (w[1] + w[3]) / 2, dx = w[2] - w[0], dz = w[3] - w[1], n = Math.hypot(dx, dz);
  const nx = -dz / n, nz = dx / n;                   // unit normal of the wall
  assert.equal(nav.crossesWall(lv, mx - nx, mz - nz, mx + nx, mz + nz), true, 'across the middle of a wall');
  assert.equal(nav.crossesWall(lv, mx + nx * 0.3, mz + nz * 0.3, mx + nx, mz + nz), false, 'on one side of it');
  const r = nav.reach(lv);
  const g = nav.grid(lv), c = r.cells[Math.floor(r.cells.length / 2)];
  const px = g.x0 + ((c % g.gw) + 0.5) * g.cell, pz = g.z0 + (Math.floor(c / g.gw) + 0.5) * g.cell;
  assert.deepEqual(nav.reachablePoint(lv, px, pz), { x: px, z: pz }, 'a reachable point is its own answer');
});
