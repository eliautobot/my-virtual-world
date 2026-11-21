// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Play in an agent's senses (server/senses/play-activities.js, docs/features/awareness.md §5): the card for the run a
// player (or an agent, as −its id) is in — fishing from the run's own state, Order Up, the arcade and the airport from
// the moments their pages report, an agent's own kitchen shift from its clock, any other module in a line — and what is
// worth noticing in the diaries (noteNear for a player, note for an agent's own run). The play core's moments: checked by
// the module, only the run's own account, a few at a time.
import assert from 'node:assert/strict';
import test from 'node:test';
import { openDb } from '../server/db.js';
import { PlayCore, PlayError } from '../server/play/play.js';
import { Activities } from '../server/senses/activities.js';
import { registerPlayActivities, catchWords, kgWords, placeOf, fishName, STALE_MS } from '../server/senses/play-activities.js';
import { groundSites } from '../shared/fishing-trip.js';
import { HOOK_GAP_MS } from '../shared/fishing.js';
import { registerPlay } from '../shared/play.js';
import { tempDir } from './helpers/server.mjs';

const seaDepth = (x, z) => (x <= 0 ? 0 : x < 1500 ? 0.4 + x * 0.016 + (x > 400 ? 3 * Math.sin(z / 70) : 0) : x < 1700 ? 25 + (x - 1500) * 0.4 : 105 + (x - 1700) * 0.05);
const SITES = groundSites({ water: 'sea', depthAt: seaDepth, dock: { x: 10, z: 0 }, reach: 4500 });
const KIT = { lures: { shrimp: 30, cutbait: 10, livebait: 8, jig: 2 }, rod: 'rod_carbon', reel: 'reel_biggame', line: 'line_braid65' };
const WORLD = { worldModules: [{ id: 'wm1', kind: 'marina', name: 'North Marina' }], buildings: [] };

function setup() {
  const dbs = openDb(tempDir('mvw-senses-play-')), now = { t: 1_800_000_000_000 };
  const mk = (login, name) => { const t = Date.now(); return { id: Number(dbs.db.prepare(`INSERT INTO accounts (world_id, login, display_name, display_key, role, password_hash, password_changed, created, updated)
    VALUES (?, ?, ?, ?, 'member', 'x', ?, ?, ?)`).run(dbs.worldId, login, name, login, t, t, t).lastInsertRowid) }; };
  const kimP = mk('kim', 'Kim'), sam = mk('sam', 'Sam');
  const play = new PlayCore({ dbs, now: () => now.t, contextFor: id => (id === 'fishing' ? { dock: { id: 'wm1', kind: 'marina', x: 10, z: 0 }, water: 'sea', sites: SITES, clock: { hour0: 7, perMin: 0.05 }, kit: KIT, seed: 11 } : {}) });
  // the senses, as far as play needs them: the registry, the players, the world's place names, the diaries' pens
  const players = { byId: new Map([[kimP.id, { id: kimP.id, name: 'Kim', ctx: (4 << 6) | 0 }], [sam.id, { id: sam.id, name: 'Sam', ctx: -1 }]]) };
  const sim = { brain: { placeName: (b, f) => (b === 4 && f === 0 ? 'Café Bella' : '') } };
  const S = { activities: new Activities(), players, accountName: () => null, env: () => ({ sim, players }), notes: [], near: [] };
  S.note = (id, kind, text) => S.notes.push({ id, kind, text });
  S.noteNear = (account, text) => S.near.push({ account, text });
  const off = registerPlayActivities(S, { play, world: () => WORLD });
  const card = (account, who = 'Kim') => { const c = S.activities.cards({ env: S.env(), i: -1, account, who, self: who === 'you', now: 0 }); return c.length ? c[0] : null; };
  return { dbs, play, now, kimP, sam, S, card, off, done: () => dbs.close?.() };
}

test('fishing: the card from the server\'s own state (the trip, a fish on the line, the catch), and what happened in the diaries', () => {
  const { play, now, kimP, S, card, done } = setup();
  try {
    assert.equal(card(kimP.id), null, 'not playing: no card');
    const st = play.start(kimP, 'fishing', 'harbour-morning', 'wm1'), g = st.data.plan.grounds[0], run = play.runs.get(st.run);
    now.t += 5000;
    let c = card(kimP.id);
    assert.equal(c.title, 'Kim is out fishing: «Harbour Morning» from «North Marina»');
    assert.deepEqual(c.lines, ['under a minute into the 12-minute trip at sea', 'nothing caught yet']);
    let h = play.act(kimP, st.run, 'hook', { ground: g.id, lure: 'shrimp', d0: 20 });
    while (!h.hook) { now.t += HOOK_GAP_MS; h = play.act(kimP, st.run, 'hook', { ground: g.id, lure: 'shrimp', d0: 20 }); }
    now.t += 12_000;
    c = card(kimP.id);
    assert.match(c.lines[1], /^(a fish on the line(, | — a big one, )fighting it for 12 s|something on the line, reeling it in \(12 s\))$/);
    now.t += 90_000;
    const got = play.act(kimP, st.run, 'land', { hook: h.hook }).caught;
    assert.equal(S.near.length, 1);
    assert.equal(S.near[0].account, kimP.id);
    assert.equal(S.near[0].text, `Kim ${got.find ? 'pulled up' : 'landed'} ${catchWords(got)}${!got.kept && got.species ? ' — no room left in the cooler' : ''}`);
    assert.match(S.near[0].text, /^Kim (landed an? \d[\d.]* k?g [A-Za-z]|pulled up an? [A-Za-z])/);
    c = card(kimP.id);
    assert.match(c.lines.at(-1), new RegExp(`^caught 1 so far, \\d+ of \\d+ cooler slots used; latest: ${catchWords(got).replace(/[()]/g, '\\$&')}( \\(no room in the cooler\\))?$`));
    // let it go: in the diaries, and on the card
    if (got.species) {
      play.act(kimP, st.run, 'release', { n: got.n });
      assert.equal(S.near.at(-1).text, `Kim let ${catchWords(got).replace(/^an? /, 'the ')} go`);
      assert.match(card(kimP.id).lines.at(-1), /\(let go\)$/);
      play.act(kimP, st.run, 'keep', { n: got.n });
      assert.match(S.near.at(-1).text, /^Kim kept the .* after all$/, 'kept again: it wasn\'t in the cooler');
    }
    // a fish lost to a snapped line
    let j = null;
    for (let k = 0; k < 30 && !j?.hook; k++) { now.t += 4000; j = play.act(kimP, st.run, 'hook', { ground: g.id, lure: 'shrimp', d0: 20 }); }
    assert.ok(j.hook, 'a second bite');
    play.act(kimP, st.run, 'lose', { hook: j.hook, why: 'snap' });
    assert.equal(S.near.at(-1).text, 'Kim lost a fish — the line snapped');
    assert.equal(card(kimP.id).lines.at(-1), '1 line snapped so far');
    // back at the dock
    const res = play.finish(kimP, st.run, {});
    assert.ok(res.ok);
    assert.match(S.near.at(-1).text, /^Kim came back from a fishing trip \(«Harbour Morning»\): (1 fish kept, the biggest an? .+|nothing kept), (★|no stars)/);
    assert.equal(card(kimP.id), null, 'the trip is over');
    assert.equal(S.notes.length, 0, 'a player\'s run goes to the agents near them, never as an agent\'s own');
    assert.ok(run.actAt > run.at);
  } finally { done(); }
});

test('Order Up: the Rush from the moments its page reports; the moment route checks the run, the account and the pace', () => {
  const { play, now, kimP, sam, S, card, done } = setup();
  try {
    play.runs.set('r1', { id: 'r1', account: kimP.id, module: 'orderup', course: 'lunch', version: 1, at: now.t, data: { b: 4, f: 0, stations: [] }, auto: false, best: null });
    assert.deepEqual(card(kimP.id), { id: 'play', title: 'Kim is cooking a Rush in Order Up: «Lunch Rush» at «Café Bella»', lines: ['started under a minute ago; no word from the kitchen yet'] });
    now.t += 80_000;
    assert.deepEqual(play.moment(kimP, 'r1', { t: 80, served: 6, lost: 1, burns: 0, waiting: 2, late: 1, orders: ['latte', 'croissant', '<b>nope</b>'], points: 420, money: 34.5, tips: 6.2, stars: 2, extra: 'x'.repeat(5000) }), { ok: true });
    assert.deepEqual(play.runs.get('r1').live, { t: 80, dur: 180, served: 6, lost: 1, burns: 0, waiting: 2, late: 1, orders: ['Latte', 'Croissant'], points: 420, money: 34.5, tips: 6.2, stars: 2 }, 'only what the module knows, checked');
    assert.deepEqual(card(kimP.id).lines, ['1:20 of 3:00 in', '6 served, 1 walked out, 0 burnt', '2 orders waiting (1 about to walk out): Latte, Croissant', 'going well (2★ pace): 420 pts, $34.50 + $6.20 tips']);
    // the page can't run ahead of the server's clock
    play.moment(kimP, 'r1', { t: 170, served: 7 });
    assert.equal(play.runs.get('r1').live.t, 86, 'at most the time since the start, and a little slack');
    // only the run's own account; a few at a time; a moment that is not one; a module without moments
    const err = (fn, status, code) => assert.throws(fn, e => e instanceof PlayError && e.status === status && e.code === code);
    err(() => play.moment(sam, 'r1', { t: 1 }), 404, 'no_run');
    err(() => play.moment(kimP, 'nope', { t: 1 }), 404, 'no_run');
    play.moment(kimP, 'r1', { t: 81 });
    err(() => play.moment(kimP, 'r1', { t: 82 }), 429, 'too_fast');
    now.t += 4000;
    err(() => play.moment(kimP, 'r1', { t: 'soon' }), 400, 'bad_moment');
    err(() => play.moment(kimP, 'r1', ['t', 1]), 400, 'bad_moment');
    const fish = play.start(sam, 'fishing', 'harbour-morning', 'wm1');
    err(() => play.moment(sam, fish.run, { t: 1 }), 400, 'no_moments');
    // a page not heard from for a while: not told about (it was shut mid-Rush)
    now.t += 100_000;
    assert.equal(card(kimP.id), null);
    // the Rush done: in the diaries of the agents with Kim
    play.emit({ type: 'finish', account: kimP.id, run: play.runs.get('r1'), result: { ok: true, score: 1240, stars: 2, detail: { served: 14, lost: 1, burns: 0 } } });
    assert.equal(S.near.at(-1).text, 'Kim finished a Lunch Rush at «Café Bella»: ★★☆, 1,240 pts — 14 served, 1 walked out');
  } finally { done(); }
});

test('an agent\'s own kitchen shift (an unattended run as −its id): its card says "you", and the Rush done goes in its own diary', () => {
  const { play, now, S, card, done } = setup();
  try {
    play.runs.set('a1', { id: 'a1', account: -7, module: 'orderup', course: 'lunch', version: 1, at: now.t, data: { b: 4, f: 0, stations: [] }, auto: true, best: null });
    now.t += 65_000;
    assert.deepEqual(card(-7, 'you'), { id: 'play', title: 'You are cooking a Rush at «Café Bella» (your kitchen shift: «Lunch Rush»)', lines: ['1 min in, about 2 min to go'] });
    now.t += 10 * 60e3;
    assert.equal(card(-7, 'you'), null, 'past its end');
    play.emit({ type: 'finish', account: -7, run: play.runs.get('a1'), result: { ok: true, score: 980, stars: 1, detail: { served: 9, lost: 3, burns: 2 } } });
    assert.deepEqual(S.notes, [{ id: 7, kind: 'activity', text: 'You finished cooking a Lunch Rush at «Café Bella»: ★☆☆, 980 pts — 9 served, 3 walked out, 2 burnt' }]);
    assert.equal(S.near.length, 0);
  } finally { done(); }
});

test('the arcade and the airport from their moments; a high score and a lesson passed are noticed; any other module in a line', () => {
  const { play, now, kimP, S, card, done } = setup();
  try {
    const st = play.start(kimP, 'arcade', 'block-drop');
    assert.deepEqual(card(kimP.id), { id: 'play', title: 'Kim is playing «Block Drop» at the arcade («Café Bella»)', lines: ['just started', 'playing for under a minute'] });
    now.t += 125_000;
    play.moment(kimP, st.run, { score: 12400, lives: 2, detail: { level: 4, lines: 30, bestStreak: 3, label: 'no', more: 1, most: 2 } });
    assert.deepEqual(card(kimP.id).lines, ['score 12,400, 2 lives left', 'level 4, lines 30, best streak 3, more 1', 'playing for 2 min']);
    const run = play.runs.get(st.run);
    play.emit({ type: 'finish', account: kimP.id, run, result: { ok: true, score: 900, stars: 0, newBest: false, place: 7 } });
    assert.equal(S.near.length, 0, 'an ordinary game is not worth a line');
    play.emit({ type: 'finish', account: kimP.id, run, result: { ok: true, score: 12400, stars: 3, newBest: true, prevBest: { score: 9000 }, place: 1 } });
    assert.equal(S.near.at(-1).text, 'Kim scored 12,400 on «Block Drop» — a new personal best, the top score on the board');
    // the airport: a ring course
    play.runs.clear();
    play.runs.set('f1', { id: 'f1', account: kimP.id, module: 'airport', course: 'hover-hop', version: 1, at: now.t, data: { rings: new Array(8).fill({}), airport: { id: 'wm9' } }, auto: false });
    assert.deepEqual(card(kimP.id), { id: 'play', title: 'Kim is flying a lesson course: «Hover Hop» in a helicopter', lines: ['8 rings to fly; heading for the first', `three stars under ${card(kimP.id).lines[1].match(/under (\S+),/)[1]}, one under ${card(kimP.id).lines[1].match(/one under (\S+)$/)[1]}`] });
    now.t += 50_000;
    play.moment(kimP, 'f1', { passed: 3, secs: 42 });
    assert.equal(card(kimP.id).lines[0], 'through 3 of 8 rings, 0:42 on the clock');
    play.emit({ type: 'finish', account: kimP.id, run: play.runs.get('f1'), result: { ok: true, score: 42.1, stars: 3, newBest: true, prevBest: null } });
    assert.equal(S.near.at(-1).text, 'Kim passed the «Hover Hop» flying lesson in 42.10 s: ★★★');
    play.emit({ type: 'finish', account: kimP.id, run: play.runs.get('f1'), result: { ok: true, score: 99, stars: 0 } });
    assert.equal(S.near.at(-1).text, 'Kim flew the «Hover Hop» course in 1:39.00, too slow for a star');
    // a module without words of its own
    registerPlay({ id: 'tiddly', version: 1, label: 'Tiddlywinks', icon: '🟣', blurb: 'Flick the winks', score: { kind: 'points', better: 'higher' }, price: 100,
      courses: [{ id: 'easy', label: 'Easy', difficulty: 1, stars: [1, 2, 3] }], verify: () => ({ ok: true, score: 1 }) });
    play.runs.clear();
    const t = play.start({ id: kimP.id }, 'tiddly', 'easy');
    now.t += 3 * 60e3;
    assert.deepEqual(card(kimP.id), { id: 'play', title: 'Kim is playing «Tiddlywinks» («Easy»)', lines: ['for 3 min'] });
    play.finish({ id: kimP.id }, t.run, {});
    assert.equal(S.near.at(-1).text, 'Kim finished «Tiddlywinks» («Easy»): 1 pts, ★☆☆');
    // a page gone quiet
    const t2 = (now.t += 2000, play.start({ id: kimP.id }, 'tiddly', 'easy'));
    assert.ok(card(kimP.id));
    now.t += STALE_MS + 1000;
    assert.equal(card(kimP.id), null);
    assert.ok(t2.run);
  } finally { done(); }
});

test('words: weights, catches, places; a failing provider is left out; registering twice replaces; the listener stops', () => {
  assert.equal(kgWords(0.05), '50 g'); assert.equal(kgWords(2.14), '2.1 kg'); assert.equal(kgWords(3), '3 kg'); assert.equal(kgWords(48.6), '49 kg');
  assert.equal(catchWords({ find: 'boot' }), 'an old boot');
  assert.equal(fishName({ name: 'Caribbean Reef Squid' }), 'Caribbean reef squid'); assert.equal(fishName({ name: 'Largemouth Bass' }), 'largemouth bass');
  assert.equal(fishName({ name: 'Old Whiskers', legend: true }), 'Old Whiskers');
  assert.equal(catchWords({ species: 'pinfish', kg: 0.2, size: 'small' }), 'a 0.2 kg pinfish');
  assert.equal(placeOf({ data: { dock: { id: 'wm1' } } }, { world: WORLD }), 'North Marina');
  assert.equal(placeOf({ data: { b: 4, f: 0 } }, { sim: { brain: { placeName: () => 'Café Bella' } } }), 'Café Bella');
  assert.equal(placeOf({ account: 3, data: { seed: 1 } }, { players: { byId: new Map([[3, { ctx: (2 << 6) | 1 }]]) }, sim: { brain: { placeName: (b, f) => `B${b}F${f}` } } }), 'B2F1');
  assert.equal(placeOf({ account: 3, data: {} }, { players: { byId: new Map([[3, { ctx: -1 }]]) } }), '');
  const { play, kimP, S, card, off, done } = setup();
  try {
    play.start(kimP, 'arcade', 'block-drop');
    assert.ok(card(kimP.id));
    off();
    assert.equal(card(kimP.id), null, 'removed');
    const n = S.near.length;
    play.emit({ type: 'finish', account: kimP.id, run: play.runOf(kimP.id), result: { ok: true, score: 1, stars: 3, newBest: true, place: 1 } });
    assert.equal(S.near.length, n, 'no longer listening');
    assert.throws(() => registerPlayActivities({}, { play }), /needs the senses/);
  } finally { done(); }
});
