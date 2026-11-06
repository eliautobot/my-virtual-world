// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Things on pieces over the edit route (op item.on, PLAN-SURFACES.md 8): put, checked and refused for the right reasons,
// carried when the piece moves or turns, back with the piece on undo, re-fitted when its look changes, kept by a floor's
// own copy, moved between pieces in one step; what a shop sells (lvl.goods); a saved layout's things laid with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../shared/catalog.js';
import { aboDefault } from '../shared/abo-replace.js';
import { surfacesOf } from '../shared/surfaces.js';
import { startServer, ownerSession, httpClient, tempDir } from '../tools/lib/testserver.mjs';

const goods = Object.entries(CATALOG).filter(([, d]) => d.size === 'surface' && d.h >= 0.03);
const span = d => Math.max(d.rect[2] - d.rect[0], d.rect[3] - d.rect[1]);
const tiny = goods.sort((a, b) => span(a[1]) - span(b[1]))[0][0];
const tall = goods.find(([, d]) => d.h > 0.4 && d.rect[3] - d.rect[1] <= 0.3 && d.rect[2] - d.rect[0] <= 0.9)[0];

test('item.on over the edit route', async () => {
  const s = await startServer({ data: tempDir('mvw-surf-'), population: 120 });
  try {
    const owner = await ownerSession(s);
    const edit = ops => owner.post('/api/edit', { ops });
    let W = (await owner.get('/api/world')).json.world;
    const lvOf = (b, f) => W.levels[W.buildings[b].lv[f]];
    const fresh = async () => { W = (await owner.get('/api/world')).json.world; };
    // an office of several floors sharing one layout, a desk on it drawn as its Amazon counterpart
    const twin = b => b.lv.findIndex((x, k) => k !== 1 && x === b.lv[1]);   // (another floor sharing floor 1's layout)
    const B = W.buildings.find(b => b && !b.gone && b.type === 'office' && twin(b) > 1 && lvOf(b.idx, 1).items.filter(i => i.t === 'desk' && i.m && !i.mod).length >= 2);
    assert.ok(B, 'an office with shared floors');
    const f = 1, g = twin(B), lv0 = B.lv[f], desk = lvOf(B.idx, f).items.find(i => i.t === 'desk' && i.m && !i.mod);
    const S = surfacesOf(desk), top = S.findIndex(x => Math.abs(x.y - 0.755) < 0.015);
    assert.ok(top >= 0, 'the desk has its top');
    const T = S[top], cx = T.x1 - 0.06, cz = T.z0 + 0.06;   // (a back corner: clear of the monitor in the middle)
    const mug = { t: tiny, s: top, x: cx, z: cz, r: 0 };
    let r = await edit([{ op: 'item.on', b: B.idx, f, id: desk.id, on: [mug] }]);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.results[0].n, 1);
    await fresh();
    assert.notEqual(W.buildings[B.idx].lv[f], lv0, 'the floor got its own layout');
    assert.equal(W.buildings[B.idx].lv[g], lv0, 'the floor that shared it keeps the shared one');
    let got = lvOf(B.idx, f).items.find(i => i.id === desk.id);
    assert.deepEqual(got.on, [{ t: tiny, s: top, x: Math.round(cx * 1000) / 1000, z: Math.round(cz * 1000) / 1000, r: 0 }]);
    assert.equal(lvOf(B.idx, g).items.find(i => i.id === desk.id).on, undefined);
    // refused, and nothing changed
    const no = async (on, re, id = desk.id) => { const x = await edit([{ op: 'item.on', b: B.idx, f, id, on }]); assert.notEqual(x.status, 200, `refused: ${re}`); assert.match(x.text, re); };
    await no([{ ...mug, t: 'g:zzzzzz' }], /Unknown item type/);
    await no([{ ...mug, t: 'sofa' }], /stands on the floor/);
    await no([{ ...mug, s: 99 }], /No such surface/);
    await no([{ ...mug, x: T.x1 + 0.2 }], /does not fit/);
    await no([mug, { ...mug, x: cx - 0.01 }], /overlaps/);
    await no([{ ...mug, x: 0, z: -0.24 }], /in the way of the monitor/);
    await no(Array.from({ length: 97 }, () => mug), /At most 96/);
    await no([mug], /Nothing can be put/, lvOf(B.idx, f).items.find(i => !surfacesOf(i).length && !CATALOG[i.t].fixed && i.t !== 'door' && !i.mod).id);
    assert.match((await edit([{ op: 'item.on', b: B.idx, f, id: desk.id, on: [mug], scope: 'all' }])).text, /floor by floor/);
    assert.match((await edit([{ op: 'item.on', b: B.idx, f, id: desk.id, on: null, ds: -1 }])).text, /Bad reroll/);
    // a shelf's room above: a tall thing on a bookshelf's shelf no, on its top yes
    const bsL = W.levels.findIndex(L => L?.items?.some(i => i.t === 'bookshelf'));
    if (bsL >= 0) {
      const bi = W.buildings.findIndex(b => b && !b.gone && b.lv.includes(bsL)), bf = W.buildings[bi].lv.indexOf(bsL), bs = W.levels[bsL].items.find(i => i.t === 'bookshelf');
      const hi = surfacesOf(bs).findIndex(x => x.kind === 'high');
      const x = await edit([{ op: 'item.on', b: bi, f: bf, id: bs.id, on: [{ t: tall, s: 1, x: 0, z: 0, r: 0 }] }]);
      assert.match(x.text, /too tall/);
      assert.equal((await edit([{ op: 'item.on', b: bi, f: bf, id: bs.id, on: [{ t: tall, s: hi, x: 0, z: 0, r: 0 }] }])).status, 200);
    }
    await fresh();
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === desk.id).on.length, 1, 'still one');
    // moved and turned: carried (same record)
    let movedOk = false;
    for (const [dx, dz, dr] of [[0, 0, Math.PI], [0.05, 0, 0], [-0.05, 0, 0], [0, 0.05, 0], [0, -0.05, 0]]) {
      if ((await edit([{ op: 'item.move', b: B.idx, f, id: desk.id, x: desk.x + dx, z: desk.z + dz, r: desk.r + dr }])).status === 200) { movedOk = true; break; }
    }
    assert.ok(movedOk, 'the desk moved or turned');
    await fresh();
    got = lvOf(B.idx, f).items.find(i => i.id === desk.id);
    assert.equal(got.on?.length, 1, 'moved with its things');
    // removed, then undone: back with its things
    assert.equal((await edit([{ op: 'item.del', b: B.idx, f, id: desk.id }])).status, 200);
    await fresh();
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === desk.id), undefined);
    assert.equal((await owner.post('/api/undo')).status, 200);
    await fresh();
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === desk.id)?.on?.length, 1, 'back with its things');
    // its look switched to MVW's: the things re-fitted, how many dropped told
    r = await edit([{ op: 'item.look', b: B.idx, f, id: desk.id, m: null }]);
    assert.equal(r.status, 200, r.text);
    await fresh();
    got = lvOf(B.idx, f).items.find(i => i.id === desk.id);
    assert.equal((got.on?.length || 0) + (r.json.results[0].dropped || 0), 1);
    assert.equal((await owner.post('/api/undo')).status, 200);
    await fresh();
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === desk.id).m, aboDefault('desk'), 'undone: its Amazon look');
    // moved to another desk in one step; a bad second list changes neither
    const other = lvOf(B.idx, f).items.find(i => i.t === 'desk' && i.id !== desk.id && !i.mod);
    const bad = await edit([{ op: 'item.on', b: B.idx, f, id: desk.id, on: [], to: { id: other.id, on: [{ ...mug, s: 99 }] } }]);
    assert.notEqual(bad.status, 200);
    await fresh();
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === desk.id).on.length, 1, 'unchanged');
    r = await edit([{ op: 'item.on', b: B.idx, f, id: desk.id, on: [], to: { id: other.id, on: [{ ...mug, s: surfacesOf(other).findIndex(x => Math.abs(x.y - 0.755) < 0.015) }] } }]);
    assert.equal(r.status, 200, r.text);
    await fresh();
    assert.deepEqual(lvOf(B.idx, f).items.find(i => i.id === desk.id).on, [], 'emptied');
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === other.id).on.length, 1, 'on the other desk');
    assert.equal((await owner.post('/api/undo')).status, 200);
    await fresh();
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === desk.id).on.length, 1, 'undone: back');
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === other.id).on, undefined, 'undone: the other as it was');
    assert.equal((await owner.post('/api/redo')).status, 200);
    await fresh();
    assert.equal(lvOf(B.idx, f).items.find(i => i.id === other.id).on.length, 1, 'redone');
    // back to generated, with a reroll
    assert.equal((await edit([{ op: 'item.on', b: B.idx, f, id: other.id, on: null, ds: 3 }])).status, 200);
    await fresh();
    got = lvOf(B.idx, f).items.find(i => i.id === other.id);
    assert.equal(got.on, undefined); assert.equal(got.ds, 3);
    // a saved layout laid on another office floor keeps the things that fit
    const saved = await owner.post('/api/layouts/save', { b: B.idx, f, name: 'Desks with things' });
    assert.equal(saved.status, 200, saved.text);
    const C = W.buildings.find(b => b && !b.gone && b.type === 'office' && b.idx !== B.idx && b.w === B.w && b.d === B.d && b.floors >= 2);
    if (C) {
      r = await edit([{ op: 'lvl.apply', b: C.idx, f: 1, layout: saved.json.id, fit: 'keep' }]);
      assert.equal(r.status, 200, r.text);
      await fresh();
      const on = lvOf(C.idx, 1).items.filter(i => i.on?.length);
      assert.ok(on.length >= 1, 'laid with its things');
    }
    // what a shop sells
    const shop = W.buildings.find(b => b && !b.gone && b.type === 'shop');
    const sf = shop.lv.findIndex(x => W.levels[x]?.venue === 'shop');
    assert.equal((await edit([{ op: 'lvl.goods', b: shop.idx, f: sf, goods: 'shoes' }])).status, 200);
    await fresh();
    assert.equal(lvOf(shop.idx, sf).goods, 'shoes');
    assert.match((await edit([{ op: 'lvl.goods', b: shop.idx, f: sf, goods: 'rockets' }])).text, /Unknown kind of shop/);
    assert.match((await edit([{ op: 'lvl.goods', b: B.idx, f, goods: 'shoes' }])).text, /Only a shop floor/);
    assert.equal((await edit([{ op: 'lvl.regen', b: shop.idx, f: sf }])).status, 200);
    await fresh();
    assert.equal(lvOf(shop.idx, sf).goods, 'shoes', 'kept when laid out anew');
    assert.equal((await edit([{ op: 'lvl.goods', b: shop.idx, f: sf, goods: null }])).status, 200);
    await fresh();
    assert.equal(lvOf(shop.idx, sf).goods, undefined, 'back to its default');
  } finally { await s.stop(); }
});

test('things on pieces survive a restart', async () => {
  const dir = tempDir('mvw-surf2-');
  let s = await startServer({ data: dir, population: 80 });
  let id, b, f, top, pw;
  try {
    const owner = await ownerSession(s); pw = owner.password;
    const W = (await owner.get('/api/world')).json.world;
    const B = W.buildings.find(x => x && !x.gone && x.type === 'office' && W.levels[x.lv[1]]?.items.some(i => i.t === 'desk' && i.m && !i.mod));
    const desk = W.levels[B.lv[1]].items.find(i => i.t === 'desk' && i.m && !i.mod);
    top = surfacesOf(desk).findIndex(x => Math.abs(x.y - 0.755) < 0.015);
    const T = surfacesOf(desk)[top];
    id = desk.id; b = B.idx; f = 1;
    const r = await owner.post('/api/edit', { ops: [{ op: 'item.on', b, f, id, on: [{ t: tiny, s: top, x: T.x1 - 0.06, z: T.z0 + 0.06, r: 0 }] }] });
    assert.equal(r.status, 200, r.text);
  } finally { await s.stop(); }
  s = await startServer({ data: dir, population: 80 });
  try {
    const owner = httpClient(s.url); await owner.signIn('owner', pw);
    const W = (await owner.get('/api/world')).json.world;
    assert.equal(W.levels[W.buildings[b].lv[f]].items.find(i => i.id === id).on.length, 1, 'kept over a restart');
  } finally { await s.stop(); }
});
