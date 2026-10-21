// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The Virtual Coin ledger (docs/features/ECONOMY.md §2): wallets, double-entry transactions, holds, reversals, the
// signed chain and reconciliation. Every movement of VC in the world goes through Ledger.post().
//
// - A transaction has two or more postings whose amounts sum to exactly zero; it commits with every balance it changes
//   in one database transaction, or not at all.
// - Ordinary wallets never go below what they hold (the database's CHECK). System wallets (faucets) may go negative:
//   money is created only by posting out of a faucet and destroyed only by posting into a sink.
// - Transactions and postings are append-only (database triggers); a mistake is undone by a reversal that names it.
// - Each transaction carries an HMAC-SHA-256 over its content and the previous transaction's MAC, keyed with a random
//   ledger key the economy keeps sealed (server/economy/economy.js). verify() walks the chain.
// - An idempotency key returns the first result when the same request comes again, and refuses a different request
//   under the same key.
// Amounts are integers in hundredths of a VC.
import crypto from 'node:crypto';

export const SCALE = 100;                         // hundredths of a VC
export const MAX_AMOUNT = 1e13;                    // one posting: 100 billion VC
export const MAX_BALANCE = 2 ** 52;                // well inside safe integers
export const OWNER_KINDS = Object.freeze(['account', 'agent', 'resident', 'business', 'city', 'system']);
const ID_RE = /^[A-Za-z0-9:_.-]{1,80}$/;

export class LedgerError extends Error {
  /** code: input | not_found | funds | frozen | conflict | idempotency_conflict | paused | limit; detail: for agents and pages */
  constructor(code, message, status = 409, detail = null) { super(message); this.code = code; this.status = status; this.detail = detail; }
}

const rid = p => `${p}_${crypto.randomBytes(12).toString('base64url')}`;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const cleanMemo = s => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
/** Formats hundredths of a VC for people: 1234 → "12.34 VC", 1200 → "12 VC". */
export function vc(n) {
  if (!Number.isFinite(n)) return '—';
  const neg = n < 0, a = Math.abs(Math.trunc(n)), whole = Math.floor(a / SCALE), cents = a % SCALE;
  return `${neg ? '−' : ''}${whole.toLocaleString('en-US')}${cents ? `.${String(cents).padStart(2, '0')}` : ''} VC`;
}

export class Ledger {
  /**
   * @param {object} dbs   openDb() result
   * @param {object} o
   * @param {function} o.key   () => Buffer: the ledger key (32 bytes) that signs the chain
   * @param {function} [o.now]
   */
  constructor(dbs, { key, now = () => Date.now() } = {}) {
    if (typeof key !== 'function') throw new Error('the ledger needs its key');
    this.dbs = dbs; this.db = dbs.db; this.w = dbs.worldId; this.now = now; this._key = key;
    this.cache = new Map();          // wallet id → row (balances are read often: the settlement, every purchase)
    this.byOwner = new Map();        // "kind|id|purpose" → wallet id
    this._lastMac = null;            // the newest transaction's MAC (the next one signs over it)
    this.listeners = new Set();      // ({ tx, postings }) after a transaction is committed
    this._queued = [];               // events of transactions inside someone else's database transaction
    this.paused = () => false;       // the economy's kill switch (set by the economy)
    const db = this.db;
    this.q = {
      wallet: db.prepare('SELECT * FROM econ_wallets WHERE world_id = ? AND id = ?'),
      walletOf: db.prepare('SELECT * FROM econ_wallets WHERE world_id = ? AND owner_kind = ? AND owner_id = ? AND purpose = ?'),
      walletsOf: db.prepare("SELECT * FROM econ_wallets WHERE world_id = ? AND owner_kind = ? AND owner_id = ? AND status <> 'closed' ORDER BY created"),
      addWallet: db.prepare(`INSERT INTO econ_wallets (id, world_id, owner_kind, owner_id, purpose, label, overdraft, created, updated)
        VALUES ($id, $w, $kind, $oid, $purpose, $label, $od, $at, $at)`),
      setBalance: db.prepare('UPDATE econ_wallets SET balance = $balance, held = $held, version = version + 1, updated = $at WHERE world_id = $w AND id = $id AND version = $version'),
      setStatus: db.prepare('UPDATE econ_wallets SET status = $status, frozen_why = $why, version = version + 1, updated = $at WHERE world_id = $w AND id = $id'),
      setLabel: db.prepare('UPDATE econ_wallets SET label = $label, updated = $at WHERE world_id = $w AND id = $id'),
      lastTx: db.prepare('SELECT seq, mac FROM econ_tx WHERE world_id = ? ORDER BY seq DESC LIMIT 1'),
      txByIdem: db.prepare('SELECT * FROM econ_tx WHERE world_id = ? AND idem = ?'),
      txBySeq: db.prepare('SELECT * FROM econ_tx WHERE world_id = ? AND seq = ?'),
      txById: db.prepare('SELECT * FROM econ_tx WHERE world_id = ? AND id = ?'),
      addTx: db.prepare(`INSERT INTO econ_tx (world_id, id, kind, memo, actor, ref, idem, idem_hash, day, at, reverses, mac)
        VALUES ($w, $id, $kind, $memo, $actor, $ref, $idem, $ih, $day, $at, $rev, $mac)`),
      addPosting: db.prepare('INSERT INTO econ_postings (tx, world_id, wallet, amount, balance, note) VALUES (?, ?, ?, ?, ?, ?)'),
      postingsOf: db.prepare('SELECT wallet, amount, balance, note FROM econ_postings WHERE tx = ? ORDER BY rowid'),
      reversalOf: db.prepare('SELECT seq FROM econ_tx WHERE world_id = ? AND reverses = ?'),
      history: db.prepare(`SELECT p.tx, p.amount, p.balance, p.note, t.id, t.kind, t.memo, t.actor, t.ref, t.day, t.at, t.reverses
        FROM econ_postings p JOIN econ_tx t ON t.seq = p.tx WHERE p.world_id = $w AND p.wallet = $wallet AND p.tx < $before ORDER BY p.tx DESC LIMIT $limit`),
      historyKind: db.prepare(`SELECT p.tx, p.amount, p.balance, p.note, t.id, t.kind, t.memo, t.actor, t.ref, t.day, t.at, t.reverses
        FROM econ_postings p JOIN econ_tx t ON t.seq = p.tx WHERE p.world_id = $w AND p.wallet = $wallet AND p.tx < $before AND t.kind = $kind ORDER BY p.tx DESC LIMIT $limit`),
      counterparts: db.prepare('SELECT p.wallet, p.amount, w.owner_kind, w.owner_id, w.purpose, w.label FROM econ_postings p LEFT JOIN econ_wallets w ON w.id = p.wallet AND w.world_id = p.world_id WHERE p.tx = ?'),
      hold: db.prepare('SELECT * FROM econ_holds WHERE world_id = ? AND id = ?'),
      holdByRef: db.prepare("SELECT * FROM econ_holds WHERE world_id = ? AND purpose = ? AND ref = ? AND status = 'open'"),
      holdsOf: db.prepare("SELECT * FROM econ_holds WHERE world_id = ? AND wallet = ? AND status = 'open' ORDER BY created"),
      addHold: db.prepare(`INSERT INTO econ_holds (id, world_id, wallet, amount, purpose, ref, status, created, expires)
        VALUES ($id, $w, $wallet, $amount, $purpose, $ref, 'open', $at, $expires)`),
      closeHold: db.prepare("UPDATE econ_holds SET status = $status, closed = $at, tx = $tx WHERE world_id = $w AND id = $id AND status = 'open'"),
      expiredHolds: db.prepare("SELECT * FROM econ_holds WHERE world_id = ? AND status = 'open' AND expires IS NOT NULL AND expires < ? LIMIT 500"),
      supply: db.prepare("SELECT COALESCE(SUM(CASE WHEN owner_kind <> 'system' THEN balance ELSE 0 END), 0) AS total, COUNT(*) AS wallets FROM econ_wallets WHERE world_id = ?"),
      systemWallets: db.prepare("SELECT * FROM econ_wallets WHERE world_id = ? AND owner_kind = 'system'"),
      allWallets: db.prepare('SELECT * FROM econ_wallets WHERE world_id = ?'),
      sums: db.prepare('SELECT wallet, SUM(amount) AS s, COUNT(*) AS n FROM econ_postings WHERE world_id = ? GROUP BY wallet'),
      unbalanced: db.prepare('SELECT tx, SUM(amount) AS s, COUNT(*) AS n FROM econ_postings WHERE world_id = ? GROUP BY tx HAVING s <> 0 OR n < 2 LIMIT 20'),
      orphans: db.prepare('SELECT t.seq FROM econ_tx t LEFT JOIN econ_postings p ON p.tx = t.seq WHERE t.world_id = ? AND p.tx IS NULL LIMIT 20'),
      openHeld: db.prepare("SELECT wallet, SUM(amount) AS s FROM econ_holds WHERE world_id = ? AND status = 'open' GROUP BY wallet"),
      chain: db.prepare('SELECT * FROM econ_tx WHERE world_id = $w AND seq > $after ORDER BY seq LIMIT $limit'),
      count: db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(seq), 0) AS last FROM econ_tx WHERE world_id = ?'),
    };
    dbs.onRollback(() => { this.cache.clear(); this.byOwner.clear(); this._lastMac = null; this._queued.length = 0; });
  }

  // ------------------------------------------------------------------------------------------- wallets
  _keep(row) { if (row) { this.cache.set(row.id, row); this.byOwner.set(`${row.owner_kind}|${row.owner_id}|${row.purpose}`, row.id); } return row; }
  /** A wallet by id (from memory after its first read), or null. */
  wallet(id) {
    const c = this.cache.get(id);
    if (c) return c;
    return this._keep(this.q.wallet.get(this.w, String(id)) || null);
  }
  /** A subject's wallet for a purpose, or null. */
  walletOf(kind, ownerId, purpose = 'main') {
    const k = `${kind}|${ownerId}|${purpose}`, id = this.byOwner.get(k);
    if (id) return this.wallet(id);
    return this._keep(this.q.walletOf.get(this.w, kind, String(ownerId), purpose) || null);
  }
  walletsOf(kind, ownerId) { return this.q.walletsOf.all(this.w, kind, String(ownerId)).map(r => this._keep(r)); }
  /** The subject's wallet for a purpose, created (empty) when missing. System wallets may overdraw. */
  ensure(kind, ownerId, purpose = 'main', { label = '' } = {}) {
    if (!OWNER_KINDS.includes(kind)) throw new LedgerError('input', `Unknown wallet owner kind ${kind}.`, 400);
    if (!ID_RE.test(String(ownerId)) || !ID_RE.test(purpose)) throw new LedgerError('input', 'Bad wallet owner or purpose.', 400);
    const have = this.walletOf(kind, ownerId, purpose);
    if (have) return have;
    const id = rid('w'), at = this.now();
    this.dbs.tx(() => this.q.addWallet.run({ id, w: this.w, kind, oid: String(ownerId), purpose, label: cleanMemo(label).slice(0, 80), od: kind === 'system' && (purpose.startsWith('faucet:') || purpose === 'clearing') ? 1 : 0, at }));
    return this.wallet(id);
  }
  setLabel(id, label) { this.q.setLabel.run({ label: cleanMemo(label).slice(0, 80), at: this.now(), w: this.w, id }); this.cache.delete(id); }
  available(id) { const w = this.wallet(id); return w ? (w.overdraft ? Infinity : w.balance - w.held) : 0; }
  /** Freezes a wallet (nothing leaves it) or unfreezes it. Administrators only (the economy checks); the reason is kept. */
  setFrozen(id, frozen, why = '') {
    const w = this.wallet(id);
    if (!w) throw new LedgerError('not_found', 'No such wallet.', 404);
    if (w.owner_kind === 'system') throw new LedgerError('input', 'System wallets are not frozen.', 400);
    this.dbs.tx(() => this.q.setStatus.run({ status: frozen ? 'frozen' : 'active', why: frozen ? cleanMemo(why) || 'Frozen' : null, at: this.now(), w: this.w, id }));
    this.cache.delete(id);
    return this.wallet(id);
  }

  // ------------------------------------------------------------------------------------------- the chain
  key() { const k = this._key(); if (!Buffer.isBuffer(k) || k.length < 32) throw new Error('the ledger key is missing'); return k; }
  lastMac() {
    if (this._lastMac === null) this._lastMac = this.q.lastTx.get(this.w)?.mac || 'genesis';
    return this._lastMac;
  }
  /** The MAC of a transaction: over the previous MAC and the transaction's own content, postings in their order. */
  macOf(prev, t, postings) {
    const body = JSON.stringify([prev, this.w, t.id, t.kind, t.memo, t.actor, t.ref ?? null, t.idem ?? null, t.day ?? null, t.at, t.reverses ?? null, postings.map(p => (p.note ? [p.wallet, p.amount, p.note] : [p.wallet, p.amount]))]);
    return crypto.createHmac('sha256', this.key()).update(body).digest('base64url');
  }

  // ------------------------------------------------------------------------------------------- posting
  /**
   * Posts one balanced transaction.
   * @param {object} t
   * @param {string} t.kind      what it is (transfer, purchase, wage, rent, tax, …)
   * @param {string} t.actor     who caused it ("account:12", "agent:4", "system:payroll", "admin:1")
   * @param {Array<{wallet:string, amount:number}>} t.postings   amounts sum to zero; a wallet may appear once
   * @param {string} [t.memo] [t.ref] [t.idem] (idempotency key) [t.day] (world day)
   * @param {string[]} [t.capture]   open holds this transaction spends (released first, so their money can be debited)
   * @param {number} [t.reverses]    the seq of the transaction this one reverses
   * @param {boolean} [t.force]      move money out of a frozen wallet (administrators' corrections, reversals)
   * @param {boolean} [t.system]     the economy's own bookkeeping (settlement): runs while the economy is paused
   * @returns {{ seq, id, at, kind, postings, replay }}
   */
  post(t) {
    if (this.paused() && !t.force && !t.system) throw new LedgerError('paused', 'The economy is paused.', 503);
    const kind = String(t.kind || ''), actor = String(t.actor || '');
    if (!/^[a-z_]{2,24}$/.test(kind)) throw new LedgerError('input', 'Bad transaction kind.', 400);
    if (!/^[a-z]{3,10}:[A-Za-z0-9:_.-]{1,80}$/.test(actor)) throw new LedgerError('input', 'Every transaction names who made it.', 400);
    const list = (Array.isArray(t.postings) ? t.postings : []).map(p => (p && p.note != null ? { ...p, note: cleanMemo(p.note) || null } : p));
    if (list.length < 2 || list.length > 50000) throw new LedgerError('input', 'A transaction moves money between at least two wallets.', 400);
    let sum = 0;
    const seen = new Set();
    for (const p of list) {
      if (!p || typeof p.wallet !== 'string' || !Number.isSafeInteger(p.amount) || p.amount === 0 || Math.abs(p.amount) > MAX_AMOUNT) throw new LedgerError('input', 'Each posting is a wallet and a whole, non-zero amount.', 400);
      if (seen.has(p.wallet)) throw new LedgerError('input', 'A wallet appears once in a transaction.', 400);
      if (p.note != null && typeof p.note !== 'string') throw new LedgerError('input', 'A posting\'s note is text.', 400);
      seen.add(p.wallet); sum += p.amount;
    }
    if (sum !== 0) throw new LedgerError('input', 'The postings of a transaction must sum to zero.', 400);
    const memo = cleanMemo(t.memo), ref = t.ref == null ? null : String(t.ref).slice(0, 120), idem = t.idem == null ? null : String(t.idem).slice(0, 160);
    const ih = idem ? sha(JSON.stringify([kind, memo, actor, ref, [...list].sort((a, b) => (a.wallet < b.wallet ? -1 : 1)).map(p => [p.wallet, p.amount])])) : null;
    const out = this.dbs.tx(() => {
      if (idem) {
        const was = this.q.txByIdem.get(this.w, idem);
        if (was) {
          if (was.idem_hash !== ih) throw new LedgerError('idempotency_conflict', 'This request key was already used for a different payment.', 409);
          return { ...this._view(was), replay: true };
        }
      }
      const at = this.now();
      let rev = null;
      if (t.reverses != null) {
        rev = Number(t.reverses);
        if (!Number.isSafeInteger(rev) || !this.q.txBySeq.get(this.w, rev)) throw new LedgerError('not_found', 'No such transaction to reverse.', 404);
        if (this.q.reversalOf.get(this.w, rev)) throw new LedgerError('conflict', 'That transaction was already reversed.', 409);
      }
      // the holds this transaction spends: released first (their money becomes available to the debit below)
      const held = new Map();
      for (const hid of t.capture || []) {
        const h = this.q.hold.get(this.w, String(hid));
        if (!h || h.status !== 'open') throw new LedgerError('conflict', 'That hold is no longer open.', 409);
        held.set(h.wallet, (held.get(h.wallet) || 0) + h.amount);
      }
      const rows = list.map(p => {
        const w = this.q.wallet.get(this.w, p.wallet);
        if (!w) throw new LedgerError('not_found', 'No such wallet.', 404, { wallet: p.wallet });
        if (w.status === 'closed') throw new LedgerError('frozen', 'That wallet is closed.', 409, { wallet: p.wallet });
        if (w.status === 'frozen' && p.amount < 0 && !t.force) throw new LedgerError('frozen', 'That wallet is frozen.', 409, { wallet: p.wallet });
        const free = held.get(w.id) || 0, nextHeld = w.held - free, next = w.balance + p.amount;
        if (!w.overdraft && next < nextHeld) {
          throw new LedgerError('funds', `Not enough VC: ${vc(w.balance - w.held + free)} available, ${vc(-p.amount)} needed.`, 409, { wallet: w.id, available: w.balance - w.held + free, needed: -p.amount });
        }
        if (Math.abs(next) > MAX_BALANCE) throw new LedgerError('limit', 'That would put a wallet over the largest balance.', 409);
        return { w, p, next, nextHeld };
      });
      // a wallet whose holds are spent but which is not in the postings keeps its money, minus the hold
      for (const [wid] of held) if (!seen.has(wid)) throw new LedgerError('input', 'A captured hold must be spent by this transaction.', 400);
      const tx = { id: rid('tx'), kind, memo, actor, ref, idem, day: Number.isSafeInteger(t.day) ? t.day : null, at, reverses: rev };
      const mac = this.macOf(this.lastMac(), tx, list);
      const r = this.q.addTx.run({ w: this.w, id: tx.id, kind, memo, actor, ref, idem, ih, day: tx.day, at, rev, mac });
      const seq = Number(r.lastInsertRowid);
      for (const { w, p, next, nextHeld } of rows) {
        this.q.addPosting.run(seq, this.w, w.id, p.amount, next, p.note || null);
        const u = this.q.setBalance.run({ balance: next, held: nextHeld, at, w: this.w, id: w.id, version: w.version });
        if (u.changes !== 1) throw new LedgerError('conflict', 'A wallet changed at the same time; try again.', 409);
      }
      for (const hid of t.capture || []) this.q.closeHold.run({ status: 'captured', at, tx: seq, w: this.w, id: String(hid) });
      this._lastMac = mac;
      for (const { w } of rows) this.cache.delete(w.id);
      return { seq, id: tx.id, at, kind, memo, actor, ref, day: tx.day, reverses: rev, postings: rows.map(({ w, p, next }) => ({ wallet: w.id, amount: p.amount, balance: next, note: p.note || null })), replay: false };
    });
    if (!out.replay) this._emit(out);
    return out;
  }
  /** Moves amount from one wallet to another (a two-posting transaction). */
  transfer(from, to, amount, o = {}) {
    if (from === to) throw new LedgerError('input', 'A wallet can\'t pay itself.', 400);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new LedgerError('input', 'The amount must be a whole, positive number of hundredths.', 400);
    return this.post({ ...o, kind: o.kind || 'transfer', postings: [{ wallet: from, amount: -amount }, { wallet: to, amount }] });
  }
  /** Reverses a transaction: the same postings with the opposite sign, naming it. A reversal can't be reversed. */
  reverse(seq, { actor, memo = '', force = true, idem = null } = {}) {
    const t = this.q.txBySeq.get(this.w, Number(seq));
    if (!t) throw new LedgerError('not_found', 'No such transaction.', 404);
    if (t.reverses != null) throw new LedgerError('input', 'A reversal is not reversed; post a new transaction instead.', 400);
    const ps = this.q.postingsOf.all(t.seq);
    return this.post({ kind: 'reversal', actor, memo: memo || `Reversal of ${t.id}`, ref: t.id, reverses: t.seq, force, idem, postings: ps.map(p => ({ wallet: p.wallet, amount: -p.amount })) });
  }

  // ------------------------------------------------------------------------------------------- holds
  /** Sets money aside in a wallet (escrow): it stays the owner's but can't be spent until released or captured. */
  hold(walletId, amount, { purpose, ref = null, expires = null } = {}) {
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new LedgerError('input', 'Bad amount to hold.', 400);
    if (!/^[a-z_]{2,24}$/.test(String(purpose || ''))) throw new LedgerError('input', 'Say what the hold is for.', 400);
    return this.dbs.tx(() => {
      const w = this.q.wallet.get(this.w, String(walletId));
      if (!w) throw new LedgerError('not_found', 'No such wallet.', 404);
      if (w.status !== 'active') throw new LedgerError('frozen', 'That wallet is frozen.', 409);
      if (ref != null && this.q.holdByRef.get(this.w, purpose, String(ref))) throw new LedgerError('conflict', 'That is already held.', 409);
      if (!w.overdraft && w.balance - w.held < amount) throw new LedgerError('funds', `Not enough VC: ${vc(w.balance - w.held)} available, ${vc(amount)} needed.`, 409, { wallet: w.id, available: w.balance - w.held, needed: amount });
      const id = rid('hold'), at = this.now();
      this.q.addHold.run({ id, w: this.w, wallet: w.id, amount, purpose, ref: ref == null ? null : String(ref), at, expires });
      const u = this.q.setBalance.run({ balance: w.balance, held: w.held + amount, at, w: this.w, id: w.id, version: w.version });
      if (u.changes !== 1) throw new LedgerError('conflict', 'A wallet changed at the same time; try again.', 409);
      this.cache.delete(w.id);
      return { id, wallet: w.id, amount, purpose, ref, expires };
    });
  }
  /** Gives held money back to the wallet's available balance. */
  release(holdId, { status = 'released' } = {}) {
    return this.dbs.tx(() => {
      const h = this.q.hold.get(this.w, String(holdId));
      if (!h || h.status !== 'open') return false;
      const w = this.q.wallet.get(this.w, h.wallet), at = this.now();
      this.q.closeHold.run({ status, at, tx: null, w: this.w, id: h.id });
      this.q.setBalance.run({ balance: w.balance, held: Math.max(0, w.held - h.amount), at, w: this.w, id: w.id, version: w.version });
      this.cache.delete(w.id);
      return true;
    });
  }
  holdOf(id) { return this.q.hold.get(this.w, String(id)) || null; }
  holdByRef(purpose, ref) { return this.q.holdByRef.get(this.w, purpose, String(ref)) || null; }
  holdsOf(walletId) { return this.q.holdsOf.all(this.w, walletId); }
  /** Releases holds whose time ran out; returns how many. */
  expireHolds() {
    let n = 0;
    for (const h of this.q.expiredHolds.all(this.w, this.now())) if (this.release(h.id)) n++;
    return n;
  }

  // ------------------------------------------------------------------------------------------- reading
  _view(t) { return { seq: t.seq, id: t.id, at: t.at, kind: t.kind, memo: t.memo, actor: t.actor, ref: t.ref, day: t.day, reverses: t.reverses, postings: this.q.postingsOf.all(t.seq) }; }
  tx(seqOrId) {
    const t = typeof seqOrId === 'number' ? this.q.txBySeq.get(this.w, seqOrId) : this.q.txById.get(this.w, String(seqOrId));
    return t ? this._view(t) : null;
  }
  /** A wallet's postings, newest first: { tx, amount, balance, id, kind, memo, actor, ref, day, at }. */
  history(walletId, { before = Number.MAX_SAFE_INTEGER, limit = 50, kind = null } = {}) {
    const lim = Math.max(1, Math.min(500, limit | 0 || 50));
    const p = { w: this.w, wallet: String(walletId), before: Number.isSafeInteger(before) ? before : Number.MAX_SAFE_INTEGER, limit: lim };
    return kind ? this.q.historyKind.all({ ...p, kind }) : this.q.history.all(p);
  }
  /** The other side of a transaction, for a statement line ("from Harbour Café"). */
  counterparts(seq) { return this.q.counterparts.all(seq); }
  /** The money supply: VC in every wallet that is not the system's, and what the faucets made and the sinks destroyed. */
  supply() {
    const s = this.q.supply.get(this.w);
    let issued = 0, destroyed = 0;
    const faucets = {}, sinks = {};
    for (const w of this.q.systemWallets.all(this.w)) {
      if (w.purpose.startsWith('faucet:')) { issued += -w.balance; faucets[w.purpose.slice(7)] = -w.balance; } else if (w.purpose.startsWith('sink:')) { destroyed += w.balance; sinks[w.purpose.slice(5)] = w.balance; }
    }
    return { total: s.total, wallets: s.wallets, issued, destroyed, faucets, sinks };
  }
  count() { return this.q.count.get(this.w); }

  // ------------------------------------------------------------------------------------------- checks
  /** Walks the signed chain from the start (or after seq `after`, trusting `prevMac`). { ok, checked, brokenAt, why }. */
  verify({ after = 0, prevMac = 'genesis', batch = 5000 } = {}) {
    let prev = prevMac, last = after, checked = 0;
    for (;;) {
      const rows = this.q.chain.all({ w: this.w, after: last, limit: batch });
      if (!rows.length) break;
      for (const t of rows) {
        const ps = this.q.postingsOf.all(t.seq);
        if (this.macOf(prev, t, ps) !== t.mac) return { ok: false, checked, brokenAt: t.seq, why: checked || after ? 'a transaction was changed, removed or inserted before this one, or this one was changed' : 'the first transaction does not match: the ledger key may have changed' };
        prev = t.mac; last = t.seq; checked++;
      }
    }
    return { ok: true, checked, last };
  }
  /** Every check the ledger can make on itself; returns a list of problems (empty: all is well). */
  reconcile() {
    const problems = [];
    const sums = new Map(this.q.sums.all(this.w).map(r => [r.wallet, r.s]));
    const held = new Map(this.q.openHeld.all(this.w).map(r => [r.wallet, r.s]));
    let total = 0;
    for (const w of this.q.allWallets.all(this.w)) {
      total += w.balance;
      const s = sums.get(w.id) || 0;
      if (s !== w.balance) problems.push({ kind: 'drift', wallet: w.id, balance: w.balance, fromPostings: s });
      if ((held.get(w.id) || 0) !== w.held) problems.push({ kind: 'held', wallet: w.id, held: w.held, openHolds: held.get(w.id) || 0 });
      if (!w.overdraft && w.balance < 0) problems.push({ kind: 'negative', wallet: w.id, balance: w.balance });
      if (w.purpose === 'clearing' && w.balance !== 0) problems.push({ kind: 'clearing', wallet: w.id, balance: w.balance });
    }
    if (total !== 0) problems.push({ kind: 'unbalanced_total', total });
    for (const r of this.q.unbalanced.all(this.w)) problems.push({ kind: 'unbalanced_tx', tx: r.tx, sum: r.s, postings: r.n });
    for (const r of this.q.orphans.all(this.w)) problems.push({ kind: 'empty_tx', tx: r.seq });
    return problems;
  }

  // ------------------------------------------------------------------------------------------- events
  _emit(ev) {
    let inTx = false;
    try { inTx = this.db.isTransaction; } catch { return; }
    if (inTx) {   // inside someone else's transaction: tell listeners once it has committed
      this._queued.push(ev);
      if (this._queued.length === 1) queueMicrotask(() => this.flush());
      return;
    }
    for (const fn of this.listeners) { try { fn(ev); } catch { /* a listener's problem stays there */ } }
  }
  /** Sends queued events once the database transaction around them has committed (a rollback drops them). */
  flush() {
    try { if (this.db.isTransaction) { queueMicrotask(() => this.flush()); return; } } catch { this._queued.length = 0; return; }   // closed: nobody to tell
    const list = this._queued.splice(0);
    for (const ev of list) for (const fn of this.listeners) { try { fn(ev); } catch { /* ignore */ } }
  }
}
