// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The inventory (docs/features/INVENTORY.md): what each player, agent or business holds, kept beside its wallet - the
// same owner (the economy's subject: 'account:12', 'agent:7', 'business:b3'), the same rules for giving as for paying
// (an agent within its owner's limits, a new account's daily cap), every change in one transaction with its log line
// (inv_moves: what, how many, from whom to whom, worth what, why, an idempotency key: a repeat never moves it twice).
// Items are the shared list's (shared/items.js): plain stacks (one row per kind) or one-of-a-kind pieces (a fish: its
// length, weight and worth in attrs) kept apart. Only the server changes an inventory.
import { LedgerError } from './ledger.js';
import { subj } from './economy.js';
import { itemOf, itemValue, WELCOME_KIT } from '../../shared/items.js';

export const MAX_STACKS = 200;            // rows an inventory holds (each one-of-a-kind piece is one)
export const MAX_QTY = 99999;              // the most one plain stack holds
const DAY = 86400e3;
const bad = (msg, code = 'input', status = 400, detail) => new LedgerError(code, msg, status, detail);
export const ownerKey = s => `${s.kind}:${s.id}`;
const parseOwner = k => { const i = String(k).indexOf(':'); return i > 0 ? { kind: k.slice(0, i), id: k.slice(i + 1) } : null; };

export class Inventory {
  /** econ: the economy (its database, clock, names, owners, notices and policy). */
  constructor(econ) {
    this.e = econ; this.db = econ.db; this.w = econ.w; this.welcomed = new Set();
    const db = this.db;
    this.q = {
      list: db.prepare('SELECT id, item, qty, held, attrs, got FROM inv_items WHERE world_id = ? AND owner = ? ORDER BY got DESC, id DESC'),
      count: db.prepare('SELECT COUNT(*) AS n FROM inv_items WHERE world_id = ? AND owner = ?'),
      get: db.prepare('SELECT id, owner, item, qty, held, attrs, got FROM inv_items WHERE world_id = ? AND id = ?'),
      stack: db.prepare('SELECT id, qty FROM inv_items WHERE world_id = ? AND owner = ? AND item = ? AND attrs IS NULL'),
      ins: db.prepare('INSERT INTO inv_items (world_id, owner, item, qty, held, attrs, got) VALUES (?, ?, ?, ?, 0, ?, ?)'),
      setQty: db.prepare('UPDATE inv_items SET qty = ? WHERE world_id = ? AND id = ?'),
      del: db.prepare('DELETE FROM inv_items WHERE world_id = ? AND id = ?'),
      move: db.prepare('INSERT INTO inv_moves (world_id, at, kind, item, qty, attrs, src, dst, actor, memo, ref, value, idem) VALUES ($w, $at, $kind, $item, $qty, $attrs, $src, $dst, $actor, $memo, $ref, $value, $idem)'),
      idem: db.prepare('SELECT id FROM inv_moves WHERE world_id = ? AND idem = ?'),
      gaveSince: db.prepare("SELECT COALESCE(SUM(value), 0) AS v FROM inv_moves WHERE world_id = ? AND src = ? AND kind = 'give' AND at > ?"),
      recent: db.prepare('SELECT at, kind, item, qty, attrs, src, dst, memo, value FROM inv_moves WHERE world_id = ? AND (src = ? OR dst = ?) ORDER BY at DESC, id DESC LIMIT ?'),
      account: db.prepare("SELECT id, created, status FROM accounts WHERE world_id = ? AND id = ?"),
      byName: db.prepare("SELECT id FROM accounts WHERE world_id = ? AND status = 'active' AND (LOWER(display_name) = ? OR login = ?) LIMIT 1"),
    };
  }
  // ---------------------------------------------------------------- the welcome kit
  /**
   * The welcome kit (shared/items.js WELCOME_KIT) into an inventory the first time it's looked at: once per owner, ever
   * (its log lines carry the key). → true when it was given just now.
   */
  welcome(owner) {
    const k = ownerKey(owner), kit = WELCOME_KIT[owner.kind];
    if (!kit || this.welcomed.has(k)) return false;
    this.welcomed.add(k);
    if (this.q.idem.get(this.w, `welcome:${k}:0`)) return false;
    let gave = false;
    this.e.dbs.tx(() => { kit.forEach(([item, qty], n) => { if (itemOf(item)) { const r = this.add(owner, item, qty, null, { kind: 'welcome', actor: 'system:welcome', memo: 'Welcome kit', idem: `welcome:${k}:${n}` }); gave ||= !r.dup; } }); });
    return gave;
  }
  // ---------------------------------------------------------------- reading
  /** The stacks an owner holds: [{ id, item, qty, held, attrs, got }] (newest first). */
  list(owner) { return this.q.list.all(this.w, ownerKey(owner)).map(r => ({ ...r, attrs: r.attrs ? JSON.parse(r.attrs) : null })); }
  /** What the inventory window shows: the stacks, the room, what it's all worth (hundredths). */
  view(owner) {
    const stacks = this.list(owner);
    return { owner: ownerKey(owner), stacks, used: stacks.length, max: MAX_STACKS, value: stacks.reduce((a, s) => a + itemValue(itemOf(s.item), s.attrs) * s.qty, 0) };
  }
  /** The latest changes in an owner's inventory, for its history. */
  history(owner, limit = 40) {
    const k = ownerKey(owner);
    return this.q.recent.all(this.w, k, k, Math.min(100, limit)).map(r => ({ ...r, attrs: r.attrs ? JSON.parse(r.attrs) : null, dir: r.dst === k ? 'in' : 'out', with: r.dst === k ? (r.src ? this.e.nameOf(parseOwner(r.src)) : null) : (r.dst ? this.e.nameOf(parseOwner(r.dst)) : null) }));
  }
  /**
   * What an agent (or anyone) holds, in short, for its facts and its brain: { things (pieces), kinds, worthVC, items:
   * [{ ref ('S12': its stack, for giving), name, cat, qty, worthVC, cm?, kg? }] most valuable first (n of them), more }.
   */
  summary(owner, n = 10) {
    const st = this.list(owner).map(s => { const d = itemOf(s.item); return { ref: `S${s.id}`, name: d?.name || s.item, cat: d?.cat, qty: s.qty, worthVC: Math.round(itemValue(d, s.attrs) * s.qty) / 100, ...(s.attrs?.cm ? { cm: s.attrs.cm, kg: s.attrs.kg } : {}) }; });
    st.sort((a, b) => b.worthVC - a.worthVC || a.name.localeCompare(b.name));
    return { things: st.reduce((a, s) => a + s.qty, 0), kinds: st.length, worthVC: Math.round(st.reduce((a, s) => a + s.worthVC, 0) * 100) / 100, items: st.slice(0, n), more: Math.max(0, st.length - n) };
  }
  /** A stack of the owner's by its ref ('S12', 12) or its name ("gift box": the most valuable of that name). */
  stackOf(owner, ref) {
    const k = ownerKey(owner), m = /^S?(\d+)$/i.exec(String(ref ?? '').trim());
    if (m) { const r = this.q.get.get(this.w, Number(m[1])); return r && r.owner === k ? r.id : null; }
    const want = String(ref || '').trim().toLowerCase();
    if (!want) return null;
    const hits = this.list(owner).filter(s => (itemOf(s.item)?.name || '').toLowerCase() === want || (itemOf(s.item)?.name || '').toLowerCase().includes(want));
    hits.sort((a, b) => itemValue(itemOf(b.item), b.attrs) - itemValue(itemOf(a.item), a.attrs));
    return hits[0]?.id ?? null;
  }
  /** Someone by name (as an agent says it): a player by their name or login, else an agent by its name. */
  recipientByName(name) {
    const n = String(name || '').trim().replace(/^@/, '').toLowerCase();
    if (!n) throw bad('Give it to whom?');
    const acc = this.q.byName.get(this.w, n, n);
    if (acc) return subj('account', acc.id);
    const ag = (this.e.d.agents?.enabled?.() || []).find(a => a.name.toLowerCase() === n);
    if (ag) return subj('agent', ag.id);
    throw bad(`Nobody called ${String(name).slice(0, 40)} here.`, 'not_found', 404);
  }
  has(owner, item) { return this.list(owner).filter(s => s.item === item).reduce((a, s) => a + s.qty, 0); }
  // ---------------------------------------------------------------- changing (each in one transaction, logged)
  /**
   * Puts pieces into an owner's inventory (a catch, a purchase, a grant): item, qty, attrs (a one-of-a-kind's: then
   * each of the qty is its own piece). meta: { kind, actor, memo, ref, idem, src } → { stacks: [ids], dup }.
   */
  add(owner, item, qty, attrs = null, meta = {}) {
    const def = itemOf(item);
    if (!def) throw bad(`No such item: ${item}`);
    qty = Math.floor(Number(qty));
    if (!(qty >= 1 && qty <= MAX_QTY)) throw bad('That isn\'t a number of things.');
    if (def.unique && !attrs) attrs = {};
    if (!def.unique) attrs = null;
    return this.e.dbs.tx(() => {
      if (meta.idem && this.q.idem.get(this.w, meta.idem)) return { stacks: [], dup: true };
      const ids = this.put(ownerKey(owner), def, qty, attrs);
      this.log({ kind: meta.kind || 'grant', item, qty, attrs, src: meta.src || null, dst: ownerKey(owner), actor: meta.actor, memo: meta.memo, ref: meta.ref, value: itemValue(def, attrs) * qty, idem: meta.idem });
      return { stacks: ids, dup: false };
    });
  }
  /** Takes qty from a stack of the owner's (used up, sold, thrown away): meta as add. → the piece { item, qty, attrs, value }. */
  take(owner, stackId, qty, meta = {}) {
    return this.e.dbs.tx(() => {
      if (meta.idem && this.q.idem.get(this.w, meta.idem)) return { dup: true };
      const s = this.pick(ownerKey(owner), stackId, qty), def = itemOf(s.item);
      this.drop(s, qty);
      const value = itemValue(def, s.attrs) * qty;
      this.log({ kind: meta.kind || 'discard', item: s.item, qty, attrs: s.attrs, src: ownerKey(owner), dst: null, actor: meta.actor, memo: meta.memo, ref: meta.ref, value, idem: meta.idem });
      return { item: s.item, qty, attrs: s.attrs, value };
    });
  }
  /** Moves qty of a stack from one owner to another (a gift, a trade's half). meta as add (kind 'give' by default). */
  move(src, dst, stackId, qty, meta = {}) {
    const S = ownerKey(src), D = ownerKey(dst);
    if (S === D) throw bad('That\'s yours already.');
    return this.e.dbs.tx(() => {
      if (meta.idem && this.q.idem.get(this.w, meta.idem)) return { dup: true };
      const s = this.pick(S, stackId, qty), def = itemOf(s.item);
      if (def.trade === false) throw bad(`${def.name} can't be given away.`, 'rights', 403);
      this.drop(s, qty);
      const ids = this.put(D, def, qty, s.attrs), value = itemValue(def, s.attrs) * qty;
      this.log({ kind: meta.kind || 'give', item: s.item, qty, attrs: s.attrs, src: S, dst: D, actor: meta.actor, memo: meta.memo, ref: meta.ref, value, idem: meta.idem });
      return { item: s.item, qty, attrs: s.attrs, value, stacks: ids };
    });
  }
  // ---------------------------------------------------------------- giving: who may, to whom
  /**
   * A player (or one of their agents: from) gives qty of a stack to someone: { kind: 'account' | 'agent' | 'business',
   * id }. Checks the recipient is there, the giver isn't over a new account's daily cap (the value given), and an agent
   * stays within its owner's limits (above its approval line its owner approves first: the economy's approvals).
   */
  give(actor, { stack, qty = 1, to, from = null, memo = '', idem = null } = {}) {
    const giver = from ? subj('agent', from) : subj('account', actor.id);
    if (from && this.e.agentOwner(from) !== Number(actor.id) && !actor.admin) throw bad('That agent isn\'t yours.', 'rights', 403);
    const dst = this.recipient(to);
    const s = this.q.get.get(this.w, Number(stack));
    if (!s || s.owner !== ownerKey(giver)) throw bad('That isn\'t in the inventory.', 'not_found', 404);
    const n = Math.floor(Number(qty)), def = itemOf(s.item), value = itemValue(def, s.attrs ? JSON.parse(s.attrs) : null) * (n || 1);
    if (giver.kind === 'account') this.newAccountCap(giver.id, value);
    const out = this.move(giver, dst, Number(stack), n, { kind: 'give', actor: `account:${actor.id}`, memo: String(memo || '').slice(0, 140), idem: idem ? `give:${actor.id}:${String(idem).slice(0, 80)}` : null });
    if (!out.dup) this.tell(dst, giver, out);
    return { ...out, to: { ...dst, name: this.e.nameOf(dst) } };
  }
  /** An agent gives on its own (the agent API, its brain): within its owner's limits, as a payment of the same worth. */
  giveAsAgent(agentId, { stack, qty = 1, to, memo = '', idem = null } = {}, approved = false) {
    const s = this.q.get.get(this.w, Number(stack)), me = subj('agent', agentId);
    if (!s || s.owner !== ownerKey(me)) throw bad('That isn\'t in your inventory.', 'not_found', 404);
    const n = Math.floor(Number(qty)), value = itemValue(itemOf(s.item), s.attrs ? JSON.parse(s.attrs) : null) * (n || 1);
    this.e.parts.agents.check(agentId, 'pay', value, { approved });   // (throws approval_required above its owner's line)
    const dst = this.recipient(to);
    const out = this.move(me, dst, Number(stack), n, { kind: 'give', actor: `agent:${agentId}`, memo: String(memo || '').slice(0, 140), idem: idem ? `agive:${agentId}:${String(idem).slice(0, 80)}` : null });
    if (!out.dup) this.tell(dst, me, out);
    return out;
  }
  /** Who something can go to: an active player, an agent in the world, an open business. */
  recipient(to) {
    const kind = String(to?.kind || ''), id = String(to?.id ?? '');
    if (kind === 'account') { const a = this.q.account.get(this.w, Number(id)); if (!a || a.status !== 'active') throw bad('No such player.', 'not_found', 404); return subj('account', a.id); }
    if (kind === 'agent') { const a = (this.e.d.agents?.enabled?.() || []).find(x => String(x.id) === id); if (!a) throw bad('No such agent.', 'not_found', 404); return subj('agent', a.id); }
    if (kind === 'business') { const b = this.e.parts.businesses?.get(id); if (!b) throw bad('No such business.', 'not_found', 404); return subj('business', b.id); }
    throw bad('Give it to whom?');
  }
  /** A new account gives at most the policy's daily amount for new accounts (by what it gives is worth). */
  newAccountCap(accountId, value) {
    const L = this.e.policy?.().limits, a = this.q.account.get(this.w, Number(accountId));
    if (!L || !a || !(L.newAccountDays > 0) || this.e.now() - a.created > L.newAccountDays * DAY) return;
    const given = this.q.gaveSince.get(this.w, `account:${accountId}`, this.e.now() - DAY).v;
    if (given + value > L.newAccountSendPerDay) throw bad(`New accounts can give things worth ${(L.newAccountSendPerDay / 100).toFixed(0)} VC a day (${((L.newAccountSendPerDay - given) / 100).toFixed(2)} VC left today).`, 'limit', 429);
  }
  /** The receiver hears of it (a player at once; an agent's owner too). */
  tell(dst, src, out) {
    const def = itemOf(out.item), msg = { t: 'inv', ev: 'got', item: out.item, name: def?.name || out.item, icon: def?.icon || '📦', qty: out.qty, from: this.e.nameOf(src) };
    if (dst.kind === 'account') this.e.d.notify?.(Number(dst.id), msg);
    else if (dst.kind === 'agent') { const o = this.e.agentOwner(dst.id); if (o != null) this.e.d.notify?.(o, { ...msg, agent: this.e.nameOf(dst) }); }
  }
  // ---------------------------------------------------------------- the rows
  pick(owner, stackId, qty) {
    const r = this.q.get.get(this.w, Number(stackId));
    if (!r || r.owner !== owner) throw bad('That isn\'t in the inventory.', 'not_found', 404);
    if (!(Number.isInteger(qty) && qty >= 1)) throw bad('How many?');
    if (qty > r.qty - r.held) throw bad(r.held ? `Only ${r.qty - r.held} free (the rest is in a trade).` : `There ${r.qty === 1 ? 'is' : 'are'} only ${r.qty}.`, 'funds', 409);
    return { ...r, attrs: r.attrs ? JSON.parse(r.attrs) : null };
  }
  drop(s, qty) { if (qty >= s.qty) this.q.del.run(this.w, s.id); else this.q.setQty.run(s.qty - qty, this.w, s.id); }
  put(owner, def, qty, attrs) {
    const now = this.e.now(), ids = [];
    if (!def.unique) {
      const s = this.q.stack.get(this.w, owner, def.id);
      if (s) { if (s.qty + qty > MAX_QTY) throw bad(`No room for that many ${def.name}.`, 'limit', 409); this.q.setQty.run(s.qty + qty, this.w, s.id); return [s.id]; }
      if (this.q.count.get(this.w, owner).n >= MAX_STACKS) throw bad('That inventory is full - sell, give or throw something away first.', 'full', 409);
      return [Number(this.q.ins.run(this.w, owner, def.id, qty, null, now).lastInsertRowid)];
    }
    if (this.q.count.get(this.w, owner).n + qty > MAX_STACKS) throw bad('That inventory is full - sell, give or throw something away first.', 'full', 409);
    for (let k = 0; k < qty; k++) ids.push(Number(this.q.ins.run(this.w, owner, def.id, 1, JSON.stringify(attrs || {}), now).lastInsertRowid));
    return ids;
  }
  log(m) {
    this.q.move.run({ w: this.w, at: this.e.now(), kind: m.kind, item: m.item, qty: m.qty, attrs: m.attrs ? JSON.stringify(m.attrs) : null, src: m.src || null, dst: m.dst || null, actor: m.actor || null, memo: m.memo || null, ref: m.ref || null, value: Math.round(m.value || 0), idem: m.idem || null });
  }
}
