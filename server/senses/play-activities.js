// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Play, in an agent's senses (docs/features/awareness.md §5): what a player — or an agent playing as −its id — is doing in
// a play module right now, as a card for ./activities.js, and what was worth noticing in it (a fish landed, a Rush done,
// a high score, a lesson passed) written in the diaries of the AI agents with them.
//
//   the card    from the run the play core (server/play/play.js) keeps: fishing from the run's own state (the server's
//               dice and the catch: what is on the line, what came up, the cooler), the others from the moments their
//               pages report (POST /api/play/moment: Order Up's Rush, the arcade's score, the airport's rings); an
//               agent's own kitchen shift (an unattended run) from its course and clock. A module with no words of
//               its own: "playing «Module» («Course») for N min".
//   the diary   the play core's events (act, finish): senses.noteNear(account, text) for a player (the agents with them
//               see it), senses.note(agentId, 'activity', text) for an agent's own run.
//
// A module adds its words to WORDS (card, act, done, until, staleMs); nothing else changes.
import { playOf, courseOf, formatScore } from '../../shared/play.js';
import { speciesOf, findOf } from '../../shared/fish-species.js';
import { kitFor, coolerUsed, AFTER_DUSK_MIN } from '../../shared/fishing.js';
import { COURSES as RUSHES } from '../../shared/orderup/module.js';
import { AIRCRAFT } from '../../shared/aircraft-specs.js';
import { clean, q } from './where.js';

export const STALE_MS = 4 * 60e3;   // a player's run with no word from its page this long is not told about (a page shut mid-run)
const SINCE_MS = 30e3;              // a moment older than this is said with its age

// ------------------------------------------------------------------------------------------- words
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A while in words: "under a minute", "1 min", "12 min". */
export const minutes = ms => (ms < 60e3 ? 'under a minute' : `${Math.round(ms / 60e3)} min`);
/** Seconds as a clock: 1:05. */
const clock = s => { const v = Math.max(0, Math.round(Number(s) || 0)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
/** A weight as an angler says it: 350 g, 2.1 kg, 48 kg. */
export const kgWords = kg => { const v = Number(kg) || 0; return v < 0.1 ? `${Math.max(1, Math.round(v * 1000))} g` : v < 10 ? `${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '')} kg` : `${Math.round(v)} kg`; };
const num = v => Math.round(Number(v) || 0).toLocaleString('en-US');
const money = v => `$${(Math.round((Number(v) || 0) * 100) / 100).toFixed(2)}`;
const starsWords = n => (n > 0 ? `${'★'.repeat(n)}${'☆'.repeat(3 - n)}` : 'no stars');
const article = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');
// (place names keep their capital in a species' name: a Caribbean reef squid, a Spanish mackerel)
const PROPER = new Set(['Atlantic', 'Pacific', 'Caribbean', 'Florida', 'Spanish', 'Gulf', 'Nassau', 'Mexican', 'European', 'American', 'Japanese', 'African', 'Arctic', 'Amazon', 'Alaskan', 'Chinook', 'Coho']);
/** A species' name in a sentence: "largemouth bass", "Caribbean reef squid" (a legend keeps its own name). */
export const fishName = sp => (sp?.legend ? clean(sp.name, 40) : clean(sp?.name || 'fish', 40).split(' ').map(w => (PROPER.has(w) ? w : w.toLowerCase())).join(' '));
/** One catch: "a 2.1 kg largemouth bass", "an old boot". */
export function catchWords(c) {
  if (!c) return 'something';
  if (c.find) { const n = clean(findOf(c.find)?.name || 'find', 40).toLowerCase(); return `${article(n)} ${n}`; }
  const sp = speciesOf(c.species), w = kgWords(c.kg);
  return sp?.legend ? `${clean(sp.name, 40)} (${w}, a legend)` : `${article(w)} ${w} ${fishName(sp)}${c.size === 'trophy' ? ' (trophy size)' : ''}`;
}
/** A game's own count in words: bestStreak → "best streak". */
const countWords = k => k.replace(/([A-Z])/g, ' $1').toLowerCase();

// ------------------------------------------------------------------------------------------- each module's words
// x (what the words are about): { run, m (the module), c (the course), you (about the agent itself / 'you'), Who ('You' or
// a name), is ('are' or 'is'), place (a proper name, '' when it has none), ago(ms), now }
export const WORDS = {
  fishing: {
    staleMs: 10 * 60e3,
    until: (run, c) => run.at + ((c?.minutes || 20) + AFTER_DUSK_MIN + 5) * 60e3,
    card(x) {
      const { run, c } = x, st = run.state || {}, plan = run.data?.plan || {}, out = x.now - run.at, min = out / 60e3;
      const from = x.place ? ` from ${q(x.place, 40)}` : run.data?.dock?.kind === 'lakedock' ? ' from the lake dock' : run.data?.dock ? ' from the marina' : '';
      const caught = Array.isArray(st.caught) ? st.caught : [], kept = caught.filter(k => k.kept);
      let size = 0; try { size = kitFor(st.kit || {}, plan.water).boat.cooler || 0; } catch { size = 0; }
      const lines = [
        min <= c.minutes ? `${minutes(out)} into the ${c.minutes}-minute trip ${plan.water === 'lake' ? 'on the lake' : 'at sea'}` : 'past dusk: the trip is over, heading back to the dock to sell the catch',
      ];
      const h = st.hooked;
      if (h) {
        const fight = Math.max(0, Math.round((out - (h.at || 0)) / 1000)), big = h.what?.size === 'trophy' || h.what?.size === 'large';
        lines.push(h.what?.kind === 'find' ? `something on the line, reeling it in (${fight} s)` : `a fish on the line${big ? ' — a big one' : ''}, fighting it for ${fight} s`);
      }
      if (caught.length) {
        const last = caught.slice(-3).reverse().map(k => `${catchWords(k)}${k.released ? ' (let go)' : !k.kept && k.species ? ' (no room in the cooler)' : ''}`);
        lines.push(`caught ${caught.length} so far${size ? `, ${coolerUsed(caught)} of ${size} cooler slots used` : `, ${kept.length} kept`}; latest: ${last.join(', ')}`);
      } else lines.push('nothing caught yet');
      const lost = Object.values(st.lost || {}).reduce((a, n) => a + (Number(n) || 0), 0);
      if (lost) lines.push(`${plural(lost, 'line')} snapped so far`);
      return { title: `${x.Who} ${x.is} out fishing: ${q(c.label, 40)}${from}`, lines };
    },
    act(ev, x) {
      const r = ev.result || {}, st = ev.run.state || {};
      if (ev.name === 'land' && r.caught) {
        const k = r.caught;
        x.track(k.n, k.kept);
        return `${x.Who} ${k.find ? 'pulled up' : 'landed'} ${catchWords(k)}${!k.kept && k.species ? ' — no room left in the cooler' : ''}`;
      }
      if (ev.name === 'release') {
        const k = (st.caught || []).find(f => f.n === ev.body.n);
        if (!k?.species) return null;
        x.track(k.n, false);
        return `${x.Who} let ${catchWords(k).replace(/^an? /, 'the ')} go`;
      }
      if (ev.name === 'keep') {
        const k = (st.caught || []).find(f => f.n === ev.body.n);
        if (!k || x.seen(k.n) !== false) { if (k) x.track(k.n, true); return null; }   // (only a fish that wasn't in the cooler)
        x.track(k.n, true);
        return `${x.Who} kept ${catchWords(k).replace(/^an? /, 'the ')} after all`;
      }
      if (ev.name === 'lose' && 'left' in r) return `${x.Who} lost a fish — ${ev.body.why === 'snap' ? 'the line snapped' : 'it got away'}`;
      return null;
    },
    done(ev, x) {
      const d = ev.result.detail || {}, n = d.fish || 0, best = d.best ? catchWords({ species: d.best.species, kg: d.best.kg }) : '';
      return `${x.Who} came back from a fishing trip (${q(x.c.label, 40)}): ${n ? `${plural(n, 'fish', 'fish')} kept${best ? `, the biggest ${best}` : ''}` : 'nothing kept'}, ${starsWords(ev.result.stars)}`;
    },
  },
  orderup: {
    staleMs: 90e3,
    until: (run, c) => run.at + ((RUSHES.find(k => k.id === c?.id)?.dur || 300) + 90) * 1000,
    card(x) {
      const { run, c } = x, at = x.place ? ` at ${q(x.place, 50)}` : '', dur = RUSHES.find(k => k.id === c.id)?.dur || 180, L = run.live;
      const inS = Math.min(dur, (x.now - run.at) / 1000);
      if (run.auto) {   // an agent's own kitchen shift, or a Rush it chose (alone or alongside someone's): the server cooks it unattended (server/play/kitchen-shifts.js, kitchen-play.js)
        const why = run.chosen === 'along' ? 'alongside the Rush there, the same orders' : run.chosen ? `${x.you ? 'your' : 'its'} own choice` : `${x.you ? 'your' : 'a'} kitchen shift`;
        return { title: `${x.Who} ${x.is} cooking a Rush${at} (${why}: ${q(c.label, 30)})`,
          lines: [`${minutes(inS * 1000)} in, about ${minutes(Math.max(0, dur - inS) * 1000)} to go`] };
      }
      const title = `${x.Who} ${x.is} cooking a Rush in Order Up: ${q(c.label, 30)}${at}`;
      if (!L) return { title, lines: [`started ${minutes(x.now - run.at)} ago; no word from the kitchen yet`] };
      const age = x.now - (run.liveAt || run.at), as = age > SINCE_MS ? ` (as of ${minutes(age)} ago)` : '';
      const going = L.stars == null ? '' : ['struggling (no stars yet)', 'getting by (1★ pace)', 'going well (2★ pace)', 'going great (3★ pace)'][L.stars];
      return { title, lines: [
        L.over ? `the Rush is over${as}` : `${clock(L.t)} of ${clock(L.dur || dur)} in${as}`,
        `${L.served || 0} served, ${L.lost || 0} walked out, ${L.burns || 0} burnt`,
        L.waiting ? `${plural(L.waiting, 'order')} waiting${L.late ? ` (${L.late} about to walk out)` : ''}${L.orders?.length ? `: ${L.orders.map(o => clean(o, 32)).join(', ')}` : ''}` : 'no orders waiting',
        `${going ? `${going}: ` : ''}${num(L.points)} pts, ${money(L.money)} + ${money(L.tips)} tips`,
      ] };
    },
    done(ev, x) {
      const d = ev.result.detail || {}, at = x.place ? ` at ${q(x.place, 50)}` : '';
      return `${x.Who} finished ${x.you && ev.run.auto ? 'cooking ' : ''}${article(x.c.label)} ${x.c.label}${at}: ${starsWords(ev.result.stars)}, ${num(ev.result.score)} pts — ${d.served || 0} served, ${d.lost || 0} walked out${d.burns ? `, ${d.burns} burnt` : ''}`;
    },
  },
  arcade: {
    staleMs: 2 * 60e3,
    card(x) {
      const { run, c } = x, L = run.live, age = x.now - (run.liveAt || run.at);
      const lines = [];
      if (L) {
        lines.push(`${L.over ? 'game over, ' : ''}score ${num(L.score)}${run.best != null ? ` (best ${num(run.best)})` : ''}${L.lives != null ? `, ${plural(L.lives, 'life', 'lives')} left` : ''}${age > SINCE_MS ? ` (as of ${minutes(age)} ago)` : ''}`);
        const d = Object.entries(L.detail || {}).map(([k, v]) => `${countWords(k)} ${num(v)}`);
        if (d.length) lines.push(d.join(', '));
      } else lines.push(`just started${run.best != null ? `; best ${num(run.best)}` : ''}`);
      lines.push(`playing for ${minutes(x.now - run.at)}`);
      return { title: `${x.Who} ${x.is} playing ${q(c.label, 40)} at the arcade${x.place ? ` (${q(x.place, 50)})` : ''}`, lines };
    },
    done(ev, x) {   // (only a high score is worth noticing: a new personal best, or a place on the board's podium)
      const r = ev.result;
      if (x.you && ev.run.auto) return null;   // (an agent's own game at a machine: its line is server/play/arcade-crew.js's, all of it)
      if (!r.newBest && !(r.place != null && r.place <= 3)) return null;
      return `${x.Who} scored ${num(r.score)} on ${q(x.c.label, 40)}${r.newBest && r.prevBest ? ' — a new personal best' : ''}${r.place === 1 ? ', the top score on the board' : r.place != null && r.place <= 3 ? `, #${r.place} on the board` : ''}`;
    },
  },
  airport: {
    staleMs: 3 * 60e3,
    card(x) {
      const { run, c } = x, L = run.live, rings = L?.rings || run.data?.rings?.length || 0, craft = String(AIRCRAFT[c.aircraft]?.label || 'plane').toLowerCase();
      const lines = [L?.passed ? `through ${L.passed} of ${rings} rings, ${L.secs != null ? `${clock(L.secs)} on the clock` : 'on the clock'}` : `${rings} rings to fly; heading for the first`];
      if (Array.isArray(c.stars)) lines.push(`three stars under ${clock(c.stars[2])}, one under ${clock(c.stars[0])}`);
      return { title: `${x.Who} ${x.is} flying a lesson course: ${q(c.label, 40)} in ${article(craft)} ${craft}${x.place ? `, from ${q(x.place, 40)}` : ''}`, lines };
    },
    done(ev, x) {
      const r = ev.result, m = x.m, t = formatScore(m, r.score);
      return r.stars > 0 ? `${x.Who} passed the ${q(x.c.label, 40)} flying lesson in ${t}: ${starsWords(r.stars)}${r.newBest && r.prevBest ? ', a personal best' : ''}`
        : `${x.Who} flew the ${q(x.c.label, 40)} course in ${t}, too slow for a star`;
    },
  },
};
/** Any module without words of its own. */
export const GENERIC = {
  staleMs: STALE_MS,
  card: x => ({ title: `${x.Who} ${x.is} playing ${q(x.m.label, 30)} (${q(x.c.label, 40)})`, lines: [`for ${minutes(x.now - x.run.at)}`] }),
  done: (ev, x) => `${x.Who} finished ${q(x.m.label, 30)} (${q(x.c.label, 40)}): ${formatScore(x.m, ev.result.score)}, ${starsWords(ev.result.stars)}`,
};

// ------------------------------------------------------------------------------------------- the place
/**
 * Where a run is played, by name ('' when it has none): the world module it started from (a dock, an airport), the
 * kitchen's place (its b, f), else the place its player stands in.
 */
export function placeOf(run, { world = null, sim = null, players = null } = {}) {
  const d = run.data || {}, W = world || sim?.world || null;
  const wid = d.dock?.id ?? d.airport?.id;
  if (wid != null) return clean((W?.worldModules || []).find(m => m.id === wid)?.name, 40);
  const named = (b, f) => { try { return clean(sim?.brain?.placeName?.(b, f) || W?.buildings?.[b]?.name, 50); } catch { return ''; } };
  if (Number.isInteger(d.b) && d.b >= 0) return named(d.b, Number(d.f) || 0);
  const p = run.account > 0 ? players?.byId?.get(run.account) : null;
  return p && p.ctx >= 0 ? named(p.ctx >> 6, p.ctx & 63) : '';
}

// ------------------------------------------------------------------------------------------- wiring
/**
 * Adds the play card to senses.activities and listens to the play core for what is worth noticing.
 * o: { play: PlayCore, world?() → the world, nameOf?(account) → a player's display name, words? (WORDS) }.
 * Returns a function that undoes both.
 */
export function registerPlayActivities(senses, { play, world = () => null, nameOf = null, words = WORDS, log = null } = {}) {
  if (!senses?.activities || !play) throw new Error('registerPlayActivities needs the senses and the play core');
  const W = id => words[id] || GENERIC;
  const name = account => clean((nameOf ? nameOf(account) : null) || senses.players?.byId?.get(account)?.name || senses.accountName?.(account), 40) || 'Someone';
  const env0 = () => { try { return senses.env(); } catch { return {}; } };
  /** Whether a run is still being played: before its module's end, and its page heard from lately (an agent's own: its clock). */
  const alive = (run, w, c, t) => {
    if (w.until && t > w.until(run, c)) return false;
    if (run.auto || run.account < 0) return true;
    return t - Math.max(run.at, run.liveAt || 0, run.actAt || 0) <= (w.staleMs || STALE_MS);
  };
  const about = (run, who, you, env, t) => {
    const m = playOf(run.module), c = m && courseOf(m, run.course);
    if (!c) return null;
    let place = '';
    try { place = placeOf(run, { world: world?.() || null, sim: env.sim, players: env.players || senses.players }); } catch { place = ''; }
    return { run, m, c, you, Who: you ? 'You' : `${who.charAt(0).toUpperCase()}${who.slice(1)}`, is: you ? 'are' : 'is', place, now: t };
  };
  const off1 = senses.activities.add({
    id: 'play',
    of({ env, account, who, now }) {
      if (account == null || !Number.isFinite(account)) return null;
      const run = play.runOf(account), t = play.now();
      if (!run) return null;
      const w = W(run.module), x = about(run, clean(who, 40) || name(account), who === 'you', env || env0(), t);
      if (!x || !alive(run, w, x.c, t)) return null;
      return (w.card || GENERIC.card)(x);
    },
  });
  // what was worth noticing: a fish landed, a Rush done, a high score, a lesson passed
  const kept = new WeakMap();   // run → Map(fish n → kept): what was in the cooler, from the moves seen
  const off2 = play.on(ev => {
    if (!ev?.run || (ev.type !== 'act' && ev.type !== 'finish' && ev.type !== 'moment')) return;
    const w = W(ev.run.module), self = ev.account < 0;
    const x = about(ev.run, self ? 'You' : name(ev.account), self, env0(), play.now());
    if (!x) return;
    const seen = kept.get(ev.run) || new Map(); kept.set(ev.run, seen);
    x.track = (n, v) => seen.set(n, !!v); x.seen = n => seen.get(n);
    const fn = ev.type === 'act' ? w.act : ev.type === 'finish' ? w.done || GENERIC.done : w.moment;
    let text = null;
    try { text = fn ? fn(ev, x) : null; } catch (e) { log?.warn?.(`[senses] the ${ev.run.module} words failed:`, e.message); }
    if (!text) return;
    if (self) senses.note(-ev.account, 'activity', text);
    else senses.noteNear(ev.account, text);
  });
  return () => { off1(); off2(); };
}
