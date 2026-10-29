// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Order Up as a play module (PLAN-RESTAURANT-GAME.md "Progression", 2026-10-28, the product owner: "we need the skills as
// well, and also some kind of badges or achievements ... similar to the fishing game ... agents and players are scored
// within the same, with the same criteria"): its Rushes are the courses of the module 'orderup' on the play platform
// (shared/play.js, server/play/play.js), so experience, the Order Up level, the player's own level and rank, badges,
// leaderboards and Game prizes are the platform's own, the same for every cook, a player's or an agent's.
//
// A Rush that counts: the server seeds it (prepare: the kitchen's stations and its place's menu, from the kitchen's
// record), the browser plays it and sends what was pressed at each beat (a log), and verify() plays the Rush again from
// the seed and the log (replayRush, the rules being deterministic) and scores it itself, as the arcade does.
//   score  each dish served: its grade x its price / 10 (a lobster counts more than an espresso; Critic's Night: only
//          Good or better counts)
//   stars  the Rush's own (rules.js starsOf: the share of every order served well, and busy enough), course.stars being
//          those shares in percent, for people
import { registerPlay } from '../play.js';
import { newRush, interact, work, step, starsOf } from './rules.js';
import { FOOD_BY_ID } from '../food.js';

/** The beat the Rush is played at, in the browser and when it is played again (client/js/play/order-up.js STEP). */
export const BEAT = 0.05;
const SLACK_S = 6;   // (the clock's allowance: a Rush can't take less real time than it played)

/** The Rush levels, in the order they open: how long, how fast orders come (pace: the gap between them x), how long a
 *  customer waits (patience x), strict (only Good or better counts). */
export const COURSES = Object.freeze([
  { id: 'warmup', label: 'Warm-up', difficulty: 1, dur: 120, pace: 1.4, patience: 1.3, blurb: 'Two minutes, orders come slowly and customers wait.' },
  { id: 'lunch', label: 'Lunch Rush', difficulty: 3, after: 'warmup', dur: 180, pace: 1, patience: 1, blurb: 'Three minutes of a busy lunch.' },
  { id: 'dinner', label: 'Dinner Rush', difficulty: 5, after: 'lunch', dur: 240, pace: 0.85, patience: 0.9, blurb: 'Four minutes, orders closer together.' },
  { id: 'friday', label: 'Friday Night', difficulty: 7, after: 'dinner', dur: 300, pace: 0.72, patience: 0.8, blurb: 'Five minutes of a packed house.' },
  { id: 'critic', label: 'Critic\'s Night', difficulty: 9, after: 'friday', dur: 240, pace: 0.8, patience: 0.75, strict: true, blurb: 'A critic in: only Good or better counts.' },
].map(c => Object.freeze({ ...c, stars: [30, 60, 85] })));
export const courseParams = c => ({ pace: c.pace, patience: c.patience, strict: !!c.strict });

/**
 * A Rush played again: stations [{ id, t }] as the run's data gave them, o { seed, kitchen, menu, course, skills (the
 * cook's, as the server has them) }, log a list of
 * [n, 'E', station id, pick?] (E pressed after n beats) and [n, 'F', station id, beats] (F held from beat n). → the Rush's
 * state when it ended (or ran out of log).
 */
export function replayRush(stations, o, log) {
  const c = o.course || {}, S = newRush(stations, { seed: o.seed, dur: c.dur ?? 180, kitchen: o.kitchen || undefined, menu: o.menu || undefined, course: courseParams(c), ...(o.skills ? { skills: { you: o.skills } } : {}) });
  const E = new Map(), F = new Map(), ids = new Set(stations.map(s => s.id)), last = Math.ceil(S.dur / BEAT) + 2;
  for (const x of Array.isArray(log) ? log : []) {
    if (!Array.isArray(x) || !Number.isSafeInteger(x[0]) || x[0] < 0 || x[0] > last || !ids.has(x[2])) throw new Error('a step of the log is not one');
    if (x[1] === 'E') (E.get(x[0]) || E.set(x[0], []).get(x[0])).push([x[2], typeof x[3] === 'string' ? x[3].slice(0, 32) : null]);
    else if (x[1] === 'F' && Number.isSafeInteger(x[3]) && x[3] > 0 && x[3] <= last) for (let k = 0; k < x[3]; k++) F.set(x[0] + k, x[2]);
    else throw new Error('a step of the log is not one');
  }
  for (let n = 0; n <= last && !S.over; n++) {
    for (const [sid, pick] of E.get(n) || []) interact(S, 'you', sid, pick ? { pick } : {});
    const f = F.get(n); if (f != null) work(S, 'you', f, BEAT);
    step(S, BEAT);
  }
  return S;
}

/** What a Rush came to, for the shift report, the Cookbook and the badges. */
export function rushDetail(S) {
  const grades = {}, items = {}, counts = {}, cats = {};
  for (const x of S.served) {
    grades[x.grade] = (grades[x.grade] || 0) + 1;
    const it = x.item || x.dish; items[it] = Math.max(items[it] || 0, x.score); counts[it] = (counts[it] || 0) + 1;
    const cat = FOOD_BY_ID[it]?.cat; if (cat) cats[cat] = (cats[cat] || 0) + 1;
  }
  return { served: S.served.length, lost: S.lost, burns: S.burns || 0, money: S.money, tips: S.tips, points: S.points, grades, items, counts, cats };
}

/** Checks a reported Rush by playing it again: { ok, score, stars, ms, detail } or { ok: false, why }. */
export function verifyRush(course, report, ctx) {
  const d = ctx.data;
  if (!d || !Array.isArray(d.stations)) return { ok: false, why: 'That Rush has no kitchen' };
  if (!report || !Array.isArray(report.log)) return { ok: false, why: 'The Rush sent no play' };
  if (report.log.length > 20000) return { ok: false, why: 'That Rush sent too much' };
  let S;
  try { S = replayRush(d.stations, { seed: d.seed, kitchen: d.kitchen, menu: d.menu, course, skills: d.skills || null }, report.log); } catch (e) { return { ok: false, why: e.message || 'That Rush could not be read' }; }
  if (!S.over) return { ok: false, why: 'The Rush had not ended' };
  if (S.dur > (ctx.serverMs ?? 0) / 1000 + SLACK_S) return { ok: false, why: 'That Rush was quicker than the clock' };
  const claimed = Number(report.score), detail = rushDetail(S);
  if (Number.isFinite(claimed) && claimed !== S.score) detail.claimed = claimed;
  return { ok: true, score: S.score, stars: starsOf(S), ms: Math.round(S.dur * 1000), detail };
}

/** How many dishes there are to cook in the world (the Cookbook's whole: every item a place may sell). */
export const COOKBOOK_ALL = Object.values(FOOD_BY_ID).filter(f => f.cat !== 'home').length;
/** The cuisines with a badge for every dish of them served (their item ids). */
export const CUISINES = Object.freeze(Object.fromEntries(['coffee', 'bakery', 'breakfast', 'burgers', 'pizza', 'italian', 'mexican', 'asian', 'japanese', 'indian', 'mediterranean', 'french', 'seafood', 'grill', 'desserts', 'bar']
  .map(cat => [cat, Object.values(FOOD_BY_ID).filter(f => f.cat === cat).map(f => f.id)])));
const CUISINE_WORDS = { coffee: ['Master barista', '☕'], bakery: ['Master baker', '🥐'], breakfast: ['Breakfast king', '🍳'], burgers: ['Burger boss', '🍔'], pizza: ['Pizzaiolo', '🍕'],
  italian: ['Nonna\'s pride', '🍝'], mexican: ['El jefe', '🌮'], asian: ['Wok star', '🥡'], japanese: ['Itamae', '🍣'], indian: ['Tandoor master', '🍛'], mediterranean: ['Mezze master', '🧆'],
  french: ['Chef de cuisine', '🥖'], seafood: ['Catch of the day', '🦞'], grill: ['Pitmaster', '🥩'], desserts: ['Pastry chef', '🍰'], bar: ['Mixologist', '🍸'] };

const runs = (s, n) => s.runs >= n, grades = (run, g) => run?.detail?.grades?.[g] || 0;
// (badges a run earns: checked by the platform after each Rush; those that need the cook's whole history, the Cookbook and
// the cuisines, are given by the cook's record, server/play/cook.js, and have no run rule)
const never = () => false;
export const ORDER_UP = registerPlay({
  id: 'orderup', version: 1, label: 'Order Up', icon: '🍳', placement: 'interior', price: 25000,
  blurb: 'Cook and serve a Rush in a real kitchen: every dish graded, stars, tips, levels and badges.',
  score: { kind: 'points', unit: 'pts', better: 'higher' },
  courses: COURSES.map(c => ({ id: c.id, label: c.label, difficulty: c.difficulty, stars: c.stars, blurb: c.blurb, ...(c.after ? { after: c.after } : {}) })),
  prepare: (course, ctx) => (ctx.kitchen ? { seed: ctx.seed, stations: ctx.kitchen.stations, kitchen: ctx.kitchen.kitchen, menu: ctx.kitchen.menu, b: ctx.kitchen.b, f: ctx.kitchen.f, skills: ctx.skills || {} } : null),
  verify: (course, report, ctx) => verifyRush(COURSES.find(c => c.id === course.id), report, ctx),
  badges: [
    { id: 'ou_first', label: 'First service', icon: '🛎️', desc: 'Finish your first Rush', tier: 'bronze', when: s => runs(s, 1) },
    { id: 'ou_supreme', label: 'Supreme!', icon: '✨', desc: 'Serve a Supreme dish', tier: 'bronze', when: (s, run) => grades(run, 'Supreme') >= 1 },
    { id: 'ou_supreme10', label: 'Ten out of ten', icon: '🌟', desc: 'Serve ten Supreme dishes in one Rush', tier: 'gold', when: (s, run) => grades(run, 'Supreme') >= 10 },
    { id: 'ou_clean', label: 'Clean Rush', icon: '🧽', desc: 'Serve eight or more in a Rush with nothing burnt and nobody walking out', tier: 'silver', when: (s, run) => run?.detail?.served >= 8 && !run.detail.lost && !run.detail.burns },
    { id: 'ou_three', label: 'Three stars', icon: '⭐', desc: 'Three stars on a Rush', tier: 'bronze', when: (s, run) => run?.stars === 3 },
    { id: 'ou_friday', label: 'Friday night lights', icon: '🔥', desc: 'Three stars on Friday Night', tier: 'gold', when: (s, run) => run?.course === 'friday' && run.stars === 3 },
    { id: 'ou_critic', label: 'Critic\'s choice', icon: '🎩', desc: 'Three stars on Critic\'s Night', tier: 'platinum', when: (s, run) => run?.course === 'critic' && run.stars === 3 },
    { id: 'ou_head_chef', label: 'Head chef', icon: '👨‍🍳', desc: 'Three stars on every Rush level', tier: 'platinum', when: s => COURSES.every(c => (s.best?.[c.id]?.stars || 0) >= 3) },
    { id: 'ou_tips', label: 'Big tipper', icon: '💰', desc: 'Take $40 in tips in one Rush', tier: 'silver', when: (s, run) => (run?.detail?.tips || 0) >= 40 },
    { id: 'ou_regular', label: 'Regular', icon: '🍽️', desc: 'Finish 25 Rushes', tier: 'silver', when: s => runs(s, 25) },
    { id: 'ou_veteran', label: 'Kitchen veteran', icon: '🔪', desc: 'Finish 100 Rushes', tier: 'gold', when: s => runs(s, 100) },
    { id: 'ou_sous', label: 'Sous-chef', icon: '🥄', desc: 'Reach Order Up level 5', tier: 'silver', when: s => s.level >= 5 },
    { id: 'ou_exec', label: 'Executive chef', icon: '🏅', desc: 'Reach Order Up level 12', tier: 'gold', when: s => s.level >= 12 },
    // the Cookbook (server/play/cook.js): every dish served, its best grade
    { id: 'ou_book10', label: 'Cookbook: 10', icon: '📖', desc: 'Serve 10 different dishes', tier: 'bronze', when: never },
    { id: 'ou_book25', label: 'Cookbook: 25', icon: '📗', desc: 'Serve 25 different dishes', tier: 'silver', when: never },
    { id: 'ou_book50', label: 'Cookbook: 50', icon: '📘', desc: 'Serve 50 different dishes', tier: 'gold', when: never },
    { id: 'ou_book100', label: 'Cookbook: 100', icon: '📙', desc: 'Serve 100 different dishes', tier: 'gold', when: never },
    { id: 'ou_book_all', label: 'The whole Cookbook', icon: '📚', desc: `Serve every one of the ${COOKBOOK_ALL} dishes of the world`, tier: 'platinum', when: never },
    { id: 'ou_supreme100', label: 'Hundred Supreme', icon: '💎', desc: 'Serve 100 Supreme dishes in all', tier: 'gold', when: never },
    ...Object.entries(CUISINE_WORDS).map(([cat, [label, icon]]) => ({ id: `ou_c_${cat}`, label, icon, desc: `Serve every dish of ${cat === 'bar' ? 'the bar' : cat === 'coffee' ? 'the coffee bar' : `the ${cat} kitchen`} (${CUISINES[cat].length})`, tier: 'gold', when: never })),
  ],
});
/** The badges the Cookbook gives at a count of different dishes. */
export const BOOK_BADGES = Object.freeze([[10, 'ou_book10'], [25, 'ou_book25'], [50, 'ou_book50'], [100, 'ou_book100'], [COOKBOOK_ALL, 'ou_book_all']]);