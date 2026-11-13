// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// WP4.17 the wildlife catalogue: every species file listed in the index passes the schema (adding a species is data),
// the schema refuses broken entries, and active hours wrap past midnight.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateSpecies, activeAt, MODELS, BEHAVIOURS } from '../shared/species.js';

const DIR = new URL('../shared/world-config/species/', import.meta.url);
test('the species catalogue is valid data', () => {
  const idx = JSON.parse(fs.readFileSync(new URL('index.json', DIR), 'utf8'));
  assert.ok(idx.species.length >= 12);
  const seen = new Set();
  for (const id of idx.species) {
    const sp = JSON.parse(fs.readFileSync(new URL(`${id}.json`, DIR), 'utf8'));
    assert.deepEqual(validateSpecies(sp), [], id);
    assert.equal(sp.id, id); assert.ok(!seen.has(id)); seen.add(id);
  }
  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.slice(0, -5));
  assert.deepEqual(files.sort(), [...seen].sort(), 'every species file is listed and every listed species has a file');
});
test('the schema refuses broken entries; hours wrap past midnight', () => {
  // (deer without their liking for each habitat, which names their own habitats: other habitats are tried below)
  const { habitatWeight: _, ...ok } = JSON.parse(fs.readFileSync(new URL('deer.json', DIR), 'utf8'));
  assert.ok(validateSpecies({ ...ok, model: 'dragon' }).some(e => e.startsWith('model')));
  assert.ok(validateSpecies({ ...ok, behaviour: 'hunt' }).some(e => e.startsWith('behaviour')));
  assert.ok(validateSpecies({ ...ok, colors: ['red'] }).some(e => e.startsWith('colors')));
  assert.ok(validateSpecies({ ...ok, run: undefined }).length > 0, 'grazers need run and flee');
  assert.ok(MODELS.length >= 18 && BEHAVIOURS.length === 16);   // (sea and lake life added 2026-10-03: reef fish, turtles, otters, alligators; beavers; 2026-10-04: dolphins (pod), gulls, crabs (scuttle); 2026-11-12: sharks (patrol), whales (roam), jellyfish (drift), flamingos (wade))
  // (2026-11-12: white tigers near the snowy peaks — a snow habitat and an altitude band)
  assert.ok(validateSpecies({ ...ok, habitats: ['snow', 'rock'], altitude: [400, 5000] }).length === 0);
  assert.ok(validateSpecies({ ...ok, altitude: [500, 400] }).some(e => e.startsWith('altitude')));
  // (2026-11-12: rules for the second set — deep water, how deep a swimmer stays, leaping, near a lake or river)
  assert.ok(validateSpecies({ ...ok, depth: [25, 60], swimDepth: [0.5, 3], leaps: true, nearWater: 200 }).length === 0);
  assert.ok(validateSpecies({ ...ok, depth: [60, 25] }).some(e => e.startsWith('depth')));
  assert.ok(validateSpecies({ ...ok, leaps: 'yes' }).some(e => e.startsWith('leaps')));
  assert.ok(validateSpecies({ ...ok, breathe: true }).length === 0 && validateSpecies({ ...ok, breathe: 'often' }).some(e => e.startsWith('breathe')));   // (sea turtles up to breathe, 2026-11-12)
  assert.ok(['dolphin', 'seagull', 'crab'].every(m => MODELS.includes(m)) && validateSpecies({ ...ok, habitats: ['sea'] }).length === 0);
  assert.ok(validateSpecies({ ...ok, habitats: ['river'] }).length === 0 && validateSpecies({ ...ok, habitats: ['ocean'] }).some(e => e.startsWith('habitats')));
  // (2026-11-12: a liking for each habitat, and haunts by the island's water — bears where the rivers fall)
  assert.ok(validateSpecies({ ...ok, habitatWeight: { forest: 1, meadow: 0.2 }, haunts: [{ near: 'falls', within: 60, perKm2: 90, on: ['shore'] }, { near: 'river', within: 50, perKm2: 4 }] }).length === 0);
  assert.ok(validateSpecies({ ...ok, habitatWeight: { snow: 1 } }).some(e => e.startsWith('habitatWeight')), 'only its own habitats');
  assert.ok(validateSpecies({ ...ok, habitatWeight: { meadow: -1 } }).some(e => e.startsWith('habitatWeight')));
  assert.ok(validateSpecies({ ...ok, haunts: [{ near: 'volcano', within: 60, perKm2: 1 }] }).some(e => e.startsWith('haunts')));
  assert.ok(validateSpecies({ ...ok, haunts: [{ near: 'falls', perKm2: 1 }] }).some(e => e.startsWith('haunts')), 'a distance');
  assert.ok(validateSpecies({ ...ok, haunts: [{ near: 'lake', within: 60, perKm2: 1, on: ['lava'] }] }).some(e => e.startsWith('haunts')));
  const owl = { hours: [20.5, 5] };
  assert.ok(activeAt(owl, 23) && activeAt(owl, 2) && !activeAt(owl, 12));
});
