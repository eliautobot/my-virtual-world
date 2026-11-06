// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Surfaces (shared/surfaces.js, PLAN-SURFACES.md 4.2, 6, 12): MVW's own hosts as read from their shapes, the Amazon
// library's as found from their models, MVW's pieces drawn as their Amazon counterpart as fitted; the checks on the things
// put on them; a look switched; lot holders may change the things on their pieces and their pieces' looks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../shared/catalog.js';
import { PICK, SPEC, aboDefault, aboFit } from '../shared/abo-replace.js';
import { ABO_SURF_ROWS } from '../shared/abo-surfaces.js';
import { surfacesOf, aboSurfaces, checkOn, cleanOn, refitOn, keepOn, hostClass, onType, ABO_HOST_KINDS, ON_MAX } from '../shared/surfaces.js';
import { storeKindOk, STORE_KIND_IDS } from '../shared/store-goods.js';
import { LotRights } from '../server/lot-rights.js';

const NATIVE_HOSTS = Object.keys(CATALOG).filter(t => !t.includes(':') && surfacesOf({ t }).length);
const goods = Object.entries(CATALOG).filter(([, d]) => d.size === 'surface');
const small = goods.find(([, d]) => Math.max(d.rect[2] - d.rect[0], d.rect[3] - d.rect[1]) <= 0.1 && d.h <= 0.15 && d.h >= 0.05)[0];
const tall = goods.find(([, d]) => d.h > 0.4 && d.rect[3] - d.rect[1] <= 0.3 && d.rect[2] - d.rect[0] <= 0.9)[0];
const tiny = goods.filter(([, d]) => d.h >= 0.03).sort((a, b) => Math.max(a[1].rect[2] - a[1].rect[0], a[1].rect[3] - a[1].rect[1]) - Math.max(b[1].rect[2] - b[1].rect[0], b[1].rect[3] - b[1].rect[1]))[0][0];
const top0 = t => surfacesOf({ t }).find(s => s.kind === 'top');

test('MVW\'s own hosts: inside their pieces, at the heights people use, keep-outs on their surfaces', () => {
  assert.ok(NATIVE_HOSTS.length >= 50, `native hosts ${NATIVE_HOSTS.length}`);
  for (const t of NATIVE_HOSTS) {
    const d = CATALOG[t], [x0, z0, x1, z1] = d.rect;
    assert.ok(hostClass({ t }), `${t} has a class`);
    for (const [i, s] of surfacesOf({ t }).entries()) {
      const at = `${t} s${i}`;
      assert.ok(s.x0 >= x0 - 1e-9 && s.x1 <= x1 + 1e-9 && s.z0 >= z0 - 1e-9 && s.z1 <= z1 + 1e-9, `${at} inside the piece`);
      assert.ok(s.x1 - s.x0 >= 0.1 && s.z1 - s.z0 >= 0.08, `${at} big enough`);
      assert.ok(s.y > 0 && s.y <= d.h + 0.06, `${at} at ${s.y} under the piece's top ${d.h}`);
      assert.ok(s.clear >= 0.2, `${at} room above`);
      assert.ok(['top', 'shelf', 'high', 'ledge'].includes(s.kind) && /^(f|b|fb)$/.test(s.side), `${at} kind and side`);
      for (const k of s.keep) assert.ok(k[2] > s.x0 && k[0] < s.x1 && k[3] > s.z0 && k[1] < s.z1, `${at} keep-out ${k[4]} on it`);
    }
  }
  // the heights people eat and work at (render/interiors.js TABLE_TOP, shared/abo-replace.js SPEC fit)
  const at = { desk: 0.755, desk_l: 0.755, desk_home: 0.755, desk_exec: 0.77, meeting_table: 0.76, dining_table: 0.76, cafe_table: 0.76, cafe_table4: 0.76, picnic_table: 0.76, coffee_table: 0.42, counter: 0.94, bar_counter: 1.1, standing_desk: 1.05, checkout: 0.9 };
  for (const [t, y] of Object.entries(at)) assert.ok(Math.abs(top0(t).y - y) <= 0.01, `${t} top at ${y} (${top0(t).y})`);
  for (const [t, S] of Object.entries(SPEC)) if (S.top && S.fit && top0(t)) assert.ok(Math.abs(top0(t).y - S.fit[4]) <= 0.011, `${t}: its top where its Amazon look's is fitted`);
  // two-sided: a shop shelf's goods both sides; a desk's monitor kept clear
  const sh = surfacesOf({ t: 'shop_shelf' });
  assert.equal(sh.length, 8); assert.equal(sh.filter(s => s.side === 'b').length, 4); assert.ok(sh.every(s => s.fill === 'goods'));
  assert.ok(top0('desk').keep.some(k => k[4] === 'monitor'));
  assert.equal(surfacesOf({ t: 'sofa' }).length, 0, 'a sofa is not a host');
  assert.equal(hostClass({ t: 'sofa' }), null);
});

test('Amazon hosts: found surfaces sane, scaled and lifted as drawn; MVW\'s pieces as their counterpart is fitted', () => {
  const rows = ABO_SURF_ROWS.split('\n').filter(Boolean);
  assert.ok(rows.length > 1000, `rows ${rows.length}`);
  let n = 0;
  for (const line of rows) {
    const id = line.split('|')[0], d = CATALOG[`a:${id}`];
    assert.ok(d && ABO_HOST_KINDS.has(d.kind), `${id} is a library host`);
    const k = d.scale || 1, H = (d.h - (d.lift || 0)) / k - (d.oy || 0) / k, [x0, z0, x1, z1] = d.rect.map(v => v / k);
    for (const s of aboSurfaces(id)) {
      n++;
      assert.ok(s.y >= 0 && s.y <= H + 0.02, `${id} y ${s.y} within its height ${H}`);
      assert.ok(s.clear >= 0.08, `${id} room above`);
      assert.ok(Math.max(s.x1 - s.x0, s.z1 - s.z0) >= 0.149 && Math.min(s.x1 - s.x0, s.z1 - s.z0) >= 0.099, `${id} big enough`);
      assert.ok(s.x0 >= x0 - 0.02 && s.x1 <= x1 + 0.02 && s.z0 >= z0 - 0.02 && s.z1 <= z1 + 0.02, `${id} inside its model`);
    }
    const t = `a:${id}`, S = surfacesOf({ t });
    assert.equal(S.length, aboSurfaces(id).length);
    assert.ok(Math.abs(S[0].y - (aboSurfaces(id)[0].y * k + (d.lift || 0) + (d.oy || 0))) < 1e-9, `${id} scaled and lifted`);
  }
  assert.ok(n > 2000, `surfaces ${n}`);
  // a hung wall shelf's surfaces at its height on the wall
  const hung = Object.keys(CATALOG).find(t => t.startsWith('a:') && CATALOG[t].kind === 'wall_shelf' && CATALOG[t].lift && surfacesOf({ t }).length);
  if (hung) assert.ok(surfacesOf({ t: hung })[0].y > CATALOG[hung].lift, 'lifted with the shelf');
  // MVW's pieces drawn as their Amazon counterpart: the counterpart's top where the piece's is
  for (const [t, S] of Object.entries(SPEC)) {
    if (!S.top || !PICK[t]?.[0]) continue;
    const m = aboDefault(t), got = surfacesOf({ t, m }), fit = aboFit(PICK[t][0], S.fit || [...CATALOG[t].rect, CATALOG[t].h], S);
    assert.ok(got.length && fit, `${t} as its counterpart has surfaces`);
    assert.ok(got.some(s => Math.abs(s.y - (S.fit || [0, 0, 0, 0, CATALOG[t].h])[4]) <= 0.015), `${t}: a top at its fitted height`);
  }
  const desk = surfacesOf({ t: 'desk', m: aboDefault('desk') }), dt = desk.find(s => Math.abs(s.y - 0.755) <= 0.01);
  assert.ok(dt && dt.keep.some(k => k[4] === 'monitor') && !dt.keep.some(k => k[4] === 'notebook'), 'MVW\'s monitor drawn on it is kept clear; its notebook is not drawn there');
  assert.ok(desk[0].x1 - desk[0].x0 > 1.0, 'the desk counterpart\'s top as wide as it is fitted');
});

test('the checks on the things put on a piece', () => {
  const desk = { t: 'desk' }, S = surfacesOf(desk)[0];
  const mug = (x, z, r = 0, s = 0, t = small) => ({ t, s, x, z, r });
  assert.ok(onType(small) && !onType('sofa') && onType(tall));
  assert.equal(checkOn(desk, [mug(0.55, -0.25)]), null, 'a small thing in the free corner');
  assert.equal(checkOn(desk, []), null);
  assert.match(checkOn(desk, [mug(0.55, -0.25, 0, 0, 'g:zzzzzz')]), /Unknown item type/);
  assert.match(checkOn(desk, [mug(0.55, -0.25, 0, 0, 'sofa')]), /stands on the floor/);
  assert.match(checkOn(desk, [mug(0.55, -0.25, 0, 3)]), /No such surface/);
  assert.match(checkOn(desk, [mug(S.x1, -0.25)]), /does not fit/);
  assert.match(checkOn(desk, [mug(0, -0.24)]), /in the way of the monitor/);
  assert.match(checkOn(desk, [mug(0.55, -0.25), mug(0.57, -0.24)]), /overlaps/);
  assert.equal(checkOn(desk, [mug(0.5, -0.25), mug(0.62, -0.25)]), null, 'side by side');
  assert.match(checkOn(desk, Array.from({ length: ON_MAX + 1 }, () => mug(0.55, -0.25))), /At most/);
  assert.match(checkOn({ t: 'sofa' }, [mug(0, 0)]), /Nothing can be put/);
  // a bookshelf's shelf has 37 cm above it: a tall thing goes only on its top
  const bs = surfacesOf({ t: 'bookshelf' }), hi = bs.findIndex(s => s.kind === 'high');
  assert.match(checkOn({ t: 'bookshelf' }, [{ t: tall, s: 1, x: 0, z: 0, r: 0 }]), /too tall/);
  assert.equal(checkOn({ t: 'bookshelf' }, [{ t: tall, s: hi, x: 0, z: 0, r: 0 }]), null);
  // turned: a long thing turned 90 degrees fits a narrow shelf only lengthways
  const long = goods.find(([, d]) => d.rect[2] - d.rect[0] > 0.3 && d.rect[2] - d.rect[0] < 0.5 && d.rect[3] - d.rect[1] < 0.15 && d.h < 0.3)?.[0];
  if (long) {
    const sw = { t: 'shoe_wall' }, z = 0.01;
    assert.equal(checkOn(sw, [{ t: long, s: 0, x: 0, z, r: 0 }]), null);
    assert.match(checkOn(sw, [{ t: long, s: 0, x: 0, z, r: Math.PI / 2 }]), /does not fit/);
  }
  // as stored: only t s x z r, rounded
  assert.deepEqual(cleanOn([{ t: small, s: 0, x: 0.12345, z: -0.1, r: 0, extra: 1 }]), [{ t: small, s: 0, x: 0.123, z: -0.1, r: 0 }]);
  assert.ok(cleanOn([{ t: small, s: 0.5, x: 0, z: 0 }]) instanceof Error);
  assert.ok(cleanOn('x') instanceof Error);
  // kept what still fits
  const kept = keepOn(desk, [mug(0.55, -0.25), mug(0, -0.24), mug(0.56, -0.25)]);
  assert.equal(kept.on.length, 1); assert.equal(kept.dropped, 2);
});

test('a look switched: the things on a piece put on its new surfaces', () => {
  const m = aboDefault('desk'), on = [{ t: small, s: 0, x: 0.55, z: -0.25, r: 0 }, { t: small, s: 0, x: -0.4, z: 0.25, r: 0.5 }];
  assert.equal(checkOn({ t: 'desk' }, on), null);
  const r = refitOn({ t: 'desk' }, { t: 'desk', m }, on);
  assert.equal(r.on.length + r.dropped, 2);
  assert.equal(checkOn({ t: 'desk', m }, r.on), null, 'what is kept fits the Amazon desk');
  assert.ok(r.on.length >= 1, 'the corner mug stays');
  const back = refitOn({ t: 'desk', m }, { t: 'desk' }, r.on);
  assert.equal(checkOn({ t: 'desk' }, back.on), null);
  // a nightstand's top: its surface the nearest in height
  assert.equal(checkOn({ t: 'nightstand' }, [{ t: tiny, s: 0, x: 0.16, z: 0.15, r: 0 }]), null);
  const ns = refitOn({ t: 'nightstand' }, { t: 'nightstand', m: aboDefault('nightstand') }, [{ t: tiny, s: 0, x: 0.16, z: 0.15, r: 0 }]);
  assert.equal(ns.on.length, 1);
  const top = surfacesOf({ t: 'nightstand', m: aboDefault('nightstand') })[ns.on[0].s];
  assert.ok(Math.abs(top.y - 0.55) < 0.03, 'on its top');
});

test('shop kinds; lot holders may change the things on their pieces and their pieces\' looks', () => {
  assert.ok(STORE_KIND_IDS.length >= 17 && storeKindOk('shoes') && storeKindOk('tackle') && !storeKindOk('toString') && !storeKindOk(''));
  const world = { buildings: [{ idx: 0, lot: 'L1', name: 'Shop' }] };
  const property = { count: () => 1, get: id => ({ id }), can: (who, lot, need) => who.subject?.id === 'alice' && need === 'furnish' };
  const R = new LotRights(property, () => world), alice = { admin: false, subject: { kind: 'account', id: 'alice' } }, bob = { admin: false, subject: { kind: 'account', id: 'bob' } };
  for (const op of ['item.on', 'item.look', 'lvl.goods', 'item.move']) {
    assert.equal(R.check({ op, b: 0 }, alice), null, `${op}: the holder`);
    assert.match(R.check({ op, b: 0 }, bob), /don't hold furnishing/, `${op}: someone else`);
  }
});

test('boot: things that no longer fit their pieces taken off, bad rerolls dropped', async () => {
  const { surfaceItems } = await import('../server/world/generate.js');
  const ok = { t: tiny, s: 0, x: 0.55, z: -0.25, r: 0 };
  const world = { levels: [{ items: [
    { t: 'desk', id: 1, x: 0, z: 0, r: 0, on: [ok, { ...ok, t: 'g:gone00' }, { ...ok, s: 7 }], ds: 2 },
    { t: 'desk', id: 2, x: 3, z: 0, r: 0, on: 'bad', ds: -4 },
    { t: 'sofa', id: 3, x: 6, z: 0, r: 0, on: [ok] },
    { t: 'desk', id: 4, x: 9, z: 0, r: 0, on: [] },
  ] }, null] };
  assert.equal(surfaceItems(world), 4);
  const [a, b, c, d] = world.levels[0].items;
  assert.deepEqual(a.on, [ok]); assert.equal(a.ds, 2);
  assert.equal(b.on, undefined); assert.equal(b.ds, undefined);
  assert.deepEqual(c.on, []); assert.deepEqual(d.on, [], 'emptied stays emptied');
  assert.equal(surfaceItems(world), 0, 'once mended, nothing more');
});
