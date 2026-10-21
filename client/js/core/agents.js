// Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// The list of agents this page may see (GET /api/agents), shared by the team list, the left dock and the chat panel. Connected agents
// (WP2.14) have no body in the city, so they cannot be found among the residents; this is where the page learns about them. It reloads
// when the server says the set of agents changed (a new agent enrolled, one revoked or renamed), when the account changes, and when
// the connection comes back; presence frames keep the state fresh in between.
import { S, bus } from './state.js';
import { getJSON } from './net.js';
import { isExt, overlayPerson } from './agent-view.js';

/** Body index -> the agent record the viewer may see, so a resident that is a connected agent's body reads as that agent to its owner. */
const bodies = new Map(), shown = new Map(), origs = new Map();   // shown: the overlaid resident we stored; origs: what the server sent, to give back
/** Applies the overlay to one resident; called wherever the page stores a resident it received. */
export function overlayAt(i) {
  const rec = bodies.get(i), p = S.people[i];
  if (!rec || !p) return false;
  const q = overlayPerson(p, rec);
  if (q === p) return false;
  if (p !== shown.get(i)) origs.set(i, p);
  shown.set(i, q); S.people[i] = q;
  return true;
}
function overlayAll() {
  let changed = false;
  for (const i of [...bodies.keys()]) changed = overlayAt(i) || changed;
  return changed;
}

let running = null, queued = null, restored = false;
/** Reloads the list. A call while a reload runs gets the one after it (one for all such calls), so whoever changed an
 *  agent and awaits this sees its change - not the list the reload already under way read before it. */
export function load() {
  if (running) {
    const next = () => { queued = null; return load(); };
    queued ||= running.then(next, next);
    return queued;
  }
  running = reload().finally(() => { running = null; });
  return running;
}
async function reload() {
  const [list, pres] = await Promise.all([getJSON('/api/agents').catch(() => null), getJSON('/api/presence').catch(() => null)]);
  S.agentList = list && Array.isArray(list.agents) ? list.agents : [];
  const next = new Map();
  for (const a of S.agentList) if (isExt(a) && a.i >= 0) next.set(a.i, a);
  for (const i of bodies.keys()) if (!next.has(i)) {   // this viewer may no longer see that agent: its resident is an ordinary citizen again
    if (S.people[i] && S.people[i] === shown.get(i) && origs.get(i)) { S.people[i] = origs.get(i); restored = true; }
    shown.delete(i); origs.delete(i);
  }
  bodies.clear(); for (const [i, a] of next) bodies.set(i, a);
  if (pres && Array.isArray(pres.agents)) for (const p of pres.agents) if (isExt(p)) S.presence[p.key] = { working: !!p.working, state: p.state, task: p.task };
  bus.emit('agentlist');
  if (overlayAll() || restored) bus.emit('people');
}
export function init() {
  S.agentList = S.agentList || [];
  bus.on('msg:agents', load);
  bus.on('auth', load);
  bus.on('net', up => { if (up) load(); });
  return load();
}
