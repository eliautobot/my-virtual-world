// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The goods (shared/goods-*.js, made by tools/goods-build.mjs): appended to the catalog after MVW's pieces and the Amazon
// furniture library, whose types, order and ids are unchanged; neutral ids pinned in tools/goods-ids.json; neutral names;
// every goods item with its sub-group, size class and tags; every placeable piece with a size class, tags and a
// sub-group; the Amazon library's misfiled pieces corrected without moving them; not offered in the Furnish panel, and
// refused on the floor by the edit path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CATALOG, TYPE_LIST, CATEGORIES } from '../shared/catalog.js';
import { EDIT_TYPES } from '../shared/edit.js';
import { GOODS_LIB, GOODS_ITEMS, ABO_DRESS, goodsFiles } from '../shared/goods-items.js';
import { GOODS_ROWS, GOODS_ABO_FIX } from '../shared/goods-catalog.js';
import { GOODS_TAGS, GOODS_SUBS, SIZES, NATIVE_SUB } from '../shared/goods-tags.js';
import { ABO_LIB } from '../shared/abo-items.js';
import { PICK, aboParts } from '../shared/abo-replace.js';
import { startServer, ownerSession, tempDir } from '../tools/lib/testserver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
// MVW's pieces and the Amazon furniture library as they were before the goods (7,842 types, in this order)
const PREFIX_SHA1 = 'e3141517c4c670719b830b25eb3674e0a5f098d2', PREFIX_N = 7842;

test('the goods are appended: earlier types, their order and ids unchanged', () => {
  const first = TYPE_LIST.findIndex(t => CATALOG[t].goods);
  assert.equal(first, PREFIX_N, 'the goods start after the 7,842 earlier types');
  assert.equal(crypto.createHash('sha1').update(TYPE_LIST.slice(0, first).join('\n')).digest('hex'), PREFIX_SHA1, 'earlier types and order unchanged');
  assert.ok(TYPE_LIST.slice(first).every(t => CATALOG[t].goods), 'nothing but goods after them');
  assert.equal(TYPE_LIST.length, first + GOODS_LIB.length);
  // the goods' own order is the pinned map's
  const pinned = readJson('tools/goods-ids.json').ids.map(l => l.split(' '));
  const short = new Map(pinned.map(([src, sid, s]) => [`${src} ${sid}`, src === 'g' ? s : sid]));
  assert.equal(short.size, pinned.length, 'each source once');
  const gIds = pinned.filter(p => p[0] === 'g').map(p => p[2]);
  assert.equal(new Set(gIds).size, gIds.length, 'short ids unique');
  assert.ok(gIds.every(s => /^[0-9a-z]{6}$/.test(s)), 'short ids: 6 base-36 characters');
  const order = pinned.map(([src, sid, s]) => (src === 'g' ? 'g:' + s : 'a:' + sid));
  const listed = GOODS_LIB.map(x => x.t);
  assert.deepEqual(listed, order.filter(t => GOODS_ITEMS[t]), 'catalog order = pinned order');
  const dropped = Object.values(readJson('tools/goods-overrides.json')).flatMap(o => typeof o === 'object' ? Object.values(o).filter(v => v?.drop) : []).length;
  assert.equal(order.length - listed.length, dropped, 'only the overrides\' drops are missing');
  assert.equal(new Set(listed).size, listed.length);
});

test('every goods item: neutral name and id, sub-group, size class, tags, size', () => {
  assert.ok(GOODS_LIB.length >= 1100, `${GOODS_LIB.length} goods`);
  assert.equal(GOODS_LIB.filter(x => x.src === 'g').length, 1033, 'all 1,033 scans');
  const BRANDS = /adidas|reebok|asics|sperry|top-?sider|timberland|ugg\b|tieks|crocs|brooks|lego|nintendo|hasbro|mattel|crayola|pepsi|nestl|nescaf|perricone|jarrow|twinlab|epson|canon|brother|\bdell\b|\bhp\b|seagate|razer|asus|gigabyte|netgear|logitech|philips|phillips|remington|sonicare|kotex|clorox|rubbermaid|\boxo\b|wilton|threshold|ecoforms|schleich|plantoys|fisher|vtech|melissa|playmates|marvel|disney|pok.mon|mario|frozen|star wars|transformers|avengers|spider|thomas|amazon|basics|ravenna|rivet|stone & beam|eono|movian|google|android|olive kids|paul frank|office depot|calphalon|corningware|black ?& ?decker|nescafe|swiss miss|little debbie|orbit|wrigley|jansport|\bkong\b|munchkin|\btena\b|poise|\bgaia\b|\bbrisk\b|fresca|van's|\bcrunch\b|\bnips\b|raisinets|butterfinger|skinny cow/i;
  for (const x of GOODS_LIB) {
    const d = CATALOG[x.t];
    assert.ok(d, x.t);
    assert.match(x.t, x.src === 'g' ? /^g:[0-9a-z]{6}$/ : /^a:B[0-9A-Z]{9}$/, `${x.t} id`);
    assert.match(d.name, /^[A-Z][A-Za-z-]*( [A-Za-z-]+)*( \d+)?$/, `${x.t} name "${d.name}": words and a number only`);
    assert.doesNotMatch(d.name, BRANDS, `${x.t} "${d.name}" without a brand`);
    assert.equal(d.cat, 'Goods');
    assert.ok(GOODS_SUBS.includes(d.sub), `${x.t} sub-group`);
    assert.equal(d.size, 'surface');
    assert.ok(d.tags.length >= 1 && d.tags.length <= 3 && d.tags.every(t => GOODS_TAGS.includes(t)), `${x.t} tags`);
    assert.equal(d.block, false, `${x.t} never blocks the way`);
    const [x0, z0, x1, z1] = d.rect;
    assert.ok(x1 > x0 && z1 > z0 && d.h > 0 && Math.max(x1 - x0, z1 - z0, d.h) <= 1.0, `${x.t} size`);
    assert.ok(Math.abs((x0 + x1) / 2) < 0.01 && Math.abs((z0 + z1) / 2) < 0.01, `${x.t} centred`);
    const f = goodsFiles(x.t);
    assert.match(f.m, new RegExp(`^/assets/(gso|abo)/m/${x.id}\\.glb$`));
  }
  const names = GOODS_LIB.map(x => x.name);
  assert.equal(new Set(names).size, names.length, 'names unique');
  for (const s of GOODS_SUBS) assert.ok(GOODS_LIB.some(x => x.sub === s), `sub-group ${s} has goods`);
  const shoes = GOODS_LIB.filter(x => x.tags[0] === 'shoe');
  assert.ok(shoes.length >= 250 && shoes.every(x => CATALOG[x.t].front && CATALOG[x.t].floorOk), 'shoes: a front (toe at +z), may stand on the floor');
  const fr = GOODS_LIB.filter(x => CATALOG[x.t].franchise);
  assert.ok(fr.length >= 40 && fr.length < 150, `franchise art flagged (${fr.length})`);
  // rows: 11 fields, tags and sub-group indexes in range
  for (const line of GOODS_ROWS.split('\n').filter(Boolean)) {
    const p = line.split('|');
    assert.equal(p.length, 11, line);
    assert.ok(p[2].split(',').every(i => GOODS_TAGS[+i]) && GOODS_SUBS[+p[3]], line);
    assert.match(p[10], /^[fryx]*$/, line);
  }
});

test('every placeable piece has a size class, tags and a sub-group', () => {
  const natives = TYPE_LIST.slice(0, TYPE_LIST.findIndex(t => CATALOG[t].abo));
  const listed = Object.entries(NATIVE_SUB).flatMap(([cat, subs]) => Object.values(subs).flatMap(ts => ts.split(' ').map(t => [t, cat])));
  assert.equal(new Set(listed.map(([t]) => t)).size, listed.length, 'each MVW type listed once');
  assert.deepEqual(listed.map(([t]) => t).sort(), [...natives].sort(), 'every MVW type has a sub-group');
  for (const [t, cat] of listed) assert.equal(CATALOG[t].cat, cat, `${t} under its own category`);
  for (const t of TYPE_LIST) {
    const d = CATALOG[t];
    assert.ok(SIZES.includes(d.size), `${t} size`);
    assert.ok(Array.isArray(d.tags) && d.tags.every(x => GOODS_TAGS.includes(x)), `${t} tags`);
    assert.ok(typeof d.sub === 'string' && d.sub, `${t} sub-group`);
  }
  assert.equal(CATALOG.rug.size, 'flat'); assert.equal(CATALOG.whiteboard.size, 'wall'); assert.equal(CATALOG.edison_pendants.size, 'hang');
  assert.equal(CATALOG.desk.size, 'floor'); assert.deepEqual(CATALOG.plant.tags, ['plant']);
  // small Amazon decor may also stand on a surface, and has its light copy
  const ok = TYPE_LIST.filter(t => CATALOG[t].onOk);
  assert.ok(ok.length > 400, `${ok.length} small pieces onOk`);
  for (const t of ok) {
    const d = CATALOG[t], [x0, z0, x1, z1] = d.rect;
    assert.ok(d.abo && ABO_DRESS.has(d.abo), `${t} has a dressing copy`);
    assert.ok(Math.max(x1 - x0, z1 - z0) <= 0.6 && d.h <= 0.8 && d.h >= 0.03 && d.tags.length, `${t} small, tagged`);
  }
});

test('the Amazon library\'s misfiled pieces are corrected in place', () => {
  const fixes = GOODS_ABO_FIX.split('\n').filter(Boolean).map(l => l.split('|')[0]);
  assert.ok(fixes.length >= 50);
  const used = new Set(Object.values(PICK).flat().filter(Boolean));
  for (const id of fixes) {
    assert.ok(CATALOG['a:' + id], `${id} still a type`);
    assert.ok(!used.has(id), `${id} is no MVW piece's counterpart`);
  }
  const lamp = CATALOG['a:B071F73XDB'];   // (a ceiling pendant once filed as a floor lamp, drawn under the floor)
  assert.equal(lamp.kind, 'pendant'); assert.equal(lamp.size, 'hang'); assert.ok(lamp.lift > 2.5);
  const sofa = CATALOG['a:B07HZ48ZXS'], [x0, , x1] = sofa.rect;   // (made in centimetres: 221 m wide)
  assert.ok(x1 - x0 > 1.5 && x1 - x0 < 3 && sofa.scale === 0.01);
  assert.deepEqual(aboParts('a:B07HZ48ZXS', 'a:B07HZ48ZXS').parts[0].s, [0.01, 0.01, 0.01], 'its model drawn at the corrected size');
  const tv = CATALOG['a:B07DYJS1V5'];   // (made around its middle: raised onto the floor)
  assert.ok(tv.oy > 0.2 && aboParts('a:B07DYJS1V5', 'a:B07DYJS1V5').parts[0].p[1] > 0.2);
  assert.equal(CATALOG['a:B07DB92GM8'].kind, 'sofa', 'a 2.3 m pillow sofa is sat on, not walked through');
  assert.ok(CATALOG['a:B07B8MTV4L'].hide && !ABO_LIB.some(x => x.id === 'B07B8MTV4L'), 'a hidden piece stays a type, not offered');
  assert.ok(ABO_LIB.some(x => x.id === 'B071F73XDB' && x.cat === 'Decor' && x.sub === 'Ceiling lights'), 'offered under its right kind');
});

test('listed apart from MVW\'s pieces (the Furnish panel\'s Goods part); the edit path refuses on the floor the goods that go on surfaces only', async () => {
  assert.ok(!EDIT_TYPES.some(t => CATALOG[t].goods), 'not listed with MVW\'s pieces');
  assert.ok(!CATEGORIES.includes('Goods'), 'not a category of MVW\'s pieces (ui/editors.js adds the Goods part)');
  const s = await startServer({ data: tempDir('mvw-goods-'), population: 20, agents: 0 });
  try {
    const owner = await ownerSession(s);
    const W = (await owner.get('/api/world')).json.world;
    const B = W.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 2);
    for (const t of [GOODS_LIB.find(x => x.src === 'g' && !CATALOG[x.t].floorOk).t, GOODS_LIB.find(x => x.src === 'a' && !CATALOG[x.t].floorOk).t]) {
      const r = await owner.post('/api/edit', { ops: [{ op: 'item.add', b: B.idx, f: 1, t, x: 0, z: 0, r: 0 }] });
      assert.notEqual(r.status, 200, t);
      assert.match(r.text, /goes on a table or a shelf/);
    }
  } finally { await s.stop(); }
});

test('the goods\' files are there (when the assets have been built)', { skip: !fs.existsSync(path.join(ROOT, 'client/assets/gso/m')) && 'assets not built' }, () => {
  const missing = [];
  for (const x of GOODS_LIB) {
    const f = goodsFiles(x.t);
    for (const k of ['m', 'd', 't']) if (!fs.existsSync(path.join(ROOT, 'client', f[k]))) missing.push(f[k]);
  }
  for (const id of ABO_DRESS) if (!fs.existsSync(path.join(ROOT, 'client/assets/abo/d', id + '.glb'))) missing.push(id);
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} missing`);
});
