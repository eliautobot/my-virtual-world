// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The dressing (shared/dress.js, shared/dress-rules.js; PLAN-SURFACES.md 4.4, 5, 9, 12): the same seed gives the same
// things and a reroll others; every thing passes the server's check and keeps where people sit clear; every floor of a
// generated city keeps to the budgets; every kind of piece a city has is dressed by a rule (or by none on purpose); what
// every shop sells by default; MVW's shelves drawn full make way; franchise art only in the shops that sell it; a piece
// holds things that belong on it (one mug, one boxed pack, small things on a desk, no model twice) and neighbours differ.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../server/world/generate.js';
import { dressContext, dressPools, dressHost, dressFloor, dressBudget, floorSeed, storeDefault, storeKind, seatZones, family, DRESS_Q } from '../shared/dress.js';
import { ruleFor, STORE_GOODS } from '../shared/dress-rules.js';
import { checkOn, surfacesOf, hostClass, onCorners, quadsOverlap } from '../shared/surfaces.js';
import { STORE_KINDS } from '../shared/store-goods.js';
import { SHOP_NAMES } from '../shared/names.js';
import { CATALOG } from '../shared/catalog.js';

const W = generateWorld({ seed: 'dress-test', population: 300 });
const floors = [];
for (const B of W.buildings) if (B && !B.gone) (B.lv || []).forEach((lv, f) => { const L = W.levels[lv]; if (L) floors.push({ B, f, L }); });
const find = test => floors.find(x => test(x));
const rectQ = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

test('the same seed gives the same things, a reroll others; a floor laid out again others, its reset the first', () => {
  const at = find(({ B, f, L }) => dressContext(B, f, L) === 'office' && L.items.filter(i => i.t === 'desk').length > 4);
  assert.ok(at, 'an office floor');
  const { B, f, L } = at, desk = L.items.find(i => i.t === 'desk'), ctx = 'office', fs = floorSeed(B, f, L), P = dressPools(ctx, fs);
  const a = dressHost(desk, ctx, P, fs), b = dressHost(structuredClone(desk), ctx, dressPools(ctx, fs), fs);
  assert.ok(a.list.length >= 2, `a desk holds things (${a.list.length})`);
  assert.deepEqual(a, b);
  const c = dressHost({ ...desk, ds: 1 }, ctx, P, fs);
  assert.notDeepEqual(a.list, c.list);
  const fs2 = floorSeed(B, f, { ...L, roll: 12345 });
  assert.notDeepEqual(a.list, dressHost(desk, ctx, dressPools(ctx, fs2), fs2).list);
  assert.equal(dressHost({ ...desk, on: [] }, ctx, P, fs), null, 'a piece with its own list is not dressed');
  // things on a desk: at its back and sides, the seat's work area clear, MVW's monitor and keyboard clear (checkOn)
  const S = surfacesOf(desk)[0], Z = seatZones(desk, S);
  assert.ok(Z.length >= 1, 'the desk has a seat');
  for (const e of a.list) for (const z of Z) assert.ok(!quadsOverlap(onCorners(e), rectQ(z), 0), `${CATALOG[e.t].name} clear of the seat`);
});

test('every thing passes the server check and keeps seats clear; budgets per quality on every floor', () => {
  for (const q of ['high', 'low']) {
    let n = 0;
    for (const { B, f, L } of floors) {
      const D = dressFloor(B, f, L, q);
      if (!D.ctx) continue;
      assert.ok(D.models.size <= DRESS_Q[q].models, `${D.ctx} ${q}: ${D.models.size} models`);
      const order = [];
      for (const it of L.items) {
        const h = D.hosts.get(it.id); if (!h) continue;
        order.push(h); n += h.list.length;
        assert.equal(checkOn(it, h.list), null, `${it.t} on a ${D.ctx} floor`);
        const surfs = surfacesOf(it);
        for (const e of h.list) {
          const rule = ruleFor(D.ctx, hostClass(it), surfs[e.s].kind);
          assert.ok(rule, `${it.t}: a rule for its surface`);
          if (rule.seat) for (const z of seatZones(it, surfs[e.s])) assert.ok(!quadsOverlap(onCorners(e), rectQ(z), 0), `${it.t}: seat clear`);
          if (CATALOG[e.t].franchise) assert.ok(rule.franchise, `${D.ctx}: no franchise art (${CATALOG[e.t].name})`);
        }
      }
      const take = dressBudget(order, q);
      let inst = 0, tris = 0; const models = new Set();
      take.forEach(i => { inst += order[i].list.length; tris += order[i].tris; for (const e of order[i].list) models.add(e.t); });
      assert.ok(inst <= DRESS_Q[q].inst && tris <= DRESS_Q[q].tris && models.size <= DRESS_Q[q].models, `${D.ctx} ${q}: within the budget`);
    }
    assert.ok(n > 1000, `${q}: a city dressed (${n} things)`);
  }
});

test('every kind of piece a city has is dressed by a rule, or by none on purpose', () => {
  const missing = new Set(), ctxs = new Set();
  for (const { B, f, L } of floors) {
    const ctx = dressContext(B, f, L); if (!ctx) continue;
    ctxs.add(ctx);
    for (const it of L.items) {
      const S = surfacesOf(it); if (!S.length) continue;
      if (!S.some(s => ruleFor(ctx, hostClass(it), s.kind))) missing.add(`${ctx}|${hostClass(it)}`);
    }
  }
  const none = [...missing].filter(k => !/^(arcade|club|shop:tackle)\|/.test(k));
  assert.deepEqual(none, []);
  for (const c of ['office', 'home', 'cafe', 'restaurant', 'park']) assert.ok(ctxs.has(c), c);
  assert.ok([...ctxs].filter(c => c.startsWith('shop:')).length >= 5, 'shops selling several kinds');
});

test('what a shop sells: its name, its tackle or clothes, else a pick by its seed; its owner\'s choice first', () => {
  const want = { 'Thread & Needle': 'clothing', 'Market Fresh': 'grocery', 'Paper Trail': 'stationery', 'The Corner Store': 'convenience', 'Nook Books': 'books',
    'Urban Goods': 'general', 'Green Grocer': 'grocery', 'Style Loft': 'clothing', 'Pixel Shop': 'games', 'Home & Hearth': 'homeware', 'Bloom Florist': 'florist',
    'Gadget Garage': 'electronics', 'The Record Room': 'music', 'Fig & Olive Market': 'grocery', 'Sole Mates': 'shoes', 'Wanderlust Outfitters': 'outdoor',
    'Crate & Co': 'homeware', 'Northside Market': 'grocery', 'Maple Mart': 'convenience', 'Studio Supply': 'stationery' };
  assert.equal(SHOP_NAMES.length, Object.keys(want).length);
  for (const n of SHOP_NAMES) assert.equal(storeDefault({ name: n, seed: 1 }), want[n], n);
  assert.equal(storeDefault({ name: 'Bait & Tackle', tackle: true }), 'tackle');
  assert.equal(storeDefault({ name: 'Store 21', clothes: true }), 'clothing');
  assert.equal(storeDefault({ name: 'Apartments', shopName: 'Sole Mates' }), 'shoes', 'a mixed building: its shop\'s name');
  const picks = new Set(); for (let s = 1; s <= 40; s++) { const k = storeDefault({ name: 'Store 21', seed: s }); assert.ok(STORE_KINDS[k], k); assert.equal(storeDefault({ name: 'Store 21', seed: s }), k); picks.add(k); }
  assert.ok(picks.size >= 5, 'generic shops sell various things');
  assert.equal(storeKind({ name: 'Sole Mates' }, { goods: 'toys' }), 'toys');
  assert.equal(storeKind({ name: 'Sole Mates' }, { goods: 'nonsense' }), 'shoes');
  for (const k of Object.keys(STORE_KINDS)) assert.ok(k in STORE_GOODS, `${k} has goods rules`);
  assert.equal(dressContext({ type: 'shop', name: 'Sole Mates' }, 0, { venue: 'shop' }), 'shop:shoes');
  assert.equal(dressContext({ type: 'shop', name: 'Sole Mates' }, 0, { venue: 'shop', goods: 'grocery' }), 'shop:grocery');
  assert.equal(dressContext({ type: 'office' }, 2, { items: [] }), 'office');
  assert.equal(dressContext({ type: 'apartment' }, 2, { items: [] }), 'home');
  assert.equal(dressContext({ type: 'office' }, 2, { venue: 'arcade' }), 'arcade');
});

test('shelves drawn full by MVW make way: a store shelf bare, a bookshelf at one end; an Amazon look has no fill', () => {
  const shelf = { t: 'shop_shelf', id: 7 }, B = { seed: 5, name: 'Sole Mates' }, L = { venue: 'shop' }, ctx = dressContext(B, 0, L), fs = floorSeed(B, 0, L);
  const r = dressHost(shelf, ctx, dressPools(ctx, fs), fs);
  assert.equal(r.cuts.length, 8, 'its 8 shelves');
  assert.ok(r.list.length >= 30 && r.list.length <= 96, `shoes on it (${r.list.length})`);
  assert.ok(r.list.every(e => CATALOG[e.t].tags[0] === 'shoe'));
  for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) assert.ok(r.list.some(e => e.s === s), `shelf ${s} holds shoes`);
  const book = { t: 'bookshelf', id: 3 }, hb = { type: 'apartment', seed: 9 }, hl = { items: [] }, fs2 = floorSeed(hb, 2, hl);
  const h = dressHost(book, 'home', dressPools('home', fs2), fs2), S = surfacesOf(book);
  assert.ok(h && h.cuts.length >= 4, 'its shelves of books cut at one end');
  for (const c of h.cuts) assert.ok(c[4] - c[2] < 0.75, 'not the whole shelf');
  for (const e of h.list) { const c = h.cuts.find(c => Math.abs(c[0] - S[e.s].y) < 1e-6); if (S[e.s].fill) assert.ok(c && e.x > c[2] && e.x < c[4], 'things only in the cut'); }
  const desk = { t: 'desk', id: 4, m: 'B01DJH73X2' };
  const d = dressHost(desk, 'office', dressPools('office', fs2), fs2);
  assert.ok(!d || !d.cuts.length);
  // pools: a lower quality takes the first of the same picks
  const hi = dressPools('shop:grocery', fs), lo = dressPools('shop:grocery', fs, 'low');
  for (const [t, list] of Object.entries(lo)) assert.deepEqual(list, hi[t].slice(0, list.length));
  assert.ok(Object.values(lo).flat().length <= DRESS_Q.low.models);
});

test('a piece holds things that belong on it: one mug and one pack on a desk, small things, no model twice; neighbours differ', () => {
  const side = t => { const r = CATALOG[t].rect; return Math.max(r[2] - r[0], r[3] - r[1]); };
  let desks = 0, pairs = 0, same = 0;
  for (const q of ['high', 'medium']) for (const { B, f, L } of floors) {
    const D = dressFloor(B, f, L, q);
    if (!D.ctx) continue;
    let prev = null;
    for (const it of L.items) {
      const h = D.hosts.get(it.id); if (!h) continue;
      const surfs = surfacesOf(it), cls = hostClass(it), byRule = new Map();
      for (const e of h.list) {
        const rule = ruleFor(D.ctx, cls, surfs[e.s].kind), d = CATALOG[e.t];
        if (rule.avoid) assert.ok(!rule.avoid.test(d.name), `${D.ctx} ${cls}: ${d.name} does not belong there`);
        if (rule.layout === 'row') continue;
        assert.ok(side(e.t) <= (rule.tagW?.[d.tags[0]] ?? rule.maxW ?? 0.35) + 1e-9, `${D.ctx} ${cls}: ${d.name} too big (${side(e.t).toFixed(2)} m)`);
        const n = byRule.get(rule) || byRule.set(rule, { t: new Map(), f: new Map() }).get(rule);
        n.t.set(e.t, (n.t.get(e.t) || 0) + 1); n.f.set(family(e.t), (n.f.get(family(e.t)) || 0) + 1);
      }
      for (const [rule, n] of byRule) {
        if (!rule.repeat) for (const [t, k] of n.t) assert.equal(k, 1, `${D.ctx} ${cls}: ${CATALOG[t].name} twice`);
        for (const fam of ['drink', 'pack']) assert.ok((n.f.get(fam) || 0) <= (rule.caps?.[fam] ?? 1), `${D.ctx} ${cls}: ${n.f.get(fam)} of ${fam}`);
        if (rule.caps) for (const [fam, c] of Object.entries(rule.caps)) assert.ok((n.f.get(fam) || 0) <= c, `${D.ctx} ${cls}: ${fam} over ${c}`);
      }
      if (D.ctx === 'office' && cls === 'desk' && q === 'high') {
        desks++;
        const sig = h.list.map(e => e.t).sort().join();
        if (prev !== null) { pairs++; if (sig === prev) same++; }
        prev = sig;
      }
    }
  }
  assert.ok(desks > 50, `office desks dressed (${desks})`);
  assert.ok(same / pairs < 0.1, `neighbouring desks differ (${same} of ${pairs} alike)`);
  // an office's pools: small desk things first, the desk's tags given most of the floor's models
  const at = find(x => dressContext(x.B, x.f, x.L) === 'office'), P = dressPools('office', floorSeed(at.B, at.f, at.L));
  const deskModels = ['desk-item', 'cable', 'office-supply', 'electronics', 'mug', 'plant'].reduce((a, t) => a + (P[t]?.length || 0), 0);
  assert.ok(deskModels >= 7, `a desk has ${deskModels} models to pick from`);
  for (const t of P['office-supply'] || []) assert.ok(side(t) <= 0.24, `${CATALOG[t].name}: small enough for a desk`);
});
