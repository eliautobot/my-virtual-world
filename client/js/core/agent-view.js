// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// Pure helpers for showing agents that live outside the city (connected agents, WP2.14) in the team list and the chat panel.
// No page access, so tests/unit/agent-view.test.mjs can run them: what a connected agent's state is called, which agents have no
// body, and how the events of one chat run add up to what the person sees.
export const isExt = a => !!a && /^ext-/.test(String(a.key || ''));
/** Whether this viewer opens the agent's Agent Studio: its owner, or someone it is shared with to manage - whatever its
 *  brain, a connected agent (an outside AI) as well (2026-10-11: its friends, messages, activity and spending are there). */
export const manages = a => !!a && (!!a.mine || a.level === 'manage');
/** The agent whose body is person i, when this viewer may open its Agent Studio; null otherwise. */
export const studioAgentAt = (list, i) => (Array.isArray(list) ? list : []).find(a => a.i === i && manages(a)) || null;
/** Connected agents have no body in the city (i is -1): they cannot be clicked in the world, so the lists show them in their own right. */
export const bodylessAgents = list => (Array.isArray(list) ? list : []).filter(a => isExt(a) && !(a.i >= 0));

/** A resident that is a connected agent's body, as its owner (or a friend) sees it: the agent's own name and agent marks. Strangers get
 *  an ordinary citizen from the server; this only runs with the per-viewer agent list (GET /api/agents), which the server filters. */
export function overlayPerson(person, rec) {
  if (!person || !rec || !isExt(rec) || person.x) return person;   // a retired body (its agent was removed) is nobody's agent
  const n = rec.name || person.n, e = rec.emoji || person.e || '🤖', r = rec.role || person.r || 'AI agent';
  if (person.n === n && person.v === 1 && person.ag === rec.key && person.e === e && person.r === r) return person;
  return { ...person, n, v: 1, ag: rec.key, e, r };
}

/** How a connected agent is shown: from the presence info {working, state} the server sends (the coordinator's state, WP2.3). */
export function stateOf(agent, pr) {
  const p = pr || (agent && agent.presence) || null;
  if (p && p.working) return { key: 'working', label: 'Working', live: true, working: true };
  if (!p || p.state === 'offline') return { key: 'offline', label: 'Offline', live: false, working: false };
  return { key: 'online', label: 'Online', live: true, working: false };
}

/** The events of a run ({seq, event}) added up: progress text, tools, approvals, the answer and how it ended. */
export function reduceRun(items) {
  const out = { started: false, done: false, status: null, text: '', error: null, progress: '', pct: null, tools: [], approvals: [] };
  const tool = id => out.tools.find(t => t.id === id);
  for (const it of Array.isArray(items) ? items : []) {
    const e = it && it.event; if (!e) continue;
    switch (e.type) {
      case 'run.start': out.started = true; break;
      case 'run.progress': if (e.text) out.progress = e.text; if (typeof e.pct === 'number') out.pct = e.pct; break;
      case 'tool.start': out.tools.push({ id: e.toolId, name: e.name || 'tool', input: e.input || '', ok: null, done: false }); break;
      case 'tool.update': { const t = tool(e.toolId); if (t && e.text) t.note = e.text; break; }
      case 'tool.end': { const t = tool(e.toolId); if (t) { t.done = true; t.ok = e.ok !== false; } break; }
      case 'approval.requested': out.approvals.push({ id: e.approvalId, tool: e.tool || '', summary: e.summary || '', resolved: false, approved: null }); break;
      case 'approval.resolved': { const a = out.approvals.find(x => x.id === e.approvalId); if (a) { a.resolved = true; a.approved = !!e.approved; } break; }
      case 'run.end': out.done = true; out.status = e.status || 'ok'; if (e.text) out.text = e.text; if (e.error) out.error = e.error; break;
      default: break;
    }
  }
  return out;
}
/** One line saying where a run is, for the chat panel while it waits. */
export function runLine(r, agentState) {
  if (!r) return '';
  if (r.done) return r.status === 'ok' ? '' : r.status === 'stopped' ? 'Stopped' : r.error || 'The run did not finish';
  if (r.approvals.some(a => !a.resolved)) return 'Waiting for your approval';
  if (r.progress) return r.progress + (r.pct !== null ? ` (${Math.round(r.pct)}%)` : '');
  if (!r.started) return agentState && agentState.key === 'offline' ? 'The agent is offline; your message waits for it (up to 24 hours)' : 'Waiting for the agent to pick it up…';
  return 'Working…';
}
