// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An agent deciding a trade for itself (2026-11-20, the product owner: "trade with companions … I can give them any
// inventory item … and they should be able to give me an inventory item as well … if I ask for something or they ask for
// something we can trade … intuitive, easy, and also safe so that no one can steal"). When the other side of an open
// trade of an agent's (server/economy/trades.js) has accepted it — a proposal from its owner, a player's offer — the agent
// looks at it a moment later: what it would give and get, and what each is worth; its own decision service decides (Free
// Will's decideNow, within that agent's daily limits: accept or decline, and whether to say something), else its habit —
// a gift is always welcome; from its owner it gives what is asked unless that leaves it much the poorer; from anyone else
// only a fair swap. Accepting goes through its owner's rules (runAgentAction tradeAccept: above its owner's line they
// approve first); the trade settles both ways in one transaction, or not at all. What it says is its brain's words (its
// remark), and the other side's page hears its answer with the reason.
// Agents connected from outside (the agent API) decide their own trades there: not here.
import { subj } from '../economy/economy.js';
import { itemOf, itemValue } from '../../shared/items.js';
import { LURE_BY_ID } from '../../shared/fishing-gear.js';

export const DECIDE_AFTER_MS = 1200;   // a moment after the other side accepts (it sees the offer settle)
export const OWNER_SLACK = 5000;       // hundredths: from its owner it gives up to this much more than it gets (a friend's favour)
export const FAIR = 0.95;              // from anyone else: what it gets worth at least this share of what it gives
const SAY_P = 0.5;
export const IDEA_EVERY_MS = 60e3;      // its needs looked at about this often while it is out with its owner…
export const IDEA_AGAIN_MS = 15 * 60e3; // …and a trade of its own proposed at most this often (never a stream of asks)
const clean = (s, n = 60) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const vc = c => `${(c / 100).toFixed(c % 100 ? 2 : 0)} VC`;
const worthOf = side => (side.vc || 0) + side.items.reduce((a, l) => a + (l.gone ? 0 : l.worth || 0), 0);
const words = side => [...side.items.map(l => `${l.qty > 1 ? `${l.qty} × ` : ''}${clean(l.name, 50)}${l.gone ? ' (gone)' : ` (${vc(l.worth || 0)})`}`), side.vc ? vc(side.vc) : ''].filter(Boolean).join(', ') || 'nothing';

export class AgentTrades {
  /**
   * @param {object} o
   * @param {() => object} o.economy   server/economy/index.js (econ, runAgentAction)
   * @param {object} o.agents          the agent registry (get)
   * @param {() => object} [o.freeWill] server/free-will/free-will.js (decideNow, contextFn)
   * @param {() => object} [o.companions] server/companions/companions.js (decides, remark, bodyOf)
   * @param {(agentId) => boolean} [o.external] an agent that decides from outside (the agent API): left to it
   * @param {(agentId, text) => void} [o.note] a line in its diary (server/senses/ note)
   * @param {(account) => boolean} [o.fishingWith] whether account is out on a fishing trip (its companions may want bait)
   * @param {(a) => object} [o.needs] a body's needs now ({ hunger, … }: 0 empty … 1 full)
   */
  constructor({ economy, agents, freeWill = () => null, companions = () => null, external = () => false, note = () => {}, fishingWith = () => false, needs = () => null, now = () => Date.now(), log = null, timers = { set: setTimeout, clear: clearTimeout } }) {
    Object.assign(this, { economyOf: economy, agents, freeWillOf: freeWill, companionsOf: companions, external, note, fishingWith, needs, now, log, timers });
    this.pending = new Map();   // trade id → timer
    this.ideaAt = new Map();    // agent id → when it last proposed a trade of its own
    this.lookedAt = 0;          // when its companions' needs were last looked at
    this.stats = { asked: 0, accepted: 0, declined: 0, waiting: 0 };
  }
  get econ() { return this.economyOf()?.econ || null; }
  /** Server/economy/trades.js tell: an event of a trade. The other side accepted (or proposed): its turn, a moment later. */
  onTrade(id, ev, to) {
    if (to?.kind !== 'agent' || !['proposed', 'accepted'].includes(ev)) return;
    const agentId = Number(to.id);
    if (!this.agents.get(agentId) || this.external(agentId)) return;
    clearTimeout(this.pending.get(id));
    const t = this.timers.set(() => { this.pending.delete(id); this.decide(id, agentId).catch(e => this.log?.warn?.('[agent-trades] deciding failed:', e.message)); }, DECIDE_AFTER_MS);
    t?.unref?.();
    this.pending.set(id, t);
  }
  /** The trade as the agent sees it, if it is its turn: open, the other side accepted, its own not yet. */
  turnOf(id, agentId) {
    const T = this.econ?.parts?.trades;
    const t = T?.list(subj('agent', agentId)).find(x => x.id === id);
    return t && t.status === 'open' && t.theirOk && !t.myOk ? t : null;
  }
  /** Its habit: a gift welcome; its owner's asks unless much the poorer; anyone else's only a fair swap. → { yes, why }. */
  habit(t, isOwner) {
    const give = worthOf(t.me), get = worthOf(t.them);
    if (t.me.items.some(l => l.gone)) return { yes: false, why: 'something asked for isn\'t in my things any more' };
    if (give === 0) return { yes: true, why: 'a gift' };
    if (isOwner) return give - get <= OWNER_SLACK ? { yes: true, why: get >= give ? 'a fair swap' : 'a favour for my owner' } : { yes: false, why: `that's worth ${vc(give)} for ${vc(get)} — too much to give away` };
    return get >= give * FAIR ? { yes: true, why: 'a fair swap' } : { yes: false, why: `${vc(get)} for my ${vc(give)} isn't a fair swap` };
  }
  /** Decides trade id for agent agentId (its turn): accepts or declines, and says why. → 'accepted' | 'waiting' | 'declined' | null. */
  async decide(id, agentId) {
    const t = this.turnOf(id, agentId), econ = this.econ, rec = this.agents.get(agentId);
    if (!t || !econ || !rec) return null;
    const who = t.them.who, isOwner = who.kind === 'account' && econ.agentOwner(agentId) === Number(who.id), them = clean(who.name || 'Someone', 40), name = clean(rec.name, 40);
    const give = worthOf(t.me), get = worthOf(t.them);
    let pick = this.habit(t, isOwner), say = false, how = 'habit';
    // its own decision service, when it has one: the offer, what each side is worth, who asks
    const fw = this.freeWillOf?.(), C = this.companionsOf?.();
    let decides = false; try { decides = !!(fw?.decideNow && C?.decides?.(rec)); } catch { decides = false; }
    if (decides && !t.me.items.some(l => l.gone)) {
      this.stats.asked++;
      let ctx = null; try { ctx = fw.contextFn ? fw.contextFn(rec.id) : null; } catch { ctx = null; }
      let money = null; try { money = econ.walletView(econ.walletFor(subj('agent', agentId))).available; } catch { money = null; }
      const input = [
        `WHO: ${name}${rec.role ? `, ${clean(rec.role, 60)}` : ''}.${ctx?.personality?.length ? ` Personality: ${ctx.personality.slice(0, 6).join(', ')}.` : ''}`,
        `A TRADE from ${them}${isOwner ? ' (my owner — I am their companion)' : ''}${t.memo ? `, who says: «${clean(t.memo, 140)}»` : ''}.`,
        `I WOULD GIVE: ${words(t.me)} — worth ${vc(give)} in all.`,
        `I WOULD GET: ${words(t.them)} — worth ${vc(get)} in all.`,
        ...(money != null ? [`MY MONEY: ${vc(money)}.`] : []),
      ].join('\n');
      const questions = [
        { type: 'choice', name: 'answer', instructions: `Does ${name} accept this trade, as ${name} would?`, choices: [
          { value: 'accept', description: give === 0 ? 'Accept the gift' : 'Accept: the things change hands now' },
          { value: 'decline', description: 'Decline: nothing changes hands' }] },
        { type: 'choice', name: 'speak', instructions: `Does ${name} say something to ${them} about it?`, choices: [
          { value: 'quiet', description: 'Says nothing' }, { value: 'say', description: 'Says a word about it, in their own words' }] },
      ];
      let res = null;
      try { res = await fw.decideNow(rec.id, { input, questions }, { type: 'trade', place: null, when: null, timeoutMs: 6000, options: [{ id: 'accept', kind: 'trade', label: 'Accept' }, { id: 'decline', kind: 'trade', label: 'Decline' }],
        summary: answers => { const a = answers.find(x => x.name === 'answer'); return { chosen: a?.choice || null, label: a?.choice === 'accept' ? `Accept ${them}'s trade` : `Decline ${them}'s trade`, conf: a?.confidence, reason: 'trade' }; } }); }
      catch { res = null; }
      const a = res?.answers?.find(x => x?.name === 'answer' && x.type === 'choice'), s = res?.answers?.find(x => x?.name === 'speak' && x.type === 'choice');
      if (a && (a.choice === 'accept' || a.choice === 'decline')) {
        pick = { yes: a.choice === 'accept', why: a.choice === 'accept' ? (give === 0 ? 'a gift' : 'I chose to') : 'I chose not to' };
        say = s?.choice === 'say' && ((s.probabilities || []).find(x => x.value === 'say')?.probability ?? s.confidence ?? 1) >= SAY_P;
        how = 'model';
      }
    }
    if (!this.turnOf(id, agentId)) return null;   // (changed meanwhile: the next acceptance asks again)
    const T = econ.parts.trades, R = this.economyOf().runAgentAction;
    let out = null, text = '';
    if (pick.yes) {
      let r = null;
      try { r = R ? R('tradeAccept', { trade: id }, agentId, false) : { status: 'done', trade: T.accept({ kind: 'agent', id: agentId }, { trade: id }) }; }
      catch (e) { pick = { yes: false, why: e.message || 'it didn\'t go through' }; r = null; }
      if (r?.status === 'approval_required') { out = 'waiting'; this.stats.waiting++; text = `${name} said yes — ${isOwner ? 'your' : 'its owner\'s'} OK is needed first (its spending rules)`; }
      else if (r) { out = 'accepted'; this.stats.accepted++; text = `${name} agreed${give === 0 ? ' — thank you!' : ''}`; }
    }
    if (!pick.yes) {
      try { T.decline({ kind: 'agent', id: agentId }, { trade: id }); } catch { /* ended meanwhile */ }
      out = 'declined'; this.stats.declined++; text = `${name} said no — ${pick.why}`;
    }
    // the other side hears its answer, with why; its diary keeps it; and, if it chose to (or its habit for a no), a word in its own voice
    try { T.tell(who, subj('agent', agentId), id, 'said', text); } catch { /* their page will see the trade's state */ }
    try { this.note(agentId, `${out === 'declined' ? 'Declined' : out === 'waiting' ? 'Agreed to (waiting for your owner\'s OK)' : 'Accepted'} a trade with ${them}: you ${give ? `give ${words(t.me)}` : 'give nothing'}, you ${get ? `get ${words(t.them)}` : 'get nothing'}${pick.why ? ` (${pick.why})` : ''}`); } catch { /* its diary is a bonus */ }
    if (say || (how === 'habit' && out !== 'waiting')) {
      try {
        let i = null; try { i = C?.bodyOf?.(agentId)?.i ?? null; } catch { i = null; }
        if (i != null) C?.remark?.(i, `${them} offered me a trade: I'd give ${words(t.me)} and get ${words(t.them)}. I ${out === 'declined' ? `said no (${pick.why})` : 'said yes'}.`);
      } catch { /* its words are a bonus */ }
    }
    return out;
  }
  // ------------------------------------------------------------------------------------------------ its own proposals
  /**
   * About once a minute: each companion out with its owner looks at what it needs (2026-11-20, the product owner:
   * "companions should trade themselves too") — no bait of its own on its owner's fishing trip, hungry — and who of its
   * people has it (its owner, its owner's other agents out with them); at most every IDEA_AGAIN_MS it may propose a trade
   * for it: its own decision service decides whether to ask now (no decision service: it doesn't ask on its own — asked,
   * its brain proposes in chat: the offer_trade tool). What it offers: the thing's worth in coin when it has it, else as a
   * favour. Nothing moves until they accept.
   */
  async think(t = this.now()) {
    if (t - this.lookedAt < IDEA_EVERY_MS) return 0;
    this.lookedAt = t;
    const C = this.companionsOf?.(), econ = this.econ, fw = this.freeWillOf?.();
    if (!C?.live || !econ?.parts?.trades || !fw?.decideNow) return 0;
    const live = C.live(), withOwner = [];
    for (const { a, o } of live) {
      if (o.kind !== 'follow' || o.lead?.kind !== 'player') continue;
      const rec = C.agentRecOf?.(a.i);
      if (!rec || this.external(rec.id) || econ.agentOwner(rec.id) !== Number(o.lead.id)) continue;
      withOwner.push({ a, rec, owner: Number(o.lead.id) });
    }
    let n = 0;
    for (const x of withOwner) {
      if (t - (this.ideaAt.get(x.rec.id) || 0) < IDEA_AGAIN_MS) continue;
      let decides = false; try { decides = !!C.decides?.(x.rec); } catch { decides = false; }
      if (!decides) continue;
      const idea = this.ideaFor(x, withOwner.filter(y => y.owner === x.owner && y !== x));
      if (!idea) continue;
      this.ideaAt.set(x.rec.id, t);
      try { if (await this.propose(x, idea)) n++; } catch (e) { this.log?.warn?.('[agent-trades] its own proposal:', e.message); }
    }
    return n;
  }
  /** What it would trade for now and with whom: { why, to ({ kind, id }), toName, want: [{ stack, qty, name }], give: [], vc } or null. */
  ideaFor(x, siblings) {
    const econ = this.econ, inv = econ.parts.inventory, me = subj('agent', x.rec.id);
    const holders = [{ who: subj('account', x.owner), name: econ.nameOf(subj('account', x.owner)) }, ...siblings.map(s => ({ who: subj('agent', s.rec.id), name: clean(s.rec.name, 40) }))];
    let money = 0; try { money = econ.walletView(econ.walletFor(me)).available || 0; } catch { money = 0; }
    const mine = inv.list(me), pick = (pred, qty) => {
      let best = null;
      for (const h of holders) for (const st of inv.list(h.who)) { const d = itemOf(st.item); if (!d || d.trade === false || !pred(st, d)) continue; const free = st.qty - (st.held || 0); if (free < 1) continue; if (!best || free > best.free) best = { h, st, d, free }; }
      if (!best) return null;
      const q = Math.min(qty(best.d), best.free), worth = itemValue(best.d, best.st.attrs) * q;
      return { to: best.h.who, toName: best.h.name, want: [{ stack: best.st.id, qty: q, name: best.d.name }], give: [], vc: Math.min(money, worth), worth };
    };
    // bait: out fishing with its owner, none of its own (the dock's lent kit runs out), and someone with it has some
    if (this.fishingWith(x.owner) && !mine.some(st => st.item.startsWith('lure:') && LURE_BY_ID[st.item.slice(5)]?.bait)) {
      const i = pick((st, d) => st.item.startsWith('lure:') && LURE_BY_ID[st.item.slice(5)]?.bait, d => Math.max(1, Math.ceil((LURE_BY_ID[d.id?.slice(5)]?.pack || 10) / 2)));
      if (i) return { ...i, why: 'I have no bait of my own for the trip' };
    }
    // food: hungry, nothing to eat of its own, someone with something
    let N = null; try { N = this.needs(x.a); } catch { N = null; }
    if (N && N.hunger < 0.3 && !mine.some(st => st.item.startsWith('food:'))) {
      const i = pick(st => st.item.startsWith('food:'), () => 1);
      if (i) return { ...i, why: 'I\'m hungry' };
    }
    return null;
  }
  /** Asks its decision service whether to propose `idea` now, and proposes it if so (its words: its brain's). → true when proposed. */
  async propose(x, idea) {
    const econ = this.econ, fw = this.freeWillOf(), T = econ.parts.trades, name = clean(x.rec.name, 40);
    if (T.list(subj('agent', x.rec.id)).some(t => t.status === 'open' && t.them.who.kind === idea.to.kind && String(t.them.who.id) === String(idea.to.id))) return false;   // (one open between two)
    const wantW = idea.want.map(l => `${l.qty > 1 ? `${l.qty} × ` : ''}${clean(l.name, 40)}`).join(', ');
    const input = [`WHO: ${name}${x.rec.role ? `, ${clean(x.rec.role, 60)}` : ''}.`, `NOW: ${idea.why}. ${clean(idea.toName, 40)} has ${wantW} (worth ${vc(idea.worth)}).`, `MY MONEY: ${vc(idea.vc)} I could offer${idea.vc < idea.worth ? ' (less than it is worth)' : ''}.`].join('\n');
    const questions = [
      { type: 'choice', name: 'ask', instructions: `Does ${name} propose a trade for it now?`, choices: [
        { value: 'ask', description: idea.vc ? `Offer ${vc(idea.vc)} for ${wantW}` : `Ask for ${wantW} as a favour` }, { value: 'no', description: 'Not now' }] },
    ];
    let res = null;
    try { res = await fw.decideNow(x.rec.id, { input, questions }, { type: 'trade_idea', timeoutMs: 6000, options: [{ id: 'ask', kind: 'trade', label: `Propose ${wantW}` }, { id: 'no', kind: 'trade', label: 'Not now' }],
      summary: answers => { const a = answers.find(y => y.name === 'ask'); return { chosen: a?.choice || null, label: a?.choice === 'ask' ? `Proposed a trade for ${wantW}` : 'Not now', conf: a?.confidence, reason: 'trade_idea' }; } }); }
    catch { res = null; }
    const a = res?.answers?.find(y => y?.name === 'ask' && y.type === 'choice');
    if (a?.choice !== 'ask') return false;
    const r = this.economyOf().runAgentAction?.('tradePropose', { to: idea.to, give: idea.give, vc: idea.vc, want: idea.want.map(({ stack, qty }) => ({ stack, qty })), memo: `${idea.why[0].toUpperCase()}${idea.why.slice(1)}` }, x.rec.id, false);
    if (!r || r.status !== 'done') return false;
    this.note(x.rec.id, `Proposed a trade to ${clean(idea.toName, 40)}: ${idea.vc ? vc(idea.vc) : 'nothing'} for ${wantW} (${idea.why})`);
    try { this.companionsOf()?.remark?.(x.a.i, `${idea.why} — I just asked ${clean(idea.toName, 40)} for ${wantW}${idea.vc ? `, offering ${vc(idea.vc)}` : ', as a favour'}.`); } catch { /* its words are a bonus */ }
    return true;
  }
  start() { this.timer = setInterval(() => { this.think().catch(e => this.log?.warn?.('[agent-trades] thinking failed:', e.message)); }, 15000); this.timer.unref?.(); return this; }
  stop() { clearInterval(this.timer); this.timer = null; for (const t of this.pending.values()) clearTimeout(t); this.pending.clear(); }
}
