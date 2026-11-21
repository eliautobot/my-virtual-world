// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Its body beside its owner as interaction points (docs/features/interactions.md): a companion out with them sits down
// with them where they sit (the other end of their bench, another chair at their table, further round the fountain —
// or, they standing, a seat near it), joins their meal at a table where food is served (ordering and paying as residents
// do), gets up. Carried out by server/companions/ (command 'sit' | 'eat' | 'stand', as its owner: the body's sitWith,
// getUp) with its honest answer — what its body did, or why it could not.

const FOOD_KINDS = new Set(['restaurant', 'cafe', 'lounge_bar', 'club']);   // (the places that serve food or drink: companion-moves FOOD_VENUES)
/** The place that serves food its leader is in ({ name, kind }), or null. */
function foodHere(sim, leader) {
  const brain = sim?.brain;
  if (!brain?.foodPlaceOf || !Number.isFinite(leader?.ctx)) return null;
  const v = brain.foodPlaceOf(leader.ctx);
  return v && FOOD_KINDS.has(v.kind) ? { name: brain.placeName(v.b, v.f), kind: v.kind } : null;
}

/** The body source. o: { companions: () => Companions | null, principalFor: account → principal | null }. */
export function bodySource({ companions = () => null, principalFor = () => null } = {}) {
  return {
    id: 'body',
    kinds: ['sit', 'eat', 'stand'],
    near(ctx) {
      const { leader, a } = ctx;
      if (!leader || leader.gone || a.order?.kind !== 'follow' || a.ride || leader.car) return [];
      // (its seat as its order has it — sitting, or on its way to sit: not only the moments its pose shows it seated)
      const os = a.order?.seat || null, mine = os && os.mode !== 'use' ? os : null, using = os?.mode === 'use';
      const out = [], seat = leader.seat, name = leader.name;
      const at = s => `${s.use === 'eat' || /\btable\b/.test(String(s.words || '')) ? 'at' : /\b(armchair|sofa|couch)\b/.test(String(s.words || '')) ? 'in' : 'on'} ${s.words}`;
      if (!mine && !using) {
        if (seat) out.push({ key: 'sit', kind: 'sit', label: `Sit down with ${name} (they are sitting ${at(seat)})`, where: { x: seat.x, z: seat.z, ctx: seat.ctx, place: seat.venue?.name || '' }, cost: null, effects: { words: 'social up' }, withLeader: true, d: 0 });
        else out.push({ key: 'sit', kind: 'sit', label: `Sit down on a free seat near ${name}`, where: null, cost: null, effects: { words: 'energy up' }, withLeader: false, d: 3 });
        if (seat && seat.use === 'eat' && seat.venue && FOOD_KINDS.has(seat.venue.kind)) out.push({ key: 'eat', kind: 'eat', label: `Join ${name}'s meal at their table at «${seat.venue.name}» and order something for yourself (from your own money)`, where: { x: seat.x, z: seat.z, ctx: seat.ctx, place: seat.venue.name }, cost: null, effects: { words: 'hunger up, social up' }, withLeader: true, d: 0 });
        else {
          // (they are in a place that serves food — on a sofa, at the counter, standing —: a table near them there, and order;
          //  2026-11-18: at The Roastery the only way to eat was an errand to a table of its own in the same café)
          const here = foodHere(ctx.sim, leader);
          if (here) out.push({ key: 'eat', kind: 'eat', label: `Order something to eat or drink here at «${here.name}» and have it at a table near ${name} (from your own money)`, where: { x: leader.x, z: leader.z, ctx: leader.ctx, place: here.name }, cost: null, effects: { words: 'hunger up, social up' }, withLeader: false, d: 3 });   // (after what they are doing themselves: their table, their Rush)
        }
      }
      if (mine) out.push({ key: 'stand', kind: 'stand', label: `Get up (you are sitting ${at(mine)})${seat ? '' : ` and go on with ${name}`}`, where: null, cost: null, effects: null, withLeader: !seat, d: 0 });
      return out;
    },
    run(ctx, aff, params = {}) {
      const C = companions(), P = principalFor(ctx.owner);   // (as its owner: theirs to tell it)
      if (!C || !P?.account) return { ok: false, text: `${ctx.rec.name} can't just now`, brain: 'you could not: nobody can tell your body that now — say so' };
      let r;
      try { r = C.command(P, { agent: ctx.rec.id, action: aff.kind }, params.via || 'freewill'); } catch (e) { r = { ok: false, text: String(e.message || e).slice(0, 160), brain: `you could not: ${String(e.message || e).slice(0, 160)}` }; }
      const ok = r?.ok !== false;
      return { ok, text: r?.text || '', brain: r?.brain || r?.text || (ok ? 'done' : 'it could not be done'), ...(ok ? {} : { reason: r?.reason || r?.code || null }) };
    },
  };
}
