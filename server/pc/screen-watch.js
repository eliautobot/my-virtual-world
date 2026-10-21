// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An Agent Providers' agent's work that started elsewhere — a conversation on another channel, a scheduled job — on its
// screens (docs/features/agent-pc.md §2.2). Its provider says which of its sessions have a turn running (agent.activity:
// their keys); while its owner watches its PC (its window open, its screen live in the world: a lease the page renews,
// LEASE_MS), those sessions are followed (chat.followKey: the provider's own session feed, the same as a watched chat's),
// so each step of theirs reaches its screens like a step of a chat here (./provider-screens.js). Nobody watching: nothing
// is followed, and a follow lapses by itself.
import { isProviderKey } from '../agent-providers.js';

export const LEASE_MS = 90000;      // a page watching an agent's screen says so again within this
const RENEW_MS = 60000;             // a session followed is followed again this long after (its lease is 150 s)
const TICK_MS = 30000;
const AGENTS_MAX = 24;              // agents one request may watch at once

export class ScreenWatch {
  /**
   * @param {{ pc: import('./os.js').PcOS, follow: (P: object, agentId: number, sessionKey: string) => Promise<boolean>,
   *   agentOf: (e: object) => object|null, now?: () => number, log?: object }} o
   *   follow: chat.followKey; agentOf: the agent a provider's event is about (the presence coordinator's own rule)
   */
  constructor({ pc, follow, agentOf, now = () => Date.now(), log = null }) {
    Object.assign(this, { pc, follow, agentOf, now, log });
    this.leases = new Map();   // agent id → Map(account id → { P, until })
    this.busy = new Map();     // agent id → its sessions with a turn running (keys)
    this.followed = new Map(); // `${agent id}|${key}` → when it was last followed
  }
  start(bus) {
    this.off = bus.on(e => { if (e?.type === 'agent.activity') { try { this.activity(e); } catch { /* the screen is not the work */ } } });
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
    return this;
  }
  stop() { this.off?.(); clearInterval(this.timer); }

  /** A page watches these agents' screens (its window, its live screens in the world): its owner's provider agents only. */
  lease(P, ids) {
    const account = P?.account?.id;
    if (account == null || !Array.isArray(ids)) return { watching: [] };
    const out = [], until = this.now() + LEASE_MS;
    for (const raw of ids.slice(0, AGENTS_MAX)) {
      const a = this.pc.agents.get(Number(raw));
      if (!a || !isProviderKey(a.key) || this.pc.accountOf(a) !== account) continue;
      let m = this.leases.get(a.id);
      if (!m) this.leases.set(a.id, m = new Map());
      m.set(account, { P, until });
      out.push(a.id);
      this.sync(a.id);
    }
    return { watching: out };
  }
  /** Its provider says which of its sessions have a turn running. */
  activity(e) {
    const a = this.agentOf(e);
    if (!a || !isProviderKey(a.key)) return;
    const keys = e.active && Array.isArray(e.keys) ? e.keys.filter(k => typeof k === 'string' && k).slice(0, 20) : [];
    if (keys.length) this.busy.set(a.id, keys); else this.busy.delete(a.id);
    this.sync(a.id);
  }
  /** The one watching it (a lease still on), or null. */
  watcher(agentId) {
    const m = this.leases.get(agentId);
    if (!m) return null;
    const now = this.now();
    for (const [k, x] of m) if (x.until < now) m.delete(k);
    if (!m.size) { this.leases.delete(agentId); return null; }
    return m.values().next().value;
  }
  /** Its busy sessions followed while it is watched (each again before its follow lapses). */
  sync(agentId) {
    const w = this.watcher(agentId), keys = this.busy.get(agentId) || [];
    const now = this.now();
    for (const key of keys) {
      const k = `${agentId}|${key}`;
      if (!w || now - (this.followed.get(k) || 0) < RENEW_MS) continue;
      this.followed.set(k, now);
      this.follow(w.P, agentId, key).then(ok => { if (!ok) this.followed.delete(k); }, e => { this.followed.delete(k); this.log?.warn?.('[pc] following its work elsewhere', e.message); });
    }
    // (what nobody follows any more is forgotten: its lease upstream lapses by itself)
    for (const k of this.followed.keys()) {
      const [id, key] = [Number(k.slice(0, k.indexOf('|'))), k.slice(k.indexOf('|') + 1)];
      if (id === agentId && (!w || !keys.includes(key))) this.followed.delete(k);
    }
  }
  tick() {
    for (const id of new Set([...this.leases.keys(), ...this.busy.keys()])) { try { this.sync(id); } catch { /* the next tick */ } }
  }
}
