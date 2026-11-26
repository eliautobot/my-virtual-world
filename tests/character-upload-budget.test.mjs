// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// With a renderer, each loaded model's maps and animation texture go to the GPU one per frame (from begin()) before
// its meshes exist, so no single frame uploads a whole model. Without one, behaviour is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ADDED_CHARACTERS, defaultChar } from '../shared/appearance.js';
import { TEXTURED } from '../client/assets/chars/index.js';
import { addKindHelpers } from './helpers/char-kinds.mjs';

const code = fs.readFileSync(new URL('../client/js/render/characters.js', import.meta.url), 'utf8');
function fixture(renderer, { clock = null, cost = 0 } = {}) {
  const kinds = ['male', 'female', ...TEXTURED], uploads = [], frames = [];
  const ctx = {
    THREE: { Group: class {}, Vector3: class {} }, KINDS: kinds, ADDED_CHARACTERS, ONLY: null,
    wanted: k => k !== 'male' && k !== 'female', defaultChar, packAppearance() {}, console,
    loadKind: async k => { await new Promise(r => setTimeout(r, 1)); return { k, colorMap: { k, m: 'color' }, normalMap: { k, m: 'normal' }, tex: { k, m: 'anim' } }; },
    Promise, Uint32Array, Uint8Array, Float32Array, performance: clock || performance,
    // (the things characters hold: render/char-props.js, not under test here)
    CharProps: class { begin() {} end() {} push() {} initKind() {} setShadows() {} count() { return 0; } }, shapeFor: () => 0,
  };
  addKindHelpers(code, ctx);
  vm.runInContext(code.slice(code.indexOf('export class Characters')).replace('export class Characters', 'class Characters').replace('export { TRIPO_CLIPS };', '') + '\nglobalThis.C=Characters;', ctx);
  ctx.C.prototype.loadRig = function () {};
  ctx.C.prototype.grow = function (n) { this.cap = n; this.kindOf = new Uint8Array(n); this.appData = new Uint8Array(n * 32); this.appTex = { needsUpdate: false }; };
  ctx.C.prototype.initKind = function (k, d) { this.kinds[k] = { d }; frames.push({ k, uploadedBefore: uploads.filter(t => t.k === d.k).length }); };
  const c = new ctx.C({ capacity: 64, lods: [0], shadows: false, crowd: false, renderer: renderer && { initTexture: t => { uploads.push(t); if (clock) clock.t += cost; } } });
  return { c, kinds, uploads, frames };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('with a renderer, uploads run one per frame and a model appears only after its maps and animation are on the GPU', async () => {
  const f = fixture(true);
  let begins = 0, maxPerFrame = 0;
  for (let i = 0; i < 2000 && !f.c.loaded; i++) {
    const before = f.uploads.length; f.c.begin(); begins++;
    maxPerFrame = Math.max(maxPerFrame, f.uploads.length - before);
    await tick();
  }
  assert.equal(f.c.loaded, true);
  assert.equal(f.frames.length, 44, 'all 44 models still load');
  assert.equal(maxPerFrame, 1, 'never more than one upload per frame');
  assert.equal(f.uploads.length, 44 * 3);
  assert.ok(f.frames.every(x => x.uploadedBefore === 3), 'maps + animation uploaded before the model is created');
  assert.ok(begins >= 44 * 3);
});

test('without a renderer nothing is queued and models initialise as soon as they load', async () => {
  const f = fixture(false);
  await f.c.ready;
  assert.equal(f.c.loaded, true);
  assert.equal(f.frames.length, 44);
  assert.equal(f.uploads.length, 0);
  assert.equal(f.c.uploads.length, 0);
});

test('uploads skip frames that spike above the device\'s normal pace, keep a steadily slower device loading, and space out after an expensive one', async () => {
  const clock = { t: 0, now() { return this.t; } }, spiky = fixture(true, { clock });
  let onSpike = 0, onNormal = 0;
  for (let i = 0; i < 80; i++) { await tick(); const spike = i % 5 === 4; clock.t += spike ? 60 : 16; const n = spiky.uploads.length; spiky.c.begin(); if (spike) onSpike += spiky.uploads.length - n; else onNormal += spiky.uploads.length - n; }
  assert.equal(onSpike, 0, 'no upload right after a spike frame');
  assert.ok(onNormal >= 40, `normal frames keep uploading (${onNormal})`);
  const slowClock = { t: 0, now() { return this.t; } }, slow = fixture(true, { clock: slowClock });
  let done = 0;
  for (let i = 0; i < 80; i++) { await tick(); slowClock.t += 40; const n = slow.uploads.length; slow.c.begin(); done += slow.uploads.length - n; }
  assert.ok(done >= 50, `a device whose frames are always 40 ms keeps loading (${done} uploads in 80 frames)`);
  const costly = fixture(true, { clock: { t: 0, now() { return this.t; } }, cost: 12 }), ck = costly.c;
  while (!ck.uploads.length) await tick();
  const seq = [];
  for (let i = 0; i < 16; i++) { const n = costly.uploads.length; ck.begin(); seq.push(costly.uploads.length - n); ck.lastBegin = undefined; }
  assert.deepEqual(seq.slice(0, 8), [1, 0, 0, 0, 1, 0, 0, 0], 'a 12 ms upload is followed by three free frames');
});

// Each character's mesh at each detail holds only as many instances as are drawn with it, doubling when more are
// (2026-10-04: sized for every possible person, the 129 meshes' buffers were ~74 MB of zeros at the first frame).
test('instance room starts small per character and detail, doubles when needed and keeps what was pushed', async () => {
  const f = fixture(false);
  f.c.grow(12032); f.c.cap = 12032;
  const k = f.kinds.indexOf('m01'); for (let i = 0; i < 700; i++) f.c.kindOf[i] = k;
  const s0 = f.c.stage[k][0];
  assert.equal(s0.cap, 256, 'starts with room for 256');
  assert.equal(f.c.stage.flat().every(s => s.cap === 256), true, 'every character and detail alike, not the 12032 people');
  f.c.begin();
  for (let i = 0; i < 700; i++) f.c.pushT(0, i, 0, 0, 0, 0, 0, 0, 0, 0, i);   // (pushT: the same room as push, without the clip table)
  const s = f.c.stage[k][0];
  assert.equal(s.n, 700, 'all 700 kept');
  assert.equal(s.cap, 1024, 'doubled twice');
  assert.equal(s.P[699 * 4], 699, 'the last one where it belongs');
  assert.equal(s.P[255 * 4], 255, 'and those pushed before it grew');
  assert.equal(f.c.stage[f.kinds.indexOf('f01')][0].cap, 256, 'other characters untouched');
});

// 2026-11-02 (measured on a phone: an upload costs the main thread ~1 ms and the GPU a frame or two later): uploads whose
// following frames come late, more often than this device's frames usually do, are spaced further apart; a model's
// appearance is a step of its own, never in the frame of a map's upload.
test('uploads that make the next frames late are spaced out; a model appears in a frame of its own', async () => {
  const run = async lag => {
    const clock = { t: 0, now() { return this.t; } }, f = fixture(true, { clock });
    let sinceUpload = 99, done = 0, both = 0;
    for (let i = 0; i < 300; i++) {
      await tick();
      clock.t += lag && sinceUpload < 2 ? 70 : 16;   // (the GPU's share of the last upload lands on the next frames)
      const n = f.uploads.length, m = f.frames.length; f.c.begin();
      const up = f.uploads.length - n, made = f.frames.length - m;
      if (up && made) both++;
      sinceUpload = up ? 0 : sinceUpload + 1; done += up;
    }
    return { done, both };
  };
  const free = await run(false), laggy = await run(true);
  assert.equal(free.both + laggy.both, 0, 'never a map and a model in one frame');
  assert.ok(free.done >= 90, `uploads the GPU doesn't feel keep going (${free.done} in 300 frames)`);
  assert.ok(laggy.done < free.done / 2, `uploads it does feel are spaced out (${laggy.done} against ${free.done})`);
  assert.ok(laggy.done >= 12, `and still go on (${laggy.done})`);
});

test('someone whose model is still loading is drawn as a loaded one of the same build', () => {
  const f = fixture(false), K = f.kinds, c = f.c, i = n => K.indexOf(n);
  c.kinds = [];
  assert.equal(c.standInFor(i('f05')), -1, 'nothing loaded yet: not drawn');
  c.kinds[i('m03')] = {};
  assert.equal(c.standInFor(i('f05')), i('m03'), 'only a man loaded: drawn as him rather than not at all');
  c.kinds[i('f02')] = {}; c.standIns = {};
  assert.equal(c.standInFor(i('f05')), i('f02'), 'a woman as a woman');
  assert.equal(c.standInFor(i('m10')), i('m03'), 'a man as a man');
});

test('the page\'s own player\'s body first (2026-11-25: "the player character turns into a different body"): its model starts beside the ones on their way and goes up to the GPU before theirs, even while the pacing holds the others back', async () => {
  const f = fixture(true), k = f.kinds.indexOf('m22');
  // (the city's 44 queued, 4 on their way; the page's own player wears m22, near the end of the queue)
  f.c.setAppearance(5, { char: 'm22', body: 0 }, false, 2);
  f.c.skip = 50;   // (the pacing holding uploads back: frames came late)
  let begins = 0;
  for (; begins < 400 && !f.c.kinds[k]; begins++) { f.c.begin(); await tick(); }
  assert.ok(f.c.kinds[k], 'its model is in');
  const at = f.frames.findIndex(x => x.k === k);   // (initKind's k: the model's index)
  assert.equal(at, 0, `the first model in (${f.frames.map(x => f.kinds[x.k]).slice(0, 5).join(', ')})`);
  assert.equal(f.frames[at].uploadedBefore, 3, 'its maps and animation on the GPU before it');
  assert.ok(begins <= 8, `within a few frames, not held by the pacing (${begins})`);
  assert.ok(f.c.skip > 0, 'the others still paced');
  // and the rest load as before
  f.c.skip = 0;
  for (let i = 0; i < 4000 && !f.c.loaded; i++) { f.c.begin(); await tick(); }
  assert.equal(f.frames.length, 44, 'all 44 models still load');
  assert.equal(new Set(f.frames.map(x => x.k)).size, 44, 'each once');
  assert.equal(f.frames.filter(x => x.k === k).length, 1);
});

test('another player\'s body (render/player/remote.js): next in the queue, paced like the rest', async () => {
  const f = fixture(false), K = f.kinds;
  f.c.setAppearance(6, { char: 'f21', body: 1 }, false, 1);
  assert.ok(f.c.near[K.indexOf('f21')] >= 1e9, 'ahead of everyone on screen');
  assert.ok(!f.c.hurry.has(K.indexOf('f21')), 'not hurried past the pacing');
  f.c.setAppearance(7, { char: 'f20', body: 1 });
  assert.equal(f.c.near[K.indexOf('f20')], 0, 'a resident: as before');
});
