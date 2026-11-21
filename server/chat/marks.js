// My Virtual World — Copyright (c) 2026 My Virtual World. Licensed under the PolyForm Noncommercial License 1.0.0 (see LICENSE).
// What this installation marks in a chat that a provider's own record does not keep (server/chat/chat.js history): an
// outing's dividers ("Out with Kim", server/companions/outings.js) where they happened, and a person's line said to a group
// (the companions' voice, server/chat/groups.js) marked with who it was said to. Shown to the person only: none of it is
// ever part of what a brain is told.
import { OUTING } from '../companions/outings.js';

/** `messages` (the history as it will be shown) with the mirror's outing lines in their place, by time, and the person's
 *  group lines marked (meta.to: the names), matched by their words in order. */
export function withMarks(messages, mirror) {
  let out = Array.isArray(messages) ? messages : [];
  const said = (mirror || []).filter(m => m.role === 'user' && Array.isArray(m.meta?.to) && m.meta.to.length);
  if (said.length) {
    out = out.map(m => {
      if (m.role !== 'user' || m.meta?.to) return m;
      const k = said.findIndex(x => x.text === m.text);
      if (k < 0) return m;
      const [x] = said.splice(k, 1);
      return { ...m, meta: { ...(m.meta || {}), to: x.meta.to } };
    });
  }
  const lines = (mirror || []).filter(m => m.role === 'system' && m.status === OUTING);
  if (!lines.length) return out;
  const have = new Set(out.filter(m => m.status === OUTING && m.id !== undefined).map(m => m.id));
  out = out.slice();
  for (const l of lines) {
    if (have.has(l.id)) continue;
    // (after the last message from before it; one with no time stays where it is)
    let k = out.length;
    while (k > 0 && Number(out[k - 1].ts) > Number(l.ts)) k--;
    out.splice(k, 0, { ...l, source: 'mirror' });
  }
  return out;
}
