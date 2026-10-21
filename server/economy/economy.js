// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The economy (docs/features/ECONOMY.md): Virtual Coin wallets for every player, agent, resident, business and the
// city, on the ledger (./ledger.js). This module holds the switches, the sealed ledger key, the policy, wallets by
// subject (created and endowed once), payments between players and agents, payment requests, administrators' grants,
// corrections and freezing, statements, and the clock that drives the living economy (./households.js, ./city.js,
// ./market.js, ./businesses.js).
//
// A subject is { kind, id }: account (a player), agent (an AI agent's record), resident (a character who is not an
// agent), business, city ('city'). Who may move money out of a wallet:
// - a player: their own wallet, the wallets of businesses they own, the wallets of agents they own (funding and
//   taking back);
// - an agent (the Agent API): its own wallet and its businesses', within the scopes, daily cap and approval threshold
//   its owner set (./agents.js);
// - an administrator: grants, corrections (reversals) and freezing, each with a reason in the ledger and the audit log;
// - the economy itself (wages, rent, taxes, sales …).
import crypto from 'node:crypto';
import { Ledger, LedgerError, SCALE, vc } from './ledger.js';
import { POLICY_DEFAULTS, checkPolicy, loadPolicy, policyDiff } from './policy.js';
import { SECRET_PREFIX, aadInstall } from '../secret-holders.js';
import { worldSeconds } from '../../shared/constants.js';

export { LedgerError, SCALE, vc };
export const LEDGER_KEY = 'economy.ledgerKey';
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const rid = p => `${p}_${crypto.randomBytes(9).toString('base64url')}`;
export const subj = (kind, id) => ({ kind, id: String(id) });
export const subjKey = s => `${s.kind}:${s.id}`;
/** The system wallets: where money is made (faucets) and destroyed (sinks). */
export const FAUCETS = Object.freeze({ endowment: 'Starting money', exports: 'Sales abroad', grants: 'Administrators\' grants', resale: 'Sold back to the market', loans: 'The bank', prizes: 'Game prizes', fishMarket: 'Fish market' });
export const SINKS = Object.freeze({ imports: 'Bought on the market', upkeep: 'Upkeep and services', works: 'Public works', fees: 'Fees', interest: 'Interest', ordinances: 'Ordinances', corrections: 'Administrators\' corrections', tackle: 'Tackle and boat upgrades' });

export class Economy {
  /**
   * @param {object} d
   * @param {object} d.dbs  openDb()  @param {object} d.box  the SecretBox  @param {object} d.perms  @param {object} [d.audit] [d.log]
   * @param {function} d.world  () => world   @param {function} d.people () => people   @param {function} d.sim () => sim
   * @param {object} [d.property]  lots and their holders   @param {object} [d.agents] the agent registry
   * @param {function} [d.notify]  (accountId, message) => void   @param {function} [d.broadcast] (message) => void
   */
  constructor(d) {
    this.d = d; this.dbs = d.dbs; this.db = d.dbs.db; this.w = d.dbs.worldId;
    this.now = d.now || (() => Date.now());
    this.log = d.log || Object.assign(() => {}, { warn: () => {}, error: () => {} });
    this.ledger = new Ledger(this.dbs, { key: () => this.ledgerKey(), now: this.now });
    this.ledger.paused = () => this.paused();
    this._key = null; this._policyRaw = null; this._policy = null;
    this.version = 1;                   // browsers refetch economy views when this changes
    this.buckets = new Map();           // per-account rate limits
    this.walletOwners = new Map();      // wallet id → account id to tell when it changes (null: nobody)
    this.parts = {};                    // businesses, households, city, market, agents, jobs (set by the server)
    const db = this.db;
    this.q = {
      setting: db.prepare('SELECT value FROM settings WHERE world_id = ? AND key = ?'),
      putSetting: db.prepare('INSERT INTO settings (world_id, key, value) VALUES (?, ?, ?) ON CONFLICT (world_id, key) DO UPDATE SET value = excluded.value'),
      account: db.prepare('SELECT id, login, display_name AS name, status FROM accounts WHERE world_id = ? AND id = ?'),
      byLogin: db.prepare('SELECT id, login, display_name AS name, status FROM accounts WHERE world_id = ? AND login = ?'),
      created: db.prepare('SELECT created FROM accounts WHERE world_id = ? AND id = ?'),
      role: db.prepare('SELECT role FROM accounts WHERE world_id = ? AND id = ?'),
      endowedAgents: db.prepare("SELECT COUNT(*) AS n FROM econ_tx WHERE world_id = ? AND idem >= ? AND idem < ?"),
      // what a wallet paid other players, agents and their businesses lately (a new account's daily limit)
      sentToday: db.prepare(`SELECT COALESCE(-SUM(p.amount), 0) AS s FROM econ_postings p JOIN econ_tx t ON t.seq = p.tx
        WHERE p.world_id = ? AND p.wallet = ? AND p.amount < 0 AND t.kind IN ('transfer', 'purchase', 'property') AND t.ref IS NOT 'city' AND t.at > ?`),
      accounts: db.prepare("SELECT id FROM accounts WHERE world_id = ? AND status = 'active'"),
      biz: db.prepare('SELECT * FROM econ_businesses WHERE world_id = ? AND id = ?'),
      request: db.prepare('SELECT * FROM econ_requests WHERE world_id = ? AND id = ?'),
      addRequest: db.prepare(`INSERT INTO econ_requests (id, world_id, payee, payer, amount, memo, status, created, expires)
        VALUES ($id, $w, $payee, $payer, $amount, $memo, 'open', $at, $expires)`),
      setRequest: db.prepare("UPDATE econ_requests SET status = $status, tx = $tx, decided = $at WHERE world_id = $w AND id = $id AND status = 'open'"),
      requestsTo: db.prepare("SELECT * FROM econ_requests WHERE world_id = ? AND payer = ? AND status = 'open' ORDER BY created DESC LIMIT 100"),
      requestsFrom: db.prepare('SELECT * FROM econ_requests WHERE world_id = ? AND payee = ? ORDER BY created DESC LIMIT 100'),
      openFrom: db.prepare("SELECT COUNT(*) AS n FROM econ_requests WHERE world_id = ? AND payee = ? AND status = 'open'"),
      staleRequests: db.prepare("SELECT id FROM econ_requests WHERE world_id = ? AND status = 'open' AND expires < ? LIMIT 500"),
    };
    this.ledger.listeners.add(ev => this._posted(ev));
  }

  // ------------------------------------------------------------------------------------------- switches
  setting(key, fallback = null) { return this.d.perms.setting(key, fallback); }
  enabled() { return this.setting('economy.enabled') === '1'; }
  /** Whether genesis finished (read from the database itself: genesis writes it inside its own transaction). */
  genesisDone() { return this.q.setting.get(this.w, 'economy.genesisDone')?.value === '1'; }
  paused() { return this.setting('economy.paused') === '1'; }
  /** Turns the economy on (the first time: genesis) or off, or pauses it. Owners only (the route checks). */
  setSwitch(name, on, actor) {
    if (!['enabled', 'paused'].includes(name)) throw new LedgerError('input', 'Unknown switch.', 400);
    this.d.perms.setSetting(`economy.${name}`, on ? '1' : '0');
    this.d.audit?.log(`economy.${name}`, { actor, detail: { on: !!on } });
    if (name === 'enabled' && on) this.genesis();
    this.bump();
    return this.status();
  }
  bump() { this.version++; this.d.broadcast?.({ t: 'economy', v: this.version, enabled: this.enabled(), paused: this.paused() }); }

  // ------------------------------------------------------------------------------------------- the ledger key
  /** The ledger's signing key: random, sealed with the installation key (server/secrets.js) in the settings. */
  ledgerKey() {
    if (this._key) return this._key;
    const key = SECRET_PREFIX + LEDGER_KEY, aad = aadInstall(this.w, LEDGER_KEY), box = this.d.box;
    if (!box) throw new Error('the economy needs the secret box');
    const row = this.q.setting.get(this.w, key);
    if (row) { this._key = Buffer.from(box.open(row.value, aad), 'base64'); return this._key; }
    const k = crypto.randomBytes(32);
    this.q.putSetting.run(this.w, key, box.seal(k.toString('base64'), aad));
    this.q.putSetting.run(this.w, 'economy.ledgerKeySince', String(this.ledger.count().last));
    this._key = k;
    return k;
  }
  /** Checks the signed chain from where the current key started. */
  verify() {
    this.ledgerKey();
    const since = Number(this.q.setting.get(this.w, 'economy.ledgerKeySince')?.value || 0);
    let prevMac = 'genesis';
    if (since > 0) prevMac = this.ledger.q.txBySeq.get(this.w, since)?.mac || 'genesis';
    return { ...this.ledger.verify({ after: since, prevMac }), since };
  }

  // ------------------------------------------------------------------------------------------- policy
  policy() {
    const raw = this.setting('economy.policy', '');
    if (raw !== this._policyRaw || !this._policy) { this._policy = loadPolicy(raw); this._policyRaw = raw; }
    return this._policy;
  }
  setPolicy(patch, actor) {
    const next = checkPolicy(this.policy(), patch);
    this.d.perms.setSetting('economy.policy', JSON.stringify(policyDiff(next)));
    this.d.audit?.log('economy.policy', { actor, detail: { changes: patch } });
    this.parts.businesses?.policyChanged?.();
    this.bump();
    return this.policy();
  }
  resetPolicy(actor) { this.d.perms.setSetting('economy.policy', '{}'); this.d.audit?.log('economy.policy', { actor, detail: { reset: true } }); this.bump(); return this.policy(); }

  // ------------------------------------------------------------------------------------------- the clock
  clock() { return this.d.sim()?.clock; }
  /** The economic day of sim time t: world days that start at the settlement hour. */
  econDay(t = this.d.sim()?.now()) {
    const c = this.clock();
    if (!c || !Number.isFinite(t)) return 0;
    return Math.floor((worldSeconds(c, t) - this.policy().settleHour * 3600) / 86400);
  }
  /** The world hour of sim time t (0 … 24). */
  hourOf(t = this.d.sim()?.now()) { const c = this.clock(); return c ? (((worldSeconds(c, t) / 3600) % 24) + 24) % 24 : 0; }

  // ------------------------------------------------------------------------------------------- subjects and wallets
  system(name) { return this.ledger.ensure('system', 'econ', name, { label: FAUCETS[name.slice(7)] || SINKS[name.slice(5)] || name }); }
  faucet(name) { return this.system(`faucet:${name}`); }
  sink(name) { return this.system(`sink:${name}`); }
  clearing() { return this.system('clearing'); }
  treasury() { return this.walletFor(subj('city', 'city'), 'treasury'); }
  /** The subject behind a resident (by index): its agent when it is an AI agent's body, else itself. */
  personSubject(p) {
    if (!p) return null;
    if (p.vip && p.agentId) { const a = this.d.agents?.byKey?.(p.agentId); if (a) return subj('agent', a.id); }
    return subj('resident', p.id);
  }
  /**
   * The subject's wallet for purpose (main, business, treasury), created and endowed once. Endowments come from the
   * endowment faucet and are idempotent per subject, so a crash or a repeat never pays twice.
   */
  walletFor(s, purpose = 'main', { endow = true } = {}) {
    let w = this.ledger.walletOf(s.kind, s.id, purpose);
    if (w && w.status !== 'closed') return w;
    w = this.ledger.ensure(s.kind, s.id, purpose, { label: this.nameOf(s) });
    if (endow && this.enabled()) this._endow(s, w);
    return this.ledger.wallet(w.id);
  }
  _endow(s, w) {
    const e = this.policy().endowment, genesisDone = this.genesisDone();
    // after genesis only the city funds the businesses it opens (from the treasury, below): a player's or an agent's new
    // business starts empty and its owner funds it (closing and reopening a business must never mint money)
    if (s.kind === 'business' && genesisDone && this.parts.businesses?.get(s.id)?.owner_kind !== 'municipality') return;
    // a member's own agents: starting money for the first few only (connecting agents must never mint money); an
    // administrator's agents always (administrators can grant money anyway, in the open)
    let idem = `endow:${subjKey(s)}`;
    if (s.kind === 'agent') {
      const owner = this.d.agents?.byId?.(Number(s.id))?.ownerId;
      if (owner != null && !['owner', 'admin'].includes(this.q.role.get(this.w, Number(owner))?.role)) {
        const pre = `endow:owner:${owner}:`, n = this.q.endowedAgents.get(this.w, pre, `${pre}~`).n;
        if (n >= e.memberAgents) return;
        idem = `${pre}${s.id}`;
      }
    }
    const amount = s.kind === 'account' ? e.account : s.kind === 'agent' ? e.agent : s.kind === 'resident' ? e.resident : s.kind === 'city' ? e.treasury
      : s.kind === 'business' ? (this.parts.businesses?.get(s.id)?.f === -1 ? e.company : e.business) : 0;
    if (!(amount > 0)) return;
    // a business the city opens later is funded from the treasury; everything at genesis and every new player, agent and
    // resident from the endowment faucet
    const biz = s.kind === 'business' ? this.parts.businesses?.get(s.id) : null;
    const fromTreasury = biz && biz.owner_kind === 'municipality' && genesisDone;
    const from = fromTreasury ? this.treasury() : this.faucet('endowment');
    if (fromTreasury && this.ledger.available(from.id) < amount) return;
    try {
      if (idem !== `endow:${subjKey(s)}` && this.ledger.q.txByIdem.get(this.w, `endow:${subjKey(s)}`)) return;   // endowed before this rule
      this.ledger.post({ kind: 'grant', actor: 'system:endowment', memo: `Starting money for ${this.nameOf(s)}`, ref: subjKey(s), idem, system: true,
        postings: [{ wallet: from.id, amount: -amount }, { wallet: w.id, amount }] });
    } catch (e) { if (!(e instanceof LedgerError)) throw e; this.log.warn('[economy] endowment refused:', e.message); }
  }
  /** A subject's display name. */
  nameOf(s) {
    if (!s) return 'Someone';
    switch (s.kind) {
      case 'account': return this.q.account.get(this.w, Number(s.id))?.name || 'A former player';
      case 'agent': return this.d.agents?.byId?.(Number(s.id))?.name || 'An agent';
      case 'resident': { const p = this.residentById(s.id); return p ? p.name : 'A resident'; }
      case 'business': return this.parts.businesses?.get(s.id)?.name || this.q.biz.get(this.w, s.id)?.name || 'A business';
      case 'city': case 'municipality': return `City of ${this.d.world()?.name || 'the world'}`;
      case 'system': return FAUCETS[String(s.id).replace(/^faucet:/, '')] || SINKS[String(s.id).replace(/^sink:/, '')] || 'The market';
      default: return 'Someone';
    }
  }
  residentById(id) {
    const people = this.d.people() || [];
    if (!this._pidx || this._pidxN !== people.length) { this._pidx = new Map(people.map((p, i) => [p.id, i])); this._pidxN = people.length; }
    const i = this._pidx.get(String(id));
    return i === undefined ? null : people[i];
  }
  /** The account that owns an agent (an agent without an owner belongs to the installation's owner). */
  agentOwner(id) {
    const a = this.d.agents?.byId?.(Number(id));
    if (!a) return null;
    return a.ownerId ?? this.d.ownerAccount?.() ?? null;
  }
  /** Who a wallet belongs to, as a subject (system wallets: { kind: 'system', id: purpose }). */
  ownerOf(w) {
    if (!w) return null;
    if (w.owner_kind === 'system') return subj('system', w.purpose);
    return subj(w.owner_kind, w.owner_id);
  }
  /** The account that should be told about a wallet's changes (its player, or the owner of its agent or business). */
  accountOfWallet(id) {
    if (this.walletOwners.has(id)) return this.walletOwners.get(id);
    const w = this.ledger.wallet(id);
    let acc = null;
    if (w?.owner_kind === 'account') acc = Number(w.owner_id);
    else if (w?.owner_kind === 'agent') acc = this.agentOwner(w.owner_id);
    else if (w?.owner_kind === 'business') { const b = this.parts.businesses?.get(w.owner_id); acc = b?.owner_kind === 'account' ? Number(b.owner_id) : b?.owner_kind === 'agent' ? this.agentOwner(b.owner_id) : null; }
    this.walletOwners.set(id, acc);
    return acc;
  }
  _posted(ev) {
    const told = new Map();
    for (const p of ev.postings) {
      const acc = this.accountOfWallet(p.wallet);
      if (acc == null) continue;
      if (!told.has(acc)) told.set(acc, []);
      told.get(acc).push({ wallet: p.wallet, amount: p.amount, balance: p.balance });
    }
    for (const [acc, list] of told) this.d.notify?.(acc, { t: 'wallet', kind: ev.kind, memo: ev.memo, changes: list });
    this.parts.stats?.noteTx?.(ev);
  }

  // ------------------------------------------------------------------------------------------- genesis
  /**
   * Creates everything the economy needs, idempotently: the system wallets, the treasury, the businesses (with their
   * starting money), and a wallet with its endowment for every player, agent and resident. Safe to run again (each
   * endowment is keyed), so a crash part-way is finished at the next start.
   */
  genesis() {
    if (!this.enabled()) return { done: false };
    this.ledgerKey();
    const t0 = Date.now();
    for (const n of Object.keys(FAUCETS)) this.faucet(n);
    for (const n of Object.keys(SINKS)) this.sink(n);
    this.clearing();
    this.dbs.tx(() => {
      this.walletFor(subj('city', 'city'), 'treasury');
      this.parts.businesses?.sync();
      for (const b of this.parts.businesses?.all() || []) this.walletFor(subj('business', b.id), 'business');
      for (const a of this.q.accounts.all(this.w)) this.walletFor(subj('account', a.id));
      for (const a of this.d.agents?.enabled?.() || []) this.walletFor(subj('agent', a.id));
      for (const p of this.d.people() || []) if (!p.retired) { const s = this.personSubject(p); if (s) this.walletFor(s); }
      this.q.putSetting.run(this.w, 'economy.genesisDone', '1');
      this.d.perms.reload?.();
    });
    this.log(`[economy] genesis: ${this.ledger.count().n} transactions, ${this.ledger.supply().total / SCALE} VC in ${this.ledger.supply().wallets} wallets (${Date.now() - t0} ms)`);
    this.parts.households?.genesisDone?.();
    return { done: true };
  }

  // ------------------------------------------------------------------------------------------- acting on money
  /** Throws unless the economy is on and running. */
  live() {
    if (!this.enabled()) throw new LedgerError('off', 'The economy is switched off here.', 409);
    if (this.paused()) throw new LedgerError('paused', 'The economy is paused.', 503);
  }
  /** A little brake per actor: transfers a minute (policy), bursts allowed. */
  brake(key, cost = 1) {
    const per = this.policy().limits.transfersPerMin, now = Date.now(), b = this.buckets.get(key) || { t: now, n: 0 };
    b.n = Math.max(0, b.n - (now - b.t) * per / 60000); b.t = now; b.n += cost;
    this.buckets.set(key, b);
    if (b.n > per) throw new LedgerError('slow_down', 'Too many payments; wait a moment.', 429);
    if (this.buckets.size > 5000) for (const [k, v] of this.buckets) if (now - v.t > 600e3) this.buckets.delete(k);
  }
  /** Whether actor may move money out of wallet w. actor: { kind: 'account', id, admin } | { kind: 'agent', id, ownerId }. */
  mayDebit(actor, w) {
    if (!w || w.owner_kind === 'system' || w.owner_kind === 'city' || w.owner_kind === 'resident') return false;
    if (actor.kind === 'account') {
      if (w.owner_kind === 'account') return String(w.owner_id) === String(actor.id);
      if (w.owner_kind === 'agent') return this.agentOwner(w.owner_id) === Number(actor.id);
      if (w.owner_kind === 'business') { const b = this.parts.businesses?.get(w.owner_id); return !!b && b.owner_kind === 'account' && String(b.owner_id) === String(actor.id); }
      return false;
    }
    if (actor.kind === 'agent') {
      if (w.owner_kind === 'agent') return String(w.owner_id) === String(actor.id);
      if (w.owner_kind === 'business') { const b = this.parts.businesses?.get(w.owner_id); return !!b && b.owner_kind === 'agent' && String(b.owner_id) === String(actor.id); }
    }
    return false;
  }
  /**
   * A new account pays other players, agents and their businesses only a little a day for its first days (policy
   * limits.newAccountDays / newAccountSendPerDay): starting money farmed through throwaway accounts stays small. Paying the
   * city's own venues is free of it.
   */
  newAccountCheck(actor, src, amount) {
    const pol = this.policy();
    if (actor.kind !== 'account' || src.owner_kind !== 'account' || !(pol.limits.newAccountDays > 0)) return;
    const created = this.q.created.get(this.w, Number(actor.id))?.created || 0;
    if (this.now() - created >= pol.limits.newAccountDays * 86400e3) return;
    const sent = this.q.sentToday.get(this.w, src.id, this.now() - 86400e3).s;
    if (sent + amount > pol.limits.newAccountSendPerDay) throw new LedgerError('limit', `A new account can pay other players up to ${vc(pol.limits.newAccountSendPerDay)} a day for its first ${pol.limits.newAccountDays} days.`, 403);
  }
  actorRef(actor) { return actor.kind === 'account' ? `account:${actor.id}` : actor.kind === 'agent' ? `agent:${actor.id}` : `system:${actor.name || 'economy'}`; }
  /** Resolves a payee given by a page or an agent: { kind: 'account', login } | { kind: 'account', id } | { kind: 'agent', id } | { kind: 'business', id }. */
  resolvePayee(to, viewer) {
    if (!to || typeof to !== 'object') throw new LedgerError('input', 'Who gets the money?', 400);
    if (to.kind === 'account') {
      const a = to.login !== undefined ? this.q.byLogin.get(this.w, String(to.login).trim().toLowerCase()) : this.q.account.get(this.w, Number(to.id));
      if (!a || a.status !== 'active') throw new LedgerError('not_found', 'No player with that name.', 404);
      return subj('account', a.id);
    }
    if (to.kind === 'agent') {
      const a = this.d.agents?.byId?.(Number(to.id));
      if (!a || !a.enabled || !(this.d.agentVisible?.(a, viewer) ?? true)) throw new LedgerError('not_found', 'No such agent.', 404);
      return subj('agent', a.id);
    }
    if (to.kind === 'business') {
      const b = this.parts.businesses?.get(String(to.id));
      if (!b || b.status !== 'open') throw new LedgerError('not_found', 'No such business.', 404);
      return subj('business', b.id);
    }
    throw new LedgerError('input', 'Pay a player, an agent or a business.', 400);
  }
  /**
   * Pays someone. ctx: { actor, session? (authAt), from? (a wallet id the actor may spend from; default its own) }.
   * Large amounts need the password again (policy limits.reauthAbove). Returns the transaction view.
   */
  pay(ctx, { to, amount, memo = '', idem = null, kind = 'transfer', from = null }) {
    this.live();
    const pol = this.policy(), actor = ctx.actor;
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('input', 'Give an amount in hundredths of a VC (a whole, positive number).', 400);
    if (amount > pol.limits.transferMax) throw new LedgerError('limit', `At most ${vc(pol.limits.transferMax)} in one payment.`, 400);
    if (ctx.reauthOk === false && amount > pol.limits.reauthAbove) throw new LedgerError('reauth_required', 'Confirm your password to send this much', 403);
    const src = from ? this.ledger.wallet(String(from)) : this.walletFor(actor.kind === 'agent' ? subj('agent', actor.id) : subj('account', actor.id));
    if (!src || !this.mayDebit(actor, src)) throw new LedgerError('rights', 'You can\'t pay from that wallet.', 403);
    const payee = this.resolvePayee(to, actor);
    const dst = payee.kind === 'business' ? this.walletFor(payee, 'business') : this.walletFor(payee);
    if (dst.id === src.id) throw new LedgerError('input', 'That is the same wallet.', 400);
    // a new account sends only a little each day for its first days (starter money farmed through throwaway accounts)
    if (kind === 'transfer') this.newAccountCheck(actor, src, amount);
    this.brake(this.actorRef(actor));
    const note = clean(memo, 140);
    const t = this.ledger.transfer(src.id, dst.id, amount, { kind, actor: this.actorRef(actor), memo: note || `Payment to ${this.nameOf(payee)}`, idem: idem ? `pay:${this.actorRef(actor)}:${clean(idem, 80)}` : null });
    if (!t.replay) {
      this.d.audit?.log('economy.pay', { actor: actor.kind === 'account' ? { id: actor.id, login: actor.login } : null, detail: { from: src.id, to: subjKey(payee), amount, memo: note, tx: t.id } });
      const acc = this.accountOfWallet(dst.id);
      if (acc != null) this.d.notify?.(acc, { t: 'econ', ev: 'paid', amount, from: this.nameOf(this.ownerOf(src)), memo: note });
    }
    return this.txView(t, src.id);
  }

  /**
   * Buys from a business's menu: the buyer pays the price; the business keeps it less the stock it buys on the market
   * (cost of goods, a sink) and the sales tax (to the treasury). ctx: { actor, at?: { b } } - players must be there
   * (the route checks where their player stands). items: [{ id, n }].
   */
  buy(ctx, { business, items, idem = null }) {
    this.live();
    const actor = ctx.actor, bz = this.parts.businesses, pol = this.policy();
    const biz = bz?.get(String(business || ''));
    if (!biz || biz.status !== 'open' || biz.f === -1) throw new LedgerError('not_found', 'That place doesn\'t sell anything.', 404);
    if (!Array.isArray(items) || !items.length || items.length > 10) throw new LedgerError('input', 'Choose what to buy (up to 10 lines).', 400);
    const lines = [];
    let total = 0, cogs = 0, count = 0;
    const px = this.parts.market ? this.parts.market.pricesFor(this.econDay()) : {};
    for (const x of items) {
      const it = typeof x?.id === 'string' ? bz.itemOf(biz, x.id) : null, n = x?.n ?? 1;
      if (!it) throw new LedgerError('input', `${biz.name} doesn't sell that.`, 400);
      if (!Number.isSafeInteger(n) || n < 1 || n > 20) throw new LedgerError('input', 'From 1 to 20 of each.', 400);
      const price = bz.priceOf(biz, it.id);
      total += price * n; count += n;
      for (const [c, q] of Object.entries(it.inputs)) cogs += n * q * (px[c] ?? pol.commodities[c]?.base ?? 0);
      lines.push({ id: it.id, label: it.label, n, price });
    }
    if (count > 20) throw new LedgerError('input', 'At most 20 things at once.', 400);
    const tax = Math.floor(total * pol.taxes.sales / 10000);
    cogs = Math.floor(cogs);
    const buyer = this.walletFor(actor.kind === 'agent' ? subj('agent', actor.id) : subj('account', actor.id));
    const bw = bz.wallet(biz);
    // buying from your own business moves your own money in a circle and would only dress up its books and the price index
    if (bz.mayManage({ ...actor, admin: false }, biz) || (actor.kind === 'agent' && biz.owner_kind === 'account' && this.agentOwner(actor.id) === Number(biz.owner_id))) {
      throw new LedgerError('input', `${biz.name} is yours; take what you need from its stock.`, 400);
    }
    if (biz.owner_kind !== 'municipality') this.newAccountCheck(actor, buyer, total);
    // a business pays for the stock and the tax out of the sale; one priced below cost must have the money for the rest
    const net = total - cogs - tax;
    if (net < 0 && this.ledger.available(bw.id) < -net) throw new LedgerError('state', `${biz.name} is out of stock.`, 409);
    this.brake(this.actorRef(actor));
    const postings = [{ wallet: buyer.id, amount: -total }];
    if (net) postings.push({ wallet: bw.id, amount: net });
    if (cogs) postings.push({ wallet: this.sink('imports').id, amount: cogs });
    if (tax) postings.push({ wallet: this.treasury().id, amount: tax });
    const what = lines.map(l => `${l.n > 1 ? `${l.n} × ` : ''}${l.label}`).join(', ');
    const t = this.ledger.post({ kind: 'purchase', actor: this.actorRef(actor), memo: `${what} at ${biz.name}`.slice(0, 200), ref: biz.owner_kind === 'municipality' ? 'city' : `biz:${biz.id}`, day: this.econDay(),
      idem: idem ? `buy:${this.actorRef(actor)}:${clean(idem, 80)}` : null, postings });
    if (!t.replay) {
      for (const l of lines) this.parts.households?.notePlayerSale(biz.id, l.price * l.n, l.id, l.n, l.price);
      this.parts.jobs?.ticket?.(biz, { kind: actor.kind, id: String(actor.id), name: this.nameOf(subj(actor.kind, actor.id)) }, lines.map(l => l.id), t.id);
    }
    return { ...this.txView(t, buyer.id), items: lines, total, business: { id: biz.id, name: biz.name } };
  }

  // ------------------------------------------------------------------------------------------- payment requests
  /** Asks someone to pay (an invoice): they pay or decline it in their wallet. */
  request(ctx, { from, amount, memo = '' }) {
    this.live();
    const pol = this.policy(), actor = ctx.actor;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > pol.limits.transferMax) throw new LedgerError('input', 'Bad amount.', 400);
    const payer = this.resolvePayee(from, actor);
    if (payer.kind === 'business') throw new LedgerError('input', 'Ask a player or an agent.', 400);
    const payee = actor.kind === 'agent' ? subj('agent', actor.id) : subj('account', actor.id);
    if (subjKey(payer) === subjKey(payee)) throw new LedgerError('input', 'You can\'t ask yourself.', 400);
    if (this.q.openFrom.get(this.w, subjKey(payee)).n >= pol.limits.openRequests) throw new LedgerError('limit', 'You have too many open requests.', 429);
    this.brake(this.actorRef(actor));
    const id = rid('req'), at = this.now();
    this.q.addRequest.run({ id, w: this.w, payee: subjKey(payee), payer: subjKey(payer), amount, memo: clean(memo, 140), at, expires: at + pol.limits.requestDays * 86400e3 });
    const acc = payer.kind === 'account' ? Number(payer.id) : this.agentOwner(payer.id);
    if (acc != null) this.d.notify?.(acc, { t: 'econ', ev: 'request', amount, from: this.nameOf(payee), memo: clean(memo, 140) });
    return this.requestView(this.q.request.get(this.w, id));
  }
  /** The payer answers a request: pay (from their wallet) or decline; the asker may cancel. */
  answerRequest(ctx, id, answer) {
    const r = this.q.request.get(this.w, String(id)), actor = ctx.actor;
    if (!r || r.status !== 'open') throw new LedgerError('not_found', 'That request is no longer open.', 404);
    const me = subjKey(actor.kind === 'agent' ? subj('agent', actor.id) : subj('account', actor.id));
    if (answer === 'cancel') {
      if (r.payee !== me) throw new LedgerError('rights', 'Only who asked can cancel it.', 403);
      this.q.setRequest.run({ status: 'cancelled', tx: null, at: this.now(), w: this.w, id: r.id });
      return this.requestView(this.q.request.get(this.w, r.id));
    }
    if (r.payer !== me) throw new LedgerError('rights', 'This request is for someone else.', 403);
    if (answer === 'decline') {
      this.q.setRequest.run({ status: 'declined', tx: null, at: this.now(), w: this.w, id: r.id });
      return this.requestView(this.q.request.get(this.w, r.id));
    }
    if (answer !== 'pay') throw new LedgerError('input', 'Pay, decline or cancel.', 400);
    if (r.expires < this.now()) { this.q.setRequest.run({ status: 'expired', tx: null, at: this.now(), w: this.w, id: r.id }); throw new LedgerError('state', 'That request has expired.', 409); }
    const [k, sid] = r.payee.split(':');
    return this.dbs.tx(() => {
      const t = this.pay(ctx, { to: k === 'account' ? { kind: 'account', id: sid } : { kind: k, id: sid }, amount: r.amount, memo: r.memo || 'Payment request', kind: 'transfer', idem: `req:${r.id}` });
      // paying a request is voluntary, so it earns no trust (two accounts could pass the same coins back and forth);
      // trust in paying comes from obligations: rent on time, debts settled
      this.q.setRequest.run({ status: 'paid', tx: t.seq, at: this.now(), w: this.w, id: r.id });
      return { request: this.requestView(this.q.request.get(this.w, r.id)), tx: t };
    });
  }
  expireRequests() { for (const r of this.q.staleRequests.all(this.w, this.now())) this.q.setRequest.run({ status: 'expired', tx: null, at: this.now(), w: this.w, id: r.id }); }
  requestView(r) {
    if (!r) return null;
    const [pk, pid] = r.payee.split(':'), [qk, qid] = r.payer.split(':');
    return { id: r.id, amount: r.amount, memo: r.memo, status: r.status, created: r.created, expires: r.expires, decided: r.decided,
      payee: { kind: pk, id: pid, name: this.nameOf(subj(pk, pid)) }, payer: { kind: qk, id: qid, name: this.nameOf(subj(qk, qid)) } };
  }

  // ------------------------------------------------------------------------------------------- administrators
  /** A grant from the grants faucet to a subject's wallet, with a reason (kept in the ledger and the audit log). */
  grant(admin, { to, amount, memo }) {
    if (!this.enabled()) throw new LedgerError('off', 'The economy is switched off here.', 409);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1e12) throw new LedgerError('input', 'Bad amount.', 400);
    const why = clean(memo, 200);
    if (!why) throw new LedgerError('input', 'Give a reason; it is kept in the ledger.', 400);
    const s = to?.kind === 'city' ? subj('city', 'city') : to?.kind === 'resident' ? subj('resident', String(to.id)) : this.resolvePayee(to, null);
    if (s.kind === 'resident' && !this.residentById(s.id)) throw new LedgerError('not_found', 'No such resident.', 404);
    const w = this.walletFor(s, s.kind === 'business' ? 'business' : s.kind === 'city' ? 'treasury' : 'main');
    const t = this.ledger.transfer(this.faucet('grants').id, w.id, amount, { kind: 'grant', actor: `admin:${admin.id}`, memo: why, force: true });
    this.d.audit?.log('economy.grant', { actor: admin, detail: { to: subjKey(s), amount, memo: why, tx: t.id } });
    return this.txView(t, w.id);
  }
  /** Reverses a transaction (an administrator's correction), with a reason. */
  correct(admin, { tx, memo }) {
    const why = clean(memo, 200);
    if (!why) throw new LedgerError('input', 'Give a reason; it is kept in the ledger.', 400);
    const t = this.ledger.tx(typeof tx === 'string' && !/^\d+$/.test(tx) ? tx : Number(tx));
    if (!t) throw new LedgerError('not_found', 'No such transaction.', 404);
    const r = this.ledger.reverse(t.seq, { actor: `admin:${admin.id}`, memo: `Correction: ${why}` });
    this.d.audit?.log('economy.correct', { actor: admin, detail: { tx: t.id, reversal: r.id, memo: why } });
    return this.txView(r);
  }
  freeze(admin, { wallet, frozen, memo }) {
    const why = clean(memo, 200);
    if (frozen && !why) throw new LedgerError('input', 'Give a reason.', 400);
    const w = this.ledger.setFrozen(String(wallet), !!frozen, why);
    if (frozen && (w.owner_kind === 'account' || w.owner_kind === 'agent')) this.parts.trust?.note(subj(w.owner_kind, w.owner_id), 'pay', -100, 'wallet frozen', `${w.id}:${this.now()}`);
    this.d.audit?.log(frozen ? 'economy.freeze' : 'economy.unfreeze', { actor: admin, detail: { wallet: w.id, memo: why } });
    const acc = this.accountOfWallet(w.id);
    if (acc != null) this.d.notify?.(acc, { t: 'econ', ev: frozen ? 'frozen' : 'unfrozen', memo: why });
    return this.walletView(w);
  }
  /** Every check: the ledger's own (balances, sums, holds) and the signed chain. */
  health() {
    const problems = this.ledger.reconcile();
    const chain = this.verify();
    if (!chain.ok) problems.push({ kind: 'chain', at: chain.brokenAt, why: chain.why });
    return { ok: !problems.length, problems: problems.slice(0, 100), chain, supply: this.ledger.supply(), transactions: this.ledger.count().n };
  }

  // ------------------------------------------------------------------------------------------- views
  walletView(w) {
    if (!w) return null;
    const s = this.ownerOf(w);
    return { id: w.id, owner: { ...s, name: this.nameOf(s) }, purpose: w.purpose, balance: w.balance, held: w.held, available: w.overdraft ? null : w.balance - w.held, status: w.status, frozenWhy: w.frozen_why || null };
  }
  /** A transaction as a statement line for one wallet: the amount for that wallet and who was on the other side. */
  txView(t, walletId = null) {
    if (!t) return null;
    const mine = walletId ? t.postings.find(p => p.wallet === walletId) : null;
    const others = t.postings.filter(p => p.wallet !== walletId).map(p => { const w = this.ledger.wallet(p.wallet); return { name: this.nameOf(this.ownerOf(w)), kind: w?.owner_kind, amount: p.amount }; });
    return { seq: t.seq, id: t.id, at: t.at, kind: t.kind, memo: t.memo, day: t.day, amount: mine ? mine.amount : null, balance: mine ? mine.balance : null, note: mine?.note || null, with: others.slice(0, 6), more: Math.max(0, others.length - 6) };
  }
  /** A wallet's statement, newest first. */
  statement(walletId, { before, limit = 50, kind = null } = {}) {
    return this.ledger.history(walletId, { before, limit, kind }).map(r => {
      const others = r.kind === 'settlement' ? [] : this.ledger.counterparts(r.tx).filter(p => p.wallet !== walletId);
      const top = others.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
      return { seq: r.tx, id: r.id, at: r.at, day: r.day, kind: r.kind, memo: r.memo, amount: r.amount, balance: r.balance, note: r.note || null,
        with: top ? this.nameOf(top.owner_kind === 'system' ? subj('system', top.purpose) : subj(top.owner_kind, top.owner_id)) : null, reverses: r.reverses };
    });
  }
  /** What a player sees in their wallet: their own, their businesses', their agents', requests, trust. */
  mine(accountId) {
    const me = subj('account', accountId);
    const main = this.enabled() ? this.walletFor(me) : null;
    const businesses = (this.parts.businesses?.ownedBy(me) || []).map(b => ({ ...this.parts.businesses.view(b, { owner: true }), wallet: this.walletView(this.walletFor(subj('business', b.id), 'business')) }));
    const agents = (this.d.agents?.ownedBy?.(accountId) || []).map(a => ({ id: a.id, name: a.name, emoji: a.emoji, wallet: this.walletView(this.walletFor(subj('agent', a.id))), limits: this.parts.agents?.limitsOf(a.id) || null }));
    return {
      enabled: this.enabled(), paused: this.paused(), scale: SCALE,
      wallet: this.walletView(main), businesses, agents,
      requestsToPay: this.q.requestsTo.all(this.w, subjKey(me)).map(r => this.requestView(r)),
      requestsSent: this.q.requestsFrom.all(this.w, subjKey(me)).map(r => this.requestView(r)),
      approvals: this.parts.agents?.pendingFor(accountId) || [],
      trust: this.parts.trust?.of(me) || null,
      leases: this.parts.realty?.of(me) || { rent: [], let: [] },
      limits: { reauthAbove: this.policy().limits.reauthAbove, transferMax: this.policy().limits.transferMax },
    };
  }
  /** The public switches and the policy a page needs (no secrets; everyone may read the policy: transparency). */
  status() {
    const p = this.policy();
    return { enabled: this.enabled(), paused: this.paused(), version: this.version, scale: SCALE,
      day: this.econDay(), settleHour: p.settleHour, menus: p.menus, wages: p.wages, taxes: p.taxes, fees: p.fees, limits: { reauthAbove: p.limits.reauthAbove, transferMax: p.limits.transferMax } };
  }
  defaults() { return POLICY_DEFAULTS; }
}
