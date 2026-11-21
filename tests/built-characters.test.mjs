// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Characters made in the builder (2026-11-18: the character builder is the characters' new foundation): a look wears a
// built character by its id (shared/appearance.js), the kit the browser sends is checked before anything reads it
// (shared/char-kit.js), and the city bakes it into a model of its own with every clip a ready-made character has — the
// bake's own, the added ones (swimming, holding things, cooking …) and the nights out's — with where it holds things, its
// head and how it sits (tools/chars/custom-kind.mjs, server/characters/), served compressed and kept for good.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isCustomChar, isCharacter, femaleLook, sanitizeAppearance, appToArr, arrToAppFull, CHARACTERS } from '../shared/appearance.js';
import { encodeKit, decodeKit } from '../shared/char-kit.js';
import { BuiltCharacters } from '../server/characters/index.js';
import { startServer, ownerSession } from '../tools/lib/testserver.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const JOINTS = JSON.parse(fs.readFileSync(new URL('./fixtures/builder-joints.json', import.meta.url), 'utf8'));
const BONE = { Hips: 0, LeftFoot: 3, RightFoot: 8, Spine1: 12, LeftHand: 17, Neck: 38, Head: 39 };
const RIGHT_HAND = 44;   // (RightShoulder 41, RightArm 42, RightForeArm 43, RightHand 44)

/** A small character of the builder's base skeleton: a little box at each of a few joints, each on its own bone. */
function tinyKit(gender = 'male', tint = 200) {
  const joints = Float32Array.from(JOINTS[gender]), pos = [], nrm = [], col = [], j = [], w = [], idx = [];
  for (const b of [...Object.values(BONE), RIGHT_HAND]) {
    const [x, y, z] = [joints[b * 3], joints[b * 3 + 1], joints[b * 3 + 2]], s = 0.02, v0 = pos.length / 3;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1 ? s : -s, dy = c & 2 ? s : -s, dz = c & 4 ? s : -s, l = Math.hypot(dx, dy, dz);
      pos.push(x + dx, y + dy, z + dz); nrm.push(dx / l, dy / l, dz / l); col.push(tint, 150, 120, 255); j.push(b, 0, 0, 0); w.push(255, 0, 0, 0);
    }
    for (const [a, b2, c2, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) idx.push(v0 + a, v0 + b2, v0 + c2, v0 + a, v0 + c2, v0 + d);
  }
  return encodeKit({ gender, joints, preset: { gender, tint }, parts: [{ name: 'body', role: 'body', pos: Float32Array.from(pos), nrm: Float32Array.from(nrm), col: Uint8Array.from(col), j: Uint8Array.from(j), w: Uint8Array.from(w), idx: Uint32Array.from(idx) }] });
}
const quiet = { info() {}, error() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-built-'));

test('a look wears a built character by its id; its sex is the look\'s body; ready-made ones are unchanged', () => {
  const id = 'c_0123456789abcdef';
  assert.ok(isCustomChar(id) && isCharacter(id));
  for (const bad of ['c_0123', 'c_0123456789ABCDEF', 'c_0123456789abcdef0', '../c_0123456789abcdef', 'x_0123456789abcdef', 7, null]) assert.equal(isCustomChar(bad), false, String(bad));
  for (const body of [0, 1]) {
    const a = sanitizeAppearance({ char: id, body });
    assert.equal(a.char, id); assert.equal(a.body, body); assert.equal(femaleLook(a), !!body);
    assert.deepEqual(arrToAppFull(appToArr(a)), a, 'through the network form and back');
  }
  assert.notEqual(sanitizeAppearance({ char: 'c_../../etc/passwd' }).char, 'c_../../etc/passwd', 'anything else is not a character');
  for (const c of CHARACTERS) { const a = sanitizeAppearance({ char: c, body: c[0] === 'f' ? 0 : 1 }); assert.equal(a.body, c[0] === 'f' ? 1 : 0, `${c} keeps its own sex`); assert.equal(femaleLook(a), c[0] === 'f'); }
});

test('a kit from a browser is checked before anything reads it', () => {
  const buf = tinyKit(), kit = decodeKit(buf);
  assert.equal(kit.gender, 'male'); assert.equal(kit.joints.length, 195); assert.equal(kit.parts.length, 1); assert.deepEqual(kit.preset, { gender: 'male', tint: 200 });
  // (a kit with its header changed: the header re-written, its sections as they were)
  const split = buf => { const hl = new DataView(buf.buffer, buf.byteOffset).getUint32(0, true), base = 4 + hl + ((4 - ((4 + hl) % 4)) % 4); return { hl, base, h: JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hl))), body: buf.subarray(base) }; };
  const withHead = (buf, fn) => {
    const { h, body } = split(buf); fn(h);
    const nh = new TextEncoder().encode(JSON.stringify(h)), pre = 4 + nh.length, pad = (4 - (pre % 4)) % 4, o = new Uint8Array(pre + pad + body.length);
    new DataView(o.buffer).setUint32(0, nh.length, true); o.set(nh, 4); o.set(body, pre + pad); return o;
  };
  assert.equal(decodeKit(withHead(tinyKit(), () => {})).parts[0].pos.length, kit.parts[0].pos.length, 'the re-written kit reads as before');
  assert.throws(() => decodeKit(withHead(tinyKit(), h => { h.gender = 'robot'; })), /sex/);
  assert.throws(() => decodeKit(withHead(tinyKit(), h => { h.joints[5] = 99; })), /joints/);
  assert.throws(() => decodeKit(withHead(tinyKit(), h => { h.parts[0].at.idx += 4000000; })), /section/);
  assert.throws(() => decodeKit(withHead(tinyKit(), h => { h.parts[0].verts = 3; })), /index out of range/);
  const badBone = tinyKit(), { base, h } = split(badBone);
  const o = Uint8Array.from(badBone); o[base + h.parts[0].at.j] = 65;
  assert.throws(() => decodeKit(o), /bone out of range/);
  assert.throws(() => decodeKit(new Uint8Array(4)), /size/);
});

test('baked: every clip a ready-made character has, its grips, head and seats, within the ready-made budgets; once per character', { timeout: 120000 }, async () => {
  const dir = tmp();
  try {
    const chars = new BuiltCharacters({ data: dir, root: ROOT, log: quiet });
    const buf = tinyKit('female', 180);
    const [a, b] = await Promise.all([chars.bake(buf), chars.bake(buf)]);
    assert.equal(a.id, b.id, 'the same character asked twice at once: one bake'); assert.equal(a.baked, true);
    assert.ok(isCustomChar(a.id));
    const out = path.join(dir, 'chars'), man = JSON.parse(fs.readFileSync(path.join(out, a.id + '.json'), 'utf8'));
    for (const ext of ['.bin', '.bin.br', '.bin.gz', '.json.gz', '.preset.json']) assert.ok(fs.existsSync(path.join(out, a.id + ext)), ext);
    assert.deepEqual(chars.preset(a.id), { gender: 'female', tint: 180 });
    // every clip of the ready-made women's (the bake's own, the added ones and the nights out's), by name
    const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/chars', man.custom.ref + '.json'), 'utf8'));
    const extra = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/chars/extra-clips.json'), 'utf8'));
    const venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/assets/chars/venue-clips.json'), 'utf8'));
    const want = [...ref.clips, ...extra.clips, ...venue.clips].map(c => c.name), have = man.clips.map(c => c.name);
    assert.deepEqual(have, want, 'the same clips, in the same order');
    assert.ok(want.length >= 90, `${want.length} clips`);
    const frames = man.clips.reduce((s, c) => Math.max(s, c.off + c.len), 0);
    assert.equal(man.anim.frames, frames, 'every clip\'s frames are in its animation');
    assert.equal(man.custom.gender, 'female'); assert.match(man.custom.ref, /^f\d\d$/); assert.equal(man.vcol, true); assert.equal(man.bones, 65);
    assert.ok(man.grips && man.head && man.seated, 'where it holds things, its head, how it sits');
    assert.deepEqual(Object.keys(man.seated).sort(), Object.keys(venue.seated[man.custom.ref]).sort(), 'seat data for every seated clip its reference has');
    assert.deepEqual(Object.keys(man.grips).sort(), Object.keys(extra.grips[man.custom.ref]).sort(), 'a grip wherever its reference holds something');
    assert.equal(man.lods.length, 3);
    man.lods.forEach((L, i) => assert.ok(L.verts <= [24500, 6400, 2400][i] && L.tris <= [44000, 9200, 2700][i], `level ${i}: ${L.verts} v / ${L.tris} t`));
    // asked again later: there already, not baked again
    const again = await chars.bake(buf);
    assert.deepEqual([again.id, again.baked], [a.id, false]);
    await assert.rejects(chars.bake(Buffer.from('not a kit at all')), e => e.status === 400 && e.code === 'bad_kit');
    assert.equal(chars.preset('c_ffffffffffffffff'), null); assert.equal(chars.preset('../../x'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('over the API: baked for a signed-in player, refused to the signed-out, served compressed and kept for good', { timeout: 180000 }, async () => {
  const s = await startServer({ population: 40 });
  try {
    const owner = await ownerSession(s), kit = tinyKit('male', 90);
    const anon = await fetch(`${s.url}/api/characters/bake`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: kit });
    assert.ok([401, 403].includes(anon.status), `signed out: ${anon.status}`);
    const post = body => fetch(`${s.url}/api/characters/bake`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', cookie: owner.cookie, 'x-csrf-token': owner.csrf }, body });
    const r = await post(kit), j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j)); assert.ok(isCustomChar(j.id)); assert.equal(j.baked, true);
    const bad = await post(Buffer.from('nope'));
    assert.equal(bad.status, 400);
    const preset = await owner.get(`/api/characters/preset?id=${j.id}`);
    assert.equal(preset.status, 200); assert.deepEqual(preset.json.preset, { gender: 'male', tint: 90 });
    assert.equal((await owner.get('/api/characters/preset?id=c_ffffffffffffffff')).status, 404);
    const man = await fetch(`${s.url}/assets/chars/custom/${j.id}.json`);
    assert.equal(man.status, 200); assert.match(man.headers.get('cache-control') || '', /immutable/);
    assert.equal((await man.json()).kind, j.id);
    const bin = await fetch(`${s.url}/assets/chars/custom/${j.id}.bin`, { headers: { 'accept-encoding': 'br' } });
    assert.equal(bin.status, 200); assert.equal(bin.headers.get('content-encoding'), 'br');
    assert.equal((await fetch(`${s.url}/assets/chars/custom/..%2f..%2fsettings.json`)).status >= 400, true, 'nothing outside its folder');
    // a look names a built character only once it is baked here
    const no = await owner.post('/api/edit', { ops: [{ op: 'person.set', i: 0, app: { char: 'c_ffffffffffffffff', body: 0 } }], who: 'web' });
    assert.ok(no.status !== 200 || no.json?.ok === false, `an unbaked character is refused (${no.status} ${no.text?.slice(0, 120)})`);
    const yes = await owner.post('/api/edit', { ops: [{ op: 'person.set', i: 0, app: { char: j.id, body: 0 } }], who: 'web' });
    assert.ok(yes.status === 200 && yes.json?.ok !== false, `a baked one is worn (${yes.status} ${yes.text?.slice(0, 120)})`);
  } finally { await s.stop(); }
});
