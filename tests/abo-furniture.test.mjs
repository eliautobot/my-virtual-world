// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Amazon furniture (shared/abo-*.js): its library in the catalog after MVW's own pieces (their ids unchanged), named
// neutrally; MVW's pieces with a counterpart fitted to their own boxes; through the edit path an Amazon piece placed and
// kept, a model choice checked, a piece's look switched; a generated world furnished with the counterparts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, TYPE_LIST, USE_LIST, CATEGORIES } from '../shared/catalog.js';
import { EDIT_TYPES } from '../shared/edit.js';
import { ABO_LIB, ABO_SUBS, aboId } from '../shared/abo-items.js';
import { ABO_KINDS } from '../shared/abo-kinds.js';
import { PICK, SPEC, aboParts, aboDefault, aboChoiceOk } from '../shared/abo-replace.js';
import { startServer, ownerSession, tempDir } from '../tools/lib/testserver.mjs';

test('the library joins the catalog after MVW pieces, which keep their order and ids', () => {
  assert.ok(ABO_LIB.length > 0, 'shared/abo-catalog.js lists models');
  const first = TYPE_LIST.findIndex(t => t.startsWith('a:')), lib = TYPE_LIST.filter(t => CATALOG[t].abo).length;
  assert.ok(first > 0 && TYPE_LIST.slice(first, first + lib).every(t => CATALOG[t].abo), 'every Amazon type after every MVW one');
  assert.ok(TYPE_LIST.slice(first + lib).every(t => CATALOG[t].goods), 'then only the goods (tests/goods-catalog.test.mjs)');
  assert.equal(TYPE_LIST[0], 'desk');
  assert.equal(TYPE_LIST[first - 1], 'reception', 'the last MVW type stays last of MVW\'s');
  assert.equal(USE_LIST[0], 'work'); assert.equal(USE_LIST.at(-1), 'gogo', 'no use added or moved');
  assert.ok(!EDIT_TYPES.some(t => t.startsWith('a:')), 'the Furnish panel lists the library apart');
  for (const x of ABO_LIB) {
    const d = CATALOG[x.t];
    assert.ok(d && d.abo === x.id && aboId(x.t) === x.id, x.t);
    assert.ok(CATEGORIES.includes(d.cat) && ABO_SUBS[d.cat].includes(d.sub), `${x.t} in a known category and sub-group`);
    const [x0, z0, x1, z1] = d.rect;
    assert.ok(x1 > x0 && z1 > z0 && d.h > 0, `${x.t} has a size`);
    assert.doesNotMatch(d.name, /amazon|stone & beam|rivet|ravenna|movian|solimo|alkove|homepop/i, `${x.t} named without a brand`);
    for (const s of d.slots) assert.ok(Number.isFinite(s.x) && Number.isFinite(s.z) && s.anim && s.use, `${x.t} slot`);
  }
  const sofa = ABO_LIB.find(x => x.k === 'sofa'), bed = ABO_LIB.find(x => x.k === 'bed'), art = ABO_LIB.find(x => x.k === 'wall_art'), rug = ABO_LIB.find(x => x.k === 'rug');
  assert.ok(CATALOG[sofa.t].slots.length >= 1 && CATALOG[sofa.t].slots.every(s => s.anim === 'sit_relax'), 'a sofa is sat on');
  assert.ok(CATALOG[bed.t].slots.some(s => s.use === 'sleep'), 'a bed is slept in');
  assert.ok(CATALOG[art.t].wall && CATALOG[art.t].lift > 0 && CATALOG[art.t].block === false, 'a picture hangs on a wall');
  assert.equal(CATALOG[rug.t].block, false, 'a rug is walked over');
  assert.ok(Object.keys(ABO_KINDS).every(k => CATEGORIES.includes(ABO_KINDS[k].cat)));
});

test('MVW pieces with a counterpart: fitted into their own box, a chair at each place sat at', () => {
  assert.ok(Object.keys(PICK).length >= 40);
  for (const [t, [main, chair]] of Object.entries(PICK)) {
    assert.ok(CATALOG[t] && SPEC[t], t);
    if (main) assert.ok(CATALOG['a:' + main], `${t}: its model is in the library`);
    if (chair) assert.ok(CATALOG['a:' + chair], `${t}: its chair is in the library`);
    const m = aboDefault(t);
    assert.ok(aboChoiceOk(t, m) && !aboChoiceOk(t, 'a:B000NOTREAL') && !aboChoiceOk('arcade', m), `${t}: its own choice only`);
    const L = aboParts(t, m), seats = CATALOG[t].slots.filter(s => /^sit_/.test(s.anim)).length;
    assert.ok(L.parts.length >= 1, t);
    if (SPEC[t].seats) assert.equal(L.parts.filter(p => p.seat).length, seats, `${t}: a chair at each seat`);
  }
  // a table's top at the height people eat at (render/food-table.js 0.762)
  const p = aboParts('dining_table', aboDefault('dining_table')).parts[0], d = CATALOG['a:' + p.id];
  assert.ok(Math.abs(p.s[1] * (d.h - (d.lift || 0)) - 0.76) < 0.005, 'the dining table\'s top at 0.76 m');
  assert.equal(aboDefault('arcade'), null, 'an arcade machine has no counterpart');
  assert.equal(aboDefault('bookshelf'), null, 'a bookshelf stays MVW\'s (its books)');
});

test('edit path: an Amazon piece placed and kept; a model choice checked; a piece\'s look switched; generated floors furnished', async () => {
  const s = await startServer({ data: tempDir('mvw-abo-'), population: 120 });
  try {
    const owner = await ownerSession(s);
    const edit = ops => owner.post('/api/edit', { ops });
    let W = (await owner.get('/api/world')).json.world;
    let all = 0, withM = 0;
    for (const L of W.levels) for (const it of L?.items || []) if (aboDefault(it.t)) { all++; if (it.m === aboDefault(it.t)) withM++; }
    assert.ok(all > 50 && withM === all, `generated floors carry their Amazon looks (${withM}/${all})`);
    // a free spot on an office floor
    const B = W.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 2), f = 1;
    const arm = ABO_LIB.find(x => x.k === 'armchair').t;
    let placed = null;
    for (let k = 0; k < 80 && !placed; k++) {
      const x = Math.round((Math.random() - 0.5) * (B.w - 3) * 10) / 10, z = Math.round((Math.random() - 0.5) * (B.d - 3) * 10) / 10;
      const r = await edit([{ op: 'item.add', b: B.idx, f, t: arm, x, z, r: 0 }]);
      if (r.status === 200) placed = r.json.results[0];
    }
    assert.ok(placed, 'an Amazon armchair placed');
    W = (await owner.get('/api/world')).json.world;
    const lvOf = () => W.levels[W.buildings[B.idx].lv[f]];   // (a floor sharing its layout gets its own when changed)
    const L = lvOf(), got = L.items.find(i => i.id === placed.id);
    assert.equal(got?.t, arm, 'kept');
    // a model choice must be the piece's own
    const bad = await edit([{ op: 'item.add', b: B.idx, f, t: 'desk', x: 0, z: 0, r: 0, m: 'a:B000NOTREAL' }]);
    assert.notEqual(bad.status, 200);
    assert.match(bad.text, /Unknown model/);
    // a generated desk switched to MVW's look and back
    const desk = L.items.find(i => i.t === 'desk' && i.m && !i.mod);
    if (desk) {
      assert.equal((await edit([{ op: 'item.look', b: B.idx, f, id: desk.id, m: null }])).status, 200);
      W = (await owner.get('/api/world')).json.world;
      assert.equal(lvOf().items.find(i => i.id === desk.id).m, undefined, 'MVW\'s own look');
      assert.equal((await edit([{ op: 'item.look', b: B.idx, f, id: desk.id, m: aboDefault('desk') }])).status, 200);
      assert.notEqual((await edit([{ op: 'item.look', b: B.idx, f, id: desk.id, m: aboDefault('sofa') }])).status, 200, 'not another piece\'s model');
      W = (await owner.get('/api/world')).json.world;
      assert.equal(lvOf().items.find(i => i.id === desk.id).m, aboDefault('desk'), 'its Amazon look again');
    }
  } finally { await s.stop(); }
});
