// Modelled animals (render/fauna-skinned.js, 2026-11-11: the Tripo wild horse with recolourable body, mane and legs): a
// species naming an asset has a well-formed manifest whose meshes, bone matrices and textures are all there, bones
// and weights in range, clips inside the matrix rows, and coats the catalogue can give every animal the server sends.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSpecies } from '../shared/species.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = path.join(ROOT, 'shared/world-config/species');
const species = JSON.parse(fs.readFileSync(path.join(SP, 'index.json'), 'utf8')).species.map(id => JSON.parse(fs.readFileSync(path.join(SP, `${id}.json`), 'utf8')));

test('the wild horse is a modelled animal with three coats', () => {
  const h = species.find(s => s.id === 'horse');
  assert.ok(h, 'the horse is in the catalogue');
  assert.deepEqual(validateSpecies(h), []);
  assert.equal(h.asset, '/assets/fauna/horse/horse.json');
  assert.equal(h.coats.length, 3);
  // the server picks a colour index from `colors`; every index must have a coat
  assert.ok(h.colors.length <= h.coats.length, 'a coat for every colour index');
});

test('the schema refuses a broken asset path or coat', () => {
  const h = species.find(s => s.id === 'horse');
  assert.ok(validateSpecies({ ...h, asset: '../../etc/passwd' }).some(p => p.startsWith('asset')));
  assert.ok(validateSpecies({ ...h, asset: 'https://elsewhere.example/horse.json' }).some(p => p.startsWith('asset')));
  assert.ok(validateSpecies({ ...h, coats: [{ body: '#123456', hair: 'brown', legs: '#000000' }] }).some(p => p.startsWith('coats')));
  assert.ok(validateSpecies({ ...h, coats: [] }).some(p => p.startsWith('coats')));
  const { asset, coats, ...plain } = h;
  assert.deepEqual(validateSpecies(plain), [], 'both stay optional');
});

for (const sp of species.filter(s => s.asset)) {
  test(`${sp.id}: the baked asset is complete and consistent`, () => {
    const file = path.join(ROOT, 'client', sp.asset), dir = path.dirname(file);
    const man = JSON.parse(fs.readFileSync(file, 'utf8'));
    const bin = fs.readFileSync(file.replace(/\.json$/, '.bin'));
    assert.equal(man.v, 1);
    assert.ok(fs.statSync(path.join(dir, man.textures.color)).size > 1000, 'the painted texture');
    assert.ok(fs.statSync(path.join(dir, man.textures.mask)).size > 0, 'the recolour mask (a blank one: the coat as painted)');
    const nb = man.bones.length;
    assert.equal(man.anim.bones, nb);
    assert.ok(nb > 0 && nb <= 64);
    assert.equal(man.lods.length, 3);
    let prevTris = Infinity;
    for (const L of man.lods) {
      assert.ok(L.tris < prevTris, 'each level of detail lighter than the last'); prevTris = L.tris;
      const end = (off, bytes) => { assert.ok(off % 4 === 0 && off + bytes <= bin.length, 'inside the bin'); };
      end(L.pos, L.verts * 12); end(L.nrm, L.verts * 12); end(L.uv, L.verts * 8); end(L.skin, L.verts * 4); end(L.weight, L.verts * 4);
      end(L.index, L.tris * 3 * (L.indexType === 'u16' ? 2 : 4));
      const skin = new Uint8Array(bin.buffer, bin.byteOffset + L.skin, L.verts * 4), w = new Uint8Array(bin.buffer, bin.byteOffset + L.weight, L.verts * 4);
      for (let i = 0; i < L.verts; i++) {
        assert.equal(w[i * 4] + w[i * 4 + 1] + w[i * 4 + 2] + w[i * 4 + 3], 255, 'weights sum to one');
        for (let k = 0; k < 4; k++) assert.ok(skin[i * 4 + k] < nb, 'bone slot in range');
      }
      const idx = L.indexType === 'u16' ? new Uint16Array(bin.buffer.slice(bin.byteOffset + L.index, bin.byteOffset + L.index + L.tris * 6)) : new Uint32Array(bin.buffer.slice(bin.byteOffset + L.index, bin.byteOffset + L.index + L.tris * 12));
      assert.ok(idx.every(v => v < L.verts), 'indices in range');
    }
    assert.ok(man.anim.offset % 4 === 0 && man.anim.offset + man.anim.frames * nb * 48 <= bin.length, 'the bone matrices are inside the bin');
    const M = new Float32Array(bin.buffer.slice(bin.byteOffset + man.anim.offset, bin.byteOffset + man.anim.offset + man.anim.frames * nb * 48));
    assert.ok(M.every(Number.isFinite), 'every matrix finite');
    // the clips its behaviour plays: a walker's rest, walk and run; a bird's (2026-11-12, tools/animals/bird_animal.py)
    // rest and its flying (fly, glide: a wingbeat rate), swimming or wading clips (a stride)
    const need = man.rig !== 'mvw-bird-v1' || sp.behaviour === 'graze' ? ['rest', 'walk', 'run']
      : ['rest', ...({ flock: ['fly', 'glide'], soar: ['fly', 'glide'], circle: ['fly', 'glide'], swim: ['swim'], wade: ['walk'] }[sp.behaviour] || [])];
    for (const k of need) assert.ok(man.clips[k], `clip ${k}`);
    for (const [k, c] of Object.entries(man.clips)) {
      assert.ok(['rest', 'walk', 'run', 'trot', 'fly', 'glide', 'swim'].includes(k), `a clip the game knows: ${k}`);
      assert.ok(c.start >= 0 && c.frames > 1 && c.start + c.frames <= man.anim.frames, `${k} inside the matrix rows`);
      if (['walk', 'run', 'trot', 'swim'].includes(k)) assert.ok(c.stride > 0, `${k} has a stride`);
      if (['fly', 'glide'].includes(k)) assert.ok(c.hz > 0 && c.hz < 12, `${k} has a wingbeat rate`);
    }
    for (const r of ['body', 'hair', 'points']) assert.ok(man.refLumLinear[r] > 0, `reference luminance ${r}`);
  });
}

test('an animal keeps its place in a clip when its speed changes, and cross-fades when its gait changes', async () => {
  const { motion } = await import('../client/js/render/fauna-motion.js');
  const st = {}; motion(st, 1, 1.0, 100, 0.3);
  const at = (s, t) => ((t * s.rate + s.off) % 1 + 1) % 1;
  const before = at(st, 105);
  motion(st, 1, 1.37, 105, 0.3);                      // faster along the next leg of its plan
  assert.ok(Math.abs(at(st, 105) - before) < 1e-9, 'same frame at the moment the rate changes');
  assert.equal(st.prev, null, 'no cross-fade for a change of speed');
  motion(st, 2, 2.2, 106, 0.3);                       // takes fright: walk -> gallop
  assert.deepEqual(st.prev.slice(2), [1, 106], 'the walk it leaves, and when');
  motion(st, 2, 2.2, 107.5, 0.3);
  assert.equal(st.prev, null, 'the cross-fade forgotten once it is over');
});
