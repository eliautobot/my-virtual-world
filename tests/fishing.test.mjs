// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing game's rules (docs/features/fishing.md): the fish (every species sound, sizes and weights, values), the
// fight (a good angler lands what the gear is made for in a sensible time; the gear gates the giants; the server's
// fastest-fight bound is never above what a good angler takes), the trip (grounds where the water suits them, the same
// for the same seed; bites that suit the lure; the legend only in its hour; bounties; the sale), and the module through
// the play core (the server rolls the fish and keeps the catch; a landing too fast is refused; the score is the sale).
import assert from 'node:assert/strict';
import test from 'node:test';
import { SPECIES, FINDS, RARITY, weightAt, lengthAt, fishOf, valueOf, sizeOf, slotsFor, speciesOf } from '../shared/fish-species.js';
import { LURES, LURE_BY_ID, RODS, REELS, LINES, loadout, BOAT_UPGRADES, STARTER } from '../shared/fishing-gear.js';
import { fightSetup, fightStep, botInput, minFightSeconds, MAX_FIGHT_S } from '../shared/fishing-fight.js';
import { TRIPS, GROUNDS, OPEN, groundSites, generateTrip, rollBite, population, biteEvery, bountiesMet, tripValue, freshness, activity } from '../shared/fishing-trip.js';
import { FISHING, coolerUsed, HOOK_GAP_MS } from '../shared/fishing.js';
import { RNG } from '../shared/rng.js';
import { courseOf } from '../shared/play.js';

const HABITATS = new Set([...Object.values(GROUNDS).flatMap(g => g.hab), ...OPEN.sea, ...OPEN.lake]);
const KITS = {
  starter: loadout({}),
  glass: loadout({ rod: 'rod_glass', reel: 'reel_spin', line: 'line_mono15' }),
  graphite: loadout({ rod: 'rod_graphite', reel: 'reel_bait', line: 'line_braid30' }),
  carbon: loadout({ rod: 'rod_carbon', reel: 'reel_biggame', line: 'line_braid65' }),
  legend: loadout({ rod: 'rod_legend', reel: 'reel_trophy', line: 'line_legend', skills: { fighting: 5 } }),
};
function fight(sp, f, L, seed, skill = 1) {
  const F = fightSetup(sp, f, L, { d0: L.reach * 0.8, seed });
  while (!F.out) fightStep(F, botInput(F, skill));
  return F;
}

test('every species is sound: water, habitats, lures, sizes, looks; legends and finds', () => {
  const ids = new Set();
  assert.ok(SPECIES.filter(s => s.water === 'sea' && !s.legend).length >= 45 && SPECIES.filter(s => s.water === 'lake' && !s.legend).length >= 30, 'a wide range of fish');
  for (const s of SPECIES) {
    assert.ok(!ids.has(s.id), `${s.id} once`); ids.add(s.id);
    assert.ok(['sea', 'lake'].includes(s.water) && RARITY[s.rarity], s.id);
    for (const h of s.hab) assert.ok(HABITATS.has(h), `${s.id}: habitat ${h} is held by some ground`);
    for (const l of s.lures) assert.ok(LURE_BY_ID[l], `${s.id}: lure ${l}`);
    assert.ok(s.lures.some(l => LURE_BY_ID[l].water === 'both' || LURE_BY_ID[l].water === s.water), `${s.id}: a lure sold on its water`);
    assert.ok(s.len[0] > 0 && s.len[1] > s.len[0] && s.K > 0 && s.val > 0 && s.act.length === 4, s.id);
    assert.ok(s.body.cols.length === 4 && s.body.cols.every(c => /^#[0-9a-f]{6}$/.test(c)), `${s.id}: its colours`);
    const big = weightAt(s, s.len[1]);
    assert.ok(big < 700, `${s.id}: at most ${big.toFixed(0)} kg`);
  }
  assert.equal(SPECIES.filter(s => s.legend).length, 6);
  for (const f of FINDS) assert.ok(f.w > 0 && f.val >= 0);
});

test('sizes, weights and values: bigger is heavier and worth more; size classes and cooler slots', () => {
  const s = speciesOf('redsnapper');
  assert.ok(lengthAt(s, 0) === s.len[0] && Math.abs(lengthAt(s, 1) - s.len[1]) < 1e-9);
  const a = fishOf(s, 0.2), b = fishOf(s, 0.9);
  assert.ok(b.cm > a.cm && b.kg > a.kg);
  assert.ok(valueOf(s, b.kg, b.u) > valueOf(s, a.kg, a.u) * 2, 'a big one is worth much more');
  assert.equal(sizeOf(0.1).id, 'small'); assert.equal(sizeOf(0.5).id, 'medium'); assert.equal(sizeOf(0.8).id, 'large'); assert.equal(sizeOf(0.96).id, 'trophy');
  assert.deepEqual([0.5, 2, 9, 30, 120, 300].map(slotsFor), [1, 1, 2, 3, 4, 6]);
  assert.ok(valueOf(s, b.kg, b.u, 0.5) < valueOf(s, b.kg, b.u, 1), 'a spoiled catch sells for less');
  const red = fishOf(s, 0.5); assert.ok(Math.abs(valueOf(s, red.kg, 0.5) / 1.15 - s.val) / s.val < 0.25, 'val is a middling fish\'s price');
});

test('gear: tiers get better and dearer; the loadout from a kit; skills', () => {
  for (const list of [RODS, REELS, LINES]) for (let i = 1; i < list.length; i++) assert.ok(list[i].price > list[i - 1].price && list[i].level >= list[i - 1].level, list[i].id);
  for (let i = 1; i < RODS.length; i++) assert.ok(RODS[i].reach > RODS[i - 1].reach && RODS[i].power > RODS[i - 1].power && RODS[i].maxKg > RODS[i - 1].maxKg);
  for (const u of BOAT_UPGRADES) assert.equal(u.tiers.length, 4);
  const L = loadout({}), S = loadout({ ...STARTER, skills: { casting: 5, trader: 5, luck: 2 } });
  assert.ok(S.reach > L.reach && S.trader > 0 && S.luck > 0);
  assert.equal(L.drag, Math.min(REELS[0].drag, 0.6 * LINES[0].kgf), 'the drag gives line before the line breaks');
  assert.equal(L.boat.cooler, 12);
});

test('the fight: a good angler lands what the gear is made for, in a sensible time; the gear gates the giants', () => {
  const cases = [['bluegill', 0.5, 'starter', 5, 20], ['largemouth', 0.6, 'starter', 6, 45], ['redsnapper', 0.5, 'glass', 8, 40], ['snook', 0.6, 'graphite', 8, 50],
    ['yellowfin', 0.5, 'carbon', 15, 90], ['bluemarlin', 0.5, 'legend', 20, 120], ['oldgoliath', 0.5, 'legend', 40, 200]];
  for (const [id, u, kit, lo, hi] of cases) {
    const sp = speciesOf(id), f = fishOf(sp, u), L = KITS[kit];
    let landed = 0, t = 0;
    for (let i = 0; i < 6; i++) { const F = fight(sp, f, L, 100 + i); if (F.out === 'landed') { landed++; t += F.t; assert.ok(F.t >= minFightSeconds(sp, f.kg, L, L.reach * 0.8), `${id}: no faster than the server's bound`); } }
    assert.ok(landed >= 5, `${id} on ${kit}: landed ${landed}/6`);
    assert.ok(t / landed >= lo && t / landed <= hi, `${id} on ${kit}: ${(t / landed).toFixed(0)} s (want ${lo}–${hi})`);
  }
  for (const [id, kit] of [['yellowfin', 'starter'], ['bluemarlin', 'graphite'], ['goliath', 'glass']]) {
    const sp = speciesOf(id), f = fishOf(sp, 0.5);
    for (let i = 0; i < 4; i++) assert.notEqual(fight(sp, f, KITS[kit], 200 + i).out, 'landed', `${id} beats ${kit} gear`);
  }
});

test('the fight: the line snaps on a jump not bowed to at full tension; slack throws the hook; it is deterministic', () => {
  const sp = speciesOf('tarpon'), f = fishOf(sp, 0.3), L = KITS.graphite;
  const runs = s => { const F = fightSetup(sp, f, L, { seed: 5 }); let k = 0; while (!F.out && k++ < 30 * 400) fightStep(F, s(F)); return F; };
  const a = runs(F => botInput(F)), b = runs(F => botInput(F));
  assert.equal(a.out, b.out); assert.equal(a.t, b.t);
  let snaps = 0, spat = 0;
  for (let i = 0; i < 20; i++) {
    const F = fightSetup(sp, f, L, { seed: 300 + i });
    while (!F.out) fightStep(F, { reel: true, steer: F.dir ? -F.dir : 0 });   // never eases, never bows
    if (F.out === 'snap') snaps++;
    const G = fightSetup(speciesOf('largemouth'), fishOf(speciesOf('largemouth'), 0.5), KITS.starter, { seed: 400 + i });
    while (!G.out) fightStep(G, {});                                            // never reels
    if (G.out === 'spat') spat++;
  }
  assert.ok(snaps >= 8, `reeling hard through every jump snaps the line (${snaps}/20)`);
  assert.ok(spat >= 15, `a slack line throws the hook (${spat}/20)`);
  assert.ok(MAX_FIGHT_S >= 200);
});

// a coast: land west of x = 0, the bed falling east — flats, reefs, a drop-off at 1500 m, the blue beyond
const seaDepth = (x, z) => (x <= 0 ? 0 : x < 1500 ? 0.4 + x * 0.016 + (x > 400 ? 3 * Math.sin(z / 70) : 0) : x < 1700 ? 25 + (x - 1500) * 0.4 : 105 + (x - 1700) * 0.05);
const lakeDepth = (x, z) => { const r = Math.hypot(x, z); return r < 220 ? 9 * (1 - (r / 220) ** 2) + 0.3 : 0; };
const SEA_ENV = { water: 'sea', depthAt: seaDepth, dock: { x: 10, z: 0 }, reach: 4500 };
const LAKE_ENV = { water: 'lake', depthAt: lakeDepth, dock: { x: -200, z: 0 }, reach: 0, area: { x0: -240, z0: -240, x1: 240, z1: 240 } };

test('a trip\'s grounds: where the water suits them, apart, the same for the same seed', () => {
  const seaSites = groundSites(SEA_ENV), lakeSites = groundSites(LAKE_ENV);
  assert.ok(seaSites.length > 200 && lakeSites.length > 100);
  for (const trip of TRIPS) {
    const sites = trip.water === 'sea' ? seaSites : lakeSites, depth = trip.water === 'sea' ? seaDepth : lakeDepth;
    const plan = generateTrip(trip, 42, sites), again = generateTrip(trip, 42, sites), other = generateTrip(trip, 43, sites);
    assert.deepEqual(plan, again, `${trip.id}: the same seed, the same trip`);
    assert.notDeepEqual(plan.grounds.map(g => [g.x, g.z]), other.grounds.map(g => [g.x, g.z]), `${trip.id}: another seed, other grounds`);
    assert.ok(plan.grounds.length >= trip.grounds[0] - 1, `${trip.id}: ${plan.grounds.length} grounds`);
    for (const g of plan.grounds) {
      assert.ok(trip.kinds.includes(g.kind) && depth(g.x, g.z) > 0.4, `${trip.id}: ${g.kind} on water`);
      const G = GROUNDS[g.kind];
      if (trip.water === 'sea' && G.depth) assert.ok(g.d >= G.depth[0] && g.d <= G.depth[1], `${g.kind} at ${g.d} m`);
      assert.ok(g.pop.length >= 2, `${trip.id} ${g.kind}: fish live there (${g.pop.length})`);
      if (trip.water === 'sea') assert.ok(Math.hypot(g.x - SEA_ENV.dock.x, g.z) <= trip.reach + 1, 'within reach');
    }
    for (let i = 0; i < plan.grounds.length; i++) for (let j = i + 1; j < plan.grounds.length; j++) assert.ok(Math.hypot(plan.grounds[i].x - plan.grounds[j].x, plan.grounds[i].z - plan.grounds[j].z) > 20, 'grounds apart');
    assert.ok(plan.bounties.length >= 2);
  }
  const blue = generateTrip(TRIPS.find(t => t.id === 'blue-water'), 7, seaSites);
  assert.ok(blue.grounds.some(g => g.kind === 'blue' && g.x > 1500), 'the blue water is out past the drop-off');
});

test('what bites: it takes the lure; harder trips bring rarer and bigger fish; the legend only in its hour', () => {
  const sites = groundSites(SEA_ENV), plan = generateTrip(TRIPS[1], 9, sites), reef = plan.grounds.find(g => g.kind === 'reef') || plan.grounds[0];
  const rng = new RNG('t'), counts = {};
  for (let i = 0; i < 400; i++) { const b = rollBite(rng, reef, { lure: 'shrimp', hour: 7, difficulty: 3, water: 'sea' }); if (b?.kind === 'fish') counts[b.species] = (counts[b.species] || 0) + 1; }
  const takes = Object.entries(counts).filter(([id]) => speciesOf(id).lures.includes('shrimp')).reduce((a, e) => a + e[1], 0), all = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.ok(takes / all > 0.85, `most bites take the lure (${takes}/${all})`);
  const rare = d => { const r = new RNG(`d${d}`), pop = population(['reef', 'rocks', 'wreck', 'drop'], 'sea', d); let n = 0, kg = 0; for (let i = 0; i < 600; i++) { const b = rollBite(r, { id: 'x', kind: 'reef', pop, fish: 99 }, { lure: 'livebait', hour: 12, difficulty: d, water: 'sea', size: TRIPS.find(t => t.difficulty === d && t.water === 'sea')?.size || 0 }); if (b?.species) { if (['rare', 'epic'].includes(speciesOf(b.species).rarity)) n++; kg += b.u; } } return [n, kg]; };
  const [r1, u1] = rare(1), [r8, u8] = rare(8);
  assert.ok(r8 > r1 * 1.5 && u8 > u1 * 1.15, `rarer (${r1} → ${r8}) and bigger (${u1.toFixed(0)} → ${u8.toFixed(0)}) on harder trips`);
  const g = { id: 'g1', kind: 'wreck', pop: population(GROUNDS.wreck.hab, 'sea', 10), fish: 99, legend: 'oldgoliath' }, legend = { species: 'oldgoliath', ground: 'g1', from: 5, to: 9 };
  let inHour = 0, outHour = 0;
  for (let i = 0; i < 300; i++) {
    const r = new RNG(`L${i}`);
    if (rollBite(r, g, { lure: 'livebait', hour: 20, difficulty: 10, water: 'sea', minute: 7, legend })?.species === 'oldgoliath') inHour++;
    if (rollBite(new RNG(`M${i}`), g, { lure: 'livebait', hour: 20, difficulty: 10, water: 'sea', minute: 12, legend })?.species === 'oldgoliath') outHour++;
  }
  assert.ok(inHour > 20 && outHour === 0, `the legend bites only while it is about (${inHour} / ${outHour})`);
  assert.ok(activity(speciesOf('walleye'), 22) > activity(speciesOf('walleye'), 13), 'walleye feed at night');
  assert.ok(biteEvery(reef, 'shrimp', 7, 'sea') < biteEvery(null, 'shrimp', 7, 'sea'), 'a ground bites sooner than open water');
  assert.ok(biteEvery(reef, 'shrimp', 7, 'sea') < biteEvery(reef, 'topwater', 7, 'sea'), 'a lure the reef fish take bites sooner');
});

test('bounties, freshness and the sale', () => {
  const plan = { bounties: [{ id: 'b1', kind: 'count', n: 2, reward: 10 }, { id: 'b2', kind: 'size', species: 'redsnapper', cm: 60, reward: 15 }, { id: 'b3', kind: 'ground', n: 3, reward: 5 }] };
  const s = speciesOf('redsnapper'), big = fishOf(s, 0.8), small = fishOf(speciesOf('grunt'), 0.4);
  const caught = [{ ...big, ground: 'g1', kept: true }, { ...small, ground: 'g2', kept: true }, { ...small, ground: 'g2', kept: false }];
  assert.deepEqual(bountiesMet(plan.bounties, caught), ['b1', 'b2']);
  const v = tripValue(TRIPS[1], plan, caught), late = tripValue(TRIPS[1], plan, caught, { lateMin: 10 }), lit = tripValue(TRIPS[1], plan, caught, { lateMin: 10, boat: { lights: 10 } });
  assert.equal(v.fish, 2); assert.equal(v.bonus, 25);
  assert.ok(late.score < v.score && lit.score === v.score, 'late home spoils the catch; deck lights buy the time');
  assert.ok(tripValue(TRIPS[1], plan, caught, { trader: 0.15 }).sale > v.sale);
  assert.ok(freshness(100) >= 0.3 && freshness(5, { livewell: 90 }) > freshness(5));
});

/** A play core over a temporary database, with the fishing module's context (the coast above). */
async function core() {
  const { openDb } = await import('../server/db.js'), { PlayCore } = await import('../server/play/play.js');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvw-fish-')), dbs = openDb(dir), now = { t: 1e12 };
  const t0 = Date.now(), id = Number(dbs.db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
    VALUES (?, 'angler', 'Angler', 'angler', 'member', 'x', ?, ?, ?)`).run(dbs.worldId, t0, t0, t0).lastInsertRowid);
  const sites = groundSites(SEA_ENV);
  const play = new PlayCore({ dbs, now: () => now.t, contextFor: id => (id === 'fishing' ? { dock: { id: 'wm1', kind: 'marina', x: 10, z: 0 }, water: 'sea', sites, clock: { hour0: 7, perMin: 0.05 }, kit: { lures: { shrimp: 30, cutbait: 10, livebait: 8, jig: 2 }, rod: 'rod_carbon', reel: 'reel_biggame', line: 'line_braid65' }, seed: 11 } : {}) });
  const other = Number(dbs.db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
    VALUES (?, 'rival', 'Rival', 'rival', 'member', 'x', ?, ?, ?)`).run(dbs.worldId, t0, t0, t0).lastInsertRowid);
  return { play, now, dbs, account: { id }, other: { id: other }, cleanup: () => { dbs.close?.(); fs.rmSync(dir, { recursive: true, force: true }); } };
}
/** Lands every fish it can on a trip of the core (each no sooner than its fight allows) and weighs it in. */
function fishTrip(play, now, account, { lure = 'shrimp', bites = 6 } = {}) {
  now.t += 5000;
  const st = play.start(account, 'fishing', 'harbour-morning', { dock: 'wm1' }), g = st.data.plan.grounds[0];
  for (let k = 0, got = 0; k < 40 && got < bites; k++) {
    now.t += 4000;
    const b = play.act(account, st.run, 'hook', { ground: g.id, lure, d0: 20 }); if (!b.hook) continue;
    now.t += 90_000; play.act(account, st.run, 'land', { hook: b.hook }); got++;
  }
  return { run: play.runs.get(st.run), res: play.finish(account, st.run, {}) };
}

test('a trip through the play core: the server rolls the fish, refuses a landing too fast, keeps the catch and scores the sale', async () => {
  const { play, now, account, cleanup } = await core();
  try {
    assert.equal(courseOf(FISHING, 'reef-run').after, 'harbour-morning');
    const st = play.start(account, 'fishing', 'harbour-morning', { dock: 'wm1' });
    assert.ok(st.data.plan.grounds.length >= 5 && !('state' in st) && !JSON.stringify(st).includes('secret'), 'the browser gets the plan, not the server\'s dice');
    const run = play.runs.get(st.run), g = st.data.plan.grounds[0];
    assert.throws(() => play.act(account, st.run, 'hook', { ground: g.id, lure: 'topwater' }), /none of those|no Topwater Popper left|Not a lure/);
    now.t += 5000;
    let h = play.act(account, st.run, 'hook', { ground: g.id, lure: 'shrimp', d0: 20 });
    while (!h.hook) { now.t += HOOK_GAP_MS; h = play.act(account, st.run, 'hook', { ground: g.id, lure: 'shrimp', d0: 20 }); }
    assert.equal(h.left, 29, 'the fish took the bait: one shrimp fewer');
    let bites = 1;
    assert.throws(() => play.act(account, st.run, 'hook', { ground: g.id, lure: 'shrimp' }), /Too quick/);
    now.t += 200;
    assert.throws(() => play.act(account, st.run, 'land', { hook: h.hook }), /too fast/, 'a landing sooner than the fastest fight is refused');
    let landed = 0;
    for (let k = 0; k < 12 && coolerUsed(run.state.caught) < 10; k++) {
      now.t += 4000;
      const b = play.act(account, st.run, 'hook', { ground: g.id, lure: 'shrimp', d0: 20 }); if (!b.hook) continue;
      bites++; assert.equal(b.left, 30 - bites);
      now.t += 90_000;
      const r = play.act(account, st.run, 'land', { hook: b.hook });
      assert.ok(r.caught && r.cooler.used <= r.cooler.size); landed++;
    }
    assert.ok(landed >= 3);
    // a lure is used again and again — lost only to a snapped line
    let j = null;
    for (let k = 0; k < 20 && !j?.hook; k++) { now.t += 4000; j = play.act(account, st.run, 'hook', { ground: g.id, lure: 'jig', d0: 20 }); }
    if (j?.hook) {
      assert.equal(j.left, 2, 'a jig isn\'t used up by a bite');
      assert.equal(play.act(account, st.run, 'lose', { hook: j.hook, why: 'snap' }).left, 1, 'the line snapped: the jig is gone');
    }
    assert.equal(run.state.used.shrimp, bites, 'every bite used a shrimp');
    const first = run.state.caught.find(c => c.kept);
    play.act(account, st.run, 'release', { n: first.n });
    assert.equal(run.state.released, 1);
    const res = play.finish(account, st.run, {});
    assert.ok(res.ok && res.score > 0 && res.xp > 0, `scored ${res.score}`);
    assert.equal(res.score, Math.round(tripValue(courseOf(FISHING, 'harbour-morning'), st.data.plan, run.state.caught, { lateMin: Math.max(0, (now.t - run.at) / 60000 - 12), boat: { cooler: 20 } }).score * 100) / 100);
    assert.ok(res.badges.some(b => b.id === 'first_catch'));
    assert.throws(() => play.act(account, st.run, 'hook', { lure: 'shrimp' }), /ended/);
  } finally { cleanup(); }
});

test('the Fishdex and the world records: every species landed counts (kept or let go), the biggest of each is the world\'s, badges for both', async () => {
  const { play, now, dbs, account, other, cleanup } = await core();
  try {
    const { Angler } = await import('../server/play/angler.js');
    const market = { q: { run: dbs.db.prepare("SELECT id, course, detail, at FROM play_runs WHERE world_id = ? AND account_id = ? AND id = ? AND module = 'fishing'") }, storeAt: () => null };
    const A = new Angler({ dbs, economy: () => null, play, market });
    const t1 = fishTrip(play, now, account);
    const landed = new Map();
    for (const c of t1.run.state.caught) if (c.species) landed.set(c.species, Math.max(landed.get(c.species) || 0, c.kg));
    assert.ok(landed.size >= 1, 'something landed');
    const after = A.afterTrip(account, t1.res);
    assert.deepEqual(new Set(after.dex.fresh), new Set(landed.keys()), 'each species new to the Fishdex');
    assert.equal(after.dex.count, landed.size);
    assert.equal(after.records.length, landed.size, 'the first of each: a world record');
    assert.ok(after.badges.some(b => b.id === 'record_breaker'), 'and the badge for it');
    const D = A.dex(account);
    for (const [sp, kg] of landed) { assert.equal(D.mine[sp].kg, kg, `${sp}: the biggest`); assert.ok(D.records[sp].mine); }
    // the same trip again: not counted twice
    assert.equal(A.afterTrip(account, t1.res), null);
    assert.deepEqual(A.dex(account).mine, D.mine);
    // a rival lands more: their bigger fish take the records over; ours stay where they're bigger
    now.t += 2000;
    const t2 = fishTrip(play, now, other, { bites: 10 }), a2 = A.afterTrip(other, t2.res), D2 = A.dex(other);
    for (const r of a2.records) {
      const mine = landed.get(r.species);
      assert.ok(mine === undefined || r.kg > mine, `${r.species}: a record only over the one before`);
      assert.equal(D2.records[r.species].name, 'Rival');
    }
    for (const [sp, kg] of landed) { const rec = A.dex(account).records[sp]; assert.equal(rec.mine, rec.kg === kg && kg >= (D2.mine[sp]?.kg || 0)); }
    // the Fishdex badges by count (given once)
    assert.ok(!a2.badges.some(b => b.id === 'fishdex_10') || A.dex(other).count >= 10);
    assert.deepEqual(play.grant(account.id, 'fishing', ['fishdex_10', 'nonsense']).map(b => b.id), ['fishdex_10'], 'only a module\'s own badges');
    assert.deepEqual(play.grant(account.id, 'fishing', ['fishdex_10']), [], 'once');
  } finally { cleanup(); }
});

test('Night owl: a fish landed after dusk', () => {
  const b = FISHING.badges.find(x => x.id === 'night_owl');
  assert.ok(b.when({}, { detail: { night: 1 } }) && !b.when({}, { detail: { night: 0 } }));
  for (const id of ['fishdex_10', 'fishdex_25', 'fishdex_50', 'fishdex_all', 'record_breaker', 'gentle_hands']) assert.ok(FISHING.badges.find(x => x.id === id)?.granted, `${id} is given by the angler's records`);
});

test('the fight is a minute\'s fun, not four: bounded, a fish too heavy for the rod breaks off quickly, and a well-played landing is never faster than the server allows', async () => {
  const { HEAVY_S } = await import('../shared/fishing-fight.js');
  const { kitFor } = await import('../shared/fishing.js');
  const L = kitFor(STARTER, 'sea'), times = [];
  let heavy = 0, under = [];
  for (const sp of SPECIES.filter(s => s.water === 'sea' && !s.legend)) for (const u of [0.2, 0.5, 0.8, 0.98]) {
    const f = fishOf(sp, u), F = fightSetup(sp, { kg: f.kg }, L, { d0: 20, seed: 9 + Math.round(u * 100) });
    while (!F.out) fightStep(F, botInput(F, 1));
    if (F.heavy) { heavy++; assert.ok(F.out !== 'landed' && F.t <= HEAVY_S + 0.1, `${sp.id} ${f.kg} kg on a starter rod: off within ${HEAVY_S} s (${F.t.toFixed(0)} s, ${F.out})`); continue; }
    times.push(F.t);
    if (F.out === 'landed' && F.t < minFightSeconds(sp, f.kg, L, 20)) under.push(`${sp.id} ${f.kg} kg ${F.t.toFixed(1)} s < ${minFightSeconds(sp, f.kg, L, 20).toFixed(1)} s`);
  }
  assert.ok(heavy > 5, 'some sea fish are too heavy for the starter rod');
  assert.deepEqual(under, [], 'never landed sooner than the server allows');
  times.sort((a, b) => a - b);
  assert.ok(times[Math.floor(times.length / 2)] < 30 && times.at(-1) < 150, `fights: median ${times[Math.floor(times.length / 2)].toFixed(0)} s, longest ${times.at(-1).toFixed(0)} s`);
});

test('a fish too heavy for the angler\'s rod usually comes up smaller (the roll knows the rod)', () => {
  const g = generateTrip(TRIPS.find(t => t.id === 'harbour-morning'), 3, groundSites(SEA_ENV)).grounds.find(x => !x.hidden);
  let over = 0, overWith = 0;
  for (let k = 0; k < 600; k++) {
    const ctx = { lure: 'shrimp', hour: 8, difficulty: 1, water: 'sea', size: 0 };
    const a = rollBite(new RNG(`h:${k}`), g, ctx), b = rollBite(new RNG(`h:${k}`), g, { ...ctx, maxKg: 8 });
    if (a?.kg > 8) over++; if (b?.kg > 8) overWith++;
  }
  assert.ok(over > 20 && overWith < over * 0.6, `over the rod: ${over} without, ${overWith} with the rod known`);
});
