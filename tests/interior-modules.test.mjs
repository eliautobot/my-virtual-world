// Interior modules as data (shared/interior-modules.js, shared/edit.js): a rename or a turn keeps a module's own size
// (no snap: a generated kitchen's 5.75 x 4.0); a kind's check hook refuses; Save layout, a saved layout applied and a
// building resized keep the module's record (and move its rect with its walls).
import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERIOR_KINDS, normalizeModule, checkModule, layModule } from '../shared/interior-kinds.js';
import { registerInteriorKind } from '../shared/interior-modules.js';
import { layoutToSave, fitSaved, followLayout, interiorBounds } from '../shared/edit.js';

const B = { idx: 0, type: 'office', radio: true, w: 30, d: 20, floors: 1, lv: [0], x: 0, z: 0, rot: 0, door: { x: 0, w: 2 } };
const fresh = () => ({ items: [], walls: [], zones: [] });

test('a rename or a turn keeps its size; a new rect snaps', () => {
  const K = Object.values(INTERIOR_KINDS).find(k => k.size.sizes?.length) || INTERIOR_KINDS.studio;
  const prev = { id: 'm1', kind: K.kind, name: 'Kitchen', x0: -3, z0: -2, x1: 2.75, z1: 2, face: 0, data: {} };
  const named = normalizeModule({ name: 'The Kitchen' }, prev), turned = normalizeModule({ face: 1 }, prev);
  for (const r of [named, turned]) assert.deepEqual([r.x0, r.z0, r.x1, r.z1], [prev.x0, prev.z0, prev.x1, prev.z1], 'its own 5.75 x 4.0 kept');
  assert.equal(named.name, 'The Kitchen'); assert.equal(turned.face, 1);
  if (K.size.sizes?.length) { const moved = normalizeModule({ x0: 0, z0: 0, x1: 5.75, z1: 4 }, prev); assert.ok(K.size.sizes.some(s => [s.w, s.d].join() === [moved.x1 - moved.x0, moved.z1 - moved.z0].map(v => Math.round(v * 100) / 100).join() || [s.d, s.w].join() === [moved.x1 - moved.x0, moved.z1 - moved.z0].map(v => Math.round(v * 100) / 100).join()), 'a new rect snaps to a size'); }
});
test('a kind\'s check hook refuses a record', () => {
  registerInteriorKind({ kind: 'test_booth', label: 'Test Booth', price: 0, size: { min: [2, 2], max: [6, 6], step: 0.25 }, allowed: () => null, check: (B2, f, L, rec) => (rec.face === 2 ? 'Its front faces a wall' : null), fill: () => ({ items: [] }) });
  const r = normalizeModule({ kind: 'test_booth', x0: -1, z0: -1, x1: 1, z1: 1, face: 2 });
  assert.equal(checkModule(B, 0, fresh(), r), 'Its front faces a wall');
  assert.equal(checkModule(B, 0, fresh(), { ...r, face: 0 }), null);
});
test('Save layout, a saved layout applied and a building resized keep the module', () => {
  const ib = interiorBounds(B), rec = { ...normalizeModule({ kind: 'studio', x0: ib.x0, z0: ib.z0, x1: ib.x0 + 7, z1: ib.z0 + 6, face: 0 }), id: 'm1' };   // (against the left and back walls)
  const L = layModule(B, 0, fresh(), rec).L;
  assert.ok(L.mods?.length === 1 && L.items.some(i => i.mod === 'm1'));
  const saved = layoutToSave(L);
  assert.equal(saved.mods?.[0]?.id, 'm1', 'Save layout keeps the record');
  const fit = fitSaved(B, 0, { w: B.w, d: B.d, layout: saved }, fresh());
  assert.equal(fit.layout.mods?.[0]?.id, 'm1', 'a saved layout applied keeps it');
  const grown = followLayout(B, { x: 0, z: 0, w: 34, d: 20, rot: 0 }, L);
  assert.ok(grown.mods?.[0] && grown.mods[0].x0 < rec.x0, `a building resized moves its rect with its walls (${rec.x0} → ${grown.mods[0].x0})`);
});
test('a studio\'s wall pieces hang flush on the wall\'s face (2026-10-28: the clock was in the middle of the wall)', async () => {
  const { CATALOG } = await import('../shared/catalog.js');
  const { itemAABB } = await import('../shared/geom.js');
  const ib = interiorBounds(B);
  // its right side (+x, face 0: the door on +z) along the building's own wall, then away from it (its own wall there)
  for (const [x1, wallFace] of [[ib.x1, ib.x1], [ib.x1 - 3, ib.x1 - 3 - 0.06]]) {
    const rec = { ...normalizeModule({ kind: 'studio', x0: x1 - 7, z0: ib.z0 + 1, x1, z1: ib.z0 + 6, face: 0 }), id: 'm9' };
    const got = layModule(B, 0, fresh(), rec); assert.ok(got.L, got.why);
    const clock = got.L.items.find(i => i.t === 'studio_clock'), bb = itemAABB(clock, CATALOG.studio_clock.rect);
    assert.ok(Math.abs(bb.x1 - wallFace) < 0.012, `the clock's back on the wall's face: ${bb.x1.toFixed(3)} vs ${wallFace.toFixed(3)}`);
    const sign = got.L.items.find(i => i.t === 'on_air_sign'), sb = itemAABB(sign, CATALOG.on_air_sign.rect);
    assert.ok(Math.abs(sb.z1 - (rec.z1 - 0.06)) < 0.012, `the ON AIR sign on the door wall's inside face: ${sb.z1.toFixed(3)} vs ${(rec.z1 - 0.06).toFixed(3)}`);
  }
});
test('every studio size and turn: no piece in a wall, none in another, its desk always (2026-10-28: a guest chair through the wall)', async () => {
  const { CATALOG } = await import('../shared/catalog.js');
  const { itemAABB } = await import('../shared/geom.js');
  const Bb = { idx: 0, type: 'office', radio: true, w: 30, d: 24, floors: 1, lv: [0], x: 0, z: 0, rot: 0, door: { x: 0, w: 2 } }, ib = interiorBounds(Bb);
  let laid = 0, tables = 0;
  for (const [ox, oz] of [[null, null], [ib.x0, null], [null, ib.z0]]) for (let W = 3.5; W <= 12; W += 0.5) for (let D = 3.5; D <= 9; D += 0.5) for (const face of [0, 1, 2, 3]) {
    const x0 = ox ?? -W / 2, z0 = oz ?? -D / 2, rec = { ...normalizeModule({ kind: 'studio', x0, z0, x1: x0 + W, z1: z0 + D, face }), id: 'm1' };
    const got = layModule(Bb, 0, fresh(), rec); if (!got.L) continue; laid++;
    const near = (a, b) => Math.abs(a - b) < 0.06, sd = o => (o ? 0 : 0.06);
    const inner = { x0: rec.x0 + sd(near(rec.x0, ib.x0)), x1: rec.x1 - sd(near(rec.x1, ib.x1)), z0: rec.z0 + sd(near(rec.z0, ib.z0)), z1: rec.z1 - sd(near(rec.z1, ib.z1)) };
    const its = got.L.items.filter(i => i.mod === 'm1'), bb = its.map(i => ({ t: i.t, solid: CATALOG[i.t].block !== false, b: itemAABB(i, CATALOG[i.t].rect) }));
    for (const o of bb) assert.ok(o.b.x0 >= inner.x0 - 0.005 && o.b.x1 <= inner.x1 + 0.005 && o.b.z0 >= inner.z0 - 0.005 && o.b.z1 <= inner.z1 + 0.005, `${o.t} in a wall (${W} x ${D}, face ${face})`);
    for (let a = 0; a < bb.length; a++) for (let c = a + 1; c < bb.length; c++) { const p = bb[a], q = bb[c]; if (!p.solid || !q.solid) continue; assert.ok(!(p.b.x0 < q.b.x1 - 0.03 && p.b.x1 > q.b.x0 + 0.03 && p.b.z0 < q.b.z1 - 0.03 && p.b.z1 > q.b.z0 + 0.03), `${p.t} in ${q.t} (${W} x ${D}, face ${face})`); }
    assert.ok(its.some(i => i.t === 'broadcast_desk'), `its desk (${W} x ${D}, face ${face})`);
    if (its.some(i => i.t === 'guest_table')) tables++;
  }
  assert.ok(laid > 2000 && tables > 1000, `${laid} laid, ${tables} with a guest table`);
});
