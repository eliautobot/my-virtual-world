// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Signs (shared/signs.js, 2026-10-05): the Marketing tools' billboards and street signs (where they may stand,
// standard or large, centred or overhang, their own content), the metro stations' panels, owners' rooftop billboards
// (at most two, their own design, never ads), signs inside (resizable; private, or ads that earn their owner VC for
// views and store credit for other people's clicks, capped a day), the price of each ad space, the aircraft one by one,
// and the self-hosted edition (signs with their own content, no ads).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { normalizeRoofSigns, roofSignFrame, indoorSignFaces, signSize, signFace, signShape, parseSignGeoKey, SIGN_SIZE, findIndoorSign, indoorSlot, adAssetFaces, billboardType, AD_ASSETS, stylesOf, signStyle, signGeoKey, SIGN_STYLES, INDOOR_SIGN_TYPES, SIGN_ACCENT } from '../shared/signs.js';
import { normalizeDecor, checkDecor } from '../shared/decor.js';
import { makeGrid, blockRect, lotRect } from '../shared/city.js';
import { normalizePromoAircraftConfig, resolvePromoAircraftFleet } from '../shared/promo.js';
import { interiorBounds } from '../shared/edit.js';
import { normalizeAdCreative, picture, aspectOf } from '../shared/ads.js';
import { itemAABB } from '../shared/geom.js';
import { FLOOR_H } from '../shared/constants.js';
import { CATALOG } from '../shared/catalog.js';

const TERMS = '2026-10-05';

test('the shapes: billboards, street signs, rooftop billboards and signs inside', () => {
  assert.equal(billboardType('large', 'overhang'), 'billboard_xl_oh'); assert.equal(billboardType('standard', 'centre'), 'billboard');
  const f = adAssetFaces('billboard_xl');
  assert.equal(f.length, 2); assert.equal(f[0].w, 14.4); assert.equal(f[1].yaw, Math.PI, 'double-faced');
  assert.ok(AD_ASSETS.billboard_oh.base, 'an overhanging board stands on its pole\'s base');
  // rooftop: at most two, sized to the roof's edge; an administrator's hiding stays
  const signs = normalizeRoofSigns([{ edge: 'front', size: 'l', at: 3, cr: { title: 'Acme' } }, { edge: 'nope', size: 'x' }, { edge: 'back' }], { keep: [{ blocked: 'Rude' }] });
  assert.equal(signs.length, 2); assert.equal(signs[0].at, 1); assert.equal(signs[1].edge, 'front'); assert.equal(signs[1].size, 'm');
  assert.equal(signs[0].blocked, 'Rude');
  const B = { w: 30, d: 20, floors: 5 }, F = roofSignFrame(B, signs[0]);
  assert.ok(F.w <= 30 * 0.82 + 1e-9 && Math.abs(F.h - F.w / 3) < 1e-9 && F.yaw === 0 && F.lz > 9);
  assert.ok(Math.abs(F.lx) + F.w / 2 <= 15, 'it stays on the roof');
  // signs inside: the panel any width and height within its kind's sizes, held under the ceiling
  assert.deepEqual(signSize('sign_wall', 99, 0.1), { w: SIGN_SIZE.wall.w[1], h: SIGN_SIZE.wall.h[0] });
  assert.ok(SIGN_SIZE.stand.w[1] >= 8 && SIGN_SIZE.wall.w[1] >= 20 && SIGN_SIZE.stand.h[1] >= 2.9, 'big signs (2026-10-06)');
  assert.deepEqual(signSize('sign_stand', 99, 99, true), { w: SIGN_SIZE.stand.open.w[1], h: SIGN_SIZE.stand.open.h[1] }, 'in a park, under the sky, larger still');
  assert.equal(signSize('sign_stand', 1, 5).h, SIGN_SIZE.stand.h[1], 'under a ceiling, no taller than it allows');
  assert.deepEqual(signSize('sign_stand', 1.234, 'x'), { w: 1.23, h: 0.9 }, 'to the centimetre; a bad height is its own');
  const wf = indoorSignFaces({ t: 'sign_wall', fw: 2.4, fh: 0.5 });
  assert.equal(wf.length, 1); assert.equal(wf[0].w, 2.4); assert.equal(wf[0].h, 0.5); assert.equal(wf[0].y, 1.6, 'a wall sign grows round its centre');
  const tallWall = signFace({ t: 'sign_wall', fw: 1, fh: SIGN_SIZE.wall.h[1] });
  assert.ok(tallWall.y + tallWall.h / 2 <= FLOOR_H - 0.25 + 1e-9 && tallWall.y - tallWall.h / 2 >= 0.12 - 1e-9, 'a tall wall sign stays between floor and ceiling');
  const sf = indoorSignFaces({ t: 'sign_stand', fw: 2, fh: 0.5 });
  assert.equal(sf.length, 2); assert.ok(Math.abs(sf[0].y - sf[0].h / 2 - 0.6) < 1e-9, 'a standing sign\'s panel keeps its bottom on its post');
  const big = signFace({ t: 'sign_stand', fw: 1, fh: SIGN_SIZE.stand.h[1] });
  assert.ok(big.y + big.h / 2 <= FLOOR_H - 0.25 + 1e-9 && big.y - big.h / 2 >= 0.12 - 1e-9, 'a panel as tall as a room comes down towards the floor, its top under the ceiling');
  const park = signFace({ t: 'sign_stand', fw: 10, fh: 5 });
  assert.ok(Math.abs(park.y - park.h / 2 - 0.12) < 1e-9 && park.w === 10, 'a park\'s giant sign stands just above the ground');
  assert.deepEqual(signFace({ t: 'sign_stand', s: 1.5 }), { w: 0.9, h: 1.35, y: 1.275 }, 'signs scaled the old way keep their size');
  assert.equal(signShape({ t: 'sign_wall', fw: 2, fh: 0.5 }), 'x4.00'); assert.equal(aspectOf('x4.00'), 4); assert.equal(aspectOf('portrait'), 2 / 3); assert.equal(aspectOf('x0'), 1.5);
  // the geometry for a sign at its size, and the room it takes: as wide as its panel
  assert.deepEqual(parseSignGeoKey('sign_stand@halo#2.00x0.50'), { t: 'sign_stand', v: 'halo', family: 'stand', w: 2, h: 0.5, y: 0.85 });
  assert.equal(parseSignGeoKey('sign_stand@neon#1x1'), null, 'a wall style is no standing sign\'s');
  const bb = itemAABB({ t: 'sign_stand', x: 0, z: 0, r: 0, fw: 2 }, [-0.34, -0.24, 0.34, 0.24]);
  assert.ok(Math.abs(bb.x1 - 1.045) < 1e-9 && bb.z1 === 0.24, 'a wide panel widens the sign, not its base\'s depth');
  const W = { buildings: [{ id: 'b7', idx: 0, lv: [3] }], levels: { 3: { items: [{ id: 5, t: 'sign_stand' }, { id: 6, t: 'desk' }] } } };
  assert.equal(findIndoorSign(W, 'in:b7:3:5').it.id, 5);
  assert.equal(findIndoorSign(W, 'in:b7:3:6'), null, 'only signs');
  assert.equal(findIndoorSign(W, 'in:b7:4:5'), null, 'only its building\'s floors');
  assert.equal(indoorSlot({ id: 'b7' }, 3, { id: 5 }), 'in:b7:3:5');
  // designs: a tall picture only with a full picture; signs may use signs' pictures, paid ads only theirs
  assert.ok(normalizeAdCreative({ title: 'x', imageSrc: '/signs/s3-0123456789abcdef.png' }) instanceof Error);
  assert.equal(normalizeAdCreative({ title: 'x', imageSrc: '/signs/s3-0123456789abcdef.png' }, { images: 'any' }).imageSrc, '/signs/s3-0123456789abcdef.png');
  assert.equal(normalizeAdCreative({ format: 'logo', title: 'x', imageTallSrc: '/ads/a3-0123456789abcdef.png' }).imageTallSrc, '');
});

test('where the Marketing tools\' signs may stand: a street sign on the sidewalk but clear of the corners; an overhanging board over the sidewalk, not the street', () => {
  const g = makeGrid({ nx: 3, nz: 3, bw: 120, bd: 90, road: 20 }), r = blockRect(g, 1, 1), L = lotRect(g, 1, 1), env = { city: g, buildings: [], decorations: [] };
  const side = normalizeDecor({ t: 'street_sign', x: r.x0 + 2.2, z: (r.z0 + r.z1) / 2, r: Math.PI / 2 });
  assert.equal(checkDecor(side, env), null, 'on the sidewalk, mid-block');
  assert.match(checkDecor(normalizeDecor({ t: 'street_sign', x: r.x0 + 2.2, z: r.z0 + 2.5, r: 0 }), env), /corner/);
  assert.match(checkDecor(normalizeDecor({ t: 'street_sign', x: r.x0 - 3, z: (r.z0 + r.z1) / 2, r: 0 }), env), /street/);
  assert.match(checkDecor(normalizeDecor({ t: 'billboard', x: r.x0 + 2.2, z: (r.z0 + r.z1) / 2, r: Math.PI / 2 }), env), /sidewalk/, 'a billboard stands on a lot');
  // overhang: the pole on the lot, the board over the sidewalk — fine; over the street — no
  const mid = (L.z0 + L.z1) / 2;
  const over = normalizeDecor({ t: 'billboard_oh', x: L.x0 + 1.8, z: mid, r: Math.PI });   // the pole (+x end turned to −x… ) checked below either way
  const ok = [0, Math.PI].map(rr => checkDecor({ ...over, r: rr }, env));
  assert.ok(ok.some(x => x === null), `one way round it fits: ${ok}`);
  assert.match(checkDecor(normalizeDecor({ t: 'billboard_oh', x: r.x0 - 0.5, z: mid, r: 0 }), env), /street|sidewalk|road/);
  // its own content travels with it
  const d = normalizeDecor({ t: 'billboard', x: 0, z: 0, r: 0, hc: { title: 'City news', website: 'example.com' } });
  assert.equal(d.hc.website, 'https://example.com/');
  assert.ok(normalizeDecor({ t: 'billboard', x: 0, z: 0, r: 0, hc: { website: 'javascript:x' } }) instanceof Error);
});

test('the aircraft one by one: a list with ids and their own banners; older counts still load', () => {
  const old = normalizePromoAircraftConfig({ types: { bannerPlane: { count: 2 }, blimp: { count: 0 }, hotAirBalloon: { count: 1 } } });
  assert.deepEqual(old.fleet.map(e => e.id), ['bannerPlane-1', 'bannerPlane-2', 'hotAirBalloon-1']);
  const c = normalizePromoAircraftConfig({ fleet: [{ id: 'p1', type: 'blimp', g: { text: 'Hello', websiteUrl: 'example.com' } }, { id: 'p1', type: 'blimp' }, { type: 'bannerPlane' }, { type: 'ufo' }] });
  assert.deepEqual(c.fleet.map(e => e.type), ['blimp', 'blimp', 'bannerPlane']);
  assert.notEqual(c.fleet[0].id, c.fleet[1].id, 'ids are unique');
  assert.equal(c.types.blimp.count, 2); assert.equal(c.types.hotAirBalloon.count, 0);
  const F = resolvePromoAircraftFleet(c);
  assert.equal(F[0].settings.text, 'Hello'); assert.equal(F[0].settings.own, true); assert.equal(F[0].settings.websiteUrl, 'https://example.com/');
  assert.deepEqual(F.map(e => e.index), [0, 1, 0], 'each kind counted on its own (their circuits)');
  const many = normalizePromoAircraftConfig({ fleet: Array.from({ length: 10 }, () => ({ type: 'blimp' })) });
  assert.equal(many.fleet.length, 4, 'each kind\'s limit');
});

test('a sign\'s styles: standing and wall ones, the plain one first, the lit ones taking the sign\'s colour', () => {
  for (const t of INDOOR_SIGN_TYPES) {
    const L = stylesOf(t);
    assert.ok(L.length >= 4, `${t} comes in styles`); assert.ok(L.some(x => x.light), `${t} has a lit style`);
    assert.ok(CATALOG[t].tint, `${t} takes a colour (its light)`);
    assert.equal(signStyle(t, L[0].id), undefined, 'the plain style is no style');
    assert.equal(signStyle(t, L[1].id), L[1].id);
    assert.equal(signStyle(t, 'bogus'), undefined); assert.equal(signStyle(t, undefined), undefined);
  }
  assert.equal(signStyle('sign_stand', 'neon'), undefined, 'a wall style is not a standing one');
  assert.equal(signStyle('sign_wall', 'halo'), undefined);
  assert.deepEqual(SIGN_STYLES.stand.map(x => x.id), ['classic', 'modern', 'pylon', 'halo']);
  assert.equal(signGeoKey({ t: 'sign_stand', v: 'halo' }), 'sign_stand@halo#0.60x0.90');
  assert.equal(signGeoKey({ t: 'sign_stand', fw: 1.5, fh: 0.4 }), 'sign_stand@classic#1.50x0.40');
  assert.equal(signGeoKey({ t: 'desk', v: 'halo' }), 'desk', 'only signs have styles');
  assert.match(SIGN_ACCENT, /^#[0-9a-f]{6}$/);
});

test('a picture\'s placement: its crop, fit, zoom and move, checked; left as it comes when nothing is set', () => {
  assert.equal(picture(null), null); assert.equal(picture({}), null);
  assert.equal(picture({ fit: 'cover', zoom: 1, x: 0, y: 0, crop: [0, 0, 1, 1] }), null, 'the defaults are no placement');
  assert.deepEqual(picture({ crop: [0.8, 0.9, 0.1, 0.2], fit: 'contain', zoom: 9, x: -3, y: 0.25 }), { crop: [0.1, 0.2, 0.8, 0.9], fit: 'contain', zoom: 4, x: -1, y: 0.25 });
  assert.equal(picture({ crop: [0.5, 0.5, 0.51, 0.9] }), null, 'a crop too thin is no crop');
  assert.equal(picture({ fit: 'sideways' }), null);
  assert.deepEqual(picture({ zoom: 0.1, fit: 'stretch' }), { fit: 'stretch', zoom: 0.25 });
  const c = normalizeAdCreative({ format: 'image', imageSrc: '/ads/a3-0123456789abcdef.png', pic: { zoom: 1.5, x: 0.2 }, picTall: { fit: 'contain' } });
  assert.deepEqual(c.pic, { zoom: 1.5, x: 0.2 }); assert.equal(c.picTall, undefined, 'no tall picture, no tall placement');
  const d = normalizeAdCreative({ format: 'image', imageSrc: '/ads/a3-0123456789abcdef.png', imageTallSrc: '/ads/a3-0123456789abcdee.png', picTall: { crop: [0.25, 0, 0.75, 1] } });
  assert.deepEqual(d.picTall, { crop: [0.25, 0, 0.75, 1] }); assert.equal(d.pic, undefined);
});

async function signWorld(env = {}) {
  const dir = tempDir('mvw-signs-');
  const first = await startServer({ data: dir, population: 120, env });   // (a test licence unlocks editing)
  await first.stop();
  const r = spawnSync(process.execPath, ['tools/wp4/rebuild-city.mjs', '--data', dir, '--server-stopped', '--nx', '3', '--nz', '2'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const s = await startServer({ data: dir, population: 120, env });
  return { s, dir, close: async () => { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); for (const f of fs.readdirSync(path.dirname(dir))) if (f.startsWith(path.basename(dir) + '.')) fs.rmSync(path.join(path.dirname(dir), f), { recursive: true, force: true }); } };
}
/** A free spot for a sign on floor 0 of building B (as the server checks it). */
async function placeSign(c, B, t, extra = {}) {
  const ib = interiorBounds(B);
  let last = null;
  for (let x = ib.x0 + 1.5; x < ib.x1 - 1.5; x += 1.3) for (let z = ib.z0 + 1.5; z < ib.z1 - 1.5; z += 1.3) {
    const r = await c.post('/api/edit', { ops: [{ op: 'item.add', b: B.idx, f: 0, t, x, z, r: 0, ...extra }] });
    if (r.status === 200 && r.json.ok !== false) return r.json.results[0];
    last = r.text;
  }
  throw new Error(`no room for a sign: ${last}`);
}

test('billboards and signs show their own content; signs inside never take ads', async () => {
  const Wd = await signWorld();
  try {
    const owner = await ownerSession(Wd.s);
    const W = (await owner.get('/api/world')).json.world;
    const B = W.buildings.find(b => b && !b.gone && b.type !== 'park' && b.floors <= 4);
    const placed = await placeSign(owner, B, 'sign_wall_tall', { fw: 1.1, fh: 1.5 });
    const e = await owner.post('/api/edit', { ops: [{ op: 'item.sign', b: B.idx, f: 0, id: placed.id, sg: { mode: 'ads', cr: { title: 'Lobby' } } }] });
    assert.equal(e.status, 200, e.text);
    const W2 = (await owner.get('/api/world')).json.world, it = W2.levels[W2.buildings[B.idx].lv[0]].items.find(x => x.id === placed.id);
    assert.equal(it.sg.mode, 'private', 'no paid ads without the shop'); assert.equal(it.fw, 1.1); assert.equal(it.fh, 1.5);
    assert.equal(it.c, SIGN_ACCENT, 'a sign starts in the accent colour'); assert.equal(it.v, undefined, 'and the plain style');
    // its style and light colour, its size (as the corner handles set it), and undo
    const set = async o => owner.post('/api/edit', { ops: [{ op: 'item.sign', b: B.idx, f: 0, id: placed.id, ...o }] });
    const get = async () => { const w = (await owner.get('/api/world')).json.world; return w.levels[w.buildings[B.idx].lv[0]].items.find(x => x.id === placed.id); };
    let r = await set({ v: 'neon', c: '#F472B6', fw: 2.35, fh: 0.6 });
    assert.equal(r.status, 200, r.text);
    let it2 = await get();
    assert.equal(it2.v, 'neon'); assert.equal(it2.c, '#f472b6'); assert.equal(it2.fw, 2.35); assert.equal(it2.fh, 0.6);
    r = await set({ v: 'halo' });
    assert.equal(r.status, 200, r.text); assert.equal((await get()).v, undefined, 'a standing style on a wall sign falls back to the plain one');
    r = await set({ c: 'pink' });
    assert.notEqual(r.status, 200, 'a colour must be a colour'); assert.match(r.text, /colour/);
    assert.equal((await get()).c, '#f472b6');
    assert.equal((await owner.post('/api/undo')).status, 200);
    it2 = await get();
    assert.equal(it2.v, 'neon', 'undo brings the style back'); assert.equal(it2.fw, 2.35);
    assert.equal((await owner.post('/api/undo')).status, 200);
    it2 = await get();
    assert.equal(it2.v, undefined); assert.equal(it2.c, SIGN_ACCENT); assert.equal(it2.fw, 1.1); assert.equal(it2.fh, 1.5);
    // its own size again: nothing stored; too big for the room: refused, as it was
    r = await set({ fw: 0.8, fh: 1.2 });
    assert.equal(r.status, 200, r.text); it2 = await get(); assert.equal(it2.fw, undefined); assert.equal(it2.fh, undefined);
    r = await set({ fw: 40, fh: 2.6 });
    const after = await get();
    if (r.status === 200) assert.ok(after.fw <= SIGN_SIZE.wall.w[1] && after.fh <= SIGN_SIZE.wall.h[1], 'held to the largest a wall sign may be');
    else assert.equal(after.fw, undefined, 'a size that does not fit leaves the sign as it was');
    const styled = await placeSign(owner, B, 'sign_stand', { v: 'pylon', c: '#34d399' });
    const w3 = (await owner.get('/api/world')).json.world, st = w3.levels[w3.buildings[B.idx].lv[0]].items.find(x => x.id === styled.id);
    assert.equal(st.v, 'pylon'); assert.equal(st.c, '#34d399');
    // big: as tall as the room allows inside; in a park, under the sky, a giant
    const tall = await placeSign(owner, B, 'sign_stand', { fw: 0.6, fh: 9 });
    const w4 = (await owner.get('/api/world')).json.world, ti = w4.levels[w4.buildings[B.idx].lv[0]].items.find(x => x.id === tall.id);
    assert.equal(ti.fh, SIGN_SIZE.stand.h[1], 'inside: held under the ceiling');
    const P = w4.buildings.find(b => b && !b.gone && b.type === 'park');
    assert.ok(P, 'the city has a park');
    const big = await placeSign(owner, P, 'sign_stand', { fw: 5, fh: 9 });
    const w5 = (await owner.get('/api/world')).json.world, bi = w5.levels[w5.buildings[P.idx].lv[0]].items.find(x => x.id === big.id);
    assert.equal(bi.fw, 5); assert.equal(bi.fh, SIGN_SIZE.stand.open.h[1], 'in a park: much taller');
    assert.equal((await fetch(Wd.s.url + '/api/commerce/status')).status, 404, 'there is no shop');
  } finally { await Wd.close(); }
});
