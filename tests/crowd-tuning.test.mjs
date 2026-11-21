// The crowd's tuning (shared/crowd-tuning.js, server/crowd-tuning-routes.js; set in the Crowd Studio, 2026-11-19): kept
// whole and safe, the parts switched off never worn, garments pushed out by kind and by name, and the bodies' postures
// turned in their baked animations about the joints' own points (skin and clothes as one).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { normalizeTuning, allowedParts, nextAllowed, pushOf, partOn, applyRig, pivot, parentName, toHalf, RIG_GROUPS, TUCK_DEFAULT } from '../shared/crowd-tuning.js';
import { addCrowdTuningRoutes, crowdTuningOf } from '../server/crowd-tuning-routes.js';
import { addKindHelpers } from './helpers/char-kinds.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = sex => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, `client/assets/crowd/${sex}.json`), 'utf8')), bin = fs.readFileSync(path.join(ROOT, `client/assets/crowd/${sex}.bin`));
  const a = man.anim, data = new Uint16Array(bin.buffer.slice(bin.byteOffset + a.data.off, bin.byteOffset + a.data.off + a.data.len));
  return { man, anim: { data, frames: a.frames, bones: man.bones, names: man.names } };
};
const half = h => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023; return e === 0 ? s * f * 2 ** -24 : s * (1 + f / 1024) * 2 ** (e - 15); };
/** Where joint `name` is in frame f: its bone's matrix on its bind point. */
function jointAt(anim, f, name, p) {
  const j = anim.names.findIndex(n => n.endsWith(':' + name) || n === name), o = (f * anim.bones + j) * 12, M = i => half(anim.data[o + i]);
  return [0, 1, 2].map(r => M(r * 4) * p[0] + M(r * 4 + 1) * p[1] + M(r * 4 + 2) * p[2] + M(r * 4 + 3));
}
const idx = (anim, n) => anim.names.findIndex(x => x.replace(/^mixamorig:/, '') === n);

test('a tuning is kept whole and safe: unknown keys dropped, numbers clamped, names trimmed', () => {
  const t = normalizeTuning({ junk: 1, tuck: 9, off: { m: { top: [' Charcoal notched overcoat ', 'Charcoal notched overcoat', 7, ''] , cape: ['x'] }, x: { top: ['y'] } },
    push: { m: { 'top/*': 0.004, 'top/Cable V-neck': 1, 'cape/x': 0.01, nope: 0.01, 'shoes/Lace-up derby': 0 } }, rig: { m: { shoulders: [6, 99, -99], wings: [1, 1, 1], head: [0, 0, 0] } } });
  assert.deepEqual(Object.keys(t).sort(), ['bake', 'clips', 'face', 'hide', 'off', 'push', 'readyMade', 'rig', 'tuck', 'version']);
  assert.equal(t.tuck, 0.04);
  assert.deepEqual(t.off, { m: { top: ['Charcoal notched overcoat'] } });
  assert.deepEqual(t.push, { m: { 'top/*': 0.004, 'top/Cable V-neck': 0.03 } });
  assert.deepEqual(t.rig, { m: { shoulders: [6, 30, -30] } });
  assert.equal(normalizeTuning(null).tuck, TUCK_DEFAULT);
  // the skin under the clothes not drawn: on unless turned off (only false turns it off)
  assert.equal(normalizeTuning(null).hide, true); assert.equal(normalizeTuning({ hide: false }).hide, false); assert.equal(normalizeTuning({ hide: 0 }).hide, true);
  assert.equal(pushOf(t, 'm', 'top', 'Cable V-neck'), 0.034, 'every top\'s, and its own');
  assert.equal(pushOf(t, 'm', 'top', 'Track jacket'), 0.004);
  assert.equal(pushOf(t, 'f', 'top', 'Track jacket'), 0);
});

test('parts switched off are never worn: the next one on instead, every one when all of a kind are off', () => {
  const { man } = lib('male'), t = normalizeTuning({ off: { m: { top: ['Charcoal notched overcoat'], shoes: man.parts.shoes.map(p => p.name) } } });
  const a = allowedParts(t, 'm', man), coat = man.parts.top.findIndex(p => p.name === 'Charcoal notched overcoat');
  assert.ok(coat >= 0 && !a.top.includes(coat) && a.top.length === man.parts.top.length - 1);
  assert.equal(a.shoes.length, man.parts.shoes.length, 'all shoes off: all worn (nobody barefoot)');
  assert.equal(nextAllowed(coat, a.top, man.parts.top.length), (coat + 1) % man.parts.top.length);
  assert.ok(!partOn(t, 'm', 'top', 'Charcoal notched overcoat') && partOn(t, 'f', 'top', 'Charcoal notched overcoat'));
  // the renderer's recipe: 2000 residents, none in the overcoat
  const ctx = addKindHelpers(fs.readFileSync(path.join(ROOT, 'client/js/render/characters.js'), 'utf8'), vm.createContext({ KINDS: ['male', 'female'] }));
  const counts = Object.fromEntries(['head', 'hair', 'beard', 'top', 'bottom', 'shoes'].map(c => [c, man.parts[c].length]));
  let seen = 0;
  for (let i = 0; i < 2000; i++) { const r = ctx.crowdRecipe(i, { skin: '#c98c62', top: '#123456' }, counts, [], a); assert.notEqual(r.top, coat); if (r.top === (coat + 1) % counts.top) seen++; }
  assert.ok(seen > 100, 'its neighbour worn in its place');
});

test('the rig: each joint found where it and its parent always meet, and turned about it in every frame', () => {
  const { man, anim } = lib('male');
  assert.equal(parentName('LeftHandThumb2'), 'LeftHandThumb1'); assert.equal(parentName('Neck'), 'Spine2'); assert.equal(parentName('Hips'), null);
  // the ankle found from the frames alone is the library's own
  const foot = pivot(anim.data, anim.frames, anim.bones, idx(anim, 'LeftFoot'), idx(anim, 'LeftLeg'));
  foot.forEach((x, k) => assert.ok(Math.abs(x - man.feet.L[k]) < 0.004, `ankle ${k}: ${x.toFixed(4)} vs ${man.feet.L[k]}`));
  const data0 = anim.data.slice();
  assert.equal(applyRig({ ...anim, data: data0 }, {}), 0, 'nothing to turn: untouched');
  assert.deepEqual(data0, anim.data);
  const P = n => pivot(anim.data, anim.frames, anim.bones, idx(anim, n), idx(anim, parentName(n)));
  const pts = { LA: P('LeftArm'), RA: P('RightArm'), HT: P('Head'), LF: P('LeftFoot') }, idle = man.clips.find(c => c.name === 'idle').off + 10;
  const before = Object.fromEntries(Object.entries(pts).map(([k, p]) => [k, jointAt(anim, idle, { LA: 'LeftArm', RA: 'RightArm', HT: 'Head', LF: 'LeftFoot' }[k], p)]));
  const turned = { ...anim, data: anim.data.slice() };
  assert.equal(applyRig(turned, { shoulders: [8, 0, 0], neck: [10, 0, 0] }), 3);
  const after = Object.fromEntries(Object.entries(pts).map(([k, p]) => [k, jointAt(turned, idle, { LA: 'LeftArm', RA: 'RightArm', HT: 'Head', LF: 'LeftFoot' }[k], p)]));
  assert.ok(after.LA[1] - before.LA[1] > 0.01 && after.RA[1] - before.RA[1] > 0.01, `both shoulders raised (${(after.LA[1] - before.LA[1]).toFixed(3)}, ${(after.RA[1] - before.RA[1]).toFixed(3)} m)`);
  assert.ok(Math.abs((after.LA[1] - before.LA[1]) - (after.RA[1] - before.RA[1])) < 0.004, 'mirrored: the same on both sides');
  assert.ok(after.HT[2] - before.HT[2] > 0.008 && after.HT[2] - before.HT[2] < 0.03, `the head goes forward with the neck (${(after.HT[2] - before.HT[2]).toFixed(3)} m)`);
  assert.ok(Math.hypot(...after.LF.map((x, k) => x - before.LF[k])) < 0.002, 'the legs untouched');
  assert.ok(RIG_GROUPS.every(g => g.bones.every(b => idx(anim, b) >= 0)), 'every group\'s joints are in the skeleton');
  assert.equal(half(toHalf(1.2345)).toFixed(3), '1.234');
  // a clip's own posture, on top of the body's: only that clip's frames change
  const sit = man.clips.find(c => c.name === 'sit'), sf = sit.off + 5;
  const own = { ...anim, clips: man.clips, data: anim.data.slice() };
  assert.equal(applyRig(own, {}, { sit: { chest: [-8, 0, 0] }, nope: { chest: [5, 0, 0] } }), 1);
  const hp = P('Head');
  const headSit0 = jointAt(anim, sf, 'Head', hp), headSit1 = jointAt(own, sf, 'Head', hp);
  assert.ok(headSit0[2] - headSit1[2] > 0.02, `sitting: the chest leans back, the head with it (${(headSit0[2] - headSit1[2]).toFixed(3)} m)`);
  const headIdle0 = jointAt(anim, idle, 'Head', hp), headIdle1 = jointAt(own, idle, 'Head', hp);
  assert.ok(Math.hypot(...headIdle0.map((x, k) => x - headIdle1[k])) < 1e-6, 'standing: untouched');
  const t2 = normalizeTuning({ clips: { m: { sit: { chest: [-8, 0, 0], wings: [1, 1, 1] }, 'Bad Name': { chest: [1, 0, 0] }, empty: {} } } });
  assert.deepEqual(t2.clips, { m: { sit: { chest: [-8, 0, 0] } } });
});

test('kept by the server: read by anyone who can watch the world, written by those who can edit it, whole and safe', async () => {
  const routes = [], dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowd-tuning-')), logged = [];
  addCrowdTuningRoutes({ add: r => routes.push(r) }, { dataDir, audit: { log: (k, d) => logged.push([k, d]) } });
  const get = routes.find(r => r.method === 'GET'), post = routes.find(r => r.method === 'POST');
  assert.equal(get.cap, 'world.view'); assert.equal(post.cap, 'world.edit');
  let r = await get.handler({});
  assert.equal(r.status, 200); assert.equal(r.json.tuck, TUCK_DEFAULT); assert.deepEqual(r.json.off, {});
  r = await post.handler({ P: { account: { id: 1, login: 'kim' } }, body: { off: { f: { top: ['Belted gabardine trench'] } }, rig: { m: { shoulders: [6, 0, 0] } }, evil: '<script>' } });
  assert.equal(r.status, 200); assert.equal(r.json.by, 'kim');
  const kept = JSON.parse(fs.readFileSync(path.join(dataDir, 'crowd-tuning.json'), 'utf8'));
  assert.deepEqual(kept.off, { f: { top: ['Belted gabardine trench'] } }); assert.equal(kept.evil, undefined);
  r = await get.handler({}); assert.deepEqual(r.json.rig, { m: { shoulders: [6, 0, 0] } }); assert.equal(r.json.by, 'kim');
  assert.equal(logged[0][0], 'crowd.tuning');
  assert.equal((await post.handler({ P: {}, body: [1, 2] })).status, 400);
  assert.equal((await post.handler({ P: {}, body: { off: { m: { top: ['x'.repeat(250000)] } } } })).status, 413);
});

test('until an installation saves its own, the release\'s tuning is used (client/assets/crowd/tuning.json: the product\'s fixes)', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crowd-tuning-rel-'));
  const rel = normalizeTuning(JSON.parse(fs.readFileSync(path.join(root, 'client/assets/crowd/tuning.json'), 'utf8')));
  assert.ok(Object.keys(rel.clips.m || {}).length >= 50, 'the men\'s animation fixes');
  assert.equal(rel.by, undefined); assert.equal(rel.at, undefined);
  const routes = []; addCrowdTuningRoutes({ add: r => routes.push(r) }, { dataDir, root });
  const get = routes.find(r => r.method === 'GET'), post = routes.find(r => r.method === 'POST');
  let r = await get.handler({});
  assert.equal(r.json.source, 'release'); assert.equal(r.json.by, null); assert.deepEqual(r.json.clips, rel.clips);
  assert.deepEqual(crowdTuningOf(dataDir, root).tuning, rel); assert.equal(crowdTuningOf(dataDir, root).saved, null);
  await post.handler({ P: { account: { id: 1, login: 'owner' } }, body: { rig: { m: { shoulders: [6, 0, 0] } } } });
  r = await get.handler({}); assert.equal(r.json.source, 'saved'); assert.equal(r.json.by, 'owner'); assert.deepEqual(r.json.clips, {}, 'its own, whole');
  assert.deepEqual(crowdTuningOf(dataDir, path.join(dataDir, 'no-release')).tuning.clips, {}, 'no release tuning either: none');
});

test('the renderer draws with it: garments pushed out, the skin tucked, the crowd\'s studio able to show a crowd resident', () => {
  const src = fs.readFileSync(path.join(ROOT, 'client/js/render/characters.js'), 'utf8');
  assert.match(src, /uniform float uPush;/); assert.match(src, /uniform float uTuck;/);
  assert.match(src, /charShrink = cv \? uTuck : 0\.0;/); assert.match(src, /transformed -= normal \* \(charShrink - uPush\);/);
  // (the skin deep under the clothes worn not drawn — the tuning's hide; nearer their openings drawn, pulled in; every
  // geometry with the deep attribute, zeros where a library has none)
  assert.match(src, /charCov = dv \? 1\.0 : 0\.0;/); assert.match(src, /attribute vec3 aDeep;/);
  assert.equal((src.match(/g\.setAttribute\('aDeep', deepAttr\(L, view\)\)/g) || []).length, 3); assert.match(src, /vCovered = charCov \* uHideCov;/);
  assert.match(src, /if \(vCovered > 0\.995\) discard;/); assert.match(src, /this\.hideU\.value = t\.hide === false \? 0 : 1;/);
  // (only the bodies' and heads' shader may discard — the clothes', hair's and every other character's keep the GPU's early
  // depth test; one zero buffer for the geometries without their own deep bits)
  assert.match(src, /if \(cover\) sh\.fragmentShader = sh\.fragmentShader\.replace\('#include <clipping_planes_fragment>'/);
  assert.match(src, /cover = !depth && !mask && hidesSkin\(kind\)/); assert.match(src, /\$\{cover \? '-cover' : ''\}/);
  assert.match(src, /if \(!ZERO_DEEP \|\| ZERO_DEEP\.count < n\)/);
  // (what someone holds goes with their body as the near level draws it, the close-up level's body a part without a rig)
  assert.match(src, /const holder = kind;/); assert.match(src, /this\.props\.push\(holder, x, y, z/);
  // (a blink's pace and moment from who someone is, not where they stand — from their position it changed every frame
  // they walked: their eyelids flashed shut at random)
  assert.doesNotMatch(src, /dot\(iPos\.xz/); assert.match(src, /float h = chHash\(iMisc\.y, 5\.0\);/);
  // (the outline round a selected or hovered crowd resident: its every part drawn into the mask with its body)
  assert.match(src, /if \(hl\) hl\.parts\.push\(pk, q\);/); assert.match(src, /for \(let p = 0; p < h\.parts\.length; p \+= 2\) one\(h\.parts\[p\], h\.j, h\.parts\[p \+ 1\], h\.sel\);/);
  const studio = fs.readFileSync(path.join(ROOT, 'client/dev/crowd-studio.js'), 'utf8');
  assert.match(studio, /tun\.hide = h\.checked/);
  assert.match(src, /pushT\(k, x, y, z, yaw, tA, pA, tB, pB, w, app, prop = 0, flags = 0\) \{\n {4}const kind[^\n]*\n {4}\/\/ \(a crowd resident/);
  assert.ok(fs.existsSync(path.join(ROOT, 'client/dev/crowd-studio.html')) && fs.existsSync(path.join(ROOT, 'client/dev/crowd-studio.js')));
});

test('the faces: every crowd head tagged — brows, lips, the mouth\'s opening, the eyes\' globes — its eyes\' centres where its globes are', async () => {
  const { FACE } = await import('../shared/crowd-tuning.js');
  const t = normalizeTuning({ face: { glance: 99, talk: -1, blinkEvery: 0 } });
  assert.equal(t.face.glance, FACE.glance[2]); assert.equal(t.face.talk, 0); assert.equal(t.face.blinkEvery, 0); assert.equal(t.face.smile, FACE.smile[0]);
  for (const sex of ['female', 'male']) {
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, `client/assets/crowd/${sex}.json`), 'utf8')), bin = fs.readFileSync(path.join(ROOT, `client/assets/crowd/${sex}.bin`));
    for (const h of man.parts.head) {
      const L = h.lods[0], mask = new Uint8Array(bin.buffer.slice(bin.byteOffset + L.mask.off, bin.byteOffset + L.mask.off + L.mask.len)), pos = new Float32Array(bin.buffer.slice(bin.byteOffset + L.pos.off, bin.byteOffset + L.pos.off + L.pos.len));
      const n = {}; let far = 0, lo = 9, hi = 0;
      for (let v = 0; v < L.verts; v++) {
        const f = mask[v * 4 + 1]; n[f] = (n[f] || 0) + 1;
        if (f === 6 || f === 7) { const c = h.eyes[f - 6], d = Math.hypot(pos[v * 3] - c[0], pos[v * 3 + 1] - c[1], pos[v * 3 + 2] - c[2]); lo = Math.min(lo, d); hi = Math.max(hi, d); if (d > 0.04) far++; }
      }
      assert.ok(n[1] > 50 && n[2] > 20 && n[3] > 20 && (n[4] || 0) + (n[5] || 0) > 4 && n[6] > 100 && n[7] > 100, `${sex} ${h.name}: ${JSON.stringify(n)}`);
      assert.equal(far, 0, `${sex} ${h.name}: only the eyes' globes turn (${far} vertices away from them)`);
      assert.ok(hi - lo < 0.008, `${sex} ${h.name}: the globes' surfaces about their centres (${lo.toFixed(4)}–${hi.toFixed(4)} m)`);
      assert.ok(h.eyes[0][0] > 0.015 && h.eyes[1][0] < -0.015 && Math.abs(h.eyes[0][1] - h.eyes[1][1]) < 0.003, `${sex} ${h.name}: the left eye at +x, the right at −x`);
    }
  }
  // the renderer moves them: the face's function, its uniforms, the clips that talk and smile
  const src = fs.readFileSync(path.join(ROOT, 'client/js/render/characters.js'), 'utf8');
  assert.match(src, /vec3 chFace\(vec3 p\)/); assert.match(src, /if \(uEyeL\.w > 0\.5\) transformed = chFace\(transformed\);/);
  assert.match(src, /uBlinkEvery \* \(0\.75 \+ h \* 0\.5\)/);
  // drawn from both sides as the builder draws them (its garments, hair and face features double-sided): the crowd's
  // parts and characters built in the Agent Studio; the crowd's bare body and the ready-made characters one-sided
  const ctx = addKindHelpers(src, vm.createContext({ KINDS: ['male', 'female'] })), two = k => vm.runInContext(`twoSided(${JSON.stringify(k)})`, ctx);
  assert.ok(two('crowd_m|shoes|3') && two('crowd_f|top|0') && two('crowd_f|head|2') && two('c_0123456789abcdef'));
  assert.ok(!two('crowd_m') && !two('crowd_f') && !two('m05') && !two('f12'));
  assert.equal((src.match(/if \(twoSided\(kind\)\) m\.side = THREE\.DoubleSide;/g) || []).length, 2, 'the materials and the outline\'s mask');
});
