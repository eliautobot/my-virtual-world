// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Play modules (docs/features/play-modules.md): the registry, the airport's courses and its run check, and the core —
// courses open in order, a run is checked by the server (never a score from the browser), experience, levels, ranks,
// best results and places, badges, the profile, and a deleted account's play going with it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { openDb } from '../server/db.js';
import { PlayCore } from '../server/play/play.js';
import { playOf, plays, starsFor, unlocked, playerLevel, moduleLevel, rankOf, registerPlay, formatScore, prizeFor, prizeTop, PRIZE_DEFAULTS, fmtVc } from '../shared/play.js';
import { COURSES, COURSE_BY_ID, courseRings, ringPasses, verifyFlight } from '../shared/airport.js';
import { tempDir } from './helpers/server.mjs';

const AIRPORT = { x: 1000, z: -500, y: 3, yaw: 0.6 };
/** A flight through every ring at speed v (m/s), sampled four times a second, starting 200 m before the gate. */
function flyThrough(rings, v = 40, { skip = -1, hz = 4 } = {}) {
  const pts = [];
  const g = rings[0], pre = { x: g.x - g.nx * 200, y: g.y, z: g.z - g.nz * 200 };
  const way = [pre, ...rings.filter((_, k) => k !== skip).flatMap(r => [{ x: r.x - r.nx * 8, y: r.y, z: r.z - r.nz * 8 }, { x: r.x + r.nx * 8, y: r.y, z: r.z + r.nz * 8 }])];
  let t = 0;
  pts.push([0, way[0].x, way[0].y, way[0].z]);
  for (let k = 1; k < way.length; k++) {
    const a = way[k - 1], b = way[k], L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / v * hz));
    for (let j = 1; j <= n; j++) { t += L / v / n * 1000; const u = j / n; pts.push([Math.round(t), a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u]); }
  }
  return pts;
}

test('the registry: the airport is a module with ten courses in order, three aircraft classes, fixed stars and badges', () => {
  const m = playOf('airport');
  assert.ok(m && plays().includes(m));
  assert.equal(m.courses.length, 10);
  assert.deepEqual(new Set(m.courses.map(c => c.aircraft)), new Set(['prop', 'jet', 'heli']));
  for (const c of m.courses) assert.ok(c.stars[0] > c.stars[1] && c.stars[1] > c.stars[2] && c.limit > c.stars[0], `${c.id}: stars fall, the limit is above them`);
  assert.deepEqual(unlocked(m, {}), ['first-flight'], 'only the first course is open at first');
  assert.deepEqual(unlocked(m, { 'first-flight': { stars: 1 } }), ['first-flight', 'coast-cruise']);
  assert.deepEqual(unlocked(m, { 'first-flight': { stars: 0 } }), ['first-flight'], 'a finish without a star opens nothing');
  const c = COURSE_BY_ID['first-flight'];
  assert.equal(starsFor(m, c, c.stars[2] - 1), 3); assert.equal(starsFor(m, c, c.stars[1]), 2); assert.equal(starsFor(m, c, c.stars[0] + 1), 0);
  assert.equal(formatScore(m, 75.5), '1:15.50');
  assert.equal(m.placement, 'world', 'the airport is a world module: administrators place it');
  assert.throws(() => registerPlay({ id: 'arcade_x', version: 1, label: 'x', icon: 'x', blurb: 'x', score: { kind: 'points', better: 'higher' }, courses: [{ id: 'a', difficulty: 1, stars: [1, 2, 3] }], verify() {} }), /interior module has a price/);
  assert.throws(() => registerPlay({ id: 'bad', version: 1, placement: 'world', label: 'x', icon: 'x', blurb: 'x', score: { kind: 'time', better: 'lower' }, courses: [{ id: 'b', after: 'a', difficulty: 1, stars: [3, 2, 1] }], verify() {} }), /must be listed before/);
  assert.equal(playerLevel(0), 1); assert.equal(playerLevel(100), 2); assert.equal(moduleLevel(240), 3);
  assert.equal(rankOf(1).id, 'rookie'); assert.equal(rankOf(15).id, 'gold'); assert.equal(rankOf(99).id, 'legend');
});

test('a course over a real airport: the same shape anywhere, lifted clear of the ground and the roofs under it', () => {
  const c = COURSE_BY_ID['city-hop'];
  const flat = courseRings(c, AIRPORT), roofs = courseRings(c, AIRPORT, () => 200);
  assert.equal(flat.length, c.n);
  for (let k = 0; k < flat.length; k++) {
    assert.equal(flat[k].x, roofs[k].x); assert.equal(flat[k].z, roofs[k].z);
    assert.ok(roofs[k].y >= 200 + roofs[k].r, 'over the roof by more than its radius');
    assert.ok(Math.abs(Math.hypot(flat[k].nx, flat[k].nz) - 1) < 1e-3);
  }
});

test('the run check finds the passes itself, in order, and refuses a missed ring, the wrong aircraft, a teleport and a fast clock', () => {
  const c = COURSE_BY_ID['first-flight'], rings = courseRings(c, AIRPORT), ctx = { serverMs: 3600e3, data: { rings } };
  const path = flyThrough(rings, 48);
  assert.equal(ringPasses(rings, path).length, rings.length);
  const ok = verifyFlight(c, { aircraft: 'prop', path }, ctx);
  assert.equal(ok.ok, true, ok.why);
  assert.ok(Math.abs(ok.score - (path.at(-1)[0] - 0) / 1000) < 20, 'the time is from the gate to the last ring');
  assert.match(verifyFlight(c, { aircraft: 'prop', path: flyThrough(rings, 48, { skip: 3 }) }, ctx).why, /Missed ring 4/);
  assert.match(verifyFlight(c, { aircraft: 'jet', path }, ctx).why, /propeller plane/);
  const tp = path.map(p => [...p]); tp[10][1] += 2000;
  assert.match(verifyFlight(c, { aircraft: 'prop', path: tp }, ctx).why, /Faster than/);
  assert.match(verifyFlight(c, { aircraft: 'prop', path }, { ...ctx, serverMs: 5000 }).why, /longer than the clock/);
  const back = path.map(p => [p[0], 2 * AIRPORT.x - p[1], p[2], 2 * AIRPORT.z - p[3]]);
  assert.equal(verifyFlight(c, { aircraft: 'prop', path: back }, ctx).ok, false, 'a mirrored path does not go through the rings the right way');
  assert.equal(verifyFlight(c, { aircraft: 'prop', path: 'nope' }, ctx).ok, false);
});

function setup(prizes = null) {
  const dir = tempDir('mvw-play-'), dbs = openDb(dir);
  const now = { t: 1_800_000_000_000 };
  const mk = (login, name) => { const t = Date.now(); return { id: Number(dbs.db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
    VALUES (?, ?, ?, ?, 'member', 'x', ?, ?, ?)`).run(dbs.worldId, login, name, login, t, t, t).lastInsertRowid), login }; };
  const play = new PlayCore({ dbs, now: () => now.t, prizes, contextFor: id => (id === 'airport' ? { airport: AIRPORT } : {}) });
  return { dbs, play, now, mk, done: () => dbs.close?.() };
}
/** Starts and flies a course at speed v; the server's clock moves with the flight. */
function fly(S, acc, courseId, v) {
  S.now.t += 2000;
  const st = S.play.start(acc, 'airport', courseId);
  const c = COURSE_BY_ID[courseId], path = flyThrough(st.data.rings, v);
  S.now.t += path.at(-1)[0] + 500;
  return S.play.finish(acc, st.run, { aircraft: c.aircraft, path });
}

test('the core: courses open in order, results, experience, levels, places, badges, the profile and the leaderboard', () => {
  const S = setup();
  try {
    const ann = S.mk('ann', 'Ann'), bob = S.mk('bob', 'Bob');
    assert.throws(() => S.play.start(ann, 'airport', 'coast-cruise'), /Finish First Flight first/);
    const c = COURSE_BY_ID['first-flight'];
    const slow = fly(S, ann, 'first-flight', 16);   // in time, too slow for a star
    assert.equal(slow.ok, true, slow.why);
    assert.equal(slow.stars, 0); assert.deepEqual(slow.unlocked, []);
    assert.deepEqual(slow.badges.map(b => b.id).sort(), ['airborne', 'first_play']);
    const good = fly(S, ann, 'first-flight', 60);
    assert.equal(good.ok, true, good.why);
    assert.ok(good.stars >= 2, `stars ${good.stars} at ${good.score}s (thresholds ${c.stars})`);
    assert.equal(good.newBest, true); assert.equal(good.place, 1);
    assert.deepEqual(good.unlocked, ['coast-cruise']);
    assert.ok(good.xp > slow.xp);
    const worse = fly(S, ann, 'first-flight', 30);
    assert.equal(worse.newBest, false, 'a slower run keeps the best');
    assert.ok(worse.xp < good.xp, 'a repeat without a new best is worth less');
    // Bob beats her
    const b = fly(S, bob, 'first-flight', 70);
    assert.equal(b.place, 1);
    assert.ok(b.badges.some(x => x.id === 'world_record') && b.badges.some(x => x.id === 'podium'));
    const board = S.play.leaderboard('airport', 'first-flight', { viewer: ann.id });
    assert.deepEqual(board.rows.map(r => r.name), ['Bob', 'Ann']);
    assert.equal(board.rows[1].place, 2);
    assert.equal(board.you.place, 2);
    // a run is the starter's only, once
    S.now.t += 2000;
    const st = S.play.start(ann, 'airport', 'first-flight');
    assert.throws(() => S.play.finish(bob, st.run, {}), /That run has ended/);
    assert.equal(S.play.finish(ann, st.run, { aircraft: 'prop', path: [[0, 0, 0, 0], [100, 1, 0, 0]] }).ok, false);
    assert.throws(() => S.play.finish(ann, st.run, {}), /That run has ended/, 'a finished run cannot be sent twice');
    assert.throws(() => S.play.start(ann, 'airport', 'first-flight'), /Wait a moment/);
    // the profile
    let p = S.play.profile(ann.id, bob.id);
    assert.equal(p.name, 'Ann'); assert.equal(p.own, false);
    assert.equal(p.modules.airport.runs, 3);
    assert.ok(p.xp > 0 && p.level >= 1 && p.rank.id);
    assert.ok(p.badges.some(x => x.id === 'airborne'));
    assert.equal(p.recent.length, 3);
    p = S.play.setProfile(ann.id, { bio: 'Pilot.\u0007', showcase: ['airborne'] });
    assert.equal(p.bio, 'Pilot.'); assert.deepEqual(p.showcase, ['airborne']);
    assert.throws(() => S.play.setProfile(ann.id, { showcase: ['top_gun'] }), /only show badges you have earned/);
    assert.deepEqual(S.play.topPlayers().map(r => r.name).sort(), ['Ann', 'Bob']);
    // a course not at an airport
    const away = new PlayCore({ dbs: S.dbs, now: () => S.now.t + 99999, contextFor: () => ({ airport: null }) });
    assert.throws(() => away.start(ann, 'airport', 'first-flight'), /an airport/);
    // a deleted account's play goes
    S.play.forgetAccount(bob.id);
    assert.deepEqual(S.play.leaderboard('airport', 'first-flight').rows.map(r => r.name), ['Ann']);
    assert.equal(S.play.progress(bob.id).runs, 0);
  } finally { S.done(); }
});

test('every course can be flown and earns three stars when flown well, opening the next', () => {
  const S = setup();
  try {
    const ace = S.mk('ace', 'Ace');
    for (const c of COURSES) {
      const r = fly(S, ace, c.id, { prop: 66, jet: 132, heli: 68 }[c.aircraft]);
      assert.equal(r.ok, true, `${c.id}: ${r.why}`);
      assert.equal(r.stars, 3, `${c.id}: ${r.score}s against ${c.stars}`);
    }
    const p = S.play.profile(ace.id);
    for (const id of ['barnstormer', 'chopper_pilot', 'jet_setter', 'ring_master', 'speed_demon', 'top_gun']) assert.ok(p.badges.some(b => b.id === id), id);
  } finally { S.done(); }
});

test('prizes: harder courses and more stars pay more; repeats pay less; first stars and records pay a bonus', () => {
  const m = playOf('airport'), easy = COURSE_BY_ID['first-flight'], hard = COURSE_BY_ID['ace-gauntlet'];
  const pay = (c, run) => prizeFor(m, c, { prevStars: 0, place: 5, prevPlace: null, ...run }).amount;
  assert.ok(pay(hard, { stars: 1, newBest: true }) > pay(easy, { stars: 1, newBest: true }), 'a harder course pays more');
  assert.ok(pay(easy, { stars: 3, newBest: true }) > pay(easy, { stars: 2, newBest: true }) && pay(easy, { stars: 2, newBest: true }) > pay(easy, { stars: 1, newBest: true }));
  assert.ok(pay(easy, { stars: 3, newBest: false, prevStars: 3 }) < pay(easy, { stars: 3, newBest: true, prevStars: 3 }), 'a repeat without a new best pays less');
  const first = prizeFor(m, easy, { stars: 3, newBest: true, prevStars: 1, place: 1, prevPlace: 2 });
  assert.deepEqual(first.parts.map(p => p.label), ['3★ run', '2 new stars', 'New record']);
  assert.equal(prizeFor(m, easy, { stars: 3, newBest: true, prevStars: 3, place: 1, prevPlace: 1 }).parts.length, 1, 'keeping the record pays no record bonus');
  assert.equal(prizeFor(m, easy, { stars: 3, newBest: true }, { ...PRIZE_DEFAULTS, on: false }).amount, 0);
  assert.equal(prizeTop(m, hard), 21000, 'the hardest course pays up to 210 VC with the defaults');
  assert.equal(fmtVc(1250), '12.50 VC'); assert.equal(fmtVc(21000), '210 VC');
});

test('the core pays each run once, within the daily cap, and keeps what it paid with the run', () => {
  const paid = [];
  const prizes = { rules: () => ({ ...PRIZE_DEFAULTS, dailyCap: 3000 }), pay: (id, amount, memo, idem) => { paid.push({ id, amount, memo, idem }); return { paid: amount }; } };
  const S = setup(prizes);
  try {
    const ann = S.mk('ann', 'Ann');
    assert.equal(S.play.modules().find(m => m.id === 'airport').prizes['ace-gauntlet'], 21000);
    const a = fly(S, ann, 'first-flight', 60);
    assert.ok(a.vc.paid > 0 && a.vc.paid === a.vc.amount, JSON.stringify(a.vc));
    assert.match(paid[0].memo, /Airport: First Flight/); assert.match(paid[0].idem, /^play:/);
    const b = fly(S, ann, 'first-flight', 60);
    assert.ok(b.vc.paid < a.vc.paid, 'a repeat pays less');
    let n = 0, last;
    do { last = fly(S, ann, 'first-flight', 60); n++; } while (!last.vc.capped && n < 40);
    assert.equal(last.vc.capped, true, 'the daily cap stops the prizes');
    const w = S.play.winnings(ann.id);
    assert.equal(w.today, 3000); assert.equal(w.total, 3000); assert.equal(paid.reduce((x, p) => x + p.amount, 0), 3000);
    assert.equal(S.play.profile(ann.id).vc, 3000);
    assert.ok(S.play.profile(ann.id).recent.some(r => r.vc > 0));
    S.now.t += 86400e3 + 1000;
    assert.ok(fly(S, ann, 'first-flight', 60).vc.paid > 0, 'a day later it pays again');
    // no economy: runs still count, nothing is paid
    const off = setup({ rules: () => null, pay: () => assert.fail('paid with prizes off') });
    try { const bob = off.mk('bob', 'Bob'); const r = fly(off, bob, 'first-flight', 60); assert.equal(r.ok, true); assert.equal(r.vc.paid, 0); } finally { off.done(); }
    // a refused payment does not lose the run
    const bad = setup({ rules: () => PRIZE_DEFAULTS, pay: () => { throw new Error('The economy is paused.'); } });
    try { const cy = bad.mk('cy', 'Cy'); const r = fly(bad, cy, 'first-flight', 60); assert.equal(r.ok, true); assert.equal(r.vc.paid, 0); assert.match(r.vc.why, /paused/); assert.equal(bad.play.winnings(cy.id).total, 0); } finally { bad.done(); }
  } finally { S.done(); }
});
