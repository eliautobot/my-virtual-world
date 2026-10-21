// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
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
  const ok = JSON.parse(fs.readFileSync(new URL('deer.json', DIR), 'utf8'));
  assert.ok(validateSpecies({ ...ok, model: 'dragon' }).some(e => e.startsWith('model')));
  assert.ok(validateSpecies({ ...ok, behaviour: 'hunt' }).some(e => e.startsWith('behaviour')));
  assert.ok(validateSpecies({ ...ok, colors: ['red'] }).some(e => e.startsWith('colors')));
  assert.ok(validateSpecies({ ...ok, run: undefined }).length > 0, 'grazers need run and flee');
  assert.ok(MODELS.length >= 18 && BEHAVIOURS.length === 12);   // (sea and lake life added 2026-10-03: reef fish, turtles, otters, alligators; beavers; 2026-10-04: dolphins (pod), gulls, crabs (scuttle))
  assert.ok(['dolphin', 'seagull', 'crab'].every(m => MODELS.includes(m)) && validateSpecies({ ...ok, habitats: ['sea'] }).length === 0);
  assert.ok(validateSpecies({ ...ok, habitats: ['river'] }).length === 0 && validateSpecies({ ...ok, habitats: ['ocean'] }).some(e => e.startsWith('habitats')));
  const owl = { hours: [20.5, 5] };
  assert.ok(activeAt(owl, 23) && activeAt(owl, 2) && !activeAt(owl, 12));
});
