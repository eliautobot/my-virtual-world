// The Crowd Studio's skeleton (2026-11-20, the product owner: "skeletal view and skeletal control of each individual
// component … for a specific animation … updated on the fly"): single bones' turns kept in the tuning (every animation of
// a body, or one clip's), applied by applyRig about each bone's own joint, carrying what hangs from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeTuning, cleanBones, cleanShift, applyRig, withClipFix, BONE_LIMIT, SHIFT_LIMIT } from '../shared/crowd-tuning.js';

const HALF = new Float32Array(65536);
for (let h = 0; h < 65536; h++) { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; HALF[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15); }

test('the tuning keeps single bones: names checked, turns clamped, empty ones dropped', () => {
  assert.equal(BONE_LIMIT, 90);
  assert.deepEqual(cleanBones({ LeftForeArm: [10, 0, 200], 'bad name': [1, 2, 3], Head: [0, 0, 0], Spine: ['x', 5] }), { LeftForeArm: [10, 0, 90], Spine: [0, 5, 0] });
  assert.equal(cleanBones(null), null); assert.equal(cleanBones([1]), null);
  const t = normalizeTuning({ rig: { m: { arms: [1, 0, 0], bones: { Neck: [3, 0, 0] } } }, clips: { f: { wait: { bones: { LeftArm: [0, 0, -10] } }, sit: { bones: {} } } } });
  assert.deepEqual(t.rig.m, { arms: [1, 0, 0], bones: { Neck: [3, 0, 0] } });
  assert.deepEqual(t.clips.f, { wait: { bones: { LeftArm: [0, 0, -10] } } });
  assert.deepEqual(withClipFix('f', t.clips.f).wait.bones, { LeftArm: [0, 0, -10] });
});

test('a bone turned for one clip moves what hangs from it in that clip only — not its parent, not the other clips', () => {
  const man = JSON.parse(fs.readFileSync(new URL('../client/assets/crowd/male.json', import.meta.url), 'utf8')), bin = fs.readFileSync(new URL('../client/assets/crowd/male.bin', import.meta.url));
  const A = man.anim.data, data = new Uint16Array(bin.buffer.slice(bin.byteOffset + A.off, bin.byteOffset + A.off + A.len)), before = data.slice(), B = man.bones;
  const names = man.names.map(n => n.replace(/^mixamorig:/, '')), j = n => names.indexOf(n);
  const anim = { data, frames: man.anim.frames, bones: B, names: man.names, clips: man.clips };
  applyRig(anim, null, { wait: { bones: { LeftForeArm: [0, 0, -30] } } });
  const wait = man.clips.find(c => c.name === 'wait'), walk = man.clips.find(c => c.name === 'walk'), f = wait.off + 10, g = walk.off + 10;
  const moved = (fr, b) => { let d = 0; for (let i = 0; i < 12; i++) d = Math.max(d, Math.abs(HALF[data[(fr * B + b) * 12 + i]] - HALF[before[(fr * B + b) * 12 + i]])); return d; };
  assert.ok(moved(f, j('LeftForeArm')) > 0.05 && moved(f, j('LeftHand')) > 0.05, 'the forearm and the hand turn');
  assert.ok(moved(f, j('LeftArm')) < 1e-3 && moved(f, j('RightForeArm')) < 1e-3, 'the upper arm and the other side stay');
  assert.ok(moved(g, j('LeftForeArm')) < 1e-3, 'another clip stays');
});

test('the studio: the skeleton drawn, any bone picked and turned for the scope chosen, mirrored if asked', () => {
  const js = fs.readFileSync(new URL('../client/dev/crowd-studio.js', import.meta.url), 'utf8'), sk = fs.readFileSync(new URL('../client/dev/crowd-studio-skeleton.js', import.meta.url), 'utf8'), html = fs.readFileSync(new URL('../client/dev/crowd-studio.html', import.meta.url), 'utf8');
  for (const id of ['skelShow', 'skelRings', 'skelMirror', 'boneSel', 'boneSliders', 'boneReset', 'bonesReset', 'boneList']) assert.match(html, new RegExp(`id="${id}"`));
  // (the rings on the picked joint: a drag turns its bone in its own axes, on top of its turn when the drag began)
  assert.match(js, /new TransformControls\(cam, R\.domElement\); rings\.setMode\('rotate'\); rings\.setSpace\('local'\)/);
  assert.match(js, /new THREE\.Matrix4\(\)\.multiplyMatrices\(drag\.R0, L\), 'ZYX'/);
  assert.match(sk, /const frameOf = name =>/);
  assert.match(js, /function bonesOf\(make = false\) \{ const g = rigGroups\(make\);/);
  assert.match(js, /if \(o\) \{ const mv = mirrored\(vals\);/);
  assert.match(sk, /pivot\(A\.src \|\| A\.data, A\.frames, B, j, parent\[j\]\)/);
});

test('the whole body moved (the hips dragged): kept as a shift, every bone of that clip moved by it', () => {
  assert.equal(SHIFT_LIMIT, 0.5); assert.deepEqual(cleanShift([0, -0.05, 9]), [0, -0.05, 0.5]); assert.equal(cleanShift([0, 0, 0]), null);
  assert.deepEqual(normalizeTuning({ clips: { m: { sit: { shift: [0, -0.04, 0] } } } }).clips.m.sit, { shift: [0, -0.04, 0] });
  const man = JSON.parse(fs.readFileSync(new URL('../client/assets/crowd/male.json', import.meta.url), 'utf8')), bin = fs.readFileSync(new URL('../client/assets/crowd/male.bin', import.meta.url));
  const A = man.anim.data, data = new Uint16Array(bin.buffer.slice(bin.byteOffset + A.off, bin.byteOffset + A.off + A.len)), before = data.slice(), B = man.bones;
  applyRig({ data, frames: man.anim.frames, bones: B, names: man.names, clips: man.clips }, null, { sit: { shift: [0, -0.04, 0] } });
  const sit = man.clips.find(c => c.name === 'sit'), walk = man.clips.find(c => c.name === 'walk'), y = (d, f, b) => HALF[d[(f * B + b) * 12 + 7]];
  for (const b of [0, 10, 40]) assert.ok(Math.abs(y(data, sit.off + 5, b) - y(before, sit.off + 5, b) + 0.04) < 0.002, `bone ${b} down 4 cm`);
  assert.equal(y(data, walk.off + 5, 0), y(before, walk.off + 5, 0));
});

test('the studio moves a joint: the hips the whole body, any other the bones above it turned to reach (CCD)', () => {
  const js = fs.readFileSync(new URL('../client/dev/crowd-studio.js', import.meta.url), 'utf8'), html = fs.readFileSync(new URL('../client/dev/crowd-studio.html', import.meta.url), 'utf8');
  for (const id of ['gripTurn', 'gripMove', 'gripNote']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(js, /function chainOf\(n\) \{\n {2}const k = \/\^\(Left\|Right\)\(Hand\|Foot\|ToeBase\)\$\/\.test\(n\) \? 2 : n === 'Head' \? 3/);
  assert.match(js, /const L = Q\.clone\(\)\.invert\(\)\.multiply\(Tp\.clone\(\)\.invert\(\)\)\.multiply\(T\[n\]\)\.multiply\(Q\);/);
  assert.match(js, /if \(bone === 'Hips'\) \{\n {4}const g = rigGroups\(true\)/);
});

test('the studio: undo and redo (Ctrl+Z; Ctrl+Y, Ctrl+Shift+Z, Ctrl+R) — a burst of changes, a drag, one step', () => {
  const js = fs.readFileSync(new URL('../client/dev/crowd-studio.js', import.meta.url), 'utf8'), html = fs.readFileSync(new URL('../client/dev/crowd-studio.html', import.meta.url), 'utf8');
  assert.match(html, /id="undo"/); assert.match(html, /id="redo"/);
  assert.match(js, /if \(k === 'z' && !e\.shiftKey\) \{ e\.preventDefault\(\); undo\(\); \}/);
  assert.match(js, /else if \(k === 'y' \|\| k === 'r' \|\| \(k === 'z' && e\.shiftKey\)\) \{ e\.preventDefault\(\); redo\(\); \}/);
  assert.match(js, /if \(typeof rings !== 'undefined' && rings\.dragging\) \{ commitSoon\(\); return; \}/);
  assert.match(js, /\} else \{ drag = null; buildBones\(\); commit\(\); \}/);
});
