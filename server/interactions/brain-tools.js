// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// A brain's world tools (docs/features/interactions.md): in its owner's chat (Life) an AI agent may look at what it can
// do right where its body is (the interaction registry, ./registry.js: sitting down with its owner, using what is near,
// a meal, shopping, the gym …) and do one, for real — its body walks there and does it, money it costs is its own — with
// the honest result back (done, or not done and why). The same shape as the Mind's city tools (server/mind/tools.js):
// {"use":[{"tool":"things_to_do"}, …]}, results back as the next message.

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const TOOLS = {
  things_to_do: '{"tool":"things_to_do"} — what you can do with your own body right where you are now (sit down with your owner, join their meal, play or use something here, go for a meal, shopping, the gym …), each with a ref (T1, T2 …)',
  do: '{"tool":"do","what":"<a ref from things_to_do, e.g. T2>","minutes":<optional, how long>} — do it now, for real: your body goes and does it (what it costs is your own money). Only say you did something once a tool said "done".',
};
const MAX = 12;

/** The world tools for agent rec (null: no registry). o: { via ('brain'), limit }. */
export function worldTools(interactions, rec, { via = 'brain', limit = MAX } = {}) {
  if (!interactions || !rec) return null;
  const names = Object.keys(TOOLS), used = [], refs = new Map();
  let list = null;
  const look = () => {
    list = interactions.nearFor(rec, { limit });
    refs.clear();
    list.forEach((x, k) => refs.set(`T${k + 1}`, x));
    return list;
  };
  // (the thing meant: its ref, its id, or — a brain that names it — the one whose words it used)
  const find = w => {
    const t = clean(w, 160);
    if (!t) return null;
    const byRef = refs.get(t.toUpperCase());
    if (byRef) return byRef;
    if (list) {
      const exact = list.find(x => x.id === t);
      if (exact) return exact;
      const low = t.toLowerCase();
      return list.find(x => x.label.toLowerCase().includes(low)) || null;
    }
    return null;
  };
  const run1 = u => {
    const tool = typeof u?.tool === 'string' ? u.tool : '';
    if (!names.includes(tool)) return null;
    if (tool === 'things_to_do') {
      const l = look();
      return { tool, ok: true, text: l.length ? `THINGS TO DO NOW: ${l.map((x, k) => `[T${k + 1}] ${clean(x.label, 180)}${x.effects?.words ? ` (${x.effects.words})` : ''}`).join('; ')}` : 'THINGS TO DO NOW: nothing you can do with your body right here just now' };
    }
    if (!list) look();
    const x = find(u.what);
    if (!x) return { tool, ok: false, text: `not done: ${clean(u.what, 60) || 'nothing'} is not one of THINGS TO DO now (call things_to_do and use one of its refs)` };
    const r = interactions.doFor(rec, x.id, { via, minutes: Number(u.minutes) > 0 ? Number(u.minutes) : undefined });
    if (r && typeof r.then === 'function') { r.catch(() => null); return { tool, ok: true, text: `started: ${clean(x.label, 160)} (its result comes in a moment)`, say: clean(x.label, 160) }; }
    list = null;   // (the world moved on: look again before the next)
    return r?.ok ? { tool, ok: true, text: `done: ${clean(r.brain || r.text, 300)}`, say: clean(r.text, 200) } : { tool, ok: false, text: `not done: ${clean(r?.brain || r?.text || 'it could not be done', 300)}` };
  };
  return {
    names, used,
    menuText: () => names.map(t => `- ${TOOLS[t]}`),
    run1,
    run(uses) {
      const out = (Array.isArray(uses) ? uses : []).slice(0, 3).map(run1).filter(Boolean);
      for (const r of out) used.push({ tool: r.tool, ok: r.ok, text: r.text, ...(r.say ? { say: r.say } : {}) });
      return out;
    },
    summary: () => used.filter(u => u.say && u.tool === 'do').map(u => u.say).join('; ') || null,
  };
}
