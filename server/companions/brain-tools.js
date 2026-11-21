// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A built-in brain's companion tools (docs/features/companions.md §4): in its owner's chat (Life), the agent itself may
// decide to come along, wait, go somewhere, meet up with another of its owner's agents or go back to its day — the same
// commands its owner's buttons give (./companions.js command), as its owner. The same shape as the Mind's city tools
// (server/mind/tools.js toolbox): {"use":[{"tool":"come_along"}, …]}, results back as the next message.

const TOOLS = {
  come_along: '{"tool":"come_along","to":"<optional: a place you are going together>"} — go with your owner as their companion (walk with them; get in their car when they drive)',
  wait: '{"tool":"wait","place":"<optional: a place from NEAR ME; nothing = here>"} — wait where you are, or at a place, for your owner',
  go_to: '{"tool":"go_to","place":"<a place from NEAR ME, home or work>"} — go there now',
  meet_up: '{"tool":"meet_up","with":"<another of your owner\'s agents>","place":"<a place>"} — meet another of your owner\'s agents there',
  go_with: '{"tool":"go_with","who":"<another of your owner\'s agents>"} — go along with another of your owner\'s agents (their group)',
  let_go: '{"tool":"let_go"} — stop being a companion and go back to your own day',
  sit_down: '{"tool":"sit_down"} — sit down: beside your owner when they are sitting (the same bench, their table, the fountain\'s edge), else on a free seat near you',
  stand_up: '{"tool":"stand_up"} — get up from where you are sitting',
  eat_with: '{"tool":"eat_with","order":"<optional: what you want, from the place\'s menu — e.g. a dish and a drink>"} — in a place that serves food or drinks where your owner is, sit at their table (or, they not at one, a table near them) and order for yourself (you pay); the only way to eat or drink there: say what the result says you ordered, and never say you are eating anything it did not order',
};
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** Which command each tool gives (the reflex's actions: server/companions/intent.js). */
const ACTION_OF = { come_along: 'follow', wait: 'stay', go_to: 'go', meet_up: 'meet', go_with: 'follow', let_go: 'dismiss', sit_down: 'sit', stand_up: 'stand', eat_with: 'eat' };

/** The companion tools for agent rec, used as principal P (its owner, writing to it): null when companions are off.
 *  done: the command its owner's message already carried out (the reflex: { action, text }) — the same again from
 *  its brain (it read "you are waiting now" and called wait, with the place it thought it was at) is not done twice. */
export function companionTools(companions, P, rec, { done = null } = {}) {
  if (!companions || !P || !rec || !companions.config().enabled || !companions.mayCommand(P, rec)) return null;
  const names = Object.keys(TOOLS), used = [];
  const doIt = (b, say) => {
    try { const r = companions.command(P, { agent: rec.id, ...b }, 'brain'); return { ok: true, text: `done: ${r.text}`, say: r.text }; } catch (e) { return { ok: false, text: `not done: ${clean(e.message, 200)}` }; }
  };
  const run1 = u => {
    const tool = typeof u?.tool === 'string' ? u.tool : '';
    if (!names.includes(tool)) return null;
    if (done?.ok && ACTION_OF[tool] === (done.action === 'come' ? 'follow' : done.action) && !(tool === 'come_along' && clean(u.to, 80))) {
      return { tool, ok: true, text: `already done by the message itself: ${clean(done.text, 160)}` };
    }
    let r;
    switch (tool) {
      case 'come_along': r = doIt({ action: 'follow', target: 'me', place: clean(u.to, 80) || null }); break;
      case 'wait': r = doIt({ action: 'stay', place: clean(u.place, 80) || 'here' }); break;
      case 'go_to': r = clean(u.place, 80) ? doIt({ action: 'go', place: clean(u.place, 80) }) : { ok: false, text: 'not done: say where' }; break;
      case 'meet_up': {
        const other = companions.findAgent(P, clean(u.with, 60));
        r = !other ? { ok: false, text: `not done: ${clean(u.with, 40) || 'nobody'} is not one of your owner's agents` }
          : (() => { try { const x = companions.command(P, { action: 'meetup', agents: [rec.id, other.a.id], place: clean(u.place, 80) }, 'brain'); return { ok: true, text: `done: ${x.text}`, say: x.text }; } catch (e) { return { ok: false, text: `not done: ${clean(e.message, 200)}` }; } })();
        break;
      }
      case 'go_with': r = doIt({ action: 'follow', target: clean(u.who, 60) }); break;
      case 'let_go': r = doIt({ action: 'dismiss' }); break;
      // (its body with its owner: what it really did — or that it could not, and why)
      case 'sit_down': case 'stand_up': case 'eat_with': {
        let x = null;
        // (eat_with: what it chose to order, in its own words — the dishes of the menu it names; else as residents order there)
        const items = tool === 'eat_with' && clean(u.order, 160) ? clean(u.order, 160).split(/\s*(?:,|\band\b|\+|&)\s*/i).map(x => x.replace(/^(?:an?|the|some)\s+/i, '')).filter(Boolean).slice(0, 3) : null;
        try { x = companions.command(P, { agent: rec.id, action: ACTION_OF[tool], ...(items ? { items } : {}) }, 'brain'); } catch (e) { x = { ok: false, brain: clean(e.message, 200) }; }
        r = x && x.ok !== false ? { ok: true, text: `done: ${clean(x.brain || x.text, 200)}`, say: x.text } : { ok: false, text: `not done: ${clean(x?.brain || x?.reason || x?.text || 'it could not be done', 200)}` };
        break;
      }
    }
    return { tool, ...r };
  };
  return {
    names, used,
    menuText: () => names.map(t => `- ${TOOLS[t]}`),
    /** The tools' results (the ones that are not companion tools: null, for the other toolbox). */
    run1,
    run(uses) {
      const out = (Array.isArray(uses) ? uses : []).slice(0, 3).map(run1).filter(Boolean);
      for (const r of out) used.push({ tool: r.tool, ok: r.ok, text: r.text, ...(r.say ? { say: r.say } : {}) });
      return out;
    },
    summary: () => used.filter(u => u.say).map(u => u.say).join('; ') || null,
  };
}

/** One toolbox of a brain's city tools (server/mind/tools.js) and its companion tools: either may be null. */
export function withCompanion(city, comp) {
  if (!comp) return city;
  if (!city) return comp;
  const used = [];
  return {
    names: [...city.names, ...comp.names], used,
    menuText: () => [...city.menuText(), ...comp.menuText()],
    run(uses) {
      const out = [];
      for (const u of (Array.isArray(uses) ? uses : []).slice(0, 3)) {
        const r = comp.names.includes(u?.tool) ? comp.run1(u) : city.run([u])[0];
        if (r) { out.push(r); used.push({ tool: r.tool, ok: r.ok, text: String(r.text).slice(0, 300), ...(r.say ? { say: r.say } : {}) }); }
      }
      return out;
    },
    summary: () => [city.summary?.(), comp.summary?.()].filter(Boolean).join('; ') || null,
  };
}

/** What its body is doing as a companion, in a line for its brain (null: it isn't one now). */
export function companionLine(companions, rec) {
  try {
    const i = companions?.lifeOf()?.byAgent?.get(rec.id), a = Number.isInteger(i) ? companions.sim?.agents[i] : null;
    const v = a?.order ? companions.view(a) : null;
    if (!v) return null;
    const who = v.leader?.name;
    if (v.seat?.words) {
      const w = String(v.seat.words).slice(0, 80), prep = v.seat.use === 'eat' || /\btable\b/.test(w) ? 'at' : /\b(armchair|sofa|couch)\b/.test(w) ? 'in' : 'on';
      return `You are with ${who} as their companion, ${v.seat.eating ? 'eating with them' : 'sitting with them'} ${prep} ${w}.`;
    }
    // (its owner sitting and it not — on its way to a seat, or standing: said plainly, so its words never sit it down when
    //  its body didn't; to sit down with them it uses its tools — 2026-11-17: Sam said "sitting across from you" standing)
    const ls = v.leader?.kind === 'player' ? companions.leaderSeat?.(v.leader.id) : null;
    if (ls?.words && !v.using && v.state !== 'riding') {
      const w = String(ls.words).slice(0, 80), prep = ls.use === 'eat' || /\btable\b/.test(w) ? 'at' : /\b(armchair|sofa|couch)\b/.test(w) ? 'in' : 'on';
      const going = a.order?.seat && a.order.seat.mode !== 'use';
      return `You are with ${who} as their companion. ${who} is sitting ${prep} ${w}; you are ${going ? 'on your way to a seat beside them (not sitting yet)' : 'standing beside them, NOT sitting'}${going ? '' : ` — to sit down with them use the tool sit_down${ls.use === 'eat' ? ' (or eat_with to order something too)' : ''}; never say you are sitting until a tool said done`}.`;
    }
    switch (v.state) {
      case 'riding': return `You are riding in ${who}'s car with them, as their companion.`;
      case 'following': return v.talking ? `You are with ${who} as their companion, beside them, talking with them.` : `You are going around the city with ${who}, as their companion${v.goal ? ` (${v.goal.toLowerCase()})` : ''}.`;
      case 'waiting': return v.kind === 'follow' ? `You are with ${who} as their companion, ${v.talking ? 'beside them, talking with them' : 'waiting beside them'}.` : `You are waiting at ${v.place || 'a spot'}${v.goal ? ` (${v.goal})` : ''}.`;
      case 'meetup': return `You are meeting up with others at ${v.place || 'a place'}.`;
      case 'away': return `You are ${who ? `${who}'s companion` : 'on an errand'} but stepped away: ${String(v.doing || '').toLowerCase()}.`;
      default: return v.place ? `You are out at ${v.place} because your owner sent you.` : null;
    }
  } catch { return null; }
}
