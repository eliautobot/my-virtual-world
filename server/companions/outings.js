// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// An outing in the chat (docs/features/companions.md): when an agent goes out with a person — starts following them, so
// riding with them and waiting beside their parked body too —, a divider in that person's current chat with it ("Out with
// Kim", the page adding the time in its own clock), and one when it is back to its own day; so a walk can be read again by
// scrolling back, in the one conversation the person has with it (server/chat/sessions.js current). The outing lasts while
// the agent does what that person asked (a wait, a place, a meet-up of theirs between two walks are part of it); an order
// given again during it adds nothing. The lines are the chat's own ('system', status 'outing'): shown to the person, never
// part of what its brain is told (server/chat/chat.js leaves 'system' lines out of its history).
export const OUTING = 'outing';

export class Outings {
  /**
   * @param {object} o
   * @param {() => object|null} o.chat            server/chat/chat.js Chat (its sessions, transcripts, send)
   * @param {(accountId) => object|null} o.principalFor  the principal an account acts as
   */
  constructor({ chat = () => null, principalFor = () => null, log = null }) {
    Object.assign(this, { chatOf: chat, principalFor, log });
    this.on = new Map();     // agent id → { account }: who it is out with now
    this.first = true;       // (the first look after the server starts: outings under way may be marked already)
  }
  /**
   * One look at who is out with whom: now — agent id → { account, start } (start: it follows that person's player: an
   * outing may begin; else only one under way goes on — another order of theirs). Writes what began and what ended.
   */
  look(now) {
    const first = this.first;
    this.first = false;
    for (const [agent, cur] of [...this.on]) {
      const n = now.get(agent);
      if (n && n.account === cur.account) continue;
      this.on.delete(agent);
      this.line(cur.account, agent, 'end');
    }
    for (const [agent, n] of now) {
      if (this.on.has(agent) || !n.start) continue;
      this.on.set(agent, { account: n.account });
      // (an outing the server finds under way when it starts: marked once already, not twice)
      this.line(n.account, agent, 'start', { once: first });
    }
  }
  /** The divider in the person's current chat with the agent (a first chat made for it if it has none yet). */
  /**
   * How many outings with account agents a and b had together before now: the times both were out with that person at once
   * (their chats' outing lines overlapping) — what two companions who keep going out with them know of each other.
   */
  together(accountId, a, b) {
    try {
      const lines = this.chatOf()?.transcripts?.outingLines?.(accountId, a, b) || [];
      const spans = id => {
        const out = []; let start = null;
        for (const l of lines) { if (l.agent !== id) continue; if (l.kind === 'start') start = start ?? l.at; else if (start !== null) { out.push([start, l.at]); start = null; } }
        return out;
      };
      const A = spans(a), B = spans(b);
      return A.filter(([s0, e0]) => B.some(([s1, e1]) => s0 < e1 && s1 < e0)).length;
    } catch (e) { this.log?.warn?.('[companions] outings together could not be read:', e.message); return 0; }
  }
  line(accountId, agentId, kind, { once = false } = {}) {
    try {
      const chat = this.chatOf(), P = this.principalFor(accountId), a = chat?.agents?.get(agentId);
      if (!chat || !P?.account || !a || !a.enabled || !chat.agents.canUse(P, a)) return null;
      let s = chat.sessions.current(P.account.id, a.id);
      if (!s) { if (kind === 'end') return null; s = chat.sessions.create(P.account.id, a.id, null, 'New chat'); }
      if (once && lastOf(chat.transcripts.read(P.account.id, a.id, s.id, 200)) === 'start') return null;
      const name = String(P.account.displayName || P.account.login || 'you').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'you';
      const m = chat.transcripts.append(P.account.id, a.id, s.id, kind === 'start'
        ? { role: 'system', text: `Out with ${name}`, status: OUTING, meta: { outing: 'start', with: name } }
        : { role: 'system', text: 'Back to its own day', status: OUTING, meta: { outing: 'end' } });
      // (a window showing that chat draws it now)
      try { chat.send(P.account.id, { t: 'chat_line', agent: a.id, session: s.id, message: m }); } catch { /* the page reads it with the history */ }
      return m;
    } catch (e) { this.log?.warn?.('[companions] an outing\'s line could not be written:', e.message); return null; }
  }
}
/** The last outing line of a chat: 'start', 'end' or null. */
function lastOf(list) {
  for (let k = list.length - 1; k >= 0; k--) if (list[k].role === 'system' && list[k].status === OUTING) return list[k].meta?.outing || null;
  return null;
}
