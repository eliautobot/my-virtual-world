// The crowd baked again with the owner's detail (server/crowd-bake.js, 2026-11-19): a bake runs the library's tool with the
// tuning's levels, puts its library in place (the previous kept), the city served from it; one at a time; a bake made for
// another release's library is not used; back to the release's own. (The tool itself is a stand-in here: it writes a
// library and says what it was given.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CrowdBake, addCrowdBakeRoutes } from '../server/crowd-bake.js';
import { normalizeTuning } from '../shared/crowd-tuning.js';

function setup({ fail = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crowd-bake-root-')), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowd-bake-data-'));
  fs.mkdirSync(path.join(root, 'client/assets/crowd'), { recursive: true }); fs.mkdirSync(path.join(root, 'tools/chars'), { recursive: true });
  for (const s of ['female', 'male']) { fs.writeFileSync(path.join(root, `client/assets/crowd/${s}.json`), JSON.stringify({ release: 1, s })); fs.writeFileSync(path.join(root, `client/assets/crowd/${s}.bin`), 'x'); }
  // (the stand-in tool: the arguments it was given, as each body's manifest)
  fs.writeFileSync(path.join(root, 'tools/chars/crowd-pack.mjs'), `
    import fs from 'node:fs'; import path from 'node:path';
    const a = process.argv.slice(2), at = k => a[a.indexOf(k) + 1];
    console.log('[male 1s] animation…');
    if (${fail}) process.exit(3);
    for (const s of ['female', 'male']) { fs.writeFileSync(path.join(at('--out'), s + '.json'), JSON.stringify({ url: at('--url'), bake: a.includes('--bake') ? JSON.parse(at('--bake')) : null })); fs.writeFileSync(path.join(at('--out'), s + '.bin'), 'y'); }
    console.log('[male 2s] written');`);
  const swaps = [];
  const bake = new CrowdBake({ root, dataDir, url: () => 'http://builder.example', log: {}, onSwap: dir => swaps.push(dir) });
  return { root, dataDir, bake, swaps };
}
const done = bake => new Promise(r => { const t = setInterval(() => { if (!bake.state.running) { clearInterval(t); r(); } }, 20); });

test('a bake with the owner\'s levels, put in place and served; one at a time; the previous kept; back to the standard', async () => {
  const { root, dataDir, bake, swaps } = setup();
  assert.equal(bake.activeDir(), path.join(root, 'client/assets/crowd'), 'the release\'s own at first');
  const want = normalizeTuning({ bake: { near: 0.001, far: 0.02 } }).bake;
  assert.equal(bake.start(want, 'kim'), true);
  assert.equal(bake.start(want), false, 'one at a time');
  await done(bake);
  assert.equal(bake.state.ok, true, bake.state.error);
  const dir = path.join(dataDir, 'crowd'), man = JSON.parse(fs.readFileSync(path.join(dir, 'male.json'), 'utf8'));
  assert.deepEqual(man.bake, { near: 0.001, far: 0.02 }); assert.equal(man.url, 'http://builder.example');
  assert.equal(bake.activeDir(), dir); assert.deepEqual(swaps, [dir]);
  const st = bake.status(); assert.equal(st.served, 'baked'); assert.equal(st.built.by, 'kim'); assert.ok(st.lines.some(l => /written/.test(l)));
  assert.equal(bake.resume({ bake: want }), false, 'the same settings, the same release: not baked again');
  // a second bake: the first kept as crowd-prev
  bake.start(null); await done(bake);
  assert.ok(fs.existsSync(path.join(dataDir, 'crowd-prev/male.json')) && JSON.parse(fs.readFileSync(path.join(dir, 'male.json'), 'utf8')).bake === null);
  // the release's library changes: the bake is stale — the release's own served, and made again at start-up
  fs.writeFileSync(path.join(root, 'client/assets/crowd/male.json'), JSON.stringify({ release: 2 }));
  assert.equal(bake.activeDir(), path.join(root, 'client/assets/crowd')); assert.equal(bake.status().stale, true);
  assert.equal(bake.resume({ bake: want }), true); await done(bake);
  assert.equal(bake.activeDir(), dir);
  // back to the standard
  assert.equal(bake.standard(), true); assert.equal(bake.activeDir(), path.join(root, 'client/assets/crowd')); assert.equal(swaps.at(-1), path.join(root, 'client/assets/crowd'));
  assert.equal(bake.resume({}), false, 'no settings: nothing baked at start-up');
});

test('a release whose own library was made with the saved settings\' bake: served as it is, never baked at start-up (no browser needed)', async () => {
  const { root, dataDir, bake, swaps } = setup();
  const want = normalizeTuning({ bake: { close: 0.000283 } }).bake, rel = path.join(root, 'client/assets/crowd');
  fs.writeFileSync(path.join(rel, 'male.json'), JSON.stringify({ release: 3, made: { bake: { close: 0.000283 } } }));
  assert.deepEqual(bake.releaseBake(), want);
  assert.equal(bake.resume({ bake: want }), false, 'the release has it');
  assert.equal(bake.state.running, false); assert.equal(bake.activeDir(), rel);
  // an installation's own bake from before, for this release with these settings: the release's served instead
  fs.mkdirSync(path.join(dataDir, 'crowd'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'crowd/male.json'), '{}');
  fs.writeFileSync(path.join(dataDir, 'crowd/build.json'), JSON.stringify({ base: bake.base(), bake: want }));
  assert.equal(bake.activeDir(), rel, 'the same as the release\'s: the release\'s served');
  assert.equal(bake.resume({ bake: want }), false); assert.deepEqual(swaps, []);
  // other settings than the release's: baked as before
  assert.equal(bake.resume({ bake: { close: 0.0005 } }), true); await done(bake);
  assert.equal(bake.state.ok, true, bake.state.error);
});

test('a failed bake leaves the crowd as it was and says why', async () => {
  const { root, bake, swaps } = setup({ fail: true });
  bake.start({ near: 0.001 }); await done(bake);
  assert.equal(bake.state.ok, false); assert.match(bake.state.error, /stopped \(3\)/);
  assert.equal(bake.activeDir(), path.join(root, 'client/assets/crowd')); assert.deepEqual(swaps, []);
});

test('the routes: for those who can edit the world; start with the saved settings, back to the standard, nothing else', async () => {
  const { bake } = setup(), routes = [];
  let saved = { bake: { middle: 0.005 } };
  addCrowdBakeRoutes({ add: r => routes.push(r) }, { bake, readTuning: () => saved });
  const get = routes.find(r => r.method === 'GET'), post = routes.find(r => r.method === 'POST');
  assert.equal(get.cap, 'world.edit'); assert.equal(post.cap, 'world.edit');
  assert.equal((await post.handler({ P: {}, body: { action: 'melt' } })).status, 400);
  let r = await post.handler({ P: { account: { id: 1, login: 'kim' } }, body: { action: 'start' } });
  assert.equal(r.status, 202); assert.deepEqual(r.json.bake, { middle: 0.005 });
  assert.equal((await post.handler({ P: {}, body: { action: 'start' } })).status, 409);
  await done(bake);
  r = await get.handler({}); assert.equal(r.json.served, 'baked');
  saved = {}; r = await post.handler({ P: {}, body: { action: 'standard' } }); assert.equal(r.json.served, 'standard');
});

test('the tuning\'s bake: each level\'s error, within its bounds; none — the standard', () => {
  assert.equal(normalizeTuning({}).bake, null);
  assert.deepEqual(normalizeTuning({ bake: { near: 0.0006, middle: '0.004', far: null, huge: 1 } }).bake, { near: 0.0006, middle: 0.004 });
  assert.deepEqual(normalizeTuning({ bake: { near: 0, far: 9 } }).bake, { near: 0.00005, far: 0.2 });
});
