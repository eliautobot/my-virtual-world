// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The fishing module (docs/features/fishing.md): a trip from a dock is a run of one of its courses (shared/fishing-trip.js
// TRIPS). The server lays the trip out from the run's seed over the water round the dock it starts at (prepare), keeps
// the trip's catch itself (init → the run's state, never sent), and answers the browser's moves on the water through
// the play core's in-run actions: hook (a fish took: the server rolls what it is with its own secret), land (the fight
// was won - no sooner than that gear could have won it: shared/fishing-fight.js minFightSeconds), lose (the line broke,
// the hook pulled), keep / release (the cooler). verify() sells the server's own list of the catch: the trip's score.
// Shared by the server and the browser.
import { registerPlay } from './play.js';
import { RNG } from './rng.js';
import { TRIPS, TRIP_BY_ID, generateTrip, rollBite, tripValue, groundPos } from './fishing-trip.js';
import { speciesOf, findOf, FINDS } from './fish-species.js';
import { loadout, LURE_BY_ID } from './fishing-gear.js';
import { minFightSeconds } from './fishing-fight.js';

export const HOOK_GAP_MS = 2500;      // the least time between two hooks (a cast, a wait, a strike)
export const AFTER_DUSK_MIN = 20;      // minutes past dusk a trip still takes a hook (lights or not: then it's over)
const SLACK_MS = 400;                  // the server's slack under the fastest possible fight

const r2 = v => Math.round(v * 100) / 100;
const err = (why, status = 400) => ({ error: why, status });
/** Minutes into the trip at a server time. */
const minuteOf = ctx => ctx.serverMs / 60000;
/** The world's hour at a time in the trip: data.clock = { hour0, perMin (world hours a real minute) }. */
export const hourAt = (data, minute) => (((data.clock?.hour0 ?? 9) + minute * (data.clock?.perMin ?? 0)) % 24 + 24) % 24;

/**
 * A trip's own day: from early morning (late afternoon for a dusk trip) to dusk (19:30) over the trip's minutes - the
 * fish feed by it (shared/fishing-trip.js activity), and the catch keeps fresh until it.
 */
export const DUSK = 19.5;
export function tripClock(course) { const hour0 = course.dusk ? 16 : 6.5; return { hour0, perMin: (DUSK - hour0) / course.minutes }; }
/** The angler's loadout on this water's boat: the lake skiff carries 70 % of the sea boat's cooler. */
export function kitFor(kit, water) {
  const L = loadout(kit);
  if (water === 'lake') L.boat = { ...L.boat, cooler: Math.round(L.boat.cooler * 0.7) };
  return L;
}
/** How many of a bait or lure the angler still has on this trip (the kit's count less what the trip used up). */
const left = (state, lure) => (state.kit.lures ? Math.max(0, (state.kit.lures[lure] || 0) - (state.used?.[lure] || 0)) : Infinity);
/** What the cooler holds now: the slots of the kept fish (finds take one each). */
export const coolerUsed = caught => caught.filter(c => c.kept).reduce((a, c) => a + (c.slots || 1), 0);

/**
 * The module's own actions in a run (server/play/play.js act): name, body, ctx = { course, data, state, secret,
 * serverMs }. Each returns its answer for the browser, or { error, status }.
 */
function act(name, body, ctx) {
  const { course, data, state } = ctx, plan = data.plan, L = kitFor(state.kit, plan.water), minute = minuteOf(ctx);
  if (name === 'hook') {
    if (minute > course.minutes + AFTER_DUSK_MIN) return err('It\'s dark - the trip is over. Head back to the dock to sell your catch.', 409);
    if (ctx.serverMs - state.lastHook < HOOK_GAP_MS) return err('Too quick', 429);
    const lure = String(body.lure || ''), lu = LURE_BY_ID[lure];
    if (!lu || (lu.water !== 'both' && lu.water !== plan.water)) return err('Not a lure for this water');
    state.used ||= {};
    if (left(state, lure) <= 0) return err(`You have no ${lu.name} left - the dock store sells more`, 409);
    if (lu.kind === 'troll' && !(L.boat.holders > 0)) return err('Trolling needs rod holders on the boat');
    let ground = plan.grounds.find(g => g.id === body.ground) || null;
    // the ground must be where the angler is (ctx.pos: the server's own idea of where they stand - the boat's helm or
    // deck): within its circle, the line's length and some slack; else it's open water
    if (ground && ctx.pos) { const p = groundPos(ground, minute, plan.water); if (Math.hypot(p.x - ctx.pos.x, p.z - ctx.pos.z) > ground.r + Math.min(+body.d0 || 0, L.reach * 1.3) + 25) ground = null; }
    const fished = ground && (state.fished[ground.id] || 0) >= ground.fish;
    const n = ++state.hooks, rng = new RNG(`${ctx.secret}:hook:${n}`);
    const what = rollBite(rng, fished ? null : ground, { lure, hour: hourAt(data, minute), difficulty: course.difficulty, luck: L.luck, minute, legend: plan.legend, water: plan.water, size: course.size, trolling: lu.kind === 'troll', maxKg: L.maxKg });
    state.lastHook = ctx.serverMs;
    if (!what) { state.hooked = null; return { hook: null, why: 'Nothing took it' }; }
    if (lu.bait) state.used[lure] = (state.used[lure] || 0) + 1;   // a fish took the bait
    const d0 = Math.max(3, Math.min(L.reach * 1.15 + 40, +body.d0 || L.reach * 0.7));
    state.hooked = { n, at: ctx.serverMs, what, ground: ground?.id || null, lure, d0, seed: rng.int(1, 2 ** 31 - 2) };
    return { hook: n, what, seed: state.hooked.seed, d0, left: left(state, lure) };
  }
  if (name === 'land') {
    const h = state.hooked;
    if (!h || h.n !== body.hook) return err('That fish got away', 409);
    state.hooked = null;
    const isFind = h.what.kind === 'find', sp = !isFind && speciesOf(h.what.species);
    const least = isFind ? Math.max(0, h.d0 - 3) / (L.speed * 2.55) * 0.8 : minFightSeconds(sp, h.what.kg, L, h.d0);
    if (ctx.serverMs - h.at < least * 1000 - SLACK_MS) return err('That fish came in too fast - it got away', 422);
    if (h.ground) state.fished[h.ground] = (state.fished[h.ground] || 0) + 1;
    const c = isFind
      ? { n: h.n, find: h.what.id, kg: findOf(h.what.id)?.kg || 0, slots: 1, ground: h.ground, lure: h.lure, at: r2(minuteOf(ctx)) }
      : { n: h.n, species: sp.id, u: h.what.u, cm: h.what.cm, kg: h.what.kg, size: h.what.size, slots: h.what.slots, ground: h.ground, lure: h.lure, at: r2(minuteOf(ctx)), legend: !!sp.legend };
    const room = (L.boat.cooler || 12) - coolerUsed(state.caught);
    c.kept = (c.slots || 1) <= room;
    state.caught.push(c);
    let reveal = null;
    if (c.find === 'bottle') { const hid = plan.grounds.filter(g => g.hidden && !state.revealed.includes(g.id)); if (hid.length) { reveal = new RNG(`${ctx.secret}:bottle:${h.n}`).pick(hid).id; state.revealed.push(reveal); } }
    return { caught: c, full: !c.kept, cooler: { used: coolerUsed(state.caught), size: L.boat.cooler }, reveal };
  }
  if (name === 'lose') {
    const h = state.hooked;
    if (h && h.n === body.hook) {
      state.hooked = null;
      if (body.why === 'snap') { state.lost[h.lure] = (state.lost[h.lure] || 0) + 1; if (!LURE_BY_ID[h.lure]?.bait) { state.used ||= {}; state.used[h.lure] = (state.used[h.lure] || 0) + 1; } }
      return { ok: true, left: left(state, h.lure) };
    }
    return { ok: true };
  }
  if (name === 'keep' || name === 'release') {
    const c = state.caught.find(x => x.n === body.n);
    if (!c) return err('No such fish');
    if (name === 'release') { if (c.kept) state.released++; c.kept = false; c.released = true; }
    else { if (!c.kept && (c.slots || 1) > (L.boat.cooler || 12) - coolerUsed(state.caught)) return err('No room in the cooler - release something first', 409); c.kept = true; c.released = false; }
    return { cooler: { used: coolerUsed(state.caught), size: L.boat.cooler } };
  }
  return err('Unknown action');
}

/** The trip's result from the server's own catch (the browser's report is not needed: everything is in the state). */
function verify(course, report, ctx) {
  const { data, state } = ctx, L = kitFor(state.kit, data.plan.water);
  const lateMin = Math.max(0, ctx.serverMs / 60000 - course.minutes);
  const v = tripValue(course, data.plan, state.caught, { lateMin, boat: L.boat, trader: L.trader });
  const kept = v.items.filter(i => i.species), best = kept.reduce((b, i) => (!b || i.kg > b.kg ? i : b), null);
  return {
    ok: true, score: v.score, ms: ctx.serverMs,
    detail: {
      used: { ...(state.used || {}) },   // bait a fish took and lures lost: they leave the inventory (server/play/angler.js)
      fish: v.fish, finds: v.finds, released: state.released, value: v.value, bonus: v.bonus, sale: v.sale, fresh: r2(v.fresh), bounties: v.bounties,
      species: [...new Set(kept.map(i => i.species))], trophies: kept.filter(i => i.size === 'trophy').length, legends: kept.filter(i => speciesOf(i.species)?.legend).map(i => i.species),
      maxKg: best ? best.kg : 0, best: best ? { species: best.species, kg: best.kg, cm: best.cm } : null, cooler: coolerUsed(state.caught), coolerSize: L.boat.cooler,
      // (compact - the run's record keeps 6000 characters: what, cm, kg, worth (VC, freshness and the trader's skill in), size)
      items: v.items.slice(0, 30).map(i => [i.species || i.find, i.cm || 0, i.kg, Math.round(i.vc * (1 + (L.trader || 0)) * 100) / 100, i.size || '']),
      bonusSale: r2(v.bonus * (1 + (L.trader || 0))),
      // every species landed, kept or let go - [species, how many, the biggest's kg and cm] - for the Fishdex and the
      // world records (server/play/angler.js); and how many came in after dusk (Night owl)
      landed: landedOf(state.caught), night: state.caught.filter(c => c.species && c.at > course.minutes).length,
    },
  };
}

/** The species landed on a trip (kept or let go): [[species, n, kg, cm] of the biggest], at most 40. */
function landedOf(caught) {
  const by = new Map();
  for (const c of caught) {
    if (!c.species) continue;
    const b = by.get(c.species) || [c.species, 0, 0, 0];
    b[1]++; if (c.kg > b[2]) { b[2] = c.kg; b[3] = c.cm; }
    by.set(c.species, b);
  }
  return [...by.values()].slice(0, 40);
}
/** Experience: by the trip's difficulty, its stars, every fish kept and every one let go. */
function xp(result, course) {
  const d = result.detail || {}, base = course.difficulty * (6 * Math.max(1, result.stars) + 2 * (d.fish || 0) + 1.5 * (d.released || 0)) + 40 * (d.legends?.length || 0);
  return Math.round(result.newBest ? base : base * 0.6);
}

const tripsOf = water => TRIPS.filter(t => t.water === water).map(t => t.id);
const starsAll = (s, ids) => ids.every(id => (s.best[id]?.stars || 0) >= 3);

export const FISHING = registerPlay({
  id: 'fishing', version: 1, label: 'Fishing', icon: '🎣', venue: 'dock', placement: 'world',
  blurb: 'Take a boat out from a marina or a lake dock, find the fish, fight them and sell your catch.',
  score: { kind: 'points', unit: 'VC', better: 'higher' },
  courses: TRIPS,
  prizeWeight: c => c.difficulty * 0.5,   // the catch's sale is the real pay; a small prize for new stars
  /**
   * The trip, laid out over the water round the dock the run starts at. ctx (server/index.mjs playContext): { dock:
   * { id, kind, x, z }, water: 'sea' | 'lake', sites (shared/fishing-trip.js groundSites), clock: { hour0, perMin }, kit }.
   */
  prepare(course, ctx) {
    const sites = ctx?.sitesFor ? ctx.sitesFor(course) : ctx?.sites;
    if (!ctx?.dock || !sites || ctx.water !== course.water) return null;
    const seed = ctx.seed ?? Math.floor(Math.random() * 2 ** 31);
    return { seed, dock: ctx.dock, clock: ctx.clock || tripClock(course), plan: generateTrip(course, seed, sites), kit: ctx.kit || {} };
  },
  init: (course, data, ctx) => ({ kit: ctx?.kit || {}, hooks: 0, lastHook: -1e9, hooked: null, caught: [], fished: {}, released: 0, revealed: [], lost: {}, used: {} }),
  act,
  verify,
  xp,
  badges: [
    { id: 'first_catch', label: 'First catch', icon: '🐟', desc: 'Bring a fish home from a fishing trip', tier: 'bronze', when: (s, run) => (run?.detail?.fish || 0) >= 1 },
    { id: 'full_cooler', label: 'Full cooler', icon: '🧊', desc: 'Come home with the cooler full', tier: 'bronze', when: (s, run) => run?.detail && run.detail.cooler >= run.detail.coolerSize },
    { id: 'trophy_hunter', label: 'Trophy hunter', icon: '👑', desc: 'Land a trophy-size fish', tier: 'silver', when: (s, run) => (run?.detail?.trophies || 0) >= 1 },
    { id: 'bounty_hunter', label: 'Bounty hunter', icon: '📜', desc: 'Meet every bounty of a trip', tier: 'silver', when: (s, run) => run?.detail && run.detail.bounties.length >= 2 && run.detail.bounties.length === (TRIP_BY_ID[run.course]?.difficulty >= 5 ? 3 : 2) },
    { id: 'catch_release', label: 'Catch and release', icon: '🫶', desc: 'Let five fish go on one trip', tier: 'bronze', when: (s, run) => (run?.detail?.released || 0) >= 5 },
    { id: 'big_game', label: 'Big game', icon: '🦈', desc: 'Land a fish over 100 kg', tier: 'gold', when: (s, run) => (run?.detail?.maxKg || 0) >= 100 },
    { id: 'legend_slayer', label: 'Legend slayer', icon: '🐉', desc: 'Land a legend', tier: 'platinum', when: (s, run) => (run?.detail?.legends?.length || 0) >= 1 },
    { id: 'old_salt', label: 'Old salt', icon: '⚓', desc: 'Three stars on every sea trip', tier: 'gold', when: s => starsAll(s, tripsOf('sea')) },
    { id: 'lake_master', label: 'Lake master', icon: '🛶', desc: 'Three stars on every lake trip', tier: 'gold', when: s => starsAll(s, tripsOf('lake')) },
    { id: 'storm_rider', label: 'Storm rider', icon: '⛈️', desc: 'Three stars on the Storm Run', tier: 'platinum', when: s => (s.best['storm-run']?.stars || 0) >= 3 },
    { id: 'angler_50', label: 'Seasoned angler', icon: '🎣', desc: 'Finish 50 fishing trips', tier: 'silver', when: s => s.runs >= 50 },
    { id: 'night_owl', label: 'Night owl', icon: '🌙', desc: 'Land a fish after dusk', tier: 'bronze', when: (s, run) => (run?.detail?.night || 0) >= 1 },
    // (given by the angler's records when a trip is weighed in: server/play/angler.js afterTrip)
    { id: 'fishdex_10', label: 'Fishdex 10', icon: '📖', desc: 'Land ten different species', tier: 'bronze', granted: true, when: () => false },
    { id: 'fishdex_25', label: 'Fishdex 25', icon: '📖', desc: 'Land 25 different species', tier: 'silver', granted: true, when: () => false },
    { id: 'fishdex_50', label: 'Fishdex 50', icon: '📚', desc: 'Land 50 different species', tier: 'gold', granted: true, when: () => false },
    { id: 'fishdex_all', label: 'Complete Fishdex', icon: '🏅', desc: 'Land every species there is - the legends too', tier: 'platinum', granted: true, when: () => false },
    { id: 'record_breaker', label: 'Record breaker', icon: '🥇', desc: 'Set a world record: the biggest of a species anyone has landed', tier: 'gold', granted: true, when: () => false },
    { id: 'gentle_hands', label: 'Gentle hands', icon: '🫶', desc: 'Let 25 fish go back', tier: 'silver', granted: true, when: () => false },
    { id: 'fish_record', label: 'Record catch', icon: '🏆', desc: 'Take first place on a fishing leaderboard with a three-star trip', tier: 'platinum', when: (s, run) => run?.place === 1 && run.stars >= 3 },
  ],
});
export { TRIPS, TRIP_BY_ID, FINDS };
