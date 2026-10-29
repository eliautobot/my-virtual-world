// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent cooking a Rush (PLAN-RESTAURANT-GAME.md "Progression" P3, 2026-10-28, the product owner: "for agents, I want
// the same skill system and badge system so that agents and players are scored within the same, with the same criteria"):
// an agent plays Order Up the way a player does, by the same rules, beat by beat: it does what the coach says
// (shared/orderup/guide.js nextStep), walks between stations (a few beats a press, as a player's walk), and makes the
// mistakes of its level, a beginner slower to react and more often distracted (an order left waiting, a dish left a
// little long), a head chef quick and steady. What it pressed is a log like a player's, which the server plays again and
// scores (shared/orderup/module.js verifyRush): the same score, stars, experience, badges and Cookbook, the cook's own
// skills applied by the rules. Deterministic from the Rush's seed and the agent's level (tests and the server agree).
import { newRush, interact, work, step } from './rules.js';
import { nextStep } from './guide.js';
import { BEAT, courseParams } from './module.js';
import { RNG } from '../rng.js';

/** How an agent of Order Up level `level` cooks: { react: beats a press takes (its walk and thought), slip: the chance a
 *  decision is put off a while, pause: [min, max] beats it is, when it is }. */
export function cookPace(level) {
  const L = Math.max(1, Math.min(30, level | 0));
  return { react: Math.max(9, Math.round(17 - L * 0.6)), slip: Math.max(0.02, 0.22 - L * 0.015), pause: [8, Math.max(14, 50 - L * 2)] };
}

/**
 * The Rush laid out by the server (data: { seed, stations, kitchen, menu, skills }) on course (a Rush level of
 * module.js COURSES) cooked by an agent of `level`: → { log (what it pressed, as the page would send), S (how it went) }.
 */
export function cookRush(data, course, { level = 1 } = {}) {
  const S = newRush(data.stations, { seed: data.seed, dur: course.dur, kitchen: data.kitchen || undefined, menu: data.menu || undefined, course: courseParams(course), ...(data.skills ? { skills: { you: data.skills } } : {}) });
  const rng = new RNG(`cook:${data.seed}:${level | 0}`), pace = cookPace(level), log = [], sid = t => data.stations.find(x => x.t === t)?.id;
  let wait = rng.int(10, 30), f = null;   // (it reads the first tickets)
  for (let n = 0; !S.over && n < 20000; n++) {
    let worked = null;
    if (wait > 0) wait--;
    else if (rng.next() < pace.slip) wait = rng.int(pace.pause[0], pace.pause[1]);   // (distracted a while)
    else {
      const g = nextStep(S), id = g.t && sid(g.t);
      if (g.act === 'E' && id) { interact(S, 'you', id, g.pick ? { pick: g.pick } : {}); log.push(g.pick ? [n, 'E', id, g.pick] : [n, 'E', id]); wait = pace.react + rng.int(0, 4); }
      else if (g.act === 'F' && id) worked = id;
      else wait = 4;   // (nothing to do this moment: a look at the tickets)
    }
    if (worked) { work(S, 'you', worked, BEAT); if (f && f[2] === worked && f[0] + f[3] === n) f[3]++; else { f = [n, 'F', worked, 1]; log.push(f); } }
    step(S, BEAT);
  }
  return { log, S };
}
