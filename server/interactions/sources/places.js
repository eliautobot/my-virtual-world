// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The city's places as interaction points (docs/features/interactions.md): what an AI agent on its own can go and do —
// a meal at a restaurant or a café, shopping (groceries or goods at a shop's checkout), the gym, a park, the arcade, a
// lounge, a club, home — the nearest open ones with room, by the routine's own rules (server/free-will/options.js:
// buildOptions and the meal choice — what is open, what its needs and money allow), each with its name, how far and
// about what it costs. Doing one is the Brain's order (server/sim/agents.js order: the walk there, the visit with its
// purchases — the economy's own bill from its own money, sim.onAct — for a while), the same as an outside AI's 'go'
// (server/agent-world.js). Not offered to a companion out with its owner: going off on its own is leaving them (its
// owner, or it in its chat, lets it go first: server/companions/).
import { buildChoice, VENUE_OF } from '../../free-will/options.js';
import { CTX_OUT } from '../../../shared/proto.js';
import { ctxB, ctxF } from '../../../shared/constants.js';
import { vc } from '../../economy/ledger.js';

/** The order kind that carries out each free-time kind (server/sim/agents.js doOrder: a venue's visit). A meal is the
 *  order 'meal' (one meal at that café or restaurant). Not here: what needs someone else (a chat, a flat it was invited
 *  to) or is no place (a walk round the block). */
const ORDER_OF = Object.freeze({ cafe: 'cafe', shop: 'shop', gym: 'gym', park: 'park', arcade: 'arcade', lounge_bar: 'lounge_bar', club: 'club', home: 'home', jog: 'jog' });
const STAY = Object.freeze({ cafe: 40, shop: 30, gym: 45, park: 45, arcade: 60, lounge_bar: 60, club: 90, home: 60, jog: 30, meal: 45 });

/** The economy as Free Will's options ask it (server/index.mjs econView's part): from the residents' economy. */
function econFor(H) {
  if (!H) return null;
  const bz = H.e?.parts?.businesses;
  return { canSpend: (a, k, ess = false) => H.canSpend(a, k, ess), venueFactor: (b, f) => H.venueFactor(b, f),
    price: (b, f, item) => { const biz = bz?.at(b, f); return biz ? bz.priceOf(biz, item) : null; }, rating: (b, f) => bz?.at(b, f)?.rating ?? null };
}

/** The places source. o: { econ: () => households (sim.econ) | null }. */
const ERRAND = Object.freeze(new Set(['meal', 'cafe', 'shop']));   // (what a companion may slip off to and come back from)
const ERRAND_MIN = Object.freeze({ cafe: 25, shop: 25, meal: 45 });
const ERRAND_FAR = 20;   // world minutes away at most: a quick errand, and back

/** The places source. o: { econ, errand: (ctx, go, via) → result — a companion's quick errand (server/companions/ errand) }. */
export function placesSource({ econ = () => null, errand = null } = {}) {
  return {
    id: 'places',
    kinds: ['go'],
    near(ctx) {
      const { sim, a, p, me, now } = ctx, brain = sim.brain;
      // (with its owner: not off on its own — but a quick errand, a bite to eat, a coffee, the shop, and back to them, when it
      //  can be asked for: server/companions/ errand)
      const companion = a.order?.kind === 'follow' && ctx.leader?.kind === 'player' && !ctx.leader.gone && !a.ride && !!errand;
      if ((a.order?.kind === 'follow' || a.order?.kind === 'hold' || a.ride) && !companion) return [];
      const h = brain.hour(now), day = brain.day(now), E = econFor(econ());
      const atHome = !!(p.home && me.ctx >= 0 && ctxB(me.ctx) === p.home.b && ctxF(me.ctx) === p.home.f);
      const at = { x: me.x, z: me.z, ctx: me.ctx >= 0 ? me.ctx : CTX_OUT, h, day, needs: brain.needsAt(a, now, {}) || a.needs, atHome };
      let list = [];
      try { list = [...buildChoice('leisure', brain, a, at, E, null), ...buildChoice('meal', brain, a, at, E, null)]; } catch { list = []; }
      const out = [], seen = new Set();
      for (const o of list) {
        // (a meal at a named place; else a free-time kind's own visit — a drink at a restaurant's bar is not one of them)
        const kind = o.way === 'venue' ? 'meal' : o.way ? null : o.venue ? (o.kind === 'bar' ? null : ORDER_OF[VENUE_OF[o.kind] || o.kind] || null) : ORDER_OF[o.kind] || null;
        if (!kind) continue;
        if (companion && (!ERRAND.has(kind) || !Number.isInteger(o.b) || !(o.minutes <= ERRAND_FAR))) continue;   // (a quick errand: somewhere near — not an hour's walk away from them)
        // (never an errand to the place they are in together: there it eats with them — the body source's 'eat' — not off at
        //  a table of its own; 2026-11-18, Sam "off to «Restaurant 16» — back with you after" while sitting in it with Kim)
        if (companion && Number.isInteger(o.b) && [ctx.leader?.ctx, me.ctx].some(c => c >= 0 && ctxB(c) === o.b && ctxF(c) === o.f)) continue;
        const key = Number.isInteger(o.b) ? `${kind}@${o.b}.${o.f}` : kind;
        if (seen.has(key)) continue;
        seen.add(key);
        const label = companion ? `${o.label.replace(/^Go shopping at/, 'Pop into')} — then back to ${ctx.leader.name}` : o.label;
        out.push({ key, kind: kind === 'meal' ? 'eat' : 'go', label, ...(companion ? { errand: true } : {}), where: { place: o.name || (kind === 'home' ? 'home' : '') },
          cost: o.price || null, effects: null, withLeader: false, d: Number.isFinite(o.minutes) ? o.minutes * 60 : 1e6,
          go: { kind, b: o.b ?? null, f: o.f ?? null, vkind: o.vkind || VENUE_OF[o.kind] || null, name: o.name || null, minutes: o.minutes ?? null, meal: kind === 'meal' } });
      }
      return out.slice(0, 12);
    },
    run(ctx, aff, params = {}) {
      const { sim, i, rec } = ctx, brain = sim.brain, g = aff.go;
      const venue = g.b !== null ? (brain.index.venues[g.vkind || g.kind] || []).find(v => v.b === g.b && v.f === g.f) || null : null;
      if (g.b !== null && !venue) return { ok: false, text: `${rec.name} can't go there: it is gone`, brain: 'you could not: that place is not there any more — say so' };
      if (aff.errand) return errand(ctx, { kind: g.kind, venue, name: g.name, minutes: ERRAND_MIN[g.kind] || 30 }, params.via || 'agent');
      const minutes = Number(params.minutes) > 0 ? Math.min(240, Number(params.minutes)) : STAY[g.kind] || 45;
      const r = sim.order(i, { kind: g.kind, venue, minutes, via: params.via || 'agent' });
      if (!r.ok) {
        const why = { no_money: 'it costs money and you have too little (keep your rent)', nowhere: 'there is no such place open now', not_possible: 'it is full or closed just now', no_home: 'you have no home', no_body: 'you have no body in the city right now' }[r.why] || 'it was not possible just then';
        return { ok: false, text: `${rec.name} can't go: ${why}`, brain: `you could not go: ${why} — say so, don't pretend you went` };
      }
      const where = g.name ? `«${g.name}»` : g.kind === 'home' ? 'home' : g.kind;
      const cost = aff.cost ? `, about ${vc(aff.cost)} from your own money` : '';
      const what = g.meal ? 'for a meal' : g.kind === 'shop' ? 'to shop (what you buy is paid at the checkout)' : '';
      return { ok: true, text: `${rec.name} is heading to ${where}`, brain: `you are on your way to ${where}${what ? ` ${what}` : ''}${g.minutes ? ` (about ${g.minutes} min away)` : ''}${cost}; you'll be there for a while`, effects: null };
    },
  };
}
