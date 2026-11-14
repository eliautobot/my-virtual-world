// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The wildlife's and the fishing game's models over HTTP (2026-11-14: every visit downloaded the animals' 50 MB again):
// each folder publishes its version, and a file asked for at that version may be kept a year (server/index.mjs,
// server/asset-compress.js); asked for without it, the browser checks again as before.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../tools/lib/testserver.mjs';

test('the animals\' and fish models\' folders: a version each, a year\'s keeping at that version, a check without it', async () => {
  const s = await startServer({ population: 20 });
  try {
    for (const [folder, file] of [['fauna', 'horse/horse.bin'], ['fish', 'bluegill/bluegill.bin'], ['chars', 'version.json']]) {
      const r = await fetch(`${s.url}/assets/${folder}/version.json`), { v } = await r.json();
      assert.equal(r.status, 200); assert.match(v, /^[0-9a-f]{12}$/, `${folder}: a version`);
      assert.equal(r.headers.get('cache-control'), 'no-cache');
      if (folder === 'chars') continue;
      const kept = await fetch(`${s.url}/assets/${folder}/${file}?v=${v}`, { headers: { 'accept-encoding': 'br, gzip' } });
      assert.equal(kept.status, 200); await kept.arrayBuffer();
      assert.equal(kept.headers.get('cache-control'), 'public, max-age=31536000, immutable', `${folder}: kept a year at its version`);
      assert.equal(kept.headers.get('vary'), 'Accept-Encoding');
      const plain = await fetch(`${s.url}/assets/${folder}/${file}?v=old`); await plain.arrayBuffer();
      assert.notEqual(plain.headers.get('cache-control'), 'public, max-age=31536000, immutable', `${folder}: not kept at another version`);
    }
    assert.equal((await fetch(`${s.url}/assets/nothing/version.json`)).status, 404);
  } finally { await s.stop(); }
});
