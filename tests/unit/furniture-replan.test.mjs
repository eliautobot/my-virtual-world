// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Moving furniture re-plans only the people it concerns (2026-10-07: "if I move a furniture agents reset - if they
// are sleeping they get up"). A piece that changed re-plans whoever uses it or holds a place at it, stands where it was or
// now is, or is walking on that floor; everyone else on the floor carries on - a sleeper sleeps on. A wall still
// re-plans the whole floor.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Sim } from '../../server/sim/sim.js';
import { Editor } from '../../server/world/edit.js';
import { CATALOG } from '../../shared/catalog.js';
import { testCity } from '../helpers/world.mjs';

function setup() {
  const { world, people, index } = testCity({ seed: 'furniture-replan', population: 400 });
  const sim = new Sim(world, people, { index, budgetMs: 1e9 });
  sim.now = () => 0;
  sim.clock = { simBase: 0, realBase: 0, rate: 1, dayBase: 2.5 * 3600, dayScale: 16 };   // half past two at night
  sim.start();
  const editor = new Editor({ world, sim, save() {}, onPatches() {}, onNote() {} });
  const woken = new Set(), real = sim.brain.interruptSoon.bind(sim.brain);
  sim.brain.interruptSoon = (a, j) => { woken.add(a.i); return real(a, j); };
  return { world, sim, editor, woken };
}
/** Moves item it a little, trying a few directions until the editor accepts it. */
function nudge(editor, b, f, it) {
  for (const [dx, dz] of [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
    const r = editor.apply([{ op: 'item.move', b, f, id: it.id, x: it.x + dx, z: it.z + dz, r: it.r }], 'test');
    if (r.ok) return true;
  }
  return false;
}

test('moving a piece of furniture leaves the sleepers on that floor asleep; moving a sleeper\'s bed re-plans that sleeper', () => {
  const { world, sim, editor, woken } = setup();
  // a floor where several people are asleep
  const byFloor = new Map();
  for (const a of sim.agents) if (a.act?.kind === 'sleep' && a.act.b >= 0) { const k = `${a.act.b}:${a.act.f}`; if (!byFloor.has(k)) byFloor.set(k, []); byFloor.get(k).push(a); }
  const [key, sleepers] = [...byFloor].sort((x, y) => y[1].length - x[1].length)[0];
  assert.ok(sleepers.length >= 2, `a floor with sleepers (${key}: ${sleepers.length})`);
  const [b, f] = key.split(':').map(Number), B = world.buildings[b], L = world.levels[B.lv[f]];
  const used = new Set(sleepers.map(a => a.act.id));
  // a piece nobody sleeping uses (not a bed), moved a little
  const piece = L.items.find(it => !CATALOG[it.t]?.fixed && !used.has(it.id) && !/bed/.test(it.t) && nudge(editor, b, f, it));
  assert.ok(piece, 'a piece of furniture that could be moved');
  const plansBefore = new Map(sleepers.map(a => [a.i, a.plan]));
  const stillAsleep = sleepers.filter(a => !woken.has(a.i));
  // whoever stands right where it moved may re-plan; the rest sleep on, their plans untouched
  assert.ok(stillAsleep.length >= sleepers.length - 1, `sleepers woken by moving a ${piece.t}: ${sleepers.length - stillAsleep.length} of ${sleepers.length}`);
  for (const a of stillAsleep) { assert.equal(a.plan, plansBefore.get(a.i)); assert.equal(a.act.kind, 'sleep'); }
  // a sleeper's own bed moved: that sleeper re-plans
  woken.clear();
  const sleeper = stillAsleep.find(a => L.items.some(it => it.id === a.act.id));
  assert.ok(sleeper, 'a sleeper in a bed of this floor');
  const bed = L.items.find(it => it.id === sleeper.act.id);
  if (nudge(editor, b, f, bed)) assert.ok(woken.has(sleeper.i), 'moving its bed re-plans the sleeper');
});

test('a wall drawn on a floor still re-plans everyone there (the floor itself changed)', () => {
  const { world, sim, editor, woken } = setup();
  const a = sim.agents.find(x => x.act?.kind === 'sleep' && x.act.b >= 0 && world.buildings[x.act.b]?.type === 'apartment');
  assert.ok(a);
  // the editor's own rule for a layout change: every floor using that level re-plans (touchAgents)
  const ctx = (a.act.b << 6) | a.act.f;
  sim.touchAgents(c => c === ctx);
  assert.ok(woken.has(a.i));
});
