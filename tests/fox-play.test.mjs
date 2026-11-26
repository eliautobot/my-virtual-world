// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The playful foxes (server/world/fox.js): they come to people instead of running, follow, play, fetch a thrown stick,
// can be petted and fed (and remember who did), bolt only from cars; their plans reach the pages in a small form.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Foxes, ACTS, ACT_LEN } from '../server/world/fox.js';
import { validateSpecies } from '../shared/species.js';
import { sharedSpecies, Wildlife } from '../server/world/wildlife.js';

const sp = JSON.parse(fs.readFileSync(new URL('../shared/world-config/species/fox.json', import.meta.url)));
const man = JSON.parse(fs.readFileSync(new URL('../client/assets/fauna/fox/fox.json', import.meta.url)));

/** A fox alone on open, dry land (no town), driven tick by tick as the wildlife does (every 0.5 s). */
function field(o = {}) {
  const F = new Foxes(), H = { id: '0,0:fox:0', sp, ax: 0, az: 0, members: [{ x: 0, z: 0, x1: 0, z1: 0, t0: 0, t1: 0, mode: 'rest', yaw: 0, col: 0 }] };
  const ctx = { dry: () => true, town: o.town || (() => false), threats: [], people: [], hour: 15 };
  let t = 0;
  const run = (secs, people = [], threats = []) => {
    for (let k = 0; k < secs * 2; k++) { t += 0.5; ctx.people = F.people(people.map(p => (typeof p === 'function' ? p(t) : p)), t); ctx.threats = threats; F.step(H, t, ctx); }
  };
  return { F, H, ctx, run, now: () => t, at: () => Foxes.at(H.members[0], t) };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

test('the fox in the catalogue: shared, playful, never flees on foot, modelled with every act baked', () => {
  assert.deepEqual(validateSpecies(sp), []);
  assert.equal(sp.behaviour, 'play'); assert.equal(sp.flee, 0);
  assert.ok(sharedSpecies().some(s => s.id === 'fox'), 'loaded with the shared tier');
  for (const a of ACTS) {
    const c = man.clips[a]; assert.ok(c, `clip ${a}`);
    assert.ok(Math.abs(c.frames / c.fps - ACT_LEN[a]) < 0.05, `${a}: baked ${c.frames / c.fps}s, the mind times ${ACT_LEN[a]}s`);
  }
  assert.ok(man.clips.walk?.stride && man.clips.run?.stride && man.clips.rest);
  assert.deepEqual(validateSpecies({ ...sp, tier: 'ambient' }).some(w => /play/.test(w)), true, 'play needs the shared tier');
});

test('someone standing nearby: the fox comes to look and plays instead of running away', () => {
  const W = field(); const me = { id: 'p1', x: 22, z: 0 };
  W.run(60, [me]);
  assert.ok(dist(W.at(), me) < 9, `it came closer (${dist(W.at(), me).toFixed(1)} m)`);
  const seen = new Set(); for (let k = 0; k < 120; k++) { W.run(0.5, [me]); seen.add(W.H.members[0].act || W.H.members[0].mode); }
  assert.ok([...seen].some(a => ['bow', 'hop', 'wag', 'orbit', 'pounce', 'tilt', 'sit', 'dig'].includes(a)), `it plays: ${[...seen]}`);
  assert.ok(![...seen].includes('run') || dist(W.at(), me) < 12, 'never bolts from a person');
});

test('pet and treat: it comes to the player, rolls over for a friend, and remembers them', () => {
  const W = field(); const me = { id: 'p1', x: 3, z: 0 };
  W.run(1, [me]);
  assert.equal(W.F.interact(W.H, 0, me, 'pet', {}, W.now(), W.ctx).ok, true);
  W.run(4, [me]);
  assert.ok(dist(W.at(), me) < 1.6, `at their feet (${dist(W.at(), me).toFixed(2)} m)`);
  W.run(2, [me]);
  assert.equal(W.F.interact(W.H, 0, me, 'treat', {}, W.now(), W.ctx).ok, true);
  const t = W.F.trustOf('p1', '0,0:fox:0:0', W.now());
  assert.ok(t >= 1.5, `trust grows (${t})`);
  W.run(1.5, [me]); assert.equal(W.F.interact(W.H, 0, me, 'pet', {}, W.now(), W.ctx).ok, true);
  const acts = new Set(); for (let k = 0; k < 30; k++) { W.run(0.5, [me]); acts.add(W.H.members[0].act); }
  assert.ok(acts.has('roll'), `a friend gets the belly-up roll: ${[...acts]}`);
  assert.equal(W.F.trustOf('p2', '0,0:fox:0:0', W.now()), 0, 'a stranger is still a stranger');
  assert.equal(W.F.interact(W.H, 0, { id: 'p2', x: 30, z: 0 }, 'pet', {}, W.now(), W.ctx).why, 'too far');
});

test('fetch: the stick flies, the fox races to it, pounces, carries it back and drops it at the thrower\'s feet', () => {
  const W = field(); const me = { id: 'p1', x: 2, z: 0 };
  W.run(1, [me]);
  const r = W.F.interact(W.H, 0, me, 'fetch', { x: 14, z: 6 }, W.now(), W.ctx);
  assert.equal(r.ok, true);
  const states = []; let near = Infinity;
  for (let k = 0; k < 60; k++) {
    W.run(0.5, [me]); const S = W.H.fox.stick; states.push(S?.state);
    if (S?.state === 'carried') near = Math.min(near, dist(W.at(), { x: 14, z: 6 }));
  }
  assert.ok(states.includes('flying') || states.includes('ground'), 'it lands');
  assert.ok(states.includes('carried'), `it is carried: ${[...new Set(states)]}`);
  assert.ok(near < 1.5, 'picked up where it fell');
  assert.equal(W.H.fox.stick.state, 'ground', 'dropped');
  assert.ok(dist(W.H.fox.stick, me) < 2, `at the thrower's feet (${dist(W.H.fox.stick, me).toFixed(2)} m)`);
  assert.equal(W.H.members[0].carry, false);
  assert.equal(W.F.interact(W.H, 0, me, 'fetch', { x: 1e9, z: 0 }, W.now() + 2, W.ctx).ok, true, 'a long throw is cut to 20 m');
  assert.ok(dist(W.H.fox.stick, me) <= 20.01);
});

test('tag: someone sprinting at it — it darts off and bows to be chased again', () => {
  const W = field(); let me = { id: 'p1', x: 4, z: 0 };
  W.run(3, [me]);
  const p = W.at();
  for (const back of [12, 9, 6, 3]) W.run(0.5, [{ id: 'p1', x: p.x - back, z: p.z }]);   // (6 m/s at it)
  const m = W.H.members[0];
  assert.ok(m.mode === 'run' || m.mode === 'orbit', `it runs off (${m.mode} ${m.act})`);
  assert.ok(m.b.plan.some(s => s.act === 'bow'), 'and will bow');
});

test('a car frightens it; a person walking off is followed — but not into town', () => {
  const W = field(); W.run(2);
  W.run(0.5, [], [{ x: 3, z: 0, r: 6 }]);
  assert.equal(W.H.members[0].mode, 'run', 'bolts from a moving car');
  const town = (x) => x > 40;
  const T = field({ town: (x) => town(x) }), walk = t => ({ id: 'p1', x: 5 + 1.4 * t, z: 0 });
  let far = 0;
  for (let k = 0; k < 160; k++) { T.run(0.5, [walk]); far = Math.max(far, T.at().x); }
  assert.ok(far < 41, `it stops at the edge of town (${far.toFixed(1)})`);
  assert.ok(far > 20, `it followed (${far.toFixed(1)})`);
  T.run(60, [walk]);
  assert.ok(T.at().x < 15, `then it goes home (${T.at().x.toFixed(1)})`);
});

test('alone it keeps busy: naps by day, mouses, sits, digs — and wakes for someone', () => {
  const W = field(); const acts = new Set();
  for (let k = 0; k < 1600; k++) { W.run(0.5); acts.add(W.H.members[0].act || W.H.members[0].mode); }
  for (const a of ['sleep', 'pounce', 'dig']) assert.ok(acts.has(a), `${a} in ${[...acts]}`);
  assert.ok(dist(W.at(), { x: 0, z: 0 }) < 80, 'stays round its den');
});

test('the pages get a fox in the herds\' form plus its act, an orbit\'s turn and the stick', () => {
  const W = new Wildlife({ terrain: null }, { species: [sp], seed: 't', clock: () => ({}) });
  const f = field(); const me = { id: 'p1', x: 2, z: 0 };
  f.F.interact(f.H, 0, me, 'fetch', { x: 10, z: 0 }, f.now(), f.ctx);
  const v = W.herdView(f.H);
  assert.equal(v.m[0].length, 12);
  assert.ok(v.m[0][9] >= 0 && v.m[0][9] <= ACTS.length);
  assert.equal(v.k[0], 1, 'the stick is in the air');
  assert.ok(JSON.stringify(v).length < 300);
});

test('the gaits stay on the ground: walk, trot and gallop skinned from the baked asset (no body or brush below it)', () => {
  // (2026-11-24: a gallop baked for the wrong size outran the fox's legs — the body sank 0.7 m into the ground)
  const bin = fs.readFileSync(new URL('../client/assets/fauna/fox/fox.bin', import.meta.url));
  const buf = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), L = man.lods[man.lods.length - 1];
  const P = new Float32Array(buf, L.pos, L.verts * 3), S = new Uint8Array(buf, L.skin, L.verts * 4), Wt = new Uint8Array(buf, L.weight, L.verts * 4);
  const nb = man.anim.bones, A = new Float32Array(buf, man.anim.offset, man.anim.frames * nb * 12);
  for (const k of ['walk', 'trot', 'run']) {
    const c = man.clips[k]; assert.ok(c?.stride > 0, `${k} baked with its stride`);
    let lo = Infinity, hi = -Infinity;
    for (let f = c.start; f < c.start + c.frames; f += 2) {
      let fl = Infinity, fh = -Infinity;
      for (let v = 0; v < L.verts; v++) {
        let y = 0;
        for (let j = 0; j < 4; j++) { const w = Wt[v * 4 + j] / 255; if (!w) continue; const o = ((f * nb) + S[v * 4 + j]) * 12 + 4; y += w * (A[o] * P[v * 3] + A[o + 1] * P[v * 3 + 1] + A[o + 2] * P[v * 3 + 2] + A[o + 3]); }
        fl = Math.min(fl, y); fh = Math.max(fh, y);
      }
      lo = Math.min(lo, fl); hi = Math.min(Math.max(hi, fh), Infinity);
      assert.ok(fh > man.height * 0.8, `${k} frame ${f - c.start}: the body stays up (top ${fh.toFixed(2)} m)`);
    }
    assert.ok(lo > -0.06, `${k}: nothing more than a paw's depth below the ground (${lo.toFixed(3)} m)`);
  }
  // each gait made for its own speed (m/s at the species' size): the walk, the trot, the gallop
  const v = k => man.clips[k].stride * sp.size * man.clips[k].fps / man.clips[k].frames;
  assert.ok(Math.abs(v('walk') - sp.speed) < 0.15 && Math.abs(v('trot') - 2.6) < 0.2 && Math.abs(v('run') - sp.run) < 0.5, `${v('walk')} ${v('trot')} ${v('run')}`);
});

test('following has an end: after a while it lets a walker go and does not trail after them again', () => {
  const W = field(), walk = t => ({ id: 'p1', x: 5 + 1.4 * t, z: 0 });
  let followed = 0;
  for (let k = 0; k < 40; k++) { W.run(0.5, [walk]); followed = Math.max(followed, W.at().x); }
  assert.ok(followed > 12, `it trotted after them (${followed.toFixed(1)})`);
  W.run(90, [walk]);
  const me = walk(W.now());
  assert.ok(dist(W.at(), me) > 60, `then it let them go (${dist(W.at(), me).toFixed(1)} m behind)`);
  assert.ok(Foxes.mind(W.H.members[0]).letGo.has('p1'), 'and remembers it did');
});

test('bye: it gives a last look, trots off and leaves that person be — until they play with it again', () => {
  const W = field(); const me = { id: 'p1', x: 3, z: 0 };
  W.run(2, [me]);
  assert.equal(W.F.interact(W.H, 0, me, 'pet', {}, W.now(), W.ctx).ok, true);
  W.run(6, [me]);
  assert.ok(dist(W.at(), me) < 2, 'it came for the pet');
  assert.equal(W.F.interact(W.H, 0, me, 'bye', {}, W.now(), W.ctx).ok, true);
  assert.equal(W.H.members[0].act, 'tilt', 'a last look');
  W.run(20, [me]);
  assert.ok(dist(W.at(), me) > 10, `off it goes (${dist(W.at(), me).toFixed(1)} m)`);
  let closest = Infinity;
  for (let k = 0; k < 240; k++) { W.run(0.5, [me]); closest = Math.min(closest, dist(W.at(), me)); }
  assert.ok(closest > 6, `it leaves them be (closest ${closest.toFixed(1)} m)`);
  const walk = t => ({ id: 'p1', x: me.x, z: 3 + 1.4 * (t - 200) });
  const before = dist(W.at(), me); W.run(20, [walk]);
  assert.ok(W.H.members[0].to?.pid !== 'p1', 'it does not follow them');
  // someone else is still company; and playing again ends the bye
  assert.equal(W.F.interact(W.H, 0, { id: 'p1', x: W.at().x + 3, z: W.at().z }, 'treat', {}, W.now(), W.ctx).ok, true);
  assert.ok(!Foxes.until(Foxes.mind(W.H.members[0]).bye, 'p1', W.now()), 'friends again');
  assert.ok(before > 0);
});

test('AI agents play with it the same way (server/interactions/sources/animals.js): offered, done, and the fox answers', async () => {
  const { animalsSource, oneOf } = await import('../server/interactions/sources/animals.js');
  const W = field();
  // a stand-in for the wildlife: the one fox of the field, found and played with as server/world/wildlife.js does
  const wild = {
    playfulNear: (x, z, r, pid) => { const p = W.at(), d = Math.hypot(p.x - x, p.z - z), m = W.H.members[0], b = Foxes.mind(m); return d > r ? [] : [{ id: W.H.id, k: 0, sp, x: p.x, z: p.z, d, act: m.act || '', carry: !!m.carry, asleep: false, trust: W.F.trustOf(pid, `${W.H.id}:0`, W.now()), withThem: !!(m.to?.pid === pid || b.plan.some(s => s.pid === pid || s.face === pid)) }]; },
    interact: (id, k, q, act, o) => { if (!W.ctx.people.some(x => x.id === q.id)) W.ctx.people = [...W.ctx.people, { ...q, vx: 0, vz: 0, v: 0 }]; return W.F.interact(W.H, k, q, act, o, W.now(), W.ctx); },
    landable: () => true,
  };
  const src = animalsSource({ wildlife: () => wild }), agent = { id: 'ag7', x: 15, z: 0, agent: true }, body = { id: 'agent:ag7', x: 15, z: 0, name: 'Sam', agent: true };
  assert.equal(oneOf(sp), 'red fox');
  W.run(1, [body]);
  const ctx = { rec: { id: 'ag7', name: 'Sam' }, a: { plan: {} }, sim: null, me: { x: agent.x, z: agent.z, ctx: -1 } };
  const list = src.near(ctx);
  const kinds = list.map(x => x.kind);
  for (const k of ['pet_animal', 'feed_animal', 'fetch_animal', 'chase_animal']) assert.ok(kinds.includes(k), `${k} offered: ${kinds}`);
  assert.ok(list.every(x => /red fox/.test(x.label)), list.map(x => x.label).join(' | '));
  assert.equal(src.near({ ...ctx, me: { ...ctx.me, ctx: 5 } }).length, 0, 'not from indoors');
  // a player 15 m off is too far to pet; the agent's reach brings the fox over
  assert.equal(W.F.interact(W.H, 0, { id: 'p9', x: 15, z: 0 }, 'pet', {}, W.now(), W.ctx).why, 'too far');
  W.run(1.5, [body]);
  const r = src.run(ctx, list.find(x => x.kind === 'pet_animal'));
  assert.equal(r.ok, true, r.brain); assert.match(r.text, /Sam pets the red fox/); assert.match(r.brain, /trusts you/);
  W.run(8, [body]);
  assert.ok(dist(W.at(), agent) < 1.8, `it came to the agent's feet (${dist(W.at(), agent).toFixed(2)} m)`);
  assert.ok(W.F.trustOf('agent:ag7', `${W.H.id}:0`, W.now()) > 0, 'and trusts the agent a little');
  // a stick, thrown by the agent, fetched back to it
  W.run(1.5, [body]);
  const f = src.run(ctx, src.near(ctx).find(x => x.kind === 'fetch_animal'));
  assert.equal(f.ok, true, f.brain);
  let carried = false; for (let k = 0; k < 60; k++) { W.run(0.5, [body]); carried ||= W.H.fox.stick?.state === 'carried'; }
  assert.ok(carried && dist(W.H.fox.stick, agent) < 2.5, 'fetched back to the agent');
  // bye: offered now it is with the agent, and it goes
  W.run(1.5, [body]);
  const bye = src.near(ctx).find(x => x.kind === 'bye_animal'); assert.ok(bye, 'bye offered');
  assert.equal(src.run(ctx, bye).ok, true);
  W.run(25, [body]);
  assert.ok(dist(W.at(), agent) > 10, `it went off (${dist(W.at(), agent).toFixed(1)} m)`);
});
