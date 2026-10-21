// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// AI agents' money (docs/features/ECONOMY.md §9; spec 06 §5–6): every agent has its own wallet. Its owner decides what
// it may do with it - scopes (work, buy, pay, rent, business), a daily spending cap, a threshold above which a payment
// waits for the owner's approval, and a pause switch. Every refusal says why, so an owner is never surprised by their
// own agent. Approvals wait a day; an approved one runs as the agent, within its cap.
import crypto from 'node:crypto';
import { LedgerError, vc } from './ledger.js';
import { subj } from './economy.js';
import { AGENT_SCOPES } from './policy.js';

const rid = () => `appr_${crypto.randomBytes(9).toString('base64url')}`;
const DAY = 86400e3;

export class AgentMoney {
  /** @param {import('./economy.js').Economy} econ */
  constructor(econ) {
    this.e = econ; this.db = econ.db; this.w = econ.w;
    const db = this.db;
    this.q = {
      get: db.prepare('SELECT * FROM econ_agent_policy WHERE world_id = ? AND agent_id = ?'),
      put: db.prepare(`INSERT INTO econ_agent_policy (world_id, agent_id, scopes, daily_cap, approve_above, paused, updated, updated_by) VALUES ($w, $id, $scopes, $cap, $above, $paused, $at, $by)
        ON CONFLICT (world_id, agent_id) DO UPDATE SET scopes = excluded.scopes, daily_cap = excluded.daily_cap, approve_above = excluded.approve_above, paused = excluded.paused, updated = excluded.updated, updated_by = excluded.updated_by`),
      spent: db.prepare("SELECT COALESCE(-SUM(p.amount), 0) AS s FROM econ_postings p JOIN econ_tx t ON t.seq = p.tx WHERE p.world_id = ? AND p.wallet = ? AND p.amount < 0 AND t.at > ? AND t.actor = ?"),
      add: db.prepare(`INSERT INTO econ_approvals (id, world_id, agent_id, owner_id, action, payload_json, amount, status, created, expires)
        VALUES ($id, $w, $agent, $owner, $action, $payload, $amount, 'pending', $at, $expires)`),
      one: db.prepare('SELECT * FROM econ_approvals WHERE world_id = ? AND id = ?'),
      set: db.prepare("UPDATE econ_approvals SET status = $status, decided = $at, result_json = $result WHERE world_id = $w AND id = $id AND status = 'pending'"),
      pendingOwner: db.prepare("SELECT * FROM econ_approvals WHERE world_id = ? AND owner_id = ? AND status = 'pending' AND expires > ? ORDER BY created DESC LIMIT 50"),
      ofAgent: db.prepare('SELECT * FROM econ_approvals WHERE world_id = ? AND agent_id = ? ORDER BY created DESC LIMIT 50'),
      openOfAgent: db.prepare("SELECT COUNT(*) AS n FROM econ_approvals WHERE world_id = ? AND agent_id = ? AND status = 'pending' AND expires > ?"),
      expire: db.prepare("UPDATE econ_approvals SET status = 'expired', decided = ? WHERE world_id = ? AND status = 'pending' AND expires <= ?"),
    };
  }
  /** The agent's limits (its owner's settings, else the policy's defaults) and what it spent in the last 24 hours. */
  limitsOf(agentId) {
    const pol = this.e.policy().agents, r = this.q.get.get(this.w, Number(agentId));
    let scopes = pol.scopes;
    if (r) { try { scopes = JSON.parse(r.scopes); } catch { scopes = []; } }
    const w = this.e.ledger.walletOf('agent', String(agentId), 'main');
    const spent = w ? this.q.spent.get(this.w, w.id, this.e.now() - DAY, `agent:${agentId}`).s : 0;
    return { scopes, dailyCap: r?.daily_cap ?? pol.dailyCap, approveAbove: r?.approve_above ?? pol.approveAbove, paused: !!r?.paused, spent24h: spent, custom: !!r };
  }
  /** The owner sets an agent's limits. */
  setLimits(owner, agentId, patch) {
    const a = this.e.d.agents?.byId?.(Number(agentId));
    if (!a || this.e.agentOwner(a.id) !== Number(owner.id)) throw new LedgerError('rights', 'Only the agent\'s owner sets its limits.', 403);
    const cur = this.limitsOf(a.id);
    const next = { ...cur };
    if (patch.scopes !== undefined) { if (!Array.isArray(patch.scopes) || patch.scopes.some(s => !AGENT_SCOPES.includes(s))) throw new LedgerError('input', `Scopes are among ${AGENT_SCOPES.join(', ')}.`, 400); next.scopes = [...new Set(patch.scopes)]; }
    for (const k of ['dailyCap', 'approveAbove']) if (patch[k] !== undefined) { if (!Number.isSafeInteger(patch[k]) || patch[k] < 0 || patch[k] > 1e11) throw new LedgerError('input', `${k} is a whole amount in hundredths of a VC.`, 400); next[k] = patch[k]; }
    if (patch.paused !== undefined) next.paused = !!patch.paused;
    this.q.put.run({ w: this.w, id: a.id, scopes: JSON.stringify(next.scopes), cap: next.dailyCap, above: next.approveAbove, paused: next.paused ? 1 : 0, at: this.e.now(), by: Number(owner.id) });
    this.e.d.audit?.log('economy.agent_limits', { actor: owner, detail: { agent: a.id, limits: { scopes: next.scopes, dailyCap: next.dailyCap, approveAbove: next.approveAbove, paused: next.paused } } });
    return this.limitsOf(a.id);
  }
  /**
   * Checks an agent's spend before it happens: paused, scope, the daily cap, and the approval threshold. Throws
   * LedgerError with code 'paused' | 'scope' | 'budget' | 'approval_required' (the caller files the approval).
   */
  check(agentId, scope, amount, { approved = false } = {}) {
    const L = this.limitsOf(agentId);
    if (L.paused) throw new LedgerError('paused', 'Your owner paused your spending.', 403, { reason: 'paused' });
    if (!L.scopes.includes(scope)) throw new LedgerError('scope', `Your owner hasn't allowed "${scope}".`, 403, { reason: 'scope', scope });
    if (L.spent24h + amount > L.dailyCap) throw new LedgerError('budget', `That would pass your daily limit (${vc(L.dailyCap)}; ${vc(L.spent24h)} spent in the last 24 hours).`, 403, { reason: 'budget', dailyCap: L.dailyCap, spent24h: L.spent24h });
    if (!approved && amount > L.approveAbove) throw new LedgerError('approval_required', `Above ${vc(L.approveAbove)} your owner approves first.`, 202, { reason: 'approval_required' });
    return L;
  }
  /** Files an approval for the owner (one pending at a time per identical action; at most 20 pending per agent). */
  ask(agentId, action, payload, amount, summary) {
    const owner = this.e.agentOwner(agentId);
    if (owner == null) throw new LedgerError('rights', 'This agent has no owner to approve it.', 403);
    if (this.q.openOfAgent.get(this.w, Number(agentId), this.e.now()).n >= 20) throw new LedgerError('limit', 'Too many approvals are waiting for your owner.', 429);
    const id = rid(), at = this.e.now();
    this.q.add.run({ id, w: this.w, agent: Number(agentId), owner, action, payload: JSON.stringify(payload), amount, at, expires: at + DAY });
    this.e.d.notify?.(owner, { t: 'econ', ev: 'approval', id, agent: this.e.nameOf(subj('agent', agentId)), agentId: Number(agentId), amount, summary });
    return { approval: id, status: 'pending', expires: at + DAY };
  }
  pendingFor(accountId) {
    return this.q.pendingOwner.all(this.w, Number(accountId), this.e.now()).map(r => this.view(r));
  }
  view(r) {
    let p = {}; try { p = JSON.parse(r.payload_json); } catch { p = {}; }
    let res = null; try { res = r.result_json ? JSON.parse(r.result_json) : null; } catch { res = null; }
    return { id: r.id, agent: { id: r.agent_id, name: this.e.nameOf(subj('agent', r.agent_id)) }, action: r.action, payload: p, amount: r.amount, status: r.status, created: r.created, expires: r.expires, decided: r.decided, result: res };
  }
  ofAgent(agentId) { return this.q.ofAgent.all(this.w, Number(agentId)).map(r => this.view(r)); }
  /** Approvals of this owner by id (a chat or a notification shows where each one stands); others' are not found. */
  ofOwner(ownerId, ids) {
    this.q.expire.run(this.e.now(), this.w, this.e.now());
    return [...new Set(ids.map(String))].slice(0, 50).map(id => this.q.one.get(this.w, id)).filter(r => r && r.owner_id === Number(ownerId)).map(r => this.view(r));
  }
  /** The owner answers: approve runs the action as the agent (still within its daily cap), decline drops it. */
  decide(owner, id, approve, run) {
    this.q.expire.run(this.e.now(), this.w, this.e.now());
    const r = this.q.one.get(this.w, String(id));
    if (!r || r.status !== 'pending') throw new LedgerError('not_found', 'That approval is no longer waiting.', 404);
    if (r.owner_id !== Number(owner.id)) throw new LedgerError('rights', 'This approval is for someone else.', 403);
    if (!approve) { this.q.set.run({ status: 'declined', at: this.e.now(), result: null, w: this.w, id: r.id }); return this.view(this.q.one.get(this.w, r.id)); }
    let result, status = 'approved';
    try { result = run(r.action, JSON.parse(r.payload_json), r.agent_id); } catch (e) { if (!(e instanceof LedgerError)) throw e; status = 'failed'; result = { error: e.message, code: e.code }; }
    this.q.set.run({ status, at: this.e.now(), result: JSON.stringify(result ?? null), w: this.w, id: r.id });
    return this.view(this.q.one.get(this.w, r.id));
  }
}
