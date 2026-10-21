// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Jobs (docs/features/ECONOMY.md §8, docs/features/WORK-MODULES.md): a player or an agent works a role at a venue in
// place of the venue's own staff — users first, then agents, then the residents whose job it is. Each role is a work
// module (shared/work.js): it makes the orders and scores the raw inputs; this core owns everything around it.
//
// - The venue's TICKETS are its real customers: every purchase there (a resident's visit, a player's or an agent's
//   order) opens a ticket that passes through the venue's roles in order (a restaurant: the kitchen cooks, the floor
//   serves). A worker's next order is the oldest ticket waiting at their role; a stage nobody plays is done by the
//   venue's own staff. With no ticket waiting the worker serves a walk-in (a resident there, or a passer-by): paid the
//   same, but only a ticket's customer tips and reviews — a review always comes from someone who really bought.
// - The pace is a person's: an order faster than its module allows is refused, and orders a minute are capped.
// - Pay: the venue pays for the time actually worked (real minutes at the world's usual pace, so a faster clock never
//   pays more) × the stars earned; tips come from the customers who left them; income tax is withheld. The residents a
//   worker covered aren't paid for those hours (./households.js), so the venue's wage bill stays what it was.
// - An agent may also work "auto" (spec 02 §9): only in a role it has played at that venue, at the policy's share of
//   the wage, capped a day, with no tips, experience or reviews — a script can earn a wage, never trust or skill.
// - Everything an order or a shift's end changes (experience, standing, the review and the venue's rating, the session,
//   the payment and any debt) commits in one database transaction.
import crypto from 'node:crypto';
import { LedgerError, vc } from './ledger.js';
import { subj } from './economy.js';
import { incomeTax } from './policy.js';
import { FOOD_BY_ID } from '../../shared/food.js';
import { ROLES, ROLES_AT, moduleOf, makeOrder, publicOrder, scoreOrder, minMsOf, starPay, orderXp, levelOf } from '../../shared/work.js';
import { isOpen } from '../sim/agents.js';
import { ctxOf, DEFAULT_DAY_SCALE } from '../../shared/constants.js';
import { hashStr } from '../../shared/rng.js';

const IDLE_MS = 3 * 60000, AUTO_MAX_MS = 2 * 3600e3, PER_ORDER_ACTIVE_MAX = 45000, ORDERS_PER_MIN = 8;
const TICKET_MS = 20 * 60000, TICKETS_PER_VENUE = 40;
const rid = () => `work_${crypto.randomBytes(9).toString('base64url')}`;
const tid = () => `tkt_${crypto.randomBytes(9).toString('base64url')}`;
const REVIEWS = {
  5: ['Perfect — exactly what I asked for.', 'Lovely service, will be back!', 'Quick and spot on. Best in the city.', 'Made my day.'],
  4: ['Very good, a little wait.', 'Nice and friendly.', 'Good, would come again.'],
  3: ['It was fine.', 'OK, nothing special.', 'Decent, but slow.'],
  2: ['Not what I ordered.', 'Took far too long.', 'Could be better.'],
  1: ['Got it all wrong.', 'Disappointing visit.', 'Not coming back soon.'],
};

export class Jobs {
  /** @param {import('./economy.js').Economy} econ  @param {object} d { isThere(actor, biz) → bool, notify } */
  constructor(econ, d = {}) {
    this.e = econ; this.d = d; this.db = econ.db; this.w = econ.w;
    this.brake = new Map();
    this.tickets = new Map();        // business id → [ticket]: its customers waiting (memory: they leave after TICKET_MS)
    const db = this.db;
    this.q = {
      add: db.prepare(`INSERT INTO econ_work (id, world_id, biz, role, worker_kind, worker_id, mode, status, seed, day, started, last_act, state_json)
        VALUES ($id, $w, $biz, $role, $wk, $wid, $mode, 'active', $seed, $day, $at, $at, $state)`),
      get: db.prepare('SELECT * FROM econ_work WHERE world_id = ? AND id = ?'),
      activeOf: db.prepare("SELECT * FROM econ_work WHERE world_id = ? AND worker_kind = ? AND worker_id = ? AND status = 'active'"),
      activeAt: db.prepare("SELECT * FROM econ_work WHERE world_id = ? AND biz = ? AND status = 'active'"),
      active: db.prepare("SELECT * FROM econ_work WHERE world_id = ? AND status = 'active'"),
      update: db.prepare('UPDATE econ_work SET last_act = $last, active_ms = $active, units = $units, stars_sum = $stars, tips = $tips, xp = $xp, state_json = $state WHERE world_id = $w AND id = $id AND status = \'active\''),
      finish: db.prepare("UPDATE econ_work SET status = 'ended', ended = $at, pay = $pay, owed = $owed, hours_milli = $hours, tx = $tx, state_json = $state WHERE world_id = $w AND id = $id AND status = 'active'"),
      history: db.prepare("SELECT * FROM econ_work WHERE world_id = ? AND worker_kind = ? AND worker_id = ? AND status = 'ended' ORDER BY started DESC LIMIT 20"),
      covered: db.prepare("SELECT biz, SUM(hours_milli) AS h FROM econ_work WHERE world_id = ? AND day = ? AND status = 'ended' GROUP BY biz"),
      played: db.prepare("SELECT COALESCE(SUM(units), 0) AS n FROM econ_work WHERE world_id = ? AND worker_kind = ? AND worker_id = ? AND biz = ? AND role = ? AND mode = 'play' AND status = 'ended'"),
      autoToday: db.prepare("SELECT COALESCE(SUM(json_extract(state_json, '$.gross')), 0) AS s FROM econ_work WHERE world_id = ? AND worker_kind = ? AND worker_id = ? AND mode = 'auto' AND status = 'ended' AND day = ?"),
      xpGet: db.prepare('SELECT * FROM econ_xp WHERE world_id = ? AND subject = ? AND role = ?'),
      xpAll: db.prepare('SELECT * FROM econ_xp WHERE world_id = ? AND subject = ?'),
      xpPut: db.prepare(`INSERT INTO econ_xp (world_id, subject, role, xp, units, day, day_units, updated) VALUES ($w, $s, $role, $xp, $units, $day, $du, $at)
        ON CONFLICT (world_id, subject, role) DO UPDATE SET xp = $xp, units = $units, day = $day, day_units = $du, updated = $at`),
      review: db.prepare('INSERT OR IGNORE INTO econ_reviews (world_id, biz, worker, author, author_name, stars, text, ref, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
      reviews: db.prepare('SELECT * FROM econ_reviews WHERE world_id = ? AND biz = ? ORDER BY id DESC LIMIT ?'),
      lastStars: db.prepare('SELECT stars FROM econ_reviews WHERE world_id = ? AND biz = ? ORDER BY id DESC LIMIT 60'),
      addDebt: db.prepare(`INSERT INTO econ_debts (id, world_id, debtor, creditor, kind, amount, original, ref, status, created, updated)
        VALUES ($id, $w, $debtor, $creditor, 'wages', $amount, $amount, $ref, 'open', $at, $at)`),
    };
  }

  // ------------------------------------------------------------------------------------------- roles at a venue
  /** The roles worked at a kind of venue, in ticket order: the policy's jobs.roles, else the modules' own venues. */
  rolesAt(kind) {
    const own = this.e.policy().jobs?.roles?.[kind];
    const list = Array.isArray(own) ? own.filter(r => moduleOf(r)) : ROLES_AT[kind] || [];
    return [...list].sort((a, b) => (moduleOf(a)?.stage ?? 50) - (moduleOf(b)?.stage ?? 50));
  }
  slotsOf(biz) {
    const sim = this.e.d.sim(), W = this.e.d.world(), B = W.buildings[biz.b];
    const n = B && sim?.index ? sim.index.findUsesCached(B.lv[biz.f], 'staff').length : 1;
    const roles = this.rolesAt(biz.kind);
    if (roles.length === 2) return { [roles[0]]: Math.max(1, Math.ceil(n / 2)), [roles[1]]: Math.max(1, Math.floor(n / 2)) };
    return Object.fromEntries(roles.map(r => [r, Math.max(1, n)]));
  }

  // ------------------------------------------------------------------------------------------- tickets: real customers
  /**
   * A customer bought at a venue (a resident's visit, a player's or an agent's purchase): a ticket waits there for the
   * venue's roles. customer: { kind: 'resident'|'account'|'agent', id, name }; ref: the purchase (its transaction, or
   * the resident's visit).
   */
  ticket(biz, customer, items, ref) {
    const roles = this.rolesAt(biz?.kind);
    if (!roles.length || !customer) return null;
    let list = this.tickets.get(biz.id);
    if (!list) this.tickets.set(biz.id, list = []);
    const now = Date.now();
    while (list.length && (now - list[0].at > TICKET_MS || list.length >= TICKETS_PER_VENUE)) list.shift();
    const t = { id: tid(), customer: { kind: customer.kind, id: String(customer.id), name: String(customer.name || 'A customer').split(' ')[0].slice(0, 30) }, items: (items || []).slice(0, 6), ref: String(ref || '').slice(0, 120), at: now, roles, stage: 0, by: null };
    list.push(t);
    return t;
  }
  /** Customers waiting at a venue now (for the shift board: how busy it is). */
  waiting(bizId) {
    const now = Date.now();
    return (this.tickets.get(bizId) || []).filter(t => now - t.at <= TICKET_MS && t.stage < t.roles.length).length;
  }
  /**
   * The oldest ticket waiting for role at venue b, held for session; stages no player or agent works right now are done
   * by the venue's own staff first. Returns the ticket or null.
   */
  _take(b, role, session) {
    const list = this.tickets.get(b.id);
    if (!list?.length) return null;
    const now = Date.now(), worked = new Set(this.q.activeAt.all(this.w, b.id).map(s => s.role));
    for (let k = list.length - 1; k >= 0; k--) {
      const t = list[k];
      if (now - t.at > TICKET_MS) { list.splice(k, 1); continue; }
      if (t.by) continue;
      while (t.stage < t.roles.length && !worked.has(t.roles[t.stage])) t.stage++;
      if (t.stage >= t.roles.length) list.splice(k, 1);
    }
    const t = list.find(x => !x.by && x.roles[x.stage] === role) || null;
    if (t) t.by = session;
    return t;
  }
  /** The worker finished their stage of a ticket: it moves on (or is served). Returns whether it was the last stage. */
  _done(b, ticketId) {
    const list = this.tickets.get(b.id), t = list?.find(x => x.id === ticketId);
    if (!t) return false;
    t.by = null; t.stage++;
    if (t.stage >= t.roles.length) { list.splice(list.indexOf(t), 1); return true; }
    return false;
  }
  _release(bizId, session) { for (const t of this.tickets.get(bizId) || []) if (t.by === session) t.by = null; }

  // ------------------------------------------------------------------------------------------- the shift board
  /** Who works where right now: per venue, its roles with their places, who has taken them and the residents on shift. */
  board() {
    if (this._board && Date.now() - this._board.at < 2000) return this._board.v;
    const v = this._boardNow();
    this._board = { at: Date.now(), v };
    return v;
  }
  _boardNow() {
    const bz = this.e.parts.businesses, people = this.e.d.people() || [], h = this.e.hourOf(), pol = this.e.policy();
    const taken = new Map();
    for (const s of this.q.active.all(this.w)) { const k = `${s.biz}|${s.role}`; if (!taken.has(k)) taken.set(k, []); taken.get(k).push({ kind: s.worker_kind, name: this.e.nameOf(subj(s.worker_kind, s.worker_id)), mode: s.mode }); }
    const staff = new Map();
    for (const p of people) { if (!p || p.retired || p.job?.kind !== 'staff') continue; const k = `${p.job.b}:${p.job.f}`; if (!staff.has(k)) staff.set(k, []); staff.get(k).push(p.name.split(' ')[0]); }
    return bz.open().filter(b => this.rolesAt(b.kind).length).map(b => {
      const slots = this.slotsOf(b), open = isOpen(b.kind, h);
      return { business: { id: b.id, name: b.name, kind: b.kind, b: b.b, f: b.f, rating: b.rating, owner: bz.ownerView(b) }, open, waiting: open ? this.waiting(b.id) : 0,
        staffing: b.settings?.staffing || { players: true, agents: true }, minTrust: b.settings?.minTrust || 0,
        roles: Object.entries(slots).map(([role, n]) => { const t = taken.get(`${b.id}|${role}`) || []; return { role, ...ROLES[role], slots: n, taken: t, free: Math.max(0, n - t.length), wage: bz.wageOf(b, ROLES[role].wage) }; }),
        residents: (staff.get(`${b.b}:${b.f}`) || []).slice(0, 6) };
    }).sort((a, b) => Number(b.open) - Number(a.open) || b.waiting - a.waiting || a.business.name.localeCompare(b.business.name)).map(x => ({ ...x, wageNote: `${vc(x.roles[0]?.wage || pol.minWage)} a world hour` }));
  }

  // ------------------------------------------------------------------------------------------- a session
  /** Starts working. actor: { kind: 'account'|'agent', id }. mode 'play' (the games) or 'auto' (agents only). */
  start(actor, { business, role, mode = 'play' }) {
    this.e.live();
    const bz = this.e.parts.businesses, b = bz.get(String(business || '')), pol = this.e.policy();
    const roles = b ? this.rolesAt(b.kind) : [];
    if (!b || b.status !== 'open' || !roles.length) throw new LedgerError('not_found', 'That place has no shifts to work.', 404);
    if (!roles.includes(role)) throw new LedgerError('input', `${b.name} doesn't need a ${ROLES[role]?.label.toLowerCase() || 'that'}.`, 400);
    if (mode !== 'play' && !(mode === 'auto' && actor.kind === 'agent')) throw new LedgerError('input', 'Work by playing (agents may also work automatically).', 400);
    if (!isOpen(b.kind, this.e.hourOf())) throw new LedgerError('closed', `${b.name} is closed now.`, 409);
    const staffing = b.settings?.staffing || { players: true, agents: true };
    if (actor.kind === 'account' && staffing.players === false) throw new LedgerError('rights', `${b.name} doesn't take players' shifts.`, 403);
    if (actor.kind === 'agent' && staffing.agents === false) throw new LedgerError('rights', `${b.name} doesn't take agents' shifts.`, 403);
    if (actor.kind === 'account' && this.d.isThere && !this.d.isThere(actor, b)) throw new LedgerError('not_here', `Go to ${b.name} to work there.`, 409, { b: b.b, f: b.f });
    const me = subj(actor.kind, actor.id);
    // an owner may ask for a work record: the stars customers gave (never money, never payments: work standing only)
    const tr = this.e.parts.trust?.of(me), workStars = tr ? Math.round(tr.dims.work / 200 * 10) / 10 : null;
    if (b.settings?.minTrust && tr && tr.events >= 5 && workStars < b.settings.minTrust) throw new LedgerError('trust', `${b.name} asks for a work rating of at least ${b.settings.minTrust} ★.`, 403);
    if (mode === 'auto' && pol.jobs.autoNeedsPlayed > 0 && this.q.played.get(this.w, me.kind, me.id, b.id, role).n < pol.jobs.autoNeedsPlayed) {
      throw new LedgerError('state', `Work ${pol.jobs.autoNeedsPlayed} ${ROLES[role].units} at ${b.name} by playing before working there automatically.`, 409);
    }
    if (this.q.activeOf.get(this.w, me.kind, me.id)) throw new LedgerError('state', 'You are already working a shift; end it first.', 409);
    const slots = this.slotsOf(b)[role], busy = this.q.activeAt.all(this.w, b.id).filter(s => s.role === role).length;
    if (busy >= slots) throw new LedgerError('full', `Every ${ROLES[role].label.toLowerCase()} place at ${b.name} is taken.`, 409);
    this.e.walletFor(me);   // the wallet exists before money arrives in it
    const id = rid(), seed = crypto.randomBytes(8).toString('hex'), at = this.e.now();
    const state = { n: 0, issuedAt: at, order: null, last: [], version: moduleOf(role).version, tipsFrom: {} };
    if (mode === 'play') { const o = this._order(b, role, seed, 0, id); state.order = o.order; state.ticket = o.ticket; }
    this.q.add.run({ id, w: this.w, biz: b.id, role, wk: me.kind, wid: me.id, mode, seed, day: this.e.econDay(), at, state: JSON.stringify(state) });
    this._board = null;
    this.e.d.audit?.log('economy.work_start', { actor: actor.kind === 'account' ? { id: actor.id } : null, detail: { session: id, business: b.id, role, mode, agent: actor.kind === 'agent' ? actor.id : undefined } });
    return this.view(this.q.get.get(this.w, id));
  }
  /**
   * The next order: the oldest ticket waiting at this role (a real customer), else a walk-in — a resident at the venue,
   * or a passer-by. Returns { order, ticket: { id, customer } | null }.
   */
  _order(b, role, seed, n, session) {
    const t = b.id ? this._take(b, role, session) : null;
    const menu = b.id ? this.e.parts.businesses.menu(b) : [];
    // the barista makes the order's drink, the kitchen and the floor its food (shared/food.js)
    const wantDrink = role === 'barista', fits = id => { const it = FOOD_BY_ID[id]; return !it || (it.course === 'drink') === wantDrink; };
    let who = t?.customer.name || null, item = t?.items?.find(fits) || t?.items?.[0] || null;
    if (!t) {
      const sim = this.e.d.sim(), people = this.e.d.people() || [], here = [...(sim?.brain?.at.get(ctxOf(b.b, b.f)) || [])].filter(i => people[i] && people[i].job?.kind !== 'staff');
      who = here.length ? people[here[hashStr(`${seed}:${n}`) % here.length]].name.split(' ')[0] : null;
      const pick = menu.filter(m => fits(m.id)).length ? menu.filter(m => fits(m.id)) : menu;
      item = pick.length ? pick[hashStr(`${seed}:item:${n}`) % pick.length].id : null;
    }
    const order = makeOrder(role, seed, n, { item: role === 'barista' && !t ? null : item, customer: who });
    return { order, ticket: t ? { id: t.id, customer: t.customer, ref: t.ref } : null };
  }
  mine(actor) {
    const s = this.q.activeOf.get(this.w, actor.kind, String(actor.id));
    if (!s) throw new LedgerError('not_found', 'You are not working a shift.', 404);
    return s;
  }
  /**
   * The worker finished an order: reports (one per step) are scored here, the time it took is the server's own clock,
   * an order faster than a person could do it is refused. Returns its result and the next order.
   */
  act(actor, { session, n, reports }) {
    const now = this.e.now();
    const out = this.e.dbs.tx(() => {
      const s = this.q.get.get(this.w, String(session || ''));
      if (!s || s.status !== 'active' || s.worker_kind !== actor.kind || s.worker_id !== String(actor.id)) throw new LedgerError('not_found', 'That shift isn\'t yours or has ended.', 404);
      if (s.mode !== 'play') throw new LedgerError('input', 'An automatic shift has no orders.', 400);
      let st; try { st = JSON.parse(s.state_json); } catch { st = null; }
      if (!st?.order || Number(n) !== st.n) throw new LedgerError('state', 'That order was already served.', 409, { n: st?.n });
      if (!Array.isArray(reports) || reports.length !== st.order.steps.length) throw new LedgerError('input', 'Report each step of the order.', 400);
      const took = now - st.issuedAt;
      if (took < minMsOf(st.order)) throw new LedgerError('too_fast', 'Slow down: that was faster than anyone can work.', 429);
      const bk = (this.brake.get(s.id) || []).filter(t => now - t <= 60000);
      if (bk.length >= ORDERS_PER_MIN) throw new LedgerError('too_fast', 'Slow down a little.', 429);
      const pol = this.e.policy(), res = scoreOrder(st.order, reports, took, { tipMax: pol.jobs?.tipMax ?? 100 });
      const me = subj(s.worker_kind, s.worker_id), b = this.e.parts.businesses.get(s.biz);
      const xp = this._xp(me, s.role, res.stars);
      this.e.parts.trust?.note(me, 'work', { 5: 3, 4: 2, 3: 0, 2: -4, 1: -8 }[res.stars], `${res.stars}★ order`, `${s.id}:${st.n}`);
      // a ticket's customer tips and, when the ticket is served, sometimes reviews the venue; a walk-in does neither
      let review = null, tip = 0, served = false;
      const T = st.ticket;
      if (T && b) {
        served = this._done(b, T.id);
        if (res.tip > 0 && T.customer.kind === 'resident') { tip = res.tip; const k = `resident:${T.customer.id}`; st.tipsFrom = st.tipsFrom || {}; st.tipsFrom[k] = (st.tipsFrom[k] || 0) + tip; }
        if (served && hashStr(`${s.seed}:review:${st.n}`) % 100 < 22) {
          const list = REVIEWS[res.stars], text = list[hashStr(`${s.seed}:t:${st.n}`) % list.length];
          const r = this.q.review.run(this.w, b.id, `${me.kind}:${me.id}`, `${T.customer.kind}:${T.customer.id}`, T.customer.name, res.stars, text, `ticket:${T.id}`, now);
          if (r.changes) { this._rate(b.id); review = { stars: res.stars, text, by: T.customer.name }; }
        }
      }
      const nx = this._order(b || { b: -1, f: -1, kind: 'cafe' }, s.role, s.seed, st.n + 1, s.id);
      const next = { ...st, n: st.n + 1, issuedAt: now, order: nx.order, ticket: nx.ticket, last: [{ n: st.n, ...res, tip }, ...(st.last || [])].slice(0, 5) };
      const u = this.q.update.run({ last: now, active: s.active_ms + Math.min(took, PER_ORDER_ACTIVE_MAX), units: s.units + 1, stars: s.stars_sum + res.stars, tips: s.tips + tip, xp: s.xp + xp, state: JSON.stringify(next), w: this.w, id: s.id });
      if (u.changes !== 1) throw new LedgerError('state', 'That shift has just ended.', 409);
      bk.push(now); this.brake.set(s.id, bk);
      return { result: { ...res, tip, title: st.order.title, customer: st.order.customer, ticket: !!T, served, xp, review }, id: s.id };
    });
    return { result: out.result, session: this.view(this.q.get.get(this.w, out.id)) };
  }
  _xp(me, role, stars) {
    const s = `${me.kind}:${me.id}`, day = this.e.econDay(), cur = this.q.xpGet.get(this.w, s, role) || { xp: 0, units: 0, day, day_units: 0 };
    const du = cur.day === day ? cur.day_units : 0, add = orderXp(stars, du);
    this.q.xpPut.run({ w: this.w, s, role, xp: Math.round(cur.xp + add), units: cur.units + 1, day, du: du + 1, at: this.e.now() });
    return add;
  }
  /** A venue's rating: its last 60 reviews, pulled towards 3.5★ while it has few. */
  _rate(bizId) {
    const stars = this.q.lastStars.all(this.w, bizId).map(r => r.stars), n = stars.length;
    const rating = Math.round((350 * 5 + stars.reduce((a, b) => a + b * 100, 0)) / (5 + n));
    this.e.parts.businesses.setRating(bizId, rating, n);
  }
  /** Ends a session and pays it (the worker, or the sweep for an idle one), all in one transaction. Returns its summary. */
  end(actor, { session }, { why = 'ended' } = {}) {
    const now = this.e.now(), pol = this.e.policy(), bz = this.e.parts.businesses;
    const r = this.e.dbs.tx(() => {
      const s = this.q.get.get(this.w, String(session || ''));
      if (!s || s.status !== 'active') throw new LedgerError('not_found', 'That shift has already ended.', 404);
      if (actor && !(s.worker_kind === actor.kind && s.worker_id === String(actor.id))) throw new LedgerError('rights', 'That shift isn\'t yours.', 403);
      const b = bz.get(s.biz), me = subj(s.worker_kind, s.worker_id), role = ROLES[s.role] || { label: s.role, unit: 'order', units: 'orders', wage: s.role };
      const wage = b ? bz.wageOf(b, role.wage) : pol.minWage, auto = s.mode === 'auto';
      let st = {}; try { st = JSON.parse(s.state_json); } catch { st = {}; }
      // the time worked: real time at the world's usual pace (a faster clock never pays more); auto shifts at most two hours
      const ms = auto ? Math.min(now - s.started, AUTO_MAX_MS) : s.active_ms;
      const hours = ms / 3600e3 * DEFAULT_DAY_SCALE;
      const avg = s.units ? s.stars_sum / s.units : 3;
      let gross = Math.floor(hours * wage * (auto ? pol.jobs.autoPayPct / 100 : starPay(avg)));
      if (auto) gross = Math.max(0, Math.min(gross, pol.jobs.autoDailyCap - this.q.autoToday.get(this.w, me.kind, me.id, s.day).s));
      // tips: from the ticket customers who left them, as far as their wallets go; at most a share of the wages
      const tipCap = Math.floor(gross * pol.jobs.tipsOfWagesPct / 100), tipsFrom = [];
      let tipsWant = 0;
      if (!auto && b) for (const [k, amt] of Object.entries(st.tipsFrom || {})) {
        if (tipsWant >= tipCap) break;
        const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)], p = kind === 'resident' ? this.e.residentById(id) : null;
        const w = p ? this.e.walletFor(this.e.personSubject(p)) : null;
        if (!w) continue;
        const can = Math.max(0, p ? this.e.parts.households.available(p) : this.e.ledger.available(w.id)), take = Math.min(amt, can, tipCap - tipsWant);
        if (take > 0) { tipsFrom.push({ wallet: w.id, amount: take }); tipsWant += take; }
      }
      let pay = 0, owed = 0, tx = null;
      if (b && gross > 0 && (!this.e.enabled() || this.e.paused())) {
        // the economy is off or paused: the wages are owed, paid by the venue when money moves again (./households.js)
        owed = gross;
        const bw = this.e.ledger.walletOf('business', b.id, 'business'), ww = this.e.ledger.walletOf(me.kind, me.id, 'main');
        if (bw && ww) this.q.addDebt.run({ id: `debt_${crypto.randomBytes(8).toString('hex')}`, w: this.w, debtor: bw.id, creditor: ww.id, amount: owed, ref: `work:${s.id}`, at: now });
      } else if (b && gross + tipsWant > 0) {
        const bw = bz.wallet(b), ww = this.e.walletFor(me), T = this.e.treasury();
        const can = Math.max(0, this.e.ledger.available(bw.id)), paid = Math.min(gross, can);
        owed = gross - paid;
        if (paid + tipsWant > 0) {
          const tax = Math.min(paid, incomeTax(pol, paid));
          const postings = [{ wallet: ww.id, amount: paid - tax + tipsWant, note: `wages ${vc(paid)}${tipsWant ? ` · tips ${vc(tipsWant)}` : ''}${tax ? ` · tax −${vc(tax)}` : ''}` }];
          if (paid) postings.push({ wallet: bw.id, amount: -paid });
          for (const x of tipsFrom) postings.push({ wallet: x.wallet, amount: -x.amount, note: 'a tip' });
          if (tax) postings.push({ wallet: T.id, amount: tax });
          const t = this.e.ledger.post({ kind: 'wage', actor: 'system:jobs', memo: `${role.label} at ${b.name}: ${s.units} ${s.units === 1 ? role.unit : role.units}${auto ? ' (automatic)' : ''}`, ref: s.id, idem: `work:${s.id}`, day: this.e.econDay(), postings });
          pay = paid - tax + tipsWant; tx = t.seq;
        }
        if (owed > 0) this.q.addDebt.run({ id: `debt_${crypto.randomBytes(8).toString('hex')}`, w: this.w, debtor: bw.id, creditor: ww.id, amount: owed, ref: `work:${s.id}`, at: now });
      }
      if (st.ticket && b) this._release(b.id, s.id);
      st.order = null; st.ticket = null; st.why = why; st.gross = gross;
      const f = this.q.finish.run({ at: now, pay, owed, hours: Math.round(hours * 1000), tx, state: JSON.stringify(st), w: this.w, id: s.id });
      if (f.changes !== 1) throw new LedgerError('not_found', 'That shift has already ended.', 404);
      return { s, b, pay, owed, hours, gross, tips: tipsWant, avg };
    });
    const { s, b } = r;
    this._board = null;
    this.brake.delete(s.id);
    const acc = s.worker_kind === 'account' ? Number(s.worker_id) : this.e.agentOwner(s.worker_id);
    if (acc != null && why !== 'ended') this.d.notify?.(acc, { t: 'econ', ev: 'shift', why, pay: r.pay, business: b?.name || '' });
    return { session: this.view(this.q.get.get(this.w, s.id)), pay: r.pay, owed: r.owed, hours: Math.round(r.hours * 100) / 100, gross: r.gross, tips: r.tips, tipsEarned: s.tips, avgStars: Math.round(r.avg * 10) / 10 };
  }
  /** Ends idle sessions (no order for three minutes) and automatic ones past two hours; each is paid for its time. */
  sweep() {
    const now = this.e.now();
    for (const s of this.q.active.all(this.w)) {
      const idle = s.mode === 'play' ? now - s.last_act > IDLE_MS : now - s.started > AUTO_MAX_MS;
      if (idle) { try { this.end(null, { session: s.id }, { why: s.mode === 'play' ? 'idle' : 'time' }); } catch (e) { this.e.log.warn('[jobs] ending a shift failed:', e.message); } }
    }
  }
  /** The hours players and agents covered at each business on a day (the residents they covered aren't paid for them). */
  covered(day) { return new Map(this.q.covered.all(this.w, day).map(r => [r.biz, r.h / 1000])); }

  // ------------------------------------------------------------------------------------------- views
  view(s) {
    if (!s) return null;
    let st = {}; try { st = JSON.parse(s.state_json); } catch { st = {}; }
    const b = this.e.parts.businesses.get(s.biz), role = ROLES[s.role];
    return { id: s.id, business: b ? { id: b.id, name: b.name, kind: b.kind, b: b.b, f: b.f } : null, role: s.role, roleLabel: role?.label, game: role?.game, ui: role?.ui || 'steps', unit: role?.unit, units: role?.units,
      mode: s.mode, status: s.status, started: s.started, activeMs: s.active_ms, served: s.units, avgStars: s.units ? Math.round(s.stars_sum / s.units * 10) / 10 : null, tips: s.tips, xp: s.xp,
      pay: s.pay, owed: s.owed, order: st.order ? publicOrder(st.order) : null, ticket: st.ticket ? { customer: st.ticket.customer.name } : null, waiting: b ? this.waiting(b.id) : 0, n: st.n ?? 0, last: st.last || [] };
  }
  /** A worker's jobs page: the session they're in, the ones before, their experience per role and their standing. */
  of(actor) {
    const me = subj(actor.kind, actor.id), key = `${me.kind}:${me.id}`;
    return {
      active: this.view(this.q.activeOf.get(this.w, me.kind, me.id)),
      history: this.q.history.all(this.w, me.kind, me.id).map(s => this.view(s)),
      xp: this.q.xpAll.all(this.w, key).map(x => ({ role: x.role, label: ROLES[x.role]?.label, icon: ROLES[x.role]?.icon, xp: x.xp, level: levelOf(x.xp), units: x.units })),
      trust: this.e.parts.trust?.of(me) || null,
    };
  }
  reviews(bizId, n = 30) { return this.q.reviews.all(this.w, String(bizId), n).map(r => ({ stars: r.stars, text: r.text, by: r.author_name, at: r.at, worker: r.worker ? this.e.nameOf(subj(...r.worker.split(':'))) : null })); }
  /**
   * After a day (inside the settlement's transaction): a few of the residents who really bought at a venue that day
   * review it — kinder when its prices are fair and it was staffed — so ratings follow how a place is run even when
   * nobody plays there. Each review names a real customer and counts once (its reference).
   */
  afterDay(day, plan) {
    const bz = this.e.parts.businesses, now = this.e.now(), people = this.e.d.people() || [];
    for (const [bid, r] of plan.books) {
      const b = bz.get(bid), who = plan.customersOf?.get(bid) || [];
      if (!b || b.f === -1 || r.customers < 3 || !who.length) continue;
      const price = bz.priceLevel(b), staffed = r.wages > 0 ? 1 : 0;
      const n = Math.min(who.length, 1 + (hashStr(`${bid}:${day}:n`) % 2));
      let wrote = 0;
      for (let k = 0; k < n; k++) {
        const pid = who[hashStr(`${bid}:${day}:${k}:w`) % who.length], p = this.e.residentById(pid);
        if (!p) continue;
        const roll = (hashStr(`${bid}:${day}:${k}`) % 1000) / 1000;
        const stars = Math.max(1, Math.min(5, Math.round(3.2 + staffed * 0.6 - (price - 1) * 2.2 + (roll - 0.5) * 1.6)));
        const list = REVIEWS[stars], name = p.name.split(' ')[0];
        wrote += this.q.review.run(this.w, bid, null, `resident:${pid}`, name, stars, list[hashStr(`${bid}:${day}:${k}:t`) % list.length], `day:${day}:${bid}:${pid}`, now).changes;
      }
      if (wrote) this._rate(bid);
    }
  }
}
