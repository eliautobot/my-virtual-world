// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The character builder's limits (server/characters/): a server many people use keeps its work and its disk — each new
// character is ~10 s of one core and ~20 MB kept for good — so one person's new characters a day are limited by the
// setting characters.bakesPerDay (administrators aren't), and none is baked once the data disk is nearly full.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuiltCharacters, addCharacterRoutes } from '../server/characters/index.js';
import { encodeKit } from '../shared/char-kit.js';
import { SETTINGS } from '../server/settings.js';

const JOINTS = JSON.parse(fs.readFileSync(new URL('./fixtures/builder-joints.json', import.meta.url), 'utf8'));
const BONES = [0, 3, 8, 12, 17, 38, 39, 44];
/** A small character of the builder's base skeleton (as tests/built-characters.test.mjs's); `tint` makes each a different one. */
function kit(tint) {
  const joints = Float32Array.from(JOINTS.male), pos = [], nrm = [], col = [], j = [], w = [], idx = [];
  for (const bone of BONES) {
    const [x, y, z] = [joints[bone * 3], joints[bone * 3 + 1], joints[bone * 3 + 2]], s = 0.02, v0 = pos.length / 3;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1 ? s : -s, dy = c & 2 ? s : -s, dz = c & 4 ? s : -s, l = Math.hypot(dx, dy, dz);
      pos.push(x + dx, y + dy, z + dz); nrm.push(dx / l, dy / l, dz / l); col.push(tint, 150, 120, 255); j.push(bone, 0, 0, 0); w.push(255, 0, 0, 0);
    }
    for (const [a, b2, c2, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) idx.push(v0 + a, v0 + b2, v0 + c2, v0 + a, v0 + c2, v0 + d);
  }
  return encodeKit({ gender: 'male', joints, preset: { gender: 'male', tint }, parts: [{ name: 'body', role: 'body', pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), col: Uint8Array.from(col), j: Uint8Array.from(j), w: Uint8Array.from(w), idx: Uint32Array.from(idx) }] });
}
/** BuiltCharacters with a stand-in bake (writes the manifest it is asked for). */
function setup(o = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'char-limits-root-')), data = fs.mkdtempSync(path.join(os.tmpdir(), 'char-limits-data-'));
  fs.mkdirSync(path.join(root, 'tools/chars'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/chars/custom-kind.mjs'), `
    import fs from 'node:fs'; import path from 'node:path';
    const a = process.argv.slice(2), at = k => a[a.indexOf(k) + 1];
    fs.writeFileSync(path.join(at('--out'), at('--id') + '.json'), '{}');`);
  return new BuiltCharacters({ data, root, log: {}, ...o });
}

test('one person\'s new characters a day are limited; the same look again, an administrator and another person are not', async () => {
  const kitOf = kit;
  const chars = setup(), lim = account => ({ account, perDay: 2 });
  const a = await chars.bake(kitOf(1), 'a', lim(7)), b = await chars.bake(kitOf(2), 'a', lim(7));
  assert.equal(a.baked, true); assert.equal(b.baked, true); assert.equal(chars.bakedToday(7), 2);
  await assert.rejects(chars.bake(kitOf(3), 'a', lim(7)), e => e.status === 429 && e.code === 'daily_limit' && /2 new characters today/.test(e.message));
  assert.equal((await chars.bake(kitOf(1), 'a', lim(7))).baked, false, 'one already built: worn again, never refused');
  assert.equal((await chars.bake(kitOf(3), 'b', lim(8))).baked, true, 'another person has their own');
  assert.equal((await chars.bake(kitOf(4), 'admin', null)).baked, true, 'no limit (an administrator)');
  assert.equal((await chars.bake(kitOf(5), 'a', { account: 7, perDay: 0 })).baked, true, '0: no limit');
});

test('no new character once the data disk is nearly full', async () => {
  const chars = setup({ minFreeBytes: Number.MAX_SAFE_INTEGER });
  await assert.rejects(chars.bake(kit(9)), e => e.status === 507 && e.code === 'no_room');
  const ok = setup(); const r = await ok.bake(kit(9));
  assert.equal(r.baked, true); assert.ok(ok.freeBytes() > 0);
});

test('the route holds people to the setting and lets administrators through; the setting is an administrator\'s, 20 a day', async () => {
  const s = SETTINGS.find(x => x.path === 'characters.bakesPerDay');
  assert.ok(s); assert.equal(s.default, 20); assert.equal(s.min, 0); assert.equal(s.cap, 'world.edit');
  const routes = [], seen = [];
  const chars = { bake: async (buf, who, limit) => { seen.push(limit); return { id: 'c_0123456789abcdef', baked: true, ms: 1 }; } };
  addCharacterRoutes({ add: r => routes.push(r) }, chars, { readRaw: async () => Buffer.from([1]), perDay: () => 3, unlimited: P => P.admin === true });
  const post = routes.find(r => r.path === '/api/characters/bake');
  await post.handler({ P: { account: { id: 5 } }, req: {} });
  await post.handler({ P: { account: { id: 1 }, admin: true }, req: {} });
  assert.deepEqual(seen, [{ account: 5, perDay: 3 }, null]);
});
