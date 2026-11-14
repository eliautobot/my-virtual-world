// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing game's Tripo fish (2026-11-13, the owner: "replacing all the fishing game fishes and items using new tripo
// model, and new animations"): every model listed in client/assets/fish/index.json is a species or a find of the game,
// with a skinned manifest the wildlife's loader takes (render/fauna-skinned.js), its clips (held up and flopping,
// swimming, thrashing), its meshes inside its file, a fish one metre long nose to tail along +x, and its Fishdex card.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECIES, FINDS } from '../shared/fish-species.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/assets/fish');
const index = fs.existsSync(path.join(DIR, 'index.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).models : [];

test('the fish models are the game\'s species and finds, each complete', () => {
  const ids = new Set([...SPECIES.map(s => s.id), ...FINDS.map(f => f.id)]);
  for (const id of index) {
    assert.ok(ids.has(id), `${id} is a species or a find`);
    const man = JSON.parse(fs.readFileSync(path.join(DIR, id, `${id}.json`), 'utf8')), bin = fs.statSync(path.join(DIR, id, `${id}.bin`)).size;
    assert.equal(man.v, 1, id);
    assert.ok(man.clips.rest && (man.kind === 'find' || (man.clips.run && man.clips.swim && man.clips.walk)), `${id}: its clips`);
    assert.equal(man.lods.length, 3, id);
    for (const L of man.lods) for (const k of ['pos', 'nrm', 'uv', 'skin', 'weight', 'index']) assert.ok(L[k] >= 0 && L[k] < bin, `${id}: ${k} inside its file`);
    assert.ok(man.anim.offset + man.anim.frames * man.anim.bones * 48 <= bin, `${id}: its clips' matrices inside its file`);
    for (const c of Object.values(man.clips)) assert.ok(c.start + c.frames <= man.anim.frames, `${id}: a clip inside the frames`);
    if (man.kind === 'fish') assert.ok(Math.abs(man.length - 1) < 0.08 && man.lods[0].max[0] > 0.3 && man.lods[0].min[0] < -0.3, `${id}: a metre long along x (${man.length})`);
    for (const t of [man.textures.color, man.textures.mask, man.card]) assert.ok(fs.existsSync(path.join(DIR, id, t)), `${id}: ${t}`);
  }
});
