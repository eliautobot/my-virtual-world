// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The bridge between a connected agent's slot (server/agent-api.js) and the agent list (server/agents.js, server/connections.js), so
// chat and presence treat a connected agent like any other agent (PLAN WP2.14). One slot, one server-managed connection of kind
// "agentapi" and one agent record with the key ext-<slot id>; the record's native id is the slot id, which is how provider events
// find it. Revoking disables the record and keeps its history; enrolling again turns it back on.
import { EXT_PREFIX } from './agents.js';

export const KIND = 'agentapi';
export const extKey = slotId => `${EXT_PREFIX}${slotId}`;

/**
 * body (optional, WP2.10): what gives a connected agent its resident in the city. spawn(agent) makes the body and returns its reference,
 * retire(agent) takes it out of the city, revive(agent) brings a retired one back, rename(agent) follows a new name, state(agent) says
 * 'none', 'live' or 'retired'. Without it (tests of the bridge alone) agents stay bodyless.
 */
export function bridgeAgents({ agentApi, agents, connections, log = null, body = null }) {
  const warn = (msg, e) => log?.warn?.(`[agent-api] ${msg}:`, e && e.message);
  /** An active agent has a body in the city, a revoked one has none; the body follows the agent's name. Safe to repeat. */
  function followBody(a, wantOn) {
    if (!a) return;
    try {
      const st = body.state(a);
      if (wantOn) {
        if (st === 'none') agents.setBodyRef(a.id, body.spawn(a));
        else if (st === 'retired') body.revive(a);
        else body.rename?.(a);
      } else if (st === 'live') body.retire(a);
    } catch (e) { warn(`could not update the body of agent ${a.id}`, e); }
  }
  /** Makes sure the slot has its connection and agent record, and that the record follows the slot's name and state. */
  function sync(slot) {
    try {
      const key = extKey(slot.id);
      let a = agents.byKey(key);
      let conn = a && a.connectionId ? connections.get(a.connectionId) : null;
      if (!conn) conn = connections.createSystem({ kind: KIND, label: slot.name, ownerId: slot.account_id, config: { slot: slot.id } });
      if (!a) {
        a = agents.create({ key, name: slot.name, ownerId: slot.account_id, connectionId: conn.id, nativeId: String(slot.id) });
        agentApi.linkAgent(slot.id, a.id);
      } else if (a.connectionId !== conn.id) agents.update(a.id, { connectionId: conn.id });
      const wantOn = slot.status === 'active' && !!slot.approved_at;   // (a connection waiting for its owner's OK has no agent yet, no body)
      if (a.name !== slot.name || a.enabled !== wantOn) agents.update(a.id, { name: slot.name, enabled: wantOn });
      if (body) followBody(agents.byKey(key), wantOn);
    } catch (e) { warn(`could not update the agent record of slot ${slot.id}`, e); }
  }
  /** A slot that never connected was removed: its (disabled) agent record and server-made connection go with it. */
  function forget(slot) {
    try {
      const a = agents.byKey(extKey(slot.id));
      if (!a) return;
      if (a.connectionId) connections.removeSystem(a.connectionId);
      agents.remove(a.id);
    } catch (e) { warn(`could not remove the agent record of slot ${slot.id}`, e); }
  }
  agentApi.hooks.enrolled = sync;
  agentApi.hooks.revoked = sync;
  agentApi.hooks.updated = sync;
  agentApi.hooks.removed = forget;
  // agents that were connected before a restart keep their records; make sure every existing slot has one
  for (const slot of agentApi.store.db.prepare("SELECT * FROM agent_slots WHERE world_id = ? AND status != 'pending'").all(agentApi.w)) sync(slot);
  return { sync, forget };
}

const unsupported = message => Object.assign(new Error(message), { code: 'unsupported' });
/**
 * The in-process adapter of the connected-agent kind (WP2.14): chat calls it like it calls a provider, and it answers from the
 * agent's mailbox instead of a helper. A run is a message waiting for the agent; the agent's reports come back as bus events.
 */
export function agentApiAdapter(agentApi) {
  return async (_c, method, params) => {
    const slot = agentApi.slotById(Number(params.agentKey));
    switch (method) {
      case 'run': {
        if (Array.isArray(params.attachments) && params.attachments.length) throw unsupported('A connected agent takes text only');
        const key = params.sessionKey && params.sessionKey !== '@new' ? params.sessionKey : `s${String(params.runId).slice(1, 13)}`;
        const sender = params.sender || {}, visitor = !!slot && sender.id !== slot.account_id;   // whoever is not the owner is a visitor
        if (visitor) { agentApi.admitVisitor(slot, sender.id); agentApi.screenVisitor(slot, params.input, sender.id); }   // (a refused one still counts)
        agentApi.queueMessage({ slot, runId: params.runId, sessionKey: key, text: params.input, sender, visitor });
        return { sessionKey: key };
      }
      case 'stop': return agentApi.queueStop(params.runId);
      case 'approve': return agentApi.queueApproval(params.runId, params.approvalId, params.approved);
      case 'deleteSession': return { ok: true };
      default: throw unsupported('A connected agent does not do that');
    }
  };
}
