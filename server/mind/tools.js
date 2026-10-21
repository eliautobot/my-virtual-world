// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What a thought may look at and do with money (docs/features/FREE-WILL.md §11.11): the Mind's tools. A thought that
// has tools runs in rounds: the model answers {"use":[…]} to use up to MAX_PER_ROUND of them, gets their results as the
// next message, and finally answers with its usual JSON (server/mind/mind.js). Every tool works on what the world lists
// — flats on offer, a real place's menu, people it knows — by short references (F1, I3) the results gave it, never by
// the world's own ids; and every payment, purchase or lease goes through the economy as the agent
// (server/economy/mind-money.js → runAgentAction), so its owner's spending rules decide: scopes, the daily limit,
// "ask me above" (an approval waits for the owner), pause. At most MAX_DO money actions in one thought.
//   a problem:          flats, rent_flat, ask_owner  (no human asked for anything: no buying or paying)
//   a chat with its owner: flats, menu, rent_flat, buy, pay  (its owner is asking; a visitor's chat has no tools)
import { LedgerError } from '../economy/ledger.js';

export const MAX_ROUNDS = 4;            // model calls in one thought with tools (the last must be the final answer)
export const MAX_PER_ROUND = 3;
export const MAX_DO = 2;
const TOOLS = {
  flats: { look: true, scope: 'rent', about: '{"tool":"flats"} — the flats for rent now, cheapest first' },
  menu: { look: true, about: '{"tool":"menu","place":"<a place from PLACES>"} — what it sells and the prices' },
  rent_flat: { scope: 'rent', about: '{"tool":"rent_flat","flat":"F1"} — rent a flat "flats" listed (my owner\'s rules decide; above their limit they must agree first)' },
  buy: { scope: 'buy', about: '{"tool":"buy","place":"<place>","items":[{"item":"I1","n":1}]} — buy what "menu" listed' },
  pay: { scope: 'pay', about: '{"tool":"pay","to":"<my owner, a person I know or a place>","amount":<VC>,"memo":"what for"} — pay someone' },
  ask_owner: { scope: 'pay', about: '{"tool":"ask_owner","amount":<VC>,"why":"..."} — ask my owner for money (they answer in their wallet)' },
  give: { scope: 'pay', about: '{"tool":"give","item":"<a thing I HOLD>","n":1,"to":"<my owner or a person I know>"} — give something I hold (my owner\'s rules decide, as for paying)' },
};
const FOR = { problem: ['flats', 'rent_flat', 'ask_owner'], chat: ['flats', 'menu', 'rent_flat', 'buy', 'pay', 'give'] };
const vc = c => `${(c / 100).toFixed(c % 100 ? 2 : 0)} VC`;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const q = (s, n = 80) => `«${clean(s, n)}»`;

/**
 * The tools of one thought.
 * o: { agent, kind: 'problem'|'chat', ctx (mind.js contextOf: places with b and f, peopleRefs), money (mind-money.js),
 *      wallet (money.wallet(...) at the start), people (sim.people), idem (a prefix unique to this thought) }
 */
export function toolbox({ agent, kind, ctx, money, wallet, people, idem }) {
  const allowed = new Set(wallet.rules.paused ? [] : wallet.rules.scopes);
  const names = (FOR[kind] || []).filter(t => !TOOLS[t].scope || allowed.has(TOOLS[t].scope));
  const flats = new Map(), items = new Map();       // F1 → listing; I1 → { business, item, label, price }
  const used = [];
  let did = 0, n = 0;
  const placeByName = new Map((ctx.places || []).filter(p => Number.isInteger(p.b)).map(p => [p.name.toLowerCase(), p]));
  const place = s => placeByName.get(clean(s, 80).toLowerCase()) || null;
  const owner = money.ownerOf(agent.id);
  const payee = s => {
    const t = clean(s, 60).toLowerCase();
    if (!t) return null;
    if (owner != null && (t === 'my owner' || t === 'owner' || t === (ctx.ownerName || '').toLowerCase())) return { to: { kind: 'account', id: owner }, name: 'my owner' };
    const who = (ctx.peopleRefs || []).find(r => r.name.toLowerCase() === t && r.kind === 'agent');
    if (who) { const p = people[Number(who.id)]; if (p && p.agentId) return { to: { kind: 'agent', id: Number(p.agentId) }, name: who.name }; }
    const pl = place(t), biz = pl ? money.menu(pl.b, pl.f)?.business : null;
    if (biz) return { to: { kind: 'business', id: biz.id }, name: biz.name };
    return null;
  };
  const amountOf = v => { const x = Number(v); return Number.isFinite(x) && x > 0 && x <= 1e7 ? Math.round(x * 100) : null; };
  // (above its owner's "ask me above", the economy files an approval and answers with its id: nothing happened yet)
  const answer = r => (r && r.approval ? 'waiting: my owner must agree first (they have been asked; it waits a day)' : null);
  // what its owner reads (the problem's note, the thought's steps): a money action in plain words, by how it went
  let what = null;
  const told = (r, done) => (r && r.approval ? `Wants to ${what} — waiting for your OK` : done);
  // (an approval filed: its id and what it is for, so a chat can show it with Approve and Decline)
  const pending = r => (r && r.approval ? { approval: String(r.approval), wants: what } : {});

  const run1 = u => {
    const tool = typeof u?.tool === 'string' ? u.tool : '';
    if (!names.includes(tool)) return { tool: clean(tool, 20) || '?', ok: false, text: 'not done: that is not something I may do now' };
    const T = TOOLS[tool];
    if (!T.look && did >= MAX_DO) return { tool, ok: false, text: `not done: at most ${MAX_DO} money actions at a time` };
    what = null;
    try {
      switch (tool) {
        case 'flats': {
          const list = money.flats(agent.id).slice(0, 8);
          flats.clear();
          list.forEach((f, k) => flats.set(`F${k + 1}`, f));
          return { tool, ok: true, text: list.length ? `FLATS FOR RENT: ${list.map((f, k) => `[F${k + 1}] ${q(f.title, 90)} — ${vc(f.perMonth)} a month (${vc(f.perDay)} a day), let by ${q(f.landlord, 40)}`).join('; ')}` : 'FLATS FOR RENT: none on offer right now' };
        }
        case 'menu': {
          const pl = place(u.place);
          if (!pl) return { tool, ok: false, text: `I don't know a place called ${q(u.place, 60)} (use a name from PLACES)` };
          const m = money.menu(pl.b, pl.f);
          if (!m || !m.items.length) return { tool, ok: false, text: `${q(pl.name, 60)} sells nothing` };
          const lines = m.items.slice(0, 15).map(it => { const ref = `I${items.size + 1}`; items.set(ref, { business: m.business, item: it.id, label: it.label, price: it.price }); return `[${ref}] ${q(it.label, 50)} ${vc(it.price)}`; });
          return { tool, ok: true, text: `AT ${q(m.business.name, 60)}: ${lines.join('; ')}` };
        }
        case 'rent_flat': {
          const f = flats.get(clean(u.flat, 6).toUpperCase());
          if (!f) return { tool, ok: false, text: 'not done: use a flat from the list "flats" gave' };
          did++; what = `rent ${clean(f.title, 90)} (${vc(f.perDay)} a day)`;
          const r = money.rentFlat(agent.id, f.id, `${idem}:${++n}`);
          return { tool, ok: true, money: true, ...pending(r), text: answer(r) || `done: I rent ${q(f.title, 90)} from today (${vc(f.perDay)} a day)`, say: told(r, `Rented ${clean(f.title, 90)} (${vc(f.perDay)} a day)`) };
        }
        case 'buy': {
          const lines = (Array.isArray(u.items) ? u.items : []).slice(0, 5).map(x => ({ ref: items.get(clean(x?.item, 6).toUpperCase()), n: Number.isInteger(x?.n) && x.n >= 1 && x.n <= 5 ? x.n : 1 })).filter(x => x.ref);
          if (!lines.length) return { tool, ok: false, text: 'not done: use items from a "menu" list' };
          const biz = lines[0].ref.business;
          if (lines.some(x => x.ref.business.id !== biz.id)) return { tool, ok: false, text: 'not done: one place at a time' };
          const total = lines.reduce((s, x) => s + x.ref.price * x.n, 0), list = lines.map(x => `${x.n > 1 ? `${x.n} × ` : ''}${clean(x.ref.label, 40)}`).join(', ');
          did++; what = `buy ${list} at ${clean(biz.name, 50)} (${vc(total)})`;
          const r = money.buy(agent.id, biz.id, lines.map(x => ({ id: x.ref.item, n: x.n })), `${idem}:${++n}`);
          return { tool, ok: true, money: true, ...pending(r), text: answer(r) || `done: bought ${list} at ${clean(biz.name, 50)} for ${vc(total)}`, say: told(r, `Bought ${list} at ${clean(biz.name, 50)} for ${vc(total)}`) };
        }
        case 'pay': {
          const who = payee(u.to), amount = amountOf(u.amount);
          if (!who) return { tool, ok: false, text: `not done: I can pay my owner, a person I know or a place — not ${q(u.to, 40)}` };
          if (!amount) return { tool, ok: false, text: 'not done: the amount must be a number of VC' };
          const to = who.name === 'my owner' ? 'you' : clean(who.name, 50);
          did++; what = `pay ${vc(amount)} to ${to}`;
          const r = money.pay(agent.id, who.to, amount, clean(u.memo, 100), `${idem}:${++n}`);
          return { tool, ok: true, money: true, ...pending(r), text: answer(r) || `done: paid ${vc(amount)} to ${clean(who.name, 50)}`, say: told(r, `Paid ${vc(amount)} to ${to}${clean(u.memo, 60) ? ` (${clean(u.memo, 60)})` : ''}`) };
        }
        case 'give': {
          const who = payee(u.to), cnt = Math.max(1, Math.min(9999, Math.floor(Number(u.n) || 1)));
          if (!who) return { tool, ok: false, text: `not done: I can give to my owner, a person I know or a place — not ${q(u.to, 40)}` };
          const thing = clean(u.item, 60);
          if (!thing) return { tool, ok: false, text: 'not done: say which thing I hold' };
          const to = who.name === 'my owner' ? 'you' : clean(who.name, 50);
          did++; what = `give ${cnt > 1 ? `${cnt} × ` : ''}${thing} to ${to}`;
          const r = money.give(agent.id, who.to, thing, cnt, '', `${idem}:${++n}`);
          return { tool, ok: true, ...pending(r), text: answer(r) || `done: gave ${cnt > 1 ? `${cnt} × ` : ''}${q(thing, 60)} to ${clean(who.name, 50)}`, say: told(r, `Gave ${cnt > 1 ? `${cnt} × ` : ''}${thing} to ${to}`) };
        }
        case 'ask_owner': {
          const amount = amountOf(u.amount);
          if (!amount) return { tool, ok: false, text: 'not done: the amount must be a number of VC' };
          did++; what = `ask you for ${vc(amount)}`;
          money.askOwner(agent.id, amount, clean(u.why, 120) || 'For my rent');
          return { tool, ok: true, money: true, text: `done: asked my owner for ${vc(amount)}; they answer in their wallet`, say: `Asked you for ${vc(amount)}${clean(u.why, 60) ? ` (${clean(u.why, 60)})` : ''}` };
        }
      }
    } catch (e) {
      if (e instanceof LedgerError) return { tool, ok: false, text: `not done: ${clean(e.message, 160)}`, say: what ? `Couldn't ${what}: ${clean(e.message, 160)}` : undefined };
      throw e;
    }
    return { tool, ok: false, text: 'not done' };
  };

  return {
    names,
    used,
    /** The menu for the prompt: the tools this thought may use (none: an empty list). */
    menuText() {
      if (!names.length) return [];
      return ['TOOLS (to use some, answer {"use":[...]} with up to 3 of them; the results come back to me):', ...names.map(t => `- ${TOOLS[t].about}`)];
    },
    /** Runs the tools of one round (at most MAX_PER_ROUND); their results as the next message's text. */
    run(uses) {
      const out = (Array.isArray(uses) ? uses : []).slice(0, MAX_PER_ROUND).map(run1);
      for (const r of out) used.push({ tool: r.tool, ok: r.ok, text: String(r.text).replace(/[\u0000-\u001f]/g, ' ').slice(0, 300), ...(r.say ? { say: String(r.say).replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) } : {}), ...(r.approval ? { approval: r.approval } : {}) });
      return out;
    },
    /** What its money actions did, in its owner's words (the problem's note): "Asked you for 30 VC; Rented …". */
    summary() { return used.filter(u => u.say).map(u => u.say).join('; ').slice(0, 300) || null; },
  };
}

/** The results of a round as the next user message. */
export function resultsText(results, last) {
  return [`RESULTS:`, ...results.map(r => `- ${r.tool}: ${r.text}`), '',
    last ? 'That was my last look: now answer with the final JSON (no "use").' : 'Use more tools if I need to ({"use":[...]}), or answer with the final JSON.'].join('\n');
}
