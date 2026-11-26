// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Playing with an animal (docs/features/interactions.md, docs/features/foxes.md): what a player does with a fox in Play
// mode (client/js/render/fox-play.js: E — Play with the fox: Pet, Give a treat, Throw a stick, Chase me!, Bye) — an AI
// agent does the same (2026-11-24, the product owner: "All agents should also be able to interact with animals the same
// way ... the first one is the fox, make sure AI Agent can also interact with it the same way the player can").
//
// The animals are the server's (server/world/wildlife.js: the playful species, behaviour 'play'; their minds
// server/world/fox.js); an agent's act goes to the same Wildlife.interact a player's 'fox' message does, as someone on foot
// where its body stands ({ id: 'agent:<id>', agent: true }). The fox has its own trust in each agent, as in each player.
// An agent's reach is a little longer than a player's E (the fox comes over to it: pet, treat), and a companion's body
// also walks up to it (Brain.goSee) or turns to watch (Brain.attendTo) — the fox, the stick and the agent are seen by
// everyone. Bye sends the fox home and keeps it from following the agent for a while, as a player's Bye does.
import { CTX_OUT } from '../../../shared/proto.js';

export const ANIMAL_REACH = 22;   // m: a playful animal this near is something an agent can play with (it comes over)
const ACTS = {
  pet_animal: { act: 'pet', label: n => `Pet the ${n}` },
  feed_animal: { act: 'treat', label: n => `Give the ${n} a treat` },
  fetch_animal: { act: 'fetch', label: n => `Throw a stick for the ${n} to fetch` },
  chase_animal: { act: 'chase', label: n => `Play tag with the ${n}` },
  bye_animal: { act: 'bye', label: n => `Say bye to the ${n} (it goes home and leaves you be for a while)` },
};
const WHY = { 'too far': 'it is too far off now', busy: 'it is busy for a moment — try again in a second', water: 'the stick would land in the water or in town',
  'no such fox': 'it has wandered off', 'unknown act': 'it does not know that game', 'no land': 'there is no land here' };

/** One of a species, in words: "Red foxes" → "red fox" (its catalogue name made singular). */
export function oneOf(sp) {
  const n = String(sp?.one || sp?.name || sp?.id || 'animal').trim().toLowerCase();
  return n.endsWith('xes') || n.endsWith('ches') || n.endsWith('shes') ? n.slice(0, -2) : n.endsWith('s') && !n.endsWith('ss') ? n.slice(0, -1) : n;
}
const hearts = t => `${Math.round(Math.max(0, Math.min(5, t || 0)))} of 5`;

/** The animals source: o { wildlife: () => Wildlife }. */
export function animalsSource({ wildlife }) {
  const who = rec => `agent:${rec.id}`;
  return {
    id: 'animals',
    kinds: Object.keys(ACTS),
    notes: false,
    near(ctx) {
      const W = wildlife(), { me, a, rec } = ctx;
      if (!W?.playfulNear || !me || a?.ride || me.ctx !== CTX_OUT) return [];
      const out = [];
      // (the nearest two: a pair of foxes is one game at a time, each its own)
      for (const f of W.playfulNear(me.x, me.z, ANIMAL_REACH, who(rec)).slice(0, 2)) {
        const n = oneOf(f.sp), tr = f.trust > 0.05 ? ` — it trusts you ${hearts(f.trust)}` : ' — it is a little shy of you';
        const doing = f.asleep ? ' (asleep)' : f.carry ? ' (it has a stick)' : '';
        for (const [kind, A] of Object.entries(ACTS)) {
          if (kind === 'bye_animal' && !f.withThem && f.d > 12) continue;   // (bye: when it is with you or close by)
          out.push({ key: `${f.id}.${f.k}.${A.act}`, kind, label: `${A.label(n)}${kind === 'bye_animal' ? '' : doing}${kind === 'pet_animal' ? tr : ''}`,
            where: { x: f.x, z: f.z, ctx: CTX_OUT, place: '' }, cost: null,
            effects: { words: kind === 'bye_animal' ? '' : 'fun up' }, withLeader: false,
            d: Math.round(f.d) + (kind === 'pet_animal' || kind === 'fetch_animal' ? 0 : 1), animal: { id: f.id, k: f.k, name: n } });
        }
      }
      return out;
    },
    run(ctx, aff) {
      const W = wildlife(), { sim, me, a, rec } = ctx, A = ACTS[aff.kind], name = String(rec?.name || 'It').slice(0, 40), n = aff.animal?.name || 'animal';
      const no = (why) => ({ ok: false, text: `${name} could not play with the ${n}: ${why}`, brain: `you could not — the ${n}: ${why}` });
      if (!W || !A || !aff.animal) return no('there is no such animal here');
      if (a?.ride || me?.ctx !== CTX_OUT) return no('you need to be outdoors on foot');
      const f = W.playfulNear(me.x, me.z, ANIMAL_REACH, who(rec)).find(x => x.id === aff.animal.id && x.k === aff.animal.k);
      if (!f) return no('it has wandered off');
      const q = { id: who(rec), x: me.x, z: me.z, name, agent: true };
      let o = {};
      if (A.act === 'fetch') {
        // thrown out past the fox, onto dry land away from town (the first of a few directions that lands well)
        const base = Math.atan2(f.z - me.z, f.x - me.x);
        const spot = [0, 0.6, -0.6, 1.2, -1.2, Math.PI].map(t => ({ x: me.x + Math.cos(base + t) * 11, z: me.z + Math.sin(base + t) * 11 })).find(p => W.landable?.(p.x, p.z) ?? true);
        if (!spot) return no(WHY.water);
        o = spot;
      }
      const r = W.interact(f.id, f.k, q, A.act, o);
      if (!r?.ok) return no(WHY[r?.why] || r?.why || 'it did not want to play just now');
      // its body: a companion walks up to the fox for a pet or a treat, and turns to watch for the rest
      try {
        const B = sim?.brain;
        if (B && a?.order?.kind === 'follow') {
          if (A.act === 'pet' || A.act === 'treat') B.goSee?.(a, { x: f.x, z: f.z, ctx: CTX_OUT, label: `the ${n}`, secs: B.wm(4), near: 1.4 });
          else B.attendTo?.(a, { x: A.act === 'fetch' ? o.x : f.x, z: A.act === 'fetch' ? o.z : f.z, label: `the ${n}`, secs: B.wm(2) });
        }
      } catch { /* the body's part is a nicety: the fox has already answered */ }
      const t = r.trust ?? f.trust, tw = `it trusts you ${hearts(t)}`;
      const said = {
        pet: [`${name} pets the ${n}`, `you called the ${n} over and petted it — it came to your feet ${t >= 1.5 ? 'and rolled onto its back for a belly rub' : 'and wagged its brush'} (${tw})`],
        treat: [`${name} gives the ${n} a treat`, `you gave the ${n} a treat — it sat nicely, took it and hopped for joy (${tw})`],
        fetch: [`${name} throws a stick for the ${n}`, `you threw a stick for the ${n} — it is racing after it and will bring it back to you (${tw})`],
        chase: [`${name} plays tag with the ${n}`, `you started a game of tag with the ${n} — it bowed and darted off for you to chase it (${tw})`],
        bye: [`${name} says bye to the ${n}`, `you said bye to the ${n} — it gave you a last look and trotted off home; it will leave you be for a while`],
      }[A.act];
      return { ok: true, text: said[0], brain: said[1], effects: {} };
    },
  };
}
