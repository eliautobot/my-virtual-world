// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Jumping onto things without a physics engine (2026-10-05): the server's position check (shared/playernav.js)
// lets a body stand on a decoration or a piece of furniture only when its feet are on top of it (shared/standable.js),
// and never on anything taller, nor inside a wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerNav } from '../shared/playernav.js';
import { toWorld } from '../shared/geom.js';
import { itemTop, topUnder, tallUnder, STEP, JUMP_PEAK } from '../shared/standable.js';
import { startServer, ownerSession } from './helpers/server.mjs';

test('standing heights: surfaces below backs and screens; a jump clears a table but not a shelf', () => {
  assert.equal(itemTop('bench'), 0.48);
  assert.equal(itemTop('desk'), 0.76);
  assert.equal(itemTop('bookshelf'), 2.0, 'no override: the full height');
  assert.ok(JUMP_PEAK > 1.05 && JUMP_PEAK < 1.2, 'a jump lifts the feet about a metre');
  const items = [{ t: 'bench', x: 0, z: 0, r: 0 }, { t: 'bookshelf', x: 3, z: 0, r: 0 }];
  assert.equal(topUnder(items, 0, 0, 0.1), 0.48);
  assert.equal(topUnder(items, 0, 0, 0.1, 0.3), -Infinity, 'out of reach from the ground');
  assert.equal(tallUnder(items, 0, 0, 0.1, 0), true, 'walks into the bench from the ground');
  assert.equal(tallUnder(items, 0, 0, 0.1, 0.48 - STEP + 0.01), false, 'steps onto it from high enough');
  assert.equal(tallUnder(items, 3, 0, 0.1, 1.08), true, 'a shelf stays a wall at the top of a jump');
});

test('the server accepts a player on top of a bench or a desk, not inside it, not on a shelf', async () => {
  const s = await startServer({ population: 60 });
  try {
    const owner = await ownerSession(s);
    const world = (await owner.get('/api/world')).json.world;
    let nav = new PlayerNav(world);
    const sp = nav.defaultSpawn();
    world.decorations = [...(world.decorations || []), { id: 'tb', t: 'bench', x: sp.x, z: sp.z, r: 0 }];
    nav = new PlayerNav(world);
    assert.equal(nav.ok(sp.x, sp.z, -1), false, 'on the ground: inside the bench');
    assert.equal(nav.ok(sp.x, sp.z, -1, 0.2), true, 'within a step of its seat (the browser steps up)');
    assert.equal(nav.ok(sp.x, sp.z, -1, -0.1), false, 'below it');
    assert.equal(nav.ok(sp.x, sp.z, -1, 0.5), true, 'on its seat');
    // indoors: a desk and a bookshelf
    let found = null;
    for (const B of world.buildings) {
      if (!B || B.gone || B.type === 'park') continue;
      for (let f = 0; f < B.floors && !found; f++) {
        const L = world.levels[B.lv[f]], d = L?.items?.find(i => i.t === 'desk'), sh = L?.items?.find(i => i.t === 'bookshelf');
        if (d && sh) found = { B, f, d, sh };
      }
      if (found) break;
    }
    assert.ok(found, 'a floor with a desk and a bookshelf');
    const { B, f, d, sh } = found, ctx = B.idx * 64 + f;
    const dw = toWorld(B, d.x, d.z), sw = toWorld(B, sh.x, sh.z);
    assert.equal(nav.ok(dw.x, dw.z, ctx), false, 'inside the desk');
    assert.equal(nav.ok(dw.x, dw.z, ctx, 0.78), true, 'on the desk');
    assert.equal(nav.ok(sw.x, sw.z, ctx, 1.1), false, 'not on a 2 m shelf at the top of a jump');
    assert.equal(nav.ok(dw.x, dw.z, ctx, 0.2), false, 'a desk is more than a step from the floor');
  } finally { await s.stop(); }
});

test('parks: hedges are jumped over, gate posts are not; the fountain has a rim to stand on and a pool to wade in', async () => {
  const { parkEdgeTop, PARK_EDGE } = await import('../shared/standable.js');
  const hw = 45, hd = 30, e = PARK_EDGE.e;
  assert.equal(parkEdgeTop(hw, hd, 10, hd - e, 0.1), 0.97, 'a hedge');
  assert.equal(parkEdgeTop(hw, hd, PARK_EDGE.gap, hd - e, 0.1), 1.35, 'a gate post');
  assert.equal(parkEdgeTop(hw, hd, 0, hd - e, 0.1), 0, 'the gate');
  assert.equal(parkEdgeTop(hw, hd, 10, 5, 0.1), 0, 'inside');
  assert.ok(0.97 < JUMP_PEAK && 1.35 > JUMP_PEAK, 'a jump clears a hedge, not a post');
  const f = [{ t: 'fountain', x: 0, z: 0, r: 0 }];
  assert.equal(topUnder(f, 2.9, 0, 0.05), 0.56, 'the coping');
  assert.equal(topUnder(f, 2.0, 0, 0.05), 0.1, 'the pool floor');
  assert.equal(tallUnder(f, 1.0, 0, 0.1, 0.1), true, 'nobody walks under the lower bowl');
  assert.equal(tallUnder(f, 2.9, 0, 0.05, 0), true, 'the rim needs a jump from the ground');
});

test('a new park has its fountain at the crossing', async () => {
  const { freshLevels } = await import('../server/world/generate.js');
  const B = { idx: 1, type: 'park', name: 'Test Park', x: 0, z: 0, w: 91.44, d: 60.96, rot: 0, floors: 1, seed: 7, lv: [0] };
  const L = freshLevels(B)(0);
  const fo = L.items.filter(i => i.t === 'fountain');
  assert.equal(fo.length, 1);
  assert.deepEqual([fo[0].x, fo[0].z], [0, 0]);
});

test('swimming: players may be in the island\'s water, but nobody is put there (spawns and nearest spots stay dry)', async () => {
  const s = await startServer({ population: 60 });
  try {
    const owner = await ownerSession(s);
    const world = (await owner.get('/api/world')).json.world;
    world.terrain = { center: { x: 0, z: 0 }, radius: 5000 };
    const ground = { water: (x) => (x > 3000 ? { kind: 'sea', level: -2.4 } : null), height: () => 0 };
    const nav = new PlayerNav(world, { ground });
    assert.equal(nav.ok(3500, 0, -1), true, 'swimming in the sea');
    assert.equal(nav.wet(3500, 0), true);
    const v = nav.openGround(3020, 0);
    assert.ok(v && v.x <= 3000, 'the nearest free spot is on dry land');
    assert.equal(nav.ok(9000, 0, -1), false, 'not beyond the island\'s reach');
  } finally { await s.stop(); }
});

test('swim clips, the mended walk and run, the holding, doing and eating clips: every baked character has them, and the frames are the size the browser expects', async () => {
  const fs = await import('node:fs');
  const list = JSON.parse(fs.readFileSync('client/assets/chars/extra-clips.json', 'utf8'));
  assert.deepEqual(list.clips.map(c => c.name), ['swim_idle', 'swim', 'swim_under', 'walk', 'run',
    'hold_walk', 'hold_walk_phone', 'hold_idle', 'hold_phone', 'hold_drink', 'hold_sit_phone', 'hold_sit_drink', 'hold_sit_read',
    'act_cook', 'act_wash', 'act_browse', 'act_use', 'act_lift', 'act_pingpong', 'eat_hands', 'eat_hand', 'eat_lap', 'eat_stand', 'eat_stand_hands', 'act_prep',
    'eat_knife', 'eat_spoon', 'helm', 'fish_idle', 'fish_cast', 'fish_reel', 'fish_fight', 'fish_net', 'fish_show']);
  // (the walk and run take the place of the bake's own, at its length: their pace and stride stay)
  const m01 = JSON.parse(fs.readFileSync('client/assets/chars/m01.json', 'utf8'));
  for (const c of list.clips.filter(x => x.mended)) assert.equal(c.len, m01.clips.find(x => x.name === c.name).len, c.name);
  assert.deepEqual(list.clips.filter(c => c.mended).map(c => c.name), ['walk', 'run']);
  const n = list.clips.reduce((t, c) => t + c.len, 0);
  const idx = fs.readFileSync('client/assets/chars/index.js', 'utf8'), kinds = JSON.parse(/TEXTURED = (\[[^\]]*\])/.exec(idx)[1].replace(/'/g, '"'));
  for (const k of kinds) {
    assert.equal(list.kinds[k], n, `${k} listed`);
    const man = JSON.parse(fs.readFileSync(`client/assets/chars/${k}.json`, 'utf8'));
    assert.equal(fs.statSync(`client/assets/chars/${k}.extra.bin`).size, n * man.bones * 24, `${k}.extra.bin size`);
    // where it holds things (render/char-props.js): each hand's grip frame (3×4, unit axes) and its desk point
    const g = list.grips[k];
    for (const side of ['R', 'L']) {
      assert.equal(g[side].length, 12, `${k} ${side} grip`);
      for (let c = 0; c < 3; c++) assert.ok(Math.abs(Math.hypot(g[side][c], g[side][4 + c], g[side][8 + c]) - 1) < 1e-3, `${k} ${side} grip axis ${c}`);
    }
    assert.ok(g.desk[1] > 0.6 && g.desk[1] < 0.9 && g.desk[2] > 0.3 && g.desk[2] < 0.8, `${k} desk ${g.desk}`);
  }
  const { TRIPO_CLIPS, OLD_TO_TRIPO, TRIPO_FALLBACK } = await import('../client/js/render/charClips.js');
  for (const c of list.clips) {
    assert.ok(TRIPO_CLIPS.includes(c.name));
    if (c.hold) assert.ok(Object.values(OLD_TO_TRIPO).includes(c.name) && TRIPO_FALLBACK[c.name], `${c.name}: played for some clip, with a stand-in`);
    else assert.equal(OLD_TO_TRIPO[c.name], c.name);
  }
});
