// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The crowd prototype (2026-11-19): residents assembled from the character builder's parts (render/characters.js CROWD,
// client/assets/crowd/ made by tools/chars/crowd-pack.mjs). Its library is whole and within its budgets, each resident's
// parts are picked the same way on every page, and the library is served compressed and kept a year at its version.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { addKindHelpers } from './helpers/char-kinds.mjs';
import { startServer } from '../tools/lib/testserver.mjs';
import { loadRig } from '../tools/chars/rig.mjs';
import { retarget, orthonormal } from '../tools/chars/retarget.mjs';
import { TRUNK, CHARS } from '../tools/chars/custom-kind.mjs';

const read = p => fs.readFileSync(new URL(p, import.meta.url));
const source = read('../client/js/render/characters.js').toString();
const ctx = addKindHelpers(source, vm.createContext({ KINDS: ['male', 'female'] }));
const get = name => vm.runInContext(name, ctx);   // (its const helpers live in the context's own scope)
const PARTS = ['head', 'hair', 'beard', 'top', 'bottom', 'shoes'];
/** The budgets the library is made to (vertices per level; tools/chars/crowd-pack.mjs BUDGET). */
const BUDGET = { body: [5600, 1500, 550], head: [6000, 1900, 420], hair: [2600, 650, 180], beard: [1200, 300, 80], top: [3800, 950, 300], bottom: [2800, 700, 220], shoes: [1100, 280, 90] };   // (crowd-pack.mjs BUDGET)

test('the library: both bodies, every part at three levels within its budget, the look-alikes and dresses well formed', () => {
  for (const sex of ['female', 'male']) {
    const man = JSON.parse(read(`../client/assets/crowd/${sex}.json`)), bin = read(`../client/assets/crowd/${sex}.bin`);
    assert.equal(man.crowd, true); assert.equal(man.bones, 65); assert.equal(man.custom.gender, sex);
    assert.ok(man.clips.length >= 90, `${sex}: every clip (${man.clips.length})`);
    assert.equal(man.anim.frames, man.clips.reduce((m, c) => Math.max(m, c.off + c.len), 0), 'the animation holds every clip\'s frames');
    assert.ok(man.grips && man.head && man.seated, 'grips, head and seats');
    assert.deepEqual(man.keys, ['skin', 'hair', 'eyes', 'top', 'bottom', 'shoes']);
    assert.equal(man.parts.body.length, 1);
    for (const [cat, list] of Object.entries(man.parts)) {
      if (cat === 'beard' && sex === 'female') { assert.equal(list.length, 0); continue; }
      assert.ok(list.length >= (cat === 'body' ? 1 : 6), `${sex} ${cat}: ${list.length}`);
      for (const p of list) {
        assert.equal(p.lods.length, 3);
        p.lods.forEach((L, i) => {
          assert.ok(L.verts > 0 && L.verts <= BUDGET[cat][i], `${sex} ${cat} ${p.name} level ${i}: ${L.verts} vertices`);
          for (const k of ['pos', 'nrm', 'j', 'w', 'mask', 'limb', 'info', 'cov', 'idx', 'col']) assert.ok(L[k].off + L[k].len <= bin.length, `${k} inside the file`);
        });
        if (cat !== 'body') for (const lvl of [1, 2]) assert.ok(Number.isInteger(p.far[lvl]) && p.far[lvl] < list.length && list[p.far[lvl]].dress === p.dress, `${cat} ${p.name}: its look-alike at ${lvl}`);
      }
    }
    if (sex === 'female') assert.ok(man.parts.top.some(p => p.dress), 'a dress among the tops');
    // its finish packed in col.a beside the normal map's flag (man.light); the occlusion no longer baked (2026-11-19, the
    // product owner reverted the characters' lighting: crowd-pack OCCLUSION false) — limb.y 1 everywhere
    assert.equal(man.light, 1);
    { const L = man.parts.body[0].lods[0], limb = new Float32Array(bin.buffer.slice(bin.byteOffset + L.limb.off, bin.byteOffset + L.limb.off + L.limb.len)); let lo = 1; for (let v = 0; v < L.verts; v++) lo = Math.min(lo, limb[v * 2 + 1]);
      assert.equal(lo, 1, `${sex}: no occlusion baked`); }
    // the skin under the clothes (crowd-pack rayCover, 2026-11-20): the near level's — under each garment in every pose —
    // left out only deep under it (its deep bits a part of its coverage, never all of it); the lighter levels' — under it
    // as it stands, more of the body — all left out (deep = coverage)
    { const f = (L, e, w) => new Float32Array(bin.buffer.slice(bin.byteOffset + L[e].off, bin.byteOffset + L[e].off + L[e].len));
      const L0 = man.parts.body[0].lods[0], L1 = man.parts.body[0].lods[1];
      assert.ok(L0.deep && L1.deep, `${sex}: the body's levels carry what lies deep under the clothes`);
      const c0 = f(L0, 'cov'), d0 = f(L0, 'deep'), c1 = f(L1, 'cov'), d1 = f(L1, 'deep');
      let cov0 = 0, deep0 = 0, notSub = 0;
      for (let v = 0; v < L0.verts; v++) { const c = Math.round(c0[v * 2]), d = Math.round(d0[v * 3]); if (c) cov0++; if (d) deep0++; if (d & ~c) notSub++; }
      assert.ok(deep0 > 0 && deep0 < cov0 && notSub === 0, `${sex}: near level: deep under the tops ${deep0} of ${cov0} covered, ${notSub} outside them`);
      let same = true, cov1 = 0; for (let v = 0; v < L1.verts; v++) { if (Math.round(c1[v * 2])) cov1++; if (Math.round(c1[v * 2]) !== Math.round(d1[v * 3])) same = false; }
      assert.ok(same && cov1 / L1.verts > cov0 / L0.verts, `${sex}: lighter level: all its covered skin left out, more of it (${Math.round(cov1 / L1.verts * 100)}% vs ${Math.round(cov0 / L0.verts * 100)}%)`); }
    { let shiny = 0; for (const p of man.parts.shoes) { const L = p.lods[0], col = new Uint8Array(bin.buffer.slice(bin.byteOffset + L.col.off, bin.byteOffset + L.col.off + L.col.len)); for (let v = 0; v < L.verts; v++) if ((col[v * 4 + 3] >> 2) < 42) { shiny++; break; } }
      assert.ok(shiny >= 2, `${sex}: shoes with a finish of their own (${shiny})`); }
    // the feet: the ankles where a body's are, the library at 85% (each resident 80–90% in the shader)
    assert.equal(man.feet.size, 0.85); for (const s of ['L', 'R']) assert.ok(man.feet[s][1] > 0.04 && man.feet[s][1] < 0.16 && Math.abs(man.feet[s][0]) < 0.3, `${sex} ankle ${s}`);
    // skin under the clothes: the body's and the neck's under collars; bottoms under long tops
    const covered = (p, l = 0) => { const L = p.lods[l], info = new Float32Array(bin.buffer.slice(bin.byteOffset + L.info.off, bin.byteOffset + L.info.off + L.info.len)); let n = 0; for (let v = 0; v < L.verts; v++) if (info[v * 3 + 1] === 9) n++; return n; };
    assert.ok(covered(man.parts.body[0]) > 2000, 'the body\'s skin under clothes');
    assert.ok(man.parts.head.some(p => covered(p) > 20), 'the neck under collars');
    assert.ok(man.parts.bottom.some(p => covered(p) > 50), 'bottoms under long tops');
    // a shoe pulls in only the skin inside it: none above its own top (2026-11-19: heeled shoes' raised feet read as covered
    // pinched the ankles and shins 23 cm up)
    { const f32 = e => new Float32Array(bin.buffer.slice(bin.byteOffset + e.off, bin.byteOffset + e.off + e.len)), B = man.parts.body[0].lods[0], pos = f32(B.pos), info = f32(B.info);
      man.parts.shoes.forEach((s, b) => {
        const S = s.lods[0], sp = f32(S.pos); let top = -1, high = -1;
        for (let v = 0; v < S.verts; v++) top = Math.max(top, sp[v * 3 + 1]);
        for (let v = 0; v < B.verts; v++) if (info[v * 3 + 1] === 9 && (info[v * 3 + 2] & (1 << b))) high = Math.max(high, pos[v * 3 + 1]);
        assert.ok(high <= top + 0.005, `${sex} ${s.name}: skin pulled in up to ${high.toFixed(3)} m, the shoe ${top.toFixed(3)} m high`);
      }); }
  }
});

test('a resident\'s parts: the same every time, within the library, a dress without bottoms, a beard sometimes', () => {
  const counts = { head: 10, hair: 15, beard: 6, top: 18, bottom: 14, shoes: 10 }, seen = Object.fromEntries(PARTS.map(k => [k, new Set()]));
  let beards = 0, dresses = 0;
  for (let i = 0; i < 3000; i++) {
    const app = { skin: '#c98c62', hair: '#2d211b', top: '#3b6ea5', bottom: '#1e272e', height: 1 + (i % 7) / 100 };
    const r = ctx.crowdRecipe(i, app, counts, [17]), again = ctx.crowdRecipe(i, { ...app }, counts, [17]);
    assert.deepEqual(r, again, 'the same resident, the same parts');
    for (const k of PARTS) { if (r[k] >= 0) { assert.ok(r[k] < counts[k]); seen[k].add(r[k]); } }
    if (r.beard >= 0) beards++;
    if (r.top === 17) { dresses++; assert.equal(r.bottom, -1, 'a dress: no bottoms'); } else assert.ok(r.bottom >= 0);
  }
  for (const k of PARTS) assert.equal(seen[k].size, counts[k], `every ${k} worn by someone`);
  assert.ok(beards > 900 && beards < 2100, `about half have a beard (${beards})`); assert.ok(dresses > 50);
  assert.notDeepEqual(ctx.crowdRecipe(1, { skin: '#c98c62' }, counts, []), ctx.crowdRecipe(2, { skin: '#c98c62' }, counts, []), 'two residents differ');
  assert.equal(get('isCrowdKind')('crowd_f'), true); assert.equal(get('isCrowdPart')('crowd_f|top|3'), true); assert.equal(get('isCrowdPart')('crowd_m'), false);
  assert.equal(get('isCrowdKind')('c_0123456789abcdef'), false); assert.equal(get('castsShadow')('crowd_m|shoes|2'), false); assert.equal(get('castsShadow')('crowd_m|top|2'), true);
  assert.equal(get('CROWD'), true, 'always on');
});

test('the crowd from parts is always on: no link turns it off; the prototype\'s kept choice is cleared', () => {
  const store = new Map([['mvw.crowd', 'off']]);   // (a browser that once had ?crowd=off in the prototype)
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const visit = search => vm.runInContext('CROWD', addKindHelpers(source, vm.createContext({ KINDS: ['male', 'female'], URLSearchParams, location: { search }, localStorage })));
  assert.equal(visit(''), true, 'on, whatever the prototype kept'); assert.equal(store.has('mvw.crowd'), false, 'the old choice cleared');
  assert.equal(visit('?crowd=off'), true, 'no off switch'); assert.equal(store.size, 0, 'nothing kept');
});

test('the trunk keeps its own posture: spine, neck and head turn as the reference\'s turn from its bind pose, the limbs aligned', () => {
  const R = loadRig(CHARS, 'm05'), J = R.J.map(j => j.slice()), head = R.idx.Head;
  J[head] = [J[head][0], J[head][1], J[head][2] + 0.03];   // (a neck leaning 3 cm further forward than the reference's)
  const plain = retarget(R, { N: R.N, J }, { count: 4 }), kept = retarget(R, { N: R.N, J }, { count: 4, delta: TRUNK });
  const rot = (fr, b) => { const o = b * 12; return [fr[o], fr[o + 1], fr[o + 2], fr[o + 4], fr[o + 5], fr[o + 6], fr[o + 8], fr[o + 9], fr[o + 10]]; };
  const ref = orthonormal(R.M(0, R.idx.Neck)), refRot = [ref[0], ref[1], ref[2], ref[4], ref[5], ref[6], ref[8], ref[9], ref[10]];
  const diff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));
  assert.ok(diff(rot(kept.frames, R.idx.Neck), refRot) < 1e-6, 'kept: the neck turned exactly as the reference\'s');
  assert.ok(diff(rot(plain.frames, R.idx.Neck), refRot) > 0.01, 'aligned: turned further, to the reference\'s direction');
  assert.ok(diff(rot(kept.frames, R.idx.LeftArm), rot(plain.frames, R.idx.LeftArm)) < 1e-9, 'the arms aligned either way');
});

test('served: its version published, its files compressed and kept a year at it', { timeout: 120000 }, async () => {
  const s = await startServer({ population: 20 });
  try {
    const v = await (await fetch(`${s.url}/assets/crowd/version.json`)).json();
    assert.match(v.v || '', /^[0-9a-f]{12}$/);
    const man = await fetch(`${s.url}/assets/crowd/female.json?v=${v.v}`);
    assert.equal(man.status, 200); assert.match(man.headers.get('cache-control') || '', /immutable/);
    const bin = await fetch(`${s.url}/assets/crowd/male.bin?v=${v.v}`, { method: 'HEAD' });
    assert.equal(bin.status, 200); assert.match(bin.headers.get('cache-control') || '', /immutable/);
  } finally { await s.stop(); }
});
