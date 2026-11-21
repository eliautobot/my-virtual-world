// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A built-in brain's senses as tools (docs/features/awareness.md §2): in its owner's chat it may look around (the full
// picture, now) and read what happened lately (its diary and today's activity) — when a question needs it, instead of
// being sent all of it with every message. The same shape as its companion tools (server/companions/brain-tools.js):
// {"use":[{"tool":"look"}]}, the results back as the next message; every use is kept (used) so its answer can show it.
// see (its eyes, server/senses/eye.js) gets a picture only while a page of the writer's draws the world where it stands;
// elsewhere it is told why not.

const TOOLS = {
  look: '{"tool":"look"} — look around you now: exactly where you are, who is around you and what they are doing, what you heard, what is going on, the time and the weather, and places near you',
  recent: '{"tool":"recent"} — what you did and what happened around you lately (today so far, and the last things you lived and heard)',
  see: '{"tool":"see"} — look at what is in front of you right now: a picture of the world from where you stand, looking where your owner looks (for colours, signs, what a thing is; only near your owner\'s character, where their screen shows the world around you — it costs a little, so use it when you need to see)',
};

/**
 * The senses tools for agent `agent` in a chat with `account`: null without a body or senses. o: { mode, since (the
 * previous answer's time), today (its activity today: [{ when, label }]), places (the Mind's places near it) }. In 'off'
 * it can't look around; it still knows its own day (recent, without what it heard).
 */
export function sensesTools(senses, agent, account, { mode, since = null, today = [], places = null, eyes = false } = {}) {
  if (!senses || senses.bodyOf(agent) < 0) return null;
  const names = mode === 'off' ? ['recent'] : ['look', 'recent', ...(eyes ? ['see'] : [])], used = [];
  const run1 = u => {
    const tool = typeof u?.tool === 'string' ? u.tool : '';
    if (!names.includes(tool)) return null;
    // (its eyes: the picture is taken by its chat — server/mind/mind.js seen(): the page drawing the world where it stands
    //  is asked, and this result, the one kept too, says what came of it: attached, or why not)
    if (tool === 'see') { const r = { tool, ok: false, text: 'no picture was taken', see: true }; used.push(r); return r; }
    let text;
    try {
      if (tool === 'look') text = senses.look(agent, { account, since, places })?.text || 'You can\'t see anything right now.';
      else if (mode === 'off') text = `Today so far: ${today.map(e => `${e.when ? `${e.when} ` : ''}${e.label}`).join('; ') || 'nothing yet'}.`;
      else text = senses.recent(agent, { today }).text;
    } catch (e) { text = null; used.push({ tool, ok: false, text: 'not available right now' }); return { tool, ok: false, text: `not available right now (${String(e.message || e).slice(0, 80)})` }; }
    used.push({ tool, ok: true, text });   // (kept here: a joined toolbox calls run1 itself)
    return { tool, ok: true, text };
  };
  return {
    names, used,
    menuText: () => names.map(t => `- ${TOOLS[t]}`),
    run1,
    run(uses) { return (Array.isArray(uses) ? uses : []).slice(0, 3).map(run1).filter(Boolean); },
    summary: () => null,
  };
}
