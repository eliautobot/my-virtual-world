// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Play modules (docs/features/play-modules.md): the fun in the world — a whole building (an airport, a race track, a
// fishing port) or a thing inside one (a kitchen, an arcade cabinet) that runs a minigame or a game mechanic. Each is a
// MODULE registered here: its courses (the levels, harder as a player gets on), how a finished run is checked and
// scored, how much experience it is worth, and its badges. The platform's core (server/play/play.js) owns everything
// around a module and is the same for all of them: who may start what, runs, experience and levels (per module and the
// player's own), ranks, best results, leaderboards, badges and the player's profile. A new module is registerPlay()
// here plus its own browser game — no change to the core, the profile or the leaderboards.
//
// Not to be confused with WORK modules (shared/work.js): those are jobs at venues, paid in Virtual Coin.
//
// Shared by the browser (it lists and draws) and the server (it checks every run: the browser never sends a score,
// only what happened, and verify() works the score out from that).

const ID = /^[a-z][a-z0-9_]{1,23}$/;
const COURSE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

// ------------------------------------------------------------------------------------------- levels and ranks
/** A module level from that module's experience: 1 at 0, 2 at 60, 3 at 240, 4 at 540 … */
export const moduleLevel = xp => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 60));
/** The player's own level from all play experience together: 1 at 0, 2 at 100, 3 at 400 … */
export const playerLevel = xp => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 100));
/** The experience a level starts at (the inverse of the curves above). */
export const levelStart = (level, per) => (Math.max(1, level) - 1) ** 2 * per;
/** Progress through the current level: { level, from, to, pct }. per = 60 for a module, 100 for the player. */
export function levelProgress(xp, per = 100) {
  const level = 1 + Math.floor(Math.sqrt(Math.max(0, xp) / per)), from = levelStart(level, per), to = levelStart(level + 1, per);
  return { level, xp: Math.round(xp), from, to, pct: Math.max(0, Math.min(1, (xp - from) / (to - from))) };
}

/** The player ranks, by the player's level: shown on the profile, the leaderboards and over the name. */
export const RANKS = Object.freeze([
  { id: 'rookie', name: 'Rookie', icon: '🔰', from: 1, color: '#9aa4b2' },
  { id: 'bronze', name: 'Bronze', icon: '🥉', from: 5, color: '#c47f3b' },
  { id: 'silver', name: 'Silver', icon: '🥈', from: 10, color: '#c0c7d1' },
  { id: 'gold', name: 'Gold', icon: '🥇', from: 15, color: '#f2c14e' },
  { id: 'platinum', name: 'Platinum', icon: '💠', from: 25, color: '#7fd6e0' },
  { id: 'diamond', name: 'Diamond', icon: '💎', from: 40, color: '#8db7ff' },
  { id: 'legend', name: 'Legend', icon: '👑', from: 60, color: '#ff9f43' },
].map(Object.freeze));
export const rankOf = level => [...RANKS].reverse().find(r => level >= r.from) || RANKS[0];

/** Badge tiers, rarest last (the profile sorts and colours by them). */
export const TIERS = Object.freeze(['bronze', 'silver', 'gold', 'platinum']);

// ------------------------------------------------------------------------------------------- the registry
const MODULES = new Map();
const BADGES = new Map();   // every badge by id: the platform's and each module's

/**
 * A badge: { id, label, icon, desc, tier, secret?, when(stats, ctx) → true when earned }. stats are the player's for the
 * module (or, for a platform badge, overall); ctx is the run just finished, when there is one. See statsFor() in the core.
 */
function badge(b, module = null) {
  if (!ID.test(b.id || '')) throw new Error(`badge id ${b.id}: lowercase letters, digits, _`);
  if (BADGES.has(b.id)) throw new Error(`badge ${b.id} exists already`);
  for (const k of ['label', 'icon', 'desc']) if (typeof b[k] !== 'string' || !b[k]) throw new Error(`badge ${b.id}: ${k} is required`);
  if (!TIERS.includes(b.tier)) throw new Error(`badge ${b.id}: tier is one of ${TIERS.join(', ')}`);
  if (typeof b.when !== 'function') throw new Error(`badge ${b.id}: when(stats, run) is required`);
  const x = Object.freeze({ secret: false, ...b, module });
  BADGES.set(x.id, x);
  return x;
}

/**
 * Registers a play module. def:
 *   id, version            the module's id; version bumps when its courses or scoring change (kept with each run)
 *   label, icon, blurb     how people see it ("Airport", "✈️", "Fly through the rings against the clock")
 *   venue                  the building kind it lives in (an airport), or null for one that lives anywhere
 *   score                  { kind: 'time' | 'points', unit: 's' | 'pts', better: 'lower' | 'higher' }
 *   courses                [{ id, label, tier, difficulty 1..10, after?: course id, stars: [1★, 2★, 3★ thresholds] }] in order;
 *                          a course opens when the one named in `after` has a finished run (1★)
 *   verify(course, report, ctx) → { ok: true, score, ms, stars 1..3, detail? } | { ok: false, why }
 *                          ctx = { serverMs (time the server saw the run take), seed }; the browser only reports what
 *                          happened and verify() decides
 *   xp(result, course)     experience for a run (default: 10 × difficulty × stars, a third for a repeat without a new best)
 *   badges                 [badge…] this module's badges (see badge())
 *   placement              'world': a big module that takes up world space, placed by administrators only (Edit dock →
 *                          World modules, shared/world-modules.js); 'interior': a module inside a building that players
 *                          buy with Virtual Coin and place in their own buildings (Buildings section)
 *   price                  an interior module's price in hundredths of a VC (expensive on purpose: owning modules is
 *                          progression of its own); world modules have none
 */
export function registerPlay(def) {
  if (!def || !ID.test(def.id || '')) throw new Error('a play module needs an id (lowercase letters, digits, _)');
  if (!Number.isSafeInteger(def.version) || def.version < 1) throw new Error(`${def.id}: version is a whole number from 1`);
  for (const k of ['label', 'icon', 'blurb']) if (typeof def[k] !== 'string' || !def[k]) throw new Error(`${def.id}: ${k} is required`);
  const sc = def.score || {};
  if (!['time', 'points'].includes(sc.kind) || !['lower', 'higher'].includes(sc.better)) throw new Error(`${def.id}: score is { kind: time|points, better: lower|higher, unit }`);
  if (!Array.isArray(def.courses) || !def.courses.length) throw new Error(`${def.id}: courses is a non-empty list`);
  const seen = new Set();
  for (const c of def.courses) {
    if (!COURSE_ID.test(c.id || '') || seen.has(c.id)) throw new Error(`${def.id}: course id ${c.id} is missing or repeated`);
    if (c.after && !seen.has(c.after)) throw new Error(`${def.id}: course ${c.id} comes after ${c.after}, which must be listed before it`);
    if (!(c.difficulty >= 1 && c.difficulty <= 10)) throw new Error(`${def.id}: course ${c.id} difficulty is 1..10`);
    if (!Array.isArray(c.stars) || c.stars.length !== 3) throw new Error(`${def.id}: course ${c.id} needs three star thresholds`);
    seen.add(c.id);
  }
  if (typeof def.verify !== 'function') throw new Error(`${def.id}: verify(course, report, ctx) is required`);
  if (!['world', 'interior'].includes(def.placement || 'interior')) throw new Error(`${def.id}: placement is world or interior`);
  if ((def.placement || 'interior') === 'interior' && !(Number.isSafeInteger(def.price) && def.price > 0)) throw new Error(`${def.id}: an interior module has a price (hundredths of a VC)`);
  if (MODULES.has(def.id)) for (const b of MODULES.get(def.id).badges) BADGES.delete(b.id);   // re-registering (tests)
  const badges = Object.freeze((def.badges || []).map(b => badge(b, def.id)));
  const m = Object.freeze({
    venue: null, xp: defaultXp, placement: 'interior', price: null, ...def, score: Object.freeze({ unit: sc.kind === 'time' ? 's' : 'pts', ...sc }),
    courses: Object.freeze(def.courses.map(c => Object.freeze({ tier: 'standard', ...c, stars: Object.freeze([...c.stars]) }))),
    badges,
  });
  MODULES.set(m.id, m);
  return m;
}
function defaultXp(result, course) {
  const base = 10 * course.difficulty * Math.max(1, result.stars);
  return Math.round(result.newBest ? base : base / 3);
}

export const playOf = id => MODULES.get(id) || null;
export const plays = () => [...MODULES.values()];
export const badgeOf = id => BADGES.get(id) || null;
export const allBadges = () => [...BADGES.values()];
export const courseOf = (m, id) => (typeof m === 'string' ? playOf(m) : m)?.courses.find(c => c.id === id) || null;

/** Is result a better than b for module m (a and b are scores; null b: anything is better)? */
export const better = (m, a, b) => b == null || (m.score.better === 'lower' ? a < b : a > b);
/** Stars for a score against a course's three thresholds (time: at most; points: at least). */
export function starsFor(m, course, score) {
  const [t1, t2, t3] = course.stars, low = m.score.better === 'lower';
  const ok = t => (low ? score <= t : score >= t);
  return ok(t3) ? 3 : ok(t2) ? 2 : ok(t1) ? 1 : 0;
}
/** Which courses a player may start: best = { courseId: { stars } }. */
export const unlocked = (m, best = {}) => m.courses.filter(c => !c.after || (best[c.after]?.stars || 0) >= 1).map(c => c.id);

/** What the browser sees of a module (verify, xp and the badge rules stay functions on each side). */
export function publicPlay(m) {
  return { id: m.id, version: m.version, label: m.label, icon: m.icon, blurb: m.blurb, venue: m.venue, score: m.score, placement: m.placement, price: m.price,
    courses: m.courses.map(c => ({ id: c.id, label: c.label, tier: c.tier, difficulty: c.difficulty, after: c.after || null, stars: c.stars, blurb: c.blurb || '' })),
    badges: m.badges.map(publicBadge) };
}
export const publicBadge = b => ({ id: b.id, label: b.label, icon: b.icon, desc: b.secret ? 'A secret — keep playing' : b.desc, tier: b.tier, module: b.module, secret: !!b.secret });
/** Formats a score the way the module counts it (time: 1:05.32; points: 1,250 pts). */
export function formatScore(m, v) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (m.score.kind === 'time') { const s = Math.max(0, v), mm = Math.floor(s / 60), ss = (s - mm * 60).toFixed(2).padStart(5, '0'); return mm ? `${mm}:${ss}` : `${(+ss).toFixed(2)} s`; }
  return `${Math.round(v).toLocaleString('en-US')} ${m.score.unit}`;
}

// ------------------------------------------------------------------------------------------- prizes in Virtual Coin
/** The economy's prize rules when it has none (server/economy/policy.js play: the same numbers). Amounts in hundredths. */
export const PRIZE_DEFAULTS = Object.freeze({ on: true, base: 300, repeatPct: 40, firstStarPct: 100, recordPct: 150, dailyCap: 40000 });
/** What each star count is worth, × base × the course's weight (a 0★ finish still pays a little for trying). */
export const STAR_PAY = Object.freeze([0.3, 1, 1.6, 2.5]);
/** How much a course pays: its difficulty, unless the module weighs its courses itself (prizeWeight). */
export const prizeWeight = (m, course) => (typeof m.prizeWeight === 'function' ? m.prizeWeight(course) : course.difficulty);
/**
 * A run's prize (hundredths of a VC) and how it is made up: { amount, parts: [{ label, amount }] }.
 * run: { stars, newBest, prevStars (the course's best stars before), place, prevPlace }. Harder courses and more stars pay
 * more; a repeat without a new best pays repeatPct of the run's part; stars earned on a course for the first time pay a
 * bonus each; taking first place (with two stars or more) pays a record bonus.
 */
export function prizeFor(m, course, run, rules = PRIZE_DEFAULTS) {
  const r = { ...PRIZE_DEFAULTS, ...(rules || {}) };
  if (!r.on || !(r.base > 0)) return { amount: 0, parts: [] };
  const unit = r.base * prizeWeight(m, course), parts = [];
  const s = Math.max(0, Math.min(3, run.stars | 0));
  parts.push({ label: run.newBest ? `${s}★ run` : `${s}★ run (repeat)`, amount: Math.round(unit * STAR_PAY[s] * (run.newBest ? 1 : r.repeatPct / 100)) });
  const fresh = Math.max(0, s - (run.prevStars | 0));
  if (fresh) parts.push({ label: fresh === 1 ? 'New star' : `${fresh} new stars`, amount: Math.round(unit * fresh * r.firstStarPct / 100) });
  if (run.newBest && run.place === 1 && s >= 2 && run.prevPlace !== 1) parts.push({ label: 'New record', amount: Math.round(unit * r.recordPct / 100) });
  const ok = parts.filter(p => p.amount > 0);
  return { amount: ok.reduce((a, p) => a + p.amount, 0), parts: ok };
}
/** The most a course pays on a first three-star record run (what the course list shows). */
export const prizeTop = (m, course, rules) => prizeFor(m, course, { stars: 3, newBest: true, prevStars: 0, place: 1, prevPlace: null }, rules).amount;
/** A VC amount from hundredths, for people: "12.50 VC". */
export const fmtVc = h => `${(Math.round(h) / 100).toLocaleString('en-US', { minimumFractionDigits: h % 100 ? 2 : 0, maximumFractionDigits: 2 })} VC`;

// ------------------------------------------------------------------------------------------- the platform's badges
// stats for these are the player's overall: { modules: { id: { runs, xp, level } }, runs, xp, level, stars, courses }
export const PLATFORM_BADGES = Object.freeze([
  { id: 'first_play', label: 'First steps', icon: '🎈', desc: 'Finish a run in any module', tier: 'bronze', when: s => s.runs >= 1 },
  { id: 'regular', label: 'Regular', icon: '🎟️', desc: 'Finish 25 runs in any modules', tier: 'silver', when: s => s.runs >= 25 },
  { id: 'all_rounder', label: 'All-rounder', icon: '🧭', desc: 'Finish a run in three different modules', tier: 'gold', when: s => Object.values(s.modules).filter(x => x.runs > 0).length >= 3 },
  { id: 'level_5', label: 'Getting good', icon: '⭐', desc: 'Reach player level 5 (Bronze rank)', tier: 'bronze', when: s => s.level >= 5 },
  { id: 'level_10', label: 'Seasoned', icon: '🌟', desc: 'Reach player level 10 (Silver rank)', tier: 'silver', when: s => s.level >= 10 },
  { id: 'level_15', label: 'Gold standard', icon: '🏅', desc: 'Reach player level 15 (Gold rank)', tier: 'gold', when: s => s.level >= 15 },
  { id: 'level_25', label: 'Platinum', icon: '💠', desc: 'Reach player level 25 (Platinum rank)', tier: 'platinum', when: s => s.level >= 25 },
  { id: 'star_collector', label: 'Star collector', icon: '✨', desc: 'Collect 30 stars across all courses', tier: 'gold', when: s => s.stars >= 30 },
  { id: 'podium', label: 'On the podium', icon: '🏆', desc: 'Take a top-3 place on any leaderboard with a two-star run or better', tier: 'gold', when: (s, run) => !!run && run.place != null && run.place <= 3 && run.stars >= 2 },
].map(b => badge(b)));
