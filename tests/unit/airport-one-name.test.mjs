// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// One name for an airport (server/world/edit.js ensureTerminals, at start; 2026-10-14): a terminal named before the rule
// takes the airport's name - unless its sign was renamed by hand (neither the airport's name nor the one its terminal was
// given), and then that name names the whole airport, its canopy and entrance sign too. Nothing else changes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Editor } from '../../server/world/edit.js';

const atStart = W => {
  const saves = [];
  const ed = { world: W, ground: () => true, sim: null, app: { save: o => saves.push(o) }, airportOf: Editor.prototype.airportOf };
  Editor.prototype.ensureTerminals.call(ed);
  return saves;
};
const airport = (name, terminal) => ({ worldModules: [{ id: 'wm0', kind: 'airport', name, y: 3, terminal: 0 }], buildings: [{ idx: 0, type: 'terminal', module: 'wm0', lv: [], ...terminal }], version: 1 });

test('a sign renamed by hand names the whole airport', () => {
  const W = airport('New Airport', { name: 'MV Airport Terminal', sign: 'MV Airport' });
  const saves = atStart(W);
  assert.equal(W.worldModules[0].name, 'MV Airport', 'the airport (canopy, entrance sign) takes it');
  assert.deepEqual([W.buildings[0].name, W.buildings[0].sign], ['MV Airport', 'MV Airport']);
  assert.equal(saves.length, 1); assert.equal(saves[0].docs, '*');
});

test('a terminal with the name it was given takes the airport\'s name; the airport keeps its own', () => {
  for (const t of [{ name: 'New Airport Terminal' }, { name: 'New Airport Terminal', sign: 'New Airport Terminal' }]) {
    const W = airport('New Airport', t);
    atStart(W);
    assert.equal(W.worldModules[0].name, 'New Airport');
    assert.deepEqual([W.buildings[0].name, W.buildings[0].sign], ['New Airport', 'New Airport']);
  }
});

test('already one name: nothing to do', () => {
  const W = airport('Harbour Field', { name: 'Harbour Field', sign: 'Harbour Field' });
  assert.equal(atStart(W).length, 0); assert.equal(W.version, 1);
});
