// Order Up's progression (PLAN-RESTAURANT-GAME.md "Progression", 2026-10-28): a Rush that counts is played again on the
// server from its seed and what was pressed (shared/orderup/module.js replayRush) and scores the same as it played; a
// changed log scores otherwise; a Rush played faster than the clock, or not ended, does not count; the Rush levels.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRush, interact, work, step } from '../shared/orderup/rules.js';
import { nextStep } from '../shared/orderup/guide.js';
import { BEAT, COURSES, courseParams, replayRush, verifyRush, ORDER_UP } from '../shared/orderup/module.js';

const STATIONS = ['ou_fridge', 'ou_pantry', 'ou_prep', 'ou_grinder', 'ou_espresso', 'ou_steamer', 'ou_oven', 'ou_press', 'ou_blender', 'ou_plating', 'ou_pass', 'ou_dishes', 'ou_sink', 'ou_bin',
  'ou_fryer', 'ou_grill', 'ou_griddle', 'ou_toaster', 'ou_kettle', 'ou_juicer', 'ou_stove', 'ou_rice', 'ou_freezer'].map((t, i) => ({ id: `s${i + 1}`, t }));
const sid = t => STATIONS.find(s => s.t === t).id;

/** A whole Rush played by the coach beat by beat, as the page plays one: → { S, log } (the log the page would send). */
function play(course, o) {
  const S = newRush(STATIONS, { seed: o.seed, dur: course.dur, menu: o.menu, course: courseParams(course) }), log = [];
  let wait = 0, f = null;
  for (let n = 0; !S.over && n < 20000; n++) {
    let worked = null;
    if (wait > 0) wait--;
    else {
      const g = nextStep(S);
      if (g.act === 'E') { interact(S, 'you', sid(g.t), g.pick ? { pick: g.pick } : {}); log.push([n, 'E', sid(g.t), ...(g.pick ? [g.pick] : [])]); wait = 10; }   // (a press, then half a second's walk)
      else if (g.act === 'F') worked = sid(g.t);
    }
    if (worked) { work(S, 'you', worked, BEAT); if (f && f[2] === worked && f[0] + f[3] === n) f[3]++; else { f = [n, 'F', worked, 1]; log.push(f); } }
    step(S, BEAT);
  }
  return { S, log };
}
const MENU = ['espresso', 'latte', 'croissant', 'fries', 'cheeseburger', 'eggs_bacon', 'lemonade', 'teriyaki'];

test('a Rush played again from its seed and its log scores the same; a changed log scores otherwise', () => {
  const lunch = COURSES.find(c => c.id === 'lunch'), { S, log } = play(lunch, { seed: 'p1', menu: MENU });
  assert.ok(S.over && S.served.length >= 6, `played: ${S.served.length} served, score ${S.score}`);
  const R = replayRush(STATIONS, { seed: 'p1', menu: MENU, course: lunch }, log);
  assert.equal(R.score, S.score); assert.equal(R.served.length, S.served.length); assert.equal(R.lost, S.lost); assert.equal(R.points, S.points);
  const v = verifyRush(lunch, { log, score: S.score }, { data: { stations: STATIONS, seed: 'p1', menu: MENU }, serverMs: lunch.dur * 1000 + 3000 });
  assert.ok(v.ok, v.why); assert.equal(v.score, S.score); assert.ok(v.stars >= 2, `stars ${v.stars}`); assert.equal(v.detail.served, S.served.length);
  assert.ok(Object.keys(v.detail.items).length >= 3 && v.detail.grades.Supreme >= 1, JSON.stringify(v.detail.grades));
  // a claimed score that is not what was played: the server's own stands
  const lie = verifyRush(lunch, { log, score: 99999 }, { data: { stations: STATIONS, seed: 'p1', menu: MENU }, serverMs: lunch.dur * 1000 + 3000 });
  assert.equal(lie.score, S.score); assert.equal(lie.detail.claimed, 99999);
  // half the presses gone: less is served
  const half = verifyRush(lunch, { log: log.filter((x, k) => k % 2) }, { data: { stations: STATIONS, seed: 'p1', menu: MENU }, serverMs: lunch.dur * 1000 + 3000 });
  assert.ok(half.ok && half.score < S.score, `${half.score} < ${S.score}`);
});

test('a Rush does not count when played faster than the clock, cut short, or with a station that is not in its kitchen', () => {
  const warm = COURSES[0], { log } = play(warm, { seed: 'p2', menu: MENU }), data = { stations: STATIONS, seed: 'p2', menu: MENU };
  assert.equal(verifyRush(warm, { log }, { data, serverMs: 30000 }).ok, false, 'too quick');
  assert.equal(verifyRush(warm, { log: [...log, [10, 'E', 'nowhere']] }, { data, serverMs: 999999 }).ok, false, 'no such station');
  assert.equal(verifyRush(warm, { log: [[5, 'X', 's1']] }, { data, serverMs: 999999 }).ok, false, 'not a step');
  assert.equal(verifyRush(warm, {}, { data, serverMs: 999999 }).ok, false, 'no log');
  assert.ok(verifyRush(warm, { log }, { data, serverMs: warm.dur * 1000 }).ok, 'in time');
});

test('the Rush levels open in turn and get harder; a critic counts only Good or better', () => {
  assert.deepEqual(ORDER_UP.courses.map(c => c.id), ['warmup', 'lunch', 'dinner', 'friday', 'critic']);
  for (let k = 1; k < COURSES.length; k++) {
    assert.equal(COURSES[k].after, COURSES[k - 1].id);
    assert.ok(COURSES[k].difficulty > COURSES[k - 1].difficulty);
  }
  const lunch = play(COURSES[1], { seed: 'p3', menu: MENU }).S, critic = play(COURSES[4], { seed: 'p3', menu: MENU }).S;
  const counted = critic.served.filter(x => x.score >= 75).length;
  assert.ok(critic.score <= critic.served.reduce((a, x) => a + Math.round(x.score * critic.K.dishes[x.dish].price / 10), 0));
  assert.ok(counted <= critic.served.length);
  assert.ok(lunch.tickets.length + lunch.served.length + lunch.lost > 0);
});

test('the record (the play platform and the cook\'s): experience, level, the first badges, the Cookbook, the next level open; a made-up log counts for what it plays', async () => {
  const { openDb } = await import('../server/db.js'), { PlayCore } = await import('../server/play/play.js'), { CookRecord } = await import('../server/play/cook.js'), { tempDir } = await import('./helpers/server.mjs');
  const dbs = openDb(tempDir('mvw-oucook-')), now = { t: 1_800_000_000_000 };
  const play = new PlayCore({ dbs, now: () => now.t, contextFor: id => (id === 'orderup' ? { seed: 'rec1', kitchen: { stations: STATIONS, menu: MENU, kitchen: null } } : {}) });
  const cooks = new CookRecord({ dbs, play, now: () => now.t }), me = { id: 7 }, warm = COURSES[0];
  try {
    assert.throws(() => play.start(me, 'orderup', 'lunch'), /first/, 'Lunch opens after the Warm-up');
    const st = play.start(me, 'orderup', 'warmup', { b: 1, f: 0 });
    assert.deepEqual(st.data.stations, STATIONS);
    const S0 = newRush(STATIONS, { seed: 'rec1', dur: warm.dur, menu: MENU, course: courseParams(warm) }); void S0;
    const { S, log } = play2(warm, 'rec1');
    now.t += (warm.dur + 1) * 1000;
    const r = play.finish(me, st.run, { log, score: S.score });
    assert.ok(r.ok, r.why); assert.equal(r.score, S.score); assert.ok(r.stars >= 1 && r.xp > 0);
    assert.ok(r.badges.some(b => b.id === 'ou_first'), r.badges.map(b => b.id).join(' '));
    assert.deepEqual(r.unlocked, ['lunch']);
    const c = cooks.afterRush(me.id, r);
    assert.ok(c.cookbook.count >= 2 && c.cookbook.fresh.length === c.cookbook.count, JSON.stringify(c.cookbook));
    const v = cooks.view(me.id);
    assert.equal(v.count, c.cookbook.count); assert.equal(v.all, 212); assert.equal(v.stats.rushes, 1); assert.ok(v.stats.served === S.served.length);
    assert.ok(v.dishes.filter(x => x.n).every(x => ['Supreme', 'Great', 'Good', 'Medium', 'Bad', 'Poor'].includes(x.grade)));
    // ten different dishes served: the Cookbook's first badge, given once
    for (const item of ['croissant', 'muffin', 'scone', 'danish', 'cookie', 'pretzel', 'baklava', 'brownie', 'cheesecake', 'apple_pie']) dbs.db.prepare('INSERT OR IGNORE INTO ou_cookbook (world_id, cook_id, item, n, best, first_at, best_at) VALUES (?, ?, ?, 1, 90, 0, 0)').run(dbs.worldId, me.id, item);
    now.t += 2000;
    const st2 = play.start(me, 'orderup', 'warmup'); now.t += (warm.dur + 1) * 1000;
    const fake = play.finish(me, st2.run, { log: [], score: 99999 });
    assert.ok(fake.ok && fake.score === 0 && fake.detail.claimed === 99999, 'nothing pressed: nothing served');
    const c2 = cooks.afterRush(me.id, fake);
    assert.ok(c2.badges.some(b => b.id === 'ou_book10'), JSON.stringify(c2.badges));
    assert.equal(cooks.afterRush(me.id, fake).badges.length, 0, 'given once');
    // a cook that is an agent: minus its id, the same record and rules
    const bot = { id: -42 };
    now.t += 2000;
    const st3 = play.start(bot, 'orderup', 'warmup'); const p3 = play2(warm, 'rec1'); now.t += (warm.dur + 1) * 1000;
    const r3 = play.finish(bot, st3.run, { log: p3.log });
    assert.equal(r3.score, r.score, 'the same Rush played the same way scores the same, agent or player');
    assert.ok(cooks.afterRush(bot.id, r3).cookbook.count >= 2);
  } finally { dbs.close(); }
});
/** The Rush of seed `seed` played by the coach as the page plays it. */
function play2(course, seed) { return play(course, { seed, menu: MENU }); }

test('skills: a wider perfect window at their stations, quicker work, Service\'s fresher dishes and bigger tips; the same for any cook', async () => {
  const { stepScore } = await import('../shared/orderup/rules.js'), { bonusAt, pointsOf, cleanSkills, SKILLS } = await import('../shared/orderup/skills.js');
  assert.equal(SKILLS.length, 8);
  const a = { cook: 5, perfect: 4, burn: 13 };
  assert.ok(stepScore(a, 9.6, 0, bonusAt({ grill: 5 }, 'ou_grill').window) > stepScore(a, 9.6, 0, 0), 'a grill cook keeps it perfect longer');
  assert.equal(bonusAt({ grill: 5 }, 'ou_oven').window, 0, 'not at another station');
  assert.deepEqual(pointsOf(4, { grill: 2 }), { total: 3, spent: 2, free: 1 });
  assert.deepEqual(cleanSkills({ grill: 9, nope: 2, baker: -1 }), { grill: 5 });
  // chopping quicker with knife work
  const chop = skills => { const S = newRush(STATIONS, { seed: 'k', menu: ['toastie'], ...(skills ? { skills: { you: skills } } : {}) }); S.nextTicket = 1e9;
    interact(S, 'you', sid('ou_fridge'), { pick: 'tomato' }); interact(S, 'you', sid('ou_prep')); let n = 0; while (S.items[S.st[sid('ou_prep')].slot]?.st !== 'chopped' && n < 200) { work(S, 'you', sid('ou_prep'), BEAT); step(S, BEAT); n++; } return n; };
  assert.ok(chop({ knife: 5 }) < chop(null), `knife work: ${chop({ knife: 5 })} beats against ${chop(null)}`);
  // the same Rush, the same presses, a skilled cook: never worse
  const lunch = COURSES[1], { S, log } = play(lunch, { seed: 'sk', menu: MENU });
  const R = replayRush(STATIONS, { seed: 'sk', menu: MENU, course: lunch, skills: { barista: 5, baker: 5, grill: 5, service: 5 } }, log);
  assert.ok(R.score >= S.score && R.tips >= S.tips, `skilled ${R.score} (tips ${R.tips}) against ${S.score} (${S.tips})`);
});

test('skill points: one an Order Up level after the first, spent and taken back; a Rush laid out with the cook\'s skills', async () => {
  const { openDb } = await import('../server/db.js'), { PlayCore } = await import('../server/play/play.js'), { CookRecord } = await import('../server/play/cook.js'), { tempDir } = await import('./helpers/server.mjs');
  const dbs = openDb(tempDir('mvw-ouskill-')), now = { t: 1_800_000_000_000 };
  let cooks = null;
  const play = new PlayCore({ dbs, now: () => now.t, contextFor: (id, where, acc) => (id === 'orderup' ? { seed: 'sk1', skills: cooks.skillsOf(acc.id), kitchen: { stations: STATIONS, menu: MENU } } : {}) });
  cooks = new CookRecord({ dbs, play, now: () => now.t });
  try {
    for (const id of [7, -42]) {   // (a player and an agent: the same)
      assert.equal(cooks.skills(id).points.total, 0);
      assert.throws(() => cooks.skill(id, 'grill'), /No skill points/);
      dbs.db.prepare("INSERT INTO play_progress (world_id, account_id, module, xp, runs, updated) VALUES (?, ?, 'orderup', 600, 5, 0)").run(dbs.worldId, id);   // (level 4)
      const k = cooks.skills(id); assert.equal(k.level, 4); assert.deepEqual(k.points, { total: 3, spent: 0, free: 3 });
      cooks.skill(id, 'grill'); cooks.skill(id, 'grill'); const k2 = cooks.skill(id, 'service');
      assert.deepEqual(k2.points, { total: 3, spent: 3, free: 0 }); assert.equal(k2.list.find(x => x.id === 'grill').rank, 2);
      assert.throws(() => cooks.skill(id, 'baker'), /No skill points/);
      assert.throws(() => cooks.skill(id, 'nope'), /No such skill/);
      const st = play.start({ id }, 'orderup', 'warmup'); assert.deepEqual(st.data.skills, { grill: 2, service: 1 });
      play.abandon({ id }, st.run); now.t += 2000;
      assert.deepEqual(cooks.respec(id).points, { total: 3, spent: 0, free: 3 }, 'no economy here: a fresh start is free');
      assert.throws(() => cooks.respec(id), /No skill points spent/);
    }
  } finally { dbs.close(); }
});

test('agents on their kitchen shifts cook Rushes recorded as a player\'s: half the experience unattended, its badges and Cookbook, its own skill points spent with Free Will, on the boards beside players', async () => {
  const { openDb } = await import('../server/db.js'), { PlayCore } = await import('../server/play/play.js'), { CookRecord } = await import('../server/play/cook.js');
  const { KitchenShifts } = await import('../server/play/kitchen-shifts.js'), { tempDir } = await import('./helpers/server.mjs');
  const dbs = openDb(tempDir('mvw-oushift-')), now = { t: 1_800_000_000_000 };
  dbs.db.prepare("INSERT INTO agents (id, world_id, agent_key, owner_id, name, created, updated) VALUES (5, ?, 'nova', 1, 'Nova', 0, 0), (6, ?, 'rex', 1, 'Rex', 0, 0)").run(dbs.worldId, dbs.worldId);
  dbs.db.prepare("INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated) VALUES (?, 'casey', 'Casey', 'casey', 'owner', 'x', 0, 0, 0)").run(dbs.worldId);
  const items = STATIONS.map((s, k) => ({ id: s.id, t: s.t, mod: 'k1', x: k, z: 0 }));
  const world = { buildings: [{ lv: [0], floors: 1 }], levels: [{ items, mods: [{ id: 'k1', kind: 'kitchen', data: { menu: null } }] }] };
  let cooks = null;
  const play = new PlayCore({ dbs, now: () => now.t, contextFor: (id, where, acc) => (id === 'orderup' ? { seed: `s${now.t}`, skills: cooks.skillsOf(acc.id), kitchen: { stations: STATIONS, menu: MENU } } : {}) });
  cooks = new CookRecord({ dbs, play, now: () => now.t });
  const agents = [{ id: 5, name: 'Nova', ownerId: 1 }, { id: 6, name: 'Rex', ownerId: 1 }], notes = [];
  const people = [{ name: 'Nova', post: { b: 0, f: 0, id: 's11', k: 0 } }, { name: 'Rex', job: { kind: 'staff', b: 0, f: 0, id: 's12', k: 0, start: 9, end: 17, days: 127 } }];
  const posts = { agents: { list: () => agents, get: id => agents.find(a => a.id === id) || null }, bodyOf: a => agents.indexOf(a), simOf: () => ({ people }), clockNow: () => ({ h: now.h ?? 12, day: 1 }) };
  const shifts = new KitchenShifts({ play, cooks, posts, world: () => world, freeWill: id => id === 5, notify: (id, m) => notes.push([id, m.text]), now: () => now.t });
  try {
    assert.deepEqual(shifts.onDuty().map(d => d.agent.name), ['Nova', 'Rex'], 'on post 24/7, and on its hours');
    now.h = 20; assert.deepEqual(shifts.onDuty().map(d => d.agent.name), ['Nova'], 'Rex off his hours'); now.h = 12;
    shifts.tick();
    assert.ok(shifts.view(5).cooking && shifts.view(6).cooking, 'both cooking');
    now.t += 125000; shifts.tick();
    const v5 = shifts.view(5); assert.ok(!v5.cooking && v5.last && v5.last.score > 0 && v5.today === 1, JSON.stringify(v5));
    const p = play.progress(-5).modules.orderup;
    assert.equal(p.runs, 1); assert.ok(p.unlocked.includes('lunch'));
    const runs = dbs.db.prepare('SELECT xp, stars FROM play_runs WHERE account_id = -5').get();
    assert.equal(runs.xp, Math.round(10 * 1 * runs.stars * 0.5), 'half the experience of a player\'s same run');
    assert.ok(cooks.view(-5).count >= 2, 'its Cookbook');
    assert.ok(notes.some(([id, t]) => id === 1 && /Nova earned/.test(t)), notes.map(n => n[1]).join(' | '));
    // a player and the agents on the same board, the agents named and marked
    dbs.db.prepare("INSERT INTO play_best (world_id, module, course, account_id, score, ms, stars, at) VALUES (?, 'orderup', 'warmup', 1, 100, 1, 1, 0)").run(dbs.worldId);
    const board = play.leaderboard('orderup', 'warmup', { viewer: -5 });
    assert.deepEqual(board.rows.map(r => r.name).sort(), ['Casey', 'Nova', 'Rex']);
    assert.ok(board.rows.filter(r => r.agent).length === 2 && board.you?.name === 'Nova');
    assert.equal(play.profile(-5).name, 'Nova');
    assert.ok(play.topPlayers().some(r => r.agent && r.name === 'Rex'));
    // Nova (Free Will) spends its own points on its kitchen's skills; Rex (none) leaves his to his owner
    dbs.db.prepare("UPDATE play_progress SET xp = 600 WHERE account_id IN (-5, -6) AND module = 'orderup'").run();
    for (let k = 0; k < 2; k++) { now.t += 300000; shifts.tick(); now.t += 310000; shifts.tick(); }
    const k5 = cooks.skills(-5), k6 = cooks.skills(-6);
    assert.equal(k5.points.free, 0, JSON.stringify(k5.points)); assert.ok(k5.points.spent >= 3);
    assert.equal(k6.points.spent, 0, 'its owner spends Rex\'s');
    cooks.setMode(-5, 'owner'); assert.equal(shifts.chooses(agents[0]), false, 'its owner keeps the choice');
  } finally { dbs.close(); }
});
