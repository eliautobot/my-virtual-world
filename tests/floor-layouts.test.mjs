// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Floor layouts on a resize (2026-10-04; shared/edit.js interiorPlan, server/world/generate.js markLevelModes):
// generated floors are laid out again for a new size from the building's seed (the same size gives the same floor
// back); floors changed by hand keep their layout and the pieces that would no longer fit are named, so the person can
// keep the layout without them, regenerate the floor, or cancel; moving a building without resizing keeps its inside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { interiorPlan, conflictGroups, planWords, piecesWords, floorsName, levelMode, interiorBounds, followLayout } from '../shared/edit.js';
import { createBuilding, freshLevels, markLevelModes } from '../server/world/generate.js';

const shop = (lv = 0) => ({ type: 'shop', x: 100, z: 50, w: 16, d: 12, rot: 0, floors: 1, lv: [lv], door: { x: 0, w: 2.4 }, core: null });
const hand = items => ({ items, walls: [], mode: 'custom' });

test('a floor\'s mode: generated (auto), changed by hand (custom), cleared (empty); unknown layouts count as custom', () => {
  assert.equal(levelMode({ items: [], auto: 1 }), 'auto');
  assert.equal(levelMode({ items: [], mode: 'empty' }), 'empty');
  assert.equal(levelMode({ items: [], mode: 'custom' }), 'custom');
  assert.equal(levelMode({ items: [] }), 'custom');
});

test('moving a building without resizing keeps everything inside where it stands in the building', () => {
  const B = shop(), L = hand([{ id: 1, t: 'sofa', x: 0, z: -2, r: 0 }, { id: 2, t: 'plant', x: interiorBounds(B).x1 - 0.3, z: -2, r: 0 }]);
  const F = followLayout(B, { x: B.x + 3, z: B.z - 2, w: B.w, d: B.d, rot: 0 }, L);
  assert.deepEqual(F.items.map(i => [i.x, i.z]), L.items.map(i => [i.x, i.z]));
  const plan = interiorPlan(B, { x: B.x + 3, z: B.z, w: B.w, d: B.d, rot: 0 }, () => L);
  assert.equal(plan.choose, false); assert.equal(plan.why, null);
});

test('a generated floor is laid out again on a new size, without asking', () => {
  const B = shop(), L = { items: [{ id: 1, t: 'sofa', x: 0, z: -2, r: 0 }], walls: [], auto: 1 };
  const plan = interiorPlan(B, { x: B.x - 2, z: B.z, w: B.w - 4, d: B.d, rot: 0 }, () => L);
  assert.equal(plan.groups[0].regen, true); assert.equal(plan.choose, false);
  assert.match(planWords(B, plan), /laid out again/);
});

test('a floor changed by hand: what would end up outside the new walls is named, and keeping the layout drops only that', () => {
  const B = shop(), ib = interiorBounds(B);
  const L = hand([
    { id: 1, t: 'sofa', x: ib.x1 - 3, z: -2, r: 0 },        // 3 m in from the east wall: it stays put, the wall passes it
    { id: 2, t: 'plant', x: ib.x0 + 0.5, z: -3, r: 0 },     // by the west wall, which does not move
    { id: 3, t: 'plant', x: ib.x1 - 0.3, z: 3, r: 0 },      // against the east wall: goes with it
  ]);
  const g = { x: B.x - 2, z: B.z, w: B.w - 4, d: B.d, rot: 0 };   // the east wall comes in 4 m
  const plan = interiorPlan(B, g, () => L);
  assert.equal(plan.choose, true); assert.equal(plan.remove, 1);
  const G = conflictGroups(plan)[0];
  assert.deepEqual(G.remove.map(r => [r.id, r.why]), [[1, 'outside']]);
  assert.equal(G.keepOk, true);
  assert.deepEqual(G.layout.items.map(i => i.id).sort(), [2, 3]);
  assert.match(planWords(B, plan), /The floor was changed by hand: 1 piece doesn't fit the new size \(the sofa\)/);
});

test('a piece pushed into another by a moving wall goes; one that was already close does not count', () => {
  const B = shop(), ib = interiorBounds(B);
  const L = hand([
    { id: 1, t: 'plant', x: ib.x1 - 0.3, z: -2, r: 0 },     // against the east wall
    { id: 2, t: 'sofa', x: ib.x1 - 3.9, z: -2, r: 0 },      // further in, in its way
  ]);
  const plan = interiorPlan(B, { x: B.x - 1.25, z: B.z, w: B.w - 2.5, d: B.d, rot: 0 }, () => L);
  const G = conflictGroups(plan)[0];
  assert.ok(G, 'something conflicts');
  assert.deepEqual(G.remove.map(r => [r.id, r.why]), [[1, 'bump']], 'the plant that moved into the sofa goes, not the sofa');
});

test('inner walls poking out of the new size are cut at the new wall, not removed', () => {
  const B = shop(), ib = interiorBounds(B);
  const L = { items: [], walls: [[ib.x0, 0, ib.x1 - 2, 0, 0]], mode: 'custom' };   // stops 2 m short of the east wall
  const g = { x: B.x - 2, z: B.z, w: B.w - 4, d: B.d, rot: 0 }, plan = interiorPlan(B, g, () => L);
  const G = plan.groups[0], nx1 = interiorBounds({ ...B, ...g }).x1;   // the layout is in the new building's frame
  assert.equal(G.remove.length, 0); assert.equal(G.trim, 1); assert.equal(plan.choose, false);
  assert.ok(Math.abs(G.layout.walls[0][2] - nx1) < 0.01, `cut at the new east wall (${G.layout.walls[0][2]} vs ${nx1})`);
});

test('words: floors named the way people say them, repeated pieces counted', () => {
  const B = { floors: 9, type: 'office' };
  assert.equal(floorsName(B, [1]), 'floor 2');
  assert.equal(floorsName(B, [1, 2]), 'floors 2 & 3');
  assert.equal(floorsName(B, [1, 2, 3, 4]), 'floors 2–5');
  assert.equal(floorsName(B, [1, 3, 5]), 'floors 2, 4 & 6');
  assert.equal(floorsName({ floors: 1, type: 'shop' }, [0]), 'the floor');
  assert.equal(floorsName(B, [0, 3, 4, 5, 6, 7]), 'floors 1 & 4–8');
  assert.equal(piecesWords([{ name: 'café table (2)' }, { name: 'café table (2)' }]), '2 café tables (2)');
  assert.equal(piecesWords([{ name: 'vanity sink' }, { name: 'sofa' }, { name: 'vanity sink' }]), '2 vanity sinks and the sofa');
  assert.equal(piecesWords([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }]), 'the a, the b, the c and 2 more');
});

test('generated floors come back the same for the same size, and a world from before is marked once', () => {
  const W = { buildings: [], levels: [], grid: null };
  const B = createBuilding(W, { type: 'apartment', floors: 4, style: 'brick', rect: { x0: 0, x1: 24, z0: 0, z1: 22 }, face: 0, block: 0 }, 42);
  assert.ok(B.lv.every(lv => W.levels[lv].auto === 1), 'new floors are generated (auto)');
  const again = freshLevels(B);
  for (let f = 0; f < B.floors; f++) assert.deepEqual(again(f).items, W.levels[B.lv[f]].items, `floor ${f + 1} comes back the same`);
  const bigger = freshLevels({ ...B, w: B.w + 4 });
  assert.notDeepEqual(bigger(1).items, W.levels[B.lv[1]].items, 'a new size gives a new layout');
  // a world from before floor modes: untouched floors become auto, a changed one custom
  for (const L of W.levels) delete L.auto;
  W.levels[B.lv[1]].items.pop();
  assert.equal(markLevelModes(W), new Set(B.lv).size);
  assert.equal(W.levels[B.lv[0]].auto, 1);
  assert.equal(W.levels[B.lv[1]].mode, 'custom');
  assert.equal(markLevelModes(W), 0, 'only once');
});

test('a saved layout laid onto a floor: the same size comes back as it was, a smaller one lists what does not fit', async () => {
  const { fitSaved, layoutToSave, floorUse } = await import('../shared/edit.js');
  const W = { buildings: [], levels: [], grid: null };
  const B = createBuilding(W, { type: 'apartment', floors: 3, style: 'brick', rect: { x0: 0, x1: 24, z0: 0, z1: 22 }, face: 0, block: 0 }, 7);
  const L = W.levels[B.lv[1]], rec = { use: floorUse(B, 1), w: B.w, d: B.d, layout: layoutToSave(L) };
  assert.equal(rec.use, 'apartment');
  assert.ok(rec.layout.items.every(i => i.t !== 'elevator_s' && i.id === undefined), 'saved without the building\'s own pieces and ids');
  const same = fitSaved(B, 1, rec, L);
  assert.equal(same.remove.length, 0);
  const strip = list => list.map(({ id, ...r }) => { void id; return r; });
  assert.deepEqual(strip(same.layout.items).filter(i => i.t !== 'elevator_s'), strip(L.items).filter(i => i.t !== 'elevator_s'), 'the same floor back');
  assert.ok(same.layout.items.some(i => i.t === 'elevator_s'), 'the building\'s own elevator stays');
  const small = { ...B, w: B.w - 6 };
  const fit = fitSaved(small, 1, rec, L);
  assert.ok(fit.remove.length > 0, 'a narrower floor cannot take everything');
  assert.ok(fit.layout.zones.every(z => z[2] <= small.w / 2 && z[0] >= -small.w / 2), 'floor areas are cut to the walls');
});
