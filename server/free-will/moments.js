// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see
// LICENSE).
// Free Will in the moment (docs/features/free-will-and-mind.md "Moments"; the product owner, 2026-11-16: "Free Will is the
// will to act … so companions can do, act and see as if they are conscious and truly aware"): while an AI agent is out with
// its owner as a companion, what happens around it — its owner speaks or sits down, it gets into a car or arrives
// somewhere, deer cross the path, someone walks up, a long quiet, its own hunger or shift — is a moment; Free Will asks
// its decision service (OpenAI Decisions, TypeSafe's Jev) a few typed questions about it at once, from what it senses
// (server/senses/) and who it is, and acts on the answer right away: it looks at the thing, goes over for a closer look,
// comes closer, says something in its own words (its Mind, out loud), mentions or asks about its own life. Its chat brain
// only writes the words. Its owner's messages are checked first too (checkMessage): a claim about the world is looked at
// before it answers, a request for its body is carried out, and what its owner settled for this outing ("don't worry
// about work") is kept and told to it with every message of the outing.
//
// Only agents whose Free Will is on (its owner's switch) and that are a player's companion; bounded by Free Will's own
// daily limits, a gap between moments, and a cap per outing. Nothing here draws a simulation random number.
import { PF_USING } from '../../shared/playerproto.js';

export const GAP_MS = 20000;            // between two moments of one companion (its owner speaking: SPEAK_GAP_MS)
export const SPEAK_GAP_MS = 6000;
export const QUIET_MS = 150000;         // together this long without a word: a quiet moment
export const PER_OUTING = 60;           // moments one outing may ask about
export const TICK_MS = 2000;
export const ACT_P = 0.45;
export const JOIN_P = 0.3;              // …and in a joining moment (JOINING), its choice when it is the likeliest
/** Moments about joining its owner — they sat down (at a table, on a bench), they stepped up to a game for two: what a
 *  person out with someone answers whatever their temperament (2026-11-17, the product owner: Sam, a reserved one, never
 *  sat down at the restaurant — his spontaneity let no such moment through). Never filtered out by spontaneity or the
 *  outing's cap, asked soon; unanswered (no decision service, a timeout, gone stale), its body does what a companion
 *  without Free Will does: it sits down with them (server/companions/ autoSeat's own). */
export const JOINING = Object.freeze(new Set(['owner_sat', 'owner_game', 'owner_board']));              // an action this likely is done
export const SAY_P = 0.5;               // speaking this likely: it speaks
export const CHECK_TIMEOUT_MS = 1800;   // an owner's message waits this long for its check at most
/** The groups of what it senses a message may need (Senses.look's `only`): [name, in words for the decision service]. */
export const RELEVANT = Object.freeze([
  ['place', 'exactly where they are — the street, the area, the way, how fast they are going, places nearby'],
  ['around', 'who or what is around them — people, animals, cars, a waterfall or a lake in view, something happening nearby'],
  ['activity', 'what they are doing right now — driving, fishing, cooking, working, eating or drinking, the radio playing'],
  ['time', 'the time of day or the weather'],
  ['lately', 'what happened a little earlier today'],
]);
export const OUTING_MAX = 6;            // things its owner settled, kept per outing
const clean = (s, n = 120) => String(s ?? '').replace(/[\u0000-\u001f«»]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const q = (s, n = 120) => `«${clean(s, n)}»`;
/** How much each kind of moment matters (before its spontaneity): below 0.5 × … it lets it pass. */
// (owner_game: its owner stepped up to a table for two — an invitation to play them: server/play/versus.js)
const SALIENCE = Object.freeze({ owner_board: 0.75, owner_said: 1, owner_game: 0.9, saw: 0.85, car: 0.7, arrived: 0.65, owner_sat: 0.6, approach: 0.55, self: 0.6, work: 0.55, quiet: 0.45, owner: 0.4 });

export class Moments {
  /**
   * @param {object} o
   * @param {object} o.freeWill    server/free-will/free-will.js (decideNow, byPerson, settingsOf, config)
   * @param {() => object} o.senses     server/senses/senses.js
   * @param {() => object} o.companions server/companions/companions.js
   * @param {() => object} o.mind       server/mind/mind.js (speak, remark)
   * @param {object} o.agents     the agent registry
   * @param {object} o.players    server/world/players.js
   * @param {() => object} o.sim
   * @param {(k: string) => any} o.setting
   */
  constructor({ freeWill, senses, companions, mind, agents, players, sim, interactions = null, principalFor = () => null, setting = () => undefined, now = () => Date.now(), log = null }) {
    Object.assign(this, { freeWill, agents, players, setting, now, log, principalFor, interactions });
    this.sensesOf = senses; this.companionsOf = companions; this.mindOf = mind; this.simOf = sim;
    this.state = new Map();     // agent id → { outing (its order's start), asked, lastAt, busy, saidAt, quietFrom, seen: Set, owner: { using, car } }
    this.outings = new Map();   // agent id → { at (the order's start), lines: [{ text, at }], work } — what its owner settled
    this.queue = new Map();     // agent id → the moment waiting (the most salient)
    this.stats = { moments: 0, asked: 0, acted: 0, said: 0, checked: 0, checkedClaims: 0, settled: 0, skipped: 0 };
    this.timer = null; this.off = null;
  }
  enabled() { return this.setting('freeWill.moments') !== false; }

  // ------------------------------------------------------------------------------------------- who
  /** Agent rec's companionship now, when it is a player's companion with Free Will on: { i, a, owner, view } or null. */
  companionOf(rec) {
    const S = this.sensesOf?.(), C = this.companionsOf?.(), sim = this.simOf?.();
    if (!S || !C || !sim || !rec) return null;
    const i = S.bodyOf(rec);
    if (i < 0) return null;
    const a = sim.agents[i], o = a?.order;
    if (!o || o.kind !== 'follow' || o.lead?.kind !== 'player') return null;
    if (!this.freeWillOn(rec.id)) return null;
    let view = null; try { view = C.view(a); } catch { view = null; }
    if (!view || view.state === 'away') return null;
    return { i, a, owner: o.lead.id, view, outing: Number.isFinite(o.at) ? o.at : 0 };
  }
  freeWillOn(agentId) { for (const v of this.freeWill.byPerson?.values?.() || []) if (v.agentId === Number(agentId)) return true; return false; }
  stateOf(id, outing) {
    let s = this.state.get(id);
    if (!s || s.outing !== outing) { s = { outing, asked: 0, lastAt: 0, busy: false, saidAt: this.now(), quietFrom: this.now(), seen: new Set(), owner: null, needs: new Set() }; this.state.set(id, s); }
    return s;
  }

  // ------------------------------------------------------------------------------------------- what its owner settled
  /** What its owner settled for this outing (its order's start), oldest first: ['Kim said: «…» (10:12 AM)']. */
  outingLines(agentId) {
    const sim = this.simOf?.(), S = this.sensesOf?.(), rec = this.agents.get(agentId), i = rec && S ? S.bodyOf(rec) : -1;
    const ord = i >= 0 ? sim.agents[i]?.order : null, o = this.outings.get(Number(agentId));
    if (!o || !ord || !Number.isFinite(ord.at) || o.at !== ord.at) return [];
    return o.lines.map(l => l.text);
  }
  /** Keeps what its owner settled for this outing; work: its work can wait (no more moments about it this outing). */
  settle(agentId, text, { work = false } = {}) {
    const sim = this.simOf?.(), S = this.sensesOf?.(), rec = this.agents.get(agentId), i = rec && S ? S.bodyOf(rec) : -1;
    const at = i >= 0 ? sim.agents[i]?.order?.at : null;
    if (!Number.isFinite(at)) return;
    let o = this.outings.get(Number(agentId));
    if (!o || o.at !== at) this.outings.set(Number(agentId), o = { at, lines: [], work: false });
    if (work) o.work = true;
    o.lines.push({ text: String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260), at: this.now() });   // («» kept: its owner's words, quoted)
    if (o.lines.length > OUTING_MAX) o.lines.shift();
    this.stats.settled++;
  }
  /** Whether its owner said its work can wait, this outing ("don't worry about the job"). */
  workSettled(agentId) {
    const sim = this.simOf?.(), S = this.sensesOf?.(), rec = this.agents.get(agentId), i = rec && S ? S.bodyOf(rec) : -1;
    const ord = i >= 0 ? sim.agents[i]?.order : null, o = this.outings.get(Number(agentId));
    return !!(o?.work && ord && o.at === ord.at);
  }

  // ------------------------------------------------------------------------------------------- moments
  /** A line in an AI agent's diary (server/senses/diary.js): a moment, when it is a companion and it matters. */
  onLine(agentId, line) {
    if (!this.enabled() || !line) return;
    const rec = this.agents.get(agentId), c = rec ? this.companionOf(rec) : null;
    if (!c) return;
    const k = line.kind, t = line.text || '';
    let kind = null;
    if (k === 'heard') {
      const own = /\(your owner\):/.test(t);
      if (own) kind = 'owner_said';
    } else if (k === 'said') { const s = this.stateOf(rec.id, c.outing); s.saidAt = this.now(); s.quietFrom = this.now(); return; }
    else if (k === 'saw') kind = 'saw';
    else if (k === 'move') kind = /^Got (into|out of)/.test(t) ? 'car' : /^(Went into|Came home|Went outside)/.test(t) ? 'arrived' : null;
    else if (k === 'work') kind = this.workSettled(rec.id) ? null : 'work';   // (its owner said work can wait: not raised again)
    else if (k === 'with') kind = /came over to you|went off/.test(t) ? 'owner' : null;
    // (its owner got into an aircraft with room for it — server/play/flight-crew.js offer —: joining them, not a sight)
    else if (k === 'activity') kind = /\(your owner\) got into the .+ there is room for you/.test(t) ? 'owner_board' : 'saw';
    if (!kind) return;
    if (kind === 'owner_said') { const s = this.stateOf(rec.id, c.outing); s.quietFrom = this.now(); }
    this.offer(rec, c, { kind, text: t });
  }
  /** A moment for rec: kept when it is the most salient waiting (one per companion at a time). m.after(pick, did): told
   *  what it chose once it is decided (server/play/versus.js: an invitation that wasn't taken up). */
  offer(rec, c, m) {
    this.stats.moments++;
    const prev = this.queue.get(rec.id);
    if (!prev || (SALIENCE[m.kind] || 0) >= (SALIENCE[prev.kind] || 0)) this.queue.set(rec.id, { ...m, at: this.now() });
  }
  /** Every TICK_MS: its owner sat down or got going, a long quiet, its own needs — then the moments waiting are asked about. */
  tick() {
    if (!this.enabled()) { this.queue.clear(); return; }
    const sim = this.simOf?.();
    if (!sim) return;
    for (const v of this.freeWill.byPerson?.values?.() || []) {
      const rec = this.agents.get(v.agentId), c = rec ? this.companionOf(rec) : null;
      if (!c) continue;
      const s = this.stateOf(rec.id, c.outing), p = this.players?.byId?.get(c.owner), now = this.now();
      // its owner: sat down (using something where they stand), into a car
      if (p) {
        const using = !!(p.flags & PF_USING) && !p.vehicleId, was = s.owner;
        if (was && using && !was.using) {
          // (sat down — on what —, or busy at something there: what, from the world's own interaction points, so it may join)
          const seat = this.ownerSeat(c.owner), join = seat ? null : this.worldFor(rec, 8).find(x => x.withLeader);
          this.offer(rec, c, { kind: 'owner_sat', text: seat ? `${clean(p.name, 40)} (your owner) sat down ${seatIn(seat)}` : `${clean(p.name, 40)} (your owner) is busy at something here${join ? ` (${clean(join.label, 100)})` : ''}` });
        }
        s.owner = { using };
      }
      // a long quiet together (its owner near): a moment to say something — or not
      if (c.view.state === 'following' || c.view.state === 'riding' || c.view.state === 'waiting') {
        if (now - Math.max(s.quietFrom, s.saidAt) > QUIET_MS) { s.quietFrom = now; this.offer(rec, c, { kind: 'quiet', text: 'A while has passed without a word between you' }); }
      }
      // its own body: hungry, tired (once each an outing)
      const needs = sim.brain?.needsAt?.(c.a, sim.now(), {}) || {};
      for (const [k, low, words] of [['hunger', 0.3, 'You are getting hungry'], ['energy', 0.25, 'You are getting tired']]) {
        if (Number.isFinite(needs[k]) && needs[k] < low && !s.needs.has(k)) { s.needs.add(k); this.offer(rec, c, { kind: 'self', text: words }); }
      }
    }
    for (const [id, m] of [...this.queue]) {
      const rec = this.agents.get(id), c = rec ? this.companionOf(rec) : null;
      if (!c) { this.queue.delete(id); continue; }
      const s = this.stateOf(id, c.outing), now = this.now();
      if (s.busy) continue;
      if (now - m.at > 60000 || (m.kind === 'work' && this.workSettled(id))) { this.queue.delete(id); this.stats.skipped++; if (JOINING.has(m.kind)) this.unanswered(rec, c, m); continue; }   // (stale: the moment has passed; work settled meanwhile)
      const joining = JOINING.has(m.kind), gap = m.kind === 'owner_said' || joining ? SPEAK_GAP_MS : GAP_MS;
      if (now - s.lastAt < gap) continue;
      if (s.asked >= PER_OUTING && !joining) { this.queue.delete(id); this.stats.skipped++; continue; }
      // (how much it matters to this one: its spontaneity — an adventurous agent reacts to more)
      const sp = this.freeWill.settingsOf?.(id)?.spontaneity ?? 0.5;
      if (m.kind !== 'owner_said' && !joining && (SALIENCE[m.kind] || 0) * (0.6 + sp) < 0.5) { this.queue.delete(id); this.stats.skipped++; continue; }
      this.queue.delete(id);
      s.busy = true; s.lastAt = now; s.asked++;
      this.decide(rec, c, m).catch(e => this.log?.warn?.('[moments] a moment failed:', e.message)).finally(() => { s.busy = false; });
    }
  }

  /** What it may do in moment m: [{ id, kind, label, target? }] (stay is always there). */
  optionsFor(rec, c, m, look) {
    const sim = this.simOf(), owner = clean(this.ownerName(c.owner), 40);
    const opts = [{ id: 'stay', kind: 'stay', label: `Carry on as I am, with ${owner}` }];
    const me = look?.data?.where, around = look?.data?.around || [];
    const moving = (() => { try { return !!this.companionsOf()?.playerLead?.(c.owner)?.moving; } catch { return false; } })();
    // something to look at: an animal or a person near (not its owner), nearest first — and its owner (not while it is busy
    // at something with its own way to stop — cooking a Rush: a glance would pull its body away; its options say how to stop)
    const busy = !!c.view?.busy;
    const things = busy ? [] : around.filter(x => !x.writer && Number.isFinite(x.x) && Number.isFinite(x.z)).slice(0, 2);
    for (const [k, x] of things.entries()) {
      opts.push({ id: `look${k}`, kind: 'look', label: `Turn and look at ${x.name}${x.doing ? ` (${clean(x.doing, 40)})` : ''}`, target: x });
      if (!c.a.ride && me && me.ctx < 0 && x.d > 4 && x.d < (x.kind === 'animal' ? 110 : 35) && !moving) opts.push({ id: `see${k}`, kind: 'see', label: `Go over for a closer look at ${x.name}`, target: x });
    }
    const ownerHere = around.find(x => x.writer || x.rel?.startsWith('your owner'));
    if (ownerHere && ownerHere.d > 4 && !c.a.ride && !busy) opts.push({ id: 'closer', kind: 'closer', label: `Go and stand right beside ${owner}` });
    if (ownerHere && !c.a.ride && !busy) opts.push({ id: 'face', kind: 'face', label: `Turn to ${owner}`, target: ownerHere });
    // its owner sitting (a bench, the fountain's edge, their table): sit down with them — at a table where food is served,
    // or sit and order something too; seated already, get up (its body: server/companions/ 'sit' | 'eat' | 'stand')
    // what it can do in the world right here (server/interactions/: sitting down with them, joining their meal, using
    // what is near them — an arcade cabinet, the dance floor, the piano …): joining what its owner does first
    // (not a quick errand away from them — a bite, a coffee —: that is asked for, or its owner says so: checkMessage)
    const world = this.worldFor(rec, 12).filter(x => !x.errand).slice(0, 6);
    world.forEach((x, k) => opts.push({ id: `w${k}`, kind: 'world', label: clean(x.label, 160), aff: x.id }));
    const seat = this.ownerSeat(c.owner), mine = c.view?.seat || null;
    if (!this.interactions && seat && !mine && !c.a.ride) {
      opts.push({ id: 'sit', kind: 'sit', label: `Sit down with ${owner} (they are sitting ${seatIn(seat)})` });
      if (seat.use === 'eat' && seat.venue) opts.push({ id: 'eat', kind: 'eat', label: `Sit at ${owner}'s table and order something to eat or drink` });
    }
    if (!this.interactions && mine && !seat) opts.push({ id: 'stand', kind: 'stand', label: `Get up and go on with ${owner}` });
    void sim;
    return opts;
  }
  /** What agent rec can do in the world now (server/interactions/ nearFor): at most n, or [] (no registry, no body). */
  worldFor(rec, n = 6) { try { return this.interactions ? this.interactions.nearFor(rec, { limit: n }) : []; } catch (e) { this.log?.warn?.('[moments] what it can do:', e.message); return []; } }
  /** Does affordance id for agent rec (server/interactions/ doFor) → its honest result ({ ok, text, brain }), or a
   *  promise of it (a source that takes a moment). */
  worldDo(rec, id, via) { try { return this.interactions ? this.interactions.doFor(rec, id, { via }) : { ok: false, text: '', brain: 'nothing can be done here' }; } catch (e) { return { ok: false, text: String(e.message || e).slice(0, 160), brain: `it could not be done: ${String(e.message || e).slice(0, 160)}` }; } }
  /** A joining moment nobody answered (JOINING): its body does what a companion without Free Will does — its owner still
   *  sitting and it not, it sits down with them (as told: server/companions/ 'sit'). */
  unanswered(rec, c, m) {
    if (m.kind === 'owner_board') {   // (its owner in an aircraft with room for it: in with them, as one without Free Will gets in)
      const board = this.worldFor(rec, 12).find(x => x.kind === 'board' && x.withLeader);
      if (board) { const r = this.worldDo(rec, board.id, 'freewill'); if (r && typeof r.then === 'function') r.catch(() => null); else if (r?.ok) this.stats.acted++; }
      return;
    }
    if (m.kind !== 'owner_sat' || !this.ownerSeat(c.owner) || c.a.order?.seat || c.a.ride) return;
    let r = this.interactions ? this.worldDo(rec, 'body:sit', 'freewill') : this.bodyDo(rec, c, 'sit', 'freewill');
    if (r && typeof r.then === 'function') { r.catch(() => null); return; }
    if (r && r.ok !== false) { this.stats.acted++; this.stats.defaults = (this.stats.defaults || 0) + 1; }
  }
  /** The seat its owner's character is on now (server/companions/ leaderSeat), or null. */
  ownerSeat(account) { try { return this.companionsOf?.()?.leaderSeat?.(account) || null; } catch { return null; } }
  /** Its body sits down with its owner, gets up, or joins their meal (server/companions/ command, as its owner): the
   *  result ({ ok, text, brain }) — or null when it can't be asked. */
  bodyDo(rec, c, action, via = 'decision') {
    const C = this.companionsOf?.(), P = this.principalFor?.(c.owner);
    if (!C || !P?.account) return null;
    try { return C.command(P, { agent: rec.id, action }, via); } catch (e) { return { ok: false, action, text: String(e.message || e).slice(0, 160) }; }
  }
  ownerName(account) {
    const S = this.sensesOf?.();
    try { return S ? S.nameOf(account) : 'your owner'; } catch { return 'your owner'; }
  }
  /** Who it is, in a few lines, for a decision: name, role, personality, how it feels, its work and plans, the outing. */
  selfText(rec, c) {
    const lines = [];
    const S = this.sensesOf?.(), sim = this.simOf(), p = sim.people[c.i];
    let ctx = null; try { ctx = this.freeWill.contextFn ? this.freeWill.contextFn(rec.id) : null; } catch { ctx = null; }
    lines.push(`${clean(rec.name, 40)}${rec.role ? `, ${clean(rec.role, 60)}` : ''}.${ctx?.personality?.length ? ` Personality: ${ctx.personality.join(', ')}.` : ''}`);
    if (ctx?.likes?.length) lines.push(`Likes ${ctx.likes.slice(0, 4).map(x => clean(x, 40)).join(', ')}.`);
    const n = sim.brain?.needsAt?.(c.a, sim.now(), {});
    if (n) lines.push(`Feels ${[n.hunger < 0.3 ? 'hungry' : null, n.energy < 0.3 ? 'tired' : null, n.fun < 0.4 ? 'bored' : null, n.social < 0.4 ? 'lonely' : null].filter(Boolean).join(', ') || 'fine'}.`);
    if (ctx?.plans?.length) lines.push(`Own plans today: ${ctx.plans.slice(0, 3).map(x => clean(x, 80)).join('; ')}.`);
    const out = this.outingLines(rec.id);
    if (out.length) lines.push(`This outing, ${clean(this.ownerName(c.owner), 40)} settled: ${out.join('; ')}`);
    void S; void p;
    return lines.join('\n');
  }

  /** Asks about moment m and acts on the answer. */
  async decide(rec, c, m) {
    const S = this.sensesOf(), sim = this.simOf();
    const look = S.look(rec, { account: c.owner, together: { yes: true, how: 'out with you, as your companion' } });
    if (!look) return;
    const owner = clean(this.ownerName(c.owner), 40), name = clean(rec.name, 40);
    const opts = this.optionsFor(rec, c, m, look);
    const own = m.kind === 'self' || m.kind === 'work';
    const input = [`WHO: ${this.selfText(rec, c)}`, `OUT WITH: ${owner} (its owner) — ${name} is their companion.`, `WHAT ${name.toUpperCase()} SENSES:`, look.text.slice(0, 1400), `JUST NOW: ${clean(m.text, 240)}.`].join('\n');
    const questions = [
      { type: 'choice', name: 'do', instructions: `What does ${name} do now, right after this — as ${name} would (their personality, their mood, what they are doing with ${owner})?`, choices: opts.map(o => ({ value: o.id, description: o.label })) },
      { type: 'choice', name: 'speak', instructions: `Does ${name} say something out loud about it now?`, choices: [
        { value: 'quiet', description: `Says nothing — it isn't worth a word${m.kind === 'quiet' ? ', a quiet moment together is fine' : ''}` },
        { value: 'say', description: m.kind === 'owner_said' ? `Answers ${owner}` : 'Says something short about it, in their own words' }] },
    ];
    if (own) questions.push({ type: 'choice', name: 'own', instructions: `${clean(m.text, 120)} — while out with ${owner}. What does ${name} do about it?`, choices: [
      { value: 'let_be', description: `Lets it be for now (${owner} comes first, or it can wait)` },
      { value: 'mention', description: `Mentions it to ${owner} once` },
      { value: 'ask', description: `Asks ${owner} whether they can go and deal with it` }] });
    const when = (() => { try { return S.when(); } catch { return null; } })(), place = look.data?.where?.short || null;
    const res = await this.freeWill.decideNow(rec.id, { input, questions }, { type: 'moment', when, place, options: opts.map(o => ({ id: o.id, kind: o.kind, label: o.label })), timeoutMs: 4000,
      summary: answers => {
        const d = answers.find(x => x.name === 'do' && x.type === 'choice'), sp = answers.find(x => x.name === 'speak' && x.type === 'choice');
        const o = opts.find(x => x.id === d?.choice);
        return { chosen: d?.choice || null, label: [o ? o.label : null, sp?.choice === 'say' ? 'and said something' : null].filter(Boolean).join(' — ') || null,
          conf: d?.confidence, probs: (d?.probabilities || []).map(p => ({ id: p.value, p: p.probability })), reason: m.kind };
      } });
    this.stats.asked++;
    if (!res) { if (JOINING.has(m.kind)) this.unanswered(rec, c, m); return; }
    const ans = n => res.answers.find(x => x && x.name === n && x.type === 'choice');
    const p = (a, v) => (a?.probabilities || []).find(x => x.value === v)?.probability ?? (a?.choice === v ? a.confidence ?? 1 : 0);
    const d = ans('do'), sp = ans('speak'), ow = ans('own');
    // act: at once, when it is likely enough (staying as it is is no act)
    const pick = opts.find(o => o.id === d?.choice);
    let did = null;
    // (a joining moment — its owner sat down, got into an aircraft, stepped up to a game —: its choice is done when it is
    //  the likeliest and at least JOIN_P, a split mind between going along and staying is still a choice made — 2026-11-17:
    //  Mira chose to get in with 0.38 and nothing happened)
    const actP = JOINING.has(m.kind) ? JOIN_P : ACT_P;
    if (pick && pick.kind !== 'stay' && p(d, pick.id) >= actP) did = await this.act(rec, c, pick);
    try { m.after?.(did ? pick : null, did); } catch { /* whoever asked: their trouble */ }
    // speak: in its own words (its Mind), out loud, within its speech limits
    const mind = this.mindOf?.();
    const wantsOwn = ow && ow.choice !== 'let_be' && p(ow, ow.choice) >= ACT_P ? ow.choice : null;
    if (mind && ((sp?.choice === 'say' && p(sp, 'say') >= SAY_P) || wantsOwn)) {
      const s = this.stateOf(rec.id, c.outing);
      const sense = look.text.slice(0, 900);
      let r = null;
      if (m.kind === 'owner_said') {
        const heard = (/: «(.*)»$/.exec(m.text) || [])[1] || m.text;
        r = await mind.speak(rec, { kind: 'reply', to: { name: owner, how: 'my owner' }, heard, together: 'out together, as their companion', sense });
      } else {
        const situation = [`Out with ${owner} (my owner).`, `Just now: ${clean(m.text, 160)}.`, did ? `I ${did}.` : '', wantsOwn === 'mention' ? 'I mention it to them, once.' : wantsOwn === 'ask' ? 'I ask them whether I can go and deal with it.' : ''].filter(Boolean).join(' ');
        r = await mind.remark(rec, situation, owner, { sense });
      }
      if (r?.shown) { this.stats.said++; s.saidAt = this.now(); }
    }
  }
  /** Carries out what it chose: { kind: look|see|closer|face, target } — the words of what it did, or null. */
  act(rec, c, pick) {
    const sim = this.simOf(), B = sim.brain, a = c.a, t = pick.target;
    try {
      if ((pick.kind === 'look' || pick.kind === 'face') && t) { if (B.attendTo(a, { x: t.x, z: t.z, label: clean(t.name, 40), secs: B.wm(4) })) { this.stats.acted++; return `turned to look at ${clean(t.name, 40)}`; } }
      if (pick.kind === 'see' && t) { if (B.goSee(a, { x: t.x, z: t.z, ctx: a.plan?.ctx ?? -1, label: `${clean(t.name, 40)}`, secs: B.wm(12), near: t.kind === 'animal' ? 25 : 2.5 })) { this.stats.acted++; S_note(this.sensesOf(), rec.id, `Went over for a closer look at ${clean(t.name, 40)}`); return `went over for a closer look at ${clean(t.name, 40)}`; } }
      if (pick.kind === 'closer') { a.detour = null; a.attend = null; B.reorder(a); this.stats.acted++; return 'came closer'; }
      if (pick.kind === 'world' && pick.aff) {
        // (something in the world, for real: its body does it — or can't, and nothing is claimed)
        const done = r => !!r?.ok;   // (its diary has it: server/interactions/ onDone)
        const r = this.worldDo(rec, pick.aff, 'freewill');
        if (r && typeof r.then === 'function') { r.then(done, () => false); this.stats.acted++; const l = clean(pick.label, 120); return `set about it: ${l.charAt(0).toLowerCase()}${l.slice(1)}`; }
        if (done(r)) { this.stats.acted++; const l = clean(pick.label, 120); return `chose to ${l.charAt(0).toLowerCase()}${l.slice(1)}`; }
        return null;
      }
      if (pick.kind === 'sit' || pick.kind === 'eat' || pick.kind === 'stand') {
        const r = this.bodyDo(rec, c, pick.kind, 'freewill');
        if (r?.ok !== false && r) { this.stats.acted++; return pick.kind === 'sit' ? `sat down with ${clean(this.ownerName(c.owner), 40)}` : pick.kind === 'eat' ? `sat down at ${clean(this.ownerName(c.owner), 40)}'s table to eat` : 'got up'; }
      }
    } catch (e) { this.log?.warn?.('[moments] acting failed:', e.message); }
    return null;
  }

  // ------------------------------------------------------------------------------------------- its owner's message
  /**
   * Its owner's message, checked before it answers (server/chat/chat.js): does it say something about the world (then it
   * looks, and is told what it saw), does it ask its body to do something (then it is done), does it settle something
   * for this outing (then it is kept). rec: the agent; account: who wrote; text: the message. → { checked (what it saw,
   * words for its note) | null, did ({ ok, action, text } as the reflex's) | null, settled } or null (no check).
   */
  async checkMessage(rec, account, text, { reflexDone = false, P = null } = {}) {
    if (!this.enabled() || !text || !this.freeWillOn(rec.id)) return null;
    const S = this.sensesOf?.(), C = this.companionsOf?.();
    if (!S || S.bodyOf(rec) < 0 || S.modeOf(rec.id) === 'off') return null;
    const look = S.look(rec, { account });
    if (!look) return null;
    const name = clean(rec.name, 40), owner = clean(this.ownerName(account), 40);
    const input = [`${owner} (the owner of the AI agent ${name}) wrote to ${name}: ${q(text, 500)}`, `WHAT ${name.toUpperCase()} SENSES RIGHT NOW:`, look.text.slice(0, 1400),
      ...(this.outingLines(rec.id).length ? [`THIS OUTING, ${owner} settled: ${this.outingLines(rec.id).join('; ')}`] : [])].join('\n');
    const questions = [
      { type: 'predicate', name: 'about_world', instructions: `Does the message say or ask something about where ${owner} or ${name} is, who or what is around, or what is happening right now?` },
      { type: 'choice', name: 'matches', instructions: `If it does: does it match what ${name} senses?`, choices: [
        { value: 'na', description: 'The message says nothing about the world right now' }, { value: 'yes', description: 'Yes, it matches' },
        { value: 'no', description: 'No, it does not match what it senses' }, { value: 'unsure', description: 'Its senses don\'t show it either way' }] },
      { type: 'predicate', name: 'settles', instructions: `Does ${owner} settle something about ${name}'s own life or manner for now — e.g. not to worry about work, to be quieter, to stop suggesting places, to stay with them?` },
      { type: 'predicate', name: 'work_waits', instructions: `Does ${owner} tell ${name} that its work or shift can wait for now — not to worry about the job, to stay with them instead?` },
      // what of its senses answering this needs (RELEVANT): told only that with the message — someone beside you notices
      // everything and mentions what matters; the rest is a look away. Its eyes only when it must see.
      ...RELEVANT.map(([n, what]) => ({ type: 'predicate', name: `needs_${n}`, instructions: `To answer ${owner}'s message naturally, does ${name} need to know ${what}? (Small talk, feelings, plans and opinions need none of it.)` })),
      { type: 'predicate', name: 'needs_sight', instructions: `Does answering need to SEE what something looks like right now — its colour or shape, what an animal or a thing is, reading a sign, how something looks — more than knowing that it is there?` },
    ];
    const comp = this.companionOf(rec);
    const acts = [];
    if (!reflexDone && C && P) {
      acts.push({ id: 'none', description: 'Nothing for its body: a question, a remark, a chat' });
      if (!comp) acts.push({ id: 'follow', description: `Come along with ${owner}, be their companion` });
      if (comp) acts.push({ id: 'closer', description: `Come closer to ${owner}, right beside them` }, { id: 'stay', description: 'Wait where it is' }, { id: 'dismiss', description: 'Stop being a companion and go back to its own day' });
      // what it can do in the world right where it is (server/interactions/): out with its owner — sitting down with them,
      // joining their meal, using what is near them; on its own — going for a meal, shopping, the gym, using what is near
      // it ("go and get your groceries": its body really goes and buys them)
      const world = this.worldFor(rec, 8);
      world.forEach((x, k) => acts.push({ id: `w${k}`, description: clean(x.label, 160), aff: x.id }));
      // (sitting down with them, getting up, joining their meal: its body really does it — server/companions/)
      if (comp && !this.interactions) {
        const seat = this.ownerSeat(account);
        acts.push({ id: 'sit', description: `Sit down — beside ${owner}${seat ? ` (they are sitting ${seatIn(seat)})` : ''}` });
        if (comp.view?.seat) acts.push({ id: 'stand', description: 'Get up' });
        if (seat?.use === 'eat' && seat.venue) acts.push({ id: 'eat', description: `Sit at ${owner}'s table and order something to eat or drink` });
      }
      const things = (look.data?.around || []).filter(x => !x.writer && Number.isFinite(x.x)).slice(0, 2);
      things.forEach((x, k) => acts.push({ id: `look${k}`, description: `Look at ${x.name}` }));
      questions.push({ type: 'choice', name: 'act', instructions: `What does ${owner} want ${name}'s body to do now? "none" unless the message asks for it.`, choices: acts.map(x => ({ value: x.id, description: x.description })) });
    }
    const res = await Promise.race([
      this.freeWill.decideNow(rec.id, { input, questions }, { type: 'check', when: (() => { try { return S.when(); } catch { return null; } })(), place: look.data?.where?.short || null,
        options: acts.map(x => ({ id: x.id, kind: 'act', label: x.description })), timeoutMs: CHECK_TIMEOUT_MS,
        summary: answers => { const a = answers.find(x => x.name === 'act' && x.type === 'choice'), m = answers.find(x => x.name === 'matches'); return { chosen: a?.choice || m?.choice || null, label: [m ? `the message ${m.choice === 'yes' ? 'matched what it senses' : m.choice === 'no' ? 'did not match what it senses: it looked' : m.choice === 'unsure' ? 'was about something its senses don\'t show: it looked' : 'was not about the world'}` : null, a && a.choice !== 'none' ? (acts.find(x => x.id === a.choice)?.description || a.choice) : null].filter(Boolean).join(' — '), conf: a?.confidence ?? m?.confidence, probs: (a?.probabilities || m?.probabilities || []).map(p => ({ id: p.value, p: p.probability })), reason: 'message' }; } }),
      new Promise(r => setTimeout(() => r(null), CHECK_TIMEOUT_MS + 200)),
    ]);
    if (!res) return null;
    this.stats.checked++;
    const pr = n => res.answers.find(x => x && x.name === n && x.type === 'predicate')?.probability ?? 0;
    const ch = n => res.answers.find(x => x && x.name === n && x.type === 'choice');
    const about = pr('about_world') >= 0.5, matches = ch('matches');
    // (what of its senses goes with the message: the groups it needs — none for small talk —, and whether it must see)
    const relevant = RELEVANT.map(([n]) => n).filter(n => pr(`needs_${n}`) >= 0.5), sight = pr('needs_sight') >= 0.5;
    let checked = null, brief = null;
    if (about) {
      this.stats.checkedClaims++;
      // (only a claim its senses don't bear out needs words of its own: one that matches needs nothing more said)
      const verdict = matches?.choice === 'no' ? 'It does not match what your owner says — say what you see, gently, and offer to check or come over; never just deny it.'
        : matches?.choice === 'unsure' ? 'Your senses don\'t show it either way: your owner may see what you can\'t — say you hadn\'t noticed, never deny it.' : '';
      if (verdict) {
        checked = `You checked just now, because ${owner} said something about what is around you:\n${look.text.slice(0, 1400)}\n${verdict}`;
        // (with the full picture already in its note, the look is not said twice: only that it checked, and the verdict)
        brief = `You checked just now, because ${owner} said something about what is around you. ${verdict}`;
      }
    }
    // its body: what its owner asked for, done now (as its owner: the same command its buttons give)
    let did = null;
    const act = ch('act');
    const pa = act ? ((act.probabilities || []).find(x => x.value === act.choice)?.probability ?? act.confidence ?? 0) : 0;
    if (act && act.choice !== 'none' && pa >= 0.6 && C && P) {
      try {
        if (/^w\d+$/.test(act.choice)) {
          const x = acts.find(y => y.id === act.choice);
          let r = x?.aff ? this.worldDo(rec, x.aff, 'decision') : null;
          if (r && typeof r.then === 'function') r = await r;
          if (r) did = { ok: r.ok !== false, action: 'world', text: r.text || '', brain: r.brain || r.text || '' };
        } else if (act.choice === 'sit' || act.choice === 'stand' || act.choice === 'eat') {
          const r = C.command(P, { agent: rec.id, action: act.choice }, 'decision');
          did = { ok: r?.ok !== false, action: act.choice, text: r?.text || '', brain: r?.brain || r?.text || '' };
        } else if (act.choice === 'follow' || act.choice === 'stay' || act.choice === 'dismiss') {
          const r = C.command(P, { agent: rec.id, action: act.choice, target: 'me', place: act.choice === 'stay' ? 'here' : null }, 'decision');
          did = { ok: true, action: act.choice, text: r.text, brain: r.brain || r.text };
        } else if (act.choice === 'closer' && comp) { comp.a.detour = null; comp.a.attend = null; this.simOf().brain.reorder(comp.a); did = { ok: true, action: 'closer', text: `${rec.name} is coming closer`, brain: `you are walking over to stand right beside ${owner}` }; }
        else if (/^look\d$/.test(act.choice)) {
          const x = (look.data?.around || []).filter(y => !y.writer && Number.isFinite(y.x))[Number(act.choice.slice(4))];
          if (x && this.simOf().brain.attendTo(this.simOf().agents[S.bodyOf(rec)], { x: x.x, z: x.z, label: clean(x.name, 40), secs: this.simOf().brain.wm(4) })) did = { ok: true, action: 'look', text: `${rec.name} looks at ${x.name}`, brain: `you turned to look at ${clean(x.name, 40)}` };
        }
      } catch (e) { did = { ok: false, action: act.choice, text: String(e.message || e).slice(0, 160) }; }
    }
    // what it settles is kept for the outing — once what it asked for is done: "come out, don't worry about the job" is
    // kept for the outing that message starts (before, it was kept for none: there was no outing yet)
    const work = pr('work_waits') >= 0.6;
    if (pr('settles') >= 0.6 || work) this.settle(rec.id, `${owner} said: ${q(text, 200)}${(() => { try { return ` (${S.when()})`; } catch { return ''; } })()}`, { work });
    return { checked, brief, did, settled: pr('settles') >= 0.6 || work, about, relevant, sight };
  }

  // ------------------------------------------------------------------------------------------- running
  attach() {
    const S = this.sensesOf?.();
    if (S?.diary?.on) this.off = S.diary.on((id, line) => { try { this.onLine(id, line); } catch (e) { this.log?.warn?.('[moments]', e.message); } });
    if (!this.timer) { this.timer = setInterval(() => { try { this.tick(); } catch (e) { this.log?.warn?.('[moments] tick failed:', e.message); } }, TICK_MS); this.timer.unref?.(); }
    return this;
  }
  stop() { clearInterval(this.timer); this.timer = null; try { this.off?.(); } catch { /* gone */ } }
  view() { return { ...this.stats, companions: this.state.size, waiting: this.queue.size, enabled: this.enabled() }; }
}
const S_note = (S, id, text) => { try { S?.note?.(id, 'move', text); } catch { /* the diary misses one line */ } };
/** Where its owner sits, in words: "on a bench", "at a table at «Restaurant 16»". */
const seatIn = seat => { const w = String(seat.words || ''); return `${seat.use === 'eat' || /\btable\b/.test(w) ? 'at' : /\b(armchair|sofa|couch)\b/.test(w) ? 'in' : 'on'} ${clean(w || 'a seat', 80)}`; };
