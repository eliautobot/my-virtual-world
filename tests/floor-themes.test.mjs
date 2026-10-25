// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Floor Themes and floor names (shared/floor-themes.js; server/world/layouts.js themeFloor; server/world/edit.js lvl.theme,
// lvl.name): every theme lays out on every kind of building at every size it is offered on (inside the walls, nothing
// overlapping, the way in kept clear, the arcade's cabinets within their cap, the lounge's bar, stage, seats and walls, the club's DJ, dance floor, bar and VIP); over HTTP a floor becomes an arcade, a
// re-roll keeps the theme and the floor's own name, a resize lays it out again as the theme, undo brings the floor back,
// floors with flats and players without the rights are refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, ownerSession, userSession, tempDir } from '../tools/lib/testserver.mjs';
import { freshLevel } from '../server/world/generate.js';
import { FLOOR_THEMES, themeWhy } from '../shared/floor-themes.js';
import { CATALOG } from '../shared/catalog.js';
import { itemAABB, toWorld } from '../shared/geom.js';
import { WALL_T } from '../shared/constants.js';

const overlap = (a, b) => a.x0 < b.x1 - 0.02 && a.x1 > b.x0 + 0.02 && a.z0 < b.z1 - 0.02 && a.z1 > b.z0 + 0.02;

test('every theme lays out on every kind of building and size: inside, apart, the way in clear', { timeout: 240000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-themes-'), population: 60 });
  try {
    const owner = await ownerSession(s);
    const W = (await owner.get('/api/world')).json.world;
    const picks = [];
    for (const type of ['office', 'hq', 'cafe', 'shop', 'restaurant', 'gym', 'apartment']) {
      const list = W.buildings.filter(b => b && !b.gone && b.type === type).sort((a, b) => a.w * a.d - b.w * b.d);
      if (list.length) picks.push(...new Set([list[0], list[Math.floor(list.length / 2)], list[list.length - 1]]));
    }
    assert.ok(picks.length >= 10, `buildings of each kind (${picks.length})`);
    let n = 0;
    for (const t of FLOOR_THEMES) for (const B of picks) for (const f of [...new Set([0, Math.min(1, B.floors - 1)])]) {
      if (themeWhy(B, f, null)) { assert.ok(B.type === 'apartment' && f > 0, 'only floors with flats are left out'); continue; }
      const L = freshLevel(B, f, 777 + n, t.id), at = `${t.id} on ${B.type} ${B.w}×${B.d} floor ${f}`;
      n++;
      assert.equal(L.theme, t.id, at); assert.equal(L.auto, 1, at); assert.ok(L.name, at);
      assert.equal(L.venue || null, t.venue, `${at}: venue`);
      assert.ok(L.items.length >= 6, `${at}: furnished (${L.items.length})`);
      const ix0 = -B.w / 2 + WALL_T, ix1 = B.w / 2 - WALL_T, iz0 = -B.d / 2 + WALL_T, iz1 = B.d / 2 - WALL_T;
      const solid = [];
      for (const it of L.items) {
        const def = CATALOG[it.t]; assert.ok(def, `${at}: ${it.t}`);
        const bb = itemAABB(it, def.rect);
        assert.ok(bb.x0 >= ix0 - 0.01 && bb.x1 <= ix1 + 0.01 && bb.z0 >= iz0 - 0.01 && bb.z1 <= iz1 + 0.01, `${at}: ${it.t} inside the walls`);
        if (def.block === false || def.fixed || it.t === 'door') continue;
        for (const o of solid) assert.ok(!overlap(bb, o.bb), `${at}: ${it.t} at ${it.x},${it.z} overlaps ${o.t} at ${o.x},${o.z}`);
        solid.push({ bb, t: it.t, x: it.x, z: it.z });
      }
      if (f === 0 && B.door) {   // the way in: a door-wide path 2 m into the room
        const way = { x0: B.door.x - B.door.w / 2, x1: B.door.x + B.door.w / 2, z0: iz1 - 2, z1: iz1 };
        for (const o of solid) assert.ok(!overlap(way, o.bb), `${at}: ${o.t} blocks the way in`);
      }
      if (t.id === 'arcade') {
        const cabs = L.items.filter(it => it.t === 'arcade').length;
        assert.ok(cabs >= 12 && cabs <= 150, `${at}: ${cabs} cabinets`);
        assert.ok(L.zones.some(z => z[4] === 'carpet_arcade'), `${at}: the neon carpet`);
        assert.ok(L.items.some(it => it.t === 'reception'), `${at}: the prize counter`);
        // its own pieces: the more room, the more kinds (billiards, the bull, bowling, booths, neon…)
        const kinds = new Set(L.items.filter(it => CATALOG[it.t]?.cat === 'Arcade' && it.t !== 'arcade').map(it => it.t)).size, area = B.w * B.d;
        assert.ok(kinds >= (area >= 400 ? 16 : area >= 200 ? 10 : 6), `${at}: ${kinds} kinds of arcade pieces`);
        let cover = 0; for (const it of L.items) { const d = CATALOG[it.t]; if (d.block !== false && !d.fixed && it.t !== 'door') cover += (d.rect[2] - d.rect[0]) * (d.rect[3] - d.rect[1]); }
        assert.ok(cover / area >= (f === 0 ? 0.12 : 0.15) && cover / area <= 0.45, `${at}: ${Math.round(cover / area * 100)}% of the floor covered (not empty, not crowded; a street floor keeps its way in)`);
      }
      if (t.id === 'lounge') {
        const has = k => L.items.some(it => it.t === k), area = B.w * B.d;
        assert.ok(has('island_bar') || has('round_bar') || has('lounge_bar'), `${at}: a bar`);
        if (B.w >= 20 && B.d >= 16) assert.ok(has('island_bar') || has('round_bar'), `${at}: a bar in the middle of the room`);
        if (B.w >= 16 && B.d >= 14) assert.ok(has('lounge_stage'), `${at}: the little stage`);
        const seats = L.items.reduce((s2, it) => s2 + CATALOG[it.t].slots.filter(sl => !['staff', 'music'].includes(sl.use)).length, 0);
        assert.ok(seats >= (area >= 300 ? 30 : 12), `${at}: ${seats} seats`);
        const kinds = new Set(L.items.filter(it => CATALOG[it.t]?.cat === 'Lounge').map(it => it.t)).size;
        assert.ok(kinds >= (area >= 400 ? 20 : area >= 200 ? 12 : 10), `${at}: ${kinds} kinds of lounge pieces`);
        let cover = 0; for (const it of L.items) { const d = CATALOG[it.t]; if (d.block !== false && !d.fixed && it.t !== 'door') cover += (d.rect[2] - d.rect[0]) * (d.rect[3] - d.rect[1]); }
        assert.ok(cover / area >= 0.08 && cover / area <= 0.4, `${at}: ${Math.round(cover / area * 100)}% of the floor covered (room to move, not empty)`);
        for (const w of L.walls || []) assert.equal(w[4], 2, `${at}: the salon's walls are panelled`);
      }
      if (t.id === 'club') {
        const has = k => L.items.some(it => it.t === k), area = B.w * B.d;
        assert.ok(has('dj_stage'), `${at}: the DJ's stage`);
        assert.ok(has('dance_ring') || has('dance_ring_s') || has('dance_floor'), `${at}: a dance floor`);
        if (B.w >= 14 && B.d >= 14) assert.ok(has('dance_ring') || has('dance_ring_s'), `${at}: the DJ in the middle of the dance floor`);
        assert.ok(has('club_bar'), `${at}: the bar`);
        const seats = L.items.reduce((s2, it) => s2 + CATALOG[it.t].slots.filter(sl => !['staff', 'music', 'dance'].includes(sl.use)).length, 0);
        assert.ok(seats >= (area >= 400 ? 60 : 8), `${at}: ${seats} seats`);
        if (area >= 400) assert.ok(has('vip_booth') && has('speaker_stack') && has('light_tower'), `${at}: VIP booths, speakers, light towers`);
        let cover = 0; for (const it of L.items) { const d = CATALOG[it.t]; if (d.block !== false && !d.fixed && it.t !== 'door') cover += (d.rect[2] - d.rect[0]) * (d.rect[3] - d.rect[1]); }
        assert.ok(cover / area >= 0.1 && cover / area <= 0.42, `${at}: ${Math.round(cover / area * 100)}% of the floor covered`);
      }
    }
    assert.ok(n >= 150, `layouts checked: ${n}`);
    // the stage's places are the band's (musicians on shift: shared/nightlife.js), the piano, the microphone, the double bass
    assert.ok(CATALOG.lounge_stage.slots.length >= 3 && CATALOG.lounge_stage.slots.every(sl => sl.use === 'staff'), 'the stage: a piano, a microphone, a double bass');
  } finally { await s.stop(); }
});

test('over HTTP: a floor becomes an arcade, keeps its theme and name through a re-roll and a resize, undo, refusals', { timeout: 240000 }, async () => {
  const s = await startServer({ data: tempDir('mvw-themes-http-'), population: 120 });
  try {
    const owner = await ownerSession(s);
    const edit = ops => owner.post('/api/edit', { ops });
    const world = async () => (await owner.get('/api/world')).json.world;
    let W = await world();
    const B = W.buildings.find(b => b && !b.gone && b.type === 'office' && b.floors >= 3 && b.w >= 18);
    assert.ok(B, 'an office tower');
    const level = (W2, f = 1) => W2.levels[W2.buildings[B.idx].lv[f]];
    const before = structuredClone(level(W));

    // an arcade on floor 2
    let r = await edit([{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'arcade' }]);
    assert.equal(r.status, 200, r.text);
    W = await world();
    let L = level(W);
    assert.equal(L.theme, 'arcade'); assert.equal(L.venue, 'arcade'); assert.equal(L.name, 'Arcade'); assert.equal(L.auto, 1);
    const cabs = L.items.filter(it => it.t === 'arcade').length;
    assert.ok(cabs >= 20, `cabinets: ${cabs}`);
    assert.equal(level(W, 2).theme, undefined, 'the floor above (it shared the layout) is left as it was');
    // one undo brings the office back
    assert.equal((await owner.post('/api/undo')).status, 200);
    W = await world();
    assert.deepEqual(level(W).items, before.items, 'undo: the office floor exactly');
    assert.equal((await edit([{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'arcade' }])).status, 200);

    // its own name; a re-roll keeps the theme and the name; taking the name off brings the theme's back
    r = await edit([{ op: 'lvl.name', b: B.idx, f: 1, name: '  Pixel   Palace <3 ' }]);
    assert.equal(r.status, 200, r.text);
    W = await world(); L = level(W);
    assert.equal(L.name, 'Pixel Palace 3'); assert.equal(L.named, 1); assert.equal(L.auto, 1, 'naming leaves it generated');
    const items0 = L.items;
    assert.equal((await edit([{ op: 'lvl.regen', b: B.idx, f: 1 }])).status, 200);
    W = await world(); L = level(W);
    assert.equal(L.theme, 'arcade', 'a re-roll keeps the theme'); assert.equal(L.name, 'Pixel Palace 3', 'and the name');
    assert.notDeepEqual(L.items, items0, 'a new arrangement');
    assert.equal((await edit([{ op: 'lvl.name', b: B.idx, f: 1, name: '' }])).status, 200);
    W = await world(); assert.equal(level(W).name, 'Arcade'); assert.equal(level(W).named, undefined);

    // a resize lays it out again for the new size, still an arcade
    const o = toWorld(B, 0, 0), u = toWorld(B, 1, 0), ax = u.x - o.x, az = u.z - o.z, nw = Math.round((B.w - 3) * 2) / 2, d = B.w - nw;
    r = await edit([{ op: 'bld.place', b: B.idx, x: B.x - ax * d / 2, z: B.z - az * d / 2, w: nw, fit: 'regen' }]);
    assert.equal(r.status, 200, r.text);
    W = await world(); L = level(W);
    assert.equal(W.buildings[B.idx].w, nw);
    assert.equal(L.theme, 'arcade', 'the resized floor is still an arcade'); assert.ok(L.items.filter(it => it.t === 'arcade').length >= 12);
    assert.equal((await owner.post('/api/undo')).status, 200);

    // ↺ Reset to auto: the building's own floor, no theme
    assert.equal((await edit([{ op: 'lvl.reset', b: B.idx, f: 1 }])).status, 200);
    W = await world(); assert.equal(level(W).theme, undefined); assert.notEqual(level(W).venue, 'arcade');

    // refused: a floor with flats, a theme that isn't one, a park; a player without rights on the lot
    const A = W.buildings.find(b => b && !b.gone && b.type === 'apartment' && b.floors >= 2);
    if (A) { r = await edit([{ op: 'lvl.theme', b: A.idx, f: 1, theme: 'club' }]); assert.equal(r.status, 400); assert.match(r.json.error, /flats/); }
    r = await edit([{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'casino' }]); assert.equal(r.status, 400); assert.match(r.json.error, /No such floor theme/);
    const P = W.buildings.find(b => b && !b.gone && b.type === 'park');
    if (P) { r = await edit([{ op: 'lvl.theme', b: P.idx, f: 0, theme: 'arcade' }]); assert.equal(r.status, 400); }
    const bob = await userSession(s, owner, { login: 'bob' });
    r = await bob.post('/api/edit', { ops: [{ op: 'lvl.theme', b: B.idx, f: 1, theme: 'arcade' }] });
    assert.ok(r.status === 403 || r.status === 400, `a player without rights: ${r.status}`);
    r = await bob.post('/api/edit', { ops: [{ op: 'lvl.name', b: B.idx, f: 1, name: 'Mine' }] });
    assert.ok(r.status === 403 || r.status === 400, `nor name it: ${r.status}`);
  } finally { await s.stop(); }
});
