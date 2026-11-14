// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The characters' files over the wire (server/asset-compress.js): compressed once in the background, the copy that fits
// the browser picked, the folder's version changing with any file, stale copies removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { AssetCompressor } from '../server/asset-compress.js';
import { tempDir } from '../tools/lib/testserver.mjs';

test('character files: compressed in the background, picked by Accept-Encoding, versioned by content', async () => {
  const root = tempDir('mvw-charpack-'), dir = path.join(root, 'chars'), cache = path.join(root, 'cache');
  fs.mkdirSync(dir);
  const bin = Buffer.alloc(200000, 7); bin.write('mesh and clips', 1000);
  fs.writeFileSync(path.join(dir, 'f01.bin'), bin); fs.writeFileSync(path.join(dir, 'f01_color.jpg'), 'jpeg');
  try {
    const A = new AssetCompressor({ dir, cache, log: {} }), file = path.join(dir, 'f01.bin');
    assert.equal(A.pick(file, 'gzip, br'), null, 'plain until compressed');
    await A.warm();
    const b = A.pick(file, 'gzip, deflate, br'), g = A.pick(file, 'gzip');
    assert.equal(b.encoding, 'br'); assert.equal(g.encoding, 'gzip'); assert.equal(A.pick(file, ''), null);
    assert.ok(zlib.brotliDecompressSync(fs.readFileSync(b.path)).equals(bin)); assert.ok(zlib.gunzipSync(fs.readFileSync(g.path)).equals(bin));
    assert.ok(fs.statSync(b.path).size < bin.length / 10);
    assert.equal(A.pick(path.join(dir, 'f01_color.jpg'), 'br'), null, 'pictures are compressed already');
    // a changed file: a new version, its old copies gone, compressed again by the next server
    const v1 = A.version;
    fs.writeFileSync(file, Buffer.concat([bin, Buffer.from('more')])); fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const B = new AssetCompressor({ dir, cache, log: {} });
    assert.notEqual(B.version, v1);
    assert.equal(fs.readdirSync(cache).length, 0, 'the old copies were removed');
    await B.warm();
    assert.equal(fs.readdirSync(cache).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('nothing is compressed when the disk that would keep the copies is short of space', async () => {
  const root = tempDir('mvw-charpack-'), dir = path.join(root, 'chars'), cache = path.join(root, 'cache');
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'f01.bin'), Buffer.alloc(50000, 3));
  try {
    const said = [], A = new AssetCompressor({ dir, cache, log: { info: s => said.push(s) }, minFree: Number.MAX_SAFE_INTEGER });
    await A.warm();
    assert.equal(A.pick(path.join(dir, 'f01.bin'), 'br'), null, 'sent plain');
    assert.equal(fs.readdirSync(cache).length, 0, 'nothing written');
    assert.match(said.join(' '), /under 1 GB free/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a folder of model folders (the wildlife, the fish): walked through, each model\'s files compressed, one version for all', async () => {
  const root = tempDir('mvw-faunapack-'), dir = path.join(root, 'fauna'), cache = path.join(root, 'cache');
  for (const id of ['horse', 'deer']) {
    fs.mkdirSync(path.join(dir, id), { recursive: true });
    fs.writeFileSync(path.join(dir, id, `${id}.bin`), Buffer.alloc(120000, id.length)); fs.writeFileSync(path.join(dir, id, `${id}-color.jpg`), 'jpeg');
  }
  try {
    const said = [], A = new AssetCompressor({ dir, cache, log: { info: s => said.push(s) }, label: 'animals\'' });
    await A.warm();
    for (const id of ['horse', 'deer']) {
      const file = path.join(dir, id, `${id}.bin`), b = A.pick(file, 'br');
      assert.equal(b?.encoding, 'br', `${id}: compressed`);
      assert.ok(zlib.brotliDecompressSync(fs.readFileSync(b.path)).equals(fs.readFileSync(file)));
    }
    assert.equal(A.pick(path.join(dir, 'horse', 'horse-color.jpg'), 'br'), null);
    assert.match(said.join(' '), /2 animals' files compressed/);
    // a change in one model's folder: a new version for the whole folder
    const v1 = A.version, f = path.join(dir, 'deer', 'deer.bin');
    fs.writeFileSync(f, Buffer.alloc(120001, 4)); fs.utimesSync(f, new Date(), new Date(Date.now() + 5000));
    assert.notEqual(new AssetCompressor({ dir, cache, log: {} }).version, v1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
