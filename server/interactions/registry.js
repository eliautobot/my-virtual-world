// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What an AI agent can do in the world (docs/features/interactions.md): every interaction point a player has — a seat, a
// table, a counter that serves, a shop's shelves, a machine, a game module like fishing — offered to agents the same way,
// from what the world itself declares, never from a list kept by hand (2026-11-17, the product owner: "agents should be able to interact
// with any current and future object the same way players can … when a new item, feature, module or anything else that is
// interactive is added, agents have full interactivity").
//
// - Sources: each kind of thing to do is a source that finds its interaction points near a body and carries one out.
//   The furniture's slots (shared/catalog.js `slots` with their `use`: any item that declares them, today's or a new one),
//   the venues' services (what the economy sells there: a menu, groceries), and the play modules (each registers itself:
//   fishing, the kitchen, the arcade …) — server/interactions/sources/*.js and the modules' own.
// - An affordance (one thing it can do now): { id (stable for a few minutes: '<source>:<key>'), source, kind ('sit',
//   'eat', 'order', 'buy', 'play', 'fish', 'use', …), label (plain words: "Sit on the bench beside Kim"), where ({ x, z, ctx,
//   place }), cost (VC, or null), effects ({ hunger, energy, fun, social, hygiene }: what it does for its needs, per hour
//   or once — shared/catalog.js activity rates), withLeader (true: it joins what its leader is doing there), d (metres) }.
// - Doing one: validated again at that moment (still there, still free, it can pay), carried out by its source through the
//   sim's own body (routing, reservations, animations — server/sim/), with real effects (needs, money, inventory), and an
//   honest result: { ok, kind, text (a line for the page: "Sam buys groceries at Store 21"), brain (what its body did, for
//   its chat: "you bought milk, bread and eggs at Store 21 for 6.40 VC — they are in your bag"; or what it could not do and
//   why), effects }.
// - Who asks: Free Will's moments (server/free-will/moments.js: the affordances near it and its leader are its options —
//   joining what its leader does first), its chat brain (one tool: do), its owner's commands, connected agents.

export class Interactions {
  constructor({ log = null, contextFor = () => null } = {}) {
    this.log = log;
    this.contextFor = contextFor;   // agent record → ctx (./context.js), or null: no body in the city now
    this.sources = new Map();   // id → source
    this.stats = { listed: 0, done: 0, failed: 0 };
    this.onDone = null;   // (ctx, affordance, result) after each do: its diary, the page (set by the server)
  }
  /**
   * A source of things to do. source: { id, kinds: [...], near(ctx) → [affordance-without-id-prefix], run(ctx, aff,
   * params) → result | Promise<result>, notes (true: it writes its own diary lines — onDone leaves them to it) }. ctx: { rec (the agent's record), i (its body), a (its sim agent), leader ({
   * account, x, z, ctx, seat, activity } | null), sim, now }.
   */
  add(source) {
    if (!source || typeof source.id !== 'string' || typeof source.near !== 'function' || typeof source.run !== 'function') throw new Error('An interaction source needs an id, near() and run()');
    this.sources.set(source.id, source);
    return () => this.sources.delete(source.id);
  }
  /** What it can do now, nearest and most relevant first (joining its leader first): at most `limit`. */
  near(ctx, { limit = 12, kinds = null } = {}) {
    const out = [];
    for (const s of this.sources.values()) {
      let list = [];
      try { list = s.near(ctx) || []; } catch (e) { this.log?.warn?.(`[interactions] ${s.id} could not look:`, e.message); list = []; }
      for (const x of list) {
        if (!x || !x.key || (kinds && !kinds.includes(x.kind))) continue;
        out.push({ ...x, id: `${s.id}:${x.key}`, source: s.id });
      }
    }
    this.stats.listed++;
    out.sort((a, b) => (b.withLeader ? 1 : 0) - (a.withLeader ? 1 : 0) || (a.d ?? 1e9) - (b.d ?? 1e9));
    return out.slice(0, Math.max(1, limit));
  }
  /**
   * Does affordance id (from near()) with params: its source checks it again and carries it out → its result — at once
   * when its source answers at once (the world's own do: the sim plans it this moment), else a promise of it.
   */
  do(ctx, id, params = {}) {
    const k = String(id || ''), at = k.indexOf(':'), s = at > 0 ? this.sources.get(k.slice(0, at)) : null;
    if (!s) return { ok: false, kind: null, text: 'Nothing like that to do here', brain: 'there is nothing like that to do here now: look again at what you can do' };
    let aff = null;
    try { aff = (s.near(ctx) || []).find(x => x && `${s.id}:${x.key}` === k) || null; } catch (e) { this.log?.warn?.(`[interactions] ${s.id} could not look:`, e.message); }
    if (!aff) return { ok: false, kind: null, text: 'That is no longer there to do', brain: 'that is no longer there to do (taken, gone, or too far now): look again at what you can do' };
    const fin = r => {
      const out = { kind: aff.kind, ...(r || { ok: false, text: 'It could not be done', brain: 'it could not be done' }) };
      if (out.ok) this.stats.done++; else this.stats.failed++;
      try { this.onDone?.(ctx, { ...aff, id: k, source: s.id, notes: !!s.notes }, out); } catch { /* a listener's trouble is not the act's */ }
      return out;
    };
    const fail = e => { this.log?.warn?.(`[interactions] ${s.id} failed:`, e?.message || e); return fin({ ok: false, text: 'It could not be done', brain: `it could not be done: ${String(e?.message || e).slice(0, 160)}` }); };
    let r;
    try { r = s.run(ctx, { ...aff, id: k, source: s.id }, params || {}); } catch (e) { return fail(e); }
    return r && typeof r.then === 'function' ? r.then(fin, fail) : fin(r);
  }
  /** Whether another source carries piece `it` (item, where: { b, f, id }) itself: a source's claims(it, where) — the
   *  furniture's plain use of it is then not offered (one honest way to use a piece: an arcade machine's game). */
  claimed(it, where = null) {
    for (const s of this.sources.values()) { try { if (s.claims?.(it, where)) return true; } catch { /* its trouble, not the furniture's */ } }
    return false;
  }
  view() { return { sources: [...this.sources.keys()], ...this.stats }; }
  /** What agent rec can do now (near(), from where its body is this moment): [] when it has no body. */
  nearFor(rec, o = {}) { const ctx = this.contextFor(rec); return ctx ? this.near(ctx, o) : []; }
  /** Agent rec does affordance id now (its context taken again this moment) → result. */
  doFor(rec, id, params = {}) {
    const ctx = this.contextFor(rec);
    if (!ctx) return { ok: false, kind: null, text: `${rec?.name || 'It'} has no body in the city right now`, brain: 'you have no body in the city right now: you can\'t do that' };
    return this.do(ctx, id, params);
  }
  /** The affordances in lines for a brain: "[id] label" (its tools refer to them by id). */
  static lines(list) { return (list || []).map(x => `[${x.id}] ${x.label}${x.effects?.words ? ` — ${x.effects.words}` : ''}`); }
}
