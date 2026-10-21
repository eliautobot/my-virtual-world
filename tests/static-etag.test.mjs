// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Static files carry content-hash ETags, so a file a new release leaves unchanged revalidates with 304 instead of
// being downloaded again (release folders get new modification times).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tools/lib/testserver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = file => `"${crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('base64url').slice(0, 27)}"`;

test('static ETags are content hashes, independent of modification time, and answer 304 when unchanged', async () => {
  const s = await startServer();
  try {
    for (const [url, file] of [['/js/main.js', 'client/js/main.js'], ['/shared/vehicleproto.js', 'shared/vehicleproto.js']]) {
      const first = await fetch(s.url + url);
      assert.equal(first.status, 200);
      await first.arrayBuffer();
      const etag = first.headers.get('etag');
      assert.equal(etag, expected(file), `${url} ETag is its content hash`);
      const again = await fetch(s.url + url, { headers: { 'if-none-match': etag } });
      assert.equal(again.status, 304);
      assert.equal((await again.arrayBuffer()).byteLength, 0);
      assert.equal(again.headers.get('etag'), etag);
      const stale = await fetch(s.url + url, { headers: { 'if-none-match': '"old-mtime-tag"' } });
      assert.equal(stale.status, 200);
      await stale.arrayBuffer();
    }
    const parallel = await Promise.all([1, 2, 3].map(() => fetch(s.url + '/js/main.js').then(async r => { await r.arrayBuffer(); return r.headers.get('etag'); })));
    assert.ok(parallel.every(e => e === expected('client/js/main.js')));
  } finally { await s.stop(); }
});
