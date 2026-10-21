// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Eating at a table (2026-10-07, "proper eating animations depending on the meal"): every dish has a way to be eaten
// (shared/food.js eat) and something to eat it with (render/char-props.js BITE: the food held by hand, or the cutlery
// with a forkful of the dish's colour); someone at a table with a dish plays its clip (eatClip) and holds its things
// (shapeFor), a drink is still sipped; every character has the four clips; the plate shows what is left (food-models
// taken / bare). Also the fingertips' fix: a finger's end joint stands on the finger, not a metre away.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../helpers/client-paths.mjs';
import { FOOD, FOOD_BY_ID, EAT_WAYS } from '../../shared/food.js';
import { EAT_CLIP, EAT_CLIPS } from '../../shared/eating.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), CHARS = path.join(ROOT, 'client/assets/chars');

test('every dish has a way to be eaten and something to eat it with; drinks are sipped', async () => {
  const { BITE } = await import('../../client/js/render/char-props.js');
  for (const it of FOOD) {
    if (it.v) { assert.equal(it.eat, undefined, it.id); assert.equal(BITE[it.id], undefined, `${it.id}: a drink is not eaten`); continue; }
    assert.ok(EAT_WAYS.includes(it.eat), `${it.id}: ${it.eat}`);
    const b = BITE[it.id];
    assert.ok(b, `${it.id} has no BITE`);
    const byHand = it.eat === 'hands' || it.eat === 'hand';
    assert.match(b, byHand ? /^f-[a-z]+ #[0-9a-f]{6}$/ : /^#[0-9a-f]{6}$/, `${it.id}: ${b}`);
  }
  assert.equal(Object.keys(BITE).length, FOOD.filter(i => !i.v).length, 'no BITE for a dish that is gone');
  // a few that matter: a burger in both hands, pizza by the slice, steak with knife and fork, soup with a spoon, ramen
  // with chopsticks, pasta with a fork
  for (const [id, way] of [['cheeseburger', 'hands'], ['pepperoni', 'hand'], ['ribeye', 'knife'], ['tomato_soup', 'spoon'], ['ramen', 'sticks'], ['spaghetti', 'fork'], ['pulled_pork', 'hands']]) assert.equal(FOOD_BY_ID[id].eat, way, id);
});

test('someone at a table with a dish plays its clip and holds its things; a drink is sipped; elsewhere nothing changes', async () => {
  const { eatClip, shapeFor, isEating, SHAPE } = await import('../../client/js/render/char-props.js');
  const { CLIP } = await import('../../client/js/render/anim.js');
  const n = id => FOOD_BY_ID[id].n;
  for (const it of FOOD) {
    if (it.v) { assert.equal(eatClip(CLIP.sit_drink, it.n), CLIP.sit_drink, `${it.id} sipped`); continue; }
    const c = eatClip(CLIP.sit_eat, it.n);
    assert.equal(c, CLIP[EAT_CLIP[it.eat]], it.id);
    assert.ok(isEating(c));
    assert.equal(eatClip(CLIP.sit_drink, it.n), c, `${it.id}: with a coffee beside it, it is still eaten`);
    const sh = shapeFor(c, 0, it.n);
    assert.ok(sh > 0, `${it.id} holds something`);
    assert.ok(Math.abs((sh % 1) * 640 - it.n) < 1e-3, `${it.id}: its colour rides with the shape`);
  }
  assert.equal(Math.floor(shapeFor(CLIP.eat_knife, 0, n('ribeye'))), SHAPE['u-knife+fork']);
  assert.equal(Math.floor(shapeFor(CLIP.eat_spoon, 0, n('ramen'))), SHAPE['u-sticks']);
  assert.equal(Math.floor(shapeFor(CLIP.eat_spoon, 0, n('tomato_soup'))), SHAPE['u-spoon']);
  assert.equal(Math.floor(shapeFor(CLIP.eat_spoon, 0, n('spaghetti'))), SHAPE['u-fork']);
  assert.equal(Math.floor(shapeFor(CLIP.eat_hands, 0, n('cheeseburger'))), SHAPE['f-burger']);
  // not at a table, or busy: the clip is left alone
  for (const c of [CLIP.sit_type, CLIP.sit_talk, CLIP.sit_phone, CLIP.walk]) assert.equal(eatClip(c, n('cheeseburger')), c);
  // no table (2026-10-08): on a sofa, or standing in the kitchen - in the hands
  assert.equal(eatClip(CLIP.sit_relax, n('cheeseburger')), CLIP.eat_hands);
  assert.equal(eatClip(CLIP.sit_relax, n('pizza_slice')), CLIP.eat_lap);
  assert.equal(eatClip(CLIP.idle, n('pbj')), CLIP.eat_stand_hands);
  assert.equal(eatClip(CLIP.idle, n('toast_jam')), CLIP.eat_stand);
  assert.equal(eatClip(CLIP.sit_relax, n('latte')), CLIP.sit_relax, 'a drink on a sofa is not eaten');
  assert.equal(Math.floor(shapeFor(CLIP.eat_lap, 0, n('pizza_slice'))), SHAPE['f-slice']);
  // cooking: a spoon in the pan; making something cold: a knife
  assert.equal(Math.floor(shapeFor(CLIP.cook, 0, n('home_pasta'))), SHAPE['u-spoon']);
  assert.equal(Math.floor(shapeFor(CLIP.prep, 0, n('pbj'))), SHAPE['u-knife']);
  assert.equal(eatClip(CLIP.sit_eat, 0), CLIP.sit_eat);
  assert.equal(shapeFor(CLIP.eat_hands, 0, n('latte')), 0, 'a drink is not eaten with the hands');
});

test('every character has the four eating clips, placed without the arm calibration', async () => {
  const ex = JSON.parse(fs.readFileSync(path.join(CHARS, 'extra-clips.json'), 'utf8'));
  const { TRIPO_CLIPS, TRIPO_EXACT, OLD_TO_TRIPO } = await import('../../client/js/render/charClips.js');
  const kinds = JSON.parse(/TEXTURED = (\[[^\]]*\])/.exec(fs.readFileSync(path.join(CHARS, 'index.js'), 'utf8'))[1].replace(/'/g, '"'));
  for (const name of [...EAT_CLIPS, 'eat_lap', 'eat_stand', 'eat_stand_hands']) {
    const c = ex.clips.find(x => x.name === name);
    assert.ok(c && c.len >= 32 && (c.hold === 'sit_idle' || c.hold === 'idle'), name);
    assert.ok(TRIPO_CLIPS.includes(name) && OLD_TO_TRIPO[name] === name && TRIPO_EXACT.has(name), name);
  }
  const frames = ex.clips.reduce((m, c) => Math.max(m, c.off + c.len), 0);
  for (const k of kinds) {
    assert.equal(ex.kinds[k], frames, `${k}: every added frame`);
    assert.equal(fs.statSync(path.join(CHARS, `${k}.extra.bin`)).size, frames * 65 * 24, `${k}.extra.bin`);
  }
});

test('eating, the wrist stays near straight: the hand turns at most ~40° from its forearm in every frame (dipping a fork looked like a broken wrist)', async () => {
  const { loadRig, app, h2f, sub, nrm, dot } = await import('../../tools/chars/rig.mjs');
  const ex = JSON.parse(fs.readFileSync(path.join(CHARS, 'extra-clips.json'), 'utf8'));
  for (const k of ['m03', 'f14', 'f01', 'm20', 'f05']) {
    const R = loadRig(CHARS, k), bin = fs.readFileSync(path.join(CHARS, `${k}.extra.bin`)), u16 = new Uint16Array(bin.buffer, bin.byteOffset, bin.length / 2);
    const J = (fr, n) => { const b = R.idx[n], m = Array.from({ length: 12 }, (_, q) => h2f(u16[(fr * R.NB + b) * 12 + q])); return app(m, R.J[b]); };
    for (const c of ex.clips.filter(x => x.name.startsWith('eat_'))) for (const s of ['Left', 'Right']) for (let f = 0; f < c.len; f++) {
      const fr = c.off + f, fore = nrm(sub(J(fr, s + 'Hand'), J(fr, s + 'ForeArm'))), hand = nrm(sub(J(fr, s + 'HandMiddle1'), J(fr, s + 'Hand')));
      const deg = Math.acos(Math.max(-1, Math.min(1, dot(fore, hand)))) * 180 / Math.PI;
      assert.ok(deg < 45, `${k} ${c.name} ${s} frame ${f}: the hand turned ${deg.toFixed(0)}° from the forearm`);
    }
  }
});

test('the added clips\' half floats round to the nearest (a carry into the exponent was or-ed: 0.49997 came out 0.25)', async () => {
  const { f2h, h2f } = await import('../../tools/chars/rig.mjs');
  for (const v of [0.49997, -0.49997, 0.124999, 1.99999, -3.99998, 0.999999, 0.3, -0.7071, 1e-3]) assert.ok(Math.abs(h2f(f2h(v)) - v) <= Math.abs(v) * 1e-3 + 1e-6, `${v} → ${h2f(f2h(v))}`);
});

test('a finger\'s end joint stands on the finger (the fingertips bent backward when it was a metre off)', async () => {
  const { loadRig, sub, len, nrm, dot } = await import('../../tools/chars/rig.mjs');
  for (const k of ['m03', 'f14', 'm15', 'f01']) {
    const R = loadRig(CHARS, k);
    for (const s of ['Left', 'Right']) for (const fg of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
      const J = n => R.J[R.idx[`${s}Hand${fg}${n}`]], d = sub(J(4), J(3));
      assert.ok(len(d) < 0.05, `${k} ${s}${fg}4 ${len(d)}`);
      assert.ok(dot(nrm(d), nrm(sub(J(3), J(2)))) > 0.99, `${k} ${s}${fg}4 along the finger`);
    }
  }
});

test('the plate shows what is left: a piece eaten by hand is off it, the cutlery in the hands is not beside it', async () => {
  const M = await import('../../client/js/render/food-models.js');
  const verts = (id, bare, taken) => M.foodGeometry(FOOD_BY_ID[id].n, false, bare, taken).geo?.attributes.position.count || 0;
  for (const id of ['cheeseburger', 'hot_dog', 'pizza_slice', 'club_sandwich', 'tacos', 'croissant', 'cookie', 'wings']) assert.ok(verts(id, false, true) < verts(id, false, false), `${id}: the piece in the hands is off the plate`);
  for (const id of ['ribeye', 'pancakes', 'nigiri']) assert.ok(verts(id, true, false) < verts(id, false, false), `${id}: no knife and fork (or chopsticks) beside the plate`);
  assert.ok(verts('burger_fries', false, true) > 0, 'the fries stay in the basket');
});
