// How a companion fishes (2026-11-19, the product owner: "the decision model should be the one 'fishing' and the brain model should be
// the one narrating"). Its plan for the water — the lure, how far it casts, how hard it plays a fish, which fish it keeps —
// is chosen by its own decision service (Free Will's decideNow, within that agent's daily limits) at the moments a person
// would think it over: the first cast, a few casts with nothing, a big one lost, a new ground under the boat, and every
// few minutes; between them every cast follows the plan. Whether it says something about it is that decision's too; the
// words are its brain's (server/companions/ remark). With no decision service for it (Free Will off, a limit reached, no
// answer in time): its habit — the lure this ground's fish come to soonest, a middling cast, a steady hand, all kept.
//
// The plan's effects are the fishing module's own: the lure decides what bites and how soon (shared/fishing-trip.js
// rollBite, biteEvery), the cast's length where it lands (a ground further off, or open water) and the fight's length,
// the hand how close to the drag it reels (shared/fishing-fight.js botInput push: harder is quicker, with more lines
// snapped), and the small fish let go keep the cooler's room for bigger ones.

import { LURE_BY_ID, luresFor } from '../../shared/fishing-gear.js';
import { biteEvery, groundAt, GROUNDS } from '../../shared/fishing-trip.js';
import { speciesOf } from '../../shared/fish-species.js';

/** The cast's length, as a share of the rod's reach (a random point within). */
export const REACH = Object.freeze({ close: [0.35, 0.55], mid: [0.55, 0.8], far: [0.82, 1] });
/** The hand on the reel: how close to the drag it lets the line come (shared/fishing-fight.js botInput push). */
export const FIGHT = Object.freeze({ easy: -1, steady: 0, hard: 1 });
export const KEEP = Object.freeze(['all', 'better']);
export const RETHINK_MS = 4 * 60e3;   // its plan thought over at least this often while it fishes
export const AGAIN_MS = 45e3;          // …and, for something that happened (casts with nothing, a big one lost), no sooner than this after the last
export const GROUND_AGAIN_MS = 20e3;   // …a new ground under the boat: this soon
export const DRY_CASTS = 3;            // this many casts with nothing: a reason to think again
export const THINK_MS = 4500;          // its answer awaited this long (the rod held ready meanwhile); then its habit
export const SAY_P = 0.5;              // it says a word about its plan when its "say" is at least this likely
const MAX_LURES = 8;

const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const left = (st, id) => (st?.kit?.lures ? Math.max(0, (st.kit.lures[id] || 0) - (st.used?.[id] || 0)) : Infinity);
const clock = h => { const hh = Math.floor(((h % 24) + 24) % 24), mm = Math.floor((h - Math.floor(h)) * 60); return `${hh}:${String(mm).padStart(2, '0')}`; };
const pace = s => (s < 15 ? 'they bite fast on it here now' : s < 40 ? 'a bite now and then on it here' : s < 90 ? 'slow on it here now' : 'hardly anything here takes it now');
const groundWords = g => (g ? `${GROUNDS[g.kind]?.label || g.kind}${g.name ? ` (${clean(g.name, 30)})` : ''}` : 'open water — no fishing ground');

/** The lures it has left that suit this water (trolling is the skipper's: rod holders), the soonest bite on `ground` first:
 *  [{ id, name, icon, kind, left, every (s) }]. */
export function lureChoices(run, ground, hour) {
  const plan = run?.data?.plan, st = run?.state;
  if (!plan) return [];
  const out = [];
  for (const l of luresFor(plan.water)) {
    if (l.kind === 'troll') continue;
    const n = left(st, l.id);
    if (!(n > 0)) continue;
    out.push({ id: l.id, name: l.name, icon: l.icon, kind: l.kind, left: n, every: biteEvery(ground, l.id, hour, plan.water) });
  }
  return out.sort((a, b) => a.every - b.every).slice(0, MAX_LURES);
}
/** Its habit (no decision for it): the soonest-biting lure where each cast lands (lure null), a middling cast, steady. */
export const habit = () => ({ lure: null, reach: 'mid', fight: 'steady', keep: 'all', by: 'habit' });

/** Whether it is time to think its plan over (m: the crew member; t: ms now; ground: the one under the boat, or null;
 *  choices: lureChoices): → the reason ('start' | 'bait' | 'dry' | 'lost' | 'ground' | 'time') or null. */
export function due(m, t, ground, choices) {
  const P = m.plan;
  if (!P) return 'start';
  const since = t - (P.at || 0);
  if (P.lure && !choices.some(c => c.id === P.lure)) return 'bait';
  if ((ground?.id || null) !== (P.ground ?? null) && since >= GROUND_AGAIN_MS) return 'ground';
  if (m.lostBig && since >= AGAIN_MS) return 'lost';
  if ((m.dry || 0) >= DRY_CASTS && since >= AGAIN_MS) return 'dry';
  if (since >= RETHINK_MS) return 'time';
  return null;
}
const REASONS = {
  start: 'The trip has begun: the first cast.',
  bait: 'The bait it was using has run out.',
  ground: 'The boat has moved: different water under it now.',
  lost: 'A big fish just got away.',
  dry: 'Several casts in a row with nothing.',
  time: 'A few minutes have gone by: time to look at how it is going.',
};

/** How the trip is going for one angler, in words: "landed 3 (2 on Live Shrimp), kept 3, best a 1.3 kg Ladyfish". */
export function tallyWords(caught) {
  const fish = (caught || []).filter(c => c.species);
  if (!fish.length) return 'nothing yet';
  const kept = fish.filter(c => c.kept), by = new Map();
  for (const c of fish) by.set(c.lure, (by.get(c.lure) || 0) + 1);
  const top = [...by].sort((a, b) => b[1] - a[1])[0], best = fish.reduce((b, c) => (!b || c.kg > b.kg ? c : b), null);
  return `landed ${fish.length}${top && LURE_BY_ID[top[0]] ? ` (${top[1]} on ${LURE_BY_ID[top[0]].name})` : ''}, kept ${kept.length}${best ? `, best ${best.kg.toFixed(best.kg < 10 ? 1 : 0)} kg ${speciesOf(best.species)?.name || best.species}` : ''}`;
}

/**
 * The decision request (the Decisions shape: { input, questions }). s: { name, who (lines about it), owner, spot, boat,
 * trip (label), water, hour, minute, minutes, reach (m: its rod's), grounds ({ close, mid, far }: the ground each lands
 * on, or null), choices, mine (its caught list), crew ([{ name, caught }]), cooler ({ used, size }), lost, dry, plan (its
 * plan till now, or null), reason, level }.
 */
export function request(s) {
  const name = clean(s.name, 40), owner = clean(s.owner, 40);
  const m = Math.max(0, Math.round(s.minutes - s.minute));
  const input = [
    `WHO: ${s.who || name}`,
    `FISHING: ${name} is on ${owner}'s boat (${clean(s.boat, 40)}), fishing from the ${clean(s.spot, 20)} on the trip "${clean(s.trip, 40)}" — ${s.water === 'lake' ? 'a lake' : 'the sea'}, ${clock(s.hour)}, ${m > 0 ? `about ${m} minute${m === 1 ? '' : 's'} till dusk` : 'dusk: the trip is ending'}. Fishing level ${s.level || 1}.`,
    `${name.toUpperCase()} SO FAR: ${tallyWords(s.mine)}${s.lost ? `; ${s.lost} lost` : ''}${s.dry ? `; ${s.dry} cast${s.dry === 1 ? '' : 's'} in a row with nothing` : ''}. Cooler ${s.cooler?.used ?? 0}/${s.cooler?.size ?? 12}.`,
    ...(s.crew?.length ? [`THE OTHERS: ${s.crew.map(c => `${clean(c.name, 30)} — ${tallyWords(c.caught)}`).join('; ')}.`] : []),
    `JUST NOW: ${REASONS[s.reason] || REASONS.time}`,
    ...(s.plan && s.plan.by === 'model' ? [`ITS PLAN TILL NOW: ${planWords(s.plan)}.`] : []),
  ].join('\n');
  const g = s.grounds || {}, at = k => Math.round(s.reach * (REACH[k][0] + REACH[k][1]) / 2);
  const questions = [
    { type: 'choice', name: 'lure', instructions: `Which lure or bait does ${name} put on now? (What fish come to depends on the lure, the ground and the hour.)`,
      choices: s.choices.map(c => ({ value: c.id, description: `${c.icon} ${c.name} (${c.kind === 'float' ? 'under a float' : c.kind === 'bottom' ? 'on the bottom' : 'cast and retrieved'}${Number.isFinite(c.left) ? `, ${c.left} left` : ''}) — ${pace(c.every)}` })) },
    { type: 'choice', name: 'cast', instructions: `How far does ${name} cast?`, choices: [
      { value: 'close', description: `Close, about ${at('close')} m — onto ${groundWords(g.close)}; quick to reel in` },
      { value: 'mid', description: `Middle, about ${at('mid')} m — onto ${groundWords(g.mid)}` },
      { value: 'far', description: `Far, about ${at('far')} m — onto ${groundWords(g.far)}; longer fights` }] },
    { type: 'choice', name: 'fight', instructions: `When a fish is on, how does ${name} play it?`, choices: [
      { value: 'easy', description: 'Easy — light pressure, the line never near its limit: slower fights' },
      { value: 'steady', description: 'Steady — the usual' },
      { value: 'hard', description: 'Hard — crank it in through its runs: quicker fights (a big one tires before it gets free), more lines snapped' }] },
    { type: 'choice', name: 'keep', instructions: `Which fish does ${name} keep?`, choices: [
      { value: 'all', description: `Keeps everything it lands (while there is room in the cooler: ${s.cooler?.used ?? 0}/${s.cooler?.size ?? 12})` },
      { value: 'better', description: 'Lets the small ones go — the room for bigger fish' }] },
    { type: 'choice', name: 'speak', instructions: `Does ${name} say something out loud about it now?`, choices: [
      { value: 'quiet', description: 'Says nothing — just fishes' },
      { value: 'say', description: 'Says a word about it, in their own words' }] },
  ];
  return { input, questions };
}
/** A plan in a few words: "Live Shrimp, a middle cast, steady, keeping everything". */
export function planWords(P) {
  const l = P.lure ? LURE_BY_ID[P.lure]?.name || P.lure : 'whatever suits the water';
  return `${l}, a ${P.reach === 'mid' ? 'middle' : P.reach} cast, playing them ${P.fight}${P.keep === 'better' ? ', letting the small ones go' : ', keeping everything'}`;
}
/** Its answers → { plan, say, conf } (anything it didn't answer, or out of the offered: its plan till now, or its habit). */
export function readAnswers(answers, choices, was = null) {
  const ans = n => (answers || []).find(x => x && x.name === n && x.type === 'choice');
  const p = (a, v) => (a?.probabilities || []).find(x => x.value === v)?.probability ?? (a?.choice === v ? a.confidence ?? 1 : 0);
  const base = was && was.by === 'model' ? was : habit();
  const lu = ans('lure')?.choice, ca = ans('cast')?.choice, fi = ans('fight')?.choice, ke = ans('keep')?.choice, sp = ans('speak');
  const lure = choices.some(c => c.id === lu) ? lu : (base.lure && choices.some(c => c.id === base.lure) ? base.lure : choices[0]?.id || null);
  const plan = { lure, reach: REACH[ca] ? ca : base.reach, fight: FIGHT[fi] !== undefined ? fi : base.fight, keep: KEEP.includes(ke) ? ke : base.keep, by: 'model' };
  return { plan, say: sp?.choice === 'say' && p(sp, 'say') >= SAY_P, conf: ans('lure')?.confidence ?? null, answered: !!lu };
}
/** What it says (its brain's words): the situation for its remark, when its plan changed (or the first one). */
export function narration(s, P, was, reason) {
  const l = LURE_BY_ID[P.lure]?.name || 'my usual bait';
  const changed = !was || was.lure !== P.lure || was.reach !== P.reach;
  if (!changed && reason !== 'start') return null;
  const why = { start: '', bait: ' — my bait ran out', ground: ' — new water under the boat', lost: ' after that big one got away', dry: ' — nothing was biting', time: '' }[reason] || '';
  return `Fishing from ${clean(s.owner, 40)}'s boat: I ${was && was.lure !== P.lure ? `switch to ${l}` : `fish with ${l}`}, a ${P.reach === 'mid' ? 'middle' : P.reach} cast${P.fight !== 'steady' ? `, playing them ${P.fight}` : ''}${P.keep === 'better' ? ', letting the small ones go' : ''}${why}.`;
}
/** The ground each cast length lands on from spot `at` (castPoint(d0) → { x, z }). */
export function groundsByReach(plan, castPoint, reach, minute) {
  const out = {};
  for (const k of Object.keys(REACH)) { const p = castPoint(reach * (REACH[k][0] + REACH[k][1]) / 2); out[k] = groundAt(plan, p.x, p.z, minute); }
  return out;
}
